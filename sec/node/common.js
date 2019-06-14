//module vars that are not exported
const mysql = require('mysql');
const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'});
const secure = require('./secure');  //DO NOT COMMIT!
let s3 = false,  //error can occur if s3 object created from AWS SDK is old & unused
    s3Age = false;
const s3MaxAge = 10000; //todo:  research raising this from 10s to ??
let dynamodb = false;
process.on('unhandledRejection', (reason, promise) => { console.log('Unhandled rejection at: ', reason.stack|| reason)});  //outside of handler = run once

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
    createDbConnection: async (dbInfo) => {
        return new Promise((resolve, reject) => {
            let newConn = mysql.createConnection(dbInfo || secure.publicdataguru_dbinfo()); // (Re)create reusable connection for this Lambda
            newConn.connect(err => {
                if(err){
                    console.log('error when connecting to db:', JSON.stringify(err));
                    reject(new Error(err.message));
                } else {
                    newConn.on('error', async function(err) {
                        console.log('db error', JSON.stringify(err));
                        if (err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
                            me.con = await me.createDbConnection(dbInfo);
                            me.logEvent('db connection lost and recovered', JSON.stringify(err))
                        } else {
                            throw new Error(err.message);
                        }
                    });
                    resolve(newConn);
                }
            });
        });
    },
    getDisseminationDate: (acceptanceDateTime) => { //submissions accepted after 5:30PM are disseminated the next day
        const acceptanceDate = new Date(acceptanceDateTime.substr(0,4) + "-" + acceptanceDateTime.substr(4,2) + "-" + acceptanceDateTime.substr(6,2) + ' ' + acceptanceDateTime.substr(8,2)+':'+acceptanceDateTime.substr(10,2)+':'+acceptanceDateTime.substr(12,2));
        acceptanceDate.setHours(acceptanceDate.getHours()+6);
        acceptanceDate.setMinutes(acceptanceDate.getMinutes()+30);
        if(acceptanceDate.getDay()==6) acceptanceDate.setDate(acceptanceDate.getDate()+2);  //Saturday to Monday
        if(acceptanceDate.getDay()==0) acceptanceDate.setDate(acceptanceDate.getDate()+1);  //Sunday to Monday
        //todo: skip national holidays too!
        return acceptanceDate;
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
                try{
                    me.con.query(sql, (err, result, fields) => {
                        if(err) {
                            console.log('throwing error from within reQuery');
                            throw err;
                        }
                        resolve({data: result, fields: fields});
                    });  //note: con.execute prepares a statement and will run into max_prepared_stmt_count limit
                } catch(err) {
                    console.log("fatal MySQL error: "+ err.message);
                    try{
                        await me.logEvent("fatal MySQL error: "+err.message, sql);
                    } catch(err2){
                        console.log("unable to log fatal MySQL error: "+err2.message);
                    }
                    reject(err);
                }
            } else {
                console.log('endless loop detected in runQuery');
                process.exit();
            }
        });
    },
    logEvent: async (type, msg, display) => {
        await me.runQuery("insert into eventlog (event, data) values ("+me.q(type)+me.q(msg.substr(0,59999), true)+")");  //data field is varchar 60,000
        if(display) console.log(type, msg);
    },
    readS3: async (file) => {
        let now = new Date();
        if(!s3 || !s3Age || (s3Age - now>s3MaxAge)){
            s3 = new AWS.S3;
            console.log('created new S3 object from SDK');
            s3Age = now;
        }
        return new Promise((resolve, reject) => {
            let params = {
                Bucket: me.bucket,
                Key: file
            };
            s3.getObject(params, (err, data) => {
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
        let now = new Date();
        if(!s3 || !s3Age || (s3Age - now>s3MaxAge)){
            s3 = new AWS.S3;
            s3Age = now;
        }
        return new Promise((resolve, reject) => {
            s3.putObject({
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
    }
};

module.exports = me;

