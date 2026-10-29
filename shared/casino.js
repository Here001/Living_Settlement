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
};
export const MAX_BET = 100000;
// What a slot spin pays, as a multiple of the bet.
export function slotMultiple(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOT_PAYS[a] || 0;
  const cherries = reels.filter(r => r === 'cherry').length;
  return cherries === 2 ? SLOT_TWO_CHERRIES : 0;
}
// Play one round. rand(n) must return a whole number from 0 to n-1 (the server passes a secure one).
export function playRound(game, pick, bet, rand) {
  const g = GAMES[game]; if (!g) return null;
  if (game === 'coin') { const result = g.picks[rand(2)]; const won = result === pick; return { result, won, payout: won ? Math.floor(bet * g.pays) : 0 }; }
  if (game === 'dice') { const result = String(rand(6) + 1); const won = result === String(pick); return { result, won, payout: won ? Math.floor(bet * g.pays) : 0 }; }
  const total = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);
  const spin = () => { let r = rand(total); for (const s of SLOT_SYMBOLS) { if ((r -= s.weight) < 0) return s.id; } return SLOT_SYMBOLS[0].id; };
  const reels = [spin(), spin(), spin()], m = slotMultiple(reels);
  return { result: reels, won: m > 0, payout: Math.floor(bet * m) };
}
