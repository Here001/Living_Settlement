// Keeping every 3D view (homes, the mini games) from ever showing a dark or blank screen.
//
// Nothing here changes anything on a phone that draws properly: each guard only switches on when a check fails.
//  - Pictures painted by the game: some browsers' privacy protection blanks a canvas on its way to the graphics chip,
//    which turns every painted surface black. A tiny four-colour test picture is uploaded and read back once. If it
//    comes back wrong, the game hands the chip the raw pixels instead (the same picture, so the same look); and if even
//    that fails, each picture is replaced by its own base colour, so surfaces still show in the right colours.
//  - A picture that comes out black anyway (a graphics chip that can't do the lighting): checked a moment after a view
//    opens; if it's black, the lighting steps down until it isn't (plainer light, simpler shading, then none at all).
//  - The phone throwing the 3D view away (low memory, switching apps): a card says the picture's coming back, the
//    view is rebuilt when the phone allows, and if it never does, the caller is told so it can start afresh.
//  - A phone that can't do 3D at all: webglOK() says so up front, so the caller can fall back instead of a blank page.
import * as THREE from 'three';

export function webglOK() {
  try { const c = document.createElement('canvas'), gl = c.getContext('webgl2'); if (!gl) return false; const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; }
  catch (e) { return false; }
}

// ---------------- painted pictures ----------------
let MODE = null, READS = false; // MODE: 'ok' | 'raw' (send raw pixels) | 'plain' (base colours); READS: can we trust reading pixels back?
const COLS = [[230, 40, 40], [40, 200, 60], [50, 80, 220], [240, 220, 30]], N = 32;
function testCanvas() { const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); COLS.forEach(([r, gg, b], i) => { g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect((i % 2) * N / 2, Math.floor(i / 2) * N / 2, N / 2, N / 2); }); return c; }
const near = (p, w) => Math.abs(p[0] - w[0]) <= 12 && Math.abs(p[1] - w[1]) <= 12 && Math.abs(p[2] - w[2]) <= 12;
// draws the texture on a square and checks the four quarters come back in the right colours
function probe(renderer, tex) {
  tex.colorSpace = THREE.NoColorSpace; tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2), q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  sc.add(q); const rt = new THREE.WebGLRenderTarget(N, N), was = renderer.getRenderTarget(), px = new Uint8Array(4); let ok = true;
  try { renderer.setRenderTarget(rt); renderer.render(sc, cam);
    for (const [x, y, k] of [[8, 24, 0], [24, 24, 1], [8, 8, 2], [24, 8, 3]]) { renderer.readRenderTargetPixels(rt, x, y, 1, 1, px); if (!near(px, COLS[k])) ok = false; } }
  finally { renderer.setRenderTarget(was); rt.dispose(); tex.dispose(); q.geometry.dispose(); q.material.dispose(); }
  return ok;
}
// can we read pixels back at all? (a plain clear, no picture involved)
function readsBack(renderer) {
  const rt = new THREE.WebGLRenderTarget(4, 4), was = renderer.getRenderTarget(), old = new THREE.Color(), a = renderer.getClearAlpha(), px = new Uint8Array(4);
  renderer.getClearColor(old);
  try { renderer.setRenderTarget(rt); renderer.setClearColor(new THREE.Color().setRGB(50 / 255, 160 / 255, 90 / 255, THREE.SRGBColorSpace), 1); renderer.clear(); renderer.readRenderTargetPixels(rt, 1, 1, 1, 1, px); }
  finally { renderer.setRenderTarget(was); renderer.setClearColor(old, a); rt.dispose(); }
  return [[50, 160, 90], [8, 90, 26]].some(w => near(px, w)); // either way round the colour conversion goes
}
const honest2d = () => { try { const c = testCanvas(), d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, N, N).data; return [[4, 4, 0], [20, 4, 1], [4, 20, 2], [20, 20, 3]].every(([x, y, k]) => near(d.subarray((y * N + x) * 4), COLS[k])); } catch (e) { return false; } };

// Run once, the first time any 3D view is made; returns 'ok', 'raw' or 'plain'.
export function pictureMode(renderer) {
  if (MODE) { hook(renderer); return MODE; }
  try {
    READS = readsBack(renderer);
    if (READS && probe(renderer, new THREE.CanvasTexture(testCanvas()))) MODE = 'ok';
    else if (READS && honest2d() && probe(renderer, new THREE.Texture(testCanvas().getContext('2d').getImageData(0, 0, N, N)))) MODE = 'raw';
    else MODE = 'plain'; // can't get a picture across (or can't even tell): base colours are always safe
  } catch (e) { MODE = 'ok'; }
  if (MODE === 'plain') rememberBases();
  hook(renderer); return MODE;
}
export const reads = () => READS;

// 'plain': note each painted picture's base colour (the first fill that covers the whole canvas) as it's painted
function rememberBases() {
  const P = CanvasRenderingContext2D.prototype, fill = P.fillRect, clear = P.clearRect;
  P.fillRect = function (x, y, w, h) { const c = this.canvas; if (c && x <= 0 && y <= 0 && x + w >= c.width && y + h >= c.height && typeof this.fillStyle === 'string' && !c.__base) c.__base = { s: this.fillStyle, a: this.globalAlpha }; return fill.call(this, x, y, w, h); };
  P.clearRect = function (x, y, w, h) { const c = this.canvas; if (c && x <= 0 && y <= 0 && x + w >= c.width && y + h >= c.height) c.__base = null; return clear.call(this, x, y, w, h); };
}
const isCanvas = s => (typeof HTMLCanvasElement !== 'undefined' && s instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && s instanceof OffscreenCanvas);
function baseOf(c) {
  const w = c.width, h = c.height, d = new ImageData(w, h), b = c.__base; if (!b) return d; // nothing to go on: see-through, so nothing dark
  let a = b.a; const m = /rgba?\(([^)]*)\)|hsla?\(([^)]*)\)/i.exec(b.s); if (m) { const p = (m[1] || m[2]).split(/[,\s/]+/).filter(Boolean); if (p.length > 3) a *= parseFloat(p[3]) * (p[3].includes('%') ? 0.01 : 1); }
  const col = new THREE.Color(); try { col.setStyle(b.s.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]*\)/i, 'rgb($1,$2,$3)').replace(/hsla\(([^,]+),([^,]+),([^,]+),[^)]*\)/i, 'hsl($1,$2,$3)'), THREE.SRGBColorSpace); } catch (e) { return d; }
  const o = { r: 0, g: 0, b: 0 }; col.getRGB(o, THREE.SRGBColorSpace); const R = o.r * 255 | 0, G = o.g * 255 | 0, B = o.b * 255 | 0, A = Math.max(0, Math.min(255, a * 255 | 0)), px = d.data;
  for (let i = 0; i < px.length; i += 4) { px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = A; }
  return d;
}
// On a phone that blanks canvas pictures, swap each one for raw pixels (or its base colour) as it goes to the chip.
const hooked = new WeakSet();
function hook(renderer) {
  if (MODE === 'ok') return; const gl = renderer.getContext(); if (hooked.has(gl)) return; hooked.add(gl);
  const swap = s => { if (!isCanvas(s)) return s; if (MODE === 'plain') return baseOf(s); try { const g = s.getContext('2d'); return g ? g.getImageData(0, 0, s.width, s.height) : s; } catch (e) { return s; } };
  for (const fn of ['texImage2D', 'texSubImage2D']) { const orig = gl[fn]; gl[fn] = function (...a) { a[a.length - 1] = swap(a[a.length - 1]); return orig.apply(this, a); }; }
}

// ---------------- a picture that comes out black ----------------
// Reads 25 spots of what was just drawn (call straight after render). True if most of them are pitch black (a sky can
// still show above a black street). The darkest real scenes (the streets at night) have at most 3 such spots of 25.
function looksBlack(renderer) {
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4); let black = 0;
  try { for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) { gl.readPixels(Math.floor(w * i / 6), Math.floor(h * j / 6), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[0] <= 8 && px[1] <= 8 && px[2] <= 8) black++; } }
  catch (e) { return false; }
  return black >= 16;
}
// steps down: 1) plain bright light, no reflections or shadows; 2) simpler shading (still shows shape);
// 3) no lighting at all (every surface in its own colour)
function stepDown(renderer, scene, level) {
  if (level === 1) {
    scene.environment = null; renderer.shadowMap.enabled = false; renderer.toneMapping = THREE.NoToneMapping;
    scene.add(new THREE.AmbientLight('#ffffff', 1.6));
    scene.traverse(o => { const ms = o.material ? [].concat(o.material) : []; for (const m of ms) { if (m.normalMap) m.normalMap = null; m.needsUpdate = true; } });
    return;
  }
  scene.environment = null; renderer.shadowMap.enabled = false; renderer.toneMapping = THREE.NoToneMapping;
  scene.traverse(o => { if (!o.isMesh) return; const one = m => { if (!m || m.isMeshBasicMaterial || m.isShaderMaterial || (level === 2 && m.isMeshLambertMaterial)) return m;
    const o2 = { color: m.color || '#ffffff', map: m.map || null, vertexColors: !!m.vertexColors, transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: m.depthWrite, visible: m.visible };
    const b = level === 2 ? new THREE.MeshLambertMaterial({ ...o2, emissive: m.emissive || '#000000', emissiveMap: m.emissiveMap || null, emissiveIntensity: m.emissiveIntensity ?? 1 }) : new THREE.MeshBasicMaterial(o2);
    if (m.onBeforeCompile && m.customProgramCacheKey) { b.onBeforeCompile = m.onBeforeCompile; b.customProgramCacheKey = m.customProgramCacheKey; } return b; };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material); });
}
// One per view. Call after() straight after each render; it returns true if the view should draw again.
export function blackGuard(renderer, scene, redraw) {
  let level = 0, ok = 0, at = performance.now() + 700, done = false, pend = false;
  const g = {
    get level() { return level; },
    after() {
      if (done || !READS) return false; const now = performance.now(); if (now < at) return false;
      if (looksBlack(renderer)) { level++; stepDown(renderer, scene, level); if (level >= 3) done = true; at = now + 400; return true; }
      if (++ok >= 3) done = true; at = now + 1500; return false;
    },
    // a shader the phone couldn't build: straight to the simpler shading (and to none if that fails too)
    failed() { if (level >= 3) return; level = Math.max(level + 1, 2); stepDown(renderer, scene, level); ok = 0; at = performance.now() + 400; redraw && redraw(); },
  };
  renderer.debug.onShaderError = (gl, program, vs, fs) => { try { console.error('3D: the phone could not build a shader', gl.getProgramInfoLog(program)); } catch (e) {} if (pend) return; pend = true; setTimeout(() => { pend = false; g.failed(); }, 0); }; /* several shaders failing in one frame count once */
  return g;
}

// ---------------- the phone throwing the 3D view away ----------------
// back(): rebuild what the phone forgot (reflections, shadows) and draw. giveUp(): it never came back.
export function guardContext(renderer, host, { back, giveUp, wait = 6000 } = {}) {
  const cv = renderer.domElement; let card = null, timer = 0;
  const lost = () => {
    if (!card) { card = document.createElement('div'); card.className = 'gl-card'; card.textContent = 'Getting the picture back…'; (host || cv.parentElement || document.body).append(card); }
    clearTimeout(timer); timer = setTimeout(() => { timer = 0; if (giveUp) giveUp(); else if (card) card.textContent = 'Your phone paused the 3D view to save memory. It comes back by itself.'; }, wait);
  };
  const restored = () => { clearTimeout(timer); timer = 0; if (card) { card.remove(); card = null; } try { back && back(); } catch (e) { console.error(e); } };
  cv.addEventListener('webglcontextlost', lost); cv.addEventListener('webglcontextrestored', restored);
  return { dispose() { clearTimeout(timer); cv.removeEventListener('webglcontextlost', lost); cv.removeEventListener('webglcontextrestored', restored); if (card) card.remove(); } };
}
