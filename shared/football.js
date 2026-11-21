// Games at the Stadiums. Every finished Stadium runs its own programme on the clock, the same for everyone watching:
// a football match (two colony teams, 90 minutes played out in about 8 real minutes), and at half time a 100 m sprint
// on the running track round the pitch. Nothing is stored: a stadium's fixture, the goals, who scores and the sprint's
// finishing order all follow from its id and the match number, so every phone in the stands sees the same game.
// Times are in milliseconds from the start of the cycle.
export const MATCH_EVERY = 15 * 60 * 1000;            // a new match every 15 minutes
export const WALKOUT = 60 * 1000;                     // the teams walk out, the anthem, then kick-off
export const HALF = 4 * 60 * 1000;                    // each half: 45 game minutes in 4 real minutes
export const BREAK = 60 * 1000;                       // half time (the sprint is run in it)
export const SPRINT_AT = WALKOUT + HALF + 15 * 1000, SPRINT_LEN = 12 * 1000;
export const KICKOFF2 = WALKOUT + HALF + BREAK, FULL = KICKOFF2 + HALF; // full time: 10 minutes in; the rest of the cycle is the build-up to the next game
export const TEAMS = [
  { k: 'harbour', name: 'Harbour Rovers', short: 'HAR', shirt: '#1F5FAF', shorts: '#FFFFFF', str: 78 },
  { k: 'quarry', name: 'Quarry United', short: 'QRY', shirt: '#B83227', shorts: '#1B1B1B', str: 74 },
  { k: 'orchard', name: 'Orchard Town', short: 'ORC', shirt: '#2E8B57', shorts: '#F2F2F2', str: 70 },
  { k: 'ridge', name: 'Ridge Athletic', short: 'RDG', shirt: '#F2C230', shorts: '#1E2A44', str: 72 },
  { k: 'foundry', name: 'Foundry FC', short: 'FDY', shirt: '#2B2B2B', shorts: '#E8E8E8', str: 76 },
  { k: 'lantern', name: 'Lantern City', short: 'LAN', shirt: '#7FB3E6', shorts: '#FFFFFF', str: 80 },
  { k: 'marsh', name: 'Marshside', short: 'MAR', shirt: '#6B3FA0', shorts: '#F2F2F2', str: 66 },
  { k: 'beacon', name: 'Beacon Wanderers', short: 'BEA', shirt: '#E87722', shorts: '#1B1B1B', str: 71 },
];
export const SPRINTERS = ['Ada Swift', 'Kofi Blaze', 'Mira Dash', 'Juno Pace', 'Tomas Bolt', 'Lena Gale', 'Ravi Streak', 'Zara Flint', 'Obi Comet', 'Nell Rush', 'Ivo Spark', 'Suki Jet'];
const SURNAMES = ['Okafor', 'Silva', 'Novak', 'Mensah', 'Reyes', 'Kowal', 'Adeyemi', 'Haddad', 'Brennan', 'Tanaka', 'Moreau', 'Osei', 'Lund', 'Costa', 'Ibeh', 'Varga'];

// a small seeded random number generator (the same seed gives the same numbers on every phone and on the server)
export function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// a stadium's clock: its own offset (by its id) so stadiums don't all kick off at once
export const offsetOf = id => (hash('stadium:' + id) % 15) * 60 * 1000;
export const matchNo = (id, now = Date.now()) => Math.floor((now - offsetOf(id)) / MATCH_EVERY);
export const startOf = (id, n) => n * MATCH_EVERY + offsetOf(id);
// the game minute shown on the scoreboard at t (ms into the cycle), or null before kick-off / after full time
export function minuteAt(t) { if (t < WALKOUT) return null; if (t < WALKOUT + HALF) return Math.floor((t - WALKOUT) / HALF * 45); if (t < KICKOFF2) return 45; if (t < FULL) return 45 + Math.floor((t - KICKOFF2) / HALF * 45); return 90; }
// the real time (ms into the cycle) of a game minute
export const timeOfMinute = m => m < 45 ? WALKOUT + m / 45 * HALF : KICKOFF2 + (m - 45) / 45 * HALF;

// match n at a stadium: the teams, their squads, the goals (minute, side, scorer) and the half-time sprint
export function matchOf(id, n) {
  const r = rng(hash(id + ':' + n)), i = Math.floor(r() * TEAMS.length); let j = Math.floor(r() * (TEAMS.length - 1)); if (j >= i) j++;
  const home = TEAMS[i], away = TEAMS[j], squad = (t, s) => Array.from({ length: 11 }, (_, k) => ({ no: k === 0 ? 1 : k + 1, name: SURNAMES[(hash(t.k + s + k) + k) % SURNAMES.length] }));
  const sq = [squad(home, 'h'), squad(away, 'a')], goals = [];
  // goals: each side gets a few chances a game, its strength (and home advantage) decides how many go in
  for (const side of [0, 1]) { const t = side ? away : home, p = (t.str + (side ? 0 : 4)) / 100 * 0.32, tries = 7;
    for (let k = 0; k < tries; k++) if (r() < p) { const minute = 1 + Math.floor(r() * 89), who = 1 + Math.floor(r() * 10); goals.push({ minute, side, no: sq[side][who].no, name: sq[side][who].name }); } }
  goals.sort((a, b) => a.minute - b.minute); for (let k = 1; k < goals.length; k++) if (goals[k].minute <= goals[k - 1].minute) goals[k].minute = Math.min(90, goals[k - 1].minute + 1);
  // the half-time sprint: eight runners, each with a time (the fastest wins)
  const pick = [...SPRINTERS].sort((a, b) => hash(a + n + id) - hash(b + n + id)).slice(0, 8), sprint = pick.map((name, lane) => ({ lane, name, time: +(9.7 + r() * 0.9).toFixed(2) }));
  const score = [goals.filter(g => !g.side).length, goals.filter(g => g.side).length];
  return { n, home, away, squads: sq, goals, score, sprint, winner: score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1 };
}
// the score at t (ms into the cycle)
export function scoreAt(m, t) { const s = [0, 0]; for (const g of m.goals) if (timeOfMinute(g.minute) <= t) s[g.side]++; return s; }
// what's on at a stadium now: the match, how far in, and the phase (walkout, first, half, second, full)
export function nowAt(id, now = Date.now()) { const n = matchNo(id, now), t = now - startOf(id, n), m = matchOf(id, n);
  const phase = t < WALKOUT ? 'walkout' : t < WALKOUT + HALF ? 'first' : t < KICKOFF2 ? 'half' : t < FULL ? 'second' : 'full';
  return { n, t, phase, match: m, minute: minuteAt(t), score: scoreAt(m, t), start: startOf(id, n), next: startOf(id, n + 1) }; }
