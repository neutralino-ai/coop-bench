import pg from 'pg';
import {readAccessUsers} from '../src/access-control.ts';
import {applyPostgresUsers,setPostgresUserDisabled} from '../src/postgres-users.ts';
const [operation,value]=process.argv.slice(2);
if(!process.env.COOP_DATABASE_URL||!['apply-file','disable','enable'].includes(operation)||!value){
  console.error('Set COOP_DATABASE_URL. Usage: node scripts/postgres-users.mjs apply-file <access-users.json> | disable <userId> | enable <userId>');process.exitCode=1;
}else{
  const pool=new pg.Pool({connectionString:process.env.COOP_DATABASE_URL,max:1});
  try{
    const result=operation==='apply-file'?await applyPostgresUsers(pool,readAccessUsers(value).users):await setPostgresUserDisabled(pool,value,operation==='disable');
    console.log(JSON.stringify(result));
  }catch{console.error('User update failed. Check the operation, configuration and database; no credential values are logged.');process.exitCode=1;}
  finally{await pool.end();}
}
