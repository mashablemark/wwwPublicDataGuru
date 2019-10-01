// fetchTimeSeries.js runs as a AWS Lambda function able to be run with hgih concurrency
//
//   1. fetches data by key from sources:
//      a) FRED data
//      b) historical stock price data
//   2. if successful, loads / update into database's econ_series table and return ID
//   3. if not successful, return false


//REQUIRES LAMBDA LAYER "COMMON"
const common = require('common');
const https = require('https');

exports.handler = async (event, context) => {
    let now = new Date(),
        today = now.toISOString().substr(0, 10),
        startdt, enddt, sql;
    const q = common.q;

    switch (event.src) {
        case "FRED":  //https://research.stlouisfed.org/docs/api/fred/
            const FRED_KEY = '975171546acb193c402f70777c4eb46d';
            const headerRestCall = `https://api.stlouisfed.org/fred/series?series_id=${event.key}&api_key=${FRED_KEY}&file_type=json`;
            const fredHeaderPromise = webGet(headerRestCall);

            const observationsRestCall = `https://api.stlouisfed.org/fred/series/observations?series_id=${event.key}&api_key=${FRED_KEY}&observation_start=2008-01-01&sort_order=asc&file_type=json`;
            const fredObservationsPromise = webGet(observationsRestCall);

            let headerResponse = await fredHeaderPromise;
            let header = JSON.parse(headerResponse).seriess[0];
            let obsResponse = await fredObservationsPromise;
            let obs = JSON.parse(obsResponse);

            let data = [];
            for (let i = 0; i < obs.observations.length; i++) {
                data.push([obs.observations[i].date, isNaN(obs.observations[i].value)? null : parseFloat(obs.observations[i].value)]);
            }
            startdt = obs.observations[0].date;
            enddt = obs.observations[obs.observations.length - 1].date;

            sql = `replace into econ_series (src, srckey, name, units, adjusted, freq, startdt, enddt, updatedt, data)
                values (${q(event.src)} ${q(event.key)} ${q(header.title)} ${q(header.units)}
                '${header.seasonal_adjustment_short}', '${header.frequency_short}', '${startdt}', '${enddt}', '${today}', '${JSON.stringify(data)}')`;
            await common.runQuery(sql);
            return true;
            break;
        case "TICKER":  //https://www.alphavantage.co/documentation/
            //sample data:  https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=MSFT&apikey=demo
            const ALPHA_AD_KEY = 'TK1VKUIR9WGPGIE4';
            const restCall = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=${event.key}&apikey=${ALPHA_AD_KEY}`;
            console.log(restCall);
            const response = await webGet(restCall);
            console.log('response received');
            const alphaData = JSON.parse(response.replace(/\n/g, ''));
            //console.log(JSON.stringify(alphaData, null, 2));
            if(alphaData['Error Message']){
                console.log('error', alphaData['Error Message']);
                sql = `replace into econ_series (src, srckey, name, units, adjusted, freq, startdt, enddt, updatedt, data)
                values ('${event.src}', '${event.key}', 'not found', '', '', '', '', '', '', '${JSON.stringify(alphaData)}')`;
                await common.runQuery(sql);
                return false;
            } else {
                let closings = alphaData['Weekly Adjusted Time Series'];
                const keys = [];
                for(let key in closings){if(key>='2000-01-01') keys.push(key);}
                keys.sort();  //ascending
                let tickerData = [];
                for(let i=0;i<keys.length;i++){
                    tickerData.push([keys[i], parseFloat(closings[keys[i]]["5. adjusted close"]), parseFloat(closings[keys[i]]["6. volume"]), parseFloat(closings[keys[i]]["7. dividend amount"])]);
                }
                sql = `replace into econ_series (src, srckey, name, units, adjusted, freq, startdt, enddt, updatedt, data)
                values ('${event.src}', '${event.key}', null, 'dollars/shares/div dollars', 
                'SA', 'W', '${keys[0]}', '${keys[keys.length-1]}', '${today}', '${JSON.stringify(tickerData)}')`;
                await common.runQuery(sql);
                if(tickerData.length==0) console.log(JSON.stringify(alphaData, null, 2));
                return tickerData.length;
            }
            break;
        default:
            throw('unrecognized source ' + event.src);
    }
};

function webGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url,
            (resp) => {
                let data = '';
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                resp.on('end', () => {
                    resolve(data);
                });
                resp.on("error", (err) => {
                    reject(err);
                });
            }
        );
    });
}

/*////////////////////TEST CARD  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
event = {
  "src": "FRED",
  "key": "GNPCA"
}
event = {
  "src": "TICKER",
  "key": "ADI"
}

*/
