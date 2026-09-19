import pg from 'pg';
import type {SubscribeUpdates} from './seat-feed.ts';

/** Advisory wakeups only. Reconnect wakes all waiters; their DB cursor fills gaps. */
export class PostgresNotifications {
  private listeners=new Set<(id:string)=>void>();private client?:pg.Client;private timer?:ReturnType<typeof setTimeout>;private closed=false;
  private connectionString:string;
  constructor(connectionString:string) {this.connectionString=connectionString;}
  subscribe:SubscribeUpdates=(listener)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private notify(id:string){for(const fn of this.listeners)try{fn(id);}catch{}}
  async start(){
    if(this.closed)return;const client=new pg.Client({connectionString:this.connectionString,connectionTimeoutMillis:5000});this.client=client;
    const retry=()=>{
      if(this.client!==client)return;this.client=undefined;void client.end().catch(()=>{});
      if(!this.closed&&!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.start();},1000);
    };
    client.on('error',retry);client.on('end',retry);
    client.on('notification',n=>{if(n.channel==='coop_game_updates'&&n.payload)this.notify(n.payload);});
    try{await client.connect();await client.query('LISTEN coop_game_updates');this.notify('*');}catch{retry();}
  }
  async close(){this.closed=true;clearTimeout(this.timer);const c=this.client;this.client=undefined;this.listeners.clear();await c?.end().catch(()=>{});}
}
