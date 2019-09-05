"use strict";

var companyTickers = false;  //will be an array of arrays: [cik, 'ticker', 'company name']
var companyTicker = {
    CIK:0,
    TICKER:1,
    COMPANY:2
};

$(document).ready(function(){
    $('<td><label for="keywords">Keywords:</label><br><input name="keywords" id="keywords" size="10" tabindex="2"></td>').insertAfter($('#prior_to').closest('td'));
    $('<button id="smartSearch">Smart Search</button>').insertAfter($("input[value='Search']"));
    $('#smartSearch').click(function(){
       var urlParams = new URLSearchParams(window.location.search),
           keyWords = $('#keywords').val().trim(),
           cik = urlParams.get('CIK');
       if(keyWords){
           var type = $('input#type').val().trim(),
               priorTo = $('input#prior_to').val().trim(),
               fromDate = false,
               qstring = '?stemming=false&nummResults=20&queryCik='+cik+'&search_text='+encodeURIComponent(keyWords.replace(/\s+/g,' AND '));
           if(priorTo && priorTo.length>3 && !isNaN(priorTo)){
               fromDate = parseInt(priorTo.substr(0,4));
               if(priorTo.length>5)
                   fromDate = priorTo.substr(4,2) + '/' + fromDate;
               else
                   fromDate = '01/' + fromDate;
               if(priorTo.length>7)
                   fromDate = priorTo.substr(6,2) + '/' + fromDate;
               else
                   fromDate = '01/' + fromDate;
               let now = new Date();
               qstring += '&fromDate='+ fromDate + '&toDate=12/31/'+now.getFullYear();
           }
           //window.location = 'https://searchwww.sec.gov/EDGARFSClient/jsp/EDGAR_MainAccess.jsp'+qstring;
       } else {
           $('form').get(0).submit();
       }
    }).closest('form'); //.removeAttr('action');
    $("input[value='Search']").remove();
});

function takeOverSearch(){
    document.body.removeEventListener
    $(document.body).on('change', '#edit-field-meeting-category-value', function () {
        $(this).closest('form').submit();
    });

}

function smartSearch(searchTerms){
    var i, awaitingUserInput = false;
    //1.  check if accession number format
    if(searchTerms.search(/\b\d{10}-\d{2}-\d{6}\b/) != -1){
        $.get(
            `/sec/getedgarfile.php?f=${encodeURIComponent('https://www.sec.gov/sws/edgar/filing/'+searchTerms+'/filerXref')}`,
            function(data){
                let $data = $(data);
                confirmSmartChoice(searchTerms,
                    `Are you looking for the filing (accession number ${searchTerms}) for ${$data.find('entityName').text()}?`,
                    `https://www.sec.gov/Archives/edgar/data/${$data.find('cik:first').text()}/${searchTerms.replace(/-/g,'')}/${searchTerms}-index.html`);
            }
        );
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
                    confirmSmartChoice(searchTerms, `Are you looking for the filings for ${company} (CIK ${cik}?`, `https://www.sec.gov/cgi-bin/browse-edgar?CIK=${cik}&owner=exclude&action=getcompany&Find=Search`);
                    return;  //no more processing until user answers popup
                }
            }
        )
    }
    //3. check if ticker
    if(searchTerms.length<=8 && companyTickers){
        for(i=0; i<companyTickers.length; i++){
            if(companyTickers[i][companyTicker.TICKER]==searchTerms.toUpperCase()){
                awaitingUserInput = true;
                confirmSmartChoice(searchTerms, `Are you looking for the filings for ${companyTickers[i][companyTicker.COMPANY]} (${companyTickers[i][companyTicker.TICKER]}?`, `https://www.sec.gov/cgi-bin/browse-edgar?CIK=${companyTickers[i][companyTicker.CIK]}&owner=exclude&action=getcompany&Find=Search`);
                return;  //no more processing until user answers popup
            }
        }
    }
    //4.  check if company name
    if(searchTerms.length<=8 && companyTickers){
        for(i=0; i<companyTickers.length; i++){
            if(companyTickers[i][companyTicker.COMPANY].toLowerCase().indexOf(searchTerms.toLowerCase())!=-1){
                awaitingUserInput = true;
                confirmSmartChoice(searchTerms, `Are you looking for the filings for ${companyTickers[i][companyTicker.COMPANY]} (${companyTickers[i][companyTicker.TICKER]})?`, `https://www.sec.gov/cgi-bin/browse-edgar?CIK=${companyTickers[i][companyTicker.CIK]}&owner=exclude&action=getcompany&Find=Search`);
                return;  //no more processing until user answers popup
            }
        }
    }
    //no special cases detected => normal search
    window.location.href = 'https://secsearch.sec.gov/search?utf8=%3F&affiliate=secsearch&query='+ encodeURI(searchTerms);
}

function confirmSmartChoice(searchTerms, question, smartChoiceUrl) {
    //popup dialog with yes, no.  if yes
    $('<div id="dialog-confirm" title="Search EDGAR archives or SEC web pages?"><p>'
        + question + '</p></div>')
        .dialog({
        resizable: false,
        height: "auto",
        width: 400,
        modal: true,
        buttons: {
            "Yes, search EDGAR for filings": function() {
                $( this ).dialog( "close" );
                window.location.href =  smartChoiceUrl;
            },
            "No, search the SEC web pages": function() {
                $( this ).dialog( "close" );
                window.location.href = 'https://secsearch.sec.gov/search?utf8=%3F&affiliate=secsearch&query='+ encodeURI(searchTerms);
            }
        }
    });
}

