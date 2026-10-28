// Game rules shared by the server (authoritative) and anything else that needs them.
import { BUILDING_TYPES, ROAD_TYPES } from './catalog.js';

export const GAME_MIN_MS = 15000;          // 1 game minute = 15 real seconds → 4 game days per real day
export const TAX_RATE = 0.2;               // share of each salary that goes to the treasury
export const GRANT = 200;                  // coins the town receives every game day regardless
export const START_FUNDS = 5000;

export const typeOf = b => BUILDING_TYPES[b.type] || BUILDING_TYPES.tent;
export const blocks = b => !typeOf(b).outdoor;
export const gameMinutes = (t, epoch) => (t - epoch) / GAME_MIN_MS;
export const gameDay = (t, epoch) => Math.floor(gameMinutes(t, epoch) / 1440);
export const cleanHandle = s => String(s || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);

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

// Earliest citizens get the earliest homes and jobs. Same rule the browser uses.
export function assignments(buildings, citizens) {
  const cits = [...citizens].sort((a, b) => a.joinedAt - b.joinedAt);
  const blds = [...buildings].sort((a, b) => a.builtAt - b.builtAt);
  const homeSlots = [], jobSlots = [];
  for (const b of blds) {
    const t = typeOf(b);
    if (t.home) for (let i = 0; i < t.home.capacity; i++) homeSlots.push(b.id);
    if (t.work) for (let i = 0; i < t.work.slots; i++) jobSlots.push(b.id);
  }
  const assign = new Map();
  cits.forEach((c, i) => assign.set(c.id, { home: homeSlots[i] || null, job: jobSlots[i] || null }));
  return assign;
}

export function pay(c, assign, byId) {
  const a = assign.get(c.id) || {};
  const j = a.job && byId.get(a.job), h = a.home && byId.get(a.home);
  return { salary: j ? typeOf(j).work.salary : 0, rent: h ? typeOf(h).home.rent : 0 };
}

export function dailyIncome(citizens, assign, byId) {
  let s = GRANT;
  for (const c of citizens) { const { salary, rent } = pay(c, assign, byId); s += Math.round(salary * TAX_RATE) + rent; }
  return s;
}

export const roadCost = type => (ROAD_TYPES[type] && ROAD_TYPES[type].cost) || 0;
export const isRoadType = type => !!ROAD_TYPES[type] && !ROAD_TYPES[type].hidden;
