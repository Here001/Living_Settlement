// The Game House's games, shared by the server (which decides every result) and the browser (which draws them).
// Every game keeps a small edge for the house (the colony treasury), so it can't be farmed for coins.

export const GH_GAMES = {
  wheel: { name: 'Lucky wheel', icon: '🎡', rule: 'One free spin every day. Paid spins win 0× to 8× your bet.' },
  scratch: { name: 'Scratch cards', icon: '🎟️', rule: 'Buy a card and scratch it. Three matching symbols win: 🍀 1×, ⭐ 2×, 💎 5×, 🚀 20×, 👑 100× the card.' },
  penalty: { name: 'Penalty shootout', icon: '⚽', rule: 'Five kicks against the keeper. Pick a spot for each kick: corners are harder to save but easier to miss. 5 goals pays 3.5×, 4 goals gives your bet back.' },
  darts: { name: 'Darts', icon: '🎯', rule: 'Three darts. Tap where to aim; your hand wobbles a little. Score 140+ for 20×, 100+ for 5×, 80+ for 2×, 60+ for 1.5×.' },
  snooker: { name: 'Snooker', icon: '🎱', rule: 'Practice: pot 3 reds in 6 shots to win 3×. Or challenge another player for a stake.' },
  whot: { name: 'Whot', icon: '🃏', rule: 'Match the shape or number of the card on the pile. First to empty their hand wins the pot.' },
  ludo: { name: 'Ludo', icon: '🎲', rule: 'Race your four pieces home. Roll a 6 to come out. Land on someone to send them back.' },
  ayo: { name: 'Ayo', icon: '🥥', rule: 'Sow seeds round the board; capture when your last seed makes two or three. Most seeds wins.' },
};
export const GH_MAX_BET = 20000; // skill games stay small-stakes

// ---- Lucky wheel ----
// Paid spins: 24 equal slices, about 96% back on average.
export const WHEEL_PAID = [0, 0.5, 0, 1, 0, 1.5, 0, 0.5, 2, 0, 1, 0, 3, 0, 0.5, 0, 1.5, 0, 2, 0, 1, 0, 8, 0];
// The free daily spin: coins, not a multiple.
export const WHEEL_FREE = [50, 100, 250, 100, 500, 150, 1000, 100, 200, 5000, 150, 300];

// ---- Scratch cards: the prize is drawn first, then a card is laid out to show it ----
export const SCRATCH_TIERS = [200, 1000, 5000];
export const SCRATCH_SYMBOLS = { clover: { icon: '🍀', x: 1 }, star: { icon: '⭐', x: 2 }, gem: { icon: '💎', x: 5 }, rocket: { icon: '🚀', x: 20 }, crown: { icon: '👑', x: 100 } };
// Chance of each prize per card (the rest win nothing): about 88% back on average.
export const SCRATCH_ODDS = [['clover', 0.12], ['star', 0.08], ['gem', 0.04], ['rocket', 0.015], ['crown', 0.001]];
export function scratchCard(rand) { // rand() → 0..1
  let r = rand(), win = null; for (const [k, p] of SCRATCH_ODDS) { if (r < p) { win = k; break; } r -= p; }
  const keys = Object.keys(SCRATCH_SYMBOLS), cells = [], count = {};
  if (win) { for (let i = 0; i < 3; i++) cells.push(win); count[win] = 3; }
  while (cells.length < 9) { const k = keys[Math.floor(rand() * keys.length)]; if ((count[k] || 0) >= 2) continue; count[k] = (count[k] || 0) + 1; cells.push(k); }
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  return { cells, win, x: win ? SCRATCH_SYMBOLS[win].x : 0 };
}

// ---- Penalty shootout: 6 spots (left, centre, right × low, high) ----
export const PEN_SPOTS = ['ll', 'cl', 'rl', 'lh', 'ch', 'rh']; // column + height
export const PEN_MISS = { ll: 0.08, cl: 0.02, rl: 0.08, lh: 0.2, ch: 0.08, rh: 0.2 }; // off target (wide, over, the post)
export const PEN_PAYS = { 5: 3.5, 4: 1 };
// Where the keeper dives. This mix is the keeper's best guess against any player: every spot goes in about 69% of
// the time, so no way of shooting beats the payouts (about 92% back on average).
export const KEEPER = { ll: 0.26, cl: 0.25, rl: 0.26, lh: 0.035, ch: 0.16, rh: 0.035 };
// One kick: where the keeper went and whether it went in. rand() → 0..1.
export function kick(spot, rand) {
  const miss = rand() < PEN_MISS[spot]; let r = rand(), dive = 'cl';
  for (const [d, p] of Object.entries(KEEPER)) { if (r < p) { dive = d; break; } r -= p; }
  const reach = dive[0] === spot[0] ? (dive[1] === spot[1] ? 0.9 : 0.4) : 0, saved = !miss && rand() < reach;
  return { spot, keeper: dive, miss, saved, goal: !miss && !saved };
}

// ---- Darts: a standard board, radius 1. The server adds a wobble to your aim ----
export const DART_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const DART_RINGS = { bull: 0.037, outer: 0.094, tripleIn: 0.582, tripleOut: 0.629, doubleIn: 0.953 };
export const DART_WOBBLE = 0.13, DART_PAYS = [[140, 20], [100, 5], [80, 2], [60, 1.5]];
export function dartScore(x, y) { // x right, y up
  const r = Math.hypot(x, y); if (r > 1) return { score: 0, label: 'Miss' };
  if (r < DART_RINGS.bull) return { score: 50, label: 'Bull' };
  if (r < DART_RINGS.outer) return { score: 25, label: '25' };
  const ang = (Math.atan2(x, y) * 180 / Math.PI + 360 + 9) % 360, n = DART_ORDER[Math.floor(ang / 18)];
  if (r >= DART_RINGS.tripleIn && r < DART_RINGS.tripleOut) return { score: n * 3, label: `T${n}` };
  if (r >= DART_RINGS.doubleIn) return { score: n * 2, label: `D${n}` };
  return { score: n, label: String(n) };
}
export const dartsPays = total => { for (const [min, x] of DART_PAYS) if (total >= min) return x; return 0; };
// Gaussian wobble from two uniform numbers.
export function wobble(rand) { const u = Math.max(1e-9, rand()), v = rand(), m = Math.sqrt(-2 * Math.log(u)) * DART_WOBBLE; return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)]; }
