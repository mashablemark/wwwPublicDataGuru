"use strict";

var companyTickers = false;  //will be an array of arrays: [cik, 'ticker', 'company name']
var companyTicker = {
    CIK:0,
    TICKER:1,
    COMPANY:2
};

$(document).ready(function(){
    $.getJSON('company_tickers.json', function(data){
        companyTickers = data;
    });
    //add key press to capture CR
    $('#global-search-box').on('keypress', function(event){
       if(event.keyCode==13){
           smartSearch($('#global-search-box').val());
           event.stopPropagation();
       }
    }).on('change', function(event){
        event.stopPropagation();
    });
    $('.global-search-button').removeAttr('type');

    //take over the search
    takeOverSearch();

    setTimeout(takeOverSearch, 100); //allow other script to run before double-checking the take-over


});

function takeOverSearch(){
    document.body.removeEventListener
    $(document.body).on('change', '#edit-field-meeting-category-value', function () {
        $(this).closest('form').submit();
    });

}

function smartSearch(searchTerms){
    var i, awaitingUserInput = false;
    $('body').mask();
    //1.  check if accession number format
    if(searchTerms.search(/\b\d{10}-\d{2}-\d{6}\b/) != -1){
        $.get(
            `/sec/getedgarfile.php?f=${encodeURIComponent('https://www.sec.gov/sws/edgar/filing/'+searchTerms+'/filerXref')}`,
            function(data){
                let $data = $(data);
                confirmSmartChoice(searchTerms,
                    `Are you looking for the filing with accession number ${searchTerms} for ${$data.find('entityName').text()}?`,
                    `https://www.sec.gov/Archives/edgar/data/${$data.find('cik:first').text()}/${searchTerms.replace(/-/g,'')}/${searchTerms}-index.html`);
            }
        );
        return;  //no more processing until user answers popup
    }
    //2.  check if CIK
    if(!isNaN(searchTerms) && parseInt(searchTerms).toString()==searchTerms  && parseInt(searchTerms)>1000 && parseInt(searchTerms)<5*1000*1000){
        $.get(
            `/sec/getedgarfile.php?f=${encodeURIComponent('https://www.edgarcompany.sec.gov/servlet/CompanyDBSearch?page=detailed&cik='+parseInt(searchTerms)+'&main_back=2')}`,
            function(data){
                if(data.indexOf('The selected company was not found')==-1){
                    awaitingUserInput = true;
                    var $results = $(data);
                    var $companyTable = $results.find('table table table');
                    var company = $companyTable.find('tr:eq(1) td.c2').html().trim();
                    var cik = $companyTable.find('tr:eq(2) td.c2').html().trim();
                    confirmSmartChoice(searchTerms, `Are you looking for the filings for ${company} (CIK ${cik})?`,
                        `smartSearchCompanyLanding.php?CIK=${cik}`);
                 }
            }
        );
        return;  //no more processing until user answers popup
    }
    //3. check if matches ticker or company name
    if(companyTickers){
        var matches = [],
            searchWords = searchTerms.replace(/\s+/g, ' ').split(' '),
            rgxes = [];
        for(i=0; i<searchWords.length; i++){
            rgxes.push(new RegExp('\\b' + searchWords[i] + '\\b', 'i'));
        }
        for(i=0; i<companyTickers.length; i++){
            if(companyTickers[i][companyTicker.TICKER]==searchTerms.toUpperCase()){
                matches.push(companyTickers[i]);
                /*confirmSmartChoice(searchTerms,
                    `Are you looking for the filings for ${companyTickers[i][companyTicker.COMPANY]} (${companyTickers[i][companyTicker.TICKER]})?`,
                    `smartSearchCompanyLanding.php?CIK=${companyTickers[i][companyTicker.CIK]}`);
                return;  //no more processing until user answers popup */
            }
            for(var j=0;j<rgxes.length;j++){ //all keyword must be found
                if(!companyTickers[i][companyTicker.COMPANY].match(rgxes[j])) {
                    break;
                } else {
                    console.log(companyTickers[i][companyTicker.COMPANY]);
                }
            }
            if(j==rgxes.length)
                matches.push(companyTickers[i]);
        }
        if(matches.length){
            awaitingUserInput = true;
            confirmSmartChoice(searchTerms, 'Are you looking for filings for:', matches);
            return;  //no more processing until user answers popup
        }
    }
    //4.  check if company name
    /*if(searchTerms.length<=8 && companyTickers){
        for(i=0; i<companyTickers.length; i++){
            if(companyTickers[i][companyTicker.COMPANY].toLowerCase().indexOf(searchTerms.toLowerCase())!=-1){
                awaitingUserInput = true;
                confirmSmartChoice(searchTerms, `Are you looking for the filings for ${companyTickers[i][companyTicker.COMPANY]} (${companyTickers[i][companyTicker.TICKER]})?`,
                    `smartSearchCompanyLanding.php?CIK=${companyTickers[i][companyTicker.CIK]}`);
                return;  //no more processing until user answers popup
            }
        }
    }*/
    //no special cases detected => normal search
    window.location.href = 'https://secsearch.sec.gov/search?utf8=%3F&affiliate=secsearch&query='+ encodeURI(searchTerms);
}

function confirmSmartChoice(searchTerms, question, smartChoiceUrl) {
    //popup dialog with choices
    $('body').unmask();
    var popup = {
        resizable: false,
            height: "auto",
        width: 400,
        modal: true,
        buttons: {}
    };
    function buttonClick(company){
        return function(){
            $( this ).dialog( "close" );
            $('body').mask();
            window.location.href =  `smartSearchCompanyLanding.php?CIK=${company[companyTicker.CIK]}`;
        }
    }
    if(Array.isArray(smartChoiceUrl)){
        for(var i=0;i<smartChoiceUrl.length;i++){
            popup.buttons[smartChoiceUrl[i][companyTicker.COMPANY] + ' ('+smartChoiceUrl[i][companyTicker.TICKER]+')'] = buttonClick(smartChoiceUrl[i])
        }
    } else {
        popup.buttons['Yes, search EDGAR filings'] = function(){
            $( this ).dialog( "close" );
            $('body').mask();
            window.location.href =  smartChoiceUrl;
        }
    }
    popup.buttons["No, search the SEC web pages"] = function() {
        $(this).dialog( "close" );
        $('body').mask();
        window.location.href = 'https://secsearch.sec.gov/search?utf8=%3F&affiliate=secsearch&query='+ encodeURI(searchTerms);
    };
    $('<div id="dialog-confirm" title="Search EDGAR archives or SEC web pages?"><p>'
        + question + '</p></div>')
        .dialog(popup);
}

