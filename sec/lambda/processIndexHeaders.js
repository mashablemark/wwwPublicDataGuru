//Lambda function is triggered by S3 PUT event of EDGAR Archives bucket where file suffix = '-index-headers.html'
//avg execution time 400ms to 2s (peak exec = 4s on db startup and  large index file)
//cost = 500,000 filings per * $0.000000208 per 100ms (192MB size) * 2s * 10 (100ms to s) = $2.08 per year
//note: 128MB container has no spare memory when run hard

//2016Q1 (empty MySQL tables; M5.2XL ($0.38/h) instance; new submission every 200ms)
// Lambda costs:  $1.94 / quarter
// processIndexHeaders: 158,372 files * 0.5s * $0.00000417 / s (256MB) = $0.33
// updateOwnershipAPI: 138,892 files * 0.5s * $0.00000417 / s (256MB) = $0.29  (average peaky towards end)
// updateXBRLAPI:        7,575 files * 6.5s * $0.00002501 / s (1.5GB) = $1.23  (average peaky towards end)
// updateFormDAPI:      11,905 files * 0.5s * $0.00000834 / s (512MB) = $0.05  (average jumped abruptly 2/3 way through quarter)
// writeDetailedIndexes: ~5,000 invokes * 2s * $0.00000417 / s (256MB) = $0.04  (average jumped abruptly 2/3 way through quarter)

// S3 costs (S3 costs driven by XBRL TimeSeries write and XBRL Frames API writes)
// S3 WRITES: $31.00 = ((1 issuer + 1 reporter) * 67,378 Ownership) + (800 TS & Frames * 7,575 XBRL) + 11,909 Form D Indexes) * $0.005/1000
// S3 READS: $0.12 = (1 index header + 1 XML) * 158,000 * $0.0004/1000

// SQS cost $1.30 each per quarter (95% due to polling)
//Results
//  M5.XL @ 100ms file rate, XBRL peak filing dates cause CPU utilization to jump from 25% to 88% and caused retries and too many connections
//  Setting the XBRL concurrency to 40 and bumping the to M5.2XL (@ $0.38/h) keep CPU spikes to 40%
//  Adding SQS for XBRL and FormD to eliminate throttles

// Future: consider a migration to Aurora Serverless = 5x throughput of mySQL on same hardware

//todo: consider using DB with a transaction  to S3 read = faster + possibly allow for concurrent lambdas of processIndexHeadrs

//module level variables (note: these persist between handler calls when containers are reused = prevalent during high usage periods)
var AWS = require('aws-sdk');
var dailyIndex = false;  //daily index as parsed object needs initiation than can be reused as long as day is same

const common = require('common');

exports.handler = async (event, context) => {

    //event object description documation @ https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html
    //optional event controls can be added by crawlers that explicitly call Lambda (instead of normal S3 PUT trigger):
    //  event.crawlerOverrides.body (allows body of -index-headers.html file to be passed in eliminating the S3 fetch)
    //  event.crawlerOverrides.noDailyIndexProcessing
    //  event.crawlerOverrides.noLatestIndexProcessing
    //  event.crawlerOverrides.tableSuffix: allow for test runs (must be passed to subsequent functions
    const firstS3record = event.Records[0].s3;
    common.bucket = firstS3record.bucket.name;
    let key = firstS3record.object.key;
    //const size = firstS3record.object.bytes;
    const folder = key.substr(0, key.lastIndexOf('/')+1);
    //1. read the index-header.html file
    console.log('step 1: starting parse of ' + JSON.stringify(key));
    let indexHeaderBody;
    if(event.crawlerOverrides && event.crawlerOverrides.body){
        indexHeaderBody = event.crawlerOverrides.body;
    } else {
        try{
            const indexHeaderReadPromise = common.readS3(key);
            console.log('getting ' + JSON.stringify(key));
            indexHeaderBody = await indexHeaderReadPromise;
        } catch (e) {
            await common.logEvent('FILE ERROR: error reading file', key, true);
            return false; //stop further execution w/o causing an error in the monitoring
        }
    }

    //2. parse header info and create submission object
    console.log('step 2');
    const thisSubmission = {
        path: folder,
        ciks: [],
        adsh: headerInfo(indexHeaderBody, '<ACCESSION-NUMBER>'),
        fileNum: headerInfo(indexHeaderBody, '<FILE-NUMBER>'),
        form: headerInfo(indexHeaderBody, '<FORM-TYPE>'),
        filingDate: headerInfo(indexHeaderBody, '<FILING-DATE>'),
        period: headerInfo(indexHeaderBody, '<PERIOD>'),
        acceptanceDateTime:  headerInfo(indexHeaderBody, '<ACCEPTANCE-DATETIME>'),
        indexHeaderFileName: firstS3record.object.key,
        files: []
    };
    const allCiks = indexHeaderBody.match(/<CIK>\d+/g);
    if(allCiks){
        for(let i=0;i<allCiks.length;i++){
            thisSubmission.ciks.push(allCiks[i].substr(5));
        }
    } else {
        await common.logEvent('ERROR processIndexHeaders: no CIks found', key, true)
    }

    try {
        let acceptanceDateTime = common.getDisseminationDate(thisSubmission.acceptanceDateTime);
    } catch (e) {
        await common.logEvent('FILE ERROR: no acceptanceDateTime in index header', key, true);
        return false; //stop further execution w/o causing an error in the monitoring
    }

    //3. parse and add hyperlinks to submission object
    console.log('step 3');
    const links = indexHeaderBody.match(/<a href="[^<]+<\/a>/g); // '/<a href="\S+"/g');
    if(links){
        for(let i=0; i<links.length;i++){
            let firstQuote = links[i].indexOf('"');
            let relativeKey = links[i].substr(firstQuote+1, links[i].indexOf('"',firstQuote+1)-firstQuote-1);
            let linkLocation = indexHeaderBody.indexOf(links[i]);
            let linkSection = indexHeaderBody.substring(indexHeaderBody.substr(0, linkLocation).lastIndexOf('&lt;DOCUMENT&gt;'), linkLocation);
            let fileType = headerInfo(linkSection, '&lt;TYPE&gt;');
            let fileDescription = headerInfo(linkSection, '&lt;DESCRIPTION&gt;');
            let notIdeaDoc = fileDescription ? fileDescription.indexOf("IDEA: XBRL DOCUMENT")=== -1 : true; //don't add the OSD created derived files to the JSON index
            let mainDirectoryFile = relativeKey.indexOf('/') === -1;
            if(notIdeaDoc && mainDirectoryFile) {
                let thisFile = {
                    name: relativeKey
                };
                if(fileDescription) thisFile.description = fileDescription;
                if(fileType) thisFile.type = fileType;
                thisSubmission.files.push(thisFile);
            }
        }
    }

    //4. add new submission to database
    console.log('step 4');
    let q = common.q;  //shorthandle
    let shortPath = folder.replace('sec/','').replace('Archives/','').replace('edgar/data/','');
    let sql = 'call submissionAdd('+q(shortPath)+q(thisSubmission.acceptanceDateTime)+q(JSON.stringify(thisSubmission),true)+')';
    const newSubmissionPromise = common.runQuery(sql);

    //5.  check if detect form is past of a form family that is scheduled for additional processing (eg. parse to db and update REST API file)
    console.log('step 5');
    // note:  Can be expanded to post processing of additional form families to create additional APIs such as RegistrationStatements, Form Ds...
    const formPostProcesses = {
        //ownership forms   (https://www.sec.gov/Archives/edgar/data/39911/000003991119000048/0000039911-19-000048-index-headers.html)
        '3': {lambda: 'updateOwnershipAPI', queue: "https://sqs.us-east-1.amazonaws.com/008161247312/updateOwnershipAPI"},
        '3/A': {lambda: 'updateOwnershipAPI', queue: "https://sqs.us-east-1.amazonaws.com/008161247312/updateOwnershipAPI"},
        '4': {lambda: 'updateOwnershipAPI', queue: "https://sqs.us-east-1.amazonaws.com/008161247312/updateOwnershipAPI"},
        '4/A': {lambda: 'updateOwnershipAPI', queue: "https://sqs.us-east-1.amazonaws.com/008161247312/updateOwnershipAPI"},
        '5': {lambda: 'updateOwnershipAPI', queue: "https://sqs.us-east-1.amazonaws.com/008161247312/updateOwnershipAPI"},
        '5/A': {lambda: 'updateOwnershipAPI', queue: "https://sqs.us-east-1.amazonaws.com/008161247312/updateOwnershipAPI"},
        //financial statement forms  (https://www.sec.gov/Archives/edgar/data/29905/000002990519000029/0000029905-19-000029-index-headers.html)
        '10-Q': {lambda: 'updateXBRLAPI', queue: 'https://sqs.us-east-1.amazonaws.com/008161247312/queueUpdateXBRLAPI'},
        '10-Q/A': {lambda: 'updateXBRLAPI', queue: 'https://sqs.us-east-1.amazonaws.com/008161247312/queueUpdateXBRLAPI'},
        '10-K': {lambda: 'updateXBRLAPI', queue: 'https://sqs.us-east-1.amazonaws.com/008161247312/queueUpdateXBRLAPI'},
        '10-K/A': {lambda: 'updateXBRLAPI', queue: 'https://sqs.us-east-1.amazonaws.com/008161247312/queueUpdateXBRLAPI'},
        //form D processor
        'D': {lambda: 'updateFormDAPI', queue: 'https://sqs.us-east-1.amazonaws.com/008161247312/queueUpdateFormDAPI'},
        'D/A': {lambda: 'updateFormDAPI', queue: 'https://sqs.us-east-1.amazonaws.com/008161247312/queueUpdateFormDAPI'}
        //registration statement processor?? (published public registration statement; not draft!)
    };

    if(formPostProcesses[thisSubmission.form]) {  //post processing required!
        let processor = formPostProcesses[thisSubmission.form].lambda;
        thisSubmission.crawlerOverrides = {tableSuffix: event.crawlerOverrides?event.crawlerOverrides.tableSuffix || '':''}; //pass on override(s) here
        //get additional meta data from header
        thisSubmission.bucket= firstS3record.bucket.name;
        const filerSections = indexHeaderBody.match(/<FILER>((?!<\/FILER>)[\s\S])*<\/FILER>/g);
        if(filerSections){
            let filers = {};
            for(let i=0;i<filerSections.length;i++){
                let thisCIK = headerInfo(filerSections[i], '<CIK>');
                filers[thisCIK] = {
                    sic: headerInfo(filerSections[i], '<ASSIGNED-SIC>'),
                    ein: headerInfo(filerSections[i], '<IRS-NUMBER>'),
                    incorporation: {
                        state: headerInfo(filerSections[i], '<STATE-OF-INCORPORATION>'),
                        country: headerInfo(filerSections[i], '<COUNTRY-OF-INCORPORATION>')
                    }
                };
                await getAddresses(filers[thisCIK], filerSections[i], processor);
            }
            thisSubmission.filers = filers; //replace array of CIKs with hash object
        } else {
            thisSubmission.cik = headerInfo(indexHeaderBody, '<CIK>');
            thisSubmission.sic = headerInfo(indexHeaderBody, '<ASSIGNED-SIC>');
            thisSubmission.ein = headerInfo(indexHeaderBody, '<IRS-NUMBER>');
            thisSubmission.incorporation = {
                state: headerInfo(indexHeaderBody, '<STATE-OF-INCORPORATION>'),
                country: headerInfo(indexHeaderBody, '<COUNTRY-OF-INCORPORATION>')
            };
            await getAddresses(thisSubmission, indexHeaderBody, processor);
        }

        thisSubmission.timeStamp = (new Date).getTime();
        let payload = JSON.stringify(thisSubmission, null, 2); // include all props with 2 spaces (not sure if truly required)
        //console.log(payload);   //debugging only!!
        //some processes are invoked directly; long running or non-concurrent ones may need queues
        if(formPostProcesses[thisSubmission.form].queue){
            let sqs = new AWS.SQS({apiVersion: '2012-11-05'});
            let params = {
                MessageBody: payload,
                QueueUrl: formPostProcesses[thisSubmission.form].queue
            };
            console.log('instantiated sqs: about to sendMessage');
            await new Promise((resolve, reject)=>{
                try{
                    sqs.sendMessage(params, (err, data) => {
                        if(err){
                            console.log('failed to add message to ' + formPostProcesses[thisSubmission.form].queue);
                            reject(err); //stop processing and let CloudWatch log the error
                        } else {
                            console.log("Successfully added MessageId " + data.MessageId + " to " + formPostProcesses[thisSubmission.form].queue);
                            resolve()
                        }
                    });
                } catch (e) {
                    console.log('error in sendMessage!');
                    console.log(JSON.stringify(e));
                    reject(e);
                }
            });
        } else {
            //important!  even though the invocation is async (InvocationType: 'Event'), you must await to give enough time to invoke!
            let lambda = await new AWS.Lambda({
                region: 'us-east-1'
            });

            //important!  even though the invocation is async (InvocationType: 'Event'), you must await to give enough time to invoke!
            await new Promise((resolve, reject)=> { lambda.invoke(  //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
                {
                    FunctionName: processor,
                    Payload: payload,
                    InvocationType: 'Event'
                },
                function(error, data) {
                    if (error) {
                        console.log('error invoking ' + processor);
                        console.log(error);
                        reject(error);
                    }
                    if(data.Payload){
                        context.succeed(data.Payload);
                    }
                    console.log('invoked ' + processor);
                    resolve(data);
                });
            });
        }

    }

    //6. check if new step function needs to be start or if age of existing new submission indicates a failure = fire writeDetailedIndexes immediately
    console.log('step 6');
    const newSubmissionsInfo = await newSubmissionPromise;
    const batchAgeSeconds = newSubmissionsInfo.data[0][0].age;
    if(batchAgeSeconds !== null) {
        if(batchAgeSeconds>15){  //give a a generous 5s buffer for slow starts
            await common.logEvent('ERROR SubmissionsNew batch age requires emergency writeDetailedIndexes','age: ' + batchAgeSeconds + ' s', true);
            let lambda = await new AWS.Lambda({
                region: 'us-east-1'
            });
            await new Promise((resolve, reject)=> {
                lambda.invoke(  //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
                {
                    FunctionName: 'writeDetailedIndexes',
                    Payload: '{}',
                    InvocationType: 'Event'
                },
                function(error, data) {
                    if (error) {
                        common.logEvent('ERROR invoking emergency writeDetailedIndexes',JSON.stringify(error), true);
                        reject(error);
                    }
                    if(data.Payload){
                        context.succeed(data.Payload);
                    }
                    resolve(data);
                });
            });
        } else {
            console.log('batchAge of '+batchAgeSeconds+'s is in spec')
        }
    } else {  //null = new submission -> start batch timer
        console.log('new indexBatchTimer');
        await new Promise((resolve, reject)=> {
            let params = {
                stateMachineArn: 'arn:aws:states:us-east-1:008161247312:stateMachine:indexBatchTimer', //indexBatchTimer
                input: '{}'  //requires a JSON not an actual js object
            };
            var stepFunctions = new AWS.StepFunctions();
            stepFunctions.startExecution(params, function (err, data) {
                if (err) {
                    console.log('error executing step function indexBatchTimer');
                    reject(err);
                } else {
                    console.log('started execution of step function indexBatchTimer');
                    resolve(true);
                }
            });
        });
    }
    //9. terminate by returning from handler (node Lamda functions end when REPL loop is empty)
    return {status: 'ok'};
};

function getAddresses(thisSubmission, indexHeaderBody, processor){
    console.log('Getting addresses for '+processor);
    const addressesByType = {
        updateXBRLAPI: {
            businessAddress: ['FILER', 'BUSINESS-ADDRESS'],
            mailingAddress: ['FILER', 'MAIL-ADDRESS']
        },
        updateOwnershipAPI: { //note:  reporter addresses scaped from the form XML
            issuerBusinessAddress: ['ISSUER','BUSINESS-ADDRESS'],
            issuerMailingAddress: ['ISSUER','MAIL-ADDRESS']
        }
    };
    for(let addressType in addressesByType[processor]){
        let tags = addressesByType[processor][addressType];
        let rgxOuter = new RegExp('<'+tags[0]+'>(\n|\r|.)*<\/'+tags[0]+'>');
        let outerMatches = indexHeaderBody.match(rgxOuter);
        if(outerMatches){
            //console.log('outer match');
            let rgxAddress = new RegExp('<'+tags[1]+'>(\n|\r|.)*<\/'+tags[1]+'>');
            let addressMatches = outerMatches[0].match(rgxAddress);
            if(addressMatches){
                //console.log(addressMatches[0]);
                thisSubmission[addressType] = {
                    street1: headerInfo(addressMatches[0], '<STREET1>'),
                    street2: headerInfo(addressMatches[0], '<STREET2>'),
                    city: headerInfo(addressMatches[0], '<CITY>'),
                    state: headerInfo(addressMatches[0], '<STATE>'),
                    zip: headerInfo(addressMatches[0], '<ZIP>'),
                    phone: headerInfo(addressMatches[0], '<PHONE>')
                };
            }
        }
    }
}

const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
function headerInfo(fileBody, tag){
    let tagStart = fileBody.indexOf(tag);
    if(tagStart==-1) return false;
    return fileBody.substring(tagStart + tag.length, fileBody.indexOf('\n', tagStart+1)).replace(rgxTrim,'');
}







//sample ElasticSearch ingest code:
/*
 * Sample node.js code for AWS Lambda to get Apache log files from S3, parse
 * and add them to an Amazon Elasticsearch Service domain.
 *
 * Copyright 2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */

/* Imports */
var AWS = require('aws-sdk');
var LineStream = require('byline').LineStream;
var path = require('path');
var stream = require('stream');

/* Globals */
var esDomain = {
    endpoint: 'https://vpc-edgar-fts-xej5y74lqs47mkuagdvgnoefbi.us-east-1.es.amazonaws.com', //'my-search-endpoint.amazonaws.com',
    region: 'us-east-1', //'my-region',
    index: 'logs',
    doctype: 'html'
};
var endpoint =  new AWS.Endpoint(esDomain.endpoint);
var s3 = new AWS.S3();
var totLogLines = 0;    // Total number of log lines in the file
var numDocsAdded = 0;   // Number of log lines added to ES so far

/*
 * The AWS credentials are picked up from the environment.
 * They belong to the IAM role assigned to the Lambda function.
 * Since the ES requests are signed using these credentials,
 * make sure to apply a policy that permits ES domain operations
 * to the role.
 */
var creds = new AWS.EnvironmentCredentials('AWS');

/*
 * Get the log file from the given S3 bucket and key.  Parse it and add
 * each log record to the ES domain.
 */
function s3LogsToES(bucket, key, context, lineStream, recordStream) {
    // Note: The Lambda function should be configured to filter for .log files
    // (as part of the Event Source "suffix" setting).

    var s3Stream = s3.getObject({Bucket: bucket, Key: key}).createReadStream();

    // Flow: S3 file stream -> Log Line stream -> Log Record stream -> ES
    s3Stream
        .pipe(lineStream)
        .pipe(recordStream)
        .on('data', function(parsedEntry) {
            postDocumentToES(parsedEntry, context);
        });

    s3Stream.on('error', function() {
        console.log(
            'Error getting object "' + key + '" from bucket "' + bucket + '".  ' +
            'Make sure they exist and your bucket is in the same region as this function.');
        context.fail();
    });
}

/*
 * Add the given document to the ES domain.
 * If all records are successfully added, indicate success to lambda
 * (using the "context" parameter).
 */
function postDocumentToES(doc, context) {
    var req = new AWS.HttpRequest(endpoint);

    req.method = 'POST';
    req.path = path.join('/', esDomain.index, esDomain.doctype);
    req.region = esDomain.region;
    req.body = doc;
    req.headers['presigned-expires'] = false;
    req.headers['Host'] = endpoint.host;

    // Sign the request (Sigv4)
    var signer = new AWS.Signers.V4(req, 'es');
    signer.addAuthorization(creds, new Date());

    // Post document to ES
    var send = new AWS.NodeHttpClient();
    send.handleRequest(req, null, function(httpResp) {
        var body = '';
        httpResp.on('data', function (chunk) {
            body += chunk;
        });
        httpResp.on('end', function (chunk) {
            numDocsAdded ++;
            if (numDocsAdded === totLogLines) {
                // Mark lambda success.  If not done so, it will be retried.
                console.log('All ' + numDocsAdded + ' log records added to ES.');
                context.succeed();
            }
        });
    }, function(err) {
        console.log('Error: ' + err);
        console.log(numDocsAdded + 'of ' + totLogLines + ' log records added to ES.');
        context.fail();
    });
}

/* Lambda "main": Execution starts here */
exports.handler = function(event, context) {
    console.log('Received event: ', JSON.stringify(event, null, 2));

    /* == Streams ==
    * To avoid loading an entire (typically large) log file into memory,
    * this is implemented as a pipeline of filters, streaming log data
    * from S3 to ES.
    * Flow: S3 file stream -> Log Line stream -> Log Record stream -> ES
    */
    var lineStream = new LineStream();
    // A stream of log records, from parsing each log line
    var recordStream = new stream.Transform({objectMode: true})
    recordStream._transform = function(line, encoding, done) {
        //don't use apache parse!  var logRecord = parse(line.toString());
        var serializedRecord = JSON.stringify(logRecord);
        this.push(serializedRecord);
        totLogLines ++;
        done();
    }

    event.Records.forEach(function(record) {
        var bucket = record.s3.bucket.name;
        var objKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        s3LogsToES(bucket, objKey, context, lineStream, recordStream);
    });
}
