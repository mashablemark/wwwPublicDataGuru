<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 8/30/2019
 * Time: 11:30 AM
 */


//1.get the sec's homepage HTML
$secPath = "https://www.sec.gov/";
$target = $secPath."cgi-bin/browse-edgar?action=getcompany&CIK=".$_REQUEST["CIK"];
$homepageHTML = httpGet($target);

//2. make image links absolute SEC
$homepageHTML = str_replace ( ' src="/', ' src="'.$secPath,  $homepageHTML);
$homepageHTML = str_replace ( ' href="/', ' href="'.$secPath,  $homepageHTML);
//$homepageHTML = str_replace ( ' src="/', ' src="'.$secPath,  $homepageHTML);

//3. insert search.js
$homepageHTML = str_replace ( '<head>', '<head>'
    . '<link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" />'
    //. '<script type="text/javascript" src="/sec/global/js/jquery/jquery-3.3.1.min.js"></script>'
    //. '<script type="text/javascript" src="/global/js/jqueryui/jquery-ui.min.js"></script>'
    . '<script src="js/smartSearchCompanyLanding.js"></script>',  $homepageHTML);

//4. modify banner = not official site!
$homepageHTML = str_replace ( '<div id="secWordGraphic"><img src="https://www.sec.gov/images/bannerTitle.gif" alt="SEC Banner" />',
    '<div id="secWordGraphic" style="width:800px;margin-right:120px;"><span style="color:red; font-size: 24px;"><b>SEARCH TEST PAGE: NOT AN OFFICIAL GOVERNMENT WEBSITE</b></span>', $homepageHTML);

//$homepageHTML = str_replace ('<title>SEC.gov | HOME</title>', '<title>smart search prototype</title>', $homepageHTML);
//return the edited HTML
echo $homepageHTML;

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
