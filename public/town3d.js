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
import { follower } from '/creature3d.js';
import { BUILDING_TYPES, ROAD_TYPES, CAR_MODELS } from '/shared/catalog.js';
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
        const pc = { kind: PARK[H(tx, ty, 7) % PARK.length], col: PAINT[H(tx, ty, 8) % PAINT.length], x: wx(cx), z: wz(cz), ry: along ? (H(tx, ty, 9) & 1 ? Math.PI / 2 : -Math.PI / 2) : (H(tx, ty, 9) & 1 ? 0 : Math.PI) }; parked.push(pc);
        solid.push({ car: pc }); } } /* (solid as the car's own body: you can drive past it close enough to brush it) */
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
  const sig = (bx, by) => { let s = 0; for (const b of opts.buildings(bx, by, bx + B, by + B)) { const k = b.id + (b.lv || 1) + (b.rot || 0) + b.type + (b.name || ''); /* (renamed: its sign changes) */ for (let i = 0; i < k.length; i++) s = (s * 31 + k.charCodeAt(i)) >>> 0; }
    for (let ty = by; ty < by + B; ty++) for (let tx = bx; tx < bx + B; tx++) { const t = o_road(tx, ty); if (t) s = (s * 7 + t.length + tx * 3 + ty * 5) >>> 0; } return s; };
  const o_road = (x, y) => opts.road(x, y);
  function build(bx, by) {
    const t0 = performance.now(), key = bx + ',' + by, old = blocks.get(key), s = sig(bx, by); if (old && old.sig === s) return;
    const { L, solid, parked } = blockArea(bx, by, opts), g = W.buildArea(view, L, { cordon: false, pad: 0, ring: false, add: false });
    g.position.set(bx * TILE, 0, by * TILE); { const gr = grassBlock(bx, by, opts, HQ); if (gr) g.add(gr); } g.updateMatrixWorld(true); scene.add(g);
    if (old) drop(old); blocks.set(key, { g, sig: s, bx, by, solid, parked }); blocksVer++; shadowsDue = true; const ms = performance.now() - t0; stats.builds++; stats.maxMs = Math.max(stats.maxMs, ms); stats.totalMs += ms; }
  const stats = { builds: 0, maxMs: 0, totalMs: 0 }; /* how long blocks take to build (for checking it stays smooth) */
  const drop = v => { scene.remove(v.g); const gone = new Set(); v.g.traverse(m => { m.geometry && m.geometry.dispose(); if (m.userData.sign) { gone.add(m.material); W.dropSign(m.material); } }); if (gone.size) view.mats = view.mats.filter(x => !gone.has(x)); }; /* (its name boards too) */
  const near = () => { const cx = Math.floor(car.x / TILE / B), cy = Math.floor(car.z / TILE / B), want = [];
    for (let i = -RAD; i <= RAD; i++) for (let j = -RAD; j <= RAD; j++) want.push([(cx + i) * B, (cy + j) * B]); return want; };
  function around() { const want = near(), keys = new Set(want.map(([a, b]) => a + ',' + b));
    for (const [k, v] of blocks) if (!keys.has(k)) { drop(v); blocks.delete(k); blocksVer++; }
    for (const [a, b] of want.sort((p, q) => Math.hypot(p[0] + B / 2 - car.x / TILE, p[1] + B / 2 - car.z / TILE) - Math.hypot(q[0] + B / 2 - car.x / TILE, q[1] + B / 2 - car.z / TILE)))
      if (!blocks.has(a + ',' + b) && !queue.includes(a + ',' + b)) queue.push(a + ',' + b); }
  const haze = () => { const far = (RAD + 0.5) * B * TILE; scene.fog.near = far * 0.45; scene.fog.far = far; };

  // ---- your car ----
  const car = { x: (opts.start.x) * TILE, z: (opts.start.y) * TILE, a: opts.start.a || 0, v: 0, steer: 0 };
  // what you're in: a car, a bike (your character rides it) or a boat (it only goes on water)
  const VK = opts.car.kind || 'car', BOAT = W.vehOn(VK) === 'water', BIKE = W.isVeh(VK) && !BOAT;
  const PERF = (() => { if (BIKE || BOAT) return ({ bicycle: { top: 9, acc: 2.6, grip: 6 }, motorbike: { top: 46, acc: 9.5, grip: 9 }, boat: { top: 24, acc: 4.5, grip: 3 }, sailboat: { top: 11, acc: 1.8, grip: 2.2 }, ferry: { top: 13, acc: 1.4, grip: 1.6 } })[VK] || { top: 12, acc: 3, grip: 3 }; const P = (CAR_MODELS[opts.car.m] || {}).price || 0, t = P >= 800000 ? 3 : P >= 200000 ? 2 : P >= 50000 ? 1 : 0; return { top: [36, 42, 54, 68][t], acc: [5.5, 6.6, 8.6, 11][t], grip: [8.6, 9.2, 10.4, 11.8][t], pw: [62, 95, 190, 380][t], trac: [4.4, 5.4, 7.6, 9.6][t], brk: [8.8, 9.3, 10.2, 11.2][t], gears: [5, 6, 7, 8][t] }; })(); /* how your car goes: top speed (m/s), pull, tyre grip (m/s² sideways), power per kg (W), traction and brakes (m/s²), gears */
  const CARPHYS = !BIKE && !BOAT; /* a car (not a bike or a boat): the full engine, gearbox and brakes below */
  let foot = opts.mode === 'walk', parked = null, riding = null, summon = null; /* summon: your car, driving up to you after you called it */ /* riding: in someone else's car ({ id, seat }), going where they drive */ /* foot: walking (your character), not driving; parked: your car, where you got out */
  let feet = null; const mkFeet = () => { if (feet) return feet; feet = W.makePerson('me', null, opts.look || null); feet.group.traverse(m => { if (m.isMesh) m.castShadow = true; }); scene.add(feet.group); return feet; };
  if (foot) mkFeet();
  let myPet = null; if (opts.pet) { try { myPet = follower(opts.pet); myPet.group.visible = false; scene.add(myPet.group); } catch (e) { myPet = null; } } /* your pet: with you on foot (in the car while you drive) */
  const me = W.makeCar(opts.car.kind || 'car', opts.car.col || '#c8382e'); scene.add(me); me.traverse(m => { if (m.isMesh) m.castShadow = true; });
  // on a bike, you ride it: your own character sits on the saddle, hands on the bars, feet down to the pedals
  if (BIKE) { const P = W.makePerson('me', null, opts.look || null); const A = P.av || P; if (A.pose) { A.pose('play'); if (A.legL) for (const l of [A.legL, A.legR]) { l.rotation.x = -0.95; if (l.children[0]) l.children[0].rotation.x = 1.15; } for (const a of [A.armL, A.armR]) if (a) a.rotation.x = -0.62; }
    P.group.rotation.y = Math.PI; P.group.position.set(0, VK === 'motorbike' ? -0.02 : 0.0, VK === 'motorbike' ? 0.3 : 0.26); P.group.traverse(m => { if (m.isMesh) m.castShadow = true; }); me.add(P.group); me.userData.rider = P; }
  const tileOf = v => Math.floor(v / TILE), PRJ = new THREE.Vector3();
  let blocksVer = 0, solidKey = '', solidList = []; /* the list is kept until you cross into another block or a block is built or dropped (it was rebuilt every frame) */
  const solidsNear = (x, z) => { const bx = Math.floor(tileOf(x) / B) * B, by = Math.floor(tileOf(z) / B) * B, key = bx + ',' + by + ',' + blocksVer; if (key === solidKey) return solidList; const out = [];
    for (const dx of [-B, 0, B]) for (const dz of [-B, 0, B]) { const v = blocks.get((bx + dx) + ',' + (by + dz)); if (v) for (const o of v.solid) out.push(o); } solidKey = key; solidList = out; return out; };
  // only the obstacles within reach of you (m metres, and a car's length more for cars): what the bump tests look at
  const REACH = [], closeSolids = (S, x, z, m) => { REACH.length = 0; for (const s of S) { if (s.car) { if (Math.abs(s.car.x - x) < m + 7 && Math.abs(s.car.z - z) < m + 7) REACH.push(s); } else if (s.r) { if (x > s.r[0] - m && x < s.r[2] + m && z > s.r[1] - m && z < s.r[3] + m) REACH.push(s); } else if (Math.abs(x - s.c[0]) < s.c[2] + m && Math.abs(z - s.c[1]) < s.c[2] + m) REACH.push(s); } return REACH; };
  // Would this point of the car be inside something? (x0, z0: where the same point is now.) A point that's already
  // overlapping something may always move further out of it, so two cars that end up overlapping can always part.
  const SIZES = new Map(), sizeOf = kind => { let v = SIZES.get(kind); if (!v) SIZES.set(kind, v = W.carSize(kind)); return v; };
  const carDep = (kind, cx, cz, ry, px, pz, m) => { const [L, Wd] = sizeOf(kind), c = Math.cos(ry), s2 = Math.sin(ry), dx = px - cx, dz = pz - cz, along = -dx * s2 - dz * c, side = dx * c - dz * s2; return Math.min(L / 2 + m - Math.abs(along), Wd / 2 + m - Math.abs(side)); }; /* > 0: inside the car's body (m: extra room) */
  const BRUSH = -0.1, SHOULDER = 0.28; /* driving: up to 10 cm of overlap is a brush; on foot: room for your shoulders */
  const depth = (x, z, s) => s.car ? carDep(s.car.kind, s.car.x, s.car.z, s.car.ry, x, z, foot ? SHOULDER : BRUSH) : s.r ? Math.min(x - s.r[0], s.r[2] - x, z - s.r[1], s.r[3] - z) : s.c[2] - Math.hypot(x - s.c[0], z - s.c[1]); /* > 0: inside, by this much */
  const hits = (x, z, S, x0, z0) => { const tx = tileOf(x), tz = tileOf(z); if (!opts.loaded(tx, tz)) return true; if (BOAT && !foot) return !(opts.water(tx, tz) && !opts.road(tx, tz)); /* a boat: on the water only */ if (opts.water(tx, tz) && !opts.road(tx, tz) && !(opts.water(tileOf(x0), tileOf(z0)) && !opts.road(tileOf(x0), tileOf(z0)))) return true;
    for (const s of S) { const d = depth(x, z, s); if (d > 0 && d >= depth(x0, z0, s) - 1e-3) return true; }
    if (!foot) { const box = (kind, cx, cz, ry) => { const d = carDep(kind, cx, cz, ry, x, z, BRUSH); return d > 0 && d >= carDep(kind, cx, cz, ry, x0, z0, BRUSH) - 1e-3; };
      for (const t of traffic) if (Math.abs(t.px - x) < 5 && Math.abs(t.pz - z) < 5 && box(t.kind, t.px, t.pz, t.ry)) return true;
      for (const f of folk.values()) if (f.kind === 'car' && Math.abs(f.x - x) < 5 && Math.abs(f.z - z) < 5 && box(f.m, f.x, f.z, f.ry)) return true; return false; } /* other cars: their real size, so you can squeeze past */
    // on foot, a car is solid all along its body (its own length and width, and a little for your shoulders): yours where
    // you parked it, other players' cars and the traffic
    const carHit = (kind, cx, cz, ry) => { const d = carDep(kind, cx, cz, ry, x, z, SHOULDER); return d > 0 && d >= carDep(kind, cx, cz, ry, x0, z0, SHOULDER) - 1e-3; };
    if (parked && carHit(parked.kind, parked.x, parked.z, parked.ry)) return true;
    for (const t of traffic) if (Math.abs(t.px - x) < 4 && Math.abs(t.pz - z) < 4 && carHit(t.kind, t.px, t.pz, t.ry)) return true;
    for (const f of folk.values()) if (f.kind === 'car' && Math.abs(f.x - x) < 4 && Math.abs(f.z - z) < 4 && carHit(f.m, f.x, f.z, f.ry)) return true;
    return false; };
  const OUTLINE_F = [[2.1, 0.85], [2.1, -0.85], [0, 0.85], [0, -0.85], [-2.1, 0.85], [-2.1, -0.85], [0, 0]], OUTLINE_B = OUTLINE_F.map(([u, w]) => [-u || 0, w]); /* the car's outline, going forwards and backwards (made once) */
  const keys = new Set(), inp = { thr: 0, steer: 0 }; let ctl = opts.controls || { layout: 'pedalstick' }; /* inp: from the on-screen controls (steer +1 = left) */
  // ---- the engine, the gearbox and the brakes, as a real car's: ----
  //  - the engine makes its power over a rev band; each gear trades pull for speed, so it pulls hardest in first, shifts up
  //    (a quarter-second with no drive) near the redline and pulls a little less in each gear after; at low speed the
  //    tyres, not the engine, limit how hard it can launch (traction);
  //  - air drag grows with the square of speed (so it tails off towards top speed by itself) and the tyres roll with a
  //    little resistance;
  //  - lift off and you're still in gear: engine braking plus drag slow you firmly (from 50 km/h to a stop in about
  //    3 seconds), and below walking pace the car settles to a stop rather than creeping on;
  //  - the brake pedal squeezes in over a tenth of a second up to the tyres' limit (about 0.9–1.1 g, with ABS), and held
  //    at a stop it reverses (slowly, in reverse gear).
  const box = { g: 1, shift: 0, rpm: 0.2, pedal: 0, brake: 0 };
  function engine(vf, thr, top, rough, dt) { const P = PERF, n = P.gears, gTop = top * 1.04, drag = P.pw * 0.94 / (top ** 3), roll = rough ? 1.6 : 0.15;
    box.pedal += ((thr > 0.05 ? thr : 0) - box.pedal) * Math.min(1, dt * 22); box.brake += ((thr < -0.05 ? -thr : 0) - box.brake) * Math.min(1, dt * 28); /* (the pedals answer at once) */
    const gas = box.pedal > 0.05, brk = box.brake > 0.05, v = Math.abs(vf), gMax = k => gTop * Math.pow(k / n, 0.85); /* (the speed at the redline in gear k: the gears close up as they go higher) */
    if (vf < -0.3) { box.g = 1; box.shift = 0; if (gas) return Math.min(0, vf + P.brk * box.pedal * dt); /* rolling back and you press on: the brakes catch it first */
      if (brk) return Math.max(-8, vf - 6 * box.brake * dt); return Math.min(0, vf + (5 + roll) * dt); } /* reversing, up to about 30 km/h */
    if (brk && !gas && vf <= 0.3) { box.g = 1; return Math.max(-8, vf - 6 * box.brake * dt); } /* stopped and holding the brake: straight into reverse */
    if (box.shift > 0) box.shift -= dt; else if (gas && box.g < n && v > gMax(box.g) * 0.97) { box.g++; box.shift = 0.25; } else if (box.g > 1 && v < gMax(box.g - 1) * (box.pedal > 0.6 ? 0.8 : 0.55)) box.g--;
    box.rpm = Math.max(0.16, Math.min(1, v / gMax(box.g)));
    const curve = box.rpm * (1.75 - 0.75 * box.rpm), push = gas && box.shift <= 0 ? Math.min(P.trac * (rough ? 0.6 : 1), P.pw * box.pedal * Math.max(0.55, curve) / Math.max(4, v)) : 0; /* power over the revs; at low speed the tyres limit it */
    const hold = drag * v * v + roll + (!gas && !brk ? 5.2 + 0.12 * v + (v < 5 ? 4 : 0) : 0) + (brk ? P.brk * 1.5 * box.brake * (rough ? 0.7 : 1) : 0); /* (lifting off slows you firmly; the brakes bite hard) */ /* drag, rolling, engine braking in gear (off the pedals), the brakes */
    return Math.max(0, vf + (push - hold) * dt); }
  function drive(dt) { if (riding) return;
    const K = ctl.keys || {}, on = (a, d) => keys.has(d) || keys.has(String(K[a] || '').toLowerCase());
    const up = (on('up', 'ArrowUp') ? 1 : 0) - (on('down', 'ArrowDown') ? 1 : 0) + inp.thr, turn = (on('left', 'ArrowLeft') ? 1 : 0) - (on('right', 'ArrowRight') ? 1 : 0) + inp.steer;
    if (foot) { // walking: the stick (or WASD/arrows) moves you forward, back and to either side of where the camera faces; you turn to face the way you walk. Push the stick right out (or hold Shift) to run
      let iy = Math.max(-1, Math.min(1, up)), ix = -Math.max(-1, Math.min(1, turn)); const mag = Math.min(1, Math.hypot(ix, iy)), run = keys.has('Shift') || mag > 0.88;
      if (mag < 0.12) { car.v = 0; car.steer = 0; return; }
      const ma = lk.yaw - Math.atan2(ix, iy), sp = (run ? 4.4 : 1.8) * Math.min(1, mag / 0.7); car.mv = ma;
      let d = ma - car.a; d = Math.atan2(Math.sin(d), Math.cos(d)); car.steer = Math.sign(d); car.a += d * Math.min(1, dt * 12); /* turn to face the way you're walking */
      car.v += (sp - car.v) * Math.min(1, dt * 8); const fx = Math.cos(ma), fz = -Math.sin(ma), nx = car.x + fx * car.v * dt, nz = car.z + fz * car.v * dt, S = closeSolids(solidsNear(nx, nz), nx, nz, 3);
      const free = (x, z) => !(hits(x + fx * 0.35, z + fz * 0.35, S, car.x + fx * 0.35, car.z + fz * 0.35) || hits(x, z, S, car.x, car.z)); /* (a step ahead of you, then where you stand) */
      if (free(nx, nz)) { car.x = nx; car.z = nz; return; }
      /* bumped into something (a bin, a tree, a parked car): slide along it rather than stop dead */
      for (const da of [0.6, -0.6, 1.1, -1.1]) { const b = ma + da, sx = car.x + Math.cos(b) * car.v * dt * 0.8, sz = car.z - Math.sin(b) * car.v * dt * 0.8; if (free(sx, sz)) { car.x = sx; car.z = sz; return; } }
      car.v = 0; return; }
    // A car that drives like one (a simple bicycle model with tyre grip):
    //  - the wheels turn smoothly, and less far the faster you go; how fast you turn follows the wheelbase;
    //  - the tyres hold the road up to their grip: corner too fast and the car understeers or slides, and Space (the
    //    handbrake) lets the back step out for a drift;
    //  - the engine pulls hard from a stop and tails off near top speed; brakes bite hard; let go and it slows down by itself;
    //  - no speed limit on any road (only grass and rough ground slow you); dearer cars pull harder, grip more, go faster.
    const thr = Math.max(-1, Math.min(1, up)), st = Math.max(-1, Math.min(1, turn)), rt = opts.road(tileOf(car.x), tileOf(car.z)), R = rt && ROAD_TYPES[rt];
    const rough = !BOAT && (!rt || (R && R.kind === 'rail')), top = rough ? PERF.top * 0.5 : PERF.top, hb = keys.has(' ') && Math.abs(car.v) > 4;
    let fx = Math.cos(car.a), fz = -Math.sin(car.a), lx = fz, lz = -fx; /* forward, and across to the side */
    let vf = (car.vx || 0) * fx + (car.vz || 0) * fz, vl = (car.vx || 0) * lx + (car.vz || 0) * lz;
    if (CARPHYS) vf = engine(vf, thr, top, rough, dt); else {
    if (thr > 0.05) vf += vf < -0.5 ? 16 * thr * dt : PERF.acc * thr * Math.max(0.12, 1 - (vf / top) ** 2) * dt; /* (pressing on while rolling back brakes first) */
    else if (thr < -0.05) vf += vf > 0.5 ? 16 * thr * dt : Math.max(-9 - vf, 4.5 * thr * dt);
    else { const d = (BOAT ? 1.4 + 0.05 * Math.abs(vf) : 3.0 + 0.1 * Math.abs(vf) + (rough ? 2.5 : 0)) * dt; vf = Math.abs(vf) <= d ? 0 : vf - Math.sign(vf) * d; } /* let go and it slows down by itself, like a real car: engine braking and the tyres' drag (from 70 km/h it stops in about 45 m); a boat drifts on further */ }
    if (hb) { const d = 7 * dt; vf = Math.abs(vf) <= d ? 0 : vf - Math.sign(vf) * d; }
    if (vf > top) vf = Math.max(top, vf - 7 * dt);
    const maxA = CARPHYS ? 0.72 / (1 + (Math.abs(vf) / 20) ** 2) : 0.6 / (1 + Math.abs(vf) / 11), want = st * maxA, rate = (st === 0 ? 7 : CARPHYS ? 6 : 2.6) * dt; /* (a car: full lock is about 35° at walking pace, a 5 m turn, and less only gently as you speed up) */ car.wa = (car.wa || 0) + Math.max(-rate, Math.min(rate, want - (car.wa || 0))); car.steer = car.wa / 0.6;
    let yr = vf / 2.7 * Math.tan(car.wa); const wt = CARPHYS ? (thr < -0.05 ? 1.18 : thr > 0.05 ? 0.94 : 1.08) : 1.08; /* (weight on the front wheels: braking into a corner turns you in tighter, flooring it pushes wide) */ const yl = (hb ? PERF.grip * 2.2 : PERF.grip * wt * (CARPHYS ? 1.5 : 1)) / Math.max(1.5, Math.abs(vf)); /* (a car corners on rails: tighter than real tyres would let it) */ yr = Math.max(-yl, Math.min(yl, yr)); /* the tyres can only turn you so hard */
    car.a += yr * dt; const wx2 = vf * fx + vl * lx, wz2 = vf * fz + vl * lz; fx = Math.cos(car.a); fz = -Math.sin(car.a); lx = fz; lz = -fx; /* the car turns; where it was going lags behind a little */
    vf = wx2 * fx + wz2 * fz; vl = wx2 * lx + wz2 * lz; const g = (hb ? PERF.grip * 0.3 : PERF.grip * (rough ? 0.7 : 1) * (CARPHYS ? 1.6 : 1)) * dt; vl = Math.abs(vl) <= g ? 0 : vl - Math.sign(vl) * g; /* grip pulls it back in line */
    if (Math.abs(vf) < 0.05 && Math.abs(thr) < 0.05) vf = 0; car.slip = Math.abs(vl);
    car.vx = vf * fx + vl * lx; car.vz = vf * fz + vl * lz; car.v = vf;
    const nx = car.x + car.vx * dt, nz = car.z + car.vz * dt, S = closeSolids(solidsNear(nx, nz), nx, nz, 3), dir = Math.sign(car.v || 1);
    const pts = dir < 0 ? OUTLINE_B : OUTLINE_F; /* its corners and the middles of its sides (so it can slide past another car along its side, but not into it) */
    if (pts.some(([u, w]) => hits(nx + fx * u + fz * w, nz + fz * u - fx * w, S, car.x + fx * u + fz * w, car.z + fz * u - fx * w))) { car.vx = -car.vx * 0.25; car.vz = -car.vz * 0.25; car.v = -car.v * 0.25; bump = 0.25; return; }
    car.x = nx; car.z = nz; }
  let bump = 0, roll = 0, pitch = 0, accel0 = 0, accS = 0;

  // ---- every car but yours, drawn together: one draw per model for all of them (parked, traffic, other people) ----
  const fleetM = new Map(), fleetQ = new Map(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), V1 = new THREE.Vector3(1, 1, 1), P3 = new THREE.Vector3(), C3 = new THREE.Color();
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const beamGeo = (() => { const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); g.translate(0, 0, -0.5); return g; })(), beamTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 128, 4, 32, 90, 90); gr.addColorStop(0, 'rgba(255,236,190,.9)'); gr.addColorStop(1, 'rgba(255,236,190,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const beamMat2 = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
  let blobs = null, beams = null; const MAXC = 160, FV = new THREE.Vector3(), BEAMV = new THREE.Vector3(3.4, 1, 9);
  const PAINTED = new Map(), paint = c => { if (typeof c !== 'string') return C3.set(c); let k = PAINTED.get(c); if (!k) PAINTED.set(c, k = new THREE.Color(c)); return C3.copy(k); }; /* a colour's text is worked out once (it was parsed for every car and person every frame); C3 holds it, as before */
  const pushCar = (kind, colr, x, z, ry) => { let q = fleetQ.get(kind); if (!q) fleetQ.set(kind, q = []); q.push(kind, colr, x, z, ry); };
  function drawFleet(night) {
    let total = 0; for (const q of fleetQ.values()) total += q.length / 5;
    if (!blobs) { blobs = new THREE.InstancedMesh(blobGeo, blobMat, MAXC); blobs.frustumCulled = false; scene.add(blobs); beams = new THREE.InstancedMesh(beamGeo, beamMat2, MAXC); beams.frustumCulled = false; scene.add(beams); }
    let b = 0; beamMat2.opacity = night * 0.55;
    for (const [kind, m] of fleetM) { const q = fleetQ.get(kind); if (!q || !q.length) m.count = 0; }
    for (const [kind, q] of fleetQ) { if (!q.length) continue; const n = q.length / 5; let m = fleetM.get(kind);
      if (!m || m.userData.cap < n) { const lite = W.carLite(kind), cap = Math.max(8, 1 << Math.ceil(Math.log2(n + 1)));
        if (m) { scene.remove(m); m.dispose(); } const mat = m ? m.material : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: Math.min(0.6, lite.paint[0] + 0.08), metalness: lite.paint[1] * 0.8, envMapIntensity: lite.paint[2] });
        m = new THREE.InstancedMesh(lite.geo, mat, cap); m.userData = { cap, L: lite.L, W: lite.W, noBlob: !!lite.noBlob }; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; scene.add(m); fleetM.set(kind, m); }
      for (let i = 0; i < n; i++) { const o = i * 5, c = q[o + 1], x = q[o + 2], z = q[o + 3], ry = q[o + 4]; Q.setFromAxisAngle(Y, ry); M4.compose(P3.set(x, 0, z), Q, V1); m.setMatrixAt(i, M4); m.setColorAt(i, paint(c));
        if (b < MAXC && !m.userData.noBlob) { M4.compose(P3.set(x, 0.02, z), Q, FV.set(m.userData.W * 1.2, 1, m.userData.L * 1.05)); blobs.setMatrixAt(b, M4);
          if (night > 0.05) { const L2 = m.userData.L / 2; M4.compose(P3.set(x - Math.sin(ry) * L2, 0.04, z - Math.cos(ry) * L2), Q, BEAMV); beams.setMatrixAt(b, M4); } b++; } }
      m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    blobs.count = b; blobs.instanceMatrix.needsUpdate = true; beams.count = night > 0.05 ? b : 0; beams.instanceMatrix.needsUpdate = true; for (const q of fleetQ.values()) q.length = 0; } /* (the lists are kept and emptied, not thrown away) */

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
      let byMe = false; for (let k = -1; k < traffic.length; k++) { const o = k < 0 ? null : traffic[k]; /* (you first, then the other cars) */ if (o === t) continue; const ox = (o ? o.px : car.x) - t.px, oz = (o ? o.pz : car.z) - t.pz, ahead = ox * hx + oz * hz, side = Math.abs(ox * hz - oz * hx); if (ahead > -1.5 && ahead < gap && side < (o ? 2.2 : 3.2)) { gap = Math.max(0, ahead); byMe = !o; } }
      const want = gap < 6.5 ? 0 : gap < 14 ? top * (gap - 6.5) / 7.5 : top; t.v += Math.max(-12 * dt, Math.min(3 * dt, want - t.v)); if (gap < 4.5) t.v = Math.min(t.v, 0);
      t.wait = t.v < 0.3 && byMe ? (t.wait || 0) + dt : 0; /* stuck behind you a while: turn round and go another way */
      if (t.wait > 4) { t.wait = 0; [t.fx, t.fy, t.tx, t.ty] = [t.tx, t.ty, t.fx, t.fy]; t.u = Math.max(0, 1 - t.u); t.v = 0; }
      t.u += t.v * dt / TILE;
      while (t.u >= 1) { t.u -= 1; const nx = [];
        for (const [ex, ey] of DIRS) { if (ex === -dx && ey === -dy) continue; if (drivable(t.tx + ex, t.ty + ey)) nx.push([ex, ey]); }
        const straight = nx.find(([ex, ey]) => ex === dx && ey === dy), pick = straight && Math.random() < 0.65 ? straight : nx.length ? nx[Math.floor(Math.random() * nx.length)] : [-dx, -dy];
        t.fx = t.tx; t.fy = t.ty; t.tx += pick[0]; t.ty += pick[1]; if (!drivable(t.tx, t.ty)) { t.tx = t.fx - dx; t.ty = t.fy - dy; } }
      place(t, 0); pushCar(t.kind, t.col, t.px, t.pz, t.ry); } }

  // ---- people on the pavements: whole people (head and face, hair, neck, body, arms and hands, legs and shoes), walking
  // along the kerbs and swinging their arms and legs. Each body part is one instanced mesh for all of them (six draws for
  // the whole crowd); a part that has a second colour baked in (eyes, shoes) keeps it through a vertex colour. ----
  const peds = [], WANT_PEDS = PHONE ? (HQ ? 26 : 14) : 44;
  const pedParts = (() => {
    // join a few shapes into one, each with its own colour (white takes the person's colour; dark stays dark)
    const join = parts => { let nv = 0; const pos = [], nor = [], col = [], idx = [];
      for (const [g, c] of parts) { const P = g.attributes.position, N = g.attributes.normal, cc = new THREE.Color(c); for (let k = 0; k < P.count; k++) { pos.push(P.getX(k), P.getY(k), P.getZ(k)); nor.push(N.getX(k), N.getY(k), N.getZ(k)); col.push(cc.r, cc.g, cc.b); }
        const I = g.index; if (I) for (let k = 0; k < I.count; k++) idx.push(I.getX(k) + nv); else for (let k = 0; k < P.count; k++) idx.push(k + nv); nv += P.count; g.dispose(); }
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); out.setIndex(idx); return out; };
    const at = (g, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => { g.scale(sx, sy, sz); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
    const W0 = '#ffffff', DARK = '#26221f';
    // the body: chest and shoulders, waist, and a belt (in the shirt colour, the belt darker)
    const torso = join([[at(new THREE.CylinderGeometry(0.2, 0.165, 0.5, 12), 0, 1.15, 0, 1, 1, 0.62), W0], [at(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.4, 0, 1, 0.42, 0.62), W0],
      [at(new THREE.CylinderGeometry(0.168, 0.17, 0.05, 12), 0, 0.915, 0, 1, 1, 0.64), '#55504a']]);
    // the head: a neck, the face (eyes, brows, nose, mouth) and ears, all in the skin colour except the eyes, brows and mouth
    const head = join([[at(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 8), 0, 1.47, 0), W0], [at(new THREE.SphereGeometry(0.118, 16, 12), 0, 1.62, 0, 0.9, 1.08, 0.98), W0],
      [at(new THREE.SphereGeometry(0.018, 6, 4), 0.041, 1.64, 0.1), DARK], [at(new THREE.SphereGeometry(0.018, 6, 4), -0.041, 1.64, 0.1), DARK],
      [at(new THREE.BoxGeometry(0.045, 0.01, 0.01), 0.042, 1.675, 0.103), DARK], [at(new THREE.BoxGeometry(0.045, 0.01, 0.01), -0.042, 1.675, 0.103), DARK],
      [at(new THREE.BoxGeometry(0.026, 0.045, 0.03), 0, 1.6, 0.115), W0], [at(new THREE.BoxGeometry(0.05, 0.01, 0.01), 0, 1.56, 0.106), '#7a3b34'],
      [at(new THREE.SphereGeometry(0.026, 6, 4), 0.108, 1.62, 0, 0.6, 1, 1), W0], [at(new THREE.SphereGeometry(0.026, 6, 4), -0.108, 1.62, 0, 0.6, 1, 1), W0]]);
    // hair: a cap over the top and back of the head
    const hair = join([[at(new THREE.SphereGeometry(0.126, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 1.635, -0.012, 0.93, 1.05, 1.02), W0], [at(new THREE.BoxGeometry(0.2, 0.12, 0.05), 0, 1.6, -0.095), W0]]);
    // an arm hangs from the shoulder: the sleeve (shirt colour), then the forearm and hand (skin)
    const sleeve = join([[at(new THREE.CapsuleGeometry(0.058, 0.2, 3, 8), 0, -0.13, 0), W0]]);
    const arm = join([[at(new THREE.CapsuleGeometry(0.044, 0.26, 3, 8), 0, -0.38, 0), W0], [at(new THREE.SphereGeometry(0.05, 8, 6), 0, -0.57, 0.005, 0.8, 1.1, 0.6), W0]]);
    // a leg hangs from the hip: trousers, and a shoe pointing forward
    const leg = join([[at(new THREE.CapsuleGeometry(0.076, 0.68, 3, 8), 0, -0.42, 0), W0], [at(new THREE.BoxGeometry(0.11, 0.08, 0.25), 0, -0.84, 0.045), '#2a2725']]);
    const mk = (g, n) => { const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, vertexColors: true }), n); m.frustumCulled = false; m.count = 0; m.castShadow = false; scene.add(m); return m; };
    return { torso: mk(torso, WANT_PEDS), head: mk(head, WANT_PEDS), hair: mk(hair, WANT_PEDS), sleeve: mk(sleeve, WANT_PEDS * 2), arm: mk(arm, WANT_PEDS * 2), leg: mk(leg, WANT_PEDS * 2) }; })();
  const SHIRTS = ['#2f5d9e', '#3c8a5a', '#e2b13c', '#8e44ad', '#d35d6e', '#2ec4b6', '#f2994a', '#7f8c8d', '#c0392b', '#f4f1ea', '#1e2a3a'], SKINS = ['#8d5524', '#c68642', '#e0ac69', '#5c3a21', '#a0663d', '#f1c27d'], LEGS = ['#2b2f33', '#3b4a63', '#5c4a3b', '#4a4a4a', '#26313b', '#6b7b8c', '#c8b89a'],
    HAIRS = ['#1e1a16', '#2b1d14', '#4a2e1c', '#6b4a2b', '#b08a4e', '#8a8a8a', '#3a2418', '#121212'];
  const kerbOf = (tx, ty, side) => { const [dx, dy] = side; return drivable(tx, ty) && !opts.road(tx + dx, ty + dy) && !opts.water(tx + dx, ty + dy); };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function spawnPed() { const ct = tileOf(car.x), cz = tileOf(car.z), R = Math.floor((RAD + 0.3) * B);
    for (let k = 0; k < 30; k++) { const tx = ct + Math.round((Math.random() * 2 - 1) * R), ty = cz + Math.round((Math.random() * 2 - 1) * R), side = DIRS[Math.floor(Math.random() * 4)]; if (!kerbOf(tx, ty, side)) continue;
      const along = side[1] !== 0 ? [1, 0] : [0, 1], sgn = Math.random() < 0.5 ? 1 : -1, i = peds.length;
      peds.push({ tx, ty, side, dir: [along[0] * sgn, along[1] * sgn], u: Math.random(), sp: 1.1 + Math.random() * 0.5, ph: Math.random() * 6, shirt: pick(SHIRTS), skin: pick(SKINS), legs: pick(LEGS), hair: pick(HAIRS), h: 0.92 + Math.random() * 0.14, w: 0.92 + Math.random() * 0.16, i });
      return; } }
  const E = new THREE.Euler(), SC = new THREE.Vector3(), BODY = new THREE.Matrix4(), LM = new THREE.Matrix4(), LQ = new THREE.Quaternion(), LP = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  function walk(dt) {
    const R = (RAD + 0.5) * B * TILE; for (let i = peds.length - 1; i >= 0; i--) { const p = peds[i]; if (Math.hypot((p.tx + 0.5) * TILE - car.x, (p.ty + 0.5) * TILE - car.z) > R) peds.splice(i, 1); }
    while (peds.length < WANT_PEDS && Math.random() < 0.4) { const n = peds.length; spawnPed(); if (peds.length === n) break; }
    const P2 = pedParts; let n = 0, n2 = 0;
    for (const p of peds) { p.u += p.sp * dt / TILE; p.ph += dt * p.sp * 4.2;
      if (p.u >= 1) { p.u -= 1; const nx = p.tx + p.dir[0], ny = p.ty + p.dir[1]; if (kerbOf(nx, ny, p.side)) { p.tx = nx; p.ty = ny; } else { p.dir = [-p.dir[0], -p.dir[1]]; p.u = 1 - p.u; } } /* the pavement ends: turn round */
      const [sx, sy] = p.side, off = TILE / 2 + 0.8, fx = p.dir[0] ? (p.dir[0] > 0 ? p.u : 1 - p.u) : 0.5, fy = p.dir[1] ? (p.dir[1] > 0 ? p.u : 1 - p.u) : 0.5;
      const x = (p.tx + (p.dir[0] ? fx : 0.5)) * TILE + sx * off, z = (p.ty + (p.dir[1] ? fy : 0.5)) * TILE + sy * off, ry = Math.atan2(p.dir[0], p.dir[1]), bob = Math.abs(Math.sin(p.ph)) * 0.035, sw = Math.sin(p.ph) * 0.42;
      Q.setFromAxisAngle(Y, ry); BODY.compose(P3.set(x, bob, z), Q, SC.set(p.w, p.h, p.w)); /* the whole person: where they are, which way they face, how tall and broad */
      P2.torso.setMatrixAt(n, BODY); P2.head.setMatrixAt(n, BODY); P2.hair.setMatrixAt(n, BODY);
      P2.torso.setColorAt(n, paint(p.shirt)); P2.head.setColorAt(n, paint(p.skin)); P2.hair.setColorAt(n, paint(p.hair));
      for (let s2 = 1; s2 >= -1; s2 -= 2) { // each side: the leg swings one way and the arm on that side the other
        E.set(sw * s2, 0, 0); LQ.setFromEuler(E); LM.compose(LP.set(0.095 * s2, 0.88, 0), LQ, ONE); M4.multiplyMatrices(BODY, LM); P2.leg.setMatrixAt(n2, M4); P2.leg.setColorAt(n2, paint(p.legs));
        E.set(-sw * s2 * 0.75, 0, s2 * 0.07); LQ.setFromEuler(E); LM.compose(LP.set(0.235 * s2, 1.39, 0), LQ, ONE); M4.multiplyMatrices(BODY, LM);
        P2.sleeve.setMatrixAt(n2, M4); P2.sleeve.setColorAt(n2, paint(p.shirt)); P2.arm.setMatrixAt(n2, M4); P2.arm.setColorAt(n2, paint(p.skin)); n2++; }
      n++; }
    for (const k in P2) { const m = P2[k]; m.count = k === 'leg' || k === 'sleeve' || k === 'arm' ? n2 : n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }

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
        if (f && f.kind !== kind) { if (f.g) scene.remove(f.g); if (f.pet) f.pet.dispose(); folk.delete(p.id); f = null; }
        if (f && kind === 'walk' && p.look && !f.look) { scene.remove(f.g); if (f.pet) f.pet.dispose(); folk.delete(p.id); f = null; } /* their own look arrived: show them as themselves */
        if (!f) { if (kind === 'walk') { const P = W.makePerson(p.id, null, p.look || null); f = { kind, P, g: P.group, look: !!p.look }; if (p.pet && [...folk.values()].filter(q => q.pet).length < 8) { try { f.pet = follower(p.pet, { side: -1 }); scene.add(f.pet.group); } catch (e) {} } /* their pet walks with them (the nearest eight) */ if (p.tag) P.group.add(tag(p.tag, p.online, 2.15)); f.g.position.set(p.x * TILE, 0, p.y * TILE); scene.add(f.g); } else f = { kind, m: p.m || 'sedan', col: p.col || '#7c8288', x: p.x * TILE, z: p.y * TILE, ry: p.a != null ? p.a - Math.PI / 2 : 0 }; folk.set(p.id, f); }
        f.tx = p.x * TILE; f.tz = p.y * TILE; if (f.kind === 'car') { f.m = p.m || f.m; f.col = p.col || f.col; f.drv = !!p.drv; f.h = p.h || null; f.full = !!p.full; f.ta = p.drv && p.a != null ? p.a - Math.PI / 2 : null; /* a player's car: the way they say it faces */ if (p.tag && f.tagT !== p.tag) { if (f.tagO) { scene.remove(f.tagO); f.tagO.material.map.dispose(); f.tagO.material.dispose(); } f.tagO = tag(p.tag, p.online, 0); f.tagT = p.tag; scene.add(f.tagO); } } }
      for (const [id, f] of folk) if (!seen.has(id)) { if (f.g) scene.remove(f.g); if (f.pet) f.pet.dispose(); if (f.tagO) { scene.remove(f.tagO); f.tagO.material.map.dispose(); f.tagO.material.dispose(); } folk.delete(id); } }
    for (const [id, f] of folk) { const k = Math.min(1, dt * 2.5); if (f.kind === 'car' && f.tagO) { f.tagO.position.set(f.x, 2.4, f.z); }
      if (f.kind === 'car') { const dx = f.tx - f.x, dz = f.tz - f.z; if (Math.hypot(dx, dz) > 40) { f.x = f.tx; f.z = f.tz; } else { f.x += dx * k; f.z += dz * k; if (f.ta != null || Math.hypot(dx, dz) > 0.05) { let d = (f.ta != null ? f.ta : Math.atan2(-dx, -dz)) - f.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); f.ry += d * Math.min(1, dt * 5); } } if (f.tagO) f.tagO.visible = !(riding && riding.id === id && mode === 1); if (!(riding && riding.id === id && mode === 1)) pushCar(f.m, f.col, f.x, f.z, f.ry); continue; }
      const g = f.g, dx = f.tx - g.position.x, dz = f.tz - g.position.z; if (Math.hypot(dx, dz) > 40) { g.position.x = f.tx; g.position.z = f.tz; continue; }
      const vx = dx * k / Math.max(dt, 1e-3), vz = dz * k / Math.max(dt, 1e-3); g.position.x += dx * k; g.position.z += dz * k; f.P.animate(dt, vx, vz); if (f.pet) f.pet.step(dt, g.position.x, g.position.z); } }

  // ---- talking on the street: what someone says shows over their head (yours over yours) for 7 seconds ----
  const bubbles = new Map(); /* who → { sp, until } */
  function bubbleSprite(text) { const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 512; c.height = 160; g.font = '600 34px sans-serif';
    const words = String(text).split(' '), lines = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > 460 && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line);
    const shown = lines.slice(0, 3); if (lines.length > 3) shown[2] = shown[2].replace(/.{0,2}$/, '…'); const w = Math.min(500, Math.max(...shown.map(l => g.measureText(l).width)) + 36), h = shown.length * 40 + 24;
    g.fillStyle = 'rgba(255,255,255,.96)'; if (g.roundRect) { g.beginPath(); g.roundRect((512 - w) / 2, 4, w, h, 20); g.fill(); } else g.fillRect((512 - w) / 2, 4, w, h); g.fillStyle = '#1C1C1E'; g.textAlign = 'center'; g.textBaseline = 'top'; shown.forEach((l, i) => g.fillText(l, 256, 16 + i * 40));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(3.2, 1.0, 1); sp.renderOrder = 6; return sp; }
  const dropBubble = who => { const b = bubbles.get(who); if (!b) return; scene.remove(b.sp); b.sp.material.map.dispose(); b.sp.material.dispose(); bubbles.delete(who); };
  function sayOver(who, text) { dropBubble(who); const sp = bubbleSprite(text); scene.add(sp); bubbles.set(who, { sp, until: performance.now() + 7000 }); }
  function placeBubbles(now) { for (const [who, b] of bubbles) { if (now > b.until) { dropBubble(who); continue; }
      if (who === 'me') { const onFoot = foot && feet; b.sp.position.set(onFoot ? feet.group.position.x : car.x, onFoot ? 2.75 : 3.0, onFoot ? feet.group.position.z : car.z); continue; }
      const f = folk.get(who); if (!f) { dropBubble(who); continue; } if (f.kind === 'walk') b.sp.position.set(f.g.position.x, 2.75, f.g.position.z); else b.sp.position.set(f.x, 3.2, f.z); } }

  // ---- the colony's service vehicles, where the 2D map has them: police patrols, fire engines and ambulances (lights
  // flashing on a call), buses, taxis, vans and lorries. One light bar mesh and one ladder mesh for all of them. ----
  const svc = new Map(); let svcAt = 0; const SV = { police: 'police', firetruck: 'firetruck', fire: 'firetruck', ambulance: 'ambulance', bus: 'bus', van: 'van', truck: 'truck', taxi: 'car', car: 'sedan', bike: 'bicycle', motorbike: 'motorbike', boat: 'boat', sailboat: 'sailboat', ferry: 'ferry', cargoship: 'cargoship', helicopter: 'helicopter', plane: 'plane', balloon: 'balloon' }, ROOF = { police: 1.52, firetruck: 3.05, ambulance: 2.66 };
  const svBars = (() => { const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.13, 0.26), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 64); m.frustumCulled = false; m.count = 0; scene.add(m); return m; })();
  const svLadder = (() => { const g = new THREE.BoxGeometry(0.7, 0.12, 5.6); const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.35, metalness: 0.8 }), 16); m.frustumCulled = false; m.count = 0; scene.add(m); return m; })();
  function services(now, dt) {
    if (opts.services && now - svcAt > 400) { svcAt = now; const L = opts.services(car.x / TILE, car.z / TILE), seen = new Set();
      for (const v of L) { const kind = SV[v.type]; if (!kind) continue; seen.add(v.id); let f = svc.get(v.id); const tx = v.x * TILE, tz = v.y * TILE, ta = v.a != null ? v.a - Math.PI / 2 : null;
        if (!f) { f = { kind, col: v.col, x: tx, z: tz, ry: ta || 0 }; svc.set(v.id, f); } f.tx = tx; f.tz = tz; f.ta = ta; f.siren = !!v.siren; f.kind = kind; f.col = v.col || f.col; }
      for (const id of [...svc.keys()]) if (!seen.has(id)) svc.delete(id); }
    let nb = 0, nl = 0; const k = Math.min(1, dt * 2.2), flash = Math.floor(now / 260) % 2;
    for (const f of svc.values()) { const dx = f.tx - f.x, dz = f.tz - f.z; if (Math.hypot(dx, dz) > 40) { f.x = f.tx; f.z = f.tz; } else { f.x += dx * k; f.z += dz * k; }
      const want = Math.hypot(dx, dz) > 0.05 ? Math.atan2(-dx, -dz) : f.ta; if (want != null) { let d = want - f.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); f.ry += d * Math.min(1, dt * 4); }
      pushCar(f.kind, f.col, f.x, f.z, f.ry); const roof = ROOF[f.kind]; if (!roof) continue; const c = Math.cos(f.ry), sn = Math.sin(f.ry);
      for (const side of [-1, 1]) { if (nb >= 64) break; const ox = side * 0.3, oz = f.kind === 'police' ? 0.05 : -(CARS3D[f.kind] || 0) ; /* the bar: red and blue (white on a fire engine), flashing on a call */
        Q.setFromAxisAngle(Y, f.ry); M4.compose(P3.set(f.x + c * ox + sn * oz, roof + 0.07, f.z - sn * ox + c * oz), Q, V1); svBars.setMatrixAt(nb, M4);
        const on = !f.siren || (side > 0 ? flash : 1 - flash); svBars.setColorAt(nb, C3.set(f.siren ? (on ? (side < 0 ? '#ff2a2a' : f.kind === 'firetruck' ? '#ffffff' : '#2a5bff') : '#3a2222') : (side < 0 ? '#7a1f1f' : '#1f2f7a'))); nb++; }
      if (f.kind === 'firetruck' && nl < 16) { Q.setFromAxisAngle(Y, f.ry); M4.compose(P3.set(f.x + sn * 0.6, 2.65, f.z + c * 0.6), Q, V1); svLadder.setMatrixAt(nl++, M4); } }
    svBars.count = nb; svLadder.count = nl; svBars.instanceMatrix.needsUpdate = true; if (svBars.instanceColor) svBars.instanceColor.needsUpdate = true; svLadder.instanceMatrix.needsUpdate = true; }
  const CARS3D = { firetruck: 2.6, ambulance: 1.2 }; /* how far forward of the middle the light bar sits (over the cab) */

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
  // the driver's seat: the inside of the car, fixed to the car (not to your eyes), so you can look round the cabin as you drive.
  // The dearer the car, the finer its cabin (each step keeps what the one below has, and adds to it):
  //  - everyday (under 50,000): plastic dash, two dials, a radio, vents, a gear stick, cloth seats;
  //  - better (to 200,000: pickups, SUVs, the electric cars): a touch screen, cup holders, an armrest, door speakers and handles,
  //    two-tone stitched seats; the electric ones a digital cluster instead of dials, and a light strip;
  //  - luxury (Monarch, Sports car, Meridian GT): leather in the car's own colour, a wood or brushed-metal band across the dash
  //    and doors, round chrome vents, a clock, warm mood lighting, quilted seats, a leather wheel with chrome spokes;
  //  - super (Vortex, Halo X, Nova Concept): carbon fibre, bucket seats with harnesses, a screen right across the dash,
  //    mood lighting in the car's accent colour, a red start button, gear paddles; the Halo X and Nova a yoke and a glass roof.
  // Two-seaters have no back seat. It's only drawn from the driver's (or a passenger's) seat, so the detail costs nothing outside.
  const cockpit = new THREE.Group(); let sw = new THREE.Group(), cabinOf = null;
  const cabinTex = {}; const texOf = (k, draw, w = 128, h = 128, rep = 1) => { if (cabinTex[k]) return cabinTex[k]; const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4; return (cabinTex[k] = t); };
  const carbonTex = () => texOf('carbon', (g, w, h) => { g.fillStyle = '#151618'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { const on = ((x + y) / 8) % 2 === 0; const gr = g.createLinearGradient(x, y, x + (on ? 8 : 0), y + (on ? 0 : 8)); gr.addColorStop(0, '#26282c'); gr.addColorStop(0.5, '#3a3d42'); gr.addColorStop(1, '#1d1f22'); g.fillStyle = gr; g.fillRect(x + 0.5, y + 0.5, 7, 7); } }, 64, 64, 6);
  const woodTex = () => texOf('wood', (g, w, h) => { g.fillStyle = '#6b3f22'; g.fillRect(0, 0, w, h); for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(${40 + Math.random() * 40},${20 + Math.random() * 20},10,${0.25 + Math.random() * 0.3})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 2); g.stroke(); } }, 256, 64, 1);
  const screenTex = (k, a, b, wide) => texOf('scr' + k + wide, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.beginPath(); g.arc(w * (wide ? 0.18 : 0.3), h * 0.55, h * 0.3, Math.PI * 0.8, Math.PI * 2.2); g.stroke(); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `700 ${Math.round(h * 0.22)}px system-ui, sans-serif`; g.textAlign = 'center'; g.fillText('0', w * (wide ? 0.18 : 0.3), h * 0.62);
    g.fillStyle = 'rgba(255,255,255,.25)'; for (let q = 0; q < (wide ? 5 : 2); q++) g.fillRect(w * (wide ? 0.36 + q * 0.12 : 0.58), h * (wide ? 0.25 : 0.25 + q * 0.3), w * (wide ? 0.09 : 0.3), h * (wide ? 0.5 : 0.18)); }, wide ? 512 : 256, 128);
  function buildCabin(model, col) { const key = (model || 'car') + '|' + (col || ''); if (cabinOf === key) return; cabinOf = key;
    for (const o of [...cockpit.children]) { cockpit.remove(o); o.traverse(m => { if (m.isMesh) { m.geometry.dispose(); const ms = Array.isArray(m.material) ? m.material : [m.material]; for (const q of ms) q.dispose(); } }); }
    const Mdl = CAR_MODELS[model] || {}, price = Mdl.price || 0, tier = price >= 800000 ? 3 : price >= 200000 ? 2 : price >= 50000 ? 1 : 0, two = (Mdl.seats || 4) <= 2, elec = !!Mdl.electric, yoke = model === 'hyper' || model === 'concept';
    const LEATHER = { luxury: '#d9c7a3', sports: '#262626', gt: '#6b1e22', supercar: '#1d1d1f', hyper: '#e9e6e0', concept: '#2a2633' }, accent = Mdl.glow || (tier === 3 ? '#e4572e' : '#ffb35c');
    const mat = (c, r = 0.8, m = 0, ex = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...ex }), glow = c => new THREE.MeshBasicMaterial({ color: c });
    const paint = cockpit.userData.paint = mat(col || '#c8382e', 0.3, 0.5);
    const dash = tier === 3 ? mat('#ffffff', 0.55, 0.2, { map: carbonTex() }) : tier === 2 ? mat(LEATHER[model] ? (model === 'luxury' ? '#3b2a20' : '#1b1b1d') : '#2a2a2c', 0.6) : mat(tier === 1 ? '#2a2c31' : '#33353a', 0.85);
    const dashTop = tier === 3 ? mat('#1a1a1c', 0.95) : tier === 2 ? mat(LEATHER[model] || '#3b2a20', 0.55) : mat('#26282d', 0.9); /* alcantara, leather, or plain */
    const trim = tier === 3 ? mat('#ffffff', 0.5, 0.25, { map: carbonTex() }) : tier === 2 ? (model === 'luxury' || model === 'gt' ? mat('#ffffff', 0.35, 0.05, { map: woodTex() }) : mat('#b9bcc2', 0.3, 0.9)) : mat(tier === 1 ? '#3a3c42' : '#2e3036', 0.8);
    const seatC = tier >= 2 ? LEATHER[model] || '#3a2a20' : tier === 1 ? '#3b3f46' : '#4a4642', seat = mat(seatC, tier >= 2 ? 0.5 : 0.95), seat2 = mat(tier >= 2 ? new THREE.Color(seatC).multiplyScalar(0.72) : '#2c2f35', tier >= 2 ? 0.55 : 0.95);
    const chrome = mat('#d4d7dc', 0.2, 1), black = mat('#141518', 0.6), roof = mat(tier >= 2 ? (tier === 3 ? '#1a1a1c' : '#e8e1d2') : '#d6d1c6', 0.95), carpet = mat(tier >= 2 ? '#1f1d1c' : '#2a2a2a', 1), stitchM = glow(tier === 3 ? accent : tier === 2 ? '#e8dcc0' : '#8a8f98');
    const box = (w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0, par = cockpit) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); par.add(b); return b; };
    const cyl = (r, h, m, x, y, z, rx = 0, rz = 0, seg = 16) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); b.position.set(x, y, z); b.rotation.set(rx, 0, rz); cockpit.add(b); return b; };
    const disc = (r, m, x, y, z, rx, seg = 24) => { const b = new THREE.Mesh(new THREE.CircleGeometry(r, seg), m); b.position.set(x, y, z); b.rotation.x = rx; cockpit.add(b); return b; };
    // the shell: dash, its top, the bonnet, the floor, the doors and sills, pillars, the roof (glass in the Halo X and Nova), visors and mirror
    box(1.84, 0.34, 0.62, dash, 0, 0.56, -1.12); box(1.84, 0.06, 0.5, dashTop, 0, 0.75, -1.2, -0.12); box(1.9, 0.05, 1.7, paint, 0, 0.7, -2.25, 0.07); box(1.76, 0.02, 2.6, carpet, 0, 0.17, 0.05);
    for (const sd of [-1, 1]) { box(0.06, 0.5, 2.3, dash, sd * 0.9, 0.6, -0.05); box(0.07, 0.06, 2.3, dashTop, sd * 0.9, 0.86, -0.05);
      box(0.07, 0.07, 0.95, black, sd * 0.84, 1.15, -0.85, -0.82); box(0.08, 0.62, 0.12, black, sd * 0.88, 1.18, 0.45);
      box(0.02, 0.05, 0.12, chrome, sd * 0.865, 0.78, -0.55); /* the door handle */ }
    if (yoke) { box(1.74, 0.02, 1.9, new THREE.MeshStandardMaterial({ color: '#203040', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.35 }), 0, 1.5, 0.2); box(1.74, 0.06, 0.1, black, 0, 1.47, -0.66); }
    else { box(1.74, 0.05, 1.8, roof, 0, 1.5, 0.25); box(1.74, 0.06, 0.08, black, 0, 1.47, -0.66); for (const x of [-0.42, 0.42]) box(0.36, 0.02, 0.2, roof, x, 1.45, -0.55, 0.25); }
    box(0.24, 0.07, 0.02, mat('#9fb4c4', 0.15, 0.8), 0, 1.38, -0.62); box(0.02, 0.08, 0.02, black, 0, 1.44, -0.62);
    // the seats: cloth, stitched, quilted leather, or buckets with harnesses; a back seat unless it's a two-seater
    for (const sd of [-1, 1]) { const x = sd * 0.36;
      box(0.5, 0.12, 0.5, seat, x, 0.4, 0.1); box(0.5, 0.7, 0.12, seat, x, 0.78, 0.42, 0.12); box(0.26, 0.2, 0.1, seat, x, 1.25, 0.47, 0.12);
      if (tier >= 1) { box(0.24, 0.6, 0.02, seat2, x, 0.78, 0.355, 0.12); box(0.24, 0.02, 0.42, seat2, x, 0.465, 0.1); for (const dx of [-0.12, 0.12]) box(0.006, 0.6, 0.006, stitchM, x + dx, 0.78, 0.345, 0.12); } /* a centre panel, stitched */
      if (tier === 2) for (let q = 0; q < 4; q++) box(0.24, 0.008, 0.008, stitchM, x, 0.56 + q * 0.13, 0.348 - q * 0.016, 0.12); /* quilting */
      if (tier === 3) { for (const bx of [-0.25, 0.25]) { box(0.07, 0.62, 0.2, seat, x + bx, 0.82, 0.38, 0.12); box(0.07, 0.12, 0.46, seat, x + bx, 0.49, 0.1); } /* bolsters */
        for (const hx of [-0.08, 0.08]) box(0.05, 0.62, 0.012, glow(accent), x + hx, 0.86, 0.34, 0.12); box(0.12, 0.08, 0.02, chrome, x, 0.62, 0.33); } /* the harness and its buckle */
      if (tier >= 1) { box(0.06, 0.05, 0.4, seat, sd * 0.86, 0.66, -0.2); cyl(0.07, 0.01, chrome, sd * 0.875, 0.5, 0.2, 0, Math.PI / 2, 20); } /* door armrest and speaker */ }
    if (two) box(1.7, 0.6, 0.08, tier === 3 ? trim : seat2, 0, 0.75, 0.75); else { box(1.7, 0.4, 0.5, seat, 0, 0.62, 1.15, 0.1); box(1.7, 0.12, 0.5, seat, 0, 0.42, 0.95); }
    // the middle: the console and gear stick (or buttons), cup holders and an armrest
    box(0.26, 0.26, 1.0, tier >= 2 ? trim : dash, 0, 0.36, -0.2);
    if (elec || tier === 3) { box(0.14, 0.02, 0.1, black, 0, 0.5, -0.45); for (let q = 0; q < 3; q++) box(0.03, 0.012, 0.03, glow(q === 0 && tier === 3 ? '#e03131' : accent), -0.04 + q * 0.04, 0.513, -0.45); } /* drive buttons (the red one starts it) */
    else { cyl(0.012, 0.16, chrome, 0, 0.56, -0.45, -0.25); const k = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), tier >= 2 ? chrome : black); k.position.set(0, 0.64, -0.47); cockpit.add(k); }
    if (tier >= 1) { for (const dz of [-0.2, -0.08]) cyl(0.035, 0.02, black, 0.06, 0.495, dz); box(0.24, 0.08, 0.34, seat, 0, 0.53, 0.18); }
    // the dash: dials or screens, vents, the radio or a touch screen, trim, a clock, mood lighting
    const panel = new THREE.Group(); cockpit.add(panel);
    if (tier === 3) { const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.15), new THREE.MeshBasicMaterial({ map: screenTex('wide', '#081420', new THREE.Color(accent).multiplyScalar(0.45).getStyle(), true) })); sc.position.set(-0.05, 0.81, -1.0); sc.rotation.x = -0.35; cockpit.add(sc); } /* the screen right across */
    else if (tier === 1 && elec) { const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.1), new THREE.MeshBasicMaterial({ map: screenTex('ev', '#0b1a26', '#1d4a66') })); sc.position.set(-0.36, 0.8, -1.0); sc.rotation.x = -0.5; cockpit.add(sc); }
    else { box(0.34, 0.12, 0.04, black, -0.36, 0.79, -1.02, -0.5); for (const x of [-0.43, -0.29]) { disc(0.04, glow(tier === 2 ? '#f6e3c2' : '#9fe3ff'), x, 0.8, -0.995, -0.5); if (tier === 2) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.005, 6, 24), chrome); r.position.set(x, 0.8, -0.993); r.rotation.x = -0.5; cockpit.add(r); } } }
    if (tier === 0) { box(0.2, 0.08, 0.03, black, 0.05, 0.62, -0.83); box(0.08, 0.025, 0.005, glow('#7fd6a0'), 0.05, 0.635, -0.812); } /* the radio */
    else if (tier < 3) { const sc = new THREE.Mesh(new THREE.PlaneGeometry(tier === 2 ? 0.3 : 0.26, 0.17), new THREE.MeshBasicMaterial({ map: screenTex('mid' + tier, '#0d1824', tier === 2 ? '#3a2c1c' : '#1d3d5c') })); sc.position.set(0.05, 0.69, -0.83); sc.rotation.x = -0.3; cockpit.add(sc); }
    for (const x of tier === 2 ? [-0.75, -0.08, 0.18, 0.75] : [-0.75, 0.75]) { if (tier === 2) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 20), chrome); r.position.set(x, 0.62, -0.815); cockpit.add(r); disc(0.04, black, x, 0.62, -0.816, 0); } else box(0.14, 0.05, 0.02, black, x, 0.62, -0.815); } /* vents */
    if (tier >= 2) { box(1.8, 0.035, 0.02, trim, 0, 0.66, -0.812); for (const sd of [-1, 1]) box(0.012, 0.035, 1.4, trim, sd * 0.87, 0.74, -0.3); } /* the trim band across the dash and along the doors */
    if (tier === 2) { disc(0.035, glow('#f8f1e3'), 0.05, 0.88, -0.98, -0.6); const r = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 6, 24), chrome); r.position.set(0.05, 0.88, -0.978); r.rotation.x = -0.6; cockpit.add(r); } /* the clock */
    if (tier >= 2 || elec) { const L = glow(tier >= 2 ? accent : '#5fe3ff'); box(1.78, 0.008, 0.008, L, 0, 0.395, -0.81); for (const sd of [-1, 1]) box(0.008, 0.008, 1.5, L, sd * 0.865, 0.6, -0.25); } /* mood lighting */
    if (tier === 3) box(0.5, 0.02, 0.3, glow(new THREE.Color(accent).multiplyScalar(0.35).getStyle()), -0.36, 0.19, -0.75); /* a glow in the footwell */
    // the steering wheel: plain, leather with chrome spokes, or a flat-bottomed one (a yoke in the Halo X and Nova) with paddles
    sw = new THREE.Group(); const rim = mat(tier >= 2 ? (tier === 3 ? '#1a1a1c' : LEATHER[model] === '#d9c7a3' ? '#3b2a20' : '#1d1d1f') : '#15161a', tier >= 2 ? 0.5 : 0.6), spokeM = tier >= 2 ? chrome : rim;
    if (yoke) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.03), rim); bar.position.y = -0.06; sw.add(bar); for (const sd of [-1, 1]) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.035), rim); g.position.set(sd * 0.17, 0.02, 0); sw.add(g); } }
    else { sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, tier >= 2 ? 0.03 : 0.026, 10, 32, tier === 3 ? Math.PI * 1.7 : Math.PI * 2), rim)); if (tier === 3) { sw.children[0].rotation.z = -Math.PI * 0.35; const fb = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.03), rim); fb.position.y = -0.165; sw.add(fb); } }
    for (const a of [0, 2.1, 4.2]) { if (yoke && a === 0) continue; const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.02), spokeM); sp.position.set(Math.sin(a) * 0.09, Math.cos(a) * 0.09, 0); sp.rotation.z = -a; sw.add(sp); }
    { const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16), rim); hub.rotation.x = Math.PI / 2; sw.add(hub); if (tier === 3) { const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.022), glow(accent)); sc.position.set(0, 0.012, 0.022); sw.add(sc); } }
    if (tier === 3) for (const sd of [-1, 1]) { const pd = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.008), mat('#8d9096', 0.3, 0.9)); pd.position.set(sd * (yoke ? 0.13 : 0.15), 0.04, -0.05); sw.add(pd); } /* gear paddles */
    { const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), black); c2.rotation.x = Math.PI / 2; c2.position.z = -0.15; sw.add(c2); }
    sw.position.set(-0.36, 0.74, -0.86); sw.rotation.x = -0.42; cockpit.add(sw); }
  buildCabin(opts.car.m, opts.car.col); cockpit.visible = false; scene.add(cockpit);
  const SEATS = [[-0.36, -0.15], [0.36, -0.15], [-0.36, 0.85], [0.36, 0.85]]; /* across and back from the middle of the car: driver, front passenger, back left, back right */
  // riding in someone's car: you go where it goes (it's drawn where their updates put it)
  function rideSync(dt) { const f = riding && folk.get(riding.id); if (!f || f.kind !== 'car') return; const v = Math.hypot(f.x - car.x, f.z - car.z) / Math.max(dt, 1e-3); car.v += (Math.min(v, 80) - car.v) * Math.min(1, dt * 4); car.x = f.x; car.z = f.z; car.a = f.ry + Math.PI / 2; car.steer = 0; }
  // ---- calling your car: it sets off from a road a little way off and drives along the streets to you, slows, and
  // pulls up at the kerb beside you (rather than appearing out of thin air) ----
  function callCar() { if (!foot || summon || parked) return false; const px = tileOf(car.x), pz = tileOf(car.z); let goal = null, bd = 9;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (drivable(px + dx, pz + dz)) { const d = Math.hypot(dx, dz); if (d < bd) { bd = d; goal = [px + dx, pz + dz]; } }
    if (!goal) return false; const key = (x, z) => x + ',' + z, prev = new Map([[key(...goal), null]]), depth = new Map([[key(...goal), 0]]), q = [goal]; let far = goal;
    while (q.length) { const [x, z] = q.shift(), d = depth.get(key(x, z)); if (d > depth.get(key(...far))) far = [x, z]; if (d >= 12) continue; /* (about 100 m of road away at most) */
      for (const [ex, ez] of DIRS) { const nx = x + ex, nz = z + ez, k = key(nx, nz); if (prev.has(k) || !drivable(nx, nz)) continue; prev.set(k, [x, z]); depth.set(k, d + 1); q.push([nx, nz]); } }
    if (depth.get(key(...far)) < 2) return false; const path = []; for (let p = far; p; p = prev.get(key(...p))) path.push(p); /* from where it sets off, to you */
    const pts = path.map(([x, z]) => [(x + 0.5) * TILE, (z + 0.5) * TILE]), [gx, gz] = pts[pts.length - 1], ox = car.x - gx, oz = car.z - gz, ol = Math.hypot(ox, oz) || 1;
    const CLEAR = 3.4; /* it stops at least this far from you (middle of the car to you): never on top of you */
    if (ol >= CLEAR + 0.2) { const k = Math.min(2.6, ol - CLEAR); if (k > 0.05) pts.push([gx + ox / ol * k, gz + oz / ol * k]); } /* the last bit: in towards the kerb, on your side, stopping short of you */
    else { /* you're standing in the road (or right by where it'd stop): it pulls up just before you, a little to the side, rather than driving through you */
      const [px2, pz2] = pts.length > 1 ? pts[pts.length - 2] : [gx - 1, gz]; let tx = gx - px2, tz = gz - pz2; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; /* the way it's coming */
      const nx = -tz, nz = tx, side = (ox * nx + oz * nz) >= 0 ? -1 : 1; /* (beside you, on the other side of the lane from you) */
      pts.pop(); pts.push([car.x - tx * 4.4 + nx * side * 1.4, car.z - tz * 4.4 + nz * side * 1.4]);
      while (pts.length > 2) { const [ax, az] = pts[pts.length - 2]; if ((ax - car.x) * tx + (az - car.z) * tz > -4.4) pts.splice(pts.length - 2, 1); else break; } } /* (no stops past you on the way in) */
    const [sx, sz] = pts[0], [nx2, nz2] = pts[1]; summon = { pts, i: 1, x: sx, z: sz, v: 0, ry: Math.atan2(-(nz2 - sz), nx2 - sx) - Math.PI / 2, kind: BIKE ? VK + '!' : VK, col: opts.car.col }; return true; }
  function comeUp(dt) { const S2 = summon, [tx, tz] = S2.pts[S2.i], dx = tx - S2.x, dz = tz - S2.z, d = Math.hypot(dx, dz); let left = d; for (let k = S2.i; k < S2.pts.length - 1; k++) left += Math.hypot(S2.pts[k + 1][0] - S2.pts[k][0], S2.pts[k + 1][1] - S2.pts[k][1]);
    let want = Math.min(11, Math.max(1.2, left * 0.9)); if (foot && d > 0.01) { const ahead = ((car.x - S2.x) * dx + (car.z - S2.z) * dz) / d, side = Math.abs(((car.x - S2.x) * dz - (car.z - S2.z) * dx) / d); if (ahead > 0 && ahead < 3.3 && side < 1.5) want = 0; } /* you're in its way: it waits for you to step aside */
    S2.v += Math.max(-8 * dt, Math.min(4 * dt, want - S2.v)); /* speeds up, then slows to a stop */
    const step = S2.v * dt; if (d <= step || d < 0.05) { S2.x = tx; S2.z = tz; if (++S2.i >= S2.pts.length) { parked = { kind: S2.kind, col: S2.col, x: S2.x, z: S2.z, ry: S2.ry }; summon = null; opts.onCarHere && opts.onCarHere(); } return; }
    S2.x += dx / d * step; S2.z += dz / d * step; const ry = Math.atan2(-dz, dx) - Math.PI / 2; let da = ry - S2.ry; da = Math.atan2(Math.sin(da), Math.cos(da)); S2.ry += da * Math.min(1, dt * 6); }
  function chase(dt) {
    if (lk.id == null && !foot) { const back = Math.exp(-dt * Math.min(0.8, Math.abs(car.v) / 22)); lk.yaw *= back; lk.pitch *= back; } /* let go: the view stays where you turned it, and drifts gently back behind the car as you drive (not at all while you're stopped) */
    const fp = mode === 1; cockpit.visible = fp && !foot && !BIKE && !BOAT; /* (a bike or a boat: no dashboard, just the view ahead) */ sw.rotation.z = car.steer * 1.4; if (cockpit.visible) { cockpit.position.set(car.x, 0, car.z); cockpit.rotation.set(0, car.a - Math.PI / 2, 0); }
    { const near = fp ? 0.08 : 0.5; if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); } } /* in the car, close enough to see the wheel */
    if (fp && foot) { const a = lk.yaw; camera.position.set(car.x + Math.cos(a) * 0.1, 1.62, car.z - Math.sin(a) * 0.1); look.set(camera.position.x + Math.cos(a) * 10, 1.62 + Math.tan(lk.pitch - 0.02) * 10, camera.position.z - Math.sin(a) * 10); camera.lookAt(look); cam.copy(camera.position); view.cut.R.value = 0; } /* through your own eyes */
    else if (fp) { const a = car.a + lk.yaw, [sx, sz] = SEATS[riding ? riding.seat : 0] || SEATS[1]; camera.position.set(car.x - Math.cos(car.a) * sz + Math.sin(car.a) * sx, 1.18, car.z + Math.sin(car.a) * sz + Math.cos(car.a) * sx); /* your seat: the driver's on the left, or where you're riding */
      look.set(camera.position.x + Math.cos(a) * 10, 1.18 + Math.tan(lk.pitch - 0.15) * 10, camera.position.z - Math.sin(a) * 10); camera.lookAt(look); cam.copy(camera.position); view.cut.R.value = 0; }
    else { const high = mode === 2, a = foot ? lk.yaw : car.a + lk.yaw, back = foot ? (high ? 14 : 4.2) : high ? 26 : BIKE ? 5.2 : BOAT ? (VK === 'ferry' ? 34 : 13) : 9, up = (foot ? (high ? 10 : 2.3) : high ? 18 : BIKE ? 2.5 : BOAT ? (VK === 'ferry' ? 14 : 4.6) : 3.4) + Math.min(lk.pitch, 0.35) * -8, tx = car.x - Math.cos(a) * back, tz = car.z + Math.sin(a) * back, k = Math.min(1, dt * 4.5); /* one steady pace, dragging or not: no jumps */
      cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k; cam.y += (Math.max(1.2, up) - cam.y) * k; camera.position.copy(cam);
      const ahead = foot ? 3 : 6, lx = car.x + Math.cos(a) * ahead, lz = car.z - Math.sin(a) * ahead; aim.x += (lx - aim.x) * k; aim.z += (lz - aim.z) * k; look.set(aim.x, (foot ? 1.45 : 1.2) + Math.tan(Math.max(0, lk.pitch - 0.3) * 1.45) * (back + ahead), aim.z); camera.lookAt(look); /* drag up past a tilt: the camera looks up into the sky */ /* look past the car the way the camera faces */
      view.cut.A.value.set(car.x, 1.0, car.z); { const bx = camera.position.x - car.x, bz = camera.position.z - car.z, L = Math.hypot(bx, bz) || 1; view.cut.B.value.set(camera.position.x + bx / L * 3, camera.position.y + 1, camera.position.z + bz / L * 3); } view.cut.R.value = high ? 6 : 3.8; } /* see through what's between you and the car, and just behind the camera */
    if (bump > 0) { bump -= dt; camera.position.y += Math.sin(bump * 60) * 0.08; }
  } /* (no tremble at speed: it read as the car hopping) */
  const now0 = () => performance.now();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { if (lk.id != null) return; lk.id = e.pointerId; lk.x = e.clientX; lk.y = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== lk.id) return; lk.yaw = foot ? lk.yaw - (e.clientX - lk.x) * 0.006 : Math.max(-Math.PI, Math.min(Math.PI, lk.yaw - (e.clientX - lk.x) * 0.006)); lk.pitch = Math.max(-0.5, Math.min(1.2, lk.pitch - (e.clientY - lk.y) * 0.004)); /* (up to well over your head: the aircraft in the sky) */ lk.x = e.clientX; lk.y = e.clientY; });
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
  let nearCar = false, nearRide = null, sent = 0, nearAt = 0, nearId = null, chk = 0, timeAt = 0, shadowAt = { x: 1e9, z: 1e9 }, shadowsDue = true, frames = 0, spent = 0, dead = false;
  const minute = () => (opts.minute ? opts.minute() : 720);
  function sunNow(force) { const fast = Math.min(90, Math.abs(car.v) * 1.6); if (!(force || shadowsDue || Math.hypot(car.x - shadowAt.x, car.z - shadowAt.z) > 40 + fast)) return; /* (redone less often the faster you go: each redo is a hitch) */ shadowAt = { x: car.x, z: car.z }; shadowsDue = false;
    view.center.set(car.x + Math.cos(car.a) * Math.min(40, Math.abs(car.v)), 0, car.z - Math.sin(car.a) * Math.min(40, Math.abs(car.v))); view.span = 110 + Math.min(70, Math.abs(car.v) * 1.2); /* at speed: a wider patch, ahead of you */ if (opts.weather) view.setWeather(opts.weather()); view.setTime(minute()); haze(); }
  // ---- the Colosseum's billboard: a big board on two posts beside it, showing the builder's pictures in turn (a
  // FIGHT NIGHT poster when there are none). One canvas, redrawn when the picture changes. ----
  const boards = new Map(), bbC = document.createElement('canvas'); bbC.width = 512; bbC.height = 256; const bbT = new THREE.CanvasTexture(bbC); bbT.colorSpace = THREE.SRGBColorSpace; let bbKey = '';
  const bbM = new THREE.MeshBasicMaterial({ map: bbT, toneMapped: false }), bbImgs = new Map();
  function paintBoard(now) { const L = (opts.billboard && opts.billboard()) || [], u = L.length ? L[Math.floor(now / 9000) % L.length] : null; let im = u && bbImgs.get(u); if (u && !im) { im = new Image(); im.onload = () => { bbKey = ''; }; im.src = u; bbImgs.set(u, im); }
    const ok = im && im.complete && im.naturalWidth, key = (u || '') + ok; if (key === bbKey) return; bbKey = key; const g = bbC.getContext('2d'); g.fillStyle = '#8A2A22'; g.fillRect(0, 0, 512, 256);
    if (ok) { const r = Math.max(512 / im.naturalWidth, 256 / im.naturalHeight); g.drawImage(im, (512 - im.naturalWidth * r) / 2, (256 - im.naturalHeight * r) / 2, im.naturalWidth * r, im.naturalHeight * r); }
    else { g.fillStyle = '#F2C94C'; g.font = '900 58px Georgia, serif'; g.textAlign = 'center'; g.fillText('FIGHT NIGHT', 256, 120); g.fillStyle = '#F1EBDD'; g.font = '600 28px system-ui, sans-serif'; g.fillText('at the Colosseum', 256, 172); } bbT.needsUpdate = true; }
  function syncBoards(now) { const seen = new Set();
    for (const blk of blocks.values()) for (const b of opts.buildings(blk.bx, blk.by, blk.bx + B, blk.by + B)) { const T0 = BUILDING_TYPES[b.type]; if (!T0 || T0.style !== 'colosseum' || b.ruin || b.done === false) continue; seen.add(b.id); if (boards.has(b.id)) continue;
      const [w, d] = b.w ? [b.w, b.d] : T0.size, x = (b.x + w + 0.6) * TILE, z = (b.y + d * 0.32) * TILE, g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = -Math.PI / 2;
      const post = new THREE.MeshStandardMaterial({ color: '#3B2C1E', roughness: 0.8 }); view.mats.push(post);
      for (const px of [-4, 4]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 9, 8), post); p.position.set(px, 4.5, 0); p.castShadow = true; g.add(p); }
      const frame = new THREE.Mesh(new THREE.BoxGeometry(13.2, 6.8, 0.4), post); frame.position.set(0, 10.6, 0); frame.castShadow = true; g.add(frame);
      for (const sd of [1, -1]) { const face = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 6.3), bbM); face.position.set(0, 10.6, sd * 0.21); if (sd < 0) face.rotation.y = Math.PI; g.add(face); }
      scene.add(g); boards.set(b.id, g); }
    for (const [id, g] of boards) if (!seen.has(id)) { scene.remove(g); g.traverse(o => o.geometry && o.geometry.dispose()); boards.delete(id); }
    if (boards.size) paintBoard(now); }
  view.resize(); around(); sunNow(true);
  view.start((dt, now) => {
    if (dead) return; drive(dt);
    if (myPet) { const onFoot = foot && feet && !riding; myPet.group.visible = onFoot; if (onFoot) myPet.step(dt, feet.group.position.x, feet.group.position.z); }
    me.visible = !foot && !riding && mode !== 1; if (feet) { feet.group.visible = foot && mode !== 1; if (foot) { feet.setPos(car.x, car.z); { const m = car.mv == null ? car.a : car.mv; feet.animate(dt, Math.cos(m) * car.v, -Math.sin(m) * car.v); } feet.group.rotation.y = car.a + Math.PI / 2; } } /* your character walks (and faces where you're going) */
    if (parked) pushCar(parked.kind, parked.col, parked.x, parked.z, parked.ry);
    if (summon) { comeUp(dt); if (summon) pushCar(summon.kind, summon.col, summon.x, summon.z, summon.ry); }
    me.position.set(car.x, BOAT ? Math.sin(now / 700) * 0.06 : 0, car.z); me.rotation.set(0, 0, 0); me.rotation.y = car.a - Math.PI / 2; if (BOAT) me.rotation.z = Math.sin(now / 900) * 0.025; /* (a boat rocks gently) */ for (const w of me.userData.wheels || []) w.rotation.x -= car.v * dt / 0.33;
    roll += (car.steer * Math.min(1, Math.abs(car.v) / 14) * 0.05 - roll) * Math.min(1, dt * 5); accS += ((car.v - accel0) / Math.max(dt, 1 / 30) - accS) * Math.min(1, dt * 2.5); accel0 = car.v; pitch += (-accS * 0.0022 - pitch) * Math.min(1, dt * 3); /* the body dips under braking and squats as it pulls away: smoothed, so it never twitches */ me.rotateZ(roll); me.rotateX(Math.max(-0.035, Math.min(0.035, pitch))); /* the body leans into a turn and dips when you brake */
    const night = view.night || 0; for (const blk of blocks.values()) for (const c of blk.parked) pushCar(c.kind, c.col, c.x, c.z, c.ry);
    driveTraffic(dt); walk(dt); skyLife(dt, now, night);
    head.intensity = foot || riding ? 0 : night * 60; if (night > 0.02) { const fx = Math.cos(car.a), fz = -Math.sin(car.a); head.position.set(car.x + fx * 1.8, 0.9, car.z + fz * 1.8); head.target.position.set(car.x + fx * 14, 0, car.z + fz * 14); }
    const fov = mode === 1 && camera.aspect < 1 ? 72 + (foot ? 0 : Math.min(8, Math.abs(car.v) * 0.3)) : foot ? 62 : 60 + Math.min(14, Math.abs(car.v) * 0.45); if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); } /* the view widens with speed */
    GRASS.time.value = now / 1000; W.WATER.time.value = now / 1000; crowd(now, dt); if (bubbles.size) placeBubbles(now); services(now, dt); rideSync(dt); chase(dt); drawFleet(night); routeMat.opacity = 0.6 + 0.3 * Math.sin(now / 250); ground.position.set(Math.round(car.x / 50) * 50, -0.45, Math.round(car.z / 50) * 50); /* (well below the water, so water always shows) */
    if (now - chk > 600) { chk = now; around(); syncBoards(now); }
    if (queue.length) { const [bx, by] = queue.shift().split(',').map(Number); if (opts.loaded(bx + B / 2, by + B / 2) || opts.loaded(bx, by)) build(bx, by); else queue.push(bx + ',' + by); }
    if (now - timeAt > 20000) { timeAt = now; shadowsDue = true; } sunNow(false);
    if (now - sent > 250) { sent = now; opts.onMove(car.x / TILE, car.z / TILE, car.a, car.v / TILE); }
    if (now - nearAt > 300 && !riding) { nearAt = now; let b = null; const fx = car.x + Math.cos(car.a) * 3, fz = car.z - Math.sin(car.a) * 3;
      if (foot) { let bd = 3.2; for (const s of solidsNear(car.x, car.z)) { if (!s.door) continue; const d = Math.hypot(s.door[0] - car.x, s.door[1] - car.z); if (d < bd) { bd = d; b = s.id; } } /* at the front door */
        const nc = !!parked && Math.hypot(parked.x - car.x, parked.z - car.z) < 6.5; /* (a few steps from its side) */ if (nc !== nearCar) { nearCar = nc; opts.onCar && opts.onCar(nc); } }
      else if (Math.abs(car.v) < 5) { let bd = 7; for (const s of solidsNear(car.x, car.z)) { if (!s.id || !s.r) continue; const dx = Math.max(s.r[0] - fx, 0, fx - s.r[2]), dz = Math.max(s.r[1] - fz, 0, fz - s.r[3]), d = Math.hypot(dx, dz); if (d < bd) { bd = d; b = s.id; } } }
      if (b !== nearId) { nearId = b; opts.onNear(b ? opts.byId(b) : null); }
      { let rc = null, rd = 4.5; if (foot) for (const [id, f] of folk) if (f.kind === 'car' && f.drv) { const d = Math.hypot(f.x - car.x, f.z - car.z); if (d < rd) { rd = d; rc = id; } } /* by someone's car: ask them for a ride */
        const rf = rc && folk.get(rc), key = rc ? rc + (rf.full ? ':full' : '') : null; if (key !== nearRide) { nearRide = key; opts.onRide && opts.onRide(rc ? { id: rc, h: rf.h, full: rf.full } : null); } } }
    frames++; spent += dt; if (frames >= 120) { const fps = frames / spent; frames = 0; spent = 0; if (fps < 24) { if (wantCars > 4) wantCars = Math.max(4, Math.floor(wantCars * 0.6)); else if (RAD > 1) { RAD--; haze(); around(); } } } /* can't keep up: less traffic first, then a block less far */ /* can't keep up: one block less far */
  });
  const refresh = setInterval(() => { if (!dead) for (const k of blocks.keys()) if (!queue.includes(k)) queue.push(k); }, 8000); /* pick up changes to the town */

  // ---- controls on screen, in the layout picked in Settings: a stick; pedals and steer buttons; or a steering wheel and
  // pedals (steering on the left unless it's swapped). The arrow keys and the keys picked in Settings always work too.
  let pad = null;
  function controls() { if (pad) pad.remove(); inp.thr = inp.steer = 0; const lay = foot ? 'stick' : ctl.layout || 'pedalstick'; /* on foot: always the stick */ pad = document.createElement('div'); pad.className = 'tpad ' + lay + (ctl.swap ? ' swap' : ''); let ts = ctl.steerSize || 1, tp = ctl.pedalSize || 1; if (lay !== 'stick') { const W0 = host.clientWidth || innerWidth, need = (lay === 'wheel' ? 150 * ts : lay === 'pedalstick' ? 128 * ts : 170 * ts) + 88 * tp + 52; if (need > W0) { const f = (W0 - 52) / (need - 52); ts *= f; tp *= f; } } /* both fit side by side, however big you've made them */
    pad.style.setProperty('--ts', String(ts)); pad.style.setProperty('--tp', String(tp)); host.append(pad); /* sizes picked in Settings */
    { const right = lay === 'stick' ? (ctl.swap ? 28 + 128 * ts : 0) : ctl.swap ? (lay === 'wheel' ? 18 + 150 * ts : lay === 'pedalstick' ? 28 + 128 * ts : 24 + 78 * ts) : 20 + 186 * tp; /* (the pedals stand one above the other) */
      const hs = (host.parentElement || host).style, ped = lay !== 'stick', gap = ped ? 16 + 84 * tp + 18 : 20; /* 🚶 Get out: just beside the pedals (with the one stick, in the free corner) */
      hs.setProperty('--dhud', Math.max(lay === 'stick' && !ctl.swap ? 112 : 24, right + 14) + 'px');
      hs.setProperty('--goB', (ped ? 26 : 30) + 'px'); if (!ctl.swap) { hs.setProperty('--goL', 'auto'); hs.setProperty('--goR', gap + 'px'); } else { hs.setProperty('--goR', 'auto'); hs.setProperty('--goL', gap + 'px'); } } /* the speed and Stop buttons sit above whatever is on the right */
    const mk = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; pad.append(d); return d; };
    // landscape: put 🚶 Get out by where the pedals really are on this phone (its notch, its text size), never on them
    const fitGo = () => { if (!pad || !matchMedia('(orientation: landscape) and (max-height: 560px)').matches) return; const ped = pad.querySelector('.tpedals'), go = (host.parentElement || host).querySelector('.rndbtn.dmode'); if (!ped || !go || go.hidden) return;
      const pr = ped.getBoundingClientRect(), gr = go.getBoundingClientRect(), lab = go.querySelector('span'), lw = lab ? lab.getBoundingClientRect().width : gr.width, W0 = innerWidth, hs = (host.parentElement || host).style;
      if (!pr.width) return; const half = Math.max(gr.width, lw) / 2, cx = ctl.swap ? pr.right + 14 + half : pr.left - 14 - half; /* (the button's centre, clear of the pedals and of its label) */
      if (!ctl.swap) { hs.setProperty('--goL', 'auto'); hs.setProperty('--goR', `calc(${Math.max(0, Math.round(W0 - cx - gr.width / 2))}px - var(--sideX, 0px))`); } else { hs.setProperty('--goR', 'auto'); hs.setProperty('--goL', Math.round(cx - gr.width / 2) + 'px'); } };
    requestAnimationFrame(() => requestAnimationFrame(fitGo)); setTimeout(fitGo, 600); if (!controls.fit) { controls.fit = true; addEventListener('resize', () => setTimeout(fitGo, 200)); }
    const hold = (elm, down, up) => { const on = new Set(); elm.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { elm.setPointerCapture(e.pointerId); } catch (x) {} on.add(e.pointerId); elm.classList.add('on'); down(e); });
      const off = e => { if (!on.delete(e.pointerId)) return; if (!on.size) { elm.classList.remove('on'); up(e); } }; elm.addEventListener('pointerup', off); elm.addEventListener('pointercancel', off); return on; };
    if (lay === 'stick') { const st = mk('tjoy', '<i></i>'), knob = st.firstChild; let id = null;
      const mv = e => { const r = st.getBoundingClientRect(), R = r.width / 2; let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } const dz = foot ? 0 : 0.3; inp.thr = Math.abs(dy) <= dz ? 0 : -(dy - Math.sign(dy) * dz) / (1 - dz); inp.steer = -dx; /* (driving: steering sideways doesn't touch the gas or brake unless you mean it) */ knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`; };
      st.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; st.setPointerCapture(id); mv(e); }); st.addEventListener('pointermove', e => { if (e.pointerId === id) mv(e); });
      const end = () => { id = null; inp.thr = inp.steer = 0; knob.style.transform = ''; }; st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end); return; }
    // the pedals: brake (and reverse when stopped) and accelerator, held down
    const pedals = mk('tpedals'), brake = document.createElement('div'), gas = document.createElement('div'); brake.className = 'tped brake'; brake.innerHTML = '<b>BRAKE</b>'; gas.className = 'tped gas'; gas.innerHTML = '<b>GAS</b>'; pedals.append(gas, brake); /* the accelerator on top of the brake (and reverse) */
    hold(gas, () => { inp.thr = 1; }, () => { inp.thr = Math.min(0, inp.thr); }); hold(brake, () => { inp.thr = -1; }, () => { inp.thr = Math.max(0, inp.thr); });
    if (lay === 'pedals') { const st = mk('tsteer'), l = document.createElement('div'), r = document.createElement('div'); l.className = 'tbtn'; l.textContent = '◀'; r.className = 'tbtn'; r.textContent = '▶'; st.append(l, r);
      hold(l, () => { inp.steer = 1; }, () => { inp.steer = Math.min(0, inp.steer); }); hold(r, () => { inp.steer = -1; }, () => { inp.steer = Math.max(0, inp.steer); }); return; }
    // pedals and a stick: the pedals drive and brake, the stick (side to side) steers
    if (lay === 'pedalstick') { const st = mk('tjoy steer', '<i></i>'), knob = st.firstChild; let id = null;
      const mv = e => { const r = st.getBoundingClientRect(), R = r.width / 2; const dx = Math.max(-1, Math.min(1, (e.clientX - r.left - R) / R)); inp.steer = -dx; knob.style.transform = `translate(${dx * R * 0.6}px,0)`; };
      st.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; st.setPointerCapture(id); mv(e); }); st.addEventListener('pointermove', e => { if (e.pointerId === id) mv(e); });
      const end = () => { id = null; inp.steer = 0; knob.style.transform = ''; }; st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end); return; }
    // a steering wheel: drag it round (up to about a turn and a half each way); it springs back when you let go
    const wh = mk('twheel', '<svg viewBox="-50 -50 100 100"><circle r="44" fill="none" stroke="#1d1f24" stroke-width="10"/><circle r="44" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/><path d="M-40 4 L-12 8 L-8 30 L8 30 L12 8 L40 4" fill="none" stroke="#1d1f24" stroke-width="8" stroke-linejoin="round"/><circle r="9" fill="#2a2d33"/><rect x="-3" y="-50" width="6" height="10" fill="#e8463a"/></svg>');
    let wid = null, a0 = 0, turned = 0, last = 0; const ang = e => { const r = wh.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
    wh.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); wid = e.pointerId; wh.setPointerCapture(wid); last = ang(e); });
    wh.addEventListener('pointermove', e => { if (e.pointerId !== wid) return; const a = ang(e); let d = a - last; d = Math.atan2(Math.sin(d), Math.cos(d)); last = a; turned = Math.max(-2.6, Math.min(2.6, turned + d)); inp.steer = -turned / 2.6; wh.style.transform = `rotate(${turned}rad)`; });
    const wend = () => { wid = null; const from = turned, t0 = now0(); const back = () => { const k = Math.min(1, (now0() - t0) / 250); turned = from * (1 - k); inp.steer = -turned / 2.6; wh.style.transform = `rotate(${turned}rad)`; if (k < 1 && wid == null) requestAnimationFrame(back); }; back(); };
    wh.addEventListener('pointerup', wend); wh.addEventListener('pointercancel', wend); }
  controls();
  const keyOf = e => e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const kd = e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = keyOf(e), K = Object.values(ctl.keys || {}).map(x => String(x).toLowerCase()); if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Shift'].includes(k) || /* (Space: the handbrake; Shift: run) */ K.includes(String(k).toLowerCase())) { keys.add(String(k).length === 1 ? String(k).toLowerCase() : k); e.preventDefault(); } };
  const ku = e => keys.delete(keyOf(e)), kb = () => keys.clear();
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', kb);
  // turning the phone: the view follows its own box (not the window, which reports the turn in steps), and checks again as
  // the turn settles, so the picture never stretches or jumps
  const fit = () => { if (dead) return; view.resize(); canvas.style.width = '100%'; canvas.style.height = '100%'; }, ro = new ResizeObserver(fit); ro.observe(host);
  const turned = () => [60, 250, 600].forEach(t => setTimeout(fit, t)); addEventListener('orientationchange', turned); addEventListener('resize', fit);
  canvas.addEventListener('webglcontextlost', () => { setTimeout(() => { if (!dead && renderer.getContext().isContextLost()) opts.onLost && opts.onLost(); }, 8000); }); /* the view tries to come back by itself first */

  return {
    get pos() { return { x: car.x / TILE, y: car.z / TILE, a: car.a, v: car.v / TILE, mode: riding ? 'ride' : foot ? 'walk' : 'car' }; },
    // riding in someone else's car ({ id, seat, col, x, y, a }), and getting out of it (on foot, beside the car)
    ride(o) { riding = { id: o.id, seat: Math.max(1, Math.min(3, o.seat | 0 || 1)) }; foot = false; car.v = 0; car.steer = 0; if (o.x != null) { car.x = o.x * TILE; car.z = o.y * TILE; car.a = o.a || 0; } lk.yaw = 0; lk.pitch = 0;
      buildCabin(o.m || 'car', o.col || '#7c8288'); if (nearRide) { nearRide = null; opts.onRide && opts.onRide(null); } if (nearCar) { nearCar = false; opts.onCar && opts.onCar(false); } if (pad) pad.style.display = 'none'; },
    unride(x, y, a) { if (!riding) return; const side = SEATS[riding.seat][0] > 0 ? 1 : -1; riding = null; if (x != null) { car.x = x * TILE; car.z = y * TILE; if (a != null) car.a = a; }
      car.x += Math.sin(car.a) * 2.2 * side; car.z += Math.cos(car.a) * 2.2 * side; car.v = 0; foot = true; mkFeet(); lk.yaw = car.a; car.mv = null; buildCabin(opts.car.m, opts.car.col); controls(); },
    get riding() { return riding ? riding.id : null; },
    // get out of the car (it stays parked there if it's yours) and walk, or get back in (at your parked car, or a car appears)
    walk(keep) { if (foot) return; parked = keep ? { kind: BIKE ? VK + '!' : VK, col: opts.car.col, x: car.x, z: car.z, ry: car.a - Math.PI / 2 } : null; foot = true; mkFeet(); lk.yaw = car.a; car.mv = null;
      const sx = -Math.sin(car.a) * 2.2, sz = -Math.cos(car.a) * 2.2; car.x += sx; car.z += sz; car.v = 0; nearCar = false; controls(); },
    drive() { if (!foot) return; if (parked) { car.x = parked.x; car.z = parked.z; car.a = parked.ry + Math.PI / 2; parked = null; } foot = false; car.v = 0; car.vx = car.vz = 0; car.wa = 0; lk.yaw = 0; nearCar = false; opts.onCar && opts.onCar(false); controls(); },
    get parked() { return !!parked; },
    callCar() { return callCar(); }, get coming() { return !!summon; },
    // where a point of the town is on the screen (tiles, and metres up): for buttons that sit on the door, or on the car
    project(tx, ty, h = 0) { const v = PRJ.set(tx * TILE, h, ty * TILE).project(camera), w = canvas.clientWidth, hh = canvas.clientHeight; return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * hh, on: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 }; },
    get parkedAt() { return parked ? { x: parked.x / TILE, y: parked.z / TILE } : null; },
    doorOf(id) { for (const v of blocks.values()) for (const s of v.solid) if (s.id === id && s.door) return { x: s.door[0] / TILE, y: s.door[1] / TILE, a: s.out }; return null; },
    kmh() { return Math.round(Math.abs(car.v) * 3.6); }, gear() { return !CARPHYS || foot || riding ? '' : car.v < -0.3 ? 'R' : Math.abs(car.v) < 0.3 && box.pedal < 0.05 ? 'N' : String(box.g); },
    say(who, text) { sayOver(who, text); }, /* talking on the street: 'me' or a colonist's id */
    stats() { return { ...stats, blocks: blocks.size, people: folk.size, traffic: traffic.length, walkers: peds.length, radius: RAD, fleet: Object.fromEntries([...fleetM].filter(([, m]) => m.count).map(([k, m]) => [k, m.count])), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
    toggleView() { mode = (mode + 1) % 3; lk.yaw = foot ? lk.yaw : 0; lk.pitch = 0; return ['behind', 'driver', 'above'][mode]; },
    setControls(c) { ctl = c || ctl; controls(); if (riding && pad) pad.style.display = 'none'; },
    setRoute,
    stop() { car.v = 0; car.vx = car.vz = 0; },
    dispose() { dead = true; clearInterval(refresh); view.stop(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', kb); removeEventListener('resize', fit); removeEventListener('orientationchange', turned); ro.disconnect();
      for (const v of blocks.values()) drop(v); blocks.clear(); for (const f of folk.values()) scene.remove(f.g); folk.clear();
      ground.geometry.dispose(); ground.material.dispose(); try { view.dispose(); } catch (e) {} try { renderer.forceContextLoss(); } catch (e) {} canvas.remove(); if (pad) pad.remove(); chevron.dispose(); routeMat.dispose(); beamMat.dispose(); for (const m of fleetM.values()) { scene.remove(m); m.dispose(); } blobGeo.dispose(); blobMat.dispose(); beamGeo.dispose(); beamMat2.dispose(); beamTex.dispose(); sky.t.dispose(); },
  };
}
