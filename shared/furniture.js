// Inside a colonist's home: the furniture they can buy, the floors and wallpaper, and the rules for placing things.
// Shared by the page (to draw the room and check a spot before asking) and the server (which checks again and keeps it).
//
// A room is a square of floor tiles seen from the front corner, with a wall along the back-left (x = 0) and the
// back-right (y = 0). Each piece of furniture covers a w×d block of tiles and is drawn from a few blocks ("parts"):
// [x, y, z, w, d, h, colour, shape], in tiles (z and h are heights, a tile being the unit). '$' as the colour means the
// colour the player picked. Shapes: none (a block), 'o' (a round thing: a bush, a lampshade), 's' (a screen).
// Turned 0, a piece stands with its back to the right-hand wall (y = 0) and faces the room.
import { BUILDING_TYPES } from './catalog.js';

export const TINTS = ['#C0392B', '#2E86C1', '#27AE60', '#8E44AD', '#E67E22', '#5D6D7E', '#E8C9A0', '#22313F'];
export const ROOM_CATS = [['living', '🛋️ Living'], ['bed', '🛏️ Bedroom'], ['kitchen', '🍳 Kitchen'], ['bath', '🛁 Bathroom'], ['fun', '🎮 Fun'], ['plants', '🪴 Plants'], ['luxury', '💎 Luxury']];

const W = '#8B5A3C', WD = '#6B4428', MT = '#3B3B40', WH = '#F4F1EA';
const legs = (x0, y0, x1, y1, h, c = WD, t = 0.07) => [[x0, y0, 0, t, t, h, c], [x1 - t, y0, 0, t, t, h, c], [x0, y1 - t, 0, t, t, h, c], [x1 - t, y1 - t, 0, t, t, h, c]];
export const FURNITURE = {
  // living room
  sofa: { name: 'Sofa', cat: 'living', size: [2, 1], cost: 4000, tint: true, parts: [[0, 0.1, 0, 2, 0.85, 0.42, '$'], [0, 0, 0, 2, 0.3, 0.95, '$'], [0, 0.1, 0, 0.25, 0.85, 0.62, '$'], [1.75, 0.1, 0, 0.25, 0.85, 0.62, '$'], [0.3, 0.32, 0.42, 0.65, 0.55, 0.1, '$'], [1.05, 0.32, 0.42, 0.65, 0.55, 0.1, '$']] },
  armchair: { name: 'Armchair', cat: 'living', size: [1, 1], cost: 1800, tint: true, parts: [[0.1, 0.15, 0, 0.8, 0.75, 0.42, '$'], [0.1, 0.08, 0, 0.8, 0.25, 0.95, '$'], [0.1, 0.15, 0, 0.18, 0.75, 0.62, '$'], [0.72, 0.15, 0, 0.18, 0.75, 0.62, '$']] },
  coffeetable: { name: 'Coffee table', cat: 'living', size: [2, 1], cost: 1200, parts: [...legs(0.25, 0.25, 1.75, 0.8, 0.32), [0.2, 0.2, 0.32, 1.6, 0.65, 0.07, W]] },
  tv: { name: 'TV and stand', cat: 'living', size: [2, 1], cost: 6000, parts: [[0.1, 0.05, 0, 1.8, 0.5, 0.45, MT], [0.35, 0.15, 0.45, 1.3, 0.08, 0.8, '#111418', 's'], [0.9, 0.12, 0.45, 0.2, 0.15, 0.05, MT]] },
  bookshelf: { name: 'Bookshelf', cat: 'living', size: [2, 1], cost: 2500, parts: [[0, 0, 0, 2, 0.4, 1.9, '#7A5233'], [0.1, 0.36, 0.25, 0.35, 0.05, 0.35, '#B03A2E'], [0.5, 0.36, 0.25, 0.4, 0.05, 0.32, '#1F618D'], [1.05, 0.36, 0.25, 0.3, 0.05, 0.36, '#D4AC0D'], [1.4, 0.36, 0.25, 0.45, 0.05, 0.3, '#117A65'],
    [0.1, 0.36, 0.95, 0.45, 0.05, 0.34, '#6C3483'], [0.6, 0.36, 0.95, 0.3, 0.05, 0.36, '#CA6F1E'], [1.0, 0.36, 0.95, 0.55, 0.05, 0.3, '#2E4053'], [0.15, 0.36, 1.5, 0.5, 0.05, 0.3, '#A93226'], [0.8, 0.36, 1.5, 0.35, 0.05, 0.33, '#196F3D']] },
  floorlamp: { name: 'Floor lamp', cat: 'living', size: [1, 1], cost: 900, parts: [[0.33, 0.33, 0, 0.34, 0.34, 0.05, MT], [0.47, 0.47, 0.05, 0.06, 0.06, 1.35, MT], [0.25, 0.25, 1.3, 0.5, 0.5, 0.38, '#F7E7B4']] },
  rug: { name: 'Rug', cat: 'living', size: [2, 2], cost: 1500, tint: true, rug: true, parts: [[0.1, 0.1, 0, 1.8, 1.8, 0.02, '$']] },
  bigrug: { name: 'Large rug', cat: 'living', size: [3, 2], cost: 2500, tint: true, rug: true, parts: [[0.1, 0.1, 0, 2.8, 1.8, 0.02, '$'], [0.35, 0.35, 0.02, 2.3, 1.3, 0.01, '#F2E8D5']] },
  sidetable: { name: 'Side table', cat: 'living', size: [1, 1], cost: 600, parts: [...legs(0.25, 0.25, 0.75, 0.75, 0.45), [0.2, 0.2, 0.45, 0.6, 0.6, 0.06, W], [0.4, 0.4, 0.51, 0.2, 0.2, 0.22, '#4A90A4']] },
  fireplace: { name: 'Fireplace', cat: 'living', size: [2, 1], cost: 15000, parts: [[0, 0, 0, 2, 0.5, 1.2, '#A9A39A'], [0.45, 0.4, 0.1, 1.1, 0.12, 0.65, '#2B2622'], [0.7, 0.42, 0.12, 0.6, 0.1, 0.35, '#F39C12'], [0.85, 0.44, 0.15, 0.3, 0.08, 0.3, '#F7DC6F'], [-0.05, 0, 1.2, 2.1, 0.6, 0.08, '#7B7468']] },
  // bedroom
  bed: { name: 'Single bed', cat: 'bed', size: [1, 2], cost: 2500, tint: true, parts: [[0, 0, 0, 1, 2, 0.32, W], [0, 0, 0, 1, 0.14, 0.9, WD], [0.05, 0.14, 0.32, 0.9, 1.8, 0.14, WH], [0.15, 0.2, 0.46, 0.7, 0.3, 0.1, '#FFFFFF'], [0.04, 0.6, 0.46, 0.92, 1.36, 0.06, '$']] },
  doublebed: { name: 'Double bed', cat: 'bed', size: [2, 2], cost: 6000, tint: true, parts: [[0, 0, 0, 2, 2, 0.32, W], [0, 0, 0, 2, 0.14, 1.0, WD], [0.05, 0.14, 0.32, 1.9, 1.8, 0.14, WH], [0.15, 0.2, 0.46, 0.75, 0.3, 0.1, '#FFFFFF'], [1.1, 0.2, 0.46, 0.75, 0.3, 0.1, '#FFFFFF'], [0.04, 0.62, 0.46, 1.92, 1.34, 0.06, '$']] },
  wardrobe: { name: 'Wardrobe', cat: 'bed', size: [2, 1], cost: 3500, parts: [[0, 0, 0, 2, 0.6, 2.0, '#9B7048'], [0.98, 0.6, 0.1, 0.04, 0.01, 1.8, WD], [0.85, 0.61, 0.9, 0.05, 0.03, 0.2, '#D4AC0D'], [1.1, 0.61, 0.9, 0.05, 0.03, 0.2, '#D4AC0D']] },
  nightstand: { name: 'Bedside table', cat: 'bed', size: [1, 1], cost: 700, parts: [[0.2, 0.1, 0, 0.6, 0.55, 0.5, W], [0.3, 0.64, 0.25, 0.4, 0.02, 0.04, '#D4AC0D'], [0.4, 0.25, 0.5, 0.2, 0.2, 0.08, MT], [0.35, 0.2, 0.62, 0.3, 0.3, 0.25, '#F7E7B4']] },
  dresser: { name: 'Dresser with mirror', cat: 'bed', size: [2, 1], cost: 2200, parts: [[0.1, 0.05, 0, 1.8, 0.55, 0.85, '#B9875A'], [0.5, 0.05, 0.85, 1.0, 0.06, 0.95, '#CFE8F3'], [0.45, 0.04, 0.85, 1.1, 0.04, 1.0, WD]] },
  desk: { name: 'Desk with laptop', cat: 'bed', size: [2, 1], cost: 2000, parts: [...legs(0.1, 0.1, 1.9, 0.8, 0.7), [0.05, 0.05, 0.7, 1.9, 0.8, 0.06, '#C8A87A'], [0.7, 0.25, 0.76, 0.6, 0.4, 0.03, '#BFC5CC'], [0.7, 0.2, 0.76, 0.6, 0.05, 0.4, '#1B2631', 's']] },
  chair: { name: 'Chair', cat: 'bed', size: [1, 1], cost: 500, tint: true, parts: [...legs(0.22, 0.22, 0.78, 0.78, 0.42), [0.2, 0.2, 0.42, 0.6, 0.6, 0.07, '$'], [0.2, 0.15, 0.42, 0.6, 0.08, 0.6, '$']] },
  // kitchen
  counter: { name: 'Kitchen counter', cat: 'kitchen', size: [1, 1], cost: 1500, parts: [[0, 0, 0, 1, 0.65, 0.88, '#E8E4DC'], [0, 0, 0.88, 1, 0.7, 0.06, '#4A4A4E'], [0.45, 0.66, 0.6, 0.1, 0.02, 0.04, MT]] },
  stove: { name: 'Cooker', cat: 'kitchen', size: [1, 1], cost: 3000, parts: [[0, 0, 0, 1, 0.65, 0.88, '#D5D8DC'], [0, 0, 0.88, 1, 0.68, 0.04, '#1C1C1E'], [0.15, 0.66, 0.15, 0.7, 0.02, 0.5, '#2C3E50'], [0.2, 0.15, 0.92, 0.25, 0.25, 0.02, '#922B21'], [0.55, 0.3, 0.92, 0.25, 0.25, 0.02, '#922B21']] },
  fridge: { name: 'Fridge', cat: 'kitchen', size: [1, 1], cost: 4500, parts: [[0.05, 0, 0, 0.9, 0.7, 1.9, '#DADDE2'], [0.05, 0.7, 1.15, 0.9, 0.01, 0.03, '#A6ACAF'], [0.8, 0.71, 1.3, 0.05, 0.04, 0.4, '#7F8C8D'], [0.8, 0.71, 0.6, 0.05, 0.04, 0.4, '#7F8C8D']] },
  sink: { name: 'Kitchen sink', cat: 'kitchen', size: [1, 1], cost: 1800, parts: [[0, 0, 0, 1, 0.65, 0.88, '#E8E4DC'], [0, 0, 0.88, 1, 0.7, 0.06, '#4A4A4E'], [0.2, 0.15, 0.9, 0.6, 0.4, 0.05, '#BDC3C7'], [0.45, 0.05, 0.94, 0.1, 0.1, 0.3, '#95A5A6']] },
  diningtable: { name: 'Dining table', cat: 'kitchen', size: [2, 2], cost: 3500, parts: [...legs(0.3, 0.3, 1.7, 1.7, 0.7), [0.2, 0.2, 0.7, 1.6, 1.6, 0.07, W], [0.85, 0.85, 0.77, 0.3, 0.3, 0.12, '#F4D03F']] },
  // bathroom
  bathtub: { name: 'Bathtub', cat: 'bath', size: [2, 1], cost: 5000, parts: [[0, 0, 0, 2, 0.95, 0.55, '#F4F6F8'], [0.1, 0.1, 0.42, 1.8, 0.75, 0.1, '#A9D8EC'], [1.75, 0.35, 0.55, 0.12, 0.12, 0.25, '#BDC3C7']] },
  toilet: { name: 'Toilet', cat: 'bath', size: [1, 1], cost: 1200, parts: [[0.25, 0.05, 0, 0.5, 0.25, 0.85, '#F4F6F8'], [0.3, 0.3, 0, 0.4, 0.5, 0.4, '#F4F6F8'], [0.27, 0.28, 0.4, 0.46, 0.55, 0.05, '#E5E8E8']] },
  shower: { name: 'Shower', cat: 'bath', size: [1, 1], cost: 3500, parts: [[0, 0, 0, 1, 1, 0.08, '#E5E8E8'], [0.45, 0.05, 1.5, 0.1, 0.3, 0.06, '#95A5A6'], [0, 0.95, 0.08, 1, 0.04, 1.8, 'rgba(190,225,240,.45)'], [0.95, 0, 0.08, 0.04, 1, 1.8, 'rgba(190,225,240,.45)']] },
  basin: { name: 'Wash basin', cat: 'bath', size: [1, 1], cost: 1000, parts: [[0.4, 0.1, 0, 0.2, 0.2, 0.75, '#F4F6F8'], [0.2, 0.05, 0.75, 0.6, 0.45, 0.12, '#F4F6F8'], [0.25, 0.02, 1.0, 0.5, 0.04, 0.6, '#CFE8F3']] },
  // fun
  arcade: { name: 'Arcade machine', cat: 'fun', size: [1, 1], cost: 12000, tint: true, parts: [[0.15, 0.1, 0, 0.7, 0.65, 1.75, '$'], [0.22, 0.72, 0.95, 0.56, 0.04, 0.5, '#0B1A2E', 's'], [0.2, 0.72, 0.75, 0.6, 0.12, 0.08, MT], [0.15, 0.1, 1.75, 0.7, 0.65, 0.05, '#F1C40F']] },
  fishtank: { name: 'Fish tank', cat: 'fun', size: [2, 1], cost: 8000, parts: [[0.1, 0.1, 0, 1.8, 0.55, 0.6, '#2C3E50'], [0.1, 0.1, 0.6, 1.8, 0.55, 0.7, 'rgba(95,183,224,.7)'], [0.5, 0.4, 0.85, 0.2, 0.05, 0.1, '#F39C12'], [1.2, 0.4, 1.0, 0.18, 0.05, 0.08, '#E74C3C'], [0.3, 0.2, 0.6, 0.2, 0.2, 0.35, '#27AE60', 'o']] },
  piano: { name: 'Piano', cat: 'fun', size: [2, 1], cost: 18000, parts: [[0.1, 0, 0, 1.8, 0.55, 1.25, '#1D1B1E'], [0.15, 0.55, 0.7, 1.7, 0.25, 0.08, '#F5F5F0'], [0.15, 0.55, 0.0, 0.12, 0.25, 0.7, '#1D1B1E'], [1.73, 0.55, 0.0, 0.12, 0.25, 0.7, '#1D1B1E']] },
  catbed: { name: 'Pet bed', cat: 'fun', size: [1, 1], cost: 600, tint: true, parts: [[0.15, 0.15, 0, 0.7, 0.7, 0.18, '$'], [0.25, 0.25, 0.12, 0.5, 0.5, 0.06, '#F2E8D5']] },
  mirror: { name: 'Standing mirror', cat: 'fun', size: [1, 1], cost: 1500, parts: [[0.3, 0.1, 0, 0.4, 0.3, 0.06, WD], [0.3, 0.12, 0.06, 0.4, 0.06, 1.6, '#B9875A'], [0.34, 0.15, 0.12, 0.32, 0.04, 1.45, '#D6EAF8']] },
  // plants
  plant: { name: 'Pot plant', cat: 'plants', size: [1, 1], cost: 400, parts: [[0.32, 0.32, 0, 0.36, 0.36, 0.32, '#B8643C'], [0.17, 0.17, 0.3, 0.66, 0.66, 0.6, '#3E8E41', 'o']] },
  palm: { name: 'Indoor palm', cat: 'plants', size: [1, 1], cost: 900, parts: [[0.3, 0.3, 0, 0.4, 0.4, 0.4, '#E5E0D8'], [0.46, 0.46, 0.4, 0.08, 0.08, 0.7, '#7D6608'], [0.05, 0.05, 0.9, 0.9, 0.9, 0.7, '#2E8B57', 'o']] },
  flowers: { name: 'Flower pot', cat: 'plants', size: [1, 1], cost: 350, parts: [[0.35, 0.35, 0, 0.3, 0.3, 0.28, '#5D6D7E'], [0.25, 0.25, 0.28, 0.5, 0.5, 0.35, '#E84393', 'o']] },
  // luxury
  grandpiano: { name: 'Grand piano', cat: 'luxury', size: [2, 2], cost: 75000, parts: [[0.15, 0.15, 0, 0.12, 0.12, 0.7, '#1D1B1E'], [1.7, 0.15, 0, 0.12, 0.12, 0.7, '#1D1B1E'], [0.9, 1.6, 0, 0.12, 0.12, 0.7, '#1D1B1E'], [0.1, 0.1, 0.7, 1.8, 1.7, 0.3, '#1D1B1E'], [0.15, 1.55, 0.75, 1.7, 0.2, 0.06, '#F5F5F0'], [0.1, 0.1, 1.0, 1.8, 0.9, 0.05, '#2C2A2E']] },
  hottub: { name: 'Hot tub', cat: 'luxury', size: [2, 2], cost: 90000, parts: [[0, 0, 0, 2, 2, 0.75, '#7E5A3C'], [0.15, 0.15, 0.62, 1.7, 1.7, 0.12, '#48C9B0'], [0.6, 0.6, 0.74, 0.8, 0.8, 0.01, '#A3E4D7']] },
  trophies: { name: 'Trophy cabinet', cat: 'luxury', size: [1, 1], cost: 9000, parts: [[0.05, 0, 0, 0.9, 0.5, 1.9, '#5E3A21'], [0.12, 0.45, 0.1, 0.76, 0.06, 1.7, 'rgba(214,234,248,.55)'], [0.35, 0.2, 1.2, 0.3, 0.2, 0.4, '#F1C40F'], [0.3, 0.2, 0.55, 0.4, 0.2, 0.35, '#D4AC0D']] },
  statue: { name: 'Gold statue', cat: 'luxury', size: [1, 1], cost: 150000, parts: [[0.2, 0.2, 0, 0.6, 0.6, 0.45, '#ECE6DA'], [0.35, 0.35, 0.45, 0.3, 0.3, 0.75, '#F1C40F'], [0.3, 0.3, 1.15, 0.4, 0.4, 0.4, '#F4D03F', 'o']] },
  aquarium: { name: 'Wall aquarium', cat: 'luxury', size: [3, 1], cost: 45000, parts: [[0, 0, 0, 3, 0.6, 0.5, '#1B2631'], [0, 0, 0.5, 3, 0.6, 1.3, 'rgba(52,152,219,.65)'], [0.6, 0.3, 0.9, 0.25, 0.05, 0.12, '#F39C12'], [1.7, 0.35, 1.2, 0.2, 0.05, 0.1, '#E74C3C'], [2.3, 0.3, 0.7, 0.22, 0.05, 0.1, '#F7DC6F'], [0.2, 0.15, 0.5, 0.3, 0.3, 0.5, '#1E8449', 'o']] },
};
export const FLOORS = { wood: { name: 'Oak boards', a: '#C8A273', b: '#BC9466', cost: 0 }, walnut: { name: 'Walnut', a: '#7B5536', b: '#6F4B2F', cost: 1500 }, tiles: { name: 'White tiles', a: '#EEF0F2', b: '#DCE0E4', cost: 1500 },
  marble: { name: 'Marble', a: '#F2EFEA', b: '#E3DED6', cost: 6000 }, carpet: { name: 'Blue carpet', a: '#4D6E9E', b: '#47679A', cost: 1200 }, rose: { name: 'Rose carpet', a: '#B7787E', b: '#AE7076', cost: 1200 },
  slate: { name: 'Slate', a: '#5D6670', b: '#535C66', cost: 2000 }, check: { name: 'Black & white', a: '#F4F4F2', b: '#2B2B2E', cost: 2500 } };
export const WALLS = { cream: { name: 'Cream', c: '#EFE6D2', cost: 0 }, white: { name: 'White', c: '#F7F7F5', cost: 500 }, sage: { name: 'Sage', c: '#C9D6BF', cost: 800 }, sky: { name: 'Sky blue', c: '#C7DCEB', cost: 800 },
  blush: { name: 'Blush', c: '#EBCFCB', cost: 800 }, sun: { name: 'Sunshine', c: '#F3DE9A', cost: 800 }, navy: { name: 'Navy', c: '#34495E', cost: 1500 }, brick: { name: 'Brick', c: '#B0634A', cost: 2000, brick: true } };
export const RESALE = 0.5, MAX_ITEMS = 60, MAX_STORED = 60;

// How big the inside is, by the kind of home: a tent is cosy, a big house roomy.
export function roomSize(type) {
  const t = BUILDING_TYPES[type]; if (!t || !t.home) return 0;
  if (t.style === 'tent' || type === 'tent') return 4;
  const [w, d] = t.size, cap = t.home.capacity || 1, area = w * d;
  if (cap >= 6) return 5; // a flat in a block
  if (area >= 9) return 8; return area >= 4 ? 6 : 5;
}
export const footOf = (k, r) => { const s = (FURNITURE[k] || {}).size || [1, 1]; return r % 2 ? [s[1], s[0]] : [s[0], s[1]]; };
// The parts of a piece turned r quarter-turns (clockwise seen from above), within its turned footprint.
export function partsOf(k, r = 0) {
  const f = FURNITURE[k]; if (!f) return []; let [w, d] = f.size, parts = f.parts.map(p => p.slice());
  for (let i = 0; i < ((r % 4) + 4) % 4; i++) { parts = parts.map(([x, y, z, pw, pd, h, c, s]) => [d - (y + pd), x, z, pd, pw, h, c, s]); [w, d] = [d, w]; }
  return parts;
}
// Is there room for piece k at (x, y), turned r, in a room of `size`, leaving out the piece `skip` (one being moved)?
// Rugs lie under everything else, so they only clash with other rugs.
export function placeProblem(room, size, k, x, y, r, skip = null) {
  const f = FURNITURE[k]; if (!f) return 'There’s no such piece of furniture.';
  if (![x, y, r].every(Number.isInteger) || r < 0 || r > 3) return 'That isn’t a spot in the room.';
  const [w, d] = footOf(k, r); if (x < 0 || y < 0 || x + w > size || y + d > size) return 'It doesn’t fit there.';
  for (const it of room.items || []) { if (it.i === skip) continue; const o = FURNITURE[it.k]; if (!o || !!o.rug !== !!f.rug) continue; const [ow, od] = footOf(it.k, it.r);
    if (x < it.x + ow && it.x < x + w && y < it.y + od && it.y < y + d) return 'Something’s already there.'; }
  return null;
}
// A room as stored, made safe and fitted to the home the player lives in now: anything that no longer fits (they moved
// somewhere smaller, or something was in the way) is packed into their storage instead of being lost.
export function fitRoom(raw, size) {
  const room = { floor: FLOORS[raw?.floor] ? raw.floor : 'wood', wall: WALLS[raw?.wall] ? raw.wall : 'cream', items: [], box: [] }; let changed = false;
  for (const it of Array.isArray(raw?.box) ? raw.box : []) if (FURNITURE[it?.k] && room.box.length < MAX_STORED) room.box.push({ i: String(it.i), k: it.k, c: tintOf(it) });
  for (const it of Array.isArray(raw?.items) ? raw.items : []) { if (!FURNITURE[it?.k]) { changed = true; continue; }
    const p = { i: String(it.i), k: it.k, x: it.x, y: it.y, r: it.r || 0, c: tintOf(it) };
    if (room.items.length < MAX_ITEMS && !placeProblem(room, size, p.k, p.x, p.y, p.r)) room.items.push(p); else { changed = true; if (room.box.length < MAX_STORED) room.box.push({ i: p.i, k: p.k, c: p.c }); } }
  return { room, changed };
}
const tintOf = it => (Number.isInteger(it?.c) && it.c >= 0 && it.c < TINTS.length ? it.c : 0);
export const resaleOf = k => Math.floor((FURNITURE[k]?.cost || 0) * RESALE);
