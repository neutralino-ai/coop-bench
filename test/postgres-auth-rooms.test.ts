import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {PostgresAuth} from '../src/postgres-auth.ts';
import {PostgresAuthority} from '../src/postgres-authority.ts';
import {PostgresRooms} from '../src/postgres-rooms.ts';
import {tokenHash} from '../src/access-control.ts';
import {games} from '../src/registry.ts';

const connection=process.env.COOP_TEST_DATABASE_URL;
async function isolated(run:(a:pg.Pool,b:pg.Pool)=>Promise<void>){
  const schema=`coop_boundaries_${randomBytes(8).toString('hex')}`,admin=new pg.Client({connectionString:connection});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
  const settings={connectionString:connection,options:`-c search_path=${schema}`},a=new pg.Pool(settings),b=new pg.Pool(settings);
  try{await run(a,b);}finally{await Promise.all([a.end(),b.end()]);await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('PostgreSQL concurrent password setup/rotation has one winner; revocation cannot be undone by replica bootstrap',{skip:!connection,timeout:60000},async()=>{
  await isolated(async(poolA,poolB)=>{
    const personal=randomBytes(32).toString('base64url'),user={id:'owner',role:'operator' as const,tokenHash:tokenHash(personal),disabled:false},a=new PostgresAuth(poolA),b=new PostgresAuth(poolB);
    await Promise.all([a.ready([user]),b.ready([user])]);
    try {
      const passwords=['Synthetic-password-a-123','Synthetic-password-b-456'];
      const initial=await Promise.allSettled([a.setPassword(personal,'',{password:passwords[0]}),b.setPassword(personal,'',{password:passwords[1]})]);
      assert.equal(initial.filter(result=>result.status==='fulfilled').length,1);const winner=initial.findIndex(result=>result.status==='fulfilled'),first=(initial[winner] as PromiseFulfilledResult<any>).value;
      const session=await b.login({userId:'owner',password:passwords[winner]});assert.equal((await a.account(session.token,'')).userId,'owner');
      const replacements=['Synthetic-replaced-a-123','Synthetic-replaced-b-456'];
      const changed=await Promise.allSettled([a.setPassword(first.token,'',{currentPassword:passwords[winner],password:replacements[0]}),b.setPassword(first.token,'',{currentPassword:passwords[winner],password:replacements[1]})]);
      assert.equal(changed.filter(result=>result.status==='fulfilled').length,1);const replacement=changed.findIndex(result=>result.status==='fulfilled'),current=(changed[replacement] as PromiseFulfilledResult<any>).value;
      await assert.rejects(a.authorize(session.token,'','rollout:read'),{code:'UNAUTHORIZED'});await assert.rejects(b.authorize(first.token,'','rollout:read'),{code:'UNAUTHORIZED'});
      assert.equal((await a.login({userId:'owner',password:replacements[replacement]})).identity.id,'owner');
      await poolA.query('UPDATE coop_pg_users SET disabled=true WHERE id=$1',['owner']);
      await assert.rejects(b.authorize(current.token,'','episode:create'),{code:'UNAUTHORIZED'});await assert.rejects(b.authorize(personal,'','episode:create'),{code:'UNAUTHORIZED'});
      await b.ready([user]);await assert.rejects(a.authorize(personal,'','rollout:read'),{code:'UNAUTHORIZED'});
    }finally{await Promise.all([a.close(),b.close()]);}
  });
});

test('PostgreSQL room start and kick serialize: no game can start with a removed or unready roster',{skip:!connection,timeout:60000},async()=>{
  await isolated(async(poolA,poolB)=>{
    const a=new PostgresAuthority(poolA,games,'room-boundaries'),b=new PostgresAuthority(poolB,games,'room-boundaries');await Promise.all([a.ready(),b.ready()]);
    const roomsA=new PostgresRooms(a),roomsB=new PostgresRooms(b);await Promise.all([roomsA.readySchema(),roomsB.readySchema()]);
    const room=await roomsA.create('owner',{gameId:'hanabi',playerCount:2,scenarioId:'base'}),host=randomBytes(32).toString('base64url'),guest=randomBytes(32).toString('base64url');
    const first=await roomsA.join(room.roomId,room.inviteToken,{name:'Host',playerToken:host});
    const duplicate=await Promise.all([roomsA.join(room.roomId,room.inviteToken,{name:'Host retry',playerToken:host}),roomsB.join(room.roomId,room.inviteToken,{name:'Host retry',playerToken:host})]);
    assert.equal(duplicate[0].playerId,duplicate[1].playerId);
    const second=await roomsB.join(room.roomId,room.inviteToken,{name:'Guest',playerToken:guest});assert.notEqual(first.playerId,second.playerId);
    const roster=await roomsA.observe(room.roomId,host);
    await Promise.all([roomsA.ready(room.roomId,host,{ready:true,rosterVersion:roster.rosterVersion}),roomsB.ready(room.roomId,guest,{ready:true,rosterVersion:roster.rosterVersion})]);
    await assert.rejects(roomsB.start(room.roomId,guest),{code:'FORBIDDEN'});
    const raced=await Promise.allSettled([roomsA.start(room.roomId,host),roomsB.remove(room.roomId,second.playerId,host)]);
    assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);
    const after=await roomsB.observe(room.roomId,host);
    if(after.episodeId){
      assert.equal(after.members.length,2);assert.equal((await b.observe(after.episodeId,guest)).playerId,second.playerId);
      await assert.rejects(roomsA.remove(room.roomId,second.playerId,host),{code:'ROOM_CLOSED'});
    }else{
      assert.equal(after.members.length,1);await assert.rejects(roomsB.observe(room.roomId,guest),{code:'UNAUTHORIZED'});
      await assert.rejects(roomsA.join(room.roomId,room.inviteToken,{name:'Rejoin',playerToken:randomBytes(32).toString('base64url')}),{code:'UNAUTHORIZED'});
      await assert.rejects(roomsB.start(room.roomId,host),{code:'NOT_READY'});
      assert.equal(Number((await poolA.query('SELECT count(*) AS n FROM coop_pg_episodes')).rows[0].n),0);
    }
  });
});
