// The character creator: every player makes their own character when they join (and players from before, once).
// They start from a mannequin in underwear and choose their body, face, hair, clothes and the things they wear,
// turning the model round to see it. A photo can match their skin, hair and eye colour: the photo is only read on the
// phone, never sent anywhere. Basic clothes and hairstyles are free; the rest show a price and are bought on saving.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as AV from '/shared/avatar.js';
import { buildAvatar } from '/avatar3d.js';
import { pictureMode, blackGuard, guardContext } from '/safe3d.js';

const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
const SLOT_ICON = { top: '👕', bot: '👖', shoe: '👟', out: '🧥', hat: '🧢', eye: '👓', neck: '📿', ear: '💎', wrist: '⌚', bag: '🎒', hair: '💇' };

const CSS = `
.cre{position:fixed;inset:0;z-index:4000;display:flex;flex-direction:column;background:var(--paper,#F6F1E6);color:var(--ink,#2B2621);font-family:inherit}
.cre-top{display:flex;align-items:center;gap:8px;padding:calc(8px + env(safe-area-inset-top)) 12px 8px;border-bottom:1.5px solid var(--soft,#E3DACA)}
.cre-top h2{flex:1;margin:0;font-size:17px}.cre-coins{font-weight:800;font-size:13px;padding:4px 10px;border-radius:999px;background:var(--panel,#FBF8F1);border:1.5px solid var(--soft,#E3DACA)}
.cre-x{border:0;background:none;font-size:22px;line-height:1;color:inherit;padding:4px 6px;cursor:pointer}
.cre-side{flex:1;min-height:0;display:flex;flex-direction:column}
.cre-stage{position:relative;flex:0 0 44%;min-height:200px;background:radial-gradient(ellipse at 50% 30%,#FFFFFF,#DCD6CB);touch-action:none;cursor:grab}
.cre-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.cre-view{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px}.cre-view button{border:1.5px solid #2B2621;background:rgba(255,255,255,.9);border-radius:12px;padding:5px 9px;font-weight:700;font-size:12.5px;color:#2B2621}
.cre-view button.on{background:#2B2621;color:#fff}
.cre-hint{position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:12px;color:#6E655A;pointer-events:none}
.cre-tabs{display:flex;gap:6px;overflow-x:auto;padding:8px 12px;border-bottom:1.5px solid var(--soft,#E3DACA);scrollbar-width:none}.cre-tabs::-webkit-scrollbar{display:none}
.cre-tabs button,.cre-sub button{flex:0 0 auto;border:1.5px solid var(--line,#2B2621);background:var(--panel,#FBF8F1);color:inherit;border-radius:999px;padding:6px 12px;font-weight:700;font-size:13.5px}
.cre-tabs button.on,.cre-sub button.on{background:var(--ink,#2B2621);color:var(--paper,#F6F1E6)}
.cre-panel{flex:1;overflow-y:auto;padding:10px 12px 14px;-webkit-overflow-scrolling:touch}
.cre-panel h4{margin:12px 0 6px;font-size:13px;color:var(--muted,#6E655A);font-weight:700;text-transform:uppercase;letter-spacing:.04em}.cre-panel h4:first-child{margin-top:2px}
.cre-sub{display:flex;gap:6px;overflow-x:auto;margin-bottom:8px;scrollbar-width:none}.cre-sub button{font-size:12.5px;padding:5px 10px}
.cre-chips{display:flex;flex-wrap:wrap;gap:6px}.cre-chips button{border:1.5px solid var(--soft,#E3DACA);background:var(--panel,#FBF8F1);color:inherit;border-radius:12px;padding:7px 11px;font-size:13.5px;font-weight:600}
.cre-chips button.on{border-color:var(--ink,#2B2621);box-shadow:inset 0 0 0 1.5px var(--ink,#2B2621)}
.cre-sw{display:flex;flex-wrap:wrap;gap:8px}.cre-sw button{width:34px;height:34px;border-radius:50%;border:2px solid rgba(0,0,0,.15);padding:0}.cre-sw button.on{box-shadow:0 0 0 2.5px var(--paper,#F6F1E6),0 0 0 4.5px var(--ink,#2B2621)}
.cre-sw label{width:34px;height:34px;border-radius:50%;border:2px dashed var(--muted,#6E655A);display:grid;place-items:center;font-size:15px;position:relative;overflow:hidden}.cre-sw input{position:absolute;inset:0;opacity:0;width:100%;height:100%}
.cre-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
.cre-items button{display:flex;flex-direction:column;align-items:center;gap:3px;border:1.5px solid var(--soft,#E3DACA);background:var(--panel,#FBF8F1);color:inherit;border-radius:14px;padding:9px 6px;font-size:12.5px;font-weight:700;text-align:center}
.cre-items button.on{border-color:var(--ink,#2B2621);box-shadow:inset 0 0 0 1.5px var(--ink,#2B2621)}.cre-items i{font-style:normal;font-size:22px}
.cre-items small{font-size:11px;font-weight:700;color:var(--muted,#6E655A)}.cre-items small.free{color:#2F7D63}.cre-items small.own{color:#2E5E8C}.cre-items small.cost{color:#B5523B}
.cre-foot{display:flex;align-items:center;gap:10px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1.5px solid var(--soft,#E3DACA);background:var(--panel,#FBF8F1)}
.cre-foot p{flex:1;margin:0;font-size:12.5px;color:var(--muted,#6E655A);line-height:1.3}.cre-foot .go{border:2px solid #2B2621;background:#E4572E;color:#fff;border-radius:14px;padding:11px 16px;font-weight:800;font-size:15px;box-shadow:0 3px 0 #2B2621}
.cre-foot .go:disabled{opacity:.6}
.cre-photo{display:flex;flex-direction:column;align-items:center;gap:10px}.cre-photo canvas{width:240px;height:240px;border-radius:18px;background:#ddd;touch-action:none}
.cre-photo p{margin:0;font-size:13px;color:var(--muted,#6E655A);text-align:center;line-height:1.4}.cre-photo .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.cre-photo input[type=range]{width:220px}.cre-found{display:flex;gap:14px;align-items:center}.cre-found span{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:12px}.cre-found b{width:30px;height:30px;border-radius:50%;border:2px solid rgba(0,0,0,.15)}
@media (min-width:820px){.cre{flex-direction:row;flex-wrap:wrap}.cre-top{flex:0 0 100%}.cre-stage{flex:0 0 50%;height:calc(100% - 52px)}.cre-side{flex:1;display:flex;flex-direction:column;min-width:0;height:calc(100% - 52px)}}
`;

export async function openCreator({ api, toast = msg => alert(msg), required = false, onSaved } = {}) {
  if (!document.getElementById('cre-css')) document.head.append(el('style', { id: 'cre-css' }, CSS));
  const d = await api('/api/me/look');
  const ward = new Set(d.wardrobe || []); let coins = d.coins || 0;
  // a first character starts as the mannequin; changing it later starts from what they wear now
  let L = d.set ? AV.fixLook(d.look) : AV.fixLook({ ...AV.mannequin(d.gender), g: d.gender || 'm' });

  // ---- the page ----
  const coinsChip = el('span', { class: 'cre-coins', text: `🪙 ${fmt(coins)}` });
  const root = el('div', { class: 'cre', role: 'dialog', 'aria-label': 'Create your character' });
  const top = el('div', { class: 'cre-top' }, el('h2', { text: d.set ? '👗 Your look' : '✨ Create your character' }), coinsChip, required ? '' : el('button', { class: 'cre-x', 'aria-label': 'Close', text: '✕', onclick: () => close() }));
  const stage = el('div', { class: 'cre-stage' }), hint = el('div', { class: 'cre-hint', text: 'Drag to turn' });
  const bodyBtn = el('button', { class: 'on', text: 'Body', onclick: () => zoom(false) }), faceBtn = el('button', { text: 'Face', onclick: () => zoom(true) });
  stage.append(el('div', { class: 'cre-view' }, bodyBtn, faceBtn), hint);
  const tabs = el('div', { class: 'cre-tabs' }), panel = el('div', { class: 'cre-panel' }), note = el('p'), go = el('button', { class: 'go' });
  const side = el('div', { class: 'cre-side' }, tabs, panel, el('div', { class: 'cre-foot' }, note, go));
  root.append(top, stage, side); document.body.append(root); document.body.classList.add('cre-on');

  // ---- the 3D model, in a small studio ----
  const R = new THREE.WebGLRenderer({ antialias: true, alpha: true }); R.setPixelRatio(Math.min(2, devicePixelRatio || 1)); stage.prepend(R.domElement);
  pictureMode(R); R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05; R.outputColorSpace = THREE.SRGBColorSpace; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(26, 1, 0.05, 30);
  const env = () => { const pm = new THREE.PMREMGenerator(R); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); scene.environmentIntensity = 0.55; }; env();
  const key = new THREE.DirectionalLight('#FFF3E2', 2.3); key.position.set(1.6, 3.2, 2.6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.2, near: 0.5, far: 8 });
  const rim = new THREE.DirectionalLight('#DDE8FF', 1.1); rim.position.set(-2, 2.4, -2.5); scene.add(key, rim, new THREE.HemisphereLight('#FFFFFF', '#9A9080', 0.55));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.ShadowMaterial({ opacity: 0.22 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.04, 48), new THREE.MeshStandardMaterial({ color: '#F3EEE6', roughness: 0.85 })); disc.position.y = -0.021; disc.receiveShadow = true; scene.add(disc);
  let av = null, turn = 0.35, face = false, camY = 0.95, camD = 4.6, aimY = 0.92, want = { y: 0.95, d: 4.6, a: 0.92 };
  const guard = blackGuard(R, scene, () => draw()), ctx = guardContext(R, stage, { back: () => { if (guard.level < 1) env(); draw(); } });
  const rebuild = () => { if (av) { scene.remove(av.group); av.dispose(); } av = buildAvatar(L, { shadows: true }); av.group.rotation.y = turn; scene.add(av.group); draw(); };
  let raf = 0; const draw = () => { if (!raf) raf = requestAnimationFrame(frame); };
  function frame() { raf = 0; const k = 0.18; camY += (want.y - camY) * k; camD += (want.d - camD) * k; aimY += (want.a - aimY) * k; cam.position.set(0, camY, camD); cam.lookAt(0, aimY, 0);
    if (av) av.group.rotation.y = turn; R.render(scene, cam); guard.after(); if (Math.abs(want.d - camD) > 0.002 || Math.abs(want.y - camY) > 0.002) draw(); }
  const size = () => { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); fit(); draw(); };
  const fit = () => { const ht = av ? av.height : 1.8; want = face ? { y: ht * 0.93, d: 1.25, a: ht * 0.925 } : { y: ht * 0.6, d: Math.max(5.2, 4.4 / Math.min(1, cam.aspect * 1.2)), a: ht * 0.5 }; };
  function zoom(f) { face = f; bodyBtn.classList.toggle('on', !f); faceBtn.classList.toggle('on', f); fit(); draw(); }
  const ro = new ResizeObserver(size); ro.observe(stage);
  { let px = null; stage.addEventListener('pointerdown', e => { px = e.clientX; stage.setPointerCapture(e.pointerId); hint.hidden = true; });
    stage.addEventListener('pointermove', e => { if (px == null) return; turn += (e.clientX - px) * 0.012; px = e.clientX; draw(); });
    const up = () => { px = null; }; stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); }

  // ---- choosing ----
  const set = (patch, zoomFace) => { L = AV.fixLook({ ...L, ...patch, w: patch.w || L.w }); rebuild(); if (zoomFace != null && zoomFace !== face) zoom(zoomFace); else { fit(); draw(); } paint(); };
  const wear = (slot, v) => { const w = { ...L.w }; if (v) w[slot] = v; else delete w[slot]; if (slot === 'top' && v && AV.itemOf('top', v[0])[3]?.full) delete w.bot; if (slot === 'bot' && v && w.top && AV.itemOf('top', w.top[0])[3]?.full) delete w.top; set({ w }); };
  const chips = (names, cur, fn) => el('div', { class: 'cre-chips' }, ...names.map((n, i) => el('button', { class: i === cur ? 'on' : '', text: n, onclick: () => fn(i) })));
  const swatches = (cols, cur, fn, custom = true) => el('div', { class: 'cre-sw' }, ...cols.map(c => el('button', { class: c.toUpperCase() === String(cur).toUpperCase() ? 'on' : '', style: `background:${c}`, 'aria-label': c, onclick: () => fn(c) })),
    custom ? el('label', { title: 'Any colour' }, '🎨', el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888', oninput: e => fn(e.target.value) })) : '');
  const tag = (slot, k) => { const p = AV.priceOf(slot, k); return !p ? el('small', { class: 'free', text: 'Free' }) : ward.has(AV.wardKey(slot, k)) ? el('small', { class: 'own', text: 'Owned' }) : el('small', { class: 'cost', text: `🪙 ${fmt(p)}` }); };
  const itemsOf = slot => { const g = L.g, list = Object.entries(AV.ITEMS[slot]); return list.sort((a, b) => ((a[1][2] && a[1][2] !== g) - (b[1][2] && b[1][2] !== g)) || a[1][1] - b[1][1]); };
  // a sensible first colour for each kind of thing (they can change it straight after)
  const startColour = (s, k) => ({ top: k === 'shirt' || k === 'blouse' ? 0 : k === 'dress' || k === 'sundress' || k === 'gown' ? 16 : 13, bot: k === 'jeans' ? 6 : k === 'skirt' || k === 'longskirt' ? 3 : 1, shoe: k === 'sneakers' || k === 'hightops' ? 0 : 18, out: k === 'denim' ? 7 : k === 'leather' ? 4 : 18, hat: 4, eye: 4, neck: 14, wrist: 4, bag: 18 })[s] ?? 4;
  const OPTIONAL = { top: true, bot: true, shoe: true, out: true, hat: true, eye: true, neck: true, ear: true, wrist: true, bag: true };

  const TABS = [['body', '🧍 Body'], ['face', '🙂 Face'], ['hair', '💇 Hair'], ['clothes', '👕 Clothes'], ['wear', '🧢 Extras'], ['photo', '📷 From a photo']];
  let tab = 'body', sub = { clothes: 'top', wear: 'hat' };
  function paint() {
    tabs.replaceChildren(...TABS.map(([k, n]) => el('button', { class: k === tab ? 'on' : '', text: n, onclick: () => { tab = k; paint(); panel.scrollTop = 0; if (k === 'face' || k === 'hair') { if (!face) zoom(true); } else if (k !== 'photo' && face) zoom(false); } })));
    const P = [];
    if (tab === 'body') {
      // man or woman: chosen once, while making the character for the first time (the hair and beard follow sensibly)
      if (!d.set) P.push(el('h4', { text: 'You are' }), chips(['👨 A man', '👩 A woman'], L.g === 'f' ? 1 : 0, i => { const g = i ? 'f' : 'm'; if (g === L.g) return; const m = AV.mannequin(g), wasDefault = L.hs === AV.mannequin(L.g).hs; set({ g, hs: wasDefault ? m.hs : L.hs, bdr: g === 'f' ? 0 : L.bdr }); }));
      P.push(el('h4', { text: 'Skin' }), swatches(AV.SKINS, L.sk, c => set({ sk: c })),
        el('h4', { text: 'Height' }), chips(AV.HEIGHTS, L.ht, i => set({ ht: i })), el('h4', { text: 'Build' }), chips(AV.BUILDS, L.bd, i => set({ bd: i })));
    } else if (tab === 'face') {
      P.push(el('h4', { text: 'Face shape' }), chips(AV.FACES, L.fc, i => set({ fc: i })), el('h4', { text: 'Eyes' }), swatches(AV.EYES, L.ey, c => set({ ey: c })),
        el('h4', { text: 'Eyebrows' }), chips(AV.BROWS, L.br, i => set({ br: i })), el('h4', { text: 'Nose' }), chips(AV.NOSES, L.ns, i => set({ ns: i })),
        el('h4', { text: 'Facial hair' }), chips(AV.BEARDS, L.bdr, i => set({ bdr: i })), el('h4', { text: 'Makeup' }), chips(AV.MAKEUP, L.mk, i => set({ mk: i })));
      if (L.mk === 1 || L.mk === 3) P.push(el('h4', { text: 'Lipstick' }), swatches(AV.LIPS, AV.LIPS[L.lc], c => set({ lc: AV.LIPS.indexOf(c) }), false));
    } else if (tab === 'hair') {
      P.push(el('h4', { text: 'Hair colour' }), swatches(AV.HAIRS, L.hc, c => set({ hc: c })), el('h4', { text: 'Style' }),
        el('div', { class: 'cre-items' }, ...AV.HAIR_ORDER[L.g].map(k => el('button', { class: k === L.hs ? 'on' : '', onclick: () => set({ hs: k }) }, el('i', { text: '💇' }), AV.HAIR_STYLES[k][0], tag('hair', k)))));
    } else if (tab === 'clothes' || tab === 'wear') {
      const slots = AV.SLOTS.filter(([s]) => (tab === 'clothes') === ['top', 'bot', 'shoe', 'out'].includes(s)), s = sub[tab];
      P.push(el('div', { class: 'cre-sub' }, ...slots.map(([k, n]) => el('button', { class: k === s ? 'on' : '', text: `${SLOT_ICON[k]} ${n}`, onclick: () => { sub[tab] = k; paint(); } }))));
      const cur = L.w[s];
      P.push(el('div', { class: 'cre-items' }, OPTIONAL[s] ? el('button', { class: cur ? '' : 'on', onclick: () => wear(s, null) }, el('i', { text: '🚫' }), 'None', el('small', { text: s === 'top' || s === 'bot' ? 'Underwear' : ' ' })) : '',
        ...itemsOf(s).map(([k, it]) => el('button', { class: cur && cur[0] === k ? 'on' : '', onclick: () => wear(s, [k, cur && !AV.fixedColour(s, k) ? cur[1] : AV.fixedColour(s, k) ? 0 : startColour(s, k)]) }, el('i', { text: SLOT_ICON[s] }), it[0], tag(s, k)))));
      if (cur && !AV.fixedColour(s, cur[0])) P.push(el('h4', { text: 'Colour' }), swatches(AV.CLOTH, AV.CLOTH[cur[1]], c => wear(s, [cur[0], AV.CLOTH.indexOf(c)]), false));
    } else if (tab === 'photo') P.push(photoPanel());
    panel.replaceChildren(...P);
    // what saving costs, and whether they're dressed
    const owed = AV.unpaid(L, [...ward]), total = owed.reduce((n, x) => n + x[2], 0), ok = AV.dressed(L);
    note.textContent = !ok ? 'Pick a top and bottoms (or a dress) to go out in.' : total ? `${owed.length === 1 ? '1 new thing' : owed.length + ' new things'} to buy: 🪙 ${fmt(total)}${total > coins ? ` (you have ${fmt(coins)})` : ''}` : 'Everything here is yours.';
    go.textContent = total ? `Buy & wear · 🪙 ${fmt(total)}` : required ? 'Done ✓' : 'Save my look';
    go.disabled = !ok || busy;
  }
  let busy = false;
  go.onclick = async () => {
    const owed = AV.unpaid(L, [...ward]), total = owed.reduce((n, x) => n + x[2], 0);
    if (total > coins) { toast(`That look costs ${fmt(total)} coins and you have ${fmt(coins)}. Swap the priced things for free ones, or earn some more first.`); return; }
    if (total && !confirm(`Buy ${owed.map(([s, k]) => s === 'hair' ? AV.HAIR_STYLES[k][0] : AV.itemOf(s, k)[0]).join(', ')} for ${fmt(total)} coins?`)) return;
    busy = true; paint();
    try { const r = await api('/api/me/look', { method: 'POST', body: { look: L, buy: total > 0 } }); for (const k of r.wardrobe || []) ward.add(k); coins = r.coins ?? coins; coinsChip.textContent = `🪙 ${fmt(coins)}`;
      toast(required ? 'Welcome! That’s you now: everyone sees this character.' : total ? `Bought and saved. You look great.` : 'Saved. Everyone sees your new look.'); close(true); onSaved && onSaved(r.look); }
    catch (e) { toast(e.message); } finally { busy = false; if (root.isConnected) paint(); }
  };

  // ---- matching a photo: skin, hair and eye colour (read on the phone; the photo goes nowhere) ----
  let photo = null, pz = 1, pxo = 0, pyo = 0, found = null;
  function photoPanel() {
    const cv = el('canvas', { width: 480, height: 480 }), g = cv.getContext('2d', { willReadFrequently: true });
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { const f = file.files[0]; if (!f) return; const im = new Image(); im.onload = () => { photo = im; pz = 1; pxo = 0; pyo = 0; found = null; paint(); }; im.src = URL.createObjectURL(f); } });
    const S = 480, oval = { x: S / 2, y: S * 0.52, rx: S * 0.24, ry: S * 0.31 };
    const show = () => { g.fillStyle = '#d8d2c6'; g.fillRect(0, 0, S, S); if (photo) { const k = Math.max(S / photo.width, S / photo.height) * pz, w = photo.width * k, h = photo.height * k; g.drawImage(photo, (S - w) / 2 + pxo, (S - h) / 2 + pyo, w, h); }
      g.save(); g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.rect(0, 0, S, S); g.ellipse(oval.x, oval.y, oval.rx, oval.ry, 0, 0, Math.PI * 2); g.fill('evenodd'); g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); g.ellipse(oval.x, oval.y, oval.rx, oval.ry, 0, 0, Math.PI * 2); g.stroke(); g.restore(); };
    show();
    { let last = null; cv.addEventListener('pointerdown', e => { last = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', e => { if (!last || !photo) return; const k = S / cv.clientWidth; pxo += (e.clientX - last[0]) * k; pyo += (e.clientY - last[1]) * k; last = [e.clientX, e.clientY]; found = null; show(); });
      cv.addEventListener('pointerup', () => { last = null; }); }
    const zoomR = el('input', { type: 'range', min: '1', max: '4', step: '0.02', value: String(pz), oninput: e => { pz = +e.target.value; found = null; show(); } });
    // reads patches of the photo: cheeks and forehead for skin, above the hairline for hair, the eyes for eye colour
    const read = () => { show(); let px; try { g.save(); const k = Math.max(S / photo.width, S / photo.height) * pz, w = photo.width * k, h = photo.height * k; g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.drawImage(photo, (S - w) / 2 + pxo, (S - h) / 2 + pyo, w, h); g.restore(); px = g.getImageData(0, 0, S, S).data; } catch (e) { return null; } finally { show(); }
      const patch = (cx, cy, r) => { const out = []; for (let y = Math.round(cy - r); y <= cy + r; y++) for (let x = Math.round(cx - r); x <= cx + r; x++) { if (x < 0 || y < 0 || x >= S || y >= S) continue; const i = (y * S + x) * 4; out.push([px[i], px[i + 1], px[i + 2]]); } return out; };
      const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], med = list => { if (!list.length) return null; const s = [...list].sort((a, b) => lum(a) - lum(b)), m = s[Math.floor(s.length / 2)]; return m; };
      const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
      const { x, y, rx, ry } = oval;
      const skinPx = [...patch(x - rx * 0.45, y + ry * 0.12, 14), ...patch(x + rx * 0.45, y + ry * 0.12, 14), ...patch(x, y - ry * 0.45, 12)].filter(c => lum(c) > 35 && lum(c) < 245);
      const hairPx = [...patch(x, y - ry - 22, 16), ...patch(x - rx * 0.75, y - ry * 0.7, 10), ...patch(x + rx * 0.75, y - ry * 0.7, 10)];
      const skin = med(skinPx), hair = med(hairPx); if (!skin) return null;
      // the eyes: anywhere across the eye line, the pixels clearly darker than skin that aren't hair (the brows)
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), band = [];
      for (const sx of [-1, 1]) for (let yy = y - ry * 0.5; yy <= y + ry * 0.05; yy += 3) for (let xx = x + sx * rx * 0.15; Math.abs(xx - x) <= rx * 0.65; xx += sx * 3) band.push(...patch(xx, yy, 1));
      const eyePx = band.filter(c => lum(c) < lum(skin) * 0.9 && lum(c) > 10 && (!hair || dist(c, hair) > 45) && dist(c, skin) > 60).sort((a, b) => lum(a) - lum(b));
      const eye = med(eyePx.slice(0, Math.max(8, Math.floor(eyePx.length * 0.5))));
      { const all = [...skinPx, ...hairPx, ...eyePx], f = all[0]; if (!f || all.every(c => c[0] === f[0] && c[1] === f[1] && c[2] === f[2])) return null; } /* every spot the same: a blank read (the browser hides photo colours) */
      const sk = hex(skin), hc = hair ? hex(hair) : L.hc, ey = eye ? hex(eye.map(v => v * 1.15)) : L.ey;
      return { sk, hc, ey };
    };
    const P = [el('p', { text: 'Use a clear photo of your face in good light. Drag it and zoom so your face fills the oval, then tap Match. Your photo stays on your phone; only the colours are used.' }), cv];
    if (photo) P.push(el('div', { class: 'row' }, el('span', { text: '🔍' }), zoomR));
    P.push(el('div', { class: 'row' }, el('button', { class: 'btn', text: photo ? '📷 Another photo' : '📷 Choose a photo', onclick: () => file.click() }),
      photo ? el('button', { class: 'btn primary', text: '✨ Match my colours', onclick: () => { const r = read(); if (!r) { toast('Your browser hides photo colours (a privacy setting). Pick your colours in the Body, Face and Hair tabs instead.'); return; } found = r; set({ sk: r.sk, hc: r.hc, ey: r.ey }, true); tab = 'photo'; paint(); } }) : ''), file);
    if (found) P.push(el('div', { class: 'cre-found' }, ...[['Skin', found.sk], ['Hair', found.hc], ['Eyes', found.ey]].map(([n, c]) => el('span', {}, el('b', { style: `background:${c}` }), n))),
      el('p', { text: 'Done: your character now has these colours. Fine-tune them in the other tabs, then pick a hairstyle and clothes.' }));
    return el('div', { class: 'cre-photo' }, ...P);
  }

  function close() { cancelAnimationFrame(raf); ro.disconnect(); ctx.dispose(); if (av) av.dispose(); R.dispose(); root.remove(); document.body.classList.remove('cre-on'); }
  rebuild(); size(); paint();
  return { close };
}
