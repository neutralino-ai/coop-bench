import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { Authority } from '../src/authority.ts';
import { RoomStore } from '../src/room-store.ts';
import { createApi } from '../src/server.ts';
import { games } from '../src/registry.ts';
import { PlayerRuntime } from '../client/runtime.mjs';
import { MinimalAgent } from '../client/minimal-agent.mjs';
import { invitation,inviteUrl } from '../client/protocol.mjs';

async function until(fn:()=>any){for(let i=0;i<200;i++){if(fn())return;await wait(50);}throw Error('Timed out waiting for fixture.');}
test('invitation transport validates scheme and prohibits remote plaintext or URL credentials',()=>{
  const config={apiUrl:'https://coop.example/api/v1',roomId:'01234567-0123-0123-0123-012345678901',inviteToken:'a'.repeat(43)};
  assert.deepEqual(invitation(inviteUrl(config)),config);
  assert.throws(()=>inviteUrl({...config,apiUrl:'http://remote.example'}));
  assert.throws(()=>invitation('https://evil.test/#x'));assert.throws(()=>inviteUrl({...config,apiUrl:'https://user:password@coop.example'}));
});

for(const lostKind of ['accepted','rejected'])test(`isolated SSE runtimes recover a lost ${lostKind} receipt, correct a rule error, finish Hanabi and capture provider JSON`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-runtime-')),a=new Authority(':memory:',games,'runtime'),server=createApi(a,'operator-test-runtime-credential');
  const requests:any[]=[],provider=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);
    const context=JSON.parse(body.messages.filter((m:any)=>m.role==='user').at(-1).content),obs=context.observation;
    const action=obs.legalActions.find((x:any)=>x.type==='play').examples[0];
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'synthetic-response',model:'synthetic-test-model',choices:[{message:{role:'assistant',content:null,reasoning_content:'Synthetic fixture selects the first legal play; no hidden information is used.',tool_calls:[{id:'synthetic-call',type:'function',function:{name:'act',arguments:JSON.stringify({actionJson:JSON.stringify(action)})}}]}}],usage:{total_tokens:20}}));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
  const apiUrl=`http://127.0.0.1:${(server.address() as any).port}/api/v1`,baseUrl=`http://127.0.0.1:${(provider.address() as any).port}/v1`,rooms=new RoomStore(a);
  const room=rooms.create('operator',{gameId:'hanabi',playerCount:2,scenarioId:'base'}),runtimes:any[]=[];
  let lost=false,invalidAttempted=false,sawRuleError=false;
  try{
    for(let i=0;i<2;i++){
      const runtime=new PlayerRuntime({apiUrl,roomId:room.roomId,inviteToken:room.inviteToken,name:`Synthetic ${i}`,directory:join(directory,`p${i}`)},
        {fetchImpl:async(url:any,options:any)=>{const response=await fetch(url,options);if(i===0&&!lost&&(lostKind==='accepted'?response.ok:response.status===409)&&String(url).endsWith('/actions')){lost=true;await response.arrayBuffer();throw Error('Simulated lost receipt AFTER server committed.');}return response;}});
      const agent=new MinimalAgent({baseUrl,model:'synthetic-test-model',apiKey:'fake-provider-key'});
      runtimes.push(runtime);runtime.attachAgent({async decide(context:any,options:any){
        assert.equal(options.runtime.credentials,undefined);assert.equal(options.runtime.get('binding'),null);
        if(i===0&&!invalidAttempted){invalidAttempted=true;return {action:{type:'chat',text:'Synthetic invalid Hanabi action'}};}
        if(i===0&&context.lastActionResult?.accepted===false)sawRuleError=true;
        return agent.decide(context,options);
      }});await runtime.connect();
    }
    for(const r of runtimes){r.room=rooms.observe(room.roomId,r.credentials().playerToken);await r.ready();}
    rooms.start(room.roomId);const running=runtimes.map(r=>r.run());
    await until(()=>runtimes.every(r=>r.status==='ended'));
    await Promise.all(running);
    const episodeId=rooms.admin(room.roomId).episodeId,audit=a.audit(episodeId);assert.equal(audit.status,'completed');assert.equal(a.verifyReplay(episodeId).valid,true);
    const accepted=audit.events.filter((e:any)=>e.kind==='accepted');assert.ok(accepted.length>=3);assert.equal(new Set(accepted.map((e:any)=>e.payload.requestId)).size,accepted.length);assert.equal(lost,true);
    assert.ok(requests.length>=3);assert.equal(sawRuleError,true,'A rejected action must reach the next decision rather than stall without an event.');
    for(const request of requests){const raw=JSON.stringify(request);assert.ok(!raw.includes('fake-provider-key'));assert.ok(!raw.includes('decisionToken'));for(const r of runtimes)assert.ok(!raw.includes(r.credentials().playerToken));
      const context=JSON.parse(request.messages.filter((m:any)=>m.role==='user').at(-1).content),o=context.observation;
      assert.ok(o.view.hands[o.playerId].every((card:any)=>card.value===undefined));assert.ok(o.updates.length>=1||context.lastActionResult?.accepted===false);
    }
    for(const [i,r]of runtimes.entries()){
      const outbox=readFileSync(join(directory,`p${i}`,'messages.jsonl'),'utf8');assert.match(outbox,/reasoning_content/);assert.ok(!outbox.includes('fake-provider-key'));assert.ok(!outbox.includes(r.credentials().playerToken));
      const stored=a.listSeatMessages(episodeId,r.credentials().playerToken,-1,100);assert.match(JSON.stringify(stored),/synthetic-response/);
      assert.equal(stored.completion?.reasoningAvailability,'provided');assert.equal(stored.completion?.completeness,'partial');
      assert.equal(r.get('pendingAction'),null);
    }
  }finally{for(const r of runtimes)await r.close();server.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>provider.close(()=>r()))]);a.close();}
});
