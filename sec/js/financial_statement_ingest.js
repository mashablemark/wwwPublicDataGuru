"use strict";
/**
 * Created by Mark Elbert on 8/16/2018.
 *
 * 0. determine first file that processing and use a series of callbacks to
 * 1. download the file
 * 2. ungzip the file
 * 3. untar the file
 * 4. for each table (sub, tag, pre, num in that order)
 *   a. remove PK
 *   b. ingest data
 *   c. restore PK
 * 5. execute step 0 after last asyn callback
 */


$(document).ready(function() {
    $('div.fileList').html($('div.fileList td.list').html());
    $('div.ingested table tbody').html($('div.ingested table tbody').html().replace(/_/g,' '));
    var oFileToProcess = findFirstUnprocessedFile();
    if(oFileToProcess) {
        addDropPrimaryKeys(false, function() {ingest(oFileToProcess)});
    }
});

var oFilingBeingProcessed,
    prefix = 'f_',
    datasetTables = {
        'f_': ['f_sub', 'f_tag', 'f_num'], //, 'f_pre'],
        'fn_': ['fn_sub', 'fn_tag', 'fn_dim', 'fn_num', 'fn_txt', 'fn_ren', 'fn_pre', 'fn_cal']
    };


function findFirstUnprocessedFile(){
    var oFiling = false;
    $('div.fileList tbody tr').each(function (index){
        if(!oFiling){
            var $a = $(this).find('td a'),
                filingPeriod = $a.html().trim(),
                fileURL = 'https://www.sec.gov' + $a.attr('href');
            //try to find in processed table
            var $tdProcess = $('div.ingested table tbody').find("td.name:contains('"+ filingPeriod +"')");
            if($tdProcess.length==0){
                oFiling = {
                    period: filingPeriod,
                    fileURL: fileURL,
                    prefix: prefix,
                    dir: prefix + filingPeriod.replace(' ', '_')
                };
                console.log('Starting processing of ' + oFiling.dir);
            }
        }
    });
    return oFiling;
}


function addDropPrimaryKeys(add, success){
    success();
    return;
    //if add is false remove
    var dummyFilingObject = {};
    if(add){
        invokeServerProcess('addFilingIndexes' ,dummyFilingObject, function(){success()});
    } else {
        invokeServerProcess('dropFilingIndexes' ,dummyFilingObject, function(){success()});
    }
}

function ingest(oFile){
    //determine state and execute in order:  start download; verify download; start unzip; verify unzip; (ingest, verify and add PK) for sub, tag, num tables; done = findFirstUnprocessedFile
    if(!oFile.download || oFile.download=='requested'){
        oFile.download = 'requested';
        writeHtmlProcessStatus(oFile);
        writeDbProcessStatus(oFile);
        oFilingBeingProcessed = oFile;
        fetchFile(oFile, function(){
                oFile.download = 'downloaded';
                oFile.unzip = 'unzipping';
                writeHtmlProcessStatus(oFile);
                writeDbProcessStatus(oFile);
                ingest(oFile)}
        );
        return oFile;
    }
    if(!oFile.unzip  || oFile.unzip == 'unzipping'){
        writeHtmlProcessStatus(oFile);
        oFilingBeingProcessed = oFile;
        unzipFile(oFile, function(){
            oFile.unzip = 'unzipped';
            writeHtmlProcessStatus(oFile);
            writeDbProcessStatus(oFile);
            ingest(oFile)
        });
        return oFile;
    }
    if(!oFile.ingestState  || oFile.ingestState!='complete'){
        var i,
            tables = datasetTables[prefix];
        if(!oFile.ingest) {
            i=0;
        } else {
            i = tables.indexOf(oFile.ingest);
            if (i == -1) throw('error in table processing');
            i++;
        }
        if(i == tables.length){
            oFile.ingestState = 'complete';
            oFile.ingest = '';
            writeHtmlProcessStatus(oFile);
            writeDbProcessStatus(oFile);
            removedUnzippedFiles(oFile);  //aysnc call
             if (oFilingBeingProcessed = findFirstUnprocessedFile()) {
                ingest(oFilingBeingProcessed);
            } else {
                 console.log('ALL INGESTED!!! (about to add PKs and indexes)');
                 invokeServerProcess('archiveToS3' ,{}, function(){  //free space on EBS
                     console.log("archived to S3");
                     addDropPrimaryKeys(true, function() {
                         console.log('DONE INGESTING!!!');
                         console.log('need to call makeStandardTags() and makeTimeSeries()');
                     });
                 });
             }
        } else {
            oFile.ingest = tables[i];
            oFile.dropPK = false;  //see if is it faster !(oFile.ingest == 'f_tag' || oFile.ingest == 'fn_tag') ; //
            oFile.ingestState = 'ingesting ';
            console.log(oFile.ingestState + oFile.ingest.toUpperCase());
            writeHtmlProcessStatus(oFile);
            writeDbProcessStatus(oFile);
            if(oFile.dropPK) {
                dropPrimaryKey(oFile, function(){
                    ingestTable(oFile, function () {
                        oFile.ingestState = 'adding PK to ';
                        writeHtmlProcessStatus(oFile);
                        writeDbProcessStatus(oFile);
                        addPrimaryKey(oFile, function () {
                            ingest(oFile);
                        })
                    });
                });
            } else {
                ingestTable(oFile, function () {
                    writeHtmlProcessStatus(oFile);
                    writeDbProcessStatus(oFile);
                    ingest(oFile);
                });
            }
        }
    }
}
//state helper functions
function writeHtmlProcessStatus(oFiling){
    var $trFiling,
        $tdProcess = $('div.ingested table tbody').find("td.name:contains('"+ oFiling.period +"')");
    if($tdProcess.length == 0){
        $trFiling = $('div.ingested table tbody').append(
            '<tr>' +
            '  <td class="name">' + oFiling.period + '</td>' +
            '  <td class="size"></td>' +
            '  <td class="downloaded"></td>' +
            '  <td class="unarchived"></td>' +
            '  <td class="ingested"></td>' +
            '</tr>'
        ).find('tr:last');
    } else {
        $trFiling = $tdProcess.parent();
    }
    $trFiling.find('td.downloaded').html(oFiling.download || '');
    $trFiling.find('td.downloaded').html(oFiling.download || '');
    $trFiling.find('td.unarchived').html(oFiling.unzip || '');
    $trFiling.find('td.ingested').html((oFiling.ingestState || '') + (oFiling.ingest || ''));
}

function fetchFile(oFiling, success){
    invokeServerProcess('fetchFile', oFiling, function(){success()})
}
function unzipFile(oFiling, success){
    invokeServerProcess('unzipFile', oFiling, function(){success()})
}
function ingestTable( oFiling, success){
    invokeServerProcess('ingestTable', oFiling, function(){success()})
}
function addPrimaryKey( oFiling, success){
    invokeServerProcess('addPrimaryKey' ,oFiling, function(){success()})
}
function dropPrimaryKey( oFiling, success){
    invokeServerProcess('dropPrimaryKey' ,oFiling, function(){success()})
}

function removedUnzippedFiles(oFiling){//reads
    invokeServerProcess('removedUnzippedFiles', oFiling);  //executed async = no callBack
}

function writeDbProcessStatus(oFiling){//reads
    invokeServerProcess('updateDb', oFiling)
}

function readHtmlProcessStatus(oFiling){//reads
}

function invokeServerProcess(process, oFiling, success){
    oFiling.process = process;
    console.log('invoking server process ' + process);
    $.ajax({
        dataType: 'JSON',
        url: "/sec/api.php",   //"http://maker.publicdata.guru/sec/api.php", new server before transerrin DNS
        type: 'post',
        data: oFiling,
        success: function (data, status) {
            console.log(data);
            if(success) success();
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.log(jqXHR);
            console.log(textStatus);
            throw(errorThrown);
        }
    });
}