// Game rules shared by the server (authoritative) and the browser.
import { BUILDING_TYPES, ROAD_TYPES } from './catalog.js';

export const GAME_MIN_MS = 1250;           // 1 game minute = 1.25 real seconds → 1 game day = 30 real minutes (48 a day)
export const LEGACY_GAME_MIN_MS = 15000;   // the speed towns founded before October 2026 started with
export const DAY_MS = 1440 * GAME_MIN_MS;
export const TAX_RATE = 0.2;               // share of each salary that goes to the treasury
export const GRANT = 200;                  // coins the town receives every game day regardless
export const START_FUNDS = 5000;
export const CHUNK = 32;                   // the map is split into 32×32-tile chunks; viewers load only the chunks they see
export const HANGOUT_RADIUS = 40;          // citizens hang out at the nearest leisure spot within this many tiles of home

// Whether a building is big news for the Colony Log: industry, public services, landmarks and big venues always, and
// anything else costing 4,000 coins or more. Trees, plants, decorations, small homes and small shops (and roads) aren't.
const MAJOR_TYPES = new Set(['casino', 'racetrack', 'stadium', 'gym', 'bank', 'mall', 'cinema', 'hotel', 'supermarket', 'deptstore', 'markethall', 'arcade', 'exchange', 'powerplant', 'waterworks']);
export function majorBuilding(type) {
  const t = BUILDING_TYPES[type]; if (!t || t.cat === 'nature' || t.cat === 'decor' || type === 'campfire' || type === 'well') return false;
  return t.cat === 'industry' || t.cat === 'services' || t.cat === 'landmarks' || MAJOR_TYPES.has(type) || (t.cost || 0) >= 4000;
}
export const typeOf = b => BUILDING_TYPES[b.type] || BUILDING_TYPES.tent;
export const blocks = b => !typeOf(b).outdoor;
export const gameMinutes = (t, epoch) => (t - epoch) / GAME_MIN_MS;
export const gameDay = (t, epoch) => Math.floor(gameMinutes(t, epoch) / 1440);
// Roughly where a colonist is at a minute of the game day, by their routine: asleep or relaxing at home (before ~07:45 and
// after ~21:40), at work (~07:50–11:40 and ~13:10–16:15, if they have a job), or out and about (lunch, commuting, evenings,
// job hunting). The map shows each person's exact day; these windows are slightly generous towards being home or at work.
export function routineAt(minute, hasJob) {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m < 465 || m >= 1300) return 'home';
  if (hasJob && ((m >= 470 && m < 700) || (m >= 790 && m < 975))) return 'work';
  return 'out';
}
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

// Weather is worked out from the clock, so every viewer sees the same sky. Each game day is split into
// four 6-hour spells; the developer can pin one kind of weather instead (meta.weather).
export const WEATHER_ODDS = [['sunny', 44], ['cloudy', 24], ['rain', 15], ['fog', 9], ['storm', 8]];
function mix(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; }
export function weatherAt(meta, gm) {
  if (meta && meta.weather) return meta.weather;
  const spell = Math.floor(gm / 360), r = mix(spell * 2654435761 + (meta ? (meta.createdAt % 100000) : 0)) % 100;
  const hour = ((gm % 1440) + 1440) % 1440 / 60;
  if (hour >= 4 && hour < 8 && r < 18) return 'fog';
  let acc = 0; for (const [k, p] of WEATHER_ODDS) { acc += p; if (r < acc) return k; }
  return 'sunny';
}

// "spawn female", "spawn as a man", "spawn girl"… Returns 'm', 'f' or null when the comment doesn't say.
export function genderFrom(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(female|woman|girl|lady|queen)\b|👩|👧|♀/u.test(t)) return 'f';
  if (/\b(male|man|boy|guy|king)\b|👨|👦|♂/u.test(t)) return 'm';
  return null;
}
export const randomGender = () => (Math.random() < 0.5 ? 'm' : 'f');

// A building's footprint: turned buildings (rot 1) swap width and depth.
export const footprint = (size, rot) => (rot ? [size[1], size[0]] : [size[0], size[1]]);
export const cleanRot = r => (Number(r) === 1 ? 1 : 0);

// A display name: one to three words of letters (any language), with spaces, hyphens, apostrophes or dots. '' clears it.
export function cleanName(n) {
  const v = String(n ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v) return '';
  if (v.length > 40) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’.\- ]*$/u.test(v) || v.split(' ').length > 3) return null;
  return v;
}
