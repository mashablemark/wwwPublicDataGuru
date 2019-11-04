// Called by edgarFullTextSearchBulkIngest as an out of process fork to index a single EDGAR submission's master txt file

// Forked processes allows multiple submissions to be simultaneously parsed in different
// threads while isolating long running edgarFullTextSearchBulkIngest from memory leaks or failures

//after being instantiated via child_process.fork, process awaiting a message containing the filename and path to the master txt file to index
//  1. read  master txt and start building filing object from header:
//      - fileName
//      - path
//      - acceptanceDateTime
//      - adsh
//      - cik(s)
//      - form
//      - filingDate
//  2. skip if adsh already indexed else log submission in db by adsh
//  2. detect html, xml, and txt component files
//      a. strip tags from html and xml files
//      b. index filed (send to ElasticSearch /doc API and await response to avoid overloading)
//  3. when all files are processed, call updateOwnershipAPI's handler function passing in filing object

/*
.txt archive always starts with:
<SEC-DOCUMENT>0001041061-16-000056.txt : 20160216
<SEC-HEADER>0001041061-16-000056.hdr.sgml : 20160215
** SEC header body goes here **
</SEC-HEADER>

the following lines contain the component files delimited by:
<DOCUMENT>
<TYPE>EX-101.LAB
<SEQUENCE>15
<FILENAME>yum-20151226_lab.xml
<DESCRIPTION>XBRL TAXONOMY EXTENSION LABEL LINKBASE DOCUMENT
<TEXT>
** component file body goes here **
</TEXT>
</DOCUMENT>

after the last component file, the .txt archive always ends with
</SEC-DOCUMENT>
 */

const fs = require('fs');
const readline = require('readline');
const common = require('common');  //custom set of common dB & S3 routines used by custom Lambda functions & Node programs

const rgxXML = /<xml>[.\s\S]*<\/xml>/im;
const rgxTags = /<[^>]+>/gm;
const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
const lowChatterMode = true;
process.on('message', async (processInfo) => {
    //console.log('CHILD got message:', processInfo);
    if(processNum && processNum != processInfo.processNum){
        console.log('changing process num from '+processNum + ' to ' + processInfo.processNum);
    }
    processNum = processInfo.processNum;

    const fd = fs.openSync(processInfo.path + processInfo.name, 'r');
    const readInterface = readline.createInterface({
        input: fd
    });


//preprocessors:
    function removeTags(text){return text.replace(rgxTags, ' ')}

    let submissionMetadata = false;
    const indexedFileTypes = {
        htm: {index: true, process: removeTags},
        html: {index: true, process: removeTags},
        xml: {index: true, process: removeTags},
        txt: {index: true},
        pdf: {index: false},  //todo: index PDFs
        gif: {index: false},
        fil: {index: false},
        xsd: {index: false},
    };
    let lineNumber = 0,
        headerReadComplete = false,
        lines = [],
        fileMetadata = {};

    readInterface.on('line', function(line){
        lines.push(line);
        if(line=='</SEC-HEADER>'){  //process the header
            let headerBody = lines.join('\n');
            lines = [];
            submissionMetadata = {
                primaryDocumentName: headerInfo(headerBody, '<FILENAME>'),
                acceptanceDateTime: headerInfo(headerBody, '<ACCEPTANCE-DATETIME>'),
                adsh: headerInfo(headerBody, '<ACCESSION-NUMBER>'),
                cik: headerInfo(headerBody, '<CIK>'),
                form: headerInfo(headerBody, '<TYPE>'),
                filingDate: headerInfo(headerBody, '<FILING-DATE>'),
                timeStamp: now.getTime()
            };
            if(!submissionMetadata.cik) console.log('failed to detect CIk in submissionMetadata');
        }
        if(line=='</DOCUMENT>'){  //process a component file
            lines.pop();
            if(lines.pop()!='</TEXT>') console.log('malformed document');
            let fileHeader = lines.splice(0,6).join('\n');
            let fileMetadata = {
                type: headerInfo(fileHeader, '<TYPE>'),
                fileName: headerInfo(fileHeader, '<FILENAME>'),
                description: headerInfo(fileHeader, '<DESCRIPTION>'),
            };
            let ext = fileMetadata.fileName.split('.').pop().toLowerCase();
            if(indexedFileTypes[ext]){
                if(indexedFileTypes[ext].index){
                    let indexText = indexedFileTypes[ext].process ? indexedFileTypes[ext].process(lines.join('\n')) : lines.join('\n');

                }
            } else {
                console.log('unrecognized file type '+ fileMetadata.fileName + ' in ' + submissionMetadata.adsh);
            }
        }
        if(line=='</SEC-DOCUMENT>'){  //clean up
            fs.closeSync(fd);
            result = {
                status: 'ok',
                cik: fileMetadata.cik,
                form: fileMetadata.form,
                processNum: processInfo.processNum
            };
            process.send(result);
        }

    });



    var MAX_BUFFER = 250 * 1024;  //read first 250kb
    let fileStats = fs.statSync(processInfo.path + processInfo.name),
        //fd = fs.openSync(processInfo.path + processInfo.name, 'r'),
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
                common.con = false;
                console.log('child process disconnected and shutting down');
            }
        });
    }
});
