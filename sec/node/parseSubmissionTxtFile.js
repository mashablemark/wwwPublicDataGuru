// Called by BulkCrawler as an out of process fork to process a single EDGAR submission's master txt file

// Forked processes allows multiple submissions to be simultaneously parsed in different
// threads while isolating long running BulkCrawler from memory leaks or failures

//after being instantiated via child_process.fork, process awaiting a message containing the filem name and path to the master txt file
//  1. read 250k of master txt and start building filing object:
//      - fileName
//      - path
//      - acceptanceDateTime
//      - adsh
//      - cik
//      - form
//      - filingDate
//  2. if 345 form:
//     a.  find and add the following to the filing object:
//      - xmlBody
//      - primaryDocumentName
//     b. augment filing object with:
//      - timeStamp =
//      - files = []
//
//     insert (replace) filings record
//  2. finds and build filing object for updateOwnershipAPI.process345Submission consisting of:
//  4.
//  3. call updateOwnershipAPI's handler function passing in filing object

const fs = require('fs');
//const indexHeaderProcessor = require('./processIndexHeader');
const OwnershipProcessor = require('./updateOwnershipAPI');
const common = require('common');
const rgxXML = /<xml>[.\s\S]*<\/xml>/im;
const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
const lowChatterMode = true;
process.on('message', async (processInfo) => {
    //console.log('CHILD got message:', processInfo);
    if(processNum && processNum != processInfo.processNum){
        console.log('changing process num from '+processNum + ' to ' + processInfo.processNum);
    }
    processNum = processInfo.processNum;

    var MAX_BUFFER = 250 * 1024;  //read first 250kb
    let fileStats = fs.statSync(processInfo.path + processInfo.name),
        fd = fs.openSync(processInfo.path + processInfo.name, 'r'),
        buf = Buffer.alloc(Math.min(MAX_BUFFER, fileStats.size)),
        bytes = fs.readSync(fd, buf, 0, buf.length, 0),
        fileBody = buf.slice(0, bytes).toString(),
        now = new Date(),
        filing = {
            fileName: processInfo.name,
            path: processInfo.path,
            primaryDocumentName: headerInfo(fileBody, '<FILENAME>'),
            acceptanceDateTime: headerInfo(fileBody, '<ACCEPTANCE-DATETIME>'),
            adsh: headerInfo(fileBody, '<ACCESSION-NUMBER>'),
            cik: headerInfo(fileBody, '<CIK>'),
            form: headerInfo(fileBody, '<TYPE>'),
            filingDate: headerInfo(fileBody, '<FILING-DATE>'),
            timeStamp: now.getTime()
        },
        result,
        q = common.q;
    fs.closeSync(fd);

    if(filing.adsh && filing.cik && filing.form && filing.filingDate){
        let sql = 'replace into filings (adsh, cik, form, filedt) values ('+q(filing.adsh)+q(filing.cik)+q(filing.form)+q(filing.filingDate,true)+')';
        await common.runQuery(sql);
        if(OwnershipProcessor.ownershipForms[filing.form]){
            var xmlBody = rgxXML.exec(fileBody);
            //console.log('fileBody.length='+fileBody.length);
            if(xmlBody===null){  //something went wrong in parse process:  log it but continue parse job
                await common.logEvent("unable to find XML in " + filing.fileName,
                    'FIRST 1000 CHARS:  ' + fileBody.substr(0,1000)+ '\nLAST 1000 CHARS: '+ fileBody.substr(-1000,1000), true);
                filing.status = 'error finding XML';
                filing.processNum = processInfo.processNum;
                process.send(filing);
            } else {
                filing.xmlBody = xmlBody[0];
                //console.log(filing.xmlBody);

                filing.noS3Writes = true;
                filing.lowChatterMode = true;
                rootS3Folder
                //MAIN CALL TO LAMBDA CODE:
                result = await OwnershipProcessor.handler(filing);  //big call!!
                result.form = result.documentType;
                result.processNum = processInfo.processNum;
                result.timeStamp = processInfo.timeStamp;
                result.status = 'ok';
            }
        } else {
            result = {
                status: 'ok',
                form: filing.form,
                processNum: processInfo.processNum
            }
        }
        let finished = new Date();
        if(!lowChatterMode) ('child process '+result.processNum +' processed '+(filing.adsh)+' containing form '+result.form + ' in '+ (finished.getTime()-now.getTime())+'ms');
    } else {
        await common.logEvent('ERROR parseSubmissionTstFile: missing header info', processInfo.path + processInfo.name, true);
        result = {
            status: 'data error',
            processNum: processInfo.processNum
        };
    }

process.send(result);
});

var processNum = false;

function headerInfo(fileBody, tag){
    var tagStart = fileBody.indexOf(tag);
    if(tagStart==-1) return false;
    return fileBody.substring(tagStart + tag.length, fileBody.indexOf('\n', tagStart+1)).replace(rgxTrim,'');
}

process.on('disconnect', async () => {
    if(common.con){
        common.con.end((err)=>{
            if(err)
                console.log(err);
            else {
                console.log('closed mysql connection held by parseSubmissionTxtFile (processNum ' +processNum+')');
                common.con = false;
                OwnershipProcessor.close();
                console.log('child process disconnected and shutting down');
            }
        });
    }
});
