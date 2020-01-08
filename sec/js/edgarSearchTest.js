"use strict";

var entity = false;  //holds the entity info once selected
$(document).ready(function() {
    const hashValues = getHashValues();
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
    //load form categories and configure selection event
    const $category = $('#form-category');
    const $forms = $('#forms');
    const options = ['<option value="" disabled selected>choose a form category</option>'];
    for(let i in formCategories){
        options.push('<option value="'+formCategories[i][1]+'">'+formCategories[i][0]+'</option>');
    }
    $category
        .html(options.join(''))
        .change(function(event){
            $('#forms').val($category.val());
    }).change(function(event){$forms.val()});
    //configure the forms text event
    $forms.keydown(function(){
        $category.prop('selectedIndex',0);
    });
    //load locations selector and configure selection event
    const $locations = $('#location');
    const locationOptions = ['<option value="" selected>all locations</option>'];
    for(let i=0;i<locationCodes.length;i++){
        locationOptions.push('<option value="'+locationCodes[i][0]+'">'+locationCodes[i][1]+'</option>');
    }
    $locations.html(locationOptions.join(''));

    //configure date range buttonSet
    $('#date-range').controlgroup().change(function(event){
        let startDate = new Date();  //today
        switch($(this).find(':checked').val()){
            case 'custom':
                $('#date-range-custom-pickers').show();
                return;
            case 'last-month':
                startDate.setMonth(startDate.getMonth()-1);
                break;
            case 'last-year':
                startDate.setFullYear(startDate.getFullYear()-1);
                break;
            case 'last-10-years':
                startDate.setFullYear(startDate.getFullYear()-10);
                break;
        }
        $('#datepicker_from').val(startDate.toLocaleDateString());
        $('#datepicker_to').val((new Date()).toLocaleDateString());
        $('#date-range-custom-pickers').hide();

    }).change();
    //configure datapickers
    $('.datapicker input').datepicker({
        changeMonth: true,
        changeYear: true,
        minDate: "-2M",  //"-10Y" for production
        maxDate: 0
    });

    $('#search').click(executeSearch);
});

function getHashValues(){

}

function setHashValues(){
    let formValues = {
        q: $('#keywords').val(),
        dateRange: $('#date-range').find(':checked').val(),
        startdt: $('#datepicker_from').val(),
        enddt: $('#datepicker_to').val(),
        category: $('#form-category').val(),
        cik: entity?entity.cik:false,
        forms: $('#forms').val().replace(/[/s;,+]+/i,',').trim().split(',')
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
            console.log('successfully talked to Lambda function!');
            console.timeEnd(label);
            $('#results').html(JSON.stringify(data));
            console.log('sucessful roundtrip execution time for '+hintsURL+ ' = '+((new Date()).getTime()-start.getTime())+' ms');
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.log(textStatus);
            throw(errorThrown);
        }
    });
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

const formCategories = [
    ['Insider transactions', '3, 4, 5'],
    ['Financial statements (e.g. Annual Reports)', '10-K, 10-Q, 8-K']
];

const locationCodes = [
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
