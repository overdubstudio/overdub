// What an analysis becomes in the song (spec 0014 R17): ops, dispatched as one step by the house ('overdub'): "Grid,
// key and sections from <song name>". The song keeps only these conclusions, never the analysis.
//
//   resultToOps(p, result, reading?, { clips }) -> ops
//     the meter (when the reading's beats a bar differ) and the key (project.set); the map (tempo.map, its clip the
//     first of clips: the conformed one); every clip of the recording placed where the reading puts it (clip.set start;
//     offset 0, so nothing is cut); the sections with their keys (section.add, when the song has none yet); the chords
//     as block chords in one notes clip on a muted track named Chords (when there is no Chords track yet)
//   readingOps(p, result, reading, { clips }) -> ops    another grid: meter, map and placement (R27: picking another
//     reading replaces the map in one step); the map keeps clipStart (where the conformed clip sits on it), each
//     audio clip's length becomes its recording's seconds on the new grid, and the sections and the Chords clip move
//     with it, so each stays at its point in the recording
//   flipSummary(result, reading?, { clip }) -> 'Grid follows Original, 68.4 BPM, drifting 66.9-70.2. Key D minor.
//     8 sections.'
// reading: a reading from result.readings, or its id ('found' when left out). clips: [{ track, clip }] (ids).
import { beatToSec, beatsPerBar, mapBeat, mapSec } from '../../core/music.js';

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const pick = (result, reading) => (reading && typeof reading === 'object' ? reading : result.readings.find((r) => r.id === (reading || 'found')) || result.readings[0]);

export function readingOps(p, result, reading, { clips = [] } = {}) {
  const R = pick(result, reading);
  if (!R) return [];
  return [...gridOps(p, R, clips), ...replaceOps(p, result, R, clips[0] && clips[0].clip)];
}

// the grid alone: meter, map and the recording's clips placed on it
function gridOps(p, R, clips) {
  const ops = [];
  if (beatsPerBar(p.meter) !== R.bpb) ops.push({ type: 'project.set', patch: { meter: [R.bpb, 4] } });
  ops.push({ type: 'tempo.map', map: { anchors: R.anchors.map((a) => ({ beat: a.beat, sec: a.sec })), ...(clips[0] ? { clip: clips[0].clip, clipStart: R.start } : {}) } });
  for (const c of clips) {
    // an audio clip lasts its seconds on the new grid (from where it now starts), so none of the recording is cut
    const len = audioBeats(p, c.clip, R);
    ops.push({ type: 'clip.set', track: c.track, clip: c.clip, patch: { start: R.start, ...(len ? { length: len } : {}) } });
  }
  return ops;
}

// The sections (with their keys) and the Chords clip follow the grid (R27): each stays at its point in the recording.
// While they are still as the flip placed them on the reading the song has now, they become what the flip places on R
// (so Back and a second pick land exactly); anything the person has changed moves by its seconds instead.
const sameAnchors = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x.beat - b[i].beat) < 1e-9 && Math.abs(x.sec - b[i].sec) < 1e-9);
const notePrint = (ns) => ns.map((n) => `${n.p}@${r4(n.t)}:${r4(n.d)}`).sort().join(' ');
function replaceOps(p, result, R, conformed) {
  const m = p && p.tempoMap;
  if (!m || !Array.isArray(m.anchors) || m.anchors.length < 2) return [];
  const prev = result.readings.find((r) => sameAnchors(r.anchors, m.anchors));
  if (prev === R) return [];
  let c0 = null;
  for (const t of p.tracks || []) for (const c of t.clips || []) if (c.id === conformed) c0 = c;
  if (!c0) return [];
  // a beat on the song's grid now -> the beat at the same point in the recording on R's grid
  const s0 = beatToSec(p, c0.start), r0 = mapSec(R.anchors, R.start);
  const move = (b) => mapBeat(R.anchors, r0 + beatToSec(p, b) - s0);
  const bar = R.bpb, ops = [];
  const secs = p.sections || [];
  if (secs.length) {
    const was = prev && sectionsFor(result, prev);
    const asPlaced = was && was.length === secs.length && was.every((s, i) => s.name === secs[i].name && s.start === secs[i].start && s.length === secs[i].length);
    let to;
    if (asPlaced) to = sectionsFor(result, R);
    else {
      let last = 0;
      to = secs.map((s) => {
        let a = Math.max(0, Math.round(move(s.start) / bar) * bar), b = Math.round(move(s.start + s.length) / bar) * bar;
        a = Math.max(a, last);
        if (b - a < bar) b = a + bar;
        last = b;
        return { start: a, length: b - a };
      });
    }
    secs.forEach((s, i) => {
      const n = to[i];
      if (n && (n.start !== s.start || n.length !== s.length)) ops.push({ type: 'section.set', section: s.id, patch: { start: n.start, length: n.length } });
    });
  }
  for (const t of p.tracks || []) {
    if (t.name !== 'Chords') continue;
    for (const c of t.clips || []) {
      if (c.kind !== 'notes' || !(c.notes && c.notes.length)) continue;
      const was = prev && c.start === 0 && chordsFor(result, prev);
      if (was && notePrint(was.notes) === notePrint(c.notes)) {
        const next = chordsFor(result, R);
        if (!next.notes.length) continue;
        ops.push({ type: 'notes.replace', track: t.id, clip: c.id, notes: next.notes });
        if (next.length !== c.length) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { length: next.length } });
        continue;
      }
      const patch = c.notes.map((n) => {
        const a = move(c.start + n.t) - c.start, b = move(c.start + n.t + n.d) - c.start;
        return { id: n.id, t: r4(Math.max(0, a)), d: r4(Math.max(1 / 16, b - Math.max(0, a))) };
      });
      ops.push({ type: 'notes.set', track: t.id, clip: c.id, notes: patch });
      const end = patch.reduce((x, n) => Math.max(x, n.t + n.d), 0), len = Math.max(bar, Math.ceil(end / bar) * bar);
      if (len > c.length) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { length: len } });
    }
  }
  return ops;
}

// the beats an audio clip's recording lasts on reading R's grid, starting where R places it (null: not an audio clip
// this song knows the length of)
function audioBeats(p, clipId, R) {
  for (const t of (p && p.tracks) || []) {
    for (const c of t.clips || []) {
      if (c.id !== clipId) continue;
      const a = c.kind === 'audio' && p.assets && p.assets[c.asset];
      const secs = a && Number.isFinite(a.duration) ? a.duration - (+c.offset || 0) : NaN;
      if (!(secs > 0)) return null;
      const s0 = mapSec(R.anchors, R.start);
      return Math.max(1 / 16, r4(mapBeat(R.anchors, s0 + secs) - R.start));
    }
  }
  return null;
}

// a time in the recording -> a beat on the reading's grid
const beatOf = (R, t) => mapBeat(R.anchors, R.off + t);

function chordNotes(ch) {
  const iv = { '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7], 7: [0, 4, 7, 10] }[ch.quality] || [0, 4, 7];
  const ps = [48 + ch.root, ...iv.map((i) => 55 + ((((ch.root + i) % 12) - 7 + 12) % 12))];
  return [...new Set(ps)].sort((a, b) => a - b);
}

// the sections the flip places on reading R: on the found grid as found; on another, their times on its bar lines
function sectionsFor(result, R) {
  const found = R.id === 'found', bar = R.bpb, out = [];
  let prev = 0;
  result.sections.forEach((s, i) => {
    let a = found ? s.start : i === 0 ? 0 : Math.round(beatOf(R, s.t0) / bar) * bar;
    let b = found ? s.start + s.length : Math.round(beatOf(R, s.t1) / bar) * bar;
    a = Math.max(a, prev);
    if (b - a < bar) b = a + bar;
    prev = b;
    out.push({ name: s.name, start: a, length: b - a, ...(s.key ? { key: s.key } : {}) });
  });
  return out;
}

// the chords the flip writes on reading R: block chords from beat 0, and the clip's length
function chordsFor(result, R) {
  const found = R.id === 'found', bar = R.bpb, notes = [];
  for (const ch of result.chords) {
    const a = found ? ch.start : Math.round(beatOf(R, ch.t0) * 2) / 2, b = found ? ch.end : Math.round(beatOf(R, ch.t1) * 2) / 2;
    if (!(b > a)) continue;
    for (const pp of chordNotes(ch)) notes.push({ p: pp, t: r4(a), d: r4(b - a), v: 0.7 });
  }
  const end = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
  return { notes, length: Math.max(bar, Math.ceil(end / bar) * bar) };
}

export function resultToOps(p, result, reading, { clips = [] } = {}) {
  const R = pick(result, reading);
  if (!R) return [];
  const ops = [];
  const grid = gridOps(p, R, clips);
  const meter = grid[0] && grid[0].type === 'project.set' ? grid.shift() : null;
  const patch = { ...(meter ? meter.patch : {}) };
  if (result.key) patch.key = { root: result.key.root, scale: result.key.scale };
  if (Object.keys(patch).length) ops.push({ type: 'project.set', patch });
  ops.push(...grid);
  // sections: on the found grid as found; on another reading, their times put on its bar lines
  if (!(p.sections && p.sections.length)) for (const sec of sectionsFor(result, R)) ops.push({ type: 'section.add', section: sec });
  // the chords: block chords, a notes clip from beat 0, on a muted track
  if (result.chords.length && !(p.tracks || []).some((t) => t.name === 'Chords')) {
    const { notes, length } = chordsFor(result, R);
    if (notes.length) ops.push({ type: 'track.add', track: { name: 'Chords', kind: 'instrument', instrument: { device: 'core.poly', params: {} }, mute: true, clips: [{ kind: 'notes', start: 0, length, name: 'Chords', notes }] } });
  }
  return ops;
}

export function flipSummary(result, reading, { clip = 'the recording' } = {}) {
  const R = pick(result, reading);
  if (!R) return 'No steady beat found: the grid is left as it was.';
  const tempos = [];
  for (let i = 1; i < R.anchors.length; i++) {
    const a = R.anchors[i - 1], b = R.anchors[i];
    if (b.beat - a.beat <= 2 * R.bpb) tempos.push((60 * (b.beat - a.beat)) / (b.sec - a.sec));
  }
  tempos.sort((x, y) => x - y);
  const lo = tempos.length ? tempos[Math.floor(tempos.length * 0.05)] : R.tempo, hi = tempos.length ? tempos[Math.ceil(tempos.length * 0.95) - 1] : R.tempo;
  const one = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const drift = hi - lo >= 0.5 ? `, drifting ${one(lo)}–${one(hi)}` : '';
  const key = result.key ? ` Key ${result.key.name}.` : '';
  const n = result.sections.length;
  return `Grid follows ${clip}, ${one(R.tempo)} BPM${drift}.${key} ${n} section${n === 1 ? '' : 's'}.`;
}
