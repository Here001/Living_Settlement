// The native animals of Gliese 12 b: raced at the Racetrack and kept as pets.
// speed: how fast on an average day · wobble: how unpredictable (higher = more surprises)
// weather: how each kind of day changes their speed
export const CREATURES = {
  starcrest:  { name: 'Starcrest',  blurb: 'A long-necked runner with a glowing crest. Good in any weather.', speed: 0.96, wobble: 0.07, weather: {}, color: '#8E6CC9', accent: '#F2B33D' },
  dustrunner: { name: 'Dustrunner', blurb: 'A six-legged desert lizard. Blazing in the sun, sluggish in the wet.', speed: 0.93, wobble: 0.09, weather: { sunny: 0.04, rain: -0.05, storm: -0.06 }, color: '#D9824A', accent: '#7A3E1E' },
  skyskimmer: { name: 'Skyskimmer', blurb: 'A gliding moth-bird. Flies on clear days, grounded by storms.', speed: 0.92, wobble: 0.09, weather: { sunny: 0.05, cloudy: 0.02, fog: -0.04, rain: -0.06, storm: -0.12 }, color: '#5FA8C9', accent: '#E8F4F8' },
  mudgulper:  { name: 'Mudgulper',  blurb: 'A fat swamp hopper. Loves rain, hates the heat.', speed: 0.90, wobble: 0.09, weather: { rain: 0.09, storm: 0.06, fog: 0.03, sunny: -0.04 }, color: '#6E8B4A', accent: '#C7B26A' },
  ironshell:  { name: 'Ironshell',  blurb: 'An armoured roller. Slow, steady, never far behind.', speed: 0.92, wobble: 0.04, weather: { storm: 0.04, rain: 0.01 }, color: '#7C8288', accent: '#B9BEC3' },
  glimmerhop: { name: 'Glimmerhop', blurb: 'A glowing hopper with a mind of its own. Anything can happen.', speed: 0.86, wobble: 0.17, weather: { fog: 0.06 }, color: '#3FBFA0', accent: '#C8FFF0' },
};
export const CREATURE_IDS = Object.keys(CREATURES);
// How fast a creature runs today, before luck.
export const formOf = (id, weather) => CREATURES[id].speed + (CREATURES[id].weather[weather] || 0);
// One race: each runner's performance = form + luck. rand() returns 0..1. Highest performance wins.
export function runRace(ids, weather, rand) {
  const gauss = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  return ids.map(id => ({ id, p: formOf(id, weather) + gauss() * CREATURES[id].wobble })).sort((a, b) => b.p - a.p);
}
// Win chances from many simulated races (seeded, so every server gets the same odds), and the payout for a win.
export function oddsFor(ids, weather, seed) {
  let s = seed >>> 0; const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const wins = Object.fromEntries(ids.map(id => [id, 0])), N = 6000;
  for (let i = 0; i < N; i++) wins[runRace(ids, weather, rand)[0].id]++;
  const out = {};
  for (const id of ids) { const p = Math.max(0.01, wins[id] / N); out[id] = { chance: p, pays: Math.max(1.2, Math.min(40, Math.floor(0.9 / p * 10) / 10)) }; }
  return out;
}

// ---- How a race looks while it's run (the result is already decided; this only shapes the running) ----
// Each kind has a racing style: its relative speed through ten stretches of the lap. Each race adds its own luck,
// so leads change hands: front-runners fade, closers come late, Glimmerhop stalls and leaps.
export const STYLES = {
  starcrest:  { name: 'Front-runner', pace: [1.35, 1.3, 1.2, 1.1, 1.0, 0.95, 0.9, 0.88, 0.85, 0.85], luck: 0.12 },
  dustrunner: { name: 'Sprinter',     pace: [1.0, 1.05, 1.3, 0.85, 1.25, 0.8, 1.2, 0.9, 1.15, 1.1], luck: 0.18 },
  skyskimmer: { name: 'Glider',       pace: [0.9, 1.2, 0.85, 1.25, 0.85, 1.25, 0.9, 1.2, 0.95, 1.1], luck: 0.15 },
  mudgulper:  { name: 'Closer',       pace: [0.7, 0.75, 0.8, 0.85, 0.95, 1.0, 1.1, 1.25, 1.4, 1.5], luck: 0.12 },
  ironshell:  { name: 'Steady',       pace: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], luck: 0.05 },
  glimmerhop: { name: 'Unpredictable', pace: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], luck: 0.6 },
};
export function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const hashStr = str => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// The share of the lap covered at the end of each of the ten stretches (0 … 1), for one runner in one race.
export function paceCurve(id, seed) {
  const S = STYLES[id] || STYLES.ironshell, rand = seeded(seed ^ hashStr(id)), out = [0]; let sum = 0;
  const v = S.pace.map(p => { let x = p * (1 + (rand() * 2 - 1) * S.luck); if (S.luck > 0.4 && rand() < 0.18) x *= 0.25; if (S.luck > 0.4 && rand() < 0.15) x *= 1.9; return Math.max(0.15, x); });
  for (const x of v) { sum += x; out.push(sum); }
  return out.map(d => d / sum);
}
// Which creatures run in a race: usually five of the six (a different one sits out each time), sometimes all six.
export function fieldFor(seed) {
  const rand = seeded(seed ^ 0x51ed), ids = CREATURE_IDS.slice();
  if (rand() < 0.3) return ids;
  ids.splice(Math.floor(rand() * ids.length), 1); return ids;
}
