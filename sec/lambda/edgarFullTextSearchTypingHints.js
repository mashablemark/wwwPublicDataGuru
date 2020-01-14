// edgarFullTextSearchTypingHints.js runs as a AWS Lambda function in 128MB container
// reserved concurrency = 4 with average execution time of 10ms supports 400 responses / second
//


//REQUIRES LAMBDA LAYER "COMMON"
const common = require('common');
let newContainer = true;

exports.handler = async (req, context) => {
    if(req.keysTyped && req.keysTyped.length){
        const start = new Date();
        let result = await common.runQuery(`call eftsTypingHintsLookup(${common.q(req.keysTyped, true)})`);
        const hints = result.data[0][0];
        hints.status = 'ok';
        try {
            hints.branchTopHints = JSON.parse(hints.branchTopHints);
        } catch(ex) {
            console.log('JSON parsing error', hints.branchTopHints);
            hints.status = 'JSON parsing error';
        }
        //console.log(JSON.stringify(hints));
        hints.execTimeMS = (new Date()).getTime() - start.getTime();
        if(newContainer){
            hints.newContainer =  true;
            newContainer = false;
        }
        return hints;
    }
};


/*////////////////////TEST CARD  - COMMENT OUT WHEN LAUNCHING AS LAMBDA/////////////////////////
event = {
  "keysTyped": "ADI"
}
*/
