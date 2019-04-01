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
        "ownership/reporter/cik1224944",
        "ownership/reporter/cik1059235",
        "ownership/issuer/cik320193"
    ]
}
</textarea><br>
<button>fetch files</button>

<div id="results">
</div>
</body>
<script language="JavaScript">
    $(document).ready(function() {
        $('button').click(function () {
            var params = $('textarea').text();
            $.ajax({
                data: params,
                dataType: 'JSON',
                type: 'post',
                url: 'https://bulk.publicdata.guru/zip/',
                success: function (data, status) {
                    console.log('successfully talked to Lambda function!');
                    console.log(data);
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.log(textStatus);
                    throw(errorThrown);
                }
            });
        });
    });
</script>


