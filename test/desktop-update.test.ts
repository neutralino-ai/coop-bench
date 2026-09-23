import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateClient, REPOSITORY, selectRelease, isNewer } from '../desktop/update-client.mjs';

const bytes = Buffer.from('Synthetic installer bytes; never executed.');
const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function release(suffix = 'win-x64.exe') {
  const name = `Coop-Bench-0.8.0-${suffix}`;
  return { tag_name: 'v0.8.0', draft: false, prerelease: false, html_url: `${REPOSITORY}/releases/tag/v0.8.0`,
    assets: [{ name, size: bytes.length, digest, browser_download_url: `${REPOSITORY}/releases/download/v0.8.0/${name}` }] };
}
test('updates select exact native architecture and stable numeric versions', () => {
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  for (const v of ['0.7.0', '0.6.9', '0.8.0-beta', '01.2.3']) assert.equal(isNewer(v, '0.7.0'), false);
  for (const [platform, arch, suffix] of [['win32','x64','win-x64.exe'], ['darwin','arm64','mac-arm64.dmg'], ['darwin','x64','mac-x64.dmg']])
    assert.equal(selectRelease(release(suffix), '0.7.0', platform, arch).asset.name, `Coop-Bench-0.8.0-${suffix}`);
  assert.equal(selectRelease(release(), '0.8.0', 'win32', 'x64').state, 'latest');
  for (const change of [ { draft: true }, { prerelease: true }, { html_url: 'https://evil.test/release' }, { assets: [] }, { assets: [{ ...release().assets[0], digest: '' }] }, { assets: [{ ...release().assets[0], browser_download_url: 'http://127.0.0.1/a.exe' }] } ])
    assert.throws(() => selectRelease({ ...release(), ...change }, '0.7.0', 'win32', 'x64'));
  assert.throws(() => selectRelease(release(), '0.7.0', 'win32', 'arm64'));
});
test('download verifies bytes, uses no credentials, follows only GitHub asset hosts and rechecks before installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coop-update-')); const opened: string[] = [], calls: any[] = [];
  try {
    const updater = new UpdateClient({ currentVersion: '0.7.0', platform: 'win32', arch: 'x64', directory,
      fetcher: async (url: string, options: any) => { calls.push({ url, options });
        if (url.startsWith('https://api.github.com/')) return Response.json(release());
        if (url.startsWith(REPOSITORY)) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/synthetic' } });
        return new Response(bytes, { headers: { 'content-length': String(bytes.length) } }); },
      opener: async (file: string) => { opened.push(file); return ''; } });
    assert.equal((await updater.check()).state, 'available');
    await assert.rejects(updater.install());
    assert.equal((await updater.download()).state, 'ready');
    assert.deepEqual(await readFile(updater.file), bytes);
    assert.equal((await updater.install()).state, 'opened'); assert.equal(opened.length, 1);
    assert.ok(calls.every(c => c.options.credentials === 'omit' && !c.options.headers?.Authorization && c.options.redirect !== 'follow'));
    await updater.check(); await updater.download(); await writeFile(updater.file, 'corrupt');
    await assert.rejects(updater.install(), /已变化/); assert.equal(opened.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('interrupted GitHub asset stream retries from the beginning and verifies the final bytes', async () => {
  const directory=await mkdtemp(join(tmpdir(),'coop-update-retry-'));let cdnRequests=0;
  try {
    const updater=new UpdateClient({currentVersion:'0.7.0',platform:'win32',arch:'x64',directory,
      fetcher:async(url:string)=>{
        if(url.startsWith('https://api.github.com/'))return Response.json(release());
        if(url.startsWith(REPOSITORY))return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/synthetic'}});
        cdnRequests++;
        if(cdnRequests===1)return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,8));controller.error(new TypeError('synthetic network interruption'));}}),{headers:{'content-length':String(bytes.length)}});
        return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
      },opener:async()=>''});
    await updater.check();assert.equal((await updater.download()).state,'ready');
    assert.equal(cdnRequests,2);assert.deepEqual(await readFile(updater.file),bytes);
    assert.deepEqual(await readdir(directory),[release().assets[0].name]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('updater explains a write failure without exposing raw error details',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'coop-update-storage-'));
  try{
    const updater=new UpdateClient({currentVersion:'0.7.0',platform:'win32',arch:'x64',directory,
      fetcher:async(url:string)=>url.startsWith('https://api.github.com/')?Response.json(release()):Promise.reject(Object.assign(new Error('private-path'),{code:'ENOSPC'})),opener:async()=>''});
    await updater.check();await assert.rejects(updater.download(),{code:'UPDATE_STORAGE',message:'更新目录空间不足，无法保存安装包。'});
    assert.deepEqual(await readdir(directory),[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('updater rejects unsafe redirects, incorrect hashes, excessive or short payloads and leaves no partial file', async () => {
  for (const response of [
    () => new Response(null, { status:302, headers:{location:'https://127.0.0.1/secret'} }),
    () => new Response(null, { status:302, headers:{location:'https://github.com.evil.test/file'} }),
    () => new Response(null, { status:302, headers:{location:'https://user:secret@release-assets.githubusercontent.com/file'} }),
    () => new Response(Buffer.alloc(bytes.length)), () => new Response(bytes.subarray(1)), () => new Response(Buffer.concat([bytes,bytes]))
  ]) {
    const directory = await mkdtemp(join(tmpdir(), 'coop-update-failure-')); let requests = 0;
    try {
      const updater = new UpdateClient({currentVersion:'0.7.0',platform:'win32',arch:'x64',directory,
        fetcher:async()=> ++requests===1 ? Response.json(release()) : response(), opener:async()=>assert.fail('Must not execute')});
      await updater.check(); await assert.rejects(updater.download()); await assert.rejects(updater.install());
      assert.equal(requests, 2); assert.deepEqual(await readdir(directory), []);
    } finally { await rm(directory,{recursive:true,force:true}); }
  }
});
test('updater reports missing releases, rejects concurrent work and bounds metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coop-update-api-'));
  try {
    for (const status of [404,403,429,503]) {
      const updater = new UpdateClient({currentVersion:'0.7.0',directory,fetcher:async()=>new Response(null,{status})});
      await assert.rejects(updater.check());assert.equal(updater.info().state,'error');
    }
    let done: any; const pending = new Promise(resolve=>{done=resolve;});
    const updater = new UpdateClient({currentVersion:'0.7.0',directory,fetcher:()=>pending});
    const first=updater.check();await assert.rejects(updater.check(),{code:'UPDATE_BUSY'});
    done(new Response('x'.repeat(2*1024*1024+1)));await assert.rejects(first,/过大/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
