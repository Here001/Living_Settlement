// Fight Night at the Colosseum: the fighters, how a bout plays out, and the odds.
// Shared by the server (which rolls each bout once, at the bell) and the browser (which shows everyone the same bout
// from the result: the exchanges, the health bars, the knockdowns and the decision).

export const ROUNDS = 3, ROUND_S = 22, BREAK_S = 4; // seconds per round on screen, and between rounds
export const BOUT_LEN_S = ROUNDS * ROUND_S + (ROUNDS - 1) * BREAK_S + 6; // + the walk-out and the verdict
export const BOUTS = [ // the card, first fight first: the main event is last
  { key: 'opener', name: 'Opening bout', purse: 800, show: 200 },
  { key: 'co', name: 'Co-main event', purse: 2000, show: 500 },
  { key: 'main', name: 'Main event', purse: 5000, show: 1200 },
];
export const STYLES = {
  boxer: { name: 'Boxer', icon: '🥊', moves: ['jab', 'cross', 'hook', 'uppercut'] },
  kicker: { name: 'Kickboxer', icon: '🦵', moves: ['jab', 'kick', 'knee', 'spinning kick'] },
  grappler: { name: 'Wrestler', icon: '🤼', moves: ['takedown', 'body shot', 'slam', 'elbow'] },
  brawler: { name: 'Brawler', icon: '💥', moves: ['haymaker', 'hook', 'headbutt', 'body shot'] },
};
export const STYLE_IDS = Object.keys(STYLES);
export const NICKS = ['The Hammer', 'Thunder', 'Iron Fist', 'The Storm', 'Lightning', 'The Bull', 'Quicksilver', 'The Wall', 'Big Smoke', 'The Viper',
  'Mama Africa', 'Oga Boss', 'The Lion', 'Small but Mighty', 'Ice Cold', 'The Rocket', 'Danger', 'The Professor', 'Wahala', 'Gbas Gbos'];

export function hashStr(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
export function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// A fighter's make-up comes from who they are (so a colonist always fights the same way) and their record: every win
// makes them a little sharper. Power hits harder, speed lands more often, chin takes more punishment.
export function fighterOf(id, handle, rec = {}) {
  const h = hashStr('fighter:' + id), r = seeded(h), wins = rec.wins || 0, losses = rec.losses || 0;
  const edge = Math.min(0.18, wins * 0.025) - Math.min(0.08, losses * 0.01);
  const stat = () => Math.max(0.2, Math.min(0.98, 0.42 + r() * 0.4 + edge));
  return { id, handle, style: STYLE_IDS[h % STYLE_IDS.length], nick: NICKS[(h >>> 4) % NICKS.length], power: stat(), speed: stat(), chin: stat(),
    wins, losses, kos: rec.kos || 0, rating: Math.round(rec.rating || 1000) };
}

// One bout. Each round is a run of exchanges; a clean hit takes health, a big one can knock a fighter down, three
// knockdowns (or no health left) end it. If both are standing after three rounds, the judges score it on damage done.
// Returns the winner, how ('KO', 'TKO' or a decision), and the timeline the browser plays.
export function fight(a, b, rand = Math.random) {
  const F = [a, b], hp = [100, 100], downs = [0, 0], dealt = [0, 0], ev = [];
  let end = null;
  for (let round = 1; round <= ROUNDS && !end; round++) {
    const t0 = 3 + (round - 1) * (ROUND_S + BREAK_S);
    ev.push({ t: t0, k: 'bell', round });
    let t = t0 + 1;
    while (t < t0 + ROUND_S - 1 && !end) {
      t += 0.9 + rand() * 1.4;
      // who throws: the quicker fighter more often
      const i = rand() < 0.5 + (F[0].speed - F[1].speed) * 0.25 ? 0 : 1, o = 1 - i, me = F[i], them = F[o];
      const moves = STYLES[me.style].moves, move = moves[Math.floor(rand() * moves.length)];
      const land = rand() < 0.45 + (me.speed - them.speed) * 0.2;
      if (!land) { ev.push({ t: +t.toFixed(2), k: rand() < 0.5 ? 'miss' : 'block', by: i, move }); continue; }
      const big = rand() < 0.1 + me.power * 0.12;
      const dmg = Math.round((4 + me.power * 9) * (big ? 2.1 : 1) * (1.25 - them.chin * 0.5) * (0.75 + rand() * 0.5));
      hp[o] = Math.max(0, hp[o] - dmg); dealt[i] += dmg;
      const down = hp[o] <= 0 || (big && rand() < 0.35 + me.power * 0.25 - them.chin * 0.25);
      ev.push({ t: +t.toFixed(2), k: big ? 'big' : 'hit', by: i, move, dmg, hp: [...hp] });
      if (down) {
        downs[o]++; t += 0.6; ev.push({ t: +t.toFixed(2), k: 'down', who: o, n: downs[o] });
        if (hp[o] <= 0 || downs[o] >= 3) { end = { winner: i, method: hp[o] <= 0 ? 'KO' : 'TKO', round, at: +(t - t0).toFixed(1) }; ev.push({ t: +(t + 1.2).toFixed(2), k: 'end', ...end }); break; }
        hp[o] = Math.min(100, hp[o] + 12); t += 2.4; ev.push({ t: +t.toFixed(2), k: 'up', who: o, hp: [...hp] }); // beats the count, a little recovered
      }
    }
    if (!end && round < ROUNDS) { for (const k of [0, 1]) hp[k] = Math.min(100, hp[k] + 6); ev.push({ t: t0 + ROUND_S, k: 'rest', round, hp: [...hp] }); }
  }
  if (!end) {
    const score = k => dealt[k] - downs[k] * 12 + (rand() - 0.5) * 8, w = score(0) >= score(1) ? 0 : 1, close = Math.abs(dealt[0] - dealt[1]) < 12;
    end = { winner: w, method: close ? 'Split decision' : 'Decision', round: ROUNDS, at: ROUND_S };
    ev.push({ t: 3 + (ROUNDS - 1) * (ROUND_S + BREAK_S) + ROUND_S + 1, k: 'end', ...end });
  }
  return { ...end, events: ev, hp, downs, dealt, len: Math.min(BOUT_LEN_S, Math.ceil(ev[ev.length - 1].t + 4)) };
}

// The odds: each bout is simulated many times with a fixed seed, so every server shows the same price.
export function oddsFor(a, b, seed) {
  const rand = seeded(seed); let wa = 0; const N = 400;
  for (let i = 0; i < N; i++) if (fight(a, b, rand).winner === 0) wa++;
  const pa = Math.min(0.9, Math.max(0.1, wa / N)), pay = p => Math.max(1.1, Math.round(0.9 / p * 10) / 10);
  return { a: { chance: +pa.toFixed(3), pays: pay(pa) }, b: { chance: +(1 - pa).toFixed(3), pays: pay(1 - pa) } };
}

// Ratings move after each bout (an upset moves them more), like chess ratings.
export function rate(ra, rb, aWon) { const ea = 1 / (1 + 10 ** ((rb - ra) / 400)), k = 32, s = aWon ? 1 : 0; return [Math.round(ra + k * (s - ea)), Math.round(rb + k * ((1 - s) - (1 - ea)))]; }

// The commentary line for one moment of the timeline (the browser shows these under the ring).
export function callOf(e, names) {
  const n = i => names[i], o = i => names[1 - i], a = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
  switch (e.k) {
    case 'bell': return `🔔 Round ${e.round}!`;
    case 'miss': return `${n(e.by)} throws ${a(e.move)}… and misses.`;
    case 'block': return `${o(e.by)} blocks ${n(e.by)}'s ${e.move}.`;
    case 'hit': return `${n(e.by)} lands ${a(e.move)}!`;
    case 'big': return `💥 HUGE ${e.move} from ${n(e.by)}!`;
    case 'down': return `⬇️ ${n(e.who)} is DOWN! ${e.n > 1 ? `That's knockdown number ${e.n}!` : 'The referee starts the count…'}`;
    case 'up': return `${n(e.who)} beats the count and fights on!`;
    case 'rest': return `End of round ${e.round}. Back to the corners.`;
    case 'end': return e.method === 'KO' ? `🏆 KNOCKOUT! ${n(e.winner)} wins in round ${e.round}!` : e.method === 'TKO' ? `🏆 The referee waves it off! ${n(e.winner)} wins by TKO in round ${e.round}!` : `🏆 ${n(e.winner)} wins by ${e.method.toLowerCase()}!`;
    default: return '';
  }
}
