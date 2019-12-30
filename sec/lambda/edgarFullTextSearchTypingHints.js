// edgarFullTextSearchTypingHints.js runs as a AWS Lambda function in 128MB container
// reserved concurrency = 4 with average execution time of 10ms supports 400 responses / second
//


//REQUIRES LAMBDA LAYER "COMMON"
const common = require('common');
const MAX_TYPE_AHEAD_LENGTH = 10;

exports.handler = async (req, context) => {
    const start = new Date();
    if(req.keysTyped){
        const lettersSearched = req.keysTyped.replace(/[\.;\\\s]/g,' ');
        let lengthFound = Math.min(lettersSearched.length, MAX_TYPE_AHEAD_LENGTH);
        while(lengthFound>0){
            let sql = `select  keys_typed as matched_letters, json_top_matches from entity_type_ahead where keys_typed=${common.q(lettersSearched.substr(0,lengthFound),true)}`;
            let result = await common.runQuery(sql);
            console.log(result);
            if(result[0].length) {
                const hints = result[0];
                hints.keysTyped = req.keysTyped;
                hints.lettersSearched = req.lettersSearched;
                hints.execTime = start.getTime() - (new Date()).getTime();
                return JSON.stringify(hints);
            }
            lengthFound--;
        }
        return JSON.stringify({
            keysTyped: req.keysTyped,
            lettersSearched: req.lettersSearched,
            execTime: start.getTime() - (new Date()).getTime(),
            matched_letters: null
        });
    }
};


/*////////////////////TEST CARD  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
event = {
  "keysTyped": "ADI"
}
*/
