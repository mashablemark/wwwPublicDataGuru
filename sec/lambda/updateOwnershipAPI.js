// updateOwnershipAPI.js runs as a AWS Lambda function (note: configured to run up to 20 of these functions concurrently)
// input:  adsh and url (S3 key) to new primary XML submission of a form 3, 4, or 5
// actions:
//   1. read the XMl and parse using cheerio into the in memory submission data structure
//   2. write parsed data structure to the mySQL tables:
//     - ownership_submission
//     - ownership_reporter
//     - ownership_transaction
//     - ownership_footnote
//   3. call makeOwnerShipAPI(adsh) to update the rows affected by the submission in
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

// execution time = ??
// executions per year = 210,000
// cost per year =

var cheerio = require('cheerio');
var mysql2 = require('mysql2/promise');
var AWS = require('aws-sdk');
var secure = require('./secure');  //must not be committed

var con;  //global db connection
var ownershipForms= {
    '3': 'xml',
    '3/A': 'xml',
    '4': 'xml',
    '4/A': 'xml',
    '5': 'xml',
    '5/A': 'xml'
};
var form4TransactionCodes = {  //from https://www.sec.gov/files/forms-3-4-5.pdf
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

var s3 = new AWS.S3();
async function readS3(file){
    return new Promise((resolve, reject) => {
        let params = {
            Bucket: "restapi.publicdata.guru",
            Key: "sec/" + file
        };
        s3.getObject(params, (err, data) => {
            if (err) console.log(err, err.stack); // an error occurred
            else     resolve(data.Body.toString('utf-8'));   // successful response  (alt method = createreadstreeam)
        });
    });
}
async function writeS3(fileKey, body) {
    return new Promise((resolve, reject) => {
        s3.putObject({
            Body: JSON.stringify(body),
            Bucket: "restapi.publicdata.guru",
            Key: fileKey
        }, (err, data) => {
            if (err) console.log(err, err.stack); // an error occurred
            else     console.log(data);           // successful response
        });
    });
}

exports.handler = async (event, context) => {
    con = await mysql2.createConnection({ //global db connection
        host: db_info.host,
        user: db_info.uid,
        password: db_info.password,
        database: 'secdata'
    });

    const adsh = event.adsh;
    const filing = {
        xmlBody: await readS3(event.file),
        fileName: event.fileName,
        form: event.form,
        adsh: event.adsh,
        filerCik: event.filerCik,
        filedDate: event.filingDate,
        period: event.period
    };
    process345Submission(filing, false);

};

function process345Submission(filing, remainsChecking){
    var $xml = cheerio.load(filing.xmlBody, {xmlMode: true});
    if($xml('issuerCik').length!=1)
        throw 'issuerCik error in ' + filing.fileName;
    var rgxTrim = /^\s+|\s+$/g;  //used to replace (trim) leading and trailing whitespaces include newline chars
    var submission = {
        adsh: filing.adsh,
        fileSize: filing.xmlBody.length,
        schemaVersion: $xml('schemaVersion').text(),
        documentType: $xml('documentType').text(),
        fileName: filing.fileName,
        filedDate: filing.filedDate,
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
    $xml('reportingOwner').each(function (i, elem) {
        $owner =  $xml(elem);
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
        if(remainsChecking){
            var remains = $owner.text().trim();
            if(remains.length>0) logEvent('reporter remains', submission.fileName + ': '+ $owner.html())
        }
    });

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

    transactionRecordTypes.forEach(function(transactionRecordType, index){
        $xml(transactionRecordType.path).each(function (i, elem) {
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
                timeliness:  readAndRemoveTag($trans, 'transactionTimeliness value'),
                transactionShares: readAndRemoveTag($trans, 'transactionAmounts transactionShares'),
                transactionPricePerShare: readAndRemoveTag($trans, 'transactionAmounts transactionPricePerShare'),
                transactionTotalValue: readAndRemoveTag($trans, 'transactionAmounts transactionTotalValue'),
                transactionAcquiredDisposedCode: readAndRemoveTag($trans, 'transactionAcquiredDisposedCode value'),
                underlyingSecurityTitle: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityTitle value'),
                underlyingSecurityShares: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityShares value'),
                underlyingSecurityValue: readAndRemoveTag($trans, 'underlyingSecurity underlyingSecurityValue value'),
                sharesOwnedFollowingTransaction: readAndRemoveTag($trans, 'postTransactionAmounts sharesOwnedFollowingTransaction value'),
                valueOwnedFollowingTransaction:  readAndRemoveTag($trans, 'valueOwnedFollowingTransaction value'),
                directOrIndirectOwnership: readAndRemoveTag($trans, 'ownershipNature directOrIndirectOwnership value'),
                expirationDate: readAndRemoveTag($trans, 'expirationDate value'),
                exerciseDate: readAndRemoveTag($trans, 'exerciseDate value'),
                natureOfOwnership: readAndRemoveTag($trans, 'ownershipNature natureOfOwnership value'),
                footnotes: []
            };
            $trans.find('footnoteId').each(function (i, elem) {
                trans.footnotes.push(elem.attribs.id);
            });
            transactions.push(trans);

            //check to see if data or values were not read (and subsequently removed)
            if(remainsChecking) {
                $trans.find('footnoteId').remove();
                var remains = $trans.text().trim();
                if(remains.length>0) logEvent(transactionRecordType.path + ' remains', submission.fileName + ': '+ $trans.html())
                delete $trans;
            }
        });

    });
    if(transactions.length) submission.transactions = transactions;

    save345Submission(submission);

    await runQuery("call updateOwnershipAPI('"+filing.adsh+"')");

    let invalidationParams = {
        DistributionId: 'EJG0KMRDV8F9E',
        InvalidationBatch: {
            CallerReference: submission.adsh,
            Paths: {
                Quantity: 0,
                Items: []
            }
        }
    };
    let updatedReporterAPIDataset = await runQuery("select * from ownership_api_reporter where reportercik in ('"+reporterCiks.join("','")+"')");
    let writePromises = [], body;
    //reporters (one or more per submission)
    for(let i=0; i<updatedIssuerAPIDataset.data.length;i++){
        body =
        writePromises.push(writeS3('sec/ownership/reporter/cik'+parseInt(body.cik), body));
        invalidationParams.InvalidationBatch.Paths.Items.push();
    }
    let updatedIssuerAPIDataset = await runQuery("select * from ownership_api_issuer where issuercik = '"+submission.issuer.cik+"'");
    //issuer (only one per submissions
    writePromises.push(writeS3('sec/ownership/issuer/cik'+parseInt(submission.issuer.cik), body));
    invalidationParams.InvalidationBatch.Paths.Items.push();

    for(let i=0; i<writePromises.length;i++){
        await writePromises[i];  //collect the S3 writer promises
    }

    let cloudFront = AWS.CloudFront();
    invalidationParams.InvalidationBatch.Paths.Quantity = invalidationParams.InvalidationBatch.Paths.Items.length;
    await cloudFront.createInvalidation(invalidationParams);

    //close connection and terminate lambda function by ending handler function
    await con.end();


    function readAndRemoveTag($xml, tagPath, remainsChecking){
        var $tag = $xml.find(tagPath);
        var value = $tag.text().replace(rgxTrim, '');
        if(remainsChecking) $tag.remove();
        return value;
    }
}


function save345Submission(s){
    //save main submission record (on duplicate handling in case of retries)
    var sql = 'INSERT INTO ownership_submission (adsh, form, schemaversion, reportdt, filedt, originalfiledt, issuercik, issuername, symbol, '
        + ' remarks, signatures, txtfilesize, tries) '
        + " VALUES (" +q(s.adsh) + q(s.documentType) + q(s.schemaVersion) + q(s.periodOfReport) + q(s.filedDate) + q(s.dateOfOriginalSubmission)
        + q(s.issuer.cik) + q(s.issuer.name)+q(s.issuer.tradingSymbol)+q(s.remarks)+q(s.signatures) + s.fileSize +',1)'
            + ' on duplicate key update tries = tries + 1';
    runQuery(sql);

    //save reporting owner records
    for(var ro=0; ro<s.reportingOwners.length;ro++){
        var owner = s.reportingOwners[ro];
        sql ='INSERT INTO ownership_reporter (adsh, ownernum, ownercik, ownername, ownerstreet1, ownerstreet2, ownercity, '
        + ' ownerstate, ownerstatedescript, ownerzip, isdirector, isofficer, istenpercentowner, isother, other)'
        + ' value (' +q(s.adsh) + (ro+1)+',' +q(owner.cik) +q(owner.name) + q(owner.street1)+q(owner.street2)+q(owner.city)
        + q(owner.state) + q(owner.stateDescription) +  q(owner.zip) + q(owner.isDirector)+q(owner.isOfficer)
        + q(owner.isTenPercentOwner)+ q(owner.isOther )+ q(owner.otherText, true) + ')'
            + ' on duplicate key update ownernum = ownernum';
        runQuery(sql);
    }
    //save any footnote records
    for(var f=0; f<s.footnotes.length;f++){
        var foot = s.footnotes[f];
        sql ='INSERT INTO ownership_footnote (adsh, fnum, footnote) '
            + ' value ('+q(s.adsh)+foot.id.substr(1)+','+q(foot.text, true) + ')'
            + ' on duplicate key update adsh = adsh';
        runQuery(sql);
    }

    //save transaction records
    for(var t=0; t<s.transactions.length;t++){
        var trans = s.transactions[t];
        sql ='INSERT INTO ownership_transaction (adsh, transnum, isderivative, transtype, expirationdt, exercisedt, formtype, security, price, transdt, deemeddt, transcode, equityswap, timeliness, shares, '
        + ' pricepershare, totalvalue, acquiredisposed, underlyingsecurity, underlyingshares, underlyingsecurityvalue, sharesownedafter,  valueownedafter, directindirect, ownershipnature)'
        + ' value ('+q(s.adsh)+(t+1)+','+trans.derivative+','+q(trans.transOrHold)+q(trans.expirationDate)+q(trans.exerciseDate)
        + q(trans.formType)+ q(trans.securityTitle)+q(trans.conversionOrExercisePrice) + q(trans.transactionDate)
        + q(trans.deemedExecutionDate) + q(trans.transactionCode)+q(trans.equitySwap)+ q(trans.timeliness) + q(trans.transactionShares)
        + q(trans.transactionPricePerShare)+ q(trans.transactionTotalValue)+ q(trans.transactionAcquiredDisposedCode)+ q(trans.underlyingSecurityTitle)
        + q(trans.underlyingSecurityShares)+ q(trans.underlyingSecurityValue) + q(trans.sharesOwnedFollowingTransaction)+ q(trans.valueOwnedFollowingTransaction)
        + q(trans.directOrIndirectOwnership) + q(trans.natureOfOwnership, true) + ')'
            + ' on duplicate key update transnum = transnum';
        runQuery(sql);
        for(var tf=0; tf<trans.footnotes.length;tf++){
            runQuery('INSERT INTO ownership_transaction_footnote (adsh, tnum, fnum) values ('+q(s.adsh)+(t+1)+','+trans.footnotes[tf].substr(1)+')'
             + ' on duplicate key update tnum = '+(t+1));
        }
    }
}

function q(value, isLast){
    if(typeof value !== 'undefined' && value !== ''){
        return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'" + (isLast?'':',');
    } else {
        return ' null'+ (isLast?'':',');
    }
}

function runQuery(sql){
    try{
        let [result, fields] = await con.exec(sql);
    } catch(err) {
        console.log(sql);
        logEvent("fatal MySQL error", sql, true);
        throw err;
    }
    return {data: result, fields: fields}
}

function logEvent(type, msg, display){
    runQuery("insert into eventlog (event, data) values ("+q(type)+q(msg, true)+")");
    if(display) console.log(type, msg);
}
