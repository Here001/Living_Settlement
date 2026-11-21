// The trains on the town's railways, in 3D: a modern electric multiple unit, cab cars at both ends and carriages between.
// Each car is a smooth body (its side profile extruded across its width with rounded edges, so no boxes: a sloping nose
// with a wrap-round windscreen on the cab cars), the livery painted on a small texture (window band, doors, the colour
// stripe, the cab window), and the running gear (bogies and wheels, skirts, roof units, the pantograph, the gangway
// bellows between cars) as one vertex-coloured mesh. The shapes are made once and shared by every train; each livery
// has its own two materials. A car is 3 draws (4 for a cab with its lights) and about 900 triangles.
//
// makeCar(kind, livery) kind: 'cab' (a driving car, its nose at +x) or 'mid'; livery: [main colour, second colour].
// Returns a THREE.Group with userData.lights (the headlight/tail-light mesh, to turn on at night).
import * as THREE from 'three';

export const CAR_LEN = 7.3, CAR_W = 2.8, FLOOR = 1.05, ROOF = 3.75; // metres; the car's middle is at 0,0 and its wheels on y = 0 (the rail top)
const geos = {}, mats = new Map(), BEV = 0.22;
function bodyShape(kind) { const L = CAR_LEN / 2 - BEV, F = FLOOR + BEV, R = ROOF - BEV, s = new THREE.Shape(); /* (drawn in by the rounded edge, which grows it back out) */
  s.moveTo(-L, F); s.lineTo(kind === 'cab' ? L - 0.55 : L, F);
  if (kind === 'cab') { s.quadraticCurveTo(L + 0.05, F + 0.05, L + 0.05, F + 0.75); /* the nose: rounded at the bottom, sloping back to the roof */
    s.quadraticCurveTo(L + 0.02, F + 1.3, L - 0.35, F + 1.7); s.quadraticCurveTo(L - 1.05, R - 0.05, L - 1.6, R); }
  else s.lineTo(L, R);
  s.lineTo(-L, R); s.lineTo(-L, F); return s; }

function body(kind) { if (geos['b' + kind]) return geos['b' + kind];
  const g = new THREE.ExtrudeGeometry(bodyShape(kind), { depth: CAR_W - 2 * BEV, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(CAR_W - 2 * BEV) / 2); g.computeVertexNormals();
  // the sides (the profile's two faces) take the livery texture: u along the car, v up it
  const P = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < P.count; i++) uv.setXY(i, (P.getX(i) + CAR_LEN / 2) / CAR_LEN, P.getY(i) / 4);
  return geos['b' + kind] = g; }

// everything else on a car, in one mesh with its colours in the vertices
function gear(kind) { if (geos['g' + kind]) return geos['g' + kind];
  const parts = [], put = (g, c, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); const n = g.attributes.position.count, col = new Float32Array(n * 3), C = new THREE.Color(c); for (let i = 0; i < n; i++) col.set([C.r, C.g, C.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(g.index ? g.toNonIndexed() : g); };
  const L = CAR_LEN / 2, dark = '#24272b', steel = '#5b6066';
  for (const bx of [-L + 1.5, L - 1.5]) { put(new THREE.BoxGeometry(2.3, 0.35, 2.0), dark, bx, 0.62, 0); /* a bogie: its frame and four wheels */
    for (const wx of [-0.75, 0.75]) for (const wz of [-0.72, 0.72]) put(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 12), steel, bx + wx, 0.42, wz, Math.PI / 2); }
  put(new THREE.BoxGeometry(CAR_LEN - 4.4, 0.42, CAR_W - 0.5), '#33373c', 0, FLOOR - 0.2, 0); /* the under-floor equipment between the bogies */
  put(new THREE.BoxGeometry(2.0, 0.32, 1.5), '#c9ccd0', kind === 'cab' ? -0.8 : 0.6, ROOF + 0.14, 0); /* the air-conditioning on the roof */
  if (kind === 'mid') { put(new THREE.BoxGeometry(0.9, 0.12, 0.9), dark, -1.6, ROOF + 0.06, 0); /* the pantograph: its base, the folding arms and the bow on the wire */
    put(new THREE.BoxGeometry(0.06, 0.06, 1.3), steel, -1.6, ROOF + 0.13, 0); put(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), steel, -1.2, ROOF + 0.75, 0, 0, 0, 0.75); put(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), steel, -1.35, ROOF + 1.3, 0, 0, 0, -0.9); put(new THREE.BoxGeometry(0.08, 0.06, 1.5), '#1f2226', -1.0, ROOF + 1.62, 0); }
  for (const e of kind === 'cab' ? [-1] : [-1, 1]) put(new THREE.BoxGeometry(0.34, 2.4, 1.6), '#1d1f22', e * (L + 0.12), FLOOR + 1.25, 0); /* the gangway bellows to the next car */
  if (kind === 'cab') { put(new THREE.BoxGeometry(0.5, 0.35, 2.3), '#2a2d31', L - 0.2, FLOOR - 0.05, 0); /* the coupler and the plough under the nose */
    // the windscreen, wrapping round the nose: a strip that follows the nose's own outline (from the shape), just outside it
    const pts = bodyShape('cab').getPoints(8).filter(p => p.x > CAR_LEN / 2 - 1.5 && p.y > FLOOR + 1.0 && p.y < ROOF - 0.45), pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 1)], b2 = pts[Math.min(pts.length - 1, i + 1)], tx = b2.x - a.x, ty = b2.y - a.y, l = Math.hypot(tx, ty) || 1, nx = ty / l, ny = -tx / l, o = BEV + 0.03, hw = CAR_W / 2 - 0.12;
      pos.push(pts[i].x + nx * o, pts[i].y + ny * o, -hw, pts[i].x + nx * o, pts[i].y + ny * o, hw); if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); } }
    if (pts.length > 1) { const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); sg.computeVertexNormals(); const nn = sg.attributes.position.count; sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nn * 3).fill(0.05), 3)); parts.push(sg.toNonIndexed()); } }
  const n = parts.reduce((t, g) => t + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { if (!g.attributes.normal) g.computeVertexNormals(); pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.computeBoundingSphere(); return geos['g' + kind] = out; }

// the cab's lights: two headlights and two tail lights each side of the nose (white at the front, red at the back: the
// page turns them round when the train changes direction by showing the other cab's)
function lights() { if (geos.l) return geos.l; const parts = []; const L = CAR_LEN / 2;
  for (const z of [-0.85, 0.85]) { const g = new THREE.BoxGeometry(0.06, 0.16, 0.34); g.translate(L + 0.02, FLOOR + 0.62, z); parts.push(g.toNonIndexed()); }
  const n = parts.reduce((t, g) => t + g.attributes.position.count, 0), pos = new Float32Array(n * 3); let o = 0; for (const g of parts) { pos.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); return geos.l = out; }

// the livery: the main colour, a window band (with door pairs and their windows), the stripe in the second colour
function liveryTex(kind, main, second) { const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d'), X = x => (x + CAR_LEN / 2) / CAR_LEN * 512, Y = y => 128 - y / 4 * 128;
  g.fillStyle = main; g.fillRect(0, 0, 512, 128); g.fillStyle = '#dfe3e6'; g.fillRect(0, Y(ROOF), 512, Y(ROOF - 0.35) - Y(ROOF)); /* (the roof edge, pale) */
  g.fillStyle = second; g.fillRect(0, Y(FLOOR + 0.55), 512, Y(FLOOR + 0.3) - Y(FLOOR + 0.55)); g.fillRect(0, Y(ROOF - 0.42), 512, 4);
  const win = (x0, x1, y0, y1) => { g.fillStyle = '#0f1820'; g.fillRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1)); g.fillStyle = 'rgba(150,190,220,.25)'; g.fillRect(X(x0) + 2, Y(y1) + 2, (X(x1) - X(x0)) * 0.35, (Y(y0) - Y(y1)) - 4); };
  const end = kind === 'cab' ? CAR_LEN / 2 - 1.9 : CAR_LEN / 2 - 0.4; win(-CAR_LEN / 2 + 0.4, end, FLOOR + 1.15, ROOF - 0.6); /* the window band */
  for (const dxx of [-1.55, 1.15]) { const x0 = dxx - 0.55, x1 = dxx + 0.55; g.fillStyle = second; g.fillRect(X(x0) - 3, Y(ROOF - 0.5), X(x1) - X(x0) + 6, Y(FLOOR + 0.05) - Y(ROOF - 0.5)); /* the doors: a pair, in the second colour, with tall windows */
    g.fillStyle = '#0f1820'; for (const xx of [x0 + 0.08, dxx + 0.04]) g.fillRect(X(xx), Y(ROOF - 0.7), X(xx + 0.42) - X(xx), Y(FLOOR + 1.0) - Y(ROOF - 0.7)); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(X(dxx) - 1, Y(ROOF - 0.5), 2, Y(FLOOR + 0.05) - Y(ROOF - 0.5)); }
  if (kind === 'cab') { g.fillStyle = '#0f1820'; g.fillRect(X(CAR_LEN / 2 - 1.55), Y(ROOF - 0.55), X(CAR_LEN / 2 - 0.85) - X(CAR_LEN / 2 - 1.55), Y(FLOOR + 1.25) - Y(ROOF - 0.55)); } /* the driver's side window */
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

function matsOf(kind, main, second) { const k = kind + main + second; let m = mats.get(k); if (m) return m;
  m = { side: new THREE.MeshStandardMaterial({ map: liveryTex(kind, main, second), roughness: 0.45, metalness: 0.15 }), shell: new THREE.MeshStandardMaterial({ color: main, roughness: 0.45, metalness: 0.15 }),
    gear: mats.get('gear') || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }) };
  mats.set('gear', m.gear); mats.set(k, m); return m; }
const LIGHT = { head: new THREE.MeshBasicMaterial({ color: '#fff6d8', toneMapped: false }), tail: new THREE.MeshBasicMaterial({ color: '#ff3a2a', toneMapped: false }) };

export function makeCar(kind, livery) { const [main, second] = livery || ['#C8382E', '#E6E1D6'], M = matsOf(kind, main, second), g = new THREE.Group();
  const b = new THREE.Mesh(body(kind), [M.side, M.shell]); b.castShadow = true; b.receiveShadow = true; g.add(b); /* (an extruded shape: its two faces the sides, the rest the roof, ends and nose) */
  const r = new THREE.Mesh(gear(kind), M.gear); g.add(r);
  if (kind === 'cab') { const l = new THREE.Mesh(lights(), LIGHT.head); g.add(l); g.userData.lights = l; }
  g.userData.kind = kind; return g; }
export const setFront = (car, front) => { const l = car.userData.lights; if (l) l.material = front ? LIGHT.head : LIGHT.tail; }; /* (a cab car leading shows white lights; trailing, red) */
export function dispose() { for (const g of Object.values(geos)) g.dispose(); for (const [k, m] of mats) if (k !== 'gear') { m.side.map.dispose(); m.side.dispose(); m.shell.dispose(); } const gm = mats.get('gear'); if (gm) gm.dispose(); mats.clear(); for (const k of Object.keys(geos)) delete geos[k]; }
