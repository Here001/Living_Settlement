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
  const r = rng((bx * 73856093) ^ (by * 19349663)), ground = new Uint8Array(B * B), roads = [], sroads = [], buildings = [], props = [], spots = [], solid = [];
  for (let ty = -1; ty <= B; ty++) for (let tx = -1; tx <= B; tx++) { const t = o.road(bx + tx, by + ty); if (!t) continue; const inside = tx >= 0 && ty >= 0 && tx < B && ty < B;
    if (inside) { roads.push([tx, ty, t]); ground[ty * B + tx] = 2; } else sroads.push([tx, ty, t]); }
  for (let ty = 0; ty < B; ty++) for (let tx = 0; tx < B; tx++) if (!ground[ty * B + tx] && o.water(bx + tx, by + ty)) ground[ty * B + tx] = 3;
  const wx = x => (bx * TILE + x), wz = z => (by * TILE + z);
  for (const b of o.buildings(bx, by, bx + B, by + B)) {
    const T = BUILDING_TYPES[b.type]; if (!T) continue; const [w, h] = sizeOf(b), tx = b.x - bx, ty = b.y - by, st = T.style, x = tx * TILE, y = ty * TILE;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const gx = tx + i, gy = ty + j; if (gx < 0 || gy < 0 || gx >= B || gy >= B || ground[gy * B + gx] === 2) continue;
      ground[gy * B + gx] = st === 'farm' ? 4 : st === 'pitch' || st === 'stadium' || st === 'racetrack' ? 5 : GREEN.has(st) ? 0 : 1; }
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
    solid.push({ r: [wx(x + M), wz(y + M), wx(x + w * TILE - M), wz(y + h * TILE - M)], id: b.id });
  }
  // what's next door, so kerbs and riverbanks know whether to stop at the block's edge
  const gnd = (tx, ty) => o.road(bx + tx, by + ty) ? 2 : o.water(bx + tx, by + ty) ? 3 : o.building(bx + tx, by + ty) ? 1 : 0;
  return { L: { seed: (bx * 31 + by) >>> 0, tw: B, th: B, ground: Array.from(ground).join(''), roads, sroads, buildings, props, spots, scenery: [], gnd }, solid };
}

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
    const { L, solid } = blockArea(bx, by, opts), g = W.buildArea(view, L, { cordon: false, pad: 0, ring: false, add: false });
    g.position.set(bx * TILE, 0, by * TILE); g.updateMatrixWorld(true); scene.add(g);
    if (old) drop(old); blocks.set(key, { g, sig: s, bx, by, solid }); shadowsDue = true; const ms = performance.now() - t0; stats.builds++; stats.maxMs = Math.max(stats.maxMs, ms); stats.totalMs += ms; }
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
  const me = W.makeCar(opts.car.kind || 'car', opts.car.col || '#c8382e'); scene.add(me); me.traverse(m => { if (m.isMesh) m.castShadow = true; });
  const tileOf = v => Math.floor(v / TILE);
  const solidsNear = (x, z) => { const out = []; const bx = Math.floor(tileOf(x) / B) * B, by = Math.floor(tileOf(z) / B) * B;
    for (const dx of [-B, 0, B]) for (const dz of [-B, 0, B]) { const v = blocks.get((bx + dx) + ',' + (by + dz)); if (v) out.push(...v.solid); } return out; };
  const hits = (x, z, S) => { const tx = tileOf(x), tz = tileOf(z); if (!opts.loaded(tx, tz)) return true; if (opts.water(tx, tz) && !opts.road(tx, tz)) return true;
    for (const s of S) { if (s.r) { if (x > s.r[0] && x < s.r[2] && z > s.r[1] && z < s.r[3]) return true; } else if (Math.hypot(x - s.c[0], z - s.c[1]) < s.c[2]) return true; } return false; };
  const keys = new Set(), joy = { x: 0, y: 0 };
  function drive(dt) {
    const up = (keys.has('ArrowUp') || keys.has('w') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - joy.y, turn = (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - joy.x;
    const thr = Math.max(-1, Math.min(1, up)), st = Math.max(-1, Math.min(1, turn)), rt = opts.road(tileOf(car.x), tileOf(car.z)), R = rt && ROAD_TYPES[rt];
    const top = R ? 7 * (R.speed || 2) : 6; /* metres a second: a street 14 (50 km/h), a highway 28; off the road, slower */
    if (thr > 0.05) car.v += (car.v < 0 ? 14 : 5) * thr * dt; else if (thr < -0.05) car.v += (car.v > 0 ? 14 : 3) * thr * dt; else car.v *= Math.pow(0.45, dt);
    if (car.v > top) car.v = Math.max(top, car.v - 10 * dt); car.v = Math.max(-5, car.v); if (Math.abs(car.v) < 0.05 && Math.abs(thr) < 0.05) car.v = 0;
    car.steer += (st - car.steer) * Math.min(1, dt * 7); car.a += car.steer * 1.5 * Math.max(-1, Math.min(1, car.v / 5)) * dt;
    const fx = Math.cos(car.a), fz = -Math.sin(car.a), nx = car.x + fx * car.v * dt, nz = car.z + fz * car.v * dt, S = solidsNear(nx, nz), dir = Math.sign(car.v || 1);
    const pts = [[2.1 * dir, 0.85], [2.1 * dir, -0.85], [0, 0]]; /* the front corners (the back ones going backwards) and the middle */
    if (pts.some(([u, w]) => hits(nx + fx * u + fz * w, nz + fz * u - fx * w, S))) { car.v = -car.v * 0.25; bump = 0.25; return; }
    car.x = nx; car.z = nz; }
  let bump = 0;

  // ---- the people round you: colonists walking, and cars, moved smoothly to where the map has them ----
  const folk = new Map(); let folkAt = 0;
  function crowd(now, dt) {
    if (now - folkAt > 400) { folkAt = now; const L = opts.people(car.x / TILE, car.z / TILE), seen = new Set();
      for (const p of L) { seen.add(p.id); const kind = p.car ? 'car' : 'walk'; let f = folk.get(p.id);
        if (f && f.kind !== kind) { scene.remove(f.g); folk.delete(p.id); f = null; }
        if (!f) { if (kind === 'walk') { const P = W.makePerson(p.id); f = { kind, P, g: P.group }; } else { const g = W.makeCar(p.van ? 'van' : 'car', p.col || '#7c8288'); f = { kind, g }; }
          f.g.position.set(p.x * TILE, 0, p.y * TILE); scene.add(f.g); folk.set(p.id, f); }
        f.tx = p.x * TILE; f.tz = p.y * TILE; }
      for (const [id, f] of folk) if (!seen.has(id)) { scene.remove(f.g); folk.delete(id); } }
    for (const f of folk.values()) { const g = f.g, dx = f.tx - g.position.x, dz = f.tz - g.position.z, k = Math.min(1, dt * 2.5); if (Math.hypot(dx, dz) > 40) { g.position.x = f.tx; g.position.z = f.tz; continue; }
      const vx = dx * k / Math.max(dt, 1e-3), vz = dz * k / Math.max(dt, 1e-3); g.position.x += dx * k; g.position.z += dz * k;
      if (f.P) f.P.animate(dt, vx, vz); else if (Math.hypot(vx, vz) > 0.4) { const want = Math.atan2(-vx, -vz); let d = want - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * Math.min(1, dt * 5); for (const w of g.userData.wheels || []) w.rotation.x -= Math.hypot(vx, vz) * dt / 0.33; } } }

  // ---- the camera follows behind (or from higher up), and buildings between it and you are cut away ----
  let high = 0; const cam = new THREE.Vector3(car.x - Math.cos(car.a) * 9, 3.6, car.z + Math.sin(car.a) * 9), look = new THREE.Vector3();
  function chase(dt) { const back = high ? 26 : 9, up = high ? 18 : 3.4, tx = car.x - Math.cos(car.a) * back, tz = car.z + Math.sin(car.a) * back, k = Math.min(1, dt * 3.2);
    cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k; cam.y += (up - cam.y) * k; camera.position.copy(cam);
    if (bump > 0) { bump -= dt; camera.position.y += Math.sin(bump * 60) * 0.08; }
    look.set(car.x + Math.cos(car.a) * 6, 1.2, car.z - Math.sin(car.a) * 6); camera.lookAt(look);
    view.cut.A.value.set(car.x, 1.0, car.z); view.cut.B.value.copy(camera.position); view.cut.R.value = high ? 6 : 3.5; }

  // ---- the loop ----
  let sent = 0, nearAt = 0, nearId = null, chk = 0, timeAt = 0, shadowAt = { x: 1e9, z: 1e9 }, shadowsDue = true, frames = 0, spent = 0, dead = false;
  const minute = () => (opts.minute ? opts.minute() : 720);
  function sunNow(force) { if (!(force || shadowsDue || Math.hypot(car.x - shadowAt.x, car.z - shadowAt.z) > 40)) return; shadowAt = { x: car.x, z: car.z }; shadowsDue = false;
    view.center.set(car.x, 0, car.z); view.span = 110; view.setTime(minute()); haze(); }
  view.resize(); around(); sunNow(true);
  view.start((dt, now) => {
    if (dead) return; drive(dt);
    me.position.set(car.x, 0, car.z); me.rotation.y = car.a - Math.PI / 2; for (const w of me.userData.wheels || []) w.rotation.x -= car.v * dt / 0.33;
    chase(dt); crowd(now, dt); ground.position.set(Math.round(car.x / 50) * 50, -0.08, Math.round(car.z / 50) * 50);
    if (now - chk > 600) { chk = now; around(); }
    if (queue.length) { const [bx, by] = queue.shift().split(',').map(Number); if (opts.loaded(bx + B / 2, by + B / 2) || opts.loaded(bx, by)) build(bx, by); else queue.push(bx + ',' + by); }
    if (now - timeAt > 20000) { timeAt = now; shadowsDue = true; } sunNow(false);
    if (now - sent > 250) { sent = now; opts.onMove(car.x / TILE, car.z / TILE, car.a, car.v / TILE); }
    if (now - nearAt > 300) { nearAt = now; let b = null; const fx = car.x + Math.cos(car.a) * 3, fz = car.z - Math.sin(car.a) * 3;
      if (Math.abs(car.v) < 5) { let bd = 7; for (const s of solidsNear(car.x, car.z)) { if (!s.id || !s.r) continue; const dx = Math.max(s.r[0] - fx, 0, fx - s.r[2]), dz = Math.max(s.r[1] - fz, 0, fz - s.r[3]), d = Math.hypot(dx, dz); if (d < bd) { bd = d; b = s.id; } } }
      if (b !== nearId) { nearId = b; opts.onNear(b ? opts.byId(b) : null); } }
    frames++; spent += dt; if (frames >= 120) { const fps = frames / spent; frames = 0; spent = 0; if (fps < 24 && RAD > 1) { RAD--; haze(); around(); } } /* can't keep up: one block less far */
  });
  const refresh = setInterval(() => { if (!dead) for (const k of blocks.keys()) if (!queue.includes(k)) queue.push(k); }, 8000); /* pick up changes to the town */

  // ---- controls: a stick on phones (forward and back, left and right), the arrow keys or WASD on computers ----
  const stick = document.createElement('div'); stick.className = 'tjoy'; stick.innerHTML = '<i></i>'; host.append(stick); const knob = stick.firstChild; let jid = null;
  const jmove = e => { const r = stick.getBoundingClientRect(), R = r.width / 2; let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`; };
  stick.addEventListener('pointerdown', e => { e.preventDefault(); jid = e.pointerId; stick.setPointerCapture(jid); jmove(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === jid) jmove(e); });
  const jend = () => { jid = null; joy.x = joy.y = 0; knob.style.transform = ''; }; stick.addEventListener('pointerup', jend); stick.addEventListener('pointercancel', jend);
  const keyOf = e => e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const kd = e => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; const k = keyOf(e); if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(k)) { keys.add(k); e.preventDefault(); } };
  const ku = e => keys.delete(keyOf(e)), kb = () => keys.clear();
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', kb); addEventListener('resize', view.resize);
  canvas.addEventListener('webglcontextlost', () => { setTimeout(() => { if (!dead && renderer.getContext().isContextLost()) opts.onLost && opts.onLost(); }, 8000); }); /* the view tries to come back by itself first */

  return {
    get pos() { return { x: car.x / TILE, y: car.z / TILE, a: car.a, v: car.v / TILE }; },
    kmh() { return Math.round(Math.abs(car.v) * 3.6); },
    stats() { return { ...stats, blocks: blocks.size, people: folk.size, radius: RAD, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
    toggleView() { high = high ? 0 : 1; return high; },
    stop() { car.v = 0; },
    dispose() { dead = true; clearInterval(refresh); view.stop(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', kb); removeEventListener('resize', view.resize);
      for (const v of blocks.values()) drop(v); blocks.clear(); for (const f of folk.values()) scene.remove(f.g); folk.clear();
      ground.geometry.dispose(); ground.material.dispose(); try { view.dispose(); } catch (e) {} try { renderer.forceContextLoss(); } catch (e) {} canvas.remove(); stick.remove(); },
  };
}
