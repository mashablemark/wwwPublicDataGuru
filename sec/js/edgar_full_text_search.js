"use strict";

var formTooltips = {};
var edgarLocations = {};
var divisionCodes = {};
var sicLabels = {};

$(document).ready(function() {
    var i;
    $('[data-toggle="tooltip"]').tooltip({classes: {"ui-tooltip":"popover"}});
    setDatesFromRange();

    //configure company hints event on both keywords and company text boxes
    $('.entity')
        .keyup(function(event){ getCompanyHints(this, $(this).val())})
        .blur(function(evt){console.log(evt.relatedTarget)})
        .keypress(
            function(evt){console.log(evt.relatedTarget)
            });
    $('#form-container').blur(hideCompanyHints);
    $('#form-container button, #form-container label, #form-container input:not(.entity)').focus(hideCompanyHints);

    //load form categories from the forms array 
    for(i in forms){  //first create a hash table for form tooltips
        if(forms[i].description && forms[i].description.length) formTooltips[forms[i].form] = forms[i].description
    }

    //load form categories and configure selection event
    var categoryOptions = ['<option value="all" data="" selected>View All</option>'];
    for(var c=0;c<formCategories.length;c++){
        categoryOptions.push('<option value="C'+(c)+'" data="'+formCategories[c].forms.join(', ')+'">'+formCategories[c].category+'</option>');
    }
    categoryOptions.push('<option value="custom">User Defined</option>');
    var $forms = $('#filing-types');
    var $category = $('#category-select') 
        .html(categoryOptions.join(''))
        .change(function(event){
            if($(this).val() !='custom') $forms.val($category.find('option:selected').attr('data'));
        });

    //configure the forms text event
    $forms.keyup(function(){ $category.val('custom'); });

    //load locations selector and configure selection xevent
    var $locations = $('#location-select');
    var locationOptions = ['<option value="" selected>View All</option>'];
    for(i=0;i<locationsArray.length;i++){
        locationOptions.push('<option value="'+locationsArray[i][0]+'">'+locationsArray[i][1]+'</option>');
        edgarLocations[locationsArray[i][0]] = locationsArray[i][1];
    }
    $locations.html(locationOptions.join(''));

    //configure date range selector and data pickers
    var $dateRangeSelect = $('#date-range-select').change(setDatesFromRange);
    $('#date-from, #date-to').datepicker({
        changeMonth: true,
        changeYear: true,
        minDate: "1994-01-01",  //"-10Y" for production
        maxDate: new Date(),
        dateFormat: 'yy-mm-dd'
    });
    $('#date-from, #date-to').change(function(){
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

    //load the SIC selector
    var optionsSIC = ['<option value="">View All</option>'], divID, start_sic, end_sic, codeSIC;
    for(i=0; i<SIC_Codes.length;i++){
        if(SIC_Codes[i].start_sic){  //SIC division
            divID = SIC_Codes[i].id;
            start_sic = parseInt(SIC_Codes[i].start_sic);
            end_sic = parseInt(SIC_Codes[i].end_sic);
            divisionCodes[divID] = [];
            optionsSIC.push('<option class="sic-division font-weight-bold" value="'+divID+'">'+start_sic+'-'+end_sic+' '+SIC_Codes[i].label.toUpperCase()+'</option>')
        } else { // individual SIC classification
            var codeSIC = parseInt(SIC_Codes[i].id),
                label = toTitleCase(SIC_Codes[i].label);
            sicLabels[codeSIC] = label;
            optionsSIC.push('<option class="sic-sector" value="'+codeSIC+'">&nbsp;&nbsp;'+codeSIC+'&nbsp;'+label+'</option>');
            if(codeSIC>=start_sic && codeSIC<=end_sic) divisionCodes[divID].push(codeSIC);
        }
    }
    $('#sic-select').html(optionsSIC.join(''));

    //over-ride default form submit
    $('#form-container form').submit(setHashFromForm); //intercept form submit events; also called programmatically

    //clear button behavior
    $('#clear').click(function(){
        $('#results').hide();
        setTimeout(setDatesFromRange, 10) //allow default reset behavior to occur first
    });

    //modal form events
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
        $('#date-from').val(formatDate(startDate.toLocaleDateString()));
        $('#date-to').val(formatDate(endDate.toLocaleDateString()));
    }

    $('.location-type-option ').click(function(evt){
        evt.preventDefault(); //don't change the hash
        $('#location-type').html($(this).html()); //change the location search type: business state vs incorporation state
        if($('#location-select').val()) setHashFromForm();
    });

    $('#search_form select').change(function(){setHashFromForm()});

    //hash event and initialization
    hasher.initialized.add(loadFormFromHash); //populate form if values bookmarked/embedded in link
    hasher.initialized.add(executeSearch);//execute search on load if values bookmarked/embedded in link
    hasher.changed.add(loadFormFromHash); //update form on back/forward navigate
    hasher.changed.add(executeSearch); //execute search on hash change from form submit or pn navigate
    hasher.init();
});

function hashToObject(hashString){
    var hashObject = {};
    if(!hashString) hashString = hasher.getHashAsArray().pop();
    if(hashString){
        var hashTupletes = hashString.split('&');
        for(var i=0;i<hashTupletes.length;i++){
            var hashPair =  hashTupletes[i].split('=');
            hashObject[hashPair[0]]  = decodeURIComponent(hashPair[1]);
        }
    }
    return hashObject;
}
function setHashFromForm(e){
    if(e) e.preventDefault();  //don't refresh the page if called by submit event
    var forms = $('#filing-types').val().trim(),
        entityName = $('.entity').val();
    let formValues = {
        q: $('#keywords').val(),
        dateRange: $('#date-range-select').find(':checked').val(),
        startdt: formatDate($('#date-from').val()),
        enddt: formatDate($('#date-to').val()),
        category: $('#category-select').val(),
        sics: $('#sic-select').val(),
        locationType: $('#location-type').html().toLowerCase(),
        locationCode: $('#location-select').val(),
        ciks: extractCIK(entityName),
        entityName: entityName,
        forms: forms.length?forms.replace(/[\s;,+]+/g,',').toUpperCase():null
    };
    let hashValues = [];
    for(let p in formValues){
        if(formValues[p]) hashValues.push(p+'='+formValues[p]);
    }
    hasher.setHash(hashValues.join('&')); //this trigger the listener (= executeSearch)
    return formValues;
}
function loadFormFromHash(hash){
    const hashValues = hashToObject(hash);
    $('#keywords').val(hashValues.q || '');
    $('#date-range-select').val(hashValues.dateRange || '1y');
    if(hashValues.startdt) $('#date-from').val(formatDate(hashValues.startdt));
    if(hashValues.enddt) $('#date-to').val(formatDate(hashValues.enddt));
    $('#category-select').val(hashValues.category || 'all');
    $('#location-select').val(hashValues.locationCode || 'all');
    $('#location-type').html(toTitleCase(hashValues.locationType || 'located'));
    $('.entity').val(hashValues.entityName||'');
    $('#filing-types').val(hashValues.forms ? hashValues.forms.replace(/,/g,', ') : '');
    $('#sic-select').val(hashValues.sics||'');
}

function formatDate(dateOrString){
    var dt = new Date(dateOrString),
        yyyy=dt.getUTCFullYear(),
        m=dt.getUTCMonth()+1,
        d=dt.getUTCDate();
    return yyyy+'-'+(m<10?'0'+m:m)+'-'+(d<10?'0'+d:d);
}

function toTitleCase(title){
    var w, word, words = title.split(' ');
    for(w=0; w<words.length; w++){
        word = words[w].substr(0,1).toUpperCase() + words[w].substr(1).toLowerCase();
        if(w!=0 && ['A','An','And','In','Of','The'].indexOf(word)!=-1) word = word.toLowerCase();
        words[w] = word;
    }
    return words.join(' ');
}

function extractCIK(entityName){
    if(entityName.substr(entityName.length-16).match(/\(CIK [0-9]{10}\)/)
        || entityName.substr(entityName.length-12).match(/\([0-9]{10}\)/)
    )
        return entityName.substr(entityName.length-11, 10);
    if(!isNaN(entityName)&&parseInt(entityName).toString()==entityName&&parseInt(entityName)<1500)
        return parseInt(entityName);
    return false;
}

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
                var hintDivs = [];
                var rgxKeysTyped = new RegExp('('+keysTyped.trim()+')','gi');
                if(hints.length){
                    for(var h=0;h<hints.length;h++){
                        const CIK = hints[h]._id,
                            entityName = hints[h]._source.entity;
                        hintDivs.push('<tr class="hint" data="'+ entityName + ' (CIK '+formatCIK(CIK)+')"><td class="hint-entity">'
                            + (entityName||'').replace(rgxKeysTyped, '<b>$1</b>')
                            + '</td><td class="hint-cik">' + ((' <i>CIK '+ formatCIK(CIK)+'</i>')||'')+'</td></tr>');
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


function executeSearch(newHash, oldHash){
    if(newHash=='' && !oldHash) return;  //blank form loaded
    var $searchingOverlay = $('.searching-overlay').show();
    $('.tooltip').remove();
    hideCompanyHints();
    
    const label = 'EFTS ajax call';
    console.time(label);
    var start = new Date(),
        searchParams = hashToObject(newHash);
    if(searchParams.forms) searchParams.forms = searchParams.forms.split(',');
    if(searchParams.ciks) searchParams.ciks = searchParams.ciks.split(',');
    if(searchParams.sics){
        if(divisionCodes[searchParams.sics])
            searchParams.sics = divisionCodes[searchParams.sics];
        else
            searchParams.sics = [searchParams.sics];
    }
    if(searchParams.locationCode && searchParams.locationCode!='all'){
        searchParams.locationCodes = [searchParams.locationCode];
    }
    console.log(searchParams);
    $.ajax({
        data: JSON.stringify(searchParams),
        dataType: 'JSON',
        type: 'POST',
        url: 'https://search.publicdata.guru/search-index',
        success: function (data, status) {
            hideCompanyHints();
            let end = new Date();
            console.log('successfully talked to Lambda function!');
            console.timeEnd(label);
            console.log(data);
            if(typeof data == 'string' && data.startsWith('invalid JSON in: ')){
                try{

                } catch(e) {

                }
            }
            //write the data to the HTML containers
            writeFilters(data, 'inc_states_filter');
            writeFilters(data, 'biz_states_filter');
            writeFilters(data, 'form_filter');
            writeFilters(data, 'entity_filter');
            writeFilters(data, 'sic_filter');
            var hits = data.hits.hits,
                rows = [];
            for(var i=0;i<hits.length;i++){
                try{
                    let pathParts = hits[i]._id.split(':'),
                    adsh = pathParts[0],
                    fileName = pathParts[1],
                    fileNameParts = fileName.split('.'),
                    fileNameMain = fileNameParts[0],
                    fileNameExt = fileNameParts[1],
                    fileType = hits[i]._source.file_type || hits[i]._source.file_description || fileName,
                    form =  hits[i]._source.form;
                    if(XLS_Forms[form]!=-1 && fileNameExt.toUpperCase()=='XML') //this is an XML file with a transformation
                        fileName = XLS_Forms[form] + '/' + fileNameMain + '.' + fileNameExt;
                    rows.push('<tr>'
                        + '<td class="file"><a href="#0" class="preview-file" data-adsh="' + adsh + '" data-file-name="'
                        +     fileName+'">' + fileType + '</a></td>'
                        + '<td class="form">' + form + '</td>'
                        + '<td class="filed" nowrap>' + hits[i]._source.file_date + '</td>'
                        + '<td class="name">' + hits[i]._source.display_names.join('<br> ') + '</td>'
                        + '<td class="biz-location">' + hits[i]._source.biz_locations.join('<br>') + '</td>'
                        + '<td class="incorporated">' + hits[i]._source.inc_states.map(function (code){return edgarLocations[code]||code}).join('<br>') + '</td>'
                        + '</tr>');
                } catch (e) {
                    console.log("error processing search hit:", hits[i]);
                }
            }
            $('#hits table tbody')
                .html(rows.join(''))
                .find('a.preview-file').click(previewFile);
            $('div.collapse.show').removeClass('show');  //collapse the accordion of facets
            $searchingOverlay.hide();
            $('#results').show();
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.log(textStatus);
            hideCompanyHints();
            $searchingOverlay.hide();
            throw(errorThrown);
        }
    });

    function writeFilters(data, filterKey){
        var $facetSection = $('#' + filterKey),
            $filter = $facetSection.find('.facets'),
            inputControls = {
                inc_states_filter: '#location-select',
                biz_states_filter: '#location-select',
                entity_filter: 'input.entity',
                form_filter: '#filing-types',
                sic_filter: '#sic-select'
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
                    case 'biz_states_filter':
                        display = edgarLocations[hiddenKey] || hiddenKey;
                        break;
                    case 'sic_filter':
                        display = hiddenKey + ' ' + sicLabels[hiddenKey];
                        break;
                    case 'form_filter':
                        tooltip = formTooltips[hiddenKey];
                        break;

                }
                htmlFilters.push('<tr' +(tooltip?'  data-toggle="tooltip" data-placement="right" title="'+tooltip+'"':'')+'><td><h6 class="d-inline"><span class="badge badge-secondary">' +
                    + dataFilters[i].doc_count + '</span></h6><a href="#0" data-filter-key="'+hiddenKey+'" class="'+filterKey+' ml-sm-2">'+display+'</a></td></tr>')
            }
            $filter
                .html('<table class="table" facet="'+filterKey+'">' + htmlFilters.join('') + '</table>')
                .find('a').click(function(evt){
                    if(evt) evt.preventDefault();
                    var $a = $(this),
                        filterKey = $a.closest('.facet').attr('id'),
                        filterType = $a.attr('data-filter-key'),
                        locationType = $a.closest('.facet').attr('data-location-type');
                    $(inputControls[filterKey]).val(filterType).keyup(); //update the form
                    if(locationType) $('#location-type').html(toTitleCase(locationType));
                    setHashFromForm();  //update the hash and trigger a new search -> update results and facets
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
    if(!keywords || !keywords.length) return false;
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
    if(phrases){
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
    }
    return text;
}

function previewFile(evt){
    if(evt) evt.preventDefault();
    var $a = $(this),
        cik = extractCIK($a.closest('tr').find('.name').text()),
        fileType = $a.text(),
        adsh = $a.attr('data-adsh'),
        form = $a.closest('tr').find('.form').text(),
        fileDate = $a.closest('tr').find('.filed').text(),
        fileName = $a.attr('data-file-name'),
        domain = 'https://www.sec.gov',
        submissionRoot = domain + '/Archives/edgar/data/' + cik + '/' + adsh.replace(/-/g,'') + '/' ,
        $searchingOverlay = $('.searching-overlay').show();
    $.get('/sec/getWebDoc.php?f='+encodeURIComponent(submissionRoot + fileName),
        function(data){
            var bodyOpen = data.search(/<body.*>/i),
                bodyClose= data.search(/<\/body>/i),
                ext = fileName.split('.').pop().toLowerCase(),
                hashValues = hashToObject(),
                searchedKeywords = hashValues.q,
                keyPhrases = keywordStringToPhrases(searchedKeywords),
                html;
            switch(ext){
                case 'htm':
                case 'html':
                    html = data.substring(data.search('>', bodyOpen)+1, bodyClose-1).replace(/<img src="/gi, '<img src="'+submissionRoot);
                    $('#previewer div.modal-body').html(highlightMatchingPhases(html, keyPhrases, true));
                    break;
                case 'xml':
                    html = data.substring(data.search('>', bodyOpen)+1, bodyClose-1).replace(/<img src="\//gi, '<img src="'+domain+'/');
                    $('#previewer div.modal-body').html(highlightMatchingPhases(html, keyPhrases, true));
                    break;
                case 'txt':
                    $('#previewer div.modal-body').html('<pre>' + highlightMatchingPhases(html, keyPhrases, false) + '</pre>');
                    break;
                case 'pdf':
                    $('#previewer div.modal-body').html('Open File to view PDF in new tab');
                    break;
                default:
                    $('#previewer div.modal-body').html('unknown file type: ' + ext);
            }
            if(keyPhrases && ['txt','xml','htm','html'].indexOf(ext)!=-1){
                $('#previewer h4.modal-title strong').html(hashValues.q);
                $('#previewer .modal-file-name').html((form!=fileType?fileType+ ' of ':'') + form + ' filed ('+fileDate+')');
                $('#previewer h4.modal-title span.find-counter').html('<span id="showing-highlight">1</span> of '+ $('span.sect-efts-search-match-khjdickkwg').length);
                $('#previewer h4.modal-title').show();
            } else {
                $('#previewer h4.modal-title').hide();
            }
            $('#open-file').attr('href', submissionRoot + fileName);
            $('#open-submission').attr('href',submissionRoot + adsh + '-index.html');
            $searchingOverlay.hide();
            $('#previewer').modal();
            showHighlight(1);
        }
    );
}

function showHighlight (change){
    var $highlights = $('span.sect-efts-search-match-khjdickkwg'),
        $previewPanel = $('#previewer div.modal-body'),
        newShowing = Math.min(Math.max(1, parseInt($('#showing-highlight').html())+change), $highlights.length);
    if($highlights.length){
        $('#showing-highlight').html(newShowing);
        $previewPanel.animate({scrollTop: Math.max(0, $previewPanel.scrollTop() + $($highlights.get(newShowing-1)).offset().top - $previewPanel.height()/2)}, 500);
    } else {

    }
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

var SIC_Codes= [
    {"id":"D1","label":"Agriculture, Forestry and Fishing","start_sic":"100","end_sic":"999"},
    {"id":"100","label":"AGRICULTURAL PRODUCTION-CROPS"},
    {"id":"200","label":"AGRICULTURAL PROD-LIVESTOCK & ANIMAL SPECIALTIES"},
    {"id":"700","label":"AGRICULTURAL SERVICES"},
    {"id":"800","label":"FORESTRY"},
    {"id":"900","label":"FISHING, HUNTING AND TRAPPING"},
    {"id":"D2","label":"Mining","start_sic":"1000","end_sic":"1499"},
    {"id":"1000","label":"METAL MINING"},
    {"id":"1040","label":"GOLD AND SILVER ORES"},
    {"id":"1090","label":"MISCELLANEOUS METAL ORES"},
    {"id":"1220","label":"BITUMINOUS COAL & LIGNITE MINING"},
    {"id":"1221","label":"BITUMINOUS COAL & LIGNITE SURFACE MINING"},
    {"id":"1311","label":"CRUDE PETROLEUM & NATURAL GAS"},
    {"id":"1381","label":"DRILLING OIL & GAS WELLS"},
    {"id":"1382","label":"OIL & GAS FIELD EXPLORATION SERVICES"},
    {"id":"1389","label":"OIL & GAS FIELD SERVICES, NEC"},
    {"id":"1400","label":"MINING & QUARRYING OF NONMETALLIC MINERALS (NO FUELS)"},
    {"id":"D3","label":"Construction","start_sic":"1500","end_sic":"1799"},
    {"id":"1520","label":"GENERAL BLDG CONTRACTORS - RESIDENTIAL BLDGS"},
    {"id":"1531","label":"OPERATIVE BUILDERS"},
    {"id":"1540","label":"GENERAL BLDG CONTRACTORS - NONRESIDENTIAL BLDGS"},
    {"id":"1600","label":"HEAVY CONSTRUCTION OTHER THAN BLDG CONST - CONTRACTORS"},
    {"id":"1623","label":"WATER, SEWER, PIPELINE, COMM & POWER LINE CONSTRUCTION"},
    {"id":"1700","label":"CONSTRUCTION - SPECIAL TRADE CONTRACTORS"},
    {"id":"1731","label":"ELECTRICAL WORK"},
    {"id":"D4","label":"Manufacturing","start_sic":"2000","end_sic":"3999"},
    {"id":"2000","label":"FOOD AND KINDRED PRODUCTS"},
    {"id":"2011","label":"MEAT PACKING PLANTS"},
    {"id":"2013","label":"SAUSAGES & OTHER PREPARED MEAT PRODUCTS"},
    {"id":"2015","label":"POULTRY SLAUGHTERING AND PROCESSING"},
    {"id":"2020","label":"DAIRY PRODUCTS"},
    {"id":"2024","label":"ICE CREAM & FROZEN DESSERTS"},
    {"id":"2030","label":"CANNED, FROZEN & PRESERVD FRUIT, VEG & FOOD SPECIALTIES"},
    {"id":"2033","label":"CANNED, FRUITS, VEG, PRESERVES, JAMS & JELLIES"},
    {"id":"2040","label":"GRAIN MILL PRODUCTS"},
    {"id":"2050","label":"BAKERY PRODUCTS"},
    {"id":"2052","label":"COOKIES & CRACKERS"},
    {"id":"2060","label":"SUGAR & CONFECTIONERY PRODUCTS"},
    {"id":"2070","label":"FATS & OILS"},
    {"id":"2080","label":"BEVERAGES"},
    {"id":"2082","label":"MALT BEVERAGES"},
    {"id":"2086","label":"BOTTLED & CANNED SOFT DRINKS & CARBONATED WATERS"},
    {"id":"2090","label":"MISCELLANEOUS FOOD PREPARATIONS & KINDRED PRODUCTS"},
    {"id":"2092","label":"PREPARED FRESH OR FROZEN FISH & SEAFOODS"},
    {"id":"2100","label":"TOBACCO PRODUCTS"},
    {"id":"2111","label":"CIGARETTES"},
    {"id":"2200","label":"TEXTILE MILL PRODUCTS"},
    {"id":"2211","label":"BROADWOVEN FABRIC MILLS, COTTON"},
    {"id":"2221","label":"BROADWOVEN FABRIC MILLS, MAN MADE FIBER & SILK"},
    {"id":"2250","label":"KNITTING MILLS"},
    {"id":"2253","label":"KNIT OUTERWEAR MILLS"},
    {"id":"2273","label":"CARPETS & RUGS"},
    {"id":"2300","label":"APPAREL & OTHER FINISHD PRODS OF FABRICS & SIMILAR MATL"},
    {"id":"2320","label":"MEN'S & BOYS' FURNISHGS, WORK CLOTHG, & ALLIED GARMENTS"},
    {"id":"2330","label":"WOMEN'S, MISSES', AND JUNIORS OUTERWEAR"},
    {"id":"2340","label":"WOMEN'S, MISSES', CHILDREN'S & INFANTS' UNDERGARMENTS"},
    {"id":"2390","label":"MISCELLANEOUS FABRICATED TEXTILE PRODUCTS"},
    {"id":"2400","label":"LUMBER & WOOD PRODUCTS (NO FURNITURE)"},
    {"id":"2421","label":"SAWMILLS & PLANTING MILLS, GENERAL"},
    {"id":"2430","label":"MILLWOOD, VENEER, PLYWOOD, & STRUCTURAL WOOD MEMBERS"},
    {"id":"2451","label":"MOBILE HOMES"},
    {"id":"2452","label":"PREFABRICATED WOOD BLDGS & COMPONENTS"},
    {"id":"2510","label":"HOUSEHOLD FURNITURE"},
    {"id":"2511","label":"WOOD HOUSEHOLD FURNITURE, (NO UPHOLSTERED)"},
    {"id":"2520","label":"OFFICE FURNITURE"},
    {"id":"2522","label":"OFFICE FURNITURE (NO WOOD)"},
    {"id":"2531","label":"PUBLIC BLDG & RELATED FURNITURE"},
    {"id":"2540","label":"PARTITIONS, SHELVG, LOCKERS, & OFFICE & STORE FIXTURES"},
    {"id":"2590","label":"MISCELLANEOUS FURNITURE & FIXTURES"},
    {"id":"2600","label":"PAPERS & ALLIED PRODUCTS"},
    {"id":"2611","label":"PULP MILLS"},
    {"id":"2621","label":"PAPER MILLS"},
    {"id":"2631","label":"PAPERBOARD MILLS"},
    {"id":"2650","label":"PAPERBOARD CONTAINERS & BOXES"},
    {"id":"2670","label":"CONVERTED PAPER & PAPERBOARD PRODS (NO CONTANERS\/BOXES)"},
    {"id":"2673","label":"PLASTICS, FOIL & COATED PAPER BAGS"},
    {"id":"2711","label":"NEWSPAPERS: PUBLISHING OR PUBLISHING & PRINTING"},
    {"id":"2721","label":"PERIODICALS: PUBLISHING OR PUBLISHING & PRINTING"},
    {"id":"2731","label":"BOOKS: PUBLISHING OR PUBLISHING & PRINTING"},
    {"id":"2732","label":"BOOK PRINTING"},
    {"id":"2741","label":"MISCELLANEOUS PUBLISHING"},
    {"id":"2750","label":"COMMERCIAL PRINTING"},
    {"id":"2761","label":"MANIFOLD BUSINESS FORMS"},
    {"id":"2771","label":"GREETING CARDS"},
    {"id":"2780","label":"BLANKBOOKS, LOOSELEAF BINDERS & BOOKBINDG & RELATD WORK"},
    {"id":"2790","label":"SERVICE INDUSTRIES FOR THE PRINTING TRADE"},
    {"id":"2800","label":"CHEMICALS & ALLIED PRODUCTS"},
    {"id":"2810","label":"INDUSTRIAL INORGANIC CHEMICALS"},
    {"id":"2820","label":"PLASTIC MATERIAL, SYNTH RESIN\/RUBBER, CELLULOS (NO GLASS)"},
    {"id":"2821","label":"PLASTIC MATERIALS, SYNTH RESINS & NONVULCAN ELASTOMERS"},
    {"id":"2833","label":"MEDICINAL CHEMICALS & BOTANICAL PRODUCTS"},
    {"id":"2834","label":"PHARMACEUTICAL PREPARATIONS"},
    {"id":"2835","label":"IN VITRO & IN VIVO DIAGNOSTIC SUBSTANCES"},
    {"id":"2836","label":"BIOLOGICAL PRODUCTS, (NO DISGNOSTIC SUBSTANCES)"},
    {"id":"2840","label":"SOAP, DETERGENTS, CLEANG PREPARATIONS, PERFUMES, COSMETICS"},
    {"id":"2842","label":"SPECIALTY CLEANING, POLISHING AND SANITATION PREPARATIONS"},
    {"id":"2844","label":"PERFUMES, COSMETICS & OTHER TOILET PREPARATIONS"},
    {"id":"2851","label":"PAINTS, VARNISHES, LACQUERS, ENAMELS & ALLIED PRODS"},
    {"id":"2860","label":"INDUSTRIAL ORGANIC CHEMICALS"},
    {"id":"2870","label":"AGRICULTURAL CHEMICALS"},
    {"id":"2890","label":"MISCELLANEOUS CHEMICAL PRODUCTS"},
    {"id":"2891","label":"ADHESIVES & SEALANTS"},
    {"id":"2911","label":"PETROLEUM REFINING"},
    {"id":"2950","label":"ASPHALT PAVING & ROOFING MATERIALS"},
    {"id":"2990","label":"MISCELLANEOUS PRODUCTS OF PETROLEUM & COAL"},
    {"id":"3011","label":"TIRES & INNER TUBES"},
    {"id":"3021","label":"RUBBER & PLASTICS FOOTWEAR"},
    {"id":"3050","label":"GASKETS, PACKG & SEALG DEVICES & RUBBER & PLASTICS HOSE"},
    {"id":"3060","label":"FABRICATED RUBBER PRODUCTS, NEC"},
    {"id":"3080","label":"MISCELLANEOUS PLASTICS PRODUCTS"},
    {"id":"3081","label":"UNSUPPORTED PLASTICS FILM & SHEET"},
    {"id":"3086","label":"PLASTICS FOAM PRODUCTS"},
    {"id":"3089","label":"PLASTICS PRODUCTS, NEC"},
    {"id":"3100","label":"LEATHER & LEATHER PRODUCTS"},
    {"id":"3140","label":"FOOTWEAR, (NO RUBBER)"},
    {"id":"3211","label":"FLAT GLASS"},
    {"id":"3220","label":"GLASS & GLASSWARE, PRESSED OR BLOWN"},
    {"id":"3221","label":"GLASS CONTAINERS"},
    {"id":"3231","label":"GLASS PRODUCTS, MADE OF PURCHASED GLASS"},
    {"id":"3241","label":"CEMENT, HYDRAULIC"},
    {"id":"3250","label":"STRUCTURAL CLAY PRODUCTS"},
    {"id":"3260","label":"POTTERY & RELATED PRODUCTS"},
    {"id":"3270","label":"CONCRETE, GYPSUM & PLASTER PRODUCTS"},
    {"id":"3272","label":"CONCRETE PRODUCTS, EXCEPT BLOCK & BRICK"},
    {"id":"3281","label":"CUT STONE & STONE PRODUCTS"},
    {"id":"3290","label":"ABRASIVE, ASBESTOS & MISC NONMETALLIC MINERAL PRODS"},
    {"id":"3310","label":"STEEL WORKS, BLAST FURNACES & ROLLING & FINISHING MILLS"},
    {"id":"3312","label":"STEEL WORKS, BLAST FURNACES & ROLLING MILLS (COKE OVENS)"},
    {"id":"3317","label":"STEEL PIPE & TUBES"},
    {"id":"3320","label":"IRON & STEEL FOUNDRIES"},
    {"id":"3330","label":"PRIMARY SMELTING & REFINING OF NONFERROUS METALS"},
    {"id":"3334","label":"PRIMARY PRODUCTION OF ALUMINUM"},
    {"id":"3341","label":"SECONDARY SMELTING & REFINING OF NONFERROUS METALS"},
    {"id":"3350","label":"ROLLING DRAWING & EXTRUDING OF NONFERROUS METALS"},
    {"id":"3357","label":"DRAWING & INSULATING OF NONFERROUS WIRE"},
    {"id":"3360","label":"NONFERROUS FOUNDRIES (CASTINGS)"},
    {"id":"3390","label":"MISCELLANEOUS PRIMARY METAL PRODUCTS"},
    {"id":"3411","label":"METAL CANS"},
    {"id":"3412","label":"METAL SHIPPING BARRELS, DRUMS, KEGS & PAILS"},
    {"id":"3420","label":"CUTLERY, HANDTOOLS & GENERAL HARDWARE"},
    {"id":"3430","label":"HEATING EQUIP, EXCEPT ELEC & WARM AIR; & PLUMBING FIXTURES"},
    {"id":"3433","label":"HEATING EQUIPMENT, EXCEPT ELECTRIC & WARM AIR FURNACES"},
    {"id":"3440","label":"FABRICATED STRUCTURAL METAL PRODUCTS"},
    {"id":"3442","label":"METAL DOORS, SASH, FRAMES, MOLDINGS & TRIM"},
    {"id":"3443","label":"FABRICATED PLATE WORK (BOILER SHOPS)"},
    {"id":"3444","label":"SHEET METAL WORK"},
    {"id":"3448","label":"PREFABRICATED METAL BUILDINGS & COMPONENTS"},
    {"id":"3451","label":"SCREW MACHINE PRODUCTS"},
    {"id":"3452","label":"BOLTS, NUTS, SCREWS, RIVETS & WASHERS"},
    {"id":"3460","label":"METAL FORGINGS & STAMPINGS"},
    {"id":"3470","label":"COATING, ENGRAVING & ALLIED SERVICES"},
    {"id":"3480","label":"ORDNANCE & ACCESSORIES, (NO VEHICLES\/GUIDED MISSILES)"},
    {"id":"3490","label":"MISCELLANEOUS FABRICATED METAL PRODUCTS"},
    {"id":"3510","label":"ENGINES & TURBINES"},
    {"id":"3523","label":"FARM MACHINERY & EQUIPMENT"},
    {"id":"3524","label":"LAWN & GARDEN TRACTORS & HOME LAWN & GARDENS EQUIP"},
    {"id":"3530","label":"CONSTRUCTION, MINING & MATERIALS HANDLING MACHINERY & EQUIP"},
    {"id":"3531","label":"CONSTRUCTION MACHINERY & EQUIP"},
    {"id":"3532","label":"MINING MACHINERY & EQUIP (NO OIL & GAS FIELD MACH & EQUIP)"},
    {"id":"3533","label":"OIL & GAS FIELD MACHINERY & EQUIPMENT"},
    {"id":"3537","label":"INDUSTRIAL TRUCKS, TRACTORS, TRAILORS & STACKERS"},
    {"id":"3540","label":"METALWORKG MACHINERY & EQUIPMENT"},
    {"id":"3541","label":"MACHINE TOOLS, METAL CUTTING TYPES"},
    {"id":"3550","label":"SPECIAL INDUSTRY MACHINERY (NO METALWORKING MACHINERY)"},
    {"id":"3555","label":"PRINTING TRADES MACHINERY & EQUIPMENT"},
    {"id":"3559","label":"SPECIAL INDUSTRY MACHINERY, NEC"},
    {"id":"3560","label":"GENERAL INDUSTRIAL MACHINERY & EQUIPMENT"},
    {"id":"3561","label":"PUMPS & PUMPING EQUIPMENT"},
    {"id":"3562","label":"BALL & ROLLER BEARINGS"},
    {"id":"3564","label":"INDUSTRIAL & COMMERCIAL FANS & BLOWERS & AIR PURIFING EQUIP"},
    {"id":"3567","label":"INDUSTRIAL PROCESS FURNACES & OVENS"},
    {"id":"3569","label":"GENERAL INDUSTRIAL MACHINERY & EQUIPMENT, NEC"},
    {"id":"3570","label":"COMPUTER & OFFICE EQUIPMENT"},
    {"id":"3571","label":"ELECTRONIC COMPUTERS"},
    {"id":"3572","label":"COMPUTER STORAGE DEVICES"},
    {"id":"3575","label":"COMPUTER TERMINALS"},
    {"id":"3576","label":"COMPUTER COMMUNICATIONS EQUIPMENT"},
    {"id":"3577","label":"COMPUTER PERIPHERAL EQUIPMENT, NEC"},
    {"id":"3578","label":"CALCULATING & ACCOUNTING MACHINES (NO ELECTRONIC COMPUTERS)"},
    {"id":"3579","label":"OFFICE MACHINES, NEC"},
    {"id":"3580","label":"REFRIGERATION & SERVICE INDUSTRY MACHINERY"},
    {"id":"3585","label":"AIR-COND & WARM AIR HEATG EQUIP & COMM & INDL REFRIG EQUIP"},
    {"id":"3590","label":"MISC INDUSTRIAL & COMMERCIAL MACHINERY & EQUIPMENT"},
    {"id":"3600","label":"ELECTRONIC & OTHER ELECTRICAL EQUIPMENT (NO COMPUTER EQUIP)"},
    {"id":"3612","label":"POWER, DISTRIBUTION & SPECIALTY TRANSFORMERS"},
    {"id":"3613","label":"SWITCHGEAR & SWITCHBOARD APPARATUS"},
    {"id":"3620","label":"ELECTRICAL INDUSTRIAL APPARATUS"},
    {"id":"3621","label":"MOTORS & GENERATORS"},
    {"id":"3630","label":"HOUSEHOLD APPLIANCES"},
    {"id":"3634","label":"ELECTRIC HOUSEWARES & FANS"},
    {"id":"3640","label":"ELECTRIC LIGHTING & WIRING EQUIPMENT"},
    {"id":"3651","label":"HOUSEHOLD AUDIO & VIDEO EQUIPMENT"},
    {"id":"3652","label":"PHONOGRAPH RECORDS & PRERECORDED AUDIO TAPES & DISKS"},
    {"id":"3661","label":"TELEPHONE & TELEGRAPH APPARATUS"},
    {"id":"3663","label":"RADIO & TV BROADCASTING & COMMUNICATIONS EQUIPMENT"},
    {"id":"3669","label":"COMMUNICATIONS EQUIPMENT, NEC"},
    {"id":"3670","label":"ELECTRONIC COMPONENTS & ACCESSORIES"},
    {"id":"3672","label":"PRINTED CIRCUIT BOARDS"},
    {"id":"3674","label":"SEMICONDUCTORS & RELATED DEVICES"},
    {"id":"3677","label":"ELECTRONIC COILS, TRANSFORMERS & OTHER INDUCTORS"},
    {"id":"3678","label":"ELECTRONIC CONNECTORS"},
    {"id":"3679","label":"ELECTRONIC COMPONENTS, NEC"},
    {"id":"3690","label":"MISCELLANEOUS ELECTRICAL MACHINERY, EQUIPMENT & SUPPLIES"},
    {"id":"3695","label":"MAGNETIC & OPTICAL RECORDING MEDIA"},
    {"id":"3711","label":"MOTOR VEHICLES & PASSENGER CAR BODIES"},
    {"id":"3713","label":"TRUCK & BUS BODIES"},
    {"id":"3714","label":"MOTOR VEHICLE PARTS & ACCESSORIES"},
    {"id":"3715","label":"TRUCK TRAILERS"},
    {"id":"3716","label":"MOTOR HOMES"},
    {"id":"3720","label":"AIRCRAFT & PARTS"},
    {"id":"3721","label":"AIRCRAFT"},
    {"id":"3724","label":"AIRCRAFT ENGINES & ENGINE PARTS"},
    {"id":"3728","label":"AIRCRAFT PARTS & AUXILIARY EQUIPMENT, NEC"},
    {"id":"3730","label":"SHIP & BOAT BUILDING & REPAIRING"},
    {"id":"3743","label":"RAILROAD EQUIPMENT"},
    {"id":"3751","label":"MOTORCYCLES, BICYCLES & PARTS"},
    {"id":"3760","label":"GUIDED MISSILES & SPACE VEHICLES & PARTS"},
    {"id":"3790","label":"MISCELLANEOUS TRANSPORTATION EQUIPMENT"},
    {"id":"3812","label":"SEARCH, DETECTION, NAVAGATION, GUIDANCE, AERONAUTICAL SYS"},
    {"id":"3821","label":"LABORATORY APPARATUS & FURNITURE"},
    {"id":"3822","label":"AUTO CONTROLS FOR REGULATING RESIDENTIAL & COMML ENVIRONMENTS"},
    {"id":"3823","label":"INDUSTRIAL INSTRUMENTS FOR MEASUREMENT, DISPLAY, AND CONTROL"},
    {"id":"3824","label":"TOTALIZING FLUID METERS & COUNTING DEVICES"},
    {"id":"3825","label":"INSTRUMENTS FOR MEAS & TESTING OF ELECTRICITY & ELEC SIGNALS"},
    {"id":"3826","label":"LABORATORY ANALYTICAL INSTRUMENTS"},
    {"id":"3827","label":"OPTICAL INSTRUMENTS & LENSES"},
    {"id":"3829","label":"MEASURING & CONTROLLING DEVICES, NEC"},
    {"id":"3841","label":"SURGICAL & MEDICAL INSTRUMENTS & APPARATUS"},
    {"id":"3842","label":"ORTHOPEDIC, PROSTHETIC & SURGICAL APPLIANCES & SUPPLIES"},
    {"id":"3843","label":"DENTAL EQUIPMENT & SUPPLIES"},
    {"id":"3844","label":"X-RAY APPARATUS & TUBES & RELATED IRRADIATION APPARATUS"},
    {"id":"3845","label":"ELECTROMEDICAL & ELECTROTHERAPEUTIC APPARATUS"},
    {"id":"3851","label":"OPHTHALMIC GOODS"},
    {"id":"3861","label":"PHOTOGRAPHIC EQUIPMENT & SUPPLIES"},
    {"id":"3873","label":"WATCHES, CLOCKS, CLOCKWORK OPERATED DEVICES\/PARTS"},
    {"id":"3910","label":"JEWELRY, SILVERWARE & PLATED WARE"},
    {"id":"3911","label":"JEWELRY, PRECIOUS METAL"},
    {"id":"3931","label":"MUSICAL INSTRUMENTS"},
    {"id":"3942","label":"DOLLS & STUFFED TOYS"},
    {"id":"3944","label":"GAMES, TOYS & CHILDREN'S VEHICLES (NO DOLLS & BICYCLES)"},
    {"id":"3949","label":"SPORTING & ATHLETIC GOODS, NEC"},
    {"id":"3950","label":"PENS, PENCILS & OTHER ARTISTS' MATERIALS"},
    {"id":"3960","label":"COSTUME JEWELRY & NOVELTIES"},
    {"id":"3990","label":"MISCELLANEOUS MANUFACTURING INDUSTRIES"},
    {"id":"D5","label":"Transportation, Communications, Electric, Gas and Sanitary service","start_sic":"4000","end_sic":"4999"},
    {"id":"4011","label":"RAILROADS, LINE-HAUL OPERATING"},
    {"id":"4013","label":"RAILROAD SWITCHING & TERMINAL ESTABLISHMENTS"},
    {"id":"4100","label":"LOCAL & SUBURBAN TRANSIT & INTERURBAN HWY PASSENGER TRANS"},
    {"id":"4210","label":"TRUCKING & COURIER SERVICES (NO AIR)"},
    {"id":"4213","label":"TRUCKING (NO LOCAL)"},
    {"id":"4220","label":"PUBLIC WAREHOUSING & STORAGE"},
    {"id":"4231","label":"TERMINAL MAINTENANCE FACILITIES FOR MOTOR FREIGHT TRANSPORT"},
    {"id":"4400","label":"WATER TRANSPORTATION"},
    {"id":"4412","label":"DEEP SEA FOREIGN TRANSPORTATION OF FREIGHT"},
    {"id":"4512","label":"AIR TRANSPORTATION, SCHEDULED"},
    {"id":"4513","label":"AIR COURIER SERVICES"},
    {"id":"4522","label":"AIR TRANSPORTATION, NONSCHEDULED"},
    {"id":"4581","label":"AIRPORTS, FLYING FIELDS & AIRPORT TERMINAL SERVICES"},
    {"id":"4610","label":"PIPE LINES (NO NATURAL GAS)"},
    {"id":"4700","label":"TRANSPORTATION SERVICES"},
    {"id":"4731","label":"ARRANGEMENT OF TRANSPORTATION OF FREIGHT & CARGO"},
    {"id":"4812","label":"RADIOTELEPHONE COMMUNICATIONS"},
    {"id":"4813","label":"TELEPHONE COMMUNICATIONS (NO RADIOTELEPHONE)"},
    {"id":"4822","label":"TELEGRAPH & OTHER MESSAGE COMMUNICATIONS"},
    {"id":"4832","label":"RADIO BROADCASTING STATIONS"},
    {"id":"4833","label":"TELEVISION BROADCASTING STATIONS"},
    {"id":"4841","label":"CABLE & OTHER PAY TELEVISION SERVICES"},
    {"id":"4899","label":"COMMUNICATIONS SERVICES, NEC"},
    {"id":"4900","label":"ELECTRIC, GAS & SANITARY SERVICES"},
    {"id":"4911","label":"ELECTRIC SERVICES"},
    {"id":"4922","label":"NATURAL GAS TRANSMISSION"},
    {"id":"4923","label":"NATURAL GAS TRANSMISISON & DISTRIBUTION"},
    {"id":"4924","label":"NATURAL GAS DISTRIBUTION"},
    {"id":"4931","label":"ELECTRIC & OTHER SERVICES COMBINED"},
    {"id":"4932","label":"GAS & OTHER SERVICES COMBINED"},
    {"id":"4941","label":"WATER SUPPLY"},
    {"id":"4950","label":"SANITARY SERVICES"},
    {"id":"4953","label":"REFUSE SYSTEMS"},
    {"id":"4955","label":"HAZARDOUS WASTE MANAGEMENT"},
    {"id":"4961","label":"STEAM & AIR-CONDITIONING SUPPLY"},
    {"id":"4991","label":"COGENERATION SERVICES & SMALL POWER PRODUCERS"},
    {"id":"D6","label":"Wholesale Trade","start_sic":"5000","end_sic":"5199"},
    {"id":"5000","label":"WHOLESALE-DURABLE GOODS"},
    {"id":"5010","label":"WHOLESALE-MOTOR VEHICLES & MOTOR VEHICLE PARTS & SUPPLIES"},
    {"id":"5013","label":"WHOLESALE-MOTOR VEHICLE SUPPLIES & NEW PARTS"},
    {"id":"5020","label":"WHOLESALE-FURNITURE & HOME FURNISHINGS"},
    {"id":"5030","label":"WHOLESALE-LUMBER & OTHER CONSTRUCTION MATERIALS"},
    {"id":"5031","label":"WHOLESALE-LUMBER, PLYWOOD, MILLWORK & WOOD PANELS"},
    {"id":"5040","label":"WHOLESALE-PROFESSIONAL & COMMERCIAL EQUIPMENT & SUPPLIES"},
    {"id":"5045","label":"WHOLESALE-COMPUTERS & PERIPHERAL EQUIPMENT & SOFTWARE"},
    {"id":"5047","label":"WHOLESALE-MEDICAL, DENTAL & HOSPITAL EQUIPMENT & SUPPLIES"},
    {"id":"5050","label":"WHOLESALE-METALS & MINERALS (NO PETROLEUM)"},
    {"id":"5051","label":"WHOLESALE-METALS SERVICE CENTERS & OFFICES"},
    {"id":"5063","label":"WHOLESALE-ELECTRICAL APPARATUS & EQUIPMENT, WIRING SUPPLIES"},
    {"id":"5064","label":"WHOLESALE-ELECTRICAL APPLIANCES, TV & RADIO SETS"},
    {"id":"5065","label":"WHOLESALE-ELECTRONIC PARTS & EQUIPMENT, NEC"},
    {"id":"5070","label":"WHOLESALE-HARDWARE & PLUMBING & HEATING EQUIPMENT & SUPPLIES"},
    {"id":"5072","label":"WHOLESALE-HARDWARE"},
    {"id":"5080","label":"WHOLESALE-MACHINERY, EQUIPMENT & SUPPLIES"},
    {"id":"5082","label":"WHOLESALE-CONSTRUCTION & MINING (NO PETRO) MACHINERY & EQUIP"},
    {"id":"5084","label":"WHOLESALE-INDUSTRIAL MACHINERY & EQUIPMENT"},
    {"id":"5090","label":"WHOLESALE-MISC DURABLE GOODS"},
    {"id":"5094","label":"WHOLESALE-JEWELRY, WATCHES, PRECIOUS STONES & METALS"},
    {"id":"5099","label":"WHOLESALE-DURABLE GOODS, NEC"},
    {"id":"5110","label":"WHOLESALE-PAPER & PAPER PRODUCTS"},
    {"id":"5122","label":"WHOLESALE-DRUGS, PROPRIETARIES & DRUGGISTS' SUNDRIES"},
    {"id":"5130","label":"WHOLESALE-APPAREL, PIECE GOODS & NOTIONS"},
    {"id":"5140","label":"WHOLESALE-GROCERIES & RELATED PRODUCTS"},
    {"id":"5141","label":"WHOLESALE-GROCERIES, GENERAL LINE"},
    {"id":"5150","label":"WHOLESALE-FARM PRODUCT RAW MATERIALS"},
    {"id":"5160","label":"WHOLESALE-CHEMICALS & ALLIED PRODUCTS"},
    {"id":"5171","label":"WHOLESALE-PETROLEUM BULK STATIONS & TERMINALS"},
    {"id":"5172","label":"WHOLESALE-PETROLEUM & PETROLEUM PRODUCTS (NO BULK STATIONS)"},
    {"id":"5180","label":"WHOLESALE-BEER, WINE & DISTILLED ALCOHOLIC BEVERAGES"},
    {"id":"5190","label":"WHOLESALE-MISCELLANEOUS NONDURABLE GOODS"},
    {"id":"D7","label":"Retail Trade","start_sic":"5200","end_sic":"5999"},
    {"id":"5200","label":"RETAIL-BUILDING MATERIALS, HARDWARE, GARDEN SUPPLY"},
    {"id":"5211","label":"RETAIL-LUMBER & OTHER BUILDING MATERIALS DEALERS"},
    {"id":"5271","label":"RETAIL-MOBILE HOME DEALERS"},
    {"id":"5311","label":"RETAIL-DEPARTMENT STORES"},
    {"id":"5331","label":"RETAIL-VARIETY STORES"},
    {"id":"5399","label":"RETAIL-MISC GENERAL MERCHANDISE STORES"},
    {"id":"5400","label":"RETAIL-FOOD STORES"},
    {"id":"5411","label":"RETAIL-GROCERY STORES"},
    {"id":"5412","label":"RETAIL-CONVENIENCE STORES"},
    {"id":"5500","label":"RETAIL-AUTO DEALERS & GASOLINE STATIONS"},
    {"id":"5531","label":"RETAIL-AUTO & HOME SUPPLY STORES"},
    {"id":"5600","label":"RETAIL-APPAREL & ACCESSORY STORES"},
    {"id":"5621","label":"RETAIL-WOMEN'S CLOTHING STORES"},
    {"id":"5651","label":"RETAIL-FAMILY CLOTHING STORES"},
    {"id":"5661","label":"RETAIL-SHOE STORES"},
    {"id":"5700","label":"RETAIL-HOME FURNITURE, FURNISHINGS & EQUIPMENT STORES"},
    {"id":"5712","label":"RETAIL-FURNITURE STORES"},
    {"id":"5731","label":"RETAIL-RADIO, TV & CONSUMER ELECTRONICS STORES"},
    {"id":"5734","label":"RETAIL-COMPUTER & COMPUTER SOFTWARE STORES"},
    {"id":"5735","label":"RETAIL-RECORD & PRERECORDED TAPE STORES"},
    {"id":"5810","label":"RETAIL-EATING & DRINKING PLACES"},
    {"id":"5812","label":"RETAIL-EATING PLACES"},
    {"id":"5900","label":"RETAIL-MISCELLANEOUS RETAIL"},
    {"id":"5912","label":"RETAIL-DRUG STORES AND PROPRIETARY STORES"},
    {"id":"5940","label":"RETAIL-MISCELLANEOUS SHOPPING GOODS STORES"},
    {"id":"5944","label":"RETAIL-JEWELRY STORES"},
    {"id":"5945","label":"RETAIL-HOBBY, TOY & GAME SHOPS"},
    {"id":"5960","label":"RETAIL-NONSTORE RETAILERS"},
    {"id":"5961","label":"RETAIL-CATALOG & MAIL-ORDER HOUSES"},
    {"id":"5990","label":"RETAIL-RETAIL STORES, NEC"},
    {"id":"D8","label":"Finance, Insurance and Real Estate","start_sic":"6000","end_sic":"6799"},
    {"id":"6021","label":"NATIONAL COMMERCIAL BANKS"},
    {"id":"6022","label":"STATE COMMERCIAL BANKS"},
    {"id":"6029","label":"COMMERCIAL BANKS, NEC"},
    {"id":"6035","label":"SAVINGS INSTITUTION, FEDERALLY CHARTERED"},
    {"id":"6036","label":"SAVINGS INSTITUTIONS, NOT FEDERALLY CHARTERED"},
    {"id":"6099","label":"FUNCTIONS RELATED TO DEPOSITORY BANKING, NEC"},
    {"id":"6111","label":"FEDERAL & FEDERALLY-SPONSORED CREDIT AGENCIES"},
    {"id":"6141","label":"PERSONAL CREDIT INSTITUTIONS"},
    {"id":"6153","label":"SHORT-TERM BUSINESS CREDIT INSTITUTIONS"},
    {"id":"6159","label":"MISCELLANEOUS BUSINESS CREDIT INSTITUTION"},
    {"id":"6162","label":"MORTGAGE BANKERS & LOAN CORRESPONDENTS"},
    {"id":"6163","label":"LOAN BROKERS"},
    {"id":"6172","label":"FINANCE LESSORS"},
    {"id":"6189","label":"ASSET-BACKED SECURITIES"},
    {"id":"6199","label":"FINANCE SERVICES"},
    {"id":"6200","label":"SECURITY & COMMODITY BROKERS, DEALERS, EXCHANGES & SERVICES"},
    {"id":"6211","label":"SECURITY BROKERS, DEALERS & FLOTATION COMPANIES"},
    {"id":"6221","label":"COMMODITY CONTRACTS BROKERS & DEALERS"},
    {"id":"6282","label":"INVESTMENT ADVICE"},
    {"id":"6311","label":"LIFE INSURANCE"},
    {"id":"6321","label":"ACCIDENT & HEALTH INSURANCE"},
    {"id":"6324","label":"HOSPITAL & MEDICAL SERVICE PLANS"},
    {"id":"6331","label":"FIRE, MARINE & CASUALTY INSURANCE"},
    {"id":"6351","label":"SURETY INSURANCE"},
    {"id":"6361","label":"TITLE INSURANCE"},
    {"id":"6399","label":"INSURANCE CARRIERS, NEC"},
    {"id":"6411","label":"INSURANCE AGENTS, BROKERS & SERVICE"},
    {"id":"6500","label":"REAL ESTATE"},
    {"id":"6510","label":"REAL ESTATE OPERATORS (NO DEVELOPERS) & LESSORS"},
    {"id":"6512","label":"OPERATORS OF NONRESIDENTIAL BUILDINGS"},
    {"id":"6513","label":"OPERATORS OF APARTMENT BUILDINGS"},
    {"id":"6519","label":"LESSORS OF REAL PROPERTY, NEC"},
    {"id":"6531","label":"REAL ESTATE AGENTS & MANAGERS (FOR OTHERS)"},
    {"id":"6532","label":"REAL ESTATE DEALERS (FOR THEIR OWN ACCOUNT)"},
    {"id":"6552","label":"LAND SUBDIVIDERS & DEVELOPERS (NO CEMETERIES)"},
    {"id":"6770","label":"BLANK CHECKS"},
    {"id":"6792","label":"OIL ROYALTY TRADERS"},
    {"id":"6794","label":"PATENT OWNERS & LESSORS"},
    {"id":"6795","label":"MINERAL ROYALTY TRADERS"},
    {"id":"6798","label":"REAL ESTATE INVESTMENT TRUSTS"},
    {"id":"6799","label":"INVESTORS, NEC"},
    {"id":"D9","label":"Services","start_sic":"7000","end_sic":"8999"},
    {"id":"7000","label":"HOTELS, ROOMING HOUSES, CAMPS & OTHER LODGING PLACES"},
    {"id":"7011","label":"HOTELS & MOTELS"},
    {"id":"7200","label":"SERVICES-PERSONAL SERVICES"},
    {"id":"7310","label":"SERVICES-ADVERTISING"},
    {"id":"7311","label":"SERVICES-ADVERTISING AGENCIES"},
    {"id":"7320","label":"SERVICES-CONSUMER CREDIT REPORTING, COLLECTION AGENCIES"},
    {"id":"7330","label":"SERVICES-MAILING, REPRODUCTION, COMMERCIAL ART & PHOTOGRAPHY"},
    {"id":"7331","label":"SERVICES-DIRECT MAIL ADVERTISING SERVICES"},
    {"id":"7340","label":"SERVICES-TO DWELLINGS & OTHER BUILDINGS"},
    {"id":"7350","label":"SERVICES-MISCELLANEOUS EQUIPMENT RENTAL & LEASING"},
    {"id":"7359","label":"SERVICES-EQUIPMENT RENTAL & LEASING, NEC"},
    {"id":"7361","label":"SERVICES-EMPLOYMENT AGENCIES"},
    {"id":"7363","label":"SERVICES-HELP SUPPLY SERVICES"},
    {"id":"7370","label":"SERVICES-COMPUTER PROGRAMMING, DATA PROCESSING, ETC."},
    {"id":"7371","label":"SERVICES-COMPUTER PROGRAMMING SERVICES"},
    {"id":"7372","label":"SERVICES-PREPACKAGED SOFTWARE"},
    {"id":"7373","label":"SERVICES-COMPUTER INTEGRATED SYSTEMS DESIGN"},
    {"id":"7374","label":"SERVICES-COMPUTER PROCESSING & DATA PREPARATION"},
    {"id":"7377","label":"SERVICES-COMPUTER RENTAL & LEASING"},
    {"id":"7380","label":"SERVICES-MISCELLANEOUS BUSINESS SERVICES"},
    {"id":"7381","label":"SERVICES-DETECTIVE, GUARD & ARMORED CAR SERVICES"},
    {"id":"7384","label":"SERVICES-PHOTOFINISHING LABORATORIES"},
    {"id":"7385","label":"SERVICES-TELEPHONE INTERCONNECT SYSTEMS"},
    {"id":"7389","label":"SERVICES-BUSINESS SERVICES, NEC"},
    {"id":"7500","label":"SERVICES-AUTOMOTIVE REPAIR, SERVICES & PARKING"},
    {"id":"7510","label":"SERVICES-AUTO RENTAL & LEASING (NO DRIVERS)"},
    {"id":"7600","label":"SERVICES-MISCELLANEOUS REPAIR SERVICES"},
    {"id":"7812","label":"SERVICES-MOTION PICTURE & VIDEO TAPE PRODUCTION"},
    {"id":"7819","label":"SERVICES-ALLIED TO MOTION PICTURE PRODUCTION"},
    {"id":"7822","label":"SERVICES-MOTION PICTURE & VIDEO TAPE DISTRIBUTION"},
    {"id":"7829","label":"SERVICES-ALLIED TO MOTION PICTURE DISTRIBUTION"},
    {"id":"7830","label":"SERVICES-MOTION PICTURE THEATERS"},
    {"id":"7841","label":"SERVICES-VIDEO TAPE RENTAL"},
    {"id":"7900","label":"SERVICES-AMUSEMENT & RECREATION SERVICES"},
    {"id":"7948","label":"SERVICES-RACING, INCLUDING TRACK OPERATION"},
    {"id":"7990","label":"SERVICES-MISCELLANEOUS AMUSEMENT & RECREATION"},
    {"id":"7997","label":"SERVICES-MEMBERSHIP SPORTS & RECREATION CLUBS"},
    {"id":"8000","label":"SERVICES-HEALTH SERVICES"},
    {"id":"8011","label":"SERVICES-OFFICES & CLINICS OF DOCTORS OF MEDICINE"},
    {"id":"8050","label":"SERVICES-NURSING & PERSONAL CARE FACILITIES"},
    {"id":"8051","label":"SERVICES-SKILLED NURSING CARE FACILITIES"},
    {"id":"8060","label":"SERVICES-HOSPITALS"},
    {"id":"8062","label":"SERVICES-GENERAL MEDICAL & SURGICAL HOSPITALS, NEC"},
    {"id":"8071","label":"SERVICES-MEDICAL LABORATORIES"},
    {"id":"8082","label":"SERVICES-HOME HEALTH CARE SERVICES"},
    {"id":"8090","label":"SERVICES-MISC HEALTH & ALLIED SERVICES, NEC"},
    {"id":"8093","label":"SERVICES-SPECIALTY OUTPATIENT FACILITIES, NEC"},
    {"id":"8111","label":"SERVICES-LEGAL SERVICES"},
    {"id":"8200","label":"SERVICES-EDUCATIONAL SERVICES"},
    {"id":"8300","label":"SERVICES-SOCIAL SERVICES"},
    {"id":"8351","label":"SERVICES-CHILD DAY CARE SERVICES"},
    {"id":"8600","label":"SERVICES-MEMBERSHIP ORGANIZATIONS"},
    {"id":"8700","label":"SERVICES-ENGINEERING, ACCOUNTING, RESEARCH, MANAGEMENT"},
    {"id":"8711","label":"SERVICES-ENGINEERING SERVICES"},
    {"id":"8731","label":"SERVICES-COMMERCIAL PHYSICAL & BIOLOGICAL RESEARCH"},
    {"id":"8734","label":"SERVICES-TESTING LABORATORIES"},
    {"id":"8741","label":"SERVICES-MANAGEMENT SERVICES"},
    {"id":"8742","label":"SERVICES-MANAGEMENT CONSULTING SERVICES"},
    {"id":"8744","label":"SERVICES-FACILITIES SUPPORT MANAGEMENT SERVICES"},
    {"id":"8880","label":"AMERICAN DEPOSITARY RECEIPTS"},
    {"id":"8888","label":"FOREIGN GOVERNMENTS"},
    {"id":"8900","label":"SERVICES-SERVICES, NEC"},
    {"id":"D10","label":"Public Administration","start_sic":"9100","end_sic":"9729"},
    {"id":"9721","label":"INTERNATIONAL AFFAIRS"},
    {"id":"D11","label":"Nonclassifiable","start_sic":"9900","end_sic":"9999"},
    {"id":"9995","label":"NON-OPERATING ESTABLISHMENTS"}
];

var XLS_Forms = {
    "1-A": "xsl1-A_X01",
    "1-K": "xsl1-K_X01",
    "1-Z": "xsl1-Z_X01",
    "3": "xslF345X03",
    "4": "xslF345X03",
    "5": "xslF345X03",
    "CFPORTAL": "xslCFPORTAL_X01",
    "C": "xslC_X01",
    "EFFECT": "xslEFFECT_X02",
    "Form13F": "xslForm13F_X01",
    "Form25": "xslForm25_X02",
    "FormD": "xslFormD_X01",
    "FormN-MFP": "xslFormN-MFP_X01",
    "FormTA": "xslFormTA_X01",
    "13F": "xslForm13F_X01",
    "25": "xslForm25_X02",
    "D": "xslFormDX01",
    "N-MFP": "xslFormN-MFP_X01",
    "TA": "xslFormTA_X01",
    "MA-I": "xslMA-I_X01",
    "MA-W": "xslMA-W_X01",
    "MA": "xslMA_X01",
    "N-CEN": "xslN-CEN_X01",
    "N-MFP1": "xslN-MFP1_X01",
    "N-MFP2": "xslN-MFP2_X01",
    "NPORT-NP": "xslNPORT-NP_X01",
    "NPORT-P": "xslNPORT-P_X01",
    "QUALIF": "xslQUALIF_X01",
    "SBSE-A": "xslSBSE-A_X01",
    "SBSE-BD": "xslSBSE-BD_X01",
    "SBSE-C": "xslSBSE-C_X01",
    "SBSE-W": "xslSBSE-W_X01",
    "SBSE": "xslSBSE_X01",
    "SDR": "xslSDR_X01",
    "TA-1": "xslTA-1_X06",
    "TA-2": "xslTA-2_X06",
    "TA-W": "xslTA-W_X06",
    "X-17A-5": "xslX-17A-5_X01",
};

var formCategories = [
    {"category": "All Annual, Periodic, and Current Reports", "forms":["1-K","1-SA","1-U","1-Z","1-Z-W","10-D","10-K","10-KT","10-Q","10-QT","11-K","11-KT","13F-HR","13F-NT","15-12B","15-12G","15-15D","15F-12B","15F-12G","15F-15D","18-K","20-F","24F-2NT","25","25-NSE","40-17F2","40-17G","40-F","6-K","8-K","8-K12G3","8-K15D5","ABS-15G","ABS-EE","ANNLRPT","DSTRBRPT","IRANNOTICE","N-30B-2","N-30D","N-CEN","N-CSR","N-CSRS","N-MFP","N-MFP1","N-MFP2","N-PX","N-Q","NPORT-EX","NSAR-A","NSAR-B","NSAR-U","NT 10-D","NT 10-K","NT 10-Q","NT 11-K","NT 20-F","QRTLYRPT","SD","SP 15D2"]},

    {"category": "&nbsp;&nbsp;Operating Company Annual, Periodic, and Current Reports", "forms":["1-U","1-Z","1-Z-W","10-D","10-K","10-KT","10-Q","10-QT","11-K","11-KT","15-12B","15-12G","15-15D","15F-12B","15F-12G","15F-15D","18-K","20-F","25","25-NSE","40-17F2","40-17G","40-F","6-K","8-K","8-K12G3","8-K15D5","ABS-15G","ABS-EE","ANNLRPT","DSTRBRPT","IRANNOTICE","N-30B-2","N-30D","N-CEN","N-CSR","N-CSRS","N-MFP","N-MFP1","N-MFP2","N-PX","N-Q","NPORT-EX","NSAR-A","NSAR-B","NSAR-U","NT 10-D","NT 10-K","NT 10-Q","NT 11-K","NT 20-F","QRTLYRPT","SD","SP 15D2"]},
    {"category": "&nbsp;&nbsp;Investment Company Annual, Periodic, and Current Reports", "forms":["1-K","1-SA","10-Q","10-QT","13F-HR","13F-NT","24F-2NT","40-17F2","40-17G","40-F","6-K","8-K","8-K12G3","8-K15D5","ABS-15G","ABS-EE","ANNLRPT","DSTRBRPT","IRANNOTICE","N-30B-2","N-30D","N-CEN","N-CSR","N-CSRS","N-MFP","N-MFP1","N-MFP2","N-PX","N-Q","NPORT-EX","NSAR-A","NSAR-B","NSAR-U","NT 10-D","NT 10-K","NT 10-Q","NT 11-K","NT 20-F","QRTLYRPT","SD","SP 15D2"]},

    {"category": "Insider Equity Awards, Transactions, and Ownersip (Section 16 Reports)", "forms":["3","4","5"]},
    {"category": "Beneficial Ownership Reports", "forms":["SC 13D","SC 13G","SC14D1F"]},
    {"category": "Exempt Offerings", "forms":["1-A","1-A POS","1-A-W","253G1","253G2","253G3","253G4","D","DOS"]},
    {"category":"Registration Statements", "forms":["10-12B","10-12G","18-12B","20FR12B","20FR12G","40-24B2","40FR12B","40FR12G","424A","424B1","424B2","424B3","424B4","424B5","424B7","424B8","424H","425","485APOS","485BPOS","485BXT","487","497","497J","497K","8-A12B","8-A12G","AW","AW WD","DEL AM","DRS","F-1","F-10","F-10EF","F-10POS","F-3","F-3ASR","F-3D","F-3DPOS","F-3MEF","F-4","F-4 POS","F-4MEF","F-6","F-6 POS","F-6EF","F-7","F-7 POS","F-8","F-8 POS","F-80","F-80POS","F-9","F-9 POS","F-N","F-X","FWP","N-2","POS AM","POS EX","POS462B","POS462C","POSASR","RW","RW WD","S-1","S-11","S-11MEF","S-1MEF","S-20","S-3","S-3ASR","S-3D","S-3DPOS","S-3MEF","S-4","S-4 POS","S-4EF","S-4MEF","S-6","S-8","S-8 POS","S-B","S-BMEF","SF-1","SF-3","SUPPL","UNDER"]},
    {"category":"Filing Review Correspondence", "forms":["CORRESP","DOSLTR","DRSLTR","UPLOAD"]},
    {"category":"SEC Orders and Notices", "forms":["40-APP","CT ORDER","EFFECT","QUALIF","REVOKED"]},
    {"category":"Proxy Materials", "forms":["ARS","DEF 14A","DEF 14C","DEFA14A","DEFA14C","DEFC14A","DEFC14C","DEFM14A","DEFM14C","DEFN14A","DEFR14A","DEFR14C","DFAN14A","DFRN14A","PRE 14A","PRE 14C","PREC14A","PREC14C","PREM14A","PREM14C","PREN14A","PRER14A","PRER14C","PRRN14A","PX14A6G","PX14A6N","SC 14N"]},
    {"category":"Tender Offers and Going Private Transactions", "forms":["CB","SC 13E1","SC 13E3","SC 14D9","SC 14F1","SC TO-C","SC TO-I","SC TO-T","SC13E4F","SC14D9C","SC14D9F"]},
    {"category":"Trust Indenture Filings", "forms":["305B2","T-3"]}
];