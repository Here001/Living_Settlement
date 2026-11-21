// Watching a game at a Stadium, in 3D: the pitch with its stripes and lines, the goals and nets, the running track round
// it, four stands (the main stand is yours to walk about in and sit; the other three are full of fans), floodlights, the
// big screen, and the game everyone in the stands sees at the same moment: the football match (see shared/football.js)
// and, at half time, the 100 m sprint down the home straight. Everything that repeats (the fans, the players' arms and
// legs) is one instanced mesh, so the whole stadium is a handful of draw calls.
//
// createStadium(host, opts) opts: id (the stadium's), big (the big stadium: bigger stands), colours { seat, seat2, trim },
//   now() (the server's clock), minute(), weather(), people() → [{ id, look }], look, pet, onMove, onPet, onGoal(goal).
// Returns { view(mode), me, sit(), upsertOther, removeOther, setPet, say, cheer(), stats(), close() } like the race track.
import * as THREE from 'three';
import * as W from '/world3d.js';
import { follower, pickPet } from '/creature3d.js';
import * as FB from '/shared/football.js';

export function createStadium(host, opts) {
  const canvas = document.createElement('canvas'); canvas.className = 'track3d'; host.append(canvas);
  const view = W.createView(canvas), { scene, camera, renderer } = view; camera.fov = 55; camera.near = 0.3; camera.far = 700; camera.updateProjectionMatrix();
  const L = 64, Wd = 40, TR = 7, BIG = !!opts.big, ROWS = BIG ? 12 : 9, SEATS = BIG ? 120 : 60, C = opts.colours || {};
  const SEAT = C.seat || '#C8382E', SEAT2 = C.seat2 || '#2F4A7A', TRIM = C.trim || '#2F4A7A';
  view.center.set(0, 0, 0); view.span = 110;
  const std = (c, r = 0.85, m = 0) => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }); view.mats.push(x); return x; };
  const add = (g, m, x, y, z, ry = 0, sh = true) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = sh; o.receiveShadow = true; scene.add(o); return o; };
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  // ---- the pitch: mown stripes and the white lines, all on one texture ----
  const PX = 1024, PZ = Math.round(PX * (Wd + 6) / (L + 6)), sx = PX / (L + 6), sz = PZ / (Wd + 6);
  const pitchT = tex(PX, PZ, (g, w, h) => { for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? '#4E9A3A' : '#5AAA44'; g.fillRect(i * w / 14, 0, w / 14 + 1, h); }
    g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 3; const X = x => (x + L / 2 + 3) * sx, Z = z => (z + Wd / 2 + 3) * sz;
    g.strokeRect(X(-L / 2), Z(-Wd / 2), L * sx, Wd * sz); g.beginPath(); g.moveTo(X(0), Z(-Wd / 2)); g.lineTo(X(0), Z(Wd / 2)); g.stroke();
    g.beginPath(); g.ellipse(X(0), Z(0), 6 * sx, 6 * sz, 0, 0, Math.PI * 2); g.stroke();
    for (const s of [-1, 1]) { const x0 = s < 0 ? X(-L / 2) : X(L / 2 - 11); g.strokeRect(x0, Z(-12), 11 * sx, 24 * sz); const x1 = s < 0 ? X(-L / 2) : X(L / 2 - 4); g.strokeRect(x1, Z(-5.5), 4 * sx, 11 * sz);
      g.beginPath(); g.ellipse(X(s * (L / 2 - 8)), Z(0), 6 * sx, 6 * sz, 0, s < 0 ? -0.93 : Math.PI - 0.93, s < 0 ? 0.93 : Math.PI + 0.93); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(X(s * (L / 2 - 8)), Z(0), 3, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Z(0), 3, 0, 7); g.fill(); });
  { const m = new THREE.MeshStandardMaterial({ map: pitchT, roughness: 0.95 }); view.mats.push(m); const o = add(new THREE.PlaneGeometry(L + 6, Wd + 6), m, 0, 0.02, 0, 0, false); o.rotation.x = -Math.PI / 2; }
  // the running track round it (red, with lane lines), and the concrete apron beyond
  const OX = L / 2 + 3 + TR, OZ = Wd / 2 + 3 + TR;
  const trackT = tex(512, 64, (g, w, h) => { g.fillStyle = '#B4473A'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i <= 8; i++) g.fillRect(0, Math.round(i * (h - 2) / 8), w, 2); });
  trackT.wrapS = THREE.RepeatWrapping; trackT.repeat.set(12, 1);
  { const m = new THREE.MeshStandardMaterial({ map: trackT, roughness: 0.9 }); view.mats.push(m);
    for (const s of [-1, 1]) { const a = add(new THREE.PlaneGeometry(OX * 2, TR), m, 0, 0.015, s * (Wd / 2 + 3 + TR / 2), 0, false); a.rotation.x = -Math.PI / 2; }
    const m2 = new THREE.MeshStandardMaterial({ color: '#B4473A', roughness: 0.9 }); view.mats.push(m2); for (const s of [-1, 1]) { const a = add(new THREE.PlaneGeometry(TR, Wd + 6), m2, s * (L / 2 + 3 + TR / 2), 0.015, 0, 0, false); a.rotation.x = -Math.PI / 2; } }
  { const o = add(new THREE.PlaneGeometry(OX * 2 + 60, OZ * 2 + 60), std('#9C9A94', 0.95), 0, 0, 0, 0, false); o.rotation.x = -Math.PI / 2; }
  // the goals: posts, crossbar and a net (a see-through texture), one each end
  const netT = tex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 8, 0); g.lineTo(i * 8, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 8); g.lineTo(w, i * 8); g.stroke(); } });
  netT.wrapS = netT.wrapT = THREE.RepeatWrapping; netT.repeat.set(6, 2);
  const netM = new THREE.MeshBasicMaterial({ map: netT, transparent: true, side: THREE.DoubleSide, depthWrite: false }); view.mats.push(netM); const postM = std('#F4F4F2', 0.35);
  const GW = 7.3, GH = 2.44, GD = 2;
  for (const s of [-1, 1]) { const x = s * L / 2; for (const z of [-GW / 2, GW / 2]) add(new THREE.CylinderGeometry(0.07, 0.07, GH, 8), postM, x, GH / 2, z);
    const bar = add(new THREE.CylinderGeometry(0.07, 0.07, GW, 8), postM, x, GH, 0); bar.rotation.x = Math.PI / 2;
    const back = add(new THREE.PlaneGeometry(GW, GH), netM, x + s * GD, GH / 2, 0, Math.PI / 2, false); back.renderOrder = 2;
    const top = add(new THREE.PlaneGeometry(GD, GW), netM, x + s * GD / 2, GH, 0, 0, false); top.rotation.x = -Math.PI / 2;
    for (const z of [-GW / 2, GW / 2]) add(new THREE.PlaneGeometry(GD, GH), netM, x + s * GD / 2, GH / 2, z, 0, false); }
  // corner flags
  for (const a of [-1, 1]) for (const b of [-1, 1]) { add(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), postM, a * L / 2, 0.75, b * Wd / 2, 0, false); add(new THREE.PlaneGeometry(0.4, 0.3), std('#F5C542', 0.6), a * L / 2 + 0.2, 1.35, b * Wd / 2, 0, false).material.side = THREE.DoubleSide; }
  // ---- the four stands: stepped tiers (one shape each), the seats striped in the club's colours, a roof over the main one ----
  const RISE = 0.9, DEEP = 1.4, STAND_Z = OZ + 2.5, back = STAND_Z + ROWS * DEEP, roofY = ROWS * RISE + 4.2;
  const seatT = tex(64, 64, (g, w, h) => { g.fillStyle = SEAT; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 8; i++) g.fillRect(i * 8 + 6, 0, 2, h); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, w, 6); });
  seatT.wrapS = seatT.wrapT = THREE.RepeatWrapping;
  const stepShape = () => { const s = new THREE.Shape(); s.moveTo(0, 0); for (let r = 0; r < ROWS; r++) { s.lineTo(r * DEEP, (r + 1) * RISE); s.lineTo((r + 1) * DEEP, (r + 1) * RISE); } s.lineTo(ROWS * DEEP, 0); s.lineTo(0, 0); return s; };
  const standG = (len) => { const g = new THREE.ExtrudeGeometry(stepShape(), { depth: len, bevelEnabled: false }); g.translate(0, 0, -len / 2); return g; }; /* (the profile in x/y, run along z) */
  const seatM = new THREE.MeshStandardMaterial({ map: seatT, roughness: 0.8 }); view.mats.push(seatM); seatT.repeat.set(0.6, 0.6);
  const concM = std('#B9B3A8', 0.92);
  const stands = [ // [front-centre x, z, which way the seats face (yaw of the profile), length]
    { x: 0, z: STAND_Z, ry: -Math.PI / 2, len: OX * 2 - 6, main: true }, { x: 0, z: -STAND_Z, ry: Math.PI / 2, len: OX * 2 - 6 },
    { x: OX + 2.5, z: 0, ry: 0, len: OZ * 2 - 6 }, { x: -OX - 2.5, z: 0, ry: Math.PI, len: OZ * 2 - 6 }];
  for (const S of stands) S.o = add(standG(S.len), [concM, seatM], S.x, 0, S.z, S.ry, true); /* (the ends of the shape concrete, the steps seats) */
  // the corners filled in (plain concrete blocks) and a wall round the back of everything
  { const x0 = OX - 3, x1 = OX + 2.5 + ROWS * DEEP, z0 = OZ - 3, z1 = back; for (const a of [-1, 1]) for (const b of [-1, 1]) add(new THREE.BoxGeometry(x1 - x0, ROWS * RISE, z1 - z0), concM, a * (x0 + x1) / 2, ROWS * RISE / 2, b * (z0 + z1) / 2); }
  const wallM = std(TRIM, 0.7); for (const S of stands) { const along = Math.abs(Math.sin(S.ry)) > 0.5; const o = add(new THREE.BoxGeometry(along ? 2 * (OX + 3 + ROWS * DEEP) : 0.5, roofY, along ? 0.5 : 2 * (back + 0.5)), wallM, along ? 0 : Math.sign(S.x) * (OX + 2.5 + ROWS * DEEP + 0.25), roofY / 2, along ? Math.sign(S.z) * (back + 0.25) : 0); o.castShadow = false; }
  // the main stand's roof (on columns), the others' roofs a lighter cantilever
  const roofM = std('#E9E7E2', 0.6, 0.1); { const len = OX * 2 - 4; add(new THREE.BoxGeometry(len, 0.3, ROWS * DEEP + 4), roofM, 0, roofY, back - (ROWS * DEEP + 4) / 2 + 0.5).rotation.x = 0.05; for (const x of [-len / 2 + 1, -len / 6, len / 6, len / 2 - 1]) add(new THREE.CylinderGeometry(0.2, 0.2, roofY, 8), std('#5A5550', 0.5, 0.4), x, roofY / 2, back - 0.6);
    add(new THREE.BoxGeometry(len, 0.3, ROWS * DEEP * 0.6), roofM, 0, roofY, -back + ROWS * DEEP * 0.3).rotation.x = -0.05; }
  // the tunnel the players walk out of (under the main stand, on the halfway line), the dugouts either side
  add(new THREE.BoxGeometry(5, 3, 3.2), std('#2A2D33', 0.7), 0, 1.5, STAND_Z + 0.4); add(new THREE.BoxGeometry(4, 2.6, 0.2), std('#0E0F12', 0.8), 0, 1.3, STAND_Z - 1.25, 0, false);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(7, 1.5, 1.4), std('#D5D9DE', 0.4, 0.1), s * 9, 0.75, Wd / 2 + 2.1); add(new THREE.BoxGeometry(7.2, 0.12, 1.6), std('#1B2631', 0.5, 0.3), s * 9, 1.56, Wd / 2 + 2.05, 0, false); } /* (between the touchline and the track) */
  // the floodlight pylons at the corners (a tall mast, a bank of lamps that glow)
  const lampM = new THREE.MeshBasicMaterial({ color: '#FFF6D8', toneMapped: false }); view.mats.push(lampM);
  for (const a of [-1, 1]) for (const b of [-1, 1]) { const x = a * (OX + ROWS * DEEP + 4), z = b * (back + 3), h = roofY + 16; add(new THREE.CylinderGeometry(0.35, 0.55, h, 8), std('#5A5550', 0.5, 0.4), x, h / 2, z);
    const head = add(new THREE.BoxGeometry(5, 3, 0.6), std('#2B2621', 0.6), x, h, z); head.lookAt(0, 0, 0); const lp = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.4), lampM); lp.position.set(x * 0.988, h, z * 0.988); lp.lookAt(0, 0, 0); scene.add(lp); }
  // ---- the big screen at the far end: the score, the clock, the scorers (and the sprint's result at half time) ----
  const sbC = document.createElement('canvas'); sbC.width = 768; sbC.height = 320; const sbT = new THREE.CanvasTexture(sbC); sbT.colorSpace = THREE.SRGBColorSpace;
  { const sc = new THREE.Mesh(new THREE.PlaneGeometry(19, 8), new THREE.MeshBasicMaterial({ map: sbT, toneMapped: false })); view.mats.push(sc.material); sc.position.set(-OX - 2.5 - ROWS * DEEP * 0.5, roofY + 5, 0); sc.rotation.y = Math.PI / 2; scene.add(sc);
    add(new THREE.BoxGeometry(0.8, 9, 20), std('#1d1f24', 0.6), -OX - 2.9 - ROWS * DEEP * 0.5, roofY + 5, 0); }
  // ---- the fans: the three far stands full, the main stand partly (they give up their seat to real people) ----
  const fanGeo = (() => { const b = new THREE.BoxGeometry(0.46, 0.62, 0.3); b.translate(0, 0.31, 0); const h = new THREE.BoxGeometry(0.26, 0.28, 0.26); h.translate(0, 0.8, 0); /* (24 triangles a fan: thousands of them stay light) */
    const n = b.attributes.position.count + h.attributes.position.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    const put = (g, shade) => { const p = g.attributes.position, q = g.attributes.normal, idx = g.index; for (let i = 0; i < p.count; i++) { pos.set([p.getX(i), p.getY(i), p.getZ(i)], (o + i) * 3); nor.set([q.getX(i), q.getY(i), q.getZ(i)], (o + i) * 3); col.set(shade, (o + i) * 3); } const r = idx ? Array.from(idx.array, v => v + o) : null; o += p.count; return r; };
    const i1 = put(b, [1, 1, 1]), i2 = put(h, [0.62, 0.48, 0.38]); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex([...i1, ...i2]); return g; })();
  const fanSpots = [], shirts = [SEAT, SEAT2, '#FFFFFF', '#F5C542', '#1B1B1B', '#7FB3E6', '#E87722', '#2E8B57'];
  for (const S of stands) { const along = Math.abs(Math.sin(S.ry)) > 0.5, n = Math.floor((S.len - 2) / 0.7); for (let r = 0; r < ROWS; r++) for (let i = 0; i < n; i++) { if (S.main && (r < 4 || Math.random() < 0.55)) continue; if (Math.random() < 0.12) continue;
    const t = -S.len / 2 + 1 + i * 0.7 + (Math.random() - 0.5) * 0.1, d = (r + 0.55) * DEEP, y = (r + 1) * RISE; const x = along ? S.x + t : S.x + Math.sign(S.x) * d, z = along ? S.z + Math.sign(S.z) * d : S.z + t; fanSpots.push({ x, y, z, face: Math.atan2(-x, -z) + Math.PI, ph: Math.random() * 6.28, main: !!S.main }); } }
  const fanM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }); view.mats.push(fanM);
  const fans = new THREE.InstancedMesh(fanGeo, fanM, fanSpots.length); fans.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fans.frustumCulled = false; { const c = new THREE.Color(); fanSpots.forEach((f, i) => { c.set(shirts[(i * 7 + (i >> 3)) % shirts.length]); fans.setColorAt(i, c); }); }
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  let jump = 0; const placeFans = (now) => { for (let i = 0; i < fanSpots.length; i++) { const f = fanSpots[i], h = jump > 0 ? Math.max(0, Math.sin(now / 140 + f.ph)) * 0.35 * Math.min(1, jump) : 0; Q.setFromAxisAngle(UP, f.face); V.set(f.x, f.y - 0.1 + h, f.z); M4.compose(V, Q, S1); fans.setMatrixAt(i, M4); } fans.instanceMatrix.needsUpdate = true; };
  placeFans(0); scene.add(fans);
  // ---- the players, the referee and the sprinters: figures made of a few instanced parts (shirt, shorts, head, arms, legs) ----
  function figures(n) { const mk = (g, c) => { const m = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.75 }); view.mats.push(m); const im = new THREE.InstancedMesh(g, m, n * c); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.castShadow = true; im.frustumCulled = false; scene.add(im); return im; }; /* (they move about: never culled as one) */
    const torso = mk(new THREE.BoxGeometry(0.5, 0.6, 0.28), 1), shorts = mk(new THREE.BoxGeometry(0.5, 0.26, 0.3), 1), head = mk(new THREE.SphereGeometry(0.15, 8, 6), 1), arm = mk(new THREE.BoxGeometry(0.12, 0.56, 0.12), 2), leg = mk(new THREE.BoxGeometry(0.16, 0.78, 0.16), 2);
    const B = new THREE.Matrix4(), T = new THREE.Matrix4(), R = new THREE.Matrix4(), c = new THREE.Color();
    const part = (im, i, ox, oy, sw, len) => { T.makeTranslation(ox, oy, 0); R.makeRotationX(sw); M4.copy(B).multiply(T).multiply(R); T.makeTranslation(0, -len / 2, 0); M4.multiply(T); im.setMatrixAt(i, M4); };
    return { n, colour(i, shirt, short, skin, sock) { c.set(shirt); torso.setColorAt(i, c); arm.setColorAt(i * 2, c); arm.setColorAt(i * 2 + 1, c); c.set(short); shorts.setColorAt(i, c); c.set(skin); head.setColorAt(i, c); c.set(sock); leg.setColorAt(i * 2, c); leg.setColorAt(i * 2 + 1, c); for (const m of [torso, shorts, head, arm, leg]) if (m.instanceColor) m.instanceColor.needsUpdate = true; },
      set(i, x, z, yaw, ph, amp, y = 0) { Q.setFromAxisAngle(UP, yaw); V.set(x, y, z); B.compose(V, Q, S1); const sw = Math.sin(ph) * amp;
        T.makeTranslation(0, 1.12, 0); M4.copy(B).multiply(T); torso.setMatrixAt(i, M4); T.makeTranslation(0, 0.8, 0); M4.copy(B).multiply(T); shorts.setMatrixAt(i, M4); T.makeTranslation(0, 1.58, 0); M4.copy(B).multiply(T); head.setMatrixAt(i, M4);
        part(leg, i * 2, -0.13, 0.8, sw, 0.78); part(leg, i * 2 + 1, 0.13, 0.8, -sw, 0.78); part(arm, i * 2, -0.32, 1.38, -sw * 0.8, 0.56); part(arm, i * 2 + 1, 0.32, 1.38, sw * 0.8, 0.56); },
      hide(i) { M4.makeScale(0, 0, 0); for (const im of [torso, shorts, head]) im.setMatrixAt(i, M4); for (const im of [arm, leg]) { im.setMatrixAt(i * 2, M4); im.setMatrixAt(i * 2 + 1, M4); } },
      done() { for (const m of [torso, shorts, head, arm, leg]) m.instanceMatrix.needsUpdate = true; } }; }
  const SKIN = ['#8D5524', '#C68642', '#E0AC69', '#F1C27D', '#6B4226', '#A0522D'];
  const team = figures(23), sprint = figures(8); for (let i = 0; i < 23; i++) { team.colour(i, '#fff', '#fff', SKIN[i % 6], '#fff'); team.hide(i); } team.done(); for (let i = 0; i < 8; i++) { sprint.colour(i, ['#F5C542', '#1F5FAF', '#B83227', '#2E8B57', '#FFFFFF', '#6B3FA0', '#E87722', '#2B2B2B'][i], '#1B1B1B', SKIN[(i * 5) % 6], '#FFFFFF'); sprint.hide(i); } sprint.done();
  const ball = add(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ map: tex(64, 32, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(i * 11 + 5, (i % 2) * 14 + 8, 4, 0, 7); g.fill(); } }), roughness: 0.5 }), 0, 0.2, 0); view.mats.push(ball.material);
  // ---- the game, from the clock: the same for everyone (where the ball goes is worked out from the match and the second) ----
  let cur = null, pl = []; const half = L / 2;
  const FORM = [[-0.92, 0], [-0.62, -0.34], [-0.66, -0.12], [-0.66, 0.12], [-0.62, 0.34], [-0.3, -0.36], [-0.34, -0.12], [-0.34, 0.12], [-0.3, 0.36], [-0.06, -0.14], [-0.04, 0.16]]; /* 4-4-2, as fractions of the half and the width */
  function setMatch(m) { cur = { m, key: m.n }; pl = []; for (let s = 0; s < 2; s++) { const t = s ? m.away : m.home; for (let k = 0; k < 11; k++) { const keeper = k === 0; pl.push({ s, k, x: 0, z: Wd / 2 + 3, yaw: 0, ph: Math.random() * 6, v: 0 });
    team.colour(s * 11 + k, keeper ? (s ? '#F1C40F' : '#2ECC71') : t.shirt, keeper ? '#1B1B1B' : t.shorts, SKIN[(s * 11 + k * 3) % 6], keeper ? '#1B1B1B' : t.shirt); } }
    pl.push({ ref: true, x: 0, z: Wd / 2 + 3, yaw: 0, ph: 0, v: 0 }); team.colour(22, '#111111', '#111111', SKIN[2], '#111111'); }
  // the ball's path through one half: a pass every couple of seconds to a spot picked from the match and the second; a goal
  // goes in at its minute (the move before it ends with a shot into the net), then the ball's back on the spot for the restart
  const R2 = (n, k) => FB.rng(FB.hash(opts.id + ':' + n + ':' + k))();
  function ballAt(t) { const m = cur.m, PASS = 2200, first = t < FB.KICKOFF2, k0 = first ? FB.WALKOUT : FB.KICKOFF2, k1 = k0 + FB.HALF; if (t < k0 || t > k1) return { x: 0, z: 0, y: 0.2, live: false, att: 0 };
    const dir = s => (s === 0) === first ? 1 : -1; /* (home attack +x in the first half, -x in the second) */
    for (const g of m.goals) { const tg = FB.timeOfMinute(g.minute); if (t >= tg - 4000 && t < tg + 6000) { const gx = dir(g.side) * half, sz = (R2(m.n, 'g' + g.minute) - 0.5) * 12;
      if (t < tg - 1600) { const u = (t - tg + 4000) / 2400; return { x: gx * (0.55 + 0.25 * u), z: sz * (1 - u) + sz * 0.5 * u, y: 0.2, live: true, att: g.side }; } /* the run in on goal */
      if (t < tg) { const u = (t - tg + 1600) / 1600; return { x: gx * 0.8 + (gx * 1.03 - gx * 0.8) * u, z: sz * 0.5 * (1 - u) + (R2(m.n, 'c' + g.minute) - 0.5) * 5 * u, y: 0.2 + Math.sin(Math.PI * u) * 1.2, live: true, att: g.side }; } /* the shot */
      return { x: gx * 1.04, z: (R2(m.n, 'c' + g.minute) - 0.5) * 5, y: 0.2, live: false, att: g.side, goal: g }; } } /* in the net (then the kick-off) */
    const i = Math.floor((t - k0) / PASS), u = ((t - k0) % PASS) / PASS, pt = j => { if (j <= 0) return [0, 0]; const a = R2(m.n, 'p' + (first ? 1 : 2) + ':' + j), b = R2(m.n, 'q' + (first ? 1 : 2) + ':' + j); return [(a - 0.5) * L * 0.86, (b - 0.5) * Wd * 0.84]; };
    const [x0, z0] = pt(i), [x1, z1] = pt(i + 1), e = u * u * (3 - 2 * u), d = Math.hypot(x1 - x0, z1 - z0);
    return { x: x0 + (x1 - x0) * e, z: z0 + (z1 - z0) * e, y: 0.2 + (d > 22 ? Math.sin(Math.PI * u) * Math.min(5, d * 0.12) : 0), live: true, att: x1 > x0 ? (first ? 0 : 1) : (first ? 1 : 0) }; }
  function stepPlayers(dt, t, b) { const m = cur.m, first = t < FB.KICKOFF2, phase = t < FB.WALKOUT ? 'walkout' : t < FB.WALKOUT + FB.HALF ? 'first' : t < FB.KICKOFF2 ? 'half' : t < FB.FULL ? 'second' : 'full';
    const near = [null, null]; if (b.live) for (const p of pl) if (!p.ref && p.k) { const d = Math.hypot(p.x - b.x, p.z - b.z); if (!near[p.s] || d < near[p.s].d) near[p.s] = { p, d }; }
    pl.forEach((p, i) => { let tx, tz, sp = 6;
      if (phase === 'walkout') { const line = Math.max(0, Math.min(1, (t - 8000) / 30000)); sp = 2.2; /* out of the tunnel in two lines, to the halfway line; then to their places for the kick-off */
        if (p.ref) { tx = 0; tz = (Wd / 2 + 2) * (1 - line) - 1.5 * line; } else if (t < 40000) { tx = p.s ? 1.4 : -1.4; tz = (Wd / 2 + 2) * (1 - line) + p.k * 1.1; } else { const f = FORM[p.k]; tx = (p.s ? -1 : 1) * f[0] * half; tz = f[1] * Wd; sp = 4; } }
      else if (phase === 'half' || phase === 'full') { if (p.ref) { tx = 2; tz = Wd / 2 + 2; } else { tx = (p.s ? 14 : -14) + (p.k - 5) * 0.8; tz = Wd / 2 + 1.2; } sp = 1.8; if (phase === 'full' && t > FB.FULL + 40000) { tx = (p.s ? 1 : -1) * 1; tz = STAND_Z + 1; } }
      else if (p.ref) { tx = b.x * 0.8 - 6; tz = b.z * 0.6 + 6; sp = 5; }
      else { const dir = (p.s === 0) === first ? 1 : -1, f = FORM[p.k], push = b.x * dir / half; /* (the team moves up and back with the ball) */
        if (!p.k) { tx = -dir * (half - 1); tz = Math.max(-3, Math.min(3, b.z * 0.25)); sp = 4; }
        else if (near[p.s] && near[p.s].p === p) { tx = b.x; tz = b.z; sp = 7.5; }
        else { tx = dir * (f[0] * half + push * half * 0.42 + 2); tz = f[1] * Wd + (b.z - f[1] * Wd) * 0.22; } }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), v = Math.min(sp, d * 2.5); if (d > 0.05) { p.x += dx / d * Math.min(d, v * dt); p.z += dz / d * Math.min(d, v * dt); p.yaw = Math.atan2(dx, dz); } else if (b.live) p.yaw = Math.atan2(b.x - p.x, b.z - p.z);
      p.v += (Math.min(v, d * 3) - p.v) * Math.min(1, dt * 6); p.ph += dt * p.v * 2.4; team.set(i, p.x, p.z, p.yaw, p.ph, Math.min(0.75, p.v * 0.12)); }); team.done(); }
  function stepSprint(t) { const m = cur.m, el = (t - FB.SPRINT_AT) / 1000, z0 = Wd / 2 + 3.6;
    if (el < -20 || el > 30) { for (let i = 0; i < 8; i++) sprint.hide(i); sprint.done(); return null; }
    let lead = null; m.sprint.forEach((r, i) => { const run = el > 0, d = run ? Math.min(100, 100 * Math.min(1, el / r.time) ** 1.08) : 0, x = -OX + 4 + d * (2 * OX - 8) / 100, z = z0 + i * (TR - 0.6) / 8;
      if (!lead || d > lead.d) lead = { d, i, x, z, el }; sprint.set(i, x, z, Math.PI / 2, el * 13 + i, run && d < 100 ? 0.9 : 0); }); sprint.done(); return lead; }
  // the scoreboard (and the page's HUD gets the same lines through status())
  let sbKey = '', status = { lines: [] };
  function paintBoard(t) { const m = cur.m, sc = FB.scoreAt(m, t), mi = FB.minuteAt(t), ph = t < FB.WALKOUT ? 'Kick-off soon' : t < FB.WALKOUT + FB.HALF ? `${mi}′` : t < FB.KICKOFF2 ? 'Half time' : t < FB.FULL ? `${mi}′` : 'Full time';
    const sEl = (t - FB.SPRINT_AT) / 1000, spr = sEl > -20 && sEl < 40 ? (sEl < 0 ? '🏃 100 m sprint: on your marks…' : sEl < 12 ? '🏃 100 m sprint: they’re off!' : `🏃 ${[...m.sprint].sort((a, b) => a.time - b.time)[0].name} wins the sprint in ${[...m.sprint].sort((a, b) => a.time - b.time)[0].time}s`) : '';
    const scorers = m.goals.filter(g => FB.timeOfMinute(g.minute) <= t).slice(-3).map(g => `⚽ ${g.name} ${g.minute}′ (${g.side ? m.away.short : m.home.short})`);
    status = { home: m.home, away: m.away, score: sc, clock: ph, sprint: spr, scorers, lines: [`${m.home.name} ${sc[0]} – ${sc[1]} ${m.away.name}`, ph, ...(spr ? [spr] : scorers)] };
    const key = status.lines.join('|'); if (key === sbKey) return; sbKey = key; const g = sbC.getContext('2d'); g.fillStyle = '#0B0D12'; g.fillRect(0, 0, 768, 320);
    g.fillStyle = m.home.shirt; g.fillRect(24, 26, 24, 70); g.fillStyle = m.away.shirt; g.fillRect(720, 26, 24, 70);
    g.textAlign = 'center'; g.fillStyle = '#FFFFFF'; g.font = '800 46px system-ui, sans-serif'; g.fillText(`${m.home.short}  ${sc[0]} – ${sc[1]}  ${m.away.short}`, 384, 78); g.fillStyle = '#F2C94C'; g.font = '700 32px system-ui, sans-serif'; g.fillText(ph, 384, 128);
    g.font = '600 26px system-ui, sans-serif'; g.fillStyle = '#E8F4FF'; (spr ? [spr] : scorers).slice(0, 4).forEach((l, i) => g.fillText(l, 384, 180 + i * 36)); sbT.needsUpdate = true; }
  // ---- you, walking about the main stand and the walkway in front of it (as at the race track), and other people ----
  const standW = OX * 2 - 8, me = { x: (Math.random() - 0.5) * standW * 0.6, z: STAND_Z - 1.4, y: 0, yaw: 0, pitch: -0.1, sit: false, P: W.makePerson('me', null, opts.look || null) }; scene.add(me.P.group); me.P.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  let myPet = null, petGone = null; if (opts.pet) { try { myPet = follower(opts.pet); scene.add(myPet.group); } catch (e) {} }
  const tierY = (x, z) => (Math.abs(x) < standW / 2 && z > STAND_Z && z < back) ? Math.min(ROWS, Math.floor((z - STAND_Z) / DEEP) + 1) * RISE : 0;
  const free = (x, z) => { if (Math.abs(x) > standW / 2 || z > back - 0.3 || z < Wd / 2 + 3 + TR + 0.4) return false; if (Math.abs(x) < 2.8 && z < STAND_Z + 2.2) return false; /* (the tunnel) */ for (const o of others.values()) if (Math.hypot(o.x - x, o.z - z) < 0.45) return false; return true; };
  const keys = new Set(), joy = { x: 0, y: 0 }; const kd = e => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; keys.add(e.key.toLowerCase()); }, ku = e => keys.delete(e.key.toLowerCase()); addEventListener('keydown', kd); addEventListener('keyup', ku);
  const stick = document.createElement('div'); stick.className = 'hjoy'; stick.innerHTML = '<i></i>'; host.append(stick); { let id = null; const knob = stick.firstChild;
    const mv = e => { const r = stick.getBoundingClientRect(), Rr = r.width / 2; let dx = (e.clientX - r.left - Rr) / Rr, dy = (e.clientY - r.top - Rr) / Rr; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * Rr * 0.6}px,${dy * Rr * 0.6}px)`; };
    stick.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; stick.setPointerCapture(id); mv(e); }); stick.addEventListener('pointermove', e => { if (e.pointerId === id) mv(e); });
    const end = () => { id = null; joy.x = joy.y = 0; knob.style.transform = ''; }; stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end); }
  const lk = { id: null, x: 0, y: 0 }; canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { if (lk.id != null) return; lk.id = e.pointerId; lk.x = lk.x0 = e.clientX; lk.y = lk.y0 = e.clientY; lk.t0 = performance.now(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
  canvas.addEventListener('pointermove', e => { if (e.pointerId !== lk.id) return; me.yaw -= (e.clientX - lk.x) * 0.006; me.pitch = Math.max(-1.1, Math.min(1.1, me.pitch - (e.clientY - lk.y) * 0.004)); lk.x = e.clientX; lk.y = e.clientY; });
  let tapped = null; const tapPet = e => { if (!opts.onPet) return; const list = []; if (myPet && myPet.group.visible) list.push({ group: myPet.group, mine: true, id: 'me', pet: myPet }); for (const [id, o] of others) if (o.pet) list.push({ group: o.pet.group, mine: false, id, owner: o.h || null, pet: o.pet });
    const hit = pickPet(camera, canvas, e, list); if (!hit) return; tapped = hit.pet; opts.onPet({ mine: hit.mine, id: hit.id, owner: hit.owner, kind: hit.pet.kind, sx: e.clientX, sy: e.clientY }); };
  const lkEnd = e => { if (e.pointerId === lk.id) { lk.id = null; if (e.type === 'pointerup' && Math.hypot(e.clientX - lk.x0, e.clientY - lk.y0) < 9 && performance.now() - lk.t0 < 450) tapPet(e); } }; canvas.addEventListener('pointerup', lkEnd); canvas.addEventListener('pointercancel', lkEnd);
  let sitAt = null; const nearBench = () => tierY(me.x, me.z);
  function sitDown() { const ty = nearBench(); if (!ty) return false; const row = Math.round(ty / RISE) - 1, z = STAND_Z + (row + 0.55) * DEEP, taken = []; for (const o of others.values()) if (o.sit) taken.push([o.x, o.z]); for (const c of crowd.values()) taken.push([c.P.group.position.x, c.P.group.position.z]);
    let sx = null; for (let k = 0; k <= 14 && sx == null; k++) for (const sg of k ? [1, -1] : [1]) { const x = me.x + sg * k * 0.62; if (Math.abs(x) > standW / 2 - 1) continue; if (!taken.some(t => Math.hypot(t[0] - x, t[1] - z) < 0.55)) { sx = x; break; } }
    if (sx == null) return false; me.sit = true; me.x = sx; me.z = z; me.yaw = 0; sitAt = ty - 0.42; const A = me.P.av || me.P; if (A.pose) A.pose('sit'); return true; }
  function standUp() { if (!me.sit) return; me.sit = false; sitAt = null; const A = me.P.av || me.P; if (A.pose) A.pose('stand'); }
  let moved = 0;
  function walkMe(dt) { const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - joy.y, st = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + joy.x, m = Math.min(1, Math.hypot(f, st));
    if (m > 0.08 && me.sit) standUp();
    if (m > 0.08) { const sp = 3.2 * m, fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), rx = -fz, rz = fx, k = Math.max(1, Math.hypot(f, st)), dx = (fx * f + rx * st) / k * sp * dt, dz = (fz * f + rz * st) / k * sp * dt;
      if (free(me.x + dx, me.z)) me.x += dx; if (free(me.x, me.z + dz)) me.z += dz; moved += Math.hypot(dx, dz); me.P.animate(dt, dx / dt, dz / dt); } else if (!me.sit) me.P.animate(dt, 0, 0);
    const ty = me.sit ? sitAt : tierY(me.x, me.z); me.y += (ty - me.y) * Math.min(1, dt * 12); me.P.setPos(me.x, me.z); me.P.group.position.y = me.y; if (me.sit) me.P.group.rotation.y = Math.PI;
    if (myPet && petGone) { petGone.t += dt; const k = Math.min(70, 1.6 + petGone.t * 7.5); myPet.step(dt, petGone.x0 + petGone.dx * k, petGone.z0 + petGone.dz * k); if (petGone.t > 5.5) { myPet.dispose(); myPet = null; petGone = null; } }
    else if (myPet) { myPet.step(dt, me.x, me.z); myPet.group.position.y = me.sit ? tierY(me.x, me.z - 0.6) : me.y; }
    if (opts.onMove && moved > 0.15) { moved = 0; opts.onMove(); } }
  const others = new Map(), crowd = new Map(); let crowdKey = '';
  const seats = []; for (let r = 0; r < ROWS; r++) for (let x = -standW / 2 + 1.5; x < standW / 2 - 1.5; x += 1.24) seats.push([x, STAND_Z + (r + 0.55) * DEEP, (r + 1) * RISE]);
  seats.sort((a, b) => (a[1] - b[1]) || (Math.abs(a[0]) - Math.abs(b[0]))); /* (the front rows, the middle first) */
  function seatPeople() { const Lp = (opts.people && opts.people()) || [], key = Lp.map(p => p.id + (p.look ? 'L' : '') + (others.has(p.id) ? 'W' : '')).join(','); if (key === crowdKey) return; crowdKey = key; const keep = new Set();
    Lp.slice(0, SEATS).forEach((p, i) => { if (others.has(p.id)) return; keep.add(p.id); let c = crowd.get(p.id); if (c && !!c.look !== !!p.look) { scene.remove(c.P.group); crowd.delete(p.id); c = null; }
      if (!c) { const P = W.makePerson(p.id, null, p.look || null); const A = P.av || P; if (A.pose) A.pose('sit'); P.group.rotation.y = Math.PI; scene.add(P.group); c = { P, look: !!p.look }; crowd.set(p.id, c); }
      const s = seats[(i * 5) % seats.length]; c.P.group.position.set(s[0], s[2] - 0.42, s[1]); });
    for (const [id, c] of crowd) if (!keep.has(id)) { scene.remove(c.P.group); crowd.delete(id); } }
  function upsertOther(id, p) { let o = others.get(id); if (o && p.look && !o.look) { removeOther(id); o = null; }
    if (!o) { const P = W.makePerson(id, null, p.look || null); scene.add(P.group); const tag = W.nameTag(p.h ? '@' + p.h : 'a visitor'); tag.scale.set(1.6, 0.4, 1); tag.position.set(0, 2.15, 0); P.group.add(tag); o = { P, h: p.h || null, look: !!p.look, x: p.x, z: p.z, tx: p.x, tz: p.z, sit: false, tag }; P.setPos(p.x, p.z); others.set(id, o); }
    o.tx = p.x; o.tz = p.z; const s2 = p.pose === 's'; if (s2 !== o.sit) { o.sit = s2; const A = o.P.av || o.P; if (A.pose) A.pose(s2 ? 'sit' : 'stand'); } }
  function removeOther(id) { const o = others.get(id); if (!o) return; scene.remove(o.P.group); if (o.tag) o.tag.material.map.dispose(); if (o.pet) o.pet.dispose(); others.delete(id); }
  function setPet(id, kind) { const o = others.get(id); if (!o || (o.pet && o.pet.kind === kind)) return; if (o.pet) { o.pet.dispose(); o.pet = null; } if (kind) try { o.pet = follower(kind, { side: -1 }); o.pet.kind = kind; scene.add(o.pet.group); } catch (e) {} }
  function stepOthers(dt) { const k = Math.min(1, dt * 6); for (const o of others.values()) { const dx = o.tx - o.x, dz = o.tz - o.z; o.x += dx * k; o.z += dz * k; o.P.setPos(o.x, o.z); o.P.group.position.y = o.sit ? tierY(o.x, o.z) - 0.42 : tierY(o.x, o.z);
    if (o.sit) o.P.group.rotation.y = Math.PI; else o.P.animate(dt, dx * k / Math.max(dt, 1e-3), dz * k / Math.max(dt, 1e-3)); if (o.pet) o.pet.step(dt, o.x, o.z); } }
  const bubbles = new Map();
  function say(id, text) { const on = id === 'me' ? me.P.group : others.get(id)?.P.group; if (!on) return; const old = bubbles.get(id); if (old) { old.sp.parent && old.sp.parent.remove(old.sp); old.sp.material.map.dispose(); }
    const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 512; c.height = 128; g.font = '600 34px sans-serif'; const t = String(text).length > 60 ? String(text).slice(0, 58) + '…' : String(text), w = Math.min(500, g.measureText(t).width + 40);
    g.fillStyle = 'rgba(255,255,255,.96)'; if (g.roundRect) { g.beginPath(); g.roundRect((512 - w) / 2, 20, w, 80, 24); g.fill(); } else g.fillRect((512 - w) / 2, 20, w, 80); g.fillStyle = '#1C1C1E'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 256, 60);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })); sp.scale.set(2.6, 0.65, 1); sp.position.set(0, 2.6, 0); sp.renderOrder = 6; on.add(sp); bubbles.set(id, { sp, until: performance.now() + 7000 }); }
  // ---- the camera: behind you (the default), through your eyes, the TV camera following the ball, or from above ----
  const MODES = ['third', 'first', 'tv', 'above']; let mode = 'third'; const aim = new THREE.Vector3(), bpos = new THREE.Vector3();
  function placeCamera(dt) { const k = Math.min(1, dt * 4), tgt = new THREE.Vector3(), pos = new THREE.Vector3(), fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw); me.P.group.visible = mode !== 'first';
    if (mode === 'first') { pos.set(me.x, me.y + (me.sit ? 1.15 : 1.62), me.z); tgt.set(me.x + fx * 10, me.y + 1.6 + Math.tan(me.pitch) * 10, me.z + fz * 10); camera.position.copy(pos); aim.copy(tgt); }
    else if (mode === 'third') { const dist = 4.6, up = 2.3 - me.pitch * 2.2; pos.set(me.x - fx * dist, me.y + Math.max(0.8, up), me.z - fz * dist); if (pos.z > back - 0.7) pos.z = back - 0.7; pos.y = Math.min(roofY - 0.6, Math.max(pos.y, tierY(pos.x, pos.z) + 1.4)); tgt.set(me.x + fx * 3, me.y + 1.4 + Math.tan(Math.max(0, me.pitch)) * 6, me.z + fz * 3); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else if (mode === 'tv' && run) { pos.set(run.x - 13, 3.2, Wd / 2 - 3); tgt.set(run.x + 3, 1, Wd / 2 + 5.5); camera.position.lerp(pos, k); aim.lerp(tgt, k); } /* (the sprint: alongside the runners) */
    else if (mode === 'tv') { pos.set(bpos.x * 0.6, ROWS * RISE * 0.55 + 7, STAND_Z - 6); tgt.set(bpos.x, 0, bpos.z * 0.7 - 2); /* (the gantry just in front of the main stand's roof) */ camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    else { pos.set(0, 95, OZ * 1.1); tgt.set(0, 0, 0); camera.position.lerp(pos, k); aim.lerp(tgt, k); }
    camera.lookAt(aim); const fov = mode === 'tv' ? 38 : 55; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); } }
  // ---- the frame ----
  view.resize(); if (opts.weather) view.setWeather(opts.weather()); view.setTime(opts.minute ? opts.minute() : 720);
  let sunAt = -99, wxNow = null; const sunTime = () => { const mi = opts.minute ? opts.minute() : 720, w = opts.weather ? opts.weather() : null; if (w !== wxNow) { wxNow = w; if (w) view.setWeather(w); } if (Math.abs(mi - sunAt) >= 3) { sunAt = mi; view.setTime(mi); } };
  let tSb = 0, tFan = 0, lastGoal = null, lastT = null, run = null;
  view.start((dt, now) => { const clock = opts.now ? opts.now() : Date.now(), info = FB.nowAt(opts.id, clock); if (!cur || cur.key !== info.n) setMatch(info.match);
    walkMe(dt); stepOthers(dt); const b = ballAt(info.t); bpos.set(b.x, b.y, b.z); ball.position.copy(bpos); ball.visible = info.phase !== 'half' && !(info.phase === 'full' && info.t > FB.FULL + 30000); if (b.live) ball.rotation.x += dt * 6;
    if (lastT == null || Math.abs(info.t - lastT - dt * 1000) > 4000) for (let k = 0; k < 40; k++) stepPlayers(0.25, info.t, b); /* (just in, or the clock jumped: everyone straight to where they'd be) */ lastT = info.t;
    stepPlayers(dt, info.t, b); const ld = stepSprint(info.t); run = ld && ld.el > -6 && ld.el < 16 ? ld : null;
    if (b.goal && lastGoal !== b.goal.minute + ':' + info.n) { lastGoal = b.goal.minute + ':' + info.n; jump = 5; if (opts.onGoal) opts.onGoal({ ...b.goal, team: b.goal.side ? cur.m.away : cur.m.home }); }
    if (jump > 0) { jump -= dt; tFan += dt; if (tFan > 1 / 20) { tFan = 0; placeFans(now); } if (jump <= 0) placeFans(0); } /* (the fans jump up for a goal: only then are they moved) */
    placeCamera(dt); for (const [id, bb] of bubbles) if (performance.now() > bb.until) { bb.sp.parent && bb.sp.parent.remove(bb.sp); bb.sp.material.map.dispose(); bubbles.delete(id); }
    tSb += dt; if (tSb > 0.5) { tSb = 0; paintBoard(info.t); seatPeople(); sunTime(); } });
  const onResize = () => view.resize(); addEventListener('resize', onResize);
  return { view(m) { mode = m || MODES[(MODES.indexOf(mode) + 1) % MODES.length]; return mode; }, get status() { return status; },
    stats() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fans: fanSpots.length, crowd: crowd.size, others: others.size, mode }; },
    get me() { return { x: me.x, z: me.z, a: me.P.group.rotation.y, sit: me.sit, bench: !!nearBench() }; }, sit() { if (me.sit) { standUp(); return false; } return sitDown(); },
    goto(x, z, yaw) { if (Number.isFinite(x) && Number.isFinite(z)) { me.x = x; me.z = z; } if (Number.isFinite(yaw)) me.yaw = yaw; },
    cheer() { jump = Math.max(jump, 2.5); },
    petHappy() { if (tapped) tapped.happy(); }, petLeave() { if (!myPet) return; const q = myPet.group.position; let dx = q.x - me.x, dz = q.z - me.z, d = Math.hypot(dx, dz); if (d < 0.3) { dx = 1; dz = 0; d = 1; } petGone = { t: 0, x0: me.x, z0: me.z, dx: dx / d, dz: dz / d }; }, setMyPet(kind) { if (kind && petGone) petGone = null; if (myPet && (!kind || myPet.kind !== kind)) { myPet.dispose(); myPet = null; } if (kind && !myPet) { try { myPet = follower(kind); scene.add(myPet.group); } catch (e) { myPet = null; } } },
    upsertOther, removeOther, setPet, say, near(r) { let n = 0; for (const o of others.values()) if (Math.hypot(o.x - me.x, o.z - me.z) <= r) n++; return n; },
    close() { removeEventListener('resize', onResize); removeEventListener('keydown', kd); removeEventListener('keyup', ku); stick.remove(); if (myPet) myPet.dispose(); view.dispose(); canvas.remove(); } };
}
