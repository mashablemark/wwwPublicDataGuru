"use strict";
//simpleServer serves files and templates, replacing "<<fileName>>" with content of sub-template contained in the file
//may require from Windows CMD> set NODE_TLS_UNAUTHORIZED=0
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
	css: 'text/css',
	png: 'image/png'
};
http.createServer(function (req, res) {
	var fileName = req.url.split('?')[0].substr(1) || 'index.html',
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
		case "compare.php":
			webGet('https://www.publicdata.guru/'+req.url, res,(rawHTML) => {
				res.writeHead(200, {'Content-Type': contentType});
				res.write(rawHTML);
				res.end();
			});
			break;
		case "viewer.php":
			if(q.doc.indexOf('-index') === -1){
				console.log(q.doc);
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
                webGet(edgarArchive + q.doc + (q.doc.indexOf('.html')==-1?'.html':''), res, (html)=>{
                	let labelPos = html.indexOf('iXBRL');
                	if(labelPos === -1){
                		console.log(edgarArchive + q.doc + '.html');
                        res.writeHead(200, {'Content-Type': contentType});
                        res.write(repoint(html));
                        res.end();
					} else {
                		let resourceEnd = html.substring(0, labelPos).lastIndexOf('</a>');
                		let resourceStart = html.substring(0, resourceEnd).lastIndexOf('>') + 1;
                		let resourceFile = html.substring(resourceStart, resourceEnd);
						let parts = q.doc.split('/');
						parts.pop();
						parts.push(resourceFile);
                		console.log(edgarArchive + parts.join('/'));
						fs.readFile('sec/'+fileName.replace('files/',''), 'utf8', function(err, body){
							if(err){
								console.log(req.url);
								console.log('Error 404: ' + 'sec/' + fileName);
								res.writeHead(404, {'Content-Type': contentType});
							} else {
								res.writeHead(200, {'Content-Type': contentType});
								body = body
									.replace('<?= $docIXBRL ?>', encodeURIComponent(edgarArchive + parts.join('/')))
									.replace(/<\?php[\s\S]+?\?>/gi, '');
								res.write(getSubTemplates(body));
							}
							res.end();
						});
					}

                });
			}
			break;
		default:	
			fs.readFile('sec/'+fileName.replace('files/',''), function(err, body){
				console.log('sec/'+fileName.replace('files/',''));
				if(err){
					console.log(req.url);
					console.log('Error 404: ' + 'sec/' + fileName);
					res.writeHead(404, {'Content-Type': contentType});
				} else {
					res.writeHead(200, {'content-type': contentType});
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
	console.log(url);
	process.env["NODE_TLS_REJECT_UNAUTHORIZED"]=0;
	https.get(url, (resp) => {
		let html = '';
		resp.on('data', (chunk) => {html += chunk;});
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
 