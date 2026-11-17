// Relationships: ask someone out; if they say yes you're dating, and a love meter (0-100, shown as five hearts) fills
// with the time you spend together (in the same home or business) and the messages you send each other, a little each
// day. Leave each other alone for a few days and it slowly drops. Full hearts: either of you can propose, and if the
// other says yes you're married. Married couples can design and furnish each other's homes and businesses (rooms.js).
// Either of you can end it at any time. One relationship at a time.
import { pool } from './db.js';
import { HttpError } from './world.js';
import { LOVE } from '../shared/rules.js';

const pairOf = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const clean = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
export const hearts = p => Math.max(0, Math.min(5, Math.floor((Number(p) || 0) / (LOVE.MAX / 5))));

export class Love {
  constructor(world) { this.world = world; }
  async who(handle) { const c = (await pool.query('select id, handle, display_name, pass_hash is not null claimed from citizens where lower(handle) = lower($1)', [String(handle || '').replace(/^@/, '')])).rows[0]; if (!c) throw new HttpError(404, 'No colonist with that name.'); return c; }
  // the relationship a colonist is in right now (dating or married), if any
  async current(q, id) { return (await q("select * from relationships where (a_id = $1 or b_id = $1) and status in ('dating', 'married') limit 1", [id])).rows[0] || null; }
  async spouseOf(id, q = (a, v) => pool.query(a, v)) { const r = (await q("select a_id, b_id from relationships where (a_id = $1 or b_id = $1) and status = 'married' limit 1", [id])).rows[0]; return r ? (r.a_id === id ? r.b_id : r.a_id) : null; }
  // points fade after a few days apart (worked out when it's next looked at)
  decayed(r, now = Date.now()) {
    const idle = (now - Number(r.last_active || r.started || now)) / 86400000; if (idle <= LOVE.FADE_AFTER) return Number(r.points) || 0;
    const from = Math.max(Number(r.last_active || 0) + LOVE.FADE_AFTER * 86400000, Number(r.faded_at || 0)), days = Math.max(0, (now - from) / 86400000);
    return Math.max(0, (Number(r.points) || 0) - days * LOVE.FADE_PER_DAY);
  }
  out(r, meId) {
    const other = r.a_id === meId ? r.b : r.a, pts = this.decayed(r);
    return { status: r.status, with: other, points: Math.round(pts), max: LOVE.MAX, hearts: hearts(pts), ripe: r.status === 'dating' && pts >= LOVE.MAX,
      proposedBy: r.proposed_by ? (r.proposed_by === meId ? 'me' : 'them') : null, since: Number(r.started), married: r.married_at ? Number(r.married_at) : null,
      today: r.day_key === dayOf(Date.now()) ? { together: Math.round(Number(r.day_together) || 0), texts: Math.round(Number(r.day_texts) || 0) } : { together: 0, texts: 0 }, caps: { together: LOVE.TOGETHER_CAP, texts: LOVE.TEXT_CAP } };
  }
  async load(q, where, args) {
    return (await q(`select r.*, a.handle ah, b.handle bh from relationships r join citizens a on a.id = r.a_id join citizens b on b.id = r.b_id where ${where}`, args)).rows
      .map(r => ({ ...r, a: r.ah, b: r.bh }));
  }
  // my side: who I'm with, and who has asked me out
  async mine(meId) {
    const rows = await this.load((a, v) => pool.query(a, v), "(r.a_id = $1 or r.b_id = $1) and r.status in ('dating', 'married', 'asked')", [meId]);
    const cur = rows.find(r => r.status !== 'asked');
    return { current: cur ? this.out(cur, meId) : null,
      asks: rows.filter(r => r.status === 'asked' && r.asked_by !== meId).map(r => ({ from: r.asked_by === r.a_id ? r.a : r.b, message: r.message || '', t: Number(r.t) })),
      asked: rows.filter(r => r.status === 'asked' && r.asked_by === meId).map(r => (r.asked_by === r.a_id ? r.b : r.a)) };
  }
  // what I see on someone else's card
  async between(meId, handle) {
    const o = await this.who(handle); if (!meId || o.id === meId) return { self: o.id === meId };
    const r = (await this.load((a, v) => pool.query(a, v), 'r.pair = $1', [pairOf(meId, o.id)]))[0];
    const mineNow = await this.current((a, v) => pool.query(a, v), meId), theirs = await this.current((a, v) => pool.query(a, v), o.id);
    const base = { handle: o.handle, claimed: o.claimed, iTaken: !!mineNow && (!r || mineNow.pair !== r.pair), theyTaken: !!theirs && (!r || theirs.pair !== r.pair) };
    if (!r) return { ...base, status: 'none' };
    if (r.status === 'asked') return { ...base, status: r.asked_by === meId ? 'asked' : 'askedMe', message: r.message || '' };
    if (r.status === 'declined') return { ...base, status: Date.now() - Number(r.t) < LOVE.RETRY_MS && r.asked_by === meId ? 'declined' : 'none' };
    return { ...base, ...this.out(r, meId) };
  }
  async ask(me, handle, message) {
    const o = await this.who(handle); if (o.id === me.id) throw new HttpError(400, 'That’s you.');
    if (!o.claimed) throw new HttpError(409, `@${o.handle} hasn’t verified their avatar yet.`);
    const bs = await this.world.chat.blockState(me.id, o.id); if (bs.iBlocked || bs.blockedMe) throw new HttpError(403, bs.iBlocked ? `You’ve blocked @${o.handle}.` : `You can’t ask @${o.handle} out.`);
    return this.world.personal(async ch => {
      const q = (a, v) => ch.q(a, v), now = Date.now(), pair = pairOf(me.id, o.id);
      await q('select id from citizens where id = any($1) order by id for update', [[me.id, o.id]]); /* one change to these two at a time */
      if (await this.current(q, me.id)) throw new HttpError(409, 'You’re already with someone. You can only be in one relationship at a time.');
      if (await this.current(q, o.id)) throw new HttpError(409, `@${o.handle} is already with someone.`);
      const r = (await q('select * from relationships where pair = $1', [pair])).rows[0];
      if (r?.status === 'asked') throw new HttpError(409, r.asked_by === me.id ? `You’ve already asked @${o.handle}. Wait for an answer.` : `@${o.handle} has asked you out already: answer them on your card.`);
      if (r?.status === 'declined' && r.asked_by === me.id && now - Number(r.t) < LOVE.RETRY_MS) throw new HttpError(429, `@${o.handle} said no not long ago. Give it a while.`);
      const out = Number((await q("select count(*) n from relationships where asked_by = $1 and status = 'asked'", [me.id])).rows[0].n);
      if (out >= 1) throw new HttpError(409, 'You’re already waiting for someone’s answer. Wait for it first.');
      const [a, b] = me.id < o.id ? [me.id, o.id] : [o.id, me.id], msg = clean(message);
      await q(`insert into relationships (pair, a_id, b_id, status, asked_by, message, t, points, started) values ($1, $2, $3, 'asked', $4, $5, $6, 0, $6)
        on conflict (pair) do update set status = 'asked', asked_by = $4, message = $5, t = $6, points = 0, started = $6, married_at = null, proposed_by = null, last_active = null, faded_at = null, day_key = null, day_together = 0, day_texts = 0`, [pair, a, b, me.id, msg || null, now]);
      await this.world.actions?.notify(ch, o.id, 'love', `💘 @${me.handle} has asked you out${msg ? `: “${msg}”` : '!'} Answer on your card.`);
      return { ok: true, status: 'asked' };
    });
  }
  async answer(me, handle, accept) {
    const o = await this.who(handle);
    return this.world.personal(async ch => {
      const q = (a, v) => ch.q(a, v), now = Date.now(), pair = pairOf(me.id, o.id);
      await q('select id from citizens where id = any($1) order by id for update', [[me.id, o.id]]);
      const r = (await q('select * from relationships where pair = $1 for update', [pair])).rows[0];
      if (!r || r.status !== 'asked' || r.asked_by === me.id) throw new HttpError(404, 'There’s nothing to answer.');
      if (!accept) { await q("update relationships set status = 'declined', t = $2 where pair = $1", [pair, now]); await this.world.actions?.notify(ch, o.id, 'love', `💔 @${me.handle} said no this time.`); return { ok: true, status: 'declined' }; }
      if (await this.current(q, me.id)) throw new HttpError(409, 'You’re already with someone.');
      if (await this.current(q, o.id)) throw new HttpError(409, `@${o.handle} is with someone else now.`);
      await q("update relationships set status = 'dating', started = $2, t = $2, last_active = $2, points = $3 where pair = $1", [pair, now, LOVE.START]);
      // anyone else who asked either of them out: it's off now
      for (const x of (await q("delete from relationships where status = 'asked' and pair <> $1 and (a_id = any($2) or b_id = any($2)) returning asked_by, a_id, b_id", [pair, [me.id, o.id]])).rows) {
        const them = [x.a_id, x.b_id].find(i => i !== x.asked_by), h = them === me.id ? me.handle : o.handle;
        await this.world.actions?.notify(ch, x.asked_by, 'love', `💔 @${h} is seeing someone else now.`); }
      await this.world.actions?.notify(ch, o.id, 'love', `💞 @${me.handle} said yes! You’re dating now. Spend time together and talk to fill your hearts.`);
      return { ok: true, status: 'dating' };
    });
  }
  async propose(me) {
    return this.world.personal(async ch => {
      const q = (a, v) => ch.q(a, v), r = await this.current(q, me.id); if (!r || r.status !== 'dating') throw new HttpError(409, 'You need to be dating someone first.');
      if (this.decayed(r) < LOVE.MAX) throw new HttpError(409, 'Your hearts aren’t full yet. Spend more time together first.');
      if (r.proposed_by) throw new HttpError(409, r.proposed_by === me.id ? 'You’ve already proposed. Wait for their answer.' : 'They’ve already proposed to you: answer them on your card.');
      await q('update relationships set proposed_by = $2 where pair = $1', [r.pair, me.id]);
      const other = r.a_id === me.id ? r.b_id : r.a_id; await this.world.actions?.notify(ch, other, 'love', `💍 @${me.handle} has asked you to marry them! Answer on your card.`);
      return { ok: true };
    });
  }
  async answerProposal(me, accept) {
    return this.world.personal(async ch => {
      const q = (a, v) => ch.q(a, v), r = await this.current(q, me.id); if (!r || r.status !== 'dating' || !r.proposed_by || r.proposed_by === me.id) throw new HttpError(404, 'There’s no proposal to answer.');
      const other = r.proposed_by, now = Date.now();
      if (!accept) { await q('update relationships set proposed_by = null where pair = $1', [r.pair]); await this.world.actions?.notify(ch, other, 'love', `💍 @${me.handle} isn’t ready to get married yet.`); return { ok: true, status: 'dating' }; }
      await q("update relationships set status = 'married', married_at = $2, proposed_by = null, last_active = $2 where pair = $1", [r.pair, now]);
      await this.world.actions?.notify(ch, other, 'love', `💒 @${me.handle} said yes! You’re married. You can now design and furnish each other’s homes and businesses.`);
      const names = (await q('select handle from citizens where id = any($1)', [[r.a_id, r.b_id]])).rows.map(x => '@' + x.handle);
      await ch.event?.(`💒 ${names.join(' and ')} just got married!`, 'wedding');
      return { ok: true, status: 'married' };
    });
  }
  async end(me) {
    return this.world.personal(async ch => {
      const q = (a, v) => ch.q(a, v), r = await this.current(q, me.id); if (!r) throw new HttpError(404, 'You’re not with anyone.');
      await q('delete from relationships where pair = $1', [r.pair]);
      const other = r.a_id === me.id ? r.b_id : r.a_id;
      await this.world.actions?.notify(ch, other, 'love', r.status === 'married' ? `💔 @${me.handle} has ended your marriage.` : `💔 @${me.handle} has broken up with you.`);
      return { ok: true, ended: r.status };
    });
  }
  async cancelAsk(me, handle) { const o = await this.who(handle); await pool.query("delete from relationships where pair = $1 and status = 'asked' and asked_by = $2", [pairOf(me.id, o.id), me.id]); return { ok: true }; }
  // a little love: kind 'together' (a minute in the same place) or 'text' (a message to each other). Capped each day.
  async add(aId, bId, kind, amount) {
    if (!aId || !bId || aId === bId) return null; const now = Date.now(), key = dayOf(now), pair = pairOf(aId, bId);
    const r = (await pool.query("select * from relationships where pair = $1 and status in ('dating', 'married')", [pair])).rows[0]; if (!r) return null;
    const col = kind === 'text' ? 'day_texts' : 'day_together', cap = kind === 'text' ? LOVE.TEXT_CAP : LOVE.TOGETHER_CAP;
    const used = r.day_key === key ? Number(r[col]) || 0 : 0, give = Math.max(0, Math.min(amount, cap - used));
    const base = this.decayed(r, now), pts = Math.min(LOVE.MAX, base + give);
    await pool.query(`update relationships set points = $2, last_active = $3, faded_at = $3, day_key = $4,
        day_together = case when day_key = $4 then day_together else 0 end + $5, day_texts = case when day_key = $4 then day_texts else 0 end + $6 where pair = $1`,
      [pair, pts, now, key, kind === 'text' ? 0 : give, kind === 'text' ? give : 0]);
    return pts;
  }
  // every minute: couples who are in the same place right now (each server knows the people connected to it)
  async together(places) {
    const ids = [...new Set([...places.values()].flat())]; if (ids.length < 2) return 0;
    const rows = (await pool.query("select a_id, b_id from relationships where status in ('dating', 'married') and a_id = any($1) and b_id = any($1)", [ids])).rows; let n = 0;
    for (const r of rows) for (const list of places.values()) if (list.includes(r.a_id) && list.includes(r.b_id)) { await this.add(r.a_id, r.b_id, 'together', LOVE.PER_MINUTE); n++; break; }
    return n;
  }
}
