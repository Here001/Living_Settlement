// Crime mini games: short full-screen games that decide how a solo crime goes.
// Everything that decides a result lives here and is shared: the browser plays the game with these rules, and the
// server replays what the player did with the very same rules before paying anything out. A game's level comes from a
// seed the server picks, so nobody can choose an easy one, and nothing the browser reports is taken on trust.
//
//   rob  → Cut-away stealth: sneak into the shop, empty the till, get out unseen.
//   scam → Smooth talker: win a tourist's trust before they smell a rat.
//   atm  → Wire & code: rewire the cash machine, then crack the PIN before the alarm goes.
//
// Heists give each crew member a role, played live at the same time on their own phone:
//   driver → Getaway drive · hacker → Wire & code · safecracker → The dial · lookout → Spot the police · muscle → Hold the doors
//
// Score out of 100: your play is worth up to 60 points, the setting (how far the police are, night, a crime wave) up to 40.

export const GAMES = { rob: 'stealth', scam: 'con', atm: 'atm', driver: 'drive', hacker: 'atm', safecracker: 'safe', lookout: 'lookout', muscle: 'horde' };
export const SOLO = ['rob', 'scam', 'atm']; // the crimes you do alone; the rest are heist roles (practice is open to all)
export const STEP = 0.1; // the stealth game moves in steps of a tenth of a second, on the phone and on the server alike

export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Difficulty 1 (easy) to 5 (hard): each crime has its own base, and police close by make it harder.
const BASE = { rob: 2, scam: 1, atm: 3, driver: 2, hacker: 3, safecracker: 3, lookout: 2, muscle: 2 };
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
// The staff don't walk a fixed loop: they wander from aisle to aisle, stop, and look around. Laser tripwires blink on
// and off across the aisles (walk through one while it's on and the alarm is half-way there). Smaller loot (a jewellery
// case, a cash box, phones on display) is there for the taking too, if you dare: each one adds to the takings.
export const STEALTH = { speed: 3.2, grab: 1.5, grabR: 0.95, exitR: 0.8, fill: 1.25, fillD: 0.22, drain: 0.5,
  guardFov: 0.62, guardRange: 3.4, camFov: 0.4, camRange: 4.6, laser: 0.55, itemR: 0.8, itemGrab: 0.8, itemBonus: 0.15 };
export const ITEMS = { jewels: { name: 'Jewellery case', icon: '💎' }, cashbox: { name: 'Cash box', icon: '🗃️' }, phones: { name: 'Phones on display', icon: '📱' }, watches: { name: 'Watches', icon: '⌚' } };

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
  const L = { seed, diff, W, H, wall: Array.from(wall), entry, till, guards: [], cams: [], lasers: [], items: [], limit: 54 - diff * 3 };
  if (!pathCells(L, cell(entry), cell(till))) return null;
  // the round: random floor spots joined up along the aisles
  const floors = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!at(x, y)) floors.push([x, y]);
  const nG = diff >= 4 ? 2 : 1, far = f => Math.hypot(f[0] + 0.5 - entry.x, f[1] + 0.5 - entry.y) >= 3;
  for (let g = 0; g < nG; g++) {
    // a wander: walk to a random spot, stop, look around (two or three glances), then on to another; never the same twice
    const speed = 1.05 + diff * 0.15, legs = []; let at0 = floors.filter(far)[Math.floor(r() * floors.filter(far).length)], t = -3;
    while (t < L.limit + 4) {
      let to = null; for (let k = 0; k < 20 && !to; k++) { const f = floors[Math.floor(r() * floors.length)]; if (far(f) && Math.abs(f[0] - at0[0]) + Math.abs(f[1] - at0[1]) >= 3) to = f; }
      if (!to) return null; const p = pathCells(L, at0, to); if (!p) return null;
      const pts = p.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 })); let len = 0; const cum = [0]; for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(len); }
      const sp = speed * (0.8 + r() * 0.5); legs.push({ k: 'walk', t0: +t.toFixed(3), t1: +(t + len / sp).toFixed(3), pts, cum, len }); t += len / sp;
      const last = pts[pts.length - 1], prev = pts[pts.length - 2] || last, d0 = Math.atan2(last.y - prev.y, last.x - prev.x), pause = 0.4 + r() * (2.4 - diff * 0.25), looks = [];
      for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) looks.push({ t: +(t + pause * k / n).toFixed(3), dir: +(d0 + (r() - 0.5) * 3.6).toFixed(3) });
      legs.push({ k: 'look', t0: +t.toFixed(3), t1: +(t + pause).toFixed(3), x: last.x, y: last.y, looks }); t += pause; at0 = to;
    }
    L.guards.push({ legs, kind: g ? 'guard' : 'keeper' });
  }
  // laser tripwires across open runs of floor: on for a while, off for a while (each at its own beat)
  const nL = 1 + Math.floor(diff / 2), used = new Set();
  for (let k = 0, tries = 0; k < nL && tries < 200; tries++) {
    const horiz = r() < 0.5, x = 1 + Math.floor(r() * (W - 2)), y = 1 + Math.floor(r() * (H - 2)); if (at(x, y)) continue;
    let a = horiz ? x : y, b = a; const free = v => horiz ? !at(v, y) : !at(x, v); while (free(a - 1) && a - 1 >= 0) a--; while (free(b + 1) && b + 1 < (horiz ? W : H)) b++;
    if (b - a < 2 || used.has((horiz ? 'h' : 'v') + (horiz ? y : x))) continue; used.add((horiz ? 'h' : 'v') + (horiz ? y : x));
    const c = horiz ? y + 0.5 : x + 0.5; if (Math.hypot((horiz ? (a + b + 1) / 2 : c) - entry.x, (horiz ? c : (a + b + 1) / 2) - entry.y) < 2) continue;
    L.lasers.push(horiz ? { x0: a, y0: c, x1: b + 1, y1: c } : { x0: c, y0: a, x1: c, y1: b + 1 }); const z = L.lasers[L.lasers.length - 1];
    z.period = +(2.2 + r() * 1.6 - diff * 0.15).toFixed(2); z.on = +(0.45 + r() * 0.2 + diff * 0.04).toFixed(2); z.ph = +r().toFixed(3); k++;
  }
  // the extra loot: against shelves or walls, away from the door
  const kinds = Object.keys(ITEMS), nI = 2 + (diff >= 3 ? 1 : 0), io = Math.floor(r() * kinds.length);
  for (let k = 0, tries = 0; k < nI && tries < 300; tries++) { const f = floors[Math.floor(r() * floors.length)], x = f[0] + 0.5, y = f[1] + 0.5;
    if (!far(f) || Math.hypot(x - till.x, y - till.y) < 2.5 || L.items.some(i => Math.hypot(i.x - x, i.y - y) < 3)) continue;
    let wallNear = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(f[0] + dx, f[1] + dy)) wallNear = true; if (!wallNear) continue;
    if (!pathCells(L, cell(entry), f)) continue; L.items.push({ x, y, k: kinds[(k + io) % kinds.length] }); k++; }
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
// Where a member of staff is at time t, and which way they're looking (moving: walking; still: glancing about).
export function guardAt(g, t) {
  const legs = g.legs; let lo = 0, hi = legs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (legs[m].t0 <= t) lo = m; else hi = m - 1; }
  const L0 = legs[lo];
  if (L0.k === 'look') { let dir = L0.looks[0].dir; for (const k of L0.looks) if (k.t <= t) dir = k.dir; return { x: L0.x, y: L0.y, dir, still: true }; }
  const d = clamp((t - L0.t0) / Math.max(1e-6, L0.t1 - L0.t0), 0, 1) * L0.len; let i = 1; while (i < L0.cum.length - 1 && L0.cum[i] < d) i++;
  const a = L0.pts[i - 1], b = L0.pts[i] || a, seg = Math.max(1e-6, L0.cum[i] - L0.cum[i - 1]), u = clamp((d - L0.cum[i - 1]) / seg, 0, 1);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, dir: b === a ? 0 : Math.atan2(b.y - a.y, b.x - a.x) };
}
// Is a laser on at time t? And does it touch the point p?
export const laserOn = (z, t) => ((t / z.period + z.ph) % 1) < z.on;
function onLaser(z, p) { const dx = z.x1 - z.x0, dy = z.y1 - z.y0, u = clamp(((p.x - z.x0) * dx + (p.y - z.y0) * dy) / (dx * dx + dy * dy), 0, 1), qx = z.x0 + dx * u - p.x, qy = z.y0 + dy * u - p.y; return qx * qx + qy * qy < 0.3 * 0.3; }
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
  const t = +(s.t + STEP).toFixed(3), p = { x, y }; let who = seenBy(L, t, p);
  let seen = who ? s.seen + STEP * (STEALTH.fill + STEALTH.fillD * L.diff) : Math.max(0, s.seen - STEP * STEALTH.drain);
  // a laser: tripping one (stepping onto it while it's on) sets the alarm half off
  let zap = s.zap || 0; const onAny = (L.lasers || []).some(z => laserOn(z, t) && onLaser(z, p)); if (onAny && !s.onLaser) { seen += STEALTH.laser; zap++; who = 3; }
  // the extra loot: stand next to one long enough to bag it
  let items = s.items || 0, ig = s.ig || 0, ii = -1; (L.items || []).forEach((it, k) => { if (!(items & (1 << k)) && Math.hypot(x - it.x, y - it.y) < STEALTH.itemR) ii = k; });
  if (ii >= 0 && ii === s.ii) { ig += STEP; if (ig >= STEALTH.itemGrab) { items |= 1 << ii; ig = 0; ii = -1; } } else ig = ii >= 0 ? STEP : 0;
  const peak = Math.max(s.peak, seen), near = Math.hypot(x - L.till.x, y - L.till.y) < STEALTH.grabR;
  const grab = s.grabbed ? STEALTH.grab : near ? s.grab + STEP : s.grab, grabbed = grab >= STEALTH.grab;
  const out = { t, x, y, seen: Math.min(1, seen), peak: Math.min(1, peak), who, grab, grabbed, done: null, onLaser: onAny, zap, items, ig, ii };
  if (seen >= 1) out.done = 'spotted';
  else if (grabbed && Math.hypot(x - L.entry.x, y - L.entry.y) < STEALTH.exitR) out.done = 'escaped';
  else if (!grabbed && s.t > 3 && Math.hypot(x - L.entry.x, y - L.entry.y) < 0.45 && s.left) out.done = 'left';
  else if (t >= L.limit) out.done = 'timeout';
  out.left = s.left || Math.hypot(x - L.entry.x, y - L.entry.y) > 1.2;
  return out;
}
export const stealthStart = L => ({ t: 0, x: L.entry.x, y: L.entry.y, seen: 0, peak: 0, who: 0, grab: 0, grabbed: false, done: null, left: false });
export const itemCount = s => { let n = 0, b = s.items || 0; while (b) { n += b & 1; b >>= 1; } return n; };
export function stealthPerf(L, s) {
  if (s.done === 'escaped') return { perf: clamp(0.5 + 0.3 * (1 - s.peak) + 0.12 * Math.max(0, (L.limit - s.t) / L.limit) * 1.5 + 0.04 * itemCount(s), 0, 1), money: true, extra: itemCount(s) };
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
  return { ok: true, state: { ...s, got: itemCount(s) }, ...stealthPerf(L, s) };
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
// Hard mode (after a job that came off): the sockets swap places every few seconds, and a fuse burns between moves:
// make the next right move before it burns down (every right move relights it), or the alarm goes.
export function genAtm(seed, diff, hard = false) {
  const r = rng(seed), n = Math.min(6, 3 + Math.ceil(diff / 1.5)), shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cols = shuffle([...Array(WIRE_COLS.length).keys()]).slice(0, n), syms = shuffle([...Array(SYMBOLS.length).keys()]).slice(0, n);
  const card = cols.map((c, i) => ({ col: c, sym: syms[i] })); // the service card: this colour goes to this symbol
  const sockets = shuffle([...syms]); // the sockets on the right, in the order they're fitted
  const pin = [...Array(3 + diff)].map(() => Math.floor(r() * 9) + 1);
  const L = { seed, diff, wires: cols, card, sockets, pin, limit: 58 - diff * 4, wrongWire: 0.1, wrongKey: 0.12 };
  if (hard) { L.hard = true; L.shift = +Math.max(3.5, 7 - diff * 0.6).toFixed(2); L.fuse = +Math.max(4.5, 9 - diff * 0.7).toFixed(2); }
  return L;
}
// How long the keypad takes to flash the code (the fuse waits for it).
export const atmCodeTime = L => 0.4 + L.pin.length * Math.max(260, 520 - L.diff * 45) / 1000;
// The sockets' order at time t (in hard mode they swap places every few seconds).
export function socketsAt(L, t) {
  if (!L.shift) return L.sockets; const ep = Math.floor(Math.max(0, t) / L.shift); if (!ep) return L.sockets;
  const r = rng(L.seed * 7919 + ep), a = [...L.sockets]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}
// events: ['w', wireIndex, socketIndex] and ['k', digit], with the time each happened (seconds from the start).
export function atmReplay(L, events, time) {
  if (!Array.isArray(events) || events.length > 200) return { ok: false, why: 'bad events' };
  const T = clamp(Number(time) || 0, 0, L.limit + 2); let alarm = 0, linked = new Set(), stage = 'wires', at = 0, wrongs = 0, lastT = 0, lit = 0, burnt = false;
  for (const e of events) { const t = Number(e[3] ?? e[2]); if (!(t >= lastT - 0.001) || t > T + 0.5) return { ok: false, why: 'bad timing' }; lastT = t;
    if (L.fuse && t - lit > L.fuse) { stage = 'alarm'; burnt = true; break; } // the fuse burnt down before this move
    if (stage === 'wires' && e[0] === 'w') { const w = Number(e[1]), s = Number(e[2]), sk = socketsAt(L, t); if (!(w >= 0 && w < L.wires.length) || !(s >= 0 && s < sk.length) || linked.has(w)) continue;
      if (L.card[w].sym === sk[s]) { linked.add(w); lit = t; if (linked.size === L.wires.length) { stage = 'pin'; lit = t + 0.4 + atmCodeTime(L); } } else { alarm += L.wrongWire; wrongs++; } }
    else if (stage === 'pin' && e[0] === 'k') { const d = Number(e[1]); if (d === L.pin[at]) { at++; lit = t; if (at === L.pin.length) { stage = 'open'; break; } } else { at = 0; alarm += L.wrongKey; wrongs++; lit = Math.max(lit, t + 0.5 + atmCodeTime(L)); } }
    if (alarm + t / L.limit >= 1) { stage = 'alarm'; break; } }
  if (L.fuse && stage !== 'open' && stage !== 'alarm' && T - lit > L.fuse) { stage = 'alarm'; burnt = true; }
  const total = alarm + Math.min(T, lastT || T) / L.limit;
  if (stage !== 'open' && stage !== 'alarm') stage = T >= L.limit - 0.5 || total >= 1 ? 'alarm' : 'gaveup';
  const progress = (linked.size / L.wires.length) * 0.5 + (stage === 'open' ? 0.5 : at / L.pin.length * 0.5);
  const perf = stage === 'open' ? clamp(0.55 + 0.45 * (1 - clamp(total, 0, 1)), 0, 1) : clamp(progress * 0.3, 0, 0.3);
  return { ok: true, state: { stage, alarm: +clamp(total, 0, 1).toFixed(3), wrongs, progress, burnt, lit }, perf, money: stage === 'open' };
}

// ======================= Heist roles =======================
export const ROLES = {
  driver: { name: 'Driver', icon: '🚗', blurb: 'Weave the getaway car through traffic and roadblocks.' },
  hacker: { name: 'Hacker', icon: '💻', blurb: 'Rewire the security panel and crack its code.' },
  safecracker: { name: 'Safecracker', icon: '🔐', blurb: 'Stop the dial on each number.' },
  lookout: { name: 'Lookout', icon: '👀', blurb: 'Spot the plain-clothes police before they spot the crew.' },
  muscle: { name: 'Muscle', icon: '💪', blurb: 'Hold off the zombie horde while the crew works.' },
};
// The parts each job needs, most important first: a crew of 3 fills the first three.
export const HEIST_ROLES = {
  armored: ['driver', 'muscle', 'hacker', 'lookout', 'muscle'],
  mayor: ['lookout', 'muscle', 'driver', 'muscle', 'muscle'],
  jailbreak: ['hacker', 'driver', 'lookout', 'muscle', 'safecracker', 'muscle'],
  bank: ['safecracker', 'hacker', 'driver', 'lookout', 'muscle', 'muscle'],
};
// Who plays what: everyone gets the part they asked for while the job still has room for it; the rest fill the
// job's open parts in order. `wants` is one role (or null) per crew member, in crew order.
export function assignRoles(kind, wants) {
  const slots = [...(HEIST_ROLES[kind] || ['muscle'])], out = wants.map(() => null);
  wants.forEach((w, i) => { const k = slots.indexOf(w); if (w && k >= 0) { out[i] = w; slots.splice(k, 1); } });
  out.forEach((r, i) => { if (!r) out[i] = slots.length ? slots.shift() : 'muscle'; });
  return out;
}

// ======================= Getaway drive (driver) =======================
// Three lanes, traffic and roadblocks coming at you, faster and faster; tap left or right to change lane. A crash slows you right down;
// four crashes and the car's wrecked. Reach the end of the road to get away. Moves: [step, lane] when the lane changes.
export const DRIVE = { hit: 3, wreck: 4 };
export function genDrive(seed, diff) {
  const r = rng(seed), D = 520 + diff * 60, obs = [], kinds = ['car', 'van', 'cones', 'police', 'car', 'bus'];
  let d = 45;
  while (d < D - 25) {
    d += 26 - diff * 1.8 + r() * (16 - diff * 1.5);
    const lane = Math.floor(r() * 3), k = kinds[Math.floor(r() * kinds.length)];
    obs.push({ d: +d.toFixed(2), lane, k });
    if (diff >= 2 && r() < 0.1 + diff * 0.06) obs.push({ d: +d.toFixed(2), lane: (lane + 1 + Math.floor(r() * 2)) % 3, k: kinds[Math.floor(r() * kinds.length)] });
  }
  const v0 = 15 + diff, v1 = Math.round(v0 * 1.85); // it starts at cruising speed and keeps speeding up all the way to the end
  return { seed, diff, D, obs, v0, v1, limit: Math.ceil(D / v0) + 14 };
}
export const driveStart = () => ({ t: 0, n: 0, d: 0, lane: 1, slow: 1, crashes: 0, gone: [], i: 0, done: null });
// One step (mutates and returns the state). `lane` is where the player is steering: one lane over at most.
export function driveStep(L, s, lane) {
  if (s.done) return s;
  if (lane !== s.lane && Math.abs(lane - s.lane) === 1 && lane >= 0 && lane <= 2) s.lane = lane;
  const v = (L.v0 + (L.v1 - L.v0) * Math.min(1, s.d / L.D)) * s.slow;
  s.d = +(s.d + v * STEP).toFixed(4); s.n++; s.t = +(s.n * STEP).toFixed(3); s.slow = Math.min(1, +(s.slow + 0.45 * STEP).toFixed(4));
  while (s.i < L.obs.length && L.obs[s.i].d < s.d - DRIVE.hit) s.i++;
  for (let j = s.i; j < L.obs.length && L.obs[j].d < s.d + DRIVE.hit; j++) if (L.obs[j].lane === s.lane && !s.gone.includes(j)) { s.gone.push(j); s.crashes++; s.slow = 0.3; }
  if (s.crashes >= DRIVE.wreck) s.done = 'wrecked'; else if (s.d >= L.D) s.done = 'escaped'; else if (s.t >= L.limit) s.done = 'caught';
  return s;
}
export function driveReplay(L, moves) {
  if (!Array.isArray(moves) || moves.length > 800) return { ok: false, why: 'bad moves' };
  const s = driveStart(), max = Math.ceil(L.limit / STEP) + 1; let k = 0, lastN = -1;
  for (const m of moves) { const n = Number(m && m[0]); if (!Number.isInteger(n) || n <= lastN || n > max) return { ok: false, why: 'bad moves' }; lastN = n; }
  while (!s.done && s.n < max) { let lane = s.lane; if (k < moves.length && Number(moves[k][0]) === s.n) { lane = Number(moves[k][1]); k++; } driveStep(L, s, lane); }
  const perf = s.done === 'escaped' ? clamp(0.55 + 0.45 * (1 - s.crashes / DRIVE.wreck), 0, 1) : s.done === 'wrecked' ? clamp(0.1 + 0.2 * s.d / L.D, 0, 0.3) : 0.2;
  return { ok: true, state: { t: s.t, done: s.done, crashes: s.crashes, d: Math.round(s.d) }, perf, money: s.done === 'escaped' };
}

// ======================= The dial (safecracker) =======================
// The dial spins by itself; tap when the pointer is on the marked number to lock it in, then the next number, spinning
// the other way. A tap off the number makes a noise; too much noise and the alarm goes. Taps: the times you tapped.
const TAU = Math.PI * 2, angDiff = (a, b) => Math.abs((((a - b) % TAU) + TAU * 1.5) % TAU - Math.PI);
export function genSafe(seed, diff) {
  const r = rng(seed), n = 3 + Math.ceil(diff / 2), nums = [];
  for (let i = 0; i < n; i++) nums.push({ a: +(r() * TAU).toFixed(4), a0: +(r() * TAU).toFixed(4), sp: +(1.4 + diff * 0.25 + r() * 0.6).toFixed(3), dir: i % 2 ? -1 : 1 });
  return { seed, diff, nums, tol: +(0.3 - diff * 0.025).toFixed(3), limit: 34 + n * 3, wrong: 0.2 };
}
export const safeAngle = (N, since) => N.a0 + N.dir * N.sp * since; // where the pointer is, `since` seconds into this number
export function safeReplay(L, taps, time) {
  if (!Array.isArray(taps) || taps.length > 200) return { ok: false, why: 'bad taps' };
  const T = clamp(Number(time) || 0, 0, L.limit + 2); let k = 0, from = 0, noise = 0, last = 0, stage = 'dial';
  for (const x of taps) { const t = Number(x); if (!(t >= last) || t > T + 0.5) return { ok: false, why: 'bad timing' }; last = t; if (t > L.limit) break;
    const N = L.nums[k]; if (angDiff(safeAngle(N, t - from), N.a) <= L.tol) { k++; from = t; if (k === L.nums.length) { stage = 'open'; break; } }
    else { noise += L.wrong; if (noise >= 0.999) { stage = 'alarm'; break; } } }
  if (stage === 'dial') stage = T >= L.limit - 0.5 ? 'alarm' : 'gaveup';
  const tUsed = stage === 'open' ? from : T, perf = stage === 'open' ? clamp(0.55 + 0.3 * (1 - noise) + 0.15 * (1 - tUsed / L.limit), 0, 1) : clamp(0.3 * k / L.nums.length, 0, 0.3);
  return { ok: true, state: { t: +tUsed.toFixed(2), stage, got: k, noise: +noise.toFixed(2) }, perf, money: stage === 'open' };
}

// ======================= Spot the police (lookout) =======================
// Six windows and corners on the street. People pop up; tap the plain-clothes police (the ones with the earpiece)
// before they duck away. Every officer you miss, and every innocent you point at, adds heat; full heat and the job's
// blown. Keep watch until the time's up. Taps: [spot, time].
export const LOOK = { spots: 6, miss: 0.25, wrong: 0.15 };
export function genLook(seed, diff) {
  const r = rng(seed), pops = [], limit = 36, busy = Array(LOOK.spots).fill(0), dur0 = 1.75 - diff * 0.17; let t = 1.2;
  while (t < limit - 2) {
    let sp = Math.floor(r() * LOOK.spots); for (let i = 0; i < LOOK.spots && busy[sp] > t; i++) sp = (sp + 1) % LOOK.spots;
    const cop = r() < 0.42, dur = +(dur0 * (0.8 + r() * 0.4)).toFixed(2), look = Math.floor(r() * 1000);
    if (busy[sp] <= t) { pops.push({ s: sp, t0: +t.toFixed(2), dur, cop, look }); busy[sp] = t + dur + 0.3; }
    t += 0.55 + r() * (1.1 - diff * 0.08);
  }
  return { seed, diff, pops, limit };
}
// What the taps add up to by time T (the browser shows this live; the server checks the same).
export function lookEval(L, taps, T) {
  const tapped = new Map(), ev = []; let last = 0;
  for (const x of taps) { const sp = Number(x && x[0]), t = Number(x && x[1]); if (!(t >= last) || !(sp >= 0 && sp < LOOK.spots)) return null; last = t; if (t > T) break;
    const i = L.pops.findIndex((p, j) => p.s === sp && p.t0 <= t && t <= p.t0 + p.dur && !tapped.has(j));
    if (i < 0) continue; tapped.set(i, t); ev.push([t, L.pops[i].cop ? 0 : LOOK.wrong, L.pops[i].cop ? 'hit' : 'wrong']); }
  L.pops.forEach((p, i) => { if (p.cop && !tapped.has(i) && p.t0 + p.dur <= T) ev.push([p.t0 + p.dur, LOOK.miss, 'miss']); });
  ev.sort((a, b) => a[0] - b[0]);
  let heat = 0, hits = 0, wrong = 0, missed = 0, blown = null;
  for (const [t, h, k] of ev) { heat += h; if (k === 'hit') hits++; else if (k === 'wrong') wrong++; else missed++; if (heat >= 0.999) { blown = t; break; } }
  return { heat: Math.min(1, heat), hits, wrong, missed, blown, seen: L.pops.filter(p => p.cop && p.t0 < (blown ?? T)).length };
}
export function lookReplay(L, taps, time) {
  if (!Array.isArray(taps) || taps.length > 300) return { ok: false, why: 'bad taps' };
  const T = clamp(Number(time) || 0, 0, L.limit + 2), e = lookEval(L, taps, Math.min(T, L.limit)); if (!e) return { ok: false, why: 'bad timing' };
  const done = e.blown != null ? 'blown' : T >= L.limit - 0.5 ? 'clear' : 'gaveup', t = e.blown ?? T;
  const perf = done === 'clear' ? clamp(0.5 + 0.5 * e.hits / Math.max(1, e.seen) - 0.08 * e.wrong, 0.3, 1) : done === 'blown' ? clamp(0.25 * e.hits / Math.max(1, e.seen), 0, 0.25) : clamp(0.2 * T / L.limit, 0, 0.2);
  return { ok: true, state: { t: +t.toFixed(2), done, hits: e.hits, wrong: e.wrong, missed: e.missed, heat: +e.heat.toFixed(2) }, perf, money: done === 'clear' };
}

// ======================= Hold the doors (muscle) =======================
// Guards run at the doors from both sides. Tap a side to shove back the nearest guard on that side once they're
// close; shoving at nobody wastes your strength. Three guards through and the doors are lost. Taps: [side, time].
export const MUSCLE = { reach: 0.62, breaches: 3 };
export function genMuscle(seed, diff) {
  const r = rng(seed), guards = [], limit = 32; let t = 1;
  while (t < limit - 1.5) { guards.push({ side: r() < 0.5 ? 0 : 1, t0: +t.toFixed(2), sp: +(0.3 + diff * 0.05 + r() * 0.12).toFixed(3), look: Math.floor(r() * 1000) }); t += 0.9 - diff * 0.08 + r() * 0.7; }
  return { seed, diff, guards, limit };
}
export const guardPos = (g, t) => 1 - g.sp * (t - g.t0); // 1 = the end of the hall, 0 = at the doors
export function muscleEval(L, taps, T) {
  const shoved = new Map(); let last = 0, whiffs = 0; const whiffAt = [];
  for (const x of taps) { const side = Number(x && x[0]), t = Number(x && x[1]); if (!(t >= last) || (side !== 0 && side !== 1)) return null; last = t; if (t > T) break;
    let best = -1, bp = 9; L.guards.forEach((g, i) => { if (g.side !== side || shoved.has(i) || g.t0 > t) return; const p = guardPos(g, t); if (p > 0 && p <= MUSCLE.reach && p < bp) { bp = p; best = i; } });
    if (best >= 0) shoved.set(best, t); else { whiffs++; whiffAt.push(t); } }
  const through = L.guards.map((g, i) => [g.t0 + 1 / g.sp, i]).filter(([t, i]) => t <= T && !(shoved.has(i) && shoved.get(i) < t)).map(([t]) => t).sort((a, b) => a - b);
  const lost = through.length >= MUSCLE.breaches ? through[MUSCLE.breaches - 1] : null, until = lost ?? T;
  return { shoved: [...shoved.values()].filter(t => t <= until).length, whiffs: whiffAt.filter(t => t <= until).length, through: through.filter(t => t <= until).length, lost, shovedSet: shoved };
}
export function muscleReplay(L, taps, time) {
  if (!Array.isArray(taps) || taps.length > 600) return { ok: false, why: 'bad taps' };
  const T = clamp(Number(time) || 0, 0, L.limit + 2), e = muscleEval(L, taps, Math.min(T, L.limit)); if (!e) return { ok: false, why: 'bad timing' };
  const done = e.lost != null ? 'lost' : T >= L.limit - 0.5 ? 'held' : 'gaveup', t = e.lost ?? T;
  const perf = done === 'held' ? clamp(0.6 + 0.4 * (1 - e.through / MUSCLE.breaches) - 0.01 * e.whiffs, 0.25, 1) : done === 'lost' ? clamp(0.25 * t / L.limit, 0, 0.25) : clamp(0.2 * T / L.limit, 0, 0.2);
  return { ok: true, state: { t: +t.toFixed(2), done, shoved: e.shoved, through: e.through, whiffs: e.whiffs }, perf, money: done === 'held' };
}

// ======================= Hold off the horde (muscle) =======================
// Zombies pour into the yard behind the job from every side, in waves that get bigger, faster and hungrier. Move with
// the stick, fight with the action button: a bat to start with, and guns (pistol, shotgun, rifle) and first-aid kits
// turn up on the ground as it goes on. Survive until the crew is done. Everything here uses only + - * / and square
// roots, so a phone and the server always get exactly the same result from the same moves.
// The log: one point per step (where you were) and, per step, whether the action button was held.
export const HORDE = { speed: 5.4, r: 0.45, hp: 100, reach: 2.0, pick: 1.3, W: 34, H: 26 };
export const WEAPONS = {
  bat: { name: 'Bat', icon: '🏏', dmg: 2, cd: 0.45, range: 2.0, ammo: Infinity },
  pistol: { name: 'Pistol', icon: '🔫', dmg: 2, cd: 0.32, range: 13, ammo: 14 },
  shotgun: { name: 'Shotgun', icon: '💥', dmg: 3, cd: 0.8, range: 8.5, ammo: 8, spread: 0.82 },
  rifle: { name: 'Rifle', icon: '🎯', dmg: 1.5, cd: 0.11, range: 16, ammo: 45 },
  medkit: { name: 'First aid', icon: '🩹', heal: 35 },
};
export function genHorde(seed, diff) {
  const r = rng(seed), W = HORDE.W, H = HORDE.H, obs = [], limit = 48, kinds = ['car', 'car', 'barrier', 'crates', 'dumpster', 'barrel'];
  const free = (x, y, w, h) => Math.abs(x + w / 2 - W / 2) + Math.abs(y + h / 2 - H / 2) > 7 && obs.every(o => x + w + 2.2 < o.x || o.x + o.w + 2.2 < x || y + h + 2.2 < o.y || o.y + o.h + 2.2 < y);
  for (let i = 0, tries = 0; i < 9 && tries < 300; tries++) { const k = kinds[Math.floor(r() * kinds.length)], horiz = r() < 0.5;
    const [w, h] = k === 'car' ? (horiz ? [4.4, 2] : [2, 4.4]) : k === 'barrier' ? (horiz ? [4, 0.8] : [0.8, 4]) : k === 'crates' ? [2.2, 2.2] : k === 'dumpster' ? [2.6, 1.6] : [1, 1];
    const x = +(2.5 + r() * (W - 5 - w)).toFixed(2), y = +(2.5 + r() * (H - 5 - h)).toFixed(2); if (!free(x, y, w, h)) continue; obs.push({ x, y, w, h, k }); i++; }
  // the waves: every 9 seconds a new one, bigger, faster, tougher and hungrier than the last
  const spawns = []; let t = 1.5, wave = 0;
  while (t < limit - 2) { wave = Math.floor(t / 9);
    const n = 2 + wave + Math.floor(diff / 2), gap = Math.max(0.25, 1.6 - wave * 0.18 - diff * 0.08);
    for (let k = 0; k < n && t < limit - 2; k++) { const side = Math.floor(r() * 4), u = r();
      const x = side === 0 ? 0.6 : side === 1 ? W - 0.6 : u * (W - 2) + 1, y = side === 2 ? 0.6 : side === 3 ? H - 0.6 : u * (H - 2) + 1;
      spawns.push({ t: +t.toFixed(2), x: +x.toFixed(2), y: +y.toFixed(2), hp: 2 + Math.floor(wave / 2) + (diff >= 4 ? 1 : 0) + (r() < 0.15 ? 2 : 0), sp: +(1.7 + wave * 0.28 + diff * 0.18 + r() * 0.5).toFixed(2), dmg: +(9 + wave * 3 + diff * 2).toFixed(1), wave });
      t += gap * (0.6 + r() * 0.8); }
    t = Math.max(t, (wave + 1) * 9 + 0.5); }
  // what turns up on the ground
  const picks = [], pk = ['pistol', 'shotgun', 'medkit', 'rifle', 'pistol', 'medkit', 'shotgun', 'rifle'];
  for (let k = 0, at = 3; at < limit - 4; k++, at += 6 + r() * 3) { let x, y, n = 0; do { x = 3 + r() * (W - 6); y = 3 + r() * (H - 6); n++; } while (n < 40 && !hordeFits({ obs, W, H }, x, y)); picks.push({ t: +at.toFixed(2), x: +x.toFixed(2), y: +y.toFixed(2), k: pk[k % pk.length] }); }
  return { seed, diff, W, H, obs, spawns, picks, limit, start: { x: W / 2, y: H / 2 } };
}
export function hordeFits(L, x, y, R = HORDE.r) { if (x < R || y < R || x > L.W - R || y > L.H - R) return false; for (const o of L.obs) if (x + R > o.x && x - R < o.x + o.w && y + R > o.y && y - R < o.y + o.h) return false; return true; }
const len2 = (x, y) => Math.sqrt(x * x + y * y);
export const hordeStart = L => ({ t: 0, n: 0, x: L.start.x, y: L.start.y, fx: 0, fy: 1, hp: HORDE.hp, w: 'bat', ammo: Infinity, cd: 0, z: [], next: 0, kills: 0, picks: [], took: 0, shots: [], done: null, hit: 0 });
// Your own move for one step (the same on the phone and the server): towards (vx, vy), sliding along anything in the way.
export function hordeMove(L, s, vx, vy) { const n = len2(vx, vy); if (n > 1) { vx /= n; vy /= n; } const sp = HORDE.speed * STEP; let x = s.x, y = s.y; if (hordeFits(L, x + vx * sp, y)) x += vx * sp; if (hordeFits(L, x, y + vy * sp)) y += vy * sp; return { x, y }; }
// One step of the world, with you now at (x, y), the action button held or not. Returns the new state.
export function hordeStep(L, s0, x, y, act) {
  const s = { ...s0, z: s0.z.map(z => ({ ...z })), picks: s0.picks.map(p => ({ ...p })), shots: [] }; if (s.done) return s0;
  const mx = x - s.x, my = y - s.y, ml = len2(mx, my); if (ml > 0.01) { s.fx = mx / ml; s.fy = my / ml; } s.x = x; s.y = y;
  s.n++; s.t = +(s.n * STEP).toFixed(3); s.cd = Math.max(0, +(s.cd - STEP).toFixed(3)); s.hit = 0;
  // new arrivals
  while (s.next < L.spawns.length && L.spawns[s.next].t <= s.t) { const z = L.spawns[s.next]; s.z.push({ id: s.next, x: z.x, y: z.y, hp: z.hp, sp: z.sp, dmg: z.dmg, hurt: 0 }); s.next++; }
  for (const p of L.picks) if (p.t <= s.t && p.t > s.t - STEP - 1e-9) s.picks.push({ ...p, until: +(p.t + 12).toFixed(2) });
  s.picks = s.picks.filter(p => p.until > s.t);
  // picking things up
  for (let i = s.picks.length - 1; i >= 0; i--) { const p = s.picks[i]; if (len2(p.x - s.x, p.y - s.y) > HORDE.pick) continue;
    if (p.k === 'medkit') s.hp = Math.min(HORDE.hp, s.hp + WEAPONS.medkit.heal); else { s.w = p.k; s.ammo = WEAPONS[p.k].ammo; } s.took++; s.picks.splice(i, 1); }
  // the zombies shamble towards you (around anything in the way), keep a little apart, and bite when they reach you
  for (const z of s.z) { if (z.hp <= 0) continue; let dx = s.x - z.x, dy = s.y - z.y; const d = len2(dx, dy); if (d < 0.0001) continue; dx /= d; dy /= d;
    if (d > 0.95) { const st = z.sp * STEP; let nx = z.x + dx * st, ny = z.y + dy * st;
      if (!hordeFits(L, nx, ny, 0.4)) { if (hordeFits(L, z.x - dy * st, z.y + dx * st, 0.4)) { nx = z.x - dy * st; ny = z.y + dx * st; } else if (hordeFits(L, z.x + dy * st, z.y - dx * st, 0.4)) { nx = z.x + dy * st; ny = z.y - dx * st; } else { nx = z.x; ny = z.y; } }
      z.x = nx; z.y = ny; }
    else { s.hp -= z.dmg * STEP; s.hit = 1; }
    z.hurt = Math.max(0, z.hurt - STEP); }
  for (let i = 0; i < s.z.length; i++) for (let j = i + 1; j < s.z.length; j++) { const a = s.z[i], b = s.z[j]; if (a.hp <= 0 || b.hp <= 0) continue; const dx = b.x - a.x, dy = b.y - a.y, d = len2(dx, dy);
    if (d < 0.8 && d > 0.0001) { const push = (0.8 - d) / 2, ux = dx / d, uy = dy / d; if (hordeFits(L, a.x - ux * push, a.y - uy * push, 0.4)) { a.x -= ux * push; a.y -= uy * push; } if (hordeFits(L, b.x + ux * push, b.y + uy * push, 0.4)) { b.x += ux * push; b.y += uy * push; } } }
  // fighting back: the bat swings at whoever's close; guns aim themselves at the nearest zombie in range
  if (act && s.cd <= 0) { const W0 = WEAPONS[s.w]; let best = null, bd = 1e9; for (const z of s.z) { if (z.hp <= 0) continue; const d = len2(z.x - s.x, z.y - s.y); if (d < bd) { bd = d; best = z; } }
    s.cd = W0.cd;
    if (best && bd <= W0.range) { const ax = (best.x - s.x) / bd, ay = (best.y - s.y) / bd; s.fx = ax; s.fy = ay;
      const hits = s.w === 'shotgun' ? s.z.filter(z => { if (z.hp <= 0) return false; const d = len2(z.x - s.x, z.y - s.y); return d <= W0.range && (d < 0.01 || ((z.x - s.x) * ax + (z.y - s.y) * ay) / d >= W0.spread); })
        : s.w === 'bat' ? s.z.filter(z => { if (z.hp <= 0) return false; const d = len2(z.x - s.x, z.y - s.y); return d <= W0.range && (z === best || ((z.x - s.x) * ax + (z.y - s.y) * ay) / Math.max(d, 0.01) >= 0.3); }) : [best];
      for (const z of hits) { z.hp -= W0.dmg; z.hurt = 0.2; if (z.hp <= 0) s.kills++; const d = len2(z.x - s.x, z.y - s.y) || 1; z.x += (z.x - s.x) / d * (s.w === 'bat' ? 0.9 : 0.35); z.y += (z.y - s.y) / d * (s.w === 'bat' ? 0.9 : 0.35); if (!hordeFits(L, z.x, z.y, 0.4)) { z.x -= (z.x - s.x) / d * 0.5; z.y -= (z.y - s.y) / d * 0.5; } }
      s.shots = hits.map(z => [+z.x.toFixed(2), +z.y.toFixed(2)]); }
    else s.shots = [[+(s.x + s.fx * Math.min(W0.range, 6)).toFixed(2), +(s.y + s.fy * Math.min(W0.range, 6)).toFixed(2)]];
    if (W0.ammo !== Infinity) { s.ammo--; if (s.ammo <= 0) { s.w = 'bat'; s.ammo = Infinity; } } }
  s.z = s.z.filter(z => z.hp > 0 || z.hurt > 0.05); for (const z of s.z) if (z.hp <= 0) z.dead = 1;
  if (s.hp <= 0) { s.hp = 0; s.done = 'down'; } else if (s.t >= L.limit) s.done = 'held';
  return s;
}
export function hordePerf(L, s) {
  const expect = Math.max(1, L.spawns.filter(z => z.t < s.t).length);
  if (s.done === 'held') return { perf: clamp(0.5 + 0.3 * s.hp / HORDE.hp + 0.2 * Math.min(1, s.kills / (expect * 0.6)), 0, 1), money: true };
  return { perf: clamp(0.3 * s.t / L.limit, 0, 0.3), money: false };
}
export function hordeReplay(L, log) {
  const path = log && log.path, acts = String((log && log.acts) || ''); if (!Array.isArray(path) || path.length < 2 || path.length > Math.ceil(L.limit / STEP) + 2) return { ok: false, why: 'bad path' };
  let s = hordeStart(L);
  for (let i = 1; i < path.length && !s.done; i++) {
    const [x, y] = (path[i] || []).map(Number); if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, why: 'bad point' };
    const dx = x - s.x, dy = y - s.y, d = len2(dx, dy); if (d > HORDE.speed * STEP + 0.02) return { ok: false, why: 'too fast' };
    const q = hordeMove(L, s, d ? dx / (HORDE.speed * STEP) : 0, d ? dy / (HORDE.speed * STEP) : 0); if (len2(q.x - x, q.y - y) > 0.03 || !hordeFits(L, x, y)) return { ok: false, why: 'walked through something' };
    s = hordeStep(L, s, x, y, acts[i] === '1');
  }
  if (!s.done) s.done = s.t >= L.limit - 0.05 ? 'held' : 'gaveup';
  return { ok: true, state: { t: s.t, done: s.done, hp: Math.round(s.hp), kills: s.kills, took: s.took }, ...hordePerf(L, s) };
}

// How long a game must at least take (a fast human), so a result can't come back quicker than it could be played.
export function minTime(kind, L, st) {
  if (kind === 'rob' || kind === 'driver' || kind === 'lookout' || kind === 'muscle') return st && st.t ? st.t : 0; // the horde (muscle) has to be survived in real time too
  if (kind === 'scam') return (st?.turns || 1) * 0.8;
  if (kind === 'atm' || kind === 'hacker') return L.wires.length * 0.35 + L.pin.length * 0.2;
  if (kind === 'safecracker') return (st?.got || 0) * 0.4;
  return 0;
}
export function levelOf(kind, seed, diff, hard = false) {
  const g = GAMES[kind];
  return g === 'stealth' ? genStealth(seed, diff) : g === 'con' ? genCon(seed, diff) : g === 'atm' ? genAtm(seed, diff, hard) : g === 'drive' ? genDrive(seed, diff) : g === 'safe' ? genSafe(seed, diff) : g === 'lookout' ? genLook(seed, diff) : g === 'horde' ? genHorde(seed, diff) : genMuscle(seed, diff);
}
export function replay(kind, L, log) {
  const g = GAMES[kind], x = log || {};
  if (g === 'stealth') return stealthReplay(L, x.path);
  if (g === 'con') return conReplay(L, x.picks);
  if (g === 'atm') return atmReplay(L, x.events, x.time);
  if (g === 'drive') return driveReplay(L, x.moves);
  if (g === 'safe') return safeReplay(L, x.taps, x.time);
  if (g === 'lookout') return lookReplay(L, x.taps, x.time);
  if (g === 'muscle') return muscleReplay(L, x.taps, x.time);
  if (g === 'horde') return hordeReplay(L, x);
  return { ok: false, why: 'unknown game' };
}
