// The Colosseum in 3D, for Fight Night: the sand where the fighters fight, the stone bowl of the stands (tiers you
// can walk up and sit on, and a crowd that fills the seats nobody real is in), the arches and the torches, the two
// gates the fighters walk out of, the imperial box, the big screen over the sand, the billboard and, on gladiator
// nights, the weapons and the fire jets.
//
// The fight itself comes from the server (snapshots, 15 a second: see shared/brawl.js); this file draws it a tenth
// of a second behind (so it's smooth), poses the fighters (guard, jab, heavy, specials, block, dodge, down), and
// throws in the sparks, the dust, the camera shake and the slow-motion replays.
//
// createColosseum(host, opts) opts: minute(), weather(), look, pet, onMove(x, z, a, pose), onTick(),
//   screen() → { lines, img } for the big screen, billboard() → [image urls].
import * as THREE from 'three';
import * as W from '/world3d.js';
import { follower, pickPet } from '/creature3d.js';
import * as BR from '/shared/brawl.js';
import { decorate, mergeStatic } from '/colodecor.js';
import { makeCrowd } from '/crowdfig.js';

const SX = 1.22; // the bowl is an ellipse: x is stretched this much
export function createColosseum(host, opts) {
  const canvas = document.createElement('canvas'); canvas.className = 'track3d'; host.append(canvas);
  const view = W.createView(canvas), { scene, camera, renderer } = view; camera.fov = 55; camera.near = 0.2; camera.far = 700; camera.updateProjectionMatrix();
  view.center.set(0, 0, 0); view.span = 60;
  const std = (c, r = 0.85, m = 0, extra = {}) => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra }); view.mats.push(x); return x; };
  const add = (g, m, x, y, z, ry = 0, shadow = true) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = shadow; o.userData.static = true; /* (merged with the rest once it's all built: see colodecor.js) */ scene.add(o); return o; };
  const tex = (draw, n = 256, rep = true) => { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const R0 = 10, PODIUM = 2.6, ROWS = 10, ROW_D = 1.25, ROW_H = 0.78, Y0 = PODIUM + 0.3, RT = R0 + 0.7 + ROWS * ROW_D, YT = Y0 + ROWS * ROW_H, ROUT = RT + 3.2;
  const er = (x, z) => Math.hypot(x / SX, z); /* "radius" on the ellipse */
  // ---- the ground outside, and the sand ----
  const stoneT = tex((g, n) => { g.fillStyle = '#CDBB97'; g.fillRect(0, 0, n, n); for (let i = 0; i < 2600; i++) { const k = Math.random(); g.fillStyle = `rgba(${150 + k * 70},${130 + k * 60},${95 + k * 45},.35)`; g.fillRect(Math.random() * n, Math.random() * n, 2 + Math.random() * 3, 1 + Math.random() * 2); }
    g.strokeStyle = 'rgba(90,75,55,.35)'; g.lineWidth = 1.5; for (let y = 0; y < n; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke(); for (let x = (y / 32) % 2 * 32; x < n; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } } });
  const sandT = tex((g, n) => { g.fillStyle = '#E2C88F'; g.fillRect(0, 0, n, n); for (let i = 0; i < 5000; i++) { const k = Math.random(); g.fillStyle = `rgba(${190 + k * 50},${150 + k * 50},${95 + k * 40},.45)`; g.fillRect(Math.random() * n, Math.random() * n, 1.5, 1.5); } });
  sandT.repeat.set(5, 5); stoneT.repeat.set(1, 1);
  const ground = add(new THREE.PlaneGeometry(600, 600), std('#7DA65A', 1), 0, -0.05, 0, 0, false); ground.rotation.x = -Math.PI / 2;
  const sand = add(new THREE.CircleGeometry(R0, 64), new THREE.MeshStandardMaterial({ map: sandT, roughness: 1 }), 0, 0.01, 0, 0, false); sand.rotation.x = -Math.PI / 2; sand.scale.set(SX, 1, 1); view.mats.push(sand.material); sand.receiveShadow = true;
  // a ring painted in the sand where the fight happens, and the two corners
  { const ring = add(new THREE.RingGeometry(BR.ARENA - 0.06, BR.ARENA + 0.06, 96), std('#B8935A', 1), 0, 0.02, 0, 0, false); ring.rotation.x = -Math.PI / 2;
    for (const [x, c] of [[-3.2, '#C0392B'], [3.2, '#2E6FD8']]) { const d = add(new THREE.CircleGeometry(0.55, 32), std(c, 0.9), x, 0.025, 0, 0, false); d.rotation.x = -Math.PI / 2; } }
  // ---- the podium wall round the sand, the gates and the stepped stands (one shape, turned round), the top walkway ----
  const stoneM = new THREE.MeshStandardMaterial({ map: stoneT, color: '#E9DCC0', roughness: 0.95 }); view.mats.push(stoneM);
  { const prof = [[R0, 0], [R0, PODIUM], [R0 + 0.7, PODIUM], [R0 + 0.7, Y0]]; for (let r = 0; r < ROWS; r++) { const x = R0 + 0.7 + r * ROW_D; prof.push([x, Y0 + r * ROW_H], [x, Y0 + (r + 1) * ROW_H], [x + ROW_D, Y0 + (r + 1) * ROW_H]); }
    prof.push([RT, YT], [ROUT, YT], [ROUT, YT + 3.6], [ROUT + 0.9, YT + 3.6], [ROUT + 0.9, 0]);
    const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 72); const uv = g.attributes.uv, P = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.atan2(P.getZ(i), P.getX(i)) * 6, P.getY(i) * 0.5 + Math.hypot(P.getX(i), P.getZ(i)) * 0.3);
    const bowl = add(g, stoneM, 0, 0, 0); bowl.scale.set(SX, 1, 1); bowl.material.side = THREE.DoubleSide; }
  // marble seat fronts on each tier (a lighter band), and the coloured cushions of the good rows
  for (let r = 0; r < ROWS; r++) { const rr = R0 + 0.7 + r * ROW_D + 0.02, g = new THREE.CylinderGeometry(rr, rr, 0.06, 72, 1, true), o = add(g, std(r < 2 ? '#8A2A22' : '#F1EBDD', 0.7), 0, Y0 + (r + 1) * ROW_H - 0.03, 0, 0, false); o.scale.set(SX, 1, 1); o.material.side = THREE.DoubleSide; }
  // a band of red and gold round the top of the podium wall
  { const b = add(new THREE.CylinderGeometry(R0 + 0.02, R0 + 0.02, 0.35, 72, 1, true), std('#8A2A22', 0.6), 0, PODIUM - 0.25, 0, 0, false); b.scale.set(SX, 1, 1); b.material.side = THREE.DoubleSide;
    const g2 = add(new THREE.CylinderGeometry(R0 + 0.03, R0 + 0.03, 0.08, 72, 1, true), std('#C9A227', 0.35, 0.6), 0, PODIUM - 0.05, 0, 0, false); g2.scale.set(SX, 1, 1); g2.material.side = THREE.DoubleSide; }
  // the outer wall's arches (seen from the top walkway): pillars with arches between, three storeys
  { const n = 48, pil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1, 1.1), stoneM, n * 2), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, x = Math.cos(a) * (ROUT + 1.6) * SX, z = Math.sin(a) * (ROUT + 1.6); q.setFromEuler(e.set(0, -a, 0));
      M.compose(new THREE.Vector3(x, YT / 2, z), q, new THREE.Vector3(1, YT, 1)); pil.setMatrixAt(i, M); M.compose(new THREE.Vector3(x, YT + 4.6, z), q, new THREE.Vector3(1, 2.4, 1)); pil.setMatrixAt(n + i, M); }
    pil.castShadow = true; scene.add(pil);
    const ring = add(new THREE.CylinderGeometry(ROUT + 2, ROUT + 2, 0.8, 72, 1, true), stoneM, 0, YT + 6.2, 0, 0, false); ring.scale.set(SX, 1, 1); ring.material.side = THREE.DoubleSide; }
  // the two gates the fighters walk out of (east and west), with portcullises
  for (const s of [-1, 1]) { const x = s * R0 * SX; add(new THREE.BoxGeometry(0.5, 3.6, 3.4), stoneM, x + s * 0.2, 1.8, 0); const dark = add(new THREE.BoxGeometry(0.3, 2.6, 2.4), std('#1b1612', 1), x, 1.3, 0, 0, false);
    for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.06, 2.6, 0.06), std('#3B3B40', 0.4, 0.7), x - s * 0.18, 1.3, -1.0 + k * 0.4, 0, false); add(new THREE.BoxGeometry(0.4, 0.3, 3.6), std(s < 0 ? '#C0392B' : '#2E6FD8', 0.6), x - s * 0.1, 3.0, 0); }
  // the imperial box, north side, with its canopy
  const BOXZ = -(R0 + 0.7 + 1.2); { const y = Y0 + ROW_H * 1.5; add(new THREE.BoxGeometry(5.2, 0.15, 2.6), std('#8A2A22', 0.7), 0, y, BOXZ - 0.6); for (const x of [-2.4, 2.4]) add(new THREE.CylinderGeometry(0.14, 0.16, 3, 10), std('#F1EBDD', 0.5), x, y + 1.5, BOXZ + 0.5);
    add(new THREE.BoxGeometry(5.6, 0.18, 3.2), std('#8A2A22', 0.6), 0, y + 3.05, BOXZ - 0.5); add(new THREE.BoxGeometry(5.7, 0.4, 0.1), std('#C9A227', 0.35, 0.6), 0, y + 2.85, BOXZ + 1.1);
    for (const x of [-1.2, 0, 1.2]) { add(new THREE.BoxGeometry(0.8, 1.1, 0.7), std('#C9A227', 0.35, 0.5), x, y + 0.6, BOXZ - 1.1); add(new THREE.BoxGeometry(0.7, 0.18, 0.6), std('#8A2A22', 0.8), x, y + 0.5, BOXZ - 0.85); } }
  // banners hanging down the podium wall, in red and gold
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 + Math.PI / 16; if (Math.abs(Math.cos(a)) > 0.93) continue; const b = add(new THREE.PlaneGeometry(1.1, 1.9), std(i % 2 ? '#8A2A22' : '#C9A227', 0.8, 0, { side: THREE.DoubleSide }), Math.cos(a) * (R0 - 0.04) * SX, PODIUM - 1.25, Math.sin(a) * (R0 - 0.04), -a - Math.PI / 2, false); b.lookAt(0, PODIUM - 1.25, 0); }
  // ---- torches round the podium (their flames flicker; two real lights after dark), and the velarium's masts ----
  const flames = [], flameM = new THREE.MeshBasicMaterial({ color: '#FFB347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, x = Math.cos(a) * (R0 + 0.35) * SX, z = Math.sin(a) * (R0 + 0.35); if (Math.abs(Math.cos(a)) > 0.97) continue;
    add(new THREE.CylinderGeometry(0.05, 0.08, 0.9, 6), std('#3B3B40', 0.5, 0.6), x, PODIUM + 0.45, z, 0, false); add(new THREE.CylinderGeometry(0.16, 0.08, 0.2, 8), std('#2B2621', 0.6, 0.5), x, PODIUM + 0.95, z, 0, false);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 8), flameM); f.position.set(x, PODIUM + 1.3, z); scene.add(f); flames.push(f); }
  const torchL = [new THREE.PointLight('#FFB060', 0, 26, 1.6), new THREE.PointLight('#FFB060', 0, 26, 1.6)]; torchL[0].position.set(-8, 5, -4); torchL[1].position.set(8, 5, 4); scene.add(...torchL);
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; add(new THREE.CylinderGeometry(0.12, 0.15, 7, 8), std('#7A5233', 0.8), Math.cos(a) * (ROUT + 1.6) * SX, YT + 9.4, Math.sin(a) * (ROUT + 1.6), 0, false); }
  /* (the awning: sails on ropes, in colodecor.js) */
  // ---- the fire jets: grates in the sand that glow, then roar (gladiator nights) ----
  const jets = BR.JETS.map(J => { const grate = add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20), std('#7C766E', 0.45, 0.75, { emissive: '#FF5A1F', emissiveIntensity: 0 }), J.x, 0.03, J.z, 0, false); grate.userData.static = false; /* (it glows: not merged) */
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.6, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#FF7A1F', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    fire.position.set(J.x, 1.8, J.z); fire.visible = false; scene.add(fire); const core = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.4, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#FFE38A', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); core.position.y = -0.4; fire.add(core); return { grate, fire }; });
  const jetLight = new THREE.PointLight('#FF6A1F', 0, 14, 1.5); jetLight.position.y = 2; scene.add(jetLight); let gladiator = false; jets.forEach(j => j.grate.visible = false);
  // weapon racks by each gate (gladiator nights)
  const racks = new THREE.Group(); scene.add(racks); racks.visible = false;
  for (const s of [-1, 1]) { const x = s * (R0 - 1.2) * SX, z = 2.6; { const r = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 2.2), std('#7A5233', 0.8)); r.position.set(x, 0.8, z); racks.add(r); }
    for (let k = 0; k < 4; k++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, 0.06), std(['#BDC3C7', '#7A5233', '#C9A227', '#95A5A6'][k], 0.35, 0.7)); w.position.set(x - s * 0.15, 1.0, z - 0.8 + k * 0.5); w.rotation.z = s * 0.15; racks.add(w); } }
  // ---- the big screen over the sand (four faces), and the billboard at the top of the stands ----
  const scrC = document.createElement('canvas'); scrC.width = 1024; scrC.height = 512; const scrT = new THREE.CanvasTexture(scrC); scrT.colorSpace = THREE.SRGBColorSpace;
  const scrM = new THREE.MeshBasicMaterial({ map: scrT, toneMapped: false }), SCR_Y = 15.5, scrBox = new THREE.Group(); { const box = scrBox; box.position.set(0, SCR_Y, 0); scene.add(box);
    box.add(new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.4, 8.4), std('#1d1f24', 0.6, 0.3))); for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), scrM); const a = k * Math.PI / 2; p.position.set(Math.sin(a) * 4.22, 0, Math.cos(a) * 4.22); p.rotation.y = a; box.add(p); }
    for (const [x, z] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, YT + 12.6 - SCR_Y, 4), std('#3B3B40', 0.4, 0.8)); c.position.set(x * 1.6, (YT + 12.6 - SCR_Y) / 2 + 2.2, z * 1.6); box.add(c); } }
  const bbC = document.createElement('canvas'); bbC.width = 1024; bbC.height = 512; const bbT = new THREE.CanvasTexture(bbC); bbT.colorSpace = THREE.SRGBColorSpace;
  { const bb = new THREE.Group(); bb.position.set(0, YT + 4.2, (RT + 1.2)); bb.rotation.y = Math.PI; scene.add(bb); bb.add(new THREE.Mesh(new THREE.BoxGeometry(13, 6.8, 0.4), std('#2B2621', 0.6)));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(12.4, 6.2), new THREE.MeshBasicMaterial({ map: bbT, toneMapped: false })); face.position.z = 0.21; bb.add(face); }
  const imgs = new Map(); const imgOf = url => { if (!url) return null; let im = imgs.get(url); if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { scrKey = ''; bbKey = ''; }; im.src = url; imgs.set(url, im); } return im.complete && im.naturalWidth ? im : null; };
  const cover = (g, im, w, h) => { const r = Math.max(w / im.naturalWidth, h / im.naturalHeight), iw = im.naturalWidth * r, ih = im.naturalHeight * r; g.drawImage(im, (w - iw) / 2, (h - ih) / 2, iw, ih); };
  let bbKey = '', bbAt = 0, bbI = 0;
  function paintBillboard(now) { const L = (opts.billboard && opts.billboard()) || []; if (now - bbAt > 9000) { bbAt = now; bbI++; } const url = L.length ? L[bbI % L.length] : null, im = imgOf(url), key = url + '|' + !!im; if (key === bbKey) return; bbKey = key;
    const g = bbC.getContext('2d'); g.fillStyle = '#14100c'; g.fillRect(0, 0, 1024, 512);
    if (im) cover(g, im, 1024, 512); else { g.fillStyle = '#C9A227'; g.font = '900 92px Georgia, serif'; g.textAlign = 'center'; g.fillText('FIGHT NIGHT', 512, 230); g.fillStyle = '#F1EBDD'; g.font = '600 40px system-ui, sans-serif'; g.fillText('at the Colosseum', 512, 300); }
    bbT.needsUpdate = true; }
  // the big screen: the fighters' names, health and stamina, the round and the clock, the crowd's roar; between bouts the billboard
  let scrKey = '';
  function paintScreen(now) { const S = (opts.screen && opts.screen()) || {}, st = cur, key = JSON.stringify([S.lines, S.img, st && [st.ph, st.r, Math.ceil(st.pt), st.f.map(f => [f[3], Math.round(f[4] / 5), Math.round(f[9] * 10)])], replay ? 1 : 0, Math.floor(now / 9000)]);
    if (key === scrKey) return; scrKey = key; const g = scrC.getContext('2d'); g.fillStyle = '#0d0f14'; g.fillRect(0, 0, 1024, 512);
    const live = st && st.ph !== 'over' && S.names;
    if (!live) { const L = (opts.billboard && opts.billboard()) || [], im = imgOf(L.length ? L[Math.floor(now / 9000) % L.length] : null); if (im) cover(g, im, 1024, 512);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 372, 1024, 140); g.fillStyle = '#F2C94C'; g.font = '800 46px system-ui, sans-serif'; g.textAlign = 'center'; (S.lines || ['🥊 Fight Night']).slice(0, 2).forEach((l, i) => { g.fillStyle = i ? '#E8F4FF' : '#F2C94C'; g.font = i ? '600 36px system-ui, sans-serif' : '800 46px system-ui, sans-serif'; g.fillText(l, 512, 428 + i * 52); }); scrT.needsUpdate = true; return; }
    g.textAlign = 'center'; g.fillStyle = '#F2C94C'; g.font = '800 44px system-ui, sans-serif'; g.fillText(replay ? '⏪ REPLAY' : st.ph === 'walk' ? 'THE WALK-OUT' : st.ph === 'break' ? `END OF ROUND ${st.r}` : st.ph === 'verdict' ? 'THE VERDICT' : `ROUND ${st.r}  ·  ${Math.floor(st.pt / 60)}:${String(Math.floor(st.pt % 60)).padStart(2, '0')}`, 512, 64);
    for (const k of [0, 1]) { const f = st.f[k], x0 = k ? 552 : 40, c = k ? '#2E6FD8' : '#C0392B'; g.textAlign = k ? 'right' : 'left'; g.fillStyle = '#fff'; g.font = '800 40px system-ui, sans-serif'; g.fillText((S.names[k] || '').slice(0, 18), k ? 984 : 40, 140);
      g.fillStyle = '#9fb0c4'; g.font = '600 26px system-ui, sans-serif'; g.fillText(S.subs ? S.subs[k] || '' : '', k ? 984 : 40, 178);
      const bar = (y, h, v, col) => { g.fillStyle = '#2a2f3a'; g.fillRect(x0, y, 432, h); g.fillStyle = col; const w = 432 * Math.max(0, Math.min(1, v)); g.fillRect(k ? x0 + 432 - w : x0, y, w, h); };
      bar(206, 34, f[3] / 100, f[3] > 50 ? '#3FBF6A' : f[3] > 25 ? '#F2C94C' : '#E0453A'); bar(250, 14, f[4] / 100, '#4FC3F7'); bar(272, 10, f[9], c); }
    g.textAlign = 'center'; g.fillStyle = '#E8F4FF'; g.font = '600 34px system-ui, sans-serif'; (S.lines || []).slice(0, 3).forEach((l, i) => g.fillText(l, 512, 350 + i * 46)); scrT.needsUpdate = true; }
  // ---- the crowd: a few hundred whole people sitting in the seats nobody real is in (crowdfig.js: a handful of draws);
  // they bounce and throw their arms up when the crowd roars ----
  const hypeU = { value: 0 }, timeU = { value: 0 }; let crowd = null; const FOLK = [];
  { const spots = [], N = 600; for (let r = 0; r < ROWS && spots.length < N; r++) { const rr = R0 + 0.7 + r * ROW_D + 0.4, cnt = Math.floor(2 * Math.PI * rr * 1.1 / 0.62); for (let i = 0; i < cnt && spots.length < N; i++) { const a = i / cnt * Math.PI * 2 + r * 0.13;
      if (Math.random() < 0.38) continue; const x = Math.cos(a) * rr * SX, z = Math.sin(a) * rr; if (Math.abs(x) < 3.2 && z < 0 && r < 4) continue; /* (the imperial box) */ if (Math.abs(z) < 2.2 && r < 3) continue; /* (the gates) */
      spots.push([x, Y0 + (r + 1) * ROW_H + 0.01, z, Math.atan2(-x, -z)]); } } /* (on the step's front edge, legs over it, facing the sand) */
    crowd = makeCrowd({ scene, spots, pose: 'sit', hype: hypeU, time: timeU, shoes: false, mats: view.mats, tops: ['#F1EBDD', '#C8B48A', '#8A2A22', '#E8DCC0', '#4F6E8C', '#B5743A', '#5B2A6E', '#D9C9A6', '#7A8B3C', '#A8352B'] }); } /* (Roman tunics; sandals don't show from the stands) */
  function mergeTwo(a, b) { const g = new THREE.BufferGeometry(), pa = a.toNonIndexed(), pb = b.toNonIndexed(); for (const k of ['position', 'normal']) { const A = pa.attributes[k].array, B = pb.attributes[k].array, out = new Float32Array(A.length + B.length); out.set(A); out.set(B, A.length); g.setAttribute(k, new THREE.BufferAttribute(out, 3)); } return g; }
  // ---- you, walking about the stands (like at the races): the stick or WASD walks, dragging looks round ----
  const tierAt = (x, z) => { const r = er(x, z); if (r < R0 + 0.7) return -1; if (r >= RT) return ROWS; return Math.floor((r - R0 - 0.7) / ROW_D); };
  const floorY = (x, z) => { const t = tierAt(x, z); return t < 0 ? 0 : t >= ROWS ? YT : Y0 + (t + 1) * ROW_H + (t < 0 ? 0 : 0); };
  const free = (x, z) => { const r = er(x, z); if (r < R0 + 0.75) return false; if (r > ROUT - 0.3) return false; return true; };
  const spawnA = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, spawnR = R0 + 0.7 + ROW_D * (2.5 + Math.random() * 2);
  const me = { x: Math.cos(spawnA) * spawnR * SX, z: Math.sin(spawnA) * spawnR, y: 0, yaw: 0, pitch: -0.25, sit: false, P: W.makePerson('me', null, opts.look || null) }; scene.add(me.P.group);
  me.yaw = Math.atan2(me.x, me.z); /* (facing the sand) */ me.y = floorY(me.x, me.z);
  let myPet = null; if (opts.pet) { try { myPet = follower(opts.pet); scene.add(myPet.group); } catch (e) {} }
  const keys = new Set(), joy = { x: 0, y: 0 }; const kd = e => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; keys.add(e.key.toLowerCase()); }, ku = e => keys.delete(e.key.toLowerCase()); addEventListener('keydown', kd); addEventListener('keyup', ku);
  const stick = document.createElement('div'); stick.className = 'hjoy'; stick.innerHTML = '<i></i>'; host.append(stick); { let id = null; const knob = stick.firstChild;
    const mv = e => { const r = stick.getBoundingClientRect(), Rr = r.width / 2; let dx = (e.clientX - r.left - Rr) / Rr, dy = (e.clientY - r.top - Rr) / Rr; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * Rr * 0.6}px,${dy * Rr * 0.6}px)`; };
    stick.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; stick.setPointerCapture(id); mv(e); }); stick.addEventListener('pointermove', e => { if (e.pointerId === id) mv(e); });
    const end = () => { id = null; joy.x = joy.y = 0; knob.style.transform = ''; }; stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end); }
  const lk = { id: null, x: 0, y: 0 }; canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { if (lk.id != null) return; lk.id = e.pointerId; lk.x = e.clientX; lk.y = e.clientY; lk.x0 = e.clientX; lk.y0 = e.clientY; lk.t0 = performance.now(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== lk.id) return; me.yaw -= (e.clientX - lk.x) * 0.006; me.pitch = Math.max(-1.2, Math.min(1.0, me.pitch - (e.clientY - lk.y) * 0.004)); lk.x = e.clientX; lk.y = e.clientY; });
  let tapped = null; const tapPet = e => { if (!opts.onPet) return; const list = []; if (myPet && myPet.group.visible) list.push({ group: myPet.group, mine: true, id: 'me', pet: myPet }); for (const [id, o] of others) if (o.pet) list.push({ group: o.pet.group, mine: false, id, owner: o.h || null, pet: o.pet });
    const hit = pickPet(camera, canvas, e, list); if (!hit) return; tapped = hit.pet; opts.onPet({ mine: hit.mine, id: hit.id, owner: hit.owner, kind: hit.pet.kind }); }; /* a tap on a pet: yours (follow or go home) or someone else's (a pat) */
  const lkEnd = e => { if (e.pointerId === lk.id) { lk.id = null; if (e.type === 'pointerup' && Math.hypot(e.clientX - lk.x0, e.clientY - lk.y0) < 9 && performance.now() - lk.t0 < 450) tapPet(e); } }; canvas.addEventListener('pointerup', lkEnd); canvas.addEventListener('pointercancel', lkEnd);
  // the stick, as a direction on the ground (the way the camera looks): for walking, or for your fighter
  const stickDir = () => { const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - joy.y, st = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + joy.x;
    const yaw = fighting() ? camYaw : me.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx, m = Math.min(1, Math.hypot(f, st)); if (m < 0.08) return { mx: 0, mz: 0 }; const l = Math.max(1, Math.hypot(f, st));
    return { mx: (fx * f + rx * st) / l, mz: (fz * f + rz * st) / l }; };
  let sitAt = null; const bench = () => { const t = tierAt(me.x, me.z); return t >= 0 && t < ROWS ? t : -1; };
  function sitDown() { const t = bench(); if (t < 0) return false; const r = R0 + 0.7 + t * ROW_D + 0.4, a = Math.atan2(me.z, me.x / SX); /* (on the step's front edge, legs over it) */ me.x = Math.cos(a) * r * SX; me.z = Math.sin(a) * r; me.sit = true; sitAt = Y0 + (t + 1) * ROW_H - 0.46; /* (a sitting character's hips are 0.48 above its feet: they rest on the stone) */ me.yaw = Math.atan2(me.x, me.z);
    const A = me.P.av || me.P; if (A.pose) A.pose('sit'); me.P.group.rotation.y = Math.atan2(-me.x, -me.z); return true; }
  function standUp() { if (!me.sit) return; me.sit = false; sitAt = null; const A = me.P.av || me.P; if (A.pose) A.pose('stand'); }
  let moved = 0, mineSide = null;
  const fighting = () => mineSide != null && cur && cur.ph !== 'over';
  function walkMe(dt) { if (fighting()) { me.P.group.visible = false; if (myPet) myPet.group.visible = false; return; } if (myPet) myPet.group.visible = true;
    const d = stickDir(), m = Math.hypot(d.mx, d.mz); if (m > 0.08 && me.sit) standUp();
    if (m > 0.08) { const dx = d.mx * 3.2 * dt, dz = d.mz * 3.2 * dt; if (free(me.x + dx, me.z)) me.x += dx; if (free(me.x, me.z + dz)) me.z += dz; moved += Math.hypot(dx, dz); me.P.animate(dt, dx / dt, dz / dt); }
    else if (!me.sit) me.P.animate(dt, 0, 0);
    const ty = me.sit ? sitAt : floorY(me.x, me.z); me.y += (ty - me.y) * Math.min(1, dt * 12); me.P.setPos(me.x, me.z); me.P.group.position.y = me.y; if (me.sit) me.P.group.rotation.y = Math.atan2(-me.x, -me.z);
    if (myPet) { myPet.step(dt, me.x, me.z); myPet.group.position.y = me.y; }
    if (opts.onMove && moved > 0.15) { moved = 0; opts.onMove(me.x, me.z, me.P.group.rotation.y, me.sit ? 's' : ''); } }
  // ---- other people in the stands: where they say they are, with their names and pets ----
  const others = new Map();
  function upsertOther(id, p) { let o = others.get(id); if (o && p.look && !o.look) { removeOther(id); o = null; }
    if (!o) { const P = W.makePerson(id, null, p.look || null); scene.add(P.group); const tag = W.nameTag(p.h ? '@' + p.h : 'a visitor'); tag.scale.set(1.6, 0.4, 1); tag.position.set(0, 2.15, 0); P.group.add(tag); o = { P, h: p.h || null, look: !!p.look, x: p.x, z: p.z, tx: p.x, tz: p.z, sit: false }; P.setPos(p.x, p.z); others.set(id, o); }
    o.tx = p.x; o.tz = p.z; const s2 = p.pose === 's'; if (s2 !== o.sit) { o.sit = s2; const A = o.P.av || o.P; if (A.pose) A.pose(s2 ? 'sit' : 'stand'); } }
  function removeOther(id) { const o = others.get(id); if (!o) return; scene.remove(o.P.group); if (o.pet) o.pet.dispose(); others.delete(id); }
  function setPet(id, kind) { const o = others.get(id); if (!o || (o.pet && o.pet.kind === kind)) return; if (o.pet) { o.pet.dispose(); o.pet = null; } if (kind) try { o.pet = follower(kind, { side: -1 }); o.pet.kind = kind; scene.add(o.pet.group); } catch (e) {} }
  function stepOthers(dt) { const k = Math.min(1, dt * 6); for (const o of others.values()) { const dx = o.tx - o.x, dz = o.tz - o.z; o.x += dx * k; o.z += dz * k; o.P.setPos(o.x, o.z); const t = tierAt(o.x, o.z); o.P.group.position.y = t < 0 ? 0 : t >= ROWS ? YT : Y0 + (t + 1) * ROW_H + (o.sit ? -0.46 : 0);
      if (o.sit) o.P.group.rotation.y = Math.atan2(-o.x, -o.z); else o.P.animate(dt, dx * k / Math.max(dt, 1e-3), dz * k / Math.max(dt, 1e-3)); if (o.pet) { o.pet.step(dt, o.x, o.z); o.pet.group.position.y = o.P.group.position.y; } } }
  const bubbles = new Map();
  function say(id, text) { const on = id === 'me' ? me.P.group : others.get(id)?.P.group; if (!on) return; const old = bubbles.get(id); if (old) { old.sp.parent && old.sp.parent.remove(old.sp); old.sp.material.map.dispose(); }
    const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 512; c.height = 128; g.font = '600 34px sans-serif'; const t = String(text).length > 60 ? String(text).slice(0, 58) + '…' : String(text), w = Math.min(500, g.measureText(t).width + 40);
    g.fillStyle = 'rgba(255,255,255,.96)'; if (g.roundRect) { g.beginPath(); g.roundRect((512 - w) / 2, 20, w, 80, 24); g.fill(); } else g.fillRect((512 - w) / 2, 20, w, 80); g.fillStyle = '#1C1C1E'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 256, 60);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })); sp.scale.set(2.6, 0.65, 1); sp.position.set(0, 2.6, 0); sp.renderOrder = 6; on.add(sp); bubbles.set(id, { sp, until: performance.now() + 7000 }); }
  // ---- the fighters ----
  // Two people on the sand, posed from the fight as it comes in: guard up, each move's wind-up, strike and recovery,
  // the block, the dodge, being rocked, down on the canvas. With a weapon (and a shield) on gladiator nights.
  const F = [null, null]; let card = null;
  function weaponMesh(w) { const g = new THREE.Group(), steel = std('#C8CDD2', 0.25, 0.85), wood = std('#6B4428', 0.8), gold = std('#C9A227', 0.3, 0.8), box = (sx, sy, sz, m, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); o.position.set(0, y, z); g.add(o); return o; };
    if (w === 'gladius' || w === 'sword' || w === 'daggers') { const L = w === 'sword' ? 1.05 : w === 'daggers' ? 0.3 : 0.62; box(0.05, 0.14, 0.05, wood, -0.07); box(0.18, 0.03, 0.05, gold, 0.01); const b = box(0.06, L, 0.015, steel, 0.03 + L / 2); }
    else if (w === 'spear' || w === 'trident') { box(0.04, 2.0, 0.04, wood, 0.4); if (w === 'spear') { const t = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 6), steel); t.position.y = 1.55; g.add(t); } else for (const x of [-0.09, 0, 0.09]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.3, 5), steel); t.position.set(x, 1.55, 0); g.add(t); } }
    else if (w === 'axe') { box(0.05, 1.0, 0.05, wood, 0.25); const h = box(0.36, 0.3, 0.03, steel, 0.68); h.position.x = 0.13; }
    else if (w === 'mace' || w === 'hammer') { box(0.05, 0.8, 0.05, wood, 0.2); if (w === 'mace') { const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), steel); h.position.y = 0.62; g.add(h); } else box(0.34, 0.18, 0.18, steel, 0.62); }
    g.rotation.x = Math.PI / 2; g.position.set(0, -0.27, 0.04); return g; }
  function shieldMesh() { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 20), std('#8A2A22', 0.6)); s.rotation.z = Math.PI / 2; s.position.set(-0.08, -0.18, 0.05); const boss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), std('#C9A227', 0.3, 0.8)); boss.position.y = 0.04; s.add(boss); return s; }
  function setFighters(c) { const key = c ? [c.n, c.i, c.a && c.a.handle, c.b && c.b.handle, c.weapons && c.weapons.join(), !!(c.looks && c.looks[0]), !!(c.looks && c.looks[1])].join('|') : ''; if (card && card.key === key) return; card = c ? { ...c, key } : null;
    for (const k of [0, 1]) { if (F[k]) { scene.remove(F[k].P.group); F[k] = null; } }
    if (!c) return; gladiator = !!c.gladiator; jets.forEach(j => j.grate.visible = gladiator); racks.visible = gladiator;
    for (const k of [0, 1]) { const who = k ? c.b : c.a; if (!who) continue; const P = W.makePerson('fighter:' + who.handle, null, (c.looks && c.looks[k]) || null); scene.add(P.group); P.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
      const A = P.av || P, tag = W.nameTag((k ? '🔵 ' : '🔴 ') + '@' + who.handle, k ? '#9cc4ff' : '#ffb0a8'); tag.scale.set(1.25, 0.31, 1); tag.position.set(0, 2.2, 0); P.group.add(tag);
      const wpn = c.weapons && c.weapons[k], handR = A.forearmR || A.armR, handL = A.forearmL || A.armL, drop = A.forearmR ? 0 : -0.36; /* (a simple figure has no elbow: the hand is further down the arm) */
      if (wpn && handR) { const wm = weaponMesh(wpn); wm.position.y += drop; handR.add(wm); if (BR.WEAPONS[wpn].shield && handL) { const sm = shieldMesh(); sm.position.y += drop; handL.add(sm); } if (wpn === 'daggers' && handL) { const d2 = weaponMesh('daggers'); d2.position.y += drop; handL.add(d2); } }
      /* a sash in their corner's colour, so you can always tell them apart */ const sash = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 20), std(k ? '#2E6FD8' : '#C0392B', 0.6)); sash.rotation.x = Math.PI / 2; sash.scale.set(1, 0.78, 1); sash.position.y = 1.0; (A.body || P.group).add(sash);
      F[k] = { P, A, x: k ? 9.4 : -9.4, z: 0, a: 0, vx: 0, vz: 0, down: 0, lay: 0, style: who.style, weapon: wpn || null, hitT: 0 }; P.setPos(F[k].x, 0); } }
  // the walk-out: a spotlight on each fighter as they come out, and smoke from their gate
  const beamM = new THREE.MeshBasicMaterial({ color: '#FFF6D8', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beams = [0, 1].map(() => { const b = new THREE.Mesh(new THREE.ConeGeometry(1.6, 16, 20, 1, true), beamM); b.position.y = 8; b.visible = false; scene.add(b); return b; });
  const smokeM = new THREE.MeshStandardMaterial({ color: '#D9D4CC', roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }); view.mats.push(smokeM); const puffs = []; let smoked = [false, false];
  function smoke(side) { const x = (side ? 1 : -1) * (R0 - 0.3) * SX; for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), smokeM.clone()); m.position.set(x + (Math.random() - 0.5) * 1.2, 0.4 + Math.random(), (Math.random() - 0.5) * 2.4); scene.add(m);
      puffs.push({ m, vx: -(side ? 1 : -1) * (0.6 + Math.random()), vy: 0.4 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.6, t: 2.5 + Math.random() }); } }
  // the fight as it comes in: kept for a moment and drawn a tenth of a second behind, so it's smooth
  let roar = 0; const snaps = []; let cur = null, lastEv = [], replay = null, shake = 0;
  function brawl(s) { s.at = performance.now(); snaps.push(s); while (snaps.length > 90) snaps.shift(); if (s.ev) for (const e of s.ev) onEvent(e); }
  const sparks = []; const sparkM = new THREE.MeshBasicMaterial({ color: '#FFF2B0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  function burst(x, y, z, n, col, big) { for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.045 : 0.03, 5, 4), col ? sparkM.clone() : sparkM); if (col) m.material.color.set(col); m.position.set(x, y, z); scene.add(m);
      sparks.push({ m, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4 + 1, vz: (Math.random() - 0.5) * 5, t: 0.5 + Math.random() * 0.3, own: !!col }); } }
  function onEvent(e) { const by = e.by != null ? F[e.by] : null, who = e.who != null ? F[e.who] : null;
    if ((e.k === 'hit' || e.k === 'big') && by) { const o = F[1 - e.by]; if (o) { burst(o.x, 1.45, o.z, e.k === 'big' ? 12 : 5, null, e.k === 'big'); o.hitT = 0.25; if (e.k === 'big') shake = Math.max(shake, 0.5); } if (opts.onHit) opts.onHit(e); }
    if (e.k === 'block' && by) { const o = F[1 - e.by]; if (o) burst(o.x, 1.35, o.z, 5, '#9CD6FF'); }
    if (e.k === 'down' && who) { burst(who.x, 0.2, who.z, 26, '#D8BE88'); shake = Math.max(shake, 0.8); setTimeout(() => startReplay(), 900); }
    if (e.k === 'burn' && who) burst(who.x, 0.6, who.z, 10, '#FF7A1F');
    if (e.k === 'end') { shake = Math.max(shake, 0.4); if (card) card.winner = e.winner; } }
  // slow-motion replay of a knockdown: the three seconds before it, at a third of the speed, from a low swinging camera
  function startReplay() { if (fighting()) return; /* (never while you're the one fighting: you need to see the fight) */ const now = performance.now(), from = snaps.filter(s => s.at > now - 3300 && s.at < now - 800); if (from.length < 6) return; replay = { list: from, t0: from[0].at, t: 0, len: from[from.length - 1].at - from[0].at }; }
  const lerp = (a, b, k) => a + (b - a) * k, lerpA = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  function sample(at) { if (!snaps.length) return null; let a = snaps[0], b = null; for (const s of snaps) { if (s.at <= at) a = s; else { b = s; break; } } if (!b) return a; const k = Math.max(0, Math.min(1, (at - a.at) / Math.max(1, b.at - a.at)));
    return { ...b, pt: lerp(a.pt, b.pt, k), f: b.f.map((fb, i) => { const fa = a.f[i]; return [lerp(fa[0], fb[0], k), lerp(fa[1], fb[1], k), lerpA(fa[2], fb[2], k), ...fb.slice(3)]; }) }; }
  function poseFighter(k, s, dt) { const Fk = F[k]; if (!Fk || !s) return; const f = s.f[k], A = Fk.A, [x, z, a, , , act, actT, blk, down, , stun] = f;
    const vx = (x - Fk.x) / Math.max(dt, 1e-3), vz = (z - Fk.z) / Math.max(dt, 1e-3); Fk.x = x; Fk.z = z; Fk.P.setPos(x, z);
    if (down) { if (!Fk.down) { Fk.down = 1; if (A.pose) A.pose('lie'); } Fk.P.group.rotation.y = a + Math.PI; return; } if (Fk.down) { Fk.down = 0; if (A.pose) A.pose('stand'); }
    if (A.animate) A.animate(dt, Math.abs(vx) + Math.abs(vz) > 0.3 ? vx : 0, Math.abs(vx) + Math.abs(vz) > 0.3 ? vz : 0, false); Fk.P.group.rotation.y = a;
    if (!A.armL) return; if (!A.forearmL) { A.forearmL = new THREE.Object3D(); A.forearmR = new THREE.Object3D(); } /* (a simple figure: its arms swing, its 'forearms' are stand-ins) */ const ph = card && card.ph; if (s.ph === 'walk' || s.ph === 'verdict' || s.ph === 'break') { if (s.ph === 'verdict' && card && card.winner === k) { A.armL.rotation.set(-2.7, 0, -0.3); A.armR.rotation.set(-2.7, 0, 0.3); A.forearmL.rotation.x = -0.2; A.forearmR.rotation.x = -0.2; } return; }
    // the guard: fists up by the chin, knees a little bent
    A.armL.rotation.set(-0.75, 0, -0.35); A.forearmL.rotation.set(-1.95, 0, 0); A.armR.rotation.set(-0.6, 0, 0.35); A.forearmR.rotation.set(-2.05, 0, 0); if (A.body) A.body.rotation.set(0, 0, 0);
    if (Fk.weapon) { A.armR.rotation.set(-0.9, 0, 0.15); A.forearmR.rotation.x = -0.9; }
    const m = act && act !== 'dodge' ? BR.moveOf({ style: Fk.style, weapon: Fk.weapon }, act) : null;
    if (m) { const sp = 1 / (0.85 + 0.5 * 0.3), w = m.wind * sp, hit = (m.wind + m.act) * sp, end = (m.wind + m.act + m.rec) * sp, t = actT;
      const p = t < w ? -(t / w) * 0.4 : t < hit ? 1 : Math.max(0, 1 - (t - hit) / Math.max(0.01, end - hit)); /* -0.4 pulled back (wind-up), 1 at full stretch, back to 0 */
      const special = act === 'special', style = Fk.weapon ? 'whirl' : Fk.style;
      if (act === 'jab') { A.armL.rotation.x = -0.75 - 0.85 * p; A.forearmL.rotation.x = -1.95 + 1.85 * Math.max(0, p); if (Fk.weapon) { A.armR.rotation.x = -0.9 - 0.7 * p; A.forearmR.rotation.x = -0.9 + 0.8 * Math.max(0, p); } }
      else if (act === 'heavy') { A.armR.rotation.x = -0.6 - 1.0 * p; A.forearmR.rotation.x = -2.05 + 1.95 * Math.max(0, p); A.armR.rotation.z = 0.35 - 0.5 * Math.max(0, p); if (A.body) A.body.rotation.y = -0.45 * p; }
      else if (special && style === 'kicker') { if (A.body) A.body.rotation.y = Math.max(0, t / hit) * Math.PI * 2; if (A.legR) A.legR.rotation.x = -1.6 * Math.max(0, Math.sin(Math.min(1, t / end) * Math.PI)); }
      else if (special && style === 'boxer') { A.armR.rotation.x = -0.2 - 2.4 * Math.max(0, p); A.forearmR.rotation.x = -2.2 + 1.2 * Math.max(0, p); if (A.body) A.body.rotation.x = 0.25 * (p < 0 ? -p : 0); }
      else if (special && style === 'grappler') { A.armL.rotation.x = A.armR.rotation.x = -1.5 - 0.6 * p; A.forearmL.rotation.x = A.forearmR.rotation.x = -0.4; if (A.body) A.body.rotation.x = 0.5 * Math.max(0, p); }
      else if (special && style === 'brawler') { A.armR.rotation.set(-1.3, 0, 1.4 - 1.8 * Math.max(0, p)); A.forearmR.rotation.x = -0.3; if (A.body) A.body.rotation.y = -0.7 * p; }
      else if (special) { if (A.body) A.body.rotation.y = Math.max(0, Math.min(1, (t - w * 0.5) / (hit - w * 0.5))) * Math.PI * 2; A.armR.rotation.set(-1.5, 0, 1.2); A.forearmR.rotation.x = -0.2; } }
    if (blk) { A.armL.rotation.set(-1.45, 0, 0.35); A.forearmL.rotation.x = -2.1; A.armR.rotation.set(-1.45, 0, -0.35); A.forearmR.rotation.x = -2.1; if (Fk.weapon && BR.WEAPONS[Fk.weapon].shield) A.armL.rotation.set(-1.3, 0, 0.6); }
    if (act === 'dodge' && A.body) A.body.rotation.z = 0.35; if ((stun || Fk.hitT > 0) && A.head) { A.head.rotation.x = -0.35; if (A.body) A.body.rotation.x = -0.18; } Fk.hitT = Math.max(0, Fk.hitT - dt); }
  // ---- the cameras: behind you, through your eyes, ringside, the TV camera (it follows the fight), from above;
  // when you're the one fighting, over your fighter's shoulder ----
  const MODES = ['tv', 'third', 'first', 'ring', 'above']; let mode = 'tv', camYaw = 0; const aim = new THREE.Vector3(), tmp = new THREE.Vector3();
  function placeCamera(dt, s) { const k = Math.min(1, dt * 3.5), pos = new THREE.Vector3(), tgt = new THREE.Vector3(), fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    const A = s && s.f[0], B = s && s.f[1], mid = s ? tmp.set((A[0] + B[0]) / 2, 1.1, (A[1] + B[1]) / 2) : tmp.set(0, 1, 0), sep = s ? Math.hypot(A[0] - B[0], A[1] - B[1]) : 4;
    me.P.group.visible = mode !== 'first' && !fighting();
    if (replay && s) { const ang = performance.now() / 2600; pos.set(mid.x + Math.cos(ang) * 3.4, 1.0, mid.z + Math.sin(ang) * 3.4); tgt.copy(mid); camera.position.lerp(pos, k * 2); aim.lerp(tgt, k * 2); }
    else if (fighting() && s) { const mf = s.f[mineSide], of = s.f[1 - mineSide], dx = of[0] - mf[0], dz = of[1] - mf[1], d = Math.hypot(dx, dz) || 1; camYaw = Math.atan2(-dx, -dz);
      pos.set(mf[0] - dx / d * 3.4 + dz / d * 0.9, 2.35, mf[1] - dz / d * 3.4 - dx / d * 0.9); tgt.set(of[0], 1.2, of[1]); camera.position.lerp(pos, k * 1.6); aim.lerp(tgt, k * 1.6); }
    else if (mode === 'first') { pos.set(me.x, me.y + (me.sit ? 1.15 : 1.62), me.z); tgt.set(me.x + fx * 10, me.y + 1.6 + Math.tan(me.pitch) * 10, me.z + fz * 10); camera.position.copy(pos); aim.copy(tgt); }
    else if (mode === 'third') { const up = 2.3 - me.pitch * 2.2; pos.set(me.x - fx * 4.4, me.y + Math.max(0.8, up), me.z - fz * 4.4); if (tierAt(pos.x, pos.z) >= 0) pos.y = Math.max(pos.y, floorY(pos.x, pos.z) + 1.4); if (er(pos.x, pos.z) > ROUT - 0.6) { const r = er(pos.x, pos.z), sc = (ROUT - 0.6) / r; pos.x *= sc; pos.z *= sc; }
      tgt.set(me.x + fx * 3, me.y + 1.4 + Math.tan(me.pitch) * 6, me.z + fz * 3); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else if (mode === 'ring' && s) { const a = Math.atan2(mid.z, mid.x) + 0.6; pos.set(Math.cos(a) * (R0 - 0.6) * SX, 1.7, Math.sin(a) * (R0 - 0.6)); tgt.copy(mid); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else if (mode === 'above') { pos.set(12, 20, 12); tgt.set(0, 0, 0); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else if (mode === 'tv' && s && s.ph === 'walk') { const side = BR.WALK_S - s.pt < BR.WALK_S * 0.5 ? 0 : 1, f = s.f[side]; pos.set(f[0] * 0.35, 2.4, 6.5); tgt.set(f[0], 1.3, f[1]); camera.position.lerp(pos, Math.min(1, dt * 2)); aim.lerp(tgt, Math.min(1, dt * 4)); } /* the walk-out: from the side of the sand, on whoever is coming out */
    else { /* the TV camera: from the side, pulled back to frame both fighters, swinging slowly */ const t = performance.now() / 9000, a = Math.PI / 2 + Math.sin(t) * 0.7, dist = Math.min(9, 4.5 + sep * 0.7); pos.set(mid.x + Math.cos(a) * dist, 3.0 + sep * 0.22, mid.z + Math.sin(a) * dist); { const r = er(pos.x, pos.z), lim = R0 - 0.6; if (r > lim) { pos.x *= lim / r; pos.z *= lim / r; pos.y += (r - lim) * 0.5; } } /* (never out over the crowd) */ tgt.copy(mid); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    scrBox.visible = mode !== 'above' || fighting() || !!replay;
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.25; camera.position.y += (Math.random() - 0.5) * shake * 0.2; shake = Math.max(0, shake - dt * 1.6); }
    camera.lookAt(aim); }
  // ---- the loop ----
  const deco = decorate(view, { SX, R0, PODIUM, ROWS, ROW_D, ROW_H, Y0, RT, YT, ROUT }); const merged = mergeStatic(scene); /* (tens of still pieces into a handful of draws) */
  let tSlow = 0, tw = 0; view.resize(); let sunAt = -99, wxNow = null; const sunTime = () => { const m = opts.minute ? opts.minute() : 720, w = opts.weather ? opts.weather() : null; if (w !== wxNow) { wxNow = w; if (w) view.setWeather(w); } if (Math.abs(m - sunAt) >= 3) { sunAt = m; view.setTime(m); } }; sunTime(); /* (the sun and its shadows: only when they've moved) */
  view.start((dt, now) => { walkMe(dt); stepOthers(dt); deco.update(dt, now);
    // the fight: the live picture a tenth of a second behind, or a replay
    let s = null; if (replay) { replay.t += dt * 1000 / 2; const at = replay.t0 + replay.t; if (replay.t >= replay.len) replay = null; else s = sample(at); }
    if (!s) s = sample(now - 110); cur = s;
    if (s) for (const k of [0, 1]) poseFighter(k, s, replay ? dt / 2 : dt);
    // the walk-out: spotlights, smoke as each one comes out of their gate
    { const walk = s && s.ph === 'walk', wt = walk ? BR.WALK_S - s.pt : 99; for (const k of [0, 1]) { const on = walk && F[k] && (k === 0 ? wt < 12 : wt >= BR.WALK_S * 0.5 - 0.3); beams[k].visible = !!on; if (on) beams[k].position.set(F[k].x, 8, F[k].z);
        if (walk && !smoked[k] && (k === 0 ? wt > 0.2 : wt >= BR.WALK_S * 0.5)) { smoked[k] = true; smoke(k); roar = Math.min(1, roar + 0.6); } } if (!walk) smoked = [false, false]; }
    for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.t -= dt; p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt; p.m.scale.multiplyScalar(1 + dt * 0.6); p.m.material.opacity = Math.max(0, Math.min(0.55, p.t * 0.25)); if (p.t <= 0) { scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); puffs.splice(i, 1); } }
    // the fire jets
    if (gladiator && s) { let any = false; jets.forEach((j, i) => { const warn = (s.j >> i) & 1, fire = (s.fi >> i) & 1; j.grate.material.emissiveIntensity = fire ? 2 : warn ? 0.6 + Math.sin(now / 60) * 0.4 : 0; j.fire.visible = !!fire; if (fire) { any = true; const q = 0.85 + Math.sin(now / 45 + i) * 0.15; j.fire.scale.set(q, 0.9 + Math.sin(now / 70 + i * 2) * 0.12, q); jetLight.position.set(BR.JETS[i].x, 2, BR.JETS[i].z); } }); jetLight.intensity = any ? 18 : 0; }
    // sparks and dust
    for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.t -= dt; p.vy -= 9 * dt; p.m.position.x += p.vx * dt; p.m.position.y = Math.max(0.02, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt; p.m.scale.setScalar(Math.max(0.1, p.t * 2)); if (p.t <= 0) { scene.remove(p.m); p.m.geometry.dispose(); if (p.own) p.m.material.dispose(); sparks.splice(i, 1); } }
    // the torches flicker; the crowd jumps with the roar
    tw += dt; if (tw > 0.06) { tw = 0; for (const f of flames) f.scale.set(1, 0.8 + Math.random() * 0.45, 1); } timeU.value = now / 1000; if (crowd) { FOLK.length = 0; FOLK.push(me.P.group.position); for (const o of others.values()) FOLK.push(o.P.group.position); crowd.update(camera, now, FOLK); } /* (the stand-ins make room for real people) */ const h = s ? Math.max(s.f[0][9], s.f[1][9]) : 0; hypeU.value += ((h * 0.8 + roar) - hypeU.value) * Math.min(1, dt * 3); roar = Math.max(0, roar - dt * 0.5);
    for (const [id, b] of bubbles) if (performance.now() > b.until) { b.sp.parent && b.sp.parent.remove(b.sp); b.sp.material.map.dispose(); bubbles.delete(id); }
    placeCamera(dt, s);
    tSlow += dt; if (tSlow > 0.5) { tSlow = 0; paintScreen(now); paintBillboard(now); sunTime(); torchL.forEach(l => l.intensity = view.night > 0.3 ? 12 : 0); if (opts.onTick) opts.onTick(); } });
  const onResize = () => view.resize(); addEventListener('resize', onResize);
  return { view(m) { mode = m || MODES[(MODES.indexOf(mode) + 1) % MODES.length]; return mode; }, get mode() { return mode; },
    _heavy() { const out = []; scene.traverse(o => { if (!o.isMesh && !o.isPoints && !o.isLine) return; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); out.push([Math.round(n), o.isInstancedMesh ? 'I' + o.count : '', o.material && o.material.color ? '#' + o.material.color.getHexString() : '', o.name || '', o.visible]); }); return out.sort((a, b) => b[0] - a[0]).slice(0, 25); }, /* (for checking: the heaviest meshes) */
    stats() { return { crowd: crowd && { lo: crowd.tris, hi: crowd.nearTris, near: crowd.near }, merged, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, others: others.size, snaps: snaps.length, fighters: F.filter(Boolean).length, cam: camera.position.toArray().map(v => +v.toFixed(1)) }; },
    get me() { return { x: me.x, z: me.z, a: me.P.group.rotation.y, sit: me.sit, bench: bench() >= 0 }; }, sit() { if (me.sit) { standUp(); return false; } return sitDown(); },
    petHappy() { if (tapped) tapped.happy(); }, setMyPet(kind) { if (myPet && (!kind || myPet.kind !== kind)) { myPet.dispose(); myPet = null; } if (kind && !myPet) { try { myPet = follower(kind); scene.add(myPet.group); } catch (e) { myPet = null; } } },
    upsertOther, removeOther, setPet, say, brawl, setFighters, cheer(k) { roar = Math.min(1, roar + (k === 'boo' ? 0.1 : 0.25)); },
    setMine(side) { mineSide = side === 0 || side === 1 ? side : null; }, input: stickDir, get fighting() { return fighting(); }, get state() { return cur; }, toss(side) { const f = F[side]; if (f) burst(f.x, 2.5, f.z, 14, '#F2C94C'); },
    close() { removeEventListener('resize', onResize); removeEventListener('keydown', kd); removeEventListener('keyup', ku); stick.remove(); if (myPet) myPet.dispose(); view.dispose(); canvas.remove(); } };
}
