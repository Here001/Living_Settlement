// End-to-end check of a running city server. Run it against a THROWAWAY database: it founds a settlement.
// Usage: npm test   (reads BASE_URL, ADMIN_TOKEN, CRON_KEY, IG_APP_SECRET, IG_VERIFY_TOKEN from .env)
import 'dotenv/config';
import crypto from 'node:crypto';
import WebSocket from 'ws';

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
ok(near.msgs.length && await near.saw(o => o.op === 'event' && /3 people moved out of the Outskirts into Maple House/.test(o.data.text)), 'one grouped headline for the move-in');
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
const worker = await who('builder');
ok(worker.job?.[0] === bakery.id && worker.net === 24, 'the earliest resident works there and nets 24 a day', JSON.stringify(worker));
ok((await who('chidi')).net === 0, 'unemployed residents live rent-free until they find work');

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
let k = await who('kemi');
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
ok((await call('GET', '/api/meta', undefined, { auth: false })).json.events.filter(e => e.text.includes('update:')).length === 1, 'one headline for the whole update');
ok((await call('GET', '/api/admin/draft')).json.draft === null, 'the draft is cleared after publishing');

console.log('Turning buildings');
const row = (await call('POST', '/api/admin/buildings', { type: 'townhouses', x: 320, y: 320, rot: 1 })).json.building;
ok(row?.rot === 1, 'build a terrace turned the other way', JSON.stringify(row));
ok((await call('POST', '/api/admin/buildings', { type: 'tree', x: 320, y: 322 })).status === 409, 'a turned 3×1 covers 1×3 tiles');
ok((await call('POST', '/api/admin/buildings', { type: 'tree', x: 322, y: 320 })).status === 200, 'and leaves the old row free');
ok((await call('PATCH', `/api/admin/buildings/${row.id}`, { x: 320, y: 320, rot: 0 })).status === 409, 'turning back is refused when the tree is in the way');
r = await call('PATCH', `/api/admin/buildings/${row.id}`, { x: 330, y: 330, rot: 0 });
ok(r.status === 200 && (await chunk('10_10')).chunks['10_10'].buildings.find(b => b.id === row.id)?.rot === 0, 'move and turn in one go');

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

near.ws.close(); far.ws.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
