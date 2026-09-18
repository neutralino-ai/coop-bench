// Permanently allow the one API port explicitly requested by the owner.
// Defaults to read-only planning; --apply creates at most one cloud rule.
// Does not change nginx, SSH, host firewall, other rules or service listeners.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readEnvCredentials } from './vendor/env-file.mjs';
import { signTc3 } from './vendor/tc3.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(x => x !== '--apply')) throw Error('USAGE_READ_ONLY_OR_APPLY');
const apply = args[0] === '--apply';
const instanceId = 'lhins-g98xlmte', address = '62.234.160.98', region = 'ap-beijing', port = 34935;
const desired = { Protocol: 'TCP', Port: String(port), CidrBlock: '0.0.0.0/0', Action: 'ACCEPT', FirewallRuleDescription: 'Coop Bench HTTPS API 34935' };
const report = { schema: 'coop-firewall-update/v1', startedAt: new Date().toISOString(), apply, instanceId, address, region,
  desired, persistent: true, scope: 'Cloud IPv4 TCP 34935 only; no host, nginx, credential or other rule modifications.', calls: [] };
const output = new URL('../artifacts/client-firewall34935-' + (apply ? 'update' : 'plan') + '.json', import.meta.url);
let credentials;
const safeError = error => ({ code: /^[A-Za-z0-9_.-]{1,120}$/.test(error?.message ?? '') ? error.message : 'OPERATION_FAILED' });
function save() {
  const text = JSON.stringify(report, null, 2) + '\n';
  if (credentials && Object.values(credentials).some(secret => text.includes(secret))) throw Error('SECRET_IN_REPORT');
  mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
  writeFileSync(output, text, { mode: 0o600 });
}
async function api(action, payload) {
  if (!['DescribeInstances', 'DescribeFirewallRules', ...(apply ? ['CreateFirewallRules'] : [])].includes(action)) throw Error('UNAUTHORIZED_ACTION');
  const host = 'lighthouse.tencentcloudapi.com', timestamp = Math.floor(Date.now() / 1000), body = JSON.stringify(payload);
  const response = await fetch('https://' + host + '/', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), body, headers: {
    Authorization: signTc3({ ...credentials, action, body, timestamp, host, service: 'lighthouse' }),
    'Content-Type': 'application/json; charset=utf-8', 'X-TC-Action': action, 'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': '2020-03-24', 'X-TC-Region': region,
  } });
  if (!response.ok) throw Error('TENCENT_HTTP_' + response.status);
  const value = (await response.json()).Response;
  if (!value) throw Error('INVALID_TENCENT_RESPONSE');
  report.calls.push({ action, requestId: value.RequestId, ...(value.Error ? { error: value.Error.Code } : {}) }); save();
  if (value.Error) throw Error(value.Error.Code);
  return value;
}
const fields = ['Protocol', 'Port', 'CidrBlock', 'Ipv6CidrBlock', 'Action', 'FirewallRuleDescription'];
const normalize = rule => Object.fromEntries(fields.map(field => [field, rule[field] ?? '']));
const key = rule => JSON.stringify(normalize(rule));
async function firewall() {
  const result = await api('DescribeFirewallRules', { InstanceId: instanceId, Offset: 0, Limit: 100 });
  if (!Array.isArray(result.FirewallRuleSet) || result.TotalCount !== result.FirewallRuleSet.length || !Number.isInteger(result.FirewallVersion)) throw Error('INCOMPLETE_FIREWALL');
  return { version: result.FirewallVersion, rules: result.FirewallRuleSet.map(normalize) };
}
const matchesPort = rule => ['TCP', 'ALL'].includes(rule.Protocol) && (rule.Port === 'ALL' || String(rule.Port).split(',').some(part => {
  const [lo, hi = lo] = part.split('-').map(Number); return lo <= port && hi >= port;
}));
const allows = rule => matchesPort(rule) && rule.Action === 'ACCEPT' && rule.CidrBlock === '0.0.0.0/0';

try {
  credentials = readEnvCredentials('C:\\Users\\xuefe\\Documents\\ChatGPT\\报销\\env.txt');
  const instances = await api('DescribeInstances', { InstanceIds: [instanceId], Limit: 1 });
  if (instances.TotalCount !== 1 || instances.InstanceSet?.[0]?.InstanceId !== instanceId || !instances.InstanceSet[0].PublicAddresses?.includes(address)) throw Error('INSTANCE_IDENTITY_MISMATCH');
  report.instanceVerified = true;
  const before = report.before = await firewall();
  // Do not override a deny rule owned by another configuration task.
  if (before.rules.some(rule => matchesPort(rule) && rule.Action !== 'ACCEPT' && rule.CidrBlock)) throw Error('EXISTING_OVERLAPPING_DENY_REQUIRES_REVIEW');
  if (before.rules.some(allows)) {
    report.result = 'already-allowed'; report.after = before; report.originalRulesPreserved = true;
  } else if (!apply) report.result = 'ready-to-create';
  else {
    report.mutationAttempted = true; save();
    // The version precondition prevents a stale plan from racing another editor.
    await api('CreateFirewallRules', { InstanceId: instanceId, FirewallVersion: before.version, FirewallRules: [desired] });
    const after = report.after = await firewall();
    report.originalRulesPreserved = before.rules.every(rule => after.rules.some(other => key(other) === key(rule)));
    report.requestedRulePresent = after.rules.some(rule => key(rule) === key(desired));
    if (!report.requestedRulePresent || !report.originalRulesPreserved) throw Error('WRITE_READBACK_MISMATCH');
    report.result = 'created-and-verified';
  }
} catch (error) { report.error = safeError(error); report.result = report.mutationAttempted ? 'mutation-needs-readback' : 'unable-to-complete'; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ report: fileURLToPath(output), result: report.result, error: report.error, instanceVerified: report.instanceVerified,
    desired, before: report.before, after: report.after, originalRulesPreserved: report.originalRulesPreserved }, null, 2));
}
