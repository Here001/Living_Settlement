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
export const BIZ_CATS = [['shop', '🏪 Shop'], ['food', '🍽️ Food & drink'], ['office', '💼 Office'], ['industry', '🏭 Workshop']];
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
  // ---------------- for businesses: shop, food and drink, office, workshop ----------------
  till: { name: 'Counter with till', cat: 'shop', size: [2, 1], cost: 2500, tint: true, parts: [[0, 0.15, 0, 2, 0.7, 0.95, '$'], [0, 0.1, 0.95, 2, 0.8, 0.05, '#4A4A4E'], [1.3, 0.25, 1.0, 0.45, 0.35, 0.2, '#2C3E50'], [1.35, 0.25, 1.2, 0.35, 0.05, 0.22, '#0E1622', 's']] },
  shelves: { name: 'Shop shelves', cat: 'shop', size: [2, 1], cost: 1800, parts: [[0, 0, 0, 2, 0.5, 1.8, '#D5D8DC'], ...[0.25, 0.75, 1.25, 1.65].flatMap((z, i) => [[0.08, 0.42, z - 0.22, 0.4, 0.1, 0.2, ['#E74C3C', '#F1C40F', '#2E86C1', '#27AE60'][i]], [0.6, 0.42, z - 0.22, 0.45, 0.1, 0.18, ['#F39C12', '#8E44AD', '#E67E22', '#16A085'][i]], [1.15, 0.42, z - 0.22, 0.35, 0.1, 0.2, ['#2ECC71', '#C0392B', '#F5B041', '#3498DB'][i]], [1.55, 0.42, z - 0.22, 0.35, 0.1, 0.16, ['#9B59B6', '#1ABC9C', '#E74C3C', '#F4D03F'][i]]])] },
  fridgecase: { name: 'Drinks fridge', cat: 'shop', size: [1, 1], cost: 3800, light: lamp('#E8F8FF', 0.4, 2.5), parts: [[0.05, 0, 0, 0.9, 0.7, 1.95, '#2C3E50'], [0.1, 0.68, 0.1, 0.8, 0.03, 1.75, '#CFE9F7', 'g'], [0.15, 0.2, 0.3, 0.7, 0.4, 0.25, '#E74C3C'], [0.15, 0.2, 0.75, 0.7, 0.4, 0.25, '#F1C40F'], [0.15, 0.2, 1.2, 0.7, 0.4, 0.25, '#27AE60'], [0.1, 0.05, 1.8, 0.8, 0.6, 0.12, '#F4F6F8', 'l']] },
  display: { name: 'Display counter', cat: 'shop', size: [2, 1], cost: 4200, parts: [[0, 0.1, 0, 2, 0.75, 0.6, '#5D6D7E'], [0, 0.1, 0.6, 2, 0.75, 0.45, '#D6EAF8', 'g'], [0.3, 0.35, 0.62, 0.3, 0.3, 0.15, '#F5B041', 'c'], [0.9, 0.35, 0.62, 0.35, 0.25, 0.12, '#E59866'], [1.45, 0.35, 0.62, 0.3, 0.3, 0.18, '#F7DC6F', 'c']] },
  clothesrack: { name: 'Clothes rail', cat: 'shop', size: [2, 1], cost: 1600, tint: true, parts: [[0.1, 0.45, 0, 0.06, 0.06, 1.6, CH], [1.84, 0.45, 0, 0.06, 0.06, 1.6, CH], [0.1, 0.46, 1.55, 1.8, 0.04, 0.04, CH], [0.25, 0.3, 0.75, 0.35, 0.4, 0.78, '$'], [0.65, 0.3, 0.75, 0.35, 0.4, 0.78, '#F4F6F8'], [1.05, 0.3, 0.75, 0.35, 0.4, 0.78, '$'], [1.45, 0.3, 0.75, 0.3, 0.4, 0.78, '#22313F']] },
  mannequin: { name: 'Mannequin', cat: 'shop', size: [1, 1], cost: 900, tint: true, parts: [[0.35, 0.35, 0, 0.3, 0.3, 0.05, '#BDC3C7', 'c'], [0.48, 0.48, 0.05, 0.04, 0.04, 0.75, CH], [0.32, 0.4, 0.8, 0.36, 0.22, 0.6, '$'], [0.4, 0.43, 1.42, 0.2, 0.16, 0.22, '#F5E6D3', 'o']] },
  atm: { name: 'Cash machine', cat: 'shop', size: [1, 1], cost: 6500, parts: [[0.15, 0.05, 0, 0.7, 0.6, 1.6, '#5D6D7E'], [0.25, 0.64, 1.05, 0.5, 0.02, 0.35, '#0E1622', 's'], [0.3, 0.64, 0.8, 0.4, 0.06, 0.12, '#2C3E50'], [0.15, 0.05, 1.6, 0.7, 0.6, 0.1, '#2E86C1', 'l']] },
  vending: { name: 'Vending machine', cat: 'shop', size: [1, 1], cost: 5000, tint: true, light: lamp('#EAF2F8', 0.35, 2), parts: [[0.05, 0.05, 0, 0.9, 0.65, 1.85, '$'], [0.12, 0.68, 0.6, 0.55, 0.03, 1.1, '#D6EAF8', 'g'], [0.72, 0.68, 1.1, 0.18, 0.03, 0.35, '#0E1622', 's'], [0.2, 0.3, 0.75, 0.45, 0.35, 0.8, '#F5B041']] },
  cafetable: { name: 'Café table for two', cat: 'food', size: [1, 1], cost: 900, tint: true, parts: [[0.4, 0.4, 0, 0.2, 0.2, 0.05, MT, 'c'], [0.47, 0.47, 0.05, 0.06, 0.06, 0.68, MT], [0.25, 0.25, 0.73, 0.5, 0.5, 0.04, '#F4F1EA', 'c'], [0.02, 0.38, 0, 0.22, 0.24, 0.45, '$'], [0.76, 0.38, 0, 0.22, 0.24, 0.45, '$']] },
  tablefour: { name: 'Table for four', cat: 'food', size: [2, 2], cost: 2800, tint: true, parts: [...legs(0.45, 0.45, 1.55, 1.55, 0.72), [0.4, 0.4, 0.72, 1.2, 1.2, 0.05, W], [0.6, 0.05, 0, 0.8, 0.3, 0.45, '$'], [0.6, 1.65, 0, 0.8, 0.3, 0.45, '$'], [0.05, 0.6, 0, 0.3, 0.8, 0.45, '$'], [1.65, 0.6, 0, 0.3, 0.8, 0.45, '$'], [0.85, 0.85, 0.77, 0.3, 0.3, 0.1, '#F5B041', 'c']] },
  booth: { name: 'Restaurant booth', cat: 'food', size: [2, 2], cost: 5200, tint: true, parts: [[0, 0, 0, 2, 0.5, 1.1, '$'], [0, 1.5, 0, 2, 0.5, 1.1, '$'], [0, 0.1, 0, 2, 0.55, 0.45, '$'], [0, 1.35, 0, 2, 0.55, 0.45, '$'], [0.3, 0.75, 0.72, 1.4, 0.5, 0.05, '#F4F1EA'], [0.95, 0.85, 0, 0.1, 0.3, 0.72, MT]] },
  bar: { name: 'Bar counter', cat: 'food', size: [2, 1], cost: 6000, tint: true, parts: [[0, 0.2, 0, 2, 0.65, 1.05, '$'], [-0.02, 0.1, 1.05, 2.04, 0.85, 0.06, '#5E3A21'], [0.2, 0.3, 1.11, 0.12, 0.12, 0.25, '#1D8348', 'c'], [0.5, 0.3, 1.11, 0.12, 0.12, 0.28, '#641E16', 'c'], [1.4, 0.4, 1.11, 0.15, 0.15, 0.15, '#F4F6F8', 'c'], [0, 0.85, 0.15, 2, 0.04, 0.05, CH]] },
  coffee: { name: 'Coffee machine', cat: 'food', size: [1, 1], cost: 4800, parts: [[0, 0, 0, 1, 0.65, 0.88, '#E8E4DC'], [0, 0, 0.88, 1, 0.7, 0.06, '#4A4A4E'], [0.15, 0.1, 0.94, 0.7, 0.45, 0.5, '#BDC3C7'], [0.3, 0.45, 1.05, 0.12, 0.12, 0.12, '#F4F6F8', 'c'], [0.6, 0.45, 1.05, 0.12, 0.12, 0.12, '#F4F6F8', 'c'], [0.2, 0.15, 1.44, 0.6, 0.35, 0.06, '#7F8C8D']] },
  pizzaoven: { name: 'Pizza oven', cat: 'food', size: [1, 1], cost: 7500, light: lamp('#FF8C42', 0.7, 3), parts: [[0.05, 0.05, 0, 0.9, 0.85, 0.9, '#A04000'], [0.05, 0.05, 0.9, 0.9, 0.85, 0.55, '#B9770E', 'o'], [0.3, 0.88, 0.95, 0.4, 0.04, 0.3, '#1B1B1B'], [0.38, 0.86, 0.98, 0.24, 0.03, 0.15, '#FF8C42', 'l']] },
  fryer: { name: 'Kitchen fryer', cat: 'food', size: [1, 1], cost: 3200, parts: [[0, 0, 0, 1, 0.7, 0.9, CH], [0.1, 0.1, 0.9, 0.35, 0.5, 0.05, '#F5B041'], [0.55, 0.1, 0.9, 0.35, 0.5, 0.05, '#F5B041'], [0.2, 0.2, 0.95, 0.12, 0.3, 0.25, MT]] },
  officedesk: { name: 'Office desk', cat: 'office', size: [2, 1], cost: 2600, tint: true, parts: [...legs(0.05, 0.1, 1.95, 0.85, 0.72, MT), [0, 0.05, 0.72, 2, 0.85, 0.05, '#ECE6DA'], [0.6, 0.15, 0.77, 0.8, 0.06, 0.45, '#1B2631', 's'], [0.9, 0.21, 0.77, 0.2, 0.15, 0.06, MT], [0.65, 0.45, 0.77, 0.6, 0.2, 0.03, '#2C3E50'], [0.7, 1.05, 0, 0.55, 0.55, 0.45, '$'], [0.72, 1.48, 0.45, 0.5, 0.08, 0.55, '$']] },
  reception: { name: 'Reception desk', cat: 'office', size: [2, 1], cost: 5500, tint: true, parts: [[0, 0.3, 0, 2, 0.6, 1.1, '$'], [0, 0.25, 1.1, 2, 0.7, 0.05, '#ECE6DA'], [0, 0, 0.72, 2, 0.35, 0.05, '#ECE6DA'], [1.2, 0.05, 0.77, 0.6, 0.06, 0.35, '#1B2631', 's']] },
  filing: { name: 'Filing cabinet', cat: 'office', size: [1, 1], cost: 900, parts: [[0.2, 0.1, 0, 0.6, 0.6, 1.3, '#7F8C8D'], [0.4, 0.71, 0.25, 0.2, 0.02, 0.04, '#D5D8DC'], [0.4, 0.71, 0.65, 0.2, 0.02, 0.04, '#D5D8DC'], [0.4, 0.71, 1.05, 0.2, 0.02, 0.04, '#D5D8DC']] },
  meeting: { name: 'Meeting table', cat: 'office', size: [3, 2], cost: 7800, tint: true, parts: [[1.35, 0.85, 0, 0.3, 0.3, 0.72, MT], [0.3, 0.45, 0.72, 2.4, 1.1, 0.06, '#5E3A21'], ...[0.4, 1.3, 2.2].flatMap(x => [[x, 0.05, 0, 0.45, 0.35, 0.45, '$'], [x, 1.6, 0, 0.45, 0.35, 0.45, '$']])] },
  printer: { name: 'Printer', cat: 'office', size: [1, 1], cost: 1500, parts: [[0.15, 0.15, 0, 0.7, 0.6, 0.6, '#E5E8E8'], [0.15, 0.15, 0.6, 0.7, 0.6, 0.35, '#F4F6F8'], [0.25, 0.7, 0.75, 0.5, 0.08, 0.04, '#FFFFFF'], [0.6, 0.3, 0.95, 0.2, 0.15, 0.02, '#2E86C1', 'l']] },
  watercooler: { name: 'Water cooler', cat: 'office', size: [1, 1], cost: 700, parts: [[0.3, 0.3, 0, 0.4, 0.4, 1.0, '#F4F6F8'], [0.33, 0.33, 1.0, 0.34, 0.34, 0.45, '#AED6F1', 'c']] },
  waiting: { name: 'Waiting chairs', cat: 'office', size: [2, 1], cost: 1400, tint: true, parts: [[0.1, 0.3, 0, 1.8, 0.1, 0.42, MT], ...[0.1, 0.72, 1.34].flatMap(x => [[x, 0.25, 0.42, 0.56, 0.55, 0.08, '$'], [x, 0.18, 0.42, 0.56, 0.08, 0.55, '$']])] },
  workbench: { name: 'Workbench', cat: 'industry', size: [2, 1], cost: 2200, parts: [...legs(0.05, 0.1, 1.95, 0.85, 0.85, MT, 0.08), [0, 0.05, 0.85, 2, 0.85, 0.08, '#A0522D'], [0.3, 0.3, 0.93, 0.4, 0.2, 0.15, '#C0392B'], [1.2, 0.25, 0.93, 0.5, 0.35, 0.08, '#7F8C8D'], [0.1, 0.1, 0.25, 1.8, 0.75, 0.04, '#A0522D']] },
  machine: { name: 'Factory machine', cat: 'industry', size: [2, 2], cost: 18000, tint: true, light: lamp('#58D68D', 0.4, 2.5), parts: [[0.1, 0.1, 0, 1.8, 1.8, 1.4, '$'], [0.3, 1.9, 0.9, 0.5, 0.04, 0.35, '#0E1622', 's'], [1.0, 1.9, 1.0, 0.12, 0.04, 0.12, '#2ECC71', 'l'], [1.2, 1.9, 1.0, 0.12, 0.04, 0.12, '#E74C3C', 'l'], [0.6, 0.6, 1.4, 0.8, 0.8, 0.5, '#7F8C8D', 'c'], [1.3, 0.2, 1.4, 0.3, 0.3, 0.9, '#5D6D7E', 'c']] },
  conveyor: { name: 'Conveyor belt', cat: 'industry', size: [3, 1], cost: 9000, parts: [...legs(0.1, 0.25, 2.9, 0.75, 0.75, MT, 0.08), [0, 0.2, 0.75, 3, 0.6, 0.12, '#1C1C1E'], [0.3, 0.3, 0.87, 0.4, 0.4, 0.3, '#B9770E'], [1.3, 0.3, 0.87, 0.4, 0.4, 0.3, '#B9770E'], [2.3, 0.3, 0.87, 0.4, 0.4, 0.3, '#B9770E']] },
  crates: { name: 'Stack of crates', cat: 'industry', size: [1, 1], cost: 500, parts: [[0.05, 0.05, 0, 0.6, 0.6, 0.6, '#B9770E'], [0.35, 0.3, 0, 0.6, 0.6, 0.6, '#A0522D'], [0.15, 0.15, 0.6, 0.6, 0.6, 0.6, '#B9770E']] },
  pallet: { name: 'Pallet of boxes', cat: 'industry', size: [1, 1], cost: 600, parts: [[0.05, 0.05, 0, 0.9, 0.9, 0.12, '#C19A6B'], [0.1, 0.1, 0.12, 0.8, 0.8, 0.9, '#D4A373'], [0.1, 0.5, 0.12, 0.8, 0.01, 0.9, '#A57C52']] },
  racking: { name: 'Warehouse racking', cat: 'industry', size: [2, 1], cost: 3500, parts: [[0, 0, 0, 0.08, 0.9, 2.3, '#2E86C1'], [1.92, 0, 0, 0.08, 0.9, 2.3, '#2E86C1'], ...[0.1, 0.9, 1.7].flatMap(z => [[0, 0, z, 2, 0.9, 0.06, '#E67E22'], [0.15, 0.1, z + 0.06, 0.8, 0.7, 0.55, '#D4A373'], [1.05, 0.1, z + 0.06, 0.8, 0.7, 0.5, '#C19A6B']])] },
  forklift: { name: 'Forklift', cat: 'industry', size: [1, 2], cost: 14000, parts: [[0.1, 0.5, 0.15, 0.8, 1.3, 0.75, '#F1C40F'], [0.15, 0.9, 0.9, 0.7, 0.6, 0.06, '#1C1C1E'], ...[[0.1, 0.45], [0.75, 0.45], [0.1, 1.55], [0.75, 1.55]].map(([x, y]) => [x, y, 0, 0.15, 0.3, 0.3, '#1C1C1E', 'd']), [0.1, 0.4, 0, 0.06, 0.06, 2.0, MT], [0.84, 0.4, 0, 0.06, 0.06, 2.0, MT], [0.1, 0.4, 2.0, 0.8, 0.06, 0.06, MT], [0.2, 0, 0.1, 0.12, 0.45, 0.04, MT], [0.68, 0, 0.1, 0.12, 0.45, 0.04, MT]] },
  barrels: { name: 'Barrels', cat: 'industry', size: [1, 1], cost: 700, tint: true, parts: [[0.05, 0.05, 0, 0.45, 0.45, 0.85, '$', 'c'], [0.5, 0.45, 0, 0.45, 0.45, 0.85, '#2C3E50', 'c']] },
  // business walls: a sign for your logo, menus, a whiteboard, an OPEN sign, tools
  logo: { name: 'Company sign (your logo)', cat: 'office', mount: 'wall', size: [2, 0.06], cost: 1500, photo: true, parts: [[0.1, 0, 1.35, 1.8, 0.05, 0.9, '#1C1C1E'], [0.15, 0.05, 1.4, 1.7, 0.01, 0.8, '#DDDDDD', 'p']] },
  menuboard: { name: 'Menu board', cat: 'food', mount: 'wall', size: [2, 0.06], cost: 900, photo: true, parts: [[0.15, 0, 1.3, 1.7, 0.05, 1.0, '#5E3A21'], [0.2, 0.05, 1.35, 1.6, 0.01, 0.9, '#DDDDDD', 'p']] },
  bottleshelf: { name: 'Bottle shelf', cat: 'food', mount: 'wall', size: [2, 0.3], cost: 1600, parts: [[0.05, 0, 1.3, 1.9, 0.28, 0.04, '#5E3A21'], [0.05, 0, 1.75, 1.9, 0.28, 0.04, '#5E3A21'], ...[0.15, 0.4, 0.65, 0.9, 1.15, 1.4, 1.65].flatMap((x, i) => [[x, 0.08, 1.34, 0.1, 0.1, 0.3, ['#1D8348', '#641E16', '#D4AC0D', '#1D8348', '#7B241C', '#E59866', '#1D8348'][i], 'c'], [x + 0.05, 0.08, 1.79, 0.1, 0.1, 0.28, ['#641E16', '#1D8348', '#7B241C', '#D4AC0D', '#1D8348', '#641E16', '#E59866'][i], 'c']])] },
  whiteboard: { name: 'Whiteboard', cat: 'office', mount: 'wall', size: [2, 0.05], cost: 800, parts: [[0.1, 0, 0.95, 1.8, 0.04, 1.0, '#BDC3C7'], [0.14, 0.03, 0.99, 1.72, 0.02, 0.92, '#FDFEFE'], [0.3, 0.05, 1.5, 0.6, 0.01, 0.04, '#2E86C1'], [0.3, 0.05, 1.35, 0.9, 0.01, 0.04, '#E74C3C'], [0.3, 0.05, 1.2, 0.5, 0.01, 0.04, '#27AE60']] },
  opensign: { name: 'OPEN sign', cat: 'shop', mount: 'wall', size: [1, 0.05], cost: 700, light: lamp('#FF3B6B', 0.5, 2.5), parts: [[0.15, 0, 1.55, 0.7, 0.03, 0.3, '#1C1C1E'], [0.2, 0.03, 1.6, 0.6, 0.02, 0.2, '#FF3B6B', 'l']] },
  toolwall: { name: 'Tool wall', cat: 'industry', mount: 'wall', size: [2, 0.12], cost: 1300, parts: [[0.1, 0, 1.0, 1.8, 0.03, 1.0, '#C19A6B'], [0.3, 0.03, 1.3, 0.08, 0.06, 0.5, '#C0392B'], [0.6, 0.03, 1.4, 0.25, 0.06, 0.08, MT], [0.6, 0.03, 1.2, 0.06, 0.06, 0.3, '#7F8C8D'], [1.0, 0.03, 1.25, 0.3, 0.06, 0.3, '#F39C12', 'd'], [1.45, 0.03, 1.2, 0.08, 0.06, 0.55, '#2C3E50']] },
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

const hashStr = s => { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const rngOf = seed => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
// How big the inside is, by the home: the better the home (its rent) and the taller the building, the more room.
// A tent is 4×4; cottages 5–6; houses 7–8; flats in blocks 8–10; towers 10–11; the sky residences and luxury towers 12–14.
export function roomSize(type) {
  const t = BUILDING_TYPES[type]; if (!t || !t.home) return 0;
  if (t.style === 'tent' || type === 'tent') return 4;
  const rent = t.home.rent || 0, base = rent <= 3 ? 5 : rent <= 5 ? 6 : rent <= 9 ? 7 : rent <= 12 ? 8 : rent <= 15 ? 9 : rent <= 20 ? 10 : rent <= 45 ? 12 : 13;
  return Math.min(14, base + (rent > 3 ? hashStr(type) % 2 : 0) + ((t.height || 0) >= 100 ? 1 : 0));
}
export const homePlan = type => 'h:' + type;

// ---------------- the floor plan ----------------
// A home's own plan, the same every time for the same kind of home: the living room across the front (with the front
// door), a kitchen beside it (and a dining room in bigger homes), and behind, bedrooms and bathrooms side by side, some
// with an ensuite, a study or a dressing room behind them. Every room has a door to the next, and windows on the outside.
function homeLayout(S, type, set, addRoom, win) {
  const r = rngOf(hashStr(type + ':' + S)), pick = a => a[Math.floor(r() * a.length)], cells = Array.from({ length: S }, () => Array(S).fill(-1)), rooms = [];
  const room = (name, kind, x, y, w, d) => { const i = rooms.length; rooms.push({ name, kind, x, y, w, d }); for (let a = x; a < x + w; a++) for (let b = y; b < y + d; b++) cells[a][b] = i; return i; };
  const doors = new Set(), door = k => doors.add(k);
  if (S <= 4) { room('Main room', 'living', 0, 0, S, S); set(`h${Math.floor(S / 2) - 1},${S}`, 'front'); }
  else {
    // the front: living room, with the kitchen (and dining room) to one side
    const fd = Math.max(2, Math.min(S - 2, Math.round(S * (0.4 + r() * 0.12)))), y0 = S - fd, left = r() < 0.5;
    const kw = S >= 6 ? Math.max(2, Math.min(4, Math.round(S * (0.26 + r() * 0.08)))) : 0, dw = S >= 10 ? Math.max(2, Math.min(4, Math.round(S * 0.22))) : 0, lw = S - kw - dw;
    let x = 0; const parts = left ? [['k', kw], ['d', dw], ['l', lw]] : [['l', lw], ['d', dw], ['k', kw]], ids = {};
    for (const [k, w] of parts) { if (!w) continue; ids[k] = room(k === 'l' ? 'Living room' : k === 'k' ? 'Kitchen' : 'Dining room', k === 'l' ? 'living' : k === 'k' ? 'kitchen' : 'dining', x, y0, w, fd); x += w; }
    const L = rooms[ids.l], my = y0 + Math.floor(fd / 2);
    if (ids.d != null) { const D = rooms[ids.d]; door(left ? `v${D.x + D.w},${my}` : `v${D.x},${my}`); const K = rooms[ids.k]; door(left ? `v${K.x + K.w},${y0 + fd - 1}` : `v${K.x},${y0 + fd - 1}`); }
    else if (ids.k != null) { const K = rooms[ids.k]; door(left ? `v${K.x + K.w},${my}` : `v${K.x},${my}`); }
    set(`h${L.x + Math.floor(r() * L.w)},${S}`, 'front');
    // the back: columns of rooms, each opening onto the front rooms; the deep ones have a second room behind
    const bh = y0, widths = []; let left2 = S - 2; /* a 2-wide bathroom, and the rest in bedroom columns */
    while (left2 > 0) { const w = left2 <= 5 ? left2 : Math.max(3, Math.min(left2 - 3, 3 + Math.floor(r() * (S >= 10 ? 3 : 2)))); widths.push(w); left2 -= w; }
    const narrowest = Math.floor(r() * (widths.length + 1)); widths.splice(narrowest, 0, 2); let bx = 0, beds = 0, baths = 0;
    widths.forEach((w, i) => {
      const isBath = i === narrowest || (S >= 11 && baths < 2 && w === 2 && r() < 0.4), stack = bh >= 4 && w >= 2 && r() < 0.75, fh = stack ? Math.min(bh - 2, Math.max(2, Math.ceil(bh / 2) + (r() < 0.5 ? 0 : 1))) : bh; /* a room behind is at least 2 deep */
      const kind = isBath ? 'bath' : 'bed', name = isBath ? (baths++ ? 'Second bathroom' : 'Bathroom') : (beds++ ? (beds === 2 ? 'Second bedroom' : 'Bedroom ' + beds) : 'Main bedroom');
      const front = room(name, kind, bx, bh - fh, w, fh);
      const under = []; for (let a = bx; a < bx + w; a++) if (cells[a][bh] >= 0) under.push(a);
      const nearL = under.filter(a => cells[a][bh] === ids.l), dx = (nearL.length ? nearL : under)[Math.floor((nearL.length ? nearL : under).length / 2)]; door(`h${dx},${bh}`);
      if (stack) { const names = (S >= 9 ? ['Ensuite', 'Study', 'Dressing room', 'Guest room', 'Playroom'] : ['Ensuite', 'Study', 'Guest room']).filter(n => !rooms.some(q => q.name === n)), back = room(isBath ? 'Storeroom' : pick(names.length ? names : ['Box room']), isBath ? 'store' : 'extra', bx, 0, w, bh - fh);
        const R = rooms[back]; if (R.name === 'Ensuite') R.kind = 'bath'; else if (R.name === 'Study') R.kind = 'study'; else if (R.name === 'Dressing room') R.kind = 'closet'; else if (R.kind === 'extra') R.kind = 'bed';
        door(`h${bx + Math.floor(w / 2)},${bh - fh}`); }
      bx += w; });
  }
  // walls between rooms (doorways where a door was chosen), and the rooms in order
  for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { if (a + 1 < S && cells[a][b] !== cells[a + 1][b]) set(`v${a + 1},${b}`, doors.has(`v${a + 1},${b}`) ? 'door' : 'wall'); if (b + 1 < S && cells[a][b] !== cells[a][b + 1]) set(`h${a},${b + 1}`, doors.has(`h${a},${b + 1}`) ? 'door' : 'wall'); }
  for (const R of rooms) addRoom(R.name, R.kind, R.x, R.y, R.w, R.d);
  // windows: every other tile of outside wall, so every room facing out gets daylight
  for (let a = 0; a < S; a += 2) win(`h${a},0`);
  for (let a = 0; a < S; a += 2) { win(`v0,${a}`); win(`v${S},${a}`); }
  for (let a = 1; a < S; a += 2) win(`h${a},${S}`);
}
const PLANS = new Map();
export function layoutOf(S, plan = 'home') {
  const key = S + ':' + plan; if (PLANS.has(key)) return PLANS.get(key);
  const E = new Map(), rooms = [], set = (k, t) => E.set(k, t);
  for (let i = 0; i < S; i++) { set(`h${i},0`, 'wall'); set(`h${i},${S}`, 'wall'); set(`v0,${i}`, 'wall'); set(`v${S},${i}`, 'wall'); }
  const hline = (y, x0, x1, doors = []) => { for (let x = x0; x < x1; x++) set(`h${x},${y}`, doors.includes(x) ? 'door' : 'wall'); };
  const vline = (x, y0, y1, doors = []) => { for (let y = y0; y < y1; y++) set(`v${x},${y}`, doors.includes(y) ? 'door' : 'wall'); };
  const win = (...ks) => ks.forEach(k => { if (E.get(k) !== 'front') set(k, 'window'); }), room = (name, kind, x, y, w, d) => rooms.push({ name, kind, x, y, w, d });
  if (plan.startsWith('h:')) homeLayout(S, plan.slice(2), set, room, win);
  else if (plan !== 'home') {
    // a business: the main floor at the front, and along the back an office, a storeroom and a staff toilet
    const back = S >= 10 ? 3 : 2, mid = Math.max(2, Math.floor((S - 2) / 2)), main = { shop: 'Shop floor', food: 'Dining room', office: 'Office floor', industry: 'Factory floor' }[plan] || 'Main hall';
    room('Office', 'office', 0, 0, mid, back); room('Storeroom', 'store', mid, 0, S - 2 - mid, back); room('Staff toilet', 'toilet', S - 2, 0, 2, back); room(main, 'main', 0, back, S, S - back);
    hline(back, 0, S, [1, mid + 1, S - 1]); vline(mid, 0, back); vline(S - 2, 0, back);
    const door = Math.floor(S / 2) - 1; set(`h${door},${S}`, 'front');
    for (let x = 0; x < S; x++) if (x !== door && x % 2 === 0) win(`h${x},${S}`); for (let y = back + 1; y < S; y += 2) win(`v0,${y}`, `v${S},${y}`); win(`h1,0`);
  } else if (S <= 4) { room('Main room', 'living', 0, 0, S, S); set(`h1,${S}`, 'front'); win('h2,0', 'v0,1', `v${S},2`); }
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
  const L = { S, plan, rooms, edges: E, keep }; PLANS.set(key, L); return L;
}
export const roomAt = (S, x, y, plan = 'home') => layoutOf(S, plan).rooms.findIndex(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d);
const DEFAULT_STYLE = { living: ['wood', 'cream'], bed: ['cream', 'sky'], bath: ['tiles', 'white'], kitchen: ['tiles', 'cream'], dining: ['walnut', 'sage'], study: ['carpet', 'navy'], closet: ['cream', 'blush'], main: ['tiles', 'white'], office: ['carpet', 'white'], store: ['slate', 'white'], toilet: ['tiles', 'white'] };
export function styleOf(room, S, i) {
  const r = layoutOf(S, room?.plan || 'home').rooms[i], d = DEFAULT_STYLE[r?.kind] || DEFAULT_STYLE.living, s = (room?.styles || {})[i] || {};
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
    return wallParts(it).map(([px, py, z, pw, pd, h, c, s]) => { const q = py + T;
      const b = r === 0 ? [ox + px, oy + q, pw, pd] : r === 2 ? [ox - (px + pw), oy - (q + pd), pw, pd] : r === 1 ? [ox - (q + pd), oy + px, pd, pw] : [ox + q, oy - (px + pw), pd, pw];
      return { x: b[0], y: b[1], z, w: b[2], d: b[3], h, c: col(c), s, out: o }; });
  }
  return partsOf(it.k, it.r).map(([px, py, z, pw, pd, h, c, s]) => ({ x: it.x + px, y: it.y + py, z, w: pw, d: pd, h, c: col(c), s }));
}
// Frames, paintings and mirrors can be turned on the wall (landscape ↔ portrait): `o` 1 turns the whole piece a quarter
// turn about its middle, in the plane of the wall.
export const canTurnOnWall = k => { const f = FURNITURE[k]; return !!f && f.mount === 'wall' && (!!f.photo || ['painting', 'wallmirror', 'whiteboard'].includes(k)); };
function wallParts(it) {
  const f = FURNITURE[it.k]; if (!(it.o && canTurnOnWall(it.k))) return f.parts;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [px, , z, pw, , h] of f.parts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px + pw); z0 = Math.min(z0, z); z1 = Math.max(z1, z + h); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return f.parts.map(([px, py, z, pw, pd, h, c, s]) => [cx - (z + h - cz), py, cz + (px - cx), h, pd, pw, c, s]);
}
export function photoAspect(k, o = 0) { const p = (FURNITURE[k]?.parts || []).find(p => p[7] === 'p'), a = p ? p[3] / p[5] : 4 / 3; return o && canTurnOnWall(k) ? 1 / a : a; }

// Is there room for piece k at (x, y), turned (or on wall) r, in a house of `size`, leaving out the piece `skip`?
export function placeProblem(room, size, k, x, y, r, skip = null) {
  const f = FURNITURE[k]; if (!f) return 'There’s no such piece.';
  if (![x, y, r].every(Number.isInteger) || r < 0 || r > 3) return 'That isn’t a spot in the house.';
  const L = layoutOf(size, room.plan || 'home'), others = (room.items || []).filter(it => it.i !== skip && FURNITURE[it.k]);
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
export function fitRoom(raw, size, plan = 'home') {
  const L = layoutOf(size, plan), styles = {};
  for (const [i, s] of Object.entries(raw?.styles || {})) if (L.rooms[i] && s && (FLOORS[s.f] || WALLS[s.w])) styles[i] = { ...(FLOORS[s.f] ? { f: s.f } : {}), ...(WALLS[s.w] ? { w: s.w } : {}) };
  const room = { plan, styles, items: [], box: [], ...(raw?.locked ? { locked: true } : {}) }; let changed = false;
  const toBox = p => { changed = true; if (room.box.length < MAX_STORED) room.box.push({ i: p.i, k: p.k, c: p.c, ...(p.ph ? { ph: p.ph } : {}), ...(p.std ? { std: true } : {}) }); };
  for (const it of Array.isArray(raw?.box) ? raw.box : []) if (FURNITURE[it?.k] && room.box.length < MAX_STORED) room.box.push({ i: String(it.i), k: it.k, c: tintOf(it), ...(keepPhoto(it.k, it.ph) ? { ph: keepPhoto(it.k, it.ph) } : {}), ...(it.std ? { std: true } : {}) });
  for (const it of Array.isArray(raw?.items) ? raw.items : []) { if (!FURNITURE[it?.k]) { changed = true; continue; }
    const p = { i: String(it.i), k: it.k, x: it.x, y: it.y, r: it.r || 0, c: tintOf(it), ...(it.std ? { std: true } : {}), ...(it.o && canTurnOnWall(it.k) ? { o: 1 } : {}) }, ph = keepPhoto(it.k, it.ph); if (ph) p.ph = ph;
    if (room.items.length < MAX_ITEMS && !placeProblem(room, size, p.k, p.x, p.y, p.r)) room.items.push(p); else toBox(p); }
  return { room, changed };
}
export const resaleOf = (k, std) => (std ? 0 : Math.floor((FURNITURE[k]?.cost || 0) * RESALE));

// ---------------- businesses ----------------
// Which buildings anyone can walk into: every business and public building (not the jail or the police), and homes
// whose owner hasn't locked them.
const NO_ENTRY = new Set(['jail', 'prison', 'police', 'commissariat', 'policeplaza', 'dispatch']);
export const canEnter = type => { const t = BUILDING_TYPES[type]; return !!t && !!t.work && !t.home && !t.outdoor && !NO_ENTRY.has(type) && t.cat !== 'nature' && t.cat !== 'decor'; };
// The kind of business, for its floor plan and standard fit-out.
const FOODY = /tavern|diner|restaurant|cafe|café|bar|pub|bakery|pizza|food|grill|kitchen|bistro|canteen|snack|icecream|brew/;
export function bizKind(type) {
  const t = BUILDING_TYPES[type] || {}, n = (type + ' ' + (t.name || '')).toLowerCase(), c = t.cat || '';
  if (FOODY.test(n)) return 'food'; if (c === 'industry' || /factory|plant|works|mill|warehouse|depot|yard|refinery|forge|garage|hangar/.test(n)) return 'industry';
  if (c === 'offices' || /office|bank|hall|tower|exchange|agency|studio|clinic|school|library|court/.test(n)) return 'office'; return 'shop';
}
export function bizSize(type) { const t = BUILDING_TYPES[type]; if (!t) return 0; const [w, d] = t.size || [1, 1], a = w * d; return a <= 2 ? 6 : a <= 4 ? 8 : a <= 9 ? 10 : 12; }
// The fit-out a business has until its owner designs it (the owner can keep these pieces or take them out, for nothing).
export function standardFit(type, S) {
  const kind = bizKind(type), room = { plan: kind, items: [], box: [] }, L = layoutOf(S, kind), main = L.rooms.find(r => r.kind === 'main'); let n = 0;
  const put = (k, x, y, r = 0, c = 0) => { if (!FURNITURE[k] || placeProblem(room, S, k, x, y, r)) return false; room.items.push({ i: 'std' + n++, k, x, y, r, c, std: true }); return true; };
  const y0 = main.y, y1 = S - 1, cx = Math.floor(S / 2);
  if (kind === 'shop') { put('till', 1, y0, 2, 5); for (let x = 3; x + 2 <= S; x += 3) put('shelves', x, y0, 0); for (let x = 1; x + 2 <= S - 1; x += 3) put('shelves', x, y0 + 2, 2); put('fridgecase', S - 1, y0 + 1, 1); put('plant', 0, y1, 0); put('opensign', cx - 1, y1, 2); put('ceilinglight', cx, y0 + 1, 0); put('ceilinglight', 1, y1 - 1, 0); }
  else if (kind === 'food') { put('bar', 0, y0, 0, 3); put('coffee', 2, y0, 0); for (let x = 1; x + 2 <= S; x += 3) for (let y = y0 + 2; y + 2 <= S; y += 3) put('tablefour', x, y, 0, 0); put('menuboard', 3, y0, 0); put('pendant', 2, y0 + 2, 0, 8); put('pendant', S - 3, y0 + 2, 0, 8); put('plant', S - 1, y1, 0); }
  else if (kind === 'office') { put('reception', cx - 1, y1 - 1, 2, 1); put('waiting', 0, y1, 0, 5); for (let x = 0; x + 2 <= S; x += 3) put('officedesk', x, y0, 0, 5); put('watercooler', S - 1, y1, 0); put('logo', 2, y0, 0); put('spotlights', cx, y0 + 1, 0); put('plant', S - 1, y0, 0); }
  else { put('workbench', 0, y0, 0); put('machine', 3, y0 + 1, 0, 1); put('racking', S - 2, y0, 0); put('crates', 0, y1, 0); put('pallet', 1, y1, 0); put('barrels', S - 1, y1, 0, 4); put('toolwall', 0, y0, 0); put('ceilinglight', cx, y0 + 1, 0); }
  return room.items;
}
export const photosIn = room => new Set([...(room.items || []), ...(room.box || [])].map(it => it.ph).filter(Boolean));
