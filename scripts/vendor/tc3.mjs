import { createHash, createHmac } from 'node:crypto';

const HOST = 'dnspod.tencentcloudapi.com';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const SIGNED_HEADERS = 'content-type;host;x-tc-action';
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value, 'utf8').digest();

/** Pure TC3 signer; body must be sent byte-for-byte unchanged. Never log its output. */
export function signTc3({ secretId, secretKey, action, body, timestamp, host = HOST, service = 'dnspod' }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const canonical = `POST\n/\n\n${canonicalHeaders}\n${SIGNED_HEADERS}\n${hash(body)}`;
  const scope = `${date}/${service}/tc3_request`;
  const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
  const key = hmac(hmac(hmac(`TC3${secretKey}`, date), service), 'tc3_request');
  return `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${hmac(key, toSign).toString('hex')}`;
}

