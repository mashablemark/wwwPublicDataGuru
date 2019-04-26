//npm install request cheerio
//node crawler.js
//grab first match of rgxSection = new RegExp('<'+tag+'>(\n|\r|.)*<\/'+tag+'>')
/*
Problem: sec.gov limits request to 10 per second.  To ingest a quarter, we need to copy down:
  a. 60 daily indexes
  b. 60,000 ownership filings * (1 index-headers.html + 1 XML file) = 120,000 GETs
  c.  6,000 financial statement * (1 index-headers.html + 5 HTML + 5 XML files) = 66,000 GETs
Min time = 186,060 download / 10/s / 3600s/h = 5.2 hours

On download, indexes and targeted submissions files will be stored in S3 and Lambda functions triggered for parsing.

Note that that the routine can be rerun to:
  1. verify no missing days/submissions
  2. retrigger Lambda function and parsing
 */

var AWS = require('aws-sdk'); 
var request = require('request');
var mysql = require('mysql');
var secure = require('./secure');

var con,  //global db connection
    secDomain = 'https://www.sec.gov';
//1000180|SANDISK CORP|4/A|2016-02-24|edgar/data/1000180/0001242648-16-000070.txt
var targetFormTypes= ['3', '3/A', '4', '4/A', '5', '5/A',  '10-Q', '10-Q/A', '10-K', '10-K/A'];
var linePartsIndex = {CIK: 0, CompanyName: 1, FormType: 2, DateFiled: 3, Filename: 4};
var downloadedGB = 0;
var rgxXML = /<xml>[.\s\S]*<\/xml>/im;
var rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars

var processControl = {
    start: {
        year: 2016,
        q: 1
    },
    end: {
        year: 2016,
        q: 1
    },
    lastDownloadTime: false,
    retrigger: false  //master mode determines whether existing index-headers.htm are rewritten if already exist to retrigger Lambda function
};

startCrawl(processControl);

function startCrawl(processControl){
    let db_info = secure.secdata();
    con = mysql.createConnection({ //global db connection
        host: db_info.host,
        user: db_info.user,
        password: db_info.password,
        database: 'secdata'
    });

    con.connect(function(err) {
        if (err) throw err;
        ingestNextQuarter(processControl);  //entry point to program
    });
}

function ingestNextQuarter(processControl){
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
    processControl.indexUrl = secDomain + '/Archives/edgar/full-index/'
        + processControl.current.year + '/QTR' + processControl.current.q + '/master.idx';
    processQuarterlyIndex(processControl)
}

async function processQuarterlyIndex(processControl, callback) {
    var idxUrl = processControl.indexUrl;
    logEvent('quarter ingest', 'fetching ' + idxUrl, true);

    let indexBody = await fetch(processControl, processControl.indexUrl, true);
    var lines = indexBody.split('\n');
    delete indexBody;
    var lineNum = 10;  //start

    var sCnt = 0;
    for (let linnum = 10; linnum < lines.length; lineNum++) {
        var lineParts = lines[lineNum].split('|');
        if (lineParts.length == 5) {
            if (targetFormTypes.indexOf(lineParts[linePartsIndex.FormType]) != -1) {
                await getSubmission(lineParts);
            }
        }
    }


    async function getSubmission(lineParts) {
        let indexHeaderFilename = lineParts[linePartsIndex.Filename].replace('.txt','-index-headers.html');
        let oldFetchCount = processControl.fetchCount;
        let indexHeaderBody = await fetch(processControl, indexHeaderFilename, false);  //must be saved after other files present
        let fetchedIndexHeader = oldFetchCount != processControl.fetchCount;
        let submissionPathParts = indexHeaderFilename.split('/');
        submissionPathParts .pop();
        let submissionPath = submissionPathParts.join('/')+'/';
        let links = indexHeaderBody.match(/<a href="\S+\.(html|htm|xml)"/g);
        for(let i=0;i<links.length;i++){
            let fileName = links[i].substring(9, links[i].length-1);
            let linkPos = indexHeaderBody.indexOf(links[i]);
            let sectionStart = indexHeaderBody.substring(0, linkPos).lastIndexOf('&lt;DOCUMENT&gt;');
            let ideaDoc = indexHeaderBody.substring(sectionStart, linkPos).indexOf("IDEA: XBRL DOCUMENT");
            if(ideaDoc === -1){
                await fetch(processControl, submissionPath + fileName, true );
            }
        }
        if(processControl.retrigger || fetchedIndexHeader )
            put(processControl, indexHeaderBody, indexHeaderFilename); //save or resave = trigger lambda function and API updates
    }
}

async function fetch(processControl, fileName, autosave){
    //1. check local S3

    //2a. if found and retrigger, rewrite


//1. start async reading of daily index file (completed in step 5)

    const dailyIndexObject = new Promise((resolve, reject) => {
        s3.getObject({
            Bucket: "restapi.publicdata.guru",
            Key: "sec/"+fileName
        }, async (err, data) => {
            if (err) { // not found = return new empty archive for today
                //3. if not found, get from sec.gov (with at least 100ms between fetches!)
                let now = new Date();
                if (now - processControl.lastDownloadTime < 100) {
                    let t = await wait(100, now - processControl.lastDownloadTime);
                }
                request(secDomain + fileName, async function (error, response, body) {
                    if (error) {
                        logEvent('ERROR EDGAR file not file', secDomain + fileName);
                        processControl.missingCount = (processControl.missingCount||0) + 1;
                        reject(secDomain + fileName);
                    } else {
                        processControl.downloadedGB = (processControl.downloadedGB || 0) + indexBody.length / (1024 * 1024 * 1024);
                        processControl.fetchCount = (processControl.fetchCount || 0) + 1;

                        if(autosave) {
                            await put(processControl, body, fileName);
                        } else {
                            resolve(body);
                        }
                    }
                });
            } else {
                processControl.getCount = (processControl.getCount||0) + 1;
                resolve(data);
            }
        });
    });
    return await dailyIndexObject;

}
async function put(processControl, body, fileName) {
    return new Promise((resolve, reject) => {
        s3.putObject({
            Body: body,
            Bucket: "restapi.publicdata.guru",
            Key: "sec/" + fileName
        }, (err, data) => {
            if (err) {
                logEvent('ERROR unable to putObject', "sec/" + fileName);
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
