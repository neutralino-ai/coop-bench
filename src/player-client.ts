import { randomUUID } from 'node:crypto';
import type { Envelope, Command } from './authority.ts';
import type { Action } from './types.ts';

/** Give each agent ONE instance. No create/reset/audit/other-seat capabilities. */
export class PlayerClient {
  #base:string; #episode:string; #token:string; #latest:Envelope|null=null;
  constructor(baseUrl:string,episodeId:string,seatToken:string){this.#base=baseUrl.replace(/\/$/,'');this.#episode=episodeId;this.#token=seatToken;}
  async readRules(gameId:string):Promise<any>{
    const response=await fetch(`${this.#base}/games/${encodeURIComponent(gameId)}`);
    if(!response.ok)throw new Error(`Rules: HTTP ${response.status}`);return response.json();
  }
  async observe():Promise<Envelope>{
    const response=await fetch(`${this.#base}/episodes/${encodeURIComponent(this.#episode)}/observation?after=${this.#latest?.updateCursor??0}`,{headers:{Authorization:`Bearer ${this.#token}`}});
    if(!response.ok)throw new Error(`Observe: HTTP ${response.status}`);
    return this.#latest=await response.json() as Envelope;
  }
  /** Prepare once, then reuse the SAME object on timeout/retry. */
  prepare(action:Action,decisionSummary?:string):{requestId:string;command:Command}{
    if(!this.#latest)throw new Error('Call observe first.');
    return {requestId:randomUUID(),command:{observationId:this.#latest.observationId,decisionToken:this.#latest.decisionToken,action,
      ...(decisionSummary?{decisionSummary}:{})}};
  }
  async submit(prepared:{requestId:string;command:Command}):Promise<any>{
    const response=await fetch(`${this.#base}/episodes/${encodeURIComponent(this.#episode)}/actions`,{
      method:'POST',headers:{Authorization:`Bearer ${this.#token}`,'Content-Type':'application/json','Idempotency-Key':prepared.requestId},body:JSON.stringify(prepared.command)});
    const result=await response.json() as any;
    // A successful retry returns its ORIGINAL receipt. It must not rewind a
    // newer local observation, including one obtained while this call waited.
    if(result.observation && (!this.#latest || this.#latest.decisionToken===prepared.command.decisionToken))
      this.#latest=result.observation;
    return {httpStatus:response.status,...result};
  }
}
