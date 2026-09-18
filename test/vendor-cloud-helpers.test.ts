import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { signTc3 } from '../scripts/vendor/tc3.mjs';
import { parseEnvCredentials } from '../scripts/vendor/env-file.mjs';

test('vendored TC3 signer matches an independent WebCrypto calculation with synthetic credentials', async () => {
  const text = new TextEncoder();
  const digest = async value => Buffer.from(await webcrypto.subtle.digest('SHA-256', text.encode(value))).toString('hex');
  const mac = async (key, value) => {
    const imported = await webcrypto.subtle.importKey('raw', typeof key === 'string' ? text.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return webcrypto.subtle.sign('HMAC', imported, text.encode(value));
  };
  const credentials = { secretId: 'synthetic-tc3-id', secretKey: 'synthetic-tc3-key' };
  const body = '{"Domain":"example.test","Limit":100}';
  const lines = ['POST', '/', '', 'content-type:application/json; charset=utf-8', 'host:dnspod.tencentcloudapi.com', 'x-tc-action:describerecordlist', '', 'content-type;host;x-tc-action', await digest(body)];
  const scope = '2025-06-15/dnspod/tc3_request';
  const message = ['TC3-HMAC-SHA256', '1750000000', scope, await digest(lines.join('\n'))].join('\n');
  const key = await mac(await mac(await mac('TC3' + credentials.secretKey, '2025-06-15'), 'dnspod'), 'tc3_request');
  const expected = Buffer.from(await mac(key, message)).toString('hex');
  assert.equal(signTc3({ ...credentials, action: 'DescribeRecordList', body, timestamp: 1750000000 }),
    `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${expected}`);
});

test('vendored env parser preserves literal values and rejects duplicate credentials without echoing them', () => {
  assert.deepEqual(parseEnvCredentials('\uFEFFexport TENCENTCLOUD_SECRET_ID="synthetic-id" # note\r\nTENCENTCLOUD_SECRET_KEY="$(not-a-command)"'),
    { secretId: 'synthetic-id', secretKey: '$(not-a-command)' });
  assert.throws(() => parseEnvCredentials('TENCENTCLOUD_SECRET_ID=one\nTENCENTCLOUD_SECRET_ID=two\nTENCENTCLOUD_SECRET_KEY=synthetic-secret'),
    error => !error.message.includes('synthetic-secret'));
});
