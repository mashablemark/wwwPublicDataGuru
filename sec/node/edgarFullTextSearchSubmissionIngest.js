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
const readLine = require('readline');
const common = require('common');  //custom set of common dB & S3 routines used by custom Lambda functions & Node programs
const  AWS = require('aws-sdk');

const region = 'us-east-1';
const domain = 'search-edgar-fts-xej5y74lqs47mkuagdvgnoefbi'; // e.g. search-domain.region.es.amazonaws.com
const endpoint = new AWS.Endpoint(`${domain}.${region}.es.amazonaws.com`);
const index = 'submissions';
const type = '_doc';

//var es = new AWS.ES({apiVersion: '2015-01-01'});

const rgxXML = /<xml>[.\s\S]*<\/xml>/im;
const rgxTags = /<[^>]+>/gm;
const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
const lowChatterMode = true;
var processNum = false;

process.on('message', async (processInfo) => {
    const start = (new Date()).getTime();
    if(processNum && processNum != processInfo.processNum){
        console.log('changing process num from '+processNum + ' to ' + processInfo.processNum);
    }
    processNum = processInfo.processNum;
    const stream = fs.createReadStream(processInfo.path + processInfo.name);
    const readInterface = readLine.createInterface({
        input: stream,
        console: false
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
        jpg: {index: false},
        png: {index: false},
        fil: {index: false},
        xsd: {index: false},  //eg. https://www.sec.gov/Archives/edgar/data/940944/000094094419000005
        js: {index: false}, //show.js in 0000940944-19-000005.nc file
        css: {index: false}, //report.css in 0000940944-19-000005.nc file
        xlsx: {index: false}, //.eg https://www.sec.gov/Archives/edgar/data/0000940944/000094094419000005
        zip: {index: false}, //https://www.sec.gov/Archives/edgar/data/0000940944/000094094419000005
        json: {index: false}, //https://www.sec.gov/Archives/edgar/data/0000940944/000094094419000005


    };
    let lines = [],
        fileMetadata = {};

    readInterface.on('line', function(line){
        if(line=='<DOCUMENT>' && !submissionMetadata){  //process the header  (note:  </SEC-HEADER> is not reliable
            let headerBody = lines.join('\n');
            lines = [];
            submissionMetadata = {
                acceptanceDateTime: headerInfo(headerBody, '<ACCEPTANCE-DATETIME>'),
                adsh: headerInfo(headerBody, '<ACCESSION-NUMBER>'),
                cik: headerInfo(headerBody, '<CIK>'),
                form: headerInfo(headerBody, '<TYPE>'),
                filingDate: headerInfo(headerBody, '<FILING-DATE>'),
                sic: headerInfo(headerBody, '<ASSIGNED-SIC>') || '',
                state: headerInfo(headerBody, '<STATE-OF-INCORPORATION>') || headerInfo(headerBody, '<STATE>')  || '',
                name: headerInfo(headerBody, '<CONFORMED-NAME>'),
                timeStamp: (new Date()).getTime(),
            };
            //console.log(processNum + '- processed submission header');
            //console.log(submissionMetadata);
            if(!submissionMetadata.cik) console.log('failed to detect CIk in submissionMetadata');
        }
        lines.push(line);
        if(line=='</DOCUMENT>'){  //process a component file
            //console.log(processNum + '- processing a submission document');
            //console.log(line);
            lines.pop();
            if(lines.pop()!='</TEXT>') console.log(processNum + '- malformed document');
            let fileHeader = lines.splice(0,6).join('\n');
            fileMetadata = {
                type: headerInfo(fileHeader, '<TYPE>'),
                fileName: headerInfo(fileHeader, '<FILENAME>'),
                description: headerInfo(fileHeader, '<DESCRIPTION>'),
            };
            //console.log(fileHeader);
            //console.log(fileMetadata);

            let ext = fileMetadata.fileName.split('.').pop().toLowerCase().trim();
            if(indexedFileTypes[ext]){
                if(indexedFileTypes[ext].index){
                    let document = {
                        doc_text: indexedFileTypes[ext].process ? indexedFileTypes[ext].process(lines.join('\n')) : lines.join('\n'),
                        cik: submissionMetadata.cik,
                        form: submissionMetadata.form,
                        root_form: submissionMetadata.form.replace('/A',''),
                        filingDate: `${submissionMetadata.filingDate.substr(0,4)}-${submissionMetadata.filingDate.substr(4,2)}-${submissionMetadata.filingDate.substr(6,2)}`,
                        name: submissionMetadata.name,
                        sic: submissionMetadata.sic,
                        adsh: submissionMetadata.adsh,
                        file: fileMetadata.fileName,
                        description: fileMetadata.description,
                    };
                    let request = new AWS.HttpRequest(endpoint, region);

                    request.method = 'PUT';
                    request.path += `${index}/${type}/${submissionMetadata.adsh}_${fileMetadata.fileName}`;
                    request.body = JSON.stringify(document);
                    request.headers['host'] = `${domain}.${region}.es.amazonaws.com`;
                    request.headers['Content-Type'] = 'application/json';
                    // Content-Length is only needed for DELETE requests that include a request body
                    var credentials = new AWS.EnvironmentCredentials('AWS');
                    var signer = new AWS.Signers.V4(request, 'es');
                    //signer.addAuthorization(credentials, new Date());

                    //send to index
                    var client = new AWS.HttpClient();
                    client.handleRequest(request, null, function(response) {
                        //console.log(response.statusCode + ' ' + response.statusMessage);
                        var responseBody = '';
                        response.on('data', function (chunk) {
                            responseBody += chunk;
                        });
                        response.on('end', function (chunk) {
                            try{
                                let esResponse = JSON.parse(responseBody);
                                if(response.statusCode>201 || esResponse._shards.successful!=1 || esResponse._shards.failed!=0){
                                    console.log('Bad response code: ' + response.statusCode + responseBody);
                                } else {
                                    //console.log(request.path);  //for debug only
                                }
                            } catch (e) {
                                console.log(response.statusCode);
                            }
                        });
                    }, function(error) {
                        console.log('Error: ' + error);
                    });
                }
            } else {
                console.log('unrecognized file type of #'+ext+'# for '+ fileMetadata.fileName + ' in ' + submissionMetadata.adsh);
            }
            lines = [];
        }
        if(line=='</SUBMISSION>'){  //clean up
            stream.close();
            let result = {
                status: 'ok',
                cik: fileMetadata.cik,
                form: submissionMetadata.form,
                processNum: processInfo.processNum,
                processTime: (new Date()).getTime()-start,
            };
            //console.log(`indexed form ${result.form} in ${result.processTime}ms`);
            process.send(result);
        }
    });
});


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
