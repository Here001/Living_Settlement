// Rate limits, usage quotas and cost caps, all in one place, so a bot, a stuck script or someone with bad intentions can't
// flood the game, run up the database, guess passwords, or spend the radio's AI budget.
//
//   - Request throttling (token buckets, per server instance, in memory): every visitor's IP gets a steady allowance of
//     requests that refills over time, with a little burst on top. Heavier requests (searches, map chunks, the builder's
//     stats) and sign-in requests have their own, smaller allowance. Each signed-in player also has an allowance for
//     actions (anything that changes something), wherever they connect from.
//   - Lock-outs: wrong builder passwords, wrong stream or cron keys, and wrong player passwords are counted; too many and
//     that address (or that username) waits 15 minutes.
//   - Daily quotas (in the database, so they survive restarts and are shared by every server): how many posts, messages,
//     groups, invites, offers, reports and so on one player can make in a day. Generous for real players, a wall for bots.
//   - Cost caps: the radio's paid AI writer and voice have a daily budget; past it they fall back to the free phrases.
//
// The numbers are below (LIMITS and QUOTAS) and can be changed with environment variables of the same name in capitals
// (for example RATE_API=400, QUOTA_DM=1000, BUDGET_AI_CALLS=500).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';

const env = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
// per minute, and the burst allowed on top. RATE_PER_MIN (the API's allowance, 300 by default) scales the others with
// it, so a test run started with RATE_PER_MIN=5000 isn't throttled while real players get the normal limits.
const SCALE = Math.max(1, env('RATE_PER_MIN', 300) / 300);
export const LIMITS = {
  all:   { perMin: env('RATE_ALL', 1500 * SCALE), burst: 300 * SCALE },  // everything from one IP, pages and files included
  api:   { perMin: env('RATE_API', 300 * SCALE), burst: 120 * SCALE }, // the game's API, per IP
  heavy: { perMin: env('RATE_HEAVY', 60 * SCALE), burst: 20 * SCALE },   // searches, map chunks, quotes, the builder's stats, per IP
  auth:  { perMin: env('RATE_AUTH', 20 * SCALE), burst: 10 * SCALE },    // sign-in, sign-up, claims, per IP
  act:   { perMin: env('RATE_ACT', 120 * SCALE), burst: 40 * SCALE },    // things a player does (POST/PUT/DELETE), per player
  hook:  { perMin: env('RATE_HOOK', 600 * SCALE), burst: 200 * SCALE },  // webhooks, per IP
  wsConn: { perMin: env('RATE_WS_CONNECT', 30 * SCALE), burst: 15 * SCALE }, // new live connections, per IP
  wsMsg: { perMin: 2400, burst: 120 },                    // messages on one live connection (about 40 a second)
  wsAuth: { perMin: 10, burst: 5 },                       // sign-in messages on one live connection
};
export const WS_PER_IP = env('WS_PER_IP', 20);           // open live connections from one IP at once
// Daily quotas, per player (reset at midnight UTC)
export const QUOTAS = {
  square: env('QUOTA_SQUARE', 50), dm: env('QUOTA_DM', 800), group_msg: env('QUOTA_GROUP_MSG', 1500), group_create: env('QUOTA_GROUP_CREATE', 15),
  group_invite: env('QUOTA_GROUP_INVITE', 150), offer: env('QUOTA_OFFER', 50), report: env('QUOTA_REPORT', 30), rename: env('QUOTA_RENAME', 20),
  heist: env('QUOTA_HEIST', 40), practice: env('QUOTA_PRACTICE', 400), push: env('QUOTA_PUSH', 20), election: env('QUOTA_ELECTION', 30),
};
export const QUOTA_NAMES = { square: 'Town Square posts', dm: 'private messages', group_msg: 'group messages', group_create: 'new group chats', group_invite: 'group invites',
  offer: 'offers', report: 'reports', rename: 'renames', heist: 'heists planned', practice: 'practice games', push: 'notification changes', election: 'election actions' };
// Cost caps for paid services, per day (the whole colony)
export const BUDGETS = { ai_calls: env('BUDGET_AI_CALLS', 300), voice_chars: env('BUDGET_VOICE_CHARS', 150000) };

// ---------- token buckets ----------
const stores = new Map(); // policy -> Map(key -> { tokens, at })
export function take(policy, key, cost = 1) {
  const L = LIMITS[policy]; let m = stores.get(policy); if (!m) stores.set(policy, m = new Map());
  const now = Date.now(), rate = L.perMin / 60000, cap = L.burst; let b = m.get(key);
  if (!b) { b = { tokens: cap, at: now }; m.set(key, b); }
  b.tokens = Math.min(cap, b.tokens + (now - b.at) * rate); b.at = now;
  if (b.tokens >= cost) { b.tokens -= cost; return { ok: true, left: Math.floor(b.tokens) }; }
  return { ok: false, retryAfter: Math.ceil((cost - b.tokens) / rate / 1000) };
}
// forget full buckets now and then, so memory stays small however many visitors come and go
setInterval(() => { const now = Date.now(); for (const [p, m] of stores) { const L = LIMITS[p], full = L.burst / (L.perMin / 60000); for (const [k, b] of m) if (now - b.at > full) m.delete(k); } }, 60000).unref();

const tooMany = (res, retryAfter, msg) => { res.set('retry-after', String(Math.max(1, retryAfter))); return res.status(429).json({ error: msg || 'Too many requests. Slow down a little.', retryAfter }); };
// The visitor's address. The game sits behind Cloudflare, which passes the real one on in cf-connecting-ip; without it
// (no Cloudflare in front), the address Express worked out from the host's proxy. (Someone going round Cloudflare could
// fake the header and get a fresh allowance per address; the per-player, per-username and daily limits still hold.)
export const ipOf = req => { const cf = req.get ? req.get('cf-connecting-ip') : req.headers?.['cf-connecting-ip']; return (cf && String(cf).trim().slice(0, 64)) || req.ip || req.socket?.remoteAddress || '?'; };
// Express middleware: take from `policy`, keyed by keyFn(req) (null skips).
export function throttle(policy, keyFn = ipOf, msg) {
  return (req, res, next) => { const k = keyFn(req); if (k == null) return next(); const r = take(policy, policy + ':' + k);
    if (!r.ok) return tooMany(res, r.retryAfter, msg); next(); };
}
// What counts as heavy, and as signing in (paths under /api).
const HEAVY = [/^\/citizens\b/, /^\/chunks\b/, /^\/land\/quote\b/, /^\/admin\/(stats|accounts)\b/, /^\/leaderboards\//, /^\/square$/, /^\/online\b/];
const AUTH = [/^\/login\b/, /^\/signup\b/, /^\/claim\b/, /^\/auth\/google\b/];
// The API's own throttles: per IP for everything, a smaller allowance for heavy and sign-in requests, and one per player for actions.
export function apiThrottle(req, res, next) {
  const ip = ipOf(req), p = req.path;
  let r = take('api', 'api:' + ip); if (!r.ok) return tooMany(res, r.retryAfter);
  if (HEAVY.some(x => x.test(p))) { r = take('heavy', 'heavy:' + ip); if (!r.ok) return tooMany(res, r.retryAfter, 'That takes the server a while. Give it a moment and try again.'); }
  if (AUTH.some(x => x.test(p)) && req.method !== 'GET') { r = take('auth', 'auth:' + ip); if (!r.ok) return tooMany(res, r.retryAfter, 'Too many sign-in attempts. Wait a minute and try again.'); }
  const tok = req.get('x-player');
  if (tok && req.method !== 'GET') { r = take('act', 'act:' + crypto.createHash('sha256').update(tok).digest('hex').slice(0, 24)); if (!r.ok) return tooMany(res, r.retryAfter, 'You\'re doing things very fast. Take a breath and try again in a moment.'); }
  next();
}

// ---------- lock-outs after wrong keys or passwords ----------
const fails = new Map(); const LOCK_MS = 15 * 60 * 1000;
export const FAIL_LIMITS = { admin: env('FAILS_ADMIN', 10), key: env('FAILS_KEY', 10), login_ip: env('FAILS_LOGIN_IP', 30) };
export function locked(kind, key) { const f = fails.get(kind + ':' + key); return !!f && Date.now() - f.t < LOCK_MS && f.n >= FAIL_LIMITS[kind]; }
export function failed(kind, key) { const k = kind + ':' + key, now = Date.now(); let f = fails.get(k); if (!f || now - f.t > LOCK_MS) fails.set(k, f = { t: now, n: 0 }); f.n++;
  if (f.n === FAIL_LIMITS[kind]) console.warn(`security: ${kind} locked for ${key} after ${f.n} wrong tries`); }
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (now - f.t > LOCK_MS) fails.delete(k); }, 60000).unref();

// ---------- daily quotas and budgets (in the database) ----------
const day = () => new Date().toISOString().slice(0, 10);
// Count `n` of `kind` for this player today; over the quota, nothing is counted and the request is refused.
export async function spend(citizenId, kind, n = 1) {
  const max = QUOTAS[kind]; if (!max || !citizenId) return;
  const r = (await pool.query(`insert into usage_daily (subject, day, kind, n) values ($1, $2, $3, $4)
    on conflict (subject, day, kind) do update set n = usage_daily.n + $4 where usage_daily.n + $4 <= $5 returning n`, [citizenId, day(), kind, n, max])).rows[0];
  if (!r) throw new HttpError(429, `You've reached today's limit of ${max.toLocaleString('en-US')} ${QUOTA_NAMES[kind] || kind}. It resets at midnight UTC.`);
}
// The colony's paid services: true if `n` more fits in today's budget (and counts it), false if not.
export async function budget(kind, n = 1) {
  const max = BUDGETS[kind]; if (!max) return true;
  const r = (await pool.query(`insert into usage_daily (subject, day, kind, n) values ('_colony', $1, $2, $3)
    on conflict (subject, day, kind) do update set n = usage_daily.n + $3 where usage_daily.n + $3 <= $4 returning n`, [day(), kind, n, max])).rows[0];
  return !!r;
}
// For the builder: today's usage, the busiest players for each quota, and the colony's budgets.
export async function usageReport() {
  const d = day(), rows = (await pool.query(`select u.subject, u.kind, u.n, c.handle from usage_daily u left join citizens c on c.id = u.subject where u.day = $1 order by u.n desc limit 400`, [d])).rows;
  const quotas = {}; for (const [k, max] of Object.entries(QUOTAS)) { const mine = rows.filter(r => r.kind === k && r.subject !== '_colony'); quotas[k] = { name: QUOTA_NAMES[k], max, total: mine.reduce((a, r) => a + r.n, 0), top: mine.slice(0, 3).map(r => ({ h: r.handle, n: r.n })), atLimit: mine.filter(r => r.n >= max).length }; }
  const budgets = {}; for (const [k, max] of Object.entries(BUDGETS)) budgets[k] = { max, used: rows.find(r => r.subject === '_colony' && r.kind === k)?.n || 0 };
  return { day: d, quotas, budgets, limits: LIMITS, wsPerIp: WS_PER_IP, lockouts: [...fails.entries()].filter(([k, f]) => f.n >= (FAIL_LIMITS[k.split(':')[0]] || 1e9) && Date.now() - f.t < LOCK_MS).length };
}
// old days are cleared out now and then
setInterval(() => { pool.query('delete from usage_daily where day < $1', [new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10)]).catch(() => {}); }, 6 * 3600e3).unref();
