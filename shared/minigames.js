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
export const STEALTH = { speed: 3.2, grab: 1.5, grabR: 0.95, exitR: 0.8, fill: 1.25, fillD: 0.13, drain: 0.5,
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
  const L = { seed, diff, W, H, wall: Array.from(wall), entry, till, guards: [], cams: [], lasers: [], items: [], limit: 56 - diff * 2 };
  if (!pathCells(L, cell(entry), cell(till))) return null;
  // the round: random floor spots joined up along the aisles
  const floors = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!at(x, y)) floors.push([x, y]);
  const nG = diff >= 5 ? 2 : 1, far = f => Math.hypot(f[0] + 0.5 - entry.x, f[1] + 0.5 - entry.y) >= 3;
  for (let g = 0; g < nG; g++) {
    // a wander: walk to a random spot, stop, look around (two or three glances), then on to another; never the same twice
    const speed = 1.1 + diff * 0.11, legs = []; let at0 = floors.filter(far)[Math.floor(r() * floors.filter(far).length)], t = -3;
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
  const nC = plain ? 0 : 1 + Math.max(0, diff - 3); // there's always CCTV: one camera, then one more for each step past 3
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
// Tripping a laser sets off a beep, and the nearest member of staff who isn't already checking one walks over to the spot
// (along the aisles, a little quicker than their usual pace), looks around for a moment, walks back, and carries on their
// round from where they left it. Each guard's latest call-out is kept in the game state (s.al), with how far their round
// has been put back by earlier ones (s.sh), so the phone and the server work out exactly the same moves.
export const ALERT = { look: 2.4, speed: 1.7, perDiff: 0.18 };
function alertPlan(L, from, to, t0) {
  const cells = pathCells(L, cell(from), cell(to)); if (!cells) return null;
  const pts = [{ x: from.x, y: from.y }, ...cells.slice(1).map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }))], cum = [0]; let len = 0;
  for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(len); }
  const sp = ALERT.speed + L.diff * ALERT.perDiff, walk = len / sp;
  return { t0, pts, cum, len, walk, total: walk * 2 + ALERT.look };
}
function alongPath(a, d) { let i = 1; while (i < a.cum.length - 1 && a.cum[i] < d) i++;
  const p0 = a.pts[i - 1], p1 = a.pts[i] || p0, seg = Math.max(1e-6, a.cum[i] - a.cum[i - 1]), u = clamp((d - a.cum[i - 1]) / seg, 0, 1);
  return { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u, dx: p1.x - p0.x, dy: p1.y - p0.y }; }
// Where staff member i is at time t, given the game state s (their call-outs to tripped lasers).
export function staffAt(L, i, t, s) {
  const g = L.guards[i], a = s && s.al ? s.al[i] : null, sh = s && s.sh ? s.sh[i] || 0 : 0;
  if (!a || t < a.t0) return guardAt(g, t - sh);
  const k = t - a.t0;
  if (k >= a.total) return guardAt(g, t - sh - a.total);
  if (k < a.walk) { const q = alongPath(a, k / a.walk * a.len); return { x: q.x, y: q.y, dir: Math.atan2(q.dy, q.dx), alert: 'go' }; }
  const end = a.pts[a.pts.length - 1], prev = a.pts[a.pts.length - 2] || end, d0 = Math.atan2(end.y - prev.y, end.x - prev.x);
  if (k < a.walk + ALERT.look) { const f = (k - a.walk) / ALERT.look; return { x: end.x, y: end.y, dir: d0 + (f < 0.34 ? -1.1 : f < 0.67 ? 1.1 : 0), still: true, alert: 'look' }; }
  const q = alongPath(a, (1 - (k - a.walk - ALERT.look) / a.walk) * a.len); return { x: q.x, y: q.y, dir: Math.atan2(-q.dy, -q.dx), alert: 'back' };
}
// Who can see the point p at time t (0 = nobody).
export function seenBy(L, t, p, st) {
  for (let i = 0; i < L.guards.length; i++) { const s = staffAt(L, i, t, st); if (inCone(s, s.dir, STEALTH.guardFov, STEALTH.guardRange + L.diff * 0.2, p) && clear(L, s, p)) return 1; }
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
  const t = +(s.t + STEP).toFixed(3), p = { x, y }; let who = seenBy(L, t, p, s);
  let seen = who ? s.seen + STEP * (STEALTH.fill + STEALTH.fillD * L.diff) : Math.max(0, s.seen - STEP * STEALTH.drain);
  // a laser: tripping one (stepping onto it while it's on) sets the alarm half off
  let zap = s.zap || 0, al = s.al, sh = s.sh; const onAny = (L.lasers || []).some(z => laserOn(z, t) && onLaser(z, p)); if (onAny && !s.onLaser) { seen += STEALTH.laser; zap++; who = 3;
    // the beep brings the nearest free member of staff over to look
    let best = -1, bd = 1e9; for (let i = 0; i < L.guards.length; i++) { const a = al ? al[i] : null; if (a && t < a.t0 + a.total) continue; const q = staffAt(L, i, t, s), d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) { const from = staffAt(L, best, t, s), plan = alertPlan(L, from, p, t); if (plan) { const old = al ? al[best] : null; al = (al || L.guards.map(() => null)).slice(); sh = (sh || L.guards.map(() => 0)).slice();
      if (old) sh[best] += old.total; al[best] = plan; } } }
  // the extra loot: stand next to one long enough to bag it
  let items = s.items || 0, ig = s.ig || 0, ii = -1; (L.items || []).forEach((it, k) => { if (!(items & (1 << k)) && Math.hypot(x - it.x, y - it.y) < STEALTH.itemR) ii = k; });
  if (ii >= 0 && ii === s.ii) { ig += STEP; if (ig >= STEALTH.itemGrab) { items |= 1 << ii; ig = 0; ii = -1; } } else ig = ii >= 0 ? STEP : 0;
  const peak = Math.max(s.peak, seen), near = Math.hypot(x - L.till.x, y - L.till.y) < STEALTH.grabR;
  const grab = s.grabbed ? STEALTH.grab : near ? s.grab + STEP : s.grab, grabbed = grab >= STEALTH.grab;
  const out = { t, x, y, seen: Math.min(1, seen), peak: Math.min(1, peak), who, grab, grabbed, done: null, onLaser: onAny, zap, items, ig, ii, al, sh };
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
// Sell a tourist a "genuine" Gliese moon rock. Every tourist is somebody (thirteen kinds: a collector, a bargain hunter,
// honeymooners, a geology professor, an executive in a hurry, a nervous first-timer, an influencer, a retired miner, a
// broke student, a conspiracy theorist, a shuttle pilot, a grandparent after a present, an art dealer), each with
// approaches they love and ones they can't stand, and their own way of putting things. Each turn they raise a real worry,
// worked out from how the talk is going (suspicious tourists want proof or wonder about you; warm ones get to the price,
// their partner, or the final "I'm tempted…"). You pick one of four lines (eight kinds of approach) and time it on the
// bar. Answer what they actually asked and trust climbs; dodge it and they ask again, more suspicious; say the same kind
// of thing twice and it wears thin. They react to what you said, and their face shows how it's going. Trust 100 = sold.
// Suspicion 100 = they walk. All worked out from the moves alone, so the server replays it exactly (the wording varies,
// but only the kind of approach you picked counts).
export const CON_TACTICS = {
  facts: { name: 'Facts', icon: '📜' }, show: { name: 'Show it', icon: '🔦' }, story: { name: 'Story', icon: '📖' }, flatter: { name: 'Flattery', icon: '🌹' },
  charm: { name: 'Charm', icon: '😄' }, deal: { name: 'Deal', icon: '🏷️' }, rush: { name: 'Hurry them', icon: '⏳' }, listen: { name: 'Listen', icon: '👂' },
};
// What a tourist can be worried about, what they say, and how well each approach answers it (2 just right, 1 fair, 0 beside the point, -1 wrong move).
// (New worries go at the end: the order is part of how each turn's options are drawn.)
export const CON_WORRIES = {
  open: { say: ['What are you selling?', 'What have you got there?', 'Is that… a rock?', 'Are you talking to me?', 'What\'s in the little box?'], again: ['I asked what you\'re selling.', 'So what is it, then?'],
    fit: { charm: 2, story: 2, show: 1, flatter: 1, facts: 0, listen: 0, deal: -1, rush: -1 } },
  proof: { say: ['How do I know it\'s really from the moon?', 'It looks like a painted pebble to me.', 'Anyone can say "moon rock". Can you prove it?', 'My cousin bought a "moon rock". It was concrete.', 'Real moon rock is in museums, not in pockets.'], again: ['You still haven\'t shown me it\'s real.', 'Again: how do I know it\'s genuine?', 'Proof. I\'m still waiting.'],
    fit: { facts: 2, show: 2, story: 1, listen: 0, charm: 0, flatter: -1, deal: -1, rush: -1 } },
  price: { say: ['That\'s a lot of money for a rock.', 'What\'s it going to cost me?', 'I could buy a shuttle ticket for that.', 'How much? You\'re joking.', 'And what\'s the catch with the price?'], again: ['You didn\'t answer me. The price?', 'The price. Again.'],
    fit: { deal: 2, flatter: 1, story: 1, listen: 1, facts: 0, charm: 0, show: 0, rush: -1 } },
  time: { say: ['I\'ve got a shuttle to catch.', 'Make it quick, please.', 'I really don\'t have long.', 'My tour group is leaving without me.', 'Thirty seconds. Go.'], again: ['I said I\'m in a hurry!', 'Quicker, please! I said I\'m late!'],
    fit: { rush: 2, deal: 2, show: 1, facts: 0, charm: 0, flatter: 0, story: -1, listen: -1 } },
  need: { say: ['What would I even do with a moon rock?', 'Why would I want one?', 'Where would I put it?', 'I already have a rock. In my garden.', 'It\'s nice, but what\'s it for?'], again: ['You still haven\'t said why I\'d want it.', 'Again: why would I need it?'],
    fit: { story: 2, flatter: 2, charm: 1, show: 1, listen: 1, facts: 0, deal: 0, rush: -1 } },
  trust: { say: ['Why should I trust a stranger in the street?', 'You\'re not one of those scammers, are you?', 'Something about this feels off.', 'The guidebook warned me about people like you.', 'Who are you, exactly?'], again: ['I\'m still not sure about you.', 'I still don\'t know who you are.'],
    fit: { listen: 2, charm: 2, facts: 1, story: 1, show: 0, deal: 0, flatter: -1, rush: -1 } },
  partner: { say: ['I should ask my partner first.', 'My other half would kill me.', 'Let me think it over with my partner.', 'We agreed: no souvenirs this trip.', 'My partner does the money.'], again: ['I really ought to ask my partner.', 'My partner, though… I really should ask.'],
    fit: { flatter: 2, rush: 1, deal: 1, story: 1, listen: 1, charm: 0, show: 0, facts: -1 } },
  close: { say: ['I\'m tempted… really tempted.', 'Okay. Convince me one last time.', 'If I say yes, is that it?', 'Oh, go on then… or should I?', 'My hand\'s on my wallet. Last chance.'], again: ['Go on, give me a reason to say yes.', 'Nearly. Go on, one more reason.'],
    fit: { rush: 2, deal: 2, flatter: 1, charm: 1, listen: 0, facts: 0, show: 0, story: 0 } },
  customs: { say: ['Can I even take this off-planet?', 'Won\'t customs take it off me at the spaceport?', 'Is this legal to sell?', 'Do I need a permit for that?'], again: ['You didn\'t say: will customs let it through?', 'The customs thing still bothers me.'],
    fit: { facts: 2, listen: 2, story: 1, charm: 1, show: 0, deal: 0, flatter: -1, rush: -1 } },
  gift: { say: ['It\'s for my grandson. Would a child even like it?', 'I need a present for someone special.', 'Would it make a good gift?', 'Will it survive a nine-year-old?'], again: ['Again: would they like it, as a present?', 'You didn\'t say if it\'s a good gift.'],
    fit: { story: 2, show: 2, charm: 1, listen: 1, flatter: 0, facts: 0, deal: 0, rush: -1 } },
};
// What you can say: lines for each approach and each worry (one of them is picked each turn).
const CON_LINES = {
  facts: {
    open: ['Genuine lunar basalt from Gliese 12 b\'s second moon. Registered.', 'Lunar basalt, Gliese 12 b, second moon. Serial number on the base.'],
    proof: ['Number 17 of the 40 ever brought back. Here\'s the Geology Office stamp.', 'Iron spherules, zero water content. Earth rocks can\'t fake that.'],
    price: ['At auction they go for ten times this. Look up lot 17.', 'The last one sold for 40,000 at Kepler Station. Records are public.'],
    time: ['Registered, stamped, boxed. Ten seconds and it\'s yours.', 'Paperwork\'s already done. Sign here.'],
    need: ['It\'s an appreciating asset: they\'ve doubled in value in two years.', 'Only forty exist. In ten years they\'ll be in museums.'],
    trust: ['My licence number\'s on the certificate. Check it with the Colony Office.', 'Licensed trader, number 4471. It\'s on my badge.'],
    partner: ['Show them the certificate: it speaks for itself.', 'Tell them it\'s worth more next year than today.'],
    close: ['Certificate, stamp, serial number. Everything\'s in order.', 'Fully documented. You\'re buying the paperwork as much as the rock.'],
    customs: ['Export form C-12, already filled in. Customs see these every day.', 'Under 200 grams and registered: completely legal to take off-world.'],
    gift: ['Educational too: it comes with a card about the moon it\'s from.', 'Safe, sealed and non-toxic. Tested.'],
  },
  show: {
    open: ['Hold it to the light. See the blue flecks? Only moon iron does that.', 'Look closer. It sparkles like nothing down here.'],
    proof: ['Here, scratch it with your key. Moon iron doesn\'t mark.', 'Put it near your compass. Watch the needle.'],
    price: ['Feel the weight of it. That\'s what you\'re paying for.', 'Look at the grain. You can\'t fake that for any price.'],
    time: ['Just hold it for one second. Feel that? Done.', 'One look. That\'s all it takes.'],
    need: ['Picture it on your shelf, catching the light every morning.', 'Look how it glows in the dark. Bedside lamp and moon in one.'],
    trust: ['Hold it yourself. I\'m not going anywhere.', 'Take it. Turn it over. Look as long as you like.'],
    partner: ['Take a photo and send it to them right now.', 'Video-call them. Let them see it sparkle.'],
    close: ['Look at it glow. That\'s not going to be on any shelf but yours.', 'Hold it one more time. Now try giving it back.'],
    customs: ['See this seal on the box? That\'s the customs mark.', 'Look, the export tag is already on it.'],
    gift: ['Look at it in the dark… it glows. Kids go wild for that.', 'Feel it: smooth as a pebble, small enough for a pocket.'],
  },
  story: {
    open: ['My grandmother was on the first mining crew. This is the last piece she kept.', 'This rock has crossed eleven light years. Let me tell you how.'],
    proof: ['It came down on the Ardent supply run. I was there when they unloaded it.', 'The pilot who brought it back still drinks at the Rusty Moon. Ask him.'],
    price: ['I\'d never sell, but my daughter\'s school fees are due.', 'My landlord wants the rent by Friday, or I\'d keep it forever.'],
    time: ['Long story short: it\'s the last one.', 'Short version: one left, and you\'re here.'],
    need: ['A rock that\'s travelled further than anyone you know. Imagine telling that story.', 'Every dinner party for the rest of your life starts with "this came from a moon".'],
    trust: ['I\'ve had this stall nine years. Everyone here knows me.', 'Ask the baker over there. She\'s known me since I was ten.'],
    partner: ['Imagine their face when you give them a piece of the moon.', 'My wife said the same thing once. Now she wears one on a chain.'],
    close: ['You\'ll tell this story for the rest of your life.', 'One day someone will ask where you got it. And you\'ll smile.'],
    customs: ['Last week a lady took one through. Customs asked for her autograph.', 'My cousin works at the spaceport. They wave these through.'],
    gift: ['When I was small my grandad gave me one. I still remember that day.', 'Give it at bedtime with the story of the moon it came from.'],
  },
  flatter: {
    open: ['You look like someone who knows a real treasure.', 'I could tell from across the square you\'ve got an eye for things.'],
    proof: ['Someone with your eye can see it\'s real.', 'You know quality. Look at it and tell me it\'s fake.'],
    price: ['For someone of your taste, it\'s a bargain.', 'Clever people buy before the price goes up. Like you.'],
    time: ['Busy people like you don\'t miss chances like this.', 'Someone important like you decides fast.'],
    need: ['It suits you. Honestly.', 'It matches your eyes. I\'m serious.'],
    trust: ['I only show this to people I trust. You\'re one of them.', 'I knew you were the right person the moment I saw you.'],
    partner: ['They\'ll say you\'ve got the best taste in the colony.', 'Your partner\'s lucky to have someone with your eye.'],
    close: ['You were made for this piece.', 'Honestly? It\'s been waiting for you.'],
    customs: ['They never stop someone as respectable as you.', 'One look at you and customs will wave you through.'],
    gift: ['Any child would love a present from someone like you.', 'With your taste, it\'ll be the best present they ever get.'],
  },
  charm: {
    open: ['If it\'s not real, I\'ll eat it. With ketchup.', 'Good news: you\'ve just met the best salesman on the planet.'],
    proof: ['If it\'s fake, come back and I\'ll buy you dinner.', 'If it\'s from Earth, I\'m from Mars. And I\'m not.'],
    price: ['Cheaper than therapy, and twice as uplifting.', 'Cheaper than a moon holiday, and no space sickness.'],
    time: ['I\'ll be quicker than your shuttle, promise.', 'I talk fast. Faster than light, nearly.'],
    need: ['Everyone needs a moon. This one\'s pocket-sized.', 'Paperweight, conversation piece, tiny pet that never needs feeding.'],
    trust: ['Do I look like a criminal? Don\'t answer that.', 'My mother says I\'m honest. She\'s never wrong.'],
    partner: ['Tell them the moon said hello.', 'Tell them it\'s cheaper than a divorce.'],
    close: ['Come on, say yes. Make a lonely rock happy.', 'Say yes and I\'ll stop talking. Promise.'],
    customs: ['Customs? They\'ve got bigger rocks to worry about.', 'If they stop you, tell them it\'s your lucky pebble. Works every time.'],
    gift: ['Kids love it. Adults love it. My dog loves it.', 'Better than socks. Everything\'s better than socks.'],
  },
  deal: {
    open: ['Half price today, just for you.', 'Special price, today only.'],
    proof: ['Real or not, at this price you can\'t lose.', 'Cheap enough that it doesn\'t matter.'],
    price: ['Cash today and I\'ll knock off a third.', 'Tell you what: I\'ll throw in the display case.'],
    time: ['Quick deal: half price if you pay now.', 'Pay now, skip the haggling: best price.'],
    need: ['At this price, it\'s a gift for anyone.', 'At this price, buy two and decide later.'],
    trust: ['Pay half now, half when you\'ve had it checked.', 'Pay when you\'re happy. I\'ll wait right here.'],
    partner: ['I\'ll throw in a second one for them, free.', 'Two for the price of one: one for each of you.'],
    close: ['Final offer: half price and a certificate frame.', 'Last price, and I\'m losing money on it.'],
    customs: ['Customs fee included in the price.', 'I\'ll knock off a bit in case customs charge you.'],
    gift: ['I\'ll wrap it for free, with a bow.', 'Gift box and card included, no extra charge.'],
  },
  rush: {
    open: ['Quick, before the customs officer comes back!', 'Psst, over here, quick, before anyone sees!'],
    proof: ['No time for tests, another buyer\'s on the way.', 'You can test it later. Right now, it\'s going.'],
    price: ['The price doubles when the shuttle docks.', 'Price goes up at noon. It\'s five to.'],
    time: ['Then let\'s be quick: take it, it\'s yours.', 'Done in one breath: cash, rock, bye.'],
    need: ['Decide now, there\'s one left.', 'No time to think: it\'s the last one.'],
    trust: ['Trust me, there\'s no time!', 'Never mind me, look at the queue!'],
    partner: ['Your partner isn\'t here. The rock is, and not for long.', 'By the time you\'ve asked, it\'s gone.'],
    close: ['Last chance. Yes or no?', 'Three… two…'],
    customs: ['Don\'t worry about customs, just be quick!', 'Hide it in your sock, nobody checks socks!'],
    gift: ['Buy it now, worry about the wrapping later!', 'Presents sell out fast. Quick!'],
  },
  listen: {
    open: ['You look tired. Long trip?', 'First time in the colony? How are you finding it?'],
    proof: ['That\'s fair. What would convince you?', 'Good question. What would you check, if you could?'],
    price: ['I hear you. What were you hoping to spend?', 'That\'s fair. What\'s your budget?'],
    time: ['I understand. Shall I be brief?', 'Of course. How long have you got?'],
    need: ['What do you love collecting back home?', 'What sort of things do you keep on your shelves?'],
    trust: ['You\'re right to be careful. Ask me anything.', 'Fair enough. What would make you feel easier?'],
    partner: ['Of course. What do you think they\'d say?', 'Sensible. What do they like?'],
    close: ['Take your time. What\'s holding you back?', 'No pressure. What\'s your gut telling you?'],
    customs: ['Good question. Where are you flying to?', 'Sensible. Which spaceport? I\'ll tell you what they allow.'],
    gift: ['Tell me about them. What are they into?', 'How old are they? What do they love?'],
  },
};
// How they react to the last thing you said: when it landed, when it fell flat, and when it was the wrong move.
const CON_REACT = {
  good: { facts: ['Number 17… with a certificate? Okay.', 'Hm. That does sound official.'], show: ['Huh. It really does glow.', 'Ooh. Look at that.'], story: ['Aww. That\'s quite a story.', 'Really? Wow.'],
    flatter: ['Well… I do have a good eye.', 'Oh, stop it. Go on.'], charm: ['Ha! You\'re funny.', 'Okay, that made me laugh.'], deal: ['Now that\'s more like it.', 'Now we\'re talking.'],
    rush: ['Right, right, quickly then.', 'Yes, fine, quick.'], listen: ['Finally, someone who listens.', 'Well, since you ask…'] },
  meh: ['Hmm.', 'Okay…', 'If you say so.', 'Right.', 'I see.', 'Uh-huh.'],
  bad: { facts: ['I didn\'t ask for a lecture.', 'Numbers, numbers. So what?'], show: ['Don\'t wave it in my face.', 'Put it away, people are looking.'], story: ['I don\'t need your life story.', 'Is this going somewhere?'],
    flatter: ['Flattery won\'t work on me.', 'Oh please.'], charm: ['This isn\'t a joke to me.', 'Very funny. Not.'], deal: ['Cheap? Then it\'s fake.', 'Why so cheap? What\'s wrong with it?'],
    rush: ['Don\'t rush me!', 'Whoa, slow down!'], listen: ['I don\'t have time for chit-chat.', 'Why are you asking me questions?'] },
  repeat: ['You said that already.', 'You keep saying that.', 'Heard it.'],
};
// The tourists: who they are, what they love (+), what they can't stand (−), what's on their mind (how often each worry
// comes up), how they say hello, how they say some things in their own words, and what they say at the end.
export const CON_PERSONAS = {
  collector: { title: 'Collector', likes: ['facts', 'show', 'flatter'], hates: ['charm', 'deal'], worries: { proof: 3, price: 1, trust: 1, need: 1 },
    hi: ['Ooh. I collect rare minerals, you know.', 'Is that what I think it is?'], say: { proof: ['I\'ve seen a hundred fakes. Convince me this isn\'t one.'] },
    yes: 'For my collection. Wrap it carefully!', no: 'Not up to my standards. Good day.' },
  bargain: { title: 'Bargain hunter', likes: ['deal', 'charm'], hates: ['flatter', 'story'], worries: { price: 3, trust: 1, proof: 1, time: 1 },
    hi: ['Whatever it is, it\'s too expensive.', 'I never pay the first price. Never.'], say: { price: ['I\'ll give you a quarter of that. Maybe.'] },
    yes: 'Deal. And I still think I won.', no: 'Too dear. I\'ll find one cheaper.' },
  honeymoon: { title: 'Honeymooner', likes: ['story', 'flatter', 'charm'], hates: ['rush', 'facts'], worries: { need: 2, partner: 3, price: 1 },
    hi: ['We\'re on our honeymoon! Isn\'t it beautiful here?', 'Just married! Can you tell?'], say: { partner: ['My husband\'s in the gift shop. Should I ask him?', 'My wife says we have to save for the house.'] },
    yes: 'A piece of the moon for our honeymoon! Sold!', no: 'Sorry, we\'re saving for the house.' },
  professor: { title: 'Geology professor', likes: ['show', 'facts'], hates: ['charm', 'flatter', 'rush'], worries: { proof: 4, trust: 1, price: 1 },
    hi: ['I teach planetary geology. Show me what you have.', 'Basalt? Breccia? Let me see.'], say: { proof: ['What\'s the iron content? Has it been dated?', 'Lunar basalt has no water in it. Does this?'] },
    yes: 'Remarkable. My students will love this.', no: 'Painted pumice. I\'m reporting you.' },
  executive: { title: 'Executive in a hurry', likes: ['rush', 'deal', 'show'], hates: ['story', 'listen'], worries: { time: 3, price: 2, proof: 1 },
    hi: ['You\'ve got thirty seconds.', 'I\'m between meetings. Talk.'], say: { time: ['My car\'s waiting. Bottom line?'] },
    yes: 'Fine. Send the invoice to my assistant.', no: 'Waste of my time.' },
  nervous: { title: 'First-time traveller', likes: ['listen', 'charm', 'story'], hates: ['rush', 'deal'], worries: { trust: 3, need: 1, partner: 1, proof: 1 },
    hi: ['Oh! Um. Hello. Is this allowed?', 'Sorry, am I in the way?'], say: { trust: ['My mum said not to talk to people selling things…'] },
    yes: 'Okay! My first ever souvenir!', no: 'I… I think I\'d better go. Sorry!' },
  influencer: { title: 'Influencer', likes: ['show', 'flatter', 'story'], hates: ['facts', 'listen'], worries: { need: 2, price: 1, proof: 1, time: 1 },
    hi: ['Wait, is that content? Hold it up for the camera.', 'Say hi to my 80,000 followers!'], say: { need: ['Will it look good on camera, though?'] },
    yes: 'Unboxing video tonight! Tag yourself!', no: 'Not on brand. Bye!' },
  miner: { title: 'Retired miner', likes: ['story', 'listen', 'show'], hates: ['flatter', 'rush'], worries: { proof: 2, trust: 2, need: 1, price: 1 },
    hi: ['Forty years down the Gliese pits, I was. I know my rocks.', 'Hah. Moon rock, is it?'], say: { proof: ['I dug rock like that for a living. Let me feel it.'], trust: ['I\'ve met your sort down the pits. Smooth talkers.'] },
    yes: 'Takes me back. I\'ll have it.', no: 'That\'s off a building site. Nice try, lad.' },
  student: { title: 'Broke student', likes: ['deal', 'charm', 'story'], hates: ['facts', 'flatter'], worries: { price: 3, need: 1, trust: 1 },
    hi: ['I\'ve got about eleven coins and a sandwich.', 'Is it free? Please say it\'s free.'], say: { price: ['I literally live on noodles.', 'Do you take student discount?'] },
    yes: 'Noodles for a month, but worth it!', no: 'Can\'t afford rent, never mind rocks.' },
  conspiracy: { title: 'Conspiracy theorist', likes: ['story', 'listen', 'show'], hates: ['facts', 'rush'], worries: { trust: 3, proof: 2, customs: 1 },
    hi: ['They don\'t want you to know about moon rocks. Who sent you?', 'Keep your voice down. They\'re listening.'], say: { proof: ['Certificates? Anyone can print a certificate.'], trust: ['Are you with the Colony Office? Blink twice.'] },
    yes: 'I knew it! They can\'t hide the truth forever.', no: 'You\'re one of them. I knew it!' },
  pilot: { title: 'Shuttle pilot', likes: ['facts', 'deal', 'rush'], hates: ['story', 'flatter'], worries: { customs: 3, time: 2, price: 1 },
    hi: ['I fly the Kepler run. I\'ve seen every trick in the book.', 'Got twenty minutes before pre-flight.'], say: { customs: ['I go through customs twice a day. They\'d have this off me.'] },
    yes: 'Fine. It can ride up front with me.', no: 'I\'ve flown smuggled rocks before. Not again.' },
  grandparent: { title: 'Grandparent after a present', likes: ['story', 'charm', 'listen'], hates: ['rush', 'facts'], worries: { gift: 3, price: 1, need: 1 },
    hi: ['Hello, dear. I\'m looking for a present for my grandson.', 'Oh, how lovely. What is it, dear?'], say: { gift: ['Little Tomasz loves space. Would he like it?'] },
    yes: 'He\'ll be over the moon! Wrap it nicely, dear.', no: 'I\'ll just get him a book, dear.' },
  dealer: { title: 'Art dealer', likes: ['facts', 'flatter', 'show'], hates: ['deal', 'charm'], worries: { proof: 2, price: 2, need: 1, customs: 1 },
    hi: ['I deal in rare objects. Impress me.', 'Provenance, darling. Where did it come from?'], say: { price: ['If it\'s real, it\'s underpriced. Which worries me.'] },
    yes: 'I\'ll have it valued. You\'d better be right.', no: 'Tat. Goodbye.' },
};
const CON_NAMES = { f: ['Amara', 'Lena', 'Sofia', 'Mei', 'Zara', 'Ife', 'Aiko', 'Elsa', 'Ngozi', 'Priya', 'Ingrid', 'Yara', 'Hana', 'Rosa', 'Adaeze'], m: ['Kofi', 'Ravi', 'Tunde', 'Jonas', 'Diego', 'Noah', 'Mateo', 'Chidi', 'Kenji', 'Emeka', 'Lars', 'Omar', 'Bruno', 'Arjun', 'Seun'] };
const CON_FROM = ['Proxima b', 'Kepler Station', 'TRAPPIST-1e', 'Ross 128 b', 'Earth (Lagos)', 'Earth (Lisbon)', 'Wolf 1061 c', 'Earth (Osaka)', 'Teegarden b', 'Earth (Nairobi)', 'Earth (Oslo)', 'Luyten b', 'Barnard Station', 'Earth (Lima)'];
export function genCon(seed, diff) {
  const r = rng(seed), ids = Object.keys(CON_PERSONAS), persona = ids[Math.floor(r() * ids.length)];
  const gender = r() < 0.5 ? 'f' : 'm', names = CON_NAMES[gender];
  return { seed, diff, persona, gender, name: names[Math.floor(r() * names.length)], from: CON_FROM[Math.floor(r() * CON_FROM.length)],
    turns: 7, need: 100, zone: Math.max(0.12, 0.3 - diff * 0.03), limit: 80 };
}
const conRng = (L, turn, salt) => rng(((L.seed * 31 + turn * 7919 + salt * 104729) >>> 0) || 1);
const oneOf = (a, r) => Array.isArray(a) ? a[Math.floor(r() * a.length)] : a;
export const conStart = L => ({ trust: 0, sus: 0, turn: 0, worry: 'open', again: 0, last: null, q: null, done: null });
// The four lines on offer: always one that answers the worry just right (not the approach you used last), one wrong move,
// and two others, in a shuffled order. The wording is drawn separately, so it never changes which approaches are offered.
export function conOptions(L, st) {
  const W = CON_WORRIES[st.worry], r = conRng(L, st.turn, Object.keys(CON_WORRIES).indexOf(st.worry) + 1), all = Object.keys(CON_TACTICS);
  const best = all.filter(t => W.fit[t] === 2 && t !== st.last), bad = all.filter(t => W.fit[t] === -1), pick = [];
  const take = list => { const ok = list.filter(t => !pick.includes(t)); if (ok.length) pick.push(ok[Math.floor(r() * ok.length)]); };
  take(best.length ? best : all.filter(t => W.fit[t] === 2)); take(bad); while (pick.length < 4) take(all);
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
  const w = conRng(L, st.turn, 50 + st.again);
  return pick.map(t => ({ tactic: t, line: oneOf(CON_LINES[t][st.worry], w) }));
}
// What the tourist says now: their reaction to your last line, then what's on their mind (in their own words, if they have some).
export function conSay(L, st) {
  const P = CON_PERSONAS[L.persona], W = CON_WORRIES[st.worry], r = conRng(L, st.turn, 99), own = !st.again && P.say && P.say[st.worry];
  const ask = st.again ? oneOf(W.again, r) : own && r() < 0.6 ? oneOf(own, r) : oneOf(W.say, r);
  const react = st.q === 'repeat' ? oneOf(CON_REACT.repeat, r) : st.q === 'good' ? oneOf(CON_REACT.good[st.last], r) : st.q === 'bad' ? oneOf(CON_REACT.bad[st.last], r) : st.q === 'meh' ? oneOf(CON_REACT.meh, r) : oneOf(P.hi, r);
  return `${react} ${ask}`;
}
// Their last word, once it's over.
export function conBye(L, st) { const P = CON_PERSONAS[L.persona]; return st.done === 'sold' ? P.yes : P.no; }
// Their face: how the talk is going for them.
export function conMood(L, st) {
  if (st.trust >= 75 && st.sus < 50) return { face: '🤩', name: 'eager' }; if (st.sus >= 70) return { face: '😠', name: 'annoyed' };
  if (st.sus >= 45) return { face: '🤨', name: 'suspicious' }; if (st.worry === 'time') return { face: '⌚', name: 'impatient' };
  if (st.trust >= 40 && st.trust > st.sus + 15) return { face: '😊', name: 'warming up' }; return { face: '🤔', name: 'curious' };
}
// One line said: pick {o: which of the four, t: how well timed, 0-1}. Returns the new state.
export function conStep(L, st, pick) {
  const opts = conOptions(L, st), o = opts[Number(pick && pick.o)]; if (!o) return null;
  const P = CON_PERSONAS[L.persona], tactic = o.tactic, fit0 = CON_WORRIES[st.worry].fit[tactic] ?? 0, fit = fit0 < 0 && P.likes.includes(tactic) ? 0 : fit0, /* what they love is never quite the wrong move */ tm = clamp(Number(pick.t) || 0, 0, 1), repeat = tactic === st.last;
  let [dt, ds] = fit === 2 ? [30, 0] : fit === 1 ? [16, 5] : fit === 0 ? [7, 10] : [-8, 22];
  if (P.likes.includes(tactic)) { dt = dt > 0 ? dt * 1.35 : dt; ds *= 0.6; } if (P.hates.includes(tactic)) { dt = dt > 0 ? dt * 0.5 : dt - 4; ds += 10; }
  if (repeat) { dt = dt > 0 ? dt * 0.5 : dt; ds += 6; }
  const k = 1 - (L.diff - 1) * 0.06; dt = dt > 0 ? dt * k * (0.75 + 0.5 * tm) : dt; ds = ds * (1.15 - 0.4 * tm) + (L.diff - 1) * 1.5;
  const trust = clamp(st.trust + dt, 0, 150), sus = clamp(st.sus + ds, 0, 150), turn = st.turn + 1;
  const q = repeat ? 'repeat' : fit < 0 || P.hates.includes(tactic) ? 'bad' : fit >= 1 ? 'good' : 'meh';
  let done = trust >= L.need ? 'sold' : sus >= 100 ? 'walked' : turn >= L.turns ? 'walked' : null;
  // what's on their mind next: the same worry again if you dodged it, then the worries of a suspicious or a warm tourist, else their own
  let worry = st.worry, again = 0;
  if (!done) { const r = conRng(L, turn, 7);
    if (fit <= 0 && st.worry !== 'open' && st.again < 1) { again = st.again + 1; }
    else if (trust >= 70) worry = st.worry === 'close' ? (P.worries.partner ? 'partner' : 'price') : (r() < 0.6 || st.worry === 'price' || st.worry === 'partner' ? 'close' : P.worries.partner ? 'partner' : 'price');
    else if (sus >= 55) worry = (P.worries.proof || 0) >= (P.worries.trust || 0) ? (st.worry === 'proof' ? 'trust' : 'proof') : (st.worry === 'trust' ? 'proof' : 'trust');
    else { const ws = Object.entries(P.worries).filter(([w]) => w !== st.worry), tot = ws.reduce((a, [, n]) => a + n, 0); let x = r() * tot; worry = ws[0][0]; for (const [w, n] of ws) { if ((x -= n) < 0) { worry = w; break; } } } }
  return { trust, sus, turn, worry, again, last: tactic, q, done };
}
// Replaying the conversation: picks are the line chosen each turn (0–3) and how well it was timed (0–1).
export function conReplay(L, picks) {
  if (!Array.isArray(picks) || picks.length > L.turns) return { ok: false, why: 'bad picks' };
  let st = conStart(L);
  for (const p of picks) { if (st.done) return { ok: false, why: 'too many picks' }; st = conStep(L, st, p); if (!st) return { ok: false, why: 'bad pick' }; }
  const state = { trust: Math.round(st.trust), sus: Math.round(st.sus), turns: st.turn };
  if (!st.done) return { ok: false, why: 'unfinished', state };
  const perf = st.done === 'sold' ? clamp(0.6 + 0.3 * (1 - st.sus / 100) + 0.1 * (L.turns - st.turn) / L.turns, 0, 1) : clamp(st.trust / L.need * 0.45, 0, 0.45);
  return { ok: true, state: { ...state, done: st.done }, perf, money: st.done === 'sold' };
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
  const pin = [...Array(3 + Math.ceil(diff * 0.7))].map(() => Math.floor(r() * 9) + 1);
  const L = { seed, diff, wires: cols, card, sockets, pin, limit: 60 - diff * 3, wrongWire: 0.1, wrongKey: 0.12 };
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
    d += 27 - diff * 1.3 + r() * (16 - diff * 1.1);
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
