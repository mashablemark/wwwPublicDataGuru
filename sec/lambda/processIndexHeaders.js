//Lambda function is triggered by S3 PUT event of EDGAR Archives bucket where file suffix = '-index-headers.html'
//avg execution time 400ms to 2s (peak exec = 4s on db startup and  large index file)
//cost = 500,000 filings per * $0.000000208 per 100ms (192MB size) * 2s * 10 (100ms to s) = $2.08 per year
//note: 128MB container has no spare memory when run hard
//todo: consider using DB with a transaction  to S3 read = faster + possibly allow for concurrent lambdas of processIndexHeadrs

//module level variables (note: these persist between handler calls when containers are reused = prevalent during high usage periods)
var AWS = require('aws-sdk');
var dailyIndex = false;  //daily index as parsed object needs initiation than can be reused as long as day is same

const common = require('common');

exports.handler = async (event, context) => {

    //event object description documation @ https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html
    //optional event controls can be added by crawlers that explicitly call Lambda (instead of normal S3 PUT trigger):
    //  event.crawlerOverrides.body (allows body of -index-headers.html file to be passed in eliminating S3 fetch)
    //  event.crawlerOverrides.noDailyIndexProcessing
    //  event.crawlerOverrides.noLatestIndexProcessing
    const firstS3record = event.Records[0].s3;
    common.bucket = firstS3record.bucket.name;
    let key = firstS3record.object.key;
    //const size = firstS3record.object.bytes;
    const folder = key.substr(0, key.lastIndexOf('/')+1);
    //1. read the index-header.html file
    console.log('step 1');
    let indexHeaderBody;
    if(event.crawlerOverrides && event.crawlerOverrides.body){
        indexHeaderBody = event.crawlerOverrides.body;
    } else {
        const indexHeaderReadPromise = common.readS3(key);
        console.log('getting ' + JSON.stringify(key));
        indexHeaderBody = await indexHeaderReadPromise;
    }

    //2. parse header info and create submission object
    console.log('step 2');
    const thisSubmission = {
        path: folder,
        adsh: headerInfo(indexHeaderBody, '<ACCESSION-NUMBER>'),
        cik: headerInfo(indexHeaderBody, '<CIK>'),
        fileNum: headerInfo(indexHeaderBody, '<FILE-NUMBER>'),
        form: headerInfo(indexHeaderBody, '<FORM-TYPE>'),
        filingDate: headerInfo(indexHeaderBody, '<FILING-DATE>'),
        period: headerInfo(indexHeaderBody, '<PERIOD>'),
        acceptanceDateTime:  headerInfo(indexHeaderBody, '<ACCEPTANCE-DATETIME>'),
        indexHeaderFileName: firstS3record.object.key,
        files: []
    };


    //3. parse and add hyperlinks to submission object
    console.log('step 3');
    const links = indexHeaderBody.match(/<a href="[^<]+<\/a>/g); // '/<a href="\S+"/g');
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

    //4. add new submission to database
    console.log('step 4');
    let q = common.q;  //shorthandle
    let shortPath = folder.replace('sec/','').replace('Archives/','').replace('edgar/data/','');
    let sql = 'call submissionAdd('+q(shortPath)+q(thisSubmission.acceptanceDateTime)+q(JSON.stringify(thisSubmission),true)+')';
    console.log(sql);
    const newSubmissionPromise = common.runQuery(sql);

    //5.  check if detect form is past of a form family that is scheduled for additional processing (eg. parse to db and update REST API file)
    console.log('step 5');
    // note:  Can be expanded to post processing of additional form families to create additional APIs such as RegistrationStatements, Form Ds...
    const formPostProcesses = {
        //ownership forms   (https://www.sec.gov/Archives/edgar/data/39911/000003991119000048/0000039911-19-000048-index-headers.html)
        '3': 'updateOwnershipAPI',
        '3/A': 'updateOwnershipAPI',
        '4': 'updateOwnershipAPI',
        '4/A': 'updateOwnershipAPI',
        '5': 'updateOwnershipAPI',
        '5/A': 'updateOwnershipAPI',
        //financial statement forms  (https://www.sec.gov/Archives/edgar/data/29905/000002990519000029/0000029905-19-000029-index-headers.html)
        '10-Q': 'updateXBRLAPI',
        '10-Q/A': 'updateXBRLAPI',
        '10-K': 'updateXBRLAPI',
        '10-K/A': 'updateXBRLAPI',
        //form D processor
        'D': 'updateFormDAPI',
        'D/A': 'updateFormDAPI'
        //registration statement processor?? (published public registration statement; not draft!)
    };

    if(formPostProcesses[thisSubmission.form]) {  //post processing required!
        let processor = formPostProcesses[thisSubmission.form];

        //get additional meta data from header
        thisSubmission.bucket= firstS3record.bucket.name;
        thisSubmission.sic = headerInfo(indexHeaderBody, '<ASSIGNED-SIC>');
        thisSubmission.ein = headerInfo(indexHeaderBody, '<IRS-NUMBER>');
        thisSubmission.incorporation = {
            state: headerInfo(indexHeaderBody, '<STATE-OF-INCORPORATION>'),
            country: headerInfo(indexHeaderBody, '<COUNTRY-OF-INCORPORATION>')
        };
        await getAddresses(thisSubmission, indexHeaderBody, processor);

        //important!  even though the invocation is async (InvocationType: 'Event'), you must await to give enough time to invoke!
        let lambda = await new AWS.Lambda({
            region: 'us-east-1'
        });

        thisSubmission.timeStamp = (new Date).getTime();
        let payload = JSON.stringify(thisSubmission, null, 2); // include all props with 2 spaces (not sure if truly required)
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

    //8. check if new step function needs to be start or if age of existing new submission indicates a failure = fire writeDetailedIndexes immediately
    const newSubmissionsInfo = await newSubmissionPromise;
    const batchAgeSeconds = newSubmissionsInfo.data[0][0].age;
    if(batchAgeSeconds) {
        if(batchAgeSeconds>12){  //give a 2s buffer for slow starts
            common.logEvent('ERROR SubmissionsNew batch age requires emergency writeDetailedIndexes','age: ' + batchAgeSeconds + ' s', true);
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
        }
    } else {  //null = new submission -> start batch timer
        await new Promise((resolve, reject)=> {
            let params = {
                stateMachineArn: 'arn:aws:states:us-east-1:008161247312:stateMachine:indexBatchTimer', //indexBatchTimer
                input: '{}'  //requires a JSON not an actual js object
            };
            var stepFunctions = new AWS.StepFunctions();
            stepFunctions.startExecution(params, function (err, data) {
                if (err) {
                    common.logEvent('err while executing step function');
                    reject(err);
                } else {
                    console.log('started execution of step function');
                    resolve(true);
                }
            });
        });
    }
    //9. terminate by returning from handler (node Lamda functions end when REPL loop is empty)
    return {status: 'ok'};
};

function getAddresses(thisSubmission, indexHeaderBody, processor){
    console.log(processor);
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