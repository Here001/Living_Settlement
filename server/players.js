import { assertNotMuted } from './chat.js';
import express from 'express';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';

// Players prove an avatar is theirs, then set a password.
//
//   1. The browser asks for a claim: it gets a secret claim id (kept in that browser) and a public code like "CLAIM 482913".
//   2. The player comments that code on any of the account's Instagram posts, from the account the avatar belongs to.
//      The webhook sees the comment, checks the commenter's username matches the avatar, and marks the claim verified.
//      The code is public, but useless to anyone else: it only counts when that exact account posts it,
//      and only the browser holding the secret claim id can then set the password.
//   3. The browser sets a password and gets a session token. Later it can log in with the password.
// The same steps reset a forgotten password. The developer can also issue a pre-verified setup link.

const scrypt = promisify(crypto.scrypt);
const CLAIM_TTL = 30 * 60 * 1000;        // a code is good for 30 minutes
const SESSION_TTL = 90 * 24 * 3600 * 1000; // stay logged in for 90 days of inactivity
const CODE_RE = /\bclaim\s*#?\s*(\d{6})\b/i;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');

async function hashPassword(pw) { const salt = crypto.randomBytes(16); const key = await scrypt(pw, salt, 64); return `s1$${salt.toString('hex')}$${key.toString('hex')}`; }
async function checkPassword(pw, stored) {
  const [v, salt, key] = String(stored || '').split('$'); if (v !== 's1' || !salt || !key) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'hex'), 64); const want = Buffer.from(key, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function cleanPassword(pw) {
  pw = String(pw ?? ''); if (pw.length < 6) throw new HttpError(400, 'Use at least 6 characters.'); if (pw.length > 100) throw new HttpError(400, 'That password is too long.');
  return pw;
}
async function citizenByHandle(handle) {
  const h = R.cleanHandle(handle); if (!h) throw new HttpError(400, 'Type a username first.');
  const c = (await pool.query('select id, handle, pass_hash from citizens where lower(handle) = lower($1)', [h])).rows[0];
  if (!c) throw new HttpError(404, `No citizen called @${h} yet. Comment SPAWN on a post to move in.`);
  return c;
}
async function newSession(citizenId) {
  const t = token(), now = Date.now();
  await pool.query('insert into sessions (token_hash, citizen_id, created_at, last_seen) values ($1, $2, $3, $3)', [sha(t), citizenId, now]);
  return t;
}

// Failed logins are counted per username, so guessing someone's password is slow even from many addresses.
const failures = new Map();
function tooManyFailures(key) { const f = failures.get(key); return f && Date.now() - f.t < 15 * 60 * 1000 && f.n >= 8; }
function noteFailure(key) { const now = Date.now(); let f = failures.get(key); if (!f || now - f.t > 15 * 60 * 1000) failures.set(key, f = { t: now, n: 0 }); f.n++; }
setInterval(() => { const now = Date.now(); for (const [k, f] of failures) if (now - f.t > 15 * 60 * 1000) failures.delete(k); }, 60000).unref();

// Called by the Instagram webhook for every comment. Returns true if it verified a claim.
export async function checkClaimComment(username, text) {
  const m = CODE_RE.exec(String(text || '')); if (!m || !username) return false;
  const r = await pool.query(`update claims set verified_at = $3 where code = $1 and lower(handle) = lower($2) and verified_at is null and used_at is null and expires_at > $3 returning id_hash`,
    [m[1], R.cleanHandle(username), Date.now()]);
  return r.rowCount > 0;
}

// Who is calling: a player session token in the X-Player header (or null).
export async function playerFrom(req) { return playerByToken(req.get('x-player')); }
// The same check for a token on its own (the live connection signs in with it, so chats can be delivered there).
export async function playerByToken(t) {
  if (!t || typeof t !== 'string') return null;
  const s = (await pool.query(`select s.citizen_id, s.last_seen, c.handle, c.gender, c.gender_chosen, c.display_name from sessions s join citizens c on c.id = s.citizen_id where s.token_hash = $1`, [sha(t)])).rows[0];
  if (!s || Date.now() - Number(s.last_seen) > SESSION_TTL) return null;
  if (Date.now() - Number(s.last_seen) > 3600 * 1000) pool.query('update sessions set last_seen = $2 where token_hash = $1', [sha(t), Date.now()]).catch(() => {});
  return { id: s.citizen_id, handle: s.handle, name: s.display_name || '', gender: s.gender, genderChosen: !!s.gender_chosen };
}
// For later features (casino, crime, special tasks): routes that need a signed-in player.
export const requirePlayer = async (req, res, next) => {
  try { const p = await playerFrom(req); if (!p) return res.status(401).json({ error: 'Log in to your citizen first.' }); req.player = p; next(); } catch (e) { next(e); }
};

export function playersRouter({ limit, send, admin, world }) {
  const r = express.Router();
  // Anything a signed-in colonist changes may earn a badge, so check them shortly after.
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.get('x-player') && world.achievements) res.on('finish', () => { if (res.statusCode < 300) playerFrom(req).then(p => p && world.achievements.soon(p.id)).catch(() => {}); });
    next();
  });

  // Start proving an avatar is yours. Works for first-time setup and for a forgotten password.
  r.post('/claim', limit, send(async req => {
    const c = await citizenByHandle((req.body || {}).handle);
    const open = Number((await pool.query('select count(*) n from claims where citizen_id = $1 and used_at is null and expires_at > $2', [c.id, Date.now()])).rows[0].n);
    if (open >= 5) throw new HttpError(429, 'Too many codes for this citizen right now. Use one you already have, or try again in half an hour.');
    const id = token(), code = String(crypto.randomInt(100000, 1000000)), now = Date.now();
    await pool.query('insert into claims (id_hash, citizen_id, handle, code, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)', [sha(id), c.id, c.handle, code, now, now + CLAIM_TTL]);
    return { claimId: id, code: `CLAIM ${code}`, handle: c.handle, expiresAt: now + CLAIM_TTL, reset: !!c.pass_hash };
  }));
  r.get('/claim/:id', limit, send(async req => {
    const c = (await pool.query('select handle, verified_at, used_at, expires_at from claims where id_hash = $1', [sha(req.params.id)])).rows[0];
    if (!c) throw new HttpError(404, 'That code is no longer valid. Start again.');
    return { handle: c.handle, status: c.used_at ? 'used' : c.verified_at ? 'verified' : Number(c.expires_at) < Date.now() ? 'expired' : 'waiting' };
  }));
  // Once verified, set the password. This signs the player in and signs out any older sessions.
  r.post('/claim/:id/password', limit, send(async req => {
    const pw = cleanPassword((req.body || {}).password);
    const c = (await pool.query('select * from claims where id_hash = $1', [sha(req.params.id)])).rows[0];
    if (!c || c.used_at) throw new HttpError(404, 'That code is no longer valid. Start again.');
    if (!c.verified_at) throw new HttpError(409, 'We haven’t seen your comment yet.');
    if (Number(c.expires_at) + CLAIM_TTL < Date.now()) throw new HttpError(410, 'That code expired. Start again.');
    const used = await pool.query('update claims set used_at = $2 where id_hash = $1 and used_at is null', [sha(req.params.id), Date.now()]);
    if (!used.rowCount) throw new HttpError(404, 'That code was already used.');
    await pool.query('update citizens set pass_hash = $2, pass_set_at = $3 where id = $1', [c.citizen_id, await hashPassword(pw), Date.now()]);
    await pool.query('delete from sessions where citizen_id = $1', [c.citizen_id]);
    failures.delete(String(c.handle).toLowerCase());
    return { token: await newSession(c.citizen_id), handle: c.handle };
  }));

  r.post('/login', limit, send(async req => {
    const { handle, password } = req.body || {}; const key = String(R.cleanHandle(handle)).toLowerCase();
    if (tooManyFailures(key)) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes, or reset it with a new code.');
    const c = await citizenByHandle(handle);
    if (!c.pass_hash) throw new HttpError(409, `@${c.handle} hasn’t set a password yet. Prove it’s you first.`);
    if (!(await checkPassword(String(password ?? ''), c.pass_hash))) { noteFailure(key); throw new HttpError(401, 'Wrong password.'); }
    failures.delete(key);
    return { token: await newSession(c.id), handle: c.handle };
  }));
  r.get('/me', limit, send(async req => { const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Not logged in.'); return p; }));
  // Once their avatar is claimed, a colonist picks man or woman, one time only. (The developer can still change it.)
  // A colonist's display name, changeable any time by its owner.
  r.post('/me/name', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    return world.setName(p.id, (req.body || {}).name);
  }));
  // Crime, going somewhere, and pets.
  const me = async req => { const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.'); return p; };
  r.get('/me/crime', limit, send(async req => world.actions.crimeInfo((await me(req)).id)));
  r.post('/me/crime', limit, send(async req => { const b = req.body || {}; return world.actions.crime((await me(req)).id, { kind: b.kind, target: b.target }); }));
  r.get('/me/places', limit, send(async req => world.actions.places((await me(req)).id)));
  r.post('/me/visit', limit, send(async req => { const b = req.body || {}; return world.actions.visit((await me(req)).id, { buildingId: b.buildingId, friend: b.friend }); }));
  r.post('/me/visit/end', limit, send(async req => world.actions.visit((await me(req)).id, {})));
  r.post('/me/pet', limit, send(async req => { const b = req.body || {}; return world.actions.adopt((await me(req)).id, { kind: b.kind, name: b.name }); }));
  r.put('/me/pet', limit, send(async req => world.actions.renamePet((await me(req)).id, (req.body || {}).name)));
  r.delete('/me/pet', limit, send(async req => world.actions.release((await me(req)).id)));
  // The Bank, cars, moving home, and owning buildings.
  // Private chats between verified colonists, and who's online.
  r.get('/online', limit, send(async req => world.chat.online(60, (await playerFrom(req))?.id || null)));
  r.get('/blocks', limit, send(async req => world.chat.blocks((await me(req)).id)));
  r.post('/blocks/:handle', limit, send(async req => world.chat.block((await me(req)).id, req.params.handle)));
  r.delete('/blocks/:handle', limit, send(async req => world.chat.unblock((await me(req)).id, req.params.handle)));
  r.post('/report', limit, send(async req => world.chat.report(await me(req), req.body || {})));
  r.get('/admin/reports', admin, send(req => world.chat.reports(req.query.status)));
  r.post('/admin/reports/:id', admin, send(req => world.chat.resolve(req.params.id, (req.body || {}).action)));
  r.get('/dm', limit, send(async req => world.chat.conversations((await me(req)).id)));
  r.get('/dm/:handle', limit, send(async req => world.chat.thread((await me(req)).id, req.params.handle)));
  r.post('/dm/:handle', limit, send(async req => world.chat.send(await me(req), req.params.handle, (req.body || {}).text)));
  r.post('/dm/:handle/read', limit, send(async req => world.chat.read((await me(req)).id, req.params.handle)));
  r.get('/leaderboards/:board', limit, send(async req => { const p = await playerFrom(req); const b = await world.leaderboards.board(req.params.board, p?.id || null); if (!b) throw new HttpError(404, 'No such leaderboard.'); return b; }));
  r.get('/me/badges', limit, send(async req => world.achievements.list((await me(req)).id)));
  r.get('/me/daily', limit, send(async req => world.economy.dailyInfo((await me(req)).id)));
  r.post('/me/daily', limit, send(async req => world.economy.daily((await me(req)).id)));
  r.get('/me/gift', limit, send(async req => world.economy.giftInfo((await me(req)).id)));
  r.post('/me/gift', limit, send(async req => { const b = req.body || {}; return world.economy.gift((await me(req)).id, b.to, b.amount); }));
  r.get('/me/bank', limit, send(async req => world.economy.bankInfo((await me(req)).id)));
  r.post('/me/bank/deposit', limit, send(async req => world.economy.bank((await me(req)).id, 'deposit', (req.body || {}).amount)));
  r.post('/me/bank/withdraw', limit, send(async req => world.economy.bank((await me(req)).id, 'withdraw', (req.body || {}).amount)));
  r.post('/me/cars', limit, send(async req => { const b = req.body || {}; return world.economy.buyCar((await me(req)).id, String(b.model || ''), String(b.color || '')); }));
  r.delete('/me/cars/:id', limit, send(async req => world.economy.sellCar((await me(req)).id, req.params.id)));
  r.put('/me/cars/active', limit, send(async req => world.economy.driveCar((await me(req)).id, String((req.body || {}).id || ''))));
  r.get('/me/homes', limit, send(async req => world.economy.homes((await me(req)).id)));
  r.post('/me/home', limit, send(async req => world.economy.moveHome((await me(req)).id, (req.body || {}).buildingId)));
  r.get('/me/properties', limit, send(async req => world.economy.properties((await me(req)).id)));
  r.post('/me/properties/buy', limit, send(async req => world.economy.buy((await me(req)).id, (req.body || {}).buildingId)));
  r.post('/me/properties/sell', limit, send(async req => world.economy.sell((await me(req)).id, (req.body || {}).buildingId)));
  r.post('/me/lottery', limit, send(async req => world.lottery.buy((await me(req)).id, (req.body || {}).count, world.blockedReason?.bind(world))));
  // Creature races: one bet per race, before the gates close.
  r.post('/me/race/bet', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    const b = req.body || {}; return world.races.bet(p.id, String(b.creature || ''), b.amount, world.blockedReason?.bind(world));
  }));
  // The casino: what's available, and one bet at a time (a short pause between bets stops scripted spam).
  const lastBet = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, t] of lastBet) if (now - t > 60000) lastBet.delete(k); }, 60000).unref();
  r.get('/me/casino', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    return world.casinoInfo(p.id);
  }));
  r.post('/me/casino', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    const now = Date.now(); if (now - (lastBet.get(p.id) || 0) < 1200) throw new HttpError(429, 'One bet at a time.');
    lastBet.set(p.id, now);
    const b = req.body || {}; return world.casinoPlay(p.id, { game: b.game, pick: b.pick, bet: b.bet });
  }));
  // The job board: openings near home, take one (once per game day), or quit.
  r.get('/me/jobs', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    return world.jobBoard(p.id);
  }));
  r.post('/me/job', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    const id = String((req.body || {}).buildingId || ''); if (!id) throw new HttpError(400, 'Pick a job first.');
    return world.playerJob(p.id, id);
  }));
  r.post('/me/job/quit', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    return world.playerJob(p.id, null);
  }));
  r.post('/me/gender', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Log in to your colonist first.');
    const g = (req.body || {}).gender; if (g !== 'm' && g !== 'f') throw new HttpError(400, 'Choose man or woman.');
    const lock = await pool.query('update citizens set gender_chosen = true where id = $1 and not gender_chosen returning id', [p.id]);
    if (!lock.rowCount) throw new HttpError(409, 'You have already chosen. Ask the developer if it needs changing.');
    await world.setGender(p.id, g);
    return { ok: true, gender: g };
  }));
  r.delete('/session', limit, send(async req => { const t = req.get('x-player'); if (t) await pool.query('delete from sessions where token_hash = $1', [sha(t)]); return { ok: true }; }));

  // ---------- Town Square: messages from verified colonists ----------
  const lastPost = new Map(); // citizen id → time of their last message (slows down spam)
  const msgOut = m => ({ id: m.id, h: m.handle, n: m.official ? m.handle : (m.display_name || ''), g: m.gender, text: m.text, t: Number(m.t), o: m.official ? 1 : 0, p: m.pinned ? 1 : 0 });
  r.get('/square', limit, send(async () => (await pool.query(`(select m.*, c.display_name from messages m left join citizens c on c.id = m.citizen_id order by m.t desc limit 80)
    union (select m.*, c.display_name from messages m left join citizens c on c.id = m.citizen_id where m.pinned) order by t desc`)).rows.map(msgOut)));
  r.post('/square', limit, send(async req => {
    const p = await playerFrom(req); if (!p) throw new HttpError(401, 'Claim your colonist to post in the Town Square.');
    let text = String((req.body || {}).text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) throw new HttpError(400, 'Write something first.');
    if (text.length > 280) throw new HttpError(400, 'Keep it under 280 characters.');
    if (/(https?:\/\/|www\.)/i.test(text)) throw new HttpError(400, 'Links can’t be posted in the Town Square.');
    await assertNotMuted(p.id);
    const now = Date.now(), last = lastPost.get(p.id) || 0;
    if (now - last < 15000) throw new HttpError(429, `Wait ${Math.ceil((15000 - (now - last)) / 1000)} seconds before posting again.`);
    const prev = (await pool.query('select text from messages where citizen_id = $1 order by t desc limit 1', [p.id])).rows[0];
    if (prev && prev.text === text) throw new HttpError(409, 'You just posted that.');
    lastPost.set(p.id, now);
    const m = (await pool.query('insert into messages (id, citizen_id, handle, gender, text, t) values ($1, $2, $3, $4, $5, $6) returning *', [crypto.randomUUID(), p.id, p.handle, p.gender || 'm', text, now])).rows[0];
    m.display_name = p.name || ''; world.bus.publish([{ op: 'chat', data: msgOut(m) }]);
    return msgOut(m);
  }));
  // The developer posts officially (as the colony's updates account) and can pin any post to the top.
  const OFFICIAL = 'Man Landing Updates';
  r.post('/admin/square', admin, send(async req => {
    const text = String((req.body || {}).text ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim();
    if (!text) throw new HttpError(400, 'Write something first.');
    if (text.length > 1000) throw new HttpError(400, 'Keep it under 1000 characters.');
    const pin = !!(req.body || {}).pin;
    if (pin && Number((await pool.query('select count(*) n from messages where pinned')).rows[0].n) >= 3) throw new HttpError(409, 'Up to 3 posts can be pinned. Unpin one first.');
    const m = (await pool.query('insert into messages (id, citizen_id, handle, gender, text, t, official, pinned) values ($1, $2, $3, $4, $5, $6, true, $7) returning *',
      [crypto.randomUUID(), 'official', OFFICIAL, 'm', text, Date.now(), pin])).rows[0];
    world.bus.publish([{ op: 'chat', data: msgOut(m) }]);
    return msgOut(m);
  }));
  r.put('/admin/square/:id/pin', admin, send(async req => {
    const pinned = !!(req.body || {}).pinned;
    if (pinned && Number((await pool.query('select count(*) n from messages where pinned and id <> $1', [req.params.id])).rows[0].n) >= 3) throw new HttpError(409, 'Up to 3 posts can be pinned. Unpin one first.');
    const m = (await pool.query('update messages set pinned = $2 where id = $1 returning id', [req.params.id, pinned])).rows[0];
    if (!m) throw new HttpError(404, 'That message is gone.');
    world.bus.publish([{ op: 'chatPin', id: req.params.id, pinned }]);
    return { ok: true, pinned };
  }));
  r.delete('/square/:id', limit, send(async req => {
    const p = await playerFrom(req); const isAdmin = admin.check(req);
    const where = isAdmin ? 'id = $1' : 'id = $1 and citizen_id = $2';
    const del = await pool.query(`delete from messages where ${where} returning id`, isAdmin ? [req.params.id] : [req.params.id, p?.id || '']);
    if (!del.rowCount) throw new HttpError(404, 'That message is already gone, or isn’t yours.');
    world.bus.publish([{ op: 'chatGone', id: req.params.id }]);
    return { ok: true };
  }));

  // Developer: a pre-verified setup link for one citizen (before Instagram is connected, or to settle a dispute),
  // or clear a password so nobody can use it until the owner proves it's them again.
  r.post('/admin/citizens/:id/setup-link', admin, send(async req => {
    const c = (await pool.query('select id, handle from citizens where id = $1', [req.params.id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const id = token(), now = Date.now();
    await pool.query('insert into claims (id_hash, citizen_id, handle, code, created_at, expires_at, verified_at) values ($1, $2, $3, $4, $5, $6, $5)', [sha(id), c.id, c.handle, 'admin', now, now + 24 * 3600 * 1000]);
    return { claimId: id, handle: c.handle, expiresAt: now + 24 * 3600 * 1000 };
  }));
  r.delete('/admin/citizens/:id/password', admin, send(async req => {
    await pool.query('update citizens set pass_hash = null, pass_set_at = null where id = $1', [req.params.id]);
    await pool.query('delete from sessions where citizen_id = $1', [req.params.id]);
    return { ok: true };
  }));
  return r;
}

// Old claims and sessions are swept away now and then.
export async function sweepPlayers() {
  const now = Date.now();
  await pool.query('delete from claims where expires_at < $1', [now - 24 * 3600 * 1000]);
  await pool.query('delete from sessions where last_seen < $1', [now - SESSION_TTL]);
}
