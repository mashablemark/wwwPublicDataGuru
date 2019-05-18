//Lambda function is triggered by S3 PUT event of EDGAR Archives bucket where file suffix = '-index-headers.html'
//avg execution time 400ms to 2s (peak exec = 4s on db startup and  large index file)
//cost = 500,000 filings per * $0.000000208 per 100ms (192MB size) * 2s * 10 (100ms to s) = $2.08 per year
//note: 128MB container has no spare memory when run hard
//todo: consider using DB with a transaction  to S3 read = faster + possibly allow for concurrent lambdas of processIndexHeadrs

//module variables (persist between handler calls when ctainers are reused = prevalent during high usage periods)
var AWS = require('aws-sdk');
var dailyIndex = false;  //daily index as parsed object needs initiation than can be reused as long as day is same

exports.handler = async (event, context) => {
    var s3 = new AWS.S3();
    //event object description https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html
    const firstS3record = event.Records[0].s3;
    let bucket = firstS3record.bucket.name;
    let key = firstS3record.object.key;
    const size = firstS3record.object.bytes;
    const folder = key.substr(0, key.lastIndexOf('/')+1);

    //1. read the index.hear.html file contents
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

    //2. parse header info and create submission object
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

    //3. IF NEEDED start async reading of daily index file (completed in step 5)
    const acceptanceDate = new Date(thisSubmission.acceptanceDateTime.substr(0,4) + "-" + thisSubmission.acceptanceDateTime.substr(4,2)
        + "-" + thisSubmission.acceptanceDateTime.substr(6,2) + 'T' + thisSubmission.acceptanceDateTime.substr(8,2)+':'
        + thisSubmission.acceptanceDateTime.substr(10,2)+':'+ thisSubmission.acceptanceDateTime.substr(12,2)+'Z');
    acceptanceDate.setUTCHours(acceptanceDate.getUTCHours()+6);  //submission accepted after 5:30P are disseminated the next day
    acceptanceDate.setUTCMinutes(acceptanceDate.getUTCMinutes()+30);
    const indexDate = acceptanceDate.toISOString().substr(0,10);
    let dailyIndexObject = false;
    if(!dailyIndex || dailyIndex.date != indexDate) {
        dailyIndexObject = new Promise((resolve, reject) => {
            s3.getObject({
                Bucket: "restapi.publicdata.guru",
                Key: "sec/indexes/EDGARDailyFileIndex_"+ indexDate + ".json"
            }, (err, data) => {
                if (err) // not found = return new empty archive for today
                    resolve({
                        "title": "daily EDGAR file index for "+indexDate,
                        "format": "JSON",
                        "date": indexDate,
                        "submissions": []
                    });
                else
                    resolve(JSON.parse(data.Body.toString('utf-8')));   // successful response  (alt method = createReadStream)
            });
        });
    }

    //4. parse and add hyperlinks to submission object
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
    //5. IF NEEDED: finish reading daily archive (create new archive if not found)
    if(!dailyIndex || dailyIndex.date != indexDate) {
        dailyIndex = await dailyIndexObject;
    }

    //6. add new submission
    dailyIndex.submissions.push(thisSubmission);

    //7. async write out last10Index.json (complete in step 9
    const now = new Date();
    const last10IndexBody = {
        "lastUpdated": now.toISOString(),
        "title": "last 10 EDGAR submissions micro-index of submission date (updated prior to full indexes)",
        "format": "JSON",
        "indexDate": indexDate,
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
            Key: "sec/indexes/EDGARDailyFileIndex_"+ indexDate + ".json"
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
    await last10Index;
    await revisedIndex;

    //10.  check if detect form is past of a form family that is scheduled for additional processing (eg. parse to db and update REST API file)
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
        console.log('invoking '+ processor);
        let payload = JSON.stringify(thisSubmission, null, 2); // include all props with 2 spaces (not sure if truly required)
        //important!  even though the invocation is async (InvocationType: 'Event'), you must await to give enough time to invoke!
        let lambdaResult = await new Promise((resolve, reject)=> { lambda.invoke(  //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
            {
                FunctionName: processor,
                Payload: payload,
                InvocationType: 'Event'
            },
            function(error, data) {
                if (error) {
                    console.log(error);
                    reject(error);
                }
                if(data.Payload){
                    context.succeed(data.Payload);
                }
                console.log('successfully invoked ' + processor);
                resolve(data);
            });
        });
        console.log(JSON.stringify(payload));
        console.log(lambdaResult);
    }

    //11. terminate by returning from handler (node Lamda functions end when REPL loop is empty)
    return {status: 'ok'};
};

function  getAddresses(thisSubmission, indexHeaderBody, processor){
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