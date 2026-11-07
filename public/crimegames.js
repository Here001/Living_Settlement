// Crime mini games in the browser: a full-screen game for robbing a shop, conning a tourist and hacking an ATM.
// The rules (levels, moves, scoring) are in /shared/minigames.js, the same ones the server uses to check the result.
// While a game is open the map behind it is paused (see Power in index.html), so the phone only works on the game.
import * as MG from '/shared/minigames.js';

let X = null; // what the page lends us: { api, toast, fmt, avatarSVG, done(result) }
const $c = (tag, props, ...kids) => { const e = document.createElement(tag); if (props) for (const k in props) { const v = props[k]; if (v == null) continue;
  if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const c of kids) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

const INFO = {
  rob: { icon: '🛒', name: 'Rob the shop', how: ['Sneak in the back door, get to the till and stay next to it while you empty it. Then get out the way you came in.', 'Stay out of the shopkeeper\'s view (the yellow cone) and away from cameras. If the eye meter fills, you\'re spotted.', 'Move: drag anywhere on the screen (or use the arrow keys).'] },
  scam: { icon: '🎭', name: 'Con a tourist', how: ['Sell a tourist a "genuine" Gliese moon rock before they smell a rat.', 'Each turn, pick a line that suits their mood (watch what they say), then tap "Say it" while the marker is in the green.', 'Trust full: sold. Suspicion full: they walk off.'] },
  atm: { icon: '🏧', name: 'Hack the ATM', how: ['Rewire the cash machine: tap a wire, then the socket with that colour\'s symbol on the service card.', 'Then watch the keypad flash a code and tap it back.', 'Wrong moves make the alarm jump. If the alarm fills, the bank\'s siren goes off.'] },
};

// The game's frame: the intro, the countdown, the game, and the result.
export function openCrimeGame(kind, info, ctx) {
  X = ctx; close(); document.body.classList.add('mg-on');
  const root = $c('div', { class: 'mg', role: 'dialog', 'aria-label': INFO[kind].name }); document.body.append(root);
  intro(root, kind, info || {});
}
function close() { const r = document.querySelector('.mg'); if (r) { r._stop && r._stop(); r.remove(); } document.body.classList.remove('mg-on'); }

function intro(root, kind, info) {
  root._stop && root._stop(); root.innerHTML = '';
  const I = INFO[kind], diff = MG.difficultyOf(kind, info.band || 'mid'), setting = MG.scoreOf(0, info.chance || 0).setting;
  const pips = $c('span', { class: 'mgpips', 'aria-label': `Difficulty ${diff} of 5` }); for (let i = 1; i <= 5; i++) pips.append($c('i', { class: i <= diff ? 'on' : '' }));
  const real = !info.blocked;
  root.append($c('div', { class: 'mgcard' },
    $c('button', { class: 'mgx', 'aria-label': 'Close', text: '×', onclick: close }),
    $c('div', { class: 'mgicon', text: I.icon }), $c('h2', { text: I.name }), info.at ? $c('p', { class: 'mgat', text: `At ${info.at}` }) : null,
    $c('div', { class: 'mgrow' }, $c('span', { text: 'Difficulty' }), pips),
    $c('div', { class: 'mgrow' }, $c('span', { text: 'The setting' }), $c('b', { text: `${setting} of 40 points` })),
    $c('p', { class: 'mghint', text: [info.band === 'low' ? '🔴 Police close by' : info.band === 'mid' ? '🟡 Police not far' : '🟢 No police nearby', info.night ? '🌙 dark streets' : null, info.wave ? '🦹 crime wave' : null].filter(Boolean).join(' · ') }),
    $c('ul', { class: 'mghow' }, ...I.how.map(t => $c('li', { text: t }))),
    $c('p', { class: 'mghint', text: 'Your play earns up to 60 points and the setting up to 40. 80+ is a clean getaway (up to 1.5× the takings), 60–79 gets you some of it, 40–59 nothing, below 40 you\'re caught: fined, and below 20 jailed too.' }),
    $c('div', { class: 'mgbtns' },
      $c('button', { class: 'mgb', text: '▶ Practise (free)', onclick: () => begin(root, kind, info, true) }),
      $c('button', { class: 'mgb hot', text: real ? '🎯 Do it for real' : info.blocked, disabled: real ? null : '', onclick: () => real && begin(root, kind, info, false) }))));
}
async function begin(root, kind, info, practice) {
  root.innerHTML = ''; root.append($c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Setting up…' })));
  let run; try { run = await X.api('/api/me/crime/start', { method: 'POST', body: { kind, practice } }); } catch (e) { X.toast(e.message); intro(root, kind, info); return; }
  const L = MG.levelOf(kind, run.seed, run.diff);
  root.innerHTML = ''; const cd = $c('div', { class: 'mgcount', text: '3' }); root.append(cd);
  let n = 3; const tick = () => { n--; if (n > 0) { cd.textContent = String(n); setTimeout(tick, 650); } else { cd.remove(); play(root, kind, L, run, info); } }; setTimeout(tick, 650);
}
function play(root, kind, L, run, info) {
  const finish = async log => { root._stop && root._stop(); root.innerHTML = ''; root.append($c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Counting up…' })));
    let r; try { r = await X.api('/api/me/crime/finish', { method: 'POST', body: { runId: run.id, log } }); } catch (e) { X.toast(e.message); close(); return; }
    result(root, kind, info, run, r); if (!run.practice) X.done && X.done(r); };
  if (kind === 'rob') stealth(root, L, finish); else if (kind === 'scam') con(root, L, finish); else atm(root, L, finish);
}
function result(root, kind, info, run, r) {
  root.innerHTML = ''; const good = r.outcome === 'clean' || r.outcome === 'partial', bad = r.outcome === 'fined' || r.outcome === 'jailed';
  const bar = (label, v, max, cls) => $c('div', { class: 'mgbar' }, $c('span', { text: label }), $c('div', { class: 'mgtrack' }, $c('i', { class: cls, style: `width:${Math.round(v / max * 100)}%` })), $c('b', { text: `${v}/${max}` }));
  const money = r.practice ? (r.practiceLoot ? `For real, that would have paid about ${X.fmt(r.practiceLoot)} coins.` : bad ? 'For real, you\'d have been caught.' : 'For real, you\'d have got away with nothing.')
    : r.money ? `+${X.fmt(r.money)} coins` : r.fine ? `Fined ${X.fmt(r.fine)} coins${r.jailed ? ` and jailed for ${Math.round(r.jailFor / 60000)} minutes` : ''}.` : 'No money this time.';
  root.append($c('div', { class: 'mgcard res ' + (good ? 'good' : bad ? 'bad' : 'meh') },
    $c('div', { class: 'mgicon', text: good ? '💰' : bad ? '🚓' : '🫥' }), $c('h2', { text: (r.practice ? 'Practice: ' : '') + r.title }),
    r.game && r.game.invalid ? $c('p', { class: 'mghint', text: 'That game didn\'t add up, so it counts as a botched job.' }) : null,
    bar('Your play', r.score.play, 60, 'p'), bar('The setting', r.score.setting, 40, 's'), $c('div', { class: 'mgtotal' }, $c('span', { text: 'Score' }), $c('b', { text: `${r.score.total}` })),
    $c('p', { class: 'mgmoney', text: money }),
    $c('div', { class: 'mgbtns' }, $c('button', { class: 'mgb', text: '▶ Practise again', onclick: () => begin(root, kind, info, true) }), $c('button', { class: 'mgb hot', text: 'Back to the map', onclick: close }))));
  buzz(good ? [30, 40, 30] : bad ? 300 : 60);
}

// A game loop that only runs while the game is on screen, and stops cleanly.
function loop(root, fn) { let on = true, last = performance.now(); const f = now => { if (!on) return; const dt = Math.min(0.1, (now - last) / 1000); last = now; fn(dt, now); requestAnimationFrame(f); }; requestAnimationFrame(f); root._stop = () => { on = false; }; }
const hud = (...kids) => $c('div', { class: 'mghud' }, ...kids);
const meter = (cls, label) => { const i = $c('i'); const m = $c('div', { class: 'mgmeter ' + cls }, $c('span', { text: label }), $c('div', { class: 'mgtrack' }, i)); m.set = v => { i.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; }; return m; };

// ---------------- Cut-away stealth ----------------
function stealth(root, L, finish) {
  const cv = $c('canvas', { class: 'mgcanvas' }), g = cv.getContext('2d'), seen = meter('eye', '👁'), goal = $c('div', { class: 'mggoal', text: '💰 Get to the till' }), clock = $c('b', { class: 'mgclock' });
  root.append(cv, hud(seen, clock), goal, $c('div', { class: 'mgjoyhint', text: 'Drag anywhere to move' }));
  const dpr = Math.min(window.devicePixelRatio || 1, 2); let W = 0, H = 0, tw = 40, ox = 0, oy = 0, bg = null;
  const P = (x, y, z = 0) => ({ x: ox + (x - y) * tw / 2, y: oy + (x + y) * tw / 4 - z * tw / 2 });
  const fit = () => { W = root.clientWidth; H = root.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    tw = Math.min((W - 24) / ((L.W + L.H) / 2), (H - 200) / ((L.W + L.H) / 4 + 1.6)); ox = W / 2 - (L.W - L.H) * tw / 4; oy = 110 + tw * 1.1 + (H - 200 - ((L.W + L.H) / 4 + 1.6) * tw) / 2; bg = paintShop(); };
  // the shop itself (floor, walls, shelves, counter) is painted once into its own picture
  function paintShop() { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const k = c.getContext('2d'); k.scale(dpr, dpr);
    const poly = (pts, fill, stroke) => { k.beginPath(); pts.forEach((p, i) => i ? k.lineTo(p.x, p.y) : k.moveTo(p.x, p.y)); k.closePath(); if (fill) { k.fillStyle = fill; k.fill(); } if (stroke) { k.strokeStyle = stroke; k.lineWidth = 1; k.stroke(); } };
    // back walls (cut-away: tall at the back, the front ones are just a low edge)
    const wh = 1.5; poly([P(0, 0), P(L.W, 0), P(L.W, 0, wh), P(0, 0, wh)], '#C8473D', '#2B2621'); poly([P(0, 0), P(0, L.H), P(0, L.H, wh), P(0, 0, wh)], '#E8DFC9', '#2B2621');
    for (let i = 1; i < L.W; i += 3) { poly([P(i, 0, 0.5), P(i + 1.2, 0, 0.5), P(i + 1.2, 0, 1.1), P(i, 0, 1.1)], '#9CC3D9', '#2B2621'); } // windows on the back wall
    for (let i = 1; i < L.H - 2; i += 3) { poly([P(0, i, 0.55), P(0, i + 1, 0.55), P(0, i + 1, 1.05), P(0, i, 1.05)], '#F2C94C', '#2B2621'); } // posters
    // floor
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) poly([P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], (x + y) % 2 ? '#D9B98A' : '#CFAE7E', 'rgba(90,60,30,.18)');
    // the back door
    poly([P(0, L.H - 1), P(0, L.H), P(0, L.H, 1.1), P(0, L.H - 1, 1.1)], '#6B4A2B', '#2B2621'); k.fillStyle = '#3CC46A'; k.font = `800 ${Math.max(9, tw * 0.22)}px system-ui`; k.textAlign = 'center'; const dp = P(0, L.H - 0.5, 1.35); k.fillText('EXIT', dp.x, dp.y);
    // shelves and the counter, back to front
    const cells = []; for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (L.wall[y * L.W + x]) cells.push([x, y, L.wall[y * L.W + x]]); cells.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    const goods = ['#E4572E', '#F2C94C', '#3CC46A', '#4A7BD9', '#B05FD6', '#F28CB1'];
    for (const [x, y, v] of cells) { const h = v === 2 ? 0.55 : 0.75, top = v === 2 ? '#8A5A33' : '#7A6A5A', side = v === 2 ? '#6E4526' : '#5E5246';
      poly([P(x + 1, y), P(x + 1, y + 1), P(x + 1, y + 1, h), P(x + 1, y, h)], side, '#2B2621'); poly([P(x, y + 1), P(x + 1, y + 1), P(x + 1, y + 1, h), P(x, y + 1, h)], v === 2 ? '#7C4F2C' : '#6C5F52', '#2B2621');
      poly([P(x, y, h), P(x + 1, y, h), P(x + 1, y + 1, h), P(x, y + 1, h)], top, '#2B2621');
      if (v === 1) for (let i = 0; i < 3; i++) { const q = P(x + 0.25 + i * 0.25, y + 0.5, h); k.fillStyle = goods[(x * 7 + y * 3 + i) % goods.length]; k.fillRect(q.x - tw * 0.07, q.y - tw * 0.16, tw * 0.14, tw * 0.16); } }
    const tq = P(L.till.x, L.till.y - 1, 0.55); k.fillStyle = '#2B2621'; k.fillRect(tq.x - tw * 0.18, tq.y - tw * 0.28, tw * 0.36, tw * 0.24); k.fillStyle = '#7CFFB2'; k.fillRect(tq.x - tw * 0.12, tq.y - tw * 0.24, tw * 0.24, tw * 0.08);
    // the front edges: low cut walls so you see in
    poly([P(0, L.H), P(L.W, L.H), P(L.W, L.H, 0.25), P(0, L.H, 0.25)], '#B0A48C', '#2B2621'); poly([P(L.W, 0), P(L.W, L.H), P(L.W, L.H, 0.25), P(L.W, 0, 0.25)], '#9C917B', '#2B2621');
    return c; }
  // looking: a fan of rays that stops at shelves, so the cone shows exactly what they can see
  const cone = (from, dir, fov, range, col) => { g.beginPath(); const a0 = P(from.x, from.y); g.moveTo(a0.x, a0.y);
    for (let i = 0; i <= 14; i++) { const a = dir - fov + (2 * fov) * i / 14; let d = 0; while (d < range && !MG.isWall(L, from.x + Math.cos(a) * d, from.y + Math.sin(a) * d)) d += 0.15; const q = P(from.x + Math.cos(a) * d, from.y + Math.sin(a) * d); g.lineTo(q.x, q.y); }
    g.closePath(); g.fillStyle = col; g.fill(); g.strokeStyle = 'rgba(255,200,60,.55)'; g.lineWidth = 1.5; g.stroke(); };
  const person = (x, y, body, head, extra) => { const p = P(x, y), s = tw * 0.32; g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(p.x, p.y, s * 0.55, s * 0.25, 0, 0, 7); g.fill();
    g.fillStyle = '#2B2621'; g.fillRect(p.x - s * 0.3, p.y - s * 0.75, s * 0.22, s * 0.75); g.fillRect(p.x + s * 0.08, p.y - s * 0.75, s * 0.22, s * 0.75);
    g.fillStyle = body; g.beginPath(); g.roundRect ? g.roundRect(p.x - s * 0.42, p.y - s * 1.65, s * 0.84, s * 0.95, s * 0.2) : g.rect(p.x - s * 0.42, p.y - s * 1.65, s * 0.84, s * 0.95); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 1; g.stroke();
    g.fillStyle = head; g.beginPath(); g.arc(p.x, p.y - s * 1.95, s * 0.36, 0, 7); g.fill(); g.stroke(); if (extra) extra(p, s); };
  // the game state, moved in fixed steps; the picture is drawn in between
  let s = MG.stealthStart(L), prev = s, acc = 0, t0 = performance.now(); const path = [[s.x, s.y]], keys = new Set(); let joy = null, ended = false;
  const input = () => { let vx = 0, vy = 0; if (joy && joy.d > 6) { const sx = joy.dx / 60, sy = joy.dy / 60; vx = sx + 2 * sy; vy = 2 * sy - sx; }
    if (keys.has('ArrowUp') || keys.has('w')) { vx -= 1; vy -= 1; } if (keys.has('ArrowDown') || keys.has('s')) { vx += 1; vy += 1; } if (keys.has('ArrowLeft') || keys.has('a')) { vx -= 1; vy += 1; } if (keys.has('ArrowRight') || keys.has('d')) { vx += 1; vy -= 1; }
    const n = Math.hypot(vx, vy); return n > 1 ? [vx / n, vy / n] : [vx, vy]; };
  cv.addEventListener('pointerdown', e => { joy = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, d: 0, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} });
  cv.addEventListener('pointermove', e => { if (!joy || e.pointerId !== joy.id) return; let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const d = Math.hypot(dx, dy); if (d > 60) { dx *= 60 / d; dy *= 60 / d; } joy.dx = dx; joy.dy = dy; joy.d = d; });
  const up = () => { joy = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const kd = e => { keys.add(e.key); if (e.key.startsWith('Arrow')) e.preventDefault(); }, ku = e => keys.delete(e.key); addEventListener('keydown', kd); addEventListener('keyup', ku);
  const ro = new ResizeObserver(fit); ro.observe(root); fit();
  let lastSeen = 0;
  loop(root, dt => {
    if (!ended) { acc += dt; while (acc >= MG.STEP && !s.done) { acc -= MG.STEP; prev = s; const [vx, vy] = input(); s = MG.stealthStep(L, s, vx, vy); path.push([+s.x.toFixed(4), +s.y.toFixed(4)]); if (s.who && !prev.who) buzz(40); } }
    const u = s.done ? 1 : Math.min(1, acc / MG.STEP), px = prev.x + (s.x - prev.x) * u, py = prev.y + (s.y - prev.y) * u, tt = prev.t + (s.t - prev.t) * u;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#1B1612'; g.fillRect(0, 0, W, H); if (bg) g.drawImage(bg, 0, 0, W, H);
    for (const c of L.cams) cone(c, MG.camAt(c, tt), MG.STEALTH.camFov, MG.STEALTH.camRange, s.who === 2 ? 'rgba(255,70,60,.28)' : 'rgba(255,215,80,.3)');
    for (const gd of L.guards) { const q = MG.guardAt(gd, tt); cone(q, q.dir, MG.STEALTH.guardFov, MG.STEALTH.guardRange + L.diff * 0.2, s.who === 1 ? 'rgba(255,70,60,.3)' : 'rgba(255,215,80,.36)'); }
    // the till's progress ring
    if (!s.grabbed && s.grab > 0) { const q = P(L.till.x, L.till.y, 1.2); g.strokeStyle = '#7CFFB2'; g.lineWidth = 4; g.beginPath(); g.arc(q.x, q.y, tw * 0.3, -Math.PI / 2, -Math.PI / 2 + s.grab / MG.STEALTH.grab * Math.PI * 2); g.stroke(); }
    const who = [...L.guards.map(gd => { const q = MG.guardAt(gd, tt); return { x: q.x, y: q.y, k: gd.kind }; }), { x: px, y: py, k: 'me' }].sort((a, b) => a.x + a.y - b.x - b.y);
    for (const o of who) { if (o.k === 'me') person(o.x, o.y, '#2E3440', '#C68B59', (p, sz) => { g.fillStyle = '#111'; g.fillRect(p.x - sz * 0.36, p.y - sz * 2.05, sz * 0.72, sz * 0.18); if (s.grabbed) { g.fillStyle = '#E2B13C'; g.beginPath(); g.arc(p.x + sz * 0.55, p.y - sz * 1.1, sz * 0.3, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#2B2621'; g.font = `800 ${sz * 0.4}px system-ui`; g.textAlign = 'center'; g.fillText('$', p.x + sz * 0.55, p.y - sz * 0.97); } });
      else person(o.x, o.y, o.k === 'guard' ? '#2F4A7A' : '#F4F1E8', '#7A4E2D', (p, sz) => { if (o.k === 'keeper') { g.fillStyle = '#C8473D'; g.fillRect(p.x - sz * 0.42, p.y - sz * 1.3, sz * 0.84, sz * 0.5); } else { g.fillStyle = '#1E2A44'; g.fillRect(p.x - sz * 0.38, p.y - sz * 2.4, sz * 0.76, sz * 0.22); } }); }
    for (const c of L.cams) { const q = P(c.x, c.y, 1.3); g.fillStyle = '#3A3A44'; g.fillRect(q.x - 6, q.y - 4, 12, 8); g.fillStyle = (performance.now() / 400 | 0) % 2 ? '#FF4B3A' : '#7A1E18'; g.beginPath(); g.arc(q.x + 4, q.y - 1, 2, 0, 7); g.fill(); }
    seen.set(s.seen); seen.classList.toggle('hot', s.who > 0); clock.textContent = `${Math.max(0, Math.ceil(L.limit - s.t))}s`;
    const gtxt = s.grabbed ? '🚪 Out the back door!' : s.grab > 0 ? '💰 Emptying the till… stay close' : '💰 Get to the till'; if (goal.textContent !== gtxt) goal.textContent = gtxt;
    if (s.grabbed && !lastSeen) { lastSeen = 1; buzz([20, 30, 20]); }
    if (s.done && !ended) { ended = true; ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); if (s.done === 'spotted') buzz(400); setTimeout(() => finish({ path }), s.done === 'spotted' ? 900 : 400); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); };
}

// ---------------- Smooth talker ----------------
function con(root, L, finish) {
  const picks = [], trust = meter('trust', '🤝'), sus = meter('sus', '🤨'), clock = $c('b', { class: 'mgclock' }), wrap = $c('div', { class: 'mgcon' }); let done = false, t0 = performance.now();
  root.append(hud(trust, sus, clock), wrap);
  const av = $c('div', { class: 'mgtourist' }); av.innerHTML = X.avatarSVG({ handle: 'tourist' + L.seed, id: 'tourist' + L.seed, gender: L.seed % 2 ? 'f' : 'm' });
  const face = $c('div', { class: 'mgface' }), bubble = $c('div', { class: 'mgbubble' }), opts = $c('div', { class: 'mgopts' }), turnLab = $c('div', { class: 'mgturn' });
  wrap.append($c('div', { class: 'mgtop' }, av, face), bubble, turnLab, opts);
  const state = () => MG.conReplay(L, picks), show = () => {
    const st = state(), S0 = st.state || { trust: 0, sus: 0, turns: 0 }; trust.set(S0.trust / L.need); sus.set(S0.sus / 100);
    if (st.ok) { done = true; setTimeout(() => finish({ picks }), 700); bubble.textContent = st.money ? 'Deal! I\'ll take it. 🤑' : 'Hmm… no thanks. I\'m off.'; face.textContent = st.money ? '🤩' : '😠'; opts.innerHTML = ''; return; }
    const R0 = L.rounds[picks.length], M = MG.MOODS[R0.mood]; face.textContent = M.face; bubble.textContent = M.say[R0.say]; turnLab.textContent = `Turn ${picks.length + 1} of ${L.rounds.length} · they seem ${M.name.toLowerCase()}`;
    opts.innerHTML = ''; R0.options.forEach((o, i) => opts.append($c('button', { class: 'mgopt', onclick: () => aim(i) }, $c('b', { text: MG.TAGS[o.tag].name }), $c('span', { text: MG.TAGS[o.tag].lines[o.line] })))); };
  // the timing bar for the chosen line: tap "Say it" with the marker in the green
  const aim = i => { opts.innerHTML = ''; const zoneW = L.zone, bar = $c('div', { class: 'mgtime' }), zone = $c('i', { class: 'z', style: `left:${(0.5 - zoneW / 2) * 100}%;width:${zoneW * 100}%` }), mk = $c('i', { class: 'm' }); bar.append(zone, mk);
    let pos = 0, dir = 1, on = true; const sp = 0.9 + L.diff * 0.18; let last = performance.now();
    const step = now => { if (!on) return; const dt = (now - last) / 1000; last = now; pos += dir * sp * dt; if (pos > 1) { pos = 1; dir = -1; } if (pos < 0) { pos = 0; dir = 1; } mk.style.left = (pos * 100) + '%'; requestAnimationFrame(step); }; requestAnimationFrame(step);
    const say = () => { if (!on) return; on = false; const off = Math.abs(pos - 0.5), tm = Math.max(0, 1 - Math.max(0, off - zoneW / 2) / 0.35) * (off <= zoneW / 2 ? 1 : 0.7); picks.push({ o: i, t: +tm.toFixed(3) }); buzz(tm > 0.9 ? 25 : 10); show(); };
    opts.append($c('p', { class: 'mghint', text: MG.TAGS[L.rounds[picks.length].options[i].tag].lines[L.rounds[picks.length].options[i].line] }), bar, $c('button', { class: 'mgb hot', text: '🗣️ Say it', onclick: say })); };
  show();
  loop(root, () => { const el = (performance.now() - t0) / 1000; clock.textContent = `${Math.max(0, Math.ceil(L.limit - el))}s`;
    if (!done && el >= L.limit) { done = true; while (picks.length < L.rounds.length && !MG.conReplay(L, picks).ok) picks.push({ o: 0, t: 0 }); finish({ picks }); } });
}

// ---------------- Wire & code ----------------
function atm(root, L, finish) {
  const alarm = meter('alarm', '🚨'), clock = $c('b', { class: 'mgclock' }), wrap = $c('div', { class: 'mgatm' }), events = [], t0 = performance.now(); let pen = 0, done = false, stage = 'wires', sel = null;
  const now = () => +((performance.now() - t0) / 1000).toFixed(2);
  root.append(hud(alarm, clock), wrap);
  const card = $c('div', { class: 'mgcardsheet' }, $c('b', { text: '📋 Service card' })); [...L.card].sort((a, b) => a.sym - b.sym).forEach(c => card.append($c('span', { class: 'mgchip' }, $c('i', { style: `background:${MG.WIRE_COLS[c.col]}` }), `${MG.WIRE_NAMES[c.col]} → ${MG.SYMBOLS[c.sym]}`)));
  const board = $c('div', { class: 'mgboard' }), left = $c('div', { class: 'mgcol' }), right = $c('div', { class: 'mgcol r' }), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'mgwires');
  board.append(left, svg, right); const linked = new Map(); // wire → socket
  const wires = L.wires.map((c, i) => { const b = $c('button', { class: 'mgwire', style: `--c:${MG.WIRE_COLS[c]}`, 'aria-label': MG.WIRE_NAMES[c] + ' wire', onclick: () => { if (stage !== 'wires' || linked.has(i)) return; sel = i; wires.forEach((w, k) => w.classList.toggle('on', k === i)); } }); left.append(b); return b; });
  const socks = L.sockets.map((sym, k) => { const b = $c('button', { class: 'mgsock', text: MG.SYMBOLS[sym], onclick: () => { if (stage !== 'wires' || sel == null) return; const w = sel; sel = null; wires.forEach(x => x.classList.remove('on')); events.push(['w', w, k, now()]);
      if (L.card[w].sym === sym) { linked.set(w, k); wires[w].classList.add('done'); b.classList.add('done'); draw(); buzz(15); if (linked.size === L.wires.length) setTimeout(startPin, 400); }
      else { pen += L.wrongWire; b.classList.add('spark'); setTimeout(() => b.classList.remove('spark'), 400); buzz(120); } } }); right.append(b); return b; });
  const draw = () => { const r0 = board.getBoundingClientRect(); svg.innerHTML = ''; for (const [w, k] of linked) { const a = wires[w].getBoundingClientRect(), b = socks[k].getBoundingClientRect(), x1 = a.right - r0.left, y1 = a.top + a.height / 2 - r0.top, x2 = b.left - r0.left, y2 = b.top + b.height / 2 - r0.top;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`); p.setAttribute('stroke', MG.WIRE_COLS[L.wires[w]]); p.setAttribute('stroke-width', '5'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); svg.append(p); } };
  const status = $c('p', { class: 'mghint', text: 'Tap a wire, then the socket with its symbol.' });
  wrap.append(card, board, status);
  // the keypad: watch the code flash, then tap it back
  let at = 0, showing = false; const pad = $c('div', { class: 'mgpad' }), keys = [];
  for (let d = 1; d <= 9; d++) { const b = $c('button', { class: 'mgkey', text: String(d), onclick: () => press(d) }); keys.push(b); pad.append(b); }
  const flash = (d, ms) => { const b = keys[d - 1]; b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), ms); };
  const playCode = () => { showing = true; status.textContent = '👀 Watch the code…'; const gap = Math.max(260, 520 - L.diff * 45); L.pin.forEach((d, i) => setTimeout(() => flash(d, gap * 0.7), 400 + i * gap)); setTimeout(() => { showing = false; status.textContent = 'Now tap it back.'; }, 400 + L.pin.length * gap); };
  const startPin = () => { stage = 'pin'; wrap.innerHTML = ''; wrap.append($c('div', { class: 'mgscreen', text: 'ENTER SERVICE CODE' }), pad, status); playCode(); };
  const press = d => { if (stage !== 'pin' || showing || done) return; events.push(['k', d, now()]); flash(d, 150);
    if (d === L.pin[at]) { at++; buzz(10); if (at === L.pin.length) { stage = 'open'; status.textContent = '💸 Cash coming out!'; end(); } }
    else { at = 0; pen += L.wrongKey; buzz(150); pad.classList.add('shake'); setTimeout(() => pad.classList.remove('shake'), 350); setTimeout(playCode, 500); } };
  const end = () => { if (done) return; done = true; setTimeout(() => finish({ events, time: now() }), 700); };
  addEventListener('resize', draw);
  loop(root, () => { const t = (performance.now() - t0) / 1000, a = pen + t / L.limit; alarm.set(a); alarm.classList.toggle('hot', a > 0.7); clock.textContent = `${Math.max(0, Math.ceil(L.limit - t))}s`;
    if (!done && a >= 1) { stage = 'alarm'; status.textContent = '🚨 The alarm went off!'; root.classList.add('siren'); buzz(500); end(); } });
  const stop = root._stop; root._stop = () => { stop && stop(); removeEventListener('resize', draw); };
}
