"use strict";

var entity = false;  //holds the entity info once selected
var categories = {};
var edgarLocations = {};

$(document).ready(function() {
    $('[data-toggle="tooltip"]').tooltip({classes: {"ui-tooltip":"popover"}});
    const hashValues = getHashValues();
    //load the state / locations drop down

    setDatesFromRange();

    //configure company hints event on both keywords and company text boxes
    $('#keywords').keyup(function(event){
        const keywords = $(this).val();
        if(keywords.length<=15 && !entity){
            getCompanyHints(this, keywords)
        }
        if(keywords.length>15) hideCompanyHints()
    });
    $('#company').keyup(function(event){
        getCompanyHints(this, $(this).val())
    });

    //create the form categories from the forms array
    for(let i in forms){
        if(forms[i].category){
            if(!categories[forms[i].category]) categories[forms[i].category] = [];
            categories[forms[i].category].push(forms[i].form);
        }
    }
    //load form categories and configure selection event
    let categoryOptions = ['<option value="all" selected>View All</option>'];
    for(let cat in categories){
        categoryOptions.push('<option value="'+categories[cat].join(' ')+'">'+cat+'</option>');
    }
    categoryOptions.push('<option value="custom">User Defined</option>');

    const $filingTypes = $('#filing-types');
    const $category = $('#category-select') 
        .html(categoryOptions.join(''))
        .change(function(event){
            if($(this).val() !='custom') $filingTypes.val($category.val());
        });

    //configure the forms text event
    $filingTypes.keyup(function(){
        $category.prop('selectedIndex',categoryOptions.length-1);  //custom
    });

    //load locations selector and configure selection event
    const $locations = $('#location-select');
    const locationOptions = ['<option value="" selected>View All</option>'];
    for(let i=0;i<locationsArray.length;i++){
        locationOptions.push('<option value="'+locationsArray[i][0]+'">'+locationsArray[i][1]+'</option>');
        edgarLocations[locationsArray[i][0]] = locationsArray[i][1];
    }
    $locations.html(locationOptions.join(''));

    //configure date range buttonSet
    var $dateRangeSelect = $('#date-range-select').change(setDatesFromRange);
    //configure datapickers
    $('.datapicker input').datepicker({
        changeMonth: true,
        changeYear: true,
        minDate: "-2M",  //"-10Y" for production
        maxDate: 0
    });

    $('#date-from, #date-to').keyup(function(){$dateRangeSelect.val('custom')});

    $('#search').click(executeSearch);

    function setDatesFromRange(){
        var startDate = new Date(),
            endDate = new Date();
        switch($('#date-range-select').val()){
            case '30d':
                endDate.setDate(endDate.getDate()-30);
                break;
            case "1y":
                endDate.setDate(endDate.getDate()-30);
                break;
            case "5y":
                endDate.setDate(endDate.getDate()-30);
                break;
            case "all":
                endDate = new Date('1994-01-01');
                break;
            case "custom":
                return;
        }
        $('#date-from').val(startDate.toLocaleDateString());
        $('#date-to').val(endDate.toLocaleDateString());
    }
});

function getHashValues(){

}

function setHashValues(){
    let formValues = {
        q: $('#keywords').val(),
        dateRange: $('#date-range').find(':checked').val(),
        startdt: $('#datepicker_from').val(),
        enddt: $('#datepicker_to').val(),
        category: $('#category-select').val(),
        cik: entity?entity.cik:false,
        entityName: $('#company').val(),
        forms: $('#filing-types').val().replace(/[/s;,+]+/i,',').trim().split(',')
    };
    let hashValues = [];
    for(let p in formValues){
        if(formValues[p]) hashValues.push(p+'='+encodeURIComponent(formValues[p]));
    }
    hasher.changed.active = false; //disable changed signal
    hasher.setHash(hashValues.join('&')); //set hash without dispatching changed signal
    hasher.changed.active = true; //re-enable signal
    return formValues;
}

function getCompanyHints(control, keysTyped){
    const hintsURL = 'https://search.publicdata.guru/typing-hints';
    const label = 'ajax call to ' + hintsURL + ' for "' + keysTyped + '"';
    console.time(label);
    var start = new Date();
    $('#results').html('');
    $.ajax({
        data: JSON.stringify({keysTyped: keysTyped}),
        dataType: 'JSON',
        type: 'POST',
        url: hintsURL,
        success: function (data, status) {
            let end = new Date();
            console.timeEnd(label);
            console.log('round-trip execution time for '+hintsURL+ ' = '+((new Date()).getTime()-start.getTime())+' ms');
            console.log(data);
            var hints = data.branchTopHints;
            if(data.cikMatch) hints.unshift({CIK:data.cikMatch, entity: cikMatchName, tickers: cikMatchTickers});
            var hintDivs = [];
            var processedCIKs = [];
            var rgxKeysTyped = new RegExp('('+keysTyped.trim()+')','i');
            if(hints.length){
                for(var h=0;h<hints.length;h++){
                    if(processedCIKs.indexOf(hints[h].CIK)==-1){
                        hintDivs.push('<tr class="hint" data="'+hints[h].CIK+'"><td class="hint-entity">'
                            +((hints[h].entity||'')+(hints[h].tickers?' ('+hints[h].tickers+')':'')).replace(rgxKeysTyped, '<b>$1</b>')
                            + '</td><td class="hint-cik">' + ((' <i>CIK '+hints[h].CIK+'</i>')||'')+'</td></tr>');
                        processedCIKs.push(hints[h].CIK)
                    }
                }
                $('table.entity-hints').html(hintDivs.join('')).show().find('tr.hint').click(function(evt){hintClicked(this)});
                $('div.entity-hints').show();
            } else {
                $('div.entity-hints').hide();
            }
            $('#results').html(JSON.stringify(data));
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.log(textStatus);
            throw(errorThrown);
        }
    });
}

function hintClicked(row){
    $('div.entity-hints').hide();
    var $row = $(row);
    entity = {
        cik: $row.attr('data'),
        name: $row.find('.hint-entity').html().replace(/<\/?b>/gi, '')
    };
    $('#company').val(entity.name);
}
function hideCompanyHints(){
    $('#company-hints').hide();
}

function executeSearch(){
    const label = 'EFTS ajax call';
    console.time(label);
    var start = new Date();
    $('#results').html('');
    $.ajax({
        data: JSON.stringify(setHashValues()),
        dataType: 'JSON',
        type: 'POST',
        url: 'https://search.publicdata.guru/search-index',
        success: function (data, status) {
            let end = new Date();
            console.log('successfully talked to Lambda function!');
            console.timeEnd(label);
            $('#results').html(JSON.stringify(data));
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.log(textStatus);
            throw(errorThrown);
        }
    });
}

const locationsArray = [
    ["AL","Alabama"],
    ["AK","Alaska"],
    ["AZ","Arizona"],
    ["AR","Arkansas"],
    ["CA","California"],
    ["CO","Colorado"],
    ["CT","Connecticut"],
    ["DE","Delaware"],
    ["DC","District of Columbia"],
    ["FL","Florida"],
    ["GA","Georgia"],
    ["HI","Hawaii"],
    ["ID","Idaho"],
    ["IL","Illinois"],
    ["IN","Indiana"],
    ["IA","Iowa"],
    ["KS","Kansas"],
    ["KY","Kentucky"],
    ["LA","Louisiana"],
    ["ME","Maine"],
    ["MD","Maryland"],
    ["MA","Massachusetts"],
    ["MI","Michigan"],
    ["MN","Minnesota"],
    ["MS","Mississippi"],
    ["MO","Missouri"],
    ["MT","Montana"],
    ["NE","Nebraska"],
    ["NV","Nevada"],
    ["NH","New Hampshire"],
    ["NJ","New Jersey"],
    ["NM","New Mexico"],
    ["NY","New York"],
    ["NC","North Carolina"],
    ["ND","North Dakota"],
    ["OH","Ohio"],
    ["OK","Oklahoma"],
    ["OR","Oregon"],
    ["PA","Pennsylvania"],
    ["RI","Rhode Island"],
    ["SC","South Carolina"],
    ["SD","South Dakota"],
    ["TN","Tennessee"],
    ["TX","Texas"],
    ["X1","United States"],
    ["UT","Utah"],
    ["VT","Vermont"],
    ["VA","Virginia"],
    ["WA","Washington"],
    ["WV","West Virginia"],
    ["WI","Wisconsin"],
    ["WY","Wyoming"],
    ["A0","Alberta, Canada"],
    ["A1","British Columbia, Canada"],
    ["Z4","Canada (Federal Level)"],
    ["A2","Manitoba, Canada"],
    ["A3","New Brunswick, Canada"],
    ["A4","Newfoundland, Canada"],
    ["A5","Nova Scotia, Canada"],
    ["A6","Ontario, Canada"],
    ["A7","Prince Edward Island, Canada"],
    ["A8","Quebec, Canada"],
    ["A9","Saskatchewan, Canada"],
    ["B0","Yukon, Canada"],
    ["B2","Afghanistan"],
    ["Y6","Aland Islands"],
    ["B3","Albania"],
    ["B4","Algeria"],
    ["B5","American Samoa"],
    ["B6","Andorra"],
    ["B7","Angola"],
    ["1A","Anguilla"],
    ["B8","Antarctica"],
    ["B9","Antigua and Barbuda"],
    ["C1","Argentina"],
    ["1B","Armenia"],
    ["1C","Aruba"],
    ["C3","Australia"],
    ["C4","Austria"],
    ["1D","Azerbaijan"],
    ["C5","Bahamas"],
    ["C6","Bahrain"],
    ["C7","Bangladesh"],
    ["C8","Barbados"],
    ["1F","Belarus"],
    ["C9","Belgium"],
    ["D1","Belize"],
    ["G6","Benin"],
    ["D0","Bermuda"],
    ["D2","Bhutan"],
    ["D3","Bolivia"],
    ["1E","Bosnia and Herzegovina"],
    ["B1","Botswana"],
    ["D4","Bouvet Island"],
    ["D5","Brazil"],
    ["D6","British Indian Ocean Territory"],
    ["D9","Brunei Darussalam"],
    ["E0","Bulgaria"],
    ["X2","Burkina Faso"],
    ["E2","Burundi"],
    ["E3","Cambodia"],
    ["E4","Cameroon"],
    ["E8","Cape Verde"],
    ["E9","Cayman Islands"],
    ["F0","Central African Republic"],
    ["F2","Chad"],
    ["F3","Chile"],
    ["F4","China"],
    ["F6","Christmas Island"],
    ["F7","Cocos (Keeling) Islands"],
    ["F8","Colombia"],
    ["F9","Comoros"],
    ["G0","Congo"],
    ["Y3","Congo, the Democratic Republic of the"],
    ["G1","Cook Islands"],
    ["G2","Costa Rica"],
    ["L7","Cote D'ivoire "],
    ["1M","Croatia"],
    ["G3","Cuba"],
    ["G4","Cyprus"],
    ["2N","Czech Republic"],
    ["G7","Denmark"],
    ["1G","Djibouti"],
    ["G9","Dominica"],
    ["G8","Dominican Republic"],
    ["H1","Ecuador"],
    ["H2","Egypt"],
    ["H3","El Salvador"],
    ["H4","Equatorial Guinea"],
    ["1J","Eritrea"],
    ["1H","Estonia"],
    ["H5","Ethiopia"],
    ["H7","Falkland Islands (Malvinas)"],
    ["H6","Faroe Islands"],
    ["H8","Fiji"],
    ["H9","Finland"],
    ["I0","France"],
    ["I3","French Guiana"],
    ["I4","French Polynesia"],
    ["2C","French Southern Territories"],
    ["I5","Gabon"],
    ["I6","Gambia"],
    ["2Q","Georgia"],
    ["2M","Germany"],
    ["J0","Ghana"],
    ["J1","Gibraltar"],
    ["J3","Greece"],
    ["J4","Greenland"],
    ["J5","Grenada"],
    ["J6","Guadeloupe"],
    ["GU","Guam"],
    ["J8","Guatemala"],
    ["Y7","Guernsey"],
    ["J9","Guinea"],
    ["S0","Guinea-bissau"],
    ["K0","Guyana"],
    ["K1","Haiti"],
    ["K4","Heard Island and Mcdonald Islands"],
    ["X4","Holy See (Vatican City State)"],
    ["K2","Honduras"],
    ["K3","Hong Kong"],
    ["K5","Hungary"],
    ["K6","Iceland"],
    ["K7","India"],
    ["K8","Indonesia"],
    ["K9","Iran, Islamic Republic of"],
    ["L0","Iraq"],
    ["L2","Ireland"],
    ["Y8","Isle of Man"],
    ["L3","Israel"],
    ["L6","Italy"],
    ["L8","Jamaica"],
    ["M0","Japan"],
    ["Y9","Jersey"],
    ["M2","Jordan"],
    ["1P","Kazakstan"],
    ["M3","Kenya"],
    ["J2","Kiribati"],
    ["M4","Korea, Democratic People's Republic of "],
    ["M5","Korea, Republic of"],
    ["M6","Kuwait"],
    ["1N","Kyrgyzstan"],
    ["M7","Lao People's Democratic Republic "],
    ["1R","Latvia"],
    ["M8","Lebanon"],
    ["M9","Lesotho"],
    ["N0","Liberia"],
    ["N1","Libyan Arab Jamahiriya"],
    ["N2","Liechtenstein"],
    ["1Q","Lithuania"],
    ["N4","Luxembourg"],
    ["N5","Macau"],
    ["1U","Macedonia, the Former Yugoslav Republic of"],
    ["N6","Madagascar"],
    ["N7","Malawi"],
    ["N8","Malaysia"],
    ["N9","Maldives"],
    ["O0","Mali"],
    ["O1","Malta"],
    ["1T","Marshall Islands"],
    ["O2","Martinique"],
    ["O3","Mauritania"],
    ["O4","Mauritius"],
    ["2P","Mayotte"],
    ["O5","Mexico"],
    ["1K","Micronesia, Federated States of"],
    ["1S","Moldova, Republic of"],
    ["O9","Monaco"],
    ["P0","Mongolia"],
    ["Z5","Montenegro"],
    ["P1","Montserrat"],
    ["P2","Morocco"],
    ["P3","Mozambique"],
    ["E1","Myanmar"],
    ["T6","Namibia"],
    ["P5","Nauru"],
    ["P6","Nepal"],
    ["P7","Netherlands"],
    ["P8","Netherlands Antilles"],
    ["1W","New Caledonia"],
    ["Q2","New Zealand"],
    ["Q3","Nicaragua"],
    ["Q4","Niger"],
    ["Q5","Nigeria"],
    ["Q6","Niue"],
    ["Q7","Norfolk Island"],
    ["1V","Northern Mariana Islands"],
    ["Q8","Norway"],
    ["P4","Oman"],
    ["R0","Pakistan"],
    ["1Y","Palau"],
    ["1X","Palestinian Territory, Occupied"],
    ["R1","Panama"],
    ["R2","Papua New Guinea"],
    ["R4","Paraguay"],
    ["R5","Peru"],
    ["R6","Philippines"],
    ["R8","Pitcairn"],
    ["R9","Poland"],
    ["S1","Portugal"],
    ["PR","Puerto Rico"],
    ["S3","Qatar"],
    ["S4","Reunion"],
    ["S5","Romania"],
    ["1Z","Russian Federation"],
    ["S6","Rwanda"],
    ["Z0","Saint Barthelemy"],
    ["U8","Saint Helena"],
    ["U7","Saint Kitts and Nevis"],
    ["U9","Saint Lucia"],
    ["Z1","Saint Martin"],
    ["V0","Saint Pierre and Miquelon"],
    ["V1","Saint Vincent and the Grenadines"],
    ["Y0","Samoa"],
    ["S8","San Marino"],
    ["S9","Sao Tome and Principe"],
    ["T0","Saudi Arabia"],
    ["T1","Senegal"],
    ["Z2","Serbia"],
    ["T2","Seychelles"],
    ["T8","Sierra Leone"],
    ["U0","Singapore"],
    ["2B","Slovakia"],
    ["2A","Slovenia"],
    ["D7","Solomon Islands"],
    ["U1","Somalia"],
    ["T3","South Africa"],
    ["1L","South Georgia and the South Sandwich Islands"],
    ["U3","Spain"],
    ["F1","Sri Lanka"],
    ["V2","Sudan"],
    ["V3","Suriname"],
    ["L9","Svalbard and Jan Mayen"],
    ["V6","Swaziland"],
    ["V7","Sweden"],
    ["V8","Switzerland"],
    ["V9","Syrian Arab Republic"],
    ["F5","Taiwan, Province of China"],
    ["2D","Tajikistan"],
    ["W0","Tanzania, United Republic of"],
    ["W1","Thailand"],
    ["Z3","Timor-leste"],
    ["W2","Togo"],
    ["W3","Tokelau"],
    ["W4","Tonga"],
    ["W5","Trinidad and Tobago"],
    ["W6","Tunisia"],
    ["W8","Turkey"],
    ["2E","Turkmenistan"],
    ["W7","Turks and Caicos Islands"],
    ["2G","Tuvalu"],
    ["W9","Uganda"],
    ["2H","Ukraine"],
    ["C0","United Arab Emirates"],
    ["X0","United Kingdom"],
    ["2J","United States Minor Outlying Islands"],
    ["X3","Uruguay"],
    ["2K","Uzbekistan"],
    ["2L","Vanuatu"],
    ["X5","Venezuela"],
    ["Q1","Viet Nam"],
    ["D8","Virgin Islands, British"],
    ["VI","Virgin Islands, U.s."],
    ["X8","Wallis and Futuna"],
    ["U5","Western Sahara"],
    ["T7","Yemen"],
    ["Y4","Zambia"],
    ["Y5","Zimbabwe"],
    ["XX","Unknown"]
];

const forms = [
  {"form":"4","category":"Section 16 Reports","desciption":"Statement of changes in beneficial ownership of securities"},
  {"form":"8-K","category":"Annual, Periodic, and Current Reports","desciption":"Current report"},
  {"form":"SC 13G","category":"Beneficial Ownership Reports","desciption":"Schedule filed to report acquisition of beneficial ownership of 5% or more of a class of equity securities by passive investors and certain institutions"},
  {"form":"D","category":"Exempt Offerings","desciption":"Notice of sales of securities on Form D (Regulation D)"},
  {"form":"3","category":"Section 16 Reports","desciption":"Initial statement of beneficial ownership of securities"},
  {"form":"10-Q","category":"Annual, Periodic, and Current Reports","desciption":"Quarterly report pursuant to Section 13 or 15(d)"},
  {"form":"424B2","category":"Registration Statements","desciption":""},
  {"form":"6-K","category":"Annual, Periodic, and Current Reports","desciption":"Current report of foreign issuer pursuant to Rules 13a-16 and 15d-16"},
  {"form":"497","category":"Registration Statements","desciption":"Definitive materials filed under paragraph (a), (b), (c), (d), (e) or (f) of Securities Act Rule 497"},
  {"form":"497K","category":"Registration Statements","desciption":"Summary prospectuses for open-end management investment companies registered on Form N-1A filed pursuant to Securities Act Rule 497(k)"},
  {"form":"13F-HR","category":"Annual, Periodic, and Current Reports","desciption":"Further understand that each of 13F-HR, 13F-NT, and amendments thereto are mandatory electronic filings (hardship exemption exists to submit in paper; never used to the knowledge of IM staff);"},
  {"form":"CORRESP","category":"Filing Review Correspondence","desciption":""},
  {"form":"424B3","category":"Registration Statements","desciption":""},
  {"form":"UPLOAD","category":"Filing Review Correspondence","desciption":"Upload Submission"},
  {"form":"SC 13D","category":"Beneficial Ownership Reports","desciption":"Schedule filed to report acquisition of beneficial ownership of 5% or more of a class of equity securities"},
  {"form":"FWP","category":"Registration Statements","desciption":"Filing under Securities Act Rule 163/433 of free writing prospectuses."},
  {"form":"10-K","category":"Annual, Periodic, and Current Reports","desciption":"Annual report pursuant to Section 13 or 15(d)"},
  {"form":"EFFECT","category":"SEC Orders and Notices","desciption":"Effectiveness filing by commission order"},
  {"form":"S-4","category":"Registration Statements","desciption":"Registration statement for securities to be issued in business combination transactions"},
  {"form":"485BPOS","category":"Registration Statements","desciption":"Post-effective amendment filed pursuant to Securities Act Rule 485(b) (this filing cannot be submitted as a 1940 Act only filing)"},
  {"form":"5","category":"Section 16 Reports","desciption":"Annual statement of changes in beneficial ownership of securities"},
  {"form":"24F-2NT","category":"Annual, Periodic, and Current Reports","desciption":"Rule 24f-2 notice filed on Form 24F-2"},
  {"form":"N-Q","category":"Annual, Periodic, and Current Reports","desciption":"Quarterly Schedule of Portfolio Holdings of Registered Management Investment Company filed on Form N-Q"},
  {"form":"424B5","category":"Registration Statements","desciption":""},
  {"form":"DEF 14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"13F-NT","category":"Annual, Periodic, and Current Reports","desciption":"Further understand that each of 13F-HR, 13F-NT, and amendments thereto are mandatory electronic filings (hardship exemption exists to submit in paper; never used to the knowledge of IM staff);"},
  {"form":"497J","category":"Registration Statements","desciption":"Certification of no change in definitive materials under paragraph (j) of Securities Act Rule 497"},
  {"form":"10-D","category":"Annual, Periodic, and Current Reports","desciption":"Asset-Backed Issuer Distribution Report Pursuant to Section 13 or 15(d) of the Securities Exchange Act of 1934"},
  {"form":"DEFA14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"425","category":"Registration Statements","desciption":"Filing under Securities Act Rule 425 of certain prospectuses and communications in connection with business combination transactions."},
  {"form":"X-17A-5","desciption":"Note: This is a TM filing.  Annual audit report by brokers or dealers. To provide the Commission with audited statements of financial condition, income, and cash flows, and other financial materials."},
  {"form":"N-MFP","category":"Annual, Periodic, and Current Reports","desciption":"Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"S-1","category":"Registration Statements","desciption":"General form of registration statement for all companies including face-amount certificate companies"},
  {"form":"40-17G","category":"Annual, Periodic, and Current Reports","desciption":"Fidelity bond filed pursuant to Rule 17g-1(g)(1) of the Investment Company Act of 1940."},
  {"form":"N-CSR","category":"Annual, Periodic, and Current Reports","desciption":"Certified annual shareholder report of registered management investment companies filed on Form N-CSR"},
  {"form":"N-CSRS","category":"Annual, Periodic, and Current Reports","desciption":"Certified semi-annual shareholder report of registered management investment companies filed on Form N-CSR"},
  {"form":"N-PX","category":"Annual, Periodic, and Current Reports","desciption":"Annual Report of Proxy Voting Record of Registered Management Investment Companies filed on Form N-PX"},
  {"form":"NSAR-B","category":"Annual, Periodic, and Current Reports","desciption":"Annual report for management companies filed on Form N-SAR"},
  {"form":"NSAR-A","category":"Annual, Periodic, and Current Reports","desciption":"Semi-annual report for management companies filed on Form N-SAR"},
  {"form":"NT 10-Q","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"S-3ASR","category":"Registration Statements","desciption":"Automatic shelf registration statement of securities of well-known seasoned issuers"},
  {"form":"40-APP","category":"SEC Orders and Notices","desciption":"Application for an order of exemptive or other relief filed under the Investment Company Act of 1940"},
  {"form":"S-3","category":"Registration Statements","desciption":"Registration statement for specified transactions by certain issuers including face-amount certificate companies"},
  {"form":"S-8","category":"Registration Statements","desciption":"Initial registration statement for securities to be offered to employees pursuant to employee benefit plans"},
  {"form":"19B-4E","desciption":"Note: This is not IM. Filed by self-regulatory orgs."},
  {"form":"POSASR","category":"Registration Statements","desciption":"Post-effective amendment to an automatic shelf registration statement of Form S-3ASR or Form F-3ASR"},
  {"form":"S-8 POS","category":"Registration Statements","desciption":"Post-effective amendment to a S-8 registration statement"},
  {"form":"S-6","category":"Registration Statements","desciption":"Initial registration statement filed on Form S-6 for unit investment trusts"},
  {"form":"FOCUSN","desciption":"Note: This is not IM. Filed by broker dealers."},
  {"form":"485BXT","category":"Registration Statements","desciption":"Post-effective amendment filed pursuant to Securities Act Rule 485(b)(1)(iii) to designate a new effective date for a post-effective amendment previously filed pursuant to Securities Act Rule 485(a) (this filing cannot be submitted as a 1940 Act only fili"},
  {"form":"POS AM","category":"Registration Statements","desciption":"Post-effective amendment to a registration statement that is not immediately effective upon filing"},
  {"form":"N-MFP2","category":"Annual, Periodic, and Current Reports","desciption":"Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"MA-I","desciption":"Information Regarding Natural Persons Who Engage in Municipal Advisory Activities"},
  {"form":"11-K","category":"Annual, Periodic, and Current Reports","desciption":"Annual reports of employee stock purchase, savings and similar plans pursuant to Section 15(d)"},
  {"form":"485APOS","category":"Registration Statements","desciption":"Post-effective amendment filed pursuant to Securities Act Rule 485(a) (this filing cannot be submitted as a 1940 Act only filing)"},
  {"form":"25-NSE","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"NT 10-K","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"CT ORDER","category":"SEC Orders and Notices","desciption":"Note: Confirm category with CF. There have been 1986 issued since 1/1/2018. Five by IM, 1 by TM and the rest CF."},
  {"form":"ARS","category":"Proxy Materials","desciption":"Annual report to security holders. Note: Use this Form Type when furnishing the annual report to security holders for the information of the Commission pursuant to Rule 14a-3(c) or Rule 14c-3(b)."},
  {"form":"SC TO-I","category":"Tender Offers and Going Private Transactions","desciption":"Issuer tender offer statement"},
  {"form":"ABS-15G","category":"Annual, Periodic, and Current Reports","desciption":"ASSET-BACKED SECURITIZER REPORT"},
  {"form":"PRE 14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"SC TO-T","category":"Tender Offers and Going Private Transactions","desciption":"Third party tender offer statement"},
  {"form":"DFAN14A","category":"Proxy Materials","desciption":"Definitive additional proxy soliciting materials filed by non-management including Rule 14(a)(12) material. Note: Form Type DFAN14A can be filed as part of Form 8-K. For filers subject to 8-K filing requirements, we recommend the use of the 8-K combined f"},
  {"form":"487","category":"Registration Statements","desciption":"Pre-effective pricing amendments filed pursuant to Securities Act Rule 487"},
  {"form":"8-A12B","category":"Registration Statements","desciption":""},
  {"form":"20-F","category":"Annual, Periodic, and Current Reports","desciption":"Registration statement under Section 12 of the Securities Exchange Act of 1934 or an annual or transition report filed under Section 13(a) or 15(d) of the Exchange Act for a  foreign private issuer."},
  {"form":"F-6EF","category":"Registration Statements","desciption":"Auto effective registration statement for American Depositary Receipts representing securities of certain foreign private issuers"},
  {"form":"40-17F2","category":"Annual, Periodic, and Current Reports","desciption":"Initial certificate of accounting of securities and similar investments in the custody of management investment companies filed pursuant to Rule 17f-2 of the Investment Company Act of 1940 filed on Form N-17F-2"},
  {"form":"SD","category":"Annual, Periodic, and Current Reports","desciption":"Specialized Disclosure Report"},
  {"form":"144","desciption":"Filing for proposed sale of securities under Rule 144."},
  {"form":"NSAR-U","category":"Annual, Periodic, and Current Reports","desciption":"Annual report for unit investment trusts filed on Form N-SAR"},
  {"form":"ABS-EE","category":"Annual, Periodic, and Current Reports","desciption":"Form for Submission of Electronic Exhibits in Asset-Backed Securities Offerings"},
  {"form":"DEF 14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"15-15D","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"SC 14D9","category":"Tender Offers and Going Private Transactions","desciption":"Tender offer solicitation / recommendation statements filed under Rule 14-d9"},
  {"form":"RW","category":"Registration Statements","desciption":"Registration Withdrawal Request"},
  {"form":"F-3","category":"Registration Statements","desciption":"Registration statement for specified transactions by certain foreign private issuers"},
  {"form":"F-4","category":"Registration Statements","desciption":"Registration statement for securities issued by foreign private issuers in certain business combination transactions"},
  {"form":"DRS","category":"Registration Statements","desciption":"Persons"},
  {"form":"N-30B-2","category":"Annual, Periodic, and Current Reports","desciption":"Periodic and interim reports mailed to investment company shareholders (other than annual and semi-annual reports mailed to shareholders pursuant to Rule 30e-1)"},
  {"form":"T-3","category":"Trust Indenture Filings","desciption":"Initial application for qualification of trust indentures"},
  {"form":"REVOKED","category":"SEC Orders and Notices","desciption":"Note: Confirm category with CF. There have been over 500 issued since 1/1/2018. All are CF companies. This might be available to all Divisions."},
  {"form":"N-30D","category":"Annual, Periodic, and Current Reports","desciption":"Initial annual and semi-annual reports mailed to investment company shareholders pursuant to Rule 30e-1 (other than those required to be submitted as part of Form N-CSR)"},
  {"form":"N-2","category":"Registration Statements","desciption":"Filing of a registration statement on Form N-2 for closed-end investment companies"},
  {"form":"PRE 14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"424B4","category":"Registration Statements","desciption":""},
  {"form":"15-12G","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"NO ACT","desciption":"Note: This is not a submission type that has ever been used on EDGAR. IM issues no action letters but we have not seen this used on EDGAR."},
  {"form":"TA-2","desciption":"Annual report of transfer agent activities filed pursuant to the Securities Exchange Act of 1934. IN contains information necessary to monitor transfer agent registration"},
  {"form":"N-CEN","category":"Annual, Periodic, and Current Reports","desciption":"Form N-CEN will require annual reporting of certain census-type information in a structured XML format. Form N-CEN will replace Form N-SAR.  The compliance date for Form N-CEN filers – regardless of asset size – is June 1, 2018."},
  {"form":"N-MFP1","category":"Annual, Periodic, and Current Reports","desciption":"Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"SUPPL","category":"Registration Statements","desciption":"Voluntary supplemental material filed pursuant to Section 11(a) of the Securities Act of 1933 by foreign issuers"},
  {"form":"C","desciption":"Offering Statement"},
  {"form":"SC TO-C","category":"Tender Offers and Going Private Transactions","desciption":"Written communication relating to an issuer or third party tender offer"},
  {"form":"10-12G","category":"Registration Statements","desciption":""},
  {"form":"POS EX","category":"Registration Statements","desciption":"Post-effective amendment filed solely to add exhibits to a registration statement"},
  {"form":"F-6 POS","category":"Registration Statements","desciption":"Post-effective amendment to a F-6EF registration"},
  {"form":"SC 13E3","category":"Tender Offers and Going Private Transactions","desciption":"Schedule filed to report going private transactions"},
  {"form":"40-24B2","category":"Registration Statements","desciption":"Filing of sales literature pursuant to Rule 24b-2 under the Investment Company Act of 1940."},
  {"form":"CERTNYS","desciption":"Note: Check with CF they do the majority of these filings."},
  {"form":"F-1","category":"Registration Statements","desciption":"Registration statement for certain foreign private issuers"},
  {"form":"NPORT-EX","category":"Annual, Periodic, and Current Reports","desciption":"Portfolio holdings exhibit"},
  {"form":"IRANNOTICE","category":"Annual, Periodic, and Current Reports","desciption":"Notice of Iran-related disclosure filed pursuant to Section 13(r)(3) of the Exchange Act"},
  {"form":"PRER14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"1-A","category":"Exempt Offerings","desciption":"REGULATION A OFFERING STATEMENT UNDER THE SECURITIES ACT OF 1933"},
  {"form":"15-12B","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"497AD","desciption":"Filing by certain investment companies of Securities Act Rule 482 advertising in accordance with Securities Act Rule 497 and the Note to Rule 482©.  See the following for more detail on hardship exemption https://www.sec.gov/rules/final/2008/33-8981.pdf"},
  {"form":"N-8F","desciption":"Application for deregistration made on Form N-8F"},
  {"form":"PX14A6G","category":"Proxy Materials","desciption":""},
  {"form":"POS AMI","desciption":"Amendment (for filings made under the1940 Act only)"},
  {"form":"CB","category":"Tender Offers and Going Private Transactions","desciption":"Notification form filed in connection with certain tender offers, business combinations and rights offerings, in which the subject company is a foreign private issuer of which less than 10% of its securities are held by U.S. persons."},
  {"form":"N-14","desciption":"Initial registration statement filed on Form N-14 for open-end investment company, including those filed with automatic effectiveness under Rule 488 (business combinations)."},
  {"form":"F-6","category":"Registration Statements","desciption":"Registration statement for American Depositary Receipts representing securities of certain foreign private issuers"},
  {"form":"DRSLTR","category":"Filing Review Correspondence","desciption":"Correspondence Submission of a DRS filer. Correspondence is not publicly disseminated immediately. The SEC staff may publicly release all or portions of these documents."},
  {"form":"305B2","category":"Trust Indenture Filings","desciption":"Application for designation of a new trustee under the Trust Indenture Act"},
  {"form":"CERTNAS","desciption":""},
  {"form":"424B7","category":"Registration Statements","desciption":""},
  {"form":"DEFM14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"MA","desciption":"Application For Municipal Advisor Registration"},
  {"form":"S-11","category":"Registration Statements","desciption":"Registration statement for securities to be issued by real estate companies"},
  {"form":"AW","category":"Registration Statements","desciption":"Withdrawal of amendment to a registration statement filed under the Securities Act"},
  {"form":"TA-1","desciption":"Application for registration as a transfer agent filed pursuant to the Securities Exchange Act of 1934. It contains information necessary to consider the Transfer Agent registration"},
  {"form":"F-X","category":"Registration Statements","desciption":"For appointment of agent for service of process by issuers registering securities (if filed on Form F-8, F-9, F-10 or F-80, or registering securities or filing periodic reports on Form 40-F, or by any person filing certain tender offer documents, or by an"},
  {"form":"8-A12G","category":"Registration Statements","desciption":""},
  {"form":"DEFR14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"18-K","category":"Annual, Periodic, and Current Reports","desciption":"Annual report for foreign governments and political subdivisions"},
  {"form":"N-8F ORDR","desciption":"N-8F Order"},
  {"form":"40-F","category":"Annual, Periodic, and Current Reports","desciption":"Registration Statement Pursuant to Section 12 of the Securities Exchange Act of 1934 or Annual Report pursuant to Section 13(a) or 15(d) of the Securities Exchange Act of 1934"},
  {"form":"MA-A","desciption":"Annual Update of Municipal Advisor Registration"},
  {"form":"PREC14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"N-8F NTC","desciption":"N-8F Notice"},
  {"form":"POS 8C","desciption":"Post-effective amendment filed under the 1933 Act only or under both the 1933 and 1940 Acts pursuant to Section 8(c) of the 1933 Act by closed-end investment companies (this filing cannot be submitted as a 1940 Act only filing)"},
  {"form":"PREM14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"PRRN14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"N-4","desciption":"Initial registration statement on Form N-4 for separate accounts (unit investment trusts)"},
  {"form":"N-8A","desciption":"Initial notification of registration under section 8(a) filed on Form N-8A"},
  {"form":"424H","category":"Registration Statements","desciption":""},
  {"form":"N-1A","desciption":"investment company prospectuses filed under paragraph (a), (b), (c), (d), (e) or (f) of Securities Act Rule 497"},
  {"form":"N-1A","desciption":"Initial registration statement filed on Form N-1A for open-end management investment companies"},
  {"form":"N-1A","desciption":"(a) An initial registration statement and amendments to the registration statement [by open-end management investment companies] under the Investment company Act; An initial registration statement including amendments under the Securities Act;"},
  {"form":"CERT","desciption":""},
  {"form":"F-3ASR","category":"Registration Statements","desciption":"Automatic shelf registration statement of securities of well-known seasoned issuers"},
  {"form":"1","desciption":""},
  {"form":"DEFC14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"424B1","category":"Registration Statements","desciption":""},
  {"form":"10-12B","category":"Registration Statements","desciption":""},
  {"form":"SC14D9C","category":"Tender Offers and Going Private Transactions","desciption":"Written communication by the subject company relating to a third party tender offer"},
  {"form":"F-10","category":"Registration Statements","desciption":"Registration statement for securities of certain Canadian issuers under the Securities Act of 1933"},
  {"form":"APP NTC","desciption":"40-APP Notice"},
  {"form":"N-23C3A","desciption":""},
  {"form":"40-OIP","desciption":"Application for an order of exemptive or other relief filed under the Investment Company Act of 1940"},
  {"form":"25","category":"Annual, Periodic, and Current Reports","desciption":"Notification of removal from listing and/or registration from a national securities exchange"},
  {"form":"APP ORDR","desciption":"40-APP Order"},
  {"form":"APP WD","desciption":"Withdrawal of an application for exemptive or other relief from the federal securities laws"},
  {"form":"PRER14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"424B8","category":"Registration Statements","desciption":""},
  {"form":"253G2","category":"Exempt Offerings","desciption":""},
  {"form":"1-U","category":"Annual, Periodic, and Current Reports","desciption":"Current Report Pursuant to Regulation A"},
  {"form":"SC 14F1","category":"Tender Offers and Going Private Transactions","desciption":"Statement regarding change in majority of directors pursuant to Rule 14f-1"},
  {"form":"C-U","desciption":"Progress Update"},
  {"form":"N-23C-2","desciption":"Notice by closed-end investment companies of intention to call or redeem their own securities under Investment Company Act Rule 23c-2"},
  {"form":"S-1MEF","category":"Registration Statements","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-1"},
  {"form":"NT 20-F","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"QUALIF","category":"SEC Orders and Notices","desciption":""},
  {"form":"C-AR","desciption":"Annual Report"},
  {"form":"DEL AM","category":"Registration Statements","desciption":"Separately filed delaying amendment under Securities Act Rule 473 to delay effectiveness of a 1933 Act registration statement"},
  {"form":"1-A POS","category":"Exempt Offerings","desciption":""},
  {"form":"NTN 10Q","desciption":""},
  {"form":"ADV-NR","desciption":""},
  {"form":"SF-3","category":"Registration Statements","desciption":"Shelf registration statement for qualified offerings of asset-backed securities"},
  {"form":"486BPOS","desciption":"Post-effective amendment to filing filed pursuant to Securities Act Rule 486(b)"},
  {"form":"40-6B","desciption":"Application under the Investment Company Act of 1940 by an employees securities company"},
  {"form":"CERTARCA","desciption":""},
  {"form":"10-KT","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"NTN 10K","desciption":""},
  {"form":"DSTRBRPT","category":"Annual, Periodic, and Current Reports","desciption":"Distribution of primary obligations Development Bank report"},
  {"form":"40-17F1","desciption":"Initial certificate of accounting of securities and similar investments in the custody of management investment companies filed pursuant to Rule 17f-1 of the Investment Company Act of 1940 filed on Form N-17F-1"},
  {"form":"N-14 8C","desciption":"Initial registration statement filed on Form N-14 by closed-end investment company (business combinations)"},
  {"form":"ADV-E","desciption":""},
  {"form":"S-3MEF","category":"Registration Statements","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-3"},
  {"form":"40-33","desciption":"Copies of all stockholder derivative actions filed with a court against an investment company or an affiliate thereof pursuant to Section 33 of the Investment Company Act of 1940. Note: May be filed electronically on a voluntary basis."},
  {"form":"N-18F1","desciption":"Initial notification of election pursuant to Rule 18f-1 filed on Form N-18F-1 [under the Investment Company Act of 1940 by a registered open-end investment company]."},
  {"form":"N-6","desciption":"Initial registration statement filed on Form N-6 for separate accounts (unit investment trusts)"},
  {"form":"SE","desciption":""},
  {"form":"S-B","category":"Registration Statements","desciption":"Registration statement for securities of foreign governments and subdivisions thereof under the Securities Act of 1933 (Schedule b)"},
  {"form":"MA-W","desciption":"Notice of Withdrawal From Registration as a Municipal Advisor"},
  {"form":"F-N","category":"Registration Statements","desciption":"Notification of the appointment of an agent for service by certain foreign institutions."},
  {"form":"DOS","category":"Exempt Offerings","desciption":"Persons who"},
  {"form":"1-K","category":"Annual, Periodic, and Current Reports","desciption":"Regulation A Annual Report"},
  {"form":"1-SA","category":"Annual, Periodic, and Current Reports","desciption":"SEMIANNUAL REPORT PURSUANT TO REGULATION A or SPECIAL FINANCIAL REPORT PURSUANT TO REGULATION A"},
  {"form":"CFPORTAL","desciption":"It contains information to consider registration as a crowdfunding portal"},
  {"form":"NT N-MFP","desciption":"EDGAR generated form type for late filing of  Monthly Schedule of Portfolio Holdings of Money Market Funds on Form N-MFP"},
  {"form":"S-3D","category":"Registration Statements","desciption":"Automatically effective registration statement for securities issued pursuant to dividend or interest reinvestment plans"},
  {"form":"S-3DPOS","category":"Registration Statements","desciption":"Post-effective amendment to a S-3D registration statement"},
  {"form":"MSD","desciption":""},
  {"form":"13FCONP","desciption":""},
  {"form":"NT 11-K","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"20FR12G","category":"Registration Statements","desciption":""},
  {"form":"8-K12B","desciption":""},
  {"form":"NSAR-BT","desciption":"Transitional annual report filed on Form N-SAR"},
  {"form":"TA-W","desciption":"Notice of withdrawal from registration as transfer agent filed pursuant to the Securities Exchange Act of 1934. IN contains information necessary to consider the Transfer Agent registration withdrawal"},
  {"form":"RW WD","category":"Registration Statements","desciption":"Withdrawal of a request for withdrawal of a registration statement"},
  {"form":"NT-NSAR","desciption":"Notice under Exchange Act Rule 12b-25 of inability to timely file Form N-SAR"},
  {"form":"PREM14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"PREN14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"OIP NTC","desciption":"40-OIP Notice"},
  {"form":"DEFA14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"DFRN14A","category":"Proxy Materials","desciption":"Revised definitive proxy statement filed by non-management"},
  {"form":"N-6F","desciption":"Notice of intent by business development companies to elect to be subject to Sections 55 through 65 of the 1940 Act filed on Form N-6F"},
  {"form":"OIP ORDR","desciption":"40-OIP Order"},
  {"form":"C-W","desciption":"Offering Statement Withdrawal"},
  {"form":"CERTPAC","desciption":""},
  {"form":"8-K12G3","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"SC14D1F","category":"Beneficial Ownership Reports","desciption":"Third party tender offer statement filed pursuant to Rule 14d-1(b) by foreign issuers"},
  {"form":"DEFN14A","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"DEFM14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"1-A-W","category":"Exempt Offerings","desciption":""},
  {"form":"DEFR14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"G-FIN","desciption":""},
  {"form":"NRSRO-UPD","desciption":"Form NRSRO – Update of Registration for Nationally Recognized Statistical Rating Organizations"},
  {"form":"NT-NCSR","desciption":"Notice under Exchange Act Rule 12b-25 of inability to timely file Form N-CSR (annual or semi-annual report)"},
  {"form":"15F-12G","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"20FR12B","category":"Registration Statements","desciption":""},
  {"form":"SEC STAFF ACTION","desciption":""},
  {"form":"DOSLTR","category":"Filing Review Correspondence","desciption":""},
  {"form":"40FR12B","category":"Registration Statements","desciption":"Registration of a class of securities of certain Canadian issuers pursuant to Section 12(b) of the 1934 Act"},
  {"form":"F-1MEF","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form F-1"},
  {"form":"N-54A","desciption":"Notification of election by business development companies to be subject to the provisions of sections 55 through 65 of the Investment Company Act"},
  {"form":"15F-15D","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"NT N-CEN","desciption":""},
  {"form":"15F-12B","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"486APOS","desciption":"Post-effective amendment to filing filed pursuant to Securities Act Rule 486(a)"},
  {"form":"F-9","category":"Registration Statements","desciption":"Registration of securities of certain investment grade debt or investment grade preferred securities of certain Canadian issuers under the Securities Act of 1933"},
  {"form":"QRTLYRPT","category":"Annual, Periodic, and Current Reports","desciption":"Periodic Development Bank filing, submitted quarterly"},
  {"form":"40-8B25","desciption":"Filing by investment company of application under Investment Company Act Rule 8b-25(a) requesting extension of time for filing certain information, document or report"},
  {"form":"NT N-MFP2","desciption":""},
  {"form":"1-Z","category":"Annual, Periodic, and Current Reports","desciption":"EXIT REPORT UNDER REGULATION A"},
  {"form":"N-2MEF","desciption":"A new registration statement on Form N-2 filed under the Securities Act Rule 462(b) by closed-end investment companies to register up to an additional 20% of securities for an offering that was registered on Form N-2"},
  {"form":"TACO","desciption":""},
  {"form":"CERTCBO","desciption":""},
  {"form":"10-QT","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"CERTBATS","desciption":""},
  {"form":"S-4 POS","category":"Registration Statements","desciption":"Post-effective amendment to a S-4EF registration statement"},
  {"form":"N-23C3B","desciption":"Notification of  discretionary repurchase offer [by registered closed-end investment companies or business development companies] pursuant Rule 23c-3(c) only"},
  {"form":"40-206A","desciption":""},
  {"form":"NRSRO-CE","desciption":"Form NRSRO – Annual Certification for Nationally Recognized Statistical Rating Organizations"},
  {"form":"APP WDG","desciption":""},
  {"form":"STOP ORDER","desciption":""},
  {"form":"424A","category":"Registration Statements","desciption":""},
  {"form":"ANNLRPT","category":"Annual, Periodic, and Current Reports","desciption":"Periodic Development Bank filing, submitted annually"},
  {"form":"N-CR","desciption":"Current Report of Money Market Fund Material Events"},
  {"form":"PX14A6N","category":"Proxy Materials","desciption":""},
  {"form":"SEC STAFF LETTER","desciption":""},
  {"form":"N-54C","desciption":"Notification of withdrawal by business development companies of notification of election by business development companies to be subject to the provisions of sections 55 through 65 of the Investment Company Act"},
  {"form":"NT-NCEN","desciption":""},
  {"form":"POS462B","category":"Registration Statements","desciption":"Post-effective amendment to Securities Act Rule 462(b) registration statement"},
  {"form":"C-TR","desciption":"Termination of Reporting"},
  {"form":"2-A","desciption":""},
  {"form":"S-4MEF","category":"Registration Statements","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-4"},
  {"form":"ADV-H-T","desciption":""},
  {"form":"F-3D","category":"Registration Statements","desciption":"Registration statement for dividend or interest reinvestment plan securities of foreign private issuers"},
  {"form":"AW WD","category":"Registration Statements","desciption":"Withdrawal of a request for withdrawal of an amendment to a registration statement"},
  {"form":"6B NTC","desciption":"40-6B Notice"},
  {"form":"8-M","desciption":""},
  {"form":"NT N-MFP1","desciption":""},
  {"form":"N-8B-2","desciption":"Initial registration statement for unit investment trusts filed on Form N-8B-2"},
  {"form":"REG-NR","desciption":""},
  {"form":"497H2","desciption":"Filings made pursuant to Securities Act Rule 497(h)(2)"},
  {"form":"F-7","category":"Registration Statements","desciption":"Registration statement for securities of certain Canadian issuers offered for cash upon the exercise of rights granted to existing security holders under the Securities Act of 1933"},
  {"form":"S-11MEF","category":"Registration Statements","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-11"},
  {"form":"253G1","category":"Exempt Offerings","desciption":""},
  {"form":"6B ORDR","desciption":"40-6B Order"},
  {"form":"F-80","category":"Registration Statements","desciption":"Registration of securities of certain Canadian issuers to be issued in exchange offers or a business combination under the Securities Act of 1933"},
  {"form":"40-202A","desciption":""},
  {"form":"SC 14N","category":"Proxy Materials","desciption":"Information to be included in statements filed pursuant to §240.14n-1 and amendments thereto filed pursuant to §240.14n-2."},
  {"form":"F-10POS","category":"Registration Statements","desciption":"Post-effective amendment to a F-10EF registration"},
  {"form":"MSDW","desciption":""},
  {"form":"NSAR-AT","desciption":"Transitional semi-annual report filed on Form N-SAR"},
  {"form":"SC14D9F","category":"Tender Offers and Going Private Transactions","desciption":"Solicitation/recommendation statement pursuant to Section 14(d)(4) of the Securities Exchange Act of 1934 and Rules 14d-1(b) and 14e-2(c) by foreign issuers"},
  {"form":"486BXT","desciption":""},
  {"form":"F-8","category":"Registration Statements","desciption":"Registration statement for securities of certain Canadian issuers to be issued in exchange offers or a business combination under the Securities Act of 1933"},
  {"form":"PREC14C","category":"Proxy Materials","desciption":"Proxy Statement Pursuant to Section 14(a) of the Securities Exchange Act of 1934"},
  {"form":"MSDCO","desciption":""},
  {"form":"TTW","desciption":""},
  {"form":"WDL-REQ","desciption":""},
  {"form":"G-405","desciption":""},
  {"form":"NTFNCSR","desciption":""},
  {"form":"SF-1","category":"Registration Statements","desciption":"General form of registration statement for all issuers of asset-backed securities"},
  {"form":"G-405N","desciption":""},
  {"form":"F-80POS","category":"Registration Statements","desciption":"Post-effective amendment to a F-80 registration"},
  {"form":"F-3MEF","category":"Registration Statements","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form F-3"},
  {"form":"SP 15D2","category":"Annual, Periodic, and Current Reports","desciption":"Special Financial Report filed under Rule 15d-2"},
  {"form":"11-KT","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"40-17GCS","desciption":"Filings of claim or settlement pursuant to rule 17g-1(g)(1)(2) or (3) of the Investment Company Act of 1940."},
  {"form":"40FR12G","category":"Registration Statements","desciption":"Registration of a class of securities of certain Canadian issuers pursuant to Section 12(g) of the 1934 Act"},
  {"form":"F-3DPOS","category":"Registration Statements","desciption":"Post-Effective amendment to a F-3D registration"},
  {"form":"F-4 POS","category":"Registration Statements","desciption":"Post-Effective amendment to an F-4EF registration"},
  {"form":"NTFNSAR","desciption":""},
  {"form":"1-E","desciption":"Notification under Regulation E by small business investment companies and business development companies"},
  {"form":"40-8F-2","desciption":"Initial application for deregistration pursuant to Investment Company Act Rule 0-2"},
  {"form":"8-K15D5","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"G-FINW","desciption":""},
  {"form":"NTFNCEN","desciption":""},
  {"form":"2-AF","desciption":""},
  {"form":"N-23C3C","desciption":"Notification of periodic repurchase offer under paragraph (b) of Rule 23c-3 and a discretionary repurchase offer under paragraph (c) of Rule 23c-3. [by registered closed-end investment companies or business development companies] pursuant to Rule 23c-3(b)"},
  {"form":"NTN 20F","desciption":""},
  {"form":"SC13E4F","category":"Tender Offers and Going Private Transactions","desciption":"Issuer tender offer statement filed pursuant to Rule 13(e)(4) by foreign issuers"},
  {"form":"F-8 POS","category":"Registration Statements","desciption":"Post-effective amendment to a F-8 registration"},
  {"form":"NT NPORT-EX","desciption":""},
  {"form":"TH","desciption":""},
  {"form":"ADN-MTL","desciption":""},
  {"form":"CFPORTAL-W","desciption":""},
  {"form":"DEFC14C","category":"Proxy Materials","desciption":"Information Statement Pursuant to Section 14(c) of the Securities Exchange Act of 1934"},
  {"form":"SC 13E1","category":"Tender Offers and Going Private Transactions","desciption":"Schedule 13-E1 statement of issuer required by Rule 13e-1"},
  {"form":"SDR","desciption":"Swap Data Repository (in Edgar now). It contains information necessary to consider registration as a swap data repository"},
  {"form":"2-E","desciption":"Report of sales of securities by small business investment companies and business development companies pursuant to Rule 609 (Regulation E) Securities Act of 1933"},
  {"form":"9-M","desciption":""},
  {"form":"S-BMEF","category":"Registration Statements","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form S-B"},
  {"form":"253G3","category":"Exempt Offerings","desciption":""},
  {"form":"34-12H","desciption":""},
  {"form":"F-7 POS","category":"Registration Statements","desciption":"Post-effective amendment to a F-7 registration"},
  {"form":"N-5","desciption":"Initial registration statement on Form N-5 for small business investment companies"},
  {"form":"POS462C","category":"Registration Statements","desciption":"Post-effective amendment to a registration statement filed under Securities Act Rule 462(c)"},
  {"form":"8F-2 NTC","desciption":"40-8F-2 Notice"},
  {"form":"ATS-N-C","desciption":""},
  {"form":"C-AR-W","desciption":""},
  {"form":"C-U-W","desciption":"Broker-Dealer Withdrawal"},
  {"form":"F-10EF","category":"Registration Statements","desciption":"Auto effective registration statement for securities of certain Canadian issuers under the Securities Act of 1933"},
  {"form":"F-4MEF","category":"Registration Statements","desciption":"A new registration statement filed under Rule 462(b) to add securities to a prior related effective registration statement filed on Form F-4"},
  {"form":"F-9 POS","category":"Registration Statements","desciption":"Post-effective amendment to a F-9EF registration"},
  {"form":"NT 10-D","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"NTN 10D","desciption":""},
  {"form":"S-20","category":"Registration Statements","desciption":"Registration statement for standardized options"},
  {"form":"SL","desciption":""},
  {"form":"UNDER","category":"Registration Statements","desciption":"Initial undertaking to file reports"},
  {"form":"1-E AD","desciption":""},
  {"form":"1-Z-W","category":"Annual, Periodic, and Current Reports","desciption":""},
  {"form":"18-12B","category":"Registration Statements","desciption":""},
  {"form":"8F-2 ORDR","desciption":"40-8F-2 Order"},
  {"form":"ADV-H-C","desciption":""},
  {"form":"N-14MEF","desciption":"A new registration statement filed on Form N-14 by closed end investment companies filed under Securities Act Rule 462(b) of up to an additional 20% of securities for an offering that was registered on Form N-14"},
  {"form":"SEC ACTION","desciption":""},
  {"form":"253G4","category":"Exempt Offerings","desciption":""},
  {"form":"40-203A","desciption":""},
  {"form":"ATS-N","desciption":""},
  {"form":"ATS-N/UA","desciption":""},
  {"form":"C-TR-W","desciption":"Termination of Reporting Withdrawal"},
  {"form":"N-1","desciption":"Initial registration statement filed on Form N-1 for open-end management investment companies"},
  {"form":"S-4EF","category":"Registration Statements","desciption":"Auto effective registration statement for securities issued in connection with the formation of a bank or savings and loan holding company in compliance with General Instruction G"}
];
