// search EFT Lambda function is exposed at https://search.publicdata.guru/edgar via the APIGateway to the internet and
// safely allows *.sec.gov web pages to access the search API of the AWS ElasticSearch service, which maintains an index
// of 10 years of EDGAR document text.
// The APIGateways disallows CORS (cross origin scripting), limited availability to sec.gov web pages.  The Lambda performs
// input validation and provides/limits external access to only the ElasticSearch search API.

// estimated cost of Lambda based on current usage of 600,000 searches per month:
// 128MB Lambda @ $0.000000208/100ms * 200ms/search * 600,000 search / month = $0.24 / month

//module level variables (note: these persist between handler calls when containers are reused = prevalent during high usage periods)
var AWS = require('aws-sdk');
const HTTPS = require('https');

const region = 'us-east-1';
const domain = 'search-edgar-wac76mpm2eejvq7ibnqiu24kka'; // e.g. search-domain.region.es.amazonaws.com
const endpoint = new AWS.Endpoint(`${domain}.${region}.es.amazonaws.com`);
const index = 'submissions';

exports.searchEFTS = async (r, context) => {
    //todo: add screens for malicious of prohibited actions
    if(!r.q || r.q.trim().length<2 || r.q.trim()[0]=='*') return {error: 'text search query must include a keyword longer then 2 characters'};

    const query = {
        "query": {
            "bool": {
                "must": [],
                "filter": []
            },
        },
        "docvalue_fields": [
            "ciks",
            "sics",
            "file_name",
            "display_names.raw",
            "file_description",
            "filed",
            "form"
        ],
        "aggregations": {
            "form_filter": {
                "terms": {
                    "field": "form",
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
            "inc_states_filter": {
                "terms": {
                    "field": "inc_states",
                    "size": 30
                }
            }
        }
    };
    const keywords = r.q.split(' ');
    for(let i=0;i<keywords.length;i++){
        if(keywords[i].length>2) query.query.bool.must.push( {"match": { "doc_text": keywords[i]}})
    }
    if(r.forms && r.forms.length) query.query.bool.filter.push( {"terms": { "root_form": r.forms}});
    if(r.sic) query.query.bool.filter.push( {"term": { "sics": {"value": r.sic}}});
    if(r.cik)query.query.bool.filter.push( {"term": { "ciks": {"value": r.cik}}});
    //todo: const dateFilter = r.startdt || r.enddt ? ';

    const querystring = JSON.stringify(query);
console.log(querystring); //debug only
    const options = {
        hostname: `${domain}.${region}.es.amazonaws.com`,
        port: 443,
        path: `/${index}/_search`,
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
                resolve(chunks.join());
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