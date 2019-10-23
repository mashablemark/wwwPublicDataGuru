//npm install request cheerio
//node crawler.js

// parses quarterly EDGAR indexes and populates the dessiminations table


var request = require('request');
var util = require('util');
var cheerio = require('cheerio');
var mysql = require('mysql');
var secure = require('./secure');

var con,  //global db connection
    secDomain = 'https://www.sec.gov';
//1000180|SANDISK CORP|4/A|2016-02-24|edgar/data/1000180/0001242648-16-000070.txt
var linePartsIndex = {CIK: 0, CompanyName: 1, FormType: 2, DateFiled: 3, Filename: 4};
var downloadedGB = 0;
var rgxXML = /<xml>[.\s\S]*<\/xml>/im;
var rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars

var processControl = {
    maxProcesses: 2,  //SEC.gov place crawler in penalty box if more than 10 requests per second
    start: {
        year: 2014,
        q: 1
    },
    end: {
        year: 2019,
        q: 2
    },
    processes: {}
};

startCrawl(processControl);

function startCrawl(processControl){
    var db_info = secure.secdata();
    con = mysql.createConnection({ //global db connection
        host: db_info.host,
        user: db_info.uid,
        password: db_info.password,
        database: 'secdata'
    });

    con.connect(function(err) {
        if (err) throw err;
        parseNextQuater(processControl);  //entry point to program
    });
}

function parseNextQuater(processControl){
    if(!processControl.current){ //just starting
        processControl.current =
            { 	year: processControl.start.year,
                q: processControl.start.q };
        processControl.quartersProcessed = 0;
    } else { //increment is not end of loop
        processControl.quartersProcessed++;
        processControl.current.year += Math.floor(q/4);
        processControl.current.q = (q % 4) + 1;
        if(processControl.current.year + processControl.current.q/10>processControl.end.year + processControl.end.q/10){
            logEvent("finished parsing and processing indexes", processControl.quartersProcessed + " quarters processed");
            return processControl.quartersProcessed;
        }
    }
    processControl.indexUrl = secDomain + '/Archives/edgar/full-index/'
        + processControl.current.year + '/QTR' + processControl.current.q + '/master.idx';
    processQuarterlyIndex(processControl)
}

function processQuarterlyIndex(processControl, callback){
    var idxUrl = processControl.indexUrl;
    logEvent('quarterly index process starting' ,'fetching ' + idxUrl, true);
    request(idxUrl, function (error, response, indexBody) {
        //starting on line the 11th line: CIK|Company Name|Form Type|Date Filed|txt File url part
        if(error) {
            logEvent("unable to read index", "ending scrap on " + processControl.indexUrl);
            logEvent("finished processing", processControl.quartersProcessed + " quarters processed");
            return false;
        } else {
            downloadedGB += indexBody.length / (1024*1024*1024);
            var lines = indexBody.split('\n');
            delete indexBody;
            var lineNum=10;  //start

            var sCnt = 0;
            while(next345()){
                sCnt++
            }
            console.log(sCnt, lines.length);
            process.exit();

            console.log('start processing ' + idxUrl);
            processControl.processedCount = 0;
            processControl.processes = {}; //clear references to processes from last index scrap
            var overSeer = setTimeout(oversee, 100);  //100ms event timer loop kicks off and monitors ingest processes!
        }

        function oversee(){
            //1. check for available process slots and (and restart dead processes)
            processControl.runningCount = 0;
            for(var i=1; i<=processControl.maxProcesses; i++){
                if(!processControl.processes["p"+i] && lineNum<lines.length) { //start process
                    lineNum++;
                    if(lineNum ) {
                        processControl.runningCount++;
                        process345Submission(i, lineNum);
                    }
                } else {  //check health
                    var runTime = Date.now() - processControl.processes["p"+i].start;
                    if(runTime>3*60*1000){ // > 3 minutes for one file
                        logEvent('killing long 345 process', processControl.processes["p"+i].line);
                        delete processControl.processes["p"+i];  //if process actually returns, it will gracefully end without proper control reference
                        lineNum = next345();
                        if(lineNum) {
                            processControl.runningCount++;
                            process345Submission(i, lineNum);  //start a new process with different control vars.
                        }
                    }
                }
                if(processControl.runningCount==0) callback(processControl)  //finished processing this quarterly
            }
        }

        function process345Submission(processNum, lineNum){
            var ts = Date.now();  //used as a unique code to establish and check ownership
            var fields = lines[lineNum].split('|');
            var file = fields[4].split('/')[3];
            var submission = {
                cik: fields[0],
                coname: fields[1],
                form: fields[2],
                filed: fields[3],
                urlTextFile: 'https://www.sec.gov/Archives/' + fields[4],
                urlIndexFile: 'https://www.sec.gov/Archives/' + fields[4].replace('.txt','-index.html'),
                adsh: file.substring(0, file.length-4),
                facts: [],
                lineNum: lineNum,
                processNum: processNum
            };
            //console.log('processing '+submission.urlTextFile);
            //ensure this adsh is not being concurrently processed
            for(var i=1; i<=processControl.maxProcesses; i++){
                if(processControl.processes["p"+i] && processControl.processes["p"+i].adsh == submission.adsh){
                    logEvent("adsh collision", submission.adsh);
                    delete processControl.processes["p"+processNum];  //conflict = terminate this process and have overseer start anew
                    return;
                }
            }
            processControl.processes["p"+processNum] = {
                start: ts,
                line: lines[lineNum],
                adsh: submission.adsh
            };
            var sql = "select adsh from ownership_submission where adsh = '"+ submission.adsh + "'";
            runQuery(sql, function(result, fields){
                if(result.length==0){
                    process345FilingTxtFile(submission, finishedParse);
                } else {
                    finishedParse('adsh already parsed');  //in EDGAR archive & master index same filing is saved under issuer CIK and reporter CIK
                }
            });

            function finishedParse(success){
                if(success){
                    processControl.processedCount++;
                    if(Math.floor(processControl.processedCount/1000)*1000==processControl.processedCount){
                        console.log('processed '+processControl.processedCount+' ('+ Math.round(100*lineNum/lines.length)+'%) files (line '+(lineNum-10)+' of '
                            +(lines.length-10)+ ' (cumulative download=' + downloadedGB + ' GB)');
                    }
                    if(processControl.processes["p"+processNum] && processControl.processes["p"+processNum].start==ts){
                        var newLineNum = next345();
                        if(newLineNum){
                            process345Submission(processNum, newLineNum);
                        } else {
                            delete processControl.processes["p"+processNum]; //finished index = terminate self
                        }
                    } else {
                        //overseer killed me for taking too long
                        logEvent('killed 345 process finished', ((Date.now()-ts)/1000) + 's for process' + submission.urlIndexFile);
                    }
                }
            }
        }
    });
}

function process345FilingTxtFile(submission, callback){
    request(submission.urlTextFile, function (error, response, txtBody) {
        if(error){
            logEvent('index page request error', submission.urlIndexFile, true);
            callback(true); //continue
        } else {
            downloadedGB += txtBody.length / (1024 * 1024 * 1024);
            //get XML part of text file
            var xml = rgxXML.exec(txtBody);
            if(xml===null){  //something went wrong in parse process
                console.log(txtBody);
                throw "unable to find XML in " + submission.urlTextFile;
            }
            delete txtBody;  //free up memory
            var $xml = cheerio.load(xml[0], {xmlMode: true});
            delete xml;  //free up memory
            if($xml('issuerCik').length!=1)
                throw 'issuerCik error in ' + submission.urlIndexFile;
            if($xml('rptOwnerCik').length!=1)
                logEvent('multiple 345 ownerCiks', $xml('rptOwnerCik').length + ' ownerCiks ' + submission.urlIndexFile);
            var filing = {
                adsh: submission.adsh,
                processNum: submission.processNum,
                lineNum: submission.lineNum,
                documentType: $xml('documentType').text(),
                url: submission.urlIndexFile,
                filed: submission.filed,
                periodOfReport: $xml('periodOfReport').text(),
                dateOfOriginalSubmission: $xml('dateOfOriginalSubmission').text(),
                issuer: {
                    cik: $xml('issuerCik').text(),
                    name: $xml('issuerName').text(),
                    tradingSymbol: $xml('issuerTradingSymbol').text()
                },
                reportingOwner: {
                    cik: $xml('reportingOwner').first().find('rptOwnerCik').text(), //0001112668</rptOwnerCik>
                    name: $xml('reportingOwner').first().find('rptOwnerName').text(), //BRUNER JUDY</rptOwnerName>
                    street1: $xml('reportingOwner').first().find('rptOwnerStreet1').text(), //951 SANDISK DRIVE</rptOwnerStreet1>
                    street2: $xml('reportingOwner').first().find('rptOwnerStreet2').text(),
                    city: $xml('reportingOwner').first().find('rptOwnerCity').text(), //>MILPITAS</rptOwnerCity>
                    state: $xml('reportingOwner').first().find('rptOwnerState').text(), //>CA</rptOwnerState>
                    zip: $xml('reportingOwner').first().find('rptOwnerZipCode').text(), //>95035</rptOwnerZipCode>
                    isDirector: $xml('reportingOwner').first().find('isDirector').text(), //>0</isDirector>
                    isOfficer: $xml('reportingOwner').first().find('isOfficer').text(), //>1</isOfficer>
                    isTenPercentOwner: $xml('reportingOwner').first().find('isTenPercentOwner').text(), //>0</isTenPercentOwner>
                    isOther: $xml('reportingOwner').first().find('isOther').text(), //>0</isOther>
                    officerTitle: $xml('reportingOwner').first().find('officerTitle').text() //>Exec. VP, Administration, CFO</officerTitle>
                    //todo: other description
                },
                transactions: false, //filled out below
                footnotes: false,
                remarks: $xml('remarks').text(),
                signatureName: $xml('ownerSignature signatureName').text().replace(rgxTrim, '')
            };
            var $signatureDates = $xml('ownerSignature signatureDate');
            filing.signatureDate = $signatureDates.eq(0).text().replace(rgxTrim, '');
            for(var i=1; i<$signatureDates.length;i++){
                if($signatureDates.eq(i).text().replace(rgxTrim, '')!=filing.signatureDate)
                    logEvent('signature date conflict', submission.urlIndexFile);
            }

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
                ownership: $trans.find('ownershipNature directOrIndirectOwnership value').remove();
                $trans.find('footnoteId').remove();
                var remains = $trans.text().trim();
                if(remains.length>0) logEvent('derivative  remains', submission.urlIndexFile + ': '+ remains)
            });

            $xml('nonDerivativeTable nonDerivativeTransaction').each(function (i, elem) {
                $trans = $xml(elem);
                trans = {
                    derivative: 0,
                    securityTitle: $trans.find('securityTitle value').text().replace(rgxTrim, ''),
                    transactionDate: $trans.find('transactionDate value').text().replace(rgxTrim, ''),
                    //conversionOrExercisePrice:  $trans.find('conversionOrExercisePrice value').text(),
                    transactionCode: $trans.find('transactionCoding transactionCode').text().replace(rgxTrim, ''),
                    formType: $trans.find('transactionCoding transactionFormType').text().replace(rgxTrim, ''),
                    equitySwap: $trans.find('transactionCoding equitySwapInvolved').text().replace(rgxTrim, ''),
                    transactionShares: $trans.find('transactionAmounts transactionShares').text().replace(rgxTrim, ''),
                    transactionPricePerShare: $trans.find('transactionAmounts transactionPricePerShare').text().replace(rgxTrim, ''),
                    transactionAcquiredDisposedCode: $trans.find('transactionAcquiredDisposedCode value').text().replace(rgxTrim, ''),
                    underlyingSecurityTitle: $trans.find('underlyingSecurity underlyingSecurityTitle value').text().replace(rgxTrim, ''),
                    underlyingSecurityShares: $trans.find('underlyingSecurity underlyingSecurityShares value').text().replace(rgxTrim, ''),
                    sharesOwnedFollowingTransaction: $trans.find('postTransactionAmounts sharesOwnedFollowingTransaction value').text().replace(rgxTrim, ''),
                    directOrIndirectOwnership: $trans.find('ownershipNature directOrIndirectOwnership value').text().replace(rgxTrim, ''),
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
                if(remains.length>0) logEvent('nonDerivative remains', submission.urlIndexFile + ': '+ remains)
            });

            if(transactions.length) filing.transactions = transactions;
            //console.log('heap used: ' + Math.round(process.memoryUsage().heapUsed / (1024*1024)) + 'MB');
            save345Submission(filing);
            callback(true);
        }
    });
}


function logEvent(type, msg, display){
    runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
    if(display) console.log(type, msg);
}

function save345Submission(s){
    //save main submission record into insiders and child records to
    var sql = 'INSERT INTO ownership_submission (adsh, form, reportdt, filedt, originalfiledt, issuercik, issuername, symbol, '
        + ' ownercik, ownername, ownerstreet1, ownerstreet2, ownercity, ownerstate, ownerzip, isdirector, isofficer, istenpercentowner, '
        + ' signature, signeddt, remarks, linenum, processnum) '
        + " VALUES (" +q(s.adsh) + q(s.documentType) + q(s.periodOfReport) + q(s.filed) + q(s.dateOfOriginalSubmission)
        + q(s.issuer.cik) + q(s.issuer.name)+q(s.issuer.tradingSymbol)+q(s.reportingOwner.cik)+q(s.reportingOwner.name)
        + q(s.reportingOwner.street1)+q(s.reportingOwner.street2)+q(s.reportingOwner.city)+q(s.reportingOwner.state)
        + q(s.reportingOwner.zip)
        + q(s.reportingOwner.isDirector)+q(s.reportingOwner.isOfficer)+q(s.reportingOwner.isTenPercentOwner)
        + q(s.signatureName)+q(s.signatureDate)+q(s.remarks) + s.lineNum + ',' + s.processNum + ')';
    runQuery(sql);

    //save transaction records
    for(var t=0; t<s.transactions.length;t++){
        var trans = s.transactions[t];
        sql ='INSERT INTO ownership_transaction (adsh, num, isderivative, formtype, security, price, transdt, transcode, equityswap, shares, '
            + ' pricepershare, acquiredisposed, underlyingsecurity, underlyingshares, sharesownedafter,  directindirect, footnotes)'
            + ' value ('+q(s.adsh)+(t+1)+','+trans.derivative+','+q(trans.formType)+ q(trans.securityTitle)+q(trans.conversionOrExercisePrice)
            + q(trans.transactionDate)+q(trans.transactionCode)+q(trans.equitySwap)+q(trans.transactionShares)
            + q(trans.transactionPricePerShare)+ q(trans.transactionAcquiredDisposedCode)+ q(trans.underlyingSecurityTitle)
            + q(trans.underlyingSecurityShares)+ q(trans.sharesOwnedFollowingTransaction)+ q(trans.directOrIndirectOwnership)
            + q(trans.footnotes.join('; '), true) + ')';
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
