import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SeatSession } from '../client/seat-session.mjs';
import { createMcpPlayServer } from '../client/mcp-play.ts';

// stdout belongs exclusively to the MCP transport. Never print credentials or
// config objects; pass a file path, not a bearer secret, in process arguments.
const file=process.argv[2];
if(!file){process.stderr.write('Usage: node scripts/mcp-play.mjs PRIVATE_SEAT_CONFIG.json\n');process.exit(1);}
let session,server,closing=false;
async function close(){if(closing)return;closing=true;await server?.close();await session?.close();}
try {
  const path=resolve(file),config=JSON.parse(readFileSync(path,'utf8'));
  session=await SeatSession.open({...config,apiUrl:config.apiUrl??config.baseUrl,seatToken:config.seatToken??process.env[config.seatTokenEnv??'COOP_SEAT_TOKEN'],directory:resolve(config.directory??join(dirname(path),'player-data','mcp-seat'))});
  server=createMcpPlayServer(session);server.server.onclose=()=>{void close();};
  process.on('SIGINT',()=>{void close();});process.on('SIGTERM',()=>{void close();});
  await server.connect(new StdioServerTransport());
}catch {process.stderr.write('Coop Bench MCP startup failed. Check the private seat config and local data directory.\n');await close();process.exitCode=1;}
