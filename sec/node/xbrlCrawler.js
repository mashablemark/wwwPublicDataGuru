//npm install request cheerio
//node crawler.js

    var request = require('request');
    var util = require('util');
    var cheerio = require('cheerio');
    var mysql = require('mysql');

var con,  //global db connection
    secDomain = 'https://www.sec.gov',
    idxYear = 2016,
    idxQuarter = 1,
    idxXBRL = secDomain + '/Archives/edgar/full-index/'+idxYear+'/QTR'+idxQuarter+'/xbrl.idx',
    rgexMarkers = {
        beginHTML: /<HEAD>/i,
        endHTML: /<\/HTML>/i,
        iXBRL: /<ix:nonnumeric/i,
        beginXBRL: /<XBRL>/i,
        endXBRL: /<\/XBRL>/i
    };

var skipNameSpaces = ['dei','xbrli'];  //already scrapped in parts 1. of this routine, but for "deiNumTags" exceptions
var standardNumericalTaxonomies = ['us-gaap', 'ifrs', 'invest', 'dei', 'srt'];
var deiNumTags = ['EntityCommonStockSharesOutstanding', 'EntityListingParValuePerShare',
    'EntityNumberOfEmployees' ,'EntityPublicFloat'];  //dei tags scraped by DERA (but not other such as period, fy...
var downloadedGB = 0;

//duplicate ADSH:  CIK|Company Name|Form Type|Date Filed|Filename
// 1002910|AMEREN CORP|10-K|2016-02-26|edgar/data/1002910/0001002910-16-000205.txt
// 100826|UNION ELECTRIC CO|10-K|2016-02-26|edgar/data/100826/0001002910-16-000205.txt
// 18654|Ameren Illinois Co|10-K|2016-02-26|edgar/data/18654/0001002910-16-000205.txt

startCrawl();

function startCrawl(){
    con = mysql.createConnection({ //global db connection
        host: "localhost",
        user: "secdata",
        password: "Mx)vfHt{_k^p",
        database: 'secdata'
    });

    con.connect(function(err) {
        if (err) throw err;
        processQuarterlyXbrlIndex(idxXBRL);  //entry point to program
    });
}

function scrapXBRL(year, quarter){
  //entry point for full scrape
}

function processQuarterlyXbrlIndex(idxUrl, callback){
    request(idxUrl, function (error, response, indexBody) {
        //starting on line the 11th line: CIK|Company Name|Form Type|Date Filed|Filename
        downloadedGB += indexBody.length / (1024*1024*1024);
        var lines = indexBody.split('\n');
        delete indexBody;
        console.log('start processing ' + idxUrl);
        var i=10;  //start
        nextSubmission();

        function nextSubmission(){
            console.log('processing file '+i+' of '+(lines.length-10)+ " (cumulative download: " + downloadedGB + " GB)");
            var fields = lines[i].split('|');
            if(fields.length==5){  //final line possible with no data (just a final carriage return)
                var file = fields[4].split('/')[3];
                var submission = {
                    cik: fields[0],
                    coname: fields[1],
                    form: fields[2],
                    filed: fields[3],
                    urlTextFile: 'https://www.sec.gov/Archives/' + fields[4],
                    urlIndexFile: 'https://www.sec.gov/Archives/' + fields[4].replace('.txt','-index.html'),
                    adsh: file.substring(0, file.length-4),
                    facts: []
                };
                adshInDB(submission.adsh, function(inDb){
                    if(inDb){
                        logError('duplicate ADSH', lines[i]);
                        finishedParse(true)
                    } else {
                        console.log('getting file: ' + submission.urlTextFile+ ' for ' + submission.coname);
                        getFilingsIndexPage(submission, finishedParse);
                    }
                });
            } else {
                finishedParse(true);
            }
            function finishedParse(success){
                if(success && i++<lines.length){
                    nextSubmission();
                } else {
                    if(callback) callback(i--); //else process.exit();
                }
            }
        }
    });
}

function getFilingsIndexPage(submission, callback){
    request(submission.urlIndexFile, function (error, response, indexBody) {
        if(error){
            logError('index page request error', submission.urlIndexFile, true);
            callback(true);
        } else {
            downloadedGB += indexBody.length / (1024*1024*1024);
            var $index = cheerio.load(indexBody),
                $infoHead = $index('div.formGrouping div.infoHead'),
                $info = $index('div.formGrouping div.info'),
                $ixbrlTag = $index("table.tableFile a[href^='/ix?doc']");
            delete indexBody;
            if($infoHead.length>=2 && $info.length>=2){
                if($infoHead.contents().eq(1).text()=='Accepted') submission.accepted=$info.contents().eq(1).text()
                else logError('unable to find Accepted date on index page',  submission.urlIndexFile);
                if($infoHead.contents().eq(0).text()=='Filing Date') submission.filed=$info.contents().eq(0).text()
                else logError('unable to find Filing Date on index page', submission.urlIndexFile);
            }
            if($ixbrlTag.length){
                submission.urliXBRL = secDomain + $ixbrlTag.attr('href').split('=')[1];
                delete $index;
                submission.urliXBRL = indexBody.substr(ixPos + sIxSig.length, indexBody.indexOf('.htm', ixPos) - ixPos - sIxSig.length);
                request(submission.urliXBRL, function (error, response, iXBRL) {
                    downloadedGB += iXBRL.length / (1024*1024*1024);
                    parseIXBRL(cheerio.load(iXBRL), submission);
                    console.log('XBRL file size ' + Math.round(iXBRL.length/1000) + 'KB; heap used: ' + Math.round(process.memoryUsage().heapUsed / 1000000) +'MB');
                    callback(true);
                });
            } else {
                var $tdTitle = $index("td:contains('XBRL INSTANCE DOCUMENT'), td:contains('EX-101.INS')");
                if($tdTitle.length){
                    submission.urlXBRL = secDomain + $tdTitle.parent().find('a').attr('href');
                    submission.instance = submission.urlXBRL.split('/').pop();
                    console.log(submission.urlXBRL);
                    request(submission.urlXBRL, function (error, response, XBRL) {
                        downloadedGB += XBRL.length / (1024*1024*1024);
                        //console.log('Fetched! heap used: ' + Math.round(process.memoryUsage().heapUsed / 1000000) +'MB');
                        if(parseXBRL(cheerio.load(XBRL, {xmlMode: true}), submission)){
                            saveSubmission(submission);
                            console.log('cheerio! heap used: ' + Math.round(process.memoryUsage().heapUsed / 1000000) +'MB');
                            callback(true);
                        } else {
                            logError('document parse failed', submission.urlXBRL);
                            callback(true);
                        }
                    });
                } else {
                    logError('No XBRL found', submission.form + ' (' + submission.adsh +')');
                    delete $index;
                    callback(true);
                }
            }
        }
    });
}



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

function logError(type, msg, display){
    runQuery("insert into eventlog (event, data) values ("+q(type)+","+q(msg)+")");
    if(display) console.log(type, msg);
}
function adshInDB(adsh, callback){
    runQuery("select adsh from fin_sub where adsh="+q(adsh), function(result, fields){
        callback(result.length>0);
    });
}
function saveSubmission(s){
    //save main submission record into fin_sub
    var sql = 'INSERT INTO fin_sub(adsh, cik, name, sic, fye, form, period, fy, fp, filed'
    + ', countryba, stprba, cityba, zipba, bas1, bas2, '
    + ' baph, countryma, stprma, cityma, zipma, mas1, mas2, countryinc, stprinc, ein, former, changed, afs, wksi, '
    +' accepted, prevrpt, detail, instance, nciks, aciks '
    + " ) VALUES ('"+s.adsh+"',"+s.cik+","+q(s.coname)+",'"+(s.sic||0)+"','"+s.fye.replace(/-/g,'').substr(-4,4)+"',"+q(s.form)+",'"+s.period+"','"
        +s.fy+"','"+s.fp+"','"+s.filed+"','cb', 'sb', 'cityba', 'zipba', 'bas1', 'bas2', "
    + "'baph', 'cm', 'sm', 'cityma', 'zipma', 'mas1', 'mas2', 'ci', 'si', 99, 'former', 'changed', "
    + "'afs', 3, '"+ s.accepted.substr(0,10) +"', 4, 5, "+q(s.instance)+", 12342,"+q(s.aciks)+")";
    runQuery(sql);

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
            runQuery(numSQL);
        } else {
            logError('context not found', s.urlIndexFile + ': ' + JSON.stringify(fact));  //must have a context ref to save
        }
    }
    console.log('wrote ' + i + ' facts for '+s.coname+' ' + s.form + ' for ' + s.fy + s.fp + ' ('+ s.adsh +')');
}
function q(value){
    return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}
function runQuery(sql, callback){
    try{
        con.query(sql, function(err, result, fields) {
            if(err){
                console.log(sql);
                logError('bad query', sql);
                throw err;
            }
            if(callback) callback(result, fields);
        });
    } catch(err) {
        console.log(sql);
        logError("fatal MySQL error", sql);
        throw err;
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