//npm install request cheerio
//node crawler.js

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
var downloadedGB = 0;
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
    maxFileIngests: 10,  //internal processes to ingest local files leveraging Node's non-blocking model
    maxQueuedDownloads: 4,  //at 1GB per file and 20 seconds to download, 10s timer stay well below SEC.gov 10 requests per second limit and does not occupy too much disk space
    start: new Date("2012-05-02"),  //restart date
    //start: new Date("2008-01-01"),
    end: false, //new Date("2016-01-10"), //if false or not set, scrape continues up to today
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
            startDownloadManager(processControl, function(){process.exit()});
        });
    });
}

function startDownloadManager(processControl, callback) {
    processControl.downloadCount = 0;
    processControl.archivesProcessed = 0;
    processControl.activeDownloads = {}; //clear references to activeDownloads
    processControl.downloadedCount = 0;
    processControl.downloadFailCount = 0;
    var ingestingFlag = false;  //important state flag must be set at start of ingest and cleared when finished
    var downloadOverSeer = setInterval(overseeDownloads, 500);  //master event loop kicks off, queues, and monitors downloads and manages uncompressed and file deletions
    var tick = 0;
    function overseeDownloads() {
        var downloadDate, d;
        //1. check for available process slots and (and restart dead activeDownloads)
        tick++;
        if(tick/100 == Math.floor(tick/100)) console.log(processControl.activeDownloads);
        processControl.downloadingCount = 0;
        for (d = 1; d <= processControl.maxQueuedDownloads; d++) {
            if (!processControl.activeDownloads["d" + d]  || processControl.activeDownloads["d" + d].status=='504') { //start new download process
                downloadDate = nextWeekday();
                if(downloadDate) {
                    console.log(downloadDate);
                    processControl.downloadingCount++;
                    downloadDailyArchive(d, downloadDate);
                }
            } else {  //check health
                processControl.downloadingCount++;
                var runTime = Date.now() - processControl.activeDownloads["d" + d].started;
                var status = processControl.activeDownloads["d" + d].status;
                if ((runTime > (5 * 60 * 1000)) && (status == 'downloading' || status == 'unarchiving')) { // > 5 minutes for one gz archive
                    logEvent('killing long ' + status + ' process', processControl.activeDownloads["d" + d].url);
                    delete processControl.activeDownloads["d" + d];  //if process actually returns, it will gracefully end without proper control reference
                    processControl.downloadFailCount++;  //will be restarted on next timer tick
                } else {
                    if(!ingestingFlag && processControl.activeDownloads["d" + d].status == 'downloaded'){
                        ingestingFlag = true;
                        processArchive(processControl, d, function(finishStatus){
                            processControl.archivesProcessed++;
                            ingestingFlag = false;
                        });
                    }
                }
            }
        }
        if (processControl.downloadingCount == 0) {
            console.log(processControl.activeDownloads);
            logEvent('345BulkCrawler finished',  processControl.downloadCount + ' archives downloaded (' + downloadedGB + ' GB); '+ processControl.archivesProcessed + ' archives processed', true);
            if (callback) callback(processControl);
            clearInterval(downloadOverSeer); //finished processing this one-day; turn off overseer
        }

        function nextWeekday() {
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

        function downloadDailyArchive(d, archiveDate, callback) {
            var ts = Date.now(),
                archiveName = archiveDate.toISOString().substr(0, 10).replace(/-/g, ''),
                url = 'https://www.sec.gov/Archives/edgar/Feed/' + archiveDate.getFullYear()
                    + '/QTR' + (Math.floor(archiveDate.getUTCMonth() / 3) + 1) + '/' + archiveName + '.nc.tar.gz';
            processControl.activeDownloads["d" + d] = {
                started: ts,
                archiveDate: archiveDate,
                archiveName: archiveName,
                url: url,
                status: 'downloading'
            };
            var cmd = 'wget "'+url+'" -q -O ./' + processControl.directory + archiveName + '.nc.tar.gz';
            exec(cmd).on('exit', function(code){
                if(code===null) logEvent('wget returned null', cmd, true);
                if(code){
                    logEvent('unable to download archive (federal holiday?) code: ' + code, archiveName + ' ('+cmd+')', true);
                    processControl.activeDownloads["d" + d].status = '504';
                    exec('rm '+processControl.directory + archiveName + '.nc.tar.gz');  //remove any remains
                    if(callback) callback(false);
                } else {
                    console.log('downloaded '+ archiveName+'.nc.tar.gz with code '+code);
                    processControl.downloadCount++;
                    processControl.activeDownloads["d" + d].status = 'downloaded';
                    if(callback) callback(true);
                }
            });
        }
    }
}

//inflate into new dir, rm tar file, call ingestDirectory and clean up after (removing files and directory)
function processArchive(processControl, downloadNum, callback){
    var download = processControl.activeDownloads['d'+downloadNum],
        archiveDir = processControl.directory + download.archiveName;
    download.status = 'unarchiving';
    download.started = Date.now();  //reset timeout timer for unarchiving big files

    exec('mkdir -m 777 ' + archiveDir).on('exit', function(code){
        var cmd = 'tar xzf ./' + processControl.directory + download.archiveName + '.nc.tar.gz -C ' + archiveDir;
        exec(cmd).on('exit', function(code){
            var  fileStats = fs.statSync(processControl.directory + download.archiveName + '.nc.tar.gz');  //blocking call
            downloadedGB += fileStats.size / (1024 * 1024 * 1024);
            if(code) {  //don't cancel.  Just log it.
                logEvent("untar error", code + ' return code for: ' + cmd + ' size of ' + fileStats.size, true);
                process.exit();
            }
            logEvent("downloaded archive " + download.archiveName + '.nc.tar.gz', 'size:  ' + (Math.round(fileStats.size/1024)/1024)+' MB');
            download.status = 'ingesting';
            ingestDirectory(processControl, './' + archiveDir, function(){
                delete processControl.activeDownloads['d'+downloadNum];
                //console.log('rm ./'+archiveDir+'/*');
                exec('rm ./'+archiveDir+'/*').on('exit', function(code){
                    exec('rmdir ./'+ archiveDir);
                });
                download.status = 'ingested';
                exec('rm ./'+processControl.directory+download.archiveName+'.nc.tar.gz');  //moved here instead of immediatly after tar xzf command to allow for debugging
                if(callback) callback(download);
            });
        });
    });
}

function ingestDirectory(processControl, directory, callback){
    fs.readdir(directory, function(err, fileNames) {
        //starting on line the 11th line: CIK|Company Name|Form Type|Date Filed|txt File url part
        if(err) {
            logEvent("unable to read directory", directory, true);
            return false;
        } else {
            logEvent('Start one-day files ingest: ' ,'directory ' + directory + ' (' + fileNames.length + ' files)', true);
            var ingestFileNum = -1;
            processControl.processedCount = 0;
            processControl.processes = {}; //clear references to processes from last index scrap
            var ingestOverSeer = setInterval(overseeIngest, 100);  //master event loop kicks off and monitors ingest processes!
        }

        function overseeIngest(){
            var filing, p;
            //1. check for available process slots and (and restart dead processes)
            processControl.runningCount = 0;
            for(p=1; p<=processControl.maxFileIngests; p++){
                if(!processControl.processes["p"+p]) { //start process
                    filing = next345();
                    if(filing) {
                        processControl.runningCount++;
                        process345Submission(p, filing);
                    }
                } else {  //check health
                    var runTime = Date.now() - processControl.processes["p"+p].started;
                    if(runTime>5*1000){ // > 5 seconds for one file
                        logEvent('killing long 345 process', processControl.processes["p"+p].file);
                        delete processControl.processes["p"+p];  //if process actually returns, it will gracefully end without proper control reference
                        filing = next345();
                        if(filing) {
                            processControl.runningCount++;
                            process345Submission(p, filing);  //start a new process with different control vars.
                        } 
                    } else {
                        processControl.runningCount++;
                    }
                }
            }
            if(processControl.runningCount==0) {
                logEvent('Processed '+fileNames.length+ ' files in ' + directory, processControl.processedCount + ' ownership submissions found', true);
                clearInterval(ingestOverSeer); //finished processing this one-day; turn off overseer
                if(callback) callback(processControl);
            }
        }

        function next345(){  //the master index has reference to all submission; just get the next 3/4/5 ownership or false if none left to process
            while(ingestFileNum<fileNames.length-1){
                ingestFileNum++;
                var fileName = fileNames[ingestFileNum];
                if(fileName.indexOf('.nc')!=-1){
                    //todo: understand .corrr01 files such as 0000914475-15-000080.corr01 in 20160119
                    var  fileStats = fs.statSync(directory+'/'+fileName);  //blocking necessary for master control
                    if(fileStats.size<10*1024*1024){//don't both read massive files.  3/4/5 are typically 3-4 kB, but
                                                    // scanned attachments can be much larger
                        var fileBody = fs.readFileSync(directory+'/'+fileName, 'utf8'),  //blocking for master control
                            form = headerInfo(fileBody, '<FORM-TYPE>');
                        if(ownershipForms[form]) {  //detection of 345 file
                            return {
                                fileBody: fileBody,
                                fileName: fileName,
                                form: form,
                                filedDate: headerInfo(fileBody, '<FILING-DATE>'),
                                period: headerInfo(fileBody, '<PERIOD>')
                            }
                        } //else logEvent('<FORM-TYPE> not found', fileNames[ingestFileNum]);
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

        function process345Submission(processNum, filing){
            var ts = Date.now();  //used as a unique code to establish and check ownership
            var submission = {
                fileName: filing.fileName,
                form: filing.form,
                adsh: filing.fileName.split('.')[0],
                processNum: processNum,
                filedDate: filing.filedDate,
                period: filing.period
            };
            //console.log('processing '+submission.urlTextFile);
            //ensure this adsh is not being concurrently processed
            for(var i=1; i<=processControl.maxFileIngests; i++){
                if(processControl.processes["p"+i] && processControl.processes["p"+i].adsh == submission.adsh){
                    logEvent("adsh collision", submission.adsh);
                    delete processControl.processes["p"+processNum];  //conflict = terminate this process and have overseer start anew
                    return;
                }
            }
            processControl.processes["p"+processNum] = {
                started: ts,
                file: submission.fileName,
                adsh: submission.adsh
            };
            var sql = "select adsh from ownership_submission where adsh = '"+ submission.adsh + "'";
            runQuery(sql, function(result, fields){
                if(result.length==0){
                    process345FilingTxtFile(submission, filing.fileBody, finishedParse);
                } else {
                    logEvent('duplicate adsh', submission.fileName + ' already parsed for ADSH ' + submission.adsh);
                    finishedParse(true);  //in EDGAR archive & master index same filing is saved under issuer CIK and reporter CIK
                    //Note: this should never happen for when ingesting daily archives (versus crawl the master.idx)
                }
            });

            function finishedParse(success){
                if(success){
                    processControl.processedCount++;
                    if(processControl.processes["p"+processNum] && processControl.processes["p"+processNum].started==ts){
                        var filing = next345();
                        if(filing){
                            process345Submission(processNum, filing);
                        } else {
                            //logEvent('345 processor shutting down', 'processNum: '+processNum);
                            delete processControl.processes["p"+processNum]; //finished index = terminate self
                        }
                    } else {
                        //overseer killed me for taking too long
                        logEvent('killed 345 process finished', ((Date.now()-ts)/1000) + 's for process' + submission.fileName);
                    }
                }
            }
        }
    });
}

function process345FilingTxtFile(submission, fileBody, callback){
    var fileSize = fileBody.length;
    //get XML part of text file
    if(ownershipForms[submission.form]=='html'){
        logEvent("HTML ownership form " + submission.fileName,
        'FIRST 10000 CHARS:\n'+fileBody.substr(0,10000), true);
        process.exit();
    }
    var xml = rgxXML.exec(fileBody);
    if(xml===null){  //something went wrong in parse process:  log it but continue parse job
        logEvent("unable to find XML in " + submission.fileName,
            'FIRST 1000 CHARS:  '+fileBody.substr(0,1000)+ '\nLAST 1000 CHARS: '+ fileBody.substr(-1000,1000), true);
        callback('next');
        return;
    }
    delete fileBody;  //free up memory
    var $xml = cheerio.load(xml[0], {xmlMode: true});
    delete xml;  //free up memory
    if($xml('issuerCik').length!=1)
        throw 'issuerCik error in ' + submission.fileName;
    if($xml('rptOwnerCik').length!=1)
        logEvent('multiple 345 ownerCiks', $xml('rptOwnerCik').length + ' ownerCiks ' + submission.fileName);
    var filing = {
        adsh: submission.adsh,
        fileSize: fileSize,
        processNum: submission.processNum,
        documentType: $xml('documentType').text(),
        fileName: submission.fileName,
        filedDate: submission.filedDate,
        periodOfReport: $xml('periodOfReport').text(),
        dateOfOriginalSubmission: $xml('dateOfOriginalSubmission').text(),
        issuer: {
            cik: $xml('issuerCik').text(),
            name: $xml('issuerName').text(),
            tradingSymbol: $xml('issuerTradingSymbol').text()
        },
        reportingOwners: [],
        transactions: false, //filled out below
        footnotes: false,
        remarks: $xml('remarks').text()
    };

    var $owner;
    $xml('reportingOwner').each(function (i, elem) {
        $owner =  $xml(elem);
        //todo: understand and parse multiple reporters (e.g. https://www.sec.gov/Archives/edgar/data/0001482512/0000899243-16-010900-index.html)
        filing.reportingOwners.push({
            cik: $owner.find('reportingOwner rptOwnerCik').text(), //0001112668</rptOwnerCik>
            name: $owner.find('reportingOwner rptOwnerName').text(), //BRUNER JUDY</rptOwnerName>
            street1: $owner.find('reportingOwner rptOwnerStreet1').text(), //951 SANDISK DRIVE</rptOwnerStreet1>
            street2: $owner.find('reportingOwner rptOwnerStreet2').text(),
            city: $owner.find('reportingOwner rptOwnerCity').text(), //>MILPITAS</rptOwnerCity>
            state: $owner.find('reportingOwner rptOwnerState').text(), //>CA</rptOwnerState>
            zip: $owner.find('reportingOwner rptOwnerZipCode').text(), //>95035</rptOwnerZipCode>
            isDirector: $owner.find('reportingOwner isDirector').text(), //>0</isDirector>
            isOfficer: $owner.find('reportingOwner isOfficer').text(), //>1</isOfficer>
            isTenPercentOwner: $owner.find('reportingOwner isTenPercentOwner').text(), //>0</isTenPercentOwner>
            isOther: $owner.find('reportingOwner isOther').text(), //>0</isOther>
            officerTitle: $owner.find('reportingOwner officerTitle').text(), //>Exec. VP, Administration, CFO</officerTitle>
            signatureName: $owner.find('ownerSignature signatureName').text().replace(rgxTrim, ''),
            signatureDate: $owner.find('ownerSignature signatureDate').text().replace(rgxTrim, '')
        });

    });

    var footnotes = {};
    $xml('footnotes footnote').each(function (i, elem) {
        footnotes[elem.attribs.id] = $xml(elem).text().replace(rgxTrim, '')
    });

    var $trans, trans;
    var transactions = [];
    $xml('derivativeTable derivativeTransactions').each(function (i, elem) {
        $trans = $xml(elem);
        trans = {
            derivative: 1,
            securityTitle: $trans.find('securityTitle value').text().replace(rgxTrim, ''),
            conversionOrExercisePrice: $trans.find('conversionOrExercisePrice value').text().replace(rgxTrim, ''),
            transactionDate: $trans.find('transactionDate value').text().replace(rgxTrim, ''),
            transactionCode: $trans.find('transactionCoding transactionCode').text().replace(rgxTrim, ''),
            formType: $trans.find('transactionCoding transactionFormType').text().replace(rgxTrim, ''),
            equitySwap: $trans.find('transactionCoding equitySwapInvolved').text().replace(rgxTrim, ''),
            transactionShares: $trans.find('transactionAmounts transactionShares').text().replace(rgxTrim, ''),
            transactionPricePerShare: $trans.find('transactionAmounts transactionPricePerShare').text().replace(rgxTrim, ''),
            transactionAcquiredDisposedCode: $trans.find('transactionAcquiredDisposedCode value').text().replace(rgxTrim, ''),
            underlyingSecurityTitle: $trans.find('underlyingSecurity underlyingSecurityTitle value').text().replace(rgxTrim, ''),
            underlyingSecurityShares: $trans.find('underlyingSecurity underlyingSecurityShares value').text().replace(rgxTrim, ''),
            sharesOwnedFollowingTransaction: $trans.find('postTransactionAmounts sharesOwnedFollowingTransaction value').text().replace(rgxTrim, ''),
            ownership: $trans.find('ownershipNature directOrIndirectOwnership value').text().replace(rgxTrim, ''),
            footnotes: []
        };
        $trans.find('footnoteId').each(function (i, elem) {
            trans.footnotes.push(footnotes[elem.attribs.id]);
        });
        transactions.push(trans);

        //check to see if anything is left out
        $trans.find('securityTitle value').remove();
        $trans.find('conversionOrExercisePrice value').remove();
        $trans.find('transactionDate value').remove();
        $trans.find('transactionCoding transactionCode').remove();
        $trans.find('transactionCoding transactionFormType').remove();
        $trans.find('transactionCoding equitySwapInvolved').remove();
        $trans.find('transactionAmounts transactionShares').remove();
        $trans.find('transactionAmounts transactionPricePerShare').remove();
        $trans.find('transactionAcquiredDisposedCode value').remove();
        $trans.find('underlyingSecurity underlyingSecurityTitle value').remove();
        $trans.find('underlyingSecurity underlyingSecurityShares value').remove();
        $trans.find('postTransactionAmounts sharesOwnedFollowingTransaction value').remove();
        $trans.find('ownershipNature directOrIndirectOwnership value').remove();
        $trans.find('footnoteId').remove();
        var remains = $trans.text().trim();
        if(remains.length>0) logEvent('derivative  remains', submission.fileName + ': '+ remains)
    });

    $xml('nonDerivativeTable nonDerivativeTransaction').each(function (i, elem) {
        $trans = $xml(elem);
        trans = {
            derivative: 0,
            securityTitle: $trans.find('securityTitle value').text().replace(rgxTrim, ''),
            transactionDate: $trans.find('transactionDate value').text().replace(rgxTrim, ''),
            deemedExecutionDate: $trans.find('deemedExecutionDate value').text().replace(rgxTrim, ''),
            //conversionOrExercisePrice:  $trans.find('conversionOrExercisePrice value').text(),
            transactionCode: $trans.find('transactionCoding transactionCode').text().replace(rgxTrim, ''),
            formType: $trans.find('transactionCoding transactionFormType').text().replace(rgxTrim, ''),
            equitySwap: $trans.find('transactionCoding equitySwapInvolved').text().replace(rgxTrim, ''),
            timeliness:  $trans.find('transactionTimeliness value').text().replace(rgxTrim, ''),
            transactionShares: $trans.find('transactionAmounts transactionShares').text().replace(rgxTrim, ''),
            transactionPricePerShare: $trans.find('transactionAmounts transactionPricePerShare').text().replace(rgxTrim, ''),
            transactionAcquiredDisposedCode: $trans.find('transactionAcquiredDisposedCode value').text().replace(rgxTrim, ''),
            underlyingSecurityTitle: $trans.find('underlyingSecurity underlyingSecurityTitle value').text().replace(rgxTrim, ''),
            underlyingSecurityShares: $trans.find('underlyingSecurity underlyingSecurityShares value').text().replace(rgxTrim, ''),
            sharesOwnedFollowingTransaction: $trans.find('postTransactionAmounts sharesOwnedFollowingTransaction value').text().replace(rgxTrim, ''),
            directOrIndirectOwnership: $trans.find('ownershipNature directOrIndirectOwnership value').text().replace(rgxTrim, ''),
            natureOfOwnership: $trans.find('ownershipNature natureOfOwnership value').text().replace(rgxTrim, ''),
            footnotes: []
        };
        $trans.find('footnoteId').each(function (i, elem) {
            trans.footnotes.push(footnotes[elem.attribs.id]);
        });
        transactions.push(trans);

        //check to see if anything is left out
        $trans.find('securityTitle value').remove();
        $trans.find('conversionOrExercisePrice value').remove();
        $trans.find('transactionDate value').remove();
        $trans.find('deemedExecutionDate value').remove();
        $trans.find('transactionCoding transactionCode').remove();
        $trans.find('transactionCoding transactionFormType').remove();
        $trans.find('transactionCoding equitySwapInvolved').remove();
        $trans.find('transactionTimeliness value').remove();
        $trans.find('transactionAmounts transactionShares').remove();
        $trans.find('transactionAmounts transactionPricePerShare').remove();
        $trans.find('transactionAcquiredDisposedCode value').remove();
        $trans.find('underlyingSecurity underlyingSecurityTitle value').remove();
        $trans.find('underlyingSecurity underlyingSecurityShares value').remove();
        $trans.find('postTransactionAmounts sharesOwnedFollowingTransaction value').remove();
        $trans.find('ownershipNature directOrIndirectOwnership value').remove();
        $trans.find('ownershipNature natureOfOwnership value').remove();
        $trans.find('footnoteId').remove();
        var remains = $trans.text().trim();
        if(remains.length>0) logEvent('nonDerivative remains', submission.fileName + ': '+ $trans.html());  //with structure
    });

    if(transactions.length) filing.transactions = transactions;
    //console.log('heap used: ' + Math.round(process.memoryUsage().heapUsed / (1024*1024)) + 'MB');
    save345Submission(filing);
    callback(true);
}


function logEvent(type, msg, display){
    runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
    if(display) console.log(type, msg);
}

function save345Submission(s){
    //save main submission record into insiders and child records to
    var sql = 'INSERT INTO ownership_submission (adsh, form, reportdt, filedt, originalfiledt, issuercik, issuername, symbol, '
        + ' remarks, txtfilesize, processnum) '
        + " VALUES (" +q(s.adsh) + q(s.documentType) + q(s.periodOfReport) + q(s.filedDate) + q(s.dateOfOriginalSubmission)
        + q(s.issuer.cik) + q(s.issuer.name)+q(s.issuer.tradingSymbol)+q(s.remarks) + s.fileSize +','+ s.processNum + ')';
    runQuery(sql);

    //save reporting owner records
    for(var ro=0; ro<s.reportingOwners.length;ro++){
        var owner = s.reportingOwners[ro];
        sql ='INSERT INTO ownership_reporter (adsh, ownernum, ownercik, ownername, ownerstreet1, ownerstreet2, ownercity, '
        + ' ownerstate, ownerzip, isdirector, isofficer, istenpercentowner, signature, signeddt)'
        + ' value ('+q(s.adsh)+(ro+1)+','+q(owner.cik)+q(owner.name) + q(owner.street1)+q(owner.street2)+q(owner.city)
        + q(owner.state)+ q(owner.zip) + q(owner.isDirector)+q(owner.isOfficer)
        + q(owner.isTenPercentOwner)+ q(owner.signatureName)+q(owner.signatureDate, true) + ')';
        runQuery(sql);
    }

    //save transaction records
    for(var t=0; t<s.transactions.length;t++){
        var trans = s.transactions[t];
        sql ='INSERT INTO ownership_transaction (adsh, transnum, isderivative, formtype, security, price, transdt, deemeddt, transcode, equityswap, timeliness, shares, '
        + ' pricepershare, acquiredisposed, underlyingsecurity, underlyingshares, sharesownedafter,  directindirect, ownershipnature, footnotes)'
        + ' value ('+q(s.adsh)+(t+1)+','+trans.derivative+','+q(trans.formType)+ q(trans.securityTitle)+q(trans.conversionOrExercisePrice)
        + q(trans.transactionDate) + q(trans.deemedExecutionDate) + q(trans.transactionCode)+q(trans.equitySwap)+ q(trans.timeliness) + q(trans.transactionShares)
        + q(trans.transactionPricePerShare)+ q(trans.transactionAcquiredDisposedCode)+ q(trans.underlyingSecurityTitle)
        + q(trans.underlyingSecurityShares)+ q(trans.sharesOwnedFollowingTransaction)+ q(trans.directOrIndirectOwnership)
        + q(trans.natureOfOwnership) + q(trans.footnotes.join('; '), true) + ')';
        runQuery(sql);
    }
}

function q(value, isLast){
    if(typeof value !== 'undefined'){
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
            if(callback) callback(result, fields);
        });
    } catch(err) {
        console.log(sql);
        logEvent("fatal MySQL error", sql, true);
        throw err;
    }
}
