import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { pool, migrate } from './db.js';
import { World, HttpError } from './world.js';
import { createBus } from './bus.js';
import { instagramRouter, igStatus, connectInstagram, loadIgStatus } from './instagram.js';
import { playersRouter, sweepPlayers, playerFrom, playerByToken } from './players.js';
import { Chat, ONLINE_WINDOW } from './chat.js';
import { Achievements } from './achievements.js';
import { Leaderboards } from './leaderboards.js';
import { CasinoTables } from './tables.js';
import { GameHouse } from './gamehouse.js';
import { Heists } from './heists.js';
import { Stars } from './stars.js';
import { GameTables } from './gametables.js';
import { Earn } from './earn.js';
import { ColonyEvents } from './colonyevents.js';
import { Races } from './races.js';
import { Actions } from './actions.js';
import { Guide } from './guide.js';
import { Push } from './push.js';
import { Elections } from './elections.js';
import { Lottery } from './lottery.js';
import { Economy } from './economy.js';
import { GAME_MIN_MS } from '../shared/rules.js';
import * as R from '../shared/rules.js';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 3000);
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL (see .env.example).'); process.exit(1); }
if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 16) { console.error('Set ADMIN_TOKEN to a long random string (16+ characters).'); process.exit(1); }

// Last line of defence: log anything that slipped through instead of taking the whole colony offline.
process.on('unhandledRejection', e => console.error('unhandled rejection:', e));
// Before the server is up (database migration, first load), a failure must stop the process so the host restarts it
// and the deploy shows as failed, rather than leaving a server that never answers.
let started = false;
process.on('uncaughtException', e => { console.error('uncaught exception:', e); if (!started) process.exit(1); });

const bus = createBus();
const world = new World(bus);
const races = new Races(world); world.races = races;
const lottery = new Lottery(world); world.lottery = lottery;
const economy = new Economy(world); world.economy = economy;
const chat = new Chat(bus); world.chat = chat; chat.world = world;
const push = new Push(); world.push = push; chat.push = push;
const achievements = new Achievements(world, bus); world.achievements = achievements;
const leaderboards = new Leaderboards(world); world.leaderboards = leaderboards;
world.tables = new CasinoTables(world);
world.gamehouse = new GameHouse(world);
world.gametables = new GameTables(world);
world.heists = new Heists(world);
world.stars = new Stars(world, bus);
setInterval(() => world.gametables.sweep().catch(e => console.error('tables:', e.message)), 10000).unref(); // slow turns and unfilled tables
setInterval(() => world.heists.sweep().catch(e => console.error('heists:', e.message)), 15000).unref(); // planned group crimes that are due
world.earn = new Earn(world); world.guide = new Guide(world); world.elections = new Elections(world);
const cevents = new ColonyEvents(world, bus); world.cevents = cevents;
setInterval(() => { if (isLeader && world.meta) cevents.tick().catch(e => console.error('colony events:', e.message)); }, 30000).unref();
setInterval(() => { if (isLeader && world.meta) push.dailyReminder().catch(e => console.error('daily reminder:', e.message)); }, 5 * 60000).unref();
setInterval(() => { if (isLeader && world.meta) world.elections.tally().catch(e => console.error('election:', e.message)); }, 60000).unref();
setInterval(() => { if (isLeader && world.meta) leaderboards.rollover().catch(e => console.error('leaderboards:', e.message)); }, 60000).unref();
const actions = new Actions(world); world.actions = actions; world.blockedReason = c => actions.blockedReason(c);
const app = express();
app.disable('x-powered-by');
app.use(compression()); // map data is very repetitive JSON; this shrinks it several times over
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // Render, Fly and most hosts sit one proxy in front

// ---------- rate limiting (per visitor IP, per server instance) ----------
const buckets = new Map(); const RATE = Number(process.env.RATE_PER_MIN || 240);
const limit = (req, res, next) => {
  const now = Date.now(); const k = req.ip; let b = buckets.get(k);
  if (!b || now - b.t > 60000) buckets.set(k, b = { t: now, n: 0 });
  if (++b.n > RATE) return res.status(429).json({ error: 'Too many requests. Slow down a little.' });
  next();
};
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 60000) buckets.delete(k); }, 60000).unref();

// Webhooks need the raw body for signature checks, so they mount before the JSON parser.
app.use('/webhooks/instagram', instagramRouter(world));
app.use(express.json({ limit: '512kb' }));

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const admin = (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !safeEq(token, process.env.ADMIN_TOKEN)) return res.status(401).json({ error: 'Builder token required.' });
  next();
};
admin.check = req => { const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, ''); return !!t && safeEq(t, process.env.ADMIN_TOKEN); };
const send = fn => async (req, res) => {
  try { res.json(await fn(req) ?? { ok: true }); }
  catch (e) { const s = e instanceof HttpError ? e.status : 500; if (s === 500) console.error(e); res.status(s).json({ error: s === 500 ? 'Something went wrong on the server.' : e.message }); }
};

// ---------- public ----------
const CHUNK_KEY = /^-?\d{1,6}_-?\d{1,6}$/;
let eventsCache = { t: 0, rows: [], disasters: [] };
app.get('/api/meta', limit, send(async () => {
  if (Date.now() - eventsCache.t > 2000) eventsCache = { t: Date.now(), rows: await world.recentEvents(), disasters: await world.recentDisasters() };
  return { meta: world.publicMeta(), events: eventsCache.rows, disasters: eventsCache.disasters, serverNow: Date.now() };
}));
// How many colonists are online right now (signed in and seen in the last 90 seconds), for the Town Square header.
let onlineCache = { t: 0, n: 0 };
app.get('/api/online/count', limit, send(async () => {
  if (Date.now() - onlineCache.t > 10000) onlineCache = { t: Date.now(), n: Number((await pool.query('select count(*) n from citizens where last_seen > $1', [Date.now() - ONLINE_WINDOW])).rows[0].n) };
  return { online: onlineCache.n };
}));
app.get('/api/chunks', limit, send(async req => {
  const keys = [...new Set(String(req.query.keys || '').split(','))].filter(k => CHUNK_KEY.test(k)).slice(0, 25);
  const chunks = {}; for (const k of keys) { const [cx, cy] = k.split('_').map(Number); chunks[k] = world.chunk(cx, cy); }
  return { chunks, citizens: keys.length ? await world.citizensIn(keys) : [] };
}));
app.get('/api/citizens', limit, send(req => world.search(req.query.q)));
app.get('/api/citizens/:handle', limit, send(async req => {
  const c = await world.citizenDetail(req.params.handle); if (!c) throw new HttpError(404, 'No citizen with that name.');
  // Coins are private: only the colonist themself (signed in) and the developer see them.
  const me = admin.check(req) ? null : await playerFrom(req);
  if (!admin.check(req) && !(me && me.id === c.id)) { delete c.coins; delete c.net; delete c.bank; }
  return c;
}));
// ---------- creature races ----------
app.get('/api/race', limit, send(async req => races.info((await playerFrom(req))?.id, typeof req.query.track === 'string' ? req.query.track : null)));
// Test servers only (ALLOW_TEST_ROUTES=1, never set on the live colony): run the daily payday on demand.
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/election-end', admin, send(async () => { const { weekOf, weekStart } = await import('./leaderboards.js'); const win = await world.elections.tally(weekStart(weekOf() + 1) + 1000); world.elections.testShift = 1; world.elections.cache.t = 0; return { winner: win?.handle || null }; }));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/bills', admin, send(() => world.change(ch => economy.weeklyBills(ch, true))));
if (process.env.ALLOW_TEST_ROUTES === '1') app.get('/api/admin/test/pushlog', admin, send(async () => ({ log: push.log })));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/rollover', admin, send(async () => ({ winners: await leaderboards.rollover() })));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/payday', admin, send(() => world.change(ch => economy.day(ch, 1))));
app.get('/api/lottery', limit, send(async req => lottery.info((await playerFrom(req))?.id)));
app.post('/api/admin/lottery', admin, send(req => lottery.start(req.body || {})));
app.post('/api/admin/race/cup', admin, send(req => races.setCup((req.body || {}).bonus, (req.body || {}).name, (req.body || {}).track)));
app.get('/health', (req, res) => res.json({ ok: true, founded: !!world.meta, population: world.meta?.population || 0, viewers: wss?.clients.size || 0, bus: bus.kind, leader: isLeader }));

// Point a free pinger (cron-job.org, UptimeRobot) here every few minutes.
// It keeps sleepy hosts awake and runs the clock's catch-up work.
app.get('/api/cron/tick', send(async req => {
  if (!process.env.CRON_KEY || !safeEq(req.query.key || '', process.env.CRON_KEY)) throw new HttpError(401, 'Wrong key.');
  return { ok: true, ...(await world.tick()), drained: await world.drainComments() };
}));

// ---------- builder (you) ----------
app.get('/api/admin/check', admin, (req, res) => res.json({ ok: true }));
// Developer stats: daily players, coins in circulation, how players earn and spend, and where they drop off.
app.get('/api/admin/stats', admin, send(async req => { const S = await import('./stats.js'); return S.dashboard(world, req.query.days); }));
app.post('/api/admin/found', admin, send(req => world.found(req.body || {})));
app.post('/api/admin/buildings', admin, send(req => world.build(req.body || {})));
app.post('/api/admin/buildings/restore', admin, send(req => world.restore((req.body || {}).building)));
app.post('/api/admin/buildings/:id/finish', admin, send(req => world.finish(req.params.id)));
app.post('/api/admin/buildings/:id/repair', admin, send(req => world.repair(req.params.id)));
app.post('/api/admin/ruins/clear', admin, send(() => world.clearRuins()));
app.post('/api/admin/water', admin, send(req => world.paintWater(req.body || {})));
app.post('/api/admin/vehicles', admin, send(req => world.placeVehicle(req.body || {})));
app.delete('/api/admin/vehicles/:id', admin, send(req => world.removeVehicle(req.params.id)));
app.post('/api/admin/disasters', admin, send(async req => { const r = await world.disaster(req.body || {}); eventsCache.t = 0; return r; }));
app.get('/api/colony-event', limit, send(async () => ({ event: await cevents.current() })));
app.post('/api/admin/colony-event', admin, send(req => cevents.start(String((req.body || {}).kind || ''), (req.body || {}).mins)));
app.delete('/api/admin/colony-event', admin, send(async () => ({ ended: await cevents.end('over') })));
app.post('/api/admin/treasury', admin, send(req => world.adjustTreasury((req.body || {}).amount)));
app.put('/api/admin/colony-name', admin, send(req => world.renameColony((req.body || {}).name)));
app.put('/api/admin/weather', admin, send(req => world.setWeather((req.body || {}).kind)));
app.get('/api/admin/draft', admin, send(async () => ({ draft: await world.getDraft() })));
app.put('/api/admin/draft', admin, send(req => world.saveDraft((req.body || {}).data)));
app.delete('/api/admin/draft', admin, send(() => world.discardDraft()));
app.post('/api/admin/draft/publish', admin, send(async () => { const r = await world.publishDraft(); eventsCache.t = 0; return r; }));
app.post('/api/admin/construction/finish-all', admin, send(() => world.finishAll()));
app.post('/api/admin/bulldoze', admin, send(req => world.bulldozeArea(req.body || {})));
app.get('/api/admin/places', admin, send(req => world.places(req.query.kind, req.query.x, req.query.y)));
app.post('/api/admin/citizens/bulk', admin, send(req => world.spawnBulk((req.body || {}).handles, (req.body || {}).gender)));
app.patch('/api/admin/citizens/:id', admin, send(async req => {
  const b = req.body || {};
  if ('gender' in b) await world.setGender(req.params.id, b.gender);
  if ('name' in b) await world.setName(req.params.id, b.name);
  if ('homeId' in b) await world.setHome(req.params.id, b.homeId);
  if ('jobId' in b) await world.setJob(req.params.id, b.jobId);
  return { ok: true };
}));
app.post('/api/admin/citizens/:id/coins', admin, send(req => economy.adjust(req.params.id, (req.body || {}).amount)));
app.patch('/api/admin/buildings/:id', admin, send(req => world.move(req.params.id, (req.body || {}).x, (req.body || {}).y, (req.body || {}).rot)));
app.delete('/api/admin/buildings/:id', admin, send(req => world.demolish(req.params.id, { refund: req.query.refund === '1' })));
app.post('/api/admin/roads', admin, send(req => world.paintRoads(req.body || {})));
app.post('/api/admin/citizens', admin, send(req => world.spawn((req.body || {}).handle, 'manual', (req.body || {}).gender)));
app.post('/api/admin/citizens/remove', admin, send(req => world.removeMany(req.body || {})));
app.post('/api/admin/reset', admin, send(async req => {
  if ((req.body || {}).confirm !== 'RESET') throw new HttpError(400, 'Type RESET to confirm.');
  const r = await world.resetColony(); eventsCache.t = 0; return r;
}));
app.delete('/api/admin/citizens/:id', admin, send(req => world.removeCitizen(req.params.id)));
app.put('/api/admin/build-post', admin, send(req => world.setBuildPost((req.body || {}).mediaId)));
app.get('/api/admin/requests', admin, send(() => world.buildRequests()));

// ---------- Instagram connection panel (developer) ----------
app.get('/api/admin/instagram', admin, send(async req => ({
  callbackUrl: `${req.protocol}://${req.get('host')}/webhooks/instagram`, verifyToken: process.env.IG_VERIFY_TOKEN || null, secretSet: !!process.env.IG_APP_SECRET,
  ...igStatus, comments: Number((await pool.query("select count(*) n from comments where source = 'instagram'")).rows[0].n) })));
app.post('/api/admin/instagram/connect', admin, send(async req => { try { return await connectInstagram((req.body || {}).token); } catch (e) { throw new HttpError(e.status || 502, e.message); } }));

// ---------- pages Meta asks for: privacy policy, data deletion, terms ----------
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 18px;color:#2B2621;background:#F6F1E6}h1{font-size:26px}h2{font-size:18px;margin-top:26px}a{color:#B5543E}</style></head><body>${body}</body></html>`;
const contact = () => process.env.CONTACT_EMAIL ? `email <a href="mailto:${process.env.CONTACT_EMAIL}">${process.env.CONTACT_EMAIL}</a> or send us a direct message on Instagram` : 'send us a direct message on Instagram';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const townName = () => esc(world.meta?.name || 'The Living Settlement');
app.get('/privacy', (req, res) => res.send(page('Privacy policy', `<h1>Privacy policy</h1><p>${townName()} is RESURGENCE, a game set on the planet Gliese 12 b: a shared colony where followers who comment on our Instagram posts become colonists.</p>
<h2>What we collect</h2><ul><li>Your public Instagram username, and the text of comments you leave on our posts, received through Instagram's official API.</li>
<li>Game data about your citizen: home, job, coins and activity in the city.</li><li>If you set a password, we store only a one-way scrambled form of it (scrypt hash), never the password itself.</li>
<li>A login token kept in your browser so you stay signed in.</li></ul>
<h2>What we use it for</h2><p>Only to run the game: to add you as a citizen when you comment "spawn", to read build requests, and to confirm a citizen is yours when you comment a claim code. We don't sell or share your data, show ads, or send you messages.</p>
<h2>Who can see it</h2><p>Your username and your citizen's life in the city are visible to everyone who opens the game. Comment text is seen only by the game's operator.</p>
<h2>Deleting your data</h2><p>See <a href="/data-deletion">how to delete your data</a>.</p><h2>Contact</h2><p>To ask about your data, ${contact()}.</p>`)));
app.get('/data-deletion', (req, res) => res.send(page('Delete your data', `<h1>Delete your data</h1><p>To remove your citizen and everything we hold about you from ${townName()}, ${contact()} from the Instagram account your citizen belongs to, saying "delete my citizen".</p>
<p>We will remove your citizen, your stored comments, your password and your logins within 30 days, and confirm when it's done. Deleting the Instagram comments themselves is done on Instagram.</p>`)));
app.get('/terms', (req, res) => res.send(page('Terms', `<h1>Terms</h1><p>${townName()} is a free game for fun. Coins and everything else in the game have no real-world value and can't be bought, sold or exchanged for money.
The operator may change, reset or remove anything in the game. Be kind in comments; we may remove citizens for abuse.</p>`)));

// ---------- players: prove an avatar is yours, set a password, log in ----------
app.use('/api', playersRouter({ limit, send, admin, world }));
setInterval(() => { if (isLeader) sweepPlayers().catch(e => console.error('sweep:', e.message)); }, 3600 * 1000).unref();

// ---------- the city in the browser ----------
app.use('/shared', express.static(path.join(root, 'shared'), { maxAge: '5m' }));
// A shared colonist link (/?c=handle) gets its own title in link previews on X, WhatsApp and so on.
app.get('/', async (req, res, next) => {
  const h = typeof req.query.c === 'string' ? R.cleanHandle(req.query.c) : ''; if (!h) return next();
  try {
    const c = (await pool.query('select handle, display_name from citizens where lower(handle) = lower($1)', [h])).rows[0]; if (!c) return next();
    const who = c.display_name ? `${c.display_name} (@${c.handle})` : `@${c.handle}`, title = `${who} on Resurgence`, desc = `${who} lives in ${world.meta?.name || 'the colony'} on Gliese 12 b. Come and find them, and claim your own colonist. Free to play.`;
    const url = `https://${req.get('host')}/?c=${encodeURIComponent(c.handle)}`;
    let html = await fs.promises.readFile(path.join(root, 'public', 'index.html'), 'utf8');
    html = html.replace(/(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*/g, `$1${esc(title)}`)
      .replace(/(<meta (?:property="og:description"|name="twitter:description"|name="description") content=")[^"]*/g, `$1${esc(desc)}`)
      .replace(/(<meta property="og:url" content=")[^"]*/, `$1${esc(url)}`);
    res.set('cache-control', 'public, max-age=300').type('html').send(html);
  } catch (e) { next(); }
});
app.use(express.static(path.join(root, 'public'), { maxAge: '5m' }));

// ---------- live updates ----------
// Each viewer subscribes to the map chunks on their screen and only hears about those, plus town-wide news.
// Updates are grouped and sent every 250 ms, so a burst of a thousand changes is a handful of messages.
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
const MAX_BUFFER = 2 * 1024 * 1024;
wss.on('error', e => console.error('websocket server:', e.message));
wss.on('connection', ws => {
  ws.isAlive = true; ws.subs = new Set(); ws.out = [];
  ws.on('error', () => { try { ws.terminate(); } catch {} });
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m?.type === 'sub' && Array.isArray(m.chunks)) ws.subs = new Set(m.chunks.filter(k => typeof k === 'string' && CHUNK_KEY.test(k)).slice(0, 100));
    // A signed-in colonist identifies their connection, so private chats reach them and they show as online.
    if (m?.type === 'auth') playerByToken(m.token).then(p => {
      const was = ws.playerId; ws.playerId = p ? p.id : null;
      if (was && was !== ws.playerId && !localOnline(was)) chat.gone(was).catch(() => {});
      if (p) chat.seen([p.id]).catch(() => {});
      ws.send(JSON.stringify({ type: 'authed', ok: !!p }));
    }).catch(() => {});
  });
  ws.on('close', () => { if (ws.playerId && !localOnline(ws.playerId)) chat.gone(ws.playerId).catch(() => {}); });
  ws.send(JSON.stringify({ type: 'hello', meta: world.publicMeta(), serverNow: Date.now() }));
});
const localOnline = id => [...wss.clients].some(w => w.readyState === 1 && w.playerId === id);
// Every minute, everyone with the colony open is marked as seen (that's what "online" means).
setInterval(() => { const ids = [...new Set([...wss.clients].filter(w => w.readyState === 1 && w.playerId).map(w => w.playerId))]; chat.seen(ids).catch(e => console.error('presence:', e.message)); achievements.checkMany(ids).catch(() => {}); }, 60000).unref();
bus.on(ops => {
  // Private chat messages go only to the two people's own connections.
  const priv = ops.filter(o => o.private); if (priv.length) ops = ops.filter(o => !o.private);
  for (const o of priv) { const msg = JSON.stringify({ type: o.op, data: o.data, id: o.id }); for (const ws of wss.clients) if (ws.readyState === 1 && o.to.includes(ws.playerId)) { try { ws.send(msg); } catch {} } }
  if (!ops.length) return;
  try { world.apply(ops); } catch (e) { console.error('applying update failed:', e); }
  for (const o of ops) o.json = JSON.stringify(o, (k, v) => k === 'json' ? undefined : v);
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    for (const o of ops) if (!o.chunks || o.chunks.some(k => ws.subs.has(k))) ws.out.push(o);
  }
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.out.length || ws.readyState !== 1) continue;
    // A viewer on a slow connection that falls far behind gets told to reload instead of buffering forever.
    if (ws.bufferedAmount > MAX_BUFFER) { ws.out = []; ws.send('{"type":"resync"}'); continue; }
    let meta = null; const parts = [];
    for (const o of ws.out) { if (o.op === 'meta') meta = o; else parts.push(o.json); }
    if (meta) parts.push(meta.json);
    ws.out = []; try { ws.send('{"type":"ops","ops":[' + parts.join(',') + ']}'); } catch { ws.terminate(); }
  }
}, 250);
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30000);
setInterval(() => { const msg = JSON.stringify({ type: 'tick', serverNow: Date.now() }); for (const ws of wss.clients) if (ws.readyState === 1) { try { ws.send(msg); } catch {} } }, GAME_MIN_MS);

// ---------- the leader: exactly one server runs the clock and the comment queue ----------
// Every instance tries to hold a Postgres advisory lock; whichever gets it is the leader. If it dies, its
// database session ends, the lock frees, and another instance takes over within seconds.
let isLeader = false, leaderClient = null;
async function tryLead() {
  if (isLeader) {
    // Make sure the connection that holds the lock is still alive; if the database dropped it, the lock is gone too.
    try { await Promise.race([leaderClient.query('select 1'), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 10000))]); }
    catch (e) { console.error('lost the leader connection:', e.message); isLeader = false; try { leaderClient?.release(true); } catch {} leaderClient = null; }
    return;
  }
  try {
    leaderClient = leaderClient || await pool.connect();
    if (!leaderClient.watched) { leaderClient.watched = true; const c = leaderClient; c.on('error', () => { if (leaderClient === c) { isLeader = false; leaderClient = null; } }); }
    isLeader = (await leaderClient.query('select pg_try_advisory_lock(777) ok')).rows[0].ok;
    if (isLeader) console.log('This server is the leader (clock + comment queue).');
    else { leaderClient.release(); leaderClient = null; }
  } catch (e) { isLeader = false; try { leaderClient?.release(true); } catch {} leaderClient = null; }
}
let draining = false;
async function drainLoop() {
  if (!isLeader || draining) return; draining = true;
  try { while (isLeader && await world.drainComments(1000) === 1000); }
  catch (e) { console.error('comment queue:', e.message); }
  finally { draining = false; }
}
setInterval(tryLead, 10000);
setInterval(drainLoop, 1000);
let ticking = false; // never start a clock tick while the last one is still running (a slow database would pile them up)
setInterval(async () => { if (!isLeader || ticking) return; ticking = true; try { await world.tick(); } catch (e) { console.error('tick failed:', e.message); } finally { ticking = false; } }, GAME_MIN_MS);
setInterval(() => { if (isLeader) races.tick().catch(e => console.error('races:', e.message)); }, 2000); // announce, start and settle races
setInterval(() => { if (isLeader) lottery.tick().catch(e => console.error('lottery:', e.message)); }, 2000); // announce and draw the lottery

await migrate();
await loadIgStatus();
await bus.start();
await world.load();
await tryLead();
if (isLeader && await world.reanchor().catch(e => { console.error('reanchor failed:', e.message); return false; })) console.log('Switched the clock to 30 real minutes per game day.');
if (isLeader) await world.upgradeCampfire().catch(e => console.error('landing station:', e.message));
if (isLeader) await world.tick().catch(e => console.error('tick failed:', e.message)); // catch up on anything missed while off
server.keepAliveTimeout = 65000; server.headersTimeout = 66000; // longer than the host's proxy, so it never reuses a closed connection
server.listen(PORT, () => { started = true; console.log(`City running on :${PORT} with ${world.meta?.population || 0} citizens (bus: ${bus.kind})`); });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); process.exit(0); });
