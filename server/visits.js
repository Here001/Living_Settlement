// Locked homes and visit requests. An owner can lock their home (see rooms.js lock); then nobody else can walk in, but
// anyone can ask: the owner is told, and can let them in for a while (15 minutes to a day) or say no. The visitor is
// told either way, and while their time lasts they can go in as if it were open. The owner can end a visit early.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';

export const VISIT_TIMES = [15, 60, 180, 1440]; // minutes an owner can let someone in for
const MAX_PENDING = 5;                          // requests one visitor can have waiting at once
const RETRY_AFTER = 10 * 60 * 1000;             // after a "no", how long before asking the same home again
const clean = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
const span = m => (m >= 1440 ? 'a day' : m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

export class Visits {
  constructor(world) { this.world = world; }
  async owner(handle) { const c = (await pool.query('select id, handle, room from citizens where lower(handle) = lower($1)', [String(handle || '')])).rows[0]; if (!c) throw new HttpError(404, 'No colonist with that name.'); return c; }
  // may this visitor walk into this owner's locked home right now?
  async allowed(ownerId, visitorId) {
    if (!visitorId) return false;
    return !!(await pool.query("select 1 from visit_requests where owner_id = $1 and visitor_id = $2 and status = 'accepted' and until > $3 limit 1", [ownerId, visitorId, Date.now()])).rows[0];
  }
  // what a visitor sees on someone's card: is it locked, and how their request stands
  async state(meId, handle) {
    const o = await this.owner(handle), locked = !!(o.room && o.room.locked); if (!meId || meId === o.id) return { locked, mine: meId === o.id };
    const r = (await pool.query('select id, status, until, t from visit_requests where owner_id = $1 and visitor_id = $2 order by t desc limit 1', [o.id, meId])).rows[0];
    const now = Date.now(); let status = 'none', until = 0;
    if (r) { if (r.status === 'pending') status = 'pending'; else if (r.status === 'accepted' && Number(r.until) > now) { status = 'accepted'; until = Number(r.until); } else if (r.status === 'declined' && now - Number(r.t) < RETRY_AFTER) status = 'declined'; }
    return { locked, status, until };
  }
  async request(meId, meHandle, handle, message) {
    const o = await this.owner(handle); if (o.id === meId) throw new HttpError(400, 'That’s your own home.');
    if (!(o.room && o.room.locked)) throw new HttpError(409, `@${o.handle}’s home is open: just go in.`);
    return this.world.personal(async ch => {
      const now = Date.now(), last = (await ch.q('select status, until, t from visit_requests where owner_id = $1 and visitor_id = $2 order by t desc limit 1 for update', [o.id, meId])).rows[0];
      if (last?.status === 'pending') throw new HttpError(409, `You’ve already asked @${o.handle}. Wait for an answer.`);
      if (last?.status === 'accepted' && Number(last.until) > now) throw new HttpError(409, `You can already visit @${o.handle}’s home.`);
      if (last?.status === 'declined' && now - Number(last.t) < RETRY_AFTER) throw new HttpError(429, `@${o.handle} said no just now. Try again a little later.`);
      const waiting = Number((await ch.q("select count(*) n from visit_requests where visitor_id = $1 and status = 'pending'", [meId])).rows[0].n);
      if (waiting >= MAX_PENDING) throw new HttpError(429, `You have ${MAX_PENDING} requests waiting already. Wait for some answers first.`);
      const id = crypto.randomUUID(), msg = clean(message);
      await ch.q("insert into visit_requests (id, owner_id, visitor_id, status, message, t) values ($1, $2, $3, 'pending', $4, $5)", [id, o.id, meId, msg || null, now]);
      await this.world.actions?.notify(ch, o.id, 'visit', `🚪 @${meHandle} would like to visit your home${msg ? `: “${msg}”` : '.'} Open your card to answer.`);
      return { ok: true, status: 'pending' };
    });
  }
  // the owner's list: requests waiting for an answer, and visits going on now
  async incoming(ownerId) {
    const now = Date.now(), rows = (await pool.query(`select v.id, v.status, v.message, v.t, v.until, c.handle, c.display_name from visit_requests v join citizens c on c.id = v.visitor_id
      where v.owner_id = $1 and (v.status = 'pending' or (v.status = 'accepted' and v.until > $2)) order by v.t desc limit 30`, [ownerId, now])).rows;
    return { requests: rows.map(r => ({ id: r.id, status: r.status, message: r.message || '', t: Number(r.t), until: Number(r.until || 0), handle: r.handle, name: r.display_name || '' })), times: VISIT_TIMES };
  }
  // accept (for a number of minutes), decline, or end a visit early
  async answer(ownerId, ownerHandle, id, b = {}) {
    return this.world.personal(async ch => {
      const r = (await ch.q('select v.*, c.handle from visit_requests v join citizens c on c.id = v.visitor_id where v.id = $1 and v.owner_id = $2 for update of v', [String(id), ownerId])).rows[0];
      if (!r) throw new HttpError(404, 'That request has gone.'); const now = Date.now();
      if (b.end) { if (r.status !== 'accepted') throw new HttpError(409, 'That visit isn’t going on.'); await ch.q("update visit_requests set status = 'ended', until = $2 where id = $1", [r.id, now]);
        await this.world.actions?.notify(ch, r.visitor_id, 'visit', `🔒 @${ownerHandle} has ended your visit.`); return { ok: true, status: 'ended' }; }
      if (r.status !== 'pending') throw new HttpError(409, 'You’ve already answered that one.');
      if (!b.accept) { await ch.q("update visit_requests set status = 'declined', t = $2 where id = $1", [r.id, now]);
        await this.world.actions?.notify(ch, r.visitor_id, 'visit', `🚪 @${ownerHandle} can’t have visitors right now.`); return { ok: true, status: 'declined' }; }
      const m = Number(b.minutes); if (!VISIT_TIMES.includes(m)) throw new HttpError(400, 'For how long?');
      const until = now + m * 60000; await ch.q("update visit_requests set status = 'accepted', until = $2 where id = $1", [r.id, until]);
      await this.world.actions?.notify(ch, r.visitor_id, 'visit', `🏠 @${ownerHandle} says come in! You can visit their home for the next ${span(m)}.`);
      return { ok: true, status: 'accepted', until };
    });
  }
}
