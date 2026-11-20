// Missions: things to do out in the 3D town that pay, and a ladder of ranks that opens them up a few at a time, so a
// new player starts with two simple jobs and something new to look forward to at every rank. The server plans each
// mission (server/missions.js) and checks every arrival against where the player's car really is.
//
// The ladder: XP from every mission finished moves you up a rank; each rank opens one or two new kinds of mission.
export const RANKS = [
  { id: 'newcomer', name: 'Newcomer', icon: '🌱', xp: 0 },
  { id: 'runner', name: 'Runner', icon: '🏃', xp: 120 },
  { id: 'hustler', name: 'Hustler', icon: '💼', xp: 400 },
  { id: 'operator', name: 'Operator', icon: '🕶️', xp: 1000 },
  { id: 'boss', name: 'Boss', icon: '👔', xp: 2200 },
  { id: 'kingpin', name: 'Kingpin', icon: '👑', xp: 4500 },
];
export const rankOf = xp => { let i = 0; for (let k = 0; k < RANKS.length; k++) if ((xp || 0) >= RANKS[k].xp) i = k; return i; };
// how far through this rank you are (0..1), and the XP the next one needs (null at the top)
export function rankProgress(xp) { const i = rankOf(xp), a = RANKS[i].xp, b = RANKS[i + 1]?.xp; return { rank: i, next: b ?? null, frac: b ? Math.max(0, Math.min(1, ((xp || 0) - a) / (b - a))) : 1 }; }

// Every kind of mission, the rank that opens it, and whether it's ready yet (live: false shows it as "coming soon"
// on the ladder, so players can see what's ahead). side: 'work' (honest money) or 'crime'.
export const MISSIONS = {
  parcel: { name: 'Parcel run', icon: '📦', side: 'work', rank: 0, live: true, blurb: 'Collect a parcel and drop it across town before the clock runs out. The quicker you are, the bigger the tip.' },
  taxi: { name: 'Taxi fare', icon: '🚕', side: 'work', rank: 0, live: true, blurb: 'Someone is waiting at the kerb. Pick them up and drive them where they need to go.' },
  race: { name: 'Street race', icon: '🏁', side: 'work', rank: 1, live: true, blurb: 'Through the checkpoints on the town\'s own streets, against the clock. Beat the gold time for the top prize.' },
  hotcar: { name: 'Hot car', icon: '🔑', side: 'crime', rank: 1, live: true, blurb: 'A car someone wants is parked in town. Walk up to it, take it, and get it to the chop shop before the police catch you.' },
  holdup: { name: 'Store hold-up', icon: '🏪', side: 'crime', rank: 2, live: false, blurb: 'Walk into a real store, empty the till, and get away before the police arrive.' },
  heist: { name: 'Crew jobs (heists)', icon: '🕶️', side: 'crime', rank: 3, live: false, blurb: 'Plan a job with your crew: the armoured truck, the Mayor, a jailbreak, the bank.' },
  police: { name: 'Police patrol', icon: '🚓', side: 'work', rank: 3, live: false, blurb: 'Get paid to stop real crimes as they happen, against real players.' },
  bounty: { name: 'Bounties', icon: '🎯', side: 'crime', rank: 4, live: false, blurb: 'Put a price on someone, or hunt the ones on the board.' },
  turf: { name: 'Turf', icon: '🏴', side: 'crime', rank: 5, live: false, blurb: 'Take city blocks for your crew. The shops there pay you every hour.' },
};
export const MISSION_IDS = Object.keys(MISSIONS);
export const openAt = (kind, xp) => !!MISSIONS[kind] && MISSIONS[kind].live && rankOf(xp) >= MISSIONS[kind].rank;
// what a rank opens (for the "You're now a Runner" card)
export const unlocksAt = rank => MISSION_IDS.filter(k => MISSIONS[k].rank === rank);

// The numbers. Distances are map tiles (8 m each). A mission's time limit allows an easy drive there (with turns and
// traffic), and pay grows with how far you go; arriving with time to spare adds a tip of up to half the fare.
export const MISSION = {
  perDay: 40,                 // missions a day that pay (after that: XP only)
  near: 2.6,                  // how close (in tiles, from the edge of the building) counts as "there"
  fastest: 6,                 // tiles a second: nothing on the road gets between two stops quicker than this
  time: { base: 35, perTile: 1.1 },
  pay: { parcel: { base: 45, perTile: 2.6, max: 420 }, taxi: { base: 40, perTile: 3.0, max: 480 } },
  xp: { parcel: { base: 22, perTile: 0.25 }, taxi: { base: 26, perTile: 0.25 } },
  race: { checkpoints: 5, leg: [9, 17], gold: 2.6, silver: 2.1, bronze: 1.6, pay: { base: 70, perTile: 3.2, max: 650 }, medal: { gold: 1, silver: 0.65, bronze: 0.4 }, xp: { base: 30, perTile: 0.3 }, countdown: 3 },
  hotcar: { pay: { base: 160, perTile: 4.2, max: 900 }, xp: { base: 40, perTile: 0.3 }, cars: ['sports', 'gt', 'luxury', 'supercar', 'evsedan', 'suv'], police: 2, after: 6, speed: [2.6, 3.3], lose: 42, catch: 0.9, caught: 2.5 },
  tip: 0.5,                   // up to half the fare again for arriving with lots of time left
  quitCooldown: 20000,        // after giving up on one, a short wait before the next
};
export const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export function missionTime(tiles) { return Math.round(MISSION.time.base + MISSION.time.perTile * tiles); }
export function missionPay(kind, tiles) { const p = MISSION.pay[kind]; return p ? Math.min(p.max, Math.round(p.base + p.perTile * tiles)) : 0; }
export function missionXp(kind, tiles) { const p = MISSION.xp[kind]; return p ? Math.round(p.base + p.perTile * tiles) : 0; }
// the tip for the time left (0..1 of the limit still on the clock)
// a race's medal times (seconds) for a course of D tiles along the roads, and what each medal pays
export function raceTimes(D) { const R0 = MISSION.race; return { gold: Math.round(4 + D / R0.gold), silver: Math.round(6 + D / R0.silver), bronze: Math.round(12 + D / R0.bronze) }; }
export const medalOf = (secs, T) => secs <= T.gold ? 'gold' : secs <= T.silver ? 'silver' : secs <= T.bronze ? 'bronze' : null;
export const MEDALS = { gold: '🥇', silver: '🥈', bronze: '🥉' };
export const tipOf = (fare, left) => Math.round(fare * MISSION.tip * Math.max(0, Math.min(1, left * 1.6 - 0.1)));
// how far a point is from a building's footprint (0 inside it), in tiles
export function offEdge(p, b) { const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h)); return Math.max(dx, dy); }

// there: pulled up on the kerb tile beside it, or right up against the building
export const atStop = (p, s) => (s.kx != null && Math.hypot(p.x - (s.kx + 0.5), p.y - (s.ky + 0.5)) <= 1.8) || offEdge(p, s) <= MISSION.near;

// Today's three goals: small things to aim for each day, from the missions you have open, with a bonus for all three.
export const DAILY = { bonus: { base: 250, perRank: 150, xp: 60 } };
export function dailyGoals(seed, xp) { let h = (seed >>> 0) || 1; const r = () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rank = rankOf(xp), open = MISSION_IDS.filter(k => openAt(k, xp)), pool = [];
  for (const k of open) pool.push({ k: 'do', kind: k, need: k === 'race' || k === 'hotcar' ? 1 : 2 });
  pool.push({ k: 'earn', need: 300 + 200 * rank });
  if (open.includes('race')) pool.push({ k: 'medal', need: 1 });
  const out = []; while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  if (out.length < 3) out.push({ k: 'do', kind: open[0] || 'parcel', need: 3 });
  return out.map(g => ({ ...g, got: 0 })); }
export function goalText(g) { const K = MISSIONS[g.kind]; return g.k === 'do' ? `${K.icon} Finish ${g.need === 1 ? 'a' : g.need} ${K.name.toLowerCase()}${g.need === 1 ? '' : 's'}` : g.k === 'earn' ? `💰 Earn ${g.need.toLocaleString('en-US')} coins from missions` : '🥇 Win a gold medal in a street race'; }
export const dailyBonus = rank => DAILY.bonus.base + DAILY.bonus.perRank * rank;

// What the passenger says (taxi): one line when you pull up, one on the way, one when you drop them off.
export const FARES = [
  { hi: 'Taxi! Over here!', go: 'I\'m running late, step on it!', bye: 'Thanks, keep the change!' },
  { hi: 'Oh good, a cab!', go: 'Nice car. Is it yours?', bye: 'Lovely ride, thank you!' },
  { hi: 'Are you free? Great.', go: 'Don\'t mind me, I\'ll just hold on tight.', bye: 'Made it. You\'re a star.' },
  { hi: 'Finally! I\'ve been waiting ages.', go: 'Left here. No, the other left!', bye: 'Here\'s fine. Cheers!' },
  { hi: 'Hello! Can you take me across town?', go: 'Have you lived here long?', bye: 'Thanks for the chat!' },
];
