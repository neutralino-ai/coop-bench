// Trusted local transport helper: only the existing Coop Bench HTTPS origin.
// Credentials arrive on SSH stdin; no credential file, headers or payload is logged.
let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>128*1024)throw Error('Relay request too large');}
const input=JSON.parse(text);
if(!['GET','POST'].includes(input.method)||typeof input.path!=='string'||!(input.path==='/health'||input.path.startsWith('/api/v1/'))||/[\r\n#]/.test(input.path))throw Error('Invalid relay request');
const url=new URL(input.path,'https://coop.neutrinophysics.cn');
if(url.origin!=='https://coop.neutrinophysics.cn')throw Error('Invalid origin');
const headers=new Headers();
for(const [key,value]of Object.entries(input.headers??{})){
  if(!['authorization','content-type','idempotency-key'].includes(key.toLowerCase())||typeof value!=='string')throw Error('Invalid relay header');headers.set(key,value);
}
if(input.body!==undefined&&(typeof input.body!=='string'||Buffer.byteLength(input.body)>65536))throw Error('Invalid relay body');
const response=await fetch(url,{method:input.method,headers,...(input.body!==undefined?{body:input.body}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
const chunks=[];let size=0;
for await(const chunk of response.body??[]){size+=chunk.byteLength;if(size>64*1024*1024)throw Error('Relay response too large');chunks.push(chunk);}
process.stdout.write(JSON.stringify({status:response.status,headers:Object.fromEntries(response.headers),bodyBase64:Buffer.concat(chunks).toString('base64')}));
