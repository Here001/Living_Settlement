// Crime mini games in the browser: a full-screen game for robbing a shop, conning a tourist and hacking an ATM.
// The rules (levels, moves, scoring) are in /shared/minigames.js, the same ones the server uses to check the result.
// While a game is open the map behind it is paused (see Power in index.html), so the phone only works on the game.
import * as MG from '/shared/minigames.js';
import { sfx, feedback, shake, flash, pop, screenOf, bump, unlock, sound } from '/juice.js';

let X = null; // what the page lends us: { api, toast, fmt, avatarSVG, done(result) }
const $c = (tag, props, ...kids) => { const e = document.createElement(tag); if (props) for (const k in props) { const v = props[k]; if (v == null) continue;
  if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const c of kids) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

const INFO = {
  rob: { icon: '🛒', name: 'Rob the shop', how: ['Sneak in the back door, get to the till and stay next to it while you empty it. Then get out the way you came in.', 'Stay out of the staff\'s view (the yellow cones) and away from cameras. They wander and stop to look around, so watch them. If the eye meter fills, you\'re spotted.', 'Red laser tripwires blink on and off: cross while they\'re off. Optional extras (jewels, a cash box, phones, watches) each add 15% to the takings, if you dare.', 'Move: drag anywhere on the screen (or use the arrow keys).'] },
  scam: { icon: '🎭', name: 'Con a tourist', how: ['Sell a tourist a "genuine" Gliese moon rock before they smell a rat.', 'Each turn, pick a line that suits their mood (watch what they say), then tap "Say it" while the marker is in the green.', 'Trust full: sold. Suspicion full: they walk off.'] },
  atm: { icon: '🏧', name: 'Hack the ATM', how: ['Rewire the cash machine: tap a wire, then the socket with that colour\'s symbol on the service card.', 'Then watch the keypad flash a code and tap it back.', 'Wrong moves make the alarm jump. If the alarm fills, the bank\'s siren goes off.'] },
  driver: { icon: '🚗', name: 'Driver: the getaway', how: ['Get the crew\'s car to the end of the road.', 'Tap the left or right side of the screen (or swipe, or use the arrow keys) to change lane and dodge the traffic and roadblocks.', 'Each crash slows you right down. Four crashes and the car\'s wrecked.'] },
  hacker: { icon: '💻', name: 'Hacker: the security panel', how: ['Rewire the panel: tap a wire, then the socket with that colour\'s symbol on the service card.', 'Then watch the keypad flash a code and tap it back.', 'Wrong moves make the alarm jump. If the alarm fills, the sirens go off.'] },
  safecracker: { icon: '🔐', name: 'Safecracker: the dial', how: ['The dial spins by itself. Tap when the pointer is on the green number to lock it in.', 'Then the next number, spinning the other way, until the safe opens.', 'A tap off the number makes a noise. Five noises and the alarm goes.'] },
  lookout: { icon: '👀', name: 'Lookout: spot the police', how: ['Watch the doorways and alleys round the yard. People keep stepping out: tap the police (in uniform, or plain clothes with dark glasses) before they slip away.', 'Don\'t tap ordinary people: a false alarm adds heat. So does every officer you miss.', 'Keep watch until the time is up. Full heat and the job is blown.'] },
  muscle: { icon: '💪', name: 'Muscle: hold off the horde', how: ['The dead are pouring into the yard while the crew works. Stay alive until the clock runs out.', 'Move with your left thumb (drag anywhere). Hold the red button on the right to fight: a bat to start with, and guns aim themselves at the nearest zombie.', 'Pistols, shotguns, rifles and first-aid kits turn up on the ground: walk over them to pick them up. Every wave is bigger, faster and hungrier.'] },
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
  unlock(); root.innerHTML = ''; root.append($c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Setting up…' })));
  let run; try { run = info.heist && !practice ? await X.api(`/api/me/heists/${encodeURIComponent(info.heist)}/play`, { method: 'POST', body: {} }) : await X.api('/api/me/crime/start', { method: 'POST', body: { kind, practice } }); }
  catch (e) { X.toast(e.message); if (info.heist && !practice) close(); else intro(root, kind, info); return; }
  const L = MG.levelOf(kind, run.seed, run.diff, !!run.hard);
  root.innerHTML = ''; const cd = $c('div', { class: 'mgcount', text: '3' }); root.append(cd);
  let n = 3; sfx('tick'); const tick = () => { n--; if (n > 0) { cd.textContent = String(n); bump(cd); sfx('tick'); setTimeout(tick, 650); } else { cd.remove(); sfx('whoosh'); play(root, kind, L, run, info); } }; setTimeout(tick, 650);
}
function play(root, kind, L, run, info) {
  const finish = async log => { root._stop && root._stop(); root.innerHTML = ''; root.append($c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Counting up…' })));
    let r; try { r = await X.api('/api/me/crime/finish', { method: 'POST', body: { runId: run.id, log } }); } catch (e) { X.toast(e.message); close(); return; }
    if (r.heistId) { heistWait(root, kind, info, r); return; }
    result(root, kind, info, run, r); if (!run.practice) X.done && X.done(r); };
  const g = MG.GAMES[kind];
  if (g === 'stealth') stealth(root, L, finish); else if (g === 'con') con(root, L, finish); else if (g === 'atm') atm(root, L, finish);
  else if (g === 'drive') drive(root, L, finish); else if (g === 'safe') safe(root, L, finish); else if (g === 'lookout') lookout(root, L, finish); else if (g === 'horde') horde(root, L, finish); else muscle(root, L, finish);
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
    card.classList.add(good ? 'good' : bad ? 'bad' : 'meh'); buzz(good ? [30, 40, 30] : 200); sfx(good ? 'win' : bad ? 'lose' : 'wrong'); X.done && X.done(R0); return true; };
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
    $c('div', { class: 'mgbtns' }, $c('button', { class: 'mgb hot', text: 'Done', onclick: close }))));
  buzz(good ? [30, 40, 30] : bad ? 300 : 60); sfx(good ? 'win' : bad ? 'lose' : 'wrong');
  // the takings count up, coin by coin
  const mEl = root.querySelector('.mgmoney'); if (r.money && !r.practice && mEl) { const full = mEl.textContent, t0 = performance.now(), dur = Math.min(1400, 500 + r.money / 50);
    const up = now => { if (!mEl.isConnected) return; const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); mEl.textContent = `+${X.fmt(Math.round(r.money * e))} coins`; if (k < 1) { sfx('tick'); requestAnimationFrame(up); } else { mEl.textContent = full; bump(mEl); sfx('coin'); } }; requestAnimationFrame(up); }
}

// A game loop that only runs while the game is on screen, and stops cleanly.
function loop(root, fn) { let on = true, last = performance.now(); const f = now => { if (!on) return; const dt = Math.min(0.1, (now - last) / 1000); last = now; fn(dt, now); requestAnimationFrame(f); }; requestAnimationFrame(f); root._stop = () => { on = false; }; }
const hud = (...kids) => { const b = $c('button', { class: 'mgsnd', 'aria-label': 'Sound', 'aria-pressed': String(sound.on), text: sound.on ? '🔊' : '🔇', onclick: e => { e.stopPropagation(); sound.set(!sound.on); b.textContent = sound.on ? '🔊' : '🔇'; b.setAttribute('aria-pressed', String(sound.on)); } });
  return $c('div', { class: 'mghud' }, ...kids, b); };
const meter = (cls, label) => { const i = $c('i'); const m = $c('div', { class: 'mgmeter ' + cls }, $c('span', { text: label }), $c('div', { class: 'mgtrack' }, i)); m.set = v => { i.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; }; return m; };

// ---------------- Cut-away stealth ----------------
// In 3D: the shop with its front walls cut away, the shopkeeper and guards walking their rounds, view cones that stop at
// the shelves, and you sneaking in. Falls back to the flat version if the phone can't do 3D.
async function stealth(root, L, finish) {
  const loading = $c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Casing the shop…' })); root.append(loading);
  let W; try { W = await load3d(); } catch (e) { loading.remove(); return stealth2d(root, L, finish); }
  loading.remove(); if (!root.isConnected) return;
  const cv = $c('canvas', { class: 'mgcanvas' }), seen = meter('eye', '👁'), goal = $c('div', { class: 'mggoal', text: '💰 Get to the till' }), clock = $c('b', { class: 'mgclock' }), stick = $c('div', { class: 'astick' }, $c('i'));
  root.append(cv, hud(seen, clock), goal, stick, $c('div', { class: 'mgjoyhint', text: 'Drag anywhere to move' }));
  const view = W.createView(cv), THREE = W.THREE, U = 1.6; view.resize(); view.setTime(720); W.buildShop(view, L, U);
  const ro = new ResizeObserver(() => { view.resize(); frame(); }); ro.observe(root);
  // the camera: from the front corner, far enough back to see the whole shop
  // (on a tall phone screen, from the front, so the whole width fits; on a wide one, from the front corner)
  let yaw = Math.PI / 4; const cx = L.W * U / 2, cz = L.H * U / 2;
  const frame = () => { const asp = view.camera.aspect; yaw = asp < 0.9 ? 0 : Math.PI / 4; view.camera.fov = asp < 0.9 ? 52 : 40; view.camera.updateProjectionMatrix();
    const half = (yaw ? Math.hypot(L.W, L.H) * U * 0.72 : L.W * U) / 2 + 0.6, hf = Math.atan(Math.tan(view.camera.fov * Math.PI / 360) * asp), vf = view.camera.fov * Math.PI / 360;
    const dist = Math.max(half / Math.tan(hf), (L.H * U * 0.62) / Math.tan(vf)), pitch = 0.98;
    view.camera.position.set(cx + Math.sin(yaw) * dist * Math.cos(pitch), dist * Math.sin(pitch), cz + Math.cos(yaw) * dist * Math.cos(pitch)); view.camera.lookAt(cx, 0, cz - (yaw ? 0 : 1.2)); }; frame();
  const me = W.makePerson('robber' + L.seed, 'civilian'); view.scene.add(me.group);
  const mask = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: '#111' })); mask.position.y = 1.74; me.body.add(mask);
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshStandardMaterial({ color: '#e2b13c', metalness: 0.5, roughness: 0.4 })); bag.position.set(0.38, 0.9, 0); bag.visible = false; me.group.add(bag);
  const staff = L.guards.map((g, i) => { const p = W.makePerson('staff' + L.seed + i, g.kind === 'guard' ? 'hunter' : 'civilian'); view.scene.add(p.group); const cone = W.viewCone('#ffd54a'); view.scene.add(cone); return { p, cone, last: null }; });
  const cams = L.cams.map(c => { const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.5), new THREE.MeshStandardMaterial({ color: '#3a3a44', metalness: 0.6, roughness: 0.4 })); body.position.y = 3; g.add(body);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff4b3a' })); led.position.set(0.1, 3.08, 0.25); g.add(led); g.position.set(c.x * U, 0, c.y * U); view.scene.add(g); const cone = W.viewCone('#ffd54a'); view.scene.add(cone); return { g, cone, led }; });
  const ringGeo = new THREE.RingGeometry(0.42, 0.55, 32, 1, 0, Math.PI * 2), ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#7cffb2', side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(L.till.x * U, 1.6, (L.till.y - 1) * U); view.scene.add(ring);
  const exitGlow = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 32), new THREE.MeshBasicMaterial({ color: '#3cc46a', transparent: true, opacity: 0.8, side: THREE.DoubleSide })); exitGlow.rotation.x = -Math.PI / 2; exitGlow.position.set(L.entry.x * U, 0.05, L.entry.y * U); exitGlow.visible = false; view.scene.add(exitGlow);
  // laser tripwires (two red beams at shin and waist height) and the extra loot on little stands
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const lasers = (L.lasers || []).map(z => { const g = new THREE.Group(), len = Math.hypot(z.x1 - z.x0, z.y1 - z.y0) * U, mx = (z.x0 + z.x1) / 2 * U, mz = (z.y0 + z.y1) / 2 * U, horiz = z.y0 === z.y1;
    for (const y of [0.35, 0.9]) { const b = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 0.035, 0.035, horiz ? 0.035 : len), beamMat); b.position.set(mx, y, mz); g.add(b); }
    for (const [ex, ez] of [[z.x0, z.y0], [z.x1, z.y1]]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), new THREE.MeshStandardMaterial({ color: '#2b2f33', metalness: 0.7, roughness: 0.3 })); post.position.set(ex * U, 0.55, ez * U); view.scene.add(post); }
    view.scene.add(g); return g; });
  const ITEMC = { jewels: '#7fe3ff', cashbox: '#3cc46a', phones: '#9fb4ff', watches: '#f2c94c' };
  const items = (L.items || []).map(it => { const g = new THREE.Group(); const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.9, 12), new THREE.MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.5 })); stand.position.y = 0.45; g.add(stand);
    const gem = new THREE.Mesh(it.k === 'jewels' ? new THREE.OctahedronGeometry(0.17) : new THREE.BoxGeometry(0.34, 0.14, 0.24), new THREE.MeshStandardMaterial({ color: ITEMC[it.k], emissive: ITEMC[it.k], emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.2 })); gem.position.y = 1.05; g.add(gem);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 28), new THREE.MeshBasicMaterial({ color: ITEMC[it.k], transparent: true, opacity: 0.6, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.04; g.add(halo);
    g.position.set(it.x * U, 0, it.y * U); view.scene.add(g); g.userData = { gem, halo }; return g; });
  const itemsB = $c('b', { class: 'acount' }); if (items.length) root.querySelector('.mghud').insertBefore(itemsB, clock);
  const conePts = (from, dir, fov, range) => { const pts = [[from.x * U, from.y * U]]; for (let i = 0; i <= 16; i++) { const a = dir - fov + (2 * fov) * i / 16; let d = 0; while (d < range && !MG.isWall(L, from.x + Math.cos(a) * d, from.y + Math.sin(a) * d)) d += 0.15; pts.push([(from.x + Math.cos(a) * d) * U, (from.y + Math.sin(a) * d) * U]); } return pts; };
  // the game state moves in fixed steps; the picture is drawn in between
  let s = MG.stealthStart(L), prev = s, acc = 0; const path = [[s.x, s.y]], keys = new Set(); let joy = null, ended = false, lastGrab = false; stealth.zap = 0;
  const input = () => { let sx = 0, sy = 0; if (joy && Math.hypot(joy.dx, joy.dy) > 6) { sx = joy.dx / 55; sy = joy.dy / 55; }
    if (keys.has('ArrowUp') || keys.has('w')) sy -= 1; if (keys.has('ArrowDown') || keys.has('s')) sy += 1; if (keys.has('ArrowLeft') || keys.has('a')) sx -= 1; if (keys.has('ArrowRight') || keys.has('d')) sx += 1;
    const c = Math.cos(yaw), sn = Math.sin(yaw); let vx = sx * c + sy * sn, vy = -sx * sn + sy * c; const n = Math.hypot(vx, vy); return n > 1 ? [vx / n, vy / n] : [vx, vy]; };
  cv.addEventListener('pointerdown', e => { joy = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} stick.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px`; stick.firstChild.style.transform = 'translate(-50%,-50%)'; });
  cv.addEventListener('pointermove', e => { if (!joy || e.pointerId !== joy.id) return; let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const d = Math.hypot(dx, dy); if (d > 55) { dx *= 55 / d; dy *= 55 / d; } joy.dx = dx; joy.dy = dy; stick.firstChild.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`; });
  const up = () => { joy = null; stick.style.display = 'none'; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const kd = e => { keys.add(e.key); if (e.key.startsWith('Arrow')) e.preventDefault(); }, ku = e => keys.delete(e.key); addEventListener('keydown', kd); addEventListener('keyup', ku);
  view.start((dt, now) => {
    if (!ended) { acc += dt; while (acc >= MG.STEP && !s.done) { acc -= MG.STEP; prev = s; const [vx, vy] = input(); s = MG.stealthStep(L, s, vx, vy); path.push([+s.x.toFixed(4), +s.y.toFixed(4)]); if (s.who && !prev.who) { buzz(40); feedback('small', { view, sound: 'wrong' }); }
        if (MG.itemCount(s) > MG.itemCount(prev)) { const q = screenOf(view, s.x * U, 1.8, s.y * U), it = L.items[Math.log2((s.items || 0) & ~(prev.items || 0)) | 0]; feedback('small', { view, root, sound: 'pickup', text: `+ ${it ? MG.ITEMS[it.k].icon + ' ' + MG.ITEMS[it.k].name : '✨'}`, at: q, kind: 'gold' }); } } }
    const u = s.done ? 1 : Math.min(1, acc / MG.STEP), px = prev.x + (s.x - prev.x) * u, py = prev.y + (s.y - prev.y) * u, tt = prev.t + (s.t - prev.t) * u;
    const vx = (s.x - prev.x) / MG.STEP * U, vy = (s.y - prev.y) / MG.STEP * U; me.setPos(px * U, py * U); me.animate(dt, vx, vy); bag.visible = s.grabbed;
    const alarm = s.who > 0;
    L.guards.forEach((g, i) => { const q = MG.guardAt(g, tt), st = staff[i], ox = st.last ? q.x - st.last.x : 0, oy = st.last ? q.y - st.last.y : 0; st.last = q; st.p.setPos(q.x * U, q.y * U); st.p.animate(dt, ox / Math.max(dt, 1e-3) * U, oy / Math.max(dt, 1e-3) * U);
      st.cone.userData.set(conePts(q, q.dir, MG.STEALTH.guardFov, MG.STEALTH.guardRange + L.diff * 0.2)); st.cone.material.color.set(s.who === 1 ? '#ff4b3a' : '#ffd54a'); });
    L.cams.forEach((c, i) => { const a = MG.camAt(c, tt); cams[i].g.rotation.y = -a + Math.PI / 2; cams[i].cone.userData.set(conePts(c, a, MG.STEALTH.camFov, MG.STEALTH.camRange)); cams[i].cone.material.color.set(s.who === 2 ? '#ff4b3a' : '#ffd54a'); cams[i].led.visible = (now / 400 | 0) % 2 === 0; });
    ring.visible = !s.grabbed && s.grab > 0; if (ring.visible) { ring.geometry.dispose(); ring.geometry = new THREE.RingGeometry(0.42, 0.55, 32, 1, Math.PI / 2, -Math.PI * 2 * s.grab / MG.STEALTH.grab); }
    exitGlow.visible = s.grabbed; if (s.grabbed) exitGlow.scale.setScalar(1 + Math.sin(now / 200) * 0.1);
    (L.lasers || []).forEach((z, k) => { const on = MG.laserOn(z, tt); lasers[k].visible = on; if (on) beamMat.opacity = 0.75 + Math.random() * 0.25; });
    items.forEach((g, k) => { const got = (s.items || 0) & (1 << k); g.userData.gem.visible = !got; g.userData.halo.visible = !got; g.userData.gem.rotation.y = now / 500; g.userData.gem.position.y = 1.05 + Math.sin(now / 300 + k) * 0.05;
      if (!got && s.ii === k) g.userData.halo.scale.setScalar(1 + s.ig / MG.STEALTH.itemGrab); else g.userData.halo.scale.setScalar(1); });
    if (items.length) { const n = MG.itemCount(s), it2 = `✨ ${n}/${items.length} extras`; if (itemsB.textContent !== it2) itemsB.textContent = it2; }
    if (s.zap > (stealth.zap || 0)) { buzz(250); root.classList.add('siren'); setTimeout(() => root.classList.remove('siren'), 600); feedback('large', { view, root, sound: 'zap', color: '255,40,40' }); } stealth.zap = s.zap;
    if (s.grabbed && !lastGrab) { lastGrab = true; buzz([20, 30, 20]); feedback('medium', { view, root, sound: 'coin', text: '💰 Till emptied!', at: screenOf(view, px * U, 2, py * U), kind: 'gold', color: '255,214,90', flash: 0.12 }); bump(goal); }
    seen.set(s.seen); seen.classList.toggle('hot', alarm); clock.textContent = `${Math.max(0, Math.ceil(L.limit - s.t))}s`;
    const gtxt = s.grabbed ? '🚪 Out the back door!' : s.grab > 0 ? '💰 Emptying the till… stay close' : '💰 Get to the till'; if (goal.textContent !== gtxt) goal.textContent = gtxt;
    if (s.done && !ended) { ended = true; if (s.done === 'spotted') { buzz(400); feedback('large', { view, root, sound: 'alarm', color: '255,40,40' }); } setTimeout(() => finish({ path }), s.done === 'spotted' ? 900 : 400); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); view.dispose(); ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); };
}
function stealth2d(root, L, finish) {
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
    for (const z of L.lasers || []) if (MG.laserOn(z, tt)) { const a2 = P(z.x0, z.y0, 0.3), b2 = P(z.x1, z.y1, 0.3); g.strokeStyle = '#ff2a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(a2.x, a2.y); g.lineTo(b2.x, b2.y); g.stroke(); }
    (L.items || []).forEach((it, k) => { if ((s.items || 0) & (1 << k)) return; const q = P(it.x, it.y, 0.6); g.font = `${tw * 0.4}px system-ui`; g.textAlign = 'center'; g.fillText(MG.ITEMS[it.k].icon, q.x, q.y); });
    // the till's progress ring
    if (!s.grabbed && s.grab > 0) { const q = P(L.till.x, L.till.y, 1.2); g.strokeStyle = '#7CFFB2'; g.lineWidth = 4; g.beginPath(); g.arc(q.x, q.y, tw * 0.3, -Math.PI / 2, -Math.PI / 2 + s.grab / MG.STEALTH.grab * Math.PI * 2); g.stroke(); }
    const who = [...L.guards.map(gd => { const q = MG.guardAt(gd, tt); return { x: q.x, y: q.y, k: gd.kind }; }), { x: px, y: py, k: 'me' }].sort((a, b) => a.x + a.y - b.x - b.y);
    for (const o of who) { if (o.k === 'me') person(o.x, o.y, '#2E3440', '#C68B59', (p, sz) => { g.fillStyle = '#111'; g.fillRect(p.x - sz * 0.36, p.y - sz * 2.05, sz * 0.72, sz * 0.18); if (s.grabbed) { g.fillStyle = '#E2B13C'; g.beginPath(); g.arc(p.x + sz * 0.55, p.y - sz * 1.1, sz * 0.3, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#2B2621'; g.font = `800 ${sz * 0.4}px system-ui`; g.textAlign = 'center'; g.fillText('$', p.x + sz * 0.55, p.y - sz * 0.97); } });
      else person(o.x, o.y, o.k === 'guard' ? '#2F4A7A' : '#F4F1E8', '#7A4E2D', (p, sz) => { if (o.k === 'keeper') { g.fillStyle = '#C8473D'; g.fillRect(p.x - sz * 0.42, p.y - sz * 1.3, sz * 0.84, sz * 0.5); } else { g.fillStyle = '#1E2A44'; g.fillRect(p.x - sz * 0.38, p.y - sz * 2.4, sz * 0.76, sz * 0.22); } }); }
    for (const c of L.cams) { const q = P(c.x, c.y, 1.3); g.fillStyle = '#3A3A44'; g.fillRect(q.x - 6, q.y - 4, 12, 8); g.fillStyle = (performance.now() / 400 | 0) % 2 ? '#FF4B3A' : '#7A1E18'; g.beginPath(); g.arc(q.x + 4, q.y - 1, 2, 0, 7); g.fill(); }
    seen.set(s.seen); seen.classList.toggle('hot', s.who > 0); clock.textContent = `${Math.max(0, Math.ceil(L.limit - s.t))}s`;
    const gtxt = s.grabbed ? '🚪 Out the back door!' : s.grab > 0 ? '💰 Emptying the till… stay close' : '💰 Get to the till'; if (goal.textContent !== gtxt) goal.textContent = gtxt;
    if (s.grabbed && !lastSeen) { lastSeen = 1; buzz([20, 30, 20]); sfx('coin'); bump(goal); }
    if (s.done && !ended) { ended = true; ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); if (s.done === 'spotted') { buzz(400); feedback('large', { root, sound: 'alarm', color: '255,40,40' }); } setTimeout(() => finish({ path }), s.done === 'spotted' ? 900 : 400); }
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
    if (st.ok) { done = true; setTimeout(() => finish({ picks }), 700); bubble.textContent = st.money ? 'Deal! I\'ll take it. 🤑' : 'Hmm… no thanks. I\'m off.'; face.textContent = st.money ? '🤩' : '😠'; bump(face); sfx(st.money ? 'coin' : 'wrong'); opts.innerHTML = ''; return; }
    const R0 = L.rounds[picks.length], M = MG.MOODS[R0.mood]; face.textContent = M.face; bubble.textContent = M.say[R0.say]; turnLab.textContent = `Turn ${picks.length + 1} of ${L.rounds.length} · they seem ${M.name.toLowerCase()}`;
    opts.innerHTML = ''; R0.options.forEach((o, i) => opts.append($c('button', { class: 'mgopt', onclick: () => aim(i) }, $c('b', { text: MG.TAGS[o.tag].name }), $c('span', { text: MG.TAGS[o.tag].lines[o.line] })))); };
  // the timing bar for the chosen line: tap "Say it" with the marker in the green
  const aim = i => { opts.innerHTML = ''; const zoneW = L.zone, bar = $c('div', { class: 'mgtime' }), zone = $c('i', { class: 'z', style: `left:${(0.5 - zoneW / 2) * 100}%;width:${zoneW * 100}%` }), mk = $c('i', { class: 'm' }); bar.append(zone, mk);
    let pos = 0, dir = 1, on = true; const sp = 0.9 + L.diff * 0.18; let last = performance.now();
    const step = now => { if (!on) return; const dt = (now - last) / 1000; last = now; pos += dir * sp * dt; if (pos > 1) { pos = 1; dir = -1; } if (pos < 0) { pos = 0; dir = 1; } mk.style.left = (pos * 100) + '%'; requestAnimationFrame(step); }; requestAnimationFrame(step);
    const say = () => { if (!on) return; on = false; const off = Math.abs(pos - 0.5), tm = Math.max(0, 1 - Math.max(0, off - zoneW / 2) / 0.35) * (off <= zoneW / 2 ? 1 : 0.7); picks.push({ o: i, t: +tm.toFixed(3) }); buzz(tm > 0.9 ? 25 : 10); sfx(tm > 0.9 ? 'ok' : tm > 0.5 ? 'tick' : 'wrong'); if (tm <= 0.5) shake(root, 0.25); show(); bump(face); };
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
  board.append(left, svg, right); const linked = new Map(); // wire → the symbol it's plugged into (the plug moves with its socket)
  let lit = 0, ep = 0; const fuseM = L.fuse ? meter('fuse', '🧨') : null; if (fuseM) root.querySelector('.mghud').insertBefore(fuseM, clock);
  const symAt = (k, t) => MG.socketsAt(L, t)[k], sockOf = sym => MG.socketsAt(L, now()).indexOf(sym);
  const wires = L.wires.map((c, i) => { const b = $c('button', { class: 'mgwire', style: `--c:${MG.WIRE_COLS[c]}`, 'aria-label': MG.WIRE_NAMES[c] + ' wire', onclick: () => { if (stage !== 'wires' || linked.has(i)) return; sel = i; wires.forEach((w, k) => w.classList.toggle('on', k === i)); } }); left.append(b); return b; });
  const socks = L.sockets.map((sym0, k) => { const b = $c('button', { class: 'mgsock', text: MG.SYMBOLS[sym0], onclick: () => { if (stage !== 'wires' || sel == null) return; const w = sel, t = now(), sym = symAt(k, t); sel = null; wires.forEach(x => x.classList.remove('on')); events.push(['w', w, k, t]);
      if (L.card[w].sym === sym) { linked.set(w, sym); lit = t; wires[w].classList.add('done'); b.classList.add('done'); draw(); buzz(15); sfx('ok'); bump(b); if (linked.size === L.wires.length) setTimeout(startPin, 400); }
      else { pen += L.wrongWire; b.classList.add('spark'); setTimeout(() => b.classList.remove('spark'), 400); buzz(120); feedback('medium', { root, sound: 'zap', color: '255,60,40' }); } } }); right.append(b); return b; });
  const draw = () => { const r0 = board.getBoundingClientRect(); svg.innerHTML = ''; for (const [w, sym] of linked) { const k = sockOf(sym); if (k < 0) continue; const a = wires[w].getBoundingClientRect(), b = socks[k].getBoundingClientRect(), x1 = a.right - r0.left, y1 = a.top + a.height / 2 - r0.top, x2 = b.left - r0.left, y2 = b.top + b.height / 2 - r0.top;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`); p.setAttribute('stroke', MG.WIRE_COLS[L.wires[w]]); p.setAttribute('stroke-width', '5'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); svg.append(p); } };
  const status = $c('p', { class: 'mghint', text: L.hard ? 'Hard: the sockets swap places every few seconds, and the fuse 🧨 burns between moves. Each right move relights it.' : 'Tap a wire, then the socket with its symbol.' });
  wrap.append(card, board, status);
  // the keypad: watch the code flash, then tap it back
  let at = 0, showing = false; const pad = $c('div', { class: 'mgpad' }), keys = [];
  for (let d = 1; d <= 9; d++) { const b = $c('button', { class: 'mgkey', text: String(d), onclick: () => press(d) }); keys.push(b); pad.append(b); }
  const flash = (d, ms) => { const b = keys[d - 1]; b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), ms); if (ms > 150) sfx('tick'); };
  const playCode = () => { showing = true; status.textContent = '👀 Watch the code…'; const gap = Math.max(260, 520 - L.diff * 45); L.pin.forEach((d, i) => setTimeout(() => flash(d, gap * 0.7), 400 + i * gap)); setTimeout(() => { showing = false; status.textContent = 'Now tap it back.'; }, 400 + L.pin.length * gap); };
  const startPin = () => { lit = lit + 0.4 + MG.atmCodeTime(L); stage = 'pin'; /* the fuse waits while the code flashes (same as the server's count) */ wrap.innerHTML = ''; wrap.append($c('div', { class: 'mgscreen', text: 'ENTER SERVICE CODE' }), pad, status); playCode(); };
  const press = d => { if (stage !== 'pin' || showing || done) return; events.push(['k', d, now()]); flash(d, 150);
    if (d === L.pin[at]) { at++; lit = now(); buzz(10); sfx('click'); if (at === L.pin.length) { stage = 'open'; status.textContent = '💸 Cash coming out!'; sfx('coin'); bump(status); end(); } }
    else { at = 0; pen += L.wrongKey; feedback('medium', { root, sound: 'wrong', color: '255,60,40' }); lit = Math.max(lit, now() + 0.5 + MG.atmCodeTime(L)); buzz(150); pad.classList.add('shake'); setTimeout(() => pad.classList.remove('shake'), 350); setTimeout(playCode, 500); } };
  const end = () => { if (done) return; done = true; setTimeout(() => finish({ events, time: now() }), 700); };
  addEventListener('resize', draw);
  loop(root, () => { const t = (performance.now() - t0) / 1000, a = pen + t / L.limit; alarm.set(a); alarm.classList.toggle('hot', a > 0.7); clock.textContent = `${Math.max(0, Math.ceil(L.limit - t))}s`;
    // hard mode: the sockets swap round, and the fuse burns down between right moves
    if (L.shift && stage === 'wires') { const e2 = Math.floor(t / L.shift); if (e2 !== ep) { ep = e2; const sk = MG.socketsAt(L, t); socks.forEach((b, k) => { b.textContent = MG.SYMBOLS[sk[k]]; b.classList.toggle('done', [...linked.values()].includes(sk[k])); b.classList.add('spark'); setTimeout(() => b.classList.remove('spark'), 250); }); draw(); buzz(30); sfx('whoosh'); } }
    let burnt = false; if (fuseM && stage !== 'open') { const left = 1 - (t - lit) / L.fuse; fuseM.set(left); fuseM.classList.toggle('hot', left < 0.35); burnt = left <= 0; }
    if (!done && (a >= 1 || burnt)) { stage = 'alarm'; status.textContent = burnt ? '🧨 The fuse burnt down: alarm!' : '🚨 The alarm went off!'; root.classList.add('siren'); buzz(500); feedback('large', { root, sound: 'alarm', color: '255,40,40' }); end(); } });
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
let W3 = null; const load3d = () => W3 || (W3 = import('/world3d.js'));
async function drive(root, L, finish) {
  const loading = $c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Warming up the engine…' })); root.append(loading);
  let W; try { W = await load3d(); } catch (e) { loading.remove(); return drive2d(root, L, finish); }
  loading.remove(); if (!root.isConnected) return;
  const cv = $c('canvas', { class: 'mgcanvas' }), dmg = meter('alarm', '💥'), prog = meter('trust', '🏁'), clock = $c('b', { class: 'mgclock' }), speedo = $c('div', { class: 'speedo' });
  root.append(cv, hud(prog, dmg, clock), speedo, $c('div', { class: 'mgjoyhint', text: 'Tap left or right to change lane' }));
  const view = W.createView(cv), THREE = W.THREE, S2 = 2; // one unit of the game's road is 2 metres
  view.resize(); W.buildRoadTrip(view, { length: L.D * S2, seed: L.seed, types: X.townTypes ? X.townTypes() : [] }); view.setTime(X.minute ? X.minute() : 720);
  const ro = new ResizeObserver(() => view.resize()); ro.observe(root);
  const laneX = l => (l - 1) * W.LANE;
  // the getaway car, the traffic, and the police on your tail
  const car = W.makeCar('getaway', '#c8382e'); view.scene.add(car);
  const cop = W.makeCar('police'); view.scene.add(cop);
  const COLS = ['#2f5d9e', '#3c8a5a', '#e9e4d8', '#2b2f33', '#e2b13c', '#8e44ad', '#c0392b'];
  const obs = L.obs.map((o, j) => { const m = o.k === 'cones' ? W.makeCones() : W.makeCar(o.k === 'police' ? 'police' : o.k === 'bus' ? 'bus' : o.k === 'van' ? 'van' : 'car', COLS[j % COLS.length]); m.position.set(laneX(o.lane), 0, -o.d * S2); m.visible = false; view.scene.add(m); return m; });
  let head = null; if (view.night > 0.3) { head = new THREE.SpotLight('#fff3d6', 120, 70, 0.45, 0.4, 1.2); view.scene.add(head, head.target); }
  const s = MG.driveStart(), moves = []; let prevD = 0, acc = 0, want = 1, carX = laneX(1), ended = false, shake = 0, lastCr = 0, tilt = 0, flash = 0;
  const steer = dir => { if (ended) return; const w0 = want; want = Math.max(0, Math.min(2, want + dir)); if (want !== w0) sfx('whoosh'); };
  let sx = null; cv.addEventListener('pointerdown', e => { sx = e.clientX; }); cv.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx; steer(Math.abs(dx) > 30 ? Math.sign(dx) : e.clientX < root.clientWidth / 2 ? -1 : 1); sx = null; });
  keyHook(root, e => { if (e.key === 'ArrowLeft' || e.key === 'a') steer(-1); else if (e.key === 'ArrowRight' || e.key === 'd') steer(1); else return false; });
  const cam = new THREE.Vector3(carX, 4.5, 9);
  view.start((dt, now) => {
    if (!ended) { acc += dt; while (acc >= MG.STEP && !s.done) { acc -= MG.STEP; prevD = s.d; let lane = s.lane; if (want !== s.lane) { lane = s.lane + Math.sign(want - s.lane); moves.push([s.n, lane]); } MG.driveStep(L, s, lane); } }
    if (s.crashes > lastCr) { lastCr = s.crashes; flash = 0.35; buzz(200); feedback('large', { view, sound: 'crash' }); }
    const u = s.done ? 1 : Math.min(1, acc / MG.STEP), d = prevD + (s.d - prevD) * u, z = -d * S2;
    const tx = laneX(s.lane), dx = tx - carX; carX += dx * Math.min(1, dt * 9); tilt += ((-dx * 0.08) - tilt) * Math.min(1, dt * 10);
    car.position.set(carX, 0, z); car.rotation.y = -dx * 0.06; car.rotation.z = tilt;
    const speed = (L.v0 + (L.v1 - L.v0) * Math.min(1, s.d / L.D)) * s.slow * S2; for (const w of car.userData.wheels) w.rotation.x -= speed * dt / 0.42;
    // the police keep up behind you, closer after every crash
    const back = 14 - s.crashes * 2.6 + Math.sin(now / 900) * 1.2; cop.position.set(carX * 0.6 + Math.sin(now / 700) * 0.8, 0, z + back);
    const on = (now / 160 | 0) % 2; cop.userData.bar[0].material.color.set(on ? '#ff2a2a' : '#4a0000'); cop.userData.bar[1].material.color.set(on ? '#001040' : '#2a5bff');
    for (let j = 0; j < obs.length; j++) { const oz = -L.obs[j].d * S2; obs[j].visible = !s.gone.includes(j) && oz < z + 20 && oz > z - 260; if (L.obs[j].k === 'police' && obs[j].visible) { obs[j].userData.bar[0].material.color.set(on ? '#ff2a2a' : '#4a0000'); } }
    // the chase camera: low behind the car, pulling back and widening as you speed up, shaking when you hit something
    cam.lerp(new THREE.Vector3(carX * 0.85, 4.2, z + 9.5 + speed * 0.05), Math.min(1, dt * 6)); view.camera.position.copy(cam); view.camera.lookAt(carX * 0.9, 1.2, z - 18);
    const fov = 58 + speed * 0.25; if (Math.abs(view.camera.fov - fov) > 0.2) { view.camera.fov += (fov - view.camera.fov) * Math.min(1, dt * 3); view.camera.updateProjectionMatrix(); }
    view.cut.R.value = 0; view.center.set(0, 0, z - 40); if ((now / 500 | 0) !== (view._sh || 0)) { view._sh = now / 500 | 0; view.setTime(X.minute ? X.minute() : 720); }
    if (head) { head.position.set(carX, 1.2, z - 2); head.target.position.set(carX, 0, z - 30); }
    if (flash > 0) { flash -= dt; root.style.boxShadow = `inset 0 0 0 ${Math.round(flash * 60)}px rgba(255,60,40,.5)`; } else if (root.style.boxShadow) root.style.boxShadow = '';
    prog.set(d / L.D); dmg.set(s.crashes / MG.DRIVE.wreck); dmg.classList.toggle('hot', s.crashes >= MG.DRIVE.wreck - 1); clock.textContent = `${Math.max(0, Math.ceil(L.limit - s.t))}s`;
    speedo.textContent = `${Math.round(speed * 3.6)} km/h`;
    if (s.done && !ended) { ended = true; if (s.done !== 'escaped') feedback('large', { view, sound: 'alarm' }); setTimeout(() => finish({ moves }), s.done === 'escaped' ? 600 : 1000); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); view.dispose(); ro.disconnect(); };
}
// The flat version, if a phone can't do 3D.
function drive2d(root, L, finish) {
  const C = canvasFor(root), dmg = meter('alarm', '💥'), prog = meter('trust', '🏁'), clock = $c('b', { class: 'mgclock' });
  root.append(hud(prog, dmg, clock), $c('div', { class: 'mgjoyhint', text: 'Tap left or right to change lane' }));
  const s = MG.driveStart(), moves = []; let prevD = 0, acc = 0, want = 1, carX = 1, ended = false, shake = 0, lastCr = 0;
  const steer = dir => { if (ended) return; const w0 = want; want = Math.max(0, Math.min(2, want + dir)); if (want !== w0) sfx('whoosh'); };
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
    if (s.crashes > lastCr) { lastCr = s.crashes; shake = 0.35; buzz(200); sfx('crash'); }
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
  const taps = [], t0 = performance.now(); let st = { stage: 'dial', got: 0, noise: 0 }, from = 0, flash = 0, flashCol = '', ended = false, lastNum = -1;
  const now = () => +((performance.now() - t0) / 1000).toFixed(2);
  const tap = () => { if (ended) return; const t = now(); taps.push(t); const r = MG.safeReplay(L, taps, t); if (!r.ok) return; const was = st.got; st = { ...r.state, stage: r.state.stage === 'gaveup' ? 'dial' : r.state.stage }; // mid-game the dial is still turning (the check calls an unfinished game 'given up')
    if (st.got > was) { from = t; flash = 0.4; flashCol = '60,196,106'; buzz(30); sfx(st.stage === 'open' ? 'coin' : 'ok'); bump(info); } else { flash = 0.4; flashCol = '255,75,58'; buzz(120); feedback('medium', { root, sound: 'wrong' }); } };
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
    const pa = st.stage === 'dial' ? MG.safeAngle(N, t - from) - Math.PI / 2 : -Math.PI / 2, nn = num(pa + Math.PI / 2); if (st.stage === 'dial' && nn !== lastNum) { lastNum = nn; if (nn % 5 === 0) sfx('click'); } // the dial clicks past each number
    g.strokeStyle = '#C8473D'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(pa) * R0 * 0.92, cy + Math.sin(pa) * R0 * 0.92); g.stroke(); g.lineCap = 'butt';
    g.fillStyle = '#2B2621'; g.beginPath(); g.arc(cx, cy, R0 * 0.16, 0, 7); g.fill();
    // the locked numbers
    const n = L.nums.length, bw = Math.min(46, (W - 40) / n - 6); for (let i = 0; i < n; i++) { const x = cx + (i - (n - 1) / 2) * (bw + 6), y = cy + R0 * 1.25 + 30; g.fillStyle = i < st.got ? '#3CC46A' : i === st.got ? '#F2C94C' : '#3A332B'; rr(g, x - bw / 2, y, bw, 34, 8); g.fill(); g.fillStyle = '#2B2621';
      g.font = `800 15px system-ui`; g.fillText(i < st.got ? String(num(L.nums[i].a)) : i === st.got ? '?' : '·', x, y + 17); }
    if (flash > 0) { flash -= dt; g.fillStyle = `rgba(${flashCol},${Math.max(0, flash) * 0.6})`; g.fillRect(0, 0, W, H); }
    const msg = st.stage === 'open' ? '🔓 It\'s open!' : `Stop on ${num(N.a)} · number ${st.got + 1} of ${n}`; if (info.textContent !== msg) info.textContent = msg;
    noise.set(st.noise); noise.classList.toggle('hot', st.noise > 0.55); clock.textContent = `${Math.max(0, Math.ceil(L.limit - t))}s`;
    if (!ended && (st.stage === 'open' || st.stage === 'alarm' || t >= L.limit)) { ended = true; C.off(); if (st.stage !== 'open') { root.classList.add('siren'); buzz(500); sfx('alarm'); } setTimeout(() => finish({ taps, time: Math.min(+t.toFixed(2), L.limit) }), 700); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); C.off(); };
}

// ---------------- Spot the police ----------------
const COPS = ['👮', '👮‍♀️', '🕵️', '🕵️‍♀️'], FOLK = ['🧑', '👩', '👨‍🦳', '🧔', '👵', '👷', '🧑‍🍳', '💁', '🧕', '👨‍🦱', '👩‍🦰', '🧑‍🎤'];
function lookout2d(root, L, finish) {
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
    if (ev.through > lastThrough) { lastThrough = ev.through; buzz(250); feedback('medium', { root, sound: 'hurt', color: '255,40,40' }); }
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

// ---------------- Hold off the horde (muscle) ----------------
async function horde(root, L, finish) {
  const loading = $c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'They\'re coming…' })); root.append(loading);
  let W; try { W = await load3d(); } catch (e) { loading.remove(); X.toast('Your phone could not load the 3D view.'); return finish({ path: [[L.start.x, L.start.y], [L.start.x, L.start.y]], acts: '00' }); }
  loading.remove(); if (!root.isConnected) return;
  const cv = $c('canvas', { class: 'mgcanvas' }), hp = meter('trust', '❤️'), clock = $c('b', { class: 'mgclock' }), wpn = $c('b', { class: 'acount' }), waveB = $c('div', { class: 'abig' }), stick = $c('div', { class: 'astick' }, $c('i'));
  const fire = $c('button', { class: 'zfire', 'aria-label': 'Fight' }, $c('span', { text: '🏏' })), feed = $c('div', { class: 'afeed' });
  root.append(cv, hud(hp, wpn, clock), feed, waveB, stick, fire);
  const view = W.createView(cv), THREE = W.THREE; view.resize(); W.buildYard(view, L, { types: X.townTypes ? X.townTypes() : [] });
  const ro = new ResizeObserver(() => view.resize()); ro.observe(root);
  const me = W.makePerson('muscle' + L.seed, 'civilian'); view.scene.add(me.group);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.9), new THREE.MeshStandardMaterial({ color: '#8a5a33', roughness: 0.6 })); weapon.position.set(0.32, 0.85, 0.35); me.group.add(weapon);
  const flash = new THREE.PointLight('#ffd27a', 0, 9, 2); flash.position.set(0, 1.3, 0.6); me.group.add(flash);
  const horde = W.makeHorde(90); view.scene.add(horde.group); const splats = W.makeSplats(140); view.scene.add(splats.mesh);
  const tracerMat = new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.9 }); const tracers = [];
  const PCOL = { pistol: '#2b2f33', shotgun: '#5a3a2a', rifle: '#3a4a3a', medkit: '#f4f4f0' };
  const pickMeshes = new Map(); const pickMesh = p => { const g = new THREE.Group(); const b = new THREE.Mesh(p.k === 'medkit' ? new THREE.BoxGeometry(0.6, 0.35, 0.45) : new THREE.BoxGeometry(p.k === 'pistol' ? 0.5 : 1.1, 0.16, 0.22), new THREE.MeshStandardMaterial({ color: PCOL[p.k], metalness: p.k === 'medkit' ? 0 : 0.6, roughness: 0.4 })); b.position.y = 0.9; g.add(b);
    if (p.k === 'medkit') { const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.37, 0.1), new THREE.MeshBasicMaterial({ color: '#d62828' })), c2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.37, 0.34), new THREE.MeshBasicMaterial({ color: '#d62828' })); c1.position.y = c2.position.y = 0.9; g.add(c1, c2); }
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 28), new THREE.MeshBasicMaterial({ color: p.k === 'medkit' ? '#7cffb2' : '#ffd54a', side: THREE.DoubleSide, transparent: true, opacity: 0.8 })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.05; g.add(halo);
    const tag = W.nameTag(`${MG.WEAPONS[p.k].icon} ${MG.WEAPONS[p.k].name}`, '#ffe9a8'); tag.position.y = 1.7; tag.scale.set(2, 0.5, 1); g.add(tag); g.position.set(p.x, 0, p.y); view.scene.add(g); return g; };
  // controls: the left thumb moves (a stick appears under it), the red button fights (hold it)
  let joy = null, act = false; const keys = new Set();
  cv.addEventListener('pointerdown', e => { joy = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} stick.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px`; stick.firstChild.style.transform = 'translate(-50%,-50%)'; });
  cv.addEventListener('pointermove', e => { if (!joy || e.pointerId !== joy.id) return; let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const d = Math.hypot(dx, dy); if (d > 55) { dx *= 55 / d; dy *= 55 / d; } joy.dx = dx; joy.dy = dy; stick.firstChild.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`; });
  const up = e => { if (joy && e.pointerId === joy.id) { joy = null; stick.style.display = 'none'; } }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  fire.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); act = true; fire.classList.add('on'); try { fire.setPointerCapture(e.pointerId); } catch (er) {} });
  const off = () => { act = false; fire.classList.remove('on'); }; fire.addEventListener('pointerup', off); fire.addEventListener('pointercancel', off); fire.addEventListener('lostpointercapture', off);
  const kd = e => { keys.add(e.key); if (e.key === ' ') { act = true; e.preventDefault(); } if (e.key.startsWith('Arrow')) e.preventDefault(); }, ku = e => { keys.delete(e.key); if (e.key === ' ') act = false; }; addEventListener('keydown', kd); addEventListener('keyup', ku);
  const yaw = Math.PI / 4;
  const input = () => { let sx = 0, sy = 0; if (joy && Math.hypot(joy.dx, joy.dy) > 6) { sx = joy.dx / 55; sy = joy.dy / 55; }
    if (keys.has('ArrowUp') || keys.has('w')) sy -= 1; if (keys.has('ArrowDown') || keys.has('s')) sy += 1; if (keys.has('ArrowLeft') || keys.has('a')) sx -= 1; if (keys.has('ArrowRight') || keys.has('d')) sx += 1;
    const c = Math.cos(yaw), sn = Math.sin(yaw); let vx = sx * c + sy * sn, vy = -sx * sn + sy * c; const n = Math.hypot(vx, vy); return n > 1 ? [vx / n, vy / n] : [vx, vy]; };
  // the world moves in fixed steps (the server replays the same steps); the picture is drawn in between
  let s = MG.hordeStart(L), prev = s, acc = 0, ended = false, lastWave = -1, deadAt = new Map(), lastHp = s.hp, lastW = 'bat';
  const path = [[s.x, s.y]]; let acts = '0';
  const look = new THREE.Vector3(s.x, 0, s.y); const camDist = 15, camH = 19;
  view.start((dt, now) => {
    if (!ended) { acc += dt; while (acc >= MG.STEP && !s.done) { acc -= MG.STEP; prev = s; const [vx, vy] = input(), q = MG.hordeMove(L, s, vx, vy); s = MG.hordeStep(L, s, q.x, q.y, act); path.push([q.x, q.y]); acts += act ? '1' : '0';
        for (const sh of s.shots) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(q.x, 1.3, q.y), new THREE.Vector3(sh[0], 1.1, sh[1])]); const ln = new THREE.Line(g, tracerMat); view.scene.add(ln); tracers.push({ ln, t: now }); }
        if (s.shots.length) { flash.intensity = s.w === 'bat' && prev.w === 'bat' ? 0 : 30; buzz(s.w === 'bat' ? 15 : 8); me.body.rotation.y = 0; sfx(s.w === 'bat' ? 'swing' : s.w === 'shotgun' ? 'blast' : 'shot'); if (s.w === 'shotgun') shake(view, 0.14); }
        if (s.kills > prev.kills) { sfx('splat'); shake(view, 0.06 * (s.kills - prev.kills)); }
        if (s.hp > prev.hp + 0.5) feedback('medium', { view, root, sound: 'heal', text: '+❤️ Patched up', at: screenOf(view, q.x, 2.2, q.y), kind: 'good', color: '80,220,120', flash: 0.1, shake: false });
        if (s.w !== prev.w && s.w !== 'bat') feedback('small', { view, root, sound: 'pickup', text: `${MG.WEAPONS[s.w].icon} ${MG.WEAPONS[s.w].name}!`, at: screenOf(view, q.x, 2.2, q.y), kind: 'gold' }); } }
    const u = s.done ? 1 : Math.min(1, acc / MG.STEP), px = prev.x + (s.x - prev.x) * u, py = prev.y + (s.y - prev.y) * u;
    me.setPos(px, py); me.animate(dt, (s.x - prev.x) / MG.STEP, (s.y - prev.y) / MG.STEP); if (Math.hypot(s.x - prev.x, s.y - prev.y) < 0.01) me.group.rotation.y = Math.atan2(s.fx, s.fy);
    flash.intensity *= 0.6;
    // the zombies, in between their steps
    const pz = new Map(prev.z.map(z => [z.id, z])), list = [];
    for (const z of s.z) { const a = pz.get(z.id) || z, x = a.x + (z.x - a.x) * u, y = a.y + (z.y - a.y) * u;
      if (z.dead && !deadAt.has(z.id)) { deadAt.set(z.id, now); splats.add(x, y, 1.2); }
      list.push({ id: z.id, x, z: y, heading: Math.atan2(s.x - x, s.y - y), speed: z.dead ? 0 : z.sp, hurt: z.hurt, dead: z.dead ? Math.min(1, (now - (deadAt.get(z.id) || now)) / 300) : 0 }); }
    for (const [id, t0] of deadAt) if (now - t0 < 900 && !s.z.some(z => z.id === id)) { /* fallen, already gone */ }
    horde.update(list, dt, now);
    // things on the ground
    const seenP = new Set(); for (const p of s.picks) { const key = p.t + ':' + p.k; seenP.add(key); if (!pickMeshes.has(key)) pickMeshes.set(key, pickMesh(p)); const g = pickMeshes.get(key); g.children[0].rotation.y = now / 400; g.children[0].position.y = 0.9 + Math.sin(now / 250) * 0.1; }
    for (const [k, g] of pickMeshes) if (!seenP.has(k)) { view.scene.remove(g); pickMeshes.delete(k); }
    for (let i = tracers.length - 1; i >= 0; i--) if (now - tracers[i].t > 70) { view.scene.remove(tracers[i].ln); tracers[i].ln.geometry.dispose(); tracers.splice(i, 1); }
    view.animateYard && view.animateYard(now);
    // the camera follows from above and behind, and shakes when you get bitten
    look.lerp(new THREE.Vector3(px, 0, py), Math.min(1, dt * 7)); 
    view.camera.position.set(look.x + Math.sin(yaw) * camDist, camH, look.z + Math.cos(yaw) * camDist); view.camera.lookAt(look.x, 1, look.z); view.cut.A.value.set(px, 1, py); view.cut.B.value.copy(view.camera.position); view.cut.R.value = 7;
    // the HUD
    hp.set(s.hp / MG.HORDE.hp); hp.classList.toggle('hot', s.hp < 35); if (s.hp < lastHp - 0.5) { root.classList.add('hurt'); setTimeout(() => root.classList.remove('hurt'), 120); feedback('medium', { view, sound: 'hurt', shakeBy: Math.min(0.4, 0.12 + (lastHp - s.hp) * 0.02) }); } lastHp = s.hp;
    const W0 = MG.WEAPONS[s.w], wt = `${W0.icon} ${W0.name}${s.ammo !== Infinity ? ` · ${s.ammo}` : ''} · 🧟 ${s.kills}`; if (wpn.textContent !== wt) wpn.textContent = wt;
    if (s.w !== lastW) { fire.firstChild.textContent = W0.icon; weapon.scale.set(s.w === 'bat' ? 1 : 1.2, s.w === 'bat' ? 1 : 1.6, s.w === 'pistol' ? 0.45 : s.w === 'bat' ? 1 : 1.1); weapon.material.color.set(s.w === 'bat' ? '#8a5a33' : '#2b2f33'); if (s.w !== 'bat') say2(feed, `Picked up a ${W0.name.toLowerCase()}!`); lastW = s.w; }
    clock.textContent = `${Math.max(0, Math.ceil(L.limit - s.t))}s`;
    const wave = Math.floor(s.t / 9); if (wave !== lastWave) { lastWave = wave; waveB.textContent = wave ? `Wave ${wave + 1}` : 'Hold them off!'; waveB.hidden = false; setTimeout(() => { waveB.hidden = true; }, 1600); bump(waveB); if (wave) { buzz([40, 40, 40]); feedback('medium', { view, sound: 'wave' }); } }
    if (s.done && !ended) { ended = true; off(); if (s.done === 'down') { root.classList.add('siren'); buzz(500); feedback('large', { view, root, sound: 'lose', color: '255,30,30' }); waveB.textContent = 'You went down!'; waveB.hidden = false; } else { waveB.textContent = 'You held them off!'; waveB.hidden = false; }
      setTimeout(() => finish({ path, acts }), 1200); }
  });
  const stop = root._stop; root._stop = () => { stop && stop(); view.dispose(); ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); };
}
function say2(feed, text) { const line = $c('div', { class: 'aline', text }); feed.prepend(line); setTimeout(() => line.remove(), 2500); while (feed.children.length > 3) feed.lastChild.remove(); }

// ---------------- Spot the police (lookout), in 3D ----------------
// The yard behind the job, at dusk: people keep stepping out of six doorways and alleys and looking about. Tap the
// police (uniforms, or plain clothes and dark glasses) before they slip away. The same rules as ever decide the score.
async function lookout(root, L, finish) {
  const loading = $c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Taking up position…' })); root.append(loading);
  let W; try { W = await load3d(); } catch (e) { loading.remove(); return lookout2d(root, L, finish); }
  loading.remove(); if (!root.isConnected) return;
  const cv = $c('canvas', { class: 'mgcanvas' }), heat = meter('alarm', '🔥'), clock = $c('b', { class: 'mgclock' }), score = $c('div', { class: 'mggoal', text: '👮 0 spotted' });
  root.append(cv, hud(heat, clock), score, $c('div', { class: 'mgjoyhint', text: 'Tap the police' }));
  const view = W.createView(cv), THREE = W.THREE, yard = MG.genHorde(L.seed, 1); view.resize(); W.buildYard(view, yard, { types: X.townTypes ? X.townTypes() : [], skip: ['W'], fogFar: 160 });
  const ro = new ResizeObserver(() => { view.resize(); frame(); }); ro.observe(root);
  // six doorways: three on the far side of the yard, three on the near side
  const spots = [[7, 0.6], [17, 0.6], [27, 0.6], [7, yard.H - 0.6], [17, yard.H - 0.6], [27, yard.H - 0.6]].map(([x, z], i) => ({ x, z, out: i < 3 ? 1 : -1 }));
  for (const sp of spots) { const d = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.8, 0.3), new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.9 })); d.position.set(sp.x, 1.4, sp.z - sp.out * 0.4); view.scene.add(d);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: '#ffd38a' })); lamp.position.set(sp.x, 3.1, sp.z); view.scene.add(lamp); }
  // the camera looks across the yard from the open side, so all six doorways are in view (the long way up a tall screen)
  const frame = () => { const asp = view.camera.aspect, tall = asp < 1, span = (tall ? yard.H : yard.W) + 6, hf = Math.atan(Math.tan(view.camera.fov * Math.PI / 360) * asp), dist = Math.max((span / 2) / Math.tan(hf) * 0.9, 18);
    if (tall) view.camera.position.set(yard.W / 2 + dist * 0.5, dist * 0.85, yard.H / 2); else view.camera.position.set(yard.W / 2, dist * 0.85, yard.H / 2 + dist * 0.5); view.camera.lookAt(yard.W / 2, 0, yard.H / 2); };
  view.camera.fov = 50; view.camera.updateProjectionMatrix(); frame();
  // the people: built as they step out
  const people = new Map(), mark = new Map(), taps = [], t0 = performance.now(); let ended = false, ev = { heat: 0, hits: 0 };
  const COPS = ['hunter', 'detective'];
  const personFor = (p, j) => { const role = p.cop ? (p.look % 2 ? 'hunter' : 'civilian') : 'civilian', P = W.makePerson((p.cop ? 'cop' : 'folk') + j + L.seed, role);
    if (p.cop && role === 'civilian') { for (const c of P.body.children) if (c.material && c.position.y > 1.0 && c.position.y < 1.5 && c.scale.x > 0.4) c.material = new THREE.MeshStandardMaterial({ color: '#22262c' }); const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), new THREE.MeshBasicMaterial({ color: '#000' })); glasses.position.set(0, 1.76, 0.17); P.body.add(glasses); }
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.05; P.group.add(halo);
    view.scene.add(P.group); return P; };
  // tapping: the person nearest your finger (on screen) is the one you mean
  const v = new THREE.Vector3();
  cv.addEventListener('pointerdown', e => { if (ended) return; const t = +((performance.now() - t0) / 1000).toFixed(2), rect = cv.getBoundingClientRect(); let best = -1, bd = 70;
    for (const [j, P] of people) { v.set(P.x, 1.2, P.z).project(view.camera); const sx = (v.x + 1) / 2 * rect.width + rect.left, sy = (1 - v.y) / 2 * rect.height + rect.top, d = Math.hypot(sx - e.clientX, sy - e.clientY); if (d < bd) { bd = d; best = j; } }
    if (best < 0) return; const p = L.pops[best]; taps.push([p.s, t]); mark.set(best, p.cop ? 'hit' : 'wrong'); buzz(p.cop ? 25 : 150);
    if (p.cop) feedback('small', { root, sound: 'ok', text: '👮 Spotted!', at: { x: e.clientX, y: e.clientY - 20 }, kind: 'good', shake: false }); else feedback('medium', { view, root, sound: 'wrong', text: '✗ Not police', at: { x: e.clientX, y: e.clientY - 20 }, kind: 'bad' });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 28), new THREE.MeshBasicMaterial({ color: p.cop ? '#3cc46a' : '#ff4b3a', side: THREE.DoubleSide, transparent: true })); ring.rotation.x = -Math.PI / 2; ring.position.set(people.get(best).x, 0.05, people.get(best).z); view.scene.add(ring); setTimeout(() => view.scene.remove(ring), 600);
    });
  let lastEval = -1;
  view.start((dt, now) => { const t = (performance.now() - t0) / 1000;
    L.pops.forEach((p, j) => { const on = p.t0 <= t && t <= p.t0 + p.dur && mark.get(j) !== 'hit', sp = spots[p.s];
      if (on && !people.has(j)) people.set(j, personFor(p, j));
      if (!on && people.has(j)) { view.scene.remove(people.get(j).group); people.delete(j); return; }
      if (!on) return; const P = people.get(j), k = (t - p.t0) / p.dur, out = Math.min(1, k * 4, (1 - k) * 4) * 3.2, side = Math.sin(t * 0.8 + j) * 0.6;
      const px = sp.x + side, pz = sp.z + sp.out * out, vx = (px - P.x) / Math.max(dt, 1e-3), vz = (pz - P.z) / Math.max(dt, 1e-3); P.setPos(px, pz); P.animate(dt, vx, vz); if (Math.hypot(vx, vz) < 0.3) P.group.rotation.y = sp.out > 0 ? Math.sin(t * 2 + j) * 0.9 : Math.PI + Math.sin(t * 2 + j) * 0.9; });
    view.animateYard && view.animateYard(now);
    if (t - lastEval > 0.1) { lastEval = t; ev = MG.lookEval(L, taps, t) || ev; heat.set(ev.heat); heat.classList.toggle('hot', ev.heat > 0.6); const sc = `👮 ${ev.hits} spotted`; if (score.textContent !== sc) score.textContent = sc; }
    clock.textContent = `${Math.max(0, Math.ceil(L.limit - t))}s`;
    if (!ended && (ev.blown != null || t >= L.limit)) { ended = true; if (ev.blown != null) { root.classList.add('siren'); buzz(500); feedback('large', { view, root, sound: 'alarm', color: '255,40,40' }); } setTimeout(() => finish({ taps, time: Math.min(+t.toFixed(2), L.limit) }), 700); } });
  const stop = root._stop; root._stop = () => { stop && stop(); view.dispose(); ro.disconnect(); };
}
