// Game feel for the crime mini games ("juice"): small sounds made on the fly, a camera shake that fades away, quick
// flashes and numbers that pop up where something happened. It follows the game-feel guide in .claude/skills:
// feedback is layered and brief, always returns to rest, and its strength matches how much the moment matters.
// None of it touches the game itself: the rules and the server's replay never see any of this.

// ---------------- sound ----------------
// Every sound is synthesised (no files to download), so it costs nothing until it plays.
let ac = null, master = null; const lastAt = new Map();
let soundOn = true; try { soundOn = localStorage.getItem('mg-sound') !== '0'; } catch (e) {}
export const sound = {
  get on() { return soundOn; },
  set(v) { soundOn = !!v; try { localStorage.setItem('mg-sound', v ? '1' : '0'); } catch (e) {} if (v) unlock(); },
};
// Phones only allow sound after a tap, so the game's start button calls this.
export function unlock() { if (!soundOn) return null; try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  if (!ac) { ac = new AC(); master = ac.createGain(); master.gain.value = 0.55; const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination); }
  if (ac.state === 'suspended') ac.resume(); return ac; } catch (e) { return null; } }
function tone(f0, f1, dur, { type = 'sine', vol = 0.2, at = 0 } = {}) {
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02); }
let noiseBuf = null;
function noise(dur, { vol = 0.25, at = 0, lp = 2000, hp = 40 } = {}) {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = ac.currentTime + at, s = ac.createBufferSource(), a = ac.createBiquadFilter(), b = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; a.type = 'lowpass'; a.frequency.value = lp; b.type = 'highpass'; b.frequency.value = hp;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(a); a.connect(b); b.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02); }
// a little variety, so the hundredth shot doesn't sound like a machine
const vary = (f, k = 0.06) => f * (1 + (Math.random() * 2 - 1) * k);
const SFX = {
  tick: () => tone(vary(1500), 1200, 0.035, { type: 'square', vol: 0.05 }),
  click: () => noise(0.025, { vol: 0.22, hp: 2500, lp: 9000 }),
  ok: () => { tone(660, 660, 0.07, { type: 'triangle', vol: 0.16 }); tone(990, 990, 0.1, { type: 'triangle', vol: 0.13, at: 0.06 }); },
  wrong: () => { tone(240, 120, 0.2, { type: 'sawtooth', vol: 0.11 }); noise(0.06, { vol: 0.08, lp: 900 }); },
  coin: () => { tone(988, 988, 0.06, { type: 'square', vol: 0.06 }); tone(1319, 1319, 0.2, { type: 'square', vol: 0.06, at: 0.06 }); },
  pickup: () => { tone(vary(440, 0.02), 880, 0.1, { type: 'triangle', vol: 0.15 }); tone(880, 1320, 0.12, { type: 'triangle', vol: 0.1, at: 0.08 }); },
  heal: () => [523, 659, 784].forEach((f, i) => tone(f, f, 0.12, { type: 'sine', vol: 0.12, at: i * 0.06 })),
  swing: () => noise(0.11, { vol: 0.16, lp: vary(1100, 0.2), hp: 300 }),
  shot: () => { noise(0.08, { vol: 0.32, lp: vary(3200, 0.15), hp: 200 }); tone(vary(170), 55, 0.08, { type: 'square', vol: 0.1 }); },
  blast: () => { noise(0.2, { vol: 0.42, lp: 2200, hp: 60 }); tone(120, 40, 0.18, { type: 'square', vol: 0.14 }); },
  splat: () => { noise(0.09, { vol: 0.16, lp: vary(700, 0.2) }); tone(vary(140), 50, 0.1, { vol: 0.16 }); },
  hurt: () => { tone(vary(210), 90, 0.2, { type: 'sawtooth', vol: 0.15 }); noise(0.07, { vol: 0.12, lp: 700 }); },
  crash: () => { noise(0.5, { vol: 0.5, lp: 1500, hp: 50 }); tone(95, 35, 0.4, { type: 'square', vol: 0.18 }); noise(0.25, { vol: 0.15, hp: 3000, lp: 9000, at: 0.05 }); },
  zap: () => { tone(1800, 300, 0.25, { type: 'sawtooth', vol: 0.09 }); noise(0.15, { vol: 0.1, hp: 2000, lp: 8000 }); },
  beep: () => [0, 0.13, 0.26].forEach(at => tone(2350, 2350, 0.07, { type: 'square', vol: 0.07, at })), // a tripwire going off
  alarm: () => { for (let i = 0; i < 4; i++) { tone(900, 650, 0.22, { type: 'square', vol: 0.06, at: i * 0.25 }); } },
  wave: () => { tone(110, 70, 0.7, { type: 'sawtooth', vol: 0.1 }); tone(55, 40, 0.8, { type: 'sine', vol: 0.18 }); },
  whoosh: () => noise(0.22, { vol: 0.1, lp: 1300, hp: 250 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, { type: 'triangle', vol: 0.13, at: i * 0.09 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, f * 0.97, 0.24, { type: 'sawtooth', vol: 0.08, at: i * 0.16 })),
};
// gap so a sound can't pile up on itself many times in one moment
const GAP = { tick: 40, click: 30, shot: 45, swing: 70, splat: 60, hurt: 160, coin: 60 };
export function sfx(name) { if (!soundOn || !SFX[name]) return; const now = performance.now(); if (now - (lastAt.get(name) || 0) < (GAP[name] ?? 80)) return; lastAt.set(name, now);
  try { if (!unlock()) return; SFX[name](); } catch (e) {} }

// ---------------- shake ----------------
// "Trauma" (0 to 1) builds with each hit and fades by itself; the shake is trauma² so small knocks barely move the
// picture and big ones punch. For a 3D view the camera is nudged just for the frame (see world3d.js); for the flat
// games the whole game screen moves a few pixels. Phones set to reduce motion get a much gentler shake.
const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
const shaking = new Set(); let raf = 0;
export function shake(target, amount) { if (!target) return; target.trauma = Math.min(1, (target.trauma || 0) + amount * (calm ? 0.3 : 1));
  if (target.nodeType && !shaking.has(target)) { shaking.add(target); if (!raf) raf = requestAnimationFrame(shakeDom); } }
let lastT = 0;
function shakeDom(now) { const dt = Math.min(0.05, ((now - (lastT || now)) / 1000)); lastT = now; raf = 0;
  for (const el of shaking) { el.trauma = Math.max(0, el.trauma - 1.6 * dt); const k = el.trauma * el.trauma, t = now / 1000 * 32;
    if (k <= 0.0001 || !el.isConnected) { el.style.translate = ''; el.style.rotate = ''; shaking.delete(el); continue; }
    el.style.translate = `${(14 * k * Math.sin(t * 1.7)).toFixed(2)}px ${(10 * k * Math.sin(t * 2.3)).toFixed(2)}px`; el.style.rotate = `${(0.8 * k * Math.sin(t * 1.1)).toFixed(3)}deg`; }
  if (shaking.size) raf = requestAnimationFrame(shakeDom); else lastT = 0; }

// ---------------- flashes and pop-ups ----------------
export function flash(root, rgb = '255,255,255', a = 0.3, ms = 160) { if (!root || calm && a > 0.2) a = Math.min(a, 0.2);
  const f = document.createElement('div'); f.className = 'mgflash'; f.style.background = `rgba(${rgb},${a})`; f.style.animationDuration = ms + 'ms'; root.append(f); f.addEventListener('animationend', () => f.remove()); setTimeout(() => f.remove(), ms + 200); }
// Text that pops out with a little overshoot, floats up and fades, where the thing happened.
export function pop(root, x, y, text, kind = '') { if (!root) return; const r = root.getBoundingClientRect(), p = document.createElement('div'); p.className = 'mgpop ' + kind; p.textContent = text;
  p.style.left = (x - r.left) + 'px'; p.style.top = (y - r.top) + 'px'; root.append(p); p.addEventListener('animationend', () => p.remove()); setTimeout(() => p.remove(), 1500); }
// Where a point in a 3D scene is on the screen.
export function screenOf(view, x, y, z) { const c = view.renderer.domElement.getBoundingClientRect(), v = view.camera.position.clone().set(x, y, z).project(view.camera);
  return { x: c.left + (v.x + 1) / 2 * c.width, y: c.top + (1 - v.y) / 2 * c.height }; }
// A quick squash-and-spring on a button or label.
export function bump(el) { if (!el) return; el.classList.remove('mgbump'); void el.offsetWidth; el.classList.add('mgbump'); }

// ---------------- one call per event ----------------
// Three strengths, so the whole set of games stays in proportion: a footstep is not a crash.
const TIER = { small: { tr: 0.12 }, medium: { tr: 0.32, fl: 0.14 }, large: { tr: 0.62, fl: 0.3 } };
const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
export function feedback(tier, o = {}) { const T = TIER[tier] || TIER.small;
  if (o.sound) sfx(o.sound);
  if (o.shake !== false) shake(o.view || (tier !== 'small' ? o.root : null), o.shakeBy ?? T.tr);
  if (o.color && o.root) flash(o.root, o.color, o.flash ?? T.fl ?? 0.1);
  if (o.text && o.at && o.root) pop(o.root, o.at.x, o.at.y, o.text, o.kind || '');
  if (o.buzz) vib(o.buzz); }
