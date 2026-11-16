// Inside a colonist's home: the house's floor plan, the furniture they can buy (for the floor, the walls, the windows and
// the ceiling), floors and wallpaper for each room, photo frames, and the rules for where things can go. Shared by the
// page (which draws the house in 3D and checks a spot before asking) and the server (which checks again and keeps it).
//
// Units: one floor tile is 1 (about a metre); heights use the same unit, the ceiling being WALL_H up.
// A house is a square of size×size tiles. Its plan (layoutOf) lists the rooms and every wall between tiles: an outside
// wall, an inside wall, a doorway, a window or the front door. Edges are named h<x>,<y> (the line along the top of
// tile x,y) and v<x>,<y> (the line down the left of tile x,y).
//
// A piece is drawn from a few blocks ("parts"): [x, y, z, w, d, h, colour, shape]. '$' as the colour is the colour the
// player picked. Shapes: none (a block), 'o' (round: a bush, a lampshade), 'c' (a standing cylinder), 'd' (a disc facing
// out: a clock, a washing-machine door), 's' (a screen), 'p' (where the photo goes), 'l' (it glows: a lamp), 'g' (glass).
//   floor pieces: x, y within their w×d footprint; turned 0 they stand with their back to the wall at the top (y = 0).
//   wall pieces:  x along the wall (left to right, facing it), y out from the wall, z up from the floor.
//   ceiling pieces: x, y within the tile, z up from the floor (so just under WALL_H).
// `r` is how a floor piece is turned (0–3 quarter turns); for a wall piece it is which wall of its tile it hangs on
// (0 top, 1 right, 2 bottom, 3 left).
import { BUILDING_TYPES } from './catalog.js';

export const WALL_H = 2.6, WALL_T = 0.06, EYE = 1.55;
export const TINTS = ['#C0392B', '#2E86C1', '#27AE60', '#8E44AD', '#E67E22', '#5D6D7E', '#E8C9A0', '#22313F', '#F1C40F', '#EC87C0'];
export const ROOM_CATS = [['living', '🛋️ Living'], ['bed', '🛏️ Bedroom'], ['kitchen', '🍳 Kitchen'], ['bath', '🛁 Bathroom'], ['walls', '🖼️ Walls & photos'], ['ceiling', '💡 Ceiling'], ['fun', '🎮 Fun'], ['plants', '🪴 Plants'], ['luxury', '💎 Luxury']];

const W = '#8B5A3C', WD = '#6B4428', MT = '#3B3B40', WH = '#F4F1EA', CH = '#BDC3C7', H = WALL_H;
const legs = (x0, y0, x1, y1, h, c = WD, t = 0.07) => [[x0, y0, 0, t, t, h, c], [x1 - t, y0, 0, t, t, h, c], [x0, y1 - t, 0, t, t, h, c], [x1 - t, y1 - t, 0, t, t, h, c]];
const lamp = (c = '#FFE2B0', i = 0.9, d = 4.5) => ({ c, i, d });
export const FURNITURE = {
  // ---------------- living room ----------------
  sofa: { name: 'Sofa', cat: 'living', size: [2, 1], cost: 4000, tint: true, parts: [[0, 0.1, 0, 2, 0.85, 0.42, '$'], [0, 0, 0, 2, 0.3, 0.95, '$'], [0, 0.1, 0, 0.25, 0.85, 0.62, '$'], [1.75, 0.1, 0, 0.25, 0.85, 0.62, '$'], [0.3, 0.32, 0.42, 0.65, 0.55, 0.1, '$'], [1.05, 0.32, 0.42, 0.65, 0.55, 0.1, '$']] },
  cornersofa: { name: 'Corner sofa', cat: 'living', size: [2, 2], cost: 7500, tint: true, parts: [[0, 0.1, 0, 2, 0.85, 0.42, '$'], [0, 0, 0, 2, 0.3, 0.95, '$'], [0, 0.95, 0, 0.9, 1.05, 0.42, '$'], [0, 0.1, 0, 0.3, 1.9, 0.95, '$'], [1.75, 0.1, 0, 0.25, 0.85, 0.62, '$'], [0, 1.75, 0, 0.9, 0.25, 0.62, '$']] },
  armchair: { name: 'Armchair', cat: 'living', size: [1, 1], cost: 1800, tint: true, parts: [[0.1, 0.15, 0, 0.8, 0.75, 0.42, '$'], [0.1, 0.08, 0, 0.8, 0.25, 0.95, '$'], [0.1, 0.15, 0, 0.18, 0.75, 0.62, '$'], [0.72, 0.15, 0, 0.18, 0.75, 0.62, '$']] },
  beanbag: { name: 'Beanbag', cat: 'living', size: [1, 1], cost: 700, tint: true, parts: [[0.12, 0.12, 0, 0.76, 0.76, 0.55, '$', 'o']] },
  coffeetable: { name: 'Coffee table', cat: 'living', size: [2, 1], cost: 1200, parts: [...legs(0.25, 0.25, 1.75, 0.8, 0.32), [0.2, 0.2, 0.32, 1.6, 0.65, 0.07, W], [0.5, 0.35, 0.39, 0.3, 0.2, 0.06, '#C0392B']] },
  tv: { name: 'TV and stand', cat: 'living', size: [2, 1], cost: 6000, parts: [[0.1, 0.05, 0, 1.8, 0.5, 0.45, MT], [0.35, 0.15, 0.45, 1.3, 0.08, 0.8, '#111418', 's'], [0.9, 0.12, 0.45, 0.2, 0.15, 0.05, MT]] },
  sideboard: { name: 'Sideboard', cat: 'living', size: [2, 1], cost: 2800, parts: [[0.05, 0.05, 0.1, 1.9, 0.5, 0.75, '#9B7048'], ...legs(0.1, 0.1, 1.9, 0.5, 0.1, MT, 0.05), [0.3, 0.2, 0.85, 0.25, 0.25, 0.35, '#2E86C1', 'c'], [1.3, 0.2, 0.85, 0.3, 0.2, 0.25, '#F4D03F']] },
  bookshelf: { name: 'Bookshelf', cat: 'living', size: [2, 1], cost: 2500, parts: [[0, 0, 0, 2, 0.4, 1.9, '#7A5233'], [0.1, 0.36, 0.25, 0.35, 0.05, 0.35, '#B03A2E'], [0.5, 0.36, 0.25, 0.4, 0.05, 0.32, '#1F618D'], [1.05, 0.36, 0.25, 0.3, 0.05, 0.36, '#D4AC0D'], [1.4, 0.36, 0.25, 0.45, 0.05, 0.3, '#117A65'],
    [0.1, 0.36, 0.95, 0.45, 0.05, 0.34, '#6C3483'], [0.6, 0.36, 0.95, 0.3, 0.05, 0.36, '#CA6F1E'], [1.0, 0.36, 0.95, 0.55, 0.05, 0.3, '#2E4053'], [0.15, 0.36, 1.5, 0.5, 0.05, 0.3, '#A93226'], [0.8, 0.36, 1.5, 0.35, 0.05, 0.33, '#196F3D']] },
  floorlamp: { name: 'Floor lamp', cat: 'living', size: [1, 1], cost: 900, light: lamp(), parts: [[0.33, 0.33, 0, 0.34, 0.34, 0.05, MT, 'c'], [0.47, 0.47, 0.05, 0.06, 0.06, 1.35, MT], [0.25, 0.25, 1.3, 0.5, 0.5, 0.38, '#F7E7B4', 'l']] },
  rug: { name: 'Rug', cat: 'living', size: [2, 2], cost: 1500, tint: true, rug: true, parts: [[0.1, 0.1, 0, 1.8, 1.8, 0.02, '$']] },
  roundrug: { name: 'Round rug', cat: 'living', size: [2, 2], cost: 1700, tint: true, rug: true, parts: [[0.1, 0.1, 0, 1.8, 1.8, 0.02, '$', 'c']] },
  bigrug: { name: 'Large rug', cat: 'living', size: [3, 2], cost: 2500, tint: true, rug: true, parts: [[0.1, 0.1, 0, 2.8, 1.8, 0.02, '$'], [0.35, 0.35, 0.02, 2.3, 1.3, 0.01, '#F2E8D5']] },
  sidetable: { name: 'Side table', cat: 'living', size: [1, 1], cost: 600, parts: [...legs(0.25, 0.25, 0.75, 0.75, 0.45), [0.2, 0.2, 0.45, 0.6, 0.6, 0.06, W], [0.4, 0.4, 0.51, 0.2, 0.2, 0.22, '#4A90A4', 'c']] },
  speakers: { name: 'Speakers', cat: 'living', size: [1, 1], cost: 2400, parts: [[0.05, 0.25, 0, 0.35, 0.4, 1.0, '#1C1C1E'], [0.6, 0.25, 0, 0.35, 0.4, 1.0, '#1C1C1E'], [0.12, 0.64, 0.55, 0.22, 0.02, 0.22, '#5D6D7E', 'd'], [0.67, 0.64, 0.55, 0.22, 0.02, 0.22, '#5D6D7E', 'd']] },
  fireplace: { name: 'Fireplace', cat: 'living', size: [2, 1], cost: 15000, light: lamp('#FF9F43', 1.1, 4), parts: [[0, 0, 0, 2, 0.5, 1.2, '#A9A39A'], [0.45, 0.4, 0.1, 1.1, 0.12, 0.65, '#2B2622'], [0.7, 0.44, 0.12, 0.6, 0.1, 0.35, '#F39C12', 'l'], [0.85, 0.46, 0.15, 0.3, 0.08, 0.3, '#F7DC6F', 'l'], [-0.05, 0, 1.2, 2.1, 0.6, 0.08, '#7B7468']] },
  // ---------------- bedroom ----------------
  bed: { name: 'Single bed', cat: 'bed', size: [1, 2], cost: 2500, tint: true, parts: [[0, 0, 0, 1, 2, 0.32, W], [0, 0, 0, 1, 0.14, 0.9, WD], [0.05, 0.14, 0.32, 0.9, 1.8, 0.14, WH], [0.15, 0.2, 0.46, 0.7, 0.3, 0.1, '#FFFFFF'], [0.04, 0.6, 0.46, 0.92, 1.36, 0.06, '$']] },
  doublebed: { name: 'Double bed', cat: 'bed', size: [2, 2], cost: 6000, tint: true, parts: [[0, 0, 0, 2, 2, 0.32, W], [0, 0, 0, 2, 0.14, 1.0, WD], [0.05, 0.14, 0.32, 1.9, 1.8, 0.14, WH], [0.15, 0.2, 0.46, 0.75, 0.3, 0.1, '#FFFFFF'], [1.1, 0.2, 0.46, 0.75, 0.3, 0.1, '#FFFFFF'], [0.04, 0.62, 0.46, 1.92, 1.34, 0.06, '$']] },
  bunkbed: { name: 'Bunk bed', cat: 'bed', size: [1, 2], cost: 4200, tint: true, parts: [...legs(0, 0, 1, 2, 1.9, W, 0.08), [0, 0, 0.15, 1, 2, 0.15, W], [0.05, 0.05, 0.3, 0.9, 1.9, 0.12, '$'], [0, 0, 1.15, 1, 2, 0.15, W], [0.05, 0.05, 1.3, 0.9, 1.9, 0.12, '$'], [0.15, 0.08, 1.42, 0.7, 0.3, 0.08, '#FFFFFF']] },
  cot: { name: 'Baby cot', cat: 'bed', size: [1, 1], cost: 1600, tint: true, parts: [...legs(0.1, 0.15, 0.9, 0.85, 0.85, '#F4F6F8', 0.05), [0.12, 0.17, 0.25, 0.76, 0.66, 0.1, '$'], [0.1, 0.15, 0.8, 0.8, 0.04, 0.05, '#F4F6F8'], [0.1, 0.81, 0.8, 0.8, 0.04, 0.05, '#F4F6F8']] },
  wardrobe: { name: 'Wardrobe', cat: 'bed', size: [2, 1], cost: 3500, parts: [[0, 0, 0, 2, 0.6, 2.0, '#9B7048'], [0.98, 0.6, 0.1, 0.04, 0.01, 1.8, WD], [0.85, 0.61, 0.9, 0.05, 0.03, 0.2, '#D4AC0D'], [1.1, 0.61, 0.9, 0.05, 0.03, 0.2, '#D4AC0D']] },
  nightstand: { name: 'Bedside table and lamp', cat: 'bed', size: [1, 1], cost: 900, light: lamp('#FFE2B0', 0.5, 3), parts: [[0.2, 0.1, 0, 0.6, 0.55, 0.5, W], [0.3, 0.64, 0.25, 0.4, 0.02, 0.04, '#D4AC0D'], [0.4, 0.25, 0.5, 0.2, 0.2, 0.08, MT, 'c'], [0.33, 0.18, 0.62, 0.34, 0.34, 0.26, '#F7E7B4', 'l']] },
  dresser: { name: 'Dresser with mirror', cat: 'bed', size: [2, 1], cost: 2200, parts: [[0.1, 0.05, 0, 1.8, 0.55, 0.85, '#B9875A'], [0.45, 0.04, 0.85, 1.1, 0.04, 1.0, WD], [0.5, 0.08, 0.9, 1.0, 0.02, 0.9, '#DDEFF8', 'g']] },
  desk: { name: 'Desk with laptop', cat: 'bed', size: [2, 1], cost: 2000, parts: [...legs(0.1, 0.1, 1.9, 0.8, 0.7), [0.05, 0.05, 0.7, 1.9, 0.8, 0.06, '#C8A87A'], [0.7, 0.25, 0.76, 0.6, 0.4, 0.03, '#BFC5CC'], [0.7, 0.2, 0.76, 0.6, 0.05, 0.4, '#1B2631', 's']] },
  chair: { name: 'Chair', cat: 'bed', size: [1, 1], cost: 500, tint: true, parts: [...legs(0.22, 0.22, 0.78, 0.78, 0.42), [0.2, 0.2, 0.42, 0.6, 0.6, 0.07, '$'], [0.2, 0.15, 0.42, 0.6, 0.08, 0.6, '$']] },
  officechair: { name: 'Office chair', cat: 'bed', size: [1, 1], cost: 1300, tint: true, parts: [[0.3, 0.3, 0, 0.4, 0.4, 0.06, MT, 'c'], [0.47, 0.47, 0.06, 0.06, 0.06, 0.38, MT], [0.2, 0.22, 0.44, 0.6, 0.6, 0.1, '$'], [0.22, 0.15, 0.5, 0.56, 0.1, 0.7, '$']] },
  shoerack: { name: 'Shoe rack', cat: 'bed', size: [1, 1], cost: 450, parts: [[0.1, 0.2, 0, 0.8, 0.4, 0.5, W], [0.18, 0.3, 0.5, 0.25, 0.2, 0.1, '#C0392B'], [0.55, 0.3, 0.5, 0.25, 0.2, 0.1, '#22313F']] },
  // ---------------- kitchen ----------------
  counter: { name: 'Kitchen counter', cat: 'kitchen', size: [1, 1], cost: 1500, parts: [[0, 0, 0, 1, 0.65, 0.88, '#E8E4DC'], [0, 0, 0.88, 1, 0.7, 0.06, '#4A4A4E'], [0.45, 0.66, 0.6, 0.1, 0.02, 0.04, MT]] },
  microwave: { name: 'Counter and microwave', cat: 'kitchen', size: [1, 1], cost: 2600, parts: [[0, 0, 0, 1, 0.65, 0.88, '#E8E4DC'], [0, 0, 0.88, 1, 0.7, 0.06, '#4A4A4E'], [0.15, 0.1, 0.94, 0.7, 0.45, 0.38, '#D5D8DC'], [0.2, 0.55, 0.98, 0.45, 0.01, 0.3, '#1B2631', 's']] },
  stove: { name: 'Cooker', cat: 'kitchen', size: [1, 1], cost: 3000, parts: [[0, 0, 0, 1, 0.65, 0.88, '#D5D8DC'], [0, 0, 0.88, 1, 0.68, 0.04, '#1C1C1E'], [0.15, 0.66, 0.15, 0.7, 0.02, 0.5, '#2C3E50', 'g'], [0.15, 0.12, 0.92, 0.3, 0.3, 0.02, '#922B21', 'c'], [0.55, 0.3, 0.92, 0.3, 0.3, 0.02, '#922B21', 'c']] },
  fridge: { name: 'Fridge', cat: 'kitchen', size: [1, 1], cost: 4500, parts: [[0.05, 0, 0, 0.9, 0.7, 1.9, '#DADDE2'], [0.05, 0.7, 1.15, 0.9, 0.01, 0.03, '#A6ACAF'], [0.8, 0.71, 1.3, 0.05, 0.04, 0.4, '#7F8C8D'], [0.8, 0.71, 0.6, 0.05, 0.04, 0.4, '#7F8C8D']] },
  sink: { name: 'Kitchen sink', cat: 'kitchen', size: [1, 1], cost: 1800, parts: [[0, 0, 0, 1, 0.65, 0.88, '#E8E4DC'], [0, 0, 0.88, 1, 0.7, 0.06, '#4A4A4E'], [0.2, 0.15, 0.9, 0.6, 0.4, 0.05, CH], [0.45, 0.05, 0.94, 0.1, 0.1, 0.3, '#95A5A6']] },
  dishwasher: { name: 'Dishwasher', cat: 'kitchen', size: [1, 1], cost: 3800, parts: [[0, 0, 0, 1, 0.65, 0.88, '#E5E8E8'], [0, 0, 0.88, 1, 0.7, 0.06, '#4A4A4E'], [0.1, 0.66, 0.75, 0.8, 0.03, 0.05, '#7F8C8D']] },
  washer: { name: 'Washing machine', cat: 'kitchen', size: [1, 1], cost: 4200, parts: [[0.05, 0.05, 0, 0.9, 0.65, 0.85, '#F4F6F8'], [0.25, 0.7, 0.18, 0.5, 0.03, 0.5, '#5D6D7E', 'd'], [0.32, 0.72, 0.25, 0.36, 0.02, 0.36, '#AED6F1', 'd']] },
  island: { name: 'Kitchen island', cat: 'kitchen', size: [2, 1], cost: 5200, tint: true, parts: [[0.1, 0.12, 0, 1.8, 0.75, 0.88, '$'], [0, 0.05, 0.88, 2, 0.9, 0.06, '#4A4A4E'], [0.4, 0.3, 0.94, 0.35, 0.3, 0.12, '#F5B041', 'c']] },
  diningtable: { name: 'Dining table', cat: 'kitchen', size: [2, 2], cost: 3500, parts: [...legs(0.3, 0.3, 1.7, 1.7, 0.7), [0.2, 0.2, 0.7, 1.6, 1.6, 0.07, W], [0.85, 0.85, 0.77, 0.3, 0.3, 0.12, '#F4D03F', 'c']] },
  barstool: { name: 'Bar stool', cat: 'kitchen', size: [1, 1], cost: 450, tint: true, parts: [[0.32, 0.32, 0, 0.36, 0.36, 0.04, MT, 'c'], [0.47, 0.47, 0.04, 0.06, 0.06, 0.7, MT], [0.27, 0.27, 0.74, 0.46, 0.46, 0.08, '$', 'c']] },
  bin: { name: 'Kitchen bin', cat: 'kitchen', size: [1, 1], cost: 150, parts: [[0.32, 0.32, 0, 0.36, 0.36, 0.6, CH, 'c']] },
  // ---------------- bathroom ----------------
  bathtub: { name: 'Bathtub', cat: 'bath', size: [2, 1], cost: 5000, parts: [[0, 0, 0, 2, 0.95, 0.55, '#F4F6F8'], [0.1, 0.1, 0.42, 1.8, 0.75, 0.1, '#A9D8EC'], [1.75, 0.35, 0.55, 0.12, 0.12, 0.25, CH]] },
  toilet: { name: 'Toilet', cat: 'bath', size: [1, 1], cost: 1200, parts: [[0.25, 0.05, 0, 0.5, 0.25, 0.85, '#F4F6F8'], [0.3, 0.3, 0, 0.4, 0.5, 0.4, '#F4F6F8'], [0.27, 0.28, 0.4, 0.46, 0.55, 0.05, '#E5E8E8']] },
  shower: { name: 'Shower', cat: 'bath', size: [1, 1], cost: 3500, parts: [[0, 0, 0, 1, 1, 0.08, '#E5E8E8'], [0.45, 0.05, 1.9, 0.1, 0.3, 0.06, '#95A5A6'], [0, 0.95, 0.08, 1, 0.04, 1.9, '#BEE1F0', 'g'], [0.95, 0, 0.08, 0.04, 1, 1.9, '#BEE1F0', 'g']] },
  basin: { name: 'Wash basin', cat: 'bath', size: [1, 1], cost: 1000, parts: [[0.4, 0.1, 0, 0.2, 0.2, 0.75, '#F4F6F8'], [0.2, 0.05, 0.75, 0.6, 0.45, 0.12, '#F4F6F8'], [0.45, 0.06, 0.87, 0.1, 0.1, 0.18, CH]] },
  vanity: { name: 'Double vanity', cat: 'bath', size: [2, 1], cost: 4600, parts: [[0.05, 0.05, 0, 1.9, 0.55, 0.8, '#5D6D7E'], [0, 0, 0.8, 2, 0.62, 0.05, WH], [0.3, 0.12, 0.83, 0.45, 0.35, 0.05, '#E5E8E8', 'c'], [1.25, 0.12, 0.83, 0.45, 0.35, 0.05, '#E5E8E8', 'c']] },
  hamper: { name: 'Laundry basket', cat: 'bath', size: [1, 1], cost: 250, tint: true, parts: [[0.3, 0.3, 0, 0.4, 0.4, 0.55, '$', 'c'], [0.33, 0.33, 0.55, 0.34, 0.34, 0.06, WH, 'c']] },
  bathmat: { name: 'Bath mat', cat: 'bath', size: [1, 1], cost: 200, tint: true, rug: true, parts: [[0.15, 0.2, 0, 0.7, 0.6, 0.02, '$']] },
  // ---------------- walls (and photo frames) ----------------
  frame: { name: 'Photo frame', cat: 'walls', mount: 'wall', size: [1, 0.06], cost: 300, tint: true, photo: true, parts: [[0.15, 0, 1.2, 0.7, 0.05, 0.56, '$'], [0.21, 0.04, 1.26, 0.58, 0.02, 0.44, '#DDDDDD', 'p']] },
  tallframe: { name: 'Tall photo frame', cat: 'walls', mount: 'wall', size: [1, 0.06], cost: 350, tint: true, photo: true, parts: [[0.24, 0, 1.0, 0.52, 0.05, 0.74, '$'], [0.3, 0.04, 1.06, 0.4, 0.02, 0.62, '#DDDDDD', 'p']] },
  bigframe: { name: 'Large photo frame', cat: 'walls', mount: 'wall', size: [2, 0.07], cost: 900, tint: true, photo: true, parts: [[0.15, 0, 0.95, 1.7, 0.06, 1.12, '$'], [0.23, 0.05, 1.03, 1.54, 0.02, 0.96, '#DDDDDD', 'p']] },
  canvas: { name: 'Photo canvas', cat: 'walls', mount: 'wall', size: [2, 0.06], cost: 1200, photo: true, parts: [[0.15, 0, 0.85, 1.7, 0.05, 1.28, '#EEEEEE'], [0.15, 0.05, 0.85, 1.7, 0.01, 1.28, '#DDDDDD', 'p']] },
  painting: { name: 'Painting', cat: 'walls', mount: 'wall', size: [1, 0.06], cost: 700, tint: true, parts: [[0.15, 0, 1.15, 0.7, 0.05, 0.6, '#C9A227'], [0.2, 0.04, 1.2, 0.6, 0.02, 0.5, '$'], [0.3, 0.06, 1.3, 0.2, 0.01, 0.2, '#F4F1EA', 'd'], [0.5, 0.06, 1.22, 0.25, 0.01, 0.15, '#22313F']] },
  clock: { name: 'Wall clock', cat: 'walls', mount: 'wall', size: [1, 0.05], cost: 400, parts: [[0.28, 0, 1.55, 0.44, 0.05, 0.44, MT, 'd'], [0.31, 0.03, 1.58, 0.38, 0.02, 0.38, '#F4F1EA', 'd'], [0.49, 0.06, 1.77, 0.02, 0.01, 0.15, '#111'], [0.49, 0.06, 1.76, 0.12, 0.01, 0.02, '#111']] },
  wallmirror: { name: 'Wall mirror', cat: 'walls', mount: 'wall', size: [1, 0.05], cost: 900, parts: [[0.2, 0, 0.85, 0.6, 0.04, 1.2, '#B9875A'], [0.25, 0.03, 0.9, 0.5, 0.02, 1.1, '#DDEFF8', 'g']] },
  shelf: { name: 'Wall shelf', cat: 'walls', mount: 'wall', size: [2, 0.3], cost: 600, parts: [[0.1, 0, 1.4, 1.8, 0.28, 0.04, W], [0.2, 0.05, 1.44, 0.12, 0.2, 0.3, '#B03A2E'], [0.34, 0.05, 1.44, 0.12, 0.2, 0.26, '#1F618D'], [0.48, 0.05, 1.44, 0.1, 0.2, 0.32, '#D4AC0D'], [1.3, 0.05, 1.44, 0.25, 0.2, 0.18, '#B8643C', 'c'], [1.27, 0.03, 1.6, 0.3, 0.25, 0.25, '#3E8E41', 'o']] },
  walltv: { name: 'Wall TV', cat: 'walls', mount: 'wall', size: [2, 0.08], cost: 7500, parts: [[0.15, 0, 1.05, 1.7, 0.07, 0.98, '#111418', 's']] },
  sconce: { name: 'Wall light', cat: 'walls', mount: 'wall', size: [1, 0.25], cost: 500, light: lamp('#FFE2B0', 0.5, 3), parts: [[0.42, 0, 1.75, 0.16, 0.06, 0.2, MT], [0.47, 0.04, 1.82, 0.06, 0.12, 0.04, MT], [0.37, 0.1, 1.75, 0.26, 0.2, 0.24, '#F7E7B4', 'l']] },
  aircon: { name: 'Air conditioner', cat: 'walls', mount: 'wall', size: [2, 0.3], cost: 3200, parts: [[0.25, 0, 2.05, 1.5, 0.28, 0.36, '#F4F6F8'], [0.35, 0.27, 2.08, 1.3, 0.02, 0.06, '#BDC3C7']] },
  radiator: { name: 'Radiator', cat: 'walls', mount: 'wall', size: [1, 0.12], cost: 650, parts: [[0.1, 0, 0.18, 0.8, 0.1, 0.55, '#F4F6F8'], [0.15, 0.1, 0.2, 0.04, 0.02, 0.5, '#E5E8E8'], [0.35, 0.1, 0.2, 0.04, 0.02, 0.5, '#E5E8E8'], [0.55, 0.1, 0.2, 0.04, 0.02, 0.5, '#E5E8E8'], [0.75, 0.1, 0.2, 0.04, 0.02, 0.5, '#E5E8E8']] },
  cupboards: { name: 'Wall cupboards', cat: 'walls', mount: 'wall', size: [1, 0.36], cost: 1100, parts: [[0, 0, 1.5, 1, 0.35, 0.75, '#E8E4DC'], [0.49, 0.35, 1.52, 0.02, 0.01, 0.7, '#B3B6B7'], [0.4, 0.36, 1.58, 0.05, 0.02, 0.15, MT], [0.55, 0.36, 1.58, 0.05, 0.02, 0.15, MT]] },
  hood: { name: 'Cooker hood', cat: 'walls', mount: 'wall', size: [1, 0.5], cost: 1400, parts: [[0.1, 0, 1.55, 0.8, 0.5, 0.15, CH], [0.35, 0, 1.7, 0.3, 0.3, 0.9, CH]] },
  bathcabinet: { name: 'Bathroom cabinet', cat: 'walls', mount: 'wall', size: [1, 0.2], cost: 800, parts: [[0.2, 0, 1.3, 0.6, 0.18, 0.6, '#F4F6F8'], [0.24, 0.18, 1.34, 0.52, 0.01, 0.52, '#DDEFF8', 'g']] },
  towelrail: { name: 'Towel rail', cat: 'walls', mount: 'wall', size: [1, 0.12], cost: 300, tint: true, parts: [[0.15, 0.06, 1.15, 0.7, 0.04, 0.04, CH], [0.2, 0.03, 0.62, 0.6, 0.07, 0.55, '$']] },
  coathooks: { name: 'Coat hooks', cat: 'walls', mount: 'wall', size: [1, 0.2], cost: 350, tint: true, parts: [[0.1, 0, 1.6, 0.8, 0.04, 0.12, W], [0.15, 0.04, 0.95, 0.28, 0.16, 0.68, '$'], [0.55, 0.04, 1.05, 0.28, 0.14, 0.58, '#5D6D7E']] },
  wallplant: { name: 'Hanging wall plant', cat: 'walls', mount: 'wall', size: [1, 0.35], cost: 450, parts: [[0.35, 0, 1.45, 0.3, 0.25, 0.25, '#B8643C', 'c'], [0.2, 0.02, 1.05, 0.6, 0.33, 0.6, '#3E8E41', 'o']] },
  dartboard: { name: 'Dartboard', cat: 'walls', mount: 'wall', size: [1, 0.06], cost: 550, parts: [[0.27, 0, 1.45, 0.46, 0.05, 0.46, '#1E1E1E', 'd'], [0.34, 0.05, 1.52, 0.32, 0.01, 0.32, '#C0392B', 'd'], [0.44, 0.06, 1.62, 0.12, 0.01, 0.12, '#27AE60', 'd']] },
  wallguitar: { name: 'Guitar on the wall', cat: 'walls', mount: 'wall', size: [1, 0.12], cost: 2200, tint: true, parts: [[0.3, 0.02, 0.95, 0.4, 0.1, 0.5, '$', 'd'], [0.46, 0.04, 1.4, 0.08, 0.05, 0.7, '#3E2723'], [0.44, 0.03, 2.08, 0.12, 0.05, 0.14, '#3E2723']] },
  neon: { name: 'Neon sign', cat: 'walls', mount: 'wall', size: [2, 0.05], cost: 2600, tint: true, light: lamp('$', 0.6, 3.5), parts: [[0.2, 0, 1.55, 1.6, 0.03, 0.42, '#1C1C1E'], [0.3, 0.03, 1.62, 0.5, 0.02, 0.06, '$', 'l'], [0.3, 0.03, 1.62, 0.06, 0.02, 0.28, '$', 'l'], [0.9, 0.03, 1.62, 0.06, 0.02, 0.28, '$', 'l'], [0.9, 0.03, 1.84, 0.6, 0.02, 0.06, '$', 'l'], [1.44, 0.03, 1.62, 0.06, 0.02, 0.28, '$', 'l']] },
  curtains: { name: 'Curtains', cat: 'walls', mount: 'window', size: [1, 0.12], cost: 600, tint: true, parts: [[0.0, 0.07, 0.25, 0.24, 0.07, 2.05, '$'], [0.76, 0.07, 0.25, 0.24, 0.07, 2.05, '$'], [-0.05, 0.1, 2.3, 1.1, 0.03, 0.03, MT]] },
  blinds: { name: 'Window blind', cat: 'walls', mount: 'window', size: [1, 0.08], cost: 450, tint: true, parts: [[0.04, 0.04, 1.55, 0.92, 0.03, 0.5, '$'], [0.02, 0.03, 2.05, 0.96, 0.06, 0.06, WH]] },
  // ---------------- ceiling ----------------
  ceilinglight: { name: 'Ceiling light', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 400, light: lamp('#FFF4DC', 0.9, 6), parts: [[0.3, 0.3, H - 0.1, 0.4, 0.4, 0.1, '#FFF8E7', 'l']] },
  pendant: { name: 'Pendant lamp', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 900, tint: true, light: lamp('#FFE2B0', 0.9, 5), parts: [[0.48, 0.48, 2.12, 0.04, 0.04, H - 2.12, MT], [0.3, 0.3, 1.92, 0.4, 0.4, 0.22, '$', 'c'], [0.4, 0.4, 1.89, 0.2, 0.2, 0.06, '#FFF4DC', 'l']] },
  spotlights: { name: 'Spotlights', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 700, light: lamp('#FFFFFF', 0.8, 5), parts: [[0.15, 0.45, H - 0.06, 0.12, 0.12, 0.06, '#FFFFFF', 'l'], [0.45, 0.45, H - 0.06, 0.12, 0.12, 0.06, '#FFFFFF', 'l'], [0.75, 0.45, H - 0.06, 0.12, 0.12, 0.06, '#FFFFFF', 'l']] },
  fan: { name: 'Ceiling fan', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 1500, parts: [[0.47, 0.47, 2.25, 0.06, 0.06, H - 2.25, MT], [0.4, 0.4, 2.15, 0.2, 0.2, 0.14, CH, 'c'], [0, 0.45, 2.22, 1, 0.1, 0.02, W], [0.45, 0, 2.22, 0.1, 1, 0.02, W]] },
  smokealarm: { name: 'Smoke alarm', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 150, parts: [[0.4, 0.4, H - 0.05, 0.2, 0.2, 0.05, '#FFFFFF', 'c'], [0.48, 0.48, H - 0.06, 0.04, 0.04, 0.01, '#E74C3C']] },
  hangingplant: { name: 'Hanging basket', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 500, parts: [[0.49, 0.49, 1.9, 0.02, 0.02, H - 1.9, MT], [0.32, 0.32, 1.7, 0.36, 0.36, 0.2, '#B8643C', 'c'], [0.2, 0.2, 1.45, 0.6, 0.6, 0.45, '#3E8E41', 'o']] },
  discoball: { name: 'Disco ball', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 2500, light: lamp('#C39BD3', 0.8, 5), parts: [[0.49, 0.49, 2.3, 0.02, 0.02, H - 2.3, MT], [0.3, 0.3, 1.9, 0.4, 0.4, 0.4, '#E5E7E9', 'o']] },
  chandelier: { name: 'Chandelier', cat: 'ceiling', mount: 'ceil', size: [1, 1], cost: 25000, light: lamp('#FFE9B8', 1.4, 7), parts: [[0.48, 0.48, 2.42, 0.04, 0.04, H - 2.42, '#C9A227'], [0.18, 0.18, 2.08, 0.64, 0.64, 0.36, '#F7DC6F', 'o'], [0.05, 0.45, 2.12, 0.9, 0.1, 0.04, '#C9A227'], [0.45, 0.05, 2.12, 0.1, 0.9, 0.04, '#C9A227'], [0.32, 0.32, 1.95, 0.36, 0.36, 0.16, '#FFF4DC', 'l']] },
  // ---------------- fun ----------------
  arcade: { name: 'Arcade machine', cat: 'fun', size: [1, 1], cost: 12000, tint: true, parts: [[0.15, 0.1, 0, 0.7, 0.65, 1.75, '$'], [0.22, 0.72, 0.95, 0.56, 0.04, 0.5, '#0B1A2E', 's'], [0.2, 0.72, 0.75, 0.6, 0.12, 0.08, MT], [0.15, 0.1, 1.75, 0.7, 0.65, 0.05, '#F1C40F', 'l']] },
  gaming: { name: 'Gaming setup', cat: 'fun', size: [2, 1], cost: 9500, tint: true, light: lamp('$', 0.5, 3), parts: [...legs(0.1, 0.1, 1.9, 0.8, 0.72, MT), [0.05, 0.05, 0.72, 1.9, 0.8, 0.05, '#1C1C1E'], [0.05, 0.75, 0.7, 1.9, 0.04, 0.03, '$', 'l'], [0.3, 0.12, 0.77, 0.65, 0.05, 0.42, '#0B1A2E', 's'], [1.05, 0.12, 0.77, 0.65, 0.05, 0.42, '#0B1A2E', 's'], [0.6, 0.45, 0.77, 0.8, 0.22, 0.03, '#2C3E50']] },
  pooltable: { name: 'Pool table', cat: 'fun', size: [3, 2], cost: 16000, parts: [...legs(0.3, 0.3, 2.7, 1.7, 0.7, '#5E3A21', 0.15), [0.15, 0.15, 0.7, 2.7, 1.7, 0.12, '#5E3A21'], [0.25, 0.25, 0.8, 2.5, 1.5, 0.03, '#1E8449'], [0.6, 0.9, 0.83, 0.08, 0.08, 0.08, '#F4F6F8', 'o'], [1.9, 0.8, 0.83, 0.08, 0.08, 0.08, '#C0392B', 'o'], [2.0, 0.95, 0.83, 0.08, 0.08, 0.08, '#F1C40F', 'o']] },
  treadmill: { name: 'Treadmill', cat: 'fun', size: [1, 2], cost: 6500, parts: [[0.15, 0.2, 0, 0.7, 1.7, 0.18, '#2C3E50'], [0.2, 0.25, 0.18, 0.6, 1.5, 0.02, '#1C1C1E'], [0.15, 0.1, 0, 0.06, 0.15, 1.3, MT], [0.79, 0.1, 0, 0.06, 0.15, 1.3, MT], [0.15, 0.08, 1.2, 0.7, 0.2, 0.15, '#34495E']] },
  bike: { name: 'Exercise bike', cat: 'fun', size: [1, 1], cost: 3800, tint: true, parts: [[0.4, 0.1, 0, 0.2, 0.8, 0.08, MT], [0.45, 0.6, 0.08, 0.1, 0.1, 0.65, '$'], [0.35, 0.55, 0.73, 0.3, 0.25, 0.08, '#1C1C1E'], [0.45, 0.15, 0.08, 0.1, 0.1, 0.85, '$'], [0.3, 0.12, 0.9, 0.4, 0.06, 0.05, MT], [0.42, 0.3, 0.15, 0.16, 0.3, 0.3, MT, 'd']] },
  drums: { name: 'Drum kit', cat: 'fun', size: [2, 2], cost: 7000, tint: true, parts: [[0.6, 0.2, 0, 0.8, 0.5, 0.65, '$', 'd'], [0.25, 0.8, 0, 0.45, 0.45, 0.5, '$', 'c'], [1.3, 0.8, 0, 0.45, 0.45, 0.55, '$', 'c'], [0.7, 0.8, 0.6, 0.3, 0.3, 0.2, '$', 'c'], [0.1, 0.25, 0.95, 0.4, 0.4, 0.02, '#F1C40F', 'c'], [1.5, 0.25, 1.05, 0.4, 0.4, 0.02, '#F1C40F', 'c'], [0.25, 0.35, 0, 0.04, 0.04, 0.95, MT], [1.68, 0.43, 0, 0.04, 0.04, 1.05, MT]] },
  guitar: { name: 'Guitar on a stand', cat: 'fun', size: [1, 1], cost: 2000, tint: true, parts: [[0.35, 0.4, 0, 0.3, 0.2, 0.08, MT], [0.3, 0.42, 0.08, 0.4, 0.12, 0.5, '$', 'd'], [0.46, 0.45, 0.55, 0.08, 0.05, 0.6, '#3E2723']] },
  piano: { name: 'Piano', cat: 'fun', size: [2, 1], cost: 18000, parts: [[0.1, 0, 0, 1.8, 0.55, 1.25, '#1D1B1E'], [0.15, 0.55, 0.7, 1.7, 0.25, 0.08, '#F5F5F0'], [0.15, 0.55, 0.0, 0.12, 0.25, 0.7, '#1D1B1E'], [1.73, 0.55, 0.0, 0.12, 0.25, 0.7, '#1D1B1E']] },
  fishtank: { name: 'Fish tank', cat: 'fun', size: [2, 1], cost: 8000, parts: [[0.1, 0.1, 0, 1.8, 0.55, 0.6, '#2C3E50'], [0.1, 0.1, 0.6, 1.8, 0.55, 0.7, '#5FB7E0', 'g'], [0.5, 0.4, 0.85, 0.2, 0.05, 0.1, '#F39C12'], [1.2, 0.4, 1.0, 0.18, 0.05, 0.08, '#E74C3C'], [0.3, 0.2, 0.6, 0.2, 0.2, 0.35, '#27AE60', 'o']] },
  toybox: { name: 'Toy box', cat: 'fun', size: [1, 1], cost: 400, tint: true, parts: [[0.15, 0.2, 0, 0.7, 0.55, 0.45, '$'], [0.2, 0.3, 0.45, 0.2, 0.2, 0.2, '#F1C40F', 'o'], [0.5, 0.35, 0.45, 0.22, 0.22, 0.22, '#E74C3C']] },
  catbed: { name: 'Pet bed', cat: 'fun', size: [1, 1], cost: 600, tint: true, parts: [[0.15, 0.15, 0, 0.7, 0.7, 0.18, '$', 'c'], [0.25, 0.25, 0.12, 0.5, 0.5, 0.06, '#F2E8D5', 'c']] },
  mirror: { name: 'Standing mirror', cat: 'fun', size: [1, 1], cost: 1500, parts: [[0.3, 0.1, 0, 0.4, 0.3, 0.06, WD], [0.3, 0.12, 0.06, 0.4, 0.06, 1.6, '#B9875A'], [0.34, 0.15, 0.12, 0.32, 0.04, 1.45, '#D6EAF8', 'g']] },
  // ---------------- plants ----------------
  plant: { name: 'Pot plant', cat: 'plants', size: [1, 1], cost: 400, parts: [[0.32, 0.32, 0, 0.36, 0.36, 0.32, '#B8643C', 'c'], [0.17, 0.17, 0.3, 0.66, 0.66, 0.6, '#3E8E41', 'o']] },
  palm: { name: 'Indoor palm', cat: 'plants', size: [1, 1], cost: 900, parts: [[0.3, 0.3, 0, 0.4, 0.4, 0.4, '#E5E0D8', 'c'], [0.46, 0.46, 0.4, 0.08, 0.08, 0.7, '#7D6608'], [0.05, 0.05, 0.9, 0.9, 0.9, 0.7, '#2E8B57', 'o']] },
  flowers: { name: 'Flower pot', cat: 'plants', size: [1, 1], cost: 350, parts: [[0.35, 0.35, 0, 0.3, 0.3, 0.28, '#5D6D7E', 'c'], [0.25, 0.25, 0.28, 0.5, 0.5, 0.35, '#E84393', 'o']] },
  cactus: { name: 'Cactus', cat: 'plants', size: [1, 1], cost: 300, parts: [[0.35, 0.35, 0, 0.3, 0.3, 0.25, '#D35400', 'c'], [0.4, 0.4, 0.25, 0.2, 0.2, 0.75, '#27AE60', 'c'], [0.28, 0.46, 0.5, 0.14, 0.08, 0.25, '#27AE60', 'c']] },
  bonsai: { name: 'Bonsai', cat: 'plants', size: [1, 1], cost: 1200, parts: [[0.25, 0.3, 0.4, 0.5, 0.4, 0.12, '#5D6D7E'], ...legs(0.3, 0.32, 0.7, 0.68, 0.4, WD, 0.05), [0.47, 0.47, 0.52, 0.06, 0.06, 0.25, '#6E2C00'], [0.25, 0.3, 0.7, 0.5, 0.4, 0.3, '#1E8449', 'o']] },
  vase: { name: 'Tall vase', cat: 'plants', size: [1, 1], cost: 650, tint: true, parts: [[0.35, 0.35, 0, 0.3, 0.3, 0.8, '$', 'c'], [0.3, 0.3, 0.8, 0.4, 0.4, 0.4, '#F5B7B1', 'o']] },
  // ---------------- luxury ----------------
  grandpiano: { name: 'Grand piano', cat: 'luxury', size: [2, 2], cost: 75000, parts: [[0.15, 0.15, 0, 0.12, 0.12, 0.7, '#1D1B1E'], [1.7, 0.15, 0, 0.12, 0.12, 0.7, '#1D1B1E'], [0.9, 1.6, 0, 0.12, 0.12, 0.7, '#1D1B1E'], [0.1, 0.1, 0.7, 1.8, 1.7, 0.3, '#1D1B1E'], [0.15, 1.55, 0.75, 1.7, 0.2, 0.06, '#F5F5F0'], [0.1, 0.1, 1.0, 1.8, 0.9, 0.05, '#2C2A2E']] },
  hottub: { name: 'Hot tub', cat: 'luxury', size: [2, 2], cost: 90000, parts: [[0, 0, 0, 2, 2, 0.75, '#7E5A3C'], [0.15, 0.15, 0.62, 1.7, 1.7, 0.12, '#48C9B0'], [0.6, 0.6, 0.74, 0.8, 0.8, 0.01, '#A3E4D7']] },
  trophies: { name: 'Trophy cabinet', cat: 'luxury', size: [1, 1], cost: 9000, parts: [[0.05, 0, 0, 0.9, 0.5, 1.9, '#5E3A21'], [0.12, 0.45, 0.1, 0.76, 0.06, 1.7, '#D6EAF8', 'g'], [0.35, 0.2, 1.2, 0.3, 0.2, 0.4, '#F1C40F', 'c'], [0.3, 0.2, 0.55, 0.4, 0.2, 0.35, '#D4AC0D']] },
  grandclock: { name: 'Grandfather clock', cat: 'luxury', size: [1, 1], cost: 12000, parts: [[0.25, 0.25, 0, 0.5, 0.4, 2.0, '#5E3A21'], [0.3, 0.64, 1.45, 0.4, 0.02, 0.4, '#F4F1EA', 'd'], [0.35, 0.64, 0.4, 0.3, 0.02, 0.8, '#D6EAF8', 'g'], [0.47, 0.66, 0.5, 0.06, 0.02, 0.5, '#C9A227']] },
  throne: { name: 'Golden throne', cat: 'luxury', size: [1, 1], cost: 60000, parts: [[0.1, 0.15, 0, 0.8, 0.75, 0.45, '#C0392B'], [0.1, 0.05, 0, 0.8, 0.2, 1.7, '#F1C40F'], [0.05, 0.15, 0, 0.15, 0.75, 0.75, '#F1C40F'], [0.8, 0.15, 0, 0.15, 0.75, 0.75, '#F1C40F'], [0.4, 0.05, 1.7, 0.2, 0.15, 0.2, '#C0392B', 'o']] },
  statue: { name: 'Gold statue', cat: 'luxury', size: [1, 1], cost: 150000, parts: [[0.2, 0.2, 0, 0.6, 0.6, 0.45, '#ECE6DA'], [0.35, 0.35, 0.45, 0.3, 0.3, 0.75, '#F1C40F', 'c'], [0.3, 0.3, 1.15, 0.4, 0.4, 0.4, '#F4D03F', 'o']] },
  aquarium: { name: 'Big aquarium', cat: 'luxury', size: [3, 1], cost: 45000, parts: [[0, 0, 0, 3, 0.6, 0.5, '#1B2631'], [0, 0, 0.5, 3, 0.6, 1.3, '#3498DB', 'g'], [0.6, 0.3, 0.9, 0.25, 0.05, 0.12, '#F39C12'], [1.7, 0.35, 1.2, 0.2, 0.05, 0.1, '#E74C3C'], [2.3, 0.3, 0.7, 0.22, 0.05, 0.1, '#F7DC6F'], [0.2, 0.15, 0.5, 0.3, 0.3, 0.5, '#1E8449', 'o']] },
  winerack: { name: 'Wine rack', cat: 'luxury', size: [1, 1], cost: 5500, parts: [[0.1, 0.1, 0, 0.8, 0.4, 1.6, '#5E3A21'], [0.18, 0.46, 0.2, 0.12, 0.05, 0.12, '#641E16', 'd'], [0.44, 0.46, 0.2, 0.12, 0.05, 0.12, '#641E16', 'd'], [0.7, 0.46, 0.2, 0.12, 0.05, 0.12, '#641E16', 'd'], [0.18, 0.46, 0.6, 0.12, 0.05, 0.12, '#641E16', 'd'], [0.44, 0.46, 0.6, 0.12, 0.05, 0.12, '#1D8348', 'd'], [0.7, 0.46, 1.0, 0.12, 0.05, 0.12, '#641E16', 'd']] },
};
for (const f of Object.values(FURNITURE)) f.mount ||= 'floor';

export const FLOORS = { wood: { name: 'Oak boards', a: '#C8A273', b: '#BC9466', cost: 0, planks: true }, walnut: { name: 'Walnut', a: '#7B5536', b: '#6F4B2F', cost: 1500, planks: true }, tiles: { name: 'White tiles', a: '#EEF0F2', b: '#DCE0E4', cost: 1500 },
  marble: { name: 'Marble', a: '#F2EFEA', b: '#E3DED6', cost: 6000 }, carpet: { name: 'Blue carpet', a: '#4D6E9E', b: '#47679A', cost: 1200, soft: true }, rose: { name: 'Rose carpet', a: '#B7787E', b: '#AE7076', cost: 1200, soft: true },
  cream: { name: 'Cream carpet', a: '#E8DCC4', b: '#E2D5BB', cost: 1200, soft: true }, slate: { name: 'Slate', a: '#5D6670', b: '#535C66', cost: 2000 }, check: { name: 'Black & white', a: '#F4F4F2', b: '#2B2B2E', cost: 2500 }, terracotta: { name: 'Terracotta', a: '#C26A43', b: '#B5603B', cost: 1800 } };
export const WALLS = { cream: { name: 'Cream', c: '#EFE6D2', cost: 0 }, white: { name: 'White', c: '#F7F7F5', cost: 500 }, sage: { name: 'Sage', c: '#C9D6BF', cost: 800 }, sky: { name: 'Sky blue', c: '#C7DCEB', cost: 800 },
  blush: { name: 'Blush', c: '#EBCFCB', cost: 800 }, sun: { name: 'Sunshine', c: '#F3DE9A', cost: 800 }, lilac: { name: 'Lilac', c: '#D7CBE6', cost: 800 }, mint: { name: 'Mint', c: '#C8EBDD', cost: 800 },
  navy: { name: 'Navy', c: '#34495E', cost: 1500 }, charcoal: { name: 'Charcoal', c: '#4A4E54', cost: 1500 }, brick: { name: 'Brick', c: '#B0634A', cost: 2000, brick: true }, wood: { name: 'Wood panels', c: '#A47551', cost: 2500, panels: true } };
export const RESALE = 0.5, MAX_ITEMS = 150, MAX_STORED = 80, MAX_PHOTOS = 40, PHOTO_BYTES = 350 * 1024;

// How big the house is, by the kind of home: a tent is cosy, a big house roomy.
export function roomSize(type) {
  const t = BUILDING_TYPES[type]; if (!t || !t.home) return 0;
  if (t.style === 'tent' || type === 'tent') return 4;
  const [w, d] = t.size, cap = t.home.capacity || 1, area = w * d;
  if (cap >= 6) return 5; // a flat in a block
  if (area >= 9) return 8; return area >= 4 ? 6 : 5;
}

// ---------------- the floor plan ----------------
const PLANS = new Map();
export function layoutOf(S) {
  if (PLANS.has(S)) return PLANS.get(S);
  const E = new Map(), rooms = [], set = (k, t) => E.set(k, t);
  for (let i = 0; i < S; i++) { set(`h${i},0`, 'wall'); set(`h${i},${S}`, 'wall'); set(`v0,${i}`, 'wall'); set(`v${S},${i}`, 'wall'); }
  const hline = (y, x0, x1, doors = []) => { for (let x = x0; x < x1; x++) set(`h${x},${y}`, doors.includes(x) ? 'door' : 'wall'); };
  const vline = (x, y0, y1, doors = []) => { for (let y = y0; y < y1; y++) set(`v${x},${y}`, doors.includes(y) ? 'door' : 'wall'); };
  const win = (...ks) => ks.forEach(k => set(k, 'window')), room = (name, kind, x, y, w, d) => rooms.push({ name, kind, x, y, w, d });
  if (S <= 4) { room('Main room', 'living', 0, 0, S, S); set(`h1,${S}`, 'front'); win('h2,0', 'v0,1', `v${S},2`); }
  else if (S === 5) {
    room('Bedroom', 'bed', 0, 0, 3, 2); room('Bathroom', 'bath', 3, 0, 2, 2); room('Living room & kitchen', 'living', 0, 2, 5, 3);
    hline(2, 0, 5, [1, 3]); vline(3, 0, 2); set('h3,5', 'front'); win('h1,0', 'h4,0', 'v0,3', 'v5,3', 'h1,5');
  } else if (S <= 7) {
    room('Bedroom', 'bed', 0, 0, 4, 3); room('Bathroom', 'bath', 4, 0, 2, 3); room('Living room', 'living', 0, 3, 4, 3); room('Kitchen', 'kitchen', 4, 3, 2, 3);
    hline(3, 0, 6, [1, 4]); vline(4, 0, 3); vline(4, 3, 6, [4]); set('h1,6', 'front'); win('h1,0', 'h2,0', 'h5,0', 'v0,4', 'v6,4', 'h3,6', 'h5,6');
  } else {
    room('Bedroom', 'bed', 0, 0, 4, 3); room('Bathroom', 'bath', 4, 0, 2, 3); room('Second bedroom', 'bed', 6, 0, 2, 3); room('Living room', 'living', 0, 3, 5, 5); room('Kitchen', 'kitchen', 5, 3, 3, 5);
    hline(3, 0, 8, [1, 4, 6]); vline(4, 0, 3); vline(6, 0, 3); vline(5, 3, 8, [4, 5]); set('h2,8', 'front'); win('h1,0', 'h2,0', 'h4,0', 'h6,0', 'h7,0', 'v0,5', 'v0,6', 'h4,8', 'v8,5', 'h6,8');
  }
  // tiles right inside a doorway stay clear so you can always walk through
  const keep = new Set();
  for (const [k, t] of E) { if (t !== 'door' && t !== 'front') continue; const [a, b] = k.slice(1).split(',').map(Number);
    if (k[0] === 'h') { if (b > 0) keep.add(`${a},${b - 1}`); if (b < S) keep.add(`${a},${b}`); } else { if (a > 0) keep.add(`${a - 1},${b}`); if (a < S) keep.add(`${a},${b}`); } }
  const L = { S, rooms, edges: E, keep }; PLANS.set(S, L); return L;
}
export const roomAt = (S, x, y) => layoutOf(S).rooms.findIndex(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d);
const DEFAULT_STYLE = { living: ['wood', 'cream'], bed: ['cream', 'sky'], bath: ['tiles', 'white'], kitchen: ['tiles', 'cream'] };
export function styleOf(room, S, i) {
  const r = layoutOf(S).rooms[i], d = DEFAULT_STYLE[r?.kind] || DEFAULT_STYLE.living, s = (room?.styles || {})[i] || {};
  return { f: FLOORS[s.f] ? s.f : d[0], w: WALLS[s.w] ? s.w : d[1] };
}

// ---------------- where a piece goes ----------------
export const footOf = (k, r) => { const f = FURNITURE[k] || {}, s = f.size || [1, 1]; if (f.mount === 'wall' || f.mount === 'window') return [Math.round(s[0]), 1]; return r % 2 ? [s[1], s[0]] : [s[0], s[1]]; };
// A floor piece's parts turned r quarter-turns (clockwise seen from above), within its turned footprint.
export function partsOf(k, r = 0) {
  const f = FURNITURE[k]; if (!f) return []; let [w, d] = f.size, parts = f.parts.map(p => p.slice());
  if (f.mount !== 'floor') return parts;
  for (let i = 0; i < ((r % 4) + 4) % 4; i++) { parts = parts.map(([x, y, z, pw, pd, h, c, s]) => [d - (y + pd), x, z, pd, pw, h, c, s]); [w, d] = [d, w]; }
  return parts;
}
// The wall faces a wall piece covers: for each tile it spans, the edge it hangs on, and the face's name.
export function wallSpots(k, x, y, r) {
  const n = footOf(k, r)[0], out = [];
  for (let j = 0; j < n; j++) { const tx = r % 2 ? x : x + j, ty = r % 2 ? y + j : y;
    const edge = r === 0 ? `h${tx},${ty}` : r === 1 ? `v${tx + 1},${ty}` : r === 2 ? `h${tx},${ty + 1}` : `v${tx},${ty}`; out.push({ tx, ty, edge, face: `${tx},${ty},${r}` }); }
  return out;
}
// Every part of a placed piece in house coordinates: { x, y, z, w, d, h, c, s }, plus `out` (the way a wall piece faces).
export function placedParts(it, tint) {
  const f = FURNITURE[it.k]; if (!f) return [];
  const col = c => (c === '$' ? tint : c);
  if (f.mount === 'wall' || f.mount === 'window') {
    const n = footOf(it.k, it.r)[0], r = it.r, T = WALL_T, o = r === 0 ? [0, 1] : r === 1 ? [-1, 0] : r === 2 ? [0, -1] : [1, 0];
    const ox = r === 0 ? it.x : r === 1 ? it.x + 1 : r === 2 ? it.x + n : it.x, oy = r === 0 ? it.y : r === 1 ? it.y : r === 2 ? it.y + 1 : it.y + n;
    return f.parts.map(([px, py, z, pw, pd, h, c, s]) => { const q = py + T;
      const b = r === 0 ? [ox + px, oy + q, pw, pd] : r === 2 ? [ox - (px + pw), oy - (q + pd), pw, pd] : r === 1 ? [ox - (q + pd), oy + px, pd, pw] : [ox + q, oy - (px + pw), pd, pw];
      return { x: b[0], y: b[1], z, w: b[2], d: b[3], h, c: col(c), s, out: o }; });
  }
  return partsOf(it.k, it.r).map(([px, py, z, pw, pd, h, c, s]) => ({ x: it.x + px, y: it.y + py, z, w: pw, d: pd, h, c: col(c), s }));
}
export function photoAspect(k) { const p = (FURNITURE[k]?.parts || []).find(p => p[7] === 'p'); return p ? p[3] / p[5] : 4 / 3; }

// Is there room for piece k at (x, y), turned (or on wall) r, in a house of `size`, leaving out the piece `skip`?
export function placeProblem(room, size, k, x, y, r, skip = null) {
  const f = FURNITURE[k]; if (!f) return 'There’s no such piece.';
  if (![x, y, r].every(Number.isInteger) || r < 0 || r > 3) return 'That isn’t a spot in the house.';
  const L = layoutOf(size), others = (room.items || []).filter(it => it.i !== skip && FURNITURE[it.k]);
  if (f.mount === 'wall' || f.mount === 'window') {
    const want = f.mount === 'window' ? 'window' : 'wall', spots = wallSpots(k, x, y, r);
    for (const s of spots) { if (s.tx < 0 || s.ty < 0 || s.tx >= size || s.ty >= size) return 'It doesn’t fit there.';
      const t = L.edges.get(s.edge); if (t !== want) return f.mount === 'window' ? 'Curtains and blinds go on a window.' : t === 'window' ? 'That’s a window. Pick a plain wall.' : t ? 'That’s a doorway. Pick a plain wall.' : 'There’s no wall there.'; }
    const used = new Set(); for (const it of others) { const o = FURNITURE[it.k]; if (o.mount === 'wall' || o.mount === 'window') for (const s of wallSpots(it.k, it.x, it.y, it.r)) used.add(s.face); }
    if (spots.some(s => used.has(s.face))) return 'Something’s already hanging there.';
    return null;
  }
  const [w, d] = footOf(k, r); if (x < 0 || y < 0 || x + w > size || y + d > size) return 'It doesn’t fit there.';
  if (f.mount === 'ceil') { for (const it of others) { if (FURNITURE[it.k].mount !== 'ceil') continue; const [ow, od] = footOf(it.k, it.r);
      if (x < it.x + ow && it.x < x + w && y < it.y + od && it.y < y + d) return 'There’s already something on the ceiling there.'; } return null; }
  for (let i = x + 1; i < x + w; i++) for (let j = y; j < y + d; j++) if (L.edges.has(`v${i},${j}`)) return 'A wall is in the way.';
  for (let j = y + 1; j < y + d; j++) for (let i = x; i < x + w; i++) if (L.edges.has(`h${i},${j}`)) return 'A wall is in the way.';
  if (!f.rug) for (let i = x; i < x + w; i++) for (let j = y; j < y + d; j++) if (L.keep.has(`${i},${j}`)) return 'Keep the doorway clear.';
  for (const it of others) { const o = FURNITURE[it.k]; if (o.mount !== 'floor' || !!o.rug !== !!f.rug) continue; const [ow, od] = footOf(it.k, it.r);
    if (x < it.x + ow && it.x < x + w && y < it.y + od && it.y < y + d) return 'Something’s already there.'; }
  return null;
}
// A room as stored, made safe and fitted to the house the colonist lives in now: anything that no longer fits (they
// moved somewhere smaller, or the plan is different) is packed into their storage instead of being lost.
const PHOTO_ID = /^[A-Za-z0-9_-]{6,24}$/;
const tintOf = it => (Number.isInteger(it?.c) && it.c >= 0 && it.c < TINTS.length ? it.c : 0);
const keepPhoto = (k, ph) => (FURNITURE[k]?.photo && PHOTO_ID.test(String(ph || '')) ? String(ph) : undefined);
export function fitRoom(raw, size) {
  const L = layoutOf(size), styles = {};
  for (const [i, s] of Object.entries(raw?.styles || {})) if (L.rooms[i] && s && (FLOORS[s.f] || WALLS[s.w])) styles[i] = { ...(FLOORS[s.f] ? { f: s.f } : {}), ...(WALLS[s.w] ? { w: s.w } : {}) };
  const room = { styles, items: [], box: [] }; let changed = false;
  const toBox = p => { changed = true; if (room.box.length < MAX_STORED) room.box.push({ i: p.i, k: p.k, c: p.c, ...(p.ph ? { ph: p.ph } : {}) }); };
  for (const it of Array.isArray(raw?.box) ? raw.box : []) if (FURNITURE[it?.k] && room.box.length < MAX_STORED) room.box.push({ i: String(it.i), k: it.k, c: tintOf(it), ...(keepPhoto(it.k, it.ph) ? { ph: keepPhoto(it.k, it.ph) } : {}) });
  for (const it of Array.isArray(raw?.items) ? raw.items : []) { if (!FURNITURE[it?.k]) { changed = true; continue; }
    const p = { i: String(it.i), k: it.k, x: it.x, y: it.y, r: it.r || 0, c: tintOf(it) }, ph = keepPhoto(it.k, it.ph); if (ph) p.ph = ph;
    if (room.items.length < MAX_ITEMS && !placeProblem(room, size, p.k, p.x, p.y, p.r)) room.items.push(p); else toBox(p); }
  return { room, changed };
}
export const resaleOf = k => Math.floor((FURNITURE[k]?.cost || 0) * RESALE);
export const photosIn = room => new Set([...(room.items || []), ...(room.box || [])].map(it => it.ph).filter(Boolean));
