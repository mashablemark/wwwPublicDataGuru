"use strict";

(function (){
    if (document.readyState != 'loading'){
        enableSmartSearch();
    } else {
        document.addEventListener('DOMContentLoaded', enableSmartSearch);
    }

    function enableSmartSearch(){
        var searchForm = document.querySelector('form[action="/cgi-bin/browse-edgar"]'),
            formRow = searchForm.querySelector('table tr');

        //remove the following after form is updated in the Perl script
        formRow.insertCell(-1).innerHTML = '<label for="keywords">Keywords:</label><br>'
            + '<input name="search_text" id="keywords" size="10" tabindex="2" style="width:300px;">';
        searchForm.setAttribute('action', 'https://www.sec.gov/cgi-bin/browse-edgar');



        searchForm.addEventListener('submit', function(event){
            var formValues = {},
                fullTextUrl = 'https://www.publicdata.guru/sec/edgar_full_text_search.html?r=el#/';
            for(var e in searchForm.elements)
                formValues[searchForm.elements[e].name] = searchForm.elements[e].value;

            if(formValues.search_text){
                formValues.entityName = document.querySelector('.companyName').innerText.replace(/CIK#: (\d{10}) \(see all company filings\)/, ' (CIK $1)');
                var startDt = formValues.dateb || '1995';
                formValues.startdt = parseInt(startDt .substr(0,4))
                    + '-' + (startDt .length>5?startDt .substr(4,2) :'01')
                    + '-' + (startDt .length>7?startDt .substr(6,2) :'01');
                formValues.endate = formatDate(new Date()); //today
                if(formValues.dateb){
                    formValues.dateRange = 'custom';
                    delete formValues.dateb;
                } else {
                    formValues.dateRange = 'all';
                }
                formValues.q = formValues.search_text;
                delete formValues.search_text;
                for(let name in formValues){
                    switch(name){
                        case "CIK":
                            fullTextUrl += '&ciks=' + encodeURIComponent(formValues[name]);
                            break;
                        case "type":
                            fullTextUrl += '&forms=' + encodeURIComponent(formValues.type.trim());
                            fullTextUrl += '&category=custom';
                            break;
                        case "action":
                            break;
                        default:
                            fullTextUrl += '&' + name + '=' + encodeURIComponent(formValues[name]);
                    }
                }
                event.preventDefault();
                window.location = fullTextUrl;
                return false;
            } else {
                document.querySelector('form').submit();
            }
        });

        function formatDate(dateOrString){
            var dt = new Date(dateOrString),
                yyyy=dt.getUTCFullYear(),
                m=dt.getUTCMonth()+1,
                d=dt.getUTCDate();
            return yyyy+'-'+(m<10?'0'+m:m)+'-'+(d<10?'0'+d:d);
        }
    }
})();

