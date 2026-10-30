// Achievements: badges colonists earn by playing. Tier 1 bronze, 2 silver, 3 gold (gold ones are announced in the Colony Log).
// Each `group` is a heading in the Badges tab. They're cosmetic: no coins, just bragging rights on your card.
export const ACHIEVEMENTS = [
  { id: 'verified', group: 'Settling in', icon: '✅', name: 'The real me', desc: 'Claim your colonist and set a password.', tier: 1 },
  { id: 'awake', group: 'Settling in', icon: '🛏️', name: 'Wide awake', desc: 'Wake from cryosleep and move into a home.', tier: 1 },
  { id: 'hired', group: 'Settling in', icon: '💼', name: 'On the payroll', desc: 'Get a job.', tier: 1 },
  { id: 'named', group: 'Settling in', icon: '🏷️', name: 'Name tag', desc: 'Give your avatar a name.', tier: 1 },
  { id: 'early', group: 'Settling in', icon: '🚀', name: 'First wave', desc: 'Be one of the first 100 colonists to arrive.', tier: 3 },
  { id: 'k1', group: 'Money', icon: '🪙', name: 'First ten thousand', desc: 'Have 10,000 coins (pocket and bank together).', tier: 1 },
  { id: 'saver', group: 'Money', icon: '🏦', name: 'Saver', desc: 'Keep 50,000 coins in the bank.', tier: 2 },
  { id: 'k50', group: 'Money', icon: '💎', name: 'Tycoon', desc: 'Have 1,000,000 coins.', tier: 3 },
  { id: 'car', group: 'Things you own', icon: '🚗', name: 'Wheels', desc: 'Buy a car.', tier: 1 },
  { id: 'garage', group: 'Things you own', icon: '🏎️', name: 'Full garage', desc: 'Own 3 cars at once.', tier: 2 },
  { id: 'pet', group: 'Things you own', icon: '🐾', name: 'Best friend', desc: 'Adopt a pet.', tier: 1 },
  { id: 'landlord', group: 'Things you own', icon: '🏠', name: 'Landlord', desc: 'Buy a building.', tier: 2 },
  { id: 'mogul', group: 'Things you own', icon: '🏙️', name: 'Property mogul', desc: 'Own 5 buildings at once.', tier: 3 },
  { id: 'casino', group: 'Luck', icon: '🎰', name: "Beginner's luck", desc: 'Win a game at the casino.', tier: 1 },
  { id: 'jackpot', group: 'Luck', icon: '🍒', name: 'Jackpot', desc: 'Win 10,000 coins or more in one casino game.', tier: 3 },
  { id: 'race', group: 'Luck', icon: '🏁', name: 'Picked a winner', desc: 'Back the winning creature in a race.', tier: 1 },
  { id: 'race5', group: 'Luck', icon: '🏆', name: 'Track regular', desc: 'Win 5 race bets.', tier: 2 },
  { id: 'lottery', group: 'Luck', icon: '🎟️', name: 'Lottery winner', desc: 'Win the lottery.', tier: 3 },
  { id: 'gift', group: 'Friends', icon: '🎁', name: 'Generous', desc: 'Send someone a gift.', tier: 1 },
  { id: 'post', group: 'Friends', icon: '📣', name: 'Town crier', desc: 'Post in the Town Square.', tier: 1 },
  { id: 'chat', group: 'Friends', icon: '💬', name: 'Social butterfly', desc: 'Message 5 different colonists.', tier: 2 },
  { id: 'streak7', group: 'Coming back', icon: '🔥', name: 'Week streak', desc: 'Collect your daily reward 7 days in a row.', tier: 2 },
  { id: 'streak30', group: 'Coming back', icon: '☄️', name: 'Month streak', desc: 'Collect your daily reward 30 days in a row.', tier: 3 },
  { id: 'crime', group: 'On the wrong side', icon: '🦹', name: 'Smooth operator', desc: 'Get away with a crime.', tier: 2 },
  { id: 'jail', group: 'On the wrong side', icon: '🚔', name: 'Jailbird', desc: 'Get caught and locked up.', tier: 1 },
];
export const BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
export const TIER_NAMES = { 1: 'Bronze', 2: 'Silver', 3: 'Gold' };

// Which badges these facts earn. f = facts about one colonist (see server/achievements.js).
export function earned(f) {
  const s = f.stats || {}, total = f.coins + f.bank, out = [];
  const add = (id, yes) => { if (yes) out.push(id); };
  add('verified', f.verified); add('awake', f.home); add('hired', f.job); add('named', f.named); add('early', f.seq > 0 && f.seq <= 100);
  add('k1', total >= 10000); add('saver', f.bank >= 50000); add('k50', total >= 1000000);
  add('car', f.cars >= 1 || s.cars_bought > 0); add('garage', f.cars >= 3); add('pet', f.pet || s.pets > 0);
  add('landlord', f.props >= 1 || s.bought > 0); add('mogul', f.props >= 5);
  add('casino', s.casino_wins > 0); add('jackpot', s.casino_best >= 10000);
  add('race', f.raceWins >= 1); add('race5', f.raceWins >= 5); add('lottery', f.lottery >= 1);
  add('gift', s.gifts > 0); add('post', f.posts >= 1); add('chat', f.dmPeople >= 5);
  add('streak7', f.dailyBest >= 7); add('streak30', f.dailyBest >= 30);
  add('crime', s.crimes > 0); add('jail', s.jailed > 0);
  return out;
}
