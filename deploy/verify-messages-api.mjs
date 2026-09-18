// Ordinary authenticated read checks on the user-authorized cloud service.
// The owner credential is received over SSH stdin and is never printed or stored.
let input = ''; for await (const chunk of process.stdin) input += chunk;
const token = input.trim();
if (!/^[A-Za-z0-9._~+\/-]+=*$/.test(token)) throw Error('Missing credential.');
const base = 'https://coop.neutrinophysics.cn';
async function request(path, auth = true) {
  const response = await fetch(base + path, {redirect:'error',signal:AbortSignal.timeout(20000),headers:auth?{Authorization:`Bearer ${token}`}:{}});
  if (!response.ok) throw Error(`Read check failed: HTTP ${response.status}`);
  return response;
}
const health = await (await request('/health',false)).json();
const identity = await (await request('/api/v1/identity')).json();
const episodeId = '9a40164c-3d95-4c79-9288-d8f62ec74f20';
const summary = await (await request(`/api/v1/rollouts/${episodeId}/messages`)).json();
const page = await (await request(`/api/v1/rollouts/${episodeId}/messages?playerId=p1&after=-1&limit=25`)).json();
const artifacts = await (await request(`/api/v1/rollouts/${episodeId}/artifacts`)).json();
const html = await (await request('/',false)).text();
if (!health.ok || !html.includes('比赛中的模型消息') || !Array.isArray(summary.seats) || summary.seats.length!==3 || !Array.isArray(page.messages) || artifacts.artifacts.length!==3) throw Error('Unexpected response structure or missing prior artifacts.');
console.log(JSON.stringify({at:new Date().toISOString(),ok:true,scope:'normal HTTPS reads from deployed server; no synthetic records added',build:health.build,identity:{id:identity.id,role:identity.role},episodeId,
  messageCounts:summary.seats.map(s=>({playerId:s.playerId,count:s.messageCount})),firstPageCount:page.messages.length,artifactCount:artifacts.artifacts.length,
  messageRetention:identity.retention.messages.policy,frontendHasMessagesPanel:true},null,2));
