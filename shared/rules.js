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
const MAJOR_TYPES = new Set(['casino', 'racetrack', 'stadium', 'gym', 'bank', 'communitybank', 'intlbank', 'mall', 'cinema', 'hotel', 'supermarket', 'deptstore', 'markethall', 'arcade', 'exchange', 'powerplant', 'waterworks']);
export function majorBuilding(type) {
  const t = BUILDING_TYPES[type]; if (!t || t.cat === 'nature' || t.cat === 'decor' || type === 'campfire' || type === 'well') return false;
  return t.cat === 'industry' || t.cat === 'services' || t.cat === 'landmarks' || MAJOR_TYPES.has(type) || (t.cost || 0) >= 4000;
}
export const typeOf = b => BUILDING_TYPES[b.type] || BUILDING_TYPES.tent;
export const blocks = b => !typeOf(b).outdoor;
export const gameMinutes = (t, epoch) => (t - epoch) / GAME_MIN_MS;
export const gameDay = (t, epoch) => Math.floor(gameMinutes(t, epoch) / 1440);
// ---- Shifts and bedtimes ----
// Not everyone keeps the same hours. Places that never close (services, utilities, industry, hotels, petrol stations,
// the casino, taverns) run day, evening and night shifts; shops and places to go out run day and evening shifts; offices,
// schools, banks and the like work days. Which shift a colonist works is fixed for each job they hold (picked from their
// id and the job's id, so the server and every phone agree). Bedtimes vary too: early birds turn in an hour early,
// night owls up to an hour and a half late.
export const SHIFTS = {
  day: { name: 'Day shift', hours: '07:50–16:15' },
  evening: { name: 'Evening shift', hours: '14:00–22:00' },
  night: { name: 'Night shift', hours: '22:00–06:00' },
};
const DAY_ONLY = new Set(['townhall', 'school', 'library', 'postoffice', 'kindergarten', 'openschool', 'college', 'university', 'courthouse', 'museum']);
const ROUND_CLOCK = new Set(['hotel', 'gasstation', 'casino', 'gamehouse', 'tavern', 'diner']);
export function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function shiftOf(citizenId, jobId, jobType) {
  const t = jobId && BUILDING_TYPES[jobType]; if (!t || !t.work || DAY_ONLY.has(jobType)) return 'day';
  const r = hashStr(`${citizenId}:shift:${jobId}`) % 100;
  if (ROUND_CLOCK.has(jobType) || ['services', 'utilities', 'industry'].includes(t.cat)) return r < 50 ? 'day' : r < 75 ? 'evening' : 'night';
  if (['shops', 'parks', 'landmarks'].includes(t.cat)) return r < 70 ? 'day' : 'evening';
  return 'day';
}
export const OWLS = [-60, -30, 0, 0, 30, 60, 90]; // minutes later (or earlier) than usual they head home and go to bed
export const owlOf = citizenId => OWLS[hashStr(`${citizenId}:owl`) % OWLS.length];
// Roughly where a colonist is at a minute of the game day, by their shift and bedtime: 'home' (asleep or relaxing),
// 'work', or 'out' (breaks, commuting, evenings, errands, job hunting). The map shows each person's exact day; these
// windows are slightly generous towards being home or at work.
export function routineAt(minute, hasJob, shift = 'day', owl = 0) {
  const m = ((minute % 1440) + 1440) % 1440;
  if (hasJob && shift === 'night') {
    if (m < 155 || (m >= 185 && m < 370) || m >= 1320) return 'work';
    if ((m >= 370 && m < 990) || (m >= 1150 && m < 1320)) return 'home';
    return 'out';
  }
  if (hasJob && shift === 'evening') {
    if (m < 560 || m >= 1320) return 'home';
    if ((m >= 760 && m < 1065) || (m >= 1095 && m < 1320)) return 'work';
    return 'out';
  }
  if (m < 475 || m >= 1160 + owl) return 'home';
  if (hasJob && ((m >= 475 && m < 730) || (m >= 770 && m < 1000))) return 'work';
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

// Crime odds depend on how far the nearest Police station is from where the crime happens.
// More than 40 tiles away (or no police at all): high. 16 to 40 tiles: mid. Within 15 tiles: low.
export const CRIME_NEAR = 15, CRIME_FAR = 40;
export const CRIME_RATES = { pickpocket: { high: 0.75, mid: 0.45, low: 0.2 }, rob: { high: 0.6, mid: 0.32, low: 0.12 },
  scam: { high: 0.85, mid: 0.6, low: 0.35 }, atm: { high: 0.5, mid: 0.28, low: 0.1 },
  armored: { high: 0.5, mid: 0.3, low: 0.14 }, mayor: { high: 0.5, mid: 0.3, low: 0.15 }, jailbreak: { high: 0.45, mid: 0.28, low: 0.12 }, bank: { high: 0.4, mid: 0.24, low: 0.1 } };
// Solo crimes beyond pickpocketing and shop robberies: loot in coins (paid by the colony, i.e. the treasury).
export const SOLO_CRIMES = {
  scam: { name: 'Con a tourist', icon: '🎭', loot: [800, 2000], blurb: 'Sell a visitor a "genuine" Gliese moon rock. Small takings, easy to get away with.' },
  atm: { name: 'Hack an ATM', icon: '🏧', loot: [8000, 15000], blurb: 'Crack the cash machine outside the nearest Bank. Better money, more risk.', needs: 'bank' },
};
// Group crimes (heists): planned with a crew, who get a group chat to agree the time. Everyone shares the loot equally;
// each member can be caught separately (more likely if it goes wrong), and those caught are fined and jailed.
// A bigger crew than the minimum adds 4 points to the odds per extra member.
export const HEISTS = {
  armored: { name: 'Hit an armoured truck', icon: '🚚', min: 2, max: 5, loot: [20000, 50000], jail: 20, blurb: 'Stop the cash truck between the Banks.' },
  mayor: { name: 'Rob the Mayor', icon: '👑', min: 2, max: 5, lootShare: [0.3, 0.5], lootMin: 2000, jail: 25, blurb: "Corner the Mayor and empty their pockets (30–50% of the cash on them). Can't be done without a Mayor." },
  jailbreak: { name: 'Break someone out of jail', icon: '🔓', min: 2, max: 6, loot: [6000, 12000], jail: 30, blurb: 'Free an inmate. The underworld pays a bounty to the crew; fail, and the inmate gets 10 more minutes.' },
  bank: { name: 'Bank heist', icon: '🏦', min: 3, max: 6, loot: [60000, 150000], jail: 30, blurb: 'The big one: the vault of the nearest Bank. Needs a crew of three or more.', needs: 'bank' },
};
export const HEIST_CREW_BONUS = 0.04, HEIST_CAUGHT = { win: 0.15, lose: 0.7 }, HEIST_COOLDOWN = 30 * 60 * 1000, HEIST_WAIT = [5, 10, 20, 30, 60];
// Night (20:00 game time, through midnight, until 06:00): dark streets add 15 points.
export const NIGHT_FROM = 20 * 60, NIGHT_TO = 6 * 60, NIGHT_BONUS = 0.15;
export const isNight = gm => { const m = ((gm % 1440) + 1440) % 1440; return m >= NIGHT_FROM || m < NIGHT_TO; };
export function crimeOdds(kind, dist, wave = 0, night = false) {
  const band = dist == null || dist > CRIME_FAR ? 'high' : dist > CRIME_NEAR ? 'mid' : 'low';
  return { band, dist: dist == null ? null : dist, night: !!night, chance: Math.min(0.9, (CRIME_RATES[kind] || CRIME_RATES.rob)[band] + wave + (night ? NIGHT_BONUS : 0)) };
}

// Distances players see are in game miles: 20 tiles to the mile.
// "Go here": a colonist can head to any finished building except the jail and police stations, and not to trees or street furniture.
export const NO_GO = new Set(['jail', 'police', 'commissariat']);
export const canGoTo = type => { const t = BUILDING_TYPES[type]; return !!t && !NO_GO.has(type) && t.cat !== 'nature' && t.cat !== 'decor'; };
export const TILE_MILES = 0.05;
// Chatting: messaging a neighbour (someone whose home is within NEIGHBOUR_TILES of yours, about 2 miles: the same
// district) is free. Anyone further away costs MESSAGE_FEE coins a message, paid from your cash to the treasury.
export const NEIGHBOUR_TILES = 40, MESSAGE_FEE = 2, GROUP_MAX = 30;
// Renting a home: a moving-in fee (a tenth of what one flat in the building is worth) plus the movers.
export const RENT_FEE_SHARE = 0.1, MOVERS_BASE = 500, MOVERS_PER_TILE = 15;
// Getting around: trips of 14 tiles (0.7 mi) or more are made by car if the colonist owns one, otherwise by cab; shorter
// ones are walked. A car costs fuel, a cab costs a fare; someone who can't afford the cab walks.
export const TRIP_DRIVE = 14, CAB_BASE = 10, CAB_PER_MILE = 6, FUEL_PER_MILE = 2;
export function tripFare(tiles, hasCar) {
  if (!(tiles >= TRIP_DRIVE)) return { mode: 'walk', fare: 0 };
  const mi = tiles * TILE_MILES; return hasCar ? { mode: 'car', fare: Math.max(1, Math.round(mi * FUEL_PER_MILE)) } : { mode: 'cab', fare: Math.round(CAB_BASE + mi * CAB_PER_MILE) };
}
// ---- Prices players pay ----
// A game day is 30 real minutes, so 48 pass in a real day. Prices are set against that: a building a player buys pays
// for itself in about a real month (30 real days = 1,440 game days) when every home or job in it is filled, and less
// quickly when it isn't. An active player earns roughly 4,000–5,000 coins a real day, so a first small home takes a
// few days of play, a block of flats months, and the towers are for the colony's richest.
export const TREASURY_CUT = 0.2;           // the colony's share of every player business
export const BUSINESS_SHARE = 0.25;        // a business makes 25% of its wage bill in profit
export const PAYBACK_GAME_DAYS = 30 * 48, PROPERTY_MIN = 5000;
const nicePrice = n => { const step = n < 20000 ? 500 : n < 100000 ? 1000 : n < 1e6 ? 5000 : 50000; return Math.round(n / step) * step; };
export function fullIncome(type) { // what a full building earns its owner each game day, after the treasury's cut
  const t = BUILDING_TYPES[type] || {}; let g = 0;
  if (t.home) g += (t.home.capacity || 0) * (t.home.rent || 0);
  if (t.work) g += (t.work.slots || 0) * (t.work.salary || 0) * BUSINESS_SHARE;
  return g * (1 - TREASURY_CUT); }
export const propertyPrice = type => nicePrice(Math.max(PROPERTY_MIN, fullIncome(type) * PAYBACK_GAME_DAYS));
// Weekly bills (every 7 game days, so about 7 game weeks a real day): each car's upkeep (in CAR_MODELS), and 0.1% of
// the price of every building you own. For a full building that's about a fifth of what it earns.
export const UPKEEP_RATE = 0.001;
export function miles(tiles) { const m = Math.max(0, Number(tiles) || 0) * TILE_MILES;
  return m < 0.1 ? 'under 0.1 mi' : m < 10 ? `${Math.round(m * 10) / 10} mi` : `${Math.round(m)} mi`; }

// What renting a home costs up front: the moving-in fee (to the owner, less the treasury's cut, or to the colony) and the movers.
export function rentCost(type, fromXY, toXY) {
  const cap = capacities(type).homeCap || 1, fee = Math.max(100, Math.round(propertyPrice(type) / cap * RENT_FEE_SHARE / 10) * 10);
  const d = fromXY ? Math.abs(fromXY[0] - toXY[0]) + Math.abs(fromXY[1] - toXY[1]) : 0, movers = MOVERS_BASE + Math.round(d * MOVERS_PER_TILE);
  return { fee, movers, total: fee + movers, dist: d };
}

// Stars: how active a colonist is, from 1 to 12. Points come from things the player does themself (each action
// they take in the game, at most one every few seconds) plus 20 for every real day they play.
export const STAR_STEPS = [10, 30, 70, 130, 220, 350, 520, 750, 1050, 1450, 2000, 2800];
export const starsFor = score => STAR_STEPS.filter(s => score >= s).length;
export const STAR_DAY_POINTS = 20;
