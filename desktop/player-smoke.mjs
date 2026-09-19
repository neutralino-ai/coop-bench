import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {app,safeStorage} from 'electron';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {startLocalApp} from '../runtime/coop-bench/src/server.mjs';
import {inviteUrl} from '../runtime/coop-bench/client/player.mjs';
import {externalSmokeFixture} from './pg-smoke-fixture.mjs';

export async function runPlayerSmoke({window,directory}) {
  const local=externalSmokeFixture()??await startLocalApp({dataDir:join(directory,'synthetic-server'),port:0,serveWeb:false}),checks=[];
  const js=code=>window.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<160;i++){if(await js(code))return;await wait(100);}throw Error('Player UI condition failed: '+code);};
  const call=async(path,token=local.adminToken,body)=>{
    const res=await fetch(local.apiUrl+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await res.json();assert.ok(res.ok,JSON.stringify(data));return data;
  };
  try{
    await until("document.querySelector('#status').textContent==='尚未连接'");checks.push('visible startup and disconnected status');
    assert.equal(await js("document.querySelector('#resume').disabled"),true);checks.push('fresh profile does not offer unavailable seat recovery');
    const room=await call('/rooms',undefined,{gameId:'hanabi',scenarioId:'base',playerCount:2}),url=inviteUrl({...room,apiUrl:local.apiUrl});
    app.emit('open-url',{preventDefault(){}},'coopbench://join#invalid');assert.equal(await js("document.querySelector('#invitation').value"),'');
    app.emit('open-url',{preventDefault(){}},url);await until("document.querySelector('#invitation').value.startsWith('coopbench://join#')");
    assert.equal(await js("document.querySelector('#lobby').hidden"),true);checks.push('validated invitation deep link prefills without silently joining');
    await js("document.querySelector('#name').value='Synthetic human';document.querySelector('#join-form').requestSubmit();");
    await until("!document.querySelector('#lobby').hidden");checks.push('invitation joins human UI');
    if(safeStorage.isEncryptionAvailable()){
      await call(`/rooms/${room.roomId}/admin-invite`,undefined,{});
      await js("window.coopPlayer.command('disconnect').then(render)");
      await js("document.querySelector('#mode').value='model';document.querySelector('#mode').dispatchEvent(new Event('change'));document.querySelector('#base-url').value='https://synthetic-model.example/v1';document.querySelector('#model').value='synthetic-model';document.querySelector('#api-key').value='synthetic-api-key';document.querySelector('#resume').click()");
      await until("!document.querySelector('#lobby').hidden && document.querySelector('#session-mode').textContent==='模型 API 自动参赛'");
      assert.equal(await js("document.querySelector('#api-key').value"),'');
      const persisted=JSON.parse(safeStorage.decryptString(readFileSync(join(directory,'membership.encrypted'))));
      assert.equal(persisted.inviteToken,undefined);assert.equal(persisted.apiKey,undefined);checks.push('model seat resumes after invite rotation with no persisted invite or model key');
      await js("window.coopPlayer.command('disconnect').then(render)");
      await js("document.querySelector('#mode').value='human';document.querySelector('#mode').dispatchEvent(new Event('change'));document.querySelector('#resume').click()");
      await until("!document.querySelector('#lobby').hidden && document.querySelector('#session-mode').textContent==='人类玩家'");
    }else checks.push('native encrypted seat recovery unavailable on this host; resume test skipped');
    // The earlier invitation has been rotated by the recovery test.
    const activeInvite=await call(`/rooms/${room.roomId}/admin-invite`,undefined,{});
    const peer=randomBytes(32).toString('base64url');await call(`/rooms/${room.roomId}/join`,activeInvite.inviteToken,{name:'Synthetic peer',playerToken:peer});
    await until("document.querySelectorAll('.member').length===2");await js("document.querySelector('#ready').click()");
    const roster=await call(`/rooms/${room.roomId}`,peer);await call(`/rooms/${room.roomId}/ready`,peer,{ready:true,rosterVersion:roster.rosterVersion});
    await until("!document.querySelector('#start').disabled");await js("document.querySelector('#start').click()");await until("!document.querySelector('#game').hidden");checks.push('roster readiness and host start');
    const snapshot=await js("window.coopPlayer.command('status')");assert.equal(snapshot.observation.playerId,'p1');assert.equal(snapshot.observation.decisionToken,undefined);assert.ok(snapshot.observation.view.hands.p1.every(c=>c.value===undefined));checks.push('renderer receives only projected own seat, no decision credentials');
    assert.match(await js("document.querySelector('#board').textContent"),/提示 8\/8/);assert.match(await js("document.querySelector('#deadline').textContent"),/秒/);checks.push('hints and deadline visible');
    await js("document.querySelector('#rules-button').click()");assert.match(await js("document.querySelector('#rules-content').textContent"),/hint/i);await js("document.querySelector('#close-rules').click()");checks.push('read game rules');
    await js("document.querySelector('#action-type').value='hint';document.querySelector('#action-type').dispatchEvent(new Event('change'));document.querySelector('[name=target]').value='\"p2\"';document.querySelector('[name=kind]').value='\"color\"';document.querySelector('[name=value]').value='\"red\"';document.querySelector('#action-form').requestSubmit();");
    await until("document.querySelector('#board').textContent.includes('提示 7/8')");checks.push('human action accepted and board updated via runtime');
    writeFileSync(join(directory,'player-hanabi.png'),(await window.webContents.capturePage()).toPNG());
    await call(`/episodes/${snapshot.room.episodeId}/truncate`,undefined,{reason:'synthetic-player-ui-test'});
    await until("document.querySelector('#status').textContent==='游戏结束'");checks.push('server terminal observation wakes UI');
    assert.match(await js("document.querySelector('#outcome').textContent"),/不等同于按游戏规则失败/);assert.equal(await js("document.querySelector('#act').disabled"),true);checks.push('benchmark interruption is visibly distinct from game loss and disables actions');
    const messages=await call(`/rollouts/${snapshot.room.episodeId}/messages?playerId=p1`);assert.ok(messages.messages.some(m=>m.kind==='tool-call'));checks.push('human runtime tool trajectory stored');
    const prohibited=await js("window.coopPlayer.command('audit').then(()=>false,()=>true)");assert.equal(prohibited,true);checks.push('player IPC cannot invoke audit');
    await js("window.coopPlayer.command('disconnect')");return {ok:true,backend:local.backend??'sqlite',checks};
  }finally{await local.close();}
}
