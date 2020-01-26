// Nightly cron job creates type ahead index "edgar_entity" in ES using efts_entities table (updated during EFTS bulk and intraday ingests)
//runs in 90 seconds > $0.0015 per daily execution = $0.54 per year
//test from command line with:  curl -XPOST 'https://search-edgar-wac76mpm2eejvq7ibnqiu24kka.us-east-1.es.amazonaws.com/hints/_search' -H "Content-Type: application/json" -d '{"query":{"match":{"entity":{"query":"Apple I","operator":"and"}}}}'

const common = require('common.js');  //custom set of common dB & S3 routines used by custom Lambda functions & Node programs
const exec = require('child_process').exec;
const AWS = require('aws-sdk');
const HTTPS = require('https');

const region = 'us-east-1';
const domain = 'search-edgar-wac76mpm2eejvq7ibnqiu24kka'; // e.g. search-domain.region.es.amazonaws.com
const endpoint = new AWS.Endpoint(`${domain}.${region}.es.amazonaws.com`);
const index = 'edgar_entity';
const type = '_bulk';

//const es = new AWS.ES({apiVersion: '2015-01-01'});
(async function main(){
    const startTime = new Date();
    console.log(startTime.toISOString()+ ': edgarFullTextEntityIndexRebuild started');
    const esEntityMappings = {  //id = cik also
        "settings": {
            "analysis": {
                "analyzer": {
                    "autocomplete": {
                        "tokenizer": "autocomplete",
                        "filter": [
                            "lowercase"
                        ]
                    },
                    "autocomplete_search": {
                        "tokenizer": "lowercase"
                    }
                },
                "tokenizer": {
                    "autocomplete": {
                        "type": "edge_ngram",
                        "min_gram": 1,
                        "max_gram": 20,
                        "token_chars": [
                            "letter",
                            "digit"
                        ]
                    }
                }
            }
        },
        "mappings": {
            "properties": {
                "entity": { //entity name and tickers
                    "type": "text",
                    "analyzer": "autocomplete",
                    "search_analyzer": "autocomplete_search"
                },
                "tickers": { //used to boost exact matches of ticker symbols and ciks
                    "type": "text",
                },
                "rank": { ////used to order partial matches of entity
                    "type": "long",
                }
            }
        }
    };

    //1. drop (if exist) and recreate the entity index (used for automcomplete suggestions)
    await asyncExec(`curl -XDELETE 'https://${domain}.${region}.es.amazonaws.com/${index}'`);
    console.log(await asyncExec(`curl -XPUT 'https://${domain}.${region}.es.amazonaws.com/${index}' -H "Content-Type: application/json" -d '${JSON.stringify(esEntityMappings)}'`));
    console.log('recreated index '+index);
    await common.runQuery(`call efts_update_ranks();`);
    console.log('updated ranks');
    const entityCountResult = await common.runQuery(`select count(*) as entityCount from efts_entities`);
    const entityCount = entityCountResult.data[0].entityCount;
    const pageLength = 1000; //determines number of rows read from search_typing_hints
    let cursorIndex = 0;
    const sql = 
         `SELECT e.cik, e.name, e.rank, group_concat(et.ticker SEPARATOR ', ') as tickers 
          FROM efts_entities e LEFT OUTER JOIN efts_entity_tickers et ON e.cik=et.cik 
          GROUP BY e.cik, e.name, e.rank`;
    while (cursorIndex < entityCount) {
        let entityRecords = await common.runQuery(`${sql} limit ${cursorIndex},${pageLength}`);
        const bulkInsertAPICommands = [];
        for (let i = 0; i < entityRecords.data.length; i++) {
            bulkInsertAPICommands.push(`{"create": { "_index" : "${index}", "_id" : "${entityRecords.data[i].cik}" } }`);
            bulkInsertAPICommands.push('{"entity": "'+cleanJSONStrings(entityRecords.data[i].name)
                + (entityRecords.data[i].tickers?' ('+cleanJSONStrings(entityRecords.data[i].tickers)+')':'') + '",'
                + '"tickers": "' + cleanJSONStrings(entityRecords.data[i].tickers) + '",'
                + '"rank": '+ entityRecords.data[i].rank + '}');
        }
        bulkInsertAPICommands.push('');  //creates terminal newline in .join below

        let request = new AWS.HttpRequest(endpoint, region);
        request.method = 'POST';
        request.path += `${index}/${type}`;
        request.body = bulkInsertAPICommands.join('\n');
        //console.log(request.body);  //DEBUG!!!!!!!!!!!!!!!!!!!
        request.headers['host'] = `${domain}.${region}.es.amazonaws.com`;
        request.headers['Content-Type'] = 'application/json';

        var credentials = new AWS.EnvironmentCredentials('AWS');
        var signer = new AWS.Signers.V4(request, 'es');
        //signer.addAuthorization(credentials, new Date());

        //send to ElasticSearch and wait result
        let client = new AWS.HttpClient();
        await new Promise((resolve, reject) => {
            client.handleRequest(request, {connectTimeout: 1000, timeout: 55000}, function (response) {
                let chunks = [];
                response.on('data', function (chunk) {
                    chunks.push(chunk);
                });
                response.on('end', async function (chunk) {
                    if (chunk) chunks.push(chunk);
                    try {
                        let responseBody = chunks.join('');
                        let esResponse = JSON.parse(responseBody);
                        //console.log(responseBody);   //DEBUG!!!!!!!!!!!!!!!!!!!
                        console.log('error status from page ' + cursorIndex / pageLength, esResponse.errors);
                        if(esResponse.errors !== false){  //page 236 is returning 'undefined'
                            if(esResponse.items){
                                for(let i=0;i<esResponse.items.length;i++){
                                    if(esResponse.items[i].create.error) console.log(esResponse.items[i].create.error);
                                }
                            } else {
                                console.log(request.body);
                                console.log(esResponse);
                            }
                            reject('errors');
                        } else {
                            resolve(responseBody);
                        }
                    } catch (e) {
                        console.log(e);
                        reject(e);
                    }
                });
            }, function (error) {
                console.log('Error sending data to ES: ' + error);
                reject(error);
            });
        });
        cursorIndex += pageLength;
    }

    console.log('refresing index...');
    await asyncExec(`curl -XPOST 'https://${domain}.${region}.es.amazonaws.com/${index}/_refresh'`);
    console.log('Done!  Test index from command line with:');
    const testQuery = `{"query":{"match":{"entity":{"query":"Apple I","operator":"and"}}}}`;
    console.log(`curl -XPOST 'https://${domain}.${region}.es.amazonaws.com/${index}/_search' -H "Content-Type: application/json" -d '${testQuery}'`);
    const endTime = new Date();
    console.log(endTime.toISOString()+': edgarFullTextEntityIndexRebuild ended');
    console.log(Math.round(endTime.getTime() - startTime.getTime()/100)/10 + ' seconds total execution time');  //about 1 min 30 seconds for 1 years data
    await common.con.end();
})();

function cleanJSONStrings(JSONString){
    return (JSONString?JSONString.replace(/\\/g, '\\\\').replace(/"/g, '\\"'):'');
}


//asyncExec allows execution of Linux/OS commands using await syntax instead of nested callbacks
function asyncExec(commandLineString) {
    return new Promise((resolve, reject) => {
        exec(commandLineString).on('exit', (code) => {
            resolve(code)
        }).on('error', () => {
            resolve('error')
        });
    });
}
