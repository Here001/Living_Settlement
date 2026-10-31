// Games played between colonists at a table: Whot, Ludo, Ayo, Snooker and Texas Hold'em.
// Each engine is plain data in, plain data out, so the server can check every move and save the table as JSON:
//   setup(n, opts, rand) → state        legal(state, seat) → moves        play(state, seat, move, rand) → state
//   view(state, seat) → what that seat may see        auto(state, seat, rand) → a move (for timeouts and the computer)
// state.turn is the seat to move (null when the game is over); state.winners lists the winning seats once it ends.
import { shoot, startTable, respot, AIM_WOBBLE, POWER_WOBBLE, BALL_R, POCKETS } from './snooker.js';

export const TABLE_GAMES = {
  whot: { name: 'Whot', icon: '🃏', min: 2, max: 4, where: 'gamehouse' },
  ludo: { name: 'Ludo', icon: '🎲', min: 2, max: 4, where: 'gamehouse' },
  ayo: { name: 'Ayo', icon: '🥥', min: 2, max: 2, where: 'gamehouse' },
  snooker: { name: 'Snooker', icon: '🎱', min: 2, max: 2, where: 'gamehouse' },
  poker: { name: "Texas Hold'em", icon: '♠️', min: 2, max: 6, where: 'casino' },
};
export const RAKE = 0.05;          // the house's share of every pot
export const TURN_MS = 45000;      // a player who doesn't move in time has a move made for them
export const MAX_STAKE = 50000;
const pickOne = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr, rand) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
// The next seat still in the game (players who forfeited are skipped).
const next = (s, seat) => { let t = seat; for (let k = 0; k < s.n; k++) { t = (t + 1) % s.n; if (!(s.out && s.out[t])) return t; } return seat; };
const alive = s => [...Array(s.n).keys()].filter(i => !(s.out && s.out[i]));
// A player forfeits (two missed turns, or they left): in a two-player game the other wins; otherwise play goes on without them.
function dropSeat(s, seat, clear) {
  s = structuredClone(s); s.out = s.out || Array(s.n).fill(false); s.out[seat] = true; if (clear) clear(s, seat); s.log = s.log || []; s.log.push([seat, 'forfeited']);
  const left = alive(s); if (left.length <= 1) { s.winners = left; s.turn = null; return s; }
  if (s.turn === seat) s.turn = next(s, seat); return s;
}

// ======================= Whot =======================
// Shapes and numbers as in the Nigerian deck. Specials: 1 hold on (play again), 2 pick two, 5 pick three,
// 8 suspension (the next player misses a turn), 14 general market (everyone else draws one), 20 Whot (wild: call a shape).
export const WHOT_SHAPES = { circle: '●', triangle: '▲', cross: '✚', square: '■', star: '★' };
const WHOT_NUMBERS = { circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14], triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14], cross: [1, 2, 3, 5, 7, 10, 11, 13, 14], square: [1, 2, 3, 5, 7, 10, 11, 13, 14], star: [1, 2, 3, 4, 5, 7, 8] };
export const whotDeck = () => { const d = []; for (const [s, ns] of Object.entries(WHOT_NUMBERS)) for (const n of ns) d.push(`${s}:${n}`); for (let i = 0; i < 5; i++) d.push('whot:20'); return d; };
const wc = c => { const [s, n] = c.split(':'); return { s, n: Number(n) }; };
const whotScore = hand => hand.reduce((t, c) => { const { s, n } = wc(c); return t + (s === 'star' ? n * 2 : n); }, 0);
const whot = {
  setup(n, opts, rand) {
    const deck = shuffle(whotDeck(), rand), hands = []; for (let i = 0; i < n; i++) hands.push(deck.splice(0, 5));
    let k = deck.findIndex(c => ![1, 2, 5, 8, 14, 20].includes(wc(c).n)); if (k < 0) k = 0; const top = deck.splice(k, 1)[0];
    return { n, hands, market: deck, pile: [top], call: null, turn: 0, winners: null, log: [] };
  },
  legal(s, seat) {
    if (s.turn !== seat) return [];
    const top = wc(s.pile[s.pile.length - 1]), shape = s.call || top.s, out = [];
    for (const c of new Set(s.hands[seat])) { const { s: cs, n } = wc(c);
      if (cs === 'whot') { for (const sh of Object.keys(WHOT_SHAPES)) out.push({ card: c, call: sh }); }
      else if (cs === shape || (n === top.n && top.s !== 'whot')) out.push({ card: c }); }
    out.push({ draw: true }); return out;
  },
  play(s, seat, m, rand) {
    s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    const draw = (p, k) => { for (let i = 0; i < k; i++) { if (!s.market.length) { const top = s.pile.pop(); s.market = shuffle(s.pile, rand); s.pile = [top]; } if (!s.market.length) break; s.hands[p].push(s.market.pop()); } };
    if (m.draw) { draw(seat, 1); s.log.push([seat, 'drew']); s.turn = next(s, seat); return this.end(s); }
    const ok = this.legal(s, seat).some(x => x.card === m.card && (x.call || null) === (m.call || null)); if (!ok) throw new Error("You can't play that card now.");
    s.hands[seat].splice(s.hands[seat].indexOf(m.card), 1); s.pile.push(m.card); s.call = m.call || null;
    const { n } = wc(m.card); s.log.push([seat, 'played', m.card, m.call || null]);
    if (!s.hands[seat].length) { s.winners = [seat]; s.turn = null; return s; }
    const nx = next(s, seat);
    if (n === 1) s.turn = seat;                                    // hold on: play again
    else if (n === 2) { draw(nx, 2); s.turn = next(s, nx); }       // pick two
    else if (n === 5) { draw(nx, 3); s.turn = next(s, nx); }       // pick three
    else if (n === 8) s.turn = next(s, nx);                        // suspension
    else if (n === 14) { for (let p = 0; p < s.n; p++) if (p !== seat && !(s.out && s.out[p])) draw(p, 1); s.turn = seat; } // general market: everyone else draws, you go again
    else s.turn = nx;
    return this.end(s);
  },
  end(s) { // the market and the pile have both run out (or the game has gone on too long): the lowest hand wins
    s.moves = (s.moves || 0) + 1;
    if (s.moves >= 300 || (!s.market.length && s.pile.length <= 1 && !this.legal(s, s.turn).some(m => m.card))) {
      const sc = s.hands.map((h, i) => s.out && s.out[i] ? Infinity : whotScore(h)), best = Math.min(...sc); s.winners = sc.map((v, i) => v === best ? i : -1).filter(i => i >= 0); s.turn = null; }
    return s;
  },
  drop(s, seat) { return dropSeat(s, seat, (st, i) => { st.market.unshift(...st.hands[i]); st.hands[i] = []; }); },
  view(s, seat) { return { n: s.n, out: s.out || null, hand: s.hands[seat] || [], counts: s.hands.map(h => h.length), top: s.pile[s.pile.length - 1], call: s.call, market: s.market.length, turn: s.turn, winners: s.winners, log: s.log.slice(-6) }; },
  auto(s, seat, rand) { const L = this.legal(s, seat), cards = L.filter(m => m.card && !m.call);
    if (cards.length) return cards.sort((a, b) => wc(b.card).n - wc(a.card).n)[0];
    const w = L.filter(m => m.call); if (w.length) { const counts = {}; for (const c of s.hands[seat]) { const x = wc(c).s; if (x !== 'whot') counts[x] = (counts[x] || 0) + 1; } const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'circle'; return w.find(m => m.call === best) || w[0]; }
    return { draw: true }; },
};

// ======================= Ludo (two dice) =======================
// A token's progress: -1 in the yard, 0–50 round the track from its own start, 51–55 up its home column, 56 home
// (-2: the player forfeited). Seats start a quarter of the track apart; with two players they sit opposite.
// Each turn you roll two dice and use each one on any token: the same token twice, or two different ones. A 6 brings a
// token out of the yard. Landing on a lone opponent (not on a star) sends it back to its yard. Double six, a capture,
// or getting a token home earns another roll.
export const LUDO_SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
const LUDO_HOME = 56;
const ludoAbs = (start, p) => (start + p) % 52;
const ludo = {
  setup(n, opts) { const tokens = opts.quick ? 2 : 4, starts = n === 2 ? [0, 26] : n === 3 ? [0, 13, 26] : [0, 13, 26, 39];
    return { n, starts, tokens: Array.from({ length: n }, () => Array(tokens).fill(-1)), turn: 0, dice: null, used: null, bonus: false, winners: null, log: [] }; },
  moves(s, seat, d) { const out = [];
    s.tokens[seat].forEach((p, i) => { if (p === LUDO_HOME || p === -2) return; if (p === -1) { if (d === 6) out.push(i); return; } if (p + d <= LUDO_HOME) out.push(i); });
    return out; },
  legal(s, seat) { if (s.turn !== seat) return []; if (s.dice == null) return [{ roll: true }];
    const out = []; s.dice.forEach((d, k) => { if (s.used[k]) return; if (k === 1 && !s.used[0] && s.dice[0] === s.dice[1]) return; for (const token of this.moves(s, seat, d)) out.push({ token, die: k }); }); return out; },
  endTurn(s, seat) { const again = (s.dice[0] === 6 && s.dice[1] === 6) || s.bonus; s.dice = null; s.used = null; s.bonus = false; s.turn = again ? seat : next(s, seat); return s; },
  play(s, seat, m, rand) {
    s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    if (m.roll) { if (s.dice != null) throw new Error('Move a token first.');
      s.dice = [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)]; s.used = [false, false]; s.bonus = false; s.log.push([seat, 'rolled', s.dice.slice()]);
      if (!this.legal(s, seat).length) { s.log.push([seat, 'no move']); return this.endTurn(s, seat); }
      return s; }
    if (s.dice == null) throw new Error('Roll first.');
    let k = Number(m.die); if (!(k === 0 || k === 1) || s.used[k]) k = s.used[0] ? 1 : 0; // the die to use (the first unused one if not given)
    if (!this.moves(s, seat, s.dice[k]).includes(m.token)) { const o = 1 - k; if (!s.used[o] && this.moves(s, seat, s.dice[o]).includes(m.token)) k = o; else throw new Error("That token can't move with that die."); }
    const d = s.dice[k], p = s.tokens[seat][m.token], np = p === -1 ? 0 : p + d; s.tokens[seat][m.token] = np; s.used[k] = true;
    if (np <= 50) { const a = ludoAbs(s.starts[seat], np);
      if (!LUDO_SAFE.includes(a)) for (let o = 0; o < s.n; o++) { if (o === seat) continue; const hit = s.tokens[o].map((q, i) => q >= 0 && q <= 50 && ludoAbs(s.starts[o], q) === a ? i : -1).filter(i => i >= 0);
        if (hit.length === 1) { s.tokens[o][hit[0]] = -1; s.bonus = true; s.log.push([seat, 'captured', o]); } } }
    if (np === LUDO_HOME) s.bonus = true;
    s.log.push([seat, 'moved', m.token, np, d]);
    if (s.tokens[seat].every(q => q === LUDO_HOME)) { s.winners = [seat]; s.turn = null; s.dice = null; return s; }
    if (s.used.every(Boolean) || !this.legal(s, seat).length) return this.endTurn(s, seat);
    return s; },
  drop(s, seat) { return dropSeat(s, seat, (st, i) => { st.tokens[i] = st.tokens[i].map(() => -2); if (st.turn === i) { st.dice = null; st.used = null; st.bonus = false; } }); },
  view(s) { return { n: s.n, out: s.out || null, starts: s.starts, tokens: s.tokens, turn: s.turn, dice: s.dice, used: s.used, winners: s.winners, log: s.log.slice(-6) }; },
  auto(s, seat) { const L = this.legal(s, seat); if (L[0]?.roll) return L[0];
    // prefer a capture, then getting home, then coming out, then the token furthest along
    let best = null, score = -1; for (const m of L) { const p = s.tokens[seat][m.token], d = s.dice[m.die], np = p === -1 ? 0 : p + d; let v = np;
      if (np <= 50) { const a = ludoAbs(s.starts[seat], np); for (let o = 0; o < s.n; o++) if (o !== seat && !LUDO_SAFE.includes(a) && s.tokens[o].filter(q => q >= 0 && q <= 50 && ludoAbs(s.starts[o], q) === a).length === 1) v += 100; }
      if (np === LUDO_HOME) v += 80; if (p === -1) v += 60; if (v > score) { score = v; best = m; } }
    return best || L[0]; },
};

// ======================= Ayo (oware) =======================
// Twelve pits, six a side, four seeds each. Pick one of your pits and sow its seeds one by one anticlockwise (skipping
// the pit you emptied). If your last seed makes 2 or 3 in an opponent's pit, you capture them, and the pits before it
// that also hold 2 or 3. The game ends when someone has more than 24, or when a player's side is empty: they forfeit
// the pebbles left on the other side, which go to their opponent's score. Most pebbles wins.
const ayo = {
  setup() { return { n: 2, pits: Array(12).fill(4), store: [0, 0], turn: 0, winners: null, last: null, log: [] }; },
  sow(pits, pit) { const p = pits.slice(); let seeds = p[pit], i = pit; p[pit] = 0; while (seeds) { i = (i + 1) % 12; if (i === pit) continue; p[i]++; seeds--; } return { p, last: i }; },
  side: (seat, i) => seat === 0 ? i < 6 : i >= 6,
  result(s, seat, pit) { const { p, last } = this.sow(s.pits, pit); let got = 0; const q = p.slice();
    if (!this.side(seat, last)) { let i = last; while (!this.side(seat, i) && (q[i] === 2 || q[i] === 3)) { got += q[i]; q[i] = 0; i = (i + 11) % 12; } }
    return { pits: q, got }; },
  legal(s, seat) { if (s.turn !== seat) return []; return [...Array(12).keys()].filter(i => this.side(seat, i) && s.pits[i] > 0).map(pit => ({ pit })); },
  sideSum(s, seat) { let t = 0; for (let i = 0; i < 12; i++) if (this.side(seat, i)) t += s.pits[i]; return t; },
  play(s, seat, m) { s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    if (!this.legal(s, seat).some(x => x.pit === m.pit)) throw new Error("You can't play that pit.");
    const r = this.result(s, seat, m.pit); s.pits = r.pits; s.store[seat] += r.got; s.last = m.pit; s.log.push([seat, 'sowed', m.pit, r.got]);
    const other = 1 - seat;
    s.moves = (s.moves || 0) + 1;
    if (s.store[seat] > 24) return this.finish(s);
    // A side is empty: that player forfeits what's left on the other side, which goes to the other player's score.
    // (After 200 moves the seeds are just going round: each player keeps what's on their own side.)
    if (s.moves >= 200 || !this.sideSum(s, 0) || !this.sideSum(s, 1)) {
      const empty = !this.sideSum(s, 0) ? 0 : !this.sideSum(s, 1) ? 1 : null;
      for (let i = 0; i < 12; i++) { s.store[this.side(0, i) ? 0 : 1] += s.pits[i]; s.pits[i] = 0; }
      if (empty != null && s.moves < 200) s.log.push([empty, 'side empty']); return this.finish(s); }
    s.turn = other; return s; },
  drop(s, seat) { return dropSeat(s, seat); },
  finish(s) { s.turn = null; s.winners = s.store[0] === s.store[1] ? [0, 1] : [s.store[0] > s.store[1] ? 0 : 1]; return s; },
  view(s) { return { n: 2, out: s.out || null, pits: s.pits, store: s.store, turn: s.turn, winners: s.winners, last: s.last, log: s.log.slice(-6) }; },
  auto(s, seat) { const L = this.legal(s, seat); let best = L[0], v = -1; for (const m of L) { const g = this.result(s, seat, m.pit).got; if (g > v) { v = g; best = m; } } return best; },
};

// ======================= Snooker (1 v 1) =======================
// Nine reds. Pot a red and you shoot again; miss and it's the other player's turn. Potting the cue ball, or not hitting
// a red at all, is a foul: the cue ball comes back on its spot and the turn passes. First to pot 5 reds wins.
export const SNOOKER_RACE = 5;
const snooker = {
  setup() { return { n: 2, balls: startTable(9), score: [0, 0], turn: 0, winners: null, last: null, log: [] }; },
  legal(s, seat) { return s.turn === seat ? [{ shot: true }] : []; },
  play(s, seat, m, rand) { s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    const angle = Number(m.angle), power = Number(m.power); if (!Number.isFinite(angle) || !(power > 0 && power <= 1)) throw new Error('Aim and pick a power.');
    const g = () => { const u = Math.max(1e-9, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const r = shoot(s.balls, angle + g() * AIM_WOBBLE, power * (1 + g() * POWER_WOBBLE), m.spin);
    const reds = r.potted.filter(p => p !== 'c').length, foul = r.potted.includes('c') || !r.firstHit;
    s.balls = r.potted.includes('c') ? [...r.balls, respot(r.balls)] : r.balls; s.score[seat] += reds;
    s.last = { seat, potted: r.potted, foul, frames: r.frames }; s.log.push([seat, foul ? 'foul' : reds ? 'potted' : 'missed', reds]);
    if (s.score[seat] >= SNOOKER_RACE || !s.balls.some(b => b.id !== 'c')) { s.turn = null; s.winners = s.score[0] === s.score[1] ? [0, 1] : [s.score[0] > s.score[1] ? 0 : 1]; return s; }
    if (!reds || foul) s.turn = 1 - seat; return s; },
  drop(s, seat) { return dropSeat(s, seat); },
  view(s) { return { n: 2, out: s.out || null, balls: s.balls, score: s.score, turn: s.turn, winners: s.winners, last: s.last, race: SNOOKER_RACE, log: s.log.slice(-6) }; },
  auto(s, seat, rand) { // the computer: line up the easiest red with a pocket (with the same wobble as a player)
    const cue = s.balls.find(b => b.id === 'c'); let best = null;
    for (const r of s.balls) if (r.id !== 'c') for (const [px, py] of POCKETS) { const dx = px - r.x, dy = py - r.y, d = Math.hypot(dx, dy), gx = r.x - dx / d * BALL_R * 2, gy = r.y - dy / d * BALL_R * 2;
      const ax = gx - cue.x, ay = gy - cue.y, cut = Math.acos(Math.max(-1, Math.min(1, (ax * dx + ay * dy) / (Math.hypot(ax, ay) * d)))); if (!best || cut < best.cut) best = { cut, angle: Math.atan2(ay, ax) }; }
    return { shot: true, angle: (best ? best.angle : 0) + (rand() - 0.5) * 0.06, power: 0.45 + rand() * 0.2 }; },
};

// ======================= Texas Hold'em (one hand, fixed limit) =======================
// Everyone puts in the stake (the ante). Betting rounds: before the flop, after the flop, the turn and the river.
// A bet or raise is the stake (twice the stake on the turn and river), at most three raises a round. Fold, check,
// call, bet or raise. Best five of seven cards wins the pot; split pots are shared.
const PK_RANKS = '23456789TJQKA', PK_SUITS = '♠♥♦♣';
export const pokerDeck = () => { const d = []; for (const r of PK_RANKS) for (const s of PK_SUITS) d.push(r + s); return d; };
export function handRank(cards) { // the best five of five to seven cards → a comparable array [category, ...kickers]
  if (cards.length < 5) { const v = cards.map(x => PK_RANKS.indexOf(x[0]) + 2).sort((a, b) => b - a); return v.length === 2 && v[0] === v[1] ? [1, v[0]] : [0, ...v]; }
  let best = null; const pick = (from, chosen) => { if (chosen.length === 5) { const r = rank5(chosen); if (!best || cmpRank(r, best) > 0) best = r; return; }
    for (let i = from; i <= cards.length - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]]); };
  pick(0, []); return best;
}
function rank5(c) {
  const v = c.map(x => PK_RANKS.indexOf(x[0]) + 2).sort((a, b) => b - a), suits = c.map(x => x[1]), flush = suits.every(s => s === suits[0]);
  const uniq = [...new Set(v)]; let straight = 0; if (uniq.length === 5) { if (v[0] - v[4] === 4) straight = v[0]; else if (v[0] === 14 && v[1] === 5) straight = 5; }
  const cnt = {}; for (const x of v) cnt[x] = (cnt[x] || 0) + 1; const groups = Object.entries(cnt).map(([k, n]) => [n, Number(k)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (straight && flush) return [8, straight]; if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]]; if (flush) return [5, ...v]; if (straight) return [4, straight];
  if (groups[0][0] === 3) return [3, groups[0][1], ...groups.slice(1).map(g => g[1])]; if (groups[0][0] === 2 && groups[1][0] === 2) return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], ...groups.slice(1).map(g => g[1])]; return [0, ...v];
}
export const cmpRank = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
export const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
const poker = {
  setup(n, opts, rand) { const deck = shuffle(pokerDeck(), rand), hole = []; for (let i = 0; i < n; i++) hole.push([deck.pop(), deck.pop()]);
    return { n, unit: opts.stake, deck, hole, board: [], street: 0, folded: Array(n).fill(false), put: Array(n).fill(opts.stake), owe: Array(n).fill(0), bet: 0, raises: 0, acted: Array(n).fill(false), turn: 0, winners: null, log: [], shown: null }; },
  size(s) { return s.unit * (s.street >= 2 ? 2 : 1); },
  live(s) { return [...Array(s.n).keys()].filter(i => !s.folded[i]); },
  drop(s, seat) { if (s.turn === seat) return this.play(s, seat, { act: 'fold' });
    s = structuredClone(s); s.folded[seat] = true; s.log.push([seat, 'forfeited']); const live = this.live(s); if (live.length === 1) { s.winners = live; s.turn = null; } return s; },
  legal(s, seat) { if (s.turn !== seat) return []; const toCall = s.bet - s.owe[seat], out = [{ act: 'fold' }];
    out.push(toCall ? { act: 'call', cost: toCall } : { act: 'check' }); if (s.raises < 3) out.push({ act: s.bet ? 'raise' : 'bet', cost: toCall + this.size(s) }); return out; },
  play(s, seat, m) { s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    const L = this.legal(s, seat).find(x => x.act === m.act); if (!L) throw new Error("You can't do that now.");
    if (m.act === 'fold') s.folded[seat] = true;
    else if (m.act === 'call') { s.put[seat] += L.cost; s.owe[seat] += L.cost; }
    else if (m.act === 'bet' || m.act === 'raise') { s.put[seat] += L.cost; s.owe[seat] += L.cost; s.bet = s.owe[seat]; s.raises++; s.acted = s.acted.map(() => false); }
    s.acted[seat] = true; s.log.push([seat, m.act, L.cost || 0]);
    const live = this.live(s); if (live.length === 1) { s.winners = live; s.turn = null; return s; }
    const done = live.every(i => s.acted[i] && s.owe[i] === s.bet);
    if (!done) { let t = next(s, seat); while (s.folded[t]) t = next(s, t); s.turn = t; return s; }
    if (s.street === 3) return this.showdown(s);
    s.street++; s.board.push(...s.deck.splice(-(s.street === 1 ? 3 : 1))); s.bet = 0; s.raises = 0; s.owe = s.owe.map(() => 0); s.acted = s.acted.map(() => false);
    let t = 0; while (s.folded[t]) t = next(s, t); s.turn = t; return s; },
  showdown(s) { const live = this.live(s), ranks = live.map(i => handRank([...s.hole[i], ...s.board]));
    let best = ranks[0]; for (const r of ranks) if (cmpRank(r, best) > 0) best = r;
    s.winners = live.filter((_, k) => cmpRank(ranks[k], best) === 0); s.shown = Object.fromEntries(live.map((i, k) => [i, { hole: s.hole[i], hand: HAND_NAMES[ranks[k][0]] }])); s.turn = null; return s; },
  view(s, seat) { return { n: s.n, hole: s.hole[seat] || null, board: s.board, street: s.street, folded: s.folded, put: s.put, bet: s.bet, owe: s.owe, unit: s.unit, turn: s.turn, winners: s.winners, shown: s.shown, log: s.log.slice(-8),
    legal: s.turn === seat ? this.legal(s, seat) : [] }; },
  auto(s, seat) { const L = this.legal(s, seat); return L.find(m => m.act === 'check') || L.find(m => m.act === 'fold'); }, // a player who times out checks or folds
  bot(s, seat, rand) { // the computer: plays its cards straightforwardly
    const L = this.legal(s, seat), r = handRank([...s.hole[seat], ...s.board]), hi = Math.max(...s.hole[seat].map(c => PK_RANKS.indexOf(c[0]))), strong = r[0] >= 2 || (r[0] === 1 && r[1] >= 10) || (s.street === 0 && (hi >= 10 || s.hole[seat][0][0] === s.hole[seat][1][0]));
    if (strong && rand() < 0.7) return L.find(m => m.act === 'raise' || m.act === 'bet') || L.find(m => m.act === 'call') || L.find(m => m.act === 'check');
    if (r[0] >= 1 || s.street === 0 || rand() < 0.3) return L.find(m => m.act === 'check') || L.find(m => m.act === 'call');
    return L.find(m => m.act === 'check') || L.find(m => m.act === 'fold'); },
};

export const ENGINES = { whot, ludo, ayo, snooker, poker };
// What a seat sees, plus whose turn it is.
export const tableView = (game, s, seat) => ENGINES[game].view(s, seat);
// How much each seat has put in (poker grows the pot as it goes; the others are the stake each).
export const potOf = (game, s, stake) => game === 'poker' ? s.put.reduce((a, b) => a + b, 0) : stake * s.n;
