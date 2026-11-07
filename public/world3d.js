// The colony in 3D, for the mini games: the same buildings (type, size, colours, roofs, signs, awnings, height),
// streets, parks, trees and water as on the map, lit by the sun at the colony's time of day (lit windows and street
// lamps at night), with soft shadows, sky and haze.
//
// Built for phones: everything that doesn't move is merged into a handful of meshes (a few draw calls for a whole
// neighbourhood), shadows are drawn once and not every frame, textures are painted once and shared, the picture's
// resolution steps down by itself if a phone struggles, and nothing is drawn while the game is hidden.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BUILDING_TYPES, ROAD_TYPES } from '/shared/catalog.js';

const PHONE = matchMedia('(pointer: coarse)').matches;
const hashS = s => { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const rnd = seed => { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const col = c => new THREE.Color(c || '#cccccc');

// ---------------- textures, painted once ----------------
const TEX = {};
function canvasTex(key, size, paint, { repeat = true, srgb = true } = {}) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); paint(g, size);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return (TEX[key] = t);
}
function noise(g, n, a, b, alpha, r = Math.random) { for (let i = 0; i < a; i++) { g.fillStyle = `rgba(${b},${alpha * r()})`; const s = 1 + r() * n; g.fillRect(r() * 512, r() * 512, s, s); } }
// A facade: 4 window bays across, 4 floors up (it repeats every 14 m by 12.8 m). Light, so the building's own colour shows through.
function facade(kind) {
  return canvasTex('facade-' + kind, 512, (g, S) => {
    const r = rnd(hashS(kind)), bay = S / 4;
    g.fillStyle = kind === 'glass' ? '#9fb4c2' : '#f4f2ee'; g.fillRect(0, 0, S, S);
    if (kind === 'brick') { for (let y = 0; y < S; y += 10) for (let x = (y / 10) % 2 ? -10 : 0; x < S; x += 22) { g.fillStyle = `rgb(${220 + r() * 30 | 0},${215 + r() * 30 | 0},${208 + r() * 30 | 0})`; g.fillRect(x + 1, y + 1, 20, 8); } g.fillStyle = 'rgba(80,70,60,.25)'; for (let y = 0; y < S; y += 10) g.fillRect(0, y, S, 1); }
    else if (kind === 'panel') { g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * bay); g.lineTo(S, i * bay); g.stroke(); g.beginPath(); g.moveTo(i * bay, 0); g.lineTo(i * bay, S); g.stroke(); } }
    else if (kind !== 'glass') noise(g, 2, 2500, '0,0,0', 0.08, r);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
      const x = fx * bay, y = fy * bay;
      if (kind === 'glass') { const gr = g.createLinearGradient(x, y, x + bay, y + bay); gr.addColorStop(0, '#5d7486'); gr.addColorStop(0.5, '#a9c0cf'); gr.addColorStop(1, '#4b6172'); g.fillStyle = gr; g.fillRect(x + 3, y + 3, bay - 6, bay - 10); g.fillStyle = '#3a4650'; g.fillRect(x, y + bay - 7, bay, 7); continue; }
      const wx = x + bay * 0.24, wy = y + bay * 0.2, ww = bay * 0.52, wh = bay * 0.58;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 10); // the frame's shadow
      const gr = g.createLinearGradient(wx, wy, wx + ww, wy + wh); gr.addColorStop(0, '#41505c'); gr.addColorStop(0.55, '#7d93a3'); gr.addColorStop(1, '#33404a'); g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); g.fillRect(wx, wy + wh * 0.42, ww, 3); // the glazing bars
      g.fillStyle = '#d8d2c6'; g.fillRect(wx - 6, wy + wh, ww + 12, 6); // the sill
      if (r() < 0.35) { g.fillStyle = 'rgba(240,235,220,.9)'; g.fillRect(wx + 2, wy + 2, ww * 0.3, wh - 4); } // a curtain
    }
  });
}
// The same layout with some windows lit (used at night).
function facadeGlow(kind) {
  return canvasTex('glow-' + kind, 512, (g, S) => {
    const r = rnd(hashS(kind) + 7), bay = S / 4; g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) { if (r() > 0.42) continue; const x = fx * bay, y = fy * bay;
      g.fillStyle = r() < 0.7 ? '#ffcf8a' : '#cfe3ff';
      if (kind === 'glass') g.fillRect(x + 3, y + 3, bay - 6, bay - 10); else g.fillRect(x + bay * 0.24, y + bay * 0.2, bay * 0.52, bay * 0.58); }
  });
}
const ground = {
  grass: () => canvasTex('grass', 512, (g, S) => { g.fillStyle = '#6f9f4a'; g.fillRect(0, 0, S, S); const r = rnd(3); for (let i = 0; i < 9000; i++) { g.fillStyle = `hsla(${85 + r() * 30},${35 + r() * 25}%,${28 + r() * 22}%,.55)`; g.fillRect(r() * S, r() * S, 1.5, 3 + r() * 4); } }),
  paving: () => canvasTex('paving', 512, (g, S) => { g.fillStyle = '#c9c3b7'; g.fillRect(0, 0, S, S); const r = rnd(4); for (let y = 0; y < S; y += 64) for (let x = 0; x < S; x += 64) { const v = 195 + r() * 25 | 0; g.fillStyle = `rgb(${v},${v - 5},${v - 14})`; g.fillRect(x + 2, y + 2, 60, 60); } noise(g, 2, 3000, '0,0,0', 0.1, r); }),
  asphalt: () => canvasTex('asphalt', 512, (g, S) => { g.fillStyle = '#4c4d52'; g.fillRect(0, 0, S, S); const r = rnd(5); for (let i = 0; i < 16000; i++) { const v = 50 + r() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},.5)`; g.fillRect(r() * S, r() * S, 1.6, 1.6); } for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(20,20,22,.08)'; g.beginPath(); g.ellipse(r() * S, r() * S, 14 + r() * 30, 8 + r() * 18, r() * 3, 0, 7); g.fill(); } }),
  field: () => canvasTex('field', 512, (g, S) => { g.fillStyle = '#8a6a44'; g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += 32) { g.fillStyle = '#7da04a'; g.fillRect(0, y + 8, S, 14); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, y + 22, S, 3); } }),
  pitch: () => canvasTex('pitch', 512, (g, S) => { for (let x = 0; x < S; x += 64) { g.fillStyle = (x / 64) % 2 ? '#5f9e45' : '#6aab4d'; g.fillRect(x, 0, 64, S); } }),
  water: () => canvasTex('water', 512, (g, S) => { g.fillStyle = '#3b7ea6'; g.fillRect(0, 0, S, S); const r = rnd(6); for (let i = 0; i < 500; i++) { g.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.12})`; g.lineWidth = 1 + r() * 2; const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 4, x + 22, y); g.stroke(); } }),
  roof: () => canvasTex('roof', 256, (g, S) => { g.fillStyle = '#e8e6e2'; g.fillRect(0, 0, S, S); noise(g, 2, 5000, '0,0,0', 0.18, rnd(8)); }),
  tiles: () => canvasTex('tiles', 256, (g, S) => { g.fillStyle = '#efe9e4'; g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += 16) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, y + 13, S, 3); for (let x = (y / 16) % 2 ? 8 : 0; x < S; x += 16) g.fillRect(x, y, 1.5, 14); } }),
};

// ---------------- a geometry builder: quads and boxes, grouped by material, merged into one mesh each ----------------
class Bucket {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  quad(a, b, c, d, nrm, uv, color) { // corners a,b,c,d anticlockwise seen from the front
    const base = this.p.length / 3; for (const v of [a, b, c, d]) this.p.push(v[0], v[1], v[2]);
    for (let k = 0; k < 4; k++) { this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(color.r, color.g, color.b); }
    this.u.push(...uv); this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a, b, c, nrm, uv, color) { const base = this.p.length / 3; for (const v of [a, b, c]) this.p.push(v[0], v[1], v[2]); for (let k = 0; k < 3; k++) { this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(color.r, color.g, color.b); } this.u.push(...uv); this.i.push(base, base + 1, base + 2); }
  // a box from (x0,z0)-(x1,z1), y0 to y1; walls use metres for texture coordinates (scaled by su, sv)
  box(x0, z0, x1, z1, y0, y1, color, { su = 1, sv = 1, top = true, bottom = false, sides = true } = {}) {
    const W = x1 - x0, D = z1 - z0, H = y1 - y0;
    if (sides) {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [0, y0 / sv, W / su, y0 / sv, W / su, y1 / sv, 0, y1 / sv], color);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [0, y0 / sv, W / su, y0 / sv, W / su, y1 / sv, 0, y1 / sv], color);
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [0, y0 / sv, D / su, y0 / sv, D / su, y1 / sv, 0, y1 / sv], color);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [0, y0 / sv, D / su, y0 / sv, D / su, y1 / sv, 0, y1 / sv], color);
    }
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 / su, z1 / su, x1 / su, z1 / su, x1 / su, z0 / su, x0 / su, z0 / su], color);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], color);
  }
  geometry() { if (!this.i.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.i); g.computeBoundingSphere(); return g; }
}
// Any three.js geometry, baked into a bucket (moved, turned, coloured): for trees, cars, lamps and the like.
function bake(bucket, geo, { x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, color }) {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal, m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
  const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), base = bucket.p.length / 3;
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m); bucket.p.push(v.x, v.y, v.z); v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); bucket.n.push(v.x, v.y, v.z); bucket.u.push(0, 0); bucket.c.push(color.r, color.g, color.b); bucket.i.push(base + i); }
}
const GEO = { cyl: new THREE.CylinderGeometry(1, 1, 1, 10), cone: new THREE.ConeGeometry(1, 1, 9), ball: new THREE.IcosahedronGeometry(1, 1), box: new THREE.BoxGeometry(1, 1, 1), ring: new THREE.TorusGeometry(1, 0.08, 6, 24), half: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2) };

// ---------------- the view: renderer, sky, sun, camera ----------------
export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  const maxPR = Math.min(window.devicePixelRatio || 1, PHONE ? 1.5 : 2); let pr = maxPR; renderer.setPixelRatio(pr);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1, 0.5, 900);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); scene.environmentIntensity = 0.55;
  const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
  const U = sky.material.uniforms; U.turbidity.value = 6; U.rayleigh.value = 1.6; U.mieCoefficient.value = 0.004; U.mieDirectionalG.value = 0.82;
  const hemi = new THREE.HemisphereLight('#cfe3ff', '#5f6b4a', 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3df', 2.6); sun.castShadow = true; sun.shadow.mapSize.set(PHONE ? 1024 : 2048, PHONE ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; scene.add(sun, sun.target);
  scene.fog = new THREE.Fog('#c9d8e4', 120, 420);
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 1500 }, (_, i) => { const r = rnd(i + 1), a = r() * 6.28, e = 0.15 + r() * 1.3; return i % 3 === 0 ? 1500 * Math.cos(e) * Math.cos(a) : i % 3 === 1 ? 1500 * Math.sin(e) : 1500 * Math.cos(e) * Math.sin(a); }), 3)),
    new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 })); scene.add(stars);
  // the cut-away: walls between the camera and you are cut open, so a building never hides you
  const cut = { A: { value: new THREE.Vector3() }, B: { value: new THREE.Vector3() }, R: { value: 0 } };
  const view = { cut, renderer, scene, camera, sun, hemi, sky, stars, night: 0, mats: [], lamps: [], center: new THREE.Vector3(), span: 200, onFrame: null, running: false };
  // the time of day: the sun's height, the sky, and (after dark) lit windows and street lamps
  view.setTime = minute => {
    const dayT = ((minute % 1440) + 1440) % 1440 / 1440, ang = (dayT - 0.25) * Math.PI * 2, elev = Math.sin(ang); // sunrise 06:00, noon high, sunset 18:00
    const night = Math.max(0, Math.min(1, (-elev + 0.08) / 0.22)); view.night = night;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.max(0.12, elev), 0.55).normalize();
    U.sunPosition.value.copy(dir.clone().multiplyScalar(1000)); if (night > 0.5) U.sunPosition.value.set(0, -400, 1000);
    sun.position.copy(view.center).add(dir.clone().multiplyScalar(view.span)); sun.target.position.copy(view.center);
    sun.intensity = 2.8 * (1 - night) + 0.35 * night; sun.color.set(night > 0.5 ? '#9fb6ff' : elev < 0.25 ? '#ffc58f' : '#fff3df');
    hemi.intensity = 0.95 * (1 - night) + 0.28 * night; hemi.color.set(night > 0.5 ? '#40507a' : '#cfe3ff');
    renderer.toneMappingExposure = 1.0 - night * 0.35; scene.environmentIntensity = 0.55 * (1 - night) + 0.12 * night;
    scene.fog.color.set(night > 0.5 ? '#141b2b' : elev < 0.25 ? '#e7c9a8' : '#c9d8e4'); stars.material.opacity = night * 0.9; sky.visible = night < 0.98;
    if (night >= 0.98) scene.background = new THREE.Color('#0b1020'); else scene.background = null;
    for (const m of view.mats) if (m.userData.glow) m.emissiveIntensity = m.userData.glow * night;
    for (const m of view.mats) if (m.userData.pool) m.opacity = night;
    const s = sun.shadow.camera, h = view.span * 0.75; s.left = -h; s.right = h; s.top = h; s.bottom = -h; s.near = 1; s.far = view.span * 2.5; s.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
  };
  view.resize = () => { const box = canvas.parentElement || canvas, w = box.clientWidth || innerWidth, h = box.clientHeight || innerHeight; renderer.setSize(w, h, true); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  // the loop: steps down the resolution if frames run slow, and stops while the page is hidden
  let last = performance.now(), slow = 0, fast = 0;
  view.start = fn => { view.onFrame = fn; if (view.running) return; view.running = true;
    renderer.setAnimationLoop(now => { if (document.hidden) { last = now; return; } const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (dt > 0.026) { slow++; fast = 0; } else { fast++; slow = Math.max(0, slow - 1); }
      if (slow > 40 && pr > 0.75) { pr = Math.max(0.75, pr - 0.25); renderer.setPixelRatio(pr); view.resize(); slow = 0; }
      if (fast > 600 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.25); renderer.setPixelRatio(pr); view.resize(); fast = 0; }
      const t0 = performance.now(); view.onFrame && view.onFrame(dt, now); renderer.render(scene, camera); view.ms = (view.ms || 0) * 0.9 + (performance.now() - t0) * 0.1; view.frames = (view.frames || 0) + 1; }); };
  view.stop = () => { view.running = false; renderer.setAnimationLoop(null); };
  view.dispose = () => { view.stop(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); for (const m of view.mats) m.dispose(); renderer.dispose(); };
  view.resize(); return view;
}

// ---------------- materials ----------------
function cutAway(m, cut) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uCutA = cut.A; sh.uniforms.uCutB = cut.B; sh.uniforms.uCutR = cut.R;
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uCutA; uniform vec3 uCutB; uniform float uCutR; varying vec3 vWPos;\n' + sh.fragmentShader.replace('void main() {', `void main() {
      if (uCutR > 0.0 && vWPos.y > 0.7) { vec3 ab = uCutB - uCutA; float t = clamp(dot(vWPos - uCutA, ab) / dot(ab, ab), 0.0, 1.0); float d = length(vWPos - (uCutA + ab * t));
        float k = smoothstep(0.06, 0.3, t) * (1.0 - smoothstep(0.9, 0.99, t));
        if (d < uCutR * k) { vec2 q = mod(floor(gl_FragCoord.xy), 2.0); if (q.x + q.y != 1.0 || d < uCutR * k * 0.6) discard; } }`);
  };
  m.customProgramCacheKey = () => 'cutaway';
}
function materials(view) {
  if (view.M) return view.M;
  const std = (o, glow, cutaway) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...o }); if (cutaway) cutAway(m, view.cut); if (glow) { m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = 0; m.userData.glow = glow; } view.mats.push(m); return m; };
  view.M = {
    plaster: std({ map: facade('plaster'), emissiveMap: facadeGlow('plaster'), roughness: 0.85 }, 1.4, true),
    brick: std({ map: facade('brick'), emissiveMap: facadeGlow('brick'), roughness: 0.9 }, 1.4, true),
    panel: std({ map: facade('panel'), emissiveMap: facadeGlow('panel'), roughness: 0.8 }, 1.4, true),
    glass: std({ map: facade('glass'), emissiveMap: facadeGlow('glass'), roughness: 0.12, metalness: 0.75 }, 1.2, true),
    roof: std({ map: ground.roof(), roughness: 0.95 }, 0, true), tiles: std({ map: ground.tiles(), roughness: 0.8 }, 0, true),
    grass: std({ map: ground.grass(), roughness: 1 }), paving: std({ map: ground.paving(), roughness: 0.9 }), asphalt: std({ map: ground.asphalt(), roughness: 0.92 }),
    field: std({ map: ground.field(), roughness: 1 }), pitch: std({ map: ground.pitch(), roughness: 1 }),
    water: std({ map: ground.water(), roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.92 }),
    solid: std({ roughness: 0.75, flatShading: true }, 0, true), shiny: std({ roughness: 0.3, metalness: 0.5 }, 0, true),
    paint: std({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glow: std({ roughness: 1 }, 2.2),
  };
  // pools of lamplight on the ground: one soft spot texture, added on top, shown only after dark
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,214,150,.75)'); gr.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const pt = new THREE.CanvasTexture(c); pt.colorSpace = THREE.SRGBColorSpace;
  // contact shadows: the ground darkens softly where it meets a wall (cheap ambient occlusion)
  const ac = document.createElement('canvas'); ac.width = 4; ac.height = 64; const ag = ac.getContext('2d'), agr = ag.createLinearGradient(0, 0, 0, 64); agr.addColorStop(0, 'rgba(0,0,0,.55)'); agr.addColorStop(1, 'rgba(0,0,0,0)'); ag.fillStyle = agr; ag.fillRect(0, 0, 4, 64);
  const aot = new THREE.CanvasTexture(ac); aot.flipY = false; view.M.ao = new THREE.MeshBasicMaterial({ map: aot, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); view.mats.push(view.M.ao);
  view.M.pool = new THREE.MeshBasicMaterial({ map: pt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); view.M.pool.userData.pool = true; view.mats.push(view.M.pool);
  view.M.glow.userData.glow = 2.2; return view.M;
}
const isBrick = c => { const k = col(c); return k.r > k.g * 1.25 && k.r > 0.45 && k.g < 0.6; };
const darken = (c, f) => col(c).multiplyScalar(f);

// ---------------- the neighbourhood ----------------
// L: the play area from shared/arena.js (metres; x across, y down the map, which is z here).
export function buildArea(view, L, { cordon = true } = {}) {
  const M = materials(view), B = {}; for (const k of Object.keys(M)) B[k] = new Bucket();
  const r = rnd(L.seed || 1), TILE = 8, tw = L.tw, th = L.th, gAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= tw || ty >= th) ? -1 : L.ground.charCodeAt(ty * tw + tx) - 48;
  const roadSet = new Map([...L.roads, ...(L.sroads || [])].map(([x, y, t]) => [x + ',' + y, t])), isRoad = (x, y) => roadSet.has(x + ',' + y);
  view.center.set(tw * TILE / 2, 0, th * TILE / 2); view.span = Math.max(tw, th) * TILE * 0.8;
  // the ground, tile by tile, with the town carrying on beyond the edges
  const pad = 10;
  for (let ty = -pad; ty < th + pad; ty++) for (let tx = -pad; tx < tw + pad; tx++) {
    const k = gAt(tx, ty) >= 0 ? gAt(tx, ty) : isRoad(tx, ty) ? 2 : (L.swater || []).some(w => w[0] === tx && w[1] === ty) ? 3 : 0, x0 = tx * TILE, z0 = ty * TILE, x1 = x0 + TILE, z1 = z0 + TILE, b = k === 2 ? B.asphalt : k === 3 ? B.water : k === 4 ? B.field : k === 5 ? B.pitch : k === 1 ? B.paving : B.grass, y = k === 3 ? -0.35 : 0;
    const s = k === 2 ? 8 : 6; b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0 / s, z1 / s, x1 / s, z1 / s, x1 / s, z0 / s, x0 / s, z0 / s], col('#ffffff'));
    if (k === 3) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const n = gAt(tx + dx, ty + dy); if (n === 3) continue; // banks
      const ex0 = dx === 1 ? x1 : x0, ex1 = dx === -1 ? x0 : x1, ez0 = dy === 1 ? z1 : z0, ez1 = dy === -1 ? z0 : z1; if (dx) B.paving.box(ex0 - 0.3, z0, ex0 + 0.3, z1, -0.6, 0.15, col('#b9b2a3'), { su: 4, sv: 4 }); else B.paving.box(x0, ez0 - 0.3, x1, ez0 + 0.3, -0.6, 0.15, col('#b9b2a3'), { su: 4, sv: 4 }); }
  }
  // streets: pavements and kerbs where a street meets anything else, lane markings, and zebra crossings at junctions
  for (const [tx, ty, type] of [...L.roads, ...(L.sroads || [])]) {
    const R0 = ROAD_TYPES[type] || {}, x0 = tx * TILE, z0 = ty * TILE, n = { N: isRoad(tx, ty - 1), S: isRoad(tx, ty + 1), W: isRoad(tx - 1, ty), E: isRoad(tx + 1, ty) }, white = col('#f2f0e8'), yellow = col('#f2c94c');
    const kerb = (side) => { const w = 1.6, hgt = 0.14, c = col(R0.walk || '#d6d1c6');
      if (side === 'N') B.paving.box(x0, z0 - w, x0 + TILE, z0, 0, hgt, c, { su: 2, sv: 2 }); if (side === 'S') B.paving.box(x0, z0 + TILE, x0 + TILE, z0 + TILE + w, 0, hgt, c, { su: 2, sv: 2 });
      if (side === 'W') B.paving.box(x0 - w, z0, x0, z0 + TILE, 0, hgt, c, { su: 2, sv: 2 }); if (side === 'E') B.paving.box(x0 + TILE, z0, x0 + TILE + w, z0 + TILE, 0, hgt, c, { su: 2, sv: 2 }); };
    for (const s of ['N', 'S', 'W', 'E']) { const [dx, dy] = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[s]; if (!n[s] && gAt(tx + dx, ty + dy) !== 3) kerb(s); }
    if (R0.rail) { for (let i = 0; i < 8; i++) B.solid.box(x0 + (n.E || n.W ? i : 0.4), z0 + (n.E || n.W ? 3 : i), x0 + (n.E || n.W ? i + 0.4 : 7.6), z0 + (n.E || n.W ? 5 : i + 0.4), 0, 0.08, col('#6b5a48')); continue; }
    const ew = (n.E || n.W) && !n.N && !n.S, ns = (n.N || n.S) && !n.E && !n.W, y = 0.02;
    if (ew) for (let i = 0; i < 2; i++) { const a = x0 + 0.8 + i * 4; B.paint.quad([a, y, z0 + 4.08], [a + 2.2, y, z0 + 4.08], [a + 2.2, y, z0 + 3.92], [a, y, z0 + 3.92], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], R0.lanes ? white : yellow); }
    if (ns) for (let i = 0; i < 2; i++) { const a = z0 + 0.8 + i * 4; B.paint.quad([x0 + 3.92, y, a + 2.2], [x0 + 4.08, y, a + 2.2], [x0 + 4.08, y, a], [x0 + 3.92, y, a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], R0.lanes ? white : yellow); }
    const junction = (n.N || n.S) && (n.E || n.W);
    if (junction) for (const s of ['N', 'S', 'W', 'E']) { if (!n[s]) continue; for (let i = 0; i < 6; i++) { const a = 1 + i * 1.1;
      if (s === 'N') B.paint.quad([x0 + a, y, z0 + 1.6], [x0 + a + 0.55, y, z0 + 1.6], [x0 + a + 0.55, y, z0 + 0.2], [x0 + a, y, z0 + 0.2], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white);
      if (s === 'S') B.paint.quad([x0 + a, y, z0 + 7.8], [x0 + a + 0.55, y, z0 + 7.8], [x0 + a + 0.55, y, z0 + 6.4], [x0 + a, y, z0 + 6.4], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white);
      if (s === 'W') B.paint.quad([x0 + 0.2, y, z0 + a + 0.55], [x0 + 1.6, y, z0 + a + 0.55], [x0 + 1.6, y, z0 + a], [x0 + 0.2, y, z0 + a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white);
      if (s === 'E') B.paint.quad([x0 + 6.4, y, z0 + a + 0.55], [x0 + 7.8, y, z0 + a + 0.55], [x0 + 7.8, y, z0 + a], [x0 + 6.4, y, z0 + a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white); } }
    // street lamps along straight streets (they light up after dark)
    if ((ew || ns) && ((tx * 7 + ty * 13) % 3 === 0)) { const lx = ew ? x0 + 4 : (n.W ? x0 - 0.9 : x0 + TILE + 0.9), lz = ew ? (z0 + TILE + 0.9) : z0 + 4; lamp(B, view, lx, lz); }
  }
  // buildings and open spaces
  const front = b => { const tx0 = Math.floor(b.x / TILE), ty0 = Math.floor(b.y / TILE), tx1 = Math.floor((b.x + b.w) / TILE), ty1 = Math.floor((b.y + b.h) / TILE); let best = 'S', bv = -1;
    const sides = { S: [], N: [], E: [], W: [] }; for (let x = tx0; x <= tx1; x++) { sides.S.push(isRoad(x, ty1 + 1) || isRoad(x, ty1)); sides.N.push(isRoad(x, ty0 - 1)); } for (let y = ty0; y <= ty1; y++) { sides.E.push(isRoad(tx1 + 1, y) || isRoad(tx1, y)); sides.W.push(isRoad(tx0 - 1, y)); }
    for (const [k, v] of Object.entries(sides)) { const c = v.filter(Boolean).length; if (c > bv) { bv = c; best = k; } } return best; };
  for (const b of L.buildings) building(B, view, b, front(b), r);
  for (const b of L.scenery || []) building(B, view, b, 'S', r);
  // trees, cars, benches, lamps, fences, fountains, and the hiding places
  for (const p of L.props) prop(B, view, p, r);
  for (const s of L.spots) spot(B, s);
  // the play area is cordoned off with barriers, with the town carrying on beyond them
  if (cordon) { const W = tw * TILE, H = th * TILE, c1 = col('#e9e4d8'), c2 = col('#c8382e');
    for (let x = 0; x < W; x += 3) { B.solid.box(x + 0.2, -0.3, x + 2.8, 0.1, 0.6, 1.0, (x / 3) % 2 ? c1 : c2); B.solid.box(x + 0.2, H - 0.1, x + 2.8, H + 0.3, 0.6, 1.0, (x / 3) % 2 ? c1 : c2); B.solid.box(x + 0.3, -0.2, x + 0.5, 0, 0, 0.6, c1); B.solid.box(x + 0.3, H, x + 0.5, H + 0.2, 0, 0.6, c1); }
    for (let z = 0; z < H; z += 3) { B.solid.box(-0.3, z + 0.2, 0.1, z + 2.8, 0.6, 1.0, (z / 3) % 2 ? c1 : c2); B.solid.box(W - 0.1, z + 0.2, W + 0.3, z + 2.8, 0.6, 1.0, (z / 3) % 2 ? c1 : c2); } }
  // merge each bucket into one mesh
  const group = new THREE.Group();
  for (const [k, b] of Object.entries(B)) { const g = b.geometry(); if (!g) continue; const m = new THREE.Mesh(g, M[k]); m.castShadow = !['grass', 'asphalt', 'field', 'pitch', 'water', 'paint', 'pool', 'ao'].includes(k); if (k === 'pool' || k === 'ao') { m.renderOrder = 2; m.receiveShadow = false; } m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); if (k === 'water') view.water = m; }
  view.scene.add(group); view.area = group; renderer_shadow(view); return group;
}
function renderer_shadow(view) { view.renderer.shadowMap.needsUpdate = true; }

function lamp(B, view, x, z) {
  bake(B.shiny, GEO.cyl, { x, y: 2.6, z, sx: 0.09, sy: 5.2, sz: 0.09, color: col('#3a3f45') });
  bake(B.shiny, GEO.box, { x, y: 5.25, z, sx: 0.7, sy: 0.18, sz: 0.35, color: col('#3a3f45') });
  bake(B.glow, GEO.box, { x, y: 5.12, z, sx: 0.55, sy: 0.08, sz: 0.28, color: col('#fff2cc') });
  // a soft pool of light on the ground at night
  const R = 5, y = 0.05; B.pool.quad([x - R, y, z + R], [x + R, y, z + R], [x + R, y, z - R], [x - R, y, z - R], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col('#ffffff'));
}

function building(B, view, b, face, r) {
  const T = BUILDING_TYPES[b.type] || {}, C = T.colors || {}, x0 = b.x, z0 = b.y, x1 = b.x + b.w, z1 = b.y + b.h;
  if (b.outdoor) return; // open spaces are painted on the ground; their trees and benches are props
  const st = T.style || 'block', lvl = 1 + 0.15 * ((b.level || 1) - 1);
  const wallC = col(C.wall || '#e3dccf'), roofC = col(C.roof || '#8c8783'), trimC = col(C.trim || '#4e4a44');
  const kind = T.glass ? 'glass' : isBrick(C.wall) ? 'brick' : st === 'block' && (T.balcony || T.cat === 'housing') && (T.height || 0) > 60 ? 'panel' : 'plaster';
  const pitched = (st === 'house' || st === 'gabled' || st === 'tent' || st === 'stall' || st === 'windmill') && st !== 'block';
  let H = Math.max(3.2, (T.height || (pitched ? 18 : 26)) * 0.24 * lvl);
  if (st === 'sky' || st === 'needle' || st === 'twist' || st === 'tower' || st === 'lighthouse') H = Math.max(H, (T.height || 160) * 0.26);
  const wb = B[kind];
  wb.box(x0, z0, x1, z1, 0, H, wallC, { su: 14, sv: 12.8, top: false });
  // soft contact shadow on the ground around it
  { const a = 2.6, y = 0.03, w = col('#ffffff');
    B.ao.quad([x0, y, z1], [x1, y, z1], [x1 + a, y, z1 + a], [x0 - a, y, z1 + a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
    B.ao.quad([x1, y, z0], [x0, y, z0], [x0 - a, y, z0 - a], [x1 + a, y, z0 - a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
    B.ao.quad([x1, y, z1], [x1, y, z0], [x1 + a, y, z0 - a], [x1 + a, y, z1 + a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
    B.ao.quad([x0, y, z0], [x0, y, z1], [x0 - a, y, z1 + a], [x0 - a, y, z0 - a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w); }
  // the base: a darker plinth
  B.solid.box(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, 0, 0.5, darken(C.wall || '#e3dccf', 0.6), { top: false });
  const fx = face === 'E' ? x1 : face === 'W' ? x0 : (x0 + x1) / 2, fz = face === 'S' ? z1 : face === 'N' ? z0 : (z0 + z1) / 2, out = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[face], along = out[0] ? [0, 1] : [1, 0];
  const at = (u, y, o = 0.05) => [fx + along[0] * u + out[0] * o, y, fz + along[1] * u + out[1] * o];
  const plane = (bucket, u0, u1, y0, y1, o, color) => { const a = at(u0, y0, o), b2 = at(u1, y0, o), c = at(u1, y1, o), d = at(u0, y1, o); if ((face === 'S') || (face === 'W')) bucket.quad(a, b2, c, d, [out[0], 0, out[1]], [0, 0, 1, 0, 1, 1, 0, 1], color); else bucket.quad(b2, a, d, c, [out[0], 0, out[1]], [0, 0, 1, 0, 1, 1, 0, 1], color); };
  // the front door
  plane(B.solid, -0.9, 0.9, 0, 2.4, 0.06, col('#3a2a1e')); plane(B.solid, -1.1, 1.1, 2.4, 2.6, 0.07, trimC);
  // an awning over the shop front
  if (T.awning) { const c = col(T.awning), len = Math.min(b.w, b.h) * 0.4; const a1 = at(-len, 3.0, 0.05), a2 = at(len, 3.0, 0.05), a3 = at(len, 2.5, 1.6), a4 = at(-len, 2.5, 1.6);
    B.solid.quad(...((face === 'S' || face === 'W') ? [a4, a3, a2, a1] : [a3, a4, a1, a2]), [out[0] * 0.3, 0.95, out[1] * 0.3], [0, 0, 1, 0, 1, 1, 0, 1], c); }
  // a sign with the name (POLICE, CASINO, MARKET…), lit at night if it's neon
  if (T.label) sign(view, T.label, T.sign || trimC.getStyle(), !!T.neon, at(0, Math.min(H - 0.8, 4.6), 0.12), face);
  // the roof
  if (pitched) {
    const rh = Math.max(2.2, (T.roofH || 14) * 0.2), alongX = (x1 - x0) >= (z1 - z0), o = 0.5;
    const X0 = x0 - o, X1 = x1 + o, Z0 = z0 - o, Z1 = z1 + o, rc = roofC;
    if (alongX) { const zm = (z0 + z1) / 2; B.tiles.quad([X0, H, Z1], [X1, H, Z1], [X1, H + rh, zm], [X0, H + rh, zm], [0, 0.7, 0.7], [0, 0, (X1 - X0) / 4, 0, (X1 - X0) / 4, 2, 0, 2], rc);
      B.tiles.quad([X1, H, Z0], [X0, H, Z0], [X0, H + rh, zm], [X1, H + rh, zm], [0, 0.7, -0.7], [0, 0, (X1 - X0) / 4, 0, (X1 - X0) / 4, 2, 0, 2], rc);
      wb.tri([x0, H, z0], [x0, H, z1], [x0, H + rh, zm], [-1, 0, 0], [0, H / 12.8, (z1 - z0) / 14, H / 12.8, (z1 - z0) / 28, (H + rh) / 12.8], wallC); wb.tri([x1, H, z1], [x1, H, z0], [x1, H + rh, zm], [1, 0, 0], [0, H / 12.8, (z1 - z0) / 14, H / 12.8, (z1 - z0) / 28, (H + rh) / 12.8], wallC); }
    else { const xm = (x0 + x1) / 2; B.tiles.quad([X1, H, Z1], [X1, H, Z0], [xm, H + rh, Z0], [xm, H + rh, Z1], [0.7, 0.7, 0], [0, 0, (Z1 - Z0) / 4, 0, (Z1 - Z0) / 4, 2, 0, 2], rc);
      B.tiles.quad([X0, H, Z0], [X0, H, Z1], [xm, H + rh, Z1], [xm, H + rh, Z0], [-0.7, 0.7, 0], [0, 0, (Z1 - Z0) / 4, 0, (Z1 - Z0) / 4, 2, 0, 2], rc);
      wb.tri([x1, H, z0], [x0, H, z0], [xm, H + rh, z0], [0, 0, -1], [0, H / 12.8, (x1 - x0) / 14, H / 12.8, (x1 - x0) / 28, (H + rh) / 12.8], wallC); wb.tri([x0, H, z1], [x1, H, z1], [xm, H + rh, z1], [0, 0, 1], [0, H / 12.8, (x1 - x0) / 14, H / 12.8, (x1 - x0) / 28, (H + rh) / 12.8], wallC); }
    if (T.chimney) { const cx = x0 + (x1 - x0) * 0.72, cz = z0 + (z1 - z0) * 0.3; B.brick.box(cx - 0.45, cz - 0.45, cx + 0.45, cz + 0.45, H, H + rh + 1.1, col('#a9573f'), { su: 14, sv: 12.8 }); }
  } else {
    // a flat roof with a parapet, and plant on top of the bigger ones
    B.roof.box(x0, z0, x1, z1, H - 0.01, H, roofC, { su: 6, sv: 6, sides: false });
    const p = 0.35, ph = 0.9; for (const [a, bb, c, d] of [[x0, z0, x1, z0 + p], [x0, z1 - p, x1, z1], [x0, z0, x0 + p, z1], [x1 - p, z0, x1, z1]]) B.solid.box(a, bb, c, d, H, H + ph, darken(C.roof || '#8c8783', 0.85));
    if (T.mansard) B.tiles.box(x0 + 1, z0 + 1, x1 - 1, z1 - 1, H, H + 3, roofC, { su: 4, sv: 2 });
    if (H > 10) for (let k = 0; k < Math.min(4, Math.floor(b.w * b.h / 60)); k++) { const ux = x0 + 2 + r() * (b.w - 5), uz = z0 + 2 + r() * (b.h - 5); B.shiny.box(ux, uz, ux + 1.6, uz + 1.2, H, H + 1.1, col('#b8bcc0')); }
    if (st === 'dome' || st === 'globe' || st === 'atom') bake(B.shiny, GEO.half, { x: (x0 + x1) / 2, y: H, z: (z0 + z1) / 2, sx: Math.min(b.w, b.h) * 0.42, sy: Math.min(b.w, b.h) * 0.42, sz: Math.min(b.w, b.h) * 0.42, color: roofC });
    if (st === 'factory') { for (let k = 0; k < (T.chimneys || 1); k++) bake(B.brick, GEO.cyl, { x: x0 + 2 + k * 3, y: H + 5, z: z0 + 2, sx: 0.9, sy: 10, sz: 0.9, color: col('#8a4a3a') }); }
    if (T.balcony) { const bc = col(T.balcony); for (let y = 3.2; y < H - 2; y += 3.2) for (let u = -b.w / 2 + 2; u < b.w / 2 - 2; u += 3.5) { if (face === 'S' || face === 'N') B.solid.box(fx + u - 1.2, fz + (face === 'S' ? 0 : -0.9), fx + u + 1.2, fz + (face === 'S' ? 0.9 : 0), y, y + 1.0, bc); } }
    if (st === 'sky' || H > 30) bake(B.glow, GEO.ball, { x: (x0 + x1) / 2, y: H + (st === 'needle' ? 12 : 3), z: (z0 + z1) / 2, sx: 0.25, sy: 0.25, sz: 0.25, color: col('#ff4b3a') }); // an aircraft warning light
    if (st === 'needle') bake(B.shiny, GEO.cyl, { x: (x0 + x1) / 2, y: H + 6, z: (z0 + z1) / 2, sx: 0.2, sy: 12, sz: 0.2, color: col('#cfd3d6') });
  }
}
// A sign: lettering painted onto a board, glowing at night if it's neon.
function sign(view, text, bg, neon, pos, face) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 116);
  g.font = '900 78px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = neon ? '#ffe9a8' : '#ffffff'; if (neon) { g.shadowColor = '#ffcf4a'; g.shadowBlur = 24; } g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: new THREE.Color('#ffffff'), emissiveMap: t, emissiveIntensity: neon ? 0.35 : 0.0 }); m.userData.glow = neon ? 1.6 : 0.5; view.mats.push(m);
  const w = Math.min(6, 0.9 * text.length + 1.2), mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), m);
  mesh.position.set(pos[0], pos[1], pos[2]); mesh.rotation.y = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[face]; view.scene.add(mesh);
}
function tree(B, x, z, s, leaf, kind, r) {
  const lc = col(leaf), trunk = col('#6b4a32');
  if (kind === 'pine') { bake(B.solid, GEO.cyl, { x, y: 1.2 * s, z, sx: 0.22 * s, sy: 2.4 * s, sz: 0.22 * s, color: trunk }); for (let i = 0; i < 3; i++) bake(B.solid, GEO.cone, { x, y: (2.6 + i * 1.6) * s, z, sx: (2.3 - i * 0.6) * s, sy: 2.6 * s, sz: (2.3 - i * 0.6) * s, color: lc.clone().multiplyScalar(0.85 + i * 0.08) }); return; }
  if (kind === 'palm') { bake(B.solid, GEO.cyl, { x, y: 3 * s, z, sx: 0.2 * s, sy: 6 * s, sz: 0.2 * s, color: col('#8a6a48') }); for (let i = 0; i < 6; i++) bake(B.solid, GEO.box, { x: x + Math.cos(i) * 1.4 * s, y: 6 * s, z: z + Math.sin(i) * 1.4 * s, ry: -i, sx: 3 * s, sy: 0.12 * s, sz: 0.7 * s, color: lc }); return; }
  if (kind === 'poplar') { bake(B.solid, GEO.cyl, { x, y: 1 * s, z, sx: 0.2 * s, sy: 2 * s, sz: 0.2 * s, color: trunk }); bake(B.solid, GEO.ball, { x, y: 4.6 * s, z, sx: 1.4 * s, sy: 3.8 * s, sz: 1.4 * s, color: lc }); return; }
  bake(B.solid, GEO.cyl, { x, y: 1.4 * s, z, sx: 0.26 * s, sy: 2.8 * s, sz: 0.26 * s, color: trunk });
  for (let i = 0; i < 4; i++) { const a = r() * 6.28, d = i ? 0.9 * s : 0; bake(B.solid, GEO.ball, { x: x + Math.cos(a) * d, y: (3.6 + r() * 1.2) * s, z: z + Math.sin(a) * d, sx: (1.5 + r() * 0.6) * s, sy: (1.3 + r() * 0.5) * s, sz: (1.5 + r() * 0.6) * s, color: lc.clone().multiplyScalar(0.85 + r() * 0.3) }); }
}
function car(B, x, z, ang, c) {
  const body = col(c), glass = col('#26313b'), tyre = col('#1b1c1e'), ca = Math.cos(ang), sa = Math.sin(ang), P = (u, v) => [x + u * ca - v * sa, z + u * sa + v * ca];
  bake(B.shiny, GEO.box, { x, y: 0.75, z, ry: -ang, sx: 1.8, sy: 0.75, sz: 4.2, color: body });
  bake(B.shiny, GEO.box, { x: P(0, 0.2)[0], y: 1.4, z: P(0, 0.2)[1], ry: -ang, sx: 1.6, sy: 0.6, sz: 2.2, color: glass });
  for (const [u, v] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) { const [px, pz] = P(u, v); bake(B.solid, GEO.cyl, { x: px, y: 0.36, z: pz, ry: -ang, sx: 0.36, sy: 0.25, sz: 0.36, color: tyre }); }
}
function prop(B, view, p, r) {
  const k = p.k;
  if (k === 'tree' || k === 'pine' || k === 'palm' || k === 'poplar') return tree(B, p.x, p.y, p.s || 1, p.c, k, r);
  if (k === 'car') return car(B, p.x, p.y, p.ang || 0, p.c);
  if (k === 'lamp') return lamp(B, view, p.x, p.y);
  if (k === 'bench' || k === 'bistro') { B.solid.box(p.x - 1, p.y - 0.25, p.x + 1, p.y + 0.25, 0.45, 0.55, col('#8a5a33')); B.solid.box(p.x - 1, p.y + 0.2, p.x + 1, p.y + 0.3, 0.55, 1.0, col('#8a5a33')); B.shiny.box(p.x - 0.9, p.y - 0.2, p.x - 0.8, p.y + 0.2, 0, 0.45, col('#2b2f33')); B.shiny.box(p.x + 0.8, p.y - 0.2, p.x + 0.9, p.y + 0.2, 0, 0.45, col('#2b2f33')); return; }
  if (k === 'fence') { const c = col(p.c); B.solid.box(p.x - 4, p.y - 0.06, p.x + 4, p.y + 0.06, 0.5, 0.65, c); B.solid.box(p.x - 4, p.y - 0.06, p.x + 4, p.y + 0.06, 0.9, 1.05, c); for (let i = -4; i <= 4; i += 1) B.solid.box(p.x + i - 0.06, p.y - 0.08, p.x + i + 0.06, p.y + 0.08, 0, 1.2, c); return; }
  if (k === 'fountain') { bake(B.paving, GEO.cyl, { x: p.x, y: 0.35, z: p.y, sx: 2.6, sy: 0.7, sz: 2.6, color: col('#cfc9bb') }); bake(B.water, GEO.cyl, { x: p.x, y: 0.62, z: p.y, sx: 2.3, sy: 0.1, sz: 2.3, color: col('#ffffff') }); bake(B.paving, GEO.cyl, { x: p.x, y: 1.4, z: p.y, sx: 0.35, sy: 2, sz: 0.35, color: col('#cfc9bb') }); bake(B.paving, GEO.cyl, { x: p.x, y: 2.4, z: p.y, sx: 1, sy: 0.2, sz: 1, color: col('#cfc9bb') }); return; }
  if (k === 'hydrant') { bake(B.shiny, GEO.cyl, { x: p.x, y: 0.4, z: p.y, sx: 0.2, sy: 0.8, sz: 0.2, color: col('#c8382e') }); return; }
  if (k === 'mailbox') { B.shiny.box(p.x - 0.3, p.y - 0.3, p.x + 0.3, p.y + 0.3, 0, 1.2, col('#c8382e')); return; }
  if (k === 'phone') { B.glass.box(p.x - 0.55, p.y - 0.55, p.x + 0.55, p.y + 0.55, 0, 2.4, col('#c8382e'), { su: 4, sv: 4 }); return; }
  if (k === 'kiosk') { B.solid.box(p.x - 1.2, p.y - 1, p.x + 1.2, p.y + 1, 0, 2.4, col('#2f5d4a')); B.solid.box(p.x - 1.5, p.y - 1.3, p.x + 1.5, p.y + 1.3, 2.4, 2.6, col('#c8382e')); return; }
  if (k === 'busstop') { B.glass.box(p.x - 1.6, p.y - 0.5, p.x + 1.6, p.y + 0.5, 0, 2.5, col('#9fb4c2'), { su: 4, sv: 4 }); B.solid.box(p.x - 1.8, p.y - 0.8, p.x + 1.8, p.y + 0.8, 2.5, 2.7, col('#2f4a7a')); return; }
  if (k === 'planter') { B.solid.box(p.x - 0.6, p.y - 0.6, p.x + 0.6, p.y + 0.6, 0, 0.6, col('#8c7b66')); bake(B.solid, GEO.ball, { x: p.x, y: 0.9, z: p.y, sx: 0.6, sy: 0.5, sz: 0.6, color: col('#4e8f3a') }); return; }
  B.solid.box(p.x - 0.4, p.y - 0.4, p.x + 0.4, p.y + 0.4, 0, 1, col('#8c8783'));
}
function spot(B, s) {
  if (s.k === 'bush') { for (let i = 0; i < 4; i++) bake(B.solid, GEO.ball, { x: s.x + Math.cos(i * 1.7) * 0.7, y: 0.7, z: s.y + Math.sin(i * 1.7) * 0.7, sx: 1.1, sy: 0.9, sz: 1.1, color: col(i % 2 ? '#3f7d32' : '#4e8f3a') }); return; }
  if (s.k === 'bin') { bake(B.shiny, GEO.box, { x: s.x, y: 0.75, z: s.y, sx: 1.3, sy: 1.5, sz: 1.0, color: col('#2f6b4a') }); bake(B.shiny, GEO.box, { x: s.x, y: 1.56, z: s.y, sx: 1.4, sy: 0.12, sz: 1.1, color: col('#244f38') }); return; }
  if (s.k === 'crate') { B.solid.box(s.x - 0.75, s.y - 0.75, s.x + 0.75, s.y + 0.75, 0, 1.5, col('#a9743f')); B.solid.box(s.x - 0.55, s.y - 0.55, s.x + 0.55, s.y + 0.55, 1.5, 2.4, col('#9a6a38')); return; }
  if (s.k === 'booth') return;
  // a doorway: a dark recess with a step
  const f = s.face || [0, 1], x = s.x + f[0] * 0.9, z = s.y + f[1] * 0.9;
  if (f[0]) B.solid.box(x - 0.08, z - 0.9, x + 0.08, z + 0.9, 0, 2.6, col('#2a2420')); else B.solid.box(x - 0.9, z - 0.08, x + 0.9, z + 0.08, 0, 2.6, col('#2a2420'));
  B.paving.box(s.x - 0.9, s.y - 0.9, s.x + 0.9, s.y + 0.9, 0, 0.12, col('#bdb6a8'), { su: 2, sv: 2 });
}

// ---------------- people ----------------
// A low-poly person with a walk: legs and arms swing with their speed, they lean into a run, and turn smoothly.
const MATS = new Map(); const pmat = c => { let m = MATS.get(c); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }); MATS.set(c, m); } return m; };
const SKIN = ['#8d5524', '#c68642', '#e0ac69', '#5c3a21', '#a0663d'], SHIRT = ['#2f5d9e', '#3c8a5a', '#e2b13c', '#8e44ad', '#d35d6e', '#2ec4b6', '#f2994a', '#7f8c8d', '#c0392b'], TROUSERS = ['#2b2f33', '#3b4a63', '#5c4a3b', '#4a4a4a', '#26313b'];
export function makePerson(seed, role) {
  const h = hashS(seed), skin = SKIN[h % SKIN.length], uniform = role === 'hunter' || role === 'seeker';
  const shirt = uniform ? (role === 'hunter' ? '#1e2a44' : '#3a4a2a') : SHIRT[(h >>> 3) % SHIRT.length], legs = uniform ? '#16203a' : TROUSERS[(h >>> 7) % TROUSERS.length];
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const part = (geo, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(geo, pmat(m)); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = false; return o; };
  const limb = (m, x, y, len, w) => { const pivot = new THREE.Group(); pivot.position.set(x, y, 0); const l = part(GEO.box, m, 0, -len / 2, 0, w, len, w); pivot.add(l); return pivot; };
  const legL = limb(legs, -0.14, 0.92, 0.9, 0.17), legR = limb(legs, 0.14, 0.92, 0.9, 0.17); body.add(legL, legR);
  for (const leg of [legL, legR]) leg.add(part(GEO.box, '#1b1c1e', 0, -0.88, 0.06, 0.18, 0.1, 0.3));
  const torso = part(GEO.box, shirt, 0, 1.22, 0, 0.5, 0.62, 0.28); body.add(torso);
  const armL = limb(shirt, -0.32, 1.5, 0.66, 0.13), armR = limb(shirt, 0.32, 1.5, 0.66, 0.13); body.add(armL, armR);
  for (const arm of [armL, armR]) arm.add(part(GEO.ball, skin, 0, -0.7, 0, 0.08, 0.08, 0.08));
  const head = part(GEO.ball, skin, 0, 1.72, 0, 0.17, 0.2, 0.18); body.add(head);
  body.add(part(GEO.half, uniform ? '#16203a' : ['#1b1b1b', '#4a2e1c', '#8a5a2b', '#2b2b2b'][(h >>> 11) % 4], 0, 1.76, 0, 0.18, 0.13, 0.19));
  if (role === 'hunter') { body.add(part(GEO.cyl, '#16203a', 0, 1.9, 0.02, 0.2, 0.08, 0.2)); body.add(part(GEO.box, '#111', 0, 1.88, 0.18, 0.2, 0.03, 0.1)); body.add(part(GEO.box, '#f2c94c', 0, 1.93, 0.17, 0.05, 0.05, 0.02)); body.add(part(GEO.box, '#d9ff3a', 0, 1.3, 0.15, 0.52, 0.12, 0.02)); }
  let torch = null;
  if (role === 'seeker') { torch = part(GEO.cyl, '#2b2b2b', 0, -0.65, 0.12, 0.05, 0.25, 0.05); torch.rotation.x = Math.PI / 2; armR.add(torch);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.rotation.x = -Math.PI / 2; beam.position.set(0.32, 1.0, 4.7); beam.visible = false; g.add(beam); torch.userData.beam = beam; }
  // a soft shadow under their feet (cheaper than real shadows for people who keep moving)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob);
  let phase = 0, heading = 0;
  const P = { group: g, body, head, torch, role, x: 0, z: 0,
    setPos(x, z) { this.x = x; this.z = z; g.position.set(x, 0, z); },
    // speed in m/s; turns towards where they're going
    animate(dt, vx, vz) { const sp = Math.hypot(vx, vz); if (sp > 0.3) { const want = Math.atan2(vx, vz); let d = want - heading; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; heading += d * Math.min(1, dt * 12); }
      g.rotation.y = heading; phase += dt * (2 + sp * 1.6); const sw = Math.min(1, sp / 6) * 0.9, s = Math.sin(phase) * sw;
      legL.rotation.x = s; legR.rotation.x = -s; armL.rotation.x = -s * 0.9; armR.rotation.x = torch ? -1.2 : s * 0.9;
      body.position.y = Math.abs(Math.cos(phase)) * 0.06 * Math.min(1, sp / 3); body.rotation.x = Math.min(0.25, sp * 0.03); }
  };
  return P;
}
// A name over someone's head.
export function nameTag(text, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 24); g.fillStyle = 'rgba(20,18,16,.62)'; g.beginPath(); if (g.roundRect) g.roundRect(128 - w / 2, 10, w, 44, 22); else g.rect(128 - w / 2, 10, w, 44); g.fill(); g.fillStyle = color; g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(2.4, 0.6, 1); s.renderOrder = 10; return s;
}
export { THREE };

// ---------------- the getaway: a straight road out of town, lined with the colony's own kinds of buildings ----------------
// The road runs away from the camera (towards -z). `types` are building types to line it with (the town's own).
// Built in 150 m pieces, so only the stretch in front of the car is drawn.
export const LANE = 3.7;
export function buildRoadTrip(view, { length, seed = 1, types = [] }) {
  const M = materials(view), r = rnd(seed), group = new THREE.Group(), CH = 150, half = LANE * 1.5, walk = 4;
  const pool = types.filter(t => BUILDING_TYPES[t] && !BUILDING_TYPES[t].outdoor && BUILDING_TYPES[t].style !== 'tent'); if (!pool.length) pool.push('house', 'brickflats', 'cafe', 'office', 'apartment', 'bakery', 'glassoffice', 'tavern', 'grocer');
  view.center.set(0, 0, -60); view.span = 160;
  for (let z0 = 60; z0 > -length - 300; z0 -= CH) {
    const B = {}; for (const k of Object.keys(M)) B[k] = new Bucket(); const z1 = z0 - CH, w = col('#ffffff');
    // the road, its lines, pavements and grass verges
    B.asphalt.quad([-half, 0, z0], [half, 0, z0], [half, 0, z1], [-half, 0, z1], [0, 1, 0], [-half / 8, z0 / 8, half / 8, z0 / 8, half / 8, z1 / 8, -half / 8, z1 / 8], w);
    for (const sx of [-1, 1]) { B.paving.box(sx < 0 ? -half - walk : half, z1, sx < 0 ? -half : half + walk, z0, 0, 0.16, col('#d6d1c6'), { su: 2, sv: 2 });
      B.grass.quad(sx < 0 ? [-260, 0, z0] : [half + walk, 0, z0], sx < 0 ? [-half - walk, 0, z0] : [260, 0, z0], sx < 0 ? [-half - walk, 0, z1] : [260, 0, z1], sx < 0 ? [-260, 0, z1] : [half + walk, 0, z1], [0, 1, 0], [0, 0, 30, 0, 30, 20, 0, 20], w);
      B.paint.quad([sx * half - 0.25 * sx - 0.08, 0.02, z0], [sx * half - 0.25 * sx + 0.08, 0.02, z0], [sx * half - 0.25 * sx + 0.08, 0.02, z1], [sx * half - 0.25 * sx - 0.08, 0.02, z1], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w); }
    for (const lx of [-LANE / 2, LANE / 2]) for (let z = z0; z > z1; z -= 9) B.paint.quad([lx - 0.08, 0.02, z], [lx + 0.08, 0.02, z], [lx + 0.08, 0.02, z - 4], [lx - 0.08, 0.02, z - 4], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
    for (let z = z0 - 10; z > z1; z -= 32) { lamp(B, view, -half - 0.9, z); lamp(B, view, half + 0.9, z - 16); }
    // the buildings either side, facing the road
    for (const sx of [-1, 1]) { let z = z0 - r() * 6;
      while (z > z1) { const t = pool[Math.floor(r() * pool.length)], T = BUILDING_TYPES[t], wide = Math.min(3, T.size[0]) * 8 - 2.4, deep = Math.min(3, T.size[1]) * 8 - 2.4, gap = 2 + r() * 5;
        if (r() < 0.14) { for (let k = 0; k < 3; k++) tree(B, sx * (half + walk + 3 + r() * 8), z - 3 - k * 5, 0.9 + r() * 0.4, ['#6FAE45', '#5E9E45', '#7DB656'][k], 'tree', r); z -= 18; continue; }
        const x0 = sx < 0 ? -half - walk - 1.5 - deep : half + walk + 1.5;
        building(B, view, { type: t, x: x0, y: z - wide, w: deep, h: wide, level: 1 + Math.floor(r() * 2) }, sx < 0 ? 'E' : 'W', r);
        z -= wide + gap; } }
    const g = new THREE.Group();
    for (const [k, b] of Object.entries(B)) { const geo = b.geometry(); if (!geo) continue; const m = new THREE.Mesh(geo, M[k]); m.castShadow = !['grass', 'asphalt', 'paint', 'pool', 'ao'].includes(k); m.receiveShadow = !['pool', 'ao'].includes(k); if (k === 'pool' || k === 'ao') m.renderOrder = 2; m.matrixAutoUpdate = false; g.add(m); }
    group.add(g);
  }
  view.scene.add(group); return group;
}
// A car you'd recognise: body, cabin and glass, wheels, lights. kind: car, van, bus, police, getaway.
export function makeCar(kind = 'car', color = '#c8382e') {
  const g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: kind === 'police' ? '#f4f4f0' : color, roughness: 0.25, metalness: 0.6 }), dark = pmat('#1b1c1e'), glassM = new THREE.MeshStandardMaterial({ color: '#4a6274', roughness: 0.08, metalness: 0.85 });
  const len = kind === 'bus' ? 11 : kind === 'van' ? 5.6 : 4.4, wid = kind === 'bus' ? 2.5 : 1.9, hgt = kind === 'bus' ? 2.6 : kind === 'van' ? 1.6 : 0.6;
  const box = (m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(GEO.box, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); g.add(o); return o; };
  box(paint, 0, 0.45 + hgt / 2, 0, wid, hgt, len); box(paint, 0, 0.45 + hgt + 0.05, 0, wid * 0.94, 0.1, len * 0.96); // the body, with a rounded shoulder
  box(dark, 0, 0.3, 0, wid * 0.96, 0.22, len * 0.98); // the sills and bumpers
  if (kind === 'car' || kind === 'police' || kind === 'getaway') { const c = box(glassM, 0, 0.45 + hgt + 0.38, 0.2, wid * 0.84, 0.56, len * 0.46); c.scale.z = len * 0.46; box(paint, 0, 0.45 + hgt + 0.68, 0.25, wid * 0.8, 0.07, len * 0.36);
    for (const sx of [-1, 1]) box(paint, sx * wid * 0.41, 0.45 + hgt + 0.38, 0.2 - len * 0.2, 0.06, 0.56, 0.12); }
  else box(glassM, 0, 0.45 + hgt * 0.72, -len / 2 + 0.02, wid * 0.9, hgt * 0.4, 0.06);
  if (kind === 'police') { box(pmat('#1e2a44'), 0, 0.45 + hgt * 0.55, 0, wid + 0.02, 0.28, len * 0.7); g.userData.bar = [box(new THREE.MeshBasicMaterial({ color: '#ff2a2a' }), -0.35, 0.45 + hgt + 0.78, 0.15, 0.6, 0.16, 0.3), box(new THREE.MeshBasicMaterial({ color: '#2a5bff' }), 0.35, 0.45 + hgt + 0.78, 0.15, 0.6, 0.16, 0.3)]; }
  if (kind === 'getaway') box(pmat('#f4f4f0'), 0, 0.45 + hgt + 0.01, 0, 0.35, 0.02, len * 0.98); // a racing stripe
  const wheels = []; for (const [x, z] of [[-wid / 2, len * 0.32], [wid / 2, len * 0.32], [-wid / 2, -len * 0.32], [wid / 2, -len * 0.32]]) { const w = new THREE.Mesh(GEO.cyl, dark); w.rotation.z = Math.PI / 2; w.scale.set(0.42, 0.28, 0.42); w.position.set(x, 0.42, z); g.add(w); wheels.push(w); }
  const head = new THREE.MeshBasicMaterial({ color: '#fff6d8' }), tail = new THREE.MeshBasicMaterial({ color: '#ff3020' });
  for (const sx of [-1, 1]) { box(head, sx * wid * 0.33, 0.45 + hgt * 0.55, -len / 2 - 0.01, 0.42, 0.18, 0.04); box(tail, sx * wid * 0.36, 0.45 + hgt * 0.55, len / 2 + 0.01, 0.38, 0.16, 0.04); }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(wid * 1.3, len * 1.1), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob);
  g.userData.wheels = wheels; g.userData.len = len; return g;
}
export function makeCones() { const g = new THREE.Group(); for (const x of [-1.1, 0, 1.1]) { const c = new THREE.Mesh(GEO.cone, pmat('#f2994a')); c.scale.set(0.32, 0.8, 0.32); c.position.set(x, 0.4, 0); g.add(c); const s = new THREE.Mesh(GEO.cyl, pmat('#f4f4f0')); s.scale.set(0.22, 0.12, 0.22); s.position.set(x, 0.45, 0); g.add(s); } return g; }

// ---------------- inside a shop (the robbery) ----------------
// L: the level from shared/minigames.js (genStealth): a grid of floor, shelves (1) and the counter (2), in units of
// `s` metres. The back and left walls stand full height; the front and right ones are cut away so you see in.
export function buildShop(view, L, s = 1.6) {
  const M = materials(view), B = {}; for (const k of Object.keys(M)) B[k] = new Bucket(); const r = rnd(L.seed || 1), W = L.W * s, H = L.H * s, wh = 3.4, w = col('#ffffff');
  view.center.set(W / 2, 0, H / 2); view.span = Math.max(W, H) * 1.2;
  // the floor: big tiles, and the street outside
  B.paving.quad([0, 0.01, H], [W, 0.01, H], [W, 0.01, 0], [0, 0.01, 0], [0, 1, 0], [0, H / 3, W / 3, H / 3, W / 3, 0, 0, 0], col('#d8cfbf'));
  B.asphalt.quad([-40, 0, H + 40], [W + 40, 0, H + 40], [W + 40, 0, -40], [-40, 0, -40], [0, 1, 0], [0, 10, 10, 10, 10, 0, 0, 0], col('#9a9a9a'));
  // walls: the back and left in the shop's colours, with windows, posters and the back door; low walls at the front and right
  const wallC = col(['#c8473d', '#2f7d63', '#2f4a7a', '#e2b13c', '#8e44ad'][L.seed % 5]);
  B.plaster.box(-0.25, -0.25, W, 0, 0, wh, wallC, { su: 14, sv: 12.8 }); B.plaster.box(-0.25, 0, 0, H, 0, wh, col('#e8dfc9'), { su: 14, sv: 12.8 });
  B.solid.box(0, H, W + 0.25, H + 0.25, 0, 0.45, col('#b0a48c')); B.solid.box(W, -0.25, W + 0.25, H, 0, 0.45, col('#9c917b'));
  for (let x = 1.5; x < W - 2; x += 4.6) { B.glass.box(x, -0.1, x + 2.4, 0.02, 1.2, 2.6, col('#9cc3d9'), { su: 4, sv: 4 }); }
  for (let z = 1.5; z < H - 3; z += 4) { B.paint.quad([0.03, 1.1, z + 1.6], [0.03, 1.1, z], [0.03, 2.4, z], [0.03, 2.4, z + 1.6], [1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], col(['#f2c94c', '#e4572e', '#4a7bd9', '#3cc46a'][Math.floor(r() * 4)])); }
  const door = (L.H - 1) * s; B.solid.box(-0.1, door + 0.1, 0.06, door + s - 0.1, 0, 2.4, col('#6b4a2b'));
  bake(B.glow, GEO.box, { x: 0.12, y: 2.7, z: door + s / 2, sx: 0.06, sy: 0.3, sz: 0.9, color: col('#3cc46a') }); // the green EXIT light
  // shelves full of goods, and the counter with the till
  const goods = ['#e4572e', '#f2c94c', '#3cc46a', '#4a7bd9', '#b05fd6', '#f28cb1', '#f4f4f0', '#2ec4b6'];
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) { const v = L.wall[y * L.W + x]; if (!v) continue; const x0 = x * s, z0 = y * s, x1 = x0 + s, z1 = z0 + s;
    if (v === 2) { B.solid.box(x0 + 0.02, z0 + 0.1, x1 - 0.02, z1 - 0.1, 0, 1.0, col('#7c4f2c')); B.solid.box(x0 - 0.04, z0 + 0.05, x1 + 0.04, z1 - 0.05, 1.0, 1.08, col('#d9c7a8')); continue; }
    B.shiny.box(x0 + 0.08, z0 + 0.2, x1 - 0.08, z1 - 0.2, 0, 0.12, col('#6c6f75')); B.shiny.box(x0 + 0.08, z0 + s / 2 - 0.04, x1 - 0.08, z0 + s / 2 + 0.04, 0.12, 1.75, col('#8a8d93'));
    for (const hy of [0.12, 0.62, 1.12, 1.62]) B.shiny.box(x0 + 0.08, z0 + 0.2, x1 - 0.08, z1 - 0.2, hy, hy + 0.05, col('#b8bcc0'), { top: true });
    for (const hy of [0.17, 0.67, 1.17]) for (const side of [-1, 1]) for (let i = 0; i < 4; i++) { const gx = x0 + 0.18 + i * (s - 0.36) / 4, gz = z0 + s / 2 + side * 0.32, gh = 0.2 + r() * 0.22;
      B.solid.box(gx, gz - 0.16, gx + (s - 0.36) / 4 - 0.04, gz + 0.16, hy, hy + gh, col(goods[Math.floor(r() * goods.length)])); } }
  const tx = L.till.x * s, tz = (L.till.y - 1) * s; B.shiny.box(tx - 0.3, tz - 0.25, tx + 0.3, tz + 0.25, 1.08, 1.32, col('#2b2621')); bake(B.glow, GEO.box, { x: tx, y: 1.46, z: tz + 0.05, sx: 0.4, sy: 0.22, sz: 0.04, color: col('#7cffb2') });
  // lights: the ceiling is cut away, so warm strip lights hang over the aisles
  const group = new THREE.Group();
  for (const [k, b] of Object.entries(B)) { const g = b.geometry(); if (!g) continue; const m = new THREE.Mesh(g, M[k]); m.castShadow = !['asphalt', 'paint', 'pool', 'ao', 'paving'].includes(k); m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); }
  view.scene.add(group);
  // inside: no sky, a warm fill light, and a soft light from above
  view.sky.visible = false; view.scene.background = new THREE.Color('#1b1612'); view.scene.fog = null;
  const fill = new THREE.PointLight('#ffe7c4', 40, 30, 1.5); fill.position.set(W / 2, 6, H / 2); view.scene.add(fill);
  return group;
}
// A see-through cone: what a shopkeeper or a camera can see (rebuilt each frame from rays that stop at the shelves).
export function viewCone(color = '#ffd54a') {
  const n = 16, geo = new THREE.BufferGeometry(), pos = new Float32Array((n + 2) * 3), idx = []; for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending })); m.renderOrder = 3; m.frustumCulled = false;
  m.userData.set = (pts, y = 0.05) => { for (let i = 0; i < pts.length && i < n + 2; i++) { pos[i * 3] = pts[i][0]; pos[i * 3 + 1] = y; pos[i * 3 + 2] = pts[i][1]; } geo.attributes.position.needsUpdate = true; };
  m.userData.n = n; return m;
}
