import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { desktopFiles, webFiles, packageFiles } from '../scripts/client-files.mjs';
import { invitation, inviteUrl } from '../client/protocol.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=(name:string)=>readFileSync(resolve(root,name),'utf8');

test('public client has no game authority, deployment tree, backend dependencies or local launch mode',()=>{
  for(const name of ['src','deploy','experiments','sources','desktop/local-main.mjs','desktop/local-preload.cjs'])
    assert.equal(existsSync(resolve(root,name)),false,'Private backend path must not enter the client: '+name);
  const pkg=JSON.parse(read('package.json'));
  for(const name of ['pg','@types/pg','embedded-postgres'])assert.equal(pkg.dependencies?.[name]??pkg.devDependencies?.[name],undefined);
  assert.equal(pkg.scripts['desktop:local'],undefined);assert.equal(pkg.scripts['start:server'],undefined);
  assert.doesNotMatch(read('desktop/main.mjs'),/local-main|--local|startLocalApp/);
  assert.doesNotMatch(read('web/transport.js'),/legacyLocal|value\.adminToken/);
  for(const name of readdirSync(resolve(root,'client')))
    assert.doesNotMatch(read('client/'+name),/from ['"][^'"]*(?:src\/|postgres|games\/)|import\(['"][^'"]*(?:src\/|postgres|games\/)/);
  assert.match(read('scripts/mcp-play.mjs'),/client\/mcp-play\.ts/);
});

test('both installers use a fixed client allowlist instead of bundling desktop or backend trees',()=>{
  const admin=JSON.parse(read('build/electron-builder.json')),player=JSON.parse(read('build/player-electron-builder.json'));
  const positive=admin.files.filter((name:string)=>!name.startsWith('!'));
  const expanded=positive.flatMap((name:string)=>name==='runtime/coop-bench/web/**/*'?webFiles.map(file=>'runtime/coop-bench/web/'+file):[name]);
  assert.deepEqual([...expanded].sort(),[...packageFiles].sort());
  assert.ok(desktopFiles.every((name:string)=>!name.includes('local-')&&!name.includes('pg-')));
  assert.equal(player.extends,'./build/electron-builder.json');assert.equal(player.files,undefined);
  assert.equal(admin.appId,'org.coopbench.desktop');assert.equal(player.appId,'org.coopbench.player');
  assert.equal(player.protocols[0].schemes[0],'coopbench');
});

test('invitation transport rejects remote plaintext, unrelated schemes and embedded credentials',()=>{
  const config={apiUrl:'https://coop.example/api/v1',roomId:'01234567-0123-0123-0123-012345678901',inviteToken:'a'.repeat(43)};
  assert.deepEqual(invitation(inviteUrl(config)),config);
  assert.throws(()=>inviteUrl({...config,apiUrl:'http://remote.example'}));
  assert.throws(()=>invitation('https://evil.test/#x'));
  assert.throws(()=>inviteUrl({...config,apiUrl:'https://user:password@coop.example'}));
});
