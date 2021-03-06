//to package common.js a Lambda layer for node 8.10 (note:  running as node 10.x Lambda layer causes "Error: Cannot find module 'lodash/assign'")
//zip -r common.zip nodejs/node_modules/common.js nodejs/node_modules/secure.js nodejs/node_modules/mysql nodejs/node_modules/htmlparser2 nodejs/node_modules/entities nodejs/node_modules/cheerio nodejs/node_modules/inherits nodejs/node_modules/domhandler nodejs/node_modules/domelementtype nodejs/node_modules/lodash nodejs/node_modules/parse5 nodejs/node_modules/dom-serializer nodejs/node_modules/css-select nodejs/node_modules/domutils nodejs/node_modules/nth-check nodejs/node_modules/boolbase nodejs/node_modules/css-what nodejs/node_modules/bignumber.js nodejs/node_modules/readable-stream nodejs/node_modules/core-util-is nodejs/node_modules/isarray nodejs/node_modules/process-nextick-args nodejs/node_modules/safe-buffer nodejs/node_modules/string_decoder nodejs/node_modules/safe-buffer nodejs/node_modules/util-deprecate nodejs/node_modules/safe-buffer nodejs/node_modules/sqlstring

//module vars that are not exported
const mysql = require('mysql');
const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'});
const secure = require('./secure');  //DO NOT COMMIT!
/*secure.js template:
module.exports = {
    secdata: function () {
        return {
            host: "localhost or domain or ip",
            uid: "secdata",
            password: "xxxxxxx",
            database: "secdata"
        }
    }
};

 */

let dbInitializationFlag = false; //set on first connection wth console.log for debugging
let s3InitializationFlag = false; //set on first initialization wth console.log for debugging
let s3 = false,  //error can occur if s3 object created from AWS SDK is old & unused
    s3Age = false;
const s3MaxAge = 100000; //get a new S3 object every 100s to avoid credentials timing out.
let dynamodb = false;
process.on('unhandledRejection', (reason, promise) => { console.log('Unhandled rejection at: ', reason.stack || reason)});  //outside of handler = run once

let me = {
    con: false,  //global db connection
    bucket: "restapi.publicdata.guru",  //default bucket
    q: (value, isLast, maxCharLength) => {
        if (typeof value !== 'undefined' && value !== '' && value != null && value !== false) { //note index-headers parse missing tags (e.g street2) as false
            if (maxCharLength && typeof value == 'string' && value.length > maxCharLength) {
                console.log("maxCharLength of " + maxCharLength + " exceeded.  Actual length = " + value.length + " for: " + value);
                value = value.substr(0, maxCharLength);
            }
            if (value === 'true' || value === 'false') return value + (isLast ? '' : ','); //string "false" from filing (!== false)
            return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast ? '' : ',');
        } else {
            return ' null' + (isLast ? '' : ',');
        }
    },
    createDbConnection: (dbInfo, logInfo = false) => {
        return new Promise((resolve, reject) => {
            let newConn = mysql.createConnection(dbInfo || secure.publicdataguru_dbinfo()); // (Re)create reusable connection for this Lambda
            newConn.connect(async err => {
                if(err){
                    console.log('error when connecting to db:', JSON.stringify(err));
                    reject(new Error(err.message));
                } else {
                    newConn.on('error', async function(err) {
                        console.log('db error', JSON.stringify(err));
                        if (err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
                            me.con = await me.createDbConnection(dbInfo);
                            await me.logEvent('db connection lost and recovered', JSON.stringify(err), true)
                        } else {
                            throw new Error(err.message);
                        }
                    });
                    if(logInfo){
                        me.con= newConn;  //if not set, runQuery will create another
                        //let status = await me.runQuery('SHOW STATUS WHERE variable_name LIKE "Threads_%" OR variable_name = "Connections"');
                        let status = await me.runQuery('SHOW STATUS WHERE variable_name = "Connections"');
                        console.log(`createDbConnection new mysql connection (dbInitializationFlag = ${dbInitializationFlag }); ${JSON.stringify(status.data[0])}`);
                    }
                    dbInitializationFlag = true;
                    resolve(newConn);
                }
            });
        });
    },
    getDisseminationDate: (acceptanceDateTime) => { //submissions accepted after 5:30PM are disseminated the next day
        const disseminationUTCDate = new Date(acceptanceDateTime.substr(0,4) + "-" + acceptanceDateTime.substr(4,2) + "-"
            + acceptanceDateTime.substr(6,2) + 'T' + acceptanceDateTime.substr(8,2)+':'+acceptanceDateTime.substr(10,2)+':'+acceptanceDateTime.substr(12,2)+'Z');
        disseminationUTCDate.setUTCHours(disseminationUTCDate.getUTCHours()+6);
        disseminationUTCDate.setUTCMinutes(disseminationUTCDate.getUTCMinutes()+30);
        if(disseminationUTCDate.getUTCDay()==6) disseminationUTCDate.setUTCDate(disseminationUTCDate.getUTCDate()+2);  //Saturday to Monday
        if(disseminationUTCDate.getUTCDay()==0) disseminationUTCDate.setUTCDate(disseminationUTCDate.getUTCDate()+1);  //Sunday to Monday
        //todo: skip national holidays too!
        return disseminationUTCDate;
    },
    closestCalendricalPeriod: (start, end) => {
        let workingEnd = new Date(end);
        if(start){
            let durationInQuarters = Math.round((end - start)/(365/4*24*3600*1000));
            if(durationInQuarters==1) {
                workingEnd.setDate(end.getDate()-40);
                return 'CY' + workingEnd.getFullYear() + 'Q' + (Math.floor(workingEnd.getMonth()/3) + 1);
            }
            if(durationInQuarters==4) {
                workingEnd.setDate(end.getDate()-180);
                return 'CY' + workingEnd.getFullYear();
            }
            return null;  //if qtrs not 1 or 4 (or 0);
        } else {  //instantaneous measurement => Q=0
            workingEnd.setDate(end.getDate()-40);
            return 'CY' + workingEnd.getFullYear() + 'Q' + (Math.floor(workingEnd.getMonth()/3) + 1) + 'I';
        }
    },
    wait: (ms) => {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    },
    runQuery: (sql) => {
        return new Promise(async (resolve,reject) =>  {
            if(!me.con) me.con = await me.createDbConnection();
            if(sql.indexOf("''fatal MySQL error")===-1){
                //note: con.execute prepares the statement and will run into max_prepared_stmt_count limit
                me.con.query(sql, async (err, result, fields) => {
                    if(err) {
                        try{
                            await me.logEvent("fatal MySQL error: "+err.message, sql, true);
                        } catch(err2){
                            console.log('unable to write to database');
                        }
                        if(err.code === 'ER_LOCK_DEADLOCK') {
                            setTimeout(() => {  //try again in 50ms
                                me.con.query(sql, async (err, result, fields) => {
                                    if(err){
                                        await me.logEvent("fatal MySQL error on deadlock retry: "+err.message, sql, true);
                                        reject(err);
                                    } else {
                                        await me.logEvent("resolved deadlock on retry: ", sql, true);
                                        resolve({data: result, fields: fields});
                                    }
                                });
                            }, 50);
                        } else
                            reject(err);
                    }
                    resolve({data: result, fields: fields});
                });
            } else {
                console.log('endless loop detected in runQuery');
                process.exit();
            }
        });
    },
    logEvent: async (type, msg, display) => {
        if(display) console.log(type, msg);
        await me.runQuery("insert into eventlog (event, data) values ("+me.q(type)+me.q(msg.substr(0,59999), true)+")");  //data field is varchar 60,000
    },
    getS3Library: () => {
        let now = new Date();
        if(!s3 || !s3Age || ((now.getTime()-s3Age)>s3MaxAge)){
            if(s3Age && ((now.getTime() - s3Age)<=s3MaxAge)) {
                console.log(`s3 library untimely death report:  Age = ${s3Age - now.getTime()} ms old (s3MaxAge = ${s3MaxAge} ms`);
            }
            s3 = new AWS.S3();
            s3Age = now.getTime();
            console.log('created new S3 object from SDK (age='+s3Age+')');
            if(!s3InitializationFlag){
                s3InitializationFlag = true;
                console.log('S3 initialized for first time and s3InitializationFlag set')
            }
        }
        return s3;
    },
    getS3ObjectSize: async (file) => {
        return new Promise((resolve, reject) => {
            let params = {
                Bucket: me.bucket,
                Key: file
            };
            me.getS3Library().headObject(params, (err, data) => {
                if (err) {  // an error occurred
                    console.log(err, err.stack);
                    reject(err, err.stack);
                }
                else { // successful response  (alt method = createreadstreeam)
                    resolve(data.ContentLength);
                }
            });
        });
    },
    readS3: async (file) => {
        return new Promise((resolve, reject) => {
            let params = {
                Bucket: me.bucket,
                Key: file
            };
            me.getS3Library().getObject(params, (err, data) => {
                if (err) {  // an error occurred
                    console.log(err, err.stack);
                    reject(err, err.stack);
                }
                else { // successful response  (alt method = createreadstreeam)
                    resolve(data.Body.toString('utf-8'));
                }
            });
        });
    },
    writeS3: (fileKey, text) => {
        return new Promise((resolve, reject) => {
            me.getS3Library().putObject({
                Body: text,
                Bucket: me.bucket,
                Key: fileKey
            }, (err, data) => {
                if (err) {
                    console.log(err, err.stack);
                    reject(err, err.stack);
                } // an error occurred
                else  resolve(data);           // successful response
            });
        });
    },
    getDDB: async (key, table = 'edgarAPI') => {
        return new Promise((resolve,reject)=>{
            if(!dynamodb) dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
            let params = {
                Key: {"restKey": {S: "test"} },
                TableName: table
            };
            dynamodb.getItem(params, function(err, data) {
                if (err) reject(err); // an error occurred
                else     resolve(data);           // successful response
            });
        });
    },
    putDDB: (key, object, table = 'edgarAPI') => {
        return new Promise((resolve, reject) => {
            if(typeof object == 'object') object = JSON.stringify(object);
            if(!dynamodb) dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
            let params = {
                Item: {
                    restKey: {S: key},
                    json: {S: object}
                },
                TableName: table
            };
            dynamodb.putItem(params, function (err, data) {
                if (err) reject(err); // an error occurred
                else     resolve(true);           // successful response
            });
        });
    },
    makeHash: (thing) => {
        if(typeof thing == 'object') thing = JSON.stringify(thing);
        return require('crypto').createHash('sha1').update(thing.toString()).digest('base64');
    },
    toTitleCase: function(title){
        let w, word, words = title.split(' ');
        const lcaseSmalls = ['A','An','And','In','Of','The'];
        for(w=0; w<words.length; w++){
            word = words[w].substr(0,1).toUpperCase() + words[w].substr(1).toLowerCase();
            if(w!=0 && lcaseSmalls.indexOf(word)!=-1) word = word.toLowerCase();
            words[w] = word;
        }
        return words.join(' ');
    },
    formatCIK: function(unpaddedCIK){ //accept int or string and return string with padded zero
        return '0'.repeat(10-unpaddedCIK.toString().length) + unpaddedCIK.toString()
    }
};

module.exports = me;


