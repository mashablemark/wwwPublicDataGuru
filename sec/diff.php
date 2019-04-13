<?php
$edgarPath = 'https://www.sec.gov/Archives/edgar/data/';
$filingBody = bodyContents(httpGet($edgarPath .$_REQUEST['A']));
$amendBody = bodyContents(httpGet($edgarPath .$_REQUEST['B']));
?>
<!DOCTYPE html>
<html>
<head lang="en">
    <meta charset="UTF-8">
    <title>Redline Prototype</title>

    <!--CSS files-->
    <link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" type="text/css" />
    <!-- open source javascript libraries -->
    <script type="text/javascript" src="js/wikEdDiff.js"></script>
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>
    <style>
        div.scrollpanel{
            overflow-y: scroll;
        }
        .wikEdDiffDelete {
            background-color: red !important;
            text-decoration: line-through;
        }
    </style>
</head>
<body>
<div id="tabs" style="width:80%;">
    <!--button class="compare">compare</button-->
    <ul>
          <li><a href="#tabs-original">Original filing</a></li>
          <li><a href="#tabs-amended">Amended Filing</a></li>
          <li><a href="#tabs-redline">Difference</a></li>
        </ul>
    <div id="tabs-original" class="scrollpanel"><?=$filingBody?></div>
    <div id="tabs-amended" class="scrollpanel"><?=$amendBody?></div>
    <div id="tabs-redline" class="scrollpanel">
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
        <div id="redline"></div>
    </div>
</div>
</body>

<script language="JavaScript">
    $(document).ready(function() {
        $('#tabs').tabs();
        $('div.scrollpanel').height(window.innerHeight-$('ul.ui-tabs-nav').outerHeight()-25);

        // calculate the diff on load
        /* for (var option = 0; option < WikEdDiffTool.options.length; option ++) {
             wikEdDiffConfig[ WikEdDiffTool.options[option] ] = (document.getElementById(WikEdDiffTool.options[option]).checked === true);
         }
         wikEdDiffConfig.blockMinLength = parseInt(document.getElementById('blockMinLength').value);
         wikEdDiffConfig.unlinkMax = parseInt(document.getElementById('unlinkMax').value);
         wikEdDiffConfig.recursionMax = parseInt(document.getElementById('recursionMax').value);*/

        var rxBlockTags = /(<(tr|p|div)([^>]+)>)/ig,
            rxAllTags = /(<([^>]+)>|&nbsp;)/ig,
            rxCR = /\n/g,
            oldString = $('#tabs-original').html().replace(rxCR,' ').replace(rxBlockTags,'\n').replace(rxAllTags,' '),
            newString = $('#tabs-amended').html().replace(rxCR,' ').replace(rxBlockTags,'\n').replace(rxAllTags,' ');

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
            stripTrailingNewline: false,
            timer: false,
            unitTesting: false,
            unlinkBlocks: false,
            unlinkMax: 20
        };
        var wikEdDiff = new WikEdDiff();
        var diffHtml = wikEdDiff.diff(oldString, newString);
        document.getElementById('redline').innerHTML = diffHtml;
    });
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

function bodyContents($html){
    $bodyStart = stripos($html, "<DIV");
    $bodyEnd = stripos($html, "</BODY>");
    return substr($html, $bodyStart, $bodyEnd-$bodyStart);
}

?>
