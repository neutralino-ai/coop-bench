export function apiUrl(value) {
  if(typeof value!=='string'||value.length>2048||/[\\\s]/.test(value))throw Error('Invalid API address.');
  const u=new URL(value),local=['127.0.0.1','localhost','[::1]'].includes(u.hostname);
  if(!(u.protocol==='https:'||(u.protocol==='http:'&&local))||u.username||u.password||u.search||u.hash||!['','/','/api/v1','/api/v1/'].includes(u.pathname))throw Error('Use HTTPS /api/v1; HTTP is allowed only on loopback.');
  return u.origin+'/api/v1';
}
export function invitation(text) {
  if(typeof text!=='string'||text.length>4096)throw Error('Invalid invitation.');
  const u=new URL(text.trim());
  if(u.protocol!=='coopbench:'||u.hostname!=='join'||u.pathname||u.username||u.password||u.search)throw Error('Paste a coopbench://join# invitation.');
  const q=new URLSearchParams(u.hash.slice(1)),roomId=q.get('room'),inviteToken=q.get('invite');
  if(!/^[a-f0-9-]{36}$/.test(roomId??'')||(inviteToken!==null&&!/^[A-Za-z0-9_-]{43}$/.test(inviteToken)))throw Error('Invalid invitation fields.');
  return {apiUrl:apiUrl(q.get('api')),roomId,...(inviteToken?{inviteToken}:{})};
}
export function inviteUrl({apiUrl:base,roomId,inviteToken}) {
  return 'coopbench://join#'+new URLSearchParams({api:apiUrl(base),room:roomId,...(inviteToken?{invite:inviteToken}:{})});
}
export async function jsonResponse(response,max=8*1024*1024) {
  if(!response.body)throw Error('Empty response.');
  const parts=[];let size=0;const reader=response.body.getReader();
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('Response size limit exceeded.');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  let data;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('Invalid JSON response.');}
  return data;
}
/** Auth headers remain at the host boundary; never put them in model context. */
export function modelObservation(observation) {
  const {decisionToken, ...safe}=observation;return safe;
}

/** The head of a snapshot is NOT an acknowledgement of paginated history.
 * Old servers deliver the whole history and omit nextCursor/hasMore. */
export function observationPage(packet, after=0) {
  const observation=packet?.observation??packet;
  if(!observation||typeof observation.observationId!=='string'||!Array.isArray(observation.updates??[]))throw Error('Invalid observation response.');
  const hasMore=packet.hasMore??observation.hasMore??false;
  const nextCursor=packet.nextCursor??observation.nextCursor??(hasMore?undefined:observation.updateCursor??after);
  if(typeof hasMore!=='boolean'||!Number.isSafeInteger(nextCursor)||nextCursor<0||hasMore&&nextCursor<=after)throw Error('Invalid observation pagination cursor.');
  if((observation.updates??[]).some(item=>!Number.isSafeInteger(item.seq)||item.seq>nextCursor))throw Error('Observation page cursor omits a delivered update.');
  return {observation:{...observation,nextCursor,hasMore},nextCursor,hasMore,...(Number.isFinite(packet.serverTime)?{serverTime:packet.serverTime}:{}),timedOut:packet.timedOut??false};
}
