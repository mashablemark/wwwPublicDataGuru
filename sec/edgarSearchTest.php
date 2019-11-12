<!DOCTYPE html>
<html>
<head lang="en">
    <meta charset="UTF-8">
    <title>Edgar Full Text Search Test Page</title>

    <!--CSS files-->
    <link  rel="stylesheet" href="/global/js/jqueryui/jquery-ui.css" type="text/css" />
    <!-- open source javascript libraries -->
    <script type="text/javascript" src="/global/js/jquery/jquery-3.3.1.min.js"></script>
</head>
<body>

<h2>tester of Lambda function <i>bulkSECArchiver</i></h2>

<textarea id="files" style="width: 1000px;height: 500px;">{
    "q": "iphone brexit",
    "cik": "",
    "forms": [],
    "sic": "",
    "startdt": "",
    "enddt": ""
}
</textarea><br>
<button>execute search</button>
<p>results</p>
<div id="results" style="border: thin solid black;">
</div>
</body>
<script language="JavaScript">
    $(document).ready(function() {
        $('button').click(function () {
            var params = $('textarea').val();
            console.time('ajax call');
            let start = new Date();
            $('#results').html('');
            $.ajax({
                data: params,
                dataType: 'JSON',
                type: 'post',
                url: 'https://search.publicdata.guru/edgar',
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


