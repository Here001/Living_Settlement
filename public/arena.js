// Street games in the browser: the lobby, the live match (seen from above, following you), and the result.
// Your own player moves on your phone straight away (with the same rules the server checks); everyone else moves
// smoothly between the server's updates, drawn a tenth of a second behind so there's no jitter.
import * as AR from '/shared/arena.js';

let X = null, S = null; // X: what the page lends us ({ send, toast, fmt, me }); S: the open screen's state
const { A, MODES } = AR;
const $c = (tag, props, ...kids) => { const e = document.createElement(tag); if (props) for (const k in props) { const v = props[k]; if (v == null) continue;
  if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const c of kids) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const ROLE = { hunter: { icon: '👮', name: 'Hunter', goal: 'Catch the civilians!' }, civilian: { icon: '🏃', name: 'Civilian', goal: 'Run! Grab the cash bags.' },
  seeker: { icon: '🔦', name: 'Seeker', goal: 'Find the hiders!' }, hider: { icon: '🫥', name: 'Hider', goal: 'Stay hidden!' } };
const hash = s => { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const COLS = ['#4A7BD9', '#3CC46A', '#F2C94C', '#B05FD6', '#F28CB1', '#2EC4B6', '#F2994A', '#8D6E63'];

export function openArena(mode, ctx) {
  X = ctx; closeArena(true);
  const root = $c('div', { class: 'mg arena', role: 'dialog', 'aria-label': MODES[mode].name }); document.body.append(root); document.body.classList.add('mg-on');
  S = { root, mode, phase: 'lobby', match: null };
  lobby({ k: 'lobby', mode, players: [], startsIn: A.lobby * 1000 });
  X.send({ a: 'join', mode });
}
// Reopening the game after the page reloads (or the line dropped): ask where we stand.
export function resumeArena(ctx) { X = ctx; X.send({ a: 'state' }); }
export function closeArena(quiet) {
  if (S) { S.stop && S.stop(); if (!quiet && S.phase !== 'end') X && X.send({ a: 'leave' }); S.root.remove(); S = null; }
  document.body.classList.remove('mg-on');
}
export function arenaMsg(m) {
  if (m.k === 'start') { if (!S) { X.toast && X.toast(`${MODES[m.mode].icon} Your street game is on!`); openFor(m.mode); } return start(m); }
  if (!S) return;
  if (m.k === 'lobby' && S.phase === 'lobby') return lobby(m);
  if (m.k === 's' && S.match && m.id === S.match.id) return snap(m);
  if (m.k === 'end' && S.match && m.id === S.match.id) return end(m);
  if (m.k === 'error') { X.toast(m.text); closeArena(true); }
  if (m.k === 'idle' && ((S.phase === 'lobby' && S.asked) || S.phase === 'play')) { if (S.phase === 'play') X.toast('The game ended.'); closeArena(true); }
}
function openFor(mode) { const root = $c('div', { class: 'mg arena' }); document.body.append(root); document.body.classList.add('mg-on'); S = { root, mode, phase: 'lobby', match: null }; }

// ---------------- the lobby ----------------
function lobby(m) {
  const M0 = MODES[m.mode]; S.asked = true; let card = S.root.querySelector('.mgcard.lobby');
  if (!card) { S.root.innerHTML = ''; card = $c('div', { class: 'mgcard lobby' }); S.root.append(card); }
  card.innerHTML = '';
  const left = Math.ceil((m.startsIn || 0) / 1000);
  card.append($c('button', { class: 'mgx', 'aria-label': 'Leave', text: '×', onclick: () => closeArena() }),
    $c('div', { class: 'mgicon', text: M0.icon }), $c('h2', { text: M0.name }), $c('p', { class: 'mghint', text: M0.blurb }),
    $c('div', { class: 'mgrow' }, $c('span', { text: 'Players ready' }), $c('b', { text: `${m.players.length} of ${A.maxPeople}` })),
    $c('p', { class: 'mgat', text: m.players.length ? m.players.map(h => '@' + h).join(', ') : 'Finding players…' }),
    $c('div', { class: 'mgcount sm', text: left > 0 ? `${left}` : '…' }),
    $c('p', { class: 'mghint', text: `Starts in ${left}s, or as soon as ${A.maxPeople} people are in. The computer fills the rest of the ${A.players} places with colonists from the town. Win with at least one other player and you get ${X.fmt(A.prize)} coins (${A.paidWins} paid wins a day).` }),
    $c('div', { class: 'mgbtns' }, $c('button', { class: 'mgb', text: 'Leave', onclick: () => closeArena() }), $c('button', { class: 'mgb hot', text: '▶ Start now', onclick: () => X.send({ a: 'go' }) })));
  clearTimeout(S.lobbyT); if (left > 0) S.lobbyT = setTimeout(() => { if (S && S.phase === 'lobby') lobby({ ...m, startsIn: m.startsIn - 1000 }); }, 1000);
}

// ---------------- the match ----------------
function start(m) {
  clearTimeout(S.lobbyT); S.stop && S.stop();
  const L = AR.genArena(m.seed), root = S.root; root.innerHTML = ''; S.phase = 'play';
  const skew = m.now - Date.now(), me = { x: m.x ?? L.spawn.x, y: m.y ?? L.spawn.y, role: m.role }, others = new Map();
  S.match = { id: m.id, mode: m.mode, L, me, others, roster: m.roster, you: m.you, skew, playFrom: m.playFrom, until: m.until, live: Date.now() + skew >= m.playFrom, tl: 0, n: 0, sc: 0, bags: [], feed: [] };
  const cv = $c('canvas', { class: 'mgcanvas' }), g = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const roleB = $c('div', { class: 'arole' }), clock = $c('b', { class: 'mgclock' }), info = $c('b', { class: 'acount' }), feed = $c('div', { class: 'afeed' }), big = $c('div', { class: 'abig' });
  let sure = 0; const quit = $c('button', { class: 'mgx aquit', 'aria-label': 'Leave the game', text: '×', onclick: () => { if (Date.now() - sure < 2500) return closeArena(); sure = Date.now(); say('Tap × again to leave. The computer will play for you.'); } });
  root.append(cv, $c('div', { class: 'mghud' }, roleB, info, clock), feed, big, quit, $c('div', { class: 'mgjoyhint', text: 'Drag anywhere to move' }));
  let W = 0, H = 0, tile = 40, bg = null;
  const fit = () => { W = root.clientWidth; H = root.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    tile = Math.max(30, Math.min(56, Math.min(W, H) / 10)); bg = paintBlock(L, tile, Math.min(dpr, 1.5)); };
  const ro = new ResizeObserver(fit); ro.observe(root); fit();
  // moving: drag anywhere (a joystick that appears under your thumb), or the arrow keys
  let joy = null; const keys = new Set();
  cv.addEventListener('pointerdown', e => { joy = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} });
  cv.addEventListener('pointermove', e => { if (!joy || e.pointerId !== joy.id) return; let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const d = Math.hypot(dx, dy); if (d > 55) { dx *= 55 / d; dy *= 55 / d; } joy.dx = dx; joy.dy = dy; });
  const up = () => { joy = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const kd = e => { keys.add(e.key); if (e.key.startsWith('Arrow')) e.preventDefault(); }, ku = e => keys.delete(e.key); addEventListener('keydown', kd); addEventListener('keyup', ku);
  const input = () => { let vx = 0, vy = 0; if (joy && Math.hypot(joy.dx, joy.dy) > 6) { vx = joy.dx / 55; vy = joy.dy / 55; }
    if (keys.has('ArrowUp') || keys.has('w')) vy -= 1; if (keys.has('ArrowDown') || keys.has('s')) vy += 1; if (keys.has('ArrowLeft') || keys.has('a')) vx -= 1; if (keys.has('ArrowRight') || keys.has('d')) vx += 1; return [vx, vy]; };
  let on = true, last = performance.now(), sentAt = 0, sx = me.x, sy = me.y;
  const frame = now => { if (!on) return; const dt = Math.min(0.1, (now - last) / 1000); last = now; const M = S.match, t = Date.now() + M.skew;
    M.live = t >= M.playFrom;
    const frozen = !M.live && me.role === AR.chasers(M.mode);
    if (!frozen && !M.auto) { const [vx, vy] = input(); if (vx || vy) { const q = AR.moveBy(L, me, vx, vy, A.speed[me.role] * dt * Math.min(1, Math.hypot(vx, vy))); me.x = q.x; me.y = q.y; } }
    if (performance.now() - sentAt > 100 && (Math.abs(me.x - sx) > 0.01 || Math.abs(me.y - sy) > 0.01 || performance.now() - sentAt > 1000)) { sentAt = performance.now(); sx = me.x; sy = me.y; X.send({ a: 'pos', id: M.id, x: +me.x.toFixed(3), y: +me.y.toFixed(3) }); }
    draw(g, W, H, dpr, tile, bg, M, t); hud(roleB, clock, info, big, M, t);
    requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  S.ui = { feed }; S.stop = () => { on = false; ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); };
}
function snap(m) {
  const M = S.match, me = M.me, now = performance.now();
  if (m.role !== me.role) { if (me.role && m.role === AR.chasers(M.mode)) { buzz(300); say(M.mode === 'tag' ? '🚓 You were caught! Now you\'re a hunter.' : '🔦 You were found! Now help seek.'); } me.role = m.role; }
  if (m.fix) { me.x = m.fix[0]; me.y = m.fix[1]; }
  M.auto = !!m.auto; if (M.auto) { /* the computer is playing for you until you move again */ }
  M.tl = m.tl; M.n = m.n; if (m.sc > M.sc) buzz(30); M.sc = m.sc; if (m.b) M.bags = m.b;
  const seen = new Set();
  for (const [i, x, y, ch, hid] of m.p) { seen.add(i); let o = M.others.get(i); if (!o) { o = { buf: [] }; M.others.set(i, o); } o.buf.push([now, x, y]); if (o.buf.length > 4) o.buf.shift(); o.ch = ch; o.hid = hid; o.at = now; }
  for (const [i, o] of M.others) if (!seen.has(i)) o.gone = now; else o.gone = 0;
  for (const f of m.f || []) say(f);
}
function say(text) { if (!S || !S.ui) return; const line = $c('div', { class: 'aline', text }); S.ui.feed.prepend(line); setTimeout(() => line.remove(), 3500); while (S.ui.feed.children.length > 4) S.ui.feed.lastChild.remove(); }
function hud(roleB, clock, info, big, M, t) {
  const R0 = ROLE[M.me.role] || ROLE.civilian, hidden = M.mode === 'hide' && M.me.role === 'hider' && AR.spotAt(M.L, M.me);
  const rt = `${R0.icon} ${R0.name}${hidden ? ' · hidden' : ''}`; if (roleB.textContent !== rt) { roleB.textContent = rt; roleB.className = 'arole ' + (M.me.role === AR.chasers(M.mode) ? 'ch' : 'ru'); }
  const secs = Math.ceil(Math.max(0, (M.live ? M.until : M.playFrom) - t) / 1000), ct = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; if (clock.textContent !== ct) clock.textContent = ct;
  const it = M.mode === 'tag' ? `🏃 ${M.n} left · 💰 ${M.sc}` : `🫥 ${M.n} hiding${M.me.role === 'seeker' ? ` · found ${M.sc}` : ''}`; if (info.textContent !== it) info.textContent = it;
  let bt = ''; if (!M.live) bt = M.me.role === AR.chasers(M.mode) ? `Counting… ${secs}` : M.mode === 'tag' ? `Run! ${secs}` : `Hide! ${secs}`; else if (M.auto) bt = 'Move to take back control'; else if (t - M.playFrom < 2500) bt = R0.goal;
  if (big.textContent !== bt) { big.textContent = bt; big.hidden = !bt; }
}

// The block itself, painted once into its own picture.
function paintBlock(L, tile, dpr) {
  const c = document.createElement('canvas'); c.width = Math.round(L.W * tile * dpr); c.height = Math.round(L.H * tile * dpr); const g = c.getContext('2d'); g.scale(dpr, dpr);
  const T = tile;
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) { const k = y * L.W + x, lk = L.look[k];
    g.fillStyle = lk === 2 ? ((x + y) % 2 ? '#7DB45A' : '#78AE55') : lk === 1 ? '#C9BFAE' : '#5A5A63'; g.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    if (lk === 1) { g.strokeStyle = 'rgba(0,0,0,.08)'; g.strokeRect(x * T + 0.5, y * T + 0.5, T - 1, T - 1); } }
  // road markings
  g.strokeStyle = 'rgba(242,201,76,.5)'; g.lineWidth = Math.max(2, T * 0.06); g.setLineDash([T * 0.4, T * 0.4]);
  for (let y = 0; y < L.H; y++) { let run = 0; for (let x = 0; x <= L.W; x++) { const open = x < L.W && L.look[y * L.W + x] === 0 && !L.grid[y * L.W + x]; if (open) run++; else { if (run >= 4 && y > 0 && L.look[(y - 1) * L.W + x - 1] === 0) { g.beginPath(); g.moveTo((x - run) * T, y * T); g.lineTo(x * T, y * T); g.stroke(); } run = 0; } } }
  g.setLineDash([]);
  const B = ['#C8473D', '#E8DFC9', '#9CC3D9', '#D9B98A', '#B9A3D0', '#8FBF9F'];
  for (const b of L.blocks) { if (b.park) continue; const w = Math.min(b.w, L.W - 1 - b.x), h = Math.min(b.h, L.H - 1 - b.y); if (w <= 0 || h <= 0) continue;
    const x = b.x * T, y = b.y * T, wall = T * 0.35;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 6, y + 6, w * T, h * T);
    g.fillStyle = '#6E655A'; g.fillRect(x, y + h * T - wall, w * T, wall); // the front wall
    g.fillStyle = B[b.hue % B.length]; g.fillRect(x, y, w * T, h * T - wall); g.strokeStyle = '#2B2621'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w * T - 2, h * T - 2);
    g.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i < w; i++) g.fillRect(x + i * T + T * 0.2, y + T * 0.2, T * 0.25, T * 0.25); // roof vents
    g.fillStyle = '#F2E6B8'; for (let i = 0; i < w; i++) g.fillRect(x + i * T + T * 0.3, y + h * T - wall + wall * 0.25, T * 0.4, wall * 0.45); }
  // cars, benches and trees
  const CAR = ['#E4572E', '#4A7BD9', '#F2C94C', '#F4F4F0', '#3CC46A'];
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) { if (L.grid[y * L.W + x] !== 2) continue; const cx = x * T + T / 2, cy = y * T + T / 2;
    if (L.look[y * L.W + x] === 2) { g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.arc(cx + 3, cy + 4, T * 0.45, 0, 7); g.fill(); g.fillStyle = '#3F7D32'; g.beginPath(); g.arc(cx, cy, T * 0.45, 0, 7); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 1.5; g.stroke(); g.fillStyle = '#5A9E48'; g.beginPath(); g.arc(cx - T * 0.12, cy - T * 0.12, T * 0.2, 0, 7); g.fill(); }
    else { g.fillStyle = CAR[(x * 7 + y * 3) % CAR.length]; const w = T * 0.62, h = T * 0.9; g.beginPath(); if (g.roundRect) g.roundRect(cx - w / 2, cy - h / 2, w, h, 6); else g.rect(cx - w / 2, cy - h / 2, w, h); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 1.5; g.stroke(); g.fillStyle = 'rgba(30,40,60,.7)'; g.fillRect(cx - w * 0.35, cy - h * 0.25, w * 0.7, h * 0.18); } }
  // hiding spots
  for (const s of L.spots) { const cx = s.x * T, cy = s.y * T, r = T * 0.36; g.strokeStyle = '#2B2621'; g.lineWidth = 1.5;
    if (s.k === 'bush') { g.fillStyle = '#2F6B2A'; for (const [dx, dy] of [[-0.4, 0.1], [0.4, 0.1], [0, -0.3], [0, 0.25]]) { g.beginPath(); g.arc(cx + dx * r, cy + dy * r, r * 0.65, 0, 7); g.fill(); } }
    else if (s.k === 'bin') { g.fillStyle = '#3B7A57'; g.beginPath(); g.arc(cx, cy, r * 0.8, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#2C5E43'; g.beginPath(); g.arc(cx, cy, r * 0.5, 0, 7); g.fill(); }
    else if (s.k === 'crate') { g.fillStyle = '#A9743F'; g.fillRect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6); g.strokeRect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6); g.beginPath(); g.moveTo(cx - r * 0.8, cy - r * 0.8); g.lineTo(cx + r * 0.8, cy + r * 0.8); g.moveTo(cx + r * 0.8, cy - r * 0.8); g.lineTo(cx - r * 0.8, cy + r * 0.8); g.stroke(); }
    else { g.fillStyle = '#3A2A1E'; g.fillRect(cx - r * 0.7, cy - r, r * 1.4, r * 2); g.strokeRect(cx - r * 0.7, cy - r, r * 1.4, r * 2); g.fillStyle = '#F2C94C'; g.beginPath(); g.arc(cx + r * 0.4, cy, 2, 0, 7); g.fill(); } }
  return { c, dpr };
}
function person(g, x, y, T, col, chaser, me, alpha, name) {
  g.globalAlpha = alpha; const r = T * 0.3;
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x + 2, y + r * 0.9, r, r * 0.4, 0, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = me ? '#fff' : '#2B2621'; g.lineWidth = me ? 3 : 2; g.stroke();
  g.fillStyle = '#7A4E2D'; g.beginPath(); g.arc(x, y - r * 0.15, r * 0.5, 0, 7); g.fill();
  if (chaser) { g.fillStyle = '#1E2A44'; g.beginPath(); g.arc(x, y - r * 0.3, r * 0.52, Math.PI, 0); g.fill(); g.fillStyle = '#F2C94C'; g.fillRect(x - 2, y - r * 0.75, 4, 4); }
  if (name) { g.font = `700 ${Math.max(10, T * 0.26)}px system-ui`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(name, x, y - r - 6); g.fillStyle = '#fff'; g.fillText(name, x, y - r - 6); }
  g.globalAlpha = 1;
}
function draw(g, W, H, dpr, T, bg, M, t) {
  const L = M.L, me = M.me, cx = Math.max(Math.min(me.x * T, L.W * T - W / 2), W / 2), cy = Math.max(Math.min(me.y * T, L.H * T - H / 2 + 40), H / 2 - 60);
  const ox = W / 2 - (L.W * T <= W ? L.W * T / 2 : cx), oy = H / 2 - (L.H * T <= H ? L.H * T / 2 : cy);
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#2B2621'; g.fillRect(0, 0, W, H);
  if (bg) { const sx = Math.max(0, -ox), sy = Math.max(0, -oy); g.drawImage(bg.c, sx * bg.dpr, sy * bg.dpr, Math.min(W, L.W * T - sx) * bg.dpr, Math.min(H, L.H * T - sy) * bg.dpr, Math.max(0, ox), Math.max(0, oy), Math.min(W, L.W * T - sx), Math.min(H, L.H * T - sy)); }
  g.translate(ox, oy);
  const hiding = M.mode === 'hide' && me.role === 'hider';
  if (hiding && !M.live) for (const s of L.spots) { g.strokeStyle = 'rgba(124,255,178,.9)'; g.lineWidth = 3; g.beginPath(); g.arc(s.x * T, s.y * T, T * 0.5 + Math.sin(t / 200) * 3, 0, 7); g.stroke(); }
  for (const [x, y] of M.bags) { const bx = x * T, by = y * T + Math.sin(t / 250 + x) * 3; g.fillStyle = '#E2B13C'; g.beginPath(); g.arc(bx, by, T * 0.22, 0, 7); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#2B2621'; g.font = `900 ${T * 0.26}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', bx, by + 1); g.textBaseline = 'alphabetic'; }
  // everyone else, a tenth of a second behind, smoothly
  const now = performance.now(), back = now - 110;
  for (const [i, o] of M.others) { if (o.gone && now - o.gone > 300) continue; const b = o.buf; if (!b.length) continue;
    let x = b[b.length - 1][1], y = b[b.length - 1][2]; for (let k = b.length - 1; k > 0; k--) if (b[k - 1][0] <= back && back <= b[k][0]) { const u = (back - b[k - 1][0]) / Math.max(1, b[k][0] - b[k - 1][0]); x = b[k - 1][1] + (b[k][1] - b[k - 1][1]) * u; y = b[k - 1][2] + (b[k][2] - b[k - 1][2]) * u; break; }
    const R0 = M.roster[i] || { h: '?' }; person(g, x * T, y * T, T, o.ch ? '#C8473D' : COLS[hash(R0.h) % COLS.length], !!o.ch, false, o.hid ? 0.45 : o.gone ? 0.4 : 1, '@' + R0.h); }
  const chaser = me.role === AR.chasers(M.mode), hidden = hiding && AR.spotAt(L, me);
  person(g, me.x * T, me.y * T, T, chaser ? '#C8473D' : '#2E3440', chaser, true, hidden ? 0.55 : 1, 'You');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // a seeker only sees so far; while counting, nothing at all
  if (M.mode === 'hide' && chaser) { const px = ox + me.x * T, py = oy + me.y * T, R = A.sight * T;
    if (!M.live) { g.fillStyle = 'rgba(15,12,10,.94)'; g.fillRect(0, 0, W, H); }
    else { const gr = g.createRadialGradient(px, py, R * 0.55, px, py, R); gr.addColorStop(0, 'rgba(15,12,10,0)'); gr.addColorStop(1, 'rgba(15,12,10,.82)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); } }
}
function end(m) {
  S.stop && S.stop(); S.phase = 'end'; const root = S.root; root.innerHTML = ''; buzz(m.won ? [30, 40, 30] : 150);
  const M0 = MODES[m.mode], RU = AR.runners(m.mode);
  const title = m.side === RU ? (m.mode === 'tag' ? 'The civilians held out!' : 'The hiders stayed hidden!') : (m.mode === 'tag' ? 'The hunters caught everyone!' : 'The seekers found everyone!');
  const list = $c('ul', { class: 'mgcrew' }); for (const p of m.players) list.append($c('li', null, $c('span', { text: `${ROLE[p.first].icon} @${p.h}${p.bot ? ' 🤖' : ''}` }), $c('b', { text: [m.winners.includes(p.h) ? '🏆' : '', p.catches ? `${m.mode === 'tag' ? 'caught' : 'found'} ${p.catches}` : '', p.bags ? `💰 ${p.bags}` : ''].filter(Boolean).join(' · ') || '—' })));
  root.append($c('div', { class: 'mgcard res ' + (m.won ? 'good' : 'meh') }, $c('div', { class: 'mgicon', text: m.won ? '🏆' : M0.icon }), $c('h2', { text: m.won ? 'You won!' : title }), m.won ? $c('p', { class: 'mghint', text: title }) : null,
    $c('p', { class: 'mgmoney', text: m.prize ? `+${X.fmt(m.prize)} coins` : m.won ? (m.paid ? `No prize: that's your ${A.paidWins} paid wins for today.` : 'Practice game (play with at least one other person to win coins).') : '' }), list,
    $c('div', { class: 'mgbtns' }, $c('button', { class: 'mgb', text: '▶ Play again', onclick: () => { const mode = m.mode; closeArena(true); openArena(mode, X); } }), $c('button', { class: 'mgb hot', text: 'Back to the map', onclick: () => { closeArena(true); X.done && X.done(); } }))));
}
