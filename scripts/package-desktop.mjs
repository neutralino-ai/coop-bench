import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, readdirSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const [kind, ...args] = process.argv.slice(2);
if (!['management', 'player'].includes(kind)) throw Error('Expected management or player');
if (process.platform !== 'darwin') throw Error('This signing wrapper requires macOS');
const signed = process.platform === 'darwin' && process.env.SIGN_APPLE === 'true';
const env = {...process.env};
const config = kind === 'player' ? 'build/player-electron-builder.json' : 'build/electron-builder.json';
let temp;
function run(command, argv, capture = false) {
  const result = spawnSync(command, argv, {env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit'});
  if (result.status !== 0) throw Error(`${command} failed (${result.status})${capture ? ': '+result.stderr : ''}`);
  return result.stdout;
}
try {
  if (signed) {
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') throw Error('Pull requests cannot sign');
    for (const key of ['MAC_DEVELOPER_ID_P12','MAC_DEVELOPER_ID_PASSWORD','APPLE_API_KEY_P8','APPLE_API_KEY_ID','APPLE_API_ISSUER','APPLE_TEAM_ID']) {
      if (!env[key]?.trim()) throw Error(`Missing required signing secret: ${key}`);
    }
    temp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'coop-sign-'));
    env.APPLE_API_KEY = join(temp, 'AuthKey.p8');
    writeFileSync(env.APPLE_API_KEY, env.APPLE_API_KEY_P8, {mode: 0o600});
    env.CSC_LINK = env.MAC_DEVELOPER_ID_P12;
    env.CSC_KEY_PASSWORD = env.MAC_DEVELOPER_ID_PASSWORD;
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
    args.push('--config.forceCodeSigning=true', '--config.mac.notarize=true');
  } else {
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }
  run('pnpm', ['exec','electron-builder','--config',config,...args,'--publish','never']);
  if (signed) {
    const dir = kind === 'player' ? 'release-player' : 'release';
    mkdirSync('artifacts/apple-signing', {recursive:true});
    for (const name of readdirSync(dir).filter(name=>name.endsWith('.dmg'))) {
      const file=join(dir,name);
      const receipt=JSON.parse(run('xcrun',['notarytool','submit',file,'--key',env.APPLE_API_KEY,'--key-id',env.APPLE_API_KEY_ID,'--issuer',env.APPLE_API_ISSUER,'--wait','--timeout','20m','--output-format','json'],true));
      writeFileSync(`artifacts/apple-signing/${name}.notary.json`,JSON.stringify(receipt,null,2));
      if(receipt.status!=='Accepted')throw Error(`Notarization rejected: ${name}`);
      run('xcrun',['stapler','staple',file]);
      run('xcrun',['stapler','validate',file]);
    }
  }
} finally {
  if(temp)rmSync(temp,{recursive:true,force:true});
}
