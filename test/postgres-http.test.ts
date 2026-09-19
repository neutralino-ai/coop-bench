import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {startPostgresApp} from '../src/postgres-server.ts';
import {tokenHash} from '../src/access-control.ts';

const url=process.env.COOP_TEST_DATABASE_URL;
test('PostgreSQL replicas share rooms, atomic start, seat observations, passwords, revocation and replay',{skip:!url,timeout:60000},async()=>{
  const schema='coop_http_'+randomBytes(8).toString('hex'),base=new pg.Client({connectionString:url});await base.connect();await base.query(`CREATE SCHEMA ${schema}`);
  const scoped=new URL(url!);scoped.searchParams.set('options',`-c search_path=${schema}`);
  const admin=randomBytes(32).toString('base64url'),userId='owner',password='Synthetic-test-only-'+randomBytes(8).toString('hex');
  const options={databaseUrl:scoped.href,adminToken:admin,port:0,build:'pg-http-test',users:[{id:userId,role:'operator' as const,tokenHash:tokenHash(admin),disabled:false}]};
  let a:Awaited<ReturnType<typeof startPostgresApp>>|undefined,b:typeof a;
  const call=async(server:NonNullable<typeof a>,path:string,token=admin,data?:any)=>{
    const response=await fetch(server.apiUrl+path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,body:await response.json()};
  };
  try{
    [a,b]=await Promise.all([startPostgresApp(options),startPostgresApp(options)]);
    const configured=await call(a,'/auth/password',admin,{password});assert.equal(configured.status,200);
    const login=await call(b,'/auth/login','',{userId,password});assert.equal(login.status,200);
    assert.equal((await call(a,'/identity',login.body.token)).body.id,userId);
    const changed=await call(a,'/auth/password',configured.body.token,{currentPassword:password,password:password+'-new'});assert.equal(changed.status,200);
    assert.equal((await call(b,'/identity',login.body.token)).status,401);
    assert.equal((await call(b,'/auth/login','',{userId,password})).status,401);
    assert.equal((await call(b,'/auth/login','',{userId,password:password+'-new'})).status,200);
    const game=a.authority.adapters.get('hanabi')!;
    const created=await call(a,'/rooms',admin,{gameId:'hanabi',playerCount:3,scenarioId:game.metadata.scenarios[0].id});assert.equal(created.status,201);
    const room=created.body.roomId,invite=created.body.inviteToken,tokens=Array.from({length:3},()=>randomBytes(32).toString('base64url'));
    const joins=await Promise.all(tokens.map((playerToken,i)=>call(i%2?a!:b!,`/rooms/${room}/join`,invite,{name:`Seat ${i+1}`,playerToken})));
    assert.ok(joins.every(j=>j.status===200));assert.equal(new Set(joins.map(j=>j.body.playerId)).size,3);
    const duplicate=await Promise.all([call(a,`/rooms/${room}/join`,invite,{name:'retry',playerToken:tokens[0]}),call(b,`/rooms/${room}/join`,invite,{name:'retry',playerToken:tokens[0]})]);assert.equal(duplicate[0].body.playerId,duplicate[1].body.playerId);
    const roster=(await call(b,`/rooms/${room}`,tokens[0])).body;
    for(let i=0;i<3;i++)assert.equal((await call(i%2?a:b,`/rooms/${room}/ready`,tokens[i],{ready:true,rosterVersion:roster.rosterVersion})).status,200);
    const starts=await Promise.all([call(a,`/rooms/${room}/admin-start`,admin,{}),call(b,`/rooms/${room}/admin-start`,admin,{})]);
    assert.ok(starts.every(s=>s.status===200));assert.equal(starts[0].body.episodeId,starts[1].body.episodeId);
    const id=starts[0].body.episodeId;
    const views=await Promise.all(tokens.map((t,i)=>call(i%2?a!:b!,`/episodes/${id}/observation`,t)));
    assert.ok(views.every(v=>v.status===200));assert.equal(new Set(views.map(v=>v.body.playerId)).size,3);
    assert.ok(views.every(v=>v.body.control.deadlineAt!==null));
    assert.equal((await call(a,`/episodes/${id}/audit`,tokens[0])).status,401);
    assert.equal((await call(b,`/episodes/${id}/rules`,tokens[0])).body.gameId,'hanabi');
    const waiting=await call(b,`/episodes/${id}/wait?after=${views[0].body.updateCursor}&timeoutMs=25`,tokens[0]);assert.equal(waiting.status,200);assert.equal(waiting.body.timedOut,true);
    // A disconnected API process does not own this game or its authoritative deadline.
    await a.close();a=undefined;
    assert.equal((await call(b,`/episodes/${id}/observation`,tokens[0])).body.control.deadlineAt,views[0].body.control.deadlineAt);
    assert.equal((await call(b,`/episodes/${id}/truncate`,admin,{reason:'synthetic-test-finished'})).status,200);
    assert.equal((await call(b,`/episodes/${id}/replay`)).body.valid,true);
    const rollout=await call(b,`/rollouts/${id}`);assert.equal(rollout.status,200);assert.equal(rollout.body.summary.status,'truncated');
    assert.ok(rollout.body.frames.length>=2);assert.ok(!(JSON.stringify(rollout.body).includes(tokens[0])));
    const messages=await call(b,`/rollouts/${id}/messages`);assert.equal(messages.status,200);assert.ok(messages.body);
  }finally{await a?.close();await b?.close();await base.query(`DROP SCHEMA ${schema} CASCADE`);await base.end();}
});
