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

//REQUIRES LAMBDA LAYER "COMMON"
const cheerio = require('cheerio');
const common = require('common');

const skipNameSpaces = ['xbrli','xbrldi'];  //already scrapped in parts 1. of this routine, but for "deiNumTags" exceptions
const standardNumericalTaxonomies = ['us-gaap', 'ifrs', 'invest', 'dei', 'srt'];
const standardQuarters = [0, 1, 4];
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
const debugMode = false;  //set false in production or when running at scale to avoid large CloudWatch log & costs
const rootS3Folder = "test";  //todo: change root directory to "sec" from "test" to go live for S3 writes of financial statement lists, timeseries and frames APIs
const enableS3Writes = true;  //eliminate biggest cost of test runs.  Set true for PRODUCTION

exports.handler = async (messageBatch, context) => {
    if(!messageBatch.Records.length) {
        console.log('empty message from queue');
        return false;
    }

    let event = JSON.parse(messageBatch.Records[0].body);  //batch = 1 by configuration

    //if no DB connectivity, error willbe thrown to terminatre process
    await common.logEvent('updateXBRLAPI '+ event.adsh, 'invoked', true); //await first call to get connection; otherwise multiple connections get made

    const tries = await common.runQuery(`select htmlhash, xmlhash, tries from fin_sub where adsh = '${event.adsh}'`);
    if(tries.data.length && tries.data[0].tries>=3)
        return false;  //do not process after 3 tries!!!  End now (without error) to remove item from SMS queue

    //create / increment tries record before any processing or errors
    await common.runQuery(`insert into fin_sub (adsh, tries) values ('${event.adsh}', 1) on duplicate key update tries = tries + 1`);

    let submission = {
        filing: event,
        counts: {
            facts: 0,
            standardFacts: 0,
            units: 0,
            contexts: 0
        },
        dei: {
            EntityCentralIndexKey: [],
            EntityCommonStockSharesOutstanding: [],
            EntityFilerCategory: [],
            EntityRegistrantName: []
        },
        namespaces: {},
        contextTree: {},
        unitTree: {},
        facts: {}
    };  //event = processIndexHeaders parsing of index-headers.html file

    //loop through submission files looking for primary HTML document and Exhibit 101 XBRL XML documents
    for (let i = 0; i < event.files.length; i++) {
        if(XBRLDocuments.iXBRL[event.files[i].type]) {
            if(['.txt','.pdf'].indexOf(event.files[i].name.substr(-4).toLowerCase())===-1){
                console.log(`primary ${event.files[i].type } HTML doc found: ${event.path}${event.files[i].name}`);
                let fileBody = await common.readS3(event.path + event.files[i].name).catch(()=>{throw new Error(`unable to read ${event.path}${event.files[i].name}`)});
                let hash = common.makeHash(fileBody);
                if(tries.data.length && hash==tries.data[0].htmlhash){
                    await common.logEvent('WARNING updateXBRLAPI', `duplicate processing detected and avoided for ${event.path}${event.files[i].name}`, true);
                } else {
                    await common.runQuery(`update fin_sub set htmllength=${fileBody.length}, htmlhash='${hash}' where adsh='${event.adsh}'`);
                    await parseIXBRL(cheerio.load(fileBody), submission);
                    if(submission.hasIXBRL) submission.hasIXBRL = event.files[i].name;
                    submission.primaryHTML = event.files[i].name;
                    console.log(submission.counts);
                }
            } else {
                console.log('WARNING: primary doc is .txt or .pdf file -> skip');
            }
            runGarbageCollection();
        }
        if(XBRLDocuments.XBRL[event.files[i].type]) {
            console.log(`primary ${event.files[i].type } XBRL instance XML found: ${event.path}${event.files[i].name}`);
            let fileBody = await common.readS3(event.path + event.files[i].name).catch(()=>{throw new Error('unable to read ' + event.path + event.files[i].name)});
            console.log('read XML file');
            let hash = common.makeHash(fileBody);
            if(tries.data.length && hash==tries.data[0].xmlhash){
                await common.logEvent('WARNING updateXBRLAPI', `duplicate processing detected and avoided for ${event.path}${event.files[i].name}`, true);
            } else {
                await common.runQuery(`update fin_sub set xmllength=${fileBody.length}, xmlhash='${hash}' where adsh='${event.adsh}'`);

                await parseXBRL(cheerio.load(fileBody, {xmlMode: true}), submission);
                if (submission.hasXBRL) submission.hasXBRL = event.files[i].name;
                console.log(submission.counts);
            }
            runGarbageCollection();
        }
    }

    //console.log(JSON.stringify(submission));
    //save parsed submission object into DB and update APIs
    if(submission.counts.standardFacts) {
        if(deiValue('EntityCentralIndexKey',submission)!=submission.filing.cik)
            await common.logEvent('ERROR updateXBRLAPI: header and DEI CIK mismatch', submission.filing.path);
        await saveXBRLSubmission(submission);
        console.log('submission saved');

        const updateTSPromise = common.runQuery("call updateTimeSeries('"+submission.filing.adsh+"');");  //52ms runtime
        //todo: have updateTSPromise  return all TS for cik/tag (not just UOM & QTRS updated)

        let updateAPIPromises = [];
        const financialStatementsList = await common.runQuery("call listFinancialStatements('"+deiValue('EntityCentralIndexKey',submission)+"');");
        //todo: add list properties: (1) "statement": path to primary HTML doc (2) "isIXBRL" boolean
        if(enableS3Writes) updateAPIPromises.push(common.writeS3(rootS3Folder+'/financialStatementsByCompany/cik'+parseInt(deiValue('EntityCentralIndexKey',submission), 10)+'.json', financialStatementsList.data[0][0].jsonList));

        //write to time series REST API in S3

        let startTSProcess = new Date();
        let updatedTimeSeriesAPIDataset = await updateTSPromise;  //updates and returns all TS for the tags in submission (note: more returned than updated)
        let lastCik = false,
            lastTag = false,
            oTimeSeries = {},
            s3Key,
            i,
            timeSeriesFileCount = 0;
        //note:  stored procedures return select results (data[0]) and the status (data[1]) as a 2-element array
        console.log('count of TS to update: '+updatedTimeSeriesAPIDataset.data[0].length);
        for(i=0; i<updatedTimeSeriesAPIDataset.data[0].length;i++) {
            let ts = updatedTimeSeriesAPIDataset.data[0][i];
            if (lastCik && lastTag && (lastCik != ts.cik || lastTag != ts.tag)) {
                if(enableS3Writes) updateAPIPromises.push(common.writeS3(s3Key, JSON.stringify(oTimeSeries)));
                oTimeSeries = {};
                timeSeriesFileCount++;
            }
            lastCik = ts.cik;
            lastTag = ts.tag;
            let cikKey = 'cik' + parseInt(ts.cik, 10).toString();
            s3Key = rootS3Folder + '/timeseries/' + ts.tag + '/' + cikKey + '.json';
            let qtrs = "DQ" + ts.qtrs;  //DQ prefix = duration in quarters
            if (!oTimeSeries[ts.tag]) {
                oTimeSeries[ts.tag] = {
                    label: ts.label,
                    description: ts.description
                };
                oTimeSeries[ts.tag][cikKey] = {
                    entityName: ts.entityName,
                    units: {}
                };
            }
            if (!oTimeSeries[ts.tag][cikKey]["units"][ts.uom]) {
                oTimeSeries[ts.tag][cikKey]["units"][ts.uom] = {};
            }
            oTimeSeries[ts.tag][cikKey]["units"][ts.uom][qtrs] = JSON.parse(ts.json);  //DQ = duration in quarters
        }
        if(enableS3Writes) updateAPIPromises.push(common.writeS3(s3Key, JSON.stringify(oTimeSeries)));  //write of final rollup
        timeSeriesFileCount++;
        let endTSProcess = new Date();
        console.log('processed and (enableS3Writes = '+enableS3Writes.toString() +') made write promises for ' + timeSeriesFileCount + ' S3 object write(s) containing ' + i + ' time series from '+submission.dei.EntityRegistrantName.value+' ' + submission.filing.form + ' for ' + submission.filing.period + ' ('+ submission.filing.adsh +') in ' + (endTSProcess-startTSProcess) + ' ms');

        //write to frame REST API in S3 by looping through list of parsed facts and updating the DB's JSON object rather than recreating = too DB intensive
        let frameCount = 0;
        for(let factKey in submission.facts){
            let fact = submission.facts[factKey];
            if(fact.isStandard && fact.ccp && fact.uom){  //no uom = text block tag such as footnotes -> not a frame!
                updateAPIPromises.push(
                    updateFrame(fact).catch(error => {
                        console.log(error);
                        process.exit();
                    })
                );
                frameCount++;
            }
        }

        //promise collection
        for(let i=0;i<updateAPIPromises.length;i++){
            await updateAPIPromises[i];
        }
        console.log('processed and (enableS3Writes = '+enableS3Writes.toString() +') created ' + frameCount + ' frames from '+submission.dei.EntityRegistrantName.value+' ' + submission.filing.form + ' for ' + submission.filing.period + ' ('+ submission.filing.adsh +') in ' + (endTSProcess-startTSProcess) + ' ms');

    } else {
        await common.logEvent('WARNING updateXBRLAPI: no iXBRL/XBRL found' , event.path+'/'+event.adsh+'-index.html', true);
    }
    await common.logEvent('updateXBRLAPI '+ event.adsh, 'completed with ' + submission.counts.standardFacts + ' standard facts parsed', true);


    function updateFrame(fact){
        // 1. read JSON and timestamp from DB
        // 2. update JSON if needed
        // 3. if updated write to DB via stored procedure (updateFrame) that checks for timestamp constancy:
        //     returns (A) confirmation -> next fact) or (B) new timestamp and json for retry (step 2)

        return new Promise(async (resolve, reject) => {
            //initial call to updateFrame fetches frame data and tstamp to prevent collisions
            let getCommand = "call updateFrame("+common.q(fact.tag)+common.q(fact.uom.label)+common.q(fact.ccp)+fact.qtrs+",'', null);";  //no json = get request
            let S3key = rootS3Folder + '/frames/'+fact.tag+'/'+fact.uom.label+'/'+fact.ccp+'.json';
            let needsUpdate = false;
            let frameRecord = await common.runQuery(getCommand);
            if(debugMode) console.log('bytes used over return for '+S3key+": " + JSON.stringify(frameRecord).length + '/' + JSON.stringify(frameRecord.data[0][0]).length);
            let frame, frameDataArray;
            try{
                frame = frameRecord.data[0][0];
                frameDataArray = JSON.parse(frame.json);  //note:  apiWriteFramesAPI.py does this replace too before writing to S3
                frameDataArray.sort((a,b)=>{return a.cik-b.cik}); //this should not be necessary = insurance against some process misordering the array
            } catch(e){
                console.log('ERROR PARSING FRAME FOR ' + S3key);
                console.log(getCommand);
                console.log(frameRecord.data);
                throw e;
            }
            let newPoint = {
                "accn": submission.filing.adsh,
                "cik": parseInt(deiValue('EntityCentralIndexKey', submission)  || submission.filing.cik, 10),
                "entityName": deiValue('EntityRegistrantName', submission) || submission.filing.entityName,
                "sic": parseInt(submission.filing.sic, 10),
                "loc": ((submission.filing.businessAddress && submission.filing.businessAddress.country) || (submission.filing.mailingAddress && submission.filing.mailingAddress.country) || 'US') + '-' + ((submission.filing.businessAddress && submission.filing.businessAddress.state) || ( submission.filing.mailingAddress && submission.filing.mailingAddress.state) || ''),
                "start": fact.start,
                "end": fact.end,
                "val": fact.value,
                "rev": 1
            };
            let i;
            for(i=0;i<frameDataArray.length;i++) {  //frame data is ordered by cik ascending
                let point = frameDataArray[i];
                if (newPoint.cik == point.cik) {
                    if ((point.start != newPoint.start && (point.start || newPoint.start)) || point.end != newPoint.end) {
                        //TODO: THROW THE FOLLOWING ERROR ONCE DERA DATE ROUNDED DATA IS REPLACED WITH CORRECTLY PARSED DATA
                        //throw("parsed tag "+fact.tag+" has different dates then frame "+ S3key + ' existing: ('+point.start+','+point.end+'), new: ('+newPoint.start+','+newPoint.end+')');
                    }
                    if (point.value != newPoint.value) newPoint.rev = point.rev + 1;
                    if (point.value != newPoint.value || point.sic != newPoint.sic || point.entityName != newPoint.entityName || point.loc != newPoint.loc) {
                        frameDataArray.splice(i, 1, newPoint);
                        needsUpdate = true;
                    }
                    break;
                }
                if (newPoint.cik < point.cik) {
                    frameDataArray.splice(i, 0, newPoint);
                    needsUpdate = true;
                    break;
                }
            }
            if(i==frameDataArray.length){
                needsUpdate = true;
                frameDataArray.push(newPoint);
            }

            if(needsUpdate){
                let response;
                let success = await writeFrameToDB(frameRecord,1);
                if(success) {
                    if(enableS3Writes) await common.writeS3(S3key, JSON.stringify(
                        {
                            tag: frame.tag,
                            ccp: frame.ccp,
                            uom: frame.uom,
                            qtrs: frame.qtrs,
                            label: frame.label,
                            description: frame.description,
                            data: frameDataArray
                        }));
                    resolve(S3key);
                } else {
                    reject(new Error('unable to write to DB for object '+ S3key));
                }

                async function writeFrameToDB(responseFromUpdateFrameWithTStamp, depth){
                    let writeCall  = "call updateFrame("+common.q(fact.tag)+common.q(fact.uom.label)+common.q(fact.ccp)+fact.qtrs
                        +','+common.q(JSON.stringify(frameDataArray))+common.q(responseFromUpdateFrameWithTStamp.data[0][0].tstamp, true)+")";  //json = write request
                    try {
                        response = await common.runQuery(writeCall);
                        if(response.data[0][0].processed) {
                            return true;
                        } else {
                            if(depth<3){
                                console.log('retry depth='+depth+' for '+ S3key);
                                depth++;
                                return await writeFrameToDB(response, depth);  //retry up to 3 times
                            }
                            else {
                                console.log('struck out trying to process '+S3key);
                                return(false);
                            }
                        }
                    } catch(e){
                        console.log(e);
                        console.log('updateFrame error at depth: ' + depth + ' processing '+S3key);
                        return(false);
                    }
                }
            } else {
                resolve(true);
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
                        let deiFact =  {
                            value: val,
                            contextRef: this.attribs.contextRef || this.attribs.contextref
                        };
                        if (!deiFact.contextRef) common.logEvent("missing DEI contextRef for "+tag, submission.filing.adsh);
                        if(Array.isArray(submission.dei[tag]))
                            submission.dei[tag].push(deiFact);
                        else {
                            if (submission.dei[tag] && submission.dei[tag].value != deiFact.value) console.log(`${tag} value ${submission.dei[tag].value} is being overwritten with ${deiFact.value}`);
                            submission.dei[tag] = deiFact;
                        }
                    } else {
                        if(standardNumericalTaxonomies.indexOf(tax)!=-1){
                            let factInfo = extractFactInfo(submission, $, elem);
                            if(factInfo.isStandard){  //todo:  process facts with dimensions & axes (members)
                                if(!factInfo.dim && factInfo.uom) {
                                    let factKey = factInfo.tag+':'+factInfo.qtrs+':'+factInfo.uom.label+':'+factInfo.end;
                                    if(!submission.facts[factKey]){
                                        submission.facts[factKey] = factInfo;
                                    } else {
                                        let storedFact = submission.facts[factKey];
                                        if(storedFact.value != factInfo.value){
                                            let storedDecimal = parseInt(storedFact.decimals || 0, 10),
                                                factDecimal = parseInt(factInfo.decimals || 0, 10),
                                                minDecimal = Math.min(storedDecimal, factDecimal),
                                                power = Math.pow(10, minDecimal);
                                            if(Math.round(factInfo.value*power)!=Math.round(storedFact.value*power) && Math.floor(factInfo.value*power)!=Math.floor(storedFact.value*power)) {
                                                common.logEvent('ERROR: XBRL value conflict in '+submission.filing.adsh, '['+JSON.stringify(factInfo)+','
                                                    +JSON.stringify(storedFact)+']');
                                            }
                                            if(factDecimal>storedDecimal){
                                                submission.facts[factKey] = factInfo;
                                            }
                                        }
                                    }
                                    submission.hasXBRL = true;
                                    submission.counts.standardFacts++;
                                }
                            }
                        }
                    }
                }
            }
        }
    });
    //console.log(submission.dei);
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
    $deiTags.each((i, elem)=> {
        let deiTag = elem.attribs.name.split(':').pop();
        let deiFact =  {
            text: $(elem).text(),
            contextRef:  elem.attribs.contextref || elem.attribs.contextRef,
            format: elem.attribs.format,
        };
        if (!deiFact.contextRef) common.logEvent("WARNING missing DEI contextRef for "+deiTag, parsedFacts.filing.adsh);
        if(deiFact.format){
            //problematic date formats all contain the string 'daymonth': http://www.xbrl.org/inlineXBRL/transformation/
            if(deiFact.format && deiFact.format.indexOf('daymonth')!=-1) common.logEvent("WARNING unhandled data format", elem.attribs.format + ' in iXBRL of ' + parsedFacts.filing.adsh);
            deiFact.value = translateXBRLFormat(deiFact.text, deiFact.format);
        } else {
            deiFact.value = deiFact.text;
        }
        if(Array.isArray(parsedFacts.dei[deiTag])){
            parsedFacts.dei[deiTag].push(deiFact);
        } else {
            if (parsedFacts.dei[tag] && parsedFacts.dei[tag].value != deiFact.value) common.logEvent(`WARNING dei overwrite`, `${tag} value ${parsedFacts.dei[tag].value} is being overwritten with ${deiFact.value}`);
            parsedFacts.dei[deiTag] = deiFact;
        }


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
            let factInfo = extractFactInfo(parsedFacts, $, elem);
            if(factInfo.isStandard){  //todo:  process facts with dimensions & axes (members)
                if(!factInfo.dim && factInfo.uom) { //don't process footnotes either
                    let factKey = factInfo.tag+':'+factInfo.qtrs+':'+factInfo.uom.label+':'+factInfo.end;
                    if(!parsedFacts.facts[factKey]){
                        parsedFacts.facts[factKey] = factInfo;
                    } else {
                        let storedFact = parsedFacts.facts[factKey];
                        if(storedFact.value != factInfo.value){
                            //todo:  do same check using scale for iXBRL
                            let storedDecimal = parseInt(storedFact.decimals || 0, 10),
                                factDecimal = parseInt(factInfo.decimals || 0, 10),
                                minDecimal = Math.min(storedDecimal, factDecimal),
                                power = Math.pow(10, minDecimal);
                            if(Math.round(factInfo.value*power)!=Math.round(storedFact.value*power) && Math.floor(factInfo.value*power)!=Math.floor(storedFact.value*power)) {
                                common.logEvent('ERROR: XBRL value conflict in '+parsedFacts.filing.adsh, '['+JSON.stringify(factInfo)+','
                                    +JSON.stringify(storedFact)+']');
                            }
                            if(factDecimal>storedDecimal){
                                parsedFacts.facts[factKey] = factInfo;
                            }
                        }
                    }
                    parsedFacts.hasIXBRL = true;
                    parsedFacts.counts.standardFacts++;
                }
            }
            parsedFacts.counts.facts++;
        } catch (e) {
            common.logEvent('ERROR: updateXBRLAPI extracting nonfraction from iXBRL in '+ parsedFacts.filing.adsh, e, true); //log error and continue parsing
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
            dtEnd = new Date(end);
            newContext = {
                start: null,
                end: end,
                qtrs: 0,
            };
        } else {
            console.log('ERROR: parsing context '+contextID+' in XBRL doc of ' + submissionObject.filing.adsh);
        }
    }
    if(standardQuarters.indexOf(newContext.qtrs)!==-1) newContext.ccp = common.closestCalendricalPeriod(dtStart, dtEnd);
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
        factInfo = {
            uom: objParsedSubmission.unitTree[unitRef],
            taxonomy: nameParts[0],
            tag: nameParts[1],
            scale: ix.attribs.scale||'', //$ix.attr('scale'),  //iXBRL only; XBRL has scale in contextRef
            decimals: ix.attribs.decimals, //XBRL & iXBRL
            format: ix.attribs.format||'',  //only iXBRL?
            sign: ix.attribs.sign||'',  //only iXBRL?
            isStandard: standardNumericalTaxonomies.indexOf(nameParts[0])!==-1,
            text: $ix.text().trim()
        };
    factInfo.value = translateXBRLFormat(factInfo.text, factInfo.format||'standard', factInfo.scale);
    if(objParsedSubmission.contextTree[contextRef]){
        let context = objParsedSubmission.contextTree[contextRef];
        factInfo.qtrs = context.qtrs;
        factInfo.end = context.end;
        if(context.start) factInfo.start = context.start;
        if(context.scale) factInfo.scale = context.scale;
        if(context.member) factInfo.member = context.member;
        if(context.dim) factInfo.dim = context.dim;
        if(context.ccp) factInfo.ccp = context.ccp;
    } else {
        throw('missing contextRef for ' + factInfo.tag);
    }
    return factInfo;
}
function translateXBRLFormat(text, format, scale = 0){
    switch(format){
        case "ixt:zerodash":
            if(text=='—') return 0;  //falls through to numdotdecimal
        case "ixt:numdotdecimal":
        case 'standard':
            return parseFloat(text.replace(/,/g, ''))*10**(scale||0);
        case "ixt:numcommadecimal":
            return parseFloat(text.replace(/\./g, '').replace(/,/,'.'))*10**(scale||0);
        case "ixt:datemonthdayyear":
            let localDate = new Date(text);
            return localDate.getFullYear()+'-'+(localDate.getMonth()+1)+'-'+localDate.getDate();
        case "ixt:booleanfalse":
            return text;  //MySQL can translate "TRUE" and "FALSE"
        case "ixt-sec:numtexten":
        //todo:  adapt regex to convert english to numbers
        default:
            throw('unrecognized numerical format '+ format+ ' for '+text);
    }
}

async function saveXBRLSubmission(s){
    //console.log(JSON.stringify(s)); //debug only!!!
    //save main submission record into fin_sub
    function q(val){return common.q(val,true)}
    let cik = deiValue('EntityCentralIndexKey',s),
        aciks = [];
    for(let i=0;i<s.dei.EntityCentralIndexKey.length; i++){
        if(s.dei.EntityCentralIndexKey[i].value!=cik) aciks.push(s.dei.EntityCentralIndexKey[i].value)
    }
    let startProcess = new Date(),
        sql = `update fin_sub 
            set cik=${cik}, name=${q(deiValue('EntityRegistrantName',s))}, 
                sic=${s.filing.sic||0}, fye=${q(deiValue('CurrentFiscalYearEndDate',s).replace(/-/g,'').substr(-4,4))}, 
                form=${q(deiValue('DocumentType',s))}, period=${q(deiValue('DocumentPeriodEndDate',s))}, fy=${q(deiValue('DocumentFiscalYearFocus',s))}, 
                fp=${q(deiValue('DocumentFiscalPeriodFocus',s))}, filed=${q(s.filing.filingDate)}, countryba=${q(s.filing.businessAddress&&s.filing.businessAddress.country)}, 
                stprba=${q(s.filing.businessAddress&&s.filing.businessAddress.state)}, cityba=${q(s.filing.businessAddress&&s.filing.businessAddress.city)}, 
                zipba=${q(s.filing.businessAddress&&s.filing.businessAddress.zip)}, bas1=${q(s.filing.businessAddress&&s.filing.businessAddress.street1)}, 
                bas2=${q(s.filing.businessAddress&&s.filing.businessAddress.street2)}, baph=${q(s.filing.businessAddress&&s.filing.businessAddress.phone)}, 
                countryma=${q(s.filing.mailingAddress&&s.filing.mailingAddress.country)}, stprma=${q(s.filing.mailingAddress&&s.filing.mailingAddress.state)}, 
                cityma=${q(s.filing.mailingAddress&&s.filing.mailingAddress.city)}, zipma=${q(s.filing.mailingAddress&&s.filing.mailingAddress.zip)}, 
                mas1=${q(s.filing.mailingAddress&&s.filing.mailingAddress.street1)}, mas2=${q(s.filing.mailingAddress&&s.filing.mailingAddress.street2)}, 
                countryinc=${q(s.filing.incorporation?s.filing.incorporation.country:null)}, stprinc=${q(s.filing.incorporation?s.filing.incorporation.state:null)}, 
                ein=${q(s.filing.ein)}, former='former', changed='changed', filercategory=${q(deiValue('EntityFilerCategory',s))}, 
                accepted=${q(s.filing.acceptanceDateTime)}, prevrpt=null, detail=null, htmlfile=${ q(s.primaryHTML)}, instance=${q(s.hasIXBRL||s.hasXBRL)}, nciks=${s.dei.EntityCentralIndexKey.length}, aciks=${q(aciks.join(' '))}
            where adsh='${s.filing.adsh}'`;
    await common.runQuery(sql);

    //save numerical fact records into fin_num
    console.log('saving facts...');
    let i=0, fact, numSQL, version, coreg;
    const numInsertHeader = 'REPLACE into fin_num (adsh, tag, version, coreg, startdate, enddate, qtrs, ccp, uom, value) values ';
    numSQL = numInsertHeader;
    for(let factKey in s.facts){
        //console.log(JSON.stringify(fact));  //todo: DEBUG ONLY!!
        fact = s.facts[factKey]; //fact object properties: tag, ns, unitRef, contextRef, decimals & val
        if(fact.uom){
            if (fact.member) {
                coreg = fact.member.split(':').pop();
                if (coreg.length > 5 && coreg.substr(-5, 5) == 'Member') coreg = coreg.substr(0, coreg.length - 5);  //hack to match DERA dataset
            } else coreg = '';
            version = (standardNumericalTaxonomies.indexOf(fact.taxonomy) == -1) ? s.filing.adsh : fact.taxonomy;
            if(version!=s.adsh && coreg=='' && fact.unit) fact.isStandard = true;
            //multi-row inserts are faster
            numSQL += (i%1000==0?'':', ')
                + `(${q(s.filing.adsh)}, ${q(fact.tag)}, ${q(version)}, '', ${q(fact.start)}, ${q(fact.end)}, ${fact.qtrs}, ${q(fact.ccp)}, ${q(fact.uom.label)}, ${fact.value})`;
            i++;
            if(i%1000==0){ //but don't let the query get too long.... default max packet size 2MB  <-  INCREASE TO 160 MB!!!!
                await common.runQuery(numSQL);
                numSQL = numInsertHeader;
            }
        }else {
            console.log('WARNING: no units for tag '+fact.tag); //lots of footnotes and some date tags
        }
    }
    if(i%1000!=0) await common.runQuery(numSQL);  // execute multi-row insert
    let endProcess = new Date();
    console.log('saveXBRLSubmission wrote ' + i + ' facts from '+s.dei.EntityRegistrantName.value+' ' + s.filing.form + ' for ' + s.filing.period + ' ('+ s.filing.adsh +') in ' + (endProcess-startProcess) + ' ms');
}
function deiValue(tag, submission){
    if(!submission.dei[tag]) return null;
    if(Array.isArray(submission.dei[tag])){
        if(submission.dei[tag].length==1)
            return submission.dei[tag][0].value;
        for(let i=0;i<submission.dei[tag].length;i++){
            if(!submission.contextTree[submission.dei[tag][i].contextRef].member)
                return submission.dei[tag][i].value;
        }
        common.logEvent('ERROR undetermined value for '+tag, submission.filing.path+submission.filing.adsh);
        return null;  //hack to avoid errors while running quarterly ingest
    } else {
        return submission.dei[tag].value;
    }
}
function runGarbageCollection(){
    if (global.gc) {
        console.log(process.memoryUsage());
        console.log('collecting garbage');
        global.gc();
        console.log(process.memoryUsage());
    } else console.log('global.gc not set');
}

/*//////////////////// TEST CARDS  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
// TEST Card A: iXBRL 10Q:  https://www.sec.gov/Archives/edgar/data/29905/000002990519000029/0000029905-19-000029-index.htm
const event = 	{
    "path": "sec/edgar/data/29905/000002990519000029\",
    "adsh": "0000029905-19-000029",
    "cik": "0000029905",
    "fileNum": "001-04018",
    "form": "10-Q",
    "filingDate": "20190418",
    "period": "20190331",
    "acceptanceDateTime": "20190418072005",
    "indexHeaderFileName": "sec/edgar/data/29905/000002990519000029/0000029905-19-000029-index-headers.html",
    "files": [
        {
            "name": "dov-20190331.htm",
            "description": "10-Q",
            "type": "10-Q"
        },
        {
            "name": "a2019033110-qex101.htm",
            "description": "EX - 10.1",
            "type": "EX-10.1"
        },
        {
            "name": "a2019033110-qexhibit102.htm",
            "description": "EX - 10.2",
            "type": "EX-10.2"
        },
        {
            "name": "a2019033110-qexhibit103.htm",
            "description": "EX - 10.3",
            "type": "EX-10.3"
        },
        {
            "name": "a2019033110-qex104.htm",
            "description": "EX - 10.4",
            "type": "EX-10.4"
        },
        {
            "name": "a2019033110-qexhibit311.htm",
            "description": "EX - 31.1",
            "type": "EX-31.1"
        },
        {
            "name": "a2019033110-qexhibit312.htm",
            "description": "EX - 31.2",
            "type": "EX-31.2"
        },
        {
            "name": "a2019033110-qexhibit32.htm",
            "description": "EX - 32",
            "type": "EX-32"
        },
        {
            "name": "dov-20190331.xsd",
            "description": "XBRL TAXONOMY EXTENSION SCHEMA DOCUMENT",
            "type": "EX-101.SCH"
        },
        {
            "name": "dov-20190331_cal.xml",
            "description": "XBRL TAXONOMY EXTENSION CALCULATION LINKBASE DOCUMENT",
            "type": "EX-101.CAL"
        },
        {
            "name": "dov-20190331_def.xml",
            "description": "XBRL TAXONOMY EXTENSION DEFINITION LINKBASE DOCUMENT",
            "type": "EX-101.DEF"
        },
        {
            "name": "dov-20190331_lab.xml",
            "description": "XBRL TAXONOMY EXTENSION LABEL LINKBASE DOCUMENT",
            "type": "EX-101.LAB"
        },
        {
            "name": "dov-20190331_pre.xml",
            "description": "XBRL TAXONOMY EXTENSION PRESENTATION LINKBASE DOCUMENT",
            "type": "EX-101.PRE"
        },
        {
            "name": "dov-20190331_g1.jpg",
            "type": "GRAPHIC"
        },
        {
            "name": "image1.jpg",
            "type": "GRAPHIC"
        },
        {
            "name": "image2.jpg",
            "type": "GRAPHIC"
        },
        {
            "name": "image3.jpg",
            "type": "GRAPHIC"
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
    "Records": [
        {"body": "{\"path\":\"sec/edgar/data/1000180/000100018016000068/\",\"adsh\":\"0001000180-16-000068\",\"cik\":\"0001000180\",\"fileNum\":\"000-26734\",\"form\":\"10-K\",\"filingDate\":\"20160212\",\"period\":\"20160103\",\"acceptanceDateTime\":\"20160212170356\",\"indexHeaderFileName\":\"sec/edgar/data/1000180/000100018016000068/0001000180-16-000068-index-headers.html\",\"files\":[{\"name\":\"sndk201510-k.htm\",\"description\":\"FORM 10-K FY15\",\"type\":\"10-K\"},{\"name\":\"sndkex-1037xnewy2facilitya.htm\",\"description\":\"NEW Y2 FACILITY AGREEMENT\",\"type\":\"EX-10.37\"},{\"name\":\"sndkex-121xratioofearnings.htm\",\"description\":\"COMPUTATION OF RATIO TO FIXED CHARGES\",\"type\":\"EX-12.1\"},{\"name\":\"sndkex-211xsignificantsubs.htm\",\"description\":\"SUBSIDIARIES OF THE REGISTRANT\",\"type\":\"EX-21.1\"},{\"name\":\"sndkex-231xconsentofindepe.htm\",\"description\":\"CONSENT OF INDEPENDENT REGISTERED PUBLIC ACCOUNTING FIRM\",\"type\":\"EX-23.1\"},{\"name\":\"sndkex-311xsoxceocertfy15.htm\",\"description\":\"CEO CERTIFICATION TO SECTION 302\",\"type\":\"EX-31.1\"},{\"name\":\"sndkex-312xsoxcfocertfy15.htm\",\"description\":\"CFO CERTIFICATION TO SECTION 302\",\"type\":\"EX-31.2\"},{\"name\":\"sndkex-321xsec906ceocertfy.htm\",\"description\":\"CEO CERTIFICATION TO SECTION 906\",\"type\":\"EX-32.1\"},{\"name\":\"sndkex-322xsec906cfocertfy.htm\",\"description\":\"CFO CERTIFICATION TO SECTION 906\",\"type\":\"EX-32.2\"},{\"name\":\"sndk-20160103.xml\",\"description\":\"XBRL INSTANCE DOCUMENT\",\"type\":\"EX-101.INS\"},{\"name\":\"sndk-20160103.xsd\",\"description\":\"XBRL TAXONOMY EXTENSION SCHEMA DOCUMENT\",\"type\":\"EX-101.SCH\"},{\"name\":\"sndk-20160103_cal.xml\",\"description\":\"XBRL TAXONOMY EXTENSION CALCULATION LINKBASE DOCUMENT\",\"type\":\"EX-101.CAL\"},{\"name\":\"sndk-20160103_def.xml\",\"description\":\"XBRL TAXONOMY EXTENSION DEFINITION LINKBASE DOCUMENT\",\"type\":\"EX-101.DEF\"},{\"name\":\"sndk-20160103_lab.xml\",\"description\":\"XBRL TAXONOMY EXTENSION LABEL LINKBASE DOCUMENT\",\"type\":\"EX-101.LAB\"},{\"name\":\"sndk-20160103_pre.xml\",\"description\":\"XBRL TAXONOMY EXTENSION PRESENTATION LINKBASE DOCUMENT\",\"type\":\"EX-101.PRE\"},{\"name\":\"performancegraph2015.jpg\",\"type\":\"GRAPHIC\"},{\"name\":\"sndk.jpg\",\"type\":\"GRAPHIC\"}],\"bucket\":\"restapi.publicdata.guru\",\"sic\":\"3572\",\"ein\":\"770191793\",\"incorporation\":{\"state\":\"DE\",\"country\":false},\"businessAddress\":{\"street1\":\"951 SANDISK DRIVE\",\"street2\":false,\"city\":\"MILPITAS\",\"state\":\"CA\",\"zip\":\"95035\",\"phone\":\"408-801-1000\"},\"mailingAddress\":{\"street1\":\"951 SANDISK DRIVE\",\"street2\":false,\"city\":\"MILPITAS\",\"state\":\"CA\",\"zip\":\"95035\",\"phone\":false}}"
        }
    ]
}
*/