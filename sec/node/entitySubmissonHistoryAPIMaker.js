/* create JSON files complete history and 1000 submissoin history pages using calls to sec.gov XML output from the RSS ATOM
feed (https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&start=${pageStart}&count=100&output=atom)
to construct the full and paged history objects and write to s3 restapi.publicdata.guru/CIK###/submissionsFull.json and
restapi.publicdata.guru/CIK###/submissionsPage#.json
 */


const common = require('common');
const https = require('https');
const cheerio = require('cheerio');


const root = 'test';   //change for production
const maxSubmissions = 2000;  //sec.gov limitation of 2000
const secPagesSize = 100;  //sec.gov limitation of 100
const entityCIKS = [104169, //walmart
    34088, //Exxon Mobil
    93410, //Chevron
    1534701, //Phillips 66
    1067983, //Berkshire Hathaway
    320193, //Apple
    1467858, //General Motors
    40545, //General Electric
    1035002, //Valero Energy
    37996, //Ford Motor
    732717, //AT&T
    310522, //Fannie Mae
    64803, //CVS Caremark
    927653, //McKesson
    1645590, //Hewlett-Packard
    732712, //Verizon Communications
    731766, //UnitedHealth Group
    19617, //J.P. Morgan Chase & Co.
    721371, //Cardinal Health
    51143, //International Business Machines
    70858, //Bank of America Corp.
    909832, //Costco Wholesale
    56873, //    Kroger
    1532063, //Express Scripts Holding
    72971, //Wells Fargo
];

const remainsChecking = false;

async function makeSubmissionHistoryAPI(){
    for(let index = 0; index<entityCIKS.length;index++){
        let cik = entityCIKS[index];
        const history = {
                cik: cik,
                entityInfo: {},
                filings: []
            };
        let pageStart = 0;
        let filingsCount;
        do{
            console.log(`fetching CIK=${cik} start=${pageStart}`);
            let rss = await webGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&start=${pageStart}&count=${secPagesSize}&output=atom`);
            await common.wait(100);
            let $rss = cheerio.load(rss, {xmlMode: true});
            if(pageStart==0) {  //set header info
                let $companyInfo = $rss('feed company-info');
                history.entityInfo.name = get($companyInfo, 'conformed-name');
                history.entityInfo.fiscalYearEnd = get($companyInfo, 'fiscal-year-end');
                history.entityInfo.stateOfIncorporation = get($companyInfo, 'state-of-incorporation');
                $companyInfo.find('formerly-names names').each(function (i, elem) {
                    if(!history.entityInfo.formerNames) history.entityInfo.formerNames = [];
                    let $formerName = $rss(elem);
                    history.entityInfo.formerNames.push(
                        {
                            name: get($formerName, 'name'),
                            date: get($formerName, 'date')
                        }
                    );
                });
                $companyInfo.find('addresses address').each(function (i, elem) {  //should be "mailing" and "business"
                    if (!history.entityInfo.addresses) history.entityInfo.addresses = {};
                    let addressType = $rss(elem).attr('type');
                    history.entityInfo.addresses[addressType] = getAddress($rss(elem));
                });
            }
            filingsCount = $rss('feed entry').length;

            $rss('feed entry').each(function (i, elem) {
                let $entry = $rss(elem);
                history.filings.push({
                    accession: get($entry, 'accession-number'),
                    act: get($entry, 'act'),
                    form:  get($entry, 'filing-type'),
                    title: get($entry, 'title'),
                    href: $entry.find('link').attr('href'),
                    fileNumber: get($entry, 'file-number'),
                    filmNumber: get($entry, 'film-number'),
                    filingDate: get($entry, 'filing-date'),
                    filingName: get($entry, 'file-name'),  //Current report
                    items: get($entry, 'items-desc'),  //items 5.03 and 9.01
                    size: get($entry, 'size'),  //303 KB
                    htmlSummary: get($entry, 'summary') // &lt;b&gt;Filed:&lt;/b&gt; 2020-08-07 &lt;b&gt;AccNo:&lt;/b&gt; 0001193125-20-213158 &lt;b&gt;Size:&lt;/b&gt; 303 KB&lt;br&gt;Item 5.03: Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year&lt;br&gt;Item 9.01: Financial Statements and Exhibits

                })
            });
            pageStart += secPagesSize
        } while (filingsCount==secPagesSize && pageStart<maxSubmissions);
        await common.writeS3(`submissions/CIK${cik}.json`, JSON.stringify(history));
        console.log (`wrote ${history.filings.length} submissions for ${history.entityInfo.name} (CIK ${cik})`);
    }
}

function webGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url,
            (resp) => {
                let data = '';
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                resp.on('end', () => {
                    resolve(data);
                });
                resp.on("error", (err) => {
                    reject(err);
                });
            }
        );
    });
}

function getAddress($xmlSection){
    const address = {
        phone: get($xmlSection, 'phone'),
        street1: get($xmlSection, 'street1'),
        street2: get($xmlSection, 'street2'),
        city: get($xmlSection, 'city'),
        stateOrCountry: get($xmlSection, 'state'),
        //stateOrCountryDescription: get($xmlSection, 'stateOrCountryDescription'),
        zipCode: get($xmlSection, 'zip')
    };
    if(!address.phone) delete address.phone;
    if(!address.street2) delete address.street2;
    return address;
}
function get($xmlSection, path){ return readAndRemoveTag($xmlSection, path, remainsChecking)}
function readAndRemoveTag($xml, tagPath, remainsChecking){
    let $tag = $xml.find?$xml.find(tagPath):$xml(tagPath);
    const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
    let value = $tag.text().replace(rgxTrim, '');
    if(remainsChecking) $tag.remove();
    return value;
}

makeSubmissionHistoryAPI();