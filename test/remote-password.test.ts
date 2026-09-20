import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteSession, validateRequest } from '../desktop/remote-session.mjs';

const password = 'synthetic-password-for-test';
const first = 'hs1_' + 'a'.repeat(43), second = 'hs1_' + 'b'.repeat(43);
function fixture() {
  const calls:any[] = [], state = { current: first, failChange: false, offline: false };
  const store = { value: { apiUrl: 'https://api.example.test/api/v1' } as any,
    load() { return this.value; }, save(apiUrl:string, token:string, remember:boolean) { this.value = {apiUrl, ...(remember ? {token} : {})}; } };
  const fetcher = async (url:string, options:any) => {
    calls.push({url,options}); if (state.offline) throw Error('ECONNREFUSED');
    const path = new URL(url).pathname, reply = (data:any,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
    if (path.endsWith('/health')) return reply({ok:true,service:'coop-bench',apiVersion:'v1'});
    if (path.endsWith('/auth/login') || path.endsWith('/auth/password')) {
      if (path.endsWith('/password') && state.failChange) return reply({error:password},401);
      if (path.endsWith('/password')) state.current = second;
      return reply({token:state.current, expiresAt:new Date(Date.now()+3600000).toISOString(),identity:{id:'owner',role:'operator'},passwordConfigured:true});
    }
    if (path.endsWith('/identity')) return reply({id:'owner',role:'operator'});
    if (path.endsWith('/auth/account')) return reply({userId:'owner',role:'operator',passwordConfigured:true,authentication:'password-session',unexpectedToken:first});
    if (path.endsWith('/auth/logout')) return reply({loggedOut:true});
    return reply({items:[]});
  };
  return {calls,state,store,session:new RemoteSession({fetcher,store})};
}
test('password login keeps session token in main, persists only session, verifies identity, and prevents generic auth access',async()=>{
  const {session,store,calls}=fixture();
  const value=await session.login({apiUrl:store.value.apiUrl,userId:'owner',password,remember:true});
  assert.equal(value.connected,true);assert.equal(value.identity.id,'owner');
  assert.equal(JSON.stringify(value).includes(first),false);assert.equal(JSON.stringify(store.value).includes(password),false);
  assert.equal(store.value.token,first);assert.equal(calls.find(c=>c.url.endsWith('/auth/login')).options.headers.Authorization,undefined);
  assert.equal(calls.find(c=>c.url.endsWith('/identity')).options.headers.Authorization,'Bearer '+first);
  assert.equal(JSON.stringify(await session.getAccount()).includes(first),false);
  for (const path of ['login','password','logout','account','status']) {
    assert.throws(()=>validateRequest({id:'x',path:'/api/v1/auth/'+path,method:'GET'}));
    assert.throws(()=>validateRequest({id:'x',path:'/api/v1/auth/'+path,method:'POST',body:{}}));
  }
});
test('password rotation preserves session on wrong current password, replaces it on success and logout revokes it',async()=>{
  const {session,store,state,calls}=fixture();
  await session.login({apiUrl:store.value.apiUrl,userId:'owner',password,remember:true});
  state.failChange=true;
  await assert.rejects(session.setPassword({password,currentPassword:password}),(error:any)=>error.code==='PASSWORD_REJECTED'&&!error.message.includes(password));
  assert.equal(session.descriptor().connected,true);assert.equal(store.value.token,first);
  state.failChange=false;
  const changed=await session.setPassword({password,currentPassword:password});
  assert.equal(changed.connected,true);assert.equal(store.value.token,second);assert.equal(JSON.stringify(changed).includes(second),false);
  const out=await session.logout();assert.equal(out.connected,false);assert.equal(store.value.token,undefined);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer '+second);
});
test('offline logout clears saved session and gives a safe warning; invalid inputs send no requests',async()=>{
  const {session,store,state,calls}=fixture();
  await assert.rejects(session.login({apiUrl:store.value.apiUrl,userId:'owner',password:''}));assert.equal(calls.length,0);
  await session.login({apiUrl:store.value.apiUrl,userId:'owner',password,remember:true});state.offline=true;
  const result=await session.logout();assert.equal(result.connected,false);assert.ok(result.logoutWarning);assert.equal(store.value.token,undefined);
  assert.equal(JSON.stringify(result).includes(first),false);
});
