"use strict";
/**
 * Created by Mark Elbert on 1017/2020.
 *
 * NodeJS implementation of earlier PHP webpage + JS + PHP api to run on server
 *
 * 1. From config obj, loader loops through quarterly DERA financial statement datasets (with or without notes) and loads facts
 *      a. download the file
 *      b. ungzip the file
 *      c. untar the file
 *      d. load each fact tables in dateaset
 *  2. If comparison report is requested, compare latest quarter
 *   b. ingest data
 *   c. restore PK
 * 5. execute step 0 after last asyn callback
 */


//OPERATOR CONFIGURATION
const config = {  //edit this object to perform maintenance tasks from initial load to quarterly ingest
    endQuarter: null,  //if falsey, attempts to read up to current quarter
    dataSource: 'financialStatementsWithNotes', // "financialStatements" or "financialStatementsWithNotes"
    truncateAll: true,  //truncate and reload all or just load newly published DERA FS data set(s)
    comparisonReport: false, //if truthy, compare the table of DERA ingested data against the realtime ingested data
};

//MAIN PROGRAM
const common = require('common');
const request = require('request');
const cheerio = require('cheerio');
const fs = require('fs');
const execSync = require('child_process').execSync;

const projectTablePrefix = 'eapi_';  //prefix all tables to make ownership clear
const dataSources = {
    "financialStatements": {  //believe these have rounded dates and therefore is an imprecise dataset
        webPage: 'https://www.sec.gov/dera/data/financial-statement-data-sets.html',  //for humans
        datasetRootURL: 'https://www.sec.gov/files/dera/data/financial-statement-data-sets/', // + '2020q2.zip'
        quarterManagementTable: 'f_quarters',
        factTables: ['f_sub', 'f_tag', 'f_num'], //, 'pre'], //note: first table in list must have qid FK to quarterManagementTable
        extractFileSuffix: 'txt',
    },
    "financialStatementsWithNotes": { //believe these must be used as supplemental fields allow derivation of the reported (non-rounded) dates
        webPage: 'https://www.sec.gov/dera/data/financial-statement-and-notes-data-set.html',
        datasetRootURL: 'https://www.sec.gov/files/dera/data/financial-statement-and-notes-data-sets/', // + '2020q2_notes.zip'
        quarterManagementTable: 'fn_quarters',
        factTables: ['fn_sub', 'fn_tag', 'fn_dim', 'fn_num', 'fn_ren', 'fn_pre', 'fn_cal'], //, 'fn_pre', 'fn_txt'],  //note: first table in list must have qid FK to quarterManagementTable
        extractFileSuffix: 'tsv',
    }
};

const src = dataSources[config.dataSource];
const workDir = '/data/' + config.dataSource;
if(!fs.existsSync('/data')){  //make sure path exists
    execSync(`mkdir -m 777 /data`);
}
if(!fs.existsSync(workDir)){  //make sure path exists
    execSync(`mkdir -m 777 ${workDir}`);
}


async function main(){
    if(config.truncateAll){  //clear tables for a reload operation
        console.log(`truncating table ${projectTablePrefix+src.quarterManagementTable}`);
        await common.runQuery(`truncate ${projectTablePrefix+src.quarterManagementTable}`);
        for(let t=0;t<src.factTables.length;t++){
            console.log(`truncating table  ${projectTablePrefix+src.factTables[t]}`);
            await common.runQuery(`truncate ${projectTablePrefix+src.factTables[t]}`);
        }
    }

    console.log('reading published quarters in table.list from ' + src.webPage);
    const publishedQuarters = [];
    request(src.webPage, async function (error, response, pageBody) {
        //starting on line the 11th line: CIK|Company Name|Form Type|Date Filed|txt File url part
        if(error) {
            console.log("unable to read "+src.webPage+ ". Terminating load with error");
            process.exit();
        } else {
            const $ = cheerio.load(pageBody);
            $('table.list td.views-field-field-display-title a').each((i, elem) => {
                let $a = $(elem);
                publishedQuarters.push({
                    qtr: $a.text().trim().toLowerCase().replace(/ /g,''),
                    url: ($a.attr('href')[0]=='/'?'https://www.sec.gov':'') + $a.attr('href')
                });
            });
            publishedQuarters.sort((a,b) => {return a.qt==b.qtr?0:(a.qtr<b.qtr?-1:1)}); //sort earliest to latest
            await processQuarters(publishedQuarters);
        }
    });
}

async function processQuarters(publishedList){
    for(let i=0;i<publishedList.length;i++){
        let quarterRecord = await common.runQuery(`select * from ${projectTablePrefix+src.quarterManagementTable} 
            where qtr='${publishedList[i].qtr}' and status like 'completed%'`);
        if(!quarterRecord.data.length){
            console.log(`${(new Date()).toLocaleTimeString()}: processing ${publishedList[i].qtr} (#${i+1})`);
            let quarterRow = await common.runQuery(`insert into ${projectTablePrefix+src.quarterManagementTable} 
                    (qtr, path, status) 
                    values ('${publishedList[i].qtr}','${publishedList[i].url}','downloading') on duplicate key update status='redownloading'`);
            let cmd = `wget "${publishedList[i].url}"  -O ${workDir}/${publishedList[i].qtr}.zip`;
            if(!fs.existsSync(workDir+'/'+publishedList[i].qtr+'.zip') || !fs.statSync(workDir+'/'+publishedList[i].qtr+'.zip').size) {  //make sure path exists
                console.log(`downloading ${workDir}/${publishedList[i].qtr}.zip...`);
                let code = execSync(cmd);
                console.log(`downloaded ${workDir}/${publishedList[i].qtr}.zip with code ${code}`);
            } else {
                console.log(`file ${workDir}/${publishedList[i].qtr}.zip already exists; no need to download`);
            }
            await common.runQuery(`update ${projectTablePrefix+src.quarterManagementTable} set status='downloaded' where qtr='${publishedList[i].qtr}'`);
            let dsQuarterId = await common.runQuery(`select qid from ${projectTablePrefix+src.quarterManagementTable} where qtr='${publishedList[i].qtr}'`);
            let qtrId = dsQuarterId.data[0].qid;
            if(!fs.existsSync(workDir+'/'+publishedList[i].qtr)){
                execSync(`mkdir -m 777 ${workDir}/${publishedList[i].qtr}`);
            } else {
                execSync(`rm ${workDir}/${publishedList[i].qtr}/*`);
            }
            await common.runQuery(`update ${projectTablePrefix+src.quarterManagementTable} set status='working dir made' where qtr='${publishedList[i].qtr}'`);
            execSync(`unzip -q ${workDir}/${publishedList[i].qtr}.zip -d ${workDir}/${publishedList[i].qtr}`);
            //execSync(`tar xzf ${workDir}/${publishedList[i].qtr}.zip  -C ${workDir}/${publishedList[i].qtr}`);
            await common.runQuery(`update ${projectTablePrefix+src.quarterManagementTable} set status='unzipped' where qtr='${publishedList[i].qtr}'`);
            for(let t=0;t<src.factTables.length;t++){
                let db_table = projectTablePrefix+src.factTables[t];
                await common.runQuery(`update ${projectTablePrefix+src.quarterManagementTable} set status='loading ${projectTablePrefix+src.factTables[t]} ' where qtr='${publishedList[i].qtr}'`);
                let sql = `load data local infile '${workDir}/${publishedList[i].qtr}/${db_table.split('_').pop()}.${src.extractFileSuffix}' 
                    IGNORE INTO TABLE ${db_table} FIELDS TERMINATED BY '\\t'  ESCAPED BY '' LINES TERMINATED BY '\\n' IGNORE 1 LINES;`;
                await common.runQuery(sql);
                if(t==0) await common.runQuery(`update ${db_table} set qid =${qtrId} where qid is null`);  //keep track of source in _sub table only
                let rowCount = await common.runQuery(`select count(*) as rcount from ${db_table}`);
                console.log((new Date()).toLocaleTimeString() + ': ' + db_table + ' has ' + rowCount.data[0].rcount+ ' rows');

            }
            //execSync(`rm ${workDir}/${publishedList[i].qtr}/*`);
            //execSync(`rmdir ${workDir}/${publishedList[i].qtr}`);
            if(i==8) break;
        } else {
            console.log(`${(new Date()).toLocaleTimeString()}: skipping previously processed ${publishedList[i].qtr} (#${i+1})`);
        }
    }
    process.exit();
}

//run program
main();
