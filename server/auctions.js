// Land auctions, run by the developer: a prime patch of land goes up for bidding, and the highest bid when the time
// runs out wins it as the bidder's own plot.
//   - The developer marks the land (2×2 to 8×8 beside a road, like any plot), sets the opening bid and how long it runs.
//     While it's up for auction nobody can buy that land the ordinary way.
//   - A bid is paid in cash straight away and held by the auction. When someone bids higher, the last top bidder gets
//     every coin back at once, with a notice. So the winner can always pay, and nobody loses coins by being outbid.
//   - Each bid must beat the last by 5% (at least 100 coins). A bid in the last 2 minutes moves the end to 2 minutes
//     after it, so the land can't be snatched at the final second.
//   - When it ends the winning bid goes to the treasury and the land becomes the winner's plot, to build on like any other.
//     With no bids, nothing happens and the land is free again. The developer can call an auction off (the top bid is refunded).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';
import { ownedCount } from './economy.js';

const uid = () => crypto.randomBytes(8).toString('hex');
const fmt = n => Math.round(n).toLocaleString('en-US');
const left = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 120 ? `${Math.round(m / 60)} hours` : `${m} minute${m === 1 ? '' : 's'}`; };
const label = a => a.name ? `“${a.name}”` : `the ${a.w}×${a.d} plot`;
export const AUCTION_KEEP = 3600 * 1000; // finished auctions stay listed for an hour

// What every viewer sees of an auction (no ids of colonists, just handles).
export const aOut = a => ({ id: a.id, x: a.x, y: a.y, w: a.w, d: a.d, cx: a.cx, cy: a.cy, name: a.name || '', where: a.place || '', start: Number(a.start_price),
  top: Number(a.top_bid), leader: a.top_handle || null, bids: a.bids, endsAt: Number(a.ends_at), status: a.status, createdAt: Number(a.created_at) });

export class Auctions {
  constructor(world) { this.world = world; this.busy = false; }
  get housing() { return this.world.housing; }

  // The developer: put a patch of land up for auction.
  async start(body) {
    const r = this.housing.rect(body || {}), minutes = Math.floor(Number(body?.minutes)), name = String(body?.name || '').trim().slice(0, 30);
    if (!R.AUCTION_MINUTES.includes(minutes)) throw new HttpError(400, 'Pick how long the auction runs.');
    return this.world.change(async ch => {
      const q = (a, v) => ch.q(a, v), problem = await this.housing.landProblems(q, r); if (problem) throw new HttpError(409, problem);
      const quote = this.housing.price(r), start = body?.start == null || body.start === '' ? quote.total : Math.floor(Number(body.start));
      if (!(start >= 100 && start <= 1e9)) throw new HttpError(400, 'The opening bid must be 100 to 1,000,000,000 coins.');
      const [cx, cy] = R.chunkOf(r.x, r.y), now = Date.now();
      const a = (await ch.q(`insert into auctions (id, x, y, w, d, cx, cy, name, place, start_price, ends_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [uid(), r.x, r.y, r.w, r.d, cx, cy, name, quote.where || '', start, now + minutes * 60000, now])).rows[0];
      await ch.event(`🔨 Land auction! ${name ? `“${name}”, a` : 'A'} ${r.w}×${r.d} plot ${quote.where || ''} is up for bidding, from ${fmt(start)} coins. It closes in ${left(minutes * 60000)}. Tap it on the map to bid.`, 'auction');
      ch.extraOps.push({ op: 'auction', data: aOut(a) });
      return { ok: true, auction: aOut(a), quote };
    });
  }

  // A player bids. The coins come out of their cash now; the bidder they beat gets theirs back.
  async bid(playerId, auctionId, amount) {
    amount = Math.floor(Number(amount));
    return this.world.change(async ch => {
      const a = (await ch.q('select * from auctions where id = $1 for update', [String(auctionId)])).rows[0]; if (!a) throw new HttpError(404, 'No such auction.');
      const now = Date.now(); if (a.status !== 'open' || now >= Number(a.ends_at)) throw new HttpError(409, 'This auction has closed.');
      const c = await this.world.economy.lockMe(ch, playerId);
      if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. Auctions are for colonists who have woken up.");
      if (a.top_id === c.id) throw new HttpError(409, "You're already the top bidder.");
      const A = aOut(a), min = R.nextBid(A); if (!(amount >= min)) throw new HttpError(400, `The next bid must be at least ${fmt(min)} coins.`);
      if (amount > 1e10) throw new HttpError(400, 'That bid is too big.');
      const q = (s, v) => ch.q(s, v), max = R.propertyLimit(c.stars), leading = Number((await ch.q("select count(*) n from auctions where status = 'open' and top_id = $1", [c.id])).rows[0].n);
      if (await ownedCount(q, c.id) + leading >= max) throw new HttpError(409, `With ${c.stars || 0} star${c.stars === 1 ? '' : 's'} you can own up to ${max} properties${leading ? ', counting auctions you are leading' : ''}. Sell one first, or earn more stars.`);
      ch.coins(c); if (c.coins_base < amount) throw new HttpError(400, `Bids are paid in cash and held until someone outbids you. You have ${fmt(Math.max(0, c.coins_base))} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
      c.coins_base -= amount; ch.touch(c); await ch.saveCitizen(c); track(ch, 'auction:bid', amount, c.id);
      if (a.top_id) await this.refund(ch, a, `🔨 You've been outbid on ${label(a)} ${a.place || ''}: @${c.handle} bid ${fmt(amount)}. Your ${fmt(Number(a.top_bid))} coins are back in your cash. Bid again before it closes!`);
      const ends = Math.max(Number(a.ends_at), now + R.AUCTION_SNIPE);
      const b = (await ch.q('update auctions set top_bid = $2, top_id = $3, top_handle = $4, bids = bids + 1, ends_at = $5 where id = $1 returning *', [a.id, amount, c.id, c.handle, ends])).rows[0];
      await ch.q('insert into auction_bids (auction_id, t, citizen_id, handle, amount) values ($1, $2, $3, $4, $5)', [a.id, now, c.id, c.handle, amount]);
      ch.extraOps.push({ op: 'auction', data: aOut(b) });
      return { ok: true, auction: aOut(b), coins: c.coins_base, extended: ends > Number(a.ends_at) };
    });
  }
  // Give the top bidder their coins back (they were outbid, or the auction was called off).
  async refund(ch, a, text) {
    const p = (await ch.q('select * from citizens where id = $1 for update', [a.top_id])).rows[0]; if (!p) return;
    ch.coins(p); p.coins_base += Number(a.top_bid); ch.touch(p); await ch.saveCitizen(p); track(ch, 'auction:refund', Number(a.top_bid), p.id);
    await this.world.actions?.notify(ch, p.id, 'auction', text);
  }

  // The developer calls it off: the top bid goes back, and the land is free again.
  async cancel(auctionId) {
    return this.world.change(async ch => {
      const a = (await ch.q("select * from auctions where id = $1 and status = 'open' for update", [String(auctionId)])).rows[0]; if (!a) throw new HttpError(404, 'No open auction like that.');
      if (a.top_id) await this.refund(ch, a, `🔨 The auction for ${label(a)} was called off. Your ${fmt(Number(a.top_bid))} coins are back in your cash.`);
      const b = (await ch.q("update auctions set status = 'cancelled' where id = $1 returning *", [a.id])).rows[0];
      await ch.event(`🔨 The land auction for ${label(a)} ${a.place || ''} was called off.`, 'auction');
      ch.extraOps.push({ op: 'auction', data: aOut(b) });
      return { ok: true };
    });
  }

  // Every couple of seconds on the leader: close auctions whose time is up.
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try { for (const r of (await pool.query("select id from auctions where status = 'open' and ends_at <= $1 limit 20", [Date.now()])).rows) await this.close(r.id); }
    finally { this.busy = false; }
  }
  async close(id) {
    await this.world.change(async ch => {
      const a = (await ch.q("select * from auctions where id = $1 and status = 'open' and ends_at <= $2 for update", [id, Date.now()])).rows[0]; if (!a) return;
      const done = async (status, text, plotId = null) => { const b = (await ch.q('update auctions set status = $2, plot_id = $3 where id = $1 returning *', [a.id, status, plotId])).rows[0];
        if (text) await ch.event(text, 'auction'); ch.extraOps.push({ op: 'auction', data: aOut(b) }); };
      if (!a.top_id) return done('unsold', `🔨 Nobody bid on ${label(a)} ${a.place || ''}, so the land is free again.`);
      const r = { x: a.x, y: a.y, w: a.w, d: a.d }, problem = await this.housing.landProblems((s, v) => ch.q(s, v), r, a.id);
      const c = (await ch.q('select * from citizens where id = $1 for update', [a.top_id])).rows[0];
      if (problem || !c) { // something was built there meanwhile, or the winner left the colony: the bid goes back
        if (c) await this.refund(ch, a, `🔨 The auction for ${label(a)} couldn't go ahead (${problem || 'the land changed'}). Your ${fmt(Number(a.top_bid))} coins are back in your cash.`);
        return done('cancelled', `🔨 The land auction for ${label(a)} was called off.`); }
      // trees, bushes, rocks and street furniture on it are cleared away, as when land is bought
      for (const b of (await ch.q('select * from buildings where x < $1::int + $3::int and x + w > $1::int and y < $2::int + $4::int and y + d > $2::int for update', [r.x, r.y, r.w, r.d])).rows) await this.world.demolishIn(ch, b);
      const pid = uid(), price = Number(a.top_bid);
      // touching the winner's own land, it joins that estate (one property)
      const adj = await this.housing.ownAdjacent((s2, v) => ch.q(s2, v), c.id, r), estate = adj.length ? (adj[0].estate || adj[0].id) : null;
      await ch.q('insert into plots (id, owner_id, owner_handle, x, y, w, d, cx, cy, price, bought_at, name, estate) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [pid, c.id, c.handle, r.x, r.y, r.w, r.d, a.cx, a.cy, price, Date.now(), estate ? '' : (a.name || ''), estate]);
      ch.plots.add(pid);
      if (estate) { for (const k of new Set(adj.map(x => x.estate || x.id))) if (k !== estate) await ch.q('update plots set estate = $1 where coalesce(estate, id) = $2', [estate, k]);
        for (const row of (await ch.q('select id from plots where coalesce(estate, id) = $1', [estate])).rows) ch.plots.add(row.id); } treasuryAdd(ch, price); track(ch, 'land:auction', price, c.id);
      await this.world.actions?.notify(ch, c.id, 'auction', `🔨 You won the auction! ${label(a)[0].toUpperCase() + label(a).slice(1)} ${a.place || ''} is yours for ${fmt(price)} coins. Tap it on the map to build.`);
      await done('sold', `🔨 Sold! @${c.handle} won ${label(a)} ${a.place || ''} for ${fmt(price)} coins (${a.bids} bid${a.bids === 1 ? '' : 's'}).`, pid);
    });
  }

  // Open auctions, and those that ended in the last hour.
  async list() {
    const rows = (await pool.query("select * from auctions where status = 'open' or ends_at > $1 order by ends_at limit 50", [Date.now() - AUCTION_KEEP])).rows;
    return { now: Date.now(), auctions: rows.map(aOut) };
  }
  // One auction with its latest bids (and whether the caller is the top bidder).
  async info(playerId, auctionId) {
    const a = (await pool.query('select * from auctions where id = $1', [String(auctionId)])).rows[0]; if (!a) throw new HttpError(404, 'No such auction.');
    const bids = (await pool.query('select handle, amount, t from auction_bids where auction_id = $1 order by id desc limit 10', [a.id])).rows.map(b => ({ h: b.handle, amount: Number(b.amount), t: Number(b.t) }));
    return { now: Date.now(), auction: aOut(a), bids, next: R.nextBid(aOut(a)), mine: !!playerId && a.top_id === playerId };
  }
}
