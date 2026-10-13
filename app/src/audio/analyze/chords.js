// Chords from audio (spec 0014 R15): the beat-synchronous treble and bass chroma pooled to half bars (a bar in 3/4)
// through a reading's map, then core/jam.js's recogniser (chordViterbi: the same candidate scoring and smoothing the
// Jam room reads notes with), limited to major, minor, power and dominant seventh chords. A window's chroma: the treble
// and half the bass, each scaled to its loudest class, with a fifth of the loudest taken off (a harmonic's leak is not
// a chord tone); its bass the loudest bass class. A window far quieter than the song's usual is no chord.
//
//   chordsOf(reading, chroma, { end (s), key }) -> [{ start, end (song beats), t0, t1 (recording s), root, quality,
//       name, pcs }]
// Pure.
import { chordViterbi } from '../../core/jam.js';
import { mapSec, spellPc } from '../../core/music.js';

export const AUDIO_QUALITIES = ['', 'm', '5', '7'];
const FLOOR = 0.2;
const IV = { '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7], 7: [0, 4, 7, 10] };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

export function windowsOf(reading, end) {
  const { anchors, off, bpb } = reading;
  const offs = bpb === 4 ? [0, 2] : [0];
  const lastBeat = (() => { let b = 0; while (mapSec(anchors, b) - off < end) b += bpb; return b; })();
  const out = [];
  for (let bar = 0; bar * bpb < lastBeat; bar++) {
    for (let i = 0; i < offs.length; i++) {
      const a = bar * bpb + offs[i], b = bar * bpb + (i + 1 < offs.length ? offs[i + 1] : bpb);
      const t0 = mapSec(anchors, a) - off, t1 = mapSec(anchors, b) - off;
      if (t1 <= 0) continue;
      out.push({ a, b, t0: Math.max(0, t0), t1: Math.min(end, t1), first: i === 0, bar });
    }
  }
  return out;
}

export function chordsOf(reading, chroma, { end, key }) {
  const W = windowsOf(reading, end);
  const energy = W.map((w) => { const t = chroma.treble.sum(w.t0, w.t1); let s = 0; for (const v of t) s += v; return s / Math.max(1e-6, w.t1 - w.t0); });
  const pos = energy.filter((e) => e > 0).sort((a, b) => a - b), med = pos.length ? pos[pos.length >> 1] : 0;
  const win = W.map((w, i) => {
    const tre = chroma.treble.sum(w.t0, w.t1), bas = chroma.bass.sum(w.t0, w.t1);
    let mt = 0, mb = 0, sb = 0;
    for (let p = 0; p < 12; p++) { mt = Math.max(mt, tre[p]); mb = Math.max(mb, bas[p]); sb += bas[p]; }
    const c = new Array(12).fill(0);
    if (energy[i] < 0.05 * med || mt <= 0) return { ...w, chroma: c, bass: -1, total: 0 };
    let mc = 0;
    for (let p = 0; p < 12; p++) { c[p] = tre[p] / mt + (mb > 0 ? (0.5 * bas[p]) / mb : 0); mc = Math.max(mc, c[p]); }
    let total = 0;
    for (let p = 0; p < 12; p++) { c[p] = Math.max(0, c[p] - FLOOR * mc); total += c[p]; }
    let bass = -1;
    if (mb > 0 && sb > 0) for (let p = 0; p < 12; p++) if (bas[p] === mb) { bass = p; break; }
    return { ...w, chroma: c, bass, total };
  });
  const keyPcs = new Set(key ? keyPcsOf(key) : []);
  const { path, cands, NC } = chordViterbi(win, { keyPcs, qualities: AUDIO_QUALITIES });
  const out = [];
  for (let i = 0; i < win.length; i++) {
    const s = path[i], last = out[out.length - 1];
    if (s === NC) continue;
    if (last && last.state === s && Math.abs(last.end - win[i].a) < 1e-9) { last.end = win[i].b; last.t1 = win[i].t1; continue; }
    out.push({ state: s, start: win[i].a, end: win[i].b, t0: win[i].t0, t1: win[i].t1 });
  }
  const spellKey = key ? { root: key.root, scale: key.scale } : null;
  return out.map((sp) => {
    const C = cands[sp.state];
    return { start: r4(sp.start), end: r4(sp.end), t0: r6(sp.t0), t1: r6(sp.t1), root: C.root, quality: C.q, name: spellPc(C.root, spellKey) + C.q, pcs: IV[C.q].map((i) => (C.root + i) % 12) };
  });
}

function keyPcsOf(key) {
  const sc = key.scale === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return sc.map((i) => (key.pc + i) % 12);
}
