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
import { Arena } from './arena.js';
import { streamRoutes } from './streaming.js';
import { Radio, radioRoutes } from './radio.js';
import { Stars } from './stars.js';
import { GameTables } from './gametables.js';
import { Earn } from './earn.js';
import { ColonyEvents } from './colonyevents.js';
import { Races } from './races.js';
import { Fights } from './fights.js';
import { Actions } from './actions.js';
import { Guide } from './guide.js';
import { Push } from './push.js';
import { Elections } from './elections.js';
import { Lottery } from './lottery.js';
import { Auctions } from './auctions.js';
import { throttle, apiThrottle, take, ipOf, locked, failed, usageReport, WS_PER_IP } from './limits.js';
import { Housing } from './housing.js';
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
const races = new Races(world); world.races = races; const fights = new Fights(world); world.fights = fights;
const lottery = new Lottery(world); world.lottery = lottery;
const auctions = new Auctions(world); world.auctions = auctions;
const economy = new Economy(world); world.economy = economy;
world.housing = new Housing(world);
const chat = new Chat(bus); world.chat = chat; chat.world = world;
const push = new Push(); world.push = push; chat.push = push;
const achievements = new Achievements(world, bus); world.achievements = achievements;
const leaderboards = new Leaderboards(world); world.leaderboards = leaderboards;
world.tables = new CasinoTables(world);
world.gamehouse = new GameHouse(world);
world.gametables = new GameTables(world);
world.heists = new Heists(world);
world.arena = new Arena(world, bus); world.arena.leader = () => isLeader;
world.radio = new Radio(world, bus);
setInterval(() => { if (isLeader && world.meta) world.radio.tick().catch(e => console.error('radio:', e.message)); }, 15000).unref(); // DJ talk breaks
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
// While the server is starting (migrations, loading the world) its port is already open, so the host sees it alive, but it
// answers "starting up" to everything except the health check, which says not ready yet. The host keeps sending players to
// the old server until the health check passes, so an update never fails for being slow to start, and nobody sees a gap.
let ready = false;
app.use((req, res, next) => { if (ready || req.path === '/health') return next(); res.status(503).set('retry-after', '5').type('text').send('Starting up, back in a moment.'); });
app.use(compression()); // map data is very repetitive JSON; this shrinks it several times over
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // Render, Fly and most hosts sit one proxy in front
// Security headers on every reply: browsers mustn't guess file types, frame the game inside other sites, leak full
// addresses to other sites, or (on https) ever fall back to plain http; and nothing may use the camera or microphone.
app.use((req, res, next) => { res.set({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()' }); if (req.secure) res.set('strict-transport-security', 'max-age=15552000; includeSubDomains'); next(); });

// ---------- rate limits, quotas and cost caps (see server/limits.js) ----------
// Every IP has an overall allowance; the API has its own (smaller for searches and sign-ins), and each signed-in player
// one for actions. Route handlers still list `limit` (the API throttle has already counted them), so it lets them through.
app.use(throttle('all'));
const limit = (req, res, next) => next();
app.use('/webhooks', throttle('hook'));
app.use('/api', apiThrottle);

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// The builder's password: ten wrong guesses from one address and it's locked out for 15 minutes (then it can try again).
const admin = (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, ''), ip = ipOf(req);
  if (locked('admin', ip)) return res.status(429).set('retry-after', '900').json({ error: 'Too many wrong builder passwords. Try again in 15 minutes.' });
  if (!token || !safeEq(token, process.env.ADMIN_TOKEN)) { if (token) failed('admin', ip); return res.status(401).json({ error: 'Builder token required.' }); }
  next();
};
admin.check = req => { const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, ''); return !!t && !locked('admin', ipOf(req)) && safeEq(t, process.env.ADMIN_TOKEN); };
// Webhooks need the raw body for signature checks, so they mount before the JSON parser. Players send small things;
// only the builder (maps, drafts) needs room for big ones.
app.use('/webhooks/instagram', instagramRouter(world));
const jsonSmall = express.json({ limit: '64kb' }), jsonBig = express.json({ limit: '512kb' });
app.use((req, res, next) => (admin.check(req) ? jsonBig : jsonSmall)(req, res, next));
const send = fn => async (req, res) => {
  try { res.json(await fn(req) ?? { ok: true }); }
  catch (e) { const s = e instanceof HttpError ? e.status : 500; if (s === 500) console.error(e); res.status(s).json({ error: s === 500 ? 'Something went wrong on the server.' : e.message }); }
};

// ---------- public ----------
const CHUNK_KEY = /^-?\d{1,6}_-?\d{1,6}$/;
let eventsCache = { t: 0, rows: [], disasters: [] };
streamRoutes(app, { admin, send, limit, bus }); // the 24/7 live stream
radioRoutes(app, { radio: world.radio, admin, send, limit }); // colony radio
app.get('/api/meta', limit, send(async () => {
  if (Date.now() - eventsCache.t > 2000) eventsCache = { t: Date.now(), rows: await world.recentEvents(), disasters: await world.recentDisasters() };
  return { meta: world.publicMeta(), events: eventsCache.rows, disasters: eventsCache.disasters, serverNow: Date.now() };
}));
// Who holds a status title (handle and tier, only those who bought one), for the badges by names in chats, lists and
// posts. Few players hold one, an index finds them, and the list is kept for 15 seconds. New titles reach open pages
// straight away through the Colony Log entry announcing them.
let statusCache = { t: 0, list: [] };
app.get('/api/status', limit, send(async () => {
  if (Date.now() - statusCache.t > 15000) statusCache = { t: Date.now(), list: (await pool.query('select handle, status_tier from citizens where status_tier > 0 order by status_tier desc limit 20000')).rows.map(r => [r.handle, Number(r.status_tier)]) };
  return { list: statusCache.list };
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
app.get('/api/fight', limit, send(async req => fights.info((await playerFrom(req))?.id)));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/fight-soon', admin, send(req => fights.testSoon((req.body || {}).in, (req.body || {}).gap)));
app.get('/api/race', limit, send(async req => races.info((await playerFrom(req))?.id, typeof req.query.track === 'string' ? req.query.track : null)));
// Test servers only (ALLOW_TEST_ROUTES=1, never set on the live colony): run the daily payday on demand.
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/election-end', admin, send(async () => { const { weekOf, weekStart } = await import('./leaderboards.js'); const win = await world.elections.tally(weekStart(weekOf() + 1) + 1000); world.elections.testShift = 1; world.elections.cache.t = 0; return { winner: win?.handle || null }; }));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/bills', admin, send(() => world.change(ch => economy.weeklyBills(ch, true))));
if (process.env.ALLOW_TEST_ROUTES === '1') app.get('/api/admin/test/pushlog', admin, send(async () => ({ log: push.log })));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/arena-end', admin, send(async () => { for (const M of world.arena.matches.values()) { M.playFrom = Math.min(M.playFrom, Date.now()); M.until = Date.now(); } return { n: world.arena.matches.size }; }));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/rollover', admin, send(async () => ({ winners: await leaderboards.rollover() })));
if (process.env.ALLOW_TEST_ROUTES === '1') app.post('/api/admin/test/payday', admin, send(() => world.change(ch => economy.day(ch, 1))));
app.get('/api/lottery', limit, send(async req => lottery.info((await playerFrom(req))?.id)));
app.post('/api/admin/lottery', admin, send(req => lottery.start(req.body || {})));
app.get('/api/places', limit, send(() => world.directory()));
// The in-game browser asks whether a business's website can be shown inside the game (see server/web.js).
app.get('/api/web/check', limit, send(async req => { const { checkSite } = await import('./web.js'); const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim(); return checkSite(String(req.query.url || ''), `${proto}://${req.get('host')}`); }));
app.get('/api/auctions', limit, send(() => auctions.list()));
app.get('/api/auctions/:id', limit, send(async req => auctions.info((await playerFrom(req))?.id, req.params.id)));
app.post('/api/admin/auctions', admin, send(req => auctions.start(req.body || {})));
app.post('/api/admin/auctions/:id/cancel', admin, send(req => auctions.cancel(req.params.id)));
app.post('/api/admin/race/cup', admin, send(req => races.setCup((req.body || {}).bonus, (req.body || {}).name, (req.body || {}).track)));
// The game's version: a fingerprint of the page and the shared code, taken at start-up. An open game asks for it when the
// phone comes back to the app (and every few minutes), and reloads itself when it changed, so nobody keeps playing an old
// copy for hours after an update.
const APP_VERSION = (() => { const h = crypto.createHash('sha1'); try { h.update(fs.readFileSync(path.join(root, 'public', 'index.html')));
  for (const f of fs.readdirSync(path.join(root, 'shared')).sort()) h.update(fs.readFileSync(path.join(root, 'shared', f)));
  for (const f of fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.js')).sort()) h.update(fs.readFileSync(path.join(root, 'public', f))); } catch (e) { h.update(String(Date.now())); }
  return h.digest('hex').slice(0, 12); })();
app.get('/api/version', (req, res) => { res.set('cache-control', 'no-store'); res.json({ v: APP_VERSION }); });
app.get('/health', (req, res) => ready ? res.json({ ok: true, founded: !!world.meta, population: world.meta?.population || 0, viewers: wss?.clients.size || 0, bus: bus.kind, leader: isLeader }) : res.status(503).json({ ok: false, starting: true }));

// Point a free pinger (cron-job.org, UptimeRobot) here every few minutes.
// It keeps sleepy hosts awake and runs the clock's catch-up work.
app.get('/api/cron/tick', send(async req => {
  if (locked('key', ipOf(req))) throw new HttpError(429, 'Too many wrong keys. Try again in 15 minutes.');
  if (!process.env.CRON_KEY || !safeEq(req.query.key || '', process.env.CRON_KEY)) { failed('key', ipOf(req)); throw new HttpError(401, 'Wrong key.'); }
  return { ok: true, ...(await world.tick()), drained: await world.drainComments() };
}));

// ---------- builder (you) ----------
app.get('/api/admin/check', admin, (req, res) => res.json({ ok: true }));
app.get('/api/admin/usage', admin, send(() => usageReport()));
// Developer stats: daily players, coins in circulation, how players earn and spend, and where they drop off.
app.get('/api/admin/stats', admin, send(async req => { const S = await import('./stats.js'); return S.dashboard(world, req.query.days); }));
// The builder's view of players' money: cash on hand, savings at the bank, debt, and each player's history.
app.get('/api/admin/accounts', admin, send(async req => {
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase(), today = world.meta ? R.gameDay(Date.now(), world.meta.epoch) : 0;
  const rows = (await pool.query(`select id, handle, display_name, coins_base, coins_day, net, bank, last_seen, jailed_until, status_tier, crime_day, crime_today from citizens where pass_hash is not null ${q ? 'and (lower(handle) like $1 or lower(display_name) like $1)' : ''} limit 2000`, q ? ['%' + q + '%'] : [])).rows;
  const list = rows.map(r => { const cash = R.balanceOn(r.coins_base, r.coins_day, r.net, today), bank = Number(r.bank || 0); return { id: r.id, h: r.handle, n: r.display_name || '', cash, bank, total: cash + bank, net: Number(r.net || 0), seen: Number(r.last_seen || 0), jailed: Number(r.jailed_until || 0) > Date.now(), st: Number(r.status_tier || 0), jobs: R.jobsToday(r) }; });
  list.sort((a, b) => b.total - a.total);
  const sum = list.reduce((a, x) => ({ cash: a.cash + x.cash, bank: a.bank + x.bank }), { cash: 0, bank: 0 });
  return { players: list.slice(0, 300), count: list.length, sum };
}));
app.get('/api/admin/accounts/:handle', admin, send(async req => {
  const c = (await pool.query('select id, handle, display_name, coins_base, coins_day, net, bank, last_seen from citizens where lower(handle) = lower($1)', [String(req.params.handle || '').replace(/^@/, '')])).rows[0];
  if (!c) throw new HttpError(404, 'No such colonist.'); const today = world.meta ? R.gameDay(Date.now(), world.meta.epoch) : 0, { history } = await import('./stats.js');
  const h = await history(c.id, Math.min(200, Number(req.query.n) || 100), Number(req.query.before) || null);
  const tot = (await pool.query("select key, sum(coins)::bigint s, count(*)::int n from ledger where citizen_id = $1 group by key order by sum(abs(coins)) desc limit 40", [c.id])).rows.map(r => ({ key: r.key, coins: Number(r.s), n: r.n }));
  return { who: { h: c.handle, n: c.display_name || '', cash: R.balanceOn(c.coins_base, c.coins_day, c.net, today), bank: Number(c.bank || 0), net: Number(c.net || 0), seen: Number(c.last_seen || 0) }, ...h, totals: tot };
}));
app.post('/api/admin/found', admin, send(req => world.found(req.body || {})));
app.post('/api/admin/buildings', admin, send(req => world.build(req.body || {})));
app.post('/api/admin/buildings/line', admin, send(req => world.buildLine(req.body || {})));
app.post('/api/admin/buildings/restore', admin, send(req => world.restore((req.body || {}).building)));
app.delete('/api/admin/buildings/:id/website', admin, send(req => world.housing.setWebsite(null, req.params.id, '', true)));
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
// The stabiliser's dial, by hand (it carries on adjusting itself from there each hour), or a fresh reading right now.
app.post('/api/admin/economy', admin, send(async req => { const b = req.body || {}; const S = await import('./stats.js');
  return world.change(async ch => { if (b.f != null) { const f = Number(b.f); if (!(f >= R.ECON.min && f <= R.ECON.max)) throw new HttpError(400, `Set the dial between ${R.ECON.min} and ${R.ECON.max}.`); ch.meta.econ = { ...(ch.meta.econ || {}), f }; }
    if (b.measure) await S.econTick(ch, true); return { ok: true, econ: ch.meta.econ || null, f: R.econF(ch.meta) }; }); }));
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
// The game's code (the page, /shared/*.js, music.js) is always revalidated: the browser asks "still the same?" and gets a
// tiny 304 if so. With a cache time, a phone could keep an old part next to a new page right after an update, and a
// mismatched part stops the game from starting. Pictures, video and sound keep their cache times.
const fresh = (res, file) => { if (/\.(html|js|mjs|css|json|webmanifest)$/i.test(file)) res.setHeader('Cache-Control', 'no-cache'); };
app.use('/shared', express.static(path.join(root, 'shared'), { maxAge: '5m', setHeaders: fresh }));
// The 3D engine for the mini games (three.js), loaded only when a game opens.
app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three', 'build'), { maxAge: '7d' }));
app.use('/vendor/three-addons', express.static(path.join(root, 'node_modules', 'three', 'examples', 'jsm'), { maxAge: '7d' }));
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
    res.set('cache-control', 'no-cache').type('html').send(html);
  } catch (e) { next(); }
});
app.use(express.static(path.join(root, 'public'), { maxAge: '5m', setHeaders: fresh }));

// ---------- live updates ----------
// Each viewer subscribes to the map chunks on their screen and only hears about those, plus town-wide news.
// Updates are grouped and sent every 250 ms, so a burst of a thousand changes is a handful of messages.
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
const MAX_BUFFER = 2 * 1024 * 1024;
wss.on('error', e => console.error('websocket server:', e.message));
// The client's address behind the host's proxy (the same rule Express uses: the last address the proxy added).
const wsIp = req => { const cf = req.headers['cf-connecting-ip']; if (cf) return String(cf).trim().slice(0, 64); const f = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean); return f.length && Number(process.env.TRUST_PROXY ?? 1) > 0 ? f[f.length - 1] : req.socket.remoteAddress || '?'; };
const wsByIp = new Map();
wss.on('connection', (ws, req) => {
  if (!ready) { try { ws.close(1013, 'starting'); } catch {} return; } // try again in a moment
  // limits: new connections per minute and open connections per address, messages per second per connection
  const ip = wsIp(req), open = wsByIp.get(ip) || 0;
  if (open >= WS_PER_IP || !take('wsConn', 'wsConn:' + ip).ok) { try { ws.close(1008, 'too many connections'); } catch {} return; }
  wsByIp.set(ip, open + 1); ws.once('close', () => { const n = (wsByIp.get(ip) || 1) - 1; if (n > 0) wsByIp.set(ip, n); else wsByIp.delete(ip); });
  const wsKey = 'ws:' + crypto.randomBytes(6).toString('hex');
  ws.isAlive = true; ws.subs = new Set(); ws.out = [];
  ws.on('error', () => { try { ws.terminate(); } catch {} });
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    if (!take('wsMsg', wsKey).ok) { ws.strikes = (ws.strikes || 0) + 1; if (ws.strikes > 200) { try { ws.close(1008, 'too many messages'); } catch {} } return; } // flooding: dropped, then cut off
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m?.type === 'sub' && Array.isArray(m.chunks)) ws.subs = new Set(m.chunks.filter(k => typeof k === 'string' && CHUNK_KEY.test(k)).slice(0, 100));
    // A signed-in colonist identifies their connection, so private chats reach them and they show as online.
    // Street games: moves and lobby requests go to the leader server, which runs the matches.
    if (m?.type === 'arena' && ws.playerId) { const now = Date.now(); if (now - (ws.arenaAt || 0) > 1000) { ws.arenaAt = now; ws.arenaN = 0; } if (++ws.arenaN > 30) return;
      const a = String(m.a || ''); if (!['join', 'leave', 'go', 'pos', 'state'].includes(a)) return;
      bus.publish([{ arena: true, k: 'in', pid: ws.playerId, handle: ws.playerHandle, m: { a, mode: String(m.mode || ''), id: String(m.id || ''), x: Number(m.x), y: Number(m.y) } }]); return; }
    if (m?.type === 'auth' && take('wsAuth', wsKey).ok) playerByToken(m.token).then(p => {
      const was = ws.playerId; ws.playerId = p ? p.id : null; ws.playerHandle = p ? p.handle : null;
      if (was && was !== ws.playerId && !localOnline(was)) chat.gone(was).catch(() => {});
      if (p) chat.seen([p.id]).catch(() => {});
      ws.send(JSON.stringify({ type: 'authed', ok: !!p }));
    }).catch(() => {});
  });
  ws.on('close', () => { if (ws.playerId && !localOnline(ws.playerId)) { chat.gone(ws.playerId).catch(() => {}); bus.publish([{ arena: true, k: 'in', pid: ws.playerId, m: { a: 'gone' } }]); } });
  ws.send(JSON.stringify({ type: 'hello', meta: world.publicMeta(), serverNow: Date.now() }));
});
const localOnline = id => [...wss.clients].some(w => w.readyState === 1 && w.playerId === id);
// Every minute, everyone with the colony open is marked as seen (that's what "online" means).
setInterval(() => { const ids = [...new Set([...wss.clients].filter(w => w.readyState === 1 && w.playerId).map(w => w.playerId))]; chat.seen(ids).catch(e => console.error('presence:', e.message)); achievements.checkMany(ids).catch(() => {}); }, 60000).unref();
bus.on(ops => {
  // Street games: the leader runs them; every server passes the leader's messages on to its own players.
  if (ops.some(o => o.arena)) { const ar = ops.filter(o => o.arena); ops = ops.filter(o => !o.arena);
    for (const o of ar) {
      if (o.k === 'in') { if (isLeader) world.arena.handle(o).catch(e => console.error('arena:', e.message)); }
      else if (o.k === 'out') { const by = new Map(); for (const ws of wss.clients) if (ws.readyState === 1 && ws.playerId) { const l = by.get(ws.playerId) || []; l.push(ws); by.set(ws.playerId, l); }
        for (const [to, json] of o.msgs) for (const ws of by.get(to) || []) { if (ws.bufferedAmount > MAX_BUFFER) continue; try { ws.send(json); } catch {} } } }
    if (!ops.length) return; }
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
setInterval(() => { if (isLeader) races.tick().catch(e => console.error('races:', e.message)); }, 2000);
setInterval(() => { if (isLeader) fights.tick().catch(e => console.error('fights:', e.message)); }, 2000); // set the card, ring the bells, settle the bouts // announce, start and settle races
setInterval(() => { if (isLeader) lottery.tick().catch(e => console.error('lottery:', e.message)); }, 2000); // announce and draw the lottery
setInterval(() => { if (isLeader) auctions.tick().catch(e => console.error('auctions:', e.message)); }, 2000); // close land auctions when their time is up

// Open the port first (see `ready` above), then get the world ready, timing each step in the log.
server.keepAliveTimeout = 65000; server.headersTimeout = 66000; // longer than the host's proxy, so it never reuses a closed connection
server.listen(PORT, () => console.log(`Port ${PORT} open; starting up…`));
const step = async (name, fn) => { const t = Date.now(); const r = await fn(); console.log(`startup: ${name} took ${Date.now() - t} ms`); return r; };
await step('migrations', migrate);
await step('Instagram settings', loadIgStatus);
await step('update bus', () => bus.start());
// land bought before estates existed (or that only touches other plots of the same owner): join it up, once, before the world loads
await step('joining touching plots into estates', async () => { const H = new Housing(world), q = (a, v) => pool.query(a, v); let n = 0;
  for (const r of (await pool.query('select owner_id from plots group by owner_id having count(*) > 1')).rows) n += (await H.mergeEstates(q, r.owner_id)).length; if (n) console.log(`estates: joined ${n} plots`); });
await step('loading the world', () => world.load());
await step('leader check', tryLead);
if (isLeader && await world.reanchor().catch(e => { console.error('reanchor failed:', e.message); return false; })) console.log('Switched the clock to 30 real minutes per game day.');
if (isLeader) await world.upgradeCampfire().catch(e => console.error('landing station:', e.message));
if (isLeader) await world.taxOutOfWages().then(n => n && console.log(`Took the 20% tax out of ${n} wages.`)).catch(e => console.error('wage tax:', e.message));
if (isLeader) await step('catching up the clock', () => world.tick().catch(e => console.error('tick failed:', e.message))); // anything missed while off
ready = true; started = true; console.log(`City running on :${PORT} with ${world.meta?.population || 0} citizens (bus: ${bus.kind})`);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { server.close(); try { const { drainFlows } = await import('./stats.js'); await Promise.race([drainFlows(), new Promise(r => setTimeout(r, 3000))]); } catch {} process.exit(0); }); // the last few seconds of stats are saved first
