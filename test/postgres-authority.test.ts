import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { PostgresAuthority } from '../src/postgres-authority.ts';
import { takeTime } from '../src/games/take-time.ts';
import { hanabi } from '../src/games/hanabi.ts';
import { crewDeepSea } from '../src/games/crew.ts';
import { check,clone } from '../src/common.ts';
import type { GameAdapter,Action } from '../src/types.ts';
import type { Envelope } from '../src/authority.ts';
import { games } from '../src/registry.ts';
import { mechanicalPolicy,mechanicalScheduler } from '../src/local-runner.ts';

const connection=process.env.COOP_TEST_DATABASE_URL;
const command=(observation:Envelope,action:Action)=>({observationId:observation.observationId,decisionToken:observation.decisionToken,action});
const takeSetup={playerCount:3,scenarioId:'official-clock-1-1',seed:'postgres-repro'};
const fixture:GameAdapter={metadata:{...takeTime.metadata,id:'postgres-test-fixture'},setup:()=>({round:0,hidden:{},last:null}),
  observe:(s,p)=>({round:s.round,last:s.last,own:s.hidden[p]??null}),activePlayers:()=>['p1','p2','p3'],legalActions:()=>[],
  step:(original,p,a)=>{const s=clone(original);check(a.type==='private'||a.type==='say'||a.type==='next','Unknown action.');
    if(a.type==='private')s.hidden[p]=a.value;else if(a.type==='say')s.last={p,text:a.text};else s.round++;return s;},outcome:()=>null,
  decisionWindow:s=>({key:String(s.round),players:['p1','p2','p3'],mode:'all'})};

test('PostgreSQL authority: real multi-instance commits and durable evidence',{skip:!connection,timeout:120000},async t=>{
  // Dedicated random schema: no production table or another test suite is touched.
  const schema=`coop_test_${randomUUID().replaceAll('-','')}`,admin=new pg.Pool({connectionString:connection});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config={connectionString:connection,options:`-c search_path=${schema}`,max:20};
  const pools=[new pg.Pool(config),new pg.Pool(config)];
  const build='postgres-test-pinned',adapters=[...games,fixture];
  const a=new PostgresAuthority(pools[0],adapters,build,{maxEpisodes:200,maxActiveEpisodes:100,maxCommandsPerEpisode:2000});
  const b=new PostgresAuthority(pools[1],adapters,build,{maxEpisodes:200,maxActiveEpisodes:100,maxCommandsPerEpisode:2000});
  await Promise.all([a.ready(),b.ready()]);
  try{
    await t.test('same seed creates identical cards across IDs; seats and histories survive another API instance',async()=>{
      const c=await a.create('hanabi',{playerCount:3,scenarioId:'base',seed:'paired'}),d=await b.create('hanabi',{playerCount:3,scenarioId:'base',seed:'paired'});
      const x=await a.observe(c.episodeId,c.seats[0].token),y=await b.observe(d.episodeId,d.seats[0].token);
      assert.deepEqual(x.view,y.view);assert.notEqual(c.episodeId,d.episodeId);
      assert.ok(!JSON.stringify(x).includes('paired'));assert.equal(x.view.hands.p1[0].color,undefined);
      assert.deepEqual(await b.observe(c.episodeId,c.seats[0].token),x);
    });
    await t.test('20 duplicate concurrent commands commit once and return the exact same receipt',async()=>{
      const c=await a.create('take-time',takeSetup),p=c.seats[0],obs=await a.observe(c.episodeId,p.token),cmd=command(obs,{type:'look_hand'});
      const receipts=await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).submit(c.episodeId,p.token,'same-request',cmd)));
      for(const receipt of receipts){assert.equal(receipt.status,200);assert.deepEqual(receipt,receipts[0]);}
      await assert.rejects(()=>b.submit(c.episodeId,p.token,'same-request',command(obs,{type:'speak',text:'different'})),/different command/);
      await a.truncate(c.episodeId,'test');const audit=await b.audit(c.episodeId);
      assert.equal(audit.events.filter((e:any)=>e.kind==='accepted').length,1);assert.equal((await b.verifyReplay(c.episodeId)).valid,true);
    });
    await t.test('competing different intents at one decision accept exactly one; every rejection is retained',async()=>{
      const c=await a.create('take-time',takeSetup),p=c.seats[0],obs=await a.observe(c.episodeId,p.token);
      const results=await Promise.all(Array.from({length:8},(_,i)=>(i%2?a:b).submit(c.episodeId,p.token,`distinct-${i}`,command(obs,{type:'look_hand'}))));
      assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,7);
      await b.truncate(c.episodeId,'test');const audit=await a.audit(c.episodeId);assert.equal(audit.events.filter((e:any)=>e.kind==='rejected').length,7);
    });
    await t.test('hidden simultaneous commitments leave other seat cursor and token unchanged',async()=>{
      const c=await a.create(crewDeepSea.metadata.id,{playerCount:3,scenarioId:crewDeepSea.metadata.scenarios[0].id,seed:'private'});
      for(const p of c.seats){const obs=await a.observe(c.episodeId,p.token);assert.equal((await b.submit(c.episodeId,p.token,`vote-${p.playerId}`,command(obs,{type:'distress_vote',direction:'left'}))).status,200);}
      const obs=await Promise.all(c.seats.map(p=>a.observe(c.episodeId,p.token)));
      const action=obs[0].legalActions.find(x=>x.type==='distress_pass')!.examples![0];assert.equal((await b.submit(c.episodeId,c.seats[0].token,'private',command(obs[0],action))).status,200);
      const other=await b.observe(c.episodeId,c.seats[1].token);assert.deepEqual(other,obs[1]);
      await a.truncate(c.episodeId,'test');assert.equal((await a.verifyReplay(c.episodeId)).valid,true);
    });
    await t.test('paged observation cursor delivers every update without skipping or revealing private operations',async()=>{
      const c=await a.create(fixture.metadata.id,takeSetup),[p,q]=c.seats,initial=await a.observe(c.episodeId,p.token);
      for(let i=0;i<5;i++){const o=await a.observe(c.episodeId,q.token);await b.submit(c.episodeId,q.token,`say-${i}`,command(o,{type:'say',text:String(i)}));}
      let cursor=initial.updateCursor!,seen:string[]=[];
      for(let i=0;i<3;i++){const page:any=await b.observe(c.episodeId,p.token,cursor,2);seen.push(...page.updates.map((u:any)=>u.view.last.text));cursor=page.nextCursor;assert.equal(page.hasMore,i<2);
        if(i===0)assert.equal((await a.submit(c.episodeId,p.token,'partial-history',command(page,{type:'private',value:'incomplete'}))).body.error.code,'HISTORY_INCOMPLETE');}
      assert.deepEqual(seen,['0','1','2','3','4']);
      const old=await b.observe(c.episodeId,p.token,cursor),other=await a.observe(c.episodeId,q.token);await a.submit(c.episodeId,q.token,'hidden',command(other,{type:'private',value:'secret'}));
      assert.deepEqual(await b.observe(c.episodeId,p.token,cursor),old);
    });
    await t.test('mandatory windows persist 60 seconds; invalid actions and private evidence never renew deadlines',async()=>{
      const c=await a.createSession(fixture.metadata.id,takeSetup),p=c.seats[0],obs=await b.observe(c.episodeId,p.token),row=await a.store.row(c.episodeId);
      assert.equal(row.data.budget.deadline-row.data.lastMs,60000);const deadline=obs.control!.deadlineAt;
      const bad=await a.submit(c.episodeId,p.token,'bad',command(obs,{type:'illegal'}));assert.equal(bad.status,409);
      await b.appendMessage(c.episodeId,p.token,{sequence:0,messageId:'m0',message:{role:'assistant',reasoning:'Provider-returned test text.'},reasoningAvailability:'provided'});
      assert.equal((await a.observe(c.episodeId,p.token)).control!.deadlineAt,deadline);
      // Clock expiry is set directly only in the isolated test DB, simulating elapsed real time.
      await a.pool.query("UPDATE coop_pg_episodes SET data=jsonb_set(data,'{budget,deadline}',to_jsonb((floor(extract(epoch FROM clock_timestamp())*1000)-1)::bigint)) WHERE id=$1",[c.episodeId]);
      const late=await b.submit(c.episodeId,p.token,'late',command(obs,{type:'next'}));assert.equal(late.status,409);
      assert.equal(await a.episodeStatus(c.episodeId),'truncated');const audit=await a.audit(c.episodeId);assert.equal(audit.endReason,'decision_timeout');
      assert.equal((await a.exportTraining(c.episodeId)).terminalTeamReward,null);
    });
    await t.test('stale prior-round decision token fails even in another concurrent window',async()=>{
      const c=await a.createSession(fixture.metadata.id,takeSetup),[p,q]=c.seats,old=await a.observe(c.episodeId,p.token),other=await b.observe(c.episodeId,q.token);
      assert.equal((await b.submit(c.episodeId,q.token,'next',command(other,{type:'next'}))).status,200);
      assert.equal((await a.submit(c.episodeId,p.token,'old',command(old,{type:'private',value:1}))).body.error.code,'STALE_OBSERVATION');
    });
    await t.test('an action blocked on a row lock cannot cross the deadline and still commit',async()=>{
      const c=await a.createSession(fixture.metadata.id,takeSetup),p=c.seats[0],obs=await a.observe(c.episodeId,p.token);
      await a.pool.query("UPDATE coop_pg_episodes SET data=jsonb_set(data,'{budget,deadline}',to_jsonb((floor(extract(epoch FROM clock_timestamp())*1000)+150)::bigint)) WHERE id=$1",[c.episodeId]);
      const blocker=await a.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM coop_pg_episodes WHERE id=$1 FOR UPDATE',[c.episodeId]);
      try{const submitting=b.submit(c.episodeId,p.token,'deadline-race',command(obs,{type:'next'}));await new Promise(r=>setTimeout(r,250));await blocker.query('COMMIT');assert.equal((await submitting).status,409);}
      finally{await blocker.query('ROLLBACK');blocker.release();}
      assert.equal(await a.episodeStatus(c.episodeId),'truncated');assert.equal((await a.audit(c.episodeId)).events.filter((e:any)=>e.kind==='accepted').length,0);
    });
    await t.test('messages and chunked reasoning artifacts persist without leaking to another seat',async()=>{
      const c=await a.create('hanabi',{playerCount:3,scenarioId:'base',seed:'evidence'}),[p,q]=c.seats,obs=await a.observe(c.episodeId,p.token),before=await a.observe(c.episodeId,q.token);
      const message={sequence:0,messageId:'provider-output',message:{role:'assistant',content:'play',reasoning:'Actual test-provider field'},reasoningAvailability:'provided',observationId:obs.observationId};
      const record=await a.appendMessage(c.episodeId,p.token,message);assert.deepEqual(await b.appendMessage(c.episodeId,p.token,message),record);
      assert.deepEqual(await b.observe(c.episodeId,q.token),before);assert.equal((await b.listSeatMessages(c.episodeId,q.token)).messages.length,0);
      await assert.rejects(()=>a.appendMessage(c.episodeId,q.token,{...message,sequence:0}),/belong to this seat/);
      await a.truncate(c.episodeId,'test');await b.completeMessages(c.episodeId,p.token,{scope:'test provider response',completeness:'complete',reasoningAvailability:'provided'});
      const content=Buffer.from('message trajectory\n'.repeat(3000)),sha256=createHash('sha256').update(content).digest('hex');
      const artifact=await a.createArtifact(c.episodeId,p.token,'artifact',{name:'trajectory.jsonl',mediaType:'application/jsonl',kind:'agent-trace',byteLength:content.length,sha256,reasoningAvailability:'provided'});
      for(let index=0;index<artifact.chunkCount;index++)await b.putArtifactChunk(c.episodeId,p.token,artifact.id,{index,dataBase64:content.subarray(index*artifact.chunkSize,(index+1)*artifact.chunkSize).toString('base64')});
      const done=await a.completeArtifact(c.episodeId,p.token,artifact.id);assert.equal(done.status,'complete');
      await assert.rejects(()=>b.seatArtifactContent(c.episodeId,q.token,artifact.id),/Unknown artifact/);
      const downloaded=await b.rolloutArtifactContent(c.episodeId,artifact.id),chunks:Buffer[]=[];for await(const chunk of downloaded.chunks)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),content);
      assert.equal((await b.listRolloutMessages(c.episodeId,p.playerId)).completion.reasoningAvailability,'provided');
    });
    await t.test('room composition rolls back game creation and credential binding on failure',async()=>{
      let episode='';await assert.rejects(()=>a.withTransaction(async client=>{const c=await a.create('hanabi',{playerCount:3,scenarioId:'base'},client);episode=c.episodeId;await a.enableSessionBudget(episode,client);throw new Error('rollback test');}),/rollback test/);
      await assert.rejects(()=>b.episodeStatus(episode),/Unknown episode/);
    });
    await t.test('a failure after writing a new visible page rolls back state, cursors, receipt and history together',async()=>{
      const c=await a.create(fixture.metadata.id,takeSetup),p=c.seats[0],before=await a.observe(c.episodeId,p.token),cmd=command(before,{type:'say',text:'must commit atomically'});
      const original=a.store.writeEvidence.bind(a.store);
      a.store.writeEvidence=async(...args)=>{await original(...args);throw new Error('injected failure after evidence INSERT');};
      try{await assert.rejects(()=>a.submit(c.episodeId,p.token,'fault',cmd),/injected failure/);}finally{a.store.writeEvidence=original;}
      assert.deepEqual(await b.observe(c.episodeId,p.token),before);
      assert.equal((await b.getRollout(c.episodeId)).frames.length,1);assert.equal(await a.store.evidence(c.episodeId,'receipt',`${p.playerId}/fault`),undefined);
      assert.equal((await b.submit(c.episodeId,p.token,'fault',cmd)).status,200);
      await a.truncate(c.episodeId,'test');assert.equal((await a.verifyReplay(c.episodeId)).acceptedActions,1);
    });
    await t.test('a killed API process leaves its uncommitted CAS and evidence rolled back',async()=>{
      const c=await a.create('take-time',takeSetup),p=c.seats[0],before=await a.observe(c.episodeId,p.token);
      const script=`import pg from 'pg';import {PostgresAuthority} from './src/postgres-authority.ts';import {takeTime} from './src/games/take-time.ts';
        const pool=new pg.Pool({connectionString:process.env.COOP_TEST_DATABASE_URL,options:'-c search_path='+process.env.COOP_TEST_SCHEMA});
        const a=new PostgresAuthority(pool,[takeTime],'postgres-test-pinned');await a.ready();
        const id=process.env.COOP_TEST_EP,token=process.env.COOP_TEST_SEAT,obs=await a.observe(id,token),original=a.store.writeEvidence.bind(a.store);
        a.store.writeEvidence=async(...args)=>{await original(...args);process.exit(77);};
        await a.submit(id,token,'killed-api',{observationId:obs.observationId,decisionToken:obs.decisionToken,action:{type:'look_hand'}});process.exit(1);`;
      const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,COOP_TEST_SCHEMA:schema,COOP_TEST_EP:c.episodeId,COOP_TEST_SEAT:p.token},stdio:'ignore',windowsHide:true});
      const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,77);
      assert.deepEqual(await b.observe(c.episodeId,p.token),before);assert.equal((await b.getRollout(c.episodeId)).frames.length,1);
      assert.equal((await b.submit(c.episodeId,p.token,'killed-api',command(before,{type:'look_hand'}))).status,200);
      await b.truncate(c.episodeId,'test');assert.equal((await a.verifyReplay(c.episodeId)).acceptedActions,1);
    });
    await t.test('all ten real game adapters run bounded seat-only policies through PostgreSQL and replay',async()=>{
      for(const game of games){
        const c=await a.createSession(game.metadata.id,{playerCount:game.metadata.players[0],scenarioId:game.metadata.scenarios[0].id,seed:`postgres-smoke/${game.metadata.id}`});
        let previous:string|null=null,accepted=0;
        for(let step=0;step<30;step++){
          const views=await Promise.all(c.seats.map(p=>a.observe(c.episodeId,p.token)));if(views[0].status!=='active')break;
          const selected=mechanicalScheduler({activePlayerIds:c.seats.map(p=>p.playerId),previousPlayerId:previous,candidates:views.map(v=>({playerId:v.playerId,actionTypes:v.legalActions.filter(l=>l.examples?.length).map(l=>l.type)}))});if(!selected)break;
          const seat=c.seats.find(p=>p.playerId===selected)!,obs=views.find(v=>v.playerId===selected)!;
          const action=await mechanicalPolicy({gameId:game.metadata.id,scenarioId:game.metadata.scenarios[0].id,playerId:selected,observation:obs.view,observationHistory:obs.updates?.map(u=>u.view)??[],legalActions:obs.legalActions});if(!action)break;
          const result=await b.submit(c.episodeId,seat.token,`step-${step}`,command(obs,action));assert.equal(result.status,200,`${game.metadata.id}: ${JSON.stringify(result.body.error)}`);accepted++;previous=selected;
        }
        if(await a.episodeStatus(c.episodeId)==='active')await a.truncate(c.episodeId,'mechanical-smoke-budget');
        assert.ok(accepted>0,`${game.metadata.id} took a legal action`);assert.equal((await b.verifyReplay(c.episodeId)).valid,true,game.metadata.id);
        const training=await a.exportTraining(c.episodeId);assert.equal(training.rows.length,accepted);
      }
    });
    await t.test('official clock expiry is a rule outcome, separate from benchmark truncation',async()=>{
      const game=games.find(g=>g.metadata.id==='magic-maze')!,c=await a.createSession(game.metadata.id,{playerCount:game.metadata.players[0],scenarioId:game.metadata.scenarios[0].id,seed:'official-clock'});
      for(const seat of c.seats){const obs=await a.observe(c.episodeId,seat.token);assert.equal((await b.submit(c.episodeId,seat.token,`ready-${seat.playerId}`,command(obs,{type:'ready'}))).status,200);}
      await a.pool.query("UPDATE coop_pg_episodes SET data=jsonb_set(data,'{lastMs}',to_jsonb((floor(extract(epoch FROM clock_timestamp())*1000)-200000)::bigint)) WHERE id=$1",[c.episodeId]);
      const observed=await b.observe(c.episodeId,c.seats[0].token);assert.equal(observed.status,'completed');assert.ok(observed.outcome);assert.equal(observed.control?.endReason,null);
      assert.equal((await a.verifyReplay(c.episodeId)).valid,true);
    });
  }finally{
    await Promise.all(pools.map(pool=>pool.end()));await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
