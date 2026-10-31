// Snooker, 8-ball and 9-ball for two players, following the official rules (WPSA snooker, WPA pool) as far as a
// phone game can: every shot is simulated by shared/snooker.js, and these engines decide what it means.
// Not modelled: free balls and "play again" choices after a snooker foul, the miss rule, called pockets in 8-ball
// (any pocket counts), the 9-ball push-out, and re-racks after an illegal break (the opponent gets ball in hand).
import { shoot, rack8, rack9, ballNo, AIM_WOBBLE, POWER_WOBBLE, BALL_R, POCKETS, TABLE_W, TABLE_H } from './snooker.js';

const CAP = 400; // a game that somehow drags on this long ends on the score
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const gauss = rand => { const u = Math.max(1e-9, rand()), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
export const HEAD_X = 0.5;                       // pool: the head string (the "kitchen" is behind it)
export const BAULK_X = 0.413, D_R = 0.164;        // snooker: the baulk line and the D's radius
// Where a cue ball may be placed with ball in hand: anywhere, behind the head string, or in the D.
export function placeOk(balls, p, zone) {
  const x = Number(p?.x), y = Number(p?.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < BALL_R || x > TABLE_W - BALL_R || y < BALL_R || y > TABLE_H - BALL_R) return false;
  if (zone === 'kitchen' && x > HEAD_X) return false;
  if (zone === 'D' && (x > BAULK_X || Math.hypot(x - BAULK_X, y - 0.5) > D_R)) return false;
  for (const [px, py, pr] of POCKETS) if (Math.hypot(x - px, y - py) < pr + BALL_R) return false;
  return balls.every(b => b.id === 'c' || Math.hypot(b.x - x, b.y - y) >= BALL_R * 2.02);
}
// Take the shot: place the cue ball first if the player has ball in hand.
function takeShot(s, m, rand) {
  const angle = Number(m.angle), power = Number(m.power); if (!Number.isFinite(angle) || !(power > 0 && power <= 1)) throw new Error('Aim and pick a power.');
  let balls = s.balls;
  if (s.inHand && m.cue) { if (!placeOk(balls, m.cue, s.inHand)) throw new Error(s.inHand === 'D' ? 'Place the cue ball inside the D.' : s.inHand === 'kitchen' ? 'Place the cue ball behind the line.' : 'The cue ball can’t go there.');
    balls = [...balls.filter(b => b.id !== 'c'), { id: 'c', x: Number(m.cue.x), y: Number(m.cue.y) }]; }
  if (!balls.some(b => b.id === 'c')) balls = [...balls, placeAuto(balls, s.inHand || 'table')];
  const r = shoot(balls, angle + gauss(rand) * AIM_WOBBLE, power * (1 + gauss(rand) * POWER_WOBBLE), m.spin);
  return r;
}
// A free spot for the cue ball in a zone (used when nobody placed it).
export function placeAuto(balls, zone) {
  const cand = zone === 'D' ? [[0.35, 0.5], [0.3, 0.45], [0.3, 0.55], [0.38, 0.6], [0.38, 0.4], [0.3, 0.38], [0.3, 0.62]] : [[0.42, 0.5], [0.35, 0.5], [0.42, 0.4], [0.42, 0.6], [0.3, 0.3], [0.3, 0.7]];
  for (const [x, y] of cand) if (placeOk(balls, { x, y }, zone)) return { id: 'c', x, y };
  for (let k = 0; k < 400; k++) { const x = 0.05 + (k % 20) * 0.02, y = 0.05 + Math.floor(k / 20) * 0.045; if (placeOk(balls, { x, y }, zone)) return { id: 'c', x, y }; }
  return { id: 'c', x: 0.2, y: 0.5 };
}
// What a viewer gets: the last few shots with their frames (so none is missed between looks), the latest without.
const turnPass = (s, seat) => { s.turn = 1 - seat; s.brk = 0; };
const shotLast = (s, seat, r, extra) => { s.seq = (s.seq || 0) + 1; s.last = { seq: s.seq, seat, potted: r.potted, frames: r.frames, ...extra };
  s.shots = [...(s.shots || []), { seq: s.seq, seat, frames: r.frames, potted: r.potted }].slice(-3); };

// ---------- The computer ----------
// Is the straight path from a to b clear of every ball except those listed?
function clear(balls, a, b, skip) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  for (const o of balls) { if (skip.includes(o.id)) continue; const t = ((o.x - a.x) * dx + (o.y - a.y) * dy) / L; if (t <= 0 || t >= L) continue;
    if (Math.abs((o.x - a.x) * dy - (o.y - a.y) * dx) / L < BALL_R * 2.05) return false; }
  return true;
}
// The best pot for any of the target balls: an unobstructed, gentle cut into a pocket. With ball in hand it also picks
// where to put the cue ball (straight behind the ghost ball, if that spot is allowed).
export function botShot(balls, targets, rand, zone) {
  let cue = balls.find(b => b.id === 'c'); let best = null;
  const tryFrom = (c, place) => { for (const t of balls) { if (!targets.includes(t.id)) continue;
    for (const [px, py, pr] of POCKETS) { const P = { x: px, y: py }, d = dist(t, P), ux = (px - t.x) / d, uy = (py - t.y) / d, G = { x: t.x - ux * BALL_R * 2, y: t.y - uy * BALL_R * 2 };
      const ax = G.x - c.x, ay = G.y - c.y, la = Math.hypot(ax, ay); if (la < BALL_R) continue;
      const cut = Math.acos(Math.max(-1, Math.min(1, (ax * ux + ay * uy) / la))); if (cut > 1.25) continue;
      if (!clear(balls, c, G, ['c', t.id]) || !clear(balls, t, P, ['c', t.id])) continue;
      const score = cut * 1.4 + la * 0.3 + d * 0.25 - pr; if (!best || score < best.score) best = { score, angle: Math.atan2(ay, ax), power: Math.min(0.95, 0.28 + (la + d) * 0.16 + cut * 0.15), place }; } } };
  if (zone) { // ball in hand: try spots behind each ghost ball, then a few fixed ones
    const others = balls.filter(b => b.id !== 'c');
    for (const t of others) { if (!targets.includes(t.id)) continue; for (const [px, py] of POCKETS) { const d = Math.hypot(px - t.x, py - t.y), ux = (px - t.x) / d, uy = (py - t.y) / d;
      for (const back of [0.18, 0.3, 0.45]) { const p = { x: t.x - ux * (BALL_R * 2 + back), y: t.y - uy * (BALL_R * 2 + back) }; if (placeOk(others, p, zone)) tryFrom({ id: 'c', ...p }, p); } } }
    if (!best) { const p = placeAuto(others, zone); cue = p; tryFrom(p, { x: p.x, y: p.y }); if (!best) best = { place: { x: p.x, y: p.y } }; }
  } else tryFrom(cue, null);
  if (!best || best.angle == null) { // no pot on: just hit a ball we're allowed to hit, firmly enough to reach a cushion
    const c = best?.place ? { x: best.place.x, y: best.place.y } : cue, ts = balls.filter(b => targets.includes(b.id)).sort((a, b) => dist(a, c) - dist(b, c));
    // a ball we can see: straight at it, or at either edge of it, with nothing in the way
    for (const t of ts) for (const off of [0, 1.6, -1.6, 1.9, -1.9]) { const dx = t.x - c.x, dy = t.y - c.y, L = Math.hypot(dx, dy) || 1, aim = { x: t.x - dy / L * BALL_R * off, y: t.y + dx / L * BALL_R * off };
      if (clear(balls, c, aim, ['c', t.id])) return { shot: true, angle: Math.atan2(aim.y - c.y, aim.x - c.x), power: Math.min(0.8, 0.35 + L * 0.2), cue: best?.place || undefined }; }
    const t = ts[0]; return { shot: true, angle: t ? Math.atan2(t.y - c.y, t.x - c.x) : 0, power: 0.55, cue: best?.place || undefined }; }
  return { shot: true, angle: best.angle + (rand() - 0.5) * 0.03, power: best.power, cue: best.place || undefined };
}

// ======================= Snooker =======================
// 15 reds and six colours. With reds on the table you pot a red (1 point), then a colour of your choice, which comes back
// on its spot; then red again. Once the reds are gone the colours go in order: yellow 2, green 3, brown 4, blue 5,
// pink 6, black 7. A foul (missing the ball on, hitting or potting the wrong ball, potting the cue ball) gives the
// opponent at least 4 points (more for a higher-value ball) and passes the turn; after an in-off the next player
// places the cue ball in the D. Highest score when the black goes down wins; a tie re-spots the black.
export const COLOURS = { yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };
const ORDER = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
export const SPOTS = { yellow: [BAULK_X, 0.5 + D_R], green: [BAULK_X, 0.5 - D_R], brown: [BAULK_X, 0.5], blue: [1, 0.5], pink: [1.5, 0.5], black: [1.818, 0.5] };
const val = id => (id && id[0] === 'r' ? 1 : COLOURS[id] || 0);
export function snookerRack() {
  const out = [{ id: 'c', x: 0.33, y: 0.53 }], d = BALL_R * 2.02; let k = 0;
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) out.push({ id: 'r' + k++, x: 1.5 + d + row * d * 0.866, y: 0.5 + (i - row / 2) * d });
  for (const c of ORDER) out.push({ id: c, x: SPOTS[c][0], y: SPOTS[c][1] });
  return out;
}
// Put a colour back: its own spot, or the highest free spot, or as close behind its own spot as possible.
function respotColour(balls, id) {
  const free = ([x, y]) => balls.every(b => b.id === id || Math.hypot(b.x - x, b.y - y) >= BALL_R * 2.02);
  if (free(SPOTS[id])) return { id, x: SPOTS[id][0], y: SPOTS[id][1] };
  for (const c of [...ORDER].reverse()) if (free(SPOTS[c])) return { id, x: SPOTS[c][0], y: SPOTS[c][1] };
  for (let x = SPOTS[id][0]; x < TABLE_W - BALL_R; x += 0.004) if (free([x, 0.5])) return { id, x, y: 0.5 };
  for (let x = SPOTS[id][0]; x > BALL_R; x -= 0.004) if (free([x, 0.5])) return { id, x, y: 0.5 };
  return { id, x: SPOTS[id][0], y: SPOTS[id][1] };
}
const snooker = {
  setup() { return { n: 2, mode: 'snooker', balls: snookerRack(), score: [0, 0], turn: 0, on: 'red', inHand: 'D', brk: 0, best: [0, 0], winners: null, last: null, log: [], shotsTaken: 0 }; },
  legal(s, seat) { return s.turn === seat ? [{ shot: true }] : []; },
  reds(s) { return s.balls.filter(b => b.id[0] === 'r').length; },
  firstColour(s) { return ORDER.find(c => s.balls.some(b => b.id === c)) || 'black'; },
  targets(s) { return s.on === 'red' ? s.balls.filter(b => b.id[0] === 'r').map(b => b.id) : s.on === 'colour' ? ORDER.filter(c => s.balls.some(b => b.id === c)) : [s.on]; },
  play(s, seat, m, rand) { s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    const r = takeShot(s, m, rand), on = s.on, targets = this.targets(s), down = r.potted.filter(p => p !== 'c'), inOff = r.potted.includes('c'), first = r.firstHit;
    let foul = null, pts = 0;
    if (!first) foul = 'missed every ball';
    else if (!targets.includes(first)) foul = `hit the ${first[0] === 'r' ? 'red' : first} first`;
    else if (inOff) foul = 'went in-off';
    else if (on === 'red' && down.some(id => id[0] !== 'r')) foul = 'potted a colour';
    else if (on === 'colour' && (down.length > 1 || (down.length === 1 && down[0] !== first))) foul = 'potted the wrong ball';
    else if (on !== 'red' && on !== 'colour' && down.some(id => id !== on)) foul = 'potted the wrong ball';
    let balls = r.balls;
    const coloursDown = down.filter(id => id[0] !== 'r');
    const sequence = on !== 'red' && on !== 'colour'; // the colours in order, after the last red
    if (foul) {
      const onVal = on === 'red' ? 1 : on === 'colour' ? Math.max(val(first), 4) : val(on);
      const penalty = Math.max(4, onVal, val(first), ...down.map(val)); s.score[1 - seat] += penalty;
      // colours come back on their spots (in the final sequence too, after a foul); reds stay down
      for (const c of coloursDown) { if (sequence && c === 'black' && !balls.some(b => b.id !== 'c' && b.id !== 'black')) continue; balls = [...balls, respotColour(balls, c)]; }
      s.balls = balls; s.inHand = inOff ? 'D' : null;
      shotLast(s, seat, r, { foul, penalty, on });
      s.log.push([seat, 'foul', penalty]); turnPass(s, seat);
      s.on = this.reds(s) ? 'red' : (s.on === 'colour' || s.on === 'red' ? this.firstColour(s) : s.on);
      // a foul on the last black ends the frame
      if (on === 'black' && down.includes('black')) return this.end(s);
      if (!s.balls.some(b => b.id !== 'c')) return this.end(s);
      return this.cap(s);
    }
    pts = down.reduce((a, id) => a + val(id), 0); s.score[seat] += pts; s.brk += pts; s.best[seat] = Math.max(s.best[seat], s.brk);
    s.inHand = null;
    if (!sequence) for (const c of coloursDown) balls = [...balls, respotColour(balls, c)]; // colours come back while reds remain
    s.balls = balls;
    shotLast(s, seat, r, { pts, on, brk: s.brk });
    s.log.push([seat, pts ? 'potted' : 'missed', pts]);
    if (!pts) { turnPass(s, seat); s.on = this.reds(s) ? 'red' : (on === 'colour' || on === 'red' ? this.firstColour(s) : on); return this.cap(s); }
    if (on === 'red') s.on = 'colour';
    else if (on === 'colour') s.on = this.reds(s) ? 'red' : 'yellow';
    else { const nx = ORDER[ORDER.indexOf(on) + 1]; if (!nx) return this.end(s); s.on = nx; }
    return this.cap(s); },
  // The frame is over: highest score wins; a tie re-spots the black for the other player.
  end(s) { if (s.score[0] !== s.score[1]) { s.turn = null; s.winners = [s.score[0] > s.score[1] ? 0 : 1]; return s; }
    s.balls = [{ id: 'black', x: SPOTS.black[0], y: SPOTS.black[1] }]; s.on = 'black'; s.inHand = 'D'; s.respotted = true;
    s.turn = s.last ? 1 - s.last.seat : 0; s.brk = 0; return s; },
  cap(s) { if ((s.shotsTaken = (s.shotsTaken || 0) + 1) >= CAP) { s.turn = null; s.winners = s.score[0] === s.score[1] ? [0, 1] : [s.score[0] > s.score[1] ? 0 : 1]; } return s; },
  drop(s, seat) { s = structuredClone(s); s.out = [false, false]; s.out[seat] = true; s.winners = [1 - seat]; s.turn = null; s.log.push([seat, 'forfeited']); return s; },
  remaining(s) { const reds = this.reds(s); let pts = reds * 8; for (const c of ORDER) if (s.balls.some(b => b.id === c)) pts += COLOURS[c]; if (s.on === 'colour') pts += 7; return pts; },
  view(s) { return { n: 2, mode: 'snooker', out: s.out || null, balls: s.balls, score: s.score, turn: s.turn, winners: s.winners, last: s.last && { ...s.last, frames: undefined }, shots: s.shots || [], seq: s.seq || 0, log: s.log.slice(-6),
    on: s.turn == null ? null : this.targets(s), onName: s.on, inHand: s.inHand, brk: s.brk, reds: this.reds(s), remaining: this.remaining(s) }; },
  auto(s, seat, rand) { return botShot(s.balls, this.targets(s), rand, s.inHand); },
};

// ======================= 8-ball (WPA) =======================
const SOLIDS = [1, 2, 3, 4, 5, 6, 7], STRIPES = [9, 10, 11, 12, 13, 14, 15];
const groupOf = n => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null);
const pool8 = {
  setup(n, opts, rand) { return { n: 2, mode: 8, balls: rack8(rand), groups: [null, null], turn: 0, inHand: 'kitchen', broken: false, winners: null, last: null, log: [], shotsTaken: 0 }; },
  legal(s, seat) { return s.turn === seat ? [{ shot: true }] : []; },
  left(s, seat) { const g = s.groups[seat]; if (!g) return null; const want = g === 'solids' ? SOLIDS : STRIPES; return s.balls.filter(b => want.includes(ballNo(b.id))).length; },
  targets(s, seat) { const g = s.groups[seat]; if (!g) return s.balls.filter(b => b.id !== 'c' && b.id !== 'b8').map(b => b.id);
    const mine = s.balls.filter(b => groupOf(ballNo(b.id)) === g).map(b => b.id); return mine.length ? mine : ['b8']; },
  play(s, seat, m, rand) { s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    const isBreak = !s.broken, on = this.targets(s, seat), onEight = on.length === 1 && on[0] === 'b8', r = takeShot(s, m, rand);
    const down = r.potted.filter(p => p !== 'c'), scratch = r.potted.includes('c'), first = r.firstHit; s.broken = true;
    let foul = null;
    if (!first) foul = 'hit nothing';
    else if (scratch) foul = 'scratched (potted the cue ball)';
    else if (!isBreak && (s.groups[seat] ? !on.includes(first) : first === 'b8')) foul = first === 'b8' ? 'hit the 8 first' : 'hit the other group first';
    else if (isBreak && !down.length && r.railBalls.length < 4) foul = 'broke without potting a ball or driving four to the cushions';
    else if (!isBreak && !down.length && !r.railAfter) foul = 'no ball reached a cushion';
    let balls = r.balls;
    if (down.includes('b8')) {
      if (isBreak) { balls = [...balls, { id: 'b8', ...spotFree(balls, 1.45) }]; } // the 8 on the break comes back to the foot spot
      else { const win = onEight && !foul; s.balls = balls; shotLast(s, seat, r, { foul, eight: win ? 'won' : 'lost' }); s.winners = [win ? seat : 1 - seat]; s.turn = null; s.log.push([seat, win ? 'potted the 8' : 'lost on the 8']); return s; }
    }
    s.balls = balls;
    // The table stays open after the break; the first ball potted on a fair shot after it decides the groups.
    let took = null; if (!foul && !isBreak && !s.groups[seat]) { const g = down.map(id => groupOf(ballNo(id))).find(Boolean); if (g) { s.groups[seat] = took = g; s.groups[1 - seat] = g === 'solids' ? 'stripes' : 'solids'; } }
    const mine = s.groups[seat] ? down.filter(id => groupOf(ballNo(id)) === s.groups[seat]) : down.filter(id => id !== 'b8');
    shotLast(s, seat, r, { foul, took, brk: isBreak });
    s.log.push([seat, foul ? 'foul' : mine.length ? 'potted' : 'missed', mine.length]);
    if (foul) { s.inHand = 'table'; turnPass(s, seat); }
    else { s.inHand = null; if (!mine.length) turnPass(s, seat); }
    if ((s.shotsTaken = (s.shotsTaken || 0) + 1) >= CAP) { const l = [0, 1].map(i => this.left(s, i) ?? 7); s.turn = null; s.winners = l[0] === l[1] ? [0, 1] : [l[0] < l[1] ? 0 : 1]; }
    return s; },
  drop(s, seat) { s = structuredClone(s); s.out = [false, false]; s.out[seat] = true; s.winners = [1 - seat]; s.turn = null; s.log.push([seat, 'forfeited']); return s; },
  view(s) { return { n: 2, mode: 8, out: s.out || null, balls: s.balls, groups: s.groups, left: [this.left(s, 0), this.left(s, 1)], turn: s.turn, winners: s.winners, last: s.last && { ...s.last, frames: undefined }, shots: s.shots || [], seq: s.seq || 0, log: s.log.slice(-6),
    on: s.turn == null ? null : this.targets(s, s.turn), inHand: s.inHand, broken: s.broken }; },
  auto(s, seat, rand) { if (!s.broken) return { shot: true, angle: 0 + (rand() - 0.5) * 0.02, power: 1, cue: { x: 0.42, y: 0.5 + (rand() - 0.5) * 0.1 } };
    return botShot(s.balls, this.targets(s, seat), rand, s.inHand); },
};
function spotFree(balls, x0) { for (let x = x0; x < TABLE_W - BALL_R; x += 0.004) if (balls.every(b => Math.hypot(b.x - x, b.y - 0.5) >= BALL_R * 2.02)) return { x, y: 0.5 }; return { x: x0, y: 0.5 + BALL_R * 3 }; }

// ======================= 9-ball (WPA) =======================
const pool9 = {
  setup(n, opts, rand) { return { n: 2, mode: 9, balls: rack9(rand), turn: 0, inHand: 'kitchen', broken: false, fouls: [0, 0], winners: null, last: null, log: [], shotsTaken: 0 }; },
  legal(s, seat) { return s.turn === seat ? [{ shot: true }] : []; },
  lowest(s) { let lo = null; for (const b of s.balls) { const n = ballNo(b.id); if (n && (lo == null || n < lo)) lo = n; } return lo; },
  play(s, seat, m, rand) { s = structuredClone(s); if (s.turn !== seat) throw new Error('Not your turn.');
    const isBreak = !s.broken, lo = 'b' + this.lowest(s), r = takeShot(s, m, rand), down = r.potted.filter(p => p !== 'c'), scratch = r.potted.includes('c'); s.broken = true;
    let foul = null;
    if (!r.firstHit) foul = 'hit nothing';
    else if (r.firstHit !== lo) foul = `didn't hit the ${lo.slice(1)} first`;
    else if (scratch) foul = 'scratched (potted the cue ball)';
    else if (isBreak && !down.length && r.railBalls.length < 4) foul = 'broke without potting a ball or driving four to the cushions';
    else if (!isBreak && !down.length && !r.railAfter) foul = 'no ball reached a cushion';
    let balls = r.balls;
    if (down.includes('b9') && !foul) { s.balls = balls; shotLast(s, seat, r, { nine: true }); s.winners = [seat]; s.turn = null; s.log.push([seat, 'potted the 9']); return s; }
    const respot = down.includes('b9'); if (respot) balls = [...balls, { id: 'b9', ...spotFree(balls, 1.45) }];
    s.balls = balls; shotLast(s, seat, r, { foul, respot, brk: isBreak });
    s.log.push([seat, foul ? 'foul' : down.length ? 'potted' : 'missed', down.length]);
    if (foul) { s.fouls[seat]++; s.inHand = 'table'; turnPass(s, seat);
      if (s.fouls[seat] >= 3) { s.winners = [1 - seat]; s.turn = null; s.last.threeFouls = true; return s; } } // three fouls in a row lose the game
    else { s.fouls[seat] = 0; s.inHand = null; if (!down.length) turnPass(s, seat); }
    if ((s.shotsTaken = (s.shotsTaken || 0) + 1) >= CAP) { s.turn = null; s.winners = [0, 1]; }
    return s; },
  drop(s, seat) { s = structuredClone(s); s.out = [false, false]; s.out[seat] = true; s.winners = [1 - seat]; s.turn = null; s.log.push([seat, 'forfeited']); return s; },
  view(s) { return { n: 2, mode: 9, out: s.out || null, balls: s.balls, turn: s.turn, winners: s.winners, last: s.last && { ...s.last, frames: undefined }, shots: s.shots || [], seq: s.seq || 0, log: s.log.slice(-6), fouls: s.fouls,
    on: s.turn == null ? null : ['b' + this.lowest(s)], inHand: s.inHand, broken: s.broken }; },
  auto(s, seat, rand) { if (!s.broken) return { shot: true, angle: (rand() - 0.5) * 0.02, power: 1, cue: { x: 0.42, y: 0.5 } };
    const lo = 'b' + this.lowest(s); // pot the lowest ball if there's a clear pot on; the 9 counts too if it lines up off it
    return botShot(s.balls, [lo], rand, s.inHand); },
};

export const CUE_ENGINES = { snooker, pool8, pool9 };
