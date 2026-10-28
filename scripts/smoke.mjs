// End-to-end check of a running city server.
// Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=... CRON_KEY=... IG_APP_SECRET=... node scripts/smoke.mjs
// Run it against a fresh database: it founds a settlement.
import 'dotenv/config';
import crypto from 'node:crypto';
import WebSocket from 'ws';

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const TOKEN = process.env.ADMIN_TOKEN;
let passed = 0, failed = 0;
const ok = (cond, name, extra = '') => { if (cond) { passed++; console.log('  ✓', name); } else { failed++; console.log('  ✗', name, extra); } };

async function call(method, path, body, { auth = true, headers = {}, raw } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined || raw ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: 'Bearer ' + TOKEN } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

// Collect live updates the way a browser would.
const live = [];
const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
ws.on('message', m => live.push(JSON.parse(m)));
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
const waitFor = async (pred, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (live.some(pred)) return true; await new Promise(r => setTimeout(r, 25)); } return false; };
const sawOp = op => m => m.type === 'ops' && m.ops.some(op);

console.log('Viewer access');
ok(await waitFor(m => m.type === 'snapshot'), 'WebSocket sends a snapshot on connect');
ok((await call('GET', '/health', undefined, { auth: false })).status === 200, 'health check');
ok((await call('GET', '/api/world', undefined, { auth: false })).status === 200, 'anyone can read the world');
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: 0, y: 0 }, { auth: false })).status === 401, 'building without a token is refused');
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: 0, y: 0 }, { headers: { authorization: 'Bearer wrong-token-000000000' } })).status === 401, 'wrong token is refused');
ok((await call('GET', '/', undefined, { auth: false })).status === 200, 'city page is served');
ok((await call('GET', '/shared/catalog.js', undefined, { auth: false })).status === 200, 'shared catalog is served');

console.log('Founding');
let r = await call('POST', '/api/admin/buildings', { type: 'house', x: 9, y: 9 });
ok(r.status === 409, 'cannot build before founding', JSON.stringify(r.json));
r = await call('POST', '/api/admin/found', { name: 'Testville', handle: '@builder' });
ok(r.status === 200 && r.json.name === 'Testville', 'found the settlement', JSON.stringify(r.json));
ok(await waitFor(m => m.type === 'snapshot' && m.world.meta?.name === 'Testville'), 'viewers get the new world live');
ok((await call('POST', '/api/admin/found', { name: 'Again' })).status === 409, 'cannot found twice');
let world = (await call('GET', '/api/world', undefined, { auth: false })).json;
ok(world.citizens.length === 1 && world.citizens[0].founder, 'founder citizen exists');
ok(world.buildings.some(b => b.type === 'tent') && world.buildings.some(b => b.type === 'campfire'), 'starter tent and campfire exist');
const startFunds = world.meta.treasury;

console.log('Building');
r = await call('POST', '/api/admin/buildings', { type: 'house', x: 10, y: 10, name: 'Anna’s House', requestedBy: '@anna' });
ok(r.status === 200 && r.json.building?.id, 'build a house', JSON.stringify(r.json));
const house = r.json.building;
ok(await waitFor(sawOp(o => o.op === 'building' && o.data.id === house.id)), 'viewers see the house appear live');
world = (await call('GET', '/api/world', undefined, { auth: false })).json;
ok(world.meta.treasury === startFunds - 900, 'house cost 900 coins', `${startFunds} → ${world.meta.treasury}`);
ok(world.events.some(e => e.text.includes('requested by @anna')), 'news credits the requester');
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: 11, y: 11 })).status === 409, 'overlapping build is refused');
ok((await call('POST', '/api/admin/buildings', { type: 'spaceship', x: 30, y: 30 })).status === 400, 'unknown building type is refused');
r = await call('POST', '/api/admin/buildings', { type: 'biztower', x: 40, y: 40 });
ok(r.status === 402, 'too expensive is refused', JSON.stringify(r.json));
r = await call('POST', '/api/admin/buildings', { type: 'biztower', x: 40, y: 40, free: true });
ok(r.status === 200, 'free build skips the cost');
const tower = r.json.building;

console.log('Moving, demolishing, undo');
ok((await call('PATCH', `/api/admin/buildings/${house.id}`, { x: 20, y: 20 })).status === 200, 'move the house');
world = (await call('GET', '/api/world', undefined, { auth: false })).json;
ok(world.buildings.find(b => b.id === house.id)?.x === 20, 'house is at its new spot');
const beforeDemolish = world.meta.treasury;
ok((await call('DELETE', `/api/admin/buildings/${tower.id}`)).status === 200, 'demolish the tower');
ok(await waitFor(sawOp(o => o.op === 'removeBuilding' && o.id === tower.id)), 'viewers see it disappear');
world = (await call('GET', '/api/world', undefined, { auth: false })).json;
ok(world.meta.treasury === beforeDemolish, 'plain demolish gives no refund');
ok((await call('POST', '/api/admin/buildings/restore', { building: tower })).status === 200, 'undo demolish restores it');
world = (await call('GET', '/api/world', undefined, { auth: false })).json;
ok(world.buildings.some(b => b.id === tower.id), 'tower is back');
r = await call('POST', '/api/admin/buildings', { type: 'cafe', x: 50, y: 50 });
const cafe = r.json.building; const afterCafe = (await call('GET', '/api/world', undefined, { auth: false })).json.meta.treasury;
ok((await call('DELETE', `/api/admin/buildings/${cafe.id}?refund=1`)).status === 200, 'undo a build');
ok((await call('GET', '/api/world', undefined, { auth: false })).json.meta.treasury === afterCafe + 1000, 'undoing a build refunds it');

console.log('Roads');
r = await call('POST', '/api/admin/roads', { set: { '0,5': 'street', '1,5': 'street', '2,5': 'trees' } });
ok(r.status === 200 && r.json.changed === 3 && r.json.cost === 105, 'lay three road tiles', JSON.stringify(r.json));
ok(await waitFor(sawOp(o => o.op === 'roads' && o.set['0,5'] === 'street')), 'viewers see the road live');
r = await call('POST', '/api/admin/roads', { set: { '20,20': 'street' } });
ok(r.json.changed === 0, 'roads cannot go through a house');
ok((await call('POST', '/api/admin/buildings', { type: 'cottage', x: 1, y: 5 })).status === 409, 'buildings cannot go on a road');
r = await call('POST', '/api/admin/roads', { remove: ['2,5'] });
ok(r.json.changed === 1, 'remove a road tile');
world = (await call('GET', '/api/world', undefined, { auth: false })).json;
ok(world.roads['0,5'] === 'street' && !world.roads['2,5'], 'roads saved correctly');

console.log('Citizens');
r = await call('POST', '/api/admin/citizens', { handle: '@kofi.b' });
ok(r.status === 200 && r.json.citizen.handle === 'kofi.b', 'spawn a citizen by hand');
const kofi = r.json.citizen;
ok((await call('POST', '/api/admin/citizens', { handle: 'KOFI.B' })).status === 409, 'no duplicate citizens (case-insensitive)');
ok((await call('GET', '/api/citizens/@kofi.b', undefined, { auth: false })).status === 200, 'look up a citizen by name');
ok((await call('DELETE', `/api/admin/citizens/${kofi.id}`)).status === 200, 'remove a citizen');
const founder = world.citizens.find(c => c.founder);
ok((await call('DELETE', `/api/admin/citizens/${founder.id}`)).status === 400, 'the founder cannot be removed');

console.log('Instagram webhook');
const secret = process.env.IG_APP_SECRET, verify = process.env.IG_VERIFY_TOKEN;
r = await call('GET', `/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verify)}&hub.challenge=12345`, undefined, { auth: false });
ok(r.status === 200 && String(r.json) === '12345', 'Meta verification handshake');
ok((await call('GET', '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1', undefined, { auth: false })).status === 403, 'wrong verify token refused');
const comment = (id, username, text, media = 'post-1') => JSON.stringify({ object: 'instagram', entry: [{ id: 'me', time: Date.now(), changes: [{ field: 'comments', value: { id, text, from: { id: 'u-' + username, username }, media: { id: media } } }] }] });
const sign = body => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
let body = comment('c1', 'zara_ng', 'SPAWN me please! 🙏');
ok((await call('POST', '/webhooks/instagram', undefined, { auth: false, raw: body, headers: { 'x-hub-signature-256': sign('tampered') } })).status === 401, 'unsigned/forged webhook refused');
ok((await call('POST', '/webhooks/instagram', undefined, { auth: false, raw: body, headers: { 'x-hub-signature-256': sign(body) } })).status === 200, 'signed comment accepted');
ok(await waitFor(sawOp(o => o.op === 'citizen' && o.data.handle === 'zara_ng')), 'commenting "spawn" moves them in, live');
await call('POST', '/webhooks/instagram', undefined, { auth: false, raw: body, headers: { 'x-hub-signature-256': sign(body) } });
body = comment('c2', 'tunde', 'love this city');
await call('POST', '/webhooks/instagram', undefined, { auth: false, raw: body, headers: { 'x-hub-signature-256': sign(body) } });
await new Promise(r => setTimeout(r, 300));
world = (await call('GET', '/api/world', undefined, { auth: false })).json;
ok(world.citizens.filter(c => c.handle === 'zara_ng').length === 1, 'a re-sent comment does not spawn twice');
ok(!world.citizens.some(c => c.handle === 'tunde'), 'a comment without "spawn" does not spawn');
ok((await call('PUT', '/api/admin/build-post', { mediaId: 'vote-post' })).status === 200, 'mark the build-vote post');
body = comment('c3', 'tunde', 'Build a football pitch!', 'vote-post');
await call('POST', '/webhooks/instagram', undefined, { auth: false, raw: body, headers: { 'x-hub-signature-256': sign(body) } });
await new Promise(r => setTimeout(r, 300));
r = await call('GET', '/api/admin/requests');
ok(r.status === 200 && r.json.some(c => c.username === 'tunde' && c.text.includes('football')), 'build requests are collected', JSON.stringify(r.json));

console.log('Clock (runs with nobody watching)');
ok((await call('GET', '/api/cron/tick?key=wrong', undefined, { auth: false })).status === 401, 'cron ping needs its key');
r = await call('GET', `/api/cron/tick?key=${encodeURIComponent(process.env.CRON_KEY)}`, undefined, { auth: false });
ok(r.status === 200 && r.json.ok, 'cron ping works', JSON.stringify(r.json));

ws.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
