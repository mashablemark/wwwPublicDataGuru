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
if(isset($_REQUEST["t"]) && strpos($doc, "-index")){
    //ADSH index page
    $target = $edgarPath.$doc;
    $body = httpGet($target.".htm");
    $sIxSig = "/ix?doc=/Archives/edgar/data/";
    $ixPos = strpos($body, $sIxSig);
    if($ixPos){
        //load the iXBRL document into the viewer and have ixbrl_viewer.js navigate to the fact
        $ixbrlDoc = substr($body, $ixPos + strlen($sIxSig), strpos($body, '.htm', $ixPos) - $ixPos - strlen($sIxSig));
        echo iXbrlInjector($ixbrlDoc);
    } else {
        $body = str_replace('href="/', 'href="'.$secPath.'/', $body);
        $body = str_replace('src="/', 'src="'.$secPath.'/', $body);
        echo $body;
    }
} elseif($doc=="table") {
    global $secPath;
    $target = $secPath . "/cgi-bin/own-disp?action=getissuer&CIK=0000027996";
    $body = httpGet($target);
    //show the index page after repointing links to the real SEC
    $body = str_replace('href="/', 'href="'.$secPath.'/', $body);
    $body = str_replace('src="/', 'src="'.$secPath.'/', $body);
    $scripts = '<link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" />'
        . '<link rel="stylesheet" href="/global/js/fancybox-master/dist/jquery.fancybox.min.css" type="text/css">'
        . '<link rel="stylesheet" href="/css/jquery-jvectormap-2.0.1.css" type="text/css">'
        . '<link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/v/dt/dt-1.10.18/datatables.min.css"/>'
        . '<link rel="stylesheet" href="css/viewer.css" type="text/css">'
        . '<script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>'
        . '<script type="text/javascript" src="https://cdn.datatables.net/v/dt/dt-1.10.18/datatables.min.js"></script>'
        . '<script type="text/javascript" src="js/tabler.js"></script>';
    $html = str_replace("<head>", "<head>".$scripts, $body);
    echo $html;
} else {
    echo iXbrlInjector($doc);
}

function iXbrlInjector($doc){
    //iBXRL doc
    global $edgarPath, $secPath;
    $target = $edgarPath.$doc.".htm";
    $body = httpGet($target);
    $body = str_replace('href="/', 'href="'.$secPath.'/', $body);
    $body = str_replace('src="/', 'src="'.$secPath.'/', $body);
    $scripts = '<link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" />'
        . '<link rel="stylesheet" href="/global/js/fancybox-master/dist/jquery.fancybox.min.css" type="text/css">'
        . '<link rel="stylesheet" href="/css/jquery-jvectormap-2.0.1.css" type="text/css">'
        . '<link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/v/dt/dt-1.10.18/datatables.min.css"/>'
        . '<link rel="stylesheet" href="css/viewer.css" type="text/css">'
        . '<script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>'
        . '<script type="text/javascript" src="/global/js/highcharts/js/highcharts.js"></script>'
        . '<script type="text/javascript" src="/global/js/highcharts/js/modules/exporting.js"></script>'
        . '<script type="text/javascript" src="/global/js/jvectormap/jquery-jvectormap-2.0.1.min.js"></script>'
        . '<script type="text/javascript" src="/global/js/maps/us_aea_en.js"></script>'
        . '<script type="text/javascript" src="/global/js/fancybox-master/dist/jquery.fancybox.min.js"></script>'
        . '<script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>'
        . '<script type="text/javascript" src="https://cdn.datatables.net/v/dt/dt-1.10.18/datatables.min.js"></script>'
        . '<script type="text/javascript" src="/global/js/signals/signals.js"></script>'
        . '<script type="text/javascript" src="/global/js/hasher/hasher.min.js"></script>'
        . '<script type="text/javascript" src="js/ixbrl_viewer.js"></script>';
    $html = str_replace("<head>", "<head>".$scripts, $body);
    return $html;
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

