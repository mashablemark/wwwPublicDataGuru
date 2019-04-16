var AWS = require('aws-sdk');
var s3 = new AWS.S3();

async function readS3(file){
    return new Promise((resolve, reject) => {
        let bucketPath = 's3://restapi.publicdata.guru/sec/';
        var params = {
            Bucket: "restapi.publicdata.guru",
            Key: "sec/" + file
        };
        s3.getObject(params, (err, data) => {
            if (err) console.log(err, err.stack); // an error occurred
            else     resolve(data.Body.toString('utf-8'));   // successful response  (alt method = createreadstreeam)
        });
    });
}


exports.handler = async (event, context) => {
    const tasks = {};
    for(let file in event.files){
        tasks[event.files[file]] = readS3(event.files[file]);
    }

    let json = {};
    for(let file in event.files){
        json[event.files[file]] = await tasks[event.files[file]];
    }
    return json;
};
