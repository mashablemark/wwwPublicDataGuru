<?php
$edgarPath = 'https://www.sec.gov/Archives/edgar/data/';
$cik = $_REQUEST['cik'];
$accnA = $_REQUEST['b'];
$accnB = $_REQUEST['a'];
$indexHeaderA = httpGet($edgarPath . $cik . "/".str_replace("-","", $accnA)."/".$accnA."-index-headers.html");
$indexHeaderB = httpGet($edgarPath . $cik . "/".str_replace("-","", $accnB)."/".$accnB."-index-headers.html");

$A = parseIndexHeader($indexHeaderA);
$B = parseIndexHeader($indexHeaderB);

$urlA = $cik . "/".str_replace("-","", $accnA)."/" . $A["fileName"];
$urlB = $cik . "/".str_replace("-","", $accnB)."/" . $B["fileName"];

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
    <!-- open source javascript libraries -->
    <script type="text/javascript" src="js/wikEdDiff.js"></script>
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>
    <style>
        div.scrollpanel{
            overflow-y: scroll;
        }
        div.framepanel{
            padding: 0;
        }
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
    </style>
</head>
<body>
<div id="tabs" style="width:80%;">
    <!--button class="compare">compare</button-->
    <!---ul>
          <li><a href="#tabs-A"><?=$A["description"].' filed '.$A["filed"]?></a></li>
          <li><a href="#tabs-B"><?=$B["description"].' filed '.$B["filed"]?></a></li>
          <li><a href="#tabs-redline">Difference</a></li>
        </ul>
    <div id="tabs-A" class="framepanel"><iframe id="iframe-A" src="viewer.php?f=true&doc=<?= $urlA?>" onload="iframeLoaded()"></iframe></div>
    <div id="tabs-B" class="framepanel"><iframe id="iframe-B" src="viewer.php?f=true&doc=<?= $urlB ?>" onload="iframeLoaded()"></iframe></div>
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
    </div-->
</div>
</body>

<script language="JavaScript">
    var docA = false,
        docB = false,
        page = 'viewer.php?f=true&doc=',
        urlA = page + '<?=$urlA?>',
        urlB = page + '<?=$urlB?>',
        rxBlockTags = /(<(tr|p|div)([^>]+)>)/ig,
        rxAllTags = /(<([^>]+)>|&nbsp;)/ig,
        rxIXHeader = /<ix:header[\s\S]+\/ix:header>/ig,
        rxCR = /\n/g;
    $(document).ready(function() {
        //$('#tabs').tabs();
        //$('div.scrollpanel, div.framepanel').height(window.innerHeight-$('ul.ui-tabs-nav').outerHeight()-25);
        $.ajax({
            url: urlA,
            dataType: 'text',
            success: function(data){
                docA = data.replace(rxIXHeader,' ').replace(rxCR,' ').replace(rxBlockTags,'\n').replace(rxAllTags,' ');
                if(docB) compare();
            }
        });
        $.ajax({
            url: urlB,
            dataType: 'text',
            success: function(data){
                docB = data.replace(rxIXHeader,' ').replace(rxCR,' ').replace(rxBlockTags,'\n').replace(rxAllTags,' ');
                if(docA) compare()
            }
        });
    });
    function compare(){
        // calculate the diff on load
        /* for (var option = 0; option < WikEdDiffTool.options.length; option ++) {
             wikEdDiffConfig[ WikEdDiffTool.options[option] ] = (document.getElementById(WikEdDiffTool.options[option]).checked === true);
         }
         wikEdDiffConfig.blockMinLength = parseInt(document.getElementById('blockMinLength').value);
         wikEdDiffConfig.unlinkMax = parseInt(document.getElementById('unlinkMax').value);
         wikEdDiffConfig.recursionMax = parseInt(document.getElementById('recursionMax').value);*/

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
            showBlockMoves: false,
            stripTrailingNewline: false,
            timer: false,
            unitTesting: false,
            unlinkBlocks: false,
            unlinkMax: 20
        };
        var wikEdDiff = new WikEdDiff();
        var diffHtml = wikEdDiff.diff(docA, docB);
        document.getElementById('tabs').innerHTML = diffHtml;
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
    return [
        "fileName" => getFirst($body, '&lt;FILENAME&gt;'),
        "filed" => getFirst($body, '<FILING-DATE>'),
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
