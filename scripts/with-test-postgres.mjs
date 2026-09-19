// Real disposable PostgreSQL, bound to loopback. Never touches a production DB.
import EmbeddedPostgres from 'embedded-postgres';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';

const dir=resolve('artifacts',`pg-test-${Date.now()}`);await mkdir(dir,{recursive:true});
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const password=randomBytes(24).toString('hex');
const postgres=new EmbeddedPostgres({databaseDir:resolve(dir,'cluster'),user:'postgres',password,port,persistent:true,authMethod:'scram-sha-256',createPostgresUser:false,
  postgresFlags:['-h','127.0.0.1','-c','max_connections=100'],onLog:()=>{},onError:()=>{}});
let started=false;
try {
  await postgres.initialise();await postgres.start();started=true;await postgres.createDatabase('coop_test');
  const url=`postgresql://postgres:${password}@127.0.0.1:${port}/coop_test`;
  if(process.argv.includes('--serve')){
    const connectionPath=resolve('artifacts','postgres-test-connection.json');await writeFile(connectionPath,JSON.stringify({url,dir}),{mode:0o600});
    console.log(`Isolated PostgreSQL ready on loopback port ${port}; private connection file: ${connectionPath}`);
    await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
  }else{
    const args=process.argv.slice(2);const child=spawn(process.execPath,args.length?args:['--test','test/postgres*.test.ts'],{env:{...process.env,COOP_TEST_DATABASE_URL:url},stdio:'inherit',windowsHide:true});
    process.exitCode=await new Promise((r,j)=>{child.once('error',j);child.once('exit',code=>r(code??1));});
  }
} finally {if(started)await postgres.stop();}
