import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readEnvCredentials } from './vendor/env-file.mjs';
import { signTc3 } from './vendor/tc3.mjs';

// Read-only diagnostic for the single SSH-verified machine. No write APIs.
const region='ap-beijing',instanceId='ins-kb1dp3j9',expectedAddress='62.234.160.98';
const credentials=readEnvCredentials('C:\\Users\\xuefe\\Documents\\ChatGPT\\报销\\env.txt');
const output=fileURLToPath(new URL('../artifacts/cloud-deployment/cloud-network-report.json',import.meta.url));
const report={checkedAt:new Date().toISOString(),readOnly:true,metadata:{instanceId,region,source:'SSH: instance-id and placement/region only'},calls:[],securityGroups:[],conclusion:'unconfirmed'};
const safeToken=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(value)&&!Object.values(credentials).some(secret=>value.includes(secret))?value:undefined;
async function api(service,action,payload){
  if(!((service==='cvm'&&action==='DescribeInstances')||(service==='vpc'&&action==='DescribeSecurityGroupPolicies')||
    (service==='lighthouse'&&['DescribeInstances','DescribeFirewallRules'].includes(action))))throw Error('Unexpected API action');
  const host=`${service}.tencentcloudapi.com`,body=JSON.stringify(payload),timestamp=Math.floor(Date.now()/1000);
  const response=await fetch(`https://${host}/`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{
    Authorization:signTc3({...credentials,host,service,action,body,timestamp}),'Content-Type':'application/json; charset=utf-8',Host:host,
    'X-TC-Action':action,'X-TC-Version':service==='lighthouse'?'2020-03-24':'2017-03-12','X-TC-Timestamp':String(timestamp),'X-TC-Region':region},body});
  if(!response.ok)throw Error('HTTP_FAILURE');
  const result=(await response.json())?.Response;
  if(!result||typeof result!=='object')throw Error('INVALID_RESPONSE');
  const entry={service,action,requestId:safeToken(result.RequestId)};
  if(result.Error){entry.error=safeToken(result.Error.Code)??'PROVIDER_ERROR';report.calls.push(entry);throw Error(entry.error);}
  report.calls.push(entry);return result;
}
try{
  const result=await api('cvm','DescribeInstances',{InstanceIds:[instanceId],Limit:1});
  if(!Array.isArray(result.InstanceSet)||result.InstanceSet.length>1)throw Error('INVALID_INSTANCE_RESPONSE');
  if(result.InstanceSet.length===0){
    report.cvmMatched=false;
    const lighthouse=await api('lighthouse','DescribeInstances',{Filters:[{Name:'public-ip-address',Values:[expectedAddress]}],Limit:1});
    if(lighthouse.TotalCount!==1||!Array.isArray(lighthouse.InstanceSet)||lighthouse.InstanceSet.length!==1)throw Error('INSTANCE_NOT_RETURNED');
    const machine=lighthouse.InstanceSet[0];
    if(!/^lhins-[a-z0-9]+$/.test(machine.InstanceId)||!machine.PublicAddresses?.includes(expectedAddress))throw Error('LIGHTHOUSE_IDENTITY_MISMATCH');
    report.instance={product:'lighthouse',instanceId:machine.InstanceId,state:machine.InstanceState,publicIp:expectedAddress};
    const firewall=await api('lighthouse','DescribeFirewallRules',{InstanceId:machine.InstanceId,Offset:0,Limit:100});
    if(!Array.isArray(firewall.FirewallRuleSet)||firewall.TotalCount!==firewall.FirewallRuleSet.length)throw Error('INCOMPLETE_FIREWALL_RESPONSE');
    const fields=['Protocol','Port','CidrBlock','Ipv6CidrBlock','Action'];
    report.firewall={version:firewall.FirewallVersion,total:firewall.TotalCount,rules:firewall.FirewallRuleSet.map(rule=>Object.fromEntries(fields.filter(key=>Object.hasOwn(rule,key)).map(key=>[key,rule[key]])))};
    report.conclusion='Lighthouse firewall configuration retrieved; assess rule order and ranges before changing anything.';
  }else{
  const instance=result.InstanceSet[0];
  if(instance.InstanceId!==instanceId||!instance.PublicIpAddresses?.includes(expectedAddress))throw Error('INSTANCE_IDENTITY_MISMATCH');
  const ids=instance.SecurityGroupIds;
  if(!Array.isArray(ids)||ids.length>10||ids.some(id=>typeof id!=='string'||!/^sg-[a-z0-9]+$/.test(id)))throw Error('INVALID_SECURITY_GROUP_IDS');
  report.instance={product:'cvm',instanceId:instance.InstanceId,state:instance.InstanceState,publicIp:expectedAddress,securityGroupIds:ids};
  for(const id of ids){
    const policies=(await api('vpc','DescribeSecurityGroupPolicies',{SecurityGroupId:id})).SecurityGroupPolicySet;
    if(!policies||!Array.isArray(policies.Ingress)||policies.Ingress.length>1000)throw Error('INVALID_POLICIES');
    const fields=['PolicyIndex','Priority','Protocol','Port','CidrBlock','Ipv6CidrBlock','SecurityGroupId','Action','ServiceTemplate','AddressTemplate'];
    report.securityGroups.push({id,version:policies.Version,ingress:policies.Ingress.map(rule=>Object.fromEntries(fields.filter(key=>Object.hasOwn(rule,key)).map(key=>[key,rule[key]])))});
  }
  report.conclusion='Security-group ingress configuration retrieved; assess rule order and ranges before changing anything.';
  }
}catch(error){report.error=safeToken(error.message)??'NETWORK_OR_RESPONSE_ERROR';}
mkdirSync(fileURLToPath(new URL('../artifacts/cloud-deployment/',import.meta.url)),{recursive:true});
const text=JSON.stringify(report,null,2)+'\n';
if(Object.values(credentials).some(secret=>text.includes(secret)))throw Error('Refusing diagnostic output containing credentials');
writeFileSync(output,text,{mode:0o600});console.log(text);process.exitCode=report.error?1:0;
