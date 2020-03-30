"use strict";

(function (){
    if (document.readyState != 'loading'){
        ready();
    } else {
        document.addEventListener('DOMContentLoaded', enableSmartSearchEntitySuggestions);
    }
})();

function enableSmartSearchEntitySuggestions(){
    //add key press to capture CR
    var UP_ARROW = 38,
        DOWN_ARROW = 40,
        CARRIAGE_RETURN = 13,
        TAB = 9,
        ESCAPE = 27;
    var globalSearchBox = document.getElementById('global-search-box');
    globalSearchBox.addEventListener('keydown',
        function(event) { //capture tab on keydown as focus is lost before keyup can fire
            var keyCode = event.keyCode || event.which;
            if(keyCode==TAB || keyCode == CARRIAGE_RETURN) {
                var selectedHint = document.querySelector('table.smart-search-entity-hints tr.smart-search-hint.smart-search-selected-hint');
                if(selectedHint){
                    event.stopPropagation();
                    selectedHint.querySelector('a').click();
                }
            }
        });
    globalSearchBox.addEventListener('keyup',
        function(event){
            var keyCode = event.keyCode || event.which;
            if(keyCode==ESCAPE){  //return or ESC
                hideCompanyHints();
            } else {
                if(keyCode!=TAB && keyCode!=CARRIAGE_RETURN && keyCode!=UP_ARROW && keyCode != DOWN_ARROW){
                    getCompanyHints(this, globalSearchBox.value)
                }
            }
            var hintCount = document.querySelectorAll('table.smart-search-entity-hints tr.smart-search-hint').length;
            if(hintCount && (keyCode == UP_ARROW || keyCode == DOWN_ARROW)){  //up arrow or down arrow
                var oldSelected = document.querySelector('table.smart-search-entity-hints tr.smart-search-hint.smart-search-selected-hint');
                if (oldSelected) oldSelected.className = 'smart-search-hint';
                 var newSelectedIndex = Math.min(Math.max((oldSelected ? oldSelected.rowIndex -1 : -1) + (keyCode==UP_ARROW?-1:1) ,0), hintCount-1);
                document.querySelectorAll('table.smart-search-entity-hints tr.smart-search-hint').item(newSelectedIndex).className ='smart-search-hint smart-search-selected-hint';
            }
        });
    var hintsContainer = document.createElement('div');
    hintsContainer.className = "smart-search-rel-none container";
    hintsContainer.innerHTML = '<div class="smart-search-entity-hints border border-dark border-top-0 rounded-bottom">' +
        '<table width="100%" class="table table-hover smart-search-entity-hints"></table>' +
        '</div>';
    globalSearchBox.insertAdjacentElement('afterend', hintsContainer);

    function getCompanyHints(control, keysTyped){
        if(keysTyped && keysTyped.trim()){
            const hintsURL = 'https://search.publicdata.guru/search-index';
            const label = 'ajax call to ' + hintsURL + ' for suggestion for "' + keysTyped + '"';
            console.time(label);
            var start = new Date();
            var request = new XMLHttpRequest();
            request.open('POST', hintsURL, true);
            request.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
            request.onload = function() {
                if (this.status >= 200 && this.status < 400) {
                    var data = JSON.parse(this.response);
                    var end = new Date();
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
                            hintDivs.push('<tr class="smart-search-hint" data="'+ entityName + ' (CIK '+formatCIK(CIK)+')"><td class="smart-search-hint-entity">'
                                + '<a href="'+href+'">'+(entityName||'').replace(rgxKeysTyped, '<b>$1</b>')+'</a>'
                                + '</td><td class="smart-search-hint-cik"><a href="'+href+'">' + ((' <i>CIK '+ formatCIK(CIK)+'</i>')||'')+'</a></td></tr>');
                        }
                        var hintsTable = document.querySelector('table.smart-search-entity-hints');
                        hintsTable.innerHTML = hintDivs.join('');
                        for( var r=0; r< hintsTable.rows.length; r++){
                            hintsTable.rows[r].addEventListener('click', hintClick)
                        }
                        document.querySelector('div.smart-search-entity-hints').style.display = 'block';
                    } else {
                        hideCompanyHints();
                    }
                } else {
                    console.log('error fetching from '+hintsURL+'; status '+this.status);
                }
            };
            request.onerror = function() {
                console.log('error connectiing to '+hintsURL);
            };
            request.send(JSON.stringify({keysTyped: keysTyped, narrow: true}));
        } else {
            hideCompanyHints();
        }

        function formatCIK(unpaddedCIK){ //accept int or string and return string with padded zero
            return '0'.repeat(10-unpaddedCIK.toString().length) + unpaddedCIK.toString()
        }

        function hintClick(evt){
            this.querySelector('a').click();
        }
    }

    function hideCompanyHints(){
        var hintContainer = document.querySelector('div.smart-search-entity-hints');
        hintContainer.style.display = 'none';
        hintContainer.querySelector('table.smart-search-entity-hints').innerHTML = '';  //remove the hint rows
    }
}



