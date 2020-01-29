//npm install request cheerio


//node --stack-size=2048 --max_old_space_size=4096 345BulkCrawler.js
//on m5XL:   node --stack-size=4096 --max_old_space_size=8096 345BulkCrawler.js

/*  This program bulk loads the Elastic search index with EDGAR file data.
It is intended to be run with operator during the initial index creation by downloading and inflating the daily archives.

The processControl object is used to control and track the processes kicked off by the timer loops.  Maximum number of
queued downloads and concurrent file ingest are regulated by processControl.maxQueuedDownloads and processControl.maxFileIngests.

Ths architecture is takes advantage of node's non-blocking asynchronous architecture.  While the node program itself is
single threaded (and therefore easily to understand and program), calls to the database, filesystem, and downloads are
asynchronous and allow the program to effective utilize multiple cores.  This minimizes the program's waiting for a
download, as downloads are queued and run in the background while file parsing occurs.

It also uses the same ingest Lambda function that is used doing normal operations to parse the EDGAR submission archive
into the submission's individual files, strips tags from XML and HTML and feed the text to ElasticSearch's /doc API to be indexed.
By utilizing Lambda functions, the processing can be highly concurrent, allowing 10 years of EDGAR data (~1.2 million files)
to be indexed in ???h.


Design uses two timers to monitor and kick off:
  1. downloadOverSeer starts new downloads of the daily archives every 2s up to a max of processControl.maxQueuedDownloads
  2. ingestOverSeer controls the rate submissions are indexed (10/s).
        a) each submission ingested by a spawned function running same code as production Lambda function on this instance
        b) each submission may contain multiple files of varying sizes

Access Policy for Public ES Cluster (not VPC terminated):
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "*"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:us-east-1:008161247312:domain/edgar/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "18.210.128.241"
        }
      }
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::008161247312:role/service-role/searchEdgarFullTextIndex-role-pa8mcpl8"
        ]
      },
      "Action": [
        "es:*"
      ],
      "Resource": "arn:aws:es:us-east-1:008161247312:domain/edgar/*"
    }
  ]
}

*/

//var request = require('request');
//var util = require('util');
const fs = require('fs');
const exec = require('child_process').exec;
const fork = require('child_process').fork;
const common = require('common');
const secDomain = 'https://www.sec.gov';

const region = 'us-east-1';
const domain = 'search-edgar-wac76mpm2eejvq7ibnqiu24kka'; // e.g. search-domain.region.es.amazonaws.com
const submissionsIndex = 'edgar_file';
const processControl = {
    maxQueuedDownloads: 3,  //at 1GB per tar.gz file (expanding  to 10GB) and 20 seconds to download, 10s timer stay well below SEC.gov 10 requests per second limit and does not occupy too much disk space
    maxFileIngests: 4,  //internal processes to ingest local files leveraging Node's non-blocking model
    maxRetries: 3,
    retries: {},  // record of retried archive downloads / unzips
    start: new Date("2019-01-01"),  //restart date.  If none, the lesser of the max(filedt) and 2008-01-01 is used
    end: new Date("2019-12-31"), //if false or not set, scrape continues up to today
    days: [
    ], //ingest specific days (also used as retry queue) e.g. ['2013-08-12', '2013-08-14', '2013-11-13', '2013-11-15', '2014-03-04', '2014-08-04', '2014-11-14', '2015-03-31','2015-04-30', '2016-02-18', '2016-02-26', '2016-02-29', '2017-02-24', '2017-02-28', '2017-04-27','2017-05-10', '2017-08-03', '2017-08-04', '2017-08-08', '2017-10-16', '2017-10-23', '2017-10-30', '2017-11-03','2017-11-06', '2017-12-20', '2018-04-26', '2018-04-27', '2018-04-30', '2018-05-01', '2018-11-14']],
    processes: {},
    activeDownloads: {},
    directory: '/data/' //use local 75GB SSD mounted at /data instead of './dayfiles/' on full EBS
};

let  eftsFileIndexMappings = {
    //the "_id" (returned) which serves as the PK for the index = `${adsh}:${file_name}`
    // note: adsh is also stored also as a separate searchable keyword field
    "mappings": {
        "_source": {
            "excludes": [
                "doc_text"
            ]
        },
        "properties": {
            "doc_text": {
                "type": "text",
                "store": false, //this is the default value, but included to make explicit that a full copy is not stored
                "similarity": "BM25", //this is the default value, but included to make explicit the boost algorithm. May need to investigate "boolean"
            },
            "display_names": { //array of "conformed_name (CIK #########)"
                "type": "text",
                "boost": 100,  //if the keyword appear in the name, boost it!
                "fields": {
                    "raw": {  //accessed as entity_name.raw
                        "type": "keyword", //"doc_values": true, //retrievable
                    }
                }
            },
            "adsh": { //returning!
                "type": "keyword",
            },
            "sequence": {  //ordered matching files within a submission
                "type": "keyword",
            },
            "file_description": {
                "type": "keyword",
                "index": false, // not searchable, but needed for display of results
            },
            "file_type": {  //for searching exhibit types attached to a form
                "type": "keyword",
            },
            "file_date": {
                "type": "date",
                "format": "yyyy-MM-dd",
            },
            "sics": {  //returning!
                "type": "keyword",
            },
            "ciks": { //returning!
                "type": "keyword",
                //"doc_values": true, //retrievable
            },
            "form": { //returning!
                "type": "keyword",
                "index": false, // not searchable (root_form is), but needed for display of results
            },
            "root_form": { //returning!
                "type": "keyword",
            },
            "inc_states": { //returning!
                "type": "keyword",
            },
            "biz_states": { //returning!
                "type": "keyword",
            },
            "biz_locations": { //returning!
                "type": "keyword",
                "index": false, // not searchable (root_form is), but needed for display of results
                //"doc_values": true,
            },
            "film_num": {  //for searching exhibit types attached to a form
                "type": "keyword",
                "index": false, // not searchable (root_form is), but needed for display of results
            },
            "file_num": {  //for searching exhibit types attached to a form
                "type": "keyword",
                "index": false, // not searchable (root_form is), but needed for display of results
            },
        }
    }
};

(async function (){  //entry point of this program
    //Unzipping occurs on local drive using instances with local SSDs (=75 GB for rd5.large), therefore...
    // 1. format and mount local SSD drive as /data directory
    await asyncExec("sudo mkfs -t xfs /dev/nvme1n1");
    await asyncExec("sudo mkdir -m 777 /data");  //may dive error
    await asyncExec("sudo mount /dev/nvme1n1 /data");
    await asyncExec("sudo chmod 777 /data");
    //2. clear the any remains of last bulk indexing / seeding in the /data directory
    await asyncExec('rm -r ' + processControl.directory + '*');
    //3. drop (if exists) and recreate the main submissions search index
    //    note: edgarEntity index is updated by the nightly Lambda process edgarEntityIndexRebuilder
    await asyncExec(`curl -XDELETE 'https://${domain}.${region}.es.amazonaws.com/${submissionsIndex}'`);
    await asyncExec(`curl -XPUT 'https://${domain}.${region}.es.amazonaws.com/${submissionsIndex}' -H "Content-Type: application/json" -d '${JSON.stringify(eftsFileIndexMappings)}'`);
    //4. start the download manager
    startDownloadManager(processControl, function () {
        //this callback is fired when download manager is completely down with all downloads
        common.logEvent('ElasticSearch bulk indexing', JSON.stringify(processControl), true);
        process.exit();  //exit point of this program
    });
})();

async function startDownloadManager(processControl, startDownloadManagerCallback) { //body of program (called only once)
    //initialize process counts
    processControl.dailyArchivesProcessed = 0;
    processControl.activeDownloads = {}; //clear references to activeDownloads
    processControl.downloadCount = 0;
    processControl.downloadFailCount = 0;
    processControl.killedProcessCount = 0;
    processControl.untarFailures = 0;
    processControl.processedCount = {};
    processControl.dailyArchivesSubmittedForRetry = 0;
    processControl.total345SubmissionsProcessed = 0;
    processControl.totalSubmissionsIndexed = 0;
    processControl.largeUnreadFileCount = 0;
    processControl.totalGBytesDownloaded = 0;
    processControl.indexedByteCount = 0;
    processControl.indexedDocumentCount = 0;
    processControl.paths = {}; //distinct SGL property paths and max use of each path within a single submission

    var ingestingFlag = false;  //important state flag must be set at start of ingest and cleared when finished
    var tick = 0;
    var downloadOverSeer;
    if(!processControl.start){
        var result = await common.runQuery('SELECT max(filedt) as lastfiledt FROM ownership_submission');
        var lastfiledt = (result.data&&result.data[0])?result.data[0].lastfiledt:'20080101';
        processControl.start = new Date(lastfiledt.substr(0,4)+'-'+lastfiledt.substr(4,2)+'-'+lastfiledt.substr(6,2));
    }
    downloadOverSeer = setInterval(overseeDownloads, 1000);  //master event loop kicks off, queues, and monitors downloads and manages uncompressed and file deletions

    function overseeDownloads() {
        let downloadDate, d;
        //1. check for available process slots and (and restart dead activeDownloads)
        tick++;
        //if(tick/300 == Math.floor(tick/300)) console.log(processControl);  //write status every 5 minutes to console
        let downloadingCount = 0;
        for (d = 1; d <= processControl.maxQueuedDownloads; d++) {
            if (!processControl.activeDownloads["d" + d]  || processControl.activeDownloads["d" + d].status=='504') { //start new download process
                downloadDate = nextWeekday();
                if(downloadDate) {
                    console.log(downloadDate);
                    downloadingCount++;
                    downloadAndUntarDailyArchive(d, downloadDate, function(downloadControl){//callback invoked by "downloadDailyArchiveCallback" in subroutine
                        if(downloadControl.status=='untar error' || downloadControl.status=='download error'){
                            if(!processControl.activeDownloads["d" + downloadControl.d] || downloadControl.ts != processControl.activeDownloads["d" + downloadControl.d].ts){
                                //I was killed!  -> requeue for up to 3 retries
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
                    common.logEvent(`${(new Date()).toISOString().substr(11, 10)} killing long '${status} process`, processControl.activeDownloads["d" + d].url);
                    addDayToReprocess(processControl.activeDownloads["d" + d].archiveDate, processControl.activeDownloads["d" + d].status);
                    delete processControl.activeDownloads["d" + d];  //if process actually returns, it will gracefully end without proper control reference
                    processControl.killedProcessCount++;  //will be restarted on next timer tick
                } else {
                    if(!ingestingFlag && processControl.activeDownloads["d" + d].status == 'unarchived'){ //only index one directory at a time
                        ingestingFlag = true;
                        indexDirectory(processControl, d, function(downloadControl){
                            //this callback invoked when indexDirectory has completely index the directory or errored out
                            switch(downloadControl.status){
                                case("ingested"):
                                    processControl.dailyArchivesProcessed++
                            }
                            delete processControl.activeDownloads["d" + downloadControl.d];  //next download or inject starts on next tick
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
                processControl.retries[strRetryDate] = (processControl.retries[strRetryDate] || 0) + 1;
                if(processControl.retries[strRetryDate] <= processControl.maxRetries) {
                    common.logEvent('ElasticSearch retry for '+retryDate, 'retry #'+processControl.retries[strRetryDate]+' due to '+cause, true);
                    processControl.days.push(strRetryDate);
                    processControl.dailyArchivesSubmittedForRetry++;
                } else {
                    common.logEvent('ElasticSearch failure after 3 retries for '+retryDate, ' due to '+cause, true);
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

        function downloadAndUntarDailyArchive(d, archiveDate, downloadAndUntarDailyArchiveCallback) {
            //1. download the archive  
            const ts = Date.now();
            const archiveName = archiveDate.toISOString().substr(0, 10).replace(/-/g, '');
            const archiveFilePath = processControl.directory + archiveName + '.nc.tar.gz';
            const url = 'https://www.sec.gov/Archives/edgar/Feed/' + archiveDate.getFullYear()
                + '/QTR' + (Math.floor(archiveDate.getUTCMonth() / 3) + 1) + '/' + archiveName + '.nc.tar.gz';
            const downloadControl = {
                    timeStamp: ts,
                    d: d,
                    archiveDate: archiveDate,
                    archiveName: archiveName,
                    url: url,
                    status: 'downloading'
                };
            processControl.activeDownloads["d" + d] = downloadControl;  //could be replaced if long running process killed!!!
            const cmd = 'wget "'+url+'" -q -O ' + archiveFilePath;  //wget "https://www.sec.gov/Archives/edgar/Feed/2019/QTR1/20190315.nc.tar.gz" -q -O /data/20190315.nc.tar.gz
            exec(cmd).on('exit', function(code){
                if(code===null) common.logEvent('ElasticSearch bulk indexer wget returned null for ' + archiveName, cmd, true);
                if(code){
                    common.logEvent('ElasticSearch bulk indexer unable to download archive (federal holiday?) code: ' + code, archiveName + ' ('+cmd+')', true);
                    downloadControl.status = '504';
                    exec('rm '+ archiveFilePath);  //remove any remains
                    if(downloadAndUntarDailyArchiveCallback) downloadAndUntarDailyArchiveCallback(downloadControl);
                } else {
                    if(fs.existsSync(archiveFilePath)){ //double check! (should be unnecessary, but experience says otherwise!)
                        console.log('downloaded '+ archiveName+'.nc.tar.gz with code '+code);
                        processControl.downloadCount++;

                        //2. decompress archive
                        downloadControl.status = 'unarchiving';
                        downloadControl.timeStamp = Date.now();  //reset timeout timeStamp for unarchiving big files
                        const  fileStats = fs.statSync(archiveFilePath);  //blocking call
                        processControl.totalGBytesDownloaded += fileStats.size / (1024 * 1024 * 1024);
                        const archiveDir = processControl.directory + downloadControl.archiveName;
                        exec('mkdir -m 777 ' + archiveDir).on('exit', function(code) {  //mkdir -m 777 /data/20190315
                            console.log(`${(new Date()).toISOString().substr(11, 10)} Unarchiving ${downloadControl.archiveName }`);
                            const cmd = 'tar xzf ' + processControl.directory + downloadControl.archiveName + '.nc.tar.gz -C ' + archiveDir;  //tar xzf /data/20190315.nc.tar.gz -C /data/20190315
                            exec(cmd).on('exit', function (code) {
                                if (code) {  //don't cancel.  Just log it.
                                    common.logEvent("ElasticSearch bulk indexer untar error", code + ' return code for: ' + cmd + ' size in bytes: ' + fileStats.size, true);
                                    exec('rm ' + archiveFilePath);  //don't let bad files build up
                                    exec('rm ' + archiveDir + '/*').on('exit', function (code) {
                                        exec('rmdir ' + archiveDir);
                                        downloadControl.status = 'untar error';
                                        if (downloadAndUntarDailyArchiveCallback) downloadAndUntarDailyArchiveCallback(downloadControl);
                                    });
                                } else {
                                    common.logEvent("downloaded and unarchived " + downloadControl.archiveName + '.nc.tar.gz', 'size:  ' + (Math.round(fileStats.size / (1024 * 1024))) + ' MB');
                                    exec('rm ' + archiveFilePath);  //delete tar file (async, but no need to t wait for completion)
                                    downloadControl.status = 'unarchived';
                                    if (downloadAndUntarDailyArchiveCallback) downloadAndUntarDailyArchiveCallback(downloadControl);
                                }
                            });
                        });
                    } else {
                        downloadControl.status = 'download error';
                        if (downloadAndUntarDailyArchiveCallback) downloadAndUntarDailyArchiveCallback(downloadControl);
                    }
                }
            });
        }
    }
}

function indexDirectory(processControl, downloadNum, ingestDirectoryCallback){
    const downloadControl = processControl.activeDownloads['d'+downloadNum];
    const directory = processControl.directory + downloadControl.archiveName;
    const startIndexTime = (new Date()).getTime();
    let slowestProcessingTime = 0,
        slowestForm,
        totalArchiveProcessingTime = 0,
        totalArchiveSubmissionsIndexed = 0,
        indexedByteCount = 0;

    downloadControl.status = 'indexing';
    fs.readdir(directory, function(err, fileNames) {
        let ingestFileNum, ingestOverSeer;
        if(err) {
            common.logEvent("unable to read directory", directory, true);
            return false;
        } else {
            common.logEvent((new Date()).toISOString().substr(11, 10) + ' Start one-day files ingest: ' ,'directory ' + directory + ' (' + fileNames.length + ' files)', true);
            ingestFileNum = -1;
            processControl.processes = {}; //clear references to processes from last directory ingest

            //EVENT TIMER FOR MASTER PROCESS KICKOFF AND MONITOR LOOP:
            ingestOverSeer = setInterval(overseeIngest, 100);
        }

        function overseeIngest(directFromProcessNum){
            //1. check for available process slots and (and restart dead processes)
            processControl.runningCount = 0;
            for(let p=1; p<=processControl.maxFileIngests; p++){
                if(!processControl.processes["p"+p]  || (processControl.processes["p"+p].status == 'finished')) { //start process
                    let processInfo = processNextFile(p);
                    if(processInfo) {
                        processControl.processes["p"+p] = processInfo;
                        processControl.runningCount++;
                    }
                } else {  //check health
                    let runTime = (new Date()).getTime() - processControl.processes["p"+p].timeStamp;
                    if(runTime>60 * 1000){ // > 60 seconds for one file.  Note: child process has its own timeout time for a unresponsive ES call of 20s per call
                        console.log(`${(new Date()).toISOString().substr(11, 10)} killing long index process ${processControl.processes["p"+p].name}`);
                        //process.exit();
                        let submissionHandler = processControl.processes["p"+p].submissionHandler;
                        if(submissionHandler && submissionHandler.connected){
                            submissionHandler.removeAllListeners('message');
                            submissionHandler.removeAllListeners('error');
                            console.log('disconnecting long running process p'+p);
                            submissionHandler.disconnect();
                        }
                        delete processControl.processes["p"+p];  //process is dead to me
                        let processInfo = processNextFile(p);
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
                processControl.indexedByteCount += indexedByteCount;
                common.logEvent(`${(new Date()).toISOString().substr(11, 10)} Indexed submissions for ${directory}`, `Indexed ${processControl.indexedDocumentCount} documents in ${fileNames.length} submissions${directFromProcessNum ? ' (called by processNum '+directFromProcessNum+')' : ''}`, true);
                clearInterval(ingestOverSeer); //finished processing this one-day; turn off overseer
                ingestOverSeer = false;
                if(slowestProcessingTime) {
                    console.log(`Longest processing was ${slowestProcessingTime}ms for ${slowestForm}`);
                    console.log(`Average processing was ${Math.round(totalArchiveProcessingTime/totalArchiveSubmissionsIndexed)}ms across ${processControl.indexedDocumentCount} files in ${totalArchiveSubmissionsIndexed} submissions in ${directory}`);
                    console.log(`${Math.round(10*indexedByteCount/(1024*1024))/10}MB indexed for this day in ${Math.round(((new Date()).getTime()-startIndexTime)/100)/10}s; ${Math.round(10*processControl.indexedByteCount/(1024*1024))/10}MB in total`);
                }
                downloadControl.status = 'indexed';
                const archiveDir = processControl.directory + downloadControl.archiveName;
                exec('rm ' + archiveDir + '/*').on('exit', function (code) {
                    exec('rmdir ' + archiveDir);
                });
                if(ingestDirectoryCallback) ingestDirectoryCallback(downloadControl);
            }
        }

        function processNextFile(processNum){  //the master index has reference to all submission; send the next files or false if none left to process
            var submissionHandler;
            while(ingestFileNum<fileNames.length-1) {
                ingestFileNum++;
                var fileName = fileNames[ingestFileNum];
                if (fileName.indexOf('.nc') != -1) {
                    //todo: understand .corrr01 files such as 0000914475-15-000080.corr01 in 20160119
                    let filing = {
                        path: directory + '/',
                        name: fileName,
                        processNum: processNum,
                        timeStamp: (new Date()).getTime()
                    };
                    //console.log(filing);
                    if(processControl.processes['p'+processNum] && processControl.processes['p'+processNum].submissionHandler){
                        filing.submissionHandler = processControl.processes['p'+processNum].submissionHandler;
                        filing.submissionHandler.send(filing);
                    } else{
                        //console.log('create child process for P'+processNum);
                        submissionHandler = fork('edgarFullTextSearchSubmissionIngest', {
                            execArgv: ['--max-old-space-size=1024', '--expose-gc']  // = 1GB container
                        });
                        submissionHandler.on('message', submissionIndexed);
                        submissionHandler.on('error', err => {
                            console.log('ERROR parseSubmissionTxtFile from processNextFile', err, JSON.stringify(err));
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
        }

        //helper function with access to processNextFile vars
        function submissionIndexed(result) {
            if(result.status=='ok'){
                //console.log('received results from process!!', result);
                totalArchiveProcessingTime += result.processTime;
                indexedByteCount += result.indexedByteCount;
                processControl.indexedDocumentCount += result.indexedDocumentCount;
                totalArchiveSubmissionsIndexed++;
                if(result.processTime>slowestProcessingTime){
                    slowestProcessingTime = result.processTime;
                    slowestForm = result.form;
                }
                if(!result.entities.length){
                    if(!processControl.cikNotFoundForms) processControl.cikNotFoundForms = {};
                    processControl.cikNotFoundForms[result.form] = (processControl.cikNotFoundForms[result.form] || 0) + 1;
                }
                processControl.totalSubmissionsIndexed++;
                processControl.processes['p'+result.processNum].status = 'finishing';
                processControl.processedCount[result.form] = (processControl.processedCount[result.form] || 0) + 1;
                for(let path in result.paths){ //analytics disabled and not returned, so loop doesn't execute
                    processControl.paths[path] = Math.max(processControl.paths[path]||0, result.paths[path]);
                }
                exec(`rm ${directory}/${result.fileName}`);  //remove submission files as processed
            } else {
                console.log('ERROR from edgarFullTextSearchSubmissionIngest', result, 'processNum ' + (result.processNum ? result.processNum : 'unknown'));
                common.logEvent('ERROR from edgarFullTextSearchSubmissionIngest', 'processNum ' + (result.processNum ? result.processNum : 'unknown') + JSON.stringify(result));
            }
            setTimeout(()=>{ //give garbage collection a chance
                processControl.processes['p'+result.processNum].status = 'finished';
                overseeIngest(result.processNum);
            }, 5);
        }
    });
}

//asyncExec allows execution of Linux/OS commands using await syntax instead of nested callbacks
function asyncExec(commandLineString) {
    return new Promise((resolve, reject) => {
        exec(commandLineString).on('exit', (code) => {
            resolve(code)
        }).on('error', () => {
            resolve('error')
        });
    });
}
