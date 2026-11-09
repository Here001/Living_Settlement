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
// `level` (1–5) is how far its owner has upgraded it: each level adds 30% more homes, jobs and visitors.
export function capacities(type, level = 1) {
  const t = BUILDING_TYPES[type] || {}, m = levelMul(level), up = n => Math.round(n * m);
  return { homeCap: t.home ? up(t.home.capacity) : 0, jobCap: t.work ? up(t.work.slots) : 0, leisure: !!t.leisure,
    hangCap: t.leisure ? up(t.visitors || 10 * t.size[0] * t.size[1]) : 0,
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
// Take-home pay: the salary less its tax (which goes to the treasury) and the rent. The tax comes out of the wage;
// it used to be added on top, which made 20% more coins out of nothing every day.
export const netOf = (salary, rent) => salary - taxOf(salary) - rent;

// Balances aren't rewritten every day. Each one is stored as (amount, day, change per day)
// and worked out on demand. That makes paydays free no matter how many citizens there are.
// A wallet in the minus (a fine or bill bigger than cash and savings) stays in the minus until wages pay it back.
export const balanceOn = (base, fromDay, perDay, today) => { const v = Number(base) + Math.max(0, today - fromDay) * perDay; return Number(base) < 0 ? v : Math.max(0, v); };
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
// A colonist laying a surface on their own land pays three times what it costs the colony (at least 10 coins a tile).
export const isSurface = type => !!ROAD_TYPES[type] && !ROAD_TYPES[type].hidden && ROAD_TYPES[type].sub === 'surface';
export const paveCost = type => Math.max(10, Math.round(roadCost(type) * 3 / 5) * 5);
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
export const HEIST_CREW_BONUS = 0.04, HEIST_CAUGHT = { win: 0.15, lose: 0.7 }, HEIST_COOLDOWN = 20 * 1000, HEIST_WAIT = [5, 10, 20, 30, 60];
// Night (20:00 game time, through midnight, until 06:00): dark streets add 15 points.
export const NIGHT_FROM = 20 * 60, NIGHT_TO = 6 * 60, NIGHT_BONUS = 0.15;
export const isNight = gm => { const m = ((gm % 1440) + 1440) % 1440; return m >= NIGHT_FROM || m < NIGHT_TO; };
export function crimeOdds(kind, dist, wave = 0, night = false) {
  const band = dist == null || dist > CRIME_FAR ? 'high' : dist > CRIME_NEAR ? 'mid' : 'low';
  return { band, dist: dist == null ? null : dist, night: !!night, chance: Math.min(0.9, (CRIME_RATES[kind] || CRIME_RATES.rob)[band] + wave + (night ? NIGHT_BONUS : 0)) };
}

// Distances players see are in game miles: 20 tiles to the mile.
// "Go here": a colonist can head to any finished building except the jail and police stations, and not to trees or street furniture.
export const NO_GO = new Set(['jail', 'prison', 'police', 'commissariat', 'policeplaza', 'dispatch']);
export const canGoTo = type => { const t = BUILDING_TYPES[type]; return !!t && !NO_GO.has(type) && t.cat !== 'nature' && t.cat !== 'decor'; };
export const TILE_MILES = 0.05;
// Chatting: private messages are free between friends (once someone accepts your message request, you're friends, both
// ways, wherever you live); until then each message costs MESSAGE_FEE coins, paid from your cash to the treasury.
// Group messages are free when every member lives within NEIGHBOUR_TILES of you (about 2 miles: the same district).
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

// ---- Owning land and building on it ----
// How many properties a colonist may own grows with their stars: 5 up to 3 stars, then more with each star, 30 at 12.
// A plot of land counts as one property however much is built on it; a building bought on its own counts as one too.
const PROPERTY_LIMITS = [5, 5, 5, 5, 8, 10, 12, 15, 18, 21, 24, 27, 30];
export const propertyLimit = stars => PROPERTY_LIMITS[Math.max(0, Math.min(12, Math.floor(Number(stars) || 0)))];
export const PLOT_MIN = 2, PLOT_MAX = 8;

// Land auctions: the developer puts a prime patch of land up for auction. Each bid must beat the last by 5% (at least 100
// coins); a bid in the last 2 minutes pushes the end back to 2 minutes after it, so nobody can snatch it at the final second.
export const AUCTION_STEP = 0.05, AUCTION_STEP_MIN = 100, AUCTION_SNIPE = 2 * 60 * 1000;
export const AUCTION_MINUTES = [30, 60, 180, 360, 720, 1440, 2880];
export const nextBid = a => a.bids > 0 ? Math.max(a.top + AUCTION_STEP_MIN, Math.ceil(a.top * (1 + AUCTION_STEP) / 10) * 10) : a.start;

// Upgrades: every home, business or place to go out can be raised from level 1 to 5. Each level holds 30% more people,
// earns its owner 10% more on each of them, and looks grander; level 3 makes it a tile wider and level 5 a tile deeper,
// so those need the room (on its plot, or free ground beside a building that has no plot).
export const MAX_LEVEL = 5;
export const levelMul = lv => 1 + 0.3 * (clampLevel(lv) - 1);
export const levelPay = lv => 1 + 0.1 * (clampLevel(lv) - 1);
export const clampLevel = lv => Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(lv) || 1)));
export const upgradable = type => { const t = BUILDING_TYPES[type]; return !!t && !!(t.home || t.work || t.leisure) && type !== 'landing' && t.cat !== 'decor' && t.cat !== 'nature'; };
export function levelSize(type, lv = 1) {
  const t = BUILDING_TYPES[type]; if (!t) return [1, 1]; let [w, d] = t.size; lv = clampLevel(lv);
  if (upgradable(type)) { if (lv >= 3) w += 1; if (lv >= 5) d += 1; }
  return [w, d];
}

// Government charges, all paid into the colony treasury. Land: a survey, registering the title and stamp duty.
// Building: the planning permit and the inspection, plus connecting water and power for anything people live or work in.
export const LAND_CHARGES = [['survey', 'Land survey', 0.02, 150], ['registry', 'Title registration', 0.05, 100], ['stamp', 'Stamp duty', 0.03, 0]];
export const BUILD_CHARGES = [['permit', 'Building permit', 0.05, 50], ['inspect', 'Safety inspection', 0.01, 50], ['utility', 'Water & power hook-up', 0.03, 0]];
export const TRANSFER_TAX = 0.05; // a sale between colonists: 5% of the price goes to the treasury
function charges(list, base, skip) {
  const lines = list.filter(([k]) => !skip || !skip.has(k)).map(([k, name, rate, min]) => ({ k, name, amount: Math.round(Math.max(Math.min(min, base * 0.25), base * rate)) }));
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

// The price of land follows what the buildings around it are worth. `value` is what a typical home or business within
// 36 tiles sells for (more for an upgraded one; nearer ones count more), and `weight` how many buildings that is drawn from.
// A tile costs from 150 coins (bare outskirts) to 3,905 among the dearest buildings, so the biggest plot, 8×8, tops out at
// about 250,000. The price climbs steeply with what's around: next to cabins land is cheap, next to towers it's dear.
export const LAND_TILE_MIN = 150, LAND_TILE_MAX = 3905, LAND_RADIUS = 36, LAND_DEAR = 2000000;
export function landTilePrice(value, weight = 1) {
  if (!(value > 0) || !(weight > 0)) return LAND_TILE_MIN;
  const f = Math.min(1, Math.sqrt(value / LAND_DEAR)) * Math.min(1, weight / 3); // one lonely building lifts it less than a street of them
  return Math.round((LAND_TILE_MIN + (LAND_TILE_MAX - LAND_TILE_MIN) * f) / 5) * 5;
}
// What one nearby building adds: its sale price if it's a home or business (0 for parks, trees, decorations and the like).
export function siteValue(type, level = 1) { return earns(type) && BUILDING_TYPES[type]?.cat !== 'nature' ? propertyPrice(type) * levelMul(level) : 0; }
export function landQuote(w, d, value, weight) {
  const perTile = landTilePrice(value, weight), land = perTile * w * d, ch = charges(LAND_CHARGES, land);
  return { w, d, tiles: w * d, perTile, land, charges: ch.lines, chargesTotal: ch.total, total: land + ch.total };
}

// What a colonist pays to have something built on their own land. Homes and businesses cost 60% of what the same
// building costs to buy ready-made (you've paid for the land, and you wait for it); parks, trees and decorations cost
// three times what the colony pays, so a garden is cheap and a tower is not.
export const earns = type => fullIncome(type) > 0;
export function constructionCost(type) {
  const t = BUILDING_TYPES[type] || {};
  return earns(type) ? nicePrice(propertyPrice(type) * 0.6) : Math.max(20, Math.round((t.cost || 10) * 3 / 10) * 10);
}
// Building takes four times as long as when the colony builds it (at least 30 game minutes for anything bigger than a bench).
export function playerBuildMinutes(type) { const m = buildMinutes(type) * 4; return (BUILDING_TYPES[type]?.cost || 0) < 100 ? 0 : Math.max(30, m); }
export function buildQuote(type) {
  const cost = constructionCost(type), t = BUILDING_TYPES[type] || {}, ch = charges(BUILD_CHARGES, cost, (t.home || t.work) ? null : new Set(['utility']));
  return { type, cost, charges: ch.lines, chargesTotal: ch.total, total: cost + ch.total, minutes: playerBuildMinutes(type) };
}
// Raising a building to the next level: half its construction cost per level it will have gained, longer each time.
export function upgradeQuote(type, toLv) {
  toLv = clampLevel(toLv); const cost = nicePrice(constructionCost(type) * 0.5 * (toLv - 1)), ch = charges(BUILD_CHARGES.slice(0, 2), cost);
  const minutes = Math.max(60, Math.round(playerBuildMinutes(type) * (0.5 + 0.5 * toLv)));
  return { type, level: toLv, cost, charges: ch.lines, chargesTotal: ch.total, total: cost + ch.total, minutes, size: levelSize(type, toLv), grows: levelSize(type, toLv).join() !== levelSize(type, toLv - 1).join() };
}
// Paying the builders to work through the night: 3% of the job's cost for every game hour still to go (at least 20 coins an hour).
export function rushCost(cost, msLeft) { const hours = Math.max(1, Math.ceil(Math.max(0, msLeft) / (60 * GAME_MIN_MS))); return Math.round(hours * Math.max(20, cost * 0.03) / 10) * 10; }
// Bail: pay to walk out of jail early. 150 coins for every minute left (at least 300), from cash and then savings.
export const BAIL_PER_MIN = 150, BAIL_MIN = 300;
export const bailCost = msLeft => Math.max(BAIL_MIN, Math.ceil(Math.max(0, msLeft) / 60000) * BAIL_PER_MIN);

// ---------- The economy's dials ----------
// The first 8 solo jobs that come off each real day pay in full; after that each pays 4% less than the last, but never
// less than three quarters. It's back to full the next day (midnight UTC). Heists don't count and aren't cut.
export const CRIME_DECAY = 0.96, CRIME_FREE = 8, CRIME_FLOOR = 0.75;
// The most one job can take from the treasury, as a share of what it holds, so one crew can't empty the town.
export const CRIME_SHARE = { rob: 0.03, scam: 0.01, atm: 0.05, armored: 0.1, jailbreak: 0.04, bank: 0.2 };
export const realDayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const jobsToday = (c, t = Date.now()) => c && c.crime_day === realDayKey(t) ? Number(c.crime_today || 0) : 0;
export const crimePayMult = (c, t = Date.now()) => Math.max(CRIME_FLOOR, Math.pow(CRIME_DECAY, Math.max(0, jobsToday(c, t) + 1 - CRIME_FREE))); // what the next job pays

// ---- Keeping crime worth coming back to ----
// Hot streak: each job in a row that comes off makes the next one harder, but it pays 15% more for each, up to +60%.
// Getting caught ends the streak.
export const HOT_STEP = 0.15, HOT_MAX = 4;
export const hotMult = streak => 1 + HOT_STEP * Math.min(HOT_MAX, Math.max(0, Math.floor(Number(streak) || 0)));
// Getting caught: about a seventh of the takings on offer (at least 50, never more than 1,500), and never more than the
// thief has in cash and savings, so a bad game never puts anyone in debt.
export const FINE_SHARE = 0.15, FINE_MIN = 50, FINE_MAX = 1500;
export const crimeFine = base => Math.min(FINE_MAX, Math.max(FINE_MIN, Math.round((Number(base) || 0) * FINE_SHARE / 10) * 10));
// Criminal ranks: every real job earns XP (more for a better result), and so does each daily contract. Each rank adds
// 3% to everything you take, for good, and shows by your name in the Crime tab.
export const CRIME_RANKS = [
  { name: 'Pickpocket', icon: '🧤', xp: 0 }, { name: 'Hustler', icon: '🃏', xp: 100 }, { name: 'Prowler', icon: '🐈‍⬛', xp: 300 },
  { name: 'Smooth operator', icon: '🕶️', xp: 700 }, { name: 'Ringleader', icon: '🎩', xp: 1500 }, { name: 'Mastermind', icon: '🧠', xp: 3000 },
  { name: 'Kingpin', icon: '♠️', xp: 6000 }, { name: 'Legend of Gliese', icon: '🌒', xp: 12000 },
];
export const RANK_BONUS = 0.03;
export const CRIME_XP = { clean: 40, partial: 30, empty: 15, fined: 10, jailed: 10, heist: 30, perStreak: 5 };
export function rankOf(xp) { xp = Math.max(0, Number(xp) || 0); let i = 0; while (i + 1 < CRIME_RANKS.length && xp >= CRIME_RANKS[i + 1].xp) i++;
  const R0 = CRIME_RANKS[i], N = CRIME_RANKS[i + 1] || null; return { i, ...R0, total: xp, next: N, toNext: N ? N.xp - xp : 0, bonus: i * RANK_BONUS }; }
export const rankMult = xp => 1 + rankOf(xp).i * RANK_BONUS;
// Daily contracts: three challenges each real day, one easy, one medium and one hard, the same all day for each player.
// `n` is how many times it must happen. Each pays coins (from the treasury, scaled by the stabiliser) and XP; all three
// done pays a bonus on top. `needs` says what the colony must have for it to be possible (a shop to rob, a Bank).
export const CONTRACTS = [
  { id: 'tries3', tier: 1, n: 3, text: 'Try 3 jobs today, win or lose' },
  { id: 'rob1', tier: 1, n: 1, needs: 'shop', text: 'Pull off a shop robbery' },
  { id: 'scam1', tier: 1, n: 1, text: 'Con a tourist and get away with it' },
  { id: 'atm1', tier: 1, n: 1, needs: 'bank', text: 'Hack an ATM and get away with the cash' },
  { id: 'wins3', tier: 2, n: 3, text: 'Get away with 3 jobs today' },
  { id: 'ghost', tier: 2, n: 1, needs: 'shop', text: 'Rob a shop without the staff’s eye ever getting past half' },
  { id: 'grab2', tier: 2, n: 1, needs: 'shop', text: 'Grab 2 extra goods in one shop robbery and get out' },
  { id: 'nowire', tier: 2, n: 1, needs: 'bank', text: 'Hack an ATM without a single wrong move' },
  { id: 'streak2', tier: 2, n: 1, text: 'Get away with 2 jobs in a row' },
  { id: 'clean', tier: 3, n: 1, text: 'Make a Clean getaway (a score of 80 or more)' },
  { id: 'streak3', tier: 3, n: 1, text: 'Get away with 3 jobs in a row' },
  { id: 'heist', tier: 3, n: 1, text: 'Play your part in a heist when it goes down' },
];
export const CONTRACT_PAY = { 1: { coins: 300, xp: 30 }, 2: { coins: 600, xp: 60 }, 3: { coins: 1000, xp: 100 } }, CONTRACT_ALL = { coins: 1000, xp: 100 };
// Does this happening count towards the contract? `ev`: { solo, heist, kind, won, outcome, total, streak, state }.
export function contractHit(id, ev) {
  const st = ev.state || {};
  switch (id) {
    case 'tries3': return !!ev.solo;
    case 'rob1': return ev.solo && ev.kind === 'rob' && ev.won;
    case 'scam1': return ev.solo && ev.kind === 'scam' && ev.won;
    case 'atm1': return ev.solo && ev.kind === 'atm' && ev.won;
    case 'wins3': return !!(ev.solo && ev.won);
    case 'ghost': return ev.solo && ev.kind === 'rob' && ev.won && Number(st.peak) < 0.5;
    case 'grab2': return ev.solo && ev.kind === 'rob' && ev.won && Number(st.got) >= 2;
    case 'nowire': return ev.solo && ev.kind === 'atm' && ev.won && Number(st.wrongs) === 0;
    case 'streak2': return ev.solo && ev.won && ev.streak >= 2;
    case 'clean': return ev.solo && ev.outcome === 'clean';
    case 'streak3': return ev.solo && ev.won && ev.streak >= 3;
    case 'heist': return !!ev.heist;
  }
  return false;
}
// The day's three, picked from the player's id and the date (so everyone gets a different set, the same all day).
export function pickContracts(id, day, has = {}) {
  let h = 2166136261; for (const ch of String(id) + '|' + day) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const out = [];
  for (const tier of [1, 2, 3]) { const pool = CONTRACTS.filter(k => k.tier === tier && (!k.needs || has[k.needs])); out.push(pool[h % pool.length].id); h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; }
  return out;
}
export const contractOf = id => CONTRACTS.find(k => k.id === id) || null;
export const crimeCap = (kind, treasury) => CRIME_SHARE[kind] ? Math.max(0, Math.floor(treasury * CRIME_SHARE[kind])) : Math.max(0, Math.floor(treasury));
// Wealth tax: 0.5% a real day on cash plus savings above 250,000 (taken a game day at a time), paid to the treasury.
export const WEALTH_FREE = 250000, WEALTH_RATE = 0.005;
export const wealthTaxPerGameDay = total => Math.max(0, Math.floor((total - WEALTH_FREE) * WEALTH_RATE * DAY_MS / 86400000));
// Status: titles bought for coins, each 4× the last, shown by your name. The money goes to the treasury.
export const STATUS = [
  { name: 'Bronze', icon: '🥉', price: 50000 }, { name: 'Silver', icon: '🥈', price: 200000 }, { name: 'Gold', icon: '🥇', price: 800000 },
  { name: 'Platinum', icon: '💠', price: 3200000 }, { name: 'Diamond', icon: '💎', price: 12800000 }, { name: 'Legend', icon: '👑', price: 51200000 },
];
export const statusOf = tier => tier > 0 ? STATUS[Math.min(STATUS.length, tier) - 1] : null;
// The stabiliser: aims for the money in the colony to grow about 2% a real day (new players and building need some
// growth). Faster than that and crime takings, daily rewards and interest are trimmed; slower and they're loosened.
export const ECON = { target: 0.02, band: 0.01, step: 0.04, min: 0.5, max: 1.5 };
export const econF = meta => Math.max(ECON.min, Math.min(ECON.max, Number(meta?.econ?.f ?? 1)));
