// The racecourse's scenery: everything that makes a Racetrack worth walking round, drawn so a phone stays cool.
//
// How it stays cheap: everything that doesn't move is merged into one mesh per material (a handful of draws for
// hundreds of pieces); things repeated many times (trees, seats, flowers, posts, bunting, reeds) are instanced (one
// draw each); textures are small and painted on a canvas here (nothing to download); only the big things cast
// shadows; the few moving things (the fountain, the balloons, the bunting's flutter) move on the graphics chip or with
// a couple of numbers a frame. Nothing here adds a light: lamps glow with their own colour after dark.
//
// decorate(view, P) P: { G, RX, RZ, WID, STAND_Z, rows, standW, back, roofY, colour, EDGE: [ex, ez] }.
// Returns { colliders: [{ x, z, r } | { x0, z0, x1, z1 }], update(dt, now) }.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function decorate(view, P) {
  const { scene } = view, { G, RX, RZ, WID, STAND_Z, rows, standW, back, roofY } = P, [EX, EZ] = P.EDGE, colour = P.colour || '#B5523B';
  const colliders = [], movers = [];
  const tex = (draw, n = 256, rep = true) => { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const mat = (o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.85, ...o }); view.mats.push(m); return m; };
  // ---- merging: pieces go into a bucket per material, each one placed (moved, turned, scaled) as it goes in ----
  const buckets = new Map(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S3 = new THREE.Vector3();
  const put = (m, geo, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => { const g = geo.index ? geo.clone() : geo.clone(); M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz)); g.applyMatrix4(M4);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    (buckets.get(m) || buckets.set(m, []).get(m)).push(g.index ? g : g); };
  const flush = (shadow = new Set()) => { for (const [m, list] of buckets) { const idx = list.filter(g => g.index), non = list.filter(g => !g.index); for (const part of [idx, non]) { if (!part.length) continue; const g = mergeGeometries(part, false); if (!g) continue;
      const o = new THREE.Mesh(g, m); o.castShadow = shadow.has(m); o.receiveShadow = true; o.matrixAutoUpdate = false; scene.add(o); } for (const g of list) g.dispose(); } buckets.clear(); };
  const inst = (geo, m, list, shadow = false, colors = null) => { if (!list.length) return null; const im = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((t, i) => { M4.compose(V.set(t[0], t[1], t[2]), Q.setFromEuler(E.set(t[6] || 0, t[3] || 0, t[7] || 0)), S3.set(t[4] ?? 1, t[5] ?? t[4] ?? 1, t[8] ?? t[4] ?? 1)); im.setMatrixAt(i, M4); if (colors) im.setColorAt(i, new THREE.Color(colors[i % colors.length])); });
    im.castShadow = shadow; im.receiveShadow = true; scene.add(im); return im; };
  const ellPt = (rx, rz, a) => [Math.cos(a) * rx, Math.sin(a) * rz];
  const inEdge = (x, z, pad = 0) => (x / (EX - pad)) ** 2 + (z / (EZ - pad)) ** 2 < 1;
  const onTrack = (x, z, pad = 2) => { const o = (x / (RX + WID / 2 + pad)) ** 2 + (z / (RZ + WID / 2 + pad)) ** 2, i = (x / (RX - WID / 2 - pad)) ** 2 + (z / (RZ - WID / 2 - pad)) ** 2; return o < 1 && i > 1; };
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  // ---- the racing surface: a ring with its grain along the track (harrowed lines and a worn line by the inner rail) ----
  { const N = 220, rows2 = 4, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2; for (let j = 0; j <= rows2; j++) { const o = -WID / 2 + WID * j / rows2; pos.push(Math.cos(a) * (RX + o), 0.025, Math.sin(a) * (RZ + o)); uv.push(i / N * 60 * G, j / rows2); } }
    for (let i = 0; i < N; i++) for (let j = 0; j < rows2; j++) { const a = i * (rows2 + 1) + j, b = a + rows2 + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); } /* (facing up) */
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const dirt = tex((c, n) => { c.fillStyle = '#B98A55'; c.fillRect(0, 0, n, n); for (let i = 0; i < 2600; i++) { const k = Math.random(); c.fillStyle = `rgba(${130 + k * 70},${90 + k * 50},${55 + k * 30},.35)`; c.fillRect(Math.random() * n, Math.random() * n, 1 + Math.random() * 3, 1); }
      for (let y = 0; y < n; y += 6) { c.fillStyle = `rgba(90,60,35,${0.08 + (y % 12 ? 0 : 0.06)})`; c.fillRect(0, y, n, 2); } /* harrow lines along the track */
      const gr = c.createLinearGradient(0, 0, 0, n); gr.addColorStop(0, 'rgba(70,45,25,.28)'); gr.addColorStop(0.25, 'rgba(70,45,25,0)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, n, n); /* the worn line by the inner rail */
      for (let i = 0; i < 70; i++) { c.fillStyle = 'rgba(80,55,30,.25)'; c.beginPath(); c.ellipse(Math.random() * n, Math.random() * n * 0.6, 3, 1.5, 0, 0, 7); c.fill(); } /* hoofprints */ }, 256);
    dirt.wrapT = THREE.ClampToEdgeWrapping; const m = mat({ map: dirt, roughness: 1 }); const o = new THREE.Mesh(g, m); o.receiveShadow = true; scene.add(o); }
  // a low green hedge inside the inner rail, and a white running rail's shadow line outside
  { const ring = (r0, r1, y0, y1, n = 160) => { const pos = [], idx = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; for (const [o, y] of [[r0, y0], [r0, y1], [r1, y1], [r1, y0]]) pos.push(Math.cos(a) * (RX + o), y, Math.sin(a) * (RZ + o)); }
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
    const hedgeT = tex((c, n) => { c.fillStyle = '#2F6B33'; c.fillRect(0, 0, n, n); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${40 + Math.random() * 60},${100 + Math.random() * 70},${40 + Math.random() * 30},.6)`; c.beginPath(); c.arc(Math.random() * n, Math.random() * n, 2 + Math.random() * 4, 0, 7); c.fill(); } }, 128);
    const hg = ring(-WID / 2 - 1.4, -WID / 2 - 0.6, 0, 0.9); const uvs = []; const p = hg.attributes.position; for (let i = 0; i < p.count; i++) uvs.push(i / 4 * 0.2, p.getY(i)); hg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const h = new THREE.Mesh(hg, mat({ map: hedgeT, roughness: 1 })); h.castShadow = true; h.receiveShadow = true; scene.add(h); }
  // ---- the ground: grass with mown stripes in the infield, a gravel path all round outside the rail ----
  { const grassT = tex((c, n) => { c.fillStyle = '#6FA84B'; c.fillRect(0, 0, n, n); for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(${40 + Math.random() * 60},${110 + Math.random() * 70},${30 + Math.random() * 30},.35)`; c.fillRect(Math.random() * n, Math.random() * n, 2, 2); } }, 256);
    grassT.repeat.set(80, 80); const gm = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), mat({ map: grassT, roughness: 1 })); gm.rotation.x = -Math.PI / 2; gm.position.y = -0.03; gm.receiveShadow = true; scene.add(gm);
    const stripeT = tex((c, n) => { for (let x = 0; x < n; x += n / 8) { c.fillStyle = (x / (n / 8)) % 2 ? '#7DBA55' : '#8CC863'; c.fillRect(x, 0, n / 8, n); } for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(40,100,30,.12)`; c.fillRect(Math.random() * n, Math.random() * n, 2, 2); } }, 256);
    const sh = new THREE.Shape(); for (let i = 0; i <= 120; i++) { const [x, z] = ellPt(RX - WID / 2 - 0.6, RZ - WID / 2 - 0.6, i / 120 * Math.PI * 2); i ? sh.lineTo(x, z) : sh.moveTo(x, z); }
    const ig = new THREE.ShapeGeometry(sh, 2); ig.rotateX(Math.PI / 2); const u = ig.attributes.uv, pp = ig.attributes.position; for (let i = 0; i < u.count; i++) u.setXY(i, pp.getX(i) / (RX * 0.5), pp.getZ(i) / (RX * 0.5)); /* (stripes about the size of the infield / 8) */
    const inf = new THREE.Mesh(ig, mat({ map: stripeT, roughness: 1, side: THREE.DoubleSide })); inf.position.y = 0.02; inf.receiveShadow = true; scene.add(inf);
    // the gravel path round the outside
    const gravelT = tex((c, n) => { c.fillStyle = '#D8CBB0'; c.fillRect(0, 0, n, n); for (let i = 0; i < 2500; i++) { const k = Math.random(); c.fillStyle = `rgba(${150 + k * 80},${140 + k * 70},${120 + k * 60},.6)`; c.fillRect(Math.random() * n, Math.random() * n, 2, 2); } }, 128);
    const N = 180, pos = [], uv = [], idx = [], o0 = WID / 2 + 3.2, o1 = WID / 2 + 6.4; for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2; for (const [j, o] of [[0, o0], [1, o1]]) { pos.push(Math.cos(a) * (RX + o), 0.012, Math.sin(a) * (RZ + o)); uv.push(i / N * 50, j); } }
    for (let i = 0; i < N; i++) { const a = i * 2, b = a + 2; idx.push(a, b, a + 1, a + 1, b, b + 1); } const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); pg.setIndex(idx); pg.computeVertexNormals();
    const path = new THREE.Mesh(pg, mat({ map: gravelT, roughness: 1 })); path.receiveShadow = true; scene.add(path); }

  // ---- shared shapes and materials for the merged scenery ----
  const blob = new THREE.IcosahedronGeometry(1, 0), box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 12), cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6), cone = new THREE.ConeGeometry(1, 1, 12), ball = new THREE.SphereGeometry(1, 12, 8), cone4 = new THREE.ConeGeometry(1, 1, 4);
  const white = mat({ color: '#F4F2EC', roughness: 0.55 }), steel = mat({ color: '#9AA3AB', roughness: 0.35, metalness: 0.7 }), dark = mat({ color: '#2B2621', roughness: 0.7 }), wood = mat({ color: '#8B5E3C', roughness: 0.85 });
  const brick = mat({ color: '#A8553E', roughness: 0.9 }), cream = mat({ color: '#EADFC8', roughness: 0.85 }), green = mat({ color: '#2F5E3A', roughness: 0.7 }), slate = mat({ color: '#4A5560', roughness: 0.8 }), red = mat({ color: '#C0392B', roughness: 0.6 });
  const team = mat({ color: colour, roughness: 0.6 }), gold = mat({ color: '#C9A227', roughness: 0.3, metalness: 0.8 }), glass = mat({ color: '#9FC6DA', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45 });
  const glow = mat({ color: '#FFF1C8', emissive: '#FFE7A8', emissiveIntensity: 0 }); glow.userData.glow = 2.2; /* lamps: lit by the view after dark */
  const shadowMats = new Set([cream, brick, steel, white, green, wood]);

  // ---- the grandstand, dressed: seats, aisles with handrails, a steel-truss roof, the stand's frontage ----
  { const rowsY = r => 0.6 + r * 0.9, rowZ = r => STAND_Z + r * 1.4; /* (the tiers themselves are the walkable ones in racetrack3d.js) */
    const seats = [], n = Math.floor((standW - 3) / 0.62); for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) { const x = -standW / 2 + 1.5 + i * 0.62 + 0.31; if ([-1, 0, 1].some(k => Math.abs(x - k * standW * 0.3) < 0.6)) continue; seats.push([x, rowsY(r) + 0.42, rowZ(r) - 0.12, Math.PI]); }
    const seatG = mergeGeometries([new THREE.BoxGeometry(0.5, 0.08, 0.42).translate(0, 0, 0), new THREE.BoxGeometry(0.5, 0.48, 0.07).translate(0, 0.22, -0.2)], false);
    inst(seatG, mat({ roughness: 0.5 }), seats, false, seats.map((s, i) => (Math.floor(i / 3) % 7 === 3 ? '#F2E9DA' : colour)));
    // aisles: steps down the stand and handrails
    for (const k of [-1, 0, 1]) { const x = k * standW * 0.3; for (let r = 0; r < rows; r++) { put(white, box, x, rowsY(r) + 0.47, rowZ(r) - 0.35, 0, 1.0, 0.04, 0.5); }
      for (const s of [-0.55, 0.55]) { const len = rows * 1.4, h = rows * 0.9; put(steel, cyl6, x + s, 1.3 + h / 2, STAND_Z - 0.7 + len / 2, 0, 0.03, Math.hypot(len, h), 0.03, Math.atan2(len, h)); } } /* handrails up each aisle */
    // the roof: a steel truss along the front, ribs back to the wall, and a light canopy
    const rz0 = STAND_Z - 1.6, rz1 = back + 0.3; for (let i = 0; i <= 8; i++) { const x = -standW / 2 - 1 + i * (standW + 2) / 8; put(steel, box, x, roofY + 0.35, (rz0 + rz1) / 2, 0, 0.18, 0.18, rz1 - rz0);
      put(steel, box, x, roofY - 0.05, rz0 + 1.2, 0, 0.12, 0.9, 0.12, 0.6); }
    for (const y of [roofY + 0.1, roofY + 0.7]) put(steel, box, 0, y, rz0, 0, standW + 2, 0.12, 0.12); for (let i = 0; i < 16; i++) { const x = -standW / 2 - 1 + (i + 0.5) * (standW + 2) / 16; put(steel, box, x, roofY + 0.4, rz0, 0, 0.08, 0.75, 0.08, 0, i % 2 ? 0.6 : -0.6); }
    put(team, box, 0, roofY + 1.0, (rz0 + rz1) / 2, 0, standW + 2.6, 0.08, rz1 - rz0 + 0.6); /* the canopy, in the stand's colour */
    put(white, box, 0, roofY + 1.1, rz0 - 0.1, 0, standW + 2.6, 0.5, 0.12); /* its white fascia */
    // the frontage behind the top tier: cream facade with tall windows (they glow after dark) and the stand's name band
    for (let i = 0; i < 12; i++) { const x = -standW / 2 + (i + 0.5) * standW / 12; put(glow, box, x, roofY * 0.62, back - 0.22, 0, standW / 12 * 0.6, roofY * 0.35, 0.05); }
    put(team, box, 0, roofY - 0.55, back - 0.22, 0, standW, 0.6, 0.06);
    // a TV screen on legs at the stand's left end (it shows the scoreboard too: racetrack3d puts the picture on it)
    put(dark, box, -standW / 2 - 4, 6.2, STAND_Z + 1, 0.35, 7.4, 4.4, 0.4); put(steel, cyl6, -standW / 2 - 6, 2.0, STAND_Z + 1.6, 0, 0.18, 4.0, 0.18); put(steel, cyl6, -standW / 2 - 2, 2.0, STAND_Z + 0.2, 0, 0.18, 4.0, 0.18);
    colliders.push({ x: -standW / 2 - 6, z: STAND_Z + 1.6, r: 0.5 }, { x: -standW / 2 - 2, z: STAND_Z + 0.2, r: 0.5 }); }

  // ---- the track's furniture: furlong posts, the starting stalls, the photo-finish tower, the winning post ----
  { const posts = []; for (let k = 0; k < 16; k++) { const a = Math.PI / 2 - k / 16 * Math.PI * 2, o = WID / 2 + 0.9; posts.push([Math.cos(a) * (RX + o), 1.1, Math.sin(a) * (RZ + o), 0, 0.08, 2.2, 0, 0, 0.08]); }
    const poleT = tex((c, n) => { for (let y = 0; y < n; y += n / 8) { c.fillStyle = (y / (n / 8)) % 2 ? '#C0392B' : '#FFFFFF'; c.fillRect(0, y, n, n / 8); } }, 64, false);
    inst(cyl, mat({ map: poleT, roughness: 0.5 }), posts, true);
    // the starting stalls, parked on the infield beside the home straight
    { const sx = -RX * 0.28, sz = RZ - WID / 2 - 4.5; for (let i = 0; i <= 8; i++) { put(steel, box, sx + i * 1.1 - 4.4, 1.6, sz, 0, 0.12, 3.2, 2.6); }
      put(team, box, sx, 3.3, sz, 0, 9.3, 0.4, 2.8); put(white, box, sx, 3.65, sz, 0, 9.4, 0.3, 0.2); for (const x of [-4.8, 4.8]) put(dark, cyl, sx + x, 0.5, sz + 1.5, Math.PI / 2, 0.5, 0.3, 0.5, 0, Math.PI / 2); }
    // the photo-finish tower on the far side of the line, and the red and white winning post
    { const z = RZ - WID / 2 - 2.2; put(steel, cyl6, 0.6, 3.2, z, 0, 0.18, 6.4, 0.18); put(cream, box, 0.6, 7.0, z, 0, 2.2, 1.8, 2.0); put(glass, box, 0.6, 7.1, z + 1.01, 0, 1.8, 0.9, 0.02); put(team, cone4, 0.6, 8.35, z, Math.PI / 4, 1.9, 0.9, 1.9);
      put(red, cyl, 0, 1.2, RZ - WID / 2 - 0.4, 0, 0.09, 2.4, 0.09); put(white, cyl, 0, 2.5, RZ - WID / 2 - 0.4, 0, 0.45, 0.06, 0.45, Math.PI / 2); put(red, cyl, 0, 2.5, RZ - WID / 2 - 0.36, 0, 0.3, 0.07, 0.3, Math.PI / 2); } }

  // ---- the infield: a lake with a fountain and reeds, flowerbeds, a bandstand, paths, the tote board's frame ----
  const lake = { x: -RX * 0.32, z: 0, rx: RX * 0.2, rz: RZ * 0.3 };
  { const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat({ color: '#3F7FA6', roughness: 0.06, metalness: 0.35 })); water.scale.set(lake.rx, lake.rz, 1); water.rotation.x = -Math.PI / 2; water.position.set(lake.x, 0.04, lake.z); scene.add(water);
    const bank = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), mat({ color: '#C9B48A', roughness: 1 })); bank.scale.set(lake.rx, lake.rz, 1); bank.rotation.x = -Math.PI / 2; bank.position.set(lake.x, 0.045, lake.z); scene.add(bank);
    const reeds = []; for (let i = 0; i < 90; i++) { const a = rnd() * Math.PI * 2, k = 0.95 + rnd() * 0.12; reeds.push([lake.x + Math.cos(a) * lake.rx * k, 0.45, lake.z + Math.sin(a) * lake.rz * k, rnd() * 3, 0.04, 0.9 + rnd() * 0.5]); }
    inst(cyl6, mat({ color: '#557A3A', roughness: 0.9 }), reeds);
    // the fountain: a stone basin and a plume of water drops that rise and fall (moved on the graphics chip)
    put(cream, cyl, lake.x, 0.25, lake.z, 0, 1.6, 0.5, 1.6); put(cream, cyl, lake.x, 0.9, lake.z, 0, 0.35, 1.3, 0.35); put(cream, cyl, lake.x, 1.55, lake.z, 0, 0.9, 0.12, 0.9);
    const N = 220, seeds = new Float32Array(N * 3); for (let i = 0; i < N; i++) { seeds[i * 3] = rnd() * Math.PI * 2; seeds[i * 3 + 1] = rnd(); seeds[i * 3 + 2] = 0.6 + rnd() * 0.6; }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3)); fg.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    const uT = { value: 0 }, fm = new THREE.PointsMaterial({ color: '#DDF2FF', size: 0.16, transparent: true, opacity: 0.85, depthWrite: false });
    fm.onBeforeCompile = sh => { sh.uniforms.uT = uT; sh.vertexShader = 'uniform float uT; attribute vec3 seed;\n' + sh.vertexShader.replace('#include <begin_vertex>', `float t = fract(uT * 0.55 + seed.y); float r = t * 1.3 * seed.z;
        vec3 transformed = vec3(cos(seed.x) * r, 1.6 + 5.2 * t * seed.z - 6.2 * t * t, sin(seed.x) * r);`); };
    const fountain = new THREE.Points(fg, fm); fountain.position.set(lake.x, 0, lake.z); fountain.frustumCulled = false; scene.add(fountain); movers.push((dt, now) => { uT.value = now / 1000; });
    colliders.push({ ell: lake }); }
  // flowerbeds: rings of colour round the infield's end, and beds along the inside of the hedge
  { const fl = [], cols = ['#E4572E', '#F2C94C', '#D98BA8', '#FFFFFF', '#9B59B6', '#F39C12'];
    for (const [cx, rr, n] of [[RX * 0.34, RZ * 0.28, 160], [RX * 0.34, RZ * 0.16, 90]]) for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, j = (rnd() - 0.5) * 0.8; fl.push([cx + Math.cos(a) * (rr * 1.5 + j), 0.22, Math.sin(a) * (rr + j), 0, 0.28 + rnd() * 0.1]); }
    for (let i = 0; i < 260; i++) { const a = rnd() * Math.PI * 2; if (Math.abs(Math.sin(a)) > 0.6 && Math.cos(a) < 0.2) continue; const o = -WID / 2 - 2.6 - rnd() * 1.2; fl.push([Math.cos(a) * (RX + o), 0.22, Math.sin(a) * (RZ + o), 0, 0.26 + rnd() * 0.1]); }
    inst(blob, mat({ roughness: 0.8, flatShading: true }), fl, false, fl.map((_, i) => cols[(i * 7 + (i >> 3)) % cols.length]));
    const leaves = []; for (const f of fl) if (rnd() < 0.5) leaves.push([f[0] + (rnd() - 0.5) * 0.5, 0.15, f[2] + (rnd() - 0.5) * 0.5, 0, 0.3]); inst(blob, mat({ color: '#3E7A3B', roughness: 0.9, flatShading: true }), leaves); }
  // the bandstand: an octagon with a dome, at the infield's east end
  { const bx = RX * 0.34, bz = 0; put(white, cyl6, bx, 0.3, bz, 0, 3.4, 0.6, 3.4); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; put(white, cyl, bx + Math.cos(a) * 3.0, 2.1, bz + Math.sin(a) * 3.0, 0, 0.12, 3.0, 0.12); }
    put(team, cone, bx, 4.6, bz, Math.PI / 8, 3.8, 2.0, 3.8); put(gold, ball, bx, 5.75, bz, 0, 0.22); put(white, cyl6, bx, 3.62, bz, 0, 3.7, 0.25, 3.7); colliders.push({ x: bx, z: bz, r: 3.5 }); }

  // ---- outside the rail, to explore: the parade ring with its statue, the stables, food stalls, picnic tables ----
  // the parade ring (where the runners are shown before a race): a ring of white rails round a lawn, at the west end
  const PR = { x: -(RX + WID / 2 + 22), z: RZ * 0.25, rx: 9, rz: 6 };
  { const rails = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; if (Math.abs(Math.sin(a)) < 0.12 && Math.cos(a) > 0) continue; rails.push([PR.x + Math.cos(a) * PR.rx, 0.55, PR.z + Math.sin(a) * PR.rz, -a, 0.07, 1.1, 0, 0, 0.07]); }
    inst(cyl6, white, rails); for (const y of [0.55, 1.05]) { const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; pts.push(new THREE.Vector3(PR.x + Math.cos(a) * PR.rx, y, PR.z + Math.sin(a) * PR.rz)); } const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.05, 5, true), white); scene.add(t); }
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mat({ color: '#86C25E', roughness: 1 })); lawn.scale.set(PR.rx - 0.4, PR.rz - 0.4, 1); lawn.rotation.x = -Math.PI / 2; lawn.position.set(PR.x, 0.02, PR.z); scene.add(lawn);
    // the champion's statue: a bronze runner on a plinth, in the middle of the ring (racetrack3d.js adds the creature)
    put(cream, box, PR.x, 0.6, PR.z, 0, 2.4, 1.2, 1.4); put(gold, box, PR.x, 1.24, PR.z, 0, 2.5, 0.08, 1.5); colliders.push({ x: PR.x, z: PR.z, r: 1.5 }); }
  // the stables: a long brick block with green doors and a slate roof, at the east end
  const ST = { x: RX + WID / 2 + 26, z: -RZ * 0.15, len: 22 };
  { put(brick, box, ST.x, 1.6, ST.z, Math.PI / 2, ST.len, 3.2, 5); put(slate, cone4, ST.x, 4.3, ST.z, Math.PI / 4, 3.9, 2.4, ST.len * 0.72, 0, 0); for (let i = 0; i < 8; i++) { const z = ST.z - ST.len / 2 + 1.6 + i * (ST.len - 3.2) / 7; put(green, box, ST.x - 2.52, 1.2, z, 0, 0.06, 2.2, 1.5); put(white, box, ST.x - 2.54, 1.25, z, 0, 0.04, 0.1, 1.5); }
    put(white, box, ST.x, 6.1, ST.z, 0, 0.9, 1.3, 0.9); put(dark, cone4, ST.x, 7.1, ST.z, Math.PI / 4, 0.8, 0.7, 0.8); put(gold, cyl6, ST.x, 7.6, ST.z, 0, 0.03, 0.6, 0.03); /* a clock turret with a weathervane */
    for (let i = 0; i < 6; i++) put(mat({ color: '#D9B862', roughness: 1 }), box, ST.x - 4.2 - (i % 2) * 1.3, 0.45 + Math.floor(i / 4) * 0.9, ST.z + 6 + (i % 4) * 1.3, 0, 1.2, 0.9, 1.2); /* hay bales */
    colliders.push({ x0: ST.x - 2.7, z0: ST.z - ST.len / 2, x1: ST.x + 2.7, z1: ST.z + ST.len / 2 }); }
  // food and drink stalls beside the stand: striped canopies and signs (one picture holds all the signs)
  { const names = ['🍔 Burgers', '🍦 Ice cream', '🥤 Drinks', '🎟️ Bets', '🍿 Popcorn', '🎈 Souvenirs'], signC = document.createElement('canvas'); signC.width = 512; signC.height = 384; const sg = signC.getContext('2d');
    names.forEach((t, i) => { const x = (i % 2) * 256, y = Math.floor(i / 2) * 128; sg.fillStyle = ['#C0392B', '#2E86C1', '#27AE60', '#8E44AD', '#E67E22', '#16A085'][i]; sg.fillRect(x, y, 256, 128); sg.fillStyle = '#fff'; sg.font = '700 40px system-ui, sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText(t, x + 128, y + 64); });
    const signT = new THREE.CanvasTexture(signC); signT.colorSpace = THREE.SRGBColorSpace; const stripeT = tex((c, n) => { for (let x = 0; x < n; x += n / 8) { c.fillStyle = (x / (n / 8)) % 2 ? '#FFFFFF' : '#C0392B'; c.fillRect(x, 0, n / 8, n); } }, 64);
    const canopy = mat({ map: stripeT, roughness: 0.7 }), signM = new THREE.MeshBasicMaterial({ map: signT, toneMapped: false }); view.mats.push(signM);
    names.forEach((t, i) => { const side = i < 3 ? -1 : 1, k = i % 3, x = side * (standW / 2 + 7 + k * 4.6), z = STAND_Z - 3 + (k % 2) * 0.6;
      put(cream, box, x, 0.55, z, 0, 3.2, 1.1, 2.2); put(wood, box, x, 1.15, z - 1.0, 0, 3.3, 0.08, 0.5); for (const dx of [-1.5, 1.5]) put(wood, box, x + dx, 1.6, z + 0.9, 0, 0.1, 3.2, 0.1); put(canopy, box, x, 3.25, z, 0, 3.6, 0.12, 2.8, -0.12);
      const sgeo = new THREE.PlaneGeometry(3.0, 0.8); const u = sgeo.attributes.uv; for (let j = 0; j < u.count; j++) u.setXY(j, ((i % 2) + u.getX(j)) / 2, 1 - (Math.floor(i / 2) + 1 - u.getY(j)) / 3); put(signM, sgeo, x, 2.6, z - 1.32, Math.PI);
      colliders.push({ x, z, r: 1.9 }); }); }
  // picnic tables under parasols near the parade ring
  { for (let i = 0; i < 6; i++) { const x = PR.x + 14 + (i % 3) * 4.2, z = PR.z - 10 + Math.floor(i / 3) * 5; put(wood, box, x, 0.75, z, 0.3, 1.8, 0.08, 0.8); put(wood, box, x, 0.45, z + 0.7, 0.3, 1.8, 0.06, 0.3); put(wood, box, x, 0.45, z - 0.7, 0.3, 1.8, 0.06, 0.3);
      put(white, cyl6, x, 1.3, z, 0, 0.04, 2.6, 0.04); put(i % 2 ? red : team, cone, x, 2.5, z, 0, 1.5, 0.45, 1.5); colliders.push({ x, z, r: 1.1 }); } }

  // ---- lamps and bunting along the path; a white fence round the edge; trees, inside and out; hills beyond ----
  { const lampP = [], bulbs = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, o = WID / 2 + 6.9, x = Math.cos(a) * (RX + o), z = Math.sin(a) * (RZ + o); if (z > RZ + 3 && Math.abs(x) < standW / 2 + 20) continue; lampP.push([x, 2.0, z, 0, 0.07, 4.0, 0, 0, 0.07]); bulbs.push([x, 4.1, z, 0, 0.22]); colliders.push({ x, z, r: 0.25 }); }
    inst(cyl6, dark, lampP); inst(ball, glow, bulbs);
    // bunting: little flags strung from lamp to lamp (they flutter: a few numbers a frame)
    const fl = [], fc = ['#E4572E', '#F2C94C', '#2E86C1', '#27AE60', '#FFFFFF', '#9B59B6']; for (let i = 0; i < lampP.length; i++) { const A = lampP[i], B = lampP[(i + 1) % lampP.length]; if (Math.hypot(A[0] - B[0], A[2] - B[2]) > 16) continue;
      for (let k = 1; k < 10; k++) { const t = k / 10, sag = Math.sin(t * Math.PI) * 0.6; fl.push([A[0] + (B[0] - A[0]) * t, 3.75 - sag, A[2] + (B[2] - A[2]) * t, Math.atan2(B[0] - A[0], B[2] - A[2]) + Math.PI / 2, 0.32, 0.42, Math.PI, 0, 0.32]); } }
    const tri = new THREE.ConeGeometry(0.5, 1, 3); tri.rotateZ(0); const bunt = inst(tri, mat({ roughness: 0.7, side: THREE.DoubleSide }), fl, false, fl.map((_, i) => fc[i % fc.length]));
    if (bunt) { const base = fl.map(t => t.slice()); let tb = 0; movers.push((dt, now) => { tb += dt; if (tb < 0.1) return; tb = 0; for (let i = 0; i < base.length; i += 1) { const t = base[i], w = Math.sin(now / 400 + i * 0.7) * 0.25; M4.compose(V.set(t[0], t[1], t[2]), Q.setFromEuler(E.set(Math.PI + w, t[3], 0)), S3.set(t[4], t[5], t[8])); bunt.setMatrixAt(i, M4); } bunt.instanceMatrix.needsUpdate = true; }); } }
  // the white post-and-rail fence round the edge of the grounds
  { const posts = [], n = 120; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; posts.push([Math.cos(a) * (EX - 0.5), 0.55, Math.sin(a) * (EZ - 0.5), 0, 0.09, 1.1, 0, 0, 0.09]); } inst(box, white, posts);
    for (const y of [0.5, 0.95]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.08, 120, 1, true), white); r.scale.set(EX - 0.5, 1, EZ - 0.5); r.position.y = y; r.material.side = THREE.DoubleSide; scene.add(r); } }
  // trees: two kinds (round and tall), scattered outside the rail (not on paths, stalls or buildings), in the infield, and a thick line beyond the fence
  { const round = [], tall = [], trunks = [], ok = (x, z) => !onTrack(x, z, 9) && !(Math.abs(x) < standW / 2 + 26 && z > RZ) && Math.hypot(x - PR.x, (z - PR.z) * 1.4) > 16 && Math.hypot(x - ST.x, z - ST.z) > 16 && ((x - lake.x) / (lake.rx + 3)) ** 2 + ((z - lake.z) / (lake.rz + 3)) ** 2 > 1 && Math.hypot(x - RX * 0.34, z) > 9;
    const tree = (x, z, s, kind) => { trunks.push([x, 1.2 * s, z, 0, 0.22 * s, 2.4 * s, 0, 0, 0.22 * s]); if (kind) tall.push([x, 4.4 * s, z, rnd() * 3, 1.6 * s, 4.6 * s, 0, 0, 1.6 * s]); else round.push([x, 3.6 * s, z, rnd() * 3, 2.2 * s, 1.9 * s, 0, 0, 2.2 * s]); };
    for (let i = 0; i < 260 && round.length + tall.length < 150; i++) { const a = rnd() * Math.PI * 2, r = 0.62 + rnd() * 0.36, x = Math.cos(a) * EX * r, z = Math.sin(a) * EZ * r; if (!inEdge(x, z, 4) || !ok(x, z)) continue; const s = 0.8 + rnd() * 0.5; tree(x, z, s, rnd() < 0.35); colliders.push({ x, z, r: 0.5 * s }); }
    for (let i = 0; i < 16; i++) { const a = rnd() * Math.PI * 2, x = Math.cos(a) * (RX - WID / 2 - 6) * rnd(), z = Math.sin(a) * (RZ - WID / 2 - 6) * rnd(); if (!ok(x, z)) continue; tree(x, z, 0.7 + rnd() * 0.4, rnd() < 0.3); }
    for (let i = 0; i < 140; i++) { const a = i / 140 * Math.PI * 2 + rnd() * 0.03, k = 1.08 + rnd() * 0.25; tree(Math.cos(a) * EX * k, Math.sin(a) * EZ * k, 1.0 + rnd() * 0.8, rnd() < 0.45); }
    const leafT = tex((c, n) => { c.fillStyle = '#4C8A45'; c.fillRect(0, 0, n, n); for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(${30 + rnd() * 50},${90 + rnd() * 70},${30 + rnd() * 30},.55)`; c.beginPath(); c.arc(rnd() * n, rnd() * n, 2 + rnd() * 5, 0, 7); c.fill(); } }, 128);
    const leafM = mat({ map: leafT, roughness: 0.9 }), pineM = mat({ map: leafT, color: '#B8D6A8', roughness: 0.9 });
    inst(new THREE.IcosahedronGeometry(1, 1), leafM, round, true, round.map((_, i) => ['#FFFFFF', '#E7F2D5', '#D6E8C0', '#F2F7E4'][i % 4])); inst(new THREE.ConeGeometry(1, 1, 8), pineM, tall, true); inst(cyl6, mat({ color: '#6B4A2E', roughness: 0.95 }), trunks, true); }
  // rolling hills all round, far off (one low mesh; the haze softens them)
  { const N = 96, pos = [], idx = []; for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, h = 10 + Math.sin(a * 3) * 7 + Math.sin(a * 7 + 1) * 4 + Math.sin(a * 13) * 2; for (const [r, y] of [[1.6, -1], [2.1, h], [2.6, h * 0.6]]) pos.push(Math.cos(a) * EX * r, y, Math.sin(a) * EZ * r * 1.25); }
    for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, mat({ color: '#6E9A5A', roughness: 1, flatShading: true }))); }
  // hot-air balloons drifting slowly over the course
  { const cols = [['#E4572E', '#F2C94C'], ['#2E86C1', '#FFFFFF'], ['#8E44AD', '#27AE60']];
    cols.forEach(([a, b], i) => { const g = new THREE.Group(), bt = tex((c, n) => { for (let x = 0; x < n; x += n / 8) { c.fillStyle = (x / (n / 8)) % 2 ? a : b; c.fillRect(x, 0, n / 8, n); } }, 64);
      const env = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), mat({ map: bt, roughness: 0.6 })); env.scale.set(1, 1.2, 1); g.add(env); const bk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), wood); bk.position.y = -5.1; g.add(bk);
      for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 4), dark); r.position.set(x, -3.6, z); g.add(r); }
      scene.add(g); const r0 = (1.25 + i * 0.35), ph = i * 2.1, h0 = 34 + i * 9; movers.push((dt, now) => { const t = now / 1000 / (90 + i * 30) + ph; g.position.set(Math.cos(t) * EX * r0, h0 + Math.sin(now / 4000 + i) * 1.5, Math.sin(t) * EZ * r0); }); }); }

  // ---- a crowd: racegoers in the stand and along the rail (one draw for all of them); they jump up during a race ----
  const crowdU = { value: 0 }, timeU = { value: 0 };
  { const bodyG = new THREE.CapsuleGeometry(0.17, 0.52, 3, 8).translate(0, 0.5, 0), headG = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.04, 0), hatG = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 8).translate(0, 1.15, 0);
    const g = mergeGeometries([bodyG.toNonIndexed(), hatG.toNonIndexed()].map(x => { x.deleteAttribute('uv'); return x; }), false); /* (the heads are a second batch, in skin tones: they move with the bodies) */
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85 }), hm = new THREE.MeshStandardMaterial({ roughness: 0.7 }); view.mats.push(m, hm);
    hm.onBeforeCompile = sh => { sh.uniforms.uJ = crowdU; sh.uniforms.uT = timeU; sh.vertexShader = 'uniform float uJ; uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y += abs(sin(uT * 6.0 + float(gl_InstanceID) * 2.3)) * 0.18 * uJ;'); };
    m.onBeforeCompile = sh => { sh.uniforms.uJ = crowdU; sh.uniforms.uT = timeU; sh.vertexShader = 'uniform float uJ; uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y += abs(sin(uT * 6.0 + float(gl_InstanceID) * 2.3)) * 0.18 * uJ;'); };
    const spots = []; for (let r = 0; r < rows; r++) for (let i = 0; i < 40; i++) { if (rnd() < 0.3) continue; const x = -standW / 2 + 2 + rnd() * (standW - 4); if ([-1, 0, 1].some(k => Math.abs(x - k * standW * 0.3) < 0.8)) continue; spots.push([x, 0.6 + r * 0.9 + 0.08, STAND_Z + r * 1.4 - 0.15, Math.PI + (rnd() - 0.5) * 0.4]); }
    for (let i = 0; i < 40; i++) { const a = Math.PI / 2 + (rnd() - 0.5) * 1.6, o = WID / 2 + 1.6 + rnd() * 1.4; spots.push([Math.cos(a) * (RX + o), 0, Math.sin(a) * (RZ + o), Math.atan2(-Math.cos(a), -Math.sin(a)) + (rnd() - 0.5) * 0.5]); }
    const C = ['#C0392B', '#2E86C1', '#F1C40F', '#ECF0F1', '#8E44AD', '#27AE60', '#E67E22', '#34495E', '#D98BA8', '#1ABC9C'];
    inst(g, m, spots, false, spots.map((_, i) => C[(i * 7 + (i >> 2)) % C.length])); inst(headG, hm, spots, false, spots.map((_, i) => ['#8D5524', '#C68642', '#E0AC69', '#5C3A21', '#F1C27D', '#A0663D'][(i * 5 + 1) % 6])); }
  movers.push((dt, now) => { timeU.value = now / 1000; });
  flush(shadowMats);
  return { colliders, statue: { x: PR.x, y: 1.28, z: PR.z }, screen: { x: -standW / 2 - 4, y: 6.2, z: STAND_Z + 1.21, ry: 0.35 + Math.PI }, update(dt, now, racing) { crowdU.value += ((racing ? 1 : 0.08) - crowdU.value) * Math.min(1, dt * 2); for (const f of movers) f(dt, now); } };
}
