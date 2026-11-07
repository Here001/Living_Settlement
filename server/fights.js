// Fight Night at the Colosseum.
// Every FIGHT_EVERY (3 real hours on the live colony) the first-built Colosseum puts on a Fight Night: three bouts, an
// opener, a co-main event and the main event, a few minutes apart. Players sign up to fight until the card is set
// (half an hour before the first bell); the best-rated sign-ups get the main event, and colonists from around town fill
// any empty corners. Everyone can bet on each bout until its bell (one bet per bout, at fixed odds). The server rolls
// each bout once at its bell and everyone watches the same fight; winners are paid when it ends, and both fighters
// get a purse from the treasury (the winner much more). Fighters keep a record and a rating from night to night.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { track } from './stats.js';
import { HttpError } from './world.js';
import { treasuryAdd } from './races.js';
import * as R from '../shared/rules.js';
import { pgList } from '../shared/catalog.js';
import { BOUTS, BOUT_LEN_S, fighterOf, fight, oddsFor, rate, hashStr, STYLES } from '../shared/fights.js';

export const FIGHT_EVERY = Math.max(10 * 60000, Number(process.env.FIGHT_EVERY_MS) || 3 * 3600 * 1000);
export const FIGHT_OFFSET = Math.floor(FIGHT_EVERY * 0.75) % FIGHT_EVERY; // 2¼ hours into each 3-hour stretch: clear of the races on the hour
export const CARD_LOCK = Math.min(30 * 60000, Math.floor(FIGHT_EVERY / 3)); // sign-ups close and the card is set this long before
export const BOUT_GAP = (BOUT_LEN_S + 70) * 1000; // one bell to the next
export const MAX_FIGHT_BET = 100000;
const fmt = n => Math.round(n).toLocaleString('en-US');
const secureRand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const pub = f => f && ({ id: f.id, handle: f.handle, name: f.name || '', gender: f.gender || 'm', style: f.style, nick: f.nick, wins: f.wins, losses: f.losses, kos: f.kos, rating: f.rating,
  power: Math.round(f.power * 100), speed: Math.round(f.speed * 100), chin: Math.round(f.chin * 100), player: !!f.player });

export class Fights {
  constructor(world) { this.world = world; this.busy = false; this.arenaAt = 0; this.arenaRow = null; }
  async arena() {
    if (Date.now() - this.arenaAt > 5000) { this.arenaAt = Date.now();
      this.arenaRow = (await pool.query(`select id, name, x, y from buildings where type = any('${pgList('colosseum')}') and done and not ruin order by built_at, id limit 1`)).rows[0] || null; }
    return this.arenaRow;
  }
  nextN(now = Date.now()) { return Math.floor((now - FIGHT_OFFSET) / FIGHT_EVERY) + 1; }
  startOf(n) { return n * FIGHT_EVERY + FIGHT_OFFSET; }
  label(n) { return Math.max(1, n - Math.floor(((this.world.meta?.epoch || 0) - FIGHT_OFFSET) / FIGHT_EVERY)); }
  boutStart(night, i) { return Number(night.start_at) + i * Number(night.gap || BOUT_GAP); }
  boutLen(night, r) { return night.fast ? Math.max(1000, Number(night.gap) - 1000) : (r?.len || BOUT_LEN_S) * 1000; }
  async night(n, db = pool) {
    await db.query('insert into fight_nights (n, start_at) values ($1, $2) on conflict (n) do nothing', [n, this.startOf(n)]);
    return (await db.query('select * from fight_nights where n = $1', [n])).rows[0];
  }
  // The night people should see: the one under way (until its last bout is settled), otherwise the next one.
  async current(now = Date.now()) {
    const live = (await pool.query('select * from fight_nights where start_at <= $1 and made and not done order by n limit 1', [now])).rows[0];
    if (live) return live;
    const soon = (await pool.query('select * from fight_nights where start_at > $1 order by start_at limit 1', [now])).rows[0];
    return soon || this.night(this.nextN(now));
  }
  async record(ids, db = pool) { return new Map((await db.query('select * from fighters where citizen_id = any($1)', [ids])).rows.map(r => [r.citizen_id, r])); }

  // Called by the leader on every clock tick: set the card, ring the bells, settle the bouts.
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try {
      const now = Date.now(), arena = await this.arena();
      for (const nt of (await pool.query('select * from fight_nights where made and not done and start_at <= $1 order by n', [now])).rows) {
        const bouts = (await pool.query('select * from fight_bouts where n = $1 order by i', [nt.n])).rows;
        for (const b of bouts) {
          if (!b.result && now >= Number(b.start_at)) await this.roll(nt, b);
          else if (b.result && !b.settled && now >= Number(b.start_at) + this.boutLen(nt, b.result)) await this.settle(nt, b);
        }
        if (bouts.length && bouts.every(b => b.settled)) await pool.query('update fight_nights set done = true where n = $1', [nt.n]);
      }
      if (!arena) return;
      const nt = await this.current(now);
      if (nt && !nt.made && now >= Number(nt.start_at) - CARD_LOCK) await this.makeCard(nt, arena);
    } finally { this.busy = false; }
  }

  // The card: sign-ups by rating (the best two get the main event), then colonists from around town for empty corners.
  async makeCard(nt, arena) {
    await this.world.change(async ch => {
      const row = (await ch.q('select * from fight_nights where n = $1 for update', [nt.n])).rows[0]; if (!row || row.made) return;
      const need = BOUTS.length * 2, ups = (await ch.q(`select s.citizen_id id from fight_signups s join citizens c on c.id = s.citizen_id
        where s.n = $1 and c.home_id is not null order by s.t limit 24`, [nt.n])).rows.map(r => r.id);
      let ids = [...ups];
      if (ids.length < need) {
        const fill = (await ch.q(`select id from citizens where home_id is not null and pass_hash is null and not (id = any($1)) order by md5(id || $2) limit $3`, [ids, String(nt.n), need - ids.length])).rows.map(r => r.id);
        ids.push(...fill);
      }
      if (ids.length < 2) return;
      const people = new Map((await ch.q('select id, handle, display_name, gender, pass_hash is not null player from citizens where id = any($1)', [ids])).rows.map(r => [r.id, r])), rec = await this.record(ids, { query: (a, v) => ch.q(a, v) });
      const all = ids.filter(id => people.has(id)).map(id => { const p = people.get(id); return { ...fighterOf(id, p.handle, rec.get(id) || {}), name: p.display_name || '', gender: p.gender || 'm', player: !!p.player, signed: ups.includes(id) }; });
      // sign-ups first (best rated first), then the rest by rating; pairs from the top make the main event
      all.sort((a, b) => (b.signed - a.signed) || (b.rating - a.rating)); const top = all.slice(0, need);
      const pairs = []; for (let k = 0; k + 1 < top.length; k += 2) pairs.push([top[k], top[k + 1]]);
      pairs.reverse(); // the last bout on the card is the main event
      const offset = BOUTS.length - pairs.length, gap = Number(row.gap || BOUT_GAP);
      for (let j = 0; j < pairs.length; j++) {
        const i = j + offset, [a, b] = pairs[j], start = Number(row.start_at) + i * gap, odds = oddsFor(a, b, hashStr(nt.n + ':' + i));
        const strip = f => { const { signed, ...rest } = f; return rest; };
        await ch.q('insert into fight_bouts (n, i, start_at, a, b, odds) values ($1, $2, $3, $4, $5, $6) on conflict do nothing', [nt.n, i, start, JSON.stringify(strip(a)), JSON.stringify(strip(b)), JSON.stringify(odds)]);
      }
      await ch.q('update fight_nights set made = true, arena_id = $2 where n = $1', [nt.n, arena.id]);
      const main = pairs[pairs.length - 1], mins = Math.max(1, Math.round((Number(row.start_at) - Date.now()) / 60000));
      await ch.event(`🥊 Fight Night #${this.label(nt.n)} at ${arena.name || 'the Colosseum'}: the first bell rings in ${mins} minute${mins === 1 ? '' : 's'}! Main event: @${main[0].handle} "${main[0].nick}" vs @${main[1].handle} "${main[1].nick}". Place your bets.`, 'fight');
      const players = top.filter(f => f.player);
      for (const f of players) { const p = pairs.find(x => x.includes(f)), i = pairs.indexOf(p) + offset, them = p[0] === f ? p[1] : p[0];
        ch.pushes.push([[f.id], { kind: 'fight', title: '🥊 You\'re on the Fight Night card!', body: `${BOUTS[i].name}: you vs @${them.handle}. First bell in ${mins} min. Win ${fmt(BOUTS[i].purse)} coins.`, tag: 'fight' }]); }
      ch.extraOps.push({ op: 'fight', data: { n: nt.n, stage: 'card' } });
    });
  }
  async roll(nt, b) {
    const res = fight(b.a, b.b, secureRand);
    await this.world.change(async ch => {
      const ok = (await ch.q('update fight_bouts set result = $3 where n = $1 and i = $2 and result is null returning i', [b.n, b.i, JSON.stringify(res)])).rowCount; if (!ok) return;
      if (b.i === BOUTS.length - 1) await ch.event(`🔔 The main event is on at the Colosseum: @${b.a.handle} vs @${b.b.handle}! Watch it live in Fight Night.`, 'fight');
      ch.extraOps.push({ op: 'fight', data: { n: b.n, i: b.i, stage: 'bell' } });
    });
  }
  // The bout is over: pay the bets on the winner, pay both fighters' purses, and update their records.
  async settle(nt, b) {
    await this.world.change(async ch => {
      const r = (await ch.q('update fight_bouts set settled = true where n = $1 and i = $2 and not settled and result is not null returning *', [b.n, b.i])).rows[0]; if (!r) return;
      const res = r.result, side = res.winner === 0 ? 'a' : 'b', W = res.winner === 0 ? r.a : r.b, L = res.winner === 0 ? r.b : r.a, card = BOUTS[r.i];
      const bets = (await ch.q('select * from fight_bets where n = $1 and i = $2', [r.n, r.i])).rows; let paid = 0, won = 0;
      for (const bt of bets) {
        if (bt.side !== side) { await ch.q('update fight_bets set payout = 0 where id = $1', [bt.id]); continue; }
        const payout = Math.floor(bt.amount * Number(bt.pays)), c = (await ch.q('select * from citizens where id = $1 for update', [bt.citizen_id])).rows[0];
        if (c) { ch.coins(c); c.coins_base += payout; ch.touch(c); await ch.saveCitizen(c); paid += payout; won++; track(ch, 'fight:win', payout, c.id);
          ch.pushes.push([[c.id], { kind: 'win', title: '🥊 Your fighter won!', body: `@${W.handle} won by ${res.method}. You won ${fmt(payout)} coins.`, tag: 'fight' }]); }
        await ch.q('update fight_bets set payout = $2 where id = $1', [bt.id, payout]);
      }
      // purses: the winner's and the loser's show money, from the treasury
      for (const [f, amt] of [[W, card.purse], [L, card.show]]) {
        const c = (await ch.q('select * from citizens where id = $1 for update', [f.id])).rows[0]; if (!c) continue;
        ch.coins(c); c.coins_base += amt; ch.touch(c); await ch.saveCitizen(c); paid += amt; track(ch, 'fight:purse', amt, c.id);
        if (c.pass_hash) ch.pushes.push([[c.id], { kind: 'fight', title: f === W ? '🏆 You won your fight!' : '🥊 You lost your fight', body: f === W ? `You beat @${L.handle} by ${res.method}. ${fmt(amt)} coins are yours.` : `@${W.handle} won by ${res.method}. You still get ${fmt(amt)} coins for stepping in the ring.`, tag: 'fight' }]);
      }
      treasuryAdd(ch, -paid);
      const rec = await this.record([W.id, L.id], { query: (a, v) => ch.q(a, v) }), rw = rec.get(W.id)?.rating || W.rating || 1000, rl = rec.get(L.id)?.rating || L.rating || 1000, [nw, nl] = rate(rw, rl, true);
      const up = async (f, win, rating) => ch.q(`insert into fighters (citizen_id, handle, wins, losses, kos, rating, purses) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (citizen_id) do update set handle = $2, wins = fighters.wins + $3, losses = fighters.losses + $4, kos = fighters.kos + $5, rating = $6, purses = fighters.purses + $7`,
        [f.id, f.handle, win ? 1 : 0, win ? 0 : 1, win && /KO/.test(res.method) ? 1 : 0, rating, win ? card.purse : card.show]);
      await up(W, true, nw); await up(L, false, nl);
      await ch.event(`🏆 ${card.name}: @${W.handle} beat @${L.handle} by ${res.method}${/KO/.test(res.method) ? ` in round ${res.round}` : ''}!` + (won ? ` ${won} colonist${won === 1 ? '' : 's'} won their bets.` : ''), 'fight');
      ch.extraOps.push({ op: 'fight', data: { n: r.n, i: r.i, stage: 'settled' } });
      await ch.q('delete from fight_bets where n < $1', [r.n - 200]); await ch.q('delete from fight_bouts where n < $1', [r.n - 200]); await ch.q('delete from fight_signups where n < $1', [r.n - 5]);
    });
  }

  // What the Fight Night tab shows.
  async info(playerId) {
    const now = Date.now(), arena = await this.arena(), nt = await this.current(now);
    const out = { now, every: FIGHT_EVERY, lock: CARD_LOCK, gap: BOUT_GAP, arena: arena && { id: arena.id, name: arena.name || 'Colosseum', x: arena.x, y: arena.y }, night: null, bouts: [], signups: [], mine: null, myBets: [], last: [], top: [] };
    if (nt) {
      out.night = { n: nt.n, no: this.label(nt.n), start: Number(nt.start_at), made: !!nt.made, open: !nt.made && now < Number(nt.start_at) - CARD_LOCK, closes: Number(nt.start_at) - CARD_LOCK, gap: Number(nt.gap || BOUT_GAP), fast: !!nt.fast };
      const bouts = (await pool.query('select * from fight_bouts where n = $1 order by i', [nt.n])).rows;
      out.bouts = bouts.map(b => ({ i: b.i, name: BOUTS[b.i].name, purse: BOUTS[b.i].purse, show: BOUTS[b.i].show, start: Number(b.start_at), a: pub(b.a), b: pub(b.b), odds: b.odds,
        result: now >= Number(b.start_at) ? b.result : null, settled: b.settled, len: this.boutLen(nt, b.result) }));
      if (!nt.made) {
        const s = (await pool.query(`select s.citizen_id id, c.handle, c.display_name, f.wins, f.losses, f.rating from fight_signups s join citizens c on c.id = s.citizen_id left join fighters f on f.citizen_id = s.citizen_id where s.n = $1 order by s.t`, [nt.n])).rows;
        out.signups = s.map(r => ({ handle: r.handle, name: r.display_name || '', wins: r.wins || 0, losses: r.losses || 0, rating: r.rating || 1000 }));
      }
      if (playerId) { out.mine = !!(await pool.query('select 1 from fight_signups where n = $1 and citizen_id = $2', [nt.n, playerId])).rowCount || bouts.some(b => b.a.id === playerId || b.b.id === playerId);
        out.myBets = (await pool.query('select n, i, side, amount, pays, payout from fight_bets where citizen_id = $1 and n >= $2 order by t desc', [playerId, nt.n - 1])).rows; }
    }
    const prev = (await pool.query('select * from fight_bouts where settled order by n desc, i desc limit 3')).rows;
    out.last = prev.map(b => ({ n: b.n, no: this.label(b.n), name: BOUTS[b.i].name, winner: (b.result.winner === 0 ? b.a : b.b).handle, loser: (b.result.winner === 0 ? b.b : b.a).handle, method: b.result.method, round: b.result.round }));
    out.top = (await pool.query('select handle, wins, losses, kos, rating from fighters order by rating desc, wins desc limit 8')).rows;
    if (playerId) { const me = (await pool.query('select f.*, c.handle h from citizens c left join fighters f on f.citizen_id = c.id where c.id = $1', [playerId])).rows[0];
      if (me) { const f = fighterOf(playerId, me.h, me.citizen_id ? me : {}); out.me = { style: f.style, styleName: STYLES[f.style].name, nick: f.nick, power: Math.round(f.power * 100), speed: Math.round(f.speed * 100), chin: Math.round(f.chin * 100), wins: f.wins, losses: f.losses, kos: f.kos, rating: f.rating }; } }
    return out;
  }
  async signup(playerId, on, blocked) {
    if (!(await this.arena())) throw new HttpError(409, "The colony doesn't have a Colosseum yet.");
    const nt = await this.current();
    if (nt.made || Date.now() >= Number(nt.start_at) - CARD_LOCK) throw new HttpError(409, "Tonight's card is already set. Sign up for the next Fight Night once this one is over.");
    const c = (await pool.query('select id, handle, home_id, pass_hash, jailed_until from citizens where id = $1', [playerId])).rows[0];
    if (!c?.pass_hash) throw new HttpError(403, 'Claim your colonist first.');
    if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. Fighters need a home in the colony.");
    if (on === false) { await pool.query('delete from fight_signups where n = $1 and citizen_id = $2', [nt.n, playerId]); return { ok: true, signed: false }; }
    if (blocked) { const why = await blocked(c); if (why) throw new HttpError(409, why); }
    await pool.query('insert into fight_signups (n, citizen_id, t) values ($1, $2, $3) on conflict do nothing', [nt.n, playerId, Date.now()]);
    return { ok: true, signed: true, n: nt.n, start: Number(nt.start_at) };
  }
  async bet(playerId, i, side, amount, blocked) {
    i = Math.floor(Number(i)); if (!BOUTS[i]) throw new HttpError(400, 'Pick a bout.'); if (side !== 'a' && side !== 'b') throw new HttpError(400, 'Pick a fighter.');
    amount = Math.floor(Number(amount)); if (!Number.isFinite(amount) || amount < 1) throw new HttpError(400, 'Bet at least 1 coin.');
    if (amount > MAX_FIGHT_BET) throw new HttpError(400, `The most you can bet on a bout is ${fmt(MAX_FIGHT_BET)} coins.`);
    const nt = await this.current(); if (!nt.made) throw new HttpError(409, 'The card isn’t set yet. Betting opens when the fighters are announced.');
    const b = (await pool.query('select * from fight_bouts where n = $1 and i = $2', [nt.n, i])).rows[0]; if (!b) throw new HttpError(404, 'No such bout tonight.');
    if (Date.now() >= Number(b.start_at) - 1000) throw new HttpError(409, 'The bell has rung. Bet on the next bout.');
    if (b.a.id === playerId || b.b.id === playerId) throw new HttpError(409, "You can't bet on your own fight. Win it instead!");
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [playerId])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.'); if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. Fight Night is for colonists who have woken up.");
      if (blocked) { const why = await blocked(c); if (why) throw new HttpError(409, why); }
      if ((await ch.q('select 1 from fight_bets where n = $1 and i = $2 and citizen_id = $3', [nt.n, i, c.id])).rowCount) throw new HttpError(409, "You've already bet on this bout.");
      ch.coins(c); if (c.coins_base < amount) throw new HttpError(400, c.coins_base ? `You only have ${fmt(c.coins_base)} coins on you.` : "You don't have any coins yet. Get a job first.");
      c.coins_base -= amount; ch.touch(c); await ch.saveCitizen(c); treasuryAdd(ch, amount); track(ch, 'fight:bet', amount, c.id);
      const pays = b.odds[side].pays;
      await ch.q('insert into fight_bets (id, n, i, citizen_id, handle, side, amount, pays, t) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [crypto.randomUUID(), nt.n, i, c.id, c.handle, side, amount, pays, Date.now()]);
      return { ok: true, n: nt.n, i, side, amount, pays, coins: c.coins_base, fighter: (side === 'a' ? b.a : b.b).handle };
    });
  }
  // For tests: the next Fight Night starts in `inMs`, with bells `gapMs` apart and each bout settled just before the next.
  async testSoon(inMs = 4000, gapMs = 4000) {
    const n = this.nextN(), start = Date.now() + Math.max(1000, Number(inMs) || 4000);
    await pool.query('delete from fight_bouts where n = $1', [n]); await pool.query('delete from fight_bets where n = $1', [n]);
    await pool.query(`insert into fight_nights (n, start_at, gap, fast) values ($1, $2, $3, true) on conflict (n) do update set start_at = $2, gap = $3, fast = true, made = false, done = false`, [n, start, Math.max(2000, Number(gapMs) || 4000)]);
    return { n, start };
  }
}
