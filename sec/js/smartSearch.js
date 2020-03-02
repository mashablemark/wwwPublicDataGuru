"use strict";

var companyTickers = false;  //will be an array of arrays: [cik, 'ticker', 'company name']
var companyTicker = {
    CIK:0,
    TICKER:1,
    COMPANY:2
};
var $ = jQuery.noConflict();
$(document).ready(function(){
    //add key press to capture CR
    $('#global-search-box')
        .keydown(function(event) { //capture tab on keydown as focus is lost before keyup can fire
            var keyCode = event.keyCode || event.which;
            if(keyCode==9 || keyCode == 13) {
                var $selected = $('table.entity-hints tr.hint.selected-hint');
                if($selected.length){
                    event.stopPropagation();
                    $selected.find('td.hint-entity a').click();
                }
            }
        })
        .on('keyup', function(event){
            var keyCode = event.keyCode || event.which;
            if(keyCode==27){  //return or ESC
                hideCompanyHints();
            } else {
                if(keyCode!=9 && keyCode!=13 && keyCode!=38 && keyCode != 40){
                    getCompanyHints(this, $(this).val())
                }
            }
            var hintCount = $('table.entity-hints tr.hint').length;
            if(hintCount && (keyCode == 38 || keyCode == 40)){  //up arrow or down arrow
                var currentSelectedIndex = $('table.entity-hints tr.hint.selected-hint').removeClass('selected-hint').index()-1,
                    newSelectedIndex = Math.min(Math.max(currentSelectedIndex + (keyCode==38?-1:1) ,0), hintCount-1);
                $('table.entity-hints tr.hint:eq('+newSelectedIndex+')').addClass('selected-hint');
            }
        })
        //.blur(function(){setTimeout(hideCompanyHints,500)})
        .after(
            '<div class="rel-none container"><div class="entity-hints border border-dark border-top-0 rounded-bottom">' +
            '<table width="100%" class="table table-hover entity-hints"></table>' +
            '</div></div>')
        .closest('.search-box-container');
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
            data: JSON.stringify({keysTyped: keysTyped, narrow: true}),
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
                            href = 'smartSearchCompanyLanding.php?CIK='+CIK;
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
    var a = $(row).find('a:first').get(0);
    a.click();  //javascript event; firing the jQuery event errored out (due to conflicting libraries?)
}

function hideCompanyHints(){
    $('div.entity-hints').hide().find('tr.hint').remove();
}


