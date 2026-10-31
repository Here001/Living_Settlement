// The Game House: a building full of games. One-tap games (the Lucky wheel, scratch cards) and games of a few
// moves (a penalty shootout, darts) against the house, which is the colony treasury: stakes go in, winnings come out.
// Every result is decided here on the server; the browser only draws it. A colonist has at most one game in progress
// here (citizens.play_game), so it survives a reload.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import { track, realDay } from './stats.js';
import { treasuryAdd } from './races.js';
import { bump } from './achievements.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { startTable, shoot, respot, PRACTICE, AIM_WOBBLE, POWER_WOBBLE } from '../shared/snooker.js';
import { GH_GAMES, GH_MAX_BET, WHEEL_PAID, WHEEL_FREE, SCRATCH_TIERS, scratchCard, PEN_SPOTS, PEN_PAYS, kick, dartScore, dartsPays, wobble } from '../shared/games.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const rand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const STAY = 10 * 60 * 1000;
const CASINO_OK = ['casino', 'gamehouse']; // playing keeps your avatar at the Game House this long

export class GameHouse {
  constructor(world) { this.world = world; }
  // The Lucky wheel and scratch cards are at the Casino; the rest of the games are at a Game House.
  async building(db, bid, types = ['gamehouse']) {
    const b = bid && (await db.query('select * from buildings where id = $1', [String(bid)])).rows[0];
    if (!b || !types.includes(b.type) || !b.done || b.ruin) throw new HttpError(409, types.includes('casino') && !types.includes('gamehouse') ? "That isn't an open Casino." : types.length > 1 ? "That isn't an open Casino or Game House." : "That isn't an open Game House.");
    return b;
  }
  // Lock the colonist, check they can play, and walk their avatar to the Game House for a while.
  async seat(ch, id, bid, types) {
    const gh = await this.building(ch.db, bid, types);
    const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    if (!c.home_id) throw new HttpError(400, 'The Game House is for colonists who have woken up and have a home.');
    const why = this.world.blockedReason && await this.world.blockedReason(c); if (why) throw new HttpError(409, why);
    ch.coins(c); const now = Date.now();
    await ch.q('update citizens set visit_from = case when visit_id = $2 and visit_until > $6 then visit_from else $6 end, visit_id = $2, visit_until = $3, visit_cx = $4, visit_cy = $5, visit_origin = null where id = $1', [c.id, gh.id, now + STAY, gh.cx, gh.cy, now]);
    ch.citizens.set(c.id, [...new Set([...(ch.citizens.get(c.id) || []), R.chunkKey(gh.cx, gh.cy)])]);
    return { c, gh, name: gh.name || BUILDING_TYPES[gh.type].name };
  }
  stake(ch, c, game, bet) {
    bet = Math.floor(Number(bet)); if (!Number.isFinite(bet) || bet < 1) throw new HttpError(400, 'Bet at least 1 coin.');
    if (bet > GH_MAX_BET) throw new HttpError(400, `The most you can bet here is ${fmt(GH_MAX_BET)} coins.`);
    if (c.coins_base < bet) throw new HttpError(400, c.coins_base ? `You only have ${fmt(c.coins_base)} coins on you.` : "You don't have any coins on you.");
    c.coins_base -= bet; treasuryAdd(ch, bet); track(ch, `game:${game}:bet`, bet, c.id); return bet;
  }
  async pay(ch, c, game, paid, staked, name) {
    if (paid > 0) { c.coins_base += paid; treasuryAdd(ch, -paid); track(ch, `game:${game}:win`, paid, c.id); }
    ch.touch(c); await ch.saveCitizen(c); await bump(ch, c.id, { games: 1, ...(paid > staked ? { game_wins: 1 } : {}) });
    if (paid >= 2000 && paid >= staked * 5) await ch.event(`🎮 @${c.handle} won ${fmt(paid)} coins at ${GH_GAMES[game].name.toLowerCase()} at the ${name}!`, 'casino');
  }
  async save(ch, c, g) { await ch.q('update citizens set play_game = $2 where id = $1', [c.id, g ? JSON.stringify(g) : null]); }

  async info(id, bid) {
    const gh = await this.building(pool, bid, ['gamehouse', 'casino']);
    const c = (await pool.query('select coins_base, coins_day, net, home_id, wheel_day, snooker_day, play_game from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0;
    return { housed: !!c.home_id, coins: R.balanceOn(c.coins_base, c.coins_day, c.net, today), name: gh.name || BUILDING_TYPES[gh.type].name, freeSpin: c.wheel_day !== realDay(),
      maxBet: GH_MAX_BET, snookerPrize: c.snooker_day !== realDay(), playing: c.play_game ? this.view(c.play_game) : null };
  }
  view(g) { // what the player may see of a game in progress (nothing is hidden in these games)
    return g ? { ...g } : null;
  }

  // ---------- Lucky wheel: one free spin a real day (coins), or paid spins (a multiple of the bet) ----------
  async wheel(id, bid, { free, bet }) {
    return this.world.change(async ch => {
      const { c, name } = await this.seat(ch, id, bid, CASINO_OK);
      if (free) {
        if (c.wheel_day === realDay()) throw new HttpError(409, 'You’ve had your free spin today. Come back tomorrow, or spin for coins.');
        const slot = crypto.randomInt(WHEEL_FREE.length), prize = Math.min(WHEEL_FREE[slot], Math.floor(R.treasuryOn(ch.meta, ch.today)));
        await ch.q('update citizens set wheel_day = $2 where id = $1', [c.id, realDay()]);
        await this.pay(ch, c, 'wheel', prize, 0, name);
        return { ok: true, free: true, slot, prize, coins: c.coins_base };
      }
      const staked = this.stake(ch, c, 'wheel', bet), slot = crypto.randomInt(WHEEL_PAID.length), m = WHEEL_PAID[slot], paid = Math.floor(staked * m);
      await this.pay(ch, c, 'wheel', paid, staked, name);
      return { ok: true, free: false, slot, x: m, bet: staked, paid, coins: c.coins_base };
    });
  }

  // ---------- Scratch cards: the card is decided when it's bought; the browser lets you scratch it ----------
  async scratch(id, bid, price) {
    price = Math.floor(Number(price)); if (!SCRATCH_TIERS.includes(price)) throw new HttpError(400, `Cards cost ${SCRATCH_TIERS.map(fmt).join(', ')} coins.`);
    return this.world.change(async ch => {
      const { c, name } = await this.seat(ch, id, bid, CASINO_OK); this.stake(ch, c, 'scratch', price);
      const card = scratchCard(rand), paid = price * card.x;
      await this.pay(ch, c, 'scratch', paid, price, name);
      return { ok: true, price, cells: card.cells, win: card.win, x: card.x, paid, coins: c.coins_base };
    });
  }

  // ---------- Penalty shootout: start (bet) → five kicks ----------
  async penalty(id, bid, { action, bet, spot }) {
    return this.world.change(async ch => {
      const { c, name } = await this.seat(ch, id, bid); let g = c.play_game;
      if (g && g.game !== 'penalty') { if (action === 'start') throw new HttpError(409, `Finish your ${GH_GAMES[g.game].name.toLowerCase()} first.`); g = null; }
      if (action === 'start') {
        if (g && !g.done) return { ...g, coins: c.coins_base, resumed: true };
        g = { game: 'penalty', bet: this.stake(ch, c, 'penalty', bet), kicks: [], at: Date.now() };
        ch.touch(c); await ch.saveCitizen(c); await this.save(ch, c, g); return { ...g, coins: c.coins_base };
      }
      if (!g || g.done) throw new HttpError(409, 'Start a new shootout first.');
      if (action !== 'kick') throw new HttpError(400, 'Start, or take a kick.');
      if (!PEN_SPOTS.includes(spot)) throw new HttpError(400, 'Pick where to shoot.');
      g.kicks.push(kick(spot, rand));
      if (g.kicks.length >= 5) {
        const goals = g.kicks.filter(k => k.goal).length; g.goals = goals; g.x = PEN_PAYS[goals] || 0; g.paid = Math.floor(g.bet * g.x); g.done = true;
        await this.pay(ch, c, 'penalty', g.paid, g.bet, name); await this.save(ch, c, null);
      } else await this.save(ch, c, g);
      return { ...g, coins: c.coins_base };
    });
  }

  // ---------- Darts: start (bet) → three throws at where you aim (the server adds a wobble) ----------
  async darts(id, bid, { action, bet, x, y }) {
    return this.world.change(async ch => {
      const { c, name } = await this.seat(ch, id, bid); let g = c.play_game;
      if (g && g.game !== 'darts') { if (action === 'start') throw new HttpError(409, `Finish your ${GH_GAMES[g.game].name.toLowerCase()} first.`); g = null; }
      if (action === 'start') {
        if (g && !g.done) return { ...g, coins: c.coins_base, resumed: true };
        g = { game: 'darts', bet: this.stake(ch, c, 'darts', bet), throws: [], total: 0, at: Date.now() };
        ch.touch(c); await ch.saveCitizen(c); await this.save(ch, c, g); return { ...g, coins: c.coins_base };
      }
      if (!g || g.done) throw new HttpError(409, 'Start a new game of darts first.');
      if (action !== 'throw') throw new HttpError(400, 'Start, or throw a dart.');
      x = Number(x); y = Number(y); if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > 1.2) throw new HttpError(400, 'Aim at the board.');
      const [wx, wy] = wobble(rand), hx = x + wx, hy = y + wy, s = dartScore(hx, hy);
      g.throws.push({ aim: [x, y], hit: [Math.round(hx * 1000) / 1000, Math.round(hy * 1000) / 1000], ...s }); g.total += s.score;
      if (g.throws.length >= 3) {
        g.x = dartsPays(g.total); g.paid = Math.floor(g.bet * g.x); g.done = true;
        await this.pay(ch, c, 'darts', g.paid, g.bet, name); await this.save(ch, c, null);
      } else await this.save(ch, c, g);
      return { ...g, coins: c.coins_base };
    });
  }

  // ---------- Snooker practice: free; pot 3 reds in 6 shots. The first win each real day pays a prize ----------
  async snooker(id, bid, { action, angle, power }) {
    return this.world.change(async ch => {
      const { c, name } = await this.seat(ch, id, bid); let g = c.play_game;
      if (g && g.game !== 'snooker') { if (action === 'start') throw new HttpError(409, `Finish your ${GH_GAMES[g.game].name.toLowerCase()} first.`); g = null; }
      if (action === 'start') {
        if (g && !g.done) return { ...g, coins: c.coins_base, resumed: true };
        g = { game: 'snooker', balls: startTable(PRACTICE.reds), shots: 0, potted: 0, need: PRACTICE.need, max: PRACTICE.shots, at: Date.now() };
        await this.save(ch, c, g); return { ...g, coins: c.coins_base };
      }
      if (!g || g.done) throw new HttpError(409, 'Rack up a new frame first.');
      if (action !== 'shoot') throw new HttpError(400, 'Rack up, or take a shot.');
      angle = Number(angle); power = Number(power); if (!Number.isFinite(angle) || !Number.isFinite(power) || power <= 0 || power > 1) throw new HttpError(400, 'Aim and pick a power.');
      const gauss = () => { const u = Math.max(1e-9, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      const r = shoot(g.balls, angle + gauss() * AIM_WOBBLE, power * (1 + gauss() * POWER_WOBBLE));
      const reds = r.potted.filter(p => p !== 'c').length, foul = r.potted.includes('c');
      g.balls = foul ? [...r.balls, respot(r.balls)] : r.balls; g.shots++; g.potted += reds; g.last = { potted: r.potted, foul, frames: r.frames };
      if (g.potted >= g.need || g.shots >= g.max || !g.balls.some(b => b.id !== 'c')) {
        g.done = true; g.won = g.potted >= g.need; g.paid = 0;
        if (g.won && c.snooker_day !== realDay()) { g.paid = Math.min(PRACTICE.prize, Math.floor(R.treasuryOn(ch.meta, ch.today))); await ch.q('update citizens set snooker_day = $2 where id = $1', [c.id, realDay()]); }
        await this.pay(ch, c, 'snooker', g.paid, 0, name); await this.save(ch, c, null);
      } else await this.save(ch, c, { ...g, last: null });
      return { ...g, coins: c.coins_base };
    });
  }
}
