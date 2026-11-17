// A colonist's own character: their body, face, hair, clothes and the things they wear. Shared by the server (which
// checks a look and that paid items were bought) and the browser (the character creator, and drawing people).
//
// A look is small JSON:
//   { g: 'm'|'f', ht: 0-4 (height), bd: 0-3 (build), sk: skin '#rrggbb', fc: 0-3 (face shape), br: 0-3 (brows),
//     ns: 0-3 (nose), ey: eye colour '#rrggbb', bdr: 0-5 (beard), mk: 0-3 (makeup), lc: lipstick colour index,
//     hs: hair style, hc: hair colour '#rrggbb', w: { slot: [item, colour index] } }
// Skin, hair and eye colours can be any colour (the photo match picks them); clothes use the CLOTH colours.
// Everything costs nothing except the items with a price, which are bought once and kept in the colonist's wardrobe.
import { hashStr } from './rules.js';

export const SKINS = ['#FBE3D1', '#F5D0B5', '#EBC3A0', '#E0AC86', '#D29A6E', '#C68B59', '#AE7446', '#8D5524', '#764525', '#5C3A21', '#4A2D1A', '#3A2214'];
export const HAIRS = ['#120D0A', '#2B1D14', '#3D2A1E', '#5A3825', '#7A4A2A', '#A0612F', '#C9A15B', '#E1C68A', '#8C2F1B', '#B0452A', '#D9D2C5', '#8E8B87', '#2E4A9A', '#C2417A', '#3E8E5A'];
export const EYES = ['#3B2416', '#5A3A22', '#7A5A30', '#4E6B3A', '#3F6E8C', '#6E8FA8', '#5C5C5C', '#2A2A2A'];
export const LIPS = ['#B5524F', '#C7364A', '#8E2A3A', '#D9777F', '#A45A52', '#6E2B3B'];
export const CLOTH = ['#F4F1EA', '#D9D4C7', '#8E8B87', '#3A3B3F', '#1B1C1E', '#2F3A4F', '#3E5C9A', '#7FA7D9', '#2A9D8F', '#3E6B48', '#A8C686', '#F2C94C',
  '#E2A23B', '#E4572E', '#C0392B', '#8E2C3A', '#D98BA8', '#6D597A', '#8C5B33', '#C9A27A'];
export const HEIGHTS = ['Short', 'A bit short', 'Average', 'Tall', 'Very tall'];
export const BUILDS = ['Slim', 'Average', 'Broad', 'Heavier'];
export const FACES = ['Oval', 'Round', 'Square', 'Long'];
export const BROWS = ['Thin', 'Natural', 'Thick', 'Arched'];
export const NOSES = ['Small', 'Straight', 'Wide', 'Long'];
export const BEARDS = ['None', 'Stubble', 'Moustache', 'Goatee', 'Short beard', 'Full beard'];
export const MAKEUP = ['None', 'Lipstick', 'Eyeshadow', 'Both'];

// Hair: [name, price, shape the map uses: long | bun | pony | short | buzz]
export const HAIR_STYLES = {
  bald: ['Bald', 0, 'buzz'], buzz: ['Buzz cut', 0, 'buzz'], short: ['Short', 0, 'short'], side: ['Side part', 0, 'short'], curlyshort: ['Short curls', 0, 'short'],
  afro: ['Afro', 0, 'short'], quiff: ['Quiff', 300, 'short'], cornrows: ['Cornrows', 500, 'buzz'], twists: ['Twists', 400, 'short'], mohawk: ['Mohawk', 1200, 'buzz'],
  slick: ['Slicked back', 800, 'short'], manbun: ['Top knot', 400, 'bun'], long: ['Long straight', 0, 'long'], wavy: ['Long wavy', 0, 'long'], bob: ['Bob', 0, 'long'],
  pixie: ['Pixie', 0, 'short'], pony: ['Ponytail', 0, 'pony'], bun: ['Bun', 0, 'bun'], curly: ['Curly', 0, 'long'], bangs: ['Fringe', 300, 'long'],
  braids: ['Box braids', 500, 'long'], locs: ['Locs', 600, 'long'], spacebuns: ['Space buns', 600, 'bun'], dreads: ['Dreadlocks', 600, 'long'],
};
export const HAIR_ORDER = { m: ['short', 'side', 'buzz', 'curlyshort', 'afro', 'bald', 'quiff', 'slick', 'twists', 'cornrows', 'dreads', 'manbun', 'mohawk', 'long', 'wavy', 'locs', 'braids', 'pony', 'bun', 'bob', 'pixie', 'curly', 'bangs', 'spacebuns'],
  f: ['long', 'wavy', 'bob', 'pony', 'bun', 'curly', 'pixie', 'afro', 'bangs', 'braids', 'locs', 'spacebuns', 'twists', 'cornrows', 'dreads', 'short', 'side', 'curlyshort', 'buzz', 'bald', 'quiff', 'slick', 'manbun', 'mohawk'] };

// What can be worn, by slot. An item: [name, price, who it's shown to first ('' anyone, 'm', 'f'), extra]
// extra: full: covers the legs too (a dress); long: long sleeves; shape notes for the 3D drawing.
export const SLOTS = [['top', 'Tops'], ['bot', 'Bottoms'], ['shoe', 'Shoes'], ['out', 'Jackets'], ['hat', 'Hats'], ['eye', 'Glasses'], ['neck', 'Neck'], ['ear', 'Earrings'], ['wrist', 'Wrist'], ['bag', 'Bags']];
export const ITEMS = {
  top: { tee: ['T-shirt', 0, ''], tank: ['Vest top', 0, ''], longtee: ['Long-sleeve top', 0, '', { long: 1 }], shirt: ['Shirt', 0, '', { long: 1, collar: 1 }], blouse: ['Blouse', 0, 'f', { collar: 1 }],
    polo: ['Polo shirt', 300, '', { collar: 1 }], crop: ['Crop top', 400, 'f', { crop: 1 }], hoodie: ['Hoodie', 600, '', { long: 1, hood: 1 }], sweater: ['Jumper', 800, '', { long: 1 }],
    jersey: ['Football shirt', 900, '', { stripe: 1 }], bikini: ['Bikini top', 0, 'f', { bikini: 1 }], swimsuit: ['Swimsuit', 0, 'f', { swim: 1 }], dress: ['Dress', 0, 'f', { full: 1 }], sundress: ['Sundress', 700, 'f', { full: 1, straps: 1 }],
    gown: ['Evening gown', 5000, 'f', { full: 1, long: 1, floor: 1 }], kaftan: ['Kaftan', 1500, '', { full: 1, long: 1, floor: 1 }] },
  bot: { jeans: ['Jeans', 0, ''], trousers: ['Trousers', 0, ''], shorts: ['Shorts', 0, '', { short: 1 }], trunks: ['Swim shorts', 0, '', { short: 1, swim: 1 }], briefs: ['Swim briefs', 0, '', { briefs: 1 }], skirt: ['Skirt', 0, 'f', { skirt: 1 }], longskirt: ['Long skirt', 500, 'f', { skirt: 1, floor: 1 }],
    joggers: ['Joggers', 400, ''], cargo: ['Cargo trousers', 700, '', { pockets: 1 }], leggings: ['Leggings', 300, 'f', { tight: 1 }] },
  shoe: { sneakers: ['Trainers', 0, ''], sandals: ['Sandals', 0, ''], boots: ['Boots', 600, '', { high: 1 }], loafers: ['Loafers', 800, ''], heels: ['Heels', 900, 'f', { heel: 1 }], hightops: ['High-tops', 1200, '', { high: 1 }] },
  out: { cardigan: ['Cardigan', 1200, ''], denim: ['Denim jacket', 1500, ''], puffer: ['Puffer jacket', 2500, '', { puffy: 1 }], blazer: ['Blazer', 3000, ''], coat: ['Long coat', 3500, '', { long: 1 }], leather: ['Leather jacket', 4000, '', { shiny: 1 }] },
  hat: { cap: ['Cap', 300, ''], beanie: ['Beanie', 250, ''], bucket: ['Bucket hat', 400, ''], headwrap: ['Headwrap', 500, ''], sunhat: ['Sun hat', 900, ''], fedora: ['Fedora', 1500, ''], crown: ['Crown', 25000, '', { gold: 1 }] },
  eye: { specs: ['Glasses', 200, ''], round: ['Round glasses', 600, ''], shades: ['Sunglasses', 800, '', { dark: 1 }] },
  neck: { scarf: ['Scarf', 500, ''], tie: ['Tie', 400, ''], chain: ['Gold chain', 3000, '', { gold: 1 }], pearls: ['Pearls', 6000, '', { pearl: 1 }] },
  ear: { studs: ['Stud earrings', 1500, '', { gold: 1 }], hoops: ['Hoop earrings', 2000, '', { gold: 1 }] },
  wrist: { bracelet: ['Bracelet', 1000, '', { gold: 1 }], watch: ['Watch', 2500, ''], goldwatch: ['Gold watch', 12000, '', { gold: 1 }] },
  bag: { backpack: ['Backpack', 800, ''], crossbody: ['Cross-body bag', 1200, ''], handbag: ['Handbag', 2500, ''] },
};
export const itemOf = (slot, k) => ITEMS[slot] && ITEMS[slot][k] || null;
export const priceOf = (slot, k) => (slot === 'hair' ? HAIR_STYLES[k]?.[1] : itemOf(slot, k)?.[1]) || 0;
export const wardKey = (slot, k) => slot + ':' + k; // how a bought item is kept in the wardrobe
// colours that a piece can't come in (gold stays gold, pearls stay pearl)
export const fixedColour = (slot, k) => { const x = itemOf(slot, k)?.[3] || {}; return !!(x.gold || x.pearl); };

const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = (v, n, d) => (Number.isInteger(v) && v >= 0 && v < n ? v : d);
const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : d);

// The look a colonist starts with before they make their own (also every colonist nobody plays): the same colours
// the map has always given them.
const M_SHIRTS = [13, 5, 12, 7, 10, 16, 17, 8, 14, 8], M_PANTS = [3, 5, 18, 9, 4];
export function defaultLook(handle, gender) {
  const h = hashStr(String(handle || 'x')), f = gender === 'f';
  const skin = ['#F1C9A5', '#E0AC80', '#C68642', '#8D5524', '#5C3A21'][(h >>> 4) % 5], hair = ['#2B1D14', '#5A3825', '#C9A15B', '#1B1B1B', '#8C2F1B', '#D9D2C5'][(h >>> 8) % 6];
  const st = f ? ['long', 'long', 'bun', 'pony'][(h >>> 16) % 4] : ['short', 'short', 'short', 'buzz'][(h >>> 16) % 4], dress = f && (h >>> 20) % 5 < 3;
  const w = { top: [dress ? 'dress' : 'tee', M_SHIRTS[h % 10]], shoe: ['sneakers', (h >>> 15) & 1 ? 4 : 0] }; if (!dress) w.bot = ['jeans', M_PANTS[(h >>> 12) % 5]];
  return { g: f ? 'f' : 'm', ht: 2, bd: 1, sk: skin, fc: 0, br: 1, ns: 1, ey: EYES[(h >>> 24) % 4], bdr: 0, mk: 0, lc: 0, hs: st, hc: hair, w };
}
// The mannequin the creator starts from: underwear only.
export function mannequin(gender) { const f = gender === 'f'; return { g: f ? 'f' : 'm', ht: 2, bd: 1, sk: SKINS[3], fc: 0, br: 1, ns: 1, ey: EYES[1], bdr: 0, mk: 0, lc: 0, hs: f ? 'long' : 'short', hc: HAIRS[1], w: {} }; }

// Cleans up a look from anywhere (the phone, the database). Unknown or bad values fall back to the default.
export function fixLook(raw, base) {
  const r = raw && typeof raw === 'object' ? raw : {}, d = base || mannequin(r.g);
  const out = { g: r.g === 'f' ? 'f' : r.g === 'm' ? 'm' : d.g, ht: pick(r.ht, 5, d.ht), bd: pick(r.bd, 4, d.bd), sk: hex(r.sk, d.sk), fc: pick(r.fc, 4, d.fc), br: pick(r.br, 4, d.br), ns: pick(r.ns, 4, d.ns),
    ey: hex(r.ey, d.ey), bdr: pick(r.bdr, 6, d.bdr), mk: pick(r.mk, 4, d.mk), lc: pick(r.lc, LIPS.length, d.lc), hs: HAIR_STYLES[r.hs] ? r.hs : d.hs, hc: hex(r.hc, d.hc), w: {} };
  const w = r.w && typeof r.w === 'object' ? r.w : {};
  for (const [slot] of SLOTS) { const v = w[slot]; if (!Array.isArray(v) || !itemOf(slot, v[0])) continue; out.w[slot] = [v[0], pick(v[1], CLOTH.length, 0)]; }
  if (out.w.top && itemOf('top', out.w.top[0])[3]?.full) delete out.w.bot; // a dress covers the legs
  return out;
}
// Anyone can go out in whatever they like, beachwear and underwear included. Nobody is ever naked: wherever nothing
// is worn, underwear is drawn (see public/avatar3d.js), so every look is fine to go out in.
export function dressed() { return true; }
// The paid things a look uses that aren't in the wardrobe yet: [[slot, key, price], ...]
export function unpaid(look, wardrobe) {
  const have = new Set(wardrobe || []), out = [];
  if (priceOf('hair', look.hs) && !have.has(wardKey('hair', look.hs))) out.push(['hair', look.hs, priceOf('hair', look.hs)]);
  for (const [slot] of SLOTS) { const v = look.w[slot]; if (v && priceOf(slot, v[0]) && !have.has(wardKey(slot, v[0]))) out.push([slot, v[0], priceOf(slot, v[0])]); }
  return out;
}
// The few colours the map and the little profile pictures need: [shirt, skin, hair, trousers, style, dress, hat colour or '']
export function mapLook(look) {
  const L = look, top = L.w.top, out = L.w.out, bot = L.w.bot, hat = L.w.hat, full = top && itemOf('top', top[0])[3]?.full;
  const shirt = out ? CLOTH[out[1]] : top ? CLOTH[top[1]] : L.sk, pants = bot ? CLOTH[bot[1]] : full ? CLOTH[top[1]] : L.sk;
  let style = HAIR_STYLES[L.hs]?.[2] || 'short'; if (L.g === 'm' && (style === 'pony' || style === 'bun')) style = 'short'; if (L.g === 'f' && (style === 'short' || style === 'buzz')) style = 'bun';
  if (L.g === 'm' && hat) style = 'cap';
  return [shirt, L.sk, L.hc, pants, style, full ? 1 : 0, hat ? (fixedColour('hat', hat[0]) ? '#E2B13C' : CLOTH[hat[1]]) : ''];
}
