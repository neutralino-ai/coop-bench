import { startLocalApp } from '../src/server.ts';
import { fileURLToPath } from 'node:url';
const dataDir=process.env.COOP_DATA_DIR??fileURLToPath(new URL('../data/local-server/',import.meta.url));
try{
  const local=await startLocalApp({dataDir,port:Number(process.env.PORT??8788),usersFile:process.env.COOP_USERS_FILE,trustedProxyOrigin:process.env.COOP_TRUSTED_PROXY_ORIGIN});
  console.log(`Coop Bench local server: ${local.baseUrl}\nAgent API: ${local.apiUrl}\nData: ${dataDir}\nCoordinator credential is in the local coordinator-token file (not printed).\nPID: ${process.pid}`);
  const stop=()=>local.close().then(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
}catch(error){console.error(`Could not start local server: ${error.message}`);process.exitCode=1;}
