// updateXBRLAPI.js runs as a AWS Lambda function (note: configured to run up to 20 of these functions concurrently)
// input:  faily JSON index entry for 10K/Q submission created by and called from  processIndexHeader for new
// form 10Q, 10Q/A, 10K, or 10K/A
// actions:
//   1. read the HTML and parse using cheerio as an XML doc and parse iXBRL into memory submission data structure
//   2. write parsed data structure to the mySQL tables:
//     - f_sub = submission and header info
//     - f_num = fact table (us-gaap and ifr tags only; dimensionless facts only)
//     note: f_tag maintained separately from published gaap and ifr taxonomies
//   3. call updateXBRLAPI(adsh) to update the rows affected by the submission in
//     - xbrl_api_timeseries
//     - xbrl_api_frame
//   4. update the reporter REST API
//     - select the affected xbrl_api_timeseries rows (where updated timestamp is null and cik reporting entity)
//     - write to S3: restdata.publicdata.guru/sec/ and set updated timestamp
//     - tell cloudFront to refresh the cache for this entity's timeseries (single call = less expensive)
//   4. update the issuer REST API
//     - select the affected ownership_api_issuer row (where cik = issuer_cik)
//     - write to S3: restdata.publicdata.guru/sec/
//     - tell cloudFront to refresh the cache for the updated issuer API file

// to compile:  zip -r updateXBRLAPI.zip updateXBRLAPI.js node_modules/mysql2 node_modules/htmlparser2 node_modules/entities node_modules/cheerio node_modules/inherits node_modules/domhandler node_modules/domelementtype node_modules/parse5 node_modules/dom-serializer node_modules/css-select node_modules/domutils node_modules/nth-check node_modules/boolbase node_modules/css-what node_modules/sqlstring node_modules/denque node_modules/lru-cache node_modules/pseudomap node_modules/yallist node_modules/long node_modules/iconv-lite node_modules/safer-buffer node_modules/generate-function node_modules/is-property secure.js
// lambda execution time = ??s
// executions per year = 26,000
// Lambda execution costs for updateXBRLAPI per year =
// CloudFront XBRL invalidation costs per year = 26,000 * (1 timeseries path +  320 frame paths) * $0.005 per invalidation path = $41,000 per year

// problem: simultaneous invalidation request limit of 3,0000 file invalidation & 15 path invalidation whereas peak filing day has 5,000 submissions * 320 changed frame generating 1,600,000 invalidation request
// note: invalidate requests take 5 - 15 minutes (with some users reporting times up to 1 hour)
// Problem:  Path invalidation have lower concurrency limit, so even large paths (e.g. just "cdate") will bump against limit on peak filing days, which is < 750 submissions for last 5 years
// Paths per average submission:
//    - frame files = 320
//    - [cdate, qtrs, uom] path = 16.6
//    - [cdate] = 7.1 => 700 path request per hour
// Invalidation requests can be further reduced by using listInvalidations and getInvalidation to loop thourgh request to see if a new request is needed.  Problem: what to do is invalidation request is in-flight?
// ALTERNATE STRATEGY: set API TTL at 2 minutes for the API and do not invalidate

var cheerio = require('cheerio');
var mysql2 = require('mysql2/promise');
var AWS = require('aws-sdk');
var secure = require('./secure');  //must not be committed

var skipNameSpaces = ['dei','xbrli'];  //already scrapped in parts 1. of this routine, but for "deiNumTags" exceptions
var standardNumericalTaxonomies = ['us-gaap', 'ifrs', 'invest', 'dei', 'srt'];
var deiNumTags = ['EntityCommonStockSharesOutstanding', 'EntityListingParValuePerShare',
    'EntityNumberOfEmployees' ,'EntityPublicFloat'];  //dei tags scraped by DERA (but not other such as period, fy...

var con;  //global db connection
var XBRLDocuments= {
    iXBRL: {
        'FORM 10-Q': 'html',
        'FORM 10-Q/A': 'html',
        'FORM 10-K': 'html',
        'FORM 10-K/A': 'html',
    },
    XBRL: {
        'XBRL INSTANCE DOCUMENT': 'xml'
    }
};

var s3 = new AWS.S3();
const bucket = "restapi.publicdata.guru";
async function readS3(file){
    return new Promise((resolve, reject) => {
        let params = {
            Bucket: bucket,
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
}
function writeS3(fileKey, text) {
    return new Promise((resolve, reject) => {
        s3.putObject({
            Body: text,
            Bucket: bucket,
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


exports.handler = async (event, context) => {
    const db_info = secure.publicdataguru_dbinfo();
    con = await mysql2.createConnection({ //global db connection
        host: db_info.host, //'localhost',
        user: db_info.user,
        password: db_info.password,
        database: db_info.database
    });
    await logEvent('updateXBRL API invoked', JSON.stringify(event));

    let filing = {
        path: event.path,
        fileNum: event.fileNum,
        form: event.form,
        adsh: event.adsh,
        filerCik: event.cik,
        filedDate: event.filingDate,
        acceptanceDateTime: event.acceptanceDateTime,
        period: event.period,
        files: event.files
    };
    for (let i = 1; i < filing.files.length; i++) {
        if(XBRLDocuments.iXBRL[filing.files[i].type]) {
            let fileBody = await readS3(filing.path + filing.primaryDocumentName);
            await parseIXBRL(cheerio.load(fileBody, {xmlMode: true}), submission);
        }
        if(XBRLDocuments.XBRL[filing.files[i].type]) {
            let fileBody = await readS3(filing.path + filing.primaryDocumentName);
            await parseXBRL(cheerio.load(fileBody, {xmlMode: true}), submission);
        }
    }
    if(submission)
    console.log('end of lambda event handler!');
};


function parseXBRL($, submission){
    //1.get header info
    var required = true;
    header('DocumentType','form', true);  //"10-Q"
    //note: form 485BPOS does not have DocumentFiscalYearFocus, DocumentFiscalPeriodFocus
    required =  required && header('DocumentFiscalYearFocus','fy', true);  //"2019" (in 2018, so this is company's fiscal calendar)
    required =  required && header('DocumentFiscalPeriodFocus','fp', true);  //"Q2"
    required =  required && header('DocumentPeriodEndDate','period', true);  //"2018-09-30" (calendar date of end of period)
    required =  required && header('EntityCentralIndexKey','aciks');  //more than one cn be given
    required =  required && header('EntityRegistrantName', 'name', true);  //"NICHOLAS FINANCIAL INC"
    header('TradingSymbol','TradingSymbol'); //more than one can be given
    required =  required && header('CurrentFiscalYearEndDate','fye', true);  // "--03-31"
    header('EntityFilerCategory', 'EntityFilerCategory',true); //""Non-accelerated Filer
    header('EntityCommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'); //"12619744"
    header('AmendmentFlag', 'AmendmentFlag', true); ///"false"
    if(!required){
        logError('header tag missing', 'required header tag missing from '+submission.form+' / '+submission.adsh);
        return false;
    }
    var urlParts = submission.urlXBRL.split('/');
    submission.instance = urlParts[urlParts.length-1];
    submission.ddate = new Date(submission.period);
    switch(submission.fp){
        case 'Q1':
        case 'Q2':
        case 'Q3':
        case 'Q4':
            submission.q = parseInt(submission.fp.substr(1,1));
            break;
        case "CY":
        case "FY":
            submission.q = 4;
            break;
        case "H1":
        case "H2":
            submission.q = 2 * parseInt(submission.fp.substr(1,1));
            break;
        default:
            submission.q = false;
    }
    if(!submission.q) return false;
    var fdate = new Date(submission.fy, submission.q*3, 0);
    submission.deltaMonth = (submission.fy-submission.ddate.getFullYear())*12 + (fdate.getMonth()-submission.ddate.getMonth());

    //2. scrape reference data and make hash tables by creating a object tree of key-values
    submission.namespaces = {};
    submission.contextTree = {};
    submission.unitTree = {};

    var tags;
    //2a. make namespaces lookup object tree
    getElements('xbrli', 'xbrl').each(function() {
        for(var attr in this.attribs){ //'xmlns:us-gaap': 'http://fasb.org/us-gaap/2018-01-31',
            var attrParts = attr.split(':');
            if(attrParts[0]='xmlns'){
                submission.namespaces[attrParts[1]] =  this.attribs[attr];
            }
        }
    });

    //2b. make context reference lookup object tree
    var start, end, ddate, $start, $end, $member;
    getElements('xbrli', 'context').each(function(i, elem) {
        $this = $(elem);
        var id = $this.attr('id');
        $start = $this.find('xbrli\\:startDate');
        if(!$start.length) $start = $this.find('startDate');
        if($start.length==1) {
            start = new Date($start.html().trim());
            $end = $(this).find('xbrli\\:endDate');
            if(!$end.length) $end = $(this).find('endDate');
            ddate = $end.html().trim();
            end = new Date(ddate);
            submission.contextTree[id] = {
                ddate: ddate,
                qtrs: ((end.getFullYear() - start.getFullYear())*12 + (end.getMonth() - start.getMonth())) / 3
            }
        } else {
            var $instant = $this.find('xbrli\\:instant');
            if(!$instant.length) $instant = $this.find('instant');
            if($instant.length){
                ddate = $instant.html().trim();
                submission.contextTree[id] = {
                    ddate: ddate,
                    qtrs: 0
                }
            } else console.log('not sure what this is '+id);
        }
        $member = $this.find('xbrldi\\:explicitMember');
        if(!$member.length) $member = $this.find('explicitMember');
        if($member.length && $member.attr('dimension')){
            submission.contextTree[id].member = $member.html().trim();
            submission.contextTree[id].dim = $member.attr('dimension');
        }
    });

    //2c. make unit reference lookup object tree
    var $measure, $num, $denom;
    getElements('xbrli', 'unit').each(function(i) {
        $this = $(this);
        $num = $this.find('xbrli\\:unitNumerator xbrli\\:measure');
        if(!$num.length) $num = $this.find('unitNumerator measure');
        $denom = $this.find('xbrli\\:unitDenominator xbrli\\:measure');
        if(!$denom.length) $denom = $this.find('unitDenominator measure');

        if($num.length==1 && $denom.length==1){
            submission.unitTree[this.attribs.id] = {
                nomid: $num.text().split(':').pop(),
                denomid: $denom.text().split(':').pop()
            }
        } else {
            $measure = $this.find('xbrli\\:measure');
            if(!$measure.length) $measure = $this.find('measure');
            if($measure.length==1){
                submission.unitTree[this.attribs.id] = $measure.html().split(':').pop();
            } else {
                console.log('error parsing XBRL unit tag:', this.attribs.id);
                process.exit();
            }
        }
    });


    //3. scrap numerical tag values (by looping through all tags)
    var nameParts, val, $this, tag, tax;
    submission.num = [];
    $('*').each(function(i, elem) { //gave up on trying to select tags in a namespace (e.g. 'us-gaap\\:*')
        $this = $(this)
        if(this.type == 'tag' ){
            val = $this.text().trim();
            nameParts = this.name.split(':');
            if(nameParts.length==2){
                tax = nameParts[0];
                tag = nameParts[1];
                if((skipNameSpaces.indexOf(tax)==-1 || (tax=='dei' && deiNumTags.indexOf(tag)!==-1)) && val.length && !isNaN(val)){
                    if(submission.namespaces[this.name.split(':')[0]]){
                        submission.num.push({
                            tag: tag,
                            ns:  tax,
                            unitRef: this.attribs.unitRef,
                            contextRef: this.attribs.contextRef,
                            decimals: this.attribs.decimals || 'null',
                            val: val})
                    }
                }
            }
        }
    });
    //console.log(submission);
    return submission;

    function header(tag, property, unique){ //get XBRL header info with error checking (name optional, defaulting to deiTag)
        var $tag = $('dei\\:' + tag),
            values = [];
        $tag.each(function(i, elem){
            values.push($(elem).text().trim());
            if(unique){  //some header tags (e.g. fiscal year end) must not have conflicting values
                if(values[0]!=values[values.length-1]) logError("conflicting header tags",submission.adsh+" "+tag+"= "+values.join(', '))
            }
        });
        if (values.length == 0) {
            return false;
        } else {
            submission[property?property:tag] = unique?values[0]:values.join(',');  //some value have multiple tag, such as stock symbols
        }
        return true;
    }
    function getElements(namespace, tagName){
        var $tags = $(namespace+'\\:'+tagName);
        if(!$tags.length) $tags = $(tagName)
        return $tags;
    }
}

function parseIXBRL($, submission){
    console.log('parseIXBRL');
    var $reportingPeriod = $('ix\\:nonnumeric[name="dei\\:DocumentPeriodEndDate"]'),
        contextref = $reportingPeriod.attr('contextref'),
        ddate = new Date($reportingPeriod.text()),
        fy = parseInt(contextref.substr(2,4)),
        fq = parseInt(contextref.substr(7,1)),
        fdate = new Date(fy, fq*3, 0),
        ixbrlViewer = {contextTree: {}, standardTagTree: {}};
    ixbrlViewer.deltaMonth = (fy-ddate.getFullYear())*12 + (fdate.getMonth()-ddate.getMonth());
    ixbrlViewer.reportForm = $('ix\\:nonnumeric[name="dei\\:DocumentType"]').text();
    ixbrlViewer.reportPeriod = fy + (fq==4?' FY':' Q'+fq);
    var docPart = window.location.href.split('?doc=')[1].split('/');
    ixbrlViewer.cik = docPart[0];
    ixbrlViewer.adsh = docPart[1];

    //get iXBRL context tags make lookup tree for contextRef date values and dimensions
    var $context, start, end, ddate, $this, $start, $member;
    $('xbrli\\:context').each(function(i) {
        $this = $(this);
        $start = $this.find('xbrli\\:startdate');
        if($start.length==1) {
            start = new Date($start.html().trim());
            ddate = $this.find('xbrli\\:enddate').html().trim();
            end = new Date(ddate);
            ixbrlViewer.contextTree[$this.attr('id')] = {
                ddate: ddate,
                qtrs: ((end.getFullYear() - start.getFullYear())*12 + (end.getMonth() - start.getMonth())) / 3
            }
        } else {
            ddate = $this.find('xbrli\\:instant').html();
            ixbrlViewer.contextTree[$this.attr('id')] = {
                ddate: ddate,
                qtrs: 0
            }
        }
        $member = $this.find('xbrldi\\:explicitmember');
        if($member.length && $member.attr('dimension')){
            ixbrlViewer.contextTree[$this.attr('id')].member = $member.html().trim();
            ixbrlViewer.contextTree[$this.attr('id')].dim = $member.attr('dimension');
        }
    });

    //get iXBRL unit tags and make lookup tree for unitRef values
    var $measure, unitParts;
    $('xbrli\\:unit').each(function(i) {
        $this = $(this);
        $measure = $this.find('xbrli\\:unitnumerator xbrli\\:measure');
        if($measure.length==0) $measure = $this.find('xbrli\\:measure');
        if($measure.length==1){
            unitParts = $measure.html().split(':');
            ixbrlViewer.unitTree[$this.attr('id')] = unitParts.length>1?unitParts[1]:unitParts[0];
        } else {
            console.log('error parsing iXBRL unit tag:', this);
            process.exit();
        }
    });

    var $standardTag, navigateToTag = false;
    $('ix\\:nonfraction').each(function(i){
        var xbrl = extractXbrlInfo(this);
        if(xbrl.isStandard){
            if(!xbrl.dim && (xbrl.qtrs ==0 || xbrl.qtrs ==1 || xbrl.qtrs ==4)) {
                if (!ixbrlViewer.standardTagTree['Q' + xbrl.qtrs]) ixbrlViewer.standardTagTree['Q' + xbrl.qtrs] = {};
                if (!ixbrlViewer.standardTagTree['Q' + xbrl.qtrs][xbrl.uom]) ixbrlViewer.standardTagTree['Q' + xbrl.qtrs][xbrl.uom] = [];
                if (ixbrlViewer.standardTagTree['Q' + xbrl.qtrs][xbrl.uom].indexOf(xbrl.tag) === -1) {
                    ixbrlViewer.standardTagTree['Q' + xbrl.qtrs][xbrl.uom].push(xbrl.tag);
                }
            }
        }
    });
}

function extractXbrlInfo(ix){
    var $ix = $(ix),
        nameParts = $ix.attr('name').split(':'),
        contextRef = $ix.attr('contextref'),
        unitRef = $ix.attr('unitref');
    var xbrl = {
        uom: this.unitTree[unitRef],
        taxonomy: nameParts[0],
        tag: nameParts[1],
        sign: $(ix).attr('sign'),
        isGaap: nameParts[0]=='us-gaap',
        isStandard: this.standardNumericalTaxonomies.indexOf(nameParts[0])!==-1,
        value: $(ix).text(),
        cik: this.cik,
        num_adsh: this.adsh
    };
    if(this.contextTree[contextRef]){
        xbrl.qtrs = this.contextTree[contextRef].qtrs;
        xbrl.ddate = this.contextTree[contextRef].ddate;
        xbrl.member = (xbrl.member?xbrl.member:false);
        xbrl.dim = (xbrl.dim?xbrl.dim:false);
    }
    return xbrl;
}

async function saveXBRLSubmission(s){
    //save main submission record into fin_sub
    var sql = 'INSERT INTO fin_sub(adsh, cik, name, sic, fye, form, period, fy, fp, filed'
        + ', countryba, stprba, cityba, zipba, bas1, bas2, '
        + ' baph, countryma, stprma, cityma, zipma, mas1, mas2, countryinc, stprinc, ein, former, changed, afs, wksi, '
        +' accepted, prevrpt, detail, instance, nciks, aciks '
        + " ) VALUES ('"+s.adsh+"',"+s.cik+","+q(s.coname)+",'"+(s.sic||0)+"','"+s.fye.replace(/-/g,'').substr(-4,4)+"',"+q(s.form)+",'"+s.period+"','"
        +s.fy+"','"+s.fp+"','"+s.filed+"','cb', 'sb', 'cityba', 'zipba', 'bas1', 'bas2', "
        + "'baph', 'cm', 'sm', 'cityma', 'zipma', 'mas1', 'mas2', 'ci', 'si', 99, 'former', 'changed', "
        + "'afs', 3, '"+ s.accepted.substr(0,10) +"', 4, 5, "+q(s.instance)+", 12342,"+q(s.aciks)+")";
    await runQuery(sql);

    //save numerical fact records into fin_num
    var i, fact, unit, context, numSQL, version, coreg;
    for(i=0;i<s.num.length;i++){
        fact = s.num[i]; //fact object properties: tag, ns, unitRef, contextRef, decimals & val
        if(fact.unitRef){
            unit = s.unitTree[fact.unitRef];
            if(unit){
                if(unit.nomid && unit.denomid) unit = unit.nomid + ' per ' + unit.denomid;
            } else {
                unit = '';
                logError('unable to lookup unitRef in unit tree', JSON.stringify(fact));
                process.exit();
            }
        } else {
            logError('unable to find unitRef ', JSON.stringify(fact));
            unit = '';
        }
        context = s.contextTree[fact.contextRef];
        if(context) {
            if (context.member) {
                coreg = context.member.split(':').pop();
                if (coreg.length > 5 && coreg.substr(-5, 5) == 'Member') coreg = coreg.substr(0, coreg.length - 5);  //hack to match DERA dataset
            } else coreg = '';
            version = (standardNumericalTaxonomies.indexOf(fact.ns) == -1) ? s.adsh : fact.ns;
            numSQL = 'insert into fin_num (adsh, tag, version, coreg, ddate, qtrs, uom, value, footnote) values '
                + "('" + s.adsh + "','" + fact.tag + "','" + version + "','" + coreg + "','" + context.ddate + "','" + context.qtrs
                + "','" + unit + "','" + fact.val + "','')";
            await runQuery(numSQL);
        } else {
            logError('context not found', s.urlIndexFile + ': ' + JSON.stringify(fact));  //must have a context ref to save
        }
    }
    console.log('wrote ' + i + ' facts for '+s.coname+' ' + s.form + ' for ' + s.fy + s.fp + ' ('+ s.adsh +')');
}

function q(value, isLast){
    if(typeof value !== 'undefined' && value !== ''){
        return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast?'':',');
    } else {
        return ' null'+ (isLast?'':',');
    }
}

async function runQuery(sql){
    try{
        let [result, fields] = await con.execute(sql);
        return {data: result, fields: fields}
    } catch(err) {
        console.log(sql);
        await logEvent("fatal MySQL error", sql, true);
        throw err;
    }
}

async function logEvent(type, msg, display){
    await runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
    if(display) console.log(type, msg);
}



/////////////////////TEST CARD  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
// iXBRL 10Q test:  https://www.sec.gov/Archives/edgar/data/29905/000002990519000029/0000029905-19-000029-index.htm
const event = {"path":"sec/edgar/29905/000002990519000029/",
    "adsh":"0000029905-19-000029",
    "cik":"0000029905",
    "fileNum":"001-04018",
    "form":"10-Q",
    "filingDate":"20190418",
    "period":"20190331",
    "acceptanceDateTime":"20190418072005",
    "bucket":"restapi.publicdata.guru",
    "indexHeaderFileName":"sec/edgar/29905/000002990519000029/0000029905-19-000029-index-headers.html",
    "files":[
        {"file":"dov-20190331.htm","title":"Document 1 - file: dov-20190331.htm","type":"10-Q","desc":"10-Q"},
        {"file":"a2019033110-qex101.htm","title":"Document 2 - file: a2019033110-qex101.htm","type":"EX-10.1","desc":"EX - 10.1"},
        {"file":"a2019033110-qexhibit102.htm","title":"Document 3 - file: a2019033110-qexhibit102.htm","type":"EX-10.2","desc":"EX - 10.2"},
        {"file":"a2019033110-qexhibit103.htm","title":"Document 4 - file: a2019033110-qexhibit103.htm","type":"EX-10.3","desc":"EX - 10.3"},
        {"file":"a2019033110-qex104.htm","title":"Document 5 - file: a2019033110-qex104.htm","type":"EX-10.4","desc":"EX - 10.4"},
        {"file":"a2019033110-qexhibit311.htm","title":"Document 6 - file: a2019033110-qexhibit311.htm","type":"EX-31.1","desc":"EX - 31.1"},
        {"file":"a2019033110-qexhibit312.htm","title":"Document 7 - file: a2019033110-qexhibit312.htm","type":"EX-31.2","desc":"EX - 31.2"},
        {"file":"a2019033110-qexhibit32.htm","title":"Document 8 - file: a2019033110-qexhibit32.htm","type":"EX-32","desc":"EX - 32"},
        {"file":"dov-20190331.xsd","title":"Document 9 - file: dov-20190331.xsd","type":"EX-101.SCH","desc":"XBRL TAXONOMY EXTENSION SCHEMA DOCUMENT"},
        {"file":"dov-20190331_cal.xml","title":"Document 10 - file: dov-20190331_cal.xml","type":"EX-101.CAL","desc":"XBRL TAXONOMY EXTENSION CALCULATION LINKBASE DOCUMENT"},
        {"file":"dov-20190331_def.xml","title":"Document 11 - file: dov-20190331_def.xml","type":"EX-101.DEF","desc":"XBRL TAXONOMY EXTENSION DEFINITION LINKBASE DOCUMENT"},
        {"file":"dov-20190331_lab.xml","title":"Document 12 - file: dov-20190331_lab.xml","type":"EX-101.LAB","desc":"XBRL TAXONOMY EXTENSION LABEL LINKBASE DOCUMENT"},
        {"file":"dov-20190331_pre.xml","title":"Document 13 - file: dov-20190331_pre.xml","type":"EX-101.PRE","desc":"XBRL TAXONOMY EXTENSION PRESENTATION LINKBASE DOCUMENT"},
        {"file":"dov-20190331_g1.jpg","title":"Document 14 - file: dov-20190331_g1.jpg","type":"GRAPHIC","desc":false},
        {"file":"image1.jpg","title":"Document 15 - file: image1.jpg","type":"GRAPHIC","desc":false},
        {"file":"image2.jpg","title":"Document 16 - file: image2.jpg","type":"GRAPHIC","desc":false},
        {"file":"image3.jpg","title":"Document 17 - file: image3.jpg","type":"GRAPHIC","desc":false},
        {"file":"xsl/dov-20190331_htm.xml","title":"Document 18 - file: dov-20190331_htm.html","type":"XML","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"dov-20190331_htm.xml","title":"Document 18 - RAW XML: dov-20190331_htm.xml","type":"XML","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"Financial_Report.xlsx","title":"Document 98 - file: Financial_Report.xlsx","type":"EXCEL","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"Show.js","title":"Document 99 - file: Show.js","type":"XML","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"report.css","title":"Document 100 - file: report.css","type":"XML","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"xsl/FilingSummary.xml","title":"Document 101 - file: FilingSummary.html","type":"XML","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"FilingSummary.xml","title":"Document 101 - RAW XML: FilingSummary.xml","type":"XML","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"MetaLinks.json","title":"Document 104 - file: MetaLinks.json","type":"JSON","desc":"IDEA: XBRL DOCUMENT"},
        {"file":"0000029905-19-000029-xbrl.zip","title":"Document 105 - file: 0000029905-19-000029-xbrl.zip","type":"ZIP","desc":"IDEA: XBRL DOCUMENT"}
        ]};
  exports.handler(event);
///////////////////////////////////////////////////////////////////////////////////////////////\/