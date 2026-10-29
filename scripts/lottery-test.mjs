// Runs one lottery from tickets to draw on a LOCAL server (about 1 minute). Usage: node scripts/lottery-test.mjs
import 'dotenv/config';
import pg from 'pg';
const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let passed = 0, failed = 0; const ok = (c, n, x = '') => { if (c) { passed++; console.log('  ✓', n); } else { failed++; console.log('  ✗', n, x); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async (method, path, body, headers = {}) => { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const ADM = { authorization: 'Bearer ' + process.env.ADMIN_TOKEN };
await call('POST', '/api/admin/found', { name: 'Lotto Town', handle: 'founder' }, ADM);
const bed = await call('POST', '/api/admin/buildings', { type: 'aptower', x: 30, y: 40 }, ADM); await call('POST', `/api/admin/buildings/${bed.json.building?.id}/finish`, {}, ADM);
const ps = [];
for (const h of ['lucky_a', 'lucky_b']) {
  await call('POST', '/api/admin/citizens', { handle: h }, ADM);
  const id = (await pool.query('select id from citizens where handle = $1', [h])).rows[0].id;
  await pool.query('update citizens set coins_base = 100, coins_day = 0, net = 0 where id = $1', [id]);
  const link = (await call('POST', `/api/admin/citizens/${id}/setup-link`, {}, ADM)).json.claimId;
  ps.push({ h, P: { 'x-player': (await call('POST', `/api/claim/${link}/password`, { password: 'secret99' })).json.token } });
}
ok((await call('POST', '/api/me/lottery', { count: 1 }, ps[0].P)).status === 409, 'no lottery, no tickets');
ok((await call('POST', '/api/admin/lottery', { minutes: 60, price: 10, bonus: 50 })).status === 401, 'only the developer starts a lottery');
const t0 = (await call('GET', '/api/meta')).json.meta;
const st = await call('POST', '/api/admin/lottery', { minutes: 60, price: 10, bonus: 50 }, ADM);
ok(st.status === 200, 'the developer starts a lottery with a bonus', JSON.stringify(st.json));
ok((await call('POST', '/api/admin/lottery', { minutes: 60, price: 10 }, ADM)).status === 409, 'one lottery at a time');
ok((await call('POST', '/api/me/lottery', { count: 3 }, ps[0].P)).json.tickets === 3, 'a colonist buys 3 tickets');
ok((await call('POST', '/api/me/lottery', { count: 8 }, ps[0].P)).status === 400, 'at most 10 tickets each');
ok((await call('POST', '/api/me/lottery', { count: 1 }, ps[1].P)).json.tickets === 1, 'another buys 1');
const info = (await call('GET', '/api/lottery', undefined, ps[0].P)).json.lottery;
ok(info.pot === 4 * 10 + 50 && info.mine === 3 && info.players === 2, 'the pot is tickets plus bonus', JSON.stringify(info));
// bring the draw forward to 40 s from now to watch the announcement and the draw
await pool.query('update lotteries set draw_at = $1 where id = $2', [Date.now() + 40000, st.json.id]);
let ann = null; for (let i = 0; i < 30 && !ann; i++) { await sleep(1000); ann = ((await call('GET', '/api/meta')).json.events || []).find(e => e.kind === 'lottery' && /draw is in/.test(e.text)); }
ok(ann, 'the draw is announced before it happens', ann?.text);
await sleep(45000);
const done = (await call('GET', '/api/lottery')).json.lottery;
ok(done?.drawn && ['lucky_a', 'lucky_b'].includes(done.winner) && done.prize === 90, 'one ticket wins the whole pot', JSON.stringify(done));
const a = (await call('GET', '/api/citizens/lucky_a', undefined, ADM)).json.coins, b = (await call('GET', '/api/citizens/lucky_b', undefined, ADM)).json.coins;
ok(a + b === 70 + 90 + 90, `the winner is paid (${a} and ${b})`);
const ev = ((await call('GET', '/api/meta')).json.events || []).find(e => e.kind === 'lottery' && /won the lottery/.test(e.text));
ok(ev, 'and the Colony Log says who won', ev?.text);
console.log(`\n${passed} passed, ${failed} failed`); await pool.end(); process.exit(failed ? 1 : 0);
