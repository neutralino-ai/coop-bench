import {check} from './common.ts';
import type {Envelope} from './authority.ts';

export interface SeatReader {observe(id:string,token:string,after?:number,limit?:number):Envelope|Promise<Envelope>;}
export type SubscribeUpdates=(listener:(episodeId:string)=>void)=>()=>void;
/** Waiters hold sockets only, never a database connection or transaction. */
export async function waitForSeat(authority:SeatReader,id:string,token:string,options:{after:number;timeoutMs:number;limit:number;signal:AbortSignal;subscribe?:SubscribeUpdates}) {
  const {after,timeoutMs,limit,signal}=options;
  check(Number.isSafeInteger(after)&&after>=0&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=0&&timeoutMs<=50000&&Number.isSafeInteger(limit)&&limit>=1&&limit<=500,'Invalid wait parameters.','INVALID_REQUEST');
  const end=Date.now()+timeoutMs;let generation=0,wake:(()=>void)|undefined;
  const notify=()=>{generation++;wake?.();};
  const unsubscribe=options.subscribe?.(changed=>{if(changed===id||changed==='*')notify();});
  signal.addEventListener('abort',notify);
  try {
    while(true){
      if(signal.aborted)throw new Error('Wait cancelled');
      const before=generation,observation=await authority.observe(id,token,after,limit);
      const nextCursor=observation.nextCursor??observation.updateCursor??after;
      const timedOut=Date.now()>=end;
      if(nextCursor>after||observation.status!=='active'||timedOut)
        return {observation,nextCursor,hasMore:observation.hasMore??false,serverTime:Date.now(),timedOut};
      if(generation!==before)continue;
      await new Promise<void>(resolve=>{
        const done=()=>{clearTimeout(timer);wake=undefined;resolve();};
        const timer=setTimeout(done,Math.min(1000,Math.max(0,end-Date.now())));wake=done;
        if(generation!==before||signal.aborted)done();
      });
    }
  }finally{unsubscribe?.();signal.removeEventListener('abort',notify);wake?.();}
}
