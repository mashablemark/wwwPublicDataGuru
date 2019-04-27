//npm install request cheerio
//node crawler.js

/*
Problem: sec.gov limits request to 10 per second.  To ingest a quarter, we need to copy down:
  a. 60 daily indexes
  b. 60,000 ownership filings * (1 index-headers.html + 1 XML file) = 120,000 GETs
  c.  6,000 financial statement * (1 index-headers.html + 5 HTML + 5 XML files) = 66,000 GETs
Min time = 186,060 files download / 10/s / 3600s/h = 5.2 hours

On download, indexes and targeted submissions files will be stored in S3 and Lambda functions triggered for parsing.

Note that that the routine can be rerun to:
  1. verify no missing days/submissions
  2. retrigger Lambda function and parsing
 */

var AWS = require('aws-sdk'); 
var request = require('request');
var mysql = require('mysql');
var secure = require('./secure');


var s3 = new AWS.S3();
var con;  //global database connection

//1000180|SANDISK CORP|4/A|2016-02-24|edgar/data/1000180/0001242648-16-000070.txt
var targetFormTypes= ['3', '3/A', '4', '4/A', '5', '5/A',  '10-Q', '10-Q/A', '10-K', '10-K/A'];
var indexLineFields = {CIK: 0, CompanyName: 1, FormType: 2, DateFiled: 3, Filename: 4};

var processControl = {
    secDomain: 'https://www.sec.gov/Archives/',
    start: {
        year: 2016,
        q: 1
    },
    end: {
        year: 2016,
        q: 1
    },
    //offset: 0, //REMOVE OR SET TO 0 TO ENSURE FULL SCRAPE AFTER TESTING
    stickyFetch: true, // once a fetch to sec.gov is needed (not found in restapi.publicdata.guru bucket), skip all future local read attempts to speed up new batch
    lastDownloadTime: false,
    retrigger: false  //master mode determines whether existing index-headers.htm are rewritten if already exist to retrigger Lambda function
};

startCrawl(processControl);

function startCrawl(processControl){
    let db_info = secure.publicdataguru_dbinfo();
    con = mysql.createConnection({ //global db connection
        host: db_info.host,
        user: db_info.user,
        password: db_info.password,
        database: 'secdata'
    });

    con.connect(function(err) {
        if (err) throw err;
        ingestNextQuarter(processControl);  //process one quarter only!
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
    processControl.indexUrl = 'edgar/full-index/'
        + processControl.current.year + '/QTR' + processControl.current.q + '/master.idx';
    await processQuarterlyIndex(processControl)
}

async function processQuarterlyIndex(processControl, callback) {
    let idxUrl = processControl.indexUrl;
    logEvent('quarter ingest', 'fetching ' + idxUrl, true);
    let indexBody = await fetch(processControl, processControl.indexUrl, true);
    let lines = indexBody.split('\n');

    logEvent('quarter ingest', 'index ' + idxUrl + ' ('+(lines.length-10)+' submissions)', true);
    for (let lineNum = 10+(processControl.offset||0); lineNum < lines.length; lineNum++) {
        let lineParts = lines[lineNum].split('|');
        if (lineParts.length == 5) {
            if (targetFormTypes.indexOf(lineParts[indexLineFields.FormType]) != -1) {
                await getSubmission(lineParts, lineNum);
            }
            if(lineNum%100 == 0) console.log(processControl);  //240 per quarterly ingest (over 5+ hours) = 1 per minute
        }
    }


    async function getSubmission(lineParts, lineNum) {
        let submissionPathParts = lineParts[indexLineFields.Filename].split('/');
        let adsh = submissionPathParts.pop().split('.')[0];
        let submissionPath = submissionPathParts.join('/') + '/' + adsh.replace(/-/g, '') + '/';
        let indexHeaderFilename = submissionPath + adsh + '-index-headers.html';
        let oldFetchCount = processControl.fetchCount;
        console.log(lineNum + ': ' + lineParts[indexLineFields.DateFiled] + ' ' + indexHeaderFilename);
        let indexHeaderBody = await fetch(processControl, indexHeaderFilename, false);  //must be saved after other files present
        let fetchedIndexHeader = oldFetchCount != processControl.fetchCount;
        let links = indexHeaderBody.match(/<a href="\S+\.(html|htm|xml)"/g);
        let i;
        if (links) {
            let promisesToCollect = [];
            try {
                for (i = 0; i < links.length; i++) {
                    let fileName = links[i].substring(9, links[i].length - 1);
                    let linkPos = indexHeaderBody.indexOf(links[i]);
                    let sectionStart = indexHeaderBody.substring(0, linkPos).lastIndexOf('&lt;DOCUMENT&gt;');
                    let ideaDoc = indexHeaderBody.substring(sectionStart, linkPos).indexOf("IDEA: XBRL DOCUMENT");
                    if (ideaDoc === -1) {
                        //console.log('getting links['+i+']: '+ links[i]);
                        promisesToCollect.push(fetch(processControl, submissionPath + fileName, true));  //allow simultaneously fetches
                    }
                }
                if (processControl.retrigger || fetchedIndexHeader) {
                    for (let p = 0; p < promisesToCollect.length; p++) {
                        //console.log('collecting promisesToCollect['+p+']');
                        await promisesToCollect[p];
                    }  //simultanteous fetches must all complete before putting the index-header file
                    put(processControl, indexHeaderBody, indexHeaderFilename); //save or resave = trigger lambda function and API updates asyncrhonously (no await)
                }
            } catch {
                logEvent('ERROR edgarCrawl: copying link files', lineParts[indexLineFields.DateFiled] + ' i=' + i + ' in ' + links.join('|'), true)
            }
        } else {
            logEvent('ERROR edgarCrawl: links not find in index-headers', lineParts.join('|') + ' ' + indexHeaderFilename, true)
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
        setTimeout(resolve, ms);
    })
}

function logEvent(type, msg, display){
    runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
    if(display) console.log(type, msg);
}

function q(value, isLast){
    if(typeof value !== 'undefined'){
        return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast?'':',');
    } else {
        return ' null'+ (isLast?'':',');
    }
}

function runQuery(sql, callback){
    try{
        con.query(sql, function(err, result, fields) {
            if(err){
                console.log(sql);
                logEvent('bad query', sql, true);
                throw err;
            }
            if(callback) callback(result, fields);
        });
    } catch(err) {
        console.log(sql);
        logEvent("fatal MySQL error", sql, true);
        throw err;
    }
}
