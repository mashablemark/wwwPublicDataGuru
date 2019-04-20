//Lambda function is triggered by S3 PUT event of EDGAR Archives bucket where file suffix = '-index-headers.html'
//execution time 400ms to 2s
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
        bucket: firstS3record.bucket.name,
        indexHeaderFileName: firstS3record.object.key,
        files: []
    };
    //4. parse and add hyperlinks to submission object
    const links = indexHeaderBody.match(/<a href="[^<]+<\/a>/g); // '/<a href="\S+"/g');
    for(let i=0; i<links.length;i++){
        let firstQuote = links[i].indexOf('"');
        let relativeKey = links[i].substr(firstQuote+1, links[i].indexOf('"',firstQuote+1)-firstQuote-1);
        let firstCloseCarrot = links[i].indexOf('>');
        let description = links[i].substr(firstCloseCarrot+1, links[i].indexOf('<',firstCloseCarrot+1)-firstCloseCarrot-1);
        thisSubmission.files.push({
            file: relativeKey,
            title: description
        })
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
    console.log(await last10Index);
    console.log(await revisedIndex);

    //10.  if this submission an ownership filing?  If so, launch updateOwnershipAPI Lambda function before dying
    const ownsershipForms = {
        '3': 'xml',
        '3/A': 'xml',
        '4': 'xml',
        '4/A': 'xml',
        '5': 'xml',
        '5/A': 'xml'
    };
    if(ownsershipForms[thisSubmission.form]) {
        let lambda = new AWS.Lambda({
            region: 'us-east-1'
        });
        lambda.invokeAsync(
            { //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
                FunctionName: 'arn:aws:lambda:us-east-1:008161247312:function:updateOwnershipAPI',
                Payload: JSON.stringify(thisSubmission, null, 2) // include all props with 2 spaces (not sure if truly required)
                InvocationType: 'Event' //for debug, comment out to default to synchronous mode and add err handler
            },
            function(err, data) {
                //if (err) console.log(err, err.stack); // an error occurred
                //else     console.log(data);           // successful response
            });
        //console.log(output);
        //console.log('found an ownership form and invoked updateOwnershipAPI');
    }
    //11. if isFinancialStatement submission?  If so, launch updateXBRLAPI Lambda function before dying
    const financialStatementForms = {
        '10Q': 'html',
        '10Q/A': 'html',
        '10K': 'html',
        '10K/A': 'html',
    };
    if(financialStatementForms[thisSubmission.form]) {
        let lambda = new AWS.Lambda({
            region: 'us-east-1'
        });
        lambda.invokeAsync({  //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
            FunctionName: 'updateXBRLAPI',
            Payload: JSON.stringify(thisSubmission, null, 2),
            InvocationType: 'Event'  //for debug, comment out to default to synchronous mode and add err handler
        });
    }
    return {status: 'ok'}
};

const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
function headerInfo(fileBody, tag){
    let tagStart = fileBody.indexOf(tag);
    if(tagStart==-1) return false;
    return fileBody.substring(tagStart + tag.length, fileBody.indexOf('<', tagStart+1)-1).replace(rgxTrim,'');
}