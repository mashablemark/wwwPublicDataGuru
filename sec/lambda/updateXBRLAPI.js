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
    await common.logEvent('updateXBRL API started', JSON.stringify(event));

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
        numericalFacts: []
    };  //event = processIndexHeaders parsing of index-headers.html file
    //loop through submission files looking for primary HTML document and Exhibit 101 XBRL XML documents
    for (let i = 0; i < event.files.length; i++) {
        if(XBRLDocuments.iXBRL[event.files[i].type]) {
            console.log('primary '+event.files[i].type + ' HTML doc found: '+ event.path + event.files[i].name);
            let fileBody = await common.readS3(event.path + event.files[i].name);
            console.log('html length: '+ fileBody.length);
            await parseIXBRL(cheerio.load(fileBody), submission);
            console.log(submission.counts);
        }
        if(XBRLDocuments.XBRL[event.files[i].type]) {
            console.log('XBRL '+event.files[i].type + ' doc found: '+ event.path + event.files[i].name);
            let fileBody = await common.readS3(event.path + event.files[i].name);
            await parseXBRL(cheerio.load(fileBody, {xmlMode: true}), submission);
            console.log(submission.counts);
        }
    }
    console.log(JSON.stringify(submission.dei));

    //save parsed submission object into DB and update APIs
    if(submission.counts.standardFacts) {
        console.log('saving submission...');
        await saveXBRLSubmission(submission);
        console.log('sub mission saved: end of updateXBRL lambda event handler!');

        const updateTSPromise = common.runQuery("call updateTimeSeries('"+submission.filing.adsh+"');");  //52ms runtime
        //todo: have updateTSPromise  return all TS for cik/tag (not just UOM & QTRS updated)

        let updateAPIPromises = [];
        const financialStatementsList = await common.runQuery("call getFinancialStatementsList('"+submission.dei.cik+"');");
        //todo: add list properties: (1) "statement": path to primary HTML doc (2) "isIXBRL" boolean
        updateAPIPromises.push(common.writeS3('sec/financialStatementsByCompany/cik'+parseInt(submission.dei.cik), JSON.stringify(financialStatementsList.data)));

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
            let cikKey = 'cik' + parseInt(ts.cik).toString();
            s3Key = 'sec/timeseries/' + ts.tag + '/' + cikKey + '.json';
            let qtrs = "DQ" + ts.qtrs;  //DQ prefix = duration in quarters
            if (!oTimeSeries.tag) {
                oTimeSeries.tag = {
                    label: ts.label,
                    description: ts.description
                };
                oTimeSeries['cikKey'] = {
                    entityName: ts.entityname,
                    units: {}
                }
            }
            if (!oTimeSeries[cikKey].units[ts.uom]) {
                oTimeSeries[cikKey].units[ts.uom] = {}
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
            let S3key = 'sec/frames/'+fact.tag+'/'+tag.uom+'/DQ'+tag.qtrs;
            let needsUpdate = false;
            let frameRecord = await common.runQuery(getCommand);
            let frame = JSON.parse(frameRecord.data[0].json);
            let newPoint = {"accn": submission.filing.adsh,
                "cik": submission.dei.EntityCentralIndexKey || submission.filing.cik,
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
                if(point.cik==submission.dei.cik){
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
                    await common.writeS3(s3Key, JSON.stringify(frame));
                    resolve(s3Key);
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
                        submission.dei[tag] = val;
                        if (!this.attribs.contextref) common.logEvent("missing DEI contextRef for "+tag, submission.filing.adsh);
                        if (!submission.dei.contextref && this.attribs.contextref) {
                            submission.dei.contextref = this.attribs.contextref;
                        } else {
                            if(submission.dei.contextref != this.attribs.contextref) common.logEvent("conflicting DEI contextRef", submission.filing.adsh);
                        }
                    } else {
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
        parsedFacts.dei[elem.attribs.name.substr(4)] = $(elem).text();
        if (!elem.attribs.contextref) common.logEvent("missing DEI contextRef", parsedFacts.filing.adsh);
        if (!parsedFacts.dei.contextref && elem.attribs.contextref) {
            parsedFacts.dei.contextref = elem.attribs.contextref;
        } else {
            if(parsedFacts.dei.contextref != elem.attribs.contextref) common.logEvent("conflicting DEI contextRef", parsedFacts.filing.adsh);
        }
        if(elem.attribs.format && elem.attribs.format.indexOf('daymonth')!=-1) common.logEvent("unhandled data form", elem.attribs.format + ' in iXBRL of ' + parsedFacts.filing.adsh);
        //problematic date formats all contain the string 'daymonth': http://www.xbrl.org/inlineXBRL/transformation/
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
        parseContextElement($, elem, submission);
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
                    let factKey = xbrl.tag+':'+xbrl.qtrs+':'+xbrl.uom+':'+xbrl.end;
                    if(!parsedFacts.facts[factKey]){
                        parsedFacts.facts[factKey] = xbrl;
                        parsedFacts.hasIXBRL = true;
                    } else {
                        if(parsedFacts.facts[factKey].value != xbrl.value)
                            common.logEvent('ERROR: XBRL value conflict in '+parsedFacts.filing.adsh, '['+JSON.stringify(xbrl)+','
                                +JSON.stringify(parsedFacts.facts[factKey])+']');
                    }
                    parsedFacts.counts.standardFacts++;
                }
            }
            parsedFacts.counts.facts++;
        } catch (e) {
            common.logEvent('ERROR updateXBRLAPI extracting nonfraction from iXBRL in '+ parsedFacts.filing.adsh, e.message, true); //log error and continue parsing
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
        $end = $(this).find('xbrli\\:endDate');
        if(!$end.length) $end = $(this).find('endDate');
        end = $end.text().trim();
        dtEnd = new Date(dtEnd);
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
            console.log('ERROR parsing context '+contextID+' in XBRL doc of ' + submissionObject.filing.adsh);
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
            common.logEvent('ERROR updateXBRLAPI parsing unit tag in iXBRL doc :', element.attribs.id, true);
            throw('ERROR updateXBRLAPI for parsing unit tag ' + element.attribs.id);
        }
    }
    submissionObject.counts.units++
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
            scale: $ix.attr('scale'),
            format: $ix.attr('format'),
            sign: $ix.attr('sign'),
            isStandard: standardNumericalTaxonomies.indexOf(nameParts[0])!==-1,
            text: $ix.text().trim()
        };
    console.log(JSON.stringify(xbrl));
    xbrl.value = xbrlToNumber(xbrl.text, xbrl.format, xbrl.scale);
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
    //save main submission record into fin_sub
    /*  EntityRegistrantName: 'DOVER Corp',
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
        EntityCentralIndexKey: '0000029905' } */
    let q = common.q,
        start = new Date(),
        sql = 'INSERT INTO fin_sub(adsh, cik, name, sic, fye, form, period, fy, fp, filed'
        + ', countryba, stprba, cityba, zipba, bas1, bas2, baph, '
        + ' countryma, stprma, cityma, zipma, mas1, mas2, countryinc, stprinc, ein, former, changed, afs, wksi, '
        +' accepted, prevrpt, detail, instance, nciks, aciks '
        + " ) VALUES ("+q(s.filing.adsh)+s.dei.EntityCentralIndexKey+","+q(s.dei.EntityRegistrantName)+(s.filing.sic||0)+','
        + q(s.dei.CurrentFiscalYearEndDate.replace(/-/g,'').substr(-4,4))+q(s.dei.DocumentType)+q(s.dei.DocumentPeriodEndDate)
        + q(s.dei.DocumentFiscalYearFocus)+q(s.dei.DocumentFiscalPeriodFocus)+q(s.filing.filingDate)
        + q(s.filing.businessAddress.country)+q(s.filing.businessAddress.state)+q(s.filing.businessAddress.city)+q(s.filing.businessAddress.zip)
        + q(s.filing.businessAddress.street1)+q(s.filing.businessAddress.street2)+q(s.filing.businessAddress.phone)
        + q(s.filing.mailingAddress.country)+q(s.filing.mailingAddress.state)+q(s.filing.mailingAddress.city)+q(s.filing.mailingAddress.zip)
        + q(s.filing.mailingAddress.street1)+q(s.filing.mailingAddress.street2)
        + q(s.filing.incorporation?s.filing.incorporation.country:null)+q(s.filing.incorporation?s.filing.incorporation.state:null)+q(s.filing.ein)
        + q('former')+q('changed')+ q('afs')+q(s.dei.EntityFilerCategory)+ q(s.filing.acceptanceDateTime) +" 4, 5, "
        + q(s.dei.instance)+"12342,"+q(s.dei.EntityCentralIndexKey, true)+")";
    await common.runQuery(sql);

    //save numerical fact records into fin_num
    let i=0, fact, numSQL, version, coreg;
    const numInsertHeader = 'insert into fin_num (adsh, tag, version, coreg, start, end, qtrs, uom, value, footnote) values ';
    numSQL = numInsertHeader;
    for(let factKey in s.facts){
        fact = s.facts[factKey]; //fact object properties: tag, ns, unitRef, contextRef, decimals & val
        if(fact.unit.nomid && s.unitTree[fact.unit.nomid]) fact.unit.label = s.unitTree[fact.unit.nomid].label || fact.unit.label;
        if(fact.unit.denomid) fact.label += ' per ' + (s.unitTree[fact.unit.denomid].label || fact.unit.denomid);

        if (fact.member) {
            coreg = fact.member.split(':').pop();
            if (coreg.length > 5 && coreg.substr(-5, 5) == 'Member') coreg = coreg.substr(0, coreg.length - 5);  //hack to match DERA dataset
        } else coreg = '';
        version = (standardNumericalTaxonomies.indexOf(fact.ns) == -1) ? s.adsh : fact.ns;
        if(version!=s.adsh && coreg=='' && fact.unit) fact.isStandard = true;
        //multi-row inserts are faster
        numSQL += (i%1000==0?'':', ') + "(" + q(s.adsh) + q(fact.tag) + q(version) + q(coreg) + q(fact.start)  + q(fact.end)  + q(fact.qtrs)
            + q(fact.unit)+ q(fact.val) + "','')";
        i++;
        if(i%1000==0){ //but don't let the query get too long.... max packet size 2MB
            await common.runQuery(numSQL);
            numSQL = numInsertHeader;
        }
    }
    if(i%1000!=0) await common.runQuery(numSQL);  // execute multi-row insert
    let end = new Date();
    console.log('wrote ' + i + ' facts for '+s.coname+' ' + s.form + ' for ' + s.fy + s.fp + ' ('+ s.adsh +') in ' + (end-start) + ' ms');
}

/*////////////////////TEST CARD  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
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
/*
#single select has all frame info, but need node.js to par
select count(*) as pts, fr.tag, fr.ddate, fr.qtrs, fr.uom, fr.tlabel, fr.doc,
  CONCAT('[', GROUP_CONCAT(CONCAT('["', s.adsh, '",', s.cik, ',', s.sic, ',"', s.name, '",', n.value, ',', s.filed, ']') order by cik, filed), ']') as json
from f_num n
INNER JOIN f_sub s on n.adsh = s.adsh
inner join
(SELECT
  distinct n.tag, ddate, qtrs, uom, st.tlabel, st.doc
  FROM f_num n
  INNER JOIN standardtag st ON n.tag = st.tag
 WHERE n.version<>n.adsh
  AND n.coreg=''
  AND n.qtrs in (0,1,4)
  AND n.adsh='0000002178-18-000067'
) fr ON fr.tag=n.tag and fr.uom=n.uom and fr.ddate=n.ddate and fr.qtrs=n.qtrs
WHERE n.coreg='' AND n.version<>n.adsh
GROUP BY fr.tag, fr.ddate, fr.qtrs, fr.uom, fr.tlabel, fr.doc

*/

/*

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateFrames`(ADSH as varchar(20))
NO SQL
BEGIN
#creates ~ 100 records (avg) per ADSH in ???s

    #variable declarations
DECLARE newTag varchar(255);
DECLARE standardTlabel varchar(512);
DECLARE standardDoc varchar(2048);
DECLARE newDdate char(10);
DECLARE newUom varchar(256);
DECLARE newQtrs tinyint;
DECLARE json text;
DECLARE pts int;
DECLARE terminate INT DEFAULT 0;

#cursor and handler declarations
DECLARE cr_newtagdates CURSOR FOR
  SELECT distinct n.tag, ddate, qtrs, uom, st.tlabel, st.doc
  FROM f_num n
  INNER JOIN standardtag st ON n.tag = st.tag
  AND n.version<>n.adsh
  AND n.coreg=''
  AND n.qtrs in (0,1,4)
  AND n.adsh=ADSH;
DECLARE CONTINUE HANDLER FOR NOT FOUND SET terminate = 1;

#double the max size to 2 MB for group_concat and concat
set @@session.group_concat_max_len = 1048576 * 2;
set @@global.max_allowed_packet = 1048576 * 2;

CREATE TEMPORARY TABLE tmp_frame_num
select s.adsh, s.cik, s.filed as lastfiled, n.value from f_sub s inner join f_num n on n.adsh=s.adsh limit 0;

Open cr_newtagdates;
fact_loop: LOOP
FETCH cr_newtagdates INTO newTag, newDdate, newQtrs, newUom,
    standardTlabel, standardDoc;
IF terminate = 1 THEN
LEAVE fact_loop;
END IF;

# regular table = not thread safe to allow multiple procedures to run
truncate table tmp_frame_num;
insert into frame_working  (adsh, cik, lastfiled, value)
SELECT s.adsh, s.cik, max(s.filed) as lastfiled, value
FROM f_num n
INNER JOIN f_sub s on n.adsh = s.adsh
WHERE n.tag=newTag AND n.qtrs=newQtrs
AND n.ddate=newDdate AND n.uom=newUom
AND n.coreg='' AND n.value is not null
AND n.adsh <> n.version
GROUP BY s.cik, s.adsh, value;

#make the fact's JSON
SELECT
count(*) as pts,
CONCAT('[', GROUP_CONCAT(CONCAT('["', s.adsh, '",', s.cik, ',', s.sic, ',"', s.name, '","', s.countryba, '",', COALESCE(concat('[', pl.lat, ',', pl.lon, ']'), 'null'), ',', n.value, ',', revisions, ']')), ']') as json
INTO json, pts
FROM f_sub s
INNER JOIN (
    select cik, max(adsh) as adsh, lastfiled, revisions
from frame_working fw
inner join (select cik, max(filed) as mxfiled, count(distinct value) as revisions from frame_working group by cik) mx
on mx.cik=fw.cik and mx.mxfiled=fw.filed
) mxfw on s.adsh=mxfw.adsh
INNER JOIN frame_working fw on mxfw.adsh=fs.adsh
LEFT OUTER JOIN postcodeloc pl on s.countryba = pl.cnty and left(s.zipba, 5) = pl.zip;

INSERT INTO frames
(tag, ddate, uom, qtrs, tlabel, tdoc, pts, json, api_written)
VALUES (newTag, newDdate, newUom, newQtrs, currentTlabel, currentDoc, pts, json, 0)
ON DUPLICATE KEY UPDATE
json=json, pts=pts, tlabel=currentTlabel, doc=currentDoc, api_written=0;

truncate table tmp_frame_num;

END LOOP fact_loop;

#update submission's state (Note: not thread safe)
UPDATE f_sub set api_state=0 WHERE api_state=3;
#cleanup and exit
CLOSE cr_newtagdates;
END$$
DELIMITER ;






DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateTimeSeries`(IN `adsh` VARCHAR(25))
NO SQL
BEGIN
#added analytical index (moved to addFilingIndexes), created 3.8M times series & drop index (moved to addFilingIndexes) in 28 minutes (for single ADSH should be ~100ms)
DECLARE currentCik INT;
#DECLARE currentCoName VARCHAR(150);
DECLARE terminate INTEGER DEFAULT 0;
DECLARE ciks CURSOR FOR
SELECT DISTINCT cik FROM f_sub
where api_state=1 or not updatesOnly;  #unprocessed has multiple state
DECLARE CONTINUE HANDLER
FOR NOT FOUND SET terminate = 1;

CREATE TEMPORARY TABLE tmp_adsh
select adsh, name, sic, fy, fp, form, api_state
from f_sub ;

CREATE TEMPORARY TABLE tmp_timeseries
Select cik, tag, uom, qtrs, pts, json, newpoints
from timeseries limit 0;

if(NOT updatesOnly)
then truncate table timeseries;
end if;

Open ciks;
cik_loop: LOOP

FETCH ciks INTO currentCik;
IF terminate = 1 THEN
LEAVE cik_loop;
END IF;

#set submission state = TS step 1 processing
update f_sub s SET s.processedState = 2
where s.cik=currentcik and s.processedState = 1;

#create a tmp table of just the adsh for this cik (b/c mysql is incompetent at optimizing this query)
TRUNCATE TABLE tmp_adsh;
insert into tmp_adsh
select adsh, name, sic, fy, fp, form, api_state
from f_sub where cik = currentCik;

#insert the current cik’s f_num records into temp table
CREATE TEMPORARY TABLE standard_pts
SELECT n.adsh, n.tag, n.uom, n.qtrs, n.value, n.ddate, name, sic, fy, fp, form
FROM f_num n inner join tmp_adsh ta on n.adsh=ta.adsh
WHERE n.version <> n.adsh and coreg="" and qtrs in (0,1,4);

#insert the cik’s timeseries records into temp table
truncate tmp_timeseries;
INSERT INTO tmp_timeseries
Select currentCik,
    tag,
    uom,
    qtrs,
    COUNT(distinct ddate) as pts,
    CONCAT("[",  GROUP_CONCAT(CONCAT("[""", ddate, """,", value, ",""", adsh, """,""", fy, " ", fp, """,""", form, """,""", replace(name, "'", "''"), """,", sic, "]") ORDER BY ddate ASC, ADSH DESC SEPARATOR ","), "]") as json,
    sum(if(api_state=2, 1, 0)) as newpoints
from standard_pts
group by tag, uom, qtrs;

#inpute/update
INSERT INTO timeseries (cik, tag, uom, qtrs, pts, json, newpoints)
Select cik, tag, uom, qtrs, pts, json, newpoints
from tmp_timeseries
where newpoints>0 or not updatesOnly
ON DUPLICATE KEY UPDATE
timeseries.pts = tmp_timeseries.pts,
    timeseries.json = tmp_timeseries.json,
    timeseries.newpoints = tmp_timeseries.newpoints;

DROP TEMPORARY TABLE IF EXISTS standard_pts;

END LOOP cik_loop;

#release resources
CLOSE ciks;
DROP TEMPORARY TABLE IF EXISTS tmp_adsh;
DROP TEMPORARY TABLE IF EXISTS tmp_timeseries;
CALL dropIndexSafely('f_num', 'ix_adshtag');

#final update of timeseries’ co name, tag name, and tag description from f-tag and f_sub

#get latest definition of all standard tag into temp table
UPDATE standardtag st, timeseries ts
set ts.tlabel=st.tlabel, ts.doc=st.doc
where ts.tag=st.tag;

#get latest company name too
update timeseries ts
inner join f_sub s on ts.cik = s.cik
inner join (select max(period) as period, cik from f_sub group by cik) mxs on mxs.cik = s.cik and mxs.period = s.period
set ts.coname = s.name;

END$$
DELIMITER ;
*/
