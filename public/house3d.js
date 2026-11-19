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
import { pictureMode, blackGuard, guardContext } from '/safe3d.js';
import { buildAvatar } from '/avatar3d.js';
import { build as buildCreature, follower } from '/creature3d.js';
import { defaultLook } from '/shared/avatar.js';
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
// Can this browser read a canvas back faithfully? Some (privacy settings: Safari's fingerprinting protection, some
// Android browsers) blank or scramble what getImageData returns. A normal map built from that makes surfaces face
// away from the light and render black, so on those the surface-detail layer is simply left out.
const READBACK_OK = (() => { try { const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d', { willReadFrequently: true });
  const want = [[10, 200, 30], [250, 5, 120], [128, 128, 255], [0, 0, 0]]; want.forEach(([r, gg, b], i) => { g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect((i % 2) * 4, Math.floor(i / 2) * 4, 4, 4); });
  const d = g.getImageData(0, 0, 8, 8).data; return want.every(([r, gg, b], i) => { for (const [x, y] of [[0, 0], [3, 3], [1, 2]]) { const o = (((Math.floor(i / 2) * 4 + y) * 8) + (i % 2) * 4 + x) * 4; if (d[o] !== r || d[o + 1] !== gg || d[o + 2] !== b || d[o + 3] !== 255) return false; } return true; });
} catch (e) { return false; } })();
let NORMALS = READBACK_OK, TEXTURES = true;
// Does this phone get painted pictures to the graphics chip intact? (see safe3d.js) If not even as raw pixels,
// walls, floors and fabrics are drawn in their own solid colours instead.
const useMap = t => (TEXTURES ? t : null), nm = t => (NORMALS ? t : null);
// a normal map from a greyscale height canvas (light = raised), so grout, plank joints and weave catch the light
function normalOf(hc, strength = 2) {
  if (!NORMALS) return null;
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
  else if (s === 'm') { g = new THREE.IcosahedronGeometry(0.5, 3).toNonIndexed(); g.computeVertexNormals(); } /* a mirror ball: flat little mirrors that each catch the light */
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
  for (const t of [fab.map, fab.normalMap]) if (t) t.repeat.set(4, 4); for (const t of [wood.map, wood.normalMap]) if (t) t.repeat.set(2, 2);
  MATS = { plain: std({ vertexColors: true, roughness: 0.62 }), fabric: std({ vertexColors: true, roughness: 0.95, map: useMap(fab.map), normalMap: nm(fab.normalMap), normalScale: new THREE.Vector2(0.7, 0.7) }),
    wood: std({ vertexColors: true, roughness: 0.48, map: useMap(wood.map), normalMap: nm(wood.normalMap), normalScale: new THREE.Vector2(0.5, 0.5) }),
    metal: std({ vertexColors: true, roughness: 0.3, metalness: 0.85 }), gold: std({ vertexColors: true, roughness: 0.26, metalness: 1 }), gloss: std({ vertexColors: true, roughness: 0.16 }),
    leaf: std({ vertexColors: true, roughness: 0.78 }), glass: std({ color: '#DCEFFA', transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.1, depthWrite: false }),
    screen: std({ color: '#0B1220', roughness: 0.12, metalness: 0.2, emissive: '#101A2C' }) };
  return MATS;
}
const MAT = { get solid() { return mats().plain; }, get glass() { return mats().glass; }, get screen() { return mats().screen; } };
// a night club's lights: '@0'…'@5' glow in colours that keep changing; 'b' parts are beams of light that sweep about
export const PARTY = ['#FF2D95', '#3FE0FF', '#B04BFF', '#FFD23F', '#39FF88', '#FF6B2D'];
const partyAt = (t, n, out) => { const u = t * 0.55 + n, i = Math.floor(u), f = Math.max(0, (u - i - 0.72) / 0.28), s = f * f * (3 - 2 * f); /* holds a colour, then changes quickly */ return out.set(PARTY[((i % 6) + 6) % 6]).lerp(new THREE.Color(PARTY[(((i + 1) % 6) + 6) % 6]), s); };
function beamMesh(p, c) { const r = Math.max(0.006, p.w < 0.1 ? 0.012 : p.w / 2), g = new THREE.ConeGeometry(r, p.h, p.w < 0.1 ? 5 : 28, 1, true); g.translate(0, -p.h / 2, 0); /* the tip at the top */
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: p.w < 0.1 ? 0.32 : 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  const pv = new THREE.Group(); pv.position.set(p.x + p.w / 2, p.z + p.h, p.y + p.d / 2); pv.add(m); m.renderOrder = 4; return { pv, m }; }
const glow = new Map(); const glowMat = c => { if (!glow.has(c)) glow.set(c, new THREE.MeshBasicMaterial({ color: col(c).multiplyScalar(1.15) })); return glow.get(c); };
const glassMat = new Map(); const tintedGlass = c => { if (!glassMat.has(c)) glassMat.set(c, std({ color: col(c), transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false })); return glassMat.get(c); };
const haloMat = new Map(); const halo = c => { if (!haloMat.has(c)) haloMat.set(c, new THREE.SpriteMaterial({ map: radialTex('halo', [[0, 'rgba(255,255,255,.9)'], [0.25, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]), color: col(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); return haloMat.get(c); };
// which material a part is: upholstery and bedding are fabric, browns are wood, steel greys are metal, golds gold, whites and lacquer gloss, leaves leafy
const UPHOLSTERED = new Set(['loveseat', 'recliner', 'ottoman', 'diningchair', 'kingbed', 'daybed', 'blanketchest', 'gamingchair', 'readingchair', 'romanblind', 'cafecurtain', 'tapestry', 'archcurtain', 'ironing', 'vipbooth', 'clubsofa', 'velvetsofa', 'chaise', 'sofa', 'cornersofa', 'armchair', 'beanbag', 'rug', 'roundrug', 'bigrug', 'bed', 'doublebed', 'bunkbed', 'cot', 'chair', 'officechair', 'catbed', 'booth', 'waiting', 'tablefour', 'cafetable', 'barstool', 'curtains', 'blinds', 'drapes', 'doorcurtain', 'towelrail', 'coathooks', 'hamper', 'bathmat', 'throne', 'meeting', 'mannequin', 'clothesrack']);
const METAL = new Set(['#3B3B40', '#BDC3C7', '#95A5A6', '#7F8C8D', '#A6ACAF']), GOLD = new Set(['#D4AC0D', '#C9A227', '#F1C40F', '#F4D03F']), GLOSS = new Set(['#F4F6F8', '#E5E8E8', '#DADDE2', '#D5D8DC', '#E8E4DC', '#1D1B1E', '#1C1C1E', '#4A4A4E', '#F5F5F0', '#2C2A2E']);
const hsl = {}; function matKind(k, c, tint, s) {
  if (c === tint && UPHOLSTERED.has(k)) return 'fabric'; if (UPHOLSTERED.has(k) && /^#(F4F1EA|FFFFFF|F2E8D5)$/i.test(c)) return 'fabric';
  if (GOLD.has(c)) return 'gold'; if (METAL.has(c)) return 'metal'; if (GLOSS.has(c)) return 'gloss'; if (s === 'o' && /#(3E8E41|2E8B57|1E8449|27AE60)/i.test(c)) return 'leaf';
  col(c).getHSL(hsl); if (hsl.h > 0.035 && hsl.h < 0.13 && hsl.s > 0.18 && hsl.s < 0.8 && hsl.l > 0.15 && hsl.l < 0.62) return 'wood';
  return c === tint ? 'gloss' : 'plain';
}

// One piece of furniture as a group: its parts merged into one mesh per material, plus glass, screens, lamps (with a glow) and its photo.
// a lamp's glass when it's off, and a TV's picture when it's on (a soft glow of colour, with a little moving light)
const shadeOff = c => '#' + new THREE.Color(c).lerp(new THREE.Color('#8A8578'), 0.55).getHexString();
let TVON = null; function tvOnMat() { if (TVON) return TVON; const c = document.createElement('canvas'); c.width = 256; c.height = 144; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 144);
  gr.addColorStop(0, '#2E6FD8'); gr.addColorStop(0.5, '#47B5E8'); gr.addColorStop(1, '#F2A65A'); g.fillStyle = gr; g.fillRect(0, 0, 256, 144); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(70, 52, 22, 0, 7); g.fill();
  g.fillStyle = '#3E8E41'; g.fillRect(0, 100, 256, 44); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 16px sans-serif'; g.fillText('RESURGENCE TV', 120, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; TVON = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); return TVON; }
// what you can do with each piece: sit, lie down, play, use, run, or switch it (TVs on, lamps off)
const ACT = {};
for (const k of ['sofa', 'cornersofa', 'armchair', 'chair', 'officechair', 'barstool', 'beanbag', 'booth', 'waiting', 'throne']) ACT[k] = { kind: 'sit', icon: '🪑', label: 'Sit' };
ACT.toilet = { kind: 'sit', icon: '🚽', label: 'Sit' }; ACT.bike = { kind: 'sit', icon: '🚲', label: 'Ride' }; ACT.hottub = { kind: 'sit', icon: '♨️', label: 'Relax', sink: 0.42 };
for (const k of ['bed', 'doublebed', 'bunkbed']) ACT[k] = { kind: 'lie', icon: '🛏️', label: 'Lie down' };
ACT.bathtub = { kind: 'lie', icon: '🛁', label: 'Take a bath', sink: 0.3 };
ACT.piano = ACT.grandpiano = { kind: 'play', icon: '🎹', label: 'Play' }; ACT.drums = { kind: 'play', icon: '🥁', label: 'Play' };
ACT.treadmill = { kind: 'run', icon: '🏃', label: 'Run' };
ACT.stove = { kind: 'use', icon: '🍳', label: 'Cook' }; ACT.sink = ACT.basin = ACT.vanity = { kind: 'use', icon: '🚰', label: 'Wash your hands' }; ACT.arcade = { kind: 'use', icon: '🕹️', label: 'Play' };
ACT.mirror = { kind: 'use', icon: '🪞', label: 'Look in the mirror' }; ACT.fridge = { kind: 'use', icon: '🧊', label: 'Get a drink' }; ACT.gaming = { kind: 'use', icon: '🎮', label: 'Play' };
// more places to sit: sofas and armchairs (their middle), and seats picked out by part (`seats`: the cushions you can
// sit on, the nearest one is yours; `back`: the part you lean on; `faceCentre`: face the table in the middle)
for (const k of ['clubsofa', 'velvetsofa', 'leatherchair']) ACT[k] = { kind: 'sit', icon: '🛋️', label: 'Sit' };
ACT.chaise = { kind: 'sit', icon: '🛋️', label: 'Lounge', seats: [4], back: 6 };
ACT.vipbooth = { kind: 'sit', icon: '🛋️', label: 'Sit', seats: [0, 2, 4], faceCentre: true }; ACT.booth = { kind: 'sit', icon: '🪑', label: 'Sit', seats: [2, 3], faceCentre: true };
ACT.glowtable = { kind: 'sit', icon: '🪑', label: 'Sit', seats: [2, 3], faceCentre: true }; ACT.hightable = { kind: 'sit', icon: '🪑', label: 'Sit', seats: [4, 6], faceCentre: true };
ACT.cinemaseats = { kind: 'sit', icon: '🍿', label: 'Sit', seats: [1, 4, 7], back: 2 }; ACT.diningset = { kind: 'sit', icon: '🪑', label: 'Sit', seats: [8, 11], faceCentre: true };
ACT.dancefloor = ACT.bigdancefloor = { kind: 'dance', icon: '💃', label: 'Dance' }; ACT.dancepole = ACT.polestage = ACT.dancercage = { kind: 'pole', icon: '🕺', label: 'Dance on the pole' };
ACT.tv = ACT.walltv = { kind: 'tv', icon: '📺', label: 'Turn on', labelOn: 'Turn off' };
// the newer pieces: more seats and beds, a clawfoot bath, and things to use or play
for (const k of ['loveseat', 'recliner', 'ottoman', 'diningchair', 'diningbench', 'gamingchair', 'readingchair']) ACT[k] = { kind: 'sit', icon: '🪑', label: 'Sit' }; ACT.chesterfield = { kind: 'sit', icon: '🛋️', label: 'Sit' };
ACT.kingbed = ACT.daybed = { kind: 'lie', icon: '🛏️', label: 'Lie down' }; ACT.clawtub = { kind: 'lie', icon: '🛁', label: 'Take a bath', sink: 0.3 };
ACT.coffeebar = { kind: 'use', icon: '☕', label: 'Make a coffee' }; ACT.doublesink = { kind: 'use', icon: '🚰', label: 'Wash your hands' }; ACT.walloven = { kind: 'use', icon: '🍳', label: 'Cook' };
ACT.foosball = ACT.pinball = { kind: 'use', icon: '🕹️', label: 'Play' }; ACT.pingpong = { kind: 'use', icon: '🏓', label: 'Play' }; ACT.telescope = { kind: 'use', icon: '🔭', label: 'Look at the stars' };
ACT.weights = ACT.benchpress = { kind: 'use', icon: '🏋️', label: 'Lift weights' }; ACT.punchbag = { kind: 'use', icon: '🥊', label: 'Hit the bag' };
ACT.pcdesk = ACT.standingdesk = { kind: 'use', icon: '💻', label: 'Use the computer' }; ACT.ironing = { kind: 'use', icon: '👕', label: 'Iron' }; ACT.vanitytable = { kind: 'use', icon: '💄', label: 'Get ready' };
const POSE = { s: 'sit', l: 'lie', u: 'use', p: 'play', r: 'stand', d: 'dance', o: 'pole' }, CODE = { sit: 's', lie: 'l', use: 'u', play: 'p', run: 'r', dance: 'd', pole: 'o' };
export const actOf = k => ACT[k] || (FURNITURE[k]?.light ? { kind: 'light', icon: '💡', label: 'Switch off', labelOff: 'Switch on' } : null);
function pieceGroup(it, photoTex, st = {}) { /* st.off: a lamp switched off; st.on: a TV switched on */
  const f = FURNITURE[it.k]; if (!f) return null; const tint = TINTS[it.c || 0] || TINTS[0], grp = new THREE.Group(), byKind = new Map(), M = mats();
  // a door: its leaf parts go on a hinge of their own, so the door can swing open
  const all = placedParts(it, tint).filter((p, n) => !(st.bare && f.goods && f.goods.includes(n))), leafParts = all.filter(p => p.s === 'leaf'); let leaf = null;
  if (leafParts.length) { const out = leafParts[0].out || [0, 1], alongX = out[0] === 0;
    const hx = Math.min(...leafParts.map(p => p.x)), hy = Math.min(...leafParts.map(p => p.y)), mx = Math.max(...leafParts.map(p => p.x + p.w)), my = Math.max(...leafParts.map(p => p.y + p.d));
    const hinge = alongX ? new THREE.Vector3(hx, 0, (hy + my) / 2) : new THREE.Vector3((hx + mx) / 2, 0, hy);
    leaf = new THREE.Group(); leaf.position.copy(hinge); const lk = new Map();
    for (const p of leafParts) { const g = partGeo(p); g.translate(-hinge.x, 0, -hinge.z);
      if (isGlass(p.c)) { leaf.add(new THREE.Mesh(g, M.glass)); continue; } const kind = matKind(it.k, p.c, tint, 'd'); (lk.get(kind) || lk.set(kind, []).get(kind)).push(paint(g, p.c)); }
    for (const [kind, list] of lk) { const m = new THREE.Mesh(mergeGeometries(list), M[kind]); m.castShadow = m.receiveShadow = true; leaf.add(m); }
    grp.add(leaf); grp.userData.door = { leaf, sign: alongX ? -out[1] : out[0], cx: (hx + mx) / 2, cy: (hy + my) / 2, a: 0, until: 0, seg: alongX ? [hx - 0.07, (hy + my) / 2, mx + 0.07, (hy + my) / 2] : [(hx + mx) / 2, hy - 0.07, (hx + mx) / 2, my + 0.07] }; }
  for (const p of all) { if (p.s === 'leaf') continue;
    if (p.s === 'p') { const ww = p.out && p.out[0] ? p.d : p.w, pl = new THREE.PlaneGeometry(ww, p.h), o = p.out || [0, 1];
      pl.rotateY(o[1] === 1 ? 0 : o[1] === -1 ? Math.PI : o[0] === 1 ? Math.PI / 2 : -Math.PI / 2);
      pl.translate(p.x + p.w / 2 + o[0] * (Math.min(p.w, p.d) / 2 + 0.004), p.z + p.h / 2, p.y + p.d / 2 + o[1] * (Math.min(p.w, p.d) / 2 + 0.004));
      const m = new THREE.Mesh(pl, std({ ...(photoTex || TEXTURES ? { map: photoTex || placeholderTex() } : { color: '#BFD9EA' }), roughness: 0.35 })); m.userData.photo = true; grp.add(m); continue; }
    if (p.s === 'b') { const party = /^@\d/.test(p.c), { pv, m } = beamMesh(p, party ? PARTY[+p.c[1]] : p.c); if (party) m.userData.party = { n: +p.c[1] }; pv.userData.beam = { n: (all.indexOf(p) * 1.7) % 6 }; m.userData.beam = true; grp.add(pv); continue; }
    if (p.s && p.s[0] === 'l' && /^@\d/.test(p.c)) { const m = new THREE.Mesh(partGeo({ ...p, s: p.s[1] }), new THREE.MeshBasicMaterial({ color: PARTY[+p.c[1]], toneMapped: false })); m.userData.party = { n: +p.c[1], strobe: f.party === 'strobe' }; grp.add(m); continue; } /* a party light: its colour keeps changing */
    if (p.s === 'lc' || p.s === 'lo') { grp.add(new THREE.Mesh(partGeo({ ...p, s: p.s[1] }), glowMat(p.c === tint ? tint : p.c))); continue; }
    if (p.s === 'l') { const lc = p.c === tint ? tint : p.c; if (st.off) { grp.add(new THREE.Mesh(paint(partGeo(p), shadeOff(lc)), M.plain)); continue; } grp.add(new THREE.Mesh(partGeo(p), glowMat(lc)));
      if (f.light) { const sp = new THREE.Sprite(halo(lc)), s2 = Math.min(1.6, Math.max(p.w, p.d, p.h) * 2.4 + 0.3); /* (a long strip of light gets a soft glow, not a huge one) */ sp.scale.set(s2, s2, 1); sp.position.set(p.x + p.w / 2, p.z + p.h / 2, p.y + p.d / 2); sp.renderOrder = 3; sp.userData.halo = true; grp.add(sp); } continue; }
    if (p.s === 's') { grp.add(new THREE.Mesh(partGeo(p), st.on ? tvOnMat() : M.screen)); continue; }
    if (p.s === 'g' || isGlass(p.c)) { grp.add(new THREE.Mesh(partGeo(p), isGlass(p.c) ? M.glass : tintedGlass(p.c))); continue; }
    const kind = matKind(it.k, p.c, tint, p.s); (byKind.get(kind) || byKind.set(kind, []).get(kind)).push(paint(partGeo(p), p.c));
  }
  for (const [kind, list] of byKind) { const m = new THREE.Mesh(mergeGeometries(list), M[kind]); m.castShadow = m.receiveShadow = true; grp.add(m); }
  grp.userData = { i: it.i, k: it.k, door: grp.userData.door }; grp.traverse(o => { o.userData.i = it.i; }); return grp;
}

// ---------------- the house ----------------
// Before a home opens: paint the floor, wall and fabric textures it needs, one at a time with a breath between each,
// so the page never locks up (the entrance animation keeps moving). onStep(done, total) reports progress.
const breathe = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
export async function prepare(room, S, plan, onStep) {
  const L = layoutOf(S, plan || 'home'), jobs = new Map();
  L.rooms.forEach((r, i) => { const st = styleOf(room, S, i); jobs.set('floor-' + st.f, () => floorSet(st.f)); jobs.set('wall-' + st.w, () => wallSet(st.w)); });
  jobs.set('wall-cream', () => wallSet('cream')); jobs.set('d-fabric', () => detail('fabric')); jobs.set('d-wood', () => detail('wood'));
  let n = 0; for (const [, job] of jobs) { job(); onStep && onStep(++n, jobs.size); await breathe(); }
}
export function createHouse(host, opts) {
  const S = opts.size, PLAN = opts.plan || 'home', L = layoutOf(S, PLAN), H = WALL_H, PLAN_CLUB = PLAN === 'club';
  // Film-like colour (ACES), sunlight through the windows with real shadows (worked out only when the house changes,
  // not every frame), a soft reflection of a bright room on every surface, and a fixed set of lamps that follows you
  // from room to room (a fixed number, so a phone never has to rebuild its shaders while you walk).
  const renderer = new THREE.WebGLRenderer({ antialias: !PHONE || (devicePixelRatio || 1) < 2.5, powerPreference: 'high-performance' });
  const DPR = devicePixelRatio || 1, PR_HI = Math.min(DPR, PHONE ? (HQ ? 1.5 : 1.25) : 2), prNow = PR_HI;
  renderer.setPixelRatio(PR_HI); renderer.domElement.className = 'house3d'; host.append(renderer.domElement);
  if (pictureMode(renderer) === 'plain') { TEXTURES = false; NORMALS = false; } if (renderer.capabilities.precision !== 'highp') NORMALS = false; /* a GPU without full precision can also turn surface detail black */
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92; /* a little softer than daylight outside */
  renderer.shadowMap.enabled = HQ; renderer.shadowMap.type = PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; /* phones: the cheaper filter (the shadows are still soft-edged) */ renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(); scene.background = col('#BFE3F7');
  const reflections = () => { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); scene.environmentIntensity = PLAN_CLUB ? 0.1 : 0.38; }; /* a night club is dark, lit by its own lights */
  reflections();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 140); camera.rotation.order = 'YXZ';
  const hemiL = new THREE.HemisphereLight('#FFF8EE', '#7A6E62', PLAN_CLUB ? 0.13 : 0.5); scene.add(hemiL);
  const sun = new THREE.DirectionalLight('#FFE9C8', PLAN_CLUB ? 0.28 : 2.35); if (PLAN_CLUB) { renderer.toneMappingExposure = 0.9; scene.add(new THREE.AmbientLight('#C8B8FF', 0.6)); } /* a soft violet fill so people show up in the dark */ sun.position.set(S / 2 - S * 0.9, 7.5, S / 2 + S * 0.7); sun.target.position.set(S / 2, 0, S / 2); scene.add(sun, sun.target);
  if (HQ) { sun.castShadow = true; const sc = sun.shadow.camera, R = S * 0.85 + 1; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = 30; sun.shadow.mapSize.set(PHONE ? 1024 : 2048, PHONE ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3; }
  const reshadow = () => { if (HQ) renderer.shadowMap.needsUpdate = true; };
  { const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), std({ color: '#7FB069', roughness: 1 })); g.rotation.x = -Math.PI / 2; g.position.set(S / 2, -0.02, S / 2); g.receiveShadow = true; scene.add(g); }
  const aoG = new THREE.Group(), shell = new THREE.Group(), walls = new THREE.Group(), ceilings = new THREE.Group(), floors = new THREE.Group(), stuff = new THREE.Group(), wallStuff = new THREE.Group(), ceilStuff = new THREE.Group(), lights = new THREE.Group();
  const people = new THREE.Group(), around = new THREE.Group(); scene.add(people); shell.add(walls, ceilings, floors, aoG); scene.add(shell, stuff, wallStuff, ceilStuff, lights, around);
  const offLights = new Set(), tvOn = new Set(); let act = null, nearAct = null, actKey = ''; /* lamps switched off, TVs on; what you're doing (sitting, lying…) */
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
      const ws = st.k ? wallSet(st.k) : wallSet('cream'), tex = ws.textured && TEXTURES, key = (tex ? 'T:' + st.k : 'P:') + '|' + (tex ? '#ffffff' : st.c); (textured.get(key) || textured.set(key, []).get(key)).push(paint(geo, tex ? '#ffffff' : st.c)); };
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
    for (const [key, list] of textured) { const k = key.startsWith('T:') ? key.slice(2).split('|')[0] : 'cream', ws = wallSet(k), m = new THREE.Mesh(mergeGeometries(list), std({ vertexColors: true, map: useMap(ws.map), normalMap: nm(ws.normalMap), roughness: ws.roughness }));
      m.castShadow = m.receiveShadow = true; walls.add(m); }
    if (glass.length) { const gm = new THREE.Mesh(mergeGeometries(glass), MAT.glass); gm.userData.glass = true; walls.add(gm); }
    walls.traverse(o => { o.userData.wall = true; });
    const plaster = wallSet('cream'), ceilMat = std({ color: CEILING, map: useMap(plaster.map), normalMap: nm(plaster.normalMap), roughness: 0.95 }), ao = [];
    L.rooms.forEach((r, i) => { const st = styleOf(room, S, i), fs = floorSet(st.f), m = std({ ...(TEXTURES ? {} : { color: FLOORS[st.f]?.a || '#C8A273' }), map: TEXTURES ? fs.map.clone() : null, normalMap: NORMALS && fs.normalMap ? fs.normalMap.clone() : null, roughness: fs.roughness, normalScale: new THREE.Vector2(0.8, 0.8) });
      for (const t of [m.map, m.normalMap]) { if (!t) continue; t.needsUpdate = true; t.repeat.set(r.w / 2, r.d / 2); t.offset.set(r.x / 2, r.y / 2); }
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
    box(X(h.x) + 0.1, Y(h.y) + 0.1, -0.035, X(h.x + (h.w || 1)) - 0.1, Y(h.y + (h.d || 1)) - 0.1, -0.012, '#CFC6B4'); /* below the floors (it used to sit just above them and hid them) */
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
  // a person: their own character (or, for someone who hasn't made one, the look the map gives them). Faces -z, like you.
  function figure(name, look, own = false, g = 'm') {
    const av = buildAvatar(look || defaultLook(name, g), { own }), w = new THREE.Group(); av.group.rotation.y = Math.PI; w.add(av.group); w.userData.av = av; return w; }
  const dropFigure = w => { w.userData.av && w.userData.av.dispose(); w.traverse(o => { if (o.isSprite) { o.material.map && o.material.map.dispose(); o.material.dispose(); } }); };
  let crowdKey = '', crowdRun = 0;
  function buildPeople(list) {
    const key = (list || []).slice(0, 14).map(p => p.name + ':' + (p.look ? JSON.stringify(p.look) : p.g || '')).join('|'); if (key === crowdKey) return; crowdKey = key; /* the same people: nothing to rebuild */
    crowdRun++; for (const c of [...people.children]) { people.remove(c); dropFigure(c); }
    crowd = (list || []).slice(0, 14); if (!crowd.length) { dirty = true; wake(); return; }
    const rooms = PLAN === 'home' ? L.rooms : L.rooms.filter(r => r.kind === 'main'), spots = [];
    for (const r of rooms) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.d; y++) if (!blocked(x + 0.5, y + 0.5) && !L.keep.has(`${x},${y}`)) spots.push([x + 0.5, y + 0.5]);
    const used = new Set(), run = ++crowdRun, places = [];
    for (const p of crowd) { if (!spots.length) break; let k = hashS(p.name) % spots.length; for (let n = 0; n < spots.length && used.has(k); n++) k = (k + 1) % spots.length; if (used.has(k)) break; used.add(k); places.push([p, spots[k]]); }
    // one person at a time, a breath apart, so a full room never freezes the screen
    (async () => { for (const [p, [x, y]] of places) { if (run !== crowdRun || dead) return;
      const g = figure(p.name, p.look, false, p.g), tag = nameTag(p.label || p.name); tag.position.set(0, 2.0, 0); g.add(tag);
      g.position.set(x, 0, y); g.rotation.y = (hashS(p.name + 'r') % 628) / 100; people.add(g); dirty = true; wake(); await breathe(); } })();
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
    if (o && p.look && o.lookKey !== JSON.stringify(p.look)) { const old = o.g.userData.av; o.g.remove(old.group); old.dispose(); const av = buildAvatar(p.look); av.group.rotation.y = Math.PI; o.g.add(av.group); o.g.userData.av = av; o.lookKey = JSON.stringify(p.look); dirty = true; } /* their own character arrived */
    if (!o) { const g = figure(p.h || id, p.look); const tag = nameTag(p.h ? '@' + p.h : 'a visitor'); tag.position.set(0, 2.0, 0); g.add(tag); g.position.set(p.x, 0, p.y); g.rotation.y = p.a; scene.add(g); o = { g, h: p.h || null, tx: p.x, ty: p.y, ta: p.a, lookKey: p.look ? JSON.stringify(p.look) : '' }; others.set(id, o); }
    { const pk = p.pose || ''; if (o.pose !== pk) { o.pose = pk; o.posed = false; } o.g.position.y = pk ? Number(p.ph) || 0 : 0; } /* sitting, lying… */
    o.tx = p.x; o.ty = p.y; o.ta = p.a; nearest(false); if (o.g.visible) { dirty = true; wake(); } }
  // pets: each person's pet follows them round the room ('me' or someone's id → a follower), smaller indoors
  const pets = new Map();
  function setPet(id, kind) { const old = pets.get(id); if (old && old.kind === kind) return; if (old) { old.f.dispose(); pets.delete(id); } if (!kind) return; try { const f = follower(kind, { scale: 0.7, near: 0.75, side: id === 'me' ? 1 : -1 }); f.group.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(f.group); pets.set(id, { kind, f }); dirty = true; wake(); } catch (e) {} }
  function removeOther(id) { setPet(id, null); const o = others.get(id); if (!o) return; scene.remove(o.g); dropFigure(o.g); others.delete(id); nearest(true); dirty = true; wake(); }
  function say(id, text) { const o = id === 'me' ? null : others.get(id), on = o ? o.g : me3; if (!on) return; const sp = bubbleSprite(text);
    if (o) { if (o.bubble) { o.g.remove(o.bubble); o.bubble.material.map.dispose(); } o.bubble = sp; o.bubbleUntil = performance.now() + 7000; }
    else { if (meBubble) { me3.remove(meBubble); meBubble.material.map.dispose(); } meBubble = sp; meBubbleUntil = performance.now() + 7000; }
    on.add(sp); dirty = true; wake(); }
  // ---- the lights: a fixed number of real lights (so phones never rebuild shaders), given to the nearest sources ----
  let party = [], sources = [], blobs = null; const NL = PHONE ? 3 : 8, pool = []; /* phones: the room's light and the two nearest lamps */
  for (let n = 0; n < NL; n++) { const pl = new THREE.PointLight('#FFEBD0', 0, 5, 1.6); lights.add(pl); pool.push(pl); }
  let litFor = null;
  function placeLights(force) {
    const at = view === 'above' ? { x: S / 2, y: S / 2 } : { x: me.x, y: me.y }, key = view === 'above' ? 'above' : roomAt(S, Math.floor(at.x), Math.floor(at.y), PLAN) + ':' + Math.round(at.x / 2) + ',' + Math.round(at.y / 2);
    if (!force && key === litFor) return; litFor = key;
    const near = sources.map(s2 => ({ s2, dd: Math.hypot(s2.x - at.x, s2.y - at.y) - s2.i })).sort((a, b) => a.dd - b.dd).slice(0, NL);
    pool.forEach((pl, n) => { const o = near[n]; if (!o) { pl.intensity = 0; return; } pl.color.set(o.s2.c); pl.userData.party = o.s2.party ? n + 0.5 : 0; pl.intensity = o.s2.i; pl.distance = o.s2.d; pl.position.set(o.s2.x, o.s2.z, o.s2.y); });
    dirty = true;
  }
  const blobMat = () => new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: radialTex('blob', [[0, '#9a9a9a'], [0.55, '#4a4a4a'], [1, '#000000']]), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  // ---- furniture and lamps ----
  function buildStuff() { boxes.clear();
    for (const g of [stuff, wallStuff, ceilStuff]) for (const c of [...g.children]) { g.remove(c); c.traverse(o => o.geometry && o.geometry.dispose()); }
    const lamps = [];
    for (const it of room.items) { if (pick && pick.i === it.i) continue; const f = FURNITURE[it.k], g = pieceGroup(it, photoTexture(it.ph), { off: offLights.has(it.i), on: tvOn.has(it.i) }); if (!g) continue;
      (f.mount === 'ceil' ? ceilStuff : f.mount === 'floor' ? stuff : wallStuff).add(g);
      if (f.light && !offLights.has(it.i)) { const ps = placedParts(it, TINTS[it.c || 0]).filter(p => p.s && p.s[0] === 'l'), p = ps[0]; if (p) lamps.push({ f, it, x: p.x + p.w / 2, y: p.y + p.d / 2, z: p.z + p.h / 2 - 0.15 }); } }
    // every light source in the house: a soft ceiling light in each room (dimmer where the room has its own ceiling
    // lamp), and every lamp; the nearest few get the fixed set of real lights (placeLights)
    const roomLamp = L.rooms.map(r => !lamps.some(l => l.x >= r.x && l.x < r.x + r.w && l.y >= r.y && l.y < r.y + r.d && l.f.mount === 'ceil'));
    sources = L.rooms.map((r, i) => PLAN_CLUB ? { x: r.x + r.w / 2, y: r.y + r.d / 2, z: H - 0.35, c: '#8E5CFF', i: r.kind === 'main' ? 1.3 : 0.7, d: Math.max(r.w, r.d) * 1.5 + 2.5, party: r.kind === 'main' } /* a club: coloured light, changing on the dance floor */
      : { x: r.x + r.w / 2, y: r.y + r.d / 2, z: H - 0.35, c: '#FFEBD0', i: roomLamp[i] ? 1.4 : 0.55, d: Math.max(r.w, r.d) * 1.5 + 2.5 });
    for (const l of lamps) sources.push({ x: l.x, y: l.y, z: l.z, c: l.f.light.c === '$' ? TINTS[l.it.c || 0] : l.f.light.c, i: l.f.light.i * 1.6, d: l.f.light.d + 0.5, party: !!l.f.party }); /* lamps light the room without bleaching the floor */
    placeLights(true);
    // a soft shadow on the floor under every floor piece (one mesh for the lot)
    const sh = []; for (const it of room.items) { const f = FURNITURE[it.k]; if (!f || f.mount !== 'floor' || f.rug || (pick && pick.i === it.i)) continue; const [w, d] = footOf(it.k, it.r), m = 0.12, g = new THREE.PlaneGeometry(w + m * 2, d + m * 2); g.rotateX(-Math.PI / 2); g.translate(it.x + w / 2, 0.006, it.y + d / 2); sh.push(g); }
    if (blobs) { scene.remove(blobs); blobs.geometry.dispose(); blobs = null; }
    if (sh.length) { blobs = new THREE.Mesh(mergeGeometries(sh), blobMat()); blobs.renderOrder = 1; scene.add(blobs); }
    party = []; for (const g of [stuff, wallStuff, ceilStuff]) g.traverse(o => { if (o.userData.beam && o.isGroup) party.push({ pv: o, n: o.userData.beam.n }); if (o.isMesh && o.userData.party) party.push({ m: o, n: o.userData.party.n, strobe: o.userData.party.strobe }); }); /* club lights to keep moving */
    applyView(); showSel(); if (crowd.length) buildPeople(crowd); reshadow(); dirty = true; wake();
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
    if (f.mount === 'door') { let best = null, bd = 0.9; const c = camera.position, pt = new THREE.Vector3();
      for (const [k, t] of L.edges) { if (t !== 'door') continue; const [a, b] = k.slice(1).split(',').map(Number), horiz = k[0] === 'h';
        pt.set(horiz ? a + 0.5 : a, 1.05, horiz ? b : b + 0.5); if (pt.clone().sub(c).dot(ray.ray.direction) <= 0) continue; const d = ray.ray.distanceToPoint(pt); if (d < bd) { bd = d; best = [horiz, a, b]; } }
      if (!best) return; const [horiz, a, b] = best; /* hung on the side you're standing on, so it swings into your room */
      if (horiz) { if (c.z < b) setPick(a, b - 1, 2); else setPick(a, b, 0); } else { if (c.x < a) setPick(a - 1, b, 1); else setPick(a, b, 3); } return; }
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
  let me3 = figure(opts.me || 'you', opts.look, true); me3.visible = false; const meFade = o => me3.userData.av.setOpacity(o); scene.add(me3); let persp = opts.persp === 'third' ? 'third' : 'first';
  // The third-person camera: framed like an action game, whatever the screen's shape: your head about the middle of the
  // picture and your feet at its bottom edge. On a tall phone (a wide view) that's about 1.4 m behind you; on a wide
  // screen about 2.5 m. Worked out again whenever the screen changes shape.
  const backRay = new THREE.Raycaster(), CAM_H = 1.95; let CAM_BACK = 1.9, CAM_TILT = 0.2;
  function frameThird() { const F = THREE.MathUtils.degToRad(camera.fov / 2), want = 0.96 * F + THREE.MathUtils.degToRad(2), gap = d => Math.atan(CAM_H / d) - Math.atan((CAM_H - 1.8) / d);
    let lo = 0.8, hi = 4; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (gap(m) > want) lo = m; else hi = m; }
    CAM_BACK = Math.max(1.2, Math.min(2.8, (lo + hi) / 2)); CAM_TILT = Math.atan((CAM_H - 1.8) / CAM_BACK) + THREE.MathUtils.degToRad(2); }
  // how far the third-person camera can sit behind you before it would leave the house
  const roomBehind = () => { const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw), M = 0.2; let D = CAM_BACK;
    if (fx > 1e-6) D = Math.min(D, (me.x - M) / fx); else if (fx < -1e-6) D = Math.min(D, (S - M - me.x) / -fx);
    if (fy > 1e-6) D = Math.min(D, (me.y - M) / fy); else if (fy < -1e-6) D = Math.min(D, (S - M - me.y) / -fy); return D; };
  // in third person, step forward (if there's floor) until the camera has room behind you
  function stepIn() { if (persp !== 'third' || act) return; const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw);
    const need = Math.min(CAM_BACK, 1.4); for (let i = 0; i < 14 && roomBehind() < need; i++) { /* a short step at most, so the camera has a little room */ if (blocked(me.x + fx * 0.1, me.y + fy * 0.1)) break; me.x += fx * 0.1; me.y += fy * 0.1; } }
  const setNear = n => { if (Math.abs(camera.near - n) > 0.001) { camera.near = n; camera.updateProjectionMatrix(); } };
  function placeCamera() {
    if (act) { me3.position.set(act.x, act.wy, act.y); me3.rotation.y = act.wyaw; } else { me3.position.set(me.x, 0, me.y); me3.rotation.y = me.yaw; } me3.visible = view === 'above' || persp === 'third'; meFade(1);
    if (view === 'above') { setNear(0.05); const c = S / 2, dist = S * 1.7 + 5; camera.position.set(c + Math.sin(above.yaw) * dist * 0.62, dist, c + Math.cos(above.yaw) * dist * 0.62); camera.lookAt(c, 0, c); camera.updateMatrixWorld(); return; }
    if (persp === 'third') { // like an action game: just behind you and a little above your head, looking down past you, so
      // you fill the lower half of the screen (your head about the middle, your feet at the bottom edge)
      // A wall behind you doesn't push the camera in: whatever lies between the camera and you (that wall) is simply not
      // drawn, by moving the camera's near cut-off to just past it.
      const flip = !!act && (act.kind === 'sit' || act.kind === 'dance' || act.kind === 'pole'); if (flip) me.yaw += Math.PI; /* sitting: the camera comes round to the front, so you see yourself sit (not the back of the sofa) */
      const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw), M = 0.2, from = new THREE.Vector3(me.x, 1.85, me.y);
      // but it stays inside the house: never out through an outside wall (from outside you'd see the house's outer walls)
      const D = Math.max(0.3, roomBehind());
      backRay.set(from, new THREE.Vector3(-fx, 0, -fy)); backRay.far = D; const hit = backRay.intersectObjects(walls.children, false)[0];
      setNear(hit ? Math.max(0.05, Math.min(D - 0.45, D - hit.distance + 0.12)) : 0.05);
      const tight = Math.max(0, 1.6 - D); /* little room behind (your back to an outside wall in a small room): rise a little and look down over your shoulder */
      const camY = flip ? 1.35 : Math.min(WALL_H - 0.2, CAM_H + tight * 0.45), F = THREE.MathUtils.degToRad(camera.fov / 2); camera.position.set(me.x - fx * D, camY, me.y - fy * D);
      const tilt = Math.max(CAM_TILT, Math.atan(camY / D) - 0.96 * F); /* closer than it would like: tilt down so your feet stay in the picture */
      meFade(D < 0.7 ? 0.55 + 0.45 * Math.max(0, (D - 0.3) / 0.4) : 1);
      camera.rotation.set(me.pitch + 0.1 - tilt, me.yaw, 0); camera.updateMatrixWorld(); if (flip) me.yaw -= Math.PI; return; } /* (looking up or down still works on top) */
    setNear(0.05);
    const eye = !act ? EYE : act.kind === 'lie' ? act.wy + 0.32 : act.kind === 'sit' || act.kind === 'play' ? act.wy + me3.userData.av.hipY + 0.66 : act.kind === 'run' ? EYE + 0.14 : EYE + Math.max(0, act.wy); /* lower when you sit or lie; higher up on a podium */
    camera.position.set(me.x, eye, me.y); camera.rotation.set(act && act.kind === 'lie' ? 0.85 : me.pitch, me.yaw, 0); camera.updateMatrixWorld();
  }
  // into a room: stand on a free spot near its doorway, looking into the room
  function goRoom(i) { const r = L.rooms[i]; if (!r) return; const cx = r.x + r.w / 2, cy = r.y + r.d / 2, door = [...L.keep].map(k => k.split(',').map(Number)).filter(([x, y]) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d);
    const spots = []; for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.d; y++) spots.push([x + 0.5, y + 0.5]);
    const near = ([x, y]) => (door.length ? Math.min(...door.map(([a, b]) => Math.hypot(a + 0.5 - x, b + 0.5 - y))) : Math.hypot(cx - x, cy - y)), at = spots.sort((a, b) => near(a) - near(b)).find(([x, y]) => !blocked(x, y)) || [cx, cy];
    me.x = at[0]; me.y = at[1]; const dx = cx - me.x, dy = cy - me.y, dl = Math.hypot(dx, dy); me.yaw = dl > 0.3 ? Math.atan2(-dx, -dy) : me.yaw; me.pitch = -0.12;
    if (dl > 0.3) for (let k = 0; k < 6 && !blocked(me.x - dx / dl * 0.08, me.y - dy / dl * 0.08); k++) { me.x -= dx / dl * 0.08; me.y -= dy / dl * 0.08; } /* step back towards the doorway to see more of the room */ if (view !== 'walk') { view = 'walk'; applyView(); } stepIn(); moved(); }
  { const [k] = [...L.edges].find(([, t]) => t === 'front'); const [a, b] = k.slice(1).split(',').map(Number); me.x = a + 0.5; me.y = b - 0.3; me.yaw = 0; } // just inside the front door

  // ---- walking into walls and furniture ----
  const frontAt = (() => { const e = [...L.edges].find(([, t]) => t === 'front'); if (!e) return null; const [a, b] = e[0].slice(1).split(',').map(Number); return e[0][0] === 'h' ? { x: a + 0.5, y: b } : { x: a, y: b + 0.5 }; })();
  const solidEdges = [...L.edges].filter(([, t]) => t !== 'door').map(([k]) => { const [a, b] = k.slice(1).split(',').map(Number); return k[0] === 'h' ? [a, b, a + 1, b] : [a, b, a, b + 1]; });
  function blocked(px, py) {
    const R = 0.22; if (px < R || py < R || px > S - R || py > S - R) return true;
    const near = e => { const x0 = e[0], y0 = e[1], dx = e[2] - x0, dy = e[3] - y0, t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) < R; };
    for (let i = 0; i < solidEdges.length; i++) if (near(solidEdges[i])) return true; /* (the walls as they are: no copy of the list made for every step) */
    for (const g of wallStuff.children) { const D = g.userData.door; if (D && D.a < 0.9 && near(D.seg)) return true; } /* a door that isn't open is in the way */
    for (const it of room.items) { const f = FURNITURE[it.k]; if (f.mount !== 'floor' || f.rug) continue; const [w, d] = footOf(it.k, it.r); if (px > it.x + 0.12 - R && px < it.x + w - 0.12 + R && py > it.y + 0.12 - R && py < it.y + d - 0.12 + R) return true; }
    return false;
  }
  // ---- a store's goods on display (shared/stores.js): phones on the display counters, a real car on each showroom
  // stand (in place of the stand's own model), pets in the cages; a price tag over each, "Sold out" where an owner has
  // none left. Tapping one opens the store's shop on that product (opts.onProduct). ----
  const show = new THREE.Group(); scene.add(show); let showSpec = null, showHidden = new Set(), showTok = 0;
  const SCREENS = new Map(), screenTex = tier => { let t = SCREENS.get(tier); if (t) return t; const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
    const cols = [['#9fbf6a', '#7da24a'], ['#8ec5fc', '#e0c3fc'], ['#ff5f6d', '#3a1c71'], ['#00c6ff', '#7f00ff'], ['#43e97b', '#38f9d7'], ['#f7971e', '#b06ab3']][tier] || ['#444', '#222'], gr = g.createLinearGradient(0, 0, 64, 128);
    gr.addColorStop(0, cols[0]); gr.addColorStop(1, cols[1]); g.fillStyle = gr; g.fillRect(0, 0, 64, 128); if (tier >= 2) { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 14px system-ui'; g.textAlign = 'center'; g.fillText('9:41', 32, 30); }
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; SCREENS.set(tier, t); return t; };
  const priceTag = (name, price, out) => { const c = document.createElement('canvas'); c.width = 256; c.height = 72; const g = c.getContext('2d'); g.fillStyle = out ? 'rgba(120,30,25,.9)' : 'rgba(20,18,16,.82)'; if (g.roundRect) { g.beginPath(); g.roundRect(4, 4, 248, 64, 18); g.fill(); } else g.fillRect(4, 4, 248, 64);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 24px system-ui, sans-serif'; g.fillText(name.length > 18 ? name.slice(0, 17) + '…' : name, 128, 32); g.font = '600 20px system-ui, sans-serif'; g.fillStyle = out ? '#ffd0c8' : '#f2c94c'; g.fillText(out ? 'Sold out' : price, 128, 58);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.scale.set(0.46, 0.13, 1); return sp; };
  function phoneModel(P) { const g = new THREE.Group(), body = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.35, 0.02, 2, 0.026), new THREE.MeshStandardMaterial({ color: P.col || '#333', roughness: 0.35, metalness: P.tier >= 3 ? 0.7 : 0.15 }));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.32), new THREE.MeshBasicMaterial({ map: screenTex(P.tier || 0), toneMapped: false })); scr.position.z = 0.0105; g.add(body, scr);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.08), new THREE.MeshStandardMaterial({ color: '#d5d8dc', roughness: 0.4, metalness: 0.6 })); stand.position.set(0, -0.175, -0.02); g.add(stand); g.rotation.x = -0.18; return g; }
  // where things stand: the slots on each piece of display furniture (in the room, whatever way it's turned). Each kind
  // of stand takes certain goods: phones and jewellery on a display counter, clothes on mannequins and rails, shoes on a
  // shoe wall, jewellery in a jewellery counter, furniture and appliances on a display platform, a car, pets.
  const STANDS = { display: ['phone', 'jewel'], showcar: ['car'], petcages: ['pet'], mannequin: ['garment', 'acc'], clothesrack: ['garment'], shoewall: ['shoe'], jewelcase: ['jewel'], showplinth: ['home'] };
  const middle = () => { const r = L.rooms.find(q => q.kind === 'main') || L.rooms[0]; return r ? [r.x + r.w / 2, r.y + r.d / 2] : [S / 2, S / 2]; };
  function slotsOf() { const per = [], [mx, my] = middle();
    for (const it of room.items) { const k = it.k, takes = STANDS[k]; if (!takes) continue;
      const b = boxOf(it), ps = placedParts(it, '#ffffff'), top = Math.max(...ps.map(p => p.z + p.h)), long = (b.x1 - b.x0) >= (b.y1 - b.y0), len = long ? b.x1 - b.x0 : b.y1 - b.y0, wid = long ? b.y1 - b.y0 : b.x1 - b.x0, ry = long ? 0 : Math.PI / 2;
      const toMid = Math.atan2(long ? 0 : mx - b.cx, long ? my - b.cy : 0); /* facing into the room, square to the stand */
      const mine = []; per.push(mine); const at = (u, v, z, o) => mine.push({ it, k, takes, x: long ? b.x0 + len * u : b.x0 + wid * v, y: long ? b.y0 + wid * v : b.y0 + len * u, z, ry: ry, face: toMid, len, wid, ...o });
      if (k === 'display') { const face = [0, -Math.PI / 2, Math.PI, Math.PI / 2][(it.r || 0) % 4]; for (let n = 0; n < 3; n++) at((n + 0.5) / 3, 0.5, top, { face }); } /* phones face the way the counter does */
      else if (k === 'showcar') at(0.5, 0.5, 0.12);
      else if (k === 'petcages') for (let n = 0; n < 2; n++) at((n + 0.5) / 2, 0.5, 0.5);
      else if (k === 'mannequin' || k === 'showplinth') { const base = ps[k === 'mannequin' ? 0 : 1]; mine.push({ it, k, takes, x: base.x + base.w / 2, y: base.y + base.d / 2, z: base.z + base.h, face: Math.atan2(mx - (base.x + base.w / 2), my - (base.y + base.d / 2)), len: Math.min(base.w, base.d), wid: Math.min(base.w, base.d) }); }
      else if (k === 'clothesrack') { const rail = ps[2], rl = rail.w >= rail.d; for (let n = 0; n < 4; n++) { const u = (n + 0.5) / 4; mine.push({ it, k, takes, x: rl ? rail.x + 0.12 + (rail.w - 0.24) * u : rail.x + rail.w / 2, y: rl ? rail.y + rail.d / 2 : rail.y + 0.12 + (rail.d - 0.24) * u, z: rail.z, face: toMid }); } }
      else if (k === 'shoewall') { const bk = ps[0], s1 = ps[1], ox = (s1.x + s1.w / 2) - (bk.x + bk.w / 2), oy = (s1.y + s1.d / 2) - (bk.y + bk.d / 2), face = Math.abs(ox) > Math.abs(oy) ? Math.atan2(Math.sign(ox), 0) : Math.atan2(0, Math.sign(oy)); /* out from the wall: from the back board to the shelves */ for (const sh of ps.slice(1, 4)) { const sl = sh.w >= sh.d; for (let n = 0; n < 3; n++) { const u = (n + 0.5) / 3; mine.push({ it, k, takes, x: sl ? sh.x + sh.w * u : sh.x + sh.w / 2, y: sl ? sh.y + sh.d / 2 : sh.y + sh.d * u, z: sh.z + sh.h, face, small: 1 }); } } }
      else if (k === 'jewelcase') { const pad = ps[3], pl = pad.w >= pad.d; for (const v of [0.72, 0.28]) for (let n = 0; n < 3; n++) { const u = (n + 0.5) / 3; mine.push({ it, k, takes, x: pl ? pad.x + pad.w * u : pad.x + pad.w * v, y: pl ? pad.y + pad.d * v : pad.y + pad.d * u, z: pad.z + pad.h, face: toMid, small: 1, row: v > 0.5 ? 1 : 0 }); } } }
    const out = []; for (let k2 = 0; per.some(l => l[k2]); k2++) for (const l of per) if (l[k2]) out.push(l[k2]); /* one on each stand first, then the next along: the goods spread round the store */
    return out; }
  // the goods themselves
  const METAL = { gold: '#E2B13C', rose: '#E3A68C', silver: '#CDD3DB', ice: '#F2F8FF' };
  const metalMat = c => new THREE.MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.25 }), clothMat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }), plainMat = (c, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  function garmentModel(P) { const g = new THREE.Group(), m = clothMat(P.col || '#3E5C9A'), hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 4, 10, Math.PI * 1.3), metalMat('#BDC3C7')); hook.position.y = -0.02; g.add(hook);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.02), metalMat('#BDC3C7')); bar.position.y = -0.07; g.add(bar);
    if (P.slot === 'bot') { for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, P.short ? 0.3 : 0.62, 0.04), m); leg.position.set(s * 0.075, P.short ? -0.25 : -0.41, 0); g.add(leg); } const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.045), m); w.position.y = -0.11; g.add(w); }
    else { const long = P.full ? 0.95 : P.slot === 'out' && P.long ? 0.85 : 0.5, body = new THREE.Mesh(new THREE.BoxGeometry(0.34, long, 0.05), m); body.position.y = -0.08 - long / 2; g.add(body);
      if (!P.bare) for (const s of [-1, 1]) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.09, P.longSleeve ? 0.42 : 0.18, 0.045), m); sl.position.set(s * 0.2, -0.1 - (P.longSleeve ? 0.21 : 0.09), 0); sl.rotation.z = s * 0.35; g.add(sl); } }
    return g; }
  function shoeModel(P) { const g = new THREE.Group(), m = plainMat(P.col || '#333', 0.45), sole = plainMat(P.white ? '#F2F0EA' : '#1d1b19', 0.7);
    for (const s of [-1, 1]) { const f = new THREE.Group(); f.position.x = s * 0.06;
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.15, 4, 10), m); up.rotation.x = Math.PI / 2; up.scale.set(1, 1, 0.82); up.position.set(0, 0.05, 0); f.add(up);
      const so = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.024, 0.25), sole); so.position.y = 0.012; f.add(so);
      if (P.high) { const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, P.boot ? 0.22 : 0.12, 12), m); sh.position.set(0, 0.06 + (P.boot ? 0.11 : 0.06), -0.06); f.add(sh); }
      if (P.heel) { const h = new THREE.Mesh(new THREE.CylinderGeometry(P.thin ? 0.007 : 0.012, P.thin ? 0.004 : 0.009, 0.08, 8), m); h.position.set(0, 0.04, -0.1); f.add(h); }
      g.add(f); }
    return g; }
  function jewelModel(P) { const g = new THREE.Group(), mm = metalMat(P.metal || METAL.gold), ice = metalMat(METAL.ice), sc = 1.8;
    const s = P.slot, key = P.key;
    if (s === 'wrist') { const band = new THREE.Mesh(new THREE.TorusGeometry(0.04, P.bracelet ? 0.005 : 0.009, 6, 20), P.leather ? plainMat(P.col || '#1d1b19') : mm); band.position.y = 0.045; g.add(band);
      if (!P.bracelet) { const f = new THREE.Mesh(key === 'smartwatch' ? new THREE.BoxGeometry(0.03, 0.036, 0.012) : new THREE.CylinderGeometry(0.017, 0.017, 0.01, 16), key === 'smartwatch' ? plainMat('#1d1b19', 0.3) : mm); if (key !== 'smartwatch') f.rotation.x = Math.PI / 2; f.position.set(0, 0.045, 0.042); g.add(f);
        const dial = new THREE.Mesh(new THREE.CircleGeometry(key === 'smartwatch' ? 0.012 : 0.013, 16), new THREE.MeshBasicMaterial({ color: key === 'smartwatch' ? '#3E8EDE' : key === 'diamondwatch' ? '#1F2E55' : '#F4F1EA' })); dial.position.set(0, 0.045, 0.049); g.add(dial); } }
    else if (s === 'neck') { const ch = new THREE.Mesh(new THREE.TorusGeometry(0.07, P.thick ? 0.007 : 0.003, 6, 30), key === 'iced' ? ice : mm); ch.rotation.x = -Math.PI / 2; ch.position.y = 0.006; ch.scale.set(1, 1.25, 1); g.add(ch);
      if (P.pearl) { ch.material = plainMat('#F4EFE6', 0.3); }
      if (P.gem) { const pe = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 4), key === 'diamondpendant' ? ice : mm); pe.position.set(0, 0.012, 0.09); g.add(pe); } }
    else if (s === 'ear') { for (const x of [-0.025, 0.025]) { const e = key === 'hoops' ? new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 6, 16), mm) : new THREE.Mesh(new THREE.SphereGeometry(key === 'diamondstuds' ? 0.009 : 0.007, 8, 6), key === 'diamondstuds' ? ice : mm); e.position.set(x, key === 'hoops' ? 0.02 : 0.008, 0); g.add(e); } }
    else if (s === 'ring') { const r = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 16), mm); r.position.y = 0.017; g.add(r); if (key === 'diamondring') { const d = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 4), ice); d.position.y = 0.035; g.add(d); } }
    else if (key === 'crown') { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 18, 1, true), mm); c.material.side = THREE.DoubleSide; c.position.y = 0.02; g.add(c); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, t = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.03, 5), mm); t.position.set(Math.sin(a) * 0.06, 0.055, Math.cos(a) * 0.06); g.add(t); } }
    g.scale.setScalar(sc); return g; }
  // a piece of furniture or an appliance, on a platform: made smaller if it wouldn't fit, standing on the top
  function homeModel(P, room2) { const it = { i: 'show:' + P.k, k: P.key, x: 0, y: 0, r: 0, c: P.tint || 0 }, grp = pieceGroup(it, null, {}); if (!grp) return null;
    const bb = new THREE.Box3().setFromObject(grp), sz = bb.getSize(new THREE.Vector3()), fit = Math.min(1, (room2 - 0.1) / Math.max(sz.x, sz.z, 0.01), 1.9 / Math.max(sz.y, 0.01));
    const inner = new THREE.Group(); grp.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); inner.add(grp); inner.scale.setScalar(fit); inner.userData.shared = true; return inner; }
  // a mannequin wearing it (with plain basics for whatever it doesn't cover)
  function mannequinModel(P, n) { const g = P.who === 'f' || (P.who !== 'm' && n % 2) ? 'f' : 'm', w = { [P.slot]: [P.key, P.colour || 0] };
    if (P.slot !== 'top' && P.slot !== 'out') w.top = ['tee', 0]; if (P.slot === 'out') w.top = ['tee', 0]; if (!(P.slot === 'top' && P.full) && P.slot !== 'bot') w.bot = ['trousers', 3]; if (P.slot !== 'shoe') w.shoe = ['loafers', 4];
    const A = buildAvatar({ g, sk: '#E9E4DC', hs: 'bald', hc: '#E9E4DC', ey: '#BDB6AA', w }); A.animate(0.016, 0, 0, false); A.group.userData.av = A; return A.group; }
  function clearShow() { for (const c of [...show.children, ...showStands.children]) { c.parent.remove(c); c.traverse(o => { if (o.userData.av) o.userData.av.dispose(); });
    c.traverse(o => { if (o.userData.av || isShared(o)) return; if (o.geometry) o.geometry.dispose(); if (o.material) { for (const m of [].concat(o.material)) { if (m.map && !SCREENS_HAS(m.map)) m.map.dispose(); m.dispose(); } } }); } }
  const isShared = o => { for (let p = o; p; p = p.parent) { if (p.userData.shared) { if (o.geometry) o.geometry.dispose(); return true; } if (p.userData.av) return true; } return false; }; /* (the furniture's and the people's materials are shared: only their own shapes go) */
  const showStands = new THREE.Group(); scene.add(showStands); /* the stands with goods on: without their pretend goods */
  const SCREENS_HAS = t => { for (const v of SCREENS.values()) if (v === t) return true; return false; };
  async function buildShow() { const tok = ++showTok; clearShow(); for (const i of showHidden) for (const g of [...stuff.children, ...wallStuff.children]) if (g.userData.i === i) g.visible = true; showHidden = new Set(); const spec = showSpec; if (!spec || !spec.products.length) { dirty = true; wake(); return; }
    const slots = slotsOf(); if (!slots.length) return; let W3 = null; if (spec.products.some(P => P.cls === 'car')) { try { W3 = await import('/world3d.js'); } catch (e) { return; } if (tok !== showTok) return; }
    // share the goods out: each stand in turn takes the next thing it can show (taking turns between the kinds it takes)
    const queue = new Map(); for (const P of spec.products) { const c = P.cls || spec.kind; (queue.get(c) || queue.set(c, []).get(c)).push(P); }
    const used = new Set(), turn = new Map(); let n = 0;
    for (const s of slots) { const kinds = s.takes.filter(c => queue.get(c)?.length); if (!kinds.length) continue; const t = turn.get(s.it.i) || 0; turn.set(s.it.i, t + 1); const P = queue.get(kinds[t % kinds.length]).shift(), cls = P.cls || spec.kind;
      const g = new THREE.Group(); g.position.set(s.x, s.z, s.y); g.userData.product = P.k; used.add(s.it.i);
      let tagY = 0.6, tagS = 1;
      if (cls === 'phone') { const m = phoneModel(P); m.position.y = 0.19; m.rotation.y = s.face; g.add(m); g.userData.turn = m; }
      else if (cls === 'car') { const car = W3.makeCar(P.kind && P.kind !== 'car' && P.kind !== 'bike' ? 'car' : (P.model || 'car'), P.col || '#c8382e'), [Lc] = W3.carSize(P.model || 'car'), sc = Math.min(1, (s.len - 0.2) / Math.max(1, Lc)); car.scale.setScalar(sc); car.rotation.y = s.ry + Math.PI / 2; g.add(car); tagY = 1.6; }
      else if (cls === 'pet') { const C = buildCreature(P.k), b0 = new THREE.Box3().setFromObject(C.group), sz = b0.getSize(new THREE.Vector3()), fit = Math.min(1, 0.85 / Math.max(sz.x, sz.z, 0.01), 0.55 / Math.max(sz.y, 0.01)); C.animate(0.4, 0);
        C.group.scale.setScalar(fit); C.group.position.y = 0.02 - b0.min.y * fit; C.group.rotation.y = s.face || 0; C.group.userData.shared = true; g.add(C.group); g.userData.creature = C; tagY = 0.78; } /* the creature itself, standing on the cage floor behind its glass */
      else if (s.k === 'mannequin') { const m = mannequinModel(P, n); m.rotation.y = s.face; g.add(m); tagY = 2.0; }
      else if (cls === 'garment') { const m = garmentModel(P); m.rotation.y = s.face; g.add(m); tagY = 0.22; tagS = 0.8; }
      else if (cls === 'shoe') { const m = shoeModel(P); m.rotation.y = s.face; m.scale.setScalar(0.9); g.add(m); tagY = 0.27; tagS = 0.62; }
      else if (cls === 'jewel') { const m = jewelModel(P); m.rotation.y = s.face; g.add(m); tagY = s.k === 'display' ? 0.3 : 0.3 + (s.row ? 0.14 : 0); tagS = 0.62; }
      else if (cls === 'home') { const m = homeModel(P, s.len || 1.7); if (!m) continue; m.rotation.y = s.face; g.add(m); tagY = Math.min(2.3, new THREE.Box3().setFromObject(m).max.y + 0.25); }
      const tag = priceTag(P.name, P.priceText, P.out); tag.scale.multiplyScalar(tagS); tag.position.y = tagY; g.add(tag); n++;
      g.traverse(o => { if (o !== g) o.userData.product = P.k; }); show.add(g); }
    // the stands with real goods on them lose their pretend ones (a showroom's model car makes way for the real one)
    for (const i of used) { const it = room.items.find(q => q.i === i); if (!it) continue; const f = FURNITURE[it.k]; if (it.k === 'showcar') { showHidden.add(i); continue; } if (!f.goods) continue;
      const bare = pieceGroup(it, null, { bare: true }); if (!bare) continue; bare.userData.shared = true; bare.userData.i = undefined; bare.traverse(o => { o.userData.i = undefined; }); showStands.add(bare); showHidden.add(i); }
    for (const i of showHidden) for (const g of [...stuff.children, ...wallStuff.children]) if (g.userData.i === i) g.visible = false;
    dirty = true; wake(); }

  // something put down where you're standing: step aside to the nearest free spot (not stuck inside it)
  const crossesWall = (x0, y0, x1, y1) => solidEdges.some(([a, b, c, d]) => { const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px)); return o(x0, y0, x1, y1, a, b) !== o(x0, y0, x1, y1, c, d) && o(a, b, c, d, x0, y0) !== o(a, b, c, d, x1, y1); });
  function unstick() { if (act || !blocked(me.x, me.y)) return false; for (let r = 0.25; r <= 3.5; r += 0.25) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r; if (!blocked(x, y) && !crossesWall(me.x, me.y, x, y)) { /* (on your side of the wall) */ me.x = x; me.y = y; moved(); dirty = true; wake(); return true; } } return false; }
  let lastRoom = -1;
  let lastInput = 0;
  // ---- using things: walk up to something you can use and a button appears (see actOf); tap it to sit, lie down,
  // play, use it, or switch it. The joystick (or the button again) gets you up. Others in the house see you do it.
  const boxes = new Map(); /* each item's size and seat, worked out once (forgotten whenever the furniture is redrawn) */
  function boxOf(it) { const key = it.i + '|' + it.k + '|' + it.x + '|' + it.y + '|' + (it.r || 0); let bx = boxes.get(key); if (!bx) { bx = boxOf0(it); boxes.set(key, bx); } return bx; }
  function boxOf0(it) { const ps = placedParts(it, '#ffffff'); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, tall = null;
    for (const p of ps) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.d); if (!tall || p.z + p.h > tall.z + tall.h) tall = p; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; let seat = 0; /* the top of what's under the middle (the seat, the mattress), not the back or the headboard */
    for (const p of ps) { if (p === tall || p.z + p.h > 1.05) continue; if (cx >= p.x - 0.05 && cx <= p.x + p.w + 0.05 && cy >= p.y - 0.05 && cy <= p.y + p.d + 0.05) seat = Math.max(seat, p.z + p.h); }
    return { x0, y0, x1, y1, cx, cy, tx: tall ? tall.x + tall.w / 2 : cx, ty: tall ? tall.y + tall.d / 2 : cy, seat }; }
  const rectDist = (b, x, y) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
  function findNear() {
    if (view !== 'walk' || pick || (opts.canAct && !opts.canAct())) return null; let best = null, bs = 1e9; const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw);
    for (const it of room.items) { const A = actOf(it.k); if (!A) continue; const b = boxOf(it), d = rectDist(b, me.x, me.y); if (d > (FURNITURE[it.k].mount === 'ceil' ? 1.0 : 0.85)) continue;
      const vx = b.cx - me.x, vy = b.cy - me.y, vl = Math.hypot(vx, vy) || 1, sc = d - 0.3 * Math.max(0, (vx * fx + vy * fy) / vl); if (sc < bs) { bs = sc; best = { it, A, b }; } }
    return best; }
  function prompt() { let info = null;
    if (act) info = { icon: '🧍', label: act.kind === 'lie' ? 'Get up' : act.kind === 'run' ? 'Stop' : act.kind === 'dance' || act.kind === 'pole' ? 'Stop dancing' : act.kind === 'use' ? 'Step away' : 'Stand up' };
    else { nearAct = findNear(); if (nearAct) { const A = nearAct.A, i = nearAct.it.i; info = { icon: A.icon, label: A.kind === 'tv' ? (tvOn.has(i) ? A.labelOn : A.label) : A.kind === 'light' ? (offLights.has(i) ? A.labelOff : A.label) : A.label }; } }
    const k = info ? info.icon + info.label : ''; if (k !== actKey) { actKey = k; opts.onAction && opts.onAction(info); } }
  // how far forward of a seat's middle your hips go: far enough that your knees come out past its front edge (so your
  // shins hang in front of it, not through it), and never so far back that you sink into the backrest
  const seatFwd = (hd, av, backrest) => { const k = av.hipY / 0.9, thigh = 0.45 * k, back = 0.13 * k, rest = backrest ? Math.min(0.22, hd * 0.4) : 0;
    return Math.max(-hd + rest + back, Math.min(hd - 0.05, hd - thigh + 0.06)); };
  function doAct(to) {
    if (act) { standUp(); return; } nearAct = to || findNear(); if (!nearAct) return; /* to: a piece picked for you (into bed, say) */ const { it, A, b } = nearAct; if (A.kind !== 'tv' && A.kind !== 'light' && opts.onDo) try { opts.onDo(it.k, A); } catch (e) {} /* (gym equipment: a training session) */
    if (A.kind === 'tv' || A.kind === 'light') { const set = A.kind === 'tv' ? tvOn : offLights; set.has(it.i) ? set.delete(it.i) : set.add(it.i); buildStuff(); placeLights(true); actKey = ''; prompt(); dirty = true; wake(); return; }
    const av = me3.userData.av, back = { x: me.x, y: me.y, yaw: me.yaw }, fl = Math.hypot(b.cx - b.tx, b.cy - b.ty), F = fl > 0.05 ? { x: (b.cx - b.tx) / fl, y: (b.cy - b.ty) / fl } : null; /* the way it faces: away from its tallest part */
    const vl = Math.hypot(me.x - b.cx, me.y - b.cy) || 1, toMe = { x: (me.x - b.cx) / vl, y: (me.y - b.cy) / vl }; let x, y, wy, wyaw, yaw;
    if (A.kind === 'sit' && A.seats) { /* a seat picked out by part: the nearest one to you */ const ps = placedParts(it, '#ffffff'), cands = A.seats.map(n => ps[n]).filter(Boolean);
      const p = cands.sort((a, c) => Math.hypot(a.x + a.w / 2 - me.x, a.y + a.d / 2 - me.y) - Math.hypot(c.x + c.w / 2 - me.x, c.y + c.d / 2 - me.y))[0], px = p.x + p.w / 2, py = p.y + p.d / 2;
      let f = null; if (A.faceCentre) { const vx = b.cx - px, vy = b.cy - py, l = Math.hypot(vx, vy); if (l > 0.15) f = { x: vx / l, y: vy / l }; }
      if (!f && A.back != null && ps[A.back]) { const q = ps[A.back], vx = px - (q.x + q.w / 2), vy = py - (q.y + q.d / 2), l = Math.hypot(vx, vy); if (l > 0.05) f = { x: vx / l, y: vy / l }; }
      f = f || F || toMe; const hd = Math.abs(f.x) * p.w / 2 + Math.abs(f.y) * p.d / 2, fwd = seatFwd(hd, av); x = px + f.x * fwd; y = py + f.y * fwd; yaw = Math.atan2(-f.x, -f.y); wy = p.z + p.h - (A.sink || 0) + 0.075 - av.hipY; wyaw = yaw; }
    else if (A.kind === 'sit') { const f = F || toMe, px = f.y, py = -f.x, hw = Math.abs(px) * (b.x1 - b.x0) / 2 + Math.abs(py) * (b.y1 - b.y0) / 2; /* on a long sofa, the seat nearest you */
      const t = hw > 0.6 ? Math.max(-(hw - 0.42), Math.min(hw - 0.42, (me.x - b.cx) * px + (me.y - b.cy) * py)) : 0, seat = (b.seat || 0.45) - (A.sink || 0);
      const hd = Math.abs(f.x) * (b.x1 - b.x0) / 2 + Math.abs(f.y) * (b.y1 - b.y0) / 2, fwd = seatFwd(hd, av, true); x = b.cx + px * t + f.x * fwd; y = b.cy + py * t + f.y * fwd; yaw = Math.atan2(-f.x, -f.y); wy = seat + 0.075 - av.hipY; wyaw = yaw; }
    else if (A.kind === 'lie') { let H = F ? { x: -F.x, y: -F.y } : null; if (!H) H = b.x1 - b.x0 > b.y1 - b.y0 ? { x: 1, y: 0 } : { x: 0, y: 1 }; /* head towards the headboard */
      const px = H.y, py = -H.x, hw = Math.abs(px) * (b.x1 - b.x0) / 2 + Math.abs(py) * (b.y1 - b.y0) / 2, t = hw > 0.6 ? Math.sign((me.x - b.cx) * px + (me.y - b.cy) * py || 1) * hw * 0.45 : 0; /* a double bed: your side */
      x = b.cx + px * t; y = b.cy + py * t; wy = (b.seat || 0.55) - (A.sink || 0); wyaw = Math.atan2(H.x, H.y); yaw = Math.atan2(-H.x, -H.y); }
    else if (A.kind === 'dance') { /* on the dance floor: right where you are (or the middle if you're beside it) */ const inF = me.x > b.x0 + 0.2 && me.x < b.x1 - 0.2 && me.y > b.y0 + 0.2 && me.y < b.y1 - 0.2;
      x = inF ? me.x : b.cx; y = inF ? me.y : b.cy; wy = 0.05; yaw = me.yaw; wyaw = yaw; }
    else if (A.kind === 'pole') { /* by the pole, facing it, on its podium */ const px = b.tx, py = b.ty; let vx = me.x - px, vy = me.y - py; const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      x = px + vx * 0.3; y = py + vy * 0.3; wy = b.seat || 0.2; yaw = Math.atan2(vx, vy); wyaw = yaw; }
    else if (A.kind === 'run') { const f = F ? { x: -F.x, y: -F.y } : toMe; x = b.cx; y = b.cy; wy = 0.14; yaw = Math.atan2(-f.x, -f.y); wyaw = yaw; }
    else { const ex = Math.max(b.x0, Math.min(b.x1, me.x)), ey = Math.max(b.y0, Math.min(b.y1, me.y)); let ox = me.x - ex, oy = me.y - ey, ol = Math.hypot(ox, oy); if (ol < 0.01) { ox = toMe.x; oy = toMe.y; ol = 1; } /* play or use: on your side of it, facing it */
      const gap = A.kind === 'play' ? 0.42 : 0.3; x = ex + ox / ol * gap; y = ey + oy / ol * gap; yaw = Math.atan2(ox / ol, oy / ol); wy = A.kind === 'play' ? 0.5 + 0.06 - av.hipY : 0; wyaw = yaw; }
    act = { kind: A.kind, i: it.i, x, y, wy, wyaw, back }; me.x = x; me.y = y; me.yaw = yaw; me.pitch = A.kind === 'lie' ? -0.1 : -0.12; meStill = true;
    av.pose(A.kind === 'run' ? 'stand' : A.kind); actKey = ''; prompt(); opts.onMove && opts.onMove(me.x, me.y, me.yaw); dirty = true; wake(); }
  function standUp() { if (!act) return; const b = act.back; act = null; me3.userData.av.pose('stand'); if (!blocked(b.x, b.y)) { me.x = b.x; me.y = b.y; } me.yaw = b.yaw; me.pitch = 0; actKey = ''; moved(); opts.onMove && opts.onMove(me.x, me.y, me.yaw); dirty = true; wake(); }
  let nearExit = false, leftDoor = false, hintAt = 0;
  function moved() { prompt(); const fd = frontAt ? Math.hypot(me.x - frontAt.x, me.y - frontAt.y) : 99; if (fd > 1.9) leftDoor = true; const ne = view === 'walk' && leftDoor && fd < 1.4; /* only once you've walked in and come back to the door */ if (ne !== nearExit) { nearExit = ne; opts.onExit && opts.onExit(ne, false); } /* by the front door: the way out */
    lastInput = performance.now(); if (others.size > MAX_SHOWN) nearest(false); opts.onMove && opts.onMove(me.x, me.y, me.yaw); placeCamera(); if (pick && !tapAim) aim(); const ri = roomAt(S, Math.floor(me.x), Math.floor(me.y), PLAN); placeLights(false); if (ri !== lastRoom) { lastRoom = ri; opts.onRoom && opts.onRoom(ri); } dirty = true; wake(); }
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
      if (pick) { tapAim = true; aim(nx, ny); } else { ray.setFromCamera(v2.set(nx, ny), camera); ray.near = camera.near; const hit = ray.intersectObjects([stuff, wallStuff, ceilStuff].filter(g => g.visible), true)[0], wallHit = ray.intersectObjects(walls.children, false)[0];
        if (opts.onPet) { let best = null; for (const [pid, pt] of pets) { if (!pt.f.group.visible) continue; const hp = ray.intersectObject(pt.f.group, true)[0]; if (hp && (!best || hp.distance < best.d)) best = { d: hp.distance, pid, pt }; }
          if (best && (!hit || best.d < hit.distance + 0.2)) { const o = others.get(best.pid); opts.onPet({ mine: best.pid === 'me', id: best.pid, owner: o ? o.h || null : null, kind: best.pt.kind }); return; } } /* a pet: yours (follow or stay home) or someone else's (a pat) */
        { const og = [...others.values()].filter(o => o.g.visible).map(o => o.g), ph = og.length ? ray.intersectObjects(og, true)[0] : null;
          if (ph && (!hit || ph.distance < hit.distance + 0.3) && opts.onPerson) { let g = ph.object; while (g && !og.includes(g)) g = g.parent; for (const [id, o] of others) if (o.g === g) { opts.onPerson(id); return; } } } /* someone here: what to do about them (their voice, their card) */
        if (show.children.length && opts.onProduct) { const pr = ray.intersectObjects(show.children, true)[0]; if (pr && (!hit || pr.distance <= hit.distance + 0.8)) { opts.onProduct(pr.object.userData.product); return; } } /* a product on display (even behind its counter's glass): its shop */
        if (wallHit && (!hit || wallHit.distance < hit.distance) && frontAt && Math.hypot(wallHit.point.x - frontAt.x, wallHit.point.z - frontAt.y) < 0.55 && wallHit.point.y < 2.15) { opts.onExit && opts.onExit(true, true); return; } /* the front door: the way out */
        let dg = hit && hit.object; while (dg && !dg.userData.door) dg = dg.parent; if (dg) { const D = dg.userData.door; D.until = performance.now() + 4500; wake(); } /* a door: open it (it closes again by itself) */
        opts.onTap && opts.onTap(hit ? { i: hit.object.userData.i, photo: !!hit.object.userData.photo, door: !!dg } : null); } } });
  el.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  const kd = e => { if ((e.target.closest && e.target.closest('input,textarea')) || !shown()) return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault(); wake(); } };
  const ku = e => keys.delete(e.key.toLowerCase()); addEventListener('keydown', kd); addEventListener('keyup', ku);
  el.addEventListener('wheel', e => { if (view === 'walk') { me.pitch = Math.max(-1.2, Math.min(1.1, me.pitch - e.deltaY * 0.001)); moved(); } }, { passive: true });

  // ---- the weather outside, the same as on the map: through the windows the sky turns grey, the sunlight coming in
  // softens, rain falls outside (never inside), a storm flashes and fog hides the street. Fog starts beyond the house's
  // own walls, so the rooms themselves stay clear. The rain is drawn 20 times a second, and only while it rains. ----
  const WXH = { sunny: { sky: '#BFE3F7', sun: 1, hemi: 1, fog: 0, rain: 0 }, cloudy: { sky: '#C3CBD2', sun: 0.45, hemi: 0.95, fog: 0, rain: 0 }, rain: { sky: '#8F99A2', sun: 0.2, hemi: 0.86, fog: 70, rain: PHONE ? 500 : 800 },
    storm: { sky: '#646D77', sun: 0.08, hemi: 0.76, fog: 40, rain: PHONE ? 900 : 1400, wind: 0.3 }, fog: { sky: '#D7DBDE', sun: 0.3, hemi: 0.95, fog: 9, rain: 0 } };
  const sunBase = sun.intensity, hemiBase = hemiL.intensity, fogNear = S * 1.45 + 1; let wx = 'sunny', rainM = null, rainT = 0, rainAt = 0, flashH = 0, flashNext = 0;
  function setWeather(k) { k = WXH[k] ? k : 'sunny'; if (k === wx) return; wx = k; const w = WXH[k];
    scene.background = col(w.sky); if (!PLAN_CLUB) { sun.intensity = sunBase * w.sun; hemiL.intensity = hemiBase * w.hemi; }
    if (w.fog) { if (!scene.fog) scene.fog = new THREE.Fog(w.sky, fogNear, fogNear + w.fog); scene.fog.color.set(w.sky); fogView(); } else scene.fog = null;
    if (rainM) { scene.remove(rainM); rainM.geometry.dispose(); rainM.material.dispose(); rainM = null; }
    if (w.rain) { const n = w.rain, P = new Float32Array(n * 6), seed = new Float32Array(n * 3); let r = 9; const rr = () => (r = (r * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < n; i++) { let x, z; do { x = -14 + rr() * (S + 28); z = -14 + rr() * (S + 28); } while (x > -0.6 && x < S + 0.6 && z > -0.6 && z < S + 0.6); seed[i * 3] = x; seed[i * 3 + 1] = rr() * (H + 9); seed[i * 3 + 2] = z; } /* (all round the house, none inside it) */
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(S / 2, 0, S / 2), 1e4);
      rainM = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#D4DEE8', transparent: true, opacity: k === 'storm' ? 0.6 : 0.48, depthWrite: false })); rainM.frustumCulled = false; rainM.userData = { seed, wind: w.wind || 0.06, L: k === 'storm' ? 0.75 : 0.55 }; scene.add(rainM); stepRain(0); }
    reshadow(); dirty = true; wake(); }
  function fogView() { if (!scene.fog) return; const w = WXH[wx], up = view !== 'walk'; scene.fog.near = up ? 400 : fogNear; scene.fog.far = up ? 600 : fogNear + w.fog; } /* (from above: no fog over the house) */
  function stepRain(dt) { if (!rainM) return; rainT += dt; const D = rainM.userData, P = rainM.geometry.attributes.position.array, Sd = D.seed, n = Sd.length / 3, top = H + 9;
    for (let i = 0; i < n; i++) { const y = ((Sd[i * 3 + 1] - rainT * (9 + (i % 4) * 1.3)) % top + top) % top, x = Sd[i * 3] + y * D.wind, z = Sd[i * 3 + 2], j = i * 6; P[j] = x; P[j + 1] = y; P[j + 2] = z; P[j + 3] = x - D.L * D.wind; P[j + 4] = y - D.L; P[j + 5] = z; }
    rainM.geometry.attributes.position.needsUpdate = true; }
  const wxTimer = opts.weather ? setInterval(() => { try { setWeather(opts.weather()); } catch (e) {} }, 15000) : 0; if (opts.weather) setTimeout(() => { if (!dead) try { setWeather(opts.weather()); } catch (e) {} }, 0);
  // ---- the loop: runs only while something moves or changes ----
  const shown = () => host.isConnected && host.getClientRects().length > 0; /* not hidden (behind the map) */
  // Exactly one frame is ever waiting: while a frame runs, asking for another (moving, a change) only marks it as wanted.
  let raf = 0, last = null, dead = false, inTick = false;
  function resize() { const r = host.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); camera.aspect = r.width / Math.max(1, r.height); camera.fov = Math.min(95, Math.max(62, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(37)) / camera.aspect)))); camera.updateProjectionMatrix(); frameThird(); /* about 74° across, even on a tall phone */ dirty = true; wake(); }
  function wake() { if (!raf && !dead && !inTick) { last = null; raf = requestAnimationFrame(tick); } }
  function tick(t) {
    raf = 0; if (dead || held) return; /* waiting for ready() */ inTick = true; let again = false;
    try { again = step(t); } finally { inTick = false; } /* even if a frame fails, the next one can still be asked for */
    if (again || (dirty && shown())) raf = requestAnimationFrame(tick); else last = null; /* hidden behind the map: nothing to draw, so it waits */
  }
  let lastDraw = 0, othersMoving = false, meStill = true, held = !!opts.defer, firstDrawn = null;
  function step(t) {
    if (!shown()) { for (const o of others.values()) { o.g.position.x = o.tx; o.g.position.z = o.ty; o.g.rotation.y = o.ta; } dirty = true; return false; } /* hidden: jump to where people are, draw later */
    const dt = last == null ? 1 / 60 : Math.max(0, Math.min(0.05, (t - last) / 1000)); last = t; let moving = false; /* time since the last frame: never below 0 or above 1/20 s */
    let fw = -joy.y, st = joy.x; if (keys.has('w') || keys.has('arrowup')) fw += 1; if (keys.has('s') || keys.has('arrowdown')) fw -= 1; if (keys.has('a')) st -= 1; if (keys.has('d')) st += 1;
    if (keys.has('arrowleft')) { me.yaw += 1.8 * dt; moving = true; } if (keys.has('arrowright')) { me.yaw -= 1.8 * dt; moving = true; }
    if (act && view === 'walk' && Math.hypot(fw, st) > 0.35) standUp(); /* pushing the joystick gets you up */
    if (act) { fw = 0; st = 0; }
    if (view === 'walk' && (fw || st)) { const sp = 2.3 * dt, sx = -Math.sin(me.yaw), sy = -Math.cos(me.yaw), dx = (sx * fw + -sy * st) * sp, dy = (sy * fw + sx * st) * sp;
      unstick(); /* (inside something, e.g. a bed put down where you stood: out to the nearest free spot first, never through a wall) */ const ox = me.x, oy = me.y; if (!blocked(me.x + dx, me.y)) me.x += dx; if (!blocked(me.x, me.y + dy)) me.y += dy; if (me.x !== ox || me.y !== oy) moving = true; tapAim = false;
      if (Math.hypot(me.x - ox, me.y - oy) < sp * 0.3 && performance.now() - hintAt > 5000) /* pushing against something */ for (const g of wallStuff.children) { const D = g.userData.door; if (D && D.a < 0.9 && Math.hypot(me.x - D.cx, me.y - D.cy) < 0.9) { hintAt = performance.now(); opts.onHint && opts.onHint('🚪 Tap the door to open it.'); break; } } } /* pressing into a wall: nothing changes, nothing is drawn */
    if (moving) moved();
    // doors: open when tapped, and close by themselves a few seconds later (but not on someone standing in the doorway)
    let doorsMoving = false; const tnow = performance.now(); for (const g of wallStuff.children) { const D = g.userData.door; if (!D) continue;
      let inWay = Math.hypot(me.x - D.cx, me.y - D.cy) < 0.75; if (!inWay) for (const o of others.values()) if (o.g.visible && Math.hypot(o.g.position.x - D.cx, o.g.position.z - D.cy) < 0.75) { inWay = true; break; }
      if (inWay && D.until > 0) D.until = Math.max(D.until, tnow + 1500); const open = tnow < D.until, want = open ? 1.45 : 0, near = open; if (Math.abs(want - D.a) > 0.002) { D.a += Math.sign(want - D.a) * Math.min(Math.abs(want - D.a), dt * (near ? 3.2 : 2.2)); D.leaf.rotation.y = D.sign * D.a; dirty = true; doorsMoving = true; } }
    if (me3.visible) { const mv = (fw || st) && view === 'walk'; if (mv) { me3.userData.av.animate(dt, 0, 2.3 * Math.min(1, Math.hypot(fw, st)), false); meStill = false; } else if (!meStill && !act) { me3.userData.av.pose(); meStill = true; dirty = true; } } /* your legs move as you walk */
    // at most 60 frames a second (a 120 Hz screen would otherwise draw twice as many)
    const now = performance.now(), active = moving || joy.on || keys.size > 0 || now - lastInput < 160;
    const raining = !!rainM && view === 'walk' && shown(); if (raining && now - rainAt >= 50) { stepRain(Math.min(0.1, (now - (rainAt || now)) / 1000)); rainAt = now; dirty = true; } /* the rain outside (20 a second) */
    if (wx === 'storm' && shown()) { if (now > flashNext) { flashH = 1; flashNext = now + 6000 + Math.random() * 9000; } if (flashH > 0) { flashH = Math.max(0, flashH - dt * 5); hemiL.intensity = hemiBase * WXH.storm.hemi + flashH * 2; scene.background.set(flashH > 0.5 ? '#C9D2DC' : WXH.storm.sky); dirty = true; } } /* lightning */
    const gap = active ? 15.5 : othersMoving || party.length ? 32 : raining || flashH > 0 ? 48 : 0; /* you moving: up to 60 a second; only other people moving: 30 (still smooth); nothing moving: just the one frame */
    if (dirty && shown() && now - lastDraw >= gap) { placeCamera(); for (const g of show.children) { const m = g.userData.turn; if (m) m.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z); } /* phones on display turn to face you */ renderer.render(scene, camera); dirty = false; lastDraw = now; if (guard.after()) dirty = true; if (firstDrawn) { const f = firstDrawn; firstDrawn = null; requestAnimationFrame(() => f()); } } /* not while the map is showing */
    // other players: glide towards where they last said they were
    let gliding = false; for (const o of others.values()) if (o.g.visible) { const dx = o.tx - o.g.position.x, dz = o.ty - o.g.position.z; let da = o.ta - o.g.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(dx) + Math.abs(dz) + Math.abs(da) > 0.01) { const k = Math.min(1, dt * 8); o.g.position.x += dx * k; o.g.position.z += dz * k; o.g.rotation.y += da * k; gliding = true; dirty = true; if (!o.pose) o.g.userData.av.animate(dt, 0, Math.min(3, Math.hypot(dx, dz) * k / Math.max(dt, 1e-3)), false); o.posed = false; }
      else if (o.pose === 'r') { o.g.userData.av.animate(dt, 0, 3, false); gliding = true; dirty = true; } /* on a treadmill */
      else if (o.pose === 'd' || o.pose === 'o') { o.g.userData.av.dance(dt, o.pose === 'o' ? 'pole' : 'floor'); gliding = true; dirty = true; } /* dancing */
      else if (!o.posed) { o.g.userData.av.pose(POSE[o.pose] || 'stand'); o.posed = true; dirty = true; }
      if (o.bubble && performance.now() > o.bubbleUntil) { o.g.remove(o.bubble); o.bubble.material.map.dispose(); o.bubble = null; dirty = true; } }
    for (const [id, pt] of pets) { const o = id === 'me' ? null : others.get(id); if (id !== 'me' && (!o || !o.g.visible)) { pt.f.group.visible = false; continue; } pt.f.group.visible = true;
      const ox = o ? o.g.position.x : act ? act.x : me.x, oz = o ? o.g.position.z : act ? act.y : me.y; if (pt.f.step(dt, ox, oz)) { gliding = true; dirty = true; } } /* pets trot after their people */
    othersMoving = gliding;
    if (meBubble && performance.now() > meBubbleUntil) { me3.remove(meBubble); meBubble.material.map.dispose(); meBubble = null; dirty = true; }
    if (act && act.kind === 'run' && me3.visible) { me3.userData.av.animate(dt, 0, 3, false); dirty = true; }
    if (act && (act.kind === 'dance' || act.kind === 'pole') && me3.visible) { me3.userData.av.dance(dt, act.kind === 'pole' ? 'pole' : 'floor'); dirty = true; } /* dancing */
    // the club's lights: colours changing, beams sweeping, strobes flashing (30 frames a second while they're on)
    if (party.length && shown()) { const t = performance.now() / 1000;
      for (const q of party) { if (q.pv) { q.pv.rotation.x = Math.sin(t * 0.8 + q.n) * 0.38; q.pv.rotation.z = Math.cos(t * 0.63 + q.n * 1.3) * 0.38; } else if (q.strobe) q.m.material.color.set(Math.floor(t * 9) % 4 === 0 ? '#FFFFFF' : '#1A1A1A'); else partyAt(t, q.n, q.m.material.color); }
      for (const pl of pool) if (pl.userData.party) partyAt(t * 0.7, pl.userData.party, pl.color); dirty = true; }
    return moving || doorsMoving || (!!rainM && view === 'walk' && shown()) || (wx === 'storm' && shown()) || (act && (act.kind === 'run' || act.kind === 'dance' || act.kind === 'pole')) || (party.length > 0 && shown()) || joy.on || keys.size > 0 || dirty || gliding || [...others.values()].some(o => o.bubble) || !!meBubble;
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  // never a dark screen: a black picture steps the lighting down; a view the phone threw away is rebuilt (see safe3d.js)
  const redraw = () => { dirty = true; wake(); }, guard = blackGuard(renderer, scene, redraw), checks = [800, 2400, 4000].map(ms => setTimeout(redraw, ms));
  const ctx = guardContext(renderer, host, { back: () => { if (guard.level < 1) reflections(); reshadow(); redraw(); }, giveUp: () => opts.onLost && opts.onLost({ x: me.x, y: me.y, a: me.yaw }) });
  buildShell(); buildStuff(); resize(); moved();
  { const i = roomAt(S, Math.floor(me.x), Math.floor(me.y), PLAN), r = L.rooms[i]; /* in through the front door, looking into the room */
    if (r && !blocked(me.x, me.y)) { const dx = r.x + r.w / 2 - me.x, dy = r.y + r.d / 2 - me.y; if (Math.hypot(dx, dy) > 0.3) me.yaw = Math.atan2(-dx, -dy); stepIn(); moved(); } else if (i >= 0) goRoom(i);
    /* a small step to one side, so two people coming in together don't stand inside each other */
    const rx = Math.cos(me.yaw), ry = -Math.sin(me.yaw), fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw), tries = [];
    for (const side of [0.5, 0.8, 1.1, 1.4]) for (const fwd of [0, 0.4, 0.8]) for (const sg of [-1, 1]) tries.push([sg * side, fwd]);
    tries.sort(() => Math.random() - 0.5);
    for (const [sd, fw] of tries) { const nx = me.x + rx * sd + fx * fw, ny = me.y + ry * sd + fy * fw; if (!blocked(nx, ny)) { me.x = nx; me.y = ny; moved(); break; } } }
  { const a = opts.at; if (a && Number.isFinite(a.x) && Number.isFinite(a.y) && !blocked(a.x, a.y)) { me.x = a.x; me.y = a.y; me.yaw = Number.isFinite(a.a) ? a.a : me.yaw; stepIn(); moved(); } } /* back where you stood (after the phone dropped the 3D view) */

  return {
    setRoom(r, ph, shellToo) { room = r; photos = { ...photos, ...(ph || {}) }; if (shellToo) buildShell(); buildStuff(); unstick(); if (showSpec) buildShow(); wake(); },
    setShowcase(spec) { showSpec = spec || null; buildShow(); }, /* a store's goods on display: { kind, products: [{ k, cls: phone|car|pet|garment|acc|shoe|jewel|home, name, priceText, out, col, … }] } */
    setPick(p) { pick = p; tapAim = false; const m = p && FURNITURE[p.k].mount; showGrid(m === 'floor'); buildStuff();
      if (p && view === 'walk' && p.x == null) me.pitch = m === 'ceil' ? 0.75 : m === 'floor' ? -0.45 : 0.02; // look where this kind of piece goes
      if (p) { placeCamera(); if (p.x == null) aim(); showGhost(); opts.onPick && opts.onPick(pick); } else showGhost(); wake(); },
    refreshGhost() { showGhost(); },
    setSelected(i) { sel = i; showSel(); wake(); },
    setView(v) { view = v; applyView(); fogView(); moved(); }, setWeather,
    setSurroundings(A) { buildAround(A); },
    setPeople(list) { buildPeople(list); },
    // With opts.defer: build the shaders and send the textures to the graphics chip in the background, a few at a time,
    // then draw the first picture. Resolves once it's on screen. onStep(done, total) reports progress.
    async ready(onStep) {
      if (!held) return; placeCamera(); const tex = new Set();
      scene.traverse(o => { const ms = o.material ? [].concat(o.material) : []; for (const m of ms) for (const k of ['map', 'normalMap', 'emissiveMap']) if (m[k] && m[k].isTexture) tex.add(m[k]); });
      const list = [...tex], total = list.length + 2; let n = 0;
      // shaders: one kind of surface at a time (the room's lights decide how each is built), a breath apart
      const seen = new Set(), batch = []; scene.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) { const k = m.uuid + (o.isSkinnedMesh ? 's' : '') + (o.isInstancedMesh ? 'i' : ''); if (!seen.has(k)) { seen.add(k); batch.push(o); } } });
      for (let i = 0; i < batch.length; i++) { try { renderer.compile(batch[i], camera, scene); } catch (e) { /* the first draw builds it instead */ } if (i % 2 === 1) await breathe(); if (dead) return; }
      onStep && onStep(++n, total); await breathe();
      for (let i = 0; i < list.length; i++) { try { renderer.initTexture(list[i]); } catch (e) {} if (i % 3 === 2 || i === list.length - 1) { onStep && onStep(n + i + 1, total); await breathe(); } }
      if (dead) return; held = false; dirty = true; await new Promise(r => { firstDrawn = r; wake(); }); onStep && onStep(total, total); },
    setMyLook(look) { const vis = me3.visible; if (meBubble) me3.remove(meBubble); scene.remove(me3); dropFigure(me3); me3 = figure(opts.me || 'you', look, true); me3.visible = vis; scene.add(me3); if (meBubble) me3.add(meBubble); placeCamera(); dirty = true; wake(); },
    // a 🔊 over someone while they're talking on voice chat ('me' for you)
    talking(id, on) { const g = id === 'me' ? me3 : others.get(id)?.g; if (!g) return; let sp = g.userData.talk;
      if (on && !sp) { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); x.fillStyle = 'rgba(30,20,50,.82)'; x.beginPath(); x.arc(48, 48, 44, 0, 7); x.fill(); x.font = '56px system-ui,"Apple Color Emoji","Segoe UI Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🔊', 48, 52);
        const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })); sp.scale.set(0.34, 0.34, 1); sp.position.set(0, 2.38, 0); sp.renderOrder = 6; g.add(sp); g.userData.talk = sp; }
      else if (!on && sp) { g.remove(sp); sp.material.map.dispose(); sp.material.dispose(); g.userData.talk = null; } else return; dirty = true; wake(); },
    setPet, upsertOther, removeOther, clearOthers() { for (const id of [...others.keys()]) removeOther(id); }, say, get me() { return { x: me.x, y: me.y, a: act ? act.wyaw : me.yaw, pose: act ? CODE[act.kind] : '', ph: act ? +act.wy.toFixed(2) : 0 }; },
    act() { doAct(); }, standUp() { standUp(); }, petHappy(id) { const pt = pets.get(id); if (pt) { pt.f.happy(); dirty = true; wake(); } },
    // into bed (when your colonist is asleep as you come in): the first bed in the home; stand up beside it
    sleep() { if (act) return false; const it = room.items.find(x => { const A = actOf(x.k); return A && A.kind === 'lie' && /bed/.test(x.k); }) || room.items.find(x => (actOf(x.k) || {}).kind === 'lie'); if (!it) return false;
      const b = boxOf(it); for (const [x, y] of [[b.x1 + 0.45, b.cy], [b.x0 - 0.45, b.cy], [b.cx, b.y1 + 0.45], [b.cx, b.y0 - 0.45]]) if (!blocked(x, y)) { me.x = x; me.y = y; break; }
      doAct({ it, A: actOf(it.k), b }); return true; }, refreshAct() { actKey = ''; prompt(); },
    get stats() { const r = renderer.info.render; return { frame: r.frame, pr: prNow, people: others.size, shown: [...others.values()].filter(o => o.g.visible).length, canvas: renderer.domElement.width + 'x' + renderer.domElement.height, calls: r.calls, triangles: r.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length }; },
    setPerspective(p) { persp = p === 'third' ? 'third' : 'first'; stepIn(); moved(); },
    get perspective() { return persp; },
    get view() { return view; },
    check: { at(x, y) { me.x = x; me.y = y; moved(); }, face(x, y) { me.yaw = Math.atan2(-(x - me.x), -(y - me.y)); me.pitch = -0.25; moved(); }, blocked: (x, y) => blocked(x, y), get show() { return show.children.map(g => [g.userData.product, +g.position.x.toFixed(2), +g.position.y.toFixed(2), +g.position.z.toFixed(2), g.children.length]); }, get me() { return [me.x, me.y]; } }, /* (for checking) */
    goRoom, roomHere: () => roomAt(S, Math.floor(me.x), Math.floor(me.y), PLAN),
    dispose() { dead = true; clearInterval(wxTimer); cancelAnimationFrame(raf); ro.disconnect(); ctx.dispose(); checks.forEach(clearTimeout); removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); for (const t of photoTex.values()) t.dispose(); renderer.dispose(); renderer.domElement.remove(); stick.remove(); },
  };
}

// ---------------- little pictures of each piece, for the shop ----------------
let thumbR = null, thumbEnv = null; const thumbs = new Map();
export function thumb(k, c = 0) {
  const key = k + ':' + c; if (thumbs.has(key)) return thumbs.get(key); const f = FURNITURE[k]; if (!f) return '';
  try {
    if (!thumbR) { thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbR.setSize(160, 128, false); pictureMode(thumbR); thumbR.setPixelRatio(1); thumbR.toneMapping = THREE.ACESFilmicToneMapping; thumbR.toneMappingExposure = 1.1;
      const pm = new THREE.PMREMGenerator(thumbR); thumbEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
    const sc = new THREE.Scene(); sc.environment = thumbEnv; sc.environmentIntensity = 0.7; sc.add(new THREE.HemisphereLight('#FFFFFF', '#9A8F82', 1.1)); const dl = new THREE.DirectionalLight('#FFF4E4', 2.2); dl.position.set(3, 5, 4); sc.add(dl);
    const g = pieceGroup({ i: 't', k, x: 0, y: 0, r: 0, c }, null); sc.add(g);
    const box = new THREE.Box3(); g.traverse(o => { if (o.isMesh && !o.userData.beam) box.expandByObject(o); }); /* the glow round a light isn't part of the piece */ const ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), R = Math.max(sz.x, sz.y, sz.z) * 0.62 + 0.05;
    const cam = new THREE.PerspectiveCamera(32, 160 / 128, 0.01, 50), dir = f.mount === 'floor' || f.mount === 'ceil' ? new THREE.Vector3(1, 0.85, 1.3) : new THREE.Vector3(0.45, 0.25, 1.4);
    cam.position.copy(ctr).addScaledVector(dir.normalize(), R / Math.sin(THREE.MathUtils.degToRad(16))); cam.lookAt(ctr);
    thumbR.render(sc, cam); const url = thumbR.domElement.toDataURL('image/png'); sc.traverse(o => o.geometry && o.geometry.dispose()); thumbs.set(key, url); return url;
  } catch (e) { return ''; }
}
export function disposeThumbs() { if (thumbR) { thumbR.dispose(); thumbR = null; } }
