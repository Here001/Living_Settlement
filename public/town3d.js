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
  const keys = new Set(), inp = { thr: 0, steer: 0 }; let ctl = opts.controls || { layout: 'stick' }; /* inp: from the on-screen controls (steer +1 = left) */
  function drive(dt) {
    const K = ctl.keys || {}, on = (a, d) => keys.has(d) || keys.has(String(K[a] || '').toLowerCase());
    const up = (on('up', 'ArrowUp') ? 1 : 0) - (on('down', 'ArrowDown') ? 1 : 0) + inp.thr, turn = (on('left', 'ArrowLeft') ? 1 : 0) - (on('right', 'ArrowRight') ? 1 : 0) + inp.steer;
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

  // ---- the camera: behind the car, from the driver's seat, or higher up; drag anywhere to look round as you drive ----
  let mode = 0; const cam = new THREE.Vector3(car.x - Math.cos(car.a) * 9, 3.6, car.z + Math.sin(car.a) * 9), look = new THREE.Vector3();
  const lk = { yaw: 0, pitch: 0, id: null, x: 0, y: 0, at: 0 };
  // the driver's seat: a dashboard and a steering wheel that turns as you steer (the car's body is hidden in there)
  const cockpit = new THREE.Group(), dashM = new THREE.MeshStandardMaterial({ color: '#23252a', roughness: 0.7 }), wheelM = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.5 });
  { const dash = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.7), dashM); dash.position.set(0, -0.66, -0.95); cockpit.add(dash);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 1.6), new THREE.MeshStandardMaterial({ color: opts.car.col || '#c8382e', roughness: 0.3, metalness: 0.5 })); hood.position.set(0, -0.5, -2.0); hood.rotation.x = 0.08; cockpit.add(hood);
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), new THREE.MeshBasicMaterial({ color: '#9fe3ff' })); gauge.position.set(-0.3, -0.42, -0.72); gauge.rotation.x = -0.45; cockpit.add(gauge); }
  const sw = new THREE.Group(); sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.026, 10, 32), wheelM)); for (const a of [0, 2.1, 4.2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.19, 0.02), wheelM); sp.position.set(Math.sin(a) * 0.095, Math.cos(a) * 0.095, 0); sp.rotation.z = -a; sw.add(sp); }
  sw.position.set(0, -0.36, -0.58); sw.rotation.x = -0.32; cockpit.add(sw); cockpit.visible = false; camera.add(cockpit); scene.add(camera);
  function chase(dt) {
    if (lk.id == null && now0() - lk.at > 1500 && Math.abs(car.v) > 2) { lk.yaw *= Math.pow(0.15, dt); lk.pitch *= Math.pow(0.15, dt); } /* let go: the view comes back round to the road */
    const fp = mode === 1; me.visible = !fp; cockpit.visible = fp; sw.rotation.z = car.steer * 1.4;
    if (fp) { const a = car.a + lk.yaw; camera.position.set(car.x + Math.cos(car.a) * 0.15 - Math.sin(car.a) * 0.36, 1.18, car.z - Math.sin(car.a) * 0.15 - Math.cos(car.a) * 0.36); /* the driver's seat, on the left */
      look.set(camera.position.x + Math.cos(a) * 10, 1.18 + Math.tan(lk.pitch - 0.04) * 10, camera.position.z - Math.sin(a) * 10); camera.lookAt(look); cam.copy(camera.position); view.cut.R.value = 0; }
    else { const high = mode === 2, a = car.a + lk.yaw, back = high ? 26 : 9, up = (high ? 18 : 3.4) + lk.pitch * -8, tx = car.x - Math.cos(a) * back, tz = car.z + Math.sin(a) * back, k = Math.min(1, dt * (lk.id != null ? 10 : 3.2));
      cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k; cam.y += (Math.max(1.2, up) - cam.y) * k; camera.position.copy(cam);
      look.set(car.x + Math.cos(car.a) * (lk.id != null ? 0 : 6), 1.2, car.z - Math.sin(car.a) * (lk.id != null ? 0 : 6)); camera.lookAt(look);
      view.cut.A.value.set(car.x, 1.0, car.z); view.cut.B.value.copy(camera.position); view.cut.R.value = high ? 6 : 3.5; }
    if (bump > 0) { bump -= dt; camera.position.y += Math.sin(bump * 60) * 0.08; } }
  const now0 = () => performance.now();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { if (lk.id != null) return; lk.id = e.pointerId; lk.x = e.clientX; lk.y = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== lk.id) return; lk.yaw = Math.max(-Math.PI, Math.min(Math.PI, lk.yaw - (e.clientX - lk.x) * 0.006)); lk.pitch = Math.max(-0.5, Math.min(0.45, lk.pitch - (e.clientY - lk.y) * 0.004)); lk.x = e.clientX; lk.y = e.clientY; });
  const lkEnd = e => { if (e.pointerId === lk.id) { lk.id = null; lk.at = now0(); } }; canvas.addEventListener('pointerup', lkEnd); canvas.addEventListener('pointercancel', lkEnd);
  canvas.addEventListener('dblclick', () => { lk.yaw = 0; lk.pitch = 0; });

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
  let sent = 0, nearAt = 0, nearId = null, chk = 0, timeAt = 0, shadowAt = { x: 1e9, z: 1e9 }, shadowsDue = true, frames = 0, spent = 0, dead = false;
  const minute = () => (opts.minute ? opts.minute() : 720);
  function sunNow(force) { if (!(force || shadowsDue || Math.hypot(car.x - shadowAt.x, car.z - shadowAt.z) > 40)) return; shadowAt = { x: car.x, z: car.z }; shadowsDue = false;
    view.center.set(car.x, 0, car.z); view.span = 110; view.setTime(minute()); haze(); }
  view.resize(); around(); sunNow(true);
  view.start((dt, now) => {
    if (dead) return; drive(dt);
    me.position.set(car.x, 0, car.z); me.rotation.y = car.a - Math.PI / 2; for (const w of me.userData.wheels || []) w.rotation.x -= car.v * dt / 0.33;
    chase(dt); crowd(now, dt); routeMat.opacity = 0.6 + 0.3 * Math.sin(now / 250); ground.position.set(Math.round(car.x / 50) * 50, -0.08, Math.round(car.z / 50) * 50);
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

  // ---- controls on screen, in the layout picked in Settings: a stick; pedals and steer buttons; or a steering wheel and
  // pedals (steering on the left unless it's swapped). The arrow keys and the keys picked in Settings always work too.
  let pad = null;
  function controls() { if (pad) pad.remove(); inp.thr = inp.steer = 0; const lay = ctl.layout || 'stick'; pad = document.createElement('div'); pad.className = 'tpad ' + lay + (ctl.swap ? ' swap' : ''); host.append(pad);
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
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', kb); addEventListener('resize', view.resize);
  canvas.addEventListener('webglcontextlost', () => { setTimeout(() => { if (!dead && renderer.getContext().isContextLost()) opts.onLost && opts.onLost(); }, 8000); }); /* the view tries to come back by itself first */

  return {
    get pos() { return { x: car.x / TILE, y: car.z / TILE, a: car.a, v: car.v / TILE }; },
    kmh() { return Math.round(Math.abs(car.v) * 3.6); },
    stats() { return { ...stats, blocks: blocks.size, people: folk.size, radius: RAD, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
    toggleView() { mode = (mode + 1) % 3; lk.yaw = lk.pitch = 0; return ['behind', 'driver', 'above'][mode]; },
    setControls(c) { ctl = c || ctl; controls(); },
    setRoute,
    stop() { car.v = 0; },
    dispose() { dead = true; clearInterval(refresh); view.stop(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', kb); removeEventListener('resize', view.resize);
      for (const v of blocks.values()) drop(v); blocks.clear(); for (const f of folk.values()) scene.remove(f.g); folk.clear();
      ground.geometry.dispose(); ground.material.dispose(); try { view.dispose(); } catch (e) {} try { renderer.forceContextLoss(); } catch (e) {} canvas.remove(); if (pad) pad.remove(); chevron.dispose(); routeMat.dispose(); beamMat.dispose(); },
  };
}
