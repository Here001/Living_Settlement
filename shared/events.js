// Colony events: something happens in the colony for a while and changes what's worth doing.
// The server starts one every 2–4 real hours (none overlap), or the developer starts one on demand.
export const COLONY_EVENTS = {
  festival: { icon: '🎉', name: 'Festival', mins: 30, text: 'A festival fills the streets! Shifts, deliveries, fishing, foraging and scavenging all pay 1.5×.', short: 'Earnings ×1.5' },
  frenzy:   { icon: '🐟', name: 'Fishing frenzy', mins: 25, text: 'The fish are jumping! Bites come fast and every catch sells for double.', short: 'Fish pay ×2', needs: 'water' },
  meteor:   { icon: '☄️', name: 'Meteor shower', mins: 25, text: 'Meteorites are falling near the landing station! Scavenging takes half the time with no wait between searches, and finds are worth double.', short: 'Scavenging ×2', needs: 'landing' },
  storm:    { icon: '⛈️', name: 'Great storm', mins: 20, text: "A great storm rolls in! It's too wild to fish or forage, but deliveries pay 1.5× hazard money.", short: 'Deliveries ×1.5' },
  crimewave:{ icon: '🦹', name: 'Crime wave', mins: 20, text: "There's a crime wave! Thieves get away more often, so keep an eye on your pockets.", short: 'Crime pays more often' },
  supply:   { icon: '📦', name: 'Supply drop', mins: 15, text: 'A supply pod has landed! The first 15 colonists to claim it in the Earn tab get 300 to 900 coins each.', short: 'Free supplies', needs: 'landing', claims: 15 },
};
// How much an event multiplies a kind of earning (shifts, gigs, fish, forage, scavenged).
export function earnBoost(kind, what) {
  if (kind === 'festival') return 1.5;
  if (kind === 'frenzy' && what === 'fish') return 2;
  if (kind === 'meteor' && what === 'scavenged') return 2;
  if (kind === 'storm' && what === 'gigs') return 1.5;
  return 1;
}
