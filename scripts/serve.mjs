import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const routes=new Map([
  ['/', ['index.html','text/html; charset=utf-8']], ['/index.html',['index.html','text/html; charset=utf-8']],
  ...['app.mjs','core.mjs','zip.mjs'].map(name=>['/src/'+name,['src/'+name,'text/javascript; charset=utf-8']]),
  ['/src/styles.css',['src/styles.css','text/css; charset=utf-8']],
  ...['target.dxf','donor.dxf'].map(name=>['/fixtures/owner-complete/'+name,['fixtures/owner-complete/'+name,'text/plain; charset=us-ascii']]),
]);
const port=Number(process.env.PORT||4173);
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400);res.end();return;}
  const entry=routes.get(pathname);
  if(!entry){res.writeHead(404);res.end('Not found');return;}
  try{const bytes=await readFile(path.join(root,entry[0]));res.writeHead(200,{'Content-Type':entry[1],'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log('BlockBridge at http://127.0.0.1:'+server.address().port));
