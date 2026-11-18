// Driving around town in 3D: the colony's map (its roads, buildings, parks, trees and water) built in 3D around your car
// as you drive, with the same look as the street games (world3d.js): real building fronts with signs and awnings, kerbs
// and zebra crossings, street lamps and lit windows after dark, the sky and sun at the colony's time of day. The
// colonists and cars near you move about as they do on the map. Distances here are metres: a map tile is 8 m.
//
// Built for phones:
//  - only the blocks of town round the car exist (20×20 tiles each); blocks you leave behind are thrown away and the
//    ones ahead are built one at a time, so there's never a pause to build the whole town;
//  - each block is merged into a handful of meshes, whatever is in it;
//  - shadows are worked out only when you've moved a fair way, not every frame (and not at all on weaker phones);
//  - if a phone can't keep up, it sees one block less far (the haze hides the edge). The sharpness is never lowered.
// The map's own data comes from index.html through the callbacks in `opts`; this file only draws and drives.
import * as W from '/world3d.js';
import { BUILDING_TYPES, ROAD_TYPES } from '/shared/catalog.js';
const THREE = W.THREE;

const PHONE = matchMedia('(pointer: coarse)').matches;
const HQ = !(PHONE && ((navigator.deviceMemory || 4) <= 3 || (navigator.hardwareConcurrency || 8) <= 4));
const TILE = 8, B = 20, M = 1.2;     // metres to a tile; tiles to a block; how far a building stands in from its plot's edge
const TREES = new Set(['tree', 'pine', 'birch', 'poplar', 'palm', 'xmastree']);
const GREEN = new Set(['park', 'garden', 'fitpark', 'playground', 'pitch', 'farm', 'bush', 'hedge', 'flowers', 'tree', 'pine', 'birch', 'poplar', 'palm', 'xmastree', 'rocks', 'golf']);
const rng = seed => { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const sizeOf = b => { const T = BUILDING_TYPES[b.type]; return b.rot ? [T.size[1], T.size[0]] : [T.size[0], T.size[1]]; };

// One block of town as the street games' builder wants it (see shared/arena.js): its ground, roads, buildings and
// props in metres from the block's corner, and what solid things a car can't drive through (in world metres).
function blockArea(bx, by, o) {
  const r = rng((bx * 73856093) ^ (by * 19349663)), ground = new Uint8Array(B * B), roads = [], sroads = [], buildings = [], props = [], spots = [], solid = [], parked = [];
  for (let ty = -1; ty <= B; ty++) for (let tx = -1; tx <= B; tx++) { const t = o.road(bx + tx, by + ty); if (!t) continue; const inside = tx >= 0 && ty >= 0 && tx < B && ty < B;
    if (inside) { roads.push([tx, ty, t]); ground[ty * B + tx] = 2; } else sroads.push([tx, ty, t]); }
  for (let ty = 0; ty < B; ty++) for (let tx = 0; tx < B; tx++) if (!ground[ty * B + tx] && o.water(bx + tx, by + ty)) ground[ty * B + tx] = 3;
  const wx = x => (bx * TILE + x), wz = z => (by * TILE + z);
  for (const b of o.buildings(bx, by, bx + B, by + B)) {
    const T = BUILDING_TYPES[b.type]; if (!T) continue; const [w, h] = sizeOf(b), tx = b.x - bx, ty = b.y - by, st = T.style, x = tx * TILE, y = ty * TILE;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const gx = tx + i, gy = ty + j; if (gx < 0 || gy < 0 || gx >= B || gy >= B || ground[gy * B + gx] === 2) continue;
      ground[gy * B + gx] = st === 'farm' ? 4 : st === 'pitch' || st === 'stadium' || st === 'racetrack' ? 5 : GREEN.has(st) || (T.cat === 'housing' && (st === 'house' || st === 'gabled' || st === 'tent')) ? 0 : 1; } /* houses stand on lawns */
    if (TREES.has(st)) { const px = x + TILE / 2 + (r() - 0.5) * 2, py = y + TILE / 2 + (r() - 0.5) * 2; props.push({ k: st === 'pine' || st === 'xmastree' ? 'pine' : st === 'palm' ? 'palm' : st === 'poplar' ? 'poplar' : 'tree', x: px, y: py, c: T.colors?.leaf || '#6FAE45', s: 0.85 + r() * 0.35 }); solid.push({ c: [wx(px), wz(py), 0.8] }); continue; }
    if (st === 'bush' || st === 'hedge') { spots.push({ x: x + TILE / 2, y: y + TILE / 2, k: 'bush' }); solid.push({ c: [wx(x + TILE / 2), wz(y + TILE / 2), 1.4] }); continue; }
    if (st === 'fence') { props.push({ k: 'fence', x: x + TILE / 2, y: y + TILE / 2, c: T.colors?.wall || '#F4F1E8', w: TILE }); solid.push({ r: [wx(x), wz(y + TILE / 2 - 0.4), wx(x + TILE), wz(y + TILE / 2 + 0.4)] }); continue; }
    if (st === 'lamp' || st === 'bench' || st === 'prop' || st === 'busstop') { const k = st === 'prop' ? T.prop || 'prop' : st; props.push({ k, x: x + TILE / 2, y: y + TILE / 2, rot: b.rot || 0 }); solid.push({ c: [wx(x + TILE / 2), wz(y + TILE / 2), 0.7] }); continue; }
    if (T.outdoor) { buildings.push({ id: b.id, type: b.type, x, y, w: w * TILE, h: h * TILE, outdoor: true, rot: b.rot || 0 });
      const n = Math.round(w * h * (st === 'park' || st === 'garden' ? 1.2 : st === 'square' ? 0.3 : 0));
      for (let k = 0; k < n; k++) { const px = x + 3 + r() * (w * TILE - 6), py = y + 3 + r() * (h * TILE - 6);
        if (st === 'square' || r() < 0.55) { props.push({ k: 'tree', x: px, y: py, c: ['#6FAE45', '#5E9E45', '#7DB656'][k % 3], s: 0.8 + r() * 0.4 }); solid.push({ c: [wx(px), wz(py), 0.8] }); }
        else { spots.push({ x: px, y: py, k: 'bush' }); solid.push({ c: [wx(px), wz(py), 1.4] }); } }
      if (st === 'fountain' || T.center === 'fountain') { const cx = x + w * TILE / 2, cy = y + h * TILE / 2; props.push({ k: 'fountain', x: cx, y: cy }); solid.push({ c: [wx(cx), wz(cy), 2.8] }); }
      continue; }
    buildings.push({ id: b.id, type: b.type, x: x + M, y: y + M, w: w * TILE - 2 * M, h: h * TILE - 2 * M, level: b.lv || 1, rot: b.rot || 0, name: b.name || null });
    if (T.cat === 'housing' && (st === 'house' || st === 'gabled')) { /* a hedge round the garden, except on the side that faces the road */
      const sides = [['N', x + w * TILE / 2, y + 0.4, false, w * TILE, [b.x, b.y - 1]], ['S', x + w * TILE / 2, y + h * TILE - 0.4, false, w * TILE, [b.x, b.y + h]], ['W', x + 0.4, y + h * TILE / 2, true, h * TILE, [b.x - 1, b.y]], ['E', x + w * TILE - 0.4, y + h * TILE / 2, true, h * TILE, [b.x + w, b.y]]];
      for (const [, hx, hy, ns, len, [nx, ny]] of sides) { if (o.road(nx, ny) || r() < 0.35) continue; props.push({ k: 'hedge', x: hx, y: hy, w: len - 1.6, ns, c: ['#3f7d32', '#4a8a3a', '#356b2b'][Math.floor(r() * 3)] }); } }
    { const side = [['S', 0, 1], ['N', 0, -1], ['E', 1, 0], ['W', -1, 0]].map(([k, dx, dy]) => { let n = 0; if (dx) for (let j = 0; j < h; j++) n += o.road(b.x + (dx > 0 ? w : -1), b.y + j) ? 1 : 0; else for (let i = 0; i < w; i++) n += o.road(b.x + i, b.y + (dy > 0 ? h : -1)) ? 1 : 0; return [k, dx, dy, n]; }).sort((p, q) => q[3] - p[3])[0];
      const [, ddx, ddy] = side, door = [wx(ddx > 0 ? x + w * TILE - M + 0.6 : ddx < 0 ? x + M - 0.6 : x + w * TILE / 2), wz(ddy > 0 ? y + h * TILE - M + 0.6 : ddy < 0 ? y + M - 0.6 : y + h * TILE / 2)]; /* just outside the front door */
      solid.push({ r: [wx(x + M), wz(y + M), wx(x + w * TILE - M), wz(y + h * TILE - M)], id: b.id, door, out: Math.atan2(-ddy, ddx) }); }
  }
  // the street: trees and bins on the pavements, traffic lights at junctions, and cars parked along the kerb
  const isR = (tx, ty) => !!o.road(bx + tx, by + ty), free = (tx, ty) => !isR(tx, ty) && !o.water(bx + tx, by + ty), H = (tx, ty, k) => ((((bx + tx) * 73856093) ^ ((by + ty) * 19349663) ^ (k * 83492791)) >>> 0) % 1000;
  const PARK = ['hatch', 'sedan', 'sedan', 'suv', 'pickup', 'ev', 'hatch', 'evsedan', 'luxury'], PAINT = ['#C8382E', '#2F5D9E', '#E9E4D8', '#2B2F33', '#E2B13C', '#3C8A5A', '#7C8288', '#F2F0EA', '#1E2228'];
  for (const [tx, ty, type] of roads) { const R0 = ROAD_TYPES[type] || {}; if (R0.rail || R0.nocars || R0.kind !== 'street' && R0.kind !== 'highway') continue;
    const x0 = tx * TILE, z0 = ty * TILE, n = { N: isR(tx, ty - 1), S: isR(tx, ty + 1), W: isR(tx - 1, ty), E: isR(tx + 1, ty) }, links = n.N + n.S + n.W + n.E;
    const kerbs = [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]].filter(([k, dx, dy]) => !n[k] && free(tx + dx, ty + dy));
    for (const [k, dx, dy] of kerbs) { const along = dx === 0, px = (d) => along ? x0 + d : dx < 0 ? x0 - 0.8 : x0 + TILE + 0.8, pz = (d) => along ? (dy < 0 ? z0 - 0.8 : z0 + TILE + 0.8) : z0 + d;
      if (R0.deco === 'trees' || R0.lanes === 'median' || H(tx, ty, 1) < 260) { props.push({ k: 'tree', lite: true, x: px(1.6), y: pz(1.6), c: ['#6FAE45', '#5E9E45', '#7DB656'][H(tx, ty, 2) % 3], s: 0.7 + (H(tx, ty, 3) % 30) / 100 }); solid.push({ c: [wx(px(1.6)), wz(pz(1.6)), 0.6] }); }
      else if (H(tx, ty, 4) < 120) { props.push({ k: 'bin', x: px(6.2), y: pz(6.2) }); solid.push({ c: [wx(px(6.2)), wz(pz(6.2)), 0.4] }); }
      else if (H(tx, ty, 5) < 70) { props.push({ k: 'hydrant', x: px(6.6), y: pz(6.6) }); solid.push({ c: [wx(px(6.6)), wz(pz(6.6)), 0.3] }); }
      // a car parked at this kerb (on a street with parking, most tiles; elsewhere now and then)
      if (links === 2 && ((n.N && n.S) || (n.E && n.W)) && H(tx, ty, 6) < (R0.deco === 'cars' ? 700 : 110)) { const cx = along ? x0 + TILE / 2 : dx < 0 ? x0 + 0.95 : x0 + TILE - 0.95, cz = along ? (dy < 0 ? z0 + 0.95 : z0 + TILE - 0.95) : z0 + TILE / 2; /* tight to the kerb */
        parked.push({ kind: PARK[H(tx, ty, 7) % PARK.length], col: PAINT[H(tx, ty, 8) % PAINT.length], x: wx(cx), z: wz(cz), ry: along ? (H(tx, ty, 9) & 1 ? Math.PI / 2 : -Math.PI / 2) : (H(tx, ty, 9) & 1 ? 0 : Math.PI) });
        solid.push({ c: [wx(along ? cx - 1.3 : cx), wz(along ? cz : cz - 1.3), 1.1] }, { c: [wx(along ? cx + 1.3 : cx), wz(along ? cz : cz + 1.3), 1.1] }); } }
    if (links >= 3) { const corner = [[-1, -1], [1, -1], [-1, 1], [1, 1]].find(([dx, dy]) => free(tx + dx, ty) && free(tx, ty + dy) || free(tx + dx, ty + dy) && !isR(tx + dx, ty + dy) && (free(tx + dx, ty) || free(tx, ty + dy)));
      if (corner) { const [dx, dy] = corner, sx = dx < 0 ? x0 - 0.7 : x0 + TILE + 0.7, sz = dy < 0 ? z0 - 0.7 : z0 + TILE + 0.7; props.push({ k: 'signal', x: sx, y: sz, ang: Math.atan2(-dy, -dx), on: H(tx, ty, 10) % 3 }); solid.push({ c: [wx(sx), wz(sz), 0.4] }); } } }
  // what's next door, so kerbs and riverbanks know whether to stop at the block's edge
  const gnd = (tx, ty) => o.road(bx + tx, by + ty) ? 2 : o.water(bx + tx, by + ty) ? 3 : o.building(bx + tx, by + ty) ? 1 : 0;
  return { L: { seed: (bx * 31 + by) >>> 0, tw: B, th: B, ground: Array.from(ground).join(''), roads, sroads, buildings, props, spots, scenery: [], gnd }, solid, parked };
}

// Grass on open land: the further a patch is from any building, the taller it grows (wild meadow out in the open, short
// tufts near where people live, none on lawns, roads or water). One merged mesh per block, swaying in the wind in its
// shader (no work each frame), and no shadows. dist: tiles to the nearest building (0 = on one), up to 6.
const GRASS = { tex: null, mat: null, time: { value: 0 } };
function grassMaterial() { if (GRASS.mat) return GRASS.mat;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); let s = 9; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) { const x = 2 + r() * 60, w = 1.5 + r() * 2.5, h = 30 + r() * 34, lean = (r() - 0.5) * 14, sh = 170 + Math.floor(r() * 85);
    g.fillStyle = `rgb(${sh},${sh},${sh})`; g.beginPath(); g.moveTo(x - w, 64); g.lineTo(x + w, 64); g.lineTo(x + lean, 64 - h); g.closePath(); g.fill(); }
  GRASS.tex = new THREE.CanvasTexture(c); GRASS.tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: GRASS.tex, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
  m.onBeforeCompile = sh => { sh.uniforms.uT = GRASS.time; sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float sway = uv.y * uv.y * (0.18 + 0.1 * sin(position.x * 0.31 + position.z * 0.17));
    transformed.x += sin(uT * 1.7 + position.x * 0.45 + position.z * 0.3) * sway; transformed.z += cos(uT * 1.3 + position.z * 0.5) * sway * 0.6;`); };
  return GRASS.mat = m; }
function grassBlock(bx, by, o, dense) {
  const P = [], N = [], U = [], C = [], col = new THREE.Color(), near = new Map();
  const dist = (tx, ty) => { for (let d = 0; d <= 6; d++) { for (let i = -d; i <= d; i++) for (const [x, y] of [[tx + i, ty - d], [tx + i, ty + d], [tx - d, ty + i], [tx + d, ty + i]]) if (o.building(x, y)) return d; } return 7; };
  const quad = (x, z, w, h, ang, tint) => { const cx = Math.cos(ang) * w / 2, cz = Math.sin(ang) * w / 2, ny = [Math.sin(ang), 0, -Math.cos(ang)];
    for (const [px, py, pz, u, v] of [[x - cx, 0, z - cz, 0, 0], [x + cx, 0, z + cz, 1, 0], [x + cx, h, z + cz, 1, 1], [x - cx, 0, z - cz, 0, 0], [x + cx, h, z + cz, 1, 1], [x - cx, h, z - cz, 0, 1]]) { P.push(px, py, pz); N.push(0, 1, 0); U.push(u, v); C.push(tint.r, tint.g, tint.b); } };
  for (let ty = 0; ty < B; ty++) for (let tx = 0; tx < B; tx++) { const X = bx + tx, Y = by + ty; if (o.road(X, Y) || o.water(X, Y) || o.building(X, Y)) continue;
    const d = dist(X, Y); if (d < 1) continue; const h0 = d >= 7 ? 1.95 : 0.14 + (d - 1) * 0.3, n = Math.round((d === 1 ? 3 : 4 + Math.min(d, 7) * 1.5) * (dense ? 1 : 0.55)); /* taller and thicker the further from anyone */
    let seed = ((X * 73856093) ^ (Y * 19349663)) >>> 0; const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let k = 0; k < n; k++) { const x = (tx + r()) * TILE, z = (ty + r()) * TILE, h = h0 * (0.7 + r() * 0.6), w = 1.1 + h * 1.1, a = r() * Math.PI;
      col.setHSL(0.24 + r() * 0.06 - (d >= 5 ? 0.03 : 0), 0.45 + r() * 0.15, 0.32 + r() * 0.12 + (d >= 6 ? 0.04 : 0)); quad(x, z, w, h, a, col); quad(x, z, w, h, a + Math.PI / 2, col); } }
  if (!P.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, grassMaterial()); m.receiveShadow = true; /* in the block's own coordinates: it goes in the block's group */ m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix(); return m; }

// opts: start {x,y,a} (tiles; a: 0 = east, anticlockwise), car {kind,col}, road(x,y), water(x,y), building(x,y),
//   buildings(x0,y0,x1,y1) → raw buildings whose corner is in the area, byId(id), loaded(x,y), people(x,y) → nearby
//   [{id,x,y,car,col,kind}], minute() → the colony's minute of the day, onMove(x,y,a,v) (tiles, tiles/s), onNear(b|null), onLost()
export function createTown(host, opts) {
  const canvas = document.createElement('canvas'); canvas.className = 'town3d'; host.append(canvas);
  const view = W.createView(canvas), { scene, camera, renderer } = view;
  if (!HQ) { renderer.shadowMap.enabled = false; view.sun.castShadow = false; }
  camera.fov = 60; camera.near = 0.3; camera.far = 1200; camera.updateProjectionMatrix();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#6f9f4a', roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08; ground.receiveShadow = true; scene.add(ground);

  // ---- blocks of town: built when near, thrown away when far ----
  const blocks = new Map(); let RAD = HQ && !PHONE ? 2 : 1; const queue = [];
  const sig = (bx, by) => { let s = 0; for (const b of opts.buildings(bx, by, bx + B, by + B)) { const k = b.id + (b.lv || 1) + (b.rot || 0) + b.type; for (let i = 0; i < k.length; i++) s = (s * 31 + k.charCodeAt(i)) >>> 0; }
    for (let ty = by; ty < by + B; ty++) for (let tx = bx; tx < bx + B; tx++) { const t = o_road(tx, ty); if (t) s = (s * 7 + t.length + tx * 3 + ty * 5) >>> 0; } return s; };
  const o_road = (x, y) => opts.road(x, y);
  function build(bx, by) {
    const t0 = performance.now(), key = bx + ',' + by, old = blocks.get(key), s = sig(bx, by); if (old && old.sig === s) return;
    const { L, solid, parked } = blockArea(bx, by, opts), g = W.buildArea(view, L, { cordon: false, pad: 0, ring: false, add: false });
    g.position.set(bx * TILE, 0, by * TILE); { const gr = grassBlock(bx, by, opts, HQ); if (gr) g.add(gr); } g.updateMatrixWorld(true); scene.add(g);
    if (old) drop(old); blocks.set(key, { g, sig: s, bx, by, solid, parked }); shadowsDue = true; const ms = performance.now() - t0; stats.builds++; stats.maxMs = Math.max(stats.maxMs, ms); stats.totalMs += ms; }
  const stats = { builds: 0, maxMs: 0, totalMs: 0 }; /* how long blocks take to build (for checking it stays smooth) */
  const drop = v => { scene.remove(v.g); v.g.traverse(m => m.geometry && m.geometry.dispose()); };
  const near = () => { const cx = Math.floor(car.x / TILE / B), cy = Math.floor(car.z / TILE / B), want = [];
    for (let i = -RAD; i <= RAD; i++) for (let j = -RAD; j <= RAD; j++) want.push([(cx + i) * B, (cy + j) * B]); return want; };
  function around() { const want = near(), keys = new Set(want.map(([a, b]) => a + ',' + b));
    for (const [k, v] of blocks) if (!keys.has(k)) { drop(v); blocks.delete(k); }
    for (const [a, b] of want.sort((p, q) => Math.hypot(p[0] + B / 2 - car.x / TILE, p[1] + B / 2 - car.z / TILE) - Math.hypot(q[0] + B / 2 - car.x / TILE, q[1] + B / 2 - car.z / TILE)))
      if (!blocks.has(a + ',' + b) && !queue.includes(a + ',' + b)) queue.push(a + ',' + b); }
  const haze = () => { const far = (RAD + 0.5) * B * TILE; scene.fog.near = far * 0.45; scene.fog.far = far; };

  // ---- your car ----
  const car = { x: (opts.start.x) * TILE, z: (opts.start.y) * TILE, a: opts.start.a || 0, v: 0, steer: 0 };
  let foot = opts.mode === 'walk', parked = null; /* foot: walking (your character), not driving; parked: your car, where you got out */
  let feet = null; const mkFeet = () => { if (feet) return feet; feet = W.makePerson('me', null, opts.look || null); feet.group.traverse(m => { if (m.isMesh) m.castShadow = true; }); scene.add(feet.group); return feet; };
  if (foot) mkFeet();
  const me = W.makeCar(opts.car.kind || 'car', opts.car.col || '#c8382e'); scene.add(me); me.traverse(m => { if (m.isMesh) m.castShadow = true; });
  const tileOf = v => Math.floor(v / TILE);
  const solidsNear = (x, z) => { const out = []; const bx = Math.floor(tileOf(x) / B) * B, by = Math.floor(tileOf(z) / B) * B;
    for (const dx of [-B, 0, B]) for (const dz of [-B, 0, B]) { const v = blocks.get((bx + dx) + ',' + (by + dz)); if (v) out.push(...v.solid); } return out; };
  // Would this point of the car be inside something? (x0, z0: where the same point is now.) A point that's already
  // overlapping something may always move further out of it, so two cars that end up overlapping can always part.
  const depth = (x, z, s) => s.r ? Math.min(x - s.r[0], s.r[2] - x, z - s.r[1], s.r[3] - z) : s.c[2] - Math.hypot(x - s.c[0], z - s.c[1]); /* > 0: inside, by this much */
  const hits = (x, z, S, x0, z0) => { const tx = tileOf(x), tz = tileOf(z); if (!opts.loaded(tx, tz)) return true; if (opts.water(tx, tz) && !opts.road(tx, tz) && !(opts.water(tileOf(x0), tileOf(z0)) && !opts.road(tileOf(x0), tileOf(z0)))) return true;
    for (const s of S) { const d = depth(x, z, s); if (d > 0 && d >= depth(x0, z0, s) - 1e-3) return true; }
    for (const t of traffic) { const s = { c: [t.px, t.pz, 1.9] }, d = depth(x, z, s); if (d > 0 && d >= depth(x0, z0, s) - 1e-3) return true; }
    if (parked && foot) { const s = { c: [parked.x, parked.z, 1.5] }, d = depth(x, z, s); if (d > 0 && d >= depth(x0, z0, s) - 1e-3) return true; } return false; };
  const keys = new Set(), inp = { thr: 0, steer: 0 }; let ctl = opts.controls || { layout: 'stick' }; /* inp: from the on-screen controls (steer +1 = left) */
  function drive(dt) {
    const K = ctl.keys || {}, on = (a, d) => keys.has(d) || keys.has(String(K[a] || '').toLowerCase());
    const up = (on('up', 'ArrowUp') ? 1 : 0) - (on('down', 'ArrowDown') ? 1 : 0) + inp.thr, turn = (on('left', 'ArrowLeft') ? 1 : 0) - (on('right', 'ArrowRight') ? 1 : 0) + inp.steer;
    if (foot) { // walking: the stick (or WASD/arrows) moves you forward, back and to either side of where the camera faces; you turn to face the way you walk. Push the stick right out (or hold Shift) to run
      let iy = Math.max(-1, Math.min(1, up)), ix = -Math.max(-1, Math.min(1, turn)); const mag = Math.min(1, Math.hypot(ix, iy)), run = keys.has('Shift') || mag > 0.88;
      if (mag < 0.12) { car.v = 0; car.steer = 0; return; }
      const ma = lk.yaw - Math.atan2(ix, iy), sp = (run ? 4.4 : 1.8) * Math.min(1, mag / 0.7); car.mv = ma;
      let d = ma - car.a; d = Math.atan2(Math.sin(d), Math.cos(d)); car.steer = Math.sign(d); car.a += d * Math.min(1, dt * 12); /* turn to face the way you're walking */
      car.v += (sp - car.v) * Math.min(1, dt * 8); const fx = Math.cos(ma), fz = -Math.sin(ma), nx = car.x + fx * car.v * dt, nz = car.z + fz * car.v * dt, S = solidsNear(nx, nz);
      const free = (x, z) => ![0.35, 0].some(u => hits(x + fx * u, z + fz * u, S, car.x + fx * u, car.z + fz * u));
      if (free(nx, nz)) { car.x = nx; car.z = nz; return; }
      /* bumped into something (a bin, a tree, a parked car): slide along it rather than stop dead */
      for (const da of [0.6, -0.6, 1.1, -1.1]) { const b = ma + da, sx = car.x + Math.cos(b) * car.v * dt * 0.8, sz = car.z - Math.sin(b) * car.v * dt * 0.8; if (free(sx, sz)) { car.x = sx; car.z = sz; return; } }
      car.v = 0; return; }
    const thr = Math.max(-1, Math.min(1, up)), st = Math.max(-1, Math.min(1, turn)), rt = opts.road(tileOf(car.x), tileOf(car.z)), R = rt && ROAD_TYPES[rt];
    const top = R ? 7 * (R.speed || 2) : 6; /* metres a second: a street 14 (50 km/h), a highway 28; off the road, slower */
    if (thr > 0.05) car.v += (car.v < 0 ? 14 : 5) * thr * dt; else if (thr < -0.05) car.v += (car.v > 0 ? 14 : 3) * thr * dt; else car.v *= Math.pow(0.45, dt);
    if (car.v > top) car.v = Math.max(top, car.v - 10 * dt); car.v = Math.max(-5, car.v); if (Math.abs(car.v) < 0.05 && Math.abs(thr) < 0.05) car.v = 0;
    car.steer += (st - car.steer) * Math.min(1, dt * 7); car.a += car.steer * 1.5 * Math.max(-1, Math.min(1, car.v / 5)) * dt;
    const fx = Math.cos(car.a), fz = -Math.sin(car.a), nx = car.x + fx * car.v * dt, nz = car.z + fz * car.v * dt, S = solidsNear(nx, nz), dir = Math.sign(car.v || 1);
    const pts = [[2.1 * dir, 0.85], [2.1 * dir, -0.85], [0, 0]]; /* the front corners (the back ones going backwards) and the middle */
    if (pts.some(([u, w]) => hits(nx + fx * u + fz * w, nz + fz * u - fx * w, S, car.x + fx * u + fz * w, car.z + fz * u - fx * w))) { car.v = -car.v * 0.25; bump = 0.25; return; }
    car.x = nx; car.z = nz; }
  let bump = 0, roll = 0, pitch = 0, accel0 = 0;

  // ---- every car but yours, drawn together: one draw per model for all of them (parked, traffic, other people) ----
  const fleetM = new Map(), fleetQ = new Map(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), V1 = new THREE.Vector3(1, 1, 1), P3 = new THREE.Vector3(), C3 = new THREE.Color();
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const beamGeo = (() => { const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); g.translate(0, 0, -0.5); return g; })(), beamTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 128, 4, 32, 90, 90); gr.addColorStop(0, 'rgba(255,236,190,.9)'); gr.addColorStop(1, 'rgba(255,236,190,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const beamMat2 = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
  let blobs = null, beams = null; const MAXC = 160;
  const pushCar = (kind, colr, x, z, ry) => { let q = fleetQ.get(kind); if (!q) fleetQ.set(kind, q = []); q.push(kind, colr, x, z, ry); };
  function drawFleet(night) {
    let total = 0; for (const q of fleetQ.values()) total += q.length / 5;
    if (!blobs) { blobs = new THREE.InstancedMesh(blobGeo, blobMat, MAXC); blobs.frustumCulled = false; scene.add(blobs); beams = new THREE.InstancedMesh(beamGeo, beamMat2, MAXC); beams.frustumCulled = false; scene.add(beams); }
    let b = 0; beamMat2.opacity = night * 0.55;
    for (const [kind, m] of fleetM) if (!fleetQ.has(kind)) m.count = 0;
    for (const [kind, q] of fleetQ) { const n = q.length / 5; let m = fleetM.get(kind);
      if (!m || m.userData.cap < n) { const lite = W.carLite(kind), cap = Math.max(8, 1 << Math.ceil(Math.log2(n + 1)));
        if (m) { scene.remove(m); m.dispose(); } const mat = m ? m.material : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: Math.min(0.6, lite.paint[0] + 0.08), metalness: lite.paint[1] * 0.8, envMapIntensity: lite.paint[2] });
        m = new THREE.InstancedMesh(lite.geo, mat, cap); m.userData = { cap, L: lite.L, W: lite.W }; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; scene.add(m); fleetM.set(kind, m); }
      for (let i = 0; i < n; i++) { const [, c, x, z, ry] = q.slice(i * 5, i * 5 + 5); Q.setFromAxisAngle(Y, ry); M4.compose(P3.set(x, 0, z), Q, V1); m.setMatrixAt(i, M4); m.setColorAt(i, C3.set(c));
        if (b < MAXC) { M4.compose(P3.set(x, 0.02, z), Q, new THREE.Vector3(m.userData.W * 1.2, 1, m.userData.L * 1.05)); blobs.setMatrixAt(b, M4);
          if (night > 0.05) { const L2 = m.userData.L / 2; M4.compose(P3.set(x - Math.sin(ry) * L2, 0.04, z - Math.cos(ry) * L2), Q, new THREE.Vector3(3.4, 1, 9)); beams.setMatrixAt(b, M4); } b++; } }
      m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    blobs.count = b; blobs.instanceMatrix.needsUpdate = true; beams.count = night > 0.05 ? b : 0; beams.instanceMatrix.needsUpdate = true; fleetQ.clear(); }

  // ---- the traffic: cars that drive the real roads round you, keep to their lane, stop behind you, and turn at junctions ----
  const traffic = [], WANT_CARS = PHONE ? (HQ ? 12 : 7) : 22, MODELS = ['hatch', 'sedan', 'sedan', 'hatch', 'suv', 'pickup', 'ev', 'evsedan', 'evsuv', 'luxury', 'sports', 'gt', 'supercar'], PAINTS = ['#C8382E', '#2F5D9E', '#E9E4D8', '#2B2F33', '#E2B13C', '#3C8A5A', '#7C8288', '#F2F0EA', '#1E2228', '#5E3FD6', '#0FA3A3'];
  let wantCars = WANT_CARS; const drivable = (tx, ty) => { const t = opts.road(tx, ty); return !!t && !(ROAD_TYPES[t] || {}).nocars && !(ROAD_TYPES[t] || {}).rail && opts.loaded(tx, ty); };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function spawnCar() { const ct = tileOf(car.x), cz = tileOf(car.z), R = Math.floor((RAD + 0.45) * B);
    for (let k = 0; k < 30; k++) { const tx = ct + Math.round((Math.random() * 2 - 1) * R), ty = cz + Math.round((Math.random() * 2 - 1) * R); if (Math.hypot(tx - ct, ty - cz) < 7 || !drivable(tx, ty)) continue;
      const opts2 = DIRS.filter(([dx, dy]) => drivable(tx + dx, ty + dy)); if (!opts2.length) continue; const [dx, dy] = opts2[Math.floor(Math.random() * opts2.length)];
      const m = MODELS[Math.floor(Math.random() * MODELS.length)], t = { kind: m, col: PAINTS[Math.floor(Math.random() * PAINTS.length)], fx: tx, fy: ty, tx: tx + dx, ty: ty + dy, u: Math.random(), v: 0, top: 6 + Math.random() * 6, px: 0, pz: 0, ry: 0 };
      place(t, 1); traffic.push(t); return; } }
  function place(t, snap) { const ax = (t.fx + 0.5) * TILE, az = (t.fy + 0.5) * TILE, bx2 = (t.tx + 0.5) * TILE, bz2 = (t.ty + 0.5) * TILE, dx = t.tx - t.fx, dy = t.ty - t.fy, lane = 1.3; /* clear of the parked cars and of the oncoming lane */
    const x = ax + (bx2 - ax) * t.u - dy * lane, z = az + (bz2 - az) * t.u + dx * lane, ry = Math.atan2(-dx, -dy); /* keep to the right-hand lane */
    if (snap) { t.px = x; t.pz = z; t.ry = ry; return; } t.px += (x - t.px) * 0.3; t.pz += (z - t.pz) * 0.3; /* round the corner, not a jump to the next lane */
    let d = ry - t.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); t.ry += d * 0.18; }
  function driveTraffic(dt) {
    const R = (RAD + 0.6) * B * TILE; for (let i = traffic.length - 1; i >= 0; i--) if (Math.hypot(traffic[i].px - car.x, traffic[i].pz - car.z) > R) traffic.splice(i, 1);
    while (traffic.length < wantCars && Math.random() < 0.5) { const n = traffic.length; spawnCar(); if (traffic.length === n) break; }
    for (const t of traffic) { const dx = t.tx - t.fx, dy = t.ty - t.fy, rt = opts.road(t.fx, t.fy), top = Math.min(t.top, 7 * ((ROAD_TYPES[rt] || {}).speed || 2) * 0.75);
      // something ahead (you, or another car in the same lane): slow down and stop behind it
      let gap = 99; const hx = -Math.sin(t.ry), hz = -Math.cos(t.ry);
      let byMe = false; for (const o of [{ px: car.x, pz: car.z, me: 1 }, ...traffic]) { if (o === t) continue; const ox = o.px - t.px, oz = o.pz - t.pz, ahead = ox * hx + oz * hz, side = Math.abs(ox * hz - oz * hx); if (ahead > -1.5 && ahead < gap && side < (o.me ? 3.2 : 2.2)) { gap = Math.max(0, ahead); byMe = !!o.me; } }
      const want = gap < 6.5 ? 0 : gap < 14 ? top * (gap - 6.5) / 7.5 : top; t.v += Math.max(-12 * dt, Math.min(3 * dt, want - t.v)); if (gap < 4.5) t.v = Math.min(t.v, 0);
      t.wait = t.v < 0.3 && byMe ? (t.wait || 0) + dt : 0; /* stuck behind you a while: turn round and go another way */
      if (t.wait > 4) { t.wait = 0; [t.fx, t.fy, t.tx, t.ty] = [t.tx, t.ty, t.fx, t.fy]; t.u = Math.max(0, 1 - t.u); t.v = 0; }
      t.u += t.v * dt / TILE;
      while (t.u >= 1) { t.u -= 1; const nx = [];
        for (const [ex, ey] of DIRS) { if (ex === -dx && ey === -dy) continue; if (drivable(t.tx + ex, t.ty + ey)) nx.push([ex, ey]); }
        const straight = nx.find(([ex, ey]) => ex === dx && ey === dy), pick = straight && Math.random() < 0.65 ? straight : nx.length ? nx[Math.floor(Math.random() * nx.length)] : [-dx, -dy];
        t.fx = t.tx; t.fy = t.ty; t.tx += pick[0]; t.ty += pick[1]; if (!drivable(t.tx, t.ty)) { t.tx = t.fx - dx; t.ty = t.fy - dy; } }
      place(t, 0); pushCar(t.kind, t.col, t.px, t.pz, t.ry); } }

  // ---- people on the pavements: walking along the kerbs, swinging their legs (four draws for all of them) ----
  const peds = [], WANT_PEDS = PHONE ? (HQ ? 26 : 14) : 44;
  const pedParts = (() => { const torso = new THREE.CapsuleGeometry(0.21, 0.5, 3, 8); torso.translate(0, 1.22, 0); const head = new THREE.SphereGeometry(0.13, 10, 8); head.translate(0, 1.72, 0);
    const leg = new THREE.CapsuleGeometry(0.09, 0.62, 3, 6); leg.translate(0, -0.4, 0); /* hangs from the hip */
    const mk = (g, c) => { const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }), WANT_PEDS); m.frustumCulled = false; m.count = 0; scene.add(m); return m; };
    return { torso: mk(torso, '#ffffff'), head: mk(head, '#ffffff'), legL: mk(leg, '#ffffff'), legR: mk(leg, '#ffffff') }; })();
  const SHIRTS = ['#2f5d9e', '#3c8a5a', '#e2b13c', '#8e44ad', '#d35d6e', '#2ec4b6', '#f2994a', '#7f8c8d', '#c0392b', '#f4f1ea', '#1e2a3a'], SKINS = ['#8d5524', '#c68642', '#e0ac69', '#5c3a21', '#a0663d'], LEGS = ['#2b2f33', '#3b4a63', '#5c4a3b', '#4a4a4a', '#26313b', '#6b7b8c'];
  const kerbOf = (tx, ty, side) => { const [dx, dy] = side; return drivable(tx, ty) && !opts.road(tx + dx, ty + dy) && !opts.water(tx + dx, ty + dy); };
  function spawnPed() { const ct = tileOf(car.x), cz = tileOf(car.z), R = Math.floor((RAD + 0.3) * B);
    for (let k = 0; k < 30; k++) { const tx = ct + Math.round((Math.random() * 2 - 1) * R), ty = cz + Math.round((Math.random() * 2 - 1) * R), side = DIRS[Math.floor(Math.random() * 4)]; if (!kerbOf(tx, ty, side)) continue;
      const along = side[1] !== 0 ? [1, 0] : [0, 1], sgn = Math.random() < 0.5 ? 1 : -1, i = peds.length;
      peds.push({ tx, ty, side, dir: [along[0] * sgn, along[1] * sgn], u: Math.random(), sp: 1.1 + Math.random() * 0.5, ph: Math.random() * 6, shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)], skin: SKINS[Math.floor(Math.random() * SKINS.length)], legs: LEGS[Math.floor(Math.random() * LEGS.length)], h: 0.92 + Math.random() * 0.14, i });
      return; } }
  const E = new THREE.Euler(), SC = new THREE.Vector3();
  function walk(dt) {
    const R = (RAD + 0.5) * B * TILE; for (let i = peds.length - 1; i >= 0; i--) { const p = peds[i]; if (Math.hypot((p.tx + 0.5) * TILE - car.x, (p.ty + 0.5) * TILE - car.z) > R) peds.splice(i, 1); }
    while (peds.length < WANT_PEDS && Math.random() < 0.4) { const n = peds.length; spawnPed(); if (peds.length === n) break; }
    let n = 0; for (const p of peds) { p.u += p.sp * dt / TILE; p.ph += dt * p.sp * 4.2;
      if (p.u >= 1) { p.u -= 1; const nx = p.tx + p.dir[0], ny = p.ty + p.dir[1]; if (kerbOf(nx, ny, p.side)) { p.tx = nx; p.ty = ny; } else { p.dir = [-p.dir[0], -p.dir[1]]; p.u = 1 - p.u; } } /* the pavement ends: turn round */
      const [sx, sy] = p.side, off = TILE / 2 + 0.8, fx = p.dir[0] ? (p.dir[0] > 0 ? p.u : 1 - p.u) : 0.5, fy = p.dir[1] ? (p.dir[1] > 0 ? p.u : 1 - p.u) : 0.5;
      const x = (p.tx + (p.dir[0] ? fx : 0.5)) * TILE + sx * off, z = (p.ty + (p.dir[1] ? fy : 0.5)) * TILE + sy * off, ry = Math.atan2(p.dir[0], p.dir[1]), bob = Math.abs(Math.sin(p.ph)) * 0.04, sw = Math.sin(p.ph) * 0.45;
      Q.setFromAxisAngle(Y, ry); SC.set(1, p.h, 1); M4.compose(P3.set(x, bob, z), Q, SC); pedParts.torso.setMatrixAt(n, M4); pedParts.head.setMatrixAt(n, M4);
      for (const [part, s2] of [[pedParts.legL, 1], [pedParts.legR, -1]]) { E.set(sw * s2, ry, 0, 'YXZ'); Q.setFromEuler(E); const lx = Math.cos(ry) * 0.1 * s2, lz = -Math.sin(ry) * 0.1 * s2; M4.compose(P3.set(x + lx, 0.84 * p.h + bob, z + lz), Q, SC.set(1, p.h, 1)); part.setMatrixAt(n, M4); }
      pedParts.torso.setColorAt(n, C3.set(p.shirt)); pedParts.head.setColorAt(n, C3.set(p.skin)); pedParts.legL.setColorAt(n, C3.set(p.legs)); pedParts.legR.setColorAt(n, C3.set(p.legs)); n++; }
    for (const m of Object.values(pedParts)) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }

  // a name over someone, with a green dot when they're online right now
  function tag(text, online, y) { const c = document.createElement('canvas'); c.width = 320; c.height = 72; const g = c.getContext('2d'); g.font = '700 30px system-ui, sans-serif';
    const w = Math.min(310, g.measureText(text).width + (online ? 64 : 34)); g.fillStyle = 'rgba(20,18,16,.62)'; g.beginPath(); if (g.roundRect) g.roundRect(160 - w / 2, 12, w, 48, 24); else g.rect(160 - w / 2, 12, w, 48); g.fill();
    let tx = 160 - w / 2 + 17; if (online) { g.fillStyle = '#2ecc71'; g.beginPath(); g.arc(tx + 9, 36, 9, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); tx += 30; }
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, tx, 37); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(2.6, 0.585, 1); s.position.y = y; s.renderOrder = 5; return s; }
  // ---- the colonists round you (walking, as on the map) and other people's cars (in the fleet, as their own models) ----
  const folk = new Map(); let folkAt = 0;
  function crowd(now, dt) {
    if (now - folkAt > 400) { folkAt = now; const L = opts.people(car.x / TILE, car.z / TILE), seen = new Set();
      for (const p of L) { seen.add(p.id); const kind = p.car ? 'car' : 'walk'; let f = folk.get(p.id);
        if (f && f.kind !== kind) { if (f.g) scene.remove(f.g); folk.delete(p.id); f = null; }
        if (f && kind === 'walk' && p.look && !f.look) { scene.remove(f.g); folk.delete(p.id); f = null; } /* their own look arrived: show them as themselves */
        if (!f) { if (kind === 'walk') { const P = W.makePerson(p.id, null, p.look || null); f = { kind, P, g: P.group, look: !!p.look }; if (p.tag) P.group.add(tag(p.tag, p.online, 2.15)); f.g.position.set(p.x * TILE, 0, p.y * TILE); scene.add(f.g); } else f = { kind, m: p.m || 'sedan', col: p.col || '#7c8288', x: p.x * TILE, z: p.y * TILE, ry: 0 }; folk.set(p.id, f); }
        f.tx = p.x * TILE; f.tz = p.y * TILE; if (f.kind === 'car') { f.m = p.m || f.m; f.col = p.col || f.col; if (p.tag && !f.tagO) { f.tagO = tag(p.tag, p.online, 0); scene.add(f.tagO); } } }
      for (const [id, f] of folk) if (!seen.has(id)) { if (f.g) scene.remove(f.g); if (f.tagO) { scene.remove(f.tagO); f.tagO.material.map.dispose(); f.tagO.material.dispose(); } folk.delete(id); } }
    for (const f of folk.values()) { const k = Math.min(1, dt * 2.5); if (f.kind === 'car' && f.tagO) { f.tagO.position.set(f.x, 2.4, f.z); }
      if (f.kind === 'car') { const dx = f.tx - f.x, dz = f.tz - f.z; if (Math.hypot(dx, dz) > 40) { f.x = f.tx; f.z = f.tz; } else { f.x += dx * k; f.z += dz * k; if (Math.hypot(dx, dz) > 0.05) { let d = Math.atan2(-dx, -dz) - f.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); f.ry += d * Math.min(1, dt * 5); } } pushCar(f.m, f.col, f.x, f.z, f.ry); continue; }
      const g = f.g, dx = f.tx - g.position.x, dz = f.tz - g.position.z; if (Math.hypot(dx, dz) > 40) { g.position.x = f.tx; g.position.z = f.tz; continue; }
      const vx = dx * k / Math.max(dt, 1e-3), vz = dz * k / Math.max(dt, 1e-3); g.position.x += dx * k; g.position.z += dz * k; f.P.animate(dt, vx, vz); } }

  // ---- the sky: slow clouds, and birds by day ----
  const sky = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); for (let i = 0; i < 7; i++) { const gx = 30 + Math.random() * 68, gy = 40 + Math.random() * 48, r = 22 + Math.random() * 22, gr = x.createRadialGradient(gx, gy, 2, gx, gy, r); gr.addColorStop(0, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const N = PHONE ? 10 : 18, m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0.8 }), N);
    m.frustumCulled = false; scene.add(m); const cl = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 1400, z: (Math.random() - 0.5) * 1400, s: 120 + Math.random() * 180, y: 170 + Math.random() * 70 }));
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, -0.7, 0.15, -0.1, 0, 0, -0.1, 0, 0, 0.25, 0.7, 0.15, -0.1, 0, 0, -0.1], 3)); bg.computeVertexNormals();
    const birds = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: '#2b2b30', side: THREE.DoubleSide, fog: false }), 9); birds.frustumCulled = false; scene.add(birds);
    return { m, cl, birds, t }; })();
  function skyLife(dt, now, night) { const S2 = sky; let i = 0; for (const c of S2.cl) { c.x += dt * 3; if (c.x - car.x > 700) c.x -= 1400; if (car.x - c.x > 700) c.x += 1400; if (c.z - car.z > 700) c.z -= 1400; if (car.z - c.z > 700) c.z += 1400;
      M4.compose(P3.set(c.x, c.y, c.z), Q.identity(), SC.set(c.s, 1, c.s * 0.6)); S2.m.setMatrixAt(i++, M4); } S2.m.instanceMatrix.needsUpdate = true; S2.m.material.opacity = 0.8 * (1 - night * 0.85);
    S2.birds.visible = night < 0.4; if (S2.birds.visible) { for (let k = 0; k < 9; k++) { const a = now / 9000 + k * 0.5, cx = car.x + 60 + Math.cos(now / 30000) * 40, cz = car.z - 50; E.set(0, -a + Math.PI / 2, 0); Q.setFromEuler(E);
      M4.compose(P3.set(cx + Math.cos(a) * (30 + k * 2), 38 + Math.sin(now / 900 + k) * 2, cz + Math.sin(a) * (30 + k * 2)), Q, SC.set(1.4, 1 + Math.sin(now / 120 + k * 1.7) * 0.9, 1.4)); S2.birds.setMatrixAt(k, M4); } S2.birds.instanceMatrix.needsUpdate = true; } }

  // your car's headlights after dark
  const head = new THREE.SpotLight('#fff1d6', 0, 70, 0.55, 0.6, 1.2); head.castShadow = false; scene.add(head, head.target);

  // ---- the camera: behind the car, from the driver's seat, or higher up; drag anywhere to look round as you drive ----
  let mode = 0; const cam = new THREE.Vector3(car.x - Math.cos(car.a) * 9, 3.6, car.z + Math.sin(car.a) * 9), look = new THREE.Vector3();
  const lk = { yaw: foot ? car.a : 0, pitch: 0, id: null, x: 0, y: 0, at: 0 }, /* yaw: on foot, where the camera faces; driving, how far it's turned from the car */ aim = { x: car.x + Math.cos(car.a) * 6, z: car.z - Math.sin(car.a) * 6 };
  // the driver's seat: the inside of the car, fixed to the car (not to your eyes), so you can look round the cabin as you drive:
  // the dashboard and its dials, a steering wheel that turns as you steer, the bonnet ahead, the pillars, doors, roof, seats and mirror
  const cockpit = new THREE.Group(), dashM = new THREE.MeshStandardMaterial({ color: '#23252a', roughness: 0.7 }), wheelM = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.5 });
  { const trimM = new THREE.MeshStandardMaterial({ color: '#2e3036', roughness: 0.8 }), seatM = new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 0.9 }), roofM = new THREE.MeshStandardMaterial({ color: '#d9d4c9', roughness: 0.95 }),
      paintM = new THREE.MeshStandardMaterial({ color: opts.car.col || '#c8382e', roughness: 0.3, metalness: 0.5 }), glowM = new THREE.MeshBasicMaterial({ color: '#9fe3ff' }), mirM = new THREE.MeshStandardMaterial({ color: '#9fb4c4', roughness: 0.15, metalness: 0.8 });
    const box = (w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); cockpit.add(b); return b; };
    box(1.84, 0.34, 0.62, dashM, 0, 0.56, -1.12); box(1.84, 0.06, 0.5, trimM, 0, 0.75, -1.2, -0.12); /* the dashboard, and its top */
    box(1.9, 0.05, 1.7, paintM, 0, 0.7, -2.25, 0.07); /* the bonnet out ahead */
    box(0.34, 0.12, 0.04, trimM, -0.36, 0.79, -1.02, -0.5); for (const x of [-0.43, -0.29]) { const g = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), glowM); g.position.set(x, 0.8, -0.995); g.rotation.x = -0.5; cockpit.add(g); } /* the dials, behind the wheel */
    { const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), glowM); sc.position.set(0.05, 0.72, -0.82); sc.rotation.x = -0.35; cockpit.add(sc); } box(0.26, 0.26, 1.0, trimM, 0, 0.36, -0.2); /* the middle screen, and the console between the seats */
    for (const sd of [-1, 1]) { box(0.06, 0.5, 2.3, trimM, sd * 0.9, 0.6, -0.05); /* the door, up to the window */ box(0.07, 0.06, 2.3, dashM, sd * 0.9, 0.86, -0.05); /* the window sill */
      box(0.07, 0.07, 0.95, dashM, sd * 0.84, 1.15, -0.85, -0.82); /* the windscreen pillar */ box(0.08, 0.62, 0.12, dashM, sd * 0.88, 1.18, 0.45); /* the pillar behind the doors */
      box(0.5, 0.12, 0.5, seatM, sd * 0.36, 0.4, 0.1); box(0.5, 0.7, 0.12, seatM, sd * 0.36, 0.78, 0.42, 0.12); box(0.26, 0.2, 0.1, seatM, sd * 0.36, 1.25, 0.47, 0.12); } /* the seats and headrests */
    box(1.7, 0.4, 0.5, seatM, 0, 0.62, 1.15, 0.1); box(1.74, 0.05, 1.8, roofM, 0, 1.5, 0.25); box(1.74, 0.06, 0.08, dashM, 0, 1.47, -0.66); /* the back seat, the roof lining and its front edge */
    box(0.24, 0.07, 0.02, mirM, 0, 1.38, -0.62); box(0.02, 0.08, 0.02, dashM, 0, 1.44, -0.62); for (const x of [-0.42, 0.42]) box(0.36, 0.02, 0.2, roofM, x, 1.45, -0.55, 0.25); /* the mirror and the sun visors */ }
  const sw = new THREE.Group(); sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.026, 10, 32), wheelM)); for (const a of [0, 2.1, 4.2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.02), wheelM); sp.position.set(Math.sin(a) * 0.09, Math.cos(a) * 0.09, 0); sp.rotation.z = -a; sw.add(sp); }
  { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), wheelM); col.rotation.x = Math.PI / 2; col.position.z = -0.15; sw.add(col); }
  sw.position.set(-0.36, 0.74, -0.86); sw.rotation.x = -0.42; cockpit.add(sw); cockpit.visible = false; scene.add(cockpit);
  function chase(dt) {
    if (lk.id == null && !foot) { const back = Math.exp(-dt * Math.min(0.8, Math.abs(car.v) / 22)); lk.yaw *= back; lk.pitch *= back; } /* let go: the view stays where you turned it, and drifts gently back behind the car as you drive (not at all while you're stopped) */
    const fp = mode === 1; cockpit.visible = fp && !foot; sw.rotation.z = car.steer * 1.4; if (cockpit.visible) { cockpit.position.set(car.x, 0, car.z); cockpit.rotation.set(0, car.a - Math.PI / 2, 0); }
    { const near = fp ? 0.08 : 0.5; if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); } } /* in the car, close enough to see the wheel */
    if (fp && foot) { const a = lk.yaw; camera.position.set(car.x + Math.cos(a) * 0.1, 1.62, car.z - Math.sin(a) * 0.1); look.set(camera.position.x + Math.cos(a) * 10, 1.62 + Math.tan(lk.pitch - 0.02) * 10, camera.position.z - Math.sin(a) * 10); camera.lookAt(look); cam.copy(camera.position); view.cut.R.value = 0; } /* through your own eyes */
    else if (fp) { const a = car.a + lk.yaw; camera.position.set(car.x + Math.cos(car.a) * 0.15 - Math.sin(car.a) * 0.36, 1.18, car.z - Math.sin(car.a) * 0.15 - Math.cos(car.a) * 0.36); /* the driver's seat, on the left */
      look.set(camera.position.x + Math.cos(a) * 10, 1.18 + Math.tan(lk.pitch - 0.04) * 10, camera.position.z - Math.sin(a) * 10); camera.lookAt(look); cam.copy(camera.position); view.cut.R.value = 0; }
    else { const high = mode === 2, a = foot ? lk.yaw : car.a + lk.yaw, back = foot ? (high ? 14 : 4.2) : high ? 26 : 9, up = (foot ? (high ? 10 : 2.3) : high ? 18 : 3.4) + lk.pitch * -8, tx = car.x - Math.cos(a) * back, tz = car.z + Math.sin(a) * back, k = Math.min(1, dt * 4.5); /* one steady pace, dragging or not: no jumps */
      cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k; cam.y += (Math.max(1.2, up) - cam.y) * k; camera.position.copy(cam);
      const ahead = foot ? 3 : 6, lx = car.x + Math.cos(a) * ahead, lz = car.z - Math.sin(a) * ahead; aim.x += (lx - aim.x) * k; aim.z += (lz - aim.z) * k; look.set(aim.x, foot ? 1.45 : 1.2, aim.z); camera.lookAt(look); /* look past the car the way the camera faces */
      view.cut.A.value.set(car.x, 1.0, car.z); { const bx = camera.position.x - car.x, bz = camera.position.z - car.z, L = Math.hypot(bx, bz) || 1; view.cut.B.value.set(camera.position.x + bx / L * 3, camera.position.y + 1, camera.position.z + bz / L * 3); } view.cut.R.value = high ? 6 : 3.8; } /* see through what's between you and the car, and just behind the camera */
    if (bump > 0) { bump -= dt; camera.position.y += Math.sin(bump * 60) * 0.08; }
    const sp = Math.abs(car.v); if (sp > 16) { const t = now0() / 1000, k = (sp - 16) * 0.0016; camera.position.x += Math.sin(t * 37) * k; camera.position.y += Math.sin(t * 43) * k; } } /* a faint tremble at speed */
  const now0 = () => performance.now();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { if (lk.id != null) return; lk.id = e.pointerId; lk.x = e.clientX; lk.y = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== lk.id) return; lk.yaw = foot ? lk.yaw - (e.clientX - lk.x) * 0.006 : Math.max(-Math.PI, Math.min(Math.PI, lk.yaw - (e.clientX - lk.x) * 0.006)); lk.pitch = Math.max(-0.5, Math.min(0.45, lk.pitch - (e.clientY - lk.y) * 0.004)); lk.x = e.clientX; lk.y = e.clientY; });
  const lkEnd = e => { if (e.pointerId === lk.id) { lk.id = null; lk.at = now0(); } }; canvas.addEventListener('pointerup', lkEnd); canvas.addEventListener('pointercancel', lkEnd);
  canvas.addEventListener('dblclick', () => { lk.yaw = foot ? car.a : 0; lk.pitch = 0; });

  // ---- the way to where you're going: arrows along the road, and a beam of light where it ends ----
  const routeG = new THREE.Group(); scene.add(routeG); let routeMesh = null, routeEnd = null;
  const chevron = (() => { const sh = new THREE.Shape(); sh.moveTo(1.1, 0); sh.lineTo(-0.5, 1.0); sh.lineTo(-0.1, 0); sh.lineTo(-0.5, -1.0); sh.closePath(); const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); return g; })();
  const routeMat = new THREE.MeshBasicMaterial({ color: '#2f9bff', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false });
  const beamMat = new THREE.MeshBasicMaterial({ color: '#2f9bff', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
  function setRoute(path) { if (routeMesh) { routeG.remove(routeMesh); routeMesh.dispose(); routeMesh = null; } if (routeEnd) { routeG.remove(routeEnd); routeEnd.geometry.dispose(); routeEnd = null; }
    if (!path || path.length < 2) return; const pts = path.map(([x, y]) => [(x + 0.5) * TILE, (y + 0.5) * TILE]), spots = [];
    for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx2, bz2] = pts[i], L2 = Math.hypot(bx2 - ax, bz2 - az), ang = Math.atan2(-(bz2 - az), bx2 - ax); for (let d = 2; d < L2; d += 4) spots.push([ax + (bx2 - ax) * d / L2, az + (bz2 - az) * d / L2, ang]); }
    routeMesh = new THREE.InstancedMesh(chevron, routeMat, Math.max(1, spots.length)); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, a], i) => { q.setFromAxisAngle(up, a); m.compose(new THREE.Vector3(x, 0.09, z), q, sc); routeMesh.setMatrixAt(i, m); }); routeMesh.count = spots.length; routeMesh.frustumCulled = false; routeG.add(routeMesh);
    const [ex, ez] = pts[pts.length - 1]; routeEnd = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 16, 1, true), beamMat); routeEnd.position.set(ex, 30, ez); routeG.add(routeEnd); }

  // ---- the loop ----  // ---- the loop ----
  let nearCar = false, sent = 0, nearAt = 0, nearId = null, chk = 0, timeAt = 0, shadowAt = { x: 1e9, z: 1e9 }, shadowsDue = true, frames = 0, spent = 0, dead = false;
  const minute = () => (opts.minute ? opts.minute() : 720);
  function sunNow(force) { if (!(force || shadowsDue || Math.hypot(car.x - shadowAt.x, car.z - shadowAt.z) > 40)) return; shadowAt = { x: car.x, z: car.z }; shadowsDue = false;
    view.center.set(car.x, 0, car.z); view.span = 110; view.setTime(minute()); haze(); }
  view.resize(); around(); sunNow(true);
  view.start((dt, now) => {
    if (dead) return; drive(dt);
    me.visible = !foot && mode !== 1; if (feet) { feet.group.visible = foot && mode !== 1; if (foot) { feet.setPos(car.x, car.z); { const m = car.mv == null ? car.a : car.mv; feet.animate(dt, Math.cos(m) * car.v, -Math.sin(m) * car.v); } feet.group.rotation.y = car.a + Math.PI / 2; } } /* your character walks (and faces where you're going) */
    if (parked) pushCar(parked.kind, parked.col, parked.x, parked.z, parked.ry);
    me.position.set(car.x, 0, car.z); me.rotation.set(0, 0, 0); me.rotation.y = car.a - Math.PI / 2; for (const w of me.userData.wheels || []) w.rotation.x -= car.v * dt / 0.33;
    roll += (car.steer * Math.min(1, Math.abs(car.v) / 14) * 0.05 - roll) * Math.min(1, dt * 5); pitch += ((accel0 - car.v) / Math.max(dt, 1e-3) * 0.0025 - pitch) * Math.min(1, dt * 4); accel0 = car.v; me.rotateZ(roll); me.rotateX(Math.max(-0.035, Math.min(0.035, pitch))); /* the body leans into a turn and dips when you brake */
    const night = view.night || 0; for (const blk of blocks.values()) for (const c of blk.parked) pushCar(c.kind, c.col, c.x, c.z, c.ry);
    driveTraffic(dt); walk(dt); skyLife(dt, now, night);
    head.intensity = foot ? 0 : night * 60; if (night > 0.02) { const fx = Math.cos(car.a), fz = -Math.sin(car.a); head.position.set(car.x + fx * 1.8, 0.9, car.z + fz * 1.8); head.target.position.set(car.x + fx * 14, 0, car.z + fz * 14); }
    const fov = mode === 1 && camera.aspect < 1 ? 72 + (foot ? 0 : Math.min(8, Math.abs(car.v) * 0.3)) : foot ? 62 : 60 + Math.min(14, Math.abs(car.v) * 0.45); if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); } /* the view widens with speed */
    GRASS.time.value = now / 1000; chase(dt); crowd(now, dt); drawFleet(night); routeMat.opacity = 0.6 + 0.3 * Math.sin(now / 250); ground.position.set(Math.round(car.x / 50) * 50, -0.08, Math.round(car.z / 50) * 50);
    if (now - chk > 600) { chk = now; around(); }
    if (queue.length) { const [bx, by] = queue.shift().split(',').map(Number); if (opts.loaded(bx + B / 2, by + B / 2) || opts.loaded(bx, by)) build(bx, by); else queue.push(bx + ',' + by); }
    if (now - timeAt > 20000) { timeAt = now; shadowsDue = true; } sunNow(false);
    if (now - sent > 250) { sent = now; opts.onMove(car.x / TILE, car.z / TILE, car.a, car.v / TILE); }
    if (now - nearAt > 300) { nearAt = now; let b = null; const fx = car.x + Math.cos(car.a) * 3, fz = car.z - Math.sin(car.a) * 3;
      if (foot) { let bd = 3.2; for (const s of solidsNear(car.x, car.z)) { if (!s.door) continue; const d = Math.hypot(s.door[0] - car.x, s.door[1] - car.z); if (d < bd) { bd = d; b = s.id; } } /* at the front door */
        const nc = !!parked && Math.hypot(parked.x - car.x, parked.z - car.z) < 4.5; if (nc !== nearCar) { nearCar = nc; opts.onCar && opts.onCar(nc); } }
      else if (Math.abs(car.v) < 5) { let bd = 7; for (const s of solidsNear(car.x, car.z)) { if (!s.id || !s.r) continue; const dx = Math.max(s.r[0] - fx, 0, fx - s.r[2]), dz = Math.max(s.r[1] - fz, 0, fz - s.r[3]), d = Math.hypot(dx, dz); if (d < bd) { bd = d; b = s.id; } } }
      if (b !== nearId) { nearId = b; opts.onNear(b ? opts.byId(b) : null); } }
    frames++; spent += dt; if (frames >= 120) { const fps = frames / spent; frames = 0; spent = 0; if (fps < 24) { if (wantCars > 4) wantCars = Math.max(4, Math.floor(wantCars * 0.6)); else if (RAD > 1) { RAD--; haze(); around(); } } } /* can't keep up: less traffic first, then a block less far */ /* can't keep up: one block less far */
  });
  const refresh = setInterval(() => { if (!dead) for (const k of blocks.keys()) if (!queue.includes(k)) queue.push(k); }, 8000); /* pick up changes to the town */

  // ---- controls on screen, in the layout picked in Settings: a stick; pedals and steer buttons; or a steering wheel and
  // pedals (steering on the left unless it's swapped). The arrow keys and the keys picked in Settings always work too.
  let pad = null;
  function controls() { if (pad) pad.remove(); inp.thr = inp.steer = 0; const lay = foot ? 'stick' : ctl.layout || 'stick'; /* on foot: always the stick */ pad = document.createElement('div'); pad.className = 'tpad ' + lay + (ctl.swap ? ' swap' : ''); let ts = ctl.steerSize || 1, tp = ctl.pedalSize || 1; if (lay !== 'stick') { const W0 = host.clientWidth || innerWidth, need = (lay === 'wheel' ? 150 * ts : 170 * ts) + 168 * tp + 52; if (need > W0) { const f = (W0 - 52) / (need - 52); ts *= f; tp *= f; } } /* both fit side by side, however big you've made them */
    pad.style.setProperty('--ts', String(ts)); pad.style.setProperty('--tp', String(tp)); host.append(pad); /* sizes picked in Settings */
    { const right = lay === 'stick' ? (ctl.swap ? 28 + 128 * ts : 0) : ctl.swap ? (lay === 'wheel' ? 18 + 150 * ts : 24 + 78 * ts) : 20 + 118 * tp;
      (host.parentElement || host).style.setProperty('--dhud', Math.max(24, right + 14) + 'px'); } /* the speed and Stop buttons sit above whatever is on the right */
    const mk = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; pad.append(d); return d; };
    const hold = (elm, down, up) => { const on = new Set(); elm.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { elm.setPointerCapture(e.pointerId); } catch (x) {} on.add(e.pointerId); elm.classList.add('on'); down(e); });
      const off = e => { if (!on.delete(e.pointerId)) return; if (!on.size) { elm.classList.remove('on'); up(e); } }; elm.addEventListener('pointerup', off); elm.addEventListener('pointercancel', off); return on; };
    if (lay === 'stick') { const st = mk('tjoy', '<i></i>'), knob = st.firstChild; let id = null;
      const mv = e => { const r = st.getBoundingClientRect(), R = r.width / 2; let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } inp.thr = -dy; inp.steer = -dx; knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`; };
      st.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; st.setPointerCapture(id); mv(e); }); st.addEventListener('pointermove', e => { if (e.pointerId === id) mv(e); });
      const end = () => { id = null; inp.thr = inp.steer = 0; knob.style.transform = ''; }; st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end); return; }
    // the pedals: brake (and reverse when stopped) and accelerator, held down
    const pedals = mk('tpedals'), brake = document.createElement('div'), gas = document.createElement('div'); brake.className = 'tped brake'; brake.innerHTML = '<b>BRAKE</b>'; gas.className = 'tped gas'; gas.innerHTML = '<b>GAS</b>'; pedals.append(brake, gas);
    hold(gas, () => { inp.thr = 1; }, () => { inp.thr = Math.min(0, inp.thr); }); hold(brake, () => { inp.thr = -1; }, () => { inp.thr = Math.max(0, inp.thr); });
    if (lay === 'pedals') { const st = mk('tsteer'), l = document.createElement('div'), r = document.createElement('div'); l.className = 'tbtn'; l.textContent = '◀'; r.className = 'tbtn'; r.textContent = '▶'; st.append(l, r);
      hold(l, () => { inp.steer = 1; }, () => { inp.steer = Math.min(0, inp.steer); }); hold(r, () => { inp.steer = -1; }, () => { inp.steer = Math.max(0, inp.steer); }); return; }
    // a steering wheel: drag it round (up to about a turn and a half each way); it springs back when you let go
    const wh = mk('twheel', '<svg viewBox="-50 -50 100 100"><circle r="44" fill="none" stroke="#1d1f24" stroke-width="10"/><circle r="44" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/><path d="M-40 4 L-12 8 L-8 30 L8 30 L12 8 L40 4" fill="none" stroke="#1d1f24" stroke-width="8" stroke-linejoin="round"/><circle r="9" fill="#2a2d33"/><rect x="-3" y="-50" width="6" height="10" fill="#e8463a"/></svg>');
    let wid = null, a0 = 0, turned = 0, last = 0; const ang = e => { const r = wh.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
    wh.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); wid = e.pointerId; wh.setPointerCapture(wid); last = ang(e); });
    wh.addEventListener('pointermove', e => { if (e.pointerId !== wid) return; const a = ang(e); let d = a - last; d = Math.atan2(Math.sin(d), Math.cos(d)); last = a; turned = Math.max(-2.6, Math.min(2.6, turned + d)); inp.steer = -turned / 2.6; wh.style.transform = `rotate(${turned}rad)`; });
    const wend = () => { wid = null; const from = turned, t0 = now0(); const back = () => { const k = Math.min(1, (now0() - t0) / 250); turned = from * (1 - k); inp.steer = -turned / 2.6; wh.style.transform = `rotate(${turned}rad)`; if (k < 1 && wid == null) requestAnimationFrame(back); }; back(); };
    wh.addEventListener('pointerup', wend); wh.addEventListener('pointercancel', wend); }
  controls();
  const keyOf = e => e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const kd = e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = keyOf(e), K = Object.values(ctl.keys || {}).map(x => String(x).toLowerCase()); if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) || K.includes(String(k).toLowerCase())) { keys.add(String(k).length === 1 ? String(k).toLowerCase() : k); e.preventDefault(); } };
  const ku = e => keys.delete(keyOf(e)), kb = () => keys.clear();
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', kb);
  // turning the phone: the view follows its own box (not the window, which reports the turn in steps), and checks again as
  // the turn settles, so the picture never stretches or jumps
  const fit = () => { if (dead) return; view.resize(); canvas.style.width = '100%'; canvas.style.height = '100%'; }, ro = new ResizeObserver(fit); ro.observe(host);
  const turned = () => [60, 250, 600].forEach(t => setTimeout(fit, t)); addEventListener('orientationchange', turned); addEventListener('resize', fit);
  canvas.addEventListener('webglcontextlost', () => { setTimeout(() => { if (!dead && renderer.getContext().isContextLost()) opts.onLost && opts.onLost(); }, 8000); }); /* the view tries to come back by itself first */

  return {
    get pos() { return { x: car.x / TILE, y: car.z / TILE, a: car.a, v: car.v / TILE, mode: foot ? 'walk' : 'car' }; },
    // get out of the car (it stays parked there if it's yours) and walk, or get back in (at your parked car, or a car appears)
    walk(keep) { if (foot) return; parked = keep ? { kind: opts.car.kind || 'car', col: opts.car.col, x: car.x, z: car.z, ry: car.a - Math.PI / 2 } : null; foot = true; mkFeet(); lk.yaw = car.a; car.mv = null;
      const sx = -Math.sin(car.a) * 2.2, sz = -Math.cos(car.a) * 2.2; car.x += sx; car.z += sz; car.v = 0; nearCar = false; controls(); },
    drive() { if (!foot) return; if (parked) { car.x = parked.x; car.z = parked.z; car.a = parked.ry + Math.PI / 2; parked = null; } foot = false; car.v = 0; lk.yaw = 0; nearCar = false; opts.onCar && opts.onCar(false); controls(); },
    get parked() { return !!parked; },
    doorOf(id) { for (const v of blocks.values()) for (const s of v.solid) if (s.id === id && s.door) return { x: s.door[0] / TILE, y: s.door[1] / TILE, a: s.out }; return null; },
    kmh() { return Math.round(Math.abs(car.v) * 3.6); },
    stats() { return { ...stats, blocks: blocks.size, people: folk.size, traffic: traffic.length, walkers: peds.length, radius: RAD, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
    toggleView() { mode = (mode + 1) % 3; lk.yaw = foot ? lk.yaw : 0; lk.pitch = 0; return ['behind', 'driver', 'above'][mode]; },
    setControls(c) { ctl = c || ctl; controls(); },
    setRoute,
    stop() { car.v = 0; },
    dispose() { dead = true; clearInterval(refresh); view.stop(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', kb); removeEventListener('resize', fit); removeEventListener('orientationchange', turned); ro.disconnect();
      for (const v of blocks.values()) drop(v); blocks.clear(); for (const f of folk.values()) scene.remove(f.g); folk.clear();
      ground.geometry.dispose(); ground.material.dispose(); try { view.dispose(); } catch (e) {} try { renderer.forceContextLoss(); } catch (e) {} canvas.remove(); if (pad) pad.remove(); chevron.dispose(); routeMat.dispose(); beamMat.dispose(); for (const m of fleetM.values()) { scene.remove(m); m.dispose(); } blobGeo.dispose(); blobMat.dispose(); beamGeo.dispose(); beamMat2.dispose(); beamTex.dispose(); sky.t.dispose(); },
  };
}
