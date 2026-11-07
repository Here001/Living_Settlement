// Street games: Hunters & Civilians, and Hide and seek. Played live by 8 at once (up to 4 real colonists; the rest of
// the places are filled by the colony's own unclaimed colonists, played by the computer) on the real streets around
// the first player's home: the same buildings, roads, parks, trees and water as on the map, in 3D.
// Distances are in metres: a map tile is 8 m across, and the walking grid has 2 m cells (4 to a tile).
// The server builds the play area from the map once per match and sends it to every phone, so everyone plays on
// exactly the same ground, and a phone moves its own player exactly as the server allows.
//
//   tag  → Hunters & Civilians: hunters chase the civilians; anyone caught joins the hunters. Civilians grab cash bags
//          and try to last until the clock runs out.
//   hide → Hide and seek: hiders get a head start to find a hiding spot (bins, bushes, crates, doorways); then the seekers
//          come looking. Anyone found joins the seekers. Last until the clock runs out without being found.
import { BUILDING_TYPES, ROAD_TYPES } from './catalog.js';

export const MODES = {
  tag: { name: 'Hunters & Civilians', icon: '🏃', play: 150, hide: 4, roles: ['hunter', 'civilian'],
    blurb: 'Civilians get a 4-second head start, then the hunters give chase. Get caught and you become a hunter. Grab cash bags and try to last to the end.' },
  hide: { name: 'Hide and seek', icon: '🙈', play: 150, hide: 25, roles: ['seeker', 'hider'],
    blurb: 'Hiders get 25 seconds to find a spot (bins, bushes, crates, doorways). Then the seekers come looking. Anyone found becomes a seeker.' },
};
export const TILE = 8, CELL = 2, PER = TILE / CELL;
export const A = { tilesW: 22, tilesH: 18, r: 0.45, speed: { civilian: 6.0, hunter: 6.3, hider: 5.6, seeker: 6.0 }, tagR: 1.4, findR: 2.2, sight: 26, hideR: 1.0,
  tick: 0.1, players: 8, maxPeople: 4, prize: 400, paidWins: 3, lobby: 20 };
export const chasers = mode => mode === 'tag' ? 'hunter' : 'seeker';
export const runners = mode => mode === 'tag' ? 'civilian' : 'hider';

export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const TREES = new Set(['tree', 'pine', 'birch', 'poplar', 'palm', 'xmastree']);
const GREEN = new Set(['park', 'garden', 'fitpark', 'playground', 'pitch', 'farm', 'bush', 'hedge', 'flowers', 'tree', 'pine', 'birch', 'poplar', 'palm', 'xmastree', 'rocks', 'golf']);
const PAVED = new Set(['square', 'parking', 'market', 'stalls', 'fountain', 'bandstand', 'busstop', 'lamp', 'bench', 'prop', 'statue', 'column', 'obelisk', 'well', 'gate', 'arch']);

// The play area, from the map: `win` is { x0, y0 } (the top-left tile), plus the buildings, road tiles and water tiles
// inside it (as the database has them). grid cells: 0 open, 1 building (blocks the way and the view), 2 low obstacle
// (tree trunk, bench, car, fence: blocks the way, not the view), 3 water.
export function arenaFromMap(win, seed) {
  const r = rng(seed), tw = A.tilesW, th = A.tilesH, W = tw * PER, H = th * PER, grid = new Uint8Array(W * H), ground = new Uint8Array(tw * th);
  const at = (cx, cy) => cy * W + cx, inside = (tx, ty) => tx >= 0 && ty >= 0 && tx < tw && ty < th;
  const roads = new Map(), buildings = [], props = [], spots = [], scenery = [], sroads = [], swater = [];
  // ground: 0 grass, 1 paving, 2 road, 3 water, 4 dirt/field, 5 sports green
  for (const [x, y, type] of win.roads || []) { const tx = x - win.x0, ty = y - win.y0; if (!inside(tx, ty)) { sroads.push([tx, ty, type]); continue; } roads.set(tx + ',' + ty, type); ground[ty * tw + tx] = 2; }
  for (const [x, y] of win.water || []) { const tx = x - win.x0, ty = y - win.y0; if (!inside(tx, ty)) { swater.push([tx, ty]); continue; } if (roads.has(tx + ',' + ty)) continue; ground[ty * tw + tx] = 3;
    for (let cy = 0; cy < PER; cy++) for (let cx = 0; cx < PER; cx++) grid[at(tx * PER + cx, ty * PER + cy)] = 3; }
  const block = (x0, y0, x1, y1, v) => { for (let cy = Math.max(0, Math.floor(y0 / CELL)); cy < Math.min(H, Math.ceil(y1 / CELL)); cy++) for (let cx = Math.max(0, Math.floor(x0 / CELL)); cx < Math.min(W, Math.ceil(x1 / CELL)); cx++) {
    const mx = cx * CELL + CELL / 2, my = cy * CELL + CELL / 2; if (mx > x0 && mx < x1 && my > y0 && my < y1 && grid[at(cx, cy)] !== 1) grid[at(cx, cy)] = v; } };
  for (const b of win.buildings || []) {
    const T = BUILDING_TYPES[b.type]; if (!T) continue;
    const [w, h] = b.rot ? [T.size[1], T.size[0]] : [T.size[0], T.size[1]], tx = b.x - win.x0, ty = b.y - win.y0;
    if (tx + w <= 0 || ty + h <= 0 || tx >= tw || ty >= th) { // beyond the play area: the town carries on (scenery only)
      if (!T.outdoor) scenery.push({ type: b.type, x: tx * TILE + 1.2, y: ty * TILE + 1.2, w: w * TILE - 2.4, h: h * TILE - 2.4, level: b.level || 1 }); continue; }
    const st = T.style, x = tx * TILE, y = ty * TILE;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inside(tx + i, ty + j) && ground[(ty + j) * tw + tx + i] !== 2)
      ground[(ty + j) * tw + tx + i] = st === 'farm' ? 4 : st === 'pitch' || st === 'stadium' || st === 'racetrack' ? 5 : GREEN.has(st) ? 0 : PAVED.has(st) || T.outdoor ? 1 : 1;
    if (TREES.has(st)) { const px = x + TILE / 2 + (r() - 0.5) * 2, py = y + TILE / 2 + (r() - 0.5) * 2; props.push({ k: st === 'pine' || st === 'xmastree' ? 'pine' : st === 'palm' ? 'palm' : st === 'poplar' ? 'poplar' : 'tree', x: px, y: py, c: T.colors?.leaf || '#6FAE45', s: 0.85 + r() * 0.35 }); block(px - 0.8, py - 0.8, px + 0.8, py + 0.8, 2); continue; }
    if (st === 'bush' || st === 'hedge') { spots.push({ x: x + TILE / 2, y: y + TILE / 2, k: 'bush' }); continue; }
    if (st === 'fence') { block(x, y + TILE / 2 - 0.4, x + TILE, y + TILE / 2 + 0.4, 2); props.push({ k: 'fence', x: x + TILE / 2, y: y + TILE / 2, c: T.colors?.wall || '#F4F1E8', w: TILE }); continue; }
    if (st === 'lamp' || st === 'bench' || st === 'prop' || st === 'busstop') { const k = st === 'prop' ? T.prop || 'prop' : st; props.push({ k, x: x + TILE / 2, y: y + TILE / 2, rot: b.rot || 0 });
      if (k === 'phone' || k === 'kiosk') spots.push({ x: x + TILE / 2 + 1.6, y: y + TILE / 2, k: 'booth' }); else block(x + TILE / 2 - 0.5, y + TILE / 2 - 0.5, x + TILE / 2 + 0.5, y + TILE / 2 + 0.5, 2); continue; }
    if (T.outdoor) { // parks, squares, pitches, fields: open ground with a few trees and benches (and, in parks, bushes to hide in)
      buildings.push({ id: b.id, type: b.type, x, y, w: w * TILE, h: h * TILE, outdoor: true, rot: b.rot || 0 });
      const n = Math.round(w * h * (st === 'park' || st === 'garden' ? 1.2 : st === 'square' ? 0.3 : 0));
      for (let k = 0; k < n; k++) { const px = x + 3 + r() * (w * TILE - 6), py = y + 3 + r() * (h * TILE - 6);
        if (st === 'square' || r() < 0.55) { props.push({ k: 'tree', x: px, y: py, c: ['#6FAE45', '#5E9E45', '#7DB656'][k % 3], s: 0.8 + r() * 0.4 }); block(px - 0.8, py - 0.8, px + 0.8, py + 0.8, 2); }
        else spots.push({ x: px, y: py, k: 'bush' }); }
      if (st === 'fountain' || T.center === 'fountain') { const cx = x + w * TILE / 2, cy = y + h * TILE / 2; props.push({ k: 'fountain', x: cx, y: cy }); block(cx - 2.6, cy - 2.6, cx + 2.6, cy + 2.6, 2); }
      continue; }
    // a building: its walls stand a metre and a bit in from the edge of its plot, leaving pavements and alleys
    const m = 1.2; buildings.push({ id: b.id, type: b.type, x: x + m, y: y + m, w: w * TILE - 2 * m, h: h * TILE - 2 * m, level: b.level || 1, rot: b.rot || 0, name: b.name || null });
    block(x + m, y + m, x + w * TILE - m, y + h * TILE - m, 1);
  }
  // parked cars along the kerbs of straight streets
  for (const [k, type] of roads) { const [tx, ty] = k.split(',').map(Number), R0 = ROAD_TYPES[type]; if (!R0 || R0.rail || r() > 0.16) continue;
    const ew = roads.has(tx - 1 + ',' + ty) || roads.has(tx + 1 + ',' + ty), ns = roads.has(tx + ',' + (ty - 1)) || roads.has(tx + ',' + (ty + 1)); if (ew === ns) continue;
    const side = r() < 0.5 ? -1 : 1, px = tx * TILE + TILE / 2 + (ns ? side * 2.6 : 0), py = ty * TILE + TILE / 2 + (ew ? side * 2.6 : 0);
    props.push({ k: 'car', x: px, y: py, ang: ns ? 0 : Math.PI / 2, c: ['#C8382E', '#2F5D9E', '#E9E4D8', '#2B2F33', '#E2B13C', '#3C8A5A'][Math.floor(r() * 6)] });
    if (ns) block(px - 1, py - 2.2, px + 1, py + 2.2, 2); else block(px - 2.2, py - 1, px + 2.2, py + 1, 2); }
  // bins and crates against walls, and doorways in the buildings' fronts
  const open = []; for (let cy = 1; cy < H - 1; cy++) for (let cx = 1; cx < W - 1; cx++) if (!grid[at(cx, cy)]) open.push([cx, cy]);
  for (let i = 0; i < 900 && spots.length < 22 && open.length; i++) { const [cx, cy] = open[Math.floor(r() * open.length)];
    let wall = null; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[at(cx + dx, cy + dy)] === 1) wall = [dx, dy]; if (!wall) continue;
    const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2; if (spots.some(s => Math.hypot(s.x - x, s.y - y) < 14)) continue;
    spots.push({ x, y, k: ['bin', 'crate', 'door', 'bin'][Math.floor(r() * 4)], face: wall }); }
  // where people start: open ground near the middle; the chasers start in the corners
  const cxm = Math.floor(W / 2), cym = Math.floor(H / 2), seen = reach({ W, H, grid }, ...nearOpen({ W, H, grid }, cxm, cym));
  for (let i = 0; i < W * H; i++) if (!grid[i] && !seen[i]) grid[i] = 2; // anything cut off (behind water, boxed in) is out of bounds
  for (let i = spots.length - 1; i >= 0; i--) { const s = spots[i], k = at(Math.floor(s.x / CELL), Math.floor(s.y / CELL)); if (grid[k]) spots.splice(i, 1); }
  const [sx, sy] = nearOpen({ W, H, grid }, cxm, cym), spawn = { x: sx * CELL + CELL / 2, y: sy * CELL + CELL / 2 };
  const corners = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]].map(([x, y]) => { const [a, b] = nearOpen({ W, H, grid }, x, y); return { x: a * CELL + CELL / 2, y: b * CELL + CELL / 2 }; });
  return { seed, W, H, cell: CELL, tw, th, x0: win.x0, y0: win.y0, grid: Array.from(grid).join(''), ground: Array.from(ground).join(''), roads: [...roads].map(([k, t]) => [...k.split(',').map(Number), t]),
    buildings, props, spots, spawn, corners, scenery, sroads, swater };
}
function reach(L, sx, sy) { const seen = new Uint8Array(L.W * L.H), q = [sy * L.W + sx]; seen[q[0]] = 1;
  while (q.length) { const c = q.pop(), x = c % L.W, y = (c / L.W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= L.W || Y >= L.H) continue; const n = Y * L.W + X; if (seen[n] || gridAt(L, n)) continue; seen[n] = 1; q.push(n); } }
  return seen; }
function nearOpen(L, x, y) { for (let d = 0; d < 40; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) { const X = x + dx, Y = y + dy; if (X > 0 && Y > 0 && X < L.W - 1 && Y < L.H - 1 && !gridAt(L, Y * L.W + X)) return [X, Y]; } return [x, y]; }
const gridAt = (L, i) => typeof L.grid === 'string' ? L.grid.charCodeAt(i) - 48 : L.grid[i];
// The grid as numbers (it travels as a string of digits).
export function prepare(L) { if (typeof L.grid === 'string') { const g = new Uint8Array(L.W * L.H); for (let i = 0; i < g.length; i++) g[i] = L.grid.charCodeAt(i) - 48; L.grid = g; } return L; }

export const blocked = (L, x, y) => { const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); return cx < 0 || cy < 0 || cx >= L.W || cy >= L.H || L.grid[cy * L.W + cx] > 0; };
export const fits = (L, x, y) => { const R = A.r; return !blocked(L, x - R, y - R) && !blocked(L, x + R, y - R) && !blocked(L, x - R, y + R) && !blocked(L, x + R, y + R); };
// A move of up to `max` metres towards (vx, vy), sliding along walls.
export function moveBy(L, p, vx, vy, max) {
  const n = Math.hypot(vx, vy); if (!n) return { x: p.x, y: p.y }; vx /= n; vy /= n;
  let x = p.x, y = p.y; const steps = Math.max(1, Math.ceil(max / 0.35)), sx = vx * max / steps, sy = vy * max / steps;
  for (let i = 0; i < steps; i++) { if (fits(L, x + sx, y)) x += sx; if (fits(L, x, y + sy)) y += sy; }
  return { x, y };
}
// Can a see b? Buildings block the view; cars, benches, trees and water don't.
export function sees(L, a, b, range = A.sight) {
  const d = Math.hypot(b.x - a.x, b.y - a.y); if (d > range) return false;
  const n = Math.ceil(d / 0.8); for (let i = 1; i < n; i++) { const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n; if (L.grid[Math.floor(y / CELL) * L.W + Math.floor(x / CELL)] === 1) return false; }
  return true;
}
export const spotAt = (L, p) => L.spots.find(s => Math.hypot(s.x - p.x, s.y - p.y) <= A.hideR) || null;
// The way from a to b over the walking grid (for the computer's players): the next point to head for.
export function nextStep(L, from, to) {
  const W = L.W, cell = c => ({ x: (c % W) * CELL + CELL / 2, y: ((c / W) | 0) * CELL + CELL / 2 });
  const S = Math.floor(from.y / CELL) * W + Math.floor(from.x / CELL), E = Math.floor(to.y / CELL) * W + Math.floor(to.x / CELL); if (S === E) return to;
  const prev = new Int32Array(W * L.H).fill(-1), q = new Int32Array(W * L.H); let head = 0, tail = 0; q[tail++] = S; prev[S] = S;
  while (head < tail) { const c = q[head++]; if (c === E) break; const x = c % W, y = (c / W) | 0;
    for (let k = 0; k < 4; k++) { const X = x + (k === 0 ? 1 : k === 1 ? -1 : 0), Y = y + (k === 2 ? 1 : k === 3 ? -1 : 0); if (X < 0 || Y < 0 || X >= W || Y >= L.H) continue; const n = Y * W + X; if (prev[n] >= 0 || L.grid[n]) continue; prev[n] = c; q[tail++] = n; } }
  if (prev[E] < 0) return to;
  const path = []; for (let c = E; c !== S; c = prev[c]) path.push(c); path.reverse();
  // look ahead as far as the straight line is clear, so they run smoothly instead of zig-zagging cell by cell
  let pick = path[0]; for (let i = 1; i < Math.min(path.length, 8); i++) { if (clearWalk(L, from, cell(path[i]))) pick = path[i]; else break; }
  return pick === E ? to : cell(pick);
}
function clearWalk(L, a, b) { const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 0.4); for (let i = 1; i <= n; i++) if (!fits(L, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false; return true; }
