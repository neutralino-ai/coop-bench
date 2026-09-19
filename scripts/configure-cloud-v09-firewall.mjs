// Additive rule for the separately deployed v0.9 service. Never replace rules.
import {mkdirSync,writeFileSync} from 'node:fs';
import {readEnvCredentials} from './vendor/env-file.mjs';
import {signTc3} from './vendor/tc3.mjs';
const args=process.argv.slice(2),apply=args.includes('--apply'),envIndex=args.indexOf('--env');
if(envIndex<0||!args[envIndex+1]||args.some((a,i)=>!['--apply','--env'].includes(a)&&i!==envIndex+1))throw Error('Usage: node scripts/configure-cloud-v09-firewall.mjs --env PRIVATE_ENV_FILE [--apply]');
const credentials=readEnvCredentials(args[envIndex+1]);
const instanceId='lhins-g98xlmte',region='ap-beijing',address='62.234.160.98',host='lighthouse.tencentcloudapi.com';
const fields=['Protocol','Port','CidrBlock','Ipv6CidrBlock','Action','FirewallRuleDescription'];
const normalize=rule=>Object.fromEntries(fields.map(k=>[k,rule[k]??'']));
const desired={Protocol:'TCP',Port:'34936',CidrBlock:'0.0.0.0/0',Action:'ACCEPT',FirewallRuleDescription:'Coop Bench v09 separate API'};
const matches=r=>r.Protocol==='TCP'&&r.Port==='34936'&&r.CidrBlock==='0.0.0.0/0'&&!r.Ipv6CidrBlock&&r.Action==='ACCEPT';
const report={at:new Date().toISOString(),instanceId,region,address,apply,calls:[],mutationAttempted:false};
async function api(action,payload){
 if(!['DescribeInstances','DescribeFirewallRules','CreateFirewallRules'].includes(action))throw Error('UNEXPECTED_ACTION');
 const body=JSON.stringify(payload),timestamp=Math.floor(Date.now()/1000);
 const response=await fetch(`https://${host}/`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),body,headers:{
  Authorization:signTc3({...credentials,host,service:'lighthouse',action,body,timestamp}),'Content-Type':'application/json; charset=utf-8',Host:host,
  'X-TC-Action':action,'X-TC-Timestamp':String(timestamp),'X-TC-Version':'2020-03-24','X-TC-Region':region}});
 if(!response.ok)throw Error(`HTTP_${response.status}`);const result=(await response.json())?.Response;
 if(!result)throw Error('INVALID_RESPONSE');report.calls.push({action,requestId:result.RequestId,...(result.Error?{error:result.Error.Code}:{})});
 if(result.Error)throw Error(result.Error.Code);return result;
}
async function readRules(){const r=await api('DescribeFirewallRules',{InstanceId:instanceId,Offset:0,Limit:100});if(!Array.isArray(r.FirewallRuleSet)||r.FirewallRuleSet.length!==r.TotalCount||!Number.isInteger(r.FirewallVersion))throw Error('INCOMPLETE_RULES');return {version:r.FirewallVersion,rules:r.FirewallRuleSet.map(normalize)};}
try{
 const r=await api('DescribeInstances',{InstanceIds:[instanceId],Limit:1});
 if(r.TotalCount!==1||r.InstanceSet?.length!==1||r.InstanceSet[0].InstanceId!==instanceId||!r.InstanceSet[0].PublicAddresses?.includes(address))throw Error('INSTANCE_IDENTITY_MISMATCH');
 report.before=await readRules();
 if(report.before.rules.some(matches)){report.after=report.before;report.result='already-configured';}
 else if(!apply)report.result='ready-to-add-one-rule';
 else{
  report.mutationAttempted=true;
  await api('CreateFirewallRules',{InstanceId:instanceId,FirewallVersion:report.before.version,FirewallRules:[desired]});
  report.after=await readRules();
  if(!report.after.rules.some(matches)||report.after.rules.length!==report.before.rules.length+1||!report.before.rules.every(old=>report.after.rules.some(next=>JSON.stringify(next)===JSON.stringify(old))))throw Error('READ_BACK_MISMATCH');
  report.result='added-and-verified';
 }
}catch(error){report.error=/^[A-Za-z0-9_.-]{1,100}$/.test(error.message)?error.message:'NETWORK_OR_RESPONSE_ERROR';report.mutationMayHaveSucceeded=report.mutationAttempted;process.exitCode=1;}
const output=JSON.stringify(report,null,2)+'\n';if(Object.values(credentials).some(v=>output.includes(v)))throw Error('Refusing to output credentials');
mkdirSync('artifacts/cloud-v09',{recursive:true});writeFileSync(`artifacts/cloud-v09/firewall-${apply?'apply':'read'}.json`,output);console.log(output);
