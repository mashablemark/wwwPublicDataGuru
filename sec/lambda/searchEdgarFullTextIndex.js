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

    const formsFilter = r.forms.length ? ' (form: ' + r.forms.join(' OR form: ') + ')' : '';
    const sicFilter = r.sic ? ` sic:${r.sic}` : '';
    const cikFiler = r.sic ? ` cik:${r.cik}` : '';
    //todo: const dateFilter = r.startdt || r.enddt ? ';

    const query = JSON.stringify({
        "query": {
            "query_string": {
                "query": r.q+formsFilter+cikFiler+sicFilter,
                "default_operator": "AND",
                "default_field": "doc_text"
            }
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
            "cik_filter": {
                "terms": {
                    "field": "ciks",
                    "size": 30
                }
            },
            "sic_filter": {
                "terms": {
                    "field": "sic",
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
    });
    const options = {
        hostname: `${domain}.${region}.es.amazonaws.com`,
        port: 443,
        path: `/${index}/_search`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': query.length
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

        request.write(query);  //send payload
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