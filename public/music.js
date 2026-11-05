// Colony radio music: every station composes its own music live in the browser, in its own style, so it never repeats
// and needs no licence. Nothing here is a recording: drums, talking drum, guitars, flutes, log drums and keys are all
// synthesised with Web Audio.
//
// Each song is worked out from (station, slot number) and each bar from (song, bar number), so anyone tuning in
// mid-song hears exactly the same bar as everyone else.
import { STATIONS, SLOT_MS, slotOf, slotStart, hash, rng, songTitle } from '/shared/radio.js';

const NOTE = m => 440 * Math.pow(2, (m - 69) / 12);
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], penta: [0, 2, 4, 7, 9], minpenta: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], hijaz: [0, 1, 4, 5, 7, 8, 10], mixo: [0, 2, 4, 5, 7, 9, 10] };
const pick = (r, a) => a[Math.floor(r() * a.length)];
const hit = (pat, i) => pat[i % pat.length] === 'x' ? 1 : pat[i % pat.length] === 'o' ? 0.55 : 0;

// ---------- instruments ----------
function makeKit(ctx, out) {
  const noise = (() => { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
  const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
  const osc = (type, f, t, dur, dest) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(dest); o.start(t); o.stop(t + dur + 0.05); return o; };
  const gain = (dest, v = 1) => { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; };
  // Noise hits (shakers, hats, claps, snares): each sound is filtered and shaped once into a few short samples, then
  // just played back, which keeps a busy groove light on phones. The filter is the standard RBJ biquad.
  const hits = new Map(), biquad = (d, type, f, Q) => { const w = 2 * Math.PI * f / ctx.sampleRate, al = Math.sin(w) / (2 * Math.max(0.1, Q)), c = Math.cos(w);
    let b0, b1, b2; if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) { const x = d[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; } };
  const noiseHit = (t, dur, filt, f, q, vol, dest = out) => { const key = [dur, filt, f, q].join(':'); let set = hits.get(key);
    if (!set) { set = []; const sr = ctx.sampleRate, len = Math.ceil(sr * (dur + 0.01));
      for (let v = 0; v < 3; v++) { const d = new Float32Array(len); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; biquad(d, filt, f, q);
        for (let i = 0; i < len; i++) { const tt = i / sr; d[i] *= Math.min(1, tt / 0.002) * Math.exp(-6.9 * tt / dur); } const b = ctx.createBuffer(1, len, sr); b.copyToChannel(d, 0); set.push(b); }
      hits.set(key, set); }
    const s = ctx.createBufferSource(); s.buffer = set[Math.floor(Math.random() * 3)]; s.playbackRate.value = 0.94 + Math.random() * 0.12; const g = gain(dest, vol * 1.6); s.connect(g); s.start(t); };
  const strings = new Map(), makeString = (f, bright, key) => {
    const sr = ctx.sampleRate, len = Math.floor(sr * 1.6), out = new Float32Array(len), P = Math.max(2, Math.round(sr / f)), w = 0.5 - bright * 0.4, decay = 0.997;
    for (let i = 0; i < P; i++) out[i] = Math.random() * 2 - 1;
    for (let i = P; i < len; i++) out[i] = decay * ((1 - w) * out[i - P] + w * (i - P - 1 >= 0 ? out[i - P - 1] : 0));
    // soften the first instant and the tail
    for (let i = 0; i < 64; i++) out[i] *= i / 64; for (let i = len - 2000; i < len; i++) out[i] *= (len - i) / 2000;
    const b = ctx.createBuffer(1, len, sr); b.copyToChannel(out, 0); strings.set(key, b); return b; };
  const shaper = (() => { const w = ctx.createWaveShaper(), c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 2.2); } w.curve = c; w.connect(out); return w; })();
  return {
    kick(t, v = 1) { const g = gain(out); env(g, t, 0.003, 0.9 * v, 0.32); const o = osc('sine', 120, t, 0.4, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); },
    clap(t, v = 1) { for (let k = 0; k < 3; k++) noiseHit(t + k * 0.011, 0.09 + k * 0.03, 'bandpass', 1500, 1.2, 0.35 * v); },
    rim(t, v = 1) { const g = gain(out); env(g, t, 0.001, 0.25 * v, 0.05); osc('triangle', 1650, t, 0.08, g); noiseHit(t, 0.03, 'highpass', 3000, 0.7, 0.12 * v); },
    snare(t, v = 1) { noiseHit(t, 0.16, 'highpass', 1200, 0.6, 0.32 * v); const g = gain(out); env(g, t, 0.002, 0.25 * v, 0.1); osc('triangle', 190, t, 0.15, g); },
    hat(t, v = 1, open = false) { noiseHit(t, open ? 0.22 : 0.035, 'highpass', 7500, 0.8, 0.14 * v); },
    shaker(t, v = 1) { noiseHit(t, 0.05, 'bandpass', 6000, 1.5, 0.16 * v); },
    // two-tone iron bell (agogo / gankogui)
    bell(t, high, v = 1) { const f = high ? 1180 : 880, g = gain(out); env(g, t, 0.001, 0.13 * v, 0.28);
      const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f * 1.5; b.Q.value = 3; b.connect(g);
      osc('square', f, t, 0.3, b); osc('square', f * 1.48, t, 0.3, b); },
    cowbell(t, v = 1) { const g = gain(out); env(g, t, 0.001, 0.12 * v, 0.12); const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 800; b.Q.value = 4; b.connect(g); osc('square', 540, t, 0.15, b); osc('square', 800, t, 0.15, b); },
    // the talking drum: a tuned skin whose pitch the drummer bends while it rings
    talk(t, f, bend, dur, v = 1) { const g = gain(out); env(g, t, 0.004, 0.55 * v, dur); const o = osc('sine', f, t, dur + 0.1, g);
      o.frequency.setValueAtTime(f * (bend > 1 ? 0.92 : 1.05), t); o.frequency.exponentialRampToValueAtTime(f * bend, t + dur * 0.8);
      const g2 = gain(out); env(g2, t, 0.002, 0.18 * v, 0.06); osc('triangle', f * 2.3, t, 0.08, g2); noiseHit(t, 0.025, 'bandpass', 2500, 1, 0.12 * v); },
    conga(t, f, v = 1, slap = false) { const g = gain(out); env(g, t, 0.002, 0.45 * v, slap ? 0.09 : 0.22); const o = osc('sine', f * 1.4, t, 0.3, g); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
      if (slap) noiseHit(t, 0.05, 'bandpass', 2200, 1.4, 0.25 * v); },
    // calabash (Hausa/Sahel): deep thump with a hollow body
    calabash(t, v = 1) { const g = gain(out); env(g, t, 0.003, 0.6 * v, 0.25); const o = osc('sine', 95, t, 0.3, g); o.frequency.exponentialRampToValueAtTime(60, t + 0.15); noiseHit(t, 0.06, 'lowpass', 500, 1, 0.2 * v); },
    // the amapiano log drum: a sliding, slightly overdriven bass note
    log(t, f, dur, v = 1) { const g = gain(shaper); env(g, t, 0.004, 0.42 * v, Math.max(0.18, dur)); const o = osc('sine', f * 2, t, dur + 0.3, g); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      const g2 = gain(shaper); env(g2, t, 0.002, 0.12 * v, 0.1); osc('triangle', f * 3, t, 0.12, g2); },
    bass(t, f, dur, v = 1) { const g = gain(out); env(g, t, 0.01, 0.45 * v, dur); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.connect(g);
      osc('triangle', f, t, dur + 0.1, lp); osc('sine', f, t, dur + 0.1, lp); },
    // plucked guitar string: a Karplus–Strong string (noise ringing round a tuned, slowly damped loop), worked out once
    // per note into a short sample and then just played back, so it costs almost nothing on a phone
    pluck(t, f, dur, v = 1, bright = 0.5) { const key = Math.round(f * 2) + ':' + Math.round(bright * 4), buf = strings.get(key) || makeString(f, bright, key);
      const src = ctx.createBufferSource(); src.buffer = buf; const o = gain(out); o.gain.setValueAtTime(0.9 * v, t); o.gain.setTargetAtTime(0.0001, t + dur, 0.07); src.connect(o); src.start(t); src.stop(t + Math.min(buf.duration, dur + 0.5)); },
    keys(t, f, dur, v = 1) { const g = gain(out); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14 * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.05 * v, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
      osc('sine', f, t, dur + 0.35, g); const g2 = gain(g, 0.3); osc('triangle', f * 2, t, Math.min(0.4, dur + 0.35), g2); },
    pad(t, fs, dur, v = 1) { const g = gain(out); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * v, t + Math.min(1.2, dur / 3)); g.gain.setValueAtTime(0.05 * v, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(g); for (const f of fs) for (const dt of [-6, 6]) { const o = osc('sawtooth', f, t, dur, lp); o.detune.value = dt; } },
    // a breathy flute (the Hausa sarewa / Fulani flute) with vibrato and a little ornament slide into the note
    flute(t, f, dur, v = 1) { const g = gain(out); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16 * v, t + 0.06); g.gain.setValueAtTime(0.13 * v, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
      const o = osc('sine', f * 0.97, t, dur + 0.1, g); o.frequency.linearRampToValueAtTime(f, t + 0.05); const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.2; lg.gain.value = f * 0.012; lfo.connect(lg).connect(o.frequency); lfo.start(t + 0.12); lfo.stop(t + dur + 0.1);
      const g2 = gain(g, 0.15); osc('triangle', f * 2, t, dur + 0.1, g2); noiseHit(t, dur * 0.6, 'bandpass', f * 2, 2, 0.04 * v); },
    // a bright street-pop lead
    lead(t, f, dur, v = 1) { const g = gain(out); env(g, t, 0.01, 0.09 * v, dur + 0.1); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(900, t + dur); lp.connect(g);
      osc('square', f, t, dur + 0.15, lp); },
    brass(t, fs, dur, v = 1) { const g = gain(out); env(g, t, 0.03, 0.07 * v, dur); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(2400, t + 0.06); lp.frequency.exponentialRampToValueAtTime(900, t + dur); lp.connect(g); for (const f of fs) osc('sawtooth', f, t, dur + 0.1, lp); },
  };
}

// ---------- styles: how each station's songs are put together ----------
// make(r) builds a song from its random generator; bar(song, i, r, part) returns the notes of bar i as
// [step, instrument, ...args] (args after the time). Steps are 12 to a bar (12/8 feel) or 16 (4/4).
const chordOf = (root, scale, deg) => [0, 2, 4].map(k => { const i = deg + k; return root + scale[i % scale.length] + 12 * Math.floor(i / scale.length); });
function melody(r, scale, len, span = 7) { const out = []; let p = Math.floor(r() * 3); for (let i = 0; i < len; i++) { p = Math.max(0, Math.min(span, p + pick(r, [-2, -1, -1, 0, 1, 1, 2]))); out.push(r() < 0.72 ? p : null); } return out; }
const deg = (root, scale, p) => root + scale[((p % scale.length) + scale.length) % scale.length] + 12 * Math.floor(p / scale.length);

const STYLES = {
  // Fuji / Jùjú: 12/8 with the iron bell pattern, shekere, talking drum conversation, jùjú guitar and bass
  yoruba: {
    steps: 12, bpm: [96, 116],
    make(r) { const scale = SCALES.penta, root = pick(r, [55, 57, 58, 60]); return { scale, root, prog: pick(r, [[0, 3, 4, 0], [0, 0, 3, 4], [0, 4, 3, 4]]), call: melody(r, [0, 2, 4, 5, 7], 6, 5), guitar: melody(r, scale, 12, 8), jj: r() < 0.6 }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = chordOf(s.root - 12, SCALES.major, b);
      'x.x.xx.x.x.x'.split('').forEach((c, k) => c === 'x' && N.push([k, 'bell', k === 0 || k === 7]));
      for (let k = 0; k < 12; k++) N.push([k, 'shaker', k % 3 === 0 ? 1 : 0.5]);
      if (part !== 'intro') { N.push([0, 'conga', 98, 0.9], [6, 'conga', 98, 0.7], [9, 'conga', 140, 0.6, true], [3, 'kick', 0.5]); }
      // the talking drum "speaks": a call phrase, then an answer on alternate bars, freer in the break
      const ph = (i % 2 === 0 || part === 'break') ? s.call : s.call.map(p => p == null ? null : 5 - p);
      ph.forEach((p, k) => { if (p != null && (part !== 'intro' || k < 3)) N.push([k * 2, 'talk', NOTE(s.root - 12 + [0, 3, 5, 7, 10, 12][p % 6]), r() < 0.5 ? 1.25 : 0.82, 0.15]); });
      if (part !== 'intro' && part !== 'break') { N.push([0, 'bass', NOTE(ch[0]), 0.5], [6, 'bass', NOTE(ch[0] + 7), 0.3], [9, 'bass', NOTE(ch[2]), 0.25]);
        if (s.jj) s.guitar.forEach((p, k) => p != null && k % 2 === 0 && N.push([k, 'pluck', NOTE(deg(s.root, s.scale, p + b)), 0.3, 0.7, 0.6])); }
      if (part === 'lead') for (let k = 0; k < 12; k += 3) N.push([k, 'pluck', NOTE(ch[k / 3 % 3] + 12), 0.25, 0.45, 0.8]);
      return N; },
  },
  // Highlife: bright guitars in thirds, walking bass, clave/bell, congas, horn stabs
  igbo: {
    steps: 16, bpm: [112, 128],
    make(r) { const scale = SCALES.major, root = pick(r, [55, 57, 60, 62]); return { scale, root, prog: pick(r, [[0, 3, 4, 0], [0, 4, 5, 3], [0, 3, 0, 4], [0, 5, 3, 4]]), riff: melody(r, scale, 16, 9), horns: r() < 0.6 }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = chordOf(s.root - 12, s.scale, b);
      'x..x..x...x.x...'.split('').forEach((c, k) => c === 'x' && N.push([k, 'bell', k === 0, 0.7]));
      for (let k = 0; k < 16; k += 2) N.push([k, 'hat', k % 4 === 2 ? 1 : 0.5]);
      if (part !== 'intro') { N.push([0, 'kick'], [8, 'kick', 0.7], [4, 'rim'], [12, 'rim'], [6, 'conga', 110, 0.6], [7, 'conga', 110, 0.5], [14, 'conga', 160, 0.6, true]);
        [0, 4, 8, 12].forEach((k, j) => N.push([k, 'bass', NOTE(ch[[0, 2, 1, 2][j]] - 12 + (j === 3 ? 2 : 0)), 0.22])); }
      // lead guitar with a second guitar a third above it: the classic highlife sound
      if (part !== 'break') s.riff.forEach((p, k) => { if (p == null || (part === 'intro' && k > 7)) return; const n = deg(s.root, s.scale, p + b); N.push([k, 'pluck', NOTE(n), 0.2, 0.55, 0.7]); if (part === 'lead') N.push([k, 'pluck', NOTE(deg(s.root, s.scale, p + b + 2)), 0.2, 0.35, 0.7]); });
      if (part !== 'intro') [2, 6, 10, 14].forEach(k => N.push([k, 'pluck', NOTE(ch[1] + 12), 0.08, 0.3, 0.2]));
      if (s.horns && part === 'lead' && i % 4 === 3) N.push([12, 'brass', ch.map(n => NOTE(n + 12)), 0.35]);
      return N; },
  },
  // Kalangu / Sahel: a drone, the kalangu (talking drum) and calabash, a flute singing an ornamented line
  hausa: {
    steps: 16, bpm: [88, 108],
    make(r) { const scale = pick(r, [SCALES.hijaz, SCALES.minpenta, SCALES.dorian]), root = pick(r, [50, 52, 53, 55]); return { scale, root, line: melody(r, scale, 8, 9), kal: '..x.x..x..x.x.x.'.split('').map(c => c === 'x' && r() < 0.85 ? 1 : 0) }; },
    bar(s, i, r, part) { const N = [];
      if (i % 2 === 0) N.push([0, 'pad', [NOTE(s.root - 12), NOTE(s.root - 5)], 2 * 60 / s.bpm * 4 * 0.98, 0.9]);
      N.push([0, 'calabash'], [10, 'calabash', 0.7]); for (let k = 2; k < 16; k += 4) N.push([k, 'shaker', 0.8]);
      if (part !== 'intro') s.kal.forEach((x, k) => x && N.push([k, 'talk', NOTE(s.root - 10 + (k % 3) * 3), r() < 0.5 ? 1.4 : 0.75, 0.12, 0.9]));
      if (part !== 'intro' && part !== 'break') N.push([0, 'bass', NOTE(s.root - 24), 0.8], [8, 'bass', NOTE(s.root - 17), 0.6]);
      if (part === 'lead' || (part === 'groove' && i % 4 >= 2)) s.line.forEach((p, k) => p != null && N.push([k * 2, 'flute', NOTE(deg(s.root + 12, s.scale, p + (i % 4 === 3 ? 1 : 0))), (k % 4 === 3 ? 0.55 : 0.3) * 60 / s.bpm]));
      return N; },
  },
  // Afrobeats / chill: the afrobeats groove (kick, rim, shaker), jazzy keys, warm pad, a sparse pluck lead
  english: {
    steps: 16, bpm: [96, 106],
    make(r) { const scale = SCALES.dorian, root = pick(r, [57, 58, 60, 62]); return { scale, root, prog: pick(r, [[0, 3, 5, 4], [0, 5, 3, 6], [1, 4, 0, 0], [0, 2, 3, 4]]), hook: melody(r, SCALES.minpenta, 16, 6), shk: '.xxx.xx.xxx.x.xx' }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = [...chordOf(s.root - 12, s.scale, b), s.root - 12 + s.scale[(b + 6) % 7] + 12];
      for (let k = 0; k < 16; k++) { const v = hit(s.shk, k); if (v) N.push([k, 'shaker', v]); }
      if (part !== 'intro') { N.push([0, 'kick'], [7, 'kick', 0.6], [10, 'kick', 0.8], [3, 'rim', 0.8], [6, 'rim', 0.6], [11, 'rim', 0.7], [14, 'rim', 0.5], [4, 'clap', 0.6], [12, 'clap', 0.7]);
        N.push([0, 'bass', NOTE(ch[0] - 12), 0.4], [7, 'bass', NOTE(ch[0] - 12), 0.15], [10, 'bass', NOTE(ch[2] - 12), 0.3]); }
      N.push([0, 'keys', ch.map(NOTE), 0.6], [6, 'keys', ch.slice(1).map(NOTE), 0.3]);
      if (i % 4 === 0) N.push([0, 'pad', ch.map(n => NOTE(n)), 4 * 4 * 60 / s.bpm * 0.98, 0.8]);
      if (part === 'lead') s.hook.forEach((p, k) => p != null && k % 2 === 1 && N.push([k, 'pluck', NOTE(deg(s.root + 12, SCALES.minpenta, p)), 0.25, 0.4, 0.9]));
      return N; },
  },
  // Amapiano / street-pop: shakers, soft four-on-the-floor, the sliding log drum carrying the bass line, jazzy keys, a hook
  pidgin: {
    steps: 16, bpm: [110, 114],
    make(r) { const scale = SCALES.minpenta, root = pick(r, [53, 55, 57, 58]); return { scale, root, prog: pick(r, [[0, 3, 4, 3], [0, 2, 3, 4], [0, 0, 3, 4]]), logs: Array.from({ length: 16 }, (_, k) => r() < (k % 4 === 3 || k % 4 === 2 ? 0.55 : 0.25) ? Math.floor(r() * 4) : null), hook: melody(r, scale, 16, 7) }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = chordOf(s.root - 12, SCALES.dorian, b);
      for (let k = 0; k < 16; k++) N.push([k, 'shaker', k % 2 ? 0.55 : 0.9]); for (let k = 2; k < 16; k += 4) N.push([k, 'hat', 0.6, k === 14]);
      if (part !== 'intro') { [0, 4, 8, 12].forEach(k => N.push([k, 'kick', 0.65])); N.push([4, 'clap', 0.5], [12, 'clap', 0.55], [3, 'cowbell', 0.5], [11, 'cowbell', 0.4]); }
      if (part !== 'intro') s.logs.forEach((p, k) => p != null && N.push([k, 'log', NOTE(deg(s.root - 24, s.scale, p + (b % 2))), 0.3]));
      if (part !== 'break') N.push([0, 'keys', ch.map(n => NOTE(n + 12)), 0.4], [10, 'keys', ch.map(n => NOTE(n + 12)), 0.2]);
      if (i % 4 === 0) N.push([0, 'pad', ch.map(NOTE), 4 * 4 * 60 / s.bpm * 0.98, 0.6]);
      if (part === 'lead') s.hook.forEach((p, k) => p != null && k % 2 === 0 && N.push([k, 'lead', NOTE(deg(s.root + 12, s.scale, p)), 0.18]));
      return N; },
  },
};

// The plan of one song: tempo, bars and where each part starts.
export function songPlan(station, n) {
  const st = STYLES[station], r = rng(hash(station + ':' + n)), bpm = Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0]));
  const barSec = (st.steps === 12 ? 4 * 60 / bpm : 4 * 60 / bpm), bars = Math.floor((SLOT_MS / 1000 - 3) / barSec);
  const song = { ...st.make(r), bpm, barSec, bars, steps: st.steps, title: songTitle(station, n) };
  // intro 4 bars, then groove and lead sections, a break two-thirds in, and the last 2 bars fade out
  song.part = i => i < 4 ? 'intro' : i >= bars - 2 ? 'outro' : (i >= Math.floor(bars * 0.62) && i < Math.floor(bars * 0.62) + 4) ? 'break' : (Math.floor((i - 4) / 8) % 2 ? 'lead' : 'groove');
  return song;
}

function playBar(kit, station, s, i, t0) {
  const part = s.part(i), r = rng(hash(station + ':' + s.n + ':' + i)), stepSec = s.barSec / s.steps;
  const swing = s.steps === 16 ? 0.12 : 0, fade = part === 'outro' ? (i === s.bars - 1 ? 0.35 : 0.7) : 1;
  for (const [step, ins, ...a] of STYLES[station].bar(s, i, r, part)) {
    const t = t0 + step * stepSec + (step % 2 ? swing * stepSec : 0) + (r() - 0.5) * 0.008, f = kit[ins]; if (!f) continue;
    const args = a.slice(); // scale durations given in steps; volume falls in the outro
    if (['bass', 'pluck', 'keys', 'log', 'lead', 'brass'].includes(ins) && typeof args[1] === 'number') args[1] = args[1] * s.barSec; // durations are in bars
    if (ins === 'talk') args[2] = args[2] * s.barSec;
    if (ins === 'keys') { const fs = Array.isArray(args[0]) ? args[0] : [args[0]]; for (const fq of fs) f(t, fq, args[1] ?? 0.4, 0.8 * fade); continue; }
    if (ins === 'brass') { f(t, args[0], args[1], fade); continue; }
    if (ins === 'pad') { f(t, args[0], args[1], (args[2] ?? 1) * fade); continue; }
    if (ins === 'flute') { f(t, args[0], args[1], fade); continue; }
    if (ins === 'bell') { f(t, args[0], (args[1] ?? 1) * fade); continue; }
    if (ins === 'hat') { f(t, (args[0] ?? 1) * fade, args[1]); continue; }
    if (ins === 'talk') { f(t, args[0], args[1], args[2], (args[3] ?? 1) * fade); continue; }
    if (ins === 'conga') { f(t, args[0], (args[1] ?? 1) * fade, args[2]); continue; }
    if (ins === 'pluck') { f(t, args[0], args[1], (args[2] ?? 1) * fade, args[3]); continue; }
    if (['bass', 'log', 'lead'].includes(ins)) { f(t, args[0], args[1], (args[2] ?? 1) * fade); continue; }
    f(t, (args[0] ?? 1) * fade);
  }
}

// Render a stretch of a station to an AudioBuffer (for previews and tests).
export async function renderOffline(station, n, fromBar = 0, seconds = 20) {
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100), comp = ctx.createDynamicsCompressor(), bus = ctx.createGain(); comp.threshold.value = -16; comp.ratio.value = 4; bus.gain.value = 0.7; bus.connect(comp); const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; comp.connect(lim).connect(ctx.destination);
  const kit = makeKit(ctx, bus), s = songPlan(station, n); s.n = n;
  for (let i = fromBar, t = 0; t < seconds && i < s.bars; i++, t += s.barSec) playBar(kit, station, s, i, t + 0.01);
  return { buffer: await ctx.startRendering(), song: s };
}

// ---------- the player ----------
export class RadioPlayer {
  constructor(now, opts) { this.now = now; this.opts = opts; this.station = null; this.vol = 0.8; this.duck = 1; this.timer = null; this.onSong = null; }
  ensure() {
    if (this.ctx) return; const C = window.AudioContext || window.webkitAudioContext; this.ctx = this.opts ? new C(this.opts) : new C();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; const lim = this.ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; comp.connect(lim).connect(this.master); this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain(); this.mbus = this.ctx.createGain(); this.mbus.gain.value = 0.7; this.music.connect(this.mbus).connect(comp); this.voice = this.ctx.createGain(); this.voice.gain.value = 1; this.voice.connect(this.master);
    // a touch of room so the synths sit together
    const d = this.ctx.createDelay(1), fb = this.ctx.createGain(), wet = this.ctx.createGain(); d.delayTime.value = 0.23; fb.gain.value = 0.22; wet.gain.value = 0.12; this.music.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(comp);
    this.kit = makeKit(this.ctx, this.music);
  }
  async play(station) {
    this.ensure(); if (this.ctx.state !== 'running') try { await this.ctx.resume(); } catch {}
    if (this.station === station && this.timer) return; this.stopMusic(); this.station = station; this.song = null; this.cursor = null;
    this.music.gain.cancelScheduledValues(this.ctx.currentTime); this.music.gain.setValueAtTime(0, this.ctx.currentTime); this.music.gain.linearRampToValueAtTime(this.duck, this.ctx.currentTime + 1.2);
    this.timer = setInterval(() => this.schedule(), 50); this.schedule();
  }
  stopMusic() { clearInterval(this.timer); this.timer = null; }
  stop() { this.stopMusic(); this.station = null; if (this.ctx) { this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); } }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  // turn the music down while the DJ talks
  setDuck(on) { this.duck = on ? 0.28 : 1; if (this.music && this.station) this.music.gain.setTargetAtTime(this.duck, this.ctx.currentTime, on ? 0.25 : 0.8); }
  // the context's clock against the shared wall clock
  ctxAt(wall) { return this.ctx.currentTime + (wall - this.now()) / 1000; }
  // Schedule every bar that starts in the next quarter second. The cursor walks bar by bar through the station's
  // songs on the shared clock; a song's last bars leave a short gap before the next slot starts.
  schedule() {
    if (!this.station || !this.ctx) return; const nowW = this.now(), horizon = nowW + 250;
    if (this.cursor == null || this.cursor < nowW - 2000) this.cursor = nowW;
    for (let guard = 0; guard < 16 && this.cursor < horizon; guard++) {
      const n = slotOf(this.station, this.cursor);
      if (!this.song || this.song.n !== n) { const s = songPlan(this.station, n); s.n = n; s.start = slotStart(this.station, n); this.song = s; this.onSong && this.onSong(s); }
      const s = this.song, barMs = s.barSec * 1000, i = Math.max(0, Math.ceil((this.cursor - s.start) / barMs - 1e-6));
      if (i >= s.bars) { this.cursor = slotStart(this.station, n + 1); continue; }
      const at = s.start + i * barMs; if (at > horizon) { this.cursor = at; break; }
      if (at >= nowW - 60) this.playBar(s, i, this.ctxAt(at));
      this.cursor = at + barMs;
    }
  }
  playBar(s, i, t0) { if (t0 < this.ctx.currentTime - 0.05) return; playBar(this.kit, this.station, s, i, t0); } // too late: skip rather than pile up
  // the DJ: play a voice clip over the music (ducking it), or resolve straight away when there's no audio
  async speak(url, offsetSec = 0) {
    this.ensure(); const res = await fetch(url); if (!res.ok) throw new Error('voice ' + res.status); const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    if (offsetSec >= buf.duration - 0.3) return; const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.voice); this.setDuck(true);
    src.start(this.ctx.currentTime + 0.05, Math.max(0, offsetSec)); this.speaking = src;
    return new Promise(ok => { src.onended = () => { if (this.speaking === src) { this.speaking = null; this.setDuck(false); } ok(); }; });
  }
  hush() { try { this.speaking?.stop(); } catch {} this.speaking = null; this.setDuck(false); }
}
