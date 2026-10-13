// Fake songs for the analysis checks (tools/beat-bench.js, tools/analyze-test.js): a whole band, synthesised from a
// seed, with its beats, bar lines, chords and sections known. Pure (no node: imports), so a page or a Worker in the
// test browser builds the very same samples Node does. Our own signal, never anyone's recording.
//
//   fakeSong({ seed, bpm, bpb, drift, freeIntro, sr, form, tuning, pickup }) -> { sr, stems: { drums, bass, other,
//       vocals } (Float32Array, mono), mix, truth: { bpm, bpb, beats (s), downbeats (s), chords: [{ t0, t1, root, minor }],
//       sections: [{ name, t0, t1 }], free: [[t0, t1]], key: { root (pc), minor } } }
//   SONG_FORM: the default form (bars a section): Intro 4, Verse 8, Chorus 8, Verse 8, Chorus 8, Bridge 8, Chorus 8,
//       Outro 4
//
//   drift: 'steady' (one tempo), 'live' (a player's slow wander, about ±2.5%, and hits a few ms either side of the
//          beat), 'ramp' (speeding up 5% over the song)
//   freeIntro: seconds of a cappella singing in free time before the band (no beats there: a free span)
//   tuning: cents every pitched part sits off A440 (a band tuned a little flat)
// The band: a kick and a snare on the backbeat (4/4) or a waltz (3/4: the kick on 1), hats in eighths, a bass on the
// roots, chords held on a pad (stabbed on the beat in the intro and outro, the quiet edges), a sung line on the
// chord tones. Sections differ as records do: the chorus louder and brighter, the bridge on its own progression.
// Deterministic: a seeded generator, never Math.random; oscillators by recurrence, so it is quick.
//
//   fakeMix({ seconds, sr, seed }) -> { mix (Float32Array planar [2, L]), L }   a stereo test signal for the stems
//       runner's DSP (tools/jobs-test.js): 48 partials a side between 40 Hz and 12 kHz at seeded levels and phases,
//       and a small offset. Band-limited on purpose: nothing near Nyquist, which the model's spectrogram drops.

const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
export const SONG_FORM = [['Intro', 4], ['Verse', 8], ['Chorus', 8], ['Verse', 8], ['Chorus', 8], ['Bridge', 8], ['Chorus', 8], ['Outro', 4]];

function rng(seed) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (xs) => xs[Math.floor(r() * xs.length)];
  return r;
}

// a progression of four chords from scale degrees (0-based), as { root pc, minor }
function chordOf(key, deg) {
  const sc = key.minor ? MINOR : MAJOR;
  const root = (key.root + sc[deg % 7]) % 12, third = (sc[(deg + 2) % 7] - sc[deg % 7] + 12) % 12;
  return { root, minor: third === 3 };
}
const PROGS_MAJOR = [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 3], [3, 0, 4, 5], [1, 4, 0, 0], [5, 4, 3, 4]];
const PROGS_MINOR = [[0, 5, 2, 6], [0, 3, 4, 0], [0, 5, 6, 4], [3, 6, 2, 5], [0, 6, 5, 6], [5, 6, 0, 0], [3, 4, 0, 5]];

export function fakeMix({ seconds = 10, sr = 44100, seed = 1 } = {}) {
  const R = rng(seed * 2246822519 + 7), L = Math.round(seconds * sr), mix = new Float32Array(2 * L);
  for (let c = 0; c < 2; c++) {
    const parts = Array.from({ length: 48 }, () => ({ w: (2 * Math.PI * (40 * Math.pow(300, R()))) / sr, a: 0.02 + 0.03 * R(), ph: 2 * Math.PI * R() }));
    const x = new Float64Array(L).fill(c ? -0.02 : 0.03);
    for (const p of parts) for (let i = 0; i < L; i++) x[i] += p.a * Math.sin(p.w * i + p.ph);
    mix.set(x, c * L);
  }
  return { mix, L };
}

export function fakeSong({ seed = 1, bpm = 100, bpb = 4, drift = 'steady', freeIntro = 0, sr = 44100, form = SONG_FORM, tuning = 0, pickup = false } = {}) {
  const R = rng(seed * 2654435761 + 12345);
  const key = { root: R.int(0, 11), minor: R() < 0.5 };
  const progs = key.minor ? PROGS_MINOR : PROGS_MAJOR;
  const pv = R.int(0, progs.length - 1);
  let pc = (pv + 1 + R.int(0, progs.length - 2)) % progs.length;
  let pb = (pc + 1 + R.int(0, progs.length - 3)) % progs.length;
  if (pb === pv) pb = (pb + 1) % progs.length;
  if (pc === pb) pc = (pc + 1) % progs.length;
  const PROG = { Intro: progs[pv], Verse: progs[pv], Chorus: progs[pc], Bridge: progs[pb], Outro: progs[pc] };
  // two chords a bar in a chorus at a slow tempo (a change on the half bar), one a bar otherwise
  const halfBars = bpm < 95 && bpb === 4;

  /* ---------------------------------------------------------------- the clock: beat times */
  const bars = form.reduce((a, [, n]) => a + n, 0);
  const nPick = pickup ? 1 : 0, nBeats = bars * bpb + nPick + 1;
  const start = freeIntro + (pickup ? 0.25 : 0.4);
  const beats = [start];
  let wander = 0;
  for (let i = 1; i < nBeats; i++) {
    let tempo = bpm;
    if (drift === 'live') { wander += (R() - 0.5) * 0.004; wander *= 0.985; tempo = bpm * (1 + 0.015 * Math.sin((2 * Math.PI * i) / 48 + seed) + wander); }
    else if (drift === 'ramp') tempo = bpm * (1 + (0.05 * i) / nBeats);
    beats.push(beats[i - 1] + 60 / tempo);
  }
  const at = (beat) => { const i = Math.max(0, Math.min(nBeats - 2, Math.floor(beat))); return beats[i] + (beat - i) * (beats[i + 1] - beats[i]); };
  const end = beats[nBeats - 1] + 2.5;
  const N = Math.ceil(end * sr);
  const drums = new Float32Array(N), bass = new Float32Array(N), other = new Float32Array(N), vocals = new Float32Array(N);
  const jit = () => (drift === 'live' ? (R() - 0.5) * 0.006 : 0);
  const tune = Math.pow(2, tuning / 1200);
  const hz = (m) => 440 * tune * Math.pow(2, (m - 69) / 12);

  /* ---------------------------------------------------------------- voices */
  let ns = (seed * 9301 + 49297) >>> 0;
  const noise = () => { ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; return ns / 2147483648 - 1; };
  const kick = (t, g) => {
    const s0 = Math.round(t * sr), n = Math.round(0.28 * sr);
    let ph = 0;
    for (let k = 0; k < n && s0 + k < N; k++) {
      const tt = k / sr, f = 48 + 90 * Math.exp(-tt / 0.03);
      ph += (2 * Math.PI * f) / sr;
      drums[s0 + k] += g * (Math.sin(ph) * Math.exp(-tt / 0.11) * Math.min(1, k / 24) + (k < 90 ? 0.25 * noise() * (1 - k / 90) : 0));
    }
  };
  const snare = (t, g) => {
    const s0 = Math.round(t * sr), n = Math.round(0.2 * sr);
    let lp = 0, ph = 0;
    for (let k = 0; k < n && s0 + k < N; k++) {
      const tt = k / sr, w = noise();
      lp += (w - lp) * 0.35;
      ph += (2 * Math.PI * 190) / sr;
      drums[s0 + k] += g * Math.min(1, k / 12) * (0.55 * (w - 0.6 * lp) * Math.exp(-tt / 0.06) + 0.5 * Math.sin(ph) * Math.exp(-tt / 0.05));
    }
  };
  const hat = (t, g, open = false) => {
    const s0 = Math.round(t * sr), n = Math.round((open ? 0.25 : 0.06) * sr);
    let lp = 0;
    for (let k = 0; k < n && s0 + k < N; k++) {
      const w = noise();
      lp += (w - lp) * 0.6;
      drums[s0 + k] += g * (w - lp) * Math.exp(-(k / sr) / (open ? 0.08 : 0.015)) * Math.min(1, k / 8);
    }
  };
  // a tone of a few harmonics, by recurrence (sin((n+1)w) = 2cos(w) sin(nw) - sin((n-1)w))
  const tone = (buf, t0, t1, f, g, { harm = [1, 0.5, 0.33, 0.25], att = 0.01, rel = 0.05, decay = 0, vib = 0 } = {}) => {
    const s0 = Math.max(0, Math.round(t0 * sr)), s1 = Math.min(N, Math.round((t1 + rel) * sr)), len = s1 - s0;
    if (len <= 0) return;
    const env = new Float64Array(len), held = (t1 - t0) * sr;
    for (let k = 0; k < len; k++) {
      let e = Math.min(1, k / (att * sr));
      if (decay) e *= Math.exp(-k / (decay * sr));
      if (k > held) e *= Math.max(0, 1 - (k - held) / (rel * sr));
      env[k] = e * g;
    }
    harm.forEach((a, h) => {
      const fh = f * (h + 1);
      if (fh > sr * 0.45 || !a) return;
      if (vib) {
        let ph = 0;
        for (let k = 0; k < len; k++) { ph += (2 * Math.PI * fh * (1 + vib * Math.sin((2 * Math.PI * 5.5 * k) / sr))) / sr; buf[s0 + k] += a * env[k] * Math.sin(ph); }
        return;
      }
      const w = (2 * Math.PI * fh) / sr, c2 = 2 * Math.cos(w);
      let y1 = 0, y2 = -Math.sin(w);   // sin(0), sin(-w)
      for (let k = 0; k < len; k++) { buf[s0 + k] += a * env[k] * y1; const y = c2 * y1 - y2; y2 = y1; y1 = y; }
    });
  };
  // a closed voicing of the chord between G3 and F#4, its root an octave under
  const voicing = (ch) => {
    const pcs = [ch.root, (ch.root + (ch.minor ? 3 : 4)) % 12, (ch.root + 7) % 12];
    return pcs.map((p) => 55 + ((p - 7 + 12) % 12));
  };

  /* ---------------------------------------------------------------- the song */
  const truth = { bpm, bpb, beats: beats.slice(0, nBeats - 1), downbeats: [], chords: [], sections: [], free: freeIntro > 0 ? [[0, start - 0.05]] : [], key };
  if (freeIntro > 0) {
    truth.sections.push({ name: 'Free', t0: 0, t1: start });
    // a cappella in free time: notes of 0.3..0.9 s on the tonic triad, breaths between
    let t = 0.3;
    while (t < freeIntro - 0.5) {
      const d = 0.3 + R() * 0.6, deg = R.pick([0, 2, 4, 2, 0, 4]);
      const m = 60 + key.root + (key.minor ? MINOR : MAJOR)[deg] - (key.root > 6 ? 12 : 0);
      tone(vocals, t, Math.min(t + d, freeIntro - 0.2), hz(m), 0.22, { harm: [1, 0.35, 0.15], att: 0.06, rel: 0.08, vib: 0.004 });
      t += d + 0.12 + R() * 0.25;
    }
  }
  if (pickup) snare(at(0) + jit(), 0.5);
  let bar = 0;
  for (const [name, len] of form) {
    const b0 = nPick + bar * bpb, t0 = at(b0), t1 = at(b0 + len * bpb);
    truth.sections.push({ name, t0, t1 });
    const prog = PROG[name] || PROG.Verse;
    const loud = name === 'Chorus' ? 1.25 : name === 'Intro' || name === 'Outro' ? 0.55 : 1;
    const edge = name === 'Intro' || name === 'Outro';
    for (let k = 0; k < len; k++) {
      const bb = b0 + k * bpb;
      truth.downbeats.push(at(bb));
      // chords: one a bar, or two in a slow chorus
      const per = halfBars && name === 'Chorus' ? 2 : 1;
      for (let h = 0; h < per; h++) {
        const ch = chordOf(key, prog[(k * per + h) % 4]);
        const ca = bb + (h * bpb) / per, cb = bb + ((h + 1) * bpb) / per;
        const last = truth.chords[truth.chords.length - 1];
        if (last && last.root === ch.root && last.minor === ch.minor && Math.abs(last.t1 - at(ca)) < 1e-9) last.t1 = at(cb);
        else truth.chords.push({ t0: at(ca), t1: at(cb), root: ch.root, minor: ch.minor });
        const vs = voicing(ch);
        if (edge) { for (let q = 0; q < bpb / per; q++) for (const m of vs) tone(other, at(ca + q), at(ca + q) + 0.18, hz(m), 0.09 * loud, { att: 0.004, decay: 0.12, rel: 0.05 }); }
        else for (const m of vs) tone(other, at(ca), at(cb) - 0.02, hz(m), (name === 'Chorus' ? 0.085 : 0.07), { harm: name === 'Chorus' ? [1, 0.6, 0.45, 0.3, 0.2] : [1, 0.4, 0.2, 0.1], att: 0.02, rel: 0.04 });
        // the bass: the root on every beat (8ths in the chorus), from E1 up
        const rootM = 28 + ((ch.root - 4 + 12) % 12);
        if (name !== 'Intro') {
          const step = name === 'Chorus' ? 0.5 : 1;
          for (let q = 0; q < bpb / per; q += step) tone(bass, at(ca + q) + jit(), at(ca + q + step) - 0.03, hz(rootM), (edge ? 0.25 : 0.32) * loud, { harm: [1, 0.5, 0.2], att: 0.005, rel: 0.03 });
        }
      }
      // drums
      for (let q = 0; q < bpb; q++) {
        const tb = at(bb + q);
        if (name === 'Intro') { hat(tb + jit(), 0.12); continue; }
        if (bpb === 4) {
          if (q === 0 || (q === 2 && name !== 'Bridge')) kick(tb + jit(), 0.9 * loud);
          if (q === 1 || q === 3) snare(tb + jit(), (name === 'Outro' ? 0 : 0.6) * loud);
        } else {
          if (q === 0) kick(tb + jit(), 0.9 * loud);
          else if (name !== 'Outro') snare(tb + jit(), 0.32 * loud);
        }
        if (name !== 'Outro') { hat(tb + jit(), 0.14 * loud, name === 'Chorus' && q === bpb - 1); hat(at(bb + q + 0.5) + jit(), 0.09 * loud); }
      }
      // the line: two-bar phrases on chord tones, the second bar of each pair answered
      if (name !== 'Intro' && name !== 'Outro' && k % 2 === 0) {
        const ch = chordOf(key, prog[k % 4]);
        const vs = voicing(ch).map((m) => m + 12);
        for (let q = 0; q < bpb + 1; q++) {
          const m = vs[(q + k) % 3] - (q === bpb ? 12 : 0);
          tone(vocals, at(bb + q) + 0.02, at(bb + q + 0.85), hz(m), 0.16 * (name === 'Chorus' ? 1.2 : 1), { harm: [1, 0.35, 0.15], att: 0.03, rel: 0.06, vib: 0.004 });
        }
      }
    }
    bar += len;
  }
  const mix = new Float32Array(N);
  for (let i = 0; i < N; i++) mix[i] = 0.55 * (drums[i] + bass[i] + other[i] + vocals[i]);
  return { sr, stems: { drums, bass, other, vocals }, mix, truth };
}
