import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { check, RuleError } from './common.ts';

/** Iterative validation precedes hashing/cloning in the game authority. */
export function validateJsonBudget(value:unknown):void {
  const pending:[unknown,number][]=[[value,0]];let nodes=0;
  while(pending.length){
    const [entry,depth]=pending.pop()!;
    check(++nodes<=8192 && depth<=32,'JSON structure exceeds the allowed complexity.','TOO_LARGE');
    if(typeof entry==='number')check(Number.isFinite(entry),'JSON numbers must be finite.','INVALID_REQUEST');
    if(entry && typeof entry==='object')for(const [key,child] of Object.entries(entry)){
      check(!['__proto__','prototype','constructor'].includes(key),'Reserved object key.','INVALID_REQUEST');
      pending.push([child,depth+1]);
    }
  }
}

export async function readJsonBody(request:IncomingMessage):Promise<any> {
  check(request.headers['content-type']?.split(';')[0].trim().toLowerCase()==='application/json','Use application/json.','INVALID_REQUEST');
  check(!request.headers['content-encoding'] || request.headers['content-encoding']==='identity','Compressed requests are not supported.','INVALID_REQUEST');
  const length=request.headers['content-length'];
  check(!length || Number(length)<=65536,'Request exceeds 64 KiB.','TOO_LARGE');
  const chunks:Buffer[]=[];let size=0;
  // Leave the socket available for a useful 413 reply; the handler closes it.
  for await(const chunk of request.iterator({destroyOnReturn:false})){
    size+=chunk.length;check(size<=65536,'Request exceeds 64 KiB.','TOO_LARGE');chunks.push(chunk);
  }
  let value:unknown;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{throw new RuleError('INVALID_REQUEST','Invalid JSON or UTF-8.');}
  validateJsonBudget(value);return value;
}

type Bucket={tokens:number;at:number};
export type RatePolicy={globalBurst:number;globalPerMinute:number;credentialBurst:number;credentialPerMinute:number;heavyBurst:number;heavyPerMinute:number};
export const defaultRatePolicy:RatePolicy={globalBurst:200,globalPerMinute:600,credentialBurst:60,credentialPerMinute:180,heavyBurst:8,heavyPerMinute:20};
export class RequestBudget {
  private buckets=new Map<string,Bucket>();
  private policy:RatePolicy;
  private now:()=>number;
  constructor(policy:Partial<RatePolicy>={},now=()=>performance.now()){
    this.policy={...defaultRatePolicy,...policy};this.now=now;
    for(const n of Object.values(this.policy))check(Number.isFinite(n)&&n>0,'Invalid HTTP rate policy.','INVALID_CONFIG');
  }
  private spend(key:string,burst:number,perMinute:number):void {
    const at=this.now();let bucket=this.buckets.get(key);
    if(!bucket){
      // Unknown/random bearer strings cannot grow this map without bound.
      if(this.buckets.size>=1024){
        for(const [id,item] of this.buckets)if(at-item.at>120000)this.buckets.delete(id);
        if(this.buckets.size>=1024){
          const oldest=[...this.buckets.keys()].find(id=>id!=='global');
          if(oldest)this.buckets.delete(oldest);
        }
      }
      bucket={tokens:burst,at};this.buckets.set(key,bucket);
    }
    bucket.tokens=Math.min(burst,bucket.tokens+Math.max(0,at-bucket.at)*perMinute/60000);bucket.at=at;
    this.buckets.delete(key);this.buckets.set(key,bucket);
    check(bucket.tokens>=1,'Request rate exceeded; retry later.','RATE_LIMITED');bucket.tokens--;
  }
  global():void{this.spend('global',this.policy.globalBurst,this.policy.globalPerMinute);}
  credential(token:string,heavy=false):void{
    const key=token?createHash('sha256').update(token).digest('hex'):'anonymous';
    if(heavy)this.spend(`heavy:${key}`,this.policy.heavyBurst,this.policy.heavyPerMinute);
    else this.spend(`credential:${key}`,this.policy.credentialBurst,this.policy.credentialPerMinute);
  }
}

export function validateRequestHeaders(request:IncomingMessage):void{
  check((request.url?.length??0)<=2048,'Request target is too long.','TOO_LARGE');
  check(/^\/(?!\/)/.test(request.url??''),'Only origin-form request targets are accepted.','INVALID_REQUEST');
  const counts=new Map<string,number>();
  for(let i=0;i<request.rawHeaders.length;i+=2){const name=request.rawHeaders[i].toLowerCase();counts.set(name,(counts.get(name)??0)+1);}
  for(const name of ['authorization','host','origin','idempotency-key'])check((counts.get(name)??0)<=1,'Ambiguous duplicate request header.','INVALID_REQUEST');
}

export interface SecurityEvent {at:string;method:string;endpoint:string;status:number;code?:string;principal?:string;transport?:string;}
/** Three bounded files, with no tokens, headers, bodies, or user-controlled URL. */
export function securityLogger(file:string):(event:SecurityEvent)=>void{
  let warned=false;
  return event=>{
    try{
      if(existsSync(file)&&statSync(file).size>=1024*1024){
        if(existsSync(`${file}.2`))unlinkSync(`${file}.2`);
        if(existsSync(`${file}.1`))renameSync(`${file}.1`,`${file}.2`);
        renameSync(file,`${file}.1`);
      }
      appendFileSync(file,JSON.stringify(event)+'\n',{mode:0o600});
    }catch{
      // A log failure must neither crash an already committed action nor leak paths.
      if(!warned){warned=true;console.error('Security audit log write failed; check local disk space and permissions.');}
    }
  };
}
