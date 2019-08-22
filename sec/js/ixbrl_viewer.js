"use strict";
/**
 * Created by User on 10/26/2018.
 */

$(document).ready(function() {

});



var ixbrlViewer = {  //single object of all viewer methods and properties

    //ixbrlViewer global variables
    rgxSeparator: /[\s.;]+/g,
    cik: false,
    adsh: false,
    secDataCache: {},  //used to keep local copy of data to avoid repeat fetches

    //ixbrlViewer functions
    getSicDivision: function(sic){
        for(var i=0;i<this.sicDivisions.length;i++){
            if(sic>=this.sicDivisions[i].min && sic<=this.sicDivisions[i].max)  return this.sicDivisions[i];
        }
    },
    getSicFromFrame: function(fact, cik){
        for(var i=0; i<fact.data.length; i++){
            if(fact.data[i].cik == cik) return fact.data[i].sic;
        }
        return false;
    },
    extractXbrlInfo: function(ix){
        var $ix = $(ix),
            nameParts = $ix.attr('name').split(':'),
            contextRef = $ix.attr('contextref'),
            unitRef = $ix.attr('unitref');
        var xbrl = {
            uom: this.unitTree[unitRef],
            taxonomy: nameParts[0],
            tag: nameParts[1],
            sign: $(ix).attr('sign'),
            isGaap: nameParts[0]=='us-gaap',
            isStandard: this.standardTaxonomies.indexOf(nameParts[0])!==-1,
            value: $(ix).text(),
            cik: parseInt(this.cik),
            num_adsh: this.adsh
        };
        if(this.contextTree[contextRef]){
            xbrl.qtrs = this.contextTree[contextRef].qtrs;
            xbrl.end = this.contextTree[contextRef].end;
            xbrl.start = (this.contextTree[contextRef].start?this.contextTree[contextRef].start:null);
            xbrl.member = (xbrl.member?xbrl.member:false);
            xbrl.dim = (xbrl.dim?xbrl.dim:false);
        }
        return xbrl;
    },

    configureSaveControls: function(oVars){
        if(window.localStorage){
            var savedTimeSeries;
            if(savedTimeSeries = localStorage.getItem('savedTimeSeries')){
                savedTimeSeries = JSON.parse(savedTimeSeries);
                //see what's saved and enable button accordingly
                var otherTsSaved = false,
                    ts,
                    fields = ixbrlViewer.localStorageFields.timeSeries;
                for(var i=0; i<savedTimeSeries.length;i++){
                    ts = savedTimeSeries[i];
                    if(ts[fields.tag]==oVars.tag && ts[fields.uom]==oVars.uom && ts[fields.qtrs]==oVars.qtrs && ts[fields.cik]==oVars.cik){
                        $('#save').html('saved');
                    }
                }
            }
        } else {
            $('#save,#compare').remove();
        }
    },

    changeTimeSeriesStorage: function(oVars, save){
        //see what's saved and enable button accordingly
        var self = this,
            savedTS = JSON.parse(localStorage.getItem('savedTimeSeries') || '[]'),
            index = self.getStoredTimeSeriesRowIndex(oVars.tag, oVars.uom, oVars.qtrs, oVars.cik),
            newRow = [oVars.compare ||false, oVars.company, oVars.cik, oVars.tag, oVars.label, oVars.qtrs, oVars.uom];
        if(save) {
            if (index === false) {
                //push it
                savedTS.push(newRow);
            } else {
                //update the row
                savedTS.splice(index, 1, newRow);
            }
        } else {
            if (index !== false) savedTS.splice(index, 1); else console.log('error in changeTimeSeriesStorage'); //if false, we have
        }
        localStorage.setItem('savedTimeSeries', JSON.stringify(savedTS));
        $('#saved').html(savedTS.length + ' saved time series');
        var tagVars = self.vars, //check saved status of current tag & update UI
            tagIndex = self.getStoredTimeSeriesRowIndex(tagVars.tag, tagVars.uom, tagVars.qtrs, tagVars.cik);
        $('#save').html(tagIndex===false?'save &amp; compare':'saved');
    },

    getStoredTimeSeriesRowIndex: function(tag, uom, qtrs, cik){
        var ts,
            flds = this.localStorageFields.timeSeries,
            savedTimeSeries = this.getSavedTimeSeries();
        for(var i=0; i<savedTimeSeries.length; i++) {
            ts = savedTimeSeries[i];
            if (ts[flds.tag] == tag && ts[flds.uom] == uom && ts[flds.qtrs] == qtrs && ts[flds.cik] == cik) {
                return i;
            }
        }
        return false;
    },

    showCompareOptions: function(){  //opens a secondary fancybox with a datatable of saved, and an input box for tickers & CIKs
        var self = this;
        var popOptions = $.fancybox.open(self.htmlTemplates.popOptions);
        $('#lookup_user_symbols').click(function(){self.lookupSymbols()});
        $("#user_symbols").keyup(function(event) { //fire lookup on Enter
            if (event.keyCode === 13)  $("#lookup_user_symbols").click();
        });
        self.showComparedCompanies(self.getComparedCompanies());
        self.updateSavedTimeSeriesTable();
        $('span.clear_localStorage').click(function(){
            localStorage.clear();
            self.drawBarChart(self.vars);
            popOptions.close();
        })
    },

    getComparedTimeSeries: function(){  //get list from LocalStorage where 'compare' is true
        var self = this,
            savedTimeSeries = self.getSavedTimeSeries(),
            comparedTimeSeries = [];
        for(var i=0;i<savedTimeSeries.length;i++){
            if(savedTimeSeries[i][self.localStorageFields.timeSeries.compare]){
                comparedTimeSeries.push(savedTimeSeries[i]);
            }
        }
        return comparedTimeSeries;
    },

    getSavedTimeSeries: function(){
        //get list from LocalStorage
        var savedTimeSeries = [];
        if(window.localStorage) {
            savedTimeSeries = JSON.parse(localStorage.getItem('savedTimeSeries') || '[]');
        }
        return savedTimeSeries;
    },

    updateSavedTimeSeriesTable: function(){
        var self = this;
        var table = $('#savedTimeSeries').DataTable( {
            data: self.getSavedTimeSeries(),
            columns: [
                { title: "Compare",
                    render: function(val){
                       return '<input class="compare_ts" type="checkbox" ' + (val?'checked':'') + '>';
                    }
                },
                { title: "Company" },
                { title: "CIK", className: "datacell_cik"},
                { title: "XBRL tag", visible: false, "searchable": false, className: "datacell_tag"},
                { title: "XBRL Concept" },
                { title: "Duration", className: "datacell_qtrs", render: function(val){
                    switch(val){
                        case 0: return 'snapshot';
                        case 1: return 'quarter';
                        case 4: return 'year';
                        default: return 'error'
                    }} },
                { title: "Units", className: "datacell_uom" },
                {title: "", sortable: false, render: function(){return '<span class="ui-icon ui-icon-trash"></span>'}}],
            paging: false,
            scrollY: "300px",
            scrollCollapse: true,
            language: {
                search: '',
                searchPlaceholder: "filter saved series",
                emptyTable: "No saved times series"
            }
            });
        $('#savedTimeSeries tbody')
            .on( 'click', 'input', function () {
                var data = table.row( $(this).parents('tr') ).data(),
                    flds = self.localStorageFields.timeSeries,
                    tsVars = {
                        compare: !data[flds.compare],  //this is the change
                        company: data[flds.company],
                        cik: data[flds.cik],
                        tag: data[flds.tag],
                        label: data[flds.label],
                        qtrs: data[flds.qtrs],
                        uom: data[flds.uom]
                    };
                data[0] = tsVars.compare;
                self.changeTimeSeriesStorage(tsVars, true);  //overwrite
                self.drawBarChart(self.vars)
            })
            .on( 'click', 'span.ui-icon-trash', function () {
                var row = table.row( $(this).parents('tr') ),
                    data = row.data(),
                    flds = self.localStorageFields.timeSeries,
                    tsVars = {
                        compare: data[flds.compare],
                        company: data[flds.company],
                        cik: data[flds.cik],
                        tag: data[flds.tag],
                        label: data[flds.label],
                        qtrs: data[flds.qtrs],
                        uom: data[flds.uom]
                    };
                row.remove().draw(); //delete from table localStorage
                self.changeTimeSeriesStorage(tsVars, false);  //delete from localStorage
                self.drawBarChart(self.vars)
            });
    },

    lookupSymbols: function() {
        var self = this,
            userText = $('#user_symbols').val(),
            terms = userText.toUpperCase().trim().replace(self.rgxSeparator, ' ').split(' '),
            numbers = [],
            alphas = [];
        for (var i = 0; i < terms.length; i++) {
            if (isNaN(terms[i])) {
                alphas.push(terms[i]);
            } else {
                numbers.push(terms[i]);
            }
        }
        self.callAPI({
                process: 'lookupCompanies',
                ciks: numbers,
                symbols: alphas
            },
            function (data) {
                var compared = self.getComparedCompanies(),
                    flds = self.localStorageFields.comparedCompanies,
                    add;
                for(var i=0; i<data.matches.length; i++){
                    add = true;
                    for(var j=0; j<compared.length && add; j++){
                        if(compared[j][flds.cik] == data.matches[i][flds.cik]) add = false;
                    }
                    if(add) compared.push([data.matches[i][flds.cik], data.matches[i][flds.ticker], data.matches[i][flds.name]]);
                    //remove from user entries and leave only unfound stuff
                    var index = terms.indexOf(data.matches[i][flds.cik]);
                    if(index !== -1) terms.splice(index, 1);
                    var index = terms.indexOf(data.matches[i][flds.ticker]);
                    if(data.matches[i][flds.ticker] && index !== -1) terms.splice(index, 1);
                }
                self.saveComparedCompanies(compared);
                self.showComparedCompanies(compared);
                $('#user_symbols').val(terms.length?'not_found: ' + terms.join(' '):'');
                self.drawBarChart(self.vars);
            });
    },
    
    getComparedCompanies: function(){
        //get list from LocalStorage
        var comparedCompanies = [];
        if(window.localStorage) {
            comparedCompanies = JSON.parse(localStorage.getItem('comparedCompanies') || '[]')
        }
        return comparedCompanies;
    },

    saveComparedCompanies: function(companies){
        if(window.localStorage) {
            if(companies.length == 0) {
                localStorage.removeItem('comparedCompanies');
            } else {
                localStorage.setItem('comparedCompanies', JSON.stringify(companies));
            }
        }
    },

    showComparedCompanies: function(comparedCompanies){
        var self = this,
            flds = this.localStorageFields.comparedCompanies,
            comparedCompanies = self.getComparedCompanies();
        $('button.comparedCompany').remove();
        for(var i=0; i<comparedCompanies.length; i++ ){
            $(self.htmlTemplates.comparedCompanyButton)
                .html(comparedCompanies[i][flds.name] + '(CIK ' + comparedCompanies[i][flds.cik] + ')')
                .attr("cik", comparedCompanies[i][flds.cik])
                .button({icon: "ui-icon-closethick"}).appendTo('#compared');
        }
        $('button.comparedCompany').click(function(){
            var $button = $(this),
                cik = $button.attr('cik'),
                comparedCompanies = self.getComparedCompanies();
            $button.remove();
            for(var i=0; i<comparedCompanies.length; i++){
                if(comparedCompanies[i][self.localStorageFields.comparedCompanies.cik] == cik){
                    comparedCompanies.splice(i,1);
                }
            }
            self.saveComparedCompanies(comparedCompanies);
            self.drawBarChart(ixbrlViewer.vars);
        })
    },

    openPopupVisualization: function(oVars, callback){
        //get time series data via REST API (S3 bucket)
        var self = this;
        $.fancybox.open(self.htmlTemplates.popWindow,
            {
                touch: false,
                afterClose: function(){
                    self.setHashSilently('c=null');
                    if(self.dtFrame){
                        self.dtFrame.destroy(true);
                        self.dtFrame = false;
                    }
                }
            });
        $('#popviz').tabs();
        $('a[href="#tabs-ts"]').click(function(){$('#save, #compare').show()});
        $('a[href="#tabs-info"], a[href="#tabs-frame"]').click(function(){
            $('#save, #compare').hide();
        });
        $('a[href="#tabs-frame"]').click(function(){
            if(!ixbrlViewer.dtFrame)self.showFrameTable(oVars);
        });
        self.configureSaveControls(oVars);
        $('#save').click(function(){
            var $save = $('#save'),
                save = $save.html() == 'save &amp; compare';
            oVars.compare = true;
            self.changeTimeSeriesStorage(oVars, save);
            $save.html(save?'saved':'save &amp; compare');
        });
        $('#compare').click(function(){self.showCompareOptions(oVars)});
        self.drawBarChart(oVars, callback);
    },

    drawBarChart: function(oVars, callback){  //can be called to redraw
        var self = this,
            url = 'https://restapi.publicdata.guru/sec/timeseries/' + oVars.tag + '/cik' + oVars.cik + '.json';
        self.fetchTimeSeriesToCache(oVars,
            function(aryTimeSeries){
                if(aryTimeSeries.length==0 || !self.secDataCache[url]){
                    $('#popviz').html('Unable to load data from API for this series.  This may be because it is a sole-point or because the API has not yet been updated.');
                    return false
                }
                oVars.label = self.secDataCache[url][oVars.tag].label;
                oVars.company = self.secDataCache[url][oVars.tag]['cik'+oVars.cik].name;
                var oChart = makeTimeSeriesChartObject(aryTimeSeries, oVars);
                $('#tscontrols').html(makeDurationSelectorHtml(self.secDataCache[url], oVars) + makeUnitsSelectorHtml(self.secDataCache[url], oVars));
                oChart.chart.renderTo = $('#tschart')[0];
                if(self.barChart) self.barChart.destroy();
                self.barChart = new Highcharts.Chart(oChart);
                if(!window.localStorage || !localStorage.getItem('columnClicked')){
                    $('#tschart .highcharts-container').prepend('<div class="tttip">click on columns for fact disclosures and links</div>');
                    setTimeout(function(){
                        $('#tschart .tttip').fadeOut(1000, function(){$('#tschart .tttip').remove()});
                    }, 1000);
                }
                $('#popviz_durations, #popviz_units').change(function(){
                    var duration = $('#popviz_durations').val();
                    self.vars.qtrs = (duration && duration.substr(2)) || self.vars.qtrs;
                    self.vars.uom = $('#popviz_units').val() || self.vars.uom;
                    self.fetchTimeSeriesToCache(self.vars, function(aryNewTimeSeries){
                        var oChart = makeTimeSeriesChartObject(aryNewTimeSeries, self.vars);
                        if(self.barChart) self.barChart.destroy();
                        oChart.chart.renderTo = $('#tschart')[0];
                        self.barChart = new Highcharts.Chart(oChart);
                    });
                });
                if(callback) callback(); else self.setHashSilently('y=' + oVars.tag +'&d=' +  oVars.end  +'&u=' +  oVars.uom  +'&q=' +  oVars.qtrs +'&c=b');
            }
        );

        function makeDurationSelectorHtml(timeseries, oVars){
            var durations = [], duration;
            for(duration in timeseries[oVars.tag]['cik'+oVars.cik]['units'][oVars.uom]){
                durations.push(duration);
            }
            if(durations.length==1) return duration + ' ';
            durations.sort();
            var html = '<select id="popviz_durations">';
            for(var i=0; i<durations.length; i++){
                html += '<option value="' + durations[i] + '"' +(durations[i]==oVars.qtrs?' selected':'')+ '>' + ixbrlViewer.durationNames[durations[i].substr(2)] + '</option>';
            }
            html += '</select>';
            return html;
        }
        function makeUnitsSelectorHtml(timeseries, oVars){
            var units = [], unit;
            for(unit in timeseries[oVars.tag]['cik'+oVars.cik]['units']){
                units.push(unit);
            }
            if(units.length==1) return ' Units: ' + unit;
            units.sort();
            var html = '<select id="popviz_units">';
            for(var i=0; i<units.length; i++){
                html += '<option value="' + units[i] + '"' + (units[i]==oVars.uom?' selected':'')+ '>' + units[i] + '</option>';
            }
            html += '</select>';
            return html;
        }

        var clone_container = null;
        var clone_tooltip = null;
        function clean_tooltip() {
            $('#tschart .tttip').remove();
            if (clone_container) {  self.barChart.container.firstChild.removeChild(clone_container);
                clone_container = null;
            }

            if (clone_tooltip) {
                self.barChart.container.removeChild(clone_tooltip);
                clone_tooltip = null;
            }
        }
        function hasClass(element,cls) {
            return element.classList.contains(cls);
        }

        function makeTimeSeriesChartObject(aryTimeSeriesParams, callingParams){
            var chartLabels = makeChartLabels(aryTimeSeriesParams),
                yAxes = processYAxes(aryTimeSeriesParams),
                highSeries = makeChartSeries(aryTimeSeriesParams, yAxes);
                for(var i=1; i<yAxes.length; i++){
                    if(yAxes[i].somePos && !yAxes[i].someNeg) yAxes[i].min = 0;
                    if(!yAxes[i].somePos && yAxes[i].someNeg) yAxes[i].max = 0;
                }
                var oChart = {
                    chart: {
                        type: 'column',
                        height: 500,
                        events: {
                            click: function(event) {
                                clean_tooltip();
                            }
                        }
                    },
                    tooltip:{
                        //followPointer: false,
                        hideDelay: 50,
                        useHTML: true,
                        //style: {pointerEvents: 'auto'},
                        headerFormat: '',
                        pointFormatter: function(){ //change to "" in Highcharts v.4+
                            //todo:  fix this for multiseries charts
                            var sParam = aryTimeSeriesParams[this.series.index],
                                ts = self.secDataCache[sParam.url][sParam.tag]['cik'+sParam.cik]['units'][sParam.uom][ixbrlViewer.durationPrefix+sParam.qtrs];
                            var disclosures = [], disclosure, lastDisclosure = false;
                            for(var i=0;i<ts.length;i++){
                                disclosure = self.parseTsPoint(ts[i]);
                                if(disclosure.end==this.end){
                                    if(lastDisclosure && lastDisclosure.y != disclosure.y){
                                        disclosures.push('<span style="color:orange;"><b>Revised from:</b></span>');
                                    }
                                    if(disclosure.adsh.replace(/-/g,'') != callingParams.num_adsh){
                                        disclosures.push('<a href="/sec/viewer.php?doc=' + callingParams.cik
                                            +'/'+disclosure.adsh.replace(self.rgxAllDash,'')+'/'+ disclosure.adsh
                                            +'-index&u='+callingParams.uom+'&q='+callingParams.qtrs+'&d='+disclosure.end
                                            +'&t='+callingParams.tag
                                            +'" style="color:blue;">'+disclosure.adsh + '</a>: ' + disclosure.rptForm
                                            + ' ' + disclosure.rptPeriod + ' reported ' + self.numberFormatter(disclosure.y, callingParams.uom));
                                    } else {
                                        disclosures.push(disclosure.adsh + ': ' +disclosure.rptForm + ' '
                                            + disclosure.rptPeriod + ' reported ' + self.numberFormatter(disclosure.y, callingParams.uom));
                                    }
                                    lastDisclosure = disclosure;
                                }
                            }
                            return '<b>' + self.secDataCache[sParam.url][sParam.tag]['cik'+sParam.cik].name + ' disclosures for ' + this.end + '</b><br><br>' + disclosures.join('<br>');
                        }
                    },
                    title: {
                        text: chartLabels.title  //edgarTsData[callingParams.tag].label
                    },
                    subtitle: {
                        text: chartLabels.subtitle //edgarTsData[callingParams.tag].desc
                    },
                    legend: {enabled: highSeries.length>1},
                    credits: {
                        enabled: true,
                        text: 'data provided by U.S. Securities and Exchange Commission',
                        href: 'https://www.sec.gov'
                    },
                    yAxis: yAxes.chartOptions,
                    xAxis:{
                        type: 'datetime'
                    },
                    series: highSeries,
                    plotOptions: {
                        series: {
                            stickyTracking: false,
                            cursor: 'pointer',
                            point: {
                                events: {
                                    click: function () {
                                        clean_tooltip();
                                        if(window.localStorage ) localStorage.setItem('columnClicked', true);
                                            var hc_tooltip = document.getElementsByClassName("highcharts-tooltip");
                                        var orig_container = hc_tooltip[0];
                                        var orig_tooltip = hc_tooltip[1];

                                        clone_tooltip = orig_tooltip.cloneNode(true);
                                        clone_tooltip.classList.remove("invisible");
                                        clone_tooltip.classList.add("clone");

                                        clone_container = this.series.chart.tooltip.label.element.cloneNode(true);
                                        clone_container.classList.remove("invisible");
                                        clone_container.classList.add("clone");

                                        self.barChart.container.firstChild.appendChild(clone_container);
                                        self.barChart.container.appendChild(clone_tooltip);
                                    }
                                }
                            }
                        }
                    }
                };
            return oChart;

            function makeChartLabels(aryTimeSeriesParams){
                var chartLabels = {
                        series: [],
                        title: null,
                        subtitle: null
                    },
                    sameTag = true,
                    sameCompany = true,
                    tsp, tsplast, i, company, tagLabel;
                for(i=1; i<aryTimeSeriesParams.length; i++){
                    tsplast = aryTimeSeriesParams[i-1];
                    tsp = aryTimeSeriesParams[i];
                    if(tsplast.cik != tsp.cik) sameCompany = false;
                    if(tsplast.tag != tsp.tag) sameTag = false;
                }
                for(i=0; i<aryTimeSeriesParams.length; i++){
                    tsp = aryTimeSeriesParams[i];
                    company = self.secDataCache[tsp.url][tsp.tag]['cik'+tsp.cik].name || ('cik' + tsp.cik);
                    tagLabel = self.secDataCache[tsp.url][tsp.tag]['label'];
                    chartLabels.series[i] = (!sameCompany?company:'') + (!sameCompany && !sameTag?' ':'') + (!sameTag?tagLabel:'');
                }
                chartLabels.subtitle =  sameTag ? self.secDataCache[tsp.url][tsp.tag].description: '';
                chartLabels.title = (sameCompany?company:'') + (sameCompany && sameTag?' ':'') + (sameTag?tagLabel:'');

                return chartLabels;
            }
            function processYAxes(aryTS){
                var yAxes = {map: {}, chartOptions: []};
                for(var i=0; i<aryTS.length; i++){
                    if(!yAxes.map[aryTS[i].uom] && yAxes.map[aryTS[i].uom] !== 0){
                        yAxes.map[aryTS[i].uom] = yAxes.chartOptions.length;
                        yAxes.chartOptions.push(
                            {
                                somePos: false,  //initial:  updated during series creation; if finally true -> set max=0
                                someNeg: false,  //initial:  updated during series creation; if finally true -> set min=0
                                title: {
                                    text: aryTS[i].uom
                                },
                                labels: {
                                    formatter: function() {
                                        return self.axesLabelFormatter(this);
                                    }
                                }
                            });
                    }
                }
                return yAxes;
            }
            function makeChartSeries(aryTimeSeriesParams, yAxes){
                var aSeries = [];
                for(var i=0; i < aryTimeSeriesParams.length; i++){
                    var tsParams = aryTimeSeriesParams[i],
                        edgarTsData = self.secDataCache[tsParams.url],
                        ts = edgarTsData[tsParams.tag]['cik'+tsParams.cik]['units'][tsParams.uom][ixbrlViewer.durationPrefix+tsParams.qtrs],
                        serie = {
                            type: 'column',
                            name: chartLabels.series[i],
                            data: [],
                            yAxis: yAxes.map[tsParams.uom]
                        },
                        latestPoint = null,
                        adjusted = false,
                        point;
                    for(var j=0; j<ts.length ;j++) {
                        point = self.parseTsPoint(ts[j]);
                        if(latestPoint) {
                            if (latestPoint.end != point.end) {
                                addPoint(serie, latestPoint, adjusted);
                                latestPoint = point;
                                adjusted = false;
                            } else {
                                if (latestPoint.y != point.y)
                                    adjusted = true;
                                if (latestPoint.ageRank < point.ageRank) latestPoint = point;
                            }
                        } else {
                            latestPoint = point;
                        }
                    }
                    addPoint(serie, latestPoint || point, adjusted);
                    aSeries.push(serie);
                }
                return aSeries;

                function addPoint(serie, pt, adjusted){
                    var xDate = new Date(pt.end),
                        hcDate = Date.UTC(xDate.getFullYear(), xDate.getMonth(), xDate.getDay()),
                        hcPt = {x: hcDate, y: pt.y, end: pt.end, start: pt.start};
                    if(adjusted)
                        hcPt.borderColor = 'orange';
                    serie.data.push(hcPt);
                    if(pt.value>0) yAxes.chartOptions[yAxes.map[tsParams.uom]].somePos = true;
                    if(pt.value<0) yAxes.chartOptions[yAxes.map[tsParams.uom]].someNeg = true;
                }
            }
        }
    },


    showFrameTable: function(oVars){
        var self = this,
            ply = self.playerIndexes(oVars),
            $slider,
            frameTableOptions = false;
        for(var i in ply.dateIndex) ply.dateIndex[i] = self.closestCalendricalPeriod(ply.dateIndex[i], oVars.qtrs);  //convert to cdates
        self.setHashSilently('y=' + oVars.tag +'&d=' +  oVars.end  +'&u=' +  oVars.uom  +'&q=' +  oVars.qtrs +'&c=f');
        if(!this.dtFrame){
            frameTableOptions = {
                qtrs: oVars.qtrs,
                tags: [
                    {
                        tag: oVars.tag,
                        qtrs: oVars.qtrs,
                        uom: oVars.uom
                    }
                ],
                cdates: [
                    self.closestCalendricalPeriod(oVars.end, oVars.qtrs)
                ]
            };
            initializeFrameControls(oVars);
            showFrameColumnTags(frameTableOptions);
        }


        fetchFrameTableData(frameTableOptions, function(){});

        function fetch_error(url){
            $('#framecontrols').html('Unable to load any frame from API for requested table:<br>' + url);
        }

        function fetchFrameTableData(frameTableOptions, callback){
            //fetches and integrates frames into single table
            var t, d, urlsToFetch = {}, requestCount = 0;
            for(t=0; t<frameTableOptions.tags.length; t++) {
                for (d = 0; d<frameTableOptions.cdates.length; d++) {
                    var url = 'https://restapi.publicdata.guru/sec/frames/' + frameTableOptions.tags[t].tag + '/'
                        + frameTableOptions.tags[t].uom + '/'
                        + frameTableOptions.cdates[d] + '.json';
                    urlsToFetch[url] = {
                        order: requestCount++,
                        tag: frameTableOptions.tags[t].tag,
                        uom: frameTableOptions.tags[t].uom,
                        qtrs: frameTableOptions.tags[t].qtrs,
                        cdate: frameTableOptions.cdates[d]
                    };
                }
            }

            var f, responseCount = 0, foundCount = 0, missingURLs = [];
            for(url in urlsToFetch)
                self.getRestfulData(
                    url,
                    function(frame, fetchedURL){
                        urlsToFetch[fetchedURL] = frame;
                        foundCount++;
                        responseCount++;
                        if(responseCount == requestCount) {
                            frameTableOptions.requestedFrames = urlsToFetch;
                            makeFrameTable(frameTableOptions);
                        }
                    },
                    function(missingURL) {
                        urlsToFetch[missingURL].data = false;
                        missingURLs.push(missingURL);
                        responseCount++;
                        if (responseCount == requestCount) {
                            if(foundCount>0){
                                frameTableOptions.requestedFrames = urlsToFetch;
                                makeFrameTable(frameTableOptions);
                            } else {
                                fetch_error(missingURLs.join('<br>'));
                            }
                        }
                    });

        }
        function makeFrameTable(frameTableOptions){
            //todo:  make widths constant when scrolling (vertical)
            var tableData = false;  //fetchedFramesData will be used to array to populate frameTable
            var columnDefs = [
                {   title: "Entity", export: false, className: "dt-body-left", render: function(data, type, row, meta){
                        return '<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + row[meta.col+2] + '">' + data + ' ('+row[meta.col+2] + ')</a>';
                    }},
                {   title: "Entity Name", visible: false, export: true, className: "dt-body-left"},
                {   title: "CIK", visible: false, export: true, className: "dt-body-right"},
                {   title: "SIC Classification", export: true,
                    render: function(data, type, row, meta){
                        return data? data+' - ' + ixbrlViewer.sicCode[data]:'';
                    },
                    className: "dt-body-left"},
                {   title: "Location", export: true, className: "dt-body-center" }
            ];
            var row,
                headerColumnLength = columnDefs.length,
                topHeaderCells = '<th class="th-no-underline" colspan="3"></th>'; //only 3 visible
            for(var url in frameTableOptions.requestedFrames){
                var frame = frameTableOptions.requestedFrames[url];
                if(frame.data){ //will be false if frame DNEresponseCount
                    frame.data.sort(function(row1,row2){return parseInt(row1.cik)-parseInt(row2.cik)});
                    if(!tableData){  //first frame get sets left 5 header columns
                        tableData = [];
                        for(var r=0;r<frame.data.length;r++) {
                            row = frame.data[r];
                            tableData.push([row.entityName, row.entityName, row.cik, row.sic, row.loc]);
                        }
                    }
                    var rgxHeaderColSpan = new RegExp('colspan="\(\\d+\)">'+ frame.label +' \\('+ ixbrlViewer.durationNames[frame.qtrs]+'\\)');
                    var match = topHeaderCells.match(rgxHeaderColSpan);
                    //add top header cells over date & value; extend span instead of adding repeat
                    if(match){
                        var extendedColSpan = parseInt(match[1]) + 3;
                        topHeaderCells = topHeaderCells.replace(rgxHeaderColSpan, 'colspan="' + extendedColSpan + '">'+ frame.label +' ('+ ixbrlViewer.durationNames[frame.qtrs]+')')
                    } else {
                        topHeaderCells += '<th  class="th-underline-with-break" colspan="3">'+ frame.label +' ('+ ixbrlViewer.durationNames[frame.qtrs]+')</th>';
                    }
                    //add the new rows
                    var tableRowIndex = 0,
                        frameRowIndex = 0,
                        frameRow,
                        frameCIK,
                        tableCIK,
                        newRow;
                    while(frameRowIndex<frame.data.length || tableRowIndex<tableData.length){
                        newRow = null;
                        if(tableRowIndex<tableData.length) tableCIK = parseInt(tableData[tableRowIndex][2]); //
                        if(frameRowIndex<frame.data.length){
                            frameRow = frame.data[frameRowIndex];
                            frameCIK = parseInt(frameRow.cik);
                            if(frameCIK<tableCIK || tableRowIndex==tableData.length){ //table is missing this CIK = add header cells and fill any preceding data cells with nulls
                                newRow = [frameRow.entityName, frameRow.entityName, frameRow.cik, frameRow.sic, frameRow.loc]
                                    .concat(new Array(columnDefs.length-headerColumnLength).fill(null));
                                tableData.splice(tableRowIndex, 0, newRow);
                            }
                        }
                        if(frameCIK<=tableCIK && frameRowIndex<frame.data.length || newRow){  //insync = add data to current row and advance both indexes together
                            var newColumns = [frameRow.start,  //don't add for
                                frameRow.end,
                                frame.qtrs,
                                frameRow.val,
                                frameRow.val,
                                frame.uom,
                                frameRow.rev,
                                frameRow.accn];
                            if(!frameRow.start) newColumns.shift();
                            tableData[tableRowIndex] =  tableData[tableRowIndex].concat(newColumns);
                            tableRowIndex++;
                            frameRowIndex++;
                        } else { //this frame does not have a row corresponding to the table's current CIK = fill data cell with nulls
                            tableData[tableRowIndex] = tableData[tableRowIndex].concat(new Array(frameRow.start?8:7).fill(null));  //length of new data cols to be added to columnDefs
                            tableRowIndex++;
                        }
                    }
                    //add the new column defs for each frame
                    //todo:  add a customize function to xls export to convert source ADSH to HYPERLINK.  See https://stackoverflow.com/questions/40243616/jquery-datatables-export-to-excelhtml5-hyperlink-issue/49146977#49146977
                    if(frame.qtrs!=0){
                        columnDefs = columnDefs.concat(  //note: some fields are displayed in the beowser (visible) while others are exported
                            [{   title: "From", export: true, render: function (data, type, row, meta) {
                                    return typeof(data)=='undefined' || data===null?'':data;
                                }},
                            {   title: "To", export: true, render: function (data, type, row, meta) {
                                    return typeof(data)=='undefined' || data===null?'':data;
                                }
                            }]
                        );
                    } else {
                        columnDefs = columnDefs.concat(  //note: some fields are displayed in the beowser (visible) while others are exported
                            [{   title: "As of", export: true, render: function (data, type, row, meta) {
                                    return typeof(data)=='undefined' || data===null?'':data;
                                }
                            }]
                        );
                    }
                    var hiddenValColumn = columnDefs.length+2;
                    columnDefs = columnDefs.concat([  //note: some fields are displayed in the beowser (visible) while others are exported
                        {   title: "quarters duration", visible: false, render: function(data) {return typeof(data)=='undefined' || data===null?'':''}},

                        {   title: "Disclosure", orderData: hiddenValColumn, export: false, className: "dt-body-right",  render: function(data, type, row, meta){
                                var adsh = row[meta.col+4];
                                return typeof(data)=='undefined' || data===null?'':'<a href="https://www.sec.gov/Archives/edgar/data/' + adsh + '/' + adsh.replace(/-/g,'')
                                    + '/' + data + '-index.html">' + ixbrlViewer.numberFormatter(data, row[meta.col+2]) + '</a>'
                        }}, //this version of value includes the units is formatted with commas
                        {   title: frame.label, export: true, visible: false, render: function(data) {return typeof(data)=='undefined' || data===null?'':data}},  //unformatted clean version for export
                        {   title: "units", export: true, visible: false, render: function(data) {return typeof(data)=='undefined' || data===null?'':data}},
                        {   title: "version", export: false, visible: false, render: function(data) {return typeof(data)=='undefined' || data===null?'':data}},
                        {   title: "accession no.", export: true, visible: false},
                    ]);
                }

            }

            var exportColumns = [];  //will be appended to as tableData is built
            for(var i=0; i<columnDefs.length;i++) if(columnDefs[i].export) exportColumns.push(i);
            if(ixbrlViewer.dtFrame) ixbrlViewer.dtFrame.destroy(true);
            $('#tabs-frame').append('<table id="frame-table"></table>');
            self.dtFrame = $('#frame-table').DataTable( {
                data: tableData,
                dom: 'Bfrtip',
                columns: columnDefs,
                scrollY: "500px",
                scrollX: false,
                scrollCollapse: true,
                scroller: {rowHeight: 'auto'},
                deferRender: true,
                oLanguage: {"sSearch": "Text search"},
                order: [[6, 'desc']],
                buttons: [
                    {
                        extend: 'copyHtml5',
                        exportOptions: { columns: exportColumns}
                    },
                    {
                        extend: 'excelHtml5',
                        exportOptions: { columns: exportColumns}
                    },
                    {
                        extend: 'csvHtml5',
                        exportOptions: { columns: exportColumns}
                    }
                ]
            });
            $('div.dataTables_scrollHead thead').prepend('<tr>' + topHeaderCells + '</tr>')
        }
        function initializeFrameControls(options){
            var $frameControls = $('#tabs-frame div.framecontrols');

            $slider = $frameControls.html(self.htmlTemplates.frameControls)
                .find('.frameSlider').slider({
                    min: 0,
                    max: ply.dateIndex.length - 1,
                    value: ply.homeIndex,
                    slide: function (event, ui) {
                        var cdate = ply.dateIndex[ui.value];
                        $('button.addCdate').attr('cdate', cdate).button( "option", "label", cdate);
                    }
                });
            var $addCdate = $('button.addCdate')
                .button({icon: 'ui-icon-plusthick', label: ply.dateIndex[ply.homeIndex]})
                .click(function(){
                    frameTableOptions.cdates.push($(this).attr('cdate'));
                    frameTableOptions.cdates.sort();
                    fetchFrameTableData(frameTableOptions);
                    showFrameColumnTags();
                });
            var tagOptions = '<option value="null"></option>';
            var tagCombos = [];
            for(var duration in self.standardTagTree){
                for(var units in self.standardTagTree[duration]){
                    for(var i in self.standardTagTree[duration][units]){
                        tagCombos.push(self.standardTagTree[duration][units][i] + ':' + units + ':' + duration);
                    }
                }
            }
            tagCombos.sort();
            for(i=0;i<tagCombos.length;i++){
                var part = tagCombos[i].split(':');
                tagOptions += '<option value="'+tagCombos[i]+'">'+part[0]+ ' ('+ self.durationNames[part[2].substr(2,1)] + ' in ' + part[1] + ')</option>';
            }
            var $frameTagSelector = $("#frameTagSelector").html(tagOptions).combobox({
                select: function(){
                    var tagParts = $(this).val().split(':');
                    frameTableOptions.tags.push({tag: tagParts[0], uom: tagParts[1], qtrs: parseInt(tagParts[2].substr(2))});
                    fetchFrameTableData(frameTableOptions);
                    showFrameColumnTags();
                }
            });
            $slider.width($frameControls.innerWidth()-$addCdate.outerWidth()-$('span.custom-combobox').outerWidth()-100);
        }
        function showFrameColumnTags(){
            console.log(frameTableOptions);
            $('button.frameColumnButton').remove(); //get rid of all and re-add
            var i;
            for(i=0; i<frameTableOptions.tags.length; i++ ){
                $(self.htmlTemplates.frameColumnButton)
                    .html(frameTableOptions.tags[i].tag + ' ('+ixbrlViewer.durationNames[frameTableOptions.tags[i].qtrs] + ' in ' + frameTableOptions.tags[i].uom + ')')
                    .attr("tag", frameTableOptions.tags[i].tag)
                    .attr("duration", frameTableOptions.tags[i].duration)
                    .attr("uom", frameTableOptions.tags[i].uom)
                    .addClass("frame-column-tag")
                    .button({icon: "ui-icon-closethick"})
                    .appendTo('#frameOptionTags');
            }
            for(i=0; i<frameTableOptions.cdates.length; i++ ){
                $(self.htmlTemplates.frameColumnButton)
                    .html(frameTableOptions.cdates[i])
                    .attr("cdate", frameTableOptions.cdates[i])
                    .addClass("frame-column-cdate")
                    .button({icon: "ui-icon-closethick"})
                    .appendTo('#frameOptionTags');
            }
            $('button.frameColumnButton').click(function(){
                var $button = $(this),
                    type = $button.hasClass('frame-column-tag')?'tags':'cdates',
                    tagObject;

                    //typeStore = $button.hasClass('frame-column-tag')?'tags':'cdates';
                for(var i=0; i<frameTableOptions[type].length; i++){
                    tagObject = frameTableOptions[type][i];
                    if(type=='tags'){
                        if($button.attr('tag')==tagObject.tag && $button.attr('duration')==tagObject.duration && $button.attr('uom')==tagObject.uom){
                            $button.remove();
                            frameTableOptions[type].splice(i,1);
                        }
                    }
                    if(type=='cdates'){
                        if($button.attr('cdate')==tagObject){
                            $button.remove();
                            frameTableOptions[type].splice(i,1);
                        }
                    }
                }
                fetchFrameTableData(frameTableOptions);
            });
        }
    },

    parseTsPoint: function(tsPoint){
        var parsedPoint = {
            end: tsPoint.end,
            start: tsPoint.start,
            y: tsPoint.val,
            adsh: tsPoint.accn,
            rptPeriod: 'FY' + tsPoint.fy + ' ' + tsPoint.fp,
            rptForm: tsPoint.form 
        };
        parsedPoint.ageRank = parseFloat(parsedPoint.rptPeriod.substring(0,4) + '.' + (parsedPoint.rptPeriod.substr(-2,2)=='FY'?'4':parsedPoint.rptPeriod.substr(-1,1)));
        return parsedPoint;
    },
    makeTitle: function(tagLabel, qtrs, date){
        switch(parseInt(qtrs)){
            case 1:
                return tagLabel + ' as of ' + date;
            case 4:
                return tagLabel + ' for year ending ' + date;
            default: //0 and all others
                return tagLabel + ' for quarter ending ' + date;
        }
    },
    makeSicFilterHTML: function(sic){
        var sicDivision = this.getSicDivision(sic),
            industryName = this.sicCode[sic];
        this.vars.sicDivision = sicDivision;
            return '<select class="sic_filter">' +
                '<option value="all">all reporting companies</option>' +
                '<option value="div">' + sicDivision.name + '</option>' +
                '<option value="ind">' + industryName + '</option>' +
                '</select>';
    },
    playerIndexes: function(params){
        var cached = this.secDataCache['https://restapi.publicdata.guru/sec/timeseries/' + params.tag + '/cik' + params.cik+'.json'];
        if(cached){
            var tsObject = cached[params.tag]['cik'+params.cik];
            if(tsObject['units'][params.uom] && tsObject['units'][params.uom][ixbrlViewer.durationPrefix+params.qtrs]){
                var data = tsObject['units'][params.uom][ixbrlViewer.durationPrefix+params.qtrs],
                pt, lastDate = false, playerIndex = [], homeIndex=0;
                for(var i=0; i<data.length; i++){
                pt = this.parseTsPoint(data[i]);
                    if(lastDate!=pt.end){
                        playerIndex.push(pt.end);
                        lastDate = pt.end;
                    }
                    if(pt.end == params.end) homeIndex = playerIndex.length-1;
                }
                return {dateIndex: playerIndex, homeIndex: homeIndex}
            }
        }
    },

    fetchTimeSeriesToCache: function(oVars, callBack){
        //1. get the full list of urls to fetch from saved series and companies
        var self = this,
            clickedUrl = 'https://restapi.publicdata.guru/sec/timeseries/' + oVars.tag + '/cik' + oVars.cik + '.json',
            savedTimeSeries = self.getSavedTimeSeries(),
            savedCompanies = self.getComparedCompanies(),
            fldSC = self.localStorageFields.comparedCompanies,
            fldTS = self.localStorageFields.timeSeries,
            requests = [{
                url: clickedUrl,
                uom: oVars.uom,
                qtrs: oVars.qtrs,
                tag: oVars.tag,
                cik: oVars.cik,
                company: oVars.company
            }],
            i, url;
        //saved companies that are selected
        for(i=0; i<savedTimeSeries.length; i++){
            if(savedTimeSeries[i][0]){
                url = 'https://restapi.publicdata.guru/sec/timeseries/' + savedTimeSeries[i][fldTS.tag]
                    + '/cik' + savedTimeSeries[i][fldTS.cik] + '.json';
                if(url != clickedUrl && savedTimeSeries[i][fldTS.qtrs]==oVars.qtrs){
                    requests.push({
                        url: url,
                        uom: savedTimeSeries[i][fldTS.uom],
                        qtrs: savedTimeSeries[i][fldTS.qtrs],
                        tag: savedTimeSeries[i][fldTS.tag],
                        cik: savedTimeSeries[i][fldTS.cik]
                    })
                }
            }
        }
        //all saved companies
        for(i=0; i<savedCompanies.length; i++){
            if(savedCompanies[i][0]){
                url = 'https://restapi.publicdata.guru/sec/timeseries/' + oVars.tag
                    + '/cik' + savedCompanies[i][fldSC.cik] + '.json';
                if(url != clickedUrl){
                    requests.push({
                        url: url,
                        uom: oVars.uom,
                        qtrs: oVars.qtrs,
                        tag: oVars.tag,
                        cik: savedCompanies[i][fldSC.cik]
                    })
                }
            }
        }
        //fetch all:
        var responseCount = 0,
            responses = [];
        for(i=0; i<requests.length; i++){
            var success = (function(i){ //closure to preserve i
                return function(oTS) {
                    responseCount++;
                    //make sure the particular (uom, qtrs) timeseries is in the (cik, tag) response
                    if (oTS[requests[i].tag]['cik' + requests[i].cik]['units'][requests[i].uom]
                        && oTS[requests[i].tag]['cik' + requests[i].cik]['units'][requests[i].uom][ixbrlViewer.durationPrefix + requests[i].qtrs]) {
                        responses.push(requests[i]);
                    }
                    if (responseCount == requests.length) callBack(responses);
                }
            })(i);
            self.getRestfulData(requests[i].url,
                success,
                function(url){
                    responseCount++;
                    if(responseCount == requests.length) callBack(responses);
                }
            );
        }
    },

    getRestfulData: function(url, success, fail){
        if(ixbrlViewer.secDataCache[url]){
            console.log('data found in cache for ' + url);
            if(success) success(ixbrlViewer.secDataCache[url], url);
        } else {
            var dbUrl = false;
            if(window.location.href.indexOf('maker.publicdata')!=-1){ //use database for maker.publicdata.guru
                var uParts = url.split('/');  //e.g. 'https://restapi.publicdata.guru/sec/frames/'+oVars.tag+'/'+oVars.uom+ +'/'+this.closestCalendricalPeriod(oVars.end, oVars.qtrs),
                switch(uParts[4]){
                    case 'frames':
                        dbUrl = 'http://maker.publicdata.guru/sec/api.php?process='+uParts[4]+'&t='+uParts[5]+'&u='+encodeURIComponent(uParts[6]) +'&q='+uParts[7]+'&d='+uParts[8];
                        break;
                    case 'timeseries':
                        dbUrl = 'http://maker.publicdata.guru/sec/api.php?process='+uParts[4]+'&t='+uParts[5]+'&c='+uParts[6];
                        break;
                    default:
                        throw 'unrecognized process';
                }
            }
            $.ajax({
                dataType: 'JSON',
                url: dbUrl || url,
                type: 'get',
                success: function (data, status) {
                    console.log('successfully fetched ' + url);
                    ixbrlViewer.secDataCache[url] = data;
                    if(success) success(data, url);
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
    },

    callAPI: function(params, callback, fail){
        $.ajax({
            data: params,
            dataType: 'JSON',
            type: 'post',
            url: '/sec/api.php',
            success: function (data, status) {
                console.log('successfully ran command' + params.command);
                callback(data);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                if(fail){
                    fail(params);
                } else {
                    console.log(textStatus);
                    throw(errorThrown);
                }
            }
        });
    },

    setHashSilently: function(hash){
        hasher.changed.active = false; //disable changed signal
        hasher.setHash(hash); //set hash without dispatching changed signal
        hasher.changed.active = true; //re-enable signal
    },

    navigateToTag: function($frameDoc, $navigateToTag){
        if($navigateToTag){
            $frameDoc.find('body').animate({
                scrollTop: $navigateToTag.offset().top - window.innerHeight/2
            });
            $navigateToTag.animate(
                {backgroundColor: "yellow"},
                {duration: 1000}
            );
        }
    },

    getHashAsObject: function(){
        var ary = hasher.getHashAsArray();
        if(ary.length==0) return false;
        var hashObject = {},
            keyValues = ary[0].split('&');
        for(var i=0; i<keyValues.length;i++){
            var keyValue = keyValues[i].split('=');
            if(keyValue.length==2) hashObject[keyValue[0]] = keyValue[1];
        }
        return hashObject;
    },

    axesLabelFormatter: function (axis) {
        var value = axis.value;
        if(value == 0) return value;
        var numericSymbols = ['', 'k', 'M', 'B', 'T', 'P', 'E'],
            i = Math.floor( Math.round( Math.log(Math.abs(value)) / Math.LN10 * 1000) /1000 /3);
            return value / Math.pow(1000, i) + ' ' + numericSymbols[i];
    },

    numberFormatter: function(num, uom){
        return (uom=='USD'?'$':'') + num.toLocaleString() + '&nbsp;' + uom;
    },

    closestCalendricalPeriod: function(end, durationInQuarters) {
        let workingEnd = new Date(end);
        switch(parseInt(durationInQuarters)){
            case 0:
                return 'CY' + workingEnd.getFullYear() + 'Q' + (Math.floor(workingEnd.getMonth()/3) + 1) + 'I';
            case 1:
                workingEnd.setDate(workingEnd.getDate()-40);
                return 'CY' + workingEnd.getFullYear() + 'Q' + (Math.floor(workingEnd.getMonth()/3) + 1);
            case 4:
                workingEnd.setDate(workingEnd.getDate()-180);
                return 'CY' + workingEnd.getFullYear();
        }
        return null;  //if qtrs not 0, 1 or 4;
    },

    parseIXBRL: function(iframeDoc) {
        //put any querystring parameters into an object for easy access
        console.time('parseIXBRL');
        var aParams = location.search.substr(1).split('&'),
            oQSParams = {}, tuplet, i;
        for(i=0;i<aParams.length;i++){
            tuplet = aParams[i].split('=');
            oQSParams[tuplet[0]] = tuplet[1];
        }
        var $frameDoc = $(document.getElementById('app-inline-xbrl-doc').contentDocument);
        //calculate the fiscal to calendar relationship and set document reporting period, fy, adsh and cik
        ixbrlViewer.documentPeriodEndDate= $frameDoc.find('ix\\:nonnumeric[name="dei\\:DocumentPeriodEndDate"]').text();
        ixbrlViewer.reportForm = $frameDoc.find('ix\\:nonnumeric[name="dei\\:DocumentType"]').text();
        //todo: modify to determine priary CIK for multi-filer submission
        ixbrlViewer.cik = $frameDoc.find('ix\\:nonnumeric[name="dei\\:EntityCentralIndexKey"]').text();
        ixbrlViewer.fy = $frameDoc.find('ix\\:nonnumeric[name="dei\\:DocumentFiscalYearFocus"]').text();
        ixbrlViewer.fp = $frameDoc.find('ix\\:nonnumeric[name="dei\\:DocumentFiscalPeriodFocus"]').text();
        ixbrlViewer.fp = $frameDoc.find('ix\\:nonnumeric[name="dei\\:DocumentFiscalPeriodFocus"]').text();
        ixbrlViewer.adsh = window.location.href.split('?doc=')[1].split('/')[1];

        $.getJSON('//restapi.publicdata.guru/sec/financialStatementsByCompany/cik'+parseInt(ixbrlViewer.cik)+'.json',
            function(allFinancialStatements) {
                ixbrlViewer.allFinancialStatements = allFinancialStatements;
                var message = false,
                    submissionsForCurrentDisclosure = [],
                    options = '<option disabled selected hidden>select another disclosure to view or compare</option>';
                $.each(allFinancialStatements, function(i, fs){
                    var isMe = fs.accn.replace(/-/g,'') == ixbrlViewer.adsh;
                    if(isMe) {
                        ixbrlViewer.accn = fs.accn;
                        ixbrlViewer.filed = fs.filed;
                    }
                    options += '<option value="'+fs.accn+'"'+(isMe?' disabled class="italic"':'')+'>'+fs.form+' for FY'+fs.fy+(fs.fp=='fy'?'':fs.fp)+' (filed on '+fs.filed+')</option>';
                    if(isMe || (fs.form.split('/').shift()==ixbrlViewer.reportForm.split('/').shift() && fs.fy==ixbrlViewer.fy && fs.fp==ixbrlViewer.fp)){
                        submissionsForCurrentDisclosure.push(fs);
                    }
                });
                if(!ixbrlViewer.accn) ixbrlViewer.accn = ixbrlViewer.adsh.substr(0,10)+'-'+ixbrlViewer.adsh.substr(10,2)+'-'+ixbrlViewer.adsh.substr(12,10);
                if(submissionsForCurrentDisclosure.length>1){  //this submission is part of a disclosure that has been amended
                    if(submissionsForCurrentDisclosure[0].accn == ixbrlViewer.accn){  //this disclosure is the latest version = offer to compare
                        var oldFS = submissionsForCurrentDisclosure[0];
                        $('#amendmentMessage').html('Amended disclosure. <a href="compare.php?cik='+parseInt(ixbrlViewer.cik)
                            + '&a='+oldFS.accn+"&b="+ixbrlViewer.accn + '>View comparison</a>');
                    } else { //submission being viewed is not the latest! Offer to navigate to latest
                        var latestFS = submissionsForCurrentDisclosure[0];
                        $('#amendmentMessage').html('This submission has been amended. <a href="viewer.php?doc='+parseInt(ixbrlViewer.cik) +'/'
                            + latestFS.accn.replace(/-/g,'') + '/' + latestFS.accn + '-index.html">View ammended submission</a>');
                    }
                }
                $('#fs-select').html(options).change(function(){
                    $('#fs-go').button({disabled: false});  //navigate is enabled on any selection
                    var newAccn = $(this).val();
                    var newFS = ixbrlViewer.allFinancialStatements.filter(function(fs){return fs.accn == newAccn})[0];
                    //redline is enabled enabled only for the same form type (e.g 10-K matches 10-K or 10K/A)
                    $('#fs-redline').button({disabled: !(newFS.form.toUpperCase().substr(0,4) == ixbrlViewer.reportForm.toUpperCase().substr(0,4))});  //navigate is enabled on any selection
                });
                $('#fs-redline').button({disabled: true}).click(function(){
                    var newAccn = $('#fs-select').val();
                    var newFS = ixbrlViewer.allFinancialStatements.filter(function(fs){return fs.accn == newAccn})[0];
                    var url = "compare.php?cik="+parseInt(ixbrlViewer.cik)+ "&a="+(newFS.filed<ixbrlViewer.filed?newAccn:ixbrlViewer.accn)+"&b="+(newFS.filed<ixbrlViewer.filed?ixbrlViewer.accn:newAccn);
                    window.location = url; //navigate there!
                });
                $('#fs-go').button({disabled: true}).click(function(){
                    var newAccn = $('#fs-select').val();
                    var doc = parseInt(ixbrlViewer.cik)+"/"+newAccn.replace(/-/g,'')+"/"+newAccn+"-index.html";
                    window.location = "viewer.php?doc="+doc; //navigate there!
                });
        });

        //get iXBRL context tags make lookup tree for contextRef date values and dimensions
        var start, end, startDate, endDate, $this, $start, $member;
        $frameDoc.find('xbrli\\:context').each(function(i) {
            $this = $(this);
            $start = $this.find('xbrli\\:startdate');
            if($start.length==1) {
                start = $start.html().trim();
                startDate = new Date(start);
                end = $this.find('xbrli\\:enddate').html().trim();
                endDate = new Date(end);
                ixbrlViewer.contextTree[$this.attr('id')] = {
                    end: end,
                    start: start,
                    qtrs: ((endDate.getFullYear() - startDate.getFullYear())*12 + (endDate.getMonth() - startDate.getMonth())) / 3
                }
            } else {
                end = $this.find('xbrli\\:instant').html();
                ixbrlViewer.contextTree[$this.attr('id')] = {
                    end: end,
                    qtrs: 0
                }
            }
            $member = $this.find('xbrldi\\:explicitmember');
            if($member.length && $member.attr('dimension')){
                ixbrlViewer.contextTree[$this.attr('id')].member = $member.html().trim();
                ixbrlViewer.contextTree[$this.attr('id')].dim = $member.attr('dimension');
            }
        });

        //get iXBRL unit tags and make lookup tree for unitRef values
        var $measure, unitParts;
        $frameDoc.find('xbrli\\:unit').each(function(i) {
            $this = $(this);
            $measure = $this.find('xbrli\\:unitnumerator xbrli\\:measure');
            if($measure.length==0) $measure = $this.find('xbrli\\:measure');
            if($measure.length==1){
                unitParts = $measure.html().split(':');
                ixbrlViewer.unitTree[$this.attr('id')] = unitParts.length>1?unitParts[1]:unitParts[0];
            } else console.log('error parsing iXBRL unit tag:', this);
        });

        var $standardTag, navigateToTag = false;
        $frameDoc.find('ix\\:nonfraction').each(function(i){
            var xbrl = ixbrlViewer.extractXbrlInfo(this);
            if(xbrl.isStandard){
                if(!xbrl.dim && (xbrl.qtrs ==0 || xbrl.qtrs ==1 || xbrl.qtrs ==4)) {
                    $standardTag = $(this).addClass("ixbrlViewer_standardFrame");  //only give standard facts an underline and hand
                    if (!ixbrlViewer.standardTagTree[ixbrlViewer.durationPrefix + xbrl.qtrs]) ixbrlViewer.standardTagTree[ixbrlViewer.durationPrefix + xbrl.qtrs] = {};
                    if (!ixbrlViewer.standardTagTree[ixbrlViewer.durationPrefix + xbrl.qtrs][xbrl.uom]) ixbrlViewer.standardTagTree[ixbrlViewer.durationPrefix + xbrl.qtrs][xbrl.uom] = [];
                    if (ixbrlViewer.standardTagTree[ixbrlViewer.durationPrefix + xbrl.qtrs][xbrl.uom].indexOf(xbrl.tag) === -1) {
                        ixbrlViewer.standardTagTree[ixbrlViewer.durationPrefix + xbrl.qtrs][xbrl.uom].push(xbrl.tag);
                    }
                    //flag to navigate to tag if info was supplied on the querystring
                    if(oQSParams.t && oQSParams.q && oQSParams.d && oQSParams.u
                        && xbrl.uom == oQSParams.u
                        && xbrl.tag == oQSParams.t
                        && xbrl.end == oQSParams.d
                        && xbrl.qtrs == oQSParams.q) {
                        navigateToTag = $standardTag;
                    }
                }
            } else {
                $(this).addClass("ixbrlViewer_customTaxonomy");
            }
        });
        $frameDoc.find('head').append(ixbrlViewer.htmlTemplates.injectedTagStyles);
        console.timeEnd('parseIXBRL');
        console.time('addClickFuncs');
        $frameDoc.find('ix\\:nonfraction').click(function(){
            var xbrl = ixbrlViewer.extractXbrlInfo(this);
            ixbrlViewer.vars = xbrl;
            if(xbrl.isStandard){
                if(xbrl.dim){
                    $.fancybox.open('This fact is defined as using the <b>' +xbrl.taxonomy
                        + '</b> standard taxonomy and further divided along the ' + xbrl.dim + 'dimension.<br><br>'
                        + 'Only facts using standard taxonomy with no sub-dimension are organized into the time series API.');
                } else {
                    if(xbrl.qtrs ==0 || xbrl.qtrs ==1 || xbrl.qtrs ==4){
                        ixbrlViewer.openPopupVisualization(xbrl);
                    } else {
                        $.fancybox.open('<h3>Duration not organized for graphing</h3><p>&nbsp;<p>This fact is defined as using the <b>' +xbrl.taxonomy
                            + '</b> standard taxonomy for <b>' + xbrl.qtrs
                            + ' quarters</b> by the filer.<p>Only facts of annual, quarterly, and '
                            + ' as-measured-on-date reported (e.g. snapshot) durations are organized into time series and available for graphing.');
                    }
                }
            } else {
                $.fancybox.open('<h3>Custom Taxonomy</h3><p>&nbsp;<p>This fact is reported using the custom taxonomy <b>'+xbrl.taxonomy + '</b>.'
                    + '<br><br>Only facts reported using standard taxonomies can be reliably compared and are this organized into time series for graphing.');
            }
        });
        ixbrlViewer.navigateToTag($frameDoc, navigateToTag);

        console.timeEnd('addClickFuncs');
        //set Highcharts colors (bright) and SIC Division colors
        var hcColorSet20 = ['#2f7ed8', '#0d233a', '#8bbc21', '#910000', '#1aadce', '#492970', '#f28f43', '#77a1e5', '#c42525', '#a6c96a'],
            hcColorSet30 = ['#4572A7', '#AA4643', '#89A54E', '#80699B', '#3D96AE', '#DB843D', '#92A8CD', '#A47D7C', '#B5CA92'],
            hcColorSet60 = ["#7cb5ec", "#434348", "#90ed7d", "#f7a35c", "#8085e9", "#f15c80", "#e4d354", "#2b908f", "#f45b5b", "#91e8e1"],
            bright =  ['#058DC7', '#50B432', '#ED561B', '#DDDF00', '#24CBE5', '#64E572', '#FF9655', '#FFF263', '#6AF9C4'];
        ixbrlViewer.divColors = bright.concat(hcColorSet30);
        ixbrlViewer.hcColors = hcColorSet60.concat(hcColorSet30);
        Highcharts.setOptions({colors: ixbrlViewer.hcColors});
        for(i=0;i<ixbrlViewer.sicDivisions.length;i++){
            ixbrlViewer.sicDivisions[i].color = ixbrlViewer.divColors[i];
        }

        //show chart on page load if Hash variables present
        hasher.init();
        var hash = ixbrlViewer.getHashAsObject();
        if(hash){
            if(hash.y && hash.d && hash.u && (hash.q || hash.q === '0')) {
                ixbrlViewer.vars = { //taxonomy, isGaap and value not set
                    tag: hash.y,
                    xTag: hash.x,
                    end: hash.d,
                    uom: hash.u,
                    qtrs: hash.q,
                    isStandard: true,
                    cik: parseInt(ixbrlViewer.cik),
                    num_adsh: ixbrlViewer.adsh
                };
                ixbrlViewer.openPopupVisualization(
                    ixbrlViewer.vars,
                    function () { //callback after barChart is loaded
                        if (hash.c == 'f') $('a[href="#tabs-frame"]').click(); //trigger frame table load
                    });
            }
        }
    },

    ////////////////////////  global vars  /////////////////////////////////////////
    htmlTemplates: {
        popWindow:
            '<div id="popviz" style="width:80%;">' +
            '<button id="compare">edit comparisons</button><button id="save">save &amp; compare</button><span id="saved"></span>' +
            '<ul>' +
            '  <li><a href="#tabs-ts">time series</a></li>' +
            '  <li><a href="#tabs-frame">all reporting companies</a></li>' +
            '  <li><a href="#tabs-info">fact info</a></li>' +
            '</ul>' +
            '<div id="tabs-ts"><div id="tschart">loading... please wait</div><div id="tscontrols"></div></div>' +
            '<div id="tabs-frame"><div class="framecontrols">loading... please wait</div></div>' +
            '<div id="tabs-info">show info about the XBRL fact here</div>' +
            '</div>',
        popOptions:
            '<div id="chart-options">' +
            '<h3>Compare to selected iXBRL fact with:</h3>' +
            '<div class="compare_companies_box">' +
            'Enter CIKs or ticker symbols of companies to compare: <input id="user_symbols"><button id="lookup_user_symbols">lookup</button>' +
            '<div id="compared"></div>' +
            '</div>' +
            '<div><table id="savedTimeSeries" class="display" width="100%"></table></div>' +
            '<div class="clear_localStorage">Your saved series and companies are stored in this browser\'s local storage.  To clear <span class="clear_localStorage">click here</span></div>' +
            '</div>',
        comparedCompanyButton:
            '<button class="comparedCompany"></button>',
        frameColumnButton:
            '<button class="frameColumnButton"></button>',
        frameControls: '<select id="frameTagSelector"></select><div class="frameSlider"></div><button class="addCdate">Add Date</button></button><div id="frameOptionTags"></div>',
        toolTip: '<div class="tagDialog"><div class="tagDialogText">say something</div></div>',
        playerControls: '<fieldset class="player_controls">' +
            '<legend>date controls:</legend>' +
              '<div class="player_controls">' +
                '<button class="player_home" title="return to initial date"></button>' +
                '<div class="slider_outer"><div id="sliderTip"></div><div class="player_slider"></div></div>' +
                '<button class="player_play" title="play entire sequence"></button>' +
              '</div>' +
            '</fieldset>',
        injectedTagStyles: '<style>\n' +
                'ix\\:nonfraction.ixbrlViewer_standardFrame {cursor: hand; border-bottom: 2px solid #FF6600 !important;}\n' +
                'ix\\:nonfraction.ixbrlViewer_standardFrame:hover {background-color: lightsalmon;}\n' +
                'ix\\:nonfraction.ixbrlViewer_customTaxonomy {cursor: hand; border-bottom: 1px dotted #FF6600!important;}\n' +
            '</style>'
    },
    htmlStyles: '',
    //CapitalizedUnits: //the filing ndataset capitalizes ISO currency codes
     //   ['USD', 'CNY', 'CAD', 'JPY', 'EUR', 'CHF', 'GBP', 'BRL', 'KRW', 'AUD', 'Y', 'INR', 'MXN', 'HKD', 'ILS','CLP', 'RUB', 'TWD','ARS'],
    sicDivisions: [  //length = 12 (including unused
        {min: 100, max:999,	name: 'Agriculture, Forestry and Fishing', color: 'lightblue'},
        {min: 1000, max:1499,	name: 'Mining', color: 'brown'},
        {min: 1500, max:1799,	name: 'Construction', color: 'grey'},
        {min: 1800, max:1999,	name: 'not used'},
        {min: 2000, max:3999,	name: 'Manufacturing', color: 'cyan'},
        {min: 4000, max:4999,	name: 'Transportation, Communications, Electric, Gas and Sanitary service', color: 'blue'},
        {min: 5000, max:5199,	name: 'Wholesale Trade', color: 'lightgreen'},
        {min: 5200, max:5999,	name: 'Retail Trade', color: 'rose'},
        {min: 6000, max:6799,	name: 'Finance, Insurance and Real Estate', color: 'green'},
        {min: 7000, max:8999,	name: 'Services', color: 'azure'},
        {min: 9100, max:9729,	name: 'Public Administration', color: 'yellow'},
        {min: 9900, max:9999,	name: 'Nonclassifiable', color: 'orange'}
    ],
    durationNames: {
        "0": "snapshot",
        "1": "quarterly",
        "4": "annual"
    },
    localStorageFields: {
        timeSeries: {
            compare: 0,
            company: 1,
            cik: 2,
            tag: 3,
            label: 4,
            qtrs: 5,
            uom: 6
        },
        comparedCompanies: {
            cik: 0,
            ticker: 1,
            name: 2
        }
    },
    rgxAllDash: /-/g,
    durationPrefix: 'DQ',  //after API update this will be 'DQ'
    standardTaxonomies: ['us-gaap','ifrs','dei','country','invest','currency','srt','exch','stpr','naics','rr','sic'],
    //todo:  use MetaLinks.json to get names
    standardTagTree: {}, //filled on doc ready to provide choices in frame table viewer
    contextTree: {}, //filled on doc ready to provide period (duration) lookup
    unitTree: {} //filled on doc ready to provide units lookup
};


ixbrlViewer.sicCode = {
    100: "Agricultural Production-Crops",
    200: "Agricultural Prod-Livestock & Animal Specialties",
    700: "Agricultural Services",
    800: "Forestry",
    900: "Fishing, Hunting And Trapping",
    1000: "Metal Mining",
    1040: "Gold And Silver Ores",
    1090: "Miscellaneous Metal Ores",
    1220: "Bituminous Coal & Lignite Mining",
    1221: "Bituminous Coal & Lignite Surface Mining",
    1311: "Crude Petroleum & Natural Gas",
    1381: "Drilling Oil & Gas Wells",
    1382: "Oil & Gas Field Exploration Services",
    1389: "Oil & Gas Field Services, Nec",
    1400: "Mining & Quarrying of Nonmetallic Minerals (No Fuels)",
    1520: "General Bldg Contractors - Residential Bldgs",
    1531: "Operative Builders",
    1540: "General Bldg Contractors - Nonresidential Bldgs",
    1600: "Heavy Construction Other Than Bldg Const - Contractors",
    1623: "Water, Sewer, Pipeline, Comm & Power Line Construction",
    1700: "Construction - Special Trade Contractors",
    1731: "Electrical Work",
    2000: "Food And Kindred Products",
    2011: "Meat Packing Plants",
    2013: "Sausages & Other Prepared Meat Products",
    2015: "Poultry Slaughtering And Processing",
    2020: "Dairy Products",
    2024: "Ice Cream & Frozen Desserts",
    2030: "Canned, Frozen & Preservd Fruit, Veg & Food Specialties",
    2033: "Canned, Fruits, Veg, Preserves, Jams & Jellies",
    2040: "Grain Mill Products",
    2050: "Bakery Products",
    2052: "Cookies & Crackers",
    2060: "Sugar & Confectionery Products",
    2070: "Fats & Oils",
    2080: "Beverages",
    2082: "Malt Beverages",
    2086: "Bottled & Canned Soft Drinks & Carbonated Waters",
    2090: "Miscellaneous Food Preparations & Kindred Products",
    2092: "Prepared Fresh Or Frozen Fish & Seafoods",
    2100: "Tobacco Products",
    2111: "Cigarettes",
    2200: "Textile Mill Products",
    2211: "Broadwoven Fabric Mills, Cotton",
    2221: "Broadwoven Fabric Mills, Man Made Fiber & Silk",
    2250: "Knitting Mills",
    2253: "Knit Outerwear Mills",
    2273: "Carpets & Rugs",
    2300: "Apparel & Other Finishd Prods of Fabrics & Similar Matl",
    2320: "Men's & Boys' Furnishgs, Work Clothg, & Allied Garments",
    2330: "Women's, Misses', And Juniors Outerwear",
    2340: "Women's, Misses', Children's & Infants' Undergarments",
    2390: "Miscellaneous Fabricated Textile Products",
    2400: "Lumber & Wood Products (No Furniture)",
    2421: "Sawmills & Planting Mills, General",
    2430: "Millwood, Veneer, Plywood, & Structural Wood Members",
    2451: "Mobile Homes",
    2452: "Prefabricated Wood Bldgs & Components",
    2510: "Household Furniture",
    2511: "Wood Household Furniture, (No Upholstered)",
    2520: "Office Furniture",
    2522: "Office Furniture (No Wood)",
    2531: "Public Bldg & Related Furniture",
    2540: "Partitions, Shelvg, Lockers, & Office & Store Fixtures",
    2590: "Miscellaneous Furniture & Fixtures",
    2600: "Papers & Allied Products",
    2611: "Pulp Mills",
    2621: "Paper Mills",
    2631: "Paperboard Mills",
    2650: "Paperboard Containers & Boxes",
    2670: "Converted Paper & Paperboard Prods (No Contaners/Boxes)",
    2673: "Plastics, Foil & Coated Paper Bags",
    2711: "Newspapers: Publishing Or Publishing & Printing",
    2721: "Periodicals: Publishing Or Publishing & Printing",
    2731: "Books: Publishing Or Publishing & Printing",
    2732: "Book Printing",
    2741: "Miscellaneous Publishing",
    2750: "Commercial Printing",
    2761: "Manifold Business Forms",
    2771: "Greeting Cards",
    2780: "Blankbooks, Looseleaf Binders & Bookbindg & Relatd Work",
    2790: "Service Industries for the Printing Trade",
    2800: "Chemicals & Allied Products",
    2810: "Industrial Inorganic Chemicals",
    2820: "Plastic Material, Synth Resin/Rubber, Cellulos (No Glass)",
    2821: "Plastic Materials, Synth Resins & Nonvulcan Elastomers",
    2833: "Medicinal Chemicals & Botanical Products",
    2834: "Pharmaceutical Preparations",
    2835: "In Vitro & In Vivo Diagnostic Substances",
    2836: "Biological Products, (No Disgnostic Substances)",
    2840: "Soap, Detergents, Cleang Preparations, Perfumes, Cosmetics",
    2842: "Specialty Cleaning, Polishing And Sanitation Preparations",
    2844: "Perfumes, Cosmetics & Other Toilet Preparations",
    2851: "Paints, Varnishes, Lacquers, Enamels & Allied Prods",
    2860: "Industrial Organic Chemicals",
    2870: "Agricultural Chemicals",
    2890: "Miscellaneous Chemical Products",
    2891: "Adhesives & Sealants",
    2911: "Petroleum Refining",
    2950: "Asphalt Paving & Roofing Materials",
    2990: "Miscellaneous Products of Petroleum & Coal",
    3011: "Tires & Inner Tubes",
    3021: "Rubber & Plastics Footwear",
    3050: "Gaskets, Packg & Sealg Devices & Rubber & Plastics Hose",
    3060: "Fabricated Rubber Products, Nec",
    3080: "Miscellaneous Plastics Products",
    3081: "Unsupported Plastics Film & Sheet",
    3086: "Plastics Foam Products",
    3089: "Plastics Products, Nec",
    3100: "Leather & Leather Products",
    3140: "Footwear, (No Rubber)",
    3211: "Flat Glass",
    3220: "Glass & Glassware, Pressed Or Blown",
    3221: "Glass Containers",
    3231: "Glass Products, Made of Purchased Glass",
    3241: "Cement, Hydraulic",
    3250: "Structural Clay Products",
    3260: "Pottery & Related Products",
    3270: "Concrete, Gypsum & Plaster Products",
    3272: "Concrete Products, Except Block & Brick",
    3281: "Cut Stone & Stone Products",
    3290: "Abrasive, Asbestos & Misc Nonmetallic Mineral Prods",
    3310: "Steel Works, Blast Furnaces & Rolling & Finishing Mills",
    3312: "Steel Works, Blast Furnaces & Rolling Mills (Coke Ovens)",
    3317: "Steel Pipe & Tubes",
    3320: "Iron & Steel Foundries",
    3330: "Primary Smelting & Refining of Nonferrous Metals",
    3334: "Primary Production of Aluminum",
    3341: "Secondary Smelting & Refining of Nonferrous Metals",
    3350: "Rolling Drawing & Extruding of Nonferrous Metals",
    3357: "Drawing & Insulating of Nonferrous Wire",
    3360: "Nonferrous Foundries (Castings)",
    3390: "Miscellaneous Primary Metal Products",
    3411: "Metal Cans",
    3412: "Metal Shipping Barrels, Drums, Kegs & Pails",
    3420: "Cutlery, Handtools & General Hardware",
    3430: "Heating Equip, Except Elec & Warm Air; & Plumbing Fixtures",
    3433: "Heating Equipment, Except Electric & Warm Air Furnaces",
    3440: "Fabricated Structural Metal Products",
    3442: "Metal Doors, Sash, Frames, Moldings & Trim",
    3443: "Fabricated Plate Work (Boiler Shops)",
    3444: "Sheet Metal Work",
    3448: "Prefabricated Metal Buildings & Components",
    3451: "Screw Machine Products",
    3452: "Bolts, Nuts, Screws, Rivets & Washers",
    3460: "Metal Forgings & Stampings",
    3470: "Coating, Engraving & Allied Services",
    3480: "Ordnance & Accessories, (No Vehicles/Guided Missiles)",
    3490: "Miscellaneous Fabricated Metal Products",
    3510: "Engines & Turbines",
    3523: "Farm Machinery & Equipment",
    3524: "Lawn & Garden Tractors & Home Lawn & Gardens Equip",
    3530: "Construction, Mining & Materials Handling Machinery & Equip",
    3531: "Construction Machinery & Equip",
    3532: "Mining Machinery & Equip (No Oil & Gas Field Mach & Equip)",
    3533: "Oil & Gas Field Machinery & Equipment",
    3537: "Industrial Trucks, Tractors, Trailors & Stackers",
    3540: "Metalworkg Machinery & Equipment",
    3541: "Machine Tools, Metal Cutting Types",
    3550: "Special Industry Machinery (No Metalworking Machinery)",
    3555: "Printing Trades Machinery & Equipment",
    3559: "Special Industry Machinery, Nec",
    3560: "General Industrial Machinery & Equipment",
    3561: "Pumps & Pumping Equipment",
    3562: "Ball & Roller Bearings",
    3564: "Industrial & Commercial Fans & Blowers & Air Purifing Equip",
    3567: "Industrial Process Furnaces & Ovens",
    3569: "General Industrial Machinery & Equipment, Nec",
    3570: "Computer & Office Equipment",
    3571: "Electronic Computers",
    3572: "Computer Storage Devices",
    3575: "Computer Terminals",
    3576: "Computer Communications Equipment",
    3577: "Computer Peripheral Equipment, Nec",
    3578: "Calculating & Accounting Machines (No Electronic Computers)",
    3579: "Office Machines, Nec",
    3580: "Refrigeration & Service Industry Machinery",
    3585: "Air-Cond & Warm Air Heatg Equip & Comm & Indl Refrig Equip",
    3590: "Misc Industrial & Commercial Machinery & Equipment",
    3600: "Electronic & Other Electrical Equipment (No Computer Equip)",
    3612: "Power, Distribution & Specialty Transformers",
    3613: "Switchgear & Switchboard Apparatus",
    3620: "Electrical Industrial Apparatus",
    3621: "Motors & Generators",
    3630: "Household Appliances",
    3634: "Electric Housewares & Fans",
    3640: "Electric Lighting & Wiring Equipment",
    3651: "Household Audio & Video Equipment",
    3652: "Phonograph Records & Prerecorded Audio Tapes & Disks",
    3661: "Telephone & Telegraph Apparatus",
    3663: "Radio & Tv Broadcasting & Communications Equipment",
    3669: "Communications Equipment, Nec",
    3670: "Electronic Components & Accessories",
    3672: "Printed Circuit Boards",
    3674: "Semiconductors & Related Devices",
    3677: "Electronic Coils, Transformers & Other Inductors",
    3678: "Electronic Connectors",
    3679: "Electronic Components, Nec",
    3690: "Miscellaneous Electrical Machinery, Equipment & Supplies",
    3695: "Magnetic & Optical Recording Media",
    3711: "Motor Vehicles & Passenger Car Bodies",
    3713: "Truck & Bus Bodies",
    3714: "Motor Vehicle Parts & Accessories",
    3715: "Truck Trailers",
    3716: "Motor Homes",
    3720: "Aircraft & Parts",
    3721: "Aircraft",
    3724: "Aircraft Engines & Engine Parts",
    3728: "Aircraft Parts & Auxiliary Equipment, Nec",
    3730: "Ship & Boat Building & Repairing",
    3743: "Railroad Equipment",
    3751: "Motorcycles, Bicycles & Parts",
    3760: "Guided Missiles & Space Vehicles & Parts",
    3790: "Miscellaneous Transportation Equipment",
    3812: "Search, Detection, Navagation, Guidance, Aeronautical Sys",
    3821: "Laboratory Apparatus & Furniture",
    3822: "Auto Controls for Regulating Residential & Comml Environments",
    3823: "Industrial Instruments for Measurement, Display, And Control",
    3824: "Totalizing Fluid Meters & Counting Devices",
    3825: "Instruments for Meas & Testing of Electricity & Elec Signals",
    3826: "Laboratory Analytical Instruments",
    3827: "Optical Instruments & Lenses",
    3829: "Measuring & Controlling Devices, Nec",
    3841: "Surgical & Medical Instruments & Apparatus",
    3842: "Orthopedic, Prosthetic & Surgical Appliances & Supplies",
    3843: "Dental Equipment & Supplies",
    3844: "X-Ray Apparatus & Tubes & Related Irradiation Apparatus",
    3845: "Electromedical & Electrotherapeutic Apparatus",
    3851: "Ophthalmic Goods",
    3861: "Photographic Equipment & Supplies",
    3873: "Watches, Clocks, Clockwork Operated Devices/Parts",
    3910: "Jewelry, Silverware & Plated Ware",
    3911: "Jewelry, Precious Metal",
    3931: "Musical Instruments",
    3942: "Dolls & Stuffed Toys",
    3944: "Games, Toys & Children's Vehicles (No Dolls & Bicycles)",
    3949: "Sporting & Athletic Goods, Nec",
    3950: "Pens, Pencils & Other Artists' Materials",
    3960: "Costume Jewelry & Novelties",
    3990: "Miscellaneous Manufacturing Industries",
    4011: "Railroads, Line-Haul Operating",
    4013: "Railroad Switching & Terminal Establishments",
    4100: "Local & Suburban Transit & Interurban Hwy Passenger Trans",
    4210: "Trucking & Courier Services (No Air)",
    4213: "Trucking (No Local)",
    4220: "Public Warehousing & Storage",
    4231: "Terminal Maintenance Facilities for Motor Freight Transport",
    4400: "Water Transportation",
    4412: "Deep Sea Foreign Transportation of Freight",
    4512: "Air Transportation, Scheduled",
    4513: "Air Courier Services",
    4522: "Air Transportation, Nonscheduled",
    4581: "Airports, Flying Fields & Airport Terminal Services",
    4610: "Pipe Lines (No Natural Gas)",
    4700: "Transportation Services",
    4731: "Arrangement of Transportation of Freight & Cargo",
    4812: "Radiotelephone Communications",
    4813: "Telephone Communications (No Radiotelephone)",
    4822: "Telegraph & Other Message Communications",
    4832: "Radio Broadcasting Stations",
    4833: "Television Broadcasting Stations",
    4841: "Cable & Other Pay Television Services",
    4899: "Communications Services, Nec",
    4900: "Electric, Gas & Sanitary Services",
    4911: "Electric Services",
    4922: "Natural Gas Transmission",
    4923: "Natural Gas Transmisison & Distribution",
    4924: "Natural Gas Distribution",
    4931: "Electric & Other Services Combined",
    4932: "Gas & Other Services Combined",
    4941: "Water Supply",
    4950: "Sanitary Services",
    4953: "Refuse Systems",
    4955: "Hazardous Waste Management",
    4961: "Steam & Air-Conditioning Supply",
    4991: "Cogeneration Services & Small Power Producers",
    5000: "Wholesale-Durable Goods",
    5010: "Wholesale-Motor Vehicles & Motor Vehicle Parts & Supplies",
    5013: "Wholesale-Motor Vehicle Supplies & New Parts",
    5020: "Wholesale-Furniture & Home Furnishings",
    5030: "Wholesale-Lumber & Other Construction Materials",
    5031: "Wholesale-Lumber, Plywood, Millwork & Wood Panels",
    5040: "Wholesale-Professional & Commercial Equipment & Supplies",
    5045: "Wholesale-Computers & Peripheral Equipment & Software",
    5047: "Wholesale-Medical, Dental & Hospital Equipment & Supplies",
    5050: "Wholesale-Metals & Minerals (No Petroleum)",
    5051: "Wholesale-Metals Service Centers & Offices",
    5063: "Wholesale-Electrical Apparatus & Equipment, Wiring Supplies",
    5064: "Wholesale-Electrical Appliances, Tv & Radio Sets",
    5065: "Wholesale-Electronic Parts & Equipment, Nec",
    5070: "Wholesale-Hardware & Plumbing & Heating Equipment & Supplies",
    5072: "Wholesale-Hardware",
    5080: "Wholesale-Machinery, Equipment & Supplies",
    5082: "Wholesale-Construction & Mining (No Petro) Machinery & Equip",
    5084: "Wholesale-Industrial Machinery & Equipment",
    5090: "Wholesale-Misc Durable Goods",
    5094: "Wholesale-Jewelry, Watches, Precious Stones & Metals",
    5099: "Wholesale-Durable Goods, Nec",
    5110: "Wholesale-Paper & Paper Products",
    5122: "Wholesale-Drugs, Proprietaries & Druggists' Sundries",
    5130: "Wholesale-Apparel, Piece Goods & Notions",
    5140: "Wholesale-Groceries & Related Products",
    5141: "Wholesale-Groceries, General Line",
    5150: "Wholesale-Farm Product Raw Materials",
    5160: "Wholesale-Chemicals & Allied Products",
    5171: "Wholesale-Petroleum Bulk Stations & Terminals",
    5172: "Wholesale-Petroleum & Petroleum Products (No Bulk Stations)",
    5180: "Wholesale-Beer, Wine & Distilled Alcoholic Beverages",
    5190: "Wholesale-Miscellaneous Nondurable Goods",
    5200: "Retail-Building Materials, Hardware, Garden Supply",
    5211: "Retail-Lumber & Other Building Materials Dealers",
    5271: "Retail-Mobile Home Dealers",
    5311: "Retail-Department Stores",
    5331: "Retail-Variety Stores",
    5399: "Retail-Misc General Merchandise Stores",
    5400: "Retail-Food Stores",
    5411: "Retail-Grocery Stores",
    5412: "Retail-Convenience Stores",
    5500: "Retail-Auto Dealers & Gasoline Stations",
    5531: "Retail-Auto & Home Supply Stores",
    5600: "Retail-Apparel & Accessory Stores",
    5621: "Retail-Women's Clothing Stores",
    5651: "Retail-Family Clothing Stores",
    5661: "Retail-Shoe Stores",
    5700: "Retail-Home Furniture, Furnishings & Equipment Stores",
    5712: "Retail-Furniture Stores",
    5731: "Retail-Radio, Tv & Consumer Electronics Stores",
    5734: "Retail-Computer & Computer Software Stores",
    5735: "Retail-Record & Prerecorded Tape Stores",
    5810: "Retail-Eating & Drinking Places",
    5812: "Retail-Eating Places",
    5900: "Retail-Miscellaneous Retail",
    5912: "Retail-Drug Stores And Proprietary Stores",
    5940: "Retail-Miscellaneous Shopping Goods Stores",
    5944: "Retail-Jewelry Stores",
    5945: "Retail-Hobby, Toy & Game Shops",
    5960: "Retail-Nonstore Retailers",
    5961: "Retail-Catalog & Mail-Order Houses",
    5990: "Retail-Retail Stores, Nec",
    6021: "National Commercial Banks",
    6022: "State Commercial Banks",
    6029: "Commercial Banks, Nec",
    6035: "Savings Institution, Federally Chartered",
    6036: "Savings Institutions, Not Federally Chartered",
    6099: "Functions Related To Depository Banking, Nec",
    6111: "Federal & Federally-Sponsored Credit Agencies",
    6141: "Personal Credit Institutions",
    6153: "Short-Term Business Credit Institutions",
    6159: "Miscellaneous Business Credit Institution",
    6162: "Mortgage Bankers & Loan Correspondents",
    6163: "Loan Brokers",
    6172: "Finance Lessors",
    6189: "Asset-Backed Securities",
    6199: "Finance Services",
    6200: "Security & Commodity Brokers, Dealers, Exchanges & Services",
    6211: "Security Brokers, Dealers & Flotation Companies",
    6221: "Commodity Contracts Brokers & Dealers",
    6282: "Investment Advice",
    6311: "Life Insurance",
    6321: "Accident & Health Insurance",
    6324: "Hospital & Medical Service Plans",
    6331: "Fire, Marine & Casualty Insurance",
    6351: "Surety Insurance",
    6361: "Title Insurance",
    6399: "Insurance Carriers, Nec",
    6411: "Insurance Agents, Brokers & Service",
    6500: "Real Estate",
    6510: "Real Estate Operators (No Developers) & Lessors",
    6512: "Operators of Nonresidential Buildings",
    6513: "Operators of Apartment Buildings",
    6519: "Lessors of Real Property, Nec",
    6531: "Real Estate Agents & Managers (for Others)",
    6532: "Real Estate Dealers (for Their Own Account)",
    6552: "Land Subdividers & Developers (No Cemeteries)",
    6770: "Blank Checks",
    6792: "Oil Royalty Traders",
    6794: "Patent Owners & Lessors",
    6795: "Mineral Royalty Traders",
    6798: "Real Estate Investment Trusts",
    6799: "Investors, Nec",
    7000: "Hotels, Rooming Houses, Camps & Other Lodging Places",
    7011: "Hotels & Motels",
    7200: "Services-Personal Services",
    7310: "Services-Advertising",
    7311: "Services-Advertising Agencies",
    7320: "Services-Consumer Credit Reporting, Collection Agencies",
    7330: "Services-Mailing, Reproduction, Commercial Art & Photography",
    7331: "Services-Direct Mail Advertising Services",
    7340: "Services-To Dwellings & Other Buildings",
    7350: "Services-Miscellaneous Equipment Rental & Leasing",
    7359: "Services-Equipment Rental & Leasing, Nec",
    7361: "Services-Employment Agencies",
    7363: "Services-Help Supply Services",
    7370: "Services-Computer Programming, Data Processing, Etc.",
    7371: "Services-Computer Programming Services",
    7372: "Services-Prepackaged Software",
    7373: "Services-Computer Integrated Systems Design",
    7374: "Services-Computer Processing & Data Preparation",
    7377: "Services-Computer Rental & Leasing",
    7380: "Services-Miscellaneous Business Services",
    7381: "Services-Detective, Guard & Armored Car Services",
    7384: "Services-Photofinishing Laboratories",
    7385: "Services-Telephone Interconnect Systems",
    7389: "Services-Business Services, Nec",
    7500: "Services-Automotive Repair, Services & Parking",
    7510: "Services-Auto Rental & Leasing (No Drivers)",
    7600: "Services-Miscellaneous Repair Services",
    7812: "Services-Motion Picture & Video Tape Production",
    7819: "Services-Allied To Motion Picture Production",
    7822: "Services-Motion Picture & Video Tape Distribution",
    7829: "Services-Allied To Motion Picture Distribution",
    7830: "Services-Motion Picture Theaters",
    7841: "Services-Video Tape Rental",
    7900: "Services-Amusement & Recreation Services",
    7948: "Services-Racing, Including Track Operation",
    7990: "Services-Miscellaneous Amusement & Recreation",
    7997: "Services-Membership Sports & Recreation Clubs",
    8000: "Services-Health Services",
    8011: "Services-Offices & Clinics of Doctors of Medicine",
    8050: "Services-Nursing & Personal Care Facilities",
    8051: "Services-Skilled Nursing Care Facilities",
    8060: "Services-Hospitals",
    8062: "Services-General Medical & Surgical Hospitals, Nec",
    8071: "Services-Medical Laboratories",
    8082: "Services-Home Health Care Services",
    8090: "Services-Misc Health & Allied Services, Nec",
    8093: "Services-Specialty Outpatient Facilities, Nec",
    8111: "Services-Legal Services",
    8200: "Services-Educational Services",
    8300: "Services-Social Services",
    8351: "Services-Child Day Care Services",
    8600: "Services-Membership Organizations",
    8700: "Services-Engineering, Accounting, Research, Management",
    8711: "Services-Engineering Services",
    8731: "Services-Commercial Physical & Biological Research",
    8734: "Services-Testing Laboratories",
    8741: "Services-Management Services",
    8742: "Services-Management Consulting Services",
    8744: "Services-Facilities Support Management Services",
    8880: "American Depositary Receipts",
    8888: "Foreign Governments",
    8900: "Services-Services, Nec",
    9721: "International Affairs",
    9995: "Non-Operating Establishments"
};

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