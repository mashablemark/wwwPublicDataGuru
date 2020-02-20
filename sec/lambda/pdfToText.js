const fs = require("fs");
const os = require('os');
const path = require('path');
const exec = require('child_process').exec
//const multipart = require('parse-multipart');

process.env['PATH'] =
    process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'] + '/dist/';


exports.handler = async (event, context, callback) => {
    console.log('hi mom');
    const folders = [process.env['LAMBDA_TASK_ROOT'], '/var/task'];
    for(let i=0; i< folders.length;i++){
        console.log(i);
        console.log(folders[i]);
        console.log(fs.readdirSync(folders[i]));

        //for (var i=0; i<items.length; i++) {
        //    console.log(items[i]);
        //}
    }

    try {
        console.log(`Event is: ${JSON.stringify(event)}`);
        const config = processPayload(event);
        console.log('Form Response is: ' + JSON.stringify(config));

        const controller = new PDFToText(config);
        const pdfResp = await controller.run();
        console.log(`PDF Response is: ${pdfResp}`);

        return context.succeed({
            statusCode: 200,
            body: pdfResp.text,
            headers: {'Content-Type': 'application/json'}
        });
    } catch (e) {
        console.log(`Application ERROR: ${e}`);
        return context.fail({
            statusCode: 500,
            body: `Application Error: ${e}`
        });
    }

    function processPayload(event) {
        console.log(process.env['PATH']);
        console.log(process.env['LAMBDA_TASK_ROOT']);
        console.log(os.tmpdir());

        const result = {};
        const contentType =
            event['content-type'] || event['Content-Type'];

        if (contentType === 'application/pdf') {
            result.filename = 'test.pdf';
            result.data = Buffer.from(event.body, 'base64');
            return result;
        }
    }

};



/**
 * Transform a PDF to Text
 */

class PDFToText
{
    /**
     * @param {fileName} - name of the file
     * @param {fileData} - a buffer representing file contents
     */
    constructor(config) {
        this.fileName = config.filename;
        this.fileData = config.data;
        this.filePath = path.join(os.tmpdir(), path.basename(this.fileName));
        console.log(`PDFToText init with: ${this.fileName} ${this.filePath} ${JSON.stringify(this.fileData)}`);
    }

    /**
     * Write a buffer to disk
     * @param {filePath} - path to the file
     * @param {fileData} - the buffer to be written to disk
     */
    async write_file(filePath, fileData){
        return new Promise(function(resolve, reject) {
            console.log(`Will write file: ${filePath} with data: ${JSON.stringify(fileData)}`);
            fs.writeFile(filePath, fileData, 'binary', function (err) {
                if (err) { reject('Writing file failed: ' + err) }
                console.log('Wrote pdf file to: ' + filePath);
                resolve();
            });
        });
    }

    /**
     * Runs `pdftotext` command on a filePath of a PDF
     * @param {filePath}
     * @return {String} - represents the text of the PDF file
     */
    async get_text(filePath) {
        return new Promise(function(resolve, reject) {
            console.log('Going to run pdftotext on: ' + filePath);
            console.log('System Path: ' + process.env.PATH);
            const cmd = 'pdftotext '
            const opts = ' - '
            const allCmd = cmd + '"' + filePath + '"' + opts;
            let result = '';

            const child = exec(allCmd);

            // Log process stdout and stderr
            child.stderr.on('data', function (error){
                throw new Error(`Failed to run command: ${allCmd} with error: ${error}`)
            });
            child.stdout.on('data', function(data) {
                result += data.toString();
            });
            child.on('close', function(code) {
                console.log('stdout result: ' + result);
                resolve(result);
            });
        });
    }


    /**
     * Runs the action
     * @return {pdfText} - A string representing text of a PDF
     */
    async run() {
        await this.write_file(this.filePath, this.fileData);
        // await this.write_s3(this.filePath);
        const pdfText = await this.get_text(this.filePath);
        console.log('Returning from PDFToText: ' + pdfText);

        return { "text": pdfText, "path": this.filePath };
    }
}
