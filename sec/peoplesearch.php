<html>
<head lang="en">
    <meta charset="UTF-8">
    <title>People Search Demo</title>
    <!--CSS files-->
    <!-- open source javascript libraries -->
    <script type="text/javascript" src="/sec/global/js/jquery/jquery-3.3.1.min.js"></script>

    <script language="JavaScript">
        $(document).ready(function() {
            $('#nomatches').hide();
            $('#searchCriteria').click(function(){searchForPeople($('#peoplesearch input[name="lastmiddlefirstname"]').val())});
            if($('#peoplesearch input[name="lastmiddlefirstname"]').val().trim().length != 0) $('#searchCriteria').click();
        });

        function searchForPeople(searchCriteria){
            //1. parse searchCriteria into last, middle, and first name
            var last, first, middle, parts;
            if(searchCriteria.indexOf(', ')!==-1){
                last = searchCriteria.trim().split(', ')[0];
                parts = searchCriteria.trim().split(', ')[1].split(' ');
                first = parts.length>0?parts[0]:null;
                middle = parts.length>1?parts[1]:null;
            } else {
                parts = searchCriteria.trim().split(' ');
                last = parts[0];
                first = parts.length>1?parts[1]:null;
                middle = parts.length>2?parts[2]:null;
            }
            //2. callApi command = searchNames
            callAPI({process: 'searchNames', last: last, first: first, middle: middle}, showSearchResults);
            //3. on callback
            function showSearchResults(data){
                //  a. clear tables
                $('#exactmatches tr:gt(1), #nearmatches tr:gt(1), #soundslike tr:gt(1)').remove();
                //  b. fill tables and show/hide if table has content/is empty;
                var rankTableMap = [null, 'exactmatches', 'nearmatches', 'nearmatches', 'soundslike'];
                var tableRows = {exactmatches:'', nearmatches: '', soundslike: ''};
                for(var i=0; i<data.matches.length;i++) {
                    var match = data.matches[i];
                    tableRows[rankTableMap[match.rank]] +=
                        '<tr><td><a href="https://www.sec.gov/cgi-bin/own-disp?action=getowner&CIK=' + match.cik +
                        '">' + match.cik + '</a></td><td>' + match.name + '</td></tr>';
                }
                for(var id in tableRows){
                    if(tableRows[id].length>0){
                        $('#'+id).find('tr:last').after(tableRows[id]).end().show();
                    } else {
                        $('#'+id).hide();
                    }
                }
                //  c. show/hide nomatches message if some/no rows returns
                if(data.matches.length==0) $('#nomatches').show(); else $('#nomatches').hide();
            }
        }

        function callAPI(params, callback, fail){
            $.ajax({
                data: params,
                dataType: 'JSON',
                type: 'post',
                url: '/sec/api.php',
                success: function (data, status) {
                    console.log('successfully ran command' + params.command);
                    callback(data);
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    if(fail){
                        fail(params);
                    } else {
                        console.log(textStatus);
                        throw(errorThrown);
                    }
                }
            });
        }
    </script>
</head>
<body>

<h2>People Search</h2>
<p>Searching people is different from a full text search and requires multiple matching criteria to be effective in finding matches and similar names.  This page searches the names from the insider ownership disclosure forms 3, 4, and 5 using the following algorithm:</p>
<ol>
    <li><b>exact matches:</b> Last, middle, and first names must match exactly.  Exact matches include matching first and middle initials with full names.  Omitted first and middle names from the search criteria will broaden the list exact matches.  If middle are submitted names are considered a match if the initials initials are matched against full first and middle name</li>
    <li><b>near matches:</b> Last must match exactly, but only first and middle initials are checked.  Mixing of middle </li>
    <li><b>similar name matches:</b> Finds persons whose last name's sounds like requested last name and either first or middle initials match.</li>
</ol>

<form id="peoplesearch">
    Last, Middle First: <input type="text" name="lastmiddlefirstname" value="<?PHP if(isset($_REQUEST['lastmiddlefirstname'])) echo $_REQUEST['lastmiddlefirstname'] ?>" autofocus pattern="[A-Za-z]+(,?/s[A-Za-z]+)?(/s[A-Za-z]+)?"></input>
    <button id="searchCriteria" type="button">search</button>
</form>
<p id="nomatches">No matches found.</p>
<table id="exactmatches" style="width:80%;">
    <tr>
        <th colspan="2">Matched search criteria</th>
    </tr>
    <tr>
        <th>CIK</th>
        <th>Name</th>
    </tr>
</table>
<table id="nearmatches" style="width:80%;">
    <tr>
        <th colspan="2">Near matches</th>
    </tr>
    <tr>
        <th>CIK</th>
        <th>Name</th>
    </tr>
</table>
<table id="soundslike" style="width:80%;">
    <tr>
        <th colspan="2">Similar sounding names</th>
    </tr>
    <tr>
        <th>CIK</th>
        <th>Name</th>
    </tr>
</table>
</body>
</html>



