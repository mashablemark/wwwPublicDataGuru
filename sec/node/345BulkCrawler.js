//npm install request cheerio
//node crawler.js

//node --stack-size=2048 --max_old_space_size=4096 345BulkCrawler.js
//on m5XL:   node --stack-size=4096 --max_old_space_size=8096 345BulkCrawler.js

//todo: unarchive one while processing
//todo: unnested functions to avoid accidental closure leaks
//todo: process oldest download first (FIFO)
/*
Problem: sec.gov limits request to 10 per second.  With 140,000 3/4/5 filing per quarter, a decade would take 6.5 days
Daily bulk tar files (about 1GB each):
1. 25s for: wget "https://www.sec.gov/Archives/edgar/Feed/2016/QTR1/20160104.nc.tar.gz"
2. mkdir dayfiles
3. 5s for: tar xzf 20160104.nc.tar.gz -C dayfiles
 */

/* 345BulkCrawler design notes:

Design uses two timers to monitor and kick off:
  1. archive downloads
  2. file ingests (of unarchived daily file)

The processControl object is used to control and track the processes kicked off by the timer loops.  Maximum number of
queued downloads and concurrent file ingest are regulared by processControl.maxQueuedDownloads and .maxFileIngests.

Ths architecture is takes advantage of node's non-blocking asynchronous architecture.  While the node program itself is
single threaded (and therefore easily to understand and program), calls to the database, filesystem, and downloads are
asynchronous and allow the program to effective utilize mutliple cores.  This minimizes the program's waiting for a
download, as downloads are queued and run in the background while file parsing occurs.  Likewise, concurrent file parsing
processes makes use of otherwise dead-time during filesystem reads database writes.  This reduces processing time 5x,
allowing 10 years of ownership (~1.2 million files) to be ingesting in under 5h.
 */
var request = require('request');
var util = require('util');
var fs = require('fs');
var exec = require('child_process').exec;
var fork = require('child_process').fork;
var common = require('common');

var con,  //global db connection
    secDomain = 'https://www.sec.gov';
//1000180|SANDISK CORP|4/A|2016-02-24|edgar/data/1000180/0001242648-16-000070.txt
var ownershipForms= {
    '3': 'xml',
    '3/A': 'xml',
    '4': 'xml',
    '4/A': 'xml',
    '5': 'xml',
    '5/A': 'xml'
};

var processControl = {
    maxFileIngests: 4,  //internal processes to ingest local files leveraging Node's non-blocking model
    maxQueuedDownloads: 4,  //at 1GB per file and 20 seconds to download, 10s timer stay well below SEC.gov 10 requests per second limit and does not occupy too much disk space
    maxRetries: 3,
    retries: {},  // record of retried archive downloads / unzips
    //start: new Date("2018-06-06"),  //restart date
    start:  new Date("2008-01-01"), //earliest ingested filedt
    end: false, // new Date("2008-01-29"), //if false or not set, scrape continues up to today
    days: [
    ], //ingest specific days (also used as retry queue) e.g. ['2013-08-12', '2013-08-14', '2013-11-13', '2013-11-15', '2014-03-04', '2014-08-04', '2014-11-14', '2015-03-31','2015-04-30', '2016-02-18', '2016-02-26', '2016-02-29', '2017-02-24', '2017-02-28', '2017-04-27','2017-05-10', '2017-08-03', '2017-08-04', '2017-08-08', '2017-10-16', '2017-10-23', '2017-10-30', '2017-11-03','2017-11-06', '2017-12-20', '2018-04-26', '2018-04-27', '2018-04-30', '2018-05-01', '2018-11-14']],
    processes: {},
    activeDownloads: {},
    directory: 'dayfiles/'
};

startCrawl(processControl);

function startCrawl(processControl){
    exec('rm -r '+processControl.directory +'*').on('exit', function(code) { //clear the any remains of last crawl

        startDownloadManager(processControl, function(){
            console.log(processControl);
            common.logEvent('processing finished',JSON.stringify(processControl), true);
            console.log('calling makeOwnershipAPI()');
            runQuery('call makeOwnershipAPI();', function(){
                common.logEvent('makeOwnershipAPI() finished',JSON.stringify(processControl), true);
                //todo:  update the S3 files where ownership_api_reporter/issuer.lastfiledt >= processcontrol.startdate = convert from python to Node?
                process.exit();
            });
        });
    });
}

async function startDownloadManager(processControl, startDownloadManagerCallback) {
    processControl.dailyArchivesProcessed = 0;
    processControl.activeDownloads = {}; //clear references to activeDownloads
    processControl.downloadCount = 0;
    processControl.downloadFailCount = 0;
    processControl.killedProcessCount = 0;
    processControl.untarFailures = 0;
    processControl.processedCount = {};
    processControl.dailyArchivesSubmittedForRetry = 0;
    processControl.total345SubmissionsProcessed = 0;
    processControl.totalFilesRead = 0;
    processControl.largeUnreadFileCount = 0;
    processControl.totalGBytesDownloaded = 0
    var ingestingFlag = false;  //important state flag must be set at start of ingest and cleared when finished
    var tick = 0;
    var downloadOverSeer;
    if(!processControl.start){
        var result = await common.runQuery('SELECT max(filedt) as lastfiledt FROM ownership_submission');
        var lastfiledt = result[0].lastfiledt;
        processControl.start = new Date(lastfiledt.substr(0,4)+'-'+lastfiledt.substr(4,2)+'-'+lastfiledt.substr(6,2));
        processControl.start.setUTCDate(processControl.start.getUTCDate()+1);
    }
    downloadOverSeer = setInterval(overseeDownloads, 2000);  //master event loop kicks off, queues, and monitors downloads and manages uncompressed and file deletions

    function overseeDownloads() {
        var downloadDate, d;
        //1. check for available process slots and (and restart dead activeDownloads)
        tick++;
        if(tick/100 == Math.floor(tick/100)) console.log(processControl);
        var downloadingCount = 0;
        for (d = 1; d <= processControl.maxQueuedDownloads; d++) {
            if (!processControl.activeDownloads["d" + d]  || processControl.activeDownloads["d" + d].status=='504') { //start new download process
                downloadDate = nextWeekday();
                if(downloadDate) {
                    console.log(downloadDate);
                    downloadingCount++;
                    downloadDailyArchive(d, downloadDate, function(downloadControl){//callback invoked by "downloadDailyArchiveCallback" in subroutine
                        if(downloadControl.status=='downloaded'){
                            if(!processControl.activeDownloads["d" + downloadControl.d] || downloadControl.ts != processControl.activeDownloads["d" + downloadControl.d].ts){
                                //I was killed!  -> requeue
                                addDayToReprocess(downloadControl.archiveDate, downloadControl.status);
                            }
                        }
                    });
                }
            } else {  //check health
                downloadingCount++;
                var runTime = Date.now() - processControl.activeDownloads["d" + d].timeStamp;
                var status = processControl.activeDownloads["d" + d].status;
                if ((runTime > (10 * 60 * 1000)) && (status == 'downloading' || status == 'unarchiving')) { // > 10 minutes for one gz archive
                    common.logEvent('killing long ' + status + ' process', processControl.activeDownloads["d" + d].url);
                    addDayToReprocess(processControl.activeDownloads["d" + d].archiveDate, processControl.activeDownloads["d" + d].status);
                    delete processControl.activeDownloads["d" + d];  //if process actually returns, it will gracefully end without proper control reference
                    processControl.killedProcessCount++;  //will be restarted on next timer tick
                } else {
                    if(!ingestingFlag && processControl.activeDownloads["d" + d].status == 'downloaded'){ //only ingest one archive at a time
                        ingestingFlag = true;
                        processArchive(processControl, d, function(downloadControl){
                            //this callback invoke by function "processArchiveCallback" in subroutine
                            switch(downloadControl.status){
                                case("untar error"):
                                    addDayToReprocess(downloadControl.archiveDate, downloadControl.status);
                                    processControl.untarFailures++;
                                    break;
                                case("ingested"):
                                    processControl.dailyArchivesProcessed++
                            }
                            delete processControl.activeDownloads["d" + downloadControl.d];  //if process actually returns, it will gracefully end without proper control reference
                            ingestingFlag = false;
                        });
                    }
                }
            }
        }
        if (downloadingCount == 0) {
            console.log(processControl.activeDownloads);
            common.logEvent('345BulkCrawler finished',  processControl.downloadCount + ' archives downloaded (' + processControl.totalGBytesDownloaded + ' GB); '+ processControl.dailyArchivesProcessed + ' archives processed', true);
            clearInterval(downloadOverSeer); //finished processing this one-day; turn off overseer
            if (startDownloadManagerCallback) startDownloadManagerCallback(processControl);
        }

        function addDayToReprocess(retryDate, cause){
            if(Array.isArray(processControl.days)) {
                var strRetryDate = retryDate.toISOString().substr(0,10); //date part only
                if(!processControl.retries) processControl.retries = {};
                if(!processControl.retries[strRetryDate]) {
                    processControl.retries[strRetryDate] = 1
                } else {
                    processControl.retries[strRetryDate]++
                }
                if(processControl.retries[strRetryDate] <= processControl.maxRetries) {
                    common.logEvent('archive retry for '+cause, 'retry #'+processControl.retries[strRetryDate], true);

                    processControl.days.push(strRetryDate);
                    processControl.dailyArchivesSubmittedForRetry++;
                }
            }  //queue for retry
        }
        function nextWeekday() {
            if(Array.isArray(processControl.days) && processControl.days.length){
                return new Date(processControl.days.pop());
            } else {
                if(!processControl.current && processControl.start) {
                    processControl.current = new Date(processControl.start);
                    return processControl.current;
                } else {
                    var nextWeekday = new Date(processControl.current);
                    nextWeekday.setUTCDate(nextWeekday.getUTCDate() + (nextWeekday.getUTCDay() == 5 ? 3 : 1)); //skip weekends (Sunday = 0)
                }
                if((processControl.end || Date.now()) > nextWeekday){
                    processControl.current = nextWeekday;
                    return nextWeekday;
                } else {
                    return false;
                }
            }
        }

        function downloadDailyArchive(d, archiveDate, downloadDailyArchiveCallback) {
            var ts = Date.now(),
                archiveName = archiveDate.toISOString().substr(0, 10).replace(/-/g, ''),
                url = 'https://www.sec.gov/Archives/edgar/Feed/' + archiveDate.getFullYear()
                    + '/QTR' + (Math.floor(archiveDate.getUTCMonth() / 3) + 1) + '/' + archiveName + '.nc.tar.gz',
                downloadControl = {
                    timeStamp: ts,
                    d: d,
                    archiveDate: archiveDate,
                    archiveName: archiveName,
                    url: url,
                    status: 'downloading'
                },
                cmd = 'wget "'+url+'" -q -O ./' + processControl.directory + archiveName + '.nc.tar.gz';
            processControl.activeDownloads["d" + d] = downloadControl;  //could be replaced if long running process killed!!!
            
            exec(cmd).on('exit', function(code){
                if(code===null) common.logEvent('wget returned null for ' + archiveName, cmd, true);
                if(code){
                    common.logEvent('unable to download archive (federal holiday?) code: ' + code, archiveName + ' ('+cmd+')', true);
                    downloadControl.status = '504';
                    exec('rm '+processControl.directory + archiveName + '.nc.tar.gz');  //remove any remains
                } else {
                    console.log('downloaded '+ archiveName+'.nc.tar.gz with code '+code);
                    processControl.downloadCount++;
                    downloadControl.status = 'downloaded';
                }
                if(downloadDailyArchiveCallback) downloadDailyArchiveCallback(downloadControl);
            });
        }
    }
}

//inflate into new dir, rm tar file, call ingestDirectory and clean up after (removing files and directory)
function processArchive(processControl, downloadNum, processArchiveCallback){
    var download = processControl.activeDownloads['d'+downloadNum],
        archiveDir = processControl.directory + download.archiveName;
    download.status = 'unarchiving';
    download.timeStamp = Date.now();  //reset timeout timer for unarchiving big files

    var  fileStats = fs.statSync(processControl.directory + download.archiveName + '.nc.tar.gz');  //blocking call
    processControl.totalGBytesDownloaded += fileStats.size / (1024 * 1024 * 1024);
    exec('mkdir -m 777 ' + archiveDir).on('exit', function(code){
        var cmd = 'tar xzf ./' + processControl.directory + download.archiveName + '.nc.tar.gz -C ' + archiveDir;
        exec(cmd).on('exit', function(code){
            if(code) {  //don't cancel.  Just log it.
                common.logEvent("untar error", code + ' return code for: ' + cmd + ' size in bytes: ' + fileStats.size, true);
                exec('rm ./'+processControl.directory+download.archiveName+'.nc.tar.gz');  //don't let bad files build up
                exec('rm ./'+archiveDir+'/*').on('exit', function(code){
                    exec('rmdir ./'+ archiveDir);
                    download.status = 'untar error';
                    if(processArchiveCallback) processArchiveCallback(download);
                });
            } else {
                common.logEvent("downloaded archive " + download.archiveName + '.nc.tar.gz', 'size:  ' + (Math.round(fileStats.size/(1024*1024)))+' MB');
                download.status = 'ingesting';
                ingestDirectory(processControl, './' + archiveDir, function(){
                    exec('rm ./'+processControl.directory+download.archiveName+'.nc.tar.gz');  //moved here instead of immediately after tar xzf command to allow for debugging
                    exec('rm ./'+archiveDir+'/*').on('exit', function(code){
                        exec('rmdir ./'+ archiveDir);
                    });
                    download.status = 'ingested';
                    if(processArchiveCallback) processArchiveCallback(download);
                });
            }
        });
    });
}

function ingestDirectory(processControl, directory, ingestDirectoryCallback){
    fs.readdir(directory, function(err, fileNames) {
        //starting on line the 11th line: CIK|Company Name|Form Type|Date Filed|txt File url part
        if(err) {
            common.logEvent("unable to read directory", directory, true);
            return false;
        } else {
            common.logEvent('Start one-day files ingest: ' ,'directory ' + directory + ' (' + fileNames.length + ' files)', true);
            var ingestFileNum = -1;
            processControl.processes = {ownshipsSubmissionsProcessed: 0}; //clear references to processes from last index scrap
            var ingestOverSeer = setInterval(overseeIngest, 100);  //master event loop kicks off and monitors ingest processes!
        }

        function overseeIngest(directFromProcessNum){
            var filing, p;
            //1. check for available process slots and (and restart dead processes)
            processControl.runningCount = 0;
            for(p=1; p<=processControl.maxFileIngests; p++){
                if(!processControl.processes["p"+p]  || (processControl.processes["p"+p].status == 'finished')) { //start process
                    let processInfo = procesNextFile(p);
                    if(processInfo) {
                        processControl.processes["p"+p] = processInfo;
                        processControl.runningCount++;
                    }
                } else {  //check health
                    var runTime = Date.now() - processControl.processes["p"+p].timeStamp;
                    if(runTime>20 * 1000){ // > 20 seconds for one file
                        common.logEvent('killing long 345 process', processControl.processes["p"+p].name);
                        let submissionHandler = processControl.processes["p"+p].submissionHandler;
                        if(submissionHandler && submissionHandler.connected){
                            submissionHandler.removeAllListeners('message');
                            submissionHandler.removeAllListeners('error');
                            submissionHandler.disconnect()
                        }
                        delete processControl.processes["p"+p];  //process is dead to me
                        let processInfo = procesNextFile(p);
                        if(processInfo) {
                            processControl.processes["p"+p] = processInfo;
                            processControl.runningCount++; //start a new process (with different control vars.)
                        } 
                    } else {
                        processControl.runningCount++;
                    }
                }
            }

            if(processControl.runningCount == 0) {
                common.logEvent('Processed ownership files in '+ directory, 'Processed ' + processControl.processes.ownshipsSubmissionsProcessed + ' ownership submissions out of ' + fileNames.length + ' files'+(directFromProcessNum?' (called by processNum '+directFromProcessNum+')':''), true);
                clearInterval(ingestOverSeer); //finished processing this one-day; turn off overseer
                ingestOverSeer = false;
                if(ingestDirectoryCallback) ingestDirectoryCallback(processControl);
            }
        }

        function procesNextFile(processNum){  //the master index has reference to all submission; just get the next 3/4/5 ownership or false if none left to process
            var submissionHandler;
            while(ingestFileNum<fileNames.length-1) {
                ingestFileNum++;
                var fileName = fileNames[ingestFileNum];
                if (fileName.indexOf('.nc') != -1) {
                    //todo: understand .corrr01 files such as 0000914475-15-000080.corr01 in 20160119
                    let now = new Date();
                    let filing = {
                        path: directory + '/',
                        name: fileName,
                        processNum: processNum,
                        timeStamp: now.getTime()
                    }
                    if(processControl.processes['p'+processNum] && processControl.processes['p'+processNum].submissionHandler){
                        filing.submissionHandler = processControl.processes['p'+processNum].submissionHandler;
                        filing.submissionHandler.send(filing);
                    } else{
                        submissionHandler = fork('parseSubmissionTxtFile');
                        submissionHandler.on('message', parseComplete);
                        submissionHandler.on('error', err => {
                            common.logEvent('ERROR parseSubmissionTxtFile', JSON.stringify(err), true);
                        });
                        filing.submissionHandler = submissionHandler;
                        submissionHandler.send(filing);
                    }
                    return filing;
                }
            }
            if(processControl.processes['p'+processNum] && processControl.processes['p'+processNum].submissionHandler && processControl.processes['p'+processNum].submissionHandler.connected){
                processControl.processes['p'+processNum].submissionHandler.removeAllListeners('message');
                processControl.processes['p'+processNum].submissionHandler.removeAllListeners('error');
                processControl.processes['p'+processNum].submissionHandler.disconnect();
                delete processControl.processes['p'+processNum].submissionHandler;
            }

            return false;

            function parseComplete(result) {
                if(result.status=='ok'){
                    //console.log('received results from process p'+result.processNum);
                    processControl.totalFilesRead++;
                    if(result.proccessedOwnership) { //does not count duplicate submissions
                        processControl.processes.ownshipsSubmissionsProcessed++;
                        processControl.total345SubmissionsProcessed++;
                    }
                    processControl.processes['p'+result.processNum].status = 'finished';
                    if(result.form) processControl.processedCount[result.form] = (processControl.processedCount[result.form]||0)+1;
                } else {
                    common.logEvent('ERROR parseSubmissionTxtFile', 'processNum ' + (result.processNum ? result.processNum : 'unknown'))
                    if(result.status && result.processNum) processControl.processes['p'+result.processNum].status = result.status;
                }
                setTimeout(()=>{overseeIngest(result.processNum)}, 5);  //giv garbage collection a chance
            }
        }
    });
}
