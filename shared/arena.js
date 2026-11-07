// Street games: Hunters & Civilians, and Hide and seek. Played live by 8 at once (up to 4 real colonists ); on a small walled-off
// city block (the server runs the match ten times a second; the rest of the places are filled by the colony's own
// unclaimed colonists, played by the computer). The map, movement and sight rules are shared, so a phone moves its
// own player exactly as the server would allow.
//
//   tag  → Hunters & Civilians: hunters chase the civilians; anyone caught joins the hunters. Civilians grab cash bags
//          and try to last until the clock runs out.
//   hide → Hide and seek: hiders get a head start to find a hiding spot (bins, bushes, crates, doorways); then the seekers
//          come looking. Anyone found joins the seekers. Last until the clock runs out without being found.

export const MODES = {
  tag: { name: 'Hunters & Civilians', icon: '🏃', play: 150, hide: 4, roles: ['hunter', 'civilian'],
    blurb: 'Civilians get a 4-second head start, then the hunters give chase. Get caught and you become a hunter. Grab cash bags and try to last to the end.' },
  hide: { name: 'Hide and seek', icon: '🙈', play: 150, hide: 25, roles: ['seeker', 'hider'],
    blurb: 'Hiders get 25 seconds to find a spot (bins, bushes, crates, doorways). Then the seekers come looking. Anyone found becomes a seeker.' },
};
export const A = { W: 28, H: 22, r: 0.3, speed: { civilian: 3.6, hunter: 3.75, hider: 3.5, seeker: 3.7 }, tagR: 0.75, findR: 1.15, sight: 6.5, hideR: 0.45,
  tick: 0.1, players: 8, maxPeople: 4, prize: 400, paidWins: 3, lobby: 20 };
export const chasers = mode => mode === 'tag' ? 'hunter' : 'seeker';
export const runners = mode => mode === 'tag' ? 'civilian' : 'hider';

export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// The block: streets between buildings, a park or two, parked cars and benches, and places to hide.
// grid: 0 = open ground (street, pavement, grass), 1 = building (blocks the way and the view), 2 = low obstacle
// (car, bench, tree: blocks the way, not the view). `look` gives each tile its paint (street, pavement, grass).
export function genArena(seed) {
  const r = rng(seed), W = A.W, H = A.H, grid = new Uint8Array(W * H), look = new Uint8Array(W * H), spots = [], blocks = [];
  const at = (x, y) => y * W + x;
  // a lattice of blocks with streets between them; some blocks are parks
  for (let by = 1; by < H - 4; by += 7) for (let bx = 1; bx < W - 4; bx += 7) {
    const w = 4 + (r() < 0.5 ? 1 : 0), h = 4 + (r() < 0.4 ? 1 : 0), park = r() < 0.28, x0 = bx + 1, y0 = by + 1;
    blocks.push({ x: x0, y: y0, w, h, park, hue: Math.floor(r() * 6) });
    for (let y = y0; y < Math.min(H - 1, y0 + h); y++) for (let x = x0; x < Math.min(W - 1, x0 + w); x++) {
      if (park) { look[at(x, y)] = 2; if (r() < 0.12) grid[at(x, y)] = 2; } // grass, with a tree here and there
      else grid[at(x, y)] = 1;
    }
  }
  // pavements around buildings
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!grid[at(x, y)] && !look[at(x, y)]) {
    let n = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && grid[at(X, Y)] === 1) n = true; }
    if (n) look[at(x, y)] = 1;
  }
  // parked cars and benches on the open street
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (!grid[at(x, y)] && look[at(x, y)] === 0 && r() < 0.045) grid[at(x, y)] = 2;
  // keep it all one connected area: drop obstacles that cut a part off
  const spawn = { x: Math.floor(W / 2) + 0.5, y: Math.floor(H / 2) + 0.5 };
  for (let pass = 0; pass < 4; pass++) {
    const seen = reach({ W, H, grid }, Math.floor(spawn.x), Math.floor(spawn.y)); let fixed = false;
    if (grid[at(Math.floor(spawn.x), Math.floor(spawn.y))]) { grid[at(Math.floor(spawn.x), Math.floor(spawn.y))] = 0; fixed = true; }
    for (let i = 0; i < W * H; i++) if (!grid[i] && !seen[i]) { for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < W * H && grid[j] === 2) { grid[j] = 0; fixed = true; } }
    if (!fixed) break;
  }
  const seen = reach({ W, H, grid }, Math.floor(spawn.x), Math.floor(spawn.y));
  for (let i = 0; i < W * H; i++) if (!grid[i] && !seen[i]) grid[i] = 2; // anything still cut off is fenced in
  // hiding spots: bins and crates against walls, bushes in parks, doorways in buildings' fronts
  const open = []; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (!grid[at(x, y)]) open.push([x, y]);
  const used = new Set();
  for (let i = 0; i < 400 && spots.length < 18; i++) {
    const [x, y] = open[Math.floor(r() * open.length)], k = at(x, y); if (used.has(k)) continue;
    if (Math.abs(x + 0.5 - spawn.x) < 2.5 && Math.abs(y + 0.5 - spawn.y) < 2.5) continue;
    let wall = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[at(x + dx, y + dy)] === 1) wall++;
    const kind = look[k] === 2 ? 'bush' : wall ? ['bin', 'crate', 'door'][Math.floor(r() * 3)] : null; if (!kind) continue;
    if (spots.some(s => Math.abs(s.x - x - 0.5) + Math.abs(s.y - y - 0.5) < 3)) continue;
    spots.push({ x: x + 0.5, y: y + 0.5, k: kind }); used.add(k);
  }
  // where the chasers start: the corner furthest from the middle that's open
  const corners = [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]].map(([x, y]) => nearestOpen({ W, H, grid }, x, y));
  return { seed, W, H, grid: Array.from(grid), look: Array.from(look), spots, blocks, spawn, corners };
}
function reach(L, sx, sy) { const seen = new Uint8Array(L.W * L.H), q = [sy * L.W + sx]; seen[q[0]] = 1;
  while (q.length) { const c = q.pop(), x = c % L.W, y = (c / L.W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= L.W || Y >= L.H) continue; const n = Y * L.W + X; if (seen[n] || L.grid[n]) continue; seen[n] = 1; q.push(n); } }
  return seen; }
function nearestOpen(L, x, y) { for (let d = 0; d < 10; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) { const X = x + dx, Y = y + dy; if (X > 0 && Y > 0 && X < L.W - 1 && Y < L.H - 1 && !L.grid[Y * L.W + X]) return { x: X + 0.5, y: Y + 0.5 }; } return { x: L.W / 2, y: L.H / 2 }; }

export const blocked = (L, x, y) => { const cx = Math.floor(x), cy = Math.floor(y); return cx < 0 || cy < 0 || cx >= L.W || cy >= L.H || L.grid[cy * L.W + cx] > 0; };
export const fits = (L, x, y) => { const R = A.r; return !blocked(L, x - R, y - R) && !blocked(L, x + R, y - R) && !blocked(L, x - R, y + R) && !blocked(L, x + R, y + R); };
// A move of up to `max` tiles towards (vx, vy), sliding along walls.
export function moveBy(L, p, vx, vy, max) {
  const n = Math.hypot(vx, vy); if (n > 1) { vx /= n; vy /= n; }
  let x = p.x, y = p.y; const steps = Math.max(1, Math.ceil(max / 0.2)), sx = vx * max / steps, sy = vy * max / steps;
  for (let i = 0; i < steps; i++) { if (fits(L, x + sx, y)) x += sx; if (fits(L, x, y + sy)) y += sy; }
  return { x, y };
}
// Can a see b? Buildings block the view; cars, benches and trees don't.
export function sees(L, a, b, range = A.sight) {
  const d = Math.hypot(b.x - a.x, b.y - a.y); if (d > range) return false;
  const n = Math.ceil(d / 0.3); for (let i = 1; i < n; i++) { const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n; if (L.grid[Math.floor(y) * L.W + Math.floor(x)] === 1) return false; }
  return true;
}
export const spotAt = (L, p) => L.spots.find(s => Math.hypot(s.x - p.x, s.y - p.y) <= A.hideR) || null;
// The way from a to b, one tile at a time (for the computer's players): the next point to head for.
export function nextStep(L, from, to) {
  const W = L.W, S = Math.floor(from.y) * W + Math.floor(from.x), E = Math.floor(to.y) * W + Math.floor(to.x); if (S === E) return to;
  const prev = new Int32Array(W * L.H).fill(-1), q = [S]; prev[S] = S; let head = 0;
  while (head < q.length) { const c = q[head++]; if (c === E) break; const x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= L.H) continue; const n = Y * W + X; if (prev[n] >= 0 || L.grid[n]) continue; prev[n] = c; q.push(n); } }
  if (prev[E] < 0) return to;
  let c = E, path = []; while (c !== S) { path.push(c); c = prev[c]; } path.reverse();
  // look ahead as far as the straight line is clear, so they don't zig-zag tile by tile
  let pick = path[0]; for (let i = 1; i < Math.min(path.length, 4); i++) { const n = path[i], p = { x: n % W + 0.5, y: ((n / W) | 0) + 0.5 }; if (clearWalk(L, from, p)) pick = n; else break; }
  return { x: pick % W + 0.5, y: ((pick / W) | 0) + 0.5 };
}
function clearWalk(L, a, b) { const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 0.2); for (let i = 1; i <= n; i++) if (!fits(L, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false; return true; }
