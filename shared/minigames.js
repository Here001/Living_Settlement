// Crime mini games: short full-screen games that decide how a solo crime goes.
// Everything that decides a result lives here and is shared: the browser plays the game with these rules, and the
// server replays what the player did with the very same rules before paying anything out. A game's level comes from a
// seed the server picks, so nobody can choose an easy one, and nothing the browser reports is taken on trust.
//
//   rob  → Cut-away stealth: sneak into the shop, empty the till, get out unseen.
//   scam → Smooth talker: win a tourist's trust before they smell a rat.
//   atm  → Wire & code: rewire the cash machine, then crack the PIN before the alarm goes.
//
// Score out of 100: your play is worth up to 60 points, the setting (how far the police are, night, a crime wave) up to 40.

export const GAMES = { rob: 'stealth', scam: 'con', atm: 'atm' };
export const STEP = 0.1; // the stealth game moves in steps of a tenth of a second, on the phone and on the server alike

export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Difficulty 1 (easy) to 5 (hard): each crime has its own base, and police close by make it harder.
const BASE = { rob: 2, scam: 1, atm: 3 };
export function difficultyOf(kind, band) { return clamp((BASE[kind] || 2) + (band === 'low' ? 1 : band === 'high' ? -1 : 0), 1, 5); }

export function scoreOf(perf, chance) {
  const play = Math.round(clamp(Number(perf) || 0, 0, 1) * 60), setting = Math.round(clamp((Number(chance) || 0) / 0.9, 0, 1) * 40);
  return { play, setting, total: play + setting };
}
// What the score means. `mult` is how much of the takings you keep (a great score pays up to 1.5×).
export function outcomeOf(total, gotMoney = true) {
  if (total >= 80 && gotMoney) return { key: 'clean', mult: +(1 + (total - 80) / 20 * 0.5).toFixed(3), title: 'Clean getaway' };
  if (total >= 60 && gotMoney) return { key: 'partial', mult: +(0.3 + (total - 60) / 20 * 0.6).toFixed(3), title: 'Got away with some of it' };
  if (total >= 40) return { key: 'empty', mult: 0, title: 'Got away, empty-handed' };
  if (total >= 20) return { key: 'fined', mult: 0, title: 'Caught and fined' };
  return { key: 'jailed', mult: 0, title: 'Caught, fined and jailed' };
}

// ======================= Cut-away stealth (rob a shop) =======================
// A shop seen from above with the walls cut away. Shelves block the way and the view; the shopkeeper (and, in harder
// shops, a guard) walk a round; cameras sweep. Being in someone's view fills the "seen" meter; full means you're spotted.
// Get to the till, stay by it while you empty it, then leave by the back door you came in.
export const STEALTH = { speed: 3.2, grab: 1.5, grabR: 0.95, exitR: 0.8, fill: 1.25, fillD: 0.22, drain: 0.5,
  guardFov: 0.62, guardRange: 3.4, camFov: 0.4, camRange: 4.6 };

export function genStealth(seed, diff) {
  for (let k = 0; k < 40; k++) { const L = tryStealth(seed + k * 7919, diff); if (L) return L; }
  return tryStealth(1, 1, true);
}
function tryStealth(seed, diff, plain) {
  const r = rng(seed), W = 9 + Math.min(3, diff), H = 8 + Math.min(2, Math.floor(diff / 2)), wall = new Uint8Array(W * H);
  const at = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y * W + x] === 1;
  const entry = { x: 0.5, y: H - 0.5 }, till = { x: W - 2.5, y: 1.5 };
  // shelves: short runs, never next to the door or the till
  if (!plain) { const n = 5 + diff * 2;
    for (let i = 0; i < n; i++) { const horiz = r() < 0.5, len = 1 + Math.floor(r() * 3), x0 = 1 + Math.floor(r() * (W - 2)), y0 = 1 + Math.floor(r() * (H - 2));
      for (let j = 0; j < len; j++) { const x = horiz ? x0 + j : x0, y = horiz ? y0 : y0 + j; if (x >= W - 1 || y >= H - 1) continue;
        if (Math.hypot(x + 0.5 - entry.x, y + 0.5 - entry.y) < 2.2 || Math.hypot(x + 0.5 - till.x, y + 0.5 - till.y) < 1.8) continue; wall[y * W + x] = 1; } } }
  // the counter the till sits on
  wall[0 * W + (W - 3)] = 2; wall[0 * W + (W - 2)] = 2;
  const L = { seed, diff, W, H, wall: Array.from(wall), entry, till, guards: [], cams: [], limit: 52 - diff * 4 };
  if (!pathCells(L, cell(entry), cell(till))) return null;
  // the round: random floor spots joined up along the aisles
  const floors = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!at(x, y)) floors.push([x, y]);
  const nG = diff >= 4 ? 2 : 1;
  for (let g = 0; g < nG; g++) {
    const pts = []; for (let i = 0; i < 4; i++) { const f = floors[Math.floor(r() * floors.length)]; if (Math.hypot(f[0] + 0.5 - entry.x, f[1] + 0.5 - entry.y) < 3) { i--; continue; } pts.push(f); }
    const route = []; for (let i = 0; i < pts.length; i++) { const p = pathCells(L, pts[i], pts[(i + 1) % pts.length]); if (!p) return null; route.push(...p.slice(i ? 1 : 0)); }
    const pts2 = route.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 })); let len = 0; const cum = [0]; for (let i = 1; i < pts2.length; i++) { len += Math.hypot(pts2[i].x - pts2[i - 1].x, pts2[i].y - pts2[i - 1].y); cum.push(len); }
    if (len < 4) return null;
    L.guards.push({ pts: pts2, cum, len, speed: 1.05 + diff * 0.15, off: r() * len, kind: g ? 'guard' : 'keeper' });
  }
  const nC = Math.max(0, diff - 2);
  const spots = [[W - 0.5, H / 2, Math.PI], [W / 2, 0.15, Math.PI / 2], [0.15, H / 2 - 1, 0], [W / 2 + 2, H - 0.15, -Math.PI / 2]];
  for (let i = 0; i < nC; i++) { const [x, y, a] = spots[i % spots.length]; L.cams.push({ x, y, base: a, sweep: 0.75, period: 5 + r() * 3, ph: r() * 6.28 }); }
  return L;
}
const cell = p => [Math.floor(p.x), Math.floor(p.y)];
export const isWall = (L, x, y) => { const cx = Math.floor(x), cy = Math.floor(y); return cx < 0 || cy < 0 || cx >= L.W || cy >= L.H || L.wall[cy * L.W + cx] > 0; };
function pathCells(L, a, b) { // breadth-first route between two floor cells, through the aisles
  const W = L.W, H = L.H, prev = new Int32Array(W * H).fill(-1), s = a[1] * W + a[0], e = b[1] * W + b[0]; if (L.wall[s] || L.wall[e]) return null;
  const q = [s]; prev[s] = s;
  while (q.length) { const c = q.shift(); if (c === e) break; const x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (prev[n] >= 0 || L.wall[n]) continue; prev[n] = c; q.push(n); } }
  if (prev[e] < 0) return null; const out = []; for (let c = e; ; c = prev[c]) { out.push([c % W, (c / W) | 0]); if (c === s) break; } return out.reverse();
}
export function guardAt(g, t) {
  let d = ((g.off + t * g.speed) % g.len + g.len) % g.len, i = 1; while (i < g.cum.length - 1 && g.cum[i] < d) i++;
  const a = g.pts[i - 1], b = g.pts[i] || a, seg = Math.max(1e-6, g.cum[i] - g.cum[i - 1]), u = clamp((d - g.cum[i - 1]) / seg, 0, 1);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, dir: Math.atan2(b.y - a.y, b.x - a.x) };
}
export const camAt = (c, t) => c.base + Math.sin(t / c.period * Math.PI * 2 + c.ph) * c.sweep;
function clear(L, a, b) { const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 0.2); for (let i = 1; i < n; i++) { const u = i / n; if (isWall(L, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)) return false; } return true; }
function inCone(from, dir, fov, range, p) { const dx = p.x - from.x, dy = p.y - from.y, d = Math.hypot(dx, dy); if (d > range) return false; if (d < 0.6) return true;
  let da = Math.atan2(dy, dx) - dir; da = Math.atan2(Math.sin(da), Math.cos(da)); return Math.abs(da) <= fov; }
// Who can see the point p at time t (0 = nobody).
export function seenBy(L, t, p) {
  for (const g of L.guards) { const s = guardAt(g, t); if (inCone(s, s.dir, STEALTH.guardFov, STEALTH.guardRange + L.diff * 0.2, p) && clear(L, s, p)) return 1; }
  for (const c of L.cams) if (inCone(c, camAt(c, t), STEALTH.camFov, STEALTH.camRange, p) && clear(L, c, p)) return 2;
  return 0;
}
// One step of the game: from state s, wanting to move by (vx, vy) (a direction of length ≤ 1) for STEP seconds.
export function stealthStep(L, s, vx, vy) {
  const n = Math.hypot(vx, vy); if (n > 1) { vx /= n; vy /= n; }
  const sp = STEALTH.speed * STEP, R0 = 0.28, fits = (x, y) => !isWall(L, x - R0, y - R0) && !isWall(L, x + R0, y - R0) && !isWall(L, x - R0, y + R0) && !isWall(L, x + R0, y + R0);
  let x = s.x, y = s.y; if (fits(x + vx * sp, y)) x += vx * sp; if (fits(x, y + vy * sp)) y += vy * sp;
  return advance(L, s, x, y);
}
// Everything that follows from being at (x, y) after the step: the meter, the till, the door.
function advance(L, s, x, y) {
  const t = +(s.t + STEP).toFixed(3), p = { x, y }, who = seenBy(L, t, p);
  let seen = who ? s.seen + STEP * (STEALTH.fill + STEALTH.fillD * L.diff) : Math.max(0, s.seen - STEP * STEALTH.drain);
  const peak = Math.max(s.peak, seen), near = Math.hypot(x - L.till.x, y - L.till.y) < STEALTH.grabR;
  const grab = s.grabbed ? STEALTH.grab : near ? s.grab + STEP : s.grab, grabbed = grab >= STEALTH.grab;
  const out = { t, x, y, seen: Math.min(1, seen), peak: Math.min(1, peak), who, grab, grabbed, done: null };
  if (seen >= 1) out.done = 'spotted';
  else if (grabbed && Math.hypot(x - L.entry.x, y - L.entry.y) < STEALTH.exitR) out.done = 'escaped';
  else if (!grabbed && s.t > 3 && Math.hypot(x - L.entry.x, y - L.entry.y) < 0.45 && s.left) out.done = 'left';
  else if (t >= L.limit) out.done = 'timeout';
  out.left = s.left || Math.hypot(x - L.entry.x, y - L.entry.y) > 1.2;
  return out;
}
export const stealthStart = L => ({ t: 0, x: L.entry.x, y: L.entry.y, seen: 0, peak: 0, who: 0, grab: 0, grabbed: false, done: null, left: false });
export function stealthPerf(L, s) {
  if (s.done === 'escaped') return { perf: clamp(0.55 + 0.3 * (1 - s.peak) + 0.15 * Math.max(0, (L.limit - s.t) / L.limit) * 1.5, 0, 1), money: true };
  if (s.done === 'left') return { perf: 0.45, money: false }; // walked away before taking anything
  if (s.done === 'timeout') return { perf: s.grabbed ? 0.3 : 0.15, money: false };
  return { perf: s.grabbed ? 0.12 : 0.05, money: false }; // spotted
}
// The server's check: the path the player sent, one point per step. Each step must be a move the game allows.
export function stealthReplay(L, path) {
  if (!Array.isArray(path) || path.length < 2 || path.length > Math.ceil(L.limit / STEP) + 2) return { ok: false, why: 'bad path' };
  let s = stealthStart(L);
  for (let i = 1; i < path.length && !s.done; i++) {
    const [x, y] = path[i].map(Number); if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, why: 'bad point' };
    const dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy); if (d > STEALTH.speed * STEP + 0.02) return { ok: false, why: 'too fast' };
    // the same move the game would make: it must land where the player says
    const q = stealthStep(L, s, d ? dx / (STEALTH.speed * STEP) : 0, d ? dy / (STEALTH.speed * STEP) : 0);
    if (Math.hypot(q.x - x, q.y - y) > 0.03) return { ok: false, why: 'walked through a wall' };
    s = q;
  }
  if (!s.done) { s.done = 'timeout'; }
  return { ok: true, state: s, ...stealthPerf(L, s) };
}

// ======================= Smooth talker (con a tourist) =======================
// Six turns to get the tourist to buy a "genuine" Gliese moon rock. Each turn you pick one of three lines; what works
// depends on the tourist's mood, which shows in what they say and shifts as you talk. A good line builds trust, a bad one
// raises suspicion; tapping the timing bar in the sweet spot lands a line better. Trust 100 = sold. Suspicion 100 = they walk.
export const MOODS = {
  curious: { name: 'Curious', face: '🤔', say: ['Moon rock? From which moon?', 'How do you know it\'s real?', 'Tell me more about it…'] },
  skeptical: { name: 'Skeptical', face: '🤨', say: ['Hmm. That sounds made up.', 'I\'ve heard that one before.', 'Prove it.'] },
  hurried: { name: 'In a hurry', face: '⌚', say: ['I\'ve got a shuttle to catch.', 'Make it quick.', 'I don\'t have all day.'] },
  friendly: { name: 'Friendly', face: '😊', say: ['Ha! You\'re funny.', 'Go on then, I\'m listening.', 'What a lovely colony this is!'] },
  vain: { name: 'Proud', face: '😎', say: ['I only buy the best.', 'Do I look like an ordinary tourist?', 'My friends back home will be so jealous.'] },
};
export const TAGS = {
  facts: { name: 'Facts', lines: ['It\'s from the second moon. You can tell by the blue flecks.', 'Certified by the Colony Geology Office. Here\'s the stamp.', 'Only 40 were ever brought back. This is number 17.', 'Feel how heavy it is. That\'s moon iron.'] },
  flatter: { name: 'Flattery', lines: ['Someone with your eye for quality spotted it straight away.', 'I only show this to collectors like you.', 'It would look perfect in a home as fine as yours.', 'You clearly know a real treasure.'] },
  urgency: { name: 'Hurry', lines: ['Last one. Another buyer is coming back at noon.', 'The price doubles when the shuttle docks.', 'Customs closes in ten minutes. Now or never.', 'I can only hold it for you for a minute.'] },
  joke: { name: 'Charm', lines: ['If it\'s not real, I\'ll eat it. With ketchup.', 'My grandma mined it herself. On a Tuesday.', 'It\'s so rare even the moon doesn\'t have one any more.', 'Comes with free moon dust. Some assembly required.'] },
  deal: { name: 'Deal', lines: ['For you, half price. Don\'t tell anyone.', 'Buy one, I\'ll throw in a meteorite.', 'Cash today, and I\'ll waive the certificate fee.', 'Special colony-day discount, just for you.'] },
};
const LIKE = { // [trust, suspicion] each kind of line earns with each mood
  curious: { facts: [32, 0], flatter: [12, 6], urgency: [-4, 18], joke: [16, 4], deal: [8, 10] },
  skeptical: { facts: [26, 2], flatter: [-6, 20], urgency: [-8, 26], joke: [6, 10], deal: [12, 8] },
  hurried: { facts: [4, 10], flatter: [6, 8], urgency: [30, 2], joke: [-4, 14], deal: [22, 4] },
  friendly: { facts: [12, 4], flatter: [20, 2], urgency: [4, 14], joke: [32, 0], deal: [10, 6] },
  vain: { facts: [10, 6], flatter: [34, 0], urgency: [6, 12], joke: [2, 12], deal: [-6, 20] },
};
export function genCon(seed, diff) {
  const r = rng(seed), moods = Object.keys(MOODS), tags = Object.keys(TAGS), turns = 6, rounds = [];
  let mood = moods[Math.floor(r() * moods.length)];
  for (let i = 0; i < turns; i++) {
    if (i > 0 && r() < 0.28 + diff * 0.06) { const o = moods.filter(m => m !== mood); mood = o[Math.floor(r() * o.length)]; }
    const pick = []; const pool = [...tags]; for (let k = 0; k < 3; k++) pick.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    rounds.push({ mood, say: Math.floor(r() * 3), options: pick.map(tg => ({ tag: tg, line: Math.floor(r() * TAGS[tg].lines.length) })) });
  }
  return { seed, diff, rounds, need: 100, zone: Math.max(0.12, 0.3 - diff * 0.035), limit: 75 };
}
// Replaying the conversation: picks are the option chosen each turn (0–2) and how well the line was timed (0–1).
export function conReplay(L, picks) {
  if (!Array.isArray(picks) || picks.length > L.rounds.length) return { ok: false, why: 'bad picks' };
  let trust = 0, sus = 0, done = null, turn = 0;
  for (const p of picks) {
    const R0 = L.rounds[turn], o = R0 && R0.options[Number(p && p.o)]; if (!o) return { ok: false, why: 'bad pick' };
    const tm = clamp(Number(p.t) || 0, 0, 1), [dt, ds] = LIKE[R0.mood][o.tag], k = 1 - (L.diff - 1) * 0.06;
    trust = clamp(trust + (dt > 0 ? dt * k * (0.75 + 0.5 * tm) : dt), 0, 150); sus = clamp(sus + ds * (1.15 - 0.4 * tm) + (L.diff - 1) * 1.5, 0, 150); turn++;
    if (trust >= L.need) { done = 'sold'; break; } if (sus >= 100) { done = 'walked'; break; }
  }
  if (!done) done = turn >= L.rounds.length ? 'walked' : null;
  if (!done) return { ok: false, why: 'unfinished', state: { trust: Math.round(trust), sus: Math.round(sus), turns: turn } };
  const perf = done === 'sold' ? clamp(0.6 + 0.3 * (1 - sus / 100) + 0.1 * (L.rounds.length - turn) / L.rounds.length, 0, 1) : clamp(trust / L.need * 0.45, 0, 0.45);
  return { ok: true, state: { trust: Math.round(trust), sus: Math.round(sus), turns: turn, done }, perf, money: done === 'sold' };
}

// ======================= Wire & code (hack an ATM) =======================
// First rewire the machine: each coloured wire on the left goes to the socket marked with that colour's symbol on the
// service card. A wrong wire sparks and the alarm jumps. Then the keypad flashes a code: tap it back. A wrong key
// restarts the code and the alarm jumps again. The alarm also creeps up on its own; if it fills, the bank's alarm goes off.
export const WIRE_COLS = ['#E4572E', '#F2C94C', '#3CC46A', '#4A7BD9', '#B05FD6', '#F28CB1', '#F4F4F0'];
export const WIRE_NAMES = ['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'White'];
export const SYMBOLS = ['▲', '●', '■', '◆', '★', '✚', '⬟'];
export function genAtm(seed, diff) {
  const r = rng(seed), n = Math.min(6, 3 + Math.ceil(diff / 1.5)), shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cols = shuffle([...Array(WIRE_COLS.length).keys()]).slice(0, n), syms = shuffle([...Array(SYMBOLS.length).keys()]).slice(0, n);
  const card = cols.map((c, i) => ({ col: c, sym: syms[i] })); // the service card: this colour goes to this symbol
  const sockets = shuffle([...syms]); // the sockets on the right, in the order they're fitted
  const pin = [...Array(3 + diff)].map(() => Math.floor(r() * 9) + 1);
  return { seed, diff, wires: cols, card, sockets, pin, limit: 58 - diff * 4, wrongWire: 0.1, wrongKey: 0.12 };
}
// events: ['w', wireIndex, socketIndex] and ['k', digit], with the time each happened (seconds from the start).
export function atmReplay(L, events, time) {
  if (!Array.isArray(events) || events.length > 200) return { ok: false, why: 'bad events' };
  const T = clamp(Number(time) || 0, 0, L.limit + 2); let alarm = 0, linked = new Set(), stage = 'wires', at = 0, wrongs = 0, lastT = 0;
  for (const e of events) { const t = Number(e[3] ?? e[2]); if (!(t >= lastT - 0.001) || t > T + 0.5) return { ok: false, why: 'bad timing' }; lastT = t;
    if (stage === 'wires' && e[0] === 'w') { const w = Number(e[1]), s = Number(e[2]); if (!(w >= 0 && w < L.wires.length) || !(s >= 0 && s < L.sockets.length) || linked.has(w)) continue;
      if (L.card[w].sym === L.sockets[s]) { linked.add(w); if (linked.size === L.wires.length) stage = 'pin'; } else { alarm += L.wrongWire; wrongs++; } }
    else if (stage === 'pin' && e[0] === 'k') { const d = Number(e[1]); if (d === L.pin[at]) { at++; if (at === L.pin.length) { stage = 'open'; break; } } else { at = 0; alarm += L.wrongKey; wrongs++; } }
    if (alarm + t / L.limit >= 1) { stage = 'alarm'; break; } }
  const total = alarm + Math.min(T, lastT || T) / L.limit;
  if (stage !== 'open' && stage !== 'alarm') stage = T >= L.limit - 0.5 || total >= 1 ? 'alarm' : 'gaveup';
  const progress = (linked.size / L.wires.length) * 0.5 + (stage === 'open' ? 0.5 : at / L.pin.length * 0.5);
  const perf = stage === 'open' ? clamp(0.55 + 0.45 * (1 - clamp(total, 0, 1)), 0, 1) : clamp(progress * 0.3, 0, 0.3);
  return { ok: true, state: { stage, alarm: +clamp(total, 0, 1).toFixed(3), wrongs, progress }, perf, money: stage === 'open' };
}

// How long a game must at least take (a fast human), so a result can't come back quicker than it could be played.
export function minTime(kind, L, st) {
  if (kind === 'rob') return st && st.t ? st.t : 0;
  if (kind === 'scam') return (st?.turns || 1) * 0.8;
  if (kind === 'atm') return L.wires.length * 0.35 + L.pin.length * 0.2;
  return 0;
}
export function levelOf(kind, seed, diff) { return kind === 'rob' ? genStealth(seed, diff) : kind === 'scam' ? genCon(seed, diff) : genAtm(seed, diff); }
export function replay(kind, L, log) {
  if (kind === 'rob') return stealthReplay(L, log && log.path);
  if (kind === 'scam') return conReplay(L, log && log.picks);
  if (kind === 'atm') return atmReplay(L, log && log.events, log && log.time);
  return { ok: false, why: 'unknown game' };
}
