//Lambda function is invoked by the indexBatchTimer state machine to group index update into 10s batches
// this allow processIndexHeaders to be run in parallel with high concurrency and eliminate occasional contentions
// associated with reading and updating the same S3 object multiple times a second.

//important:  writeDetailedIndexes must have a concurrency of 1
//avg execution time 400ms to 2s (peak exec = 4s on db startup and  large index file)
//cost = 500,000 filings per * $0.000000208 per 100ms (192MB size) * 2s * 10 (100ms to s) = $2.08 per year
//note: 128MB container has no spare memory when run hard

//module level variables (note: these persist between handler calls when containers are reused = prevalent during high usage periods)
var dailyIndex = false;  //daily indexes as parsed objects: need initiation than can be reused >> Requires concurrency = 1!
const common = require('common');  //REQUIRES LAMBDA TO BE CONFIGURED TO USE LAMBDA LAYER "COMMON"
const root = 'test'; //switch to 'sec' when proven
exports.handler = async (event, context) => {
    let requiredDailyIndexes = {};
    // step 1. get the batch of new submission records from the DB
    const subDS = await common.runQuery('call submissionsGetClearNew()');
    const now = new Date();
    if(subDS.data && subDS.data[0] && subDS.data[0].length){
        //start fetching all required indexes at the same time with promises
        let requiredDailyIndexesPromises = {}, requiredDailyIndexes = {};
        console.log('fetching index(es) for '+subDS.data[0].length+' new submissions');
        for(let i=0;i<subDS.data[0].length;i++){  //ordered by acceptancedatatime
            let disseminationDate = common.getDisseminationDate(subDS.data[0][i].acceptancedatetime);
            let indexDate = disseminationDate.toISOString().substr(0,10);
            if(indexDate<subDS.data[0][i].filingDate) indexDate = subDS.data[0][i].filingDate;
            if(!requiredDailyIndexesPromises[indexDate]) requiredDailyIndexesPromises[indexDate] = fetchDailyIndex(disseminationDate);
        }
        //collect all fetch promises
        for(let indexDate in requiredDailyIndexesPromises) requiredDailyIndexes[indexDate] = await requiredDailyIndexesPromises[indexDate];

        //push all new submissions onto all indexes
        for(let i=0;i<subDS.data[0].length;i++){ //ordered by acceptancedatetime
            let disseminationDate = common.getDisseminationDate(subDS.data[0][i].acceptancedatetime);
            let indexDate = disseminationDate.toISOString().substr(0,10);
            if(indexDate<subDS.data[0][i].filingDate) indexDate = subDS.data[0][i].filingDate;
            let newSub = JSON.parse(subDS.data[0][i].json);
            requiredDailyIndexes[indexDate].submissions.push(newSub);
            dailyIndex = requiredDailyIndexes[indexDate];  //keep the most recent index used in module scope for reuse on next call
        }


        //first write last-10 micro index
        const last10IndexBody = {
            "lastUpdated": now.toISOString(),
            "title": "micro-index of latest 10 EDGAR submissions disseminated",
            "notes": "this micro-index is updated just prior to updating the daily detail JSON indexes)",
            "format": "JSON",
            "indexDate": dailyIndex.indexDate,
            "last10Submissions": dailyIndex.submissions.slice(-10)
        };

        //next get write promises for the micro index and daily indexes that need writing out
        const writePromises = [];
        writePromises.push(common.writeS3(root+"/indexes/last10EDGARSubmissionsFastIndex.json",JSON.stringify(last10IndexBody)));
        console.log('made write promise for micro index; about to make the daily index write promises');

        for(let indexDate in requiredDailyIndexes){
            let dailyIndexToWrite = requiredDailyIndexes[indexDate];
            const indexUTCDate = new Date(dailyIndexToWrite.indexDate);
            const indexQtr = Math.floor(indexUTCDate.getUTCMonth()/3)+1;
            writePromises.push(common.writeS3(root+ "/indexes/daily-index/"+ indexUTCDate.getUTCFullYear()+"/QTR"+indexQtr+"/detailed."+ dailyIndexToWrite.indexDate + ".json"
                 , JSON.stringify(dailyIndexToWrite)));
        }

        console.log('about to collect the write promises');
        for(let i=0;i<writePromises.length;i++) {
            await writePromises[i];
        }
        console.log('writeDetailedIndexes wrote '+(writePromises.length-1)+' daily indexes');
    } else {
        await common.logEvent('WARNING: writeDetailedIndexes ', 'submissionsGetClearNew returned no records', true);
    }
    //terminate by returning from handler (node Lamda functions end when REPL loop is empty)
    return {status: 'ok'};
};

async function fetchDailyIndex(disseminationDate){
    let indexDate = disseminationDate.toISOString().substr(0,10);
    return new Promise(async (resolve, reject)=>{
        if(dailyIndex && dailyIndex.indexDate==indexDate) {
            resolve(dailyIndex);
        } else {
            let qtr = Math.floor(disseminationDate.getUTCMonth()/3)+1;
            let key = root+ "/indexes/daily-index/"+ disseminationDate.getUTCFullYear()+"/QTR"+qtr+"/detailed."+ indexDate + ".json";
            console.log('reading S3 object '+key);
            try{
                let json = await common.readS3(key);
                try{
                    resolve(JSON.parse(json));
                } catch (e) {
                    await common.logEvent('ERROR writeDetailedIndexes',`unable to parse index JSON for ${key}`, true);
                    reject(e);  //leave evidence for analysis: don't overwrite
                }
            } catch (e) {
                console.log('creating new daily index for '+ indexDate);
                resolve({
                    "title": "daily EDGAR file index with file manifest for " + indexDate,
                    "format": "JSON",
                    "indexDate": indexDate,
                    "submissions": []
                });
            }
        }
    });
}

