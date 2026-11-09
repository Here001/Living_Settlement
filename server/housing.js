// Land and building on it, upgrades, and colonists selling property to each other.
//   - Land: a colonist marks out any empty patch of grass (2×2 to 8×8 tiles) beside a road and buys it. The price per tile
//     depends on where it is (dearer near the landing station and among many buildings), plus government charges.
//   - Building: on their own land they can have anything from the catalogue built (homes, offices, parks, decorations…),
//     paying the builders, a permit and an inspection. It takes time, and they can pay extra to rush it.
//   - Upgrades: any home, business or venue can be raised to level 5. More room for people, more income, a grander look;
//     levels 3 and 5 also make it bigger, which needs space on the plot (or free ground beside a building with no plot).
//   - Offers: a colonist offers to buy another's building or plot, with a message. The owner accepts, declines or
//     counters within 24 real hours. Coins are checked only when the deal is agreed; 5% of the price goes to the treasury.
// Every coin paid for land, building, charges and rushing goes into the colony treasury.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError, bRow, cleanTiles } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, roadClears } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';
import { dailyIncome, ownedCount, PROPERTY_RESALE } from './economy.js';

const uid = () => crypto.randomBytes(8).toString('hex');
const fmt = n => Math.round(n).toLocaleString('en-US');
const nameOf = b => b.name || BUILDING_TYPES[b.type]?.name || 'a building';
const OFFER_MS = 24 * 3600 * 1000, OFFER_MAX = 1e9, DEMOLISH_BACK = 0.3;
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const int = v => { const n = Math.trunc(Number(v)); if (!Number.isFinite(n) || Math.abs(n) > 100000) throw new HttpError(400, 'Bad position.'); return n; };

export class Housing {
  constructor(world) { this.world = world; this.expiredAt = 0; }
  lockMe(ch, id) { return this.world.economy.lockMe(ch, id); }

  // ---------- where things are ----------
  landing() { for (const b of this.world.buildings.values()) if (b.type === 'landing') return b; return null; }
  // Buildings within `r` tiles of a point, from the map held in memory (only the chunks around it are looked at).
  around(x, y, r) {
    const out = [], [c0, c1] = [R.chunkOf(x - r, y - r), R.chunkOf(x + r, y + r)];
    for (let cx = c0[0]; cx <= c1[0]; cx++) for (let cy = c0[1]; cy <= c1[1]; cy++) {
      const slot = this.world.chunks.get(R.chunkKey(cx, cy)); if (!slot) continue;
      for (const b of slot.buildings.values()) if (Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r) out.push(b);
    }
    return out;
  }
  // "near the Bakery, 0.3 mi north-east of the landing station"
  placeName(x, y) {
    const L = this.landing(); let near = null, nd = 1e9;
    for (const b of this.around(x, y, 14)) { const t = BUILDING_TYPES[b.type]; if (!t || !(b.name || R.majorBuilding(b.type) || t.cat === 'parks' || t.cat === 'shops')) continue;
      const d = Math.abs(b.x - x) + Math.abs(b.y - y); if (d > 0 && d < nd) { nd = d; near = b; } }
    const parts = []; if (near) parts.push(`near ${nameOf(near)}`);
    if (L) { const dx = x - L.x, dy = y - L.y, d = Math.hypot(dx, dy);
      // the map's x runs to the south-east of the screen and y to the south-west, so turn the angle by 45°
      parts.push(d < 4 ? 'by the landing station' : `${R.miles(d)} ${DIRS[Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 45 + 360) % 360) / 45) % 8]} of the landing station`); }
    return parts.join(', ');
  }

  // ---------- land ----------
  rect(b) {
    const x = int(b.x), y = int(b.y), w = int(b.w), d = int(b.d);
    if (w < R.PLOT_MIN || d < R.PLOT_MIN || w > R.PLOT_MAX || d > R.PLOT_MAX) throw new HttpError(400, `A plot is ${R.PLOT_MIN}×${R.PLOT_MIN} to ${R.PLOT_MAX}×${R.PLOT_MAX} tiles.`);
    return { x, y, w, d };
  }
  price({ x, y, w, d }) {
    const mx = x + w / 2, my = y + d / 2;
    // a typical home or business nearby: those within 36 tiles, the nearest counting most (fully next door, a tenth at the edge)
    let sum = 0, weight = 0, homes = 0;
    for (const b of this.around(Math.round(mx), Math.round(my), R.LAND_RADIUS)) { if (b.ruin || b.done === false) continue; const v = R.siteValue(b.type, b.lv); if (!v) continue;
      const bw = b.w || 1, bd = b.d || 1, dd = Math.max(0, Math.hypot(b.x + bw / 2 - mx, b.y + bd / 2 - my) - (w + bw) / 4), k = Math.max(0.1, 1 - dd / (R.LAND_RADIUS + 1));
      sum += v * k; weight += k; homes++; }
    const value = weight ? sum / weight : 0;
    return { ...R.landQuote(w, d, value, weight), homes, homeValue: Math.round(value), where: this.placeName(Math.round(mx), Math.round(my)) };
  }
  // What's in the way of buying this patch: water, roads, buildings (trees, rocks and benches are cleared), others' land,
  // land up for auction (except the auction asking, `auctionId`, when it hands the land to its winner), and no road beside it.
  async landProblems(q, { x, y, w, d }, auctionId = null) {
    const box = [x, y, w, d];
    if ((await q("select 1 from auctions where status = 'open' and id is distinct from $5::text and x < $1::int + $3::int and x + w > $1::int and y < $2::int + $4::int and y + d > $2::int limit 1", [...box, auctionId])).rowCount) return 'This land is up for auction. Tap it on the map to bid.';
    if ((await q('select 1 from plots where x < $1::int + $3::int and x + w > $1::int and y < $2::int + $4::int and y + d > $2::int limit 1', box)).rowCount) return "Part of it is someone's land already.";
    if ((await q('select 1 from roads where x >= $1::int and x < $1::int + $3::int and y >= $2::int and y < $2::int + $4::int limit 1', box)).rowCount) return 'There’s a road across it. Mark grass beside the road instead.';
    if ((await q('select 1 from water where x >= $1::int and x < $1::int + $3::int and y >= $2::int and y < $2::int + $4::int limit 1', box)).rowCount) return 'Part of it is water.';
    const under = (await q('select type from buildings where x < $1::int + $3::int and x + w > $1::int and y < $2::int + $4::int and y + d > $2::int', box)).rows;
    if (under.some(b => !roadClears(b.type))) return 'There are buildings on it. Pick empty grass.';
    const road = await q(`select 1 from roads where ((x = $1::int - 1 or x = $1::int + $3::int) and y >= $2::int and y < $2::int + $4::int)
      or ((y = $2::int - 1 or y = $2::int + $4::int) and x >= $1::int and x < $1::int + $3::int) limit 1`, box);
    if (!road.rowCount) return 'It needs a road along one side, so people can get to it.';
    return null;
  }
  async landQuote(id, body) {
    const r = this.rect(body || {}), q = (a, v) => pool.query(a, v), problem = await this.landProblems(q, r);
    const props = id ? await ownedCount(q, id) : 0, stars = id ? (await pool.query('select stars from citizens where id = $1', [id])).rows[0]?.stars || 0 : 0;
    return { ...r, ...this.price(r), problem, props, max: R.propertyLimit(stars) };
  }
  async buyLand(id, body) {
    const r = this.rect(body || {}), name = String(body?.name || '').trim().slice(0, 30);
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id), q = (a, v) => ch.q(a, v);
      const n = await ownedCount(q, c.id), max = R.propertyLimit(c.stars);
      if (n >= max) throw new HttpError(409, `With ${c.stars || 0} star${c.stars === 1 ? '' : 's'} you can own up to ${max} properties. Sell one first, or earn more stars.`);
      const problem = await this.landProblems(q, r); if (problem) throw new HttpError(409, problem);
      const p = this.price(r); ch.coins(c);
      if (c.coins_base < p.total) throw new HttpError(400, `This land costs ${fmt(p.total)} coins with the charges. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
      // trees, bushes, rocks and street furniture on it are cleared away
      for (const b of (await ch.q('select * from buildings where x < $1::int + $3::int and x + w > $1::int and y < $2::int + $4::int and y + d > $2::int for update', [r.x, r.y, r.w, r.d])).rows) await this.world.demolishIn(ch, b);
      const pid = uid(), [cx, cy] = R.chunkOf(r.x, r.y);
      await ch.q('insert into plots (id, owner_id, owner_handle, x, y, w, d, cx, cy, price, bought_at, name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [pid, c.id, c.handle, r.x, r.y, r.w, r.d, cx, cy, p.land, Date.now(), name]);
      ch.plots.add(pid);
      c.coins_base -= p.total; treasuryAdd(ch, p.total); track(ch, 'land:buy', p.land, c.id); track(ch, 'land:charges', p.chargesTotal, c.id); ch.touch(c); await ch.saveCitizen(c);
      await ch.event(`🗺️ @${c.handle} bought a ${r.w}×${r.d} plot of land ${p.where}.`, 'property');
      return { ok: true, plot: { id: pid, ...r }, paid: p.total, coins: c.coins_base };
    });
  }
  async plot(id, plotId) {
    const p = (await pool.query('select * from plots where id = $1', [String(plotId)])).rows[0]; if (!p) throw new HttpError(404, 'No such plot.');
    const on = (await pool.query('select * from buildings where plot_id = $1 order by built_at', [p.id])).rows;
    const mine = !!id && p.owner_id === id, worth = Number(p.price) + on.reduce((s, b) => s + Number(b.price || 0), 0), used = on.reduce((s, b) => s + b.w * b.d, 0);
    const out = { id: p.id, x: p.x, y: p.y, w: p.w, d: p.d, name: p.name || '', owner: p.owner_handle, mine, price: Number(p.price), worth, used, where: this.placeName(p.x + (p.w >> 1), p.y + (p.d >> 1)),
      buildings: on.map(b => ({ ...bRow(b), income: dailyIncome(b).net, price: Number(b.price || 0) })) };
    if (mine) { out.sell = Math.floor(worth * PROPERTY_RESALE); out.offers = await this.offersOn('plot', p.id); }
    return out;
  }
  async renamePlot(id, plotId, name) {
    return this.world.change(async ch => {
      const r = await ch.q('update plots set name = $3 where id = $1 and owner_id = $2 returning id', [String(plotId), id, String(name || '').trim().slice(0, 30)]);
      if (!r.rowCount) throw new HttpError(404, "You don't own that plot."); ch.plots.add(String(plotId)); return { ok: true };
    });
  }
  // Selling land back to the colony: 70% of what the land and everything on it cost. What's built on it stays, now the colony's.
  async sellPlot(id, plotId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const p = (await ch.q('select * from plots where id = $1 and owner_id = $2 for update', [String(plotId), c.id])).rows[0]; if (!p) throw new HttpError(404, "You don't own that plot.");
      const on = (await ch.q('select * from buildings where plot_id = $1 for update', [p.id])).rows;
      if (on.some(b => !b.done || Number(b.up_at))) throw new HttpError(409, 'Wait until the builders have finished.');
      const stuck = await this.world.economy.rehomePlanes(ch, c, on.map(b => b.id)); if (stuck) throw new HttpError(409, stuck);
      const back = Math.floor((Number(p.price) + on.reduce((s, b) => s + Number(b.price || 0), 0)) * PROPERTY_RESALE);
      ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); track(ch, 'land:sell', back, c.id); ch.touch(c); await ch.saveCitizen(c);
      for (const b of on) await ch.ownerChanged(b.id, p.owner_id, null); // the seller pays rent again if they live there
      await ch.q('update buildings set plot_id = null, owner_id = null, owner_handle = null, bought_at = null, price = null where plot_id = $1', [p.id]); for (const b of on) ch.buildings.add(b.id);
      await ch.q('delete from plots where id = $1', [p.id]); ch.removedPlots.set(p.id, R.chunkKey(p.cx, p.cy));
      await this.closeOffers(ch, 'plot', p.id, 'withdrawn');
      return { ok: true, back, coins: c.coins_base };
    });
  }

  // ---------- building on your land ----------
  async lockPlot(ch, c, plotId) {
    const p = (await ch.q('select * from plots where id = $1 for update', [String(plotId)])).rows[0];
    if (!p) throw new HttpError(404, 'No such plot.'); if (p.owner_id !== c.id) throw new HttpError(403, `That's @${p.owner_handle}'s land.`);
    return p;
  }
  inside(p, x, y, w, d) { return x >= p.x && y >= p.y && x + w <= p.x + p.w && y + d <= p.y + p.d; }
  buildQuote(type) { if (!BUILDING_TYPES[type] || type === 'landing') throw new HttpError(400, 'Unknown building type.'); return R.buildQuote(type); }
  async buildOn(id, plotId, body) {
    const type = String(body?.type || ''), q = this.buildQuote(type), rot = R.cleanRot(body?.rot), x = int(body?.x), y = int(body?.y), name = String(body?.name || '').trim().slice(0, 40);
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id), p = await this.lockPlot(ch, c, plotId), [w, d] = R.footprint(R.levelSize(type, 1), rot);
      if (!this.inside(p, x, y, w, d)) throw new HttpError(409, `It doesn't fit there: keep it inside your ${p.w}×${p.d} plot.`);
      await this.unpave(ch, x, y, w, d);
      await this.world.assertFree(ch, type, x, y, null, rot, { plot: p.id });
      ch.coins(c); if (c.coins_base < q.total) throw new HttpError(400, `That costs ${fmt(q.total)} coins with the charges. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
      c.coins_base -= q.total; treasuryAdd(ch, q.total); track(ch, 'build:own', q.cost, c.id); track(ch, 'build:charges', q.chargesTotal, c.id); ch.touch(c); await ch.saveCitizen(c);
      const b = await this.world.insertBuilding(ch, { type, x, y, rot, name, plotId: p.id, owner: c, price: q.cost, minutes: q.minutes, instant: false });
      if (b.done) await ch.fillVacancies();
      else if (R.majorBuilding(type)) await ch.event(`🏗️ @${c.handle} started building ${name || BUILDING_TYPES[type].name} on their land. Ready in ${Math.round(q.minutes / 60)} game hours.`, 'build');
      return { ok: true, building: bRow(b), paid: q.total, coins: c.coins_base };
    });
  }
  // ---------- paving your land ----------
  // Lifting the paving under something about to be built on your own land (it's all inside the plot, so it's yours).
  async unpave(ch, x, y, w, d) {
    const gone = (await ch.q('delete from roads where x >= $1::int and x < $1::int + $3::int and y >= $2::int and y < $2::int + $4::int returning x, y', [x, y, w, d])).rows.map(r => `${r.x},${r.y}`);
    if (gone.length) this.world.roadOps(ch, {}, gone);
  }
  // Laying surfaces (brick, marble, decking, stepping stones…) on your own land, tile by tile, or lifting them again.
  // `set`: tile "x,y" → surface; `remove`: tiles to clear. Only on the plot's open ground, never under a building.
  // Each tile costs what the price list says (paid to the treasury); lifting it is free.
  async pave(id, plotId, body) {
    const set = body?.set && typeof body.set === 'object' ? body.set : {}, remove = Array.isArray(body?.remove) ? body.remove : [];
    const keys = Object.keys(set).filter(k => /^-?\d+,-?\d+$/.test(k)).slice(0, 64), rm = remove.filter(k => /^-?\d+,-?\d+$/.test(String(k))).slice(0, 64).map(String);
    for (const k of keys) if (!R.isSurface(set[k])) throw new HttpError(400, 'Pick a surface from the Surfaces list.');
    if (!keys.length && !rm.length) throw new HttpError(400, 'Tap the tiles to pave.');
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id), p = await this.lockPlot(ch, c, plotId), xy = k => k.split(',').map(Number), on = k => { const [x, y] = xy(k); return this.inside(p, x, y, 1, 1); };
      if (![...keys, ...rm].every(on)) throw new HttpError(409, `Keep it inside your ${p.w}×${p.d} plot.`);
      const all = [...keys, ...rm], xs = all.map(k => xy(k)[0]), ys = all.map(k => xy(k)[1]);
      const under = new Set((await ch.q(`select t.x || ',' || t.y k from unnest($1::int[], $2::int[]) t(x, y) join buildings b on t.x >= b.x and t.x < b.x + b.w and t.y >= b.y and t.y < b.y + b.d`, [xs, ys])).rows.map(r => r.k));
      const wet = new Set((await ch.q(`select x || ',' || y k from water where (x, y) in (select * from unnest($1::int[], $2::int[]))`, [xs, ys])).rows.map(r => r.k));
      const now = new Map((await ch.q(`select x || ',' || y k, type from roads where (x, y) in (select * from unnest($1::int[], $2::int[]))`, [xs, ys])).rows.map(r => [r.k, r.type]));
      const toSet = {}; let cost = 0;
      for (const k of keys) { if (under.has(k) || wet.has(k) || now.get(k) === set[k]) continue; toSet[k] = set[k]; cost += R.paveCost(set[k]); }
      const toRm = rm.filter(k => now.has(k) && !toSet[k]);
      if (!Object.keys(toSet).length && !toRm.length) return { ok: true, changed: 0, laid: 0, lifted: 0, paid: 0, coins: (ch.coins(c), c.coins_base) };
      ch.coins(c); if (c.coins_base < cost) throw new HttpError(400, `That paving costs ${fmt(cost)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
      if (cost) { c.coins_base -= cost; treasuryAdd(ch, cost); track(ch, 'build:pave', cost, c.id); ch.touch(c); await ch.saveCitizen(c); }
      const ks = Object.keys(toSet);
      if (ks.length) await ch.q(`insert into roads (x, y, type, cx, cy) select x, y, t, floor(x::float / ${R.CHUNK})::int, floor(y::float / ${R.CHUNK})::int
          from unnest($1::int[], $2::int[], $3::text[]) u(x, y, t) on conflict (x, y) do update set type = excluded.type`, [ks.map(k => xy(k)[0]), ks.map(k => xy(k)[1]), ks.map(k => toSet[k])]);
      if (toRm.length) await ch.q('delete from roads where (x, y) in (select * from unnest($1::int[], $2::int[]))', [toRm.map(k => xy(k)[0]), toRm.map(k => xy(k)[1])]);
      this.world.roadOps(ch, toSet, toRm);
      return { ok: true, changed: ks.length + toRm.length, laid: ks.length, lifted: toRm.length, paid: cost, coins: c.coins_base };
    });
  }
  // A line of fence, wall or hedge on your land, dragged out like a road: one on every free tile of your plot along it.
  async buildLineOn(id, plotId, body) {
    const type = String(body?.type || ''), q = this.buildQuote(type), t = BUILDING_TYPES[type];
    if (t.size[0] !== 1 || t.size[1] !== 1 || q.minutes) throw new HttpError(400, 'Only fences, walls, hedges and other small things can be laid in a line.');
    const list = cleanTiles(body?.tiles, 64); if (!list.length) throw new HttpError(400, 'Drag along your plot first.');
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id), p = await this.lockPlot(ch, c, plotId), ok = [];
      for (const [x, y] of list) { if (!this.inside(p, x, y, 1, 1)) continue; if ((await ch.q('select 1 from buildings where x <= $1 and x + w > $1 and y <= $2 and y + d > $2 limit 1', [x, y])).rowCount) continue;
        if ((await ch.q('select 1 from water where x = $1 and y = $2', [x, y])).rowCount) continue; ok.push([x, y]); }
      if (!ok.length) throw new HttpError(409, 'Those tiles are taken or off your plot. Drag over free ground on your plot.');
      const total = q.total * ok.length; ch.coins(c);
      if (c.coins_base < total) throw new HttpError(400, `${ok.length} × ${t.name} costs ${fmt(total)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
      c.coins_base -= total; treasuryAdd(ch, total); track(ch, 'build:own', q.cost * ok.length, c.id); track(ch, 'build:charges', q.chargesTotal * ok.length, c.id); ch.touch(c); await ch.saveCitizen(c);
      const built = []; for (const [x, y] of ok) { await this.unpave(ch, x, y, 1, 1); built.push(bRow(await this.world.insertBuilding(ch, { type, x, y, plotId: p.id, owner: c, price: q.cost, minutes: 0, instant: false }))); }
      return { ok: true, built: built.length, skipped: list.length - ok.length, paid: total, coins: c.coins_base };
    });
  }
  // Knocking down your own building on your land: the builders give back 30% of what it cost.
  async knockDown(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 and owner_id = $2 for update', [String(buildingId), c.id])).rows[0];
      if (!b || !b.plot_id) throw new HttpError(404, "That isn't a building on your land.");
      const stuck = await this.world.economy.rehomePlanes(ch, c, [b.id]); if (stuck) throw new HttpError(409, stuck);
      const back = Math.floor(Number(b.price || 0) * DEMOLISH_BACK);
      await this.world.demolishIn(ch, { ...b, owner_id: null }); // (no owner, so demolishing doesn't refund the full price)
      if (back) { ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); track(ch, 'property:refund', back, c.id); ch.touch(c); await ch.saveCitizen(c); }
      await ch.fillVacancies();
      return { ok: true, back };
    });
  }
  // Renaming a building you own (on your land or bought): just the sign over the door.
  async renameBuilding(id, buildingId, name) {
    name = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return this.world.change(async ch => {
      const b = (await ch.q('select id, type, name from buildings where id = $1 and owner_id = $2 for update', [String(buildingId), id])).rows[0];
      if (!b) throw new HttpError(404, "You don't own that building.");
      if (b.type === 'landing') throw new HttpError(409, "The landing site keeps its name.");
      await ch.q('update buildings set name = $2 where id = $1', [b.id, name]); ch.buildings.add(b.id);
      return { ok: true, name: name || BUILDING_TYPES[b.type]?.name || '' };
    });
  }
  // Moving (and turning) a building you built on your own land: it can go anywhere free on that same plot, never off it.
  async moveBuilding(id, buildingId, body) {
    const x = int(body?.x), y = int(body?.y), rot = body?.rot == null ? null : R.cleanRot(body.rot);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, 'Bad position.');
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 for update', [String(buildingId)])).rows[0];
      if (!b || b.owner_id !== c.id) throw new HttpError(404, "You don't own that building.");
      if (!b.plot_id) throw new HttpError(409, 'Only buildings you built on your own land can be moved, and only within that plot.');
      if (Number(b.up_at) > 0) throw new HttpError(409, 'Wait until the upgrade is finished.');
      const p = await this.lockPlot(ch, c, b.plot_id), [w, d] = R.footprint(R.levelSize(b.type, b.level || 1), rot ?? b.rot);
      if (!this.inside(p, x, y, w, d)) throw new HttpError(409, `It has to stay inside your ${p.w}×${p.d} plot.`);
      await this.unpave(ch, x, y, w, d);
      return this.world.moveIn(ch, b, x, y, rot);
    });
  }
  // Paying to finish construction or an upgrade right away.
  async rush(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 and owner_id = $2 for update', [String(buildingId), c.id])).rows[0];
      if (!b) throw new HttpError(404, "You don't own that building.");
      const up = Number(b.up_at) > 0, until = up ? Number(b.up_at) : Number(b.ready_at); if (!up && b.done) throw new HttpError(409, "It's already finished.");
      const cost = R.rushCost(up ? Number(b.up_cost) : Number(b.price || R.constructionCost(b.type)), until - Date.now());
      ch.coins(c); if (c.coins_base < cost) throw new HttpError(400, `Rushing it costs ${fmt(cost)} coins. You have ${fmt(c.coins_base)} on you.`);
      c.coins_base -= cost; treasuryAdd(ch, cost); track(ch, 'build:rush', cost, c.id); ch.touch(c); await ch.saveCitizen(c);
      if (up) await this.finishUpgrade(ch, b, true); else { await this.world.finishIn(ch, b, { quiet: true }); await ch.fillVacancies(); }
      return { ok: true, paid: cost, coins: c.coins_base };
    });
  }

  // ---------- upgrades ----------
  // Where the bigger building would stand: it grows away from its north corner, so x and y stay put.
  upgradeInfo(b) {
    const lv = b.level || 1; if (!R.upgradable(b.type) || lv >= R.MAX_LEVEL) return null;
    const qq = R.upgradeQuote(b.type, lv + 1), [w, d] = R.footprint(qq.size, b.rot || 0), extra = w * d - b.w * b.d;
    return { ...qq, w, d, extra, from: R.capacities(b.type, lv), to: R.capacities(b.type, lv + 1) };
  }
  async upgradeQuote(id, buildingId) {
    const b = (await pool.query('select * from buildings where id = $1', [String(buildingId)])).rows[0]; if (!b) throw new HttpError(404, 'No such building.');
    const u = this.upgradeInfo(b); if (!u) return { max: true, level: b.level || 1 };
    let land = 0, problem = null;
    if (u.extra > 0) {
      if (b.plot_id) { const p = (await pool.query('select * from plots where id = $1', [b.plot_id])).rows[0]; if (!p || !this.inside(p, b.x, b.y, u.w, u.d)) problem = `It grows to ${u.w}×${u.d} tiles at level ${u.level}: there isn't room on your plot.`; }
      else { land = this.price({ x: b.x, y: b.y, w: u.w, d: u.d }).perTile * u.extra; }
      if (!problem) try { await this.world.assertFree({ q: (a, v) => pool.query(a, v) }, b.type, b.x, b.y, b.id, b.rot, { level: u.level, plot: b.plot_id }); }
        catch (e) { problem = `It grows to ${u.w}×${u.d} tiles at level ${u.level}, and the ground beside it isn't clear: ${e.message}`; }
    }
    return { ...u, land, total: u.total + land, problem, busy: !b.done || Number(b.up_at) > 0 };
  }
  async upgrade(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 for update', [String(buildingId)])).rows[0];
      if (!b || b.owner_id !== c.id) throw new HttpError(404, "You don't own that building.");
      if (!b.done || Number(b.up_at) > 0) throw new HttpError(409, 'The builders are already at work on it.'); if (b.ruin) throw new HttpError(409, "It's in ruins.");
      const u = this.upgradeInfo(b); if (!u) throw new HttpError(409, R.upgradable(b.type) ? "It's at the top level already." : "This can't be upgraded.");
      let land = 0;
      if (u.extra > 0) {
        if (b.plot_id) { const p = (await ch.q('select * from plots where id = $1', [b.plot_id])).rows[0]; if (!p || !this.inside(p, b.x, b.y, u.w, u.d)) throw new HttpError(409, `At level ${u.level} it needs ${u.w}×${u.d} tiles: there isn't room on your plot.`); }
        else land = this.price({ x: b.x, y: b.y, w: u.w, d: u.d }).perTile * u.extra;
        await this.world.assertFree(ch, b.type, b.x, b.y, b.id, b.rot, { level: u.level, plot: b.plot_id });
      }
      const total = u.total + land; ch.coins(c);
      if (c.coins_base < total) throw new HttpError(400, `The upgrade costs ${fmt(total)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
      c.coins_base -= total; treasuryAdd(ch, total); track(ch, 'build:upgrade', u.cost + land, c.id); track(ch, 'build:charges', u.chargesTotal, c.id); ch.touch(c); await ch.saveCitizen(c);
      // the scaffolding takes the new ground straight away; the extra rooms open when it's done
      await ch.q('update buildings set w = $2, d = $3, up_at = $4, up_cost = $5, price = coalesce(price, 0) + $6 where id = $1', [b.id, u.w, u.d, Date.now() + u.minutes * R.GAME_MIN_MS, u.cost, u.cost + land]);
      ch.buildings.add(b.id);
      return { ok: true, paid: total, coins: c.coins_base, minutes: u.minutes, level: u.level };
    });
  }
  async finishUpgrade(ch, b, quiet = false) {
    const lv = R.clampLevel((b.level || 1) + 1), cap = R.capacities(b.type, lv);
    const r = (await ch.q('update buildings set level = $2, up_at = 0, up_cost = 0, home_cap = $3, job_cap = $4, hang_cap = $5 where id = $1 and up_at > 0 returning *', [b.id, lv, cap.homeCap, cap.jobCap, cap.hangCap])).rows[0];
    if (!r) return false; ch.buildings.add(b.id);
    await this.world.attractVisitors(ch, r);
    if (r.owner_id && !quiet) await this.world.actions?.notify(ch, r.owner_id, 'build', `⬆️ ${nameOf(r)} is now level ${lv}: room for ${cap.homeCap ? `${cap.homeCap} residents` : cap.jobCap ? `${cap.jobCap} workers` : `${cap.hangCap} visitors`}.`);
    await ch.fillVacancies();
    return true;
  }
  async finishUpgrades() {
    return this.world.change(async ch => {
      const rows = (await ch.q('select * from buildings where up_at > 0 and up_at <= $1 order by up_at limit 200 for update', [Date.now()])).rows;
      for (const b of rows) await this.finishUpgrade(ch, b);
      return { finished: rows.length };
    });
  }

  // ---------- offers between colonists ----------
  async target(q, kind, targetId) {
    if (kind === 'plot') { const p = (await q('select * from plots where id = $1', [String(targetId)])).rows[0]; if (!p) throw new HttpError(404, 'No such plot.');
      return { kind, id: p.id, owner_id: p.owner_id, owner_handle: p.owner_handle, label: p.name || `a ${p.w}×${p.d} plot` + ((await q('select count(*) n from buildings where plot_id = $1', [p.id])).rows[0].n > 0 ? ' and what stands on it' : '') }; }
    const b = (await q('select * from buildings where id = $1', [String(targetId)])).rows[0]; if (!b) throw new HttpError(404, 'No such building.');
    if (b.plot_id) return this.target(q, 'plot', b.plot_id); // a building on someone's land is sold with the land
    if (!b.owner_id) throw new HttpError(409, "It belongs to the colony: buy it straight from its card.");
    return { kind: 'building', id: b.id, owner_id: b.owner_id, owner_handle: b.owner_handle, label: nameOf(b) };
  }
  async makeOffer(id, body) {
    const amount = Math.floor(Number(body?.amount)), message = String(body?.message || '').trim().slice(0, 200);
    if (!(amount >= 1 && amount <= OFFER_MAX)) throw new HttpError(400, 'Offer a number of coins.');
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id), q = (a, v) => ch.q(a, v), t = await this.target(q, body?.kind === 'plot' ? 'plot' : 'building', body?.targetId);
      if (t.owner_id === c.id) throw new HttpError(409, 'You own it already.');
      if ((await ch.q("select 1 from offers where from_id = $1 and kind = $2 and target_id = $3 and status in ('open', 'countered') and expires_at > $4", [c.id, t.kind, t.id, Date.now()])).rowCount) throw new HttpError(409, 'You already have an offer waiting on this. Wait for the answer, or withdraw it first.');
      if (Number((await ch.q("select count(*) n from offers where from_id = $1 and status in ('open', 'countered') and expires_at > $2", [c.id, Date.now()])).rows[0].n) >= 10) throw new HttpError(429, 'You have 10 offers waiting already.');
      const oid = uid(), now = Date.now();
      await ch.q('insert into offers (id, kind, target_id, label, from_id, from_handle, to_id, to_handle, amount, message, created_at, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [oid, t.kind, t.id, t.label, c.id, c.handle, t.owner_id, t.owner_handle, amount, message, now, now + OFFER_MS]);
      await this.world.actions?.notify(ch, t.owner_id, 'offer', `🤝 @${c.handle} offers ${fmt(amount)} coins for ${t.label}${message ? `: “${message}”` : '.'} Answer within 24 hours in Chats → 🤝 Offers.`);
      return { ok: true, id: oid };
    });
  }
  offerOut(o, me) {
    return { id: o.id, kind: o.kind, targetId: o.target_id, label: o.label, from: o.from_handle, to: o.to_handle, amount: Number(o.amount), counter: o.counter == null ? null : Number(o.counter),
      message: o.message, reply: o.reply, status: o.status, at: Number(o.created_at), expires: Number(o.expires_at), mine: o.from_id === me };
  }
  async offers(id) {
    await this.expireOffers(true);
    const rows = (await pool.query("select * from offers where ((to_id = $1 and not to_hidden) or (from_id = $1 and not from_hidden)) and (status in ('open', 'countered') or closed_at > $2) order by created_at desc limit 100", [id, Date.now() - 7 * 86400000])).rows;
    return { incoming: rows.filter(o => o.to_id === id).map(o => this.offerOut(o, id)), outgoing: rows.filter(o => o.from_id === id).map(o => this.offerOut(o, id)), tax: R.TRANSFER_TAX };
  }
  async offersOn(kind, targetId) { return (await pool.query("select * from offers where kind = $1 and target_id = $2 and status in ('open', 'countered') and expires_at > $3 order by amount desc", [kind, targetId, Date.now()])).rows.map(o => this.offerOut(o, o.to_id)); }
  async closeOffers(ch, kind, targetId, status, except = null) {
    const rows = (await ch.q("update offers set status = $3, closed_at = $4 where kind = $1 and target_id = $2 and status in ('open', 'countered') and id is distinct from $5 returning *", [kind, targetId, status, Date.now(), except])).rows;
    for (const o of rows) await this.world.actions?.notify(ch, o.from_id, 'offer', `🤝 Your offer for ${o.label} is closed: ${status === 'sold' ? 'it was sold to someone else' : 'the owner sold it to the colony'}.`);
  }
  // The owner answers: accept, decline, or counter with another price. The buyer answers a counter: accept or decline. The buyer can withdraw.
  async answer(id, offerId, body) {
    const act = String(body?.action || ''), reply = String(body?.reply || '').trim().slice(0, 200);
    return this.world.change(async ch => {
      const o = (await ch.q('select * from offers where id = $1 for update', [String(offerId)])).rows[0]; if (!o) throw new HttpError(404, 'No such offer.');
      if (act === 'delete') { // take it off your list: an open offer you made is withdrawn first; one made to you must be answered first
        if (o.from_id !== id && o.to_id !== id) throw new HttpError(403, 'That offer is not yours.');
        const live = ['open', 'countered'].includes(o.status) && Number(o.expires_at) > Date.now();
        if (live && o.to_id === id) throw new HttpError(409, 'Answer the offer first (accept, counter or decline).');
        if (live) { await ch.q("update offers set status = 'withdrawn', closed_at = $2 where id = $1", [o.id, Date.now()]); await this.world.actions?.notify(ch, o.to_id, 'offer', `🤝 @${o.from_handle} withdrew their offer for ${o.label}.`); }
        await ch.q(`update offers set ${o.from_id === id ? 'from_hidden' : 'to_hidden'} = true where id = $1`, [o.id]); return { ok: true, status: 'deleted' };
      }
      if (!['open', 'countered'].includes(o.status) || Number(o.expires_at) <= Date.now()) throw new HttpError(409, 'That offer is closed.');
      const seller = o.to_id === id, buyer = o.from_id === id; if (!seller && !buyer) throw new HttpError(403, 'That offer is not yours.');
      const close = async status => ch.q('update offers set status = $2, reply = $3, closed_at = $4 where id = $1', [o.id, status, reply || o.reply, Date.now()]);
      if (act === 'withdraw' && buyer) { await close('withdrawn'); await this.world.actions?.notify(ch, o.to_id, 'offer', `🤝 @${o.from_handle} withdrew their offer for ${o.label}.`); return { ok: true, status: 'withdrawn' }; }
      if (act === 'decline') {
        if (seller ? o.status !== 'open' : o.status !== 'countered') throw new HttpError(409, seller ? 'You countered: wait for their answer.' : 'Wait for the owner to answer.');
        await close('declined'); await this.world.actions?.notify(ch, seller ? o.from_id : o.to_id, 'offer', seller ? `🤝 @${o.to_handle} turned down your ${fmt(o.amount)} coin offer for ${o.label}${reply ? `: “${reply}”` : '.'}` : `🤝 @${o.from_handle} turned down your counter of ${fmt(o.counter)} for ${o.label}${reply ? `: “${reply}”` : '.'}`);
        return { ok: true, status: 'declined' };
      }
      if (act === 'counter' && seller) {
        if (o.status !== 'open') throw new HttpError(409, 'You countered already.');
        const amt = Math.floor(Number(body?.amount)); if (!(amt >= 1 && amt <= OFFER_MAX)) throw new HttpError(400, 'Counter with a number of coins.');
        await ch.q("update offers set status = 'countered', counter = $2, reply = $3, expires_at = $4 where id = $1", [o.id, amt, reply, Date.now() + OFFER_MS]);
        await this.world.actions?.notify(ch, o.from_id, 'offer', `🤝 @${o.to_handle} wants ${fmt(amt)} coins for ${o.label} (you offered ${fmt(o.amount)})${reply ? `: “${reply}”` : '.'} Accept or decline within 24 hours (Home tab).`);
        return { ok: true, status: 'countered' };
      }
      if (act === 'accept') {
        if (seller ? o.status !== 'open' : o.status !== 'countered') throw new HttpError(409, seller ? 'You countered: wait for their answer.' : 'Wait for the owner to answer.');
        return this.transfer(ch, o, seller ? Number(o.amount) : Number(o.counter), reply);
      }
      throw new HttpError(400, 'Accept, decline or counter.');
    });
  }
  // The deal: the buyer's coins are checked now (cash first, then savings). 5% goes to the treasury, the rest to the seller.
  async transfer(ch, o, price, reply) {
    const q = (a, v) => ch.q(a, v), fail = async why => { await ch.q("update offers set status = 'failed', reply = $2, closed_at = $3 where id = $1", [o.id, why, Date.now()]);
      await this.world.actions?.notify(ch, o.from_id, 'offer', `🤝 The deal for ${o.label} fell through: ${why}`); await this.world.actions?.notify(ch, o.to_id, 'offer', `🤝 The deal for ${o.label} fell through: ${why}`); return { ok: false, status: 'failed', why }; };
    const t = await this.target(q, o.kind, o.target_id).catch(() => null);
    if (!t || t.owner_id !== o.to_id) return fail(`@${o.to_handle} doesn't own it any more.`);
    const ids = [o.from_id, o.to_id].sort(), locked = new Map();
    for (const cid of ids) locked.set(cid, (await ch.q('select * from citizens where id = $1 for update', [cid])).rows[0]);
    const buyer = locked.get(o.from_id), seller = locked.get(o.to_id); if (!buyer || !seller) return fail('one of you has left the colony.');
    if (o.kind === 'plot') { if ((await ch.q('select 1 from buildings where plot_id = $1 and (not done or up_at > 0)', [t.id])).rowCount) throw new HttpError(409, 'Wait until the builders have finished on it.'); }
    else { const b = (await ch.q('select done, up_at from buildings where id = $1', [t.id])).rows[0]; if (!b?.done || Number(b.up_at)) throw new HttpError(409, 'Wait until the builders have finished on it.'); }
    const lost = o.kind === 'plot' ? (await ch.q('select id from buildings where plot_id = $1', [t.id])).rows.map(b => b.id) : [t.id];
    const stuck = await this.world.economy.rehomePlanes(ch, seller, lost); if (stuck) return fail(`@${seller.handle}'s planes: ${stuck}`);
    const n = await ownedCount(q, buyer.id), max = R.propertyLimit(buyer.stars);
    if (n >= max) return fail(`@${buyer.handle} already owns ${n} properties, their limit at ${buyer.stars || 0} stars.`);
    ch.coins(buyer); const cash = Math.max(0, buyer.coins_base), bank = Number(buyer.bank || 0);
    if (cash + bank < price) return fail(`@${buyer.handle} doesn't have ${fmt(price)} coins (cash and savings) right now.`);
    const fromCash = Math.min(cash, price), fromBank = price - fromCash, tax = Math.round(price * R.TRANSFER_TAX), net = price - tax;
    buyer.coins_base -= fromCash; ch.touch(buyer); await ch.saveCitizen(buyer); if (fromBank) await ch.q('update citizens set bank = bank - $2 where id = $1', [buyer.id, fromBank]);
    ch.coins(seller); seller.coins_base += net; ch.touch(seller); await ch.saveCitizen(seller);
    treasuryAdd(ch, tax); track(ch, 'property:offer', price, buyer.id); track(ch, 'property:sale', net, seller.id);
    const now = Date.now();
    if (o.kind === 'plot') {
      const p = (await ch.q('select * from plots where id = $1 for update', [t.id])).rows[0], on = (await ch.q('select * from buildings where plot_id = $1 for update', [t.id])).rows;
      const old = Number(p.price) + on.reduce((s, b) => s + Number(b.price || 0), 0), k = old > 0 ? price / old : 1; // what each part is worth now follows what was paid
      await ch.q('update plots set owner_id = $2, owner_handle = $3, bought_at = $4, price = $5 where id = $1', [p.id, buyer.id, buyer.handle, now, Math.round(Number(p.price) * k)]); ch.plots.add(p.id);
      for (const b of on) { await ch.ownerChanged(b.id, seller.id, buyer.id); await ch.q('update buildings set owner_id = $2, owner_handle = $3, bought_at = $4, price = $5 where id = $1', [b.id, buyer.id, buyer.handle, now, Math.round(Number(b.price || 0) * k)]); ch.buildings.add(b.id); }
    } else { await ch.ownerChanged(t.id, seller.id, buyer.id); await ch.q('update buildings set owner_id = $2, owner_handle = $3, bought_at = $4, price = $5 where id = $1', [t.id, buyer.id, buyer.handle, now, price]); ch.buildings.add(t.id); }
    await ch.q("update offers set status = 'accepted', reply = $2, closed_at = $3 where id = $1", [o.id, reply || o.reply, now]);
    await this.closeOffers(ch, o.kind, t.id, 'sold', o.id);
    await this.world.actions?.notify(ch, buyer.id, 'offer', `🔑 Deal! ${o.label} is yours for ${fmt(price)} coins${fromBank ? ` (${fmt(fromBank)} came from your savings)` : ''}.`);
    await this.world.actions?.notify(ch, seller.id, 'offer', `🔑 Sold! @${buyer.handle} bought ${o.label} for ${fmt(price)} coins. You got ${fmt(net)} after the ${Math.round(R.TRANSFER_TAX * 100)}% transfer tax.`);
    await ch.event(`🔑 @${buyer.handle} bought ${o.label} from @${seller.handle} for ${fmt(price)} coins.`, 'property');
    return { ok: true, status: 'accepted', price, tax };
  }
  // Offers nobody answered within 24 hours close by themselves (checked at most once a minute).
  async expireOffers(quiet = false) {
    if (Date.now() - this.expiredAt < 60000) return; this.expiredAt = Date.now();
    const due = (await pool.query("select 1 from offers where status in ('open', 'countered') and expires_at <= $1 limit 1", [Date.now()])).rowCount; if (!due) return;
    await this.world.change(async ch => {
      const rows = (await ch.q("select * from offers where status in ('open', 'countered') and expires_at <= $1 for update", [Date.now()])).rows;
      if (rows.length) await ch.q("update offers set status = 'expired', closed_at = $2 where id = any($1)", [rows.map(o => o.id), Date.now()]);
      for (const o of rows) await this.world.actions?.notify(ch, o.from_id, 'offer', o.status === 'countered' ? `🤝 The counter-offer for ${o.label} ran out of time.` : `🤝 @${o.to_handle} didn't answer your offer for ${o.label} within 24 hours.`);
    }).catch(e => { if (!quiet) console.error('offers:', e.message); });
  }
}
