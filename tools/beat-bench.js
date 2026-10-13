// BeatBench: how well the analysis behind Flip a song (app/src/audio/analyze/) hears a record: its beats, its tempo,
// where the 1 is, the map, the chords and the sections. Seeded synthetic songs whose answers are known
// (tools/fake-song.js, re-exported by tools/fake-wav.js): drifting, steady and live tempos from 70 to 150 BPM, 4/4 and
// 3/4, some with a free a cappella intro, some tuned off A440. The hum-bench pattern.
//
//   node tools/beat-bench.js                 the set (16 songs), a table and the gates (spec 0014 R18)
//   node tools/beat-bench.js --n 6 --json    fewer songs; one JSON line of the totals
//   node tools/beat-bench.js --list          each song: what it is, and how it scored
//   node tools/beat-bench.js --dir <folder>  your own records, read locally: <name>.wav (PCM or float), and where
//                                            there is one, <name>.beats (a beat time in seconds a line, "1" after it
//                                            on a downbeat). Prints scores only; the audio never leaves the folder,
//                                            and no real record is ever committed. Gates nothing.
//
// Scoring:
//   beat F-measure     a found beat matches a true one within ±70 ms, one to one (the MIREX window)
//   tempo              a reading within 4% of the song's median tempo: among the readings, and first
//   downbeat           the found map's bar lines within 70 ms of the true ones, on 90% of them
//   map                the found grid's beat lines against the true beats, median ms, outside free spans
//   chords             the share of the song's chord time named right (root, and major or minor; a 7 is major)
//   sections           section boundaries within one bar, F-measure
// The gates (R18): beats >= 0.95; the right tempo among the readings on every song and first on >= 90%; downbeats
// right on >= 90%; the map <= 15 ms (median); chords >= 85%; sections >= 80%; a 3-minute song in under 3 s (the
// Worker figure is analyze-test's; this prints Node's).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeSong } from './fake-wav.js';
import { analyze } from '../app/src/audio/analyze/index.js';
import { mapBeat, mapSec } from '../app/src/core/music.js';

export const GATES = { beatF: 0.95, tempoAmong: 1, tempoFirst: 0.9, downbeat: 0.9, mapMs: 15, chords: 0.85, sections: 0.8, secsFor3Min: 3 };

export function benchSpec(idx, { seed = 1 } = {}) {
  const bpm = 70 + ((idx * 37 + seed * 11) % 81);
  return {
    seed: seed * 1000 + idx,
    bpm,
    bpb: idx % 5 === 3 ? 3 : 4,
    drift: ['steady', 'live', 'ramp'][idx % 3],
    freeIntro: idx % 4 === 1 ? 5 + (idx % 3) : 0,
    pickup: idx % 6 === 2,
    tuning: [0, -15, 10, 0, 20, -25][idx % 6],
    sr: [44100, 48000, 22050][idx % 3],
  };
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

function fMeasure(est, ref, tol) {
  const used = new Uint8Array(est.length);
  let hit = 0, j = 0;
  for (const r of ref) {
    while (j < est.length && est[j] < r - tol) j++;
    let best = -1, bd = tol;
    for (let k = j; k < est.length && est[k] <= r + tol; k++) if (!used[k] && Math.abs(est[k] - r) <= bd) { bd = Math.abs(est[k] - r); best = k; }
    if (best >= 0) { used[best] = 1; hit++; }
  }
  const P = est.length ? hit / est.length : 0, R = ref.length ? hit / ref.length : 0;
  return P + R ? (2 * P * R) / (P + R) : 0;
}

const truthTempo = (t) => { const d = []; for (let i = 1; i < t.beats.length; i++) d.push(t.beats[i] - t.beats[i - 1]); return 60 / median(d); };
const near = (a, b, tol = 0.04) => Math.abs(a / b - 1) <= tol;

// one song's scores against its truth
export function scoreSong(res, truth) {
  const out = {};
  out.beatF = fMeasure(res.beats, truth.beats, 0.07);
  const tt = truthTempo(truth);
  const rights = res.readings.filter((r) => near(r.tempo, tt) && r.bpb === truth.bpb);
  out.tempoAmong = rights.length > 0;
  out.tempoFirst = !!res.readings[0] && near(res.readings[0].tempo, tt) && res.readings[0].bpb === truth.bpb;
  const R = res.readings[0];
  // the found map's bar lines: each anchor (past { 0, 0 }) in recording seconds
  if (R && out.tempoFirst) {
    const bars = R.anchors.slice(1).map((a) => a.sec - R.off);
    const ok = bars.filter((b) => truth.downbeats.some((d) => Math.abs(d - b) <= 0.07)).length;
    out.downbeat = bars.length ? ok / bars.length >= 0.9 : false;
  } else out.downbeat = false;
  const M = rights.find((r) => r.id === 'found') || rights[0];
  if (M) {
    const errs = [];
    for (let i = 0; i < truth.beats.length; i++) {
      const t = truth.beats[i];
      if (truth.free.some(([a, b]) => t >= a && t <= b)) continue;
      const b = mapBeat(M.anchors, M.off + t), nb = Math.round(b), spb = mapSec(M.anchors, nb + 1) - mapSec(M.anchors, nb);
      errs.push(Math.abs(b - nb) * spb * 1000);
    }
    out.mapMs = median(errs);
  } else out.mapMs = Infinity;
  // chords, sampled at 20 Hz over the true chord time
  let right = 0, all = 0;
  for (const c of truth.chords) {
    for (let t = c.t0 + 0.025; t < c.t1; t += 0.05) {
      all++;
      const e = res.chords.find((x) => t >= x.t0 && t < x.t1);
      if (e && e.root === c.root && (e.quality === 'm') === c.minor && e.quality !== '5') right++;
    }
  }
  out.chords = all ? right / all : 1;
  // sections: true boundaries (past the start) against found ones, within a bar there
  const ref = truth.sections.slice(1).map((s) => s.t0), est = res.sections.slice(1).map((s) => s.t0);
  const barAt = (t) => { const i = Math.max(1, truth.beats.findIndex((b) => b >= t)); return truth.bpb * ((truth.beats[i] ?? t + 0.5) - (truth.beats[i - 1] ?? t)); };
  {
    const used = new Uint8Array(est.length);
    let hit = 0;
    for (const r of ref) { const tol = barAt(r); let best = -1, bd = tol; est.forEach((e, k) => { if (!used[k] && Math.abs(e - r) <= bd) { bd = Math.abs(e - r); best = k; } }); if (best >= 0) { used[best] = 1; hit++; } }
    const P = est.length ? hit / est.length : 0, Rr = ref.length ? hit / ref.length : 1;
    out.sections = P + Rr ? (2 * P * Rr) / (P + Rr) : 0;
  }
  out.tempo = res.tempo; out.trueTempo = Math.round(tt * 100) / 100;
  return out;
}

export function totals(rows) {
  const n = rows.length, mean = (k) => rows.reduce((a, r) => a + r.s[k], 0) / n, share = (k) => rows.filter((r) => r.s[k]).length / n;
  return {
    songs: n,
    beatF: mean('beatF'),
    tempoAmong: share('tempoAmong'),
    tempoFirst: share('tempoFirst'),
    downbeat: share('downbeat'),
    mapMs: median(rows.map((r) => r.s.mapMs)),
    chords: mean('chords'),
    sections: mean('sections'),
    msPerMin: median(rows.map((r) => r.ms / (r.dur / 60))),
  };
}

export function passes(T) {
  return {
    beatF: T.beatF >= GATES.beatF,
    tempoAmong: T.tempoAmong >= GATES.tempoAmong,
    tempoFirst: T.tempoFirst >= GATES.tempoFirst,
    downbeat: T.downbeat >= GATES.downbeat,
    mapMs: T.mapMs <= GATES.mapMs,
    chords: T.chords >= GATES.chords,
    sections: T.sections >= GATES.sections,
  };
}

export function runBench({ n = 16, seed = 1, on = null } = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const spec = benchSpec(i, { seed });
    const song = fakeSong(spec);
    const t0 = performance.now();
    const res = analyze({ sr: song.sr, mix: song.mix });
    const ms = performance.now() - t0;
    const row = { i, spec, ms, dur: song.mix.length / song.sr, s: scoreSong(res, song.truth), res, truth: song.truth };
    rows.push(row);
    if (on) on(row);
  }
  return { rows, totals: totals(rows) };
}

/* ------------------------------------------------------------------ your own records (--dir) */
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let p = 12, fmt = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4), body = p + 8;
    if (id === 'fmt ') {
      const tag = buf.readUInt16LE(body);
      // (WAVE_FORMAT_EXTENSIBLE names the real format in its sub-format GUID's first two bytes)
      fmt = { tag: tag === 0xfffe && size >= 26 ? buf.readUInt16LE(body + 24) : tag, ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    }
    if (id === 'data' && fmt) {
      const bps = fmt.bits / 8, frames = Math.floor(Math.min(size, buf.length - body) / (bps * fmt.ch));
      const chans = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
      const isFloat = fmt.tag === 3;
      for (let f = 0; f < frames; f++) for (let c = 0; c < fmt.ch; c++) {
        const o = body + (f * fmt.ch + c) * bps;
        chans[c][f] = isFloat ? buf.readFloatLE(o) : fmt.bits === 16 ? buf.readInt16LE(o) / 32768 : fmt.bits === 24 ? buf.readIntLE(o, 3) / 8388608 : fmt.bits === 32 ? buf.readInt32LE(o) / 2147483648 : (buf.readUInt8(o) - 128) / 128;
      }
      return { sr: fmt.sr, channels: chans };
    }
    p = body + size + (size & 1);
  }
  throw new Error('no audio in this WAV file');
}

function benchDir(dir) {
  const files = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort();
  if (!files.length) { console.log(`no .wav files in ${dir}`); return; }
  console.log('record'.padEnd(32) + 'tempo  readings                 beatF   map ms  bars');
  for (const f of files) {
    const w = readWav(fs.readFileSync(path.join(dir, f)));
    const res = analyze({ sr: w.sr, mix: w.channels });
    const ann = path.join(dir, f.replace(/\.wav$/i, '.beats'));
    let line = `${f.slice(0, 31).padEnd(32)}${String(res.tempo).padEnd(7)}${res.readings.map((r) => r.id[0] + Math.round(r.tempo)).join(' ').padEnd(25)}`;
    if (fs.existsSync(ann)) {
      const rows = fs.readFileSync(ann, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((r) => r[0] && Number.isFinite(+r[0]));
      const beats = rows.map((r) => +r[0]), downs = rows.filter((r) => r[1] === '1').map((r) => +r[0]);
      const s = scoreSong(res, { beats, downbeats: downs, bpb: res.bpb, free: [], chords: [], sections: [{ t0: 0 }] });
      line += `${s.beatF.toFixed(3).padEnd(8)}${(Number.isFinite(s.mapMs) ? s.mapMs.toFixed(1) : '-').padEnd(8)}${downs.length ? (s.downbeat ? 'right' : 'off') : '-'}`;
    }
    console.log(line);
  }
}

/* ------------------------------------------------------------------ the command line */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const has = (k) => process.argv.includes(k);
  if (has('--dir')) benchDir(arg('--dir'));
  else {
    const n = Number(arg('--n', 16)), seed = Number(arg('--seed', 1));
    const list = has('--list');
    const { totals: T } = runBench({ n, seed, on: list ? (r) => {
      const sp = r.spec;
      console.log(`${String(r.i).padStart(2)} ${String(sp.bpm).padStart(3)} BPM ${sp.bpb}/4 ${sp.drift.padEnd(6)} ${sp.freeIntro ? 'free ' + sp.freeIntro + 's' : '       '} ${sp.tuning ? (sp.tuning > 0 ? '+' : '') + sp.tuning + 'c' : '   '}  found ${String(r.s.tempo).padEnd(6)} ${r.res.readings.map((x) => x.id).join(',').padEnd(34)} F ${r.s.beatF.toFixed(3)} 1 ${r.s.downbeat ? 'ok ' : 'off'} map ${r.s.mapMs.toFixed(1).padStart(5)} ms chords ${(100 * r.s.chords).toFixed(0).padStart(3)}% sections ${(100 * r.s.sections).toFixed(0).padStart(3)}%  ${(r.ms / 1000).toFixed(2)} s for ${r.dur.toFixed(0)} s${r.res.sure ? '' : '  unsure: ' + r.res.why.join(', ')}`);
    } : null });
    const P = passes(T);
    if (has('--json')) console.log(JSON.stringify(T));
    else {
      const pct = (x) => (100 * x).toFixed(1) + '%';
      console.log(`\n${T.songs} songs (seed ${seed})`);
      console.log(`  beat F-measure       ${T.beatF.toFixed(3)}   gate >= ${GATES.beatF}   ${P.beatF ? 'pass' : 'FAIL'}`);
      console.log(`  tempo among readings ${pct(T.tempoAmong).padEnd(7)} gate every song ${P.tempoAmong ? 'pass' : 'FAIL'}`);
      console.log(`  tempo first          ${pct(T.tempoFirst).padEnd(7)} gate >= 90%     ${P.tempoFirst ? 'pass' : 'FAIL'}`);
      console.log(`  downbeat right       ${pct(T.downbeat).padEnd(7)} gate >= 90%     ${P.downbeat ? 'pass' : 'FAIL'}`);
      console.log(`  map, median          ${T.mapMs.toFixed(1)} ms  gate <= 15 ms    ${P.mapMs ? 'pass' : 'FAIL'}`);
      console.log(`  chords (maj/min)     ${pct(T.chords).padEnd(7)} gate >= 85%     ${P.chords ? 'pass' : 'FAIL'}`);
      console.log(`  section boundaries   ${pct(T.sections).padEnd(7)} gate >= 80%     ${P.sections ? 'pass' : 'FAIL'}`);
      console.log(`  speed (Node)         ${(T.msPerMin / 1000).toFixed(2)} s an audio minute (median)`);
    }
  }
}
