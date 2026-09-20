import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SeatSession } from './seat-session.mjs';

/** MCP and HTTP share the seat protocol; this bridge has no game authority.
 * The host config supplies credentials once. No tool accepts a seat token. */
export function createMcpPlayServer(session:SeatSession) {
  const server=new McpServer({name:'coop-bench-player',version:'1.0.0'},{instructions:'You control exactly one seat. Read rules, call wait, read every page while hasMore, then act using the returned decisionToken and a new requestId. Reuse the same requestId and arguments on a transport failure. wait does not extend deadlines. Communications are only legal game actions. This bridge records tool traffic, not your host model messages or hidden reasoning; a provider-aware recorder must upload those separately.'});
  const output=(value:any)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value,...(value.httpStatus>=400||value.accepted===false?{isError:true}:{})});
  const failure=(error:any)=>({isError:true,content:[{type:'text' as const,text:JSON.stringify({error:{code:error.code??(error.name==='AbortError'?'CANCELLED':'PLAYER_TOOL_ERROR'),message:typeof error.code==='string'?error.message:'The player tool failed; retry transport failures with the same requestId.'}})}]});
  server.registerTool('rules',{description:'Read the official rule scope, scenario and permitted actions for this seat.',inputSchema:{},annotations:{readOnlyHint:true,idempotentHint:true}},async(_args,extra)=>{try{return output(await session.rules({signal:extra.signal}));}catch(error){return failure(error);}});
  server.registerTool('wait',{description:'Wait for your seat-visible updates or an actionable decision. Returns nextCursor, hasMore, decisionToken and the fixed server deadline. Read additional pages before acting; no extra timeout budget is granted.',inputSchema:{cursor:z.number().int().nonnegative().optional(),timeoutMs:z.number().int().min(0).max(50000).optional()},annotations:{readOnlyHint:true,idempotentHint:true}},async(args,extra)=>{try{return output(await session.wait({...args,signal:extra.signal}));}catch(error){return failure(error);}});
  server.registerTool('act',{description:'Submit one permitted action, including legal game communication. Use a new requestId per intended action, and retry unchanged after transport failure. It is private to this seat; no credentials are tool arguments.',inputSchema:{requestId:z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),decisionToken:z.string().min(1).max(512),action:z.record(z.string(),z.unknown()),decisionSummary:z.string().max(1200).optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},async(args,extra)=>{try{return output(await session.act(args,{signal:extra.signal}));}catch(error){return failure(error);}});
  return server;
}
