<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 10/26/2018
 * Time: 3:14 PM
 */
$doc = $_REQUEST["f"];
if(isset($_REQUEST["repoint"]) && $_REQUEST["repoint"]=='true') {
    $repoint = true;
} else {
    $repoint = false;
}
$secPath = "https://www.sec.gov/";
$edgarPath = $secPath . "Archives/edgar/data/";
$urlParts = explode('/', $doc);
array_pop($urlParts);
$docPath = implode('/', $urlParts);
$body = httpGet( $doc);
echo $repoint ? repointHyperlinks($body): $body;

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
    global $secPath, $docPath;
    //repoint source file relative links (e.g. local images) to SEC
    $repointedHTML = preg_replace('/src="(\w+)/', 'src="' . $docPath. '/${1}', $html);
    $repointedHTML = str_replace('href="/', 'href="' . $secPath . '/', $repointedHTML);
    $repointedHTML = str_replace('src="/', 'src="' . $secPath . '/', $repointedHTML);
    $repointedHTML = str_replace('img="/', 'src="' . $secPath . '/', $repointedHTML);
    return $repointedHTML;
}