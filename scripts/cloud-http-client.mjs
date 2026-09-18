import { spawn } from 'node:child_process';

/** Fetch-compatible transport to the already installed service, over the user's
 * SSH connection. The application request still uses its ordinary seat/owner
 * credential and the service's HTTPS endpoints. Does not read game state. */
export async function cloudFetch(value,options={}) {
  const url=new URL(String(value));
  if(url.origin!=='https://coop.neutrinophysics.cn'||url.username||url.password||url.hash||!(url.pathname==='/health'||url.pathname.startsWith('/api/v1/')))throw Error('Unsupported Coop Bench URL');
  const method=options.method??'GET',headers=Object.fromEntries(new Headers(options.headers??{}));
  if(!['GET','POST'].includes(method)||options.body!==undefined&&typeof options.body!=='string')throw Error('Unsupported request');
  const input=JSON.stringify({method,path:url.pathname+url.search,headers,...(options.body!==undefined?{body:options.body}:{})});
  return new Promise((resolve,reject)=>{
    const process=spawn('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@62.234.160.98',
      '/opt/coop-bench-node/bin/node /home/ubuntu/coop-bench-stage-hanabi/game-http-relay.mjs'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const chunks=[];let size=0,finished=false;
    const fail=()=>{if(finished)return;finished=true;clearTimeout(timer);process.kill();reject(Error('Cloud relay transport failed; request outcome may be uncertain.'));};
    const timer=setTimeout(fail,45000);options.signal?.addEventListener('abort',fail,{once:true});
    process.on('error',fail);process.stdin.on('error',fail);process.stderr.on('data',()=>{});
    process.stdout.on('data',chunk=>{size+=chunk.length;if(size>96*1024*1024)fail();else chunks.push(chunk);});
    process.on('close',code=>{
      clearTimeout(timer);options.signal?.removeEventListener('abort',fail);if(finished)return;finished=true;
      if(code!==0)return reject(Error('Cloud relay request failed; no credentials were logged.'));
      try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve(new Response(Buffer.from(result.bodyBase64,'base64'),{status:result.status,headers:result.headers}));}
      catch{reject(Error('Invalid cloud relay response.'));}
    });
    if(options.signal?.aborted)return fail();process.stdin.end(input);
  });
}
