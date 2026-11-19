// Watching the races at a Racetrack, in 3D: the oval with its rails and chequered line, the grandstand with the people
// who bought a ticket, the scoreboard, floodlights and flags, and the creatures themselves running the race everyone
// sees (where each one is comes from the page: the same race, the same moment, for every viewer).
//
// createTrack(host, opts) opts: grand (a Grand racecourse: bigger), minute() (the colony's time of day),
//   runners() → [{ id, p (0…1 round the lap), lane, n, run }], people() → [{ id, look }] (in the stands),
//   board() → [lines] (the scoreboard). Returns { view(mode) → the camera mode, stats(), close() }.
import * as THREE from 'three';
import * as W from '/world3d.js';
import { build, follower } from '/creature3d.js';

export function createTrack(host, opts) {
  const canvas = document.createElement('canvas'); canvas.className = 'track3d'; host.append(canvas);
  const view = W.createView(canvas), { scene, camera, renderer } = view; camera.fov = 50; camera.near = 0.3; camera.far = 900; camera.updateProjectionMatrix();
  const G = opts.grand ? 1.45 : 1, RX = 46 * G, RZ = 24 * G, WID = 10 * G, SEATS = opts.grand ? 60 : 30;
  view.center.set(0, 0, 0); view.span = 120 * G;
  const std = (c, r = 0.85, m = 0) => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }); view.mats.push(x); return x; };
  const add = (g, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
  // ---- the ground and the oval ----
  const tex = (draw, n = 256) => { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const grassT = tex((g, n) => { g.fillStyle = '#6FA84B'; g.fillRect(0, 0, n, n); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${40 + Math.random() * 60},${110 + Math.random() * 70},${30 + Math.random() * 30},.35)`; g.fillRect(Math.random() * n, Math.random() * n, 2, 2); } });
  const dirtT = tex((g, n) => { g.fillStyle = '#C49A63'; g.fillRect(0, 0, n, n); for (let i = 0; i < 3500; i++) { const k = Math.random(); g.fillStyle = `rgba(${150 + k * 70},${110 + k * 50},${70 + k * 30},.4)`; g.fillRect(Math.random() * n, Math.random() * n, 2 + Math.random() * 2, 1 + Math.random()); } });
  grassT.repeat.set(60, 60); const ground = add(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 }), 0, -0.02, 0); ground.rotation.x = -Math.PI / 2; ground.castShadow = false; view.mats.push(ground.material);
  const ell = (rx, rz, n = 160) => { const s = new THREE.Shape(); for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; i ? s.lineTo(Math.cos(a) * rx, Math.sin(a) * rz) : s.moveTo(Math.cos(a) * rx, Math.sin(a) * rz); } return s; };
  { const s = ell(RX + WID / 2, RZ + WID / 2), hole = new THREE.Path(); for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; i ? hole.lineTo(Math.cos(a) * (RX - WID / 2), Math.sin(a) * (RZ - WID / 2)) : hole.moveTo(Math.cos(a) * (RX - WID / 2), Math.sin(a) * (RZ - WID / 2)); } s.holes.push(hole);
    const g = new THREE.ShapeGeometry(s, 4); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 6, uv.getY(i) / 6); dirtT.repeat.set(1, 1);
    const m = new THREE.MeshStandardMaterial({ map: dirtT, roughness: 1 }); view.mats.push(m); const o = add(g, m, 0, 0.02, 0); o.castShadow = false;
    const inf = new THREE.ShapeGeometry(ell(RX - WID / 2, RZ - WID / 2), 4); inf.rotateX(-Math.PI / 2); const im = new THREE.MeshStandardMaterial({ color: '#7DBA55', roughness: 1 }); view.mats.push(im); add(inf, im, 0, 0.03, 0).castShadow = false;
    /* stripes mown into the infield, a pond and flower beds */ for (let i = -3; i <= 3; i += 2) { const st = new THREE.Mesh(new THREE.PlaneGeometry((RX - WID / 2) * 1.5, (RZ - WID / 2) * 0.22), std('#89C562', 1)); st.rotation.x = -Math.PI / 2; st.position.set(0, 0.035, i * (RZ - WID / 2) * 0.2); scene.add(st); }
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: '#4B8FB8', roughness: 0.08, metalness: 0.3 })); view.mats.push(pond.material); pond.scale.set(RX * 0.18, RZ * 0.22, 1); pond.rotation.x = -Math.PI / 2; pond.position.set(-RX * 0.35, 0.04, 0); scene.add(pond);
    for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2; add(new THREE.SphereGeometry(0.5, 8, 6), std(['#E4572E', '#F2C94C', '#D98BA8', '#FFFFFF'][i % 4], 0.8), RX * 0.35 + Math.cos(a) * RX * 0.12, 0.25, Math.sin(a) * RZ * 0.25); } }
  // the rails: white, round both edges, on posts
  for (const r of [-WID / 2 - 0.3, WID / 2 + 0.3]) { const pts = []; for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * (RX + r), 1.05, Math.sin(a) * (RZ + r))); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 240, 0.09, 6, true), std('#F4F4F2', 0.4), 0, 0, 0);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.05, 6), std('#E8E8E4', 0.5), 120); posts.castShadow = true; const M4 = new THREE.Matrix4();
    pts.forEach((p, i) => { M4.makeTranslation(p.x, 0.52, p.z); posts.setMatrixAt(i, M4); }); scene.add(posts); }
  // the chequered finish line, across the home straight (where the race starts and ends)
  { const t = tex((g, n) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * n / 2, y * n / 8, n / 2, n / 8); } }, 64); t.repeat.set(1, 1);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); view.mats.push(m); const o = add(new THREE.PlaneGeometry(1.2, WID), m, 0, 0.05, RZ); o.rotation.x = -Math.PI / 2; o.castShadow = false;
    for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), std('#2B2621', 0.5), 0, 3, RZ + s * (WID / 2 + 0.8)); } add(new THREE.BoxGeometry(0.4, 0.8, WID + 2), std('#C0392B', 0.5), 0, 6, RZ); } /* the gantry over the line */
  // ---- the grandstand: tiers of seats along the home straight, a roof, a scoreboard ----
  const STAND_Z = RZ + WID / 2 + 6, rows = opts.grand ? 7 : 5, perRow = Math.ceil(SEATS / rows), standW = Math.max(28, perRow * 1.4 + 6) * (opts.grand ? 1.2 : 1), seats = [];
  for (let r = 0; r < rows; r++) { const y = 0.6 + r * 0.9, z = STAND_Z + r * 1.4; add(new THREE.BoxGeometry(standW, 0.9 + r * 0.9, 1.4), std('#B9B3A8', 0.9), 0, (0.9 + r * 0.9) / 2, z);
    const bench = add(new THREE.BoxGeometry(standW - 2, 0.12, 0.5), std(opts.colour || '#B5523B', 0.6), 0, y + 0.46, z - 0.25); bench.castShadow = false;
    for (let i = 0; i < perRow; i++) seats.push(new THREE.Vector3(-((perRow - 1) / 2) * 1.4 + i * 1.4, y + 0.5, z - 0.2)); }
  const back = STAND_Z + rows * 1.4 + 0.4, roofY = 0.6 + rows * 0.9 + 3.4;
  add(new THREE.BoxGeometry(standW + 2, roofY, 0.4), std('#8C857A', 0.9), 0, roofY / 2, back);
  for (const x of [-standW / 2, 0, standW / 2]) add(new THREE.CylinderGeometry(0.18, 0.18, roofY, 8), std('#5A5550', 0.5, 0.4), x, roofY / 2, STAND_Z - 1.2);
  const roof = add(new THREE.BoxGeometry(standW + 3, 0.3, rows * 1.4 + 3), std(opts.colour || '#B5523B', 0.6), 0, roofY, STAND_Z + rows * 0.7 - 0.6); roof.rotation.x = -0.06;
  // the scoreboard, facing the stand from the far side of the infield (its words drawn on a canvas)
  const sbC = document.createElement('canvas'); sbC.width = 512; sbC.height = 256; const sbT = new THREE.CanvasTexture(sbC); sbT.colorSpace = THREE.SRGBColorSpace;
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ map: sbT, toneMapped: false })); sb.position.set(0, 9, -RZ - WID / 2 - 8); scene.add(sb); view.mats.push(sb.material);
  add(new THREE.BoxGeometry(16.8, 8.8, 0.6), std('#1d1f24', 0.6), 0, 9, -RZ - WID / 2 - 8.4); for (const x of [-6, 6]) add(new THREE.BoxGeometry(0.6, 5, 0.6), std('#3a3d44', 0.6), x, 2.5, -RZ - WID / 2 - 8.4);
  let sbKey = ''; const paintBoard = () => { const L = (opts.board && opts.board()) || [], key = L.join('|'); if (key === sbKey) return; sbKey = key; const g = sbC.getContext('2d');
    g.fillStyle = '#0d0f14'; g.fillRect(0, 0, 512, 256); g.fillStyle = '#F2C94C'; g.font = '800 38px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(L[0] || '', 256, 54);
    g.font = '700 30px system-ui, sans-serif'; L.slice(1, 5).forEach((l, i) => { g.fillStyle = i ? '#E8F4FF' : '#7FF0A0'; g.fillText(l, 256, 104 + i * 42); }); sbT.needsUpdate = true; };
  // floodlights and flags round the outside
  for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * Math.PI * 2, x = Math.cos(a) * (RX + WID + 8), z = Math.sin(a) * (RZ + WID + 8); if (z > RZ) continue;
    add(new THREE.CylinderGeometry(0.25, 0.35, 18, 8), std('#5A5550', 0.5, 0.4), x, 9, z); add(new THREE.BoxGeometry(3, 1.4, 0.5), std('#2B2621', 0.6), x, 18, z).lookAt(0, 0, 0);
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), new THREE.MeshBasicMaterial({ color: '#FFF6D8', toneMapped: false })); lamp.position.set(x * 0.985, 18, z * 0.985); lamp.lookAt(0, 0, 0); scene.add(lamp); view.mats.push(lamp.material); }
  const flags = []; for (let i = 0; i < 8; i++) { const x = -standW / 2 + i * standW / 7; add(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), std('#E8E8E4', 0.4), x, roofY + 2, back);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1, 6, 1), new THREE.MeshStandardMaterial({ color: ['#E4572E', '#2E86C1', '#F2C94C', '#27AE60'][i % 4], side: THREE.DoubleSide, roughness: 0.7 })); view.mats.push(f.material); f.position.set(x + 0.8, roofY + 3.4, back); scene.add(f); flags.push(f); }
  // trees round the edge
  { const trunk = std('#7A5233', 0.9), leaves = std('#3E7A4B', 0.9); for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, r = 1 + 0.25 + (i % 3) * 0.06, x = Math.cos(a) * (RX + WID) * r * 1.15, z = Math.sin(a) * (RZ + WID) * r * 1.45; if (z > RZ + WID / 2 && Math.abs(x) < standW / 2 + 6) continue;
      add(new THREE.CylinderGeometry(0.3, 0.4, 3, 6), trunk, x, 1.5, z); add(new THREE.IcosahedronGeometry(2.4, 0), leaves, x, 4.6, z); } }
  // ---- the people in the stands (the nearest seats first), and the runners ----
  const crowd = new Map(); let crowdKey = '';
  function seatPeople() { const L = (opts.people && opts.people()) || [], key = L.map(p => p.id + (p.look ? 'L' : '') + (others.has(p.id) ? 'W' : '')).join(','); if (key === crowdKey) return; crowdKey = key; const keep = new Set();
    L.slice(0, SEATS).forEach((p, i) => { if (others.has(p.id) || p.id === opts.meId) return; keep.add(p.id); /* (someone walking about here shows as themselves, not in a seat too) */ let c = crowd.get(p.id); if (c && !!c.look !== !!p.look) { scene.remove(c.P.group); crowd.delete(p.id); c = null; }
      if (!c) { const P = W.makePerson(p.id, null, p.look || null); const A = P.av || P; if (A.pose) A.pose('sit'); P.group.rotation.y = Math.PI; scene.add(P.group); c = { P, look: !!p.look }; crowd.set(p.id, c); }
      const s = seats[(i * 7) % seats.length] || seats[0]; c.P.group.position.set(s.x, s.y - 0.48, s.z); });
    for (const [id, c] of crowd) if (!keep.has(id)) { scene.remove(c.P.group); crowd.delete(id); } }
  const runners = new Map(); let lead = null;
  const laneR = (lane, n) => { const inset = (n - 1 - Math.min(lane, n - 1) + 0.5) / Math.max(1, n) - 0.5; return inset * WID * 0.82; };
  const at = (p, lane, n) => { const a = Math.PI / 2 - p * Math.PI * 2, o = laneR(lane, n); return [Math.cos(a) * (RX + o), Math.sin(a) * (RZ + o)]; };
  function placeRunners(dt) { const L = (opts.runners && opts.runners()) || [], seen = new Set(); let best = null;
    for (const r of L) { seen.add(r.id); let R = runners.get(r.id); if (!R) { R = { C: build(r.id, { scale: 1.7 }), p: r.p }; R.C.group.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(R.C.group); runners.set(r.id, R); }
      const dp = r.p - R.p; R.p = r.p; const [x, z] = at(r.p, r.lane, r.n), [x2, z2] = at(Math.min(1, r.p + 0.004), r.lane, r.n); R.C.group.position.set(x, 0.04, z); R.C.group.rotation.y = Math.atan2(x2 - x, z2 - z);
      const speed = r.run ? Math.max(4, Math.abs(dp) * 2 * Math.PI * Math.sqrt((RX * RX + RZ * RZ) / 2) / Math.max(dt, 1e-3)) : 0; R.C.animate(dt, Math.min(18, speed));
      if (!best || r.p > best.p) best = { ...r, x, z, a: R.C.group.rotation.y }; }
    for (const [id, R] of runners) if (!seen.has(id)) { scene.remove(R.C.group); R.C.dispose(); runners.delete(id); } lead = best; }
  // ---- you, walking about as yourself (and your pet), like inside any place: the stick (or WASD) walks, dragging the
  // screen looks round; you can't step onto the dirt while it's a racetrack, and the stand's tiers lift you as you climb ----
  const me = { x: (Math.random() - 0.5) * standW * 0.8, z: STAND_Z - 2.2 - Math.random() * 2.2, /* (somewhere along the front of the stand: not all on one spot) */ y: 0, yaw: 0, pitch: -0.12, sit: false, P: W.makePerson('me', null, opts.look || null) }; scene.add(me.P.group); me.P.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  let myPet = null; if (opts.pet) { try { myPet = follower(opts.pet); scene.add(myPet.group); } catch (e) {} }
  const OUT = [RX + WID / 2 + 0.7, RZ + WID / 2 + 0.7], EDGE = [RX + WID / 2 + 42, RZ + WID / 2 + 42];
  const tierY = (x, z) => (Math.abs(x) < standW / 2 && z > STAND_Z - 0.7 && z < back + 0.2) ? 0.9 + Math.min(rows - 1, Math.floor((z - (STAND_Z - 0.7)) / 1.4)) * 0.9 : 0; /* (the top tier runs back to the wall) */
  const free = (x, z) => { if ((x / OUT[0]) ** 2 + (z / OUT[1]) ** 2 < 1) return false; if ((x / EDGE[0]) ** 2 + (z / EDGE[1]) ** 2 > 1) return false; if (Math.abs(x) < standW / 2 + 1.2 && z > back - 0.4 && z < back + 0.6) return false; return true; };
  const keys = new Set(), joy = { x: 0, y: 0 }; const kd = e => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; keys.add(e.key.toLowerCase()); }, ku = e => keys.delete(e.key.toLowerCase()); addEventListener('keydown', kd); addEventListener('keyup', ku);
  const stick = document.createElement('div'); stick.className = 'hjoy'; stick.innerHTML = '<i></i>'; host.append(stick); { let id = null; const knob = stick.firstChild;
    const mv = e => { const r = stick.getBoundingClientRect(), Rr = r.width / 2; let dx = (e.clientX - r.left - Rr) / Rr, dy = (e.clientY - r.top - Rr) / Rr; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * Rr * 0.6}px,${dy * Rr * 0.6}px)`; };
    stick.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; stick.setPointerCapture(id); mv(e); }); stick.addEventListener('pointermove', e => { if (e.pointerId === id) mv(e); });
    const end = () => { id = null; joy.x = joy.y = 0; knob.style.transform = ''; }; stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end); }
  const lk = { id: null, x: 0, y: 0 }; canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { if (lk.id != null) return; lk.id = e.pointerId; lk.x = e.clientX; lk.y = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== lk.id) return; me.yaw -= (e.clientX - lk.x) * 0.006; me.pitch = Math.max(-1.1, Math.min(1.1, me.pitch - (e.clientY - lk.y) * 0.004)); lk.x = e.clientX; lk.y = e.clientY; });
  const lkEnd = e => { if (e.pointerId === lk.id) lk.id = null; }; canvas.addEventListener('pointerup', lkEnd); canvas.addEventListener('pointercancel', lkEnd);
  let sitAt = null; const nearBench = () => { const ty = tierY(me.x, me.z); return ty > 0 ? ty : 0; };
  function sitDown() { const ty = nearBench(); if (!ty) return false; const row = Math.round((ty - 0.9) / 0.9), z = STAND_Z + row * 1.4 - 0.2; me.sit = true; me.x = Math.max(-standW / 2 + 1.2, Math.min(standW / 2 - 1.2, me.x)); me.z = z; me.yaw = 0; sitAt = 0.6 + row * 0.9 + 0.5 - 0.48;
    const A = me.P.av || me.P; if (A.pose) A.pose('sit'); return true; }
  function standUp() { if (!me.sit) return; me.sit = false; sitAt = null; const A = me.P.av || me.P; if (A.pose) A.pose('stand'); me.z -= 0.6; }
  let moved = 0;
  function walkMe(dt) { const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - joy.y, st = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + joy.x, m = Math.min(1, Math.hypot(f, st));
    if (m > 0.08 && me.sit) standUp();
    if (m > 0.08) { const sp = 3.2 * m, fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), rx = -fz, rz = fx, dx = (fx * f + rx * st) / Math.max(1, Math.hypot(f, st)) * sp * dt, dz = (fz * f + rz * st) / Math.max(1, Math.hypot(f, st)) * sp * dt;
      if (free(me.x + dx, me.z)) me.x += dx; if (free(me.x, me.z + dz)) me.z += dz; moved += Math.hypot(dx, dz); me.P.animate(dt, dx / dt, dz / dt); }
    else if (!me.sit) me.P.animate(dt, 0, 0);
    const ty = me.sit ? sitAt : tierY(me.x, me.z); me.y += (ty - me.y) * Math.min(1, dt * 12); me.P.setPos(me.x, me.z); me.P.group.position.y = me.y; if (me.sit) me.P.group.rotation.y = Math.PI;
    if (myPet) { myPet.step(dt, me.x, me.z); myPet.group.position.y = me.sit ? 0 : me.y; }
    if (opts.onMove && moved > 0.15) { moved = 0; opts.onMove(me.x, me.z, me.P.group.rotation.y, me.sit ? 's' : ''); } }
  // ---- other people here: they walk (or sit) where they say they are, with their name over them and their pet ----
  const others = new Map();
  function upsertOther(id, p) { let o = others.get(id); if (o && p.look && !o.look) { scene.remove(o.P.group); if (o.tag) o.tag.material.map.dispose(); others.delete(id); o = null; }
    if (!o) { const P = W.makePerson(id, null, p.look || null); scene.add(P.group); const tag = W.nameTag(p.h ? '@' + p.h : 'a visitor'); tag.scale.set(1.6, 0.4, 1); tag.position.set(0, 2.15, 0); P.group.add(tag); o = { P, look: !!p.look, x: p.x, z: p.z, tx: p.x, tz: p.z, a: p.a || 0, sit: false, tag }; P.setPos(p.x, p.z); others.set(id, o); }
    o.tx = p.x; o.tz = p.z; o.a = p.a || 0; const s2 = p.pose === 's'; if (s2 !== o.sit) { o.sit = s2; const A = o.P.av || o.P; if (A.pose) A.pose(s2 ? 'sit' : 'stand'); } }
  function removeOther(id) { const o = others.get(id); if (!o) return; scene.remove(o.P.group); if (o.pet) o.pet.dispose(); others.delete(id); }
  function setPet(id, kind) { const o = others.get(id); if (!o || (o.pet && o.pet.kind === kind)) return; if (o.pet) { o.pet.dispose(); o.pet = null; } if (kind) try { o.pet = follower(kind, { side: -1 }); o.pet.kind = kind; scene.add(o.pet.group); } catch (e) {} }
  function stepOthers(dt) { const k = Math.min(1, dt * 6); for (const o of others.values()) { const dx = o.tx - o.x, dz = o.tz - o.z; o.x += dx * k; o.z += dz * k; o.P.setPos(o.x, o.z); o.P.group.position.y = o.sit ? tierY(o.x, o.z + 0.2) - 0.28 : tierY(o.x, o.z);
      if (o.sit) o.P.group.rotation.y = Math.PI; else o.P.animate(dt, dx * k / Math.max(dt, 1e-3), dz * k / Math.max(dt, 1e-3)); if (o.pet) o.pet.step(dt, o.x, o.z); } }
  // what someone says shows over their head for a few seconds
  const bubbles = new Map();
  function say(id, text) { const on = id === 'me' ? me.P.group : others.get(id)?.P.group; if (!on) return; const old = bubbles.get(id); if (old) { old.sp.parent && old.sp.parent.remove(old.sp); old.sp.material.map.dispose(); }
    const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 512; c.height = 128; g.font = '600 34px sans-serif'; const t = String(text).length > 60 ? String(text).slice(0, 58) + '…' : String(text), w = Math.min(500, g.measureText(t).width + 40);
    g.fillStyle = 'rgba(255,255,255,.96)'; if (g.roundRect) { g.beginPath(); g.roundRect((512 - w) / 2, 20, w, 80, 24); g.fill(); } else g.fillRect((512 - w) / 2, 20, w, 80); g.fillStyle = '#1C1C1E'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 256, 60);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })); sp.scale.set(2.6, 0.65, 1); sp.position.set(0, 2.6, 0); sp.renderOrder = 6; on.add(sp); bubbles.set(id, { sp, until: performance.now() + 7000 }); }
  // ---- the camera: behind you, through your eyes, from the stands (turning to follow the leader), behind the leader, or from above ----
  const MODES = ['third', 'first', 'stand', 'follow', 'above']; let mode = 'third', aim = new THREE.Vector3(0, 0, 0); const eye = new THREE.Vector3(-standW * 0.28, 9.5 * G, STAND_Z - 2); /* (along the stand from the finish-line gantry) */
  function placeCamera(dt) { const k = Math.min(1, dt * 4), tgt = new THREE.Vector3(), pos = new THREE.Vector3(), fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    me.P.group.visible = mode !== 'first';
    if (mode === 'first') { pos.set(me.x, me.y + (me.sit ? 1.15 : 1.62), me.z); tgt.set(me.x + fx * 10, me.y + 1.6 + Math.tan(me.pitch) * 10, me.z + fz * 10); camera.position.copy(pos); aim.copy(tgt); }
    else if (mode === 'third') { const dist = 4.6, up = 2.3 - me.pitch * 2.2; pos.set(me.x - fx * dist, me.y + Math.max(0.8, up), me.z - fz * dist); if (Math.abs(pos.x) < standW / 2 + 1.5 && pos.z > back - 0.7 && me.z < back) pos.z = back - 0.7; pos.y = Math.min(roofY - 0.6, Math.max(pos.y, tierY(pos.x, pos.z) + 1.4)); /* (in the stand: above the step behind you and in front of the back wall, under the roof) */ tgt.set(me.x + fx * 3, me.y + 1.4 + Math.tan(Math.max(0, me.pitch)) * 6, me.z + fz * 3); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else if (mode === 'follow' && lead) { pos.set(lead.x - Math.sin(lead.a) * 13, 6, lead.z - Math.cos(lead.a) * 13); tgt.set(lead.x + Math.sin(lead.a) * 3, 1, lead.z + Math.cos(lead.a) * 3); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else if (mode === 'above') { pos.set(0, 70 * G, RZ * 1.6); tgt.set(0, 0, 0); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else { camera.position.copy(eye); tgt.set(lead ? lead.x : 0, 0.5, lead ? lead.z * 0.85 : 0); aim.lerp(tgt, k); }
    camera.lookAt(aim); const fov = mode === 'stand' ? 40 : 55; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); } }
  let tSb = 0; view.resize(); view.setTime(opts.minute ? opts.minute() : 720);
  view.start((dt, now) => { walkMe(dt); stepOthers(dt); placeRunners(dt); placeCamera(dt); for (const f of flags) { const p = f.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.8; p.setZ(i, Math.sin(now / 300 + x * 3 + f.position.x) * 0.12 * x); } p.needsUpdate = true; }
    for (const [id, b] of bubbles) if (performance.now() > b.until) { b.sp.parent && b.sp.parent.remove(b.sp); b.sp.material.map.dispose(); bubbles.delete(id); }
    tSb += dt; if (tSb > 0.5) { tSb = 0; paintBoard(); seatPeople(); view.setTime(opts.minute ? opts.minute() : 720); if (opts.onTick) opts.onTick(); } });
  const onResize = () => view.resize(); addEventListener('resize', onResize);
  return { view(m) { mode = m || MODES[(MODES.indexOf(mode) + 1) % MODES.length]; return mode; }, stats() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, runners: runners.size, crowd: crowd.size, others: others.size, cam: camera.position.toArray().map(v => +v.toFixed(2)), aim: aim.toArray().map(v => +v.toFixed(2)), mode, back, roofY, STAND_Z }; },
    get me() { return { x: me.x, z: me.z, a: me.P.group.rotation.y, sit: me.sit, bench: !!nearBench() }; }, sit() { if (me.sit) { standUp(); return false; } return sitDown(); },
    upsertOther, removeOther, setPet, say, near(r) { let n = 0; for (const o of others.values()) if (Math.hypot(o.x - me.x, o.z - me.z) <= r) n++; return n; },
    close() { removeEventListener('resize', onResize); removeEventListener('keydown', kd); removeEventListener('keyup', ku); stick.remove(); if (myPet) myPet.dispose(); for (const R of runners.values()) R.C.dispose(); view.dispose(); canvas.remove(); } };
}
