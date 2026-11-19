// A crowd of whole people for the stands (the Colosseum and the race track): head, hair, body, hips, arms in sleeves
// with bare forearms, legs (and shoes where they show), each in their own clothes, skin and hair colours, sitting on
// the seats (or standing at a rail). When the crowd gets going (hype 0..1) they bounce and throw their arms up.
//
// Built so a phone stays cool:
//  - one small shared shape (about 170 triangles a person: limbs have 4 sides, the head 7) and every person drawn by
//    the graphics chip from it (instancing), so a whole crowd is a handful of draws;
//  - the crowd is cut into slices round the middle (a draw each); a slice behind the camera isn't drawn at all;
//  - the colours are chosen per person and per body part on the graphics chip (no texture, no extra draws);
//  - the cheering (arms up, bouncing) is worked out on the graphics chip too: no work for the phone's processor;
//  - no shadows cast by the crowd.
//
// makeCrowd({ scene, spots, pose, hype, time, tops, shoes, sectors, mats })
//   spots: [[x, y, z, ry], ...] (y: the seat's surface when sitting, the ground when standing; facing +z turned by ry)
//   pose: 'sit' (legs over the edge in front) or 'stand'; hype / time: { value } uniforms (0..1, seconds)
//   tops: colours for shirts and tunics; shoes: false where the feet never show
// Returns { meshes, count }.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BOTTOMS = ['#2B3A55', '#3B3B40', '#5A4632', '#22303C', '#6B5B45', '#1F1F24', '#4A5A6A', '#7A6A55', '#3C4A3F'];
const SKIN = ['#8D5524', '#C68642', '#E0AC69', '#5C3A21', '#F1C27D', '#A0663D', '#D7A27A', '#6E4227'];
const HAIR = ['#1C1410', '#2E1F14', '#5A3825', '#8A5A2B', '#C9A15A', '#121212', '#6B6B6B', '#3B2A1E'];
const SHOES = ['#1E1E22', '#F2F2F2', '#5A3A22', '#2B2F3A', '#8A2A22'];

// the shape: [geometry, part, arm pivot or null]; part 0 top, 1 bottoms, 2 skin, 3 hair, 4 shoes, 5 long hair
function figure(pose, shoes, hi) {
  const P = [], sit = pose === 'sit', H = sit ? 0 : 0.8, L = hi ? 8 : 4; /* (sitting: the seat is y = 0; standing: the hips are 0.8 up. hi: the people near you, rounder, with faces) */
  const put = (g, part, x, y, z, rx = 0, sx = 1, sz = 1, arm = null) => { g.scale(sx, 1, sz); if (rx) g.rotateX(rx); g.translate(x, y, z); P.push([g, part, arm]); };
  put(new THREE.CylinderGeometry(0.13, 0.13, 0.15, hi ? 12 : 6, 1, true), 1, 0, H + 0.075, 0, 0, 1, 0.8); /* hips */
  put(new THREE.CylinderGeometry(0.15, 0.125, 0.4, hi ? 12 : 6, 1, false), 0, 0, H + 0.35, 0, 0, 1, 0.74); /* body */
  if (hi) put(new THREE.SphereGeometry(0.152, 12, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, H + 0.5, 0, 0, 1, 0.74); /* rounded shoulders */
  put(new THREE.SphereGeometry(0.13, hi ? 14 : 7, hi ? 8 : 4), 2, 0, H + 0.7, 0.01); /* head */
  put(new THREE.SphereGeometry(0.14, hi ? 14 : 7, hi ? 4 : 2, 0, Math.PI * 2, 0, 1.25), 3, 0, H + 0.715, -0.012); /* hair */
  put(new THREE.CylinderGeometry(0.136, 0.125, 0.2, hi ? 8 : 4, 1, true, Math.PI / 2, Math.PI), 5, 0, H + 0.66, 0.0, 0, 1, 0.85); /* long hair, down the back (only on some) */
  if (hi) { for (const s of [-1, 1]) put(new THREE.SphereGeometry(0.018, 5, 3), 6, s * 0.045, H + 0.715, 0.13); /* eyes */
    put(new THREE.BoxGeometry(0.06, 0.012, 0.01), 7, 0, H + 0.645, 0.133); } /* mouth */
  for (const s of [-1, 1]) { const pv = [s * 0.19, H + 0.53, 0];
    put(new THREE.CylinderGeometry(0.046, 0.042, 0.25, L, 1, true), 0, s * 0.19, H + 0.42, 0, 0, 1, 1, pv); /* sleeve */
    put(new THREE.CylinderGeometry(0.04, 0.034, 0.24, L, 1, true), 2, s * 0.19, H + 0.18, 0, 0, 1, 1, pv); /* forearm */
    if (hi) { put(new THREE.SphereGeometry(0.042, 7, 4), 2, s * 0.19, H + 0.06, 0, 0, 1, 1, pv); } /* hand */
    if (sit) { put(new THREE.CylinderGeometry(0.066, 0.058, 0.42, L, 1, true), 1, s * 0.075, 0.06, 0.2, Math.PI / 2); /* thigh, along the seat */
      put(new THREE.CylinderGeometry(0.056, 0.048, 0.4, L, 1, true), 1, s * 0.075, -0.14, 0.41); /* shin, over the edge */
      if (shoes) put(new THREE.BoxGeometry(0.1, 0.07, 0.18), 4, s * 0.075, -0.36, 0.45); }
    else { put(new THREE.CylinderGeometry(0.066, 0.05, 0.8, L, 1, true), 1, s * 0.075, 0.4, 0); /* leg */
      if (shoes) put(new THREE.BoxGeometry(0.1, 0.07, 0.2), 4, s * 0.075, 0.035, 0.04); } }
  const parts = P.map(([g, part, arm]) => { const n = (g = g.index ? g.toNonIndexed() : g).attributes.position.count; g.deleteAttribute('uv');
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) { a[i * 4] = arm ? 1 : 0; if (arm) { a[i * 4 + 1] = arm[0]; a[i * 4 + 2] = arm[1]; a[i * 4 + 3] = arm[2]; } }
    g.setAttribute('aArm', new THREE.Float32BufferAttribute(a, 4)); return g; });
  return mergeGeometries(parts, false);
}

// the cheer, shared by the shape and its shading: arms swing up (a little out of step, most people) and a bounce
const HEAD = `uniform float uHype; uniform float uTime; attribute float aPart; attribute vec4 aArm; attribute vec3 iTop; attribute vec3 iBot; attribute vec3 iSkin; attribute vec4 iHair; attribute vec3 iShoe; attribute float iSeed;
float cheerA() { float id = iSeed; float keen = step(fract(id * 0.618), 0.78); return -uHype * keen * (2.35 + 0.45 * sin(uTime * 7.0 + id * 1.7)); }
vec3 armTurn(vec3 p, vec3 pv, float a) { vec3 d = p - pv; float c = cos(a), s = sin(a); return pv + vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c); }
`;

function material(hype, time) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, vertexColors: true });
  m.onBeforeCompile = sh => { sh.uniforms.uHype = hype; sh.uniforms.uTime = time;
    sh.vertexShader = HEAD + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  if (aArm.x > 0.5) objectNormal = armTurn(objectNormal, vec3(0.0), cheerA());')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  if (aArm.x > 0.5) transformed = armTurn(transformed, aArm.yzw, cheerA());
  if (aPart > 4.5 && aPart < 5.5 && iHair.w < 0.5) transformed = vec3(0.0, transformed.y, -0.02); /* (no long hair: folded away) */
  transformed.y += abs(sin(uTime * 6.0 + iSeed * 2.3)) * 0.07 * uHype;`)
      .replace('#include <color_vertex>', `vColor = aPart < 0.5 ? iTop : aPart < 1.5 ? iBot : aPart < 2.5 ? iSkin : aPart < 3.5 ? iHair.rgb : aPart < 4.5 ? iShoe : aPart < 5.5 ? iHair.rgb : aPart < 6.5 ? vec3(0.06) : iSkin * 0.55;`); };
  m.customProgramCacheKey = () => 'crowdfig';
  return m;
}

export function makeCrowd({ scene, spots, pose = 'sit', hype, time, tops, shoes = true, sectors = 12, mats = null }) {
  if (!spots.length) return { meshes: [], count: 0 };
  const base = figure(pose, shoes, false), near = figure(pose, shoes, true), mat = material(hype, time); if (mats) mats.push(mat);
  const groups = Array.from({ length: sectors }, () => []); spots.forEach((s, i) => groups[Math.min(sectors - 1, Math.floor((Math.atan2(s[2], s[0]) + Math.PI) / (Math.PI * 2) * sectors))].push(i));
  const M = new THREE.Matrix4(), Z = new THREE.Matrix4().makeScale(0, 0, 0), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), C = new THREE.Color(), meshes = [];
  // who's who: each person's colours (and a number for when they cheer), the same whichever shape they're drawn with
  const n0 = spots.length, TOP = new Float32Array(n0 * 3), BOT = new Float32Array(n0 * 3), SKN = new Float32Array(n0 * 3), HR = new Float32Array(n0 * 4), SH = new Float32Array(n0 * 3), SEED = new Float32Array(n0), MAT = [];
  const rgb = (arr, i, hex) => { C.set(hex); arr[i * 3] = C.r; arr[i * 3 + 1] = C.g; arr[i * 3 + 2] = C.b; };
  spots.forEach(([x, y, z, ry], si) => { const h = (si * 2654435761) >>> 0; MAT.push(new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromAxisAngle(Y, ry), ONE)); SEED[si] = si;
    rgb(TOP, si, tops[(si * 7 + (h >>> 5)) % tops.length]); rgb(BOT, si, BOTTOMS[(h >>> 9) % BOTTOMS.length]); const sk = SKIN[(h >>> 13) % SKIN.length]; rgb(SKN, si, sk);
    const bald = (h >>> 17) % 11 === 0; C.set(bald ? sk : HAIR[(h >>> 19) % HAIR.length]); HR[si * 4] = C.r; HR[si * 4 + 1] = C.g; HR[si * 4 + 2] = C.b; HR[si * 4 + 3] = !bald && (h >>> 23) % 10 < 3 ? 1 : 0; rgb(SH, si, SHOES[(h >>> 26) % SHOES.length]); });
  const KEYS = [['iTop', TOP, 3], ['iBot', BOT, 3], ['iSkin', SKN, 3], ['iHair', HR, 4], ['iShoe', SH, 3], ['iSeed', SEED, 1]];
  const shaped = (src, n) => { const g = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'aPart', 'aArm']) g.setAttribute(k, src.attributes[k]); /* (the shape is shared; only who's who differs) */
    for (const [k, , w] of KEYS) g.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(n * w), w)); if (!src.boundingSphere) { src.computeBoundingSphere(); src.boundingSphere.radius += 0.6; } g.boundingSphere = src.boundingSphere; return g; };
  const copy = (g, j, si) => { for (const [k, A, w] of KEYS) { const a = g.attributes[k].array; for (let q = 0; q < w; q++) a[j * w + q] = A[si * w + q]; } };
  const where = []; /* each person: [their slice's mesh, their place in it] */
  for (const list of groups) { if (!list.length) continue; const g = shaped(base, list.length), im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((si, j) => { im.setMatrixAt(j, MAT[si]); copy(g, j, si); where[si] = [im, j]; });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.boundingSphere.radius += 0.8; im.castShadow = im.receiveShadow = false; scene.add(im); meshes.push(im); }
  // the few people nearest the camera are drawn rounder, with faces (one more draw): picked again a few times a second,
  // and the plain copy of each of them is folded away meanwhile
  const K = 56, hg = shaped(near, K), hi = new THREE.InstancedMesh(hg, mat, K); hi.count = 0; hi.frustumCulled = false; hi.castShadow = hi.receiveShadow = false; scene.add(hi); meshes.push(hi);
  // and a stand-in gives up their seat to a real person sitting or standing there (people: [{ x, y, z }])
  let at = 0, shown = [], gone = new Set(); const D2 = new Float32Array(n0), order = new Int32Array(n0);
  const update = (camera, now, people) => { if (now - at < 300) return; at = now; const p = camera.position; let m = 0;
    const away = new Set(); for (const q of people || []) for (let i = 0; i < n0; i++) { const e = MAT[i].elements; if (Math.abs(e[12] - q.x) < 0.6 && Math.abs(e[14] - q.z) < 0.6 && Math.abs(e[13] - q.y) < 1.4) away.add(i); }
    for (let i = 0; i < n0; i++) { if (away.has(i)) continue; const e = MAT[i].elements, d = (e[12] - p.x) ** 2 + (e[13] - p.y) ** 2 + (e[14] - p.z) ** 2; if (d < 81) { D2[i] = d; order[m++] = i; } } /* (within 9 m) */
    const pick = Array.from(order.subarray(0, m)).sort((a, b) => D2[a] - D2[b]).slice(0, K);
    if (pick.length === shown.length && pick.every((v, i) => v === shown[i]) && away.size === gone.size && [...away].every(i => gone.has(i))) return;
    const touched = new Set(), plain = si => { const [im, j] = where[si]; im.setMatrixAt(j, MAT[si]); touched.add(im); }, fold = si => { const [im, j] = where[si]; im.setMatrixAt(j, Z); touched.add(im); };
    for (const si of shown) plain(si); for (const si of gone) plain(si); /* (back to plain, then folded again where needed) */
    for (const si of away) fold(si); pick.forEach((si, j) => { fold(si); hi.setMatrixAt(j, MAT[si]); copy(hg, j, si); });
    for (const im of touched) im.instanceMatrix.needsUpdate = true; hi.count = pick.length; hi.instanceMatrix.needsUpdate = true; for (const [k] of KEYS) hg.attributes[k].needsUpdate = true; shown = pick; gone = away; };
  return { meshes, count: spots.length, tris: base.attributes.position.count / 3, nearTris: near.attributes.position.count / 3, get near() { return hi.count; }, update };
}
