"use strict";

var entity = false;  //holds the entity info once selected
var categories = {};
var formTooltips = {};
var edgarLocations = {};

$(document).ready(function() {
    $('[data-toggle="tooltip"]').tooltip({classes: {"ui-tooltip":"popover"}});
    const hashValues = getHashAsObject();
    //load the state / locations drop down

    setDatesFromRange();

    //configure company hints event on both keywords and company text boxes
    $('.entity').keyup(function(event){ getCompanyHints(this, $(this).val())});
    $('#form-container').blur(hideCompanyHints);
    $('#form-container button, #form-container label, #form-container input:not(.entity)').focus(hideCompanyHints);

    //create the form categories from the forms array
    for(let i in forms){
        if(forms[i].category){
            if(!categories[forms[i].category]) categories[forms[i].category] = [];
            categories[forms[i].category].push(forms[i].form);
        }
        if(forms[i].description && forms[i].description.length) formTooltips[forms[i].form] = forms[i].description
    }
    //load form categories and configure selection event
    let categoryOptions = ['<option value="all" selected>View All</option>'];
    for(let cat in categories){
        categoryOptions.push('<option value="'+categories[cat].join(' ')+'">'+cat+'</option>');
    }
    categoryOptions.push('<option value="custom">User Defined</option>');

    const $filingTypes = $('#filing-types');
    const $category = $('#category-select') 
        .html(categoryOptions.join(''))
        .change(function(event){
            if($(this).val() !='custom') $filingTypes.val($category.val());
        });

    //configure the forms text event
    $filingTypes.keyup(function(){
        $category.prop('selectedIndex',categoryOptions.length-1);  //custom
    });

    //load locations selector and configure selection event
    const $locations = $('#location-select');
    const locationOptions = ['<option value="" selected>View All</option>'];
    for(let i=0;i<locationsArray.length;i++){
        locationOptions.push('<option value="'+locationsArray[i][0]+'">'+locationsArray[i][1]+'</option>');
        edgarLocations[locationsArray[i][0]] = locationsArray[i][1];
    }
    $locations.html(locationOptions.join(''));

    //configure date range buttonSet
    var $dateRangeSelect = $('#date-range-select').change(setDatesFromRange);
    //configure datapickers
    $('#date-from, #date-to').datepicker({
        changeMonth: true,
        changeYear: true,
        minDate: "1/1/1994",  //"-10Y" for production
        maxDate: new Date()
    });

    $('#date-from, #date-to').keyup(function(){
        //ensure from >= to
        var fromDate = new Date($('#date-from').val()),
            toDate = new Date($('#date-to').val());
        if(fromDate>toDate){
            if($(this).attr('id')=='date-to'){
                $('#date-from').val(toDate.toLocaleDateString());
            } else {
                $('#date-to').val(fromDate.toLocaleDateString());
            }
        }
        $dateRangeSelect.val('custom')
    });

    $('#form-container form').submit(executeSearch);

    $('#clear').click(function(){
        setTimeout(setDatesFromRange, 10) //allow default reset behavior to occur first
    });

    $('#highlight-previous').click(function(){showHighlight (-1)});
    $('#highlight-next').click(function(){showHighlight (1)});

    function setDatesFromRange(){
        var startDate = new Date(),
            endDate = new Date();
        switch($('#date-range-select').val()){
            case '30d':
                startDate.setDate(endDate.getDate()-30);
                break;
            case "1y":
                startDate.setFullYear(endDate.getFullYear()-1);
                break;
            case "5y":
                startDate.setFullYear(endDate.getFullYear()-5);
                break;
            case "all":
                startDate = new Date('1994-01-01');
                break;
            case "custom":
                return;
        }
        $('#date-from').val(startDate.toLocaleDateString());
        $('#date-to').val(endDate.toLocaleDateString());
    }

});

function getHashAsObject(){
    var hashString = location.href.split('#/').pop(),
        hashTupletes = hashString.split('&'),
        hashObject = {};
    for(var i=0;i<hashTupletes.length;i++){
        var hashPairs =  hashTupletes[i].split('=');
        hashObject[hashPairs[0]]  = decodeURIComponent(hashPairs[1]);
    }
    return hashObject;
}

function setHashValues(){
    var filingTypes = $('#filing-types').val().trim();
    let formValues = {
        q: $('#keywords').val(),
        dateRange: $('#date-range-select').find(':checked').val(),
        startdt: $('#date-from').val(),
        enddt: $('#date-to').val(),
        category: $('#category-select').val(),
        cik: entity?entity.cik:false,
        entityName: $('.entity').val(),
        forms: filingTypes.length?filingTypes.replace(/[/s;,+]+/i,',').trim().split(','):[]
    };
    let hashValues = [];
    for(let p in formValues){
        if(formValues[p]) hashValues.push(p+'='+encodeURIComponent(formValues[p]));
    }
    hasher.changed.active = false; //disable changed signal
    hasher.setHash(hashValues.join('&')); //set hash without dispatching changed signal
    hasher.changed.active = true; //re-enable signal
    return formValues;
}

function getCompanyHints(control, keysTyped){
    if(keysTyped && keysTyped.trim()){
        const hintsURL = 'https://search.publicdata.guru/typing-hints';
        const label = 'ajax call to ' + hintsURL + ' for "' + keysTyped + '"';
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
                var hints = data.branchTopHints;
                if(data.cikMatch) hints.unshift({CIK:data.cikMatch, entity: cikMatchName, tickers: cikMatchTickers});
                var hintDivs = [];
                var processedCIKs = [];
                var rgxKeysTyped = new RegExp('('+keysTyped.trim()+')','i');
                if(hints.length){
                    for(var h=0;h<hints.length;h++){
                        if(processedCIKs.indexOf(hints[h].CIK)==-1){
                            hintDivs.push('<tr class="hint" data="'+hints[h].CIK+'"><td class="hint-entity">'
                                +((hints[h].entity||'')+(hints[h].tickers?' ('+hints[h].tickers+')':'')).replace(rgxKeysTyped, '<b>$1</b>')
                                + '</td><td class="hint-cik">' + ((' <i>CIK '+hints[h].CIK+'</i>')||'')+'</td></tr>');
                            processedCIKs.push(hints[h].CIK)
                        }
                    }
                    $('table.entity-hints').find('tr').remove().end().html(hintDivs.join('')).show().find('tr.hint').click(function(evt){hintClicked(this)});
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
}

function hintClicked(row){
    console.log('hintClicked', (new Date()).getTime());
    var $row = $(row);
    entity = {
        cik: formatCIK(parseInt($row.attr('data'))),
        name: $row.find('.hint-entity').html().replace(/<\/?b>/gi, '')
    };
    $('.entity').val(entity.name);
    hideCompanyHints();
}
function hideCompanyHints(){
    $('div.entity-hints').hide();
}

function executeSearch(e){
    var $searchingOverlay = $('.searching-overlay').show();
    if(e) e.preventDefault();  //don't refresh the page if called by submit event

    const label = 'EFTS ajax call';
    console.time(label);
    var start = new Date();
    $.ajax({
        data: JSON.stringify(setHashValues()),
        dataType: 'JSON',
        type: 'POST',
        url: 'https://search.publicdata.guru/search-index',
        success: function (data, status) {
            let end = new Date();
            console.log('successfully talked to Lambda function!');
            console.timeEnd(label);
            console.log(data);
            //write the data to the HTML containers
            writeFilters(data, 'inc_states_filter');
            writeFilters(data, 'form_filter');
            writeFilters(data, 'entity_filter');
            writeFilters(data, 'sic_filter');
            var hits = data.hits.hits,
                rows = [];
            for(var i=0;i<hits.length;i++){
                rows.push('<tr><td class="file-name"><a href="#0" class="preview-file" data-adsh="' + hits[i]._source.adsh
                    + '">' + hits[i].fields.file_name[0] + '</a></td><td class="name">'+hits[i].fields['display_names.raw'].join('; ') + '</td><td class="filing-type">'
                    + hits[i].fields.form[0] + '</td><td class="filed">' + hits[i]._source.file_date + '</td><td class="file-name">'
                    + '</td><td class="file-number">file no'
                    + '</td><td class="sic">SIC</td></tr>')
            }
            $('#hits table tbody')
                .html(rows.join(''))
                .find('a.preview-file').click(previewFile);
            $searchingOverlay.hide();
            $('#results').show();
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.log(textStatus);
            $searchingOverlay.hide();
            throw(errorThrown);
        }
    });

    function writeFilters(data, filterKey){
        var $facetSection = $('#' + filterKey),
            $filter = $facetSection.find('.facets'),
            inputControls = {
                inc_states_filter: '#location-select',
                entity_filter: 'input.entity',
                form_filter: '#filing-types',
                sic_filter: '#sic_code-select'
            };
        if(data.aggregations && data.aggregations[filterKey] && data.aggregations[filterKey].buckets && data.aggregations[filterKey].buckets.length>1){
            var htmlFilters = [],
                dataFilters = data.aggregations[filterKey].buckets;
            for(var i=0; i<dataFilters.length; i++){
                var tooltip = false,
                    display = dataFilters[i].key,
                    hiddenKey = dataFilters[i].key;
                switch(filterKey){
                    case 'inc_states_filter':
                        display = edgarLocations[hiddenKey] || hiddenKey;
                        break;
                    case 'sic_filter':
                        //display =
                        //tooltip =
                        break;
                    case 'form_filter':
                        tooltip = formTooltips[hiddenKey];
                        break;

                }
                htmlFilters.push('<tr' +(tooltip?'  data-toggle="tooltip" title="'+tooltip+'"':'')+'><td><h6 class="d-inline"><span class="badge badge-secondary">' +
                    + dataFilters[i].doc_count + '</span></h6><a href="#0" data-filter-key="'+hiddenKey+'" class="'+filterKey+' ml-sm-2">'+dataFilters[i].key+'</a></td></tr>')
            }
            $filter
                .html('<table class="table" facet="'+filterKey+'">' + htmlFilters.join('') + '</table>')
                .find('a').click(function(evt, filterKey){
                    if(evt) evt.preventDefault();
                    var $a = $(this),
                        filterKey = $a.closest('.facet').attr('id');
                    $(inputControls[filterKey]).val($a.attr('data-filter-key')); //update the form
                    executeSearch();  //execute a new search -> update results and facets
            });
            $filter.find('[data-toggle="tooltip"]').tooltip({classes: {"ui-tooltip":"popover"}});
            $facetSection.show();
        } else {
            $filter.html('');
            $facetSection.hide();
        }
    }
}

function formatCIK(unpaddedCIK){ //accept int or string and return string with padded zero
    return '0'.repeat(10-unpaddedCIK.toString().length) + unpaddedCIK.toString()
}

function keywordStringToPhrases(keywords){
    keywords = keywords.trim().replace(/\s+/,' ');  //remove extra spaces
    var phrases = [], phrase = '', inQuotes = false;
    for(var i=0;i<keywords.length;i++){
        switch(keywords[i]){
            case '"':
                if(phrase.trim().length) {
                    phrases.push(phrase);
                    phrase = '';
                }
                inQuotes = !inQuotes;
                break;
            case ' ':
                if(!inQuotes){
                    if(phrase.trim().length) {
                        phrases.push(phrase);
                        phrase = '';
                        break;
                    }
                }
            default:
                phrase += keywords[i];
        }
    }
    if(phrase.trim().length) phrases.push(phrase); //final word/phrase
    return phrases;
}

function highlightMatchingPhases(text, phrases, isMarkupLanguage){
    var rgxPhrase ;
    for(var i=0;i<phrases.length;i++) {
        if(isMarkupLanguage){
            rgxPhrase = new RegExp('>([^<]*)\\b('+ phrases[i] + ')\\b', 'gmi');
            text = text.replace(rgxPhrase, '>$1<span class="sect-efts-search-match-khjdickkwg">$2</span>');
        } else {
            rgxPhrase = new RegExp('\\b('+ phrases[i] + ')\\b', 'gmi');
            text = text.replace(rgxPhrase, '><span class="sect-efts-search-match-khjdickkwg">$1</span>');
        }
    }
    return text;
}

function previewFile(evt){
    if(evt) evt.preventDefault();
    var $a = $(this),
        fileName = $a.html(),
        adsh = $a.attr('data-adsh'),
        submissionRoot = 'https://www.sec.gov/Archives/edgar/data/'
            + adsh.split('-')[0] + '/' + adsh.replace(/-/g,'') + '/' ,
        $searchingOverlay = $('.searching-overlay').show();
    $.get('https://www.publicdata.guru/sec/getWebDoc.php?f='+encodeURIComponent(submissionRoot + fileName),
        function(data){
            var bodyOpen = data.search(/<body.*>/i),
                bodyClose= data.search(/<\/body>/i),
                ext = fileName.split('.').pop().toLowerCase(),
                isText = ext == 'txt',
                isHTML = ext == 'htm' || ext == 'html',
                hashValues = getHashAsObject(),
                searchedKeywords = hashValues.q,
                html;
            if(isHTML){
                if(bodyOpen!=-1 && bodyClose!=-1) {
                    html = data.substring(data.search('>', bodyOpen)+1, bodyClose-1).replace(/<img src="/gi, '<img src="'+submissionRoot);
                    $('#previewer div.modal-body').html(highlightMatchingPhases(html, keywordStringToPhrases(searchedKeywords), isHTML));
                } else {
                    $('#previewer div.modal-body').html('');
                }
            } else {
                $('#previewer div.modal-body').html('<pre>' + highlightMatchingPhases(html, keywordStringToPhrases(searchedKeywords), isHTML) + '</pre>');
            }

            $('#previewer h4.modal-title strong').html(hashValues.q);
            $('#previewer .modal-file-name').html(fileName);
            $('#previewer h4.modal-title span.find-counter').html('<span id="showing-highlight">1</span> of '+ $('span.sect-efts-search-match-khjdickkwg').length);
            $('#open-file').attr('href', submissionRoot + fileName);
            $('#open-submission').attr('href',submissionRoot + adsh + '-index.html');
            $searchingOverlay.hide();
            $('#previewer').modal();
            showHighlight(0);
        }
    );
}

function showHighlight (change){
        var $highlights = $('span.sect-efts-search-match-khjdickkwg'),
            hightlightCount = $highlights.length,
            newShowing = Math.min(Math.max(1, parseInt($('#showing-highlight').html())+change), $highlights.length);
        $('#showing-highlight').html(newShowing);
        $('#previewer div.modal-body').animate({scrollTop: $($highlights.get(newShowing-1)).offset().top}, 500);
}

const locationsArray = [
    ["AL","Alabama"],
    ["AK","Alaska"],
    ["AZ","Arizona"],
    ["AR","Arkansas"],
    ["CA","California"],
    ["CO","Colorado"],
    ["CT","Connecticut"],
    ["DE","Delaware"],
    ["DC","District of Columbia"],
    ["FL","Florida"],
    ["GA","Georgia"],
    ["HI","Hawaii"],
    ["ID","Idaho"],
    ["IL","Illinois"],
    ["IN","Indiana"],
    ["IA","Iowa"],
    ["KS","Kansas"],
    ["KY","Kentucky"],
    ["LA","Louisiana"],
    ["ME","Maine"],
    ["MD","Maryland"],
    ["MA","Massachusetts"],
    ["MI","Michigan"],
    ["MN","Minnesota"],
    ["MS","Mississippi"],
    ["MO","Missouri"],
    ["MT","Montana"],
    ["NE","Nebraska"],
    ["NV","Nevada"],
    ["NH","New Hampshire"],
    ["NJ","New Jersey"],
    ["NM","New Mexico"],
    ["NY","New York"],
    ["NC","North Carolina"],
    ["ND","North Dakota"],
    ["OH","Ohio"],
    ["OK","Oklahoma"],
    ["OR","Oregon"],
    ["PA","Pennsylvania"],
    ["RI","Rhode Island"],
    ["SC","South Carolina"],
    ["SD","South Dakota"],
    ["TN","Tennessee"],
    ["TX","Texas"],
    ["X1","United States"],
    ["UT","Utah"],
    ["VT","Vermont"],
    ["VA","Virginia"],
    ["WA","Washington"],
    ["WV","West Virginia"],
    ["WI","Wisconsin"],
    ["WY","Wyoming"],
    ["A0","Alberta, Canada"],
    ["A1","British Columbia, Canada"],
    ["Z4","Canada (Federal Level)"],
    ["A2","Manitoba, Canada"],
    ["A3","New Brunswick, Canada"],
    ["A4","Newfoundland, Canada"],
    ["A5","Nova Scotia, Canada"],
    ["A6","Ontario, Canada"],
    ["A7","Prince Edward Island, Canada"],
    ["A8","Quebec, Canada"],
    ["A9","Saskatchewan, Canada"],
    ["B0","Yukon, Canada"],
    ["B2","Afghanistan"],
    ["Y6","Aland Islands"],
    ["B3","Albania"],
    ["B4","Algeria"],
    ["B5","American Samoa"],
    ["B6","Andorra"],
    ["B7","Angola"],
    ["1A","Anguilla"],
    ["B8","Antarctica"],
    ["B9","Antigua and Barbuda"],
    ["C1","Argentina"],
    ["1B","Armenia"],
    ["1C","Aruba"],
    ["C3","Australia"],
    ["C4","Austria"],
    ["1D","Azerbaijan"],
    ["C5","Bahamas"],
    ["C6","Bahrain"],
    ["C7","Bangladesh"],
    ["C8","Barbados"],
    ["1F","Belarus"],
    ["C9","Belgium"],
    ["D1","Belize"],
    ["G6","Benin"],
    ["D0","Bermuda"],
    ["D2","Bhutan"],
    ["D3","Bolivia"],
    ["1E","Bosnia and Herzegovina"],
    ["B1","Botswana"],
    ["D4","Bouvet Island"],
    ["D5","Brazil"],
    ["D6","British Indian Ocean Territory"],
    ["D9","Brunei Darussalam"],
    ["E0","Bulgaria"],
    ["X2","Burkina Faso"],
    ["E2","Burundi"],
    ["E3","Cambodia"],
    ["E4","Cameroon"],
    ["E8","Cape Verde"],
    ["E9","Cayman Islands"],
    ["F0","Central African Republic"],
    ["F2","Chad"],
    ["F3","Chile"],
    ["F4","China"],
    ["F6","Christmas Island"],
    ["F7","Cocos (Keeling) Islands"],
    ["F8","Colombia"],
    ["F9","Comoros"],
    ["G0","Congo"],
    ["Y3","Congo, the Democratic Republic of the"],
    ["G1","Cook Islands"],
    ["G2","Costa Rica"],
    ["L7","Cote D'ivoire "],
    ["1M","Croatia"],
    ["G3","Cuba"],
    ["G4","Cyprus"],
    ["2N","Czech Republic"],
    ["G7","Denmark"],
    ["1G","Djibouti"],
    ["G9","Dominica"],
    ["G8","Dominican Republic"],
    ["H1","Ecuador"],
    ["H2","Egypt"],
    ["H3","El Salvador"],
    ["H4","Equatorial Guinea"],
    ["1J","Eritrea"],
    ["1H","Estonia"],
    ["H5","Ethiopia"],
    ["H7","Falkland Islands (Malvinas)"],
    ["H6","Faroe Islands"],
    ["H8","Fiji"],
    ["H9","Finland"],
    ["I0","France"],
    ["I3","French Guiana"],
    ["I4","French Polynesia"],
    ["2C","French Southern Territories"],
    ["I5","Gabon"],
    ["I6","Gambia"],
    ["2Q","Georgia"],
    ["2M","Germany"],
    ["J0","Ghana"],
    ["J1","Gibraltar"],
    ["J3","Greece"],
    ["J4","Greenland"],
    ["J5","Grenada"],
    ["J6","Guadeloupe"],
    ["GU","Guam"],
    ["J8","Guatemala"],
    ["Y7","Guernsey"],
    ["J9","Guinea"],
    ["S0","Guinea-bissau"],
    ["K0","Guyana"],
    ["K1","Haiti"],
    ["K4","Heard Island and Mcdonald Islands"],
    ["X4","Holy See (Vatican City State)"],
    ["K2","Honduras"],
    ["K3","Hong Kong"],
    ["K5","Hungary"],
    ["K6","Iceland"],
    ["K7","India"],
    ["K8","Indonesia"],
    ["K9","Iran, Islamic Republic of"],
    ["L0","Iraq"],
    ["L2","Ireland"],
    ["Y8","Isle of Man"],
    ["L3","Israel"],
    ["L6","Italy"],
    ["L8","Jamaica"],
    ["M0","Japan"],
    ["Y9","Jersey"],
    ["M2","Jordan"],
    ["1P","Kazakstan"],
    ["M3","Kenya"],
    ["J2","Kiribati"],
    ["M4","Korea, Democratic People's Republic of "],
    ["M5","Korea, Republic of"],
    ["M6","Kuwait"],
    ["1N","Kyrgyzstan"],
    ["M7","Lao People's Democratic Republic "],
    ["1R","Latvia"],
    ["M8","Lebanon"],
    ["M9","Lesotho"],
    ["N0","Liberia"],
    ["N1","Libyan Arab Jamahiriya"],
    ["N2","Liechtenstein"],
    ["1Q","Lithuania"],
    ["N4","Luxembourg"],
    ["N5","Macau"],
    ["1U","Macedonia, the Former Yugoslav Republic of"],
    ["N6","Madagascar"],
    ["N7","Malawi"],
    ["N8","Malaysia"],
    ["N9","Maldives"],
    ["O0","Mali"],
    ["O1","Malta"],
    ["1T","Marshall Islands"],
    ["O2","Martinique"],
    ["O3","Mauritania"],
    ["O4","Mauritius"],
    ["2P","Mayotte"],
    ["O5","Mexico"],
    ["1K","Micronesia, Federated States of"],
    ["1S","Moldova, Republic of"],
    ["O9","Monaco"],
    ["P0","Mongolia"],
    ["Z5","Montenegro"],
    ["P1","Montserrat"],
    ["P2","Morocco"],
    ["P3","Mozambique"],
    ["E1","Myanmar"],
    ["T6","Namibia"],
    ["P5","Nauru"],
    ["P6","Nepal"],
    ["P7","Netherlands"],
    ["P8","Netherlands Antilles"],
    ["1W","New Caledonia"],
    ["Q2","New Zealand"],
    ["Q3","Nicaragua"],
    ["Q4","Niger"],
    ["Q5","Nigeria"],
    ["Q6","Niue"],
    ["Q7","Norfolk Island"],
    ["1V","Northern Mariana Islands"],
    ["Q8","Norway"],
    ["P4","Oman"],
    ["R0","Pakistan"],
    ["1Y","Palau"],
    ["1X","Palestinian Territory, Occupied"],
    ["R1","Panama"],
    ["R2","Papua New Guinea"],
    ["R4","Paraguay"],
    ["R5","Peru"],
    ["R6","Philippines"],
    ["R8","Pitcairn"],
    ["R9","Poland"],
    ["S1","Portugal"],
    ["PR","Puerto Rico"],
    ["S3","Qatar"],
    ["S4","Reunion"],
    ["S5","Romania"],
    ["1Z","Russian Federation"],
    ["S6","Rwanda"],
    ["Z0","Saint Barthelemy"],
    ["U8","Saint Helena"],
    ["U7","Saint Kitts and Nevis"],
    ["U9","Saint Lucia"],
    ["Z1","Saint Martin"],
    ["V0","Saint Pierre and Miquelon"],
    ["V1","Saint Vincent and the Grenadines"],
    ["Y0","Samoa"],
    ["S8","San Marino"],
    ["S9","Sao Tome and Principe"],
    ["T0","Saudi Arabia"],
    ["T1","Senegal"],
    ["Z2","Serbia"],
    ["T2","Seychelles"],
    ["T8","Sierra Leone"],
    ["U0","Singapore"],
    ["2B","Slovakia"],
    ["2A","Slovenia"],
    ["D7","Solomon Islands"],
    ["U1","Somalia"],
    ["T3","South Africa"],
    ["1L","South Georgia and the South Sandwich Islands"],
    ["U3","Spain"],
    ["F1","Sri Lanka"],
    ["V2","Sudan"],
    ["V3","Suriname"],
    ["L9","Svalbard and Jan Mayen"],
    ["V6","Swaziland"],
    ["V7","Sweden"],
    ["V8","Switzerland"],
    ["V9","Syrian Arab Republic"],
    ["F5","Taiwan, Province of China"],
    ["2D","Tajikistan"],
    ["W0","Tanzania, United Republic of"],
    ["W1","Thailand"],
    ["Z3","Timor-leste"],
    ["W2","Togo"],
    ["W3","Tokelau"],
    ["W4","Tonga"],
    ["W5","Trinidad and Tobago"],
    ["W6","Tunisia"],
    ["W8","Turkey"],
    ["2E","Turkmenistan"],
    ["W7","Turks and Caicos Islands"],
    ["2G","Tuvalu"],
    ["W9","Uganda"],
    ["2H","Ukraine"],
    ["C0","United Arab Emirates"],
    ["X0","United Kingdom"],
    ["2J","United States Minor Outlying Islands"],
    ["X3","Uruguay"],
    ["2K","Uzbekistan"],
    ["2L","Vanuatu"],
    ["X5","Venezuela"],
    ["Q1","Viet Nam"],
    ["D8","Virgin Islands, British"],
    ["VI","Virgin Islands, U.s."],
    ["X8","Wallis and Futuna"],
    ["U5","Western Sahara"],
    ["T7","Yemen"],
    ["Y4","Zambia"],
    ["Y5","Zimbabwe"],
    ["XX","Unknown"]
];

const forms = [
  {"form":"4","category":"Section 16 Reports","description":"Statement of changes in beneficial ownership of securities"},
  {"form":"8-K","category":"Annual, Periodic, and Current Reports","description":"Current report"},
  {"form":"SC 13G","category":"Beneficial Ownership Reports","description":"Schedule filed to report acquisition of beneficial ownership of 5% or more of a class of equity securities by passive investors and certain institutions"},
  {"form":"D","category":"Exempt Offerings","description":"Notice of sales of securities on Form D (Regulation D)"},
  {"form":"3","category":"Section 16 Reports","description":"Initial statement of beneficial ownership of securities"},
  {"form":"10-Q","category":"Annual, Periodic, and Current Reports","description":"Quarterly report pursuant to Section 13 or 15(d)"},
  {"form":"424B2","category":"Registration Statements","description":""},
  {"form":"6-K","category":"Annual, Periodic, and Current Reports","description":"Current report of foreign issuer pursuant to Rules 13a-16 and 15d-16"},
  {"form":"497","category":"Registration Statements","description":"Definitive materials filed under paragraph (a), (b), (c), (d), (e) or (f) of Securities Act Rule 497"},
  {"form":"497K","category":"Registration Statements","description":"Summary prospectuses for open-end management investment companies registered on Form N-1A filed pursuant to Securities Act Rule 497(k)"},
  {"form":"13F-HR","category":"Annual, Periodic, and Current Reports","description":"Further understand that each of 13F-HR, 13F-NT, and amendments thereto are mandatory electronic filings (hardship exemption exists to submit in paper; never used to the knowledge of IM staff);"},
  {"form":"CORRESP","category":"Filing Review Correspondence","description":""},
  {"form":"424B3","category":"Registration Statements","description":""},
  {"form":"UPLOAD","category":"Filing Review Correspondence","description":"Upload Submission"},
  {"form":"SC 13D","category":"Beneficial Ownership Reports","description":"Schedule filed to report acquisition of beneficial ownership of 5% or more of a class of equity securities"},
  {"form":"FWP","category":"Registration Statements","description":"Filing under Securities Act Rule 163/433 of free writing prospectuses."},
  {"form":"10-K","category":"Annual, Periodic, and Current Reports","description":"Annual report pursuant to Section 13 or 15(d)"},
  {"form":"EFFECT","category":"SEC Orders and Notices","description":"Effectiveness filing by commission order"},
  {"form":"S-4","category":"Registration Statements","description":"Registration statement for securities to be issued in business combination transactions"},
  {"form":"485BPOS","category":"Registration Statements","description":"Post-effective amendment filed pursuant to Securities Act Rule 485(b) (this filing cannot be submitted as a 1940 Act only filing)"},
  {"form":"5","category":"Section 16 Reports","description":"Annual statement of changes in beneficial ownership of securities"},
  {"form":"24F-2NT","category":"Annual, Periodic, and Current Reports","description":"Rule 24f-2 notice filed on Form 24F-2"},
  {"form":"N-Q","category":"Annual, Periodic, and Current Reports","description":"Quarterly Schedule of Portfolio Holdings of Registered Management Investment Company filed on Form N-Q"},
  {"form":"424B5","category":"Registration Statements","description":""},
  {"form":"DEF 14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"13F-NT","category":"Annual, Periodic, and Current Reports","description":"Further understand that each of 13F-HR, 13F-NT, and amendments thereto are mandatory electronic filings (hardship exemption exists to submit in paper; never used to the knowledge of IM staff);"},
  {"form":"497J","category":"Registration Statements","description":"Certification of no change in definitive materials under paragraph (j) of Securities Act Rule 497"},
  {"form":"10-D","category":"Annual, Periodic, and Current Reports","description":"Asset-Backed Issuer Distribution Report Pursuant to Section 13 or 15(d) of the Securities Exchange Act of 1934"},
  {"form":"DEFA14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"425","category":"Registration Statements","description":"Filing under Securities Act Rule 425 of certain prospectuses and communications in connection with business combination transactions."},
  {"form":"X-17A-5","description":"Note: This is a TM filing.  Annual audit report by brokers or dealers. To provide the Commission with audited statements of financial condition, income, and cash flows, and other financial materials."},
  {"form":"N-MFP","category":"Annual, Periodic, and Current Reports","description":"Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"S-1","category":"Registration Statements","description":"General form of registration statement for all companies including face-amount certificate companies"},
  {"form":"40-17G","category":"Annual, Periodic, and Current Reports","description":"Fidelity bond filed pursuant to Rule 17g-1(g)(1) of the Investment Company Act of 1940."},
  {"form":"N-CSR","category":"Annual, Periodic, and Current Reports","description":"Certified annual shareholder report of registered management investment companies filed on Form N-CSR"},
  {"form":"N-CSRS","category":"Annual, Periodic, and Current Reports","description":"Certified semi-annual shareholder report of registered management investment companies filed on Form N-CSR"},
  {"form":"N-PX","category":"Annual, Periodic, and Current Reports","description":"Annual Report of Proxy Voting Record of Registered Management Investment Companies filed on Form N-PX"},
  {"form":"NSAR-B","category":"Annual, Periodic, and Current Reports","description":"Annual report for management companies filed on Form N-SAR"},
  {"form":"NSAR-A","category":"Annual, Periodic, and Current Reports","description":"Semi-annual report for management companies filed on Form N-SAR"},
  {"form":"NT 10-Q","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"S-3ASR","category":"Registration Statements","description":"Automatic shelf registration statement of securities of well-known seasoned issuers"},
  {"form":"40-APP","category":"SEC Orders and Notices","description":"Application for an order of exemptive or other relief filed under the Investment Company Act of 1940"},
  {"form":"S-3","category":"Registration Statements","description":"Registration statement for specified transactions by certain issuers including face-amount certificate companies"},
  {"form":"S-8","category":"Registration Statements","description":"Initial registration statement for securities to be offered to employees pursuant to employee benefit plans"},
  {"form":"19B-4E","description":"Note: This is not IM. Filed by self-regulatory orgs."},
  {"form":"POSASR","category":"Registration Statements","description":"Post-effective amendment to an automatic shelf registration statement of Form S-3ASR or Form F-3ASR"},
  {"form":"S-8 POS","category":"Registration Statements","description":"Post-effective amendment to a S-8 registration statement"},
  {"form":"S-6","category":"Registration Statements","description":"Initial registration statement filed on Form S-6 for unit investment trusts"},
  {"form":"FOCUSN","description":"Note: This is not IM. Filed by broker dealers."},
  {"form":"485BXT","category":"Registration Statements","description":"Post-effective amendment filed pursuant to Securities Act Rule 485(b)(1)(iii) to designate a new effective date for a post-effective amendment previously filed pursuant to Securities Act Rule 485(a) (this filing cannot be submitted as a 1940 Act only fili"},
  {"form":"POS AM","category":"Registration Statements","description":"Post-effective amendment to a registration statement that is not immediately effective upon filing"},
  {"form":"N-MFP2","category":"Annual, Periodic, and Current Reports","description":"Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"MA-I","description":"Information Regarding Natural Persons Who Engage in Municipal Advisory Activities"},
  {"form":"11-K","category":"Annual, Periodic, and Current Reports","description":"Annual reports of employee stock purchase, savings and similar plans pursuant to Section 15(d)"},
  {"form":"485APOS","category":"Registration Statements","description":"Post-effective amendment filed pursuant to Securities Act Rule 485(a) (this filing cannot be submitted as a 1940 Act only filing)"},
  {"form":"25-NSE","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"NT 10-K","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"CT ORDER","category":"SEC Orders and Notices","description":"Note: Confirm category with CF. There have been 1986 issued since 1/1/2018. Five by IM, 1 by TM and the rest CF."},
  {"form":"ARS","category":"Proxy Materials","description":"Annual report to security holders. Note: Use this Form Type when furnishing the annual report to security holders for the information of the Commission pursuant to Rule 14a-3(c) or Rule 14c-3(b)."},
  {"form":"SC TO-I","category":"Tender Offers and Going Private Transactions","description":"Issuer tender offer statement"},
  {"form":"ABS-15G","category":"Annual, Periodic, and Current Reports","description":"ASSET-BACKED SECURITIZER REPORT"},
  {"form":"PRE 14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"SC TO-T","category":"Tender Offers and Going Private Transactions","description":"Third party tender offer statement"},
  {"form":"DFAN14A","category":"Proxy Materials","description":"Definitive additional proxy soliciting materials filed by non-management including Rule 14(a)(12) material. Note: Form Type DFAN14A can be filed as part of Form 8-K. For filers subject to 8-K filing requirements, we recommend the use of the 8-K combined f"},
  {"form":"487","category":"Registration Statements","description":"Pre-effective pricing amendments filed pursuant to Securities Act Rule 487"},
  {"form":"8-A12B","category":"Registration Statements","description":""},
  {"form":"20-F","category":"Annual, Periodic, and Current Reports","description":"Registration statement under Section 12 of the Securities Exchange Act of 1934 or an annual or transition report filed under Section 13(a) or 15(d) of the Exchange Act for a  foreign private issuer."},
  {"form":"F-6EF","category":"Registration Statements","description":"Auto effective registration statement for American Depositary Receipts representing securities of certain foreign private issuers"},
  {"form":"40-17F2","category":"Annual, Periodic, and Current Reports","description":"Initial certificate of accounting of securities and similar investments in the custody of management investment companies filed pursuant to Rule 17f-2 of the Investment Company Act of 1940 filed on Form N-17F-2"},
  {"form":"SD","category":"Annual, Periodic, and Current Reports","description":"Specialized Disclosure Report"},
  {"form":"144","description":"Filing for proposed sale of securities under Rule 144."},
  {"form":"NSAR-U","category":"Annual, Periodic, and Current Reports","description":"Annual report for unit investment trusts filed on Form N-SAR"},
  {"form":"ABS-EE","category":"Annual, Periodic, and Current Reports","description":"Form for Submission of Electronic Exhibits in Asset-Backed Securities Offerings"},
  {"form":"DEF 14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"15-15D","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"SC 14D9","category":"Tender Offers and Going Private Transactions","description":"Tender offer solicitation / recommendation statements filed under Rule 14-d9"},
  {"form":"RW","category":"Registration Statements","description":"Registration Withdrawal Request"},
  {"form":"F-3","category":"Registration Statements","description":"Registration statement for specified transactions by certain foreign private issuers"},
  {"form":"F-4","category":"Registration Statements","description":"Registration statement for securities issued by foreign private issuers in certain business combination transactions"},
  {"form":"DRS","category":"Registration Statements","description":"Persons"},
  {"form":"N-30B-2","category":"Annual, Periodic, and Current Reports","description":"Periodic and interim reports mailed to investment company shareholders (other than annual and semi-annual reports mailed to shareholders pursuant to Rule 30e-1)"},
  {"form":"T-3","category":"Trust Indenture Filings","description":"Initial application for qualification of trust indentures"},
  {"form":"REVOKED","category":"SEC Orders and Notices","description":"Note: Confirm category with CF. There have been over 500 issued since 1/1/2018. All are CF companies. This might be available to all Divisions."},
  {"form":"N-30D","category":"Annual, Periodic, and Current Reports","description":"Initial annual and semi-annual reports mailed to investment company shareholders pursuant to Rule 30e-1 (other than those required to be submitted as part of Form N-CSR)"},
  {"form":"N-2","category":"Registration Statements","description":"Filing of a registration statement on Form N-2 for closed-end investment companies"},
  {"form":"PRE 14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"424B4","category":"Registration Statements","description":""},
  {"form":"15-12G","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"NO ACT","description":"Note: This is not a submission type that has ever been used on EDGAR. IM issues no action letters but we have not seen this used on EDGAR."},
  {"form":"TA-2","description":"Annual report of transfer agent activities filed pursuant to the Securities Exchange Act of 1934. IN contains information necessary to monitor transfer agent registration"},
  {"form":"N-CEN","category":"Annual, Periodic, and Current Reports","description":"Form N-CEN will require annual reporting of certain census-type information in a structured XML format. Form N-CEN will replace Form N-SAR.  The compliance date for Form N-CEN filers – regardless of asset size – is June 1, 2018."},
  {"form":"N-MFP1","category":"Annual, Periodic, and Current Reports","description":"Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"SUPPL","category":"Registration Statements","description":"Voluntary supplemental material filed pursuant to Section 11(a) of the Securities Act of 1933 by foreign issuers"},
  {"form":"C","description":"Offering Statement"},
  {"form":"SC TO-C","category":"Tender Offers and Going Private Transactions","description":"Written communication relating to an issuer or third party tender offer"},
  {"form":"10-12G","category":"Registration Statements","description":""},
  {"form":"POS EX","category":"Registration Statements","description":"Post-effective amendment filed solely to add exhibits to a registration statement"},
  {"form":"F-6 POS","category":"Registration Statements","description":"Post-effective amendment to a F-6EF registration"},
  {"form":"SC 13E3","category":"Tender Offers and Going Private Transactions","description":"Schedule filed to report going private transactions"},
  {"form":"40-24B2","category":"Registration Statements","description":"Filing of sales literature pursuant to Rule 24b-2 under the Investment Company Act of 1940."},
  {"form":"CERTNYS","description":"Note: Check with CF they do the majority of these filings."},
  {"form":"F-1","category":"Registration Statements","description":"Registration statement for certain foreign private issuers"},
  {"form":"NPORT-EX","category":"Annual, Periodic, and Current Reports","description":"Portfolio holdings exhibit"},
  {"form":"IRANNOTICE","category":"Annual, Periodic, and Current Reports","description":"Notice of Iran-related disclosure filed pursuant to Section 13(r)(3) of the Exchange Act"},
  {"form":"PRER14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"1-A","category":"Exempt Offerings","description":"REGULATION A OFFERING STATEMENT UNDER THE SECURITIES ACT OF 1933"},
  {"form":"15-12B","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"497AD","description":"Filing by certain investment companies of Securities Act Rule 482 advertising in accordance with Securities Act Rule 497 and the Note to Rule 482©.  See the following for more detail on hardship exemption https://www.sec.gov/rules/final/2008/33-8981.pdf"},
  {"form":"N-8F","description":"Application for deregistration made on Form N-8F"},
  {"form":"PX14A6G","category":"Proxy Materials","description":""},
  {"form":"POS AMI","description":"Amendment (for filings made under the1940 Act only)"},
  {"form":"CB","category":"Tender Offers and Going Private Transactions","description":"Notification form filed in connection with certain tender offers, business combinations and rights offerings, in which the subject company is a foreign private issuer of which less than 10% of its securities are held by U.S. persons."},
  {"form":"N-14","description":"Initial registration statement filed on Form N-14 for open-end investment company, including those filed with automatic effectiveness under Rule 488 (business combinations)."},
  {"form":"F-6","category":"Registration Statements","description":"Registration statement for American Depositary Receipts representing securities of certain foreign private issuers"},
  {"form":"DRSLTR","category":"Filing Review Correspondence","description":"Correspondence Submission of a DRS filer. Correspondence is not publicly disseminated immediately. The SEC staff may publicly release all or portions of these documents."},
  {"form":"305B2","category":"Trust Indenture Filings","description":"Application for designation of a new trustee under the Trust Indenture Act"},
  {"form":"CERTNAS","description":""},
  {"form":"424B7","category":"Registration Statements","description":""},
  {"form":"DEFM14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"MA","description":"Application For Municipal Advisor Registration"},
  {"form":"S-11","category":"Registration Statements","description":"Registration statement for securities to be issued by real estate companies"},
  {"form":"AW","category":"Registration Statements","description":"Withdrawal of amendment to a registration statement filed under the Securities Act"},
  {"form":"TA-1","description":"Application for registration as a transfer agent filed pursuant to the Securities Exchange Act of 1934. It contains information necessary to consider the Transfer Agent registration"},
  {"form":"F-X","category":"Registration Statements","description":"For appointment of agent for service of process by issuers registering securities (if filed on Form F-8, F-9, F-10 or F-80, or registering securities or filing periodic reports on Form 40-F, or by any person filing certain tender offer documents, or by an"},
  {"form":"8-A12G","category":"Registration Statements","description":""},
  {"form":"DEFR14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"18-K","category":"Annual, Periodic, and Current Reports","description":"Annual report for foreign governments and political subdivisions"},
  {"form":"N-8F ORDR","description":"N-8F Order"},
  {"form":"40-F","category":"Annual, Periodic, and Current Reports","description":"Registration Statement Pursuant to Section 12 of the Securities Exchange Act of 1934 or Annual Report pursuant to Section 13(a) or 15(d) of the Securities Exchange Act of 1934"},
  {"form":"MA-A","description":"Annual Update of Municipal Advisor Registration"},
  {"form":"PREC14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"N-8F NTC","description":"N-8F Notice"},
  {"form":"POS 8C","description":"Post-effective amendment filed under the 1933 Act only or under both the 1933 and 1940 Acts pursuant to Section 8(c) of the 1933 Act by closed-end investment companies (this filing cannot be submitted as a 1940 Act only filing)"},
  {"form":"PREM14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"PRRN14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"N-4","description":"Initial registration statement on Form N-4 for separate accounts (unit investment trusts)"},
  {"form":"N-8A","description":"Initial notification of registration under section 8(a) filed on Form N-8A"},
  {"form":"424H","category":"Registration Statements","description":""},
  {"form":"N-1A","description":"investment company prospectuses filed under paragraph (a), (b), (c), (d), (e) or (f) of Securities Act Rule 497"},
  {"form":"N-1A","description":"Initial registration statement filed on Form N-1A for open-end management investment companies"},
  {"form":"N-1A","description":"(a) An initial registration statement and amendments to the registration statement [by open-end management investment companies] under the Investment company Act; An initial registration statement including amendments under the Securities Act;"},
  {"form":"CERT","description":""},
  {"form":"F-3ASR","category":"Registration Statements","description":"Automatic shelf registration statement of securities of well-known seasoned issuers"},
  {"form":"1","description":""},
  {"form":"DEFC14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"424B1","category":"Registration Statements","description":""},
  {"form":"10-12B","category":"Registration Statements","description":""},
  {"form":"SC14D9C","category":"Tender Offers and Going Private Transactions","description":"Written communication by the subject company relating to a third party tender offer"},
  {"form":"F-10","category":"Registration Statements","description":"Registration statement for securities of certain Canadian issuers under the Securities Act of 1933"},
  {"form":"APP NTC","description":"40-APP Notice"},
  {"form":"N-23C3A","description":""},
  {"form":"40-OIP","description":"Application for an order of exemptive or other relief filed under the Investment Company Act of 1940"},
  {"form":"25","category":"Annual, Periodic, and Current Reports","description":"Notification of removal from listing and/or registration from a national securities exchange"},
  {"form":"APP ORDR","description":"40-APP Order"},
  {"form":"APP WD","description":"Withdrawal of an application for exemptive or other relief from the federal securities laws"},
  {"form":"PRER14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"424B8","category":"Registration Statements","description":""},
  {"form":"253G2","category":"Exempt Offerings","description":""},
  {"form":"1-U","category":"Annual, Periodic, and Current Reports","description":"Current Report Pursuant to Regulation A"},
  {"form":"SC 14F1","category":"Tender Offers and Going Private Transactions","description":"Statement regarding change in majority of directors pursuant to Rule 14f-1"},
  {"form":"C-U","description":"Progress Update"},
  {"form":"N-23C-2","description":"Notice by closed-end investment companies of intention to call or redeem their own securities under Investment Company Act Rule 23c-2"},
  {"form":"S-1MEF","category":"Registration Statements","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-1"},
  {"form":"NT 20-F","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"QUALIF","category":"SEC Orders and Notices","description":""},
  {"form":"C-AR","description":"Annual Report"},
  {"form":"DEL AM","category":"Registration Statements","description":"Separately filed delaying amendment under Securities Act Rule 473 to delay effectiveness of a 1933 Act registration statement"},
  {"form":"1-A POS","category":"Exempt Offerings","description":""},
  {"form":"NTN 10Q","description":""},
  {"form":"ADV-NR","description":""},
  {"form":"SF-3","category":"Registration Statements","description":"Shelf registration statement for qualified offerings of asset-backed securities"},
  {"form":"486BPOS","description":"Post-effective amendment to filing filed pursuant to Securities Act Rule 486(b)"},
  {"form":"40-6B","description":"Application under the Investment Company Act of 1940 by an employees securities company"},
  {"form":"CERTARCA","description":""},
  {"form":"10-KT","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"NTN 10K","description":""},
  {"form":"DSTRBRPT","category":"Annual, Periodic, and Current Reports","description":"Distribution of primary obligations Development Bank report"},
  {"form":"40-17F1","description":"Initial certificate of accounting of securities and similar investments in the custody of management investment companies filed pursuant to Rule 17f-1 of the Investment Company Act of 1940 filed on Form N-17F-1"},
  {"form":"N-14 8C","description":"Initial registration statement filed on Form N-14 by closed-end investment company (business combinations)"},
  {"form":"ADV-E","description":""},
  {"form":"S-3MEF","category":"Registration Statements","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-3"},
  {"form":"40-33","description":"Copies of all stockholder derivative actions filed with a court against an investment company or an affiliate thereof pursuant to Section 33 of the Investment Company Act of 1940. Note: May be filed electronically on a voluntary basis."},
  {"form":"N-18F1","description":"Initial notification of election pursuant to Rule 18f-1 filed on Form N-18F-1 [under the Investment Company Act of 1940 by a registered open-end investment company]."},
  {"form":"N-6","description":"Initial registration statement filed on Form N-6 for separate accounts (unit investment trusts)"},
  {"form":"SE","description":""},
  {"form":"S-B","category":"Registration Statements","description":"Registration statement for securities of foreign governments and subdivisions thereof under the Securities Act of 1933 (Schedule b)"},
  {"form":"MA-W","description":"Notice of Withdrawal From Registration as a Municipal Advisor"},
  {"form":"F-N","category":"Registration Statements","description":"Notification of the appointment of an agent for service by certain foreign institutions."},
  {"form":"DOS","category":"Exempt Offerings","description":"Persons who"},
  {"form":"1-K","category":"Annual, Periodic, and Current Reports","description":"Regulation A Annual Report"},
  {"form":"1-SA","category":"Annual, Periodic, and Current Reports","description":"SEMIANNUAL REPORT PURSUANT TO REGULATION A or SPECIAL FINANCIAL REPORT PURSUANT TO REGULATION A"},
  {"form":"CFPORTAL","description":"It contains information to consider registration as a crowdfunding portal"},
  {"form":"NT N-MFP","description":"EDGAR generated form type for late filing of  Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"S-3D","category":"Registration Statements","description":"Automatically effective registration statement for securities issued pursuant to dividend or interest reinvestment plans"},
  {"form":"S-3DPOS","category":"Registration Statements","description":"Post-effective amendment to a S-3D registration statement"},
  {"form":"MSD","description":""},
  {"form":"13FCONP","description":""},
  {"form":"NT 11-K","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"20FR12G","category":"Registration Statements","description":""},
  {"form":"8-K12B","description":""},
  {"form":"NSAR-BT","description":"Transitional annual report filed on Form N-SAR"},
  {"form":"TA-W","description":"Notice of withdrawal from registration as transfer agent filed pursuant to the Securities Exchange Act of 1934. IN contains information necessary to consider the Transfer Agent registration withdrawal"},
  {"form":"RW WD","category":"Registration Statements","description":"Withdrawal of a request for withdrawal of a registration statement"},
  {"form":"NT-NSAR","description":"Notice under Exchange Act Rule 12b-25 of inability to timely file Form N-SAR"},
  {"form":"PREM14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"PREN14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"OIP NTC","description":"40-OIP Notice"},
  {"form":"DEFA14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"DFRN14A","category":"Proxy Materials","description":"Revised definitive proxy statement filed by non-management"},
  {"form":"N-6F","description":"Notice of intent by business development companies to elect to be subject to Sections 55 through 65 of the 1940 Act filed on Form N-6F"},
  {"form":"OIP ORDR","description":"40-OIP Order"},
  {"form":"C-W","description":"Offering Statement Withdrawal"},
  {"form":"CERTPAC","description":""},
  {"form":"8-K12G3","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"SC14D1F","category":"Beneficial Ownership Reports","description":"Third party tender offer statement filed pursuant to Rule 14d-1(b) by foreign issuers"},
  {"form":"DEFN14A","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"DEFM14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"1-A-W","category":"Exempt Offerings","description":""},
  {"form":"DEFR14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"G-FIN","description":""},
  {"form":"NRSRO-UPD","description":"Form NRSRO – Update of Registration for Nationally Recognized Statistical Rating Organizations"},
  {"form":"NT-NCSR","description":"Notice under Exchange Act Rule 12b-25 of inability to timely file Form N-CSR (annual or semi-annual report)"},
  {"form":"15F-12G","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"20FR12B","category":"Registration Statements","description":""},
  {"form":"SEC STAFF ACTION","description":""},
  {"form":"DOSLTR","category":"Filing Review Correspondence","description":""},
  {"form":"40FR12B","category":"Registration Statements","description":"Registration of a class of securities of certain Canadian issuers pursuant to Section 12(b) of the 1934 Act"},
  {"form":"F-1MEF","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form F-1"},
  {"form":"N-54A","description":"Notification of election by business development companies to be subject to the provisions of sections 55 through 65 of the Investment Company Act"},
  {"form":"15F-15D","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"NT N-CEN","description":""},
  {"form":"15F-12B","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"486APOS","description":"Post-effective amendment to filing filed pursuant to Securities Act Rule 486(a)"},
  {"form":"F-9","category":"Registration Statements","description":"Registration of securities of certain investment grade debt or investment grade preferred securities of certain Canadian issuers under the Securities Act of 1933"},
  {"form":"QRTLYRPT","category":"Annual, Periodic, and Current Reports","description":"Periodic Development Bank filing, submitted quarterly"},
  {"form":"40-8B25","description":"Filing by investment company of application under Investment Company Act Rule 8b-25(a) requesting extension of time for filing certain information, document or report"},
  {"form":"NT N-MFP2","description":""},
  {"form":"1-Z","category":"Annual, Periodic, and Current Reports","description":"EXIT REPORT UNDER REGULATION A"},
  {"form":"N-2MEF","description":"A new registration statement on Form N-2 filed under the Securities Act Rule 462(b) by closed-end investment companies to register up to an additional 20% of securities for an offering that was registered on Form N-2"},
  {"form":"TACO","description":""},
  {"form":"CERTCBO","description":""},
  {"form":"10-QT","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"CERTBATS","description":""},
  {"form":"S-4 POS","category":"Registration Statements","description":"Post-effective amendment to a S-4EF registration statement"},
  {"form":"N-23C3B","description":"Notification of  discretionary repurchase offer [by registered closed-end investment companies or business development companies] pursuant Rule 23c-3(c) only"},
  {"form":"40-206A","description":""},
  {"form":"NRSRO-CE","description":"Form NRSRO – Annual Certification for Nationally Recognized Statistical Rating Organizations"},
  {"form":"APP WDG","description":""},
  {"form":"STOP ORDER","description":""},
  {"form":"424A","category":"Registration Statements","description":""},
  {"form":"ANNLRPT","category":"Annual, Periodic, and Current Reports","description":"Periodic Development Bank filing, submitted annually"},
  {"form":"N-CR","description":"Current Report of Money Market Fund Material Events"},
  {"form":"PX14A6N","category":"Proxy Materials","description":""},
  {"form":"SEC STAFF LETTER","description":""},
  {"form":"N-54C","description":"Notification of withdrawal by business development companies of notification of election by business development companies to be subject to the provisions of sections 55 through 65 of the Investment Company Act"},
  {"form":"NT-NCEN","description":""},
  {"form":"POS462B","category":"Registration Statements","description":"Post-effective amendment to Securities Act Rule 462(b) registration statement"},
  {"form":"C-TR","description":"Termination of Reporting"},
  {"form":"2-A","description":""},
  {"form":"S-4MEF","category":"Registration Statements","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-4"},
  {"form":"ADV-H-T","description":""},
  {"form":"F-3D","category":"Registration Statements","description":"Registration statement for dividend or interest reinvestment plan securities of foreign private issuers"},
  {"form":"AW WD","category":"Registration Statements","description":"Withdrawal of a request for withdrawal of an amendment to a registration statement"},
  {"form":"6B NTC","description":"40-6B Notice"},
  {"form":"8-M","description":""},
  {"form":"NT N-MFP1","description":""},
  {"form":"N-8B-2","description":"Initial registration statement for unit investment trusts filed on Form N-8B-2"},
  {"form":"REG-NR","description":""},
  {"form":"497H2","description":"Filings made pursuant to Securities Act Rule 497(h)(2)"},
  {"form":"F-7","category":"Registration Statements","description":"Registration statement for securities of certain Canadian issuers offered for cash upon the exercise of rights granted to existing security holders under the Securities Act of 1933"},
  {"form":"S-11MEF","category":"Registration Statements","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-11"},
  {"form":"253G1","category":"Exempt Offerings","description":""},
  {"form":"6B ORDR","description":"40-6B Order"},
  {"form":"F-80","category":"Registration Statements","description":"Registration of securities of certain Canadian issuers to be issued in exchange offers or a business combination under the Securities Act of 1933"},
  {"form":"40-202A","description":""},
  {"form":"SC 14N","category":"Proxy Materials","description":"Information to be included in statements filed pursuant to §240.14n-1 and amendments thereto filed pursuant to §240.14n-2."},
  {"form":"F-10POS","category":"Registration Statements","description":"Post-effective amendment to a F-10EF registration"},
  {"form":"MSDW","description":""},
  {"form":"NSAR-AT","description":"Transitional semi-annual report filed on Form N-SAR"},
  {"form":"SC14D9F","category":"Tender Offers and Going Private Transactions","description":"Solicitation/recommendation statement pursuant to Section 14(d)(4) of the Securities Exchange Act of 1934 and Rules 14d-1(b) and 14e-2(c) by foreign issuers"},
  {"form":"486BXT","description":""},
  {"form":"F-8","category":"Registration Statements","description":"Registration statement for securities of certain Canadian issuers to be issued in exchange offers or a business combination under the Securities Act of 1933"},
  {"form":"PREC14C","category":"Proxy Materials","description":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"MSDCO","description":""},
  {"form":"TTW","description":""},
  {"form":"WDL-REQ","description":""},
  {"form":"G-405","description":""},
  {"form":"NTFNCSR","description":""},
  {"form":"SF-1","category":"Registration Statements","description":"General form of registration statement for all issuers of asset-backed securities"},
  {"form":"G-405N","description":""},
  {"form":"F-80POS","category":"Registration Statements","description":"Post-effective amendment to a F-80 registration"},
  {"form":"F-3MEF","category":"Registration Statements","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form F-3"},
  {"form":"SP 15D2","category":"Annual, Periodic, and Current Reports","description":"Special Financial Report filed under Rule 15d-2"},
  {"form":"11-KT","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"40-17GCS","description":"Filings of claim or settlement pursuant to rule 17g-1(g)(1)(2) or (3) of the Investment Company Act of 1940."},
  {"form":"40FR12G","category":"Registration Statements","description":"Registration of a class of securities of certain Canadian issuers pursuant to Section 12(g) of the 1934 Act"},
  {"form":"F-3DPOS","category":"Registration Statements","description":"Post-Effective amendment to a F-3D registration"},
  {"form":"F-4 POS","category":"Registration Statements","description":"Post-Effective amendment to an F-4EF registration"},
  {"form":"NTFNSAR","description":""},
  {"form":"1-E","description":"Notification under Regulation E by small business investment companies and business development companies"},
  {"form":"40-8F-2","description":"Initial application for deregistration pursuant to Investment Company Act Rule 0-2"},
  {"form":"8-K15D5","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"G-FINW","description":""},
  {"form":"NTFNCEN","description":""},
  {"form":"2-AF","description":""},
  {"form":"N-23C3C","description":"Notification of periodic repurchase offer under paragraph (b) of Rule 23c-3 and a discretionary repurchase offer under paragraph (c) of Rule 23c-3. [by registered closed-end investment companies or business development companies] pursuant to Rule 23c-3(b)"},
  {"form":"NTN 20F","description":""},
  {"form":"SC13E4F","category":"Tender Offers and Going Private Transactions","description":"Issuer tender offer statement filed pursuant to Rule 13(e)(4) by foreign issuers"},
  {"form":"F-8 POS","category":"Registration Statements","description":"Post-effective amendment to a F-8 registration"},
  {"form":"NT NPORT-EX","description":""},
  {"form":"TH","description":""},
  {"form":"ADN-MTL","description":""},
  {"form":"CFPORTAL-W","description":""},
  {"form":"DEFC14C","category":"Proxy Materials","description":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"SC 13E1","category":"Tender Offers and Going Private Transactions","description":"Schedule 13-E1 statement of issuer required by Rule 13e-1"},
  {"form":"SDR","description":"Swap Data Repository (in Edgar now). It contains information necessary to consider registration as a swap data repository"},
  {"form":"2-E","description":"Report of sales of securities by small business investment companies and business development companies pursuant to Rule 609 (Regulation E) Securities Act of 1933"},
  {"form":"9-M","description":""},
  {"form":"S-BMEF","category":"Registration Statements","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-B"},
  {"form":"253G3","category":"Exempt Offerings","description":""},
  {"form":"34-12H","description":""},
  {"form":"F-7 POS","category":"Registration Statements","description":"Post-effective amendment to a F-7 registration"},
  {"form":"N-5","description":"Initial registration statement on Form N-5 for small business investment companies"},
  {"form":"POS462C","category":"Registration Statements","description":"Post-effective amendment to a registration statement filed under Securities Act Rule 462(c)"},
  {"form":"8F-2 NTC","description":"40-8F-2 Notice"},
  {"form":"ATS-N-C","description":""},
  {"form":"C-AR-W","description":""},
  {"form":"C-U-W","description":"Broker-Dealer Withdrawal"},
  {"form":"F-10EF","category":"Registration Statements","description":"Auto effective registration statement for securities of certain Canadian issuers under the Securities Act of 1933"},
  {"form":"F-4MEF","category":"Registration Statements","description":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form F-4"},
  {"form":"F-9 POS","category":"Registration Statements","description":"Post-effective amendment to a F-9EF registration"},
  {"form":"NT 10-D","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"NTN 10D","description":""},
  {"form":"S-20","category":"Registration Statements","description":"Registration statement for standardized options"},
  {"form":"SL","description":""},
  {"form":"UNDER","category":"Registration Statements","description":"Initial undertaking to file reports"},
  {"form":"1-E AD","description":""},
  {"form":"1-Z-W","category":"Annual, Periodic, and Current Reports","description":""},
  {"form":"18-12B","category":"Registration Statements","description":""},
  {"form":"8F-2 ORDR","description":"40-8F-2 Order"},
  {"form":"ADV-H-C","description":""},
  {"form":"N-14MEF","description":"A new registration statement filed on Form N-14 by closed end investment companies filed under Securities Act Rule 462(b) of up to an additional 20% of securities for an offering that was registered on Form N-14"},
  {"form":"SEC ACTION","description":""},
  {"form":"253G4","category":"Exempt Offerings","description":""},
  {"form":"40-203A","description":""},
  {"form":"ATS-N","description":""},
  {"form":"ATS-N/UA","description":""},
  {"form":"C-TR-W","description":"Termination of Reporting Withdrawal"},
  {"form":"N-1","description":"Initial registration statement filed on Form N-1 for open-end management investment companies"},
  {"form":"S-4EF","category":"Registration Statements","description":"Auto effective registration statement for securities issued in connection with the formation of a bank or savings and loan holding company in compliance with General Instruction G"}
];
