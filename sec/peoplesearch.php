<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 10/26/2018
 * Time: 3:14 PM
 */

$sample = isset($_REQUEST["sample"])?$_REQUEST["sample"]:"10Q";
$filings = [
    "10Q" => [
            "original" => "https://www.sec.gov/Archives/edgar/data/1098996/000121390018013211/f10k2018_orancoinc.htm",
            "amended" => "https://www.sec.gov/Archives/edgar/data/1098996/000121390018014912/f10k2018a2_orancoinc.htm"
        ],
    "10K" => [
        "original" => "https://www.sec.gov/Archives/edgar/data/34088/000003408817000017/xom10k2016.htm",
        "amended" =>  "https://www.sec.gov/Archives/edgar/data/34088/000003408818000015/xom10k2017.htm"
    ]
];

$filingUrl=
$amend1Url = "https://www.sec.gov/Archives/edgar/data/1098996/000121390018014496/f10k2018a1_orancoinc.htm";

$filingBody = bodyContents(httpGet($filings[$sample]["original"]));
$amendBody = bodyContents(httpGet($filings[$sample]["amended"]));

?>
<!DOCTYPE html>
<html>
<head lang="en">
    <meta charset="UTF-8">
    <title>Edgar Viz Test Page</title>

    <!--CSS files-->
    <link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" type="text/css" />
    <!-- open source javascript libraries -->
    <script type="text/javascript" src="js/wikEdDiff.js"></script>
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>
</head>
<body>

<h2>ORANCO INC for period 7-31-2018</h2>

<div id="tabs" style="width:80%;">
    <!--button class="compare">compare</button-->
    <ul>
          <li><a href="#tabs-original">Original filing</a></li>
          <li><a href="#tabs-amended">Amended Filing</a></li>
          <li><a href="#tabs-redline">Difference</a></li>
        </ul>
    <div id="tabs-original"><?=$filingBody?></div>
    <div id="tabs-amended"><?=$amendBody?></div>
    <div id="tabs-redline">
        <div class="footerRight">
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
