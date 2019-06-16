//npm install request cheerio
//node crawler.js

/*
This crawler fetches EDGAR quarterly indexes and copies the files of targeted submissions (targetFormTypes) to this account's S3 (restapi.publicdata.guru/sec/edgar/data/)

Problem: sec.gov limits request to 10 per second.  To ingest a quarter, we need to copy down:
  a. 60 daily indexes
  b. 60,000 ownership filings * (1 index-headers.html + 1 XML file) = 120,000 GETs
  c.  6,000 financial statement * (1 index-headers.html + 5 HTML + 5 XML files) = 66,000 GETs
Speed on M5.XL instance = 7,100 files / hr
Full quarter scrape of ownership & XBRL = 186,060 files / 7,500 file/hr = ~25 hours
On download, indexes and targeted submissions files will be stored in S3 and Lambda functions triggered for parsing.

Note that that the routine can be rerun to:
  1. verify no missing days/submissions
  2. retrigger Lambda function and parsing
 */

const AWS = require('aws-sdk');
const request = require('request');
const mysql = require('mysql');
const secure = require('./secure');


const s3 = new AWS.S3();

//1000180|SANDISK CORP|4/A|2016-02-24|edgar/data/1000180/0001242648-16-000070.txt
const targetFormTypes= {
    //'S-1': 'noProcessing',
    //'S-1/A': 'noProcessing',
    'D': 'syncProcessing',
    'D/A': 'syncProcessing',
    '3': 'asyncProcessing',
    '3/A': 'asyncProcessing',
    '4': 'asyncProcessing',
    '4/A': 'asyncProcessing',
    '5': 'asyncProcessing',
    '5/A': 'asyncProcessing',
    '10-Q': 'asyncProcessing',
    '10-Q/A': 'asyncProcessing',
    '10-K': 'asyncProcessing',
    '10-K/A': 'asyncProcessing'
};
const indexLineFields = {CIK: 0, CompanyName: 1, FormType: 2, DateFiled: 3, Filename: 4};

const processControl = {
    secDomain: 'https://www.sec.gov/Archives/',
    start: {
        year: 2016,
        q: 1
    },
    end: {
        year: 2016,
        q: 1
    },
    updateAPIs: true,
    offset: 0, //REMOVE OR SET TO 0 TO ENSURE FULL SCRAPE AFTER TESTING
    //stickyFetch: true, // once a fetch to sec.gov is needed (not found in restapi.publicdata.guru bucket), skip all future local read attempts to speed up new batch
    lastDownloadTime: false,
    retrigger: false  //master mode determines whether existing index-headers.htm are rewritten if already exist to retrigger Lambda function
};

let con;  //global database connection
createDbConnection(()=>{ingestNextQuarter(processControl)}); //entry point

function createDbConnection(callback) {
    con = mysql.createConnection(secure.publicdataguru_dbinfo()); // (Re)created global connection
    con.connect(function(err) {              // The server is either down
        if(err) {                            // or restarting (takes a while sometimes).
            console.log('error when connecting to db:', err);
            setTimeout(()=>{createDbConnection(callback)}, 100); // We introduce a delay before attempting to reconnect, to avoid a hot loop
        } else {
            if(callback) callback();
        }
    });
    con.on('error', function(err) {
        console.log('db error', err);
        if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
            createDbConnection();                         // lost due to either server restart, or a
        } else {                                      // connnection idle timeout (the wait_timeout
            throw err;                                  // server variable configures this)
        }
    });
}

async function ingestNextQuarter(processControl){
    if(!processControl.current){ //just starting
        processControl.current =
            { 	year: processControl.start.year,
                q: processControl.start.q };
        processControl.quartersProcessed = 0;
    } else { //increment is not end of loop
        processControl.quartersProcessed++;
        processControl.current.year += Math.floor(q/4);
        processControl.current.q = (q % 4) + 1;
        if(processControl.current.year + processControl.current.q/10>processControl.end.year + processControl.end.q/10){
            logEvent("finished EDGAR scrape", processControl.quartersProcessed + " quarters processed");
            return processControl.quartersProcessed;
        }
    }
    //master.idx sorted by CIK
    processControl.indexUrl = 'edgar/full-index/'
        + processControl.current.year + '/QTR' + processControl.current.q + '/master.idx';
    await processQuarterlyIndex(processControl);
    console.log('finished');
    process.exit();
}

async function processQuarterlyIndex(processControl, callback) {
    let idxUrl = processControl.indexUrl;
    logEvent('quarter ingest', 'fetching ' + idxUrl, true);
    let indexBody = await fetch(processControl, processControl.indexUrl, true);
    let lines = indexBody.split('\n');
    lines.splice(0,11); // ditch header rows
    //ensure that we index files by oldest to latest
    lines.sort((a,b)=> {return Date.parse(a.split('|')[indexLineFields.DateFiled]) - Date.parse(b.split('|')[indexLineFields.DateFiled])});
    logEvent('quarter ingest', 'index ' + idxUrl + ' ('+(lines.length-10)+' submissions)', true);
    for (let lineNum = (processControl.offset||0); lineNum < lines.length; lineNum++) {
        let lineParts = lines[lineNum].split('|');
        if (lineParts.length == 5) {
            console.log(lineNum + ': ' + lines[lineNum]);
            if (targetFormTypes[lineParts[indexLineFields.FormType]]) {
                processControl[lineParts[indexLineFields.FormType]] = (processControl[lineParts[indexLineFields.FormType]] || 0) + 1;
                processControl.progress = Math.round(lineNum/lines.length*1000)/10+'%';
                //await getSubmission(lineParts, lineNum);

                let updateProcess = targetFormTypes[lineParts[indexLineFields.FormType]];
                if(updateProcess != 'noProcessing'){
                    if(updateProcess == 'syncProcessing') {
                        processIndexHeader(lineParts);
                        await wait(150);  //process 10 submissions / second
                    } else {
                        processIndexHeader(lineParts);
                        await wait(150);  //process 10 submissions / second
                    }
                }
            }
            if(lineNum%1000 == 0) console.log(processControl);  //240 per quarterly ingest (over 5+ hours) = 1 per minute
        }
    }

    console.log(processControl);
    //terminate here


    async function getSubmission(lineParts, lineNum) {
        let submissionPathParts = lineParts[indexLineFields.Filename].split('/');
        let adsh = submissionPathParts.pop().split('.')[0];
        let submissionPath = submissionPathParts.join('/') + '/' + adsh.replace(/-/g, '') + '/';
        let indexHeaderFilename = submissionPath + adsh + '-index-headers.html';
        let oldFetchCount = processControl.fetchCount;
        console.log(lineNum + ': ' + lineParts[indexLineFields.FormType] + ' ' + indexHeaderFilename);
        let indexHeaderBody = await fetch(processControl, indexHeaderFilename, false);  //must be saved after other files present
        let fetchedIndexHeader = oldFetchCount != processControl.fetchCount;
        let links = indexHeaderBody.match(/<a href="\S+\.(html|htm|xml)"/g);
        let i;
        let promisesToCollect = [];
        if (links) {
            try {
                for (i = 0; i < links.length; i++) {
                    let fileName = links[i].substring(9, links[i].length - 1);
                    let linkPos = indexHeaderBody.indexOf(links[i]);
                    let sectionStart = indexHeaderBody.substring(0, linkPos).lastIndexOf('&lt;DOCUMENT&gt;');
                    let notIdeaDoc = indexHeaderBody.substring(sectionStart, linkPos).indexOf("IDEA: XBRL DOCUMENT")=== -1;
                    let mainDirectoryFile = fileName.indexOf('/') === -1;
                    if (notIdeaDoc  && mainDirectoryFile) {
                        //console.log('getting links['+i+']: '+ links[i]);
                        promisesToCollect.push(fetch(processControl, submissionPath + fileName, true));  //allow simultaneously fetches
                    }
                }

            } catch {
                logEvent('ERROR edgarCrawl: copying link files', lineParts[indexLineFields.DateFiled] + ' i=' + i + ' in ' + links.join('|'), true)
            }
        } else {
            logEvent('ERROR edgarCrawl: links not found in index-headers', lineParts.join('|') + ' ' + indexHeaderFilename, true)
        }
        if (processControl.retrigger || fetchedIndexHeader) {
            for (let p = 0; p < promisesToCollect.length; p++) {
                //console.log('collecting promisesToCollect['+p+']');
                await promisesToCollect[p];
            }  //all submission file's fetches must all complete before putting the index-header file
            put(processControl, indexHeaderBody, indexHeaderFilename); //save or resave = trigger lambda function and API updates asyncrhonously (no await)
        }
    }
}

async function fetch(processControl, fileName, autosave){
    return new Promise((resolve, reject) => {
        if(processControl.stickyFetch && processControl.s3CacheMiss){
            fetchFromSEC();
        } else {
            s3.getObject({
                Bucket: "restapi.publicdata.guru",
                Key: "sec/"+fileName
            }, (err, data) => {
                if (err) { // not found = return new empty archive for today
                    //3. if not found, get from sec.gov (with at least 100ms between fetches!)
                    processControl.s3CacheMiss = true;
                    fetchFromSEC();
                } else {
                    processControl.getCount = (processControl.getCount||0) + 1;
                    resolve(data.Body.toString('utf-8'));
                }
            });
        }

        function fetchFromSEC() {
            let now = new Date();
            let waitTime = Math.min(0, Math.max(100, 100 + processControl.lastDownloadTime - now));
            setTimeout(()=> {
                processControl.lastDownloadTime = new Date();
                //console.log(fileName+' not found in bucket;  need to fetch '+processControl.secDomain + fileName);
                request(processControl.secDomain + fileName, async function (error, response, body) {
                    if (error) {
                        logEvent('ERROR edgarCrawl: EDGAR file not file', processControl.secDomain + fileName, true);
                        processControl.missingCount = (processControl.missingCount || 0) + 1;
                        reject(processControl.secDomain + fileName);
                    } else {
                        processControl.downloadedGB = (processControl.downloadedGB || 0) + body.length / (1024 * 1024 * 1024);
                        processControl.fetchCount = (processControl.fetchCount || 0) + 1;
                        //console.log('fetched byte count: ' + body.length);
                        if (autosave) {
                            await put(processControl, body, fileName);
                            resolve(resolve);
                        } else {
                            resolve(body);
                        }
                    }
                });
            }, waitTime);
        }
    });
}

async function put(processControl, body, fileName) {
    return new Promise((resolve, reject) => {
        s3.putObject({
            Body: body,
            Bucket: "restapi.publicdata.guru",
            Key: "sec/" + fileName
        }, (err, data) => {
            if (err) {
                logEvent('ERROR edgarCrawl: unable to putObject', "sec/" + fileName, true);
                reject(err);
            } else {
                processControl.putCount = (processControl.putCount || 0) + 1;
                resolve(body);
            }
        });
    });
}

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(()=>{resolve(true)}, ms);
    })
}

function logEvent(type, msg, display){
    if(display) console.log(type, msg);
    runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
}

function q(value, isLast){
    if(typeof value !== 'undefined'){
        return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast?'':',');
    } else {
        return ' null'+ (isLast?'':',');
    }
}

function runQuery(sql, callback, retryFlag){
    try{
        con.query(sql, function(err, result, fields) {
            if(err){
                console.log(sql);
                logEvent('bad query', sql, true);
                throw err;
            } else {
                if(callback) callback(result, fields);
            }
        });
    } catch(err) {
        if(!retryFlag){
            setTimeout(1000, runQuery(sql, callback, true))  //try once giving enough time for a connection reset
        } else {
            console.log(sql);
            logEvent("fatal MySQL error", sql, true);
            throw err;
        }
    }
}

async function processIndexHeader(lineParts){
    let submissionPathParts = lineParts[indexLineFields.Filename].split('/');
    let adsh = submissionPathParts.pop().split('.')[0];
    let submissionPath = submissionPathParts.join('/') + '/' + adsh.replace(/-/g, '') + '/';
    let indexHeaderFilename = submissionPath + adsh + '-index-headers.html';
    return new Promise((resolve, reject) => {
        let lambda = new AWS.Lambda({
            region: 'us-east-1'
        });
        let fakeS3Event = {
            //event object description https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html
            Records: [
                {
                    s3: {
                        bucket: {name: "restapi.publicdata.guru"},
                        object: {key: "sec/"+indexHeaderFilename}
                    }
                }
            ],
            crawlerOverrides: {
                noLatestIndexProcessing: true
            }
        };

        let payload = JSON.stringify(fakeS3Event, null, 2); // include all props with 2 spaces (not sure if truly required)
        let li = lambda.invoke(  //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
            {
                FunctionName: 'processIndexHeaders',
                Payload: payload,
                InvocationType: 'RequestResponse'  //synchronous
            },
            function (error, data) {
                if (error) {
                    console.log(error);
                    reject(error);
                }
                if (data.Payload) {
                    resolve(data.Payload);
                } else {
                    resolve(0);
                }
            }
        );
    })
}