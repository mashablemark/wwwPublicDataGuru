<!DOCTYPE html>
<html>
<head lang="en">
    <meta charset="UTF-8">
    <title>Edgar Bulk Archive Test Page</title>

    <!--CSS files-->
    <link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" type="text/css" />
    <!-- open source javascript libraries -->
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
</head>
<body>

<h2>tester of Lambda function <i>bulkSECArchiver</i></h2>

<textarea id="files" style="width: 1000px;height: 500px;">{
    "files": [
        "ownership/reporter/cik1178437",
        "ownership/reporter/cik1215126",
        "ownership/reporter/cik1035140",
        "ownership/reporter/cik1176442",
        "ownership/reporter/cik1224944",
        "ownership/reporter/cik1059235",
        "ownership/issuer/cik320193"
    ]
}
</textarea><br>
<button>fetch files</button>
<p>Fetches done in parallel.  Seven objects billed at 900ms.  74MB max memory used (out of 128MB Lambda config)</p>
<div id="results" style="border: thin solid black;">
</div>
</body>
<script language="JavaScript">
    $(document).ready(function() {
        $('button').click(function () {
            var params = $('textarea').text();
            console.time('ajax call');
            let start = new Date();
            $('#results').html('');
            $.ajax({
                data: params,
                dataType: 'JSON',
                type: 'post',
                url: 'https://bulk.publicdata.guru/zip/',
                success: function (data, status) {
                    let end = new Date();
                    console.log('successfully talked to Lambda function!');
                    console.timeEnd('ajax call');
                    $('#results').html(JSON.stringify(data));
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.log(textStatus);
                    throw(errorThrown);
                }
            });
        });
    });
</script>


