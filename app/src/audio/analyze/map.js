// From beats to a tempo map (spec 0014 R13, R14, and the placement rule in its Design). A reading is a list of beat
// times (seconds into the recording) with their counts c (whole beats; c = 0 is the first downbeat, a pickup's beats
// count below 0, a gap counts the beats it would hold). Its map has one anchor a downbeat; free spans hold none, so the
// grid runs straight between the anchors either side.
//
// Placement: with the first downbeat at recording time d and the first bar's seconds a beat s, the recording starts at
// song beat bpb·k − d/s (offset 0: nothing is cut), k the smallest whole number ≥ 1 that keeps that at or after beat
// 0. The map's first segment, from { beat 0, sec 0 }, runs at the first bar's tempo, so the bar lines are right
// before the music starts.
//
//   mapOf(times, counts, bpb) -> { start (beats), off (song seconds of recording time 0), firstDownbeat (s), tempo
//       (nominal), anchors: [{ beat, sec }] } | null
//   readingsOf({ times, cum, bpb, phase, alt, tg }) -> [{ id, why, ...mapOf }]   found first; then double, half, the
//       other downbeat and (when the tempogram has a pulse in threes) two thirds. Each a complete map.
// Pure.
import { checkAnchors, mapNominal } from '../../core/music.js';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const mod = (a, b) => ((a % b) + b) % b;

export function mapOf(times, counts, bpb) {
  const n = times.length;
  const dbs = [];
  for (let i = 0; i < n; i++) if (counts[i] >= 0 && mod(counts[i], bpb) === 0) dbs.push(i);
  if (!dbs.length) return null;
  const i0 = dbs[0], d = times[i0];
  let s;
  const i1 = dbs.find((i) => counts[i] > counts[i0]);
  if (i1 != null) s = (times[i1] - d) / (counts[i1] - counts[i0]);
  else {
    const ds = [];
    for (let i = 1; i < n; i++) if (counts[i] - counts[i - 1] === 1) ds.push(times[i] - times[i - 1]);
    ds.sort((a, b) => a - b);
    s = ds.length ? ds[ds.length >> 1] : 0.5;
  }
  if (!(s > 0)) return null;
  const k = Math.max(1, Math.ceil(d / s / bpb - 1e-9));
  const start = bpb * k - d / s, off = start * s;
  const anchors = [{ beat: 0, sec: 0 }];
  for (const i of dbs) {
    const a = { beat: bpb * k + (counts[i] - counts[i0]), sec: r6(off + times[i]) }, prev = anchors[anchors.length - 1];
    if (!(a.beat > prev.beat && a.sec > prev.sec)) continue;
    const bpm = (60 * (a.beat - prev.beat)) / (a.sec - prev.sec);
    if (bpm < 20 || bpm > 400) continue;
    anchors.push(a);
  }
  if (anchors.length < 2) anchors.push({ beat: bpb * k, sec: r6(bpb * k * s) });
  if (anchors.length > 4096) anchors.length = 4096;
  if (checkAnchors(anchors)) return null;
  return { start: r6(start), off: r6(off), firstDownbeat: r6(d), tempo: mapNominal(anchors), bpb, anchors };
}

const WHY_SHIFT = (k, bpb) => (k === 1 ? 'The 1 is a beat later' : k === bpb - 1 ? 'The 1 is a beat earlier' : `The 1 is ${k} beats later`);

export function readingsOf({ times, cum, bpb, phase, alt, tg }) {
  const counts = (ph) => {
    const i0 = cum.findIndex((c) => mod(c - ph, bpb) === 0);
    if (i0 < 0) return null;
    return cum.map((c) => c - cum[i0]);
  };
  const out = [];
  const found = counts(phase);
  if (!found) return out;
  const add = (id, why, t, c) => { const m = mapOf(t, c, bpb); if (m) out.push({ id, why, ...m }); };
  add('found', "The recording's own tempo", times, found);
  // double: a beat between each two
  {
    const t = [], c = [];
    for (let i = 0; i < times.length; i++) {
      t.push(times[i]); c.push(2 * found[i]);
      if (i + 1 < times.length && found[i + 1] - found[i] === 1) { t.push((times[i] + times[i + 1]) / 2); c.push(2 * found[i] + 1); }
    }
    add('double', 'Twice as fast', t, c);
  }
  // half: every other beat, the 1 kept
  {
    const t = [], c = [];
    for (let i = 0; i < times.length; i++) if (mod(found[i], 2) === 0) { t.push(times[i]); c.push(found[i] / 2); }
    add('half', 'Half as fast', t, c);
  }
  if (alt != null) {
    const oc = counts(alt);
    if (oc) add('downbeat', WHY_SHIFT(mod(alt - phase, bpb), bpb), times, oc);
  }
  // two thirds: a beat every one and a half, where the tempogram hears threes
  if (tg && tg.octave.triplet >= 0.7) {
    const at = new Map(found.map((c, i) => [c, times[i]]));
    const t = [], c = [];
    const lo = Math.ceil(found[0] / 1.5), hi = Math.floor(found[found.length - 1] / 1.5);
    for (let j = lo; j <= hi; j++) {
      const x = 1.5 * j, a = Math.floor(x), f = x - a;
      if (!at.has(a) || (f && !at.has(a + 1))) continue;
      t.push(f ? at.get(a) + f * (at.get(a + 1) - at.get(a)) : at.get(a)); c.push(j);
    }
    add('twothirds', 'In threes: two thirds of the tempo', t, c);
  }
  return out;
}
