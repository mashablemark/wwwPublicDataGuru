<!DOCTYPE html>
<html>
<head lang="en">
    <meta charset="UTF-8">
    <title>Edgar Viz Test Page</title>

    <!--CSS files-->
    <link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" type="text/css" />
    <link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/v/dt/jszip-2.5.0/dt-1.10.18/b-1.5.4/b-html5-1.5.4/sc-1.5.0/datatables.min.css"/>

    <!-- open source javascript libraries -->
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.36/pdfmake.min.js"></script>
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.36/vfs_fonts.js"></script>
    <script type="text/javascript" src="https://cdn.datatables.net/v/dt/jszip-2.5.0/dt-1.10.18/b-1.5.4/b-html5-1.5.4/sc-1.5.0/datatables.min.js"></script>
    <script type="text/javascript" src="/global/js/signals/signals.js"></script>
    <script type="text/javascript" src="/global/js/hasher/hasher.js"></script>
    <script type="text/javascript" src="js/ownership.js"></script>
</head>
<style>
    #filter {background-color: lightblue; padding: 5px; margin: 5px;}

    #acquireddisposedFilter, #cikFilterOuter {display: inline-block}
    #cikFilterOuter div {display: inline-block; margin-right: 30px }
    #codeFilter {max-width: 200px; height: 30px; margin: 0 10px;}
    #formFilter  {height: 30px; margin: 0 10px;}
    #startDateFilter {width: 100px; float: left}
    #endDateFilter {width: 100px; float: right}
    #reset {float: right}
    .custom-combobox {
        position: relative;
        display: inline-block;
    }
    .custom-combobox-toggle {
        position: absolute;
        top: 0;
        bottom: 0;
        margin-left: -1px;
        padding: 0;
    }
    .custom-combobox-input {
        margin: 0;
        padding: 5px 10px;
    }
    body {
        font: 90%/1.45em "Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif !important;
        margin: 0;
        padding: 0;
        color: #333;
        background-color: #fff;
        position: relative;
        padding-bottom: 220px !important;
        height: auto !important;
        min-height: 100%;
        box-sizing: border-box;
        -webkit-font-smoothing: inherit;
    }
    table.dataTable tbody tr:hover>.sorting_1, table.dataTable.order-column.hover tbody tr:hover>.sorting_1 {
        background-color: #eaeaea;
    }
    table.dataTable tbody tr>.sorting_1, table.dataTable.order-column tbody tr>.sorting_2, table.dataTable.order-column tbody tr>.sorting_3, table.dataTable.display tbody tr>.sorting_1, table.dataTable.display tbody tr>.sorting_2, table.dataTable.display tbody tr>.sorting_3 {
        background-color: #fafafa;
    }
    table.dataTable tbody tr:hover, table.dataTable.display tbody tr:hover {
        background-color: #f6f6f6;
    }
</style>
<body>

<h2 id="entity"></h2>


<div id="filter">
    <button id="reset" disabled="disabled">clear filter</button>
    <div id="cikFilterOuter">
        <span id="filterLabel">Reporter</span>: <div class="ui-widget">
        <select id="cikFilter"><option value="all"></option></select>
        </div>
    </div>

    <select id="codeFilter"><option value="all">all transaction codes</option></select>
    <div id="acquireddisposedFilter">
        <input type="radio" id="acquired"  value="A" name="acquireddisposed">
        <label for="acquired">acquired</label>

        <input type="radio" id="both"  value="all" name="acquireddisposed" checked="checked">
        <label for="both">both</label>

        <input type="radio" id="disposed" value="D" name="acquireddisposed">
        <label for="disposed">disposed</label>
    </div>
    <select id="formFilter"><option value="all">all forms</option></select>
    <div>
        <span id="startDateFilter"></span>
        <span id="endDateFilter"></span>
        <div id="dateSlider"></div>
    </div>
</div>
<table id="transactions">
</table>
</body>
