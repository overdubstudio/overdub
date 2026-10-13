// The tempo map [tempomap]: a song's grid bent to a recording (core/music.js "The tempo map", docs/ARCHITECTURE.md).
//   1. Node: the normaliser keeps a good map, drops a bad one whole (with a warning) and never repairs one; the shared
//      conversions round-trip to 1e-9 s; without a map every conversion is the old expression; tempo is the map's
//      nominal tempo and project.set { tempo } is refused on a mapped song; tempo.map undoes and redoes exactly;
//      time.insert / time.remove carry the map with the recording; section.duplicate over a mapped span is refused;
//      shiftMap moves the grid with its recording; the MIDI export writes a tempo per segment that reads back within a
//      tick; the DAWproject export writes the map as tempo automation; a constant map renders bit for bit as the same
//      song without one; the flip:tempo-map golden scene's drum hits land on the recording's clicks.
//   2. Chromium (QUIET: muted): the browser's offline render of flip:tempo-map against the Node one; a constant map
//      against no map; the live transport's notes on a map, across segment boundaries, a loop wrap and a seek.
//   node tools/tempomap-test.js
import { open, tally } from './pw.js';
import { createStore } from '../app/src/core/store.js';
import { cleanProject, createProject, LIMITS } from '../app/src/core/project.js';
import { applyOp } from '../app/src/core/ops.js';
import { beatToSec, secToBeat, tempoAt, timeline, mapNominal, mapInsert, mapRemove, shiftMap, mapSec, checkAnchors, MAP_ANCHORS } from '../app/src/core/music.js';
import { gridClock } from '../app/src/engine/clock.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { encodeMidi } from '../app/src/ui/export.js';
import { parseSmf } from '../app/src/input/importers.js';
import { dawprojectXml } from '../app/src/core/dawproject.js';
import { tempoMapScene, mapAnchors, CLICK_KERNEL } from './golden-scenes.js';

const T = tally('tempomap');
const ok = T.ok;
const clone = (x) => JSON.parse(JSON.stringify(x));
const canon = (p) => JSON.stringify({ ...p, meta: null });
const A = mapAnchors();   // 8 bars drifting 92 -> 96 BPM
const MAP = { anchors: A, clip: 'c_record' };

/* ------------------------------------------------------------------ the normaliser (R1) */
{
  const warns = [];
  const good = cleanProject({ ...createProject(), tempoMap: clone(MAP) }, { warn: (w) => warns.push(w) });
  ok(JSON.stringify(good.tempoMap) === JSON.stringify(MAP) && !warns.length, 'a good map is kept exactly, with its clip');
  ok(good.tempo === mapNominal(A) && good.tempo > 93 && good.tempo < 95, `tempo is the map's nominal tempo, the median segment's to 0.01 (${good.tempo})`);
  const bad = {
    'a first anchor that isn\'t { 0, 0 }': [{ beat: 0, sec: 0.1 }, { beat: 4, sec: 2.5 }],
    'beats that fall back': [{ beat: 0, sec: 0 }, { beat: 4, sec: 2.5 }, { beat: 3, sec: 3 }],
    'seconds that stand still': [{ beat: 0, sec: 0 }, { beat: 4, sec: 2.5 }, { beat: 8, sec: 2.5 }],
    'a segment at 600 BPM': [{ beat: 0, sec: 0 }, { beat: 4, sec: 0.4 }],
    'a segment at 10 BPM': [{ beat: 0, sec: 0 }, { beat: 1, sec: 6 }],
    'a NaN': [{ beat: 0, sec: 0 }, { beat: NaN, sec: 2 }],
    'one anchor': [{ beat: 0, sec: 0 }],
    'too many anchors': Array.from({ length: MAP_ANCHORS + 1 }, (_, i) => ({ beat: i, sec: i * 0.5 })),
  };
  for (const [what, anchors] of Object.entries(bad)) {
    const w = [];
    const p = cleanProject({ ...createProject({ tempo: 101 }), tempoMap: { anchors } }, { warn: (x) => w.push(x) });
    ok(!('tempoMap' in p) && p.tempo === 101 && w.length === 1 && /tempo map was dropped/.test(w[0].message), `a map with ${what} is dropped whole, with a warning, and the song keeps its tempo (${w[0] && w[0].message.slice(0, 90)})`);
  }
  ok(!('tempoMap' in cleanProject({ ...createProject(), tempoMap: 'x' }, { warn: () => {} })), 'a map that isn\'t an object is dropped');
  ok(!('tempoMap' in cleanProject(createProject())), 'a song without a map gets none');
  ok(LIMITS.anchors === 4096 && checkAnchors(Array.from({ length: 4096 }, (_, i) => ({ beat: i, sec: i * 0.5 }))) === null, 'LIMITS.anchors is 4,096, and a map of 4,096 anchors is kept');
}

/* ------------------------------------------------------------------ the conversions (R3) */
{
  const p = cleanProject({ ...createProject(), tempoMap: clone(MAP) });
  let worst = 0;
  for (let b = -3; b < 40; b += 0.37) worst = Math.max(worst, Math.abs(secToBeat(p, beatToSec(p, b)) - b) * 60 / tempoAt(p, b));
  for (let s = 0; s < 25; s += 0.29) worst = Math.max(worst, Math.abs(beatToSec(p, secToBeat(p, s)) - s));
  ok(worst < 1e-9, `beat -> seconds -> beat and back round-trip within 1e-9 s, before, inside and past the map (worst ${worst.toExponential(1)} s)`);
  ok(A.every((a) => beatToSec(p, a.beat) === a.sec), 'every anchor\'s beat is exactly its seconds');
  ok(Math.abs(tempoAt(p, 1) - 92) < 1e-9 && Math.abs(tempoAt(p, 31) - 96) < 1e-9 && Math.abs(tempoAt(p, 100) - 96) < 1e-9, `tempoAt is each segment's tempo (bar 1 ${tempoAt(p, 1).toFixed(3)}, bar 8 ${tempoAt(p, 31).toFixed(3)}, past the map ${tempoAt(p, 100).toFixed(3)})`);
  const plain = createProject({ tempo: 92 });
  const tl = timeline(plain, 3), spb = 60 / 92;
  const same = [0, 3, 4.25, 17.3, 100].every((b) => tl.sec(b) === (b - 3) * spb) && [0, 0.4, 7.7].every((s) => tl.beat(s) === 3 + s / spb);
  ok(same && !tl.mapped && beatToSec(plain, 8) === (8 * 60) / 92 && secToBeat(plain, 3) === (3 * 92) / 60, 'without a map the timeline is the renders\' own expressions ((b - from) * spb, from + s / spb), bit for bit');
  ok(beatToSec(4, 120) === 2 && secToBeat(2, 120) === 4, 'the old two-number forms still work');
  // kernels' clock: bpm() is the segment's tempo, the grid the map's
  let now = 0;
  const c = { get currentTime() { return now; } };
  const clock = gridClock(c, { bpm: 92, beatsPerBar: 4, from: 0, playing: true, timeline: timeline(p, 0) });
  now = A[3].sec + 0.01;
  const bpm3 = clock.bpm(), bar3 = clock.barAt(now);
  now = A[6].sec + 0.01;
  ok(Math.abs(bpm3 - tempoAt(p, 13)) < 1e-9 && Math.abs(clock.bpm() - tempoAt(p, 25)) < 1e-9 && Math.abs(bar3 - (3 + secToBeat(p, A[3].sec + 0.01) / 4 - 3)) < 1e-9, `gridClock on a map: bpm() is the segment's tempo (${bpm3.toFixed(3)}, then ${clock.bpm().toFixed(3)}) and bar lines fall on the anchors`);
  const segs = clock.segments();
  ok(segs.length === A.length - 1 && segs.every((g, i) => g.time === A[i].sec && Math.abs(g.bpm - (60 * (A[i + 1].beat - A[i].beat)) / (A[i + 1].sec - A[i].sec)) < 1e-9), `the clock hands the kernels ${segs.length} segments, each at its anchor's seconds with its own tempo`);
  ok(Math.abs(tempoAt(p, 4) - segs[1].bpm) < 1e-12, 'a beat on an anchor is in the segment that starts there');
}

/* ------------------------------------------------------------------ nominal tempo, project.set, tempo.map (R5, R6) */
{
  const s = createStore(cleanProject(createProject({ tempo: 120 })));
  const before = canon(s.get());
  let r = s.dispatch([{ type: 'tempo.map', map: clone(MAP) }], { by: 'overdub', label: 'map' });
  ok(r.ok && s.get().tempo === mapNominal(A) && JSON.stringify(s.get().tempoMap.anchors) === JSON.stringify(A), `tempo.map sets the map, and the tempo becomes its nominal ${s.get().tempo}`);
  const mapped = canon(s.get());
  s.dispatch([{ type: 'track.add', ref: 'o', track: { name: 'Original', kind: 'audio', instrument: null } }, { type: 'clip.add', track: '$o', clip: { id: 'c_record', kind: 'audio', start: 0, length: 32, asset: 'a_x', offset: 0, name: 'Original' } }], { by: 'you' });
  r = s.dispatch([{ type: 'project.set', patch: { tempo: 100 } }], { by: 'claude' });
  ok(!r.ok && /The grid follows Original\. Clear the map to set a tempo\./.test(r.error), `project.set { tempo } on a mapped song is refused: "${r.error}"`);
  s.undo();
  ok(canon(s.get()) === mapped, 'undo of the clip: the mapped song');
  s.undo();
  ok(canon(s.get()) === before, 'undo of tempo.map gives back the song before it, tempo and all');
  s.redo();
  ok(canon(s.get()) === mapped, 'redo gives the mapped song again');
  r = s.dispatch([{ type: 'tempo.map', map: null }], { by: 'you' });
  ok(r.ok && !('tempoMap' in s.get()) && s.get().tempo === mapNominal(A), 'tempo.map null clears it; the grid plays on at the nominal tempo');
  s.undo();
  ok(canon(s.get()) === mapped, 'and its undo puts the map back exactly');
  r = s.dispatch([{ type: 'tempo.map', map: { anchors: [{ beat: 0, sec: 0 }, { beat: 4, sec: 0.1 }] } }], { by: 'claude' });
  ok(!r.ok && /20\.\.400/.test(r.error), `a bad map is refused, not repaired (${r.error && r.error.slice(0, 80)})`);
  // the op on its own: apply, invert, apply
  const p = cleanProject(createProject({ tempo: 110 }));
  const p0 = canon(p);
  const inv = applyOp(p, { type: 'tempo.map', map: clone(MAP) }, { by: 'claude', refs: {} }).inverse;
  const p1 = canon(p);
  for (const o of inv) applyOp(p, o, { by: 'claude', refs: {} });
  const back = canon(p);
  applyOp(p, { type: 'tempo.map', map: clone(MAP) }, { by: 'claude', refs: {} });
  ok(back === p0 && canon(p) === p1, 'apply, invert, apply again: the same song each time');
}

/* ------------------------------------------------------------------ time.insert / time.remove / section.duplicate (R7) */
{
  const song = () => {
    const s = createStore(cleanProject(createProject({ tempo: 120 })));
    s.dispatch([
      { type: 'track.add', ref: 'o', track: { name: 'Original', kind: 'audio', instrument: null } },
      { type: 'clip.add', track: '$o', clip: { id: 'c_record', kind: 'audio', start: 0, length: 32, asset: 'a_x', offset: 0, name: 'Original' } },
      { type: 'section.add', section: { name: 'Verse', start: 0, length: 16 } },
      { type: 'section.add', section: { name: 'Coda', start: 40, length: 8 } },
      { type: 'tempo.map', map: clone(MAP) },
    ], { by: 'you' });
    return s;
  };
  // where a moment of the recording (seconds into its file) sits on the grid, from the song as it is
  const recSec = (p, beat) => { for (const t of p.tracks) for (const c of t.clips) if (beat >= c.start - 1e-9 && beat <= c.start + c.length + 1e-9 && c.asset === 'a_x') return c.offset + beatToSec(p, beat) - beatToSec(p, c.start); return null; };
  const s = song(), p0 = clone(s.get());
  let r = s.dispatch([{ type: 'time.insert', at: 10, length: 4 }], { by: 'you' });
  const p = s.get();
  ok(r.ok, 'time.insert at beat 10 on a mapped song');
  const before = [0, 3, 9.5].every((b) => Math.abs(beatToSec(p, b) - beatToSec(p0, b)) < 1e-12);
  const after = [10, 12, 20, 31].every((b) => Math.abs(beatToSec(p, b + 4) - (beatToSec(p0, b) + 4 * 60 / tempoAt(p0, 10))) < 1e-9);
  ok(before && after, 'the grid before the point is untouched; after it, every beat moved by 4 beats and the seconds the map gives 4 beats at the point');
  // the recording: its right half moved 4 beats; each moment of it is still on the beat it was
  const drift = [12, 20, 30].map((b) => Math.abs(recSec(p, b + 4) - recSec(p0, b)));
  // (within the 0.1 ms a clip offset is rounded to: arrangement.js r4)
  ok(drift.every((d) => d < 1e-4), `the recording after the point stays on its beats (worst ${(Math.max(...drift) * 1e3).toFixed(3)} ms, the offset's rounding)`);
  s.undo();
  ok(canon(s.get()) === canon(p0), 'undo puts the map (and everything) back');
  r = s.dispatch([{ type: 'time.remove', at: 8, length: 4 }], { by: 'you' });
  const q = s.get();
  const kept = [0, 5, 7.9].every((b) => Math.abs(beatToSec(q, b) - beatToSec(p0, b)) < 1e-12);
  const closed = [12, 16, 25, 31].every((b) => Math.abs(beatToSec(q, b - 4) - (beatToSec(p0, b) - (beatToSec(p0, 12) - beatToSec(p0, 8)))) < 1e-9);
  const dr = [13, 20, 30].map((b) => Math.abs(recSec(q, b - 4) - recSec(p0, b)));
  ok(r.ok && kept && closed && dr.every((d) => d < 1e-4), `time.remove closes the map up with the recording (anchors inside go; the rest move back by 4 beats and their seconds; worst ${(Math.max(...dr) * 1e3).toFixed(3)} ms)`);
  ok(checkAnchors(q.tempoMap.anchors) === null && Math.abs(tempoAt(q, 9) - tempoAt(p0, 13)) < 1e-9, 'the map is still a good one, and the grid after the cut keeps its tempo');
  s.undo();
  r = s.dispatch([{ type: 'section.duplicate', section: 'Verse' }], { by: 'claude' });
  ok(!r.ok && /This part follows a recording; copying it would break the grid/.test(r.error), `section.duplicate over the mapped span is refused: "${r.error}"`);
  r = s.dispatch([{ type: 'section.duplicate', section: 'Coda' }], { by: 'claude' });
  ok(r.ok, 'a section past the map duplicates as before');
  // past the map: nothing to move
  const pm = clone(s.get().tempoMap);
  s.dispatch([{ type: 'time.insert', at: 60, length: 4 }], { by: 'you' });
  ok(JSON.stringify(s.get().tempoMap) === JSON.stringify(pm), 'time inserted past the last anchor leaves the map alone');
}

/* ------------------------------------------------------------------ shiftMap (R8: the helper) */
{
  const p0 = { tempoMap: MAP };
  const later = { tempoMap: shiftMap(MAP, 8) }, spb0 = A[1].sec / 4;
  const moved = [0, 4, 13, 31].every((b) => Math.abs(beatToSec(later, b + 8) - (beatToSec(p0, b) + 8 * spb0)) < 1e-9);
  const back = shiftMap(later.tempoMap, -8);
  const same = back.anchors.length === A.length && back.anchors.every((a, i) => Math.abs(a.beat - A[i].beat) < 1e-12 && Math.abs(a.sec - A[i].sec) < 1e-9);
  ok(moved && checkAnchors(later.tempoMap.anchors) === null, 'shiftMap(map, 2 bars) moves every bar line 2 bars later, with the recording\'s seconds');
  ok(same && back.clip === 'c_record', 'shiftMap back by 2 bars gives the map it was (within 1e-9 s)');
  ok(mapInsert(MAP, 40, 4).anchors.length === A.length && mapRemove(MAP, 40, 4).anchors.length === A.length, 'insert or remove past the map changes nothing');
}

/* ------------------------------------------------------------------ MIDI and DAWproject (R9) */
{
  const p = cleanProject({ ...createProject({ title: 'Map' }), tempoMap: clone(MAP) });
  p.tracks.push({ ...p.tracks[0], id: 't_k', name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys', params: {} }, clips: [{ id: 'c_k', kind: 'notes', start: 0, length: 32, notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8 }] }] });
  const ppq = 480;
  const smf = parseSmf(encodeMidi(p, { ppq }));
  const tempos = smf.tempos;
  let worstTicks = 0, sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    if (i) sec += ((tempos[i].beat - tempos[i - 1].beat) * tempos[i - 1].us) / 1e6;
    const want = mapSec(A, tempos[i].beat);
    worstTicks = Math.max(worstTicks, (Math.abs(sec - want) / (60 / tempoAt(p, tempos[i].beat))) * ppq);
  }
  ok(tempos.length === A.length && tempos.every((t, i) => Math.abs(t.beat - A[i].beat) < 1e-9), `the MIDI file has one tempo event per segment (the last runs on past the map), at each anchor's beat (${tempos.length})`);
  ok(worstTicks < 1, `read back by importers.js, every anchor's time is within a tick (worst ${worstTicks.toFixed(3)} ticks)`);
  const plain = parseSmf(encodeMidi(cleanProject(createProject({ tempo: 97 }))));
  ok(plain.tempos.length === 1 && Math.abs(plain.tempo - 97) < 0.01, 'a song without a map still writes its one tempo');
  const x = dawprojectXml(p, { audio: {} });
  const pts = x.project.match(/<RealPoint [^>]*interpolation="hold"/g) || [];
  ok(/<TempoAutomation[^>]*unit="bpm"/.test(x.project) && pts.length === A.length - 1, `the DAWproject export writes the map as tempo automation (${pts.length} held points)`);
  const tid = /<Tempo id="(id\d+)"/.exec(x.project);
  ok(tid && new RegExp(`<Target parameter="${tid[1]}"`).test(x.project), 'its points target the transport\'s tempo');
  ok(!/TempoAutomation/.test(dawprojectXml(createProject(), {}).project), 'a song without a map has no tempo automation');
}

/* ------------------------------------------------------------------ renders (R2, R3, R4) in Node */
const scene = tempoMapScene();
function constantPair() {
  // the scene's song at one tempo: once plain, once with a map that says the same tempo at every bar
  const plain = clone(scene.project);
  delete plain.tempoMap;
  plain.tempo = 96;
  const mapped = clone(plain);
  mapped.tempoMap = { anchors: Array.from({ length: 9 }, (_, k) => ({ beat: 4 * k, sec: (4 * k * 60) / 96 })) };
  return { plain, mapped };
}
{
  const { plain, mapped } = constantPair();
  const a = renderSong(plain, { ...scene.opts, assets: scene.assets }), b = renderSong(mapped, { ...scene.opts, assets: scene.assets });
  ok(a.length === b.length && sha256(a) === sha256(b), `a constant map renders bit for bit as the same song without one (Node, ${sha256(a).slice(0, 12)})`);
  const c = renderSong(plain, { from: 5, to: 30, assets: scene.assets }), d = renderSong(mapped, { from: 5, to: 30, assets: scene.assets });
  ok(sha256(c) === sha256(d), 'and from mid-song too (from beat 5)');
  const r = renderSong(scene.project, { ...scene.opts, assets: scene.assets, tracks: ['Drums'] });
  const L = r.channels[0];
  let worst = 0;
  for (const f of scene.clicks) { let g = Math.max(0, f - 8); while (g < L.length && Math.abs(L[g]) < 0.2) g++; worst = Math.max(worst, Math.abs(g - f)); }
  ok(!r.warnings.length && worst <= 1, `flip:tempo-map: every one of ${scene.clicks.length} drum hits lands within a sample of its click on the 92 -> 96 BPM recording (worst ${worst})`);
  const flat = clone(scene.project); delete flat.tempoMap; flat.tempo = 94;
  const off = renderSong(flat, { ...scene.opts, assets: scene.assets, tracks: ['Drums'] }).channels[0];
  let late = 0;
  for (const f of scene.clicks) { let g = Math.max(0, f - 20000); while (g < off.length && Math.abs(off[g]) < 0.2) g++; late = Math.max(late, Math.abs(g - f)); }
  ok(late > 1000, `without the map the same hits drift off the clicks (by up to ${(late / 48).toFixed(0)} ms)`);
}

/* ------------------------------------------------------------------ Chromium */
const { page, errors, close } = await open('/tools/engine-test.html');
try {
  const b64 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
  const unb64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const browserRender = (project, opts) => page.evaluate(async ({ project, opts, assets }) => {
    const { renderProject } = await import('/app/src/engine/render.js');
    const { cleanProject } = await import('/app/src/core/project.js');
    const reg = await import('/app/src/devices/registry.js');
    for (const d of Object.values(project.devices || {})) reg.defineDevice({ ...d, source: 'project' }, { replace: true });
    const dec = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };
    const bufs = {};
    for (const [k, a] of Object.entries(assets)) {
      const ch = a.channels.map(dec);
      const ab = new AudioBuffer({ length: ch[0].length, numberOfChannels: ch.length, sampleRate: a.sr });
      ch.forEach((c, i) => ab.copyToChannel(c, i));
      bufs[k] = ab;
    }
    const report = [];
    const buf = await renderProject(cleanProject(project), { ...opts, assets: { get: async (id) => bufs[id] || null }, report: (e) => report.push(e) });
    const enc = (f) => { const u = new Uint8Array(f.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    return { report, len: buf.length, ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))] };
  }, { project, opts, assets: Object.fromEntries(Object.entries(scene.assets).map(([k, a]) => [k, { sr: a.sr, channels: a.channels.map(b64) }])) });
  const compare = (out, r) => {
    let diff = 0, worst = 0;
    const ch = out.ch.map(unb64);
    for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(ch[c].length, r.channels[c].length); i++) { const d = Math.abs(ch[c][i] - r.channels[c][i]); if (d) { diff++; worst = Math.max(worst, d); } }
    return { diff, worst, db: worst ? 20 * Math.log10(worst) : -Infinity, len: out.len === r.length, ch };
  };
  {
    const node = renderSong(scene.project, { ...scene.opts, assets: scene.assets });
    const out = await browserRender(scene.project, scene.opts);
    const c = compare(out, node);
    ok(c.len && !out.report.length && c.db <= -90, `flip:tempo-map in Chromium against Node: ${c.diff ? `${c.diff} samples differ, at most ${c.db.toFixed(1)} dBFS` : 'bit-identical'}`);
    const drums = await browserRender(scene.project, { ...scene.opts, tracks: ['t_drums'] });
    const nd = renderSong(scene.project, { ...scene.opts, assets: scene.assets, tracks: ['t_drums'] });
    const cd = compare(drums, nd);
    ok(cd.len && cd.diff === 0, `its drum part (a kernel on the map) is bit-identical in Chromium and Node${cd.diff ? ` (${cd.diff} samples differ)` : ''}`);
    let worst = 0;
    const L = cd.ch[0];
    for (const f of scene.clicks) { let g = Math.max(0, f - 8); while (g < L.length && Math.abs(L[g]) < 0.2) g++; worst = Math.max(worst, Math.abs(g - f)); }
    ok(worst <= 1, `in Chromium every drum hit lands within a sample of its click too (worst ${worst})`);
  }
  {
    const { plain, mapped } = constantPair();
    const a = await browserRender(plain, scene.opts), b = await browserRender(mapped, scene.opts);
    ok(a.len === b.len && a.ch[0] === b.ch[0] && a.ch[1] === b.ch[1], 'a constant map renders bit for bit as no map in Chromium too');
  }
  // live: the transport on a map. Short segments (one beat each, 150..260 BPM) so a few seconds cross many of them,
  // then a loop that wraps across them, then a seek into the middle of one
  const live = await page.evaluate(async ({ kernel }) => {
    const E = await import('/app/src/engine/engine.js');
    const S = await import('/app/src/core/store.js');
    const R = await import('/app/src/devices/registry.js');
    R.defineDevice({ ...kernel, source: 'project' }, { replace: true });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const anchors = [{ beat: 0, sec: 0 }];
    for (let k = 0; k < 16; k++) anchors.push({ beat: k + 1, sec: anchors[k].sec + 60 / [150, 260, 180, 220, 200, 240, 170, 250][k % 8] });
    const notes = [];
    for (let i = 0; i < 64; i++) notes.push({ id: 'n' + i, p: 60 + (i % 4), t: i / 4, d: 0.1, v: 0.8 });
    const song = (loop) => ({ format: 'overdub/0', id: 'p_map', title: 'map', tempo: 200, meter: [4, 4], key: null, loop, tempoMap: { anchors }, sections: [], assets: {}, master: { gain: 0, inserts: [] }, meta: {},
      devices: { [kernel.id]: kernel },
      tracks: [{ id: 't_a', name: 'A', kind: 'instrument', instrument: { device: kernel.id, params: {} }, inserts: [], clips: [{ id: 'c_a', kind: 'notes', start: 0, length: 16, notes }], gain: 0, pan: 0, mute: false, solo: false }] });
    const run = async (loop, from, secs, seekTo = null) => {
      const store = S.createStore(song(loop));
      const engine = E.createEngine(store);
      await engine.start();
      await engine.settled();
      const inst = engine.instance('t_a', 'instrument');
      const ons = [];
      const on0 = inst.noteOn;
      inst.noteOn = (p, v, t, x) => { ons.push(t); return on0.call(inst, p, v, t, x); };
      await engine.play(from);
      const c0 = engine.ctx.currentTime, w0 = performance.now();
      let sought = null;
      while (engine.ctx.currentTime < c0 + secs && performance.now() - w0 < 15000) {
        await sleep(10);
        if (seekTo != null && sought == null && engine.ctx.currentTime > c0 + secs / 2) { sought = ons.length; engine.seek(seekTo); }
      }
      const beat = engine.beat, bpm = engine.clock.bpm();
      engine.stop();
      await engine.dispose();
      return { ons, sought, beat, bpm };
    };
    return {
      straight: await run({ on: false, start: 0, end: 16 }, 0, 2.2),
      loop: await run({ on: true, start: 1.5, end: 4.5 }, 1.5, 3.2),
      seek: await run({ on: false, start: 0, end: 16 }, 0, 2.4, 6.3),
      anchors,
    };
  }, { kernel: CLICK_KERNEL });
  const LA = live.anchors, at = (b) => mapSec(LA, b);
  const steps = (ons, beats) => ons.slice(1).map((t, i) => Math.abs((t - ons[i]) - (at(beats[i + 1]) - at(beats[i]))));
  {
    const n = live.straight.ons.length, beats = Array.from({ length: n }, (_, i) => i / 4);
    const err = steps(live.straight.ons, beats);
    ok(n >= 12 && Math.max(...err) < 1.5 / 48000, `live: ${n} notes on a map of one-beat segments (150..260 BPM) land where the map says, across ${Math.floor(beats[n - 1])} segment boundaries (worst ${(Math.max(...err) * 1e6).toFixed(1)} µs)`);
  }
  {
    // the loop: 1.5 .. 4.5, wrapping back; the beats it plays are 1.5, 1.75, ... 4.25, then 1.5 again
    const pass = Array.from({ length: 12 }, (_, i) => 1.5 + i / 4);
    const n = live.loop.ons.length, beats = Array.from({ length: n }, (_, i) => pass[i % 12]);
    const err = live.loop.ons.slice(1).map((t, i) => {
      const a = beats[i], b = beats[i + 1];
      const want = b > a ? at(b) - at(a) : at(4.5) - at(a) + (at(b) - at(1.5));
      return Math.abs(t - live.loop.ons[i] - want);
    });
    ok(n > 12 && Math.max(...err) < 1.5 / 48000, `live: a loop across map segments wraps sample-accurately (${n} notes, ${Math.floor(n / 12)} wraps, worst ${(Math.max(...err) * 1e6).toFixed(1)} µs)`);
  }
  {
    const s = live.seek, after = s.ons.slice(s.sought);
    // after the seek to 6.3: the note at 6.25 still sounding there is chased (it starts at 6.3), then 6.5, 6.75, ...
    const beats = Array.from({ length: after.length }, (_, i) => (i ? 6.25 + i / 4 : 6.3));
    const err = steps(after, beats);
    ok(s.sought != null && after.length >= 4 && Math.max(...err) < 1.5 / 48000, `live: after a seek into the middle of a segment the notes follow the map (${after.length} notes, the held one chased, worst ${(Math.max(...err) * 1e6).toFixed(1)} µs)`);
    ok(Math.abs(s.bpm - 60 / (at(Math.floor(s.beat) + 1) - at(Math.floor(s.beat)))) < 1e-6, `the live clock's bpm() is the segment's tempo where the song is (${s.bpm.toFixed(2)} at beat ${s.beat.toFixed(2)})`);
  }
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally { await close(); }
T.done();
