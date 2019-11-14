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
const common = require('common');  //custom set of common dB & S3 routines used by custom Lambda functions & Node programs
const  AWS = require('aws-sdk');

const region = 'us-east-1';
const domain = 'search-edgar-wac76mpm2eejvq7ibnqiu24kka'; // e.g. search-domain.region.es.amazonaws.com
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
    var indexedByteCount = 0;
    const start = (new Date()).getTime();
    if(processNum && processNum != processInfo.processNum){
        console.log('changing process num from '+processNum + ' to ' + processInfo.processNum);
    }
    processNum = processInfo.processNum;

    //preprocessors:
    function removeTags(text){return text.replace(rgxTags, ' ').replace(/[\n\s]+/mg,' ')}

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
        paper: {index: false}  //todo: verify paper is not indexable
    };
    const TAGS = {
        DOC: '<DOCUMENT>',

    };
    const STATES = {
        INIT: 1,
        DOC_HEADER: 2,
        DOC_BODY: 3,
        DOC_FOOTER: 4,
        READ_COMPLETE: 5
    };

    let submissionMetadata = {
            entities: [],
            ciks: [],
            names: [],
            incorporationStates: [],
            sics: [],
            displayNames: [],
        },
        entity = false,
        headerLineCount = 0,
        readCount = 0,
        fileMetadata = {},
        ext = false,
        indexableDocumentType = false,  //detect the doc extension up front and don't store lines in lines array for files that aren't indexed
        indexedDocumentCount = 0;

    const stream = fs.createReadStream(processInfo.path + processInfo.name);
    stream
        .on('readable', async function () {
            let state = STATES.INIT,
                chunk,
                chunks = [];
            while (null !== (chunk = stream.read())) {
                console.log(`readCount ${readCount++} (chunk length = ${chunk.length})`);
                chunks.push(chunk);
                let stateChanged = false;
                do {
                    if(state == STATES.INIT) stateChanged = stateChanged || processSubmissionHeaderChunk();
                    if(state == STATES.DOC_HEADER) stateChanged = stateChanged || processDocHeaderChunk();
                    if(state == STATES.DOC_BODY) stateChanged = stateChanged || await processDocChunk();
                } while(stateChanged && state != STATES.READ_COMPLETE && state != STATES.DOC_BODY);
                if(state == STATES.READ_COMPLETE) return;  //exit (stream has already been closed)
            }

            function processSubmissionHeaderChunk(){
                let chunkLine = 0, lineStart = 0, lineEnd, assembledChunks = chunks.join('');
                while(-1 != (lineEnd=assembledChunks.indexOf('\n', lineStart))){  //process one line at a time
                    let tLine = assembledChunks.substring(lineStart, lineEnd).trim();
                    if(tLine=='<COMPANY-DATA>'  ||  tLine=='<OWNER-DATA>') entity = {};
                    if((tLine=='</COMPANY-DATA>'  ||  tLine=='</OWNER-DATA>') && entity && entity.cik) {
                        submissionMetadata.entities.push(entity);
                        if(entity.name) submissionMetadata.names.push(entity.name);
                        if(entity.incorporationState) submissionMetadata.incorporationStates.push(entity.incorporationState);
                        if(entity.sic) submissionMetadata.sics.push(entity.sic);
                        submissionMetadata.displayNames.push(`${entity.name||''} (${entity.cik})`);
                        entity = false;
                    }  //ignores <DEPOSITOR-CIK> && <OWNER-CIK> (see path analysis below)
                    if(tLine.startsWith('<CIK>') && entity) entity.cik = tLine.substr('<CIK>'.length);
                    if(tLine.startsWith('<ASSIGNED-SIC>') && entity) entity.sic = tLine.substr('<ASSIGNED-SIC>'.length);
                    if(tLine.startsWith('<STATE-OF-INCORPORATION>') && entity) entity.incorporationState = tLine.substr('<STATE-OF-INCORPORATION>'.length);
                    if(tLine.startsWith('<CONFORMED-NAME>') && entity) entity.name = tLine.substr('<CONFORMED-NAME>'.length);

                    if(tLine.startsWith('<TYPE>')) submissionMetadata.form = tLine.substr('<TYPE>'.length);
                    if(tLine.startsWith('<FILING-DATE>')) submissionMetadata.filingDate = tLine.substr('<FILING-DATE>'.length);
                    if(tLine.startsWith('<ACCEPTANCE-DATETIME>')) submissionMetadata.acceptanceDateTime = tLine.substr('<ACCEPTANCE-DATETIME>'.length);
                    if(tLine.startsWith('<ACCESSION-NUMBER>')) submissionMetadata.adsh = tLine.substr('<ACCESSION-NUMBER>'.length);
                    if(tLine.startsWith('<CIK>')) submissionMetadata.cik = tLine.substr('<CIK>'.length);
                    lineStart = lineEnd+1;
                    //console.log(headerLineCount++, chunkLine++, tLine);
                    if(tLine == '<DOCUMENT>'){
                        console.log(submissionMetadata);
                        state = STATES.DOC_HEADER;
                        break;
                    }
                }
                if(assembledChunks.length>lineEnd)
                    chunks = [assembledChunks.substr(lineEnd+1)];
                else
                    chunks = [];
                return (state == STATES.DOC_HEADER);  //true is state advanced
            }

            function processDocHeaderChunk(){
                console.log('processDocHeaderChunk');
                let docHeaderLineCount = 0,
                    lineStart = 0,
                    lineEnd,
                    assembledChunks = chunks.join(''); //the header is small enough to fully assemble each pass (not so with document bodies!)
                while(-1 != (lineEnd=assembledChunks.indexOf('\n'))) { //found a line to process
                    let tLine = assembledChunks.substring(lineStart, lineEnd).trim();
                    console.log(docHeaderLineCount++, tLine);
                    if(tLine.startsWith('</SUBMISSION>')) {
                        stream.close();
                        let result = {
                            status: 'ok',
                            entities: submissionMetadata.entities,
                            form: submissionMetadata.form,
                            adsh: submissionMetadata.adsh,
                            indexedDocumentCount: indexedDocumentCount,
                            indexedByteCount: indexedByteCount,
                            processNum: processInfo.processNum,
                            processTime: (new Date()).getTime()-start,
                        };
                        console.log(`indexed form ${result.form} in ${result.processTime}ms`);
                        console.log(result);
                        process.send(result);
                        state = STATES.READ_COMPLETE;
                        return true;
                    }
                    if(tLine.startsWith('<TYPE>')) fileMetadata.type = tLine.substr('<TYPE>'.length);
                    if(tLine.startsWith('<FILENAME>')) {
                        fileMetadata.fileName = tLine.substr('<FILENAME>'.length);
                        ext = fileMetadata.fileName.split('.').pop().toLowerCase().trim();
                        if(indexedFileTypes[ext]){
                            indexableDocumentType = indexedFileTypes[ext].index;
                        } else {
                            indexableDocumentType = false;
                            console.log('unrecognized file type of #'+ext+'# for '+ fileMetadata.fileName + ' in ' + submissionMetadata.adsh);
                        }
                    }
                    if(tLine.startsWith('<DESCRIPTION>')) fileMetadata.description = tLine.substr('<DESCRIPTION>'.length);
                    if(tLine == '<TEXT>'){
                        state = STATES.DOC_BODY;
                        break;
                    }
                    if(docHeaderLineCount==10) process.exit();
                }
                if(assembledChunks.length>lineEnd && indexableDocumentType)
                    chunks = [assembledChunks.substr(lineEnd+1)];
                else
                    chunks = [];
                return (state == STATES.DOC_BODY);  //true is state advanced
            }

            async function processDocChunk(){
                const endTags = '\n</TEXT>\n</DOCUMENT>\n';
                let endTagPosInPartial, endTagPosInFull, partialAssembly, fullAssembly;
                if(chunks.length>1){
                    partialAssembly = chunks[chunks.length-2] + chunks[chunks.length-1]
                } else {
                    partialAssembly = chunks[0];
                }
                if(-1 == (endTagPosInPartial = partialDoc.indexOf(endTags))){
                    if(!indexableDocumentType) chunks.pop();  //don't keep internal chunks of documents that will not be indexed
                } else {
                    if(indexableDocumentType) {
                        //THIS IS THE POINT OF THE WHOLE ROUTINE:  TO ISOLATE AN INDEXABLE DOCUMENT!!!
                        console.log(`P${processNum} about to index a doc`);
                        const startIndexingTime = (new Date()).getTime();
                        await new Promise((resolve, reject) => {
                            if(chunks.length > 2) {
                                fullAssembly = chunks.join('');
                                endTagPosInFull = fullAssembly.indexOf(endTags);
                            }
                            let document = {
                                doc_text: chunks.length > 2 ? //goal of awkward definition is to not create any more copies of large doc string than necessary
                                    (indexedFileTypes[ext].process ? indexedFileTypes[ext].process(fullAssembly.substr(0,endTagPosInFull)) : fullAssembly.substr(0,endTagPos)) :
                                    (indexedFileTypes[ext].process ? indexedFileTypes[ext].process(partialAssembly.substr(0, endTagPosInPartial)) : partialAssembly.substr(0, endTagPos)),
                                ciks: submissionMetadata.ciks,
                                form: submissionMetadata.form,
                                root_form: submissionMetadata.form.replace('/A', ''),
                                filingDate: `${submissionMetadata.filingDate.substr(0, 4)}-${submissionMetadata.filingDate.substr(4, 2)}-${submissionMetadata.filingDate.substr(6, 2)}`,
                                display_names: submissionMetadata.displayNames,
                                sics: submissionMetadata.sics,
                                inc_states: submissionMetadata.incorporationStates,
                                adsh: submissionMetadata.adsh,
                                file: fileMetadata.fileName,
                                description: fileMetadata.description,
                            };
                            let request = new AWS.HttpRequest(endpoint, region);
                            request.method = 'PUT';
                            request.path += `${index}/${type}/${submissionMetadata.adsh}:${fileMetadata.fileName}`;
                            request.body = JSON.stringify(document);
                            request.headers['host'] = `${domain}.${region}.es.amazonaws.com`;
                            request.headers['Content-Type'] = 'application/json';
                            // Content-Length is only needed for DELETE requests that include a request body
                            var credentials = new AWS.EnvironmentCredentials('AWS');
                            var signer = new AWS.Signers.V4(request, 'es');
                            //signer.addAuthorization(credentials, new Date());

                            //send to index
                            var client = new AWS.HttpClient();
                            const doc_textLength = document.doc_text.length; //avoid closure below
                            client.handleRequest(request, null, function (response) {
                                //console.log(response.statusCode + ' ' + response.statusMessage);
                                var responseBody = '';
                                response.on('data', function (chunk) {
                                    responseBody += chunk;
                                });
                                response.on('end', function (chunk) {
                                    try {
                                        let esResponse = JSON.parse(responseBody);
                                        if (response.statusCode > 201 || esResponse._shards.failed != 0) {
                                            console.log('Bad response. statusCode: ' + response.statusCode);
                                            console.log(responseBody);
                                        } else {
                                            indexedByteCount = indexedByteCount + (doc_textLength || 0);
                                            indexedDocumentCount++;
                                        }
                                    } catch (e) {
                                        console.log(response.statusCode);
                                    }
                                    resolve(true);
                                });
                            }, function (error) {
                                console.log('Error: ' + error);
                                resolve(error);
                            });
                        });
                        //while we are waiting for ElasticSearch callback, check free heap size and collect garbage if heap > 1GB free
                        let memoryUsage = process.memoryUsage();  //returns memory in KB for: {rss, heapTotal, heapUsed, external}
                        if (memoryUsage.heapUsed > 1.5 * 1024 * 1024 * 1024) runGarbageCollection(processInfo); //if more than 1.5GB used (out of 3GB)
                        //readInterface.resume();
                        console.log(`P${processNum} indexed a doc in ${(new Date()).getTime() - startIndexingTime}ms`);
                    }

                    if(chunks.length>2)
                        chunks = partialAssembly.length>=endTagPosInPartial+endTags.length ? [partialAssembly.substr(endTagPosInPartial+endTags.length)] :'';
                    else
                        chunks = fullAssembly.length>=endTagPosInPartial+endTags.length ? [fullAssembly.substr(endTagPosInPartial+endTags.length)] : '';
                    state = STATES.DOC_HEADER;
                }
                return (state == STATES.DOC_HEADER);  //true is state advanced
            }
        })
        .on('end', function () {
            let result = {
                status: 'ok',
                entities: submissionMetadata.entities,
                form: submissionMetadata.form,
                adsh: submissionMetadata.adsh,
                indexedDocumentCount: indexedDocumentCount,
                indexedByteCount: indexedByteCount,
                processNum: processInfo.processNum,
                processTime: (new Date()).getTime()-start,
            };
            //console.log(`indexed form ${result.form} in ${result.processTime}ms`);
            //console.log(result);
            process.send(result);
        });
});

//used to analyze SGL path across all filing to ensure compliance
function findPaths(headerLines, partialPropertyTag, paths){
    headerLines.forEach((headerLine, index,)=>{
        if(headerLine.indexOf(partialPropertyTag) != -1 && headerLine.substr(0,2)!='</'){  //find path back to <SUBMISSION>
            let path = [headerLine.split('>')[0]+'>'];
            for(let i=index-1;i>=0;i--){
                if(headerLines[i].substr(headerLines[i].length-1)=='>'){ //section start or end tag
                    if(headerLines[i].substr(0,2)=='</'){
                        path.push(headerLines[i]);
                    } else {
                        if(headerLines[i].substr(1) == path[path.length-1].substr(2)){
                            path.pop(); //matching opening and closing tags
                        } else {
                            path.push(headerLines[i]);
                        }
                    }
                }
            }
            path = path.join(':');
            paths[path] = (paths[path] || 0) + 1;
        }
    });
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

function runGarbageCollection(processInfo){
    if(global.gc) {
        console.log(process.memoryUsage());
        console.log(`low memory detected in P${processInfo.processNum} while ingesting ${processInfo.name} => collecting garbage...`);
        global.gc();
        console.log(process.memoryUsage());
    } else console.log('global.gc not set');
}

/*  paths found:  <CIK> in <COMPANY-DATA> or <OWNER-DATA>;
0: "<SUBMISSION>:<CONFIRMING-COPY>:<FILED-BY>:<COMPANY-DATA>:<ASSIGNED-SIC>"
1: "<SUBMISSION>:<CONFIRMING-COPY>:<FILED-BY>:<COMPANY-DATA>:<CIK>"
2: "<SUBMISSION>:<CONFIRMING-COPY>:<FILED-BY>:<COMPANY-DATA>:<CONFORMED-NAME>"
3: "<SUBMISSION>:<CONFIRMING-COPY>:<FILED-BY>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
4: "<SUBMISSION>:<CONFIRMING-COPY>:<FILER>:<COMPANY-DATA>:<ASSIGNED-SIC>"
5: "<SUBMISSION>:<CONFIRMING-COPY>:<FILER>:<COMPANY-DATA>:<CIK>"
6: "<SUBMISSION>:<CONFIRMING-COPY>:<FILER>:<COMPANY-DATA>:<CONFORMED-NAME>"
7: "<SUBMISSION>:<CONFIRMING-COPY>:<FILER>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
8: "<SUBMISSION>:<CONFIRMING-COPY>:<FILER>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
9: "<SUBMISSION>:<CONFIRMING-COPY>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<ASSIGNED-SIC>"
10: "<SUBMISSION>:<CONFIRMING-COPY>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<CIK>"
11: "<SUBMISSION>:<CONFIRMING-COPY>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<CONFORMED-NAME>"
12: "<SUBMISSION>:<CONFIRMING-COPY>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
13: "<SUBMISSION>:<CONFIRMING-COPY>:<SUBJECT-COMPANY>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
14: "<SUBMISSION>:<DEPOSITOR-CIK>"
15: "<SUBMISSION>:<DEPOSITOR>:<COMPANY-DATA>:<ASSIGNED-SIC>"
16: "<SUBMISSION>:<DEPOSITOR>:<COMPANY-DATA>:<CIK>"
17: "<SUBMISSION>:<DEPOSITOR>:<COMPANY-DATA>:<CONFORMED-NAME>"
18: "<SUBMISSION>:<DEPOSITOR>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
19: "<SUBMISSION>:<DEPOSITOR>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
20: "<SUBMISSION>:<FILED-BY>:<COMPANY-DATA>:<ASSIGNED-SIC>"
21: "<SUBMISSION>:<FILED-BY>:<COMPANY-DATA>:<CIK>"
22: "<SUBMISSION>:<FILED-BY>:<COMPANY-DATA>:<CONFORMED-NAME>"
23: "<SUBMISSION>:<FILED-BY>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
24: "<SUBMISSION>:<FILED-BY>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
25: "<SUBMISSION>:<FILER>:<COMPANY-DATA>:<ASSIGNED-SIC>"
26: "<SUBMISSION>:<FILER>:<COMPANY-DATA>:<CIK>"
27: "<SUBMISSION>:<FILER>:<COMPANY-DATA>:<CONFORMED-NAME>"
28: "<SUBMISSION>:<FILER>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
29: "<SUBMISSION>:<FILER>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
30: "<SUBMISSION>:<ISSUER>:<COMPANY-DATA>:<ASSIGNED-SIC>"
31: "<SUBMISSION>:<ISSUER>:<COMPANY-DATA>:<CIK>"
32: "<SUBMISSION>:<ISSUER>:<COMPANY-DATA>:<CONFORMED-NAME>"
33: "<SUBMISSION>:<ISSUER>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
34: "<SUBMISSION>:<ISSUER>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
35: "<SUBMISSION>:<ISSUING-ENTITY-NAME>"
36: "<SUBMISSION>:<ISSUING_ENTITY>:<COMPANY-DATA>:<ASSIGNED-SIC>"
37: "<SUBMISSION>:<ISSUING_ENTITY>:<COMPANY-DATA>:<CIK>"
38: "<SUBMISSION>:<ISSUING_ENTITY>:<COMPANY-DATA>:<CONFORMED-NAME>"
39: "<SUBMISSION>:<ISSUING_ENTITY>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
40: "<SUBMISSION>:<REPORTING-OWNER>:<COMPANY-DATA>:<ASSIGNED-SIC>"
41: "<SUBMISSION>:<REPORTING-OWNER>:<COMPANY-DATA>:<CIK>"
42: "<SUBMISSION>:<REPORTING-OWNER>:<COMPANY-DATA>:<CONFORMED-NAME>"
43: "<SUBMISSION>:<REPORTING-OWNER>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
44: "<SUBMISSION>:<REPORTING-OWNER>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
45: "<SUBMISSION>:<REPORTING-OWNER>:<FORMER-NAME>"
46: "<SUBMISSION>:<REPORTING-OWNER>:<FORMER-NAME>:<FORMER-CONFORMED-NAME>"
47: "<SUBMISSION>:<REPORTING-OWNER>:<OWNER-DATA>:<ASSIGNED-SIC>"
48: "<SUBMISSION>:<REPORTING-OWNER>:<OWNER-DATA>:<CIK>"
49: "<SUBMISSION>:<REPORTING-OWNER>:<OWNER-DATA>:<CONFORMED-NAME>"
50: "<SUBMISSION>:<REPORTING-OWNER>:<OWNER-DATA>:<STATE-OF-INCORPORATION>"
51: "<SUBMISSION>:<SECURITIZER>:<COMPANY-DATA>:<ASSIGNED-SIC>"
52: "<SUBMISSION>:<SECURITIZER>:<COMPANY-DATA>:<CIK>"
53: "<SUBMISSION>:<SECURITIZER>:<COMPANY-DATA>:<CONFORMED-NAME>"
54: "<SUBMISSION>:<SECURITIZER>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
55: "<SUBMISSION>:<SECURITIZER>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"
56: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<EXISTING-SERIES-AND-CLASSES-CONTRACTS>:<SERIES>:<CLASS-CONTRACT>:<CLASS-CONTRACT-NAME>"
57: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<EXISTING-SERIES-AND-CLASSES-CONTRACTS>:<SERIES>:<OWNER-CIK>"
58: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<EXISTING-SERIES-AND-CLASSES-CONTRACTS>:<SERIES>:<SERIES-NAME>"
59: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<MERGER-SERIES-AND-CLASSES-CONTRACTS>:<MERGER>:<ACQUIRING-DATA>:<CIK>"
60: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<MERGER-SERIES-AND-CLASSES-CONTRACTS>:<MERGER>:<ACQUIRING-DATA>:<SERIES>:<CLASS-CONTRACT>:<CLASS-CONTRACT-NAME>"
61: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<MERGER-SERIES-AND-CLASSES-CONTRACTS>:<MERGER>:<ACQUIRING-DATA>:<SERIES>:<SERIES-NAME>"
62: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<MERGER-SERIES-AND-CLASSES-CONTRACTS>:<MERGER>:<TARGET-DATA>:<CIK>"
63: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<MERGER-SERIES-AND-CLASSES-CONTRACTS>:<MERGER>:<TARGET-DATA>:<SERIES>:<CLASS-CONTRACT>:<CLASS-CONTRACT-NAME>"
64: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<MERGER-SERIES-AND-CLASSES-CONTRACTS>:<MERGER>:<TARGET-DATA>:<SERIES>:<SERIES-NAME>"
65: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<NEW-SERIES-AND-CLASSES-CONTRACTS>:<NEW-CLASSES-CONTRACTS>:<CLASS-CONTRACT>:<CLASS-CONTRACT-NAME>"
66: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<NEW-SERIES-AND-CLASSES-CONTRACTS>:<NEW-CLASSES-CONTRACTS>:<SERIES-NAME>"
67: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<NEW-SERIES-AND-CLASSES-CONTRACTS>:<NEW-SERIES>:<CLASS-CONTRACT>:<CLASS-CONTRACT-NAME>"
68: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<NEW-SERIES-AND-CLASSES-CONTRACTS>:<NEW-SERIES>:<SERIES-NAME>"
69: "<SUBMISSION>:<SERIES-AND-CLASSES-CONTRACTS-DATA>:<NEW-SERIES-AND-CLASSES-CONTRACTS>:<OWNER-CIK>"
70: "<SUBMISSION>:<SPONSOR-CIK>"
71: "<SUBMISSION>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<ASSIGNED-SIC>"
72: "<SUBMISSION>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<CIK>"
73: "<SUBMISSION>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<CONFORMED-NAME>"
74: "<SUBMISSION>:<SUBJECT-COMPANY>:<COMPANY-DATA>:<STATE-OF-INCORPORATION>"
75: "<SUBMISSION>:<SUBJECT-COMPANY>:<FORMER-COMPANY>:<FORMER-CONFORMED-NAME>"

 */