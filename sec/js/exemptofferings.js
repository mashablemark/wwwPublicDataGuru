"use strict";
/**
 * Created by Mark Elbert on 10/26/2018.
 *
 * 1. on doc ready
 *   a. create action toggle button acquire/dispose
 *   b. create date slider (begin and end)
 * 2. hash change, detect whether a reporter CIK or issuer company is requesed:
 *   a. if in-memory storage, call showOwnership(cik)
 *   b. if not in memory, fetch from api.php (process=reporter or issuer), store in memory and call showOwnership(cik)
 * 3. showOwnership(cik)
 *   a. clear existing data tables and filter drop-down combo
 *   b. from in-mem API data data in raw relational state:
 *     - build aryTransactions
 *     - build aryOwners / aryIssuers depending on request
 *   c. create interactive tblTransactions using dataTables
 *   d. fill drop down filter values from aryOwner / aryIssues
 *   e. fill forms drop down filter
 *   f. fill transaction type drop-down
 *   g. set begin and end data and date slider limits
 *
 */
var exemptOfferingData = {};
var dtExemptOfferings = false;
var transactionDates;
var filterDates = ['',''];
var view;
var counter = {
    'reporter': 'issuer',
    issuer: 'reporter'
};


$(document).ready(function() {
    //initialize filter controls and define change events
    $( "#cikFilter" ).combobox({
        select: filterControlChanged
    });
    $("#acquireddisposedFilter").controlgroup({classes: {"ui-controlgroup-item": "inviz"}}).change(filterControlChanged);
    $("#formFilter").change(filterControlChanged);
    $("#codeFilter").change(filterControlChanged);
    $("#dateSlider").innerWidth($('#filter').innerWidth()-30-2*$('#startDateFilter').outerWidth(true)).css('left', '110px')
        .slider({
        range: true,
        min: 0,
        max: 1,
        values: [0,1],
        slide: sliderChange,
        change: sliderChange,
        stop: function( event, ui ){
            filterControlChanged();
        }
    });

    function sliderChange(event, ui ){  //mouse-move event
        var selector = ui.handleIndex==0?'#startDateFilter':'#endDateFilter';
        $(selector).html(transactionDates[ui.value]);
    }
    //setup hash listener
    hasher.changed.add(hashChangeHandler); //add hash change listener
    hasher.initialized.add(hashChangeHandler); //add initialized listener (to grab initial value in case it is already set)
    hasher.init();
    $.fn.dataTable.ext.search.push(
        function( settings, data, dataIndex ) {
            if(filterDates[0] && data[6]<filterDates[0]) return false;
            if(filterDates[1] && data[6]>filterDates[1]) return false;
            return true;
        });
    $('#reset').button({icon: 'ui-icon-refresh'}).click(function(){
        resetFilterValues();
        filterControlChanged();
    });
});

function filterControlChanged(){
    //a. read control value
    var filters = {};
    var pageOptions = optionsFromHash(hasher.getHash());
    filters.ad = $("#acquireddisposedFilter input:checked").val();
    filters.form = $("#formFilter").val();
    filters.code = $("#codeFilter").val();
    filters[pageOptions.view=='reporter'?'issuer':'reporter'] = $("#cikFilter").val();
    var startLabel = $("#startDateFilter").html(),
        endLabel = $("#endDateFilter").html();
    filters.start = startLabel==transactionDates[0] ? '' : startLabel;
    filters.end = endLabel==transactionDates[transactionDates.length-1] ? '' : endLabel;
    //b. set hash, which triggers has change event handler by hashChangeHandler
    var updatedHash = 'view='+pageOptions.view + '&' + pageOptions.view + '=' + pageOptions[pageOptions.view];
    var resetState = false;
    for(var filter in filters){
        if(filters[filter] && filters[filter]!='all') {
            updatedHash += '&' + filter + '=' + filters[filter];
            resetState = true;
        }

    }
    hasher.setHash(updatedHash);  //note: this will indirectly fire hashChangeHandler()
    $('#reset').button(resetState ? 'enable' : 'disable');
}

//handle hash changes (fires on page load too!)
function hashChangeHandler(newHash, oldHash){
    $('body').mask('loading data...');
    window.setTimeout(function(){  //allow mask to render
        console.time('HashChange');
        var newOptions = optionsFromHash(newHash),
            oldOptions = optionsFromHash(oldHash),
            isNewView = !oldHash  || newOptions.y != oldOptions.y;
        if(isNewView){
            //new data set = 1. fetch data (from cache or API)
            getExemptOfferingData(newOptions.y, function(data){
                console.log('fetched data');
                console.timeLog('HashChange');
                //2. fill controls
                //fillFilterControls(newOptions, data);

                console.log('set filter controls');
                console.timeLog('HashChange');
                //3. display header info
                //displayHeader(data);
                //4. load table ELSE refill data and redraw
                loadExemptOfferingsTable(newOptions, data);
                //5. clear any lingering search filters
                //filterTable(newOptions);
                console.timeEnd('HashChange');
                $('body').unmask();
            });
        } else {
            //existing data set = filter
            filterTable(newOptions);
            $('body').unmask();
        }
    }, 10);

    console.log(newHash);
}

function optionsFromHash(hashString){
    if(!hashString) return null;
    var hashOptions = {};
    hashString.split('&').forEach(function(optionLine){
        hashOptions[optionLine.split('=')[0]] = optionLine.split('=')[1] || true
    });  //valid control values must not include 0 or false
    return hashOptions;
}

function getExemptOfferingData(yyyyQq, callback){
    if(exemptOfferingData[yyyyQq]){
        callback(exemptOfferingData[yyyyQq]);
    } else {
        var url = 'https://restapi.publicdata.guru/sec/offerings/exempt/exemptOfferingSummary' + yyyyQq + '.json';
        $.ajax({
            dataType: 'JSON',
            url: url,
            type: 'get',
            success: function (data, status) {
                console.log('successfully fetched ' + url);
                callback(data);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                if(fail){
                    fail(url);
                } else {
                    console.log(textStatus);
                    throw(errorThrown);
                }
            }
        });
    }
}

function fillFilterControls(options, data){
    var distinctForms = [],
        distinctCodes = [],
        distinctCIKs = [],
        cikTree = {},
        distinctDates = [],
        cikFilterType = options.view=='issuer'?'reporter':'issuer'; //opposite of view

    for(var t in data.transactions){
        var trans = data.transactions[t];
        //build arrays of distinct values for the controls
        if(distinctForms.indexOf(trans[0])==-1) distinctForms.push(trans[0]);
        if(distinctCodes.indexOf(trans[3])==-1) distinctCodes.push(trans[3]);
        if(distinctDates.indexOf(trans[6])==-1) distinctDates.push(trans[6]);
        if(!cikTree[trans[9]]) cikTree[trans[9]] = trans[8];
    }

    //form select filter
    var formOptions = '';
    distinctForms.sort().forEach(function(item, index){
        formOptions += '<option value="' + item + '"' + (options.form == trans[0]?' selected':'') + '>form ' + item + '</option>';
    });
    $("#formFilter").find('option:gt(0)').remove().end().append(formOptions);

    //transaction code select filter
    var codeOptions = '';
    distinctCodes.sort().forEach(function(item, index){
        codeOptions += '<option value="' + item + '"' + (options.code == trans[3]?' selected':'') + '>' + item + ': ' + transactionCodes[item] + '</option>';
    });
    $("#codeFilter").find('option:gt(0)').remove().end().append(codeOptions);

    //issuer|reporter cik combobox filter
    for(var cik in cikTree){
        distinctCIKs.push({cik: cik, name: cikTree[cik]});
    }
    var nameOptions = '';
    distinctCIKs.sort(function(a,b){return a.name==b.name?0:(a.name>b.name?1:-1)}).forEach(function(item, index){
        nameOptions += '<option value="' + item.cik + '"' + (options[cikFilterType] == item.cik?' selected':'') + '> ' + item.name + '</option>';
    });
    $("#cikFilter").find('option:gt(0)').remove().end().append(nameOptions);

    transactionDates = distinctDates.sort();
    $( "#dateSlider" ).slider({
        range: true,
        max: transactionDates.length-1,
        values: [0, transactionDates.length - 1]
    });
    resetFilterValues();
}

function resetFilterValues(){
    $("#cikFilter").val('all').parent().find('input').val('');
    $("#both").prop("checked", true);
    $("#acquireddisposedFilter input[name='acquireddisposed'][value='all']").prop('checked', true);
    $("#acquireddisposedFilter").controlgroup('refresh');
    $("#codeFilter").val('all');
    $("#formFilter").val('all');
    $('#reset').button('disable');
    $("#dateSlider" ).slider('values', [0, transactionDates.length-1]);
}

function loadExemptOfferingsTable(options, data){
    view = data.view;
    // a. clear existing data tables
    //if(dtExemptOfferings) dtExemptOfferings.destroy();
    console.log('destroyed datatable');
    console.timeLog('HashChange');
    // b. from in-mem relational API data:
    //   - build aryTransactions
    var t, startDate = false, endDate = false, names = {}, dates=[];
    //   - build aryOwners / aryIssuers depending on request
    var height = window.innerHeight - $('#filter').outerHeight() - Math.max($('#header').outerHeight(),75) -220;
    if(!dtExemptOfferings){
        dtExemptOfferings = $('table#transactions').DataTable( {
            data: data.exemptOfferings,
            dom: 'Bfrtip',
            columns: [
                {   title: "Accepted", className: "dt-body-center", data: "accepted" },
                {   title: "Primary Issuer",
                    render: function (data, type, row, meta) {
                        return '<a href="https://www.sec.gov/Archives/edgar/data/' + row.adsh + '/' + row.adsh.replace(/-/g,'') + '/' + row.adsh+ '-index.html">' + row.issuers[0].name+ '</a>';
                    }
                },
                {   title: "Inc Year", render: function (data, type, row, meta) {return row.issuers[0].yearOfInc}},
                {   title: "Incorporated", render: function (data, type, row, meta) {return row.issuers[0].stateOrCountry}},
                {   title: "Offering", render: function (data, type, row, meta) {return (isNaN(row.offering)?"":"$") + row.offering}},
                {   title: "Sold", render: function (data, type, row, meta) {return (isNaN(row.sold)?"":"$") + row.sold}},
                {   title: "Remaining", render: function (data, type, row, meta) {return (isNaN(row.remaining)?"":"$") + row.remaining}},
                {   title: "Min Investment", render: function (data, type, row, meta) {return (isNaN(row.minInvestmnet)?"":"$") + row.minInvestmnet}},
                {   title: "Investors", render: function (data, type, row, meta) {return (isNaN(row.investorCount)?"":"$") + row.investorCount}},
                {   title: "Exemptions & Exclusions", className: "dt-body-center", data: "federalExemptionsExclusions"},
                {   title: "Related Persons", className: "dt-body-center",
                    render: function (data, type, row, meta) { return row.persons.join("<BR>");}
                }
            ],
            scrollY:        height + "px",
            scrollX: false,
            scrollCollapse: true,
            scroller: {rowHeight: 'auto'},
            deferRender: true,
            oLanguage: {"sSearch": "Text search"},
            order: [[6, 'desc']],
            buttons: [
                'copy',
                {
                    extend: 'excelHtml5',
                    action: function(e, dt, node, config) {
                        $('body').mask('Generating Excel file.  Download will start shortly.');
                        var me = this;
                        setTimeout(function(){
                            $.fn.dataTable.ext.buttons.excelHtml5.action.call(me, e, dt, node, config);
                            $('body').unmask();
                        }, 10);
                    }

                },
                {
                    extend: 'csvHtml5',
                    action: function(e, dt, node, config) {
                        $('body').mask('Generating CSV.  Download will start shortly.');
                        var me = this;
                        setTimeout(function(){
                            $.fn.dataTable.ext.buttons.csvHtml5.action.call(me, e, dt, node, config);
                            $('body').unmask();
                        }, 10);
                    }

                },
                /*{
                    extend: 'pdfHtml5',
                    pageSize: 'letter',
                    orientation: 'landscape',
                    customize: function (doc) {
                        doc.defaultStyle.fontSize = 6; //<-- set fontsize to 6 instead of 10
                        doc.styles.tableHeader.fontSize = 7;
                    },
                    action: function(e, dt, node, config) {
                        $('body').mask('Generating PDF.  Download will start shortly.');
                        var me = this;
                        setTimeout(function(){
                            $.fn.dataTable.ext.buttons.pdfHtml5.action.call(me, e, dt, node, config);
                            $('body').unmask();
                        }, 10);
                    }
                },
                {
                    text: 'JSON',
                    action: function(){
                        var pageOptions = optionsFromHash(hasher.getHash());
                        window.location.href = 'https://restapi.publicdata.guru/sec/ownership/'+view+'/cik'+parseInt(pageOptions[pageOptions.view]);
                    }
                }*/
            ]
        });
    } else {
        dtExemptOfferings.clear();
        var label = counter[data.view].substring(0,1).toUpperCase() + counter[data.view].substring(1);
        dtExemptOfferings.column(8).header().innerHTML = label;
        dtExemptOfferings.column(9).header().innerHTML = label+ ' CIK';
        dtExemptOfferings.rows.add(data.transactions);
        dtExemptOfferings.draw();
    }
    var apiResource = '//restapi.publicdata.guru/' + data.path;
    if($('#apiInfo').length == 0) $('#transactions_info').after('<div id="apiInfo"></div>');
    $('#apiInfo').html('API resource: <a href="'+apiResource+'">'+apiResource+'</a>');
    console.log('instantiated datatable');
    console.timeLog('HashChange');
    //  c. create interactive tblTransactions using dataTables
    //  d. clear & fill drop down filter values from aryOwner / aryIssues
    //  e. clear & fill forms drop down filter
    //  f. clear & fill transaction type drop-down
    //  g. set begin and end data and date slider limits
}

function filterTable(options){
//REWRITE TO FILTER ARRAY AND REDRAW BECAUSE DATATABLES CAN NOT DO A RANGE (START AND END DATE)
    //ALSO RELOAD THE FILTER CONTROLS GIVEN THE FILTERED DATA
    //or use $.fn.dataTable.ext.search.push
    var cikFilterParam = options.view=='issuer' ? 'reporter' : 'issuer';
    dtExemptOfferings.columns(4).search(options.ad ? options.ad : '');
    dtExemptOfferings.columns(3).search(options.code ? options.code: '');
    dtExemptOfferings.columns(0).search(options.form ? options.form : '');
    dtExemptOfferings.columns(9).search(options[cikFilterParam] ? options[cikFilterParam] : '');
    //date filter is handled inDateRange function applied in loadTransactionTable which using filterDates global var:
    filterDates = [options.start ? options.start : '', options.end ? options.end : ''];
    dtExemptOfferings.draw();
}

(function($) {
    $.widget( "custom.combobox", {
        _create: function() {
            this.wrapper = $( "<span>" )
                .addClass( "custom-combobox" )
                .insertAfter( this.element );

            this.element.hide();
            this._createAutocomplete();
            this._createShowAllButton();
        },

        _createAutocomplete: function() {
            var selected = this.element.children( ":selected" ),
                value = selected.val() ? selected.text() : "";

            this.input = $( "<input>" )
                .appendTo( this.wrapper )
                .val( value )
                .attr( "title", "" )
                .addClass( "custom-combobox-input ui-widget ui-widget-content ui-state-default ui-corner-left" )
                .autocomplete({
                    delay: 0,
                    minLength: 0,
                    source: $.proxy( this, "_source" )
                })
                .tooltip({
                    classes: {
                        "ui-tooltip": "ui-state-highlight"
                    }
                });

            this._on( this.input, {
                autocompleteselect: function( event, ui ) {
                    ui.item.option.selected = true;
                    this._trigger( "select", event, {
                        item: ui.item.option
                    });
                },

                autocompletechange: "_removeIfInvalid"
            });
        },

        _createShowAllButton: function() {
            var input = this.input,
                wasOpen = false;

            $( "<a>" )
                .attr( "tabIndex", -1 )
                .attr( "title", "Show All Items" )
                .tooltip()
                .appendTo( this.wrapper )
                .button({
                    icons: {
                        primary: "ui-icon-triangle-1-s"
                    },
                    text: false
                })
                .removeClass( "ui-corner-all" )
                .addClass( "custom-combobox-toggle ui-corner-right" )
                .on( "mousedown", function() {
                    wasOpen = input.autocomplete( "widget" ).is( ":visible" );
                })
                .on( "click", function() {
                    input.trigger( "focus" );

                    // Close if already visible
                    if ( wasOpen ) {
                        return;
                    }

                    // Pass empty string as value to search for, displaying all results
                    input.autocomplete( "search", "" );
                });
        },

        _source: function( request, response ) {
            var matcher = new RegExp( $.ui.autocomplete.escapeRegex(request.term), "i" );
            response( this.element.children( "option" ).map(function() {
                var text = $( this ).text();
                if ( this.value && ( !request.term || matcher.test(text) ) )
                    return {
                        label: text,
                        value: text,
                        option: this
                    };
            }) );
        },

        _removeIfInvalid: function( event, ui ) {

            // Selected an item, nothing to do
            if ( ui.item ) {
                return;
            }

            // Search for a match (case-insensitive)
            var value = this.input.val(),
                valueLowerCase = value.toLowerCase(),
                valid = false;
            this.element.children( "option" ).each(function() {
                if ( $( this ).text().toLowerCase() === valueLowerCase ) {
                    this.selected = valid = true;
                    return false;
                }
            });

            // Found a match, nothing to do
            if ( valid ) {
                return;
            }

            // Remove invalid value
            this.input
                .val( "" )
                .attr( "title", value + " didn't match any item" )
                .tooltip( "open" );
            this.element.val( "" );
            this._delay(function() {
                this.input.tooltip( "close" ).attr( "title", "" );
            }, 2500 );
            this.input.autocomplete( "instance" ).term = "";
        },

        _destroy: function() {
            this.wrapper.remove();
            this.element.show();
        }
    });
} )(jQuery);

