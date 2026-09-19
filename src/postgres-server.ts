import {existsSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PostgresAuthority} from './postgres-authority.ts';
import {PostgresRooms} from './postgres-rooms.ts';
import {PostgresAuth} from './postgres-auth.ts';
import {PostgresNotifications} from './postgres-notifications.ts';
import {createApi} from './server.ts';
import {AccessControl,readAccessUsers,tokenHash,type AccessUser} from './access-control.ts';
import {games} from './registry.ts';
import {check} from './common.ts';
import type {AuthorityLimits} from './authority.ts';

export interface PostgresServerOptions {
  databaseUrl:string;adminToken:string;port?:number;users?:AccessUser[];trustedProxyOrigin?:string;serveWeb?:boolean;
  limits?:Partial<AuthorityLimits>;build?:string;
}
/** Replicas share DB state. The public listener remains behind a loopback proxy. */
export async function startPostgresApp(options:PostgresServerOptions) {
  check(typeof options.databaseUrl==='string'&&/^postgres(ql)?:\/\//.test(options.databaseUrl),'Set COOP_DATABASE_URL to PostgreSQL.','INVALID_CONFIG');
  check(typeof options.adminToken==='string'&&options.adminToken.length>=24&&options.adminToken.length<=256,'Set a private COOP_ADMIN_TOKEN of at least 24 characters.','INVALID_CONFIG');
  const port=options.port??8788;check(Number.isSafeInteger(port)&&port>=0&&port<=65535,'Invalid port.','INVALID_CONFIG');
  const authority=new PostgresAuthority(options.databaseUrl,games,options.build,options.limits),auth=new PostgresAuth(authority.pool),rooms=new PostgresRooms(authority),notifications=new PostgresNotifications(options.databaseUrl);
  let app:ReturnType<typeof createApi>|undefined;
  try{
    await authority.ready();await rooms.readySchema();await auth.ready(options.users??[{id:'owner',role:'operator',tokenHash:tokenHash(options.adminToken),disabled:false}]);
    const access=new AccessControl({trustedProxyOrigin:options.trustedProxyOrigin});
    app=createApi(authority,options.adminToken,{access,humanAuth:auth,rooms,subscribe:notifications.subscribe,serveWeb:options.serveWeb??false});
    await new Promise<void>((r,j)=>{app!.once('error',j);app!.listen(port,'127.0.0.1',r);});await notifications.start();
    const baseUrl=`http://127.0.0.1:${(app.address() as any).port}`;let closing:Promise<void>|undefined;
    const close=()=>closing??=(async()=>{await notifications.close();const stopped=new Promise<void>(r=>app!.close(()=>r()));app!.closeAllConnections();await stopped;await auth.close();await authority.close();})();
    return {baseUrl,apiUrl:`${baseUrl}/api/v1`,authority,rooms,auth,close};
  }catch(error){if(app?.listening){app.close();app.closeAllConnections();}await notifications.close();await auth.close();await authority.close();throw error;}
}
if(process.argv[1]&&existsSync(resolve(process.argv[1]))&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href){
  startPostgresApp({databaseUrl:process.env.COOP_DATABASE_URL??'',adminToken:process.env.COOP_ADMIN_TOKEN??'',port:Number(process.env.PORT??8788),
    ...(process.env.COOP_USERS_FILE?{users:readAccessUsers(process.env.COOP_USERS_FILE).users}:{}),trustedProxyOrigin:process.env.COOP_TRUSTED_PROXY_ORIGIN,serveWeb:process.env.COOP_SERVE_WEB==='1'})
    .then(server=>{console.log(`Coop Bench PostgreSQL API: ${server.apiUrl}\nListener: loopback only. Credentials and database URL are not logged.`);const stop=()=>void server.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);})
    .catch(()=>{console.error('PostgreSQL server failed to start. Check database availability, configuration and pinned schema/build.');process.exitCode=1;});
}
