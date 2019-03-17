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
var ownershipData = {};
var dtTransactions;
var transactionDates;
var filterDates = ['',''];
var transactionCodes = {
    //General Transaction Codes
    P: 'Open market or private purchase of non-derivative or derivative security',
    S: 'Open market or private sale of non-derivative or derivative security',
    V: 'Transaction voluntarily reported earlier than required',
    //Rule 16b-3 Transaction Codes
    A: 'Grant, award or other acquisition pursuant to Rule 16b-3(d)',
    D: 'Disposition to the issuer of issuer equity securities pursuant to Rule 16b-3(e)',
    F: 'Payment of exercise price or tax liability by delivering or withholding securities incident to the receipt, exercise or vesting of a security issued in accordance with Rule 16b-3',
    I: 'Discretionary transaction in accordance with Rule 16b-3(f) resulting in acquisition or disposition of issuer securities',
    M: 'Exercise or conversion of derivative security exempted pursuant to Rule 16b-3',
    //Derivative Securities Codes (Except for transactions exempted pursuant to Rule 16b-3)
    C: 'Conversion of derivative security',
    E: 'Expiration of short derivative position',
    H: 'Expiration (or cancellation) of long derivative position with value received',
    O: 'Exercise of out-of-the-money derivative security',
    X: 'Exercise of in-the-money or at-the-money derivative security',
    //Other Section 16(b) Exempt Transaction and Small Acquisition Codes (except for Rule 16b-3 codes above)
    G: 'Bona fide gift',
    L: 'Small acquisition under Rule 16a-6',
    W: 'Acquisition or disposition by will or the laws of descent and distribution',
    Z: 'Deposit into or withdrawal from voting trust',
    //Other Transaction Codes
    J: 'Other acquisition or disposition (describe transaction)',
    K: 'Transaction in equity swap or instrument with similar characteristics',
    U: 'Disposition pursuant to a tender of shares in a change of control transaction'
};
var tableColumns = {
    "reporter": [
        {   title: "Form", className: "dt-body-center"},
        {   title: "Accession No.",
            render: function (data, type, row, meta) {
                return '<a href="https://www.sec.gov/Archives/edgar/data/' + row[9] + '/' + data.replace(/-/g,'') + '/' + data + '-index.html">' + data + '</a>';
            }
        },
        {   title: "Line Number", visible: false },
        {   title: "Transaction Type", className: "dt-body-center" },
        {   title: "Acquisition or Disposition", className: "dt-body-center" },
        {   title: "Direct or Indirect Ownership", className: "dt-body-center"  },
        {   title: "Transaction Date", className: "dt-body-center" },
        {   title: "Reported Date", className: "dt-body-center" },
        {   title: "Issuer",
            render: function (data, type, row, meta) {
                return '<a href="ownership.php#view=issuer&issuer=' + row[9] + '">' + data + '</a>';
            }
        },
        {   title: "Issuer CIK" },
        {   title: "Number of Securities Transacted", className: "dt-body-right"  },
        {   title: "Number of Securities Owned", className: "dt-body-right"  },
        {   title: "Notes" }
    ],
    "issuer": [
        {   title: "Form", className: "dt-body-center" },
        {   title: "Accession No.",
            render: function (data, type, row, meta) {
                return '<a href="https://www.sec.gov/Archives/edgar/data/' + row[9] + '/' + data.replace(/-/g,'') + '/' + data + '-index.html">' + data + '</a>';
            }},
        {   title: "Line Number" , visible: false},
        {   title: "Transaction Type", className: "dt-body-center" },
        {   title: "Acquisition or Disposition", className: "dt-body-center" },
        {   title: "Direct or Indirect Ownership", className: "dt-body-center" },
        {   title: "Transaction Date", className: "dt-body-center" },
        {   title: "Reported Date", className: "dt-body-center" },
        {   title: "Reporter",
            render: function (data, type, row, meta) {
                return '<a href="ownership.php#view=reporter&reporter=' + row[9] + '">' + data + '</a>';
            } },
        {   title: "Reporter CIK" },
        {   title: "Number of Securities Transacted", className: "dt-body-right" },
        {   title: "Number of Securities Owned", className: "dt-body-right" },
        {   title: "Notes" }
    ]
};
$(document).ready(function() {
    //initialize filter controls and define change events
    $( "#cikFilter" ).combobox({
        select: filterControlChanged
    });
    $("#acquireddisposedFilter").controlgroup({classes: {"ui-controlgroup-item": "inviz"}}).change(filterControlChanged);
    $( "#formFilter" ).change(filterControlChanged);
    $( "#codeFilter" ).change(filterControlChanged);
    $( "#dateSlider" ).innerWidth($('#filter').innerWidth()-30-2*$('#startDateFilter').outerWidth(true)).css('left', '110px')
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
    for(var filter in filters){
        if(filters[filter] && filters[filter]!='all') updatedHash += '&' + filter + '=' + filters[filter];
    }
    hasher.setHash(updatedHash);  //note: this will indirectly fire hashChangeHandler()
    $('#reset').button('enable');
}

//handle hash changes (fires on page load too!)
function hashChangeHandler(newHash, oldHash){
    $('body').mask('loading data...');
    window.setTimeout(function(){  //allow mask to render
        console.time('HashChange');
        var newOptions = optionsFromHash(newHash),
            oldOptions = optionsFromHash(oldHash),
            isNewView = !oldHash  || newOptions.view != oldOptions.view;
        if(isNewView){
            //new data set = 1. fetch data (from cache or API)
            getOwnershipData(newOptions, function(data){
                console.log('fetched data');
                console.timeLog('HashChange');
                //2. fill controls
                fillFilterControls(newOptions, data);

                console.log('set filter controls');
                console.timeLog('HashChange');
                //3. load table ELSE refill data and redraw
                loadTransactionsTable(newOptions, data.transactions);
                console.timeEnd('HashChange');
                //4. display header info
                displayHeader(data);
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

function getOwnershipData(options, callback){
    var key = options.view + options[options.view];
    if(ownershipData[key]){
        callback(ownershipData[key]);
    } else {
        console.time('callAPI');
        callAPI(
            {process: options.view, cik: options[options.view]},
            function(apiResponse) {
                console.timeEnd('callAPI');
                ownershipData[key] = apiResponse;
                callback(ownershipData[key]);
            }
        );
    }
}
function displayHeader(data){
    $('#entity').html(data.name + ' <a href="https://www.sec.gov/cgi-bin/browse-edgar?CIK='+data.cik+'&action=getcompany">'+data.cik+'</a>');
    $('#address').html(data.street1+'<br>'+(data.street2 && data.street2.trim().length>0?data.street2+'<br>':'')+data.city+' '+data.state+' '+data.zip);
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

function loadTransactionsTable(options, transactions){
    // a. clear existing data tables
    if(dtTransactions) dtTransactions.destroy();
    console.log('destroyed datatable');
    console.timeLog('HashChange');
    // b. from in-mem relational API data:
    //   - build aryTransactions
    var t, startDate = false, endDate = false, names = {}, dates=[];
    //   - build aryOwners / aryIssuers depending on request
    var height = window.innerHeight - $('#filter').outerHeight() - Math.max($('#header').outerHeight(),75) -200;
    dtTransactions = $('table#transactions').DataTable( {
        data: transactions,
        dom: 'Bfrtip',
        columns: tableColumns[options.view],
        scrollY:        height + "px",
        scrollCollapse: true,
        scroller:       true,
        deferRender: true,
        oLanguage: {"sSearch": "Text search"},
        buttons: [
            'copy',
            'excel',
            'csv',
            {
                extend: 'pdfHtml5',
                pageSize: 'letter',
                orientation: 'landscape',
                customize: function (doc) {
                    doc.defaultStyle.fontSize = 6; //<-- set fontsize to 16 instead of 10
                    doc.styles.tableHeader.fontSize = 7;
                }
            },
            {
                text: 'JSON',
                action: function(){
                    window.location.href = 'http://restapi.publicdata.guru/sec/ownership/'+options.view+'/cik'+parseInt(options[options.view]);
                    //alert('clicked JSON');
                }
            }
        ]
    });
    //dtTransactions.draw();
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
    dtTransactions.columns(4).search(options.ad ? options.ad : '');
    dtTransactions.columns(3).search(options.code ? options.code: '');
    dtTransactions.columns(0).search(options.form ? options.form : '');
    dtTransactions.columns(9).search(options[cikFilterParam] ? options[cikFilterParam] : '');
    //date filter is handled inDateRange function applied in loadTransactionTable which using filterDates global var:
    filterDates = [options.start ? options.start : '', options.end ? options.end : ''];
    dtTransactions.draw();
}

function callAPI(params, callback, fail) {
    var useDb = false;  //if false, use S3 bucket
    if(useDb){
        $.ajax({
            data: params,
            dataType: 'JSON',
            type: 'post',
            url: '/sec/api.php',
            success: function (data, status) {
                console.log('successfully ran API command: ' + params.process);
                callback(data);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                if (fail) {
                    fail(params);
                } else {
                    console.log(textStatus);
                    throw(errorThrown);
                }
            }
        });
    } else {
        var url = 'http://restapi.publicdata.guru/sec/ownership/' + params.process+ '/cik' + parseInt(params.cik);  //remove leading zeros
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

