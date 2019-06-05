<?php
/**
 * Created by PhpStorm.
 * User: User
 * Date: 8/15/2018
 * Time: 4:33 PM
truncate table datasets;
truncate table eventlog;
truncate table f_sub;
truncate table f_tag;
truncate table f_num;
truncate table f_pre;
truncate table timeseries;
truncate table facts;
 *
 *
ALTER TABLE f_num ADD PRIMARY KEY (adsh, tag, version, ddate, qtrs, uom, coreg);
ALTER TABLE f_tag ADD PRIMARY KEY (tag, version);
ALTER TABLE f_sub ADD PRIMARY KEY (adsh);
ALTER TABLE f_tag ADD PRIMARY KEY (tag, version);
CREATE INDEX ix_ciktag ON f_num (cik, tag, uom);
 *
 * select * from f_tag where tag in (select `tag`  FROM `f_tag` group by `tag`, `version` having count(*)>1)
 */
$event_logging = true;
$sql_logging = true;
$ft_join_char = "_";
$web_root = "/var/www/html";
$localBulkFolder = "/var/www/bulkfiles/sec/"; //outside the webroot = cannot be surfed
$sec_uri = "https://www.sec.gov/";

$cacheRoot = "/var/www/vhosts/mashabledata.com/cache/";
$cache_TTL = 60; //public_graph and cube cache TTL in minutes

use Aws\S3\S3Client;
include_once($web_root . "/sec/global/php/common_functions.php");
date_default_timezone_set('UTC');
header('Content-type: text/html; charset=utf-8');

$time_start = microtime(true);
if(isset($_REQUEST['process']))
    $command =  $_REQUEST['process'];
else
    $command = "missing command";
switch($command) {
    case "addIxCikTag,Uom,Qtrs":
        break;
    case "lookupCompanies":
        $symbols = isset($_REQUEST["symbols"]) ? $_REQUEST["symbols"] : [];
        $ciks = isset($_REQUEST["ciks"]) ? $_REQUEST["ciks"] : [];
        $output = [
            "matches" => [],
            "status" => "success"
        ];
        if(count($symbols)){
            $sql = "select tk.cik, tk.ticker, sub.name, count(*), max(sub.fy) as lastfy from tickers tk "
                . " inner join f_sub sub on tk.cik = sub.cik "
                . " where tk.ticker in ('" . implode($symbols, "','") . "')"
                . " group by tk.cik, tk.ticker, sub.name "
                . " order by tk.cik ASC, lastfy DESC ";
            $result = runQuery($sql);
            $cik = null;
            while($row = $result->fetch_assoc()){
                if($row["cik"] != $cik){
                    $output["matches"][] = [$row["cik"], $row["ticker"], $row["name"]];
                }
                $cik = $row["cik"];
            }
        }
        if(count($ciks)){
            $sql = "select sub.cik, sub.name, count(*), max(sub.fy) as lastfy from f_sub sub "
                . " where sub.cik in (" . implode($ciks, ", ") . ")"
                . " group by sub.cik, sub.name "
                . " order by sub.cik ASC, lastfy DESC ";
            $result = runQuery($sql);
            $cik = null;
            while($row = $result->fetch_assoc()){
                if($row["cik"] != $cik){
                    $output["matches"][] = [$row["cik"], $row["cik"], $row["name"]];
                }
                $cik = $row["cik"];
            }
        }
        break;
    case "makeTimeSeries":
        $sql = <<<EOD
  SELECT cik, tag, uom, 0, GROUP_CONCAT(CONCAT("[",n.ddate, ",", n.value, ",'",n.adsh,"']") order by n.ddate asc, n.adsh desc SEPARATOR ',')
  FROM f_num n
  where n.version<>n.adsh and n.qtrs=0
  group by cik, tag, uom
  limit 10;
EOD;
        $result = runQuery($sql);
        if($result->num_rows > 0){
            $output = array("status" => "success", "rows" => $result->fetch_all());
        } else {
            $output = array("status" => "invalid table");
        }
        break;
    case "updateDb":
        $sql = "select * from datasets where name = '" . $_REQUEST['dir'] . "'";
        $result = runQuery($sql);
        if($result->num_rows==0){
            $sql = "insert into datasets (name, path) values ('".$_REQUEST['dir']."','".$_REQUEST['dir']."')";
            runQuery($sql);
        }
        $sql = "update datasets set path='".$_REQUEST['dir']."'";
        if(isset($_REQUEST['download'])) $sql .= ", downloaded='".$_REQUEST['download']."'";
        if(isset($_REQUEST['unzip'])) $sql .= ",unarchived='".$_REQUEST['unzip']."'";
        if(isset($_REQUEST['ingestState'])) $sql .= ",`ingested`='".$_REQUEST['ingestState']." ".$_REQUEST['ingest']."'";
        $sql .= " where name = '" . $_REQUEST['dir'] ."'";
        runQuery($sql);


        break;

    case "archiveToS3":  //sync to S3 and then delete to save space
        //for use with "aws configure" if necessary
        ////Access key id:  AKIAIMFWJ5CHZA56KQQQ
        //secret access key:  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
        //ran once: sudo chmod 771 /var/www/bulkfiles/sec/

        $syncOutput = [];
        $syncRet = 0;
        $syncCmd = "aws s3 sync $localBulkFolder s3://restapi.publicdata.guru/sec/filingdata";
        $syncOutput = exec($syncCmd, $syncOutput, $syncRet);

        $rmOutput = [];
        $rmRet = 0;
        $rmCmd = "sudo rm /var/www/bulkfiles/sec/* -f";
        $rmOutput  = exec($rmCmd, $rmOutput, $rmRet);

        $output = ["archive" => "downloaded",
            "status" => "success",
            "data" => [
                "sync" => $syncOutput,
                "syncode" => $syncRet,
                "rm" => $rmOutput,
                "rmcode" => $rmRet,
                "syncCmd" => $syncCmd
            ]
        ];
        break;
    case "fetchFile":
        set_time_limit(300);
        $archive = $_REQUEST['dir'];
        $cmd = "aws s3 cp s3://restapi.publicdata.guru/sec/filingdata/$archive.zip $localBulkFolder"; //fetch from S3 if exists
        shell_exec($cmd);
        if (!file_exists($localBulkFolder.$archive)) {
            mkdir($localBulkFolder.$archive, 0777, true);
        }
        if(file_exists($localBulkFolder.$archive.".zip")){
            $output = array("archive" => "exists (no download needed)", "status" => "success");
        } else {
            $fsec = @fopen($_REQUEST['fileURL'], 'r');
            //echo($_REQUEST['fileURL']);
            //echo($localBulkFolder.$_REQUEST['dir'].".zip");
            $fzip = @fopen($localBulkFolder.$_REQUEST['dir'].".zip", 'w');
            stream_copy_to_stream ($fsec, $fzip);
            fclose($fsec);
            fclose($fzip);
            $output = array("archive" => "downloaded", "status" => "success");
        }
        break;

    case "unzipFile":
        set_time_limit(300);
        $zip = new ZipArchive();
        if(!file_exists($localBulkFolder.$_REQUEST['dir'].".zip")){
            $output = array("status" => "invalid table");
            break;
        } //else die("file found");
        $zip->open($localBulkFolder.$_REQUEST['dir'].".zip");
        $zip->extractTo($localBulkFolder.$_REQUEST['dir']);
        $zip->close();
        //unlink($localBulkFolder.$datasetKey.".zip");  //delete the ZIP file after extracting its .txt files
        $output = array("status" => "success");
        break;

    case "removedUnzippedFiles":
        deleteDir($localBulkFolder.$_REQUEST['dir']);  //delete the ZIP file after extracting its .txt files
        break;

    case "ingestTable":  //because of dups, no longer dropping PK and using IGNORE direction in LOAD DATA FILE command
        set_time_limit(300);
        $table = $_REQUEST['ingest'];
        $file = preg_split("/_/", $table)[1];
        $sql = "LOAD DATA INFILE '".$localBulkFolder.$_REQUEST['dir']."/".$file.".txt' "." IGNORE INTO TABLE ".$table." FIELDS TERMINATED BY '\\t'  ESCAPED BY '' LINES TERMINATED BY '\\n' IGNORE 1 LINES;";
        //used to determine the presence of backslash = default escape char $sql = "LOAD DATA INFILE '".$localBulkFolder.$_REQUEST['dir']."/".$file.".txt' "." IGNORE INTO TABLE ".$table."_raw FIELDS TERMINATED BY '\\b' ESCAPED BY '' LINES TERMINATED BY '\\n' IGNORE 1 LINES;";
        runQuery($sql);
        $output = array("status" => "success");
        break;

    /*USE STORED PROCEDURES IN addFilingIndexes AND dropFilingIndexes INSTEAD of loops
    note: the following procedures are for f_* tables.  Primary keys for fn_* tables are:
        $sql = "ALTER TABLE fn_sub ADD PRIMARY KEY (adsh);";
        $sql = "ALTER TABLE fn_tag ADD PRIMARY KEY (tag, version);";
        $sql = "ALTER TABLE fn_dim ADD PRIMARY KEY (dimh);";
        $sql = "ALTER TABLE fn_num ADD PRIMARY KEY (adsh, tag, version, ddate, qtrs, uom, dimh, iprx);";
        $sql = "ALTER TABLE fn_txt ADD PRIMARY KEY (adsh, tag, version, ddate, qtrs, iprx, dimh);";
        $sql = "ALTER TABLE fn_ren ADD PRIMARY KEY (adsh, report);";
        $sql = "ALTER TABLE fn_pre ADD PRIMARY KEY (adsh, report, line);";
        $sql = "ALTER TABLE fn_cal ADD PRIMARY KEY (adsh, grp, arc);";    */
        case "addFilingIndexes":
            $sql = "CALL addFilingIndexes()";
            runQuery($sql);
            $output = array("status" => "success");
            break;
        case "dropFilingIndexes":
            $sql = "CALL dropFilingIndexes()";
            runQuery($sql);
            $output = array("status" => "success");
            break;

    case "timeseries":
        $cik = substr($_REQUEST['c'],3);
        $tag = $_REQUEST['t'];
        $sql = "select * from timeseries where cik=$cik and tag='$tag'";
        $result = runQuery($sql);
        if($result->num_rows>0){
            $ts = [];
            while($row = $result->fetch_assoc()) {
                if (!isset($ts[$row["uom"]])) $ts[$row["uom"]] = [];
                $ts[$row["uom"]] += ["Q".(string)$row["qtrs"] => json_decode($row["json"], false)]; //STRICT JSON DECODING REQUIRES DOUBLE QUOTES
                $lastRow = $row;
            }
            $output = ["status" => "success",
                $tag => [
                    $_REQUEST['c'] => ["units" => $ts],
                    "label" => jString($lastRow["tlabel"]),
                    "desc" => jString($lastRow["doc"]),
                    "name" => jString($lastRow["coname"]),
                    //"ts" => json_decode($lastRow["json"], true),
                    //"raw" => $lastRow["json"]

                ]
            ];

        } else {
            $output = array("status" => "success", "timeseries" => false);
        }
        break;
    case "frames":
        $tag = $_REQUEST['t'];
        $uom = $_REQUEST['u'];
        $qtrs = $_REQUEST['q'];
        $ddate = $_REQUEST['d'];
        $sql = "select tag, ddate, uom, qtrs, tlabel as label, tdoc as 'desc', json "
        . " from frames where tag='$tag' and uom='$uom' and qtrs = $qtrs and ddate='$ddate'";

        $result = runQuery($sql);
        if($result->num_rows==1){
            $output = $result->fetch_assoc();
            $output["status"] = "success";
            $text = str_replace("NULL", "null", $output["json"]);
            $output["data"] = json_decode($text, false); //STRICT JSON DECODING REQUIRES DOUBLE QUOTES
            unset($output["json"]);
            unset($output["apistatus"]);
        } else {
            $output = array("status" => "success", "frame" => false);
        }
        break;
    case "reporter":
        $cik = $_REQUEST['cik'];
        $sql = <<<EOL
select s.adsh, s.issuercik, s.issuername, s.symbol, s.form, s.reportdt, s.filedt, s.symbol, 
  r.ownernum, r.ownercik, r.ownername, r.isdirector, r.isofficer, r.istenpercentowner, r.ownerstreet1, r.ownerstreet2, r.ownercity,r.ownerstate, r.ownerzip,
  t.transnum, t.transdt, t.transcode, t.isderivative, t.security, t.shares, t.sharesownedafter, t.directindirect, t.deemeddt, t.acquiredisposed
from ownership_submission s
  INNER JOIN ownership_reporter r on r.adsh = s.adsh
  INNER JOIN ownership_transaction t on t.adsh = s.adsh
WHERE r.ownercik='$cik'
ORDER BY coalesce(t.transdt, t.deemeddt, s.filedt) desc, s.filedt desc
EOL;
        $result = runQuery($sql);
        if($result->num_rows==0) {
            $output = ["status" => "reporter cik ".$_REQUEST['cik']."not found"];
            break;
        }
        $output = [
            "dataset" => "reported transactions",
            "view" => $_REQUEST['process'],
            "status" => "ok",
            "reporter" => false,
            "transactions" => [],
            "issuers" => []
        ];
        while($row = $result->fetch_assoc()) {
            if(!$output["reporter"]  || $output["reporter"]["filedt"]<$row["filedt"]){
                $output["reporter"] = [
                    "filedt" => $row["filedt"],
                    "rcik" => $row["ownercik"],
                    "name" => $row["ownername"],
                    "street1" => $row["ownerstreet1"],
                    "street2" => $row["ownerstreet2"],
                    "city" => $row["ownercity"],
                    "state" => $row["ownerstate"],
                    "zip" => $row["ownerzip"],
                ];
            }
            array_push($output["transactions"], [
                $row["form"],
                $row["adsh"],
                $row["transnum"],
                $row["transcode"],
                $row["acquiredisposed"],
                $row["directindirect"],
                $row["transdt"],
                $row["deemeddt"],
                $row["filedt"],
                $row["issuername"],
                $row["issuercik"],
                $row["shares"],
                $row["sharesownedafter"],
                $row["security"]
            ]);
            //if(!$output["issuers"][$row["issuercik"]]) $output["issuers"][$row["issuercik"]] = $row["issuername"];
        }
        break;
    case "issuer":
        $cik = $_REQUEST['cik'];
        $sql = <<<EOL
      select s.adsh, s.issuercik, s.issuername, s.symbol, s.form, s.reportdt, s.filedt, s.symbol, 
          r.ownernum, r.ownercik, r.ownername, r.isdirector, r.isofficer, r.istenpercentowner, 
          t.transnum, t.transdt, t.transcode, t.isderivative, t.shares, t.sharesownedafter, t.directindirect, t.deemeddt, t.acquiredisposed, t.security
      from ownership_submission s
          INNER JOIN ownership_reporter r on r.adsh = s.adsh
          INNER JOIN ownership_transaction t on t.adsh = s.adsh
      WHERE s.issuercik='$cik'
      order by transdt desc, transnum asc
EOL;
        //note: issuer address is not in 3/4/5 forms (reporter address is); must get from company table
        $result = runQuery($sql);
        $transactions = [];
        //$issuers = [];  //normalized to shrink transactions size
        $output = false;  //set on first row with status and header fields

        $output = [
            "dataset" => "reported transactions",
            "view" => $_REQUEST['process'],
            "status" => "ok",
            "issuer" => false,
            "transactions" => [],
            "reporters" => []
        ];
        while($row = $result->fetch_assoc()) {
            if(!$output["issuer"]  || $output["issuer"]["filedt"]<$row["filedt"]){
                $output["reporter"] = [
                    "filedt" => $row["filedt"],
                    "icik" => $row["issuercik"],
                    "name" => $row["issuername"],
                    /*"street1" => $row["ownerstreet1"],
                    "street2" => $row["ownerstreet2"],
                    "city" => $row["ownercity"],
                    "state" => $row["ownerstate"],
                    "zip" => $row["ownerzip"],*/
                ];
            }
            array_push($transactions, [
                $row["form"],
                $row["adsh"],
                $row["transnum"],
                $row["transcode"],
                $row["acquiredisposed"],
                $row["directindirect"],
                $row["transdt"],
                $row["deemeddt"],
                $row["filedt"],
                $row["ownername"],
                $row["ownercik"],
                $row["shares"],
                $row["sharesownedafter"],
                $row["security"]
            ]);
        }
        $output["transactions"] = $transactions;
        break;

    case "searchNames":
        $sql = "call searchNames(" . safeStringSQL( $_REQUEST['last']) . ", "
            . safeStringSQL( $_REQUEST['first']) . ", " . safeStringSQL( $_REQUEST['middle']) . ");";
        $result = runQuery($sql);
        $output = [
            "status" => "ok",
            "matches" => $result->fetch_all(MYSQLI_ASSOC)
            ];
        break;
    case "getSubmissionFilesToTestS3":
        $adsh = $_REQUEST['adsh'];
        $parts = explode("-", $adsh);
        $edgar_root ="https://www.sec.gov/Archives/edgar/data/";
        //1. get header.index
        $submission_path = intval($parts[0]) . "/" . implode("", $parts) ."/";
        $header_filename = $adsh . "-index-headers.html";
        $header_contents = httpGet($edgar_root . $submission_path  . $header_filename);
        //echo($edgar_root . $submission_path  . $header_filename);
        $files = preg_match_all('/<a href="\S+\.(xml|html|htm)"/', $header_contents, $matches);
        $searches = [];
        $returnString = '';
        for($i = 0; $i < count($matches[0]); ++$i) {
            $filename_pos = strpos($header_contents, $matches[0][$i]);
            $desc_pos = strrpos($header_contents, "&lt;DOCUMENT&gt;", -strlen($header_contents)+$filename_pos);
            $idea_doc = strpos(substr($header_contents, $desc_pos, $filename_pos-$desc_pos),"IDEA: XBRL DOCUMENT" );
            /*array_push($searches, [
                "file" =>  $matches[0][$i],
                "filename_pos" =>  $filename_pos,
                "desc_pos" =>  $desc_pos,
                "idea_doc" =>  $idea_doc

            ])*/;
            if(!$idea_doc) {
                $filename = substr($matches[0][$i], 9, strlen($matches[0][$i])-9-1);
                //downloadToS3($edgar_root . $submission_path . $filename, $submission_path . $filename);
                //downloadToS3 created in case CURL did not work.  Problem was S3 credentials and config files needed in /usr/share/httpd/.aws (from ~/.aws)
                $cmd = 'curl "'. $edgar_root . $submission_path . $filename . '" | aws s3 cp - s3://restapi.publicdata.guru/sec/edgar/data/' . $submission_path . $filename;
                logEvent("getSubmissionFilesToTestS3", $cmd);
                shell_exec($cmd);
                $returnString .= $edgar_root . $submission_path . $filename . ' to  s3://restapi.publicdata.guru/sec/edgar/' . $submission_path . $filename.'<br>';
            }

        }
        //downloadToS3($edgar_root . $submission_path . $header_filename, $submission_path . $header_filename);
        $cmd = 'curl "'. $edgar_root . $submission_path . $header_filename . '" | aws s3 cp - s3://restapi.publicdata.guru/sec/edgar/data/' . $submission_path . $header_filename;
        shell_exec($cmd);
        $returnString .= $cmd;
        $output = [
            "status" => "ok",
            "headerbody" => $returnString
        ];
        break;
    default:
        $output = array("status" => "invalid command");
}
$time_elapsed =  (microtime(true) - $time_start)*1000;
$output["exec_time"] = $time_elapsed . 'ms';
$output["command"] = $command;
echo json_encode($output);
closeConnection();

function jString($var){
    return str_replace('\\', "\\\\", str_replace('"', '"""', $var));
}
function downloadToS3($sourceURL, $S3Path){
    global $localBulkFolder;
    //download the web resource to local file (S3 cp source can be S3 or EC2 file, but not a web resource)
    $fsec = @fopen($sourceURL, 'r');
    $ftmp = @fopen($localBulkFolder."tmp", 'w');
    stream_copy_to_stream ($fsec, $ftmp);
    fclose($fsec);
    fclose($ftmp);
    //cp the tmp file to S3 destination (correct file path and name)
    $s3cmd = "aws s3 cp ".$localBulkFolder."tmp s3://restapi.publicdata.guru/sec/edgar/".$S3Path." --profile default 2>&1";
    logEvent("downloadToS3", $s3cmd);
    //note:  for php to have access to S3, credentials and config file must be copied from ~/.aws to /usr/share/httpd/.aws!!!
    exec($s3cmd, $output);
}
