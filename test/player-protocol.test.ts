import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SeatSession } from '../client/seat-session.mjs';
import { observationPage } from '../client/protocol.mjs';
import { MinimalAgent } from '../client/minimal-agent.mjs';
import { PlayerRuntime } from '../client/runtime.mjs';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { games } from '../src/registry.ts';

const token='synthetic-private-seat-token-1234567890';
const observation=(updates:number[],head=updates.at(-1)??0)=>({episodeId:'fixture-episode',playerId:'p0',observationId:'observation-1',decisionToken:'window-1',status:'active',view:{ownHand:[{knownValue:null}]},legalActions:[{type:'play'}],outcome:null,control:{required:true,deadlineAt:Date.now()+60000},updateCursor:head,updates:updates.map(seq=>({seq,view:{visible:seq},status:'active'}))});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(handler:(url:URL,options:any)=>any){return async(url:string,options:any)=>{
  assert.equal(options.headers.Authorization,`Bearer ${token}`);
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/messages'))return json(JSON.parse(options.body));
  return handler(parsed,options);
};}
function config(directory:string){return {apiUrl:'http://127.0.0.1:8788/api/v1',episodeId:'fixture-episode',seatToken:token,directory};}

test('pagination never advances to an undispatched snapshot head; incomplete history prevents act',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-seat-pages-')),seen:number[]=[];
  const session=await SeatSession.open(config(directory),{fetchImpl:fixture((url)=>{
    const after=Number(url.searchParams.get('after'));seen.push(after);
    return json(after===0?{observation:observation([1,2],8),nextCursor:2,hasMore:true}:{observation:observation([3,4,5,6,7,8],8),nextCursor:8,hasMore:false});
  })});
  try {
    const first=await session.wait({timeoutMs:0});assert.equal(first.nextCursor,2);assert.equal(session.cursor,2);
    await assert.rejects(session.act({requestId:'first',decisionToken:'window-1',action:{type:'play'}}),{code:'HISTORY_INCOMPLETE'});
    const second=await session.wait({timeoutMs:0});assert.deepEqual(seen,[0,2]);assert.equal(second.nextCursor,8);assert.equal(session.cursor,8);
    assert.deepEqual([...first.observation.updates,...second.observation.updates].map((x:any)=>x.seq),[1,2,3,4,5,6,7,8]);
  }finally{await session.close();}
  assert.throws(()=>observationPage({observation:observation([1],8),hasMore:true},0),/pagination/);
});

test('lost action receipt survives bridge restart with identical key and payload; receipt cannot skip history',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-seat-retry-')),calls:any[]=[];let lost=true;
  const fetchImpl=fixture((url,options)=>{
    if(url.pathname.endsWith('/wait'))return json({observation:observation([1]),nextCursor:1,hasMore:false});
    assert.ok(url.pathname.endsWith('/actions'));calls.push({key:options.headers['Idempotency-Key'],body:options.body});
    if(lost){lost=false;throw Error('Synthetic lost receipt after commit.');}
    return json({accepted:true,observation:observation([2,3],3)});
  });
  const args={requestId:'intent-001',decisionToken:'window-1',action:{type:'play',card:0}};
  let session=await SeatSession.open(config(directory),{fetchImpl});
  await session.wait({timeoutMs:0});await assert.rejects(session.act(args),/lost receipt/);await session.close();
  session=await SeatSession.open(config(directory),{fetchImpl});
  try {
    assert.deepEqual((await session.wait({timeoutMs:0})).pendingAction,args,'Restarted hosts can recover the exact unresolved intent from wait.');
    await assert.rejects(session.act({...args,action:{type:'discard',card:0}}),{code:'IDEMPOTENCY_CONFLICT'});
    await assert.rejects(session.act({...args,requestId:'intent-002'}),{code:'PENDING_ACTION'});
    assert.equal((await session.act(args)).accepted,true);assert.deepEqual(calls[0],calls[1]);assert.equal(session.cursor,1);
    assert.equal((await session.act(args)).accepted,true);assert.equal(calls.length,2,'A local durable final receipt also deduplicates retries.');
  }finally{await session.close();}
  const trace=readFileSync(join(directory,'mcp-messages.jsonl'),'utf8');assert.match(trace,/TRANSPORT_ERROR/);assert.ok(!trace.includes(token));
});

test('cancelled long poll keeps its original cursor and records an actual cancellation',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-seat-cancel-')),controller=new AbortController();
  const session=await SeatSession.open(config(directory),{fetchImpl:fixture((_url,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  }))});
  try {const pending=session.wait({signal:controller.signal});controller.abort();await assert.rejects(pending);assert.equal(session.cursor,0);}
  finally{await session.close();}
  assert.match(readFileSync(join(directory,'mcp-messages.jsonl'),'utf8'),/CANCELLED/);
});

test('closing a bridge cancels an active wait before closing its durable journal',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-seat-close-'));
  const session=await SeatSession.open(config(directory),{fetchImpl:fixture((_url,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  }))});
  const pending=session.wait(),rejected=assert.rejects(pending);await session.close();await rejected;
  assert.match(readFileSync(join(directory,'mcp-messages.jsonl'),'utf8'),/CANCELLED/);
});

test('actual stdio MCP exposes rules/wait/act and performs a seat-authenticated HTTP action without token arguments',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-mcp-stdio-')),received:any[]=[];
  const http=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
    received.push({url:req.url,headers:req.headers,body});
    res.setHeader('Content-Type','application/json');
    if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end(JSON.stringify({error:{code:'UNAUTHORIZED'}}));return;}
    if(req.url!.endsWith('/messages'))res.end(JSON.stringify(body));
    else if(req.url!.endsWith('/rules'))res.end(JSON.stringify({gameId:'hanabi',rulesSummary:'Synthetic fixture rules.'}));
    else if(req.url!.includes('/wait?'))res.end(JSON.stringify({observation:observation([1]),nextCursor:1,hasMore:false}));
    else if(req.url!.endsWith('/actions'))res.end(JSON.stringify({accepted:true,observation:observation([2])}));
    else{res.writeHead(404);res.end('{}');}
  });
  await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
  const path=join(directory,'seat.json');writeFileSync(path,JSON.stringify({...config(join(directory,'private')),apiUrl:`http://127.0.0.1:${(http.address() as any).port}/api/v1`}),{mode:0o600});
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/mcp-play.mjs',import.meta.url)),path],stderr:'pipe'});
  let errors='';transport.stderr?.on('data',(data)=>{errors+=data;});
  const client=new Client({name:'coop-fixture',version:'1.0.0'});
  try {
    await client.connect(transport);const listed=await client.listTools();assert.deepEqual(listed.tools.map(tool=>tool.name).sort(),['act','rules','wait']);
    assert.ok(!JSON.stringify(listed).includes('seat_token'));assert.ok(!JSON.stringify(listed).includes(token));
    const rules:any=await client.callTool({name:'rules',arguments:{}});assert.match(rules.content[0].text,/Synthetic fixture/);
    const view:any=await client.callTool({name:'wait',arguments:{timeoutMs:0}});assert.equal(view.structuredContent.nextCursor,1);
    const result:any=await client.callTool({name:'act',arguments:{requestId:'mcp-intent-1',decisionToken:view.structuredContent.observation.decisionToken,action:{type:'play',card:0}}});
    assert.equal(result.structuredContent.accepted,true);assert.equal(received.find(req=>req.url.endsWith('/actions')).headers['idempotency-key'],'mcp-intent-1');
    assert.ok(!JSON.stringify([rules,view,result]).includes(token));
  }finally{await client.close();http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));}
  assert.ok(!errors.includes(token));
});

test('model recorder captures malformed provider bodies and network failures without inventing reasoning',async()=>{
  const captures:any[]=[],state=new Map(),runtime={get:(key:string)=>state.get(key),put:(key:string,value:any)=>state.set(key,value),recordModelRequest:async(raw:any)=>captures.push({kind:'request',raw}),recordModelResponse:async(raw:any,details:any)=>captures.push({kind:'response',raw,details}),recordTransportResult:async(raw:any)=>captures.push({kind:'transport',raw})};
  const context={observation:{observationId:'o1',updates:[],legalActions:[]}};
  const malformed=new MinimalAgent({baseUrl:'http://127.0.0.1:9000/v1',apiKey:'fixture-key',model:'fixture'},{fetchImpl:async()=>new Response('provider gateway failure',{status:502})});
  await assert.rejects(malformed.decide(context,{runtime,signal:new AbortController().signal}),/non-JSON/);
  assert.equal(captures[1].raw.bodyText,'provider gateway failure');assert.equal(captures[1].details.reasoningAvailability,'not-provided');
  const failed=new MinimalAgent({baseUrl:'http://127.0.0.1:9000/v1',apiKey:'fixture-key',model:'fixture'},{fetchImpl:async()=>{throw Error('synthetic disconnected');}});
  await assert.rejects(failed.decide(context,{runtime,signal:new AbortController().signal}),/disconnected/);
  assert.equal(captures.at(-1).kind,'transport');assert.equal(captures.at(-1).raw.outcome,'response-unavailable');assert.ok(!JSON.stringify(captures).includes('fixture-key'));
  assert.deepEqual(JSON.parse(state.get('modelHistory').at(-1).content),context,'Actual outbound context survives a provider failure.');
});

test('building external-agent context alone does not consume unacknowledged visible history',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-context-delivery-'));
  const runtime=new PlayerRuntime({apiUrl:'http://127.0.0.1:8788/api/v1',roomId:'01234567-0123-0123-0123-012345678901',playerToken:token,directory});
  try {
    runtime.observation=observation([1,2,3]);runtime.put('pendingUpdates',runtime.observation.updates);
    const first=runtime.context();assert.equal(first.observation.updates.length,3);
    // A host failure before the adapter answers must redeliver these events.
    const retried=runtime.context();assert.deepEqual(retried.observation.updates,first.observation.updates);
    assert.ok(!JSON.stringify(retried).includes(token));assert.equal(retried.observation.decisionToken,undefined);
  }finally{await runtime.close();}
});

test('real API long poll cancels, wakes after another player action, pages history, and preserves hidden information',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'coop-seat-http-')),authority=new Authority(':memory:',games,'protocol-integration'),server=createApi(authority,'synthetic-protocol-operator-token');
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/v1`,episode=authority.createSession('hanabi',{playerCount:2,scenarioId:'base'}),[first,second]=episode.seats;
  const session=await SeatSession.open({apiUrl:base,episodeId:episode.episodeId,seatToken:second.token,directory});
  try {
    assert.equal((await session.rules()).gameId,'hanabi');
    const initial=await session.wait({timeoutMs:0});assert.equal(initial.observation.control.required,false);
    const controller=new AbortController(),started=Date.now(),cancelled=session.wait({timeoutMs:10000,signal:controller.signal});
    setTimeout(()=>controller.abort(),30);await assert.rejects(cancelled);assert.ok(Date.now()-started<3000);assert.equal(session.cursor,initial.nextCursor);
    const pending=session.wait({timeoutMs:10000});
    const before=authority.observe(episode.episodeId,first.token),action=before.legalActions.find(x=>x.type==='hint')!.examples![0];
    assert.equal(authority.submit(episode.episodeId,first.token,'real-http-move',{observationId:before.observationId,decisionToken:before.decisionToken,action}).status,200);
    const changed=await pending;assert.ok(changed.nextCursor>initial.nextCursor);assert.equal(changed.observation.control.required,true);
    assert.ok(changed.observation.view.hands[second.playerId].every((card:any)=>card.value===undefined));assert.ok(!JSON.stringify(changed).includes(first.token));
    const response=await fetch(`${base}/episodes/${episode.episodeId}/wait?after=0&timeoutMs=0&limit=1`,{headers:{Authorization:`Bearer ${second.token}`}}),page:any=await response.json();
    assert.equal(page.hasMore,true);assert.equal(page.nextCursor,1);assert.equal(page.observation.updates.length,1);assert.equal(page.observation.updateCursor,page.nextCursor);assert.ok(page.observation.headCursor>page.nextCursor);
    const delivered=page.observation.updates.map((item:any)=>item.seq);let cursor=page.nextCursor,more=page.hasMore;
    while(more){
      const next=await fetch(`${base}/episodes/${episode.episodeId}/observation?after=${cursor}&limit=1`,{headers:{Authorization:`Bearer ${second.token}`}}),last:any=await next.json();
      assert.equal(last.nextCursor,cursor+1);assert.equal(last.updates[0].seq,cursor+1);delivered.push(last.updates[0].seq);cursor=last.nextCursor;more=last.hasMore;
    }
    assert.equal(cursor,changed.nextCursor);assert.deepEqual(delivered,Array.from({length:cursor},(_,i)=>i+1));
  }finally{await session.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));authority.close();}
});

test('real API bounds simultaneous waits per seat, releases cancelled capacity, and rejects ambiguous query fields',async()=>{
  const authority=new Authority(':memory:',games,'protocol-wait-cap'),server=createApi(authority,'synthetic-protocol-operator-token');
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/v1`,episode=authority.createSession('hanabi',{playerCount:2,scenarioId:'base'}),seat=episode.seats[1];
  const after=authority.observe(episode.episodeId,seat.token).nextCursor,headers={Authorization:`Bearer ${seat.token}`},controller=new AbortController();
  const route=`${base}/episodes/${episode.episodeId}`;let requests=0;
  server.on('request',req=>{if(req.url?.includes('timeoutMs=10000'))requests++;});
  const pending=Array.from({length:2},()=>fetch(`${route}/wait?after=${after}&timeoutMs=10000`,{headers,signal:controller.signal}).catch(()=>null));
  try {
    for(let i=0;i<100&&requests<2;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(requests,2);
    const rejected=await fetch(`${route}/wait?after=${after}&timeoutMs=0`,{headers});assert.equal(rejected.status,429);assert.equal((await rejected.json() as any).error.code,'RESOURCE_LIMIT');
    controller.abort();await Promise.all(pending);await new Promise(resolve=>setTimeout(resolve,30));
    const recovered=await fetch(`${route}/wait?after=${after}&timeoutMs=0`,{headers});assert.equal(recovered.status,200);
    for(const path of ['observation?unknown=1','observation?after=0&after=1','wait?timeoutMs=0&unknown=1','wait?timeoutMs=0&timeoutMs=1']){
      const response=await fetch(`${route}/${path}`,{headers});assert.equal(response.status,400);assert.equal((await response.json() as any).error.code,'INVALID_REQUEST');
    }
  }finally{controller.abort();await Promise.all(pending);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));authority.close();}
});
