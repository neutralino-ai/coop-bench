import test from 'node:test';
import assert from 'node:assert/strict';
import {startMockApi} from '../desktop/mock-api.mjs';

test('native game-entry fixture rejects oversized message pages and drains history without gaps',async()=>{
  const api=await startMockApi();
  try {
    const created=await api.call('/episodes',api.adminToken,{playerCount:2});
    const seat=created.seats[0].token,path=`/episodes/${created.episodeId}/messages`;
    const request=(query:string)=>fetch(api.apiUrl+path+query,{headers:{Authorization:`Bearer ${seat}`}});
    for(const query of ['?after=-1&limit=500','?limit=101','?limit=0','?limit=1.5','?after=-2','?limit=1&limit=2']) {
      const response=await request(query);
      assert.equal(response.status,400,query);
      assert.equal((await response.json()).error.code,'INVALID_REQUEST');
    }
    const empty=await api.call(path+'?after=-1&limit=100',seat);
    assert.deepEqual([empty.messages.length,empty.nextAfter,empty.hasMore],[0,-1,false]);
    for(let sequence=0;sequence<205;sequence++)await api.call(path,seat,{sequence,messageId:`fixture-${sequence}`,kind:'tool-result',message:{role:'tool',content:'synthetic history'}});
    let after=-1,more=true;const sequences:number[]=[],sizes:number[]=[];
    while(more){
      const page=await api.call(path+`?after=${after}&limit=100`,seat);
      assert.ok(page.nextAfter>after);after=page.nextAfter;more=page.hasMore;
      sizes.push(page.messages.length);sequences.push(...page.messages.map(m=>m.sequence));
    }
    assert.deepEqual(sizes,[100,100,5]);
    assert.deepEqual(sequences,Array.from({length:205},(_,i)=>i));
    const other=await api.call(path+'?after=-1&limit=100',created.seats[1].token);
    assert.deepEqual(other.messages,[]);
    const resumed=await api.call(path+`?after=${after}&limit=100`,seat);
    assert.deepEqual([resumed.messages.length,resumed.nextAfter,resumed.hasMore],[0,204,false]);
  } finally {await api.close();}
});
