// The creatures of Gliese 12 b in 3D: pets that walk (or fly, float, slither) beside their owners, the runners on the
// race track and the animals in a Pet store's cages. Each kind is a short design below (its body plan, its parts and
// its colours); build(kind) turns it into a model with its own animation. Built from simple, smooth shapes, merged so a
// whole creature draws in a handful of calls, and lit like everything else in the game.
//
//   const C = build('emberdrake'); scene.add(C.group); … each frame: C.animate(dt, speed) (speed in m/s: 0 = idle)
//   C.height: how tall it stands (for a name tag); C.flies: it keeps off the ground; C.dispose()
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CREATURES } from '/shared/creatures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
// ---- materials (shared by every creature of the same colour) ----
const MATS = new Map();
function mat(col, kind = 'skin') { const key = col + '|' + kind; let m = MATS.get(key); if (m) return m;
  const c = new THREE.Color(col);
  if (kind === 'glow') m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.35, roughness: 0.4 });
  else if (kind === 'metal') m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.5, roughness: 0.32 }); /* (shiny, but never black where there's nothing to reflect) */
  else if (kind === 'fur') m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 });
  else if (kind === 'shell') m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.15 });
  else if (kind === 'glass') m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  else if (kind === 'wing') m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  else if (kind === 'eye') m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.15 });
  else if (kind === 'pupil') m = new THREE.MeshBasicMaterial({ color: c });
  else m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.58 });
  MATS.set(key, m); return m; }
let HALO = null; const halo = () => { if (HALO) return HALO; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); HALO = new THREE.CanvasTexture(c); return HALO; };
const shade = (col, k) => '#' + new THREE.Color(col).multiplyScalar(k).getHexString();
const mix = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// ---- shapes ----
const SPH = new THREE.SphereGeometry(1, 22, 16), SPH_LO = new THREE.SphereGeometry(1, 12, 8), CONE = new THREE.ConeGeometry(1, 1, 12), CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
// a geometry moved into place: scale, then turn, then move
const put = (g, { p = V(0, 0, 0), s = V(1, 1, 1), q = null, e = null } = {}) => { g = g.clone(); g.scale(s.x, s.y, s.z); if (e) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]))); if (q) g.applyQuaternion(q); g.translate(p.x, p.y, p.z); return g; };
const ell = (p, rx, ry, rz, e, lo) => put(lo ? SPH_LO : SPH, { p, s: V(rx, ry, rz), e });
// a rounded limb from a to b
function limb(a, b, r0, r1 = r0) { const d = b.clone().sub(a), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, 12, 1, true); g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())); g.translate(a.x, a.y, a.z); return [g, ell(a, r0, r0, r0, null, true), ell(b, r1, r1, r1, null, true)]; }
// a tapering tube along a curve (horns, necks, trunks, tentacles)
function taper(pts, r0, r1, seg = 10, rad = 10) { const curve = new THREE.CatmullRomCurve3(pts), P = [], N = [], U = [], I = [], fr = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) { const t = i / seg, c = curve.getPointAt(t), r = r0 + (r1 - r0) * t, n = fr.normals[i], b = fr.binormals[i];
    for (let j = 0; j <= rad; j++) { const a = j / rad * Math.PI * 2, cx = Math.cos(a), sx = Math.sin(a), nx = cx * n.x + sx * b.x, ny = cx * n.y + sx * b.y, nz = cx * n.z + sx * b.z;
      P.push(c.x + nx * r, c.y + ny * r, c.z + nz * r); N.push(nx, ny, nz); U.push(j / rad, t); } }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
  const tip = curve.getPointAt(1); return [g, ell(tip, Math.max(r1, 0.004), Math.max(r1, 0.004), Math.max(r1, 0.004), null, true)]; }
const cone = (p, r, h, e) => put(CONE, { p, s: V(r, h, r), e });
// a flat shape (wings, fins, ears, sails), standing in the x-y plane
function flat(pts, curveTo) { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]); else s.lineTo(p[0], p[1]); } s.closePath(); return new THREE.ShapeGeometry(s, 6); }

// ---- a creature in the making: parts collected per joint and material, merged at the end ----
class Maker {
  constructor() { this.root = new THREE.Group(); this.parts = new Map(); this.halos = []; this.anim = []; }
  joint(parent, at) { const g = new THREE.Group(); if (at) g.position.copy(at); (parent || this.root).add(g); return g; }
  add(group, m, ...geos) { let byM = this.parts.get(group); if (!byM) this.parts.set(group, byM = new Map()); let l = byM.get(m); if (!l) byM.set(m, l = []); for (const g of geos.flat()) l.push(g); }
  glowAt(group, p, size, col) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.position.copy(p); sp.scale.set(size, size, 1); group.add(sp); this.halos.push(sp); }
  finish() { for (const [group, byM] of this.parts) for (const [m, list] of byM) { const gs = list.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; });
      const g = gs.length > 1 ? mergeGeometries(gs) : gs[0]; const mesh = new THREE.Mesh(g, m); mesh.castShadow = m.transparent !== true; group.add(mesh); } return this.root; }
}

// ---- the parts every design is made of ----
function eyes(M, g, at, r, o = {}) { const iris = o.iris || '#2b2b2b', glow = o.glow;
  for (const s of o.one ? [0] : [-1, 1]) { const p = V(at.x * (s || 1) * (o.one ? 0 : 1), at.y, at.z);
    M.add(g, mat('#F8F6F0', 'eye'), ell(p, r, r, r));
    M.add(g, glow ? mat(iris, 'glow') : mat(iris, 'eye'), ell(V(p.x + s * r * 0.25, p.y, p.z + r * 0.62), r * 0.66, r * 0.66, r * 0.5));
    M.add(g, mat('#0b0b0d', 'pupil'), ell(V(p.x + s * r * 0.3, p.y, p.z + r * 0.9), r * (o.slit ? 0.14 : 0.32), r * (o.slit ? 0.5 : 0.32), r * 0.18));
    M.add(g, mat('#ffffff', 'glow'), ell(V(p.x + s * r * 0.05, p.y + r * 0.35, p.z + r * 0.92), r * 0.12, r * 0.12, r * 0.08, null, true)); } }
// a head on a joint: skull, snout (long, short, beak), jaw, eyes; returns the joint
function head(M, parent, at, d) { const h = M.joint(parent, at), c = d.col, a = d.acc, R = d.headR || 0.16;
  M.add(h, mat(c, d.skin), ell(V(0, 0, 0), R, R * 0.9, R * 1.05));
  if (d.snout === 'beak') { M.add(h, mat(d.beak || '#E8B23A', 'shell'), cone(V(0, -R * 0.1, R * 1.15), R * 0.42, R * 1.0, [Math.PI / 2, 0, 0])); }
  else if (d.snout === 'long') { M.add(h, mat(c, d.skin), ell(V(0, -R * 0.25, R * 0.95), R * 0.55, R * 0.42, R * 0.8)); M.add(h, mat(shade(c, 0.7)), ell(V(0, -R * 0.48, R * 0.85), R * 0.5, R * 0.16, R * 0.72));
    if (d.teeth) for (let i = 0; i < 5; i++) for (const s of [-1, 1]) M.add(h, mat('#F4F1E6', 'shell'), cone(V(s * R * 0.38, -R * 0.52, R * (0.45 + i * 0.22)), R * 0.05, R * 0.14, [Math.PI, 0, 0])); }
  else if (d.snout !== 'none') M.add(h, mat(mix(c, '#ffffff', 0.12), d.skin), ell(V(0, -R * 0.25, R * 0.78), R * 0.5, R * 0.38, R * 0.42));
  if (d.snout !== 'beak' && d.snout !== 'none') for (const s of [-1, 1]) M.add(h, mat('#1a1416', 'pupil'), ell(V(s * R * 0.16, -R * 0.12, R * (d.snout === 'long' ? 1.72 : 1.18)), R * 0.05, R * 0.04, R * 0.03, null, true)); /* nostrils */
  eyes(M, h, V(R * (d.eyeX || 0.55), R * 0.22, R * 0.62), R * (d.eyeR || 0.3), { iris: d.iris || a, glow: d.glowEyes, slit: d.slit, one: d.cyclops });
  return h; }
// legs: a hip joint and a knee joint (both swing when it walks); feet or claws
function leg(M, parent, hip, len, r, d, o = {}) { const H = M.joint(parent, hip), up = len * 0.52, lo = len * 0.48, K = M.joint(H, V(0, -up, o.back ? -r * 0.6 : r * 0.6));
  M.add(H, mat(d.legCol || d.col, d.skin), limb(V(0, 0, 0), V(0, -up, o.back ? -r * 0.6 : r * 0.6), r * 1.15, r * 0.8));
  M.add(K, mat(d.legCol || d.col, d.skin), limb(V(0, 0, 0), V(0, -lo + r * 0.5, 0), r * 0.8, r * 0.62));
  const foot = d.foot || 'paw'; if (foot === 'hoof') M.add(K, mat('#2a2421', 'shell'), put(CYL, { p: V(0, -lo + r * 0.35, 0), s: V(r * 0.85, r * 0.7, r * 0.85) }));
  else if (foot === 'claw') { M.add(K, mat(d.legCol || d.col, d.skin), ell(V(0, -lo + r * 0.4, r * 0.4), r * 0.75, r * 0.4, r * 1.1)); for (const s of [-1, 0, 1]) M.add(K, mat('#2a2421', 'shell'), cone(V(s * r * 0.5, -lo + r * 0.35, r * 1.4), r * 0.16, r * 0.55, [Math.PI / 2, 0, 0])); }
  else M.add(K, mat(d.legCol || d.col, d.skin), ell(V(0, -lo + r * 0.42, r * 0.35), r * 0.85, r * 0.45, r * 1.05));
  return { H, K }; }
// a tail (or a trunk, or a tentacle): a chain of joints that sways
function chain(M, parent, at, n, segLen, r0, r1, col, skin, dir = V(0, 0.15, -1), tip) { const out = []; let p = parent, d = dir.clone().normalize();
  for (let i = 0; i < n; i++) { const g = M.joint(p, i ? d.clone().multiplyScalar(segLen) : at), ra = r0 + (r1 - r0) * i / n, rb = r0 + (r1 - r0) * (i + 1) / n;
    M.add(g, mat(col, skin), limb(V(0, 0, 0), d.clone().multiplyScalar(segLen), ra, rb)); out.push(g); p = g; }
  if (tip) tip(p, d.clone().multiplyScalar(segLen)); return out; }
// wings: bat (membrane between finger bones), feather (a fan of long feathers), insect (clear veined panes), fin
function wing(M, parent, at, side, span, d, type) { const W = M.joint(parent, at), c = d.wingCol || d.acc;
  if (type === 'feather') { for (let i = 0; i < 7; i++) { const t = i / 6, len = span * (0.45 + 0.55 * Math.sin(t * Math.PI * 0.85 + 0.25)), a = -0.15 - t * 1.0;
      M.add(W, mat(i % 2 ? c : shade(c, 0.86), d.wingSkin || 'skin'), ell(V(side * Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.12, -t * span * 0.35), len * 0.5, 0.012 * span + 0.01, span * 0.08, [0, 0, a * side])); }
    M.add(W, mat(d.col, d.skin), ell(V(side * span * 0.18, 0, -span * 0.06), span * 0.22, span * 0.05, span * 0.12)); }
  else if (type === 'insect') { for (const [z, k] of [[0.02, 1], [-span * 0.28, 0.75]]) { const g = flat([[0, 0], [span * 0.4, span * 0.12, span * k, span * 0.04], [span * k * 0.9, -span * 0.12, span * 0.4, -span * 0.12], [0, 0]]); g.rotateX(-Math.PI / 2); if (side < 0) g.scale(-1, 1, 1); g.translate(0, 0.01, z); M.add(W, mat(c, 'glass'), g); } }
  else if (type === 'fin') { const g = flat([[0, 0], [span * 0.5, span * 0.4, span, 0], [span * 0.5, -span * 0.15, 0, 0]]); g.rotateX(-Math.PI / 2); if (side < 0) g.scale(-1, 1, 1); M.add(W, mat(c, 'wing'), g); }
  else { /* a bat's wing: an arm out to the wrist, fingers fanning back, skin stretched between them with a scalloped edge */
    const wr = [0.42, 0.14], tips = [[1.0, -0.02], [0.8, -0.5], [0.52, -0.68], [0.24, -0.58]], s2 = new THREE.Shape();
    s2.moveTo(0, 0.1 * span); s2.lineTo(wr[0] * span, wr[1] * span); s2.lineTo(tips[0][0] * span, tips[0][1] * span);
    for (let i = 1; i < tips.length; i++) { const [ax, az] = tips[i - 1], [bx, bz] = tips[i]; s2.quadraticCurveTo((ax + bx) / 2 * span * 0.86, (az + bz) / 2 * span * 0.8, bx * span, bz * span); }
    s2.quadraticCurveTo(0.1 * span, -0.5 * span, 0, -0.32 * span); s2.closePath();
    const g = new THREE.ShapeGeometry(s2, 8); g.rotateX(-Math.PI / 2); g.scale(1, 1, -1); if (side < 0) g.scale(-1, 1, 1); M.add(W, mat(c, 'wing'), g);
    const bone = mat(shade(d.col, 0.85), d.skin), wrist = V(side * wr[0] * span, 0.01, wr[1] * span);
    M.add(W, bone, limb(V(0, 0.01, 0.05 * span), wrist, span * 0.035, span * 0.025)); for (const [x, z] of tips) M.add(W, bone, limb(wrist, V(side * x * span, 0.01, z * span), span * 0.02, span * 0.008));
    M.add(W, mat('#2a2421', 'shell'), cone(wrist.clone().add(V(0, 0, span * 0.04)), span * 0.025, span * 0.08, [Math.PI / 2, 0, 0])); } /* a claw at the wrist */
  return W; }
const spines = (M, g, pts, h, r, col, glow) => { for (const [p, e] of pts) M.add(g, mat(col, glow ? 'glow' : 'shell'), cone(p, r, h, e || [0, 0, 0])); };

// ---- body plans ----
// Each returns the animation for that plan; d is the design (with colours filled in)
function quad(M, d) { const S = d, R = M.joint(null, V(0, S.hipH, 0)), L = S.bodyL, Wd = S.bodyW, Hh = S.bodyH, body = M.joint(R);
  M.add(body, mat(S.col, S.skin), ell(V(0, 0, 0), Wd, Hh, L)); M.add(body, mat(S.belly || mix(S.col, '#ffffff', 0.35), S.skin), ell(V(0, -Hh * 0.35, L * 0.05), Wd * 0.86, Hh * 0.7, L * 0.86));
  if (S.shag) for (let i = 0; i < 60; i++) { const a = i * 2.4, t = (i % 10) / 10, z = (t - 0.5) * L * 1.7, rr = Math.sqrt(Math.max(0, 1 - (z / L) ** 2)); M.add(body, mat(i % 3 ? S.col : shade(S.col, 0.82), 'fur'), ell(V(Math.cos(a) * Wd * rr * 0.98, Math.sin(a) * Hh * rr * 0.96 - Hh * 0.05, z), Wd * 0.22, Hh * 0.42, L * 0.12, [0, 0, Math.cos(a) * 0.4], true)); }
  if (S.shell) { M.add(body, mat(S.shellCol || S.acc, 'shell'), ell(V(0, Hh * 0.28, 0), Wd * 1.16, Hh * 0.95, L * 1.12)); for (let i = -2; i <= 2; i++) M.add(body, mat(shade(S.shellCol || S.acc, 0.7), 'shell'), put(new THREE.TorusGeometry(1, 0.03, 6, 28, Math.PI), { p: V(0, Hh * 0.28, i * L * 0.32), s: V(Wd * 1.12 * Math.sqrt(1 - (i * 0.32) ** 2), Hh * 0.93 * Math.sqrt(1 - (i * 0.32) ** 2), 1) })); }
  if (S.crystals) for (let i = 0; i < S.crystals; i++) { const a = (i / S.crystals) * Math.PI * 1.6 - 0.8 + Math.PI / 2, z = ((i * 7) % S.crystals / S.crystals - 0.5) * L * 1.2, h = Hh * (0.6 + (i % 3) * 0.3);
    const p = V(Math.cos(a) * Wd * 0.6, Hh * (0.6 + Math.sin(a) * 0.4), z); M.add(body, mat(S.glowCol || S.acc, 'glow'), put(new THREE.OctahedronGeometry(1, 0), { p: p.clone().add(V(0, h * 0.4, 0)), s: V(h * 0.16, h * 0.55, h * 0.16), e: [0.2 * Math.cos(a), 0, (Math.PI / 2 - a) * 0.6] })); }
  if (S.plates) for (let i = 0; i < 6; i++) M.add(body, mat(S.acc, 'metal'), ell(V(0, Hh * 0.85, (i / 5 - 0.5) * L * 1.3), Wd * 0.55, Hh * 0.18, L * 0.12));
  if (S.spines) spines(M, body, Array.from({ length: S.spines }, (_, i) => [V(0, Hh * 0.95 - Math.abs(i / (S.spines - 1) - 0.5) * Hh * 0.3, (0.55 - i / (S.spines - 1)) * L * 1.4), [-0.25, 0, 0]]), Hh * 0.5, Hh * 0.12, S.acc, S.glowSpines);
  if (S.spots) for (let i = 0; i < S.spots; i++) { const a = i * 2.39996, z = ((i * 0.37) % 1 - 0.5) * L * 1.4, rr = Math.sqrt(Math.max(0, 1 - (z / L) ** 2)); M.add(body, mat(S.spotCol || S.acc, S.glowSpots ? 'glow' : 'skin'), ell(V(Math.cos(a) * Wd * rr * 1.0, Math.abs(Math.sin(a)) * Hh * rr * 0.95, z), Wd * 0.14, Wd * 0.1, Wd * 0.14, [0, 0, 0], true)); }
  // legs: four (or six) under the body
  const legs = [], n = S.legs || 4, lr = S.legR || Wd * 0.22;
  for (let i = 0; i < n / 2; i++) { const z = n === 4 ? (i ? -L * 0.62 : L * 0.62) : (1 - i) * L * 0.7; for (const s of [-1, 1]) legs.push({ ...leg(M, R, V(s * Wd * 0.62, -Hh * 0.25, z), S.hipH - Hh * 0.25, lr, S, { back: z < 0 }), ph: (i + (s > 0 ? 1 : 0)) % 2 ? Math.PI : 0 }); }
  // neck and head(s)
  const heads = []; const nh = S.heads || 1;
  for (let k = 0; k < nh; k++) { const off = nh > 1 ? (k - (nh - 1) / 2) * Wd * 0.7 : 0, base = V(off * 0.6, Hh * 0.35, L * 0.82), top = V(off, Hh * 0.35 + S.neck * 0.8, L * 0.82 + S.neck * 0.55);
    M.add(R, mat(S.col, S.skin), taper([base, V(off * 0.8, base.y + S.neck * 0.45, base.z + S.neck * 0.3), top], Wd * 0.38 * (nh > 1 ? 0.7 : 1), Wd * 0.26 * (nh > 1 ? 0.7 : 1))[0]);
    if (S.mane) for (let i = 0; i < 10; i++) { const t = i / 9, p = base.clone().lerp(top, t).add(V(0, Wd * 0.25, -Wd * 0.25)); M.add(R, mat(i % 2 ? S.mane : shade(S.mane, 0.85), S.glowMane ? 'glow' : 'fur'), ell(p, Wd * 0.12, Wd * 0.3, Wd * 0.16, [-0.6, 0, (i % 2 - 0.5) * 0.7])); } /* a mane down the back of the neck */
    const h = head(M, R, top.clone().add(V(0, 0.02, S.headR * 0.4)), S); heads.push(h); if (S.horns) hornsOn(M, h, S); if (S.ears) earsOn(M, h, S); if (S.antennae) antennaeOn(M, h, S); if (S.crest) crestOn(M, h, S); if (S.tusks) tusksOn(M, h, S); if (S.trunk) trunkOn(M, h, S, heads); }
  // tail(s)
  const tails = []; const nt = S.tails || 1, tl = S.tailLen || L * 1.2;
  for (let k = 0; k < nt; k++) { const fan = nt > 1 ? (k - (nt - 1) / 2) / (nt - 1) : 0, dir = V(fan * 1.4, 0.5 + (S.tailUp || 0) + Math.abs(fan) * 0.2, -1);
    tails.push(chain(M, R, V(0, Hh * 0.2, -L * 0.9), 6, tl / 6, S.tailR || Wd * 0.22, (S.tailR || Wd * 0.22) * 0.35, S.tailCol || S.col, S.skin, dir, S.tailTip ? (g, end) => { M.add(g, mat(S.tipCol || S.acc, 'glow'), ell(end, S.tipR || 0.06, S.tipR || 0.06, (S.tipR || 0.06) * 1.6)); M.glowAt(g, end, (S.tipR || 0.06) * 7, S.tipCol || S.acc); } : null)); }
  const wings = []; if (S.wings) for (const s of [-1, 1]) wings.push({ W: wing(M, body, V(s * Wd * 0.6, Hh * 0.6, L * 0.3), s, S.span || L * 1.4, S, S.wings), s });
  return (t, sp) => { const run = Math.min(1, sp / (S.gait || 1.6)), ph = t * (3 + sp * 2.2);
    for (const l of legs) { const a = Math.sin(ph + l.ph) * 0.55 * run; l.H.rotation.x = a; l.K.rotation.x = Math.max(0, -Math.sin(ph + l.ph)) * 0.7 * run; }
    R.position.y = S.hipH + Math.abs(Math.sin(ph)) * 0.03 * run + Math.sin(t * 1.6) * 0.008; body.rotation.z = Math.sin(ph) * 0.03 * run;
    for (const h of heads) { h.rotation.x = Math.sin(t * 0.9 + heads.indexOf(h)) * 0.08 - run * 0.05; h.rotation.y = Math.sin(t * 0.5 + heads.indexOf(h) * 2) * 0.25 * (1 - run); }
    tails.forEach((tl2, k) => tl2.forEach((g, i) => { g.rotation.y = Math.sin(t * 2.2 - i * 0.6 + k) * (0.12 + run * 0.06); g.rotation.x = Math.sin(t * 1.3 - i * 0.4 + k * 0.7) * 0.05; }));
    for (const w of wings) w.W.rotation.z = w.s * (Math.sin(t * (run ? 9 : 1.8)) * (run ? 0.45 : 0.08) + (S.wings === 'bat' ? 0.6 : 0.3)); }; }
function biped(M, d) { const S = d, R = M.joint(null, V(0, S.hipH, 0)), body = M.joint(R), L = S.bodyL, Wd = S.bodyW, Hh = S.bodyH, tilt = S.upright ? 0 : -0.25;
  body.rotation.x = tilt * 0.5; M.add(body, mat(S.col, S.skin), ell(V(0, Hh * 0.3, 0), Wd, Hh, L)); M.add(body, mat(S.belly || mix(S.col, '#ffffff', 0.35), S.skin), ell(V(0, Hh * 0.05, L * 0.25), Wd * 0.8, Hh * 0.75, L * 0.7));
  if (S.crystals) for (let i = 0; i < S.crystals; i++) { const a = i * 2.4; M.add(body, mat(S.glowCol || S.acc, 'glow'), put(new THREE.OctahedronGeometry(1, 0), { p: V(Math.cos(a) * Wd * 0.7, Hh * (0.6 + (i % 3) * 0.25), -Math.abs(Math.sin(a)) * L * 0.6), s: V(0.08, 0.26, 0.08), e: [-0.4, 0, Math.cos(a) * 0.5] })); }
  if (S.stripes) for (let i = 0; i < 5; i++) M.add(body, mat(S.acc), ell(V(0, Hh * 0.7, (i / 4 - 0.5) * L * 1.2), Wd * 0.5, Hh * 0.08, L * 0.07));
  const legs = []; for (const s of [-1, 1]) legs.push({ ...leg(M, R, V(s * Wd * 0.55, -Hh * 0.1, 0), S.hipH - Hh * 0.1, S.legR || Wd * 0.26, S, {}), ph: s > 0 ? Math.PI : 0 });
  const arms = []; if (S.arms) for (const s of [-1, 1]) { const A = M.joint(body, V(s * Wd * 0.85, Hh * 0.6, L * 0.55)); M.add(A, mat(S.col, S.skin), limb(V(0, 0, 0), V(0, -S.arms, S.arms * 0.4), Wd * 0.16, Wd * 0.1)); for (const c of [-1, 0, 1]) M.add(A, mat('#2a2421', 'shell'), cone(V(c * 0.02, -S.arms - 0.02, S.arms * 0.42), 0.012, 0.05, [Math.PI, 0, 0])); arms.push({ A, s }); }
  const neckTop = V(0, Hh * 0.5 + S.neck * 0.9, L * 0.75 + S.neck * 0.45);
  M.add(R, mat(S.col, S.skin), taper([V(0, Hh * 0.35, L * 0.55), V(0, Hh * 0.4 + S.neck * 0.5, L * 0.7 + S.neck * 0.2), neckTop], Wd * 0.42, Wd * 0.3)[0]);
  const h = head(M, R, neckTop.clone().add(V(0, 0.02, S.headR * 0.5)), S); if (S.horns) hornsOn(M, h, S); if (S.crest) crestOn(M, h, S); if (S.ears) earsOn(M, h, S); if (S.antennae) antennaeOn(M, h, S);
  const tail = S.tailLen ? chain(M, R, V(0, Hh * 0.2, -L * 0.8), 6, S.tailLen / 6, S.tailR || Wd * 0.3, (S.tailR || Wd * 0.3) * 0.3, S.tailCol || S.col, S.skin, V(0, 0.15, -1), S.tailTip ? (g, end) => { M.add(g, mat(S.tipCol || S.acc, 'glow'), ell(end, 0.05, 0.05, 0.08)); M.glowAt(g, end, 0.35, S.tipCol || S.acc); } : null) : [];
  const wings = []; if (S.wings) for (const s of [-1, 1]) wings.push({ W: wing(M, body, V(s * Wd * 0.75, Hh * 0.7, 0), s, S.span || 0.8, S, S.wings), s });
  return (t, sp) => { const run = Math.min(1, sp / (S.gait || 1.8)), ph = t * (3.2 + sp * 2.4);
    for (const l of legs) { l.H.rotation.x = Math.sin(ph + l.ph) * 0.7 * run; l.K.rotation.x = Math.max(0, -Math.sin(ph + l.ph)) * 0.9 * run; }
    R.position.y = S.hipH + Math.abs(Math.sin(ph)) * 0.05 * run + Math.sin(t * 1.8) * 0.01; body.rotation.x = tilt * 0.5 + run * 0.12;
    h.rotation.x = -run * 0.1 + Math.sin(t * 1.1) * 0.06; h.rotation.y = Math.sin(t * 0.6) * 0.3 * (1 - run);
    tail.forEach((g, i) => { g.rotation.y = Math.sin(t * 2 - i * 0.6) * (0.1 + run * 0.05); });
    for (const a of arms) a.A.rotation.x = Math.sin(ph + (a.s > 0 ? Math.PI : 0)) * 0.3 * run;
    for (const w of wings) w.W.rotation.z = w.s * (Math.sin(t * 1.6) * 0.1 + 0.2); }; }
function flyer(M, d) { const S = d, R = M.joint(null, V(0, S.fly || 1.6, 0)), body = M.joint(R), L = S.bodyL, Wd = S.bodyW, Hh = S.bodyH;
  M.add(body, mat(S.col, S.skin), ell(V(0, 0, 0), Wd, Hh, L)); M.add(body, mat(S.belly || mix(S.col, '#ffffff', 0.3), S.skin), ell(V(0, -Hh * 0.3, L * 0.1), Wd * 0.85, Hh * 0.7, L * 0.85));
  if (S.fire) for (let i = 0; i < 8; i++) M.add(body, mat(i % 2 ? S.acc : S.col, i % 2 ? 'glow' : 'skin'), cone(V((i % 3 - 1) * Wd * 0.4, Hh * 0.6, -L * 0.2 - i * L * 0.08), Wd * 0.18, Hh * 0.9, [-1.2, 0, (i % 3 - 1) * 0.3]));
  const h = head(M, R, V(0, Hh * 0.55, L * 0.95 + S.headR * 0.6), S); if (S.crest) crestOn(M, h, S); if (S.antennae) antennaeOn(M, h, S); if (S.horns) hornsOn(M, h, S);
  const wings = []; for (const s of [-1, 1]) wings.push({ W: wing(M, body, V(s * Wd * 0.7, Hh * 0.45, L * 0.15), s, S.span, S, S.wings || 'feather'), s });
  const tail = []; if (S.plumes) for (let i = 0; i < S.plumes; i++) { const k = (i - (S.plumes - 1) / 2); tail.push(chain(M, body, V(k * Wd * 0.25, 0, -L * 0.9), 5, (S.tailLen || L * 1.6) / 5, Wd * 0.14, Wd * 0.05, i % 2 ? S.acc : S.tailCol || S.col, S.fire ? 'glow' : S.skin, V(k * 0.25, -0.15, -1), S.tailTip ? (g, end) => { M.add(g, mat(S.tipCol || S.acc, 'glow'), ell(end, 0.05, 0.05, 0.09)); } : null)); }
  for (const s of [-1, 1]) M.add(body, mat(S.legCol || '#2a2421', 'shell'), limb(V(s * Wd * 0.3, -Hh * 0.8, -L * 0.1), V(s * Wd * 0.3, -Hh * 1.4, -L * 0.3), Wd * 0.06, Wd * 0.04)); /* legs tucked up */
  if (S.fire) M.glowAt(body, V(0, 0, 0), Math.max(L, Wd) * 2.6, S.acc);
  return (t, sp) => { const f = t * (sp > 0.2 ? 9 : 6.5); R.position.y = (S.fly || 1.6) + Math.sin(t * 2.2) * 0.12 + Math.sin(f) * 0.03;
    for (const w of wings) w.W.rotation.z = w.s * Math.sin(f) * 0.75; body.rotation.x = -Math.min(0.35, sp * 0.08);
    h.rotation.y = Math.sin(t * 0.7) * 0.25; tail.forEach((tl, k) => tl.forEach((g, i) => { g.rotation.x = Math.sin(t * 2.4 - i * 0.6 + k) * 0.12; g.rotation.y = Math.sin(t * 1.7 - i * 0.5 + k * 1.3) * 0.1; })); }; }
function hopper(M, d) { const S = d, R = M.joint(null, V(0, S.hipH, 0)), body = M.joint(R), L = S.bodyL, Wd = S.bodyW, Hh = S.bodyH;
  M.add(body, mat(S.col, S.skin), ell(V(0, 0, 0), Wd, Hh, L)); M.add(body, mat(S.belly || mix(S.col, '#ffffff', 0.4), S.skin), ell(V(0, -Hh * 0.3, L * 0.25), Wd * 0.85, Hh * 0.72, L * 0.8));
  if (S.spots) for (let i = 0; i < S.spots; i++) { const a = i * 2.39996; M.add(body, mat(S.acc, S.glowSpots ? 'glow' : 'skin'), ell(V(Math.cos(a) * Wd * 0.7, Hh * (0.3 + Math.abs(Math.sin(a)) * 0.6), (Math.sin(a * 1.7)) * L * 0.6), Wd * 0.16, Wd * 0.08, Wd * 0.16, null, true)); }
  const h = head(M, body, V(0, Hh * 0.55, L * 0.75), S); if (S.ears) earsOn(M, h, S); if (S.antennae) antennaeOn(M, h, S);
  if (S.glow) M.glowAt(body, V(0, 0, 0), Math.max(Wd, Hh) * 4.5, S.acc);
  const back = [], front = []; for (const s of [-1, 1]) { const T = M.joint(body, V(s * Wd * 0.8, -Hh * 0.2, -L * 0.45)); M.add(T, mat(S.col, S.skin), ell(V(0, 0, 0), Wd * 0.4, Hh * 0.55, L * 0.5)); M.add(T, mat(shade(S.col, 0.9), S.skin), ell(V(0, -Hh * 0.6, L * 0.3), Wd * 0.22, Hh * 0.12, L * 0.42)); back.push(T);
    const F = M.joint(body, V(s * Wd * 0.55, -Hh * 0.4, L * 0.55)); M.add(F, mat(S.col, S.skin), limb(V(0, 0, 0), V(0, -S.hipH + Hh * 0.45, L * 0.1), Wd * 0.12, Wd * 0.1)); front.push(F); }
  return (t, sp) => { const run = Math.min(1, sp / (S.gait || 1.2)), ph = (t * (2.6 + sp * 1.8)) % (Math.PI), hop = run ? Math.sin(ph) : 0;
    R.position.y = S.hipH + hop * S.hop * run + Math.sin(t * 2) * 0.01; body.rotation.x = run ? -Math.cos(ph) * 0.25 : Math.sin(t * 1.4) * 0.03;
    for (const T of back) T.rotation.x = run ? -hop * 0.8 : 0; for (const F of front) F.rotation.x = run ? Math.cos(ph) * 0.5 : 0;
    h.rotation.y = Math.sin(t * 0.8) * 0.2 * (1 - run); body.scale.y = 1 + Math.sin(t * 2.4) * 0.02; }; }
function serpent(M, d) { const S = d, R = M.joint(null, V(0, S.hipH, 0)), n = S.segs || 14, segs = [], Lp = S.bodyL;
  let p = R; for (let i = 0; i < n; i++) { const g = M.joint(p, i ? V(0, 0, -Lp / n) : V(0, 0, Lp * 0.4)), r = S.bodyW * (1 - Math.pow(i / n, 1.6) * 0.75);
    M.add(g, mat(i % 2 && S.bands ? S.acc : S.col, S.skin), ell(V(0, 0, -Lp / n / 2), r, r * 0.85, Lp / n * 0.75)); if (S.glowSpots && i % 2 === 0) M.add(g, mat(S.acc, 'glow'), ell(V(0, r * 0.7, -Lp / n / 2), r * 0.3, r * 0.15, r * 0.3, null, true));
    if (S.fins && i % 3 === 1) spines(M, g, [[V(0, r * 0.9, -Lp / n / 2), [-0.4, 0, 0]]], r * 1.2, r * 0.25, S.acc, S.glowSpines); segs.push(g); p = g; }
  const nh = S.heads || 1, heads = []; for (let k = 0; k < nh; k++) { const off = nh > 1 ? (k - (nh - 1) / 2) * 0.22 : 0, nk = M.joint(R, V(off, 0, Lp * 0.42));
    if (S.neck) M.add(nk, mat(S.col, S.skin), taper([V(0, 0, 0), V(off * 0.5, S.neck * 0.6, S.neck * 0.3), V(off, S.neck, S.neck * 0.45)], S.bodyW * 0.7, S.bodyW * 0.55)[0]);
    const h = head(M, nk, V(off, S.neck || 0, (S.neck ? S.neck * 0.45 : 0) + S.headR * 0.6), S); if (S.horns) hornsOn(M, h, S); if (S.crest) crestOn(M, h, S); heads.push({ nk, h }); }
  return (t, sp) => { const run = Math.min(1, sp / 1.4); segs.forEach((g, i) => { g.rotation.y = Math.sin(t * (2 + sp * 2) - i * 0.55) * (0.18 + run * 0.12) * (i ? 1 : 0.4); g.position.y = i ? Math.sin(t * 1.5 - i * 0.4) * 0.006 : 0; });
    R.position.y = S.hipH + (S.floats ? Math.sin(t * 1.4) * 0.12 : 0); heads.forEach(({ nk, h }, k) => { nk.rotation.y = Math.sin(t * 0.9 + k * 2.1) * 0.3; h.rotation.x = Math.sin(t * 1.2 + k) * 0.1; }); }; }
function floater(M, d) { const S = d, R = M.joint(null, V(0, S.fly || 1.3, 0)), body = M.joint(R), Rr = S.bodyW;
  if (S.jelly) { M.add(body, mat(S.col, 'glass'), put(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), { s: V(Rr, Rr * 0.8, Rr) })); M.add(body, mat(S.acc, 'glow'), ell(V(0, Rr * 0.2, 0), Rr * 0.45, Rr * 0.35, Rr * 0.45)); M.glowAt(body, V(0, Rr * 0.2, 0), Rr * 4, S.acc); }
  else { M.add(body, mat(S.col, S.skin), ell(V(0, 0, 0), Rr, Rr * (S.squash || 1), Rr)); if (S.bodyEye) { M.add(body, mat('#F8F6F0', 'eye'), ell(V(0, 0, Rr * 0.55), Rr * 0.55, Rr * 0.55, Rr * 0.5)); M.add(body, mat(S.acc, 'glow'), ell(V(0, 0, Rr * 0.98), Rr * 0.32, Rr * 0.32, Rr * 0.08)); M.add(body, mat('#0b0b0d', 'pupil'), ell(V(0, 0, Rr * 1.04), Rr * 0.13, Rr * 0.13, Rr * 0.04)); M.glowAt(body, V(0, 0, Rr), Rr * 2.5, S.acc); }
    else eyes(M, body, V(Rr * 0.38, Rr * 0.25, Rr * 0.72), Rr * 0.26, { iris: S.iris || S.acc, glow: S.glowEyes }); }
  const rings = []; if (S.rings) for (let i = 0; i < S.rings; i++) { const g = M.joint(body); M.add(g, mat(S.acc, i ? 'glow' : 'metal'), put(new THREE.TorusGeometry(Rr * (1.45 + i * 0.3), Rr * 0.05, 8, 40), { e: [Math.PI / 2 + i * 0.6, i * 0.9, 0] })); rings.push(g); }
  const tent = []; if (S.tentacles) for (let i = 0; i < S.tentacles; i++) { const a = i / S.tentacles * Math.PI * 2, at = V(Math.cos(a) * Rr * 0.6, -Rr * (S.jelly ? 0.05 : 0.5), Math.sin(a) * Rr * 0.6);
    tent.push(chain(M, body, at, 6, (S.tentLen || 0.8) / 6, Rr * 0.12, Rr * 0.03, i % 2 ? S.acc : S.col, S.jelly ? 'glass' : S.skin, V(Math.cos(a) * 0.25, -1, Math.sin(a) * 0.25), S.tentGlow ? (g, end) => M.add(g, mat(S.acc, 'glow'), ell(end, 0.025, 0.025, 0.025, null, true)) : null)); }
  return (t, sp) => { R.position.y = (S.fly || 1.3) + Math.sin(t * 1.6) * 0.1; body.rotation.y = Math.sin(t * 0.4) * 0.3; body.rotation.x = -Math.min(0.3, sp * 0.1);
    if (S.jelly) body.scale.set(1 + Math.sin(t * 2.4) * 0.06, 1 - Math.sin(t * 2.4) * 0.06, 1 + Math.sin(t * 2.4) * 0.06);
    rings.forEach((g, i) => { g.rotation.z = t * (0.6 + i * 0.4) * (i % 2 ? -1 : 1); });
    tent.forEach((tl, k) => tl.forEach((g, i) => { g.rotation.x = Math.sin(t * 2 - i * 0.7 + k) * 0.18 + sp * 0.08; g.rotation.z = Math.cos(t * 1.6 - i * 0.6 + k * 1.3) * 0.15; })); }; }

// ---- extras on a head ----
function hornsOn(M, h, S) { const R = S.headR, kind = S.horns;
  if (kind === 'spiral') { const p = []; for (let i = 0; i <= 8; i++) p.push(V(0, R * 0.7 + i * R * 0.34, R * 0.45 + i * R * 0.12)); const [g, tip] = taper(p, R * 0.2, R * 0.015, 16, 8); M.add(h, mat(S.hornCol || '#F6E7B0', S.glowHorn ? 'glow' : 'shell'), g, tip);
    for (let i = 0; i < 6; i++) M.add(h, mat(shade(S.hornCol || '#F6E7B0', 0.8), 'shell'), put(new THREE.TorusGeometry(R * (0.12 - i * 0.017), R * 0.018, 5, 14), { p: V(0, R * 0.85 + i * R * 0.42, R * 0.5 + i * R * 0.15), s: V(1.5, 1.5, 1.5), e: [Math.PI / 2 - 0.35, 0, 0] })); if (S.glowHorn) M.glowAt(h, V(0, R * 3.4, R * 1.4), R * 3, S.hornCol || '#F6E7B0'); return; }
  for (const s of [-1, 1]) { const pts = kind === 'curl' ? [V(s * R * 0.5, R * 0.55, -R * 0.1), V(s * R * 1.0, R * 1.0, -R * 0.4), V(s * R * 1.35, R * 0.7, -R * 0.75), V(s * R * 1.2, R * 0.3, -R * 0.6)]
      : kind === 'back' ? [V(s * R * 0.45, R * 0.6, -R * 0.2), V(s * R * 0.6, R * 1.0, -R * 0.75), V(s * R * 0.7, R * 1.25, -R * 1.4)] : [V(s * R * 0.45, R * 0.6, 0), V(s * R * 0.65, R * 1.2, R * 0.05), V(s * R * 0.7, R * 1.6, -R * 0.15)];
    const [g, tip] = taper(pts, R * 0.16, R * 0.02, 12, 8); M.add(h, mat(S.hornCol || '#E9DFC6', S.glowHorn ? 'glow' : 'shell'), g, tip); } }
function earsOn(M, h, S) { const R = S.headR; for (const s of [-1, 1]) { const tall = S.ears === 'long' ? 3.2 : S.ears === 'tall' ? 2.2 : 1.3, g = flat([[-R * 0.32, 0], [0, R * tall * 0.55, 0, R * tall], [R * 0.32, 0]]);
    M.add(h, mat(S.col, S.skin), put(g, { p: V(s * R * 0.55, R * 0.55, -R * 0.05), e: [-0.15, s * 0.35, -s * 0.25] })); M.add(h, mat(S.earIn || mix(S.acc, '#ffffff', 0.3), S.glowEars ? 'glow' : 'skin'), put(g, { p: V(s * R * 0.555, R * 0.58, -R * 0.03), s: V(0.6, 0.75, 1), e: [-0.15, s * 0.35, -s * 0.25] })); } }
function antennaeOn(M, h, S) { const R = S.headR; for (const s of [-1, 1]) { const [g, tip] = taper([V(s * R * 0.3, R * 0.75, R * 0.1), V(s * R * 0.6, R * 1.6, R * 0.25), V(s * R * 0.95, R * 2.2, R * 0.05)], R * 0.05, R * 0.025, 8, 6); M.add(h, mat(S.antCol || shade(S.col, 0.6), 'skin'), g);
    M.add(h, mat(S.acc, 'glow'), ell(V(s * R * 0.95, R * 2.25, R * 0.05), R * 0.13, R * 0.13, R * 0.13)); M.glowAt(h, V(s * R * 0.95, R * 2.25, R * 0.05), R * 1.2, S.acc); } }
function crestOn(M, h, S) { const R = S.headR; for (let i = 0; i < 5; i++) M.add(h, mat(S.crestCol || S.acc, S.glowCrest ? 'glow' : 'skin'), ell(V(0, R * (0.85 + Math.sin(i / 4 * Math.PI) * 0.4), R * (0.35 - i * 0.28)), R * 0.06, R * (0.45 - i * 0.04), R * 0.16, [-0.4 - i * 0.12, 0, 0]));
  if (S.glowCrest) M.glowAt(h, V(0, R * 1.1, -R * 0.2), R * 3, S.crestCol || S.acc); }
function tusksOn(M, h, S) { const R = S.headR; for (const s of [-1, 1]) { const [g, tip] = taper([V(s * R * 0.35, -R * 0.4, R * 0.7), V(s * R * 0.55, -R * 1.0, R * 1.3), V(s * R * 0.4, -R * 0.75, R * 1.95), V(s * R * 0.1, -R * 0.25, R * 2.1)], R * 0.13, R * 0.03, 14, 8); M.add(h, mat('#F4ECD8', 'shell'), g, tip); } }
function trunkOn(M, h, S, heads) { const R = S.headR, t = chain(M, h, V(0, -R * 0.2, R * 0.9), 6, R * 0.32, R * 0.22, R * 0.08, S.col, S.skin, V(0, -0.8, 0.45)); heads.trunk = t; }

// ---- the designs ----
// type: quad | hex | biped | flyer | hopper | serpent | floater. Sizes are in metres; colours come from the creature
// (col, acc) unless a design gives its own. The six racers keep their looks from the race track; the rest are pets.
const D = {
  starcrest:  { type: 'biped', hipH: 0.62, bodyL: 0.28, bodyW: 0.2, bodyH: 0.22, neck: 0.55, headR: 0.1, snout: 'beak', beak: '#F2B33D', crest: 1, glowCrest: 1, tailLen: 0.35, legR: 0.045, foot: 'claw', gait: 2 },
  dustrunner: { type: 'quad', legs: 6, hipH: 0.24, bodyL: 0.42, bodyW: 0.17, bodyH: 0.12, neck: 0.08, headR: 0.1, snout: 'long', slit: 1, tailLen: 0.6, legR: 0.035, foot: 'claw', spots: 9, spotCol: '#F2C36B', gait: 2.2 },
  skyskimmer: { type: 'flyer', fly: 1.4, bodyL: 0.2, bodyW: 0.1, bodyH: 0.09, headR: 0.08, snout: 'beak', beak: '#2b2b2b', span: 0.55, wings: 'insect', wingCol: '#BEE6F5', antennae: 1, plumes: 2, tailLen: 0.25 },
  mudgulper:  { type: 'hopper', hipH: 0.3, bodyL: 0.32, bodyW: 0.3, bodyH: 0.24, headR: 0.15, snout: 'none', eyeR: 0.42, eyeX: 0.6, spots: 7, hop: 0.28, gait: 1.2 },
  ironshell:  { type: 'quad', hipH: 0.26, bodyL: 0.34, bodyW: 0.26, bodyH: 0.18, neck: 0.05, headR: 0.11, snout: 'short', shell: 1, shellCol: '#9AA1A8', legR: 0.06, foot: 'claw', tailLen: 0.18, gait: 1 },
  glimmerhop: { type: 'hopper', hipH: 0.32, bodyL: 0.24, bodyW: 0.22, bodyH: 0.22, headR: 0.15, snout: 'short', ears: 'long', glowEars: 1, glow: 1, spots: 6, glowSpots: 1, glowEyes: 1, hop: 0.45, gait: 1.1, skin: 'shell' },
  // ancient
  thunderjaw: { type: 'biped', hipH: 0.78, bodyL: 0.5, bodyW: 0.24, bodyH: 0.26, neck: 0.32, headR: 0.17, snout: 'long', teeth: 1, slit: 1, arms: 0.2, tailLen: 1.1, tailR: 0.12, legR: 0.07, foot: 'claw', stripes: 1, crest: 1, crestCol: '#E4572E', gait: 2.4 },
  mossmammoth:{ type: 'quad', hipH: 0.72, bodyL: 0.55, bodyW: 0.42, bodyH: 0.45, neck: 0.04, headR: 0.24, snout: 'none', ears: 'short', shag: 1, tusks: 1, trunk: 1, legR: 0.12, foot: 'hoof', tailLen: 0.3, tailR: 0.04, spots: 10, spotCol: '#6FA34A', gait: 1.2 },
  crystaltortoise: { type: 'quad', hipH: 0.3, bodyL: 0.42, bodyW: 0.34, bodyH: 0.2, neck: 0.12, headR: 0.12, snout: 'short', shell: 1, crystals: 9, legR: 0.08, foot: 'claw', tailLen: 0.15, gait: 0.8 },
  pteroglider:{ type: 'flyer', fly: 2.2, bodyL: 0.32, bodyW: 0.14, bodyH: 0.13, headR: 0.12, snout: 'long', crest: 1, span: 1.4, wings: 'bat', plumes: 1, tailLen: 0.4 },
  // mythic
  emberdrake: { type: 'quad', hipH: 0.48, bodyL: 0.48, bodyW: 0.26, bodyH: 0.24, neck: 0.4, headR: 0.15, snout: 'long', slit: 1, horns: 'back', spines: 9, glowSpines: 1, wings: 'bat', span: 0.9, legR: 0.07, foot: 'claw', tailLen: 0.9, tailTip: 1, tipR: 0.09, glowEyes: 1, gait: 1.8 },
  moonfox:    { type: 'quad', hipH: 0.42, bodyL: 0.36, bodyW: 0.17, bodyH: 0.17, neck: 0.16, headR: 0.13, snout: 'short', ears: 'tall', glowEars: 1, tails: 9, tailLen: 0.55, tailR: 0.07, tailTip: 1, tipR: 0.06, legR: 0.045, slit: 1, glowEyes: 1, gait: 2.2, skin: 'fur' },
  gryphling:  { type: 'quad', hipH: 0.5, bodyL: 0.44, bodyW: 0.24, bodyH: 0.24, neck: 0.22, headR: 0.15, snout: 'beak', beak: '#E8B23A', crest: 1, wings: 'feather', span: 1.0, legR: 0.07, foot: 'claw', tailLen: 0.5, tailTip: 1, tipR: 0.07, gait: 2, skin: 'fur' },
  starhorn:   { type: 'quad', hipH: 0.85, bodyL: 0.55, bodyW: 0.24, bodyH: 0.28, neck: 0.5, headR: 0.16, snout: 'long', horns: 'spiral', glowHorn: 1, mane: '#D7C9FF', glowMane: 1, legR: 0.06, foot: 'hoof', tailLen: 0.6, tailR: 0.07, tailCol: '#D7C9FF', gait: 2.4 },
  phoenixlet: { type: 'flyer', fly: 1.9, bodyL: 0.26, bodyW: 0.14, bodyH: 0.14, headR: 0.11, snout: 'beak', beak: '#F2C94C', crest: 1, glowCrest: 1, fire: 1, span: 0.9, wings: 'feather', wingCol: '#F2913D', plumes: 3, tailLen: 0.7, tailTip: 1, glowEyes: 1 },
  hydraling:  { type: 'serpent', hipH: 0.3, bodyL: 1.5, bodyW: 0.17, segs: 12, neck: 0.5, heads: 3, headR: 0.11, snout: 'long', slit: 1, horns: 'back', fins: 1, bands: 1 },
  krakenling: { type: 'floater', fly: 1.2, bodyW: 0.3, squash: 1.25, tentacles: 8, tentLen: 0.9, eyeR: 0.4, iris: '#F2C94C', glowEyes: 1, tentGlow: 1 },
  // sci-fi
  orbling:    { type: 'floater', fly: 1.5, bodyW: 0.22, bodyEye: 1, rings: 2, skin: 'metal' },
  mechapup:   { type: 'quad', hipH: 0.4, bodyL: 0.34, bodyW: 0.18, bodyH: 0.16, neck: 0.1, headR: 0.14, snout: 'short', ears: 'tall', glowEars: 1, glowEyes: 1, antennae: 1, plates: 1, legR: 0.05, legCol: '#5c6168', skin: 'metal', tailLen: 0.35, tailTip: 1, tipR: 0.05, gait: 1.8 },
  voidjelly:  { type: 'floater', fly: 1.6, bodyW: 0.32, jelly: 1, tentacles: 10, tentLen: 1.1, tentGlow: 1 },
  plasmawyrm: { type: 'serpent', hipH: 0.25, bodyL: 1.7, bodyW: 0.14, segs: 16, neck: 0.25, headR: 0.12, snout: 'long', slit: 1, glowEyes: 1, glowSpots: 1, fins: 1, glowSpines: 1, floats: 1 },
  nebulynx:   { type: 'quad', hipH: 0.4, bodyL: 0.36, bodyW: 0.16, bodyH: 0.16, neck: 0.12, headR: 0.13, snout: 'short', ears: 'tall', antennae: 1, spots: 16, glowSpots: 1, slit: 1, glowEyes: 1, legR: 0.045, tailLen: 0.6, tailR: 0.05, tailTip: 1, tipR: 0.05, gait: 2.2, skin: 'fur' },
  quartzling: { type: 'biped', upright: 1, hipH: 0.55, bodyL: 0.26, bodyW: 0.3, bodyH: 0.36, neck: 0.04, headR: 0.15, snout: 'none', cyclops: 1, eyeR: 0.45, glowEyes: 1, arms: 0.42, crystals: 10, legR: 0.1, skin: 'shell', gait: 1.2 },
  hoverbeetle:{ type: 'quad', legs: 6, hipH: 0.3, bodyL: 0.36, bodyW: 0.24, bodyH: 0.16, neck: 0.03, headR: 0.12, snout: 'none', antennae: 1, shell: 1, wings: 'insect', span: 0.6, legR: 0.03, legCol: '#2a2421', skin: 'metal', gait: 1.6 },
};
export const DESIGNS = D;

// build(kind) → { group, animate(dt, speed), height, flies, dispose }
export function build(kind, opts = {}) {
  const C = CREATURES[kind] || CREATURES.glimmerhop, d0 = D[kind] || D.glimmerhop, d = { col: C.color, acc: C.accent, skin: 'skin', ...d0 }, M = new Maker();
  const plan = { quad, hex: quad, biped, flyer, hopper, serpent, floater }[d.type] || quad, step = plan(M, d), root = M.finish();
  const g = new THREE.Group(), sc = opts.scale || 1; g.add(root); root.scale.setScalar(sc);
  const box = new THREE.Box3().setFromObject(root); let t = Math.random() * 10;
  return { group: g, kind, flies: d.type === 'flyer' || d.type === 'floater', height: (box.max.y || 1) + 0.15,
    animate(dt, speed = 0) { t += Math.min(0.1, Math.max(0, dt)); step(t, speed / sc); },
    dispose() { root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.isSprite) o.material.dispose(); }); } };
}

// A picture of a creature (for the store and the map), rendered once in 3D and kept: a promise of a data URL
const SHOTS = new Map(); let shotR = null;
export function shot(kind, size = 256) {
  const key = kind + '|' + size; if (SHOTS.has(key)) return SHOTS.get(key);
  const p = new Promise(res => { requestAnimationFrame(() => { try {
    if (!shotR) { shotR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); shotR.outputColorSpace = THREE.SRGBColorSpace; }
    shotR.setPixelRatio(1); shotR.setSize(size, size, false); const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight('#ffffff', '#6a6f80', 1.9)); const dl = new THREE.DirectionalLight('#ffffff', 2.4); dl.position.set(2, 4, 3); sc.add(dl);
    const C = build(kind); C.animate(0.016, 0); C.group.rotation.y = 0.75; sc.add(C.group); C.group.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(C.group), c = b.getCenter(V(0, 0, 0)), s = b.getSize(V(0, 0, 0)), r = Math.max(s.x, s.y, s.z) * 0.62;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 50); cam.position.set(c.x + r * 1.2, c.y + r * 0.7, c.z + r * 3.2); cam.lookAt(c);
    shotR.setClearColor(0x000000, 0); shotR.render(sc, cam); const url = shotR.domElement.toDataURL('image/png'); C.dispose(); res(url); } catch (e) { res(null); } }); });
  SHOTS.set(key, p); return p; }

// A pet that keeps up with its owner: it trots after them a little behind and to one side, hurries to catch up when
// they get far ahead (and jumps to them if they're very far, after a drive or a door), and turns to look at them when
// they stop. step(dt, x, z) each frame with the owner's position (metres); it returns true when the pet moved.
export function follower(kind, opts = {}) {
  // Smooth following: the owner's heading is averaged over a moment (so a jittery step doesn't swing the pet about),
  // the pet's spot (just behind and to one side) is chased with a critically damped spring (it eases in and out and
  // never overshoots, at any frame rate), and its speed, gait and the way it faces all ease too. It keeps up with
  // someone running (up to 16 m/s) and jumps to them only when it's left far behind (a teleport, a new room).
  const C = build(kind, opts), g = C.group, side = opts.side || 1, near = opts.near || 1.1;
  let px = null, pz = 0, vx = 0, vz = 0, ox = 0, oz = 0, ovx = 0, ovz = 0, dirx = 0, dirz = 1, ry = 0, sp = 0;
  const damp = (cur, tgt, vel, T, dt) => { const w = 2 / T, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), ch = cur - tgt, tmp = (vel + w * ch) * dt; return [tgt + (ch + tmp) * e, (vel - w * tmp) * e]; };
  return { C, group: g,
    step(dt, x, z) { dt = Math.min(0.1, Math.max(0, dt)); if (!dt) return false;
      if (px === null || Math.hypot(x - px, z - pz) > 25) { px = x - dirx * near; pz = z - dirz * near; vx = vz = 0; ox = x; oz = z; ovx = ovz = 0; }
      // the owner's velocity, smoothed, and from it the way they're heading
      const k = Math.min(1, dt * 7); ovx += ((x - ox) / dt - ovx) * k; ovz += ((z - oz) / dt - ovz) * k; ox = x; oz = z;
      const os = Math.hypot(ovx, ovz); if (os > 0.4) { const kd = Math.min(1, dt * (2.5 + os * 0.4)); dirx += (ovx / os - dirx) * kd; dirz += (ovz / os - dirz) * kd; const dl = Math.hypot(dirx, dirz) || 1; dirx /= dl; dirz /= dl; }
      const back = near * (1 + Math.min(0.8, os * 0.08)); /* (a little further back at a run) */
      const tx = x - dirx * back + dirz * side * near * 0.55, tz = z - dirz * back - dirx * side * near * 0.55;
      const T = Math.hypot(tx - px, tz - pz) > 4 ? 0.22 : 0.32; [px, vx] = damp(px, tx, vx, T, dt); [pz, vz] = damp(pz, tz, vz, T, dt);
      let v = Math.hypot(vx, vz); if (v > 16) { vx *= 16 / v; vz *= 16 / v; v = 16; }
      sp += (v - sp) * Math.min(1, dt * 8); const moving = sp > 0.12;
      // face where it's going; standing, turn slowly to look at its owner
      const want = v > 0.35 ? Math.atan2(vx, vz) : Math.hypot(x - px, z - pz) > 0.3 ? Math.atan2(x - px, z - pz) : ry; let dd = want - ry; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); ry += dd * Math.min(1, dt * (v > 0.35 ? 9 : 3));
      g.position.set(px, 0, pz); g.rotation.y = ry; C.animate(dt, moving ? sp : 0); return moving || Math.abs(dd) > 0.01; },
    dispose() { if (g.parent) g.parent.remove(g); C.dispose(); } };
}
