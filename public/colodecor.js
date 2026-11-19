// The Colosseum's grandeur, drawn so a phone stays cool (the same rules as racedecor.js): still things merged by
// material, repeated things instanced, canvas textures, no new lights, and the few moving things (flames, embers,
// pennants) moved on the graphics chip or a few numbers a frame.
//
// decorate(view, P) P: { SX, R0, PODIUM, ROWS, ROW_D, ROW_H, Y0, RT, YT, ROUT } (colosseum3d.js's own measures).
// Returns { update(dt, now) }. mergeStatic(scene, view) folds every still mesh colosseum3d.js marked (userData.static)
// into one mesh per look.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function decorate(view, P) {
  const { scene } = view, { SX, R0, PODIUM, YT, RT, ROUT } = P, movers = [];
  const tex = (draw, w = 256, h = w, rep = true) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const mat = o => { const m = new THREE.MeshStandardMaterial({ roughness: 0.85, ...o }); view.mats.push(m); return m; };
  const buckets = new Map(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S3 = new THREE.Vector3();
  const put = (m, geo, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => { const g = geo.clone(); M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz)); g.applyMatrix4(M4);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    (buckets.get(m) || buckets.set(m, []).get(m)).push(g.index ? g.toNonIndexed() : g); };
  const flush = shadow => { for (const [m, list] of buckets) { const g = mergeGeometries(list, false); for (const x of list) x.dispose(); if (!g) continue; const o = new THREE.Mesh(g, m); o.castShadow = shadow.has(m); o.receiveShadow = true; o.matrixAutoUpdate = false; scene.add(o); } buckets.clear(); };
  const inst = (geo, m, list, shadow = false, colors = null) => { if (!list.length) return null; const im = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((t, i) => { M4.compose(V.set(t[0], t[1], t[2]), Q.setFromEuler(E.set(t[6] || 0, t[3] || 0, t[7] || 0)), S3.set(t[4] ?? 1, t[5] ?? t[4] ?? 1, t[8] ?? t[4] ?? 1)); im.setMatrixAt(i, M4); if (colors) im.setColorAt(i, new THREE.Color(colors[i % colors.length])); });
    im.castShadow = shadow; im.receiveShadow = true; scene.add(im); return im; };
  const at = (r, a) => [Math.cos(a) * r * SX, Math.sin(a) * r];
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 14), cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8), ball = new THREE.SphereGeometry(1, 12, 8), cone = new THREE.ConeGeometry(1, 1, 10);
  const marbleT = tex((c, n) => { c.fillStyle = '#EFEAE0'; c.fillRect(0, 0, n, n); for (let i = 0; i < 40; i++) { c.strokeStyle = `rgba(150,140,125,${0.08 + Math.random() * 0.12})`; c.lineWidth = 0.6 + Math.random() * 1.4; c.beginPath(); let x = Math.random() * n, y = Math.random() * n; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 60; y += Math.random() * 40; c.lineTo(x, y); } c.stroke(); } }, 256);
  const marble = mat({ map: marbleT, roughness: 0.45 }), bronze = mat({ color: '#8C5A2B', roughness: 0.35, metalness: 0.85 }), gold = mat({ color: '#C9A227', roughness: 0.3, metalness: 0.85 });
  const stoneT = tex((c, n) => { c.fillStyle = '#D9C9A6'; c.fillRect(0, 0, n, n); for (let i = 0; i < 1800; i++) { const k = Math.random(); c.fillStyle = `rgba(${150 + k * 70},${130 + k * 60},${95 + k * 45},.3)`; c.fillRect(Math.random() * n, Math.random() * n, 2 + Math.random() * 3, 1 + Math.random() * 2); }
    c.strokeStyle = 'rgba(110,90,60,.35)'; for (let y = 0; y < n; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(n, y); c.stroke(); for (let x = (y / 32) % 2 * 32; x < n; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 32); c.stroke(); } } }, 256);
  const stone = mat({ map: stoneT, color: '#F2E6CC', roughness: 0.9 }), purple = mat({ color: '#5B2A6E', roughness: 0.75 }), crimson = mat({ color: '#8A2A22', roughness: 0.7 }), dark = mat({ color: '#1E1915', roughness: 0.9 });

  // ---- the crown: a colonnade of white columns round the top of the outer wall, with its entablature ----
  { const n = 64, r = ROUT + 0.45, y0 = YT + 3.6, h = 3.2, cols = [], caps = [], bases = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, [x, z] = at(r, a); cols.push([x, y0 + h / 2, z, 0, 0.22, h, 0, 0, 0.22]); caps.push([x, y0 + h + 0.12, z, -a, 0.62, 0.24, 0, 0, 0.62]); bases.push([x, y0 + 0.1, z, -a, 0.55, 0.2, 0, 0, 0.55]); }
    const fluteT = tex((c, w, hh) => { c.fillStyle = '#F1ECE1'; c.fillRect(0, 0, w, hh); for (let x = 0; x < w; x += 16) { const g = c.createLinearGradient(x, 0, x + 16, 0); g.addColorStop(0, 'rgba(0,0,0,.12)'); g.addColorStop(0.5, 'rgba(255,255,255,.1)'); g.addColorStop(1, 'rgba(0,0,0,.12)'); c.fillStyle = g; c.fillRect(x, 0, 16, hh); } }, 128, 64);
    inst(cyl, mat({ map: fluteT, roughness: 0.5 }), cols, true); inst(box, marble, caps); inst(box, marble, bases);
    for (const [yy, hh, d] of [[y0 + h + 0.45, 0.42, 1.1], [y0 + h + 0.9, 0.22, 1.3]]) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + d * 0.3, r + d * 0.3, hh, 96, 1, true), marble); ring.scale.set(SX, 1, 1); ring.position.y = yy; ring.material.side = THREE.DoubleSide; scene.add(ring); } }
  // ---- the podium wall: niches with marble statues of champions, and pilasters between ----
  { const niches = [], statues = [], pil = [], N = 18, nicheT = tex((c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3A2D22'); g.addColorStop(1, '#5A4636'); c.fillStyle = g; c.beginPath(); c.moveTo(0, h); c.lineTo(0, h * 0.35); c.arc(w / 2, h * 0.35, w / 2, Math.PI, 0); c.lineTo(w, h); c.fill(); }, 64, 128, false);
    const nicheM = new THREE.MeshBasicMaterial({ map: nicheT, transparent: true }); view.mats.push(nicheM);
    // a statue: a figure with a helmet, a shield and a raised sword, in one shape (instanced)
    const parts = [new THREE.CylinderGeometry(0.17, 0.22, 0.9, 10).translate(0, 0.75, 0), new THREE.SphereGeometry(0.14, 10, 8).translate(0, 1.35, 0), new THREE.ConeGeometry(0.15, 0.25, 10).translate(0, 1.5, 0),
      new THREE.CylinderGeometry(0.09, 0.07, 0.6, 8).translate(-0.1, 0.0, 0).translate(0, 0.3, 0), new THREE.CylinderGeometry(0.09, 0.07, 0.6, 8).translate(0.1, 0.3, 0),
      new THREE.CylinderGeometry(0.25, 0.25, 0.05, 16).rotateZ(Math.PI / 2).translate(-0.27, 0.9, 0.05), new THREE.BoxGeometry(0.05, 0.75, 0.05).rotateZ(-0.5).translate(0.36, 1.45, 0.05), new THREE.CylinderGeometry(0.3, 0.3, 0.3, 12).translate(0, -0.15, 0)];
    const statueG = mergeGeometries(parts.map(g => { const x = g.index ? g.toNonIndexed() : g; x.deleteAttribute('uv'); return x; }), false);
    for (let i = 0; i < N; i++) { const a = (i + 0.5) / N * Math.PI * 2; if (Math.abs(Math.cos(a)) > 0.94) continue; if (Math.sin(a) < -0.93) continue; /* (not at the gates, nor under the imperial box) */
      const [x, z] = at(R0 - 0.02, a), [sx, sz] = at(R0 - 0.45, a), face = Math.atan2(-sx, -sz); niches.push([x, 1.25, z, face, 1.0, 2.0, 0, 0, 1]); statues.push([sx, 0.32, sz, face, 0.85]);
      const [px, pz] = at(R0 - 0.05, a + Math.PI / N); pil.push([px, PODIUM / 2 - 0.15, pz, -a, 0.28, PODIUM - 0.3, 0, 0, 0.18]); }
    const plane = new THREE.PlaneGeometry(1, 1); inst(plane, nicheM, niches); inst(statueG, marble, statues, true); inst(box, marble, pil); }
  // ---- the gates: grand arches with keystones and Latin plaques ----
  { const names = ['PORTA TRIUMPHALIS', 'PORTA LIBITINENSIS'], plaques = names.map(t => { const tx = tex((c, w, h) => { c.fillStyle = '#E9DFC9'; c.fillRect(0, 0, w, h); c.strokeStyle = '#8A7A5A'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = '#3B2C1E'; c.font = '700 30px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, w / 2, h / 2); }, 512, 96, false); const m = new THREE.MeshBasicMaterial({ map: tx }); view.mats.push(m); return m; });
    [-1, 1].forEach((s, k) => { const x = s * (R0 - 0.1) * SX; const arch = new THREE.TorusGeometry(1.55, 0.28, 8, 20, Math.PI); put(marble, arch, x, 2.6, 0, Math.PI / 2, 1, 1, 1);
      for (const z of [-1.55, 1.55]) put(marble, cyl, x, 1.3, z, 0, 0.3, 2.6, 0.3); put(gold, box, x - s * 0.05, 4.18, 0, 0, 0.3, 0.42, 0.34); /* keystone */
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.64), plaques[k]); pl.position.set(x - s * 0.18, 4.75, 0); pl.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2; scene.add(pl); }); }
  // ---- the imperial box: purple drapes, gold eagles on its pillars, laurel banners ----
  { const z = -(R0 + 0.7 + 1.2), y = P.Y0 + P.ROW_H * 1.5; for (const x of [-2.4, 2.4]) { put(gold, box, x, y + 3.25, z + 0.5, 0, 0.5, 0.18, 0.5); put(gold, cone, x, y + 3.6, z + 0.5, 0, 0.18, 0.5, 0.18); put(gold, box, x, y + 3.75, z + 0.5, 0, 0.8, 0.08, 0.16, 0, 0.25); }
    for (const x of [-2.0, -1.2, 1.2, 2.0]) put(purple, box, x, y + 1.9, z + 1.15, 0, 0.7, 2.0, 0.04, 0, x < 0 ? -0.05 : 0.05);
    put(purple, box, 0, y + 2.75, z + 1.18, 0, 5.4, 0.4, 0.05); put(gold, box, 0, y + 2.55, z + 1.2, 0, 5.4, 0.06, 0.06); }
  // ---- four great bronze braziers on the sand's edge, their fires roaring and embers rising ----
  const fireU = { value: 0 };
  { const spots = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75].map(a => at(R0 - 0.9, a)), flames = [], embers = [];
    const fireM = new THREE.MeshBasicMaterial({ color: '#FF8A2A', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), coreM = new THREE.MeshBasicMaterial({ color: '#FFE28A', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    fireM.onBeforeCompile = coreM.onBeforeCompile = sh => { sh.uniforms.uT = fireU; sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  float k = max(0.0, position.y + 0.5); transformed.x += sin(uT * 9.0 + position.y * 6.0 + float(gl_InstanceID) * 2.0) * 0.12 * k; transformed.z += cos(uT * 7.0 + position.y * 5.0) * 0.1 * k; transformed.y *= 1.0 + 0.15 * sin(uT * 13.0 + float(gl_InstanceID));'); };
    for (const [x, z] of spots) { for (const [dx, dz] of [[0.35, 0], [-0.18, 0.3], [-0.18, -0.3]]) put(bronze, cyl8, x + dx, 0.9, z + dz, 0, 0.05, 1.8, 0.05, dz * 0.25, -dx * 0.25);
      put(bronze, new THREE.SphereGeometry(0.62, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), x, 2.05, z, 0, 1, 0.7, 1); put(bronze, new THREE.TorusGeometry(0.62, 0.05, 6, 20), x, 2.05, z, 0, 1, 1, 1, Math.PI / 2);
      flames.push([x, 2.7, z, 0, 0.5, 1.4, 0, 0, 0.5]); }
    const fl = inst(new THREE.ConeGeometry(1, 1, 10, 4, true), fireM, flames); const cores = flames.map(f => [f[0], 2.45, f[2], 0, 0.28, 0.8, 0, 0, 0.28]); inst(new THREE.ConeGeometry(1, 1, 8, 3, true), coreM, cores);
    // embers: sparks rising from each brazier, moved on the graphics chip
    const N = 120, seed = new Float32Array(N * 4); for (let i = 0; i < N; i++) { const s = spots[i % spots.length]; seed[i * 4] = s[0]; seed[i * 4 + 1] = s[1]; seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random() * 6.28; }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3)); eg.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const em = new THREE.PointsMaterial({ color: '#FFB347', size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    em.onBeforeCompile = sh => { sh.uniforms.uT = fireU; sh.vertexShader = 'uniform float uT; attribute vec4 seed;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'float t = fract(uT * 0.35 + seed.z); vec3 transformed = vec3(seed.x + sin(seed.w + t * 5.0) * 0.5 * t, 2.6 + t * 5.0, seed.y + cos(seed.w + t * 4.0) * 0.5 * t);'); };
    const pts = new THREE.Points(eg, em); pts.frustumCulled = false; scene.add(pts); movers.push((dt, now) => { fireU.value = now / 1000; }); }
  // ---- the sand: a laurel wreath and the colony's name raked into it ----
  { const t = tex((c, n) => { c.clearRect(0, 0, n, n); c.strokeStyle = 'rgba(150,110,60,.45)'; c.lineWidth = 6; c.beginPath(); c.arc(n / 2, n / 2, n * 0.38, Math.PI * 0.62, Math.PI * 2.38); c.stroke();
      for (let i = 0; i < 26; i++) { const a = Math.PI * 0.66 + i / 25 * Math.PI * 1.68, x = n / 2 + Math.cos(a) * n * 0.38, y = n / 2 + Math.sin(a) * n * 0.38; for (const s of [-1, 1]) { c.fillStyle = 'rgba(140,100,55,.4)'; c.beginPath(); c.ellipse(x + Math.cos(a) * s * 14, y + Math.sin(a) * s * 14, 13, 5, a + s * 0.7, 0, 7); c.fill(); } }
      c.fillStyle = 'rgba(130,95,50,.42)'; c.font = '700 46px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('RESVRGENCE', n / 2, n / 2); }, 512, 512, false);
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }); view.mats.push(m); const d = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), m); d.rotation.x = -Math.PI / 2; d.position.y = 0.022; scene.add(d); }
  // ---- the awning (velarium): sails of red and cream on ropes from the masts, open in the middle ----
  { const N = 32, r0 = RT - 5, r1 = ROUT + 1.6, y0 = YT + 10.6, y1 = YT + 12.6, pos = [], col = [], idx = [], c1 = new THREE.Color('#EFE4CC'), c2 = new THREE.Color('#A8352B');
    for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2; for (let j = 0; j <= 4; j++) { const t = j / 4, r = r0 + (r1 - r0) * t, sag = Math.sin(t * Math.PI) * 0.7 * (0.6 + 0.4 * Math.abs(Math.sin(i / N * Math.PI * N))); pos.push(Math.cos(a) * r * SX, y0 + (y1 - y0) * t - sag, Math.sin(a) * r); const cc = (Math.floor(i) % 2 ? c1 : c2); col.push(cc.r, cc.g, cc.b); } }
    for (let i = 0; i < N; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 5; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const sails = new THREE.Mesh(g, mat({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, flatShading: true })); scene.add(sails);
    // ropes: from each mast to a ring hanging over the sand
    const rp = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; rp.push(Math.cos(a) * r1 * SX, y1 + 1.5, Math.sin(a) * r1, Math.cos(a) * (r0 - 0.5) * SX, y0 - 0.2, Math.sin(a) * (r0 - 0.5)); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); scene.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#6B5A44' })));
    // pennants on the masts, fluttering (a few numbers, ten times a second)
    const pen = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, [x, z] = at(ROUT + 1.6, a); pen.push([x, YT + 13.6, z, -a, 0.7, 0.35, 0, 0, 1]); }
    const pg = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0); const pm = inst(pg, mat({ side: THREE.DoubleSide, roughness: 0.8 }), pen, false, ['#8A2A22', '#C9A227', '#5B2A6E']);
    if (pm) { let tb = 0; movers.push((dt, now) => { tb += dt; if (tb < 0.1) return; tb = 0; pen.forEach((t, i) => { M4.compose(V.set(t[0], t[1], t[2]), Q.setFromEuler(E.set(0, t[3] + Math.sin(now / 300 + i) * 0.35, Math.sin(now / 200 + i * 2) * 0.12)), S3.set(t[4], t[5], 1)); pm.setMatrixAt(i, M4); }); pm.instanceMatrix.needsUpdate = true; }); } }
  // ---- garlands of laurel along the front of the first tier ----
  { const leaves = [], n = 160; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, sag = Math.abs(Math.sin(i / n * Math.PI * 16)) * 0.35, [x, z] = at(R0 + 0.72, a); if (Math.abs(Math.cos(a)) > 0.96) continue; leaves.push([x, PODIUM + 0.25 - sag, z, -a, 0.16, 0.1, 0, 0, 0.16]); }
    inst(new THREE.IcosahedronGeometry(1, 0), mat({ color: '#3E6B35', roughness: 0.9, flatShading: true }), leaves); }

  flush(new Set([marble, stone, bronze]));
  return { update(dt, now) { for (const f of movers) f(dt, now); } };
}

// Fold every still mesh (userData.static) into one mesh per look: tens of draws become a handful. Meshes that change
// (lit jets, fighters, flames, screens) aren't marked, so they stay as they are.
export function mergeStatic(scene) {
  const groups = new Map(), drop = [];
  for (const o of scene.children) { if (!o.isMesh || o.isInstancedMesh || !o.userData.static) continue; const m = o.material; if (Array.isArray(m)) continue;
    const key = [m.type, m.color && m.color.getHex(), m.roughness, m.metalness, m.map ? m.map.uuid : '', m.side, m.transparent, m.opacity, m.emissive && m.emissive.getHex(), m.vertexColors].join('|');
    let g = o.geometry.clone(); o.updateMatrix(); g.applyMatrix4(o.matrix); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (g.index) g = g.toNonIndexed();
    (groups.get(key) || groups.set(key, { m, list: [], cast: false }).get(key)).list.push(g); groups.get(key).cast ||= o.castShadow; drop.push(o); }
  for (const o of drop) { scene.remove(o); o.geometry.dispose(); }
  let n = 0; for (const { m, list, cast } of groups.values()) { const g = mergeGeometries(list, false); for (const x of list) x.dispose(); if (!g) continue; const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; o.matrixAutoUpdate = false; scene.add(o); n++; }
  return { merged: drop.length, into: n };
}
