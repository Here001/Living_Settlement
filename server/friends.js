// Best friends: ask someone to be your best friend; if they say yes, you are, until either of you ends it. Best friends
// (and married couples, server/love.js) can borrow each other's cars and bikes: they show in your 🚗 Car app under
// "Cars you can borrow". A few best friends each at most.
import { pool } from './db.js';
import { HttpError } from './world.js';
import { ridden, CAR_MODELS } from '../shared/catalog.js';

export const MAX_BEST = 5;
const pairOf = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

export class Friends {
  constructor(world) { this.world = world; }
  async who(handle) { const c = (await pool.query('select id, handle from citizens where lower(handle) = lower($1)', [String(handle || '').replace(/^@/, '')])).rows[0]; if (!c) throw new HttpError(404, 'No such colonist.'); return c; }
  // my best friends, the people who've asked me, and the ones I've asked
  async mine(meId) {
    const rows = (await pool.query(`select f.*, a.handle ah, b.handle bh from best_friends f join citizens a on a.id = f.a_id join citizens b on b.id = f.b_id where f.a_id = $1 or f.b_id = $1 order by f.t`, [meId])).rows;
    const other = r => r.a_id === meId ? { id: r.b_id, h: r.bh } : { id: r.a_id, h: r.ah };
    return { max: MAX_BEST, friends: rows.filter(r => r.status === 'friends').map(r => ({ ...other(r), since: Number(r.t) })),
      asks: rows.filter(r => r.status === 'asked' && r.asked_by !== meId).map(r => other(r)), asked: rows.filter(r => r.status === 'asked' && r.asked_by === meId).map(r => other(r)) };
  }
  // the people whose cars I can drive: my husband or wife, and my best friends
  async lenders(meId) {
    const ids = (await pool.query("select case when a_id = $1 then b_id else a_id end id from best_friends where (a_id = $1 or b_id = $1) and status = 'friends'", [meId])).rows.map(r => r.id);
    const sp = await this.world.love?.spouseOf(meId); if (sp && !ids.includes(sp)) ids.unshift(sp); return { ids, spouse: sp || null };
  }
  // the cars and bikes I can borrow, by whose they are
  async borrowable(meId) {
    const { ids, spouse } = await this.lenders(meId); if (!ids.length) return { lenders: [] };
    const rows = (await pool.query('select id, handle, cars from citizens where id = any($1)', [ids])).rows;
    return { lenders: ids.map(id => rows.find(r => r.id === id)).filter(Boolean).map(r => ({ id: r.id, h: r.handle, spouse: r.id === spouse,
      cars: (Array.isArray(r.cars) ? r.cars : []).filter(x => CAR_MODELS[x.m] && ridden(x.m)).map(x => ({ id: x.id, m: x.m, col: x.col })) })) };
  }
  // can I drive this one? (the car must really be theirs, and they must be my spouse or best friend)
  async canBorrow(meId, ownerHandle, carId) {
    const o = await this.who(ownerHandle), { ids } = await this.lenders(meId); if (!ids.includes(o.id)) throw new HttpError(403, `You can only borrow a car from your husband or wife or a best friend.`);
    const r = (await pool.query('select cars from citizens where id = $1', [o.id])).rows[0], car = (Array.isArray(r?.cars) ? r.cars : []).find(x => x.id === carId);
    if (!car) throw new HttpError(404, `That isn't one of @${o.handle}'s cars.`); if (!ridden(car.m)) throw new HttpError(409, 'Only cars and bikes can be borrowed.');
    return { ok: true, owner: o.handle, car: { id: car.id, m: car.m, col: car.col } };
  }
  async act(me, { action, handle, yes }) {
    const o = await this.who(handle); if (o.id === me.id) throw new HttpError(400, "You can't be your own best friend.");
    const pair = pairOf(me.id, o.id), now = Date.now(), notify = (id, text) => this.world.change(async ch => { await this.world.actions?.notify(ch, id, 'love', text); }).catch(() => {});
    const row = (await pool.query('select * from best_friends where pair = $1', [pair])).rows[0];
    const count = async id => Number((await pool.query("select count(*) n from best_friends where (a_id = $1 or b_id = $1) and status = 'friends'", [id])).rows[0].n);
    if (action === 'ask') {
      if (row?.status === 'friends') throw new HttpError(409, `You and @${o.handle} are already best friends.`);
      if (row?.status === 'asked' && row.asked_by === o.id) return this.act(me, { action: 'answer', handle, yes: true }); /* they asked you first: that's a yes */
      if (row?.status === 'asked') throw new HttpError(409, `You've already asked @${o.handle}. Wait for them to answer.`);
      if (await count(me.id) >= MAX_BEST) throw new HttpError(409, `You have ${MAX_BEST} best friends already. End one to make room.`);
      const [a, b] = me.id < o.id ? [me.id, o.id] : [o.id, me.id];
      await pool.query('insert into best_friends (pair, a_id, b_id, status, asked_by, t) values ($1, $2, $3, $4, $5, $6)', [pair, a, b, 'asked', me.id, now]);
      await notify(o.id, `🤝 @${me.handle} wants to be your best friend. Open their card to say yes. Best friends can borrow each other's cars.`);
      return { ok: true, status: 'asked' };
    }
    if (action === 'answer') {
      if (!row || row.status !== 'asked' || row.asked_by !== o.id) throw new HttpError(409, `@${o.handle} hasn't asked you.`);
      if (!yes) { await pool.query('delete from best_friends where pair = $1', [pair]); return { ok: true, status: 'none' }; }
      if (await count(me.id) >= MAX_BEST || await count(o.id) >= MAX_BEST) throw new HttpError(409, `One of you already has ${MAX_BEST} best friends.`);
      await pool.query("update best_friends set status = 'friends', t = $2 where pair = $1", [pair, now]);
      await notify(o.id, `🤝 @${me.handle} said yes! You're best friends now, and can borrow each other's cars.`);
      return { ok: true, status: 'friends' };
    }
    if (action === 'end') { if (!row) throw new HttpError(409, `You and @${o.handle} aren't best friends.`); await pool.query('delete from best_friends where pair = $1', [pair]); return { ok: true, status: 'none' }; }
    throw new HttpError(400, 'Ask, answer or end.');
  }
  // with one person: friends, asked (by me or them), or nothing
  async with(meId, handle) { const o = await this.who(handle), r = (await pool.query('select * from best_friends where pair = $1', [pairOf(meId, o.id)])).rows[0];
    return { status: !r ? 'none' : r.status === 'friends' ? 'friends' : r.asked_by === meId ? 'asked' : 'asks' }; }
}
