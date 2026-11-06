// Song files in Cloudflare R2 (S3-compatible object storage), so the database only keeps the song list and listeners
// download straight from Cloudflare's network instead of through the game server.
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET  — from Cloudflare → R2 → Manage API tokens
//   R2_PUBLIC_URL — the bucket's public address (its r2.dev link or your own domain), e.g. https://pub-xxxx.r2.dev
//   R2_ENDPOINT (optional) — another S3-compatible service's address instead of R2's (Backblaze B2, a test server…)
// Requests are signed with AWS Signature Version 4, which R2 accepts.
import crypto from 'node:crypto';

const env = k => process.env[k] || '';
export const r2On = () => !!(env('R2_ACCOUNT_ID') && env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') && env('R2_BUCKET') && env('R2_PUBLIC_URL'));
export const publicUrl = key => env('R2_PUBLIC_URL').replace(/\/+$/, '') + '/' + key.split('/').map(encodeURIComponent).join('/');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
// AWS Signature Version 4: the Authorization header for a request (exported so it can be checked against AWS's examples)
export function sign({ method, host, path, query = '', headers, hash, amz, region, service, keyId, secret }) {
  const day = amz.slice(0, 8), all = { host, ...headers }, names = Object.keys(all).map(n => n.toLowerCase()).sort(), low = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canon = [method, path, query, ...names.map(n => `${n}:${low[n]}`), '', names.join(';'), hash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`, toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  const k = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');
  return `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${crypto.createHmac('sha256', k).update(toSign).digest('hex')}`;
}
async function r2(method, key, body, type) {
  const base = env('R2_ENDPOINT') ? new URL(env('R2_ENDPOINT')) : null, host = base ? base.host : `${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`, path = '/' + env('R2_BUCKET') + '/' + key.split('/').map(encodeURIComponent).join('/');
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''), hash = sha(body || '');
  const headers = { 'x-amz-content-sha256': hash, 'x-amz-date': amz, ...(type ? { 'content-type': type } : {}), ...(method === 'PUT' ? { 'cache-control': 'public, max-age=31536000, immutable' } : {}) };
  headers.authorization = sign({ method, host, path, headers, hash, amz, region: 'auto', service: 's3', keyId: env('R2_ACCESS_KEY_ID'), secret: env('R2_SECRET_ACCESS_KEY') });
  const r = await fetch(`${base ? base.protocol : 'https:'}//${host}${path}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(60000) });
  if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`R2 ${method} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
export async function put(key, buf, type) { await r2('PUT', key, buf, type); return publicUrl(key); }
export async function del(key) { await r2('DELETE', key); }
