// The analysis behind Flip a song (spec 0014 section B, R11-R16): from a recording to its beats, a tempo map in the
// song's own format (core/music.js "The tempo map"), the other readings, the tuning, the key, the chords and the
// sections. The chores, done once on import; the song keeps only the conclusions (toOps.js), so a later analyser
// never changes an old song. Pure JS, zero dependencies, deterministic (Float64, fixed order, no Math.random): the same
// input gives byte-identical JSON in Node and in a Worker (worker.js; client.js runs it there, with the cache).
//
//   analyze({ sr, mix?, stems?: { vocals?, drums?, bass?, other? } }, { onProgress?(stage) }) -> result
//     mix and each stem: a Float32Array (mono) or an array of channels. The beat is read from the drum stem, else the
//     non-vocal stems summed, else the mix; the vocal alone only when nothing else exists, and then every result is
//     low confidence. The harmony from the bass and other stems, else the mix; the sections from the mix (else every
//     stem summed). Everything runs at 22,050 Hz (resample.js); chroma at 11,025 Hz.
//   stages: 'beat' (the onset envelope, the tempogram, beats, downbeats, the map, tuning and chroma), 'key', then
//     'sections' (the sections, then the key and the chords, which lean on where the sections start)
//
//   result = { version: ANALYZER_VERSION, input: 'drums' | 'stems' | 'mix' | 'vocals', lowConfidence, duration (s),
//     sure (false: show the readings), why: [...] (what made it unsure), bpb, tempo (the found reading's nominal),
//     beats: [s], free: [[t0, t1]] (s), downbeat: { margin }, tuning (cents), readings: [{ id: 'found' | 'double' |
//     'half' | 'downbeat' | 'twothirds', why, tempo, bpb, start, off, firstDownbeat, anchors }], key: { root, scale,
//     name, confidence } | null, chords: [{ start, end (found reading's beats), t0, t1, root, quality, name, pcs }],
//     sections: [{ name, start, length (beats), t0, t1, key? }] }
// Times in the result are seconds into the recording; beats are song beats on the found reading's grid.
import { downmix, resample } from './resample.js';
import { onsetEnvelope } from './onset.js';
import { tempogram } from './tempo.js';
import { trackBeats, refineBeats, smoothBeats, freeOf } from './beats.js';
import { chromaOf } from './chroma.js';
import { downbeatsOf } from './downbeats.js';
import { readingsOf } from './map.js';
import { keyFromChroma, checkKey, tonicKey, sectionKey } from './key.js';
import { chordsOf } from './chords.js';
import { sectionsOf } from './sections.js';

export const ANALYZER_VERSION = 1;
export const ANALYSIS_SR = 22050;
// unsure of the tempo when the half or double tempo scores this close to the found one (tempo.js rival)
export const RIVAL = 0.85;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

const mono = (x) => (x == null ? null : downmix(x));
function sum(list) {
  const xs = list.filter(Boolean);
  if (!xs.length) return null;
  const n = Math.max(...xs.map((x) => x.length)), out = new Float64Array(n);
  for (const x of xs) for (let i = 0; i < x.length; i++) out[i] += x[i];
  return out;
}

// Which signal each part of the analysis reads (R11's order).
export function pickInput({ mix, stems = {} }) {
  const s = { vocals: mono(stems.vocals), drums: mono(stems.drums), bass: mono(stems.bass), other: mono(stems.other) };
  const m = mono(mix);
  const band = sum([s.drums, s.bass, s.other]);
  let rhythm, from;
  if (s.drums) { rhythm = s.drums; from = 'drums'; }
  else if (band) { rhythm = band; from = 'stems'; }
  else if (m) { rhythm = m; from = 'mix'; }
  else if (s.vocals) { rhythm = s.vocals; from = 'vocals'; }
  else throw new Error('analyze needs a mix or at least one stem');
  const harmony = sum([s.bass, s.other]) || m || band || s.vocals;
  const whole = m || sum([s.vocals, s.drums, s.bass, s.other]);
  return { rhythm, harmony, whole, vocal: s.vocals, from, lowConfidence: from === 'vocals' };
}

export function analyze(input, { onProgress = null } = {}) {
  const sr = Number(input.sr);
  if (!(sr >= 3000 && sr <= 768000)) throw new Error('analyze needs { sr } between 3,000 and 768,000');
  const pick = pickInput(input);
  const to22 = (x) => (x ? resample(x, sr, ANALYSIS_SR) : null);
  const progress = (st) => { if (onProgress) onProgress(st); };
  const duration = pick.rhythm.length / sr;
  const why = [];

  progress('beat');
  const xr = to22(pick.rhythm);
  const ons = onsetEnvelope(xr, ANALYSIS_SR);
  const tg = tempogram(ons.env, ons.fps);
  const raw = trackBeats(ons.env, ons.fps, tg);
  const refined = refineBeats(raw, xr, ANALYSIS_SR, ons.fps);
  const { keep, free } = freeOf(refined, ons.env, ons.fps, tg, duration);
  const kept = refined.filter((_, i) => keep[i]);
  const beats = smoothBeats(kept);
  const xh = pick.harmony === pick.rhythm ? xr : to22(pick.harmony);
  const chroma = chromaOf(xh, ANALYSIS_SR);
  const db = downbeatsOf(beats, { bands: ons.bands, fps: ons.fps, chroma });
  const readings = readingsOf({ times: beats, cum: db.cum, bpb: db.bpb, phase: db.phase, alt: db.alt, tg });
  const found = readings[0] || null;

  progress('key');
  let key = null, chords = [], secs = [];
  if (found) {
    const g = chroma.treble.sum(0, duration), b = chroma.bass.sum(0, duration), gc = new Float64Array(12);
    let mt = 0, mb = 0;
    for (let p = 0; p < 12; p++) { mt = Math.max(mt, g[p]); mb = Math.max(mb, b[p]); }
    for (let p = 0; p < 12; p++) gc[p] = (mt > 0 ? g[p] / mt : 0) + (mb > 0 ? (0.5 * b[p]) / mb : 0);
    const xw = pick.whole === pick.rhythm ? xr : pick.whole === pick.harmony ? xh : to22(pick.whole);
    const mel = xw === xr ? ons : onsetEnvelope(xw, ANALYSIS_SR);
    const xv = pick.vocal ? (pick.vocal === pick.rhythm ? xr : to22(pick.vocal)) : null;
    progress('sections');
    secs = sectionsOf(found, { chroma, mel: mel.mel, fps: mel.fps, x: xw, sr: ANALYSIS_SR, end: duration, vocal: xv });
    key = keyFromChroma(gc);
    chords = chordsOf(found, chroma, { end: duration, key });
    let checked = checkKey(key, chords);
    checked = tonicKey(checked, chords, { starts: secs.map((s) => s.t0), bass: b });
    if (checked && key && checked.name !== key.name) chords = chordsOf(found, chroma, { end: duration, key: checked });
    key = checked;
  }
  const sections = secs.map((s) => {
    const k = key && s.length >= 4 * found.bpb ? sectionKey(s.chroma, key) : null;
    return { name: s.name, start: s.start, length: s.length, t0: s.t0, t1: s.t1, ...(k ? { key: k } : {}) };
  });

  // sure: the readings agree and the evidence is clear; otherwise the person is shown them (R27)
  if (pick.lowConfidence) why.push('the vocal alone');
  if (!found) why.push('no pulse');
  if (db.margin < 0.15) why.push('the 1 is unclear');
  if (tg.rival.double >= RIVAL || tg.rival.half >= RIVAL) why.push('the tempo could be half or double');
  const freeTime = free.reduce((a, [x, y]) => a + (y - x), 0);
  if (freeTime > duration / 2) why.push('mostly free time');
  return {
    version: ANALYZER_VERSION,
    input: pick.from,
    lowConfidence: pick.lowConfidence,
    duration: r4(duration),
    sure: !why.length,
    why,
    bpb: db.bpb,
    tempo: found ? found.tempo : null,
    beats: beats.map(r6),
    free: free.map(([a, b]) => [r4(a), r4(b)]),
    downbeat: { margin: r4(db.margin) },
    tuning: chroma.tuning,
    readings,
    key: key ? { root: key.root, scale: key.scale, name: key.name, confidence: key.confidence } : null,
    chords,
    sections,
  };
}
