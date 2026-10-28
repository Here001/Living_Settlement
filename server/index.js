import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { migrate } from './db.js';
import { World, HttpError } from './world.js';
import { instagramRouter } from './instagram.js';
import { GAME_MIN_MS, gameMinutes } from '../shared/rules.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 3000);
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL (see .env.example).'); process.exit(1); }
if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 16) { console.error('Set ADMIN_TOKEN to a long random string (16+ characters).'); process.exit(1); }

const world = new World();
const app = express();
app.disable('x-powered-by');

// Webhooks need the raw body for signature checks, so they mount before the JSON parser.
app.use('/webhooks/instagram', instagramRouter(world));
app.use(express.json({ limit: '256kb' }));

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const admin = (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !safeEq(token, process.env.ADMIN_TOKEN)) return res.status(401).json({ error: 'Builder token required.' });
  next();
};
// Wraps a handler: runs it through the world's queue and turns HttpErrors into clean JSON.
const act = fn => async (req, res) => {
  try { res.json(await world.run(() => fn(req)) ?? { ok: true }); }
  catch (e) { const s = e instanceof HttpError ? e.status : 500; if (s === 500) console.error(e); res.status(s).json({ error: s === 500 ? 'Something went wrong on the server.' : e.message }); }
};

// ---------- public ----------
app.get('/api/world', (req, res) => res.json(world.snapshot()));
app.get('/api/citizens/:handle', (req, res) => {
  const h = String(req.params.handle).replace(/^@/, '').toLowerCase();
  const c = [...world.citizens.values()].find(c => c.handle.toLowerCase() === h);
  c ? res.json(c) : res.status(404).json({ error: 'No citizen with that name.' });
});
app.get('/health', (req, res) => res.json({ ok: true, founded: !!world.meta, citizens: world.citizens.size }));

// Point a free pinger (cron-job.org, UptimeRobot) here every few minutes.
// It keeps sleepy hosts awake and settles any days that passed while it slept.
app.get('/api/cron/tick', async (req, res) => {
  if (!process.env.CRON_KEY || !safeEq(req.query.key || '', process.env.CRON_KEY)) return res.sendStatus(401);
  const r = await world.run(() => world.settle()).catch(e => ({ error: e.message }));
  res.json({ ok: true, ...r });
});

// ---------- builder (you) ----------
app.get('/api/admin/check', admin, (req, res) => res.json({ ok: true }));
app.post('/api/admin/found', admin, act(req => world.found(req.body || {})));
app.post('/api/admin/buildings', admin, act(async req => ({ building: await world.build(req.body || {}) })));
app.post('/api/admin/buildings/restore', admin, act(req => world.restore((req.body || {}).building)));
app.patch('/api/admin/buildings/:id', admin, act(req => world.move(req.params.id, (req.body || {}).x, (req.body || {}).y)));
app.delete('/api/admin/buildings/:id', admin, act(req => world.demolish(req.params.id, { refund: req.query.refund === '1' })));
app.post('/api/admin/roads', admin, act(req => world.paintRoads(req.body || {})));
app.post('/api/admin/citizens', admin, act(async req => ({ citizen: await world.spawn((req.body || {}).handle, 'manual') })));
app.delete('/api/admin/citizens/:id', admin, act(req => world.removeCitizen(req.params.id)));
app.put('/api/admin/build-post', admin, act(req => world.setBuildPost((req.body || {}).mediaId)));
app.get('/api/admin/requests', admin, async (req, res) => res.json(await world.buildRequests()));

// ---------- the city in the browser ----------
app.use('/shared', express.static(path.join(root, 'shared'), { maxAge: '5m' }));
app.use(express.static(path.join(root, 'public'), { maxAge: '5m' }));

// ---------- live updates ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', ws => {
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', () => {}); // viewers only listen; all writes go through the HTTP API
  ws.send(JSON.stringify({ type: 'snapshot', world: world.snapshot() }));
});
world.listeners.add(msg => { for (const ws of wss.clients) if (ws.readyState === 1) ws.send(msg); });
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30000);

// ---------- the heartbeat: one tick per game minute, forever ----------
setInterval(() => {
  world.run(() => world.settle()).catch(e => console.error('settle failed', e));
  if (world.meta) world.send({ type: 'tick', gm: gameMinutes(Date.now(), world.meta.epoch), serverNow: Date.now() });
}, GAME_MIN_MS);

await migrate();
await world.load();
await world.run(() => world.settle()); // catch up on anything missed while the server was off
server.listen(PORT, () => console.log(`City running on :${PORT} with ${world.citizens.size} citizens`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); process.exit(0); });
