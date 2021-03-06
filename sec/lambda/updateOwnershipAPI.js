// updateOwnershipAPI.js runs as a AWS Lambda function (note: configured to run up to 20 of these functions concurrently)
// input:  adsh and url (S3 key) to new primary XML submission of a form 3, 4, or 5
// actions:
//   1. read the XMl and parse using cheerio into the in memory submission data structure
//   2. write parsed data structure to the mySQL tables:
//     - ownership_submission
//     - ownership_reporter
//     - ownership_transaction
//     - ownership_footnote
//   3. call updateOwnerShipAPI(adsh) to update the rows affected by the submission in
//     - ownership_api_reporter
//     - ownership_api_issuer
//   4. update the reporter REST API
//     - select the affected ownership_api_reporter rows (where cik in (reporter ciks))
//     - write to S3: restdata.publicdata.guru/sec/
//     - tell cloudFront to refresh the cache for the updated reporter API files
//   4. update the issuer REST API
//     - select the affected ownership_api_issuer row (where cik = issuer_cik)
//     - write to S3: restdata.publicdata.guru/sec/
//     - tell cloudFront to refresh the cache for the updated issuer API file

// average execution time = 300ms using a 256MB container costing $0.000000417 per 100ms of execution time
// ownership submissions per year = 250,000 costing $0.31 (!!!)


//REQUIRES LAMBDA LAYER "COMMON"
const cheerio = require('cheerio');
const common = require('common');
const root = 'test'; //for S3 writes
const lambdaTimeout = 20000; //don't rerun if header insert time within updateOwnershipAPI's timeout configuration (in milliseconds)

const ownershipForms= {
    '3': '.xml',
    '3/A': '.xml',
    '4': '.xml',
    '4/A': '.xml',
    '5': '.xml',
    '5/A': '.xml'
};
exports.ownershipForms = ownershipForms;
const form4TransactionCodes = {  //from https://www.sec.gov/files/forms-3-4-5.pdf
    K: 'Equity swaps and similar hedging transactions',
    P: 'Purchase of securities on an exchange or from another person',
    S: 'Sale of securities on an exchange or to another person',
    D: 'Sale or transfer of securities back to the company',
    F: 'Payment of exercise price or tax liability using portion of securities received from the company',
    M: 'Exercise or conversion of derivative security received from the company (such as an option)',
    G: 'Gift of securities by or to the insider',
    V: 'A transaction voluntarily reported on Form 4',
    J: 'Other (accompanied by a footnote describing the transaction)'
};

exports.close = () => {
    if(common.con){
        console.log('closing connection held by updateOwnership');
        common.con.end();
        common.con = false;
    }
};

exports.handler = async (messageBatch, context) => {
    if(!messageBatch.Records.length) {
        console.log('empty message from queue');
        return false;
    }
    let event = JSON.parse(messageBatch.Records[0].body);  //batch = 1 by configuration

    if(!event.lowChatterMode) await common.logEvent('updateOwnershipAPI '+ event.adsh, 'invoked using path '+ event.path + ' (time stamp = ' + event.timeStamp +')', true);
    var filing = {
        path: event.path,
        fileNum: event.fileNum,
        form: event.form,
        adsh: event.adsh,
        filerCik: event.cik,
        filedDate: event.filingDate,
        acceptanceDateTime: event.acceptanceDateTime,
        period: event.period,
        files: event.files,
        noS3Writes: event.noS3Writes,
        xmlBody: event.xmlBody,
        tableSuffix: event.crawlerOverrides?event.crawlerOverrides.tableSuffix||'':''
    };
    let sql = 'select bodyhash, acceptancedatetime, created, api_status from ownership_submission'+filing.tableSuffix+' where adsh='+ common.q(filing.adsh, true);
    let hashPromise = common.runQuery(sql);

    if(!filing.xmlBody){  //calling process can either pass in the XML body or have updateOwnershipAPI find and load it
        for (let i = 0; i < filing.files.length; i++) {
            if (ownershipForms[filing.files[i].type]==filing.files[i].name.substr(-4)) {
                filing.primaryDocumentName = filing.files[i].name;
                filing.xmlBody = await common.readS3(filing.path + filing.primaryDocumentName).catch(()=>{throw new Error('unable to read ' + filing.path + filing.primaryDocumentName)});
                break;
            }
        }
    } else
        filing.primaryDocumentName = event.primaryDocumentName;

    let dbFileHash = await hashPromise;
    var submission = {transactions: []};
    if (filing.xmlBody) {
        console.log('got body (length='+filing.xmlBody.length+')');
        filing.bodyHash = common.makeHash(filing.xmlBody);
        if(dbFileHash.data.length && dbFileHash.data[0].bodyhash == filing.bodyHash){
            if(dbFileHash.data[0].api_status==1){
                let now = new Date();
                let createDateTime = new Date(dbFileHash.data[0].created+'Z');  //timestamp is UTC
                if(createDateTime.getTime()+lambdaTimeout < now.getTime()){
                    await common.logEvent('updateOwnershipAPI warning: updating APIs for prior incomplete/timed out attempt', event.path, true);
                    submission.hasTransactions = true;
                    await updateAPIs(filing, submission, filing.tableSuffix);
                } else {
                    console.log('Timestamp show lambda has starting processing this submission: Terminating myself without further processing');
                }
            } else {
                if(!event.lowChatterMode) await common.logEvent('updateOwnershipAPI duplicate '+ event.adsh, 'identical hash signatures; not parsed', true);
                submission.duplicate = true;
            }
        } else {
            if(dbFileHash.data.length && dbFileHash.data[0].bodyhash)
                await common.logEvent('updateOwnershipAPI conflicting hashes for '+ event.adsh, "db acceptancedatetime "+dbFileHash.data[0].acceptancedatetime+'; new acceptancedatetime '+ filing.acceptanceDateTime, true);
            submission = await process345Submission(filing, false);
            submission.proccessedOwnership = true;
            await updateAPIs(filing, submission, filing.tableSuffix);
            if(!event.lowChatterMode) await common.logEvent('updateOwnershipAPI '+ event.adsh, 'completed with '+(submission.transactions?submission.transactions.length:0)+' transactions found', true);
        }
    } else {
        await common.logEvent('FILE ERROR: no xmlBody for ownership', event.path, true);
        submission = false; //stop further execution w/o causing an error in the monitoring
    }
    return submission;
};

async function process345Submission(filing, remainsChecking) {
    console.log('starting process345Submission');
    var $xml = cheerio.load(filing.xmlBody, {xmlMode: true});
    try {
        if ($xml('issuerCik').length != 1) {
            throw 'issuerCik error in ' + filing.fileName;
        }
    } catch (e) {
        await common.logEvent('FILE ERROR: bad file format detected by updateOwnershipAPI', filing.path, true);
        return false;  //stop further execution w/o causing an error in the monitoring
    }

    var rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
    var submission = {
        adsh: filing.adsh,
        acceptanceDateTime: filing.acceptanceDateTime,
        fileSize: filing.xmlBody.length,
        schemaVersion: $xml('schemaVersion').text(),
        documentType: $xml('documentType').text(),
        fileName: filing.fileName,
        filedDate: filing.filedDate,
        filename: filing.primaryDocumentName,
        bodyHash: filing.bodyHash,
        periodOfReport: $xml('periodOfReport').text(),
        dateOfOriginalSubmission: $xml('dateOfOriginalSubmission').text(),
        issuer: {
            cik: $xml('issuerCik').text(),
            name: $xml('issuerName').text(),
            tradingSymbol: $xml('issuerTradingSymbol').text()
        },
        reportingOwners: [],
        transactions: false, //filled out below
        remarks: $xml('remarks').text(),
        signatures: $xml('ownerSignature').text(),  //will concat all ownerSignature sections' signatureName and signatureDate
        footnotes: []
    };

    var $owner;
    let reporterCiks = [];

    console.log('process345Submission: processing reportingOwner');
    $xml('reportingOwner').each(async function (i, elem) {
        $owner = $xml(elem);
        let reportingOwner = {
            cik: readAndRemoveTag($owner, 'reportingOwner rptOwnerCik'), //0001112668</rptOwnerCik>
            name: readAndRemoveTag($owner, 'reportingOwner rptOwnerName'), //BRUNER JUDY</rptOwnerName>
            street1: readAndRemoveTag($owner, 'reportingOwner rptOwnerStreet1'), //951 SANDISK DRIVE</rptOwnerStreet1>
            street2: readAndRemoveTag($owner, 'reportingOwner rptOwnerStreet2'),
            city: readAndRemoveTag($owner, 'reportingOwner rptOwnerCity'), //>MILPITAS</rptOwnerCity>
            state: readAndRemoveTag($owner, 'reportingOwner rptOwnerState'), //>CA</rptOwnerState>
            stateDescription: readAndRemoveTag($owner, 'reportingOwner reportingOwnerAddress rptOwnerStateDescription'), //<rptOwnerStateDescription>ONTARIO, CANADA</rptOwnerStateDescription>
            zip: readAndRemoveTag($owner, 'reportingOwner rptOwnerZipCode'), //>95035</rptOwnerZipCode>
            isDirector: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isDirector'), //>0</isDirector>
            isOfficer: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isOfficer'), //>1</isOfficer>
            isTenPercentOwner: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isTenPercentOwner'), //>0</isTenPercentOwner>
            isOther: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship isOther'), //>0</isOther>
            otherText: readAndRemoveTag($owner, 'reportingOwner reportingOwnerRelationship otherText'),
            officerTitle: readAndRemoveTag($owner, 'reportingOwner officerTitle') //>Exec. VP, Administration, CFO</officerTitle>
        };
        submission.reportingOwners.push(reportingOwner);
        reporterCiks.push(reportingOwner.cik);
        //check to see if data or values were not read (and subsequently removed)
        if (remainsChecking) {
            var remains = $owner.text().trim();
            if (remains.length > 0) await common.logEvent('reporter remains', submission.fileName + ': ' + $owner.html())
        }
    });

    console.log('process345Submission: processing footnotes');
    $xml('footnotes footnote').each(function (i, elem) {
        var id = elem.attribs.id, text = $xml(elem).text().replace(rgxTrim, '');
        submission.footnotes.push({id: id, text: text});
    });

    var $trans, trans;
    var transactions = [];
    var transactionRecordTypes = [
        {path: 'nonDerivativeTable nonDerivativeTransaction', derivative: 0, transOrHold: 'T'},
        {path: 'nonDerivativeTable nonDerivativeHolding', derivative: 0, transOrHold: 'H'},
        {path: 'derivativeTable derivativeTransaction', derivative: 1, transOrHold: 'T'},
        {path: 'derivativeTable derivativeHolding', derivative: 1, transOrHold: 'H'}
    ];

    console.log('process345Submission: processing transactions');
    transactionRecordTypes.forEach(function (transactionRecordType, index) {
        $xml(transactionRecordType.path).each(async function (i, elem) {
            //need to
            $trans = $xml(elem);
            trans = {
                derivative: transactionRecordType.derivative,
                transOrHold: transactionRecordType.transOrHold,
                securityTitle: readAndRemoveTag($trans, 'securityTitle value'),
                transactionDate: readAndRemoveTag($trans, 'transactionDate value'),
                deemedExecutionDate: readAndRemoveTag($trans, 'deemedExecutionDate value'),
                transactionCode: readAndRemoveTag($trans, 'transactionCoding transactionCode'),
                conversionOrExercisePrice: readAndRemoveTag($trans, 'conversionOrExercisePrice value'),
                formType: readAndRemoveTag($trans, 'transactionCoding transactionFormType'), //not needed and not always in every transaction path
                equitySwap: readAndRemoveTag($trans, 'transactionCoding equitySwapInvolved'),
                timeliness: readAndRemoveTag($trans, 'transactionTimeliness value'),
                transactionShares: readAndRemoveTag($trans, 'transactionAmounts transactionShares'),
                transactionPricePerShare: readAndRemoveTag($trans, 'transactionAmounts transactionPricePerShare'),
                transactionTotalValue: readAndRemoveTag($trans, 'transactionAmounts transactionTotalValue'),
                transactionAcquiredDisposedCode: readAndRemoveTag($trans, 'transactionAcquiredDisposedCode value'),
                underlyingSecurityTitle: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityTitle value'),
                underlyingSecurityShares: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityShares value'),
                underlyingSecurityValue: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityValue value'),
                sharesOwnedFollowingTransaction: readAndRemoveTag($trans, 'postTransactionAmounts sharesOwnedFollowingTransaction value'),
                valueOwnedFollowingTransaction: readAndRemoveTag($trans, 'valueOwnedFollowingTransaction value'),
                directOrIndirectOwnership: readAndRemoveTag($trans, 'ownershipNature directOrIndirectOwnership value'),
                expirationDate: readAndRemoveTag($trans, 'expirationDate value'),
                exerciseDate: readAndRemoveTag($trans, 'exerciseDate value'),
                natureOfOwnership: readAndRemoveTag($trans, 'ownershipNature natureOfOwnership value'),
                footnotes: []
            };
            $trans.find('footnoteId').each(function (i, elem) {
                trans.footnotes.push(elem.attribs.id);
            });
            if (trans.transOrHold == 'T') submission.hasTransactions = true;
            transactions.push(trans);

            //check to see if data or values were not read (and subsequently removed)
            if (remainsChecking) {
                $trans.find('footnoteId').remove();
                var remains = $trans.text().trim();
                if (remains.length > 0) {
                    await common.logEvent(transactionRecordType.path + ' remains', submission.fileName + ': ' + $trans.html());
                }
                delete $trans;
            }
        });

    });
    if (transactions.length) submission.transactions = transactions;
    //console.log(submission);

    console.log('process345Submission: saving submission');
    await save345Submission(submission, filing.tableSuffix);
    console.log('process345Submission: submission saved');
    return submission;

    function readAndRemoveTag($xml, tagPath, remainsChecking){
        var $tag = $xml.find(tagPath);
        var value = $tag.text().replace(rgxTrim, '').replace(/[\n\t]/g,' ');  //newlines and tabs are not JSON compatable.  Must be encode or removed
        if(remainsChecking) $tag.remove();
        return value;
    }
}

async function updateAPIs(filing, submission, tableSuffix){
    //only update the API if this submission has transaction (vs. only reporting holdings)
    if(!filing.noS3Writes){
        if(submission.hasTransactions){
            console.log('process345Submission: calling updateOwnershipAPI');
            let updatedCiks = await common.runQuery("call updateOwnershipAPI('"+filing.adsh+"');");
            //console.log(JSON.stringify(updatedCiks));
            if(updatedCiks.data && updatedCiks.data.length && updatedCiks.data[0].length){
                let reporterCiks = [], issuerCik;
                for(let i=0;i<updatedCiks.data[0].length;i++) {
                    reporterCiks.push(updatedCiks.data[0][i].ownercik);
                    issuerCik = updatedCiks.data[0][i].issuercik
                }
                console.log('process345Submission: fetching reporter updates');
                let updatedReporterAPIDataset = await common.runQuery(
                    "select cik, transactions, lastfiledt, name, mastreet1, mastreet2, macity, mastate, mazip "
                    + " from ownership_api_reporter where cik in ('"+reporterCiks.join("','")+"')"
                );
                let s3WritePromises = [], body;
                //reporters (one or more per submission)
                for(let r=0; r<updatedReporterAPIDataset.data.length; r++){
                    body = updatedReporterAPIDataset.data[r];
                    body.view = 'reporter';
                    body.mailingAddress = {
                        street1: body.mastreet1,
                        street2: body.mastreet2,
                        city: body.macity,
                        state: body.mastate,
                        zip: body.mazip,
                    };
                    delete body.mastreet1;
                    delete body.mastreet2;
                    delete body.macity;
                    delete body.mastate;
                    delete body.mazip;
                    body.transactionColumns = "Form|Accession Number|Reported Order|Code|Acquired or Disposed|Direct or Indirect|Transaction Date|File Date|reporter Name|Issuer CIK|Shares|Shares Owned After|Security";
                    body.transactions = JSON.parse(body.transactions);

                    console.log('process345Submission: writing reporter API for reporter cik'+parseInt(body.cik));
                    s3WritePromises.push(common.writeS3(root+'/ownership/reporter/cik'+parseInt(body.cik), JSON.stringify(body)));
                }

                //issuer (only one per submissions
                //console.log(updatedIssuerAPIDataset);  ///debug only
                console.log('process345Submission: fetching issuer updates');
                let updatedIssuerAPIDataset = await common.runQuery(
                    "select cik, transactions, lastfiledt, name, mastreet1, mastreet2, macity, mastate, mazip, bastreet1, bastreet2, bacity, bastate, bazip "
                    + " from ownership_api_issuer where cik = '" + issuerCik +"'"
                );
                body = updatedIssuerAPIDataset.data[0];
                body.view = 'issuer';
                body.mailingAddress = {
                    street1: body.mastreet1,
                    street2: body.mastreet2,
                    city: body.macity,
                    state: body.mastate,
                    zip: body.mazip,
                };
                delete body.mastreet1;
                delete body.mastreet2;
                delete body.macity;
                delete body.mastate;
                delete body.mazip;
                body.businessAddress = {
                    street1: body.bastreet1,
                    street2: body.bastreet2,
                    city: body.bacity,
                    state: body.bastate,
                    zip: body.bazip,
                };
                delete body.bastreet1;
                delete body.bastreet2;
                delete body.bacity;
                delete body.bastate;
                delete body.bazip;
                body.transactionColumns = "Form|Accession Number|Reported Order|Code|Acquired or Disposed|Direct or Indirect|Transaction Date|File Date|reporter Name|Issuer CIK|Shares|Shares Owned After|Security";
                body.transactions = JSON.parse(body.transactions);

                console.log('process345Submission: writing issuer API for cik'+parseInt(issuerCik));
                s3WritePromises.push(common.writeS3(root+'/ownership/issuer/cik'+parseInt(issuerCik), JSON.stringify(body)));

                for(let i=0; i<s3WritePromises.length;i++){
                    console.log('collecting s3WritePromises '+(i+1)+' of '+ s3WritePromises.length);
                    await s3WritePromises[i];  //collect the S3 writer promises
                }
                console.log('updateOwnershipAPI: '+s3WritePromises.length + ' s3WritePromises promises collected');
            }
        } else {
            console.log((submission.transactions?submission.transactions.length:0)+' holdings and no transactions reported: API update not needed');
        }
        await common.runQuery(`update ownership_submission${tableSuffix} set api_status=2 where adsh='${filing.adsh}'`);
    }

    /*invalidation takes 5 - 15 minutes.  VERY EXPENSIVE. No SLA.  Better to set TTL for APIs to 60s
    //let cloudFront = new AWS.CloudFront(); //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFront.html#createInvalidation-property
    //invalidationParams.InvalidationBatch.Paths.Quantity = invalidationParams.InvalidationBatch.Paths.Items.length;
    //await cloudFront.createInvalidation(invalidationParams); */
}

async function save345Submission(s, tableSuffix){
    //save main submission record (on duplicate handling in case of retries)
    const q = common.q;
    var submission_sql = 'replace INTO ownership_submission'+tableSuffix+' (adsh, filename, form, schemaversion, bodyhash, reportdt, filedt, acceptancedatetime, originalfiledt, issuercik, issuername, symbol, '
        + ' remarks, signatures, txtfilesize, api_status) '
        + " VALUES (" +q(s.adsh) + q(s.filename) + q(s.documentType) + q(s.schemaVersion) + q(s.bodyHash) + q(s.periodOfReport) + q(s.filedDate)
        + q(s.acceptanceDateTime) + q(s.dateOfOriginalSubmission) + q(s.issuer.cik) + q(s.issuer.name)+q(s.issuer.tradingSymbol)+q(s.remarks)+q(s.signatures) + s.fileSize +', 1)';

    //save reporting owner records
    let ownerRecords = [], reporterPromise = false;
    if(s.reportingOwners.length){
        for(var ro=0; ro<s.reportingOwners.length;ro++){
            var owner = s.reportingOwners[ro];
            ownerRecords.push(
                '(' +q(s.adsh) + (ro+1)+',' +q(owner.cik) +q(owner.name) + q(owner.street1)+q(owner.street2)+q(owner.city)
                + q(owner.state) + q(owner.stateDescription) +  q(owner.zip) + q(owner.isDirector)+q(owner.isOfficer)
                + q(owner.isTenPercentOwner)+ q(owner.isOther )+ q(owner.otherText, true) + ')');
        }
        let sql ='REPLACE INTO ownership_reporter'+tableSuffix+' (adsh, ownernum, ownercik, ownername, ownerstreet1, ownerstreet2, ownercity, '
            + ' ownerstate, ownerstatedescript, ownerzip, isdirector, isofficer, istenpercentowner, isother, other)'
            + ' value ' + ownerRecords.join(',');
        reporterPromise =  common.runQuery(sql);
    }

    //save any footnote records
    let footnoteRecords = [], footnotePromise = false;
    for(var f=0; f<s.footnotes.length;f++){
        var foot = s.footnotes[f];
        footnoteRecords.push(' ('+q(s.adsh)+foot.id.substr(1)+','+q(foot.text, true) + ')');
    }
    if(footnoteRecords.length){
        let sql ='REPLACE INTO ownership_footnote'+tableSuffix+' (adsh, fnum, footnote) value ' + footnoteRecords.join(',');
        footnotePromise =  common.runQuery(sql);
    }

    //save transaction records
    let transactionRecords = [],
        transactionPromise = false,
        transactionFootnotesRecords = [],
        transactionFootnotePromise = false;
    for(var t=0; t<s.transactions.length;t++){
        var trans = s.transactions[t];
        transactionRecords.push('('+q(s.adsh)+(t+1)+','+trans.derivative+','+q(trans.transOrHold)+q(trans.expirationDate)+q(trans.exerciseDate)
            + q(trans.formType)+ q(trans.securityTitle)+q(trans.conversionOrExercisePrice) + q(trans.transactionDate)
            + q(trans.deemedExecutionDate) + q(trans.transactionCode)+q(trans.equitySwap)+ q(trans.timeliness) + q(trans.transactionShares)
            + q(trans.transactionPricePerShare)+ q(trans.transactionTotalValue)+ q(trans.transactionAcquiredDisposedCode)+ q(trans.underlyingSecurityTitle)
            + q(trans.underlyingSecurityShares)+ q(trans.underlyingSecurityValue) + q(trans.sharesOwnedFollowingTransaction)+ q(trans.valueOwnedFollowingTransaction)
            + q(trans.directOrIndirectOwnership) + q(trans.natureOfOwnership, true) + ')');
        for(var tf=0; tf<trans.footnotes.length;tf++){
            transactionFootnotesRecords.push('('+q(s.adsh)+(t+1)+','+trans.footnotes[tf].substr(1)+')');
        }
    }

    if(transactionRecords.length){  //this should be necessary but there a lot of bad data out there (e.g. https://www.sec.gov/Archives/edgar/data/1252849/000125284916000152/wf-form3_145192430997246.xml)
        let sql ='REPLACE INTO ownership_transaction'+tableSuffix+' (adsh, transnum, isderivative, transtype, expirationdt, exercisedt, formtype, security, price, transdt, deemeddt, transcode, equityswap, timeliness, shares, '
            + ' pricepershare, totalvalue, acquiredisposed, underlyingsecurity, underlyingshares, underlyingsecurityvalue, sharesownedafter,  valueownedafter, directindirect, ownershipnature)'
            + ' value ' + transactionRecords.join(',');
        transactionPromise =  common.runQuery(sql);
    }
    if(footnoteRecords.length) {
        let sql = 'REPLACE INTO ownership_transaction_footnote'+tableSuffix+' (adsh, tnum, fnum) values ' + transactionFootnotesRecords.join(',');
        transactionFootnotePromise = common.runQuery(sql);
    }

    if(reporterPromise) await reporterPromise;
    if(transactionPromise) await transactionPromise;
    if(footnotePromise) await footnotePromise;
    if(transactionFootnotePromise) await transactionFootnotePromise;
    await common.runQuery(submission_sql);  //ensure all component records are written before writing the header so error or timeout will correctly rerun ingest
}


/*////////////////////TEST CARD  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
const event = {
    "path": "sec/edgar/data/1102934/000112760216035352/",
    "fileNum": "000-30205",
    "form": "4",
    "adsh": "0001127602-16-035352",
    "filerCik": "0001102934",
    "filingDate": "20160104",
    "acceptanceDateTime": "20160104154713",
    "period": "20151231",
    "files": [
        {
            "name": "form4.xml",
            "description": "PRIMARY DOCUMENT",
            "type": "4"
        }
    ]
 };
  exports.handler(event);
///////////////////////////////////////////////////////////////////////////////////////////////*/