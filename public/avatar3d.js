// A colonist's own character in 3D, built from their look (shared/avatar.js): a smooth, rounded body shaped by height
// and build, a face painted at high resolution (eye colour, brows, makeup, stubble) with a real nose and ears, their
// hairstyle, every piece of clothing as its own layer, and the things they wear (hats, glasses, jewellery, bags).
//
// Built for phones: each moving part (body, two arms, two legs) is merged into one or two meshes, so a whole person is
// about a dozen draw calls; the materials are shared by everyone (colours live in the vertices), and only the face
// texture is per person (cached by what it shows).
//
// The character stands on y = 0 and faces +z. animate(dt, vx, vz) walks them; setOpacity fades them (when the camera
// is too close); dispose() frees what they own.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CLOTH, LIPS, itemOf, fixLook } from '/shared/avatar.js';

const V2 = THREE.Vector2;
const UNDER = '#E9E4DC'; // the mannequin's underwear

// ---------------- shared materials and the fabric weave ----------------
let FAB = null;
function fabric() {
  if (FAB) return FAB; const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.02 : 0.045})`; g.fillRect(0, y, S, 1); } /* a fine, quiet weave: clean up close, no shimmer far away */
  for (let x = 0; x < S; x += 2) { g.fillStyle = 'rgba(0,0,0,.018)'; g.fillRect(x, 0, 1, S); }
  g.fillStyle = '#ffffff'; g.fillRect(60, 60, 8, 8); // a plain patch: skin and hair point their texture here
  FAB = new THREE.CanvasTexture(c); FAB.wrapS = FAB.wrapT = THREE.RepeatWrapping; FAB.colorSpace = THREE.SRGBColorSpace; FAB.anisotropy = 8; return FAB;
}
const MATS = {};
function mats() {
  if (MATS.cloth) return MATS;
  MATS.cloth = new THREE.MeshStandardMaterial({ vertexColors: true, map: fabric(), roughness: 0.86 });
  MATS.skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }); // skin, hair sheen, leather, lenses
  MATS.gold = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.28 }); // gold, rose gold, silver and diamonds (their colours are in the vertices)
  return MATS;
}

// ---------------- geometry helpers ----------------
const col = c => new THREE.Color(c);
function paint(geo, c, plain) {
  const g = geo, n = g.attributes.position.count, a = new Float32Array(n * 3), cc = typeof c === 'function' ? null : col(c), p = g.attributes.position;
  for (let i = 0; i < n; i++) { const k = cc || col(c(p.getY(i), p.getX(i), p.getZ(i))); a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (plain) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5); } // the plain patch of the weave
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const at = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { geo.scale(sx, sy, sz); if (rx) geo.rotateX(rx); if (ry) geo.rotateY(ry); if (rz) geo.rotateZ(rz); geo.translate(x, y, z); return geo; };
const rbox = (w, h, d, r = Math.min(w, h, d) * 0.45) => mergeVertices(new RoundedBoxGeometry(w, h, d, 2, r)); /* indexed, so it merges with everything else */
const sphere = (r, w = 28, h = 20, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const lathe = (pts, seg = 36) => new THREE.LatheGeometry([...pts].sort((a, b) => a[1] - b[1]).map(([r, y]) => new V2(Math.max(0.0005, r), y)), seg); /* bottom to top, so it faces outwards */
const dense = (prof, step = 0.032) => { const fine = prof.fine || [], P = [...prof].sort((a, b) => a[1] - b[1]), out = []; const st = y => (fine.some(([a, b]) => y >= a && y <= b) ? 0.017 : step);
  for (let i = 0; i < P.length; i++) { out.push(P[i]); if (i + 1 < P.length) for (let y = P[i][1] + st(P[i][1]); y < P[i + 1][1] - 0.006; y += st(y)) out.push([radiusAt(P, y), y]); } return out; };
const radiusAt = (prof, y) => { for (let i = 1; i < prof.length; i++) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) { const t = (y - y0) / (y1 - y0 || 1); return r0 + (r1 - r0) * t; } } return prof[prof.length - 1][0]; };
// a shell over part of a body profile: from y0 to y1, `pad` metres out; flare widens the bottom edge (a cuff, a hem)
function shell(prof, y0, y1, pad, { flare = 0, closeTop = false, seg = prof.seg || 30 } = {}) {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1), pts = [[radiusAt(prof, lo) + pad + flare, lo]];
  for (const [r, y] of dense(prof)) if (y > lo && y < hi) pts.push([r + pad, y]);
  pts.push([radiusAt(prof, hi) + pad, hi]); if (closeTop) pts.push([0.001, hi + 0.005]);
  return lathe(pts.sort((a, b) => a[1] - b[1]), seg);
}

// ---------------- the face, painted round the head ----------------
// The texture wraps the head all the way round (1024 × 512): straight ahead is a quarter of the way along.
const FACES = new Map();
function faceTexture(L) {
  const key = [L.sk, L.ey, L.br, L.mk, L.lc, L.bdr, L.hc, L.g].join('|'); if (FACES.has(key)) { const f = FACES.get(key); f.n++; return f.t; }
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), k = W / 360, cx = W * 0.25, eyeY = H / 2 - 9 * k;
  g.fillStyle = L.sk; g.fillRect(0, 0, W, H);
  // soft shading: warmer cheeks, a little shadow under the brow and round the jaw
  const sh = g.createRadialGradient(cx, H / 2, 10, cx, H / 2, 70 * k); sh.addColorStop(0, 'rgba(255,240,230,.10)'); sh.addColorStop(1, 'rgba(60,30,20,.16)'); g.fillStyle = sh; g.fillRect(0, 0, W, H);
  for (const s of [-1, 1]) { const ch = g.createRadialGradient(cx + s * 22 * k, eyeY + 16 * k, 2, cx + s * 22 * k, eyeY + 16 * k, 13 * k); ch.addColorStop(0, `rgba(210,90,80,${L.g === 'f' ? 0.16 : 0.09})`); ch.addColorStop(1, 'rgba(210,90,80,0)'); g.fillStyle = ch; g.fillRect(0, 0, W, H); }
  // stubble / a beard's shadow
  if (L.bdr) { const a = L.bdr === 1 ? 0.28 : L.bdr === 2 ? 0 : 0.42; if (a) { g.save(); g.globalAlpha = a; g.fillStyle = L.hc; g.beginPath(); g.ellipse(cx, eyeY + 36 * k, 40 * k, 30 * k, 0, 0, Math.PI); g.fill();
    g.beginPath(); g.ellipse(cx, eyeY + 28 * k, 17 * k, 6 * k, 0, 0, Math.PI * 2); g.fill(); g.restore(); g.save(); g.globalCompositeOperation = 'source-over'; g.fillStyle = L.sk; g.globalAlpha = 0.6; g.beginPath(); g.ellipse(cx, eyeY + 32 * k, 13 * k, 4 * k, 0, 0, Math.PI * 2); g.fill(); g.restore(); } }
  // eyes: whites, iris in their colour, pupil, a glint; upper lashes; eyeshadow if they wear it
  for (const s of [-1, 1]) { const x = cx + s * 20 * k, y = eyeY;
    if (L.mk === 2 || L.mk === 3) { const es = g.createRadialGradient(x, y - 2 * k, 1, x, y - 2 * k, 8 * k); es.addColorStop(0, 'rgba(120,70,130,.45)'); es.addColorStop(1, 'rgba(120,70,130,0)'); g.fillStyle = es; g.fillRect(x - 10 * k, y - 10 * k, 20 * k, 12 * k); }
    g.fillStyle = '#F7F3EE'; g.beginPath(); g.ellipse(x, y, 6.2 * k, 3.6 * k, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = L.ey; g.beginPath(); g.arc(x, y + 0.3 * k, 2.9 * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x, y + 0.3 * k, 2.9 * k, 0, Math.PI * 2); g.lineWidth = 0.7 * k; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(x, y + 0.3 * k, 1.35 * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x + 0.9 * k, y - 0.8 * k, 0.6 * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1d140f'; g.lineWidth = (L.g === 'f' ? 1.3 : 0.9) * k; g.beginPath(); g.ellipse(x, y + 0.6 * k, 6.4 * k, 4 * k, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    g.strokeStyle = 'rgba(80,40,30,.25)'; g.lineWidth = 0.6 * k; g.beginPath(); g.ellipse(x, y - 0.2 * k, 6.2 * k, 3.6 * k, 0, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
    // brows: thin, natural, thick or arched
    const bw = [0.9, 1.5, 2.3, 1.3][L.br] * k, lift = L.br === 3 ? 3.2 * k : 1.6 * k; g.strokeStyle = L.hc; g.lineCap = 'round'; g.lineWidth = bw; g.globalAlpha = 0.92;
    g.beginPath(); g.moveTo(x - s * 6.5 * k, y - 6.5 * k); g.quadraticCurveTo(x + s * 0.5 * k, y - 6.5 * k - lift, x + s * 7 * k, y - 5.5 * k); g.stroke(); g.globalAlpha = 1; }
  // nose shadow, lips (their lipstick if they wear it), the mouth line
  g.fillStyle = 'rgba(60,30,20,.16)'; g.beginPath(); g.ellipse(cx, eyeY + 21 * k, 6 * k, 2.2 * k, 0, 0, Math.PI * 2); g.fill();
  const lipC = L.mk === 1 || L.mk === 3 ? LIPS[L.lc] || LIPS[0] : null, my = eyeY + 32 * k, mw = 12 * k;
  g.fillStyle = lipC || 'rgba(150,70,60,.45)'; g.beginPath(); g.moveTo(cx - mw, my); g.quadraticCurveTo(cx - mw * 0.45, my - 3.2 * k, cx, my - 1.6 * k); g.quadraticCurveTo(cx + mw * 0.45, my - 3.2 * k, cx + mw, my);
  g.quadraticCurveTo(cx, my + (L.g === 'f' ? 5.2 : 4) * k, cx - mw, my); g.fill();
  g.strokeStyle = 'rgba(70,25,20,.65)'; g.lineWidth = 0.8 * k; g.beginPath(); g.moveTo(cx - mw, my); g.quadraticCurveTo(cx, my + 1.1 * k, cx + mw, my); g.stroke();
  // where the ears are, a touch darker
  for (const s of [-1, 1]) { g.fillStyle = 'rgba(0,0,0,.08)'; g.beginPath(); g.ellipse(cx + s * 90 * k, eyeY + 6 * k, 6 * k, 11 * k, 0, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  FACES.set(key, { t, n: 1 }); t.userData.key = key; return t;
}
function dropFace(t) { const f = FACES.get(t.userData.key); if (!f) return; if (--f.n <= 0) { FACES.delete(t.userData.key); t.dispose(); } }

// ---------------- bone weights ----------------
// Bones: 0 hips, 1 spine, 2 chest, 3 neck, 4 head, 5/6 left upper arm/forearm, 7/8 right, 9/10/11 left thigh/shin/foot,
// 12/13/14 right. Near a joint a vertex leans on both bones, so the body bends smoothly instead of folding.
const BI = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, upperArmL: 5, forearmL: 6, upperArmR: 7, forearmR: 8, thighL: 9, shinL: 10, footL: 11, thighR: 12, shinR: 13, footR: 14 };
const rmp = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
const two = (a, b, t) => [[a, 1 - t], [b, t]];
function torsoW(y) {
  if (y < 0.98) return [['hips', 1]]; if (y < 1.1) return two('hips', 'spine', rmp(y, 0.98, 1.1)); if (y < 1.18) return [['spine', 1]];
  if (y < 1.28) return two('spine', 'chest', rmp(y, 1.18, 1.28)); if (y < 1.47) return [['chest', 1]]; if (y < 1.56) return two('chest', 'neck', rmp(y, 1.47, 1.56));
  if (y < 1.61) return [['neck', 1]]; if (y < 1.66) return two('neck', 'head', rmp(y, 1.61, 1.66)); return [['head', 1]];
}
function armW(y, s) { const U = 'upperArm' + s, F = 'forearm' + s; if (y > -0.02) return two(U, 'chest', rmp(y, -0.02, 0.07) * 0.55); if (y > -0.26) return [[U, 1]]; if (y > -0.34) return two(U, F, rmp(-y, 0.26, 0.34)); return [[F, 1]]; }
function legW(y, s) { const T = 'thigh' + s, S = 'shin' + s, Fo = 'foot' + s;
  if (y > -0.05) return two(T, 'hips', rmp(y, -0.05, 0.05) * 0.5); if (y > -0.39) return [[T, 1]]; if (y > -0.49) return two(T, S, rmp(-y, 0.39, 0.49));
  if (y > -0.8) return [[S, 1]]; if (y > -0.845) return two(S, Fo, rmp(-y, 0.8, 0.845)); return [[Fo, 1]]; }
function skirtW(x, y) { const t = rmp(1 - y, 0.04, 0.5) * 0.65, l = rmp(-x, -0.06, 0.06); return [['hips', 1 - t], ['thighL', t * l], ['thighR', t * (1 - l)]]; }
// gives a piece its bone weights, and moves a limb piece from its shoulder or hip into place
function skinTo(geo, grp, B) {
  const p = geo.attributes.position, n = p.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), side = grp.endsWith('L') ? 'L' : 'R';
  const limb = grp === 'armL' || grp === 'armR' ? 'arm' : grp === 'legL' || grp === 'legR' ? 'leg' : null;
  for (let i = 0; i < n; i++) { const x = p.getX(i), y = p.getY(i);
    const w = grp === 'head' || grp === 'chest' || grp === 'neck' ? [[grp, 1]] : grp === 'skirt' ? skirtW(x, y) : limb === 'arm' ? armW(y, side) : limb === 'leg' ? legW(y, side) : torsoW(y);
    let k = 0, sum = 0; for (const [b, v] of w) if (v > 0.001 && k < 4) { si[i * 4 + k] = BI[b]; sw[i * 4 + k] = v; sum += v; k++; }
    for (let j = 0; j < k; j++) sw[i * 4 + j] /= sum || 1; }
  if (limb) geo.translate(limb === 'arm' ? (side === 'L' ? -B.shX : B.shX) : (side === 'L' ? -B.hipX : B.hipX), limb === 'arm' ? 1.405 : 0.9, 0);
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

// ---------------- the body ----------------
function bodyShape(L) {
  const f = L.g === 'f', b = L.bd;
  const sx = [0.9, 1, 1.06, 1.1][b], chest = [0.92, 1, 1.12, 1.1][b], waist = [0.88, 1, 1.05, 1.28][b], hips = [0.92, 1, 1.04, 1.16][b], limb = [0.88, 1, 1.12, 1.18][b];
  const hip = (f ? 0.188 : 0.172) * hips, wst = (f ? 0.132 : 0.152) * waist, ch = (f ? 0.168 : 0.186) * chest, sh = (f ? 0.17 : 0.198) * chest;
  const torso = [[0.001, 0.835], [hip * 0.8, 0.85], [hip, 0.92], [hip * 0.97, 0.99], [(hip + wst) / 2, 1.04], [wst, 1.1], [(wst + ch) / 2, 1.2], [ch, 1.3], [sh, 1.38], [sh * 0.86, 1.44], [sh * 0.55, 1.49], [0.07, 1.535], [0.055, 1.6]];
  const depth = b === 3 ? 0.78 : f ? 0.7 : 0.66;
  const arm = [[0.004, 0.058], [0.036 * limb, 0.048], [0.05 * limb, 0.02], [0.05 * limb, -0.04], [0.046 * limb, -0.16], [0.04 * limb, -0.29], [0.042 * limb, -0.35], [0.036 * limb, -0.48], [0.03 * limb, -0.56]];
  const leg = [[0.086 * hips * (f ? 1.04 : 1), 0.02], [0.084 * limb, -0.06], [0.072 * limb, -0.24], [0.052 * limb, -0.44], [0.056 * limb, -0.56], [0.048 * limb, -0.7], [0.034, -0.83], [0.032, -0.86]];
  // the torso is flatter front to back than round; a woman's chest is shaped into it (and into each layer worn over it)
  const shape = geo => { geo.scale(1, 1, depth); if (!f) return geo; const p = geo.attributes.position, amt = [0.03, 0.036, 0.042, 0.046][b];
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); if (z <= 0) continue; const x = Math.abs(p.getX(i)), y = p.getY(i), k = Math.exp(-((x - 0.075) ** 2) / 0.0028 - ((y - 1.29) ** 2) / 0.0042); p.setZ(i, z + amt * k * Math.min(1, z / 0.06)); }
    geo.computeVertexNormals(); return geo; };
  torso.fine = f ? [[1.18, 1.38], [0.97, 1.11]] : [[0.97, 1.11]]; torso.seg = 32; /* where the body bends or curves, rows close together */
  arm.fine = [[-0.37, -0.23], [-0.04, 0.07]]; arm.seg = 14; leg.fine = [[-0.52, -0.36], [-0.07, 0.05], [-0.86, -0.78]]; leg.seg = 16;
  return { f, torso, depth, shape, arm, leg, hipX: hip * 0.5, shX: sh * 0.96 + 0.032, sh, scale: [0.9, 0.95, 1, 1.05, 1.1][L.ht] * (f ? 0.955 : 1) };
}

// ---------------- hair ----------------
function hairParts(L, add, hd) {
  const { y, rx, ry, rz } = hd, c = L.hc, R = Math.max(rx, rz);
  // under a hat, hair that stands up is pressed flat (long hair still hangs below it)
  const s = L.w.hat ? ({ afro: 'short', twists: 'short', mohawk: 'buzz', curlyshort: 'short', quiff: 'short', manbun: 'short', spacebuns: 'short', slick: 'short', side: 'short', curly: 'wavy', bangs: 'long', pixie: 'short' })[L.hs] || L.hs : L.hs;
  // hair that follows a hairline: high on the forehead, down round the ears, low at the nape
  const capGeo = (front, side, back, pad) => { const g = sphere(1, 40, 26, 0, Math.PI * 2, 0, Math.min(Math.PI, back + 0.05)), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), th = Math.acos(Math.max(-1, Math.min(1, Y))), az = Math.abs(Math.atan2(X, Z)) / Math.PI; /* 0 = straight ahead, 1 = behind */
      const lim = az < 0.5 ? front + (side - front) * Math.sin(az * Math.PI) ** 2 : side + (back - side) * Math.sin((az - 0.5) * Math.PI); if (th > lim) { const k = 1 - Math.min(1, (th - lim) / 0.05) * 0.16; p.setXYZ(i, X * k, Y * k, Z * k); } }
    g.computeVertexNormals(); return at(g, 0, y, 0, rx + pad, ry + pad, rz + pad); };
  const cap = (th = 1.2, pad = 0.012, back = 1.75) => add('hair', capGeo(th - 0.2, Math.max(th + 0.2, 1.4), back + 0.05, pad), c);
  const blob = (x, yy, z, sx, sy, sz, cc = c) => add('hair', at(sphere(1, 14, 10), x, yy, z, sx, sy, sz), cc);
  const strand = (x, z, len, r) => add('hair', at(new THREE.CapsuleGeometry(r, len, 3, 8), x, y - 0.02 - len / 2, z), c);
  const back = (len, spread = 1.15, wave = 0) => { const g = new THREE.CylinderGeometry(R + 0.022, R + 0.04 * spread, len, 26, 6, true, Math.PI * 0.3, Math.PI * 1.4);
    if (wave) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const yy = p.getY(i), k = 1 + Math.sin(yy * 38 + Math.atan2(p.getX(i), p.getZ(i)) * 6) * wave; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } g.computeVertexNormals(); }
    add('hair', at(g, 0, y - len / 2 + 0.05, -0.008), c);
    add('hair', at(new THREE.CylinderGeometry(R + 0.018, R + 0.035 * spread, len, 26, 1, true, Math.PI * 0.3, Math.PI * 1.4), 0, y - len / 2 + 0.05, -0.008, -1, 1, 1), new THREE.Color(c).multiplyScalar(0.8)); };
  const fringe = () => add('hair', at(sphere(1, 20, 10, Math.PI * 0.2, Math.PI * 0.6, 0.35, 0.65), 0, y + 0.005, 0, rx + 0.02, ry + 0.012, rz + 0.026), c);
  switch (s) {
    case 'bald': return;
    case 'buzz': add('hair', capGeo(1.0, 1.45, 1.85, 0.003), new THREE.Color(c).lerp(new THREE.Color(L.sk), 0.35)); return;
    case 'short': cap(); return;
    case 'side': cap(1.15); blob(rx * 0.4, y + ry * 0.78, rz * 0.2, rx * 0.75, ry * 0.32, rz * 0.8); return;
    case 'curlyshort': cap(1.15); for (let i = 0; i < 18; i++) { const a = i * 2.4, r2 = 0.35 + (i % 4) * 0.15; blob(Math.cos(a) * rx * r2, y + ry * (0.86 - r2 * 0.25), Math.sin(a) * rz * r2, 0.034, 0.03, 0.034); } return;
    case 'afro': cap(1.15); blob(0, y + 0.07, -0.05, R * 1.55, R * 1.35, R * 1.38); return;
    case 'quiff': cap(1.15); blob(0, y + ry * 0.92, rz * 0.45, rx * 0.7, ry * 0.32, rz * 0.5); return;
    case 'cornrows': add('hair', capGeo(1.0, 1.45, 1.85, 0.003), new THREE.Color(c).lerp(new THREE.Color(L.sk), 0.3));
      for (let i = -3; i <= 3; i++) add('hair', at(new THREE.TorusGeometry(1, 0.06, 6, 24, Math.PI * 1.15), 0, y, 0, rx + 0.012, ry + 0.012, rz + 0.012, 0, Math.PI / 2, Math.PI * 0.92).rotateZ(i * 0.16), c); return;
    case 'twists': cap(1.15); for (let i = 0; i < 26; i++) { const a = i * 2.4, r2 = 0.3 + (i % 5) * 0.13, g = new THREE.ConeGeometry(0.022, 0.07, 6); const n = new THREE.Vector3(Math.cos(a) * r2, 0.95 - r2 * 0.4, Math.sin(a) * r2).normalize();
      g.translate(0, 0.035, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)); g.translate(n.x * rx, y + n.y * ry, n.z * rz); add('hair', g, c); } return;
    case 'mohawk': add('hair', capGeo(1.0, 1.45, 1.85, 0.002), new THREE.Color(c).lerp(new THREE.Color(L.sk), 0.55));
      add('hair', at(new THREE.TorusGeometry(1, 0.13, 8, 24, Math.PI * 1.1), 0, y, 0, 0.18, ry + 0.035, rz + 0.035, 0, Math.PI / 2, Math.PI * 0.95), c); return;
    case 'slick': cap(1.32, 0.01, 1.85); return;
    case 'manbun': cap(1.2); blob(0, y + ry * 0.85, -rz * 0.55, 0.05, 0.045, 0.05); return;
    case 'long': cap(1.2); back(0.36); return;
    case 'wavy': cap(1.2); back(0.36, 1.4, 0.05); return;
    case 'bob': cap(1.22); back(0.17, 1.2); return;
    case 'pixie': cap(1.1); fringe(); return;
    case 'pony': cap(1.25, 0.008, 1.8); { const g = new THREE.CapsuleGeometry(0.035, 0.24, 4, 10); g.translate(0, -0.12, 0); g.rotateX(0.35); g.translate(0, y + ry * 0.35, -rz - 0.03); add('hair', g, c); blob(0, y + ry * 0.4, -rz - 0.01, 0.035, 0.035, 0.03); } return;
    case 'bun': cap(1.25, 0.008, 1.8); blob(0, y + ry * 0.55, -rz - 0.04, 0.062, 0.058, 0.055); return;
    case 'curly': for (let i = 0; i < 26; i++) { const a = i * 2.39996, t = (i % 13) / 13; blob(Math.cos(a) * R * (1.05 + t * 0.2), y + ry * 0.9 - t * 0.28, Math.sin(a) * R * (1.05 + t * 0.2) - 0.02, 0.07, 0.07, 0.07); }
      add('hair', capGeo(1.0, 1.5, 1.9, 0.03), c); return;
    case 'bangs': cap(1.2); back(0.34); fringe(); return;
    case 'braids': case 'locs': case 'dreads': { cap(1.22); const n = s === 'braids' ? 22 : s === 'locs' ? 16 : 18, r = s === 'braids' ? 0.012 : s === 'locs' ? 0.018 : 0.016, len = s === 'dreads' ? 0.22 : 0.34;
      for (let i = 0; i < n; i++) { const a = Math.PI * 0.32 + (i / (n - 1)) * Math.PI * 1.36, x = Math.sin(a) * (R + 0.02), z = Math.cos(a) * (R + 0.02); strand(x, z, len + ((i * 7) % 5) * 0.012, r); } return; }
    case 'spacebuns': cap(1.25, 0.008, 1.8); blob(-rx * 0.6, y + ry * 0.85, -0.01, 0.05, 0.048, 0.05); blob(rx * 0.6, y + ry * 0.85, -0.01, 0.05, 0.048, 0.05); return;
    default: cap();
  }
}

// ---------------- what they wear ----------------
function wearParts(L, add, B, hd) {
  const shellT = (...a) => B.shape(shell(B.torso, ...a));
  // a skirt (or a dress's, or a long coat's): it follows the body from the waist to the hips, then flares out, flat like
  // the body at the top and rounder at the hem, so it joins the top without a ledge
  const skirtGeo = (y0, rBot, yBot, pad) => { const yH = 0.9, pts = []; for (let y = y0; y > yH; y -= 0.02) pts.push([radiusAt(torso, y) + pad, y]); const rH = radiusAt(torso, yH) + pad;
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([rH + (rBot - rH) * Math.pow(t, 0.85), yH + (yBot - yH) * t]); }
    const g = lathe(pts, 32), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), t = Math.max(0, Math.min(1, (yH + 0.03 - y) / (yH - yBot))); p.setZ(i, p.getZ(i) * (B.depth + (0.9 - B.depth) * t)); }
    g.computeVertexNormals(); return g; };
  const w = L.w, C = s => CLOTH[w[s][1]], X = s => (itemOf(s, w[s][0]) || [])[3] || {}, k = s => w[s][0];
  const { torso, arm, leg, f } = B, top = w.top, bot = w.bot, full = top && X('top').full;
  // how far the front (or back, z < 0) of the body is at a height, `x` to the side
  const zAt = (yy, xx = 0) => Math.sqrt(Math.max(0, radiusAt(torso, yy) ** 2 - xx * xx)) * B.depth;
  // a thin stripe down the outer side of an arm or leg (side -1 for the left), following its profile through the heights ys
  const strip = (part, prof, ys, pad, side, c, wd = 0.013) => { for (let i = 1; i < ys.length; i++) { const r0 = radiusAt(prof, ys[i - 1]) + pad, r1 = radiusAt(prof, ys[i]) + pad, dx = side * (r1 - r0), dy = ys[i] - ys[i - 1];
    add(part, 'cloth', at(new THREE.BoxGeometry(0.004, Math.hypot(dx, dy) + 0.004, wd), side * (r0 + r1) / 2, (ys[i - 1] + ys[i]) / 2, 0, 1, 1, 1, 0, 0, Math.atan2(-dx, dy)), c); } };
  const sideOf = s => (s === 'armL' || s === 'legL' ? -1 : 1);
  const GOLD = '#E2B13C', ROSE = '#E3A68C', SILVER = '#CDD3DB', ICE = '#F2F8FF';
  // a necklace that lies on the body: round the neck at the back, down onto the chest at the front
  const necklace = (drop, tube, c) => { const pad = w.out ? 0.03 : top ? 0.017 : 0.006, pts = [];
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, cf = Math.cos(a), yy = 1.525 - drop * Math.max(0, cf) ** 1.6, r = radiusAt(torso, yy) + pad; pts.push(new THREE.Vector3(Math.sin(a) * r, yy, cf * r * B.depth)); }
    add('chest', 'gold', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, tube, 5, true), c); return [1.525 - drop, zAt(1.525 - drop) + pad]; };
  // digits made of bars (a jersey's number): which of the seven bars each digit lights
  const SEG = { 2: 'abged', 3: 'abgcd' }, digit = (d, x0, y0, z, c, back) => { const W = 0.03, H = 0.03, t = 0.008, bars = { a: [0, H, W, t], g: [0, 0, W, t], d: [0, -H, W, t], b: [W / 2, H / 2, t, H], c: [W / 2, -H / 2, t, H], e: [-W / 2, -H / 2, t, H], f: [-W / 2, H / 2, t, H] };
    for (const ch of SEG[d]) { const [bx, by, bw, bh] = bars[ch]; add('chest', 'cloth', at(new THREE.BoxGeometry(bw, bh + t * 0.5, 0.004), (back ? -1 : 1) * (x0 + bx), y0 + by, z), c); } };
  const logo = (part, x, yy, z, c = GOLD) => add(part, 'gold', at(rbox(0.03, 0.022, 0.006), x, yy, z), c);
  // ---- underwear, where nothing covers it ----
  // (never naked: underwear is always there under whatever isn't worn; swimwear takes its place)
  const swimTop = top && (X('top').bikini || X('top').swim), onePiece = top && X('top').swim;
  if ((!top || X('top').crop) && f) add('body', 'cloth', shellT(1.2, 1.345, 0.006), UNDER);
  if (!bot && !full && !onePiece) { add('body', 'cloth', shellT(0.835, 0.98, 0.006), UNDER); for (const s of ['legL', 'legR']) add(s, 'cloth', shell(leg, -0.11, 0.02, 0.005), UNDER); }
  // ---- top ----
  if (swimTop) { const c = C('top');
    if (onePiece) { add('body', 'cloth', shellT(0.835, 1.4, 0.007), c); for (const s of ['legL', 'legR']) add(s, 'cloth', shell(leg, -0.09, 0.02, 0.006), c); }
    else add('body', 'cloth', shellT(1.2, 1.345, 0.007), c); }
  else if (top) { const x = X('top'), c = C('top'), y0 = x.crop ? 1.17 : full ? 0.86 : 0.9, bare = k('top') === 'tank' || x.straps || x.vest, sleeve = bare ? 0 : x.long ? -0.55 : -0.2;
    const stripe = x.stripe ? (yy => (Math.floor(yy * 22) % 2 ? c : '#F4F1EA')) : c;
    add('body', 'cloth', shellT(y0, bare ? 1.44 : 1.52, 0.012), stripe);
    if (sleeve) for (const s of ['armL', 'armR']) add(s, 'cloth', shell(arm, sleeve, 0.059, 0.01, { flare: x.long ? 0.004 : 0.012, closeTop: true }), c);
    if (x.collar) add('body', 'cloth', at(new THREE.TorusGeometry(0.072, 0.014, 8, 24), 0, 1.53, 0.005, 1, 1, 0.9, Math.PI / 2 - 0.25), c);
    if (x.hood) add('chest', 'cloth', at(sphere(1, 24, 14, Math.PI, Math.PI, 0.4, 1.5), 0, 1.5, -0.035, 0.135, 0.075, 0.075), c);
    if (x.trim && sleeve) for (const s of ['armL', 'armR']) strip(s, arm, [0.03, -0.16, -0.35, sleeve + 0.01], 0.011, sideOf(s), '#F4F1EA');
    if (x.zip) add('body', 'cloth', at(new THREE.TorusGeometry(0.07, 0.016, 8, 24), 0, 1.535, 0.003, 1, 1, 0.92, Math.PI / 2), c);
    if (x.number) { const nc = new THREE.Color(c).getHSL({}).l > 0.6 ? '#1B1C1E' : '#F4F1EA'; for (const back of [false, true]) { const z = (back ? -1 : 1) * (zAt(1.18, 0.03) + 0.016); digit(2, -0.025, 1.18, z, nc, back); digit(3, 0.025, 1.18, z, nc, back); } }
    if (x.logo) logo('chest', 0.07, 1.4, zAt(1.4, 0.07) + 0.016);
    if (full) { const len = x.floor ? 0.78 : 0.42; add('skirt', 'cloth', skirtGeo(1.0, 0.24 + (x.floor ? 0.06 : 0), 0.96 - len, 0.013), c); } }
  // ---- bottoms ----
  if (bot) { const x = X('bot'), c = C('bot');
    if (x.briefs) { add('body', 'cloth', shellT(0.835, 0.98, 0.008), c); for (const s of ['legL', 'legR']) add(s, 'cloth', shell(leg, -0.1, 0.02, 0.007), c); }
    else add('body', 'cloth', shellT(x.skirt ? 0.835 : 0.852, x.skirt ? 1.02 : 1.0, 0.013), c); /* trousers: the legs close the seat, so no dark point between them */
    if (x.skirt) { const len = x.floor ? 0.8 : 0.4; add('skirt', 'cloth', skirtGeo(1.02, 0.22 + (x.floor ? 0.07 : 0), 1.0 - len, 0.015), c); }
    else if (!x.briefs) for (const s of ['legL', 'legR']) { const to = x.swim ? -0.24 : x.short ? -0.32 : -0.84, pad = x.tight ? 0.004 : 0.012; add(s, 'cloth', shell(leg, to, 0.06, pad, { flare: x.tight || x.short ? 0.004 : k('bot') === 'joggers' || x.trim ? -0.004 : 0.008 }), c);
      if (x.trim) strip(s, leg, [-0.02, -0.24, -0.44, -0.56, -0.7, -0.82], 0.013, sideOf(s), '#F4F1EA');
      if (x.crease) add(s, 'cloth', at(new THREE.BoxGeometry(0.003, 0.7, 0.003), 0, -0.45, radiusAt(leg, -0.45) + 0.012), new THREE.Color(c).multiplyScalar(0.8));
      if (x.pockets) add(s, 'cloth', at(rbox(0.05, 0.09, 0.03), (s === 'legL' ? -1 : 1) * 0.07, -0.3, 0.01), new THREE.Color(c).multiplyScalar(0.85)); }
    if (!x.swim && !x.briefs && !x.tight) add('body', 'skin', shellT(0.985, 1.0, 0.016), '#2a2522'); // a belt line
    if (x.logo) add('body', 'skin', at(rbox(0.04, 0.026, 0.004), 0.055, 0.955, -(zAt(0.955, 0.055) + 0.015)), '#8C5B33'); } // a leather patch at the back
  // ---- jacket / coat ----
  if (w.out) { const x = X('out'), c = C('out'), pad = x.puffy ? 0.04 : 0.024, mat = x.shiny ? 'skin' : 'cloth';
    add('body', mat, shellT(x.long ? 0.86 : 0.92, 1.51, pad), c); for (const s of ['armL', 'armR']) add(s, mat, shell(arm, -0.53, 0.059, pad * 0.7, { flare: 0.006, closeTop: true }), c);
    if (x.long) add('skirt', mat, skirtGeo(0.94, 0.25, 0.5, pad), c);
    add('body', mat, at(new THREE.TorusGeometry(0.082, 0.018, 8, 24, Math.PI * 1.4), 0, 1.5, 0.01, 1, 1, 0.95, Math.PI / 2 - 0.3, 0, Math.PI * 1.2), c);
    if (x.lapel) { const z = zAt(1.4) + pad, lc = x.satin ? '#121212' : new THREE.Color(c).multiplyScalar(0.82);
      add('body', 'cloth', at(new THREE.CylinderGeometry(0.062, 0.062, 0.004, 3), 0, 1.43, z + 0.002, 1, 1, 1, Math.PI / 2), '#F4F1EA'); /* the shirt in the V */
      for (const sd of [-1, 1]) add('body', x.satin ? 'skin' : 'cloth', at(rbox(0.032, 0.2, 0.006), sd * 0.045, 1.405, z + 0.004, 1, 1, 1, -0.08, 0, -sd * 0.4), lc); /* lapels: a V down to the top button */
      for (const by of [1.2, 1.1]) add('body', 'skin', at(sphere(0.007, 8, 6), 0, by, zAt(by) + pad + 0.003), '#1d1b19');
      if (x.satin && !w.neck) for (const sd of [-1, 1]) add('body', 'skin', at(sphere(1, 10, 8), sd * 0.016, 1.452, z + 0.008, 0.018, 0.011, 0.007), '#121212'); /* a bow tie */
      if (x.logo) logo('body', 0.09, 1.2, zAt(1.2, 0.09) + pad + 0.01); } }
  // ---- shoes ----
  for (const s of ['legL', 'legR']) { const sh = w.shoe, c = sh ? C('shoe') : null, x = sh ? X('shoe') : {}, h = sh && k('shoe'), sd = sideOf(s);
    if (!sh || h === 'sandals' || x.slide) { add(s, 'skin', at(new THREE.CapsuleGeometry(0.035, 0.13, 4, 10), 0, -0.865, 0.04, 1, 0.8, 1, Math.PI / 2), L.sk); if (sh) add(s, 'skin', at(rbox(0.085, 0.015, 0.22), 0, -0.893, 0.04), x.slide ? '#1d1b19' : c);
      if (x.slide) add(s, 'skin', at(rbox(0.088, 0.03, 0.075, 0.012), 0, -0.862, 0.075), c); continue; }
    add(s, 'skin', at(new THREE.CapsuleGeometry(0.045, 0.15, 4, 12), 0, -0.86, 0.045, 1, 0.82, x.thin ? 1.06 : 1, Math.PI / 2), c);
    add(s, 'skin', at(rbox(0.098, x.chunky ? 0.036 : 0.024, x.chunky ? 0.26 : 0.25, 0.011), 0, x.chunky ? -0.884 : -0.888, 0.045), h === 'sneakers' || h === 'hightops' || x.white ? '#F2F0EA' : x.chunky ? '#3a2a1c' : '#1d1b19');
    if (x.high) add(s, 'skin', shell(leg, -0.86, h === 'boots' ? -0.6 : x.chunky ? -0.68 : -0.74, 0.016), c);
    if (h === 'chelsea') add(s, 'skin', at(rbox(0.004, 0.08, 0.04), sd * (radiusAt(leg, -0.8) + 0.018), -0.79, 0), '#1d1b19'); /* the elastic side */
    if (x.trim) add(s, 'skin', at(rbox(0.004, 0.018, 0.12), sd * 0.05, -0.862, 0.035, 1, 1, 1, 0.25), new THREE.Color(c).getHSL({}).l > 0.6 ? '#1B1C1E' : '#F4F1EA');
    if (x.logo) add(s, 'gold', at(rbox(0.004, 0.014, 0.02), sd * 0.05, -0.855, -0.03), GOLD);
    if (x.heel) add(s, 'skin', at(new THREE.CylinderGeometry(x.thin ? 0.007 : 0.012, x.thin ? 0.003 : 0.008, x.thin ? 0.085 : 0.07, 8), 0, x.thin ? -0.885 : -0.88, -0.05), c); }
  // ---- on the head ----
  const { y, rx, ry, rz } = hd;
  if (w.hat) { const c = C('hat'), h = k('hat'), R = Math.max(rx, rz) + 0.02;
    if (h === 'cap') { add('head', 'cloth', at(sphere(1, 28, 14, 0, Math.PI * 2, 0, 1.5), 0, y + 0.012, 0, R, ry + 0.008, R), c); add('head', 'cloth', at(new THREE.CylinderGeometry(1, 1, 0.01, 24, 1, false, -1.1, 2.2), 0, y + ry * 0.42, R * 0.3, R * 0.95, 1, R * 1.55, -0.1), c); }
    else if (h === 'beanie') { add('head', 'cloth', at(sphere(1, 24, 12, 0, Math.PI * 2, 0, 1.55), 0, y + 0.025, 0, R + 0.005, ry + 0.045, R + 0.005), c); add('head', 'cloth', at(new THREE.TorusGeometry(R + 0.006, 0.016, 8, 28), 0, y + 0.0, 0, 1, 1, 1, Math.PI / 2), c); }
    else if (h === 'bucket') { add('head', 'cloth', at(new THREE.CylinderGeometry(R * 0.85, R + 0.01, 0.1, 24), 0, y + ry * 0.75, 0), c); add('head', 'cloth', at(new THREE.CylinderGeometry(R + 0.01, R + 0.06, 0.04, 24, 1, true), 0, y + ry * 0.38, 0), c); }
    else if (h === 'headwrap') { add('head', 'cloth', at(sphere(1, 24, 12, 0, Math.PI * 2, 0, 1.6), 0, y + 0.04, -0.02, R + 0.01, ry + 0.07, R + 0.02), c); add('head', 'cloth', at(sphere(1, 14, 10), 0, y + ry + 0.06, 0.03, 0.06, 0.045, 0.05), c); }
    else if (h === 'sunhat') { add('head', 'cloth', at(sphere(1, 24, 12, 0, Math.PI * 2, 0, 1.5), 0, y + 0.01, 0, R, ry + 0.03, R), c); add('head', 'cloth', at(new THREE.CylinderGeometry(R + 0.13, R + 0.14, 0.01, 32), 0, y + ry * 0.45, 0), c); }
    else if (h === 'fedora') { add('head', 'cloth', at(new THREE.CylinderGeometry(R * 0.82, R * 0.95, 0.12, 24), 0, y + ry * 0.78, 0), c); add('head', 'cloth', at(new THREE.CylinderGeometry(R + 0.06, R + 0.07, 0.01, 28), 0, y + ry * 0.38, 0), c);
      add('head', 'skin', at(new THREE.CylinderGeometry(R * 0.95 + 0.002, R * 0.95 + 0.002, 0.025, 24, 1, true), 0, y + ry * 0.46, 0), '#1d1b19'); }
    else if (h === 'crown') { add('head', 'gold', at(new THREE.CylinderGeometry(R * 0.85, R * 0.85, 0.05, 24, 1, true), 0, y + ry * 0.92, 0), '#E2B13C');
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add('head', 'gold', at(new THREE.ConeGeometry(0.018, 0.05, 6), Math.sin(a) * R * 0.85, y + ry * 0.92 + 0.045, Math.cos(a) * R * 0.85), '#E2B13C'); add('head', 'skin', at(sphere(0.008, 8, 6), Math.sin(a) * R * 0.86, y + ry * 0.92, Math.cos(a) * R * 0.86), i % 2 ? '#C0392B' : '#2E5E8C'); } } }
  if (w.eye) { const c = C('eye'), h = k('eye'), ey = y + 0.018, ez = rz * 0.97, r = h === 'round' ? 0.024 : 0.022;
    for (const s of [-1, 1]) { add('head', 'skin', at(new THREE.TorusGeometry(r, 0.003, 6, 20), s * 0.034, ey, ez, h === 'round' ? 1 : 1.25, 1, 1), h === 'shades' ? '#111' : c);
      if (h === 'shades') add('head', 'skin', at(new THREE.CircleGeometry(r, 18), s * 0.034, ey, ez + 0.001, 1.25, 1, 1), '#141618');
      add('head', 'skin', at(rbox(0.004, 0.004, rz * 0.9), s * (rx + 0.004), ey + 0.004, ez * 0.45), h === 'shades' ? '#111' : c); }
    add('head', 'skin', at(rbox(0.018, 0.004, 0.004), 0, ey + 0.006, ez + 0.003), h === 'shades' ? '#111' : c); }
  if (w.neck) { const c = C('neck'), h = k('neck');
    if (h === 'scarf') { add('chest', 'cloth', at(new THREE.TorusGeometry(0.068, 0.02, 10, 24), 0, 1.535, 0.0, 1, 1, 0.92, Math.PI / 2 - 0.15), c); add('chest', 'cloth', at(rbox(0.055, 0.22, 0.016), 0.045, 1.4, radiusAt(torso, 1.4) * B.depth + 0.03, 1, 1, 1, -0.08), c); }
    else if (h === 'tie') { add('chest', 'cloth', at(rbox(0.045, 0.3, 0.012), 0, 1.36, radiusAt(torso, 1.36) * B.depth + 0.018, 1, 1, 1, -0.06), c); add('chest', 'cloth', at(sphere(0.022, 10, 8), 0, 1.5, 0.07), c); }
    else if (h === 'chain') add('chest', 'gold', at(new THREE.TorusGeometry(0.09, 0.006, 6, 30), 0, 1.47, 0.03, 1, 1, 0.8, Math.PI / 2 - 0.6), '#E2B13C');
    else if (h === 'pendant' || h === 'diamondpendant') { const [py, pz] = necklace(0.12, 0.0022, GOLD);
      if (h === 'pendant') add('chest', 'gold', at(sphere(1, 10, 8), 0, py - 0.016, pz + 0.004, 0.011, 0.016, 0.005), GOLD);
      else { add('chest', 'gold', at(sphere(0.013, 6, 4), 0, py - 0.016, pz + 0.007, 1, 1.3, 0.7), ICE); add('chest', 'gold', at(new THREE.TorusGeometry(0.014, 0.002, 4, 14), 0, py - 0.016, pz + 0.004, 1, 1.3), GOLD); } }
    else if (h === 'cuban') necklace(0.08, 0.0065, GOLD);
    else if (h === 'iced') { const [py, pz] = necklace(0.1, 0.0075, ICE); add('chest', 'gold', at(rbox(0.05, 0.05, 0.008), 0, py - 0.03, pz + 0.006, 1, 1, 1, 0, 0, Math.PI / 4), ICE); }
    else if (h === 'pearls') for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; add('chest', 'skin', at(sphere(0.008, 8, 6), Math.sin(a) * 0.085, 1.48 - Math.max(0, Math.cos(a)) * 0.05, Math.cos(a) * 0.075 + 0.01), '#F4EFE6'); } }
  if (w.ear) for (const s of [-1, 1]) { const h = k('ear'), ex = s * (rx + 0.004);
    if (h === 'hoops') add('head', 'gold', at(new THREE.TorusGeometry(0.014, 0.0025, 6, 16), ex, y - 0.04, 0, 1, 1, 1, 0, Math.PI / 2), GOLD);
    else if (h === 'diamondstuds') add('head', 'gold', at(sphere(0.0075, 6, 4), ex, y - 0.025, 0.004), ICE);
    else if (h === 'drops') { add('head', 'gold', at(sphere(0.005, 8, 6), ex, y - 0.025, 0.004), GOLD); add('head', 'gold', at(new THREE.CapsuleGeometry(0.0045, 0.022, 3, 8), ex, y - 0.05, 0.004), GOLD); }
    else add('head', 'gold', at(sphere(0.0055, 8, 6), ex, y - 0.025, 0.004), GOLD); }
  if (w.wrist) { const h = k('wrist'), c = C('wrist'), x = X('wrist'), metal = x.rose ? ROSE : GOLD, band = (r, mat, cc) => add('armL', mat, at(new THREE.TorusGeometry(0.036, r, 6, 18), 0, -0.53, 0, 1, 1, 1, Math.PI / 2), cc);
    const face = (r, mat, cc, dx = -0.038, d = 0.008) => add('armL', mat, at(new THREE.CylinderGeometry(r, r, d, 16), dx, -0.53, 0, 1, 1, 1, 0, 0, Math.PI / 2), cc);
    if (h === 'bracelet') band(0.004, 'gold', GOLD);
    else if (h === 'watch') { band(0.008, 'skin', c); face(0.014, 'skin', '#1d1b19'); }
    else if (h === 'sportwatch') { band(0.01, 'skin', c); face(0.017, 'skin', c, -0.039, 0.01); face(0.013, 'skin', '#1d1b19', -0.044, 0.002); }
    else if (h === 'smartwatch') { band(0.009, 'skin', c); add('armL', 'skin', at(rbox(0.01, 0.034, 0.028, 0.004), -0.04, -0.53, 0), '#1d1b19'); add('armL', 'skin', at(new THREE.BoxGeometry(0.002, 0.026, 0.02), -0.0455, -0.53, 0), '#3E8EDE'); }
    else { band(0.008, 'gold', metal); face(0.015, 'gold', metal); face(0.011, 'skin', h === 'diamondwatch' ? '#1F2E55' : '#F4F1EA', -0.043, 0.002);
      if (x.diamond) for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; add('armL', 'gold', at(sphere(0.0028, 5, 4), -0.043, -0.53 + Math.cos(a) * 0.0135, Math.sin(a) * 0.0135), ICE); } } }
  // a ring on the right hand (round the fingers, below the knuckles)
  if (w.ring) { const h = k('ring'), mc = h === 'silverring' ? SILVER : GOLD; add('armR', 'gold', at(new THREE.TorusGeometry(1, 0.13, 6, 18), 0, -0.635, 0.002, 0.029, 0.021, 0.04, Math.PI / 2), mc);
    if (h === 'signet') add('armR', 'gold', at(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12), 0.03, -0.635, 0.002, 1, 1, 1, 0, 0, Math.PI / 2), mc);
    if (h === 'diamondring') add('armR', 'gold', at(sphere(0.0065, 6, 4), 0.031, -0.635, 0.002), ICE); }
  if (w.bag) { const h = k('bag'), c = C('bag'), d = radiusAt(torso, 1.25) * B.depth;
    if (h === 'backpack') { add('chest', 'cloth', at(rbox(0.26, 0.32, 0.12), 0, 1.24, -d - 0.07), c); add('chest', 'cloth', at(rbox(0.2, 0.12, 0.03), 0, 1.15, -d - 0.14), new THREE.Color(c).multiplyScalar(0.85));
      for (const s of [-1, 1]) add('chest', 'cloth', at(new THREE.TorusGeometry(0.13, 0.012, 6, 16, Math.PI), s * 0.09, 1.3, -0.0, 1, 1.1, d / 0.13 * 1.05, 0, Math.PI / 2), c); }
    else if (h === 'crossbody') { add('chest', 'skin', at(new THREE.TorusGeometry(0.3, 0.008, 6, 30), 0, 1.2, 0, 0.62, 1, d / 0.3 * 1.25, 0, 0, 0.75), c); add('chest', 'skin', at(rbox(0.15, 0.11, 0.05), 0.17, 0.98, d * 0.6), c); }
    else { add('armR', 'skin', at(rbox(0.17, 0.13, 0.07), 0, -0.73, 0.02), c); add('armR', 'skin', at(new THREE.TorusGeometry(0.06, 0.006, 6, 16, Math.PI), 0, -0.665, 0.02), c); } }
}

// ---------------- the whole person ----------------
// opts.own: give them their own materials (so they can fade without fading anyone else)
export function buildAvatar(rawLook, opts = {}) {
  const L = fixLook(rawLook), B = bodyShape(L), M = mats();
  const parts = []; // [material, geometry], every geometry already in body space with its bone weights
  // add(part, material, geometry, colour); hair: add('hair', geometry, colour). part: body (weighted by height), head, neck,
  // chest, skirt (follows the legs a little), armL/armR and legL/legR (built at the shoulder or hip, bent at the joints)
  const add = (grp, a, b, c) => { if (grp === 'hair') { parts.push(['hairM', skinTo(paint(a, b, true), 'head', B)]); return; } parts.push([a, skinTo(paint(b, c, a !== 'cloth'), grp, B)]); };
  // skin: body, neck, arms, hands, legs. Skin that clothes cover all over isn't drawn (they bend together, so nothing shows through).
  const W = L.w, xt = W.top ? (itemOf('top', W.top[0])?.[3] || {}) : {}, xb = W.bot ? (itemOf('bot', W.bot[0])?.[3] || {}) : {};
  const cover = { torso: !!W.top && !xt.crop && !xt.straps && !xt.bikini && !xt.swim && W.top[0] !== 'tank' && !xt.vest && (!!W.bot || !!xt.full), arms: (!!W.top && !!xt.long) || !!W.out, legs: !!W.bot && !xb.short && !xb.skirt && !xb.briefs };
  add('body', 'skin', B.shape(lathe(dense(cover.torso ? B.torso.filter(([, y]) => y >= 1.44) : B.torso), 32)), L.sk); /* under a top and trousers only the neck and collarbone can show */
  add('body', 'skin', at(new THREE.CylinderGeometry(0.048, 0.056, 0.12, 14), 0, 1.58, -0.005), L.sk);
  for (const s of ['armL', 'armR']) { if (!cover.arms) add(s, 'skin', lathe(dense(B.arm), 14), L.sk); add(s, 'skin', at(sphere(1, 18, 14), 0, -0.6, 0.005, 0.034, 0.058, 0.024), L.sk);
    add(s, 'skin', at(new THREE.CapsuleGeometry(0.009, 0.035, 3, 6), s === 'armL' ? 0.024 : -0.024, -0.585, 0.022, 1, 1, 1, 0.3), L.sk); } // a thumb
  if (!cover.legs) for (const s of ['legL', 'legR']) add(s, 'skin', lathe(dense(B.leg), 16), L.sk);
  // the head: shaped by the face shape, with ears and a nose
  const fs = [[1, 1, 1], [1.07, 0.96, 1.03], [1.06, 1, 1.0], [0.95, 1.1, 0.98]][L.fc], hd = { y: 1.705, rx: 0.098 * fs[0], ry: 0.122 * fs[1], rz: 0.112 * fs[2] };
  const headGeo = at(sphere(1, 48, 34), 0, hd.y, 0, hd.rx, hd.ry, hd.rz); if (L.fc === 2) { const p = headGeo.attributes.position; for (let i = 0; i < p.count; i++) { const yy = p.getY(i) - hd.y; if (yy < -0.03) { const k = 1 + Math.min(0.12, (-0.03 - yy) * 1.4); p.setX(i, p.getX(i) * k); } } headGeo.computeVertexNormals(); }
  for (const s of [-1, 1]) add('head', 'skin', at(sphere(1, 12, 10), s * hd.rx * 0.98, hd.y - 0.005, -0.004, 0.016, 0.028, 0.02), L.sk);
  const nose = [[0.012, 0.014, 0.013], [0.011, 0.02, 0.016], [0.017, 0.016, 0.015], [0.012, 0.024, 0.018]][L.ns];
  add('head', 'skin', at(sphere(1, 12, 10), 0, hd.y - 0.008, hd.rz * 0.95, ...nose), new THREE.Color(L.sk).multiplyScalar(0.98));
  // facial hair with shape: a moustache, a goatee, a beard
  if (L.bdr >= 2) { add('head', 'hairM', at(new THREE.CapsuleGeometry(0.008, 0.04, 3, 8), 0, hd.y - 0.037, hd.rz * 0.93, 1, 1, 0.9, 0, 0, Math.PI / 2), L.hc); }
  if (L.bdr === 3) add('head', 'hairM', at(sphere(1, 12, 8), 0, hd.y - 0.1, hd.rz * 0.72, 0.024, 0.03, 0.022), L.hc);
  if (L.bdr >= 4) { const g = sphere(1, 44, 28, 0, Math.PI * 2, 1.2, 1.75), p = g.attributes.position, full = L.bdr === 5;
    for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), th = Math.acos(Math.max(-1, Math.min(1, Y))), az = Math.abs(Math.atan2(X, Z)) / Math.PI;
      const lim = az > 0.62 ? 9 : az > 0.42 ? 1.45 : 2.08 - (az / 0.42) ** 2 * 0.63, hole = az < 0.09 && th < 2.12; /* below the mouth in front, up to the sideburns at the sides */
      if (th < lim || hole) { p.setXYZ(i, X * 0.85, Y * 0.85, Z * 0.85); } else if (full) { const k = 1 + 0.12 * Math.sin(Math.min(1, (th - lim) / 0.5) * Math.PI / 2) * (1 - az); p.setXYZ(i, X * k, Y * (1 + (k - 1) * 0.8), Z * k); } }
    g.computeVertexNormals(); add('head', 'hairM', at(g, 0, hd.y, 0, hd.rx + 0.006, hd.ry + 0.006, hd.rz + 0.006), L.hc); }
  hairParts(L, add, hd);
  wearParts(L, add, B, hd);
  // one skinned mesh per material for the whole person, on a skeleton: it bends smoothly at the joints
  const own = !!opts.own, matOf = { skin: own ? M.skin.clone() : M.skin, cloth: own ? M.cloth.clone() : M.cloth, gold: own ? M.gold.clone() : M.gold };
  matOf.hairM = matOf.skin; // hair shares the skin material (its colours are in the vertices)
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(L), roughness: 0.58 }), owned = [faceMat];
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const bone = (x, y, parent) => { const b = new THREE.Bone(); b.position.set(x, y, 0); if (parent) parent.add(b); return b; };
  const hips = bone(0, 0.92), spine = bone(0, 0.16, hips), chest = bone(0, 0.2, spine), neck = bone(0, 0.24, chest), head = bone(0, 0.1, neck);
  const upperArmL = bone(-B.shX, 0.125, chest), forearmL = bone(0, -0.3, upperArmL), upperArmR = bone(B.shX, 0.125, chest), forearmR = bone(0, -0.3, upperArmR);
  const thighL = bone(-B.hipX, -0.02, hips), shinL = bone(0, -0.44, thighL), footL = bone(0, -0.42, shinL), thighR = bone(B.hipX, -0.02, hips), shinR = bone(0, -0.44, thighR), footR = bone(0, -0.42, shinR);
  const bones = [hips, spine, chest, neck, head, upperArmL, forearmL, upperArmR, forearmR, thighL, shinL, footL, thighR, shinR, footR];
  body.add(hips); body.updateMatrixWorld(true); const skeleton = new THREE.Skeleton(bones);
  const byM = new Map(); for (const [m, geo] of parts) (byM.get(m) || byM.set(m, []).get(m)).push(geo);
  const meshes = [];
  for (const [m, list] of byM) { const geo = mergeGeometries(list); list.forEach(x => x.dispose()); meshes.push(new THREE.SkinnedMesh(geo, matOf[m])); }
  meshes.push(new THREE.SkinnedMesh(skinTo(headGeo, 'head', B), faceMat));
  for (const m of meshes) { m.castShadow = !!opts.shadows; body.add(m); m.bind(skeleton); }
  body.scale.setScalar(B.scale);
  if (own) owned.push(matOf.skin, matOf.cloth, matOf.gold);
  // ---- the walk ----
  // A real gait: the hips swing each leg through, the knee bends as the foot leaves the ground and straightens to land
  // on the heel, the foot rolls heel to toe; the body dips as both feet touch and rises over the standing leg, the pelvis
  // turns with the stepping leg while the shoulders turn against it, arms swing opposite the legs with soft elbows, and
  // the head stays steady. Faster, it becomes a run (more knee, more lean, bent elbows). Standing, they breathe and shift
  // their weight. Everything blends smoothly in and out.
  let ph = 0, wk = 0, rn = 0, t = 0, heading = 0;
  const TAU = Math.PI * 2, ramp01 = v => Math.max(0, Math.min(1, v));
  function gait() {
    const Ah = (0.34 + 0.32 * rn) * wk, Ak = (0.95 + 0.75 * rn) * wk, Aa = (0.3 + 0.3 * rn) * wk, still = 1 - wk, lean = 0.03 * wk + 0.16 * rn * wk;
    const leg = (th, sh, ft, p) => { const hip = -Ah * Math.sin(p) - 0.12 * rn * wk; /* forward when sin > 0 */
      let knee = Ak * Math.pow(Math.max(0, Math.cos(p + 0.55)), 1.6); const q = ((p - Math.PI / 2) % TAU + TAU) % TAU; if (q < Math.PI / 2) knee += (0.16 + 0.3 * rn) * wk * Math.sin(2 * q); /* the swing, then a soft landing */
      const toeOff = Math.pow(Math.max(0, -Math.sin(p)), 4) * (Math.cos(p) < 0.2 ? 1 : 0), heel = Math.max(0, Math.sin(p)) * Math.max(0, Math.cos(p));
      th.rotation.x = hip; sh.rotation.x = knee; ft.rotation.x = -(hip + knee) * 0.85 + 0.38 * wk * toeOff - 0.12 * wk * heel; };
    leg(thighL, shinL, footL, ph); leg(thighR, shinR, footR, ph + Math.PI);
    const dip = 0.86 * (1 - Math.cos(Ah)) * (0.5 - 0.5 * Math.cos(2 * ph)) * (1 - rn) + 0.05 * rn * wk * (0.5 + 0.5 * Math.cos(2 * ph)); /* lowest as both feet touch; a running stride dips mid-stance */
    hips.position.set(0.016 * wk * Math.cos(ph) + 0.01 * still * Math.sin(t * 0.45), 0.92 - dip + 0.003 * still * Math.sin(t * 1.7), 0);
    hips.rotation.set(0, 0.11 * wk * Math.sin(ph), 0.035 * wk * Math.cos(ph) + 0.012 * still * Math.sin(t * 0.45));
    spine.rotation.set(lean, -0.05 * wk * Math.sin(ph), -0.02 * wk * Math.cos(ph));
    chest.rotation.set(0.012 * still * Math.sin(t * 1.7), -0.17 * wk * Math.sin(ph), 0); /* the shoulders turn against the hips; breathing when still */
    neck.rotation.set(-lean * 0.5, 0.11 * wk * Math.sin(ph), 0);
    head.rotation.set(-lean * 0.4 + 0.02 * still * Math.sin(t * 0.31), 0.24 * still * Math.sin(t * 0.21) * Math.sin(t * 0.13), 0); /* steady eyes; a glance round when still */
    const arm = (ua, fa, p, side) => { const fwd = Math.max(0, -Math.sin(p));
      ua.rotation.x = Aa * Math.sin(p) - 0.15 * rn * wk + 0.02 * still * Math.sin(t * 1.7 + side);
      ua.rotation.z = side * (0.07 + 0.08 * rn * wk + 0.015 * still * Math.sin(t * 0.9));
      fa.rotation.x = -(0.1 + 0.18 * wk + 1.05 * rn * wk + 0.28 * wk * fwd); };
    arm(upperArmL, forearmL, ph, -1); arm(upperArmR, forearmR, ph + Math.PI, 1);
  }
  const P = { group: g, body, head, armL: upperArmL, armR: upperArmR, forearmL, forearmR, legL: thighL, legR: thighR, look: L, height: 1.8 * B.scale, x: 0, z: 0,
    setPos(x, z) { this.x = x; this.z = z; g.position.set(x, 0, z); },
    // speed in m/s along x and z: they turn to face where they're going and walk (or run) at that pace
    animate(dt, vx, vz, turn = true) { const sp = Math.hypot(vx, vz); dt = Math.min(0.1, Math.max(0, dt)); t += dt;
      if (turn && sp > 0.3) { const want = Math.atan2(vx, vz); let d = want - heading; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; heading += d * Math.min(1, dt * 10); g.rotation.y = heading; }
      wk += (ramp01(sp / 1.1) - wk) * Math.min(1, dt * 7); rn += (ramp01((sp - 2.8) / 1.8) - rn) * Math.min(1, dt * 4);
      const f = sp < 0.05 ? 0.9 : sp <= 1.6 ? Math.max(0.75, sp / 1.45) : 1.1 + (sp - 1.6) * 0.3; /* strides a second: longer strides, not just faster ones, as they speed up */
      if (wk > 0.003) ph = (ph + TAU * f * dt) % TAU; gait(); },
    // still poses: 'stand', 'sit' (hands on the lap), 'play' (sitting, hands out to an instrument), 'use' (standing,
    // hands out to something), 'lie' (on the back, the body centred on where they stand, head towards their -z)
    pose(kind = 'stand') { wk = 0; rn = 0; gait(); body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
      const both = (a, b, v) => { a.rotation.x = v; b.rotation.x = v; };
      if (kind === 'sit' || kind === 'play') { both(thighL, thighR, -1.5); both(shinL, shinR, 1.45); both(footL, footR, 0.05); spine.rotation.x = -0.05; head.rotation.x = 0.05;
        if (kind === 'sit') { both(upperArmL, upperArmR, -0.32); both(forearmL, forearmR, -0.95); } else { both(upperArmL, upperArmR, -0.85); both(forearmL, forearmR, -0.8); } }
      else if (kind === 'use') { both(upperArmL, upperArmR, -0.95); both(forearmL, forearmR, -0.7); upperArmL.rotation.z = -0.02; upperArmR.rotation.z = 0.02; }
      else if (kind === 'dance' || kind === 'pole') this.dance(0, kind === 'pole' ? 'pole' : 'floor');
        else if (kind === 'lie') { body.rotation.x = -Math.PI / 2; body.position.set(0, 0.13 * B.scale, P.height / 2); upperArmL.rotation.z = -0.14; upperArmR.rotation.z = 0.14; head.rotation.x = -0.15; }
    },
    // dancing to the club's beat (about 105 a minute): 'floor' changes move every few beats (hands in the air, pumping
    // arms, a side step); 'pole' holds the pole with one hand while the hips circle and the knees dip
    dance(dt, kind = 'floor') { dt = Math.min(0.1, Math.max(0, dt)); t += dt; wk = 0; rn = 0; const b = t * Math.PI * 2 * 1.75, h = b / 2, S = Math.sin, C = Math.cos, up = v => Math.max(0, v);
      body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
      if (kind === 'pole') { const c = S(h);
        hips.position.set(0.05 * c, 0.86 - 0.05 * up(S(b)), 0.03 * C(h)); hips.rotation.set(0.05, 0.35 * S(h * 0.5), 0.1 * c);
        spine.rotation.set(-0.12 - 0.08 * up(C(h)), -0.2 * c, 0.08 * c); chest.rotation.set(-0.05, -0.15 * c, 0); neck.rotation.set(0, 0.1 * c, 0); head.rotation.set(-0.15, 0.25 * c, 0.05);
        upperArmR.rotation.set(-2.75, 0, 0.12); forearmR.rotation.x = -0.25; upperArmL.rotation.set(-0.6 - 0.4 * up(S(h)), 0, -0.5 - 0.2 * c); forearmL.rotation.x = -0.6;
        for (const [th, sh, ft, ph] of [[thighL, shinL, footL, 0], [thighR, shinR, footR, Math.PI]]) { const k = up(S(h + ph)); th.rotation.set(-0.2 - 0.35 * k, 0, 0); sh.rotation.x = 0.35 + 0.55 * k; ft.rotation.x = -(th.rotation.x + sh.rotation.x) * 0.85; }
        return; }
      const move = Math.floor(t / 4.6) % 3, bounce = up(S(b)); /* a new move every 8 beats */
      hips.position.set(0.05 * S(h) * (move === 2 ? 2 : 1), 0.9 - 0.045 * bounce, 0); hips.rotation.set(0, 0.22 * S(h), 0.08 * S(h));
      spine.rotation.set(0.06 + 0.05 * bounce, -0.14 * S(h), 0.05 * S(h)); chest.rotation.set(0.02 * bounce, -0.22 * S(h), 0); neck.rotation.set(0, 0.08 * S(h), 0); head.rotation.set(0.14 * bounce - 0.06, 0.18 * S(h / 2), 0);
      for (const [th, sh, ft, ph] of [[thighL, shinL, footL, 0], [thighR, shinR, footR, Math.PI]]) { const k = up(S(h + ph)); th.rotation.set(-0.12 - (move === 2 ? 0.45 : 0.28) * k, 0, 0); sh.rotation.x = 0.2 + (move === 2 ? 0.7 : 0.45) * k; ft.rotation.x = -(th.rotation.x + sh.rotation.x) * 0.85; }
      if (move === 0) { /* hands in the air */ upperArmL.rotation.set(-2.6 - 0.25 * S(b), 0, -0.25 - 0.1 * S(h)); upperArmR.rotation.set(-2.6 - 0.25 * S(b + 1), 0, 0.25 + 0.1 * S(h)); forearmL.rotation.x = -0.35 - 0.3 * bounce; forearmR.rotation.x = -0.35 - 0.3 * up(S(b + 1)); }
      else if (move === 1) { /* pumping arms, elbows bent */ const a = up(S(h)), c = up(-S(h)); upperArmL.rotation.set(-0.7 - 0.9 * a, 0, -0.35); upperArmR.rotation.set(-0.7 - 0.9 * c, 0, 0.35); forearmL.rotation.x = -1.5 + 0.3 * a; forearmR.rotation.x = -1.5 + 0.3 * c; }
      else { /* a side step, arms swinging low */ upperArmL.rotation.set(-0.35 * S(h), 0, -0.3 - 0.25 * up(S(h))); upperArmR.rotation.set(0.35 * S(h), 0, 0.3 + 0.25 * up(-S(h))); forearmL.rotation.x = -0.9; forearmR.rotation.x = -0.9; }
    },
    hipY: 0.9 * B.scale, /* how high the hips are standing: a seated person's hips go at the seat */
    // for still pictures: a moment in a walk (0-1 through the stride) at a given speed
    stride(at, sp = 1.4) { wk = ramp01(sp / 1.1); rn = ramp01((sp - 2.8) / 1.8); ph = at * TAU; gait(); },
    setOpacity(o) { for (const m of own ? owned : [faceMat]) { m.transparent = o < 0.999; m.opacity = o; m.depthWrite = o >= 0.999; } },
    dispose() { for (const m of meshes) m.geometry.dispose(); skeleton.dispose(); dropFace(faceMat.map); for (const m of owned) m.dispose(); },
  };
  gait();
  return P;
}
