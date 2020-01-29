// search EFT Lambda function is exposed at https://search.publicdata.guru/search-index via the APIGateway to the internet and
// safely allows *.sec.gov web pages to access specific parts of the search API of the AWS ElasticSearch service, which
// maintains an index of 10 years of EDGAR document texts.

// The APIGateways disallows CORS (cross origin scripting), limiting availability of the service to sec.gov web pages.
// The Lambda performs input validation and provides/limits external access to only the ElasticSearch search API.

// estimated cost of Lambda based on current usage of 600,000 searches per month:
// 128MB Lambda @ $0.000000208/100ms * 200ms/search * 600,000 search / month = $0.24 / month

//module level variables (note: these persist between handler calls when containers are reused = prevalent during high usage periods)
var AWS = require('aws-sdk');
const HTTPS = require('https');

const region = 'us-east-1';
const domain = 'search-edgar-wac76mpm2eejvq7ibnqiu24kka'; // e.g. search-domain.region.es.amazonaws.com
const endpoint = new AWS.Endpoint(`${domain}.${region}.es.amazonaws.com`);
const locationTypes = {
    located: "biz_states",
    incorporated: "inc_states"
};

exports.searchEFTS = async (r, context) => {
    //todo: add screens for malicious of prohibited actions};
    let indexToSearch, query;
    let locationField = locationTypes[r.locationType]||locationTypes.located;
    if(r.keysTyped){
        //suggestions query
        indexToSearch = 'edgar_entity';
        query = {
            "query": {
                "bool": {
                    "should": [
                        {   "match": {"entity": {
                                "query": r.keysTyped,
                                "operator": "and"}
                            }
                        },
                        {   "match": {"tickers": {
                                "query": r.keysTyped,
                                "operator": "and",
                                "boost": 100}
                            }
                        },
                        {   "exists": {"field": "tickers", "boost":10}
                        },
                     ]
            }},
            "from": 0,
            "size": 10, // outer hits, or books
        };
        if(!isNaN(r.keysTyped)) query.query.bool.should.push(
            {"match": {"_id": {
                        "query": parseInt(r.keysTyped),
                        "boost": 1000}
                }
            })
    } else {
        //document search query
        indexToSearch = 'edgar_file';
        query = {
            "query": {
                "bool": {
                    "must": [],
                    "filter": []
                },
            },
            "from": isNaN(r.from)?0:Math.min(0, parseInt(r.from)), //optional parameter allows for pagination
            "size": 100, // outer hits, or books
        };

        if (!query.from) {  //don't request aggregations again for each page
            query.aggregations = {
                "form_filter": {
                    "terms": {
                        "field": "root_form",
                        "size": 30
                    }
                },
                "entity_filter": {
                    "terms": {
                        "field": "display_names.raw",
                        "size": 30
                    }
                },
                "sic_filter": {
                    "terms": {
                        "field": "sics",
                        "size": 30
                    }
                },
                [locationField+"_filter"]: {
                    "terms": {
                        "field": locationField,
                        "size": 30
                    }
                }
            };
        }

        if (r.forms && r.forms.length) query.query.bool.filter.push({"terms": {"root_form": r.forms}});
        if (r.sics && r.sics.length) query.query.bool.filter.push({"terms": {"sics": r.sics}});
        if (r.locationCodes && r.locationCodes.length) query.query.bool.filter.push({"terms": {[locationField]: r.locationCodes}});
        if (r.ciks && r.ciks.length) {
            query.query.bool.filter.push({"terms": {"ciks": r.ciks}}) ;
        } else {
            if(r.entityName) query.query.bool.must.push({"match": {"display_names": r.entityName}});
        }

        if (query.query.bool.filter.length==0 && query.query.bool.must.length==0 && (!r.q || !r.q.trim().length || r.q.trim()[0] == '*')) {
            return {"error": "Blank search not valid.  Either entity, keywords, location, or filing types must be submitted.",
                "hits": {"hits":[]}
            };
        }
        if(r.q && r.q.trim().length){
            const keywords = r.q.split(' ');
            for (let i = 0; i < keywords.length; i++) {
                if(keywords[i].length) query.query.bool.must.push({"match": {"doc_text": keywords[i]}});
            }
        } else {
            query.query.bool.filter.push({"term": {"sequence": {"value": 1}}});
            query.sort = [{ "file_date" : {"order" : "desc"}}];
        }
        if (r.startdt && r.enddt) query.query.bool.filter.push({
            "range": {
                "file_date": {
                    "gte": r.startdt,
                    "lte": r.enddt
                }
            }
        });
    }
    const querystring = JSON.stringify(query);
    console.log(querystring); //debug only!
    const options = {
        hostname: `${domain}.${region}.es.amazonaws.com`,
        port: 443,
        path: `/${indexToSearch}/_search`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': querystring.length
        }
    };
    return await new Promise((resolve, reject)=>{
        let chunks = [];
        const request = HTTPS.request(options, (response) => {
            console.log(`statusCode: ${request.statusCode}`);
            response.on('data', (d) => {
                chunks.push(d);
            });
            response.on('end', () => {
                try{
                    resolve(JSON.parse(chunks.join('')));
                } catch (e) {
                    resolve('invalid JSON in: '+(chunks.join('')));
                }
            });
        });

        request.on('error', (error) => {
            console.log('error', error);
            reject(error);
        });

        request.write(querystring);  //send payload
        request.end(); //end the request and wait for the response (handled in callback above, which resolved the promise)
    });
};


/*//////////////////////  TEST CARD  //////////////////////////////////////////////////

event = {
    "q": "iphone brexit",
    "cik": null,
    "forms": []
    "sic": null,
    "start": null,
    "end": null,
}

/////////////////////////////////////////////////////////////////////////////////////*/