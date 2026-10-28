// Load test for a running city server on a THROWAWAY database (it adds hundreds of thousands of fake followers).
// Usage: COMMENTS=200000 VIEWERS=1000 node scripts/loadtest.mjs
import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const COMMENTS = Number(process.env.COMMENTS || 200000);
const VIEWERS = Number(process.env.VIEWERS || 1000);
const TOWERS = Number(process.env.TOWERS || 200);
const RUN = Date.now().toString(36); // fresh names and ids each run
const auth = { authorization: 'Bearer ' + process.env.ADMIN_TOKEN, 'content-type': 'application/json' };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
await db.connect();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ms = t => `${Math.round(performance.now() - t)} ms`;
const meta = async () => (await (await fetch(BASE + '/api/meta')).json()).meta;
const timed = async (label, fn, n = 1) => { const t = performance.now(); for (let i = 0; i < n; i++) await fn(); const each = (performance.now() - t) / n; console.log(`  ${label}: ${each.toFixed(1)} ms${n > 1 ? ' each' : ''}`); return each; };
const report = {};

console.log(`\n1. Viral moment: ${COMMENTS.toLocaleString()} "spawn" comments arrive at once`);
let t = performance.now();
await db.query(`insert into comments (id, t, username, text, media_id, source, status)
  select 'load-' || $3 || '-' || g, $2::bigint + g, 'fan_' || $3 || '_' || g, 'spawn me!', 'viral-post', 'instagram', 'pending' from generate_series(1, $1::int) g on conflict do nothing`, [COMMENTS, Date.now(), RUN]);
console.log(`  queued in ${ms(t)}`);
const pop0 = (await meta()).population; t = performance.now();
let last = 0;
while (true) {
  await sleep(1000);
  const m = await meta(); const done = m.population - pop0;
  if (done !== last) process.stdout.write(`\r  citizens created: ${done.toLocaleString()}   `);
  last = done; if (done >= COMMENTS) break;
  if (performance.now() - t > 30 * 60000) { console.log('\n  gave up after 30 minutes'); break; }
}
const secs = (performance.now() - t) / 1000;
report.spawnRate = Math.round(COMMENTS / secs);
console.log(`\n  absorbed in ${secs.toFixed(1)} s → ${report.spawnRate.toLocaleString()} new followers per second`);
const ev = (await (await fetch(BASE + '/api/meta')).json()).events.filter(e => e.kind === 'spawn');
console.log(`  news lines written for it: ${ev.length} (grouped, not one per person)`);

console.log('\n2. Signed webhooks hitting the server at the same time');
const secret = process.env.IG_APP_SECRET; const N = 3000, CONC = 100; let next = 0, fails = 0;
t = performance.now();
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < N) {
    const i = next++;
    const body = JSON.stringify({ object: 'instagram', entry: [{ id: 'me', time: Date.now(), changes: [{ field: 'comments', value: { id: `wh-${RUN}-${i}`, text: 'spawn', from: { username: `hook_${RUN}_${i}` }, media: { id: 'p' } } }] }] });
    const r = await fetch(BASE + '/webhooks/instagram', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex') } });
    if (r.status !== 200) fails++;
  }
}));
report.webhookRate = Math.round(N / ((performance.now() - t) / 1000));
console.log(`  ${N} webhooks with ${CONC} at a time: ${report.webhookRate.toLocaleString()} per second, ${fails} failed`);

console.log(`\n3. A new district: ${TOWERS} apartment towers (30 homes each) built one after another`);
let built = 0; t = performance.now();
for (let i = 0; i < TOWERS; i++) {
  const x = 200 + (i % 20) * 3, y = 200 + Math.floor(i / 20) * 3;
  const r = await fetch(BASE + '/api/admin/buildings', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'aptower', x, y, free: true }) });
  if (r.ok) built++;
}
report.buildMs = Math.round((performance.now() - t) / TOWERS);
console.log(`  ${built} towers, ${report.buildMs} ms per build including moving 30 people in`);
for (let i = 0; i < 10; i++) {
  const r = await fetch(BASE + '/api/admin/buildings', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'biztower', x: 200 + i * 3, y: 240, free: true }) });
  if (!r.ok) console.log('  office failed', await r.text());
}
let m = await meta();
console.log(`  residents ${m.residents.toLocaleString()}, employed ${m.employed.toLocaleString()}, waiting in the Outskirts ${m.outskirts.toLocaleString()}`);

console.log('\n4. Reads a viewer makes');
const dense = '6_6';
report.metaMs = await timed('town header + news (/api/meta)', () => fetch(BASE + '/api/meta').then(r => r.json()), 20);
const ch = await (await fetch(`${BASE}/api/chunks?keys=${dense},6_7,7_6,7_7`)).json();
console.log(`  densest district: ${ch.chunks[dense].buildings.length} buildings, ${ch.citizens.length.toLocaleString()} citizens, ${(JSON.stringify(ch).length / 1024).toFixed(0)} KB`);
report.chunkMs = await timed('load a 2×2-chunk view of it', () => fetch(`${BASE}/api/chunks?keys=${dense},6_7,7_6,7_7`).then(r => r.json()), 10);
report.searchMs = await timed('search a name prefix', () => fetch(`${BASE}/api/citizens?q=fan_${RUN}_1999`).then(r => r.json()), 20);
report.lastInQueueMs = await timed(`look up the last person in a ${m.outskirts.toLocaleString()}-person queue`, () => fetch(`${BASE}/api/citizens/hook_${RUN}_${N - 1}`).then(r => r.json()), 5);

console.log(`\n5. ${VIEWERS.toLocaleString()} people watching at once`);
const sockets = []; let got = 0;
for (let i = 0; i < VIEWERS; i++) {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  ws.on('message', raw => { const msg = JSON.parse(raw); if (msg.type === 'ops' && msg.ops.some(o => o.op === 'building' && o.data.name === 'Load test statue')) got++; });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'sub', chunks: i % 2 ? [dense] : ['0_0'] })));
  sockets.push(ws);
}
await sleep(3000);
const open = sockets.filter(s => s.readyState === 1).length;
t = performance.now();
for (const y of [202, 205, 208, 211, 214, 217, 220]) { let placed = false;
  for (let x = 202; x < 222 && !placed; x += 3) placed = (await fetch(BASE + '/api/admin/buildings', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'statue', x, y, name: 'Load test statue', free: true }) })).ok;
  if (placed) break; }
while (got < open / 2 && performance.now() - t < 10000) await sleep(20);
report.fanoutMs = Math.round(performance.now() - t);
console.log(`  ${open} connected. A new statue reached all ${got} viewers of that district in ${report.fanoutMs} ms (the other half, watching elsewhere, weren't sent it)`);
const health = await (await fetch(BASE + '/health')).json();
for (const s of sockets) s.terminate();

const size = (await db.query(`select pg_size_pretty(pg_database_size(current_database())) s, (select count(*) from citizens) n`)).rows[0];
console.log(`\nDatabase: ${Number(size.n).toLocaleString()} citizens in ${size.s}. Server reports ${health.viewers} viewers.`);
console.log(JSON.stringify(report));
await db.end();
process.exit(0);
