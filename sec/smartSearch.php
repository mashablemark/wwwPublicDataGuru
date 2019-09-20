<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 8/30/2019
 * Time: 11:30 AM
 */


//1.get the sec's homepage HTML
$secPath = "https://www.sec.gov/";
$homepageHTML = httpGet($secPath);

//2. make image links absolute SEC
$homepageHTML = str_replace ( ' src="/', ' src="'.$secPath,  $homepageHTML);
$homepageHTML = str_replace ( ' href="/', ' href="'.$secPath,  $homepageHTML);
//$homepageHTML = str_replace ( ' src="/', ' src="'.$secPath,  $homepageHTML);

//3. insert smartSearch.js
$homepageHTML = str_replace ( '<head>', '<head>'
    . '<link  rel="stylesheet" href="global/js/jquery-ui/jquery-ui.css" />'
    . '<link  rel="stylesheet" href="global/js/loadmask/jquery.loadmask.css" />'
    . '<script type="text/javascript" src="global/js/jquery/jquery-3.3.1.min.js"></script>'
    . '<script type="text/javascript" src="global/js/jquery-ui/jquery-ui.min.js"></script>'
    . '<script type="text/javascript" src="global/js/loadmask/jquery.loadmask.min.js"></script>'
    . '<script src="js/smartSearch.js"></script>',  $homepageHTML);

//4. modify banner = not official site!
$homepageHTML = str_replace ( '<a href="https://www.sec.gov/" title="U.S. Securities and Exchange Commission" rel="home" tabindex="3">U.S. Securities and Exchange Commission</a>',
    '<a href="https://www.sec.gov/" title="U.S. Securities and Exchange Commission" rel="home" tabindex="3" style="color: red;">SEARCH DEMO: NOT OFFICIAL WEBSITE</a>', $homepageHTML);

$homepageHTML = str_replace ('<title>SEC.gov | HOME</title>', '<title>smart search prototype</title>', $homepageHTML);
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
