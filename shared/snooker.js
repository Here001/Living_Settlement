// A small pool/snooker table: the server simulates every shot (from the angle and power the player chose, plus a
// tiny wobble) and sends back where the balls went, so the browser can replay it. Units: the table is 2 × 1.
export const TABLE_W = 2, TABLE_H = 1, BALL_R = 0.028;
export const POCKETS = [[0, 0, 0.064], [1, -0.012, 0.054], [2, 0, 0.064], [0, 1, 0.064], [1, 1.012, 0.054], [2, 1, 0.064]]; // x, y, mouth radius
const FRICTION = 0.85, CUSHION = 0.78, BOUNCE = 0.94, DT = 1 / 400, FRAME = 1 / 30, MAX_T = 14;
export const MAX_SPEED = 4.2, AIM_WOBBLE = 0.006, POWER_WOBBLE = 0.025; // radians (about a third of a degree), share of power

export const CUE_SPOT = [0.42, 0.5];
// Reds racked in a triangle pointing at the cue ball.
export function rack(n, x0 = 1.45) {
  const out = [], d = BALL_R * 2.02; let k = 0;
  for (let row = 0; k < n; row++) for (let i = 0; i <= row && k < n; i++, k++) out.push({ id: 'r' + k, x: x0 + row * d * 0.866, y: 0.5 + (i - row / 2) * d });
  return out;
}
export const startTable = n => [{ id: 'c', x: CUE_SPOT[0], y: CUE_SPOT[1] }, ...rack(n)];
// Pool racks. Balls are 'b1'..'b15'. 8-ball: a triangle of 15 with the 8 in the middle and a solid and a stripe in the
// back corners. 9-ball: a diamond of nine with the 1 at the front and the 9 in the middle. rand() shuffles the rest.
const slot = (row, i, x0 = 1.45) => { const d = BALL_R * 2.02; return { x: x0 + row * d * 0.866, y: 0.5 + (i - row / 2) * d }; };
const shuffled = (a, rand) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function rack8(rand = Math.random) {
  const spots = []; for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) spots.push([row, i]);
  const solid = shuffled([1, 2, 3, 4, 5, 6, 7], rand), stripe = shuffled([9, 10, 11, 12, 13, 14, 15], rand), at = new Map();
  at.set('2,1', 8); const [c1, c2] = rand() < 0.5 ? [solid.pop(), stripe.pop()] : [stripe.pop(), solid.pop()]; at.set('4,0', c1); at.set('4,4', c2);
  const rest = shuffled([...solid, ...stripe], rand); for (const [r, i] of spots) if (!at.has(r + ',' + i)) at.set(r + ',' + i, rest.pop());
  return [{ id: 'c', x: CUE_SPOT[0], y: CUE_SPOT[1] }, ...spots.map(([r, i]) => ({ id: 'b' + at.get(r + ',' + i), ...slot(r, i) }))];
}
export function rack9(rand = Math.random) {
  const rows = [1, 2, 3, 2, 1], spots = []; rows.forEach((n, r) => { for (let i = 0; i < n; i++) spots.push([r, i, n]); });
  const rest = shuffled([2, 3, 4, 5, 6, 7, 8], rand);
  return [{ id: 'c', x: CUE_SPOT[0], y: CUE_SPOT[1] }, ...spots.map(([r, i, n]) => { const d = BALL_R * 2.02; const num = r === 0 ? 1 : (r === 2 && i === 1) ? 9 : rest.pop();
    return { id: 'b' + num, x: 1.45 + r * d * 0.866, y: 0.5 + (i - (n - 1) / 2) * d }; })];
}
export const ballNo = id => (id && id[0] === 'b' ? Number(id.slice(1)) : 0);
// Put a ball back on the foot spot (or just behind it), e.g. a 9 potted on a foul.
export function footSpot(balls, id) {
  for (let k = 0; k < 40; k++) { const x = 1.45 + k * BALL_R * 2.1, y = 0.5; if (x > TABLE_W - BALL_R) break; if (balls.every(b => Math.hypot(b.x - x, b.y - y) > BALL_R * 2.05)) return { id, x, y }; }
  return { id, x: 1.45, y: 0.5 + BALL_R * 3 };
}

// Where a potted cue ball comes back: on its spot, or the nearest free place beside it.
export function respot(balls) {
  for (let k = 0; k < 40; k++) { const x = CUE_SPOT[0], y = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * BALL_R * 2.2;
    if (balls.every(b => Math.hypot(b.x - x, b.y - y) > BALL_R * 2.05)) return { id: 'c', x, y }; }
  return { id: 'c', x: CUE_SPOT[0], y: 0.5 };
}

// Spin, from where the cue strikes the cue ball: y > 0 is top spin (it follows through after hitting a ball), y < 0 is
// back spin (it screws back), x is side spin (it bends off the cushions). Both run -1..1.
export const cleanSpin = sp => { let x = Number(sp?.x) || 0, y = Number(sp?.y) || 0; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }; };
const FOLLOW = 0.55, SIDE = 0.3;
// Play a shot. balls: [{id, x, y}] (the cue ball is id 'c'); angle in radians; power 0..1; spin {x, y}.
// Returns the balls left on the table, what was potted (in order), the first ball the cue ball hit, and frames to replay.
export function shoot(balls, angle, power, spin) {
  const B = balls.map(b => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, on: true }));
  const cue = B.find(b => b.id === 'c'); if (!cue) throw new Error('no cue ball');
  const sp = Math.max(0.05, Math.min(1, power)) * MAX_SPEED; cue.vx = Math.cos(angle) * sp; cue.vy = Math.sin(angle) * sp;
  let { x: side, y: roll } = cleanSpin(spin), rollUsed = false;
  const potted = [], frames = [snap(B)]; let firstHit = null, t = 0, nextFrame = FRAME, cushions = 0;
  while (t < MAX_T) {
    let moving = false;
    for (const b of B) { if (!b.on) continue; const v = Math.hypot(b.vx, b.vy); if (v < 1e-3) { b.vx = b.vy = 0; continue; }
      moving = true; const nv = Math.max(0, v - FRICTION * DT); b.vx *= nv / v; b.vy *= nv / v; b.x += b.vx * DT; b.y += b.vy * DT; }
    if (!moving) break;
    for (const b of B) { if (!b.on) continue;
      for (const [px, py, pr] of POCKETS) if (Math.hypot(b.x - px, b.y - py) < pr) { b.on = false; b.vx = b.vy = 0; potted.push(b.id); break; }
      if (!b.on) continue;
      const kick = (v, along) => { if (b !== cue || !side) return along; const k = side * SIDE * Math.abs(v); side *= 0.5; return along + k; }; // side spin bends the cue ball off a cushion
      if (b.x < BALL_R) { b.x = BALL_R; b.vy = kick(b.vx, b.vy); b.vx = -b.vx * CUSHION; cushions++; } else if (b.x > TABLE_W - BALL_R) { b.x = TABLE_W - BALL_R; b.vy = kick(b.vx, b.vy); b.vx = -b.vx * CUSHION; cushions++; }
      if (b.y < BALL_R) { b.y = BALL_R; b.vx = kick(b.vy, b.vx); b.vy = -b.vy * CUSHION; cushions++; } else if (b.y > TABLE_H - BALL_R) { b.y = TABLE_H - BALL_R; b.vx = kick(b.vy, b.vx); b.vy = -b.vy * CUSHION; cushions++; } }
    for (let i = 0; i < B.length; i++) { const a = B[i]; if (!a.on) continue;
      for (let j = i + 1; j < B.length; j++) { const b = B[j]; if (!b.on) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d >= BALL_R * 2 || d === 0) continue;
        const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const push = (BALL_R * 2 - d) / 2; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        if (rel <= 0) continue;
        const c = a === cue ? a : b === cue ? b : null, cv = c ? [c.vx, c.vy] : null;
        const k = rel * (1 + BOUNCE) / 2; a.vx -= k * nx; a.vy -= k * ny; b.vx += k * nx; b.vy += k * ny;
        if (c && roll && !rollUsed) { rollUsed = true; const s0 = Math.hypot(cv[0], cv[1]) || 1; c.vx += cv[0] / s0 * roll * FOLLOW * s0; c.vy += cv[1] / s0 * roll * FOLLOW * s0; } // follow through, or screw back
        if (!firstHit && (a.id === 'c' || b.id === 'c')) firstHit = a.id === 'c' ? b.id : a.id; } }
    t += DT; if (t >= nextFrame) { frames.push(snap(B)); nextFrame += FRAME; }
  }
  frames.push(snap(B));
  return { balls: B.filter(b => b.on).map(b => ({ id: b.id, x: round(b.x), y: round(b.y) })), potted, firstHit, cushions, frames, time: Math.round(t * 100) / 100 };
}
const round = v => Math.round(v * 10000) / 10000;
function snap(B) { const o = {}; for (const b of B) if (b.on) o[b.id] = [Math.round(b.x * 1000) / 1000, Math.round(b.y * 1000) / 1000]; return o; }

// Practice against the house: pot this many reds within this many shots.
export const PRACTICE = { reds: 6, need: 3, shots: 6, prize: 300 }; // free to play; the first win each real day pays the prize
