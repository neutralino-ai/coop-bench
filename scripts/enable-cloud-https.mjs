// Deployment-only change for the user's confirmed Lighthouse instance.
// Official additive API: https://cloud.tencent.com/document/api/1207/48254
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readEnvCredentials } from './vendor/env-file.mjs';
import { signTc3 } from './vendor/tc3.mjs';

const instanceId = 'lhins-g98xlmte', region = 'ap-beijing', address = '62.234.160.98';
const credentials = readEnvCredentials('C:\\Users\\xuefe\\Documents\\ChatGPT\\报销\\env.txt');
const host = 'lighthouse.tencentcloudapi.com';
const desired = { Protocol: 'TCP', Port: '443', CidrBlock: '0.0.0.0/0', Action: 'ACCEPT', FirewallRuleDescription: 'Coop Bench HTTPS' };
const report = { at: new Date().toISOString(), instanceId, region, address, calls: [], mutationAttempted: false };
const fields = ['Protocol', 'Port', 'CidrBlock', 'Ipv6CidrBlock', 'Action', 'FirewallRuleDescription'];
const normalize = rule => Object.fromEntries(fields.map(key => [key, rule[key] ?? '']));
const key = rule => JSON.stringify(normalize(rule));
const isDesired = rule => rule.Protocol === 'TCP' && rule.Port === '443' && rule.CidrBlock === '0.0.0.0/0' && !rule.Ipv6CidrBlock && rule.Action === 'ACCEPT';
async function api(action, payload) {
  if (!['DescribeInstances', 'DescribeFirewallRules', 'CreateFirewallRules'].includes(action)) throw Error('Unexpected action');
  const body = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(`https://${host}/`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), body, headers: {
    Authorization: signTc3({ ...credentials, host, service: 'lighthouse', action, body, timestamp }),
    'Content-Type': 'application/json; charset=utf-8', Host: host, 'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp), 'X-TC-Version': '2020-03-24', 'X-TC-Region': region,
  } });
  if (!response.ok) throw Error('HTTP_FAILURE');
  const result = (await response.json())?.Response;
  if (!result || typeof result !== 'object') throw Error('INVALID_RESPONSE');
  report.calls.push({ action, requestId: result.RequestId, ...(result.Error ? { error: result.Error.Code } : {}) });
  if (result.Error) throw Error(result.Error.Code);
  return result;
}
async function firewall() {
  const result = await api('DescribeFirewallRules', { InstanceId: instanceId, Offset: 0, Limit: 100 });
  if (!Array.isArray(result.FirewallRuleSet) || result.FirewallRuleSet.length !== result.TotalCount || !Number.isInteger(result.FirewallVersion)) throw Error('INCOMPLETE_RULES');
  return { version: result.FirewallVersion, rules: result.FirewallRuleSet.map(normalize) };
}
try {
  const instances = await api('DescribeInstances', { InstanceIds: [instanceId], Limit: 1 });
  if (instances.TotalCount !== 1 || instances.InstanceSet?.length !== 1 || instances.InstanceSet[0].InstanceId !== instanceId || !instances.InstanceSet[0].PublicAddresses?.includes(address)) throw Error('INSTANCE_IDENTITY_MISMATCH');
  const before = report.before = await firewall();
  if (before.rules.some(isDesired)) {
    report.result = 'already-configured'; report.after = before;
  } else {
    // Abort on drift from the reviewed three-rule configuration; never replace rules.
    const expected = new Set(['TCP:22', 'TCP:80', 'ICMP:ALL']);
    if (before.rules.length !== 3 || before.rules.some(rule => rule.Action !== 'ACCEPT' || rule.CidrBlock !== '0.0.0.0/0' || rule.Ipv6CidrBlock || !expected.delete(`${rule.Protocol}:${rule.Port}`)) || expected.size) throw Error('REVIEWED_CONFIGURATION_CHANGED');
    report.mutationAttempted = true;
    await api('CreateFirewallRules', { InstanceId: instanceId, FirewallVersion: before.version, FirewallRules: [desired] });
    const after = report.after = await firewall();
    const unchanged = before.rules.every(rule => after.rules.some(item => key(item) === key(rule)));
    if (after.rules.length !== before.rules.length + 1 || !after.rules.some(isDesired) || !unchanged) throw Error('READ_BACK_MISMATCH');
    report.result = 'added-and-verified';
  }
} catch (error) {
  report.error = /^[A-Za-z0-9_.-]{1,100}$/.test(error.message) ? error.message : 'NETWORK_OR_RESPONSE_ERROR';
  report.mutationMayHaveSucceeded = report.mutationAttempted;
  // Never retry a write after an uncertain response.
  process.exitCode = 1;
}
const output = fileURLToPath(new URL('../artifacts/cloud-deployment/cloud-https-firewall.json', import.meta.url));
const text = JSON.stringify(report, null, 2) + '\n';
if (Object.values(credentials).some(secret => text.includes(secret))) throw Error('Refusing to output credentials');
mkdirSync(fileURLToPath(new URL('../artifacts/cloud-deployment/', import.meta.url)), { recursive: true });
writeFileSync(output, text, { mode: 0o600 });
console.log(text);
