// Colony radio music: every station composes its own music live in the browser, in its own style, so it never repeats
// and needs no licence. Nothing here is a recording: drums, talking drum, guitars, flutes, log drums and keys are all
// synthesised with Web Audio.
//
// Each song is worked out from (station, slot number) and each bar from (song, bar number), so anyone tuning in
// mid-song hears exactly the same bar as everyone else.
import { STATIONS, SLOT_MS, slotOf, slotStart, hash, rng, songTitle, timeline } from '/shared/radio.js';

// How loud the DJs are against the music: while a DJ talks the music drops to DUCK (0.14, about -17 dB) and the voice
// plays at VOICE_GAIN (1.6, about +4 dB) through its own compressor.
const DUCK = 0.14, VOICE_GAIN = 1.6;
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
    // a sung voice: a buzzing tone shaped by the three resonances of a vowel, with a singer's vibrato
    vox(t, f, dur, v = 1, vowel = 'a') { const F = { a: [800, 1150, 2900], o: [450, 800, 2830], e: [400, 1700, 2600] }[vowel] || [800, 1150, 2900];
      const g = gain(out); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 0.04); g.gain.setValueAtTime(0.45 * v, t + Math.max(0.05, dur - 0.06)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1);
      const pre = ctx.createGain(); pre.gain.value = 0.25; F.forEach((fq, k) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fq; b.Q.value = 9; const bg = ctx.createGain(); bg.gain.value = [1, 0.55, 0.3][k]; pre.connect(b).connect(bg).connect(g); });
      const o = osc('sawtooth', f * 0.985, t, dur + 0.15, pre); o.frequency.linearRampToValueAtTime(f, t + 0.06); const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.6; lg.gain.value = f * 0.014; lfo.connect(lg).connect(o.frequency); lfo.start(t + 0.18); lfo.stop(t + dur + 0.15); },
    // "Hey!": a shouted, falling voice
    shout(t, f, v = 1) { const g = gain(out); env(g, t, 0.01, 0.6 * v, 0.2); const pre = ctx.createGain(); pre.gain.value = 0.3;
      [500, 1700, 2600].forEach((fq, k) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fq; b.Q.value = 6; const bg = ctx.createGain(); bg.gain.value = [1, 0.7, 0.4][k]; pre.connect(b).connect(bg).connect(g); });
      const o = osc('sawtooth', f * 1.5, t, 0.25, pre); o.frequency.exponentialRampToValueAtTime(f, t + 0.18); noiseHit(t, 0.08, 'bandpass', 1800, 1.5, 0.25 * v); },
    // the build-up: rising noise and a rising tone
    riser(t, dur) { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = 2; b.frequency.setValueAtTime(300, t); b.frequency.exponentialRampToValueAtTime(7000, t + dur);
      const g = gain(out); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.02); s.connect(b).connect(g); s.start(t); s.stop(t + dur + 0.05);
      const g2 = gain(out); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.06, t + dur); g2.gain.linearRampToValueAtTime(0, t + dur + 0.02); const o = osc('sawtooth', 200, t, dur, g2); o.frequency.exponentialRampToValueAtTime(1600, t + dur); },
    crash(t, v = 1) { noiseHit(t, 1.6, 'highpass', 5000, 0.5, 0.22 * v); const g = gain(out); env(g, t, 0.004, 0.7 * v, 0.9); const o = osc('sine', 70, t, 1, g); o.frequency.exponentialRampToValueAtTime(38, t + 0.6); },
    tom(t, f, v = 1) { const g = gain(out); env(g, t, 0.002, 0.55 * v, 0.28); const o = osc('sine', f * 1.7, t, 0.35, g); o.frequency.exponentialRampToValueAtTime(f, t + 0.08); noiseHit(t, 0.03, 'lowpass', 1500, 1, 0.15 * v); },
    brass(t, fs, dur, v = 1) { const g = gain(out); env(g, t, 0.03, 0.07 * v, dur); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(2400, t + 0.06); lp.frequency.exponentialRampToValueAtTime(900, t + dur); lp.connect(g); for (const f of fs) osc('sawtooth', f, t, dur + 0.1, lp); },
  };
}

// ---------- styles: how each station's songs are put together ----------
// make(r) builds a song from its random generator; bar(song, i, r, part) returns the notes of bar i as
// [step, instrument, ...args] (args after the time). Steps are 12 to a bar (12/8 feel) or 16 (4/4).
// Melodies are two bars long (a phrase and its answer); bar i plays half (i % 2) of them.
const chordOf = (root, scale, deg) => [0, 2, 4].map(k => { const i = deg + k; return root + scale[i % scale.length] + 12 * Math.floor(i / scale.length); });
// A phrase that sounds written rather than random: a motif on a syncopated rhythm, then an answer with the same
// rhythm that varies a note or two and steps down home to the root. len = steps in the whole phrase.
function phrase(r, len, span = 7, density = 0.6) {
  const half = len / 2, A = []; let p = 2 + Math.floor(r() * 3);
  for (let k = 0; k < half; k++) { if (k > 0 && r() > (k % 2 ? density * 0.75 : density)) { A.push(null); continue; } p = Math.max(0, Math.min(span, p + pick(r, [-2, -1, -1, 0, 1, 1, 2, 3]))); A.push(p); }
  const B = A.slice(), tail = []; for (let k = half - 1; k >= 0 && tail.length < 3; k--) if (B[k] != null) tail.unshift(k);
  tail.forEach((k, j) => { B[k] = [2, 1, 0].slice(3 - tail.length)[j]; });
  for (let k = 0; k < half; k++) if (B[k] != null && !tail.includes(k) && r() < 0.3) B[k] = Math.max(0, Math.min(span, B[k] + pick(r, [-1, 1, 2])));
  return A.concat(B);
}
const half = (ph, i, n) => ph.slice((i % 2) * n, (i % 2) * n + n);
const deg = (root, scale, p) => root + scale[((p % scale.length) + scale.length) % scale.length] + 12 * Math.floor(p / scale.length);

const STYLES = {
  // Fuji / Jùjú: 12/8 with the iron bell pattern, shekere, talking drum conversation, jùjú guitar and bass
  yoruba: {
    steps: 12, bpm: [100, 118], fill: 'talk',
    make(r) { const scale = SCALES.penta, root = pick(r, [55, 57, 58, 60]); return { scale, root, prog: pick(r, [[0, 3, 4, 0], [0, 0, 3, 4], [0, 4, 3, 4], [0, 3, 0, 4]]), call: phrase(r, 12, 5, 0.7), guitar: phrase(r, 24, 8, 0.65), jj: r() < 0.7, chant: phrase(r, 12, 5, 0.5) }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = chordOf(s.root - 12, SCALES.major, b), hook = part === 'lead';
      'x.x.xx.x.x.x'.split('').forEach((c, k) => c === 'x' && N.push([k, 'bell', k === 0 || k === 7]));
      for (let k = 0; k < 12; k++) N.push([k, 'shaker', k % 3 === 0 ? 1 : 0.5]);
      if (part !== 'intro') { N.push([0, 'conga', 98, 0.9], [6, 'conga', 98, 0.7], [9, 'conga', 140, 0.6, true], [3, 'kick', 0.5]); if (hook) N.push([0, 'kick', 0.7], [6, 'kick', 0.5], [4, 'conga', 140, 0.5, true]); }
      // the talking drum "speaks": a phrase and its answer, freer in the break
      half(s.call, i, 6).forEach((p, k) => { if (p != null && (part !== 'intro' || k < 3)) N.push([k * 2, 'talk', NOTE(s.root - 12 + [0, 3, 5, 7, 10, 12][p % 6]), r() < 0.5 ? 1.25 : 0.82, 0.15]); });
      if (part === 'break') for (let k = 1; k < 12; k += 2) if (r() < 0.5) N.push([k, 'talk', NOTE(s.root - 12 + pick(r, [0, 3, 5, 7])), pick(r, [1.3, 0.8]), 0.08, 0.7]);
      if (part !== 'intro' && part !== 'break') { N.push([0, 'bass', NOTE(ch[0]), 0.5], [6, 'bass', NOTE(ch[0] + 7), 0.3], [9, 'bass', NOTE(ch[2]), 0.25]); if (hook) N.push([4, 'bass', NOTE(ch[0] + 12), 0.1]);
        if (s.jj || hook) half(s.guitar, i, 12).forEach((p, k) => p != null && N.push([k, 'pluck', NOTE(deg(s.root, s.scale, p + b)), 0.25, 0.65, 0.65])); }
      if (hook) for (let k = 0; k < 12; k += 3) N.push([k, 'pluck2', NOTE(ch[k / 3 % 3] + 12), 0.2, 0.4, 0.8]);
      return N; },
  },
  // Highlife: bright guitars in thirds, walking bass, clave/bell, congas, horn stabs
  igbo: {
    steps: 16, bpm: [112, 128], fill: 'conga',
    make(r) { const scale = SCALES.major, root = pick(r, [55, 57, 60, 62]); return { scale, root, prog: pick(r, [[0, 3, 4, 0], [0, 4, 5, 3], [0, 3, 0, 4], [0, 5, 3, 4]]), riff: phrase(r, 32, 9, 0.7), horns: phrase(r, 8, 4, 0.8), chant: phrase(r, 16, 5, 0.45) }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = chordOf(s.root - 12, s.scale, b), hook = part === 'lead';
      'x..x..x...x.x...'.split('').forEach((c, k) => c === 'x' && N.push([k, 'bell', k === 0, 0.7]));
      for (let k = 0; k < 16; k += 2) N.push([k, 'hat', k % 4 === 2 ? 1 : 0.5]); if (hook) for (let k = 1; k < 16; k += 2) N.push([k, 'shaker', 0.5]);
      if (part !== 'intro') { N.push([0, 'kick'], [8, 'kick', 0.7], [4, 'rim'], [12, 'rim'], [6, 'conga', 110, 0.6], [7, 'conga', 110, 0.5], [14, 'conga', 160, 0.6, true]);
        [0, 4, 8, 12].forEach((k, j) => N.push([k, 'bass', NOTE(ch[[0, 2, 1, 2][j]] - 12 + (j === 3 ? 2 : 0)), 0.22])); if (hook) N.push([10, 'bass', NOTE(ch[0]), 0.1]); }
      // lead guitar, with a second guitar a third above it (the classic highlife sound) on the other side in the hook
      if (part !== 'break') half(s.riff, i, 16).forEach((p, k) => { if (p == null || (part === 'intro' && k > 7)) return; N.push([k, 'pluck', NOTE(deg(s.root, s.scale, p + b)), 0.2, 0.55, 0.7]); if (hook) N.push([k, 'pluck2', NOTE(deg(s.root, s.scale, p + b + 2)), 0.2, 0.4, 0.7]); });
      if (part !== 'intro') [2, 6, 10, 14].forEach(k => N.push([k, 'pluck2', NOTE(ch[1] + 12), 0.08, 0.3, 0.2]));
      // horns answer the guitars at the end of every second bar of the hook
      if (hook && i % 2 === 1) s.horns.forEach((p, k) => p != null && N.push([8 + k, 'brass', [NOTE(deg(s.root, s.scale, p + b)), NOTE(deg(s.root, s.scale, p + b + 2))], 0.12]));
      return N; },
  },
  // Kalangu / Sahel: a drone, the kalangu (talking drum) and calabash, a flute singing an ornamented line
  hausa: {
    steps: 16, bpm: [92, 108], fill: 'talk',
    make(r) { const scale = pick(r, [SCALES.hijaz, SCALES.minpenta, SCALES.dorian]), root = pick(r, [50, 52, 53, 55]); return { scale, root, line: phrase(r, 16, 9, 0.75), kal: '..x.x..x..x.x.x.'.split('').map(c => c === 'x' && r() < 0.85 ? 1 : 0), chant: phrase(r, 16, 5, 0.4) }; },
    bar(s, i, r, part) { const N = [], hook = part === 'lead';
      if (i % 2 === 0) N.push([0, 'pad', [NOTE(s.root - 12), NOTE(s.root - 5)], 2 * 60 / s.bpm * 4 * 0.98, 0.9]);
      N.push([0, 'calabash'], [10, 'calabash', 0.7]); if (part !== 'intro') N.push([6, 'calabash', 0.5]); for (let k = 2; k < 16; k += 4) N.push([k, 'shaker', 0.8]); if (hook) for (let k = 0; k < 16; k += 2) N.push([k, 'shaker', 0.45]);
      if (part !== 'intro') s.kal.forEach((x, k) => x && N.push([k, 'talk', NOTE(s.root - 10 + (k % 3) * 3), r() < 0.5 ? 1.4 : 0.75, 0.12, 0.9]));
      if (part !== 'intro' && part !== 'break') N.push([0, 'bass', NOTE(s.root - 24), 0.8], [8, 'bass', NOTE(s.root - 17), 0.6]);
      if (part === 'break') for (let k = 0; k < 16; k++) if (r() < 0.35) N.push([k, 'talk', NOTE(s.root - 10 + pick(r, [0, 3, 7])), pick(r, [1.4, 0.7]), 0.07, 0.8]);
      if (hook || (part === 'groove' && i % 4 >= 2)) half(s.line, i, 8).forEach((p, k) => p != null && N.push([k * 2, 'flute', NOTE(deg(s.root + 12, s.scale, p)), (k % 4 === 3 ? 0.55 : 0.3) * 60 / s.bpm]));
      return N; },
  },
  // Afrobeats / chill: the afrobeats groove (kick, rim, shaker), jazzy keys, warm pad, a pluck hook
  english: {
    steps: 16, bpm: [98, 108], fill: 'tom',
    make(r) { const scale = SCALES.dorian, root = pick(r, [57, 58, 60, 62]); return { scale, root, prog: pick(r, [[0, 3, 5, 4], [0, 5, 3, 6], [1, 4, 0, 0], [0, 2, 3, 4]]), hook: phrase(r, 32, 6, 0.55), shk: '.xxx.xx.xxx.x.xx', chant: phrase(r, 16, 5, 0.5) }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = [...chordOf(s.root - 12, s.scale, b), s.root - 12 + s.scale[(b + 6) % 7] + 12], hook = part === 'lead';
      for (let k = 0; k < 16; k++) { const v = hit(s.shk, k); if (v) N.push([k, 'shaker', v]); }
      if (part !== 'intro') { N.push([0, 'kick'], [7, 'kick', 0.6], [10, 'kick', 0.8], [3, 'rim', 0.8], [6, 'rim', 0.6], [11, 'rim', 0.7], [14, 'rim', 0.5], [4, 'clap', 0.6], [12, 'clap', 0.7]);
        N.push([0, 'bass', NOTE(ch[0] - 12), 0.4], [7, 'bass', NOTE(ch[0] - 12), 0.15], [10, 'bass', NOTE(ch[2] - 12), 0.3]); if (hook) N.push([14, 'bass', NOTE(ch[1] - 12), 0.1], [2, 'hat', 0.5], [6, 'hat', 0.5], [10, 'hat', 0.5], [14, 'hat', 0.6, true]); }
      N.push([0, 'keys', ch.map(NOTE), hook ? 0.2 : 0.6], [6, 'keys', ch.slice(1).map(NOTE), 0.3]); if (hook) N.push([3, 'keys', ch.slice(1).map(NOTE), 0.12], [11, 'keys', ch.slice(1).map(NOTE), 0.15]);
      if (i % 4 === 0) N.push([0, 'pad', ch.map(n => NOTE(n)), 4 * 4 * 60 / s.bpm * 0.98, 0.8]);
      if (hook || (part === 'groove' && i % 8 >= 4)) half(s.hook, i, 16).forEach((p, k) => p != null && N.push([k, 'pluck', NOTE(deg(s.root + 12, SCALES.minpenta, p)), 0.22, hook ? 0.5 : 0.3, 0.9]));
      return N; },
  },
  // Amapiano / street-pop: shakers, soft four-on-the-floor, the sliding log drum carrying the bass line, jazzy keys, a hook
  pidgin: {
    steps: 16, bpm: [110, 114], fill: 'tom',
    make(r) { const scale = SCALES.minpenta, root = pick(r, [53, 55, 57, 58]); return { scale, root, prog: pick(r, [[0, 3, 4, 3], [0, 2, 3, 4], [0, 0, 3, 4]]),
      logs: Array.from({ length: 32 }, (_, k) => r() < (k % 4 === 3 || k % 4 === 2 ? 0.55 : 0.25) ? Math.floor(r() * 4) : null), hook: phrase(r, 32, 7, 0.6), chant: phrase(r, 16, 5, 0.55) }; },
    bar(s, i, r, part) { const N = [], b = s.prog[i % s.prog.length], ch = chordOf(s.root - 12, SCALES.dorian, b), hook = part === 'lead';
      for (let k = 0; k < 16; k++) N.push([k, 'shaker', k % 2 ? 0.55 : 0.9]); for (let k = 2; k < 16; k += 4) N.push([k, 'hat', 0.6, k === 14]);
      if (part !== 'intro') { [0, 4, 8, 12].forEach(k => N.push([k, 'kick', 0.65])); N.push([4, 'clap', 0.5], [12, 'clap', 0.55], [3, 'cowbell', 0.5], [11, 'cowbell', 0.4]); if (hook) N.push([7, 'clap', 0.3], [15, 'cowbell', 0.35]); }
      if (part !== 'intro') half(s.logs, i, 16).forEach((p, k) => p != null && N.push([k, 'log', NOTE(deg(s.root - 24, s.scale, p + (b % 2))), 0.3]));
      if (part !== 'break') N.push([0, 'keys', ch.map(n => NOTE(n + 12)), 0.4], [10, 'keys', ch.map(n => NOTE(n + 12)), 0.2]);
      if (i % 4 === 0) N.push([0, 'pad', ch.map(NOTE), 4 * 4 * 60 / s.bpm * 0.98, 0.6]);
      if (hook) half(s.hook, i, 16).forEach((p, k) => p != null && N.push([k, 'lead', NOTE(deg(s.root + 12, s.scale, p)), 0.15]));
      if (part === 'groove' && i % 8 >= 4) half(s.hook, i, 16).forEach((p, k) => p != null && k % 2 === 0 && N.push([k, 'pluck2', NOTE(deg(s.root + 12, s.scale, p)), 0.2, 0.35, 0.8]));
      return N; },
  },
};

// The plan of one song: tempo, and its sections (like a real song: intro, verse, hook, verse, hook, a break that
// builds up and drops into the hook, a last hook lifted a step higher, and an outro).
export function songPlan(station, n) {
  const st = STYLES[station], r = rng(hash(station + ':' + n)), bpm = Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0]));
  const barSec = 4 * 60 / bpm, bars = Math.floor((SLOT_MS / 1000 - 3) / barSec);
  const song = { ...st.make(r), bpm, barSec, bars, steps: st.steps, title: songTitle(station, n), vowel: pick(r, ['a', 'o', 'e']), shout: r() < 0.7 };
  const seq = [['intro', 4], ['groove', 8], ['lead', 8], ['groove', 8], ['lead', 8]], tail = [['break', 4], ['build', 2], ['lead', 8], ['lift', 8]];
  let used = 36; while (bars - used - 22 - 4 >= 16) { seq.push(['groove', 8], ['lead', 8]); used += 16; }
  const rem = bars - used - 22, outro = Math.min(4, Math.max(1, rem)); const extra = rem - outro; if (extra >= 10) seq.push(['groove', extra - 8], ['lead', 8]); else if (extra > 0) seq.push(['groove', extra]);
  seq.push(...tail, ['outro', outro]);
  const map = []; for (const [name, len] of seq) { const start = map.length; for (let k = 0; k < len; k++) map.push({ name, start, len }); }
  song.sec = i => map[Math.max(0, Math.min(map.length - 1, i))]; song.part = i => i < 0 ? 'intro' : i >= map.length ? 'end' : map[i].name;
  song.lifted = { ...song, root: song.root + 2 };
  return song;
}

// What every style gets on top: a crash and a shout into each hook, a drum fill at the end of each section, a riser
// and snare roll in the build (with a beat of silence before the drop), and a chant sung in the hooks.
function extras(s, i, r, part, fillIns) {
  const E = [], st = s.steps, sec = s.sec(i), at = i - sec.start, prev = s.part(i - 1), next = s.part(i + 1), hook = part === 'lead' || part === 'lift';
  if (hook && at === 0) { E.push([0, 'crash', prev === 'build' ? 1 : 0.6]); if (s.shout && (prev === 'build' || r() < 0.5)) E.push([0, 'shout', NOTE(deg(s.root, s.scale, 4))]); }
  if (part === 'groove' && at === 0 && prev === 'intro') E.push([0, 'crash', 0.5]);
  const lastOfPhrase = at === sec.len - 1 || at % 8 === 7;
  if ((part === 'groove' || hook) && lastOfPhrase && next !== 'outro' && next !== 'break') for (let k = st * 0.75, j = 0; k < st; k++, j++) {
    if (fillIns === 'tom') E.push([k, 'tom', NOTE(s.root - 5 - j * 3)]); else if (fillIns === 'conga') E.push([k, 'conga', 170 - j * 18, 0.8, j % 2 === 0]); else E.push([k, 'talk', NOTE(s.root - 5 + (j % 2 ? 3 : 7)), j % 2 ? 0.8 : 1.3, 0.06, 0.9]); }
  if (part === 'build') { if (at === 0) E.push([0, 'riser', sec.len * s.barSec]);
    const step = at === sec.len - 1 ? 1 : 2, end = at === sec.len - 1 ? st * 0.75 : st; for (let k = 0; k < end; k += step) E.push([k, 'snare', 0.15 + 0.6 * (at * st + k) / (sec.len * st)]); }
  if (hook) { const ch = half(s.chant, i, st / 2), lift = part === 'lift', v = s.vowel;
    ch.forEach((p, k) => { if (p == null) return; let len = 1; while (k + len < ch.length && ch[k + len] == null && len < 3) len++;
      E.push([k * 2, 'vox', NOTE(deg(s.root, s.scale, p)), len * 2 / st * 0.9, 0.9, v]); if (lift || i % 4 >= 2) E.push([k * 2, 'vox2', NOTE(deg(s.root, s.scale, p + 2)), len * 2 / st * 0.9, 0.6, v]); }); }
  return E;
}

// Instruments sit in different places left to right, like a band on a stage.
const SIDE = { shaker: 'L', hat: 'R', bell: 'RR', cowbell: 'R', conga: 'LL', talk: 'L', pluck: 'L', pluck2: 'R', keys: 'R', brass: 'R', tom: 'L', vox2: 'LL' };
const ALIAS = { pluck2: 'pluck', vox2: 'vox' };
function playBar(kits, station, s, i, t0) {
  const part = s.part(i), r = rng(hash(station + ':' + s.n + ':' + i)), stepSec = s.barSec / s.steps, style = STYLES[station];
  const swing = s.steps === 16 ? 0.12 : 0, fade = part === 'outro' ? (i === s.bars - 1 ? 0.35 : 0.7) : 1, ss = part === 'lift' ? s.lifted : s;
  let notes = style.bar(ss, i, r, part === 'build' ? 'break' : part === 'lift' ? 'lead' : part);
  if (part === 'build' && s.part(i + 1) !== 'build') notes = notes.filter(n => n[0] < s.steps * 0.75); // silence, then the drop
  notes = notes.concat(extras(ss, i, r, part, style.fill));
  for (const [step, name, ...a] of notes) {
    const ins = ALIAS[name] || name, kit = kits[SIDE[name] || 'C'] || kits.C, f = kit[ins]; if (!f) continue;
    const t = t0 + step * stepSec + (step % 2 ? swing * stepSec : 0) + (r() - 0.5) * 0.008;
    const args = a.slice(); // durations are given in bars; volume falls in the outro
    if (['bass', 'pluck', 'keys', 'log', 'lead', 'brass', 'vox'].includes(ins) && typeof args[1] === 'number') args[1] = args[1] * s.barSec;
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
    if (ins === 'vox') { f(t, args[0], args[1], (args[2] ?? 1) * fade, args[3]); continue; }
    if (ins === 'riser') { f(t, args[0]); continue; }
    if (ins === 'tom' || ins === 'shout') { f(t, args[0], fade); continue; }
    if (['bass', 'log', 'lead'].includes(ins)) { f(t, args[0], args[1], (args[2] ?? 1) * fade); continue; }
    f(t, (args[0] ?? 1) * fade);
  }
}
// one kit per place on the stage
function makeKits(ctx, out) { const kits = { C: makeKit(ctx, out) };
  for (const [k, v] of [['L', -0.35], ['R', 0.35], ['LL', -0.65], ['RR', 0.65]]) { const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = v; p.connect(out); kits[k] = makeKit(ctx, p); }
  return kits; }

// Render a stretch of a station to an AudioBuffer (for previews and tests).
export async function renderOffline(station, n, fromBar = 0, seconds = 20) {
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100), comp = ctx.createDynamicsCompressor(), bus = ctx.createGain(); comp.threshold.value = -16; comp.ratio.value = 4; bus.gain.value = 0.7; bus.connect(comp); const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; comp.connect(lim).connect(ctx.destination);
  const kits = makeKits(ctx, bus), s = songPlan(station, n); s.n = n;
  // schedule each bar just before it plays, as the live player does (scheduling everything up front makes long renders crawl)
  const q = 128 / 44100; for (let i = fromBar, t = 0; t < seconds && i < s.bars; i++, t += s.barSec) { const bi = i, bt = t + 0.01;
    if (bt < 0.3) playBar(kits, station, s, bi, bt); else ctx.suspend(Math.floor((bt - 0.25) / q) * q).then(() => { playBar(kits, station, s, bi, bt); ctx.resume(); }); }
  return { buffer: await ctx.startRendering(), song: s };
}

// ---------- the player ----------
export class RadioPlayer {
  constructor(now, opts) { this.now = now; this.opts = opts; this.station = null; this.vol = 0.8; this.duck = 1; this.timer = null; this.onSong = null; this.tracks = []; this.base = ''; this.plans = new Map(); }
  // the station's uploaded songs ([{ id, dur, title }]); with none it plays generated songs only
  setTracks(list) { this.tracks = Array.isArray(list) ? list : []; }
  ensure() {
    if (this.ctx) return; const C = window.AudioContext || window.webkitAudioContext; this.ctx = this.opts ? new C(this.opts) : new C();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; const lim = this.ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; comp.connect(lim).connect(this.master); /* a last safety limiter so a loud voice over music never crackles */ const out = this.out = this.ctx.createDynamicsCompressor(); out.threshold.value = -1.5; out.knee.value = 0; out.ratio.value = 20; out.attack.value = 0.001; out.release.value = 0.08; this.master.connect(out).connect(this.ctx.destination);
    this.music = this.ctx.createGain(); this.mbus = this.ctx.createGain(); this.mbus.gain.value = 0.7; this.music.connect(this.mbus).connect(comp); this.voice = this.ctx.createGain(); this.voice.gain.value = VOICE_GAIN;
    // the DJs' voices: evened out (quiet words lifted, loud ones held) and made louder, so they sit clearly over the music
    const vc = this.ctx.createDynamicsCompressor(); vc.threshold.value = -24; vc.knee.value = 8; vc.ratio.value = 3; vc.attack.value = 0.005; vc.release.value = 0.2; this.voice.connect(vc).connect(this.master);
    // a touch of room so the synths sit together
    const d = this.ctx.createDelay(1), fb = this.ctx.createGain(), wet = this.ctx.createGain(); d.delayTime.value = 0.23; fb.gain.value = 0.22; wet.gain.value = 0.12; this.music.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(comp);
    this.kit = makeKits(this.ctx, this.music);
    // uploaded songs play through an audio element (streamed, so a long song doesn't fill memory), straight to the
    // master: real recordings are already mixed, so they skip the synths' compressor and room
    // two audio elements take turns, so the next song can load while this one plays
    this.tbus = this.ctx.createGain(); this.tbus.gain.value = 0; this.tbus.connect(this.master); this.els = []; this.cur = 0; this.failed = new Set();
    for (let i = 0; i < 2; i++) { const a = new Audio(); a.crossOrigin = 'anonymous'; a.preload = 'auto'; a.setAttribute('playsinline', ''); this.ctx.createMediaElementSource(a).connect(this.tbus);
      // a song that won't load this way (often the storage's CORS setting is missing) is tried again on a plain player
      a.addEventListener('error', () => { const id = a.dataset.track; if (!id || !a.getAttribute('src') || a.getAttribute('src').startsWith('blob:')) return;
        if (!this.plainIds.has(id)) { console.warn('radio: a song could not load through the mixer (check the storage CORS policy); playing it directly', id); this.plainIds.add(id); }
        if (this.trackKey && this.trackKey.includes(id)) this.trackKey = null; });
      this.els.push(a); }
    // the plain player: plays straight to the speakers (no mixer), used only when a song can't go through the mixer.
    // Its volume follows the radio's, but phones may ignore that and it isn't heard on the 24/7 stream.
    this.plainIds = new Set(); this.plain = new Audio(); this.plain.preload = 'auto'; this.plain.setAttribute('playsinline', '');
    this.plain.addEventListener('error', () => { const id = this.plain.dataset.track; if (!id || !this.plain.getAttribute('src') || this.plain.getAttribute('src').startsWith('blob:')) return;
      console.warn('radio: a song could not load at all; playing generated music instead', id); this.failed.add(id); if (this.trackKey && this.trackKey.includes(id)) this.trackKey = null; this.cursor = null; });
  }
  get el() { return this.els && this.els[this.cur]; }
  // where to get a song: the small data-saver copy on a slow connection, else the normal one
  srcOf(tr) { return (this.lite ? tr.lite : tr.url) || tr.url || this.base + '/api/radio/track/' + encodeURIComponent(tr.id); }
  // what's playing at t, with a song that won't load replaced by a generated one of the same length
  itemAt(t) { const it = timeline(this.station, this.tracks, t); if (it.kind === 'track' && this.failed.has(it.track.id)) { const n = 2e6 + (hash(it.key) % 1e6); return { kind: 'gen', n, start: it.start, end: it.end, title: songTitle(this.station, n), key: 'f' + it.key, seq: it.seq, stoodIn: it.title }; } return it; }
  // Phones only let a page play sound after a tap: start the audio element (silently) during the tap that turned the radio on.
  unlock() { if (this.unlocked || !this.els) return; this.unlocked = true; const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const u = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); for (const a of [...this.els, this.plain]) { a.src = u; a.play().catch(() => {}); } }
  async play(station) {
    this.ensure(); this.unlock(); if (this.ctx.state !== 'running') try { await this.ctx.resume(); } catch {}
    if (this.station === station && this.timer) return; this.stopMusic(); this.stopTrack(); this.station = station; this.song = null; this.cursor = null; this.item = null;
    this.music.gain.cancelScheduledValues(this.ctx.currentTime); this.music.gain.setValueAtTime(0, this.ctx.currentTime); this.music.gain.linearRampToValueAtTime(this.duck, this.ctx.currentTime + 1.2);
    this.timer = setInterval(() => this.schedule(), 50); this.schedule();
  }
  stopMusic() { clearInterval(this.timer); this.timer = null; }
  stop() { this.stopMusic(); this.stopTrack(); this.station = null; if (this.ctx) { this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); } }
  stopTrack() { this.trackKey = null; if (!this.els) return; this.tbus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15); setTimeout(() => { if (!this.trackKey) for (const a of [...this.els, this.plain]) a.pause(); }, 600); }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); this.plainVol(); }
  plainVol() { if (this.plain) try { this.plain.volume = Math.max(0, Math.min(1, this.vol * this.duck)); } catch {} }
  // turn the music down while the DJ talks
  setDuck(on) { this.duck = on ? DUCK : 1; if (this.music && this.station) { this.music.gain.setTargetAtTime(this.duck, this.ctx.currentTime, on ? 0.25 : 0.8); if (this.trackKey) this.tbus.gain.setTargetAtTime(this.duck, this.ctx.currentTime, on ? 0.25 : 0.8); } this.plainVol(); }
  // the context's clock against the shared wall clock
  ctxAt(wall) { return this.ctx.currentTime + (wall - this.now()) / 1000; }
  // Walk the station's running order (shared/radio.js timeline) on the shared clock: generated songs are scheduled bar by
  // bar a quarter second ahead; an uploaded song is started on its audio element at the right point and kept in step.
  plan(it) { let s = this.plans.get(it.key); if (!s) { s = songPlan(this.station, it.n); s.n = it.n; s.start = it.start; this.plans.set(it.key, s); if (this.plans.size > 6) this.plans.delete(this.plans.keys().next().value); } return s; }
  schedule() {
    if (!this.station || !this.ctx) return; const nowW = this.now(), horizon = nowW + 250, cur = this.itemAt(nowW);
    if (!this.item || this.item.key !== cur.key) { this.item = cur; this.song = { title: cur.title, kind: cur.kind, artist: cur.track?.artist || '', stoodIn: cur.stoodIn || '' }; this.onSong && this.onSong(this.song); }
    if (cur.kind === 'track') this.keepTrack(cur, nowW); else if (this.trackKey) this.stopTrack();
    if (this.cursor == null || this.cursor < nowW - 2000) this.cursor = nowW;
    for (let guard = 0; guard < 16 && this.cursor < horizon; guard++) {
      const it = this.itemAt(this.cursor);
      if (it.kind === 'track') { this.cursor = Math.max(it.end, this.cursor + 1); continue; }
      const s = this.plan(it), barMs = s.barSec * 1000, i = Math.max(0, Math.ceil((this.cursor - s.start) / barMs - 1e-6));
      if (i >= s.bars) { this.cursor = it.end; continue; }
      const at = s.start + i * barMs; if (at >= it.end) { this.cursor = it.end; continue; } if (at > horizon) { this.cursor = at; break; }
      if (at >= nowW - 60) this.playBar(s, i, this.ctxAt(at));
      this.cursor = at + barMs;
    }
  }
  keepTrack(it, nowW) {
    const want = (nowW - it.start) / 1000, src = this.srcOf(it.track), plain = this.plainIds.has(it.track.id);
    if (this.trackKey !== it.key && plain) { this.trackKey = it.key; this.checkAt = 0; if (want > it.track.dur - 1) return;
      for (const a of this.els) a.pause(); this.tbus.gain.setValueAtTime(0, this.ctx.currentTime); const el = this.plain;
      if (el.dataset.track !== it.track.id) { el.dataset.track = it.track.id; el.src = src; } el.currentTime = Math.max(0, want); this.plainVol(); el.play().catch(() => {}); return; }
    if (plain) { if (nowW < this.checkAt) return; this.checkAt = nowW + 2000; const el = this.plain; if (want < it.track.dur - 0.5) { if (el.paused && el.readyState >= 2) el.play().catch(() => {}); if (el.readyState >= 1 && Math.abs(el.currentTime - want) > 2.5) el.currentTime = want; } return; }
    if (!plain && this.plain && !this.plain.paused) this.plain.pause();
    if (this.trackKey !== it.key) { this.trackKey = it.key; this.checkAt = 0; this.stall = 0; if (want > it.track.dur - 1) return;
      // use the element that already loaded this song, if there is one; stop the other
      const other = 1 - this.cur; if (this.preKey === it.key && this.els[other].dataset.track === it.track.id) this.cur = other;
      const el = this.el; for (const a of this.els) if (a !== el) a.pause();
      if (el.dataset.track !== it.track.id || el.getAttribute('src') !== src) { el.dataset.track = it.track.id; el.src = src; }
      el.currentTime = Math.max(0, want); el.play().catch(() => {}); this.preKey = null;
      this.tbus.gain.cancelScheduledValues(this.ctx.currentTime); this.tbus.gain.setValueAtTime(0, this.ctx.currentTime); this.tbus.gain.linearRampToValueAtTime(this.duck, this.ctx.currentTime + 0.6); return; }
    // every couple of seconds: still playing, still in step with everyone else, and is the next song loading yet?
    if (nowW < this.checkAt) return; this.checkAt = nowW + 2000; const el = this.el;
    if (want < it.track.dur - 0.5) {
      if (el.paused && el.readyState >= 2) el.play().catch(() => {});
      if (el.readyState >= 1 && Math.abs(el.currentTime - want) > 2.5) el.currentTime = want;
      // stuck waiting for data for 6 seconds: switch to the data-saver copy for the rest of the session
      if (el.readyState < 3 && !el.paused) { this.stall ||= nowW; if (nowW - this.stall > 6000 && !this.lite && it.track.lite && it.track.lite !== it.track.url) { this.lite = true; this.liteAuto = true; this.onLite && this.onLite(); el.src = it.track.lite; el.currentTime = want; el.play().catch(() => {}); this.stall = 0; } }
      else this.stall = 0;
    }
    if (it.end - nowW < 25000 && !this.preKey) { const nx = this.itemAt(it.end + 1);
      if (nx.kind === 'track') { const idle = this.els[1 - this.cur]; idle.dataset.track = nx.track.id; idle.preload = 'auto'; idle.src = this.srcOf(nx.track); idle.load(); this.preKey = nx.key; } }
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
