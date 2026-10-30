// The colony lottery, run by the developer: tickets go into the pot, one ticket wins it all (plus any bonus).
// The Colony Log announces the draw 2½ minutes before it happens.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { treasuryAdd } from './races.js';

export const LOTTERY_ANNOUNCE = 150 * 1000, MAX_TICKETS = 10;
const fmt = n => Math.round(n).toLocaleString('en-US');
const clock = t => new Date(t).toISOString().slice(11, 16) + ' UTC';

export class Lottery {
  constructor(world) { this.world = world; this.busy = false; }
  async current(db = pool) { return (await db.query('select * from lotteries where not drawn order by id desc limit 1')).rows[0] || null; }
  async start({ minutes, price, bonus }) {
    minutes = Math.floor(Number(minutes)); price = Math.floor(Number(price)); bonus = Math.floor(Number(bonus || 0));
    if (!(minutes >= 5 && minutes <= 1440)) throw new HttpError(400, 'The draw must be 5 minutes to 24 hours away.');
    if (!(price >= 1 && price <= 1000)) throw new HttpError(400, 'Tickets cost 1 to 1,000 coins.');
    if (!(bonus >= 0 && bonus <= 1000000)) throw new HttpError(400, 'The bonus must be 0 to 1,000,000 coins.');
    return this.world.change(async ch => {
      if (await this.current(ch.db)) throw new HttpError(409, 'A lottery is already running. Wait for its draw.');
      if (bonus > R.treasuryOn(ch.meta, ch.today)) throw new HttpError(400, `The treasury only has ${fmt(R.treasuryOn(ch.meta, ch.today))} coins.`);
      treasuryAdd(ch, -bonus); // set aside now; returned if nobody buys a ticket
      const drawAt = Date.now() + minutes * 60000;
      const l = (await ch.q('insert into lotteries (draw_at, price, bonus, created_at) values ($1, $2, $3, $4) returning *', [drawAt, price, bonus, Date.now()])).rows[0];
      await ch.event(`🎟️ The lottery is open! Tickets are ${fmt(price)} coin${price === 1 ? '' : 's'} each (up to ${MAX_TICKETS} per colonist).${bonus ? ` ${fmt(bonus)} bonus coins on top.` : ''} The draw is in ${minutes >= 120 ? Math.round(minutes / 60) + ' hours' : minutes + ' minutes'}.`, 'lottery');
      ch.extraOps.push({ op: 'lottery', data: { id: l.id, stage: 'open' } });
      return { ok: true, id: l.id, drawAt };
    });
  }
  async buy(playerId, count, blocked) {
    count = Math.floor(Number(count)); if (!(count >= 1 && count <= MAX_TICKETS)) throw new HttpError(400, `Buy 1 to ${MAX_TICKETS} tickets.`);
    return this.world.change(async ch => {
      const l = await this.current(ch.db); if (!l) throw new HttpError(409, "There's no lottery running right now.");
      if (Date.now() >= Number(l.draw_at) - 1000) throw new HttpError(409, 'The draw is happening. Too late for tickets.');
      const c = (await ch.q('select * from citizens where id = $1 for update', [playerId])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
      if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. The lottery is for colonists who have woken up.");
      if (blocked) { const why = await blocked(c); if (why) throw new HttpError(409, why); }
      const have = Number((await ch.q('select count from lottery_tickets where lottery_id = $1 and citizen_id = $2', [l.id, c.id])).rows[0]?.count || 0);
      if (have + count > MAX_TICKETS) throw new HttpError(400, have ? `You have ${have} ticket${have === 1 ? '' : 's'}. The most anyone can hold is ${MAX_TICKETS}.` : `The most anyone can hold is ${MAX_TICKETS}.`);
      const cost = count * l.price; ch.coins(c); if (c.coins_base < cost) throw new HttpError(400, `${count} ticket${count === 1 ? '' : 's'} cost${count === 1 ? 's' : ''} ${fmt(cost)} coins. You have ${fmt(c.coins_base)}.`);
      c.coins_base -= cost; ch.touch(c); await ch.saveCitizen(c);
      await ch.q(`insert into lottery_tickets (lottery_id, citizen_id, handle, count) values ($1, $2, $3, $4)
        on conflict (lottery_id, citizen_id) do update set count = lottery_tickets.count + $4`, [l.id, c.id, c.handle, count]);
      ch.extraOps.push({ op: 'lottery', data: { id: l.id, stage: 'tickets' } });
      return { ok: true, tickets: have + count, coins: c.coins_base };
    });
  }
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try {
      const l = await this.current(); if (!l) return; const now = Date.now(), at = Number(l.draw_at);
      if (!l.announced && now >= at - LOTTERY_ANNOUNCE) await this.world.change(async ch => {
        if (!(await ch.q('update lotteries set announced = true where id = $1 and not announced returning id', [l.id])).rowCount) return;
        const pot = await this.pot(ch.db, l), mins = Math.max(1, Math.floor((at - Date.now()) / 60000));
        await ch.event(`🎟️ The lottery draw is in ${mins} minute${mins === 1 ? '' : 's'}! The prize is ${fmt(pot)} coins. Last chance to buy tickets.`, 'lottery');
        ch.extraOps.push({ op: 'lottery', data: { id: l.id, stage: 'announced' } });
      });
      if (now >= at) await this.draw(l.id);
    } finally { this.busy = false; }
  }
  async pot(db, l) { const t = Number((await db.query('select coalesce(sum(count), 0) n from lottery_tickets where lottery_id = $1', [l.id])).rows[0].n); return t * l.price + l.bonus; }
  async draw(id) {
    await this.world.change(async ch => {
      const l = (await ch.q('update lotteries set drawn = true where id = $1 and not drawn returning *', [id])).rows[0]; if (!l) return;
      const tickets = (await ch.q('select * from lottery_tickets where lottery_id = $1 order by citizen_id', [id])).rows;
      const total = tickets.reduce((s, t) => s + t.count, 0), prize = total * l.price + l.bonus;
      if (!total) { treasuryAdd(ch, l.bonus); await ch.event('🎟️ Nobody bought a lottery ticket, so there was no draw.', 'lottery'); ch.extraOps.push({ op: 'lottery', data: { id, stage: 'drawn' } }); return; }
      let pick = crypto.randomInt(total), win = tickets[0]; for (const t of tickets) { if ((pick -= t.count) < 0) { win = t; break; } }
      const c = (await ch.q('select * from citizens where id = $1 for update', [win.citizen_id])).rows[0];
      if (c) { ch.coins(c); c.coins_base += prize; ch.touch(c); await ch.saveCitizen(c); ch.pushes.push([[c.id], { kind: 'win', title: '🎉 You won the lottery!', body: `${fmt(prize)} coins are yours.`, tag: 'lottery', urgency: 'high' }]); } else treasuryAdd(ch, prize);
      await ch.q('update lotteries set winner = $2, prize = $3 where id = $1', [id, win.handle, prize]);
      await ch.event(`🎉 @${win.handle} won the lottery: ${fmt(prize)} coins! (${tickets.length} colonist${tickets.length === 1 ? '' : 's'} bought ${fmt(total)} ticket${total === 1 ? '' : 's'}.)`, 'lottery');
      ch.extraOps.push({ op: 'lottery', data: { id, stage: 'drawn' } });
    });
  }
  // The open lottery (or the last one, for an hour after its draw), with the caller's tickets.
  async info(playerId) {
    let l = await this.current();
    if (!l) l = (await pool.query('select * from lotteries where drawn and draw_at > $1 order by id desc limit 1', [Date.now() - 3600000])).rows[0] || null;
    if (!l) return { lottery: null, max: MAX_TICKETS, announce: LOTTERY_ANNOUNCE, now: Date.now() };
    const agg = (await pool.query('select coalesce(sum(count), 0) t, count(*) p from lottery_tickets where lottery_id = $1', [l.id])).rows[0];
    const mine = playerId ? Number((await pool.query('select count from lottery_tickets where lottery_id = $1 and citizen_id = $2', [l.id, playerId])).rows[0]?.count || 0) : 0;
    return { now: Date.now(), max: MAX_TICKETS, announce: LOTTERY_ANNOUNCE, lottery: { id: l.id, drawAt: Number(l.draw_at), price: l.price, bonus: l.bonus, tickets: Number(agg.t), players: Number(agg.p),
      pot: Number(agg.t) * l.price + l.bonus, drawn: l.drawn, winner: l.winner, prize: l.prize, mine } };
  }
}
