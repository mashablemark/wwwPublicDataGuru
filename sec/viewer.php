<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 10/26/2018
 * Time: 3:14 PM
 */
$doc = $_REQUEST["doc"];
$secPath = "https://www.sec.gov";
$edgarPath = $secPath . "/Archives/edgar/data/";

$docIXBRL = false;
$remoteLocalPath = $edgarPath . substr($doc, 0, strrpos($doc,'/' )) ;
if(isset($_REQUEST["f"]) && $_REQUEST["f"]){

    echo repointHyperlinks(httpGet($edgarPath.$doc.".htm"));
} elseif(isset($_REQUEST["t"]) && strpos($doc, "-index")){
    //ADSH index page and t (tag) is is set => get index and check if for iXBRL doc and that in viewer if found
    $target = $edgarPath.$doc;
    $body = httpGet($target.".htm");
    $sIxSig = "/ix?doc=/Archives/edgar/data/";
    $ixPos = strpos($body, $sIxSig);
    if($ixPos){
        //load the iXBRL document into the viewer and have ixbrl_viewer.js navigate to the fact
        $docIXBRL = substr($body, $ixPos + strlen($sIxSig), strpos($body, '.htm', $ixPos) - $ixPos - strlen($sIxSig));
    } else {
        echo repointHyperlinks($body);
    }
} else {
    $docIXBRL = $doc;
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

    <link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" />
    <link rel="stylesheet" href="/global/js/fancybox-master/dist/jquery.fancybox.min.css" type="text/css">
    <link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/v/dt/jszip-2.5.0/dt-1.10.18/b-1.5.4/b-html5-1.5.4/sc-1.5.0/datatables.min.css"/>
    <link rel="stylesheet" href="css/viewer.css" type="text/css">
    <link rel="stylesheet" href="https://www.sec.gov/ixviewer/css/bootstrap/bootstrap.min.css" type="text/css">
    <link rel="stylesheet" href="https://www.sec.gov/ixviewer/css/app.css" type="text/css">
    <link rel="stylesheet" href="https://www.sec.gov/ixviewer/css/icon-as-image.css" type="text/css">
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="/global/js/highcharts/js/highcharts.js"></script>
    <script type="text/javascript" src="/global/js/highcharts/js/modules/exporting.js"></script>
    <script type="text/javascript" src="/global/js/fancybox-master/dist/jquery.fancybox.min.js"></script>
    <script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.36/pdfmake.min.js"></script>
    <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.36/vfs_fonts.js"></script>
    <script type="text/javascript" src="https://cdn.datatables.net/v/dt/jszip-2.5.0/dt-1.10.18/b-1.5.4/b-html5-1.5.4/sc-1.5.0/datatables.min.js"></script>
    <script type="text/javascript" src="/global/js/signals/signals.js"></script>
    <script type="text/javascript" src="/global/js/hasher/hasher.min.js"></script>
    <script type="text/javascript" src="js/ixbrl_viewer.js"></script>

    <title>Inline XBRL Viewer</title>
</head>
<body id="sec-body">
<div id="mainDiv">
    <div class="fixedMenuBar" style="opacity: 0.5">
        <div class="homeSection">
            <ul class="nav">
                <li id="menudropdown" class="dropdown">
                    <button id="menuIcon" type="button" data-toggle="dropdown"
                            class="menuIcon" tabindex="1" aria-label="Expand Menu"
                            title="Expand Menu">
                        <span class="icon-as-img icon-menu"></span>
                        <font id="menu" class="hidden-xs">Menu</font>
                    </button>
                    <ul class="dropdown-menu" aria-labelledby="dropdownMenu1">
                        <li><a id="information" href="#" tabindex="1"
                               data-toggle="panel-collapse" data-target="#about-modal">Information</a></li>
                        <li id="instanceFileLi"><a href="#" id="instanceFile"
                                                   tabindex="1" download>Save XBRL Instance</a></li>
                        <li id="instanceFileIELi"><a href="javascript:void(0)"
                                                     tabindex="1" id="instanceFileIE">Save XBRL Instance</a></li>
                        <li><a href="#" id="instanceAndCustomFile" tabindex="1">Save
                                XBRL Zip File</a></li>
                        <li><a href="#" id="openAsHtml"
                               onclick="window.open(this.href); return false;" tabindex="1"
                               open>Open as HTML</a></li>
                        <li id="taggedSectionsReport"
                            class="visible-xs visible-sm hidden-md hidden-lg"><a
                                href="#" id="btn-reports" data-toggle="collapse"
                                data-target=".nav-collapse" tabindex="1">Tagged Sections</a></li>
                        <li><a href="#" id="btn-settings" data-toggle="modal"
                               data-target="#settings-modal" tabindex="1">Settings</a></li>
                        <li><a href="#" id="btn-help" data-toggle="collapse"
                               data-target=".nav-collapse" tabindex="1">Help</a></li>
                    </ul>
                </li>
            </ul>
        </div>
        <div class="separator hidden-xs hidden-sm">&nbsp;</div>
        <div id="taggedSections" class="dataSection hidden-xs hidden-sm">
            <ul class="nav">
                <li class="inline">
                    <label class="menuIcon" style="color: #FFF;">
                        <span style="line-height: 15px;">Sections</span>
                    </label>
                    <span id="results-count-reports-badge" class="badge badge-Custom"></span>
                    <span class="icon-as-img icon-expand-more menuIcon" id="menuBtn-reports"
                          aria-label="Expand Tagged Sections"
                          title="Expand Tagged Sections"
                          tabindex="2"></span>
                </li>
            </ul>
        </div>
        <div class="separator">&nbsp;</div>
        <div class="searchSection">
            <form role="search">
                <div class="input-group" style="max-height: 16px;">
                    <input id="search-input" type="text" name="focus"
                           class="search-box form-control" placeholder="Search" tabindex="4" />
                    <button id="resetButton" class="close-icon" type="reset"
                            value="reset"></button>
                    <div class="input-group-btn">
                        <button id="search-btn" type="button" class="btn-new btn-default"
                                title="Search" name="Search" value="Search" tabindex="5">
                <span class="icon-as-img icon-search-black searchIcon"
                      title="Search"></span>
                        </button>
                    </div>
                </div>
            </form>
        </div>
        <div class="separator hidden-xs">&nbsp;</div>
        <div id="dataFilter" class="dataSection hidden-xs">
            <ul class="nav">
                <li class="dropdown">
                    <button type="button" data-toggle="modal"
                            data-target="#highlight-data-modal" class="menuIcon" tabindex="6"
                            aria-label="Expand Data Filter" title="Expand Data Filter">
                        <span class="icon-as-img icon-data"></span>
                        Data
                    </button>
                </li>
            </ul>
        </div>
        <div class="separator hidden-xs">&nbsp;</div>
        <div id="tags" class="conceptsSection hidden-xs">
            <ul class="nav">
                <li class="dropdown">
                    <button type="button" data-toggle="modal"
                            data-target="#highlight-concept-modal" class="menuIcon"
                            tabindex="7" aria-label="Expand Tags Filter"
                            title="Expand Tags Filter">
                        <span class="icon-as-img icon-tag"></span>
                        Tags
                    </button>
                </li>
            </ul>
        </div>
        <div class="separator">&nbsp;</div>
        <div class="moreFiltersSection">
            <ul class="nav">
                <li class="dropdown">
                    <button type="button" data-toggle="dropdown" class="menuIcon"
                            tabindex="8" aria-label="Expand More Filters"
                            title="Expand More Filters">
                        <span class="icon-as-img icon-filter"></span>
                        <font id="moreFilters"
                              class="hidden-xs">More Filters</font>
                    </button>
                    <ul id="moreFiltersList" class="dropdown-menu" role="menu"
                        aria-labelledby="dropdownMenu2">
                        <li id="dataFilterLink" class="visible-xs hidden-md hidden-lg"><a
                                data-toggle="modal" data-target="#highlight-data-modal" href="#">Data</a></li>
                        <li id="tagsFilterLink" class="visible-xs hidden-md hidden-lg"><a
                                data-toggle="modal" data-target="#highlight-concept-modal"
                                href="#">Tags</a></li>
                        <li><a data-toggle="modal" data-target="#filter-period-modal"
                               href="#">Periods</a></li>
                        <li><a data-toggle="modal" data-target="#filter-unit-modal"
                               href="#">Measures</a></li>
                        <li><a data-toggle="modal" data-target="#filter-axis-modal"
                               href="#">Axes</a></li>
                        <li><a data-toggle="modal" data-target="#filter-scale-modal"
                               href="#">Scale</a></li>
                        <li><a data-toggle="modal"
                               data-target="#filter-balance-modal" href="#">Balance</a></li>
                        <li>
                            <a data-toggle="modal"
                               data-target="#filter-source-documents" href="#">Source Documents</a>
                        </li>
                    </ul>
                </li>
            </ul>
        </div>
        <!--
        <div class="moreFiltersSection hidden" id="additionalFormsListSection">
          <ul class="nav">
              <li class="dropdown">
                  <button type="button" data-toggle="dropdown" class="menuIcon" tabindex="8" aria-label="Select Other Forms">
                      <font id="otherForms" class="hidden-xs"><span class="caret mr-3"></span>Additional Forms</font>
                  </button>
                  <ul id="additionalFormsList" class="dropdown-menu" role="menu" aria-labelledby="dropdownMenu2">
                  </ul>
              </li>
          </ul>
        </div>
  -->
        <div class="factsSection">
            <ul class="nav">
                <li class="inline">
                    <label class="hidden-xs menuIcon" style="color: #FFF;">
              <span id="factList" style="vertical-align: middle; line-height: 15px;">
    Facts
              </span>
                    </label>&nbsp;&nbsp;
                    <span id="results-count" class="position-badge badge badge-Custom"></span>
                    <span class="icon-as-img icon-expand-more" id="opener"
                          aria-label="Expand Facts" title="Expand Facts" tabindex="9"></span>
                </li>
            </ul>
        </div>
    </div>
    <div id="app-container" role="application">
        <div id="app-panel-breadcrum-container" style="display: none;">
            <div class="row">
                <div class="breadcrumb-container">
                    <div class="row">
                        <div id="filterDataDiv" class="col-xs-12">
                            <div data-filter-content></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <iframe id="app-inline-xbrl-doc" wmode="transparent" frameborder="0" onload="ixbrlViewer.parseIXBRL(this)" src="/sec/viewer.php?f=true&doc=<?= $docIXBRL ?>"></iframe>
        <div id="app-panel1">
            <!-- help container -->
            <div id="app-panel-help-container">
                <div class="toolbar">
                    <h4>Help</h4>
                    <button type="button" alt="Close" tabindex="1"
                            class="btn btn-default pull-right" data-dismiss="modal"
                            data-btn-remove>close</button>
                </div>
                <div class="panel-group" id="accordion">
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" aria-label=" Getting Started "
                               tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseGettingStarted">
                                Getting Started </a>
                        </div>
                        <div id="collapseGettingStarted" class="panel-collapse collapse">
                            <div class="panel-body">
                                The <i>Inline XBRL Viewer</i> allows a user to quickly and
                                easily review details of the tagged information in an Inline
                                document by automatically placing a highlight border around
                                each tagged numeric fact and left-aligned border for each
                                block tagged fact. Hovering over a tagged fact will highlight
                                (shade) all content related to the tagged fact, and clicking
                                on a tagged fact will reveal its tagging details in the Fact
                                Review Window. Search and filter options are also provided to
                                easily refine and identify specific types of tagged
                                information.
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseFactDisplay"> Fact
                                Review Window </a>
                        </div>
                        <div id="collapseFactDisplay" class="panel-collapse collapse">
                            <div class="panel-body">
                                The <i>Fact Review Window</i> shows the tagging details for
                                the currently selected fact, which is highlighted with a solid
                                blue background. There are four categories of fact detail
                                which can be viewed; an &ldquo;N/A&rdquo; value indicates
                                there is no available information for the item within the
                                given category:
                                <ul>
                                    <li><b>Attributes</b> &#45; All primary information (as
                                        applicable) describing the tagged fact including period,
                                        sign, decimals, dimensional detail (axes and members),
                                        scale, measure, data type and footnotes</li>
                                    <li><b>Labels</b> &#45; Detailed documentation
                                        (definition) for the tag used, and other labels</li>
                                    <li><b>References</b> &#45; Authoritative reference
                                        information (as applicable) for the selected tag</li>
                                    <li><b>Calculation</b> &#45; Balance and calculation
                                        hierarchy details (numeric items only)</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseSearch"> Search </a>
                        </div>
                        <div id="collapseSearch" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    The <i>Search</i> box can be used to find tagged facts
                                    matching entered keywords. By default, tag name, tag labels,
                                    and tagged content are included in Search. To search tagged
                                    information, enter a keyword and select the magnifying glass
                                    icon to return matching results. Tagged facts matching the
                                    search criteria are shown with a yellow-colored (default)
                                    shading, while Tagged Sections are reduced to just those
                                    that included the entered search keywords (if expanded; see
                                    Tagged Sections for additional detail). The content included
                                    in Search can be increased to included tag definitions,
                                    dimensions, and authoritative references. See Settings for
                                    more information.
                                </p>
                                <p>
                                    Search operators &ldquo;and&rdquo; (via &ldquo;AND&rdquo; or
                                    &ldquo;&&rdquo;) and &ldquo;or&rdquo; (via &ldquo;OR&rdquo;
                                    or &ldquo;|&rdquo;) are available to further refine a
                                    search. For example, and with <i>Settings</i> &ldquo;Include
                                    References&rdquo; on, searching for &ldquo;FASB AND
                                    225&rdquo; will highlight tagged data that is related to
                                    FASB Codification topic 225.
                                </p>
                                <p>
                                    <i>Filters</i> can be used in conjunction with Search to
                                    further refine the scope of Search. Filters reduce the
                                    amount of tagged facts that the keyword search is performed
                                    on. For example, if “cash” is entered in conjunction with a
                                    Tags filter of &ldquo;Custom Only&rdquo;, the shaded search
                                    results will only be indicated on tagged facts based on a
                                    custom tag.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseHighlight"> Filter
                            </a>
                        </div>
                        <div id="collapseHighlight" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    <i>Filters</i> change the number of highlighted facts
                                    indicated by providing several ways to review the tagged
                                    information. Multiple filters can be used at once. When the
                                    first filter is applied, a filter toolbar indicates all
                                    active filter selections and provides the ability to remove
                                    one or all applied filters.
                                </p>
                                <p style="font-weight: bold; margin-bottom: 2px;">Data
                                    Filter</p>
                                These filters options allow the user to refine the highlighted
                                tagged facts by data type:
                                <ul>
                                    <li><b>All</b> &#45; Displays all tagged data (default)</li>
                                    <li><b>Amounts Only</b> &#45; Numeric items only</li>
                                    <li><b>Text Only</b> &#45; Textual items only</li>
                                    <li><b>Calculations Only</b> &#45; Numeric items
                                        participating in a calculation</li>
                                    <li><b>Negatives Only</b> &#45; Numeric items with the
                                        Inline &ldquo;sign&rdquo; option</li>
                                    <li><b>Additional Items Only</b> &#45; Tagged items
                                        with potentially no corresponding HTML presentation (i.e.,
                                        hidden)</li>
                                </ul>
                                <p style="font-weight: bold; margin-bottom: 2px;">Tags
                                    Filter</p>
                                These filters allow the user to refine the highlighted facts
                                by tag type:
                                <ul>
                                    <li><b>Standard Only</b> &#45; Tags from a common
                                        taxonomy (e.g., US_GAAP, DEI)</li>
                                    <li><b>Custom Only</b> &#45; Extension tags unique to
                                        the entity's document</li>
                                </ul>
                                <p style="font-weight: bold; margin-bottom: 2px;">More
                                    Filters</p>
                                Additional filters that allow user to further refine the
                                highlighted facts:
                                <ul>
                                    <li><b>Periods</b> &#45; List of all used context
                                        reporting periods</li>
                                    <li><b>Measures</b> &#45; List of all used units of
                                        measure; as applicable</li>
                                    <li><b>Axes</b> &#45; List of all used axes
                                        (dimensions); as applicable</li>
                                    <li><b>Scale</b> &#45; List of all used scaled options
                                        (e.g., thousands, millions); as applicable</li>
                                    <li><b>Balance</b> &#45; Debit, credit; as applicable</li>
                                </ul>
                                <p>
                                    Multiple filters work in conjunction with each other. For
                                    example, selecting the "Amounts Only" Data filter and
                                    "Custom Only" Tags filter will highlight only numeric tagged
                                    facts using custom tags. Active filters are displayed in the
                                    Filter toolbar as they are selected. Active filters can be
                                    removed individually by selecting the "<b>X</b>" icon to the
                                    right of each filter, or all at once via the "Clear All"
                                    option.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseFactResultList">
                                Facts Results List </a>
                        </div>
                        <div id="collapseFactResultList" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    Selecting the down arrow "<b>V</b>" to the right of the
                                    facts count on the toolbar reveals the <i>Facts Results
                                        List</i>; a navigable listing of all currently highlighted
                                    tagged facts. By default, all tagged facts are displayed in
                                    the <i>Facts Results List</i>. The list content and count
                                    reflects the currently highlighted facts (i.e., both <i>Filters</i>
                                    and <i>Search</i> criteria refine the list to match the
                                    highlighted tagged facts). Navigation controls are available
                                    to move through the list as well as move the current view to
                                    the corresponding highlighted fact location automatically.
                                    When a fact in the <i>Facts Results List</i> is selected, it
                                    will reveal the <i>Fact Review Window</i>. <br /> <br />If
                                    the letter "<b>A</b>" appears for a fact, it indicates the
                                    fact is additional data (i.e., hidden with potentially no
                                    corresponding HTML presentation). If the letter "<b>C</b>"
                                    appears, the fact is tagged with a custom tag. If the letter
                                    "<b>D</b>" appears, the fact is tagged with dimensional
                                    information.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseInformation">
                                Information </a>
                        </div>
                        <div id="collapseInformation" class="panel-collapse collapse">
                            <div class="panel-body">
                                The <i>Information</i> menu item provides additional detail
                                about the current Inline document and customizable viewer
                                settings.
                                <ul>
                                    <li><b>Document</b> &#45; Basic company and document
                                        information</li>
                                    <li><b>Tags</b> &#45; Fact and tag (standard and
                                        custom) information</li>
                                    <li><b>Files</b> &#45; Files used</li>
                                    <li><b>Additional Items</b> &#45; Additional data
                                        that's been tagged but potentially does not have a
                                        corresponding location in the HTML</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseTaggedSections">
                                Tagged Sections </a>
                        </div>
                        <div id="collapseTaggedSections" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    The <i>Tagged Sections</i> toolbar/menu item provides a
                                    listing of the tagged sections of the Inline document. By
                                    selecting a section item in the listing, the document will
                                    navigate to that section. When the Tagged Sections feature
                                    is open, the Search box will additionally filter the list of
                                    sections to only those sections that match the entered
                                    criteria.
                                </p>
                            </div>
                        </div>
                    </div>


                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse" tabindex="1"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               data-parent="#accordion" href="#collapseMultiHtm">
                                Multiple Document Support</a>
                        </div>
                        <div id="collapseMultiHtm" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    Multiple Document Support allows navigation between Inline documents within the same submission.
                                    Users can access all Inline submission documents by selecting Source Documents from the More Filters menu.
                                    Items from other submission documents listed under Tagged Sections are preceded by a Multiple Document icon.
                                    Selecting it will navigate users to its location in that document.
                                </p>
                            </div>
                        </div>
                    </div>



                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               tabindex="1" data-parent="#accordion" href="#collapseExport">
                                Save XBRL Instance </a>
                        </div>
                        <div id="collapseExport" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    The <i>Save XBRL Instance</i> menu item allows an XBRL
                                    instance document (*.xml) that's extracted from the Inline
                                    document to be saved locally.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               tabindex="1" data-parent="#accordion"
                               href="#collapseExportZipFile"> Save XBRL Zip </a>
                        </div>
                        <div id="collapseExportZipFile" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    The <i>Save XBRL Zip</i> menu item allows a zip file (*.zip)
                                    that contains the as-provided XBRL instance document and
                                    related custom taxonomy files to be saved locally.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div class="panel panel-default">
                        <div class="panel-heading">
                            <a data-toggle="collapse"
                               style="font-size: 16px; color: inherit; font-weight: 500;"
                               tabindex="1" data-parent="#accordion" href="#collapseSettings">
                                Settings </a>
                        </div>
                        <div id="collapseSettings" class="panel-collapse collapse">
                            <div class="panel-body">
                                <p>
                                    The <i>Settings</i> menu item provides the ability to
                                    customize Viewer features.
                                </p>
                                Highlight Colors
                                <ul>
                                    <li><b>Tagged Data</b> &#45; Change the highlight color
                                        of the tagged fact border</li>
                                    <li><b>Search Results</b> &#45; Change the background
                                        color of tagged items matching the Search results</li>
                                    <li><b>Selected Fact</b> &#45; Change the color of
                                        highlight border used to identify the currently selected
                                        fact</li>
                                    <li><b>Tag Shading</b> &#45; Change the color of the
                                        shading applied to tagged data</li>
                                </ul>
                                Search Options
                                <ul>
                                    <li><b>Match Case</b> &#45; Matches the specific case
                                        of the entered Search keyword</li>
                                    <li><b>Include Labels</b> &#45; Extends Search to
                                        include tag labels</li>
                                    <li><b>Include Definitions</b> &#45; Extends Search to
                                        include tag definitions</li>
                                    <li><b>Include Dimensions</b> &#45; Extends Search to
                                        include dimensional detail</li>
                                    <li><b>Include References</b> &#45; Extends Search to
                                        include authoritative reference information</li>
                                </ul>
                                Tagged Fact Hover
                                <ul>
                                    <li><b>Display</b> &#45; Displays the hover fact review
                                        window for any tagged fact*</li>
                                    <li><b>Hide</b> &#45; Hides the hover fact review
                                        window for any tagged fact (default)</li>
                                </ul>
                                <p>*May impact performance with certain web browsers.</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="toolbar">
                    <h6 id="version"></h6>
                </div>
            </div>
            <!-- end of app panel help container -->
            <!-- app panel container -->
        </div>
        <!-- end of panel -->
        <div id="app-panel">
            <div id="app-panel-container">
                <div id="search-panel">
                    <!-- results -->
                    <div id="panel-section-results" class="panel-section">
                        <div id="results-header" style="text-align: center;"
                             class="clearfix">
                            <span id="results-count"></span><span class="factResultLinks"
                                                                  style="float: left; margin-right: 3px" tabindex="0"
                                                                  alt="Previous Fact" aria-label="Previous Fact"
                                                                  title="Previous Fact">Prev</span>&nbsp;&nbsp;<span
                                style="float: left;" class="factResultLinks" tabindex="0"
                                alt="Next Fact" aria-label="Next Fact" title="Next Fact">Next</span>
                            <span id="results-pages"></span>
                            <div class="pull-right">
                                <div class="btn-container form-inline"
                                     style="display: inline-block;">
                                    <button type="button" class="btn btn-sm"
                                            alt="First Fact Results List Page" title="First">
                                        <span class="icon-as-img icon-first-black"></span>
                                    </button>
                                    <button type="button" class="btn btn-sm"
                                            alt="Previous Fact Results List Page" title="Previous">
                                        <span class="icon-as-img icon-previous-black"></span>
                                    </button>
                                    <button type="button" class="btn btn-sm"
                                            alt="Next Fact Results List Page" title="Next">
                                        <span class="icon-as-img icon-next-black"></span>
                                    </button>
                                    <button type="button" class="btn btn-sm"
                                            alt="Last Fact Results List Page" title="Last">
                                        <span class="icon-as-img icon-last-black"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="rightNavigation">
                            <div class="rightNavTop"></div>
                            <div id="results"></div>
                            <div class="rightNavBottom"></div>
                        </div>
                    </div>
                </div>
                <!-- end of search panel -->
            </div>
            <!-- end of app panel container -->
        </div>
        <div id="app-panel2">
            <div id="app-panel-reports-container" style="display: none;">
                <div class="toolbar">
                    <h4>Tagged Sections</h4>
                    <button type="button" alt="Close"
                            class="btn btn-default pull-right visible-xs visible-sm hidden-md hidden-lg"
                            data-dismiss="modal" data-btn-remove>close</button>
                </div>
                <div id="search-panel">
                    <!-- results -->
                    <div id="panel-section-results-reports" class="panel-section">
                        <div id="results-header-report-operating" class="clearfix">
                            <strong class="visible-xs visible-sm hidden-md hidden-lg">Sections:
                                <span id="results-count-reports"></span>
                            </strong>
                        </div>
                        <div id="results-header-report-mutualFund" class="clearfix">
                            <strong class="visible-xs visible-sm hidden-md hidden-lg">Sections:
                                <span id="results-count-reports"></span>
                            </strong>
                        </div>
                        <div class="rightNavigation sidepanel-container-height" id="operatingCompanyTaggedSection">
                            <ul class="list-unstyled" id="usGaapTaggedSection">
                                <div id="documentTypeSingleLIDiv"></div>
                                <div id="documentTypeMainLIDiv">
                                    <li class="nav-header" id="documentTypeMainLI">
                                        <h5 style="font-weight: bold;" role="application">
                                            Document and Entity Information
                                            <a href="#"
                                               data-toggle="collapse"
                                               aria-label="Document and Entity Information"
                                               aria-title="Document and Entity Information"
                                               data-target="#documentType"
                                               tabindex="3">
                                                <span class="icon-as-img icon-expand-less-black"></span>
                                            </a>
                                        </h5>
                                        <ul class="list-unstyled collapse in" id="documentType"></ul>
                                    </li>
                                </div>
                                <li class="nav-header" id="statementLi"><h5
                                        style="font-weight: bold;" role="application">
                                        Financial Statements
                                        <a href="#" data-toggle="collapse"
                                           aria-label="Financial Statements"
                                           aria-title="Financial Statements"
                                           data-target="#statementType"
                                           style="text-decoration: none;" tabindex="3">
                                            <span class="icon-as-img icon-expand-less-black"></span>
                                        </a>
                                    </h5>
                                    <ul class="list-unstyled collapse in" id="statementType"></ul>
                                </li>

                                <li class="nav-header" id="rrLi"><h5
                                        style="font-weight: bold;" role="application">
                                        RR Summaries
                                        <a href="#" data-toggle="collapse"
                                           aria-label="RR_Summaries"
                                           aria-title="RR_Summaries"
                                           data-target="#RR_Summaries"
                                           style="text-decoration: none;" tabindex="3">
                                            <span class="icon-as-img icon-expand-less-black"></span>
                                        </a>
                                    </h5>
                                    <ul class="list-unstyled collapse in" id="RR_Summaries"></ul>
                                </li>


                                <li class="nav-header" id="disclosureLi"><h5
                                        style="font-weight: bold;" role="application">
                                        Notes to the Financials
                                        <a href="#" data-toggle="collapse"
                                           aria-label="Notes to the Financials"
                                           aria-title="Notes to the Financials"
                                           data-target="#disclosureType"
                                           style="text-decoration: none;" tabindex="3">
                                            <span class="icon-as-img icon-expand-more-black"></span>
                                        </a>
                                    </h5>
                                    <ul class="list-unstyled collapse" role="application"
                                        id="disclosureType"></ul>
                                </li>
                                <li class="nav-header" id="disclosureLiDup"><h5
                                        style="font-weight: bold;" role="application">
                                        Notes to the Financials
                                        <a href="#" data-toggle="collapse"
                                           aria-label="Notes to the Financials"
                                           aria-title="Notes to the Financials"
                                           data-target="#disclosureTypeExpanded"
                                           style="text-decoration: none;" tabindex="3">
                                            <span class="icon-as-img icon-expand-more-black"></span>
                                        </a>
                                    </h5>
                                    <ul class="list-unstyled collapse in"
                                        id="disclosureTypeExpanded"></ul>
                                </li>
                            </ul>
                        </div>
                        <div id="mutualFundTaggedSection" class="rightNavigation"
                             style="overflow-y: auto; height: 700px;">
                            <ul class="list-unstyled" id="ifrsTaggedSection">
                                <div id="documentTypeSingleLIDivIfrs"></div>
                                <div id="documentTypeMainLIDivIfrs">
                                    <li class="nav-header" id="documentTypeMainLIIfrs">
                                        <h5 style="font-weight: bold;" role="application">
                                            Document and Entity Information
                                            <a href="#"
                                               data-toggle="collapse"
                                               aria-label="Document and Entity Information"
                                               aria-title="Document and Entity Information"
                                               data-target="#documentTypeIfrs"
                                               style="text-decoration: none;" tabindex="3">
                                                <span class="icon-as-img icon-expand-less-black"></span>
                                            </a>
                                        </h5>
                                        <ul class="list-unstyled collapse in"
                                            id="documentTypeIfrs"></ul>
                                    </li>
                                </div>
                                <li class="nav-header" id="statementLiIfrs"><h5
                                        style="font-weight: bold;" role="application">
                                        Financial Statements
                                        <a href="#" data-toggle="collapse"
                                           aria-label="Financial Statements"
                                           aria-title="Financial Statements"
                                           data-target="#statementTypeIfrs"
                                           style="text-decoration: none;" tabindex="3">
                                            <span class="icon-as-img icon-expand-less-black"></span>
                                        </a>
                                    </h5>
                                    <ul class="list-unstyled collapse in" id="statementTypeIfrs"></ul>
                                </li>
                                <li class="nav-header" id="rrLiIfrs"><h5
                                        style="font-weight: bold;" role="application">
                                        RR Summaries
                                        <a href="#" data-toggle="collapse"
                                           aria-label="RR_Summaries"
                                           aria-title="RR_Summaries"
                                           data-target="#RR_SummariesIfrs"
                                           style="text-decoration: none;" tabindex="3">
                                            <span class="icon-as-img icon-expand-less-black"></span>
                                        </a>
                                    </h5>
                                    <ul class="list-unstyled collapse in" id="RR_SummariesIfrs"></ul>
                                </li>
                                <li class="nav-header" id="disclosureLiIfrs"><h5
                                        style="font-weight: bold;" role="application">
                                        Notes to the Financials
                                        <a href="#" data-toggle="collapse"
                                           aria-label="Notes to the Financials"
                                           aria-title="Notes to the Financials"
                                           data-target="#disclosureTypeIfrs"
                                           style="text-decoration: none;" tabindex="3">
                                            <span class="icon-as-img icon-expand-more-black"></span>
                                        </a>
                                    </h5>
                                    <ul class="list-unstyled collapse" role="application"
                                        id="disclosureTypeIfrs"></ul>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div></div>
            </div>
        </div>
    </div>
    <!-- end of container -->
    <!-- MODALS & POPOVERS -->
    <!-- settings -->
    <div id="settings-modal" class="modal fade" tabindex="-1" role="dialog"
         aria-labelledby="settingsDialog" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="settingsDialog">Settings</h4>
                </div>
                <div class="modal-body" data-modal-content
                     style="padding-bottom: 0px;">
                    <div class="row">
                        <div class="col-sm-12">
                            <div class="form-group" role="application">
                                <label style="font-size: 16px"><b>Highlight Colors</b></label><br />
                                <label for="setting-element-border-color">Tagged Data</label><br />
                                <div id="taggedDataResetColor" tabindex="0"
                                     aria-label="Tagged Data Color Selector">
                                    <input type="text" id="setting-element-border-color"
                                           class="setting-color-picker-container" />
                                </div>
                                <a tabindex="0"
                                   href="javascript:App_Settings.resetBorderColor('elementBorderColor');"
                                   aria-label="Tagged data reset to default">reset to
                                    default</a>
                            </div>
                            <div class="form-group" role="application">
                                <label for="setting-initial-highlight-color"
                                       style="margin-top: 5px; margin-left: -25px;">Search
                                    Results</label><br />
                                <div id="searchResultsResetColor" tabindex="0"
                                     aria-label="Search Results Color Selector">
                                    <input type="text" tabindex="0"
                                           id="setting-initial-highlight-color"
                                           class="setting-color-picker-container" />
                                </div>
                                <a tabindex="0"
                                   href="javascript:App_Settings.resetColor('initialHighlightColor');"
                                   aria-label="Search results reset to default">reset to
                                    default</a>
                            </div>
                            <div class="form-group" role="application">
                                <label for="setting-focus-highlight-color"
                                       style="margin-top: 5px; margin-left: -25px;">Selected
                                    Fact</label><br />
                                <div id="selectedFactResetColor" tabindex="0"
                                     aria-label="Selected Fact Color Selector">
                                    <input type="text" tabindex="0"
                                           id="setting-focus-highlight-color"
                                           class="setting-color-picker-container" />
                                </div>
                                <a tabindex="0"
                                   href="javascript:App_Settings.resetHighlightColor('focusHighlightColor');"
                                   aria-label="Selected Fact reset to default"> reset to
                                    default</a>
                            </div>
                            <div class="form-group" role="application">
                                <label for="setting-block-highlight-color"
                                       style="margin-top: 5px; margin-left: -25px;">Tag
                                    Shading</label><br />
                                <div id="selectedBlockResetColor" tabindex="0"
                                     aria-label="Block Tag Shading Color Selector">
                                    <input type="text" tabindex="0"
                                           id="setting-block-highlight-color"
                                           class="setting-color-picker-container" />
                                </div>
                                <a tabindex="0"
                                   href="javascript:App_Settings.resetColor('blockHighlightColor');"
                                   aria-label="Block Tag Shading reset to default"> reset
                                    to default</a>
                            </div>
                            <div class="row">
                                <div class="col-md-12" id="search-options">
                                    <fieldset class="checkbox">
                                        <legend style="border: 0px; margin-bottom: 5px;">
                                            <label style="font-size: 16px; padding-left: 0px;"><b>Search
                                                    Options</b></label>
                                        </legend>
                                        <div>
                                            <input id="search-include-labels" type="checkbox"
                                                   name="searchOptions" style="margin-left: 0px;" checked>
                                            <label for="search-include-labels">Include
                                                Labels</label>
                                        </div>
                                        <div>
                                            <input id="search-include-definitions" type="checkbox"
                                                   name="searchOptions" style="margin-left: 0px;">
                                            <label for="search-include-definitions">Include
                                                Definitions</label>
                                        </div>
                                        <div>
                                            <input id="search-include-dimensions" type="checkbox"
                                                   name="searchOptions" style="margin-left: 0px;">
                                            <label for="search-include-dimensions">Include
                                                Dimensions</label>
                                        </div>
                                        <div>
                                            <input id="search-include-references" type="checkbox"
                                                   name="searchOptions" style="margin-left: 0px;">
                                            <label for="search-include-references">Include
                                                References</label>
                                        </div>
                                        <div>
                                            <input id="search-match-case" type="checkbox"
                                                   name="searchOptions" style="margin-left: 0px;">
                                            <label for="search-match-case">Match Case</label>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                            <div style="height: 5px;"></div>
                            <div class="row">
                                <div class="col-md-12" id="tagTooltip"
                                     style="text-align: left;">
                                    <fieldset class="radio-taggedFact">
                                        <legend style="border: 0px; margin-bottom: 5px;">
                                            <label style="font-size: 16px; padding-left: 0px;"><b>Tagged
                                                    Fact Hover </b></label>
                                        </legend>
                                        <input id="radio1" type="radio" tabindex="0"
                                               name="toolTip" value="enable" title="1 out of 2"
                                               style="margin-left: 0px;"><label for="radio1"
                                                                                class="radio-inline-taggedFact">Display</label><br /> <input
                                            id="radio2" type="radio" checked="checked"
                                            name="toolTip" value="disable" title="2 out of 2"
                                            tabindex="0" style="margin-left: 0px;"><label
                                            for="radio2" class="radio-inline-taggedFact">Hide</label>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer"></div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- /.modal -->
    <div id="about-modal" class="about-modal">
        <div class="about-header" style="cursor: move;">
            <div class="modalTitleLeft" tabindex="0" id="about-header">
          <span style="font-weight: bold;" data-content="subtitle"
                aria-label="Comapny and Document">Company and Document</span>
            </div>
            <div class="modalTitleRight" style="cursor: move;">

                <div id="copyAllCoAndDoc" class="icon-as-img icon-copy modal-icon btn-copy"
                     tabindex="0" aria-label="Copy All"></div>

                <div id="closeCoAndDoc" class="icon-as-img icon-close modal-icon btn-remove"
                     tabindex="0" aria-label="close"></div>
            </div>
        </div>
        <div class="selection-detail-inner">
            <div id="about-carousel" class="carousel slide">
                <h4></h4>
                <!-- Document Information -->
                <div class="carousel-inner" style="height: 220px; overflow-y: auto;">
                    <div id="about1-modal" tabindex="0" class="item active"
                         data-slide-index="0"
                         style="padding-top: 15px; padding-right: 20px;"
                         onclick="this.blur();">
                        <div data-slide-content="companyInformation">
                            <table border="1" style="width: 100%">
                                <tr>
                                    <td style="padding: 3px;" width="40%">Company Name</td>
                                    <td style="padding: 3px;" width="60%"><span
                                            data-content="companyName"></span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 3px;" width="40%">Central Index Key</td>
                                    <td style="padding: 3px;" width="60%"><span
                                            data-content="companyCIK"></span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 3px;" width="40%">Document Type</td>
                                    <td style="padding: 3px;" width="60%"><span
                                            data-content="companyDocument"></span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 3px;" width="40%">Period End Date</td>
                                    <td style="padding: 3px;" width="60%"><span
                                            data-content="companyPeriodEndDate"></span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 3px;" width="40%">Fiscal
                                        Year/Period Focus</td>
                                    <td style="padding: 3px;" width="60%"><span
                                            data-content="companyFiscalYearAndPeriodFocus"></span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 3px;" width="40%">Current Fiscal
                                        Year End</td>
                                    <td style="padding: 3px;" width="60%"><span
                                            data-content="companyFiscalYear"></span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 3px;" width="40%">Amendment/Description</td>
                                    <td style="padding: 3px;" width="60%"><span
                                            data-content="companyAmendment"></span></td>
                                </tr>
                            </table>
                        </div>
                    </div>
                    <!-- Statistics -->
                    <div id="about2-modal" tabindex="0" class="item"
                         data-slide-index="1"
                         style="padding-top: 20px; padding-right: 30px;"
                         onclick="this.blur();">
                        <!--  <div class="modal-content" style="width: 280px;">-->
                        <div data-slide-content="tags" id="settingsModalBody">
                            <div id="AboutTable2">
                  <span>
                  	<strong>Total Facts:</strong>
                  	<span id="total-number-facts"></span>
                  </span>
                                <span class="pull-right">
                  	<strong>Inline Version:</strong>
                  	<span id="inline-version"></span>
                  </span>
                            </div>
                            <table id="ele-table">
                                <tr>
                                    <th>Tags</th>
                                    <th colspan="2">Standard</th>
                                    <th colspan="2">Custom</th>
                                    <th>Total</th>
                                </tr>
                                <tr data-ele-type="key_concepts">
                                    <th>Primary</th>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                </tr>
                                <tr data-ele-type="axis">
                                    <th>Axis</th>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                </tr>
                                <tr data-ele-type="member">
                                    <th>Member</th>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                </tr>
                                <tr data-ele-type="total">
                                    <th>Total</th>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                </tr>
                            </table>
                        </div>
                        <!-- </div> /.modal-content -->
                    </div>
                    <!-- /.modal -->
                    <!-- File In Use -->
                    <div id="about4-modal" tabindex="0" class="item"
                         data-slide-index="2" style="padding-top: 20px;"
                         onclick="this.blur();">
                        <!--  <div class="modal-content">-->
                        <div data-slide-content="files">
                            <div id="files-content"></div>
                        </div>
                        <!--  </div> /.modal-content -->
                    </div>
                    <!-- /.modal -->
                    <div id="about5-modal" tabindex="0" class="item"
                         data-slide-index="3" style="padding-top: 20px;"
                         onclick="this.blur();">
                        <!--  <div class="modal-content" style="width: 280px;">-->
                        <div data-slide-content="additionalTaggedData"
                             id="settingsModalBody">
                            <div id="hidden-items-content"></div>
                        </div>
                        <!-- </div> /.modal-content -->
                    </div>
                    <!-- /.modal -->
                </div>
                <div class="carousel-controls">
                    <a id="prevCarousel"
                       class="left carousel-control"
                       href="#about-carousel" role="button" data-slide="prev"
                       tabindex="0" aria-label="Previous">
                        <span class="icon-as-img icon-left-blue"></span>
                    </a>
                    <ol class="carousel-indicators">
                        <li id="lnk1" data-target="#about-carousel" tabindex="0"
                            data-slide-to="0" class="active"
                            aria-label="Company and Document" title="Company and Document"></li>
                        <li id="lnk2" data-target="#about-carousel" tabindex="0"
                            data-slide-to="1" aria-label="Tags" title="Tags"></li>
                        <li id="lnk3" data-target="#about-carousel" tabindex="0"
                            data-slide-to="2" aria-label="Files" title="Files"></li>
                        <li id="lnk4" data-target="#about-carousel" tabindex="0"
                            data-slide-to="3" aria-label="Additional Items"
                            title="Additional Items"></li>
                    </ol>
                    <a id="nextCarousel"
                       class="right carousel-control"
                       href="#about-carousel" role="button" data-slide="next"
                       tabindex="0" aria-label="Next">
                        <span class="icon-as-img icon-right-blue"></span>
                    </a>
                </div>
            </div>
        </div>
    </div>
    <div class="modal fade" id="highlight-data-modal" tabindex="-1"
         role="dialog" aria-labelledby="dataFilter" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" aria-label="Close" class="close"
                            data-dismiss="modal">&times;</button>
                    <h4 class="modal-title" id="dataFilter">Data Filter</h4>
                </div>
                <div class="modal-body">
                    <div class="radio">
                        <label> <input type="radio" name="highlight-elements"
                                       value="both" id="allDataFilter" checked> All
                        </label>
                    </div>
                    <div class="radio">
                        <label> <input type="radio" name="highlight-elements"
                                       value="amount">Amounts Only
                        </label>
                    </div>
                    <div class="radio">
                        <label> <input type="radio" name="highlight-elements"
                                       value="text">Text Only
                        </label>
                    </div>
                    <div class="radio">
                        <label> <input type="radio" name="highlight-elements"
                                       value="calculation">Calculations Only
                        </label>
                    </div>
                    <div class="radio">
                        <label> <input type="radio" name="highlight-elements"
                                       value="sign">Negatives Only
                        </label>
                    </div>
                    <div class="radio">
                        <label> <input type="radio" name="highlight-elements"
                                       value="hidden">Additional Items Only
                        </label>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <!-- highlight Concept -->
    <div id="highlight-concept-modal" class="modal fade" tabindex="-1"
         role="dialog" aria-labelledby="tagsFilter" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="tagsFilter">Tags Filter</h4>
                </div>
                <div class="modal-body" data-modal-content>
                    <div class="radio">
                        <label> <input type="radio" id="allTagFilter"
                                       name="highlight-concepts" value="both" checked> <label
                                for="allTagFilter" title="All Tags Filter"
                                style="padding-left: 0px;">All</label>
                        </label>
                    </div>
                    <div class="radio">
                        <label> <input type="radio" id="standardTagFilter"
                                       name="highlight-concepts" value="base"> <label
                                for="standardTagFilter" title="Standard Only Tags Filter"
                                style="padding-left: 0px;">Standard Only</label>
                        </label>
                    </div>
                    <div class="radio">
                        <label> <input type="radio" name="highlight-concepts"
                                       id="customTagFilter" value="custom"> <label
                                for="customTagFilter" title="Custom Only Tags Filter"
                                style="padding-left: 0px;">Custom Only</label>
                        </label>
                    </div>
                </div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- /.modal -->
    <!-- filter period-->
    <div id="filter-period-modal" class="modal fade" tabindex="-1" role="dialog"
         aria-labelledby="periodFilter" aria-hidden="true"
         data-prev-highlight-type="" data-contents-loaded="false">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="periodFilter">Periods Filter</h4>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div style="background-color: #B8B8B8; padding: 5px;">
                        <h5 class="modal-title">
                            Total: <span data-calendars-total-items>0</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                            Selected: <span data-calendars-checked>0</span>
                        </h5>
                    </div>
                    <div class="container-fluid" style="height: 300px; overflow: auto;">
                        <div>
                            <div data-calendars-content>loading...</div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- /.modal -->
    <!-- filter unit-->
    <div id="filter-unit-modal" class="modal fade" tabindex="-1" role="dialog"
         aria-labelledby="measureFilter" aria-hidden="true"
         data-prev-highlight-type="" data-contents-loaded="false">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="measureFilter">Measures Filter</h4>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div style="background-color: #B8B8B8; padding: 5px;">
                        <div class="row">
                            <div class="col-sm-12">
                                <h5 class="modal-title">
                                    Total: <span data-units-total-items>0</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                    Selected: <span data-units-checked>0</span>
                                </h5>
                            </div>
                        </div>
                    </div>
                    <div class="container-fluid"
                         style="height: 200px; overflow-y: auto; overflow-x: hidden;">
                        <div class="row">
                            <div class="col-sm-12">
                                <div>
                                    <div data-units-content>loading...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- /.modal -->
    <!-- filter Axis-->
    <div id="filter-axis-modal" class="modal fade" tabindex="-1" role="dialog"
         aria-labelledby="axisFilter" aria-hidden="true"
         data-prev-highlight-type="" data-contents-loaded="false">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 290px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="axisFilter">Axes Filter</h4>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div style="background-color: #B8B8B8; padding: 5px;">
                        <div class="row">
                            <div class="col-sm-12">
                                <h5 class="modal-title">
                                    Total:<span data-axis-total-items>0</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                    Selected: <span data-axis-checked>0</span>
                                </h5>
                            </div>
                        </div>
                    </div>
                    <div class="container-fluid"
                         style="height: 200px; overflow-x: hidden;">
                        <div class="row">
                            <div class="col-sm-12">
                                <div>
                                    <div data-axis-content>loading...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- /.modal -->
    <!-- filter scale-->
    <div id="filter-scale-modal" class="modal fade" tabindex="-1" role="dialog"
         aria-labelledby="scaleFilter" aria-hidden="true"
         data-prev-highlight-type="" data-contents-loaded="false">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="scaleFilter">Scale Filter</h4>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div style="background-color: #B8B8B8; padding: 5px;">
                        <div class="row">
                            <div class="col-sm-12">
                                <h5 class="modal-title">
                                    Total: <span data-scale-total-items>0</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                    Selected: <span data-scale-checked>0</span>
                                </h5>
                            </div>
                        </div>
                    </div>
                    <div class="container-fluid"
                         style="height: 200px; overflow-y: auto; overflow-x: hidden;">
                        <div class="row">
                            <div class="col-sm-12">
                                <div>
                                    <div data-scale-content>loading...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- /.modal -->
    <!-- filter balance-->
    <div id="filter-balance-modal" class="modal fade" tabindex="-1"
         role="dialog" aria-labelledby="balanceFilter" aria-hidden="true"
         data-prev-highlight-type="" data-contents-loaded="false">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="balanceFilter">Balance Filter</h4>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div style="background-color: #B8B8B8; padding: 5px;">
                        <div class="row">
                            <div class="col-sm-12">
                                <h5 class="modal-title">
                                    Total: <span data-balance-total-items>2</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                    Selected: <span data-balance-checked>0</span>
                                </h5>
                            </div>
                        </div>
                    </div>
                    <div class="container-fluid"
                         style="height: 100px; overflow-y: auto; overflow-x: hidden;">
                        <div class="row">
                            <div class="col-sm-12">
                                <div>
                                    <div>
                                        <div class="checkbox">
                                            <label> <input type="checkbox"
                                                           id="debitBalanceFilter" value="debit"><label
                                                    style="padding-left: 0px;" for="debitBalanceFilter"
                                                    title="Debit Balance Filter">Debit</label>
                                            </label>
                                        </div>
                                        <div class="checkbox">
                                            <label> <input type="checkbox"
                                                           id="creaditBalanceFilter" value="credit"><label
                                                    style="padding-left: 0px;" for="creaditBalanceFilter"
                                                    title="Credit Balance Filter">Credit</label>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- /.modal -->

    <div id="filter-source-documents" class="modal fade" tabindex="-1"
         role="dialog" aria-labelledby="balanceFilter" aria-hidden="true"
         data-prev-highlight-type="" data-contents-loaded="false">
        <div class="modal-dialog">
            <div class="modal-content" style="width: 280px;">
                <div class="modal-header" style="cursor: move;">
                    <button type="button" alt="Close" class="close" data-dismiss="modal">
                        <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                    </button>
                    <h4 class="modal-title" id="balanceFilter">Source Documents</h4>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div style="background-color: #B8B8B8; padding: 5px;">
                        <div class="row">
                            <div class="col-sm-12">
                                <h5 class="modal-title">
                                    Total: <span id="totalSourceDocumentsCount"></span>
                                </h5>
                            </div>
                        </div>
                    </div>
                    <div class="container-fluid"
                         style="height: 100px; overflow-y: auto; overflow-x: hidden;">
                        <div class="row">
                            <div class="col-sm-12">
                                <ol id="additionalFormsList" class="pl-10"></ol>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- progress dialog -->
    <div class="progress-bak"></div>
    <div class="progress-container">
        <h3></h3>
        <div class="progress">
            <div class="progress-bar progress-bar-striped active" role="progressbar"
                 aria-valuenow="45" aria-valuemin="0" aria-valuemax="100">
                <span class="sr-only">45% Complete</span>
            </div>
        </div>
    </div>
    <!-- message box -->
    <div id="message-box-container">
        <div class="message-btn">
            <span class="icon-as-img icon-close-circle-white"></span>
        </div>
        <div id="message-content"></div>
    </div>
    <!-- selection detail -->
    <div id="selection-detail-container-mouseOver"
         class="selection-detail-container-onHover">
        <div class="selection-detail-header-onHover">
            <span style="font-weight: bold;" data-content="label"></span>
        </div>
        <div>
            <div data-content="attributes" data-slide-index="0"></div>
            <div>
                <a class="carousel-control" href="#selection-detail-carousel"></a> <a
                    class="carousel-control" href="#selection-detail-carousel"></a>
            </div>
        </div>
    </div>
    <div id="selection-detail-container" class="selection-detail-container">
        <div class="selection-detail-header" style="cursor: move;">
            <div class="modalTitleLeft" tabindex="0">
                <span style="font-weight: bold;" data-content="subtitle"></span>
            </div>
            <div class="modalTitleRight" style="cursor: move;">
                <span id="copyAllFRW" class="icon-as-img icon-copy modal-icon" tabindex="0" aria-label="Copy All"></span>
                <span id="closeFRW" class="icon-as-img icon-close modal-icon" tabindex="0" aria-label="Close"></span>
            </div>
        </div>
        <div class="selection-detail-inner">
            <div id="selection-detail-carousel" class="carousel slide">
                <h4 data-content="label"></h4>
                <div class="carousel-inner" style="height: 210px; overflow-y: auto;">
                    <div id="div1" tabindex="0" class="item active"
                         data-content="attributes" data-slide-index="0"
                         onclick="this.blur();"></div>
                    <div id="div2" tabindex="0" class="item" data-content="labels"
                         data-slide-index="1" onclick="this.blur();"></div>
                    <div id="div3" tabindex="0" class="item" data-content="reference"
                         data-slide-index="2" onclick="this.blur();"></div>
                    <div id="div4" tabindex="0" class="item" data-slide-index="3"
                         onclick="this.blur();">
                        <table class="table-framed">
                            <tr>
                                <td width="35%">Section</td>
                                <td width="65%"><div class="wordBreakDiv">
                                        <span data-content="section"></span>
                                    </div></td>
                            </tr>
                            <tr>
                                <td width="35%">Balance</td>
                                <td width="65%"><div class="wordBreakDiv">
                      <span data-content="balance"
                            style="text-transform: capitalize"></span>
                                    </div></td>
                            </tr>
                            <tr>
                                <td width="35%">Weight</td>
                                <td width="65%"><div class="wordBreakDiv">
                                        <span data-content="weight"></span>
                                    </div></td>
                            </tr>
                            <tr>
                                <td width="35%">Parent</td>
                                <td width="65%"><div class="wordBreakDiv">
                                        <span data-content="parent"></span>
                                    </div></td>
                            </tr>
                        </table>
                    </div>
                </div>
                <div class="carousel-controls">
                    <a id="prevCarousel1"
                       class="left carousel-control"
                       href="#selection-detail-carousel" role="button" data-slide="prev"
                       tabindex="0" aria-label="Previous">
                        <span class="icon-as-img icon-left-blue"></span>
                    </a>
                    <ol class="carousel-indicators">
                        <li id="lnk1" data-target="#selection-detail-carousel"
                            data-slide-to="0" class="active" tabindex="0"
                            aria-label="Attributes" title="Attributes"></li>
                        <li id="lnk2" data-target="#selection-detail-carousel"
                            data-slide-to="1" tabindex="0" aria-label="Labels"
                            title="Labels"></li>
                        <li id="lnk3" data-target="#selection-detail-carousel"
                            data-slide-to="2" tabindex="0" aria-label="References"
                            title="References"></li>
                        <li id="lnk4" data-target="#selection-detail-carousel"
                            data-slide-to="3" tabindex="0" aria-label="Calculation"
                            title="Calculation"></li>
                    </ol>
                    <a id="nextCarousel1"
                       class="right carousel-control"
                       href="#selection-detail-carousel" role="button" data-slide="next"
                       tabindex="0" aria-label="Next">
                        <span class="icon-as-img icon-right-blue"></span>
                    </a>
                </div>
            </div>
        </div>
    </div>
    <!-- alert -->
    <div id="alert-modal" class="modal" tabindex="-1" role="dialog"
         aria-labelledby="Error:Browser Old" aria-hidden="true"
         data-keyboard="false" data-backdrop="static">
        <div class="modal-dialog">
            <div class="modal-content alert alert-dangers">
                <h3 style="text-align: center">
                    <b>Incompatible Browser</b>
                </h3>
                <div id="browser-compatibility"></div>
            </div>
            <!-- /.modal-content -->
        </div>
        <!-- /.modal-dialog -->
    </div>
    <!-- END MODALS & POPOVERS -->
    <!-- TEMPLATES -->
    <!-- END TEMPLATES -->
</div>
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

    return $repointedHTML;
}