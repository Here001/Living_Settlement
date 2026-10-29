// Private chats between verified colonists, and who is online.
// Online = a signed-in colonist with the colony open: their live connection signs in with their session, and every
// server marks its connected colonists as seen once a minute (so it works with several servers too).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';

export const ONLINE_WINDOW = 90 * 1000, MAX_DM = 500, REPORTS_PER_DAY = 20;
export const REPORT_REASONS = { spam: 'Spam', abuse: 'Abuse or harassment', scam: 'Scam or cheating', other: 'Something else' };
const HOUR = 3600 * 1000;
// Throws if a colonist is muted (the developer can mute someone who breaks the rules, for a day or a week).
export async function assertNotMuted(id) {
  const r = (await pool.query('select muted_until from citizens where id = $1', [id])).rows[0];
  const left = Number(r?.muted_until || 0) - Date.now();
  if (left > 0) throw new HttpError(403, `You've been muted for breaking the colony's rules. You can chat again in ${left > 36 * HOUR ? Math.ceil(left / (24 * HOUR)) + ' days' : Math.max(1, Math.ceil(left / HOUR)) + ' hour' + (Math.ceil(left / HOUR) > 1 ? 's' : '')}.`);
}
const pairOf = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
const isOnline = seen => Number(seen || 0) > Date.now() - ONLINE_WINDOW;
const person = r => ({ id: r.id, h: r.handle, n: r.display_name || '', g: r.gender || 'm', online: isOnline(r.last_seen), seen: Number(r.last_seen || 0) });

export class Chat {
  constructor(bus) { this.bus = bus; this.lastSend = new Map(); }
  async seen(ids, at = Date.now()) { if (ids.length) await pool.query('update citizens set last_seen = $2 where id = any($1)', [ids, at]); }
  async gone(id) { await pool.query('update citizens set last_seen = $2 where id = $1', [id, Date.now() - ONLINE_WINDOW - 1000]); }
  async online(limit = 60, me = null) {
    return (await pool.query(`select id, handle, display_name, gender, last_seen from citizens where last_seen > $1
      and ($3::text is null or id not in (select blocked_id from blocks where blocker_id = $3)) order by last_seen desc limit $2`, [Date.now() - ONLINE_WINDOW, limit, me])).rows.map(person);
  }
  // ---- Blocking: neither side can message the other, and the blocker stops seeing the other's Town Square posts. ----
  async blockState(me, other) {
    const r = (await pool.query('select blocker_id from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)', [me, other])).rows;
    return { iBlocked: r.some(x => x.blocker_id === me), blockedMe: r.some(x => x.blocker_id === other) };
  }
  async blocks(me) {
    return (await pool.query('select c.id, c.handle, c.display_name, c.gender, c.last_seen from blocks b join citizens c on c.id = b.blocked_id where b.blocker_id = $1 order by b.t desc', [me])).rows.map(person);
  }
  async block(me, handle) {
    const o = await this.other(handle); if (o.id === me) throw new HttpError(400, "You can't block yourself.");
    if (Number((await pool.query('select count(*) n from blocks where blocker_id = $1', [me])).rows[0].n) >= 500) throw new HttpError(409, "You've blocked as many colonists as you can. Unblock someone first.");
    await pool.query('insert into blocks (blocker_id, blocked_id, t) values ($1, $2, $3) on conflict do nothing', [me, o.id, Date.now()]);
    return { ok: true, blocked: o.handle };
  }
  async unblock(me, handle) { const o = await this.other(handle); await pool.query('delete from blocks where blocker_id = $1 and blocked_id = $2', [me, o.id]); return { ok: true, unblocked: o.handle }; }
  async conversations(me) {
    const rows = (await pool.query(`select distinct on (pair) pair, sender_id, recipient_id, text, t from dms where (sender_id = $1 or recipient_id = $1)
      and (case when sender_id = $1 then recipient_id else sender_id end) not in (select blocked_id from blocks where blocker_id = $1) order by pair, t desc`, [me])).rows;
    if (!rows.length) return [];
    const other = r => (r.sender_id === me ? r.recipient_id : r.sender_id);
    const people = new Map((await pool.query('select id, handle, display_name, gender, last_seen from citizens where id = any($1)', [rows.map(other)])).rows.map(r => [r.id, person(r)]));
    const unread = new Map((await pool.query('select sender_id, count(*) n from dms where recipient_id = $1 and not read and sender_id not in (select blocked_id from blocks where blocker_id = $1) group by sender_id', [me])).rows.map(r => [r.sender_id, Number(r.n)]));
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
    const b = await this.blockState(me, o.id);
    return { with: { ...person(o), verified: o.verified }, iBlocked: b.iBlocked, canSend: !b.iBlocked && !b.blockedMe && o.verified && o.id !== me, messages: msgs.map(m => ({ id: m.id, mine: m.sender_id === me, text: m.text, t: Number(m.t) })) };
  }
  async send(meP, handle, text) {
    text = String(text || '').replace(/\s+$/g, '').replace(/^\s+/g, ''); if (!text) throw new HttpError(400, 'Write something first.');
    if (text.length > MAX_DM) throw new HttpError(400, `Messages can be up to ${MAX_DM} characters.`);
    const o = await this.other(handle);
    if (o.id === meP.id) throw new HttpError(400, "You can't message yourself.");
    if (!o.verified) throw new HttpError(403, `@${o.handle} hasn't verified their avatar yet, so they can't receive messages.`);
    const b = await this.blockState(meP.id, o.id);
    if (b.iBlocked) throw new HttpError(403, `You've blocked @${o.handle}. Unblock them to send a message.`);
    if (b.blockedMe) throw new HttpError(403, `You can't message @${o.handle}.`);
    await assertNotMuted(meP.id);
    const now = Date.now(); if (now - (this.lastSend.get(meP.id) || 0) < 700) throw new HttpError(429, 'Slow down a little.');
    this.lastSend.set(meP.id, now); if (this.lastSend.size > 5000) this.lastSend.clear();
    const m = { id: crypto.randomUUID(), pair: pairOf(meP.id, o.id), sender_id: meP.id, recipient_id: o.id, text, t: now };
    await pool.query('insert into dms (id, pair, sender_id, recipient_id, text, t) values ($1, $2, $3, $4, $5, $6)', [m.id, m.pair, m.sender_id, m.recipient_id, m.text, m.t]);
    // Delivered only to the two people's own connections, never broadcast.
    this.bus.publish([{ op: 'dm', private: true, to: [meP.id, o.id], data: { id: m.id, from: { id: meP.id, h: meP.handle, n: meP.name || '', g: meP.gender || 'm' }, to: { id: o.id, h: o.handle }, text, t: now } }]);
    await pool.query('delete from dms where pair = $1 and t < (select t from dms where pair = $1 order by t desc offset 500 limit 1)', [m.pair]); // keep the last 500 per chat
    return { ok: true, id: m.id, t: now };
  }
  // ---- Reports: a colonist flags a private message they received, or someone's Town Square post, for the developer. ----
  async report(meP, { kind, id, reason, block } = {}) {
    reason = String(reason || ''); if (!REPORT_REASONS[reason]) throw new HttpError(400, 'Pick a reason for the report.');
    const now = Date.now(); let msg, context = null;
    if (kind === 'dm') {
      msg = (await pool.query('select d.id, d.pair, d.sender_id, d.recipient_id, d.text, d.t, c.handle from dms d join citizens c on c.id = d.sender_id where d.id = $1', [String(id || '')])).rows[0];
      if (!msg || msg.recipient_id !== meP.id) throw new HttpError(404, 'You can only report messages that were sent to you.');
      // The few messages around it, so the developer sees what was going on.
      context = (await pool.query('select sender_id, text, t from dms where pair = $1 and t <= $2 order by t desc limit 10', [msg.pair, msg.t])).rows.reverse()
        .map(m => ({ from: m.sender_id === meP.id ? meP.handle : msg.handle, text: m.text, t: Number(m.t) }));
    } else if (kind === 'square') {
      msg = (await pool.query('select id, citizen_id sender_id, handle, text, t, official from messages where id = $1', [String(id || '')])).rows[0];
      if (!msg || msg.official) throw new HttpError(404, 'That post is gone.');
      if (msg.sender_id === meP.id) throw new HttpError(400, "That's your own post.");
    } else throw new HttpError(400, 'Report a message or a post.');
    const day = (await pool.query('select count(*) n from reports where reporter_id = $1 and t > $2', [meP.id, now - 24 * HOUR])).rows[0];
    if (Number(day.n) >= REPORTS_PER_DAY) throw new HttpError(429, "You've sent a lot of reports today. The developer will look at them soon.");
    const ins = await pool.query(`insert into reports (id, reporter_id, reporter_handle, target_id, target_handle, kind, message_id, text, context, reason, t)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (reporter_id, message_id) do nothing`,
      [crypto.randomUUID(), meP.id, meP.handle, msg.sender_id, msg.handle, kind, msg.id, msg.text, context ? JSON.stringify(context) : null, reason, now]);
    if (block) await this.block(meP.id, msg.handle);
    this.bus.publish([{ op: 'reports' }]); // the developer's Reports tab refreshes
    return { ok: true, already: !ins.rowCount, blocked: block ? msg.handle : null };
  }
  async reports(status = 'open') {
    const rows = (await pool.query(`select r.*, c.muted_until, (select count(*) from reports x where x.target_id = r.target_id) times from reports r left join citizens c on c.id = r.target_id
      where r.status = $1 order by r.t desc limit 100`, [status === 'done' ? 'done' : 'open'])).rows;
    const open = Number((await pool.query("select count(*) n from reports where status = 'open'")).rows[0].n);
    return { open, reports: rows.map(r => ({ id: r.id, kind: r.kind, by: r.reporter_handle, who: r.target_handle, whoId: r.target_id, text: r.text, context: r.context, reason: r.reason,
      reasonName: REPORT_REASONS[r.reason] || r.reason, t: Number(r.t), times: Number(r.times), mutedUntil: Number(r.muted_until || 0) > Date.now() ? Number(r.muted_until) : 0, action: r.action, resolvedAt: Number(r.resolved_at || 0) })) };
  }
  // The developer settles a report: dismiss it, delete the message, or mute the colonist (for a day or a week). Muting can be lifted.
  async resolve(id, action) {
    const ACTIONS = { dismiss: 0, delete: 0, mute1: 24 * HOUR, mute7: 7 * 24 * HOUR, unmute: 0 };
    if (!(action in ACTIONS)) throw new HttpError(400, 'Unknown action.');
    const r = (await pool.query('select * from reports where id = $1', [id])).rows[0]; if (!r) throw new HttpError(404, 'That report is gone.');
    const now = Date.now(); let note = 'Dismissed.';
    if (action === 'delete' || action.startsWith('mute')) {
      if (r.kind === 'square') { const d = await pool.query('delete from messages where id = $1', [r.message_id]); if (d.rowCount) this.bus.publish([{ op: 'chatGone', id: r.message_id }]); }
      else { const d = (await pool.query('delete from dms where id = $1 returning sender_id, recipient_id', [r.message_id])).rows[0]; if (d) this.bus.publish([{ op: 'dmGone', private: true, to: [d.sender_id, d.recipient_id], id: r.message_id }]); }
      note = 'Message deleted.';
    }
    if (action.startsWith('mute')) { await pool.query('update citizens set muted_until = greatest(coalesce(muted_until, 0), $2) where id = $1', [r.target_id, now + ACTIONS[action]]); note = `Message deleted and @${r.target_handle} muted for ${action === 'mute1' ? 'a day' : 'a week'}.`; }
    if (action === 'unmute') { await pool.query('update citizens set muted_until = null where id = $1', [r.target_id]); return { ok: true, note: `@${r.target_handle} can chat again.` }; }
    // Every open report about the same message is settled together.
    await pool.query("update reports set status = 'done', action = $2, resolved_at = $3 where (id = $1 or message_id = $4) and status = 'open'", [id, action, now, r.message_id]);
    this.bus.publish([{ op: 'reports' }]);
    return { ok: true, note };
  }
  async read(me, handle) { const o = await this.other(handle); await pool.query('update dms set read = true where pair = $1 and recipient_id = $2 and not read', [pairOf(me, o.id), me]); return { ok: true }; }
}
