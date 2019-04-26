//Lambda function is triggered by S3 PUT event of EDGAR Archives bucket where file suffix = '-index-headers.html'
//execution time 400ms to 2s
//cost = 500,000 filings per * $0.000000208 per 100ms (128MB size) * 2s * 10 (100ms to s) = $2.08 per year
//todo: consider using DB with a transaction  to S3 read = faster + possibly allow for concurrent lambdas of processIndexHeadrs

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

exports.handler = async (event, context) => {
    //event object description https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html
    const firstS3record = event.Records[0].s3;
    let bucket = firstS3record.bucket.name;
    let key = firstS3record.object.key;
    const size = firstS3record.object.bytes;
    const folder = key.substr(0, key.lastIndexOf('/')+1);
    const today = new Date();
    const isoStringToday = today.toISOString().substr(0,10);

    //1. start async reading of daily index file (completed in step 5)
    const dailyIndexObject = new Promise((resolve, reject) => {
        s3.getObject({
            Bucket: "restapi.publicdata.guru",
            Key: "sec/indexes/EDGARDailyFileIndex_"+ isoStringToday + ".json"
        }, (err, data) => {
            if (err) // not found = return new empty archive for today
                resolve({
                    "title": "daily EDGAR file index for "+isoStringToday,
                    "format": "JSON",
                    "date": isoStringToday,
                    "submissions": []
                });
            else
                resolve(JSON.parse(data.Body.toString('utf-8')));   // successful response  (alt method = createReadStream)
        });
    });

    //2. read the index.hear.html file contents
    const params = {
        Bucket: bucket,
        Key: key
    };
    const indexHeaderObject = new Promise((resolve, reject) => {
        s3.getObject(params, (err, data) => {
            if (err) console.log(err, err.stack); // an error occurred
            else     resolve(data.Body.toString('utf-8'));   // successful response  (alt method = createreadstreeam)
        });
    });
    const indexHeaderBody = await indexHeaderObject;

    //3. parse header info and create submission object
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
    //4. parse and add hyperlinks to submission object
    const rgxSECTableLinks = /\bR\d+\.htm\b/;
    const links = indexHeaderBody.match(/<a href="[^<]+<\/a>/g); // '/<a href="\S+"/g');
    for(let i=0; i<links.length;i++){
        let firstQuote = links[i].indexOf('"');
        let relativeKey = links[i].substr(firstQuote+1, links[i].indexOf('"',firstQuote+1)-firstQuote-1);
        let firstCloseCarrot = links[i].indexOf('>');
        let description = links[i].substr(firstCloseCarrot+1, links[i].indexOf('<',firstCloseCarrot+1)-firstCloseCarrot-1);
        let linkLocation = indexHeaderBody.indexOf(links[i]);
        let linkSection = indexHeaderBody.substring(indexHeaderBody.substr(0, linkLocation).lastIndexOf('&lt;DOCUMENT&gt;'), linkLocation);
        let fileType = headerInfo(linkSection, '&lt;TYPE&gt;');
        let fileDescription = headerInfo(linkSection, '&lt;DESCRIPTION&gt;');
        let skip = fileDescription=='IDEA: XBRL DOCUMENT'; //don't add the OSD created derived table to the JSON index
        if(!skip) {
            let thisFile = {
                file: relativeKey,
                title: description
            };
            if(fileType) thisFile.fileType = fileType;
            if(fileDescription) thisFile.fileDescription = fileDescription;
            thisSubmission.files.push(thisFile);
        }
    }
    //5. read daily archive (create new archive if not found)
    const dailyIndex = await dailyIndexObject;
    //6. add new submission
    dailyIndex.submissions.push(thisSubmission);

    //7. async write out last10Index.json (complete in step 9
    const last10IndexBody = {
        lastUpdated: today.toISOString(),
        "title": "last 10 EDGAR submissions micro-index (updated prior to full indexes)",
        "format": "JSON",
        "date": isoStringToday,
        "last10Submissions": dailyIndex.submissions.slice(-10)
    };
    const last10Index = new Promise((resolve, reject) => {
        s3.putObject({
            Body: JSON.stringify(last10IndexBody),
            Bucket: "restapi.publicdata.guru",
            Key: "sec/indexes/last10EDGARSubmissionsFastIndex.json"
        }, (err, data) => {
            if (err) {
                console.log('S3 write error');
                console.log(err, err.stack); // an error occurred
                reject(err);
            }
            else {
                resolve(data); // successful response
            }
        });
    });
    //8. sync write out full dailyindex.json (complete in step 9)
    const revisedIndex = new Promise((resolve, reject) => {
        s3.putObject({
            Body: JSON.stringify(dailyIndex),
            Bucket: "restapi.publicdata.guru",
            Key: "sec/indexes/EDGARDailyFileIndex_"+ isoStringToday + ".json"
        }, (err, data) => {
            if (err) {
                console.log('S3 write error');
                console.log(err, err.stack); // an error occurred
                reject(err);
            }
            else {
                resolve('successful s3 write'); // data); // successful response
            }
        });
    });
    //9.ensure writes are completed before letting this Lambda function terminate
    //console.log(await last10Index);
    //console.log(await revisedIndex);
    //console.log(thisSubmission.form);

    //10.  check if detect form is past of a form family that is scheduled for additional processing (eg. parse to db and update REST API file)
    // note:  Can be expanded to post processing of additional form families to create additional APIs such as RegistrationStatements, Form Ds...
    const formPostProcesses = {
        //ownership forms  (https://www.sec.gov/Archives/edgar/data/39911/000003991119000048/0000039911-19-000048-index-headers.html)
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
        '10-K/A': 'updateXBRLAPI'
        //form D processor??
        //registration statement processor?? (published public registration statement; not draft!)
    };

    if(formPostProcesses[thisSubmission.form]) {
        let processor = formPostProcesses[thisSubmission.form];

        //get additional meta data from header
        thisSubmission.bucket= firstS3record.bucket.name;
        thisSubmission.sic = headerInfo(indexHeaderBody, 'ASSIGNED-SIC');
        console.log('really?');
        await getAddresses(thisSubmission, indexHeaderBody, processor);

        let lambda = new AWS.Lambda({
            region: 'us-east-1'
        });
        console.log('about to invoke '+ processor);
        let payload = JSON.stringify(thisSubmission, null, 2); // include all props with 2 spaces (not sure if truly required)
        let li = lambda.invoke(  //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
            {
                FunctionName: processor,
                Payload: payload,
                InvocationType: 'Event'
            },
            function(error, data) {
                if (error) {
                    console.log(error);
                }
                if(data.Payload){
                    context.succeed(data.Payload);
                    console.log('succeeded in invoking ' + processor);
                }
            }
        );
        li.send();
        console.log('after ' + processor + ' invoke (but not from inside)');
        //console.log(payload);
    }

    //11. terminate by returning from handler (node Lamda functions end when REPL loop is empty)
    return {status: 'ok'}
};

async function  getAddresses(thisSubmission, indexHeaderBody, processor){

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
    console.log('hi');
    for(let addressType in addressesByType[processor]){
        console.log(addressType);
        let tags = addressesByType[processor][addressType];
        let rgxOuter = new RegExp('<'+tags[0]+'>(\n|\r|.)*<\/'+tags[0]+'>');
        let outerMatches = indexHeaderBody.match(rgxOuter);
        console.log(indexHeaderBody.length);
        console.log(outerMatches);
        if(outerMatches && outerMatches.length==1){
            console.log('outer match');
            let rgxAddress = new RegExp('<'+tags[1]+'>(\n|\r|.)*<\/'+tags[1]+'>');
            let addressMatches = outerMatches[0].match(rgxAddress);
            if(addressMatches && addressMatches.length==1){
                console.log('inner match');
                thisSubmission[addressType] = {
                    street1: headerInfo(addressMatches[0], 'STREET1'),
                    street2: headerInfo(addressMatches[0], 'STREET1'),
                    city: headerInfo(addressMatches[0], 'CITY'),
                    state: headerInfo(addressMatches[0], 'STATE'),
                    zip: headerInfo(addressMatches[0], 'ZIP')
                };
            }
        }
    }
    return true;
}
const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
function headerInfo(fileBody, tag){
    let tagStart = fileBody.indexOf(tag);
    if(tagStart==-1) return false;
    return fileBody.substring(tagStart + tag.length, fileBody.indexOf('\n', tagStart+1)).replace(rgxTrim,'');
}