import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {startMockApi} from '../desktop/mock-api.mjs';
const mock=await startMockApi(),password='synthetic-ios-password-only';
await mock.call('/auth/password',mock.adminToken,{password});
await mkdir('artifacts/ios',{recursive:true});
// Network fault fixture only: drop one accepted action response, then verify
// the native outbox retries the identical command with its original key.
let dropped=false,retries=0;const actions=new Map();
const proxy=createServer(async(req,res)=>{
 try{
  if(req.url==='/_ios/slow'){
   res.writeHead(200,{'Content-Type':'application/json'});res.write('{"ok":');
   const timer=setInterval(()=>res.write(' '),100),finish=setTimeout(()=>{clearInterval(timer);res.end('true}')},5000);
   res.on('close',()=>{clearInterval(timer);clearTimeout(finish)});return;
  }
  if(req.url==='/_ios/redirect'){res.writeHead(302,{Location:mock.apiUrl+'/health'});res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  if(req.url.endsWith('/actions')){
   const key=req.headers['idempotency-key'],digest=createHash('sha256').update(body).digest('hex');
   if(!key)throw Error('Native action omitted Idempotency-Key');
   if(actions.has(key)){if(actions.get(key)!==digest)throw Error('Retry changed the action body');retries++;}
   actions.set(key,digest);
  }
  const response=await fetch(mock.baseUrl+req.url,{method:req.method,headers:{...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),'Content-Type':'application/json',...(req.headers['idempotency-key']?{'Idempotency-Key':req.headers['idempotency-key']}:{})},...(body.length?{body}:{}),redirect:'manual'});
  const bytes=Buffer.from(await response.arrayBuffer());
  if(req.url.endsWith('/actions')&&!dropped){dropped=true;res.destroy();return;}
  await writeFile('artifacts/ios/network-fixture.json',JSON.stringify({droppedAcceptedResponse:dropped,identicalActionRetries:retries}));
  res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json'});res.end(bytes);
 }catch{res.writeHead(500);res.end('{"error":{"code":"IOS_FIXTURE_ASSERTION"}}');}
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
await writeFile('artifacts/ios/launch.txt',Buffer.from(JSON.stringify({apiUrl:`http://127.0.0.1:${proxy.address().port}/api/v1`,password})).toString('base64'));
process.on('SIGTERM',async()=>{proxy.closeAllConnections();proxy.close();await mock.close();process.exit(0)});
console.log('Loopback iOS synthetic fixture ready.');
