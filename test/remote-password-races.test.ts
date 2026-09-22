import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteSession } from '../desktop/remote-session.mjs';

const password='Synthetic password race fixture!',first='hs1_'+'a'.repeat(43),second='hs1_'+'b'.repeat(43);
function deferred(){let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return {promise,resolve};}
function fixture(){
  const calls:any[]=[],state={role:'operator',current:first,accountStatus:200,identityStatus:200,passwordGate:null as ReturnType<typeof deferred>|null,failSaving:false};
  const store={value:{apiUrl:'https://old.example.test/api/v1'} as any,load(){return this.value;},save(apiUrl:string,token:string,remember:boolean){if(state.failSaving&&token===second)throw Error('synthetic private storage error '+token);this.value={apiUrl,...(remember?{token}:{})};}};
  const json=(value:any,status=200)=>Response.json(value,{status});
  const session=new RemoteSession({store,fetcher:async(url:string,options:any)=>{
    const path=new URL(url).pathname;calls.push({url,path,options});
    if(path==='/api/v1/health')return json({ok:true,service:'coop-bench',apiVersion:'v1'});
    if(path==='/api/v1/auth/password'){if(state.passwordGate)await state.passwordGate.promise;state.current=second;return json({token:second,expiresAt:new Date(Date.now()+3600000).toISOString(),identity:{id:'owner',role:state.role}});}
    if(path==='/api/v1/auth/login')return json({token:state.current,expiresAt:new Date(Date.now()+3600000).toISOString(),identity:{id:'owner',role:state.role}});
    if(path==='/api/v1/identity')return json(state.identityStatus===200?{id:'owner',role:state.role}:{error:{code:'UNAUTHORIZED'}},state.identityStatus);
    if(path==='/api/v1/auth/account')return json({userId:'owner',role:state.role,passwordConfigured:true,authentication:'password-session'},state.accountStatus);
    return json({items:[],total:0});
  }});
  const login=(apiUrl=store.value.apiUrl,secret=password)=>session.login({apiUrl,userId:'owner',password:secret,remember:true});
  return {calls,state,store,session,login};
}

test('a completed old account 401 cannot disconnect a newer password login',async()=>{
  const f=fixture();await f.login();f.state.accountStatus=401;const original=f.session.wire.bind(f.session);let switched=false;
  f.session.wire=async(...args:any[])=>{const response=await original(...args);if(!switched&&args[2].path==='/api/v1/auth/account'){switched=true;await f.login('https://new.example.test/api/v1');}return response;};
  await assert.rejects(f.session.getAccount(),{code:'CANCELLED'});
  assert.equal(f.session.descriptor().connected,true);assert.equal(f.session.descriptor().apiUrl,'https://new.example.test/api/v1');assert.equal(f.store.value.token,first);
});

test('new private reads, heartbeat and repeated password submissions are blocked throughout rotation',async()=>{
  const f=fixture();await f.login();f.state.passwordGate=deferred();
  const change=f.session.setPassword({password,currentPassword:password});
  await assert.rejects(f.session.request({id:'heartbeat',path:'/api/v1/identity',method:'GET'}),{code:'CANCELLED'});
  await assert.rejects(f.session.getAccount(),{code:'CANCELLED'});await assert.rejects(f.session.setPassword({password,currentPassword:password}),{code:'CANCELLED'});
  assert.equal(f.calls.filter(call=>call.path==='/api/v1/auth/password').length,1);assert.equal(f.calls.filter(call=>call.path==='/api/v1/identity').length,1);
  assert.equal((await f.session.request({id:'public',path:'/api/v1/health',method:'GET'})).status,200);
  f.state.passwordGate.resolve();await change;
  assert.equal(f.store.value.token,second);assert.equal((await f.session.getAccount()).userId,'owner');assert.equal(f.session.passwordEpoch,null);
});

test('switching servers during password rotation discards the old commit without blocking the new connection',async()=>{
  const f=fixture();await f.login();f.state.passwordGate=deferred();
  const change=f.session.setPassword({password,currentPassword:password});
  await f.login('https://new.example.test/api/v1');f.state.passwordGate.resolve();await assert.rejects(change,{code:'CANCELLED'});
  assert.equal(f.session.descriptor().apiUrl,'https://new.example.test/api/v1');assert.equal(f.session.descriptor().connected,true);assert.equal(f.store.value.token,first);
  assert.equal(f.session.passwordEpoch,null);assert.equal((await f.session.getAccount()).userId,'owner');
});

test('an authenticated role update is accepted without changing the account subject',async()=>{
  const f=fixture();await f.login();f.state.role='member';const result=await f.session.getAccount();
  assert.equal(result.role,'member');assert.equal(f.session.descriptor().identity.role,'member');assert.equal(result.userId,'owner');
});

test('Unicode password validation matches backend codepoint limits and does not trim secrets',async()=>{
  const f=fixture(),unicode='😀'.repeat(100);await f.login(undefined,unicode);
  assert.equal(JSON.parse(f.calls.find(call=>call.path==='/api/v1/auth/login').options.body).password,unicode);
  await f.session.setPassword({password:'  spaced synthetic password  ',currentPassword:'x'});
  assert.equal(JSON.parse(f.calls.find(call=>call.path==='/api/v1/auth/password').options.body).password,'  spaced synthetic password  ');
  const before=f.calls.length;for(const invalid of ['😀'.repeat(129),'😀'.repeat(6),' '.repeat(20),'broken surrogate \ud800'])await assert.rejects(f.session.setPassword({password:invalid}));
  assert.equal(f.calls.length,before);
});

test('a committed password update with failed secure storage clears old credentials and reports re-login without leaking the minted token',async()=>{
  const f=fixture();await f.login();f.state.failSaving=true;
  await assert.rejects(f.session.setPassword({password,currentPassword:password}),(error:any)=>error.code==='PASSWORD_UPDATED_RELOGIN'&&!error.message.includes(second)&&!error.message.includes(password));
  assert.equal(f.session.descriptor().connected,false);assert.equal(f.store.value.token,undefined);assert.equal(f.session.passwordEpoch,null);
  f.state.failSaving=false;await f.login();assert.equal(f.store.value.token,second);
});
