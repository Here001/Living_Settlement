// Fight Night, live: two fighters on the sand of the Colosseum, fought in real time.
// The server runs every bout (15 steps a second) with these rules, and everyone in the Colosseum sees the same fight.
// A fighter who is there controls their own corner; anyone who isn't is fought by the computer (aiInput), so a card
// is never empty. Shared by the server (which decides every hit) and the browser (the controls, the moves' names and
// timings for the animations, the weapons and the fire jets).
//
// The sand is a circle of radius ARENA around 0,0 (metres). Fighters always face each other (a lock-on, so a phone's
// stick only has to move you about). Every attack has a wind-up you can see coming, a moment it lands, and a
// recovery: block (hold) or dodge (a quick dash with a moment you can't be hit) when you see it coming.
import { STYLES, seeded, hashStr } from './fights.js';

export const ARENA = 8.5, HZ = 15, ROUNDS = 3, ROUND_S = 45, BREAK_S = 10, WALK_S = 12, VERDICT_S = 8, COUNT_S = 4;
export const LIVE_LEN_S = WALK_S + ROUNDS * ROUND_S + (ROUNDS - 1) * BREAK_S + VERDICT_S; // a bout that goes the distance
export const DMG = 0.36, ST_MAX = 100, ST_REGEN = 18, SPEED = 3.2, STUN = 0.25, BIG_STUN = 0.6;

// The moves. wind: seconds before it lands; act: how long it can land; rec: recovery after; dmg at full power;
// reach in metres (from centre to centre); arc: how wide it sweeps (radians either side); st: stamina it costs;
// big: the chance a clean hit is a big one (that can knock someone down).
export const MOVES = {
  jab: { name: 'Jab', wind: 0.16, act: 0.08, rec: 0.22, dmg: 4.5, reach: 1.35, arc: 0.9, st: 7, big: 0.04 },
  heavy: { name: 'Heavy', wind: 0.38, act: 0.1, rec: 0.38, dmg: 10, reach: 1.5, arc: 1.0, st: 16, big: 0.3 },
};
// each style's special (the fourth button), stronger and slower
export const SPECIALS = {
  boxer: { name: 'Uppercut', wind: 0.5, act: 0.1, rec: 0.5, dmg: 17, reach: 1.3, arc: 0.8, st: 30, big: 0.7 },
  kicker: { name: 'Spinning kick', wind: 0.6, act: 0.14, rec: 0.55, dmg: 18, reach: 2.0, arc: 2.6, st: 30, big: 0.6 },
  grappler: { name: 'Slam', wind: 0.55, act: 0.12, rec: 0.6, dmg: 20, reach: 1.15, arc: 0.9, st: 32, big: 0.8, grab: true }, /* a grab: a block doesn't stop it */
  brawler: { name: 'Haymaker', wind: 0.65, act: 0.1, rec: 0.6, dmg: 22, reach: 1.45, arc: 1.2, st: 32, big: 0.7 },
};
// Gladiator nights: each fighter walks out with a weapon (drawn for them), which changes their reach, how hard they hit
// and how quickly they swing; a shield blocks almost everything. The special with a weapon is a sweeping whirlwind.
export const WEAPONS = {
  gladius: { name: 'Gladius and shield', icon: '🗡️', reach: 0.55, dmg: 1.3, wind: 1.0, shield: true, verbs: ['slash', 'cut'] },
  spear: { name: 'Spear', icon: '🔱', reach: 1.25, dmg: 1.15, wind: 1.15, arc: 0.55, verbs: ['thrust', 'lunge'] },
  axe: { name: 'Battle axe', icon: '🪓', reach: 0.6, dmg: 1.7, wind: 1.35, verbs: ['chop', 'cleave'] },
  mace: { name: 'Mace', icon: '🔨', reach: 0.45, dmg: 1.5, wind: 1.25, stun: 0.3, verbs: ['smash', 'crush'] },
  trident: { name: 'Trident and net', icon: '🔱', reach: 1.0, dmg: 1.2, wind: 1.1, arc: 0.7, verbs: ['stab', 'jab'] },
  daggers: { name: 'Twin daggers', icon: '🔪', reach: 0.15, dmg: 1.0, wind: 0.7, rec: 0.7, verbs: ['slice', 'stab'] },
  sword: { name: 'Longsword', icon: '⚔️', reach: 0.8, dmg: 1.45, wind: 1.15, arc: 1.2, verbs: ['slash', 'swing'] },
  hammer: { name: 'War hammer', icon: '⚒️', reach: 0.7, dmg: 1.85, wind: 1.5, stun: 0.4, verbs: ['smash', 'pound'] },
};
export const WEAPON_IDS = Object.keys(WEAPONS);
export const WHIRL = { name: 'Whirlwind', wind: 0.55, act: 0.2, rec: 0.6, dmg: 15, reach: 1.4, arc: Math.PI, st: 32, big: 0.55 };
// the fire jets (gladiator nights, from round 2): six round the sand, two at a time, with a warning glow first
export const JETS = Array.from({ length: 6 }, (_, k) => { const a = k / 6 * Math.PI * 2 + Math.PI / 6; return { x: Math.cos(a) * 5.4, z: Math.sin(a) * 5.4 }; });
export const JET_R = 1.2, JET_DPS = 14, JET_WARN = 0.9, JET_FIRE = 1.6, JET_EVERY = 4.5;
export const isGladiator = n => n % 3 === 0; // every third Fight Night

// what a move does for this fighter (their style's special, a weapon's changes)
export function moveOf(f, k) {
  const W = f.weapon && WEAPONS[f.weapon];
  if (k === 'special') return W ? WHIRL : SPECIALS[f.style] || SPECIALS.boxer;
  const m = MOVES[k]; if (!m || !W) return m;
  return { ...m, name: W.verbs[k === 'jab' ? 0 : 1], reach: m.reach + W.reach, dmg: m.dmg * W.dmg, wind: m.wind * W.wind, rec: m.rec * (W.rec || 1), arc: W.arc != null ? W.arc : m.arc, stun: W.stun || 0 };
}
export function weaponFor(n, i, side, id) { return WEAPON_IDS[hashStr(`w:${n}:${i}:${side}:${id}`) % WEAPON_IDS.length]; }

// A new bout: the two fighters (from the card: style, power, speed, chin) in their corners.
export function newBout(a, b, opts = {}) {
  const mk = (f, side) => ({ id: f.id, handle: f.handle, style: f.style, power: f.power, speed: f.speed, chin: f.chin, weapon: opts.gladiator ? (f.weapon || weaponFor(opts.n || 0, opts.i || 0, side, f.id)) : null,
    x: side ? 9.4 : -9.4, z: 0, a: side ? -Math.PI / 2 : Math.PI / 2, /* (out of the gates at either end: they walk to their corners) */ vx: 0, vz: 0, hp: 100, st: ST_MAX, act: null, at: 0, stun: 0, blk: false, dodge: 0, dcool: 0, down: 0, downs: 0, dealt: 0, hype: 0, burn: 0 });
  return { t: 0, f: [mk(a, 0), mk(b, 1)], phase: 'walk', round: 0, pt: WALK_S, end: null, ev: [], gladiator: !!opts.gladiator, jets: 0, jetT: 0, jetSeq: 0, seed: opts.seed || 1 };
}

const ang = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// One step of dt seconds. inputs[k] = { mx, mz, block, act } (mx, mz: where to move, -1..1 in the arena's own x/z;
// act: 'jab' | 'heavy' | 'special' | 'dodge' to start, once). Returns the events of this step (also kept in s.ev).
export function step(s, inputs, dt, rand) {
  const out = []; if (s.end && s.phase === 'over') return out; s.t += dt; s.pt -= dt;
  const E = e => { const x = { t: +s.t.toFixed(2), ...e }; out.push(x); s.ev.push(x); };
  // the phases: the walk-out, the rounds and the breaks between them, a knockdown's count, the verdict
  if (s.phase === 'walk' && s.pt <= 0) { s.phase = 'fight'; s.round = 1; s.pt = ROUND_S; E({ k: 'bell', round: 1 }); }
  else if (s.phase === 'fight' && s.pt <= 0) {
    if (s.round < ROUNDS) { s.phase = 'break'; s.pt = BREAK_S; for (const f of s.f) { f.hp = Math.min(100, f.hp + 6); f.st = ST_MAX; f.act = null; f.blk = false; } E({ k: 'rest', round: s.round, hp: s.f.map(f => Math.round(f.hp)) }); }
    else { const sc = f => f.dealt - f.downs * 12, w = sc(s.f[0]) === sc(s.f[1]) ? (rand() < 0.5 ? 0 : 1) : sc(s.f[0]) > sc(s.f[1]) ? 0 : 1, close = Math.abs(s.f[0].dealt - s.f[1].dealt) < 12;
      s.end = { winner: w, method: close ? 'Split decision' : 'Decision', round: ROUNDS, at: ROUND_S }; s.phase = 'verdict'; s.pt = VERDICT_S; E({ k: 'end', ...s.end }); } }
  else if (s.phase === 'break' && s.pt <= 0) { s.phase = 'fight'; s.round++; s.pt = ROUND_S; for (const [k, f] of s.f.entries()) { f.x = k ? 3.2 : -3.2; f.z = 0; } E({ k: 'bell', round: s.round }); }
  else if (s.phase === 'verdict' && s.pt <= 0) { s.phase = 'over'; return out; }
  const fighting = s.phase === 'fight';
  // the fire jets (gladiator nights, rounds 2 and 3): every few seconds two opposite jets glow, then roar
  if (s.gladiator && fighting && s.round >= 2) { s.jetT += dt; const cyc = s.jetT % JET_EVERY, pair = Math.floor(s.jetT / JET_EVERY) % 3;
    const warn = cyc < JET_WARN, fire = cyc >= JET_WARN && cyc < JET_WARN + JET_FIRE; s.jets = warn ? (1 << pair | 1 << (pair + 3)) * 1 : 0; s.fire = fire ? (1 << pair | 1 << (pair + 3)) : 0;
    if (fire) for (const [k, f] of s.f.entries()) { if (f.down) continue; for (let j = 0; j < 6; j++) if ((s.fire >> j) & 1 && Math.hypot(f.x - JETS[j].x, f.z - JETS[j].z) < JET_R) { const d = JET_DPS * dt; f.hp = Math.max(0.5, f.hp - d); s.f[1 - k].dealt += d * 0.5; if (f.burn <= 0) { E({ k: 'burn', who: k, hp: s.f.map(q => Math.round(q.hp)) }); f.burn = 1; } } f.burn -= dt; } }
  else { s.jets = 0; s.fire = 0; }
  for (const [k, f] of s.f.entries()) {
    const o = s.f[1 - k], inp = (fighting && inputs[k]) || {};
    f.stun = Math.max(0, f.stun - dt); f.dcool = Math.max(0, f.dcool - dt); f.hype = Math.max(0, f.hype - dt * 0.03);
    // down: the count, then up again a little recovered (or not, and it's over)
    if (f.down) { f.down -= dt; if (f.down <= 0) { f.down = 0; f.hp = Math.min(100, f.hp + 10); f.st = ST_MAX * 0.6; E({ k: 'up', who: k, hp: s.f.map(q => Math.round(q.hp)) }); } continue; }
    // stamina back (quicker with the crowd behind you, slower while blocking)
    f.st = Math.min(ST_MAX, f.st + ST_REGEN * (1 + f.hype * 0.5) * (f.blk ? 0.4 : 1) * dt);
    // face the other fighter
    f.a = Math.atan2(o.x - f.x, o.z - f.z);
    if (s.phase === 'walk' && k === 1 && s.pt > WALK_S * 0.5) { f.vx = f.vz = 0; continue; } /* (the walk-out: red first, then blue) */
    if (!fighting) { f.act = null; f.blk = false; const hx = k ? 3.2 : -3.2, d = Math.hypot(hx - f.x, -f.z); if (d > 0.1) { const sp = Math.min(d, 2.5 * dt); f.x += (hx - f.x) / d * sp; f.z += -f.z / d * sp; } f.vx = f.vz = 0; continue; } /* back to your corner */
    const free = !f.act && f.stun <= 0 && f.dodge <= 0;
    f.blk = !!inp.block && free && f.st > 1;
    // start a move
    if (free && inp.act === 'dodge' && f.dcool <= 0 && f.st >= 12) { f.st -= 14; f.dodge = 0.35; f.dcool = 0.6; let dx = inp.mx || 0, dz = inp.mz || 0, l = Math.hypot(dx, dz); if (l < 0.2) { dx = -Math.sin(f.a); dz = -Math.cos(f.a); l = 1; } f.dvx = dx / l * 7; f.dvz = dz / l * 7; E({ k: 'dodge', by: k }); }
    else if (free && (inp.act === 'jab' || inp.act === 'heavy' || inp.act === 'special')) { const m = moveOf(f, inp.act); if (m) { const weak = f.st < m.st; f.st = Math.max(0, f.st - m.st); f.act = { k: inp.act, m, t: 0, hit: false, weak }; E({ k: 'wind', by: k, move: inp.act }); } }
    // a move under way: wind-up, the moment it can land, recovery
    if (f.act) { const A = f.act, m = A.m, sp = 1 / (0.85 + f.speed * 0.3); A.t += dt;
      if (!A.hit && A.t >= m.wind * sp) { A.hit = true;
        const dx = o.x - f.x, dz = o.z - f.z, dist = Math.hypot(dx, dz), off = Math.abs(ang(Math.atan2(dx, dz), f.a));
        if (o.down || dist > m.reach || off > m.arc) E({ k: 'miss', by: k, move: A.k, name: m.name });
        else if (o.dodge > 0.1) E({ k: 'miss', by: k, move: A.k, name: m.name, dodged: true });
        else { const facing = Math.abs(ang(Math.atan2(-dx, -dz), o.a)) < 1.2, W = o.weapon && WEAPONS[o.weapon];
          let dmg = DMG * m.dmg * (0.8 + f.power * 0.45) * (1.25 - o.chin * 0.5) * (A.weak ? 0.5 : 1) * (0.85 + rand() * 0.3);
          if (o.blk && facing && !m.grab) { const keep = W && W.shield ? 0.05 : 0.15; o.st -= 6 + dmg * 0.6; dmg *= keep;
            if (o.st <= 0) { o.st = 0; o.blk = false; o.stun = 0.8; E({ k: 'guardbreak', by: k, who: 1 - k }); } else E({ k: 'block', by: k, move: A.k, name: m.name, dmg: Math.round(dmg) }); o.hp = Math.max(0, o.hp - dmg); f.dealt += dmg; }
          else { const big = rand() < m.big * (0.7 + f.power * 0.6); if (big) dmg *= 1.6; o.hp = Math.max(0, o.hp - dmg); f.dealt += dmg; o.stun = (big ? BIG_STUN : STUN) + (m.stun || 0); o.act = null; o.blk = false;
            const push = big ? 1.4 : 0.5, pl = dist || 1; o.vx += dx / pl * push * 4; o.vz += dz / pl * push * 4;
            E({ k: big ? 'big' : 'hit', by: k, move: A.k, name: m.name, dmg: Math.round(dmg), hp: s.f.map(q => Math.round(q.hp)) });
            const knock = o.hp <= 0 || (big && rand() < 0.12 + f.power * 0.25 - o.chin * 0.25 + (o.hp < 35 ? 0.18 : 0));
            if (knock) { o.downs++; if (o.hp <= 0 || o.downs >= 3) { s.end = { winner: k, method: o.hp <= 0 ? 'KO' : 'TKO', round: s.round, at: +(ROUND_S - s.pt).toFixed(1) }; o.down = 99; E({ k: 'down', who: 1 - k, n: o.downs }); E({ k: 'end', ...s.end }); s.phase = 'verdict'; s.pt = VERDICT_S; return out; }
              o.down = COUNT_S; o.act = null; E({ k: 'down', who: 1 - k, n: o.downs }); } } } }
      if (A.t >= (m.wind + m.act + m.rec) * sp) f.act = null; }
    // moving: the stick (slower while blocking or winding up), a dodge's dash, being knocked back
    let mx = inp.mx || 0, mz = inp.mz || 0; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const spd = SPEED * (0.85 + f.speed * 0.3) * (f.blk ? 0.45 : f.act ? 0.35 : f.stun > 0 ? 0 : 1);
    let vx = mx * spd + f.vx, vz = mz * spd + f.vz; if (f.dodge > 0) { f.dodge -= dt; vx = f.dvx; vz = f.dvz; }
    f.vx *= Math.max(0, 1 - dt * 6); f.vz *= Math.max(0, 1 - dt * 6);
    f.x += vx * dt; f.z += vz * dt;
  }
  // nobody stands inside anybody, and nobody leaves the sand
  const [p, q] = s.f, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz) || 0.001, min = 0.75;
  if (d < min && !p.down && !q.down) { const push = (min - d) / 2; p.x -= dx / d * push; p.z -= dz / d * push; q.x += dx / d * push; q.z += dz / d * push; }
  for (const f of s.f) { const r = Math.hypot(f.x, f.z); if (r > ARENA) { f.x *= ARENA / r; f.z *= ARENA / r; } }
  if (s.ev.length > 400) s.ev.splice(0, s.ev.length - 400);
  return out;
}

// The computer in a corner: it closes to its reach, circles, throws (mostly jabs, sometimes something heavy), blocks or
// dodges what it sees coming, backs off when tired, and keeps clear of the fire. `skill` 0..1 (a fighter's speed).
export function aiInput(s, k, rand, mem = {}) {
  const f = s.f[k], o = s.f[1 - k], dx = o.x - f.x, dz = o.z - f.z, d = Math.hypot(dx, dz) || 0.001, ux = dx / d, uz = dz / d, skill = 0.35 + f.speed * 0.5;
  mem.t = (mem.t || 0) + 1 / HZ; mem.side = mem.side || (rand() < 0.5 ? 1 : -1); if (rand() < 0.01) mem.side *= -1;
  const reach = (moveOf(f, 'jab') || MOVES.jab).reach, inp = { mx: 0, mz: 0, block: false, act: null };
  // see it coming: block or dodge
  if (o.act && !o.act.hit && d < o.act.m.reach + 0.6) { if (mem.react == null) mem.react = rand() < 0.35 + skill * 0.45 ? (rand() < 0.6 ? 'block' : 'dodge') : 'none'; }
  else mem.react = null;
  if (mem.react === 'block') inp.block = true; else if (mem.react === 'dodge' && f.dcool <= 0) { inp.act = 'dodge'; inp.mx = -ux * 0.6 + uz * mem.side; inp.mz = -uz * 0.6 - ux * mem.side; mem.react = 'done'; return inp; }
  // tired: back off and cover up
  if (f.st < 22) { inp.mx = -ux; inp.mz = -uz; inp.block = d < 2.2; }
  else { const want = reach * 0.8, gap = d - want; inp.mx = ux * Math.max(-1, Math.min(1, gap * 1.4)) + uz * mem.side * 0.45; inp.mz = uz * Math.max(-1, Math.min(1, gap * 1.4)) - ux * mem.side * 0.45;
    if (!inp.block && !f.act && d <= reach + 0.15 && rand() < 0.035 + skill * 0.05) { const r = rand(); inp.act = r < 0.55 ? 'jab' : r < 0.85 || f.st < 35 ? 'heavy' : 'special'; } }
  // the fire: step away from a jet that's glowing or roaring
  const hot = (s.jets || 0) | (s.fire || 0); if (hot) for (let j = 0; j < 6; j++) if ((hot >> j) & 1) { const jx = f.x - JETS[j].x, jz = f.z - JETS[j].z, jd = Math.hypot(jx, jz); if (jd < JET_R + 1) { inp.mx += jx / (jd || 1) * 1.5; inp.mz += jz / (jd || 1) * 1.5; } }
  return inp;
}

// What everyone in the Colosseum is sent, 15 times a second (short keys: it goes to everyone there).
export function snapshot(s) {
  return { t: +s.t.toFixed(2), ph: s.phase, r: s.round, pt: +Math.max(0, s.pt).toFixed(1), j: s.jets || 0, fi: s.fire || 0,
    f: s.f.map(f => [+f.x.toFixed(2), +f.z.toFixed(2), +f.a.toFixed(2), Math.round(f.hp), Math.round(f.st), f.act ? f.act.k : f.dodge > 0 ? 'dodge' : '', f.act ? +f.act.t.toFixed(2) : 0, f.blk ? 1 : 0, f.down > 0 ? 1 : 0, +f.hype.toFixed(2), f.stun > 0 ? 1 : 0]) };
}
// The result kept for the bout (the same shape the old simulated bouts had, so the Fight Night tab can replay it).
export function resultOf(s) { const e = s.end || { winner: 0, method: 'Decision', round: ROUNDS, at: ROUND_S };
  return { ...e, live: true, gladiator: s.gladiator, weapons: s.f.map(f => f.weapon), events: s.ev.filter(x => ['bell', 'hit', 'big', 'block', 'miss', 'down', 'up', 'rest', 'end', 'burn', 'guardbreak'].includes(x.k)).slice(-160),
    hp: s.f.map(f => Math.round(f.hp)), downs: s.f.map(f => f.downs), dealt: s.f.map(f => Math.round(f.dealt)), len: Math.ceil(s.t + 2) }; }
export { STYLES, seeded };
