// The colony in 3D, for the mini games: the same buildings (type, size, colours, roofs, signs, awnings, height),
// streets, parks, trees and water as on the map, lit by the sun at the colony's time of day (lit windows and street
// lamps at night), with soft shadows, sky and haze.
//
// Built for phones: everything that doesn't move is merged into a handful of meshes (a few draw calls for a whole
// neighbourhood), shadows are drawn once and not every frame, textures are painted once and shared, the picture's
// resolution steps down by itself if a phone struggles, and nothing is drawn while the game is hidden.
import * as THREE from 'three';
import { business } from '/bizlook.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BUILDING_TYPES, ROAD_TYPES } from '/shared/catalog.js';
import { pictureMode, blackGuard, guardContext, webglOK } from '/safe3d.js';
import { buildAvatar } from '/avatar3d.js';
export const can3d = webglOK; // false on a phone that can't do 3D at all: the games fall back instead of a blank screen

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

// ---------------- path and paving surfaces (the map's surface roads: brick, cobbles, decking, sand...) ----------------
// One small repeating picture per kind (painted only when a block uses it), 4 m across, in the map's own colours.
const SURF = { pedestrian: 'cobble', cobble: 'cobble', plaza: 'brick', stone: 'slabs', grasspave: 'grasspave', sand: 'sand', gravel: 'gravel', dirt: 'dirt', herringbone: 'herring', terracotta: 'tiles', marble: 'marble',
  checker: 'checker', mosaic: 'mosaic', deck: 'deck', slate: 'flags', crazypave: 'crazy', pebbles: 'pebbles', stepping: 'stepping', hexpave: 'hex', terrazzo: 'terrazzo', flowerpath: 'flowers', playmat: 'rubber', goldtile: 'gold' };
function surfaceTex(type, R0) {
  const pat = SURF[type] || (R0.kind === 'dirt' ? 'dirt' : 'cobble'), top = R0.top || '#c9c3b7', edge = R0.edge || '#999';
  return canvasTex('surf-' + type, 256, (g, S) => { const r = rnd(hashS(type)), C = col(top), sh = (f, a = 1) => `rgba(${C.r * 255 * f | 0},${C.g * 255 * f | 0},${C.b * 255 * f | 0},${a})`;
    g.fillStyle = top; g.fillRect(0, 0, S, S);
    const grout = (w = 2) => { g.fillStyle = edge; g.globalAlpha = 0.55; };
    if (pat === 'cobble') { g.fillStyle = edge; g.globalAlpha = 0.5; g.fillRect(0, 0, S, S); g.globalAlpha = 1; for (let y = 0; y < S; y += 21.33) for (let x = (Math.round(y / 21.33) % 2) * -10; x < S; x += 21.33) { g.fillStyle = sh(0.9 + r() * 0.2); if (g.roundRect) { g.beginPath(); g.roundRect(x + 1.5, y + 1.5, 18, 18, 6); g.fill(); } else g.fillRect(x + 1.5, y + 1.5, 18, 18); /* (older phones: square setts) */ } }
    else if (pat === 'brick') { grout(); g.fillRect(0, 0, S, S); g.globalAlpha = 1; for (let y = 0, i = 0; y < S; y += 16, i++) for (let x = i % 2 ? -16 : 0; x < S; x += 32) { g.fillStyle = sh(0.88 + r() * 0.24); g.fillRect(x + 1, y + 1, 30, 14); } }
    else if (pat === 'slabs' || pat === 'flags') { grout(); g.fillRect(0, 0, S, S); g.globalAlpha = 1; const n = pat === 'slabs' ? 2 : 4; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const w = S / n, o = pat === 'flags' && y % 2 ? w / 2 : 0; for (const k of [0, 1]) { g.fillStyle = sh(0.9 + r() * 0.2); g.fillRect(x * w + o - k * S + 2, y * w + 2, w - 4, w - 4); } } }
    else if (pat === 'grasspave') { g.fillStyle = '#7fae5c'; g.fillRect(0, 0, S, S); g.fillStyle = '#c9c6bd'; for (let i = 0; i <= 8; i++) { g.fillRect(i * 32 - 3, 0, 6, S); g.fillRect(0, i * 32 - 3, S, 6); } for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(60,110,40,${0.3 + r() * 0.4})`; g.fillRect(r() * S, r() * S, 1.5, 3); } }
    else if (pat === 'sand' || pat === 'dirt' || pat === 'gravel' || pat === 'rubber' || pat === 'terrazzo' || pat === 'flowers') { const n = pat === 'gravel' || pat === 'flowers' ? 2600 : 1800, big = pat === 'gravel' || pat === 'flowers' ? 3 : 2;
      for (let i = 0; i < n; i++) { g.fillStyle = pat === 'terrazzo' ? ['#7a6a5a', '#b4483a', '#4a6a8a', '#efe8d8', '#2f2f2f'][i % 5] : sh(0.75 + r() * 0.45, 0.7); const s2 = 1 + r() * big; g.fillRect(r() * S, r() * S, s2, s2); }
      if (pat === 'flowers') for (let i = 0; i < 40; i++) { const x = r() * S, y = r() * S; g.fillStyle = ['#e85a8a', '#f2c94c', '#ffffff', '#9b6ad8', '#ff8a3a'][i % 5]; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + Math.cos(k * 1.26) * 3, y + Math.sin(k * 1.26) * 3, 2.4, 0, 7); g.fill(); } g.fillStyle = '#f5d76e'; g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
      if (pat === 'sand') for (let i = 0; i < 30; i++) { g.strokeStyle = sh(0.9, 0.35); g.lineWidth = 1.5; g.beginPath(); const y = r() * S; g.moveTo(0, y); g.bezierCurveTo(S / 3, y - 6, S * 2 / 3, y + 6, S, y); g.stroke(); } }
    else if (pat === 'herring') { grout(); g.fillRect(0, 0, S, S); g.globalAlpha = 1; for (let y = -64; y < S + 64; y += 16) for (let x = -64; x < S + 64; x += 32) { g.fillStyle = sh(0.86 + r() * 0.26); g.save(); g.translate(x + (y / 16 % 2 ? 16 : 0), y); g.rotate(Math.PI / 4 * ((x / 32 + y / 16) % 2 ? 1 : -1)); g.fillRect(-15, -6, 30, 12); g.restore(); } }
    else if (pat === 'tiles' || pat === 'gold') { grout(); g.fillRect(0, 0, S, S); g.globalAlpha = 1; for (let y = 0; y < S; y += 32) for (let x = 0; x < S; x += 32) { const gr = g.createLinearGradient(x, y, x + 32, y + 32); gr.addColorStop(0, sh(pat === 'gold' ? 1.15 : 1.02)); gr.addColorStop(1, sh(pat === 'gold' ? 0.8 : 0.92 + r() * 0.1)); g.fillStyle = gr; g.fillRect(x + 1.5, y + 1.5, 29, 29); } }
    else if (pat === 'marble') { for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(150,140,130,${0.15 + r() * 0.25})`; g.lineWidth = 0.6 + r() * 1.4; g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.3) * 50; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); } g.fillStyle = 'rgba(160,150,140,.35)'; for (let i = 0; i <= 2; i++) { g.fillRect(i * 128 - 1, 0, 2, S); g.fillRect(0, i * 128 - 1, S, 2); } }
    else if (pat === 'checker') { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? edge : top; g.fillRect(x * 32, y * 32, 32, 32); } }
    else if (pat === 'mosaic') { for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) { const d = Math.hypot((x % 64) - 32, (y % 64) - 32); g.fillStyle = d < 12 || (d > 22 && d < 28) ? edge : r() < 0.08 ? '#7FB0D8' : top; g.fillRect(x + 0.6, y + 0.6, 6.8, 6.8); } }
    else if (pat === 'deck') { for (let y = 0; y < S; y += 21.33) { g.fillStyle = sh(0.85 + r() * 0.25); g.fillRect(0, y + 1, S, 19); for (let k = 0; k < 6; k++) { g.fillStyle = sh(0.7, 0.35); g.fillRect(r() * S, y + 3 + r() * 14, 20 + r() * 40, 1); } g.fillStyle = edge; g.fillRect(((y / 21.33) % 4) * 64 + 30, y + 1, 2, 19); } }
    else if (pat === 'crazy' || pat === 'pebbles' || pat === 'stepping') { if (pat === 'stepping') { g.fillStyle = '#7fae5c'; g.fillRect(0, 0, S, S); } else { g.fillStyle = edge; g.globalAlpha = 0.6; g.fillRect(0, 0, S, S); g.globalAlpha = 1; }
      const n = pat === 'pebbles' ? 260 : pat === 'crazy' ? 46 : 4, R = pat === 'pebbles' ? 7 : pat === 'crazy' ? 26 : 44;
      for (let i = 0; i < n; i++) { const x = pat === 'stepping' ? (i % 2) * 128 + 64 : r() * S, y = pat === 'stepping' ? (i >> 1) * 128 + 64 : r() * S; g.fillStyle = pat === 'stepping' ? (edge) : sh(0.82 + r() * 0.36); for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); const k = pat === 'crazy' ? 7 : 12; for (let j = 0; j < k; j++) { const a = j / k * 6.283, rr = R * (0.75 + r() * 0.25) * (pat === 'pebbles' ? (j % 2 ? 0.7 : 1) : 1); g.lineTo(x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr); } g.fill(); } } }
    else if (pat === 'hex') { grout(); g.fillRect(0, 0, S, S); g.globalAlpha = 1; const R = 16, w = R * Math.sqrt(3); for (let row = -1; row < S / (R * 1.5) + 1; row++) for (let c = -1; c < S / w + 1; c++) { const x = c * w + (row % 2 ? w / 2 : 0), y = row * R * 1.5; g.fillStyle = sh(0.88 + r() * 0.22); g.beginPath(); for (let j = 0; j < 6; j++) { const a = Math.PI / 6 + j * Math.PI / 3; g.lineTo(x + Math.cos(a) * (R - 1.5), y + Math.sin(a) * (R - 1.5)); } g.fill(); } }
    g.globalAlpha = 1; noise(g, 1.5, 1400, '0,0,0', 0.08, r); });
}
function surfaceMat(view, type, R0) { const key = 'surf:' + type; if (view.M[key]) return view.M[key]; const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: surfaceTex(type, R0), roughness: SURF[type] === 'marble' || SURF[type] === 'gold' ? 0.35 : 0.9, metalness: SURF[type] === 'gold' ? 0.5 : 0 }); view.mats.push(m); return (view.M[key] = m); }
const isSurface = R0 => !!R0 && (R0.kind === 'cobble' || R0.kind === 'dirt'); /* (paths and paving: no kerbs, no lane lines) */

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
function bake(bucket, geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color }) {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal, m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), base = bucket.p.length / 3;
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m); bucket.p.push(v.x, v.y, v.z); v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); bucket.n.push(v.x, v.y, v.z); bucket.u.push(0, 0); bucket.c.push(color.r, color.g, color.b); bucket.i.push(base + i); }
}
const GEO = { cyl: new THREE.CylinderGeometry(1, 1, 1, 10), cone: new THREE.ConeGeometry(1, 1, 9), ball: new THREE.IcosahedronGeometry(1, 1), box: new THREE.BoxGeometry(1, 1, 1), ring: new THREE.TorusGeometry(1, 0.08, 6, 24), half: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2) };

// ---------------- the view: renderer, sky, sun, camera ----------------
export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  const maxPR = Math.min(window.devicePixelRatio || 1, PHONE ? 1.5 : 2); renderer.setPixelRatio(maxPR);
  canvas.style.background = '#c9d8e4'; /* a light sky behind it, so it's never dark while it loads */
  pictureMode(renderer); /* phones that blank painted pictures get them another way (see safe3d.js) */
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1, 0.5, 900);
  const reflections = () => { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }; reflections(); scene.environmentIntensity = 0.55;
  // never a dark screen: a black picture steps the lighting down; a view the phone threw away is rebuilt when it comes back
  const guard = blackGuard(renderer, scene), ctx = guardContext(renderer, canvas.parentElement, { back: () => { if (guard.level < 1) reflections(); renderer.shadowMap.needsUpdate = true; } });
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
  view.setTime = minute => { view.minute = minute;
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
    renderer.shadowMap.needsUpdate = true; weatherLight();
  };
  // ---- the weather, the same as on the 2D map: cloudy greys the sky and softens the sun; rain and storms darken it and
  // bring rain falling round you (and lightning in a storm); fog closes in. One line mesh for the rain, moved on the
  // CPU (a couple of thousand points: nothing for a phone), and only while it rains. ----
  const WX = { sunny: { sun: 1, hemi: 1, exp: 1, sky: null, fog: 1, rain: 0 }, cloudy: { sun: 0.42, hemi: 0.92, exp: 0.94, sky: '#b9c2ca', night: '#151a24', fog: 0.85, rain: 0 },
    rain: { sun: 0.2, hemi: 0.78, exp: 0.84, sky: '#8a949d', night: '#10141b', fog: 0.6, rain: PHONE ? 700 : 1100 }, storm: { sun: 0.08, hemi: 0.62, exp: 0.74, sky: '#5d6670', night: '#0b0e14', fog: 0.45, rain: PHONE ? 1300 : 2000, wind: 0.35 },
    fog: { sun: 0.3, hemi: 0.95, exp: 0.95, sky: '#d3d7da', night: '#20242a', fog: 0.16, rain: 0 } };
  view.weather = 'sunny'; let fogBase = null, fogSet = null, rainMesh = null, flash = 0, nextFlash = 0, hemiBase = hemi.intensity;
  function weatherLight() { const w = WX[view.weather] || WX.sunny, night = view.night;
    sun.intensity *= w.sun; hemi.intensity *= w.hemi; hemiBase = hemi.intensity; renderer.toneMappingExposure *= w.exp; scene.environmentIntensity *= 0.6 + 0.4 * w.hemi;
    if (w.sky) { const c = new THREE.Color(w.sky).lerp(new THREE.Color(w.night), Math.min(1, night * 1.2)); sky.visible = false; scene.background = c; if (scene.fog) scene.fog.color.copy(c); }
    weatherFog(); }
  function weatherFog() { const w = WX[view.weather] || WX.sunny; if (!scene.fog) return; if (!fogSet || scene.fog.near !== fogSet[0] || scene.fog.far !== fogSet[1]) fogBase = [scene.fog.near, scene.fog.far]; /* (whoever owns the view may set its own haze: that is the clear-day distance) */
    scene.fog.near = fogBase[0] * w.fog * (view.weather === 'fog' ? 0.2 : 1); scene.fog.far = fogBase[1] * w.fog; fogSet = [scene.fog.near, scene.fog.far]; }
  view.setWeather = k => { k = WX[k] ? k : 'sunny'; if (k === view.weather) return; view.weather = k; const w = WX[k];
    if (rainMesh) { scene.remove(rainMesh); rainMesh.geometry.dispose(); rainMesh.material.dispose(); rainMesh = null; }
    if (w.rain) { const n = w.rain, pos = new Float32Array(n * 6), seed = new Float32Array(n * 3); const r = rnd(7);
      for (let i = 0; i < n; i++) { seed[i * 3] = (r() - 0.5) * 70; seed[i * 3 + 1] = r() * 30; seed[i * 3 + 2] = (r() - 0.5) * 70; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      rainMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c8d6e4', transparent: true, opacity: k === 'storm' ? 0.55 : 0.42, fog: false, depthWrite: false })); rainMesh.frustumCulled = false; rainMesh.userData = { seed, t: 0, wind: w.wind || 0.08 }; scene.add(rainMesh); }
    flash = 0; if (view.minute != null) view.setTime(view.minute); else renderer.shadowMap.needsUpdate = true; };
  function stepWeather(dt, now) { if (scene.fog && fogSet && (scene.fog.near !== fogSet[0] || scene.fog.far !== fogSet[1])) weatherFog(); /* (the haze was reset: put the weather's back) */
    if (rainMesh) { const D = rainMesh.userData, P = rainMesh.geometry.attributes.position.array, S = D.seed, n = S.length / 3, c = camera.position, L = view.weather === 'storm' ? 1.1 : 0.8; D.t += dt;
      for (let i = 0; i < n; i++) { const sp = 16 + (i % 5) * 2.2, y = ((S[i * 3 + 1] - D.t * sp) % 30 + 30) % 30 - 8, x = c.x + S[i * 3] + y * D.wind, z = c.z + S[i * 3 + 2], j = i * 6;
        P[j] = x; P[j + 1] = c.y + y; P[j + 2] = z; P[j + 3] = x - L * D.wind; P[j + 4] = c.y + y - L; P[j + 5] = z; }
      rainMesh.geometry.attributes.position.needsUpdate = true; }
    if (view.weather === 'storm') { if (now > nextFlash) { flash = 1; nextFlash = now + 5000 + Math.random() * 9000; } if (flash > 0) { flash = Math.max(0, flash - dt * 6); hemi.intensity = hemiBase + flash * 2.4; } } }
  view.resize = () => { const box = canvas.parentElement || canvas, w = box.clientWidth || innerWidth, h = box.clientHeight || innerHeight; renderer.setSize(w, h, true); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  // the loop: always at full sharpness (the resolution is never lowered), and it stops while the page is hidden
  let last = performance.now();
  view.start = fn => { view.onFrame = fn; if (view.running) return; view.running = true;
    renderer.setAnimationLoop(now => { if (document.hidden) { last = now; return; } const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const t0 = performance.now(); view.onFrame && view.onFrame(dt, now); if (view.weather !== 'sunny') stepWeather(dt, now);
      // a hit shakes the camera just for this frame: "trauma" fades by itself, and the nudge is trauma² (see juice.js)
      let sx = 0, sy = 0, sz = 0; if (view.trauma > 0) { view.trauma = Math.max(0, view.trauma - 1.5 * dt); const k = view.trauma * view.trauma * (view.shakeAmp || 0.6), t = now / 1000 * 30; sx = k * Math.sin(t * 1.7); sy = k * Math.sin(t * 2.3) * 0.7; sz = k * Math.sin(t * 1.3); camera.position.x += sx; camera.position.y += sy; camera.position.z += sz; }
      renderer.render(scene, camera); guard.after(); if (sx || sy || sz) { camera.position.x -= sx; camera.position.y -= sy; camera.position.z -= sz; } view.ms = (view.ms || 0) * 0.9 + (performance.now() - t0) * 0.1; view.frames = (view.frames || 0) + 1; }); };
  view.stop = () => { view.running = false; renderer.setAnimationLoop(null); };
  view.dispose = () => { view.stop(); ctx.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); for (const m of view.mats) m.userData.signTex ? dropSign(m) : m.dispose(); renderer.dispose(); };
  view.resize(); return view;
}

// ---------------- materials ----------------
// Water that moves: small waves running across it (a few sines on the graphics chip, bending the light, no extra
// geometry), its pattern drifting slowly in two directions, and the sky caught in it at a shallow angle. WATER.time is
// moved on by whoever draws it (town3d.js); left at 0 it's still, and still looks like water.
export const WATER = { time: { value: 0 } };
function waterFx(m) {
  m.onBeforeCompile = sh => { sh.uniforms.uWT = WATER.time;
    sh.vertexShader = 'varying vec3 vWW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uWT; varying vec3 vWW;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 wa = texture2D(map, vMapUv + vec2(uWT * 0.012, uWT * 0.007)), wb = texture2D(map, vMapUv * 0.63 + vec2(-uWT * 0.009, uWT * 0.011));
        diffuseColor *= mix(wa, wb, 0.5);
      #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 p = vWW.xz; float t = uWT;
          float dx = 0.42 * cos(p.x * 0.42 + t * 1.3) * cos(p.y * 0.31 - t * 0.8) + 0.9 * cos(p.x * 0.9 - p.y * 0.55 + t * 2.1) * 0.35 + 1.7 * cos(p.x * 1.7 + p.y * 1.3 - t * 2.9) * 0.12;
          float dz = -0.31 * sin(p.x * 0.42 + t * 1.3) * sin(p.y * 0.31 - t * 0.8) - 0.55 * cos(p.x * 0.9 - p.y * 0.55 + t * 2.1) * 0.35 + 1.3 * cos(p.x * 1.7 + p.y * 1.3 - t * 2.9) * 0.12;
          vec3 nw = normalize(vec3(-dx * 0.16, 1.0, -dz * 0.16)); normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), -normal) * -1.0, 0.0, 1.0), 3.0); totalEmissiveRadiance += vec3(0.42, 0.58, 0.72) * fr * 0.35; }`); };
  m.customProgramCacheKey = () => 'water'; return m; }
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
    water: waterFx(std({ map: ground.water(), roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.9 })),
    foam: std({ roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    solid: std({ roughness: 0.75, flatShading: true }, 0, true), shiny: std({ roughness: 0.3, metalness: 0.5 }, 0, true),
    paint: std({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glow: (m => { m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;'); }; return m; })(std({ roughness: 1 }, 2.2)), /* (lit in its own colour after dark: a red neon stays red) */
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
// A block of town for driving (town3d.js) passes pad 0, ring false and add false: just its own tiles, no ground or roads
// beyond its edges (the next block draws those), and it's added to the scene by the caller; L.gnd tells what's next door.
export function buildArea(view, L, { cordon = true, pad = 10, ring = true, add = true } = {}) {
  const M = materials(view), B = {}, SB = {}; for (const k of Object.keys(M)) { if (!k.startsWith('surf:')) B[k] = new Bucket(); } L.lamps = [];
  const r = rnd(L.seed || 1), TILE = 8, tw = L.tw, th = L.th, gAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= tw || ty >= th) ? (L.gnd ? L.gnd(tx, ty) : -1) : L.ground.charCodeAt(ty * tw + tx) - 48;
  const roadSet = new Map([...L.roads, ...(L.sroads || [])].map(([x, y, t]) => [x + ',' + y, t])), isRoad = (x, y) => roadSet.has(x + ',' + y);
  const kindAt = (x, y) => (ROAD_TYPES[roadSet.get(x + ',' + y)] || {}).kind, isRail = (x, y) => kindAt(x, y) === 'rail', railish = (x, y) => isRail(x, y) || kindAt(x, y) === 'crossing'; /* tracks, and where a road crosses them */
  if (add) { view.center.set(tw * TILE / 2, 0, th * TILE / 2); view.span = Math.max(tw, th) * TILE * 0.8; }
  // the ground, tile by tile, with the town carrying on beyond the edges
  for (let ty = -pad; ty < th + pad; ty++) for (let tx = -pad; tx < tw + pad; tx++) {
    const k = (tx >= 0 && ty >= 0 && tx < tw && ty < th) ? gAt(tx, ty) : isRoad(tx, ty) ? 2 : (L.swater || []).some(w => w[0] === tx && w[1] === ty) ? 3 : 0, x0 = tx * TILE, z0 = ty * TILE, x1 = x0 + TILE, z1 = z0 + TILE, b = k === 2 ? B.asphalt : k === 3 ? B.water : k === 4 ? B.field : k === 5 ? B.pitch : k === 1 ? B.paving : B.grass, y = k === 3 ? -0.05 : 0; /* (water just above the far ground sheet, below the banks) */
    if (k === 2 && isRail(tx, ty)) { B.solid.box(x0, z0, x1, z1, -0.05, 0.06, col('#8a8276')); continue; } /* a railway: a bed of grey ballast */
    if (k === 2) { const type = roadSet.get(tx + ',' + ty), R0 = ROAD_TYPES[type]; if (isSurface(R0)) { const sb = SB[type] || (SB[type] = new Bucket()), q = 4; /* (a path or paving: its own look, 4 m to a repeat) */
        sb.quad([x0, 0.012, z1], [x1, 0.012, z1], [x1, 0.012, z0], [x0, 0.012, z0], [0, 1, 0], [x0 / q, z1 / q, x1 / q, z1 / q, x1 / q, z0 / q, x0 / q, z0 / q], col('#ffffff'));
        const ec = col(R0.edge || R0.top), e = 0.28; for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { if (roadSet.get((tx + dx) + ',' + (ty + dy)) === type) continue; /* (a border where it meets something else) */
          const a = dx > 0 ? x1 - e : x0, c = dy > 0 ? z1 - e : z0; if (dx) B.paving.box(a, z0, a + e, z1, 0, 0.035, ec, { su: 2, sv: 2 }); else B.paving.box(x0, c, x1, c + e, 0, 0.035, ec, { su: 2, sv: 2 }); }
        continue; } }
    const s = k === 2 ? 8 : 6; b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0 / s, z1 / s, x1 / s, z1 / s, x1 / s, z0 / s, x0 / s, z0 / s], col('#ffffff'));
    if (k === 3) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const n = gAt(tx + dx, ty + dy); if (n === 3) continue; // banks (and a line of foam along them)
      { const fw = 0.9, fy = y + 0.04, fc = col('#ffffff'); if (dx) { const a = dx > 0 ? x1 - fw : x0; B.foam.quad([a, fy, z1], [a + fw, fy, z1], [a + fw, fy, z0], [a, fy, z0], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], fc); } else { const a = dy > 0 ? z1 - fw : z0; B.foam.quad([x0, fy, a + fw], [x1, fy, a + fw], [x1, fy, a], [x0, fy, a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], fc); } }
      const ex0 = dx === 1 ? x1 : x0, ex1 = dx === -1 ? x0 : x1, ez0 = dy === 1 ? z1 : z0, ez1 = dy === -1 ? z0 : z1; if (dx) B.paving.box(ex0 - 0.3, z0, ex0 + 0.3, z1, -0.6, 0.15, col('#b9b2a3'), { su: 4, sv: 4 }); else B.paving.box(x0, ez0 - 0.3, x1, ez0 + 0.3, -0.6, 0.15, col('#b9b2a3'), { su: 4, sv: 4 }); }
  }
  // streets: pavements and kerbs where a street meets anything else, lane markings, and zebra crossings at junctions
  for (const [tx, ty, type] of ring ? [...L.roads, ...(L.sroads || [])] : L.roads) {
    const R0 = ROAD_TYPES[type] || {}; if (isSurface(R0)) continue; /* (paths and paving were drawn with the ground) */
    const x0 = tx * TILE, z0 = ty * TILE, n = { N: isRoad(tx, ty - 1), S: isRoad(tx, ty + 1), W: isRoad(tx - 1, ty), E: isRoad(tx + 1, ty) }, white = col('#f2f0e8'), yellow = col('#f2c94c');
    const kerb = (side) => { const w = 1.6, hgt = 0.14, c = col(R0.walk || '#d6d1c6');
      if (side === 'N') B.paving.box(x0, z0 - w, x0 + TILE, z0, 0, hgt, c, { su: 2, sv: 2 }); if (side === 'S') B.paving.box(x0, z0 + TILE, x0 + TILE, z0 + TILE + w, 0, hgt, c, { su: 2, sv: 2 });
      if (side === 'W') B.paving.box(x0 - w, z0, x0, z0 + TILE, 0, hgt, c, { su: 2, sv: 2 }); if (side === 'E') B.paving.box(x0 + TILE, z0, x0 + TILE + w, z0 + TILE, 0, hgt, c, { su: 2, sv: 2 }); };
    if (R0.kind !== 'rail') for (const s of ['N', 'S', 'W', 'E']) { const [dx, dy] = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[s]; if (!n[s] && gAt(tx + dx, ty + dy) !== 3) kerb(s); } /* (no pavements along a railway) */
    if (R0.kind === 'rail' || R0.kind === 'crossing') { // a railway: sleepers across a ballast bed, two steel rails on them; at a level crossing the rails sit flush in the road
      const r = { N: railish(tx, ty - 1), S: railish(tx, ty + 1), W: railish(tx - 1, ty), E: railish(tx + 1, ty) }, sides = Object.keys(r).filter(k => r[k]), cross = R0.kind === 'crossing';
      const steel = col('#9aa1a8'), wood = col('#5a4636'), cx = x0 + 4, cz = z0 + 4, ends = sides.length ? sides : ['W', 'E'];
      for (const sd of ends.length === 1 ? [...ends, { N: 'S', S: 'N', W: 'E', E: 'W' }[ends[0]]] : ends) { const ew = sd === 'E' || sd === 'W', a = sd === 'E' || sd === 'S' ? 0 : -4; /* half a track from the middle to this edge */
        if (!cross) for (let i = 0; i < 6; i++) { const u = a + 0.35 + i * 0.66; if (ew) B.solid.box(cx + u, cz - 1.3, cx + u + 0.24, cz + 1.3, 0.06, 0.16, wood); else B.solid.box(cx - 1.3, cz + u, cx + 1.3, cz + u + 0.24, 0.06, 0.16, wood); }
        for (const o of [-0.72, 0.72]) { const y0 = cross ? 0 : 0.16, y1 = cross ? 0.045 : 0.3; if (ew) B.solid.box(cx + a - 0.05, cz + o - 0.05, cx + a + 4.05, cz + o + 0.05, y0, y1, steel); else B.solid.box(cx + o - 0.05, cz + a - 0.05, cx + o + 0.05, cz + a + 4.05, y0, y1, steel); } }
      if (R0.platform) { const ew = r.E || r.W || !(r.N || r.S); for (const o of [-1, 1]) { if (ew) B.paving.box(x0, cz + o * 3.15 - 0.95, x0 + TILE, cz + o * 3.15 + 0.95, 0, 0.9, col('#cfc9bc'), { su: 2, sv: 2 }); else B.paving.box(cx + o * 3.15 - 0.95, z0, cx + o * 3.15 + 0.95, z0 + TILE, 0, 0.9, col('#cfc9bc'), { su: 2, sv: 2 }); } } /* the platforms either side */
      if (!cross) continue; }
    const car = (x, y) => isRoad(x, y) && !isSurface(ROAD_TYPES[roadSet.get(x + ',' + y)]), m = { N: car(tx, ty - 1), S: car(tx, ty + 1), W: car(tx - 1, ty), E: car(tx + 1, ty) }; /* (lane lines and crossings follow the roads cars use) */
    const ew = (m.E || m.W) && !m.N && !m.S, ns = (m.N || m.S) && !m.E && !m.W, y = 0.02;
    if (ew) for (let i = 0; i < 2; i++) { const a = x0 + 0.8 + i * 4; B.paint.quad([a, y, z0 + 4.08], [a + 2.2, y, z0 + 4.08], [a + 2.2, y, z0 + 3.92], [a, y, z0 + 3.92], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], R0.lanes ? white : yellow); }
    if (ns) for (let i = 0; i < 2; i++) { const a = z0 + 0.8 + i * 4; B.paint.quad([x0 + 3.92, y, a + 2.2], [x0 + 4.08, y, a + 2.2], [x0 + 4.08, y, a], [x0 + 3.92, y, a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], R0.lanes ? white : yellow); }
    const junction = (m.N || m.S) && (m.E || m.W);
    if (junction) for (const s of ['N', 'S', 'W', 'E']) { if (!m[s]) continue; for (let i = 0; i < 6; i++) { const a = 1 + i * 1.1;
      if (s === 'N') B.paint.quad([x0 + a, y, z0 + 1.6], [x0 + a + 0.55, y, z0 + 1.6], [x0 + a + 0.55, y, z0 + 0.2], [x0 + a, y, z0 + 0.2], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white);
      if (s === 'S') B.paint.quad([x0 + a, y, z0 + 7.8], [x0 + a + 0.55, y, z0 + 7.8], [x0 + a + 0.55, y, z0 + 6.4], [x0 + a, y, z0 + 6.4], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white);
      if (s === 'W') B.paint.quad([x0 + 0.2, y, z0 + a + 0.55], [x0 + 1.6, y, z0 + a + 0.55], [x0 + 1.6, y, z0 + a], [x0 + 0.2, y, z0 + a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white);
      if (s === 'E') B.paint.quad([x0 + 6.4, y, z0 + a + 0.55], [x0 + 7.8, y, z0 + a + 0.55], [x0 + 7.8, y, z0 + a], [x0 + 6.4, y, z0 + a], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], white); } }
    // street lamps along straight streets (they light up after dark)
    if ((ew || ns) && ((tx * 7 + ty * 13) % 3 === 0)) { const lx = ew ? x0 + 4 : (m.W ? x0 - 0.9 : x0 + TILE + 0.9), lz = ew ? (z0 + TILE + 0.9) : z0 + 4; const s0 = marks(B); lamp(B, view, lx, lz); L.lamps.push({ x: lx, z: lz, rng: since(B, s0) }); }
  }
  // buildings and open spaces
  const front = b => { const tx0 = Math.floor(b.x / TILE), ty0 = Math.floor(b.y / TILE), tx1 = Math.floor((b.x + b.w) / TILE), ty1 = Math.floor((b.y + b.h) / TILE); let best = 'S', bv = -1;
    const sides = { S: [], N: [], E: [], W: [] }; for (let x = tx0; x <= tx1; x++) { sides.S.push(isRoad(x, ty1 + 1) || isRoad(x, ty1)); sides.N.push(isRoad(x, ty0 - 1)); } for (let y = ty0; y <= ty1; y++) { sides.E.push(isRoad(tx1 + 1, y) || isRoad(tx1, y)); sides.W.push(isRoad(tx0 - 1, y)); }
    for (const [k, v] of Object.entries(sides)) { const c = v.filter(Boolean).length; if (c > bv) { bv = c; best = k; } } return best; };
  view.signs = []; view.hard = []; for (const b of L.buildings) building(B, view, b, front(b), r);
  for (const b of L.scenery || []) building(B, view, b, 'S', r);
  // trees, cars, benches, lamps, fences, fountains, and the hiding places
  for (const p of L.props) { if (!p.brk) { prop(B, view, p, r); continue; } const s0 = marks(B); prop(B, view, p, r); p.rng = since(B, s0); } /* (a prop a car can knock over: where its corners are kept, so it can be taken out of the merged mesh) */
  for (const s of L.spots) spot(B, s);
  // the play area is cordoned off with barriers, with the town carrying on beyond them
  if (cordon) { const W = tw * TILE, H = th * TILE, c1 = col('#e9e4d8'), c2 = col('#c8382e');
    for (let x = 0; x < W; x += 3) { B.solid.box(x + 0.2, -0.3, x + 2.8, 0.1, 0.6, 1.0, (x / 3) % 2 ? c1 : c2); B.solid.box(x + 0.2, H - 0.1, x + 2.8, H + 0.3, 0.6, 1.0, (x / 3) % 2 ? c1 : c2); B.solid.box(x + 0.3, -0.2, x + 0.5, 0, 0, 0.6, c1); B.solid.box(x + 0.3, H, x + 0.5, H + 0.2, 0, 0.6, c1); }
    for (let z = 0; z < H; z += 3) { B.solid.box(-0.3, z + 0.2, 0.1, z + 2.8, 0.6, 1.0, (z / 3) % 2 ? c1 : c2); B.solid.box(W - 0.1, z + 0.2, W + 0.3, z + 2.8, 0.6, 1.0, (z / 3) % 2 ? c1 : c2); } }
  // merge each bucket into one mesh
  const group = new THREE.Group(), meshOf = {}; for (const sg of view.signs || []) group.add(sg); view.signs = null; /* (the name boards, with the rest of the area) */
  for (const [k, b] of Object.entries(B)) { const g = b.geometry(); if (!g) continue; const m = new THREE.Mesh(g, M[k]); m.castShadow = !['grass', 'asphalt', 'field', 'pitch', 'water', 'paint', 'pool', 'ao'].includes(k); if (k === 'pool' || k === 'ao') { m.renderOrder = 2; m.receiveShadow = false; } m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); if (k === 'water') view.water = m; meshOf[k] = m; }
  for (const [type, b] of Object.entries(SB)) { const g = b.geometry(); if (!g) continue; const m = new THREE.Mesh(g, surfaceMat(view, type, ROAD_TYPES[type])); m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); } /* (one draw per kind of paving a block uses) */
  group.userData.meshOf = meshOf; group.userData.lamps = L.lamps; group.userData.hard = view.hard || []; view.hard = null; /* (what stands out from the businesses: solid, for the town) */
  if (add) { view.scene.add(group); view.area = group; renderer_shadow(view); } return group;
}
// Where each bucket's corners are up to (marks), and what was added since (since): [[bucket, from, to], ...].
const marks = B => { const m = {}; for (const k in B) m[k] = B[k].p.length / 3; return m; };
const since = (B, m) => { const out = []; for (const k in B) { const n = B[k].p.length / 3; if (n > m[k]) out.push([k, m[k], n]); } return out; };
// Take a knocked-over prop out of its area: its corners fold into a point under the ground (no rebuild, no new draw).
export function hideRanges(group, rng) { const M = group.userData.meshOf || {}; for (const [k, a, b] of rng || []) { const m = M[k]; if (!m) continue; const P = m.geometry.attributes.position; for (let i = a; i < b; i++) P.setXYZ(i, 0, -50, 0); P.addUpdateRange(a * 3, (b - a) * 3); P.needsUpdate = true; } }
function renderer_shadow(view) { view.renderer.shadowMap.needsUpdate = true; }

function lamp(B, view, x, z) {
  bake(B.shiny, GEO.cyl, { x, y: 2.6, z, sx: 0.09, sy: 5.2, sz: 0.09, color: col('#3a3f45') });
  bake(B.shiny, GEO.box, { x, y: 5.25, z, sx: 0.7, sy: 0.18, sz: 0.35, color: col('#3a3f45') });
  bake(B.glow, GEO.box, { x, y: 5.12, z, sx: 0.55, sy: 0.08, sz: 0.28, color: col('#fff2cc') });
  // a soft pool of light on the ground at night
  const R = 5, y = 0.05; B.pool.quad([x - R, y, z + R], [x + R, y, z + R], [x + R, y, z - R], [x - R, y, z - R], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col('#ffffff'));
}

// ---- the big venues, built as themselves (not boxes): the Colosseum (an oval of three arcades and an attic, the stands
// and the sand inside), the Stadiums (a bowl with white fins, a roof ring and floodlights round a green pitch) and the
// Racetracks (the oval of dirt with white rails, a covered grandstand and the winning post). A few hundred quads each,
// all merged into the area's meshes like any other building: no extra draws.
const VENUES = new Set(['colosseum', 'stadium', 'arena', 'racetrack', 'parking']);
// A car park's layout (b: x, y, w, h in metres; face: the side on the road): a drive-through aisle from the road, a row
// of bays either side of it, the gate where it meets the road. town3d parks its cars in these same bays.
export function parkingLayout(b, face) { const alongX = face === 'E' || face === 'W', L = alongX ? b.w : b.h, Wd = alongX ? b.h : b.w, BAY = 2.6, DEEP = 5, n = Math.max(1, Math.floor((L - 2.4) / BAY)), mid = Wd / 2, bays = [];
  const at = (u, v) => alongX ? [b.x + u, b.y + v] : [b.x + v, b.y + u]; /* (u along the aisle, v across it) */
  for (const side of [-1, 1]) for (let i = 0; i < n; i++) { const u = (L - n * BAY) / 2 + (i + 0.5) * BAY, v = mid + side * (3 + DEEP / 2), [x, z] = at(u, v); bays.push({ x, z, ry: alongX ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2), u, v, side }); }
  const end = face === 'E' || face === 'S' ? L - 0.4 : 0.4, [gx, gz] = at(end, mid); return { alongX, L, Wd, BAY, DEEP, n, mid, bays, gate: { x: gx, z: gz, u: end }, at }; }
// a racetrack's grandstand, on the south side of its plot (also what walkers and cars can't go through)
export const standOf = b => { const cx = b.x + b.w / 2, sl = Math.min(b.w * 0.42, 22), z1 = b.y + b.h; return { x0: cx - sl / 2, x1: cx + sl / 2, z0: z1 - 4.4, z1: z1 - 0.5 }; };
function venue(B, view, b, face, st, T, C) {
  const x0 = b.x, z0 = b.y, x1 = b.x + b.w, z1 = b.y + b.h, cx = (x0 + x1) / 2, cz = st === 'racetrack' ? (z0 + z1) / 2 - 2.5 : (z0 + z1) / 2; /* (a racetrack's oval sits back from its grandstand) */
  const q = (bk, a, b2, c, d, color) => { const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const su = Math.hypot(ux, uy, uz) / 6, sv = Math.hypot(vx, vy, vz) / 6; bk.quad(a, b2, c, d, [nx, ny, nz], [0, 0, su, 0, su, sv, 0, sv], color); }; /* (corners anticlockwise seen from the side that shows) */
  // a point on the outline at angle a: an ellipse (n = 2) or a rounded rectangle (n bigger), rx by rz, k of the way out
  const pt = (a, rx, rz, n, y) => { const c = Math.cos(a), s2 = Math.sin(a), e = 2 / n; return [cx + rx * Math.sign(c) * Math.abs(c) ** e, y, cz + rz * Math.sign(s2) * Math.abs(s2) ** e]; };
  const wallRing = (bk, N, rx, rz, n, y0, y1, color, inward) => { for (let i = 0; i < N; i++) { const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, A0 = pt(a0, rx, rz, n, y0), A1 = pt(a1, rx, rz, n, y0), U0 = pt(a0, rx, rz, n, y1), U1 = pt(a1, rx, rz, n, y1);
    if (inward) q(bk, A0, A1, U1, U0, color); else q(bk, A1, A0, U0, U1, color); } };
  const flatRing = (bk, N, ro, ri, n, yo, yi, colorOf) => { for (let i = 0; i < N; i++) { const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
    q(bk, pt(a1, ro[0], ro[1], n, yo), pt(a0, ro[0], ro[1], n, yo), pt(a0, ri[0], ri[1], n, yi), pt(a1, ri[0], ri[1], n, yi), typeof colorOf === 'function' ? colorOf(i) : colorOf); } };
  const disc = (bk, N, r2, n, y, color) => { for (let i = 0; i < N; i++) { const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2; bk.tri(pt(a1, r2[0], r2[1], n, y), pt(a0, r2[0], r2[1], n, y), [cx, y, cz], [0, 1, 0], [0, 0, 1, 0, 0.5, 1], color); } };
  const tang = (a, rx, rz, n) => { const p0 = pt(a - 0.01, rx, rz, n, 0), p1 = pt(a + 0.01, rx, rz, n, 0); return Math.atan2(-(p1[2] - p0[2]), p1[0] - p0[0]); }; /* (the turn that lays a box along the outline) */
  const fo = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[face], fa = Math.atan2(fo[1], fo[0]); /* (the front: where the gate and the name go) */
  const gate = (rx, rz, n, w, h, color) => { const p = pt(fa, rx + 0.12, rz + 0.12, n, 0), al = [-fo[1], fo[0]], a = [p[0] - al[0] * w / 2, 0.02, p[2] - al[1] * w / 2], d = [p[0] + al[0] * w / 2, 0.02, p[2] + al[1] * w / 2];
    q(B.solid, a, d, [d[0], h, d[2]], [a[0], h, a[2]], color); return p; };
  const name = (p, h, room) => { const text = String(b.name || T.name || '').trim(); if (text) sign(view, text, T.sign || col(C.trim || '#2F4A7A').getStyle(), !!T.neon, [p[0] + fo[0] * 0.25, h, p[2] + fo[1] * 0.25], face, room); };
  if (st === 'colosseum') {
    const RX = b.w / 2 - 0.6, RZ = b.h / 2 - 0.6, N = 36, TH = 5.2, TIERS = 3, ATT = 3.2, H = TIERS * TH + ATT, stone = col(C.wall || '#D9C7A3'), dark = darken(C.wall || '#D9C7A3', 0.16), band = darken(C.wall || '#D9C7A3', 0.82), trim = col(C.trim || '#8A2A22');
    // outside: for each tier, the dark arches (set back) and the piers between them, a cornice band over each; the attic on top
    for (let t = 0; t < TIERS; t++) { const y0 = t * TH, y1 = y0 + TH; wallRing(B.solid, N, RX - 0.7, RZ - 0.7, 2, y0, y1 - 0.9, dark);
      wallRing(B.plaster, N, RX - 0.7, RZ - 0.7, 2, y1 - 0.9, y1, stone); /* (over the arches) */
      for (let i = 0; i < N; i++) { const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, top = y1 - 0.9, r2 = TH * 0.26, P = (a, y) => pt(a, RX - 0.62, RZ - 0.62, 2, y), da = (a1 - a0) * 0.36; /* the round of each arch: its two top corners filled in */
        q(B.plaster, P(a0 + da, top), P(a0, top - r2), P(a0, top), P(a0, top), stone); q(B.plaster, P(a1, top - r2), P(a1 - da, top), P(a1, top), P(a1, top), stone);
        q(B.plaster, P(a0 + da * 0.45, top - r2 * 0.12), P(a0, top - r2), P(a0 + da, top), P(a0 + da, top), stone); q(B.plaster, P(a1, top - r2), P(a1 - da * 0.45, top - r2 * 0.12), P(a1 - da, top), P(a1 - da, top), stone); }
      for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, p = pt(a, RX - 0.25, RZ - 0.25, 2, 0); bake(B.plaster, GEO.box, { x: p[0], y: y0 + TH / 2, z: p[2], sx: 1.1, sy: TH, sz: 0.9, ry: tang(a, RX, RZ, 2), color: stone }); }
      wallRing(B.solid, N, RX + 0.08, RZ + 0.08, 2, y1 - 0.35, y1, band); }
    wallRing(B.plaster, N, RX - 0.25, RZ - 0.25, 2, TIERS * TH, H, stone); for (let i = 0; i < N; i += 2) { const a = (i + 0.5) / N * Math.PI * 2, p = pt(a, RX - 0.2, RZ - 0.2, 2, 0); bake(B.solid, GEO.box, { x: p[0], y: TIERS * TH + ATT / 2, z: p[2], sx: 1.0, sy: 1.2, sz: 0.2, ry: tang(a, RX, RZ, 2), color: dark }); } /* (the attic's little windows) */
    // the top of the wall, and inside: the stands stepping down to the sand
    flatRing(B.roof, N, [RX - 0.2, RZ - 0.2], [RX - 2.4, RZ - 2.4], 2, H, H, col(C.roof || '#B9A27A'));
    wallRing(B.plaster, N, RX - 2.4, RZ - 2.4, 2, H - 2.2, H, stone, true);
    const steps = 5, rIn = [RX * 0.42, RZ * 0.42]; for (let k = 0; k < steps; k++) { const f0 = k / steps, f1 = (k + 1) / steps, ro = [RX - 2.4 - (RX - 2.4 - rIn[0]) * f0, RZ - 2.4 - (RZ - 2.4 - rIn[1]) * f0], ri = [RX - 2.4 - (RX - 2.4 - rIn[0]) * f1, RZ - 2.4 - (RZ - 2.4 - rIn[1]) * f1];
      flatRing(B.solid, N, ro, ri, 2, H - 2.2 - (H - 4.4) * f0, H - 2.2 - (H - 4.4) * f1, i => k % 2 ? band : stone); }
    wallRing(B.solid, N, rIn[0], rIn[1], 2, 0.3, 2.2, trim, true); disc(B.solid, N, rIn, 2, 0.3, col(C.sand || '#E3C88E'));
    // the masts that held the awning, round the top; the gate and the name
    for (let i = 0; i < N; i += 3) { const p = pt(i / N * Math.PI * 2, RX - 0.6, RZ - 0.6, 2, 0); bake(B.shiny, GEO.cyl, { x: p[0], y: H + 1.8, z: p[2], sx: 0.12, sy: 3.6, sz: 0.12, color: col('#6b5a44') }); }
    const g = gate(RX - 0.7, RZ - 0.7, 2, 3.4, TH - 1.2, col('#2a1d14')); name(g, TH + 0.5, 6); return true; }
  if (st === 'stadium' || st === 'arena') {
    const big = st === 'arena', RX = b.w / 2 - 0.5, RZ = b.h / 2 - 0.5, n = 5, N = 40, H = big ? 19 : 13, fin = col(C.wall || '#E8E6E0'), clad = col(C.trim || '#2F4A7A'), roofC = col(C.roof || '#F4F4F0'), seat = col(C.seat || '#C8382E'), seat2 = col(C.seat2 || C.trim || '#2F4A7A');
    // the facade: coloured cladding behind a ring of white fins, glass at the bottom
    wallRing(B.glass, N, RX - 0.6, RZ - 0.6, n, 0, 4.2, col('#9fb8c8')); wallRing(B.solid, N, RX - 0.6, RZ - 0.6, n, 4.2, H, clad);
    for (const f of [0.32, 0.62, 0.9]) wallRing(B.solid, N, RX - 0.45, RZ - 0.45, n, H * f, H * f + 0.45, fin); /* (the concourse floors, as white bands) */
    wallRing(B.glass, N, RX - 0.5, RZ - 0.5, n, H * 0.62 + 0.45, H * 0.9, col('#7d9fb6')); /* (a band of glass along the top concourse) */
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, p = pt(a, RX - 0.2, RZ - 0.2, n, 0); bake(B.plaster, GEO.box, { x: p[0], y: H / 2 + 0.6, z: p[2], sx: 0.5, sy: H + 1.2, sz: 1.0, ry: tang(a, RX, RZ, n), color: fin }); }
    // the roof ring (sloping up and in), its edge, and inside the stands down to the pitch
    const rRoof = [RX * 0.74, RZ * 0.72]; flatRing(B.roof, N, [RX + 0.3, RZ + 0.3], rRoof, n, H + 1.2, H + 3.2, roofC); wallRing(B.solid, N, rRoof[0], rRoof[1], n, H + 2.6, H + 3.2, clad, true);
    wallRing(B.solid, N, RX + 0.3, RZ + 0.3, n, H + 0.6, H + 1.2, fin);
    const pr = [RX * 0.6, RZ * 0.55], steps = 4; for (let k = 0; k < steps; k++) { const f0 = k / steps, f1 = (k + 1) / steps, lerp = f => [rRoof[0] + (pr[0] - rRoof[0]) * f, rRoof[1] + (pr[1] - rRoof[1]) * f];
      flatRing(B.solid, N, lerp(f0), lerp(f1), n, H + 0.4 - (H - 1) * f0, H + 0.4 - (H - 1) * f1, k % 2 ? seat2 : seat); } /* (rows of the club's two colours) */
    { const px = pr[0] * 0.86, pz = pr[1] * 0.84, y = 1.6, g = col('#4E9A3A'), wl = col('#f4f4f0'); q(B.solid, [cx - px, y, cz + pz], [cx + px, y, cz + pz], [cx + px, y, cz - pz], [cx - px, y, cz - pz], g); disc(B.solid, N, pr, n, 1.3, col('#B4473A'));
      const ln = (a, b2, c, d) => q(B.paint, [a, y + 0.02, d], [b2, y + 0.02, d], [b2, y + 0.02, c], [a, y + 0.02, c], wl); ln(cx - 0.08, cx + 0.08, cz - pz * 0.9, cz + pz * 0.9); ln(cx - px * 0.92, cx + px * 0.92, cz + pz * 0.9 - 0.15, cz + pz * 0.9); ln(cx - px * 0.92, cx + px * 0.92, cz - pz * 0.9, cz - pz * 0.9 + 0.15); }
    // floodlights at the four corners (a mast and a lit bank of lamps)
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) { const p = pt(a, RX * 0.94, RZ * 0.94, n, 0), mh = H + (big ? 14 : 10); bake(B.shiny, GEO.cyl, { x: p[0], y: mh / 2, z: p[2], sx: 0.35, sy: mh, sz: 0.35, color: col('#8a9096') });
      const ry = Math.atan2(cx - p[0], cz - p[2]); bake(B.solid, GEO.box, { x: p[0], y: mh, z: p[2], sx: 3.2, sy: 2, sz: 0.4, ry, color: col('#2B2621') }); bake(B.glow, GEO.box, { x: p[0] + Math.sin(ry) * 0.22, y: mh, z: p[2] + Math.cos(ry) * 0.22, sx: 2.8, sy: 1.6, sz: 0.06, ry, color: col('#fff6d8') }); }
    const g = gate(RX - 0.6, RZ - 0.6, n, 4.2, 3.4, col('#1B2631')); name(g, Math.min(H - 1.5, 6.5), 8); return true; }
  if (st === 'parking') { // a car park: tarmac, white bays and arrows, a kerb round it, lamps, trees in planters, the barrier and pay booth at the gate
    const P = parkingLayout(b, face), at = P.at, w = col('#f2f0e8'), kerbC = col('#cfc9bc'), y = 0.05, q2 = (bk, u0, v0, u1, v1, yy, c) => { const [ax, az] = at(u0, v0), [bx2, bz2] = at(u1, v1), X0 = Math.min(ax, bx2), X1 = Math.max(ax, bx2), Z0 = Math.min(az, bz2), Z1 = Math.max(az, bz2); bk.quad([X0, yy, Z1], [X1, yy, Z1], [X1, yy, Z0], [X0, yy, Z0], [0, 1, 0], [0, 0, (X1 - X0) / 6, 0, (X1 - X0) / 6, (Z1 - Z0) / 6, 0, (Z1 - Z0) / 6], c); };
    q2(B.asphalt, 0, 0, P.L, P.Wd, 0.04, col('#ffffff'));
    for (const sd of [-1, 1]) { const v0 = P.mid + sd * 3, v1 = P.mid + sd * (3 + P.DEEP); for (let i = 0; i <= P.n; i++) { const u = (P.L - P.n * P.BAY) / 2 + i * P.BAY; q2(B.paint, u - 0.06, Math.min(v0, v1), u + 0.06, Math.max(v0, v1), y, w); } q2(B.paint, (P.L - P.n * P.BAY) / 2, Math.min(v0, v0 + sd * 0.12), (P.L + P.n * P.BAY) / 2, Math.max(v0, v0 + sd * 0.12), y, w); } /* (the bay lines, and the line along their front) */
    for (const k of [0.3, 0.7]) { const u = P.L * k, dir = P.gate.u > P.L / 2 ? -1 : 1; q2(B.paint, u - 0.9, P.mid - 0.09, u + 0.9, P.mid + 0.09, y, w); const tip = u + dir * 1.3, [t0x, t0z] = at(tip, P.mid), [l0x, l0z] = at(u + dir * 0.6, P.mid - 0.55), [r0x, r0z] = at(u + dir * 0.6, P.mid + 0.55); const tri = [[t0x, y, t0z], [l0x, y, l0z], [r0x, y, r0z]]; if ((tri[1][0] - tri[0][0]) * (tri[2][2] - tri[0][2]) - (tri[1][2] - tri[0][2]) * (tri[2][0] - tri[0][0]) > 0) tri.reverse(); B.paint.tri(tri[0], tri[1], tri[2], [0, 1, 0], [0, 0, 1, 0, 0.5, 1], w); } /* (arrows: in from the road) */
    // the kerb round it, open where the aisle meets the road
    const K = 0.35; for (const [u0, v0, u1, v1] of [[0, 0, P.L, K], [0, P.Wd - K, P.L, P.Wd]]) { const [ax, az] = at(u0, v0), [bx2, bz2] = at(u1, v1); B.paving.box(Math.min(ax, bx2), Math.min(az, bz2), Math.max(ax, bx2), Math.max(az, bz2), 0, 0.16, kerbC, { su: 2, sv: 2 }); }
    for (const ue of [0, P.L - K]) { const gate = Math.abs(ue + K / 2 - P.gate.u) < 1; for (const [v0, v1] of gate ? [[0, P.mid - 3], [P.mid + 3, P.Wd]] : [[0, P.Wd]]) { const [ax, az] = at(ue, v0), [bx2, bz2] = at(ue + K, v1); B.paving.box(Math.min(ax, bx2), Math.min(az, bz2), Math.max(ax, bx2), Math.max(az, bz2), 0, 0.16, kerbC, { su: 2, sv: 2 }); } }
    // the barrier and the pay booth at the gate, lamps and planted trees
    { const gu = P.gate.u + (P.gate.u > P.L / 2 ? -1.2 : 1.2), [px0, pz0] = at(gu, P.mid - 3.4), [bx3, bz3] = at(gu, P.mid + 2.6); bake(B.solid, GEO.box, { x: px0, y: 0.55, z: pz0, sx: 0.35, sy: 1.1, sz: 0.35, color: col('#E2B13C') });
      const arm = [bx3 - px0, bz3 - pz0], la = Math.hypot(arm[0], arm[1]); for (let k = 0; k < 6; k++) { const f0 = k / 6, f1 = (k + 1) / 6; bake(B.solid, GEO.box, { x: px0 + arm[0] * (f0 + f1) / 2, y: 1.0, z: pz0 + arm[1] * (f0 + f1) / 2, sx: P.alongX ? 0.1 : la / 6, sy: 0.1, sz: P.alongX ? la / 6 : 0.1, color: col(k % 2 ? '#F2F0EA' : '#C8382E') }); }
      const [kx, kz] = at(gu, P.mid - 4.6); B.plaster.box(kx - 0.8, kz - 0.8, kx + 0.8, kz + 0.8, 0, 2.3, col('#E9E4D8'), { su: 14, sv: 12.8 }); B.glass.box(kx - 0.82, kz - 0.5, kx + 0.82, kz + 0.5, 1.0, 1.9, col('#9fb8c8')); B.roof.box(kx - 1.0, kz - 1.0, kx + 1.0, kz + 1.0, 2.3, 2.45, col('#2F5D9E'), { sides: true });
      const [mx, mz] = at(gu, P.mid + 3.5); bake(B.shiny, GEO.box, { x: mx, y: 0.7, z: mz, sx: 0.35, sy: 1.4, sz: 0.3, color: col('#3a3f45') }); bake(B.glow, GEO.box, { x: mx, y: 1.15, z: mz, sx: 0.37, sy: 0.25, sz: 0.32, color: col('#7FC8C2') }); } /* (the ticket machine by the barrier) */
    for (const dv of [-2.6, 2.6]) { const [lx, lz] = at(P.gate.u > P.L / 2 ? 0.75 : P.L - 0.75, P.mid + dv); lamp(B, view, lx, lz); /* (at the far end of the aisle, out of the way) */ bake(B.solid, GEO.cyl, { x: lx, y: 0.3, z: lz, sx: 0.35, sy: 0.6, sz: 0.35, color: kerbC }); }
    { const tu = P.gate.u > P.L / 2 ? 0.6 : P.L - 0.6; for (const v of [0.6, P.Wd - 0.6]) { const [tx, tz] = at(tu, v); B.paving.box(tx - 0.45, tz - 0.45, tx + 0.45, tz + 0.45, 0, 0.45, kerbC, { su: 2, sv: 2 }); bake(B.solid, GEO.cyl, { x: tx, y: 1.5, z: tz, sx: 0.1, sy: 2.2, sz: 0.1, color: col('#6b4f3a') }); bake(B.solid, GEO.ball, { x: tx, y: 3.1, z: tz, sx: 0.8, sy: 0.9, sz: 0.8, color: col('#5E9E45') }); } }
    { const [sx2, sz2] = at(P.gate.u, P.mid - 3.6); bake(B.shiny, GEO.cyl, { x: sx2, y: 1.4, z: sz2, sx: 0.06, sy: 2.8, sz: 0.06, color: col('#9aa1a8') }); bake(B.solid, GEO.box, { x: sx2, y: 2.9, z: sz2, sx: 0.8, sy: 0.8, sz: 0.08, ry: P.alongX ? Math.PI / 2 : 0, color: col('#2F5D9E') }); bake(B.glow, GEO.box, { x: sx2, y: 2.9, z: sz2, sx: 0.5, sy: 0.5, sz: 0.1, ry: P.alongX ? Math.PI / 2 : 0, color: col('#ffffff') }); } /* (the blue P sign) */
    return true; }
  if (st === 'racetrack') {
    const RX = b.w / 2 - 1.2, RZ = b.h / 2 - 4.5, W = Math.min(4, b.h * 0.14), N = 40, dirt = col((C.dirt) || '#C9A06A'), rail = col('#f4f4f2'), stand = col(C.stand || '#B5523B');
    flatRing(B.solid, N, [RX, RZ], [RX - W, RZ - W], 2, 0.06, 0.06, dirt);
    for (const r2 of [[RX + 0.1, RZ + 0.1], [RX - W - 0.1, RZ - W - 0.1]]) { wallRing(B.solid, N, r2[0], r2[1], 2, 0.75, 0.95, rail); wallRing(B.solid, N, r2[0], r2[1], 2, 0.75, 0.95, rail, true); for (let i = 0; i < N; i += 2) { const p = pt(i / N * Math.PI * 2, r2[0], r2[1], 2, 0); B.solid.box(p[0] - 0.06, p[2] - 0.06, p[0] + 0.06, p[2] + 0.06, 0, 0.85, rail); } }
    // the grandstand along the home straight (the south side, inside its plot: see town3d's standOf): four steps, a back wall and a roof on posts
    const sd = standOf(b), sl = sd.x1 - sd.x0, fz = 1, zs = sd.z0, d = 0.9; for (let k = 0; k < 4; k++) { const za = zs + fz * k * d, zb = za + fz * d; B.solid.box(cx - sl / 2, Math.min(za, zb), cx + sl / 2, Math.max(za, zb), 0, 0.5 + k * 0.5, k % 2 ? darken(C.stand || '#B5523B', 0.8) : col('#cfc9bc')); }
    const zb = zs + fz * 4 * d; B.plaster.box(cx - sl / 2, Math.min(zb, zb + fz * 0.3), cx + sl / 2, Math.max(zb, zb + fz * 0.3), 0, 4.2, col('#e6e0d2'), { su: 14, sv: 12.8 });
    for (let k = 0; k < 6; k++) { if (k === 2 || k === 3) continue; const x = cx - sl / 2 + 1 + k * (sl - 2) / 6; B.solid.box(x, zb + 0.3, x + (sl - 2) / 6 - 0.6, zb + 0.32, 1.4, 3.2, col('#1f2a33')); } /* (windows along the back: the bar and the betting hall) */ B.solid.box(cx - 1, zb + 0.3, cx + 1, zb + 0.36, 0, 2.5, col('#3a2a1e')); /* (the door in) */
    { const text = String(b.name || T.name || '').trim(); if (text) sign(view, text, col(C.stand || '#B5523B').getStyle(), false, [cx, 3.7, zb + 0.45], 'S', Math.min(10, sl - 2)); }
    B.roof.box(cx - sl / 2 - 0.4, Math.min(zs - fz * 0.4, zb), cx + sl / 2 + 0.4, Math.max(zs - fz * 0.4, zb), 4.2, 4.45, stand);
    for (let k = 0; k <= 4; k++) { const x = cx - sl / 2 + k * sl / 4; B.solid.box(x - 0.1, zs - 0.1, x + 0.1, zs + 0.1, 0, 4.2, col('#5a5550')); }
    { const p = pt(Math.PI / 2 * fz, RX - W / 2, RZ - W / 2, 2, 0); B.solid.box(p[0] - 0.12, p[2] - W / 2 - 0.3, p[0] + 0.12, p[2] - W / 2, 0, 2.6, col('#f2f2f2')); bake(B.solid, GEO.cyl, { x: p[0], y: 2.8, z: p[2] - W / 2 - 0.15, sx: 0.5, sy: 0.1, sz: 0.5, rx: Math.PI / 2, color: col('#c8382e') }); } /* the winning post */
    return true; }
  return false; }

function building(B, view, b, face, r) {
  const T = BUILDING_TYPES[b.type] || {}, C = T.colors || {}, x0 = b.x, z0 = b.y, x1 = b.x + b.w, z1 = b.y + b.h;
  if (VENUES.has(T.style) && !b.ruin && b.done !== false && venue(B, view, b, b.face || face, T.style, T, C)) return;
  if (T.work && !T.home && !b.ruin && b.done !== false) { try { if (business({ bake, GEO, col, darken, sign, lamp, hard: s => view.hard && view.hard.push(s), generic: () => plainBuilding(B, view, b, face, r) }, B, view, b, face, r, T, C, b.type)) return; } catch (e) { console.warn('business look', b.type, e); } } /* (each kind of business as itself: see bizlook.js) */ /* (built as themselves) */
  plainBuilding(B, view, b, face, r);
}
function plainBuilding(B, view, b, face, r) {
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
  // its name on a board over the front door (a business's own name, or what it is: POLICE, MARKET…), lit up at night;
  // homes have none
  if (T.cat !== 'housing' && (T.work || T.label || b.name) && !['prop', 'fence', 'tree', 'xmastree', 'ponds', 'well', 'pitch', 'square', 'yard', 'tanks'].includes(st)) { const text = String(b.name || T.label || T.name || '').trim(); if (text) sign(view, text, T.sign || trimC.getStyle(), !!T.neon, at(0, Math.max(3.25, Math.min(H - 0.7, 4.6)), 0.14), face, Math.max(2.4, (face === 'E' || face === 'W' ? b.h : b.w) - 1.2)); }
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
    if (H > 14 && r() < 0.5) { const tx = x0 + 1.6 + r() * Math.max(0.1, b.w - 3.2), tz = z0 + 1.6 + r() * Math.max(0.1, b.h - 3.2); bake(B.shiny, GEO.cyl, { x: tx, y: H + 1.9, z: tz, sx: 0.9, sy: 1.6, sz: 0.9, color: col('#8f7a62') }); bake(B.solid, GEO.cone, { x: tx, y: H + 2.95, z: tz, sx: 0.95, sy: 0.5, sz: 0.95, color: col('#5d5048') });
      for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) bake(B.shiny, GEO.cyl, { x: tx + dx, y: H + 0.55, z: tz + dz, sx: 0.06, sy: 1.1, sz: 0.06, color: col('#3a3f45') }); } /* a water tank on legs */
    if (H > 22) { const ax = x0 + b.w * (0.2 + r() * 0.6), az = z0 + b.h * (0.2 + r() * 0.6); bake(B.shiny, GEO.cyl, { x: ax, y: H + 3, z: az, sx: 0.06, sy: 6, sz: 0.06, color: col('#c9ccd0') }); bake(B.glow, GEO.ball, { x: ax, y: H + 6.1, z: az, sx: 0.14, sy: 0.14, sz: 0.14, color: col('#ff4b3a') }); } /* an antenna with a warning light */
    if (T.cat === 'housing' && H > 6 && H < 30 && r() < 0.45) for (let k = 0; k < 3; k++) { const px = x0 + 1 + k * Math.max(1.2, (b.w - 2) / 3); if (px + 1.1 > x1 - 0.5) break; B.shiny.box(px, z0 + 1, px + 1.1, z0 + Math.min(3.2, b.h - 1), H + 0.15, H + 0.3, col('#22324a')); } /* solar panels */
    if (H > 10) for (let k = 0; k < Math.min(4, Math.floor(b.w * b.h / 60)); k++) { const ux = x0 + 2 + r() * (b.w - 5), uz = z0 + 2 + r() * (b.h - 5); B.shiny.box(ux, uz, ux + 1.6, uz + 1.2, H, H + 1.1, col('#b8bcc0')); }
    if (st === 'dome' || st === 'globe' || st === 'atom') bake(B.shiny, GEO.half, { x: (x0 + x1) / 2, y: H, z: (z0 + z1) / 2, sx: Math.min(b.w, b.h) * 0.42, sy: Math.min(b.w, b.h) * 0.42, sz: Math.min(b.w, b.h) * 0.42, color: roofC });
    if (st === 'factory') { for (let k = 0; k < (T.chimneys || 1); k++) bake(B.brick, GEO.cyl, { x: x0 + 2 + k * 3, y: H + 5, z: z0 + 2, sx: 0.9, sy: 10, sz: 0.9, color: col('#8a4a3a') }); }
    if (T.balcony) { const bc = col(T.balcony); for (let y = 3.2; y < H - 2; y += 3.2) for (let u = -b.w / 2 + 2; u < b.w / 2 - 2; u += 3.5) { if (face === 'S' || face === 'N') B.solid.box(fx + u - 1.2, fz + (face === 'S' ? 0 : -0.9), fx + u + 1.2, fz + (face === 'S' ? 0.9 : 0), y, y + 1.0, bc); } }
    if (st === 'sky' || H > 30) bake(B.glow, GEO.ball, { x: (x0 + x1) / 2, y: H + (st === 'needle' ? 12 : 3), z: (z0 + z1) / 2, sx: 0.25, sy: 0.25, sz: 0.25, color: col('#ff4b3a') }); // an aircraft warning light
    if (st === 'needle') bake(B.shiny, GEO.cyl, { x: (x0 + x1) / 2, y: H + 6, z: (z0 + z1) / 2, sx: 0.2, sy: 12, sz: 0.2, color: col('#cfd3d6') });
  }
}
// A name board: lettering painted onto a board in the building's colour. By day it's just paint; at night it lights up
// (neon ones brighter). The same name on the same colour shares one picture (phones have little memory for them).
const SIGNS = new Map(); /* key → { t, n } */
function signTex(text, bg, neon) { const key = text + '|' + bg + '|' + (neon ? 1 : 0); let e = SIGNS.get(key); if (e) { e.n++; return e; }
  const H = 96, c = document.createElement('canvas'), g = c.getContext('2d'); g.font = `900 ${H * 0.56}px system-ui, sans-serif`; const tw = g.measureText(text).width;
  c.width = Math.min(1024, Math.max(256, Math.ceil(tw + H * 0.9))); c.height = H; const g2 = c.getContext('2d');
  g2.fillStyle = bg; g2.fillRect(0, 0, c.width, H); g2.strokeStyle = 'rgba(255,255,255,.55)'; g2.lineWidth = 4; g2.strokeRect(5, 5, c.width - 10, H - 10);
  let fs = H * 0.56; g2.font = `900 ${fs}px system-ui, sans-serif`; while (g2.measureText(text).width > c.width - H * 0.6 && fs > 14) { fs -= 2; g2.font = `900 ${fs}px system-ui, sans-serif`; }
  g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillStyle = neon ? '#ffe9a8' : '#ffffff'; g2.shadowColor = neon ? '#ffcf4a' : 'rgba(255,240,200,.9)'; g2.shadowBlur = neon ? 18 : 8; g2.fillText(text, c.width / 2, H * 0.54);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; e = { t, n: 1, key, aspect: c.width / H }; SIGNS.set(key, e); return e; }
export function dropSign(m) { const e = m && m.userData && m.userData.signTex; if (!e) return; m.dispose(); if (--e.n <= 0) { e.t.dispose(); SIGNS.delete(e.key); } }
const SIGN_BACK = new THREE.MeshStandardMaterial({ color: '#2b2621', roughness: 0.7 });
function sign(view, text, bg, neon, pos, face, room = 6) {
  const e = signTex(text, bg, neon), m = new THREE.MeshStandardMaterial({ map: e.t, roughness: 0.55, emissive: new THREE.Color('#ffffff'), emissiveMap: e.t, emissiveIntensity: 0 });
  m.userData.glow = neon ? 2.6 : 1.9; m.userData.signTex = e; m.emissiveIntensity = m.userData.glow * (view.night || 0); view.mats.push(m); /* (lit with the night, like the windows) */
  const hgt = 1.35, w = Math.min(room, hgt * e.aspect), h = w / e.aspect, mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(pos[0], pos[1], pos[2]); mesh.rotation.y = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[face]; mesh.userData.sign = true;
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.1), SIGN_BACK); back.position.set(0, 0, -0.06); mesh.add(back); /* a frame behind the board */
  if (view.signs) view.signs.push(mesh); else view.scene.add(mesh);
}
function tree(B, x, z, s, leaf, kind, r, lite) { /* lite: a street tree (fewer leaf clumps, for the long rows of them) */
  const lc = col(leaf), trunk = col('#6b4a32');
  if (kind === 'pine') { bake(B.solid, GEO.cyl, { x, y: 1.2 * s, z, sx: 0.22 * s, sy: 2.4 * s, sz: 0.22 * s, color: trunk }); for (let i = 0; i < 3; i++) bake(B.solid, GEO.cone, { x, y: (2.6 + i * 1.6) * s, z, sx: (2.3 - i * 0.6) * s, sy: 2.6 * s, sz: (2.3 - i * 0.6) * s, color: lc.clone().multiplyScalar(0.85 + i * 0.08) }); return; }
  if (kind === 'palm') { bake(B.solid, GEO.cyl, { x, y: 3 * s, z, sx: 0.2 * s, sy: 6 * s, sz: 0.2 * s, color: col('#8a6a48') }); for (let i = 0; i < 6; i++) bake(B.solid, GEO.box, { x: x + Math.cos(i) * 1.4 * s, y: 6 * s, z: z + Math.sin(i) * 1.4 * s, ry: -i, sx: 3 * s, sy: 0.12 * s, sz: 0.7 * s, color: lc }); return; }
  if (kind === 'poplar') { bake(B.solid, GEO.cyl, { x, y: 1 * s, z, sx: 0.2 * s, sy: 2 * s, sz: 0.2 * s, color: trunk }); bake(B.solid, GEO.ball, { x, y: 4.6 * s, z, sx: 1.4 * s, sy: 3.8 * s, sz: 1.4 * s, color: lc }); return; }
  bake(B.solid, GEO.cyl, { x, y: 1.4 * s, z, sx: 0.26 * s, sy: 2.8 * s, sz: 0.26 * s, color: trunk });
  for (let i = 0, n = lite ? 2 : 4; i < n; i++) { const a = r() * 6.28, d = i ? 0.9 * s : 0; bake(B.solid, GEO.ball, { x: x + Math.cos(a) * d, y: (3.6 + r() * 1.2) * s, z: z + Math.sin(a) * d, sx: (1.5 + r() * 0.6) * s, sy: (1.3 + r() * 0.5) * s, sz: (1.5 + r() * 0.6) * s, color: lc.clone().multiplyScalar(0.85 + r() * 0.3) }); }
}
function car(B, x, z, ang, c) {
  const body = col(c), glass = col('#26313b'), tyre = col('#1b1c1e'), ca = Math.cos(ang), sa = Math.sin(ang), P = (u, v) => [x + u * ca - v * sa, z + u * sa + v * ca];
  bake(B.shiny, GEO.box, { x, y: 0.75, z, ry: -ang, sx: 1.8, sy: 0.75, sz: 4.2, color: body });
  bake(B.shiny, GEO.box, { x: P(0, 0.2)[0], y: 1.4, z: P(0, 0.2)[1], ry: -ang, sx: 1.6, sy: 0.6, sz: 2.2, color: glass });
  for (const [u, v] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) { const [px, pz] = P(u, v); bake(B.solid, GEO.cyl, { x: px, y: 0.36, z: pz, ry: -ang, sx: 0.36, sy: 0.25, sz: 0.36, color: tyre }); }
}
function prop(B, view, p, r) {
  const k = p.k;
  if (k === 'tree' || k === 'pine' || k === 'palm' || k === 'poplar') return tree(B, p.x, p.y, p.s || 1, p.c, k, r, p.lite);
  if (k === 'car') return car(B, p.x, p.y, p.ang || 0, p.c);
  if (k === 'lamp') return lamp(B, view, p.x, p.y);
  if (k === 'bench' || k === 'bistro') { B.solid.box(p.x - 1, p.y - 0.25, p.x + 1, p.y + 0.25, 0.45, 0.55, col('#8a5a33')); B.solid.box(p.x - 1, p.y + 0.2, p.x + 1, p.y + 0.3, 0.55, 1.0, col('#8a5a33')); B.shiny.box(p.x - 0.9, p.y - 0.2, p.x - 0.8, p.y + 0.2, 0, 0.45, col('#2b2f33')); B.shiny.box(p.x + 0.8, p.y - 0.2, p.x + 0.9, p.y + 0.2, 0, 0.45, col('#2b2f33')); return; }
  if (k === 'fence') { const c = col(p.c); B.solid.box(p.x - 4, p.y - 0.06, p.x + 4, p.y + 0.06, 0.5, 0.65, c); B.solid.box(p.x - 4, p.y - 0.06, p.x + 4, p.y + 0.06, 0.9, 1.05, c); for (let i = -4; i <= 4; i += 1) B.solid.box(p.x + i - 0.06, p.y - 0.08, p.x + i + 0.06, p.y + 0.08, 0, 1.2, c); return; }
  if (k === 'fountain') { bake(B.paving, GEO.cyl, { x: p.x, y: 0.35, z: p.y, sx: 2.6, sy: 0.7, sz: 2.6, color: col('#cfc9bb') }); bake(B.water, GEO.cyl, { x: p.x, y: 0.62, z: p.y, sx: 2.3, sy: 0.1, sz: 2.3, color: col('#ffffff') }); bake(B.paving, GEO.cyl, { x: p.x, y: 1.4, z: p.y, sx: 0.35, sy: 2, sz: 0.35, color: col('#cfc9bb') }); bake(B.paving, GEO.cyl, { x: p.x, y: 2.4, z: p.y, sx: 1, sy: 0.2, sz: 1, color: col('#cfc9bb') }); return; }
  if (k === 'signal') { const a = p.ang || 0, ca = Math.cos(a), sa = Math.sin(a); bake(B.shiny, GEO.cyl, { x: p.x, y: 1.9, z: p.y, sx: 0.08, sy: 3.8, sz: 0.08, color: col('#2b2e33') }); /* a traffic light on the corner */
    const hx = p.x + ca * 0.25, hz = p.y + sa * 0.25; bake(B.shiny, GEO.box, { x: hx, y: 3.3, z: hz, ry: -a, sx: 0.32, sy: 1.0, sz: 0.3, color: col('#1d1f23') });
    ['#ff3b30', '#ffb020', '#36d27a'].forEach((c, i) => bake(B.glow, GEO.ball, { x: hx + ca * 0.16, y: 3.62 - i * 0.31, z: hz + sa * 0.16, sx: 0.09, sy: 0.09, sz: 0.09, color: col(c).multiplyScalar(i === p.on ? 1 : 0.22) })); return; }
  if (k === 'bin') { bake(B.shiny, GEO.cyl, { x: p.x, y: 0.45, z: p.y, sx: 0.28, sy: 0.9, sz: 0.28, color: col('#3c4a3f') }); bake(B.shiny, GEO.cyl, { x: p.x, y: 0.92, z: p.y, sx: 0.3, sy: 0.06, sz: 0.3, color: col('#2b352d') }); return; }
  if (k === 'hedge') { const c = col(p.c || '#3f7d32'), w = p.w || 8; if (p.ns) B.solid.box(p.x - 0.35, p.y - w / 2, p.x + 0.35, p.y + w / 2, 0, 0.9, c); else B.solid.box(p.x - w / 2, p.y - 0.35, p.x + w / 2, p.y + 0.35, 0, 0.9, c); return; }
  if (k === 'hydrant') { bake(B.shiny, GEO.cyl, { x: p.x, y: 0.4, z: p.y, sx: 0.2, sy: 0.8, sz: 0.2, color: col('#c8382e') }); return; }
  if (k === 'mailbox') { B.shiny.box(p.x - 0.3, p.y - 0.3, p.x + 0.3, p.y + 0.3, 0, 1.2, col('#c8382e')); return; }
  if (k === 'phone') { B.glass.box(p.x - 0.55, p.y - 0.55, p.x + 0.55, p.y + 0.55, 0, 2.4, col('#c8382e'), { su: 4, sv: 4 }); return; }
  if (k === 'atm') { /* a cash machine: a kiosk in the bank's colour, a lit header with the sign, the screen, a keypad and the card and cash slots, facing out (ang) */
    const a = p.ang || 0, s = Math.sin(a), c = Math.cos(a), at = (f, u) => [p.x + s * f + c * u, p.y + c * f - s * u], body = col(p.c || '#1E7A55');
    bake(B.shiny, GEO.box, { x: p.x, y: 1.0, z: p.y, ry: a, sx: 1.0, sy: 2.0, sz: 0.62, color: col('#C9CED4') }); /* the cabinet */
    { const [hx, hz] = at(0.02, 0); bake(B.shiny, GEO.box, { x: hx, y: 2.12, z: hz, ry: a, sx: 1.08, sy: 0.34, sz: 0.68, color: body }); }
    { const [gx, gz] = at(0.35, 0); bake(B.glow, GEO.box, { x: gx, y: 2.12, z: gz, ry: a, sx: 0.8, sy: 0.2, sz: 0.02, color: col('#9fe3ff') }); } /* the lit sign */
    { const [sx, sz] = at(0.3, 0); bake(B.glow, GEO.box, { x: sx, y: 1.45, z: sz, ry: a, rx: -0.18, sx: 0.56, sy: 0.4, sz: 0.04, color: col('#2f8fd8') }); } /* the screen */
    { const [kx, kz] = at(0.36, 0); bake(B.shiny, GEO.box, { x: kx, y: 1.02, z: kz, ry: a, rx: -0.6, sx: 0.5, sy: 0.05, sz: 0.3, color: col('#3a3f46') });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const [bx2, bz2] = at(0.4 + j * 0.06, (i - 1) * 0.11); bake(B.shiny, GEO.box, { x: bx2, y: 1.08 - j * 0.035, z: bz2, ry: a, sx: 0.07, sy: 0.03, sz: 0.05, color: col('#d5d9de') }); } } /* the keypad */
    { const [cx2, cz2] = at(0.32, 0.18); bake(B.glow, GEO.box, { x: cx2, y: 1.26, z: cz2, ry: a, sx: 0.14, sy: 0.03, sz: 0.04, color: col('#36d27a') }); } /* the card slot's light */
    { const [dx2, dz2] = at(0.32, 0); bake(B.shiny, GEO.box, { x: dx2, y: 0.78, z: dz2, ry: a, sx: 0.42, sy: 0.05, sz: 0.04, color: col('#1d1f23') }); } /* the cash slot */
    return; }
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
// ---------------- people ----------------
// Rounded limbs (capsules), hands and shoes, a neck, hair, and a painted face (eyes, brows, nose, mouth) on the head;
// clothes carry a faint fabric weave. The geometry and textures are made once and shared by everyone.
const PGEO = { limb: new THREE.CapsuleGeometry(0.5, 1, 4, 10), torso: new THREE.CapsuleGeometry(0.5, 0.6, 4, 14), head: new THREE.SphereGeometry(1, 22, 16), hand: new THREE.SphereGeometry(1, 10, 8),
  neck: new THREE.CylinderGeometry(1, 1, 1, 10), shoe: new THREE.CapsuleGeometry(0.5, 1, 3, 8) };
const fabricTex = () => canvasTex('fabric', 128, (g, S) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.05 : 0.09})`; g.fillRect(0, y, S, 1); } for (let x = 0; x < S; x += 2) { g.fillStyle = 'rgba(0,0,0,.04)'; g.fillRect(x, 0, 1, S); } noise(g, 1, 400, '0,0,0', 0.06, rnd(51)); });
const CLOTH = new Map(); const cmat = c => { let m = CLOTH.get(c); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, map: fabricTex(), roughness: 0.92 }); CLOTH.set(c, m); } return m; };
// A face, painted round the head: the sphere's front (+z, facing where they walk) is a quarter of the way along the texture.
function faceTex(skin) { return canvasTex('face-' + skin, 256, (g, S) => {
  g.fillStyle = skin; g.fillRect(0, 0, S, S); const c = S * 0.25, ey = S * 0.47;
  const sh = g.createRadialGradient(c, S * 0.55, 4, c, S * 0.55, 60); sh.addColorStop(0, 'rgba(255,255,255,.10)'); sh.addColorStop(1, 'rgba(0,0,0,.10)'); g.fillStyle = sh; g.fillRect(0, 0, S, S);
  for (const sx of [-1, 1]) { const x = c + sx * 11; g.fillStyle = '#f6f1ea'; g.beginPath(); g.ellipse(x, ey, 5.2, 3.4, 0, 0, 7); g.fill(); g.fillStyle = '#3b2a1e'; g.beginPath(); g.arc(x, ey, 2.4, 0, 7); g.fill(); g.fillStyle = '#000'; g.beginPath(); g.arc(x, ey, 1.1, 0, 7); g.fill();
    g.strokeStyle = 'rgba(30,18,10,.85)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x - 6, ey - 7); g.quadraticCurveTo(x, ey - 9.5, x + 6, ey - 7); g.stroke();
    g.fillStyle = 'rgba(200,80,70,.10)'; g.beginPath(); g.arc(x + sx * 3, ey + 13, 6, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,.16)'; g.beginPath(); g.moveTo(c - 3, ey + 12); g.lineTo(c + 3, ey + 12); g.lineTo(c, ey + 3); g.fill();
  g.strokeStyle = 'rgba(90,30,25,.85)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(c - 7, ey + 21); g.quadraticCurveTo(c, ey + 24, c + 7, ey + 21); g.stroke();
  for (const sx of [-1, 1]) { g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.ellipse(c + sx * 64, ey + 4, 6, 10, 0, 0, 7); g.fill(); } // ears' shadow
}, { repeat: false }); }
const HEADS = new Map(); const headMat = skin => { let m = HEADS.get(skin); if (!m) { m = new THREE.MeshStandardMaterial({ map: faceTex(skin), roughness: 0.65 }); HEADS.set(skin, m); } return m; };
// look: a player's own character (shared/avatar.js). Hunters and seekers wear the game's colours over it.
export function makePerson(seed, role, look) {
  if (look) return personFromLook(look, role);
  const h = hashS(seed), skin = SKIN[h % SKIN.length], uniform = role === 'hunter' || role === 'seeker';
  const shirt = uniform ? (role === 'hunter' ? '#1e2a44' : '#3a4a2a') : SHIRT[(h >>> 3) % SHIRT.length], legs = uniform ? '#16203a' : TROUSERS[(h >>> 7) % TROUSERS.length];
  const hair = uniform ? '#16203a' : ['#1b1b1b', '#4a2e1c', '#8a5a2b', '#2b2b2b', '#b8b2a8'][(h >>> 11) % 5], longSleeve = uniform || ((h >>> 13) & 1);
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const part = (geo, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = false; return o; };
  const skinM = pmat(skin), shirtM = cmat(shirt), legM = cmat(legs), shoeM = pmat((h >>> 15) & 1 ? '#1b1c1e' : '#e8e4dc');
  // legs: hip pivots, a rounded leg in the trousers, and a shoe
  const leg = x => { const pv = new THREE.Group(); pv.position.set(x, 0.92, 0); pv.add(part(PGEO.limb, legM, 0, -0.43, 0, 0.17, 0.43, 0.18));
    const shoe = part(PGEO.shoe, shoeM, 0, -0.86, 0.05, 0.13, 0.12, 0.09); shoe.rotation.x = Math.PI / 2; pv.add(shoe); return pv; }; // the shoe lies along the foot
  const legL = leg(-0.12), legR = leg(0.12); body.add(legL, legR);
  body.add(part(PGEO.torso, legM, 0, 0.97, 0, 0.42, 0.16, 0.25)); // hips
  body.add(part(PGEO.torso, shirtM, 0, 1.28, 0, 0.5, 0.37, 0.28)); // chest
  body.add(part(PGEO.neck, skinM, 0, 1.6, 0, 0.065, 0.12, 0.065));
  // arms: shoulder pivots, sleeve, forearm (bare or sleeved) and a hand
  const arm = x => { const pv = new THREE.Group(); pv.position.set(x, 1.5, 0); pv.add(part(PGEO.limb, shirtM, 0, -0.17, 0, 0.13, 0.19, 0.13)); pv.add(part(PGEO.limb, longSleeve ? shirtM : skinM, 0, -0.47, 0, 0.11, 0.17, 0.11)); pv.add(part(PGEO.hand, skinM, 0, -0.67, 0.01, 0.06, 0.07, 0.05)); return pv; };
  const armL = arm(-0.31), armR = arm(0.31); body.add(armL, armR);
  const head = part(PGEO.head, headMat(skin), 0, 1.76, 0, 0.15, 0.18, 0.16); body.add(head);
  body.add(part(GEO.half, pmat(hair), 0, 1.79, -0.01, 0.158, 0.13, 0.168));
  if (role === 'hunter') { body.add(part(GEO.cyl, pmat('#16203a'), 0, 1.92, 0.02, 0.17, 0.07, 0.18)); body.add(part(GEO.box, pmat('#111'), 0, 1.9, 0.17, 0.18, 0.025, 0.1)); body.add(part(GEO.box, pmat('#f2c94c'), 0, 1.95, 0.18, 0.05, 0.05, 0.02));
    body.add(part(GEO.box, pmat('#d9ff3a'), 0, 1.3, 0.14, 0.5, 0.1, 0.02)); body.add(part(GEO.box, pmat('#f2c94c'), 0.12, 1.42, 0.15, 0.06, 0.07, 0.015)); body.add(part(GEO.box, pmat('#1b1c1e'), 0, 1.0, 0, 0.44, 0.06, 0.27)); } // cap, badge, hi-vis band and belt
  else body.add(part(GEO.box, pmat('#2a2522'), 0, 1.04, 0, 0.43, 0.04, 0.26)); // a belt
  let torch = null;
  if (role === 'seeker') { torch = part(GEO.cyl, pmat('#2b2b2b'), 0, -0.65, 0.12, 0.05, 0.25, 0.05); torch.rotation.x = Math.PI / 2; armR.add(torch);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.rotation.x = -Math.PI / 2; beam.position.set(0.32, 1.0, 4.7); beam.visible = false; g.add(beam); torch.userData.beam = beam; }
  // a soft shadow under their feet (cheaper than real shadows for people who keep moving)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), BLOB); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob);
  let phase = 0, heading = 0;
  const P = { group: g, body, head, torch, role, armL, armR, x: 0, z: 0,
    setPos(x, z) { this.x = x; this.z = z; g.position.set(x, 0, z); },
    // speed in m/s; turns towards where they're going; the knees and elbows bend a little as they walk
    animate(dt, vx, vz) { const sp = Math.hypot(vx, vz); if (sp > 0.3) { const want = Math.atan2(vx, vz); let d = want - heading; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; heading += d * Math.min(1, dt * 12); }
      g.rotation.y = heading; phase += dt * (2 + sp * 1.6); const sw = Math.min(1, sp / 6) * 0.9, s = Math.sin(phase) * sw;
      legL.rotation.x = s; legR.rotation.x = -s; armL.rotation.x = -s * 0.9; armR.rotation.x = torch ? -1.2 : s * 0.9;
      armL.rotation.z = -0.06; armR.rotation.z = 0.06; body.position.y = Math.abs(Math.cos(phase)) * 0.06 * Math.min(1, sp / 3); body.rotation.x = Math.min(0.25, sp * 0.03);
      head.rotation.y = sp < 0.3 ? Math.sin(phase * 0.15) * 0.25 : 0; } // standing still, they glance about
  };
  return P;
}
const BLOB = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false });
function personFromLook(look, role) {
  const L = JSON.parse(JSON.stringify(look)), w = L.w || (L.w = {});
  if (role === 'hunter') { w.top = ['shirt', 5]; w.bot = ['trousers', 5]; w.hat = ['cap', 5]; delete w.out; } // in uniform
  else if (role === 'seeker') { w.top = ['hoodie', 9]; w.bot = ['cargo', 9]; delete w.out; }
  const av = buildAvatar(L), g = av.group;
  let torch = null;
  if (role === 'seeker') { torch = new THREE.Mesh(GEO.cyl, pmat('#2b2b2b')); torch.scale.set(0.05, 0.25, 0.05); torch.position.set(0, -0.3, 0.12); torch.rotation.x = Math.PI / 2; av.forearmR.add(torch);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.rotation.x = -Math.PI / 2; beam.position.set(0.32, 1.0, 4.7); beam.visible = false; g.add(beam); torch.userData.beam = beam; }
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), BLOB); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob);
  return { group: g, body: av.body, head: av.head, torch, role, armL: av.armL, armR: av.armR, x: 0, z: 0, av,
    setPos(x, z) { this.x = x; this.z = z; g.position.set(x, 0, z); },
    animate(dt, vx, vz) { av.animate(dt, vx, vz); if (torch) { av.armR.rotation.x = -1.2; av.forearmR.rotation.x = -0.1; } } };
}
// A name over someone's head.
export function nameTag(text, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 24); g.fillStyle = 'rgba(20,18,16,.62)'; g.beginPath(); if (g.roundRect) g.roundRect(128 - w / 2, 10, w, 44, 22); else g.rect(128 - w / 2, 10, w, 44); g.fill(); g.fillStyle = color; g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(2.4, 0.6, 1); s.renderOrder = 10; return s;
}
export { THREE };
// a car's length and width in metres (for bumping into it on foot)
const vbase = k => String(k).replace(/[!+]$/, ''); /* 'bicycle!': nobody on it; 'motorbike+': rider and a passenger */
export const carSize = kind => { const vk = vbase(kind); if (VEH[vk]) return [VEH[vk].L, VEH[vk].W]; const S = CARS[kind] || CARS.car; return [S.L, S.W]; };

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
    // a zebra crossing with traffic lights, patches of newer asphalt, manhole covers and drains
    const zc = z0 - 70; for (let x = -half + 0.4; x < half - 0.3; x += 1.1) B.paint.quad([x, 0.021, zc + 1.8], [x + 0.55, 0.021, zc + 1.8], [x + 0.55, 0.021, zc - 1.8], [x, 0.021, zc - 1.8], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
    for (const sx of [-1, 1]) { B.paint.quad([-half, 0.021, zc + sx * 2.4 + 0.15], [half, 0.021, zc + sx * 2.4 + 0.15], [half, 0.021, zc + sx * 2.4 - 0.15], [-half, 0.021, zc + sx * 2.4 - 0.15], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
      const px = sx * (half + 0.6), pz = zc - sx * 2.6; bake(B.shiny, GEO.cyl, { x: px, y: 1.6, z: pz, sx: 0.07, sy: 3.2, sz: 0.07, color: col('#2b2f33') }); B.solid.box(px - 0.2, pz - 0.14, px + 0.2, pz + 0.14, 2.6, 3.6, col('#1d1f22'));
      for (const [k, c] of [[0, '#ff3b2a'], [1, '#f2b134'], [2, '#3cd66a']]) bake(B.glow, GEO.ball, { x: px, y: 3.4 - k * 0.32, z: pz - sx * 0.15, sx: 0.1, sy: 0.1, sz: 0.06, color: col(c) }); }
    for (let i = 0; i < 6; i++) { const px = (r() - 0.5) * half * 1.6, pz = z0 - r() * CH, pw = 1.5 + r() * 3, pd = 1 + r() * 4; B.paint.quad([px, 0.012, pz + pd], [px + pw, 0.012, pz + pd], [px + pw, 0.012, pz], [px, 0.012, pz], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col('#3c3d42')); }
    for (let i = 0; i < 4; i++) bake(B.shiny, GEO.cyl, { x: (r() - 0.5) * half * 1.4, y: 0.012, z: z0 - r() * CH, sx: 0.36, sy: 0.02, sz: 0.36, color: col('#2a2b2e') });
    // the pavements: bus stops, benches, bins, bollards and trees in planters
    for (const sx of [-1, 1]) for (let z = z0 - 6 - r() * 10; z > z1 + 6; z -= 14 + r() * 18) { const px = sx * (half + walk * 0.62), k = r();
      if (k < 0.18) { B.glass.box(px - 0.04 * sx, z - 1.6, px + 0.04 * sx, z + 1.6, 0.1, 2.3, col('#bfd6e3'), { su: 3, sv: 3 }); B.solid.box(px - 0.7, z - 1.7, px + 0.7, z + 1.7, 2.3, 2.42, col('#2b2f33')); B.solid.box(px - 0.5, z - 1.2, px + 0.5, z + 1.2, 0.45, 0.52, col('#7a5a3a')); B.paint.quad([px + sx * 0.6, 1.0, z - 0.6], [px + sx * 0.6, 1.0, z + 0.6], [px + sx * 0.6, 2.1, z + 0.6], [px + sx * 0.6, 2.1, z - 0.6], [sx, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], col(['#e4572e', '#4a7bd9', '#f2c94c'][(r() * 3) | 0])); }
      else if (k < 0.4) { B.solid.box(px - 0.25, z - 0.9, px + 0.25, z + 0.9, 0.42, 0.5, col('#7a5a3a')); B.solid.box(px + sx * 0.2 - 0.04, z - 0.9, px + sx * 0.2 + 0.04, z + 0.9, 0.5, 0.95, col('#7a5a3a')); B.solid.box(px - 0.2, z - 0.85, px + 0.2, z - 0.75, 0, 0.42, col('#2b2f33')); B.solid.box(px - 0.2, z + 0.75, px + 0.2, z + 0.85, 0, 0.42, col('#2b2f33')); }
      else if (k < 0.6) { bake(B.shiny, GEO.cyl, { x: px, y: 0.5, z, sx: 0.3, sy: 1, sz: 0.3, color: col(['#2f6b4a', '#2b2f33', '#4a7bd9'][(r() * 3) | 0]) }); }
      else if (k < 0.8) { B.paving.box(px - 0.7, z - 0.7, px + 0.7, z + 0.7, 0, 0.5, col('#b8b2a4'), { su: 2, sv: 2 }); tree(B, px, z, 0.7 + r() * 0.3, ['#6FAE45', '#5E9E45', '#7DB656'][(r() * 3) | 0], 'tree', r); }
      else for (let b2 = 0; b2 < 3; b2++) bake(B.shiny, GEO.cyl, { x: sx * (half + 0.35), y: 0.45, z: z + b2 * 1.4, sx: 0.08, sy: 0.9, sz: 0.08, color: col('#2b2f33') }); }
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
// ---------------- cars ----------------
// A real car shape: the side profile (bumpers, bonnet, sloped windscreen, roof, boot, wheel arches cut in) extruded
// across the car's width with rounded edges, glass that wraps round the cabin, tyres with spoked alloy rims, lights,
// grille, number plates, mirrors and door lines. Each kind's shape is built once and shared by every car of that
// kind; a car is a handful of meshes (paint, glass, trim, lights, four wheels), so a street full of them stays cheap.
// x runs along the car with the front at +x, y is up; the car is turned so its front faces -z (the way it drives).
const CARS = {
  car: { L: 4.4, W: 1.84, y0: 0.3, r: 0.33, xr: -1.35, xf: 1.35, top: [[-2.2, 0.84], [-2.12, 0.93], [-1.85, 0.97], [-1.25, 1.0], [-0.75, 1.4], [-0.6, 1.44], [0.45, 1.45], [0.6, 1.42], [1.15, 1.02], [1.95, 0.9], [2.15, 0.8], [2.2, 0.62]],
    glass: [[-1.25, 1.0], [-0.75, 1.4], [0.6, 1.41], [1.15, 1.02]], pillar: -0.08, lamp: 0.72, tail: 0.86 },
  getaway: { L: 4.5, W: 1.9, y0: 0.26, r: 0.34, xr: -1.4, xf: 1.38, top: [[-2.25, 0.8], [-2.15, 0.9], [-1.6, 0.95], [-0.95, 0.99], [-0.45, 1.32], [0.35, 1.34], [0.95, 1.0], [1.9, 0.84], [2.18, 0.7], [2.25, 0.52]],
    glass: [[-0.95, 0.99], [-0.45, 1.3], [0.35, 1.31], [0.95, 1.0]], pillar: -0.05, lamp: 0.66, tail: 0.82 },
  van: { L: 5.4, W: 1.98, y0: 0.32, r: 0.37, xr: -1.75, xf: 1.75, top: [[-2.7, 0.55], [-2.7, 2.05], [-2.6, 2.16], [1.35, 2.16], [1.95, 1.42], [2.55, 1.08], [2.7, 0.92], [2.7, 0.55]],
    glass: [[1.2, 1.45], [1.2, 2.06], [1.37, 2.08], [1.95, 1.42]], lamp: 0.85, tail: 1.2 },
  bus: { L: 11, W: 2.5, y0: 0.36, r: 0.5, xr: -3.6, xf: 3.5, top: [[-5.5, 0.6], [-5.5, 2.9], [-5.38, 3.02], [5.35, 3.02], [5.5, 2.88], [5.5, 0.6]], glass: [[-5.6, 1.45], [-5.6, 2.6], [5.6, 2.6], [5.6, 1.45]], lamp: 0.85, tail: 1.1 },
};
CARS.police = CARS.car;
// the colony's service vehicles (as on the 2D map): a fire engine, an ambulance and a lorry, front at +x
CARS.firetruck = { L: 8.2, W: 2.5, y0: 0.4, r: 0.52, xr: -2.7, xf: 2.6, top: [[-4.1, 0.75], [-4.1, 2.55], [1.85, 2.55], [2.05, 3.0], [3.55, 3.0], [4.1, 2.15], [4.1, 0.75]], glass: [[2.15, 2.0], [2.2, 2.85], [3.5, 2.85], [4.0, 2.1]], lamp: 1.0, tail: 1.2, paint: [0.3, 0.35, 1.1] };
CARS.ambulance = { L: 5.9, W: 2.1, y0: 0.34, r: 0.38, xr: -1.85, xf: 1.85, top: [[-2.95, 0.58], [-2.95, 2.62], [1.05, 2.62], [1.3, 2.22], [2.25, 1.35], [2.95, 1.05], [2.95, 0.58]], glass: [[1.32, 1.42], [1.34, 2.1], [1.42, 2.14], [2.22, 1.36]], lamp: 0.88, tail: 1.2, paint: [0.3, 0.3, 1.0] };
CARS.truck = { L: 7.6, W: 2.45, y0: 0.4, r: 0.5, xr: -2.5, xf: 2.45, top: [[-3.8, 0.75], [-3.8, 3.05], [1.55, 3.05], [1.55, 2.65], [2.05, 2.65], [2.3, 2.55], [3.8, 1.95], [3.8, 0.75]], glass: [[2.32, 1.75], [2.35, 2.5], [2.45, 2.52], [3.75, 1.98]], lamp: 0.95, tail: 1.2, paint: [0.4, 0.3, 0.9] };
// The colony's own cars (shared/catalog.js CAR_MODELS), each with its own body. Style: grille (plain, chrome or none), led
// (a light bar across the front and back), spoiler (lip or wing), intakes, diffuser, rails, bed (a pickup's covered bed),
// glow (underglow and glowing rims), wheel (steel, alloy, sport, aero, turbine), paint [roughness, metalness, reflections],
// exhaust (tail pipes; none for electric). A cheap car is plain; the dearer it is, the more it gleams.
Object.assign(CARS, {
  hatch: { L: 3.9, W: 1.72, y0: 0.3, r: 0.3, xr: -1.22, xf: 1.25, top: [[-1.95, 0.62], [-1.95, 1.05], [-1.88, 1.34], [-1.62, 1.5], [-0.2, 1.53], [0.42, 1.48], [0.98, 1.03], [1.72, 0.93], [1.95, 0.8], [1.95, 0.56]],
    glass: [[-1.84, 1.06], [-1.6, 1.47], [0.42, 1.46], [0.96, 1.04]], pillar: -0.35, lamp: 0.78, tail: 1.02, grille: 'plain', wheel: 'steel', paint: [0.55, 0.15, 0.6], exhaust: 1 },
  sedan: { ...CARS.car, grille: 'plain', wheel: 'alloy', paint: [0.38, 0.35, 0.9], exhaust: 1 },
  pickup: { L: 5.3, W: 1.95, y0: 0.42, r: 0.42, xr: -1.75, xf: 1.6, top: [[-2.65, 0.72], [-2.65, 1.2], [-0.62, 1.2], [-0.62, 1.86], [0.58, 1.88], [1.2, 1.36], [2.38, 1.18], [2.65, 1.02], [2.65, 0.72]],
    glass: [[-0.52, 1.36], [-0.5, 1.82], [0.58, 1.83], [1.16, 1.37]], lamp: 0.98, tail: 1.02, grille: 'plain', bed: true, wheel: 'steel', paint: [0.45, 0.25, 0.7], exhaust: 1 },
  suv: { L: 4.7, W: 1.95, y0: 0.4, r: 0.4, xr: -1.5, xf: 1.48, top: [[-2.35, 0.66], [-2.35, 1.55], [-2.26, 1.8], [0.55, 1.82], [1.2, 1.32], [2.15, 1.12], [2.35, 1.0], [2.35, 0.66]],
    glass: [[-2.2, 1.33], [-2.1, 1.78], [0.55, 1.79], [1.17, 1.33]], pillar: -0.45, lamp: 0.98, tail: 1.3, grille: 'plain', rails: true, wheel: 'alloy', paint: [0.4, 0.35, 0.9], exhaust: 1 },
  ev: { L: 4.0, W: 1.78, y0: 0.3, r: 0.32, xr: -1.3, xf: 1.3, top: [[-2.0, 0.6], [-2.0, 1.0], [-1.86, 1.3], [-1.5, 1.48], [0.2, 1.52], [0.8, 1.32], [1.45, 0.96], [2.0, 0.8], [2.0, 0.52]],
    glass: [[-1.8, 1.05], [-1.46, 1.45], [0.2, 1.49], [1.36, 0.97]], pillar: -0.2, lamp: 0.8, tail: 1.05, grille: 'none', led: '#dff6ff', wheel: 'aero', paint: [0.3, 0.3, 1.0], exhaust: 0 },
  evsedan: { L: 4.8, W: 1.92, y0: 0.26, r: 0.35, xr: -1.5, xf: 1.45, top: [[-2.4, 0.55], [-2.4, 0.9], [-2.2, 1.0], [-1.3, 1.24], [-0.5, 1.44], [0.4, 1.45], [1.1, 1.05], [2.0, 0.82], [2.4, 0.65], [2.4, 0.5]],
    glass: [[-1.3, 1.02], [-0.5, 1.41], [0.4, 1.42], [1.1, 1.03]], pillar: -0.05, lamp: 0.7, tail: 0.92, grille: 'none', led: '#dff6ff', wheel: 'aero', paint: [0.2, 0.55, 1.3], exhaust: 0 },
  evsuv: { L: 4.85, W: 2.0, y0: 0.38, r: 0.4, xr: -1.52, xf: 1.5, top: [[-2.42, 0.65], [-2.42, 1.25], [-2.3, 1.62], [-1.9, 1.75], [0.5, 1.76], [1.2, 1.3], [2.2, 1.08], [2.42, 0.95], [2.42, 0.65]],
    glass: [[-2.22, 1.3], [-1.86, 1.72], [0.5, 1.73], [1.18, 1.31]], pillar: -0.35, lamp: 0.94, tail: 1.2, grille: 'none', led: '#dff6ff', rails: true, wheel: 'aero', paint: [0.25, 0.5, 1.2], exhaust: 0 },
  luxury: { L: 5.2, W: 1.95, y0: 0.3, r: 0.38, xr: -1.6, xf: 1.75, top: [[-2.6, 0.62], [-2.6, 0.95], [-2.45, 1.05], [-1.6, 1.1], [-1.0, 1.48], [0.6, 1.5], [1.25, 1.1], [2.3, 0.98], [2.6, 0.86], [2.6, 0.6]],
    glass: [[-1.55, 1.1], [-1.0, 1.45], [0.6, 1.46], [1.22, 1.1]], pillar: -0.15, lamp: 0.8, tail: 0.92, grille: 'chrome', chrome: true, wheel: 'alloy', paint: [0.12, 0.7, 1.6], exhaust: 2 },
  sports: { L: 4.5, W: 1.9, y0: 0.24, r: 0.34, xr: -1.38, xf: 1.42, top: [[-2.25, 0.55], [-2.25, 0.85], [-2.1, 0.95], [-1.5, 1.0], [-0.85, 1.05], [-0.35, 1.28], [0.3, 1.3], [0.85, 1.0], [1.7, 0.82], [2.15, 0.68], [2.25, 0.48]],
    glass: [[-0.85, 1.04], [-0.35, 1.26], [0.3, 1.27], [0.85, 1.0]], lamp: 0.66, tail: 0.84, grille: 'plain', spoiler: 'lip', diffuser: true, wheel: 'sport', paint: [0.15, 0.6, 1.4], exhaust: 2 },
  gt: { L: 4.7, W: 1.95, y0: 0.24, r: 0.36, xr: -1.5, xf: 1.4, top: [[-2.35, 0.55], [-2.35, 0.88], [-2.15, 0.98], [-1.4, 1.05], [-0.6, 1.28], [0.2, 1.3], [0.75, 1.05], [1.8, 0.85], [2.3, 0.68], [2.35, 0.5]],
    glass: [[-1.3, 1.04], [-0.6, 1.26], [0.2, 1.27], [0.75, 1.03]], lamp: 0.68, tail: 0.86, grille: 'chrome', spoiler: 'lip', diffuser: true, wheel: 'sport', paint: [0.1, 0.7, 1.6], exhaust: 4 },
  supercar: { L: 4.6, W: 2.0, y0: 0.2, r: 0.35, xr: -1.45, xf: 1.35, top: [[-2.3, 0.5], [-2.3, 0.92], [-2.0, 0.98], [-1.2, 1.02], [-0.6, 1.12], [-0.15, 1.16], [0.35, 1.1], [1.0, 0.86], [1.9, 0.66], [2.3, 0.5], [2.3, 0.38]],
    glass: [[-0.75, 1.0], [-0.15, 1.13], [0.35, 1.08], [1.0, 0.85]], lamp: 0.56, tail: 0.8, grille: 'none', led: '#ffffff', spoiler: 'wing', intakes: true, diffuser: true, wheel: 'sport', paint: [0.08, 0.75, 1.8], exhaust: 2 },
  hyper: { L: 4.8, W: 2.04, y0: 0.18, r: 0.36, xr: -1.55, xf: 1.45, top: [[-2.4, 0.45], [-2.4, 0.88], [-2.1, 0.95], [-1.3, 1.0], [-0.7, 1.08], [-0.2, 1.12], [0.3, 1.06], [1.0, 0.82], [1.95, 0.6], [2.4, 0.42], [2.4, 0.34]],
    glass: [[-0.75, 1.0], [-0.2, 1.1], [0.3, 1.04], [1.0, 0.82]], lamp: 0.52, tail: 0.78, grille: 'none', led: '#9ff8ff', spoiler: 'lip', fin: true, intakes: true, diffuser: true, wheel: 'aero', paint: [0.06, 0.8, 2.0], exhaust: 0 },
  concept: { L: 4.9, W: 2.05, y0: 0.22, r: 0.37, xr: -1.6, xf: 1.6, top: [[-2.45, 0.5], [-2.45, 0.8], [-2.2, 0.9], [-1.4, 1.05], [-0.9, 1.25], [-0.2, 1.34], [0.5, 1.28], [1.2, 0.95], [2.0, 0.7], [2.45, 0.5], [2.45, 0.4]],
    glass: [[-1.2, 1.08], [-0.2, 1.32], [0.5, 1.26], [1.25, 0.93]], lamp: 0.6, tail: 0.82, grille: 'none', led: '#c9b2ff', glow: '#8f6bff', diffuser: true, wheel: 'turbine', paint: [0.05, 0.85, 2.2], exhaust: 0 },
});
// A car's body, shaped like a car rather than a slab: the cabin narrows above the waist (the sides lean in), and the
// corners at each end round in a little. g: a body or glass extruded across the car (front at -z, across is x).
function shapeBody(g, S) { const p = g.attributes.position, belt = S.glass[0][1] - 0.06, half = S.L / 2, cabin = S.bed || S === CARS.van || S === CARS.bus ? 0.06 : 0.15;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); let k = 1;
    if (y > belt) k *= 1 - cabin * Math.min(1, (y - belt) / 0.4);
    const t = Math.max(0, (Math.abs(z) - (half - 0.7)) / 0.7); k *= 1 - 0.09 * t * t; p.setX(i, p.getX(i) * k); }
  p.needsUpdate = true; g.computeVertexNormals(); return g; }
// how high a car's top is at a point along it (x: metres from the middle, front +)
const topAt = (S, x) => { const t = S.top; for (let i = 1; i < t.length; i++) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; if ((x - x0) * (x - x1) <= 0 && x0 !== x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return t[t.length - 1][1]; };
const CARGEO = new Map(), CARMAT = new Map();
const carMat = (key, make) => { let m = CARMAT.get(key); if (!m) { m = make(); CARMAT.set(key, m); } return m; };
function carProfile(S) { // the outline: along the bottom from the front, over each wheel arch, then back along the top
  const sh = new THREE.Shape(), ar = S.r + 0.07, half = S.L / 2; sh.moveTo(half, S.y0);
  for (const xc of [S.xf, S.xr]) { sh.lineTo(xc + ar, S.y0); for (let k = 0; k <= 10; k++) { const a = Math.PI * k / 10; sh.lineTo(xc + ar * Math.cos(a), S.y0 + ar * Math.sin(a)); } } // over the wheel, from its front edge to its back
  sh.lineTo(-half, S.y0); for (const [x, y] of S.top) sh.lineTo(x, y); sh.closePath(); return sh; }
function extrudeAcross(shape, width, bevel, size = bevel * 0.8, segs = 2) { const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: size, bevelSegments: segs, curveSegments: segs === 1 ? 3 : 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2); g.rotateY(Math.PI / 2); g.computeVertexNormals(); return g; } // +x (the front) turns to -z
function carGeo(kind) {
  if (CARGEO.has(kind)) return CARGEO.get(kind); const S = CARS[kind] || CARS.car, L = S.L, W = S.W, half = L / 2, out = {};
  out.body = shapeBody(extrudeAcross(carProfile(S), W, 0.09), S);
  // the glass: the cabin's outline pushed a little outside the body, so it shows on the sides, windscreen and back window
  const gs = new THREE.Shape(), gp = S.glass.map(([x, y], i, A) => [x + (i === 0 ? -0.17 : i === A.length - 1 ? 0.17 : (i === 1 ? -0.12 : 0.12)), y]); /* clear of the body's rounded edge */ gs.moveTo(gp[0][0], gp[0][1]); for (const [x, y] of gp.slice(1)) gs.lineTo(x, y); gs.closePath();
  out.glass = shapeBody(extrudeAcross(gs, W + 0.03, 0.02), S);
  if (kind === 'getaway') { const st = extrudeAcross(carProfile(S), 0.2, 0.09, 0.082); const a = st.clone().translate(0.22, 0, 0), b = st.translate(-0.22, 0, 0); out.stripes = [a, b]; } // racing stripes, just proud of the paint
  // trim (dark, chrome and plastic parts, coloured per vertex) and lights, baked into one mesh each
  const T = new Bucket(), Lt = new Bucket(), dark = col('#16181b'), chrome = col('#c9ced4'), plate = col(kind === 'bus' ? '#f2c94c' : '#f4f4f0');
  const fz = -half, rz = half, lampY = S.lamp, tailY = S.tail; // the front is at -z
  T.box(-W * 0.47, fz - 0.06, W * 0.47, fz + 0.12, 0.28, 0.5, dark); T.box(-W * 0.47, rz - 0.12, W * 0.47, rz + 0.06, 0.28, 0.5, dark); // bumpers
  if (S.grille === 'chrome') { T.box(-W * 0.28, fz - 0.05, W * 0.28, fz + 0.04, lampY - 0.34, lampY + 0.04, chrome); for (let k = -4; k <= 4; k++) T.box(k * W * 0.06 - 0.012, fz - 0.06, k * W * 0.06 + 0.012, fz - 0.045, lampY - 0.32, lampY + 0.02, col('#1a1c20')); } /* a proud chrome grille */
  else if (S.grille !== 'none') T.box(-W * 0.24, fz - 0.03, W * 0.24, fz + 0.05, lampY - 0.2, lampY - 0.04, col('#0d0e10')); // the grille
  if (S.bed) { const bz0 = 0.62, bz1 = half - 0.05; T.box(-W * 0.46, bz0, W * 0.46, bz1, 1.16, 1.22, col('#22252a')); T.box(-W * 0.5, bz0, -W * 0.44, bz1, 1.16, 1.25, col('#1a1c20')); T.box(W * 0.44, bz0, W * 0.5, bz1, 1.16, 1.25, col('#1a1c20')); } /* the covered bed */
  if (S.rails) { const ry = Math.max(...S.top.map(p => p[1])); for (const sx of [-1, 1]) T.box(sx * W * 0.4 - 0.03, -0.3, sx * W * 0.4 + 0.03, half - 0.5, ry, ry + 0.06, S.led ? col('#2a2d33') : chrome); }
  if (S.spoiler === 'lip') { const y = topAt(S, -half + 0.25); T.box(-W * 0.44, half - 0.32, W * 0.44, half - 0.04, y, y + 0.05, dark); }
  if (S.spoiler === 'wing') { const y = topAt(S, -half + 0.3) + 0.32; T.box(-W * 0.47, half - 0.42, W * 0.47, half - 0.1, y, y + 0.04, col('#1b1d21')); for (const sx of [-1, 1]) { T.box(sx * W * 0.3 - 0.03, half - 0.3, sx * W * 0.3 + 0.03, half - 0.2, y - 0.32, y, col('#1b1d21')); T.box(sx * W * 0.47 - 0.02, half - 0.46, sx * W * 0.47 + 0.02, half - 0.06, y - 0.08, y + 0.1, col('#1b1d21')); } }
  if (S.fin) { const y = topAt(S, -half + 0.9); T.box(-0.025, half - 1.7, 0.025, half - 0.15, y - 0.05, y + 0.28, col('#14161a')); } /* a shark fin down the middle of the tail */
  if (S.intakes) for (const sx of [-1, 1]) T.box(sx * (W / 2 + 0.005) - 0.02, -(S.xr + 1.15), sx * (W / 2 + 0.005) + 0.02, -(S.xr + 0.5), 0.42, 0.74, col('#0e0f12')); /* air intakes ahead of the back wheels */
  if (S.diffuser) { T.box(-W * 0.42, rz - 0.08, W * 0.42, rz + 0.07, 0.1, 0.28, col('#111214')); for (let k = -3; k <= 3; k++) T.box(k * W * 0.1 - 0.012, rz - 0.06, k * W * 0.1 + 0.012, rz + 0.1, 0.08, 0.3, col('#1d1f23')); }
  if (S.chrome) for (const sx of [-1, 1]) T.box(sx * (W / 2 + 0.008) - 0.01, -half + 0.5, sx * (W / 2 + 0.008) + 0.01, half - 0.5, S.y0 + 0.2, S.y0 + 0.24, chrome); /* a chrome line along each side */
  T.box(-0.26, fz - 0.08, 0.26, fz - 0.05, 0.36, 0.48, plate); T.box(-0.26, rz + 0.05, 0.26, rz + 0.08, 0.38, 0.5, plate); // number plates
  T.box(-0.24, fz - 0.081, 0.24, fz - 0.079, 0.4, 0.44, col('#2b2b2b')); T.box(-0.24, rz + 0.079, 0.24, rz + 0.081, 0.42, 0.46, col('#2b2b2b'));
  if (kind !== 'bus') { const mz = kind === 'van' ? -(half - 0.9) : -(S.glass[S.glass.length - 1][0]) + 0.05; const my = kind === 'van' ? 1.02 : S.glass[0][1] - 0.03; for (const sx of [-1, 1]) { T.box(sx * (W / 2 - 0.04), mz - 0.08, sx * (W / 2 + 0.14), mz + 0.08, my, my + 0.12, dark); } /* the mirrors, on the waistline */
    if (S.pillar != null) for (const sx of [-1, 1]) { const px = sx * (W / 2 + 0.018); T.box(Math.min(px, sx * W / 2), -S.pillar - 0.05, Math.max(px, sx * W / 2), -S.pillar + 0.05, S.glass[0][1], S.glass[1][1], col('#0f1012')); // the B-pillar
      for (const z of [-S.pillar + 0.02, -S.pillar - 1.05, -S.pillar + 1.0]) T.box(sx * (W / 2 + 0.004) - 0.003, z - 0.006, sx * (W / 2 + 0.004) + 0.003, z + 0.006, S.y0 + 0.15, S.glass[0][1] - 0.02, col('#0a0a0a')); // door lines
      for (const z of [-S.pillar - 0.3, -S.pillar + 0.75]) T.box(sx * (W / 2 + 0.01) - 0.01, z - 0.1, sx * (W / 2 + 0.01) + 0.01, z + 0.1, 0.86, 0.9, chrome); } } // door handles
  if (kind === 'bus') for (let z = -half + 1.2; z < half - 0.6; z += 1.3) for (const sx of [-1, 1]) T.box(sx * (W / 2 + 0.01) - 0.01, z - 0.04, sx * (W / 2 + 0.01) + 0.01, z + 0.04, 1.45, 2.6, dark); // window frames
  const pipes = S.exhaust ?? 1, pr = pipes >= 2 ? 0.06 : 0.04; for (let k = 0; k < pipes; k++) { const px = pipes === 1 ? W * 0.3 : (k < pipes / 2 ? -1 : 1) * W * (0.28 + (k % 2) * 0.09); bake(T, GEO.cyl, { x: px, y: 0.3, z: rz + 0.05, sx: pr, sy: 0.14, sz: pr, color: chrome }); } // the exhaust (none on an electric car)
  if (S.led) { // a slim light bar right across the front and the back
    Lt.box(-W * 0.4, fz - 0.11, W * 0.4, fz - 0.08, lampY - 0.02, lampY + 0.02, col(S.led)); Lt.box(-W * 0.41, rz + 0.08, W * 0.41, rz + 0.11, tailY - 0.03, tailY + 0.03, col('#ff2238'));
    for (const sx of [-1, 1]) { Lt.box(sx * W * 0.33 - 0.15, fz - 0.105, sx * W * 0.33 + 0.15, fz - 0.075, lampY - 0.08, lampY - 0.035, col('#f6fbff')); Lt.box(sx * W * 0.36 - 0.12, rz + 0.075, sx * W * 0.36 + 0.12, rz + 0.105, tailY - 0.09, tailY - 0.035, col('#ff3a2a')); } }
  else for (const sx of [-1, 1]) { Lt.box(sx * W * 0.33 - 0.2, fz - 0.1, sx * W * 0.33 + 0.2, fz - 0.07, lampY - 0.07, lampY + 0.07, col('#fffbe8')); Lt.box(sx * W * 0.34 - 0.18, rz + 0.07, sx * W * 0.34 + 0.18, rz + 0.1, tailY - 0.07, tailY + 0.07, col('#ff2a1a'));
    Lt.box(sx * W * 0.45 - 0.05, fz - 0.05, sx * W * 0.45 + 0.05, fz - 0.03, lampY - 0.05, lampY + 0.03, col('#ffb02a')); } // headlights, tail lights, indicators
  if (S.glow) for (const sx of [-1, 1]) { Lt.box(sx * W * 0.42 - 0.03, -half + 0.7, sx * W * 0.42 + 0.03, half - 0.7, 0.1, 0.12, col(S.glow)); /* underglow */
    for (const z of [-S.xf, -S.xr]) bake(Lt, GEO.ring, { x: sx * (W / 2 + 0.04), y: S.r, z, ry: Math.PI / 2, sx: S.r * 0.78, sy: S.r * 0.78, sz: S.r * 0.78, color: col(S.glow) }); } /* glowing rims */
  out.trim = T.geometry(); out.lights = Lt.geometry();
  // a wheel: tyre, alloy rim with five spokes and a hub, all in one mesh (spinning it turns the spokes, so you see it roll)
  const Wb = new Bucket(), r = S.r, ws = S.wheel || 'alloy', CY = n => new THREE.CylinderGeometry(1, 1, 1, n);
  bake(Wb, CY(22), { sx: r, sy: 0.26, sz: r, color: col('#141414') }); // the tyre
  if (ws === 'steel') { bake(Wb, CY(16), { sx: r * 0.62, sy: 0.27, sz: r * 0.62, color: col('#6f747a') }); bake(Wb, CY(12), { sx: r * 0.3, sy: 0.285, sz: r * 0.3, color: col('#a7acb2') }); /* a plain steel wheel and a small hubcap */
    for (let k = 0; k < 6; k++) bake(Wb, CY(6), { x: Math.cos(k * 1.047) * r * 0.45, y: 0.002, z: Math.sin(k * 1.047) * r * 0.45, sx: 0.035, sy: 0.276, sz: 0.035, color: col('#3b3f44') }); }
  else if (ws === 'aero') { bake(Wb, CY(20), { sx: r * 0.7, sy: 0.275, sz: r * 0.7, color: col('#d5d9de') }); bake(Wb, CY(20), { sx: r * 0.5, sy: 0.28, sz: r * 0.5, color: col('#2b2f35') }); bake(Wb, CY(12), { sx: r * 0.14, sy: 0.29, sz: r * 0.14, color: col('#e8ebee') }); /* smooth covers that cut through the air */
    for (let k = 0; k < 3; k++) bake(Wb, GEO.box, { sx: 0.05, sy: 0.282, sz: r * 0.95, ry: k * Math.PI / 3, color: col('#aeb4ba') }); }
  else if (ws === 'turbine') { bake(Wb, CY(24), { sx: r * 0.78, sy: 0.27, sz: r * 0.78, color: col('#16181c') }); for (let k = 0; k < 9; k++) bake(Wb, GEO.box, { sx: 0.03, sy: 0.28, sz: r * 1.35, ry: k * Math.PI / 9 + 0.2, color: col('#4a4f57') }); bake(Wb, CY(12), { sx: r * 0.18, sy: 0.29, sz: r * 0.18, color: col('#c9b2ff') }); }
  else if (ws === 'sport') { bake(Wb, CY(22), { sx: r * 0.76, sy: 0.27, sz: r * 0.76, color: col('#c9ced4') }); bake(Wb, CY(18), { sx: r * 0.7, sy: 0.275, sz: r * 0.7, color: col('#26292e') }); /* a big rim with ten thin spokes */
    for (let k = 0; k < 10; k++) bake(Wb, GEO.box, { sx: 0.035, sy: 0.282, sz: r * 1.36, ry: k * Math.PI / 10, color: col('#9aa0a7') }); bake(Wb, CY(10), { sx: r * 0.15, sy: 0.29, sz: r * 0.15, color: col('#e3e6ea') }); }
  else { bake(Wb, CY(16), { sx: r * 0.64, sy: 0.27, sz: r * 0.64, color: col('#9aa1a8') }); bake(Wb, CY(12), { sx: r * 0.5, sy: 0.275, sz: r * 0.5, color: col('#3a3e44') });
    for (let k = 0; k < 5; k++) bake(Wb, GEO.box, { y: 0, sx: 0.07, sy: 0.28, sz: r * 1.0, ry: k * Math.PI * 2 / 5, color: col('#c9ced4') }); bake(Wb, CY(10), { sx: r * 0.16, sy: 0.29, sz: r * 0.16, color: col('#dfe3e8') }); }
  const wg = Wb.geometry(); wg.rotateZ(Math.PI / 2); out.wheel = wg;
  CARGEO.set(kind, out); return out;
}
// ---------------- two wheels, boats and aircraft ----------------
// Bicycles and motorbikes on the roads, boats on the water and aircraft in the sky, built like the cars: a few simple
// shapes merged into one mesh, so many of them draw in one go (see town3d.js). paint: the body colour (white for the
// shared version, which takes each one's own colour from its instance colour). An aircraft's height is built in.
const bk = (B, geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color }) => {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal, m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), base = B.p.length / 3;
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m); B.p.push(v.x, v.y, v.z); v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); B.n.push(v.x, v.y, v.z); B.u.push(0, 0); B.c.push(color.r, color.g, color.b); B.i.push(base + i); } };
const VG = { cyl: new THREE.CylinderGeometry(1, 1, 1, 12), tor: new THREE.TorusGeometry(1, 0.1, 6, 20), ball: new THREE.SphereGeometry(1, 16, 10), box: GEO.box, cone: new THREE.ConeGeometry(1, 1, 12) };
// a rod from one point to another
const rod = (B, a, b, r, color) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), e = new THREE.Euler().setFromQuaternion(q);
  bk(B, VG.cyl, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, rx: e.x, ry: e.y, rz: e.z, sx: r, sy: L, sz: r, color }); };
// a hull seen from above (pointed at the front, -z), stood up `h` high from `y0`
const hullGeo = (L, W, h, bow = 0.3) => { const s = new THREE.Shape(); s.moveTo(-W / 2, -L / 2); s.lineTo(W / 2, -L / 2); s.lineTo(W / 2, L / 2 - L * bow); s.quadraticCurveTo(W / 2, L / 2, 0, L / 2); s.quadraticCurveTo(-W / 2, L / 2, -W / 2, L / 2 - L * bow); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 }); g.rotateX(Math.PI / 2); /* depth goes down, the bow to -z */ g.translate(0, h, 0); return g; };
// A boat's hull from cross-sections along its length, stern (+z) to a pointed bow (-z): the deck edge rises towards
// the bow (sheer), the sides come down to a V at the keel, and it narrows to the stem. The parts come apart so each can
// have its colour: topsides, the boot stripe at the waterline, the bottom, the deck, the transom and a rail on top.
function hullParts(L, W, D, o = {}) {
  const N = 18, sheer = o.sheer ?? D * 0.35, stern = o.stern ?? 0.9, rise = o.rise ?? 0.3, top = o.top ?? 0.5, st = [];
  for (let i = 0; i <= N; i++) { const t = i / N, z = L / 2 - t * L, hw = W / 2 * (t < 0.5 ? stern + (1 - stern) * Math.sin(t / 0.5 * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - ((t - 0.5) / 0.5) ** 2))), k = D * (1 - rise * t * t), s = top * D * 0.0 + sheer * t * t;
    st.push({ z, hw, s, ring: [[hw, s + top * D * 0.45], [hw * 0.995, 0.06 * D], [hw * 0.97, -0.08 * D], [hw * 0.82, -0.42 * k], [hw * 0.45, -0.82 * k], [0, -k]] }); }
  const geo = (P, I) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g; };
  const band = (a, b) => { const P = [], I = [], R = b - a + 1, off = st.length * R;
    for (const sd of [1, -1]) for (const S of st) for (let j = a; j <= b; j++) P.push(sd * S.ring[j][0], S.ring[j][1], S.z);
    for (let sd = 0; sd < 2; sd++) for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < R - 1; j++) { const A = sd * off + i * R + j, Bq = A + R, C = Bq + 1, Dq = A + 1; if (sd === 0) I.push(A, C, Bq, A, Dq, C); else I.push(A, Bq, C, A, C, Dq); }
    return geo(P, I); };
  const dk = (() => { const P = [], I = []; for (const S of st) { const y = S.ring[0][1] - 0.06 * D, w = S.hw * 0.94; P.push(w, y, S.z, -w, y, S.z); } for (let i = 0; i < st.length - 1; i++) { const a = i * 2; I.push(a, a + 2, a + 3, a, a + 3, a + 1); } return geo(P, I); })();
  const tr = (() => { const S = st[0], ring = [...S.ring, ...S.ring.slice(0, -1).reverse().map(([x, y]) => [-x, y])], cy = (S.ring[0][1] + S.ring[5][1]) / 2, P = [0, cy, S.z], I = [];
    for (const [x, y] of ring) P.push(x, y, S.z); for (let i = 1; i < ring.length; i++) I.push(0, i + 1, i); I.push(0, 1, ring.length); return geo(P, I); })(); /* (the flat stern, closed across the top) */
  const rl = (() => { const P = [], I = [], th = 0.05 * D + 0.04; for (const sd of [1, -1]) for (const S of st) { const x = sd * S.hw, y = S.ring[0][1]; P.push(x, y, S.z, x - sd * 0.08, y + th, S.z, x - sd * 0.16, y, S.z); }
    for (let sd = 0; sd < 2; sd++) for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < 2; j++) { const A = (sd * st.length + i) * 3 + j, Bq = A + 3; if (sd === 0) I.push(A, Bq, Bq + 1, A, Bq + 1, A + 1); else I.push(A, Bq + 1, Bq, A, A + 1, Bq + 1); } return geo(P, I); })();
  return { top: band(0, 1), stripe: band(1, 2), bottom: band(2, 5), deck: dk, transom: tr, rail: rl }; }
const triGeo = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false }); };
const ALT = { helicopter: 46, plane: 85, balloon: 62 }; /* metres up */
// a rider for the shared bikes (other people out on two wheels)
function riderInto(B, seatY, seatZ, barY, barZ, col0) { const jacket = col(col0 || '#2F4A7A'), skin = col('#B07A52'), jeans = col('#2B3550');
  bk(B, VG.ball, { y: seatY + 0.33, z: seatZ - 0.12, sx: 0.2, sy: 0.32, sz: 0.15, color: jacket }); bk(B, VG.ball, { y: seatY + 0.78, z: seatZ - 0.24, sx: 0.12, sy: 0.14, sz: 0.13, color: skin });
  bk(B, VG.ball, { y: seatY + 0.86, z: seatZ - 0.24, sx: 0.13, sy: 0.09, sz: 0.14, color: col('#1d1b19') });
  for (const s of [-1, 1]) { rod(B, [s * 0.18, seatY + 0.5, seatZ - 0.18], [s * 0.24, barY, barZ], 0.05, jacket); rod(B, [s * 0.1, seatY + 0.05, seatZ], [s * 0.13, seatY - 0.15, seatZ - 0.42], 0.065, jeans); rod(B, [s * 0.13, seatY - 0.15, seatZ - 0.42], [s * 0.15, 0.2, seatZ - 0.3], 0.055, jeans); } }
// a passenger behind the rider (a bike carrying someone): seated a little higher on the back, hands at the rider's waist
function pillionInto(B, seatY, seatZ, col0) { const top = col(col0 || '#8E44AD'), skin = col('#C68B59'), legs = col('#3a3530');
  bk(B, VG.ball, { y: seatY + 0.33, z: seatZ + 0.02, sx: 0.19, sy: 0.3, sz: 0.15, color: top }); bk(B, VG.ball, { y: seatY + 0.76, z: seatZ - 0.06, sx: 0.115, sy: 0.135, sz: 0.125, color: skin });
  bk(B, VG.ball, { y: seatY + 0.84, z: seatZ - 0.04, sx: 0.125, sy: 0.09, sz: 0.135, color: col('#3b2a20') });
  for (const s of [-1, 1]) { rod(B, [s * 0.17, seatY + 0.48, seatZ - 0.02], [s * 0.15, seatY + 0.3, seatZ - 0.36], 0.045, top); rod(B, [s * 0.1, seatY + 0.05, seatZ], [s * 0.15, seatY - 0.12, seatZ - 0.36], 0.06, legs); rod(B, [s * 0.15, seatY - 0.12, seatZ - 0.36], [s * 0.2, 0.3, seatZ - 0.2], 0.05, legs); } }
const VEH = {
  bicycle: { L: 1.75, W: 0.6, road: true, build(B, P, rider, two) { const dark = col('#1d1b19'), grey = col('#9aa1a8'), r = 0.34;
    for (const z of [-0.55, 0.55]) { bk(B, VG.tor, { y: r, z, ry: Math.PI / 2, sx: r, sy: r, sz: 0.5, color: dark }); bk(B, VG.cyl, { y: r, z, rz: Math.PI / 2, sx: 0.04, sy: 0.08, sz: 0.04, color: grey }); for (let k = 0; k < 4; k++) bk(B, VG.box, { y: r, z, rx: k * Math.PI / 4, sx: 0.01, sy: r * 1.9, sz: 0.01, color: grey }); }
    const bb = [0, 0.32, 0.05], seat = [0, 0.82, 0.3], head = [0, 0.86, -0.42]; rod(B, bb, seat, 0.025, P); rod(B, seat, head, 0.025, P); rod(B, bb, head, 0.028, P); rod(B, bb, [0, r, 0.55], 0.02, P); rod(B, seat, [0, r, 0.55], 0.02, P); rod(B, head, [0, r, -0.55], 0.022, P);
    bk(B, VG.box, { y: 0.88, z: 0.32, sx: 0.12, sy: 0.05, sz: 0.24, color: dark }); rod(B, head, [0, 1.0, -0.45], 0.02, grey); rod(B, [-0.27, 1.0, -0.45], [0.27, 1.0, -0.45], 0.018, dark);
    if (two) { bk(B, VG.box, { y: 0.78, z: 0.66, sx: 0.2, sy: 0.04, sz: 0.3, color: dark }); pillionInto(B, 0.8, 0.68); } /* (a rack over the back wheel) */
    if (rider) riderInto(B, 0.9, 0.3, 1.0, -0.45); } },
  motorbike: { L: 2.1, W: 0.8, road: true, build(B, P, rider, two) { const dark = col('#151515'), grey = col('#8b9198'), chrome = col('#d5d9de'), r = 0.32;
    for (const z of [-0.72, 0.68]) { bk(B, VG.tor, { y: r, z, ry: Math.PI / 2, sx: r, sy: r, sz: 1.0, color: dark }); bk(B, VG.cyl, { y: r, z, rz: Math.PI / 2, sx: 0.17, sy: 0.1, sz: 0.17, color: grey }); }
    bk(B, VG.ball, { y: 0.88, z: -0.18, sx: 0.2, sy: 0.15, sz: 0.36, color: P }); /* the tank */ bk(B, VG.box, { y: 0.86, z: 0.33, sx: 0.28, sy: 0.08, sz: 0.55, color: dark }); /* the seat */
    bk(B, VG.box, { y: 0.52, z: 0.0, sx: 0.32, sy: 0.32, sz: 0.5, color: grey }); /* the engine */ bk(B, VG.box, { y: 0.66, z: 0.62, sx: 0.24, sy: 0.12, sz: 0.36, color: P }); /* the tail */
    rod(B, [0.16, 0.4, 0.1], [0.2, 0.42, 0.85], 0.045, chrome); rod(B, [0, 0.95, -0.42], [0, r, -0.72], 0.04, chrome); rod(B, [-0.36, 1.08, -0.44], [0.36, 1.08, -0.44], 0.022, dark); rod(B, [0, 0.95, -0.42], [0, 1.08, -0.44], 0.03, dark);
    bk(B, VG.ball, { y: 0.98, z: -0.6, sx: 0.09, sy: 0.08, sz: 0.06, color: col('#fffbe8') }); bk(B, VG.box, { y: 0.98, z: -0.48, sx: 0.3, sy: 0.12, sz: 0.04, color: P });
    if (two) pillionInto(B, 0.96, 0.66); if (rider) riderInto(B, 0.92, 0.32, 1.08, -0.44, '#1d1b19'); } },
  // the speedboat: a deep-V hull with a pointed, rising bow, a navy boot stripe and an antifouled bottom, a teak deck,
  // a wrap-round windscreen over the helm, padded seats, a sun lounger on the bow, a rail and a big outboard
  boat: { L: 7, W: 2.5, water: true, build(B, P) { const teak = col('#B07A45'), navy = col('#1F3A5F'), red = col('#7A2A26'), white = col('#F4F4F0'), cream = col('#EDE3CF'), chrome = col('#D5D9DE'), glass = col('#1c2a36'); void glass;
    const H = hullParts(7, 2.5, 0.95, { sheer: 0.42, stern: 0.88, rise: 0.35, top: 0.55 }); bk(B, H.top, { color: P }); bk(B, H.stripe, { color: navy }); bk(B, H.bottom, { color: red }); bk(B, H.deck, { color: teak }); bk(B, H.transom, { color: P }); bk(B, H.rail, { color: white });
    bk(B, VG.box, { y: 0.78, z: 0.15, sx: 1.6, sy: 0.5, sz: 1.2, color: white }); /* the console */ bk(B, VG.ball, { y: 1.02, z: -0.05, sx: 0.85, sy: 0.12, sz: 0.62, color: white });
    bk(B, new THREE.CylinderGeometry(1, 1.08, 1, 18, 1, true, Math.PI - 0.95, 1.9), { y: 1.22, z: 0.2, sx: 0.82, sy: 0.36, sz: 0.68, color: col('#8FB4C9') }); bk(B, new THREE.TorusGeometry(1, 0.03, 4, 18, 1.9), { y: 1.4, z: 0.2, rx: Math.PI / 2, rz: Math.PI / 2 + 0.95 - 1.9 + Math.PI / 2, sx: 0.82, sy: 0.68, sz: 1, color: chrome }); /* the wrap-round windscreen and its chrome frame */
    bk(B, VG.cyl, { x: 0.32, y: 1.12, z: 0.42, rx: -0.9, sx: 0.16, sy: 0.04, sz: 0.16, color: col('#2b2b2b') }); /* the wheel */
    for (const x of [-0.42, 0.42]) { bk(B, VG.box, { x, y: 0.82, z: 1.05, sx: 0.62, sy: 0.22, sz: 0.62, color: cream }); bk(B, VG.box, { x, y: 1.18, z: 1.36, rx: 0.2, sx: 0.62, sy: 0.55, sz: 0.14, color: cream }); }
    bk(B, VG.box, { y: 0.78, z: 2.45, sx: 1.9, sy: 0.24, sz: 0.85, color: cream }); bk(B, VG.box, { y: 1.04, z: 2.85, sx: 1.9, sy: 0.4, sz: 0.14, color: cream }); /* the stern bench */
    bk(B, VG.box, { y: 0.74, z: -1.7, rx: 0.08, sx: 1.4, sy: 0.12, sz: 1.3, color: cream }); /* a sun pad on the bow */
    bk(B, VG.box, { y: 0.35, z: 3.62, sx: 0.14, sy: 0.7, sz: 0.22, color: col('#262626') }); bk(B, VG.box, { y: 0.92, z: 3.66, sx: 0.46, sy: 0.5, sz: 0.62, color: col('#262626') }); bk(B, VG.box, { y: 1.18, z: 3.66, sx: 0.4, sy: 0.08, sz: 0.56, color: col('#3a3a3a') }); bk(B, VG.box, { y: 0.92, z: 3.36, sx: 0.47, sy: 0.08, sz: 0.04, color: chrome }); /* the outboard: its leg and cowling */
    for (const sd of [-1, 1]) { rod(B, [sd * 0.98, 0.95, -0.6], [sd * 0.5, 1.12, -2.6], 0.025, chrome); rod(B, [sd * 0.5, 1.12, -2.6], [0, 1.12, -3.05], 0.025, chrome); for (const z of [-0.6, -1.6]) rod(B, [sd * (z < -1 ? 0.78 : 0.98), 0.62, z], [sd * (z < -1 ? 0.76 : 0.98), 0.98 + (z < -1 ? 0.08 : 0), z], 0.02, chrome); }
    bk(B, VG.cyl, { y: 1.55, z: 2.95, sx: 0.025, sy: 1.1, sz: 0.025, color: chrome }); bk(B, VG.box, { y: 1.95, z: 2.95, sx: 0.02, sy: 0.24, sz: 0.36, color: navy }); } },
  // the sailing yacht: a slim hull with a fin keel, a cabin top with portholes, the cockpit, a tall mast with its boom,
  // the mainsail and the jib, the stays, and rails round the deck
  sailboat: { L: 8, W: 2.4, water: true, build(B, P) { const teak = col('#B07A45'), white = col('#F4F4F0'), navy = col('#1F3A5F'), sail = col('#F8F6EE'), chrome = col('#D5D9DE'), dark = col('#1c2a36');
    const H = hullParts(8, 2.4, 1.0, { sheer: 0.34, stern: 0.78, rise: 0.25, top: 0.5 }); bk(B, H.top, { color: P }); bk(B, H.stripe, { color: navy }); bk(B, H.bottom, { color: navy }); bk(B, H.deck, { color: teak }); bk(B, H.transom, { color: P }); bk(B, H.rail, { color: white });
    bk(B, VG.box, { y: -1.1, z: 0.2, sx: 0.16, sy: 1.1, sz: 1.3, color: navy }); /* the keel */
    bk(B, VG.box, { y: 0.82, z: -0.2, sx: 1.5, sy: 0.42, sz: 2.6, color: white }); bk(B, VG.box, { y: 1.05, z: -0.2, sx: 1.35, sy: 0.08, sz: 2.4, color: white }); /* the cabin top */
    for (const sd of [-1, 1]) for (const z of [-1.0, -0.2, 0.6]) bk(B, VG.ball, { x: sd * 0.76, y: 0.85, z, sx: 0.02, sy: 0.08, sz: 0.11, color: dark }); /* portholes */
    bk(B, VG.box, { y: 0.72, z: 1.9, sx: 1.6, sy: 0.08, sz: 1.6, color: teak }); for (const sd of [-1, 1]) bk(B, VG.box, { x: sd * 0.72, y: 0.86, z: 1.9, sx: 0.32, sy: 0.22, sz: 1.5, color: white }); /* the cockpit */
    bk(B, VG.tor, { y: 1.15, z: 2.5, rx: -0.5, sx: 0.32, sy: 0.32, sz: 0.4, color: chrome }); /* the wheel */
    bk(B, VG.cyl, { y: 5.6, z: -0.6, sx: 0.08, sy: 10, sz: 0.08, color: chrome }); rod(B, [0, 1.6, -0.6], [0, 1.65, 3.0], 0.06, chrome); /* the mast and boom */
    rod(B, [0, 10.4, -0.6], [0, 0.95, -3.8], 0.012, chrome); rod(B, [0, 10.4, -0.6], [0, 0.95, 3.6], 0.012, chrome); for (const sd of [-1, 1]) rod(B, [0, 10.4, -0.6], [sd * 1.05, 0.85, -0.4], 0.01, chrome); /* the stays */
    bk(B, triGeo([[0, 0], [0, 8.6], [3.5, 0]]), { x: 0.02, y: 1.72, z: -0.55, ry: -Math.PI / 2, color: sail }); bk(B, VG.box, { y: 1.68, z: 1.2, sx: 0.18, sy: 0.18, sz: 3.4, color: navy }); /* the mainsail, and its cover on the boom */
    bk(B, triGeo([[0, 0], [0, 8.4], [-3.0, 0]]), { x: 0.02, y: 1.05, z: -0.75, ry: -Math.PI / 2, color: sail }); } },
  // the passenger ferry: a long hull with a flared bow, two decks of windows wrapping round, the bridge with its wings,
  // lifeboats, a funnel in the line's colours, railings and a mast
  ferry: { L: 30, W: 9, water: true, build(B, P) { const white = col('#F4F4F0'), dark = col('#1c2a36'), navy = col('#1F3A5F'), red = col('#8C2F2A'), orange = col('#E8812E'), grey = col('#9aa1a8');
    const H = hullParts(30, 9, 3.4, { sheer: 1.4, stern: 0.92, rise: 0.2, top: 0.6 }); bk(B, H.top, { color: navy }); bk(B, H.stripe, { color: P }); bk(B, H.bottom, { color: red }); bk(B, H.deck, { color: col('#C9C3B6') }); bk(B, H.transom, { color: navy }); bk(B, H.rail, { color: white });
    for (const [y, L, W, z] of [[0.1, 21, 8.0, 2.2], [2.7, 16, 7.2, 3.0]]) { bk(B, VG.box, { y: y + 1.25, z, sx: W, sy: 2.5, sz: L, color: white }); bk(B, VG.box, { y: y + 1.55, z, sx: W + 0.06, sy: 0.85, sz: L - 1.4, color: dark }); bk(B, VG.box, { y: y + 2.55, z, sx: W + 0.4, sy: 0.12, sz: L + 0.4, color: white });
      bk(B, VG.cyl, { y: y + 1.25, z: z - L / 2, sx: W / 2, sy: 2.5, sz: 1.6, color: white }); bk(B, VG.cyl, { y: y + 1.55, z: z - L / 2, sx: W / 2 + 0.03, sy: 0.85, sz: 1.63, color: dark }); } /* rounded fronts */
    bk(B, VG.box, { y: 6.4, z: -3.2, sx: 9.4, sy: 1.6, sz: 2.6, color: white }); bk(B, VG.box, { y: 6.55, z: -4.52, sx: 9.0, sy: 0.7, sz: 0.06, color: dark }); /* the bridge and its windows */
    bk(B, VG.cyl, { y: 8.6, z: 7.5, sx: 1.4, sy: 3.4, sz: 1.9, color: white }); bk(B, VG.cyl, { y: 9.6, z: 7.5, sx: 1.42, sy: 0.9, sz: 1.92, color: P }); bk(B, VG.cyl, { y: 10.45, z: 7.5, sx: 1.42, sy: 0.25, sz: 1.92, color: dark }); /* the funnel */
    for (const sd of [-1, 1]) for (const z of [-2, 3, 8]) { bk(B, VG.ball, { x: sd * 4.15, y: 5.3, z, sx: 0.55, sy: 0.45, sz: 1.7, color: orange }); rod(B, [sd * 3.7, 5.0, z - 1.2], [sd * 4.2, 5.9, z - 1.2], 0.05, grey); rod(B, [sd * 3.7, 5.0, z + 1.2], [sd * 4.2, 5.9, z + 1.2], 0.05, grey); } /* lifeboats on their davits */
    rod(B, [0, 7.2, -3.6], [0, 11.5, -3.6], 0.12, grey); rod(B, [-1.2, 10.6, -3.6], [1.2, 10.6, -3.6], 0.06, grey); /* the mast */ } },
  // the cargo ship: a long red-bottomed hull with its anchor and bulbous bow, rows of stacked containers, the white
  // accommodation block aft with its bridge windows and wings, the funnel, and cranes between the holds
  cargoship: { L: 46, W: 11, water: true, build(B, P) { const white = col('#F4F4F0'), dark = col('#1c2a36'), grey = col('#7C8288'), C = ['#C8382E', '#2F4A7A', '#E2A23B', '#3E7A4B', '#7C8288', '#8C2F2A'];
    const H = hullParts(46, 11, 4.4, { sheer: 1.6, stern: 0.95, rise: 0.1, top: 0.62 }); bk(B, H.top, { color: P }); bk(B, H.stripe, { color: white }); bk(B, H.bottom, { color: col('#8C2F2A') }); bk(B, H.deck, { color: col('#6E6A62') }); bk(B, H.transom, { color: P }); bk(B, H.rail, { color: P });
    bk(B, VG.ball, { y: -3.2, z: -22.6, sx: 1.3, sy: 1.2, sz: 2.2, color: col('#8C2F2A') }); /* the bulbous bow */
    for (const sd of [-1, 1]) bk(B, VG.box, { x: sd * 3.0, y: 0.6, z: -19.5, sx: 0.08, sy: 0.9, sz: 0.6, color: dark }); /* the anchors */
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 2 + ((i + j) % 2); k++) bk(B, VG.box, { x: (j - 1) * 3.2, y: 1.85 + k * 2.6, z: -15 + i * 4.6, sx: 3.0, sy: 2.5, sz: 4.4, color: col(C[(i * 3 + j + k * 2) % 6]) });
    for (const z of [-17.4, -8.2, 1.0]) { rod(B, [4.2, 0.6, z], [4.2, 9.5, z], 0.25, col('#E2A23B')); rod(B, [4.2, 9.2, z], [-2.5, 7.0, z + 1.5], 0.16, col('#E2A23B')); } /* cranes */
    bk(B, VG.box, { y: 5.0, z: 16.5, sx: 9.6, sy: 9.0, sz: 6.0, color: white }); for (const y of [2.4, 4.6, 6.8]) bk(B, VG.box, { y, z: 13.47, sx: 9.0, sy: 0.6, sz: 0.06, color: dark });
    bk(B, VG.box, { y: 9.9, z: 15.2, sx: 13.5, sy: 1.5, sz: 3.2, color: white }); bk(B, VG.box, { y: 10.0, z: 13.57, sx: 13.0, sy: 0.7, sz: 0.06, color: dark }); /* the bridge, its windows and wings */
    bk(B, VG.box, { y: 12.4, z: 18.4, sx: 2.4, sy: 3.6, sz: 2.8, color: P }); bk(B, VG.box, { y: 14.1, z: 18.4, sx: 2.42, sy: 0.3, sz: 2.82, color: dark }); rod(B, [0, 10.7, 15.2], [0, 14.5, 15.2], 0.1, grey); } },
  helicopter: { L: 11, W: 3, air: true, build(B, P) { const y = ALT.helicopter, dark = col('#1c2a36'), grey = col('#5c6168');
    bk(B, VG.ball, { y, z: -0.4, sx: 1.3, sy: 1.2, sz: 2.4, color: P }); bk(B, VG.ball, { y: y + 0.25, z: -1.6, sx: 1.05, sy: 0.85, sz: 1.2, color: dark }); rod(B, [0, y + 0.3, 1.5], [0, y + 0.7, 6.2], 0.28, P);
    bk(B, VG.box, { y: y + 1.3, z: 6.2, sx: 0.1, sy: 1.6, sz: 0.9, color: P }); bk(B, VG.cyl, { y: y + 1.4, z: -0.3, sx: 0.12, sy: 0.6, sz: 0.12, color: grey });
    for (const a of [0.3, 0.3 + Math.PI / 2]) bk(B, VG.box, { y: y + 1.72, z: -0.3, ry: a, sx: 0.35, sy: 0.04, sz: 10.5, color: grey });
    for (const s of [-1, 1]) { rod(B, [s * 1.0, y - 1.7, -2.2], [s * 1.0, y - 1.7, 1.6], 0.07, grey); rod(B, [s * 0.7, y - 0.9, -1.2], [s * 1.0, y - 1.7, -1.2], 0.05, grey); rod(B, [s * 0.7, y - 0.9, 0.6], [s * 1.0, y - 1.7, 0.6], 0.05, grey); } } },
  plane: { L: 20, W: 22, air: true, build(B, P) { const y = ALT.plane, dark = col('#1c2a36'), grey = col('#aeb4ba'), stripe = col('#2F4A7A');
    bk(B, VG.cyl, { y, rx: Math.PI / 2, sx: 1.4, sy: 16, sz: 1.4, color: P }); bk(B, VG.ball, { y, z: -8, sx: 1.4, sy: 1.4, sz: 2.6, color: P }); bk(B, VG.cone, { y, z: 9.5, rx: Math.PI / 2, sx: 1.4, sy: 3.2, sz: 1.4, color: P });
    bk(B, VG.box, { y: y - 0.5, z: -0.5, sx: 22, sy: 0.3, sz: 3.2, color: P }); bk(B, VG.box, { y: y + 0.1, z: 9.6, sx: 7, sy: 0.22, sz: 1.8, color: P }); bk(B, VG.box, { y: y + 2.2, z: 9.8, sx: 0.25, sy: 3.8, sz: 2.4, color: stripe });
    bk(B, VG.box, { y: y + 0.55, z: -1, sx: 2.85, sy: 0.35, sz: 13, color: stripe }); bk(B, VG.box, { y: y + 0.55, z: -8.6, sx: 2.2, sy: 0.4, sz: 0.9, color: dark });
    for (const s of [-1, 1]) bk(B, VG.cyl, { x: s * 4.5, y: y - 1.1, z: -0.8, rx: Math.PI / 2, sx: 0.55, sy: 2.6, sz: 0.55, color: grey }); } },
  balloon: { L: 12, W: 12, air: true, build(B, P) { const y = ALT.balloon, cane = col('#8C6A3F');
    for (let k = 0; k < 8; k++) bk(B, new THREE.SphereGeometry(1, 4, 14, k * Math.PI / 4, Math.PI / 4), { y: y + 7, sx: 6, sy: 7, sz: 6, color: k % 2 ? P : col('#F2C94C') });
    bk(B, VG.cone, { y: y + 1.1, rx: Math.PI, sx: 3, sy: 2.6, sz: 3, color: P }); bk(B, VG.box, { y: y - 2.6, sx: 1.4, sy: 1.0, sz: 1.4, color: cane });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rod(B, [a * 0.65, y - 2.1, b * 0.65], [a * 2.2, y + 0.4, b * 2.2], 0.03, col('#3b3b3b')); } },
};
export const isVeh = kind => !!VEH[kind];
export const vehOn = kind => VEH[kind] ? (VEH[kind].water ? 'water' : VEH[kind].air ? 'air' : 'road') : 'road';
const VLITE = new Map();
function vehLite(kind) { let o = VLITE.get(kind); if (o) return o; const V = VEH[vbase(kind)], B = new Bucket(); V.build(B, col('#ffffff'), !kind.endsWith('!'), kind.endsWith('+')); /* 'bicycle!': a bike nobody's on */ const g = B.geometry();
  o = { geo: g, L: V.L, W: V.W, paint: [0.4, 0.3, 1.0], noBlob: !V.road }; VLITE.set(kind, o); return o; }
// your own: in its colour, with the wheels apart (to spin them) for a bike
export function pillionMesh(kind) { const V = VEH[vbase(kind)]; if (!V) return null; const B = new Bucket(); if (vbase(kind) === 'bicycle') pillionInto(B, 0.8, 0.68); else pillionInto(B, 0.96, 0.66);
  return new THREE.Mesh(B.geometry(), carMat('veh', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.3 }))); }
function vehModel(kind, color) { const V = VEH[kind], B = new Bucket(); V.build(B, col(color), false); const g = new THREE.Group();
  g.add(new THREE.Mesh(B.geometry(), carMat('veh', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.3 }))));
  g.userData.wheels = []; g.userData.len = V.L; g.userData.veh = kind; return g; }
// A car you'd recognise. kind: car, van, bus, police, getaway. userData: wheels (spin them on x), len, and for the police
// the light bar's red and blue lamps (bar[0], bar[1]: set their material's colour to flash them).
export function makeCar(kind = 'car', color = '#c8382e') {
  if (VEH[kind]) return vehModel(kind, color);
  const S = CARS[kind] || CARS.car, G = carGeo(kind), g = new THREE.Group(), paintC = kind === 'police' ? '#f4f4f0' : color;
  const P = S.paint || [0.26, 0.55, 1.3], paint = carMat('paint' + paintC + P.join(','), () => new THREE.MeshStandardMaterial({ color: paintC, roughness: P[0], metalness: P[1], envMapIntensity: P[2] }));
  const glass = carMat('glass', () => new THREE.MeshStandardMaterial({ color: '#16222b', roughness: 0.04, metalness: 0.9, envMapIntensity: 1.6 })), trim = carMat('trim', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 }));
  const lights = carMat('lights', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })), wheelM = carMat('wheel', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }));
  g.add(new THREE.Mesh(G.body, paint), new THREE.Mesh(G.glass, glass), new THREE.Mesh(G.trim, trim), new THREE.Mesh(G.lights, lights));
  if (G.stripes) { const wm = carMat('paint#f4f4f0', () => new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.26, metalness: 0.55 })); for (const st of G.stripes) g.add(new THREE.Mesh(st, wm)); }
  const wheels = []; for (const [x, z] of [[-1, -S.xf], [1, -S.xf], [-1, -S.xr], [1, -S.xr]]) { const w = new THREE.Mesh(G.wheel, wheelM); w.position.set(x * (S.W / 2 - 0.1), S.r, z); g.add(w); wheels.push(w); }
  if (kind === 'police') { // the livery: a blue band and POLICE on both sides, a dark bonnet stripe, and the light bar
    const band = carMat('policeband', () => new THREE.MeshStandardMaterial({ color: '#1f3f9a', roughness: 0.35, metalness: 0.3 })), word = carMat('policeword', () => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#1f3f9a'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#fff'; x.font = '900 40px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('POLICE', 128, 34); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }); });
    for (const sx of [-1, 1]) { const b0 = new THREE.Mesh(GEO.box, band); b0.scale.set(0.02, 0.16, S.L * 0.86); b0.position.set(sx * (S.W / 2 + 0.005), 0.66, 0); g.add(b0);
      const wd = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), word); wd.position.set(sx * (S.W / 2 + 0.02), 0.78, 0.15); wd.rotation.y = sx * Math.PI / 2; g.add(wd); }
    const base = new THREE.Mesh(GEO.box, pmat('#1b1c1e')); base.scale.set(1.2, 0.08, 0.32); base.position.set(0, 1.5, -0.05); g.add(base);
    const red = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false })), blue = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#2a5bff', toneMapped: false }));
    red.scale.set(0.55, 0.12, 0.26); red.position.set(-0.3, 1.58, -0.05); blue.scale.set(0.55, 0.12, 0.26); blue.position.set(0.3, 1.58, -0.05); g.add(red, blue); g.userData.bar = [red, blue]; }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(S.W * 1.25, S.L * 1.08), carMat('blob', () => new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.4, depthWrite: false }))); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob);
  g.userData.wheels = wheels; g.userData.len = S.L; return g;
}
// The same car as one merged shape for the traffic and other people's cars (one draw for many of them: see town3d.js).
// The paint is white in it, so each car's own colour comes from its instance colour; glass, tyres and trim stay dark.
const LITE = new Map();
export function carLite(kind = 'car') {
  if (VEH[vbase(kind)]) return vehLite(kind);
  if (LITE.has(kind)) return LITE.get(kind); const S = CARS[kind] || CARS.car, G = carGeo(kind), P = [], N = [], C = [];
  // lighter than the car you drive: fewer curves on the body, and plain wheels (tyre and rim) without spokes
  const body = shapeBody(extrudeAcross(carProfile(S), S.W, 0.08, 0.064, 1), S), wb = new Bucket(), CY = n => new THREE.CylinderGeometry(1, 1, 1, n);
  bake(wb, CY(10), { sx: S.r, sy: 0.26, sz: S.r, color: col('#141414') }); bake(wb, CY(10), { sx: S.r * 0.66, sy: 0.27, sz: S.r * 0.66, color: col(S.wheel === 'steel' ? '#6f747a' : S.wheel === 'aero' ? '#d5d9de' : S.wheel === 'turbine' ? '#c9b2ff' : '#b4bac1') });
  const wheel = wb.geometry(); wheel.rotateZ(Math.PI / 2);
  const add = (geo, color, m) => { const g = (geo.index ? geo.toNonIndexed() : geo.clone()); if (m) g.applyMatrix4(m); const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); if (color) C.push(color.r, color.g, color.b); else C.push(c.getX(i), c.getY(i), c.getZ(i)); } g.dispose(); };
  add(body, col('#ffffff')); add(G.glass, col('#0d1116')); add(G.trim); add(G.lights);
  for (const [x, z] of [[-1, -S.xf], [1, -S.xf], [-1, -S.xr], [1, -S.xr]]) add(wheel, null, new THREE.Matrix4().makeTranslation(x * (S.W / 2 - 0.1), S.r, z)); body.dispose(); wheel.dispose();
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere();
  const out = { geo: g, L: S.L, W: S.W, paint: S.paint || [0.3, 0.5, 1.2] }; LITE.set(kind, out); return out;
}
// A picture of a car for the showroom, three-quarters on, in its colour (rendered once, then kept).
const SHOTS = new Map();
export function carPortrait(kind, color, w = 360, h = 220) {
  const key = kind + color + w + 'x' + h; if (SHOTS.has(key)) return SHOTS.get(key);
  let url = ''; const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  try { renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(w, h, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(), pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    scene.add(new THREE.HemisphereLight('#ffffff', '#55606a', 1.1)); const sun = new THREE.DirectionalLight('#fff4e6', 2.4); sun.position.set(-4, 6, -3); scene.add(sun);
    const car = makeCar(kind, color); scene.add(car); const fc = document.createElement('canvas'); fc.width = fc.height = 128; { const x = fc.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); }
    const ft = new THREE.CanvasTexture(fc), floor = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.4), new THREE.MeshBasicMaterial({ map: ft, transparent: true, depthWrite: false })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; scene.add(floor); /* a soft shadow under it */
    const cam = new THREE.PerspectiveCamera(28, w / h, 0.1, 50), S = CARS[kind] || CARS.car, d = S.L * 1.32 + 1.6; cam.position.set(-d * 0.64, d * 0.3, -d * 0.76); cam.lookAt(0, 0.55, 0.15);
    renderer.render(scene, cam); url = renderer.domElement.toDataURL('image/png'); scene.environment.dispose(); floor.geometry.dispose(); floor.material.dispose(); ft.dispose(); }
  catch (e) {} finally { renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) {} }
  SHOTS.set(key, url); return url;
}
export function makeCones() { const g = new THREE.Group(); for (const x of [-1.1, 0, 1.1]) { const c = new THREE.Mesh(GEO.cone, pmat('#f2994a')); c.scale.set(0.32, 0.8, 0.32); c.position.set(x, 0.4, 0); g.add(c); const s = new THREE.Mesh(GEO.cyl, pmat('#f4f4f0')); s.scale.set(0.22, 0.12, 0.22); s.position.set(x, 0.45, 0); g.add(s); } return g; }

// ---------------- inside a shop (the robbery) ----------------
// L: the level from shared/minigames.js (genStealth): a grid of floor, shelves (1) and the counter (2), in units of
// `s` metres. The back and left walls stand full height; the front and right ones are cut away so you see in.
// The shop's own textures, painted once: polished floor tiles, a sheet of 64 product packs for the shelves, and the
// inside of a drinks fridge.
const shopTex = {
  floor: () => canvasTex('shopfloor', 512, (g, S) => { const r = rnd(41), T = S / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = (x + y) % 2 ? 196 : 150, j = r() * 10 | 0; g.fillStyle = `rgb(${v + j},${v + j - 4},${v + j - 12})`; g.fillRect(x * T, y * T, T, T);
      const gr = g.createLinearGradient(x * T, y * T, x * T + T, y * T + T); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.06)'); g.fillStyle = gr; g.fillRect(x * T, y * T, T, T); }
    noise(g, 1.5, 3500, '60,50,40', 0.10, r); g.strokeStyle = 'rgba(70,60,50,.45)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * T); g.lineTo(S, i * T); g.stroke(); g.beginPath(); g.moveTo(i * T, 0); g.lineTo(i * T, S); g.stroke(); }
    g.strokeStyle = 'rgba(40,30,20,.08)'; g.lineWidth = 1; for (let i = 0; i < 40; i++) { g.beginPath(); const x = r() * S, y = r() * S; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 20); g.stroke(); } }),
  goods: () => canvasTex('goods', 512, (g, S) => { const r = rnd(42), C = S / 8, pal = ['#e4572e', '#f2c94c', '#3cc46a', '#4a7bd9', '#b05fd6', '#f28cb1', '#2ec4b6', '#ff8c42', '#1d3557', '#e63946', '#8ac926', '#ffca3a'];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const x = i * C, y = j * C, c1 = pal[(r() * pal.length) | 0], c2 = pal[(r() * pal.length) | 0], kind = (r() * 4) | 0;
      g.fillStyle = c1; g.fillRect(x, y, C, C);
      if (kind === 0) { g.fillStyle = '#fff'; g.fillRect(x + 4, y + C * 0.28, C - 8, C * 0.3); g.fillStyle = c2; g.beginPath(); g.arc(x + C / 2, y + C * 0.43, C * 0.12, 0, 7); g.fill(); } // a cereal box
      else if (kind === 1) { g.fillStyle = c2; g.fillRect(x, y, C, C * 0.22); g.fillRect(x, y + C * 0.78, C, C * 0.22); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + 6, y + C * 0.42, C - 12, 5); g.fillRect(x + 10, y + C * 0.54, C - 20, 4); } // a tin's label
      else if (kind === 2) { g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(x + C / 2, y + C / 2, C * 0.3, C * 0.22, 0, 0, 7); g.fill(); g.fillStyle = c2; g.fillRect(x + 6, y + 6, C - 12, 8); } // a bag of crisps
      else { g.fillStyle = c2; g.beginPath(); g.moveTo(x, y + C); g.lineTo(x + C, y + C * 0.35); g.lineTo(x + C, y + C); g.fill(); g.fillStyle = '#fff'; g.font = `800 ${C * 0.22}px system-ui`; g.textAlign = 'center'; g.fillText(['NEW', 'MAX', 'BIO', 'XL', '2×1'][(r() * 5) | 0], x + C / 2, y + C * 0.4); }
      const sh = g.createLinearGradient(x, y, x + C, y); sh.addColorStop(0, 'rgba(0,0,0,.18)'); sh.addColorStop(0.2, 'rgba(255,255,255,.12)'); sh.addColorStop(1, 'rgba(0,0,0,.2)'); g.fillStyle = sh; g.fillRect(x, y, C, C);
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeRect(x + 0.5, y + 0.5, C - 1, C - 1); } }, { repeat: false }),
  fridge: () => canvasTex('fridge', 256, (g, S) => { const r = rnd(43), gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#e9f6ff'); gr.addColorStop(1, '#8fb2c8'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 4; k++) { const y = 18 + k * 60; g.fillStyle = 'rgba(40,60,80,.55)'; g.fillRect(0, y + 46, S, 5);
      for (let x = 6; x < S - 10; x += 14) { const c = ['#e63946', '#2ec4b6', '#ffca3a', '#3a86ff', '#8ac926', '#ff8c42', '#f1faee'][(r() * 7) | 0], h = 26 + r() * 16; g.fillStyle = c; g.fillRect(x, y + 46 - h, 10, h); g.fillRect(x + 3, y + 46 - h - 7, 4, 8); g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(x + 1, y + 46 - h + 3, 2, h - 6); } }
    g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(S * 0.35, 0); g.lineTo(0, S * 0.7); g.fill(); }),
  posters: () => canvasTex('posters', 512, (g, S) => { const P = [['#e4572e', '#fff', 'SALE', '-50%'], ['#2f7d63', '#f2c94c', 'FRESH', 'BREAD'], ['#f2c94c', '#c8382e', '2 FOR 1', 'DRINKS'], ['#2f4a7a', '#fff', 'OPEN', '24/7']], C = S / 2;
    P.forEach(([bg, fg, a, b], i) => { const x = (i % 2) * C, y = (i >> 1) * C; g.fillStyle = bg; g.fillRect(x, y, C, C); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 8; g.strokeRect(x + 12, y + 12, C - 24, C - 24);
      g.fillStyle = fg; g.textAlign = 'center'; g.font = `900 ${C * 0.22}px system-ui,sans-serif`; g.fillText(a, x + C / 2, y + C * 0.45); g.font = `800 ${C * 0.16}px system-ui,sans-serif`; g.fillText(b, x + C / 2, y + C * 0.72); }); }, { repeat: false }),
  spot: () => canvasTex('shopspot', 128, (g, S) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,244,220,.22)'); gr.addColorStop(1, 'rgba(255,246,226,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }, { repeat: false }),
};
export function buildShop(view, L, s = 1.6) {
  const M = materials(view), B = {}; for (const k of Object.keys(M)) B[k] = new Bucket(); const r = rnd(L.seed || 1), W = L.W * s, H = L.H * s, wh = 3.4, w = col('#ffffff');
  // the shop's own materials: polished floor, packed goods, lit fridges and signs (lit ones ignore the lights, so they glow)
  const own = (k, m) => { view.mats.push(m); M[k] = m; B[k] = new Bucket(); };
  own('floor', new THREE.MeshStandardMaterial({ map: shopTex.floor(), vertexColors: true, roughness: 0.32, metalness: 0.05 }));
  own('goods', new THREE.MeshStandardMaterial({ map: shopTex.goods(), vertexColors: true, roughness: 0.55 }));
  own('fridge', new THREE.MeshBasicMaterial({ map: shopTex.fridge(), vertexColors: true }));
  own('lit', new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); own('poster', new THREE.MeshStandardMaterial({ map: shopTex.posters(), vertexColors: true, roughness: 0.7 }));
  view.center.set(W / 2, 0, H / 2); view.span = Math.max(W, H) * 1.2;
  // the floor: polished tiles inside, the street outside
  const tw = s * 2; B.floor.quad([0, 0.01, H], [W, 0.01, H], [W, 0.01, 0], [0, 0.01, 0], [0, 1, 0], [0, 0, W / tw, 0, W / tw, H / tw, 0, H / tw], col('#d9cdb8'));
  B.asphalt.quad([-40, 0, H + 40], [W + 40, 0, H + 40], [W + 40, 0, -40], [-40, 0, -40], [0, 1, 0], [0, 10, 10, 10, 10, 0, 0, 0], col('#9a9a9a'));
  B.paving.quad([0, 0.012, H + 1.6], [W + 0.25, 0.012, H + 1.6], [W + 0.25, 0.012, H + 0.25], [0, 0.012, H + 0.25], [0, 1, 0], [0, 0.4, 3, 0.4, 3, 0, 0, 0], col('#d8cfbf'));
  // walls: the back and left in the shop's colours with a dark skirting, a high strip of windows and posters; low walls at the front and right
  const wallC = col(['#c8473d', '#2f7d63', '#2f4a7a', '#e2b13c', '#8e44ad'][L.seed % 5]);
  B.plaster.box(-0.25, -0.25, W, 0, 0, wh, wallC, { su: 14, sv: 12.8 }); B.plaster.box(-0.25, 0, 0, H, 0, wh, col('#e8dfc9'), { su: 14, sv: 12.8 });
  B.solid.box(0, -0.02, W, 0.04, 0, 0.18, col('#3a332c')); B.solid.box(-0.02, 0, 0.04, H, 0, 0.18, col('#3a332c'));
  B.solid.box(0, H, W + 0.25, H + 0.25, 0, 0.45, col('#b0a48c')); B.solid.box(W, -0.25, W + 0.25, H, 0, 0.45, col('#9c917b'));
  for (let x = 1.5; x < W - 2; x += 4.6) B.glass.box(x, -0.1, x + 2.4, 0.02, 2.55, 3.15, col('#9cc3d9'), { su: 4, sv: 4 });
  for (let z = 1.5, k = 0; z < H - 3; z += 4, k++) { const i = (k + L.seed) % 4, u0 = (i % 2) / 2, v1 = 1 - (i >> 1) / 2, u1 = u0 + 0.5, v0 = v1 - 0.5; B.poster.quad([0.03, 1.1, z + 1.6], [0.03, 1.1, z], [0.03, 2.4, z], [0.03, 2.4, z + 1.6], [1, 0, 0], [u0, v0, u1, v0, u1, v1, u0, v1], w); }
  // drinks fridges along the back wall, lit from inside
  const fEnd = (L.W - 3) * s - 0.3; for (let x = 0.4; x + 1.1 <= fEnd; x += 1.2) { B.solid.box(x, 0, x + 1.15, 0.42, 0, 2.2, col('#2b2f33')); B.solid.box(x, 0, x + 1.15, 0.42, 2.2, 2.4, col('#e4572e'));
    B.fridge.quad([x + 0.07, 0.15, 0.425], [x + 1.08, 0.15, 0.425], [x + 1.08, 2.1, 0.425], [x + 0.07, 2.1, 0.425], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], w); B.solid.box(x + 0.92, 0.9, x + 0.97, 1.5, 0.43, 0.47, col('#c0c4c8')); }
  const door = (L.H - 1) * s; B.solid.box(-0.1, door + 0.1, 0.06, door + s - 0.1, 0, 2.4, col('#6b4a2b')); B.solid.box(0.06, door + 0.15, 0.09, door + 0.35, 1.0, 1.15, col('#c0c4c8'));
  B.lit.box(0.08, door + s / 2 - 0.45, 0.16, door + s / 2 + 0.45, 2.55, 2.85, col('#2bd96a')); // the green EXIT light
  B.solid.box(0.1, door + 0.05, 1.3, door + s - 0.05, 0, 0.025, col('#3a3f45')); // the door mat
  // shelves: a metal unit with four shelves, packed goods on both faces (boxes, tins and bottles), yellow price strips
  const goodsBox = (x0, z0, x1, z1, y0, y1, face) => { const i = (r() * 8) | 0, j = (r() * 8) | 0, e = 0.004, u0 = i / 8 + e, u1 = (i + 1) / 8 - e, v1 = 1 - j / 8 - e, v0 = 1 - (j + 1) / 8 + e, uv = [u0, v0, u1, v0, u1, v1, u0, v1];
    if (face > 0) B.goods.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uv, w); else B.goods.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uv, w);
    B.goods.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [u0, v0, u0 + 0.01, v0, u0 + 0.01, v0 + 0.01, u0, v0 + 0.01], w);
    B.goods.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [u1 - 0.02, v0, u1, v0, u1, v1, u1 - 0.02, v1], w); B.goods.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [u0, v0, u0 + 0.02, v0, u0 + 0.02, v1, u0, v1], w); };
  const can = ['#e63946', '#2ec4b6', '#ffca3a', '#3a86ff', '#8ac926', '#c0c4c8'];
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) { const v = L.wall[y * L.W + x]; if (!v) continue; const x0 = x * s, z0 = y * s, x1 = x0 + s, z1 = z0 + s;
    if (v === 2) { // the checkout: a wooden counter with a black conveyor belt and a card reader
      B.solid.box(x0 + 0.02, z0 + 0.1, x1 - 0.02, z1 - 0.1, 0, 1.0, col('#7c4f2c')); B.solid.box(x0 - 0.04, z0 + 0.05, x1 + 0.04, z1 - 0.05, 1.0, 1.08, col('#d9c7a8'));
      B.solid.box(x0 + 0.1, z0 + 0.35, x1 - 0.1, z1 - 0.35, 1.08, 1.11, col('#1d1f22')); continue; }
    B.shiny.box(x0 + 0.08, z0 + 0.2, x1 - 0.08, z1 - 0.2, 0, 0.12, col('#5c5f65')); B.shiny.box(x0 + 0.08, z0 + s / 2 - 0.04, x1 - 0.08, z0 + s / 2 + 0.04, 0.12, 1.85, col('#8a8d93'));
    B.solid.box(x0 + 0.06, z0 + s / 2 - 0.05, x1 - 0.06, z0 + s / 2 + 0.05, 1.85, 2.15, col(['#e4572e', '#2f7d63', '#4a7bd9', '#e2b13c'][(x + y) % 4])); // the aisle sign on top
    for (const hy of [0.12, 0.62, 1.12, 1.62]) { B.shiny.box(x0 + 0.08, z0 + 0.2, x1 - 0.08, z1 - 0.2, hy, hy + 0.05, col('#b8bcc0'), { top: true });
      if (hy < 1.6) for (const zz of [z0 + 0.2, z1 - 0.2]) B.solid.box(x0 + 0.08, zz - 0.015, x1 - 0.08, zz + 0.015, hy - 0.02, hy + 0.06, col('#f2c94c')); }
    for (const hy of [0.17, 0.67, 1.17]) for (const side of [-1, 1]) { let gx = x0 + 0.14; const gz = z0 + s / 2 + side * 0.32;
      while (gx < x1 - 0.2) { const kind = r(), gw = 0.14 + r() * 0.2; if (gx + gw > x1 - 0.12) break;
        if (kind < 0.6) { const gh = 0.22 + r() * 0.2; goodsBox(gx, gz - 0.15, gx + gw, gz + 0.15, hy, hy + gh, side); }
        else { const c = col(can[(r() * can.length) | 0]), tall = kind > 0.82, rr = tall ? 0.05 : 0.045; for (let k = 0; k * 0.11 + 0.1 < gw + 0.05; k++) { const cx = gx + 0.06 + k * 0.11;
            bake(B.shiny, GEO.cyl, { x: cx, y: hy + (tall ? 0.15 : 0.07), z: gz + side * 0.05, sx: rr, sy: tall ? 0.3 : 0.14, sz: rr, color: c }); if (tall) bake(B.shiny, GEO.cyl, { x: cx, y: hy + 0.34, z: gz + side * 0.05, sx: 0.02, sy: 0.08, sz: 0.02, color: c }); } }
        gx += gw + 0.03; } } }
  const tx = L.till.x * s, tz = (L.till.y - 1) * s; B.shiny.box(tx - 0.3, tz - 0.25, tx + 0.3, tz + 0.25, 1.08, 1.32, col('#2b2621')); B.lit.box(tx - 0.2, tz + 0.02, tx + 0.2, tz + 0.06, 1.36, 1.58, col('#62e6a0'));
  B.solid.box(tx + 0.36, tz - 0.08, tx + 0.5, tz + 0.08, 1.08, 1.16, col('#1d1f22'));
  // soft contact shadows where shelves, the counter and the walls meet the floor (cheap ambient occlusion)
  const solidAt = (x, y) => x < 0 || y < 0 || x >= L.W || y >= L.H || L.wall[y * L.W + x] > 0, ao = 0.42;
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) { if (!L.wall[y * L.W + x]) continue; const x0 = x * s + 0.06, z0 = y * s + 0.16, x1 = (x + 1) * s - 0.06, z1 = (y + 1) * s - 0.16;
    if (!solidAt(x, y + 1)) B.ao.quad([x0, 0.014, z1 + ao], [x1, 0.014, z1 + ao], [x1, 0.014, z1], [x0, 0.014, z1], [0, 1, 0], [0, 1, 1, 1, 1, 0, 0, 0], w);
    if (!solidAt(x, y - 1)) B.ao.quad([x0, 0.014, z0], [x1, 0.014, z0], [x1, 0.014, z0 - ao], [x0, 0.014, z0 - ao], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
    if (!solidAt(x + 1, y)) B.ao.quad([x1, 0.014, z1], [x1 + ao, 0.014, z1], [x1 + ao, 0.014, z0], [x1, 0.014, z0], [0, 1, 0], [0, 0, 0, 1, 1, 1, 1, 0], w);
    if (!solidAt(x - 1, y)) B.ao.quad([x0 - ao, 0.014, z1], [x0, 0.014, z1], [x0, 0.014, z0], [x0 - ao, 0.014, z0], [0, 1, 0], [0, 1, 0, 0, 1, 0, 1, 1], w);
    if (L.wall[y * L.W + x] === 1 && r() < 0.45) for (let k = 0; k < 1 + ((r() * 3) | 0); k++) { const bx = x0 + 0.15 + r() * (s - 0.8), bz = y * s + s / 2 + (r() - 0.5) * 0.3; B.solid.box(bx, bz - 0.22, bx + 0.42 + r() * 0.2, bz + 0.22, 2.15, 2.47 + r() * 0.12, col(['#b88a54', '#a87a48', '#c49a64'][k % 3])); } } // spare stock on top
  B.ao.quad([0, 0.014, 0.6], [W, 0.014, 0.6], [W, 0.014, 0], [0, 0.014, 0], [0, 1, 0], [0, 1, 1, 1, 1, 0, 0, 0], w); B.ao.quad([0, 0.014, H], [0.5, 0.014, H], [0.5, 0.014, 0], [0, 0.014, 0], [0, 1, 0], [0, 0, 0, 1, 1, 1, 1, 0], w);
  // on the walls and in the corners: a clock, CCTV domes, a fire extinguisher, plants, and a stack of shopping baskets
  bake(B.shiny, GEO.cyl, { x: W - 1.3, y: 2.95, z: 0.03, sx: 0.32, sy: 0.04, sz: 0.32, color: col('#2b2621') }); B.lit.box(W - 1.55, 0.06, W - 1.05, 0.08, 2.7, 3.2, col('#f4f1e8'));
  B.solid.box(W - 1.32, 0.08, W - 1.28, 0.1, 2.95, 3.14, col('#1a1a1a')); B.solid.box(W - 1.3, 0.08, W - 1.16, 0.1, 2.93, 2.97, col('#1a1a1a'));
  for (const cx of [0.45, W - 0.45]) bake(B.shiny, GEO.half, { x: cx, y: 3.1, z: 0.35, sx: 0.18, sy: 0.14, sz: 0.18, color: col('#1d1f22') });
  bake(B.shiny, GEO.cyl, { x: 0.2, y: 0.42, z: door - 0.45, sx: 0.1, sy: 0.6, sz: 0.1, color: col('#c8231a') }); bake(B.solid, GEO.cyl, { x: 0.2, y: 0.78, z: door - 0.45, sx: 0.04, sy: 0.12, sz: 0.04, color: col('#1a1a1a') });
  for (const [px, pz] of [[W - 0.45, H - 0.45], [0.45, H - 2.2]]) { bake(B.solid, GEO.cyl, { x: px, y: 0.25, z: pz, sx: 0.22, sy: 0.5, sz: 0.22, color: col('#8a5a3a') });
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; bake(B.solid, GEO.ball, { x: px + Math.cos(a) * 0.14, y: 0.75 + (k % 3) * 0.12, z: pz + Math.sin(a) * 0.14, sx: 0.16, sy: 0.24, sz: 0.16, color: col(['#3f8a4e', '#4f9a52', '#2f7a42'][k % 3]) }); } }
  for (let k = 0; k < 6; k++) B.solid.box(0.12, door - 1.55, 0.62, door - 1.15, k * 0.09, k * 0.09 + 0.08, col('#d0342a'));
  // pools of ceiling light on the floor (the ceiling itself is cut away so you can see in)
  const spots = new Bucket(), sw = 1.9; for (let z = s; z < H - 1; z += s * 2.2) for (let x = s; x < W - 1; x += s * 2.4) spots.quad([x - sw, 0.02, z + sw], [x + sw, 0.02, z + sw], [x + sw, 0.02, z - sw], [x - sw, 0.02, z - sw], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], w);
  const group = new THREE.Group();
  for (const [k, b] of Object.entries(B)) { const g = b.geometry(); if (!g) continue; const m = new THREE.Mesh(g, M[k]); m.castShadow = !['asphalt', 'paint', 'pool', 'ao', 'paving', 'floor', 'lit', 'fridge'].includes(k); m.receiveShadow = k !== 'lit' && k !== 'fridge'; m.matrixAutoUpdate = false; group.add(m); }
  const spotMat = new THREE.MeshBasicMaterial({ map: shopTex.spot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); view.mats.push(spotMat);
  const sm = new THREE.Mesh(spots.geometry(), spotMat); sm.matrixAutoUpdate = false; group.add(sm);
  view.scene.add(group);
  // inside: no sky, a warm fill from above, a cool bounce from the fridges, and the room's reflections a little brighter
  view.sky.visible = false; view.scene.background = new THREE.Color('#1b1612'); view.scene.fog = null; view.scene.environmentIntensity = 0.45; view.renderer.toneMappingExposure = 0.92;
  const fill = new THREE.PointLight('#ffe7c4', 30, 32, 1.5); fill.position.set(W / 2, 6.5, H / 2); view.scene.add(fill);
  const cool = new THREE.PointLight('#cfe8ff', 10, 9, 1.6); cool.position.set(Math.min(fEnd, W) / 2, 1.6, 1.4); view.scene.add(cool);
  return group;
}
// A see-through cone: what a shopkeeper or a camera can see (rebuilt each frame from rays that stop at the shelves).
export function viewCone(color = '#ffd54a') {
  const n = 16, geo = new THREE.BufferGeometry(), pos = new Float32Array((n + 2) * 3), idx = [], fade = new Float32Array((n + 2) * 4); for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
  for (let i = 0; i < n + 2; i++) fade.set([1, 1, 1, i ? 0.18 : 1], i * 4); // strong at the eyes, faint at the far edge
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(fade, 4)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending })); m.renderOrder = 3; m.frustumCulled = false;
  m.userData.set = (pts, y = 0.05) => { for (let i = 0; i < pts.length && i < n + 2; i++) { pos[i * 3] = pts[i][0]; pos[i * 3 + 1] = y; pos[i * 3 + 2] = pts[i][1]; } geo.attributes.position.needsUpdate = true; };
  m.userData.n = n; return m;
}

// ---------------- the yard behind the job (the lookout) ----------------
// A walled-in back lot at dusk: the backs of the town's own kinds of buildings all round, alleys people step out
// of, wrecked cars, concrete barriers, crates, dumpsters and burning barrels throwing flickering light.
function flameTex() { return canvasTex('flame', 128, (g, S) => { const gr = g.createRadialGradient(64, 80, 4, 64, 70, 60); gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.35, 'rgba(255,150,40,.9)'); gr.addColorStop(0.7, 'rgba(200,50,10,.4)'); gr.addColorStop(1, 'rgba(120,20,0,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(64, 74, 40, 56, 0, 0, 7); g.fill(); }, { repeat: false }); }
function smokeTex() { return canvasTex('smoke', 128, (g) => { const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(70,70,70,.55)'); gr.addColorStop(1, 'rgba(40,40,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }, { repeat: false }); }
export function buildYard(view, L, { types = [], minute = 1065, skip = [], fogFar = 85 } = {}) {
  const M = materials(view), B = {}; for (const k of Object.keys(M)) B[k] = new Bucket(); const r = rnd(L.seed || 1), W = L.W, H = L.H, w = col('#ffffff');
  view.center.set(W / 2, 0, H / 2); view.span = 70;
  // the ground: old asphalt with faded parking bays, and pavement round the edge
  B.asphalt.quad([-60, 0, H + 60], [W + 60, 0, H + 60], [W + 60, 0, -60], [-60, 0, -60], [0, 1, 0], [-7, 11, 12, 11, 12, -7, -7, -7], col('#b9b6ae'));
  for (let x = 4; x < W - 4; x += 3.2) { B.paint.quad([x, 0.02, 5.5], [x + 0.12, 0.02, 5.5], [x + 0.12, 0.02, 1.2], [x, 0.02, 1.2], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col('#bdb8a8')); B.paint.quad([x, 0.02, H - 1.2], [x + 0.12, 0.02, H - 1.2], [x + 0.12, 0.02, H - 5.5], [x, 0.02, H - 5.5], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col('#bdb8a8')); }
  // the buildings around it (their backs), with gaps for alleys
  const pool = types.filter(t => BUILDING_TYPES[t] && !BUILDING_TYPES[t].outdoor && BUILDING_TYPES[t].style !== 'tent'); if (!pool.length) pool.push('brickflats', 'warehouse', 'office', 'apartment', 'workshop', 'tavern', 'grocer', 'brickoffice');
  const ring = (x0, z0, x1, z1, face) => { const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0); let u = 0; const len = alongX ? x1 - x0 : z1 - z0;
    while (u < len - 4) { const t = pool[Math.floor(r() * pool.length)], T = BUILDING_TYPES[t], wide = Math.min(len - u, Math.max(8, Math.min(3, T.size[0]) * 8 - 2)), deep = 10 + r() * 6;
      if (r() < 0.22) { u += 5; continue; } // an alley
      if (alongX) building(B, view, { type: t, x: x0 + u, y: face === 'S' ? z0 - deep : z0, w: wide, h: deep, level: 1 + Math.floor(r() * 2) }, face, r); else building(B, view, { type: t, x: face === 'E' ? x0 - deep : x0, y: z0 + u, w: deep, h: wide, level: 1 + Math.floor(r() * 2) }, face, r);
      u += wide + 0.6; } };
  if (!skip.includes('S')) ring(-14, -2, W + 14, -2, 'S'); if (!skip.includes('N')) ring(-14, H + 2, W + 14, H + 2, 'N'); if (!skip.includes('E')) ring(-2, -2, -2, H + 2, 'E'); if (!skip.includes('W')) ring(W + 2, -2, W + 2, H + 2, 'W');
  // chain-link fences along the edge (broken in places)
  for (let x = 0; x < W; x += 2.5) if (r() > 0.3) { B.shiny.box(x, -0.05, x + 0.06, 0.05, 0, 2.2, col('#7b7f84')); B.solid.box(x, -0.02, x + 2.5, 0.02, 0.2, 2.1, col('#9aa0a6')); }
  for (let x = 0; x < W; x += 2.5) if (r() > 0.3) { B.shiny.box(x, H - 0.05, x + 0.06, H + 0.05, 0, 2.2, col('#7b7f84')); B.solid.box(x, H - 0.02, x + 2.5, H + 0.02, 0.2, 2.1, col('#9aa0a6')); }
  // what's in the yard
  const fires = [], wrecks = [];
  for (const o of L.obs) { const cx = o.x + o.w / 2, cz = o.y + o.h / 2;
    if (o.k === 'car') { const wreck = makeCar('car', ['#5a3f30', '#3e444a', '#6a3326', '#344234', '#6b6b5a'][Math.floor(r() * 5)]); wreck.position.set(cx, -0.06, cz); wreck.rotation.set(0, (o.w > o.h ? Math.PI / 2 : 0) + (r() - 0.5) * 0.25, (r() - 0.5) * 0.06); wrecks.push(wreck); if (r() < 0.5) fires.push([cx + (r() - 0.5), 1.6, cz + (r() - 0.5)]); } // an abandoned car, sat low on flat tyres
    else if (o.k === 'barrier') { const n = Math.round(Math.max(o.w, o.h) / 2); for (let i = 0; i < n; i++) { const along = o.w > o.h; const x0 = along ? o.x + i * 2 : o.x, z0 = along ? o.y : o.y + i * 2; B.paving.box(x0 + 0.05, z0 + 0.05, x0 + (along ? 1.95 : o.w - 0.05), z0 + (along ? o.h - 0.05 : 1.95), 0, 1.0, col('#c8c3b8'), { su: 2, sv: 2 }); B.solid.box(x0 + 0.05, z0 + 0.05, x0 + (along ? 1.95 : o.w - 0.05), z0 + (along ? o.h - 0.05 : 1.95), 0.55, 0.62, col(i % 2 ? '#c8382e' : '#f4f1e8')); } }
    else if (o.k === 'crates') { B.solid.box(o.x, o.y, o.x + 1.1, o.y + 1.1, 0, 1.1, col('#a9743f')); B.solid.box(o.x + 1.1, o.y, o.x + 2.2, o.y + 1.1, 0, 1.1, col('#9a6a38')); B.solid.box(o.x, o.y + 1.1, o.x + 2.2, o.y + 2.2, 0, 1.0, col('#b07d48')); B.solid.box(o.x + 0.4, o.y + 0.4, o.x + 1.5, o.y + 1.5, 1.1, 2.1, col('#a9743f')); }
    else if (o.k === 'dumpster') { B.shiny.box(o.x, o.y, o.x + o.w, o.y + o.h, 0, 1.4, col('#2f6b4a')); B.shiny.box(o.x - 0.05, o.y - 0.05, o.x + o.w + 0.05, o.y + o.h * 0.6, 1.4, 1.5, col('#244f38')); }
    else if (o.k === 'barrel') { bake(B.shiny, GEO.cyl, { x: cx, y: 0.5, z: cz, sx: 0.45, sy: 1, sz: 0.45, color: col('#5a4a3a') }); fires.push([cx, 1.15, cz]); } }
  // street lamps in the corners (one flickers)
  for (const [x, z] of [[1, 1], [W - 1, 1], [1, H - 1], [W - 1, H - 1]]) lamp(B, view, x, z);
  // a neglected lot: puddles, oil stains, litter, stacks of old tyres, broken pallets and graffiti on the fences
  const clear = (x, z, m) => L.obs.every(o => x < o.x - m || x > o.x + o.w + m || z < o.y - m || z > o.y + o.h + m);
  const blot = (bucket, x, z, rx, rz, y, c, wob, seed) => { const n = 22; for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, j = a => 1 - wob + wob * (0.5 + 0.5 * Math.sin(a * 3 + seed) * Math.cos(a * 2 - seed));
      bucket.tri([x, y, z], [x + Math.cos(a1) * rx * j(a1), y, z + Math.sin(a1) * rz * j(a1)], [x + Math.cos(a0) * rx * j(a0), y, z + Math.sin(a0) * rz * j(a0)], [0, 1, 0], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], c); } }; // a soft, rounded blot
  M.puddle = new THREE.MeshStandardMaterial({ color: '#4a5560', roughness: 0.06, metalness: 0.35, envMapIntensity: 1.6, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); view.mats.push(M.puddle); B.puddle = new Bucket();
  for (let i = 0; i < 9; i++) { const x = 3 + r() * (W - 6), z = 3 + r() * (H - 6); if (!clear(x, z, 0.5)) continue; blot(B.puddle, x, z, 0.7 + r() * 1.3, 0.5 + r() * 0.9, 0.012, w, 0.3, i * 1.7); } // puddles that catch the light
  for (let i = 0; i < 14; i++) blot(B.paint, 2 + r() * (W - 4), 2 + r() * (H - 4), 0.3 + r() * 0.8, 0.25 + r() * 0.6, 0.011, col('#33322f'), 0.35, i * 2.3); // oil stains
  for (let i = 0; i < 30; i++) { const x = 1 + r() * (W - 2), z = 1 + r() * (H - 2), a = r() * 3; if (!clear(x, z, 0.2)) continue; bake(B.solid, GEO.box, { x, y: 0.02, z, ry: a, sx: 0.18 + r() * 0.2, sy: 0.015, sz: 0.12 + r() * 0.15, color: col(['#e8e2d4', '#c8382e', '#4a7bd9', '#f2c94c', '#8a8a8a'][(r() * 5) | 0]) }); } // litter
  for (let i = 0; i < 4; i++) { const x = 2 + r() * (W - 4), z = r() < 0.5 ? 1.2 : H - 1.2; if (!clear(x, z, 1.2)) continue; const n = 2 + ((r() * 3) | 0); for (let k = 0; k < n; k++) { bake(B.solid, GEO.cyl, { x: x + (r() - 0.5) * 0.08, y: 0.13 + k * 0.26, z, sx: 0.38, sy: 0.25, sz: 0.38, color: col('#1b1b1c') }); bake(B.solid, GEO.cyl, { x, y: 0.135 + k * 0.26, z, sx: 0.2, sy: 0.255, sz: 0.2, color: col('#0a0a0a') }); } } // tyres, lying flat
  for (let i = 0; i < 3; i++) { const x = r() < 0.5 ? 1.2 : W - 1.2, z = 3 + r() * (H - 6); if (!clear(x, z, 1.2)) continue; for (let k = 0; k < 2 + ((r() * 3) | 0); k++) { B.solid.box(x - 0.6, z - 0.5, x + 0.6, z + 0.5, k * 0.16, k * 0.16 + 0.04, col('#9a7a50')); for (const dz of [-0.4, 0, 0.4]) B.solid.box(x - 0.6, z + dz - 0.05, x + 0.6, z + dz + 0.05, k * 0.16 + 0.04, k * 0.16 + 0.14, col('#8a6a44')); } } // pallets
  const tags = ['#e4572e', '#f2c94c', '#3cc46a', '#4a7bd9', '#b05fd6', '#f28cb1', '#ffffff'];
  for (let i = 0; i < 10; i++) { const along = r() < 0.5, x = along ? 2 + r() * (W - 4) : (r() < 0.5 ? 0.04 : W - 0.04), z = along ? (r() < 0.5 ? 0.04 : H - 0.04) : 2 + r() * (H - 4), w2 = 0.5 + r() * 1.2, h0 = 0.4 + r() * 0.8, h1 = h0 + 0.3 + r() * 0.6, c = col(tags[(r() * tags.length) | 0]);
    if (along) B.paint.quad([x - w2, h0, z], [x + w2, h0, z], [x + w2, h1, z], [x - w2, h1, z], [0, 0, z < 1 ? 1 : -1], [0, 0, 1, 0, 1, 1, 0, 1], c); else B.paint.quad([x, h0, z + w2], [x, h0, z - w2], [x, h1, z - w2], [x, h1, z + w2], [x < 1 ? 1 : -1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], c); } // graffiti
  const group = new THREE.Group();
  for (const [k, b] of Object.entries(B)) { const g = b.geometry(); if (!g) continue; const m = new THREE.Mesh(g, M[k]); m.castShadow = !['asphalt', 'paint', 'pool', 'ao'].includes(k); m.receiveShadow = !['pool', 'ao'].includes(k); if (k === 'pool' || k === 'ao') m.renderOrder = 2; m.matrixAutoUpdate = false; group.add(m); }
  for (const wk of wrecks) group.add(wk);
  view.scene.add(group);
  // fire: flickering flames, a little smoke, and their light (a few lights only)
  const fm = new THREE.SpriteMaterial({ map: flameTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), sm = new THREE.SpriteMaterial({ map: smokeTex(), transparent: true, depthWrite: false, opacity: 0.6 });
  const flames = []; fires.slice(0, 6).forEach((p, i) => { for (let k = 0; k < 3; k++) { const f = new THREE.Sprite(fm); f.position.set(p[0] + (k - 1) * 0.25, p[1], p[2]); f.scale.set(1, 1.5, 1); view.scene.add(f); flames.push({ f, base: p[1], k: k + i * 3 }); }
    const smk = new THREE.Sprite(sm); smk.position.set(p[0], p[1] + 2, p[2]); smk.scale.set(3, 3, 1); view.scene.add(smk); flames.push({ f: smk, base: p[1] + 2, smoke: true, k: i });
    if (i < 3) { const l = new THREE.PointLight('#ff8a3a', 18, 14, 1.6); l.position.set(p[0], p[1] + 0.6, p[2]); view.scene.add(l); flames.push({ light: l, k: i }); } });
  view.setTime(minute); view.scene.fog = new THREE.Fog(view.night > 0.5 ? '#2a2f2a' : '#8a7a6a', 22, fogFar); view.renderer.toneMappingExposure = 1.2; view.hemi.intensity = Math.max(view.hemi.intensity, 0.55);
  view.animateYard = (now) => { for (const q of flames) { const t = now / 1000 + q.k * 1.7;
    if (q.light) q.light.intensity = 14 + Math.sin(t * 17) * 3 + Math.sin(t * 7.3) * 3;
    else if (q.smoke) { const u = (t * 0.3) % 1; q.f.position.y = q.base + u * 3; q.f.material.opacity = 0.5 * (1 - u); q.f.scale.setScalar(2 + u * 3); }
    else { q.f.scale.set(0.9 + Math.sin(t * 13) * 0.15, 1.3 + Math.sin(t * 9) * 0.3, 1); q.f.position.y = q.base + Math.sin(t * 11) * 0.06; } } };
  return group;
}

// ---------------- the prison compound (the jailbreak) ----------------
// A run-down compound out in the heat at the end of the afternoon: a chain-link fence topped with barbed wire round a
// dirt yard of corrugated sheds, livestock trailers, white water totes in their cages, blue drums, sandbag walls and
// upturned boats under the palms; a concrete wall with an open gate, and behind it the cell block with its barred
// cells and a guard tower. Outside: a dirt road, wooden power poles and their sagging wires, palms and a thatched hut.
// L: the level from shared/minigames.js (genBreak), metres; its y is z here. Everything that doesn't move is merged into
// one mesh per material (a dozen draw calls); the shadows are drawn once.
const NI = {}; const ni = k => NI[k] || (NI[k] = GEO[k].index ? GEO[k].toNonIndexed() : GEO[k]); /* (baked over and over: un-indexed once) */
const cTex = {
  corr: () => canvasTex('corr', 256, (g, S) => { for (let x = 0; x < S; x++) { const v = 200 + 45 * Math.sin(x / S * Math.PI * 2 * 16); g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.fillRect(x, 0, 1, S); }
    const r = rnd(71); for (let i = 0; i < 26; i++) { const x = r() * S, w = 2 + r() * 10, gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(120,60,20,0)'); gr.addColorStop(0.3 + r() * 0.5, 'rgba(120,55,20,.45)'); gr.addColorStop(1, 'rgba(90,40,15,.15)'); g.fillStyle = gr; g.fillRect(x, 0, w, S); } /* rust running down */
    noise(g, 2, 2500, '60,30,10', 0.2, r); }),
  slat: () => canvasTex('slat', 256, (g, S) => { g.fillStyle = '#e6e6e2'; g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += 32) { g.fillStyle = '#2a2a28'; g.fillRect(0, y + 22, S, 7); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, y + 2, S, 3); }
    const r = rnd(72); noise(g, 2, 1800, '70,50,30', 0.18, r); for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(110,70,30,.25)'; g.fillRect(r() * S, r() * S, 3 + r() * 9, 20 + r() * 60); } }),
  dirt: () => canvasTex('cdirt', 512, (g, S) => { g.fillStyle = '#a88b63'; g.fillRect(0, 0, S, S); const r = rnd(73);
    for (let i = 0; i < 60; i++) { const x = r() * S, y = r() * S, rr = 20 + r() * 60, gr = g.createRadialGradient(x, y, 1, x, y, rr); const c = r() < 0.35 ? '96,112,58' : r() < 0.6 ? '132,104,70' : '170,146,108'; gr.addColorStop(0, `rgba(${c},.55)`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = v < 0.5 ? 'rgba(70,52,32,.35)' : 'rgba(210,190,150,.3)'; const s = 1 + r() * 2.2; g.fillRect(r() * S, r() * S, s, s); } /* grit and pebbles */
    for (let i = 0; i < 700; i++) { g.strokeStyle = `rgba(${70 + r() * 30 | 0},${100 + r() * 40 | 0},45,.6)`; g.lineWidth = 1; const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 4 - r() * 6); g.stroke(); } }), /* dry grass */
  chain: () => canvasTex('chain', 64, (g, S) => { g.clearRect(0, 0, S, S); g.strokeStyle = '#d8dcdf'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S / 2, 0); g.lineTo(S, S / 2); g.lineTo(S / 2, S); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(2, 2); g.moveTo(S, 0); g.lineTo(S - 2, 2); g.moveTo(0, S); g.lineTo(2, S - 2); g.moveTo(S, S); g.lineTo(S - 2, S - 2); g.stroke(); }, { srgb: true }),
  frond: () => canvasTex('frond', 256, (g, S) => { g.clearRect(0, 0, S, S); g.strokeStyle = '#d9e6c0'; g.lineWidth = 5; g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.stroke();
    for (let y = 6; y < S; y += 9) { const w = S / 2 * (0.55 + 0.45 * Math.sin(y / S * Math.PI)); for (const d of [-1, 1]) { g.strokeStyle = y % 2 ? '#f2f6ea' : '#e2ebcf'; g.lineWidth = 5; g.beginPath(); g.moveTo(S / 2, y); g.quadraticCurveTo(S / 2 + d * w * 0.5, y + 6, S / 2 + d * w, y + 22); g.stroke(); } } }, { repeat: false }),
  wood: () => canvasTex('cwood', 256, (g, S) => { g.fillStyle = '#d8c4a4'; g.fillRect(0, 0, S, S); const r = rnd(74); for (let y = 0; y < S; y += 32) { g.fillStyle = 'rgba(60,40,20,.55)'; g.fillRect(0, y, S, 2); for (let k = 0; k < 14; k++) { g.strokeStyle = 'rgba(90,60,30,.18)'; g.beginPath(); const yy = y + 4 + r() * 26; g.moveTo(0, yy); g.bezierCurveTo(S * 0.3, yy + (r() - 0.5) * 6, S * 0.7, yy + (r() - 0.5) * 6, S, yy); g.stroke(); } } noise(g, 2, 900, '40,25,10', 0.2, r); }),
  thatch: () => canvasTex('thatch', 256, (g, S) => { g.fillStyle = '#b39760'; g.fillRect(0, 0, S, S); const r = rnd(75); for (let i = 0; i < 2600; i++) { g.strokeStyle = `rgba(${140 + r() * 80 | 0},${110 + r() * 60 | 0},${50 + r() * 40 | 0},.7)`; g.lineWidth = 1 + r(); const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y + 10 + r() * 16); g.stroke(); }
    for (let y = 0; y < S; y += 40) { g.fillStyle = 'rgba(40,28,10,.35)'; g.fillRect(0, y, S, 3); } }),
};
export function buildCompound(view, L) {
  const M = materials(view), B = {}, r = rnd((L.seed || 1) * 7 + 3), W = L.W, H = L.H, w = col('#ffffff');
  const mk = (k, o, cut = true) => { if (!M[k]) { const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...o }); if (cut) cutAway(m, view.cut); view.mats.push(m); M[k] = m; } };
  mk('corr', { map: cTex.corr(), roughness: 0.55, metalness: 0.35 }); mk('slat', { map: cTex.slat(), roughness: 0.5, metalness: 0.4 }); mk('dirt', { map: cTex.dirt(), roughness: 1 }, false);
  mk('chain', { map: cTex.chain(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 }, false); mk('frond', { map: cTex.frond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }, false);
  mk('wood', { map: cTex.wood(), roughness: 0.85 }); mk('thatch', { map: cTex.thatch(), roughness: 1 }, false);
  for (const k of ['solid', 'shiny', 'roof', 'paving', 'grass', 'corr', 'slat', 'dirt', 'chain', 'frond', 'wood', 'thatch', 'glow', 'paint', 'ao']) B[k] = new Bucket();
  view.center.set(W / 2, 0, H / 2); view.span = 48;
  const gq = (b, x0, z0, x1, z1, y, s, c) => b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0 / s, z1 / s, x1 / s, z1 / s, x1 / s, z0 / s, x0 / s, z0 / s], c);
  // the ground: grass and scrub outside, the dirt yard inside, concrete behind the wall; the track in and the road past it
  gq(B.grass, -90, -70, W + 90, H + 90, 0, 6, col('#c9c08a')); gq(B.dirt, 0, 0, W, H, 0.01, 9, w); gq(B.paving, 0.3, 0.3, W - 0.3, 24, 0.02, 3, col('#b9b2a2'));
  gq(B.dirt, W / 2 - 2.6, H - 0.3, W / 2 + 2.6, H + 6, 0.012, 9, col('#efe4d0')); gq(B.dirt, -90, H + 6, W + 90, H + 12, 0.014, 9, col('#e8dcc4'));
  // contact shadows along every wall's foot
  const ao = (x0, z0, x1, z1) => { const d = 0.9; B.ao.quad([x0 - d, 0.03, z0 - d], [x1 + d, 0.03, z0 - d], [x1, 0.03, z0], [x0, 0.03, z0], [0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0], w); B.ao.quad([x1 + d, 0.03, z1 + d], [x0 - d, 0.03, z1 + d], [x0, 0.03, z1], [x1, 0.03, z1], [0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0], w);
    B.ao.quad([x0 - d, 0.03, z1 + d], [x0 - d, 0.03, z0 - d], [x0, 0.03, z0], [x0, 0.03, z1], [0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0], w); B.ao.quad([x1 + d, 0.03, z0 - d], [x1 + d, 0.03, z1 + d], [x1, 0.03, z1], [x1, 0.03, z0], [0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0], w); };
  const ringLo = new THREE.TorusGeometry(1, 0.07, 3, 10).toNonIndexed();
  // chain-link with posts and three strands of barbed wire
  const fence = o => { const along = o.w >= o.h, len = along ? o.w : o.h, cx = o.x + o.w / 2, cz = o.y + o.h / 2, x0 = along ? o.x : cx, z0 = along ? cz : o.y, x1 = along ? o.x + o.w : cx, z1 = along ? cz : o.y + o.h;
    B.chain.quad([x0, 0.05, z0], [x1, 0.05, z1], [x1, 2.5, z1], [x0, 2.5, z0], along ? [0, 0, 1] : [1, 0, 0], [0, 0, len / 0.12 / 6, 0, len / 0.12 / 6, 2.45 / 0.12 / 6, 0, 2.45 / 0.12 / 6], col('#c4c8cc'));
    for (let u = 0; u <= len + 0.01; u += 3) { const x = along ? o.x + Math.min(u, len) : cx, z = along ? cz : o.y + Math.min(u, len); bake(B.shiny, ni('cyl'), { x, y: 1.4, z, sx: 0.045, sy: 2.8, sz: 0.045, color: col('#8b9095') });
      bake(B.shiny, ni('box'), { x: x + (along ? 0 : -0.18), y: 2.85, z: z + (along ? -0.18 : 0), rx: along ? -0.6 : 0, rz: along ? 0 : 0.6, sx: 0.04, sy: 0.5, sz: 0.04, color: col('#8b9095') }); } /* the arms lean out, over the wire */
    for (const h of [2.62, 2.78, 2.94]) { const off = (h - 2.5) * 0.7; if (along) B.shiny.box(x0, cz - off - 0.012, x1, cz - off + 0.012, h, h + 0.02, col('#6f747a'), { top: false }); else B.shiny.box(cx - off - 0.012, z0, cx - off + 0.012, z1, h, h + 0.02, col('#6f747a'), { top: false }); }
    B.solid.box(along ? x0 : cx - 0.03, along ? cz - 0.03 : z0, along ? x1 : cx + 0.03, along ? cz + 0.03 : z1, 2.47, 2.53, col('#8b9095')); };
  // the concrete wall, razor wire coiled on top, stains down it
  const wall = o => { B.roof.box(o.x, o.y, o.x + o.w, o.y + o.h, 0, 3, col('#c7bfae'), { su: 2, sv: 2 }); B.roof.box(o.x - 0.06, o.y - 0.06, o.x + o.w + 0.06, o.y + o.h + 0.06, 3, 3.12, col('#a59d8c'), { su: 2, sv: 2 }); ao(o.x, o.y, o.x + o.w, o.y + o.h);
    B.paint.box(o.x - 0.01, o.y - 0.01, o.x + o.w + 0.01, o.y + o.h + 0.01, 0, 0.5, col('#8d826c'), { top: false });
    for (let x = o.x + 0.3; x < o.x + o.w - 0.2; x += 0.55) bake(B.shiny, ringLo, { x, y: 3.42, z: o.y + o.h / 2, ry: Math.PI / 2 + (r() - 0.5) * 0.3, sx: 0.3, sy: 0.3, sz: 0.3, color: col('#9aa0a6') });
    for (let i = 0; i < o.w / 3; i++) { const x = o.x + r() * o.w, h0 = 1.2 + r() * 1.4, ww = 0.2 + r() * 0.5; for (const zf of [o.y - 0.015, o.y + o.h + 0.015]) B.paint.quad([x, h0, zf], [x + ww, h0, zf], [x + ww, 3, zf], [x, 3, zf], [0, 0, zf < o.y ? -1 : 1], [0, 0, 1, 0, 1, 1, 0, 1], col('#958a76')); } };
  // the gate: two pillars and the barred gate swung open
  const gate = () => { const g = L.gate, z = 24.3; for (const x of [g - 2.2, g + 2.2]) { B.roof.box(x - 0.35, z - 0.45, x + 0.35, z + 0.45, 0, 3.5, col('#b8b0a0'), { su: 2, sv: 2 }); B.roof.box(x - 0.42, z - 0.52, x + 0.42, z + 0.52, 3.5, 3.65, col('#9a927f')); bake(B.glow, ni('box'), { x, y: 3.3, z: z + 0.5, sx: 0.3, sy: 0.16, sz: 0.1, color: col('#fff1c8') }); }
    for (const [hx, a] of [[g - 1.85, -1.9], [g + 1.85, 1.9 + Math.PI]]) { const ca = Math.cos(a), sa = Math.sin(a), P = u => [hx + ca * u, z + sa * u];
      for (const h of [0.25, 1.4, 2.5]) { const [mx, mz] = P(0.9); bake(B.shiny, ni('box'), { x: mx, y: h, z: mz, ry: -a, sx: 1.8, sy: 0.08, sz: 0.06, color: col('#3f454b') }); }
      for (let u = 0.1; u <= 1.8; u += 0.18) { const [bx, bz] = P(u); bake(B.shiny, ni('cyl'), { x: bx, y: 1.35, z: bz, sx: 0.022, sy: 2.4, sz: 0.022, color: col('#3f454b') }); } } };
  // the cell block: concrete, flat roof with tanks and units on it, four barred cells across the front
  const block = o => { const zf = o.y + o.h, zb = zf - 1.8, c0 = col('#d2c9b6'), c1 = col('#bdb4a0');
    B.roof.box(o.x, o.y, o.x + o.w, zb, 0, 5.2, c0, { su: 2, sv: 2 }); ao(o.x, o.y, o.x + o.w, zf);
    B.roof.box(o.x, zb, o.x + o.w, zf, 2.85, 5.2, c0, { su: 2, sv: 2, bottom: true }); B.roof.box(o.x - 0.3, o.y - 0.3, o.x + o.w + 0.3, zf + 0.4, 5.2, 5.45, c1, { su: 2, sv: 2, bottom: true });
    B.paint.box(o.x - 0.01, o.y - 0.01, o.x + o.w + 0.01, zf + 0.01, 0, 0.6, col('#9c917b'), { top: false });
    const edges = [o.x]; for (const c of L.cells) edges.push(c - 1.1, c + 1.1); edges.push(o.x + o.w);
    for (let i = 0; i < edges.length; i += 2) if (edges[i + 1] > edges[i] + 0.01) B.roof.box(edges[i], zb, edges[i + 1], zf, 0, 2.85, c0, { su: 2, sv: 2 });
    L.cells.forEach((c, i) => { gq(B.paving, c - 1.1, zb, c + 1.1, zf, 0.03, 1.5, col('#8e897e'));
      B.solid.box(c - 1.0, zb + 0.05, c + 0.2, zb + 0.75, 0.35, 0.5, col('#5b5f52')); B.solid.box(c - 1.0, zb + 0.05, c - 0.9, zb + 0.75, 0, 0.35, col('#3c3f44')); B.solid.box(c + 0.1, zb + 0.05, c + 0.2, zb + 0.75, 0, 0.35, col('#3c3f44')); /* a bunk */
      bake(B.shiny, ni('cyl'), { x: c + 0.75, y: 0.22, z: zb + 0.35, sx: 0.2, sy: 0.44, sz: 0.2, color: col('#c9ccce') });
      if (i !== L.cell) { for (let u = -1.0; u <= 1.01; u += 0.15) bake(B.shiny, ni('cyl'), { x: c + u, y: 1.42, z: zf - 0.06, sx: 0.022, sy: 2.84, sz: 0.022, color: col('#2f3337') }); for (const h of [0.15, 1.3, 2.7]) B.shiny.box(c - 1.1, zf - 0.1, c + 1.1, zf - 0.02, h, h + 0.08, col('#2f3337')); }
      B.paint.quad([c - 0.25, 3.3, zf + 0.012], [c + 0.25, 3.3, zf + 0.012], [c + 0.25, 3.8, zf + 0.012], [c - 0.25, 3.8, zf + 0.012], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], col(i === L.cell ? '#f2c94c' : '#e8e2d4')); /* the cell's number plate */
      bake(B.glow, ni('box'), { x: c, y: 4.6, z: zf + 0.12, sx: 0.5, sy: 0.12, sz: 0.2, color: col('#fff1c8') }); });
    for (let i = 0; i < 3; i++) { const x = o.x + 2 + r() * (o.w - 4), z = o.y + 1 + r() * (o.h - 4); bake(B.solid, ni('box'), { x, y: 5.85, z, sx: 1.1, sy: 0.8, sz: 0.8, color: col('#a8acaf') }); }
    bake(B.shiny, ni('cyl'), { x: o.x + o.w - 3, y: 6.4, z: o.y + 2.5, sx: 1.1, sy: 1.9, sz: 1.1, color: col('#2b3a4a') });
    for (let x = o.x + 1.5; x < o.x + o.w - 1; x += 3.2) { B.shiny.box(x - 0.35, o.y - 0.02, x + 0.35, o.y + 0.02, 3.2, 3.7, col('#2f3337')); } }; /* barred windows at the back */
  // the guard tower: legs, a platform with a rail, a tin roof and a searchlight
  let light = null; const tower = o => { const cx = o.x + o.w / 2, cz = o.y + o.h / 2, hw = o.w / 2;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { bake(B.wood, ni('box'), { x: cx + dx * (hw - 0.15), y: 2.2, z: cz + dz * (hw - 0.15), sx: 0.22, sy: 4.4, sz: 0.22, color: col('#8a6a48') }); bake(B.wood, ni('box'), { x: cx + dx * (hw - 0.15), y: 5.7, z: cz + dz * (hw - 0.15), sx: 0.12, sy: 2.5, sz: 0.12, color: col('#8a6a48') }); }
    for (const h of [1.4, 2.9]) { B.wood.box(o.x + 0.1, cz - 0.05, o.x + o.w - 0.1, cz + 0.05, h, h + 0.12, col('#7a5c3c')); B.wood.box(cx - 0.05, o.y + 0.1, cx + 0.05, o.y + o.h - 0.1, h, h + 0.12, col('#7a5c3c')); }
    B.wood.box(o.x - 0.2, o.y - 0.2, o.x + o.w + 0.2, o.y + o.h + 0.2, 4.4, 4.62, col('#9a7a55'), { bottom: true });
    for (const [a, b2, c2, d2] of [[o.x - 0.2, o.y - 0.2, o.x + o.w + 0.2, o.y - 0.12], [o.x - 0.2, o.y + o.h + 0.12, o.x + o.w + 0.2, o.y + o.h + 0.2], [o.x - 0.2, o.y - 0.2, o.x - 0.12, o.y + o.h + 0.2], [o.x + o.w + 0.12, o.y - 0.2, o.x + o.w + 0.2, o.y + o.h + 0.2]]) B.wood.box(a, b2, c2, d2, 4.62, 5.6, col('#8a6a48'));
    B.corr.quad([o.x - 0.5, 7.0, o.y - 0.5], [o.x + o.w + 0.5, 7.0, o.y - 0.5], [o.x + o.w + 0.5, 6.6, o.y + o.h + 0.5], [o.x - 0.5, 6.6, o.y + o.h + 0.5], [0, 1, 0], [0, 0, 3.6, 0, 3.6, 3.6, 0, 3.6], col('#8c6a52'));
    B.corr.quad([o.x - 0.5, 6.6, o.y + o.h + 0.5], [o.x + o.w + 0.5, 6.6, o.y + o.h + 0.5], [o.x + o.w + 0.5, 7.0, o.y - 0.5], [o.x - 0.5, 7.0, o.y - 0.5], [0, -1, 0], [0, 0, 3.6, 0, 3.6, 3.6, 0, 3.6], col('#5a4a3e'));
    for (let h = 0.4; h < 4.4; h += 0.4) B.wood.box(o.x + o.w + 0.25, cz - 0.3, o.x + o.w + 0.32, cz + 0.3, h, h + 0.06, col('#7a5c3c')); /* the ladder */
    light = { x: cx, y: 6.1, z: cz }; bake(B.shiny, ni('cyl'), { x: cx, y: 6.1, z: cz, sx: 0.25, sy: 0.35, sz: 0.25, color: col('#2b2f33') }); };
  // corrugated sheds: rusty or painted tin, a sloping roof, a dark doorway and a door hanging open
  const shed = o => { const c = col(['#9a5b3a', '#7e8a8f', '#5f7f6a', '#a7b2b5', '#8a6b4a', '#6d7f99'][Math.floor(r() * 6)]), along = o.w >= o.h, hgt = 2.7;
    B.corr.box(o.x, o.y, o.x + o.w, o.y + o.h, 0, hgt, c, { su: 1.6, sv: 3, top: false }); ao(o.x, o.y, o.x + o.w, o.y + o.h);
    const rc = col(['#8c5a3c', '#7a7f82', '#9a7a5a'][Math.floor(r() * 3)]), e = 0.35;
    if (along) { B.corr.quad([o.x - e, hgt + 0.15, o.y + o.h + e], [o.x + o.w + e, hgt + 0.15, o.y + o.h + e], [o.x + o.w + e, hgt + 0.6, o.y - e], [o.x - e, hgt + 0.6, o.y - e], [0, 1, 0], [0, 0, (o.w + 2 * e) / 1.6, 0, (o.w + 2 * e) / 1.6, 1, 0, 1], rc);
      B.corr.quad([o.x - e, hgt + 0.6, o.y - e], [o.x + o.w + e, hgt + 0.6, o.y - e], [o.x + o.w + e, hgt + 0.15, o.y + o.h + e], [o.x - e, hgt + 0.15, o.y + o.h + e], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col('#3a3530'));
      B.corr.box(o.x, o.y, o.x + o.w, o.y + o.h, hgt, hgt + 0.45, c, { su: 1.6, sv: 3, top: false }); }
    else { B.corr.quad([o.x + o.w + e, hgt + 0.15, o.y + o.h + e], [o.x + o.w + e, hgt + 0.15, o.y - e], [o.x - e, hgt + 0.6, o.y - e], [o.x - e, hgt + 0.6, o.y + o.h + e], [0, 1, 0], [0, 0, (o.h + 2 * e) / 1.6, 0, (o.h + 2 * e) / 1.6, 1, 0, 1], rc);
      B.corr.quad([o.x - e, hgt + 0.6, o.y + o.h + e], [o.x - e, hgt + 0.6, o.y - e], [o.x + o.w + e, hgt + 0.15, o.y - e], [o.x + o.w + e, hgt + 0.15, o.y + o.h + e], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col('#3a3530'));
      B.corr.box(o.x, o.y, o.x + o.w, o.y + o.h, hgt, hgt + 0.45, c, { su: 1.6, sv: 3, top: false }); }
    const fx = along ? o.x + o.w * (0.3 + r() * 0.4) : (o.x + o.w / 2 < W / 2 ? o.x + o.w + 0.012 : o.x - 0.012), fz = along ? (o.y + o.h / 2 < H / 2 + 6 ? o.y + o.h + 0.012 : o.y - 0.012) : o.y + o.h * (0.3 + r() * 0.4), dk = col('#1b1a18');
    if (along) { B.paint.quad([fx - 0.7, 0.02, fz], [fx + 0.7, 0.02, fz], [fx + 0.7, 2.1, fz], [fx - 0.7, 2.1, fz], [0, 0, fz > o.y ? 1 : -1], [0, 0, 1, 0, 1, 1, 0, 1], dk); bake(B.corr, ni('box'), { x: fx + 0.7 + 0.45, y: 1.05, z: fz + (fz > o.y ? 0.5 : -0.5), ry: fz > o.y ? -0.9 : 0.9, sx: 1.4, sy: 2.1, sz: 0.05, color: c.clone().multiplyScalar(0.8) }); }
    else { B.paint.quad([fx, 0.02, fz + 0.7], [fx, 0.02, fz - 0.7], [fx, 2.1, fz - 0.7], [fx, 2.1, fz + 0.7], [fx > o.x ? 1 : -1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1], dk); bake(B.corr, ni('box'), { x: fx + (fx > o.x ? 0.5 : -0.5), y: 1.05, z: fz + 0.7 + 0.45, ry: fx > o.x ? 0.9 + Math.PI / 2 : -0.9 - Math.PI / 2, sx: 1.4, sy: 2.1, sz: 0.05, color: c.clone().multiplyScalar(0.8) }); } };
  // livestock trailers: slatted aluminium on a dark frame, wheels, the hitch out the front
  const trailer = o => { const along = o.w >= o.h, c = col(['#d6d9db', '#c9c2b4', '#b8c0c4'][Math.floor(r() * 3)]), i = 0.08;
    B.slat.box(o.x + i, o.y + i, o.x + o.w - i, o.y + o.h - i, 0.62, 2.35, c, { su: 1.6, sv: 1.6 }); B.solid.box(o.x + i, o.y + i, o.x + o.w - i, o.y + o.h - i, 0.42, 0.62, col('#26282b')); ao(o.x, o.y, o.x + o.w, o.y + o.h);
    B.shiny.box(o.x + i - 0.03, o.y + i - 0.03, o.x + o.w - i + 0.03, o.y + o.h - i + 0.03, 2.33, 2.42, c.clone().multiplyScalar(0.9));
    const cx = o.x + o.w / 2, cz = o.y + o.h / 2, half = (along ? o.w : o.h) / 2, side = (along ? o.h : o.w) / 2;
    for (const u of [-0.55, 0.35]) for (const s2 of [-1, 1]) { const x = along ? cx + u : cx + s2 * (side - 0.02), z = along ? cz + s2 * (side - 0.02) : cz + u; bake(B.solid, ni('cyl'), { x, y: 0.38, z, rx: along ? Math.PI / 2 : 0, rz: along ? 0 : Math.PI / 2, sx: 0.38, sy: 0.24, sz: 0.38, color: col('#18191b') }); bake(B.shiny, ni('cyl'), { x, y: 0.38, z, rx: along ? Math.PI / 2 : 0, rz: along ? 0 : Math.PI / 2, sx: 0.2, sy: 0.26, sz: 0.2, color: col('#9aa0a6') }); }
    const dir = r() < 0.5 ? -1 : 1, hx = along ? cx + dir * (half + 0.9) : cx, hz = along ? cz : cz + dir * (half + 0.9); bake(B.solid, ni('box'), { x: hx, y: 0.5, z: hz, ry: along ? Math.PI / 2 : 0, sx: 0.12, sy: 0.12, sz: 1.8, color: col('#26282b') }); bake(B.solid, ni('cyl'), { x: hx + (along ? dir * 0.8 : 0), y: 0.25, z: hz + (along ? 0 : dir * 0.8), sx: 0.06, sy: 0.5, sz: 0.06, color: col('#26282b') }); };
  // water totes: a white tank in a galvanised cage on a pallet
  const tank = o => { const cx = o.x + o.w / 2, cz = o.y + o.h / 2, s = 0.62; B.solid.box(cx - s - 0.04, cz - s - 0.04, cx + s + 0.04, cz + s + 0.04, 0, 0.15, col('#2a2c2e')); B.solid.box(cx - s + 0.03, cz - s + 0.03, cx + s - 0.03, cz + s - 0.03, 0.15, 1.2, col('#efece2')); ao(cx - s, cz - s, cx + s, cz + s);
    for (let u = -s; u <= s + 0.01; u += s / 2.5) { B.shiny.box(cx + u - 0.015, cz - s, cx + u + 0.015, cz - s + 0.03, 0.15, 1.24, col('#a9afb3'), { top: false }); B.shiny.box(cx + u - 0.015, cz + s - 0.03, cx + u + 0.015, cz + s, 0.15, 1.24, col('#a9afb3'), { top: false }); B.shiny.box(cx - s, cz + u - 0.015, cx - s + 0.03, cz + u + 0.015, 0.15, 1.24, col('#a9afb3'), { top: false }); B.shiny.box(cx + s - 0.03, cz + u - 0.015, cx + s, cz + u + 0.015, 0.15, 1.24, col('#a9afb3'), { top: false }); }
    for (const h of [0.6, 1.2]) B.shiny.box(cx - s, cz - s, cx + s, cz + s, h, h + 0.035, col('#a9afb3'), { top: false });
    bake(B.solid, ni('cyl'), { x: cx, y: 1.24, z: cz, sx: 0.2, sy: 0.1, sz: 0.2, color: col('#d8d4c8') }); };
  const crates = o => { const cx = o.x + o.w / 2, cz = o.y + o.h / 2, dx = (r() - 0.5) * 0.3, dz = (r() - 0.5) * 0.3; /* (boxes with real texture coordinates, so the planks show) */
    B.wood.box(cx - 0.62, cz - 0.62, cx + 0.62, cz + 0.62, 0, 1.1, col('#c9a06a'), { su: 1.1, sv: 1.1 }); B.wood.box(cx + dx - 0.38, cz + dz - 0.38, cx + dx + 0.38, cz + dz + 0.38, 1.1, 1.74, col('#b58c5a'), { su: 1.1, sv: 1.1 });
    for (const [x0, x1] of [[cx - 0.64, cx - 0.56], [cx + 0.56, cx + 0.64]]) B.wood.box(x0, cz - 0.64, x1, cz + 0.64, 0, 1.1, col('#8a6640'), { su: 1.1, sv: 1.1, top: false }); ao(o.x + 0.1, o.y + 0.1, o.x + o.w - 0.1, o.y + o.h - 0.1); };
  const barrels = o => { const cx = o.x + o.w / 2, cz = o.y + o.h / 2; for (const [dx, dz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) { if (r() < 0.15) continue; const c = col(r() < 0.8 ? '#2f6fd1' : '#c9a227'), x = cx + dx, z = cz + dz;
      bake(B.shiny, ni('cyl'), { x, y: 0.45, z, sx: 0.27, sy: 0.9, sz: 0.27, color: c }); for (const h of [0.3, 0.62]) bake(B.shiny, ni('cyl'), { x, y: h, z, sx: 0.285, sy: 0.04, sz: 0.285, color: c.clone().multiplyScalar(0.8) }); bake(B.shiny, ni('cyl'), { x: x + 0.1, y: 0.91, z, sx: 0.05, sy: 0.03, sz: 0.05, color: col('#e8e8e8') }); } };
  // upturned boats on blocks: a long hull, keel up, a coloured band along the gunwale
  const boat = o => { const along = o.w >= o.h, cx = o.x + o.w / 2, cz = o.y + o.h / 2, len = along ? o.w : o.h, bw = along ? o.h : o.w, c = col(['#f2f2ee', '#e9e4d6', '#3d6fa8', '#b8452f'][Math.floor(r() * 4)]), band = col(['#2f6fd1', '#c8382e', '#2f8a5a', '#f2c94c'][Math.floor(r() * 4)]);
    for (const u of [-len * 0.3, len * 0.3]) B.wood.box(along ? cx + u - 0.15 : cx - bw / 2 + 0.1, along ? cz - bw / 2 + 0.1 : cz + u - 0.15, along ? cx + u + 0.15 : cx + bw / 2 - 0.1, along ? cz + bw / 2 - 0.1 : cz + u + 0.15, 0, 0.22, col('#7a5c3c'));
    bake(B.shiny, ni('half'), { x: cx, y: 0.3, z: cz, ry: along ? Math.PI / 2 : 0, sx: bw / 2, sy: 0.62, sz: len / 2, color: c }); bake(B.shiny, ni('cyl'), { x: cx, y: 0.3, z: cz, rx: Math.PI / 2, ry: along ? Math.PI / 2 : 0, sx: bw / 2 + 0.02, sy: len * 0.9, sz: 0.1, color: band });
    bake(B.solid, ni('box'), { x: cx, y: 0.9, z: cz, ry: along ? Math.PI / 2 : 0, sx: 0.07, sy: 0.08, sz: len * 0.9, color: c.clone().multiplyScalar(0.7) }); };
  // sandbag walls: three courses of fat bags, staggered
  const sandbags = o => { const along = o.w >= o.h, len = along ? o.w : o.h, cx = o.x + o.w / 2, cz = o.y + o.h / 2;
    for (let k = 0; k < 3; k++) for (let u = -len / 2 + 0.3 + (k % 2) * 0.28; u <= len / 2 - 0.25; u += 0.55) { const t = col(['#b9a27a', '#a99067', '#c4ae86'][Math.floor(r() * 3)]);
      bake(B.solid, ni('ball'), { x: along ? cx + u : cx + (r() - 0.5) * 0.06, y: 0.17 + k * 0.27, z: along ? cz + (r() - 0.5) * 0.06 : cz + u, ry: along ? 0 : Math.PI / 2, sx: 0.31, sy: 0.16, sz: 0.24 + (k ? 0 : 0.06), color: t }); } ao(o.x + 0.1, o.y + 0.1, o.x + o.w - 0.1, o.y + o.h - 0.1); };
  // palms: a curving ringed trunk, drooping fronds, coconuts
  const palm = (x, z, s = 1) => { const a = r() * Math.PI * 2, lean = 0.5 + r() * 0.9, n = 7, hgt = (6 + r() * 2) * s; let px = x, pz = z;
    for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, d0 = lean * t0 * t0, d1 = lean * t1 * t1, x0 = x + Math.cos(a) * d0, z0 = z + Math.sin(a) * d0, x1 = x + Math.cos(a) * d1, z1 = z + Math.sin(a) * d1, y0 = hgt * t0, y1 = hgt * t1, sl = Math.atan2(Math.hypot(x1 - x0, z1 - z0), y1 - y0);
      bake(B.solid, ni('cyl'), { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, ry: -a, rz: -sl, sx: (0.2 - 0.06 * t0) * s, sy: (y1 - y0) * 1.05, sz: (0.2 - 0.06 * t0) * s, color: col(i % 2 ? '#8a7558' : '#7a6448') }); px = x1; pz = z1; }
    const top = [px, hgt, pz]; for (let i = 0; i < 3; i++) bake(B.solid, ni('ball'), { x: px + Math.cos(i * 2.1) * 0.22, y: hgt - 0.25, z: pz + Math.sin(i * 2.1) * 0.22, sx: 0.15, sy: 0.17, sz: 0.15, color: col('#5a4a2a') });
    const nf = 9; for (let f = 0; f < nf; f++) { const fa = f / nf * Math.PI * 2 + r() * 0.4, L0 = (2.6 + r() * 0.8) * s, droop = 1.2 + r() * 0.9, ca = Math.cos(fa), sa = Math.sin(fa), lc = col(['#5f8a3a', '#6f9a42', '#4f7a34', '#86a24a'][f % 4]); const seg = 5;
      for (let k = 0; k < seg; k++) { const t0 = k / seg, t1 = (k + 1) / seg, P0 = [top[0] + ca * L0 * t0, top[1] + 0.3 * t0 * 4 * (1 - t0) - droop * t0 * t0, top[2] + sa * L0 * t0], P1 = [top[0] + ca * L0 * t1, top[1] + 0.3 * t1 * 4 * (1 - t1) - droop * t1 * t1, top[2] + sa * L0 * t1], w0 = 0.55 * s * Math.sin(Math.PI * (0.12 + t0 * 0.88)) + 0.05, w1 = 0.55 * s * Math.sin(Math.PI * (0.12 + t1 * 0.88)) + 0.05;
        B.frond.quad([P0[0] - sa * w0, P0[1] - 0.06, P0[2] + ca * w0], [P0[0] + sa * w0, P0[1] - 0.06, P0[2] - ca * w0], [P1[0] + sa * w1, P1[1] - 0.06, P1[2] - ca * w1], [P1[0] - sa * w1, P1[1] - 0.06, P1[2] + ca * w1], [0, 1, 0], [0, t0, 1, t0, 1, t1, 0, t1], lc); } } };
  const bush = (x, z, s = 1) => { for (let i = 0; i < 3; i++) bake(B.solid, ni('ball'), { x: x + Math.cos(i * 2.1) * 0.5 * s, y: 0.45 * s, z: z + Math.sin(i * 2.1) * 0.5 * s, sx: 0.8 * s, sy: 0.6 * s, sz: 0.8 * s, color: col(['#5a7a34', '#6b8a3c', '#4f6b30'][i]) }); };
  for (const o of L.obs) { const k = o.k;
    if (k === 'fence') fence(o); else if (k === 'wall') wall(o); else if (k === 'block') block(o); else if (k === 'tower') tower(o); else if (k === 'shed') shed(o); else if (k === 'trailer') trailer(o);
    else if (k === 'tank') tank(o); else if (k === 'crates') crates(o); else if (k === 'barrels') barrels(o); else if (k === 'boat') boat(o); else if (k === 'sandbags') sandbags(o); else if (k === 'palm') palm(o.x + o.w / 2, o.y + o.h / 2); }
  gate();
  // round the outside: palms and scrub, the thatched hut, the power line along the road, a sign at the gap in the fence
  const out = (x, z) => x < -2 || x > W + 2 || z < -2 || z > H + 2;
  for (let i = 0, t = 0; i < 26 && t < 400; t++) { const x = -40 + r() * (W + 80), z = -40 + r() * (H + 70); if (!out(x, z) || (z > H + 4 && z < H + 14) || Math.abs(x - W / 2) < 6 && z > H) continue; palm(x, z, 0.9 + r() * 0.35); i++; }
  for (let i = 0, t = 0; i < 40 && t < 400; t++) { const x = -30 + r() * (W + 60), z = -30 + r() * (H + 60); if (!out(x, z) || (z > H + 5 && z < H + 13)) continue; bush(x, z, 0.7 + r() * 0.8); i++; }
  for (let i = 0; i < 70; i++) { const x = 1 + r() * (W - 2), z = 25 + r() * (H - 26); if (!breakClear(L, x, z, 0.4)) continue; for (let k = 0; k < 3; k++) bake(B.solid, ni('cone'), { x: x + (r() - 0.5) * 0.3, y: 0.15, z: z + (r() - 0.5) * 0.3, ry: r() * 3, sx: 0.06, sy: 0.3 + r() * 0.2, sz: 0.06, color: col(['#7d8a45', '#9a9a52', '#6a7a3a'][k]) }); } /* tufts of dry grass */
  const hx = W / 2 + 11, hz = H + 17; for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) bake(B.wood, ni('cyl'), { x: hx + dx, y: 1.2, z: hz + dz, sx: 0.1, sy: 2.4, sz: 0.1, color: col('#6b4a32') });
  bake(B.thatch, ni('cone'), { x: hx, y: 3.1, z: hz, ry: 0.4, sx: 3.2, sy: 1.6, sz: 3.2, color: col('#cdb27a') }); B.wood.box(hx - 1.4, hz - 1.4, hx + 1.4, hz + 1.4, 0.3, 0.42, col('#8a6a48'));
  const poles = []; for (let x = -36; x <= W + 36; x += 14) { const z = H + 4.6; poles.push([x, z]); bake(B.wood, ni('cyl'), { x, y: 4, z, sx: 0.14, sy: 8, sz: 0.14, color: col('#6b5238') }); bake(B.wood, ni('box'), { x, y: 7.4, z, sx: 0.12, sy: 0.12, sz: 1.8, color: col('#6b5238') }); for (const dz of [-0.7, 0, 0.7]) bake(B.shiny, ni('cyl'), { x, y: 7.55, z: z + dz, sx: 0.05, sy: 0.14, sz: 0.05, color: col('#e8e4dc') }); }
  const wire = []; for (let i = 0; i + 1 < poles.length; i++) for (const dz of [-0.7, 0, 0.7]) { const [x0, z0] = poles[i], [x1] = poles[i + 1]; for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8, sag = t => 7.62 - 0.9 * 4 * t * (1 - t); wire.push(x0 + (x1 - x0) * t0, sag(t0), z0 + dz, x0 + (x1 - x0) * t1, sag(t1), z0 + dz); } }
  { const [px, pz] = poles.reduce((a, p) => Math.abs(p[0] - (W - 4)) < Math.abs(a[0] - (W - 4)) ? p : a, poles[0]), tx = W - 5, tz = 3.6; for (let k = 0; k < 12; k++) { const t0 = k / 12, t1 = (k + 1) / 12, sag = t => 7.6 + (5.4 - 7.6) * t - 1.4 * 4 * t * (1 - t); wire.push(px + (tx - px) * t0, sag(t0), pz + (tz - pz) * t0, px + (tx - px) * t1, sag(t1), pz + (tz - pz) * t1); } } /* the line into the cell block */
  // the sign by the gap: KEEP OUT, painted by hand
  const sx0 = W / 2 - 4.2, sz0 = H + 1.2; for (const dx of [-0.8, 0.8]) bake(B.wood, ni('box'), { x: sx0 + dx, y: 0.9, z: sz0, sx: 0.1, sy: 1.8, sz: 0.1, color: col('#6b4a32') });
  const group = new THREE.Group();
  for (const [k, b] of Object.entries(B)) { const g = b.geometry(); if (!g) continue; const m = new THREE.Mesh(g, M[k]); m.castShadow = !['grass', 'dirt', 'paving', 'paint', 'ao', 'glow'].includes(k); m.receiveShadow = !['ao', 'glow'].includes(k); if (k === 'ao') m.renderOrder = 2; m.matrixAutoUpdate = false; group.add(m); }
  const wl = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: '#1e1e1e' })); group.add(wl);
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 96; const sg = sc.getContext('2d'); sg.fillStyle = '#e9dcc0'; sg.fillRect(0, 0, 256, 96); sg.fillStyle = 'rgba(90,60,30,.25)'; for (let y = 0; y < 96; y += 24) sg.fillRect(0, y, 256, 2);
  sg.fillStyle = '#b3261e'; sg.font = 'bold 50px sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText('KEEP OUT', 128, 50); const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
  const signM = new THREE.MeshStandardMaterial({ map: st, roughness: 0.9 }); view.mats.push(signM); const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.75), signM); sign.position.set(sx0, 1.5, sz0 + 0.06); group.add(sign);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.75), pmat('#8a6a48')); back.position.set(sx0, 1.5, sz0 + 0.05); back.rotation.y = Math.PI; group.add(back);
  // the prisoner's cell door: its own bars, hinged at the left, so it can swing open
  const c = L.cells[L.cell], zf = L.obs.find(o => o.k === 'block'), zd = zf ? zf.y + zf.h : 11, D = new Bucket();
  for (let u = 0.1; u <= 2.11; u += 0.15) bake(D, ni('cyl'), { x: u, y: 1.42, z: -0.06, sx: 0.022, sy: 2.84, sz: 0.022, color: col('#2f3337') }); for (const h of [0.15, 1.3, 2.7]) D.box(0, -0.1, 2.2, -0.02, h, h + 0.08, col('#2f3337'));
  D.box(1.9, -0.2, 2.05, 0.08, 1.0, 1.3, col('#c9a227')); /* the lock */
  const door = new THREE.Group(); door.position.set(c - 1.1, 0, zd); const dm = new THREE.Mesh(D.geometry(), M.shiny); dm.castShadow = true; door.add(dm); group.add(door);
  view.scene.add(group);
  // the searchlight: a pale beam sweeping the yard (a see-through cone, no real light: cheap)
  let beam = null; if (light) { beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 14, 18, 1, true), new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); beam.geometry.translate(0, -7, 0); beam.position.set(light.x, light.y, light.z); view.scene.add(beam); }
  // late afternoon: a low warm sun and a hazy distance
  view.setTime(16 * 60 + 40); view.scene.fog = new THREE.Fog('#dcc9a2', 70, 220); view.renderer.toneMappingExposure = 1.0;
  view.animateCompound = now => { if (beam) { const t = now / 1000; beam.rotation.set(0.9 + Math.sin(t * 0.37) * 0.15, 0, 0); beam.rotation.order = 'YXZ'; beam.rotation.y = Math.PI * 0.75 + Math.sin(t * 0.23) * 0.9; } };
  return { group, door };
}
const breakClear = (L, x, z, R) => L.obs.every(o => x + R < o.x || x - R > o.x + o.w || z + R < o.y || z - R > o.y + o.h);

