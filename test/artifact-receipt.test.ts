import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uploadAgentArtifact} from '../scripts/upload-agent-artifact.mjs';
test('artifact upload verifies both new and already-complete receipts against the exact file',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'coop-receipt-')),file=join(directory,'trace.jsonl');writeFileSync(file,'{"role":"user","content":"fixture"}\n');
 try{for(const existing of [true,false])for(const invalid of ['none','hash','length','status']){
  let manifest;
  const result=uploadAgentArtifact({baseUrl:'https://fixture.test/api/v1',episodeId:'fixture',seatToken:'synthetic',file},{sleep:async()=>{},fetchImpl:async(url,options)=>{
   if(url.endsWith('/artifacts'))manifest=JSON.parse(options.body);
   let receipt={...manifest,id:'fixture',status:'complete'};
   if(invalid==='hash')receipt.sha256='0'.repeat(64);if(invalid==='length')receipt.byteLength++;if(invalid==='status')receipt.status='uploading';
   return Response.json(!existing&&url.endsWith('/artifacts')?{...manifest,id:'fixture',status:'uploading',chunkSize:32768,missingChunks:[0]}:receipt);
  }});
  if(invalid==='none')assert.equal((await result).status,'complete');
  else await assert.rejects(result,/receipt|manifest/);
 }}finally{rmSync(directory,{recursive:true,force:true});}
});
