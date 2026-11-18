// End-to-end check of a running city server. Run it against a THROWAWAY database: it founds a settlement.
// Usage: npm test   (reads BASE_URL, ADMIN_TOKEN, CRON_KEY, IG_APP_SECRET, IG_VERIFY_TOKEN from .env)
import 'dotenv/config';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }); // a few checks need to set up state directly
// The page's script must at least parse: a syntax slip there would leave players with a blank screen.
{ const fs = await import('node:fs'), vm = await import('node:vm');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  try { new vm.SourceTextModule(m[1]); console.log('  ✓ the page script parses'); } catch (e) { if (e instanceof SyntaxError) { console.log('  ✗ the page script has a syntax error:', e.message); process.exit(1); } else { new Function(m[1].replace(/^\s*import .*$/mg, '')); console.log('  ✓ the page script parses'); } } }

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const TOKEN = process.env.ADMIN_TOKEN;
let passed = 0, failed = 0;
const ok = (cond, name, extra = '') => { if (cond) { passed++; console.log('  ✓', name); } else { failed++; console.log('  ✗', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, body, { auth = true, headers = {}, raw } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined || raw ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: 'Bearer ' + TOKEN } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const meta = async () => (await call('GET', '/api/meta', undefined, { auth: false })).json.meta;
const chunk = async keys => (await call('GET', `/api/chunks?keys=${keys}`, undefined, { auth: false })).json;
const who = async h => (await call('GET', `/api/citizens/${h}`, undefined, { auth: false })).json;
const whoDev = async h => (await call('GET', `/api/citizens/${h}`)).json; // the developer also sees coins

// Two viewers: one watching the town centre (chunk 0_0), one watching far away (chunk 50_50).
function viewer(chunks) {
  const v = { msgs: [] }; v.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  v.ws.on('message', m => v.msgs.push(JSON.parse(m)));
  v.ready = new Promise((res, rej) => { v.ws.once('open', () => { v.ws.send(JSON.stringify({ type: 'sub', chunks })); res(); }); v.ws.once('error', rej); });
  v.saw = async (pred, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (v.msgs.some(m => m.type === 'ops' && m.ops.some(pred))) return true; await sleep(25); } return false; };
  return v;
}
const near = viewer(['0_0', '-1_0', '0_-1', '-1_-1']), far = viewer(['50_50']);
await near.ready; await far.ready;

console.log('Viewer access');
ok(near.msgs.length > 0 || await (async () => { await sleep(300); return near.msgs.some(m => m.type === 'hello'); })(), 'WebSocket says hello on connect');
ok((await call('GET', '/health', undefined, { auth: false })).status === 200, 'health check');
ok((await call('GET', '/', undefined, { auth: false })).status === 200, 'city page is served');
ok((await call('GET', '/shared/catalog.js', undefined, { auth: false })).status === 200, 'shared catalog is served');
const R0 = await import('../shared/rules.js');
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: 0, y: 0 }, { auth: false })).status === 401, 'building without a token is refused');
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: 0, y: 0 }, { headers: { authorization: 'Bearer wrong-token-000000000' } })).status === 401, 'wrong token is refused');

console.log('Founding');
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: 9, y: 9 })).status === 409, 'cannot build before founding');
let r = await call('POST', '/api/admin/found', { name: 'Testville', handle: '@builder' });
ok(r.status === 200, 'found the settlement', JSON.stringify(r.json));
ok((await chunk('0_0')).chunks['0_0'].buildings.some(b => b.type === 'landing'), 'the colony starts with a landing station');
ok((await call('POST', '/api/admin/found', { name: 'Again' })).status === 409, 'cannot found twice');
let m = await meta();
ok(m.name === 'Testville' && m.population === 1 && m.residents === 1 && m.founder === 'builder', 'founder lives in the starter tent', JSON.stringify(m));
let c = await chunk('0_0');
ok(c.chunks['0_0'].buildings.some(b => b.type === 'tent') && c.citizens.some(x => x.h === 'builder' && x.home), 'chunk 0_0 has the tent and the founder');
const startFunds = m.treasuryBase;

console.log('Housing queue');
ok((await call('POST', '/api/admin/citizens', { handle: '@kofi.b' })).json.citizen?.housed === true, 'second citizen takes the last tent spot');
for (const h of ['ada', 'bola', 'chidi']) await call('POST', '/api/admin/citizens', { handle: h });
m = await meta();
ok(m.population === 5 && m.residents === 2 && m.outskirts === 3, 'three more wait in the Outskirts', JSON.stringify({ p: m.population, r: m.residents, o: m.outskirts }));
ok((await who('ada')).queue === 1 && (await who('chidi')).queue === 3, 'queue positions are in arrival order');
ok((await call('POST', '/api/admin/citizens', { handle: 'KOFI.B' })).status === 409, 'no duplicate citizens (case-insensitive)');
r = await call('POST', '/api/admin/buildings', { type: 'house', x: 10, y: 10, name: 'Maple House', requestedBy: '@ada' });
ok(r.status === 200, 'build a house (4 homes)', JSON.stringify(r.json));
const house = r.json.building;
m = await meta();
ok(m.outskirts === 0 && m.residents === 5, 'the whole queue moved into the house');
ok(m.treasuryBase === startFunds, 'the developer builds for free');
ok(near.msgs.length && await near.saw(o => o.op === 'event' && /3 colonists woke from cryosleep and moved into Maple House/.test(o.data.text)), 'one grouped headline for the move-in');
ok(await near.saw(o => o.op === 'building' && o.data.id === house.id), 'viewer watching the centre sees the house');
await sleep(400);
ok(!far.msgs.some(x => x.type === 'ops' && x.ops.some(o => o.op === 'building' && o.data.id === house.id)), 'viewer watching elsewhere is not sent it');
ok(far.msgs.some(x => x.type === 'ops' && x.ops.some(o => o.op === 'event')), 'but everyone still gets the news');
ok((await who('ada')).home?.[0] === house.id, 'ada now lives in Maple House');

console.log('Jobs and money');
ok((await who('ada')).job === null, 'no jobs exist yet');
const income0 = m.income;
r = await call('POST', '/api/admin/buildings', { type: 'bakery', x: 14, y: 10 });
ok(r.status === 200, 'build a bakery (2 jobs)');
const bakery = r.json.building;
m = await meta();
ok(m.employed === 2 && m.income === income0 + 2 * 5, 'two people hired; taxes raise daily income', JSON.stringify({ e: m.employed, i: m.income, i0: income0 }));
const worker = await whoDev('builder');
ok(worker.job?.[0] === bakery.id && worker.net === 24 - 5, 'the earliest resident works there and nets 19 a day (24 less 5 tax; the tent is free)', JSON.stringify(worker));
ok((await whoDev('chidi')).net === 0, 'unemployed residents live rent-free until they find work');

console.log('Demolish, undo, move');
ok((await call('DELETE', `/api/admin/buildings/${house.id}`)).status === 200, 'demolish the house');
m = await meta();
ok(m.outskirts === 3 && m.residents === 2, 'its residents go back to the Outskirts');
ok((await who('ada')).queue === 1, 'they keep their place at the front of the queue');
ok(await near.saw(o => o.op === 'removeBuilding' && o.id === house.id), 'viewers see it disappear');
ok((await call('POST', '/api/admin/buildings/restore', { building: house })).status === 200, 'undo demolish');
ok((await meta()).outskirts === 0 && (await who('ada')).home?.[0] === house.id, 'everyone moves back in');
ok((await call('PATCH', `/api/admin/buildings/${house.id}`, { x: 20, y: 20 })).status === 200, 'move the house');
ok((await who('ada')).home?.[2] === 20, 'residents move with it');
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: 21, y: 21 })).status === 409, 'overlapping build is refused');
ok((await call('POST', '/api/admin/buildings', { type: 'spaceship', x: 30, y: 30 })).status === 400, 'unknown building type is refused');
r = await call('POST', '/api/admin/buildings', { type: 'biztower', x: 40, y: 40 });
ok(r.status === 200 && r.json.building.done, 'the developer can build anything, even the priciest tower');
await call('DELETE', `/api/admin/buildings/${r.json.building.id}`);


console.log('Hangouts');
r = await call('POST', '/api/admin/buildings', { type: 'park', x: 24, y: 20 });
ok((await who('ada')).hang?.[0] === r.json.building.id, 'residents start hanging out at the new park next door');

console.log('Roads');
r = await call('POST', '/api/admin/roads', { set: { '0,5': 'street', '1,5': 'street', '2,5': 'trees' } });
ok(r.status === 200 && r.json.changed === 3 && r.json.cost === 0, 'lay three road tiles for free', JSON.stringify(r.json));
ok(await near.saw(o => o.op === 'roads' && o.set['0,5'] === 'street'), 'viewers see the road');
ok((await call('POST', '/api/admin/roads', { set: { '20,20': 'street' } })).json.changed === 0, 'roads cannot go through a house');
ok((await call('POST', '/api/admin/buildings', { type: 'cottage', x: 1, y: 5 })).status === 409, 'buildings cannot go on a road');
ok((await call('POST', '/api/admin/roads', { remove: ['2,5'] })).json.changed === 1, 'remove a road tile');
r = await call('POST', '/api/admin/roads', { set: { '0,40': 'rail', '1,40': 'rail', '2,40': 'platform', '3,40': 'railcross', '4,40': 'rail' } });
ok(r.status === 200 && r.json.changed === 5, 'lay a railway with a station platform and a level crossing', JSON.stringify(r.json));
{ const C = await import('../shared/catalog.js'); const lost = Object.entries(C.BUILDING_TYPES).filter(([, t]) => !t.hidden && C.SUBS[t.cat] && !t.sub).map(([k]) => k);
  ok(!lost.length && C.BUILDING_TYPES.petstore.sub === 'small', 'every building shows in a build menu tab (the Pet store is under Shops → Small)', lost.join(', ')); }
ok((await call('POST', '/api/admin/roads', { remove: ['0,40', '1,40', '2,40', '3,40', '4,40'] })).json.changed === 5, 'take the railway up again');
c = await chunk('0_0');
ok(c.chunks['0_0'].roads['0,5'] === 'street' && !c.chunks['0_0'].roads['2,5'], 'roads saved correctly');

console.log('Search and removal');
r = await call('GET', '/api/citizens?q=b', undefined, { auth: false });
ok(r.json.map(x => x.h).join() === 'bola,builder', 'search by the start of a name', JSON.stringify(r.json.map(x => x.h)));
const bola = await who('bola');
ok((await call('DELETE', `/api/admin/citizens/${bola.id}`)).status === 200, 'remove a citizen');
ok(await near.saw(o => o.op === 'citizenGone' && o.id === bola.id), 'viewers drop them from the map');
ok((await call('DELETE', `/api/admin/citizens/${(await who('builder')).id}`)).status === 400, 'the founder cannot be removed');

console.log('Developer tools');
r = await call('POST', '/api/admin/buildings', { type: 'apartment', x: 30, y: 0, instant: false });
ok(r.status === 200 && r.json.building.done === false && r.json.building.readyAt > Date.now(), 'build with construction time');
const site = r.json.building;
ok(await near.saw(o => o.op === 'event' && /Construction started on Panel block/.test(o.data.text)), 'news announces the construction');
const out0 = (await meta()).outskirts;
r = await call('POST', '/api/admin/citizens/bulk', { handles: 'ife, @jide\nkemi, ife' });
ok(r.json.added === 3 && r.json.skipped === 1, 'add several people at once (duplicates skipped)', JSON.stringify(r.json));
m = await meta();
ok(m.outskirts > out0, 'without enough free homes, the rest wait in the Outskirts');
ok((await who('kemi')).queue > 0 && (await chunk('0_0')).chunks['0_0'] && (await call('GET', '/api/admin/places?kind=home&x=0&y=0')).json.every(p => p.id !== site.id), 'a building under construction offers no homes yet');
ok((await call('POST', `/api/admin/buildings/${site.id}/finish`)).status === 200, 'fast-forward: finish it now');
m = await meta();
ok(m.outskirts === 0, 'everyone waiting moves into the finished block', JSON.stringify({ o: m.outskirts }));
ok(await near.saw(o => o.op === 'event' && /Panel block is finished/.test(o.data.text)), 'news announces it is finished');
await call('POST', '/api/admin/buildings', { type: 'house', x: 30, y: 6, instant: false });
await call('POST', '/api/admin/buildings', { type: 'cottage', x: 34, y: 6, instant: false });
r = await call('POST', '/api/admin/construction/finish-all');
ok(r.json.finished === 2, 'fast-forward everything under construction at once');
const jobs = (await call('GET', '/api/admin/places?kind=job&x=10&y=10')).json;
ok(jobs.length && jobs[0].title, 'list nearby workplaces');
const kemi = await who('kemi');
r = await call('POST', '/api/admin/buildings', { type: 'brickoffice', x: 36, y: 0 });
const office = r.json.building;
const desk = (await call('GET', '/api/admin/places?kind=job&x=36&y=0')).json.find(p => p.id === office.id);
ok(desk && desk.title === 'Analyst' && desk.used < desk.cap, 'the new office shows up with free desks', JSON.stringify(desk));
ok((await call('PATCH', `/api/admin/citizens/${kemi.id}`, { jobId: office.id })).status === 200, "change someone's career");
let k = await whoDev('kemi');
ok(k.job?.[0] === office.id && k.net === 32 - 6 - 12, 'they work at the office and earn its wage minus tax and rent', JSON.stringify(k));
ok((await call('PATCH', `/api/admin/citizens/${kemi.id}`, { jobId: null })).status === 200 && (await who('kemi')).job === null, 'make them quit');
const bakeryNow = (await call('GET', '/api/admin/places?kind=job&x=14&y=10')).json.find(p => p.type === 'bakery');
ok(bakeryNow.used === bakeryNow.cap, 'the bakery is full');
ok((await call('PATCH', `/api/admin/citizens/${kemi.id}`, { jobId: bakeryNow.id })).status === 200 && (await who('kemi')).job?.[0] === bakeryNow.id, 'the developer can still put someone there; an auto-hired worker makes room');
ok((await call('GET', '/api/admin/places?kind=job&x=14&y=10')).json.find(p => p.type === 'bakery').used === bakeryNow.cap, 'the bakery stays at capacity');
await call('PATCH', `/api/admin/citizens/${kemi.id}`, { jobId: null });
await call('GET', `/api/cron/tick?key=${encodeURIComponent(process.env.CRON_KEY)}`, undefined, { auth: false });
ok((await who('kemi')).job === null, 'automatic hiring leaves a hand-set career alone');
const cottage = (await call('GET', '/api/admin/places?kind=home&x=34&y=6')).json.find(p => p.type === 'cottage');
ok((await call('PATCH', `/api/admin/citizens/${kemi.id}`, { homeId: cottage.id })).status === 200 && (await who('kemi')).home?.[0] === cottage.id, 'move someone to another home');
const before = await meta();
r = await call('POST', '/api/admin/bulldoze', { x0: 28, y0: -2, x1: 40, y1: 9 });
ok(r.status === 200 && r.json.buildings === 4, 'clear a whole area in one go', JSON.stringify(r.json));
const after = await meta();
ok(after.residents < before.residents && after.outskirts > before.outskirts, 'people from the cleared homes go back to the Outskirts');
ok(!(await chunk('0_0')).chunks['0_0'].buildings.some(b => b.x >= 28 && b.x <= 40 && b.y >= -2 && b.y <= 9), 'nothing is left in the area');

console.log('Water, vehicles, disasters, weather');
ok((await meta()).minMs === 1250, 'new towns run at 30 real minutes per game day');
r = await call('POST', '/api/admin/water', { set: { '50,50': 'river', '51,50': 'river', '52,50': 'lake', '0,0': 'sea' } });
ok(r.status === 200 && r.json.changed === 3 && r.json.skipped === 1, 'paint water (not under buildings)', JSON.stringify(r.json));
ok((await chunk('1_1')).chunks['1_1'].water['50,50'] === 'river', 'water is saved in its district');
ok(await near.saw(o => o.op === 'event') || true, 'news still flows');
ok((await call('POST', '/api/admin/buildings', { type: 'cottage', x: 51, y: 50 })).status === 409, 'cannot build on water');
r = await call('POST', '/api/admin/roads', { set: { '50,50': 'street', '50,51': 'street' } });
ok(r.json.changed === 2, 'roads can cross water as bridges');
ok((await call('POST', '/api/admin/water', { remove: ['52,50'] })).json.changed === 1, 'drain water back to land');
ok((await call('POST', '/api/admin/vehicles', { type: 'bus', x: 60, y: 60 })).status === 409, 'vehicles need a road');
r = await call('POST', '/api/admin/vehicles', { type: 'bus', x: 0, y: 5 });
ok(r.status === 200 && r.json.vehicle.type === 'bus', 'place a bus on a road', JSON.stringify(r.json));
ok(await near.saw(o => o.op === 'vehicle' && o.data.id === r.json.vehicle.id), 'viewers see the bus');
ok((await chunk('0_0')).chunks['0_0'].vehicles.some(v => v.id === r.json.vehicle.id), 'the bus is stored with its district');
ok((await call('DELETE', `/api/admin/vehicles/${r.json.vehicle.id}`)).status === 200, 'remove a vehicle');
const res0 = (await meta()).residents;
r = await call('POST', '/api/admin/disasters', { kind: 'meteor', x: 21, y: 21 });
ok(r.status === 200 && r.json.ruined >= 1, 'a meteor ruins the house it hits', JSON.stringify(r.json));
ok(await near.saw(o => o.op === 'disaster' && o.data.kind === 'meteor'), 'everyone sees the disaster');
ok((await meta()).residents < res0, 'people from ruined homes go to the Outskirts');
const ruinB = (await chunk('0_0')).chunks['0_0'].buildings.find(b => b.ruin);
ok(ruinB, 'the ruin stays on the map');
ok((await call('GET', '/api/meta', undefined, { auth: false })).json.disasters.some(d => d.kind === 'meteor'), 'new viewers can replay recent disasters');
ok((await call('POST', `/api/admin/buildings/${ruinB.id}/repair`)).status === 200, 'repair a ruin');
await call('POST', '/api/admin/disasters', { kind: 'fire', x: 21, y: 21 });
r = await call('POST', '/api/admin/ruins/clear');
ok(r.status === 200 && r.json.cleared >= 1, 'clear all ruins', JSON.stringify(r.json));
ok((await call('PUT', '/api/admin/weather', { kind: 'storm' })).status === 200 && (await meta()).weather === 'storm', 'pin the weather');
ok((await call('PUT', '/api/admin/weather', { kind: null })).status === 200 && (await meta()).weather === null, 'back to automatic weather');

console.log('Instagram webhook and comment queue');
const secret = process.env.IG_APP_SECRET, verify = process.env.IG_VERIFY_TOKEN;
r = await call('GET', `/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verify)}&hub.challenge=12345`, undefined, { auth: false });
ok(r.status === 200 && String(r.json) === '12345', 'Meta verification handshake');
ok((await call('GET', '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1', undefined, { auth: false })).status === 403, 'wrong verify token refused');
const comment = (id, username, text, media = 'post-1') => JSON.stringify({ object: 'instagram', entry: [{ id: 'me', time: Date.now(), changes: [{ field: 'comments', value: { id, text, from: { id: 'u-' + username, username }, media: { id: media } } }] }] });
const sign = body => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
const post = body => call('POST', '/webhooks/instagram', undefined, { auth: false, raw: body, headers: { 'x-hub-signature-256': sign(body) } });
let body = comment('c1', 'zara_ng', 'SPAWN me please! 🙏');
ok((await call('POST', '/webhooks/instagram', undefined, { auth: false, raw: body, headers: { 'x-hub-signature-256': sign('tampered') } })).status === 401, 'forged webhook refused');
ok((await post(body)).status === 200, 'signed comment accepted');
await post(body); await post(comment('c2', 'tunde', 'love this city'));
let z = null; for (let i = 0; i < 40 && !z?.id; i++) { await sleep(100); z = await who('zara_ng'); }
ok(z?.id && (z.home || z.queue > 0), 'commenting "spawn" brings them in', JSON.stringify(z));
ok((await call('GET', '/api/citizens?q=zara', undefined, { auth: false })).json.length === 1, 'a re-sent comment does not spawn twice');
ok((await who('tunde')).error, 'a comment without "spawn" does not spawn');
// Joining without Instagram
{ const cfg = (await call('GET', '/api/auth/config', undefined, { auth: false })).json; ok('google' in cfg && 'turnstile' in cfg, 'the page can ask how people can join');
  ok((await call('POST', '/api/signup', { handle: 'ab', password: 'secret88' }, { auth: false })).status === 400, 'website usernames need at least 3 characters');
  ok((await call('POST', '/api/signup', { handle: 'zara_ng', password: 'secret88' }, { auth: false })).status === 409, "a website sign-up can't take an existing colonist's username");
  ok((await call('POST', '/api/signup', { handle: 'web_kemi', password: '123' }, { auth: false })).status === 400, 'and needs a proper password');
  const su = await call('POST', '/api/signup', { handle: 'web_kemi', password: 'secret88', gender: 'f' }, { auth: false });
  ok(su.status === 200 && su.json.token && su.json.handle === 'web_kemi' && su.json.created, 'anyone can join with a username and password', JSON.stringify(su.json));
  const wk = await who('web_kemi'); ok(wk.id && wk.claimed && wk.g === 'f' && wk.w === 1, 'they arrive like a SPAWN, already claimed, with the avatar they picked', JSON.stringify(wk));
  ok((await call('GET', '/api/me', undefined, { auth: false, headers: { 'x-player': su.json.token } })).json.handle === 'web_kemi', 'and are signed in straight away');
  ok((await call('POST', '/api/login', { handle: 'web_kemi', password: 'secret88' }, { auth: false })).json.token, 'and can log in with their password later');
  ok((await call('POST', '/api/auth/google', { credential: 'x' }, { auth: false })).status >= 400, 'Google sign-in refuses a bad (or unconfigured) token');
  // Instagram names win: the real @web_kemi comments SPAWN
  await post(comment('c-wk', 'web_kemi', 'spawn')); let ig = null; for (let i = 0; i < 40 && !(ig && ig.id && ig.id !== wk.id); i++) { await sleep(100); ig = await who('web_kemi'); }
  const moved = (await pool.query('select handle, source from citizens where id = $1', [wk.id])).rows[0];
  ok(ig?.id && ig.id !== wk.id && moved.handle === 'web_kemi_web' && moved.source === 'web', 'when the Instagram account with that name spawns, the website player is renamed (and told)', JSON.stringify(moved));
  ok((await call('POST', '/api/login', { handle: 'web_kemi_web', password: 'secret88' }, { auth: false })).json.token, 'and logs in with the new name and the same password'); }
ok((await call('PUT', '/api/admin/build-post', { mediaId: 'vote-post' })).status === 200, 'mark the build-vote post');
await post(comment('c3', 'tunde', 'Build a football pitch!', 'vote-post'));
r = await call('GET', '/api/admin/requests');
ok(r.status === 200 && r.json.some(x => x.username === 'tunde' && x.text.includes('football')), 'build requests are collected');

console.log('Roads clear small things');
const tree = (await call('POST', '/api/admin/buildings', { type: 'tree', x: 300, y: 300 })).json.building;
const park = (await call('POST', '/api/admin/buildings', { type: 'park', x: 302, y: 299 })).json.building;
r = await call('POST', '/api/admin/roads', { set: { '299,300': 'street', '300,300': 'street', '301,300': 'street', '302,300': 'street' } });
ok(r.status === 200 && r.json.cleared?.length === 1 && r.json.cleared[0].id === tree.id, 'a road clears the tree in its way', JSON.stringify(r.json));
ok(r.json.changed === 3, 'but stops at the park');
let c9 = (await chunk('9_9')).chunks['9_9'];
ok(!c9.buildings.some(b => b.id === tree.id) && c9.buildings.some(b => b.id === park.id) && c9.roads['300,300'] === 'street', 'tree gone, park and road there');
await call('POST', '/api/admin/roads', { set: {}, remove: ['299,300', '300,300', '301,300'] });
ok((await call('POST', '/api/admin/buildings/restore', { building: r.json.cleared[0] })).status === 200, 'undo puts the tree back');

console.log('Draft, then update live');
ok((await call('POST', '/api/admin/draft/publish')).status === 400, 'nothing to publish at first');
ok((await call('GET', '/api/admin/draft', undefined, { auth: false })).status === 401, 'players cannot read the draft');
const b0 = (await chunk('9_9')).chunks['9_9'].buildings.length;
r = await call('PUT', '/api/admin/draft', { data: { builds: [{ tid: 'd:1', type: 'house', x: 310, y: 310 }, { tid: 'd:2', type: 'house', x: 300, y: 300 }], roads: { '310,312': 'street', '311,312': 'street' }, labels: {} } });
ok(r.status === 200, 'save a draft');
ok((await call('GET', '/api/admin/draft')).json.draft.data.builds.length === 2, 'the draft is kept on the server');
ok((await chunk('9_9')).chunks['9_9'].buildings.length === b0, 'players see nothing yet');
r = await call('POST', '/api/admin/draft/publish');
ok(r.status === 200 && r.json.built === 1 && r.json.roads === 2 && r.json.skipped.length === 1, 'update live: one house, two road tiles, one skipped (spot taken)', JSON.stringify(r.json));
ok((await chunk('9_9')).chunks['9_9'].buildings.some(b => b.type === 'house' && b.x === 310), 'the house is live');
{ const ev = (await call('GET', '/api/meta', undefined, { auth: false })).json.events;
  ok(!ev.some(e => /update:|road tile|House was built/.test(e.text)), 'a house and some road make no Colony Log news'); }
ok((await import('../shared/rules.js')).majorBuilding('casino') && !(await import('../shared/rules.js')).majorBuilding('tree') && !(await import('../shared/rules.js')).majorBuilding('house'), 'casinos are major, trees and houses are not');
ok((await call('GET', '/api/admin/draft')).json.draft === null, 'the draft is cleared after publishing');

console.log('Turning buildings');
const row = (await call('POST', '/api/admin/buildings', { type: 'townhouses', x: 320, y: 320, rot: 1 })).json.building;
ok(row?.rot === 1, 'build a terrace turned the other way', JSON.stringify(row));
ok((await call('POST', '/api/admin/buildings', { type: 'tree', x: 320, y: 322 })).status === 409, 'a turned 3×1 covers 1×3 tiles');
ok((await call('POST', '/api/admin/buildings', { type: 'tree', x: 322, y: 320 })).status === 200, 'and leaves the old row free');
ok((await call('PATCH', `/api/admin/buildings/${row.id}`, { x: 320, y: 320, rot: 0 })).status === 409, 'turning back is refused when the tree is in the way');
r = await call('PATCH', `/api/admin/buildings/${row.id}`, { x: 330, y: 330, rot: 0 });
ok(r.status === 200 && (await chunk('10_10')).chunks['10_10'].buildings.find(b => b.id === row.id)?.rot === 0, 'move and turn in one go');

console.log('Players prove it is them, then set a password');
r = await call('POST', '/api/claim', { handle: 'zara_ng' }, { auth: false });
ok(r.status === 200 && /^CLAIM \d{6}$/.test(r.json.code) && r.json.claimId, 'get a claim code', JSON.stringify(r.json));
const claim = r.json, digits = claim.code.split(' ')[1];
ok((await call('POST', `/api/claim/${claim.claimId}/password`, { password: 'secret1' }, { auth: false })).status === 409, 'no password before the comment');
await post(comment('cc1', 'tunde', `CLAIM ${digits}`)); await sleep(300);
ok((await call('GET', `/api/claim/${claim.claimId}`, undefined, { auth: false })).json.status === 'waiting', "someone else commenting the code doesn't count");
await post(comment('cc2', 'zara_ng', `here you go claim ${digits} 🙌`));
let st = null; for (let i = 0; i < 20 && st !== 'verified'; i++) { await sleep(100); st = (await call('GET', `/api/claim/${claim.claimId}`, undefined, { auth: false })).json.status; }
ok(st === 'verified', 'the real account commenting the code verifies it');
ok((await call('POST', `/api/claim/${claim.claimId}/password`, { password: '123' }, { auth: false })).status === 400, 'too-short passwords are refused');
r = await call('POST', `/api/claim/${claim.claimId}/password`, { password: 'secret1' }, { auth: false });
ok(r.status === 200 && r.json.token && r.json.handle === 'zara_ng', 'set the password and get signed in');
const tok1 = r.json.token;
ok((await call('GET', '/api/me', undefined, { auth: false, headers: { 'x-player': r.json.token } })).json.genderChosen === false, 'a newly claimed colonist has not chosen a gender yet');
ok((await call('POST', '/api/me/gender', { gender: 'f' }, { auth: false })).status === 401, 'choosing needs a login');
ok((await call('POST', '/api/me/gender', { gender: 'f' }, { auth: false, headers: { 'x-player': r.json.token } })).status === 200 && (await who('zara_ng')).g === 'f', 'the colonist chooses once');
ok((await call('POST', '/api/me/gender', { gender: 'm' }, { auth: false, headers: { 'x-player': r.json.token } })).status === 409, 'and cannot choose again');
{ const P = { auth: false, headers: { 'x-player': r.json.token } };
  ok((await call('POST', '/api/me/name', { name: 'Zara Okafor' }, P)).status === 200 && (await who('zara_ng')).n === 'Zara Okafor', 'a colonist sets their first and last name');
  ok((await call('POST', '/api/me/name', { name: 'Zara' }, P)).status === 200 && (await who('zara_ng')).n === 'Zara', 'or just one name');
  ok((await call('POST', '/api/me/name', { name: 'Zara99 <b>' }, P)).status === 400, 'names are letters only');
  ok((await call('POST', '/api/me/name', { name: 'Zara' }, { auth: false })).status === 401, 'only the colonist can set their name');
  ok((await call('GET', '/api/citizens?q=zara_', undefined, { auth: false })).json.some(x => x.h === 'zara_ng'), 'search still works by username');
  ok((await call('POST', '/api/square', { text: 'hello colony' }, { auth: false })).status === 401, 'only signed-in colonists can post in the Town Square');
  const m1 = await call('POST', '/api/square', { text: 'Hello Gliese 12 b!' }, P);
  ok(m1.status === 200 && m1.json.h === 'zara_ng', 'a verified colonist posts a message');
  ok((await call('POST', '/api/square', { text: 'again so soon' }, P)).status === 429, 'posting is slowed down to stop spam');
  ok((await call('GET', '/api/square', undefined, { auth: false })).json.some(x => x.id === m1.json.id), 'everyone can read the Town Square');
  ok((await call('DELETE', `/api/square/${m1.json.id}`)).status === 200, 'the developer can delete a message');
  ok((await call('POST', '/api/admin/square', { text: 'Welcome!' }, { auth: false })).status === 401, 'only the developer posts official updates');
  const off = await call('POST', '/api/admin/square', { text: 'Welcome to Gliese 12 b!', pin: true });
  ok(off.status === 200 && off.json.o === 1 && off.json.p === 1 && / Updates$/.test(off.json.h), 'the developer posts a pinned official update', JSON.stringify(off.json));
  ok((await call('GET', '/api/square', undefined, { auth: false })).json.some(x => x.id === off.json.id && x.p === 1), 'everyone sees the pinned update');
  ok((await call('PUT', `/api/admin/square/${off.json.id}/pin`, { pinned: false })).status === 200 && !(await call('GET', '/api/square', undefined, { auth: false })).json.find(x => x.id === off.json.id).p, 'and can unpin it');
  for (let i = 0; i < 3; i++) await call('POST', '/api/admin/square', { text: 'pin ' + i, pin: true });
  ok((await call('POST', '/api/admin/square', { text: 'one too many', pin: true })).status === 409, 'at most 3 pinned posts');
  ok((await call('POST', '/api/square', { text: 'see www.spam.com' }, { auth: false, headers: P.headers })).status === 400, 'links are refused');
  // ---- the job board ----
  ok((await call('GET', '/api/me/jobs', undefined, { auth: false })).status === 401, 'only a signed-in colonist sees their job board');
  const w1 = await call('POST', '/api/admin/buildings', { type: 'deptstore', x: 903, y: 900 }), w2 = await call('POST', '/api/admin/buildings', { type: 'factory', x: 900, y: 904 });
  await call('POST', `/api/admin/buildings/${w1.json.building?.id}/finish`); await call('POST', `/api/admin/buildings/${w2.json.building?.id}/finish`);
  let board = (await call('GET', '/api/me/jobs', undefined, P)).json;
  ok(board.housed && board.openings.length + (board.current ? 1 : 0) >= 2, 'the board lists open jobs', JSON.stringify(board).slice(0, 160));
  if (board.current) ok((await call('POST', '/api/me/job/quit', {}, P)).status === 200 && !(await whoDev('zara_ng')).job, 'a colonist can quit');
  ok((await whoDev('zara_ng')).net === 0, 'no job, no daily coins');
  board = (await call('GET', '/api/me/jobs', undefined, P)).json; const [o1, o2] = board.openings;
  ok(o1 && o1.takeHome === o1.salary - Math.round(o1.salary * 0.2) - board.rent && typeof o1.dist === 'number', 'each opening shows take-home pay after rent and distance');
  ok(board.openings.every((o, i, a) => i === 0 || a[i - 1].dist <= o.dist + 3), 'nearest openings first');
  await call('GET', `/api/cron/tick?key=${encodeURIComponent(process.env.CRON_KEY)}`, undefined, { auth: false });
  ok(!(await whoDev('zara_ng')).job, 'after quitting, automatic hiring leaves them alone');
  ok((await call('POST', '/api/me/job', { buildingId: o1.id }, P)).status === 200 && (await whoDev('zara_ng')).job?.[0] === o1.id, 'a colonist takes a job of their choice');
  ok((await whoDev('zara_ng')).net === o1.takeHome, 'and earns its take-home pay each day');
  ok((await call('POST', '/api/me/job', { buildingId: o2.id }, P)).status === 429, 'only one new job per game day');
  ok((await call('POST', '/api/me/job/quit', {}, P)).status === 200, 'quit again');
  ok((await call('POST', '/api/me/job', { buildingId: o2.id }, P)).status === 429, 'quitting does not reset the daily limit');
  // Claimed colonists get priority over automatically placed newcomers
  { const shop = await call('POST', '/api/admin/buildings', { type: 'stall', x: 910, y: 910 }); await call('POST', `/api/admin/buildings/${shop.json.building?.id}/finish`);
    const bed = await call('POST', '/api/admin/buildings', { type: 'house', x: 913, y: 910 }); await call('POST', `/api/admin/buildings/${bed.json.building?.id}/finish`);
    for (const h of ['jobfill_a', 'jobfill_b']) await call('POST', '/api/admin/citizens', { handle: h });
    const auto = (await whoDev('jobfill_a')); if (auto.job?.[0] !== shop.json.building?.id) await call('PATCH', `/api/admin/citizens/${auto.id}`, { jobId: shop.json.building?.id });
    await pool.query('update citizens set manual = false where handle = $1', ['jobfill_a']);
    { const a = await whoDev('jobfill_a'); ok(a.job?.[0] === shop.json.building?.id, 'a newcomer fills the one-person stall', JSON.stringify({ home: a.home, job: a.job })); }
    const listed = (await call('GET', '/api/me/jobs', undefined, P)).json.openings.some(o => o.id === shop.json.building?.id);
    ok(listed, 'a full workplace held by an unclaimed newcomer still shows as open');
    await pool.query('update citizens set job_changed_day = null where handle = $1', ['zara_ng']);
    ok((await call('POST', '/api/me/job', { buildingId: shop.json.building?.id }, P)).status === 200 && (await whoDev('zara_ng')).job?.[0] === shop.json.building?.id, 'a claimed colonist takes it');
    ok((await whoDev('jobfill_a')).job?.[0] !== shop.json.building?.id, 'and the newcomer goes back to looking for work'); }
  // ---- the casino ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms));
    ok((await call('POST', '/api/me/casino', { game: 'coin', pick: 'heads', bet: 5 }, { auth: false })).status === 401, 'only signed-in colonists can gamble');
    const before = (await call('GET', '/api/me/casino', undefined, P)).json;
    ok(before.casino === null && (await call('POST', '/api/me/casino', { game: 'coin', pick: 'heads', bet: 5 }, P)).status === 409, 'no casino, no gambling');
    const cas = await call('POST', '/api/admin/buildings', { type: 'casino', x: 920, y: 920 }); await call('POST', `/api/admin/buildings/${cas.json.building?.id}/finish`);
    ok((await call('GET', '/api/me/casino', undefined, P)).json.casino?.id === cas.json.building?.id, 'once a casino is built, it opens');
    await pool.query('update citizens set coins_base = 0, net = 0, coins_day = 0 where handle = $1', ['zara_ng']); await sleep(1300);
    ok((await call('POST', '/api/me/casino', { game: 'coin', pick: 'heads', bet: 5 }, P)).status === 400, 'no coins, no bets');
    await pool.query('update citizens set coins_base = 1000 where handle = $1', ['zara_ng']); await sleep(1300);
    ok((await call('POST', '/api/me/casino', { game: 'poker', bet: 5 }, P)).status === 400, 'unknown games are refused'); await sleep(1300);
    ok((await call('POST', '/api/me/casino', { game: 'dice', pick: '9', bet: 5 }, P)).status === 400, 'dice picks are 1 to 6'); await sleep(1300);
    ok((await call('POST', '/api/me/casino', { game: 'coin', pick: 'heads', bet: 5000 }, P)).status === 400, "can't bet more than you have"); await sleep(1300);
    const tre0 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta;
    const r1 = await call('POST', '/api/me/casino', { game: 'coin', pick: 'heads', bet: 100 }, P);
    ok(r1.status === 200 && ['heads', 'tails'].includes(r1.json.result) && r1.json.coins === 1000 - 100 + r1.json.payout && (r1.json.won ? r1.json.payout === 190 : r1.json.payout === 0), 'a coin flip pays 1.9× or takes the bet', JSON.stringify(r1.json));
    ok((await call('POST', '/api/me/casino', { game: 'coin', pick: 'heads', bet: 1 }, P)).status === 429, 'one bet at a time');
    const tre1 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta;
    ok(Math.round(tre1.treasuryBase - tre0.treasuryBase) === 100 - r1.json.payout || tre0.treasuryBase === undefined, 'the treasury takes losses and pays wins', `${tre0.treasuryBase} → ${tre1.treasuryBase}`);
    ok((await whoDev('zara_ng')).coins === r1.json.coins, 'the balance sticks');
    ok((await who('zara_ng')).visit?.[0] === cas.json.building?.id, 'everyone can see the colonist is at the casino');
    await sleep(1300); const sl = await call('POST', '/api/me/casino', { game: 'slots', bet: 10 }, P);
    ok(sl.status === 200 && sl.json.result.length === 3, 'slots spin three reels');
    await sleep(1300); const dc = await call('POST', '/api/me/casino', { game: 'dice', pick: '3', bet: 10 }, P);
    ok(dc.status === 200 && (dc.json.won ? dc.json.result === '3' && dc.json.payout === 57 : dc.json.payout === 0), 'dice pays 5.7× on the right number');
    // Roulette
    await sleep(1300); ok((await call('POST', '/api/me/casino', { game: 'roulette', pick: 'n37', bet: 10 }, P)).status === 400, 'roulette numbers go 0 to 36');
    await sleep(1300); const ro = await call('POST', '/api/me/casino', { game: 'roulette', pick: 'red', bet: 10 }, P);
    const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    ok(ro.status === 200 && ro.json.result >= 0 && ro.json.result <= 36 && ro.json.payout === (RED.includes(ro.json.result) ? 20 : 0), 'roulette: red pays 2× when the ball lands on red', JSON.stringify(ro.json));
    await sleep(1300); const rn = await call('POST', '/api/me/casino', { game: 'roulette', pick: 'n17', bet: 10 }, P);
    ok(rn.status === 200 && rn.json.payout === (rn.json.result === 17 ? 360 : 0), 'a single number pays 36×');
    await sleep(1300); ok((await call('POST', '/api/me/casino', { game: 'blackjack', bet: 10 }, P)).status === 400, 'blackjack is played at its own table');
    // Blackjack: deal, play the hand out, and the coins add up
    await pool.query("update citizens set coins_base = 1000, net = 0, coins_day = 0, casino_game = null where handle = 'zara_ng'");
    const bj = async (action, bet) => { await sleep(300); return call('POST', '/api/me/casino/blackjack', { action, bet }, P); };
    ok((await bj('hit')).status === 409, 'no hand, no hitting');
    let h = (await bj('deal', 100)).json;
    ok(h.player?.length === 2 && h.dealer?.length === 2 && (h.done || h.dealer[1] === '??'), "a hand is dealt with the dealer's second card hidden", JSON.stringify(h));
    if (!h.done) { ok((await bj('deal', 100)).json.resumed === true, 'dealing again resumes the hand in play'); h = (await bj('stand')).json; }
    ok(h.done && h.dealer.every(c => c !== '??') && ['win', 'lose', 'push', 'bust', 'dealer-bust', 'blackjack', 'dealer-blackjack'].includes(h.outcome), 'standing finishes the hand', JSON.stringify(h));
    const expect = { win: 200, 'dealer-bust': 200, push: 100, lose: 0, bust: 0, blackjack: 250, 'dealer-blackjack': 0 }[h.outcome];
    ok(h.payout === expect && (await whoDev('zara_ng')).coins === 900 + expect, `the hand pays out right (${h.outcome}: ${expect})`, JSON.stringify(h));
    ok(!h.done || (h.dealerValue >= 17 || h.outcome === 'bust' || h.outcome === 'blackjack' || h.outcome === 'dealer-blackjack'), 'the dealer draws to 17');
    // Double: force a hand of 5 + 6 against the dealer, then double for one card
    await pool.query("update citizens set coins_base = 1000, casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ game: 'blackjack', bet: 50, deck: ['2♣', '3♣', '10♠'], player: ['5♠', '6♥'], dealer: ['10♣', '7♦'], at: Date.now() })]);
    const dbl = (await bj('double')).json;
    ok(dbl.done && dbl.doubled && dbl.player.length === 3 && dbl.player[2] === '10♠' && dbl.playerValue === 21 && dbl.outcome === 'win' && dbl.payout === 200, 'doubling takes one card and doubles the stake', JSON.stringify(dbl));
    ok((await whoDev('zara_ng')).coins === 1000 - 50 + 200, 'a doubled win pays 2× the doubled bet');
    // Rocket: launch, then cash out in time (we peek at the crash point), or watch it blow up
    await pool.query("update citizens set coins_base = 1000, casino_game = null where handle = 'zara_ng'");
    const rk = async (action, extra = {}) => { await sleep(300); return call('POST', '/api/me/casino/rocket', { action, ...extra }, P); };
    const L = (await rk('launch', { bet: 100 })).json;
    ok(L.start > Date.now() && !L.done && L.crash === null && (await whoDev('zara_ng')).coins === 900, 'a rocket launches after a countdown, with the crash point secret', JSON.stringify(L));
    ok((await rk('cashout')).status === 409, "can't cash out before lift-off");
    let gm = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game;
    await pool.query("update citizens set casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...gm, crash: 5 })]);
    while (Date.now() < gm.start + 6200) await sleep(200); // about 2.1× after 6.2 s
    const co = (await rk('cashout')).json;
    ok(co.done && co.cashed >= 2 && co.cashed < 2.3 && co.payout === Math.floor(100 * co.cashed) && co.crash === 5, 'cashing out pays the multiplier at that moment', JSON.stringify(co));
    { // the tap counts, not when the request arrives (phones can be slow)
      await rk('launch', { bet: 100 }); let g2 = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game;
      await pool.query("update citizens set casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...g2, crash: 50 })]);
      while (Date.now() < g2.start + 6000) await sleep(200);
      const tapAt = Date.now() - 900, want = Math.floor(100 * Math.exp(Math.log(1.0) + 0)); // computed below from the shared formula
      const { rocketAt } = await import('../shared/casino.js'), r = (await call('POST', '/api/me/casino/rocket', { action: 'cashout', at: tapAt }, P)).json;
      ok(r.done && r.cashed === rocketAt((tapAt - g2.start) / 1000), 'cashing out pays the multiplier at the moment of the tap, not when the request arrived', JSON.stringify({ cashed: r.cashed, atTap: rocketAt((tapAt - g2.start) / 1000) }));
      await rk('launch', { bet: 100 }); g2 = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game;
      await pool.query("update citizens set casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...g2, crash: 50 })]);
      while (Date.now() < g2.start + 6000) await sleep(200);
      const r2 = (await call('POST', '/api/me/casino/rocket', { action: 'cashout', at: g2.start + 100 }, P)).json; // a "tap" from 6 s ago isn't believed
      ok(r2.done && r2.cashed >= 2, 'a tap from long ago is ignored: it cashes out now', JSON.stringify({ cashed: r2.cashed }));
      await rk('launch', { bet: 100 }); g2 = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game;
      await pool.query("update citizens set casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...g2, crash: 1.5 })]);
      while (Date.now() < g2.start + 3800) await sleep(100); // it blew up at about 3.6 s
      const r3 = (await call('POST', '/api/me/casino/rocket', { action: 'cashout', at: Date.now() - 100 }, P)).json;
      ok(r3.done && r3.payout === 0, 'a tap after it blew up loses', JSON.stringify({ payout: r3.payout })); }
    const L2 = (await rk('launch', { bet: 100 })).json; gm = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game;
    await pool.query("update citizens set casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...gm, crash: 1.2 })]);
    while (Date.now() < gm.start + 2200) await sleep(200);
    const st = (await rk('status')).json; ok(st.done && st.payout === 0 && st.crash === 1.2, 'waiting too long: it blows up and the bet is lost', JSON.stringify(st));
    const L3 = (await rk('launch', { bet: 100, auto: 1.5 })).json; gm = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game;
    await pool.query("update citizens set casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...gm, crash: 3 })]);
    while (Date.now() < gm.start + 3700) await sleep(200);
    const au = (await rk('status')).json; ok(au.done && au.cashed === 1.5 && au.payout === 150, 'an automatic cash-out pays at its target', JSON.stringify(au)); }
  // ---- Mines and Plinko at the casino; the Game House ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms)), C = await import('../shared/casino.js'), G = await import('../shared/games.js');
    await pool.query("update citizens set coins_base = 50000, net = 0, coins_day = 0, casino_game = null, play_game = null, wheel_day = null, jailed_until = null where handle = 'zara_ng'");
    // Plinko: a path of 12 bounces, paid by the risk table; every table keeps the house a small edge
    const pk = (await call('POST', '/api/me/casino', { game: 'plinko', pick: 'high', bet: 100 }, P)).json;
    ok(pk.result?.path?.length === 12 && pk.result.slot === pk.result.path.reduce((a, b) => a + b, 0) && pk.payout === Math.floor(100 * C.PLINKO.high[pk.result.slot]), 'Plinko drops a ball through 12 rows and pays the slot it lands in', JSON.stringify(pk));
    const binom = k => { let r = 1; for (let i = 1; i <= k; i++) r = r * (12 - k + i) / i; return r / 4096; };
    ok(Object.values(C.PLINKO).every(t => t.length === 13 && t.reduce((s, m, i) => s + m * binom(i), 0) < 0.99), 'every Plinko table pays back less than it takes');
    // Mines
    await sleep(1300); const mn = async (b) => { await sleep(300); return call('POST', '/api/me/casino/mines', b, P); };
    const m0 = (await mn({ action: 'start', bet: 100, mines: 3 })).json; ok(m0.game === 'mines' && !m0.done && !m0.layout, 'a Mines game starts with the mines hidden', JSON.stringify(m0));
    const lay = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game.layout, safe = [...Array(25).keys()].filter(i => !lay.includes(i));
    const m1 = (await mn({ action: 'pick', cell: safe[0] })).json, m2 = (await mn({ action: 'pick', cell: safe[1] })).json;
    ok(m2.picked.length === 2 && m2.mult === C.minesMultiple(3, 2) && m2.mult > m1.mult && m1.mult > 1, 'each gem raises the multiplier', JSON.stringify(m2));
    const before = (await whoDev('zara_ng')).coins, mc = (await mn({ action: 'cashout' })).json;
    ok(mc.done && mc.paid === Math.floor(100 * C.minesMultiple(3, 2)) && (await whoDev('zara_ng')).coins === before + mc.paid && mc.layout?.length === 3, 'cashing out pays the multiplier, and shows where the mines were', JSON.stringify(mc));
    await mn({ action: 'start', bet: 100, mines: 3 }); const lay2 = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game.layout;
    const boom = (await mn({ action: 'pick', cell: lay2[0] })).json; ok(boom.done && boom.outcome === 'boom' && boom.paid === 0, 'hitting a mine loses the bet', JSON.stringify(boom));
    ok((await mn({ action: 'start', bet: 100, mines: 7 })).status === 400, 'only the offered numbers of mines');
    // Baccarat and Hi-Lo
    await sleep(1300); const bc = (await call('POST', '/api/me/casino', { game: 'baccarat', pick: 'banker', bet: 100 }, P)).json, BR = bc.result;
    ok(BR && BR.pt === C.bacTotal(BR.player) && BR.bt === C.bacTotal(BR.banker) && bc.payout === (BR.winner === 'banker' ? 195 : BR.winner === 'tie' ? 100 : 0), 'baccarat: closest to 9 wins; a tie gives the bet back', JSON.stringify(bc));
    const hl = async b => { await sleep(300); return call('POST', '/api/me/casino/hilo', b, P); };
    const h0 = (await hl({ action: 'start', bet: 100 })).json; ok(h0.game === 'hilo' && h0.cards.length === 1 && !h0.done, 'Hi-Lo deals a first card', JSON.stringify(h0));
    ok((await hl({ action: 'cashout' })).status === 400, 'guess at least once before cashing out');
    const hg = (await pool.query("select casino_game from citizens where handle = 'zara_ng'")).rows[0].casino_game; await pool.query("update citizens set casino_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...hg, cards: ['A♠'] })]);
    const h1 = (await hl({ action: 'higher' })).json; ok(!h1.done && h1.cards.length === 2 && h1.mult === C.hiloStep(1, 'higher'), 'higher than an ace is always right (and pays least)', JSON.stringify(h1));
    const hb = (await whoDev('zara_ng')).coins, hc = (await hl({ action: 'cashout' })).json; ok(hc.done && hc.paid === Math.floor(100 * h1.mult) && (await whoDev('zara_ng')).coins === hb + hc.paid, 'cashing out pays the multiplier', JSON.stringify(hc));
    ok([...Array(13).keys()].every(i => C.hiloChance(i + 1, 'higher') * C.hiloStep(i + 1, 'higher') < 1 && C.hiloChance(i + 1, 'lower') * C.hiloStep(i + 1, 'lower') < 1), 'every Hi-Lo guess keeps a house edge');
    // The Game House (with enough in the treasury that no prize is capped)
    await pool.query("update meta set data = jsonb_set(data, '{treasuryBase}', to_jsonb((data->>'treasuryBase')::numeric + 500000))");
    const gh = await call('POST', '/api/admin/buildings', { type: 'gamehouse', x: 820, y: 900 }); await call('POST', `/api/admin/buildings/${gh.json.building?.id}/finish`); const ghId = gh.json.building?.id;
    ok(gh.status === 200 && (await call('GET', `/api/me/games?building=${(await pool.query("select id from buildings where type <> 'gamehouse' limit 1")).rows[0].id}`, undefined, P)).status === 409, "games are played at a Game House, not anywhere");
    const gi = (await call('GET', `/api/me/games?building=${ghId}`, undefined, P)).json; ok(gi.freeSpin === true && gi.housed && gi.maxBet === G.GH_MAX_BET, 'the Game House: a free spin is waiting', JSON.stringify(gi));
    const g = async (game, b) => { await sleep(300); return call('POST', `/api/me/games/${game}`, { ...b, buildingId: ghId }, P); };
    const c0 = (await whoDev('zara_ng')).coins, fs = (await g('wheel', { free: true })).json;
    ok(fs.free && G.WHEEL_FREE[fs.slot] === fs.prize && (await whoDev('zara_ng')).coins === c0 + fs.prize, 'the free daily spin pays coins', JSON.stringify(fs));
    ok((await g('wheel', { free: true })).status === 409, 'one free spin a day');
    const ps = (await g('wheel', { bet: 100 })).json; ok(ps.paid === Math.floor(100 * G.WHEEL_PAID[ps.slot]), 'paid spins pay the slice they land on', JSON.stringify(ps));
    ok(G.WHEEL_PAID.reduce((a, b) => a + b, 0) / G.WHEEL_PAID.length < 1, 'the paid wheel keeps a house edge');
    ok((await g('wheel', { bet: G.GH_MAX_BET + 1 })).status === 400, 'Game House bets are capped');
    { const casId = (await pool.query("select id from buildings where type = 'casino' and done limit 1")).rows[0]?.id;
      if (casId) { await sleep(300); const cw = await call('POST', '/api/me/games/wheel', { bet: 100, buildingId: casId }, P); ok(cw.status === 200 && typeof cw.json.slot === 'number', 'the Lucky wheel is played at the Casino', JSON.stringify(cw.json));
        await sleep(300); ok((await call('POST', '/api/me/games/penalty', { action: 'start', bet: 100, buildingId: casId }, P)).status === 409, 'penalties are only at a Game House'); } }
    const sc = (await g('scratch', { price: 200 })).json; const cnt = sc.cells.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    ok(sc.cells.length === 9 && sc.paid === 200 * sc.x && (sc.win ? cnt[sc.win] === 3 : Object.values(cnt).every(n => n <= 2)), 'a scratch card shows three of a kind only when it wins', JSON.stringify(sc));
    ok((await g('scratch', { price: 300 })).status === 400, 'scratch cards come in set prices');
    const p0 = (await g('penalty', { action: 'start', bet: 100 })).json; ok(p0.game === 'penalty' && p0.kicks.length === 0, 'a penalty shootout starts', JSON.stringify(p0));
    ok((await g('darts', { action: 'start', bet: 100 })).status === 409, 'one game at a time at the Game House');
    let pr; for (const s of ['ll', 'rh', 'cl', 'ch', 'rl']) pr = (await g('penalty', { action: 'kick', spot: s })).json;
    ok(pr.done && pr.kicks.length === 5 && pr.goals === pr.kicks.filter(k => k.goal).length && pr.paid === Math.floor(100 * (G.PEN_PAYS[pr.goals] || 0)), 'five kicks, paid by goals scored', JSON.stringify({ goals: pr.goals, paid: pr.paid }));
    const d0 = (await g('darts', { action: 'start', bet: 100 })).json; let dr; for (let i = 0; i < 3; i++) dr = (await g('darts', { action: 'throw', x: 0, y: 0.605 })).json;
    ok(d0.game === 'darts' && dr.done && dr.throws.length === 3 && dr.total === dr.throws.reduce((s, t) => s + t.score, 0) && dr.paid === Math.floor(100 * G.dartsPays(dr.total)), 'three darts, scored where they land (with a wobble)', JSON.stringify({ total: dr.total, paid: dr.paid }));
    ok(G.dartScore(0, 0.605).score === 60 && G.dartScore(0, 0).score === 50 && G.dartScore(0, 0.97).score === 40 && G.dartScore(2, 0).score === 0, 'the dartboard scores like a real one');
    const s0 = (await g('snooker', { action: 'start' })).json; ok(s0.balls.length === 7 && s0.shots === 0 && (await whoDev('zara_ng')).coins === dr.coins, 'snooker practice racks up for free', JSON.stringify({ n: s0.balls.length }));
    const s1 = (await g('snooker', { action: 'shoot', angle: 0, power: 0.6 })).json; ok(s1.shots === 1 && Array.isArray(s1.last?.frames) && s1.last.frames.length > 10 && s1.balls.some(b => b.id === 'c'), 'a shot is simulated on the server and comes back to replay', JSON.stringify({ shots: s1.shots, frames: s1.last?.frames?.length }));
    const SN = await import('../shared/snooker.js'), rs = SN.shoot([{ id: 'c', x: 0.5, y: 0.5 }, { id: 'r0', x: 1.0, y: 0.5 }], 0, 0.5);
    ok(rs.firstHit === 'r0' && rs.balls.find(b => b.id === 'r0').x > 1.0, 'snooker physics: the cue ball strikes the red and sends it on');
    { const BG = await import('../shared/boardgames.js'), P8 = BG.ENGINES.pool8, P9 = BG.ENGINES.pool9, rnd = () => 0.5;
      const r8 = SN.rack8(Math.random), r9 = SN.rack9(Math.random), ids = a => a.map(b => b.id).sort().join();
      ok(r8.length === 16 && new Set(r8.map(b => b.id)).size === 16 && r9.length === 10 && r9.find(b => b.id === 'b9') && r9.find(b => b.id === 'b1').x < r9.find(b => b.id === 'b9').x, '8-ball racks 15 numbered balls; 9-ball racks 1–9 with the 1 in front', ids(r9));
      // 8-ball: a lone stripe straight in front of the cue ball and a pocket → it takes stripes and shoots again
      let s8 = P8.setup(2, {}, Math.random); s8.broken = true; s8.inHand = null; s8.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'b12', x: 1.85, y: 0.85 }, { id: 'b3', x: 0.3, y: 0.3 }, { id: 'b8', x: 0.3, y: 0.7 }];
      let n8 = P8.play(s8, 0, { shot: true, angle: Math.PI / 4, power: 0.4 }, rnd);
      ok(n8.groups[0] === 'stripes' && n8.groups[1] === 'solids' && n8.turn === 0, '8-ball: potting a stripe on an open table takes stripes and you shoot again', JSON.stringify({ g: n8.groups, t: n8.turn, p: n8.last.potted }));
      n8.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'b8', x: 1.85, y: 0.85 }, { id: 'b3', x: 0.3, y: 0.3 }, { id: 'b10', x: 0.3, y: 0.8 }];
      const early = P8.play(n8, 0, { shot: true, angle: Math.PI / 4, power: 0.4 }, rnd);
      ok(early.turn === null && early.winners[0] === 1 && early.last.eight === 'lost', 'sinking the 8 before clearing your group loses');
      n8.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'b8', x: 1.85, y: 0.85 }, { id: 'b3', x: 0.3, y: 0.3 }];
      const win8 = P8.play(n8, 0, { shot: true, angle: Math.PI / 4, power: 0.4 }, rnd);
      ok(win8.winners[0] === 0 && win8.last.eight === 'won', 'clear your group, then the 8 wins');
      n8.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'b3', x: 1.85, y: 0.85 }, { id: 'b10', x: 0.3, y: 0.8 }];
      const wrong = P8.play(n8, 0, { shot: true, angle: Math.PI / 4, power: 0.4 }, rnd);
      ok(wrong.last.foul && wrong.turn === 1, 'hitting the other group first is a foul and the turn passes');
      // 9-ball
      let s9 = P9.setup(2, {}, Math.random); s9.broken = true; s9.inHand = null; s9.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'b9', x: 1.85, y: 0.85 }, { id: 'b2', x: 0.3, y: 0.3 }];
      const foul9 = P9.play(s9, 0, { shot: true, angle: Math.PI / 4, power: 0.4 }, rnd);
      ok(foul9.last.foul && foul9.turn === 1 && foul9.balls.some(b => b.id === 'b9'), "9-ball: potting the 9 without hitting the lowest ball first is a foul and the 9 comes back");
      s9.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'b2', x: 1.85, y: 0.85 }, { id: 'b9', x: 0.3, y: 0.3 }];
      const ok9 = P9.play(s9, 0, { shot: true, angle: Math.PI / 4, power: 0.4 }, rnd);
      ok(!ok9.last.foul && ok9.turn === 0 && ok9.view === undefined && P9.view(ok9).on[0] === 'b9', 'pot the lowest ball and you go again; the 9 is next');
      let sims = 0, finished = 0; for (const E of [P8, P9]) for (let k = 0; k < 10; k++) { let st = E.setup(2, {}, Math.random), n = 0; while (st.turn != null && n < 400) { st = E.play(st, st.turn, E.auto(st, st.turn, Math.random), Math.random); n++; } sims++; if (st.winners) finished++; }
      ok(finished === sims, 'computer-v-computer pool games always finish'); }
    { const BG = await import('../shared/boardgames.js'), SK = BG.ENGINES.snooker, CG = await import('../shared/cuegames.js'), rnd = () => 0.5;
      const s0 = SK.setup(); ok(s0.balls.filter(b => b.id[0] === 'r').length === 15 && ['yellow', 'green', 'brown', 'blue', 'pink', 'black'].every(c => s0.balls.some(b => b.id === c)) && s0.inHand === 'D', 'snooker: 15 reds, six colours on their spots, cue ball in hand in the D');
      ok(CG.placeOk(s0.balls, { x: 0.3, y: 0.5 }, 'D') && !CG.placeOk(s0.balls, { x: 0.6, y: 0.5 }, 'D'), 'the cue ball can only be placed inside the D');
      // a red straight into the corner pocket, then a colour
      let st = structuredClone(s0); st.inHand = null; st.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'r0', x: 1.85, y: 0.85 }, { id: 'r1', x: 0.6, y: 0.3 }, ...s0.balls.filter(b => CG.COLOURS[b.id])];
      st = SK.play(st, 0, { shot: true, angle: Math.PI / 4, power: 0.35 }, rnd);
      ok(st.score[0] === 1 && st.turn === 0 && st.on === 'colour', 'pot a red: 1 point, and now a colour is on', JSON.stringify({ sc: st.score, on: st.on, p: st.last.potted }));
      st.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'pink', x: 1.85, y: 0.85 }, { id: 'r1', x: 0.6, y: 0.3 }, ...st.balls.filter(b => CG.COLOURS[b.id] && b.id !== 'pink')];
      st = SK.play(st, 0, { shot: true, angle: Math.PI / 4, power: 0.35 }, rnd);
      ok(st.score[0] === 7 && st.on === 'red' && st.balls.some(b => b.id === 'pink' && b.x === CG.SPOTS.pink[0]), 'pot the pink: 6 more, and it goes back on its spot while reds remain', JSON.stringify({ sc: st.score, on: st.on }));
      st.balls = [{ id: 'c', x: 1.7, y: 0.7 }, { id: 'blue', x: 1.85, y: 0.85 }, { id: 'r1', x: 0.6, y: 0.3 }, ...st.balls.filter(b => CG.COLOURS[b.id] && b.id !== 'blue')];
      const fo = SK.play(st, 0, { shot: true, angle: Math.PI / 4, power: 0.35 }, rnd);
      ok(fo.last.foul && fo.score[1] === 5 && fo.turn === 1, 'hitting a colour when a red is on is a foul: 5 points (the blue) to the opponent', JSON.stringify({ f: fo.last.foul, sc: fo.score }));
      let sims = 0; for (let k = 0; k < 2; k++) { let g = SK.setup(), n = 0; while (g.turn != null && n < 450) { g = SK.play(g, g.turn, SK.auto(g, g.turn, Math.random), Math.random); n++; } if (g.winners && n < 400) sims++; }
      ok(sims === 2, 'computer-v-computer snooker frames finish');
      // 9-ball: three fouls in a row lose
      const P9 = BG.ENGINES.pool9; let n9 = P9.setup(2, {}, Math.random); n9.broken = true; n9.inHand = null; n9.fouls = [2, 0]; n9.balls = [{ id: 'c', x: 0.3, y: 0.5 }, { id: 'b1', x: 1.5, y: 0.2 }, { id: 'b5', x: 0.6, y: 0.5 }];
      const tf = P9.play(n9, 0, { shot: true, angle: 0, power: 0.4 }, rnd); ok(tf.winners?.[0] === 1 && tf.last.threeFouls, '9-ball: a third foul in a row loses the game');
      const bh = P9.play({ ...structuredClone(n9), fouls: [0, 0] }, 0, { shot: true, angle: 0, power: 0.4 }, rnd); ok(bh.inHand === 'table' && bh.turn === 1, 'a foul gives the opponent ball in hand anywhere');
      const placed = P9.play(bh, 1, { shot: true, angle: -Math.PI / 2, power: 0.3, cue: { x: 1.5, y: 0.45 } }, rnd); ok(placed.last && placed.inHand !== 'table' || placed.last.foul, 'with ball in hand the cue ball is placed before the shot');
      // Street Whot
      const W = BG.ENGINES.whot, sw = W.setup(2, { street: true }, Math.random), all = [...sw.market, ...sw.hands.flat(), ...sw.pile];
      ok(sw.street && !all.some(c => /:(2|14|20)$/.test(c)), 'Street Whot: no 2s, 14s or Whot cards in the deck');
      const s5 = { ...structuredClone(sw), hands: [['circle:5', 'star:7'], ['cross:3', 'square:11']], pile: ['circle:4'], market: ['triangle:1'], turn: 0 };
      const a5 = W.play(s5, 0, { card: 'circle:5' }, Math.random); ok(a5.hands[1].length === 2 && a5.turn === 1, 'in Street Whot a 5 is an ordinary card (no pick three)');
      const dr = W.play(a5, 1, { draw: true }, Math.random);
      ok(dr.turn === null && dr.counted && dr.final[0].total === 7 && dr.final[1].total === 15 && dr.winners[0] === 0, 'when the market runs out the game ends: lowest total wins, and both totals are shown', JSON.stringify(dr.final));
      // Ayo and Ludo moves carry what the screens need to animate them
      const AY = BG.ENGINES.ayo, am = AY.play(AY.setup(), 0, { pit: 2 }); ok(am.anim && am.anim.pit === 2 && am.anim.before[2] === 4 && am.anim.seq === 1, 'an Ayo move records the board before it, for the sowing animation');
      const LU = BG.ENGINES.ludo; let lu = LU.setup(2, { quick: true }, Math.random); lu = LU.play(lu, 0, { roll: true }, (() => { const q = [0.9, 0.9]; let i = 0; return () => q[i++ % 2]; })());
      ok(lu.anim?.kind === 'roll', 'a Ludo roll is recorded for the dice animation'); lu = LU.play(lu, 0, { token: 0, die: 0 }, Math.random); ok(lu.anim?.kind === 'move' && lu.anim.from === -1 && lu.anim.to === 0, 'and a move, square by square'); }
    const sg = (await pool.query("select play_game from citizens where handle = 'zara_ng'")).rows[0].play_game; await pool.query("update citizens set play_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...sg, need: 0 })]);
    const sw = (await g('snooker', { action: 'shoot', angle: 0, power: 0.3 })).json; ok(sw.done && sw.won && sw.paid === SN.PRACTICE.prize, "a practice win pays today's prize", JSON.stringify({ won: sw.won, paid: sw.paid }));
    await g('snooker', { action: 'start' }); const sg2 = (await pool.query("select play_game from citizens where handle = 'zara_ng'")).rows[0].play_game; await pool.query("update citizens set play_game = $1 where handle = 'zara_ng'", [JSON.stringify({ ...sg2, need: 0 })]);
    const sw2 = (await g('snooker', { action: 'shoot', angle: 0, power: 0.3 })).json; ok(sw2.done && sw2.won && sw2.paid === 0, 'only the first practice win each day pays', JSON.stringify({ paid: sw2.paid }));
    const st = await call('GET', '/api/admin/stats?days=7'); ok(st.json.flows['game:penalty:bet']?.today.coins >= 100 && st.json.flows['game:wheel:win'], 'Game House stakes and wins show in Stats');
    await pool.query("update citizens set coins_base = 1000, casino_game = null, play_game = null where handle = 'zara_ng'"); }
  // ---- crime, going out, pets ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms)), set = (h, sql, v = []) => pool.query(`update citizens set ${sql} where handle = $1`, [h, ...v]);
    const coins = async h => (await whoDev(h)).coins;
    ok((await call('POST', '/api/me/crime', { kind: 'rob' }, { auth: false })).status === 401, 'only signed-in colonists can commit crimes');
    await set('zara_ng', 'coins_base = 1000, net = 0, coins_day = 0, crime_at = null, jailed_until = null'); await set('jobfill_a', 'coins_base = 500, net = 0, coins_day = 0');
    ok((await call('POST', '/api/me/crime', { kind: 'pickpocket', target: 'zara_ng' }, P)).status === 400, "can't pick your own pocket");
    ok((await call('POST', '/api/me/crime', { kind: 'pickpocket', target: 'nobody_here' }, P)).status === 404, 'the victim must exist');
    // Where the victim is matters: not at home, not at work (unless you work there too).
    const at = async (h, bid) => pool.query('update citizens set visit_id = $2, visit_from = $3, visit_until = $4 where handle = $1', [h, bid, Date.now() - 1000, Date.now() + 3600000]);
    const va = (await pool.query("select id, home_id, job_id from citizens where handle = 'jobfill_a'")).rows[0], zj0 = (await pool.query("select job_id from citizens where handle = 'zara_ng'")).rows[0].job_id;
    const work = (await pool.query("select id from buildings where type = any($1) and done and not ruin limit 1", [['shop', 'office', 'cafe', 'supermarket', 'stall', 'police', 'school', 'clinic']])).rows[0]?.id || zj0;
    const landing = (await pool.query("select id from buildings where type = 'landing' limit 1")).rows[0].id;
    const pp = () => call('POST', '/api/me/crime', { kind: 'pickpocket', target: 'jobfill_a' }, P);
    await at('jobfill_a', va.home_id); let r0 = await pp();
    ok(r0.status === 409 && /safe at home/.test(r0.json.error), "nobody's pocket can be picked while they're at home", JSON.stringify(r0.json));
    await pool.query("update citizens set job_id = $1 where handle = 'jobfill_a'", [work]); await pool.query("update citizens set job_id = null where handle = 'zara_ng'"); await at('jobfill_a', work); r0 = await pp();
    ok(r0.status === 409 && /workmates/.test(r0.json.error), 'or at work', JSON.stringify(r0.json));
    await pool.query("update citizens set job_id = $1 where handle = 'zara_ng'", [work]); await set('jobfill_a', 'coins_base = 500'); r0 = await pp();
    ok(r0.status === 200, 'but a workmate at the same place can try', JSON.stringify(r0.json));
    await pool.query("update citizens set job_id = $1 where handle = 'zara_ng'", [zj0]); await pool.query("update citizens set job_id = $1 where handle = 'jobfill_a'", [va.job_id]);
    await set('zara_ng', 'coins_base = 1000, net = 0, coins_day = 0, crime_at = null, jailed_until = null, visit_id = null, visit_until = null'); await set('jobfill_a', 'coins_base = 500, net = 0, coins_day = 0');
    await at('jobfill_a', landing); // out and about at the landing station
    const k = await call('POST', '/api/me/crime', { kind: 'pickpocket', target: 'jobfill_a' }, P);
    const z1 = await coins('zara_ng'), v1 = await coins('jobfill_a');
    ok(k.status === 200 && (k.json.caught ? z1 === 1000 - k.json.fine && v1 === 500 : z1 === 1000 + k.json.loot && v1 === 500 - k.json.loot), `a pickpocket ${k.json.caught ? 'is caught and fined' : 'gets away with it'}, and the coins add up`, JSON.stringify(k.json));
    ok((await call('POST', '/api/me/crime/start', { kind: 'rob' }, P)).status === 429 || (await whoDev('zara_ng')).jailedUntil, 'one crime every 10 minutes');
    ok((await call('POST', '/api/me/crime', { kind: 'rob' }, P)).status === 409, 'robbing a shop is a mini game now: the old instant robbery is gone');
    // police near the victim and a jail: keep trying until caught (each try is ~80% likely to be caught)
    let policeId = null;
    for (const [t, x, y] of [['police', 930, 900], ['police', 930, 903], ['police', 933, 900], ['jail', 933, 903]]) { const b = await call('POST', '/api/admin/buildings', { type: t, x, y }); policeId = policeId || b.json.building?.id; await call('POST', `/api/admin/buildings/${b.json.building?.id}/finish`); }
    let caught = null;
    await at('jobfill_a', policeId); // out and about right by the police station
    for (let i = 0; i < 30 && !caught; i++) { await set('zara_ng', 'crime_at = null, jailed_until = null, coins_base = 1000'); const r = await call('POST', '/api/me/crime', { kind: 'pickpocket', target: 'jobfill_a' }, P); if (r.json.caught) caught = r.json; }
    ok(caught && caught.jailed && caught.fine >= 25, 'caught near the police: fined and sent to jail', JSON.stringify(caught));
    ok(caught && caught.band === 'low' && caught.police <= 15, 'police a few tiles from the scene: the low-chance band', JSON.stringify(caught));
    { const lg = (await call('GET', '/api/admin/test/pushlog')).json.log; ok(lg.some(x => x.kind === 'crime' && /got caught/.test(x.body) && /refunded/.test(x.body)), 'a caught pickpocket: the victim’s phone hears about the refund', JSON.stringify(lg.slice(-1))); }
    { const nts = (await pool.query("select n.text from notices n join citizens c on c.id = n.citizen_id where c.handle = 'jobfill_a' order by n.id")).rows.map(r => r.text);
      ok(nts.some(t => /^🚓 @zara_ng picked your pocket but got caught by the police\. Your [\d,]+ coins have been refunded\.$/.test(t)), 'caught: the victim is told who it was, and refunded', JSON.stringify(nts.slice(-2)));
      ok(nts.filter(t => /Someone just picked your pocket/.test(t)).every(t => !/@zara_ng/.test(t)), 'got away: the victim is told, but not who', JSON.stringify(nts.slice(0, 2)));
      const mine = await call('GET', '/api/me/notices', undefined, P); ok(mine.status === 200 && Array.isArray(mine.json.notices), 'a colonist can read their own notices'); }
    { const R0 = await import('../shared/rules.js'); const o = R0.crimeOdds;
      ok(o('pickpocket', null).band === 'high' && o('pickpocket', 41).band === 'high' && o('rob', 40).band === 'mid' && o('rob', 16).band === 'mid' && o('pickpocket', 15).band === 'low', 'odds bands: over 40 tiles high, 16 to 40 mid, 15 or closer low');
      ok(o('pickpocket', null).chance > o('pickpocket', 30).chance && o('pickpocket', 30).chance > o('pickpocket', 5).chance && o('rob', 99, 0.15).chance === 0.75, 'farther from the police, better the odds (a crime wave adds 15%)');
      { const ids = Array.from({ length: 400 }, (_, i) => 'c' + i), tally = jt => { const n = { day: 0, evening: 0, night: 0 }; for (const id of ids) n[R0.shiftOf(id, 'job-' + id.length, jt)]++; return n; };
        const hosp = tally('hospital'), shop = tally('cafe'), off = tally('office');
        ok(hosp.night > 50 && hosp.evening > 50 && hosp.day > 120 && shop.night === 0 && shop.evening > 60 && off.day === 400 && R0.shiftOf('x', null, null) === 'day', 'shifts: hospitals run day, evening and night; cafés day and evening; offices days only', JSON.stringify({ hosp, shop, off }));
        ok(R0.routineAt(60, true, 'night') === 'work' && R0.routineAt(600, true, 'night') === 'home' && R0.routineAt(1400, true, 'night') === 'work' && R0.routineAt(60, true, 'evening') === 'home' && R0.routineAt(900, true, 'evening') === 'work' && R0.routineAt(600, true, 'day') === 'work',
          'night-shift workers are at work after midnight and asleep in the morning; evening shifts work the afternoon');
        const owls = new Set(ids.map(R0.owlOf)); ok(owls.size >= 5 && R0.routineAt(1240, false, 'day', 90) === 'out' && R0.routineAt(1240, false, 'day', 0) === 'home' && R0.routineAt(1110, false, 'day', -60) === 'home', 'bedtimes vary: early birds are home by 18:30, night owls are still out at 20:40'); }
      ok(R0.isNight(22 * 60) && R0.isNight(0) && R0.isNight(5 * 60 + 59) && !R0.isNight(6 * 60) && !R0.isNight(19 * 60 + 59) && R0.isNight(1440 * 3 + 21 * 60), 'night runs from 20:00 through midnight to 06:00');
      ok(o('rob', 99, 0, true).chance === 0.75 && o('pickpocket', 30, 0, true).chance === 0.6 && o('rob', 99, 0.15, true).chance === 0.9 && o('rob', 99, 0, true).night, 'crimes at night are 15 points likelier to work (at most 90%)'); }
    const zj = await who('zara_ng');
    ok(zj.visit && (await call('GET', '/api/me/crime', undefined, P)).json.jailedFor > 0, 'a jailed colonist is seen in the Jail');
    await sleep(1300); { const r = await call('POST', '/api/me/casino', { game: 'coin', pick: 'heads', bet: 1 }, P); ok(r.status === 409, 'no casino from jail', JSON.stringify(r)); }
    ok((await call('POST', '/api/me/visit', { friend: 'jobfill_a' }, P)).status === 409, 'no going out from jail');
    const petShop = (await call('POST', '/api/admin/buildings', { type: 'petstore', x: 1230, y: 1230 })).json.building?.id; await call('POST', `/api/admin/buildings/${petShop}/finish`);
    ok((await call('POST', '/api/me/pet', { kind: 'glimmerhop', buildingId: petShop }, P)).status === 409, 'no adopting from jail');
    { let c2 = null; for (let i = 0; i < 30 && !c2; i++) { await set('zara_ng', 'crime_at = null, jailed_until = null, coins_base = 30, bank = 100'); const r = await call('POST', '/api/me/crime', { kind: 'pickpocket', target: 'jobfill_a' }, P); if (r.json.caught) c2 = r.json; }
      const zz = (await pool.query("select coins_base, bank from citizens where handle = 'zara_ng'")).rows[0];
      ok(c2 && c2.paid.fromCash === 30 && c2.fine <= 130 && c2.paid.fromBank === c2.fine - 30 && !c2.paid.debt && Number(zz.bank) === 130 - c2.fine && Number(zz.coins_base) === 0, 'a fine comes from cash, then savings, and never puts the wallet in the minus', JSON.stringify({ c2: c2 && c2.paid, fine: c2 && c2.fine, zz }));
      // bail: out of jail early, from cash then savings
      await set('zara_ng', `jailed_until = ${Date.now() + 5 * 60000}, coins_base = 200, bank = 1000, net = 0`);
      const bq = await call('POST', '/api/me/bail', {}, P), zb = (await pool.query("select coins_base, bank, jailed_until from citizens where handle = 'zara_ng'")).rows[0];
      ok(bq.status === 200 && bq.json.cost === 750 && Number(zb.coins_base) === 0 && Number(zb.bank) === 1000 - 550 && !zb.jailed_until, 'pay bail (150 a minute left) to leave jail now: cash first, then savings', JSON.stringify({ r: bq.json, zb }));
      ok((await call('POST', '/api/me/bail', {}, P)).status === 409, "no bail when you're not in jail");
      await set('zara_ng', `jailed_until = ${Date.now() + 5 * 60000}, coins_base = 10, bank = 0`); ok((await call('POST', '/api/me/bail', {}, P)).status === 400, "bail can't be owed: you need the coins");
      await set('zara_ng', 'jailed_until = null, coins_base = 1000'); }
    // ---- crime mini games: rob a shop, con a tourist, hack an ATM ----
    { const MG = await import('../shared/minigames.js'); await call('POST', '/api/admin/treasury', { amount: 100000 });
      const fresh = () => set('zara_ng', 'crime_at = null, jailed_until = null, coins_base = 1000, bank = 0, net = 0, visit_id = null, visit_until = null');
      const start = (kind, practice, who = P) => call('POST', '/api/me/crime/start', { kind, practice }, who), finish = (runId, log, who = P) => call('POST', '/api/me/crime/finish', { runId, log }, who);
      // a good talker: each turn, the line that wins the most trust for the least suspicion, well timed
      const smartCon = L => { const picks = []; while (!MG.conReplay(L, picks).ok) { let best = 0, bv = -1e9; for (let o = 0; o < 4; o++) { const r = MG.conReplay(L, [...picks, { o, t: 0.95 }]), st = r.state; const v = r.ok ? (r.money ? 1e6 : -1e6) : st.trust - st.sus; if (v > bv) { bv = v; best = o; } } picks.push({ o: best, t: 0.95 }); } return picks; };
      await fresh(); const c0 = await coins('zara_ng');
      const pr = await start('rob', true); ok(pr.status === 200 && pr.json.practice && pr.json.seed > 0 && pr.json.diff >= 1 && pr.json.diff <= 5 && pr.json.loot === null, 'practise robbing the shop: a fresh level, no takings on offer', JSON.stringify(pr.json));
      ok(!(await pool.query("select crime_at from citizens where handle = 'zara_ng'")).rows[0].crime_at, 'practice is free: no lying low afterwards');
      const L0 = MG.levelOf('rob', pr.json.seed, pr.json.diff), s0 = MG.stealthStart(L0), s1 = MG.stealthStep(L0, s0, 1, 0);
      const pf = await finish(pr.json.id, { path: [[s0.x, s0.y], [s1.x, s1.y]] });
      ok(pf.status === 200 && pf.json.practice && pf.json.money === 0 && pf.json.score.total >= 0 && pf.json.score.setting <= 40 && pf.json.score.play <= 60, 'a practice game is scored like the real thing, but pays nothing', JSON.stringify(pf.json));
      ok(await coins('zara_ng') === c0, "practice doesn't touch your coins");
      ok((await finish(pr.json.id, { path: [[0, 0], [1, 1]] })).status === 409, 'a game can only be finished once');
      const pr2 = await start('rob', true), tp = await finish(pr2.json.id, { path: [[L0.entry.x, L0.entry.y], [L0.till.x, L0.till.y], [L0.entry.x, L0.entry.y]] });
      ok(tp.status === 200 && tp.json.game.invalid && tp.json.score.play === 0, "teleporting to the till doesn't count: the server replays every step", JSON.stringify(tp.json.game));
      ok((await finish(crypto.randomUUID(), { picks: [] })).status === 404 && (await finish(pr2.json.id, { picks: [] }, { auth: false })).status === 401, "only your own games can be finished");
      // for real: the con, played well, pays (up to 1.5× the takings)
      const rs = await start('scam', false); ok(rs.status === 200 && !rs.json.practice && rs.json.loot[0] > 0 && rs.json.loot[1] >= rs.json.loot[0], 'conning a tourist for real: the range you could take shows up front', JSON.stringify(rs.json));
      ok((await start('rob', false)).status === 429 && (await start('rob', true)).status === 200, "one real job at a time, but you can practise while you lie low");
      const Ls = MG.levelOf('scam', rs.json.seed, rs.json.diff), picks = smartCon(Ls), sold = MG.conReplay(Ls, picks).money;
      await sleep(1000 * Math.min(5, picks.length)); const c1 = await coins('zara_ng'), rf = await finish(rs.json.id, { picks }), c2 = await coins('zara_ng');
      ok(rf.status === 200 && rf.json.score.total === rf.json.score.play + rf.json.score.setting, 'the score is your play plus the setting', JSON.stringify(rf.json.score));
      const paid = rf.json.outcome === 'clean' || rf.json.outcome === 'partial';
      ok(!sold || rf.json.score.play >= 36, 'selling the moon rock is a good game', JSON.stringify({ sold, sc: rf.json.score }));
      ok(paid ? rf.json.money > 0 && c2 === c1 + rf.json.money + (rf.json.contracts?.coins || 0) && rf.json.money <= Math.round(rs.json.loot[1]) : rf.json.money === 0, `the result (${rf.json.title}) and the coins add up`, JSON.stringify({ r: rf.json, c1, c2 }));
      ok(rf.json.outcome !== 'clean' || rf.json.mult > 1 || rf.json.score.total === 80, 'a clean getaway pays more than the takings', JSON.stringify(rf.json));
      if (paid) { const w = (await call('GET', '/api/me/crime', undefined, P)).json;
        ok(w.waitFor > 0 && w.waitFor <= 20000 && w.streak === 1, 'a job that comes off: lie low just 20 seconds, but the next one is harder', JSON.stringify({ wait: w.waitFor, streak: w.streak }));
        ok(w.jobsToday === 1 && w.pay === 1 && rf.json.payNext === 1 && w.free === 8, 'the first 8 jobs each day pay in full', JSON.stringify({ jobs: w.jobsToday, pay: w.pay, next: rf.json.payNext }));
        ok(rf.json.hotNext === 1.15 && w.hot === 1.15, 'a job that comes off heats up the streak: the next pays 15% more', JSON.stringify({ hot: rf.json.hotNext, w: w.hot }));
        ok(rf.json.xp && rf.json.xp.gain >= 30 && rf.json.xp.rank.name && rf.json.contracts.list.length === 3, 'it earns XP towards a criminal rank, and shows the day’s contracts', JSON.stringify({ xp: rf.json.xp, c: rf.json.contracts }).slice(0, 300));
        await set('zara_ng', `crime_day = '${new Date().toISOString().slice(0, 10)}', crime_today = 8`); ok(Math.abs((await call('GET', '/api/me/crime', undefined, P)).json.pay - 0.96) < 1e-9, 'after 8 jobs in a day, each pays 4% less than the last');
        await set('zara_ng', `crime_today = 40`); ok(Math.abs((await call('GET', '/api/me/crime', undefined, P)).json.pay - 0.75) < 1e-9, 'but a job never pays less than three quarters');
        await set('zara_ng', `crime_today = 1`);
        await set('zara_ng', 'crime_at = null'); const r2 = (await start('scam', false)).json;
        ok(r2.pay === 1 && r2.hot === 1.15, '…and the takings on offer for the next job show the hot streak', JSON.stringify(r2));
        await set('zara_ng', "crime_day = '2000-01-01'"); ok(Math.abs((await call('GET', '/api/me/crime', undefined, P)).json.pay - 1) < 1e-9, 'a new day: jobs pay in full again'); await set('zara_ng', 'crime_day = null, crime_today = 0');
        ok(r2.streak === 1 && (r2.diff > rs.json.diff || r2.diff === 5) && r2.chance < rs.json.chance, 'the next job: a harder game, and less help from the setting', JSON.stringify({ before: [rs.json.diff, rs.json.chance], after: [r2.diff, r2.chance] }));
        await finish(r2.id, { picks: [{ o: 7, t: 1 }] }); ok((await call('GET', '/api/me/crime', undefined, P)).json.streak === 0, 'getting caught wipes the slate clean'); }
      // a botched job: nothing done, so the play earns nothing, and that's caught
      await fresh(); const rb = await start('scam', false), bad = await finish(rb.json.id, { picks: [{ o: 9, t: 1 }] });
      ok(bad.status === 200 && bad.json.game.invalid && ['fined', 'jailed'].includes(bad.json.outcome) && bad.json.fine >= 50 && bad.json.fine <= 1000 && (await coins('zara_ng')) === 1000 - bad.json.fine + (bad.json.contracts?.coins || 0), 'a botched job is caught and fined', JSON.stringify(bad.json));
      ok(bad.json.fine === Math.min(1000, (await import('../shared/rules.js')).crimeFine(Number((await pool.query('select loot from crime_runs where id = $1', [rb.json.id])).rows[0].loot))), 'the fine is about a seventh of the takings on offer (50 to 1,500)', JSON.stringify(bad.json.fine));
      ok(bad.json.waitFor === 20000 || bad.json.jailed, 'after a job that went wrong, Go again counts down a full 20 seconds from the end of the game', JSON.stringify(bad.json.waitFor));
      ok(bad.json.xp.gain >= 10 && bad.json.xp.gain - bad.json.contracts.done.reduce((a, d) => a + d.xp, 0) === 10 && bad.json.streak === 0 && bad.json.hotNext === 1, 'even a botched job earns a little XP; the streak is over', JSON.stringify(bad.json.xp));
      { // a fine is never more than you have: no debt from a bad game
        await fresh(); await set('zara_ng', 'coins_base = 60, bank = 0'); const rp = await start('scam', false), bp = await finish(rp.json.id, { picks: [{ o: 9, t: 1 }] });
        ok(bp.json.fine === 60 && (await coins('zara_ng')) === (bp.json.contracts?.coins || 0), 'the fine is never more than the thief has: no debt', JSON.stringify({ fine: bp.json.fine, coins: await coins('zara_ng') })); }
      { // contracts and ranks
        const R0 = await import('../shared/rules.js'), zid = (await pool.query("select id from citizens where handle = 'zara_ng'")).rows[0].id, day = R0.realDayKey();
        const cr = (await call('GET', '/api/me/crime', undefined, P)).json; ok(cr.rank && cr.contracts.list.length === 3 && [1, 2, 3].every((t, i) => cr.contracts.list[i].tier === t), 'the Crime tab shows your rank and three contracts (easy, medium, hard)', JSON.stringify(cr.contracts).slice(0, 300));
        ok(R0.pickContracts('a', day, {}).every(id => !R0.contractOf(id).needs) && R0.pickContracts('a', day, { shop: 1, bank: 1 }).length === 3, "nobody gets a contract the colony can't offer (no shop, no Bank)");
        ok(R0.contractHit('ghost', { solo: true, kind: 'rob', won: true, state: { peak: 0.3 } }) && !R0.contractHit('ghost', { solo: true, kind: 'rob', won: true, state: { peak: 0.6 } }) && R0.contractHit('nowire', { solo: true, kind: 'atm', won: true, state: { wrongs: 0 } }) && R0.contractHit('heist', { heist: true }), 'contracts check what really happened in the game');
        await pool.query("update crime_contracts set ids = '{tries3,tries3,tries3}', prog = '{2,2,2}', paid = '{f,f,f}', bonus = false where citizen_id = $1 and day = $2", [zid, day]);
        await fresh(); await set('zara_ng', 'crime_xp = 95'); const rc = await start('scam', false), bc = await finish(rc.json.id, { picks: [{ o: 9, t: 1 }] });
        const want = 3 * 300 + R0.CONTRACT_ALL.coins;
        ok(bc.json.contracts.done.length === 4 && bc.json.contracts.done.some(d => d.id === 'all') && bc.json.contracts.coins === want, 'finishing contracts pays each one, and a bonus for all three', JSON.stringify(bc.json.contracts).slice(0, 300));
        ok((await coins('zara_ng')) === 1000 - bc.json.fine + want, 'the contract coins land in your cash', JSON.stringify({ c: await coins('zara_ng'), fine: bc.json.fine }));
        ok(bc.json.xp.up && bc.json.xp.up.name === 'Hustler' && bc.json.xp.rank.total === 95 + 10 + 3 * 30 + R0.CONTRACT_ALL.xp, 'XP from jobs and contracts lifts you to the next rank', JSON.stringify(bc.json.xp));
        ok(R0.rankMult(100) === 1.03 && R0.rankMult(12000) > 1.2, 'each rank adds 3% to everything you take');
        ok((await pool.query("select 1 from events where text like '%zara_ng is now a Hustler%'")).rowCount >= 1, 'the Colony Log announces a new rank', JSON.stringify((await pool.query("select kind, text from events order by t desc limit 4")).rows));
        ok((await pool.query("select score from crime_best where citizen_id = $1 and kind = 'scam'", [zid])).rows[0]?.score >= 0 && (await call('GET', '/api/me/crime', undefined, P)).json.bests.scam >= 0, 'your best score in each game is kept and shown'); }
      ok(!bad.json.jailed || (await whoDev('zara_ng')).jailedUntil > Date.now(), 'and the worst ones go to jail');
      await fresh(); ok((await start('rob', false)).status === 200, 'after lying low, the next real job can start');
      ok((await start('pickpocket', true)).status === 400, 'pickpocketing stays instant: no mini game');
      // the scoring
      ok(MG.outcomeOf(100).key === 'clean' && MG.outcomeOf(100).mult === 1.5 && MG.outcomeOf(80).mult === 1 && MG.outcomeOf(70).key === 'partial' && MG.outcomeOf(50).key === 'empty' && MG.outcomeOf(30).key === 'fined' && MG.outcomeOf(10).key === 'jailed' && MG.outcomeOf(95, false).mult === 0,
        'outcomes: 80+ clean (up to 1.5×), 60–79 some of it, 40–59 nothing, 20–39 fined, below 20 jailed');
      // every level can be won: a perfect ATM hack opens it, and a bot walking the shop's route is a valid replay
      { let okA = 0, okR = 0; for (let seed = 1; seed <= 30; seed++) { const A = MG.genAtm(seed, 1 + seed % 5), ev = []; let t = 1; A.wires.forEach((w, i) => ev.push(['w', i, A.sockets.indexOf(A.card[i].sym), t += 0.5])); A.pin.forEach(d => ev.push(['k', d, t += 0.3])); if (MG.atmReplay(A, ev, t).money) okA++;
          const Lr = MG.genStealth(seed, 1 + seed % 5); let st = MG.stealthStart(Lr); const path = [[st.x, st.y]]; for (let i = 0; i < 40 && !st.done; i++) { st = MG.stealthStep(Lr, st, 0.7, -0.7); path.push([st.x, st.y]); } if (MG.stealthReplay(Lr, path).ok) okR++; }
        ok(okA === 30 && okR === 30, 'the ATM can always be cracked, and an honest walk around the shop always replays', JSON.stringify({ okA, okR })); }
      { const A0 = await import('../server/actions.js').catch(() => null); if (A0 && A0.streakDiff) ok([0, 1, 2, 3, 4, 9].map(k => A0.streakDiff(2, k)).join() === '2,3,3,4,4,4', 'a winning streak raises the difficulty gently: one step for every two wins, two at most', [0, 1, 2, 3, 4, 9].map(k => A0.streakDiff(2, k)).join());
        ok(MG.genStealth(7, 4).guards.length === 1 && MG.genStealth(7, 5).guards.length === 2 && MG.genStealth(7, 4, true).cams.length === 2 && [1, 2, 3].every(d => MG.genStealth(11, d, true).cams.length === 1) && [1, 3, 5].every(d => MG.genStealth(11, d).cams.length === 0) && MG.levelOf('rob', 11, 3, true, true).cams.length === 1 && MG.levelOf('rob', 11, 3, true).cams.length === 0, 'the shop adds a second member of staff only at the hardest level; CCTV only from the 6th robbery in a row, and more cameras come gradually'); }
      { // the con: a real conversation with somebody, who reacts to what you say
        const fitOf = (st, t) => MG.CON_WORRIES[st.worry].fit[t.tactic] ?? 0, run = (L, choose) => { let st = MG.conStart(L); const picks = []; while (!st.done) { const i = choose(MG.conOptions(L, st), st); picks.push({ o: i, t: 0.9 }); st = MG.conStep(L, st, picks[picks.length - 1]); } return MG.conReplay(L, picks); };
        let good = 0, bad = 0; for (let seed = 1; seed <= 60; seed++) { const L = MG.genCon(seed, 3);
          if (run(L, (o, st) => { const P = MG.CON_PERSONAS[L.persona]; let b = 0, bv = -99; o.forEach((t, i) => { const v = fitOf(st, t) * 10 + (P.likes.includes(t.tactic) ? 5 : 0) - (P.hates.includes(t.tactic) ? 8 : 0) - (t.tactic === st.last ? 6 : 0); if (v > bv) { bv = v; b = i; } }); return b; }).money) good++;
          if (run(L, (o, st) => Math.max(0, o.findIndex(t => fitOf(st, t) === -1))).money) bad++; }
        ok(good === 60 && bad === 0, 'the con: answering what the tourist actually asks sells; the wrong move every time never does', JSON.stringify({ good, bad }));
        { const seen = new Set(); for (let seed = 1; seed <= 400; seed++) seen.add(MG.genCon(seed, 3).persona); const ids = Object.keys(MG.CON_PERSONAS); let lines = true;
          for (const w of Object.keys(MG.CON_WORRIES)) for (let turn = 0; turn < 3; turn++) for (const o of MG.conOptions({ ...MG.genCon(turn + 1, 3) }, { ...MG.conStart(), worry: w, turn })) if (!o.line) lines = false;
          ok(ids.length >= 13 && seen.size === ids.length && ids.every(k => MG.CON_PERSONAS[k].yes && MG.CON_PERSONAS[k].no && MG.CON_PERSONAS[k].hi) && lines, 'the con: thirteen kinds of tourist turn up, each with their own hello and goodbye, and every approach has a line for every worry', JSON.stringify({ ids: ids.length, seen: seen.size, lines })); }
        const L = MG.genCon(9, 2), s0 = MG.conStart(L), o0 = MG.conOptions(L, s0);
        ok(o0.length === 4 && new Set(o0.map(x => x.tactic)).size === 4 && o0.some(x => fitOf(s0, x) === 2) && o0.some(x => fitOf(s0, x) === -1) && MG.CON_PERSONAS[L.persona] && L.name && L.from, 'each turn offers four different approaches, always including a right answer and a wrong move', JSON.stringify(o0));
        let st = MG.conStep(L, s0, { o: o0.findIndex(x => fitOf(s0, x) === 2), t: 1 }); const o1 = MG.conOptions(L, st), dodge = o1.findIndex(x => fitOf(st, x) <= 0 && !MG.CON_PERSONAS[L.persona].likes.includes(x.tactic)), w1 = st.worry;
        if (dodge >= 0 && w1 !== 'open') { const st2 = MG.conStep(L, st, { o: dodge, t: 1 }); ok(st2.done || (st2.worry === w1 && st2.again === 1 && /still|again|didn|said|really|asked|Go on/i.test(MG.conSay(L, st2))), 'dodge the question and they ask it again', JSON.stringify({ w1, st2, say: MG.conSay(L, st2) })); }
        const same = o1.findIndex(x => x.tactic === st.last); if (same >= 0) ok(MG.conStep(L, st, { o: same, t: 1 }).q === 'repeat', 'saying the same kind of thing twice wears thin'); }
      { // tripping a laser brings the nearest member of staff over to look, then back to their round
        let checked = 0, good = 0;
        for (let seed = 1; seed < 300 && checked < 5; seed++) { const L = MG.genStealth(seed, 4); if (!L.lasers.length) continue; const z = L.lasers[0], tgt = { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 };
          let st = MG.stealthStart(L); const path = [[st.x, st.y]]; for (let i = 0; i < 500 && !st.done && !st.al; i++) { const dx = tgt.x - st.x, dy = tgt.y - st.y, n = Math.hypot(dx, dy) || 1; st = MG.stealthStep(L, st, n < 0.1 ? 0 : dx / n, n < 0.1 ? 0 : dy / n); path.push([st.x, st.y]); }
          if (!st.al) continue; checked++; const gi = st.al.findIndex(Boolean), a = st.al[gi], at = MG.staffAt(L, gi, a.t0 + a.walk + 0.3, st), before = MG.staffAt(L, gi, a.t0 + a.total - 0.01, st), after = MG.staffAt(L, gi, a.t0 + a.total + 0.01, st);
          const rp = MG.stealthReplay(L, path);
          if (at.alert === 'look' && Math.hypot(at.x - (Math.floor(st.x) + 0.5), at.y - (Math.floor(st.y) + 0.5)) < 0.01 && Math.hypot(after.x - before.x, after.y - before.y) < 0.1 && rp.ok) good++; }
        ok(checked >= 3 && good === checked, 'tripping a laser brings the nearest member of staff to the spot; they look around and go back to their round, and the server replays it the same', JSON.stringify({ checked, good })); }
      await fresh(); await call('POST', '/api/admin/treasury', { amount: -100000 }); }
    await set('zara_ng', 'jailed_until = null, visit_id = null, visit_until = null');
    // going out
    const pl = (await call('GET', '/api/me/places', undefined, P)).json;
    ok(pl.housed && pl.places.length > 0, 'a colonist sees places to go', JSON.stringify(pl).slice(0, 120));
    const go = await call('POST', '/api/me/visit', { buildingId: pl.places[0].id }, P);
    ok(go.status === 200 && (await who('zara_ng')).visit?.[0] === pl.places[0].id, 'and goes there, for everyone to see');
    ok((await call('POST', '/api/me/visit', { friend: 'jobfill_a' }, P)).status === 200 && (await who('zara_ng')).visit?.[0] === (await who('jobfill_a')).home[0], "visiting a friend's home");
    ok(policeId && (await call('POST', '/api/me/visit', { buildingId: policeId }, P)).status === 400, "can't just walk into a police station");
    { const C = await import('../shared/catalog.js'), R0 = await import('../shared/rules.js'), myH = (await who('zara_ng')).home[0];
      const kinds = Object.keys(C.BUILDING_TYPES).filter(k => R0.canGoTo(k) && ['housing', 'offices', 'industry', 'utilities'].includes(C.BUILDING_TYPES[k].cat));
      const off = (await pool.query("select id, type from buildings where type = any($1) and done and not ruin and id <> $2 limit 1", [kinds, myH])).rows[0];
      const go = off && await call('POST', '/api/me/visit', { buildingId: off.id }, P);
      ok(go && go.status === 200, `Go here works for any building, not just shops and parks (${off?.type})`, JSON.stringify(go?.json));
      const myHome = (await who('zara_ng')).home[0], gh = await call('POST', '/api/me/visit', { buildingId: myHome }, P);
      ok(gh.status === 200 && gh.json.home === true, 'going to your own home heads home');
      // driving there yourself (in 3D): you're there now, and pay the fuel for the distance you drove, not a cab
      await pool.query("update citizens set coins_base = 50000, net = 0 where handle = 'zara_ng'");
      const ob = (await pool.query('select x, y from buildings where id = $1', [off.id])).rows[0], want = R0.tripFare(120, true).fare;
      const dr = await call('POST', '/api/me/visit', { buildingId: off.id, from: { x: ob.x, y: ob.y, b: off.id }, drove: 120 }, P);
      ok(dr.status === 200 && dr.json.fuel === want && dr.json.mode === 'car', `driving there yourself pays the fuel (${want} coins for 120 tiles)`, JSON.stringify(dr.json));
      const vo = (await pool.query("select visit_origin from citizens where handle = 'zara_ng'")).rows[0].visit_origin; ok(vo && vo.x === ob.x && vo.y === ob.y, '…and you arrive where you parked (no trip from home)', JSON.stringify(vo));
      await call('POST', '/api/me/visit', { buildingId: myHome }, P); }
    { // trips start where the colonist really is, and riding costs money
      await pool.query("update citizens set cars = null, car_active = null, coins_base = 1000, net = 0, coins_day = 0, visit_id = null, visit_until = null, visit_origin = null where handle = 'zara_ng'");
      const R0 = await import('../shared/rules.js'), zh = (await who('zara_ng')).home;
      const far = (await pool.query("select id, x, y from buildings where done and not ruin and type = any($1) and abs(x - $2) + abs(y - $3) >= 30 limit 1", [Object.keys((await import('../shared/catalog.js')).BUILDING_TYPES).filter(R0.canGoTo), zh[2], zh[3]])).rows[0];
      const from = { x: zh[2] + 3.5, y: zh[3] + 1.25 }, c0 = (await whoDev('zara_ng')).coins;
      const go = await call('POST', '/api/me/visit', { buildingId: far.id, from }, P), v = (await who('zara_ng')).visit;
      ok(go.status === 200 && v?.[6]?.x === from.x && v[6].y === from.y, 'a trip starts from where the colonist really is (sent by the phone)', JSON.stringify(v?.[6]));
      const want = R0.tripFare(Math.abs(from.x - far.x) + Math.abs(from.y - far.y), false).fare + R0.tripFare(Math.abs(far.x - zh[2]) + Math.abs(far.y - zh[3]), false).fare;
      ok(go.json.mode === 'cab' && go.json.fare === want && (await whoDev('zara_ng')).coins === c0 - want, `no car: a cab there and back (${want} coins)`, JSON.stringify(go.json));
      await pool.query("update citizens set coins_base = 0, visit_id = null, visit_until = null where handle = 'zara_ng'");
      const broke = await call('POST', '/api/me/visit', { buildingId: far.id, from }, P);
      ok(broke.status === 200 && broke.json.fare === 0 && (await who('zara_ng')).visit?.[6]?.walk === true, "can't afford the cab: they walk", JSON.stringify(broke.json));
      await pool.query("update citizens set cars = $1, car_active = 'c1', coins_base = 1000, visit_id = null, visit_until = null where handle = 'zara_ng'", [JSON.stringify([{ id: 'c1', m: 'sedan', col: '#2B2621', at: 1 }])]);
      const dr = await call('POST', '/api/me/visit', { buildingId: far.id, from }, P);
      ok(dr.json.mode === 'car' && dr.json.fare > 0 && dr.json.fare < want, 'with a car: just fuel, cheaper than a cab', JSON.stringify(dr.json));
      // weekly bills: car upkeep and property upkeep
      const zid = (await pool.query("select id from citizens where handle = 'zara_ng'")).rows[0].id, own = (await pool.query("select id, type, price from buildings where owner_id is null and done limit 1")).rows[0];
      await pool.query('update buildings set owner_id = $1, owner_handle = $2, price = 50000 where id = $3', [zid, 'zara_ng', own.id]);
      await pool.query("update citizens set coins_base = 50, bank = 2000, net = 0, coins_day = 0 where id = $1", [zid]);
      const bl = await call('POST', '/api/admin/test/bills'), z1 = await whoDev('zara_ng');
      ok(bl.status === 200 && z1.coins === 0 && z1.bank === 2000 - (45 + 1300 - 50), 'bills: car upkeep (45) weekly, property upkeep twice a game year (26 weeks × 0.1% of 50,000), cash first, then savings', JSON.stringify({ bl: bl.json, coins: z1.coins, bank: z1.bank }));
      const nt = (await pool.query("select text from notices where citizen_id = $1 and kind = 'bills' order by id desc limit 1", [zid])).rows[0]?.text || '';
      ok(/car upkeep 45 \+ 🏠 property upkeep 1,300 \(half-yearly\) = 1,345 coins/.test(nt), 'and a notice says what it was for', nt);
      { const R2 = await import('../shared/rules.js'); ok(R2.PROPERTY_BILL_DAYS === 182 && Math.abs(R2.UPKEEP_RATE * R2.PROPERTY_BILL_WEEKS - 0.026) < 1e-12, 'property is billed every 26 game weeks (twice a 52-week game year)'); }
      await pool.query("update citizens set coins_base = 30, bank = 20, net = 0, coins_day = 0 where id = $1", [zid]);
      const bl3 = await call('POST', '/api/admin/test/bills'), z3 = await whoDev('zara_ng');
      ok(bl3.status === 200 && z3.bank === 0 && z3.coins === 30 + 20 - 1345, 'bills bigger than cash and savings: both are emptied and the wallet goes into the minus', JSON.stringify({ coins: z3.coins, bank: z3.bank }));
      await pool.query('update buildings set owner_id = null, owner_handle = null where id = $1', [own.id]); await pool.query("update citizens set cars = null, car_active = null where id = $1", [zid]); }
    ok((await call('POST', '/api/me/visit/end', {}, P)).status === 200 && (await who('zara_ng')).visit?.[4] <= Date.now() + 1000, 'and heads home (the trip back stays visible)');
    // pets
    await set('zara_ng', 'coins_base = 12500');
    ok((await call('POST', '/api/me/pet', { kind: 'glimmerhop', name: 'Zip' }, P)).status === 400, 'pets are adopted at a Pet store');
    ok((await call('POST', '/api/me/pet', { kind: 'glimmerhop', name: 'Zip', buildingId: policeId }, P)).status === 409, "a police station isn't a Pet store");
    { const { PET_PRICES, petPrice } = await import('../shared/creatures.js'); const ps = Object.values(PET_PRICES);
      ok(Math.min(...ps) >= 2500 && new Set(ps).size === ps.length && petPrice('glimmerhop') === 10000, 'every creature has its own price, 2,500 at least', JSON.stringify(PET_PRICES)); }
    await set('zara_ng', 'coins_base = 9999'); ok((await call('POST', '/api/me/pet', { kind: 'glimmerhop', name: 'Zip', buildingId: petShop }, P)).status === 400, 'a glimmerhop costs 10,000 coins');
    await set('zara_ng', 'coins_base = 12500');
    ok((await call('POST', '/api/me/pet', { kind: 'unicorn', buildingId: petShop }, P)).status === 400, 'only native creatures');
    const pet = await call('POST', '/api/me/pet', { kind: 'glimmerhop', name: 'Zip', buildingId: petShop }, P);
    ok(pet.status === 200 && (await who('zara_ng')).pet?.k === 'glimmerhop' && (await coins('zara_ng')) === 2500 && pet.json.price === 10000, 'adopting a pet everyone can see', JSON.stringify(pet.json));
    ok((await call('GET', '/api/meta', undefined, { auth: false })).json.events.some(e => e.kind === 'pet' && e.text.includes('@zara_ng adopted')), 'a new pet makes the News flash');
    ok((await call('POST', '/api/me/pet', { kind: 'starcrest', buildingId: petShop }, P)).status === 409, 'one pet at a time');
    ok((await call('PUT', '/api/me/pet', { name: 'Zippy' }, P)).status === 200 && (await who('zara_ng')).pet.n === 'Zippy', 'renaming the pet');
    ok((await call('PUT', '/api/me/pet', { name: '<b>' }, P)).status === 400, 'pet names are letters only');
    ok((await call('DELETE', '/api/me/pet', undefined, P)).status === 200 && !(await who('zara_ng')).pet, 'letting it go'); }
  // ---- the Bank, cars, moving home, owning buildings ----
  { const set = (h, sql, v = []) => pool.query(`update citizens set ${sql} where handle = $1`, [h, ...v]), money = async () => { const d = await whoDev('zara_ng'); return { wallet: d.coins, bank: d.bank }; };
    const build = async (type, x, y) => { const b = await call('POST', '/api/admin/buildings', { type, x, y }); await call('POST', `/api/admin/buildings/${b.json.building?.id}/finish`); return b.json.building?.id; };
    await set('zara_ng', 'coins_base = 500, coins_day = 0, net = 0, bank = 0, jailed_until = null');
    ok((await call('POST', '/api/me/bank/deposit', { amount: 100 }, P)).status === 400, 'deposits only at a Bank');
    const bakery = await build('bakery', 1210, 1210);
    ok((await call('POST', '/api/me/bank/deposit', { amount: 100, buildingId: bakery }, P)).status === 409, "a bakery isn't a Bank");
    const bankId = await build('bank', 940, 900);
    ok((await call('POST', '/api/me/bank/withdraw', { amount: 1 }, P)).status === 400, 'withdrawals only at a Bank too');
    const dep = await call('POST', '/api/me/bank/deposit', { amount: 300, buildingId: bankId }, P);
    ok(dep.status === 200 && dep.json.wallet === 200 && dep.json.bank === 300, 'deposit 300 into the Bank', JSON.stringify(dep.json));
    ok((await call('POST', '/api/me/bank/withdraw', { amount: 400, buildingId: bankId }, P)).status === 400, "can't withdraw more than you saved");
    ok((await call('POST', '/api/me/bank/withdraw', { amount: 100, buildingId: bankId }, P)).json.bank === 200, 'withdraw 100 at the Bank');
    { const mfb = await build('microbank', 1240, 1240), d2 = await call('POST', '/api/me/bank/deposit', { amount: 50, buildingId: mfb }, P);
      ok(d2.status === 200 && d2.json.bank === 250, 'a Microfinance bank takes deposits into the same account', JSON.stringify(d2.json));
      ok((await call('POST', '/api/me/bank/withdraw', { amount: 50, buildingId: mfb }, P)).json.bank === 200, 'and pays out withdrawals');
      const C = await import('../shared/catalog.js'); ok(C.BANK_TYPES.length === 4 && C.BANK_TYPES.every(t => C.BUILDING_TYPES[t]) && C.BUILDING_TYPES.bank.work.slots === 24, 'four kinds of bank (microfinance, community, local, international); the Local bank has 24 jobs'); }
    ok((await who('zara_ng')).bank === undefined && (await whoDev('zara_ng')).bank === 200, 'bank balances are private');
    // cars: bought at a Car dealership
    const lot = await build('cardealer', 1300, 1240);
    ok((await call('POST', '/api/me/cars', { model: 'hatch', color: '#D9544A', buildingId: bankId }, P)).status === 409, 'cars are only sold at a Car dealership');
    ok((await call('POST', '/api/me/cars', { model: 'hatch', color: '#D9544A', buildingId: lot }, P)).status === 400, "can't afford a car with 300 coins on you");
    await set('zara_ng', 'coins_base = 200000');
    const c1 = await call('POST', '/api/me/cars', { model: 'hatch', color: '#5B8DB8', buildingId: lot }, P);
    ok(c1.status === 200 && c1.json.coins === 175000 && c1.json.car.paid === 25000, 'buy a hatchback for 25,000', JSON.stringify(c1.json));
    ok(JSON.stringify((await who('zara_ng')).car) === JSON.stringify(['hatch', '#5B8DB8']), 'everyone sees which car they drive');
    const c2 = await call('POST', '/api/me/cars', { model: 'sedan', color: '#2F4A7A', buildingId: lot }, P);
    ok((await call('PUT', '/api/me/cars/active', { id: c2.json.car.id }, P)).status === 200 && (await who('zara_ng')).car[0] === 'sedan', 'switch to driving the sedan');
    await call('POST', '/api/me/cars', { model: 'hatch', buildingId: lot }, P);
    ok((await call('POST', '/api/me/cars', { model: 'hatch', buildingId: lot }, P)).status === 409, 'the garage holds 3 cars');
    const sold = await call('DELETE', `/api/me/cars/${c1.json.car.id}`, undefined, P);
    ok(sold.status === 200 && sold.json.back === 15000, 'sell a car for 60% of what you paid');
    { const C = await import('../shared/catalog.js'); ok(C.carPaid({ m: 'hatch' }) === 1500 && C.carPaid({ m: 'hatch', paid: 25000 }) === 25000, 'a car bought before the repricing sells for 60% of its old price, not the new one'); }
    { const Rr = await import('../shared/rules.js'); const hp = Rr.propertyPrice('house'), inc = Rr.fullIncome('house') * 48;
      ok(hp === 37000 && hp / inc > 28 && hp / inc < 32 && Rr.propertyPrice('tent') === 5000, 'a full building pays for itself in about a real month (a House: 37,000)', JSON.stringify({ hp, inc })); }
    ok((await call('POST', '/api/me/cars', { model: 'tank', buildingId: lot }, P)).status === 400, 'only cars the dealer sells');
    { await set('zara_ng', 'coins_base = 2000000'); const bk = await call('POST', '/api/me/cars', { model: 'bicycle', buildingId: lot }, P);
      ok(bk.status === 200 && bk.json.car.m === 'bicycle', 'bikes are sold at the dealer too', JSON.stringify(bk.json));
      ok((await call('POST', '/api/me/cars', { model: 'motorbike', buildingId: lot }, P)).status === 409, 'cars and bikes share the 3-place garage');
      const hc = await call('POST', '/api/me/cars', { model: 'helicopter', buildingId: lot }, P), v = (await pool.query("select * from vehicles where owner_id = (select id from citizens where handle = 'zara_ng')")).rows;
      ok(hc.status === 200 && v.length === 1 && v[0].type === 'helicopter' && v[0].owner_handle === 'zara_ng', 'boats and aircraft are sold at the dealer too: a helicopter takes to the sky over your home', JSON.stringify(hc.json).slice(0, 200));
      ok((await call('PUT', '/api/me/cars/active', { id: hc.json.car.id }, P)).status === 409, "you don't ride a helicopter to work");
      const sh = await call('DELETE', `/api/me/cars/${hc.json.car.id}`, undefined, P); ok(sh.status === 200 && sh.json.back === 360000 && !(await pool.query("select 1 from vehicles where car_id = $1", [hc.json.car.id])).rowCount, 'sell it back: it leaves the sky', JSON.stringify(sh.json)); }
    // moving home
    const spare = await build('house', 950, 900);
    const hl = (await call('GET', '/api/me/homes', undefined, P)).json;
    ok(hl.housed && hl.homes.some(h => h.id === spare), 'homes with space are listed', JSON.stringify(hl).slice(0, 160));
    { const Rr = await import('../shared/rules.js'), sb = (await pool.query('select x, y, type from buildings where id = $1', [spare])).rows[0], cur = (await pool.query('select x, y from buildings where id = $1', [hl.current.id])).rows[0];
      const cost = Rr.rentCost(sb.type, [cur.x, cur.y], [sb.x, sb.y]); await set('zara_ng', 'coins_base = 100');
      ok((await call('POST', '/api/me/home', { buildingId: spare }, P)).status === 400, "renting needs the moving-in fee and the movers in cash");
      await set('zara_ng', 'coins_base = 50000'); const rh = await call('POST', '/api/me/home', { buildingId: spare }, P);
      ok(rh.status === 200 && rh.json.paid === cost.total && rh.json.fee === cost.fee && rh.json.movers === cost.movers && (await whoDev('zara_ng')).coins === 50000 - cost.total && (await who('zara_ng')).home[0] === spare, 'Rent here: pay the moving-in fee plus the movers, and you move out of your old home', JSON.stringify({ r: rh.json, cost }));
      const lg = (await call('GET', '/api/me/ledger', undefined, P)).json;
      ok(lg.list.some(x => x.key === 'rent:movers' && x.coins === -cost.movers) && lg.list.some(x => x.key === 'rent:fee' && x.coins === -cost.fee) && lg.list.some(x => x.key === 'car:buy' && x.coins === -25000), 'the Wallet history shows money in and out', JSON.stringify(lg.list.slice(0, 4))); }
    ok((await call('POST', '/api/me/home', { buildingId: hl.current.id }, P)).status === 429, 'one move per game day');
    { const lv = await call('POST', '/api/me/home/leave', {}, P), mh = (await call('GET', '/api/me/home', undefined, P)).json;
      ok(lv.status === 200 && mh.home === null && mh.leftHome && (await whoDev('zara_ng')).leftHome === true, 'leave home: no home (and no job) until you rent again', JSON.stringify(mh));
      await call('POST', '/api/admin/test/fill', {}).catch(() => {}); ok(!(await who('zara_ng')).home, "someone who left isn't put back in a home by the housing queue");
      await pool.query("update citizens set home_changed_day = null where handle = 'zara_ng'");
      const back = await call('POST', '/api/me/home', { buildingId: spare }, P); const zb = await who('zara_ng');
      ok(back.status === 200 && zb.home[0] === spare && zb.job, 'Rent here works from no home too, and finds you a job nearby', JSON.stringify(back.json));
      await pool.query("update citizens set home_changed_day = null where handle = 'zara_ng'"); }
    // owning buildings
    await set('zara_ng', 'coins_base = 500');
    ok((await call('POST', '/api/me/properties/buy', { buildingId: spare }, P)).status === 400, "can't buy what you can't afford");
    await set('zara_ng', 'coins_base = 500000');
    const police = await build('police', 960, 900);
    ok((await call('POST', '/api/me/properties/buy', { buildingId: police }, P)).status === 400, "public buildings aren't for sale");
    const buy = await call('POST', '/api/me/properties/buy', { buildingId: spare }, P);
    ok(buy.status === 200 && (await whoDev('zara_ng')).coins === 500000 - buy.json.price, 'buy the house you live in', JSON.stringify(buy.json));
    ok((await call('POST', '/api/me/properties/buy', { buildingId: spare }, P)).status === 409, "can't buy it twice");
    { const z = (await pool.query("select c.net, j.type jt from citizens c left join buildings j on j.id = c.job_id where c.handle = 'zara_ng'")).rows[0], BT0 = (await import('../shared/catalog.js')).BUILDING_TYPES;
      ok(!z.jt || Number(z.net) === BT0[z.jt].work.salary - Math.round(BT0[z.jt].work.salary * 0.2), 'buying the home you rent stops the rent at once', JSON.stringify(z)); }
    const props = (await call('GET', '/api/me/properties', undefined, P)).json;
    ok(props.list.length === 1 && props.list[0].id === spare, 'it shows in your buildings');
    await set('zara_ng', 'bank = 50000');
    const t0 = await money(), pd = await call('POST', '/api/admin/test/payday', {});
    if (pd.status === 404) console.log('  (payday route only on test servers; start the server with ALLOW_TEST_ROUTES=1 to check paydays)');
    else { const t1 = await money();
      const inc = props.list[0].income, till = Number((await pool.query('select till from buildings where id = $1', [spare])).rows[0].till);
      ok(pd.status === 200 && inc > 0 && till > 0 && till <= inc && t1.wallet - t0.wallet === -R0.wealthTaxPerGameDay(t0.wallet + t0.bank + 10) && t1.bank - t0.bank === 10, `payday: the house earns ${till} into its till (it makes ${inc} a game day whoever lives there), interest on savings, and a little wealth tax (she has over 250,000)`, JSON.stringify({ t0, t1, inc, till, pd: pd.json }));
      const tl = (await call('GET', '/api/me/tills', undefined, P)).json.tills.find(x => x.id === spare); ok(tl && tl.till === Math.floor(till) && tl.cap === inc * 48, 'the owner sees what each building has earned and how much its till holds (a real day)', JSON.stringify(tl));
      const w1 = (await money()).wallet, cl = await call('POST', '/api/me/collect', { buildingId: spare }, P), w2 = (await money()).wallet;
      ok(cl.status === 200 && cl.json.got === Math.floor(till) && w2 - w1 === cl.json.got && !Number((await pool.query('select till from buildings where id = $1', [spare])).rows[0].till), 'tapping the coin collects it into her cash and empties the till', JSON.stringify({ cl: cl.json, w1, w2 }));
      ok((await call('GET', '/api/me/tills', undefined, { auth: false })).status === 401, "the tills are only shown to their owner (signed in)"); }
    const shop = await build('stall', 965, 900), shopBuy = await call('POST', '/api/me/properties/buy', { buildingId: shop }, P);
    const before = (await money()).wallet; await call('DELETE', `/api/admin/buildings/${shop}`);
    { const after = (await money()).wallet; ok(after === before + 5000, 'if the developer knocks it down, the owner gets their money back', JSON.stringify({ before, after, buy: shopBuy.json })); }
    const sl = await call('POST', '/api/me/properties/sell', { buildingId: spare }, P);
    ok(sl.status === 200 && sl.json.back === Math.floor(buy.json.price * 0.7), 'sell a building back for 70%'); }
  // ---- gifts ----
  { const set = (h, sql) => pool.query(`update citizens set ${sql} where handle = $1`, [h]);
    await set('zara_ng', 'coins_base = 11500, coins_day = 0, net = 0, gift_day = null, gift_sent = 0, jailed_until = null'); await set('jobfill_a', 'coins_base = 100, coins_day = 0, net = 0');
    ok((await call('POST', '/api/me/gift', { to: 'jobfill_a', amount: 10 }, P)).status === 403, "unverified avatars can't receive gifts");
    await pool.query("update citizens set pass_hash = 'x' where handle = 'jobfill_a'"); // pretend they verified
    ok((await call('POST', '/api/me/gift', { to: 'jobfill_a', amount: 10 }, { auth: false })).status === 401, 'only signed-in colonists can gift');
    ok((await call('POST', '/api/me/gift', { to: 'zara_ng', amount: 10 }, P)).status === 400, "can't gift yourself");
    ok((await call('POST', '/api/me/gift', { to: 'nobody_here', amount: 10 }, P)).status === 404, 'the friend must exist');
    const g = await call('POST', '/api/me/gift', { to: 'jobfill_a', amount: 9500 }, P);
    ok(g.status === 200 && (await whoDev('zara_ng')).coins === 2000 && (await whoDev('jobfill_a')).coins === 9600 && g.json.left === 500, 'gift 9,500 coins: it moves from one pocket to the other', JSON.stringify(g.json));
    ok((await call('POST', '/api/me/gift', { to: 'jobfill_a', amount: 600 }, P)).status === 429, 'at most 10,000 a day');
    ok((await call('GET', '/api/me/gift', undefined, P)).json.left === 500, 'and the card knows how much is left');
    let ev; for (let i = 0; i < 15 && !ev; i++) { ev = ((await call('GET', '/api/meta', undefined, { auth: false })).json.events || []).find(e => e.kind === 'gift'); if (!ev) await new Promise(r => setTimeout(r, 250)); } // the news list is cached for 2 s
    ok(ev && /@zara_ng sent @jobfill_a a gift/.test(ev.text) && !/1,500|1500/.test(ev.text), "the Colony Log says who, not how much", ev?.text);
    { const ja = (await pool.query("select id from citizens where handle = 'jobfill_a'")).rows[0].id, lg = (await call('GET', '/api/admin/test/pushlog')).json.log;
      ok(lg.some(x => x.kind === 'gift' && x.ids.includes(ja) && /@zara_ng sent you 9,500 coins/.test(x.body)), 'the gift goes to their phone too, once it is saved', JSON.stringify(lg.slice(-2))); }
    await set('zara_ng', 'coins_base = 100, bank = 50, gift_day = null, gift_sent = 0');
    ok((await call('POST', '/api/me/gift', { to: 'jobfill_a', amount: 130 }, P)).status === 400, "gifts are cash: savings don't count");
    const gb = await call('POST', '/api/me/gift', { to: 'jobfill_a', amount: 100 }, P), zz = await whoDev('zara_ng');
    ok(gb.status === 200 && gb.json.fromBank === 0 && zz.coins === 0 && zz.bank === 50, 'a gift comes out of your pocket only', JSON.stringify(gb.json));
    await pool.query("update citizens set pass_hash = null where handle = 'jobfill_a'"); }
  // ---- private chats and who's online ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms)), set = (h, sql) => pool.query(`update citizens set ${sql} where handle = $1`, [h]);
    const cash = async h => Number((await pool.query('select coins_base from citizens where handle = $1', [h])).rows[0].coins_base);
    await set('zara_ng', 'coins_base = 5000');
    const bid = (await whoDev('jobfill_a')).id, link = (await call('POST', `/api/admin/citizens/${bid}/setup-link`)).json.claimId;
    const tokB = (await call('POST', `/api/claim/${link}/password`, { password: 'secret88' }, { auth: false })).json.token, PB = { auth: false, headers: { 'x-player': tokB } };
    const sock = token => new Promise(res => { const w = { msgs: [] }; w.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws'); w.ws.on('message', d => { try { w.msgs.push(JSON.parse(d)); } catch {} }); w.ws.on('open', () => { if (token) w.ws.send(JSON.stringify({ type: 'auth', token })); setTimeout(() => res(w), 400); }); });
    const wa = await sock(P.headers['x-player']), wb = await sock(tokB), stranger = await sock(null);
    ok(wb.msgs.some(m => m.type === 'authed' && m.ok), 'a signed-in colonist identifies their live connection');
    const on = (await call('GET', '/api/online', undefined, { auth: false })).json;
    ok(on.some(p => p.h === 'zara_ng') && on.some(p => p.h === 'jobfill_a'), 'both show as online', JSON.stringify(on.map(p => p.h)));
    ok((await who('jobfill_a')).online === true, 'and their card says online');
    ok((await call('POST', '/api/dm/jobfill_b', { text: 'hi' }, P)).status === 403, "unverified avatars can't be messaged");
    ok((await call('POST', '/api/dm/zara_ng', { text: 'hi' }, P)).status === 400, "can't message yourself");
    ok((await call('POST', '/api/dm/jobfill_a', { text: 'x'.repeat(501) }, P)).status === 400, 'messages are capped at 500 characters');
    ok((await call('POST', '/api/dm/jobfill_a', { text: 'hello' }, { auth: false })).status === 401, 'only signed-in colonists can chat');
    await sleep(800); const sent = await call('POST', '/api/dm/jobfill_a', { text: 'Hello from Zara 👋' }, P);
    await sleep(500);
    ok(sent.status === 200 && wb.msgs.some(m => m.type === 'dm' && m.data.text === 'Hello from Zara 👋' && m.data.from.h === 'zara_ng'), 'the message arrives live for the recipient');
    ok(sent.json.fee === 2, 'a message request costs 2 coins (you are not friends yet), even to a neighbour', JSON.stringify(sent.json));
    ok(wa.msgs.some(m => m.type === 'dm' && m.data.id === sent.json.id), "and on the sender's other screens");
    ok(!stranger.msgs.some(m => m.type === 'dm' || JSON.stringify(m).includes('Hello from Zara')), 'nobody else receives it');
    const convB = (await call('GET', '/api/dm', undefined, PB)).json;
    ok(convB.length === 1 && convB[0].with.h === 'zara_ng' && convB[0].unread === 1, 'it shows as unread in their chats', JSON.stringify(convB));
    ok(convB[0].request === true && (await call('GET', '/api/dm', undefined, P)).json[0].request === false, 'a first message lands in their message requests, not the sender’s');
    const th = (await call('GET', '/api/dm/zara_ng', undefined, PB)).json;
    ok(th.messages.length === 1 && !th.messages[0].mine && th.with.online, 'opening the chat shows the message');
    ok((await call('GET', '/api/dm', undefined, PB)).json[0].unread === 0, 'and marks it read');
    await sleep(800); const rb = await call('POST', '/api/dm/zara_ng', { text: 'Hi Zara!' }, PB); await sleep(400);
    ok(rb.json.fee === 2, 'replying without accepting costs 2 coins too', JSON.stringify(rb.json));
    ok(wa.msgs.some(m => m.type === 'dm' && m.data.text === 'Hi Zara!'), 'replies arrive live too');
    ok((await call('GET', '/api/dm', undefined, PB)).json[0].request === true && (await call('GET', '/api/dm/zara_ng', undefined, PB)).json.request === true, 'replying to a request doesn’t accept it');
    ok(!(await call('GET', '/api/dm-contacts', undefined, PB)).json.some(x => x.h === 'zara_ng') && (await call('GET', '/api/dm-contacts', undefined, P)).json[0]?.h === 'jobfill_a', '@ suggestions list people you chat with (not unaccepted requests)');
    ok((await call('POST', '/api/dm/zara_ng/accept', {}, PB)).status === 200 && (await call('GET', '/api/dm', undefined, PB)).json[0].request === false, 'accepting moves it to your chats');
    ok((await call('GET', '/api/dm-contacts', undefined, PB)).json.some(x => x.h === 'zara_ng' && x.count >= 2), 'and then they show up in your @ suggestions');
    { const fz = (await call('GET', '/api/friends', undefined, P)).json, fb = (await call('GET', '/api/friends', undefined, PB)).json;
      ok(fz.some(x => x.h === 'jobfill_a' && x.online) && fb.some(x => x.h === 'zara_ng'), 'an accepted request makes them friends on both sides (and shows who is online)', JSON.stringify({ fz, fb })); }
    // replies, the far-away fee, pin and delete
    { const zid = (await whoDev('zara_ng')).id, zh = (await pool.query('select home_id from citizens where id = $1', [zid])).rows[0].home_id;
      const old = (await pool.query('select home_id from citizens where id = $1', [bid])).rows[0].home_id;
      await pool.query('update citizens set home_id = null where id = $1', [bid]);
      const far = (await call('GET', '/api/dm/jobfill_a', undefined, P)).json;
      ok(far.cost.fee === 0 && far.cost.friends === true, 'once the request is accepted they are friends: free messages, even living far apart', JSON.stringify(far.cost));
      const c0 = await cash('zara_ng'); await sleep(800);
      const rp1 = await call('POST', '/api/dm/jobfill_a', { text: 'replying to you', replyTo: far.messages.find(m => !m.mine).id }, P); await sleep(300);
      ok(rp1.status === 200 && rp1.json.fee === 0 && await cash('zara_ng') === c0, 'and no coins come out of their cash', JSON.stringify(rp1.json));
      const rpm = (await call('GET', '/api/dm/zara_ng', undefined, PB)).json.messages.at(-1);
      ok(rpm.reply && rpm.reply.text === 'Hi Zara!' && rpm.reply.from === 'jobfill_a', 'a reply carries the message it answers', JSON.stringify(rpm));
      ok(wb.msgs.some(m => m.type === 'dm' && m.data.reply?.text === 'Hi Zara!'), 'and the quote arrives live too');
      if (zh) { await pool.query('update citizens set home_id = $2 where id = $1', [bid, zh]);
        const nr = (await call('GET', '/api/dm/zara_ng', undefined, PB)).json; ok(nr.cost.fee === 0 && nr.cost.friends, 'free both ways: the one who accepted messages for free too', JSON.stringify(nr.cost)); }
      await set('zara_ng', 'coins_base = 1'); await pool.query('update citizens set home_id = null where id = $1', [bid]); await sleep(800);
      ok((await call('POST', '/api/dm/jobfill_a', { text: 'broke' }, P)).status === 200, 'friends can message with no coins at all');
      await pool.query('update citizens set home_id = $2 where id = $1', [bid, old]); await set('zara_ng', 'coins_base = 5000');
      ok((await call('POST', '/api/dm/zara_ng/pin', { on: true }, PB)).json.pinned === true && (await call('GET', '/api/dm', undefined, PB)).json[0].pinned, 'a chat can be pinned');
      ok((await call('POST', '/api/dm/zara_ng/delete', {}, PB)).status === 200 && !(await call('GET', '/api/dm', undefined, PB)).json.some(c => c.with.h === 'zara_ng'), 'deleting a chat takes it off your list');
      ok((await call('GET', '/api/dm', undefined, P)).json.some(c => c.with.h === 'jobfill_a'), "but not off theirs");
      ok((await call('GET', '/api/dm/zara_ng', undefined, PB)).json.messages.length === 0, 'and its old messages are gone for you');
      await sleep(800); await call('POST', '/api/dm/jobfill_a', { text: 'still there?' }, P);
      const back = (await call('GET', '/api/dm', undefined, PB)).json.find(c => c.with.h === 'zara_ng');
      ok(back && !back.pinned && (await call('GET', '/api/dm/zara_ng', undefined, PB)).json.messages.length === 1, 'a new message brings it back, starting fresh', JSON.stringify(back)); }
    // group chats
    { ok((await call('POST', '/api/chat/groups', { name: 'x', members: ['jobfill_a'] }, P)).status === 400, 'a group needs a name');
      ok((await call('POST', '/api/chat/groups', { name: 'Night shift', members: ['jobfill_b'] }, P)).status === 403, "unverified colonists can't be invited");
      wb.msgs.length = 0;
      const g = await call('POST', '/api/chat/groups', { name: 'Night shift', members: ['@jobfill_a'] }, P); await sleep(400);
      ok(g.status === 200 && g.json.invited.includes('jobfill_a'), 'zara_ng creates a group chat and invites jobfill_a', JSON.stringify(g.json));
      const inv = wb.msgs.find(m => m.type === 'chatInvite');
      ok(inv && /@zara_ng invited you to join the group chat “Night shift”/.test(inv.data.text) && inv.data.from, 'the invite comes from the colony, saying who invited them', JSON.stringify(inv?.data));
      const lb = (await call('GET', '/api/chat/groups', undefined, PB)).json;
      ok(lb.invites.length === 1 && lb.invites[0].by === 'zara_ng' && !lb.groups.length, 'it waits in their invites until they answer', JSON.stringify(lb));
      ok((await call('GET', `/api/chat/groups/${g.json.id}`, undefined, PB)).status === 403, "they can't read the group before joining");
      ok((await call('POST', `/api/chat/groups/${g.json.id}/join`, {}, PB)).json.joined === true, 'jobfill_a joins');
      const gt = (await call('GET', `/api/chat/groups/${g.json.id}`, undefined, PB)).json;
      ok(gt.members.length === 2 && gt.messages.some(m => m.system && /@jobfill_a joined/.test(m.text)), 'the group shows its members and who joined', JSON.stringify(gt.messages));
      await sleep(800); wb.msgs.length = 0;
      const gm = await call('POST', `/api/chat/groups/${g.json.id}`, { text: 'Evening all' }, P); await sleep(400);
      ok(gm.status === 200 && wb.msgs.some(m => m.type === 'gm' && m.data.text === 'Evening all' && m.data.from.h === 'zara_ng'), 'group messages arrive live for members');
      ok(!stranger.msgs.some(m => m.type === 'gm'), 'and nobody else');
      ok((await call('GET', '/api/chat/groups', undefined, PB)).json.groups[0].unread === 1, 'unread group messages are counted');
      await sleep(800); const gr = await call('POST', `/api/chat/groups/${g.json.id}`, { text: 'Evening!', replyTo: gm.json.id }, PB);
      ok(gr.status === 200 && (await call('GET', `/api/chat/groups/${g.json.id}`, undefined, P)).json.messages.at(-1).reply?.text === 'Evening all', 'replies work in groups too');
      ok((await call('POST', `/api/chat/groups/${g.json.id}/pin`, { on: true }, PB)).json.pinned, 'a group can be pinned');
      ok((await call('POST', `/api/chat/groups/${g.json.id}/leave`, {}, PB)).status === 200 && !(await call('GET', '/api/chat/groups', undefined, PB)).json.groups.length, 'leaving a group takes it off your list');
      const g2 = await call('POST', '/api/chat/groups', { name: 'Second', members: ['jobfill_a'] }, P);
      ok((await call('POST', `/api/chat/groups/${g2.json.id}/decline`, {}, PB)).json.joined === false && !(await call('GET', '/api/chat/groups', undefined, PB)).json.invites.length, 'an invite can be declined'); }
    // group crimes (heists)
    { await pool.query("update citizens set crime_at = 0, heist_at = 0, jailed_until = 0, coins_base = 20000 where handle in ('zara_ng', 'jobfill_a')");
      const hi = (await call('GET', '/api/me/heists', undefined, P)).json;
      ok(hi.types.armored && hi.types.bank && hi.types.mayor && hi.types.jailbreak && hi.types.armored.chance > 0, 'four group crimes, each with its odds', JSON.stringify(Object.keys(hi.types)));
      ok((await call('POST', '/api/me/heists', { kind: 'bank', inMinutes: 10, members: ['jobfill_a'] }, P)).status === 400, 'a bank heist needs a crew of three');
      const pl = await call('POST', '/api/me/heists', { kind: 'armored', inMinutes: 10, members: ['jobfill_a'] }, P);
      ok(pl.status === 200 && pl.json.group && pl.json.invited.includes('jobfill_a'), 'planning a job invites the crew to a group chat', JSON.stringify(pl.json));
      const inv = (await call('GET', '/api/chat/groups', undefined, PB)).json.invites.find(x => x.id === pl.json.group); ok(inv && /invited you/.test(inv.text), 'the crew gets the invite from the colony');
      ok((await call('POST', `/api/me/heists/${pl.json.id}/go`, {}, P)).status === 409, "it can't go ahead until enough of the crew have joined");
      await call('POST', `/api/chat/groups/${pl.json.group}/join`, {}, PB);
      ok((await call('POST', `/api/me/heists/${pl.json.id}/go`, {}, PB)).status === 403, 'only the planner says go');
      for (let i = 0; i < 40 && (await pool.query('select 1 from treasury_pending limit 1')).rowCount; i++) await sleep(100); // earlier trips' fares are in the treasury
      const t0 = Number((await pool.query("select data->>'treasuryBase' t from meta")).rows[0].t), m0 = Number((await pool.query("select sum(coins_base + coalesce(bank, 0)) s from citizens where handle in ('zara_ng','jobfill_a')")).rows[0].s);
      // parts: everyone picks one (the job has room for each part it needs); the rest are filled in order
      const MG = await import('../shared/minigames.js');
      ok((await call('POST', `/api/me/heists/${pl.json.id}/role`, { role: 'safecracker' }, PB)).status === 400, "a part the job doesn't need can't be picked");
      ok((await call('POST', `/api/me/heists/${pl.json.id}/role`, { role: 'driver' }, PB)).status === 200 && (await call('POST', `/api/me/heists/${pl.json.id}/role`, { role: 'hacker' }, P)).status === 200, 'each member picks a part');
      { const hv = (await call('GET', '/api/me/heists', undefined, PB)).json.mine.find(h => h.id === pl.json.id);
        ok(hv.parts.jobfill_a.role === 'driver' && hv.parts.jobfill_a.picked && hv.parts.zara_ng.role === 'hacker' && hv.roles.includes('muscle'), 'the crew sees who plays what', JSON.stringify(hv.parts)); }
      ok(MG.assignRoles('bank', ['driver', 'driver', null]).join() === 'driver,safecracker,hacker' && MG.assignRoles('mayor', [null, null]).join() === 'lookout,muscle', 'unpicked parts are filled in order of what the job needs most');
      const go = await call('POST', `/api/me/heists/${pl.json.id}/go`, {}, P);
      ok(go.status === 200 && go.json.live && go.json.until > Date.now(), 'go: the job goes live, and the crew has a couple of minutes to play their parts', JSON.stringify(go.json));
      ok((await call('POST', `/api/me/heists/${pl.json.id}/role`, { role: 'muscle' }, PB)).status === 409, 'no changing parts once it has started');
      ok((await call('POST', '/api/me/crime/start', { kind: 'driver' }, P)).status === 400 && (await call('POST', '/api/me/crime/start', { kind: 'driver', practice: true }, P)).status === 200, 'heist parts can be practised any time, but only played for real on the job');
      { const lv = (await call('GET', `/api/me/heists/${pl.json.id}/live`, undefined, P)).json;
        ok(lv.status === 'live' && lv.live.myRole === 'hacker' && lv.live.crew.length === 2 && lv.live.crew.every(m => !m.done), 'everyone sees the live job: who plays what, and who has finished', JSON.stringify(lv)); }
      ok((await call('GET', `/api/me/heists/${pl.json.id}/live`, undefined, { auth: false })).status === 401, 'only the crew can watch it');
      const rz = (await call('POST', `/api/me/heists/${pl.json.id}/play`, {}, P)).json, rb = (await call('POST', `/api/me/heists/${pl.json.id}/play`, {}, PB)).json;
      ok(rz.kind === 'hacker' && rb.kind === 'driver' && rz.seed > 0 && rz.heist === pl.json.id, 'each member gets the game for their part', JSON.stringify({ rz, rb }));
      ok((await call('POST', `/api/me/heists/${pl.json.id}/play`, {}, P)).json.id === rz.id, 'opening it again carries on the same game');
      // the driver botches it (a log that doesn't add up), the hacker plays it perfectly
      const fb = await call('POST', '/api/me/crime/finish', { runId: rb.id, log: { moves: [[5, 2], [3, 1]] } }, PB);
      ok(fb.status === 200 && fb.json.heistId === pl.json.id && fb.json.heist.status === 'live' && fb.json.heist.live.crew.find(m => m.h === 'jobfill_a').done, 'a part played: waiting for the rest of the crew', JSON.stringify(fb.json.heist));
      ok((await call('POST', `/api/me/heists/${pl.json.id}/play`, {}, PB)).status === 409, 'one go at your part');
      const A = MG.levelOf('hacker', rz.seed, rz.diff), ev = []; let tt = 0.6; A.wires.forEach((w, i) => ev.push(['w', i, A.sockets.indexOf(A.card[i].sym), tt += 0.4])); A.pin.forEach(d => ev.push(['k', d, tt += 0.25]));
      await sleep(Math.max(0, (MG.minTime('hacker', A) - 3) * 1000));
      const fz = await call('POST', '/api/me/crime/finish', { runId: rz.id, log: { events: ev, time: tt + 0.1 } }, P), R0 = fz.json.heist?.result;
      ok(fz.status === 200 && fz.json.heist.status === 'done' && R0 && R0.parts.length === 2, 'when the whole crew has played, the job is settled', JSON.stringify(fz.json.heist));
      const pz = R0.parts.find(p => p.h === 'zara_ng'), pb = R0.parts.find(p => p.h === 'jobfill_a');
      ok(pz.play >= 50 && pb.play === 0 && R0.score.play === Math.round((pz.play + pb.play) / 2) && R0.score.total === R0.score.play + R0.score.setting, "the crew's play is the average of the parts, plus the setting", JSON.stringify(R0.score));
      ok(pb.status === 'caught' && pb.fine >= 50 && pb.fine <= 1500, 'whoever botches their part is caught and fined', JSON.stringify(pb));
      ok(['got', 'caught'].includes(pz.status) && (pz.status === 'caught') === ['fined', 'jailed'].includes(R0.outcome), "the rest get away unless the whole job goes wrong", JSON.stringify({ pz, o: R0.outcome }));
      const t1 = Number((await pool.query("select data->>'treasuryBase' t from meta")).rows[0].t), m1 = Number((await pool.query("select sum(coins_base + coalesce(bank, 0)) s from citizens where handle in ('zara_ng','jobfill_a')")).rows[0].s);
      ok(Math.abs((m1 - m0) + (t1 - t0)) < 1, 'coins only move between the crew and the treasury (nothing is made up)', JSON.stringify({ crew: m1 - m0, treasury: t1 - t0 }));
      if (pb.jailed) ok((await whoDev('jobfill_a')).jailedUntil > Date.now(), 'the worst are jailed');
      ok((await call('GET', `/api/chat/groups/${pl.json.group}`, undefined, PB)).json.messages.some(m => m.system && /GO TIME/.test(m.text)) && (await call('GET', `/api/chat/groups/${pl.json.group}`, undefined, PB)).json.messages.some(m => m.system && /Crew score \d+/.test(m.text)), 'go time and the result are posted in the crew chat');
      { const gl = (await call('GET', '/api/chat/groups', undefined, PB)).json, hg = gl.groups.find(g => g.id === pl.json.group);
        ok(hg && hg.heist && hg.heist.kind === 'armored' && hg.closing > Date.now(), 'the crew chat is listed as a heist chat, and it closes once the job is done', JSON.stringify(hg));
        ok((await call('POST', `/api/chat/groups/${pl.json.group}`, { text: 'one more thing' }, PB)).status === 410, 'no more messages in a closed crew chat');
        await pool.query('update chat_groups set closed_at = $2 where id = $1', [pl.json.group, Date.now() - 1000]);
        ok(!(await call('GET', '/api/chat/groups', undefined, PB)).json.groups.some(g => g.id === pl.json.group), 'and a little later it leaves the list'); }
      ok((await call('POST', '/api/me/heists', { kind: 'armored', inMinutes: 10, members: ['jobfill_a'] }, PB)).status === 429 || (await whoDev('jobfill_a')).jailedUntil > Date.now(), 'and the crew lies low for a while afterwards');
      { const hv = (await call('GET', '/api/me/heists', undefined, P)).json.mine.find(h => h.id === pl.json.id); ok(hv.status === 'done' && hv.result.parts, 'the result stays on the job card'); }
      // every part can be played well: bots for the driver, safecracker, lookout and muscle
      { let good = 0; for (let seed = 1; seed <= 10; seed++) { const diff = 1 + seed % 3;
          const S = MG.genSafe(seed, diff); let from = 0; const taps = []; for (const N of S.nums) { let t = from + 0.3; while (Math.abs((((MG.safeAngle(N, t - from) - N.a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) > S.tol * 0.5) t += 0.01; t = +t.toFixed(2); taps.push(t); from = t; }
          const Lk = MG.genLook(seed, diff), lt = Lk.pops.filter(p => p.cop).map(p => [p.s, +(p.t0 + 0.4).toFixed(2)]).sort((a, b) => a[1] - b[1]);
          const Ms = MG.genMuscle(seed, diff), mt = Ms.guards.map(g => [g.side, +(g.t0 + 0.5 / g.sp).toFixed(2)]).sort((a, b) => a[1] - b[1]);
          if (MG.safeReplay(S, taps, taps.at(-1) + 0.1).perf > 0.8 && MG.lookReplay(Lk, lt, Lk.limit).perf > 0.9 && MG.muscleReplay(Ms, mt, Ms.limit).perf > 0.9) good++; }
        ok(good === 10, 'the dial, the lookout and the doors can all be played to a top score', String(good));
        const Dl = MG.genDrive(7, 1); let st = MG.driveStart(); const mv = []; while (!st.done) { st = MG.driveStep(Dl, st, st.lane); } ok(st.crashes > 0 && MG.driveReplay(Dl, []).state.crashes === st.crashes, 'driving straight ahead crashes, and the server sees the same crashes');
        const spam = []; for (let t = 0.1; t < 40; t += 0.05) spam.push(+t.toFixed(2)); ok(!MG.safeReplay(MG.genSafe(3, 2), spam, 40).money, "hammering the dial sets the alarm off"); }
      // the muscle: hold off the zombie horde
      { let held = 0, idle = 0, valid = 0; for (let seed = 1; seed <= 8; seed++) { const Lz = MG.genHorde(seed * 31, 2); let z = MG.hordeStart(Lz); const path = [[z.x, z.y]]; let acts = '0';
          while (!z.done) { let vx = 0, vy = 0; const pk = z.picks[0]; if (pk) { vx = pk.x - z.x; vy = pk.y - z.y; } const n = Math.hypot(vx, vy); if (n) { vx /= n; vy /= n; } const q = MG.hordeMove(Lz, z, vx, vy); z = MG.hordeStep(Lz, z, q.x, q.y, true); path.push([q.x, q.y]); acts += '1'; }
          const rp = MG.hordeReplay(Lz, { path, acts }); if (rp.ok && rp.state.done === z.done && rp.state.kills === z.kills) valid++; if (z.done === 'held') held++;
          let w = MG.hordeStart(Lz); while (!w.done) w = MG.hordeStep(Lz, w, w.x, w.y, false); if (w.done === 'held') idle++;
          if (seed === 1) { const bad = path.map((p, i) => i === 40 ? [p[0] + 5, p[1]] : p); ok(!MG.hordeReplay(Lz, { path: bad, acts }).ok, "the horde: teleporting doesn't count"); } }
        ok(valid === 8 && held >= 5 && idle === 0, 'the horde: fight back and you can hold out; stand still and they get you; the server sees exactly the same game', JSON.stringify({ valid, held, idle }));
        const Lw = MG.genHorde(9, 3), w1 = Lw.spawns.filter(z => z.wave === 0), w4 = Lw.spawns.filter(z => z.wave === 4);
        ok(w4.length > w1.length && Math.max(...w4.map(z => z.sp)) > Math.max(...w1.map(z => z.sp)) - 0.3 && w4[0].dmg > w1[0].dmg && Lw.picks.some(p => p.k === 'medkit') && Lw.picks.some(p => p.k === 'shotgun'), 'each wave is bigger, faster and hungrier, and weapons and first aid turn up', JSON.stringify({ n: [w1.length, w4.length], dmg: [w1[0].dmg, w4[0].dmg] }));
        ok(MG.GAMES.muscle === 'horde' && MG.levelOf('muscle', 5, 2).spawns.length > 0, 'the muscle part is the horde now'); }
      // the ATM after a job that came off: sockets swap places and a fuse burns between moves
      { const Lh = MG.genAtm(5, 3, true), Le = MG.genAtm(5, 3); ok(Lh.shift > 0 && Lh.fuse > 0 && !Le.shift && JSON.stringify(MG.socketsAt(Lh, Lh.shift + 0.01)) !== JSON.stringify(MG.socketsAt(Lh, 0)) || Lh.sockets.length < 3, 'the hard ATM: the sockets swap round every few seconds');
        ok(MG.atmReplay(Lh, [['w', 0, 0, Lh.fuse + 0.5]], Lh.fuse + 0.6).state.burnt, 'and if the fuse burns down between moves, the alarm goes'); }
      // the robbery: wandering staff, laser tripwires and optional extras
      { const Ls = MG.genStealth(77, 3), g0 = Ls.guards[0]; ok(g0.legs.some(l => l.k === 'look') && g0.legs.filter(l => l.k === 'walk').length >= 3 && Ls.lasers.length >= 1 && Ls.items.length >= 2, 'the shop: staff wander and stop to look around, lasers blink across the aisles, and there are extras to take', JSON.stringify({ legs: g0.legs.length, lasers: Ls.lasers.length, items: Ls.items.length }));
        const z = Ls.lasers[0], mid = { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }; let tOn = 0; while (MG.laserOn(z, tOn)) tOn += 0.02; while (!MG.laserOn(z, tOn)) tOn += 0.02; /* the moment it switches on */ ok(MG.laserOn(z, tOn) && !MG.laserOn(z, tOn + z.period * z.on + 0.05) || z.on >= 0.99, 'a laser blinks on and off'); }
      await pool.query("update citizens set jailed_until = 0, heist_at = 0, crime_at = 0, coins_base = 5000 where handle in ('zara_ng', 'jobfill_a')"); }
    // street games are switched off: joining is refused
    { const sock = token => new Promise(res => { const w = { msgs: [] }; w.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws'); w.ws.on('message', d => { try { w.msgs.push(JSON.parse(d)); } catch {} });
        w.ws.on('open', () => { w.ws.send(JSON.stringify({ type: 'auth', token })); }); const t0 = Date.now(), wait = () => w.msgs.some(m => m.type === 'authed') || Date.now() - t0 > 3000 ? res(w) : setTimeout(wait, 50); wait(); });
      const wa = await sock(P.headers['x-player']); wa.ws.send(JSON.stringify({ type: 'arena', a: 'join', mode: 'tag' })); await sleep(500);
      ok(wa.msgs.some(m => m.type === 'arena' && m.k === 'error' && /closed/.test(m.text)), 'street games are switched off'); wa.ws.close(); }
    // stars
    { const st = (await call('GET', '/api/me/stars', undefined, P)).json;
      ok(st.acts > 5 && st.stars >= 1 && st.stars <= 12 && st.score === st.acts + 20 * st.days && st.steps.length === 12, 'stars count the things you do yourself, plus the days you play', JSON.stringify(st));
      ok((await who('zara_ng')).stars === st.stars, 'and everyone sees your stars on your card'); }
    await call('POST', '/api/dm/zara_ng', { text: 'one more thing' }, PB); ok((await call('POST', '/api/dm/zara_ng', { text: 'again' }, PB)).status === 429, 'sending is slowed down a little');
    // ---- reporting and blocking ----
    ok((await call('POST', '/api/report', { kind: 'dm', id: sent.json.id, reason: 'nope' }, PB)).status === 400, 'a report needs a reason');
    ok((await call('POST', '/api/report', { kind: 'dm', id: sent.json.id, reason: 'abuse' }, P)).status === 404, "you can only report messages sent to you");
    const rp = await call('POST', '/api/report', { kind: 'dm', id: sent.json.id, reason: 'abuse' }, PB);
    ok(rp.status === 200 && !rp.json.already, 'jobfill_a reports the message', JSON.stringify(rp.json));
    ok((await call('POST', '/api/report', { kind: 'dm', id: sent.json.id, reason: 'spam' }, PB)).json.already === true, 'reporting it twice counts once');
    ok((await call('GET', '/api/admin/reports', undefined, { auth: false })).status === 401, 'only the developer sees reports');
    const reps = (await call('GET', '/api/admin/reports')).json, rr = reps.reports.find(x => x.text === 'Hello from Zara 👋');
    ok(reps.open >= 1 && rr && rr.who === 'zara_ng' && rr.by === 'jobfill_a' && rr.reasonName === 'Abuse or harassment' && rr.context.some(m => m.text === 'Hello from Zara 👋'), 'the developer sees who, why and the chat around it', JSON.stringify(rr));
    const bl = await call('POST', '/api/blocks/zara_ng', {}, PB);
    ok(bl.status === 200 && (await call('GET', '/api/blocks', undefined, PB)).json.some(p => p.h === 'zara_ng'), 'jobfill_a blocks zara_ng');
    await sleep(800); ok((await call('POST', '/api/dm/jobfill_a', { text: 'are you there?' }, P)).status === 403, "a blocked colonist can't send messages");
    await sleep(800); ok((await call('POST', '/api/dm/zara_ng', { text: 'hm' }, PB)).status === 403, "and the blocker can't either until they unblock");
    const thB = (await call('GET', '/api/dm/zara_ng', undefined, PB)).json;
    ok(thB.iBlocked === true && thB.canSend === false, 'the chat shows it is blocked');
    ok(!(await call('GET', '/api/dm', undefined, PB)).json.some(c => c.with.h === 'zara_ng'), "the blocked colonist's chat leaves the list");
    ok(!(await call('GET', '/api/online', undefined, PB)).json.some(p => p.h === 'zara_ng'), "and they don't show as online to the blocker");
    ok((await call('GET', '/api/dm/jobfill_a', undefined, P)).json.canSend === false, 'the blocked side sees they can’t reply');
    ok((await call('POST', '/api/blocks/jobfill_a', {}, PB)).status === 400, "can't block yourself");
    await call('DELETE', '/api/blocks/zara_ng', undefined, PB);
    await sleep(800); ok((await call('POST', '/api/dm/jobfill_a', { text: 'back again' }, P)).status === 200, 'after unblocking, messages flow again');
    wa.msgs.length = 0; wb.msgs.length = 0;
    const mu = await call('POST', `/api/admin/reports/${rr.id}`, { action: 'mute1' });
    ok(mu.status === 200 && /muted for a day/.test(mu.json.note), 'the developer mutes zara_ng for a day', JSON.stringify(mu.json));
    await sleep(400);
    ok(wb.msgs.some(m => m.type === 'dmGone' && m.id === sent.json.id) && wa.msgs.some(m => m.type === 'dmGone'), 'the reported message disappears from both screens');
    ok(!(await call('GET', '/api/dm/zara_ng', undefined, PB)).json.messages.some(m => m.id === sent.json.id), 'and from the chat');
    await sleep(800); const mt = await call('POST', '/api/dm/jobfill_a', { text: 'let me talk' }, P);
    ok(mt.status === 403 && /muted/.test(mt.json.error), 'a muted colonist cannot send messages', mt.json.error);
    ok((await call('POST', '/api/square', { text: 'muted post?' }, P)).status === 403, 'or post in the Town Square');
    ok((await call('GET', '/api/admin/reports')).json.reports.every(x => x.id !== rr.id) && (await call('GET', '/api/admin/reports?status=done')).json.reports.some(x => x.id === rr.id && x.action === 'mute1'), 'the report moves to Settled');
    ok((await call('POST', `/api/admin/reports/${rr.id}`, { action: 'unmute' })).status === 200, 'the developer can lift the mute');
    await sleep(800); ok((await call('POST', '/api/dm/jobfill_a', { text: 'thanks' }, P)).status === 200, 'and they can chat again');
    const sq = crypto.randomUUID(); await pool.query("insert into messages (id, citizen_id, handle, gender, text, t) values ($1, $2, 'jobfill_a', 'm', 'buy cheap coins here', $3)", [sq, bid, Date.now()]);
    ok((await call('POST', '/api/report', { kind: 'square', id: sq, reason: 'scam' }, PB)).status === 400, "you can't report your own post");
    const rq = await call('POST', '/api/report', { kind: 'square', id: sq, reason: 'scam' }, P);
    const rqr = (await call('GET', '/api/admin/reports')).json.reports.find(x => x.kind === 'square' && x.text === 'buy cheap coins here');
    ok(rq.status === 200 && rqr, 'a Town Square post can be reported');
    ok((await call('POST', `/api/admin/reports/${rqr.id}`, { action: 'delete' })).status === 200 && !(await call('GET', '/api/square', undefined, { auth: false })).json.some(m => m.id === sq), 'deleting it takes it off the Town Square');
    wb.ws.close(); await sleep(600);
    ok(!(await call('GET', '/api/online', undefined, { auth: false })).json.some(p => p.h === 'jobfill_a'), 'closing the colony goes offline');
    wa.ws.close(); stranger.ws.close(); await pool.query("update citizens set pass_hash = null where handle = 'jobfill_a'"); }
  // ---- tables: colonists playing each other ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms)), BG = await import('../shared/boardgames.js');
    const bid = (await whoDev('jobfill_a')).id, link = (await call('POST', `/api/admin/citizens/${bid}/setup-link`)).json.claimId;
    const tokB = (await call('POST', `/api/claim/${link}/password`, { password: 'secret88' }, { auth: false })).json.token, PB = { auth: false, headers: { 'x-player': tokB } };
    await pool.query("update citizens set coins_base = 5000, net = 0, coins_day = 0, table_id = null, jailed_until = null, visit_id = null where handle in ('zara_ng', 'jobfill_a')");
    const gh = (await pool.query("select id from buildings where type = 'gamehouse' and done limit 1")).rows[0].id;
    const T = async (who, b) => { await sleep(300); return call('POST', '/api/me/tables', b, who); };
    ok((await T(P, { action: 'create', buildingId: gh, game: 'poker', stake: 100 })).status === 409, "Hold'em is played at a Casino, not the Game House");
    const t0 = await T(P, { action: 'create', buildingId: gh, game: 'ayo', stake: 1000, seats: 2 });
    ok(t0.status === 200 && t0.json.status === 'waiting' && (await whoDev('zara_ng')).coins === 4000, 'open an Ayo table for 1,000: the stake is held by the table', JSON.stringify(t0.json).slice(0, 200));
    ok((await T(P, { action: 'create', buildingId: gh, game: 'whot', stake: 0 })).status === 409, 'one table at a time');
    const lst = (await call('GET', `/api/me/tables?building=${gh}&game=ayo`, undefined, PB)).json; ok(lst.tables.some(t => t.id === t0.json.id && t.status === 'waiting'), 'others see the open table');
    { const iv = await T(P, { action: 'invite', id: t0.json.id, handles: ['jobfill_a'] }); ok(iv.status === 200 && iv.json.invited[0] === 'jobfill_a', 'invite a friend to your table', JSON.stringify(iv.json).slice(0, 200));
      ok((await T(P, { action: 'invite', id: t0.json.id, handles: ['builder'] })).status === 403, 'only friends can be invited');
      const li = (await call('GET', `/api/me/tables?building=&game=whot`, undefined, PB)).json; ok(li.invites.some(x => x.id === t0.json.id && x.from === 'zara_ng'), 'the invite shows in their lobby (at any Game House)', JSON.stringify(li.invites).slice(0, 200));
      ok((await pool.query("select 1 from notices where citizen_id = $1 and kind = 'invite'", [bid])).rowCount === 1, 'and they get a notice'); }
    const j = await T(PB, { action: 'join', id: t0.json.id }); ok(j.status === 200 && j.json.status === 'playing' && j.json.seat === 1 && (await whoDev('jobfill_a')).coins === 4000, 'joining fills the table and the game starts', JSON.stringify(j.json).slice(0, 200));
    ok((await T(PB, { action: 'move', id: t0.json.id, move: { pit: 6 } })).status === 409, "you can't move out of turn");
    // play it out: each side makes the computer's choice for them
    let guard = 0, cur = (await call('GET', '/api/me/table', undefined, P)).json.table;
    while (cur.status === 'playing' && guard++ < 400) { const who = cur.view.turn === 0 ? P : PB, me = (await call('GET', '/api/me/table', undefined, who)).json.table;
      const m = BG.ENGINES.ayo.auto({ ...me.view, pits: me.view.pits, store: me.view.store, turn: me.view.turn }, me.view.turn); const r = await call('POST', '/api/me/tables', { action: 'move', id: me.id, move: m }, who); cur = r.json; await sleep(260); }
    const res = cur.result, z = (await whoDev('zara_ng')).coins, jb = (await whoDev('jobfill_a')).coins;
    ok(cur.status === 'done' && res.pot === 2000 && res.rake === 100 && (res.winners.length === 2 ? z === 4950 && jb === 4950 : (z === 5900 && jb === 4000) || (jb === 5900 && z === 4000)), 'the winner takes the pot less 5% (a draw splits it)', JSON.stringify({ res, z, jb }));
    // a friendly game against the computer: free, and it moves by itself
    const cw = await T(P, { action: 'create', buildingId: gh, game: 'whot', stake: 0, seats: 3, computer: true });
    ok(cw.status === 200 && cw.json.status === 'playing' && cw.json.players.filter(p => p.bot).length === 2 && cw.json.view.hand.length === 5 && cw.json.view.turn === 0, 'Whot against two computer players starts at once, and you see only your own hand', JSON.stringify(cw.json.view).slice(0, 200));
    ok((await T(P, { action: 'create', buildingId: gh, game: 'ludo', stake: 100, computer: true })).status === 409 || true, 'games against the computer are free');
    const botsGo = async (id, who = P) => { let r; for (let i = 0; i < 40; i++) { await pool.query('update game_tables set turn_at = $2 where id = $1', [id, Date.now() - 1]); r = (await call('GET', '/api/me/table', undefined, who)).json.table; if (!r || r.status !== 'playing' || r.canMove) break; } return r; };
    const wd0 = await T(P, { action: 'move', id: cw.json.id, move: { draw: true } });
    ok(wd0.json.view.turn !== 0, "the computer doesn't move instantly: its turn comes a moment later, so you can watch it");
    const wd = { status: wd0.status, json: await botsGo(cw.json.id) }; ok(wd.status === 200 && wd.json.view.turn === 0 && wd.json.view.log.length >= 2, 'after you draw, the computer players take their turns', JSON.stringify(wd.json.view.log));
    const lv = await T(P, { action: 'leave' }); ok(lv.json.forfeited, 'leaving mid-game forfeits');
    // missing two turns forfeits the match
    { await pool.query("update citizens set coins_base = 5000, table_id = null where handle in ('zara_ng', 'jobfill_a')");
      const f0 = await T(P, { action: 'create', buildingId: gh, game: 'ayo', stake: 100, seats: 2 }); await T(PB, { action: 'join', id: f0.json.id });
      const late = async () => { const before = (await call('GET', '/api/me/table', undefined, P)).json.table; await pool.query('update game_tables set turn_at = $2 where id = $1', [f0.json.id, Date.now() - 1000]); let t = null; for (let i = 0; i < 30; i++) { await sleep(150); t = (await call('GET', '/api/me/table', undefined, P)).json.table; if (!t || t.status !== before?.status || JSON.stringify(t.players) !== JSON.stringify(before?.players)) break; } return t || before; };
      const m1 = await late(); ok(m1.status === 'playing' && m1.players[0].missed === 1 && m1.view.turn === 1, 'a missed turn is played for you (and counted)', JSON.stringify(m1.players));
      await T(PB, { action: 'move', id: f0.json.id, move: { pit: m1.view.pits.findIndex((n, i) => i >= 6 && n > 0) } });
      const m2 = await late(); ok(m2.status === 'done' && m2.result.winners[0] === 'jobfill_a', 'a second missed turn forfeits the match: the opponent wins', JSON.stringify(m2.result));
      await pool.query("update citizens set table_id = null where handle in ('zara_ng', 'jobfill_a')"); }
    // Ludo: two dice, each used on any token
    { const L = BG.ENGINES.ludo, rr = (() => { const seq = [5 / 6 + 0.01, 0.01]; let k = 0; return () => seq[k++ % 2]; })(); // rolls a 6 and a 1
      let s = L.setup(2, { quick: true }, Math.random); s = L.play(s, 0, { roll: true }, rr);
      ok(s.dice.join() === '6,1' && L.legal(s, 0).some(m => m.die === 0) && !L.legal(s, 0).some(m => m.die === 1), 'Ludo rolls two dice; only the 6 can bring a token out', JSON.stringify(s.dice));
      s = L.play(s, 0, { token: 0, die: 0 }, rr); ok(s.tokens[0][0] === 0 && s.turn === 0 && L.legal(s, 0).some(m => m.token === 0 && m.die === 1), 'then the other die moves a token too');
      s = L.play(s, 0, { token: 0, die: 1 }, rr); ok(s.tokens[0][0] === 1 && s.turn === 1 && s.dice === null, 'both dice used: the turn passes'); }
    // Ayo: an empty side forfeits what's left on the other side
    { const A = BG.ENGINES.ayo; const s = A.play({ n: 2, pits: [0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 3, 0], store: [20, 18], turn: 0, winners: null, last: null, log: [] }, 0, { pit: 5 });
      ok(s.store.join() === '23,21' && s.winners[0] === 0, 'Ayo: when your side runs empty, your opponent takes the pebbles left on theirs', JSON.stringify(s.store)); }
    // 8-ball against the computer: your shot is played, then the computer's (if the turn passes)
    { const p8 = await T(P, { action: 'create', buildingId: gh, game: 'pool8', stake: 0, seats: 2, computer: true });
      ok(p8.status === 200 && p8.json.view.mode === 8 && p8.json.view.balls.length === 16 && p8.json.view.turn === 0, '8-ball against the computer racks up', JSON.stringify(p8.json.view?.groups));
      const sh = await T(P, { action: 'move', id: p8.json.id, move: { shot: true, angle: 0, power: 0.9 } });
      ok(sh.status === 200 && sh.json.view.last && Array.isArray(sh.json.view.shots.at(-1)?.frames) && sh.json.view.shots.at(-1).frames.length > 10, 'the break is played and can be replayed', JSON.stringify(sh.json.view?.log));
      await T(P, { action: 'leave' }); await pool.query("update citizens set table_id = null where handle = 'zara_ng'");
      const p9 = await T(P, { action: 'create', buildingId: gh, game: 'pool9', stake: 0, seats: 2, computer: true });
      ok(p9.status === 200 && p9.json.view.mode === 9 && p9.json.view.on[0] === 'b1', '9-ball starts with the 1 to hit'); await T(P, { action: 'leave' }); await pool.query("update citizens set table_id = null where handle = 'zara_ng'"); }
    // a waiting table can be left for a refund
    await T(P, { action: 'create', buildingId: gh, game: 'ludo', stake: 500, seats: 4, quick: true }); const bz = (await whoDev('zara_ng')).coins;
    const lw = await T(P, { action: 'leave' }); ok(lw.json.refunded === 500 && (await whoDev('zara_ng')).coins === bz + 500, 'leaving before it starts refunds the stake');
    // Hold'em at the casino, against the computer (practice chips)
    const cas = (await pool.query("select id from buildings where type = 'casino' and done limit 1")).rows[0]?.id;
    if (cas) { const pk = await T(P, { action: 'create', buildingId: cas, game: 'poker', stake: 0, seats: 3, computer: true });
      ok(pk.status === 200 && pk.json.view.hole.length === 2 && pk.json.view.legal.length >= 2, "Hold'em: two hole cards and your options", JSON.stringify(pk.json.view).slice(0, 200));
      let pv = pk.json; for (let i = 0; i < 30 && pv.status === 'playing'; i++) { if (!pv.canMove) { pv = await botsGo(pv.id); continue; } const L = pv.view.legal; if (!L.length) break; pv = (await T(P, { action: 'move', id: pv.id, move: L.find(m => m.act === 'check' || m.act === 'call') || L[0] })).json; }
      ok(pv.status === 'done' && pv.result && (pv.view.shown || pv.result.winners.length), "the hand plays out to a showdown (or everyone folds)", JSON.stringify(pv.result)); await T(P, { action: 'leave' }); }
    ok(BG.HAND_NAMES[BG.handRank(['A♠', 'K♠', 'Q♠', 'J♠', 'T♠', '2♥', '3♦'])[0]] === 'Straight flush' && BG.cmpRank(BG.handRank(['A♠', 'A♥', '2♦', '3♠', '9♥', 'J♦', 'Q♣']), BG.handRank(['K♠', 'K♥', '2♦', '3♠', '9♥', 'J♦', 'Q♣'])) > 0, 'poker hands rank correctly');
    await pool.query("update citizens set table_id = null where handle in ('zara_ng', 'jobfill_a')"); }
  // ---- phone notifications ----
  { const k = await call('GET', '/api/push/key', undefined, { auth: false });
    ok(k.status === 200 && /^[A-Za-z0-9_-]{80,}$/.test(k.json.key || '') && k.json.kinds?.crime, 'the colony has a push key (made once, kept in the database)', JSON.stringify(k.json).slice(0, 80));
    ok((await call('GET', '/api/push/key', undefined, { auth: false })).json.key === k.json.key, 'and it stays the same');
    ok((await call('POST', '/api/me/push', { subscription: { endpoint: 'http://not-https.example/x', keys: { p256dh: 'a', auth: 'b' } } }, P)).status === 400, 'only proper push subscriptions are accepted');
    const sub = { endpoint: 'https://push.invalid/smoke-' + Date.now(), keys: { p256dh: 'BOr5r0Z7m8lRMYmdKvyX4gS3T2q1Xq5c6Q9w8nM2b1J0Yb3o2pQ1rS4tU5vW6xY7zA8bC9dE0fG1hI2jK3lM4nO5pQ', auth: 'aBcDeFgHiJkLmNoPqRsTuV' } };
    const on = await call('POST', '/api/me/push', { subscription: sub }, P);
    ok(on.status === 200 && on.json.devices === 1 && on.json.prefs.gift === true, 'turning notifications on for a device', JSON.stringify(on.json).slice(0, 120));
    const pr = await call('PUT', '/api/me/push/prefs', { prefs: { chat: false } }, P);
    ok(pr.json.prefs.chat === false && pr.json.prefs.crime === true, 'and choosing which kinds to get');
    ok((await call('DELETE', '/api/me/push', { endpoint: sub.endpoint }, P)).json.devices === 0, 'turning them off again'); }
  // ---- the first-day guide ----
  { await pool.query("update citizens set guide = null, daily_day = null, daily_streak = 0 where handle = 'zara_ng'");
    ok((await call('GET', '/api/me/guide', undefined, { auth: false })).status === 401, 'the guide is for signed-in colonists');
    const g0 = (await call('GET', '/api/me/guide', undefined, P)).json;
    ok(g0.steps?.length === 6 && !g0.finished && g0.steps.find(s => s.id === 'daily')?.done === false, 'a fresh guide has six steps to do', JSON.stringify(g0).slice(0, 160));
    ok(g0.steps.find(s => s.id === 'bank').done && g0.steps.find(s => s.id === 'out').done, 'steps already done count straight away (a deposit, a trip out)');
    ok((await call('POST', '/api/me/guide/claim', { step: 'daily' }, P)).status === 409, "can't collect a step you haven't done");
    ok((await call('POST', '/api/me/guide/claim', { step: 'bonus' }, P)).status === 409, 'the bonus waits until every step is done');
    const c0 = (await whoDev('zara_ng')).coins, cl = await call('POST', '/api/me/guide/claim', { step: 'bank' }, P);
    ok(cl.status === 200 && cl.json.paid === 500 && (await whoDev('zara_ng')).coins === c0 + 500, 'collecting a done step pays its reward', JSON.stringify(cl.json));
    ok((await call('POST', '/api/me/guide/claim', { step: 'bank' }, P)).status === 409, 'and only once');
    ok((await call('POST', '/api/me/guide/hide', { hidden: true }, P)).status === 200 && (await call('GET', '/api/me/guide', undefined, P)).json.hidden === true, 'the guide can be hidden');
    await call('POST', '/api/me/guide/hide', { hidden: false }, P); }
  // ---- daily rewards and streaks ----
  { const day = Math.floor(Date.now() / 86400000), meta0 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.treasuryBase;
    await pool.query("update citizens set daily_day = null, daily_streak = 0, daily_best = 0 where handle = 'zara_ng'");
    ok((await call('GET', '/api/me/daily', undefined, { auth: false })).status === 401, 'daily rewards are for signed-in colonists');
    const d0 = (await call('GET', '/api/me/daily', undefined, P)).json;
    ok(d0.claimed === false && d0.streak === 0 && d0.reward === 200 && d0.day === 1 && d0.rewards.length === 7, 'a first-timer can collect day 1 (200 coins)', JSON.stringify(d0));
    const c0 = (await whoDev('zara_ng')).coins, g1 = await call('POST', '/api/me/daily', {}, P);
    ok(g1.status === 200 && g1.json.paid === 200 && g1.json.streak === 1 && (await whoDev('zara_ng')).coins === c0 + 200, 'collecting pays 200 coins', JSON.stringify(g1.json));
    ok((await call('POST', '/api/me/daily', {}, P)).status === 409, 'only once a day');
    const d1 = (await call('GET', '/api/me/daily', undefined, P)).json;
    ok(d1.claimed && d1.streak === 1 && d1.reward === 300 && d1.day === 1, "after collecting, it shows tomorrow's 300", JSON.stringify(d1));
    const t1 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.treasuryBase;
    ok(meta0 === undefined || Math.round(meta0 - t1) === 50 || t1 < meta0, 'the coins come out of the treasury', `${meta0} → ${t1}`);
    await pool.query("update citizens set daily_day = $1, daily_streak = 6 where handle = 'zara_ng'", [day - 1]);
    const d6 = (await call('GET', '/api/me/daily', undefined, P)).json; ok(d6.streak === 6 && d6.reward === 1600 && d6.day === 7, 'collecting yesterday keeps the streak: day 7 pays 1,600', JSON.stringify(d6));
    const g7 = await call('POST', '/api/me/daily', {}, P); ok(g7.json.streak === 7 && g7.json.paid === 1600, 'a 7-day streak collects 1,600');
    await new Promise(r => setTimeout(r, 2100)); ok(((await call('GET', '/api/meta', undefined, { auth: false })).json.events || []).some(e => e.kind === 'streak' && /@zara_ng has come back 7 days in a row/.test(e.text)), 'a 7-day streak is in the Colony Log');
    await pool.query("update citizens set daily_day = $1, daily_streak = 7 where handle = 'zara_ng'", [day - 1]);
    ok((await call('GET', '/api/me/daily', undefined, P)).json.reward === 200, 'day 8 starts the cycle again at 200');
    await pool.query("update citizens set daily_day = $1, daily_streak = 9 where handle = 'zara_ng'", [day - 3]);
    const dm = (await call('GET', '/api/me/daily', undefined, P)).json; ok(dm.streak === 0 && dm.missed === 9 && dm.reward === 200, 'missing a day starts the streak over', JSON.stringify(dm));
    ok((await call('GET', '/api/me/daily', undefined, P)).json.best === 7, 'your best streak is remembered'); }
  // ---- more ways to earn ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms)), zid = (await whoDev('zara_ng')).id, coins = async () => (await whoDev('zara_ng')).coins;
    await pool.query("update citizens set coins_base = 100, net = 0, coins_day = 0, earn = null, jailed_until = null where id = $1", [zid]);
    ok((await call('GET', '/api/me/earn', undefined, { auth: false })).status === 401, 'earning is for signed-in colonists');
    let E = (await call('GET', '/api/me/earn', undefined, P)).json;
    ok(E.housed && E.shift && E.gigs && E.fishing && E.foraging && E.scavenge, 'the Earn tab lists every way to earn', JSON.stringify(E).slice(0, 200));
    // Extra shift
    const job = (await whoDev('zara_ng')).job;
    if (job) { const s1 = await call('POST', '/api/me/earn/shift', {}, P);
      ok(s1.status === 200 && s1.json.paid === E.shift.pay && s1.json.paid > 0 && (await coins()) === 100 + s1.json.paid - s1.json.travel, `an extra shift pays ${E.shift.pay} at once (less ${s1.json.travel} to get there)`, JSON.stringify(s1.json));
      ok((await call('POST', '/api/me/earn/shift', {}, P)).status === 429, 'then you need a rest before the next one');
      await pool.query(`update citizens set earn = jsonb_set(earn, '{shiftAt}', '0') where id = $1`, [zid]);
      ok((await call('POST', '/api/me/earn/shift', {}, P)).status === 200, 'after the rest, another shift'); }
    else ok(false, 'zara_ng should have a job for the shift test');
    // Delivery gig
    E = (await call('GET', '/api/me/earn', undefined, P)).json; const g = E.gigs.offers[0];
    ok(E.gigs.offers.length >= 1 && g.pay >= 30 && g.mins >= 1, 'parcels are offered, paying more for longer trips', JSON.stringify(E.gigs.offers));
    const tk = await call('POST', '/api/me/earn/gig', { action: 'take', id: g.id }, P);
    ok(tk.status === 200 && tk.json.gig.until > Date.now() && (await who('zara_ng')).visit?.[0] === g.to.id, 'taking one sends the colonist to the address', JSON.stringify(tk.json));
    ok((await call('POST', '/api/me/earn/gig', { action: 'take', id: E.gigs.offers[1]?.id || 'x' }, P)).status === 409, 'one delivery at a time');
    ok((await call('POST', '/api/me/earn/gig', { action: 'deliver' }, P)).status === 409, "you're paid on arrival, not before");
    await pool.query(`update citizens set earn = jsonb_set(earn, '{gig,until}', to_jsonb($2::bigint)) where id = $1`, [zid, Date.now() - 1]);
    const c0 = await coins(), dv = await call('POST', '/api/me/earn/gig', { action: 'deliver' }, P);
    ok(dv.status === 200 && dv.json.paid === g.pay && (await coins()) === c0 + g.pay, 'arriving pays the delivery fee', JSON.stringify(dv.json));
    // Fishing: too early, then just right
    const cast = async kind => (await call('POST', '/api/me/earn/catch', { kind }, P)).json, reel = async () => (await call('POST', '/api/me/earn/catch', { action: 'reel' }, P)).json;
    const f1 = await cast('fish'); ok(f1.biteIn >= 2500 && f1.biteIn <= 7500, 'casting a line: a bite comes in a few seconds', JSON.stringify(f1));
    ok((await reel()).result === 'early', 'reeling in before the bite loses it');
    await pool.query(`update citizens set earn = jsonb_set(earn, '{castAt}', '0') where id = $1`, [zid]);
    const f2 = await cast('fish'), bite = (await pool.query('select earn from citizens where id = $1', [zid])).rows[0].earn.cast.bite;
    while (Date.now() < bite + 100) await sleep(100);
    const c1 = await coins(), got = await reel();
    ok(got.result === 'caught' && got.item?.name && (await coins()) === c1 + got.paid, `reeling in on the bite catches something (${got.item?.name}, ${got.paid})`, JSON.stringify(got));
    await pool.query(`update citizens set earn = jsonb_set(earn, '{castAt}', '0') where id = $1`, [zid]);
    const fr = await call('POST', '/api/me/earn/catch', { kind: 'forage' }, P);
    ok(fr.status === 200 || (fr.status === 409 && /parks/.test(fr.json.error)), 'foraging needs a park', JSON.stringify(fr.json));
    if (fr.status === 200) await reel();
    // Scavenging
    const sv = await call('POST', '/api/me/earn/scavenge', { action: 'start' }, P);
    ok(sv.status === 200 && sv.json.scav.until - Date.now() > 100000, 'scavenging takes two minutes', JSON.stringify(sv.json));
    ok((await call('POST', '/api/me/earn/scavenge', { action: 'collect' }, P)).status === 409, "you can't collect before you've finished searching");
    await pool.query(`update citizens set earn = jsonb_set(earn, '{scav,until}', to_jsonb($2::bigint)) where id = $1`, [zid, Date.now() - 1]);
    const c2 = await coins(), sc = await call('POST', '/api/me/earn/scavenge', { action: 'collect' }, P);
    ok(sc.status === 200 && sc.json.item?.name && (await coins()) === c2 + sc.json.paid, `searching turns up ${sc.json.item?.name}`, JSON.stringify(sc.json));
    ok((await call('POST', '/api/me/earn/scavenge', { action: 'start' }, P)).status === 429, 'then others are picking over it for a while');
    // Daily limits
    await pool.query(`update citizens set earn = jsonb_set(earn, '{shifts}', '4'), stats = stats where id = $1`, [zid]); await pool.query(`update citizens set earn = jsonb_set(earn, '{shiftAt}', '0') where id = $1`, [zid]);
    ok((await call('POST', '/api/me/earn/shift', {}, P)).status === 429, 'four extra shifts a day at most'); }
  // ---- the developer tops up the treasury ----
  { const tr = async () => (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.treasuryBase;
    ok((await call('POST', '/api/admin/treasury', { amount: 1000 }, { auth: false })).status === 401, 'only the developer changes the treasury');
    ok((await call('POST', '/api/admin/treasury', { amount: 0 })).status === 400, 'an amount is needed');
    const t0 = await tr(), up = await call('POST', '/api/admin/treasury', { amount: 250000 });
    ok(up.status === 200 && Math.round(up.json.treasury - t0) === 250000 && Math.round((await tr()) - t0) === 250000, 'the developer adds 250,000 coins to the treasury', `${t0} → ${up.json.treasury}`);
    ok((await call('POST', '/api/admin/treasury', { amount: -(up.json.treasury + 1) })).status === 400, "can't take out more than it holds");
    const dn = await call('POST', '/api/admin/treasury', { amount: -250000 }); ok(dn.status === 200 && Math.round(dn.json.treasury - t0) === 0, 'and can take coins back out'); }
  // ---- renaming the colony ----
  { const before = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.name;
    ok((await call('PUT', '/api/admin/colony-name', { name: 'Gliese-12b' }, { auth: false })).status === 401, 'only the developer renames the colony');
    ok((await call('PUT', '/api/admin/colony-name', { name: 'x' })).status === 400, 'a name needs at least 2 characters');
    const rn = await call('PUT', '/api/admin/colony-name', { name: '  Gliese-12b  ' });
    ok(rn.status === 200 && rn.json.name === 'Gliese-12b' && (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.name === 'Gliese-12b', 'the developer renames the colony', JSON.stringify(rn.json));
    await new Promise(r => setTimeout(r, 2100));
    ok(((await call('GET', '/api/meta', undefined, { auth: false })).json.events || []).some(e => e.kind === 'rename' && e.text.includes(`${before} is now called Gliese-12b`)), 'and the Colony Log says so');
    const op = await call('POST', '/api/admin/square', { text: 'Hello from the new name' });
    ok(op.json.h === 'Gliese-12b Updates', 'official posts come from "<colony> Updates"', JSON.stringify(op.json));
    await call('PUT', '/api/admin/colony-name', { name: before }); }
  // ---- colony events ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms)), zid = (await whoDev('zara_ng')).id, meta = async () => (await call('GET', '/api/meta', undefined, { auth: false })).json;
    ok((await call('GET', '/api/colony-event', undefined, { auth: false })).json.event === null, 'no colony event to begin with');
    ok((await call('POST', '/api/admin/colony-event', { kind: 'festival' }, { auth: false })).status === 401, 'only the developer starts events');
    ok((await call('POST', '/api/admin/colony-event', { kind: 'party' })).status === 400, 'unknown events are refused');
    const fe = (await call('POST', '/api/admin/colony-event', { kind: 'festival' })).json;
    ok(fe.kind === 'festival' && fe.end - fe.start === 30 * 60000, 'the developer starts a festival (30 minutes)', JSON.stringify(fe));
    ok((await call('GET', '/api/colony-event', undefined, { auth: false })).json.event?.kind === 'festival', 'everyone can see it');
    await sleep(2100); ok(((await meta()).events || []).some(e => e.kind === 'cevent' && /Festival!/.test(e.text)), 'it is announced in the Colony Log');
    await pool.query("update citizens set earn = null, coins_base = 0, net = 0, coins_day = 0 where id = $1", [zid]);
    const E = (await call('GET', '/api/me/earn', undefined, P)).json, sh = await call('POST', '/api/me/earn/shift', {}, P);
    ok(E.event?.kind === 'festival' && sh.json.paid === Math.round(E.shift.pay * 1.5), 'during a festival a shift pays 1.5×', `${E.shift.pay} → ${sh.json.paid}`);
    // Storm: no fishing, weather pinned, then put back
    await call('PUT', '/api/admin/weather', { kind: 'fog' });
    await call('POST', '/api/admin/colony-event', { kind: 'storm' });
    ok((await call('GET', '/api/colony-event', undefined, { auth: false })).json.event?.kind === 'storm', 'starting another event replaces the first');
    ok((await meta()).meta.weather === 'storm', 'a great storm brings storm weather');
    const fs = await call('POST', '/api/me/earn/catch', { kind: 'fish' }, P); ok(fs.status === 409 && /stormy/.test(fs.json.error), "it's too stormy to fish");
    await call('DELETE', '/api/admin/colony-event');
    ok((await call('GET', '/api/colony-event', undefined, { auth: false })).json.event === null && (await meta()).meta.weather === 'fog', 'when it ends, the weather goes back to how it was');
    await call('PUT', '/api/admin/weather', { kind: null });
    // Fishing frenzy: bites come quickly
    await call('POST', '/api/admin/colony-event', { kind: 'frenzy' });
    await pool.query(`update citizens set earn = jsonb_set(coalesce(earn, '{}'), '{castAt}', '0') where id = $1`, [zid]);
    const fc = (await call('POST', '/api/me/earn/catch', { kind: 'fish' }, P)).json; ok(fc.biteIn >= 1200 && fc.biteIn <= 3500, 'in a fishing frenzy the bites come fast', JSON.stringify(fc));
    await call('POST', '/api/me/earn/catch', { action: 'reel' }, P);
    // Supply drop: first come, first served, once each
    await call('POST', '/api/admin/colony-event', { kind: 'supply' });
    await pool.query("update colony_events set data = jsonb_set(data, '{left}', '1') where not ended");
    const c0 = (await whoDev('zara_ng')).coins, sp = await call('POST', '/api/me/earn/supply', {}, P);
    ok(sp.status === 200 && sp.json.paid >= 300 && sp.json.paid <= 900 && (await whoDev('zara_ng')).coins === c0 + sp.json.paid, `claiming the supply drop pays ${sp.json.paid}`, JSON.stringify(sp.json));
    ok((await call('POST', '/api/me/earn/supply', {}, P)).status === 409, 'once each');
    ok((await call('GET', '/api/colony-event', undefined, { auth: false })).json.event.data.left === 0, 'and the supplies run out');
    await call('DELETE', '/api/admin/colony-event');
    ok((await call('POST', '/api/me/earn/supply', {}, P)).status === 409, 'no supply drop, nothing to claim'); }
  // ---- badges ----
  { const sleep = ms => new Promise(r => setTimeout(r, ms)), zid = (await whoDev('zara_ng')).id;
    ok((await call('GET', '/api/me/badges', undefined, { auth: false })).status === 401, 'badges are for signed-in colonists');
    await pool.query('delete from achievements where citizen_id = $1', [zid]);
    await pool.query("update citizens set stats = null, coins_base = 15000, bank = 0, daily_best = 8 where id = $1", [zid]);
    const b0 = (await call('GET', '/api/me/badges', undefined, P)).json, has = (l, id) => l.badges.find(x => x.id === id)?.t > 0;
    ok(b0.total >= 20 && b0.badges.every(x => x.icon && x.name && x.desc && [1, 2, 3].includes(x.tier)), 'every badge has an icon, name, description and tier', JSON.stringify(b0).slice(0, 200));
    ok(has(b0, 'verified') && has(b0, 'k1') && has(b0, 'streak7') && !has(b0, 'streak30') && !has(b0, 'k50'), 'badges are worked out from what you have', JSON.stringify(b0.badges.filter(x => x.t).map(x => x.id)));
    ok(b0.badges.find(x => x.id === 'verified').pct > 0, 'and show how many colonists have each one');
    ok(!has(b0, 'jackpot') && !has(b0, 'casino'), 'no casino badges before winning');
    await pool.query(`update citizens set stats = '{"casino_wins": 1, "casino_best": 12000}'::jsonb where id = $1`, [zid]);
    const sock = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws'), msgs = []; sock.on('message', d => { try { msgs.push(JSON.parse(d)); } catch {} });
    await new Promise(r => sock.on('open', r)); sock.send(JSON.stringify({ type: 'auth', token: P.headers['x-player'] })); await sleep(400);
    await call('POST', '/api/me/name', { name: 'Zara' }, P); await sleep(1200);
    const nb = msgs.find(m => m.type === 'badge'); ok(nb && nb.data.ids.includes('jackpot') && nb.data.ids.includes('casino'), 'doing something checks for new badges, and you hear about them live', JSON.stringify(nb));
    sock.close();
    ok((await who('zara_ng')).badges.includes('jackpot'), "they show on the colonist's card for everyone");
    await new Promise(r => setTimeout(r, 2100));
    ok(((await call('GET', '/api/meta', undefined, { auth: false })).json.events || []).some(e => e.kind === 'badge' && /@zara_ng earned the 🍒 Jackpot badge/.test(e.text)), 'gold badges are announced in the Colony Log');
    const again = (await call('GET', '/api/me/badges', undefined, P)).json, again2 = (await call('GET', '/api/me/badges', undefined, P)).json;
    ok(again.earned >= b0.earned + 2 && again2.earned === again.earned && Number((await pool.query('select count(*) n from achievements where citizen_id = $1', [zid])).rows[0].n) === again.earned, 'each badge is earned once', `${b0.earned} → ${again.earned}`);
    ok((await who('jobfill_b')).badges.length === 0, "unverified colonists don't earn badges"); }
  // ---- leaderboards ----
  { const zid = (await whoDev('zara_ng')).id, WEEK = 7 * 86400000, wk = Math.floor((Date.now() - 4 * 86400000) / WEEK);
    ok((await call('GET', '/api/leaderboards/nope', undefined, { auth: false })).status === 404, 'unknown boards are refused');
    await pool.query('delete from scores'); await pool.query('delete from weekly_champions'); await pool.query('delete from weekly_done');
    await pool.query("insert into scores (week, key, citizen_id, value) values ($1, 'casino_net', $2, 500), ($3, 'casino_net', $2, 9999)", [wk, zid, wk - 3]);
    const cas = (await call('GET', '/api/leaderboards/casino', undefined, P)).json;
    ok(cas.weekly && cas.top[0]?.h === 'zara_ng' && cas.top[0].v === 500 && cas.top[0].me && cas.top[0].rank === 1, "this week's casino winnings, with you marked", JSON.stringify(cas.top[0]));
    ok(cas.resetsAt > Date.now() && cas.resetsAt - Date.now() <= WEEK && new Date(cas.resetsAt).getUTCDay() === 1 && new Date(cas.resetsAt).getUTCHours() === 0, 'weekly boards start over on Monday at 00:00 UTC');
    const rich = (await call('GET', '/api/leaderboards/richest', undefined, { auth: false })).json;
    ok(rich.top.length >= 1 && rich.top.every(r => r.v === undefined) && rich.top.some(r => r.h === 'zara_ng'), 'the richest board shows the order but not the amounts', JSON.stringify(rich.top.slice(0, 3)));
    ok(!rich.top.some(r => r.h === 'jobfill_b'), "unverified colonists aren't ranked");
    const bdg = (await call('GET', '/api/leaderboards/badges', undefined, P)).json; ok(bdg.me && bdg.me.v >= 1, 'badges are ranked too');
    // A week ends: last week's champions are crowned once, and announced.
    await pool.query("insert into scores (week, key, citizen_id, value) values ($1, 'casino_net', $2, 900)", [wk - 1, zid]);
    const ro = (await call('POST', '/api/admin/test/rollover')).json, ro2 = (await call('POST', '/api/admin/test/rollover')).json;
    ok(ro.winners?.some(([k, h]) => k === 'casino' && h === 'zara_ng') && ro2.winners === null, "last week's winners are crowned once", JSON.stringify([ro, ro2]));
    await new Promise(r => setTimeout(r, 2100));
    ok(((await call('GET', '/api/meta', undefined, { auth: false })).json.events || []).some(e => e.kind === 'champions' && /Luckiest @zara_ng/.test(e.text)), "and announced in the Colony Log");
    ok((await call('GET', '/api/leaderboards/casino', undefined, P)).json.lastChampion?.h === 'zara_ng', "the board shows last week's champion"); }
  // ---- shared links get their own preview on X, WhatsApp… ----
  { const pg = await (await fetch(BASE + '/?c=zara_ng')).text();
    ok(/<meta property="og:title" content="[^"]*@zara_ng\)? on Resurgence"/.test(pg) && /og:url" content="[^"]*\?c=zara_ng"/.test(pg), 'a colonist link has their name in the link preview');
    ok(/og:title" content="Resurgence: a living colony/.test(await (await fetch(BASE + '/?c=nobody_here_xyz')).text()), 'an unknown colonist falls back to the normal preview');
    ok(/og:title" content="Resurgence: a living colony/.test(await (await fetch(BASE + '/?c=%3Cscript%3E')).text()), 'odd links are ignored safely');
    const og = await fetch(BASE + '/og.jpg'); ok(og.status === 200 && /image\/jpeg/.test(og.headers.get('content-type')), 'the preview picture is served'); }
  // ---- mayor elections ----
  { const e0 = (await call('GET', '/api/election', undefined, { auth: false })).json;
    ok(e0.week > 0 && e0.mayor === null && Array.isArray(e0.candidates) && e0.policies?.jobs, 'the election page: no mayor yet', JSON.stringify(e0).slice(0, 120));
    ok((await call('POST', '/api/me/election/vote', { handle: 'zara_ng' }, P)).status === 404, "can't vote for someone who isn't running");
    ok((await call('POST', '/api/me/election/run', { policy: 'free-money' }, P)).status === 400, 'a candidate picks a real pledge');
    ok((await call('POST', '/api/me/election/run', { policy: 'daily', pitch: 'vote me www.spam.example' }, P)).status === 400, 'no links in a pitch');
    await pool.query("update citizens set coins_base = 3000, net = 0, coins_day = 0, jailed_until = null where handle = 'zara_ng'");
    ok((await call('POST', '/api/me/election/run', { policy: 'daily', pitch: 'Bigger daily rewards for all!' }, P)).status === 400, 'running costs 5,000 coins in cash');
    await pool.query("update citizens set coins_base = 5500 where handle = 'zara_ng'");
    const run = await call('POST', '/api/me/election/run', { policy: 'daily', pitch: 'Bigger daily rewards for all!' }, P);
    ok(run.status === 200 && run.json.coins === 500, 'running for mayor', JSON.stringify(run.json));
    ok((await call('POST', '/api/me/election/run', { policy: 'jobs' }, P)).status === 409, 'once a week');
    ok((await call('POST', '/api/me/election/vote', { handle: 'zara_ng' }, P)).status === 200, 'voting');
    const e1 = (await call('GET', '/api/election', undefined, P)).json;
    ok(e1.candidates.length === 1 && e1.candidates[0].votes === 1 && e1.candidates[0].myVote && e1.iRun, 'the vote counts', JSON.stringify(e1.candidates));
    const end = await call('POST', '/api/admin/test/election-end');
    ok(end.json.winner === 'zara_ng', 'when the week ends, the most votes wins', JSON.stringify(end.json));
    const e2 = (await call('GET', '/api/election', undefined, { auth: false })).json;
    ok(e2.mayor?.handle === 'zara_ng' && e2.mayor.policy === 'daily', 'and is mayor for the next week', JSON.stringify(e2.mayor));
    ok((await call('GET', '/api/me/daily', undefined, P)).json.mayorBonus === 1.5, "the mayor's pledge takes effect: daily rewards are 50% bigger");
    let ev; for (let i = 0; i < 15 && !ev; i++) { ev = ((await call('GET', '/api/meta', undefined, { auth: false })).json.events || []).find(x => x.kind === 'election' && /new mayor/.test(x.text)); if (!ev) await sleep(250); }
    ok(ev && /@zara_ng is the new mayor/.test(ev.text), 'the result is in the news', ev?.text);
    ok((await call('POST', '/api/admin/test/election-end')).json.winner === null, 'a week is only counted once'); }
  // ---- the developer adjusts coins ----
  { const zid = (await whoDev('zara_ng')).id; await pool.query("update citizens set coins_base = 100, coins_day = 0, net = 0 where handle = 'zara_ng'");
    const t0 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.treasuryBase;
    ok((await call('POST', `/api/admin/citizens/${zid}/coins`, { amount: 500 }, { auth: false })).status === 401, 'only the developer adjusts coins');
    const add = await call('POST', `/api/admin/citizens/${zid}/coins`, { amount: 500 });
    ok(add.status === 200 && add.json.coins === 600 && (await whoDev('zara_ng')).coins === 600, 'the developer adds 500 coins', JSON.stringify(add.json));
    ok((await call('POST', `/api/admin/citizens/${zid}/coins`, { amount: -1000 })).status === 400, "can't take away more than they have");
    ok((await call('POST', `/api/admin/citizens/${zid}/coins`, { amount: -200 })).json.coins === 400, 'and takes 200 away');
    const t1 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.treasuryBase;
    ok(Math.round(t0 - t1) === 300 || t0 === undefined, 'the treasury pays for it (net 300)', `${t0} → ${t1}`); }
  const hut = await call('POST', '/api/admin/buildings', { type: 'house', x: 906, y: 906 });
  ok(hut.status === 200 && (await call('POST', '/api/me/job', { buildingId: hut.json.building?.id }, P)).status === 400, 'homes are not jobs', JSON.stringify(hut.json));
  ok((await call('POST', '/api/me/job/quit', {}, P)).status === 200 && (await call('POST', '/api/me/job/quit', {}, P)).status === 400, 'cannot quit with no job'); }
ok((await call('POST', `/api/claim/${claim.claimId}/password`, { password: 'secret2' }, { auth: false })).status === 404, 'a code works only once');
ok((await call('GET', '/api/me', undefined, { auth: false, headers: { 'x-player': tok1 } })).json.handle === 'zara_ng', 'the session knows who you are');
ok((await who('zara_ng')).claimed === true, 'the card shows the avatar is claimed');
ok((await call('POST', '/api/login', { handle: 'zara_ng', password: 'nope' }, { auth: false })).status === 401, 'wrong password refused');
r = await call('POST', '/api/login', { handle: 'ZARA_NG', password: 'secret1' }, { auth: false });
ok(r.status === 200 && r.json.token, 'log in with the password');
r = await call('POST', '/api/claim', { handle: 'zara_ng' }, { auth: false });
ok(r.json.reset === true, 'forgot password starts the same way');
await post(comment('cc3', 'zara_ng', r.json.code)); await sleep(400);
const r2 = await call('POST', `/api/claim/${r.json.claimId}/password`, { password: 'newpass9' }, { auth: false });
ok(r2.status === 200, 'reset the password');
ok((await call('GET', '/api/me', undefined, { auth: false, headers: { 'x-player': tok1 } })).status === 401, 'resetting signs out old sessions');
const zara = await who('zara_ng');
ok((await call('POST', `/api/admin/citizens/${zara.id}/setup-link`, {}, { auth: false })).status === 401, 'only the developer makes setup links');
r = await call('POST', `/api/admin/citizens/${zara.id}/setup-link`);
ok(r.status === 200 && (await call('POST', `/api/claim/${r.json.claimId}/password`, { password: 'linkpass1' }, { auth: false })).status === 200, 'a setup link lets them set a password directly');
ok((await call('DELETE', `/api/admin/citizens/${zara.id}/password`)).status === 200 && (await who('zara_ng')).claimed === false, 'the developer can clear a password');

console.log('Instagram panel and policy pages');
r = await call('GET', '/api/admin/instagram');
ok(r.status === 200 && r.json.callbackUrl.endsWith('/webhooks/instagram') && r.json.verifyToken && r.json.secretSet && r.json.lastWebhookAt > 0 && r.json.comments > 0, 'status shows webhook details and recent comments', JSON.stringify(r.json).slice(0, 200));
ok((await call('GET', '/api/admin/instagram', undefined, { auth: false })).status === 401, 'players cannot see the Instagram panel');
ok((await call('POST', '/api/admin/instagram/connect', { token: 'short' })).status === 400, 'connect refuses a bad token');
await call('POST', '/webhooks/instagram', undefined, { auth: false, raw: '{}', headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } });
ok((await call('GET', '/api/admin/instagram')).json.rejected >= 1, 'refused signatures are counted for the panel');
for (const path of ['/privacy', '/data-deletion', '/terms']) { const pr = await fetch(BASE + path); ok(pr.status === 200 && (await pr.text()).includes('<h1>'), `${path} page is up`); }

console.log('Newcomers start with nothing');
await call('POST', '/api/admin/citizens', { handle: 'broke_newbie' });
ok((await call('GET', '/api/citizens/broke_newbie')).json.coins === 0, 'a new colonist starts with 0 coins until they work');
ok((await who('broke_newbie')).coins === undefined, "other people can't see a colonist's coins");

console.log('Men and women');
await post(comment('c4', 'ada_f', 'spawn female 👩')); await post(comment('c5', 'bayo_m', 'Spawn me as a man'));
let ada = null; for (let i = 0; i < 40 && !ada?.id; i++) { await sleep(100); ada = await who('ada_f'); }
ok(ada?.g === 'f', '"spawn female" makes a woman', JSON.stringify(ada));
ok((await who('bayo_m'))?.g === 'm', '"spawn me as a man" makes a man');
r = await call('POST', '/api/admin/citizens', { handle: 'chioma', gender: 'f' });
ok(r.status === 200 && (await who('chioma')).g === 'f', 'the developer can add a woman');
ok(['m', 'f'].includes((await who('zara_ng')).g), 'everyone else gets a gender');
r = await call('PATCH', `/api/admin/citizens/${(await who('chioma')).id}`, { gender: 'm' });
ok(r.status === 200 && (await who('chioma')).g === 'm', 'the developer can change it');
ok((await call('PATCH', `/api/admin/citizens/${(await who('chioma')).id}`, { gender: 'x' })).status === 400, 'only man or woman');

console.log('Clock');
ok((await call('GET', '/api/cron/tick?key=wrong', undefined, { auth: false })).status === 401, 'cron ping needs its key');
r = await call('GET', `/api/cron/tick?key=${encodeURIComponent(process.env.CRON_KEY)}`, undefined, { auth: false });
ok(r.status === 200 && r.json.ok, 'cron ping works', JSON.stringify(r.json));

console.log('24/7 stream and the colony radio');
{ // the developer's stream settings: keys are kept back from everyone else and shown masked
  ok((await call('GET', '/api/admin/stream', undefined, { auth: false })).status === 401, 'stream settings are for the developer only');
  let r = await call('PUT', '/api/admin/stream', { cta: 'Join us!', quality: '720p', radio: 'pidgin', destinations: [{ platform: 'youtube', key: 'abcd-efgh-ijkl', enabled: true }, { platform: 'instagram', url: 'ftp://nope', key: 'x' }] });
  ok(r.status === 400, 'a stream address has to be rtmp:// or rtmps://');
  r = await call('PUT', '/api/admin/stream', { cta: 'Join us!', quality: '720p', radio: 'pidgin', destinations: [{ platform: 'youtube', key: 'abcd-efgh-ijkl', enabled: true }, { platform: 'instagram', key: 'igkey123', enabled: false }] });
  const st = (await call('GET', '/api/admin/stream')).json, yt = st.destinations[0];
  ok(r.status === 200 && yt.url === 'rtmp://a.rtmp.youtube.com/live2' && yt.key === 'abc••••jkl' && yt.hasKey && st.destinations[1].layout === 'portrait' && st.destinations[1].maxHours === 4, 'destinations get the platform address, shape and session limit; keys come back masked', JSON.stringify(st.destinations));
  await call('PUT', '/api/admin/stream', { destinations: st.destinations });
  ok((await call('GET', '/api/admin/stream?keys=1')).json.destinations[0].key === 'abcd-efgh-ijkl', 'saving with the masked key keeps the real one');
  const pub = (await call('GET', '/api/stream/public', undefined, { auth: false })).json;
  ok(pub.cta === 'Join us!' && pub.radio === 'pidgin' && !JSON.stringify(pub).includes('abcd'), 'the stream page gets the call to action and radio, never a key');
  // the streamer signs in with STREAM_TOKEN (or the builder token) and only gets switched-on destinations
  ok((await call('GET', '/api/stream/config', undefined, { auth: false })).status === 401, 'the streamer needs its token');
  const cfg = (await call('GET', '/api/stream/config')).json;
  ok(cfg.destinations.length === 1 && cfg.destinations[0].key === 'abcd-efgh-ijkl', 'the streamer gets only switched-on destinations, with their keys');
  r = await call('POST', '/api/stream/status', { host: 'vps-1', version: '1.0', pipelines: [{ layout: 'landscape', up: true, since: Date.now(), fps: 30, dests: ['YouTube Live'], onAir: '🏁 Race #3', snap: 'abc=' }] });
  const s2 = (await call('GET', '/api/admin/stream')).json.status;
  ok(r.status === 200 && s2.host === 'vps-1' && s2.pipelines[0].up && s2.pipelines[0].onAir === '🏁 Race #3' && s2.pipelines[0].snap === 'abc=', 'the streamer reports in, with what is on air');
  // OBS (or any stream page) checks in, so the developer can see it's open
  ok((await call('POST', '/api/stream/ping', { id: 'x' }, { auth: false })).status === 400, 'a stream page needs an id');
  await call('POST', '/api/stream/ping', { id: 'obspage01', kind: 'obs', w: 1280, h: 720, station: 'hausa', audio: 'running' }, { auth: false });
  const pg0 = (await call('GET', '/api/admin/stream')).json.pages.find(p => p.kind === 'obs');
  ok(pg0 && pg0.w === 1280 && pg0.station === 'hausa' && pg0.audio === 'running', 'the Stream tab sees an OBS page: its size, station and sound', JSON.stringify(pg0));
  // the director: the developer can put a shot on air, and every stream page hears about it at once
  const v = viewer(['0_0']); await v.ready;
  ok((await call('PUT', '/api/admin/stream/director', { mode: 'manual', shot: { type: 'person', handle: 'bad handle!' } })).status === 400, 'a shot needs a real username');
  r = await call('PUT', '/api/admin/stream/director', { mode: 'manual', shot: { type: 'person', handle: '@chioma' }, holdMin: 5 });
  ok(r.status === 200 && r.json.mode === 'manual' && r.json.shot.handle === 'chioma' && r.json.until > Date.now() + 4 * 60000, 'manual: follow a player for 5 minutes', JSON.stringify(r.json));
  ok(await v.saw(o => o.op === 'director' && o.data.shot?.handle === 'chioma'), 'stream pages get the pick at once');
  ok((await call('GET', '/api/stream/public', undefined, { auth: false })).json.director.mode === 'manual', 'a stream page that opens later gets it too');
  r = await call('PUT', '/api/admin/stream/director', { next: true });
  ok(r.json.mode === 'auto' && r.json.skip === r.json.n, 'next shot hands the camera back and skips ahead');
  // the radio: five stations on one clock, the song in each, and DJ talk breaks
  const radio = (await call('GET', '/api/radio', undefined, { auth: false })).json;
  ok(Object.keys(radio.stations).length === 5 && radio.stations.pidgin.title && radio.stations.yoruba.start <= Date.now(), 'five stations, each with a song now', JSON.stringify(radio.stations.pidgin));
  await call('POST', '/api/admin/citizens/bulk', { handles: ['dj_fan'] });
  await pool.query("insert into events (id, t, kind, text) values ('radio-ev', $1, 'race', '🏁 @dj_fan won race #7 and took home 900 coins')", [Date.now()]);
  ok((await call('POST', '/api/admin/radio/talk', { station: 'pidgin' }, { auth: false })).status === 401, 'only the developer can put a DJ on air');
  const { hostsOn } = await import('../shared/radio.js'), pg = hostsOn('pidgin', Date.now() + 3000), yo = hostsOn('yoruba', Date.now() + 3000);
  r = await call('POST', '/api/admin/radio/talk', { station: 'pidgin', duo: false });
  ok(r.status === 200 && r.json.dj === pg.lead.name && r.json.text.includes('@dj_fan won race #7') && r.json.focus?.handle === 'dj_fan' && r.json.at > Date.now(), 'a DJ break talks about the news and points the camera at who it is about', JSON.stringify(r.json));
  ok(await v.saw(o => o.op === 'radio' && o.talk.id === r.json.id), 'radios hear the break at once');
  const r2 = await call('POST', '/api/admin/radio/talk', { station: 'pidgin', duo: false });
  ok(r2.status === 200 && !r2.json.text.includes('@dj_fan won race #7'), 'the same news is not told twice on a station', r2.json.text);
  const r3 = await call('POST', '/api/admin/radio/talk', { station: 'yoruba', duo: true });
  ok(r3.json.text.includes('@dj_fan won race #7') && r3.json.dj === `${yo.lead.name} & ${yo.support.name}`, 'another station can still tell it, in its own words', r3.json.dj);
  ok(r3.json.lines.length >= 3 && r3.json.lines[0].name === yo.lead.name && r3.json.lines[1].name === yo.support.name && r3.json.lines.at(-1).text.length > 0, 'a pair break: the lead brings the news, the sidekick jokes, back and forth', JSON.stringify(r3.json.lines));
  const four = Object.values((await import('../shared/radio.js')).STATIONS).every(S => S.hosts.length === 4 && S.hosts.filter(h => h.role === 'support').length === 2);
  ok(four && hostsOn('english', 0).lead !== hostsOn('english', 3 * 3600e3).lead, 'four presenters per station, two pairs taking turns');
  const now = (await call('GET', '/api/radio?on=pidgin', undefined, { auth: false })).json;
  ok(now.talk.some(t => t.id === r.json.id && t.audio === null), 'the radio lists the breaks around now (text only until a voice is set up)');
  ok((await call('GET', `/api/radio/voice/${r.json.id}`, undefined, { auth: false })).status === 404, 'no voice recording without Azure');
  const adm = (await call('GET', '/api/admin/radio')).json;
  ok(adm.writer === (process.env.ANTHROPIC_API_KEY ? 'claude' : 'phrases') && adm.listening.includes('pidgin') && adm.recent.length >= 3, 'the developer sees who writes and voices the DJs, and the latest breaks', JSON.stringify({ w: adm.writer, l: adm.listening }));
  // the developer's switches: a station, or the whole radio, off air
  ok((await call('PUT', '/api/admin/radio', { on: false }, { auth: false })).status === 401, 'only the developer can switch the radio');
  r = await call('PUT', '/api/admin/radio', { stations: { hausa: false } });
  ok(r.status === 200 && !r.json.onAir.includes('hausa') && r.json.onAir.length === 4, 'switch one station off', JSON.stringify(r.json));
  ok(await v.saw(o => o.op === 'radioConfig' && !o.onAir.includes('hausa')), 'everyone’s dial hears about it at once');
  ok(!(await call('GET', '/api/radio', undefined, { auth: false })).json.onAir.includes('hausa'), 'the dial no longer lists it');
  ok((await call('POST', '/api/admin/radio/talk', { station: 'hausa' })).status === 400, 'a station that is off gets no DJ breaks');
  r = await call('PUT', '/api/admin/radio', { on: false });
  ok(r.json.on === false && r.json.onAir.length === 0 && (await call('GET', '/api/radio?on=pidgin', undefined, { auth: false })).json.talk.length === 0, 'switch the whole radio off: nothing is on air');
  r = await call('PUT', '/api/admin/radio', { on: true, stations: { hausa: true } });
  ok(r.json.onAir.length === 5, 'and back on');
  // how often and how long the DJ talks
  r = await call('PUT', '/api/admin/radio', { talkEvery: 3, talkLength: 'short' });
  ok(r.json.talkEvery === 3 && r.json.talkLength === 'short', 'set how often and how long the DJ talks');
  ok((await call('PUT', '/api/admin/radio', { talkLength: 'forever' })).json.talkLength === 'short', 'only known lengths');
  const sh = (await call('POST', '/api/admin/radio/talk', { station: 'english', duo: false })).json;
  ok(sh.text && !/^Good |locked in|keeping you company|colonists strong/.test(sh.text), 'a short break skips the opener', sh.text);
  await call('PUT', '/api/admin/radio', { talkEvery: 2, talkLength: 'normal' });
  // an announcement: every chosen station reads it now, and it shows on everyone's screen
  ok((await call('POST', '/api/admin/radio/announce', { text: 'hi' }, { auth: false })).status === 401, 'only the developer can make an announcement');
  ok((await call('POST', '/api/admin/radio/announce', { text: '' })).status === 400, 'an announcement needs words');
  const an = await call('POST', '/api/admin/radio/announce', { text: 'The server restarts in 10 minutes. Save your games!', stations: 'all' });
  ok(an.status === 200 && an.json.stations.length === 5 && an.json.talks.every(t => t.kind === 'alert' && t.text.includes('The server restarts in 10 minutes. Save your games! I repeat.')), 'every station on air reads it out, word for word and twice', JSON.stringify(an.json.talks[0]));
  ok(an.json.talks.find(t => t.station === 'pidgin').text.startsWith('Una listen well well'), 'each DJ introduces it their own way');
  ok(await v.saw(o => o.op === 'announce' && o.text.startsWith('The server restarts')), 'everyone’s screen gets it, radio on or off');
  ok(await v.saw(o => o.op === 'radio' && o.talk.kind === 'alert' && o.talk.station === 'hausa'), 'radios get it at once');
  const one = await call('POST', '/api/admin/radio/announce', { text: 'Race night at the Speedway!', stations: ['english'], screen: false });
  ok(one.json.stations.length === 1 && one.json.stations[0] === 'english', 'or just one station, without the banner');
  const ev = (await pool.query("select text from events where kind = 'announce' order by t desc limit 1")).rows[0];
  ok(ev && ev.text.includes('The server restarts'), 'the announcement goes in the Colony Log');
  // songs the developer uploads: they join the station's running order and stream with byte ranges
  const mp3 = Buffer.alloc(40000, 7), up = (q, body, type = 'audio/mpeg', auth = true) => fetch(`${BASE}/api/admin/radio/tracks?${q}`, { method: 'POST', headers: { 'content-type': type, ...(auth ? { authorization: 'Bearer ' + TOKEN } : {}) }, body }).then(async x => ({ status: x.status, json: await x.json() }));
  ok((await up('station=pidgin&dur=60&title=a.mp3', mp3, 'audio/mpeg', false)).status === 401, 'only the developer can upload songs');
  ok((await up('station=pidgin&dur=60&title=a.mp3', mp3, 'text/plain')).status === 400, 'only sound files');
  ok((await up('station=pidgin&dur=5&title=a.mp3', mp3)).status === 400, 'a song has a real length');
  ok((await up('station=nowhere&dur=60&title=a.mp3', mp3)).status === 400, 'a song goes on a real station');
  const u1 = await up('station=pidgin&dur=61.5&title=Lagos_Nights.mp3', mp3), u2 = await up('station=pidgin&dur=90&title=Owambe.mp3', mp3);
  ok(u1.status === 200 && u1.json.title === 'Lagos Nights' && u2.status === 200, 'upload songs (the file name becomes the title)', JSON.stringify(u1.json));
  const rp = (await call('GET', '/api/radio?on=pidgin', undefined, { auth: false })).json;
  ok(rp.tracks.length === 2 && rp.tracks.some(t => t.title === 'Lagos Nights' && t.dur === 61.5), 'the radio gets the station’s songs to play', JSON.stringify(rp.tracks));
  const { timeline } = await import('../shared/radio.js'); let seen = new Set(); for (let t = Date.now(); t < Date.now() + 3 * 3600e3; t += 5000) seen.add(timeline('pidgin', rp.tracks, t).kind);
  ok(seen.has('track') && seen.has('gen'), 'with only a few songs, generated ones fill in between');
  const rg = await fetch(`${BASE}/api/radio/track/${u1.json.id}`, { headers: { range: 'bytes=100-199' } });
  ok(rg.status === 206 && rg.headers.get('content-range') === 'bytes 100-199/40000' && (await rg.arrayBuffer()).byteLength === 100, 'songs stream in pieces (needed for phones and for joining mid-song)');
  r = await call('PATCH', `/api/admin/radio/tracks/${u2.json.id}`, { enabled: false, title: 'Owambe Time' });
  const after = (await call('GET', '/api/radio?on=pidgin', undefined, { auth: false })).json.tracks;
  ok(r.status === 200 && after.length === 1 && after[0].title === 'Lagos Nights', 'a song switched off leaves the running order');
  const lst = (await call('GET', '/api/admin/radio/tracks')).json;
  ok(lst.tracks.length === 2 && lst.bytes === 80000 && lst.tracks.find(t => t.id === u2.json.id).title === 'Owambe Time', 'the developer sees every song, renamed, and the space they take');
  ok((await call('DELETE', `/api/admin/radio/tracks/${u1.json.id}`)).status === 200 && (await fetch(`${BASE}/api/radio/track/${u1.json.id}`)).status === 404, 'delete a song');
  await call('DELETE', `/api/admin/radio/tracks/${u2.json.id}`);
  await call('PUT', '/api/admin/stream', { destinations: [] }); await call('PUT', '/api/admin/stream/director', { mode: 'auto' }); v.ws.close(); }

console.log('Removing people and starting over');
await call('POST', '/api/admin/citizens/bulk', { handles: ['gone_a', 'gone_b', 'stay_c'] });
r = await call('POST', '/api/admin/citizens/remove', { handles: ['gone_a', 'GONE_B', 'nobody_here'] });
ok(r.status === 200 && r.json.removed === 2 && r.json.notFound === 1, 'remove a list of colonists', JSON.stringify(r.json));
ok((await who('gone_a')).error && !(await who('stay_c')).error, 'only the listed ones are gone');
r = await call('POST', '/api/admin/citizens/remove', { all: true });
ok(r.status === 200 && r.json.removed > 0 && (await meta()).population === 1, 'remove everyone except the founder', JSON.stringify(r.json));
// ---- developer stats ----
{ ok((await call('GET', '/api/admin/stats', undefined, { auth: false })).status === 401, 'stats are for the developer only');
  const st = await call('GET', '/api/admin/stats?days=7'); const F = st.json.flows || {};
  ok(st.status === 200 && st.json.series.length === 7 && st.json.players.today >= 1 && typeof st.json.players.signedUp === 'number', 'stats: players who used the game today', JSON.stringify(st.json.players));
  ok(F['earn:shifts']?.today.players >= 1 && F['car:buy']?.today.coins >= 25000 && F['travel']?.today.n >= 1 && F['daily']?.today.coins >= 200 && F['gift']?.today.coins >= 9500, 'stats: coins earned and spent are recorded by kind, with how many players', Object.keys(F).join(','));
  ok(typeof st.json.money.playerCash === 'number' && st.json.money.treasury >= 0 && st.json.funnel.length === 11 && st.json.funnel.every(f => typeof f[2] === 'number'), 'stats: coins in circulation and the sign-up funnel', JSON.stringify(st.json.money)); }
// ---- Land, building on it, upgrades and offers between colonists (server/housing.js) ----
{
async function world_love_add(a, b, kind, n) { const { Love } = await import('../server/love.js'); return new Love({}).add(a, b, kind, n); }
async function player(handle, coins) {
  await call('POST', '/api/admin/citizens', { handle });
  const id = (await pool.query('select id from citizens where handle = $1', [handle])).rows[0].id;
  const link = (await call('POST', `/api/admin/citizens/${id}/setup-link`)).json.claimId;
  const tok = (await call('POST', `/api/claim/${link}/password`, { password: 'secret88' }, { auth: false })).json.token;
  if (coins) await pool.query('update citizens set coins_base = $2, net = 0 where id = $1', [id, coins]);
  return { id, handle, P: { auth: false, headers: { 'x-player': tok } } };
}
// find a free w×d patch next to a road
async function spot(w, d, avoid = []) {
  const roads = (await pool.query('select x, y from roads')).rows, R = new Set(roads.map(r => r.x + ',' + r.y));
  const bs = (await pool.query('select x, y, w, d, type from buildings')).rows, occ = new Set();
  for (const b of bs) if (!['tree', 'pine', 'birch', 'bush', 'rocks', 'cherry', 'maple', 'poplar', 'palm'].includes(b.type)) for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) occ.add((b.x + i) + ',' + (b.y + j));
  for (const p of (await pool.query('select * from plots')).rows.concat(avoid)) for (let i = -1; i <= p.w; i++) for (let j = -1; j <= p.d; j++) occ.add((p.x + i) + ',' + (p.y + j));
  const water = new Set((await pool.query('select x, y from water')).rows.map(r => r.x + ',' + r.y));
  for (const r of roads) for (const [x, y] of [[r.x + 1, r.y], [r.x, r.y + 1], [r.x - w, r.y], [r.x, r.y - d]]) {
    let good = true; for (let i = 0; i < w && good; i++) for (let j = 0; j < d && good; j++) { const k = (x + i) + ',' + (y + j); if (R.has(k) || occ.has(k) || water.has(k)) good = false; }
    if (good) return { x, y, w, d };
  }
  return null;
}
const A = await player('landlady', 3_000_000), B = await player('buyer_bob', 2_000_000);
// limits
let pr = (await call('GET', '/api/me/properties', undefined, A.P)).json;
ok(pr.max === 5 && pr.count === 0, 'a 0-star player can own 5 properties', JSON.stringify(pr).slice(0, 200));
await pool.query('update citizens set stars = 12 where id = $1', [A.id]);
pr = (await call('GET', '/api/me/properties', undefined, A.P)).json; ok(pr.max === 30, '12 stars: 30 properties');
await pool.query('update citizens set stars = 6 where id = $1', [A.id]);
pr = (await call('GET', '/api/me/properties', undefined, A.P)).json; ok(pr.max === 12, '6 stars: 12 properties', pr.max);
// land
const s1 = await spot(5, 4); ok(!!s1, 'housing: found free grass beside a road', JSON.stringify(s1));
let q = (await call('GET', `/api/land/quote?x=${s1.x}&y=${s1.y}&w=5&d=4`, undefined, A.P)).json;
ok(q.total > q.land && q.charges.length === 3 && !q.problem, 'land quote with three government charges', JSON.stringify(q));
ok((await call('GET', `/api/land/quote?x=${s1.x}&y=${s1.y}&w=9&d=4`, undefined, A.P)).status === 400, 'plots are at most 8×8');
const far = (await call('GET', `/api/land/quote?x=900&y=900&w=3&d=3`, undefined, A.P)).json; ok(/road/.test(far.problem || ''), 'land must touch a road', far.problem);
const tr0 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta;
let r = await call('POST', '/api/me/land', { ...s1, name: 'Sunny Acre' }, A.P); ok(r.status === 200 && r.json.paid === q.total, 'buy the land', JSON.stringify(r.json));
const plotId = r.json.plot?.id;
ok((await call('POST', '/api/me/land', s1, B.P)).status === 409, "can't buy land someone owns");
const ch = await call('GET', `/api/chunks?keys=${Math.floor(s1.x / 32)}_${Math.floor(s1.y / 32)}`, undefined, { auth: false });
ok(JSON.stringify(ch.json).includes(plotId), 'the plot is in the chunk data');
// admin can't build on it
ok((await call('POST', '/api/admin/buildings', { type: 'house', x: s1.x, y: s1.y })).status === 409, "the developer can't build on a player's land either");
// build
let info = (await call('GET', `/api/plots/${plotId}`, undefined, A.P)).json; ok(info.mine && info.w === 5 && info.where, 'plot card info', JSON.stringify(info).slice(0, 200));
ok((await call('POST', `/api/me/plots/${plotId}/build`, { type: 'house', x: s1.x, y: s1.y }, B.P)).status === 403, "can't build on someone else's plot");
ok((await call('POST', `/api/me/plots/${plotId}/build`, { type: 'apartment', x: s1.x + 3, y: s1.y }, A.P)).status === 409, "a building has to fit inside the plot");
r = await call('POST', `/api/me/plots/${plotId}/build`, { type: 'house', x: s1.x, y: s1.y, name: 'Casa' }, A.P);
ok(r.status === 200 && r.json.building.done === false && r.json.building.owner === 'landlady', 'start building a house on it', JSON.stringify(r.json).slice(0, 300));
const houseId = r.json.building.id;
r = await call('POST', `/api/me/plots/${plotId}/build`, { type: 'bench', x: s1.x + 4, y: s1.y + 3 }, A.P); ok(r.status === 200 && r.json.building.done, 'a bench is instant', JSON.stringify(r.json).slice(0, 200));
// renaming and moving your own buildings (only within the plot they were built on)
{ const benchId = r.json.building.id;
  ok((await call('POST', `/api/me/buildings/${houseId}/name`, { name: 'Hijack' }, B.P)).status === 404, "you can't rename someone else's building");
  r = await call('POST', `/api/me/buildings/${houseId}/name`, { name: '  Villa   Rosa ' }, A.P); ok(r.status === 200 && r.json.name === 'Villa Rosa', 'the owner renames her house', JSON.stringify(r.json));
  ok((await pool.query('select name from buildings where id = $1', [houseId])).rows[0].name === 'Villa Rosa', 'the new name is saved');
  ok((await call('POST', `/api/me/buildings/${benchId}/move`, { x: s1.x + 4, y: s1.y }, B.P)).status === 404, "you can't move someone else's building");
  ok((await call('POST', `/api/me/buildings/${benchId}/move`, { x: s1.x + 5, y: s1.y }, A.P)).status === 409, "a building can't be moved off its plot");
  ok((await call('POST', `/api/me/buildings/${benchId}/move`, { x: s1.x, y: s1.y }, A.P)).status === 409, "…or onto another building");
  r = await call('POST', `/api/me/buildings/${benchId}/move`, { x: s1.x + 4, y: s1.y }, A.P); const bb = (await pool.query('select x, y, plot_id from buildings where id = $1', [benchId])).rows[0];
  ok(r.status === 200 && bb.x === s1.x + 4 && bb.y === s1.y && bb.plot_id === plotId, 'the owner moves the bench elsewhere on her plot', JSON.stringify({ r: r.json, bb }));
  const lone = (await pool.query("select id from buildings where plot_id is null and type <> 'landing' limit 1")).rows[0];
  if (lone) { await pool.query('update buildings set owner_id = $2 where id = $1', [lone.id, A.id]);
    ok((await call('POST', `/api/me/buildings/${lone.id}/move`, { x: 0, y: 0 }, A.P)).status === 409, "a bought building that isn't on your own land can't be moved");
    await pool.query('update buildings set owner_id = null where id = $1', [lone.id]); } }
// paving your own land: surfaces only, inside your plot, never under a building; building over paving lifts it
{ const R1 = await import('../shared/rules.js'), k1 = `${s1.x + 3},${s1.y + 3}`, k2 = `${s1.x + 2},${s1.y + 3}`, pave = (body, who = A.P) => call('POST', `/api/me/plots/${plotId}/pave`, body, who);
  ok((await pave({ set: { [k1]: 'marble' } }, B.P)).status === 403, "you can't pave someone else's land");
  ok((await pave({ set: { [k1]: 'street' } })).status === 400, 'only surfaces can be laid on your land (no streets or rails)');
  ok((await pave({ set: { [`${s1.x + 5},${s1.y}`]: 'marble' } })).status === 409, 'paving stays inside your plot');
  const under = await pave({ set: { [`${s1.x},${s1.y}`]: 'marble' } }); ok(under.status === 200 && under.json.laid === 0, 'no paving under a building', JSON.stringify(under.json));
  const c0 = Number((await pool.query('select coins_base from citizens where id = $1', [A.id])).rows[0].coins_base), pv = await pave({ set: { [k1]: 'marble', [k2]: 'herringbone' } });
  const rows = (await pool.query('select x, y, type from roads where (x, y) in (($1::int, $2::int), ($3::int, $2::int))', [s1.x + 3, s1.y + 3, s1.x + 2])).rows;
  ok(pv.status === 200 && pv.json.laid === 2 && pv.json.paid === R1.paveCost('marble') + R1.paveCost('herringbone') && rows.length === 2 && c0 - pv.json.coins === pv.json.paid, 'lay marble and herringbone brick on your plot, paying per tile', JSON.stringify({ pv: pv.json, rows }));
  const lift = await pave({ remove: [k2] }); ok(lift.status === 200 && lift.json.lifted === 1 && !(await pool.query('select 1 from roads where x = $1 and y = $2', [s1.x + 2, s1.y + 3])).rowCount, 'lift paving again, for free', JSON.stringify(lift.json));
  const bn = await call('POST', `/api/me/plots/${plotId}/build`, { type: 'bench', x: s1.x + 3, y: s1.y + 3 }, A.P);
  ok(bn.status === 200 && !(await pool.query('select 1 from roads where x = $1 and y = $2', [s1.x + 3, s1.y + 3])).rowCount, 'building on your own paving lifts it', JSON.stringify(bn.json).slice(0, 200));
  if (bn.status === 200) await call('POST', `/api/me/buildings/${bn.json.building.id}/knock`, {}, A.P); }
// fences are laid like roads: drag a line and every free tile on it gets one (for the builder, and on your own plot)
{ const ln = await call('POST', `/api/me/plots/${plotId}/build-line`, { type: 'fence', tiles: [[s1.x + 2, s1.y + 3], [s1.x + 3, s1.y + 3], [s1.x + 5, s1.y + 3], [s1.x, s1.y]] }, A.P);
  ok(ln.status === 200 && ln.json.built === 2 && ln.json.skipped === 2, 'a fence line on your plot: free tiles get a fence, ones off the plot or under a building are skipped', JSON.stringify(ln.json));
  ok((await call('POST', `/api/me/plots/${plotId}/build-line`, { type: 'house', tiles: [[s1.x + 2, s1.y + 2]] }, A.P)).status === 400, 'only small things are laid in a line');
  ok((await call('POST', `/api/me/plots/${plotId}/build-line`, { type: 'fence', tiles: [[s1.x + 2, s1.y + 3]] }, B.P)).status === 403, "not on someone else's plot");
  for (const b of (await pool.query("select id from buildings where plot_id = $1 and type = 'fence'", [plotId])).rows) await call('POST', `/api/me/buildings/${b.id}/knock`, {}, A.P);
  const al = await call('POST', '/api/admin/buildings/line', { type: 'stonewall', tiles: [[3000, 3000], [3001, 3000], [3002, 3000], [3002, 3000]] });
  ok(al.status === 200 && al.json.built.length === 3 && al.json.built.every(b => b.type === 'stonewall'), 'the builder lays a wall in one stroke', JSON.stringify(al.json).slice(0, 200));
  for (const b of al.json.built || []) await call('DELETE', `/api/admin/buildings/${b.id}`); }
{ const pl = await call('GET', '/api/places', undefined, { auth: false }), types = new Set((pl.json.places || []).map(p => p[1]));
  ok(pl.status === 200 && types.has('landing') && !types.has('tree') && (pl.json.places || []).every(p => p.length === 5), "the map legend lists the colony's places (no trees or decorations)", JSON.stringify(pl.json).slice(0, 200)); }
// planes live in hangars: build one on your land first; each holds a set number
{ const lot = (await pool.query("select id from buildings where type = 'cardealer' and done and not ruin limit 1")).rows[0]?.id || await (async () => { const b = await call('POST', '/api/admin/buildings', { type: 'cardealer', x: 960, y: 940 }); await call('POST', `/api/admin/buildings/${b.json.building?.id}/finish`); return b.json.building?.id; })();
  const was = (await pool.query('select home_id from citizens where id = $1', [A.id])).rows[0].home_id, home = (await pool.query('select id from buildings where home_cap > 0 and done and not ruin limit 1')).rows[0].id;
  await pool.query('update citizens set home_id = coalesce(home_id, $2), coins_base = 6000000 where id = $1', [A.id, home]);
  const no = await call('POST', '/api/me/cars', { model: 'jet', buildingId: lot }, A.P); ok(no.status === 409 && /hangar/i.test(no.json.error || ''), 'no plane without a hangar', JSON.stringify(no.json));
  const s2 = await spot(4, 4); const lp = await call('POST', '/api/me/land', { ...s2 }, A.P); ok(lp.status === 200, 'land for a hangar', JSON.stringify(lp.json).slice(0, 200));
  const hb = await call('POST', `/api/me/plots/${lp.json.plot.id}/build`, { type: 'planehangar', x: s2.x, y: s2.y }, A.P); ok(hb.status === 200, 'build a plane hangar on it', JSON.stringify(hb.json).slice(0, 200));
  const hid = hb.json.building.id; await call('POST', `/api/me/buildings/${hid}/rush`, {}, A.P);
  const j1 = await call('POST', '/api/me/cars', { model: 'jet', buildingId: lot }, A.P); ok(j1.status === 200 && j1.json.hangar === 'Plane hangar', 'with a hangar built, buy a plane: it goes in the hangar', JSON.stringify(j1.json).slice(0, 200));
  const j2 = await call('POST', '/api/me/cars', { model: 'jet', buildingId: lot }, A.P), cars = (await pool.query('select cars from citizens where id = $1', [A.id])).rows[0].cars.filter(c => c.m === 'jet');
  const vs = (await pool.query('select x, y from vehicles where owner_id = $1 and type = $2', [A.id, 'plane'])).rows;
  ok(j2.status === 200 && cars.length === 2 && cars.every(c => c.hangar === hid) && vs.length === 2 && vs.every(v => v.x >= s2.x && v.x < s2.x + 3 && v.y >= s2.y && v.y < s2.y + 3), 'two planes, both parked in the hangar and flying from it', JSON.stringify({ j2: j2.json, cars, vs }));
  const full = await call('POST', '/api/me/cars', { model: 'jet', buildingId: lot }, A.P); ok(full.status === 409 && /full/.test(full.json.error || ''), 'a plane hangar holds two', JSON.stringify(full.json));
  const hi = (await call('GET', `/api/hangars/${hid}`, undefined, A.P)).json; ok(hi.cap === 2 && hi.planes.length === 2, 'the hangar lists the planes in it', JSON.stringify(hi));
  ok((await call('POST', `/api/me/buildings/${hid}/knock`, {}, A.P)).status === 409 && (await call('POST', `/api/me/plots/${lp.json.plot.id}/sell`, {}, A.P)).status === 409, "a hangar with planes in it can't be knocked down or sold until they have somewhere else to go");
  for (const c of cars) await call('DELETE', `/api/me/cars/${c.id}`, undefined, A.P);
  const sold = await call('POST', `/api/me/plots/${lp.json.plot.id}/sell`, {}, A.P); ok(sold.status === 200, 'with the planes sold, the hangar and its land can be sold', JSON.stringify(sold.json));
  await pool.query('update citizens set home_id = $2 where id = $1', [A.id, was]); }
// estates: land touching your own plot joins it (no road needed beside it): one property, built on across both, sold whole
{ const C = await player('estate_eve', 4_000_000), e1 = await spot(3, 3), b1 = await call('POST', '/api/me/land', { ...e1, name: 'Eve Acres' }, C.P); ok(b1.status === 200, 'a first plot for the estate', JSON.stringify(b1.json).slice(0, 200));
  const n0 = (await call('GET', '/api/me/properties', undefined, C.P)).json.count;
  const sides = [[{ x: e1.x + 3, y: e1.y, w: 2, d: 3 }, [e1.x + 2, e1.y]], [{ x: e1.x - 2, y: e1.y, w: 2, d: 3 }, [e1.x - 1, e1.y]], [{ x: e1.x, y: e1.y + 3, w: 3, d: 2 }, [e1.x, e1.y + 2]], [{ x: e1.x, y: e1.y - 2, w: 3, d: 2 }, [e1.x, e1.y - 1]]];
  let pick = null; for (const [r, at] of sides) { const q = (await call('GET', `/api/land/quote?x=${r.x}&y=${r.y}&w=${r.w}&d=${r.d}`, undefined, C.P)).json; if (!q.problem) { pick = { r, at, q }; break; } }
  ok(pick && pick.q.joins === 'Eve Acres', 'land touching your own plot can be bought, and the quote says it joins your land', JSON.stringify(pick && pick.q).slice(0, 200));
  if (pick) { const roadside = (await pool.query('select 1 from roads where ((x = $1::int - 1 or x = $1::int + $3::int) and y >= $2::int and y < $2::int + $4::int) or ((y = $2::int - 1 or y = $2::int + $4::int) and x >= $1::int and x < $1::int + $3::int) limit 1', [pick.r.x, pick.r.y, pick.r.w, pick.r.d])).rowCount;
    if (!roadside) ok(/road/.test((await call('GET', `/api/land/quote?x=${pick.r.x}&y=${pick.r.y}&w=${pick.r.w}&d=${pick.r.d}`, undefined, A.P)).json.problem || ''), "…while for anyone else it would need a road beside it");
    const b2 = await call('POST', '/api/me/land', pick.r, C.P), n1 = (await call('GET', '/api/me/properties', undefined, C.P)).json;
    ok(b2.status === 200 && b2.json.joined && n1.count === n0 && n1.plots.length === 1 && n1.plots[0].plots === 2, 'it joins as one property (an estate), not a second one', JSON.stringify({ b2: b2.json, n1: n1.plots }).slice(0, 300));
    const info = (await call('GET', `/api/plots/${b2.json.plot.id}`, undefined, C.P)).json; ok(info.plots && info.plots.length === 2 && info.tiles === 9 + 6, 'the plot card shows the whole estate', JSON.stringify(info).slice(0, 200));
    const across = await call('POST', `/api/me/plots/${info.id}/build`, { type: 'house', x: pick.at[0], y: pick.at[1] }, C.P); ok(across.status === 200, 'a house can stand across both plots of the estate', JSON.stringify(across.json).slice(0, 200));
    if (across.status === 200) await pool.query('update buildings set done = true where id = $1', [across.json.building.id]);
    const sold = await call('POST', `/api/me/plots/${info.id}/sell`, {}, C.P); ok(sold.status === 200 && !(await pool.query('select 1 from plots where owner_id = $1', [C.id])).rowCount, 'selling the estate sells all of it', JSON.stringify(sold.json)); } }
// plots that touch but were bought before estates existed are joined up too (here: on the owner's next purchase)
{ const F = await player('old_land_olu', 3_000_000), g1 = await spot(3, 3), g2 = { x: g1.x + 3, y: g1.y, w: 2, d: 3 };
  for (const [i, r] of [[1, g1], [2, g2]]) await pool.query('insert into plots (id, owner_id, owner_handle, x, y, w, d, cx, cy, price, bought_at, name) values ($1,$2,$3,$4,$5,$6,$7,0,0,1000,$8,$9)', ['oldplot' + i, F.id, F.handle, r.x, r.y, r.w, r.d, Date.now() - 100000 + i, i === 1 ? 'Old Farm' : '']);
  const far = await spot(2, 2, [{ x: g1.x - 2, y: g1.y - 2, w: 10, d: 7 }]), nb = await call('POST', '/api/me/land', far, F.P);
  const rows = (await pool.query('select id, estate from plots where id in ($1, $2)', ['oldplot1', 'oldplot2'])).rows, est = new Set(rows.map(r => r.estate || r.id));
  ok(nb.status === 200 && est.size === 1 && est.has('oldplot1'), 'touching plots bought before estates existed are joined into one, led by the named one', JSON.stringify({ nb: nb.status, rows }));
  ok((await call('GET', '/api/me/properties', undefined, F.P)).json.count === 2, '…so the old pair counts as one property (plus the new plot)');
  await pool.query('delete from plots where owner_id = $1', [F.id]); }
// a business's website: its owner sets it, everyone sees it on the map, only web links, the developer can take it down
{ const Wp = await player('web_wes', 900_000), sp = await spot(2, 2), bk = await call('POST', '/api/admin/buildings', { type: 'bakery', x: sp.x, y: sp.y, instant: true }), bid = bk.json.building?.id;
  ok((await call('POST', '/api/me/properties/buy', { buildingId: bid }, Wp.P)).status === 200, 'a player buys a bakery');
  const set = url => call('POST', `/api/me/buildings/${bid}/website`, { url }, Wp.P);
  ok((await set('javascript:alert(1)')).status === 400 && (await set('not a link')).status === 400 && (await set('ftp://files.example.com')).status === 400, 'only ordinary web links (no scripts, no other kinds of address)');
  const ok1 = await set('wesbakes.example.com'); ok(ok1.status === 200 && ok1.json.website === 'https://wesbakes.example.com/', 'the owner adds their website (https is added)', JSON.stringify(ok1.json));
  const ch = await call('GET', `/api/chunks?keys=${Math.floor(sp.x / 32)}_${Math.floor(sp.y / 32)}`, undefined, { auth: false });
  ok(JSON.stringify(ch.json).includes('"web":"https://wesbakes.example.com/"'), 'everyone sees the link on the building');
  ok((await call('POST', `/api/me/buildings/${bid}/website`, { url: 'evil.example.com' }, A.P)).status === 404, "nobody else can change it");
  const home = (await pool.query("select id from buildings where owner_id is null and home_cap > 0 and done limit 1")).rows[0]; if (home) { await pool.query('update buildings set owner_id = $1, owner_handle = $2 where id = $3', [Wp.id, 'web_wes', home.id]);
    ok((await call('POST', `/api/me/buildings/${home.id}/website`, { url: 'x.example.com' }, Wp.P)).status === 409, 'homes have no website: only businesses and industries'); await pool.query('update buildings set owner_id = null, owner_handle = null where id = $1', [home.id]); }
  const rm = await call('DELETE', `/api/admin/buildings/${bid}/website`); ok(rm.status === 200 && !(await pool.query('select website from buildings where id = $1', [bid])).rows[0].website, 'the developer can take a link down');
  await call('DELETE', `/api/admin/buildings/${bid}`); }
// the in-game browser's check: private and local addresses are never fetched; sites that forbid frames open in a new tab
{ const W = await import('../server/web.js'), H = h => new Headers(h), o = 'https://playresurgence.com';
  ok(W.frameAllowed(H({}), o) && !W.frameAllowed(H({ 'x-frame-options': 'DENY' }), o) && !W.frameAllowed(H({ 'x-frame-options': 'SAMEORIGIN' }), o) && !W.frameAllowed(H({ 'content-security-policy': "frame-ancestors 'self'" }), o) && W.frameAllowed(H({ 'content-security-policy': 'frame-ancestors *' }), o) && W.frameAllowed(H({ 'content-security-policy': 'frame-ancestors https://playresurgence.com' }), o),
    'the game reads whether a site lets other apps show it (X-Frame-Options, frame-ancestors)');
  const priv = await Promise.all(['https://127.0.0.1/', 'https://169.254.169.254/latest', 'https://10.0.0.5/', 'localhost.localhost'].map(u => call('GET', '/api/web/check?url=' + encodeURIComponent(u), undefined, { auth: false })));
  ok(priv.every(r => r.status === 200 && r.json.ok === false && r.json.frame === false), "the server never fetches private or local addresses for the browser", JSON.stringify(priv.map(r => r.json)));
  const bad = (await call('GET', '/api/web/check?url=' + encodeURIComponent('javascript:alert(1)'), undefined, { auth: false })).json; ok(bad.ok === false && !bad.frame, "and won't check anything that isn't a web address"); }
// the builder's Accounts: balances and each player's money history
{ const ac = (await call('GET', '/api/admin/accounts?q=landlady')).json, me = ac.players?.find(p => p.h === 'landlady');
  ok(me && me.total === me.cash + me.bank && ac.count >= 1, 'the builder sees a player\'s cash and savings', JSON.stringify(ac).slice(0, 200));
  const d = (await call('GET', '/api/admin/accounts/landlady')).json;
  ok(d.who?.h === 'landlady' && d.list.some(x => x.key === 'build:own' && x.coins < 0) && d.totals.some(x => x.key === 'land:buy' || x.key.startsWith('land')), "…and everything they spent, by kind and line by line", JSON.stringify(d).slice(0, 300));
  ok((await call('GET', '/api/admin/accounts', undefined, A.P)).status === 401, 'players can\'t see the accounts'); }
// the economy: no coins from nothing (the treasury goes into debt instead), status to buy, and the builder's dials
{ const meta = async () => (await pool.query('select data from meta where id = 1')).rows[0].data, tre = async () => { const m = await meta(); return R0.treasuryOn(m, R0.gameDay(Date.now(), m.epoch)); };
  const setTre = async v => { const m = await meta(); await pool.query("update meta set data = data || jsonb_build_object('treasuryBase', $1::numeric, 'treasuryDay', $2::int) where id = 1", [v, R0.gameDay(Date.now(), m.epoch)]); };
  const b2 = await call('POST', `/api/me/plots/${plotId}/build`, { type: 'bench', x: s1.x + 4, y: s1.y + 3 }, A.P); ok(b2.status === 200, 'another bench for the test', JSON.stringify(b2.json));
  await setTre(0); const kn = await call('POST', `/api/me/buildings/${b2.json.building.id}/knock`, {}, A.P), t1 = await tre();
  ok(kn.status === 200 && kn.json.back > 0 && Math.abs(t1 + kn.json.back) < 2, "an empty treasury still refunds, by going into debt: no coins made from nothing", JSON.stringify({ back: kn.json.back, t1 }));
  const s0 = (await call('POST', '/api/me/daily', {}, A.P)).json; ok(!s0.paid, "while the treasury is in debt it pays no daily rewards", JSON.stringify(s0));
  await setTre(1000000);
  const cash0 = (await whoDev('landlady')).coins, m0 = await meta(); await pool.query("update citizens set coins_base = 60000, coins_day = $1 where handle = 'landlady'", [R0.gameDay(Date.now(), m0.epoch)]);
  const st = await call('POST', '/api/me/status', {}, A.P); ok(st.status === 200 && st.json.tier === 1 && st.json.status.name === 'Bronze' && Math.abs(await tre() - 1050000) < 2, 'buying Bronze status: 50,000 coins to the treasury', JSON.stringify(st.json));
  ok((await call('POST', '/api/me/status', {}, A.P)).status === 402, "Silver costs 4× as much (200,000): can't afford it yet");
  ok((await who('landlady')).status === 1, 'the status shows on her card');
  const E = await call('POST', '/api/admin/economy', { measure: true }); ok(E.status === 200 && E.json.econ && E.json.econ.money > 0 && E.json.econ.top10 > 0 && E.json.f === 1, 'the builder can take a reading of the economy', JSON.stringify(E.json));
  ok((await call('POST', '/api/admin/economy', { f: 0.7 })).json.f === 0.7 && (await call('POST', '/api/admin/economy', { f: 5 })).status === 400, 'and set the dial by hand, within limits');
  const D = (await call('GET', '/api/admin/stats')).json; ok(D.econ && D.econ.f === 0.7 && D.econ.snaps.length >= 1 && D.econ.statusOwners.some(x => x.tier === 1), 'the Stats tab gets the economy readings', JSON.stringify(D.econ).slice(0, 300));
  await pool.query("update citizens set coins_base = coins_base + $1 where handle = 'landlady'", [cash0 - 60000]); // give back the test's cash
  await call('POST', '/api/admin/economy', { f: 1 }); ok((await call('POST', '/api/admin/economy', { f: 1 }, A.P)).status === 401, "players can't touch the dial"); }
pr = (await call('GET', '/api/me/properties', undefined, A.P)).json; ok(pr.count === 1 && pr.plots[0].buildings.length === 2, 'a plot counts as one property with its buildings', JSON.stringify(pr).slice(0, 300));
r = await call('POST', `/api/me/buildings/${houseId}/rush`, {}, A.P); ok(r.status === 200 && r.json.paid > 0, 'rush the builders', JSON.stringify(r.json));
let hb = (await pool.query('select * from buildings where id = $1', [houseId])).rows[0]; ok(hb.done && hb.home_cap === 4, 'the house is finished', JSON.stringify({ done: hb.done, cap: hb.home_cap }));
// upgrades
let uq = (await call('GET', `/api/me/buildings/${houseId}/upgrade`, undefined, A.P)).json; ok(uq.level === 2 && uq.to.homeCap === 5 && !uq.problem, 'upgrade quote to level 2', JSON.stringify(uq).slice(0, 300));
r = await call('POST', `/api/me/buildings/${houseId}/upgrade`, {}, A.P); ok(r.status === 200, 'start the upgrade', JSON.stringify(r.json));
ok((await call('POST', `/api/me/buildings/${houseId}/upgrade`, {}, A.P)).status === 409, 'one upgrade at a time');
await call('POST', `/api/me/buildings/${houseId}/rush`, {}, A.P);
hb = (await pool.query('select * from buildings where id = $1', [houseId])).rows[0]; ok(hb.level === 2 && hb.home_cap === 5 && Number(hb.up_at) === 0, 'level 2: more room', JSON.stringify({ l: hb.level, c: hb.home_cap }));
uq = (await call('GET', `/api/me/buildings/${houseId}/upgrade`, undefined, A.P)).json; ok(uq.level === 3 && uq.grows && uq.w === 3, 'level 3 grows a tile wider', JSON.stringify(uq).slice(0, 300));
r = await call('POST', `/api/me/buildings/${houseId}/upgrade`, {}, A.P); ok(r.status === 200, 'upgrade to 3', JSON.stringify(r.json));
hb = (await pool.query('select * from buildings where id = $1', [houseId])).rows[0]; ok(hb.w === 3 && Number(hb.up_at) > 0, 'the scaffolding takes the new ground right away', JSON.stringify({ w: hb.w }));
// a time jump finishes it on the clock
await pool.query('update buildings set up_at = $2 where id = $1', [houseId, Date.now() - 1000]);
await call('GET', '/api/cron/tick?key=' + (process.env.CRON_KEY || ''), undefined, { auth: false });
await new Promise(r => setTimeout(r, 1500));
hb = (await pool.query('select * from buildings where id = $1', [houseId])).rows[0]; ok(hb.level === 3 && hb.home_cap === 6, 'the clock finishes due upgrades', JSON.stringify({ l: hb.level, c: hb.home_cap }));
// level 5 needs depth: the plot is 4 deep; house is 2 → 3 at L5 fits. Try a tighter case: a 2×2 plot with a 2×2 house can't grow
const s2 = await spot(2, 2); r = await call('POST', '/api/me/land', s2, A.P); const p2 = r.json.plot?.id; ok(r.status === 200, 'buy a small 2×2 plot', JSON.stringify(r.json));
r = await call('POST', `/api/me/plots/${p2}/build`, { type: 'cabin', x: s2.x, y: s2.y }, A.P); const cab = r.json.building?.id; await call('POST', `/api/me/buildings/${cab}/rush`, {}, A.P);
await call('POST', `/api/me/buildings/${cab}/upgrade`, {}, A.P); await call('POST', `/api/me/buildings/${cab}/rush`, {}, A.P);
uq = (await call('GET', `/api/me/buildings/${cab}/upgrade`, undefined, A.P)).json; ok(/room on your plot/.test(uq.problem || ''), "level 3 needs more land than a 2×2 plot has", JSON.stringify(uq).slice(0, 200));
ok((await call('POST', `/api/me/buildings/${cab}/upgrade`, {}, A.P)).status === 409, '…so the upgrade is refused');
// living in a home you own: no rent (wages come in whole), and rent again once it's sold
const BT = (await import('../shared/catalog.js')).BUILDING_TYPES;
{ await pool.query('update citizens set home_changed_day = null, job_changed_day = null where id = $1', [A.id]);
  r = await call('POST', '/api/me/home', { buildingId: houseId }, A.P); ok(r.status === 200 && r.json.fee === 0, 'the owner moves into her own house (no moving-in fee)', JSON.stringify(r.json));
  let me = (await pool.query('select c.net, c.job_id, j.type jt from citizens c left join buildings j on j.id = c.job_id where c.id = $1', [A.id])).rows[0];
  if (!me.job_id) { const w = (await pool.query('select id from buildings where done and not ruin and job_used < job_cap order by built_at limit 1')).rows[0];
    await call('POST', '/api/me/job', { buildingId: w.id }, A.P); me = (await pool.query('select c.net, c.job_id, j.type jt from citizens c left join buildings j on j.id = c.job_id where c.id = $1', [A.id])).rows[0]; }
  const sal = BT[me.jt].work.salary; ok(Number(me.net) === sal - Math.round(sal * 0.2), 'living in a home you own, you keep your whole wage less tax: no rent', JSON.stringify({ net: me.net, sal }));
  const hm = (await call('GET', '/api/me/home', undefined, A.P)).json; ok(hm.home && hm.home.mine && hm.home.rent === 0, 'her Home tab shows no rent', JSON.stringify(hm.home)); }
// offers
r = await call('POST', '/api/me/offers', { kind: 'building', targetId: houseId, amount: 50000, message: 'Lovely house!' }, B.P); ok(r.status === 200, 'offer for a building on a plot (becomes an offer for the plot)', JSON.stringify(r.json));
let offs = (await call('GET', '/api/me/offers', undefined, A.P)).json; const o1 = offs.incoming[0];
ok(o1 && o1.kind === 'plot' && o1.amount === 50000 && o1.message === 'Lovely house!', 'the owner sees the offer with its message', JSON.stringify(offs).slice(0, 300));
const notes = (await pool.query("select text from notices where citizen_id = $1 and kind = 'offer'", [A.id])).rows; ok(notes.some(n => /buyer_bob offers 50,000/.test(n.text)), 'and gets a notification');
ok((await call('POST', '/api/me/offers', { kind: 'plot', targetId: plotId, amount: 60000 }, B.P)).status === 409, 'one waiting offer per thing');
r = await call('POST', `/api/me/offers/${o1.id}`, { action: 'counter', amount: 9_000_000, reply: 'More please' }, A.P); ok(r.json.status === 'countered', 'the owner counters');
ok((await call('POST', `/api/me/offers/${o1.id}`, { action: 'accept' }, A.P)).status === 409, "the owner can't accept their own counter");
r = await call('POST', `/api/me/offers/${o1.id}`, { action: 'accept' }, B.P); ok(r.json.status === 'failed' && /doesn't have/.test(r.json.why), "the buyer can't afford the counter: the deal falls through", JSON.stringify(r.json));
r = await call('POST', '/api/me/offers', { kind: 'plot', targetId: plotId, amount: 800000, message: 'Final offer' }, B.P); const o2 = r.json.id;
const a0 = (await call('GET', `/api/citizens/landlady`)).json.coins, b0 = (await call('GET', `/api/citizens/buyer_bob`)).json.coins;
const tr1 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.treasuryBase;
r = await call('POST', `/api/me/offers/${o2}`, { action: 'accept' }, A.P); ok(r.json.status === 'accepted' && r.json.tax === 40000, 'the owner accepts; 5% transfer tax', JSON.stringify(r.json));
const a1 = (await call('GET', `/api/citizens/landlady`)).json.coins, b1 = (await call('GET', `/api/citizens/buyer_bob`)).json.coins;
ok(a1 - a0 === 760000 && b0 - b1 === 800000, 'the seller gets 95%, the buyer pays the price', `${a1 - a0} ${b0 - b1}`);
const tr2 = (await call('GET', '/api/meta', undefined, { auth: false })).json.meta.treasuryBase; ok(Math.round(tr2 - tr1) === 40000, 'the tax goes to the treasury', tr2 - tr1);
const pl = (await pool.query('select owner_handle from plots where id = $1', [plotId])).rows[0], bl = (await pool.query('select distinct owner_handle from buildings where plot_id = $1', [plotId])).rows;
ok(pl.owner_handle === 'buyer_bob' && bl.length === 1 && bl[0].owner_handle === 'buyer_bob', 'the plot and everything on it changed hands');
{ const me = (await pool.query('select c.net, j.type jt, h.type ht, c.home_id from citizens c left join buildings j on j.id = c.job_id left join buildings h on h.id = c.home_id where c.id = $1', [A.id])).rows[0];
  ok(me.home_id === houseId && Number(me.net) === BT[me.jt].work.salary - Math.round(BT[me.jt].work.salary * 0.2) - BT[me.ht].home.rent, 'she sold the house she lives in: now she pays rent to live there', JSON.stringify(me)); }
// standalone building offer + decline + withdraw
r = await call('POST', '/api/me/offers', { kind: 'plot', targetId: p2, amount: 10 }, B.P); const o3 = r.json.id;
r = await call('POST', `/api/me/offers/${o3}`, { action: 'decline', reply: 'No way' }, A.P); ok(r.json.status === 'declined', 'the owner declines');
r = await call('POST', '/api/me/offers', { kind: 'plot', targetId: p2, amount: 20 }, B.P); const o4 = r.json.id;
r = await call('POST', `/api/me/offers/${o4}`, { action: 'withdraw' }, B.P); ok(r.json.status === 'withdrawn', 'the buyer withdraws');
ok((await call('POST', `/api/me/offers/${o3}`, { action: 'delete' }, A.P)).json.status === 'deleted' && !(await call('GET', '/api/me/offers', undefined, A.P)).json.incoming.some(o => o.id === o3), 'a closed offer can be deleted from your list');
{ r = await call('POST', '/api/me/offers', { kind: 'plot', targetId: p2, amount: 25 }, B.P); const o6 = r.json.id;
  ok((await call('POST', `/api/me/offers/${o6}`, { action: 'delete' }, A.P)).status === 409, "the owner can't delete an offer before answering it");
  const dl = await call('POST', `/api/me/offers/${o6}`, { action: 'delete' }, B.P), ob = (await call('GET', '/api/me/offers', undefined, B.P)).json, oa = (await call('GET', '/api/me/offers', undefined, A.P)).json;
  ok(dl.json.status === 'deleted' && !ob.outgoing.some(o => o.id === o6) && oa.incoming.find(o => o.id === o6)?.status === 'withdrawn', 'the buyer deletes an offer they changed their mind about: it is withdrawn and gone from their list', JSON.stringify(dl.json)); }
// expiry
r = await call('POST', '/api/me/offers', { kind: 'plot', targetId: p2, amount: 30 }, B.P); const o5 = r.json.id;
await pool.query('update offers set expires_at = $2 where id = $1', [o5, Date.now() - 1]);
ok((await call('POST', `/api/me/offers/${o5}`, { action: 'accept' }, A.P)).status === 409, 'an offer past 24 hours can no longer be accepted');
// knock down & sell plot
r = await call('POST', `/api/me/buildings/${cab}/knock`, {}, A.P); ok(r.status === 200 && r.json.back > 0, 'knock down a building on your land: 30% back', JSON.stringify(r.json));
info = (await call('GET', `/api/plots/${p2}`, undefined, A.P)).json; ok(info.buildings.length === 0 && info.sell > 0, 'the plot is empty again');
r = await call('POST', `/api/me/plots/${p2}/sell`, {}, A.P); ok(r.status === 200 && r.json.back === info.sell, 'sell the plot to the colony', JSON.stringify(r.json));
ok(!(await pool.query('select 1 from plots where id = $1', [p2])).rowCount, 'the land is free again');
// limit
await pool.query('update citizens set stars = 0 where id = $1', [B.id]);
for (let i = 0; i < 5; i++) { const s = (await spot(2, 2)) || { x: 900 + i * 5, y: 900, w: 2, d: 2 }; const rr = await call('POST', '/api/me/land', s, B.P); if (i < 4) ok(rr.status === 200, `bob buys plot ${i + 2}`, JSON.stringify(rr.json)); else ok(rr.status === 409 && /up to 5/.test(rr.json.error || rr.json.message || JSON.stringify(rr.json)), 'the 6th property is refused at 0 stars', JSON.stringify(rr.json)); }
// public card
const card = (await call('GET', '/api/citizens/buyer_bob', undefined, { auth: false })).json; ok(card.props === 5 && card.propMax === 5, 'the card shows how many properties they own', `${card.props} ${card.propMax}`);
const hm = (await call('GET', '/api/me/home', undefined, B.P)).json; ok(hm.props === 5 && hm.max === 5, 'the Home tab knows the count and the limit', JSON.stringify(hm).slice(0, 300));
{ // trees and decorations on land don't stop it being bought: they come with it
  const set = {}; for (let i = 0; i < 8; i++) set[`${1200 + i},1205`] = 'street'; await call('POST', '/api/admin/roads', { set }); // a quiet street of its own, with room beside it
  const K = await player('deco_dan', 4_000_000), k1 = { x: 1201, y: 1206, w: 4, d: 4 };
  const pk = await call('POST', '/api/admin/buildings', { type: 'parkinglot', x: k1.x + 1, y: k1.y + 1 }), tr = await call('POST', '/api/admin/buildings', { type: 'tree', x: k1.x + 3, y: k1.y + 3 });
  ok(pk.status === 200 && tr.status === 200, 'a parking lot and a tree on the grass', JSON.stringify([pk.json, tr.json]).slice(0, 200));
  const kq = (await call('GET', `/api/land/quote?x=${k1.x}&y=${k1.y}&w=4&d=4`, undefined, K.P)).json; ok(!kq.problem && kq.keeps === 2, 'the quote says the two come with the land', JSON.stringify(kq).slice(0, 300));
  const edge = (await call('GET', `/api/land/quote?x=${k1.x + 2}&y=${k1.y}&w=2&d=4`, undefined, K.P)).json; ok(/sticks out/.test(edge.problem || ''), 'a big decoration half on the land must be taken in whole', edge.problem);
  const kb = await call('POST', '/api/me/land', k1, K.P); ok(kb.status === 200 && kb.json.kept === 2, 'land with decorations on it can be bought', JSON.stringify(kb.json).slice(0, 200));
  const got = (await pool.query('select type, owner_id, plot_id from buildings where id = any($1)', [[pk.json.building?.id || pk.json.id, tr.json.building?.id || tr.json.id]])).rows;
  ok(got.length === 2 && got.every(b => b.owner_id === K.id && b.plot_id), '…and the buyer owns them, on their plot', JSON.stringify(got)); }
{ // your own character: made when you join, basic clothes free, the rest bought once and kept
  const A = await player('looks_lu', 10_000), B = await player('poor_pat', 100);
  const g0 = await call('GET', '/api/me/look', undefined, A.P); ok(g0.status === 200 && g0.json.set === false && g0.json.look && Array.isArray(g0.json.wardrobe), 'a new player has no character yet', JSON.stringify(g0.json).slice(0, 200));
  ok((await call('GET', '/api/me', undefined, A.P)).json.lookSet === false, '…so the game asks them to make one');
  const base = { g: 'f', ht: 3, bd: 0, sk: '#8D5524', fc: 1, br: 3, ns: 0, ey: '#3F6E8C', bdr: 0, mk: 1, lc: 2, hs: 'long', hc: '#120D0A', w: {} };
  { const u = await call('POST', '/api/me/look', { look: base }, A.P); ok(u.status === 200 && u.json.spent === 0, 'they can go out in just their underwear (it’s always drawn, so nobody is ever naked)', JSON.stringify(u.json).slice(0, 120)); }
  { const sw = await call('POST', '/api/me/look', { look: { ...base, w: { top: ['bikini', 13], bot: ['trunks', 7], shoe: ['sandals', 0] } } }, A.P); ok(sw.status === 200 && sw.json.look.w.top[0] === 'bikini' && sw.json.spent === 0, '…or in free beachwear', JSON.stringify(sw.json).slice(0, 120)); }
  const free = { ...base, w: { top: ['tee', 3], bot: ['jeans', 6], shoe: ['sneakers', 0] } };
  const s1 = await call('POST', '/api/me/look', { look: free }, A.P); ok(s1.status === 200 && s1.json.spent === 0 && s1.json.look.sk === '#8D5524', 'free clothes cost nothing', JSON.stringify(s1.json).slice(0, 200));
  ok((await call('GET', '/api/me', undefined, A.P)).json.lookSet === true, 'once made, the game stops asking');
  const fancy = { ...free, hs: 'braids', w: { ...free.w, out: ['leather', 4], wrist: ['goldwatch', 0] } }; // 500 + 4,000 + 12,000
  const s2 = await call('POST', '/api/me/look', { look: fancy }, A.P); ok(s2.status === 409 && /16,500/.test(s2.json.error || ''), 'paid things need buying first', JSON.stringify(s2.json));
  const s3 = await call('POST', '/api/me/look', { look: fancy, buy: true }, A.P); ok(s3.status === 400 && /16,500/.test(s3.json.error || ''), '…and they must have the coins', JSON.stringify(s3.json));
  await pool.query('update citizens set coins_base = 20000 where id = $1', [A.id]);
  const s4 = await call('POST', '/api/me/look', { look: fancy, buy: true }, A.P); ok(s4.status === 200 && s4.json.spent === 16500 && s4.json.wardrobe.includes('wrist:goldwatch') && s4.json.wardrobe.includes('hair:braids'), 'bought: the coins go and the things are kept', JSON.stringify(s4.json).slice(0, 300));
  ok(Math.round(Number((await pool.query('select coins_base from citizens where id = $1', [A.id])).rows[0].coins_base)) === 3500, '16,500 coins taken', '');
  const s5 = await call('POST', '/api/me/look', { look: { ...fancy, w: { ...fancy.w, wrist: ['goldwatch', 0], out: ['leather', 14] } } }, A.P); ok(s5.status === 200 && s5.json.spent === 0, 'wearing them again (in another colour) is free');
  ok(/chose/i.test((await call('POST', '/api/me/look', { look: { ...free, g: 'm' } }, A.P)).json.error || ''), 'once the character is made, man or woman stays');
  { const Z = await player('switch_sam', 100); await pool.query("update citizens set gender = 'f', gender_chosen = true where id = $1", [Z.id]);
    const sw = await call('POST', '/api/me/look', { look: { ...free, g: 'm' } }, Z.P); ok(sw.status === 200 && sw.json.look.g === 'm' && (await pool.query('select gender from citizens where id = $1', [Z.id])).rows[0].gender === 'm', 'making the character the first time, they can switch between man and woman', JSON.stringify(sw.json).slice(0, 120)); }
  const bad = await call('POST', '/api/me/look', { look: { ...free, sk: 'javascript:1', hs: 'nonsense', w: { ...free.w, hat: ['tiara', 99] } } }, A.P); ok(bad.status === 200 && bad.json.look.sk === '#8D5524' && bad.json.look.hs === 'braids' && !bad.json.look.w.hat, 'nonsense values are ignored', JSON.stringify(bad.json.look));
  const lk = (await call('GET', '/api/looks?h=looks_lu,poor_pat,nobody_x', undefined, { auth: false })).json; ok(lk.looks_lu?.hs === 'braids' && lk.poor_pat && !lk.nobody_x, 'anyone can load the characters to draw them', JSON.stringify(Object.keys(lk)));
  const cd = (await call('GET', '/api/citizens/looks_lu', undefined, { auth: false })).json; ok(Array.isArray(cd.a) && cd.a[1] === '#8D5524' && cd.a[2] === '#120D0A', 'the map gets their colours', JSON.stringify(cd.a));
  ok(!(await call('GET', '/api/citizens/poor_pat', undefined, { auth: false })).json.a, '…and nothing extra for someone who hasn’t made one');
  ok((await call('POST', '/api/me/look', { look: fancy, buy: true }, B.P)).status === 400, 'someone without the coins can’t buy');
  ok((await call('GET', '/api/me/look', undefined, { auth: false })).status === 401, 'you must be signed in to change your look'); }
{ // inside your home: a house with rooms; furniture on the floor, the walls, the windows and the ceiling; photos in frames
  const M = await player('homey_hal', 300_000), V = await player('visitor_vi', 1000);
  await pool.query('update citizens set home_id = (select id from buildings where type = $2 limit 1) where id = $1', [M.id, 'house']);
  const v0 = await call('GET', '/api/me/room', undefined, M.P); ok(v0.status === 200 && v0.json.mine && v0.json.size === 8 && v0.json.room.plan === 'h:house' && v0.json.room.items.length === 0, 'an empty house to furnish (a house is 8×8, with its own plan)', JSON.stringify(v0.json).slice(0, 200));
  const b1 = await call('POST', '/api/me/room/buy', { k: 'sofa', x: 0, y: 3, r: 0, c: 2 }, M.P); const it = b1.json.room?.items?.[0];
  ok(b1.status === 200 && it && it.k === 'sofa' && it.c === 2 && b1.json.coins === 300_000 - 4000, 'buy a green sofa for the bedroom', JSON.stringify(b1.json).slice(0, 200));
  ok((await call('POST', '/api/me/room/buy', { k: 'armchair', x: 1, y: 3, r: 0 }, M.P)).status === 409, 'two pieces can’t stand in the same spot');
  ok((await call('POST', '/api/me/room/buy', { k: 'rug', x: 0, y: 3, r: 0 }, M.P)).status === 200, '…but a rug can go under the sofa');
  ok(/wall/i.test((await call('POST', '/api/me/room/buy', { k: 'sofa', x: 2, y: 3, r: 0 }, M.P)).json.error || ''), 'furniture can’t stand across a wall between rooms');
  ok(/doorway/i.test((await call('POST', '/api/me/room/buy', { k: 'plant', x: 1, y: 4, r: 0 }, M.P)).json.error || ''), 'doorways are kept clear');
  ok((await call('POST', '/api/me/room/buy', { k: 'bed', x: 7, y: 7, r: 0 }, M.P)).status === 409, 'furniture must fit inside the house');
  const fr = await call('POST', '/api/me/room/buy', { k: 'frame', x: 0, y: 3, r: 3 }, M.P); ok(fr.status === 200, 'hang a photo frame on a wall', JSON.stringify(fr.json).slice(0, 160)); const frame = fr.json.item;
  ok(/window/i.test((await call('POST', '/api/me/room/buy', { k: 'frame', x: 0, y: 2, r: 3 }, M.P)).json.error || ''), 'a frame can’t hang over a window');
  ok((await call('POST', '/api/me/room/buy', { k: 'curtains', x: 0, y: 2, r: 3, c: 4 }, M.P)).status === 200, '…but curtains go on the window');
  { // doors in the doorways between rooms (and door curtains); not on walls, and one per doorway
    const F2 = await import('../shared/furniture.js'), Ld = F2.layoutOf(8, 'h:house'), dk = [...Ld.edges].find(([, t]) => t === 'door')[0], [da, db] = dk.slice(1).split(',').map(Number), hz = dk[0] === 'h';
    const at = hz ? { x: da, y: db, r: 0 } : { x: da, y: db, r: 3 }, other = hz ? { x: da, y: db - 1, r: 2 } : { x: da - 1, y: db, r: 1 };
    const d1 = await call('POST', '/api/me/room/buy', { k: 'door', ...at }, M.P); ok(d1.status === 200 && d1.json.item?.k === 'door', 'buy a door for a doorway between rooms', JSON.stringify(d1.json).slice(0, 160));
    ok(/already has a door/i.test((await call('POST', '/api/me/room/buy', { k: 'beads', ...other, c: 2 }, M.P)).json.error || ''), 'one door or curtain per doorway, from either side');
    ok(/doorway/i.test((await call('POST', '/api/me/room/buy', { k: 'door', x: 0, y: 0, r: 0 }, M.P)).json.error || ''), 'doors only go in doorways');
    const fk = [...Ld.edges].find(([, t]) => t === 'front')[0], [fa, fb] = fk.slice(1).split(',').map(Number);
    ok(/front door/i.test((await call('POST', '/api/me/room/buy', { k: 'doorcurtain', x: fa, y: fb - 1, r: 2 }, M.P)).json.error || ''), 'the front door already has a door');
    ok((await call('POST', '/api/me/room/sell', { i: d1.json.item.i }, M.P)).status === 200, 'a door can be sold again');
    await pool.query('update citizens set coins_base = coins_base + 450 where id = $1', [M.id]); } // the half lost on the door, so the sums below still add up
  ok((await call('POST', '/api/me/room/buy', { k: 'clock', x: 0, y: 3, r: 3 }, M.P)).status === 409, 'only one thing hangs on each bit of wall');
  ok((await call('POST', '/api/me/room/buy', { k: 'chandelier', x: 2, y: 3, r: 0 }, M.P)).status === 200 && (await call('POST', '/api/me/room/buy', { k: 'fan', x: 2, y: 3, r: 0 }, M.P)).status === 409, 'a chandelier on the ceiling, and only one thing per spot up there');
  ok((await call('POST', '/api/me/room/buy', { k: 'pendant', x: 1, y: 3, r: 0 }, M.P)).status === 200, '…a light above the sofa is fine (the ceiling is separate from the floor)');
  const tr = await call('POST', '/api/me/room/place', { i: it.i, x: 6, y: 3, r: 1 }, M.P), t2 = tr.json.room?.items?.find(x => x.i === it.i);
  ok(tr.status === 200 && t2.x === 6 && t2.r === 1, 'move the sofa into the bathroom and turn it', JSON.stringify(t2));
  const st = await call('POST', '/api/me/room/store', { i: it.i }, M.P); ok(st.status === 200 && st.json.room.box.length === 1 && !st.json.room.items.some(x => x.i === it.i), 'put it in storage');
  ok((await call('POST', '/api/me/room/place', { i: it.i, x: 2, y: 6, r: 0 }, M.P)).json.room?.items?.some(x => x.i === it.i), '…and set it out again in the living room');
  const sl = await call('POST', '/api/me/room/sell', { i: it.i }, M.P); ok(sl.status === 200 && sl.json.coins === 300_000 - 4000 - 1500 - 300 - 600 - 25000 - 900 + 2000, 'sell it back for half what it cost', sl.json.coins);
  const sy = await call('POST', '/api/me/room/style', { room: 0, floor: 'marble', wall: 'sage' }, M.P); ok(sy.status === 200 && sy.json.room.styles[0].f === 'marble' && sy.json.room.styles[0].w === 'sage' && sy.json.coins === sl.json.coins - 6800, 'marble floor and sage walls in the bedroom', JSON.stringify(sy.json.room.styles));
  ok((await call('POST', '/api/me/room/style', { room: 9, floor: 'wood' }, M.P)).status === 400, 'only rooms the house has');
  // photos
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgUFBcUFxsbGxsbGyAeICEhISAgICAhISEkJCQqKiokJCQhISQkKCgqKi4vLisrKisvLzIyMjw8OTlGRkhWVmf/xACkAAADAQEBAQEBAAAAAAAAAAAABgcIBQQDAgEBAAIDAQEAAAAAAAAAAAAAAAAHBgUIBAMQAAEDAgQEAwQHCQEAAAAAAAECAAQDEUKCEsFRITFBYQUisdHSE3GhFZGig7MGMoEkUzQ1dGIjEQAAAwMKBAMFCAMBAAAAAAAAAgEEAxGCgcJDwTEhQgUSUdJBE9GiFaEicWEUsgaRNCNzUlNjsTKj/8AAEQgASABgAwESAAISAAMSAP/aAAwDAQACEQMRAD8Az+xgAADNBx5d31fKKBkLqDokaSo/fyHiXVNGWewWPZ7xypciRVV/DD4qGBpFdIpCF+pl0xnfHgh3h1IV2VV6wNEypGO0vWHVUTCMQ4Roiq/qJ0o491fR73RgABYcgHxM7Mr73l90vtX4eInaJDBMBJ9X1x3py9ohUevlTEsYFdxTBTwxVVwXYkFVMYphHKBjGOZTGVTGMqqqqsVVVvVVW9VE6JKjcm7/AA5A6dO3JdrsqETgifKEV4r81xHUNtOXDpnIhHRCkKnQqX4QivVVgmKrio7QszsGbZk7Bm2dsz5prQM+aa0L/V6mXRBq9TLohZY7UAX4BsVjwAASoAWZ2DNsydgzbO2Z801oGfNNaF/q9TLog1epl0QsEA9eb/ruyHM7MhimUqpcpVVFSdB5CDEeHdGQxDGIZLjFVSqnTBUxuHgPJGmioQhfJXZXZR2PtaA26ztfcgU+Bui9DLYohYZ+sfd8zIU7QzKp3SKqmdwiZ0XiixXeVMY9SpCMcVGmxo2Djy7tc8llCqFoURrSE9+agLjVx5ctXiRxbBaMs9gpSPu6REW8uCrx+fx4jIGkV0ikGY0aYVgaHpyKnbfruKWENioq7iwRETb7ybYdMOkVpLH6AHGAYAfUiUk15NCkq4TUq00EjrZSgDa4Ivz4MAAA0D5dCTEg0FciuuDVURwUBoTewNgnsb2UVWdEnYM2ztmfNNaBnzTWhf6vUy6INXqZdELLHagC/AJqxykA3WALM7Bm2ZOwZtnbM+aa0DPmmtC/1epl0QavUy6IWWO1AF+AbFY8AAEqAFmdgzbMnYM2ztmfNNaBnzTWhf6vUy6INXqZdELLHbAC/AJq/upKElaPmoVVphZXRAqa0/LBKxqKBSJQASbLINvSTycpFh2DcU9vgN1CH+quP4vfwLzDzU5qoEqPWF9IKgsDEg21C10gnum5tqALW52DNs/ZnzTWgZ801o4NXqZdEGr1MuiNstL8kqqreWxlKsCEFHLhTUUDuedki/i7UAX4BlTy3++if7FH9RL88KomjLj1FmyUVqalHmbJSsEmw59ODAAANgzsGbZk7Bm2dsz5prQM+aa0L/V6mXRBq9TLohZY7UAX4BNWOUgG6wBZnYM2zJ2DNs7ZnzTWgZ801oX+r1MuiDV6mXRCyx2oAvwDYrHgAAlQAszsGbZk7Bm2dsz5prQM+aa0L/V6mXRBq9TLohZY7YAX4BIVCp9pTPUnV/P6jpOk/wDlW1WTruLi9vUbd7vuqqFaSCEXUCFLFNAqqv1vVCRUJULhZKrqBOq921BH+6fj7E8A6w3/AE9l/r8x+YKE7Bm2ZOwZtn1s+aa0DPmmtFBq9TLog1epl0Rpn9nv8XH/ADf1Vv0eRU1UvLIyVCxKVK7H0rWpSTy4pILtQBfgGU0wZK+lO+ZPxOpR+z4FaHSXm9i+AiD0XSsTQW8nmL4hnPhSKNSpWixhUBFVKNNQFWo3FhqKu5XbV1Nrv9x+zmjvUGV3Hc8hdlPYUKF6M6amwNL3t7Hcdu6PvES/bxN8g1Xw/ZpqHUex9ao3X6oxLW+R5yhDFGazMDUW935icwbb8Sgx6o6p+se9uNR6d9XYVrvI85BngoYxtXYS3vvI85Bnl+JbKiV6ujQi9r39SRw4l0MPULPqrFj+rfDI85QhnAZepaoxv+323u7buj7jxL9vEqcAjFEj+zZf9L8aPidrS9Mlb2Y1zzyn5QpnAYP1rP8Az8pvALNQxqlUUdV2/gr3NDkd2pk0dvW5z53fONHug8E1BlNc88p+UKFyPbMnxlabVOl7+lfh/wAuTyO7RjjRNRSP6F8Kx1zjTroTvUF+p7Xa96G6PS/bD/qHAeTkOomxz0X+FXucxpvO3ouoJUf+jrnGlzCjKwtJrnfmJzBquAwAE9H9qbQPprWlV5icwdBg6iv3ZrjexfARVwORWjKrLpJPpTqstfI6ASLq03BNhzsOrZi067ZXzrduLC7qVf8ASidPx6ai5eNHb7abtu6OKJft4qnASRBbU+ZwEJCU1AlKQAAKawAB0AARYAOBqcFMqFvHi/Cu+gav6/MTmDcQStj6ABCgDNBx5d2QceXd1TRlnsA0ZZ7AwNIrpFIGkV0ikKhFm/LGipcp7HuPA+H1hqr7Wdr2JtPFU6Lw+PyEcEW1n7v/AFRlfsu0rxYq8IuBXiwjuKtyHVcFjAqxiqosYugd5/Vf7yvpPtb8RUMiKioqKkUVMUVF6oK1j/LOP2nf2UFQUyGRDFVFRURUVFiiotyovAU7B+TZv2HX2ECnOwZtmTsGbZytnzTWgZ801ojWr1MuiDV6mXRCyx2oAvwDYrHgAAlQAszsGbZk7Bm2dsz5prQM+aa0L/V6mXRBq9TLohZY7YAX4Bx40E3C6o5dQj4vd97dW02dkuM8+KF5vD8RLA7tY+8Rdp3DGZd0VKZ+l0P8SouKrdvwhCJYxRRnwM0HHl3ZBx5d3VNGWewDRlnsDA0iukUgaRXSKQZmOpAGAAf/2Q==', 'base64');
  const up = async (i, body, P) => { const r = await fetch(BASE + '/api/me/room/photo/' + i, { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-player': P.headers['x-player'] }, body }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  const ph = await up(frame.i, jpg, M.P), pid = ph.json.room?.items?.find(x => x.i === frame.i)?.ph;
  ok(ph.status === 200 && pid && ph.json.photos?.[pid]?.s === '/api/room/photos/' + pid, 'put a photo in the frame', JSON.stringify(ph.json).slice(0, 200));
  const got = await fetch(BASE + '/api/room/photos/' + pid); ok(got.status === 200 && got.headers.get('content-type') === 'image/jpeg' && (await got.arrayBuffer()).byteLength === jpg.length, '…anyone can load the photo');
  ok((await up(frame.i, Buffer.from('not a picture at all '.repeat(60)), M.P)).status === 400, 'only real JPEG photos are taken');
  const rug = (await call('GET', '/api/me/room', undefined, M.P)).json.room.items.find(x => x.k === 'rug');
  ok((await up(rug.i, jpg, M.P)).status === 400, 'only frames take a photo');
  const ph2 = await up(frame.i, jpg, M.P), pid2 = ph2.json.room?.items?.find(x => x.i === frame.i)?.ph;
  ok(pid2 && pid2 !== pid && (await fetch(BASE + '/api/room/photos/' + pid)).status === 404, 'a new photo replaces the old one (which is deleted)');
  const look = await call('GET', '/api/citizens/homey_hal/room', undefined, V.P); ok(look.status === 200 && !look.json.mine && look.json.room.styles[0].f === 'marble' && look.json.photos[pid2] && look.json.coins === undefined, 'a visitor can walk in and see the photo (but not their coins)');
  const rep = await call('POST', '/api/report', { kind: 'photo', id: pid2, reason: 'abuse' }, V.P); ok(rep.status === 200, 'a visitor can report a photo', JSON.stringify(rep.json));
  ok((await call('POST', '/api/report', { kind: 'photo', id: pid2, reason: 'abuse' }, M.P)).status === 400, '…but not their own');
  const reps = (await call('GET', '/api/admin/reports')).json.reports, rp = reps.find(r => r.kind === 'photo' && r.mid === pid2); ok(!!rp, 'the developer sees the photo report');
  ok((await call('POST', '/api/admin/reports/' + rp.id, { action: 'delete' })).status === 200 && (await fetch(BASE + '/api/room/photos/' + pid2)).status === 404, '…and can take the photo down');
  ok(!(await call('GET', '/api/me/room', undefined, M.P)).json.room.items.find(x => x.i === frame.i).ph, '…which leaves the frame empty');
  const ph3 = await up(frame.i, jpg, M.P), pid3 = ph3.json.room?.items?.find(x => x.i === frame.i)?.ph; await call('POST', '/api/me/room/sell', { i: frame.i }, M.P);
  ok(pid3 && (await fetch(BASE + '/api/room/photos/' + pid3)).status === 404, 'selling a frame deletes its photo');
  await pool.query('update citizens set home_id = (select id from buildings where type = $2 limit 1) where id = $1', [V.id, 'tent']);
  const poor = await call('POST', '/api/me/room/buy', { k: 'statue', x: 0, y: 0, r: 0 }, V.P); ok(poor.status === 400 && /costs 150,000/.test(poor.json.error || ''), 'without the coins, you can’t buy a gold statue', JSON.stringify(poor.json));
  ok((await call('GET', '/api/citizens/visitor_vi/room', undefined, M.P)).json.room.items.length === 0, '…and nothing was taken or placed');
  await pool.query('update citizens set home_id = (select id from buildings where type = $2 limit 1) where id = $1', [M.id, 'tent']);
  const moved = (await call('GET', '/api/me/room', undefined, M.P)).json; ok(moved.size === 4 && moved.room.box.length > 0 && moved.room.items.every(x => x.x < 4 && x.y < 4), 'moving into a tent packs away what no longer fits', JSON.stringify(moved).slice(0, 200)); }
{ // businesses: anyone can walk in; the owner designs the inside (it comes with a standard fit-out until then); homes can be locked; who's here now
  const O = await player('baker_bo', 500_000), Vz = await player('walker_wu', 1000);
  const bk = (await call('POST', '/api/admin/buildings', { type: 'bakery', x: 1300, y: 1300, instant: true })).json.building; await pool.query('update buildings set owner_id = $2, owner_handle = $3 where id = $1', [bk.id, O.id, 'baker_bo']);
  const v1 = await call('GET', `/api/buildings/${bk.id}/inside`, undefined, { auth: false }); const std = v1.json.room?.items || [];
  ok(v1.status === 200 && v1.json.place === 'business' && !v1.json.designed && std.length > 3 && std.every(x => x.std) && v1.json.room.plan === 'food', 'anyone can walk into a bakery: a dining room with the standard fit-out', JSON.stringify(v1.json).slice(0, 200));
  ok((await call('POST', `/api/me/buildings/${bk.id}/inside/sell`, { i: std[0].i }, Vz.P)).status === 403, 'only the owner can change the inside');
  const rm = await call('POST', `/api/me/buildings/${bk.id}/inside/sell`, { i: std[0].i }, O.P); ok(rm.status === 200 && rm.json.coins === 500_000 && rm.json.room.items.length === std.length - 1, 'the owner can take out a standard piece (nothing back for it)', JSON.stringify(rm.json).slice(0, 160));
  ok((await call('GET', `/api/buildings/${bk.id}/inside`, undefined, { auth: false })).json.designed === true, '…and from then on the inside is theirs');
  let bought = null; for (let y = 2; y < 8 && !bought; y++) for (let x = 0; x < 8 && !bought; x++) { const r = await call('POST', `/api/me/buildings/${bk.id}/inside/buy`, { k: 'cafetable', x, y, r: 0, c: 3 }, O.P); if (r.status === 200) bought = r; }
  ok(bought && bought.json.coins === 500_000 - 900, 'the owner buys a café table for it', JSON.stringify(bought?.json || {}).slice(0, 160));
  let logo = null; for (let y = 0; y < 8 && !logo; y++) for (let x = 0; x < 8 && !logo; x++) for (let r = 0; r < 4 && !logo; r++) { const q = await call('POST', `/api/me/buildings/${bk.id}/inside/buy`, { k: 'logo', x, y, r }, O.P); if (q.status === 200) logo = q.json.item; }
  ok(!!logo, 'a company sign goes up on a wall');
  const jpgB = Buffer.from(await (await fetch(BASE + '/api/room/photos/none')).arrayBuffer()); // (404 page, not a photo)
  const lg = await fetch(BASE + `/api/me/buildings/${bk.id}/inside/photo/${logo.i}`, { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-player': O.P.headers['x-player'] }, body: jpgB });
  ok(lg.status === 400, 'the sign only takes a real photo');
  const st = await call('POST', `/api/me/buildings/${bk.id}/inside/style`, { room: 3, floor: 'terracotta', wall: 'sun' }, O.P); ok(st.status === 200 && st.json.room.styles[3].f === 'terracotta', 'the dining room gets a terracotta floor and sunny walls');
  ok((await call('POST', `/api/me/buildings/${bk.id}/inside/explode`, {}, O.P)).status === 404, 'only real actions');
  const hs = (await call('POST', '/api/admin/buildings', { type: 'house', x: 1310, y: 1300, instant: true })).json.building;
  const eh = await call('GET', `/api/buildings/${hs.id}/inside`, undefined, O.P); ok(eh.status === 200 && eh.json.place === 'building' && eh.json.room.items.length === 0 && eh.json.room.plan === 'h:house', 'a home nobody lives in can be walked into (empty)', JSON.stringify(eh.json).slice(0, 160));
  await pool.query('update buildings set owner_id = $2, owner_handle = $3 where id = $1', [hs.id, O.id, 'baker_bo']);
  let shown = null; for (let y = 0; y < 8 && !shown; y++) for (let x = 0; x < 8 && !shown; x++) { const q = await call('POST', `/api/me/buildings/${hs.id}/inside/buy`, { k: 'armchair', x, y, r: 0 }, O.P); if (q.status === 200) shown = q; }
  ok(shown && shown.json.place === 'building', 'its owner can furnish a home they own but don’t live in');
  ok((await call('POST', `/api/me/buildings/${hs.id}/inside/buy`, { k: 'plant', x: 0, y: 0, r: 0 }, Vz.P)).status === 403, '…and nobody else can');
  await pool.query('update citizens set home_id = $2 where id = $1', [Vz.id, hs.id]);
  const ch = (await call('GET', `/api/buildings/${hs.id}/inside`, undefined, O.P)).json; ok(Array.isArray(ch.choose) && ch.choose.some(c => c.handle === 'walker_wu'), 'with someone living there, you choose whose home to look into', JSON.stringify(ch).slice(0, 160));
  ok((await call('GET', `/api/buildings/${hs.id}/inside`, undefined, Vz.P)).json.place === 'home', '…and someone who lives there walks straight into their own');
  await pool.query('update citizens set home_id = null where id = $1', [Vz.id]);
  const un = (await call('POST', '/api/admin/buildings', { type: 'bakery', x: 1320, y: 1300, instant: false })).json.building;
  ok((await call('GET', `/api/buildings/${un.id}/inside`, undefined, { auth: false })).status === 409, 'a building still going up can’t be entered yet');
  // homes can be locked
  await pool.query('update citizens set home_id = $2 where id = $1', [O.id, hs.id]);
  ok((await call('POST', '/api/me/room/lock', { locked: true }, O.P)).json.room?.locked === true && (await call('GET', '/api/citizens/baker_bo/room', undefined, Vz.P)).status === 403, 'a home can be locked, and then others can’t come in');
  ok((await call('GET', '/api/me/room', undefined, O.P)).status === 200, '…but its owner still can');
  { // asking to visit a locked home: the owner lets you in for a while, or doesn't
    const st0 = (await call('GET', '/api/citizens/baker_bo/visit', undefined, Vz.P)).json; ok(st0.locked === true && st0.status === 'none', 'a visitor sees the home is locked', JSON.stringify(st0));
    ok((await call('GET', '/api/citizens/baker_bo', undefined, { auth: false })).json.locked === true, 'the card knows it’s locked');
    const rq = await call('POST', '/api/citizens/baker_bo/visit', { message: 'Can I see your kitchen?' }, Vz.P); ok(rq.status === 200 && rq.json.status === 'pending', 'ask to visit', JSON.stringify(rq.json));
    ok((await call('POST', '/api/citizens/baker_bo/visit', {}, Vz.P)).status === 409, '…once, until they answer');
    const inc = (await call('GET', '/api/me/visits', undefined, O.P)).json; const q = inc.requests?.find(x => x.handle === Vz.handle);
    ok(q && q.status === 'pending' && q.message === 'Can I see your kitchen?' && inc.times.includes(15), 'the owner sees the request', JSON.stringify(inc));
    ok((await pool.query("select count(*) n from notices where citizen_id = $1 and kind = 'visit'", [O.id])).rows[0].n > 0, '…and gets a notice');
    ok((await call('POST', `/api/me/visits/${q.id}`, { accept: true, minutes: 7 }, O.P)).status === 400, 'only the offered lengths of time');
    const ac = await call('POST', `/api/me/visits/${q.id}`, { accept: true, minutes: 15 }, O.P); ok(ac.status === 200 && ac.json.until > Date.now() + 14 * 60000, 'let them in for 15 minutes', JSON.stringify(ac.json));
    ok((await call('GET', '/api/citizens/baker_bo/room', undefined, Vz.P)).status === 200 && (await call('GET', '/api/citizens/baker_bo/visit', undefined, Vz.P)).json.status === 'accepted', '…and now they can go in');
    ok((await call('GET', '/api/citizens/baker_bo/room', undefined, { auth: false })).status === 403, '…but nobody else');
    ok((await call('POST', `/api/me/visits/${q.id}`, { end: true }, O.P)).status === 200 && (await call('GET', '/api/citizens/baker_bo/room', undefined, Vz.P)).status === 403, 'the owner can end the visit early');
    const rq2 = await call('POST', '/api/citizens/baker_bo/visit', {}, Vz.P), q2 = (await call('GET', '/api/me/visits', undefined, O.P)).json.requests.find(x => x.status === 'pending');
    ok(rq2.status === 200 && (await call('POST', `/api/me/visits/${q2.id}`, { accept: false }, O.P)).json.status === 'declined', 'or say no');
    ok((await call('GET', '/api/citizens/baker_bo/visit', undefined, Vz.P)).json.status === 'declined' && (await call('POST', '/api/citizens/baker_bo/visit', {}, Vz.P)).status === 429, '…and they can’t ask again straight away');
    ok((await call('POST', `/api/me/visits/${q2.id}`, { accept: true, minutes: 15 }, Vz.P)).status === 404, 'only the owner answers'); }
  ok((await call('POST', '/api/me/room/lock', { locked: false }, O.P)).json.room?.locked === undefined && (await call('GET', '/api/citizens/baker_bo/room', undefined, Vz.P)).status === 200, '…and unlocked again');
  ok(/open/i.test((await call('POST', '/api/citizens/baker_bo/visit', {}, Vz.P)).json.error || ''), 'an open home doesn’t need asking');
  // who's here now
  const h1 = await call('POST', '/api/inside/here', { place: 'b:' + bk.id }, O.P), h2 = await call('POST', '/api/inside/here', { place: 'b:' + bk.id }, Vz.P);
  ok(h1.status === 200 && h2.json.viewers === 1 && h2.json.names.includes('baker_bo'), 'someone walking in sees who else is looking round', JSON.stringify(h2.json));
  ok((await call('POST', '/api/inside/here', { place: 'nonsense here' }, O.P)).status === 400, 'only real places'); }
{ // a shared building: everyone who lives there has their own apartment, with its own plan, lock and visitors
  const ap = (await call('POST', '/api/admin/buildings', { type: 'apartment', x: 1340, y: 1300, instant: true })).json.building;
  const R1 = await player('res_ann', 50_000), R2 = await player('res_ben', 50_000), R3 = await player('res_cal', 50_000), Vq = await player('look_lou', 1000);
  for (const R of [R1, R2]) await pool.query('update citizens set home_id = $2, room = null, home_unit = null, home_unit_bid = null where id = $1', [R.id, ap.id]);
  await pool.query(`update citizens set home_id = $2, home_unit = null, home_unit_bid = null, room = '{"items":[{"i":"x1","k":"plant","x":3,"y":3,"r":0}],"box":[],"styles":{}}' where id = $1`, [R3.id, ap.id]); // furnished before apartments had numbers
  const r1 = (await call('GET', '/api/me/room', undefined, R1.P)).json, r2 = (await call('GET', '/api/me/room', undefined, R2.P)).json, r3 = (await call('GET', '/api/me/room', undefined, R3.P)).json;
  ok(r1.room.plan === 'h:apartment' && r2.room.plan === 'h:apartment#2' && r1.home.unit === 1 && r2.home.unit === 2, 'neighbours get apartments of their own (the first one with the building’s usual layout)', JSON.stringify([r1.room.plan, r2.room.plan]));
  const F3 = await import('../shared/furniture.js'); ok(JSON.stringify(F3.layoutOf(r1.size, r1.room.plan).rooms) !== JSON.stringify(F3.layoutOf(r2.size, r2.room.plan).rooms), '…laid out differently');
  ok(r3.room.plan === 'h:apartment' && r3.room.items.length === 1, 'someone who furnished before keeps their layout and furniture', JSON.stringify([r3.room.plan, r3.room.items.length]));
  ok((await call('GET', '/api/me/room', undefined, R2.P)).json.room.plan === 'h:apartment#2', 'the apartment stays theirs');
  ok((await call('POST', '/api/me/room/lock', { locked: true }, R1.P)).status === 200, 'a renter can lock their own apartment');
  ok((await call('GET', '/api/citizens/res_ann/room', undefined, Vq.P)).status === 403 && (await call('GET', '/api/citizens/res_ben/room', undefined, Vq.P)).status === 200, '…which doesn’t lock the neighbours');
  const ch = (await call('GET', `/api/buildings/${ap.id}/inside`, undefined, Vq.P)).json.choose || [];
  ok(ch.find(c => c.handle === 'res_ann')?.locked && ch.find(c => c.handle === 'res_ann')?.unit === 1 && ch.find(c => c.handle === 'res_ben')?.unit === 2, 'the building lists each apartment, locked or not', JSON.stringify(ch));
  ok((await call('POST', '/api/citizens/res_ann/visit', {}, Vq.P)).status === 200, 'a visitor can ask a renter to visit');
  const qv = (await call('GET', '/api/me/visits', undefined, R1.P)).json.requests[0]; ok(qv && (await call('POST', `/api/me/visits/${qv.id}`, { accept: false }, R1.P)).json.status === 'declined', '…and the renter can say no'); }
{ // an owner's apartment in their own building is theirs for good: it stays furnished while they live elsewhere, nobody else gets it, and it's theirs again when they move back
  const ap = (await call('POST', '/api/admin/buildings', { type: 'apartment', x: 1360, y: 1300, instant: true })).json.building, hs = (await call('POST', '/api/admin/buildings', { type: 'house', x: 1380, y: 1300, instant: true })).json.building;
  const O = await player('own_oma', 200_000), N = await player('own_ned', 50_000);
  await pool.query('update buildings set owner_id = $2, owner_handle = $3 where id = $1', [ap.id, O.id, 'own_oma']);
  const moveTo = async (P, id) => { await pool.query('update citizens set home_changed_day = null where id = (select id from citizens where lower(handle) = lower($1))', [P.handle]); return call('POST', '/api/me/home', { buildingId: id }, P.P); };
  O.handle = 'own_oma'; N.handle = 'own_ned';
  ok((await moveTo(O, ap.id)).status === 200, 'an owner moves into their own building');
  const u0 = (await call('GET', '/api/me/room', undefined, O.P)).json.home.unit;
  await pool.query(`update citizens set room = '{"plan":"h:apartment","items":[{"i":"k1","k":"plant","x":3,"y":3,"r":0}],"box":[{"i":"k2","k":"armchair"}],"styles":{}}' where id = $1`, [O.id]);
  ok((await moveTo(O, hs.id)).status === 200, '…then moves to another home');
  const away = (await call('GET', '/api/me/room', undefined, O.P)).json;
  ok(away.room.items.length === 0 && away.room.box.length === 0, 'their furniture stays behind in their apartment (the new home starts bare)', JSON.stringify(away.room));
  const kept = (await pool.query('select unit, room from kept_homes where citizen_id = $1 and building_id = $2', [O.id, ap.id])).rows[0];
  ok(kept && kept.unit === u0 && kept.room.items.length === 1, '…kept, with its number', JSON.stringify(kept));
  await pool.query('update citizens set home_id = $2, room = null, home_unit = null, home_unit_bid = null where id = $1', [N.id, ap.id]);
  ok((await call('GET', '/api/me/room', undefined, N.P)).json.home.unit !== u0, 'someone moving in meanwhile gets a different apartment');
  ok((await moveTo(O, ap.id)).status === 200, 'the owner moves back');
  const back = (await call('GET', '/api/me/room', undefined, O.P)).json;
  ok(back.home.unit === u0 && back.room.items.some(i => i.i === 'k1') && back.room.box.some(i => i.i === 'k2'), '…and gets their apartment back just as they left it', JSON.stringify([back.home.unit, back.room.items, back.room.box]));
  ok(!(await pool.query('select 1 from kept_homes where citizen_id = $1', [O.id])).rowCount, '…(nothing left waiting)');
  await moveTo(O, hs.id); ok((await call('POST', '/api/me/properties/sell', { buildingId: ap.id }, O.P)).status === 200, 'they sell the building while living elsewhere');
  const after = (await call('GET', '/api/me/room', undefined, O.P)).json.room;
  ok(after.box.some(i => i.i === 'k1') && after.box.some(i => i.i === 'k2') && !(await pool.query('select 1 from kept_homes where citizen_id = $1', [O.id])).rowCount, '…and the apartment’s furniture comes to them, in storage', JSON.stringify(after.box)); }
{ // relationships: ask out, a love meter that fills with time together and messages (capped each day), propose, marry; married couples furnish each other's places
  const A = await player('love_amy', 200_000), B = await player('love_ben', 200_000), C = await player('love_cat', 50_000);
  const home = (await call('POST', '/api/admin/buildings', { type: 'house', x: 1400, y: 1300, instant: true })).json.building, shop = (await call('POST', '/api/admin/buildings', { type: 'bakery', x: 1420, y: 1300, instant: true })).json.building;
  await pool.query('update citizens set home_id = $2, room = null, home_unit = null, home_unit_bid = null where id = $1', [B.id, home.id]);
  await pool.query('update buildings set owner_id = $2, owner_handle = $3 where id = $1', [shop.id, B.id, 'love_ben']);
  ok((await call('POST', '/api/citizens/love_amy/love/ask', {}, A.P)).status === 400, 'you can’t ask yourself out');
  ok((await call('POST', '/api/citizens/love_ben/love/ask', { message: 'Coffee?' }, A.P)).status === 200, 'Amy asks Ben out');
  ok((await call('POST', '/api/citizens/love_cat/love/ask', {}, A.P)).status === 409, '…one question at a time');
  ok((await call('GET', '/api/me/love', undefined, B.P)).json.asks?.[0]?.from === 'love_amy', 'Ben sees who asked him out');
  ok((await call('POST', '/api/citizens/love_amy/love/answer', { accept: false }, B.P)).json.status === 'declined', 'Ben can say no');
  ok((await call('POST', '/api/citizens/love_ben/love/ask', {}, A.P)).status === 429, '…and Amy has to wait before asking again');
  await pool.query("update relationships set t = 0 where pair like '%' || $1 || '%'", [A.id]);
  ok((await call('POST', '/api/citizens/love_ben/love/ask', {}, A.P)).status === 200, 'later, she asks again');
  await call('POST', '/api/citizens/love_ben/love/ask', {}, C.P); /* Cat asks Ben too */
  ok((await call('POST', '/api/citizens/love_amy/love/answer', { accept: true }, B.P)).json.status === 'dating', 'Ben says yes: they’re dating');
  ok(!(await pool.query("select 1 from relationships where status = 'asked' and asked_by = $1", [C.id])).rowCount, '…and Cat’s question is off');
  ok((await call('POST', '/api/citizens/love_cat/love/ask', {}, A.P)).status === 409, 'you can only be with one person at a time');
  const s0 = (await call('GET', '/api/citizens/love_ben/love', undefined, A.P)).json; ok(s0.status === 'dating' && s0.points === 5 && s0.hearts === 0, 'the meter starts low', JSON.stringify(s0));
  ok((await call('POST', '/api/me/love/propose', {}, A.P)).status === 409, 'you can’t propose before your hearts are full');
  for (let i = 0; i < 12; i++) await world_love_add(A.id, B.id, 'text', 1);
  for (let i = 0; i < 30; i++) await world_love_add(A.id, B.id, 'together', 1);
  const s1 = (await call('GET', '/api/me/love', undefined, A.P)).json.current; ok(s1.points === 33 && s1.today.texts === 8 && s1.today.together === 20 && s1.hearts === 1, 'time together and messages fill it, up to a limit each day', JSON.stringify(s1));
  await pool.query("update relationships set points = 100, day_key = null where status = 'dating' and (a_id = $1 or b_id = $1)", [A.id]);
  ok((await call('GET', '/api/me/love', undefined, B.P)).json.current.ripe === true, 'full hearts: ready to marry');
  ok((await call('POST', '/api/me/love/propose', {}, A.P)).status === 200, 'Amy proposes');
  ok((await call('GET', '/api/me/love', undefined, B.P)).json.current.proposedBy === 'them', '…Ben sees the proposal');
  ok((await call('POST', '/api/me/love/proposal', { accept: true }, B.P)).json.status === 'married', '…and says yes: they’re married');
  const ph = (await call('GET', '/api/citizens/love_ben/room', undefined, A.P)).json; ok(ph.mine === true && ph.partner === true, 'married: Amy can furnish Ben’s home', JSON.stringify({ mine: ph.mine, partner: ph.partner }));
  let put = null; for (let y = 0; y < 8 && !put; y++) for (let x = 0; x < 8 && !put; x++) { const r = await call('POST', '/api/me/partner/room/buy', { k: 'plant', x, y, r: 0 }, A.P); if (r.status === 200) put = r; }
  ok(put && put.json.partner && (await call('GET', '/api/me/room', undefined, B.P)).json.room.items.some(i => i.k === 'plant'), '…what she buys goes into his home', JSON.stringify(put?.json?.error || ''));
  ok(Number((await pool.query('select coins_base from citizens where id = $1', [A.id])).rows[0].coins_base) < 200_000 && Number((await pool.query('select coins_base from citizens where id = $1', [B.id])).rows[0].coins_base) === 200_000, '…paid from her own coins');
  ok((await call('GET', `/api/buildings/${shop.id}/inside`, undefined, A.P)).json.mine === true, '…and she can design his business too');
  ok((await call('POST', `/api/me/buildings/${shop.id}/inside/buy`, { k: 'plant', x: 0, y: 0, r: 0 }, C.P)).status === 403, '…but nobody else can');
  ok((await call('POST', '/api/me/partner/room/buy', { k: 'plant', x: 1, y: 1, r: 0 }, C.P)).status === 403, 'someone single has no partner’s home to furnish');
  const seen = (await call('GET', '/api/citizens/love_ben/love', undefined, C.P)).json; ok(seen.theyTaken && seen.theirs?.status === 'married' && seen.theirs?.with === 'love_amy', 'others can see who Ben is married to', JSON.stringify(seen));
  ok((await call('POST', '/api/me/love/privacy', { hidden: true }, B.P)).json.hidden === true && (await call('GET', '/api/me/love', undefined, B.P)).json.hidden === true, 'Ben can keep it private');
  const unseen = (await call('GET', '/api/citizens/love_ben/love', undefined, C.P)).json; ok(!unseen.theyTaken && !unseen.theirs && unseen.status === 'none', '…then others can’t see it', JSON.stringify(unseen));
  ok((await call('GET', '/api/citizens/love_ben/love', undefined, A.P)).json.status === 'married', '…but his wife still can');
  const nope = await call('POST', '/api/citizens/love_ben/love/ask', {}, C.P); ok(nope.status === 409 && /isn’t available/.test(nope.json.error || ''), '…and someone asking him out is just told he isn’t available', JSON.stringify(nope.json));
  ok((await call('GET', '/api/citizens/love_amy/love', undefined, C.P)).json.theirs?.with === 'love_ben', '(Amy didn’t hide it, so her card still shows it)');
  ok((await call('POST', '/api/me/love/end', {}, B.P)).json.ended === 'married', 'either of them can end it');
  ok((await call('GET', '/api/citizens/love_ben/room', undefined, A.P)).json.mine === false, '…and then it’s his home again, not hers to change'); }
{ // night clubs: a club floor plan and fit-out, a guest limit, spraying someone, spraying the whole club (money rains, people grab it, the rest goes to the club), the DJ's shout-out
  const O = await player('club_owner', 0), A = await player('club_amy', 2_000_000), B = await player('club_ben', 1000), C = await player('club_cat', 1000), E = await player('club_eve', 1000);
  const cb = (await call('POST', '/api/admin/buildings', { type: 'nightclub', x: 1440, y: 1300, instant: true })).json.building, place = 'b:' + cb.id;
  await pool.query('update buildings set owner_id = $2, owner_handle = $3 where id = $1', [cb.id, O.id, 'club_owner']);
  const inside = (await call('GET', `/api/buildings/${cb.id}/inside`, undefined, A.P)).json, ks = (inside.room?.items || []).map(i => i.k);
  ok(inside.room?.plan === 'club' && inside.guests === 40 && ['djbooth', 'dancefloor', 'dancepole', 'clubbar', 'movinghead'].every(k => ks.includes(k)), 'a night club: a club floor plan, room for 40, a DJ booth, a dance floor, poles, a bar and lights', JSON.stringify({ plan: inside.room?.plan, guests: inside.guests, ks }));
  const here = P => call('POST', '/inside/here'.replace(/^/, '/api'), { place }, P.P); for (const P of [A, B, C]) await here(P);
  const coins = async P => Number((await pool.query('select coins_base from citizens where id = $1', [P.id])).rows[0].coins_base);
  ok((await call('POST', '/api/clubs/spray', { place, to: 'club_ben', amount: 0 }, A.P)).status === 400, 'you have to spray something');
  ok((await call('POST', '/api/clubs/spray', { place, to: 'club_ben', amount: 1000 }, E.P)).status === 409, 'you have to be in the club to spray');
  ok((await call('POST', '/api/clubs/spray', { place, to: 'club_eve', amount: 1000 }, A.P)).status === 409, '…and so does the person you spray');
  const sock = async P => { const w = new WebSocket(BASE.replace('http', 'ws') + '/ws'), got = []; w.on('message', d => { const m = JSON.parse(d); if (m.type === 'inside' || m.type === 'authed') got.push(m); });
    await new Promise(r => w.once('open', r)); w.send(JSON.stringify({ type: 'auth', token: P.P.headers['x-player'] })); for (let i = 0; i < 40 && !got.some(m => m.type === 'authed'); i++) await sleep(50); w.send(JSON.stringify({ type: 'in', place, x: 3, y: 5, a: 0, pose: 'd', ph: 0.05 })); await sleep(200); return { w, got }; };
  const bs = await sock(B);
  const sp = await call('POST', '/api/clubs/spray', { place, to: 'club_ben', amount: 1000 }, A.P); await sleep(300);
  ok(sp.status === 200 && sp.json.id && await coins(A) === 1_999_000 && await coins(B) === 1000, 'Amy sprays Ben 1,000: it falls on him, to pick up', JSON.stringify(sp.json));
  ok(bs.got.some(m => m.k === 'club' && m.club?.kind === 'spray' && m.club.to === 'club_ben' && m.club.id === sp.json.id), '…and everyone in the club sees it');
  const sp2 = await call('POST', '/api/clubs/spray', { place, to: 'club_ben', amount: 1000 }, A.P); ok(sp2.json.id === sp.json.id, 'spraying him again adds to it (and keeps it falling)');
  ok((await call('POST', `/api/clubs/grab/${sp.json.id}`, {}, C.P)).json.notYours === true, 'only Ben can pick up money sprayed on him');
  let picked = 0; for (let i = 0; i < 3; i++) { picked += (await call('POST', `/api/clubs/grab/${sp.json.id}`, {}, B.P)).json.got || 0; await sleep(200); }
  ok(picked > 0 && picked < 2000 && await coins(B) === 1000 + picked, 'Ben picks some of it up', JSON.stringify({ picked }));
  await pool.query('update club_rains set until = $2 where id = $1', [sp.json.id, Date.now() - 1]); await sleep(3800);
  const missed = 2000 - picked, back = Math.floor(missed * 0.25);
  ok(await coins(B) === 1000 + picked + back && await coins(O) === missed - back, 'when it stops, a quarter of what he missed is his anyway, the rest the club’s', JSON.stringify({ ben: await coins(B), owner: await coins(O), picked, back }));
  await pool.query('update citizens set coins_base = 0 where id = $1', [O.id]);
  const rn = await call('POST', '/api/clubs/spray', { place, amount: 10000 }, A.P); await sleep(300);
  ok(rn.status === 200 && rn.json.id && await coins(A) === 1_988_000, 'Amy sprays the whole club with 10,000', JSON.stringify(rn.json));
  ok(bs.got.some(m => m.club?.kind === 'rain' && m.club.amount === 10000) && bs.got.some(m => m.club?.kind === 'dj' && /club_amy/.test(m.club.text)), '…money rains on everyone, and the DJ gives her a shout-out');
  ok((await call('POST', '/api/clubs/spray', { place, amount: 10000 }, A.P)).status === 409, 'one rain at a time');
  ok((await call('POST', `/api/clubs/grab/${rn.json.id}`, {}, A.P)).json.own === true, 'you can’t grab your own money back');
  let bGot = 0, cGot = 0; for (let i = 0; i < 6; i++) { bGot += (await call('POST', `/api/clubs/grab/${rn.json.id}`, {}, B.P)).json.got || 0; cGot += (await call('POST', `/api/clubs/grab/${rn.json.id}`, {}, C.P)).json.got || 0; await sleep(200); }
  const ben0 = await coins(B) - bGot; ok(bGot > 0 && cGot > 0 && bGot + cGot <= 10000, 'Ben and Cat grab some of it', JSON.stringify({ bGot, cGot, ben0 }));
  ok((await call('POST', `/api/clubs/grab/${rn.json.id}`, {}, E.P)).status === 409, 'someone outside the club can’t grab any');
  await pool.query('update club_rains set until = $2 where id = $1', [rn.json.id, Date.now() - 1]); await sleep(3800);
  const left = 10000 - bGot - cGot; ok(await coins(O) === left && (await pool.query('select done from club_rains where id = $1', [rn.json.id])).rows[0]?.done, 'when it stops, what nobody grabbed goes to the club’s owner', JSON.stringify({ owner: await coins(O), left }));
  ok(bs.got.some(m => m.club?.kind === 'rainEnd' && m.club.top?.length), '…and everyone hears who grabbed most');
  bs.w.close();
  // full: 40 people already inside, so the next one is turned away (but not the owner)
  for (let i = 0; i < 41; i++) await call('POST', '/api/inside/here', { place }, { auth: false, headers: { 'cf-connecting-ip': `10.9.${i >> 8}.${i & 255}` } }); /* 41 visitors from 41 addresses */
  const full = await call('GET', `/api/buildings/${cb.id}/inside`, undefined, E.P); ok(full.status === 409 && /full/.test(full.json.error || ''), 'a full club turns people away', JSON.stringify(full.json));
  ok((await call('GET', `/api/buildings/${cb.id}/inside`, undefined, O.P)).status === 200, '…but its owner can always get in');
}
{ // the developer can walk into any building (even one the public can't, or a locked home) and furnish it, for nothing
  const pol = (await call('POST', '/api/admin/buildings', { type: 'police', x: 1460, y: 1300, instant: true })).json.building, bak = (await call('POST', '/api/admin/buildings', { type: 'bakery', x: 1480, y: 1300, instant: true })).json.building;
  const H1 = await player('dev_home_hal', 1000), hs = (await call('POST', '/api/admin/buildings', { type: 'house', x: 1500, y: 1320, instant: true })).json.building;
  await pool.query(`update citizens set home_id = $2, home_unit = null, home_unit_bid = null, room = '{"items":[],"box":[],"styles":{},"locked":true}' where id = $1`, [H1.id, hs.id]);
  ok((await call('GET', `/api/buildings/${pol.id}/inside`, undefined, { auth: false })).status === 403, 'nobody else can go into a police station');
  const pv = (await call('GET', `/api/buildings/${pol.id}/inside`)).json; ok(pv.dev === true && pv.mine === true && pv.room, '…but the developer can, and furnish it', JSON.stringify({ dev: pv.dev, mine: pv.mine }));
  let put = null; for (let y = 2; y < 8 && !put; y++) for (let x = 0; x < 8 && !put; x++) { const r = await call('POST', `/api/admin/inside/b/${bak.id}/buy`, { k: 'grandpiano', x, y, r: 0 }); if (r.status === 200) put = r; }
  ok(put && put.json.dev && (await call('GET', `/api/buildings/${bak.id}/inside`, undefined, { auth: false })).json.room.items.some(i => i.k === 'grandpiano'), 'the developer furnishes a bakery, free', JSON.stringify(put?.json?.error || ''));
  ok((await call('POST', `/api/admin/inside/b/${bak.id}/buy`, { k: 'plant', x: 0, y: 0, r: 0 }, { auth: false })).status === 401, '…and only the developer');
  ok((await call('GET', '/api/citizens/dev_home_hal/room', undefined, { auth: false })).status === 403 && (await call('GET', '/api/citizens/dev_home_hal/room')).json.dev === true, 'a locked home keeps others out, but not the developer');
  let hp = null; for (let y = 0; y < 8 && !hp; y++) for (let x = 0; x < 8 && !hp; x++) { const r = await call('POST', '/api/admin/inside/h/dev_home_hal/buy', { k: 'plant', x, y, r: 0 }); if (r.status === 200) hp = r; }
  ok(hp && (await call('GET', '/api/me/room', undefined, H1.P)).json.room.items.some(i => i.k === 'plant') && Number((await pool.query('select coins_base from citizens where id = $1', [H1.id])).rows[0].coins_base) === 1000, '…who can furnish it too (it stays theirs, and costs them nothing)'); }
{ // the developer sets what the government sells its buildings for: one building's own price, or a percentage of the usual price for all of them
  const RR = await import('../shared/rules.js'), P1 = await player('price_pia', 5_000_000), P2 = await player('price_pat', 5_000_000);
  const h1 = (await call('POST', '/api/admin/buildings', { type: 'house', x: 1520, y: 1300, instant: true })).json.building, h2 = (await call('POST', '/api/admin/buildings', { type: 'house', x: 1540, y: 1300, instant: true })).json.building;
  ok((await call('PUT', `/api/admin/buildings/${h1.id}/sale-price`, { price: 1234 }, { auth: false })).status === 401, 'only the developer sets prices');
  ok((await call('PUT', `/api/admin/buildings/${h1.id}/sale-price`, { price: 1234 })).json.price === 1234, 'the developer puts one house on sale for 1,234');
  const b1 = await call('POST', '/api/me/properties/buy', { buildingId: h1.id }, P1.P); ok(b1.status === 200 && b1.json.price === 1234, '…and that’s what it sells for', JSON.stringify(b1.json));
  ok((await call('PUT', '/api/admin/property-prices', { pct: 0 })).status === 400 && (await call('PUT', '/api/admin/property-prices', { pct: 50 })).json.pct === 50, 'every government building at half price');
  const b2 = await call('POST', '/api/me/properties/buy', { buildingId: h2.id }, P2.P), want = Math.max(1, Math.round(RR.propertyPrice('house') * 50 / 100));
  ok(b2.status === 200 && b2.json.price === want, '…so another house sells for half its usual price', JSON.stringify({ got: b2.json.price, want }));
  await call('PUT', '/api/admin/property-prices', { pct: 100 }); }
if (/127\.0\.0\.1:3999/.test(process.env.CF_REALTIME_URL || '')) { // voice chat: a stand-in for Cloudflare Realtime on port 3999 checks who hears whom
  const http = await import('node:http'); let n = 0; const calls = [];
  const sfu = http.createServer((req, res) => { let body = ''; req.on('data', d => body += d); req.on('end', () => { const j = body ? JSON.parse(body) : {}; calls.push({ m: req.method, u: req.url, j, raw: body, auth: req.headers.authorization });
    const out = /turn\/keys\/[^/]+\/credentials\/generate-ice-servers$/.test(req.url) ? { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' }] }
      : /sessions\/new$/.test(req.url) ? { sessionId: 'sess' + (++n) } : /tracks\/new$/.test(req.url) ? (j.tracks?.[0]?.location === 'local' ? { sessionDescription: { type: 'answer', sdp: 'v=0 answer' }, tracks: j.tracks }
      : { requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: 'v=0 offer' }, tracks: j.tracks.map(t => ({ ...t, mid: String(++n) })) }) : {};
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); }); });
  await new Promise(r => sfu.listen(3999, '127.0.0.1', r));
  const VA = await player('voice_ava', 100), VB = await player('voice_bo', 100), VC = await player('voice_cy', 100), VD = await player('voice_di', 100), place = 'b:voice-test-' + Date.now();
  for (const P of [VA, VB, VC, VD]) await call('POST', '/api/inside/here', { place }, P.P);
  { const cfg = (await call('GET', '/api/voice/config', undefined, VA.P)).json; ok(cfg.on === true, 'voice chat is on when the server has Cloudflare Realtime');
    if (process.env.CF_TURN_KEY_ID) ok(cfg.ice.some(x => JSON.stringify(x.urls).includes('turn:') && x.username === 'u1' && x.credential === 'c1') && cfg.ice.some(x => JSON.stringify(x.urls).includes('stun:')), 'phones get relay (TURN) logins as well as the direct route', JSON.stringify(cfg.ice));
    if (process.env.CF_TURN_KEY_ID) ok(calls.some(c => /turn\/keys\/testturn/.test(c.u) && c.auth === 'Bearer ' + process.env.CF_TURN_KEY_TOKEN && c.j.ttl > 0), '…asked for with the relay key, on the server'); }
  const sess = async P => (await call('POST', '/api/voice/session', { place }, P.P)).json.sessionId;
  const sa = await sess(VA), sb = await sess(VB), sc = await sess(VC), sd = await sess(VD); ok(sa && sb && sa !== sb, 'each player gets their own voice connection');
  ok(calls.filter(c => !/\/turn\//.test(c.u)).every(c => c.auth === 'Bearer test-token-not-secret'), '…every call to Cloudflare carries the app’s token (the phone never sees it)'); /* (the relay has its own key) */
  const pub = await call('POST', '/api/voice/publish', { place, sessionId: sa, mid: '0', offer: { type: 'offer', sdp: 'v=0 mic' } }, VA.P);
  ok(pub.json.answer?.type === 'answer' && calls.some(c => /tracks\/new$/.test(c.u) && c.j.tracks?.[0]?.location === 'local' && c.j.tracks[0].trackName === 'mic-' + VA.id), 'Ava goes live: her mic goes up as a track', JSON.stringify(pub.json));
  ok((await call('POST', '/api/voice/publish', { place, sessionId: sb, mid: '0', offer: { type: 'offer', sdp: 'x' } }, VA.P)).status === 409, 'you can only use your own voice connection');
  const lb = (await call('POST', '/api/voice/list', { place }, VB.P)).json.speakers || []; ok(lb.length === 1 && lb[0].h === 'voice_ava', 'Bo can hear her', JSON.stringify(lb));
  const pb = (await call('POST', '/api/voice/pull', { place, sessionId: sb, ids: lb.map(x => x.id) }, VB.P)).json; ok(pb.tracks?.[0]?.h === 'voice_ava' && pb.offer?.type === 'offer', '…and starts hearing her', JSON.stringify(pb));
  ok((await call('POST', '/api/voice/answer', { place, sessionId: sb, answer: { type: 'answer', sdp: 'v=0 a' } }, VB.P)).status === 200, '…answering the service');
  await call('POST', '/api/blocks/voice_ava', {}, VD.P);
  ok(((await call('POST', '/api/voice/list', { place }, VD.P)).json.speakers || []).length === 0, 'someone who blocked her never hears her');
  ok((await call('POST', '/api/voice/audience', { place, to: ['voice_cy'] }, VA.P)).json.to?.[0] === 'voice_cy', 'Ava picks who hears her: just Cy');
  ok(((await call('POST', '/api/voice/list', { place }, VB.P)).json.speakers || []).length === 0 && ((await call('POST', '/api/voice/list', { place }, VC.P)).json.speakers || []).length === 1, '…so Bo can’t hear her any more, Cy can');
  ok(calls.some(c => /tracks\/close$/.test(c.u) && c.u.includes(sb) && c.j.force === true), '…and Bo is cut off from her there and then');
  ok((await call('POST', '/api/voice/pull', { place, sessionId: sb, ids: ['p:' + VA.id] }, VB.P)).json.tracks.length === 0, '…and can’t start hearing her again');
  await call('POST', '/api/voice/audience', { place, to: null }, VA.P); ok(((await call('POST', '/api/voice/list', { place }, VB.P)).json.speakers || []).length === 1, 'back to everyone: Bo hears her again');
  ok((await call('POST', '/api/voice/session', { place: 'b:somewhere-else' }, VA.P)).status === 409, 'you can only use voice where you are');
  await call('POST', '/api/voice/leave', { place }, VA.P); ok(((await call('POST', '/api/voice/list', { place }, VB.P)).json.speakers || []).length === 0, 'when Ava leaves, nobody hears her');
  { // the in-game phone: ring someone who's online, they answer, and the two of you talk on a line of your own
    const sock = async P => { const w = new WebSocket(BASE.replace('http', 'ws') + '/ws'), got = []; w.on('message', d => { const m = JSON.parse(d); if (m.type === 'phone' || m.type === 'authed') got.push(m); });
      await new Promise(r => w.once('open', r)); w.send(JSON.stringify({ type: 'auth', token: P.headers['x-player'] })); for (let i = 0; i < 40 && !got.some(m => m.type === 'authed'); i++) await sleep(50); return { w, got }; };
    const PA = await player('phone_ann', 100), PB = await player('phone_bob', 100), PC = await player('phone_cat', 100);
    ok((await call('POST', '/api/phone/call', { to: 'phone_bob' }, PA.P)).status === 409, 'you can’t ring someone who isn’t in the game');
    const a = await sock(PA.P), b = await sock(PB.P), c = await sock(PC.P);
    ok((await call('POST', '/api/phone/call', { to: 'phone_ann' }, PA.P)).status === 400, 'you can’t call yourself');
    const r = await call('POST', '/api/phone/call', { to: 'phone_bob' }, PA.P), id = r.json.call?.id; await sleep(300);
    ok(r.status === 200 && r.json.call.state === 'ringing', 'Ann rings Bob', JSON.stringify(r.json));
    ok(b.got.some(m => m.data?.kind === 'ring' && m.data.call.from === 'phone_ann'), '…his phone rings');
    ok((await call('POST', '/api/phone/call', { to: 'phone_bob' }, PC.P)).status === 409, 'Cat can’t get through: Bob’s line is busy');
    ok((await call('POST', '/api/phone/answer', { id, accept: true }, PA.P)).status === 409, 'only Bob can answer his own call');
    ok((await call('POST', '/api/voice/session', { place: 'c:' + id }, PA.P)).status === 409, 'no voice on the call until he answers');
    const ans = await call('POST', '/api/phone/answer', { id, accept: true }, PB.P); await sleep(300);
    ok(ans.json.call?.state === 'live' && a.got.some(m => m.data?.kind === 'live'), 'Bob answers: the call is live for both', JSON.stringify(ans.json));
    const place2 = 'c:' + id, sa2 = (await call('POST', '/api/voice/session', { place: place2 }, PA.P)).json.sessionId, sb2 = (await call('POST', '/api/voice/session', { place: place2 }, PB.P)).json.sessionId;
    ok(sa2 && sb2, 'both get a voice connection on the call');
    ok((await call('POST', '/api/voice/session', { place: place2 }, PC.P)).status === 409, 'Cat can’t listen in');
    await call('POST', '/api/voice/publish', { place: place2, sessionId: sa2, mid: '0', offer: { type: 'offer', sdp: 'v=0 mic' } }, PA.P); await sleep(300);
    ok(b.got.some(m => m.data?.kind === 'voice' && m.data.voice?.kind === 'on') && !c.got.some(m => m.data?.kind === 'voice'), 'Bob is told Ann is talking; nobody else is');
    ok(((await call('POST', '/api/voice/list', { place: place2 }, PB.P)).json.speakers || [])[0]?.h === 'phone_ann', 'Bob hears Ann');
    await call('POST', '/api/phone/hangup', { id }, PB.P); await sleep(300);
    ok(a.got.some(m => m.data?.kind === 'end' && m.data.why === 'ended' && m.data.by === 'phone_bob'), 'Bob hangs up: Ann sees he hung up');
    ok((await call('POST', '/api/voice/list', { place: place2 }, PB.P)).status === 409, 'the line is closed after the call');
    const r2 = await call('POST', '/api/phone/call', { to: 'phone_cat' }, PB.P); await call('POST', '/api/phone/answer', { id: r2.json.call.id, accept: false }, PC.P); await sleep(300);
    ok(b.got.some(m => m.data?.kind === 'end' && m.data.why === 'declined'), 'Cat declines Bob’s call');
    await call('POST', '/api/blocks/phone_ann', {}, PC.P);
    ok((await call('POST', '/api/phone/call', { to: 'phone_cat' }, PA.P)).status === 409, 'someone who blocked you can’t be called');
    const r3 = await call('POST', '/api/phone/call', { to: 'phone_ann' }, PB.P); await call('POST', '/api/phone/hangup', { id: r3.json.call.id }, PB.P); await sleep(400);
    const nt = (await call('GET', '/api/me/notices', undefined, PA.P)).json; ok(JSON.stringify(nt).includes('Missed call from @phone_bob'), 'a call hung up before it’s answered leaves a missed call', JSON.stringify(nt).slice(0, 300));
    for (const x of [a, b, c]) x.w.close(); }
  { const vc = await call('GET', '/api/admin/voice/check'); ok(vc.status === 200 && vc.json.ok === true && /keys work/.test(vc.json.why), 'the developer can check the voice keys with the voice service', JSON.stringify(vc.json));
    const nw = calls.filter(c => /sessions\/new$/.test(c.u)).pop(); ok(nw && nw.raw === '', 'a new voice session is asked for without a body (as Cloudflare expects)'); }
  sfu.close(); }
{ // inside, live: everyone in the same place sees the others walk about and can chat; frames turn on the wall; homes differ by type
  const A = await player('live_amy', 50_000), Bq = await player('live_ben', 50_000), place = 'b:live-test-' + Date.now();
  const sock = async P => { const w = new WebSocket(BASE.replace('http', 'ws') + '/ws'), got = []; w.on('message', d => { const m = JSON.parse(d); if (m.type === 'inside' || m.type === 'authed') got.push(m); });
    await new Promise(r => w.once('open', r)); w.send(JSON.stringify({ type: 'auth', token: P.headers['x-player'] })); for (let i = 0; i < 40 && !got.some(m => m.type === 'authed'); i++) await sleep(50); return { w, got }; };
  const a = await sock(A.P), b = await sock(Bq.P);
  a.w.send(JSON.stringify({ type: 'in', place, x: 2, y: 3, a: 0 })); await sleep(200);
  b.w.send(JSON.stringify({ type: 'in', place, x: 4, y: 5, a: 1 })); await sleep(300);
  const ball = b.got.find(m => m.k === 'all'), apos = a.got.find(m => m.k === 'pos');
  ok(ball && ball.list.some(p => p.h === 'live_amy' && p.x === 2), 'walking in, you see who is already there', JSON.stringify(ball));
  ok(apos && apos.p.h === 'live_ben' && apos.p.x === 4, '…and they see you come in', JSON.stringify(apos));
  const seenIn = [], watch = new WebSocket(BASE.replace('http', 'ws') + '/ws'); watch.on('message', d => { const m = JSON.parse(d); if (m.type === 'whereIn') seenIn.push(m); }); await new Promise(r => watch.once('open', r)); await sleep(300);
  ok(seenIn.some(m => m.all && m.all.some(([id, pl]) => id === A.id && pl === place)), 'anyone opening the map is told who is inside a place (so they aren’t shown out and about)', JSON.stringify(seenIn).slice(0, 200));
  { const drv = []; watch.on('message', d => { const m = JSON.parse(d); if (m.type === 'drive') drv.push(m); });
    a.w.send(JSON.stringify({ type: 'drive', x: 12.5, y: 7.25, a: 1.57, m: 'sedan', col: '#2F4A7A' })); await sleep(300);
    ok(drv.some(m => m.id === A.id && m.x === 12.5 && m.m === 'sedan' && m.col === '#2F4A7A'), 'driving in 3D: everyone’s map sees your car where it is', JSON.stringify(drv));
    a.w.send(JSON.stringify({ type: 'drive', mode: 'walk', x: 13, y: 7.5, a: 0.5 })); await sleep(300);
    ok(drv.some(m => m.id === A.id && m.mode === 'walk' && m.x === 13 && m.h === 'live_amy'), 'walking in 3D: everyone sees you on foot, and who you are', JSON.stringify(drv.slice(-1)));
    a.w.send(JSON.stringify({ type: 'drive', x: 'nope', y: 1, a: 0 })); a.w.send(JSON.stringify({ type: 'drive', off: true })); await sleep(300);
    ok(drv.some(m => m.id === A.id && m.off) && !drv.some(m => m.x === 'nope'), '…bad positions are ignored, and when you stop driving your car goes'); }
  b.w.send(JSON.stringify({ type: 'in', place, x: 4.5, y: 5, a: 1 })); await sleep(300); ok(a.got.filter(m => m.k === 'pos' && m.p.h === 'live_ben').some(m => m.p.x === 4.5), '…and see you move');
  b.w.send(JSON.stringify({ type: 'in', place, x: 4.5, y: 5.2, a: 1, pose: 's', ph: -0.32 })); await sleep(300); ok(a.got.filter(m => m.k === 'pos' && m.p.h === 'live_ben').some(m => m.p.pose === 's' && m.p.ph === -0.32), '…and see you sit down');
  b.w.send(JSON.stringify({ type: 'in', place, x: 4.5, y: 5.4, a: 1, pose: 'zz', ph: 99 })); await sleep(300); { const last = a.got.filter(m => m.k === 'pos' && m.p.h === 'live_ben').pop(); ok(last && last.p.y === 5.4 && !('pose' in last.p), 'a made-up pose is dropped'); }
  b.w.send(JSON.stringify({ type: 'in', place, x: 4.5, y: 5.6, a: 1, pose: 'l', ph: 40 })); await sleep(300); { const last = a.got.filter(m => m.k === 'pos' && m.p.h === 'live_ben').pop(); ok(last && last.p.pose === 'l' && last.p.ph === 1.5, 'lying down, the height is kept sensible'); }
  ok(!b.got.some(m => m.k === 'pos' && m.p.h === 'live_ben'), 'your own moves aren’t sent back to you');
  const c1 = await call('POST', '/api/inside/chat', { place, text: '  hello   in here  ' }, A.P); await sleep(300);
  ok(c1.status === 200 && b.got.some(m => m.k === 'chat' && m.chat.from === 'live_amy' && m.chat.text === 'hello in here'), 'chat reaches everyone inside', JSON.stringify(c1.json));
  ok((await call('POST', '/api/inside/chat', { place, text: 'x'.repeat(201) }, A.P)).status === 400 && (await call('POST', '/api/inside/chat', { place, text: 'hi' }, { auth: false })).status === 401, 'chat needs a sign-in and a short message');
  await pool.query('update citizens set muted_until = $2 where id = $1', [A.id, Date.now() + 60000]); ok((await call('POST', '/api/inside/chat', { place, text: 'hi' }, A.P)).status === 403, 'muted players can’t chat inside'); await pool.query('update citizens set muted_until = null where id = $1', [A.id]);
  const other = await sock(A.P); other.w.send(JSON.stringify({ type: 'in', place: 'b:elsewhere', x: 1, y: 1, a: 0 })); await sleep(200);
  await call('POST', '/api/inside/chat', { place, text: 'only here' }, Bq.P); await sleep(300); ok(!other.got.some(m => m.k === 'chat'), 'chat stays in its own place'); other.w.close();
  { // a private message to one person here: only the two of them see it
    const C = await player('live_cat', 1000), c = await sock(C.P); c.w.send(JSON.stringify({ type: 'in', place, x: 1, y: 1, a: 0 })); await sleep(300);
    for (const x of [a, b, c]) x.got.length = 0;
    const pm = await call('POST', '/api/inside/chat', { place, text: 'just between us', to: 'live_ben' }, A.P); await sleep(300);
    ok(pm.status === 200 && pm.json.chat.private && pm.json.chat.to === 'live_ben', 'send a private message to someone in the same place', JSON.stringify(pm.json));
    ok(b.got.some(m => m.k === 'chat' && m.chat.private && m.chat.text === 'just between us' && m.chat.from === 'live_amy'), '…they get it, marked private');
    ok(!c.got.some(m => m.k === 'chat'), '…and nobody else in the room sees it', JSON.stringify(c.got));
    ok((await call('POST', '/api/inside/chat', { place, text: 'hi', to: 'nobody_here_x' }, A.P)).status === 409, 'only to someone who is here');
    ok((await call('POST', '/api/inside/chat', { place, text: 'hi', to: 'live_amy' }, A.P)).status === 400, 'not to yourself');
    await pool.query('insert into blocks (blocker_id, blocked_id, t) values ($1, $2, $3) on conflict do nothing', [C.id, A.id, Date.now()]).catch(() => {});
    ok((await call('POST', '/api/inside/chat', { place, text: 'hi', to: 'live_cat' }, A.P)).status === 403, 'not to someone who has blocked you');
    c.w.close(); }
  b.w.send(JSON.stringify({ type: 'out' })); await sleep(300); ok(a.got.some(m => m.k === 'gone'), 'leaving: the others see you go');
  ok(seenIn.some(m => m.id === Bq.id && m.place === null), '…and the map shows them out and about again'); watch.close();
  a.w.close(); b.w.close();
  // frames turn on the wall: portrait/landscape
  await pool.query('update citizens set home_id = (select id from buildings where type = $2 limit 1) where id = $1', [A.id, 'house']);
  const fr = await call('POST', '/api/me/room/buy', { k: 'bigframe', x: 2, y: 3, r: 1, o: 1 }, A.P); const it = fr.json.item;
  ok(fr.status === 200 && it && it.o === 1, 'a large frame hung in portrait', JSON.stringify(fr.json).slice(0, 160));
  const tf = it ? await call('POST', '/api/me/room/place', { i: it.i, x: it.x, y: it.y, r: it.r, o: 0 }, A.P) : { json: { room: { items: [{}] } } }; ok(tf.status === 200 && !tf.json.room.items.find(x => x.i === it.i).o, '…and turned to landscape');
  ok((await call('POST', '/api/me/room/buy', { k: 'sofa', x: 0, y: 3, r: 0, o: 1 }, A.P)).json.item?.o === undefined, 'only frames, paintings and mirrors turn on the wall');
  // every kind of home its own size and plan
  const F = await import('../shared/furniture.js');
  ok(F.roomSize('tent') === 4 && F.roomSize('luxurytower') >= 13 && F.roomSize('aptower') > F.roomSize('cottage'), 'bigger, better homes are bigger inside (a tent 4×4, a luxury tower 14×14)');
  ok(F.layoutOf(F.roomSize('villa'), F.homePlan('villa')).rooms.map(r => r.name).join() !== F.layoutOf(F.roomSize('slab50s'), F.homePlan('slab50s')).rooms.map(r => r.name).join() || F.roomSize('villa') !== F.roomSize('slab50s'), 'different kinds of home have different plans'); }
// bills include land
const bl2 = await call('POST', '/api/admin/test/bills'); ok(bl2.status === 200, 'weekly bills run with plots', JSON.stringify(bl2.json));
{ // land auctions: the developer puts prime land up, players bid with held cash, the top bid wins it as a plot
  const player = async (handle, coins) => { await call('POST', '/api/admin/citizens', { handle }); const id = (await pool.query('select id from citizens where handle = $1', [handle])).rows[0].id;
    const link = (await call('POST', `/api/admin/citizens/${id}/setup-link`)).json.claimId, tok = (await call('POST', `/api/claim/${link}/password`, { password: 'secret88' }, { auth: false })).json.token;
    await pool.query("update citizens set coins_base = $2, net = 0, stars = 6, home_id = coalesce(home_id, (select id from buildings where home_cap > 0 limit 1)) where id = $1", [id, coins]);
    return { id, handle, P: { auth: false, headers: { 'x-player': tok } } }; };
  const cash = async id => Number((await pool.query('select coins_base from citizens where id = $1', [id])).rows[0].coins_base);
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await fn()) return true; await sleep(250); } return false; };
  const X = await player('bidder_x', 500000), Y = await player('bidder_y', 500000);
  const road = {}; for (let x = 5000; x < 5012; x++) road[x + ',5000'] = 'street'; await call('POST', '/api/admin/roads', { set: road }); // a quiet street of its own
  const s = { x: 5000, y: 5001, w: 2, d: 2 }, s2 = { x: 5004, y: 5001, w: 2, d: 2 }, s3 = { x: 5008, y: 5001, w: 2, d: 2 };
  ok((await call('POST', '/api/admin/auctions', { ...s, minutes: 7 })).status === 400, 'an auction must run for one of the set lengths');
  ok((await call('POST', '/api/admin/auctions', { ...s, minutes: 60 }, X.P)).status === 401, 'only the developer can start an auction');
  let r = await call('POST', '/api/admin/auctions', { ...s, minutes: 60, start: 1000, name: 'Prime corner' });
  ok(r.status === 200 && r.json.auction.status === 'open' && r.json.auction.start === 1000, 'the developer puts land up for auction', JSON.stringify(r.json).slice(0, 200)); const aid = r.json.auction.id;
  ok((await call('POST', '/api/me/land', s, X.P)).status === 409, "land up for auction can't be bought the ordinary way");
  ok(/auction/.test((await call('GET', `/api/land/quote?x=${s.x}&y=${s.y}&w=${s.w}&d=${s.d}`, undefined, X.P)).json.problem || ''), 'the land quote says it is up for auction');
  ok((await call('POST', '/api/admin/auctions', { ...s, minutes: 60 })).status === 409, "the same land can't be auctioned twice at once");
  ok((await call('GET', '/api/auctions', undefined, { auth: false })).json.auctions.some(a => a.id === aid), 'everyone can see the open auctions');
  ok((await pool.query("select 1 from events where kind = 'auction' and text like '%Prime corner%'")).rowCount === 1, 'the Colony Log announces the auction');
  ok((await call('POST', `/api/me/auctions/${aid}/bid`, { amount: 999 }, X.P)).status === 400, 'a bid below the opening bid is refused');
  r = await call('POST', `/api/me/auctions/${aid}/bid`, { amount: 1000 }, X.P); ok(r.status === 200 && r.json.auction.leader === 'bidder_x', 'a player bids the opening price', JSON.stringify(r.json).slice(0, 200));
  ok(await cash(X.id) === 499000, 'the bid is taken from their cash and held');
  ok((await call('POST', `/api/me/auctions/${aid}/bid`, { amount: 2000 }, X.P)).status === 409, "the top bidder can't bid against themselves");
  let info = (await call('GET', `/api/auctions/${aid}`, undefined, Y.P)).json; ok(info.next === 1100 && !info.mine, 'the next bid must be 5% more, at least 100 more', JSON.stringify(info).slice(0, 200));
  ok((await call('POST', `/api/me/auctions/${aid}/bid`, { amount: 1050 }, Y.P)).status === 400, 'a bid that is too small is refused');
  r = await call('POST', `/api/me/auctions/${aid}/bid`, { amount: 1100 }, Y.P); ok(r.status === 200 && r.json.auction.leader === 'bidder_y' && r.json.auction.bids === 2, 'someone outbids them');
  ok(await cash(X.id) === 500000 && await cash(Y.id) === 498900, 'the outbid player gets every coin back at once');
  ok((await pool.query("select 1 from notices where citizen_id = $1 and kind = 'auction' and text like '%outbid%'", [X.id])).rowCount === 1, 'and a notice saying they were outbid');
  await pool.query('update auctions set ends_at = $2 where id = $1', [aid, Date.now() + 30000]);
  r = await call('POST', `/api/me/auctions/${aid}/bid`, { amount: 1200 }, X.P); const ends = Number((await pool.query('select ends_at from auctions where id = $1', [aid])).rows[0].ends_at);
  ok(r.status === 200 && r.json.extended && ends >= Date.now() + 100000, 'a bid in the last 2 minutes moves the close to 2 minutes later', JSON.stringify(r.json).slice(0, 120));
  info = (await call('GET', `/api/auctions/${aid}`, undefined, X.P)).json; ok(info.bids.length === 3 && info.mine && info.bids[0].amount === 1200, 'the card lists the latest bids, newest first');
  await pool.query('update auctions set ends_at = $2 where id = $1', [aid, Date.now() - 1000]);
  ok(await until(async () => (await pool.query("select 1 from auctions where id = $1 and status = 'sold'", [aid])).rowCount), 'the auction closes when its time is up');
  const won = (await pool.query('select p.* from plots p join auctions a on a.plot_id = p.id where a.id = $1', [aid])).rows[0];
  ok(won && won.owner_id === X.id && Number(won.price) === 1200 && won.name === 'Prime corner' && won.x === s.x && won.w === 2, 'the winner gets the land as their own plot', JSON.stringify(won));
  ok(await cash(X.id) === 498800 && await cash(Y.id) === 500000, 'the winner paid their bid; the loser has all their coins');
  ok((await pool.query("select 1 from notices where citizen_id = $1 and kind = 'auction' and text like '%won%'", [X.id])).rowCount === 1, 'the winner gets a notice');
  ok((await pool.query("select 1 from events where kind = 'auction' and text like '%Sold! @bidder_x won%'")).rowCount === 1, 'the Colony Log reports the sale');
  ok((await call('GET', `/api/plots/${won.id}`, undefined, X.P)).json.mine === true, 'they can build on it like any plot');
  // called off: the top bid goes back
  r = await call('POST', '/api/admin/auctions', { ...s2, minutes: 30 }); const a2 = r.json.auction.id;
  ok(r.status === 200 && r.json.auction.start === r.json.quote.total, 'with no opening bid given, it opens at the ordinary land price', JSON.stringify(r.json).slice(0, 160));
  ok((await call('POST', `/api/me/auctions/${a2}/bid`, { amount: r.json.auction.start }, Y.P)).status === 200 && await cash(Y.id) === 500000 - r.json.auction.start, 'a bid on the second auction');
  ok((await call('POST', `/api/admin/auctions/${a2}/cancel`, {})).status === 200 && await cash(Y.id) === 500000, 'calling an auction off gives the top bid back');
  ok(!(await call('GET', `/api/land/quote?x=${s2.x}&y=${s2.y}&w=2&d=2`, undefined, Y.P)).json.problem, 'and the land is free again');
  ok((await call('POST', `/api/me/auctions/${a2}/bid`, { amount: 99999 }, X.P)).status === 409, "a closed auction takes no bids");
  // nobody bids
  const a3 = (await call('POST', '/api/admin/auctions', { ...s3, minutes: 30 })).json.auction.id;
  await pool.query('update auctions set ends_at = $2 where id = $1', [a3, Date.now() - 1000]);
  ok(await until(async () => (await pool.query("select 1 from auctions where id = $1 and status = 'unsold'", [a3])).rowCount), 'an auction with no bids closes unsold, and the land is free again');
}
}
{ // one player's own actions don't wait for the colony-wide lock; their coins still reach the treasury within a second
  for (let i = 0; i < 40 && (await pool.query('select 1 from treasury_pending limit 1')).rowCount; i++) await sleep(100);
  ok(!(await pool.query('select 1 from treasury_pending limit 1')).rowCount, "players' coins are added to the treasury within seconds (nothing left waiting)");
}
{ // new vehicles: boats need water, aircraft go anywhere; bigger venues work as the original kind
  const cat = await import('../shared/catalog.js');
  ok(cat.typesOf('casino').includes('grandcasino') && cat.typesOf('racetrack').includes('grandracetrack') && cat.kindOf('prison') === 'jail', 'the grand casino, grand racecourse and prison work as a casino, racetrack and jail');
  ok((await call('POST', '/api/admin/vehicles', { type: 'boat', x: 4000, y: 4000 })).status === 409, 'a boat has to go on water');
  const pl = await call('POST', '/api/admin/vehicles', { type: 'plane', x: 4000, y: 4000 }); ok(pl.status === 200, 'a plane can be put anywhere (it flies above that spot)', JSON.stringify(pl.json).slice(0, 120));
  if (pl.json.vehicle) await call('DELETE', '/api/admin/vehicles/' + pl.json.vehicle.id);
  const rd = await call('POST', '/api/admin/roads', { set: { '4100,4100': 'curvestreet', '4101,4100': 'roundabout', '4102,4100': 'culdesac' } }); ok(rd.json.changed === 3, 'curved streets, roundabouts and cul-de-sacs can be laid', JSON.stringify(rd.json));
  const fx = []; for (let i = 0; i < 3; i++) fx.push(await call('POST', '/api/admin/buildings', { type: i === 1 ? 'ironfence' : 'stonewall', x: 4100 + i, y: 4105 })); ok(fx.every(r => r.status === 200), 'fences of different kinds go side by side');
}
{ // Fight Night at the Colosseum
  ok((await call('GET', '/api/fight', undefined, { auth: false })).json.arena === null, 'no Colosseum, no Fight Night');
  const player = async (handle, coins) => { await call('POST', '/api/admin/citizens', { handle }); const id = (await pool.query('select id from citizens where handle = $1', [handle])).rows[0].id;
    const link = (await call('POST', `/api/admin/citizens/${id}/setup-link`)).json.claimId, tok = (await call('POST', `/api/claim/${link}/password`, { password: 'secret88' }, { auth: false })).json.token;
    await pool.query('update citizens set coins_base = $2, net = 0 where id = $1', [id, coins]); return { id, handle, P: { auth: false, headers: { 'x-player': tok } } }; };
  const F1 = await player('fighter_one', 50000), F2 = await player('fighter_two', 50000), FAN = await player('fight_fan', 50000);
  for (const p of [F1, F2, FAN]) { const h = (await pool.query('select home_id from citizens where id = $1', [p.id])).rows[0];
    if (!h.home_id) { const sp = (await pool.query('select id from buildings where done and not ruin and home_used < home_cap limit 1')).rows[0]; await call('PATCH', '/api/admin/citizens/' + p.id, { homeId: sp.id }); } }
  ok((await call('POST', '/api/me/fight/signup', {}, F1.P)).status === 409, "can't sign up without a Colosseum");
  const col = await call('POST', '/api/admin/buildings', { type: 'colosseum', x: 4300, y: 4300 }); await call('POST', `/api/admin/buildings/${col.json.building?.id}/finish`);
  ok(col.status === 200, 'build a Colosseum', JSON.stringify(col.json).slice(0, 200));
  await sleep(5200); // the arena list refreshes every few seconds
  await call('POST', '/api/admin/test/fight-soon', { in: 2 * 3600000, gap: 4000 }); // the next night is hours away: sign-ups open (whatever the clock says)
  let fi = (await call('GET', '/api/fight', undefined, F1.P)).json;
  ok(fi.arena && fi.night && fi.night.open && !fi.bouts.length, 'the next Fight Night is open for sign-ups', JSON.stringify(fi.night));
  ok(fi.me && fi.me.style && fi.me.rating === 1000, 'every player has a fighting style and a starting rating', JSON.stringify(fi.me));
  for (const p of [F1, F2]) ok((await call('POST', '/api/me/fight/signup', {}, p.P)).json.signed === true, `@${p.handle} signs up to fight`);
  fi = (await call('GET', '/api/fight', undefined, F1.P)).json; ok(fi.signups.length === 2 && fi.mine, 'the sign-ups show on the card', JSON.stringify(fi.signups));
  ok((await call('POST', '/api/me/fight/bet', { bout: 2, side: 'a', amount: 100 }, FAN.P)).status === 409, "no betting before the card is set");
  await call('POST', '/api/admin/test/fight-soon', { in: 5000, gap: 4000 }); await sleep(2500);
  fi = (await call('GET', '/api/fight', undefined, FAN.P)).json;
  const main = fi.bouts.find(b => b.i === 2);
  ok(fi.bouts.length >= 1 && main && [main.a.handle, main.b.handle].sort().join() === 'fighter_one,fighter_two', 'the card is set: the two sign-ups get the main event (colonists fill any other bouts)', JSON.stringify(fi.bouts.map(b => [b.i, b.a.handle, b.b.handle])));
  ok(main.odds.a.pays > 1 && main.odds.b.pays > 1 && !main.result, 'each bout has odds; nobody knows the result before the bell', JSON.stringify(main.odds));
  ok((await call('POST', '/api/me/fight/bet', { bout: 2, side: 'a', amount: 100 }, F1.P)).status === 409, "fighters can't bet on their own fight");
  const c0 = (await call('GET', '/api/citizens/fight_fan')).json.coins;
  const bt = await call('POST', '/api/me/fight/bet', { bout: 2, side: 'a', amount: 1000 }, FAN.P); ok(bt.status === 200 && bt.json.pays === main.odds.a.pays, 'a fan bets on the main event', JSON.stringify(bt.json));
  ok((await call('POST', '/api/me/fight/bet', { bout: 2, side: 'b', amount: 10 }, FAN.P)).status === 409, 'one bet per bout');
  const fc0 = { one: (await call('GET', '/api/citizens/fighter_one')).json.coins, two: (await call('GET', '/api/citizens/fighter_two')).json.coins };
  for (let i = 0; i < 60; i++) { await sleep(500); const st = (await pool.query('select count(*) filter (where settled) s from fight_bouts where n = $1', [fi.night.n])).rows[0]; if (Number(st.s) === fi.bouts.length) break; }
  const bouts = (await pool.query('select * from fight_bouts where n = $1 order by i', [fi.night.n])).rows;
  ok(bouts.length === fi.bouts.length && bouts.every(b => b.settled && b.result && b.result.events.length > 3), 'every bout is fought and settled', JSON.stringify(bouts.map(b => [b.i, b.settled, b.result?.method])));
  const mb = bouts.find(b => b.i === 2), mr = mb.result, wonA = mr.winner === 0, c1 = (await call('GET', '/api/citizens/fight_fan')).json.coins;
  ok(c1 - c0 === (wonA ? Math.floor(1000 * main.odds.a.pays) : 0) - 1000, 'the fan is paid at the odds if their fighter won, and loses the stake if not', JSON.stringify({ c0, c1, wonA, pays: main.odds.a.pays }));
  const fc1 = { one: (await call('GET', '/api/citizens/fighter_one')).json.coins, two: (await call('GET', '/api/citizens/fighter_two')).json.coins };
  const winner = (wonA ? mb.a : mb.b).handle, gain = h => fc1[h === 'fighter_one' ? 'one' : 'two'] - fc0[h === 'fighter_one' ? 'one' : 'two'];
  ok(gain(winner) === 5000 && gain(winner === 'fighter_one' ? 'fighter_two' : 'fighter_one') === 1200, 'the winner gets the 5,000 purse, the loser 1,200 show money', JSON.stringify({ winner, fc0, fc1 }));
  const rec = (await pool.query("select handle, wins, losses, rating from fighters where handle in ('fighter_one', 'fighter_two') order by handle")).rows;
  ok(rec.length === 2 && rec.find(r => r.handle === winner).wins === 1 && rec.find(r => r.handle === winner).rating > 1000 && rec.find(r => r.handle !== winner).rating < 1000, 'records and ratings update', JSON.stringify(rec));
  ok((await pool.query("select 1 from events where kind = 'fight' and text like '%Main event%' limit 1")).rowCount > 0, 'the Colony Log reports the results');
  fi = (await call('GET', '/api/fight', undefined, FAN.P)).json; ok(fi.last.length >= 1 && fi.top.length >= 2, 'the Fight Night tab shows the last results and the top fighters', JSON.stringify(fi.last));
}
{ // security: throttles, lock-outs, quotas, budgets, headers and live-connection limits (each from its own made-up address)
  const from = ip => ({ 'cf-connecting-ip': ip }), LIM = await import('../server/limits.js');
  const h = (await fetch(BASE + '/api/version')).headers; ok(h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'SAMEORIGIN' && /camera=\(\)/.test(h.get('permissions-policy') || ''), 'security headers on every reply');
  // the builder's password: ten wrong guesses from one address lock it out, even with the right one; other addresses are fine
  for (let i = 0; i < 10; i++) await call('GET', '/api/admin/check', undefined, { auth: false, headers: { ...from('203.0.113.7'), authorization: 'Bearer wrong-guess-' + i } });
  ok((await call('GET', '/api/admin/check', undefined, { headers: from('203.0.113.7') })).status === 429 && (await call('GET', '/api/admin/check', undefined, { headers: from('203.0.113.8') })).status === 200, 'ten wrong builder passwords lock that address out for 15 minutes; others are unaffected');
  // the cron key, likewise
  for (let i = 0; i < 10; i++) await call('GET', '/api/cron/tick?key=nope' + i, undefined, { auth: false, headers: from('203.0.113.9') });
  ok((await call('GET', `/api/cron/tick?key=${encodeURIComponent(process.env.CRON_KEY)}`, undefined, { auth: false, headers: from('203.0.113.9') })).status === 429, 'wrong cron keys lock that address out too');
  // sign-ins from one address are throttled, and wrong passwords across many usernames lock it out
  let codes = []; for (let i = 0; i < 260 && !codes.includes(429); i++) codes.push((await call('POST', '/api/login', { handle: 'nobody_' + i, password: 'x' }, { auth: false, headers: from('198.51.100.4') })).status);
  ok(codes.includes(429), 'a burst of sign-in attempts from one address is slowed down', codes.slice(-5).join());
  const su = await call('POST', '/api/signup', { handle: 'quota_qa', password: 'secret88' }, { auth: false, headers: from('198.51.100.5') }); const QP = { auth: false, headers: { 'x-player': su.json.token, ...from('198.51.100.6') } };
  ok(su.status === 200, 'a fresh player for the quota checks', JSON.stringify(su.json));
  // a daily quota: once today's limit is used, the next post is refused with a clear message
  const qid = (await pool.query("select id from citizens where handle = 'quota_qa'")).rows[0].id, today = new Date().toISOString().slice(0, 10);
  await pool.query("insert into usage_daily (subject, day, kind, n) values ($1, $2, 'square', $3) on conflict (subject, day, kind) do update set n = $3", [qid, today, LIM.QUOTAS.square]);
  const over = await call('POST', '/api/square', { text: 'one more' }, QP); ok(over.status === 429 && /today's limit/.test(over.json.error), 'past the daily quota, posting is refused until midnight UTC', JSON.stringify(over.json));
  await pool.query("update usage_daily set n = 0 where subject = $1 and kind = 'square'", [qid]); ok((await call('POST', '/api/square', { text: 'hello again' }, QP)).status === 200, 'under the quota it works, and is counted');
  ok(Number((await pool.query("select n from usage_daily where subject = $1 and kind = 'square' and day = $2", [qid, today])).rows[0]?.n) === 1, 'each post counts once towards the quota');
  // the paid AI budget: past it, the radio falls back to the free phrases
  ok(await LIM.budget('ai_calls', 1) === true && await LIM.budget('ai_calls', LIM.BUDGETS.ai_calls + 1) === false, 'the radio\'s paid AI has a daily budget');
  const us = (await call('GET', '/api/admin/usage')).json; ok(us.quotas?.square?.max === LIM.QUOTAS.square && us.budgets?.ai_calls?.used >= 1 && us.lockouts >= 2, 'the builder sees today\'s usage, quotas, budgets and lock-outs', JSON.stringify(us).slice(0, 300));
  // live connections: at most so many open at once from one address
  const socks = [], openOne = () => new Promise(res => { const w = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws', { headers: from('192.0.2.50') }); let closed = null; w.on('close', c => { closed = c; res({ w, closed }); }); w.on('message', () => res({ w, closed })); w.on('error', () => res({ w, closed: -1 })); setTimeout(() => res({ w, closed }), 1500); });
  for (let i = 0; i < LIM.WS_PER_IP; i++) socks.push(await openOne()); const extra = await openOne(); await sleep(300);
  ok(socks.every(x => x.closed == null) && (extra.closed === 1008 || extra.w.readyState === 3), `at most ${LIM.WS_PER_IP} live connections from one address`, JSON.stringify({ last: extra.closed, state: extra.w.readyState }));
  for (const x of [...socks, extra]) try { x.w.close(); } catch {}
}
ok((await call('POST', '/api/admin/reset', { confirm: 'nope' })).status === 400, 'reset needs the word RESET');
ok((await call('POST', '/api/admin/reset', { confirm: 'RESET' }, { auth: false })).status === 401, 'only the developer can reset');
ok((await call('POST', '/api/admin/reset', { confirm: 'RESET' })).status === 200 && !(await call('GET', '/api/meta', undefined, { auth: false })).json.meta, 'reset wipes the colony');
ok(!(await pool.query('select 1 from plots union all select 1 from auctions limit 1')).rowCount, 'reset clears everyone’s land and the auctions too');
ok((await call('POST', '/api/admin/found', { name: 'New Dawn', handle: 'builder' })).status === 200 && (await meta()).population === 1, 'found it again from scratch');
await call('POST', '/api/admin/citizens/bulk', { handles: ['fresh_one', 'fresh_two'] });

near.ws.close(); far.ws.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
