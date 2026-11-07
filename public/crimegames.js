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
  driver: { icon: '🚗', name: 'Driver: the getaway', how: ['Get the crew\'s car to the end of the road.', 'Tap the left or right side of the screen (or swipe, or use the arrow keys) to change lane and dodge the traffic and roadblocks.', 'Each crash slows you right down. Four crashes and the car\'s wrecked.'] },
  hacker: { icon: '💻', name: 'Hacker: the security panel', how: ['Rewire the panel: tap a wire, then the socket with that colour\'s symbol on the service card.', 'Then watch the keypad flash a code and tap it back.', 'Wrong moves make the alarm jump. If the alarm fills, the sirens go off.'] },
  safecracker: { icon: '🔐', name: 'Safecracker: the dial', how: ['The dial spins by itself. Tap when the pointer is on the green number to lock it in.', 'Then the next number, spinning the other way, until the safe opens.', 'A tap off the number makes a noise. Five noises and the alarm goes.'] },
  lookout: { icon: '👀', name: 'Lookout: spot the police', how: ['Watch the windows and doorways. Tap the police (👮 🕵️) before they duck away.', 'Don\'t tap ordinary people: a false alarm adds heat. So does every officer you miss.', 'Keep watch until the time is up. Full heat and the job is blown.'] },
  muscle: { icon: '💪', name: 'Muscle: hold the doors', how: ['Guards run at the doors from both sides.', 'Tap the left or right side to shove back the nearest guard on that side, once they\'re in the red zone.', 'Shoving at nobody wastes your strength. Three guards through and the doors are lost.'] },
};
const ROLE = k => !!MG.ROLES[k];

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
  const real = !info.blocked && !info.practiceOnly, heist = info.heist;
  root.append($c('div', { class: 'mgcard' },
    $c('button', { class: 'mgx', 'aria-label': 'Close', text: '×', onclick: close }),
    $c('div', { class: 'mgicon', text: I.icon }), $c('h2', { text: I.name }), info.at ? $c('p', { class: 'mgat', text: `At ${info.at}` }) : null,
    $c('div', { class: 'mgrow' }, $c('span', { text: 'Difficulty' }), pips),
    $c('div', { class: 'mgrow' }, $c('span', { text: 'The setting' }), $c('b', { text: `${setting} of 40 points` })),
    $c('p', { class: 'mghint', text: [info.band === 'low' ? '🔴 Police close by' : info.band === 'mid' ? '🟡 Police not far' : '🟢 No police nearby', info.night ? '🌙 dark streets' : null, info.wave ? '🦹 crime wave' : null].filter(Boolean).join(' · ') }),
    $c('ul', { class: 'mghow' }, ...I.how.map(t => $c('li', { text: t }))),
    $c('p', { class: 'mghint', text: heist ? 'The whole crew plays at the same time. The crew\'s average play (up to 60) plus the setting (up to 40) decides the job: 80+ pays up to 1.5× the loot, below 40 the crew is caught. Botch your own part and you\'re caught whatever the rest do.'
      : ROLE(kind) ? 'Practice for a heist part: it\'s free and scored out of 60, like the real thing.' : 'Your play earns up to 60 points and the setting up to 40. 80+ is a clean getaway (up to 1.5× the takings), 60–79 gets you some of it, 40–59 nothing, below 40 you\'re caught: fined, and below 20 jailed too.' }),
    heist ? $c('p', { class: 'mgat mgleft', text: '' }) : null,
    $c('div', { class: 'mgbtns' },
      $c('button', { class: 'mgb', text: heist ? '▶ Practise first' : '▶ Practise (free)', onclick: () => begin(root, kind, info, true) }),
      heist ? $c('button', { class: 'mgb hot', text: '🎯 Play my part now', onclick: () => begin(root, kind, info, false) })
        : info.practiceOnly ? null : $c('button', { class: 'mgb hot', text: real ? '🎯 Do it for real' : info.blocked, disabled: real ? null : '', onclick: () => real && begin(root, kind, info, false) }))));
  if (heist && info.until) { const lab = root.querySelector('.mgleft'); const tick = () => { if (!lab.isConnected) return; const left = Math.max(0, info.until - Date.now()); lab.textContent = `⏱️ ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left for the crew to play`; setTimeout(tick, 500); }; tick(); }
}
async function begin(root, kind, info, practice) {
  root.innerHTML = ''; root.append($c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Setting up…' })));
  let run; try { run = info.heist && !practice ? await X.api(`/api/me/heists/${encodeURIComponent(info.heist)}/play`, { method: 'POST', body: {} }) : await X.api('/api/me/crime/start', { method: 'POST', body: { kind, practice } }); }
  catch (e) { X.toast(e.message); if (info.heist && !practice) close(); else intro(root, kind, info); return; }
  const L = MG.levelOf(kind, run.seed, run.diff);
  root.innerHTML = ''; const cd = $c('div', { class: 'mgcount', text: '3' }); root.append(cd);
  let n = 3; const tick = () => { n--; if (n > 0) { cd.textContent = String(n); setTimeout(tick, 650); } else { cd.remove(); play(root, kind, L, run, info); } }; setTimeout(tick, 650);
}
function play(root, kind, L, run, info) {
  const finish = async log => { root._stop && root._stop(); root.innerHTML = ''; root.append($c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Counting up…' })));
    let r; try { r = await X.api('/api/me/crime/finish', { method: 'POST', body: { runId: run.id, log } }); } catch (e) { X.toast(e.message); close(); return; }
    if (r.heistId) { heistWait(root, kind, info, r); return; }
    result(root, kind, info, run, r); if (!run.practice) X.done && X.done(r); };
  const g = MG.GAMES[kind];
  if (g === 'stealth') stealth(root, L, finish); else if (g === 'con') con(root, L, finish); else if (g === 'atm') atm(root, L, finish);
  else if (g === 'drive') drive(root, L, finish); else if (g === 'safe') safe(root, L, finish); else if (g === 'lookout') lookout(root, L, finish); else muscle(root, L, finish);
}
// After your part in a heist: your score, then the crew as they finish, then how the job went.
function heistWait(root, kind, info, r) {
  root.innerHTML = ''; buzz(40);
  const I = INFO[kind], card = $c('div', { class: 'mgcard res' }), list = $c('ul', { class: 'mgcrew' }), head = $c('p', { class: 'mghint', text: 'Waiting for the crew…' }), body = $c('div');
  card.append(...[$c('div', { class: 'mgicon', text: I.icon }), $c('h2', { text: `Your part: ${r.score.play} of 60` }), r.game && r.game.invalid ? $c('p', { class: 'mghint', text: 'That game didn\'t add up, so it counts as botched.' }) : null, head, list, body].filter(Boolean));
  root.append(card); let stop = false; root._stop = () => { stop = true; };
  const show = st => { list.innerHTML = ''; const L0 = st.live || {};
    for (const m of L0.crew || []) list.append($c('li', null, $c('span', { text: `${MG.ROLES[m.role].icon} @${m.h}` }), $c('b', { text: m.done ? '✅ done' : m.playing ? '🎮 playing' : '⏳ not started' })));
    if (st.status !== 'done' || !st.result) { const left = Math.max(0, (L0.until || 0) - Date.now()); head.textContent = `Waiting for the crew… ${Math.ceil(left / 1000)}s left`; return false; }
    const R0 = st.result, me = (X.me() || '').toLowerCase(), mine = (R0.parts || []).find(p => p.h.toLowerCase() === me) || {};
    head.textContent = ''; list.innerHTML = '';
    for (const p of R0.parts || []) list.append($c('li', null, $c('span', { text: `${MG.ROLES[p.role].icon} @${p.h}` }), $c('b', { text: p.status === 'noshow' ? 'didn\'t show' : `${p.play}/60 ${p.status === 'caught' ? '🚓' : '✅'}` })));
    const good = R0.win, bad = (R0.parts || []).some(p => p.status === 'caught') && !R0.win;
    const bar = (label, v, max, cls) => $c('div', { class: 'mgbar' }, $c('span', { text: label }), $c('div', { class: 'mgtrack' }, $c('i', { class: cls, style: `width:${Math.round(v / max * 100)}%` })), $c('b', { text: `${v}/${max}` }));
    body.innerHTML = ''; body.append($c('h2', { text: (good ? '💰 ' : bad ? '🚓 ' : '🫥 ') + R0.title }), bar('Crew play', R0.score.play, 60, 'p'), bar('The setting', R0.score.setting, 40, 's'), $c('div', { class: 'mgtotal' }, $c('span', { text: 'Crew score' }), $c('b', { text: `${R0.score.total}` })),
      $c('p', { class: 'mgmoney', text: mine.status === 'got' ? (mine.each ? `+${X.fmt(mine.each)} coins` : 'You got away, with nothing.') : mine.status === 'caught' ? `🚓 You were caught: fined ${X.fmt(mine.fine)} coins${mine.jailed ? ' and jailed' : ''}.` : 'You sat this one out.' }),
      $c('div', { class: 'mgbtns' }, $c('button', { class: 'mgb hot', text: 'Back to the map', onclick: close })));
    card.classList.add(good ? 'good' : bad ? 'bad' : 'meh'); buzz(good ? [30, 40, 30] : 200); X.done && X.done(R0); return true; };
  const poll = async () => { if (stop || !card.isConnected) return; let st = null; try { st = await X.api(`/api/me/heists/${encodeURIComponent(r.heistId)}/live`); } catch (e) {}
    if (st && show(st)) return; setTimeout(poll, 2500); };
  if (r.heist && show(r.heist)) return; setTimeout(poll, 1500);
  body.append($c('div', { class: 'mgbtns' }, $c('button', { class: 'mgb', text: 'Wait on the map', onclick: close })));
}
function result(root, kind, info, run, r) {
  root.innerHTML = ''; const good = r.outcome === 'clean' || r.outcome === 'partial', bad = r.outcome === 'fined' || r.outcome === 'jailed';
  const bar = (label, v, max, cls) => $c('div', { class: 'mgbar' }, $c('span', { text: label }), $c('div', { class: 'mgtrack' }, $c('i', { class: cls, style: `width:${Math.round(v / max * 100)}%` })), $c('b', { text: `${v}/${max}` }));
  const money = r.practice && ROLE(kind) ? `Your part: ${r.score.play} of 60. ${r.score.play >= 45 ? 'The crew will be glad of you.' : r.score.play >= 12 ? 'Good enough to get away.' : 'Play like that on the job and you\'d be caught.'}` : r.practice ? (r.practiceLoot ? `For real, that would have paid about ${X.fmt(r.practiceLoot)} coins.` : bad ? 'For real, you\'d have been caught.' : 'For real, you\'d have got away with nothing.')
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

// A full-screen canvas sized for the phone, redrawn by the game each frame.
function canvasFor(root) {
  const cv = $c('canvas', { class: 'mgcanvas' }), g = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2), box = { W: 0, H: 0, g, cv, dpr };
  const fit = () => { box.W = root.clientWidth; box.H = root.clientHeight; cv.width = Math.round(box.W * dpr); cv.height = Math.round(box.H * dpr); cv.style.width = box.W + 'px'; cv.style.height = box.H + 'px'; };
  root.append(cv); fit(); const ro = new ResizeObserver(fit); ro.observe(root); box.off = () => ro.disconnect(); return box;
}
const rr = (g, x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
function keyHook(root, fn) { const k = e => { if (fn(e) !== false && e.key.startsWith('Arrow')) e.preventDefault(); }; addEventListener('keydown', k); const stop = root._stop; root._stop = () => { stop && stop(); removeEventListener('keydown', k); }; }

// ---------------- Getaway drive ----------------
function drive(root, L, finish) {
  const C = canvasFor(root), dmg = meter('alarm', '💥'), prog = meter('trust', '🏁'), clock = $c('b', { class: 'mgclock' });
  root.append(hud(prog, dmg, clock), $c('div', { class: 'mgjoyhint', text: 'Tap left or right to change lane' }));
  const s = MG.driveStart(), moves = []; let prevD = 0, acc = 0, want = 1, carX = 1, ended = false, shake = 0, lastCr = 0;
  const steer = dir => { if (ended) return; want = Math.max(0, Math.min(2, want + dir)); };
  let sx = null; C.cv.addEventListener('pointerdown', e => { sx = e.clientX; }); C.cv.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx; steer(Math.abs(dx) > 30 ? Math.sign(dx) : e.clientX < C.W / 2 ? -1 : 1); sx = null; });
  keyHook(root, e => { if (e.key === 'ArrowLeft' || e.key === 'a') steer(-1); else if (e.key === 'ArrowRight' || e.key === 'd') steer(1); else return false; });
  const COL = { car: ['#4A7BD9', '#3CC46A', '#F2C94C', '#B05FD6', '#F4F4F0'], van: ['#F4F4F0'], bus: ['#F2C94C'], police: ['#1E2A44'], cones: ['#F2994A'] };
  const vehicle = (g, x, y, w, h, col, kind, me) => {
    g.fillStyle = 'rgba(0,0,0,.3)'; rr(g, x - w / 2 + 3, y - h / 2 + 4, w, h, w * 0.25); g.fill();
    if (kind === 'cones') { for (const dx of [-0.3, 0, 0.3]) { g.fillStyle = '#F2994A'; g.beginPath(); g.moveTo(x + dx * w, y - h * 0.22); g.lineTo(x + dx * w + w * 0.13, y + h * 0.18); g.lineTo(x + dx * w - w * 0.13, y + h * 0.18); g.closePath(); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 1.5; g.stroke(); } return; }
    g.fillStyle = col; rr(g, x - w / 2, y - h / 2, w, h, w * 0.25); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(30,40,60,.75)'; rr(g, x - w * 0.36, y - h * (me ? 0.3 : 0.18), w * 0.72, h * 0.18, 4); g.fill(); rr(g, x - w * 0.36, y + h * (me ? 0.14 : 0.24), w * 0.72, h * 0.12, 4); g.fill();
    if (kind === 'police') { g.fillStyle = '#F4F4F0'; g.fillRect(x - w / 2 + 2, y - h * 0.05, w - 4, h * 0.12); g.fillStyle = (performance.now() / 180 | 0) % 2 ? '#FF4B3A' : '#4A7BD9'; g.fillRect(x - w * 0.3, y - h * 0.02, w * 0.6, h * 0.06); }
    if (me) { g.fillStyle = '#F4F4F0'; g.fillRect(x - w * 0.08, y - h / 2 + 2, w * 0.16, h - 4); }
  };
  loop(root, dt => {
    if (!ended) { acc += dt; while (acc >= MG.STEP && !s.done) { acc -= MG.STEP; prevD = s.d; let lane = s.lane; if (want !== s.lane) { lane = s.lane + Math.sign(want - s.lane); moves.push([s.n, lane]); } MG.driveStep(L, s, lane); } }
    if (s.crashes > lastCr) { lastCr = s.crashes; shake = 0.35; buzz(200); }
    const { g, W, H, dpr } = C, u = s.done ? 1 : Math.min(1, acc / MG.STEP), d = prevD + (s.d - prevD) * u;
    carX += (s.lane - carX) * Math.min(1, dt * 14); shake = Math.max(0, shake - dt);
    const roadW = Math.min(W * 0.86, 380), laneW = roadW / 3, rx = (W - roadW) / 2, k = H / 75, carY = H * 0.8, ox = shake ? (Math.random() - 0.5) * 10 : 0;
    g.setTransform(dpr, 0, 0, dpr, ox * dpr, 0);
    g.fillStyle = '#6FA84B'; g.fillRect(-20, 0, W + 40, H);
    g.fillStyle = '#5E9440'; const off = (d * k) % 60; for (let y = -60 + off; y < H; y += 60) { g.fillRect(0, y, rx - 10, 24); g.fillRect(rx + roadW + 10, y + 30, W, 24); }
    g.fillStyle = '#4A4A52'; g.fillRect(rx, 0, roadW, H); g.fillStyle = '#F4F4F0'; g.fillRect(rx - 4, 0, 4, H); g.fillRect(rx + roadW, 0, 4, H);
    g.fillStyle = '#F2C94C'; const doff = (d * k) % 40; for (const i of [1, 2]) for (let y = -40 + doff; y < H; y += 40) g.fillRect(rx + i * laneW - 2, y, 4, 20);
    const fy = carY - (L.D - d) * k; if (fy > -20) { for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#2B2621' : '#F4F4F0'; g.fillRect(rx + i * roadW / 12, fy - 10, roadW / 12, 10); g.fillStyle = i % 2 ? '#F4F4F0' : '#2B2621'; g.fillRect(rx + i * roadW / 12, fy, roadW / 12, 10); } }
    const vw = laneW * 0.56;
    for (let j = s.i; j < L.obs.length; j++) { const o = L.obs[j], y = carY - (o.d - d) * k; if (y < -80) break; if (s.gone.includes(j)) continue; const cs = COL[o.k] || COL.car;
      vehicle(g, rx + (o.lane + 0.5) * laneW, y, o.k === 'cones' ? vw * 1.3 : vw, o.k === 'bus' ? vw * 2.6 : o.k === 'van' ? vw * 2.1 : vw * 1.8, cs[j % cs.length], o.k, false); }
    vehicle(g, rx + (carX + 0.5) * laneW, carY, vw, vw * 1.8, '#E4572E', 'car', true);
    if (shake) { g.fillStyle = `rgba(255,75,58,${shake})`; g.fillRect(0, 0, W, H); }
    prog.set(d / L.D); dmg.set(s.crashes / MG.DRIVE.wreck); dmg.classList.toggle('hot', s.crashes >= MG.DRIVE.wreck - 1); clock.textContent = `${Math.max(0, Math.ceil(L.limit - s.t))}s`;
    if (s.done && !ended) { ended = true; C.off(); setTimeout(() => finish({ moves }), s.done === 'escaped' ? 500 : 900); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); C.off(); };
}

// ---------------- The dial ----------------
function safe(root, L, finish) {
  const C = canvasFor(root), noise = meter('alarm', '🔊'), clock = $c('b', { class: 'mgclock' }), info = $c('div', { class: 'mggoal' });
  const btn = $c('button', { class: 'mgb hot mgbig', text: '🔓 Click' }); root.append(hud(noise, clock), info, btn);
  const taps = [], t0 = performance.now(); let st = { stage: 'dial', got: 0, noise: 0 }, from = 0, flash = 0, flashCol = '', ended = false;
  const now = () => +((performance.now() - t0) / 1000).toFixed(2);
  const tap = () => { if (ended) return; const t = now(); taps.push(t); const r = MG.safeReplay(L, taps, t); if (!r.ok) return; const was = st.got; st = r.state;
    if (st.got > was) { from = t; flash = 0.4; flashCol = '60,196,106'; buzz(30); } else { flash = 0.4; flashCol = '255,75,58'; buzz(120); root.classList.add('shakeit'); setTimeout(() => root.classList.remove('shakeit'), 300); } };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); tap(); }); C.cv.addEventListener('pointerdown', tap); keyHook(root, e => { if (e.key === ' ' || e.key === 'Enter') { tap(); e.preventDefault(); } else return false; });
  const num = a => ((Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 100) % 100) + 100) % 100;
  loop(root, dt => {
    const t = (performance.now() - t0) / 1000, { g, W, H, dpr } = C; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#1B1612'; g.fillRect(0, 0, W, H);
    const R0 = Math.min(W * 0.4, H * 0.26), cx = W / 2, cy = H * 0.42, N = L.nums[Math.min(st.got, L.nums.length - 1)];
    // the safe door and the dial
    const dw = Math.min(W - 16, R0 * 2.5); g.fillStyle = '#5C6068'; rr(g, cx - dw / 2, cy - R0 * 1.25, dw, R0 * 2.5, 18); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#2E3238'; g.beginPath(); g.arc(cx, cy, R0 * 1.05, 0, 7); g.fill();
    g.fillStyle = '#D9D4C7'; g.beginPath(); g.arc(cx, cy, R0, 0, 7); g.fill(); g.stroke();
    if (st.stage === 'dial') { g.fillStyle = 'rgba(60,196,106,.85)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R0, N.a - L.tol - Math.PI / 2, N.a + L.tol - Math.PI / 2); g.closePath(); g.fill(); }
    g.strokeStyle = '#2B2621'; g.fillStyle = '#2B2621'; g.font = `700 ${Math.max(10, R0 * 0.11)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 100; i++) { const a = i / 100 * Math.PI * 2 - Math.PI / 2, l = i % 10 ? 0.06 : 0.12; g.lineWidth = i % 10 ? 1 : 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0); g.lineTo(cx + Math.cos(a) * R0 * (1 - l), cy + Math.sin(a) * R0 * (1 - l)); g.stroke();
      if (!(i % 10)) g.fillText(String(i), cx + Math.cos(a) * R0 * 0.78, cy + Math.sin(a) * R0 * 0.78); }
    const pa = st.stage === 'dial' ? MG.safeAngle(N, t - from) - Math.PI / 2 : -Math.PI / 2;
    g.strokeStyle = '#C8473D'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(pa) * R0 * 0.92, cy + Math.sin(pa) * R0 * 0.92); g.stroke(); g.lineCap = 'butt';
    g.fillStyle = '#2B2621'; g.beginPath(); g.arc(cx, cy, R0 * 0.16, 0, 7); g.fill();
    // the locked numbers
    const n = L.nums.length, bw = Math.min(46, (W - 40) / n - 6); for (let i = 0; i < n; i++) { const x = cx + (i - (n - 1) / 2) * (bw + 6), y = cy + R0 * 1.25 + 30; g.fillStyle = i < st.got ? '#3CC46A' : i === st.got ? '#F2C94C' : '#3A332B'; rr(g, x - bw / 2, y, bw, 34, 8); g.fill(); g.fillStyle = '#2B2621';
      g.font = `800 15px system-ui`; g.fillText(i < st.got ? String(num(L.nums[i].a)) : i === st.got ? '?' : '·', x, y + 17); }
    if (flash > 0) { flash -= dt; g.fillStyle = `rgba(${flashCol},${Math.max(0, flash) * 0.6})`; g.fillRect(0, 0, W, H); }
    const msg = st.stage === 'open' ? '🔓 It\'s open!' : `Stop on ${num(N.a)} · number ${st.got + 1} of ${n}`; if (info.textContent !== msg) info.textContent = msg;
    noise.set(st.noise); noise.classList.toggle('hot', st.noise > 0.55); clock.textContent = `${Math.max(0, Math.ceil(L.limit - t))}s`;
    if (!ended && (st.stage === 'open' || st.stage === 'alarm' || t >= L.limit)) { ended = true; C.off(); if (st.stage !== 'open') { root.classList.add('siren'); buzz(500); } setTimeout(() => finish({ taps, time: Math.min(+t.toFixed(2), L.limit) }), 700); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); C.off(); };
}

// ---------------- Spot the police ----------------
const COPS = ['👮', '👮‍♀️', '🕵️', '🕵️‍♀️'], FOLK = ['🧑', '👩', '👨‍🦳', '🧔', '👵', '👷', '🧑‍🍳', '💁', '🧕', '👨‍🦱', '👩‍🦰', '🧑‍🎤'];
function lookout(root, L, finish) {
  const heat = meter('alarm', '🔥'), clock = $c('b', { class: 'mgclock' }), score = $c('div', { class: 'mggoal', text: '👮 0 spotted' }), street = $c('div', { class: 'mgstreet' });
  root.append(hud(heat, clock), score, street);
  const taps = [], t0 = performance.now(), slots = [], shown = Array(MG.LOOK.spots).fill(-2), mark = new Map(); let ended = false, ev = { heat: 0, hits: 0 };
  for (let i = 0; i < MG.LOOK.spots; i++) { const b = $c('button', { class: 'mgwin ' + (i < 3 ? 'up' : 'down'), 'aria-label': `Spot ${i + 1}` }); const who = $c('span', { class: 'who' }); b.append(who);
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (ended) return; const t = +((performance.now() - t0) / 1000).toFixed(2); taps.push([i, t]);
      const pi = L.pops.findIndex((p, j) => p.s === i && p.t0 <= t && t <= p.t0 + p.dur && !mark.has(j)); if (pi >= 0) { mark.set(pi, L.pops[pi].cop ? 'hit' : 'wrong'); buzz(L.pops[pi].cop ? 25 : 150); b.classList.add(L.pops[pi].cop ? 'hit' : 'wrong'); setTimeout(() => b.classList.remove('hit', 'wrong'), 350); } });
    street.append(b); slots.push({ b, who }); }
  let lastEval = -1;
  loop(root, () => {
    const t = (performance.now() - t0) / 1000;
    for (let i = 0; i < slots.length; i++) { const pi = L.pops.findIndex((p, j) => p.s === i && p.t0 <= t && t <= p.t0 + p.dur && mark.get(j) !== 'hit'); if (pi !== shown[i]) { shown[i] = pi; const p = L.pops[pi];
        slots[i].who.textContent = p ? (p.cop ? COPS : FOLK)[p.look % (p.cop ? COPS.length : FOLK.length)] : ''; slots[i].b.classList.toggle('on', !!p); } }
    if (t - lastEval > 0.1) { lastEval = t; ev = MG.lookEval(L, taps, t) || ev; heat.set(ev.heat); heat.classList.toggle('hot', ev.heat > 0.6); const sc = `👮 ${ev.hits} spotted`; if (score.textContent !== sc) score.textContent = sc; }
    clock.textContent = `${Math.max(0, Math.ceil(L.limit - t))}s`;
    if (!ended && (ev.blown != null || t >= L.limit)) { ended = true; if (ev.blown != null) { root.classList.add('siren'); buzz(500); } setTimeout(() => finish({ taps, time: Math.min(+t.toFixed(2), L.limit) }), 700); }
  });
}

// ---------------- Hold the doors ----------------
function muscle(root, L, finish) {
  const C = canvasFor(root), door = meter('trust', '🚪'), clock = $c('b', { class: 'mgclock' }), info = $c('div', { class: 'mggoal', text: '💪 0 shoved' });
  root.append(hud(door, clock), info, $c('div', { class: 'mgjoyhint', text: 'Tap the left or right side to shove' }));
  const taps = [], t0 = performance.now(); let ended = false, ev = { shoved: 0, through: 0, lost: null, shovedSet: new Map() }, hitFx = [], lastThrough = 0;
  const shove = side => { if (ended) return; const t = +((performance.now() - t0) / 1000).toFixed(2); taps.push([side, t]); const before = ev.shoved; ev = MG.muscleEval(L, taps, t) || ev; if (ev.shoved > before) { buzz(25); hitFx.push({ side, at: performance.now() }); } else buzz(8); };
  C.cv.addEventListener('pointerdown', e => shove(e.clientX < C.W / 2 ? 0 : 1)); keyHook(root, e => { if (e.key === 'ArrowLeft' || e.key === 'a') shove(0); else if (e.key === 'ArrowRight' || e.key === 'd') shove(1); else return false; });
  const SK = ['#8D5524', '#C68642', '#E0AC69', '#5C3A21'];
  loop(root, () => {
    const t = (performance.now() - t0) / 1000, { g, W, H, dpr } = C; ev = MG.muscleEval(L, taps, t) || ev;
    if (ev.through > lastThrough) { lastThrough = ev.through; buzz(250); root.classList.add('shakeit'); setTimeout(() => root.classList.remove('shakeit'), 300); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fy = H * 0.62, cx = W / 2, half = W / 2 - 20, dw = Math.min(90, W * 0.2), s = Math.min(1.4, W / 400);
    g.fillStyle = '#3B342C'; g.fillRect(0, 0, W, H); g.fillStyle = '#7A6A5A'; g.fillRect(0, fy, W, H - fy); // wall and floor
    g.fillStyle = '#6E5E4E'; for (let x = 0; x < W; x += 48) g.fillRect(x, fy, 2, H - fy);
    g.fillStyle = 'rgba(255,75,58,.35)'; g.fillRect(cx - dw / 2 - half * MG.MUSCLE.reach, fy, half * MG.MUSCLE.reach, 14); g.fillRect(cx + dw / 2, fy, half * MG.MUSCLE.reach, 14);
    // the doors (cracks as guards get through)
    g.fillStyle = '#8A5A33'; g.fillRect(cx - dw / 2, fy - dw * 1.7, dw, dw * 1.7); g.strokeStyle = '#2B2621'; g.lineWidth = 3; g.strokeRect(cx - dw / 2, fy - dw * 1.7, dw, dw * 1.7); g.beginPath(); g.moveTo(cx, fy - dw * 1.7); g.lineTo(cx, fy); g.stroke();
    g.strokeStyle = '#1B1612'; g.lineWidth = 2; for (let i = 0; i < ev.through; i++) { g.beginPath(); g.moveTo(cx - dw * 0.3 + i * 12, fy - dw * (1.4 - i * 0.3)); g.lineTo(cx - dw * 0.1 + i * 10, fy - dw * (1.1 - i * 0.3)); g.lineTo(cx + dw * 0.2, fy - dw * (1.2 - i * 0.3)); g.stroke(); }
    // me, in front of the doors
    const me = (x, col) => { g.fillStyle = col; rr(g, x - 16 * s, fy - 62 * s, 32 * s, 40 * s, 8 * s); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#7A4E2D'; g.beginPath(); g.arc(x, fy - 72 * s, 11 * s, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#2B2621'; g.fillRect(x - 12 * s, fy - 22 * s, 9 * s, 22 * s); g.fillRect(x + 3 * s, fy - 22 * s, 9 * s, 22 * s); };
    me(cx, '#2E3440');
    // guards
    L.guards.forEach((gd, i) => { if (gd.t0 > t) return; const sh = ev.shovedSet.get(i); let p = MG.guardPos(gd, t), a = 1;
      if (sh != null && sh <= t) { const k = t - sh; if (k > 0.5) return; p = MG.guardPos(gd, sh) + k * 2.2; a = 1 - k * 2; } else if (p <= 0) return;
      const x = gd.side ? cx + dw / 2 + p * half : cx - dw / 2 - p * half; g.globalAlpha = Math.max(0, a);
      g.fillStyle = '#2F4A7A'; rr(g, x - 14 * s, fy - 58 * s, 28 * s, 36 * s, 7 * s); g.fill(); g.strokeStyle = '#2B2621'; g.lineWidth = 2; g.stroke();
      g.fillStyle = SK[gd.look % SK.length]; g.beginPath(); g.arc(x, fy - 68 * s, 10 * s, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#1E2A44'; g.fillRect(x - 11 * s, fy - 80 * s, 22 * s, 6 * s);
      const leg = Math.sin(t * 14 + i) * 5 * s; g.fillStyle = '#2B2621'; g.fillRect(x - 9 * s + leg, fy - 22 * s, 7 * s, 22 * s); g.fillRect(x + 2 * s - leg, fy - 22 * s, 7 * s, 22 * s); g.globalAlpha = 1; });
    hitFx = hitFx.filter(f => performance.now() - f.at < 300); for (const f of hitFx) { const k = (performance.now() - f.at) / 300; g.fillStyle = `rgba(242,201,76,${1 - k})`; g.font = `900 ${28 + k * 20}px system-ui`; g.textAlign = 'center'; g.fillText('POW!', f.side ? cx + dw + 40 : cx - dw - 40, fy - 100 * s - k * 30); }
    door.set(1 - ev.through / MG.MUSCLE.breaches); door.classList.toggle('hot', ev.through >= MG.MUSCLE.breaches - 1); const it = `💪 ${ev.shoved} shoved`; if (info.textContent !== it) info.textContent = it; clock.textContent = `${Math.max(0, Math.ceil(L.limit - t))}s`;
    if (!ended && (ev.lost != null || t >= L.limit)) { ended = true; C.off(); if (ev.lost != null) { root.classList.add('siren'); buzz(500); } setTimeout(() => finish({ taps, time: Math.min(+t.toFixed(2), L.limit) }), 700); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); C.off(); };
}
