// updateFormDAPI.js runs as a AWS Lambda function (note: configured to run up to 20 of these functions concurrently)
// input:  adsh and url (S3 key) to new primary XML submission of a Form D & D/A = Notice of Exempt Offering of Securities
// actions:
//   1. determine whether the exempt offering object for this period of is in global memory; if not start read
//   2. read the XMl and parse using cheerio into the in memory submission data structure
//   3. write parsed data structure to the mySQL tables:
//     a) exemptOffering
//     b) exemptOfferingPersons
//   4. update the ExemptOfferings REST API object in global memory
//   5. collect promise is step 3b and call addExemptOfferingPersons(adsh) to update the persons table (for people search)
//   6. write to  S3: restdata.publicdata.guru/sec/offerings/exempt/exemptOfferingSummaryYYYYQX.json
//   7. collect promises from steps 3a, 5 and 6 then exit (without closing con to allow reuse)

// to compile:  zip -r updateFormDAPI.zip updateFormDAPI.js node_modules/mysql2 node_modules/htmlparser2 node_modules/entities node_modules/cheerio node_modules/inherits node_modules/domhandler node_modules/domelementtype node_modules/parse5 node_modules/dom-serializer node_modules/css-select node_modules/domutils node_modules/nth-check node_modules/boolbase node_modules/css-what node_modules/sqlstring node_modules/denque node_modules/lru-cache node_modules/pseudomap node_modules/yallist node_modules/long node_modules/iconv-lite node_modules/safer-buffer node_modules/generate-function node_modules/is-property secure.js
// execution time = 1.6s (parse at 600ms, but processing and writing exemptOfferingSummary JSON file = 5.7MB per quarter takes 3.2s by end of Q (USE 256MB CONTAINER!)
// Form D submissions per year = 48,000
// Lambda execution costs for updateFormDAPI per year = $0.000000417*16 billing increment of 100ms *48,000 = $0.32 (!)

//GLOBAL SCOPE = SHARED BETWEEN LAMBDA CALLS!
const cheerio = require('cheerio');
const mysql2 = require('mysql2/promise');
const AWS = require('aws-sdk');
const secure = require('./secure');  //must not be committed

var con = false;  //global db connection reused as long as container is reused;
//WARNING:  this approach of treating the API object as a datastore to be updated requires reservice concurrency = 1 (singleton)
var exemptOfferingAPIObject = false; //global object eliminates need to reread and parse object when container is reused;
const s3 = new AWS.S3();
const bucket = "restapi.publicdata.guru";

exports.handler = async (formDevent, context) => {
    console.log(JSON.stringify(formDevent));
    if(!con) con = await createDbConnection(); //global db connection reused as long as container is reused;
    let exemptOfferingsForms= {
        'D': 'xml',
        'D/A': 'xml'
    };
    for (let i = 0; i < formDevent.files.length; i++) {
        if (exemptOfferingsForms[formDevent.files[i].type] && formDevent.files[i].name.indexOf('/')===-1) {
            formDevent.primaryDocumentName = formDevent.files[i].name.substr(0, 4) == "sec/" ? formDevent.files[i].name.substr(4) : formDevent.files[i].name;
            formDevent.xmlBody = await readS3(formDevent.path + formDevent.primaryDocumentName);
            break;
        }
    }

    if (formDevent.xmlBody) {
        let submission = {
            filing: formDevent,
        };
        await processFormDSubmission(submission, true);
    } else {
        await logEvent('Form D read error', JSON.stringify(formDevent), true);
    }
    console.log('end of lambda event handler!');
};

async function processFormDSubmission(submission, remainsChecking){
    //1. determine whether the exempt offering object for this period of is in global memory; if not start read(completed in step 5)
    const acceptanceDateTime = submission.filing.acceptanceDateTime;
    const acceptanceDate = new Date(acceptanceDateTime.substr(0,4) + "-" + acceptanceDateTime.substr(4,2) + "-" + acceptanceDateTime.substr(6,2) + ' ' + acceptanceDateTime.substr(8,2)+':'+acceptanceDateTime.substr(10,2)+':'+acceptanceDateTime.substr(12,2));
    //submissions accepted after 5:30PM are disseminated the next day
    acceptanceDate.setHours(acceptanceDate.getHours()+6);
    acceptanceDate.setMinutes(acceptanceDate.getMinutes()+30);
    const acceptanceYYYYQq = acceptanceDate.getFullYear() + "Q" + (Math.floor(acceptanceDate.getMonth()/3)+1);
    const fileKey = "sec/offerings/exempt/exemptOfferingsSummary"+ acceptanceYYYYQq + "Q"+  + ".json";

    let exemptOfferingAPIPromise;
    if(exemptOfferingAPIObject && exemptOfferingAPIObject.exemptOfferings){
        exemptOfferingAPIPromise = false;
    } else {
        exemptOfferingAPIPromise = new Promise((resolve, reject) => {
            s3.getObject({
                Bucket: "restapi.publicdata.guru",
                Key: fileKey
            }, (err, data) => {
                if (err) {
                    // not found = return new empty archive for today
                    console.log('creating ' + fileKey);
                    resolve({
                        "title": "EDGAR summary of Offerings of Exempt Securities",
                        "period": acceptanceYYYYQq,
                        "path": fileKey,
                        "format": "JSON",
                        "exemptOfferings": []
                    });
                } else {
                    resolve(JSON.parse(data.Body.toString('utf-8')));   // successful response  (alt method = createReadStream)
                }
            });
        });
        console.log('reading ' + fileKey);
    }

    const $xml = cheerio.load(submission.filing.xmlBody, {xmlMode: true});
    if($xml('primaryIssuer cik').length!=1)
        throw 'primaryIssuer cik error in ' + submission.filing.fileName;

    function get($xmlSection, path){ return readAndRemoveTag($xmlSection, path, remainsChecking)}
    function getAddress($xmlSection){
        return {
            street1: get($xmlSection, 'street1'),
            street2: get($xmlSection, 'street2'),
            city: get($xmlSection, 'city'),
            stateOrCountry: get($xmlSection, 'stateOrCountry'),
            stateOrCountryDescription: get($xmlSection, 'stateOrCountryDescription'),
            zipCode: get($xmlSection, 'zipCode')
        };
    }


    submission.filing.fileSize = submission.filing.xmlBody.length;
    submission.schemaVersion = get($xml, 'schemaVersion');
    submission.submissionType = get($xml, 'submissionType');
    submission.testOrLive = get($xml, 'testOrLive');
    if(submission.testOrLive != 'LIVE') logEvent('ERROR updateFormDAPI','testOrLive='+submission.testOrLive,true);

    function getIssuer($){
        let issuer = {
            cik: get($, 'cik'),
            entityName: get($, 'entityName'),
            address: getAddress($.find('issuerAddress')),
            phoneNumber: get($, 'issuerPhoneNumber'),
            jurisdictionOfInc: get($, 'jurisdictionOfInc'),
            previousIssuerNames: get($, 'issuerPreviousNameList previousName') || get($, 'issuerPreviousNameList value'),
            previousEdgarNames: get($, 'edgarPreviousNameList previousName') || get($, 'edgarPreviousNameList value'),
            entityType: get($, 'entityType'),
            yearOfInc: get($, 'yearOfInc value')  || get($, 'yearOfInc yetToBeFormed')?'not formed yet':'',
            withinFiveYears: get($, 'yearOfInc withinFiveYears'),  //not in db
            overFiveYears: get($, 'yearOfInc overFiveYears')  //not in db
        };
        if(issuer.entityType=='Other') issuer.entityType = get($, 'entityTypeOtherDesc');
        return issuer;
    }
    submission.issuers = [];
    submission.issuers.push(getIssuer($xml('primaryIssuer')));
    $xml('issuerList issuer').each(function (i, elem) {  //fairly rare:  247 occurrences in 12,000 submissions
        submission.issuers.push(getIssuer($xml(elem)));
    });

    submission.relatedPersons = [];
    $xml('relatedPersonsList relatedPersonInfo').each(function (i, elem) {
        let p,
            $person =  $xml(elem),
            person = {
                firstName: get($person, 'relatedPersonName firstName'),
                lastName: get($person, 'relatedPersonName lastName'),
                middleName: get($person, 'relatedPersonName middleName'),
                address: getAddress($person),
                relationships: get($person, 'relatedPersonRelationshipList relationship'),
                relationshipClarification: get($person, 'relationshipClarification') //not in db
            };
        //dedup as sometimes a person is entered twice (with matching address and title)
        for(p=0;p<submission.relatedPersons.length;p++){
            if(JSON.stringify(submission.relatedPersons[p])==JSON.stringify(person)) break;
        }
        if(p==submission.relatedPersons.length) submission.relatedPersons.push(person);
    });
    submission.industryGroupType = get($xml, 'offeringData industryGroup industryGroupType');
    submission.investmentFundType = get($xml, 'offeringData industryGroup investmentFundInfo investmentFundType');
    submission.is40Act = get($xml, 'offeringData industryGroup investmentFundInfo is40Act');
    submission.revenueRange = get($xml, 'offeringData issuerSize revenueRange');
    submission.aggregateNetAssetValueRange = get($xml, 'offeringData issuerSize aggregateNetAssetValueRange');
    submission.federalExemptionsExclusions  = get($xml, 'offeringData federalExemptionsExclusions item');
    submission.isAmendment = get($xml, 'offeringData typeOfFiling newOrAmendment isAmendment');
    submission.previousAccessionNumber = get($xml, 'offeringData typeOfFiling newOrAmendment previousAccessionNumber');
    submission.dateOfFirstSale = get($xml, 'offeringData typeOfFiling dateOfFirstSale value');
    get($xml, 'offeringData typeOfFiling dateOfFirstSale yetToOccur');  //not saved: dateOfFirstSale will be null instead
    submission.durationMoreThenOneYear = get($xml, 'offeringData durationOfOffering moreThanOneYear');

    let type = [];
    if(get($xml, 'offeringData typesOfSecuritiesOffered isEquityType')) type.push('Equity');
    if(get($xml, 'offeringData typesOfSecuritiesOffered isDebtType')) type.push('Debt');
    if(get($xml, 'offeringData typesOfSecuritiesOffered isOptionToAcquireType')) type.push('Option, Warrant or Other Right to Acquire Another Security');
    if(get($xml, 'offeringData typesOfSecuritiesOffered isSecurityToBeAcquiredType')) type.push('Security to be Acquired Upon Exercise of Option, Warrant or Other Right to Acquire Security');
    if(get($xml, 'offeringData typesOfSecuritiesOffered isPooledInvestmentFundType')) type.push('Pooled Investment Fund Interests');
    if(get($xml, 'offeringData typesOfSecuritiesOffered isTenantInCommonType')) type.push('Tenant-in-Common Securities');
    if(get($xml, 'offeringData typesOfSecuritiesOffered isMineralPropertyType')) type.push('Mineral Property Securities');
    if(get($xml, 'offeringData typesOfSecuritiesOffered isOtherType')) type.push(get($xml, 'offeringData typesOfSecuritiesOffered descriptionOfOtherType'));
    submission.typesOfSecuritiesOffered = type.join('; ');

    submission.isBusinessCombinationTransaction = get($xml, 'offeringData businessCombinationTransaction isBusinessCombinationTransaction');
    submission.businessCombinationTransactionClarification = get($xml, 'offeringData businessCombinationTransaction clarificationOfResponse');
    submission.minimumInvestmentAccepted = get($xml, 'offeringData minimumInvestmentAccepted');
    let salesCompensationList = [];
    $xml('offeringData salesCompensationList recipient').each(function (i, elem) {
        let $recipient =  $xml(elem);
        let recipientName = get($recipient, 'recipientName');
        //let recipientCRDNumber = get($recipient, 'recipientCRDNumber');
        let associatedBDName = get($recipient, 'associatedBDName');
        //let associatedBDCRDNumber = get($recipient, 'associatedBDCRDNumber');
        if(recipientName) salesCompensationList.push(recipientName + (associatedBDName && associatedBDName!='None'?' of '+associatedBDName:''));
    });
    get($xml, 'offeringData salesCompensationList'); //clear out remaining
    submission.salesCompensationList = salesCompensationList.join('\n'); //newline char
    submission.totalOfferingAmount = get($xml, 'offeringData offeringSalesAmounts totalOfferingAmount');
    submission.totalAmountSold = get($xml, 'offeringData offeringSalesAmounts totalAmountSold');
    submission.totalRemaining = get($xml, 'offeringData offeringSalesAmounts totalRemaining');
    submission.salesAmountsClarification = get($xml, 'offeringData offeringSalesAmounts clarificationOfResponse');
    submission.hasNonAccreditedInvestors = get($xml, 'offeringData investors hasNonAccreditedInvestors');
    submission.numberNonAccreditedInvestors = get($xml, 'offeringData investors numberNonAccreditedInvestors'); //not saved in db!
    submission.numberAlreadyInvested = get($xml, 'offeringData investors totalNumberAlreadyInvested');
    submission.salesCommissions = get($xml, 'offeringData salesCommissionsFindersFees salesCommissions dollarAmount');
    submission.isSalesCommissionsAnEstimate = get($xml, 'offeringData salesCommissionsFindersFees salesCommissions isEstimate');  //not saved in db!
    submission.findersFees = get($xml, 'offeringData salesCommissionsFindersFees findersFees dollarAmount');
    submission.isFindersFeesAnEstimate = get($xml, 'offeringData salesCommissionsFindersFees findersFees isEstimate'); //not saved in db!
    submission.commissionsAndFeesClarification = get($xml, 'offeringData salesCommissionsFindersFees clarificationOfResponse');
    submission.grossProceedsUsed = get($xml, 'offeringData useOfProceeds grossProceedsUsed dollarAmount');
    submission.isGrossProceedsUsedAnEstimate = get($xml, 'offeringData useOfProceeds grossProceedsUsed isEstimate'); //not saved in db!
    submission.grossProceedsUsedClarification= get($xml, 'offeringData useOfProceeds clarificationOfResponse');
    submission.authorizedRepresentativeSignature = get($xml, 'offeringData signatureBlock authorizedRepresentative');
    submission.signature = get($xml, 'offeringData signatureBlock signature');

    if(remainsChecking){
        let remains = $xml.text().trim();
        if(remains.length>0) {
            await logEvent('WARNING updateFormDAPI unparsed remains', submission.filing.adsh + ': '+ $xml.html(), true);
        } else {
            console.log('no unparsed remains');
        }
    }

    //update and write out RESTful API as annual API file (~24,000 rows * 4k = 80MB)
    const dbSavePromise =  saveFormDSubmission(submission);
    //await runQuery("call updateFormDAPI('"+submission.filing.adsh+"');");
    const exemptOfferingSummary = {
        adsh: submission.filing.adsh,
        accepted: submission.filing.acceptanceDateTime,
        offering: submission.totalOfferingAmount,
        sold: submission.totalAmountSold,
        remaining: submission.totalRemaining,
        revenue: submission.revenueRange,
        assetValue: submission.aggregateNetAssetValueRange,
        minInvestment: submission.minimumInvestmentAccepted,
        investorCount: submission.numberAlreadyInvested,
        isAmendment: submission.isAmendment,
        previousAccessionNumber: submission.previousAccessionNumber,
        federalExemptionsExclusions: submission.federalExemptionsExclusions,
        dateOfFirstSale: submission.dateOfFirstSale,
        issuers: [],
        persons: []
    };
    for(let i=0;i<submission.issuers.length;i++){
        let issuer  = submission.issuers[i];
        exemptOfferingSummary.issuers.push({
            cik: issuer.cik,
            name: issuer.entityName,
            stateOrCountry: issuer.address.stateOrCountryDescription || issuer.address.stateOrCountry,
            yearOfInc: issuer.yearOfInc,
            type: issuer.entityType
        });
    }
    for(let p=0;p<submission.relatedPersons.length;p++){
        let person = submission.relatedPersons[p];
        exemptOfferingSummary.persons.push(person.lastName+', '+person.firstName + (person.middleName?' '+person.middleName:'')
            + (person.relationships||person.relationshipClarification?' - ':'') + person.relationships + ' ' +person.relationshipClarification);
    }
    for(let prop in exemptOfferingSummary) if(exemptOfferingSummary[prop]==='') delete exemptOfferingSummary[prop];  //trim empty strings
    for(let prop in exemptOfferingSummary) if(exemptOfferingSummary[prop]==='false') exemptOfferingSummary[prop] = false;  //convert to boolean from string
    for(let prop in exemptOfferingSummary) if(exemptOfferingSummary[prop]==='true') exemptOfferingSummary[prop] = true;  //convert to boolean from string
    for(let prop in exemptOfferingSummary) if(parseInt(exemptOfferingSummary[prop], 10).toString()==exemptOfferingSummary[prop]) exemptOfferingSummary[prop] = parseInt(exemptOfferingSummary[prop], 10);  //convert to int from string

    // 4. update the ExemptOfferings REST API object in global memory
    if(exemptOfferingAPIPromise) exemptOfferingAPIObject = await exemptOfferingAPIPromise;  //make sure the read is finished
    const now = new Date();
    exemptOfferingAPIObject.lastUpdated = now.toISOString();
    let updateAPIFile = false;
    let i;
    for(i=0; i<exemptOfferingAPIObject.exemptOfferings.length;i++){
        let offeringInFile = exemptOfferingAPIObject.exemptOfferings[i];
        if(offeringInFile.adsh==exemptOfferingSummary.adsh){ //same!!
            if(JSON.stringify(offeringInFile)!=JSON.stringify(exemptOfferingSummary)){ //replace if different; ignore if same
                exemptOfferingAPIObject.exemptOfferings.splice(i, 1, exemptOfferingSummary);
                updateAPIFile = true;
            }
            break;
        }
        if(offeringInFile.issuers[0].cik==exemptOfferingSummary.issuers[0].cik){
            if(submission.isAmendment && submission.previousAccessionNumber==offeringInFile.adsh) { //replace
                exemptOfferingAPIObject.exemptOfferings.splice(i, 1, exemptOfferingSummary);
                updateAPIFile = true;
                break;
            }
            if(offeringInFile.isAmendment && offeringInFile.previousAccessionNumber==submission.adsh) { //leave unchanged since API offering is the replacement of what was just ingested
                logEvent('WARNING updateFormDAPI older exempt offering ingested', JSON.stringify({cik: offeringInFile.cik, exisiting: {adsh: offeringInFile.adsh, isAmendment: offeringInFile.isAmendment}, new: {adsh: exemptOfferingSummary.adsh, isAmendment: exemptOfferingSummary.isAmendment}}));
                break;
            }
            logEvent('WARNING updateFormDAPI multiple offerings', JSON.stringify({cik: offeringInFile.cik, exisiting: {adsh: offeringInFile.adsh, isAmendment: offeringInFile.isAmendment}, new: {adsh: exemptOfferingSummary.adsh, isAmendment: exemptOfferingSummary.isAmendment}}));
        }
    }
    if(i==exemptOfferingAPIObject.exemptOfferings.length) {
        exemptOfferingAPIObject.exemptOfferings.push(exemptOfferingSummary);
        updateAPIFile = true;
    }

//   6. write to  S3: restdata.publicdata.guru/sec/offerings/exempt/exemptOfferingSummaryYYYYQX.json
    let writeAPIPromise;
    if(updateAPIFile){
        exemptOfferingAPIObject.exemptOfferings = exemptOfferingAPIObject.exemptOfferings.sort((a,b)=>{return b.accepted-a.accepted});  //sort newest first
        writeAPIPromise = writeS3(fileKey, JSON.stringify(exemptOfferingAPIObject));
    }

//   5. collect promise from step 3b and call addExemptOfferingPersons(adsh) to update the persons table (for people search)
    await dbSavePromise;
    await runQuery(`call addExemptOfferingPersons('${exemptOfferingSummary.adsh}');`);
//   7. collect promises from steps 3a, 5 and 6 then exit (without closing con to allow reuse)
    await writeAPIPromise;

    //don't close connection (e.g await con.end()) so it can be reused when container is reused (the case for frequent calls)
    return {status: 'ok'};
}

async function saveFormDSubmission(s){
   /* try {*/
        //save main submission record (on duplicate handling in case of retries)
        delete s.filing.xmlBody;
        //console.log(JSON.stringify(s));  //debugging only

        const dbOfferingExists = await runQuery("select count(*) as recordcount from exemptOffering where adsh=" + q(s.filing.adsh, true));
        console.log(JSON.stringify(s));
        if(dbOfferingExists.data[0].recordcount==0){
            if(s.totalRemaining=="Indefinite") s.totalRemaining = null;
            if(s.totalOfferingAmount=="Indefinite") s.totalOfferingAmount = null;
            let sql = 'INSERT INTO exemptOffering '
                + '(adsh,  schemaVersion, submissionType, industryGroupType, is40Act, revenueRange, aggregateNetAssetValueRange, federalExemptionsExclusions, isAmendment, previousAccessionNumber, '
                + ' dateOfFirstSale, durationMoreThenOneYear, typesOfSecuritiesOffered, isBusinessCombinationTransaction, businessCombinationTransactionClarification, '
                + ' minimumInvestmentAccepted, salesCompensationList, totalOfferingAmount, totalAmountSold, totalRemaining, salesAmountsClarification, hasNonAccreditedInvestors, numberAlreadyInvested, '
                + ' salesCommissions, findersFees, commissionsAndFeesClarification, grossProceedsUsed, grossProceedsUsedClarification,authorizedRepresentativeSignature, signature) '
                + ' values '
                + '('+q(s.filing.adsh)+q(s.schemaVersion)+q(s.submissionType)+q(s.industryGroupType)+q(s.is40Act)+q(s.revenueRange)+q(s.aggregateNetAssetValueRange)+q(s.federalExemptionsExclusions)+q(s.isAmendment)+q(s.previousAccessionNumber)
                + q(s.dateOfFirstSale)+q(s.durationMoreThenOneYear)+q(s.typesOfSecuritiesOffered)+q(s.isBusinessCombinationTransaction)+q(s.businessCombinationTransactionClarification)
                + q(s.minimumInvestmentAccepted)+q(s.salesCompensationList, false, 4000)+q(s.totalOfferingAmount)+q(s.totalAmountSold)+q(s.totalRemaining)+q(s.salesAmountsClarification)+q(s.hasNonAccreditedInvestors)+q(s.numberAlreadyInvested)
                + q(s.salesCommissions)+q(s.findersFees)+q(s.commissionsAndFeesClarification)+q(s.grossProceedsUsed)+q(s.grossProceedsUsedClarification)+q(s.authorizedRepresentativeSignature)+q(s.signature, true, 1024) +')';
            const offeringPromise =  runQuery(sql);  //just collect a promise for now allowing the person to be inserted simultaneously

            //save issuers (note: first is the primaryIssuer)
            sql = 'insert into exemptOfferingIssuers '
                + ' (adsh, issuernum, cik, entityName, street1, street2, city, stateOrCountry, stateOrCountryDescription, '
                + ' zip, phone, jurisdictionOfInc, previousIssuerNames, previousEdgarNames, entityType, yearOfInc) '
                + ' values ';  //use multirow insert syntax = much faster
            for(let i=0; i<s.issuers.length;i++){
                let issuer = s.issuers[i];
                sql += (i>0?',':'') + ' ('+q(s.filing.adsh) + (i+1) + ',' + q(issuer.cik)+q(issuer.entityName, false, 400)
                    + q(issuer.address.street1)+q(issuer.address.street2)+q(issuer.address.city)
                    + q(issuer.address.stateOrCountry)+q(issuer.address.stateOrCountryDescription, false, 200)
                    + q(issuer.address.zipCode)+q(issuer.phone)+q(issuer.jurisdictionOfInc, false, 200)
                    + q(issuer.previousIssuerNames)+q(issuer.previousEdgarNames)
                    + q(issuer.entityType, false, 200)+q(issuer.yearOfInc, true) + ')';
            }
            const issuersPromise =  runQuery(sql);

            //save related persons
            if(s.relatedPersons){
                sql = 'insert into exemptOfferingPersons '
                    + ' (adsh, personnum, firstName, lastName, middleName, street1, street2, city, stateOrCountry, stateOrCountryDescription, zip, phone, relationships) '
                    + ' values ';  //use multirow insert syntax = much faster
                for(let p=0; p<s.relatedPersons.length;p++){
                    let person = s.relatedPersons[p];
                    sql += (p>0?',':'') + ' ('+q(s.filing.adsh) + (p+1) + ',' + q(person.firstName) + q(person.lastName)  + q(person.middleName)
                        + q(person.address.street1)  + q(person.address.street2)  + q(person.address.city)  + q(person.address.stateOrCountry)
                        + q(person.address.stateOrCountryDescription, false, 200) + q(person.address.zipCode)  + q(person.phone)  + q(person.relationships, true) +')';
                }
                await runQuery(sql);
            } else {
                await logEvent('WARNING updateFormDAPI no related persons', s.filing.indexHeaderFileName, true);
            }
            await offeringPromise;
            await issuersPromise;
        } else {
            await logEvent('WARNING updateFormDAPI record already exists', s.filing.indexHeaderFileName, true);
        }
        return true
   /* } catch (e) {
        await logEvent('ERROR updateFormDAPI db write failure ' + s.filing.indexHeaderFileName, JSON.stringify(e),true);
    }*/
}

function readAndRemoveTag($xml, tagPath, remainsChecking){
    let $tag = $xml.find?$xml.find(tagPath):$xml(tagPath);
    const rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars

    let value = $tag.text().replace(rgxTrim, '');
    if(remainsChecking) $tag.remove();
    return value;
}

function q(value, isLast, maxCharLength){
    if(typeof value !== 'undefined' && value !== '' && value != null){
        if(maxCharLength && typeof value == 'string' &&  value.length>maxCharLength){
            console.log("maxCharLength of "+maxCharLength+" exceeded.  Actual length = "+value.length+" for: "+value);
            value = value.substr(0,maxCharLength);
        }
        if(value==='true' || value==='false') return value +  (isLast?'':',');
        return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast?'':',');
    } else {
        return ' null'+ (isLast?'':',');
    }
}

async function createDbConnection() {
    let myConn = await mysql2.createConnection(secure.publicdataguru_dbinfo()); // (Re)created global connection
    myConn.connect(function(err) {              // The server is either down
        if(err) {                            // or restarting (takes a while sometimes).
            console.log('error when connecting to db:', err);
            setTimeout(() => {
                con = createDbConnection();
            }, 100); // We introduce a delay before attempting to reconnect, to avoid a hot loop
        }
    });

    myConn.on('error', async function(err) {
        console.log('db error', err);
        if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
            con = await createDbConnection();
        } else {                                      // connnection idle timeout (the wait_timeout
            throw err;                                  // server variable configures this)
        }
    });
    return myConn
}

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    })
}

async function runQuery(sql){
    if(sql.indexOf("''fatal MySQL error")===-1){
        try{
            let [result, fields] = await con.query(sql);
            return {data: result, fields: fields};
        } catch(err) {
            console.log("fatal MySQL error: "+ err.message);
            try{
                await logEvent("fatal MySQL error: "+err.message, sql);
            } catch(err2){
                console.log("fatal MySQL error: "+err.message);
            }
            throw err;
        }
    } else {
        console.log('endless loop detected in runQuery');
        process.exit();
    }
}

async function logEvent(type, msg, display){
    await runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
    if(display) console.log(type, msg);
}

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


/*////////////////////TEST CARD  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
const event = {
};
  exports.handler(event);

  create table if not exists exemptOffering (
    adsh varchar(20) not null primary key,
    schemaVersion varchar(20),
    submissionType varchar(20),
    cik varchar(20),
    entityName varchar(400) null,
    street1 varchar(200),
    street2 varchar(200) null,
    city varchar(200),
    stateOrCountry varchar(20),
    stateOrCountryDescription varchar(200) null,
    zip varchar(20) null,
    phone varchar(20) null,
    jurisdictionOfInc varchar(200),
    previousIssuerNames varchar(500),
    previousEdgarNames varchar(500),
    entityType varchar(200),
    yearOfInc int,
    industryGroupType  varchar(100),
    revenueRange  varchar(100),
    federalExemptionsExclusions varchar(200),
    isAmendment tinyint,
    previousAccessionNumber varchar(20),
    dateOfFirstSale date,
    durationMoreThenOneYear tinyint,
    typesOfSecuritiesOffered  varchar(1000),
    isBusinessCombinationTransaction tinyint, 
    businessCombinationTransactionClarification  varchar(1000) null,
    minimumInvestmentAccepted double,
    salesCompensationList  varchar(4000) null,
    totalOfferingAmount double null,  //null means "Indefinite"
    totalAmountSold double null,
    totalRemaining double null, //null means "Indefinite"
    salesAmountsClarification  varchar(1000) null,
    hasNonAccreditedInvestors tinyint null,
    numberAlreadyInvested int null,
    salesCommissions  varchar(200) null,
    findersFees  varchar(200) null,
    commissionsAndFeesClarification  varchar(1000) null,
    grossProceedsUsed double null,
    grossProceedsUsedClarification  varchar(200) null,
    authorizedRepresentativeSignature varchar(200) null,
    signature varchar(1024) null
);

create table if not exists exemptOfferingPersons  (
    adsh varchar(20) not null,
    personnum int not null,
    firstName varchar(100),
    lastName varchar(100),
    middleName varchar(100) null,
    street1 varchar(200),
    street2 varchar(200) null,
    city varchar(200),
    stateOrCountry varchar(20),
    stateOrCountryDescription varchar(200) null,
    zip varchar(20) null,
    phone varchar(20) null,
   relationships varchar(200) null,
   primary key (adsh, personnum)
);



///////////////////////////////////////////////////////////////////////////////////////////////*/