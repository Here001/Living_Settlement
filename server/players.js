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
export async function playerFrom(req) {
  const t = req.get('x-player'); if (!t) return null;
  const s = (await pool.query(`select s.citizen_id, s.last_seen, c.handle from sessions s join citizens c on c.id = s.citizen_id where s.token_hash = $1`, [sha(t)])).rows[0];
  if (!s || Date.now() - Number(s.last_seen) > SESSION_TTL) return null;
  if (Date.now() - Number(s.last_seen) > 3600 * 1000) pool.query('update sessions set last_seen = $2 where token_hash = $1', [sha(t), Date.now()]).catch(() => {});
  return { id: s.citizen_id, handle: s.handle };
}
// For later features (casino, crime, special tasks): routes that need a signed-in player.
export const requirePlayer = async (req, res, next) => {
  try { const p = await playerFrom(req); if (!p) return res.status(401).json({ error: 'Log in to your citizen first.' }); req.player = p; next(); } catch (e) { next(e); }
};

export function playersRouter({ limit, send, admin }) {
  const r = express.Router();

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
  r.delete('/session', limit, send(async req => { const t = req.get('x-player'); if (t) await pool.query('delete from sessions where token_hash = $1', [sha(t)]); return { ok: true }; }));

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
