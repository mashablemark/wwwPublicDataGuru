"use strict";
/**
 * Created by User on 10/26/2018.
 */
//deltaMonth is added to fiscal year quarter to get actual date.  A value of 0 means company's fiscal year aligns with calendar year
var ixbrlViewer = {

    //ixbrlViewer global variables
    rgxSeparator: /[\s.;]+/g,
    deltaMonth: false,
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
            if(fact.data[i][this.frameDataCol.cik] == cik) return fact.data[i][this.frameDataCol.sic];
        }
        return false;
    },
    contextRef: function(ddate, qtrs){  //only used in document.ready
        var rptDate = new Date(ddate),
            contextString;
        rptDate.setMonth(rptDate.getMonth() + this.deltaMonth);
        contextString = (qtrs==0?'FI':'FD');
        contextString += rptDate.getFullYear() + 'Q' + (rptDate.getMonth()+1)/3;
        if(qtrs==1) contextString += 'QTD';
        if(qtrs==4) contextString += 'YTD';
        return contextString;
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
            cik: this.cik,
            num_adsh: this.adsh
        };
        if(this.contextTree[contextRef]){
            xbrl.qtrs = this.contextTree[contextRef].qtrs;
            xbrl.ddate = this.contextTree[contextRef].ddate;
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
        $('#save').html(tagIndex===false?'save':'saved');
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
                }
            });
        var disable = [];
        if(!self.makeXAxisSelector(oVars.tag, oVars.uom, oVars.qtrs)) disable.push(2);
        $('#popviz').tabs({'disabled': disable});
        $('a[href="#tabs-ts"]').click(function(){$('#save, #compare').show()});
        $('a[href="#tabs-map"]').click(function(){
            if(!ixbrlViewer.bubbleMap)self.showMap(oVars);
            $('#save, #compare').hide();
        });
        $('a[href="#tabs-scatter"]').click(function(){
            if(!ixbrlViewer.scatterChart)self.showScatterChart(oVars);
            $('#save, #compare').hide();
        });
        $('a[href="#tabs-frame"]').click(function(){
            if(!ixbrlViewer.dtFrame)self.showFrameTable(oVars);
            //$('#save, #compare').hide();
        });
        self.configureSaveControls(oVars);
        $('#save').click(function(){
            var $save = $('#save'),
                save = $save.html() == 'save';
            self.changeTimeSeriesStorage(oVars, save);
            $save.html(save?'saved':'save');
        });
        $('#compare').click(function(){self.showCompareOptions(oVars)});
        self.drawBarChart(oVars, callback);
    },

    drawBarChart: function(oVars, callback){  //can be called to redraw
        var self = this,
            url = 'https://restapi.publicdata.guru/sec/timeseries/' + oVars.tag + '/cik' + oVars.cik;
        self.fetchTimeSeriesToCache(oVars,
            function(aryTimeSeries){
                if(aryTimeSeries.length==0 || !self.secDataCache[url]){
                    $('#popviz').html('Unable to load data from API for this series.  This may be because it is a sole-point or because the API has not yet been updated.');
                    return false
                }
                //DISCUSS!! -> add clicked value if not in API (possible when disclosure just desseminated and APIs have not yet been updated)
                if(aryTimeSeries.length>0 && aryTimeSeries[0].url == url){
                    var timeseries = aryTimeSeries[0],
                        ts = self.secDataCache[url][oVars.tag]['cik'+oVars.cik]['units'][oVars.uom][ixbrlViewer.durationPrefix+oVars.qtrs],
                        found = false,
                        pt,
                        coName;
                    oVars.adsh =  oVars.num_adsh.substr(0,10) + '-' + oVars.num_adsh.substr(10,2) + '-' + oVars.num_adsh.substr(12,6);
                    for(var i=0;i<ts.length;i++){
                        pt = self.parseTsPoint(ts[i]);
                        coName = pt.coName;
                        if(pt.adsh == oVars.adsh){
                            found = true;
                            break;
                        }
                    }
                    if(!found){
                        ts.push([
                            oVars.ddate,
                            parseFloat(oVars.value.replace(',','')),
                            oVars.adsh,
                            self.reportPeriod,
                            self.reportForm,
                            coName
                        ]);
                    }
                }

                oVars.label = self.secDataCache[url][oVars.tag].label;
                oVars.company = self.secDataCache[url][oVars.tag]['cik'+oVars.cik].name;
                var oChart = makeTimeSeriesChartObject(aryTimeSeries, oVars);
                $('#tscontrols').html(makeDurationSelectorHtml(self.secDataCache[url], oVars) + makeUnitsSelectorHtml(self.secDataCache[url], oVars));
                oChart.chart.renderTo = $('#tschart')[0];
                if(self.barChart) self.barChart.destroy();
                self.barChart = new Highcharts.Chart(oChart);
                if(self.scatterChart) {
                    self.scatterChart.destroy();
                    self.scatterChart = false;
                }
                if(self.bubbleMap){
                    self.bubbleMap.remove();
                    self.bubbleMap = false;
                }
                $('#popviz_durations, #popviz_units').change(function(){
                    self.vars.qtrs = $('#popviz_durations').val() || self.vars.qtrs;
                    self.vars.uom = $('#popviz_units').val() || self.vars.uom;
                    self.fetchTimeSeriesToCache(self.vars, function(aryNewTimeSeries){
                        var oChart = makeTimeSeriesChartObject(aryNewTimeSeries, self.vars);
                        if(self.barChart) self.barChart.destroy();
                        oChart.chart.renderTo = $('#tschart')[0];
                        self.barChart = new Highcharts.Chart(oChart);
                    });
                });
                if(callback) callback(); else self.setHashSilently('y=' + oVars.tag +'&d=' +  oVars.ddate  +'&u=' +  oVars.uom  +'&q=' +  oVars.qtrs +'&c=b');
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
                html += '<option value="' + durations[i] + '"' +(durations[i]==oVars.qtrs?' selected':'')+ '>' + ixbrlViewer.durationNames[durations[i]] + '</option>';
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
                        type: 'column'
                    },
                    tooltip:{
                        followPointer: false,
                        hideDelay: 2500,
                        useHTML: true,
                        style: {
                            pointerEvents: 'auto'
                        },
                        pointFormatter: function(){ //change to "" in Highcharts v.4+
                            //todo:  fix this for multiseries charts
                            var sParam = aryTimeSeriesParams[this.series.index],
                                ts = self.secDataCache[sParam.url][sParam.tag]['cik'+sParam.cik]['units'][sParam.uom][ixbrlViewer.durationPrefix+sParam.qtrs];
                            var disclosures = [], disclosure, lastDisclosure = false;
                            for(var i=0;i<ts.length;i++){
                                disclosure = self.parseTsPoint(ts[i]);
                                if(disclosure.date==this.ddate){
                                    if(lastDisclosure && lastDisclosure.y != disclosure.y){
                                        disclosures.push('<span style="color:orange;"><b>Revised from:</b></span>');
                                    }
                                    if(disclosure.adsh != callingParams.adsh){
                                        disclosures.push('<a href="/sec/viewer.php?doc=' + callingParams.cik
                                            +'/'+disclosure.adsh.replace(self.rgxAllDash,'')+'/'+ disclosure.adsh
                                            +'-index&u='+callingParams.uom+'&q='+callingParams.qtrs+'&d='+disclosure.date
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
                            return '<b>' + self.secDataCache[sParam.url][sParam.tag]['cik'+sParam.cik].name + ' disclosures for ' + this.ddate + '</b><br><br>' + disclosures.join('<br>');
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
                        column: {
                            stickyTracking: false
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
                chartLabels.subtitle =  sameTag ? self.secDataCache[tsp.url][tsp.tag].desc: '';
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
                            if (latestPoint.date != point.date) {
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
                    var xDate = new Date(pt.date),
                        hcDate = Date.UTC(xDate.getFullYear(), xDate.getMonth(), xDate.getDay()),
                        hcPt = {x: hcDate, y: pt.y, ddate: pt.date};
                    if(adjusted)
                        hcPt.borderColor = 'orange';
                    serie.data.push(hcPt);
                    if(pt.value>0) yAxes.chartOptions[yAxes.map[tsParams.uom]].somePos = true;
                    if(pt.value<0) yAxes.chartOptions[yAxes.map[tsParams.uom]].someNeg = true;
                }
            }
        }
    },

    showScatterChart: function(oVars){
        //get data for both frames via REST API (S3 bucket)
        var self = this,
            xFrame,
            yFrame,
            oChart,
            xUrl,
            yUrl = 'https://restapi.publicdata.guru/sec/frames/'+oVars.tag+'/'+oVars.uom+'/DQ'+oVars.qtrs +'/'+this.cdate(oVars.ddate, oVars.qtrs),
            ply,
            $playerControls,
            $home,
            $playPause,
            $slider,
            playing = false,
            frameChanged = false,
            cancelChange = false,
            animationTimer = false,
            newFrameFetches = 0;
        
        self.getRestfulData(
            yUrl,
            function(frame){   //parallel fetch of y Axis data
                yFrame = frame;
                self.vars.sic = self.getSicFromFrame(yFrame, self.vars.cik);
                $('#scatterchart').html('Y-Axis data successfully loaded for ' + oVars.tag);
                $('#scattercontrols')
                    .html(self.makeXAxisSelector(oVars.tag, oVars.uom, oVars.qtrs) + self.makeSicFilterHTML(self.vars.sic))
                    .find('select.sic_filter')
                    .change(function(){
                        oVars.sicFilter = $(this).val();
                        if(self.scatterChart){
                            self.scatterChart.destroy();
                            self.scatterChart = false;
                        }
                        oChart = makeScatterChartObject(xFrame, yFrame, oVars);
                        linLogControl(oVars);
                        oChart.chart.renderTo = $('#scatterchart')[0];
                        self.scatterChart = new Highcharts.Chart(oChart);
                    })
                    .end()
                    .find('#scatter-x-axis-select')
                    .change(function(){
                        var $xSelector = $(this),
                            xTagValue = $xSelector.val();
                        $xSelector.find('option[init="instructions"]').remove();
                        if(oVars.xTag != xTagValue) {
                            oVars.xTag = xTagValue;
                            $xSelector.attr('disabled', 'disabled');
                            xUrl = 'https://restapi.publicdata.guru/sec/frames/' + oVars.xTag + '/' + oVars.uom + '/DQ' + oVars.qtrs + '/' + self.cdate(oVars.ddate, oVars.qtrs);
                            self.getRestfulData(xUrl,
                                function (frame) {   //parallel fetch of x Axis data
                                    xFrame = frame;
                                    self.setHashSilently('y=' + oVars.tag + '&x=' + oVars.xTag + '&u=' + oVars.uom + '&q='
                                        + oVars.qtrs + '&d=' + oVars.ddate + '&c=s');
                                    if (self.scatterChart) {
                                        self.scatterChart.destroy();
                                        self.scatterChart = false;
                                    }
                                    var oChart = makeScatterChartObject(xFrame, yFrame, oVars);
                                    linLogControl(oVars);
                                    oChart.chart.renderTo = $('#scatterchart')[0];
                                    self.scatterChart = new Highcharts.Chart(oChart);
                                    $xSelector.removeAttr('disabled');
                                    ply = self.playerIndexes(oVars);
                                    if(ply.dateIndex.length>1 && $('#scattercontrols .player_controls').length==0){
                                        $playerControls = $('#scattercontrols').append(self.htmlTemplates.playerControls);
                                        $home = $playerControls.find('.player_home').button({icon: "ui-icon-home", 'disabled': true})
                                            .click(function(){
                                                stopAnimation(); //turn off any animation
                                                cancelChange = false;
                                                newFrameFetches=0;
                                                changeFrame(ply.homeIndex);
                                            });
                                        $playPause = $playerControls.find('.player_play').button({icon: "ui-icon-play"})
                                            .click(function(){
                                                if($playPause.find('.ui-icon-play').length){
                                                    startAnimation();
                                                } else {
                                                    stopAnimation();
                                                }
                                                //set slider index to zero
                                                //start animation (which changes play icon to pause icon)
                                            });
                                        $slider = $playerControls.find('.player_slider').slider({
                                                min: 0,
                                                max: ply.dateIndex.length -1,
                                                value: ply.homeIndex,
                                                start: function() {
                                                    stopAnimation(); //user starts slide: halt any animation
                                                },
                                                stop: function() {
                                                    cancelChange = false;
                                                    changeFrame($slider.slider('value')); //force change on user slide
                                                },
                                            change: function() {
                                                $home.button(ply.homeIndex == $slider.slider('value') ? 'disable' : 'enable');
                                            }
                                        }).mousemove(function(e){
                                            if(e.currentTarget!=e.target) return;
                                                var index = Math.round(e.offsetX/this.offsetWidth * (ply.dateIndex.length-1)),
                                                    $st = $('#sliderTip');
                                            $st.html(ply.dateIndex[index]).show()
                                                .css('left', (index*this.offsetWidth/ply.dateIndex.length-$st.width()/2)+'px');
                                        }).mouseout(function(e){$('#sliderTip').hide()});
                                    }
                                },
                                function(failedUrl) {
                                    $xSelector.removeAttr('disabled');
                                    fetch_error(failedUrl)
                                })
                        }
                    });
                if(oVars.xTag){ //if preselected
                    $('#scatter-x-axis-select').val(oVars.xTag);
                    oVars.xTag = ''; //make it think its a new value
                    $('#scatter-x-axis-select').change(); //trigger load and chart draw
                }
            },
            fetch_error
        );

        
        /*var url = 'https://restapi.publicdata.guru/sec/timeseries/'+oVars.tag+'/cik'+oVars.cik;
        self.getRestfulData(url, function(timeseries){  //this should be from memory
            //todo: make the play controls
        });*/

        function fetch_error(url){
            $('#scatterchart').html('Unable to load snapshot from API for ' + url);
        }

        function linLogControl(oVars){
            //disabled for now with flase in if statement on following line
            if(false && oVars.positiveValuesX && oVars.positiveValuesY){
                if(!$('#linlog').length){
                    var $controls = $('#scattercontrols'),
                    $linlog = $controls.append(self.htmlTemplates.linLogToggle).find('#linlog');
                    $linlog
                        .controlgroup({icon: false})
                        .find('input').click(function() {
                            var type = this.value;
                    });
                }
            } else {
                $('#linlog').remove();
            }
        }


        function startAnimation(){
            playing = true;
            frameChanged = false;
            cancelChange = false;
            var sliderValue = $slider.slider("value"),
                newSliderValue = (sliderValue==ply.dateIndex.length-1 || sliderValue==ply.homeIndex)?0:sliderValue+1;
            $slider.slider("value", newSliderValue);
            changeFrame(newSliderValue);
            $playPause.button({icon: "ui-icon-pause"});
        }

        function stopAnimation(){
            clearTimeout(animationTimer);
            animationTimer = false;
            cancelChange = true;
            playing = false;
            frameChanged = false;
            $playPause.button({icon: "ui-icon-play"});
        }
        var newDate, yUrlNew, xUrlNew, newDateIndex;
        function changeFrame(dateIndex){
            newDateIndex = dateIndex;
            newDate = ply.dateIndex[dateIndex];
            yUrlNew = 'https://restapi.publicdata.guru/sec/frames/'+oVars.tag+'/'+oVars.uom+'/DQ'+oVars.qtrs +'/'+self.cdate(newDate, oVars.qtrs);
            xUrlNew = 'https://restapi.publicdata.guru/sec/frames/'+oVars.xTag+'/'+oVars.uom+'/DQ'+oVars.qtrs +'/'+self.cdate(newDate, oVars.qtrs);
            newFrameFetches = 0;
            fetchNew(xUrlNew);
            fetchNew(yUrlNew);
            function fetchNew(url){
                self.getRestfulData(url, function(data){
                        newFrameFetches++;
                        if(newFrameFetches==2 && !animationTimer) makeFrame();
                    },
                    function(url){
                        stopAnimation();  //REST fetch failure:  no animation for this frame
                    }
                )
            }

        }
        function makeFrame(){
            var xFrame = self.secDataCache[xUrlNew],
                yFrame = self.secDataCache[yUrlNew],
                updatedSeries = makeScatterSeries(xFrame, yFrame, oVars),
                hcSeries = ixbrlViewer.scatterChart.series,
                fastAlgo = hcSeries[0].data.length>10000, //note: the updates are much faster in HC 6.x!
                pt, ptTree = {}, s, i;
            //the setData method takes 64ms vs. 900ms looping through point updates for 7000 points
            if(fastAlgo){  //algorithm switching
                for(s=0; s<hcSeries.length;s++) {
                    if(updatedSeries[s]){
                        hcSeries[s].setData(updatedSeries[s].data, false, false, false);
                    } else {
                        hcSeries[s].setData([], false, false, false);
                    }
                }
            } else {  //animate point moves = slower algorithm, but can be used for fewer points
                for(s=0; s<updatedSeries.length;s++){
                    for(i=0;i<updatedSeries[s].data.length;i++){
                        ptTree[updatedSeries[s].data[i].id] = updatedSeries[s].data[i];
                    }
                }
                for(s=0; s<hcSeries.length;s++){
                    for(i=hcSeries[s].data.length-1;i>=0;i--){ //better able to push new and slice out old
                        if(ptTree[hcSeries[s].data[i].id]){
                            //update point:
                            hcSeries[s].data[i].update(
                                {x: ptTree[hcSeries[s].data[i].id].x, y: ptTree[hcSeries[s].data[i].id].y},
                                false,
                                true
                            );
                            delete ptTree[hcSeries[s].data[i].id];
                        } else {
                            //delete point:
                            hcSeries[s].removePoint(i, false, false);
                        }
                    }
                }
                for(var id in ptTree){
                    if(ptTree[id]){
                        //add point:
                        hcSeries[ptTree[id].hl?1:0].addPoint(ptTree[id], false, false, true);
                    }
                }
            }
            ixbrlViewer.scatterChart.setTitle({ text: titleText(xFrame, yFrame)}, null, false);
            ixbrlViewer.scatterChart.redraw(!fastAlgo);
            $slider.slider("value", newDateIndex); //set if not already
            if(playing) nextFrame();
        }

        function nextFrame(){
            if($slider.slider("value")==ply.dateIndex.length-1){
                stopAnimation();
            } else {
                changeFrame(newDateIndex+1);
                var ms = Math.min(Math.max(250, 4000/ply.dateIndex.length), 1000);
                animationTimer = setTimeout(function(){
                    clearTimeout(animationTimer);
                    animationTimer = false;
                    if(newFrameFetches==2) makeFrame();
                }, ms);
            }
        }
        function makeScatterChartObject(xFrame, yFrame, callingParams){
            var scatterSeries = makeScatterSeries(xFrame, yFrame, callingParams); //sets callingParam values used in next statement
            var oChart = {
                chart: {
                    type: 'scatter',
                    zoomType: 'xy'
                },
                legend: {enabled: true},
                tooltip: {
                    //formatter: function(){console.log(this)},
                    useHTML: true,
                    formatter: function () {
                        var pt = this.point;

                        return '<b>' + pt.name + '</b><div style="color: ' + pt.divColor + '"><b>' + pt.divName + '</b><br>'+ixbrlViewer.sicCode[pt.sic]+'</div>' +
                            '<br><br>' +
                            '<table>' +
                            '<tr>' +
                            '<td>' + yFrame.label + '</td><td style="text-align: right">' + self.numberFormatter(pt.y, callingParams.uom) + '</td>' +
                            '</tr>' +
                            '<tr>' +
                            '<td>' + xFrame.label + '</td><td style="text-align: right">' + self.numberFormatter(pt.x, callingParams.uom) + '</td>' +
                            '</tr>' +
                            '</table>' +
                            '<div><i>click on point to navigate to source disclosure</i></div>';
                    }
                },
                plotOptions: {
                    scatter: {
                        cursor: 'pointer',
                        point: {
                            events: {
                                click: function () {
                                    var fld = self.frameDataCol,
                                        factRow = yFrame.data[this.iy];
                                    location.href = '/sec/viewer.php?doc=' + factRow[fld.cik]
                                        +'/'+factRow[fld.adsh].replace(self.rgxAllDash,'')+'/'+ factRow[fld.adsh]
                                        +'-index&u='+yFrame.uom+'&q='+yFrame.qtrs+'&d='+yFrame.ddate
                                        +'&t='+yFrame.tag;
                                }
                            }
                        },
                        turboThreshold: 10000
                    }
                },
                title: {
                    text: titleText(xFrame, yFrame)
                },
                subtitle: {
                    text: ''
                },
                credits: {
                    enabled: true,
                    text: 'data provided by U.S. Securities and Exchange Commission',
                    href: 'https://www.sec.gov'
                },
                yAxis: {
                    type: (callingParams.log?'logarithmic':'linear'),
                    //min: 0,
                    title: {
                        text: yFrame.uom
                    },
                    labels: {
                        formatter: function() {
                            return self.axesLabelFormatter(this);
                        }
                    }
                },
                xAxis: {
                    type: (callingParams.log?'logarithmic':'linear'),
                    //min: 0,
                    title: {
                        text: xFrame.uom
                    },
                    labels: {
                        formatter: function() {
                            return self.axesLabelFormatter(this);
                        }
                    }
                },
                series: scatterSeries
            };
            if(callingParams.positiveValuesX && !callingParams.log){
                oChart.xAxis.min = 0;
            }
            if(callingParams.positiveValuesY && !callingParams.log){
                oChart.yAxis.min = 0;
            }
            return oChart;
            //series format: [{data: [{ x: 95, y: 95, z: 13.8, name: 'BE', country: 'Belgium' },...]}, color:'blue',name'asdf']
        }

        function titleText(xFrame, yFrame){
             return yFrame.label + ' versus ' + xFrame.label + ' as reported for ' + (xFrame.qtrs == 0 ? '' : (xFrame.qtrs == 1 ? 'quarter' : 'year') + ' ending ') + xFrame.ddate
        }

        function makeScatterSeries(xFrame, yFrame, callingParams){
            var savedCompanies = self.getComparedCompanies();
            var highlightCIKs = ['cik'+parseInt(oVars.cik)],
                highlightPoints = {},
                i,
                flds = self.localStorageFields.comparedCompanies;
            //saved companies that are selected
            for(i=0; i<savedCompanies.length; i++){
                highlightCIKs.push('cik'+parseInt(savedCompanies[i][flds.cik]));
            }
            var nonHighlightSerie = [],
                xData = xFrame.data,
                yData = yFrame.data,
                positiveValuesX = true,  //calculated for axis min value and log option
                positiveValuesY = true,
                ix = 0,
                iy = 0,
                inFilter,
                ptSic,
                ptSicDivision,
                divisionName = false,
                color,
                frameDataCol = self.frameDataCol,
                pt;
            //sort by CIKs
            xData.sort(function(a,b){return b[frameDataCol.cik] - a[frameDataCol.cik]});
            yData.sort(function(a,b){return b[frameDataCol.cik] - a[frameDataCol.cik]});
            while(xData.length>ix && yData.length>iy){
                if(xData[ix][frameDataCol.cik] == yData[iy][frameDataCol.cik]){
                    ptSic = xData[ix][frameDataCol.sic];
                    ptSicDivision = self.getSicDivision(ptSic);
                    divisionName = ptSicDivision?ptSicDivision.name:'SIC code not available';
                    switch(callingParams.sicFilter || 'all'){
                        case "all":
                            inFilter = true;
                            break;
                        case "div":
                            inFilter = (ptSic >=callingParams.sicDivision.min && ptSic<=callingParams.sicDivision.max);
                            break;
                        case "ind":
                            inFilter = (callingParams.sic == ptSic);
                            break;
                    }
                    if(inFilter) {
                        color = ptSicDivision?ptSicDivision.color:'grey';
                        if(xData[ix][frameDataCol.value]<=0) positiveValuesX = false;
                        if(yData[iy][frameDataCol.value]<=0) positiveValuesY = false;
                        pt =  {
                            x: xData[ix][frameDataCol.value],
                            y: yData[iy][frameDataCol.value],
                            id: 'cik' + xData[ix][frameDataCol.cik],
                            ix: ix,
                            iy: iy,
                            sic: ptSic,
                            divColor: color,
                            divName: divisionName,
                            name: xData[ix][frameDataCol.name],
                            marker: {
                                lineColor: color
                            }
                        };
                        if(highlightCIKs.indexOf(pt.id) !== -1){
                            delete pt.marker;
                            highlightPoints[pt.id] = pt;
                        } else {
                            nonHighlightSerie.push(pt);
                        }
                    }
                    ix++;
                    iy++;
                } else {
                    if(xData[ix][frameDataCol.cik] > yData[iy][frameDataCol.cik]){
                        ix++;
                    } else {
                        iy++;
                    }
                }
            }
            var scatterSeries = [{
                marker: {
                    fillColor: 'rgba(0,0,0,0)',
                    symbol: 'diamond',
                    lineWidth: 1,
                    states: {
                        hover: {
                            fillColor: 'rgba(0,0,0,1)'
                        }
                    }
                },
                id: 'scatter-frame',
                data: nonHighlightSerie,
                showInLegend: false
            }];
            var cIndex = 0;
            for(i=0; i<highlightCIKs.length; i++){
                if(highlightPoints[highlightCIKs[i]]){
                    scatterSeries.push({
                        marker: {
                            symbol: 'circle',
                            fillColor: self.barChart.options.colors[cIndex],
                            lineColor: 'black',
                            lineWidth: 1
                        },
                        data: [highlightPoints[highlightCIKs[i]]],
                        name: highlightPoints[highlightCIKs[i]].name,
                        id: 'scatter-cik'+ highlightCIKs[i],
                        showInLegend: true
                    });
                    cIndex++;
                }
            }
            callingParams.positiveValuesX = positiveValuesX;
            callingParams.positiveValuesY = positiveValuesY;
            if(!(callingParams.positiveValuesY && callingParams.positiveValuesY)) callingParams.log = false;
            return scatterSeries;
        }
    },

    showFrameTable: function(oVars){
        //get data for both frames via REST API (S3 bucket)
        var self = this,
            cols = self.frameDataCol,
            ply = self.playerIndexes(oVars),
            url = 'https://restapi.publicdata.guru/sec/frames/'+oVars.tag+'/'+oVars.uom+'/DQ'+oVars.qtrs +'/'+this.cdate(oVars.ddate, oVars.qtrs),
            $slider;
        self.getRestfulData(
            url,
            function(frame){   //parallel fetch of y Axis data
                //add sicname field, drop latLng field,
               /* for(var i=0; i<frame.data.length;i++){
                    frame.data[i].splice(frameDataCol.sic, 0, (self.sicCode[frame.data[i][frameDataCol.sic]]) ||'');
                }*/
                $slider = $('#tabs-frame div.framecontrols').html('').slider({
                    min: 0,
                    max: ply.dateIndex.length - 1,
                    value: ply.homeIndex,
                    stop: function () {
                        changeFrame($slider.slider('value')); //force change on user slide
                    }
                });
                self.dtFrame = $('#frame-table').DataTable( {
                    data: frame.data,
                    dom: 'Bfrtip',
                    columns: [ //["AAR CORP", 1750, 3720, "0001104659-18-073842", "US-IL", Array(2), "2018-05-31", 31100000, 1]
                        {   title: "Entity Name", className: "dt-body-left"  },
                        {   title: "CIK"},
                        {   title: "SIC Classification",
                            render: function(data, type, row, meta){
                                return data? data+' - '+ixbrlViewer.sicCode[data]:'';
                            },
                            className: "dt-body-left" },
                        {   title: "Accession No.",
                            render: function (data, type, row, meta) {
                                return '<a href="https://www.sec.gov/Archives/edgar/data/' + data + '/' + data.replace(/-/g,'') + '/' + data + '-index.html">' + data + '</a>';
                            }
                        },
                        {   title: "Location", className: "dt-body-center" },
                        {   title: "latLng", visible: false},
                        {   title: "Date", visible: false, render: function (data, type, row, meta) {return data.substr(0,7);}},
                        {   title: frame.tlabel, className: "dt-body-right", render: function(data){ return ixbrlViewer.numberFormatter(data, frame.uom)}},
                        {   title: "versions", visible: false}
                    ],
                    scrollY: "500px",
                    scrollX: false,
                    scrollCollapse: true,
                    scroller: {rowHeight: 'auto'},
                    deferRender: true,
                    oLanguage: {"sSearch": "Text search"},
                    order: [[6, 'desc']],
                    buttons: [
                        'copy',
                        'excel',
                        'csv'
                    ]
                });
            },
            fetch_error
        );


        /*var url = 'https://restapi.publicdata.guru/sec/timeseries/'+oVars.tag+'/cik'+oVars.cik;
        self.getRestfulData(url, function(timeseries){  //this should be from memory
            //todo: make the play controls
        });*/

        function fetch_error(url){
            $('#scatterchart').html('Unable to load snapshot from API for ' + url);
        }
    },
    showMap: function(oVars){
        //get frame data via REST API (S3 bucket)
        var url = 'https://restapi.publicdata.guru/sec/frames/'+oVars.tag+'/'+oVars.uom+'/DQ'+oVars.qtrs+'/'+ this.cdate(oVars.ddate, oVars.qtrs);
        var self = this;
        self.getRestfulData(url,
            function(frame){
                self.vars.sic = self.getSicFromFrame(frame, self.vars.cik);
                var oMap = makeMapObject(frame);
                self.bubbleMap = $('#mapchart').html('').height(500).vectorMap(oMap).vectorMap('get', 'mapObject');

                $('#maptitle').html(self.makeTitle(frame.label, oVars.qtrs, oVars.ddate));
                $('#mapcontrols')
                    .html(self.makeSicFilterHTML(self.vars.sic))
                    .find('select.sic_filter').change(function(){
                        oVars.sicFilter = $(this).val();
                        self.bubbleMap.remove();
                        oMap = makeMapObject(frame);
                        self.bubbleMap = $('#mapchart').html('').height(500).vectorMap(oMap).vectorMap('get', 'mapObject');
                });
                $('#mapdatalinks').html('data from <a href="'+url+'">'+url+'</a>');
                self.setHashSilently('y=' + oVars.tag +'&d=' +  oVars.ddate  +'&u=' +  oVars.uom  +'&q=' +  oVars.qtrs +'&c=m');
            },
            function(){
                $('#mapchart').html('Unable to fetch snapshot ' + url);
            });
        function makeMapObject(frame){
            var frameDataCol = self.frameDataCol;
            var oMap = {
                map: 'us_aea_en',
                backgroundColor: 'rgb(179, 224, 255)',
                zoomAnimate: false,
                zoomOnScrollSpeed: 1,
                zoomOnScroll: true,
                zoomStep: 2,
                regionStyle: {
                    initial: {
                        fill: 'rgb(207, 226, 207)',
                        stroke: 'black',
                        "stroke-width": 0.5
                    },
                    hover: {
                        cursor: 'default'
                    }
                },
                onRegionTipShow: function(e, oTip, code){
                    e.preventDefault();
                },
                onMarkerTipShow: function(e, oTip, index){
                    var factRow = frame.data[oMap.markers[index].i],
                        sicDivision = self.getSicDivision(factRow[self.frameDataCol.sic]);
                    oTip.html((sicDivision?'<div style="color:'+sicDivision.color+'">'+sicDivision.name+':</div>':'')
                        + factRow[frameDataCol.name] + ':<br>'
                        + self.numberFormatter(factRow[frameDataCol.value], frame.uom)
                        + (factRow[frameDataCol.versions]>1?'<br><i>Value is a revision from the entity\'s initial disclosure</i>':'')
                        + '<br><br><i>click marker to view source filing</i>'
                    );
                },
                onMarkerClick: function(e, index){
                    var factRow = frame.data[oMap.markers[index].i];
                    location.href = '/sec/viewer.php?doc=' + factRow[frameDataCol.cik]
                        +'/'+factRow[frameDataCol.adsh].replace(self.rgxAllDash,'')+'/'+ factRow[frameDataCol.adsh]
                        +'-index&u='+frame.uom+'&q='+frame.qtrs+'&d='+frame.ddate
                        +'&t='+frame.tag;
                },
                markers: [],
                markerStyle: {
                    initial: {
                        fill: '#F8E23B',
                        stroke: '#383f47'
                    }
                }
            };
            var min = null, max = null, i, inFilter;
            for(i=0; i<frame.data.length; i++){ //find min and max values for scaling
                if(frame.data[i][frameDataCol.countryRegion].substr(0,2)=='US' && !isNaN(frame.data[i][frameDataCol.value])){
                    if(!isNaN(min)){
                        if(min>frame.data[i][frameDataCol.value]) min=frame.data[i][frameDataCol.value];
                        if(max<frame.data[i][frameDataCol.value]) max=frame.data[i][frameDataCol.value];
                    } else {
                        min = max = frame.data[i][frameDataCol.value];
                    }
                }
            }
            frame.data.sort(function(a,b){return b[frameDataCol.value]-a[frameDataCol.value]}); //smaller bubbles on top
            var R_MAX = 25, category, r, stokeColor;
            for(i=0; i<frame.data.length; i++){
                if(frame.data[i][frameDataCol.latLng]){
                    switch(oVars.sicFilter || 'all'){
                        case "all":
                            inFilter = true;
                            break;
                        case "div":
                            inFilter = (frame.data[i][frameDataCol.sic] >=oVars.sicDivision.min
                                && frame.data[i][frameDataCol.sic]<=oVars.sicDivision.max);
                            break;
                        case "ind":
                            inFilter = (oVars.sic == frame.data[i][frameDataCol.sic]);
                            break;
                        default:
                            console.log('filter error in makeMapObject');
                    }
                    if(inFilter){
                        r = Math.sqrt(Math.abs(frame.data[i][frameDataCol.value]))/Math.abs(Math.sqrt(max))*R_MAX+1;
                        stokeColor = frame.data[i][frameDataCol.value]>0?'black':'red';
                        category = self.getSicDivision( frame.data[i][frameDataCol.sic]);
                        oMap.markers.push({
                            latLng: frame.data[i][frameDataCol.latLng],
                            i: i,
                            name:  frame.data[i][frameDataCol.name],
                            value:  frame.data[i][frameDataCol.value],
                            style:{
                                r: r,
                                fill: frame.data[i][frameDataCol.cik]==oVars.cik?self.hcColors[0]:(category?category.color:'grey'),
                                stroke: stokeColor
                            }
                        });
                    }
                }
            }
            return oMap;
        }
    },
    parseTsPoint: function(tsPoint){
        var parsedPoint = {
            date: tsPoint[0],
            y: tsPoint[1],
            adsh: tsPoint[2],
            rptPeriod: tsPoint[3],
            rptForm: tsPoint[4],
            coName: tsPoint[5]
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
        var cached = this.secDataCache['https://restapi.publicdata.guru/sec/timeseries/' + params.tag + '/cik' + params.cik];
        if(cached){
            var tsObject = cached[params.tag]['cik'+params.cik];
            if(tsObject['units'][params.uom] && tsObject['units'][params.uom][ixbrlViewer.durationPrefix+params.qtrs]){
                var data = tsObject['units'][params.uom][ixbrlViewer.durationPrefix+params.qtrs],
                pt, lastDate = false, playerIndex = [], homeIndex=0;
                for(var i=0; i<data.length; i++){
                pt = this.parseTsPoint(data[i]);
                    if(lastDate!=pt.date){
                        playerIndex.push(pt.date);
                        lastDate = pt.date;
                    }
                    if(pt.date == params.ddate) homeIndex = playerIndex.length-1;
                }
                return {dateIndex: playerIndex, homeIndex: homeIndex}
            }
        }
    },
    makeXAxisSelector: function(yTag, uom, qtrs){
        var htmlOptions = '',
            branch = this.standardTagTree[ixbrlViewer.durationPrefix+qtrs][uom];
        if(branch){
            branch.sort();
            for(var i=0;i<branch.length;i++){
                if(yTag != branch[i]) htmlOptions += '<option value="'+branch[i]+'">'+branch[i]+ '</option>';
            }
        }
        if(htmlOptions){
            return '<select id="scatter-x-axis-select"><option init="instructions" selected="selected">select a frame for the X-Axis</option>' + htmlOptions + '</select>'
        } else {
            return false;
        }
    },

    fetchTimeSeriesToCache: function(oVars, callBack){
        //1. get the full list of urls to fetch from saved series and companies
        var self = this,
            clickedUrl = 'https://restapi.publicdata.guru/sec/timeseries/' + oVars.tag + '/cik' + oVars.cik,
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
                    + '/cik' + savedTimeSeries[i][fldTS.cik];
                if(url != clickedUrl){
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
                    + '/cik' + savedCompanies[i][fldSC.cik];
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
            if(success) success(ixbrlViewer.secDataCache[url]);
        } else {
            var dbUrl = false;
            if(window.location.href.indexOf('maker.publicdata')!=-1){ //use database for maker.publicdata.guru
                var uParts = url.split('/');  //e.g. 'https://restapi.publicdata.guru/sec/frames/'+oVars.tag+'/'+oVars.uom+'/DQ'+oVars.qtrs +'/'+this.cdate(oVars.ddate, oVars.qtrs),
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
                    if(success) success(data);
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

    navigateToTag: function($navigateToTag){
        if($navigateToTag){
            $('html,body').animate({
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

    cdate: function(ddate, duration){  //frames are
        var closestEndMonth = new Date(ddate);
        return closestEndMonth.getUTCFullYear() + (duration==4?'':'C' + (Math.floor(closestEndMonth.getUTCMonth()/3)+1));
    },

//global vars
    htmlTemplates: {
        popWindow:
            '<div id="popviz" style="width:80%;">' +
            '<button id="compare">compare</button><button id="save">save</button><span id="saved"></span>' +
            '<ul>' +
            '  <li><a href="#tabs-ts">time series</a></li>' +
            '  <li><a href="#tabs-map"><span class="strikethrough">US map</span></a></li>' +
            '  <li><a href="#tabs-scatter"><span class="strikethrough">scatter plot</span></a></li>' +
            '  <li><a href="#tabs-frame">all reporting companies</a></li>' +
            '</ul>' +
            '<div id="tabs-ts"><div id="tschart">loading... please wait</div><div id="tscontrols"></div></div>' +
            '<div id="tabs-map"><div id="maptitle"></div><div id="mapchart">loading... please wait</div><div id="mapcontrols"></div><div id="mapdatalinks"></div></div>' +
            '<div id="tabs-scatter"><div id="scatterchart">loading... please wait</div><div id="scattercontrols"></div></div>' +
            '<div id="tabs-frame"><div class="framecontrols">loading... please wait</div><table id="frame-table"></table></div>' +
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
        linLogToggle: '<div id="linlog">' +
            '<label for="scatterLinear">linear</label>' +
            '<input type="radio" name="scatterAxesType" id="scatterLinear" value="linear" checked="checked">' +
            '<label for="scatterLogarithmic">logarithmic</label>' +
            '<input type="radio" name="scatterAxesType" id="scatterLogarithmic" value="logarithmic">' +
            '</div>',
        toolTip: '<div class="tagDialog"><div class="tagDialogText">say something</div></div>',
        playerControls: '<fieldset class="player_controls">' +
            '<legend>date controls:</legend>' +
              '<div class="player_controls">' +
                '<button class="player_home" title="return to initial date"></button>' +
                '<div class="slider_outer"><div id="sliderTip"></div><div class="player_slider"></div></div>' +
                '<button class="player_play" title="play entire sequence"></button>' +
              '</div>' +
            '</fieldset>'
    },
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
    frameDataCol: {
        name: 0,
        cik: 1,
        sic: 2,
        adsh: 3,
        countryRegion: 4,
        latLng: 5,
        ddate: 6,
        value: 7,
        versions: 8
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
    standardTagTree: {}, //filled on doc ready to provide denominator choices in scatter plot
    contextTree: {}, //filled on doc ready to provide period (duration) lookup
    unitTree: {} //filled on doc ready to provide units lookup
};

$(document).ready(function() {
    //put any querystring parameters into an object for easy access
    var aParams = location.search.substr(1).split('&'),
        oQSParams = {}, tuplet, i;
    for(i=0;i<aParams.length;i++){
        tuplet = aParams[i].split('=');
        oQSParams[tuplet[0]] = tuplet[1];
    }

    //fix images source links
    $('img').each(function(){
        $(this).attr('src', 'https://www.sec.gov/Archives/edgar/data/'+ixbrlViewer.cik+'/'+ixbrlViewer.adsh+'/' + $(this).attr('src'));
    });

    //calculate the fiscal to calendar relationship and set document reporting period, fy, adsh and cik
    var $reportingPeriod = $('ix\\:nonnumeric[name="dei\\:DocumentPeriodEndDate"]'),
        contextref = $reportingPeriod.attr('contextref'),
        ddate = new Date($reportingPeriod.text()),
        fy = parseInt(contextref.substr(2,4)),
        fq = parseInt(contextref.substr(7,1)),
        fdate = new Date(fy, fq*3, 0);
    ixbrlViewer.deltaMonth = (fy-ddate.getFullYear())*12 + (fdate.getMonth()-ddate.getMonth());
    ixbrlViewer.reportForm = $('ix\\:nonnumeric[name="dei\\:DocumentType"]').text();
    ixbrlViewer.reportPeriod = fy + (fq==4?' FY':' Q'+fq);
    var docPart = window.location.href.split('?doc=')[1].split('/');
    ixbrlViewer.cik = docPart[0];
    ixbrlViewer.adsh = docPart[1];



    //get iXBRL context tags make lookup tree for contextRef date values and dimensions
    var $context, start, end, ddate, $this, $start, $member;
    $('xbrli\\:context').each(function(i) {
        $this = $(this);
        $start = $this.find('xbrli\\:startdate');
        if($start.length==1) {
            start = new Date($start.html().trim());
            ddate = $this.find('xbrli\\:enddate').html().trim();
            end = new Date(ddate);
            ixbrlViewer.contextTree[$this.attr('id')] = {
                ddate: ddate,
                qtrs: ((end.getFullYear() - start.getFullYear())*12 + (end.getMonth() - start.getMonth())) / 3
            }
        } else {
            ddate = $this.find('xbrli\\:instant').html();
            ixbrlViewer.contextTree[$this.attr('id')] = {
                ddate: ddate,
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
    $('xbrli\\:unit').each(function(i) {
        $this = $(this);
        $measure = $this.find('xbrli\\:unitnumerator xbrli\\:measure');
        if($measure.length==0) $measure = $this.find('xbrli\\:measure');
        if($measure.length==1){
            unitParts = $measure.html().split(':');
            ixbrlViewer.unitTree[$this.attr('id')] = unitParts.length>1?unitParts[1]:unitParts[0];
        } else console.log('error parsing iXBRL unit tag:', this);
    });

    var $standardTag, navigateToTag = false;
    $('ix\\:nonfraction').each(function(i){
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
                    && xbrl.ddate == oQSParams.d
                    && xbrl.qtrs == oQSParams.q) {
                    navigateToTag = $standardTag;
                }
            }
        } else {
            $(this).addClass("ixbrlViewer_customTaxonomy");
        }
    });
    $('ix\\:nonfraction').click(function(){
        var xbrl = ixbrlViewer.extractXbrlInfo(this);
        ixbrlViewer.vars = xbrl;
        if(xbrl.isStandard){
            if(xbrl.dim){
                $(ixbrlViewer.htmlTemplates.toolTip)
                    .find('.tagDialogText').html('This fact is defined as using the ' +xbrl.taxonomy
                    + ' standard taxonomy and further divided along the ' + xbrl.dim + 'dimension.<br><br>'
                    + 'Only facts using standard taxonomy with no sub-dimension are organized into the time series API.')
                    .dialog({position: { my: "center top", at: "center bottom", of: this}});
            } else {
                if(xbrl.qtrs ==0 || xbrl.qtrs ==1 || xbrl.qtrs ==4){
                    ixbrlViewer.openPopupVisualization(xbrl);
                } else {
                    $(ixbrlViewer.htmlTemplates.toolTip)
                        .find('.tagDialogText').html('This fact is defined as using the ' +xbrl.taxonomy
                        + ' standard taxonomy and covers ' + xbrl.qtrs
                        + ' quarters by the filer.<br><br>Only facts of annual (quarters = 4), quarterly (quarters = 1), and '
                        + ' as-on reporting date (quarters = 0) durations are organized into time series.')
                        .dialog({modal: true, position: { my: "center top", at: "center bottom", of: this}});
                }
            }
        } else {
            $(ixbrlViewer.htmlTemplates.toolTip)
                .find('.tagDialogText').html('This fact uses a custom taxonomy <b>'+xbrl.taxonomy + '</b>.'
                + '<br><br>Only standard taxonomies can be reliably compared and are organized into time series.')
                .dialog({modal: true, position: { my: "center top", at: "center bottom", of: this}});
        }
    });
    ixbrlViewer.navigateToTag(navigateToTag);

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
        if(hash.y && hash.d && hash.u && (hash.q || hash.q === '0')){
            ixbrlViewer.vars = { //taxonomy, isGaap and value not set
                tag: hash.y,
                xTag: hash.x,
                ddate: hash.d,
                uom: hash.u,
                qtrs: hash.q,
                isStandard: true,
                cik: ixbrlViewer.cik,
                num_adsh: ixbrlViewer.adsh
            };
            ixbrlViewer.openPopupVisualization(
                ixbrlViewer.vars,
                function(){ //callback after barChart is loaded
                    if(hash.x) $('a[href="#tabs-scatter"]').click(); //trigger scatter chart load
                    if(hash.c=='m') $('a[href="#tabs-map"]').click(); //trigger map load
                    if(hash.c=='f') $('a[href="#tabs-frame"]').click(); //trigger map load
                });
        }
    }
});

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

