// The casino's table games, which take more than one step: Blackjack (deal, then hit / stand / double) and Rocket
// (launch, then cash out before it blows up). A colonist has at most one game in progress, kept in citizens.casino_game,
// so it survives a reload or a different server. The house is the colony treasury: bets go in, winnings come out.
// Every random draw happens here on the server; the browser only ever sees what's been revealed.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { MAX_BET, SUITS, RANKS, handValue, isBlackjack, rocketAt, rocketTime, rocketCrash, ROCKET_COUNTDOWN, ROCKET_MAX } from '../shared/casino.js';
import { bump } from './achievements.js';
import { score } from './leaderboards.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const ABANDON = 15 * 60 * 1000; // a game left alone this long is settled as it stands

export class CasinoTables {
  constructor(world) { this.world = world; }
  // Lock the colonist, check they can play here, and find their casino.
  async seat(ch, id) {
    const c = (await ch.q('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1 for update of c', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. The casino is for colonists who have woken up.");
    const cas = await this.world.casinoFor(c); if (!cas) throw new HttpError(409, "The colony doesn't have a casino yet.");
    const why = this.world.blockedReason && await this.world.blockedReason(c); if (why) throw new HttpError(409, why);
    delete c.hx; delete c.hy; ch.coins(c); return { c, cas };
  }
  // Take the stake (into the treasury) and walk the avatar to the casino for a while.
  async stake(ch, c, cas, bet) {
    bet = Math.floor(Number(bet)); if (!Number.isFinite(bet) || bet < 1) throw new HttpError(400, 'Bet at least 1 coin.');
    if (bet > MAX_BET) throw new HttpError(400, `The most you can bet at once is ${fmt(MAX_BET)} coins.`);
    if (c.coins_base < bet) throw new HttpError(400, c.coins_base ? `You only have ${fmt(c.coins_base)} coins.` : "You don't have any coins yet. Get a job first.");
    c.coins_base -= bet; ch.meta.treasuryBase = R.treasuryOn(ch.meta, ch.today) + bet; ch.meta.treasuryDay = ch.today;
    const until = Date.now() + 10 * 60 * 1000;
    await ch.q('update citizens set visit_from = case when visit_id = $2 and visit_until > $6 then visit_from else $6 end, visit_id = $2, visit_until = $3, visit_cx = $4, visit_cy = $5 where id = $1', [c.id, cas.id, until, cas.cx, cas.cy, Date.now()]);
    ch.citizens.set(c.id, [...new Set([...(ch.citizens.get(c.id) || []), R.chunkKey(cas.cx, cas.cy)])]);
    return bet;
  }
  // Pay out (from the treasury), record it for badges and the weekly board, and announce big wins.
  async payout(ch, c, game, staked, paid, casName, gameName) {
    if (paid > 0) { c.coins_base += paid; ch.meta.treasuryBase = Math.max(0, R.treasuryOn(ch.meta, ch.today) - paid); ch.meta.treasuryDay = ch.today; }
    ch.touch(c); await ch.saveCitizen(c);
    const won = paid - staked; await score(ch, c.id, 'casino_net', won);
    await bump(ch, c.id, won > 0 ? { casino_plays: 1, casino_wins: 1 } : { casino_plays: 1 }, won > 0 ? { casino_best: paid } : {});
    if (won >= 200 || (paid >= staked * 20 && won >= 50)) await ch.event(`@${c.handle} won ${fmt(paid)} coins at ${gameName} at the ${casName || 'casino'}!`, 'casino');
  }
  async save(ch, c, game) { await ch.q('update citizens set casino_game = $2 where id = $1', [c.id, game ? JSON.stringify(game) : null]); }

  // ---------- Blackjack ----------
  bjView(g, coins, extra = {}) {
    const done = !!g.done, dealer = done ? g.dealer : [g.dealer[0], '??'];
    return { game: 'blackjack', bet: g.bet, player: g.player, dealer, playerValue: handValue(g.player), dealerValue: done ? handValue(g.dealer) : handValue([g.dealer[0]]),
      done, outcome: g.outcome || null, payout: g.paid || 0, canDouble: !done && g.player.length === 2 && !g.doubled, doubled: !!g.doubled, coins, ...extra };
  }
  async blackjack(id, action, bet) {
    return this.world.change(async ch => {
      const { c, cas } = await this.seat(ch, id), name = cas.name || BUILDING_TYPES.casino.name; let g = c.casino_game;
      if (g && g.game !== 'blackjack') { if (action === 'deal') throw new HttpError(409, 'Finish your Rocket round first.'); g = null; }
      const draw = () => g.deck.pop();
      const finish = async () => {
        if (handValue(g.player) <= 21) while (handValue(g.dealer) < 17) g.dealer.push(draw());
        const p = handValue(g.player), d = handValue(g.dealer), stake = g.bet * (g.doubled ? 2 : 1);
        g.outcome = p > 21 ? 'bust' : d > 21 ? 'dealer-bust' : p > d ? 'win' : p === d ? 'push' : 'lose';
        g.paid = g.outcome === 'win' || g.outcome === 'dealer-bust' ? stake * 2 : g.outcome === 'push' ? stake : 0; g.done = true;
        await this.payout(ch, c, 'blackjack', stake, g.paid, name, 'blackjack'); await this.save(ch, c, null);
      };
      if (action === 'deal') {
        if (g && !g.done) return this.bjView(g, c.coins_base, { resumed: true });
        const stake = await this.stake(ch, c, cas, bet);
        const deck = []; for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
        for (let i = deck.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
        g = { game: 'blackjack', bet: stake, deck, player: [], dealer: [], at: Date.now() };
        g.player.push(draw()); g.dealer.push(draw()); g.player.push(draw()); g.dealer.push(draw());
        if (isBlackjack(g.player) || isBlackjack(g.dealer)) {
          const both = isBlackjack(g.player) && isBlackjack(g.dealer);
          g.outcome = both ? 'push' : isBlackjack(g.player) ? 'blackjack' : 'dealer-blackjack';
          g.paid = both ? stake : g.outcome === 'blackjack' ? Math.floor(stake * 2.5) : 0; g.done = true;
          await this.payout(ch, c, 'blackjack', stake, g.paid, name, 'blackjack'); await this.save(ch, c, null);
          return this.bjView(g, c.coins_base);
        }
        ch.touch(c); await ch.saveCitizen(c); await this.save(ch, c, g); return this.bjView(g, c.coins_base);
      }
      if (!g || g.done) throw new HttpError(409, 'Deal a new hand first.');
      if (action === 'hit') {
        g.player.push(draw()); const v = handValue(g.player);
        if (v >= 21) await finish(); else await this.save(ch, c, g);
      } else if (action === 'double') {
        if (g.player.length !== 2 || g.doubled) throw new HttpError(400, 'You can only double on your first two cards.');
        await this.stake(ch, c, cas, g.bet); g.doubled = true; g.player.push(draw()); await finish();
      } else if (action === 'stand') await finish();
      else throw new HttpError(400, 'Hit, stand or double.');
      return this.bjView(g, c.coins_base);
    });
  }

  // ---------- Rocket ----------
  // Settle a flight that's over by time alone: blown up (or cashed out automatically at the target).
  async rocketResolve(ch, c, g, now = Date.now()) {
    const t = (now - g.start) / 1000, crashT = rocketTime(g.crash);
    if (g.auto && g.auto <= g.crash && t >= rocketTime(g.auto)) { g.cashed = g.auto; g.paid = Math.floor(g.bet * g.auto); }
    else if (t >= crashT || now - g.at > ABANDON) { g.cashed = 0; g.paid = 0; }
    else return false;
    g.done = true; await this.payout(ch, c, 'rocket', g.bet, g.paid, g.casName, 'the Rocket'); await this.save(ch, c, null); return true;
  }
  rocketView(g, coins, now = Date.now()) {
    return { game: 'rocket', bet: g.bet, start: g.start, now, auto: g.auto || null, done: !!g.done, crash: g.done ? g.crash : null, cashed: g.done ? g.cashed : null, payout: g.paid || 0, coins };
  }
  async rocket(id, action, bet, auto, at) {
    if (action === 'status') { // polled during a flight: a plain read unless the flight is due to end
      const g = (await pool.query('select casino_game from citizens where id = $1', [id])).rows[0]?.casino_game, now = Date.now();
      if (!g || g.game !== 'rocket') throw new HttpError(409, 'Launch a rocket first.');
      const t = (now - g.start) / 1000, due = t >= rocketTime(g.crash) || (g.auto && g.auto <= g.crash && t >= rocketTime(g.auto)) || now - g.at > ABANDON;
      if (!due) return this.rocketView(g, undefined, now);
    }
    return this.world.change(async ch => {
      const { c, cas } = await this.seat(ch, id), now = Date.now(); let g = c.casino_game;
      if (g && g.game !== 'rocket') { if (action === 'launch') throw new HttpError(409, 'Finish your Blackjack hand first.'); g = null; }
      if (g && !g.done && await this.rocketResolve(ch, c, g, now)) { if (action !== 'launch') return this.rocketView(g, c.coins_base, now); g = null; }
      if (action === 'launch') {
        if (g && !g.done) return { ...this.rocketView(g, c.coins_base, now), resumed: true };
        const stake = await this.stake(ch, c, cas, bet);
        auto = Number(auto); auto = Number.isFinite(auto) && auto >= 1.01 ? Math.min(ROCKET_MAX, Math.floor(auto * 100) / 100) : null;
        g = { game: 'rocket', bet: stake, crash: rocketCrash(crypto.randomInt(0, 2 ** 32) / 2 ** 32), start: now + ROCKET_COUNTDOWN, at: now, auto, casName: cas.name || BUILDING_TYPES.casino.name };
        ch.touch(c); await ch.saveCitizen(c); await this.save(ch, c, g); return this.rocketView(g, c.coins_base, now);
      }
      if (!g) throw new HttpError(409, 'Launch a rocket first.');
      if (action === 'status') return this.rocketView(g, c.coins_base, now);
      if (action === 'cashout') {
        if (now < g.start) throw new HttpError(409, "It hasn't taken off yet.");
        // Cash out at the moment the player tapped (their phone sends it), not when the request got here: on a phone
        // connection that can be a second later, with the multiplier still climbing. A tap from more than 1.2 s ago, or
        // from the future, isn't believed; and if the rocket had blown up by then, it's lost.
        const tap = Number(at), when = Number.isFinite(tap) && tap <= now && tap >= now - 1200 ? Math.max(g.start, tap) : now;
        if ((when - g.start) / 1000 >= rocketTime(g.crash)) { g.cashed = 0; g.paid = 0; g.done = true; await this.payout(ch, c, 'rocket', g.bet, 0, g.casName, 'the Rocket'); await this.save(ch, c, null); return this.rocketView(g, c.coins_base, now); }
        const m = Math.min(rocketAt((when - g.start) / 1000), g.crash);
        g.cashed = m; g.paid = Math.floor(g.bet * m); g.done = true;
        await this.payout(ch, c, 'rocket', g.bet, g.paid, g.casName, 'the Rocket'); await this.save(ch, c, null);
        return this.rocketView(g, c.coins_base, now);
      }
      throw new HttpError(400, 'Launch, cash out or check the status.');
    });
  }
  // A game in progress, if any (shown when the Casino tab opens).
  async current(id) {
    const g = (await pool.query('select casino_game from citizens where id = $1', [id])).rows[0]?.casino_game; if (!g || g.done) return null;
    if (g.game === 'rocket') { if (Date.now() >= g.start + rocketTime(g.crash) * 1000 || Date.now() - g.at > ABANDON) { try { const r = await this.rocket(id, 'status'); return r.done ? null : r; } catch { return null; } } return this.rocketView(g, undefined); }
    return this.bjView(g, undefined);
  }
}
