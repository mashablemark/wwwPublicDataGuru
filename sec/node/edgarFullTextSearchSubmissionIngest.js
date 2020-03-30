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
const exec = require('child_process').exec;
const AWS = require('aws-sdk');
const uuencode = require('uuencode');
const cluster = require('edgarFullTextSearchCredentials');

const endpoint = new AWS.Endpoint(`${cluster.domain}.${cluster.region}.es.amazonaws.com`);
const submissionsIndex = 'edgar_file';
const type = '_doc';

//const es = new AWS.ES({apiVersion: '2015-01-01'});
//const rgxXML = /<xml>[.\s\S]*<\/xml>/im;
//const rgxTagsAndExtraSpaces = /([\n\s]*<[^>]+>[\n\s]*|[\n\s]{2,})+/gm;  //removes html and xml tags and extra white space
const rgxTagsExtraSpacesAndNumbers = /([\n\s]*(<[^>]+>|[\n\s]{2,}|-?\$?-?\b[0-9,\.]+\b)[\n\s]*)+/gm;  //removes number words (but not alphanumeric words!) in addition to html and xml tags and extra white space
const rgxEncodedTagsExtraSpacesAndNumbers =/([\n\s]*(&lt;.+?&gt;|<[^>]+>|[\n\s]{2,}|-?\$?-?\b[0-9,\.]+\b)[\n\s]*)+/gm;;  //removes number words (but not alphanumeric words!) in addition to html and xml tags and html encoded tags embedded in XML values and extra white space
const rgxExtraSpacesAndNumbers = /([\n\s]*([\n\s-+\.]{2,}|-?\$?-?\b[0-9,\.]+\b)[\n\s]*)+/gm;  //removes number words, repeating: white space ....  -----
//const rgxExtraSpaces = /(\s{2,}|\.{2,})/mg; //spaces, ....., -----, _____

//preprocessors:
function removeWhiteSpacesAndNumbers(text){return text.replace(rgxExtraSpacesAndNumbers, ' ').trim();}
function removeTags(text){return text.replace(rgxTagsExtraSpacesAndNumbers, ' ').trim();}
function decodeAndRemoveTags(text){return text.replace(rgxEncodedTagsExtraSpacesAndNumbers, ' ').trim();}
function uunencodePadding(text){ //critical to pad lines
    const UUENCODE_PADDED_LINE_LENGTH = 61;
    let paddingLength =  Math.max(0, UUENCODE_PADDED_LINE_LENGTH-text.length);
    return text + (paddingLength?' '.repeat(paddingLength):'');
}
//non-standard postprocessors
function pdfToText(document, processInfo) {
    const uuencodedLines = document.lines;
    const start = new Date();
    uuencodedLines.shift(); //<PDF>
    uuencodedLines.pop();   //</PDF>
    uuencodedLines.shift(); //begin 644 ex991to13da108016015_010219.pdf
    uuencodedLines.pop();  //end
    //console.log('UUE LENGTH: '+ uuencodedLines.join('\n').length);

    const filePathRootName = processInfo.path + 'P'+ processNum + '_' + processInfo.name.split('.')[0];
    const tempFileName = filePathRootName + '.' + document.fileName;  //fileName has PDF extension
    fs.writeFileSync(tempFileName, uuencode.decode(uuencodedLines.join('\n')), 'binary'); //works!
    return new Promise(function(resolve, reject) {
        const cmd = `./text-extractor/pdftotext -q "${tempFileName}" -`;  //install directions on EC2: https://github.com/skylander86/lambda-text-extractor/blob/master/BuildingBinaries.md
        let texts = [];
        const child = exec(cmd);
        // Log process stdout and stderr
        child.stderr.on('data', function (error){
            const text = texts.join('\n');
            common.logEvent('pdftotext error', `${cmd} ended with error: ${error} (extracted text length=${text.length})`, true);
            //resolve(text);
        });
        child.stdout.on('data', function(data) {
            texts.push(data.toString());
        });
        child.on('close', function(code) {
            //console.log(`first line of text from ${filePathRootName}.pdf in ${(new Date()).getTime()-start.getTime()}ms: ${texts[0]}`);
            //console.log(texts.join('\n'));
            resolve(texts.join('\n'));
        });
    });
}


const q = (val) => { return common.q(val, true) };  //shortcut clean sql string and add quote (no following comma)
const indexedFileTypes = {
        htm: {indexable: true, preprocessor: removeTags},
        html: {indexable: true, preprocessor: removeTags},
        xml: {indexable: true, preprocessor: decodeAndRemoveTags},
        txt: {indexable: true, preprocessor: removeWhiteSpacesAndNumbers},
        pdf: {indexable: true, preprocessor: uunencodePadding, postprocessor: pdfToText},  //todo: indexable PDFs
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
let submissionCount = 0;
let processStart = (new Date()).getTime();
let start;

process.on('message', (processInfo) => {
    //debug: console.log('child get the message:', processInfo);
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

    const indexPromises = [],
        dbPromises = [];
    submission = { //submission has module level scope to be able to report out when killed
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
    let entity,
        address,
        indexedByteCount = 0,
        indexedDocumentCount = 0,
        entityTickersPromise,
        entityTickers = {};

    readInterface.on('line', async function(line) {
        let tLine = line.trim();
        if (submission.readState == READ_STATES.INIT) { //submission header prior to first <DOCUMENT>
            if (tLine == '<COMPANY-DATA>' || tLine == '<OWNER-DATA>') entity = {};
            if ((tLine == '</COMPANY-DATA>' || tLine == '</OWNER-DATA>') && entity.cik) {
                submission.entities.push(entity);
                if (entity.name) submission.names.push(entity.name);
                if (entity.incorporationState && entity.incorporationState.toString().length==2
                    && submission.incorporationStates.indexOf(entity.incorporationState)==-1) submission.incorporationStates.push(entity.incorporationState);
                if (entity.sic && submission.sics.indexOf(entity.sic)==-1) submission.sics.push(entity.sic);
                if(submission.ciks.indexOf(entity.cik) == -1) submission.ciks.push(entity.cik);
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
            if (tLine.startsWith('<PERIOD>')) submission.periodEnding = tLine.substr('<PERIOD>'.length).toUpperCase();

            if (tLine.startsWith('<FILING-DATE>')) submission.filingDate = tLine.substr('<FILING-DATE>'.length);
            if (tLine.startsWith('<ACCEPTANCE-DATETIME>')) submission.acceptanceDateTime = tLine.substr('<ACCEPTANCE-DATETIME>'.length);
            if (tLine.startsWith('<ACCESSION-NUMBER>')) submission.adsh = tLine.substr('<ACCESSION-NUMBER>'.length);
            if (tLine.startsWith('<FILE-NUMBER>')) submission.fileNumber = tLine.substr('<FILE-NUMBER>'.length);
            if (tLine.startsWith('<FILM-NUMBER>')) submission.filmNumber = tLine.substr('<FILM-NUMBER>'.length);
            if (tLine == '<DOCUMENT>') {
                writeSubmissionHeaderRecords();  //insert queries run async and promises pushed onto dbPromises array
                submission.readState = READ_STATES.DOC_HEADER;
            }
        }

        if (submission.readState == READ_STATES.DOC_FOOTER) { //ordered above the DOC_HEADER processing section to add new submission.docs on new <DOCUMENT>
            if (tLine == '<DOCUMENT>') submission.readState = READ_STATES.DOC_HEADER;  //another doc starting
            //note: '</DOCUMENT>' line in DOCUMENT footer is ignored
            if (tLine == '</SUBMISSION>') submission.readState = READ_STATES.READ_COMPLETE; //end of submission!
        }

        if (submission.readState == READ_STATES.DOC_BODY) {  //ordered above the DOC_HEADER processing section to avoid fall through of <TEXT>
            const d = submission.docs.length - 1;
            if (tLine == '</TEXT>') {
                submission.readState = READ_STATES.DOC_FOOTER;
                submission.docs[d].state = READ_STATES.READ_COMPLETE;
                //file complete; send to ElasticSearch if not already processing a previous file
                if(submission.indexState == INDEX_STATES.FREE) { //will only be free if all indexable docs (isArray(doc.line) && state==READ_COMPLETE) in submission.docs have been indexed;
                    indexPromises.push(indexWithElasticSearch(d)); //index the document and update th doc state and the submission state
                }
            } else {
                if (submission.docs[d].lines && tLine.length) { //determined above to have a valid ext and be indexable (and not blank)
                    submission.docs[d].lengthRaw += tLine.length;
                    const fileTypeProcessor = indexedFileTypes[submission.docs[d].fileExtension].preprocessor;
                    let processedLine = fileTypeProcessor ? fileTypeProcessor(line) : line;  //don't trim base64 encoded lines
                    if(processedLine.length && processedLine != ' ') submission.docs[d].lines.push(processedLine);
                }
            }
        }

        if (submission.readState == READ_STATES.DOC_HEADER) {
            if (tLine == '<DOCUMENT>') {  //fall though from decisions in INIT and DOC_FOOTER sections above
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
                    const rootForm = submission.form.toUpperCase().replace('/A','');
                    if(submission.docs[d].fileExtension == 'xml'
                        && (submission.form.toUpperCase() != submission.docs[d].fileType.toUpperCase() || !XLS_Forms[rootForm])
                        || submission.docs[d].fileDescription =='IDEA: XBRL DOCUMENT'){
                        submission.docs[d].lines = false; //only index XML file the are the primary XML document of a form with XLS transformation
                    } else {
                        if(XLS_Forms[rootForm]) submission.docs[d].xsl = typeof XLS_Forms[rootForm] == 'string' ? XLS_Forms[rootForm] : XLS_Forms[rootForm].default; //not check for exact version; use latest
                    }
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

    function writeSubmissionHeaderRecords(){
        dbPromises.push(common.runQuery(`insert into efts_submissions (adsh, form, filedt) 
            values(${q(submission.adsh)}, ${q(submission.form)}, ${q(submission.filingDate)})
            on duplicate key update last_indexed = null`));
        for(let i=0;i<submission.entities.length;i++){
            let e = submission.entities[i];
            //type field values: OC=operating co; IC=invest co, RP=reporting person
            dbPromises.push(common.runQuery(`insert into efts_entities (cik,name,state_inc,type,updatedfromadsh) 
                values(${e.cik},${q(e.name)},${q(e.incorporationState)}, ${q(e.type)}, ${q(submission.adsh)})
                on duplicate key update name=${q(e.name)}`));
            dbPromises.push(common.runQuery(`insert ignore into efts_submissions_entities (cik, adsh) 
                values(${e.cik},${q(submission.adsh)})`));

        }
        entityTickersPromise = common.runQuery(`SELECT cik, group_concat(ticker order by length(ticker), ticker SEPARATOR ', ')  as tickers
            FROM efts_entity_tickers 
            WHERE cik in (${submission.ciks.join(',')}) 
            group by cik`);
    }

    function indexWithElasticSearch(d) {
        return new Promise(async (resolve, reject)=>{
            const document = submission.docs[d];
            let request;
            if(document.state == READ_STATES.READ_COMPLETE || document.state == INDEX_STATES.INDEX_FAILED){
                submission.indexState = INDEX_STATES.INDEXING;
                submission.indexed = d;
                let indexedText;
                if(document.lines && document.lines.length){
                    const fileTypeProcessor = indexedFileTypes[document.fileExtension].preprocessor;
                    const arrayPostprocessor =  indexedFileTypes[document.fileExtension].postprocessor;
                    if(arrayPostprocessor) {
                        indexedText = await arrayPostprocessor(document, processInfo);
                    } else {
                        indexedText = fileTypeProcessor ? fileTypeProcessor(document.lines.join('\n')) : document.lines.join('\n');
                    }
                    document.lengthIndexed = indexedText.length;
                }
                if(entityTickersPromise){ //the tickers must by gotten and the display names composed before indexing any files
                    let entityTickerResults = await entityTickersPromise;
                    entityTickersPromise = false;
                    for(let row=0; row<entityTickerResults.data.length; row++){
                        entityTickers[formatCIK(entityTickerResults.data[row].cik)] = entityTickerResults.data[row].tickers;
                    }

                    for(let i=0;i<submission.entities.length;i++){
                        let e = submission.entities[i];
                        let address = e.businessAddress;
                        if(address){
                            let state = address.state || '';
                            let city = common.toTitleCase(address.city||'');
                            if(state) submission.businessStates.push(state);
                            if(city || state) submission.businessLocations.push(city + (city && state?', ':'') +state );
                        }
                        let displayName = `${entity.name || ''} ${entityTickers[entity.cik]? ' ('+entityTickers[entity.cik]+') ': ''} (CIK ${entity.cik})`;
                        if(submission.displayNames.indexOf(displayName)==-1) submission.displayNames.push(displayName);
                    }

                }

                if(document.lengthIndexed && document.lengthIndexed > 1){ //process else skip
                    document.lengthRaw += document.lines.length;  //account for carriage returns
                    document.state = INDEX_STATES.INDEXING;
                    readInterface.pause();  //does not immediately stop the line events.  A few more might come, but this stops the torrent
                    let doc_textLength = 0;
                    for(let i=0;i<document.lines.length;i++) doc_textLength += document.lines[i].length;
                    //console.log(`P${processNum} about to index a doc`);

                    request = new AWS.HttpRequest(endpoint, cluster.region);
                    request.method = 'PUT';
                    request.path += `${submissionsIndex}/${type}/${submission.adsh}:${document.fileName}`;
                    request.body = JSON.stringify({  //try not to create unnecessary copies of the document text in memory
                        doc_text: indexedText,
                        //adsh: submission.adsh,  //embedded in ID = REDUNDANT FIELD
                        //file_name: document.fileName,  //embedded in ID = REDUNDANT FIELD
                        adsh: submission.adsh,
                        file_type: document.fileType,
                        xsl: document.xsl,
                        sequence: document.fileSequence,
                        display_names: submission.displayNames,
                        file_description: document.fileDescription,
                        film_num: document.filmNumber,
                        file_num: document.fileNumber,
                        file_date: `${submission.filingDate.substr(0, 4)}-${submission.filingDate.substr(4, 2)}-${submission.filingDate.substr(6, 2)}`,
                        period_ending: submission.periodEnding?`${submission.periodEnding.substr(0, 4)}-${submission.periodEnding.substr(4, 2)}-${submission.periodEnding.substr(6, 2)}`:null,
                        sics: submission.sics,
                        ciks: submission.ciks,
                        form: submission.form,
                        root_form: submission.form.replace('/A',''),
                        inc_states: submission.incorporationStates,
                        biz_states: submission.businessStates, //searchable
                        biz_locations:  submission.businessLocations,  //for display; not searchable
                    });
                    //console.log(JSON.parse(request.body));
                    request.headers['host'] = `${cluster.domain}.${cluster.region}.es.amazonaws.com`;
                    request.headers['Content-Type'] = 'application/json';
                    // Content-Length is only needed for DELETE requests that include a request body
                    var credentials = new AWS.EnvironmentCredentials('AWS');
                    var signer = new AWS.Signers.V4(request, 'es');
                    //signer.addAuthorization(credentials, new Date());

                    //send to index
                    let client = new AWS.HttpClient();
                    //initialize/reinitialize file record
                    const insertPromise = common.runQuery(`insert into efts_submissions_files (adsh, sequence, filename, length_raw, length_indexed, name, description) 
                        values (${q(submission.adsh)}, ${document.fileSequence}, ${q(document.fileName)}, ${document.lengthRaw}, 
                        ${document.lengthIndexed}, ${q(document.fileType)}, ${q(document.fileDescription)})
                        on duplicate key update last_indexed = null, tries=tries+1`);
                    client.handleRequest(request, {connectTimeout: 2000, timeout: 55000}, function(response) {
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
                                    indexFailed('Bad response. statusCode: ' + response.statusCode);
                                } else {
                                    if(document.tries) console.log('success on retry #'+document.tries);
                                    await insertPromise;  //make sure record has been insert before we try to update it
                                    dbPromises.push(common.runQuery(
                                        `update efts_submissions_files  
                                        set last_indexed = now()
                                        where adsh=${q(submission.adsh)} and sequence=${document.fileSequence}`
                                    ));
                                    document.state = INDEX_STATES.INDEXED;
                                    document.lines = 'removed after successful indexing'; //but first free up any large arrays or strings
                                    indexedByteCount = indexedByteCount + (doc_textLength || 0);
                                    indexedDocumentCount++;
                                    //console.log(`P${processNum} indexed a doc #${d} from submission #${submissionCount} in ${(new Date()).getTime()-startIndexingTime}ms`);
                                    nextDoc(d);
                                    resolve({doc: d, status: 'success'});
                                }
                            } catch (e) {
                                indexFailed('Bad response. statusCode: ' + response.statusCode);
                            }
                        });
                    }, function(error) {
                        indexFailed('Error sending data to ES: ' + error);
                    });
                    //while we are waiting for ElasticSearch callback check free heap size and collect garbage if heap > 1GB free
                    let memoryUsage = process.memoryUsage();  //returns memory in KB for: {rss, heapTotal, heapUsed, external}
                    if(memoryUsage.heapUsed > 0.75*1024*1024*1024) runGarbageCollection(processInfo); //if more than 0.75GB used (out of 1GB)
                } else {
                    //console.log(`skipping document #${d} ${document.fileName} in processing of ${submission.adsh}`);
                    document.state = INDEX_STATES.SKIPPED;
                    nextDoc(d);
                    resolve({doc: d, status: 'skipped'});
                }
            }
            function indexFailed(reason){
                //the file record already written above; setting the last_indexed timestamp (from NULL) indicates success
                document.state = INDEX_STATES.INDEX_FAILED;
                common.logEvent('ElasticSearch submissionsIndex error #'+(document.tries||1), reason, true);
                document.tries = (document.tries||1)+1;
                if(document.tries<=3){
                    indexPromises.push(indexWithElasticSearch(d));
                } else {
                    common.logEvent('ElasticSearch submissionsIndex error #'+document.tries, request.body.substr(0,2000), true);
                    document.lines = 'removed after indexing failure #3'; //free up memory of any large array
                    nextDoc(d);
                }
                resolve({doc: d, status: 'error'});
            }
        });
    }

    function nextDoc(dLast) {
        if(submission.docs.length-1>dLast) {
            if(submission.docs[dLast+1].state==READ_STATES.READ_COMPLETE) { //a follow on doc has been read and is ready to be processed (indexed if it had lines)
                indexPromises.push(indexWithElasticSearch(dLast + 1));
            } else { //a follow on doc is being read (not complete yet)
                submission.indexState = INDEX_STATES.FREE;
                readInterface.resume();
            }
        } else {
            submission.indexState = INDEX_STATES.FREE;
            if(submission.readState==READ_STATES.READ_COMPLETE) {
                messageParentFinished('ok');
            } else {
                if(submission.readState!=READ_STATES.MESSAGED_PARENT) {
                    //console.log('resuming (submission  not complete)');
                    readInterface.resume();
                }
            }
        }
    }
    async function messageParentFinished(status){
        //console.log(`submission complete; messaging parent`);
        readInterface.close();
        stream.close();
        //console.log(`indexed form ${result.form} in ${result.processTime}ms`);
        //console.log(result);
        for(let i=0;i<indexPromises.length;i++) await indexPromises[i];
        for(let i=0;i<dbPromises.length;i++) await dbPromises[i];
        await common.runQuery(
            `update efts_submissions
            set last_indexed=now(), 
            files_total=${submission.docs.length}, 
            files_indexed=${submission.docs.reduce((count, doc)=> {return count + (doc.lengthIndexed?1:0)}, 0)}, 
            bytes_index=${submission.docs.reduce((bytes, doc)=> {return bytes + (doc.lengthIndexed||0)}, 0)}
            where adsh = '${submission.adsh}'`
        );
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
        process.send(result);
        submission.readState = READ_STATES.MESSAGED_PARENT;
    }
    function formatCIK(unpaddedCIK){ //accept int or string and return string with padded zero
        return '0'.repeat(10-unpaddedCIK.toString().length) + unpaddedCIK.toString()
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
                    console.log("disconnected (>60) before done", "p"+submission.process, 'lastSubmissionRunTime '+submission.lastSubmissionRunTime, submission.adsh,
                        'readState '+(submission.readState||'undefined'), 'indexState '+(submission.indexState||'undefined'), 'submission.indexed '+(submission.indexed||'undefined'),
                        'docs '+(submission.indexed&&submission.docs&&submission.docs.length>submission.indexed?submission.docs[submission.indexed].state||'undefined':'docs array does submissionsIndex')
                    );
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

var XLS_Forms = {
    "1-A":  "xsl1-A_X01",
    "1-A POS":  "xsl1-A_X01",
    "1-K": "xsl1-K_X01",
    "1-Z": "xsl1-Z_X01",
    "3": {default : "xslF345_X02", versionTag: 'schemaVersion', X01: "xslF345X01", X02: "xslF345X02"},
    "4": {default : "xslF345_X03", versionTag: 'schemaVersion', X01: "xslF345X01", X02: "xslF345X02", X03: "xslF345X03"},
    "5": {default : "xslF345_X03", versionTag: 'schemaVersion', X01: "xslF345X01", X02: "xslF345X02", X03: "xslF345X03"},
    "CFPORTAL": "xslCFPORTAL_X01",
    "C": "xslC_X01",
    "C-AR" : "xslC_X01", //ARCHIVE PROBLEM: C-AR SUBMISSIONS NOT LISTING RENDERED DOC (e.g. https://www.sec.gov/Archives/edgar/data/1611161/000166516020000159/xslC_X01/primary_doc.xml)
    "EFFECT": "xslEFFECT",  //xslEFFECT_X02 did not work
    "13F": "xslForm13F_X01",  //there is no Form 13F, only 13f-HR and 13F-NT but this entry can't hurt
    "13F-HR": "xslForm13F_X01",
    "13F-NT": "xslForm13F_X01",
    //"25": "xslForm25_X02",   XLS is invalid; all Form 25 files on EDGAR are HTML
    "D": "xslFormDX01",
    "MA": "xslFormMA_X01",
    "MA-A": "xslFormMA_X01",
    "MA-I": "xslFormMA-I_X01",
    //"MA-NR": "xslMA-W_X01",  none in past ten years
    "MA-W": "xslFormMA-W_X01", //bad rendering:  www.sec.gov/Archives/edgar/data/1631559/000163155920000001/xslFormMA-W_X01/primary_doc.xml
    "N-CEN": "xslFormN-CEN_X01",
    "N-MFP": "xslFormN-MFP_X01",
    "N-MFP1": "xslN-MFP1_X01",
    "N-MFP2": "xslN-MFP2_X01",
    "NPORT-NP": "xslFormNPORT-P_X01",  //no examples found
    "NPORT-P": "xslFormNPORT-P_X01",
    "QUALIF": "xslQUALIFX01",
    "SBSE-A": "xslSBSE-A_X01",  //no examples found
    "SBSE-BD": "xslSBSE-BD_X01",  //no examples found
    "SBSE-C": "xslSBSE-C_X01",  //no examples found
    "SBSE-W": "xslSBSE-W_X01",  //no examples found
    "SBSE": "xslSBSE_X01",  //no examples found
    "SDR": "xslSDR_X01",
    "TA-1": "xslFTA1X01",
    "TA-2": "xslFTA2X01",
    "TA-W": "xslFTAWX01",
    "X-17A-5": "xslX-17A-5_X01",
};

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