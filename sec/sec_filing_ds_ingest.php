<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 8/16/2018
 * Time: 2:29 PM
 */
include_once("global/php/common_functions.php");

?>

<!DOCTYPE html>
<html>
<head lang="en">
    <meta http-equiv=Content-Type content="text/html; charset=windows-1252">

    <!--meta charset="UTF-8"-->
    <title>Edgar Filing Ingest</title>

    <!--CSS files-->
    <link  rel="stylesheet" href="global/css/smoothness/jquery-ui-1.11.css?v=<?=$workbenchVersion?>" />
    <link rel="stylesheet" href="global/js/fancybox/jquery.fancybox-1.3.4.css" type="text/css">
    <link rel="stylesheet" href="global/js/fancybox/jquery.fancybox-1.3.4.css" type="text/css">
    <script type="text/javascript" src="global/js/jquery/jquery-3.3.1.min.js"></script>
    <script type="text/javascript" src="global/js/jquery-ui/jquery-ui.min.css"></script>

    <script type="text/javascript" src="global/js/fancybox/jquery.fancybox-1.3.4.pack.js"></script>
    <script type="text/javascript" src="global/js/highcharts/js/highcharts.3.0.10.min.js"></script>
    <script type="text/javascript" src="js/financial_statement_ingest.js"></script>
    <script type="text/javascript" src="global/js/require/require.2.1.1.js"></script>
</head>
<body>
<p><b>Downloads XBRL quarterly Financial Statement Data Sets from <a href="https://www.sec.gov/dera/data/financial-statement-data-sets.html">https://www.sec.gov/dera/data/financial-statement-data-sets.html</a> and ingest into a relational DB for stats and analytics.</b>
</p>
<div class="ingested">
    <table>
        <thead>
            <tr>
                <th>file</th>
                <th>size</th>
                <th>downloaded</th>
                <th>unarchived</th>
                <th>ingested</th>
            </tr>
        </thead>
        <tbody>
<?php
    $datasets = runQuery("select * from datasets");
    while ($aRow = $datasets->fetch_assoc()) {
?>
            <tr>
                <td class="name"><?= $aRow["name"] ?></td>
                <td class="size">size</td>
                <td class="downloaded"><?= $aRow["downloaded"] ?></td>
                <td class="unarchived"><?= $aRow["unarchived"] ?></td>
                <td class="ingested"><?= $aRow["ingested"] ?></td>
            </tr>
<?php
    }
?>
        </tbody>
    </table>
</div>
<div class="fileList">
    <?php
    $filingHTML = httpGet("https://www.sec.gov/dera/data/financial-statement-data-sets.html");
    $start = strpos($filingHTML, '<table class="list"');
    $end = strpos($filingHTML, '</table>', $start);
    if($start>0 && $end >$start) echo substr($filingHTML, $start, $end - $start + 8);
    ?>
</div>


</body>
</html>