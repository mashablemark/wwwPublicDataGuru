"use strict";

var companyTickers = false;  //will be an array of arrays: [cik, 'ticker', 'company name']
var companyTicker = {
    CIK:0,
    TICKER:1,
    COMPANY:2
};

$(document).ready(function(){
    $.getJSON('/sec/company_tickers.json', function(data){
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
    $('div.search-box-container span.button-label')
        .removeClass('fa-search')
        .html('<img src="/sec/global/images/search.png">');
    $('#global-header .banner-org-name a').css("color","red").html('SEARCH DEMO: NOT OFFICIAL WEBSITE');


});


function smartSearch(searchTerms){
    var i, awaitingUserInput = false;
    $('body').mask();
    //1.  check if accession number format
    if(searchTerms.search(/\b\d{10}-\d{2}-\d{6}\b/) != -1){
        $.get(
            `/sec/getWebDoc.php?f=${encodeURIComponent('https://www.sec.gov/sws/edgar/filing/'+searchTerms+'/filerXref')}`,
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
        //2a. check if in ticker symbols file = already downloaded = faster for most commonly requested CIKs
        var searchCik = parseInt(searchTerms),
            cikMatch = false;
        if(companyTickers) {
            for (i = 0; i < companyTickers.length; i++) {
                //ticker match check
                if (companyTickers[i].cik == searchCik) {
                    cikMatch = companyTickers[i];
                    break;
                }
            }
        }
        if(cikMatch){
            confirmSmartChoice(searchTerms, `Are you looking for the filings for ${cikMatch.name} (CIK ${cikMatch.cik})?`,
                `smartSearchCompanyLanding.php?CIK=${cikMatch.cik}`);

        } else {
            //2b.  requested CIK not found in ticker file, so check SEC's edgarcompany search
            $.get(
                `/sec/getWebDoc.php?f=${encodeURIComponent('https://www.edgarcompany.sec.gov/servlet/CompanyDBSearch?page=detailed&cik='+ searchCik +'&main_back=2')}`,
                function(data){
                    if(data.indexOf('The selected company was not found')==-1 && data.indexOf('httpGet failed')==-1){
                        awaitingUserInput = true;
                        var $results = $(data);
                        var $companyTable = $results.find('table table table');
                        var company = $companyTable.find('tr:eq(1) td.c2').html().trim();
                        var cik = $companyTable.find('tr:eq(2) td.c2').html().trim();
                        confirmSmartChoice(searchTerms, `Are you looking for the filings for ${company} (CIK ${cik})?`,
                            `smartSearchCompanyLanding.php?CIK=${cik}`);
                    } else {
                        window.location.href = 'https://secsearch.sec.gov/search?utf8=%3F&affiliate=secsearch&query='+ encodeURI(searchTerms);
                    }
                }
            );
        }
        return;  //no more processing until user answers popup
    }
    //3. check if matches (a) ticker or (b) company name
    if(companyTickers){
        var matches = [],
            tickerMatch = false,  //separate the two so exact ticker matches are on top
            searchWords = searchTerms.replace(/\s+/g, ' ').toUpperCase().split(' ');
        for(i=0; i<companyTickers.length; i++){
            //ticker match check
            if(companyTickers[i].ticker==searchTerms.toUpperCase()){
                tickerMatch = companyTickers[i];
            }
            //company name match check
            if(searchWords.length>1 || searchWords.length==1 && searchWords[0].length>1){  //if search phrase is a single letter, don't try to find name matches (only ticker matches)
                var uName = ' ' + companyTickers[i].name.toUpperCase() + ' ';
                for(var j=0; j<searchWords.length; j++){ //all keywords must be found
                    if(uName.indexOf(' '+searchWords[j]+' ')==-1) break;
                }
                if(j==searchWords.length) matches.push(companyTickers[i]);
            }
        }
        if(matches.length || tickerMatch){
            awaitingUserInput = true;
            matches = matches.slice(0,9);
            if(tickerMatch) matches.unshift(tickerMatch);  //show exact ticker match first, if found
            confirmSmartChoice(searchTerms, 'Are you looking for filings for:', matches);
            return;  //no more processing until user answers popup
        }
    }
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
            window.location.href =  `smartSearchCompanyLanding.php?CIK=${company.cik}`;
        }
    }
    if(Array.isArray(smartChoiceUrl)){
        for(var i=0;i<smartChoiceUrl.length;i++){
            popup.buttons[smartChoiceUrl[i].name + ' ('+smartChoiceUrl[i].ticker+')'] = buttonClick(smartChoiceUrl[i])
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
    var $dialog = $('<div id="dialog-confirm" title="Search EDGAR archives or SEC web pages?"><p>'
        + question + '</p></div>')
        .dialog(popup).closest('.ui-dialog');
    $dialog.find('.ui-dialog-titlebar').attr('style', 'background-color:#273a56;color:white;');
    $dialog.find('button').attr('style', 'display:block;');
    $dialog.find('.ui-dialog-buttonpane .ui-dialog-buttonset').attr('style', 'float:left;');
    $dialog.find('.ui-dialog-buttonpane').attr('style', 'border:none;margin-top:0;padding-top:0;');
    $dialog.find('button:last').attr('style', 'display:block;background-color:#2e63b1;color:white');
}

