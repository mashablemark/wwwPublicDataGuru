<?php
$edgarPath = 'https://www.sec.gov/Archives/edgar/data/';
$cik = $_REQUEST['cik'];
$accnA = $_REQUEST['a'];
$accnB = $_REQUEST['b'];
$indexHeaderA = httpGet($edgarPath . $cik . "/".str_replace("-","", $accnA)."/".$accnA."-index-headers.html");
$indexHeaderB = httpGet($edgarPath . $cik . "/".str_replace("-","", $accnB)."/".$accnB."-index-headers.html");

$A = parseIndexHeader($indexHeaderA);
$B = parseIndexHeader($indexHeaderB);

//$filingBodyA = bodyContents(httpGet($edgarPath . $cik . "/".str_replace("-","", $accnA)."/" . $A["fileName"]));
//$filingBodyB = bodyContents(httpGet($edgarPath . $cik . "/".str_replace("-","", $accnB)."/" . $B["fileName"]));
?>
<!DOCTYPE html>
<html>
<head lang="en">
    <meta charset="UTF-8">
    <title>Financial Statement Textual Comparison</title>

    <!--CSS files-->
    <link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" type="text/css" />
    <link  rel="stylesheet" href="/global/js/loadmask/jquery.loadmask.css" type="text/css" />
    <!-- open source javascript libraries -->
    <script type="text/javascript" src="js/wikEdDiff.js"></script>
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>
    <script type="text/javascript" src="/global/js/loadmask/jquery.loadmask.js"></script>
    <style>
        .wikEdDiffDelete {
            background-color: red !important;
            text-decoration: line-through;
        }
        iframe{
            width: 100%;
            height: 100%;
            margin:0;
            padding: 0;
        }
        .framepanel{
            position: absolute;
            width: 99%;
            background: white !important;
            padding: 3px;
        }
    </style>
</head>
<body>
<div id="tabs" style="width:80%;" class="ui-tabs ui-corner-all ui-widget ui-widget-content">
    <!--button class="compare">compare</button-->
    <ul role="tablist" class="ui-tabs-nav ui-corner-all ui-helper-reset ui-helper-clearfix ui-widget-header">
        <li role="tab" tabindex="0" class="ui-tabs-tab ui-corner-top ui-state-default ui-tab ui-tabs-active ui-state-active" aria-controls="tabs-A" aria-labelledby="ui-id-1" aria-selected="true" aria-expanded="true"><a href="#tabs-A" role="presentation" tabindex="-1" class="ui-tabs-anchor" id="ui-id-1"><?=$A["description"].' (filed '.$A["filed"].")"?></a></li>
        <li role="tab" tabindex="-1" class="ui-tabs-tab ui-corner-top ui-state-default ui-tab" aria-controls="tabs-B" aria-labelledby="ui-id-2" aria-selected="false" aria-expanded="false"><a href="#tabs-B" role="presentation" tabindex="-1" class="ui-tabs-anchor" id="ui-id-2"><?=$B["description"].' (filed '.$B["filed"].")"?></a></li>
        <li role="tab" tabindex="-1" class="ui-tabs-tab ui-corner-top ui-state-default ui-tab" aria-controls="tabs-redline" aria-labelledby="ui-id-3" aria-selected="false" aria-expanded="false"><a href="#tabs-redline" role="presentation" tabindex="-1" class="ui-tabs-anchor" id="ui-id-3">Difference</a></li>
    </ul>
    <div id="tabs-A" class="framepanel ui-corner-bottom ui-widget-content" aria-labelledby="ui-id-1" role="tabpanel" aria-hidden="false" style="height: 1049.87px;z-index: 30">
        <iframe id="iframe-A" src="viewer.php?f=true&doc=<?= $cik . "/".str_replace("-","", $accnA)."/" . $A["fileName"] ?>" onload="iframeLoaded()"></iframe>
    </div>
    <div id="tabs-B" class="framepanel ui-corner-bottom ui-widget-content" aria-labelledby="ui-id-2" role="tabpanel" aria-hidden="true" style="height: 1049.87px; z-index: 0;">
        <iframe id="iframe-B" src="viewer.php?f=true&doc=<?= $cik . "/".str_replace("-","", $accnB)."/" . $B["fileName"] ?>" onload="iframeLoaded()"></iframe>
    </div>
    <div id="tabs-redline" class="framepanel ui-corner-bottom ui-widget-content" aria-labelledby="ui-id-3" role="tabpanel" aria-hidden="true" style="height: 1049.87px; z-index: 0;">
        <div class="footerRight" style="position:fixed ; top: 200px; right: 5px;">
            <div class="footerItemTitle">Legend
            </div>
            <div class="footerItemText">
                <div class="legend">
                    <ul>
                        <li><span class="wikEdDiffMarkRight" title="Moved block" id="wikEdDiffMark999" onmouseover="wikEdDiffBlockHandler(undefined, this, 'mouseover');"></span> Original block position</li>
                        <li><span title="+" class="wikEdDiffInsert">Inserted<span class="wikEdDiffSpace"><span class="wikEdDiffSpaceSymbol"></span> </span>text<span class="wikEdDiffNewline"> </span></span></li>
                        <li><span title="−" class="wikEdDiffDelete">Deleted<span class="wikEdDiffSpace"><span class="wikEdDiffSpaceSymbol"></span> </span>text<span class="wikEdDiffNewline"> </span></span></li>
                        <li><span class="wikEdDiffBlockLeft" title="◀" id="wikEdDiffBlock999" onmouseover="wikEdDiffBlockHandler(undefined, this, 'mouseover');">Moved<span class="wikEdDiffSpace"><span class="wikEdDiffSpaceSymbol"></span> </span>block<span class="wikEdDiffNewline"> </span></span></li>
                        <li><span class="newlineSymbol">¶</span> Newline <span class="spaceSymbol">·</span> Space <span class="tabSymbol">→</span> Tab</li>
                    </ul>
                </div>
            </div>
        </div>
        <iframe src="compare_template.html" id="redline" onload="iframeLoaded()"></iframe>
    </div>
    <div class="framepanel" style="z-index: -99; position:static;"></div>

</div>


<!--div id="tabs" style="width:80%;">
    <ul>
          <li><a href="#tabs-A"><?=$A["description"].' (filed '.$A["filed"].")"?></a></li>
          <li><a href="#tabs-B"><?=$B["description"].' (filed '.$B["filed"].")"?></a></li>
          <li><a href="#tabs-redline">Difference</a></li>
        </ul>
    <div id="tabs-A" class="framepanel"><iframe id="iframe-A" src="viewer.php?f=true&doc=<?= $cik . "/".str_replace("-","", $accnA)."/" . $A["fileName"] ?>" onload="iframeLoaded()"></iframe></div>
    <div id="tabs-B" class="framepanel"><iframe id="iframe-B" src="viewer.php?f=true&doc=<?= $cik . "/".str_replace("-","", $accnB)."/" . $B["fileName"] ?>" onload="iframeLoaded()"></iframe></div>
    <div id="tabs-redline" class="framepanel">
        <div class="footerRight" style="position:fixed ; top: 200px; right: 5px;" >
            <div class="footerItemTitle">Legend
            </div>
            <div class="footerItemText">
                <div class="legend">
                    <ul>
                        <li><span class="wikEdDiffMarkRight" title="Moved block" id="wikEdDiffMark999" onmouseover="wikEdDiffBlockHandler(undefined, this, 'mouseover');"></span> Original block position</li>
                        <li><span title="+" class="wikEdDiffInsert">Inserted<span class="wikEdDiffSpace"><span class="wikEdDiffSpaceSymbol"></span> </span>text<span class="wikEdDiffNewline"> </span></span></li>
                        <li><span title="−" class="wikEdDiffDelete">Deleted<span class="wikEdDiffSpace"><span class="wikEdDiffSpaceSymbol"></span> </span>text<span class="wikEdDiffNewline"> </span></span></li>
                        <li><span class="wikEdDiffBlockLeft" title="◀" id="wikEdDiffBlock999" onmouseover="wikEdDiffBlockHandler(undefined, this, 'mouseover');">Moved<span class="wikEdDiffSpace"><span class="wikEdDiffSpaceSymbol"></span> </span>block<span class="wikEdDiffNewline"> </span></span></li>
                        <li><span class="newlineSymbol">¶</span> Newline <span class="spaceSymbol">·</span> Space <span class="tabSymbol">→</span> Tab</li>
                    </ul>
                </div>
            </div>
        </div>
        <iframe src="compare_template.html" id="redline" onload="iframeLoaded()"></iframe>
    </div>
</div-->
</body>

<script language="JavaScript">
    $(document).ready(function() {
        //$('#tabs').tabs();  //JQUI's tabs hides the panels by setting display=none.  Chrome handles this poorly, forgetting the scroll placement and reflowing when redisplayed  = very slow
        $('#tabs').mask('Loading the documents and performing the comparison.<br><br>Please use a current version of Firefox, Google Chrome, or Microsoft Edge for fastest load times.');
        $('div.scrollpanel, div.framepanel').height(window.innerHeight-$('ul.ui-tabs-nav').outerHeight()-55);
        var tabItems = $('#tabs ul.ui-tabs-nav li');
        tabItems.click(function(){
            var $clickedItem = $(this).addClass('ui-tabs-active ui-state-active'),
                clickedID = this.id,
                clickedHREF = $clickedItem.find('a').attr('href');
                $(clickedHREF).css('z-index', 10);
            $.each(tabItems, function(i, li){
                var $li = $(li),
                    thisHREF = $li.find('a').attr('href');
                if(thisHREF!=clickedHREF){
                    $li.removeClass('ui-tabs-active ui-state-active');
                    $(thisHREF).css('z-index', 0);
                }
            });
        })
    });
    var frameLoaded = 0;
    function iframeLoaded(){
        frameLoaded++;
        if(frameLoaded==3){
            // calculate the diff on load
            /* for (var option = 0; option < WikEdDiffTool.options.length; option ++) {
                 wikEdDiffConfig[ WikEdDiffTool.options[option] ] = (document.getElementById(WikEdDiffTool.options[option]).checked === true);
             }
             wikEdDiffConfig.blockMinLength = parseInt(document.getElementById('blockMinLength').value);
             wikEdDiffConfig.unlinkMax = parseInt(document.getElementById('unlinkMax').value);
             wikEdDiffConfig.recursionMax = parseInt(document.getElementById('recursionMax').value);*/
console.time('rxges');  //
            //getting the body string and removing tags via regex took 148ms for two 2.8MB complex 10-Q files
            var rxBlockTags = /(<(tr|p|div)([^>]+)>)/ig,
                rxDivInCell = /<td([^>]+)>(<span([^>]+)>)*<div[^>]+>/ig,  //avoid line breaks for DIVs next in table cells
                rxAllTags = /(<([^>]+)>|&nbsp;)/ig,
                rxIXHeader = /<ix:header[\s\S]+\/ix:header>/ig,
                rxCR = /\n/g,
                oldString = document.getElementById('iframe-A').contentDocument.body.innerHTML.replace(rxIXHeader,' ').replace(rxDivInCell,' ').replace(rxCR,' ').replace(rxBlockTags,'\n').replace(rxAllTags,' '),
                newString = document.getElementById('iframe-B').contentDocument.body.innerHTML.replace(rxIXHeader,' ').replace(rxDivInCell,' ').replace(rxCR,' ').replace(rxBlockTags,'\n').replace(rxAllTags,' ');
console.timeEnd('rxges');  //
console.time('wikEdDiff');
            wikEdDiffConfig = {
                blockMinLength: 3,
                charDiff: true,
                coloredBlocks: true,
                debug: false,
                fullDiff: true,
                noUnicodeSymbols: false,
                recursionMax: 20,
                recursiveDiff: true,
                repeatedDiff: true,
                showBlockMoves: true,
                stripTrailingNewline: true,
                timer: false,
                unitTesting: false,
                unlinkBlocks: false,
                unlinkMax: 20
            };
            var wikEdDiff = new WikEdDiff();
            var diffHtml = wikEdDiff.diff(oldString, newString).replace(/<(\/*)pre([^>]*)>/gi,'<$1p>').replace(/\n+\s*\n*/g,'</p><p>');
            //console.log(diffHtml.substring(0,100));
            console.log('<PRE count: '+ (diffHtml.match(/<pre([^>]*)>/gi) || []).length);
            console.log('</PRE or <PRE count: '+ (diffHtml.match(/<(\/*)(pre)([^>]*)>/gi) || []).length);
            console.log('newline count: '+ (diffHtml.match(/\n/g) || []).length);
            console.log('start')
            console.log(diffHtml.substr(0,3000));
            console.log('end')
            console.log(diffHtml.substr(-1000));
console.timeEnd('wikEdDiff');
            document.getElementById('redline').contentDocument.body.innerHTML = diffHtml; //.replace(/<p>\s*<p>/ig, '<p>');  //executes in 683ms for two 2.8MB complex 10-Q files
            $('body').unmask();
        }
    }
</script>

<?php

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
function parseIndexHeader($body){
    $filedNoDashes = getFirst($body, '<FILING-DATE>');
    return [
        "fileName" => getFirst($body, '&lt;FILENAME&gt;'),
        "filed" => substr($filedNoDashes, 0, 4) . "-" . substr($filedNoDashes, 4, 2). "-" . substr($filedNoDashes, 6, 2),
        "description" => getFirst($body, '&lt;DESCRIPTION&gt;')
    ];
}
function getFirst($body, $indicator){
    $startPos = strpos($body, $indicator)+strlen($indicator);
    $endPos = strpos($body, substr($indicator,0, 1), $startPos);
    return substr($body, $startPos, $endPos - $startPos);
}
function bodyContents($html){
    $bodyBodyTagStart = stripos($html, "<BODY");
    $bodyBodyTagEnd = stripos($html, ">", $bodyBodyTagStart+1);
    $bodyEnd = stripos($html, "</BODY>");
    return substr($html, $bodyBodyTagEnd+ 1, $bodyEnd-$bodyBodyTagEnd);
}

?>
