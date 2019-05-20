//module vars that are not exported
const mysql2 = require('mysql2/promise');
const AWS = require('aws-sdk');
const secure = require('./secure');  //DO NOT COMMIT!
let s3 = false,  //error can occur if s3 object created from AWS SDK is old & unused
    s3Age = false;
const s3MaxAge = 10000; //todo:  research raising this from 10s to ??
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
        let myConn = await mysql2.createConnection(dbInfo || secure.publicdataguru_dbinfo()); // (Re)created global connection
        let self = this;
        myConn.connect(function(err) {              // The server is either down
            if(err) {                            // or restarting (takes a while sometimes).
                console.log('error when connecting to db:', err);
                setTimeout(() => {
                    me.con = self.createDbConnection();
                }, 100); // We introduce a delay before attempting to reconnect, to avoid a hot loop
            }
        });

        myConn.on('error', async function(err) {
            console.log('db error', err);
            if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
                me.con = await self.createDbConnection(dbInfo);
            } else {                                      // connnection idle timeout (the wait_timeout
                throw err;                                  // server variable configures this)
            }
        });
        return myConn;
    },
    getDisseminationDate: (acceptanceDateTime) => { //submissions accepted after 5:30PM are disseminated the next day
        const acceptanceDate = new Date(acceptanceDateTime.substr(0,4) + "-" + acceptanceDateTime.substr(4,2) + "-" + acceptanceDateTime.substr(6,2) + ' ' + acceptanceDateTime.substr(8,2)+':'+acceptanceDateTime.substr(10,2)+':'+acceptanceDateTime.substr(12,2));
        acceptanceDate.setHours(acceptanceDate.getHours()+6);
        acceptanceDate.setMinutes(acceptanceDate.getMinutes()+30);
        return acceptanceDate;
    },
    closestCalendricalPeriod: (start, end) => {
        let workingEnd = new Date(end);
        if(start){
            let qtrs = Math.round((end - start)/(365/4*24*3600*1000));
            if(qtrs==1) {
                workingEnd.setDate(end.getDate()-40);
                return 'CY' + workingEnd.getFullYear() + 'Q' + qtrs;
            }
            if(qtrs==4) {
                workingEnd.setDate(end.getDate()-180);
                return 'CY' + workingEnd.getFullYear();
            }
            return null;  //if qtrs not 0, 1 or 4;
        } else {
            workingEnd.setDate(end.getDate()-40);
            return 'CY' + workingEnd.getFullYear() + 'Q' + qtrs + 'I';
        }
    },
    wait: (ms) => {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    },
    runQuery: async (sql) => {
        console.log(sql);
        if(!me.con) me.con = await me.createDbConnection();
        if(sql.indexOf("''fatal MySQL error")===-1){
            try{
                let [result, fields] = await me.con.query(sql);  //note: con.execute prepares a statement and will run into max_prepared_stmt_count limit
                return {data: result, fields: fields};
            } catch(err) {
                console.log("fatal MySQL error: "+ err.message);
                try{
                    await me.logEvent("fatal MySQL error: "+err.message, sql);
                } catch(err2){
                    console.log("fatal MySQL error: "+err.message);
                }
                throw err;
            }
        } else {
            console.log('endless loop detected in runQuery');
            process.exit();
        }
    },
    logEvent: async (type, msg, display) => {
        await me.runQuery("insert into eventlog (event, data) values ("+me.q(type)+me.q(msg, true)+")");
        if(display) console.log(type, msg);
    },
    readS3: async (file) => {
        let now = new Date();
        if(!s3 || !s3Age || (s3Age - now>s3MaxAge)){
            s3 = new AWS.S3;
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
    }
};

module.exports = me;

