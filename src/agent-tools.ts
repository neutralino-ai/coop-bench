import { PlayerClient } from './player-client.ts';
import { canonical } from './authority.ts';
import { check, exactKeys, object } from './common.ts';
import type { Action } from './types.ts';

export const MESSAGE_ACTIONS = ['speak','message','chat','communicate','hint','signal'];
/** Model-provider-neutral tools. Wire each instance to exactly one player's model
 * session. The coordinator/SQLite object never enters this closure or its output. */
export function createPlayerTools(config:{baseUrl:string;episodeId:string;gameId:string;token:string}) {
  const client=new PlayerClient(config.baseUrl,config.episodeId,config.token);
  const pending=new Map<string,{fingerprint:string;prepared:ReturnType<PlayerClient['prepare']>}>();
  const actionParameters={type:'object',properties:{requestId:{type:'string',description:'A unique command identifier. Reuse unchanged on retry.'},action:{type:'object',description:'Choose a full action from the latest observation legalActions schema.'},decisionSummary:{type:'string',maxLength:1200,description:'Optional brief stated reason, private audit only.'}},required:['requestId','action'],additionalProperties:false};
  const definitions=[
    {name:'read_rules',description:'Read this game’s official scope, rule summary, sources and omissions.',parameters:{type:'object',properties:{},additionalProperties:false}},
    {name:'observe',description:'Pull only your own current view, public messages and available action schemas.',parameters:{type:'object',properties:{},additionalProperties:false}},
    {name:'send_message',description:'Submit a rule-permitted speech or structured hint action. This grants no extra communication channel.',parameters:actionParameters},
    {name:'act',description:'Submit a game action from your latest observation. Outcomes depend on hidden state; legal does not mean successful.',parameters:actionParameters}
  ];
  async function call(name:string,args:unknown):Promise<unknown> {
    check(object(args),'Tool arguments must be an object.','INVALID_REQUEST');
    if(name==='read_rules'){exactKeys(args,[]);return client.readRules(config.gameId);}
    if(name==='observe'){exactKeys(args,[]);return client.observe();}
    check(name==='act' || name==='send_message','Unknown tool.','INVALID_REQUEST');
    exactKeys(args,['requestId','action','decisionSummary']);
    check(typeof args.requestId==='string' && /^[A-Za-z0-9._:-]{1,100}$/.test(args.requestId) && object(args.action),'Invalid command arguments.','INVALID_REQUEST');
    if(name==='send_message')check(MESSAGE_ACTIONS.includes(args.action.type),'Use the game’s actual speech/hint action type.','ILLEGAL_ACTION');
    const fingerprint=canonical({name,action:args.action,decisionSummary:args.decisionSummary??null});
    let entry=pending.get(args.requestId);
    if(entry)check(entry.fingerprint===fingerprint,'Request ID was reused with different arguments.','IDEMPOTENCY_CONFLICT');
    else {entry={fingerprint,prepared:client.prepare(args.action as Action,args.decisionSummary)};entry.prepared.requestId=args.requestId;pending.set(args.requestId,entry);}
    return client.submit(entry.prepared);
  }
  return {definitions,call};
}
