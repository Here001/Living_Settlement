// Watches one full race cycle on a LOCAL server started with RACE_EVERY_MS=70000 (takes about 2-3 minutes).
// Usage: RACE_EVERY_MS=70000 node server/index.js   then   node scripts/races-test.mjs
import 'dotenv/config';
import pg from 'pg';
const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let passed = 0, failed = 0; const ok = (c, n, x = '') => { if (c) { passed++; console.log('  ✓', n); } else { failed++; console.log('  ✗', n, x); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async (method, path, body, headers = {}) => { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const ADM = { authorization: 'Bearer ' + process.env.ADMIN_TOKEN };
await call('POST', '/api/admin/found', { name: 'Race Town', handle: 'founder' }, ADM);
ok((await call('GET', '/api/race')).json.track === null, 'no Racetrack, no races');
const tr = await call('POST', '/api/admin/buildings', { type: 'racetrack', x: 40, y: 40 }, ADM); await call('POST', `/api/admin/buildings/${tr.json.building?.id}/finish`, {}, ADM);
const bed = await call('POST', '/api/admin/buildings', { type: 'aptower', x: 30, y: 40 }, ADM); await call('POST', `/api/admin/buildings/${bed.json.building?.id}/finish`, {}, ADM);
const players = [];
for (const h of ['punter_a', 'punter_b', 'punter_c', 'punter_d', 'punter_e', 'punter_f']) {
  await call('POST', '/api/admin/citizens', { handle: h }, ADM);
  const id = (await pool.query('select id from citizens where handle = $1', [h])).rows[0].id;
  await pool.query('update citizens set coins_base = 1000, coins_day = 0, net = 0 where id = $1', [id]);
  const link = (await call('POST', `/api/admin/citizens/${id}/setup-link`, {}, ADM)).json.claimId;
  const tok = (await call('POST', `/api/claim/${link}/password`, { password: 'secret99' })).json.token;
  players.push({ h, id, P: { 'x-player': tok } });
}
await sleep(3500);
let info = (await call('GET', '/api/race', undefined, players[0].P)).json;
ok(info.track && info.next && info.next.no >= 1 && info.next.no < 100 && Object.keys(info.next.odds).length === 6, 'a Racetrack opens betting on the next race', JSON.stringify(info).slice(0, 200));
const nx = info.next;
ok((await call('POST', '/api/me/race/bet', { creature: 'starcrest', amount: 50 })).status === 401, 'only signed-in colonists bet');
ok((await call('POST', '/api/me/race/bet', { creature: 'unicorn', amount: 50 }, players[0].P)).status === 400, 'unknown creatures are refused');
ok((await call('POST', '/api/me/race/bet', { creature: 'starcrest', amount: 5000 }, players[0].P)).status === 400, "can't bet more than you have");
const ids = Object.keys(nx.odds);
const bets = [];
for (const [i, p] of players.entries()) { const r = await call('POST', '/api/me/race/bet', { creature: ids[i], amount: 100 }, p.P); bets.push(r.json); ok(r.status === 200 && r.json.coins === 900, `${p.h} bets 100 on ${ids[i]}`, JSON.stringify(r.json)); }
ok((await call('POST', '/api/me/race/bet', { creature: ids[1], amount: 10 }, players[0].P)).status === 409, 'one bet per race');
const label = n => n; // races are shown as #1, #2…
const cup = await call('POST', '/api/admin/race/cup', { bonus: 300, name: 'Test Cup' }, ADM);
ok(cup.status === 200 && cup.json.cup.bonus === 300, 'the developer makes it a Cup with a bonus');
console.log(`  … waiting for Race #${nx.no} (starts in ${Math.round((nx.start - Date.now()) / 1000)} s)`);
// announcement 2.5 min before the start (35 s with a 70 s test cycle)
while (Date.now() < nx.start + 3000) {
  const ev = (await call('GET', '/api/meta')).json.events || [];
  if (ev.some(e => e.kind === 'race' && e.text.includes(`Race #${nx.no} starts`))) break;
  await sleep(2000);
}
const evA = ((await call('GET', '/api/meta')).json.events || []).find(e => e.kind === 'race' && e.text.includes(`Race #${nx.no} starts`));
ok(evA && Date.now() < nx.start, 'the Colony Log announces the race before it starts', evA?.text);
ok(evA && nx.start - evA.t >= 30000, `announced ${evA ? Math.round((nx.start - evA.t) / 1000) : '?'} s ahead (2½ min on the live 30-minute cycle)`);
while (Date.now() < nx.start + 2500) await sleep(500);
info = (await call('GET', '/api/race')).json;
ok(info.last?.n === nx.n && info.last.result?.order?.length === 6 && !info.last.settled, 'the race starts with a result everyone animates', JSON.stringify(info.last).slice(0, 160));
const late = await call('POST', '/api/me/race/bet', { creature: ids[1], amount: 10 }, players[1].P); ok(late.status === 200 && late.json.n === nx.n + 1, 'bets after the start go on the next race'); await pool.query('delete from race_bets where n = $1', [nx.n + 1]); await pool.query('update citizens set coins_base = coins_base + 10 where handle = $1', [players[1].h]);
const tre0 = (await call('GET', '/api/meta')).json.meta.treasuryBase;
while (Date.now() < nx.start + 45000 + 4000) await sleep(1000);
await sleep(2000);
info = (await call('GET', '/api/race', undefined, players[0].P)).json;
ok(info.last?.settled, 'the race is settled after it finishes');
const win = info.last.result.order[0];
const rows = (await pool.query('select handle, creature, amount, pays, payout from race_bets where n = $1', [nx.n])).rows;
const winners = rows.filter(r => r.creature === win), stake = winners.reduce((s, r) => s + r.amount, 0);
for (const r of rows) {
  const expect = r.creature === win ? Math.floor(r.amount * r.pays) + Math.floor(300 * r.amount / stake) : 0;
  ok(r.payout === expect, `${r.handle} (${r.creature}) is paid ${expect}`, `got ${r.payout}`);
  const c = (await call('GET', `/api/citizens/${r.handle}`, undefined, ADM)).json.coins;
  ok(c === 900 + expect, `${r.handle}'s coins: ${c}`);
}
const evW = ((await call('GET', '/api/meta')).json.events || []).find(e => e.kind === 'race' && e.text.includes(`Race #${nx.no}`) && e.text.includes('won'));
ok(evW && /\d+ colonists? won/.test(evW.text), 'the winner and the payout are announced in the Colony Log', evW?.text);
ok(info.form[win].wins >= 1 && info.form[win].last[0] === 1, 'form records the win');
console.log(`\n${passed} passed, ${failed} failed`); await pool.end(); process.exit(failed ? 1 : 0);
