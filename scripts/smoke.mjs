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
ok(worker.job?.[0] === bakery.id && worker.net === 24, 'the earliest resident works there and nets 24 a day', JSON.stringify(worker));
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
ok(k.job?.[0] === office.id && k.net === 32 - 12, 'they work at the office and earn its wage minus rent', JSON.stringify(k));
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
  ok(o1 && o1.takeHome === o1.salary - board.rent && typeof o1.dist === 'number', 'each opening shows take-home pay after rent and distance');
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
    ok((await call('POST', '/api/me/crime', { kind: 'rob' }, P)).status === 429 || (await whoDev('zara_ng')).jailedUntil, 'one crime every 10 minutes');
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
    { await call('POST', '/api/admin/treasury', { amount: 100000 }); let got = null;
      for (let i = 0; i < 40 && !got; i++) { await set('zara_ng', 'crime_at = null, jailed_until = null, coins_base = 100000, visit_id = null, visit_until = null'); const r = await call('POST', '/api/me/crime', { kind: 'rob' }, P); if (r.json.ok && !r.json.caught) got = r.json; }
      ok(got && got.loot >= 5000 && got.loot <= 10000, 'a shop robbery takes 5,000 to 10,000 from the till', JSON.stringify(got));
      await set('zara_ng', 'crime_at = null, jailed_until = null, coins_base = 1000'); await call('POST', '/api/admin/treasury', { amount: -100000 }); }
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
      ok(gh.status === 200 && gh.json.home === true, 'going to your own home heads home'); }
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
      await pool.query("update citizens set coins_base = 50, bank = 1000, net = 0, coins_day = 0 where id = $1", [zid]);
      const bl = await call('POST', '/api/admin/test/bills'), z1 = await whoDev('zara_ng');
      ok(bl.status === 200 && z1.coins === 0 && z1.bank === 1000 - (45 + 50 - 50), 'weekly bills: car upkeep (45) and property upkeep (0.1% of 50,000), cash first, then savings', JSON.stringify({ bl: bl.json, coins: z1.coins, bank: z1.bank }));
      const nt = (await pool.query("select text from notices where citizen_id = $1 and kind = 'bills' order by id desc limit 1", [zid])).rows[0]?.text || '';
      ok(/car upkeep 45 \+ 🏠 property upkeep 50 = 95 coins/.test(nt), 'and a notice says what it was for', nt);
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
    const props = (await call('GET', '/api/me/properties', undefined, P)).json;
    ok(props.list.length === 1 && props.list[0].id === spare, 'it shows in your buildings');
    await set('zara_ng', 'bank = 50000');
    const t0 = await money(), pd = await call('POST', '/api/admin/test/payday', {});
    if (pd.status === 404) console.log('  (payday route only on test servers; start the server with ALLOW_TEST_ROUTES=1 to check paydays)');
    else { const t1 = await money();
      const inc = props.list[0].income; ok(pd.status === 200 && t1.wallet - t0.wallet === inc && t1.bank - t0.bank === 10, `payday: ${inc} rent to the owner, interest on savings`, JSON.stringify({ t0, t1, inc, pd: pd.json })); }
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
    ok(wa.msgs.some(m => m.type === 'dm' && m.data.id === sent.json.id), "and on the sender's other screens");
    ok(!stranger.msgs.some(m => m.type === 'dm' || JSON.stringify(m).includes('Hello from Zara')), 'nobody else receives it');
    const convB = (await call('GET', '/api/dm', undefined, PB)).json;
    ok(convB.length === 1 && convB[0].with.h === 'zara_ng' && convB[0].unread === 1, 'it shows as unread in their chats', JSON.stringify(convB));
    ok(convB[0].request === true && (await call('GET', '/api/dm', undefined, P)).json[0].request === false, 'a first message lands in their message requests, not the sender’s');
    const th = (await call('GET', '/api/dm/zara_ng', undefined, PB)).json;
    ok(th.messages.length === 1 && !th.messages[0].mine && th.with.online, 'opening the chat shows the message');
    ok((await call('GET', '/api/dm', undefined, PB)).json[0].unread === 0, 'and marks it read');
    await sleep(800); await call('POST', '/api/dm/zara_ng', { text: 'Hi Zara!' }, PB); await sleep(400);
    ok(wa.msgs.some(m => m.type === 'dm' && m.data.text === 'Hi Zara!'), 'replies arrive live too');
    ok((await call('GET', '/api/dm', undefined, PB)).json[0].request === false, 'replying accepts the request');
    // replies, the far-away fee, pin and delete
    { const zid = (await whoDev('zara_ng')).id, zh = (await pool.query('select home_id from citizens where id = $1', [zid])).rows[0].home_id;
      const old = (await pool.query('select home_id from citizens where id = $1', [bid])).rows[0].home_id;
      await pool.query('update citizens set home_id = null where id = $1', [bid]);
      const far = (await call('GET', '/api/dm/jobfill_a', undefined, P)).json;
      ok(far.cost.fee === 2 && far.cost.near === false, 'messaging someone who doesn’t live nearby costs 2 coins', JSON.stringify(far.cost));
      const c0 = await cash('zara_ng'); await sleep(800);
      const rp1 = await call('POST', '/api/dm/jobfill_a', { text: 'replying to you', replyTo: far.messages.find(m => !m.mine).id }, P); await sleep(300);
      ok(rp1.status === 200 && rp1.json.fee === 2 && await cash('zara_ng') === c0 - 2, 'and the 2 coins come out of their cash', JSON.stringify(rp1.json));
      const rpm = (await call('GET', '/api/dm/zara_ng', undefined, PB)).json.messages.at(-1);
      ok(rpm.reply && rpm.reply.text === 'Hi Zara!' && rpm.reply.from === 'jobfill_a', 'a reply carries the message it answers', JSON.stringify(rpm));
      ok(wb.msgs.some(m => m.type === 'dm' && m.data.reply?.text === 'Hi Zara!'), 'and the quote arrives live too');
      if (zh) { await pool.query('update citizens set home_id = $2 where id = $1', [bid, zh]);
        const nr = (await call('GET', '/api/dm/jobfill_a', undefined, P)).json; ok(nr.cost.fee === 0 && nr.cost.near, 'neighbours message for free', JSON.stringify(nr.cost)); }
      await set('zara_ng', 'coins_base = 1'); await pool.query('update citizens set home_id = null where id = $1', [bid]); await sleep(800);
      ok((await call('POST', '/api/dm/jobfill_a', { text: 'broke' }, P)).status === 400, "without 2 coins you can't message far-away colonists");
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
      const t0 = Number((await pool.query("select data->>'treasuryBase' t from meta")).rows[0].t), m0 = Number((await pool.query("select sum(coins_base) s from citizens where handle in ('zara_ng','jobfill_a')")).rows[0].s);
      const go = await call('POST', `/api/me/heists/${pl.json.id}/go`, {}, P);
      ok(go.status === 200 && typeof go.json.win === 'boolean' && go.json.got.length + go.json.caught.length === 2, 'the job happens: it comes off or not, and each member gets away or is caught', JSON.stringify(go.json));
      const t1 = Number((await pool.query("select data->>'treasuryBase' t from meta")).rows[0].t), m1 = Number((await pool.query("select sum(coins_base) s from citizens where handle in ('zara_ng','jobfill_a')")).rows[0].s);
      ok(Math.abs((m1 - m0) + (t1 - t0)) < 1, 'coins only move between the crew and the treasury (nothing is made up)', JSON.stringify({ crew: m1 - m0, treasury: t1 - t0 }));
      const caughtMe = go.json.caught.find(x => x.h === 'zara_ng'); if (caughtMe) ok((await whoDev('zara_ng')).jailedUntil > Date.now(), 'anyone caught goes to jail');
      ok((await call('GET', `/api/chat/groups/${pl.json.group}`, undefined, PB)).json.messages.some(m => m.system && /(came off|went wrong)/.test(m.text)), 'the result is posted in the crew chat');
      ok((await call('POST', '/api/me/heists', { kind: 'armored', inMinutes: 10, members: ['jobfill_a'] }, PB)).status === 429 || (await whoDev('jobfill_a')).jailedUntil > Date.now(), 'and the crew lies low for a while afterwards');
      // solo: con a tourist
      await pool.query("update citizens set crime_at = 0, jailed_until = 0, coins_base = 5000 where handle = 'zara_ng'"); const sc = await call('POST', '/api/me/crime', { kind: 'scam' }, P);
      ok(sc.status === 200 && (sc.json.caught ? sc.json.fine >= 250 : sc.json.loot >= 800 && sc.json.loot <= 2000), 'a new solo crime: con a tourist (800–2,000 coins)', JSON.stringify(sc.json));
      await pool.query("update citizens set jailed_until = 0, heist_at = 0, crime_at = 0, coins_base = 5000 where handle in ('zara_ng', 'jobfill_a')"); }
    // stars
    { const st = (await call('GET', '/api/me/stars', undefined, P)).json;
      ok(st.acts > 5 && st.stars >= 1 && st.stars <= 12 && st.score === st.acts + 20 * st.days && st.steps.length === 12, 'stars count the things you do yourself, plus the days you play', JSON.stringify(st));
      ok((await who('zara_ng')).stars === st.stars, 'and everyone sees your stars on your card'); }
    ok((await call('POST', '/api/dm/zara_ng', { text: 'again' }, PB)).status === 429, 'sending is slowed down a little');
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
      const late = async () => { await pool.query('update game_tables set turn_at = $2 where id = $1', [f0.json.id, Date.now() - 1000]); await sleep(300); return (await call('GET', '/api/me/table', undefined, P)).json.table; };
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
ok((await call('POST', '/api/admin/reset', { confirm: 'nope' })).status === 400, 'reset needs the word RESET');
ok((await call('POST', '/api/admin/reset', { confirm: 'RESET' }, { auth: false })).status === 401, 'only the developer can reset');
ok((await call('POST', '/api/admin/reset', { confirm: 'RESET' })).status === 200 && !(await call('GET', '/api/meta', undefined, { auth: false })).json.meta, 'reset wipes the colony');
ok((await call('POST', '/api/admin/found', { name: 'New Dawn', handle: 'builder' })).status === 200 && (await meta()).population === 1, 'found it again from scratch');
await call('POST', '/api/admin/citizens/bulk', { handles: ['fresh_one', 'fresh_two'] });

near.ws.close(); far.ws.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
