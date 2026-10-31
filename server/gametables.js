// Tables where colonists play each other: Whot, Ludo, Ayo and Snooker at a Game House, Texas Hold'em at a Casino.
// Someone opens a table with a stake (or 0 for a friendly game), others join, and the game starts when every seat is
// taken. Stakes are held by the table, not the treasury; the winner takes the pot less the house's 5% (which goes to the
// treasury), and a draw splits it. A free game can be played against the computer straight away.
// A player who doesn't move within TURN_MS has a move made for them; anyone who leaves mid-game is played for.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import { track } from './stats.js';
import { treasuryAdd } from './races.js';
import { bump } from './achievements.js';
import * as R from '../shared/rules.js';
import { TABLE_GAMES, ENGINES, RAKE, TURN_MS, MAX_STAKE, tableView, potOf } from '../shared/boardgames.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const rand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const WAIT_MS = 15 * 60 * 1000;
export const MISS_LIMIT = 2; // missed turns that forfeit a match // an unfilled table closes (and refunds) after this long
const BOT = i => ({ id: `bot:${i}`, handle: ['Computer', 'Ada (computer)', 'Tunde (computer)', 'Kemi (computer)', 'Bayo (computer)'][i] || 'Computer', bot: true });

export class GameTables {
  constructor(world) { this.world = world; }
  // ---------- reading ----------
  out(t, me) {
    const seat = t.players.findIndex(p => p.id === me), E = ENGINES[t.game];
    const v = t.state ? tableView(t.game, t.state, seat) : null;
    if (v && t.game === 'poker' && seat >= 0 && v.legal) v.legal = v.legal.map(m => ({ ...m })); // costs are coins from your pocket
    return { id: t.id, game: t.game, name: TABLE_GAMES[t.game].name, building: t.building_id, stake: t.stake, seats: t.seats, opts: t.opts || {}, status: t.status,
      players: t.players.map(p => ({ handle: p.handle, bot: !!p.bot, left: !!p.left, missed: p.missed || 0 })), seat, turnAt: Number(t.turn_at || 0), view: v, result: t.result || null,
      pot: t.stake ? (t.state ? potOf(t.game, t.state, t.stake) : t.stake * t.players.length) : 0, now: Date.now(), canMove: !!(t.state && t.state.turn === seat && seat >= 0 && E) };
  }
  async list(id, bid, game) {
    if (!TABLE_GAMES[game]) throw new HttpError(400, 'No such game.');
    const c = (await pool.query('select table_id from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    await this.sweep(); // settle anything that's timed out first
    const rows = (await pool.query(`select * from game_tables where building_id = $1 and game = $2 and status in ('waiting', 'playing') order by status desc, created_at desc limit 20`, [String(bid || ''), game])).rows;
    const mine = c.table_id ? (await pool.query('select * from game_tables where id = $1', [c.table_id])).rows[0] : null;
    return { tables: rows.map(t => this.out(t, id)), mine: mine ? this.out(mine, id) : null, maxStake: MAX_STAKE, rake: RAKE, turnMs: TURN_MS };
  }
  async mine(id) {
    const c = (await pool.query('select table_id from citizens where id = $1', [id])).rows[0]; if (!c?.table_id) return { table: null };
    let t = (await pool.query('select * from game_tables where id = $1', [c.table_id])).rows[0]; if (!t) return { table: null };
    if (t.status === 'playing' && Number(t.turn_at) < Date.now()) { await this.timeout(t.id); t = (await pool.query('select * from game_tables where id = $1', [t.id])).rows[0]; }
    return { table: this.out(t, id) };
  }

  // ---------- opening, joining, leaving ----------
  async lockMe(ch, id) {
    const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    if (!c.home_id) throw new HttpError(400, 'Tables are for colonists who have woken up and have a home.');
    const why = this.world.blockedReason && await this.world.blockedReason(c); if (why) throw new HttpError(409, why);
    if (c.table_id) { const t = (await ch.q('select status from game_tables where id = $1', [c.table_id])).rows[0]; if (t && t.status !== 'done') throw new HttpError(409, 'You’re already at a table. Finish or leave that game first.'); }
    ch.coins(c); return c;
  }
  async place(ch, bid, game) {
    const b = (await ch.q('select * from buildings where id = $1', [String(bid || '')])).rows[0], where = TABLE_GAMES[game].where;
    if (!b || b.type !== where || !b.done || b.ruin) throw new HttpError(409, `${TABLE_GAMES[game].name} is played at ${where === 'casino' ? 'a Casino' : 'a Game House'}.`);
    return b;
  }
  pay(ch, c, stake, game) {
    if (!stake) return; if (c.coins_base < stake) throw new HttpError(400, `The stake is ${fmt(stake)} coins. You have ${fmt(c.coins_base)} on you.`);
    c.coins_base -= stake; track(ch, `table:${game}:stake`, stake, c.id);
  }
  async create(id, { buildingId, game, stake, seats, quick, computer }) {
    const G = TABLE_GAMES[game]; if (!G) throw new HttpError(400, 'Pick a game.');
    stake = Math.floor(Number(stake) || 0); if (stake < 0 || stake > MAX_STAKE) throw new HttpError(400, `Stakes go from 0 (a friendly game) to ${fmt(MAX_STAKE)} coins.`);
    if (game === 'poker' && stake && stake < 10) throw new HttpError(400, "Hold'em needs a stake of at least 10 coins (it's the ante and the bet size), or 0 for a friendly game.");
    seats = Math.floor(Number(seats) || G.min); if (seats < G.min || seats > G.max) throw new HttpError(400, `${G.name} is for ${G.min === G.max ? G.min : `${G.min} to ${G.max}`} players.`);
    if (computer && stake) throw new HttpError(400, 'Games against the computer are free practice.');
    return this.world.change(async ch => {
      const b = await this.place(ch, buildingId, game), c = await this.lockMe(ch, id); this.pay(ch, c, stake, game);
      const players = [{ id: c.id, handle: c.handle }]; if (computer) for (let i = 1; i < seats; i++) players.push(BOT(i - 1));
      const t = { id: crypto.randomUUID(), game, building_id: b.id, stake, seats, opts: { quick: !!quick, computer: !!computer }, players, state: null, status: 'waiting', created_at: Date.now(), turn_at: null };
      await ch.q(`insert into game_tables (id, game, building_id, stake, seats, opts, players, state, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, null, 'waiting', $8)`,
        [t.id, game, b.id, stake, seats, JSON.stringify(t.opts), JSON.stringify(players), t.created_at]);
      await ch.q('update citizens set table_id = $2 where id = $1', [c.id, t.id]); ch.touch(c); await ch.saveCitizen(c);
      if (players.length === seats) await this.start(ch, t);
      else if (stake) await ch.event(`${G.icon} @${c.handle} opened a ${G.name} table for ${fmt(stake)} coins. Who's in?`, 'casino');
      return this.out((await ch.q('select * from game_tables where id = $1', [t.id])).rows[0], id);
    });
  }
  async join(id, tableId) {
    return this.world.change(async ch => {
      const t = (await ch.q('select * from game_tables where id = $1 for update', [String(tableId || '')])).rows[0];
      if (!t || t.status !== 'waiting') throw new HttpError(409, 'That table has already started or closed.');
      if (t.players.some(p => p.id === id)) return this.out(t, id);
      if (t.players.length >= t.seats) throw new HttpError(409, 'That table is full.');
      const c = await this.lockMe(ch, id); this.pay(ch, c, t.stake, t.game);
      t.players.push({ id: c.id, handle: c.handle }); await ch.q('update game_tables set players = $2 where id = $1', [t.id, JSON.stringify(t.players)]);
      await ch.q('update citizens set table_id = $2 where id = $1', [c.id, t.id]); ch.touch(c); await ch.saveCitizen(c);
      if (t.players.length === t.seats) await this.start(ch, t);
      return this.out((await ch.q('select * from game_tables where id = $1', [t.id])).rows[0], id);
    });
  }
  async leave(id) {
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c?.table_id) return { ok: true };
      const t = (await ch.q('select * from game_tables where id = $1 for update', [c.table_id])).rows[0];
      if (!t || t.status === 'done') { await ch.q('update citizens set table_id = null where id = $1', [id]); return { ok: true }; }
      if (t.status === 'waiting') { // nothing has started: your stake comes back
        ch.coins(c); c.coins_base += t.stake; ch.touch(c); await ch.saveCitizen(c); if (t.stake) track(ch, `table:${t.game}:refund`, t.stake, c.id);
        t.players = t.players.filter(p => p.id !== id); await ch.q('update citizens set table_id = null where id = $1', [id]);
        if (!t.players.filter(p => !p.bot).length) await ch.q("update game_tables set status = 'done', players = $2, result = $3, ended_at = $4 where id = $1", [t.id, JSON.stringify(t.players), JSON.stringify({ closed: true }), Date.now()]);
        else await ch.q('update game_tables set players = $2 where id = $1', [t.id, JSON.stringify(t.players)]);
        return { ok: true, refunded: t.stake };
      }
      // Mid-game: you forfeit. In a two-player game the other player wins; otherwise the game goes on without you.
      const seat = t.players.findIndex(p => p.id === id); t.players[seat].left = true;
      await ch.q('update citizens set table_id = null where id = $1', [id]);
      t.state = ENGINES[t.game].drop(t.state, seat);
      await this.advance(ch, t); return { ok: true, forfeited: true };
    });
  }

  // ---------- playing ----------
  async start(ch, t) {
    t.state = ENGINES[t.game].setup(t.seats, { stake: t.stake || 10, quick: !!t.opts?.quick }, rand); t.status = 'playing'; // a friendly Hold'em game uses 10-chip bets
    await this.advance(ch, t);
  }
  async move(id, tableId, move) {
    return this.world.change(async ch => {
      const t = (await ch.q('select * from game_tables where id = $1 for update', [String(tableId || '')])).rows[0];
      if (!t || t.status !== 'playing') throw new HttpError(409, 'That game isn’t being played.');
      const seat = t.players.findIndex(p => p.id === id); if (seat < 0) throw new HttpError(403, "You're not at this table.");
      if (t.state.turn !== seat) throw new HttpError(409, 'It isn’t your turn.');
      await this.apply(ch, t, seat, move || {});
      await this.advance(ch, t);
      return this.out((await ch.q('select * from game_tables where id = $1', [t.id])).rows[0], id);
    });
  }
  // Make a move, charging poker bets and calls to the player's pocket.
  async apply(ch, t, seat, m) {
    const E = ENGINES[t.game], p = t.players[seat];
    if (t.game === 'poker' && t.stake && !p.bot && (m.act === 'call' || m.act === 'bet' || m.act === 'raise')) {
      const L = E.legal(t.state, seat).find(x => x.act === m.act); if (!L) throw new HttpError(409, "You can't do that now.");
      const c = (await ch.q('select * from citizens where id = $1 for update', [p.id])).rows[0]; ch.coins(c);
      if (c.coins_base < L.cost) throw new HttpError(400, `That costs ${fmt(L.cost)} coins; you have ${fmt(c.coins_base)} on you. Check or fold.`);
      c.coins_base -= L.cost; ch.touch(c); await ch.saveCitizen(c); if (t.stake) track(ch, 'table:poker:stake', L.cost, c.id);
    }
    try { t.state = E.play(t.state, seat, m, rand); } catch (e) { throw new HttpError(409, e.message); }
  }
  // Let the computer (and anyone who left) move, then save; settle the table if the game is over.
  async advance(ch, t) {
    const E = ENGINES[t.game];
    for (let k = 0; k < 400 && t.state.turn != null; k++) {
      const p = t.players[t.state.turn]; if (!p.bot) break;
      const m = p.bot && E.bot ? E.bot(t.state, t.state.turn, rand) : E.auto(t.state, t.state.turn, rand);
      t.state = E.play(t.state, t.state.turn, m, rand);
    }
    if (t.state.turn == null) return this.settle(ch, t);
    await ch.q("update game_tables set state = $2, status = 'playing', players = $3, turn_at = $4 where id = $1", [t.id, JSON.stringify(t.state), JSON.stringify(t.players), Date.now() + TURN_MS]);
  }
  async settle(ch, t) {
    const pot = t.stake ? potOf(t.game, t.state, t.stake) : 0, rake = Math.floor(pot * RAKE), winners = t.state.winners || [], share = winners.length ? Math.floor((pot - rake) / winners.length) : 0;
    const paid = {};
    for (const w of winners) { const p = t.players[w]; if (!p || p.bot) continue;
      const c = (await ch.q('select * from citizens where id = $1 for update', [p.id])).rows[0]; if (!c) continue;
      ch.coins(c); c.coins_base += share; ch.touch(c); await ch.saveCitizen(c); paid[p.handle] = share; if (share) track(ch, `table:${t.game}:win`, share, c.id);
      await bump(ch, c.id, { table_wins: 1 }); }
    const botWin = winners.reduce((a, w) => a + (t.players[w]?.bot ? share : 0), 0), toHouse = rake + botWin + (pot - rake - share * winners.length);
    if (toHouse > 0) { treasuryAdd(ch, toHouse); track(ch, 'table:rake', toHouse, null); }
    const result = { winners: winners.map(w => t.players[w]?.handle), pot, rake, share, paid };
    await ch.q("update game_tables set state = $2, status = 'done', players = $3, result = $4, ended_at = $5, turn_at = null where id = $1", [t.id, JSON.stringify(t.state), JSON.stringify(t.players), JSON.stringify(result), Date.now()]);
    const humans = t.players.filter(p => !p.bot).map(p => p.id);
    for (const id of humans) await bump(ch, id, { table_games: 1 });
    if (pot >= 1000 && result.winners.length === 1 && !t.players[winners[0]]?.bot) await ch.event(`${TABLE_GAMES[t.game].icon} @${result.winners[0]} won a ${fmt(pot - rake)}-coin pot at ${TABLE_GAMES[t.game].name}!`, 'casino');
    // Seats are kept until each player looks at the result (they clear when they leave or open another table).
  }
  async timeout(tableId) {
    return this.world.change(async ch => {
      const t = (await ch.q('select * from game_tables where id = $1 for update', [tableId])).rows[0];
      if (!t || t.status !== 'playing' || Number(t.turn_at) > Date.now()) return;
      const seat = t.state.turn, E = ENGINES[t.game], p = t.players[seat];
      // Missing a turn: a move is made for you. Miss two turns in a match and you forfeit it.
      p.missed = (p.missed || 0) + 1;
      if (p.missed >= MISS_LIMIT) { p.left = true; t.state = E.drop(t.state, seat); await ch.q('update citizens set table_id = null where id = $1 and table_id = $2', [p.id, t.id]);
        if (!p.bot) await ch.event(`${TABLE_GAMES[t.game].icon} @${p.handle} missed two turns and forfeited a ${TABLE_GAMES[t.game].name} game.`, 'casino'); }
      else t.state = E.play(t.state, seat, E.auto(t.state, seat, rand), rand);
      await this.advance(ch, t);
    }).catch(() => {});
  }
  // Time out slow players and close tables nobody joined.
  async sweep() {
    const now = Date.now();
    for (const r of (await pool.query("select id from game_tables where status = 'playing' and turn_at < $1 limit 20", [now])).rows) await this.timeout(r.id);
    const stale = (await pool.query("select id from game_tables where status = 'waiting' and created_at < $1 limit 20", [now - WAIT_MS])).rows;
    for (const r of stale) await this.world.change(async ch => {
      const t = (await ch.q('select * from game_tables where id = $1 for update', [r.id])).rows[0]; if (!t || t.status !== 'waiting') return;
      for (const p of t.players) { if (p.bot) continue; const c = (await ch.q('select * from citizens where id = $1 for update', [p.id])).rows[0]; if (!c) continue;
        ch.coins(c); c.coins_base += t.stake; ch.touch(c); await ch.saveCitizen(c); await ch.q('update citizens set table_id = null where id = $1 and table_id = $2', [c.id, t.id]); }
      await ch.q("update game_tables set status = 'done', result = $2, ended_at = $3 where id = $1", [t.id, JSON.stringify({ closed: true, expired: true }), Date.now()]);
    }).catch(() => {});
  }
}
