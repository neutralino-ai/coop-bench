import type {Pool} from 'pg';
import {validateAccessUsers,type AccessUser} from './access-control.ts';
import {check} from './common.ts';

/** Operator CLI only; never expose this management capability to player tools. */
export async function applyPostgresUsers(pool:Pool,users:AccessUser[]) {
  validateAccessUsers({version:1,users});const db=await pool.connect();
  try{
    await db.query('BEGIN');
    // Sort locks so two explicit batch updates cannot deadlock on opposite user order.
    for(const user of [...users].sort((a,b)=>a.id.localeCompare(b.id))){
      const before=(await db.query('SELECT token_hash FROM coop_pg_users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
      await db.query(`INSERT INTO coop_pg_users VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET
        role=excluded.role,token_hash=excluded.token_hash,disabled=excluded.disabled,expires_at=excluded.expires_at`,[user.id,user.role,user.tokenHash,user.disabled,user.expiresAt??null]);
      if(user.disabled||before?.token_hash!==user.tokenHash)await db.query('DELETE FROM coop_pg_sessions WHERE user_id=$1',[user.id]);
    }
    await db.query('COMMIT');return {updated:users.map(u=>({id:u.id,role:u.role,disabled:u.disabled}))};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function setPostgresUserDisabled(pool:Pool,id:string,disabled:boolean) {
  check(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id),'Invalid user ID.','INVALID_REQUEST');const db=await pool.connect();
  try{
    await db.query('BEGIN');const result=await db.query('UPDATE coop_pg_users SET disabled=$2 WHERE id=$1 RETURNING id,role,disabled',[id,disabled]);
    check(result.rowCount===1,'Unknown user.','NOT_FOUND');if(disabled)await db.query('DELETE FROM coop_pg_sessions WHERE user_id=$1',[id]);
    await db.query('COMMIT');return result.rows[0];
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
