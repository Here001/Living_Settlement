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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLOTH, LIPS, itemOf, fixLook } from '/shared/avatar.js';

const V2 = THREE.Vector2;
const UNDER = '#E9E4DC'; // the mannequin's underwear

// ---------------- shared materials and the fabric weave ----------------
let FAB = null;
function fabric() {
  if (FAB) return FAB; const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.035 : 0.07})`; g.fillRect(0, y, S, 1); }
  for (let x = 0; x < S; x += 2) { g.fillStyle = 'rgba(0,0,0,.03)'; g.fillRect(x, 0, 1, S); }
  g.fillStyle = '#ffffff'; g.fillRect(60, 60, 8, 8); // a plain patch: skin and hair point their texture here
  FAB = new THREE.CanvasTexture(c); FAB.wrapS = FAB.wrapT = THREE.RepeatWrapping; FAB.colorSpace = THREE.SRGBColorSpace; FAB.anisotropy = 4; return FAB;
}
const MATS = {};
function mats() {
  if (MATS.cloth) return MATS;
  MATS.cloth = new THREE.MeshStandardMaterial({ vertexColors: true, map: fabric(), roughness: 0.86 });
  MATS.skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }); // skin, hair sheen, leather, lenses
  MATS.gold = new THREE.MeshStandardMaterial({ color: '#E2B13C', metalness: 1, roughness: 0.28 });
  return MATS;
}

// ---------------- geometry helpers ----------------
const col = c => new THREE.Color(c);
function paint(geo, c, plain) {
  const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, a = new Float32Array(n * 3), cc = typeof c === 'function' ? null : col(c), p = g.attributes.position;
  for (let i = 0; i < n; i++) { const k = cc || col(c(p.getY(i), p.getX(i), p.getZ(i))); a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (plain) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5); } // the plain patch of the weave
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const at = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => { geo.scale(sx, sy, sz); if (rx) geo.rotateX(rx); if (ry) geo.rotateY(ry); if (rz) geo.rotateZ(rz); geo.translate(x, y, z); return geo; };
const sphere = (r, w = 20, h = 14, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const lathe = (pts, seg = 22) => new THREE.LatheGeometry([...pts].sort((a, b) => a[1] - b[1]).map(([r, y]) => new V2(Math.max(0.0005, r), y)), seg); /* bottom to top, so it faces outwards */
const dense = (prof, step = 0.018) => { const out = []; const P = [...prof].sort((a, b) => a[1] - b[1]); for (let i = 0; i < P.length; i++) { out.push(P[i]); if (i + 1 < P.length) for (let y = P[i][1] + step; y < P[i + 1][1] - step / 2; y += step) out.push([radiusAt(P, y), y]); } return out; };
const radiusAt = (prof, y) => { for (let i = 1; i < prof.length; i++) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) { const t = (y - y0) / (y1 - y0 || 1); return r0 + (r1 - r0) * t; } } return prof[prof.length - 1][0]; };
// a shell over part of a body profile: from y0 to y1, `pad` metres out; flare widens the bottom edge (a cuff, a hem)
function shell(prof, y0, y1, pad, { flare = 0, closeTop = false, seg = 32 } = {}) {
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
  return { f, torso, depth, shape, arm, leg, hipX: hip * 0.5, shX: sh * 0.96 + 0.032, sh, scale: [0.9, 0.95, 1, 1.05, 1.1][L.ht] * (f ? 0.955 : 1) };
}

// ---------------- hair ----------------
function hairParts(L, add, hd) {
  const { y, rx, ry, rz } = hd, c = L.hc, R = Math.max(rx, rz);
  // under a hat, hair that stands up is pressed flat (long hair still hangs below it)
  const s = L.w.hat ? ({ afro: 'short', twists: 'short', mohawk: 'buzz', curlyshort: 'short', quiff: 'short', manbun: 'short', spacebuns: 'short', slick: 'short', side: 'short', curly: 'wavy', bangs: 'long', pixie: 'short' })[L.hs] || L.hs : L.hs;
  // hair that follows a hairline: high on the forehead, down round the ears, low at the nape
  const capGeo = (front, side, back, pad) => { const g = sphere(1, 72, 48, 0, Math.PI * 2, 0, Math.min(Math.PI, back + 0.05)), p = g.attributes.position;
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
  const shellT = (...a) => B.shape(shell(B.torso, ...a)), flat = (geo, k = 0.85) => geo.scale(1, 1, k); /* the body is flatter front to back than round */
  const w = L.w, C = s => CLOTH[w[s][1]], X = s => (itemOf(s, w[s][0]) || [])[3] || {}, k = s => w[s][0];
  const { torso, arm, leg, f } = B, top = w.top, bot = w.bot, full = top && X('top').full;
  // ---- underwear, where nothing covers it ----
  if (!top || X('top').crop) { if (f) add('body', 'cloth', shellT(1.2, 1.345, 0.006), UNDER); }
  if (!bot && !full) { add('body', 'cloth', shellT(0.835, 0.98, 0.006), UNDER); for (const s of ['legL', 'legR']) add(s, 'cloth', shell(leg, -0.11, 0.02, 0.005), UNDER); }
  // ---- top ----
  if (top) { const x = X('top'), c = C('top'), y0 = x.crop ? 1.17 : full ? 0.86 : 0.9, sleeve = k('top') === 'tank' || x.straps ? 0 : x.long ? -0.55 : -0.2;
    const stripe = x.stripe ? (yy => (Math.floor(yy * 22) % 2 ? c : '#F4F1EA')) : c;
    add('body', 'cloth', shellT(y0, k('top') === 'tank' || x.straps ? 1.44 : 1.52, 0.012), stripe);
    if (sleeve) for (const s of ['armL', 'armR']) add(s, 'cloth', shell(arm, sleeve, 0.059, 0.01, { flare: x.long ? 0.004 : 0.012, closeTop: true }), c);
    if (x.collar) add('body', 'cloth', at(new THREE.TorusGeometry(0.072, 0.014, 8, 24), 0, 1.53, 0.005, 1, 1, 0.9, Math.PI / 2 - 0.25), c);
    if (x.hood) add('body', 'cloth', at(sphere(1, 16, 10, Math.PI, Math.PI, 0.6, 1.6), 0, 1.55, -0.05, 0.12, 0.09, 0.08), c);
    if (full) { const len = x.floor ? 0.78 : 0.42; add('body', 'cloth', flat(lathe([[radiusAt(torso, 0.96) + 0.014, 0.96], [radiusAt(torso, 0.9) + 0.03, 0.9], [0.24 + (x.floor ? 0.06 : 0), 0.96 - len]], 26)), c); } }
  // ---- bottoms ----
  if (bot) { const x = X('bot'), c = C('bot');
    add('body', 'cloth', shellT(0.835, x.skirt ? 1.02 : 1.0, 0.013), c);
    if (x.skirt) { const len = x.floor ? 0.8 : 0.4; add('body', 'cloth', flat(lathe([[radiusAt(torso, 1.0) + 0.015, 1.0], [radiusAt(torso, 0.92) + 0.03, 0.92], [0.22 + (x.floor ? 0.07 : 0), 1.0 - len]], 26)), c); }
    else for (const s of ['legL', 'legR']) { const to = x.short ? -0.32 : -0.84, pad = x.tight ? 0.004 : 0.012; add(s, 'cloth', shell(leg, to, 0.03, pad, { flare: x.tight || x.short ? 0.004 : k('bot') === 'joggers' ? -0.004 : 0.008 }), c);
      if (x.pockets) add(s, 'cloth', at(new THREE.BoxGeometry(0.05, 0.09, 0.03), (s === 'legL' ? -1 : 1) * 0.07, -0.3, 0.01), new THREE.Color(c).multiplyScalar(0.85)); }
    add('body', 'skin', shellT(0.985, 1.0, 0.016), '#2a2522'); } // a belt line
  // ---- jacket / coat ----
  if (w.out) { const x = X('out'), c = C('out'), pad = x.puffy ? 0.04 : 0.024, mat = x.shiny ? 'skin' : 'cloth';
    add('body', mat, shellT(x.long ? 0.86 : 0.92, 1.51, pad), c); for (const s of ['armL', 'armR']) add(s, mat, shell(arm, -0.53, 0.059, pad * 0.7, { flare: 0.006, closeTop: true }), c);
    if (x.long) add('body', mat, flat(lathe([[radiusAt(torso, 0.9) + pad, 0.9], [0.24, 0.5]], 26)), c);
    add('body', mat, at(new THREE.TorusGeometry(0.082, 0.018, 8, 24, Math.PI * 1.4), 0, 1.5, 0.01, 1, 1, 0.95, Math.PI / 2 - 0.3, 0, Math.PI * 1.2), c); }
  // ---- shoes ----
  for (const s of ['legL', 'legR']) { const sh = w.shoe, c = sh ? C('shoe') : null, x = sh ? X('shoe') : {};
    if (!sh || k('shoe') === 'sandals') { add(s, 'skin', at(new THREE.CapsuleGeometry(0.035, 0.13, 4, 10), 0, -0.865, 0.04, 1, 0.8, 1, Math.PI / 2), L.sk); if (sh) add(s, 'skin', at(new THREE.BoxGeometry(0.085, 0.015, 0.22), 0, -0.893, 0.04), c); continue; }
    add(s, 'skin', at(new THREE.CapsuleGeometry(0.045, 0.15, 4, 12), 0, -0.86, 0.045, 1, 0.82, 1, Math.PI / 2), c);
    add(s, 'skin', at(new THREE.BoxGeometry(0.095, 0.018, 0.25), 0, -0.89, 0.045), k('shoe') === 'sneakers' || k('shoe') === 'hightops' ? '#F2F0EA' : '#1d1b19');
    if (x.high) add(s, 'skin', shell(leg, -0.86, k('shoe') === 'boots' ? -0.6 : -0.74, 0.016), c);
    if (x.heel) add(s, 'skin', at(new THREE.CylinderGeometry(0.012, 0.008, 0.07, 8), 0, -0.88, -0.05), c); }
  // ---- on the head ----
  const { y, rx, ry, rz } = hd;
  if (w.hat) { const c = C('hat'), h = k('hat'), R = Math.max(rx, rz) + 0.02;
    if (h === 'cap') { add('body', 'cloth', at(sphere(1, 28, 14, 0, Math.PI * 2, 0, 1.5), 0, y + 0.012, 0, R, ry + 0.008, R), c); add('body', 'cloth', at(new THREE.CylinderGeometry(1, 1, 0.01, 24, 1, false, -1.1, 2.2), 0, y + ry * 0.42, R * 0.3, R * 0.95, 1, R * 1.55, -0.1), c); }
    else if (h === 'beanie') { add('body', 'cloth', at(sphere(1, 24, 12, 0, Math.PI * 2, 0, 1.55), 0, y + 0.025, 0, R + 0.005, ry + 0.045, R + 0.005), c); add('body', 'cloth', at(new THREE.TorusGeometry(R + 0.006, 0.016, 8, 28), 0, y + 0.0, 0, 1, 1, 1, Math.PI / 2), c); }
    else if (h === 'bucket') { add('body', 'cloth', at(new THREE.CylinderGeometry(R * 0.85, R + 0.01, 0.1, 24), 0, y + ry * 0.75, 0), c); add('body', 'cloth', at(new THREE.CylinderGeometry(R + 0.01, R + 0.06, 0.04, 24, 1, true), 0, y + ry * 0.38, 0), c); }
    else if (h === 'headwrap') { add('body', 'cloth', at(sphere(1, 24, 12, 0, Math.PI * 2, 0, 1.6), 0, y + 0.04, -0.02, R + 0.01, ry + 0.07, R + 0.02), c); add('body', 'cloth', at(sphere(1, 14, 10), 0, y + ry + 0.06, 0.03, 0.06, 0.045, 0.05), c); }
    else if (h === 'sunhat') { add('body', 'cloth', at(sphere(1, 24, 12, 0, Math.PI * 2, 0, 1.5), 0, y + 0.01, 0, R, ry + 0.03, R), c); add('body', 'cloth', at(new THREE.CylinderGeometry(R + 0.13, R + 0.14, 0.01, 32), 0, y + ry * 0.45, 0), c); }
    else if (h === 'fedora') { add('body', 'cloth', at(new THREE.CylinderGeometry(R * 0.82, R * 0.95, 0.12, 24), 0, y + ry * 0.78, 0), c); add('body', 'cloth', at(new THREE.CylinderGeometry(R + 0.06, R + 0.07, 0.01, 28), 0, y + ry * 0.38, 0), c);
      add('body', 'skin', at(new THREE.CylinderGeometry(R * 0.95 + 0.002, R * 0.95 + 0.002, 0.025, 24, 1, true), 0, y + ry * 0.46, 0), '#1d1b19'); }
    else if (h === 'crown') { add('body', 'gold', at(new THREE.CylinderGeometry(R * 0.85, R * 0.85, 0.05, 24, 1, true), 0, y + ry * 0.92, 0), '#E2B13C');
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add('body', 'gold', at(new THREE.ConeGeometry(0.018, 0.05, 6), Math.sin(a) * R * 0.85, y + ry * 0.92 + 0.045, Math.cos(a) * R * 0.85), '#E2B13C'); add('body', 'skin', at(sphere(0.008, 8, 6), Math.sin(a) * R * 0.86, y + ry * 0.92, Math.cos(a) * R * 0.86), i % 2 ? '#C0392B' : '#2E5E8C'); } } }
  if (w.eye) { const c = C('eye'), h = k('eye'), ey = y + 0.018, ez = rz * 0.97, r = h === 'round' ? 0.024 : 0.022;
    for (const s of [-1, 1]) { add('body', 'skin', at(new THREE.TorusGeometry(r, 0.003, 6, 20), s * 0.034, ey, ez, h === 'round' ? 1 : 1.25, 1, 1), h === 'shades' ? '#111' : c);
      if (h === 'shades') add('body', 'skin', at(new THREE.CircleGeometry(r, 18), s * 0.034, ey, ez + 0.001, 1.25, 1, 1), '#141618');
      add('body', 'skin', at(new THREE.BoxGeometry(0.004, 0.004, rz * 0.9), s * (rx + 0.004), ey + 0.004, ez * 0.45), h === 'shades' ? '#111' : c); }
    add('body', 'skin', at(new THREE.BoxGeometry(0.018, 0.004, 0.004), 0, ey + 0.006, ez + 0.003), h === 'shades' ? '#111' : c); }
  if (w.neck) { const c = C('neck'), h = k('neck');
    if (h === 'scarf') { add('body', 'cloth', at(new THREE.TorusGeometry(0.068, 0.02, 10, 24), 0, 1.535, 0.0, 1, 1, 0.92, Math.PI / 2 - 0.15), c); add('body', 'cloth', at(new THREE.BoxGeometry(0.055, 0.22, 0.016), 0.045, 1.4, radiusAt(torso, 1.4) * B.depth + 0.03, 1, 1, 1, -0.08), c); }
    else if (h === 'tie') { add('body', 'cloth', at(new THREE.BoxGeometry(0.045, 0.3, 0.012), 0, 1.36, radiusAt(torso, 1.36) * B.depth + 0.018, 1, 1, 1, -0.06), c); add('body', 'cloth', at(sphere(0.022, 10, 8), 0, 1.5, 0.07), c); }
    else if (h === 'chain') add('body', 'gold', at(new THREE.TorusGeometry(0.09, 0.006, 6, 30), 0, 1.47, 0.03, 1, 1, 0.8, Math.PI / 2 - 0.6), '#E2B13C');
    else if (h === 'pearls') for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; add('body', 'skin', at(sphere(0.008, 8, 6), Math.sin(a) * 0.085, 1.48 - Math.max(0, Math.cos(a)) * 0.05, Math.cos(a) * 0.075 + 0.01), '#F4EFE6'); } }
  if (w.ear) for (const s of [-1, 1]) { if (k('ear') === 'hoops') add('body', 'gold', at(new THREE.TorusGeometry(0.014, 0.0025, 6, 16), s * (rx + 0.004), y - 0.04, 0, 1, 1, 1, 0, Math.PI / 2), '#E2B13C'); else add('body', 'gold', at(sphere(0.0055, 8, 6), s * (rx + 0.004), y - 0.025, 0.004), '#E2B13C'); }
  if (w.wrist) { const h = k('wrist'), c = C('wrist'); add('armL', h === 'watch' ? 'skin' : 'gold', at(new THREE.TorusGeometry(0.036, h === 'bracelet' ? 0.004 : 0.008, 6, 18), 0, -0.53, 0, 1, 1, 1, Math.PI / 2), h === 'watch' ? c : '#E2B13C');
    if (h !== 'bracelet') add('armL', h === 'watch' ? 'skin' : 'gold', at(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 14), -0.038, -0.53, 0, 1, 1, 1, 0, 0, Math.PI / 2), h === 'watch' ? '#1d1b19' : '#E2B13C'); }
  if (w.bag) { const h = k('bag'), c = C('bag'), d = radiusAt(torso, 1.25) * B.depth;
    if (h === 'backpack') { add('body', 'cloth', at(new THREE.BoxGeometry(0.26, 0.32, 0.12), 0, 1.24, -d - 0.07), c); add('body', 'cloth', at(new THREE.BoxGeometry(0.2, 0.12, 0.03), 0, 1.15, -d - 0.14), new THREE.Color(c).multiplyScalar(0.85));
      for (const s of [-1, 1]) add('body', 'cloth', at(new THREE.TorusGeometry(0.13, 0.012, 6, 16, Math.PI), s * 0.09, 1.3, -0.0, 1, 1.1, d / 0.13 * 1.05, 0, Math.PI / 2), c); }
    else if (h === 'crossbody') { add('body', 'skin', at(new THREE.TorusGeometry(0.3, 0.008, 6, 30), 0, 1.2, 0, 0.62, 1, d / 0.3 * 1.25, 0, 0, 0.75), c); add('body', 'skin', at(new THREE.BoxGeometry(0.15, 0.11, 0.05), 0.17, 0.98, d * 0.6), c); }
    else { add('armR', 'skin', at(new THREE.BoxGeometry(0.17, 0.13, 0.07), 0, -0.73, 0.02), c); add('armR', 'skin', at(new THREE.TorusGeometry(0.06, 0.006, 6, 16, Math.PI), 0, -0.665, 0.02), c); } }
}

// ---------------- the whole person ----------------
// opts.own: give them their own materials (so they can fade without fading anyone else)
export function buildAvatar(rawLook, opts = {}) {
  const L = fixLook(rawLook), B = bodyShape(L), M = mats();
  const parts = { body: [], armL: [], armR: [], legL: [], legR: [] }; // [material, geometry]
  // add(part, material, geometry, colour); hair: add('hair', geometry, colour)
  const add = (grp, a, b, c) => { if (grp === 'hair') { parts.body.push(['hairM', paint(a, b, true)]); return; } parts[grp].push([a, paint(b, c, a !== 'cloth')]); };
  // skin: body, neck, arms, hands, legs (under the clothes, so it never shows through a gap)
  add('body', 'skin', B.shape(lathe(dense(B.torso), 32)), L.sk);
  add('body', 'skin', at(new THREE.CylinderGeometry(0.048, 0.056, 0.12, 14), 0, 1.58, -0.005), L.sk);
  for (const s of ['armL', 'armR']) { add(s, 'skin', lathe(B.arm, 16), L.sk); add(s, 'skin', at(sphere(1, 12, 10), 0, -0.6, 0.005, 0.034, 0.058, 0.024), L.sk);
    add(s, 'skin', at(new THREE.CapsuleGeometry(0.009, 0.035, 3, 6), s === 'armL' ? 0.024 : -0.024, -0.585, 0.022, 1, 1, 1, 0.3), L.sk); } // a thumb
  for (const s of ['legL', 'legR']) add(s, 'skin', lathe(B.leg, 16), L.sk);
  // the head: shaped by the face shape, with ears and a nose
  const fs = [[1, 1, 1], [1.07, 0.96, 1.03], [1.06, 1, 1.0], [0.95, 1.1, 0.98]][L.fc], hd = { y: 1.705, rx: 0.098 * fs[0], ry: 0.122 * fs[1], rz: 0.112 * fs[2] };
  const headGeo = at(sphere(1, 40, 28), 0, hd.y, 0, hd.rx, hd.ry, hd.rz); if (L.fc === 2) { const p = headGeo.attributes.position; for (let i = 0; i < p.count; i++) { const yy = p.getY(i) - hd.y; if (yy < -0.03) { const k = 1 + Math.min(0.12, (-0.03 - yy) * 1.4); p.setX(i, p.getX(i) * k); } } headGeo.computeVertexNormals(); }
  for (const s of [-1, 1]) add('body', 'skin', at(sphere(1, 12, 10), s * hd.rx * 0.98, hd.y - 0.005, -0.004, 0.016, 0.028, 0.02), L.sk);
  const nose = [[0.012, 0.014, 0.013], [0.011, 0.02, 0.016], [0.017, 0.016, 0.015], [0.012, 0.024, 0.018]][L.ns];
  add('body', 'skin', at(sphere(1, 12, 10), 0, hd.y - 0.008, hd.rz * 0.95, ...nose), new THREE.Color(L.sk).multiplyScalar(0.98));
  // facial hair with shape: a moustache, a goatee, a beard
  if (L.bdr >= 2) { add('body', 'hairM', at(new THREE.CapsuleGeometry(0.008, 0.04, 3, 8), 0, hd.y - 0.037, hd.rz * 0.93, 1, 1, 0.9, 0, 0, Math.PI / 2), L.hc); }
  if (L.bdr === 3) add('body', 'hairM', at(sphere(1, 12, 8), 0, hd.y - 0.1, hd.rz * 0.72, 0.024, 0.03, 0.022), L.hc);
  if (L.bdr >= 4) { const g = sphere(1, 56, 36, 0, Math.PI * 2, 1.2, 1.75), p = g.attributes.position, full = L.bdr === 5;
    for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), th = Math.acos(Math.max(-1, Math.min(1, Y))), az = Math.abs(Math.atan2(X, Z)) / Math.PI;
      const lim = az > 0.62 ? 9 : az > 0.42 ? 1.45 : 2.08 - (az / 0.42) ** 2 * 0.63, hole = az < 0.09 && th < 2.12; /* below the mouth in front, up to the sideburns at the sides */
      if (th < lim || hole) { p.setXYZ(i, X * 0.85, Y * 0.85, Z * 0.85); } else if (full) { const k = 1 + 0.12 * Math.sin(Math.min(1, (th - lim) / 0.5) * Math.PI / 2) * (1 - az); p.setXYZ(i, X * k, Y * (1 + (k - 1) * 0.8), Z * k); } }
    g.computeVertexNormals(); add('body', 'hairM', at(g, 0, hd.y, 0, hd.rx + 0.006, hd.ry + 0.006, hd.rz + 0.006), L.hc); }
  hairParts(L, add, hd);
  wearParts(L, add, B, hd);
  // merge each moving part, one mesh per material
  const own = !!opts.own, matOf = { skin: own ? M.skin.clone() : M.skin, cloth: own ? M.cloth.clone() : M.cloth, gold: own ? M.gold.clone() : M.gold };
  matOf.hairM = matOf.skin; // hair shares the skin material (its colours are in the vertices)
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(L), roughness: 0.58 }), owned = [faceMat];
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body); body.scale.setScalar(B.scale);
  const build = (grp, holder) => { const byM = new Map(); for (const [m, geo] of parts[grp]) (byM.get(m) || byM.set(m, []).get(m)).push(geo);
    for (const [m, list] of byM) { const geo = mergeGeometries(list); list.forEach(x => x.dispose()); const mesh = new THREE.Mesh(geo, matOf[m]); mesh.castShadow = !!opts.shadows; holder.add(mesh); } };
  build('body', body); const head = new THREE.Mesh(headGeo, faceMat); body.add(head);
  const pivot = (grp, x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); build(grp, p); body.add(p); return p; };
  const armL = pivot('armL', -B.shX, 1.405), armR = pivot('armR', B.shX, 1.405), legL = pivot('legL', -B.hipX, 0.9), legR = pivot('legR', B.hipX, 0.9);
  armL.rotation.z = -0.07; armR.rotation.z = 0.07;
  if (own) owned.push(matOf.skin, matOf.cloth, matOf.gold);
  let phase = 0, heading = 0, t = 0;
  const P = { group: g, body, head, armL, armR, legL, legR, look: L, height: 1.8 * B.scale, x: 0, z: 0,
    setPos(x, z) { this.x = x; this.z = z; g.position.set(x, 0, z); },
    // speed in m/s along x and z: they turn to face where they're going, legs and arms swing, and they breathe standing still
    animate(dt, vx, vz, turn = true) { const sp = Math.hypot(vx, vz); t += dt;
      if (turn && sp > 0.3) { const want = Math.atan2(vx, vz); let d = want - heading; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; heading += d * Math.min(1, dt * 12); g.rotation.y = heading; }
      phase += dt * (2 + sp * 1.6); const sw = Math.min(1, sp / 5) * 0.8, s = Math.sin(phase) * sw;
      legL.rotation.x = s; legR.rotation.x = -s; armL.rotation.x = -s * 0.85; armR.rotation.x = s * 0.85;
      body.position.y = Math.abs(Math.cos(phase)) * 0.05 * Math.min(1, sp / 3) + (sp < 0.2 ? Math.sin(t * 1.6) * 0.004 : 0);
      body.rotation.x = Math.min(0.2, sp * 0.025); },
    pose(still = true) { if (still) { legL.rotation.x = legR.rotation.x = armL.rotation.x = armR.rotation.x = 0; body.position.y = 0; body.rotation.x = 0; } },
    setOpacity(o) { for (const m of own ? owned : [faceMat]) { m.transparent = o < 0.999; m.opacity = o; m.depthWrite = o >= 0.999; } },
    dispose() { g.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); dropFace(faceMat.map); for (const m of owned) m.dispose(); },
  };
  return P;
}
