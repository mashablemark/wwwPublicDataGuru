//npm install request cheerio
//node crawler.js

//node --stack-size=2048 --max_old_space_size=4096 345BulkCrawler.js
//on m5XL:   node --stack-size=4096 --max_old_space_size=8096 345BulkCrawler.js


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
var cheerio = require('cheerio');
var mysql = require('mysql');
var fs = require('fs');
var exec = require('child_process').exec;

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
var rgxXML = /<xml>[.\s\S]*<\/xml>/im;
var rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
var form4TransactionCodes = {  //from https://www.sec.gov/files/forms-3-4-5.pdf
    K: 'Equity swaps and similar hedging transactions',
    P: 'Purchase of securities on an exchange or from another person',
    S: 'Sale of securities on an exchange or to another person',
    D: 'Sale or transfer of securities back to the company',
    F: 'Payment of exercise price or tax liability using portion of securities received from the company',
    M: 'Exercise or conversion of derivative security received from the company (such as an option)',
    G: 'Gift of securities by or to the insider',
    V: 'A transaction voluntarily reported on Form 4',
    J: 'Other (accompanied by a footnote describing the transaction)'
};
var processControl = {
    maxFileIngests: 4,  //internal processes to ingest local files leveraging Node's non-blocking model
    maxQueuedDownloads: 4,  //at 1GB per file and 20 seconds to download, 10s timer stay well below SEC.gov 10 requests per second limit and does not occupy too much disk space
    maxRetries: 3,
    retries: {},  // record of retried archive downloads / unzips
    start: new Date("2017-02-23"),  //restart date
    //start:  new Date("2008-01-01"), //earliest ingested filedt
    end: false, // new Date("2008-01-29"), //if false or not set, scrape continues up to today
    days: ['2017-02-13'], //ingest specific days (also used as retry queue) e.g. ['2013-08-12', '2013-08-14', '2013-11-13', '2013-11-15', '2014-03-04', '2014-08-04', '2014-11-14', '2015-03-31','2015-04-30', '2016-02-18', '2016-02-26', '2016-02-29', '2017-02-24', '2017-02-28', '2017-04-27','2017-05-10', '2017-08-03', '2017-08-04', '2017-08-08', '2017-10-16', '2017-10-23', '2017-10-30', '2017-11-03','2017-11-06', '2017-12-20', '2018-04-26', '2018-04-27', '2018-04-30', '2018-05-01', '2018-11-14']],
    processes: {},
    activeDownloads: {},
    directory: 'dayfiles/'
};

startCrawl(processControl);

function startCrawl(processControl){
    exec('rm -r '+processControl.directory +'*').on('exit', function(code) { //clear the any remains of last crawl
        con = mysql.createConnection({ //global db connection
            host: "localhost",
            user: "secdata",
            password: "Mx)vfHt{_k^p",
            database: 'secdata'
        });

        con.connect(function(err) {
            if (err) throw err;
            startDownloadManager(processControl, function(){
                console.log(processControl);
                logEvent('process finished',JSON.stringify(processControl), true);
                //process.exit();
            });
        });
    });
}

function startDownloadManager(processControl, startDownloadManagerCallback) {
    processControl.dailyArchivesProcessed = 0;
    processControl.activeDownloads = {}; //clear references to activeDownloads
    processControl.downloadCount = 0;
    processControl.downloadFailCount = 0;
    processControl.killedProcessCount = 0;
    processControl.untarFailures = 0;

    processControl.dailyArchivesSubmittedForRetry = 0;
    processControl.total345SubmissionsProcessed = 0;
    processControl.totalFilesRead = 0;
    processControl.largeUnreadFileCount = 0;
    processControl.totalGBytesDownloaded = 0
    var ingestingFlag = false;  //important state flag must be set at start of ingest and cleared when finished
    var downloadOverSeer = setInterval(overseeDownloads, 500);  //master event loop kicks off, queues, and monitors downloads and manages uncompressed and file deletions
    var tick = 0;
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
                var runTime = Date.now() - processControl.activeDownloads["d" + d].started;
                var status = processControl.activeDownloads["d" + d].status;
                if ((runTime > (10 * 60 * 1000)) && (status == 'downloading' || status == 'unarchiving')) { // > 10 minutes for one gz archive
                    logEvent('killing long ' + status + ' process', processControl.activeDownloads["d" + d].url);
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
            logEvent('345BulkCrawler finished',  processControl.downloadCount + ' archives downloaded (' + processControl.totalGBytesDownloaded + ' GB); '+ processControl.dailyArchivesProcessed + ' archives processed', true);
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
                    logEvent('archive retry for '+cause, 'retry #'+processControl.retries[strRetryDate], true);

                    processControl.days.push(strRetryDate);
                    processControl.dailyArchivesSubmittedForRetry++;
                }
            }  //queue for retry
        }
        function nextWeekday() {
            if(Array.isArray(processControl.days) && processControl.days.length){
                return new Date(processControl.days.pop());
            } else {
                if (!processControl.current) {
                    processControl.current = new Date(processControl.start);
                    return processControl.current;
                } else {
                    var nextWeekday = new Date(processControl.current);
                    nextWeekday.setDate(nextWeekday.getUTCDate() + (nextWeekday.getUTCDay() == 5 ? 3 : 1)); //skip weekends (Sunday = 0)
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
                    started: ts,
                    d: d,
                    archiveDate: archiveDate,
                    archiveName: archiveName,
                    url: url,
                    status: 'downloading'
                },
                cmd = 'wget "'+url+'" -q -O ./' + processControl.directory + archiveName + '.nc.tar.gz';
            processControl.activeDownloads["d" + d] = downloadControl;  //could be replaced if long running process killed!!!
            
            exec(cmd).on('exit', function(code){
                if(code===null) logEvent('wget returned null for ' + archiveName, cmd, true);
                if(code){
                    logEvent('unable to download archive (federal holiday?) code: ' + code, archiveName + ' ('+cmd+')', true);
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
    download.started = Date.now();  //reset timeout timer for unarchiving big files

    var  fileStats = fs.statSync(processControl.directory + download.archiveName + '.nc.tar.gz');  //blocking call
    processControl.totalGBytesDownloaded += fileStats.size / (1024 * 1024 * 1024);
    exec('mkdir -m 777 ' + archiveDir).on('exit', function(code){
        var cmd = 'tar xzf ./' + processControl.directory + download.archiveName + '.nc.tar.gz -C ' + archiveDir;
        exec(cmd).on('exit', function(code){
            if(code) {  //don't cancel.  Just log it.
                logEvent("untar error", code + ' return code for: ' + cmd + ' size in bytes: ' + fileStats.size, true);
                exec('rm ./'+processControl.directory+download.archiveName+'.nc.tar.gz');  //don't let bad files build up
                exec('rm ./'+archiveDir+'/*').on('exit', function(code){
                    exec('rmdir ./'+ archiveDir);
                    download.status = 'untar error';
                    if(processArchiveCallback) processArchiveCallback(download);
                });
            } else {
                logEvent("downloaded archive " + download.archiveName + '.nc.tar.gz', 'size:  ' + (Math.round(fileStats.size/(1024*1024)))+' MB');
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
            logEvent("unable to read directory", directory, true);
            return false;
        } else {
            logEvent('Start one-day files ingest: ' ,'directory ' + directory + ' (' + fileNames.length + ' files)', true);
            var ingestFileNum = -1;
            processControl.processes = {ownshipsSubmissionsProcessed: 0}; //clear references to processes from last index scrap
            var ingestOverSeer = setInterval(overseeIngest, 100);  //master event loop kicks off and monitors ingest processes!
        }

        function overseeIngest(){
            var filing, p;
            //1. check for available process slots and (and restart dead processes)
            processControl.runningCount = 0;
            for(p=1; p<=processControl.maxFileIngests; p++){
                if(!processControl.processes["p"+p]  || processControl.processes["p"+p].status === 'finished') { //start process
                    filing = next345();
                    if(filing) {
                        filing.processNum = p;
                        processControl.runningCount++;
                        process345Submission(processControl, filing);
                    }
                } else {  //check health
                    var runTime = Date.now() - processControl.processes["p"+p].started;
                    if(runTime>20 * 1000){ // > 8 seconds for one file
                        logEvent('killing long 345 process', processControl.processes["p"+p].file);
                        delete processControl.processes["p"+p];  //if process actually returns, it will gracefully end without proper control reference
                        filing = next345();
                        if(filing) {
                            filing.processNum = p;
                            processControl.runningCount++;
                            process345Submission(processControl, filing);  //start a new process (with different control vars.)
                        } 
                    } else {
                        processControl.runningCount++;
                    }
                }
            }

            if(processControl.runningCount == 0) {
                logEvent('Processed ownership files in '+ directory, 'Processed ' + processControl.processes.ownshipsSubmissionsProcessed + ' ownership submissions out of ' + fileNames.length + ' files', true);
                clearInterval(ingestOverSeer); //finished processing this one-day; turn off overseer
                if(ingestDirectoryCallback) ingestDirectoryCallback(processControl);
            }
        }

        function next345(){  //the master index has reference to all submission; just get the next 3/4/5 ownership or false if none left to process
            while(ingestFileNum<fileNames.length-1){
                ingestFileNum++;
                var fileName = fileNames[ingestFileNum];
                if(fileName.indexOf('.nc') != -1){
                    //todo: understand .corrr01 files such as 0000914475-15-000080.corr01 in 20160119
                    var  fileStats = fs.statSync(directory+'/'+fileName);  //blocking necessary for master control
                    if(fileStats.size<10*1024*1024){//don't both read massive files.  3/4/5 are typically 3-4 kB, but
                        // scanned attachments can be much larger
                        var fileBody = fs.readFileSync(directory+'/'+fileName, 'utf8'),  //blocking for master control
                            form = headerInfo(fileBody, '<FORM-TYPE>');
                        processControl.totalFilesRead++;
                        if(ownershipForms[form]) {  //detection of 345 file
                            return {
                                fileBody: fileBody,
                                fileName: fileName,
                                form: form,
                                filedDate: headerInfo(fileBody, '<FILING-DATE>'),
                                period: headerInfo(fileBody, '<PERIOD>')
                            }
                        } //else logEvent('<FORM-TYPE> not found', fileNames[ingestFileNum]);
                    } else {
                        processControl.largeUnreadFileCount++
                    }
                }
            }
            return false;

            function headerInfo(fileBody, tag){
                var tagStart = fileBody.indexOf(tag);
                if(tagStart==-1) return false;
                return fileBody.substring(tagStart + tag.length, fileBody.indexOf('<', tagStart+1)-1).replace(rgxTrim,'');
            }
        }
    });
}

function process345Submission(processControl, filing){
    var ts = Date.now(),
        adsh = filing.fileName.split('.')[0];  //used as a unique code to establish and check ownership
    processControl.processes["p"+filing.processNum] = {
        started: ts,
        file: filing.fileName,
        adsh: adsh
    };

// process345 Txt File(
    var fileSize = filing.fileBody.length;
    //console.log('fileSize = ' + filing.fileBody.length + ' on process #'+filing.processNum);
    //get XML part of text file
    if(ownershipForms[filing.form]=='html'){
        logEvent("HTML ownership form " + filing.fileName,
            'FIRST 10000 CHARS:\n'+filing.fileBody.substr(0,10000), true);
        throw('error:  unexpected HTML doc ' + filing.fileNam);
    }
    var xml = rgxXML.exec(filing.fileBody);
    //console.log('xmlSize = ' + xml[0].length);
    if(xml===null){  //something went wrong in parse process:  log it but continue parse job
        logEvent("unable to find XML in " + filing.fileName,
            'FIRST 1000 CHARS:  '+filing.fileBody.substr(0,1000)+ '\nLAST 1000 CHARS: '+ filing.fileBody.substr(-1000,1000), true);
        finished345ParsingSubmission('next');
        return;
    }
    delete filing.fileBody;  //free up memory
    var $xml = cheerio.load(xml[0], {xmlMode: true});
    delete xml;  //free up memory
    if($xml('issuerCik').length!=1)
        throw 'issuerCik error in ' + filing.fileName;

    var submission = {
        adsh: adsh,
        fileSize: fileSize,
        processNum: filing.processNum,
        schemaVersion: $xml('schemaVersion').text(),
        documentType: $xml('documentType').text(),
        fileName: filing.fileName,
        filedDate: filing.filedDate,
        periodOfReport: $xml('periodOfReport').text(),
        dateOfOriginalSubmission: $xml('dateOfOriginalSubmission').text(),
        issuer: {
            cik: $xml('issuerCik').text(),
            name: $xml('issuerName').text(),
            tradingSymbol: $xml('issuerTradingSymbol').text()
        },
        reportingOwners: [],
        transactions: false, //filled out below
        remarks: $xml('remarks').text(),
        signatures: $xml('ownerSignature').text(),  //will concat all ownerSignature sections' signatureName and signatureDate
        footnotes: []
    };

    var $owner;
    $xml('reportingOwner').each(function (i, elem) {
        $owner =  $xml(elem);
        submission.reportingOwners.push({
            cik: readAndRemoveTag($owner, 'reportingOwner rptOwnerCik'), //0001112668</rptOwnerCik>
            name: readAndRemoveTag($owner, 'reportingOwner rptOwnerName'), //BRUNER JUDY</rptOwnerName>
            street1: readAndRemoveTag($owner, 'reportingOwner rptOwnerStreet1'), //951 SANDISK DRIVE</rptOwnerStreet1>
            street2: readAndRemoveTag($owner, 'reportingOwner rptOwnerStreet2'),
            city: readAndRemoveTag($owner, 'reportingOwner rptOwnerCity'), //>MILPITAS</rptOwnerCity>
            state: readAndRemoveTag($owner, 'reportingOwner rptOwnerState'), //>CA</rptOwnerState>
            stateDescription: readAndRemoveTag($owner, 'reportingOwner reportingOwnerAddress rptOwnerStateDescription'), //<rptOwnerStateDescription>ONTARIO, CANADA</rptOwnerStateDescription>
            zip: readAndRemoveTag($owner, 'reportingOwner rptOwnerZipCode'), //>95035</rptOwnerZipCode>
            isDirector: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isDirector'), //>0</isDirector>
            isOfficer: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isOfficer'), //>1</isOfficer>
            isTenPercentOwner: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isTenPercentOwner'), //>0</isTenPercentOwner>
            isOther: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isOther'), //>0</isOther>
            otherText: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship otherText'),
            officerTitle: readAndRemoveTag($owner, 'reportingOwner officerTitle') //>Exec. VP, Administration, CFO</officerTitle>
        });
        //check to see if data or values were not read (and subsequently removed)
        var remains = $owner.text().trim();
        if(remains.length>0) logEvent('reporter remains', submission.fileName + ': '+ $owner.html())
    });

    $xml('footnotes footnote').each(function (i, elem) {
        var id = elem.attribs.id, text = $xml(elem).text().replace(rgxTrim, '');
        submission.footnotes.push({id: id, text: text});
    });

    var $trans, trans;
    var transactions = [];
    var transactionRecordTypes = [
        {path: 'nonDerivativeTable nonDerivativeTransaction', derivative: 0, transOrHold: 'T'},
        {path: 'nonDerivativeTable nonDerivativeHolding', derivative: 0, transOrHold: 'H'},
        {path: 'derivativeTable derivativeTransaction', derivative: 1, transOrHold: 'T'},
        {path: 'derivativeTable derivativeHolding', derivative: 1, transOrHold: 'H'}
    ];

    transactionRecordTypes.forEach(function(transactionRecordType, index){
        $xml(transactionRecordType.path).each(function (i, elem) {
            //need to
            $trans = $xml(elem);
            trans = {
                derivative: transactionRecordType.derivative,
                transOrHold: transactionRecordType.transOrHold,
                securityTitle: readAndRemoveTag($trans, 'securityTitle value'),
                transactionDate: readAndRemoveTag($trans, 'transactionDate value'),
                deemedExecutionDate: readAndRemoveTag($trans, 'deemedExecutionDate value'),
                transactionCode: readAndRemoveTag($trans, 'transactionCoding transactionCode'),
                conversionOrExercisePrice: readAndRemoveTag($trans, 'conversionOrExercisePrice value'),
                formType: readAndRemoveTag($trans, 'transactionCoding transactionFormType'), //not needed and not always in every transaction path
                equitySwap: readAndRemoveTag($trans, 'transactionCoding equitySwapInvolved'),
                timeliness:  readAndRemoveTag($trans, 'transactionTimeliness value'),
                transactionShares: readAndRemoveTag($trans, 'transactionAmounts transactionShares'),
                transactionPricePerShare: readAndRemoveTag($trans, 'transactionAmounts transactionPricePerShare'),
                transactionTotalValue: readAndRemoveTag($trans, 'transactionAmounts transactionTotalValue'),
                transactionAcquiredDisposedCode: readAndRemoveTag($trans, 'transactionAcquiredDisposedCode value'),
                underlyingSecurityTitle: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityTitle value'),
                underlyingSecurityShares: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityShares value'),
                underlyingSecurityValue: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityValue value'),
                sharesOwnedFollowingTransaction: readAndRemoveTag($trans, 'postTransactionAmounts sharesOwnedFollowingTransaction value'),
                valueOwnedFollowingTransaction:  readAndRemoveTag($trans, 'valueOwnedFollowingTransaction value'),
                directOrIndirectOwnership: readAndRemoveTag($trans, 'ownershipNature directOrIndirectOwnership value'),
                expirationDate: readAndRemoveTag($trans, 'expirationDate value'),
                exerciseDate: readAndRemoveTag($trans, 'exerciseDate value'),
                natureOfOwnership: readAndRemoveTag($trans, 'ownershipNature natureOfOwnership value'),
                footnotes: []
            };
            $trans.find('footnoteId').each(function (i, elem) {
                trans.footnotes.push(elem.attribs.id);
            });
            transactions.push(trans);

            //check to see if data or values were not read (and subsequently removed)
            $trans.find('footnoteId').remove();
            var remains = $trans.text().trim();
            if(remains.length>0) logEvent(transactionRecordType.path + ' remains', submission.fileName + ': '+ $trans.html())
            delete $trans;
        });

    });
    //console.log(transactions.length+' transaction(s) detectd for '+submission.fileName);
    if(transactions.length) submission.transactions = transactions;

    delete $doc;
    processControl.memoryUsage = process.memoryUsage();
    //console.log('heap used: ' + Math.round(process.memoryUsage().heapUsed / (1024*1024)) + 'MB');

    save345Submission(submission);
    process.nextTick(finished345ParsingSubmission);  //allow stack to clear

    function readAndRemoveTag($xml, tagPath){
        var $tag = $xml.find(tagPath);
        var value = $tag.text().replace(rgxTrim, '');
        $tag.remove();
        return value;
    }
    function finished345ParsingSubmission() {
        processControl.total345SubmissionsProcessed++
        if (processControl.processes["p" + filing.processNum] && processControl.processes["p" + filing.processNum].started == ts) {
            //that's me! terminiate nicely and let go of thread to allow trash collection, MySQL, downloads...  Timer will kick off next process
            processControl.processes.ownshipsSubmissionsProcessed++
            processControl.processes["p" + filing.processNum].status = 'finished';
        } else {
            //overseer killed me for taking too long
            logEvent('killed 345 process finished', ((Date.now() - ts) / 1000) + 's processing ' + fileName);
        }
    }
}

function save345Submission(s){
    //save main submission record (on duplicate handling in case of retries)
    var sql = 'INSERT INTO ownership_submission (adsh, form, schemaversion, reportdt, filedt, originalfiledt, issuercik, issuername, symbol, '
        + ' remarks, signatures, txtfilesize, tries) '
        + " VALUES (" +q(s.adsh) + q(s.documentType) + q(s.schemaVersion) + q(s.periodOfReport) + q(s.filedDate) + q(s.dateOfOriginalSubmission)
        + q(s.issuer.cik) + q(s.issuer.name)+q(s.issuer.tradingSymbol)+q(s.remarks)+q(s.signatures) + s.fileSize +',1)'
            + ' on duplicate key update tries = tries + 1';
    runQuery(sql);

    //save reporting owner records
    for(var ro=0; ro<s.reportingOwners.length;ro++){
        var owner = s.reportingOwners[ro];
        sql ='INSERT INTO ownership_reporter (adsh, ownernum, ownercik, ownername, ownerstreet1, ownerstreet2, ownercity, '
        + ' ownerstate, ownerstatedescript, ownerzip, isdirector, isofficer, istenpercentowner, isother, other)'
        + ' value (' +q(s.adsh) + (ro+1)+',' +q(owner.cik) +q(owner.name) + q(owner.street1)+q(owner.street2)+q(owner.city)
        + q(owner.state) + q(owner.stateDescription) +  q(owner.zip) + q(owner.isDirector)+q(owner.isOfficer)
        + q(owner.isTenPercentOwner)+ q(owner.isOther )+ q(owner.otherText, true) + ')'
            + ' on duplicate key update ownernum = ownernum';
        runQuery(sql);
    }
    //save any footnote records
    for(var f=0; f<s.footnotes.length;f++){
        var foot = s.footnotes[f];
        sql ='INSERT INTO ownership_footnote (adsh, fnum, footnote) '
            + ' value ('+q(s.adsh)+foot.id.substr(1)+','+q(foot.text, true) + ')'
            + ' on duplicate key update adsh = adsh';
        runQuery(sql);
    }

    //save transaction records
    for(var t=0; t<s.transactions.length;t++){
        var trans = s.transactions[t];
        sql ='INSERT INTO ownership_transaction (adsh, transnum, isderivative, transtype, expirationdt, exercisedt, formtype, security, price, transdt, deemeddt, transcode, equityswap, timeliness, shares, '
        + ' pricepershare, totalvalue, acquiredisposed, underlyingsecurity, underlyingshares, underlyingsecurityvalue, sharesownedafter,  valueownedafter, directindirect, ownershipnature)'
        + ' value ('+q(s.adsh)+(t+1)+','+trans.derivative+','+q(trans.transOrHold)+q(trans.expirationDate)+q(trans.exerciseDate)
        + q(trans.formType)+ q(trans.securityTitle)+q(trans.conversionOrExercisePrice) + q(trans.transactionDate)
        + q(trans.deemedExecutionDate) + q(trans.transactionCode)+q(trans.equitySwap)+ q(trans.timeliness) + q(trans.transactionShares)
        + q(trans.transactionPricePerShare)+ q(trans.transactionTotalValue)+ q(trans.transactionAcquiredDisposedCode)+ q(trans.underlyingSecurityTitle)
        + q(trans.underlyingSecurityShares)+ q(trans.underlyingSecurityValue) + q(trans.sharesOwnedFollowingTransaction)+ q(trans.valueOwnedFollowingTransaction)
        + q(trans.directOrIndirectOwnership) + q(trans.natureOfOwnership, true) + ')'
            + ' on duplicate key update transnum = transnum';
        runQuery(sql);
        for(var tf=0; tf<trans.footnotes.length;tf++){
            runQuery('INSERT INTO ownership_transaction_footnote (adsh, tnum, fnum) values ('+q(s.adsh)+(t+1)+','+trans.footnotes[tf].substr(1)+')'
             + ' on duplicate key update tnum = '+(t+1));
        }
    }
}

function q(value, isLast){
    if(typeof value !== 'undefined' && value !== ''){
        return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast?'':',');
    } else {
        return ' null'+ (isLast?'':',');
    }
}

function runQuery(sql, callback){
    try{
        con.query(sql, function(err, result, fields) {
            if(err){
                console.log(sql);
                logEvent('bad query', sql, true);
                throw err;
            }
            if(callback) process.nextTick(function(){ callback(result, fields)});
        });
    } catch(err) {
        console.log(sql);
        logEvent("fatal MySQL error", sql, true);
        throw err;
    }
}

function logEvent(type, msg, display){
    runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
    if(display) console.log(type, msg);
}
