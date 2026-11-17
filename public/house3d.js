// A colonist's home in 3D: the house's rooms, walls, doorways, windows and ceilings (from the plan in
// shared/furniture.js), each room's floor and wallpaper, the furniture on the floor, on the walls, at the windows and on
// the ceiling, photos in the frames, and lamps that light the rooms. You walk through it in first person (a joystick and
// a drag to look on phones; WASD or the arrow keys and the mouse on computers), or look down on it from above.
//
// Placing: while a piece is being placed, it follows where you look (the floor, a wall, a window or the ceiling, by
// kind), or goes where you tap. Tapping a piece selects it.
//
// Built for phones: each piece of furniture is one merged mesh, the house's walls are a handful, the picture is drawn
// only while something moves or changes (nothing at all while you stand still), and the resolution is capped.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FURNITURE, FLOORS, WALLS, TINTS, WALL_H, WALL_T, EYE, layoutOf, styleOf, placedParts, footOf, roomAt } from '/shared/furniture.js';
import { BUILDING_TYPES, ROAD_TYPES } from '/shared/catalog.js';

const PHONE = matchMedia('(pointer: coarse)').matches;
// Quality: a weaker phone (little memory or few cores) gets smaller textures and no sun shadows; everything else looks the same.
const HQ = !(PHONE && ((navigator.deviceMemory || 4) <= 3 || (navigator.hardwareConcurrency || 8) <= 4)), TS = HQ ? 1024 : 512;
const EXTERIOR = '#D9CBB5', CEILING = '#FBFAF6', TRIM = '#F7F5EF';
const col = c => new THREE.Color(c);
const isGlass = c => typeof c === 'string' && c.startsWith('rgba');

// ---------------- textures, painted once (colour, and a matching surface-detail "normal" map) ----------------
const rngT = seed => { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const TEX = new Map();
function canvasOf(size, paint) { const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size); return c; }
function texOf(c, srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = HQ ? 8 : 4; return t; }
// a normal map from a greyscale height canvas (light = raised), so grout, plank joints and weave catch the light
function normalOf(hc, strength = 2) {
  const S = hc.width, src = hc.getContext('2d').getImageData(0, 0, S, S).data, out = document.createElement('canvas'); out.width = out.height = S;
  const g = out.getContext('2d'), img = g.createImageData(S, S), o = img.data, h = (x, y) => src[((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255; }
  g.putImageData(img, 0, 0); return texOf(out, false);
}
const shadeHex = (hex, f) => { const c = col(hex); c.offsetHSL(0, 0, f); return '#' + c.getHexString(); };
// a floor: colour + normal map, one texture covering 2×2 m
function floorSet(k) {
  const key = 'floor-' + k; if (TEX.has(key)) return TEX.get(key); const f = FLOORS[k] || FLOORS.wood, r = rngT(k.length * 7919 + k.charCodeAt(0)), S = TS;
  let colour, height;
  if (f.planks) { const rows = 8, rh = S / rows, segs = [];
    for (let i = 0; i < rows; i++) { let x = -r() * S * 0.6; while (x < S) { const w = S * (0.45 + r() * 0.5); segs.push([x, i * rh, w, rh, r()]); x += w; } }
    colour = canvasOf(S, g => { for (const [x, y, w, h, v] of segs) { const base = v < 0.5 ? f.a : f.b; g.fillStyle = shadeHex(base, (v - 0.5) * 0.08); for (const dx of [0, S, -S]) g.fillRect(x + dx, y, w, h);
        g.save(); g.beginPath(); for (const dx of [0, S, -S]) g.rect(x + dx, y, w, h); g.clip();
        for (let j = 0; j < 26; j++) { const yy = y + r() * h, a = 0.03 + r() * 0.08; g.strokeStyle = `rgba(${r() < 0.5 ? '40,20,5' : '255,235,200'},${a})`; g.lineWidth = 0.6 + r() * 1.6; g.beginPath(); g.moveTo(x - 10, yy);
          for (let s2 = 0; s2 <= 8; s2++) g.lineTo(x + (w / 8) * s2, yy + Math.sin(s2 * 1.3 + j) * (1 + r() * 2)); g.stroke(); }
        if (r() < 0.25) { g.fillStyle = 'rgba(60,30,10,.25)'; g.beginPath(); g.ellipse(x + r() * w, y + h / 2, 6 + r() * 6, 3 + r() * 2, 0, 0, 7); g.fill(); }
        g.restore(); }
      g.fillStyle = 'rgba(30,15,5,.45)'; for (const [x, y, w] of segs) { g.fillRect(x, y, 2, rh); g.fillRect(x, y, w, 2); } });
    height = canvasOf(S, g => { g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, S, S); for (const [x, y, w] of segs) { g.fillStyle = '#404040'; g.fillRect(x, y, 3, rh); g.fillRect(x, y, w, 3); }
      for (let j = 0; j < 900; j++) { g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},0.05)`; g.fillRect(r() * S, r() * S, 10 + r() * 50, 1); } }); }
  else if (f.soft) { colour = canvasOf(S, g => { g.fillStyle = f.a; g.fillRect(0, 0, S, S); for (let j = 0; j < S * S / 6; j++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.07})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); } });
    height = canvasOf(S, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, S, S); for (let j = 0; j < S * S / 5; j++) { const v = Math.floor(r() * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * S, r() * S, 2, 2); } }); }
  else { const n = k === 'marble' ? 2 : k === 'check' ? 4 : 4, ts = S / n, grout = Math.max(2, S / 256);
    colour = canvasOf(S, g => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const base = k === 'check' ? ((i + j) % 2 ? f.b : f.a) : (r() < 0.5 ? f.a : f.b); g.fillStyle = shadeHex(base, (r() - 0.5) * (k === 'check' ? 0.02 : 0.05)); g.fillRect(i * ts, j * ts, ts, ts);
        if (k === 'slate' || k === 'terracotta') for (let q = 0; q < 220; q++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`; g.beginPath(); g.arc(i * ts + r() * ts, j * ts + r() * ts, 1 + r() * 5, 0, 7); g.fill(); } }
      if (k === 'marble') { g.lineCap = 'round'; for (let v = 0; v < 14; v++) { let x = r() * S, y = r() * S, a = r() * 6.28; const w = 0.6 + r() * 2.4; g.strokeStyle = `rgba(${110 + r() * 40},${100 + r() * 30},${90 + r() * 30},${0.12 + r() * 0.25})`; g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
          for (let s2 = 0; s2 < 40; s2++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); } g.stroke(); } }
      g.fillStyle = k === 'check' ? '#9A9A9A' : k === 'terracotta' ? '#D9C3A9' : '#C8C3BA'; for (let i = 0; i <= n; i++) { g.fillRect(i * ts - grout / 2, 0, grout, S); g.fillRect(0, i * ts - grout / 2, S, grout); } });
    height = canvasOf(S, g => { g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, S, S); g.fillStyle = '#303030'; for (let i = 0; i <= n; i++) { g.fillRect(i * ts - grout, 0, grout * 2, S); g.fillRect(0, i * ts - grout, S, grout * 2); } }); }
  const set = { map: texOf(colour), normalMap: normalOf(height, f.planks ? 3 : f.soft ? 1.2 : 4), roughness: k === 'marble' ? 0.18 : k === 'tiles' || k === 'check' ? 0.28 : f.planks ? 0.55 : f.soft ? 0.98 : 0.6 };
  TEX.set(key, set); return set;
}
// painted plaster for walls and ceilings (near white: multiplied with the wall's colour), brick and wood panels
function wallSet(k) {
  const key = 'wall-' + (WALLS[k]?.brick ? 'brick' : WALLS[k]?.panels ? 'wood' : 'plaster'); if (TEX.has(key)) return TEX.get(key); const r = rngT(31), S = TS / 2; let colour, height;
  if (WALLS[k]?.brick) { const bh = S / 8, bw = S / 4, cells = [];
    for (let row = 0; row < 8; row++) for (let i = -1; i < 5; i++) cells.push([i * bw + (row % 2 ? bw / 2 : 0), row * bh, `hsl(${10 + r() * 10},${36 + r() * 16}%,${36 + r() * 12}%)`]);
    colour = canvasOf(S, g => { g.fillStyle = '#CFC8BC'; g.fillRect(0, 0, S, S); for (const [x, y, c] of cells) { g.fillStyle = c; g.fillRect(x + 2, y + 2, bw - 4, bh - 4); for (let q = 0; q < 30; q++) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(x + 2 + r() * (bw - 6), y + 2 + r() * (bh - 6), 2, 2); } } });
    height = canvasOf(S, g => { g.fillStyle = '#202020'; g.fillRect(0, 0, S, S); g.fillStyle = '#d0d0d0'; for (const [x, y] of cells) g.fillRect(x + 3, y + 3, bw - 6, bh - 6); }); }
  else if (WALLS[k]?.panels) { colour = canvasOf(S, g => { for (let i = 0; i < 6; i++) { g.fillStyle = `hsl(28,${34 + r() * 8}%,${42 + r() * 7}%)`; g.fillRect(i * S / 6, 0, S / 6, S); for (let q = 0; q < 40; q++) { g.fillStyle = `rgba(40,20,5,${r() * 0.1})`; g.fillRect(i * S / 6 + r() * S / 6, 0, 1, S); } g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(i * S / 6, 0, 2, S); } });
    height = canvasOf(S, g => { g.fillStyle = '#c0c0c0'; g.fillRect(0, 0, S, S); g.fillStyle = '#303030'; for (let i = 0; i < 6; i++) g.fillRect(i * S / 6, 0, 3, S); }); }
  else { colour = canvasOf(S, g => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, S, S); for (let q = 0; q < S * S / 8; q++) { g.fillStyle = `rgba(0,0,0,${r() * 0.035})`; g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3); } });
    height = canvasOf(S, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, S, S); for (let q = 0; q < S * S / 4; q++) { const v = 100 + Math.floor(r() * 56); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 3); } }); }
  const set = { map: texOf(colour), normalMap: normalOf(height, WALLS[k]?.brick ? 3 : WALLS[k]?.panels ? 2 : 0.6), roughness: WALLS[k]?.panels ? 0.6 : 0.9, textured: !!(WALLS[k]?.brick || WALLS[k]?.panels) };
  TEX.set(key, set); return set;
}
// small near-white detail maps multiplied with a piece's own colours: fabric weave and wood grain
function detail(kind) {
  const key = 'detail-' + kind; if (TEX.has(key)) return TEX.get(key); const r = rngT(kind === 'fabric' ? 5 : 9), S = HQ ? 256 : 128; let colour, height;
  if (kind === 'fabric') { colour = canvasOf(S, g => { g.fillStyle = '#F2F2F2'; g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) { if ((x + y) % 4 === 0) { g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(x, y, 2, 2); } } for (let q = 0; q < S * 6; q++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.06})`; g.fillRect(r() * S, r() * S, 1, 1); } });
    height = canvasOf(S, g => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = 128 + 60 * Math.sin(x * 1.57) * Math.sin(y * 1.57); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1); } }); }
  else { colour = canvasOf(S, g => { g.fillStyle = '#EDEDED'; g.fillRect(0, 0, S, S); for (let j = 0; j < 70; j++) { const y = r() * S; g.strokeStyle = `rgba(${r() < 0.6 ? '50,25,5' : '255,245,225'},${0.05 + r() * 0.12})`; g.lineWidth = 0.5 + r() * 1.8; g.beginPath(); g.moveTo(0, y); for (let s2 = 0; s2 <= 16; s2++) g.lineTo(S / 16 * s2, y + Math.sin(s2 * 0.9 + j) * 2); g.stroke(); } });
    height = canvasOf(S, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, S, S); for (let j = 0; j < 90; j++) { const y = r() * S, v = Math.floor(80 + r() * 100); g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 4); g.stroke(); } }); }
  const set = { map: texOf(colour), normalMap: normalOf(height, kind === 'fabric' ? 1.5 : 1) }; TEX.set(key, set); return set;
}
function placeholderTex() {
  if (TEX.has('photo-placeholder')) return TEX.get('photo-placeholder');
  const t = texOf(canvasOf(256, (g, S) => { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#8EC9F2'); gr.addColorStop(0.6, '#D9EFFA'); gr.addColorStop(0.6, '#7DBE6A'); gr.addColorStop(1, '#4F8F45'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = '#F7DC6F'; g.beginPath(); g.arc(S * 0.72, S * 0.28, S * 0.09, 0, 7); g.fill(); g.fillStyle = 'rgba(0,0,0,.55)'; g.font = `bold ${S * 0.09}px sans-serif`; g.textAlign = 'center'; g.fillText('📷 Add a photo', S / 2, S * 0.9); }));
  TEX.set('photo-placeholder', t); return t;
}
// soft shapes: the shadow a piece leaves on the floor, the darkening where a wall meets the floor, and a lamp's glow
const radialTex = (key, stops) => { if (TEX.has(key)) return TEX.get(key); const t = texOf(canvasOf(128, (g, S) => { const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); for (const [a, c] of stops) gr.addColorStop(a, c); g.fillStyle = gr; g.fillRect(0, 0, S, S); }), true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; TEX.set(key, t); return t; };
const linearTex = () => { if (TEX.has('ao-lin')) return TEX.get('ao-lin'); const t = texOf(canvasOf(64, (g, S) => { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#5a5a5a'); gr.addColorStop(1, '#000000'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }), false); t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; TEX.set('ao-lin', t); return t; }; /* white = dark shadow, for an alpha map */

// ---------------- geometry for one part ----------------
// house (x, y, z) → three.js (x, up, y)
function partGeo(p) {
  const { x, y, z, w, d, h, s } = p; let g;
  if (s === 'o') g = new THREE.SphereGeometry(0.5, 18, 12);
  else if (s === 'c') g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
  else if (s === 'd') { g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); if (d <= w) g.rotateX(Math.PI / 2); else g.rotateZ(Math.PI / 2); }
  else { // blocks get softly rounded edges that catch the light, like real furniture (the smallest bits stay sharp)
    const m = Math.min(w, h, d); if (m >= 0.05) { g = new RoundedBoxGeometry(w, h, d, PHONE ? 1 : 2, Math.min(0.03, m * 0.22)); g.translate(x + w / 2, z + h / 2, y + d / 2); return g; }
    g = new THREE.BoxGeometry(1, 1, 1); }
  g.scale(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)); g.translate(x + w / 2, z + h / 2, y + d / 2); return g.toNonIndexed(); /* like the rounded blocks, so they merge */
}
function paint(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3), k = col(c); for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
// ---------------- materials: physically based, so each surface takes light like the real thing ----------------
const std = o => new THREE.MeshStandardMaterial(o);
let MATS = null;
function mats() {
  if (MATS) return MATS; const fab = detail('fabric'), wood = detail('wood');
  for (const t of [fab.map, fab.normalMap]) t.repeat.set(4, 4); for (const t of [wood.map, wood.normalMap]) t.repeat.set(2, 2);
  MATS = { plain: std({ vertexColors: true, roughness: 0.62 }), fabric: std({ vertexColors: true, roughness: 0.95, map: fab.map, normalMap: fab.normalMap, normalScale: new THREE.Vector2(0.7, 0.7) }),
    wood: std({ vertexColors: true, roughness: 0.48, map: wood.map, normalMap: wood.normalMap, normalScale: new THREE.Vector2(0.5, 0.5) }),
    metal: std({ vertexColors: true, roughness: 0.3, metalness: 0.85 }), gold: std({ vertexColors: true, roughness: 0.26, metalness: 1 }), gloss: std({ vertexColors: true, roughness: 0.16 }),
    leaf: std({ vertexColors: true, roughness: 0.78 }), glass: std({ color: '#DCEFFA', transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.1, depthWrite: false }),
    screen: std({ color: '#0B1220', roughness: 0.12, metalness: 0.2, emissive: '#101A2C' }) };
  return MATS;
}
const MAT = { get solid() { return mats().plain; }, get glass() { return mats().glass; }, get screen() { return mats().screen; } };
const glow = new Map(); const glowMat = c => { if (!glow.has(c)) glow.set(c, new THREE.MeshBasicMaterial({ color: col(c).multiplyScalar(1.15) })); return glow.get(c); };
const glassMat = new Map(); const tintedGlass = c => { if (!glassMat.has(c)) glassMat.set(c, std({ color: col(c), transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false })); return glassMat.get(c); };
const haloMat = new Map(); const halo = c => { if (!haloMat.has(c)) haloMat.set(c, new THREE.SpriteMaterial({ map: radialTex('halo', [[0, 'rgba(255,255,255,.9)'], [0.25, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]), color: col(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); return haloMat.get(c); };
// which material a part is: upholstery and bedding are fabric, browns are wood, steel greys are metal, golds gold, whites and lacquer gloss, leaves leafy
const UPHOLSTERED = new Set(['sofa', 'cornersofa', 'armchair', 'beanbag', 'rug', 'roundrug', 'bigrug', 'bed', 'doublebed', 'bunkbed', 'cot', 'chair', 'officechair', 'catbed', 'booth', 'waiting', 'tablefour', 'cafetable', 'barstool', 'curtains', 'blinds', 'towelrail', 'coathooks', 'hamper', 'bathmat', 'throne', 'meeting', 'mannequin', 'clothesrack']);
const METAL = new Set(['#3B3B40', '#BDC3C7', '#95A5A6', '#7F8C8D', '#A6ACAF']), GOLD = new Set(['#D4AC0D', '#C9A227', '#F1C40F', '#F4D03F']), GLOSS = new Set(['#F4F6F8', '#E5E8E8', '#DADDE2', '#D5D8DC', '#E8E4DC', '#1D1B1E', '#1C1C1E', '#4A4A4E', '#F5F5F0', '#2C2A2E']);
const hsl = {}; function matKind(k, c, tint, s) {
  if (c === tint && UPHOLSTERED.has(k)) return 'fabric'; if (UPHOLSTERED.has(k) && /^#(F4F1EA|FFFFFF|F2E8D5)$/i.test(c)) return 'fabric';
  if (GOLD.has(c)) return 'gold'; if (METAL.has(c)) return 'metal'; if (GLOSS.has(c)) return 'gloss'; if (s === 'o' && /#(3E8E41|2E8B57|1E8449|27AE60)/i.test(c)) return 'leaf';
  col(c).getHSL(hsl); if (hsl.h > 0.035 && hsl.h < 0.13 && hsl.s > 0.18 && hsl.s < 0.8 && hsl.l > 0.15 && hsl.l < 0.62) return 'wood';
  return c === tint ? 'gloss' : 'plain';
}

// One piece of furniture as a group: its parts merged into one mesh per material, plus glass, screens, lamps (with a glow) and its photo.
function pieceGroup(it, photoTex) {
  const f = FURNITURE[it.k]; if (!f) return null; const tint = TINTS[it.c || 0] || TINTS[0], grp = new THREE.Group(), byKind = new Map(), M = mats();
  for (const p of placedParts(it, tint)) {
    if (p.s === 'p') { const ww = p.out && p.out[0] ? p.d : p.w, pl = new THREE.PlaneGeometry(ww, p.h), o = p.out || [0, 1];
      pl.rotateY(o[1] === 1 ? 0 : o[1] === -1 ? Math.PI : o[0] === 1 ? Math.PI / 2 : -Math.PI / 2);
      pl.translate(p.x + p.w / 2 + o[0] * (Math.min(p.w, p.d) / 2 + 0.004), p.z + p.h / 2, p.y + p.d / 2 + o[1] * (Math.min(p.w, p.d) / 2 + 0.004));
      const m = new THREE.Mesh(pl, std({ map: photoTex || placeholderTex(), roughness: 0.35 })); m.userData.photo = true; grp.add(m); continue; }
    if (p.s === 'l') { const lc = p.c === tint ? tint : p.c; grp.add(new THREE.Mesh(partGeo(p), glowMat(lc)));
      if (f.light) { const sp = new THREE.Sprite(halo(lc)), s2 = Math.max(p.w, p.d, p.h) * 2.4 + 0.3; sp.scale.set(s2, s2, 1); sp.position.set(p.x + p.w / 2, p.z + p.h / 2, p.y + p.d / 2); sp.renderOrder = 3; sp.userData.halo = true; grp.add(sp); } continue; }
    if (p.s === 's') { grp.add(new THREE.Mesh(partGeo(p), M.screen)); continue; }
    if (p.s === 'g' || isGlass(p.c)) { grp.add(new THREE.Mesh(partGeo(p), isGlass(p.c) ? M.glass : tintedGlass(p.c))); continue; }
    const kind = matKind(it.k, p.c, tint, p.s); (byKind.get(kind) || byKind.set(kind, []).get(kind)).push(paint(partGeo(p), p.c));
  }
  for (const [kind, list] of byKind) { const m = new THREE.Mesh(mergeGeometries(list), M[kind]); m.castShadow = m.receiveShadow = true; grp.add(m); }
  grp.userData = { i: it.i, k: it.k }; grp.traverse(o => { o.userData.i = it.i; }); return grp;
}

// ---------------- the house ----------------
export function createHouse(host, opts) {
  const S = opts.size, PLAN = opts.plan || 'home', L = layoutOf(S, PLAN), H = WALL_H;
  // Film-like colour (ACES), sunlight through the windows with real shadows (worked out only when the house changes,
  // not every frame), a soft reflection of a bright room on every surface, and a fixed set of lamps that follows you
  // from room to room (a fixed number, so a phone never has to rebuild its shaders while you walk).
  const renderer = new THREE.WebGLRenderer({ antialias: !PHONE || (devicePixelRatio || 1) < 2.5, powerPreference: 'high-performance' });
  const DPR = devicePixelRatio || 1, PR_HI = Math.min(DPR, PHONE ? (HQ ? 1.5 : 1.25) : 2), prNow = PR_HI;
  renderer.setPixelRatio(PR_HI); renderer.domElement.className = 'house3d'; host.append(renderer.domElement);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = HQ; renderer.shadowMap.type = PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; /* phones: the cheaper filter (the shadows are still soft-edged) */ renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(); scene.background = col('#BFE3F7');
  { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); scene.environmentIntensity = 0.42; }
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 140); camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight('#FFF8EE', '#7A6E62', 0.55));
  const sun = new THREE.DirectionalLight('#FFE9C8', 2.6); sun.position.set(S / 2 - S * 0.9, 7.5, S / 2 + S * 0.7); sun.target.position.set(S / 2, 0, S / 2); scene.add(sun, sun.target);
  if (HQ) { sun.castShadow = true; const sc = sun.shadow.camera, R = S * 0.85 + 1; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = 30; sun.shadow.mapSize.set(PHONE ? 1024 : 2048, PHONE ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3; }
  const reshadow = () => { if (HQ) renderer.shadowMap.needsUpdate = true; };
  { const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), std({ color: '#7FB069', roughness: 1 })); g.rotation.x = -Math.PI / 2; g.position.set(S / 2, -0.02, S / 2); g.receiveShadow = true; scene.add(g); }
  const aoG = new THREE.Group(), shell = new THREE.Group(), walls = new THREE.Group(), ceilings = new THREE.Group(), floors = new THREE.Group(), stuff = new THREE.Group(), wallStuff = new THREE.Group(), ceilStuff = new THREE.Group(), lights = new THREE.Group();
  const people = new THREE.Group(), around = new THREE.Group(); scene.add(people); shell.add(walls, ceilings, floors, aoG); scene.add(shell, stuff, wallStuff, ceilStuff, lights, around);
  let room = opts.room, photos = opts.photos || {}, view = 'walk', pick = null, sel = null, ghost = null, marker = null, selBox = null, grid = null, dirty = true;
  const me = { x: 0, y: 0, yaw: 0, pitch: -0.08 }, keys = new Set(), joy = { on: false, x: 0, y: 0 }, above = { yaw: 0.7 };
  const photoTex = new Map();
  function photoTexture(id) {
    if (!id) return null; if (photoTex.has(id)) return photoTex.get(id); const urls = photos[id]; if (!urls) return null;
    const t = new THREE.Texture(); t.colorSpace = THREE.SRGBColorSpace; photoTex.set(id, t);
    const load = (src, cors, next) => { const im = new Image(); if (cors) im.crossOrigin = 'anonymous'; im.onload = () => { t.image = im; t.needsUpdate = true; dirty = true; wake(); }; im.onerror = () => next && next(); im.src = src; };
    if (urls.u) load(urls.u, true, () => load(urls.s, false)); else load(urls.s, false); return t;
  }

  // ---- walls, doorways, windows, ceilings and floors ----
  function buildShell() {
    for (const g of [walls, ceilings, floors, aoG]) { for (const c of [...g.children]) { c.geometry.dispose(); g.remove(c); } }
    const plain = new Map(), textured = new Map(), glass = [], add = (key, geo) => { (plain.get(key) || plain.set(key, []).get(key)).push(paint(geo, key)); };
    const box = (x0, y0, z0, x1, y1, z1) => { const g = new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0); g.translate((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2); return g; };
    const faceStyle = (tx, ty) => { if (tx < 0 || ty < 0 || tx >= S || ty >= S) return { c: EXTERIOR }; const ri = roomAt(S, tx, ty, PLAN), w = WALLS[styleOf(room, S, ri).w]; return { c: w.c, k: styleOf(room, S, ri).w, inside: true }; };
    // walls: their paint colour times a plaster (or brick, or wood) texture, laid at the same scale everywhere
    const wallBox = (st, geo, len, hgt) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * hgt / 1.3);
      const ws = st.k ? wallSet(st.k) : wallSet('cream'), key = (ws.textured ? 'T:' + st.k : 'P:') + '|' + (ws.textured ? '#ffffff' : st.c); (textured.get(key) || textured.set(key, []).get(key)).push(paint(geo, ws.textured ? '#ffffff' : st.c)); };
    for (const [key, type] of L.edges) {
      const horiz = key[0] === 'h', [a, b] = key.slice(1).split(',').map(Number), T = WALL_T;
      // each side of the wall is a thin slab in that side's colour: [tile on this side, slab bounds as a function of z range]
      const sides = horiz ? [[[a, b - 1], (z0, z1) => box(a, b - T, z0, a + 1, b, z1)], [[a, b], (z0, z1) => box(a, b, z0, a + 1, b + T, z1)]]
        : [[[a - 1, b], (z0, z1) => box(a - T, b, z0, a, b + 1, z1)], [[a, b], (z0, z1) => box(a, b, z0, a + T, b + 1, z1)]];
      for (const [[tx, ty], slab] of sides) { const st = faceStyle(tx, ty);
        if (type === 'wall' || type === 'front') wallBox(st, slab(0, H), 1, H);
        else if (type === 'window') { wallBox(st, slab(0, 0.9), 1, 0.9); wallBox(st, slab(2.1, H), 1, H - 2.1); }
        else wallBox(st, slab(2.15, H), 1, H - 2.15);
        if (st.inside && type !== 'door') { const sk = horiz ? (ty === b ? box(a, b, 0, a + 1, b + T + 0.02, 0.1) : box(a, b - T - 0.02, 0, a + 1, b, 0.1)) : (tx === a ? box(a, b, 0, a + T + 0.02, b + 1, 0.1) : box(a - T - 0.02, b, 0, a, b + 1, 0.1)); if (type !== 'front') add(TRIM, sk); } }
      if (type === 'window') { const g = horiz ? box(a, b - 0.01, 0.9, a + 1, b + 0.01, 2.1) : box(a - 0.01, b, 0.9, a + 0.01, b + 1, 2.1); glass.push(g);
        const fr = (x0, y0, z0, x1, y1, z1) => add('#FFFFFF', box(x0, y0, z0, x1, y1, z1));
        if (horiz) { fr(a, b - T - 0.04, 0.86, a + 1, b + T + 0.04, 0.9); fr(a, b - 0.03, 2.1, a + 1, b + 0.03, 2.14); fr(a, b - 0.03, 0.9, a + 0.05, b + 0.03, 2.1); fr(a + 0.95, b - 0.03, 0.9, a + 1, b + 0.03, 2.1); fr(a + 0.48, b - 0.02, 0.9, a + 0.52, b + 0.02, 2.1); }
        else { fr(a - T - 0.04, b, 0.86, a + T + 0.04, b + 1, 0.9); fr(a - 0.03, b, 2.1, a + 0.03, b + 1, 2.14); fr(a - 0.03, b, 0.9, a + 0.03, b + 0.05, 2.1); fr(a - 0.03, b + 0.95, 0.9, a + 0.03, b + 1, 2.1); fr(a - 0.02, b + 0.48, 0.9, a + 0.02, b + 0.52, 2.1); } }
      if (type === 'door') { const fr = (x0, y0, z0, x1, y1, z1) => add(TRIM, box(x0, y0, z0, x1, y1, z1)), e = T + 0.02;
        if (horiz) { fr(a, b - e, 0, a + 0.06, b + e, 2.15); fr(a + 0.94, b - e, 0, a + 1, b + e, 2.15); fr(a, b - e, 2.1, a + 1, b + e, 2.2); } else { fr(a - e, b, 0, a + e, b + 0.06, 2.15); fr(a - e, b + 0.94, 0, a + e, b + 1, 2.15); fr(a - e, b, 2.1, a + e, b + 1, 2.2); } }
      if (type === 'front') { const e = T + 0.025, leaf = horiz ? box(a + 0.08, b - e, 0, a + 0.92, b + e, 2.1) : box(a - e, b + 0.08, 0, a + e, b + 0.92, 2.1); add('#7A4A2A', leaf);
        const kn = horiz ? box(a + 0.78, b - e - 0.03, 1.0, a + 0.84, b + e + 0.03, 1.06) : box(a - e - 0.03, b + 0.78, 1.0, a + e + 0.03, b + 0.84, 1.06); add('#D4AC0D', kn); }
    }
    const trimMat = std({ vertexColors: true, roughness: 0.32 });
    for (const [c, list] of plain) { const m = new THREE.Mesh(mergeGeometries(list), trimMat); m.castShadow = m.receiveShadow = true; walls.add(m); }
    for (const [key, list] of textured) { const k = key.startsWith('T:') ? key.slice(2).split('|')[0] : 'cream', ws = wallSet(k), m = new THREE.Mesh(mergeGeometries(list), std({ vertexColors: true, map: ws.map, normalMap: ws.normalMap, roughness: ws.roughness }));
      m.castShadow = m.receiveShadow = true; walls.add(m); }
    if (glass.length) { const gm = new THREE.Mesh(mergeGeometries(glass), MAT.glass); gm.userData.glass = true; walls.add(gm); }
    walls.traverse(o => { o.userData.wall = true; });
    const plaster = wallSet('cream'), ceilMat = std({ color: CEILING, map: plaster.map, normalMap: plaster.normalMap, roughness: 0.95 }), ao = [];
    L.rooms.forEach((r, i) => { const st = styleOf(room, S, i), fs = floorSet(st.f), m = std({ map: fs.map.clone(), normalMap: fs.normalMap.clone(), roughness: fs.roughness, normalScale: new THREE.Vector2(0.8, 0.8) });
      for (const t of [m.map, m.normalMap]) { t.needsUpdate = true; t.repeat.set(r.w / 2, r.d / 2); t.offset.set(r.x / 2, r.y / 2); }
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), m); fl.rotation.x = -Math.PI / 2; fl.position.set(r.x + r.w / 2, 0, r.y + r.d / 2); fl.userData.floor = i; fl.receiveShadow = true; floors.add(fl);
      const cg = new THREE.PlaneGeometry(r.w, r.d); const cu = cg.attributes.uv; for (let q = 0; q < cu.count; q++) cu.setXY(q, cu.getX(q) * r.w / 1.3, cu.getY(q) * r.d / 1.3);
      const ce = new THREE.Mesh(cg, ceilMat); ce.rotation.x = Math.PI / 2; ce.position.set(r.x + r.w / 2, H, r.y + r.d / 2); ce.userData.ceil = i; ceilings.add(ce);
      // soft darkening where the walls meet the floor and the ceiling (light gathers less in corners)
      const x0 = r.x + WALL_T, x1 = r.x + r.w - WALL_T, y0 = r.y + WALL_T, y1 = r.y + r.d - WALL_T, F = 0.42, Wd = 0.5, C = 0.32, e = 0.004;
      const q = (a, b, c2, d2) => ao.push([a, b, c2, d2]); /* each: four corners [x, up, y], the first two along the wall (dark) */
      for (const [ax, ay, bx, by, nx, ny] of [[x0, y0, x1, y0, 0, 1], [x1, y1, x0, y1, 0, -1], [x0, y1, x0, y0, 1, 0], [x1, y0, x1, y1, -1, 0]]) {
        q([ax, e, ay], [bx, e, by], [bx + nx * F, e, by + ny * F], [ax + nx * F, e, ay + ny * F]);
        q([ax + nx * e, 0, ay + ny * e], [bx + nx * e, 0, by + ny * e], [bx + nx * e, Wd, by + ny * e], [ax + nx * e, Wd, ay + ny * e]);
        q([ax + nx * e, H, ay + ny * e], [bx + nx * e, H, by + ny * e], [bx + nx * e, H - C, by + ny * e], [ax + nx * e, H - C, ay + ny * e]); } });
    if (ao.length) { const pos = [], uv = [], idx = []; ao.forEach(([a, b, c2, d2], n) => { pos.push(...a, ...b, ...c2, ...d2); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.map((v, i2) => i2 % 2 ? v : 0.5), 2)); g.setIndex(idx);
      const am = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: linearTex(), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })); am.renderOrder = 1; aoG.add(am); }
    reshadow(); dirty = true;
  }
  // ---- the neighbourhood around the home (seen from above, and through the windows) ----
  // The map's tiles are scaled so the home's plot holds the house: nearby streets, buildings (walls and roofs in their
  // own colours and heights), parks, trees and water, all merged into one mesh.
  function buildAround(A) {
    for (const c of [...around.children]) { around.remove(c); c.geometry.dispose(); }
    const h = A && A.home; if (!h || h.x == null) return;
    const U = (S + 2.5) / Math.max(h.w || 1, h.d || 1), cx = h.x + (h.w || 1) / 2, cy = h.y + (h.d || 1) / 2, X = tx => (tx - cx) * U + S / 2, Y = ty => (ty - cy) * U + S / 2, list = [];
    const box = (x0, y0, z0, x1, y1, z1, c) => { const g = new THREE.BoxGeometry(Math.max(0.01, x1 - x0), Math.max(0.01, z1 - z0), Math.max(0.01, y1 - y0)); g.translate((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2); list.push(paint(g, c)); };
    const roof = (x0, y0, z0, x1, y1, hh, c) => { const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4); g.rotateY(Math.PI / 4); g.scale(x1 - x0, hh, y1 - y0); g.translate((x0 + x1) / 2, z0 + hh / 2, (y0 + y1) / 2); list.push(paint(g, c)); };
    // the home's own plot, paved round the house
    box(X(h.x) + 0.1, Y(h.y) + 0.1, -0.03, X(h.x + (h.w || 1)) - 0.1, Y(h.y + (h.d || 1)) - 0.1, 0.005, '#CFC6B4');
    // streets: tarmac, with a pavement only along the sides that don't carry on into more street
    const isRoad = new Set((A.roads || []).map(([k]) => k)), kw = U * 0.16;
    for (const [k, t] of A.roads || []) { const [tx, ty] = k.split(',').map(Number), R = ROAD_TYPES[t] || {}, walk = R.walk || R.edge || '#DCD8CE', x0 = X(tx), y0 = Y(ty), x1 = X(tx + 1), y1 = Y(ty + 1);
      box(x0, y0, -0.02, x1, y1, 0.012, R.top || '#7E8185');
      if (!isRoad.has(`${tx},${ty - 1}`)) box(x0, y0, -0.02, x1, y0 + kw, 0.05, walk); if (!isRoad.has(`${tx},${ty + 1}`)) box(x0, y1 - kw, -0.02, x1, y1, 0.05, walk);
      if (!isRoad.has(`${tx - 1},${ty}`)) box(x0, y0, -0.02, x0 + kw, y1, 0.05, walk); if (!isRoad.has(`${tx + 1},${ty}`)) box(x1 - kw, y0, -0.02, x1, y1, 0.05, walk);
      if (!R.walk && R.top) continue; const ew = isRoad.has(`${tx - 1},${ty}`) || isRoad.has(`${tx + 1},${ty}`), ns = isRoad.has(`${tx},${ty - 1}`) || isRoad.has(`${tx},${ty + 1}`); /* a dashed centre line on straight stretches */
      if (ew && !ns) box(x0 + U * 0.2, (y0 + y1) / 2 - 0.03, 0, x0 + U * 0.55, (y0 + y1) / 2 + 0.03, 0.016, '#F2F0E8'); else if (ns && !ew) box((x0 + x1) / 2 - 0.03, y0 + U * 0.2, 0, (x0 + x1) / 2 + 0.03, y0 + U * 0.55, 0.016, '#F2F0E8'); }
    for (const [k] of A.water || []) { const [tx, ty] = k.split(',').map(Number); box(X(tx), Y(ty), -0.06, X(tx + 1), Y(ty + 1), -0.01, '#4FA3D1'); }
    for (const b of A.buildings || []) {
      if (b.id === h.id || b.ruin) continue; const T = BUILDING_TYPES[b.type]; if (!T) continue; const C = T.colors || {}, w = b.w || T.size[0], d = b.d || T.size[1];
      const x0 = X(b.x), y0 = Y(b.y), x1 = X(b.x + w), y1 = Y(b.y + d);
      if (T.cat === 'nature') { const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, s = U * 0.32; box(mx - s * 0.12, my - s * 0.12, 0, mx + s * 0.12, my + s * 0.12, s * 1.1, '#6E4B2E');
        const g = new THREE.SphereGeometry(s, 10, 8); g.translate(mx, s * 1.6, my); list.push(paint(g, (C.leaf || '#3E8E41'))); continue; }
      if (T.outdoor) { box(x0 + 0.05, y0 + 0.05, -0.02, x1 - 0.05, y1 - 0.05, 0.03, C.ground || C.wall || '#9CC27A'); continue; }
      const st = T.style || 'block', pitched = ['house', 'gabled', 'tent', 'stall', 'windmill'].includes(st), lvl = 1 + 0.15 * ((b.level || 1) - 1);
      const H = Math.max(2.4, (T.height || (pitched ? 18 : 26)) * 0.24 * lvl * U / 8) * (b.done === false ? 0.45 : 1), m = Math.min(0.12 * U, 0.6);
      box(x0 + m, y0 + m, 0, x1 - m, y1 - m, H, C.wall || '#E3DCCF');
      if (pitched) roof(x0 + m - 0.08, y0 + m - 0.08, H, x1 - m + 0.08, y1 - m + 0.08, Math.max(0.8, (T.roofH || 14) * 0.2 * U / 8 * 1.6), C.roof || '#8C8783');
      else { box(x0 + m - 0.05, y0 + m - 0.05, H, x1 - m + 0.05, y1 - m + 0.05, H + 0.12, C.roof || '#8C8783'); box(x0 + m + 0.4, y0 + m + 0.4, H + 0.12, x0 + m + 0.4 + Math.min(1, (x1 - x0) * 0.2), y0 + m + 0.4 + Math.min(0.8, (y1 - y0) * 0.2), H + 0.5, '#A9A9A9'); }
      // a band of windows on each floor, on the two sides facing the camera's usual way
      for (let z = 1.1; z < H - 0.6; z += 1.6) { box(x0 + m + 0.2, y1 - m, z, x1 - m - 0.2, y1 - m + 0.03, z + 0.55, '#3C5368'); box(x1 - m, y0 + m + 0.2, z, x1 - m + 0.03, y1 - m - 0.2, z + 0.55, '#3C5368'); }
    }
    if (list.length) around.add(new THREE.Mesh(mergeGeometries(list), MAT.solid));
    dirty = true; wake();
  }
  // ---- the people here now: simple figures with their names, standing on free spots ----
  const hashS = s => { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  function nameTag(text) { const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 256; c.height = 64; g.font = 'bold 30px sans-serif'; const w = Math.min(248, g.measureText(text).width + 24);
    g.fillStyle = 'rgba(20,24,30,.72)'; g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 22); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(1.2, 0.3, 1); sp.renderOrder = 5; return sp; }
  let crowd = [];
  // a person: legs, a shirt in their own colour, arms, a head and hair (the same person always looks the same); facing -z
  function figure(name) {
    const SKIN = ['#F5D0B5', '#E0AC86', '#C68B59', '#8D5524', '#5C3A21'], h = hashS(name + 'c'), shirt = `hsl(${h % 360},55%,${40 + (h >> 9) % 20}%)`, g = new THREE.Group(), parts = [];
    const add = (geo, c, px, py, pz) => { geo.translate(px, py, pz); parts.push(paint(geo, c)); };
    add(new THREE.BoxGeometry(0.14, 0.8, 0.16), '#2C3E50', -0.09, 0.4, 0); add(new THREE.BoxGeometry(0.14, 0.8, 0.16), '#2C3E50', 0.09, 0.4, 0);
    add(new THREE.BoxGeometry(0.42, 0.6, 0.24), shirt, 0, 1.1, 0); add(new THREE.BoxGeometry(0.1, 0.55, 0.12), shirt, -0.27, 1.08, 0); add(new THREE.BoxGeometry(0.1, 0.55, 0.12), shirt, 0.27, 1.08, 0);
    add(new THREE.SphereGeometry(0.16, 12, 10), SKIN[h % SKIN.length], 0, 1.58, 0); add(new THREE.SphereGeometry(0.165, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), ['#2B1B10', '#5A3A1A', '#C9A227', '#1C1C1C', '#8E2C1C'][(h >> 4) % 5], 0, 1.62, 0.02);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.05), SKIN[h % SKIN.length], 0, 1.56, -0.17); // a nose, so you can tell which way they face
    g.add(new THREE.Mesh(mergeGeometries(parts), MAT.solid)); return g;
  }
  function buildPeople(list) {
    for (const c of [...people.children]) { people.remove(c); c.traverse(o => { o.geometry && o.geometry.dispose(); o.material?.map && o.material.map.dispose(); }); }
    crowd = (list || []).slice(0, 14); if (!crowd.length) { dirty = true; wake(); return; }
    const rooms = PLAN === 'home' ? L.rooms : L.rooms.filter(r => r.kind === 'main'), spots = [];
    for (const r of rooms) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.d; y++) if (!blocked(x + 0.5, y + 0.5) && !L.keep.has(`${x},${y}`)) spots.push([x + 0.5, y + 0.5]);
    const used = new Set();
    for (const p of crowd) { if (!spots.length) break; let k = hashS(p.name) % spots.length; for (let n = 0; n < spots.length && used.has(k); n++) k = (k + 1) % spots.length; if (used.has(k)) break; used.add(k);
      const [x, y] = spots[k], g = figure(p.name);
      const tag = nameTag(p.label || p.name); tag.position.set(0, 2.0, 0); g.add(tag);
      g.position.set(x, 0, y); g.rotation.y = (hashS(p.name + 'r') % 628) / 100; people.add(g); }
    dirty = true; wake();
  }
  // ---- other players inside right now (from the live connection) ----
  const others = new Map(); let meBubble = null, meBubbleUntil = 0;
  function bubbleSprite(text) { const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 512; c.height = 160; g.font = '600 34px sans-serif';
    const words = String(text).split(' '), lines = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > 460 && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line);
    const shown = lines.slice(0, 3); if (lines.length > 3) shown[2] = shown[2].replace(/.{0,2}$/, '…'); const w = Math.min(500, Math.max(...shown.map(l => g.measureText(l).width)) + 36), h = shown.length * 40 + 24;
    g.fillStyle = 'rgba(255,255,255,.96)'; g.beginPath(); g.roundRect((512 - w) / 2, 4, w, h, 20); g.fill(); g.fillStyle = '#1C1C1E'; g.textAlign = 'center'; g.textBaseline = 'top'; shown.forEach((l, i) => g.fillText(l, 256, 16 + i * 40));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(1.9, 0.6, 1); sp.position.set(0, 2.45, 0); sp.renderOrder = 6; return sp; }
  // in a packed room, only the nearest MAX_SHOWN people are drawn (the rest are still counted and can chat)
  const MAX_SHOWN = 20; let nearAt = 0;
  function nearest(force) { const now = performance.now(); if (!force && now - nearAt < 500) return; nearAt = now; if (others.size <= MAX_SHOWN) { for (const o of others.values()) if (!o.g.visible) { o.g.visible = true; dirty = true; } return; }
    const list = [...others.values()].sort((a, b) => Math.hypot(a.tx - me.x, a.ty - me.y) - Math.hypot(b.tx - me.x, b.ty - me.y));
    list.forEach((o, i) => { const v = i < MAX_SHOWN; if (o.g.visible !== v) { o.g.visible = v; if (v) { o.g.position.x = o.tx; o.g.position.z = o.ty; } dirty = true; } }); }
  function upsertOther(id, p) { let o = others.get(id);
    if (!o) { const g = figure(p.h || id); const tag = nameTag(p.h ? '@' + p.h : 'a visitor'); tag.position.set(0, 2.0, 0); g.add(tag); g.position.set(p.x, 0, p.y); g.rotation.y = p.a; scene.add(g); o = { g, tx: p.x, ty: p.y, ta: p.a }; others.set(id, o); }
    o.tx = p.x; o.ty = p.y; o.ta = p.a; nearest(false); if (o.g.visible) { dirty = true; wake(); } }
  function removeOther(id) { const o = others.get(id); if (!o) return; scene.remove(o.g); o.g.traverse(m => { m.geometry && m.geometry.dispose(); m.material?.map && m.material.map.dispose(); }); others.delete(id); nearest(true); dirty = true; wake(); }
  function say(id, text) { const o = id === 'me' ? null : others.get(id), on = o ? o.g : me3; if (!on) return; const sp = bubbleSprite(text);
    if (o) { if (o.bubble) { o.g.remove(o.bubble); o.bubble.material.map.dispose(); } o.bubble = sp; o.bubbleUntil = performance.now() + 7000; }
    else { if (meBubble) { me3.remove(meBubble); meBubble.material.map.dispose(); } meBubble = sp; meBubbleUntil = performance.now() + 7000; }
    on.add(sp); dirty = true; wake(); }
  // ---- the lights: a fixed number of real lights (so phones never rebuild shaders), given to the nearest sources ----
  let sources = [], blobs = null; const NL = PHONE ? 3 : 8, pool = []; /* phones: the room's light and the two nearest lamps */
  for (let n = 0; n < NL; n++) { const pl = new THREE.PointLight('#FFEBD0', 0, 5, 1.6); lights.add(pl); pool.push(pl); }
  let litFor = null;
  function placeLights(force) {
    const at = view === 'above' ? { x: S / 2, y: S / 2 } : { x: me.x, y: me.y }, key = view === 'above' ? 'above' : roomAt(S, Math.floor(at.x), Math.floor(at.y), PLAN) + ':' + Math.round(at.x / 2) + ',' + Math.round(at.y / 2);
    if (!force && key === litFor) return; litFor = key;
    const near = sources.map(s2 => ({ s2, dd: Math.hypot(s2.x - at.x, s2.y - at.y) - s2.i })).sort((a, b) => a.dd - b.dd).slice(0, NL);
    pool.forEach((pl, n) => { const o = near[n]; if (!o) { pl.intensity = 0; return; } pl.color.set(o.s2.c); pl.intensity = o.s2.i; pl.distance = o.s2.d; pl.position.set(o.s2.x, o.s2.z, o.s2.y); });
    dirty = true;
  }
  const blobMat = () => new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: radialTex('blob', [[0, '#9a9a9a'], [0.55, '#4a4a4a'], [1, '#000000']]), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  // ---- furniture and lamps ----
  function buildStuff() {
    for (const g of [stuff, wallStuff, ceilStuff]) for (const c of [...g.children]) { g.remove(c); c.traverse(o => o.geometry && o.geometry.dispose()); }
    const lamps = [];
    for (const it of room.items) { if (pick && pick.i === it.i) continue; const f = FURNITURE[it.k], g = pieceGroup(it, photoTexture(it.ph)); if (!g) continue;
      (f.mount === 'ceil' ? ceilStuff : f.mount === 'floor' ? stuff : wallStuff).add(g);
      if (f.light) { const ps = placedParts(it, TINTS[it.c || 0]).filter(p => p.s === 'l'), p = ps[0]; if (p) lamps.push({ f, it, x: p.x + p.w / 2, y: p.y + p.d / 2, z: p.z + p.h / 2 - 0.15 }); } }
    // every light source in the house: a soft ceiling light in each room (dimmer where the room has its own ceiling
    // lamp), and every lamp; the nearest few get the fixed set of real lights (placeLights)
    const roomLamp = L.rooms.map(r => !lamps.some(l => l.x >= r.x && l.x < r.x + r.w && l.y >= r.y && l.y < r.y + r.d && l.f.mount === 'ceil'));
    sources = L.rooms.map((r, i) => ({ x: r.x + r.w / 2, y: r.y + r.d / 2, z: H - 0.35, c: '#FFEBD0', i: roomLamp[i] ? 1.9 : 0.7, d: Math.max(r.w, r.d) * 1.5 + 2.5 }));
    for (const l of lamps) sources.push({ x: l.x, y: l.y, z: l.z, c: l.f.light.c === '$' ? TINTS[l.it.c || 0] : l.f.light.c, i: l.f.light.i * 2.2, d: l.f.light.d + 0.5 });
    placeLights(true);
    // a soft shadow on the floor under every floor piece (one mesh for the lot)
    const sh = []; for (const it of room.items) { const f = FURNITURE[it.k]; if (!f || f.mount !== 'floor' || f.rug || (pick && pick.i === it.i)) continue; const [w, d] = footOf(it.k, it.r), m = 0.12, g = new THREE.PlaneGeometry(w + m * 2, d + m * 2); g.rotateX(-Math.PI / 2); g.translate(it.x + w / 2, 0.006, it.y + d / 2); sh.push(g); }
    if (blobs) { scene.remove(blobs); blobs.geometry.dispose(); blobs = null; }
    if (sh.length) { blobs = new THREE.Mesh(mergeGeometries(sh), blobMat()); blobs.renderOrder = 1; scene.add(blobs); }
    applyView(); showSel(); if (crowd.length) buildPeople(crowd); reshadow(); dirty = true;
  }
  // ---- placing: the ghost piece and where it would go ----
  function showGhost() {
    for (const o of [ghost, marker]) if (o) { scene.remove(o); o.traverse(m => m.geometry && m.geometry.dispose()); }
    ghost = marker = null; if (!pick || pick.x == null) { dirty = true; return; }
    ghost = pieceGroup(pick, photoTexture(pick.ph)); if (ghost) { ghost.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.8; } }); scene.add(ghost); }
    const bad = opts.check ? opts.check(pick) : null, f = FURNITURE[pick.k], c = bad ? '#E74C3C' : '#2ECC71', m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    if (f.mount === 'floor' || f.mount === 'ceil') { const [w, d] = footOf(pick.k, pick.r), pl = new THREE.PlaneGeometry(w - 0.06, d - 0.06); pl.rotateX(-Math.PI / 2); pl.translate(pick.x + w / 2, f.mount === 'ceil' ? H - 0.02 : 0.015, pick.y + d / 2); marker = new THREE.Mesh(pl, m); }
    else { const n = footOf(pick.k, pick.r)[0], r = pick.r, pl = new THREE.PlaneGeometry(n - 0.06, 2.0), T = WALL_T + 0.01;
      pl.rotateY(r === 0 ? 0 : r === 2 ? Math.PI : r === 3 ? Math.PI / 2 : -Math.PI / 2);
      const cx = r === 0 || r === 2 ? pick.x + n / 2 : r === 1 ? pick.x + 1 - T : pick.x + T, cy = r === 1 || r === 3 ? pick.y + n / 2 : r === 0 ? pick.y + T : pick.y + 1 - T; pl.translate(cx, 1.25, cy); marker = new THREE.Mesh(pl, m); }
    scene.add(marker); dirty = true; wake();
  }
  function showSel() {
    if (selBox) { scene.remove(selBox); selBox = null; }
    if (sel) { const g = [...stuff.children, ...wallStuff.children, ...ceilStuff.children].find(o => o.userData.i === sel); if (g) { selBox = new THREE.Box3Helper(new THREE.Box3().setFromObject(g).expandByScalar(0.03), '#F1C40F'); scene.add(selBox); } }
    dirty = true;
  }
  function showGrid(on) {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid = null; }
    if (!on) return; const pts = []; for (let i = 0; i <= S; i++) { pts.push(i, 0.012, 0, i, 0.012, S, 0, 0.012, i, S, 0.012, i); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.12 })); scene.add(grid);
  }
  // where the piece being placed would go, aiming through a point on the screen (ndc), or the middle of it
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  function aim(nx = 0, ny = 0) {
    if (!pick) return; const f = FURNITURE[pick.k]; ray.setFromCamera(v2.set(nx, ny), camera); ray.near = camera.near; /* not what's hidden in front of the camera's cut-off */
    if (f.mount === 'floor' || (view === 'above' && f.mount !== 'floor')) {
      if (f.mount !== 'floor') return;
      const hits = ray.intersectObjects([...floors.children, ...walls.children], false); let p = null;
      for (const h of hits) { if (h.object.userData.floor != null) { p = h.point; break; } if (h.face && Math.abs(h.face.normal.y) < 0.5) { p = h.point.clone().addScaledVector(h.face.normal, 0.35); p.y = 0; break; } }
      if (!p) return; const [w, d] = footOf(pick.k, pick.r);
      setPick(Math.max(0, Math.min(S - w, Math.round(p.x - w / 2))), Math.max(0, Math.min(S - d, Math.round(p.z - d / 2))), pick.r); return;
    }
    if (f.mount === 'ceil') { const h = ray.intersectObjects(ceilings.children, false)[0]; if (!h) return; setPick(Math.max(0, Math.min(S - 1, Math.floor(h.point.x))), Math.max(0, Math.min(S - 1, Math.floor(h.point.z))), 0); return; }
    // on a wall (or a window): which tile it faces, and which of that tile's walls it is
    const h = ray.intersectObjects(walls.children, false).find(h => h.face && Math.abs(h.face.normal.y) < 0.5); if (!h) return;
    const n = h.face.normal, p = h.point; let tx, ty, r;
    if (Math.abs(n.x) > 0.5) { const ex = Math.round(p.x); ty = Math.floor(p.z); if (n.x > 0) { tx = ex; r = 3; } else { tx = ex - 1; r = 1; } }
    else { const ey = Math.round(p.z); tx = Math.floor(p.x); if (n.z > 0) { ty = ey; r = 0; } else { ty = ey - 1; r = 2; } }
    const len = footOf(pick.k, r)[0]; if (len > 1) { if (r % 2 === 0) tx = Math.max(0, Math.min(S - len, Math.round(p.x - len / 2))); else ty = Math.max(0, Math.min(S - len, Math.round(p.z - len / 2))); }
    if (tx < 0 || ty < 0 || tx >= S || ty >= S) return; setPick(tx, ty, r);
  }
  function setPick(x, y, r) { if (pick.x === x && pick.y === y && pick.r === r) return; pick.x = x; pick.y = y; pick.r = r; showGhost(); opts.onPick && opts.onPick(pick); }

  // ---- the views ----
  function applyView() {
    const up = view === 'above'; ceilings.visible = !up; aoG.visible = !up; litFor = null; wallStuff.visible = ceilStuff.visible = !up; walls.scale.y = up ? 0.35 : 1; walls.updateMatrixWorld(true); dirty = true;
  }
  // you: seen from behind in third person (and from above); hidden in first person
  const me3 = figure(opts.me || 'you'), meMat = MAT.solid.clone(); meMat.transparent = true; me3.children[0].material = meMat; me3.visible = false; scene.add(me3); let persp = opts.persp === 'third' ? 'third' : 'first';
  const backRay = new THREE.Raycaster();
  // how far the third-person camera can sit behind you before it would leave the house
  const roomBehind = () => { const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw), M = 0.2; let D = 2.6;
    if (fx > 1e-6) D = Math.min(D, (me.x - M) / fx); else if (fx < -1e-6) D = Math.min(D, (S - M - me.x) / -fx);
    if (fy > 1e-6) D = Math.min(D, (me.y - M) / fy); else if (fy < -1e-6) D = Math.min(D, (S - M - me.y) / -fy); return D; };
  // in third person, step forward (if there's floor) until the camera has room behind you
  function stepIn() { if (persp !== 'third') return; const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw);
    for (let i = 0; i < 30 && roomBehind() < 2.2; i++) { if (blocked(me.x + fx * 0.1, me.y + fy * 0.1)) break; me.x += fx * 0.1; me.y += fy * 0.1; } }
  const setNear = n => { if (Math.abs(camera.near - n) > 0.001) { camera.near = n; camera.updateProjectionMatrix(); } };
  function placeCamera() {
    me3.position.set(me.x, 0, me.y); me3.rotation.y = me.yaw; me3.visible = view === 'above' || persp === 'third'; meMat.opacity = 1; meMat.depthWrite = true;
    if (view === 'above') { setNear(0.05); const c = S / 2, dist = S * 1.7 + 5; camera.position.set(c + Math.sin(above.yaw) * dist * 0.62, dist, c + Math.cos(above.yaw) * dist * 0.62); camera.lookAt(c, 0, c); camera.updateMatrixWorld(); return; }
    if (persp === 'third') { // like an action game: always 2.6 m behind you at head height, looking ahead past you
      // A wall behind you doesn't push the camera in: whatever lies between the camera and you (that wall) is simply not
      // drawn, by moving the camera's near cut-off to just past it.
      const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw), CAM_H = 1.85, M = 0.2, from = new THREE.Vector3(me.x, CAM_H, me.y);
      // but it stays inside the house: never out through an outside wall (from outside you'd see the house's outer walls)
      const D = Math.max(0.3, roomBehind());
      backRay.set(from, new THREE.Vector3(-fx, 0, -fy)); backRay.far = D; const hit = backRay.intersectObjects(walls.children, false)[0];
      setNear(hit ? Math.max(0.05, Math.min(D - 0.45, D - hit.distance + 0.12)) : 0.05);
      const tight = Math.max(0, 1.6 - D); /* little room behind (your back to an outside wall in a small room): rise a little and look down over your shoulder */
      camera.position.set(me.x - fx * D, Math.min(WALL_H - 0.2, CAM_H + tight * 0.45), me.y - fy * D);
      meMat.opacity = D < 0.7 ? 0.55 + 0.45 * Math.max(0, (D - 0.3) / 0.4) : 1; meMat.depthWrite = meMat.opacity > 0.99;
      camera.rotation.set(me.pitch - 0.1 - tight * 0.4, me.yaw, 0); camera.updateMatrixWorld(); return; }
    setNear(0.05);
    camera.position.set(me.x, EYE, me.y); camera.rotation.set(me.pitch, me.yaw, 0); camera.updateMatrixWorld();
  }
  // into a room: stand on a free spot near its doorway, looking into the room
  function goRoom(i) { const r = L.rooms[i]; if (!r) return; const cx = r.x + r.w / 2, cy = r.y + r.d / 2, door = [...L.keep].map(k => k.split(',').map(Number)).filter(([x, y]) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d);
    const spots = []; for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.d; y++) spots.push([x + 0.5, y + 0.5]);
    const near = ([x, y]) => (door.length ? Math.min(...door.map(([a, b]) => Math.hypot(a + 0.5 - x, b + 0.5 - y))) : Math.hypot(cx - x, cy - y)), at = spots.sort((a, b) => near(a) - near(b)).find(([x, y]) => !blocked(x, y)) || [cx, cy];
    me.x = at[0]; me.y = at[1]; const dx = cx - me.x, dy = cy - me.y, dl = Math.hypot(dx, dy); me.yaw = dl > 0.3 ? Math.atan2(-dx, -dy) : me.yaw; me.pitch = -0.12;
    if (dl > 0.3) for (let k = 0; k < 6 && !blocked(me.x - dx / dl * 0.08, me.y - dy / dl * 0.08); k++) { me.x -= dx / dl * 0.08; me.y -= dy / dl * 0.08; } /* step back towards the doorway to see more of the room */ if (view !== 'walk') { view = 'walk'; applyView(); } stepIn(); moved(); }
  { const [k] = [...L.edges].find(([, t]) => t === 'front'); const [a, b] = k.slice(1).split(',').map(Number); me.x = a + 0.5; me.y = b - 0.3; me.yaw = 0; } // just inside the front door

  // ---- walking into walls and furniture ----
  const solidEdges = [...L.edges].filter(([, t]) => t !== 'door').map(([k]) => { const [a, b] = k.slice(1).split(',').map(Number); return k[0] === 'h' ? [a, b, a + 1, b] : [a, b, a, b + 1]; });
  function blocked(px, py) {
    const R = 0.22; if (px < R || py < R || px > S - R || py > S - R) return true;
    for (const [x0, y0, x1, y1] of solidEdges) { const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy))); if (Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) < R) return true; }
    for (const it of room.items) { const f = FURNITURE[it.k]; if (f.mount !== 'floor' || f.rug) continue; const [w, d] = footOf(it.k, it.r); if (px > it.x + 0.12 - R && px < it.x + w - 0.12 + R && py > it.y + 0.12 - R && py < it.y + d - 0.12 + R) return true; }
    return false;
  }
  let lastRoom = -1;
  let lastInput = 0;
  function moved() { lastInput = performance.now(); if (others.size > MAX_SHOWN) nearest(false); opts.onMove && opts.onMove(me.x, me.y, me.yaw); placeCamera(); if (pick && !tapAim) aim(); const ri = roomAt(S, Math.floor(me.x), Math.floor(me.y), PLAN); placeLights(false); if (ri !== lastRoom) { lastRoom = ri; opts.onRoom && opts.onRoom(ri); } dirty = true; wake(); }
  let tapAim = false;

  // ---- input ----
  const el = renderer.domElement, ptrs = new Map();
  const stick = document.createElement('div'); stick.className = 'hjoy'; stick.innerHTML = '<i></i>'; host.append(stick); const knob = stick.firstChild;
  stick.addEventListener('pointerdown', e => { e.preventDefault(); stick.setPointerCapture(e.pointerId); joy.on = true; joy.id = e.pointerId; joyMove(e); wake(); });
  const joyMove = e => { const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2; let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * R * 0.55}px,${dy * R * 0.55}px)`; };
  stick.addEventListener('pointermove', e => { if (joy.on && e.pointerId === joy.id) joyMove(e); });
  const joyEnd = () => { joy.on = false; joy.x = joy.y = 0; knob.style.transform = ''; }; stick.addEventListener('pointerup', joyEnd); stick.addEventListener('pointercancel', joyEnd);
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() }); });
  el.addEventListener('pointermove', e => { const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 6) return; tapAim = false;
    if (view === 'above') { above.yaw -= dx * 0.008; } else { me.yaw -= dx * 0.0045; me.pitch = Math.max(-1.2, Math.min(1.1, me.pitch - dy * 0.0045)); } moved(); });
  el.addEventListener('pointerup', e => { const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); if (!p) return;
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 8 && performance.now() - p.t < 450) { const r = el.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = -((e.clientY - r.top) / r.height) * 2 + 1;
      if (pick) { tapAim = true; aim(nx, ny); } else { ray.setFromCamera(v2.set(nx, ny), camera); ray.near = camera.near; const hit = ray.intersectObjects([stuff, wallStuff, ceilStuff].filter(g => g.visible), true)[0]; opts.onTap && opts.onTap(hit ? { i: hit.object.userData.i, photo: !!hit.object.userData.photo } : null); } } });
  el.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  const kd = e => { if ((e.target.closest && e.target.closest('input,textarea')) || !shown()) return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault(); wake(); } };
  const ku = e => keys.delete(e.key.toLowerCase()); addEventListener('keydown', kd); addEventListener('keyup', ku);
  el.addEventListener('wheel', e => { if (view === 'walk') { me.pitch = Math.max(-1.2, Math.min(1.1, me.pitch - e.deltaY * 0.001)); moved(); } }, { passive: true });

  // ---- the loop: runs only while something moves or changes ----
  const shown = () => host.isConnected && host.getClientRects().length > 0; /* not hidden (behind the map) */
  // Exactly one frame is ever waiting: while a frame runs, asking for another (moving, a change) only marks it as wanted.
  let raf = 0, last = null, dead = false, inTick = false;
  function resize() { const r = host.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); camera.aspect = r.width / Math.max(1, r.height); camera.fov = Math.min(95, Math.max(62, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(37)) / camera.aspect)))); camera.updateProjectionMatrix(); /* about 74° across, even on a tall phone */ dirty = true; wake(); }
  function wake() { if (!raf && !dead && !inTick) { last = null; raf = requestAnimationFrame(tick); } }
  function tick(t) {
    raf = 0; if (dead) return; inTick = true; let again = false;
    try { again = step(t); } finally { inTick = false; } /* even if a frame fails, the next one can still be asked for */
    if (again || (dirty && shown())) raf = requestAnimationFrame(tick); else last = null; /* hidden behind the map: nothing to draw, so it waits */
  }
  let lastDraw = 0, othersMoving = false;
  function step(t) {
    if (!shown()) { for (const o of others.values()) { o.g.position.x = o.tx; o.g.position.z = o.ty; o.g.rotation.y = o.ta; } dirty = true; return false; } /* hidden: jump to where people are, draw later */
    const dt = last == null ? 1 / 60 : Math.max(0, Math.min(0.05, (t - last) / 1000)); last = t; let moving = false; /* time since the last frame: never below 0 or above 1/20 s */
    let fw = -joy.y, st = joy.x; if (keys.has('w') || keys.has('arrowup')) fw += 1; if (keys.has('s') || keys.has('arrowdown')) fw -= 1; if (keys.has('a')) st -= 1; if (keys.has('d')) st += 1;
    if (keys.has('arrowleft')) { me.yaw += 1.8 * dt; moving = true; } if (keys.has('arrowright')) { me.yaw -= 1.8 * dt; moving = true; }
    if (view === 'walk' && (fw || st)) { const sp = 2.3 * dt, sx = -Math.sin(me.yaw), sy = -Math.cos(me.yaw), dx = (sx * fw + -sy * st) * sp, dy = (sy * fw + sx * st) * sp;
      const ox = me.x, oy = me.y; if (!blocked(me.x + dx, me.y)) me.x += dx; if (!blocked(me.x, me.y + dy)) me.y += dy; if (me.x !== ox || me.y !== oy) moving = true; tapAim = false; } /* pressing into a wall: nothing changes, nothing is drawn */
    if (moving) moved();
    // at most 60 frames a second (a 120 Hz screen would otherwise draw twice as many)
    const now = performance.now(), active = moving || joy.on || keys.size > 0 || now - lastInput < 160;
    const gap = active ? 15.5 : othersMoving ? 32 : 0; /* you moving: up to 60 a second; only other people moving: 30 (still smooth); nothing moving: just the one frame */
    if (dirty && shown() && now - lastDraw >= gap) { placeCamera(); renderer.render(scene, camera); dirty = false; lastDraw = now; } /* not while the map is showing */
    // other players: glide towards where they last said they were
    let gliding = false; for (const o of others.values()) if (o.g.visible) { const dx = o.tx - o.g.position.x, dz = o.ty - o.g.position.z; let da = o.ta - o.g.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(dx) + Math.abs(dz) + Math.abs(da) > 0.01) { const k = Math.min(1, dt * 8); o.g.position.x += dx * k; o.g.position.z += dz * k; o.g.rotation.y += da * k; gliding = true; dirty = true; }
      if (o.bubble && performance.now() > o.bubbleUntil) { o.g.remove(o.bubble); o.bubble.material.map.dispose(); o.bubble = null; dirty = true; } }
    othersMoving = gliding;
    if (meBubble && performance.now() > meBubbleUntil) { me3.remove(meBubble); meBubble.material.map.dispose(); meBubble = null; dirty = true; }
    return moving || joy.on || keys.size > 0 || dirty || gliding || [...others.values()].some(o => o.bubble) || !!meBubble;
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  buildShell(); buildStuff(); resize(); moved();
  { const i = roomAt(S, Math.floor(me.x), Math.floor(me.y), PLAN), r = L.rooms[i]; /* in through the front door, looking into the room */
    if (r && !blocked(me.x, me.y)) { const dx = r.x + r.w / 2 - me.x, dy = r.y + r.d / 2 - me.y; if (Math.hypot(dx, dy) > 0.3) me.yaw = Math.atan2(-dx, -dy); stepIn(); moved(); } else if (i >= 0) goRoom(i);
    /* a small step to one side, so two people coming in together don't stand inside each other */
    const rx = Math.cos(me.yaw), ry = -Math.sin(me.yaw), fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw), tries = [];
    for (const side of [0.5, 0.8, 1.1, 1.4]) for (const fwd of [0, 0.4, 0.8]) for (const sg of [-1, 1]) tries.push([sg * side, fwd]);
    tries.sort(() => Math.random() - 0.5);
    for (const [sd, fw] of tries) { const nx = me.x + rx * sd + fx * fw, ny = me.y + ry * sd + fy * fw; if (!blocked(nx, ny)) { me.x = nx; me.y = ny; moved(); break; } } }

  return {
    setRoom(r, ph, shellToo) { room = r; photos = { ...photos, ...(ph || {}) }; if (shellToo) buildShell(); buildStuff(); wake(); },
    setPick(p) { pick = p; tapAim = false; const m = p && FURNITURE[p.k].mount; showGrid(m === 'floor'); buildStuff();
      if (p && view === 'walk' && p.x == null) me.pitch = m === 'ceil' ? 0.75 : m === 'floor' ? -0.45 : 0.02; // look where this kind of piece goes
      if (p) { placeCamera(); if (p.x == null) aim(); showGhost(); opts.onPick && opts.onPick(pick); } else showGhost(); wake(); },
    refreshGhost() { showGhost(); },
    setSelected(i) { sel = i; showSel(); wake(); },
    setView(v) { view = v; applyView(); moved(); },
    setSurroundings(A) { buildAround(A); },
    setPeople(list) { buildPeople(list); },
    upsertOther, removeOther, clearOthers() { for (const id of [...others.keys()]) removeOther(id); }, say, get me() { return { x: me.x, y: me.y, a: me.yaw }; },
    get stats() { const r = renderer.info.render; return { frame: r.frame, pr: prNow, people: others.size, shown: [...others.values()].filter(o => o.g.visible).length, canvas: renderer.domElement.width + 'x' + renderer.domElement.height, calls: r.calls, triangles: r.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length }; },
    setPerspective(p) { persp = p === 'third' ? 'third' : 'first'; stepIn(); moved(); },
    get perspective() { return persp; },
    get view() { return view; },
    goRoom, roomHere: () => roomAt(S, Math.floor(me.x), Math.floor(me.y), PLAN),
    dispose() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); for (const t of photoTex.values()) t.dispose(); renderer.dispose(); renderer.domElement.remove(); stick.remove(); },
  };
}

// ---------------- little pictures of each piece, for the shop ----------------
let thumbR = null, thumbEnv = null; const thumbs = new Map();
export function thumb(k, c = 0) {
  const key = k + ':' + c; if (thumbs.has(key)) return thumbs.get(key); const f = FURNITURE[k]; if (!f) return '';
  try {
    if (!thumbR) { thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbR.setSize(160, 128, false); thumbR.setPixelRatio(1); thumbR.toneMapping = THREE.ACESFilmicToneMapping; thumbR.toneMappingExposure = 1.1;
      const pm = new THREE.PMREMGenerator(thumbR); thumbEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
    const sc = new THREE.Scene(); sc.environment = thumbEnv; sc.environmentIntensity = 0.7; sc.add(new THREE.HemisphereLight('#FFFFFF', '#9A8F82', 1.1)); const dl = new THREE.DirectionalLight('#FFF4E4', 2.2); dl.position.set(3, 5, 4); sc.add(dl);
    const g = pieceGroup({ i: 't', k, x: 0, y: 0, r: 0, c }, null); sc.add(g);
    const box = new THREE.Box3().setFromObject(g), ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), R = Math.max(sz.x, sz.y, sz.z) * 0.62 + 0.05;
    const cam = new THREE.PerspectiveCamera(32, 160 / 128, 0.01, 50), dir = f.mount === 'floor' || f.mount === 'ceil' ? new THREE.Vector3(1, 0.85, 1.3) : new THREE.Vector3(0.45, 0.25, 1.4);
    cam.position.copy(ctr).addScaledVector(dir.normalize(), R / Math.sin(THREE.MathUtils.degToRad(16))); cam.lookAt(ctr);
    thumbR.render(sc, cam); const url = thumbR.domElement.toDataURL('image/png'); sc.traverse(o => o.geometry && o.geometry.dispose()); thumbs.set(key, url); return url;
  } catch (e) { return ''; }
}
export function disposeThumbs() { if (thumbR) { thumbR.dispose(); thumbR = null; } }
