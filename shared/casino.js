// The casino's games and their odds, shared by the server (which rolls the dice) and the browser (which shows the rules).
// Each game keeps a small house edge (about 5%), which goes to the colony treasury.
export const SLOT_SYMBOLS = [ // weight = how often the symbol lands on a reel
  { id: 'cherry', icon: '🍒', weight: 6 }, { id: 'lemon', icon: '🍋', weight: 5 }, { id: 'bell', icon: '🔔', weight: 4 },
  { id: 'star', icon: '⭐', weight: 3 }, { id: 'rocket', icon: '🚀', weight: 2 },
];
export const SLOT_PAYS = { cherry: 5, lemon: 10, bell: 18, star: 40, rocket: 100 }; // three of a kind, times the bet
export const SLOT_TWO_CHERRIES = 1.5;                                               // exactly two cherries, times the bet
export const GAMES = {
  coin: { name: 'Coin flip', rule: 'Pick heads or tails. Win 1.9× your bet.', picks: ['heads', 'tails'], pays: 1.9 },
  dice: { name: 'Dice', rule: 'Pick a number from 1 to 6. Win 5.7× your bet.', picks: ['1', '2', '3', '4', '5', '6'], pays: 5.7 },
  slots: { name: 'Slots', rule: 'Three in a row pays 5× to 100× (🚀🚀🚀). Two 🍒 pays 1.5×.', picks: null },
  roulette: { name: 'Roulette', rule: 'Bet on a colour, odd/even, low/high (2×), a dozen (3×) or one number (36×). One green zero.', picks: null },
  blackjack: { name: 'Blackjack', rule: 'Get closer to 21 than the dealer without going over. A win pays 2×, blackjack 2.5×. The dealer stands on 17.', picks: null, table: true },
  rocket: { name: 'Rocket', rule: 'The multiplier climbs as the rocket rises. Cash out before it blows up: 2× or more about half the time, 10× about 1 time in 10.', picks: null, table: true },
  mines: { name: 'Mines', rule: '25 tiles hide gems and mines. Every gem you find raises your winnings; cash out before you hit a mine. More mines, bigger multipliers.', picks: null, table: true },
  baccarat: { name: 'Baccarat', rule: 'Bet on the Player hand, the Banker hand or a tie: whichever ends closer to 9 wins. Player pays 2×, Banker 1.95×, Tie 9× (a tie gives Player and Banker bets back).', picks: ['player', 'banker', 'tie'] },
  hilo: { name: 'Hi-Lo', rule: 'Guess if the next card is higher or lower. Every right guess grows your winnings, more for riskier calls. Cash out any time; one wrong guess loses it all. Aces are low.', picks: null, table: true },
  plinko: { name: 'Plinko', rule: 'Drop a ball through 12 rows of pegs. Where it lands pays 0.1× to 170×; pick low, medium or high risk.', picks: ['low', 'mid', 'high'] },
};
export const MAX_BET = 100000;
// What a slot spin pays, as a multiple of the bet.
export function slotMultiple(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOT_PAYS[a] || 0;
  const cherries = reels.filter(r => r === 'cherry').length;
  return cherries === 2 ? SLOT_TWO_CHERRIES : 0;
}
// ---- Roulette: European wheel, 0–36 ----
export const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const ROULETTE_BETS = { red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1–18', high: '19–36', d1: '1st 12', d2: '2nd 12', d3: '3rd 12' };
export const validRoulette = pick => pick in ROULETTE_BETS || /^n([0-9]|[12][0-9]|3[0-6])$/.test(String(pick));
// What a roulette bet returns (as a multiple of the bet, stake included) when the ball lands on n.
export function rouletteMultiple(pick, n) {
  if (pick.startsWith('n')) return Number(pick.slice(1)) === n ? 36 : 0;
  if (n === 0) return 0;
  switch (pick) {
    case 'red': return ROULETTE_RED.has(n) ? 2 : 0; case 'black': return ROULETTE_RED.has(n) ? 0 : 2;
    case 'odd': return n % 2 ? 2 : 0; case 'even': return n % 2 ? 0 : 2;
    case 'low': return n <= 18 ? 2 : 0; case 'high': return n >= 19 ? 2 : 0;
    case 'd1': return n <= 12 ? 3 : 0; case 'd2': return n >= 13 && n <= 24 ? 3 : 0; case 'd3': return n >= 25 ? 3 : 0;
  }
  return 0;
}
// ---- Blackjack: one deck per hand, no splits; the dealer stands on all 17s ----
export const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export function handValue(cards) {
  let v = 0, aces = 0;
  for (const c of cards) { const r = c.slice(0, -1); if (r === 'A') { aces++; v += 11; } else v += ['J', 'Q', 'K'].includes(r) ? 10 : Number(r); }
  while (v > 21 && aces) { v -= 10; aces--; }
  return v;
}
export const isBlackjack = cards => cards.length === 2 && handValue(cards) === 21;
// ---- Rocket: the multiplier after t seconds of flight, and how long it takes to reach m ----
export const ROCKET_RATE = 0.12, ROCKET_MAX = 100, ROCKET_COUNTDOWN = 3000;
export const rocketAt = t => Math.max(1, Math.floor(100 * Math.exp(ROCKET_RATE * Math.max(0, t))) / 100);
export const rocketTime = m => Math.log(Math.max(1, m)) / ROCKET_RATE;
// Where the rocket blows up: P(it reaches m) = 0.97 / m, so every cash-out target keeps a 3% house edge. u is 0..1.
export const rocketCrash = u => Math.min(ROCKET_MAX, Math.max(1, Math.floor(97 / Math.max(1e-9, 1 - u)) / 100));

// ---- Plinko: 12 rows, 13 slots; each table keeps about a 3% house edge ----
export const PLINKO_ROWS = 12;
const mirror = h => [...h, ...h.slice(0, -1).reverse()];
export const PLINKO = { low: mirror([10, 3, 1.6, 1.4, 1.1, 1, 0.4]), mid: mirror([33, 11, 4, 2, 1, 0.6, 0.3]), high: mirror([170, 24, 8, 2, 0.7, 0.2, 0.1]) };
// ---- Mines: a 5×5 grid. After k gems with m mines, the fair multiplier less 3% ----
export const MINES_TILES = 25, MINES_CHOICES = [1, 3, 5, 10, 20];
export function minesMultiple(mines, safe) {
  let m = 0.97; for (let i = 0; i < safe; i++) m *= (MINES_TILES - i) / (MINES_TILES - mines - i);
  return safe ? Math.floor(m * 100) / 100 : 1;
}

// ---- Baccarat: punto banco from an endless shoe (cards drawn at random) ----
const BAC_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const bacValue = r => r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(r) ? 0 : Number(r);
export const bacTotal = cards => cards.reduce((s, c) => s + bacValue(c.slice(0, -1)), 0) % 10;
export function baccarat(rand) {
  const draw = () => BAC_RANKS[rand(13)] + SUITS[rand(4)], P = [draw(), draw()], B = [draw(), draw()];
  let pt = bacTotal(P), bt = bacTotal(B);
  if (pt < 8 && bt < 8) {
    let third = null; if (pt <= 5) { third = draw(); P.push(third); }
    const t = third == null ? -1 : bacValue(third.slice(0, -1));
    const bankerDraws = third == null ? bt <= 5 : bt <= 2 || (bt === 3 && t !== 8) || (bt === 4 && t >= 2 && t <= 7) || (bt === 5 && t >= 4 && t <= 7) || (bt === 6 && (t === 6 || t === 7));
    if (bankerDraws) B.push(draw());
    pt = bacTotal(P); bt = bacTotal(B);
  }
  return { player: P, banker: B, pt, bt, winner: pt > bt ? 'player' : bt > pt ? 'banker' : 'tie' };
}
export const BAC_PAYS = { player: 2, banker: 1.95, tie: 9 };
// ---- Hi-Lo: ranks 1 (ace) to 13; "higher" wins on the same rank or above, "lower" on the same or below ----
export const hiloRank = card => BAC_RANKS.indexOf(card.slice(0, -1)) + 1;
export const hiloChance = (rank, dir) => dir === 'higher' ? (14 - rank) / 13 : rank / 13;
export const hiloStep = (rank, dir) => Math.floor(0.97 / hiloChance(rank, dir) * 100) / 100; // what a right guess multiplies by

// Play one round. rand(n) must return a whole number from 0 to n-1 (the server passes a secure one).
export function playRound(game, pick, bet, rand) {
  const g = GAMES[game]; if (!g) return null;
  if (game === 'coin') { const result = g.picks[rand(2)]; const won = result === pick; return { result, won, payout: won ? Math.floor(bet * g.pays) : 0 }; }
  if (game === 'roulette') { const result = rand(37), m = rouletteMultiple(String(pick), result); return { result, won: m > 0, payout: Math.floor(bet * m) }; }
  if (game === 'dice') { const result = String(rand(6) + 1); const won = result === String(pick); return { result, won, payout: won ? Math.floor(bet * g.pays) : 0 }; }
  if (game === 'baccarat') { const r = baccarat(rand), x = r.winner === 'tie' && pick !== 'tie' ? 1 : r.winner === pick ? BAC_PAYS[pick] : 0;
    return { result: r, won: x > 1, push: x === 1, payout: Math.floor(bet * x) }; }
  if (game === 'plinko') { const t = PLINKO[pick] || PLINKO.low, path = []; for (let i = 0; i < PLINKO_ROWS; i++) path.push(rand(2));
    const slot = path.reduce((a, b) => a + b, 0), m = t[slot]; return { result: { path, slot, m }, won: m >= 1, payout: Math.floor(bet * m) }; }
  const total = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);
  const spin = () => { let r = rand(total); for (const s of SLOT_SYMBOLS) { if ((r -= s.weight) < 0) return s.id; } return SLOT_SYMBOLS[0].id; };
  const reels = [spin(), spin(), spin()], m = slotMultiple(reels);
  return { result: reels, won: m > 0, payout: Math.floor(bet * m) };
}
