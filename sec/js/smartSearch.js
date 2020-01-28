"use strict";

var companyTickers = false;  //will be an array of arrays: [cik, 'ticker', 'company name']
var companyTicker = {
    CIK:0,
    TICKER:1,
    COMPANY:2
};

$(document).ready(function(){
    //add key press to capture CR
    $('#global-search-box')
        .on('keydown', function(event){
           if(event.keyCode==13 || event.keyCode==27){  //return or ESC
               hideCompanyHints();
           } else {
               getCompanyHints(this,$(this).val())
           }
        })
        //.blur(function(){setTimeout(hideCompanyHints,500)})
        .after(
            '<div class="rel-none container"><div class="entity-hints border border-dark border-top-0 rounded-bottom">' +
            '<table width="100%" class="table table-hover entity-hints"></table>' +
            '</div></div>')
        .closest('.search-box-container')
        .css('position','relative');
    //hack because Fontastic not installed on PublicData.guru
    $('div.search-box-container span.button-label')
        .removeClass('fa-search')
        .html('<img src="/sec/global/images/search.png">');
    //disclaimer / warning
    $('#global-header .banner-org-name a').css("color","red").html('SEARCH DEMO: NOT OFFICIAL WEBSITE');
});


function getCompanyHints(control, keysTyped){
    if(keysTyped && keysTyped.trim()){
        const hintsURL = 'https://search.publicdata.guru/search-index';
        const label = 'ajax call to ' + hintsURL + ' for suggestion for "' + keysTyped + '"';
        console.time(label);
        var start = new Date();
        $.ajax({
            data: JSON.stringify({keysTyped: keysTyped}),
            dataType: 'JSON',
            type: 'POST',
            url: hintsURL,
            success: function (data, status) {
                let end = new Date();
                console.timeEnd(label);
                console.log('round-trip execution time for '+hintsURL+ ' = '+((new Date()).getTime()-start.getTime())+' ms');
                console.log(data);
                var hints = data.hits.hits;
                var hintDivs = ['<tr><th colspan="2">Select below to jump to EDGAR filings</th>'];
                var rgxKeysTyped = new RegExp('('+keysTyped.trim()+')','gi');
                if(hints.length){
                    for(var h=0;h<hints.length;h++){
                        const CIK = hints[h]._id,
                            entityName = hints[h]._source.entity,
                            href = 'https://www.sec.gov/cgi-bin/browse-edgar?CIK='+CIK+'&Find=Search&owner=exclude&action=getcompany';
                        hintDivs.push('<tr class="hint" data="'+ entityName + ' (CIK '+formatCIK(CIK)+')"><td class="hint-entity">'
                            + '<a href="'+href+'">'+(entityName||'').replace(rgxKeysTyped, '<b>$1</b>')+'</a>'
                            + '</td><td class="hint-cik"><a href="'+href+'">' + ((' <i>CIK '+ formatCIK(CIK)+'</i>')||'')+'</a></td></tr>');
                    }
                    $('table.entity-hints').find('tr').remove().end().html(hintDivs.join('')).show().find('tr.hint')
                        .click(function(evt){hintClicked(this)});
                    $('div.entity-hints').show();
                } else {
                    hideCompanyHints();
                }
            },
            error: function (jqXHR, textStatus, errorThrown) {
                hideCompanyHints();
                console.log(textStatus);
                throw(errorThrown);
            }
        });
    } else {
        hideCompanyHints();
    }

    function formatCIK(unpaddedCIK){ //accept int or string and return string with padded zero
        return '0'.repeat(10-unpaddedCIK.toString().length) + unpaddedCIK.toString()
    }
}

function hintClicked(row){
    console.log('hintClicked', (new Date()).getTime());
    var $row = $(row);
    $('.entity').val($(row).attr('data'));
    hideCompanyHints();
}
function hideCompanyHints(){
    $('div.entity-hints').hide();
}


