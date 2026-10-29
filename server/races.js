// Creature races at the Racetrack.
// A race runs every 30 real minutes (on the hour and half hour) while the colony has a finished Racetrack.
// Bets are open until the gates close at the start. The Colony Log announces each race 2½ minutes before it starts.
// The server rolls the result the moment the race starts, every viewer watches the same ~45 s race, and winners are
// paid when it ends. Odds come from each creature's form and the weather at race time, and are fixed once shown.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { CREATURES, CREATURE_IDS, oddsFor, runRace } from '../shared/creatures.js';

// RACE_EVERY_MS can shorten the cycle for testing on a local server; the live colony uses 30 minutes.
export const RACE_EVERY = Math.max(60000, Number(process.env.RACE_EVERY_MS) || 30 * 60 * 1000), RACE_LEN = 45 * 1000, RACE_ANNOUNCE = Math.min(150 * 1000, RACE_EVERY / 2);
export const MAX_RACE_BET = 100000;
const fmt = n => Math.round(n).toLocaleString('en-US');
const raceOut = (r, label) => r && ({ n: r.n, no: label(r.n), start: Number(r.start_at), weather: r.weather, odds: r.odds, cup: r.cup || null,
  result: Date.now() >= Number(r.start_at) ? r.result : null, settled: r.settled });
const secureRand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
export const treasuryAdd = (ch, delta) => { ch.meta.treasuryBase = Math.max(0, R.treasuryOn(ch.meta, ch.today) + delta); ch.meta.treasuryDay = ch.today; };

export class Races {
  constructor(world) { this.world = world; this.trackAt = 0; this.track = null; this.busy = false; }
  // Races are numbered from the colony's founding (#1, #2, …) for people; n is the clock-based id underneath.
  label(n) { return Math.max(1, n - Math.floor((this.world.meta?.epoch || 0) / RACE_EVERY)); }
  nextN(now = Date.now()) { return Math.floor(now / RACE_EVERY) + 1; }
  startOf(n) { return n * RACE_EVERY; }
  async hasTrack() {
    // While there is no Racetrack, look again every few seconds so a new one is noticed quickly.
    if (Date.now() - this.trackAt > (this.track ? 20000 : 3000)) { this.trackAt = Date.now(); this.track = (await pool.query("select id, name from buildings where type = 'racetrack' and done and not ruin order by built_at limit 1")).rows[0] || null; }
    return this.track;
  }
  // The race row for number n, created on first need with the weather forecast for its start time.
  async ensure(n, db = pool) {
    const meta = this.world.meta; if (!meta) return null;
    const start = this.startOf(n), weather = R.weatherAt(meta, (start - meta.epoch) / R.GAME_MIN_MS) || 'sunny';
    await db.query('insert into races (n, start_at, weather, odds) values ($1, $2, $3, $4) on conflict (n) do nothing', [n, start, weather, JSON.stringify(oddsFor(CREATURE_IDS, weather, n))]);
    return (await db.query('select * from races where n = $1', [n])).rows[0];
  }

  // Called by the leader on every clock tick: announce, start and settle races. Never runs twice at once.
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try {
      const now = Date.now();
      // Finish anything already under way (even if the Racetrack was knocked down meanwhile).
      for (const r of (await pool.query('select * from races where not settled and start_at <= $1 order by n', [now])).rows) {
        if (!r.result) await this.roll(r);
        if (now >= Number(r.start_at) + RACE_LEN) await this.settle(r.n);
      }
      if (!(await this.hasTrack())) return;
      const n = this.nextN(now), r = await this.ensure(n);
      if (r && !r.announced && now >= Number(r.start_at) - RACE_ANNOUNCE) await this.announce(r);
    } finally { this.busy = false; }
  }
  async announce(r) {
    await this.world.change(async ch => {
      const ok = (await ch.q('update races set announced = true where n = $1 and not announced returning n', [r.n])).rowCount; if (!ok) return;
      const fav = CREATURE_IDS.slice().sort((a, b) => r.odds[b].chance - r.odds[a].chance)[0];
      const mins = Math.max(1, Math.floor((Number(r.start_at) - Date.now()) / 60000));
      await ch.event(`🏁 ${r.cup ? r.cup.name + ': ' : ''}Race #${this.label(r.n)} starts at the Racetrack in ${mins} minute${mins === 1 ? '' : 's'}! ${r.weather[0].toUpperCase() + r.weather.slice(1)} track. Favourite: ${CREATURES[fav].name} (pays ${r.odds[fav].pays}×).${r.cup ? ` Bonus prize: ${fmt(r.cup.bonus)} coins.` : ''} Place your bets.`, 'race');
      ch.extraOps.push({ op: 'race', data: { n: r.n, stage: 'announced' } });
    });
  }
  // The gates open: decide the finishing order once, with finish times for the animation everyone watches.
  async roll(r) {
    const order = runRace(CREATURE_IDS, r.weather, secureRand), best = order[0].p;
    const times = {}; order.forEach((o, i) => { times[o.id] = Math.min(RACE_LEN / 1000 - 1, 36 + (best - o.p) * 45 + i * 0.35); });
    const result = { order: order.map(o => o.id), times };
    await this.world.change(async ch => {
      const ok = (await ch.q('update races set result = $2 where n = $1 and result is null returning n', [r.n, JSON.stringify(result)])).rowCount;
      if (ok) ch.extraOps.push({ op: 'race', data: { n: r.n, stage: 'started' } });
    });
  }
  // The race is over: pay the winners (and share any Cup bonus between them), then tell the colony.
  async settle(n) {
    await this.world.change(async ch => {
      const r = (await ch.q('update races set settled = true where n = $1 and not settled and result is not null returning *', [n])).rows[0]; if (!r) return;
      const win = r.result.order[0], bets = (await ch.q('select * from race_bets where n = $1', [n])).rows;
      const winners = bets.filter(b => b.creature === win), stake = winners.reduce((s, b) => s + b.amount, 0);
      const bonus = r.cup?.bonus || 0; let paid = 0, fromBonus = 0;
      for (const b of winners) {
        const share = bonus && stake ? Math.floor(bonus * b.amount / stake) : 0; fromBonus += share;
        const payout = Math.floor(b.amount * b.pays) + share;
        const c = (await ch.q('select * from citizens where id = $1 for update', [b.citizen_id])).rows[0];
        if (c) { ch.coins(c); c.coins_base += payout; ch.touch(c); await ch.saveCitizen(c); paid += payout; }
        await ch.q('update race_bets set payout = $2 where id = $1', [b.id, payout]);
      }
      await ch.q('update race_bets set payout = 0 where n = $1 and payout is null', [n]);
      // Stakes went into the treasury when placed and winnings come out of it. The Cup bonus was set aside when the Cup
      // was announced, so only the part of it nobody won (all of it if nobody backed the winner) goes back.
      treasuryAdd(ch, -(paid - fromBonus) + (bonus - fromBonus));
      const second = CREATURES[r.result.order[1]].name;
      await ch.event(`🏆 ${CREATURES[win].name} won ${r.cup ? r.cup.name + ' (' : ''}Race #${this.label(n)}${r.cup ? ')' : ''}, ahead of ${second}! ` +
        (winners.length ? `${winners.length} colonist${winners.length === 1 ? '' : 's'} won ${fmt(paid)} coins.` : bets.length ? 'Nobody backed the winner.' : ''), 'race');
      ch.extraOps.push({ op: 'race', data: { n, stage: 'settled' } });
      await ch.q('delete from races where n < $1', [n - 500]); await ch.q('delete from race_bets where n < $1', [n - 500]);
    });
  }

  // What the Races tab shows: the next race (odds, weather, any Cup), the latest one (live or finished), form, my bet.
  async info(playerId) {
    const now = Date.now(), track = await this.hasTrack();
    const L = n => this.label(n);
    const nextN = this.nextN(now), next = track ? raceOut(await this.ensure(nextN), L) : raceOut((await pool.query('select * from races where n = $1', [nextN])).rows[0], L);
    const last = raceOut((await pool.query('select * from races where n < $1 and result is not null order by n desc limit 1', [nextN])).rows[0], L);
    const recent = (await pool.query('select n, result from races where settled order by n desc limit 20')).rows;
    const form = Object.fromEntries(CREATURE_IDS.map(id => [id, { wins: 0, last: [] }]));
    for (const r of recent) r.result.order.forEach((id, i) => { if (!form[id]) return; if (i === 0) form[id].wins++; if (form[id].last.length < 5) form[id].last.push(i + 1); });
    const out = { now, every: RACE_EVERY, len: RACE_LEN, announce: RACE_ANNOUNCE, track: track ? { id: track.id, name: track.name || 'Racetrack' } : null, next, last, form, myBets: [] };
    if (playerId) out.myBets = (await pool.query('select n, creature, amount, pays, payout from race_bets where citizen_id = $1 and n >= $2 order by n desc', [playerId, nextN - 1])).rows;
    return out;
  }
  async bet(playerId, creature, amount, blocked) {
    if (!CREATURES[creature]) throw new HttpError(400, 'Pick a creature.');
    amount = Math.floor(Number(amount)); if (!Number.isFinite(amount) || amount < 1) throw new HttpError(400, 'Bet at least 1 coin.');
    if (amount > MAX_RACE_BET) throw new HttpError(400, `The most you can bet on a race is ${fmt(MAX_RACE_BET)} coins.`);
    if (!(await this.hasTrack())) throw new HttpError(409, "The colony doesn't have a Racetrack yet.");
    const n = this.nextN(), r = await this.ensure(n);
    if (Date.now() >= Number(r.start_at) - 1000) throw new HttpError(409, 'The gates have closed. Bet on the next race.');
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [playerId])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.');
      if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. Races are for colonists who have woken up.");
      if (blocked) { const why = await blocked(c); if (why) throw new HttpError(409, why); }
      if ((await ch.q('select 1 from race_bets where n = $1 and citizen_id = $2', [n, c.id])).rowCount) throw new HttpError(409, "You've already bet on this race.");
      ch.coins(c); if (c.coins_base < amount) throw new HttpError(400, c.coins_base ? `You only have ${fmt(c.coins_base)} coins.` : "You don't have any coins yet. Get a job first.");
      c.coins_base -= amount; ch.touch(c); await ch.saveCitizen(c); treasuryAdd(ch, amount);
      const pays = r.odds[creature].pays;
      await ch.q('insert into race_bets (id, n, citizen_id, handle, creature, amount, pays, t) values ($1, $2, $3, $4, $5, $6, $7, $8)', [crypto.randomUUID(), n, c.id, c.handle, creature, amount, pays, Date.now()]);
      return { ok: true, n, no: this.label(n), creature, amount, pays, coins: c.coins_base };
    });
  }
  // The developer turns the next race into a Cup: a bonus pot from the treasury, shared by everyone who backs the winner.
  async setCup(bonus, name) {
    bonus = Math.floor(Number(bonus)); if (!(bonus >= 0) || bonus > 1000000) throw new HttpError(400, 'Bonus must be 0 to 1,000,000 coins.');
    if (!(await this.hasTrack())) throw new HttpError(409, 'Build a Racetrack first.');
    const n = this.nextN(), r = await this.ensure(n);
    if (Date.now() >= Number(r.start_at) - 1000) throw new HttpError(409, 'That race is starting. Try again for the next one.');
    return this.world.change(async ch => {
      const cur = (await ch.q('select cup from races where n = $1 for update', [n])).rows[0].cup;
      const now = R.treasuryOn(ch.meta, ch.today) + (cur?.bonus || 0);
      if (bonus > now) throw new HttpError(400, `The treasury only has ${fmt(now)} coins.`);
      treasuryAdd(ch, (cur?.bonus || 0) - bonus); // the bonus is set aside now, and returned if nobody wins it
      const cup = bonus ? { bonus, name: String(name || "Founders' Cup").replace(/[<>]/g, '').slice(0, 40) || "Founders' Cup" } : null;
      await ch.q('update races set cup = $2 where n = $1', [n, cup ? JSON.stringify(cup) : null]);
      if (cup) await ch.event(`🏆 The ${cup.name} is on! Race #${this.label(n)} has a ${fmt(bonus)}-coin bonus for everyone who backs the winner.`, 'race');
      ch.extraOps.push({ op: 'race', data: { n, stage: 'cup' } });
      return { ok: true, n, cup };
    });
  }
}
