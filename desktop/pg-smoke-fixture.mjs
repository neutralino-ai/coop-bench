// Test-driver only. The packaged apps connect over HTTP and never need pg or a
// database credential. Every run gets a fresh schema on an explicitly local DB.
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

export async function startPostgresSmoke(databaseUrl) {
  const parsed=new URL(databaseUrl);assert.ok(['postgres:','postgresql:'].includes(parsed.protocol)&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname),'Desktop smoke accepts only an isolated local PostgreSQL test server.');
  const {default:pg}=await import('pg');const {startPostgresApp}=await import('../src/postgres-server.ts');
  const base=new pg.Client({connectionString:databaseUrl}),schema='coop_desktop_'+randomBytes(10).toString('hex');await base.connect();
  await base.query(`CREATE SCHEMA ${schema}`);parsed.searchParams.set('options',`-c search_path=${schema}`);
  const token='synthetic-owner-'+randomUUID();let api,control;
  const close=async()=>{await api?.close();if(control){control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}await base.query(`DROP SCHEMA ${schema} CASCADE`);await base.end();};
  try{
    api=await startPostgresApp({databaseUrl:parsed.href,adminToken:token,port:0,serveWeb:false,trustedProxyOrigin:'https://synthetic.example.test'});
    control=createServer(async(req,res)=>{
      if(req.method!=='POST'||req.url!=='/close'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(404);res.end();return;}
      try{await api.close();res.end('closed');}catch{res.writeHead(500);res.end('close failed');}
    });
    await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(0,'127.0.0.1',resolve);});
    return {env:{COOP_SMOKE_EXTERNAL_API:api.apiUrl,COOP_SMOKE_EXTERNAL_TOKEN:token,COOP_SMOKE_EXTERNAL_STOP:`http://127.0.0.1:${control.address().port}/close`},close};
  }catch(error){await close();throw error;}
}

export function externalSmokeFixture() {
  const apiUrl=process.env.COOP_SMOKE_EXTERNAL_API;if(!apiUrl)return null;
  const api=new URL(apiUrl),stop=new URL(process.env.COOP_SMOKE_EXTERNAL_STOP),adminToken=process.env.COOP_SMOKE_EXTERNAL_TOKEN;
  assert.ok([api,stop].every(u=>u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&!u.search&&!u.hash)&&api.pathname==='/api/v1'&&stop.pathname==='/close'&&/^synthetic-owner-[a-f0-9-]{36}$/.test(adminToken),'Invalid isolated desktop fixture.');
  let stopped=false;
  return {apiUrl,baseUrl:api.origin,adminToken,backend:'postgresql',async close(){if(stopped)return;const response=await fetch(stop,{method:'POST',headers:{Authorization:`Bearer ${adminToken}`},signal:AbortSignal.timeout(15000)});assert.ok(response.ok,'Synthetic PostgreSQL API did not close');stopped=true;}};
}
