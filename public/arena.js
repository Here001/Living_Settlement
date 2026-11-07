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

export function openArena(mode, ctx) {
  X = ctx; closeArena(true);
  const root = $c('div', { class: 'mg arena', role: 'dialog', 'aria-label': MODES[mode].name }); document.body.append(root); document.body.classList.add('mg-on');
  S = { root, mode, phase: 'lobby', match: null };
  lobby({ k: 'lobby', mode, players: [], startsIn: A.lobby * 1000 });
  X.send({ a: 'join', mode }); load3d().catch(() => {}); // get the 3D engine ready while the lobby fills
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
// The 3D engine loads only when a game starts (the map itself never needs it).
let W3 = null; const load3d = () => W3 || (W3 = import('/world3d.js'));
async function start(m) {
  clearTimeout(S.lobbyT); S.stop && S.stop();
  const root = S.root; root.innerHTML = ''; S.phase = 'play';
  root.append($c('div', { class: 'mgcard' }, $c('p', { class: 'mghint', text: 'Loading the neighbourhood…' })));
  let W; try { W = await load3d(); } catch (e) { X.toast('Your phone could not load the 3D view.'); closeArena(); return; }
  if (!S || S.phase !== 'play') return;
  const L = AR.prepare(m.L), wire = m.L; root.innerHTML = '';
  const skew = m.now - Date.now(), me = { x: m.x ?? L.spawn.x, y: m.y ?? L.spawn.y, role: m.role, vx: 0, vy: 0 }, others = new Map();
  S.match = { id: m.id, mode: m.mode, L, me, others, roster: m.roster, you: m.you, skew, playFrom: m.playFrom, until: m.until, live: Date.now() + skew >= m.playFrom, tl: 0, n: 0, sc: 0, bags: [], feed: [] };
  const cv = $c('canvas', { class: 'mgcanvas' });
  const roleB = $c('div', { class: 'arole' }), clock = $c('b', { class: 'mgclock' }), info = $c('b', { class: 'acount' }), feed = $c('div', { class: 'afeed' }), big = $c('div', { class: 'abig' }), stick = $c('div', { class: 'astick' }, $c('i'));
  let sure = 0; const quit = $c('button', { class: 'mgx aquit', 'aria-label': 'Leave the game', text: '×', onclick: () => { if (Date.now() - sure < 2500) return closeArena(); sure = Date.now(); say('Tap × again to leave. The computer will play for you.'); } });
  root.append(cv, $c('div', { class: 'mghud' }, roleB, info, clock), feed, big, stick, quit, $c('div', { class: 'mgjoyhint', text: 'Drag anywhere to move' }));
  // the world: the real streets, built in 3D, lit for the colony's time of day
  const view = W.createView(cv), THREE = W.THREE; try { window.__arena3d = view; } catch (e) {} view.resize(); W.buildArea(view, wire); view.setTime(X.minute ? X.minute() : 720);
  const ro = new ResizeObserver(() => view.resize()); ro.observe(root);
  // the hiding spots glow while the hiders hide; cash bags spin and bob
  const rings = []; if (m.mode === 'hide') for (const sp of L.spots) { const rg = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.07, 6, 28), new THREE.MeshBasicMaterial({ color: '#7cffb2', transparent: true, opacity: 0.85 })); rg.rotation.x = -Math.PI / 2; rg.position.set(sp.x, 0.08, sp.y); view.scene.add(rg); rings.push(rg); }
  const bagGeo = new THREE.SphereGeometry(0.42, 14, 10), bagMat = new THREE.MeshStandardMaterial({ color: '#e2b13c', roughness: 0.4, metalness: 0.6, emissive: '#5a3a00', emissiveIntensity: 0.4 }); const bags = [];
  // people: you, and everyone else (built when they first show up)
  const mine = W.makePerson(X.me ? X.me() : 'me', me.role); view.scene.add(mine.group); mine.setPos(me.x, me.y);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; mine.group.add(ring);
  // you can always see yourself, even behind a building
  const ghost = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthTest: false })); ghost.position.y = 0.95; ghost.renderOrder = 20; mine.group.add(ghost);
  let torchLight = null; const people = new Map(); S.match.mine = mine;
  const rebuildMe = role => { const p = W.makePerson(X.me ? X.me() : 'me', role); p.setPos(me.x, me.y); p.group.add(ring, ghost); view.scene.remove(mine.group); view.scene.add(p.group); Object.assign(mine, p); };
  // a torch for a seeker at night
  const torchFor = () => { if (torchLight) { view.scene.remove(torchLight); torchLight = null; } if (me.role === AR.chasers(m.mode) && view.night > 0.3) { torchLight = new THREE.SpotLight('#fff1c9', 60, 34, 0.5, 0.5, 1.4); view.scene.add(torchLight, torchLight.target); } };
  torchFor(); let role0 = me.role;
  // the camera: high behind you, turned like the map (so up on the screen is up the map), easing after you
  const camYaw = Math.PI / 4, camDist = 22, camH = 25, look = new THREE.Vector3(me.x, 0, me.y); view.camera.position.set(me.x + Math.sin(camYaw) * camDist, camH, me.y + Math.cos(camYaw) * camDist); view.camera.lookAt(look);
  // moving: a joystick that appears under your thumb, or the arrow keys
  let joy = null; const keys = new Set();
  cv.addEventListener('pointerdown', e => { joy = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} stick.style.cssText = `display:block;left:${e.clientX}px;top:${e.clientY}px`; stick.firstChild.style.transform = 'translate(-50%,-50%)'; });
  cv.addEventListener('pointermove', e => { if (!joy || e.pointerId !== joy.id) return; let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const d = Math.hypot(dx, dy); if (d > 55) { dx *= 55 / d; dy *= 55 / d; } joy.dx = dx; joy.dy = dy; stick.firstChild.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`; });
  const up = () => { joy = null; stick.style.display = 'none'; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const kd = e => { keys.add(e.key); if (e.key.startsWith('Arrow')) e.preventDefault(); }, ku = e => keys.delete(e.key); addEventListener('keydown', kd); addEventListener('keyup', ku);
  const input = () => { let sx = 0, sy = 0; if (joy && Math.hypot(joy.dx, joy.dy) > 6) { sx = joy.dx / 55; sy = joy.dy / 55; }
    if (keys.has('ArrowUp') || keys.has('w')) sy -= 1; if (keys.has('ArrowDown') || keys.has('s')) sy += 1; if (keys.has('ArrowLeft') || keys.has('a')) sx -= 1; if (keys.has('ArrowRight') || keys.has('d')) sx += 1;
    // screen directions to ground directions, given how the camera is turned
    const c = Math.cos(camYaw), s = Math.sin(camYaw); return [sx * c + sy * s, -sx * s + sy * c].map(v => Math.max(-1, Math.min(1, v))); };
  let sentAt = 0, lx = me.x, ly = me.y, tTime = 0;
  view.start((dt, now) => { const M = S && S.match; if (!M) return; const t = Date.now() + M.skew; M.live = t >= M.playFrom;
    const frozen = !M.live && me.role === AR.chasers(M.mode);
    if (me.role !== role0) { role0 = me.role; rebuildMe(me.role); torchFor(); }
    // your own moves happen here straight away; the server checks them with the same rules
    let vx = 0, vy = 0; if (!frozen && !M.auto) { const [ix, iy] = input(), mag = Math.min(1, Math.hypot(ix, iy)); if (mag > 0.05) { const q = AR.moveBy(L, me, ix, iy, A.speed[me.role] * dt * mag); vx = (q.x - me.x) / dt; vy = (q.y - me.y) / dt; me.x = q.x; me.y = q.y; } }
    if (me.fx != null) { const k = Math.min(1, dt * 10); me.x += (me.fx - me.x) * k; me.y += (me.fy - me.y) * k; if (Math.hypot(me.fx - me.x, me.fy - me.y) < 0.05) me.fx = me.fy = null; } // a correction eases in
    mine.setPos(me.x, me.y); mine.animate(dt, vx, vy);
    const hidden = M.mode === 'hide' && me.role === 'hider' && AR.spotAt(L, me); mine.body.visible = !hidden; ghost.material.opacity = hidden ? 0.55 : 0.28;
    if (now - sentAt > 66 && (Math.abs(me.x - lx) > 0.01 || Math.abs(me.y - ly) > 0.01 || now - sentAt > 1000)) { sentAt = now; lx = me.x; ly = me.y; X.send({ a: 'pos', id: M.id, x: +me.x.toFixed(3), y: +me.y.toFixed(3) }); }
    // everyone else, a tenth of a second behind, smoothly
    const back = performance.now() - 110;
    for (const [i, o] of M.others) { let P = people.get(i); const R0 = M.roster[i] || { h: '?' };
      if (!P || P.role !== (o.ch ? AR.chasers(M.mode) : AR.runners(M.mode))) { if (P) view.scene.remove(P.group); P = W.makePerson(R0.h, o.ch ? AR.chasers(M.mode) : AR.runners(M.mode)); const tag = W.nameTag('@' + R0.h, o.ch ? '#ffb3a8' : '#ffffff'); tag.position.y = 2.35; P.group.add(tag); view.scene.add(P.group); people.set(i, P); }
      const b = o.buf; if (!b.length) continue; let x = b[b.length - 1][1], y = b[b.length - 1][2];
      for (let k = b.length - 1; k > 0; k--) if (b[k - 1][0] <= back && back <= b[k][0]) { const u = (back - b[k - 1][0]) / Math.max(1, b[k][0] - b[k - 1][0]); x = b[k - 1][1] + (b[k][1] - b[k - 1][1]) * u; y = b[k - 1][2] + (b[k][2] - b[k - 1][2]) * u; break; }
      const pvx = (x - P.x) / Math.max(dt, 0.001), pvy = (y - P.z) / Math.max(dt, 0.001); P.setPos(x, y); P.animate(dt, pvx, pvy);
      P.group.visible = !(o.gone && performance.now() - o.gone > 300); P.body.visible = !o.hid; }
    for (const [i, P] of people) if (!M.others.has(i)) { view.scene.remove(P.group); people.delete(i); }
    // cash bags
    while (bags.length < M.bags.length) { const b = new THREE.Mesh(bagGeo, bagMat); b.castShadow = false; view.scene.add(b); bags.push(b); }
    bags.forEach((b, k) => { const p = M.bags[k]; b.visible = !!p; if (p) b.position.set(p[0], 0.8 + Math.sin(now / 300 + k) * 0.15, p[1]); b.rotation.y = now / 600; });
    for (const rg of rings) { rg.visible = !M.live && me.role === 'hider'; rg.scale.setScalar(1 + Math.sin(now / 250) * 0.06); }
    // the camera follows (and the torch points where you're going)
    look.lerp(new THREE.Vector3(me.x, 0, me.y), Math.min(1, dt * 6)); view.camera.position.set(look.x + Math.sin(camYaw) * camDist, camH, look.z + Math.cos(camYaw) * camDist); view.camera.lookAt(look.x, 1, look.z); view.cut.A.value.set(me.x, 1.0, me.y); view.cut.B.value.copy(view.camera.position); view.cut.R.value = 9;
    if (torchLight) { const h = mine.group.rotation.y; torchLight.position.set(me.x, 1.6, me.y); torchLight.target.position.set(me.x + Math.sin(h) * 8, 0, me.y + Math.cos(h) * 8); }
    if (frozen) { view.renderer.toneMappingExposure = 0.08; } else if (view.renderer.toneMappingExposure < 0.5) view.setTime(X.minute ? X.minute() : 720);
    if ((tTime += dt) > 30) { tTime = 0; view.setTime(X.minute ? X.minute() : 720); torchFor(); }
    hud(roleB, clock, info, big, M, t); });
  S.ui = { feed }; S.stop = () => { view.dispose(); ro.disconnect(); removeEventListener('keydown', kd); removeEventListener('keyup', ku); };
}
function snap(m) {
  const M = S.match, me = M.me, now = performance.now();
  if (m.role !== me.role) { if (me.role && m.role === AR.chasers(M.mode)) { buzz(300); say(M.mode === 'tag' ? '🚓 You were caught! Now you\'re a hunter.' : '🔦 You were found! Now help seek.'); } me.role = m.role; }
  if (m.fix) { if (Math.hypot(m.fix[0] - me.x, m.fix[1] - me.y) > 6) { me.x = m.fix[0]; me.y = m.fix[1]; } else { me.fx = m.fix[0]; me.fy = m.fix[1]; } }
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
function end(m) {
  S.stop && S.stop(); S.phase = 'end'; const root = S.root; root.innerHTML = ''; buzz(m.won ? [30, 40, 30] : 150);
  const M0 = MODES[m.mode], RU = AR.runners(m.mode);
  const title = m.side === RU ? (m.mode === 'tag' ? 'The civilians held out!' : 'The hiders stayed hidden!') : (m.mode === 'tag' ? 'The hunters caught everyone!' : 'The seekers found everyone!');
  const list = $c('ul', { class: 'mgcrew' }); for (const p of m.players) list.append($c('li', null, $c('span', { text: `${ROLE[p.first].icon} @${p.h}${p.bot ? ' 🤖' : ''}` }), $c('b', { text: [m.winners.includes(p.h) ? '🏆' : '', p.catches ? `${m.mode === 'tag' ? 'caught' : 'found'} ${p.catches}` : '', p.bags ? `💰 ${p.bags}` : ''].filter(Boolean).join(' · ') || '—' })));
  root.append($c('div', { class: 'mgcard res ' + (m.won ? 'good' : 'meh') }, $c('div', { class: 'mgicon', text: m.won ? '🏆' : M0.icon }), $c('h2', { text: m.won ? 'You won!' : title }), m.won ? $c('p', { class: 'mghint', text: title }) : null,
    $c('p', { class: 'mgmoney', text: m.prize ? `+${X.fmt(m.prize)} coins` : m.won ? (m.paid ? `No prize: that's your ${A.paidWins} paid wins for today.` : 'Practice game (play with at least one other person to win coins).') : '' }), list,
    $c('div', { class: 'mgbtns' }, $c('button', { class: 'mgb', text: '▶ Play again', onclick: () => { const mode = m.mode; closeArena(true); openArena(mode, X); } }), $c('button', { class: 'mgb hot', text: 'Back to the map', onclick: () => { closeArena(true); X.done && X.done(); } }))));
}
