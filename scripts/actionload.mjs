// Load test against a LOCAL test server (never production): N requests a second for S seconds from up to 300 signed-in
// players (trips, Home tab, Earn tab, extra shifts), printing median / p95 / p99 response times.
// Usage: node scripts/actionload.mjs [requestsPerSecond=50] [seconds=20]   (needs ADMIN_TOKEN and DATABASE_URL in .env)
import 'dotenv/config'; import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }), B = 'http://localhost:3000', A = { authorization: 'Bearer ' + process.env.ADMIN_TOKEN, 'content-type': 'application/json' };
const post = (p, b, h = A) => fetch(B + p, { method: 'POST', headers: h, body: JSON.stringify(b || {}) });
const RATE = Number(process.argv[2] || 50), SECS = Number(process.argv[3] || 20);
const ids = (await pool.query('select id from citizens where pass_hash is not null limit 300')).rows.map(r => r.id), toks = [];
for (const id of ids) { const l = (await (await post(`/api/admin/citizens/${id}/setup-link`)).json()).claimId; toks.push((await (await post(`/api/claim/${l}/password`, { password: 'loadpass1' }, { 'content-type': 'application/json' })).json()).token); }
const dest = (await pool.query("select id from buildings where type = 'cafe' limit 50")).rows.map(r => r.id), lat = [], kinds = ['visit', 'home', 'earn', 'visit', 'shift'];
let i = 0; const t0 = Date.now(), jobs = [];
while (Date.now() - t0 < SECS * 1000) { const tk = toks[i % toks.length], h = { 'x-player': tk, 'content-type': 'application/json' }, k = kinds[i % kinds.length], s = performance.now();
  const req = k === 'visit' ? post('/api/me/visit', { buildingId: dest[i % dest.length] }, h) : k === 'home' ? fetch(B + '/api/me/home', { headers: h }) : k === 'earn' ? fetch(B + '/api/me/earn', { headers: h }) : post('/api/me/earn/shift', {}, h);
  jobs.push(req.then(r => r.text()).then(() => lat.push(performance.now() - s))); i++; await new Promise(r => setTimeout(r, 1000 / RATE)); }
await Promise.all(jobs); lat.sort((a, b) => a - b); const q = f => Math.round(lat[Math.floor(lat.length * f)]);
console.log(`${RATE} requests a second for ${SECS} s (${lat.length}): median ${q(0.5)} ms, p95 ${q(0.95)} ms, p99 ${q(0.99)} ms, worst ${Math.round(lat[lat.length - 1])} ms`); process.exit(0);
