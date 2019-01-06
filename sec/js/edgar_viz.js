"use strict";

/**
 * Created by Mark Elbert on 9/21/2018.
 * creates and displays the SQL to create the tables for SUB, TAG, NUM and PRE ingestion
 */
var sicCats = [
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
];

var secDataCache = {};  //used to keep local copy of data to avoid repeat fetches

function getSector(sic){
    for(var i=0;i<sicCats.length;i++){
        if(sic>=sicCats[i].min && sic<=sicCats[i].max)  return sicCats[i];
    }
}

var cik, standardTag, ddate, uom, qtrs;
$(document).ready(function(){
    $('button.chart').click(function(){
        var vars = getVars();
        showBarChart(vars);
    });
    $('button.scatter').click(function(){
        var vars = getVars();
        showScatterPlot(vars);
    });
    $('button.map').click(function(){
        var vars = getVars();
        showMap(vars);
    });

});

function getVars(){
    return {
        cik: $('.cik').val(),
        standardTag: $('.tag').val(),
        ddate: $('.ddate').val(),
        uom: $('.uom').val(),
        qtrs: $('.qtrs').val(),
        standardTagX: $('.xTag').val()
    };
}

function showBarChart(oVars){
    //get time series data via REST API (S3 bucket)
    var url = 'http://restapi.publicdata.guru/sec/timeseries/'+oVars.standardTag+'/cik'+oVars.cik+'/'+oVars.uom+'/'+oVars.qtrs;
    getRestfulData(url, function(timeseries){
        var oChart = makeTimeSeriesChartObject(timeseries, oVars);
        oChart.chart.renderTo = $('#popviz')[0];
        Window.barChart = new Highcharts.Chart(oChart);
    });
}

function showScatterPlot(oVars){
    //get data for both facts via REST API (S3 bucket)
    var fetchedFactCount = 0, //used to make sure both parallel fetches complete before building chart
        xFact,
        yFact,
        xUrl = 'http://restapi.publicdata.guru/sec/facts/'+oVars.standardTagX+'/'+oVars.uom+'/'+oVars.qtrs+'/'+oVars.ddate,
        yUrl = 'http://restapi.publicdata.guru/sec/facts/'+oVars.standardTag+'/'+oVars.uom+'/'+oVars.qtrs+'/'+oVars.ddate;

    getRestfulData(xUrl, function(fact){   //parallel fetch of x Axis data
        xFact = fact;
        fetchedFactCount++;
        if(fetchedFactCount==2) makeScatterPlot();
    });
    getRestfulData(yUrl, function(fact){   //parallel fetch of y Axis data
        yFact = fact;
        fetchedFactCount++;
        if(fetchedFactCount==2) makeScatterPlot();
    });

    function makeScatterPlot(){  //run when both parallel fetches completed
        var oChart = makeScatterChartObject(xFact, yFact, oVars);
        oChart.chart.renderTo = $('#popviz')[0];
        Window.barChart = new Highcharts.Chart(oChart);
    }


    var url = 'http://restapi.publicdata.guru/sec/timeseries/'+oVars.standardTag+'/cik'+oVars.cik+'/'+oVars.uom+'/'+oVars.qtrs;
    getRestfulData(url, function(timeseries){
        var oChart = makeScatterChartObject(timeseries, oVars);
        oChart.chart.renderTo = $('#popviz')[0];
        Window.barChart = new Highcharts.Chart(oChart);
    });
}

function showMap(oVars){
    //get fact data via REST API (S3 bucket)
    var url = 'http://restapi.publicdata.guru/sec/facts/'+oVars.standardTag+'/'+oVars.uom+'/'+oVars.qtrs+'/'+oVars.ddate;
    getRestfulData(url, function(fact){
        var oMap = {
            map: 'us_aea_en',
            markers: [],
            markerStyle: {
                initial: {
                    fill: '#F8E23B',
                    stroke: '#383f47'
                }
            }
        };
        var factDataCol = {
            adsh: 0,
            cik: 1,
            sic: 2,
            name: 3,
            country: 4,
            latLng: 5,
            value: 6,
            versions: 7
        };
        var min = null, max = null, i;
        for(i=0; i<fact.data.length; i++){ //find min and max values for scaling
            if(fact.data[i][factDataCol.country]=='US' && !isNaN(fact.data[i][factDataCol.value])){
                if(!isNaN(min)){
                    if(min>fact.data[i][factDataCol.value]) min=fact.data[i][factDataCol.value];
                    if(max<fact.data[i][factDataCol.value]) max=fact.data[i][factDataCol.value];
                } else {
                    min = max = fact.data[i][factDataCol.value];
                }
            }
        }
        fact.data.sort(function(a,b){return b[factDataCol.value]-a[factDataCol.value]}); //smaller bubbles on top
        var R_MAX = 25, sector;
        for(i=0; i<fact.data.length; i++){
            if(fact.data[i][factDataCol.latLng]){
                sector = getSector(fact.data[i][factDataCol.sic]);
                oMap.markers.push({
                    latLng: fact.data[i][factDataCol.latLng],
                    name:  fact.data[i][factDataCol.name],
                    value:  fact.data[i][factDataCol.value],
                    style:{
                        r: Math.sqrt(fact.data[i][factDataCol.value])/Math.sqrt(max)*R_MAX+1,
                        fill: sector.color
                    }
                });
            }
        }
        $('#popviz').height(500).width(1000).vectorMap(oMap);
    });
}

function makeScatterChartObject(xFact, yFact, callingParams){
    var ts = edgarTsData.data;
    var oChart = {
        chart: {
            type: 'scatter',
            zoomType: 'xy'
        },
        title: {
            text: xFact.tag + ' versus ' + yFact.tag + ' reported for '+ (xFact.qtrs==0?'':(xFact.qtrs==1?'quarter':'year')+ ' ending ') + xFact.ddate
        },
        subtitle: {
            text: ''
        },
        credits: {
            enabled: true
        },
        yAxis: {
            min: 0,
            title: {
                text: yFact.uom
            }
        },
        xAxis:{
            min: 0,
            title: {
                text: xFact.uom
            }
        },
        series: makeScatterSeries()
    };
    return oChart;
function makeScatterSeries(){

}
    //series format: [{data: [{ x: 95, y: 95, z: 13.8, name: 'BE', country: 'Belgium' },...]}, color:'blue',name'asdf']
}

function makeTimeSeriesChartObject(edgarTsData, callingParams){
    var ts = edgarTsData.data;
    var oChart = {
        chart: {
            type: 'column'
        },
        title: {
            text: edgarTsData.tlabel
        },
        subtitle: {
            text: edgarTsData.doc
        },
        credits: {
            enabled: true
        },
        yAxis: {
            min: 0,
            title: {
                text: edgarTsData.uom
            }
        },
        xAxis:{
            type: 'datetime'
        },
        series: makeChartSeries()
    };
    return oChart;
    function makeChartSeries(){
        var aSeries = [
                {
                    type: 'column',
                    name: edgarTsData.tlabel,
                    color: 'blue',
                    data: []
                },{
                    type: 'column',
                    name: edgarTsData.tlabel + ' (adjusted)',
                    color: 'yellow',
                    data: []
                }
            ],
            latestPoint = null,
            adjusted = false,
            point;

        for(var i=0; i<ts.length ;i++) {
            point = parseTsPoint(ts[i]);
            if(latestPoint) {
                if (latestPoint.date != point.date) {
                    addPoint(latestPoint);
                    latestPoint = point;
                    adjusted = false;
                } else {
                    if (latestPoint.value != point.value) adjusted = true;
                    if (latestPoint.ageRank < point.ageRank) latestPoint = point;
                }
            } else {
                latestPoint = point;
            }
        }

        addPoint(latestPoint || point);
        if(aSeries[1].data.length==0) aSeries.splice(1,1);
        if(aSeries[0].data.length==0) aSeries.splice(0,1);
        return aSeries;

        function addPoint(pt){
            var xDate = new Date(pt.date),
                hcDate = Date.UTC(xDate.getFullYear(), xDate.getMonth(), xDate.getDay());
            aSeries[adjusted?1:0].data.push({x: hcDate, y: pt.y});
        }
    }
}

function parseTsPoint(tsPoint){
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
}

function getRestfulData(url, success){
    console.log('fetching REST data');
    if(secDataCache[url]){
        console.log('data found in cache for ' + url);
        if(success) success(secDataCache[url]);
    } else {
        $.ajax({
            dataType: 'JSON',
            url: url,
            type: 'get',
            success: function (data, status) {
                console.log('successfully fetched ' + url);
                secDataCache[url] = data;
                if(success) success(data);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                console.log(textStatus);
                throw(errorThrown);
            }
        });
    }
}