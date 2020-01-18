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
const common = require('common.js');  //custom set of common dB & S3 routines used by custom Lambda functions & Node programs
//const pdfUtil = require('pdf-to-text'); //only extracts from file; can't pass in string
const AWS = require('aws-sdk');

const region = 'us-east-1';
const domain = 'search-edgar-wac76mpm2eejvq7ibnqiu24kka'; // e.g. search-domain.region.es.amazonaws.com
const endpoint = new AWS.Endpoint(`${domain}.${region}.es.amazonaws.com`);
const index = 'submissions';
const type = '_doc';

//const es = new AWS.ES({apiVersion: '2015-01-01'});
const rgxXML = /<xml>[.\s\S]*<\/xml>/im;
const rgxTagsAndExtraSpaces = /([\n\s]*<[^>]+>[\n\s]*|[\n\s]{2,})+/gm;  //removes html and xml tags and extra white space
const rgxTagsExtraSpacesAndNumbers = /([\n\s]*(<[^>]+>|[\n\s]{2,}|-?\$?-?\b[0-9,\.]+\b)[\n\s]*)+/gm;  //removes number words (but not alphanumeric words!) in addition to html and xml tags and extra white space
const rgxEncodedTagsExtraSpacesAndNumbers =/([\n\s]*(&lt;.+?&gt;|<[^>]+>|[\n\s]{2,}|-?\$?-?\b[0-9,\.]+\b)[\n\s]*)+/gm;;  //removes number words (but not alphanumeric words!) in addition to html and xml tags and html encoded tags embedded in XML values and extra white space
const rgxExtraSpaces = /[\n\s]{2,}/mg;
const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
const lowChatterMode = true;
const READ_STATES = {
        INIT: 'INIT',
        DOC_HEADER: 'HEAD',
        DOC_BODY: 'BODY',
        DOC_FOOTER: 'FOOTER',
        READ_COMPLETE: 'READ_COMPLETE',
        MESSAGED_PARENT: 'MESSAGED_PARENT',
    };
const INDEX_STATES = {  //can't collide with READ_STATES!
        FREE: 'FREE',
        INDEXING: 'INDEXING',
        INDEXED: 'INDEXED',
        SKIPPED: 'SKIPPED',
        INDEX_FAILED: 'INDEX_FAILED',
    };
var processNum = false;
var submission;
let submissionCount = 0;
let processStart = (new Date()).getTime();
let start;

process.on('message', (processInfo) => {
    //debug: console.log('child get the message:', processInfo);
    let indexedByteCount = 0;
    submissionCount++;
    start = (new Date()).getTime();
    //if(!processNum)console.log('starting up process '+processInfo.processNum);
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
    function removeTags(text){return text.replace(rgxTagsExtraSpacesAndNumbers, ' ');}
    function decodeAndRemoveTags(text){return text.replace(rgxEncodedTagsExtraSpacesAndNumbers, ' ');}

    const indexedFileTypes = {
        htm: {indexable: true, process: removeTags},
        html: {indexable: true, process: removeTags},
        xml: {indexable: true, process: decodeAndRemoveTags},
        txt: {indexable: true},
        pdf: {indexable: false},  //todo: indexable PDFs
        gif: {indexable: false},
        jpg: {indexable: false},
        png: {indexable: false},
        fil: {indexable: false},
        xsd: {indexable: false},  //eg. https://www.sec.gov/Archives/edgar/data/940944/000094094419000005
        js: {indexable: false}, //show.js in 0000940944-19-000005.nc file
        css: {indexable: false}, //report.css in 0000940944-19-000005.nc file
        xlsx: {indexable: false}, //.eg https://www.sec.gov/Archives/edgar/data/0000940944/000094094419000005
        zip: {indexable: false}, //https://www.sec.gov/Archives/edgar/data/0000940944/000094094419000005
        json: {indexable: false}, //https://www.sec.gov/Archives/edgar/data/0000940944/000094094419000005
        paper: {indexable: false}  //todo: verify paper is not indexable
    };
    submission = { //module level scope to be able to report out when killed
        entities: [],
        ciks: [],
        names: [],
        incorporationStates: [],
        businessStates: [],
        businessLocations: [],
        sics: [],
        displayNames: [],
        docs: [],
        readState: READ_STATES.INIT,
        indexState: INDEX_STATES.FREE,
        indexed: false,
    };
    const indexPromises = [];
    let entity,
        address,
        ext = false,
        indexedDocumentCount = 0;

    readInterface.on('line', async function(line) {
        let tLine = line.trim();
        //console.log(submission.readState, tLine);
        if (submission.readState == READ_STATES.INIT) { //still reading it in
            if (tLine == '<COMPANY-DATA>' || tLine == '<OWNER-DATA>') entity = {};
            if ((tLine == '</COMPANY-DATA>' || tLine == '</OWNER-DATA>') && entity.cik) {
                submission.entities.push(entity);
                if (entity.name) submission.names.push(entity.name);
                if (entity.incorporationState && entity.incorporationState.toString().length==2
                    && submission.incorporationStates.indexOf(entity.incorporationState)==-1) submission.incorporationStates.push(entity.incorporationState);
                if (entity.sic && submission.sics.indexOf(entity.sic)==-1) submission.sics.push(entity.sic);
                if(submission.ciks.indexOf(entity.cik) == -1) submission.ciks.push(entity.cik);
                let displayName = `${entity.name || ''} (${entity.cik})`;
                if(submission.displayNames.indexOf(displayName)==-1) submission.displayNames.push(displayName);
            }  //ignores <DEPOSITOR-CIK> && <OWNER-CIK> (see path analysis below)
            if (tLine.startsWith('<CIK>')) entity.cik = tLine.substr('<CIK>'.length);
            if (tLine.startsWith('<ASSIGNED-SIC>')) entity.sic = tLine.substr('<ASSIGNED-SIC>'.length);
            if (tLine.startsWith('<STATE-OF-INCORPORATION>')) entity.incorporationState = tLine.substr('<STATE-OF-INCORPORATION>'.length);
            if (tLine.startsWith('<CONFORMED-NAME>')) entity.name = tLine.substr('<CONFORMED-NAME>'.length);

            if (tLine == '<BUSINESS-ADDRESS>' || tLine == '<MAIL-ADDRESS>') address = {};
            if (tLine == '</BUSINESS-ADDRESS>') entity.mailingAddress = address;
            if (tLine == '</MAIL-ADDRESS>') entity.businessAddress = address;

            if (tLine.startsWith('<STATE>')) address.state = tLine.substr('<STATE>'.length);
            if (tLine.startsWith('<CITY>')) address.city = tLine.substr('<CITY>'.length);


            if (tLine.startsWith('<TYPE>')) submission.form = tLine.substr('<TYPE>'.length).toUpperCase();
            if (tLine.startsWith('<FILING-DATE>')) submission.filingDate = tLine.substr('<FILING-DATE>'.length);
            if (tLine.startsWith('<ACCEPTANCE-DATETIME>')) submission.acceptanceDateTime = tLine.substr('<ACCEPTANCE-DATETIME>'.length);
            if (tLine.startsWith('<ACCESSION-NUMBER>')) submission.adsh = tLine.substr('<ACCESSION-NUMBER>'.length);
            if (tLine.startsWith('<FILE-NUMBER>')) submission.fileNumber = tLine.substr('<FILE-NUMBER>'.length);
            if (tLine.startsWith('<FILM-NUMBER>')) submission.filmNumber = tLine.substr('<FILM-NUMBER>'.length);
            if (tLine == '<DOCUMENT>') {
                for(let i=0;i<submission.entities.length;i++){
                    let e = submission.entities[i];
                    submission.businessStates.push( e.businessAddress ? e.businessAddress.state : (e.mailingAddress ? e.mailingAddress.state : null));
                    submission.businessLocations.push((e.businessAddress ? e.businessAddress.city + ' ' + edgarLocations[e.businessAddress.state] : null)
                        || (e.mailingAddress ? e.mailingAddress.city + ' ' + edgarLocations[e.mailingAddress.state] : null));
                }
                submission.readState = READ_STATES.DOC_HEADER;
            }
        }

        if (submission.readState == READ_STATES.DOC_FOOTER) { //ordered above the DOC_HEADER processing section to <DOCUMENT> in both
            if (tLine == '<DOCUMENT>') submission.readState = READ_STATES.DOC_HEADER;
            if (tLine == '</SUBMISSION>') submission.readState = READ_STATES.READ_COMPLETE;
        }

        if (submission.readState == READ_STATES.DOC_BODY) {  //ordered above the DOC_HEADER processing section to avoid fall through of <TEXT>
            const d = submission.docs.length - 1;
            if (tLine == '</TEXT>') {
                submission.readState = READ_STATES.DOC_FOOTER;
                submission.docs[d].state = READ_STATES.READ_COMPLETE;
                //file complete; send to ElasticSearch if not already processing a previous file
                if(submission.indexState == INDEX_STATES.FREE) { //will only be free if all existing indexable doc have been indexed;
                    indexPromises.push(indexWithElasticSearch(d));
                }
            } else {
                if (submission.docs[d].lines && tLine.length) { //determined above to have a valid ext and be indexable (and not blank)
                    submission.docs[d].lengthRaw += tLine.length;
                    const fileTypeProcessor = indexedFileTypes[submission.docs[d].fileExtension].process;
                    let processedLine = fileTypeProcessor ? fileTypeProcessor(tLine).trim() : tLine;
                    if(processedLine.length) submission.docs[d].lines.push(processedLine);
                }
            }
        }

        if (submission.readState == READ_STATES.DOC_HEADER) {
            if (tLine == '<DOCUMENT>') {
                submission.docs.push({
                    lengthRaw: 0,
                    lengthIndexed: 0,
                    fileName: null,
                    fileDescription: null,
                    fileType: null,
                    fileExtension: null
                });
                //console.log(`created doc #${submission.docs.length}`);
            } else {
                const d = submission.docs.length - 1;
                if (tLine.startsWith('<TYPE>')) submission.docs[d].fileType = tLine.substr('<TYPE>'.length);
                if (tLine.startsWith('<FILENAME>')) {
                    submission.docs[d].fileName = tLine.substr('<FILENAME>'.length);
                    submission.docs[d].fileExtension = submission.docs[d].fileName.split('.').pop().toLowerCase().trim();
                    if (indexedFileTypes[submission.docs[d].fileExtension]) {
                        if (indexedFileTypes[submission.docs[d].fileExtension].indexable) submission.docs[d].lines = [];
                    } else {
                        console.log(`unrecognized file type of #${submission.docs[d].fileExtension}# for ${submission.docs[d].fileName} in ${submission.adsh}`);
                    }
                }
                if (tLine.startsWith('<DESCRIPTION>')) submission.docs[d].fileDescription = tLine.substr('<DESCRIPTION>'.length);
                if (tLine.startsWith('<SEQUENCE>')) submission.docs[d].fileSequence = tLine.substr('<SEQUENCE>'.length);
                if (tLine == '<TEXT>') {
                    submission.readState = READ_STATES.DOC_BODY;
                    if(submission.docs[d].fileDescription == 'IDEA: XBRL DOCUMENT')submission.docs[d].lines = false; //don't index the DERA docs
                }
            }
        }
        if (submission.readState == READ_STATES.READ_COMPLETE) {
            const d = submission.docs.length - 1;
            if(submission.indexed == d && (submission.docs[d].state == INDEX_STATES.INDEXED || submission.docs[d].state == INDEX_STATES.SKIPPED || submission.docs[d].state == INDEX_STATES.INDEX_FAILED )){
                messageParentFinished('ok');
            }
        }
    });

    async function indexWithElasticSearch(d) {
        if(submission.docs[d].state == READ_STATES.READ_COMPLETE){
            submission.indexState = INDEX_STATES.INDEXING;
            submission.indexed = d;
            let indexedText;
            if(submission.docs[d].lines && submission.docs[d].lines.length){
                const fileTypeProcessor = indexedFileTypes[submission.docs[d].fileExtension].process;
                indexedText = fileTypeProcessor ? fileTypeProcessor(submission.docs[d].lines.join('\n')) : submission.docs[d].lines.join('\n');
                submission.docs[d].lengthIndexed = indexedText.length;
            }
            if(submission.docs[d].lengthIndexed && submission.docs[d].lengthIndexed > 1){ //skipp
                submission.docs[d].lengthRaw += submission.docs[d].lines.length;  //account for carriage returns
                submission.docs[d].state = INDEX_STATES.INDEXING;
                readInterface.pause();  //does not immediately stop the line events.  A few more might come, but this stops the torrent
                let doc_textLength = 0;
                //console.log(submission.docs[d].lines);
                for(let i=0;i<submission.docs[d].lines.length;i++) doc_textLength += submission.docs[d].lines[i].length;
                //console.log(`P${processNum} about to index a doc`);
                const startIndexingTime = (new Date()).getTime();
                let request = new AWS.HttpRequest(endpoint, region);

                request.method = 'PUT';
                request.path += `${index}/${type}/${submission.adsh}:${submission.docs[d].fileName}`;
                request.body = JSON.stringify({  //try not to create unnecessary copies of the document text in memory
                    doc_text: indexedText,
                    //adsh: submission.adsh,  //embedded in ID = REDUNDANT FIELD
                    //file_name: submission.docs[d].fileName,  //embedded in ID = REDUNDANT FIELD
                    display_names: submission.displayNames,
                    file_description: submission.docs[d].fileDescription,
                    file_type: submission.docs[d].fileType,
                    film_num: submission.docs[d].filmNumber,
                    file_num: submission.docs[d].fileNumber,
                    file_date: `${submission.filingDate.substr(0, 4)}-${submission.filingDate.substr(4, 2)}-${submission.filingDate.substr(6, 2)}`,
                    sics: submission.sics,
                    ciks: submission.ciks,
                    form: submission.form,
                    root_form: submission.form.replace('/A',''),
                    inc_states: submission.incorporationStates,
                    biz_states: submission.businessStates, //searchable
                    biz_locations:  submission.businessLocations,  //for display; not searchable
                });
                //console.log(JSON.parse(request.body));
                request.headers['host'] = `${domain}.${region}.es.amazonaws.com`;
                request.headers['Content-Type'] = 'application/json';
                // Content-Length is only needed for DELETE requests that include a request body
                var credentials = new AWS.EnvironmentCredentials('AWS');
                var signer = new AWS.Signers.V4(request, 'es');
                //signer.addAuthorization(credentials, new Date());

                //send to index
                let client = new AWS.HttpClient();
                //initialize/reinitialize file record
                let q = (val) => { return common.q(val, true) };  //clean sql string and add quote (no following comma)
                await common.runQuery(`insert into efts_submissions_files (adsh, sequence, filename, length_raw, length_indexed, name, description) 
                          values (${q(submission.adsh)}, ${submission.docs[d].fileSequence}, ${q(submission.docs[d].fileName)}, ${submission.docs[d].lengthRaw}, 
                          ${submission.docs[d].lengthIndexed}, ${q(submission.docs[d].fileType)}, ${q(submission.docs[d].fileDescription)})
                          on duplicate key update last_indexed = null, tries=tries+1`);
                client.handleRequest(request, {connectTimeout: 1000, timeout: 55000}, function(response) {
                    //console.log(response.statusCode + ' ' + response.statusMessage);
                    let chunks = [];
                    response.on('data', function (chunk) {
                        chunks.push(chunk);
                    });
                    response.on('end', async function (chunk) {
                        if(chunk) chunks.push(chunk);
                        try{
                            let responseBody = chunks.join('');
                            let esResponse = JSON.parse(responseBody);
                            if(response.statusCode>201 || esResponse._shards.failed!=0){
                                console.log('Bad response. statusCode: ' + response.statusCode);
                                console.log(responseBody + ' for ' + submission.docs[d].fileName + ' in ' + submission.adsh);
                                request.bodyTuncated = request.body.substr(0,2000);
                                delete request.body;
                                await common.logEvent('failed ElasticSearch index', JSON.stringify(request), true);
                            } else {
                                if(submission.docs[d].tries) console.log('success on retry #'+submission.docs[d].tries);
                                await common.runQuery(`update efts_submissions_files  set last_indexed = now()
                                    where adsh=${q(submission.adsh)} and sequence=${submission.docs[d].fileSequence}`);
                                indexedByteCount = indexedByteCount + (doc_textLength || 0);
                                indexedDocumentCount++;
                            }
                        } catch (e) {
                            request.bodyTuncated = request.body.substr(0,2000);
                            delete request.body;
                            request.responseCode = response.statusCode;
                            await common.logEvent('ElasticSearch index error', JSON.stringify(request), true);
                        }
                        submission.docs[d].state = INDEX_STATES.INDEXED;
                        //the file record already written above; setting the last_indexed timestamp (from NULL) indicates success
                        nextDoc();
                    });
                }, function(error) {
                    console.log('Error sending data to ES: ' + error);
                    submission.docs[d].state = INDEX_STATES.INDEX_FAILED;
                    submission.docs[d].tries = (submission.docs[d].tries||1)+1;
                    if(submission.docs[d].tries<=3){
                        indexPromises.push(indexWithElasticSearch(d));
                    } else {
                        request.bodyTuncated = request.body.substr(0,2000);
                        delete request.body;
                        request.error = error;
                        common.logEvent('ElasticSearch communication error', JSON.stringify(request));
                        nextDoc();
                    }
                });
                //while we are waiting for ElasticSearch callback....
                // 1. write the efts_ table (submision, entities, files...)
                const dbPromises = [];

                if(!submission.headerWritten){ //write the header records only once per submission (skip for subsequent files & exhibits)
                    for(let i=0;i<submission.entities.length;i++){
                        let e = submission.entities[i];
                        //type values: OC=operating co; IC=invest co, RP=reporting person
                        //todo:  make the entity update into a SPROC with transaction to avoid race conditions
                        //FIRST DB CONNECTION USES AWAIT TO SECURE THE CONNECTION FOR FOLLOWING QUERIES:
                        let result = await common.runQuery(`select * from efts_entities where cik=${e.cik}`);
                        if(result.data && result.data.length==0){
                            //console.log(`inserting {q(e.name)} (${e.cik})$`);
                            dbPromises.push(common.runQuery(`insert ignore into efts_entities (cik,name,state_inc,type,updatedfromadsh) 
                                      values(${e.cik},${q(e.name)},${q(e.incorporationState)}, ${q(e.type)}, ${q(submission.adsh)})` ));
                        }
                        dbPromises.push(common.runQuery(`insert ignore into efts_submissions_entities (cik, adsh) 
                            values(${e.cik},${q(submission.adsh)})`));
                    }
                    dbPromises.push(common.runQuery(`insert ignore into efts_submissions (adsh, form, filedt) 
                        values(${q(submission.adsh)}, ${q(submission.form)}, ${q(submission.filingDate)})
                        on duplicate key update last_indexed = now()`));
                    submission.headerWritten = true; //write the header only once per submission (skip for subsequent files & exhibits)
                }
                //collect all the db promises
                for(let i=0;i<dbPromises.length;i++){ let z = await dbPromises[i]}
                // 2. check free heap size and collect garbage if heap > 1GB free
                submission.docs[d].lines = 'removed after sending to index'; //but first free up any large arrays or strings
                let memoryUsage = process.memoryUsage();  //returns memory in KB for: {rss, heapTotal, heapUsed, external}
                if(memoryUsage.heapUsed > 0.75*1024*1024*1024) runGarbageCollection(processInfo); //if more than 0.75GB used (out of 1GB)
                //readInterface.resume();
                //console.log(`P${processNum} indexed a doc #${d} from submission #${submissionCount} in ${(new Date()).getTime()-startIndexingTime}ms`);
            } else {
                //console.log(`skipping document #${d} ${submission.docs[d].fileName} in processing of ${submission.adsh}`);
                submission.docs[d].state = INDEX_STATES.SKIPPED;
                nextDoc();
            }
        }
        function nextDoc() {
            if(submission.docs.length-1>d) {
                if(submission.docs[d+1].state==READ_STATES.READ_COMPLETE) {
                    indexPromises.push(indexWithElasticSearch(d + 1));
                } else {
                    submission.indexState = INDEX_STATES.FREE;
                    //console.log('resuming (doc not complete)');
                    readInterface.resume();
                }
            } else {
                if(submission.readState==READ_STATES.READ_COMPLETE) {
                    messageParentFinished('ok');
                } else {
                    submission.indexState = INDEX_STATES.FREE;
                    if(submission.readState!=READ_STATES.MESSAGED_PARENT) {
                        //console.log('resuming (submission  not complete)');
                        readInterface.resume();
                    }
                }
            }
        }
    }

    async function messageParentFinished(status){
        //console.log(`submission complete; messaging parent`);
        submission.readState = READ_STATES.MESSAGED_PARENT;
        readInterface.close();
        stream.close();
        for(let i=0;i<indexPromises.length;i++) await indexPromises;
        let result = {
            status: status,
            filePath: processInfo.path,
            fileName: processInfo.name,
            entities: submission.entities,
            form: submission.form,
            adsh: submission.adsh,
            indexedDocumentCount: indexedDocumentCount,
            indexedByteCount: indexedByteCount,
            processNum: processInfo.processNum,
            processTime: (new Date()).getTime()-start,
        };
        //console.log(`indexed form ${result.form} in ${result.processTime}ms`);
        //console.log(result);

        for(let i=0;i<indexPromises.length;i++){ let z = await indexPromises[i]}
        process.send(result);
    }
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
            if(err){
                console.log('error closing connection (processNum ' +processNum+')');
                console.log(err);
            } else {
                //console.log('closed mysql connection held by parseSubmissionTxtFile (processNum ' +processNum+')');
                common.con = false;
            }
            //console.log(`${(new Date()).toISOString().substr(11, 10)} child process P${processNum} disconnected and shutting down`);
            if(submission.readState != READ_STATES.MESSAGED_PARENT) {
                submission.submissionCount = submissionCount;
                submission.processRunTime = ((new Date()).getTime()-processStart)/1000;
                submission.lastSubmissionRunTime = ((new Date()).getTime() - start)/1000;
                submission.process = 'P'+processNum;
                if(submission.lastSubmissionRunTime>60){
                    console.log("disconnected (>60) before done", submission.process, submission.lastSubmissionRunTime, submission.adsh, submission.readState, submission.indexState, submission.indexed, submission.docs[submission.indexed].state);
                }
            }
            process.exit();
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

const edgarLocations = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "DC": "District of Columbia",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "X1": "United States",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
    "A0": "Alberta, Canada",
    "A1": "British Columbia, Canada",
    "Z4": "Canada (Federal Level)",
    "A2": "Manitoba, Canada",
    "A3": "New Brunswick, Canada",
    "A4": "Newfoundland, Canada",
    "A5": "Nova Scotia, Canada",
    "A6": "Ontario, Canada",
    "A7": "Prince Edward Island, Canada",
    "A8": "Quebec, Canada",
    "A9": "Saskatchewan, Canada",
    "B0": "Yukon, Canada",
    "B2": "Afghanistan",
    "Y6": "Aland Islands",
    "B3": "Albania",
    "B4": "Algeria",
    "B5": "American Samoa",
    "B6": "Andorra",
    "B7": "Angola",
    "1A": "Anguilla",
    "B8": "Antarctica",
    "B9": "Antigua and Barbuda",
    "C1": "Argentina",
    "1B": "Armenia",
    "1C": "Aruba",
    "C3": "Australia",
    "C4": "Austria",
    "1D": "Azerbaijan",
    "C5": "Bahamas",
    "C6": "Bahrain",
    "C7": "Bangladesh",
    "C8": "Barbados",
    "1F": "Belarus",
    "C9": "Belgium",
    "D1": "Belize",
    "G6": "Benin",
    "D0": "Bermuda",
    "D2": "Bhutan",
    "D3": "Bolivia",
    "1E": "Bosnia and Herzegovina",
    "B1": "Botswana",
    "D4": "Bouvet Island",
    "D5": "Brazil",
    "D6": "British Indian Ocean Territory",
    "D9": "Brunei Darussalam",
    "E0": "Bulgaria",
    "X2": "Burkina Faso",
    "E2": "Burundi",
    "E3": "Cambodia",
    "E4": "Cameroon",
    "E8": "Cape Verde",
    "E9": "Cayman Islands",
    "F0": "Central African Republic",
    "F2": "Chad",
    "F3": "Chile",
    "F4": "China",
    "F6": "Christmas Island",
    "F7": "Cocos (Keeling) Islands",
    "F8": "Colombia",
    "F9": "Comoros",
    "G0": "Congo",
    "Y3": "Congo, the Democratic Republic of the",
    "G1": "Cook Islands",
    "G2": "Costa Rica",
    "L7": "Cote D'ivoire ",
    "1M": "Croatia",
    "G3": "Cuba",
    "G4": "Cyprus",
    "2N": "Czech Republic",
    "G7": "Denmark",
    "1G": "Djibouti",
    "G9": "Dominica",
    "G8": "Dominican Republic",
    "H1": "Ecuador",
    "H2": "Egypt",
    "H3": "El Salvador",
    "H4": "Equatorial Guinea",
    "1J": "Eritrea",
    "1H": "Estonia",
    "H5": "Ethiopia",
    "H7": "Falkland Islands (Malvinas)",
    "H6": "Faroe Islands",
    "H8": "Fiji",
    "H9": "Finland",
    "I0": "France",
    "I3": "French Guiana",
    "I4": "French Polynesia",
    "2C": "French Southern Territories",
    "I5": "Gabon",
    "I6": "Gambia",
    "2Q": "Georgia",
    "2M": "Germany",
    "J0": "Ghana",
    "J1": "Gibraltar",
    "J3": "Greece",
    "J4": "Greenland",
    "J5": "Grenada",
    "J6": "Guadeloupe",
    "GU": "Guam",
    "J8": "Guatemala",
    "Y7": "Guernsey",
    "J9": "Guinea",
    "S0": "Guinea-bissau",
    "K0": "Guyana",
    "K1": "Haiti",
    "K4": "Heard Island and Mcdonald Islands",
    "X4": "Holy See (Vatican City State)",
    "K2": "Honduras",
    "K3": "Hong Kong",
    "K5": "Hungary",
    "K6": "Iceland",
    "K7": "India",
    "K8": "Indonesia",
    "K9": "Iran, Islamic Republic of",
    "L0": "Iraq",
    "L2": "Ireland",
    "Y8": "Isle of Man",
    "L3": "Israel",
    "L6": "Italy",
    "L8": "Jamaica",
    "M0": "Japan",
    "Y9": "Jersey",
    "M2": "Jordan",
    "1P": "Kazakstan",
    "M3": "Kenya",
    "J2": "Kiribati",
    "M4": "Korea, Democratic People's Republic of ",
    "M5": "Korea, Republic of",
    "M6": "Kuwait",
    "1N": "Kyrgyzstan",
    "M7": "Lao People's Democratic Republic ",
    "1R": "Latvia",
    "M8": "Lebanon",
    "M9": "Lesotho",
    "N0": "Liberia",
    "N1": "Libyan Arab Jamahiriya",
    "N2": "Liechtenstein",
    "1Q": "Lithuania",
    "N4": "Luxembourg",
    "N5": "Macau",
    "1U": "Macedonia, the Former Yugoslav Republic of",
    "N6": "Madagascar",
    "N7": "Malawi",
    "N8": "Malaysia",
    "N9": "Maldives",
    "O0": "Mali",
    "O1": "Malta",
    "1T": "Marshall Islands",
    "O2": "Martinique",
    "O3": "Mauritania",
    "O4": "Mauritius",
    "2P": "Mayotte",
    "O5": "Mexico",
    "1K": "Micronesia, Federated States of",
    "1S": "Moldova, Republic of",
    "O9": "Monaco",
    "P0": "Mongolia",
    "Z5": "Montenegro",
    "P1": "Montserrat",
    "P2": "Morocco",
    "P3": "Mozambique",
    "E1": "Myanmar",
    "T6": "Namibia",
    "P5": "Nauru",
    "P6": "Nepal",
    "P7": "Netherlands",
    "P8": "Netherlands Antilles",
    "1W": "New Caledonia",
    "Q2": "New Zealand",
    "Q3": "Nicaragua",
    "Q4": "Niger",
    "Q5": "Nigeria",
    "Q6": "Niue",
    "Q7": "Norfolk Island",
    "1V": "Northern Mariana Islands",
    "Q8": "Norway",
    "P4": "Oman",
    "R0": "Pakistan",
    "1Y": "Palau",
    "1X": "Palestinian Territory, Occupied",
    "R1": "Panama",
    "R2": "Papua New Guinea",
    "R4": "Paraguay",
    "R5": "Peru",
    "R6": "Philippines",
    "R8": "Pitcairn",
    "R9": "Poland",
    "S1": "Portugal",
    "PR": "Puerto Rico",
    "S3": "Qatar",
    "S4": "Reunion",
    "S5": "Romania",
    "1Z": "Russian Federation",
    "S6": "Rwanda",
    "Z0": "Saint Barthelemy",
    "U8": "Saint Helena",
    "U7": "Saint Kitts and Nevis",
    "U9": "Saint Lucia",
    "Z1": "Saint Martin",
    "V0": "Saint Pierre and Miquelon",
    "V1": "Saint Vincent and the Grenadines",
    "Y0": "Samoa",
    "S8": "San Marino",
    "S9": "Sao Tome and Principe",
    "T0": "Saudi Arabia",
    "T1": "Senegal",
    "Z2": "Serbia",
    "T2": "Seychelles",
    "T8": "Sierra Leone",
    "U0": "Singapore",
    "2B": "Slovakia",
    "2A": "Slovenia",
    "D7": "Solomon Islands",
    "U1": "Somalia",
    "T3": "South Africa",
    "1L": "South Georgia and the South Sandwich Islands",
    "U3": "Spain",
    "F1": "Sri Lanka",
    "V2": "Sudan",
    "V3": "Suriname",
    "L9": "Svalbard and Jan Mayen",
    "V6": "Swaziland",
    "V7": "Sweden",
    "V8": "Switzerland",
    "V9": "Syrian Arab Republic",
    "F5": "Taiwan, Province of China",
    "2D": "Tajikistan",
    "W0": "Tanzania, United Republic of",
    "W1": "Thailand",
    "Z3": "Timor-leste",
    "W2": "Togo",
    "W3": "Tokelau",
    "W4": "Tonga",
    "W5": "Trinidad and Tobago",
    "W6": "Tunisia",
    "W8": "Turkey",
    "2E": "Turkmenistan",
    "W7": "Turks and Caicos Islands",
    "2G": "Tuvalu",
    "W9": "Uganda",
    "2H": "Ukraine",
    "C0": "United Arab Emirates",
    "X0": "United Kingdom",
    "2J": "United States Minor Outlying Islands",
    "X3": "Uruguay",
    "2K": "Uzbekistan",
    "2L": "Vanuatu",
    "X5": "Venezuela",
    "Q1": "Viet Nam",
    "D8": "Virgin Islands, British",
    "VI": "Virgin Islands, U.s.",
    "X8": "Wallis and Futuna",
    "U5": "Western Sahara",
    "T7": "Yemen",
    "Y4": "Zambia",
    "Y5": "Zimbabwe",
    "XX": "Unknown"
};


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