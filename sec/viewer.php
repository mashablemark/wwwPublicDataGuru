<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 10/26/2018
 * Time: 3:14 PM
 */
$doc = $_REQUEST["doc"];
if(strpos($doc,".htm")=== false  && strpos($doc,".xml")=== false && strpos($doc,".json")=== false) $doc = $doc.".htm";
$secPath = "https://www.sec.gov";
$edgarPath = $secPath . "/Archives/edgar/data/";

$docIXBRL = false;
$remoteLocalPath = $edgarPath . substr($doc, 0, strrpos($doc,'/' )) ;
if((isset($_REQUEST["f"]) && $_REQUEST["f"])){ //f=force get and return (don't think!)
    echo repointHyperlinks(httpGet($edgarPath.$doc));
} elseif(strpos($doc, "-index")){
    if(isset($_REQUEST["t"])){
        //ADSH index page and t (tag) is is set => get index and check if for iXBRL doc and that in viewer if found
        $body = httpGet($edgarPath.$doc);
        $sIxSig = "/ix?doc=/Archives/edgar/data/";
        $ixPos = strpos($body, $sIxSig);
        if($ixPos){
            //load the iXBRL document into the viewer and have ixbrl_viewer.js navigate to the fact
            $docIXBRL = $edgarPath . substr($body, $ixPos + strlen($sIxSig), strpos($body, '.htm', $ixPos) - $ixPos - strlen($sIxSig) + 4);
        } else {
            //no iXBRL document = show index page
            echo repointHyperlinks($body);
        }
    } else {
        echo repointHyperlinks(httpGet($edgarPath.$doc));
    }
} else {
    $docIXBRL = urlencode($edgarPath.$doc);
}
if($docIXBRL){
?><!DOCTYPE html>
<!-- Created by staff of the U.S. Securities and Exchange Commission.
Data and content created by government employees within the scope of their employment
are not subject to domestic copyright protection. 17 U.S.C. 105. -->
<html lang="en">
<head>
    <meta content="text/html; charset=UTF-8" http-equiv="content-type" />
    <meta id="viewport" name="viewport"
          content="user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, width=device-width, height=device-height" />
    <script type="text/javascript">
        window.onload = function() {
            var ie7 = navigator.appVersion.indexOf("MSIE 7");
            var ie8 = navigator.appVersion.indexOf("MSIE 8");
            if ((ie7 > 0) || (ie8 > 0)) {
                var note = 'The browser mode you are running is not compatible with this application.';
                browserName = 'Microsoft Internet Explorer';
                note += 'You are currently running ' + browserName + ' '
                    + ((ie7 > 0) ? 7 : 8) + '.0.';
                var userAgent = window.navigator.userAgent.toLowerCase();
                if (userAgent.indexOf('ipad') != -1
                    || userAgent.indexOf('iphone') != -1
                    || userAgent.indexOf('apple') != -1) {
                    note += ' Please use a more current version of ' + browserName
                        + ' in order to use the application.';
                } else if (userAgent.indexOf('android') != -1) {
                    note += ' Please use a more current version of Google Chrome or Mozilla Firefox in order to use the application.';
                } else {
                    note += ' Please use a more current version of Microsoft Internet Explorer, Google Chrome or Mozilla Firefox in order to use the application.';
                }
                alert(note);
                document.getElementById('browser-compatibility').innerHTML = note;
                return;
            }
        };
    </script>
    <style>
        .otherFinancialStatementsSection {
            display: inline-block;
        }
    </style>

    <link  rel="stylesheet" href="global/js/jquery-ui/jquery-ui.css" />
    <link rel="stylesheet" href="global/js/fancybox-master/dist/jquery.fancybox.min.css" type="text/css">
    <link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/v/dt/jszip-2.5.0/dt-1.10.18/b-1.5.4/b-html5-1.5.4/sc-1.5.0/datatables.min.css"/>
    <link rel="stylesheet" href="css/viewer.css" type="text/css">
    <link rel="stylesheet" href="https://www.sec.gov/ixviewer/js/lib/bootstrap.min.css" type="text/css">
    <link rel="stylesheet" href="https://www.sec.gov/ixviewer/js/css/app.css" type="text/css">
    <link rel="stylesheet" href="https://www.sec.gov/ixviewer/css/icon-as-img.css" type="text/css">
    <script type="text/javascript" src="global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="global/js/highcharts/js/highcharts.js"></script>
    <script type="text/javascript" src="global/js/highcharts/js/modules/exporting.js"></script>
    <script type="text/javascript" src="global/js/fancybox-master/dist/jquery.fancybox.min.js"></script>
    <script type="text/javascript" src="global/js/jquery-ui/jquery-ui.min.js"></script>
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.36/pdfmake.min.js"></script>
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.36/vfs_fonts.js"></script>
    <script type="text/javascript" src="https://cdn.datatables.net/v/dt/jszip-2.5.0/dt-1.10.18/b-1.5.4/b-html5-1.5.4/sc-1.5.0/datatables.min.js"></script>
    <script type="text/javascript" src="global/js/signals/signals.js"></script>
    <script type="text/javascript" src="global/js/hasher/hasher.min.js"></script>
    <script type="text/javascript" src="js/ixbrl_viewer.js"></script>

    <title>Inline XBRL Viewer</title>
</head>
<body id="sec-body">

<nav class="navbar navbar-expand-md navbar-dark navbar-height bg-sec fixed-top w-100 pl-0">
    <button
            class="navbar-toggler ml-1"
            type="button"
            data-test=""
            data-toggle="collapse"
            data-target="#main-navbar"
            aria-controls="main-navbar"
            aria-expanded="false"
            aria-label="Toggle navigation">Inline Viewer</button>
    <div
            class="navbar-height collapse navbar-collapse bg-sec w-100"
            data-test="main-navbar"
            id="main-navbar">
        <ul class="navbar-nav mr-auto bg-inherit">
            <li class="nav-item dropdown my-auto ml-1">
                <a
                        id="menu-dropdown-link"
                        data-test="menu-dropdown-link"
                        class="nav-link dropdown-toggle click disabled"
                        role="button"
                        onclick="FormInformation.init(event, this);"
                        onkeyup="FormInformation.init(event, this);"
                        data-toggle="dropdown"
                        aria-haspopup="true"
                        aria-expanded="false"
                        tabindex="1"
                        accesskey="1">
                    <i class="nav-loading fas fa-bars"></i>
                    <span class="d-md-none d-lg-inline">Menu</span>
                    <span class="sr-only sr-only-focusable">Menu</span>
                </a>
                <div class="dropdown-menu">
                    <a
                            id="menu-dropdown-information"
                            data-test="menu-dropdown-information"
                            class="dropdown-item click"
                            onclick="ModalsFormInformation.clickEvent(event, this)"
                            onkeyup="ModalsFormInformation.clickEvent(event, this)"
                            tabindex="1">Information</a>
                    <a
                            id="form-information-instance"
                            data-test="form-information-instance"
                            class="dropdown-item click"
                            target="_blank"
                            tabindex="1">Save XBRL Instance</a>
                    <a
                            id="form-information-zip"
                            data-test="form-information-zip"
                            class="dropdown-item click"
                            target="_blank"
                            tabindex="1">Save XBRL Zip File</a>
                    <a
                            id="form-information-html"
                            data-test="form-information-html"
                            class="dropdown-item click"
                            target="_blank"
                            tabindex="1">Open as HTML</a>
                    <a
                            id="menu-dropdown-settings"
                            data-test="menu-dropdown-settings"
                            class="dropdown-item click"
                            onclick="ModalsSettings.clickEvent(event, this);"
                            onkeyup="ModalsSettings.clickEvent(event, this);"
                            tabindex="1">Settings</a>
                    <a
                            id="form-information-help"
                            data-test="form-information-help"
                            class="dropdown-item click"
                            onclick="Help.toggle(event, this)"
                            onkeyup="Help.toggle(event, this)"
                            tabindex="1">Help</a>
                    <span
                            id="form-information-version"
                            class="dropdown-item-text"
                            tabindex="1"></span>
                </div>
            </li>
            <li class="nav-item my-auto ml-1">
                <a
                        id="sections-dropdown-link"
                        data-test="sections-dropdown-link"
                        class="nav-link click disabled meta-required"
                        onclick="Sections.toggle(event, this);"
                        onkeyup="Sections.toggle(event, this);"
                        tabindex="2"
                        accesskey="2">
                    <i class="fas fa-layer-group"></i>
                    <span class="d-md-none d-lg-inline">Sections</span>
                    <span class="sr-only sr-only-focusable">Sections</span>
                </a>
            </li>
            <li class="nav-item my-auto ml-1 mr-1">
                <form
                        id="global-search-form"
                        data-test="global-search-form"
                        onsubmit="Search.submit(event, this); return false;"
                        class="my-2 my-lg-0 input-group disabled"
                        novalidate>
                    <div class="input-group-prepend">
                        <button
                                data-name="global-search-options"
                                class="dropdown btn btn-outline-light disabled"
                                type="button"
                                data-toggle="dropdown"
                                tabindex="3">
                            <i class="nav-loading fas fa-cog">
                                <span class="sr-only sr-only-focusable">Additional Search Options</span>
                            </i>
                        </button>
                        <div class="dropdown-menu px-2">
                            <div class="form-check">
                                <input
                                        disabled
                                        class="form-check-input meta-required"
                                        type="checkbox"
                                        name="search-options"
                                        value="1"
                                        checked
                                        disabled
                                        tabindex="3">
                                <label class="form-check-label">
                                    <span>Include Fact Name</span>
                                </label>
                            </div>
                            <div class="form-check">
                                <input
                                        disabled
                                        class="form-check-input meta-required"
                                        type="checkbox"
                                        name="search-options"
                                        value="2"
                                        checked
                                        disabled
                                        tabindex="3">
                                <label class="form-check-label">
                                    <span>Include Fact Content</span>
                                </label>
                            </div>
                            <div class="form-check">
                                <input
                                        disabled
                                        class="form-check-input meta-required"
                                        type="checkbox"
                                        name="search-options"
                                        value="3"
                                        checked
                                        disabled
                                        tabindex="3">
                                <label class="form-check-label">
                                    <span>Include Labels</span>
                                </label>
                            </div>
                            <div class="form-check">
                                <input
                                        class="form-check-input meta-required"
                                        type="checkbox"
                                        name="search-options"
                                        value="4"
                                        disabled
                                        tabindex="3">
                                <label class="form-check-label">
                                    <span>Include Definitions</span>
                                </label>
                            </div>
                            <div class="form-check">
                                <input
                                        class="form-check-input meta-required"
                                        type="checkbox"
                                        name="search-options"
                                        value="5"
                                        disabled
                                        tabindex="3">
                                <label class="form-check-label">
                                    <span>Include Dimensions</span>
                                </label>
                            </div>
                            <div class="bg-light border p-1">
                                <span class="dropdown-item-text">Reference Options</span>
                                <div class="form-check">
                                    <input
                                            class="form-check-input meta-required"
                                            type="checkbox"
                                            name="search-options"
                                            value="6"
                                            disabled
                                            tabindex="3">
                                    <label class="form-check-label">
                                        <span>Include Topic</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input
                                            class="form-check-input meta-required"
                                            type="checkbox"
                                            name="search-options"
                                            value="7"
                                            disabled
                                            tabindex="3">
                                    <label class="form-check-label">
                                        <span>Include Sub-Topic</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input
                                            class="form-check-input meta-required"
                                            type="checkbox"
                                            name="search-options"
                                            value="8"
                                            disabled
                                            tabindex="3">
                                    <label class="form-check-label">
                                        <span>Include Paragraph</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input
                                            class="form-check-input meta-required"
                                            type="checkbox"
                                            name="search-options"
                                            value="9"
                                            disabled
                                            tabindex="3">
                                    <label class="form-check-label">
                                        <span>Include Publisher</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input
                                            class="form-check-input meta-required"
                                            type="checkbox"
                                            name="search-options"
                                            value="10"
                                            disabled
                                            tabindex="3">
                                    <label class="form-check-label">
                                        <span>Include Section</span>
                                    </label>
                                </div>
                            </div>
                            <div class="form-check">
                                <input
                                        class="form-check-input"
                                        type="checkbox"
                                        name="search-options"
                                        value="11"
                                        tabindex="3">
                                <label class="form-check-label">
                                    <span>Match Case</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <input
                            type="text"
                            class="form-control disabled"
                            id="global-search"
                            data-test="global-search"
                            placeholder="Search Facts"
                            disabled
                            aria-label="Search all Facts and highlight them accordingly."
                            tabindex="4">
                    <div class="input-group-append">
                        <button
                                data-name="global-search-clear"
                                onclick="Search.clear(event, this);"
                                class="btn btn-outline-light disabled"
                                type="button"
                                tabindex="5">
                            <i class="nav-loading fas fa-times-circle"></i>
                            <span class="sr-only sr-only-focusable">Clear Search</span>
                        </button>
                        <button
                                class="btn btn-outline-light disabled"
                                type="submit"
                                tabindex="6">
                            <i class="nav-loading fas fa-search"></i>
                            <span class="sr-only sr-only-focusable">Submit Search</span>
                        </button>
                    </div>
                </form>
            </li>
            <li class="nav-item dropdown my-auto ml-1">
                <a
                        href="#"
                        id="nav-filter-data"
                        data-test="nav-filter-data"
                        class="nav-link dropdown-toggle disabled click"
                        role="button"
                        data-toggle="dropdown"
                        aria-haspopup="true"
                        aria-expanded="false"
                        tabindex="7"
                        accesskey="3">
                    <i class="nav-loading fas fa-list-alt"></i>
                    <span class="d-md-none d-lg-inline">Data</span>
                    <span class="sr-only sr-only-focusable">Data</span>
                </a>
                <div class="dropdown-menu">
                    <form
                            data-name="data-dropdown"
                            onchange="UserFiltersDataRadios.clickEvent(event, this)"
                            class="px-2">
                        <div class="form-check">
                            <input
                                    class="form-check-input"
                                    type="radio"
                                    name="data-radios"
                                    value="0"
                                    checked
                                    tabindex="7">
                            <label class="form-check-label">All</label>
                        </div>
                        <div class="form-check">
                            <input
                                    class="form-check-input"
                                    type="radio"
                                    name="data-radios"
                                    value="1"
                                    tabindex="7">
                            <label class="form-check-label">
                                <i
                                        title="The first time choosing this will take a few moments."
                                        class="far fa-clock d-none performance-concern"></i>
                                <span>Amounts Only</span>
                            </label>
                        </div>
                        <div class="form-check">
                            <input
                                    class="form-check-input"
                                    type="radio"
                                    name="data-radios"
                                    value="2"
                                    tabindex="7">
                            <label class="form-check-label">
                                <i
                                        title="The first time choosing this will take a few moments."
                                        class="far fa-clock d-none performance-concern"></i>
                                <span>Text Only</span>
                            </label>
                        </div>
                        <div class="form-check">
                            <input
                                    class="form-check-input meta-required"
                                    type="radio"
                                    name="data-radios"
                                    value="3"
                                    disabled
                                    tabindex="7">
                            <label class="form-check-label">
                                <i
                                        title="The first time choosing this will take a few moments."
                                        class="far fa-clock d-none performance-concern"></i>
                                <span>Calculations Only</span>
                            </label>
                        </div>
                        <div class="form-check">
                            <input
                                    class="form-check-input"
                                    type="radio"
                                    name="data-radios"
                                    value="4"
                                    tabindex="7">
                            <label class="form-check-label">
                                <i
                                        title="The first time choosing this will take a few moments."
                                        class="far fa-clock d-none performance-concern"></i>
                                <span>Negatives Only</span>
                            </label>
                        </div>
                        <div class="form-check">
                            <input
                                    class="form-check-input"
                                    type="radio"
                                    name="data-radios"
                                    value="5"
                                    tabindex="7">
                            <label class="form-check-label">
                                <i
                                        title="The first time choosing this will take a few moments."
                                        class="far fa-clock d-none performance-concern"></i>
                                <span>Additional Items Only</span>
                            </label>
                        </div>
                    </form>
                </div>
            </li>
            <li class="nav-item dropdown my-auto ml-1">
                <a
                        href="#"
                        id="nav-filter-tags"
                        data-test="nav-filter-tags"
                        class="nav-link dropdown-toggle disabled click"
                        role="button"
                        data-toggle="dropdown"
                        aria-haspopup="true"
                        aria-expanded="false"
                        tabindex="8"
                        accesskey="4">
                    <i class="nav-loading fas fa-tags"></i>
                    <span class="d-md-none d-lg-inline">Tags</span>
                    <span class="sr-only sr-only-focusable">Tags</span>
                </a>
                <div class="dropdown-menu">
                    <form
                            data-name="tags-dropdown"
                            onchange="UserFiltersTagsRadios.clickEvent(event, this)"
                            class="px-2">
                        <div class="form-check">
                            <input
                                    class="form-check-input"
                                    type="radio"
                                    name="tags-radios"
                                    value="0"
                                    checked
                                    tabindex="8">
                            <label class="form-check-label">All</label>
                        </div>
                        <div class="form-check">
                            <input
                                    class="form-check-input"
                                    type="radio"
                                    name="tags-radios"
                                    value="1"
                                    tabindex="8">
                            <label class="form-check-label">
                                <i
                                        title="The first time choosing this will take a few moments."
                                        class="far fa-clock d-none performance-concern"></i>
                                <span>Standard Only</span>
                            </label>
                        </div>
                        <div class="form-check">
                            <input
                                    class="form-check-input meta-required"
                                    type="radio"
                                    name="tags-radios"
                                    value="2"
                                    disabled
                                    tabindex="8">
                            <label class="form-check-label">
                                <i
                                        title="Facts whose tags are outside the realm of DEI, US-GAAP, etc."
                                        class="far fa-question-circle"></i>
                                <i
                                        title="The first time choosing this will take a few moments."
                                        class="far fa-clock d-none performance-concern"></i>
                                <span>Custom Only</span>
                            </label>
                        </div>
                    </form>
                </div>
            </li>
            <li class="nav-item dropdown my-auto ml-1">
                <div class="otherFinancialStatementsSection">
                    <select id="fs-select"></select>
                    <button id="fs-redline" disabled="disabled">compare</button>
                    <button id="fs-go" disabled="disabled">view</button>
                    <span id="amendmentMessage"></span>
                </div>
                <div class="dropdown-menu dropdown-menu-width">
                    <label class="dropdown-item-text d-none performance-concern"> Selecting any of
                        the below will take a few moments.</label>
                    <div
                            class="accordion"
                            id="more-filters-accordion">
                        <form data-test="more-filters-form">
                            <div class="mx-1">
                                <div class=" px-0 py-0">
                                    <a
                                            href="#"
                                            data-test="Period"
                                            data-target="#user-filters-periods"
                                            data-toggle="collapse"
                                            class="d-flex justify-content-between align-items-center w-100 click text-primary"
                                            tabindex="9">
                                        <span>Periods</span>
                                        <span
                                                data-test="Period-count"
                                                id="filters-periods-count"
                                                class="badge badge-secondary">
                        <i class="fas fa-spinner fa-spin"></i>
                      </span>
                                    </a>
                                </div>
                                <div
                                        id="user-filters-periods"
                                        class="collapse height-200 overflow-y-auto"
                                        data-parent="#more-filters-accordion">
                                    <!-- Below is populated dynamically VIA JS -->
                                    <div class="list-group list-group-flush"></div>
                                </div>
                            </div>
                        </form>
                        <form>
                            <div class="mx-1">
                                <div class=" px-0 py-0">
                                    <a
                                            href="#"
                                            data-test="Measures"
                                            data-target="#user-filters-measures"
                                            data-toggle="collapse"
                                            class="d-flex justify-content-between align-items-center w-100 click text-primary"
                                            tabindex="9">
                                        <span>Measures</span>
                                        <span
                                                data-test="Measures-count"
                                                id="filters-measures-count"
                                                class="badge badge-secondary">
                        <i class="fas fa-spinner fa-spin"></i>
                      </span>
                                    </a>
                                </div>
                                <div
                                        id="user-filters-measures"
                                        class="collapse height-200 overflow-y-auto"
                                        data-parent="#more-filters-accordion">
                                    <!-- Below is populated dynamically VIA JS -->
                                    <div class="list-group list-group-flush"></div>
                                </div>
                            </div>
                        </form>
                        <form>
                            <div class="mx-1">
                                <div class=" px-0 py-0">
                                    <a
                                            href="#"
                                            data-test="Axis"
                                            data-target="#user-filters-axis"
                                            data-toggle="collapse"
                                            class="d-flex justify-content-between align-items-center w-100 click text-primary"
                                            tabindex="9">
                                        <span>Axis</span>
                                        <span
                                                data-test="Axis-count"
                                                id="filters-axis-count"
                                                class="badge badge-secondary">
                        <i class="fas fa-spinner fa-spin"></i>
                      </span>
                                    </a>
                                </div>
                                <div
                                        id="user-filters-axis"
                                        class="collapse height-200 overflow-y-auto"
                                        data-parent="#more-filters-accordion">
                                    <!-- Below is populated dynamically VIA JS -->
                                    <div class="list-group list-group-flush"></div>
                                </div>
                            </div>
                        </form>
                        <form>
                            <div class="mx-1">
                                <div class=" px-0 py-0">
                                    <a
                                            href="#"
                                            data-test="Members"
                                            data-target="#user-filters-members"
                                            data-toggle="collapse"
                                            class="d-flex justify-content-between align-items-center w-100 click text-primary"
                                            tabindex="9">
                                        <span>Members</span>
                                        <span
                                                data-test="Members-count"
                                                id="filters-members-count"
                                                class="badge badge-secondary">
                        <i class="fas fa-spinner fa-spin"></i>
                      </span>
                                    </a>
                                </div>
                                <div
                                        id="user-filters-members"
                                        class="collapse height-200 overflow-y-auto"
                                        data-parent="#more-filters-accordion">
                                    <!-- Below is populated dynamically VIA JS -->
                                    <div class="list-group list-group-flush"></div>
                                </div>
                            </div>
                        </form>
                        <form>
                            <div class="mx-1">
                                <div class=" px-0 py-0">
                                    <a
                                            href="#"
                                            data-test="Scale"
                                            data-target="#user-filters-scales"
                                            data-toggle="collapse"
                                            class="d-flex justify-content-between align-items-center w-100 click text-primary"
                                            tabindex="9">
                                        <span>Scale</span>
                                        <span
                                                data-test="Scale-count"
                                                id="filters-scales-count"
                                                class="badge badge-secondary">
                        <i class="fas fa-spinner fa-spin"></i>
                      </span>
                                    </a>
                                </div>
                                <div
                                        id="user-filters-scales"
                                        class="collapse height-200 overflow-y-auto"
                                        data-parent="#more-filters-accordion">
                                    <!-- Below is populated dynamically VIA JS -->
                                    <div class="list-group list-group-flush"></div>
                                </div>
                            </div>
                        </form>
                        <form>
                            <div class="mx-1">
                                <div class=" px-0 py-0">
                                    <a
                                            href="#"
                                            data-test="Balance"
                                            data-target="#user-filters-balances"
                                            data-toggle="collapse"
                                            class="d-flex justify-content-between align-items-center w-100 click text-primary"
                                            tabindex="9">
                                        <span>Balance</span>
                                        <span
                                                data-test="Balance-count"
                                                id="filters-balances-count"
                                                class="badge badge-secondary">2</span>
                                    </a>
                                </div>
                                <div
                                        id="user-filters-balances"
                                        class="collapse height-200 overflow-y-auto"
                                        data-parent="#more-filters-accordion">
                                    <div class="d-flex justify-content-between align-items-center w-100 px-2">
                                        <div class="form-check">
                                            <input
                                                    onclick="UserFiltersMoreFiltersBalances.clickEvent(event, this, 0)"
                                                    title="Select/Deselect this option."
                                                    class="form-check-input"
                                                    type="checkbox"
                                                    tabindex="9">
                                            <label class="form-check-label">Debit</label>
                                        </div>
                                    </div>
                                    <div class="d-flex justify-content-between align-items-center w-100 px-2">
                                        <div class="form-check">
                                            <input
                                                    onclick="UserFiltersMoreFiltersBalances.clickEvent(event, this, 1)"
                                                    title="Select/Deselect this option."
                                                    class="form-check-input"
                                                    type="checkbox"
                                                    tabindex="9">
                                            <label class="form-check-label">Credit</label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </li>
            <li
                    id="current-filters-reset"
                    data-test="current-filters-reset"
                    class="nav-item d-none my-auto ml-1">
                <a
                        href="#"
                        data-name="current-filters-reset"
                        onclick="UserFiltersDropdown.resetAll();"
                        class="nav-link dropdown-toggle text-danger disabled click"
                        tabindex="11"
                        accesskey="7">
                    <i class="nav-loading fas fa-redo"></i>
                    <span class="d-md-none d-lg-inline">Reset All Filters</span>
                </a>
            </li>
            <li
                    id="links-dropdown"
                    data-test="links-dropdown"
                    class="nav-item dropdown d-none my-auto ml-1">
                <a
                        href="#"
                        id="additional-links-dropdown"
                        class="nav-link dropdown-toggle disabled click"
                        role="button"
                        data-toggle="dropdown"
                        aria-haspopup="true"
                        aria-expanded="false"
                        tabindex="12"
                        accesskey="8">
                    <i class="nav-loading fas fa-link"></i>
                    <span class="d-md-none d-lg-inline">Links</span>
                </a>
                <div
                        id="links-dropdown-content"
                        class="dropdown-menu dropdown-menu-width"></div>
            </li>
        </ul>
        <ul class="navbar-nav pull-right bg-inherit">
            <li class="nav-item my-auto ml-1">
                <a
                        id="facts-menu"
                        data-test="facts-menu"
                        class="nav-link click"
                        onclick="TaxonomiesMenu.toggle(event, this);"
                        onkeyup="TaxonomiesMenu.toggle(event, this);"
                        tabindex="13"
                        accesskey="9">
                    Facts
                    <span class="taxonomy-total-count badge badge-light">
              <i class="fas fa-spinner fa-spin"></i>
            </span>
                </a>
            </li>
        </ul>
    </div>
</nav>
<iframe id="app-inline-xbrl-doc" width = "100%" wmode="transparent" frameborder="0" onload="ixbrlViewer.parseIXBRL(this)" src="/sec/getWebDoc.php?repoint=true&f=<?= $docIXBRL ?>"></iframe>
</body>
</html>
<?php
}

function httpGet($target, $timeout = 15){
    $fp = false;
    $tryLimit = 3;
    $tries = 0;
    while($tries<$tryLimit && $fp===false){  //try up to 3 times to open resource
        $tries++;
        //$fp = @fsockopen($target, 80, $errNo, $errString, $timeout);
        $fp = @fopen( $target, 'r' );  //the @ suppresses a warning on failure
    }
    if($fp===false){  //failed (after 3 tries)
        $content = false;
        echo "httpGet failed ". $target;
    } else { //success
        $content = "";
        while( !feof( $fp ) ) {
            $buffer = trim( fgets( $fp, 4096 ) );
            $content .= $buffer;
        }
        fclose($fp);
    }
    return $content;
}

function repointHyperlinks($html){
    global $secPath, $remoteLocalPath;
    //repoint source file relative links (e.g. local images) to SEC
    $repointedHTML = preg_replace('/src="(\w+)/', 'src="' . $remoteLocalPath. '/${1}', $html);

    //repoint root relative links and images to SEC
    $repointedHTML = str_replace('href="/', 'href="' . $secPath . '/', $repointedHTML);
    $repointedHTML = str_replace('src="/', 'src="' . $secPath . '/', $repointedHTML);
    $repointedHTML = str_replace('href="https://www.sec.gov/ix?doc=/Archives/edgar/data/', 'href="https://www.publicdata.guru/sec/viewer.php?doc=', $repointedHTML);

    return $repointedHTML;
}
?>