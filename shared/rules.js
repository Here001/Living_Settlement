// Game rules shared by the server (authoritative) and the browser.
import { BUILDING_TYPES, ROAD_TYPES } from './catalog.js';

export const GAME_MIN_MS = 15000;          // 1 game minute = 15 real seconds → 4 game days per real day
export const DAY_MS = 1440 * GAME_MIN_MS;
export const TAX_RATE = 0.2;               // share of each salary that goes to the treasury
export const GRANT = 200;                  // coins the town receives every game day regardless
export const START_FUNDS = 5000;
export const CHUNK = 32;                   // the map is split into 32×32-tile chunks; viewers load only the chunks they see
export const HANGOUT_RADIUS = 40;          // citizens hang out at the nearest leisure spot within this many tiles of home

export const typeOf = b => BUILDING_TYPES[b.type] || BUILDING_TYPES.tent;
export const blocks = b => !typeOf(b).outdoor;
export const gameMinutes = (t, epoch) => (t - epoch) / GAME_MIN_MS;
export const gameDay = (t, epoch) => Math.floor(gameMinutes(t, epoch) / 1440);
export const cleanHandle = s => String(s || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
export const chunkOf = (x, y) => [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
export const chunkKey = (cx, cy) => `${cx}_${cy}`;
export const chunkKeyOfTile = (x, y) => chunkKey(...chunkOf(x, y));

// A building is filed under the chunk of its north corner.
export function capacities(type) {
  const t = BUILDING_TYPES[type] || {};
  return { homeCap: t.home ? t.home.capacity : 0, jobCap: t.work ? t.work.slots : 0, leisure: !!t.leisure,
    hangCap: t.leisure ? (t.visitors || 10 * t.size[0] * t.size[1]) : 0,
    rent: t.home ? t.home.rent : 0, salary: t.work ? t.work.salary : 0 };
}

// Construction time in game minutes. Small things (trees, benches, lamps) appear instantly.
// A catalog entry can set buildHours to override; otherwise bigger, pricier buildings take longer.
export function buildMinutes(type) {
  const t = BUILDING_TYPES[type] || {};
  if (t.buildHours != null) return Math.round(t.buildHours * 60);
  return (t.cost || 0) < 100 ? 0 : 60 * Math.max(1, Math.ceil((t.cost || 0) / 1500));
}

// What one citizen adds to the treasury each day, and what they gain themselves.
export const taxOf = salary => Math.round(salary * TAX_RATE);
export const netOf = (salary, rent) => salary - rent;

// Balances aren't rewritten every day. Each one is stored as (amount, day, change per day)
// and worked out on demand. That makes paydays free no matter how many citizens there are.
export const balanceOn = (base, fromDay, perDay, today) => Math.max(0, Number(base) + Math.max(0, today - fromDay) * perDay);
export const treasuryOn = (meta, today) => meta ? balanceOn(meta.treasuryBase ?? START_FUNDS, meta.treasuryDay ?? 0, meta.income ?? GRANT, today) : 0;

export function occupancy(buildings) {
  const occ = new Map();
  for (const b of buildings) {
    const [w, d] = typeOf(b).size;
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) occ.set(`${b.x + i},${b.y + j}`, b.id);
  }
  return occ;
}

export function canPlace(type, x, y, occ, roads, ignoreId) {
  const t = BUILDING_TYPES[type]; if (!t) return false;
  const [w, d] = t.size;
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    const k = `${x + i},${y + j}`; const o = occ.get(k);
    if ((o && o !== ignoreId) || roads.has(k)) return false;
  }
  return true;
}

export const roadCost = type => (ROAD_TYPES[type] && ROAD_TYPES[type].cost) || 0;
export const isRoadType = type => !!ROAD_TYPES[type] && !ROAD_TYPES[type].hidden;
