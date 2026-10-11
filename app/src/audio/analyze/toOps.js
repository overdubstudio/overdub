// What an analysis becomes in the song (spec 0014 R17): ops, dispatched as one step by the house ('overdub'): "Grid,
// key and sections from <song name>". The song keeps only these conclusions, never the analysis.
//
//   resultToOps(p, result, reading?, { clips }) -> ops
//     the meter (when the reading's beats a bar differ) and the key (project.set); the map (tempo.map, its clip the
//     first of clips: the conformed one); every clip of the recording placed where the reading puts it (clip.set start;
//     offset 0, so nothing is cut); the sections with their keys (section.add, when the song has none yet); the chords
//     as block chords in one notes clip on a muted track named Chords (when there is no Chords track yet)
//   readingOps(p, result, reading, { clips }) -> ops    the grid alone: meter, map and placement (R27: picking another
//     reading replaces the map in one step); the map keeps clipStart (where the conformed clip sits on it), and each
//     audio clip's length becomes its recording's seconds on the new grid
//   flipSummary(result, reading?, { clip }) -> 'Grid follows Original, 68.4 BPM, drifting 66.9-70.2. Key D minor.
//     8 sections.'
// reading: a reading from result.readings, or its id ('found' when left out). clips: [{ track, clip }] (ids).
import { beatsPerBar, mapBeat, mapSec } from '../../core/music.js';

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const pick = (result, reading) => (reading && typeof reading === 'object' ? reading : result.readings.find((r) => r.id === (reading || 'found')) || result.readings[0]);

export function readingOps(p, result, reading, { clips = [] } = {}) {
  const R = pick(result, reading);
  if (!R) return [];
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

export function resultToOps(p, result, reading, { clips = [] } = {}) {
  const R = pick(result, reading);
  if (!R) return [];
  const ops = [];
  const grid = readingOps(p, result, R, { clips });
  const meter = grid[0] && grid[0].type === 'project.set' ? grid.shift() : null;
  const patch = { ...(meter ? meter.patch : {}) };
  if (result.key) patch.key = { root: result.key.root, scale: result.key.scale };
  if (Object.keys(patch).length) ops.push({ type: 'project.set', patch });
  ops.push(...grid);
  const found = R.id === 'found';
  const bar = R.bpb;
  // sections: on the found grid as found; on another reading, their times put on its bar lines
  if (!(p.sections && p.sections.length)) {
    let prev = 0;
    result.sections.forEach((s, i) => {
      let a = found ? s.start : i === 0 ? 0 : Math.round(beatOf(R, s.t0) / bar) * bar;
      let b = found ? s.start + s.length : Math.round(beatOf(R, s.t1) / bar) * bar;
      a = Math.max(a, prev);
      if (b - a < bar) b = a + bar;
      prev = b;
      ops.push({ type: 'section.add', section: { name: s.name, start: a, length: b - a, ...(s.key ? { key: s.key } : {}) } });
    });
  }
  // the chords: block chords, a notes clip from beat 0, on a muted track
  if (result.chords.length && !(p.tracks || []).some((t) => t.name === 'Chords')) {
    const notes = [];
    for (const ch of result.chords) {
      const a = found ? ch.start : Math.round(beatOf(R, ch.t0) * 2) / 2, b = found ? ch.end : Math.round(beatOf(R, ch.t1) * 2) / 2;
      if (!(b > a)) continue;
      for (const pp of chordNotes(ch)) notes.push({ p: pp, t: r4(a), d: r4(b - a), v: 0.7 });
    }
    const end = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0), length = Math.max(bar, Math.ceil(end / bar) * bar);
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
