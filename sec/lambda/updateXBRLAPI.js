//RUN THESE TO FAKE startdate, enddate and ccp
//update f_num set enddate=ddate, startdate = date_sub(ddate, interval qtrs quarter), ccp=concat('CY',year(date_sub(ddate, interval 40 day)),'Q',quarter(date_sub(ddate, interval 40 day))) where qtrs = 1;
//update f_num set enddate=ddate, startdate = null, ccp=concat('CY',year(date_sub(ddate, interval 40 day)),'Q',quarter(date_sub(ddate, interval 40 day)),'I') where qtrs = 0;
//update f_num set enddate=ddate, startdate = date_sub(ddate, interval qtrs quarter), ccp=concat('CY',year(date_sub(ddate, interval 180 day))) where qtrs = 4;

// updateXBRLAPI.js runs as a AWS Lambda function (note: configured to run up to 20 of these functions concurrently)
// input:  faily JSON index entry for 10K/Q submission created by and called from  processIndexHeader for new
// form 10Q, 10Q/A, 10K, or 10K/A
// actions:
//   1. read the HTML and parse using cheerio as an XML doc
//     a - if iXBRL doc, and parse iXBRL into memory submission data structure
//     b - else read type='EX-101.INS' (XBRL INSTANCE DOCUMENT)
//todo:   2. read and parse EX-101.SCH, EX-101.CAL, EX-101.DEF, EX-101.LAB, EX-101.PRE
//   3. write parsed data structure to the mySQL tables:
//     - f_sub = submission and header info
//     - f_num = fact table (us-gaap and ifr tags only; dimensionless facts only)
//     note: f_tag maintained separately from published gaap and ifr taxonomies
//   4. call updateXBRLAPI(adsh) to update the rows affected by the submission in
//     - xbrl_api_timeseries
//     - xbrl_api_frame
//   5. update the reporter REST API
//     - select the affected xbrl_api_timeseries rows (where updated timestamp is null and cik reporting entity)
//     - write to S3: restdata.publicdata.guru/sec/ and set updated timestamp
//     - tell cloudFront to refresh the cache for this entity's timeseries (single call = less expensive)
//   6. update the issuer REST API
//     - select the affected ownership_api_issuer row (where cik = issuer_cik)
//     - write to S3: restdata.publicdata.guru/sec/
//     - tell cloudFront to refresh the cache for the updated issuer API file

// to compile:  zip -r updateXBRLAPI.zip updateXBRLAPI.js node_modules/mysql2 node_modules/htmlparser2 node_modules/entities node_modules/cheerio node_modules/inherits node_modules/domhandler node_modules/domelementtype node_modules/parse5 node_modules/dom-serializer node_modules/css-select node_modules/domutils node_modules/nth-check node_modules/boolbase node_modules/css-what node_modules/sqlstring node_modules/denque node_modules/lru-cache node_modules/pseudomap node_modules/yallist node_modules/long node_modules/iconv-lite node_modules/safer-buffer node_modules/generate-function node_modules/is-property secure.js common.js
// lambda execution time = 10s using a 512MB container
// executions per year = 26,000
// Lambda execution costs for updateXBRLAPI per year = $0.000000834 * 100 payment units of 100ms * 26,000 = $2.16 per year
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

//GLOBAL VARS (CAN PERSIST BETWEEN LAMBDA CALLS)
const cheerio = require('cheerio');
const common = require('./common');

const skipNameSpaces = ['xbrli','xbrldi'];  //already scrapped in parts 1. of this routine, but for "deiNumTags" exceptions
const standardNumericalTaxonomies = ['us-gaap', 'ifrs', 'invest', 'dei', 'srt'];
const standardQuarters = [0, 1, 4];
const deiNumTags = ['EntityCommonStockSharesOutstanding', 'EntityListingParValuePerShare', 'EntityNumberOfEmployees' ,'EntityPublicFloat'];  //dei tags scraped by DERA (but not other such as period, fy...
const XBRLDocuments= {
    iXBRL: {
        '10-Q': 'html',
        '10-Q/A': 'html',
        '10-K': 'html',
        '10-K/A': 'html',
    },
    XBRL: {
        'EX-101.INS': 'xml'
    }
};
const bucket = "restapi.publicdata.guru";

exports.handler = async (event, context) => {
    let dbCheckPromise = common.runQuery("select sum(recs) as records from ("
        + "select count(*) as recs from fin_sub where adsh='"+event.adsh+"' "
        + "   UNION ALL "
        + "select count(*) as recs from fin_num where adsh='"+event.adsh+"') r"
    );

    let submission = {
        filing: event,
        counts: {
            facts: 0,
            standardFacts: 0,
            units: 0,
            contexts: 0
        },
        dei: {},
        namespaces: {},
        contextTree: {},
        unitTree: {},
        facts: {}
    };  //event = processIndexHeaders parsing of index-headers.html file
    //loop through submission files looking for primary HTML document and Exhibit 101 XBRL XML documents
    for (let i = 0; i < event.files.length; i++) {
        if(XBRLDocuments.iXBRL[event.files[i].type]) {
            console.log('primary '+event.files[i].type + ' HTML doc found: '+ event.path + event.files[i].name);
            let fileBody = await common.readS3(event.path + event.files[i].name);
            console.log('html length: '+ fileBody.length);
            await parseIXBRL(cheerio.load(fileBody), submission);
            if(submission.hasIXBRL) submission.hasIXBRL = event.files[i].name;
            submission.primaryHTML = event.files[i].name;
            console.log(submission.counts);
        }
        if(XBRLDocuments.XBRL[event.files[i].type]) {
            console.log('XBRL '+event.files[i].type + ' doc found: '+ event.path + event.files[i].name);
            let fileBody = await common.readS3(event.path + event.files[i].name);
            await parseXBRL(cheerio.load(fileBody, {xmlMode: true}), submission);
            if(submission.hasXBRL) submission.hasXBRL = event.files[i].name;
            console.log(submission.counts);
        }
    }
    console.log(JSON.stringify(submission.dei));
    if(submission.dei.EntityCentralIndexKey.value!=submission.filing.cik)
        await common.logEvent('ERROR: header and DEI CIK mismatch', submission.filing.path);
    //save parsed submission object into DB and update APIs
    if(submission.counts.standardFacts) {
        let existingRecords = await dbCheckPromise;
        if(existingRecords.data.length){
            await common.logEvent('WARNING: existing XBRL records', event.adsh + ' has '+existingRecords.data[0].records+' fin_sub and fin_num records');
            await common.runQuery("delete from fin_sub where adsh='"+ event.adsh+"'");
            await common.runQuery("delete from fin_num where adsh='"+ event.adsh+"'");
        }
        console.log('saving submission...');
        await saveXBRLSubmission(submission);
        console.log('sub mission saved: end of updateXBRL lambda event handler!');

        const updateTSPromise = common.runQuery("call updateTimeSeries('"+submission.filing.adsh+"');");  //52ms runtime
        //todo: have updateTSPromise  return all TS for cik/tag (not just UOM & QTRS updated)

        let updateAPIPromises = [];
        const financialStatementsList = await common.runQuery("call listFinancialStatements('"+submission.dei.EntityCentralIndexKey.value+"');");
        //todo: add list properties: (1) "statement": path to primary HTML doc (2) "isIXBRL" boolean
        updateAPIPromises.push(common.writeS3('sec/financialStatementsByCompany/cik'+parseInt(submission.dei.EntityCentralIndexKey.value), JSON.stringify(financialStatementsList.data)));

        //write to time series REST API in S3
        let updatedTimeSeriesAPIDataset = await updateTSPromise;  //updates and returns all TS for the tags in submission (note: more returned than updated)
        let lastCik = false,
            lastTag = false,
            oTimeSeries = {},
            s3Key;
        for(let i=0; i<updatedTimeSeriesAPIDataset.data.length;i++) {
            let ts = updatedTimeSeriesAPIDataset.data[i];
            if (lastCik && lastTag && (lastCik != ts.cik || lastTag != ts.tag)) {
                updateAPIPromises.push(common.writeS3(s3Key, JSON.stringify(oTimeSeries)));
                oTimeSeries = {};
            }
            lastCik = ts.cik;
            lastTag = ts.tag;
            let cikKey = 'cik' + parseInt(ts.cik, 10).toString();
            s3Key = 'sec/timeseries/' + ts.tag + '/' + cikKey + '.json';
            let qtrs = "DQ" + ts.qtrs;  //DQ prefix = duration in quarters
            if (!oTimeSeries.tag) {
                oTimeSeries.tag = {
                    label: ts.label,
                    description: ts.description
                };
                oTimeSeries[cikKey] = {
                    entityName: ts.entityname,
                    units: {}
                };
            }
            if (!oTimeSeries[cikKey].units[ts.uom]) {
                oTimeSeries[cikKey].units[ts.uom] = {};
            }
            oTimeSeries[lastTag][cikKey]["units"][ts.uom]['DQ'+ts.qtrs] = JSON.parse(ts.json);  //DQ = duration in quarters
        }
        updateAPIPromises.push(common.writeS3(s3Key, JSON.stringify(oTimeSeries)));  //write of final rollup

        //write to frame REST API in S3 by looping through list of parsed facts and updating the DB's JSON object rather than recreating = too DB intensive
        for(let tag in submission.facts){
            let fact = submission.facts[tag];
            if(fact.isStandard && fact.ccp){
                updateAPIPromises.push(updateFrame(fact));
            }
        }

        //promise collection
        for(let i=0;i<updateAPIPromises.length;i++){
            await updateAPIPromises[i];
        }
    } else {
        console.log('no iXBRL/XBRL found: end of updateXBRL lambda event handler!');
    }

    function updateFrame(fact, submissionObject, depth=1){
        // 1. read JSON and timestamp from DB
        // 2. update JSON if needed
        // 3. if updated write to DB via stored procedure (updateFrame) that checks for timestamp constancy:
        //     returns (A) confirmation -> next fact) or (B) new timestamp and json for retry (step 2)
        return new Promise(async (resolve, reject) => {
            let getCommand = "call updateFrame("+common.q(fact.tag)+common.q(fact.ccp)+common.q(fact.uom)+"'', '')";  //no json = get request
            let S3key = 'sec/frames/'+fact.tag+'/'+fact.uom+'/'+fact.ccp+'.json';
            let needsUpdate = false;
            let frameRecord = await common.runQuery(getCommand);
            let frame = JSON.parse(frameRecord.data[0].json);
            let newPoint = {"accn": submission.filing.adsh,
                "cik": submission.dei.EntityCentralIndexKey.value || submission.filing.cik,
                "entityName": submission.dei.EntityRegistrantName||submission.filing,
                "sic": submission.filing.sic,
                "loc": (submission.filing.businessAddress.country || submission.filing.businessAddress.country || 'US') + '-' + (submission.filing.businessAddress.state || submission.filing.businessAddress.state),
                "start": fact.start,
                "end": fact.end,
                "val": fact.value,
                "rev": 1};
            let i;
            for(i=0;i<frame.data.length;i++){
                let point = frame.data[i];
                if(point.cik==submission.dei.EntityCentralIndexKey.value){
                    if((point.start!=newPoint.start && (point.start || newPoint.start)) || point.end!=newPoint.end)
                        throw("parsed tag "+fact.tag+" has different dates that frame for "+ S3key);
                    if(point.value!=newPoint.value) newPoint.rev = point.rev+1;
                    if(point.value!=newPoint.value  || point.sic!=newPoint.sic  || point.entityName!=newPoint.entityName  || point.loc!=newPoint.loc){
                        frame.data.splice(i,1,newPoint);
                        needsUpdate = true;
                        break;
                    }
                }
            }
            if(i==frame.data.length){
                needsUpdate = true;
                frame.data.push(newPoint);
            }
            if(needsUpdate){
                getCommand  = "call updateFrame("+common.q(fact.tag)+common.q(fact.ccp)+common.q(fact.uom)+common.q(JSON.stringify(frame))+common.q(frameRecord.data[0].timestamp, true)+")";  //no json = get request
                let response = await await common.runQuery(getCommand);
                if(response.date[0].processed){
                    await common.writeS3(S3key, JSON.stringify(frame));
                    resolve(S3key);
                } else {
                    if(depth<3)
                        resolve(await updateFrame(fact, submissionObject, depth+1));  //retry up to 3 times
                    else
                        reject(S3key);
                }
            }
        });
    }
};

function parseXBRL($, submission){
    //1. scrape reference data and make hash tables by creating a object tree of key-values
    //1a. make namespaces lookup object tree
    getElements('xbrli', 'xbrl').each(function() {
        for(var attr in this.attribs){ //'xmlns:us-gaap': 'http://fasb.org/us-gaap/2018-01-31',
            var attrParts = attr.split(':');
            if(attrParts[0]=='xmlns') submission.namespaces[attrParts[1]] =  this.attribs[attr];
        }
    });

    //1b. make context reference tree
    getElements('xbrli', 'context').each((i, elem)=>{ parseContextElement($, elem, submission)});

    //1c. unit reference tree
    getElements('xbrli', 'unit').each((i, elem)=>{ parseUnitElement($, elem, submission)});

    //1d & e. scrap dei and numerical tag values (by looping through all tags)
    var nameParts, val, $this, tag, tax;
    $('*').each(function(i, elem) { //gave up on trying to select tags in a namespace (e.g. 'us-gaap\\:*' does not work)
        if(this.type == 'tag' ){
            $this = $(elem);
            val = $this.text().trim();
            nameParts = elem.name.split(':');
            if(nameParts.length==2){
                tax = nameParts[0];
                tag = nameParts[1];
                if((skipNameSpaces.indexOf(tax)==-1) && val.length){
                    if(tax=='dei'){
                        submission.dei[tag] = {
                            value: val,
                            contextRef: this.attribs.contextRef || this.attribs.contextref
                        };
                        if (!submission.dei[tag].contextRef) common.logEvent("missing DEI contextRef for "+tag, submission.filing.adsh);
                    } else {
                        if(standardNumericalTaxonomies.indexOf(tax)!=-1){
                            let xbrl = extractFactInfo(submission, $, elem);
                            if(xbrl.isStandard){  //todo:  process facts with dimensions & axes (members)
                                if(!xbrl.dim && standardQuarters.indexOf(xbrl.qtrs)!== -1) {
                                    let factKey = xbrl.tag+':'+xbrl.qtrs+':'+xbrl.uom+':'+xbrl.end;
                                    if(!submission.facts[factKey]){
                                        submission.facts[factKey] = xbrl;
                                        submission.hasXBRL = true;
                                    } else {
                                        if(submission.facts[factKey].value != xbrl.value)
                                            common.logEvent('ERROR: XBRL value conflict in '+submission.filing.adsh, '['+JSON.stringify(xbrl)+','
                                                +JSON.stringify(submission.facts[factKey])+']');
                                    }
                                    submission.counts.standardFacts++;
                                }
                            }
                        }
                    }


                }
            }
        }
    });
    //console.log(submission);
    return submission;

    function getElements(namespace, tagName){
        var $tags = $(namespace+'\\:'+tagName);
        if(!$tags.length) $tags = $(tagName);
        return $tags;
    }
}

function parseIXBRL($, parsedFacts){
    //get DEI attributes:
    //read all dei namespace tags
    let $deiTags = $('ix\\:nonnumeric[name^="dei:"]');
    if($deiTags.length==0) return;  //this html doc does not contain SEC compliant inline XBRL
    if(!parsedFacts.dei) parsedFacts.dei = {};
    $deiTags.each((i, elem)=> {
        let deiTag = elem.attribs.name.split(':').pop();
        parsedFacts.dei[deiTag] = {
            val: $(elem).text(),
            contextRef:  elem.attribs.contextref || elem.attribs.contextRef
        }.text();
        if (!elem.attribs.contextref) common.logEvent("missing DEI contextRef for "+deiTag, parsedFacts.filing.adsh);
        //problematic date formats all contain the string 'daymonth': http://www.xbrl.org/inlineXBRL/transformation/
        if(elem.attribs.format && elem.attribs.format.indexOf('daymonth')!=-1) common.logEvent("unhandled data form", elem.attribs.format + ' in iXBRL of ' + parsedFacts.filing.adsh);
    });
    /*  parsedFacts.dei =>  { EntityRegistrantName: 'DOVER Corp',
            CurrentFiscalYearEndDate: '--12-31',
            EntityCurrentReportingStatus: 'Yes',
            EntityFilerCategory: 'Large Accelerated Filer',
            EntitySmallBusiness: 'FALSE',
            EntityEmergingGrowthCompany: 'FALSE',
            DocumentFiscalYearFocus: '2018',
            DocumentFiscalPeriodFocus: 'Q1',
            DocumentType: '10-Q',
            AmendmentFlag: 'FALSE',
            DocumentPeriodEndDate: '3/31/2019',
            EntityCentralIndexKey: '0000029905' }*/

    //get iXBRL context tags make lookup tree for contextRef date values and dimensions
    $('xbrli\\:context').each(function(i, elem) {
        parseContextElement($, elem, parsedFacts);
    });

    //get iXBRL unit tags and make lookup tree for unitRef values
    $('xbrli\\:unit').each(function(i) {
        parseUnitElement($, this, parsedFacts);
    });

    $('ix\\:nonfraction').each(function(i, elem){
        try{
            let xbrl = extractFactInfo(parsedFacts, $, elem);
            if(xbrl.isStandard){  //todo:  process facts with dimensions & axes (members)
                if(!xbrl.dim && standardQuarters.indexOf(xbrl.qtrs)!== -1) {
                    let factKey = xbrl.tag+':'+xbrl.qtrs+':'+xbrl.uom.label+':'+xbrl.end;
                    if(!parsedFacts.facts[factKey]){
                        parsedFacts.facts[factKey] = xbrl;
                        parsedFacts.hasIXBRL = true;
                    } else {
                        if(parsedFacts.facts[factKey].value != xbrl.value){
                            common.logEvent('ERROR: XBRL value conflict in '+parsedFacts.filing.adsh, '['+JSON.stringify(xbrl)+','
                                +JSON.stringify(parsedFacts.facts[factKey])+']');
                        }
                    }
                    parsedFacts.counts.standardFacts++;
                }
            }
            parsedFacts.counts.facts++;
        } catch (e) {
            common.logEvent('ERROR: updateXBRLAPI extracting nonfraction from iXBRL in '+ parsedFacts.filing.adsh, e.message, true); //log error and continue parsing
        }
    });
    return parsedFacts;
}

function parseContextElement($, element, submissionObject){
    var contextID, $element, newContext, start, end, dtEnd, dtStart = null, $start, $end, $member;
    $element = $(element);
    contextID = $element.attr('id');
    $start = $element.find('xbrli\\:startDate');
    if(!$start.length) $start = $element.find('startDate');
    if($start.length==1) {
        start = $start.text().trim();
        dtStart = new Date(start);
        $end = $element.find('xbrli\\:endDate');
        if(!$end.length) $end = $element.find('endDate');
        end = $end.text().trim();
        dtEnd = new Date(end);
        newContext = {
            start: start,
            end: end,
            qtrs: Math.round((dtEnd - dtStart)/(365/4*24*3600*1000)),
        };
    } else {
        var $instant = $element.find('xbrli\\:instant');
        if(!$instant.length) $instant = $element.find('instant');
        if($instant.length){
            end = $instant.text().trim();
            newContext = {
                start: null,
                end: end,
                qtrs: 0,
            };
        } else {
            console.log('ERROR: parsing context '+contextID+' in XBRL doc of ' + submissionObject.filing.adsh);
        }
    }
    if(standardQuarters.indexOf(newContext.qtrs)) newContext.ccp = common.closestCalendricalPeriod(dtStart, dtEnd);
    $member = $element.find('xbrldi\\:explicitMember');
    if(!$member.length) $member = $element.find('explicitMember');
    if($member.length && $member.attr('dimension')){
        newContext.member = $member.text().trim();
        newContext.dim = $member.attr('dimension');
    }
    submissionObject.contextTree[contextID] = newContext;
    submissionObject.counts.contexts++;
}
function parseUnitElement($, element, submissionObject){
    let $measure, $member, $num, $denom, $element = $(element);
    $num = $element.find('xbrli\\:unitNumerator xbrli\\:measure');
    if (!$num.length) $num = $element.find('unitNumerator measure');
    $denom = $element.find('xbrli\\:unitDenominator xbrli\\:measure');
    if (!$denom.length) $denom = $element.find('unitDenominator measure');

    if ($num.length == 1 && $denom.length == 1) {
        let numerator = $num.text().split(':').pop(),
            denominator = $denom.text().split(':').pop();
        submissionObject.unitTree[element.attribs.id] = {
            numid: numerator,
            denomid: denominator,
            label: numerator + (denominator?' per ' + denominator:'')
        };
    } else {
        $measure = $element.find('xbrli\\:measure');
        if (!$measure.length) $measure = $element.find('measure');
        if ($measure.length == 1) {
            submissionObject.unitTree[element.attribs.id] = {label: $measure.text().split(':').pop()};
        } else {
            common.logEvent('ERROR: updateXBRLAPI parsing unit tag in iXBRL doc :', element.attribs.id, true);
            throw('ERROR: updateXBRLAPI for parsing unit tag ' + element.attribs.id);
        }
    }
    submissionObject.counts.units++;
}
function extractFactInfo(objParsedSubmission, $, ix){  //contextRef and unitRef
    let $ix = $(ix),
        name = $ix.attr('name') || ix.name,
        nameParts = name.split(':'),
        contextRef = $ix.attr('contextref') || $ix.attr('contextRef'),
        unitRef = $ix.attr('unitref') || $ix.attr('unitRef'),
        xbrl = {
            uom: objParsedSubmission.unitTree[unitRef],
            taxonomy: nameParts[0],
            tag: nameParts[1],
            scale: ix.attribs.scale, //$ix.attr('scale'),  //iXBRL only; XBRL has scale in contextRef
            decimals: ix.attribs.decimals, //XBRL & iXBRL
            format: ix.attribs.format,  //only iXBRL?
            sign: ix.attribs.sign,
            isStandard: standardNumericalTaxonomies.indexOf(nameParts[0])!==-1,
            text: $ix.text().trim()
        };
    xbrl.value = xbrlToNumber(xbrl.text, xbrl.format||'standard', xbrl.scale);
    if(objParsedSubmission.contextTree[contextRef]){
        let context = objParsedSubmission.contextTree[contextRef];
        xbrl.qtrs = context.qtrs;
        xbrl.end = context.end;
        if(context.start) xbrl.start = context.start;
        if(context.member) xbrl.member = context.member;
        if(context.dim) xbrl.dim = context.dim;
        if(context.ccp) xbrl.ccp = context.ccp;
    } else {
        throw('missing contextRef for ' + xbrl.tag);
    }
    return xbrl;
}
function xbrlToNumber(text, format, scale){
    switch(format){
        case "ixt:zerodash":
            if(text=='—') return 0;  //falls through to numdotdecimal
        case "ixt:numdotdecimal":
        case 'standard':
            return parseFloat(text.replace(/,/g, ''))*10**(scale||0);
        case "ixt:numcommadecimal":
            return parseFloat(text.replace(/\./g, '').replace(/,/,'.'))*10**(scale||0);
        case "ixt-sec:numtexten":
        //todo:  adapt regex to convert english to numbers
        default:
            throw('unrecognized numerical format '+ format+ ' for '+text);
    }
}

async function saveXBRLSubmission(s){
    //console.log(JSON.stringify(s)); //debug only!!!
    //save main submission record into fin_sub
    let q = common.q,
        start = new Date(),
        sql = 'INSERT INTO fin_sub(adsh, cik, name, sic, fye, form, period, fy, fp, filed'
            + ', countryba, stprba, cityba, zipba, bas1, bas2, baph, '
            + ' countryma, stprma, cityma, zipma, mas1, mas2, countryinc, stprinc, ein, former, changed, filercategory, '
            +' accepted, prevrpt, detail, instance, nciks, aciks '
            + " ) VALUES ("+q(s.filing.adsh)+s.dei.EntityCentralIndexKey.value+","+q(s.dei.EntityRegistrantName.value)+(s.filing.sic||0)+','
            + q(s.dei.CurrentFiscalYearEndDate.value.replace(/-/g,'').substr(-4,4))+q(s.dei.DocumentType.value)+q(s.dei.DocumentPeriodEndDate.value)
            + q(s.dei.DocumentFiscalYearFocus.value)+q(s.dei.DocumentFiscalPeriodFocus.value)+q(s.filing.filingDate)
            + q(s.filing.businessAddress.country)+q(s.filing.businessAddress.state)+q(s.filing.businessAddress.city)+q(s.filing.businessAddress.zip)
            + q(s.filing.businessAddress.street1)+q(s.filing.businessAddress.street2)+q(s.filing.businessAddress.phone)
            + q(s.filing.mailingAddress.country)+q(s.filing.mailingAddress.state)+q(s.filing.mailingAddress.city)+q(s.filing.mailingAddress.zip)
            + q(s.filing.mailingAddress.street1)+q(s.filing.mailingAddress.street2)
            + q(s.filing.incorporation?s.filing.incorporation.country:null)+q(s.filing.incorporation?s.filing.incorporation.state:null)+q(s.filing.ein)
            + q('former')+q('changed')+q(s.dei.EntityFilerCategory.value)+ q(s.filing.acceptanceDateTime) +" 4, 5, "
            + q(s.hasIXBRL||s.hasXBRL)+"1,"+q(s.dei.EntityCentralIndexKey.value, true)+")";
    await common.runQuery(sql);

    //save numerical fact records into fin_num
    console.log('saving facts...');
    let i=0, fact, numSQL, version, coreg;
    const numInsertHeader = 'insert into fin_num (adsh, tag, version, coreg, start, end, qtrs, ccp, uom, value) values ';
    numSQL = numInsertHeader;
    for(let factKey in s.facts){
        console.log(JSON.stringify(fact));  //todo: DEBUG ONLY!!
        fact = s.facts[factKey]; //fact object properties: tag, ns, unitRef, contextRef, decimals & val
        if(fact.uom){
            if (fact.member) {
                coreg = fact.member.split(':').pop();
                if (coreg.length > 5 && coreg.substr(-5, 5) == 'Member') coreg = coreg.substr(0, coreg.length - 5);  //hack to match DERA dataset
            } else coreg = '';
            version = (standardNumericalTaxonomies.indexOf(fact.taxonomy) == -1) ? s.filing.adsh : fact.taxonomy;
            if(version!=s.adsh && coreg=='' && fact.unit) fact.isStandard = true;
            //multi-row inserts are faster
            numSQL += (i%1000==0?'':', ') + "(" + q(s.filing.adsh) + q(fact.tag) + q(version) + "''," + q(fact.start)+ q(fact.end)  + fact.qtrs+','
                + q(fact.ccp) + q(fact.uom.label) + fact.value + ")";
            i++;
            if(i%1000==0){ //but don't let the query get too long.... max packet size 2MB
                await common.runQuery(numSQL);
                numSQL = numInsertHeader;
            }
        }else {
            console.log('WARNING: no units for tag '+fact.tag); //lots of footnotes and some date tags
        }
    }
    if(i%1000!=0) await common.runQuery(numSQL);  // execute multi-row insert
    let end = new Date();
    console.log('saveXBRLSubmission wrote ' + i + ' facts for '+s.coname+' ' + s.form + ' for ' + s.fy + s.fp + ' ('+ s.adsh +') in ' + (end-start) + ' ms');
}

/*//////////////////// TEST CARDS  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
// TEST Card A: iXBRL 10Q:  https://www.sec.gov/Archives/edgar/data/29905/000002990519000029/0000029905-19-000029-index.htm
const event = 	{
  "path": "sec/edgar/29905/000002990519000029/",
  "adsh": "0000029905-19-000029",
  "cik": "0000029905",
  "fileNum": "001-04018",
  "form": "10-Q",
  "filingDate": "20190418",
  "period": "20190331",
  "acceptanceDateTime": "20190418072005",
  "indexHeaderFileName": "sec/edgar/29905/000002990519000029/0000029905-19-000029-index-headers.html",
  "files": [
    {
      "name": "dov-20190331.htm",
      "description": "10-Q"
    },
    {
      "name": "a2019033110-qex101.htm",
      "description": "EX-10.1"
    },
    {
      "name": "a2019033110-qexhibit102.htm",
      "description": "EX-10.2"
    },
    {
      "name": "a2019033110-qexhibit103.htm",
      "description": "EX-10.3"
    },
    {
      "name": "a2019033110-qex104.htm",
      "description": "EX-10.4"
    },
    {
      "name": "a2019033110-qexhibit311.htm",
      "description": "EX-31.1"
    },
    {
      "name": "a2019033110-qexhibit312.htm",
      "description": "EX-31.2"
    },
    {
      "name": "a2019033110-qexhibit32.htm",
      "description": "EX-32"
    },
    {
      "name": "dov-20190331.xsd",
      "description": "EX-101.SCH"
    },
    {
      "name": "dov-20190331_cal.xml",
      "description": "EX-101.CAL"
    },
    {
      "name": "dov-20190331_def.xml",
      "description": "EX-101.DEF"
    },
    {
      "name": "dov-20190331_lab.xml",
      "description": "EX-101.LAB"
    },
    {
      "name": "dov-20190331_pre.xml",
      "description": "EX-101.PRE"
    },
    {
      "name": "dov-20190331_g1.jpg",
      "description": "GRAPHIC"
    },
    {
      "name": "image1.jpg",
      "description": "GRAPHIC"
    },
    {
      "name": "image2.jpg",
      "description": "GRAPHIC"
    },
    {
      "name": "image3.jpg",
      "description": "GRAPHIC"
    }
  ],
  "bucket": "restapi.publicdata.guru",
  "sic": "3530",
  "ein": "530257888",
  "incorporation": {
    "state": "DE",
    "country": false
  },
  "businessAddress": {
    "street1": "3005 HIGHLAND PARKWAY",
    "street2": "SUITE 200",
    "city": "DOWNERS GROVE",
    "state": "IL",
    "zip": "60515",
    "phone": "(630) 541-1540"
  },
  "mailingAddress": {
    "street1": "3005 HIGHLAND PARKWAY",
    "street2": "SUITE 200",
    "city": "DOWNERS GROVE",
    "state": "IL",
    "zip": "60515",
    "phone": false
  }
};
exports.handler(event);
///////////////////////////////////////////////////////////////////////////////////////////////*/


/*////////////////////////////////////////////////////////////////////////////////////////////////
// TEST Card B: XBRL 10K:  https://www.sec.gov/Archives/edgar/data/1000180/000100018016000068/0001000180-16-000068-index.htm

{
  "path": "sec/edgar/data/1000180/000100018016000068/",
  "adsh": "0001000180-16-000068",
  "cik": "0001000180",
  "fileNum": "000-26734",
  "form": "10-K",
  "filingDate": "20160212",
  "period": "20160103",
  "acceptanceDateTime": "20160212170356",
  "indexHeaderFileName": "sec/edgar/data/1000180/000100018016000068/0001000180-16-000068-index-headers.html",
  "files": [
    {
      "name": "sndk201510-k.htm",
      "description": "FORM 10-K FY15",
      "type": "10-K"
    },
    {
      "name": "sndkex-1037xnewy2facilitya.htm",
      "description": "NEW Y2 FACILITY AGREEMENT",
      "type": "EX-10.37"
    },
    {
      "name": "sndkex-121xratioofearnings.htm",
      "description": "COMPUTATION OF RATIO TO FIXED CHARGES",
      "type": "EX-12.1"
    },
    {
      "name": "sndkex-211xsignificantsubs.htm",
      "description": "SUBSIDIARIES OF THE REGISTRANT",
      "type": "EX-21.1"
    },
    {
      "name": "sndkex-231xconsentofindepe.htm",
      "description": "CONSENT OF INDEPENDENT REGISTERED PUBLIC ACCOUNTING FIRM",
      "type": "EX-23.1"
    },
    {
      "name": "sndkex-311xsoxceocertfy15.htm",
      "description": "CEO CERTIFICATION TO SECTION 302",
      "type": "EX-31.1"
    },
    {
      "name": "sndkex-312xsoxcfocertfy15.htm",
      "description": "CFO CERTIFICATION TO SECTION 302",
      "type": "EX-31.2"
    },
    {
      "name": "sndkex-321xsec906ceocertfy.htm",
      "description": "CEO CERTIFICATION TO SECTION 906",
      "type": "EX-32.1"
    },
    {
      "name": "sndkex-322xsec906cfocertfy.htm",
      "description": "CFO CERTIFICATION TO SECTION 906",
      "type": "EX-32.2"
    },
    {
      "name": "sndk-20160103.xml",
      "description": "XBRL INSTANCE DOCUMENT",
      "type": "EX-101.INS"
    },
    {
      "name": "sndk-20160103.xsd",
      "description": "XBRL TAXONOMY EXTENSION SCHEMA DOCUMENT",
      "type": "EX-101.SCH"
    },
    {
      "name": "sndk-20160103_cal.xml",
      "description": "XBRL TAXONOMY EXTENSION CALCULATION LINKBASE DOCUMENT",
      "type": "EX-101.CAL"
    },
    {
      "name": "sndk-20160103_def.xml",
      "description": "XBRL TAXONOMY EXTENSION DEFINITION LINKBASE DOCUMENT",
      "type": "EX-101.DEF"
    },
    {
      "name": "sndk-20160103_lab.xml",
      "description": "XBRL TAXONOMY EXTENSION LABEL LINKBASE DOCUMENT",
      "type": "EX-101.LAB"
    },
    {
      "name": "sndk-20160103_pre.xml",
      "description": "XBRL TAXONOMY EXTENSION PRESENTATION LINKBASE DOCUMENT",
      "type": "EX-101.PRE"
    },
    {
      "name": "performancegraph2015.jpg",
      "type": "GRAPHIC"
    },
    {
      "name": "sndk.jpg",
      "type": "GRAPHIC"
    }
  ],
  "bucket": "restapi.publicdata.guru",
  "sic": "3572",
  "ein": "770191793",
  "incorporation": {
    "state": "DE",
    "country": false
  },
  "businessAddress": {
    "street1": "951 SANDISK DRIVE",
    "street2": false,
    "city": "MILPITAS",
    "state": "CA",
    "zip": "95035",
    "phone": "408-801-1000"
  },
  "mailingAddress": {
    "street1": "951 SANDISK DRIVE",
    "street2": false,
    "city": "MILPITAS",
    "state": "CA",
    "zip": "95035",
    "phone": false
  }
}
*/
