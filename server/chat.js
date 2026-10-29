// Private chats between verified colonists, and who is online.
// Online = a signed-in colonist with the colony open: their live connection signs in with their session, and every
// server marks its connected colonists as seen once a minute (so it works with several servers too).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';

export const ONLINE_WINDOW = 90 * 1000, MAX_DM = 500;
const pairOf = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
const isOnline = seen => Number(seen || 0) > Date.now() - ONLINE_WINDOW;
const person = r => ({ id: r.id, h: r.handle, n: r.display_name || '', g: r.gender || 'm', online: isOnline(r.last_seen), seen: Number(r.last_seen || 0) });

export class Chat {
  constructor(bus) { this.bus = bus; this.lastSend = new Map(); }
  async seen(ids, at = Date.now()) { if (ids.length) await pool.query('update citizens set last_seen = $2 where id = any($1)', [ids, at]); }
  async gone(id) { await pool.query('update citizens set last_seen = $2 where id = $1', [id, Date.now() - ONLINE_WINDOW - 1000]); }
  async online(limit = 60) {
    return (await pool.query(`select id, handle, display_name, gender, last_seen from citizens where last_seen > $1 order by last_seen desc limit $2`, [Date.now() - ONLINE_WINDOW, limit])).rows.map(person);
  }
  async conversations(me) {
    const rows = (await pool.query(`select distinct on (pair) pair, sender_id, recipient_id, text, t from dms where sender_id = $1 or recipient_id = $1 order by pair, t desc`, [me])).rows;
    if (!rows.length) return [];
    const other = r => (r.sender_id === me ? r.recipient_id : r.sender_id);
    const people = new Map((await pool.query('select id, handle, display_name, gender, last_seen from citizens where id = any($1)', [rows.map(other)])).rows.map(r => [r.id, person(r)]));
    const unread = new Map((await pool.query('select sender_id, count(*) n from dms where recipient_id = $1 and not read group by sender_id', [me])).rows.map(r => [r.sender_id, Number(r.n)]));
    return rows.map(r => ({ with: people.get(other(r)), last: { text: r.text, t: Number(r.t), mine: r.sender_id === me }, unread: unread.get(other(r)) || 0 }))
      .filter(c => c.with).sort((a, b) => b.last.t - a.last.t);
  }
  async other(handle) {
    const r = (await pool.query('select id, handle, display_name, gender, last_seen, pass_hash is not null verified from citizens where lower(handle) = lower($1)', [R.cleanHandle(handle)])).rows[0];
    if (!r) throw new HttpError(404, `There's no colonist called @${R.cleanHandle(handle)}.`);
    return r;
  }
  async thread(me, handle) {
    const o = await this.other(handle), pair = pairOf(me, o.id);
    const msgs = (await pool.query('select id, sender_id, text, t from dms where pair = $1 order by t desc limit 100', [pair])).rows.reverse();
    await pool.query('update dms set read = true where pair = $1 and recipient_id = $2 and not read', [pair, me]);
    return { with: { ...person(o), verified: o.verified }, messages: msgs.map(m => ({ id: m.id, mine: m.sender_id === me, text: m.text, t: Number(m.t) })) };
  }
  async send(meP, handle, text) {
    text = String(text || '').replace(/\s+$/g, '').replace(/^\s+/g, ''); if (!text) throw new HttpError(400, 'Write something first.');
    if (text.length > MAX_DM) throw new HttpError(400, `Messages can be up to ${MAX_DM} characters.`);
    const o = await this.other(handle);
    if (o.id === meP.id) throw new HttpError(400, "You can't message yourself.");
    if (!o.verified) throw new HttpError(403, `@${o.handle} hasn't verified their avatar yet, so they can't receive messages.`);
    const now = Date.now(); if (now - (this.lastSend.get(meP.id) || 0) < 700) throw new HttpError(429, 'Slow down a little.');
    this.lastSend.set(meP.id, now); if (this.lastSend.size > 5000) this.lastSend.clear();
    const m = { id: crypto.randomUUID(), pair: pairOf(meP.id, o.id), sender_id: meP.id, recipient_id: o.id, text, t: now };
    await pool.query('insert into dms (id, pair, sender_id, recipient_id, text, t) values ($1, $2, $3, $4, $5, $6)', [m.id, m.pair, m.sender_id, m.recipient_id, m.text, m.t]);
    // Delivered only to the two people's own connections, never broadcast.
    this.bus.publish([{ op: 'dm', private: true, to: [meP.id, o.id], data: { id: m.id, from: { id: meP.id, h: meP.handle, n: meP.name || '', g: meP.gender || 'm' }, to: { id: o.id, h: o.handle }, text, t: now } }]);
    await pool.query('delete from dms where pair = $1 and t < (select t from dms where pair = $1 order by t desc offset 500 limit 1)', [m.pair]); // keep the last 500 per chat
    return { ok: true, id: m.id, t: now };
  }
  async read(me, handle) { const o = await this.other(handle); await pool.query('update dms set read = true where pair = $1 and recipient_id = $2 and not read', [pairOf(me, o.id), me]); return { ok: true }; }
}
