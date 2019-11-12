//npm install request cheerio
//node crawler.js

// parses quarterly EDGAR indexes and populates the dessiminations table


var request = require('request');
var mysql = require('mysql');
var secure = require('./secure');

var con,  //global db connection
    secDomain = 'https://www.sec.gov';
//1000180|SANDISK CORP|4/A|2016-02-24|edgar/data/1000180/0001242648-16-000070.txt
var linePartsIndex = {CIK: 0, CompanyName: 1, FormType: 2, DateFiled: 3, Filename: 4};
var downloadedGB = 0;
var rgxXML = /<xml>[.\s\S]*<\/xml>/im;
var rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars

var processControl = {
    start: {
        year: 2009,
        q: 3
    },
    end: {
        year: 2013,
        q: 4
    }
};

startUpload(processControl);

async function startUpload(processControl){
    var db_info = secure.publicdataguru_dbinfo();
    //console.log(db_info);
    con = mysql.createConnection({ //global db connection
        host: db_info.host,
        user: db_info.user,
        password: db_info.password,
        database: db_info.database
    });

    con.connect(async function(err) {
        if (err) throw err;
        setInterval(()=>{nextQuarter(processControl)}, 15*1000); //one quarterly index per minute
        nextQuarter(processControl);  //get the first started immediately
    });
}

function nextQuarter(processControl){
    if(!processControl.current){ //just starting
        processControl.current =
            { 	year: processControl.start.year,
                q: processControl.start.q };
        processControl.quartersProcessed = 0;
    } else { //increment is not end of loop
        processControl.quartersProcessed++;
        processControl.current.year += Math.floor(processControl.current.q/4);
        processControl.current.q = (processControl.current.q % 4) + 1;
        if(processControl.current.year + processControl.current.q/10>processControl.end.year + processControl.end.q/10){
            console.log("finished parsing and processing indexes", processControl.quartersProcessed + " quarters processed");
            return false;
        }
    }
    processQuarterlyIndex(processControl);
    return true;
}

async function processQuarterlyIndex(processControl, callback){
    var idxUrl = secDomain + '/Archives/edgar/full-index/' + processControl.current.year + '/QTR' + processControl.current.q + '/master.idx';
    console.log('quarterly index process starting' ,'fetching ' + idxUrl, true);
    request(idxUrl, async function (error, response, indexBody) {
        //starting on line the 11th line: CIK|Company Name|Form Type|Date Filed|txt File url part
        if(error) {
            console.log("unable to read index", "ending scrap on " + processControl.indexUrl);
            console.log("finished processing", processControl.quartersProcessed + " quarters processed");
            return false;
        } else {
            downloadedGB += indexBody.length / (1024*1024*1024);
            var lines = indexBody.split('\n');
            delete indexBody;
            const insertSql = 'INSERT INTO dessiminations (path, cik, adsh, form, filedt, entity) VALUES ';
            var recordValues = [];
            var cycle = 0;
            for(lineNum=11;lineNum<lines.length;lineNum++){
                //problem non-latin characters:    ('1555512/9999999997-17-007686.txt',1555512,'9999999997-17-007686','ADV-NR','2017-07-11','PRAGMA GEST�O DE PATRIM�NIO LTDA'),
                var fields = lines[lineNum].replace(/�/g, "?").split('|');
                if(fields.length>=5){
                    var pathParts = fields[4].split('/');
                    var file = pathParts[3];
                    var s = {
                        path: pathParts[2]+'/'+pathParts[3],
                        cik: fields[0],
                        entity: fields[1].substr(0,900),
                        form: fields[2],
                        filed: fields[3],
                        urlTextFile: 'https://www.sec.gov/Archives/' + fields[4],
                        urlIndexFile: 'https://www.sec.gov/Archives/' + fields[4].replace('.txt','-index.html'),
                        adsh: file.substring(0, file.length-4)
                    };
                    recordValues.push(`(${q(s.path)}${s.cik},${q(s.adsh)}${q(s.form)}${q(s.filed)}${q(s.entity,true)})`);
                    if(recordValues.length==1000) {
                        await runQuery(insertSql + recordValues.join(','));
                        cycle++;
                        cycle = cycle % 10;
                        if(cycle == 0) console.log (lineNum, Math.round(lineNum/lines.length*1000)/10+'% compete');
                        recordValues = [];
                    }
                }
            }
            if(recordValues.length>0) runQuery(insertSql + recordValues.join(','));
            console.log('finished processing ' + idxUrl);
        }
    });
}

function logEvent(type, msg, display){
    if(display) console.log(type, msg);
    //runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
}

function q(value, isLast){
    if(typeof value !== 'undefined'){
        return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast?'':',');
    } else {
        return ' null'+ (isLast?'':',');
    }
}

function runQuery(sql){
    return new Promise(async (resolve, reject) =>  {
        try{
            con.query(sql, function(err, result, fields) {
                if(err){
                    console.log(sql);
                    console.log('bad query', sql, true);
                    reject(err);
                }
                resolve(result, fields);
            });
        } catch(err) {
            console.log(sql);
            console.log("fatal MySQL error", sql, true);
            reject(err);
        }
    })
}
