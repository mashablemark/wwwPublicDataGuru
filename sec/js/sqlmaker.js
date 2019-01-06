"use strict";
/**
 * Created by Mark Elbert on 8/15/2018.
 * creates and displays the SQL to create the tables for SUB, TAG, NUM and PRE ingestion
 */


var config = {
    filings: {
        file: 'filingsReadme.htm',
        prefix: 'f_',
        tables: {
            SUB: 1,
            TAG: 2,
            NUM: 3,
            PRE: 4
        }
    },
    filingNotes: {
        file: 'filingsNotesReadme.htm',
        prefix: 'fn_',
        tables: {
            SUB: 1,
            TAG: 2,
            DIM: 3,
            NUM: 4,
            TXT: 5,
            REN: 6,
            PRE: 7,
            CAL: 8
        }
    }
},
xbrlTableColumns = {
    name: 1,  //0 is a blank spacing column
    desc: 2,
    source: 3,
    format: 3,
    size: 4,
    nullable: 5,
    pk: 6
};

$(document).ready(function(){
    var dataset;
    if(getQueryStringValue('notes').toLowerCase()=='true'){
        dataset = 'filingNotes';
        $('#readmelink').attr('href','http://publicdata.tech/filingsNotesReadme.htm').html('XBRL Filings with Notes');
        $('#otherddl').attr('href','sqlmaker.html').html('DDL for XBRL Filings without Notes');
    } else {
        dataset = 'filings';
    }
    var    xbrlTableIndex = config[dataset].tables,
        prefix = config[dataset].prefix;
    $.get({url: config[dataset].file,
        type: "GET",
        contentType: "application/x-www-form-urlencoded;charset=windows-1252",
        success: function(data) {
        data = data.replace(/&nbsp;/g, " ").replace(/\ufffd/g, "'");
        var $tables = $(data).find('table');
        var html = '';
        for(var tableName in xbrlTableIndex){
            var primaryKeyFields = [];

            html += 'CREATE TABLE IF NOT EXISTS ' + prefix + tableName.toLowerCase() + ' (<br>';
            var $rows = $($tables[xbrlTableIndex[tableName]]).find('tbody tr');
            for(var i = 0; i < $rows.length; i++){
                var $thisRow = $($rows[i]);
                //SUB table has an extra SOURCE column that needs to be removed for consistency
                if(tableName == 'SUB'){
                    $thisRow.find('td:nth-of-type(' + xbrlTableColumns['source'] + ')').remove();
                }
                //figure out SQL field type
                var format = $thisRow.find('td:nth-of-type(' + xbrlTableColumns['format'] + ')').text().trim();
                var fieldKeyword = format.split(' ')[0], sqlFieldType;
                switch(fieldKeyword){
                    case 'HEXADECIMAL':
                    case 'ALPHANUMERIC':
                    case 'ALPHANUMERIC,':
                    case 'ALPHANUMERIC(255)':
                        sqlFieldType = ' varchar(' + $thisRow.find('td:nth-of-type(' + xbrlTableColumns['size'] + ')').text().trim() + ') ';
                        break;
                    case 'NUMERIC(28,4)':
                        sqlFieldType = ' DECIMAL(28,4) ';
                        break;
                    case 'NUMERIC':
                    case 'NUMERIC(4,0)':
                    case 'NUMERIC(1,0)':
                        sqlFieldType = ' INT ';
                        break;
                    case 'DATE':
                    case 'DATETIME':
                        sqlFieldType = ' DATE ';
                        break;
                    case 'YEAR':
                        sqlFieldType = ' INT ';
                        break;
                    case 'BOOLEAN':
                        sqlFieldType = ' BOOLEAN ';
                        break;
                    case 'REAL':
                        sqlFieldType = ' DECIMAL(6,5) ';
                        break;
                    default:
                        throw('unknown field type');
                }
                var fieldName = $thisRow.find('td:nth-of-type(' + xbrlTableColumns['name'] + ')').text().trim(),
                    nullable = ($thisRow.find('td:nth-of-type(' +  xbrlTableColumns['nullable'] + ') p').text().trim()=='No'?' NOT':''),
                    desc = $thisRow.find('td:nth-of-type(' +  xbrlTableColumns['desc'] + ')').text().trim().replace(/'/g, '\\' + '\'');
                if($thisRow.find('td:nth-of-type(' +  xbrlTableColumns['pk'] + ')').text().trim()=='*') primaryKeyFields.push(fieldName);
                html += '  ' + fieldName  + sqlFieldType + nullable + ' NULL ' + ' COMMENT \'' + desc + '\',<br>';
                //if($thisRow('td:nth-of-type(' + xbrlTableColumns['pk'] + ')').html()) primaryKeyFields.push(fieldName)
            }
            html = html.slice(0,-5);
            html += '<br>);<br><br>';

            html += 'ALTER TABLE ' + prefix + tableName.toLocaleLowerCase() + ' ADD PRIMARY KEY (';
            for(var j=0; j<primaryKeyFields.length;j++){
                html += primaryKeyFields[j] + (j != primaryKeyFields.length-1?', ':'');
            }
            html += ');<br><br>';
        }
        $('div.ddl').html(html);
    }});
});

function getQueryStringValue (key) {
    return decodeURIComponent(window.location.search.replace(new RegExp("^(?:.*[&\\?]" + encodeURIComponent(key).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"), "$1"));
}