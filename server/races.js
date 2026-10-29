// Creature races at the Racetracks.
// Every finished Racetrack runs its own races, every 30 real minutes each. Tracks are staggered in 5-minute steps (the
// first-built track runs on the hour and half hour), so with several tracks there's a race every few minutes.
// Each race has its own field (usually five of the six creatures), odds, bets and optional Cup.
// Bets are open until the gates close at the start. The Colony Log announces each race 2½ minutes before it starts.
// The server rolls the result the moment the race starts, every viewer watches the same ~45 s race, and winners are
// paid when it ends. Odds come from each creature's form and the weather at race time, and are fixed once shown.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { CREATURES, CREATURE_IDS, oddsFor, runRace, fieldFor, hashStr } from '../shared/creatures.js';

// RACE_EVERY_MS can shorten the cycle for testing on a local server; the live colony uses 30 minutes.
export const RACE_EVERY = Math.max(60000, Number(process.env.RACE_EVERY_MS) || 30 * 60 * 1000), RACE_LEN = 45 * 1000, RACE_ANNOUNCE = Math.min(150 * 1000, RACE_EVERY / 2);
export const MAX_RACE_BET = 100000;
const fmt = n => Math.round(n).toLocaleString('en-US');
const SLOTS = 6; // tracks are staggered by RACE_EVERY / SLOTS
const raceOut = (r, label) => r && ({ n: r.n, track: r.track_id, no: label(r.track_id, r.n), start: Number(r.start_at), weather: r.weather, odds: r.odds, field: Object.keys(r.odds), cup: r.cup || null,
  result: Date.now() >= Number(r.start_at) ? r.result : null, settled: r.settled });
const secureRand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
export const treasuryAdd = (ch, delta) => { ch.meta.treasuryBase = Math.max(0, R.treasuryOn(ch.meta, ch.today) + delta); ch.meta.treasuryDay = ch.today; };

export class Races {
  constructor(world) { this.world = world; this.tracksAt = 0; this.tracks = []; this.busy = false; this.made = new Set(); }
  // Finished Racetracks, oldest first, each with a name, a stagger offset and its stretch of the clock.
  // The first-built track always has offset 0; later ones take the first free 5-minute slot from a slot picked by their id.
  async allTracks() {
    if (Date.now() - this.tracksAt > (this.tracks.length ? 5000 : 3000)) {
      this.tracksAt = Date.now();
      const rows = (await pool.query("select id, name, x, y, rot from buildings where type = 'racetrack' and done and not ruin order by built_at, id")).rows, used = new Set();
      this.tracks = rows.map((r, i) => { let slot = i === 0 ? 0 : hashStr(r.id) % SLOTS; for (let k = 0; k < SLOTS && used.has(slot); k++) slot = (slot + 1) % SLOTS; used.add(slot);
        return { id: r.id, name: r.name || (rows.length > 1 ? `Racetrack ${i + 1}` : 'Racetrack'), x: r.x, y: r.y, rot: r.rot || 0, offset: slot * Math.floor(RACE_EVERY / SLOTS) }; });
    }
    return this.tracks;
  }
  async hasTrack() { return (await this.allTracks())[0] || null; }
  async trackById(id) { const all = await this.allTracks(); return (id && all.find(t => t.id === id)) || null; }
  // The track whose next race starts soonest (the default in the Races tab and for bets with no track given).
  async soonest() { const all = await this.allTracks(), now = Date.now(); return all.slice().sort((a, b) => this.startOf(a, this.nextN(a, now)) - this.startOf(b, this.nextN(b, now)))[0] || null; }
  offsetOf(trackId) { return this.tracks.find(t => t.id === trackId)?.offset || 0; }
  // Races are numbered per track from the colony's founding (#1, #2, …) for people; n is the clock-based id underneath.
  label(trackId, n) { const off = this.offsetOf(trackId); return Math.max(1, n - Math.floor(((this.world.meta?.epoch || 0) - off) / RACE_EVERY)); }
  nextN(t, now = Date.now()) { return Math.floor((now - t.offset) / RACE_EVERY) + 1; }
  startOf(t, n) { return n * RACE_EVERY + t.offset; }
  // The race row for track t, number n, created on first need with the weather forecast and the field for its start time.
  async ensure(t, n, db = pool) {
    const meta = this.world.meta; if (!meta) return null;
    const start = this.startOf(t, n), weather = R.weatherAt(meta, (start - meta.epoch) / R.GAME_MIN_MS) || 'sunny', seed = (n ^ hashStr(t.id)) >>> 0;
    const key = t.id + ':' + n;
    if (!this.made.has(key)) { // create the row once (every server remembers it has), then it's just a read
      await db.query('insert into races (track_id, n, start_at, weather, odds) values ($1, $2, $3, $4, $5) on conflict (track_id, n) do nothing', [t.id, n, start, weather, JSON.stringify(oddsFor(fieldFor(seed), weather, seed))]);
      if (this.made.size > 2000) this.made.clear(); this.made.add(key);
    }
    return (await db.query('select * from races where track_id = $1 and n = $2', [t.id, n])).rows[0];
  }

  // Called by the leader on every clock tick: announce, start and settle races. Never runs twice at once.
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try {
      const now = Date.now();
      // Finish anything already under way (even if its Racetrack was knocked down meanwhile).
      for (const r of (await pool.query('select * from races where not settled and start_at <= $1 order by start_at', [now])).rows) {
        if (!r.result) await this.roll(r);
        if (now >= Number(r.start_at) + RACE_LEN) await this.settle(r.track_id, r.n);
      }
      for (const t of await this.allTracks()) {
        const r = await this.ensure(t, this.nextN(t, now));
        if (r && !r.announced && now >= Number(r.start_at) - RACE_ANNOUNCE) await this.announce(r);
      }
    } finally { this.busy = false; }
  }
  where(trackId) { const t = this.tracks.find(x => x.id === trackId); return t ? (this.tracks.length > 1 ? ` at ${t.name}` : '') : ''; }
  async announce(r) {
    await this.world.change(async ch => {
      const ok = (await ch.q('update races set announced = true where track_id = $1 and n = $2 and not announced returning n', [r.track_id, r.n])).rowCount; if (!ok) return;
      const field = Object.keys(r.odds), fav = field.slice().sort((a, b) => r.odds[b].chance - r.odds[a].chance)[0];
      const mins = Math.max(1, Math.floor((Number(r.start_at) - Date.now()) / 60000));
      const at = this.tracks.find(t => t.id === r.track_id)?.name || 'the Racetrack';
      await ch.event(`🏁 ${r.cup ? r.cup.name + ': ' : ''}Race #${this.label(r.track_id, r.n)} starts at ${at} in ${mins} minute${mins === 1 ? '' : 's'}! ${r.weather[0].toUpperCase() + r.weather.slice(1)} track, ${field.length} runners. Favourite: ${CREATURES[fav].name} (pays ${r.odds[fav].pays}×).${r.cup ? ` Bonus prize: ${fmt(r.cup.bonus)} coins.` : ''} Place your bets.`, 'race');
      ch.extraOps.push({ op: 'race', data: { n: r.n, track: r.track_id, stage: 'announced' } });
    });
  }
  // The gates open: decide the finishing order once, with finish times for the animation everyone watches.
  async roll(r) {
    const order = runRace(Object.keys(r.odds), r.weather, secureRand), best = order[0].p;
    const times = {}; order.forEach((o, i) => { times[o.id] = Math.min(RACE_LEN / 1000 - 1, 36 + (best - o.p) * 45 + i * 0.35); });
    const result = { order: order.map(o => o.id), times };
    await this.world.change(async ch => {
      const ok = (await ch.q('update races set result = $3 where track_id = $1 and n = $2 and result is null returning n', [r.track_id, r.n, JSON.stringify(result)])).rowCount;
      if (ok) ch.extraOps.push({ op: 'race', data: { n: r.n, track: r.track_id, stage: 'started' } });
    });
  }
  // The race is over: pay the winners (and share any Cup bonus between them), then tell the colony.
  async settle(trackId, n) {
    await this.world.change(async ch => {
      const r = (await ch.q('update races set settled = true where track_id = $1 and n = $2 and not settled and result is not null returning *', [trackId, n])).rows[0]; if (!r) return;
      const win = r.result.order[0], bets = (await ch.q('select * from race_bets where track_id = $1 and n = $2', [trackId, n])).rows;
      const winners = bets.filter(b => b.creature === win), stake = winners.reduce((s, b) => s + b.amount, 0);
      const bonus = r.cup?.bonus || 0; let paid = 0, fromBonus = 0;
      for (const b of winners) {
        const share = bonus && stake ? Math.floor(bonus * b.amount / stake) : 0; fromBonus += share;
        const payout = Math.floor(b.amount * b.pays) + share;
        const c = (await ch.q('select * from citizens where id = $1 for update', [b.citizen_id])).rows[0];
        if (c) { ch.coins(c); c.coins_base += payout; ch.touch(c); await ch.saveCitizen(c); paid += payout; }
        await ch.q('update race_bets set payout = $2 where id = $1', [b.id, payout]);
      }
      await ch.q('update race_bets set payout = 0 where track_id = $1 and n = $2 and payout is null', [trackId, n]);
      // Stakes went into the treasury when placed and winnings come out of it. The Cup bonus was set aside when the Cup
      // was announced, so only the part of it nobody won (all of it if nobody backed the winner) goes back.
      treasuryAdd(ch, -(paid - fromBonus) + (bonus - fromBonus));
      const second = CREATURES[r.result.order[1]].name;
      await ch.event(`🏆 ${CREATURES[win].name} won ${r.cup ? r.cup.name + ' (' : ''}Race #${this.label(trackId, n)}${this.where(trackId)}${r.cup ? ')' : ''}, ahead of ${second}! ` +
        (winners.length ? `${winners.length} colonist${winners.length === 1 ? '' : 's'} won ${fmt(paid)} coins.` : bets.length ? 'Nobody backed the winner.' : ''), 'race');
      ch.extraOps.push({ op: 'race', data: { n, track: trackId, stage: 'settled' } });
      await ch.q('delete from races where track_id = $1 and n < $2', [trackId, n - 500]); await ch.q('delete from race_bets where track_id = $1 and n < $2', [trackId, n - 500]);
    });
  }

  // What the Races tab shows: every track (its next race, and the race on it now, for drawing), and for the chosen track
  // the next race (odds, weather, field, any Cup), the latest one (live or finished), form, and my bets.
  async info(playerId, trackId) {
    const now = Date.now(), tracks = await this.allTracks(), track = (await this.trackById(trackId)) || (await this.soonest());
    const L = (t, n) => this.label(t, n), out = { now, every: RACE_EVERY, len: RACE_LEN, announce: RACE_ANNOUNCE, track: null, tracks: [], next: null, last: null, form: {}, myBets: [] };
    for (const t of tracks) {
      const nx = raceOut(await this.ensure(t, this.nextN(t, now)), L);
      const lr = (await pool.query('select * from races where track_id = $1 and result is not null and start_at <= $2 order by n desc limit 1', [t.id, now])).rows[0];
      const live = lr && now <= Number(lr.start_at) + RACE_LEN + 20000 ? raceOut(lr, L) : null;
      out.tracks.push({ id: t.id, name: t.name, x: t.x, y: t.y, next: nx && { n: nx.n, no: nx.no, start: nx.start, cup: nx.cup }, live });
    }
    const recent = (await pool.query('select result from races where settled order by start_at desc limit 30')).rows;
    out.form = Object.fromEntries(CREATURE_IDS.map(id => [id, { wins: 0, last: [] }]));
    for (const r of recent) r.result.order.forEach((id, i) => { const f = out.form[id]; if (!f) return; if (i === 0) f.wins++; if (f.last.length < 5) f.last.push(i + 1); });
    if (!track) {
      // No Racetrack now: still show how the last race (if any) ended.
      out.last = raceOut((await pool.query('select * from races where result is not null order by start_at desc limit 1')).rows[0], L); return out;
    }
    out.track = { id: track.id, name: track.name, x: track.x, y: track.y };
    const nextN = this.nextN(track, now); out.next = raceOut(await this.ensure(track, nextN), L);
    out.last = raceOut((await pool.query('select * from races where track_id = $1 and n < $2 and result is not null order by n desc limit 1', [track.id, nextN])).rows[0], L);
    if (playerId) out.myBets = (await pool.query('select track_id track, n, creature, amount, pays, payout from race_bets where citizen_id = $1 and t > $2 order by t desc', [playerId, now - 2 * RACE_EVERY])).rows;
    return out;
  }
  async bet(playerId, creature, amount, blocked, trackId) {
    if (!CREATURES[creature]) throw new HttpError(400, 'Pick a creature.');
    amount = Math.floor(Number(amount)); if (!Number.isFinite(amount) || amount < 1) throw new HttpError(400, 'Bet at least 1 coin.');
    if (amount > MAX_RACE_BET) throw new HttpError(400, `The most you can bet on a race is ${fmt(MAX_RACE_BET)} coins.`);
    if (!(await this.hasTrack())) throw new HttpError(409, "The colony doesn't have a Racetrack yet.");
    const t = (await this.trackById(trackId)) || (await this.soonest());
    const n = this.nextN(t), r = await this.ensure(t, n);
    if (!r.odds[creature]) throw new HttpError(400, `${CREATURES[creature].name} isn't running in this race.`);
    if (Date.now() >= Number(r.start_at) - 1000) throw new HttpError(409, 'The gates have closed. Bet on the next race.');
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [playerId])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.');
      if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. Races are for colonists who have woken up.");
      if (blocked) { const why = await blocked(c); if (why) throw new HttpError(409, why); }
      if ((await ch.q('select 1 from race_bets where track_id = $1 and n = $2 and citizen_id = $3', [t.id, n, c.id])).rowCount) throw new HttpError(409, "You've already bet on this race.");
      ch.coins(c); if (c.coins_base < amount) throw new HttpError(400, c.coins_base ? `You only have ${fmt(c.coins_base)} coins.` : "You don't have any coins yet. Get a job first.");
      c.coins_base -= amount; ch.touch(c); await ch.saveCitizen(c); treasuryAdd(ch, amount);
      const pays = r.odds[creature].pays;
      await ch.q('insert into race_bets (id, track_id, n, citizen_id, handle, creature, amount, pays, t) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [crypto.randomUUID(), t.id, n, c.id, c.handle, creature, amount, pays, Date.now()]);
      return { ok: true, track: t.id, n, no: this.label(t.id, n), creature, amount, pays, coins: c.coins_base };
    });
  }
  // The developer turns a track's next race into a Cup: a bonus pot from the treasury, shared by everyone who backs the winner.
  async setCup(bonus, name, trackId) {
    bonus = Math.floor(Number(bonus)); if (!(bonus >= 0) || bonus > 1000000) throw new HttpError(400, 'Bonus must be 0 to 1,000,000 coins.');
    if (!(await this.hasTrack())) throw new HttpError(409, 'Build a Racetrack first.');
    const t = (await this.trackById(trackId)) || (await this.soonest());
    const n = this.nextN(t), r = await this.ensure(t, n);
    if (Date.now() >= Number(r.start_at) - 1000) throw new HttpError(409, 'That race is starting. Try again for the next one.');
    return this.world.change(async ch => {
      const cur = (await ch.q('select cup from races where track_id = $1 and n = $2 for update', [t.id, n])).rows[0].cup;
      const now = R.treasuryOn(ch.meta, ch.today) + (cur?.bonus || 0);
      if (bonus > now) throw new HttpError(400, `The treasury only has ${fmt(now)} coins.`);
      treasuryAdd(ch, (cur?.bonus || 0) - bonus); // the bonus is set aside now, and returned if nobody wins it
      const cup = bonus ? { bonus, name: String(name || "Founders' Cup").replace(/[<>]/g, '').slice(0, 40) || "Founders' Cup" } : null;
      await ch.q('update races set cup = $3 where track_id = $1 and n = $2', [t.id, n, cup ? JSON.stringify(cup) : null]);
      if (cup) await ch.event(`🏆 The ${cup.name} is on! Race #${this.label(t.id, n)}${this.where(t.id)} has a ${fmt(bonus)}-coin bonus for everyone who backs the winner.`, 'race');
      ch.extraOps.push({ op: 'race', data: { n, track: t.id, stage: 'cup' } });
      return { ok: true, track: t.id, n, cup };
    });
  }
}
