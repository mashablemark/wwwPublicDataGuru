"use strict";
//simpleServer serves files and templates, replacing "<<fileName>>" with content of sub-template contained in the file
//written for node 6.2.2
var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');
var templateRgx = /<<.+>>/;
var edgarArchive = 'https://www.sec.gov/Archives/edgar/data/';
var contentTypeMap = {
	html: 'text/html',
	htm: 'text/html',
	php: 'text/html',
	css: 'text/css'
};
http.createServer(function (req, res) {
	let fileName = req.url.split('?')[0].substr(1) || 'index.html',
		ext = fileName.split('.')[fileName.split('.').length-1],
		contentType = contentTypeMap[ext] || 'text/plain',
		q = url.parse(req.url, true).query;
	if(fileName.indexOf('files/')===0) fileName = fileName.replace('files/','');
	if(fileName.indexOf('sec/')===0) fileName = fileName.replace('sec/','');
	switch(fileName){
		case "getWebDoc.php":
			webGet(q.f, res, (html)=>{
				res.writeHead(200, {'Content-Type': contentType});
				res.write(q.repoint? repoint(html, q.f): html);
				res.end();
			});
			break;
		case "smartSearch.php":
			webGet('https://www.sec.gov', res, (rawHTML) => {
				res.writeHead(200, {'Content-Type': contentType});
				res.write(repoint(rawHTML).replace('<head>',
					`<head>
					<link  rel="stylesheet" href="/sec/global/js/jquery-ui/jquery-ui.css" />
					<link  rel="stylesheet" href="/sec/global/js/loadmask/jquery.loadmask.css" />
					<script type="text/javascript" src="/sec/global/js/jquery/jquery-3.3.1.min.js"></script>
					<script type="text/javascript" src="/sec/global/js/jquery-ui/jquery-ui.min.js"></script>
					<script type="text/javascript" src="/sec/global/js/loadmask/jquery.loadmask.min.js"></script>
					<script type="text/javascript" src="js/smartSearch.js"></script>`)
				);
				res.end();
			});
			break;
		case "smartSearchCompanyLanding.php":
			webGet('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK='+q.CIK, res, (rawHTML) => {
				res.writeHead(200, {'Content-Type': contentType});
				res.write(repoint(rawHTML).replace('<head>',
					`<head>
					<link  rel="stylesheet" href="/global/js/jquery-ui/jquery-ui.css" />
					<script type="text/javascript" src="global/js/jquery/jquery-3.3.1.min.js"></script>
					<script type="text/javascript" src="global/js/jquery-ui/jquery-ui.min.js"></script>
					<script src="js/smartSearchCompanyLanding.js"></script>`)
				);
				res.end();
			});
			break;
		case "viewer.php":
			if(q.doc.indexOf('-index.html')==-1){
                fs.readFile('sec/'+fileName.replace('files/',''), 'utf8', function(err, body){
                    if(err){
                        console.log(req.url);
                        console.log('Error 404: ' + 'sec/' + fileName);
                        res.writeHead(404, {'Content-Type': contentType});
                    } else {
                        res.writeHead(200, {'Content-Type': contentType});
                        body = body
                            .replace('<?= $docIXBRL ?>', encodeURIComponent(edgarArchive+q.doc+'.htm'))
                            .replace(/<\?php[\s\S]+?\?>/gi, '');
                        res.write(getSubTemplates(body));
                    }
                    res.end();
                });
			} else {
                webGet(q.doc, res, (html)=>{
                	if(html.indexOf('iXBRL')==-1){
                        res.writeHead(200, {'Content-Type': contentType});
                        res.write(html);
                        res.end();
					} else {

					}

                });
			}
			break;
		default:	
			fs.readFile('sec/'+fileName.replace('files/',''), 'utf8', function(err, body){
				if(err){
					console.log(req.url);
					console.log('Error 404: ' + 'sec/' + fileName);
					res.writeHead(404, {'Content-Type': contentType});
				} else {
					res.writeHead(200, {'Content-Type': contentType});
					res.write(getSubTemplates(body));
				}
				res.end();
			});
	}
}).listen(8080);

function getSubTemplates(template){
	var match;
	while(match = templateRgx.exec(template)){
		try{
			let subTemplate = fs.readFileSync(match[0].substring(2, match[0].length-2), 'utf8');
			template = template.replace(match[0], getSubTemplates(subTemplate));
		} catch(e){
			console.log('missing template: ' + subTemplate);
		}
	}
	return template;
}
function repoint(html, url = 'https://www.sec.gov/'){
	let domainStart = url.indexOf('//') + 2,
		pathStart = url.substr(domainStart).indexOf('/') + 1 + domainStart,
		fileNameStart = url.lastIndexOf('/')+1,
		protocolPlusDomain = url.substring(0, pathStart),
		path = url.substring(pathStart, fileNameStart);
	return html
        .replace(/src="([^\/])/gi, 'src="' + protocolPlusDomain + path + '$1')
	  	.replace(/src="\//gi, 'src="' + protocolPlusDomain)
	  	.replace(/href="([^\/])/gi, 'href="' + protocolPlusDomain + path + '$1')
        .replace(/href="\//gi, 'href="' + protocolPlusDomain)
	  	.replace(/href="https:\/\/www.sec.gov\/ix?doc=\/Archives\/edgar\/data\//gi, 'href="viewer.php?doc=');
}

function webGet(url, serverResponse, callback){
	https.get(url, (resp) => {
		let html = '';
		resp.on('data', (chunk) => {html += chunk;})
		resp.on('end', () => {
			callback(html);
		}); 
		resp.on("error", (err)=>{
			console.log('Error 404: ' + url);
			serverResponse.writeHead(404, {'Content-Type': contentType});
			serverResponse.end();
		})
	});
}
 