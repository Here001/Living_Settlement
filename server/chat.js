// Private chats between verified colonists, and who is online.
// Online = a signed-in colonist with the colony open: their live connection signs in with their session, and every
// server marks its connected colonists as seen once a minute (so it works with several servers too).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';

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
  // Each person's own settings for a chat (key 'dm:<their id>' or 'g:<group id>'): pinned, deleted up to a time, accepted, read up to.
  async states(me) { return new Map((await pool.query('select * from chat_state where citizen_id = $1', [me])).rows.map(r => [r.key, r])); }
  async setState(me, key, fields) {
    const cols = Object.keys(fields), vals = Object.values(fields);
    await pool.query(`insert into chat_state (citizen_id, key, ${cols.join(', ')}) values ($1, $2, ${cols.map((_, i) => '$' + (i + 3)).join(', ')})
      on conflict (citizen_id, key) do update set ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}`, [me, key, ...vals]);
  }
  // Your private chats. A chat someone started that you've never replied to (or accepted) is a message request.
  async conversations(me) {
    const rows = (await pool.query(`select distinct on (pair) pair, sender_id, recipient_id, text, t from dms where (sender_id = $1 or recipient_id = $1)
      and (case when sender_id = $1 then recipient_id else sender_id end) not in (select blocked_id from blocks where blocker_id = $1) order by pair, t desc`, [me])).rows;
    if (!rows.length) return [];
    const other = r => (r.sender_id === me ? r.recipient_id : r.sender_id), st = await this.states(me);
    const people = new Map((await pool.query('select id, handle, display_name, gender, last_seen from citizens where id = any($1)', [rows.map(other)])).rows.map(r => [r.id, person(r)]));
    const unread = new Map((await pool.query('select sender_id, count(*) n from dms where recipient_id = $1 and not read and sender_id not in (select blocked_id from blocks where blocker_id = $1) group by sender_id', [me])).rows.map(r => [r.sender_id, Number(r.n)]));
    // who started each chat: a chat someone else started stays a request until you accept it (replying doesn't accept it)
    const starter = new Map((await pool.query('select distinct on (pair) pair, sender_id from dms where pair = any($1) order by pair, t asc', [rows.map(r => r.pair)])).rows.map(r => [r.pair, r.sender_id]));
    return rows.map(r => { const o = other(r), s = st.get('dm:' + o) || {};
      return { with: people.get(o), last: { text: r.text, t: Number(r.t), mine: r.sender_id === me }, unread: unread.get(o) || 0, pinned: !!s.pinned,
        request: starter.get(r.pair) !== me && !s.accepted, cleared: Number(r.t) <= Number(s.cleared_at || 0) }; })
      .filter(c => c.with && !c.cleared).sort((a, b) => (b.pinned - a.pinned) || (b.last.t - a.last.t));
  }
  // ---- The fee for messaging someone who doesn't live nearby ----
  async homes(ids) { return new Map((await pool.query('select c.id, h.x, h.y from citizens c left join buildings h on h.id = c.home_id where c.id = any($1)', [ids])).rows.map(r => [r.id, r.x == null ? null : [r.x, r.y]])); }
  async feeFor(me, others) {
    const H = await this.homes([me, ...others]), mine = H.get(me); let far = 0, maxD = 0;
    for (const o of others) { const h = H.get(o), d = mine && h ? Math.hypot(mine[0] - h[0], mine[1] - h[1]) : Infinity; if (!(d <= R.NEIGHBOUR_TILES)) far++; if (Number.isFinite(d)) maxD = Math.max(maxD, d); }
    return { fee: far ? R.MESSAGE_FEE : 0, near: !far, miles: maxD ? R.miles(maxD) : null, far };
  }
  async charge(me, fee) {
    if (!fee || !this.world) return;
    await this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [me])).rows[0]; ch.coins(c);
      if (c.coins_base < fee) throw new HttpError(400, `Messages to colonists who live far away cost ${fee} coins each, and you have ${c.coins_base} on you.`);
      c.coins_base -= fee; treasuryAdd(ch, fee); track(ch, 'chat:fee', fee, c.id); ch.touch(c); await ch.saveCitizen(c);
    });
  }
  async other(handle) {
    const r = (await pool.query('select id, handle, display_name, gender, last_seen, pass_hash is not null verified from citizens where lower(handle) = lower($1)', [R.cleanHandle(handle)])).rows[0];
    if (!r) throw new HttpError(404, `There's no colonist called @${R.cleanHandle(handle)}.`);
    return r;
  }
  async thread(me, handle) {
    const o = await this.other(handle), pair = pairOf(me, o.id), s = (await this.states(me)).get('dm:' + o.id) || {};
    const msgs = (await pool.query('select id, sender_id, text, t, reply_to, reply_text, reply_from from dms where pair = $1 and t > $2 order by t desc limit 100', [pair, Number(s.cleared_at || 0)])).rows.reverse();
    await pool.query('update dms set read = true where pair = $1 and recipient_id = $2 and not read', [pair, me]);
    const b = await this.blockState(me, o.id), first = (await pool.query('select sender_id from dms where pair = $1 order by t asc limit 1', [pair])).rows[0];
    return { with: { ...person(o), verified: o.verified }, iBlocked: b.iBlocked, canSend: !b.iBlocked && !b.blockedMe && o.verified && o.id !== me,
      request: !!first && first.sender_id !== me && !s.accepted, pinned: !!s.pinned, cost: await this.feeFor(me, [o.id]), messages: msgs.map(m => msgOut(m, me)) };
  }
  // People you chat with (chats you started, or requests you accepted), most messages first: for @ suggestions.
  async contacts(me) {
    const rows = (await pool.query(`select pair, count(*) n, min(t) first_t from dms where sender_id = $1 or recipient_id = $1 group by pair order by count(*) desc limit 60`, [me])).rows; if (!rows.length) return [];
    const st = await this.states(me), starter = new Map((await pool.query('select distinct on (pair) pair, sender_id from dms where pair = any($1) order by pair, t asc', [rows.map(r => r.pair)])).rows.map(r => [r.pair, r.sender_id]));
    const others = rows.map(r => r.pair.split(':').find(x => x !== me)), people = new Map((await pool.query('select id, handle, display_name, gender, last_seen from citizens where id = any($1) and id not in (select blocked_id from blocks where blocker_id = $2)', [others, me])).rows.map(r => [r.id, person(r)]));
    return rows.map((r, i) => ({ ...people.get(others[i]), count: Number(r.n), ok: starter.get(r.pair) === me || !!st.get('dm:' + others[i])?.accepted })).filter(x => x.h && x.ok).map(({ ok, seen, ...x }) => x);
  }
  async accept(me, handle) { const o = await this.other(handle); await this.setState(me, 'dm:' + o.id, { accepted: true }); return { ok: true }; }
  async pin(me, key, on) { await this.setState(me, key, { pinned: !!on }); return { ok: true, pinned: !!on }; }
  // Deleting a chat clears it for you only; a new message brings it back (starting from there).
  async clear(me, handle) { const o = await this.other(handle); await this.setState(me, 'dm:' + o.id, { cleared_at: Date.now(), pinned: false }); await pool.query('update dms set read = true where pair = $1 and recipient_id = $2', [pairOf(me, o.id), me]); return { ok: true }; }
  // The message being replied to: its text (shortened) and who wrote it, saved with the reply.
  async quote(table, where, args, id) {
    if (!id) return null; const q = (await pool.query(`select m.text, c.handle from ${table} m join citizens c on c.id = m.sender_id where m.id = $1 and ${where}`, [String(id), ...args])).rows[0];
    return q ? { id: String(id), text: q.text.length > 140 ? q.text.slice(0, 140) + '…' : q.text, from: q.handle } : null;
  }
  async send(meP, handle, text, replyTo) {
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
    const pair = pairOf(meP.id, o.id), rq = await this.quote('dms', 'm.pair = $2', [pair], replyTo), cost = await this.feeFor(meP.id, [o.id]);
    await this.charge(meP.id, cost.fee);
    const first = !Number((await pool.query('select count(*) n from dms where pair = $1', [pair])).rows[0].n);
    const m = { id: crypto.randomUUID(), pair, sender_id: meP.id, recipient_id: o.id, text, t: now };
    await pool.query('insert into dms (id, pair, sender_id, recipient_id, text, t, reply_to, reply_text, reply_from, fee) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [m.id, m.pair, m.sender_id, m.recipient_id, m.text, m.t, rq?.id || null, rq?.text || null, rq?.from || null, cost.fee]);
    // Delivered only to the two people's own connections, never broadcast.
    this.bus.publish([{ op: 'dm', private: true, to: [meP.id, o.id], data: { id: m.id, from: { id: meP.id, h: meP.handle, n: meP.name || '', g: meP.gender || 'm' }, to: { id: o.id, h: o.handle }, text, t: now, reply: rq, first } }]);
    if (this.push && !isOnline(o.last_seen)) this.push.send([o.id], { kind: 'chat', title: `💬 ${meP.name || '@' + meP.handle}`, body: text.length > 120 ? text.slice(0, 120) + '…' : text, tag: 'dm-' + meP.id, url: '/?chat=' + encodeURIComponent(meP.handle) }).catch(() => {});
    await pool.query('delete from dms where pair = $1 and t < (select t from dms where pair = $1 order by t desc offset 500 limit 1)', [m.pair]); // keep the last 500 per chat
    return { ok: true, id: m.id, t: now, fee: cost.fee };
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

  // ---- Group chats ----
  // Someone creates a group and invites colonists; each invitee gets a message from the colony asking whether to join.
  // Members can invite more people. A message is free if every member lives near you; otherwise it costs the usual fee.
  async colonyName() { return this.world?.meta?.name || 'the colony'; }
  async group(id) { const g = (await pool.query('select * from chat_groups where id = $1', [String(id || '')])).rows[0]; if (!g) throw new HttpError(404, 'That group chat no longer exists.'); return g; }
  async members(gid) { return (await pool.query(`select m.citizen_id, m.status, m.invited_by, c.handle, c.display_name, c.gender, c.last_seen from group_members m join citizens c on c.id = m.citizen_id where m.group_id = $1 order by m.t`, [gid])).rows; }
  async inviteTo(meP, g, handles) {
    const list = [...new Set((Array.isArray(handles) ? handles : String(handles || '').split(/[\s,]+/)).map(R.cleanHandle).filter(Boolean))];
    const now_ = await this.members(g.id), have = new Map(now_.map(m => [m.handle.toLowerCase(), m]));
    if (now_.filter(m => m.status !== 'left' && m.status !== 'declined').length + list.length > R.GROUP_MAX) throw new HttpError(400, `A group chat holds up to ${R.GROUP_MAX} colonists.`);
    const invited = [], colony = await this.colonyName();
    for (const h of list) { if (h.toLowerCase() === meP.handle.toLowerCase()) continue; const ex = have.get(h.toLowerCase()); if (ex && (ex.status === 'member' || ex.status === 'invited')) continue;
      const o = await this.other(h); if (!o.verified) throw new HttpError(403, `@${o.handle} hasn't verified their avatar yet, so they can't join chats.`);
      const b = await this.blockState(meP.id, o.id); if (b.iBlocked || b.blockedMe) throw new HttpError(403, `You can't invite @${o.handle}.`);
      await pool.query(`insert into group_members (group_id, citizen_id, status, invited_by, t) values ($1, $2, 'invited', $3, $4) on conflict (group_id, citizen_id) do update set status = 'invited', invited_by = $3, t = $4`, [g.id, o.id, meP.id, Date.now()]);
      invited.push(o);
      const text = `@${meP.handle} invited you to join the group chat “${g.name}”. Do you want to join?`;
      this.bus.publish([{ op: 'chatInvite', private: true, to: [o.id], data: { group: { id: g.id, name: g.name }, by: meP.handle, from: colony, text, t: Date.now() } }]);
      if (this.push) this.push.send([o.id], { kind: 'chat', title: `🪐 ${colony}`, body: text, tag: 'ginv-' + g.id, url: '/?chats=1' }).catch(() => {});
    }
    return invited.map(o => o.handle);
  }
  async createGroup(meP, { name, members }) {
    name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (name.length < 2) throw new HttpError(400, 'Give the group a name.');
    await assertNotMuted(meP.id);
    const g = { id: crypto.randomUUID(), name, owner_id: meP.id, created_at: Date.now() };
    await pool.query('insert into chat_groups (id, name, owner_id, created_at) values ($1, $2, $3, $4)', [g.id, g.name, g.owner_id, g.created_at]);
    await pool.query(`insert into group_members (group_id, citizen_id, status, invited_by, t) values ($1, $2, 'member', null, $3)`, [g.id, meP.id, Date.now()]);
    let invited = []; try { invited = await this.inviteTo(meP, g, members); } catch (e) { await pool.query('delete from group_members where group_id = $1', [g.id]); await pool.query('delete from chat_groups where id = $1', [g.id]); throw e; }
    return { ok: true, id: g.id, name: g.name, invited };
  }
  async groups(me) {
    const rows = (await pool.query(`select g.*, m.status, m.invited_by, m.t joined_at from group_members m join chat_groups g on g.id = m.group_id where m.citizen_id = $1 and m.status in ('member', 'invited')`, [me])).rows;
    const st = await this.states(me), colony = await this.colonyName(), out = [], invites = [];
    for (const g of rows) {
      if (g.status === 'invited') { const by = g.invited_by && (await pool.query('select handle from citizens where id = $1', [g.invited_by])).rows[0]?.handle;
        invites.push({ id: g.id, name: g.name, by: by || '?', from: colony, t: Number(g.joined_at), text: `@${by || '?'} invited you to join the group chat “${g.name}”. Do you want to join?` }); continue; }
      const s = st.get('g:' + g.id) || {}, since = Math.max(Number(s.cleared_at || 0), 0);
      const last = (await pool.query(`select m.text, m.t, m.sender_id, c.handle from group_msgs m join citizens c on c.id = m.sender_id where m.group_id = $1 and m.t > $2 order by m.t desc limit 1`, [g.id, since])).rows[0];
      const unread = Number((await pool.query('select count(*) n from group_msgs where group_id = $1 and t > $2 and sender_id <> $3', [g.id, Math.max(since, Number(s.read_at || 0)), me])).rows[0].n);
      const n = Number((await pool.query("select count(*) n from group_members where group_id = $1 and status = 'member'", [g.id])).rows[0].n);
      out.push({ id: g.id, name: g.name, members: n, pinned: !!s.pinned, unread, last: last ? { text: last.text, t: Number(last.t), mine: last.sender_id === me, from: last.handle } : { text: 'Group created', t: Number(g.created_at), mine: false } });
    }
    out.sort((a, b) => (b.pinned - a.pinned) || (b.last.t - a.last.t)); invites.sort((a, b) => b.t - a.t);
    return { groups: out, invites };
  }
  async respond(me, gid, join) {
    const g = await this.group(gid), m = (await pool.query('select status from group_members where group_id = $1 and citizen_id = $2', [g.id, me])).rows[0];
    if (!m || m.status !== 'invited') throw new HttpError(409, 'That invitation is no longer open.');
    await pool.query('update group_members set status = $3, t = $4 where group_id = $1 and citizen_id = $2', [g.id, me, join ? 'member' : 'declined', Date.now()]);
    if (join) { const who = (await pool.query('select handle from citizens where id = $1', [me])).rows[0]; await this.system(g, `@${who.handle} joined the group.`); }
    return { ok: true, joined: !!join, id: g.id };
  }
  async leave(me, gid) { const g = await this.group(gid); const who = (await pool.query('select handle from citizens where id = $1', [me])).rows[0];
    await pool.query("update group_members set status = 'left', t = $3 where group_id = $1 and citizen_id = $2", [g.id, me, Date.now()]); await this.system(g, `@${who.handle} left the group.`); return { ok: true }; }
  async system(g, text) { // a line from the colony in the group (who joined or left)
    const m = { id: crypto.randomUUID(), t: Date.now() }; await pool.query('insert into group_msgs (id, group_id, sender_id, text, t) values ($1, $2, $3, $4, $5)', [m.id, g.id, 'system', text, m.t]);
    const ids = (await pool.query("select citizen_id from group_members where group_id = $1 and status = 'member'", [g.id])).rows.map(r => r.citizen_id);
    this.bus.publish([{ op: 'gm', private: true, to: ids, data: { group: g.id, id: m.id, system: true, text, t: m.t } }]); }
  async gthread(me, gid) {
    const g = await this.group(gid), ms = await this.members(g.id), mine = ms.find(m => m.citizen_id === me);
    if (!mine || mine.status !== 'member') throw new HttpError(403, "You're not in this group.");
    const s = (await this.states(me)).get('g:' + g.id) || {};
    const msgs = (await pool.query(`select m.*, c.handle, c.display_name, c.gender from group_msgs m left join citizens c on c.id = m.sender_id where m.group_id = $1 and m.t > $2 order by m.t desc limit 150`, [g.id, Number(s.cleared_at || 0)])).rows.reverse();
    await this.setState(me, 'g:' + g.id, { read_at: Date.now() });
    const others = ms.filter(m => m.status === 'member' && m.citizen_id !== me).map(m => m.citizen_id);
    return { group: { id: g.id, name: g.name, owner: g.owner_id === me }, pinned: !!s.pinned, cost: others.length ? await this.feeFor(me, others) : { fee: 0, near: true },
      members: ms.filter(m => m.status === 'member' || m.status === 'invited').map(m => ({ h: m.handle, n: m.display_name || '', g: m.gender || 'm', status: m.status, online: isOnline(m.last_seen), me: m.citizen_id === me })),
      messages: msgs.map(m => m.sender_id === 'system' ? { id: m.id, system: true, text: m.text, t: Number(m.t) } : { ...msgOut(m, me), from: { h: m.handle, n: m.display_name || '', g: m.gender || 'm' } }) };
  }
  async gsend(meP, gid, text, replyTo) {
    text = String(text || '').trim(); if (!text) throw new HttpError(400, 'Write something first.'); if (text.length > MAX_DM) throw new HttpError(400, `Messages can be up to ${MAX_DM} characters.`);
    const g = await this.group(gid), ms = await this.members(g.id); if (!ms.some(m => m.citizen_id === meP.id && m.status === 'member')) throw new HttpError(403, "You're not in this group.");
    await assertNotMuted(meP.id);
    const now = Date.now(); if (now - (this.lastSend.get(meP.id) || 0) < 700) throw new HttpError(429, 'Slow down a little.'); this.lastSend.set(meP.id, now);
    const others = ms.filter(m => m.status === 'member' && m.citizen_id !== meP.id).map(m => m.citizen_id), cost = others.length ? await this.feeFor(meP.id, others) : { fee: 0 };
    const rq = await this.quote('group_msgs', 'm.group_id = $2', [g.id], replyTo);
    await this.charge(meP.id, cost.fee);
    const m = { id: crypto.randomUUID(), t: now };
    await pool.query('insert into group_msgs (id, group_id, sender_id, text, t, reply_to, reply_text, reply_from, fee) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [m.id, g.id, meP.id, text, now, rq?.id || null, rq?.text || null, rq?.from || null, cost.fee]);
    this.bus.publish([{ op: 'gm', private: true, to: [meP.id, ...others], data: { group: g.id, name: g.name, id: m.id, from: { id: meP.id, h: meP.handle, n: meP.name || '', g: meP.gender || 'm' }, text, t: now, reply: rq } }]);
    if (this.push) { const away = (await pool.query('select id, last_seen from citizens where id = any($1)', [others])).rows.filter(r => !isOnline(r.last_seen)).map(r => r.id);
      if (away.length) this.push.send(away, { kind: 'chat', title: `💬 ${g.name}`, body: `@${meP.handle}: ${text.length > 110 ? text.slice(0, 110) + '…' : text}`, tag: 'g-' + g.id, url: '/?chats=1' }).catch(() => {}); }
    return { ok: true, id: m.id, t: now, fee: cost.fee };
  }
  async gclear(me, gid) { const g = await this.group(gid); await this.setState(me, 'g:' + g.id, { cleared_at: Date.now(), pinned: false }); return { ok: true }; }
}
const msgOut = (m, me) => ({ id: m.id, mine: m.sender_id === me, text: m.text, t: Number(m.t), reply: m.reply_to ? { id: m.reply_to, text: m.reply_text, from: m.reply_from } : null });
