// Riding in someone else's car, in the 3D town. A player out on foot walks up to a car another player is driving and
// asks for a ride; the driver lets them in (or not). A car has as many seats as its model (shared/catalog.js seatsOf:
// 2 in the sports cars, 4 in the rest), the driver's included. Riders go wherever the car goes: everyone else's maps
// show them in it, and their own screen follows it from their seat. A rider gets out when they like; everyone gets out
// when the driver does (gets out, stops driving, or leaves the game). Kept in memory, like calls (one server).
import { seatsOf } from '../shared/catalog.js';

const ASK_MS = 20000;   // how long an ask waits for the driver
const NEAR = 1.2;       // tiles: how close you must be to the car to ask (about 10 m)

export class Rides {
  // send(id, msg): to that player's connections; publish(ops): the drive relay; blocked(a, b): either has blocked the other
  constructor({ send, publish, blocked }) { this.send = send; this.publish = publish; this.blocked = blocked || (async () => false);
    this.cars = new Map(); /* driver id → { h, m, seats, riders: Map(id → { h, seat }) } */ this.riding = new Map(); /* rider id → driver id */ this.asks = new Map(); /* rider id → { to, t } */ this.where = new Map(); /* id → { h, mode, x, y, a, m, col } */ }
  seatsLeft(d) { const c = this.cars.get(d), w = this.where.get(d); const seats = seatsOf(w?.m); return seats - 1 - (c ? c.riders.size : 0); }
  list(d) { const c = this.cars.get(d); return c ? [...c.riders].map(([id, r]) => ({ id, h: r.h, seat: r.seat })) : []; }
  // a drive update from someone (already checked): keep where they are; a driver's riders move with them
  moved(id, w) { if (this.riding.has(id)) return false; /* riders' own updates are ignored: they go where the car goes */
    this.where.set(id, { ...w, t: Date.now() }); const c = this.cars.get(id);
    if (c && w.mode !== 'car') { this.empty(id, 'out'); return true; } /* the driver got out: so does everyone */
    if (c) this.publish([...c.riders].map(([rid, r]) => ({ driving: true, id: rid, h: r.h, mode: 'ride', x: w.x, y: w.y, a: w.a, m: w.m, col: w.col, by: id })));
    return true; }
  off(id) { this.leave(id, true); this.empty(id, 'gone'); this.where.delete(id); this.asks.delete(id); }
  async ask(id, h, to) { const me = this.where.get(id), d = this.where.get(to), now = Date.now(), had = this.asks.get(id);
    const no = text => { this.send(id, { type: 'ride', k: 'no', text }); return false; };
    if (had && now - had.t < 3000) return false; if (!me || me.mode !== 'walk') return no('Walk up to the car to ask for a ride.');
    if (this.riding.has(id)) return no('You’re already riding in a car.'); if (!d || d.mode !== 'car' || to === id) return no('That car isn’t being driven right now.');
    if (Math.hypot(me.x - d.x, me.y - d.y) > NEAR) return no('Get closer to the car to ask.');
    if (this.seatsLeft(to) <= 0) return no(`@${d.h}’s ${seatsOf(d.m) === 2 ? 'two-seater' : 'car'} is full.`);
    if (await this.blocked(id, to)) return no(`@${d.h} can’t give you a ride.`);
    this.asks.set(id, { to, t: now }); this.send(to, { type: 'ride', k: 'ask', id, h }); this.send(id, { type: 'ride', k: 'asked', h: d.h }); return true; }
  answer(driver, rider, yes) { const a = this.asks.get(rider); if (!a || a.to !== driver || Date.now() - a.t > ASK_MS) return false; this.asks.delete(rider);
    const d = this.where.get(driver), me = this.where.get(rider); if (!d || !me) return false;
    if (!yes) { this.send(rider, { type: 'ride', k: 'no', text: `@${d.h} said no this time.` }); return true; }
    if (d.mode !== 'car' || me.mode !== 'walk' || this.riding.has(rider)) return false;
    if (Math.hypot(me.x - d.x, me.y - d.y) > NEAR * 2) { this.send(rider, { type: 'ride', k: 'no', text: 'You walked away from the car.' }); return false; }
    if (this.seatsLeft(driver) <= 0) { this.send(rider, { type: 'ride', k: 'no', text: `@${d.h}’s car is full.` }); return false; }
    const c = this.cars.get(driver) || { riders: new Map() }; this.cars.set(driver, c); const used = new Set([...c.riders.values()].map(r => r.seat)); let seat = 1; while (used.has(seat)) seat++;
    c.riders.set(rider, { h: me.h, seat }); this.riding.set(rider, driver);
    this.send(rider, { type: 'ride', k: 'in', id: driver, h: d.h, seat, seats: seatsOf(d.m), m: d.m, col: d.col, x: d.x, y: d.y, a: d.a });
    this.send(driver, { type: 'ride', k: 'riders', list: this.list(driver), seats: seatsOf(d.m) });
    this.publish([{ driving: true, id: rider, h: me.h, mode: 'ride', x: d.x, y: d.y, a: d.a, m: d.m, col: d.col, by: driver }]); return true; }
  // a rider gets out (beside the car, on foot)
  leave(rider, quiet) { const driver = this.riding.get(rider); if (!driver) return false; this.riding.delete(rider); const c = this.cars.get(driver), d = this.where.get(driver);
    if (c) { c.riders.delete(rider); if (!c.riders.size) this.cars.delete(driver); this.send(driver, { type: 'ride', k: 'riders', list: this.list(driver), seats: seatsOf(d?.m) }); }
    if (!quiet) this.send(rider, { type: 'ride', k: 'out', h: d?.h || null, x: d?.x, y: d?.y, a: d?.a }); return true; }
  // the driver lets someone out, or everyone gets out
  drop(driver, rider) { if (this.riding.get(rider) !== driver) return false; return this.leave(rider); }
  empty(driver, why) { const c = this.cars.get(driver); if (!c) return; for (const rid of [...c.riders.keys()]) this.leave(rid); this.cars.delete(driver); }
}
