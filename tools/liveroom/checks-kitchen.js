// The live room's checks: the kitchen table [stream D] (docs/research/LIVE-ROOM-MODE.md §11.7). Run by
// tools/liveroom-test.js (ONLY=kitchen), whose header says what a checks module exports.
//   1. the paper (Node): ChordPro and chords-over-words fixtures read into sections, lines and anchored chords;
//      format(parse(x)) is stable; capo 3 on G shapes sounds in Bb; Nashville numbers read; a chord nobody reads is
//      kept as text and plays nothing; an edited line keeps each chord on its syllable
//   2. the time (Node): the analyser on synthesized strummed takes (72-120 BPM, drifting up to 4%) reads the tempo
//      within 3%, or offers it as Twice or Half as fast; a take in free time over a fifth of it says so
//   3. the chords (Node): the paper's chords lined up with those takes, a voice 5 LU over the guitar, put each change
//      within a beat of where it was played on 90% of changes or more; a chorus played twice offers Chorus ×2; a
//      section left out is left out; nothing plays where the paper has no chord
//   4. the levels (Node, the canonical renderer; LEVELS=0 skips them): each player under the take by its LU (shaker
//      and cajón -12, bass -9, strings -14, within 1.5); the three finishes (Bare about -16 to -14 LUFS, Warm, Close
//      about -13) under -1 dBTP
//   5. the flow (muted Chromium): §2.5 end to end, 8 presses, on the room's deck with a fake input, from the door's
//      kitchen table to the send screen; the balance heard from the input; the work tape's quiet head trimmed; on
//      speakers the band is held muted for the whole take, with no count and no click
//   6. signing: an mcp:test sheet.line.set shows its byline in --ink-agent; the house's chord lines are unsigned; every
//      step's author in History
//   7. two inputs (muted Chromium, a stereo fake: a voice on 1, a guitar on 2): the option says it needs a pickup until
//      both channels move, one mic is the default; picked, a take is two takes lined up on Voice and Guitar in one step
//      by you; Again asks Both, or just the voice?, and just the voice is a pass on Voice alone over the guitar from the
//      take before. If Chromium's fake capture gives one channel, the page part is skipped and said (the plans in Node).
//      One source on both channels (the same strums on 1 and 2) moves both and the option still needs a pickup
import { parseSheet, formatSheet, soundingKey, sheetChords, setWords, pasteOps } from '../../app/src/core/liveroom/sheet-text.js';
import { readTape, alignChords, timeWords } from '../../app/src/core/liveroom/tape.js';
import { kitchenOps, planTime, planRead, planPlayer, planKitchenFinish, PLAYERS, PLAYER_ORDER, chordsTimeline, offeredKitchen, TAKE_LEVEL } from '../../app/src/core/liveroom/kitchen-plans.js';
import { LINES as KLINES } from '../../app/src/core/liveroom/lines/kitchen.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { measure } from '../../app/src/audio/measure.js';
import { checkTargets } from '../../app/src/audio/targets.js';
import { strum, voice, mix, rng, SR } from './fake.js';
import { mapBeat, mapSec } from '../../app/src/core/music.js';
import { openRoom, history } from './harness.js';

export const name = 'kitchen';
export const pages = true;

const r2 = (x) => Math.round(x * 100) / 100;

/* ------------------------------------------------------------------------------------------------ fixtures */
export const UG = `Paper Moon chords
Capo 3

[Verse 1]
G         Em
Somewhere a paper moon is hanging
C                    D
over the roofs of the town

[Chorus]
C       G
Hold on hold on
D            G
until the morning

[Verse 2]
G           Em
Something about the way
C       D
it goes

[Chorus]
C       G
Hold on hold on
D            G
until the morning

[Bridge]
Am      C
Down the stairs
D               D
out into the rain
`;
export const CHO = `{title: Paper Moon}
{key: G}
{capo: 2}
{time: 3/4}
{start_of_verse: Verse 1}
Somewhere a [G]paper [Em]moon is hanging
over the [C]roofs of the [D]town
{end_of_verse}
{start_of_chorus}
[C]Hold on, hold [G]on
{end_of_chorus}
{chorus}
{c: Bridge}
[Am]Down the [Hm7]stairs
`;

// The sounding chords of the take as played: shapes plus the capo. One chord a bar.
const VOICINGS = { Bb: [46, 50, 53, 58, 62], Gm: [43, 50, 55, 58, 62], Eb: [51, 55, 58, 63, 67], F: [41, 48, 53, 57, 60, 65], Cm: [48, 51, 55, 60, 63], 'C#m': [49, 56, 61, 64, 68] };
const SCALE = [58, 60, 62, 63, 65, 67, 69, 70, 72];
const TONES = { Bb: [58, 62, 65, 70], Gm: [62, 67, 70], Eb: [63, 67, 70], F: [60, 65, 69, 72], Cm: [60, 63, 67], 'C#m': [61, 64, 68] };
// a take: bars of sounding chords, strummed at a tempo that drifts (bar by bar, `drift` of the tempo at most, a slow
// sine), a voice singing the chords' tones and steps between them `voiceLU` over the guitar; lead seconds before
export const takeOf = (bars, { bpm = 84, drift = 0, voiceLU = 5, seed = 1, lead = 2, free = null } = {}) => {
  const R = rng(seed);
  const parts = [], vparts = [], played = [];
  let t = lead;
  bars.forEach((c, i) => {
    const tempo = bpm * (1 + drift * Math.sin((2 * Math.PI * i) / Math.max(8, bars.length)));
    // free time: the bars in [a, b) are played out of time (each beat stretched or squeezed up to 30%)
    const loose = free && i >= free[0] && i < free[1];
    const spb = 60 / tempo;
    if (loose) {
      // out of time: one chord let ring, then the next whenever it comes (1.5 to 4 s apart), as a rubato intro is played
      const len = 1.5 + 2.5 * R();
      const s = strum([{ beat: 0, notes: VOICINGS[c], beats: 1 }], { bpm: 60 / len, seed: seed * 100 + i, tail: 0, pattern: [0] });
      parts.push({ buf: s.buf, at: t });
      played.push({ chord: c, at: t, free: true });
      t += len;
      return;
    }
    const s = strum([{ beat: 0, notes: VOICINGS[c], beats: 4 }], { bpm: tempo, seed: seed * 100 + i, tail: 0 });
    parts.push({ buf: s.buf, at: t });
    const tones = TONES[c];
    const v = voice([[0.5, tones[i % tones.length], 1.4], [2.5, SCALE[(i * 3) % SCALE.length], 1.2]], { bpm: tempo, seed: seed * 7 + i, tail: 0 });
    vparts.push({ buf: v.buf, at: t });
    played.push({ chord: c, at: t });
    t += 4 * spb;
  });
  const g = mix(parts, { length: Math.ceil((t + 1) * SR) }), vo = mix(vparts, { length: Math.ceil((t + 1) * SR) });
  // the voice set voiceLU over the guitar by loudness, then the two mixed to a -14 dBFS peak
  const lg = measure({ sr: SR, channels: [g] }).lufs, lv = measure({ sr: SR, channels: [vo] }).lufs;
  const gain = Number.isFinite(lv) ? 10 ** ((lg + voiceLU - lv) / 20) : 0;
  return { buf: mix([{ buf: g, at: 0 }, { buf: vo, at: 0, gain }], { peak: -14 }), played, end: t };
};
const V = ['Bb', 'Gm', 'Eb', 'F'], C = ['Eb', 'Bb', 'F', 'Bb'], B = ['Cm', 'Eb', 'F', 'F'];
// the paper's form as played: verse, verse, chorus, chorus, bridge, chorus, chorus
const FORM = [...V, ...V, ...C, ...C, ...B, ...C, ...C];

/* ------------------------------------------------------------------------------------------------ helpers */
const ok = (r) => { if (!r.ok) throw new Error(r.error || 'dispatch refused'); return r; };
// a song at the kitchen with the paper pasted and a take on its track
function songWith(buf, paper = UG) {
  const st = createStore(createProject({ tempo: 84, title: 'Paper Moon' }), { getDevice });
  ok(st.dispatch(pasteOps(st.get(), parseSheet(paper)).ops, { by: 'you', label: 'The paper' }));
  ok(st.dispatch(kitchenOps(st.get(), { mic: 'one' }).ops, { by: 'overdub', label: 'The kitchen table' }));
  const track = st.get().room.tracks.take;
  const dur = buf.length / SR;
  const r = ok(st.dispatch([{ type: 'asset.add', asset: { id: 'tape1', kind: 'audio', name: 'take 1', sr: SR, channels: 1, duration: dur } }, { type: 'clip.add', track, ref: 'c', clip: { kind: 'audio', asset: 'tape1', start: 0, length: (dur * 84) / 60, name: 'Paper Moon · take 1 · capo 3' } }], { by: 'you', label: 'Take 1' }));
  return { st, track, clip: r.created.c };
}
// where the played changes fell on the song's beats, against where the alignment put them
function changesHit(changes, beats, played) {
  let hit = 0, total = 0;
  for (let i = 0; i < played.length; i++) {
    if (i && played[i].chord === played[i - 1].chord) continue;
    total++;
    // a change counts when the alignment changes to that chord within a beat of where it was played
    const spb = i + 1 < played.length ? (played[i + 1].at - played[i].at) / 4 : 0.7;
    if (changes.some((c) => c.sounding === played[i].chord && Math.abs(beats[c.beat] - played[i].at) <= spb + 0.02)) hit++;
  }
  return { hit, total, share: total ? hit / total : 0 };
}

/* ------------------------------------------------------------------------------------------------ the checks */
export async function run(T, ctx) {
  // (KITCHEN_ONLY=flow: the browser part alone, while working on it; KITCHEN_ONLY=two: the two inputs' alone)
  if (process.env.KITCHEN_ONLY === 'flow') { if (ctx.pages) await flow(T, ctx); return; }
  if (process.env.KITCHEN_ONLY === 'two') { if (ctx.pages) await twoFlow(T); return; }
  // 1. the paper
  {
    const ug = parseSheet(UG), cho = parseSheet(CHO);
    T.ok(ug.sections.map((s) => s.name).join(',') === 'Verse 1,Chorus,Verse 2,Bridge' && ug.capo === 3 && ug.title === 'Paper Moon', `the paper: chords over words read into ${ug.sections.length} sections, capo ${ug.capo}, each written once`);
    T.ok(ug.sections[0].lines[0].text === '[G]Somewhere [Em]a paper moon is hanging' && ug.sections[0].lines[1].text === '[C]over the roofs of the [D]town', 'the paper: each chord anchored by column to the syllable under it');
    T.ok(cho.sections.map((s) => s.name).join(',') === 'Verse 1,Chorus,Bridge' && cho.capo === 2 && cho.time?.join('/') === '3/4' && cho.key?.root === 'G', 'the paper: ChordPro read (directives, environments, {chorus} recalled once, {c: Bridge})');
    let stable = true;
    for (const src of [UG, CHO]) for (const as of ['text', 'chordpro']) {
      const a = parseSheet(src), t1 = formatSheet(a, { as, title: a.title, key: a.key }), b = parseSheet(t1);
      stable = stable && JSON.stringify(b.sections) === JSON.stringify(a.sections) && b.capo === a.capo && formatSheet(b, { as, title: b.title, key: b.key }) === t1;
    }
    T.ok(stable, 'the paper: format(parse(x)) is stable, as text and as ChordPro, both fixtures');
    const sk = soundingKey(ug, {});
    T.ok(sk?.root === 'Bb' && sk.scale === 'major', `the paper: capo 3 on G shapes sounds in ${sk?.root} ${sk?.scale} (Bb, not E)`);
    const nash = sheetChords(parseSheet('{key: G}\n[Verse]\n1 4 6- 5/7\n'), {})[0].chords.map((c) => c.chord?.name);
    T.ok(nash.join(' ') === 'G C Em D/F#', `the paper: Nashville numbers read in the key (1 4 6- 5/7 -> ${nash.join(' ')})`);
    const br = sheetChords(cho, {}).find((s) => s.name === 'Bridge');
    T.ok(br.chords[1].sym === 'Hm7' && br.chords[1].chord === null && cho.sections[2].lines[0].text.includes('[Hm7]'), 'the paper: a chord nobody reads (Hm7) is kept as written and plays nothing');
    const ed = setWords('Somewhere a [G]paper [Em]moon is hanging', 'Somewhere out there a silver moon is hanging');
    T.ok(ed === 'Somewhere out there a [G]silver [Em]moon is hanging', `the paper: an edit keeps each chord on its syllable ("${ed}")`);
  }

  // 2 and 3. the time and the chords, on synthesized takes
  const takes = [];
  for (const [bpm, drift, seed] of [[72, 0.02, 1], [84, 0.04, 2], [96, 0.03, 3], [108, 0, 4], [120, 0.04, 5]]) {
    const tk = takeOf(FORM, { bpm, drift, seed });
    const read = readTape(tk.buf, SR);
    const R = read.result.readings;
    const near = (x) => Math.abs(x - bpm) / bpm <= 0.03;
    const found = R.find((r) => r.id === 'found');
    const offered = R.find((r) => (r.id === 'double' || r.id === 'half') && near(r.tempo));
    T.ok(near(found.tempo) || !!offered, `the time: a take at ${bpm} drifting ${Math.round(drift * 100)}% reads ${r2(found.tempo)}${near(found.tempo) ? '' : `, offered as ${offered?.id} ${r2(offered?.tempo)}`}`);
    takes.push({ bpm, drift, seed, tk, read });
  }
  {
    const tk = takeOf(FORM.slice(0, 16), { bpm: 84, seed: 9, free: [3, 9] });
    const read = readTape(tk.buf, SR);
    const tw = timeWords(read.result, 'found');
    const { st, track, clip } = songWith(tk.buf);
    const t = planTime(st.get(), { take: { track, clip, read }, reading: 'found' });
    T.ok(tw && tw.free > 0.2 && t.moves, `the time: a take a third in free time says so (free ${tw ? Math.round(tw.free * 100) : '?'}% of it)`);
  }
  for (const { bpm, tk, read } of takes) {
    const sheet = parseSheet(UG);
    // the grid of the reading the musician keeps by ear: the one at the tempo they played (found, else half or double)
    const near = (x) => Math.abs(x - bpm) / bpm <= 0.03;
    const R = read.result.readings.find((r) => r.id === 'found' && near(r.tempo)) || read.result.readings.find((r) => near(r.tempo)) || read.result.readings[0];
    const s0 = mapSec(R.anchors, R.start), b0 = Math.ceil(R.start), b1 = Math.floor(mapBeat(R.anchors, s0 + read.result.duration));
    const beats = [];
    for (let b = b0; b <= b1; b++) beats.push(mapSec(R.anchors, b) - s0);
    const phase = (((-b0) % R.bpb) + R.bpb) % R.bpb;
    const ch = alignChords(read.chroma, beats, sheetChords(sheet, {}), { bpb: R.bpb, phase });
    const hit = changesHit(ch, beats, tk.played);
    T.ok(hit.share >= 0.9, `the chords: at ${bpm}, ${hit.hit} of ${hit.total} changes within a beat of where they were played (${Math.round(hit.share * 100)}%)`);
  }
  {
    // the read into the song: the chorus played twice offers Chorus ×2; the bridge left out is left out; a stretch
    // that isn't on the paper (C#m) gets no chord, and the bass rests there
    const bars = [...V, ...C, ...C, 'C#m', 'C#m', 'C#m', 'C#m', ...V, ...C];
    const tk = takeOf(bars, { bpm: 90, seed: 12, drift: 0.02 });
    const read = readTape(tk.buf, SR);
    const { st, track, clip } = songWith(tk.buf);
    const take = { track, clip, read };
    const t = planTime(st.get(), { take, reading: 'found' });
    ok(st.dispatch(t.ops, { by: 'you', label: t.label }));
    const r = planRead(st.get(), { take });
    ok(st.dispatch(r.ops, { by: 'overdub', label: r.label }));
    const p = st.get();
    const names = p.sections.map((s) => s.name);
    T.ok(r.form.some((f) => /^Chorus/.test(f.name) && f.times === 2), `the chords: a chorus played twice offers Chorus ×2 (${names.join(', ')})`);
    T.ok(r.skipped.includes('Bridge') && !names.some((n) => /^Bridge/.test(n)), `the chords: the bridge left out is left out (skipped: ${r.skipped.join(', ') || 'none'})`);
    // the bars of C#m: where they were played, in song beats
    const s0 = clip && p.tempoMap ? p.tempoMap.anchors : null;
    const tl = chordsTimeline(p);
    const csm = tk.played.findIndex((x) => x.chord === 'C#m');
    const csmEnd = tk.played.findIndex((x, i) => i > csm && x.chord !== 'C#m');
    const cs = p.tracks.find((x) => x.id === track).clips[0];
    const off = mapSec(s0, cs.start);
    const a = mapBeat(s0, off + tk.played[csm].at) + 1, b = mapBeat(s0, off + tk.played[csmEnd].at) - 1;
    const chordThere = tl.filter((s) => s.b > a && s.a < b);
    const pb = planPlayer(p, { player: 'bass', section: p.sections.map((s) => s.id) });
    ok(st.dispatch(pb.ops, { by: 'you', label: pb.label }));
    const bt = st.get().tracks.find((x) => x.id === st.get().room.tracks.kbass);
    const bassThere = (bt?.clips || []).flatMap((c) => c.notes.map((n) => c.start + n.t)).filter((x) => x > a && x < b);
    T.ok(!chordThere.length && !bassThere.length, `the chords: nothing plays where the paper has no chord (beats ${r2(a)}-${r2(b)}: ${chordThere.length} chords, ${bassThere.length} bass notes)`);
    // the read is the house's; the time was yours
    const by = st.history.map((x) => `${x.label}:${x.by}`);
    T.ok(by.some((x) => /^On the beat.*:you$/.test(x)) && by.some((x) => /^The band read take 1:overdub$/.test(x)), `signing: the time a step by you, the read the house's (${by.slice(-2).join(' · ')})`);
  }

  {
    // Count me in (§6.3): a take counted in at 84 is on the song's grid by construction. The band reads its chords on
    // that grid, and nothing reads its time (no tempo map; the take is the master at 84)
    const bars = [...V, ...C, ...V, ...C];
    const tk = takeOf(bars, { bpm: 84, seed: 41, lead: 0 });
    const read = readTape(tk.buf, SR);
    const { st, track, clip } = songWith(tk.buf);
    const take = { track, clip, read, counted: true };
    const r = planRead(st.get(), { take });
    ok(st.dispatch(r.ops, { by: 'overdub', label: r.label }));
    const p = st.get();
    const tl = chordsTimeline(p);
    let hit = 0, total = 0;
    tk.played.forEach((x, i) => {
      if (i && x.chord === tk.played[i - 1].chord) return;
      total++;
      const beat = (x.at * 84) / 60;
      if (tl.some((s) => s.chord.name === x.chord && Math.abs(s.a - beat) <= 1.01)) hit++;   // (the names as the capo spells them: Bb)
    });
    const noTime = !r.ops.some((o) => o.type === 'tempo.map') && !p.tempoMap && p.tempo === 84;
    T.ok(noTime && p.room.master === clip && p.sections[0]?.start === 0 && hit / total >= 0.9, `Count me in: a counted take keeps the song's time (no tempo map: ${noTime}; at 84) and the band reads its chords on that grid (${hit} of ${total} changes within a beat; ${p.sections.map((s) => s.name).join(', ')})`);
    // a fresh song at the kitchen starts at the kitchen's 84, the tempo Count me in offers
    const fresh = createStore(createProject({ tempo: 120 }), { getDevice });
    ok(fresh.dispatch(kitchenOps(fresh.get(), { mic: 'one' }).ops, { by: 'overdub' }));
    T.ok(fresh.get().tempo === 84, `Count me in: a fresh song at the kitchen table starts at ${fresh.get().tempo} BPM`);
  }
  {
    // a paper in Nashville numbers: the Chords track plays them in the key of the shapes (G), not in C
    const st = createStore(createProject({ tempo: 84 }), { getDevice });
    ok(st.dispatch(pasteOps(st.get(), parseSheet('{key: G}\n[Verse]\n| 1 | 4 | 6- | 5 |\n')).ops, { by: 'you' }));
    ok(st.dispatch([{ type: 'track.add', ref: 'c', track: { name: 'Chords', kind: 'instrument', instrument: { device: 'core.keys' }, mute: true } }, ...['1', '4', '6-', '5'].map((n, i) => ({ type: 'clip.add', track: '$c', clip: { kind: 'notes', start: i * 4, length: 4, name: n, notes: [] } }))], { by: 'overdub' }));
    const names = chordsTimeline(st.get()).map((x) => x.chord.name).join(' ');
    T.ok(names === 'G C Em D', `the chords: Nashville numbers on the Chords track play in the paper's key (1 4 6- 5 in G: ${names})`);
  }
  {
    // where the time moves, the players rest: a take with a third of it in free time, the shaker kept over all of it
    const tk = takeOf([...V, ...V, ...C, ...C], { bpm: 84, seed: 9, free: [3, 9] });
    const read = readTape(tk.buf, SR);
    const { st, track, clip } = songWith(tk.buf);
    const take = { track, clip, read };
    ok(st.dispatch(planTime(st.get(), { take, reading: 'found' }).ops, { by: 'you' }));
    ok(st.dispatch(planRead(st.get(), { take }).ops, { by: 'overdub' }));
    const p = st.get();
    const pp = planPlayer(p, { player: 'shaker', section: p.sections.map((s) => s.id), free: read.result.free });
    ok(st.dispatch(pp.ops, { by: 'you' }));
    const q = st.get(), A = q.tempoMap.anchors, c = q.tracks.find((t) => t.id === track).clips[0];
    const s0 = mapSec(A, c.start) - (c.offset || 0);
    const spans = read.result.free.map(([a, b]) => [mapBeat(A, s0 + a), mapBeat(A, s0 + b)]);
    const sh = q.tracks.find((t) => t.id === q.room.tracks.shaker);
    const at = sh.clips.flatMap((cl) => cl.notes.map((n) => cl.start + n.t));
    const inFree = at.filter((t) => spans.some(([a, b]) => t >= a && t < b)).length;
    T.ok(spans.length > 0 && at.length > 0 && inFree === 0, `the time: the players rest where the time moves (${at.length} shaker notes, ${inFree} in ${spans.length} free span${spans.length === 1 ? '' : 's'})`);
  }

  // 4. the levels
  if (ctx.levels !== false) {
    const tk = takeOf([...V, ...V, ...C, ...C, ...B, ...C, ...C], { bpm: 84, seed: 21, drift: 0.02 });
    const read = readTape(tk.buf, SR);
    const { st, track, clip } = songWith(tk.buf);
    const take = { track, clip, read };
    ok(st.dispatch(planTime(st.get(), { take, reading: 'found' }).ops, { by: 'you' }));
    ok(st.dispatch(planRead(st.get(), { take }).ops, { by: 'overdub' }));
    for (const id of PLAYER_ORDER) { const r = planPlayer(st.get(), { player: id }); if (r.ops.length) ok(st.dispatch(r.ops, { by: 'you', label: r.label })); }
    const p = st.get(), assets = { tape1: { sr: SR, channels: [tk.buf] } };
    const span = (secs) => [Math.min(...secs.map((s) => s.start)), Math.max(...secs.map((s) => s.start + s.length))];
    // (the levels on the tracks, before the master's chain)
    const dry = { ...p, master: { ...p.master, inserts: [] } };
    const lu = (tracks, [from, to]) => measure(renderSong(dry, { from, to, tracks, tail: 0, assets })).lufs;
    const secs = p.sections;
    const where = { shaker: secs.filter((s) => /^Chorus/.test(s.name)), cajon: secs.filter((s) => /^Verse/.test(s.name)), bass: secs.slice(secs.findIndex((s) => /^Chorus/.test(s.name))), strings: secs.filter((s) => /^Bridge/.test(s.name)) };
    const takeAll = lu([p.room.tracks.take], span(secs));
    T.ok(Math.abs(takeAll - TAKE_LEVEL) <= 1.5, `the levels: the take after its chain at ${r2(takeAll)} LUFS (${TAKE_LEVEL}, trimmed from ${r2(read.level)})`);
    for (const id of PLAYER_ORDER) {
      const P = PLAYERS[id], sp = span(where[id]);
      const under = lu([p.room.tracks[P.role]], sp) - lu([p.room.tracks.take], sp);
      T.ok(Math.abs(under - P.under) <= 1.5, `the levels: ${P.name} ${r2(under)} LU under the take (${P.under})`);
    }
    for (const [f, lo, hi] of [['bare', -16.5, -14], ['warm', -16, -13.5], ['close', -14, -12]]) {
      ok(st.dispatch(planKitchenFinish(st.get(), { finish: f }).ops, { by: 'you' }));
      const m = measure(renderSong(st.get(), { tail: 1, assets }));
      const rows = checkTargets(m, 'acoustic', { window: 'song' });
      const tp = rows.find((x) => x.metric === 'truePeak');
      T.ok(m.lufs >= lo && m.lufs <= hi && m.truePeak <= -0.9, `the levels: ${f} at ${r2(m.lufs)} LUFS, ${r2(m.truePeak)} dBTP, PLR ${r2(m.truePeak - m.lufs)}${tp?.ok ? '' : ' (true peak over)'}`);
    }
  } else T.note('the levels: skipped (LEVELS=0)');

  // the offered move, in order (§7.4)
  {
    const v = { cards: [{ name: 'Verse' }, { name: 'Chorus' }, { name: 'Bridge' }] };
    const seq = [offeredKitchen(v, {}), offeredKitchen(v, { rolling: true }), offeredKitchen(v, { takes: 1, ask: 'time' }), offeredKitchen(v, { takes: 1 }), offeredKitchen(v, { takes: 1, offer: 'shaker' }), offeredKitchen(v, { takes: 1, done: PLAYER_ORDER }), offeredKitchen(v, { takes: 1, done: PLAYER_ORDER, again: true })].map((o) => o?.id);
    T.ok(seq.join(' ') === 'tape stop time offer.shaker keep again hear', `the offered move: ${seq.join(' → ')}`);
    T.ok(offeredKitchen({ cards: [{ name: 'Verse' }] }, { takes: 1, done: ['shaker', 'cajon', 'bass'] })?.id === 'again', 'the offered move: strings only with a bridge');
    const form = offeredKitchen(v, { takes: 1, ask: 'form', offer: null })?.id, bare = offeredKitchen({ cards: [] }, { takes: 1 })?.id, noChorus = offeredKitchen({ cards: [{ name: 'Verse 1' }] }, { takes: 1 })?.id;
    T.ok(form === 'form' && bare === 'again' && noChorus === 'offer.cajon', `the offered move: the form asked before the players (${form}); no parts, no players (${bare}); no chorus, no shaker (${noChorus})`);
    const both = offeredKitchen(v, { takes: 1, done: PLAYER_ORDER, again: true, ask: 'both' })?.id;
    T.ok(both === 'again.both', `the offered move: with two inputs, Again's question offers both again first (${both})`);
  }
  {
    // two inputs (§6.2 c): Voice on input 1 and Guitar on input 2, each with its chain; one mic is the default setup
    const st = createStore(createProject({ tempo: 84 }), { getDevice });
    ok(st.dispatch(kitchenOps(st.get(), { mic: 'one' }).ops, { by: 'overdub' }));
    const one = structuredClone(st.get().room);
    ok(st.dispatch(kitchenOps(st.get(), { mic: 'two' }).ops, { by: 'overdub' }));
    const p = st.get(), R = p.room, tr = (id) => p.tracks.find((t) => t.id === id);
    T.ok(one.mic === 'one' && one.tracks.take && R.mic === 'two' && tr(R.tracks.voice)?.input?.channel === 1 && tr(R.tracks.kguitar)?.input?.channel === 2 && tr(R.tracks.voice).name === 'Voice' && tr(R.tracks.kguitar).name === 'Guitar',
      `two inputs: one mic is the default (${one.mic}); picked, Voice on input ${tr(R.tracks.voice)?.input?.channel} and Guitar on input ${tr(R.tracks.kguitar)?.input?.channel}`);
  }

  if (!ctx.pages) { T.note('the flow: skipped (PAGES=0)'); return; }
  await flow(T, ctx);
}

/* ------------------------------------------------------------------------------------------------ the flow */
// §2.5 in muted Chromium, on the room's own deck: the presses counted as a musician makes them. The input is a fake
// file, played from when the kitchen opens it, and each press is made at a known point in it (the audio clock less the
// input's first frame): the balance's strum and then a voice over it, then the work tape, a 16-bar take with two
// seconds of room before it, which the kitchen trims as it goes in (§6.3). The deck's latency is set to 0 (the fake
// input has none) and its calls are logged.
const PAPER = `Paper Moon\nCapo 3\n\n[Verse]\nG       Em\nSomewhere a paper moon\nC          D\nover the roofs of town\n\n[Chorus]\nC       G\nHold on hold on\nD            G\nuntil the morning\n`;

// the fake input: silence, three seconds of strumming alone, a voice over it, silence, then the take (or, counted, the
// take played from beat 0 of a one-bar count at 96); its points in seconds
function kitchenTape({ counted = false } = {}) {
  const bars = [...V, ...C, ...V, ...C];
  if (counted) {
    const tk = takeOf(bars, { bpm: 96, seed: 33, lead: 0 });
    const at = 15;
    return { wav: { sr: SR, channels: [mix([{ buf: tk.buf, at }], { length: Math.round((at + tk.buf.length / SR + 4) * SR) })] }, T: { tape: at, end: at + tk.buf.length / SR } };
  }
  const tk = takeOf(bars, { bpm: 96, seed: 31, lead: 2 });
  const alone = strum(V.map((c, i) => ({ beat: i * 4, notes: VOICINGS[c], beats: 4 })), { bpm: 96, seed: 41, peak: -19, tail: 0 });
  const sung = takeOf(V, { bpm: 96, seed: 43, lead: 0 });
  const T = { strum: 6, sing: 9.3, tape: 20 };
  const buf = mix([
    { buf: alone.buf.subarray(0, Math.round(3.3 * SR)), at: T.strum },
    { buf: sung.buf.subarray(0, Math.round(5.7 * SR)), at: T.sing },
    { buf: tk.buf, at: T.tape },
  ], { length: Math.round((T.tape + tk.buf.length / SR + 4) * SR) });
  return { wav: { sr: SR, channels: [buf] }, T: { ...T, end: T.tape + tk.buf.length / SR } };
}

// in the page, before the door: the deck's calls logged (a counted take's count put at `countAt` s into the file), the
// room's lines, and pos(): how far into the fake file the input is now
const INSTALL = async () => {
  const o = window.overdub;
  const { createDeck } = await import('/app/src/ui/liveroom/deck.js');
  const m = await import('/app/src/ui/liveroom/kitchen.js');
  const deck = createDeck(o), K = (window.__k = { log: [], lines: [], countAt: null, deck });
  window.__kstate = m.kitchenState;
  o.liveRoom.on('say', (e) => K.lines.push(e.text));
  K.pos = () => {
    const st = o.input.audio.state, c = o.engine.ctx;
    if (!st.open || !Number.isFinite(st.firstFrame) || !c) return -1;
    return c.currentTime - st.firstFrame / (st.sr || c.sampleRate);
  };
  const entry = (kind, a = {}) => `${kind}${a.voice ? ':' + a.voice : ''}${a.bars != null ? ':' + a.bars : ''}`;
  const count = deck.countIn, take = deck.take, stop = deck.stop;
  deck.countIn = (a = {}) => {
    K.log.push(entry('countIn', a));
    if (a.voice === 'sticks' && K.countAt != null) { const st = o.input.audio.state; a = { ...a, at: st.firstFrame / (st.sr || o.engine.ctx.sampleRate) + K.countAt }; }
    return count(a);
  };
  deck.take = (a = {}) => { K.log.push(entry('take')); return take(a); };
  deck.stop = (a = {}) => { K.log.push(entry('stop')); return stop(a); };
};

async function flow(T, ctx) {
  const tape = kitchenTape();
  for (const phones of [true, false]) {
    let S;
    try { S = await openRoom('/app/?room', { name: `kitchen-${phones ? 'phones' : 'speakers'}`, fake: tape }); } catch (e) { T.ok(false, `the flow: the room opened (${e.message})`); return; }
    const { page, E } = S;
    const warns = [];
    page.on('console', (m) => { if (/overdub (kitchen|paper)/.test(m.text())) warns.push(m.text()); });
    let presses = 0;
    const press = async (key) => { presses++; await page.keyboard.press(key); await page.waitForTimeout(120); };
    const at = (x, ms = 90000) => page.waitForFunction((x) => window.__k.pos() >= x, x, { timeout: ms, polling: 20 });
    try {
      await E(INSTALL);
      // press 1: the door's kitchen table
      await page.waitForSelector('.lrd-card', { timeout: 15000 });
      await press('Digit4');
      await page.waitForSelector('.kt', { timeout: 10000 });
      // press 2: Allow (this browser has allowed it already: the kitchen opens the input by itself)
      presses++;
      await page.waitForFunction(() => window.__k.pos() >= 0 && window.__kstate()?.step === 'phones', null, { timeout: 15000 });
      await E(() => { window.__k.deck.latency = 0; });
      const st0 = await E(() => ({ ...window.__kstate(), pos: window.__k.pos(), how: window.__k.lines.find((x) => /^How is it miked\?/.test(x)) || '' }));
      T.ok(st0.mic === 'laptop' && /The laptop’s mic/.test(st0.how), `the flow (${phones ? 'headphones' : 'speakers'}): the input opened by itself, the mic picked from what the room sees (${st0.how}), then Headphones on?`);
      if (st0.pos > tape.T.strum - 0.5) throw new Error(`the input was ${st0.pos.toFixed(1)} s into the fake before the headphones question: too late for its strum at ${tape.T.strum} s`);
      // press 3: the headphones question; then the balance hears the strum, then a voice over it
      if (phones) await press('Space'); else { presses++; await page.click('[data-act="phones.no"]'); }
      await page.waitForFunction(() => window.__kstate()?.step === 'paper', null, { timeout: 30000 });
      const tb = await E(() => window.__k.lines.filter((x) => /^Good:|guitar’s louder|well over the guitar/.test(x)).at(-1) || '');
      T.ok(/^Good: your voice sits [3-8] dB over the guitar\.$/.test(tb), `the flow: the balance from the input, a voice over the strum (${tb})`);
      // the paper, pasted (typing isn't a press)
      await E(async (text) => {
        const app = window.overdub;
        const { parseSheet, pasteOps } = await import('/app/src/core/liveroom/sheet-text.js');
        app.store.dispatch(pasteOps(app.store.get(), parseSheet(text)).ops, { by: 'you', label: 'The paper' });
      }, PAPER);
      // press 4 and 5: the tape in the quiet before the take, then the stop once it's played
      await at(tape.T.sing + 6);
      const playsBefore = (await S.plays()).length;
      await press('Space');
      await page.waitForTimeout(400);
      const rolling = await E((n) => {
        const o = window.overdub, p = o.store.get(), r = p.room || {};
        const band = ['shaker', 'cajon', 'bass', 'strings'].map((k) => p.tracks.find((t) => t.id === r.tracks?.[k])).filter(Boolean);
        return { rolling: window.__kstate()?.rolling, counted: (window.__lrPlays || []).slice(n).some((x) => x.opts?.countIn), click: !!o.engine.click?.on, band: band.every((t) => t.mute || !t.clips.length) };
      }, playsBefore);
      T.ok(rolling.rolling && !rolling.counted && !rolling.click && rolling.band, `the work tape rolls with no count, no click and no band (counted ${rolling.counted}, click ${rolling.click}, band silent ${rolling.band})`);
      await at(tape.T.end + 0.3);
      await press('Space');
      const log = await E(() => window.__k.log.slice());
      T.ok(log.join(' ').startsWith('countIn:none:0 take stop'), `the flow: the work tape through the deck (${log.join(' ')})`);
      // the take as it went in: one audio clip by you, its room before the first strum trimmed to two seconds
      const took = await E(() => {
        const p = window.overdub.store.get(), t = p.tracks.find((x) => x.id === p.room.tracks.take), c = t?.clips.find((x) => x.kind === 'audio');
        const H = window.overdub.store.history.slice(-3).map((x) => `${x.label}:${x.by}`);
        return c ? { offset: c.offset || 0, start: c.start, length: c.length, by: c.by, name: c.name, tempo: p.tempo, H } : null;
      });
      const secs = took ? ((took.offset || 0) * 60) / took.tempo : 0;
      T.ok(took && took.by === 'you' && took.start === 0 && secs > 0, `the work tape goes in by you, its quiet head trimmed (${took ? `${secs.toFixed(2)} s of it cut, “${took.name}”` : 'no take'})`);
      // the read, in a Worker; then the time question with the shaker on it
      await page.waitForFunction(() => window.__kstate()?.ask === 'time', null, { timeout: 60000 });
      const line = await E(() => window.__k.lines.at(-1) || '');
      T.ok(/The band’s read it: around \d+/.test(line), `the flow: the read's question (${line})`);
      // press 6: On the beat
      await press('Space');
      await page.waitForFunction(() => window.__kstate()?.offer === 'shaker', null, { timeout: 20000 });
      await page.waitForFunction(() => window.__k.lines.includes('Want a shaker in the chorus?'), null, { timeout: 10000 }).catch(() => {});
      const said = await E(() => window.__k.lines.slice(-3));
      const chordsLine = said.find((x) => /The band has your chords/.test(x)) || said.join(' | ');
      // press 7: Keep it, the shaker
      await press('Space');
      await page.waitForFunction(() => window.__kstate()?.done.includes('shaker'), null, { timeout: 10000 });
      if (!phones) {
        // on speakers: Again, with the shaker in the song: the band held muted for the whole take, no count, and no
        // click, though the control room's click is on (held off for the take, given back after it)
        await E(() => { window.overdub.engine.click = { on: true }; });
        const before = (await S.plays()).length;
        await E(() => window.overdub.liveRoom.press('again'));
        await page.waitForFunction(() => window.__kstate()?.rolling === true, null, { timeout: 10000 });
        await page.waitForTimeout(600);
        const during = await E((n) => { const o = window.overdub, p = o.store.get(), id = p.room?.tracks?.shaker; return { muted: !!p.tracks.find((t) => t.id === id)?.mute, hold: window.__kstate().hold, counted: (window.__lrPlays || []).slice(n).some((x) => x.opts?.countIn), click: !!o.engine.click?.on }; }, before);
        await E(() => window.overdub.liveRoom.press('stop'));
        await page.waitForFunction(() => window.__kstate()?.rolling === false, null, { timeout: 15000 });
        const after = await E(() => { const o = window.overdub, p = o.store.get(), id = p.room?.tracks?.shaker; return { band: !p.tracks.find((t) => t.id === id)?.mute, click: !!o.engine.click.on }; });
        T.ok(during.muted && during.hold && !during.counted && !during.click && after.band && after.click, `the flow (speakers): nothing of the band sounds during a take (the shaker held muted ${during.muted}, no count ${!during.counted}, the click held off ${!during.click}; the shaker back after ${after.band}, the click ${after.click})`);
      }
      if (phones) {
        // signing on the paper: an agent's line in --ink-agent, the house's chord lines unsigned
        await E(async () => {
          const app = window.overdub;
          const sh = app.store.get().sheet;
          app.store.dispatch([{ type: 'sheet.line.set', section: sh.sections[0].id, line: sh.sections[0].lines[0].id, patch: { text: 'Somewhere a [G]silver [Em]moon' } }], { by: 'mcp:test', label: 'A line' });
          app.store.dispatch([{ type: 'sheet.section.add', section: { name: 'Bridge', lines: [{ text: '| Am | C | D |' }] } }], { by: 'overdub', label: 'The chords from the take' });
        });
        await page.waitForTimeout(200);
        const ink = await E(() => {
          const by = document.querySelector('.pp .pp-line .by');
          const want = getComputedStyle(document.documentElement).getPropertyValue('--ink-agent').trim();
          const probe = document.createElement('span'); probe.style.color = want; document.body.append(probe); const w = getComputedStyle(probe).color; probe.remove();
          const house = [...document.querySelectorAll('.pp .pp-line')].find((l) => /Am/.test(l.textContent));
          return { color: by ? getComputedStyle(by).color : null, want: w, text: by?.textContent || '', house: house ? !house.querySelector('.by') : null };
        });
        T.ok(ink.color && ink.color === ink.want && /test/i.test(ink.text), `signing: an mcp:test line carries its byline in --ink-agent (${ink.text} ${ink.color})`);
        T.ok(ink.house === true, 'signing: the house\'s chord lines are unsigned');
        await S.shot?.('kitchen-paper');
      }
      // a finish (Bare is on): Warm pressed is answered at once, and its number, measured, follows
      if (await page.$('[data-act="finish.warm"]')) {
        await page.click('[data-act="finish.warm"]');
        await page.waitForTimeout(300);
        const now = await E(() => document.querySelector('.lr-tb-line')?.textContent || '');
        const num = await page.waitForFunction(() => window.__k.lines.find((x) => /^Warm is on: the peaks rounded off, (about \d+ dB (louder|quieter) than Bare|as loud as Bare)\.$/.test(x)), null, { timeout: 15000 }).then((h) => h.jsonValue(), () => null);
        T.ok(/^Warm is on: the peaks rounded off/.test(now) && !!num, `a finish: Warm answered at once (“${now}”), its number after (“${num}”)`);
        await page.click('[data-act="finish.bare"]');
      }
      // press 8: Send a mix, the send screen
      presses++;
      await page.click('[data-act="send"]');
      const sent = await page.waitForFunction(() => window.overdub.ui.state.liveRoom.screen === 'send', null, { timeout: 10000 }).then(() => true, () => false);
      const H = await history(page);
      const steps = H.map((x) => `${x.label}:${x.by}`);
      const time = H.find((x) => /^On the beat/.test(x.label));
      const read = H.find((x) => /^The band read/.test(x.label));
      const shaker = H.find((x) => /^Shaker/.test(x.label));
      const into = H[0];
      T.ok(presses === 8 && sent, `the flow: §2.5 in ${presses} presses, the last opening Send (${sent ? 'the send screen' : 'no send screen'})`);
      T.ok(into?.by === 'you' && /kitchen/i.test(into.label) && time?.by === 'you' && time.ops.includes('tempo.map') && read?.by === 'overdub' && shaker?.by === 'you', `the flow: the place by you, the time by you (tempo.map), the read by the house, the shaker kept by you (${[steps[0], ...steps.slice(-4)].join(' · ')})`);
      T.ok(/^The band has your chords: .+ in the (verse|chorus)\.$/.test(chordsLine) && said.some((x) => x === 'Want a shaker in the chorus?'), `the flow: the chords line, then the shaker's offer (${said.join(' | ')})`);
      const clipBy = await E(() => { const p = window.overdub.store.get(); const t = p.tracks.find((x) => x.id === p.room.tracks.shaker); return t ? [...new Set(t.clips.map((c) => c.by))] : []; });
      T.ok(clipBy.join() === 'overdub', `signing: the shaker's clips the house's (${clipBy.join()})`);
    } catch (e) {
      let why = '';
      try { const k = await E(() => { const s = window.__kstate(); return s && { step: s.step, ask: s.ask, offer: s.offer, done: s.done, takes: s.takes, reading: s.reading, offered: s.offered?.id, pos: +window.__k.pos().toFixed(2), log: window.__k.log, lines: window.__k.lines.slice(-3) }; }); why = ` ${JSON.stringify(k)}`; } catch { /* the page is gone */ }
      const errs = (S.errors || []).slice(-3).map((x) => String(x.message || x).split('\n')[0]).join(' | ');
      T.ok(false, `the flow (${phones ? 'headphones' : 'speakers'}): ${e.message.split('\n')[0]}${why}${errs ? ` errors: ${errs}` : ''}${warns.length ? ` warnings: ${warns.slice(-3).join(' | ')}` : ''}`);
    } finally {
      await S.close();
    }
  }
  await countedFlow(T);
  await twoFlow(T);
  await sameFlow(T);
}

// One source on both channels of a stereo input (a mic on it, or Chromium's own fake): both channels move, always at
// the same level, and the two-input option still says it needs a pickup
async function sameFlow(T) {
  const bpm = 96, bars = [...V, ...C, ...V];
  const g = strum(bars.map((c, i) => ({ beat: i * 4, notes: VOICINGS[c], beats: 4 })), { bpm, seed: 61, peak: -14, tail: 1 });
  const len = g.buf.length + SR;
  const one = mix([{ buf: g.buf, at: 0.5 }], { length: len });
  let S;
  try { S = await openRoom('/app/?room', { name: 'kitchen-same', fake: { wav: { sr: SR, channels: [one, one.slice()] } } }); } catch (e) { T.ok(false, `one source on both channels: the room opened (${e.message})`); return; }
  const { page, E } = S;
  try {
    await E(INSTALL);
    await page.waitForSelector('.lrd-card', { timeout: 15000 });
    await page.keyboard.press('Digit4');
    await page.waitForSelector('.kt', { timeout: 10000 });
    await page.waitForFunction(() => window.__k.pos() >= 0 && window.__kstate()?.step === 'phones', null, { timeout: 15000 });
    const chs = await E(() => window.overdub.input.audio.state.channels);
    if (chs < 2) { T.note(`one source on both channels: Chromium's fake capture gave ${chs} channel, so it's skipped`); return; }
    // (3 s of the strums on both channels, sampled as the room's frame reads them)
    const seen = await E(() => new Promise((res) => {
      let both = 0, apart = 0;
      const t0 = performance.now();
      const tick = () => {
        const dbs = (window.__k.deck.level?.()?.channels || []).map((c) => (Number.isFinite(c.db) ? c.db : -120));
        if (dbs.length >= 2 && dbs.every((d) => d > -50)) both++;
        if (dbs.length >= 2 && Math.max(...dbs) > -50 && Math.max(...dbs) - Math.min(...dbs) >= 6) apart++;
        if (performance.now() - t0 > 3000) res({ both, apart }); else requestAnimationFrame(tick);
      };
      tick();
    }));
    const c = await E(() => { const b = document.querySelector('[data-act="mic.two"]'); return b ? { text: b.textContent, disabled: b.disabled } : null; });
    T.ok(seen.both > 10 && seen.apart === 0 && c?.disabled && /needs a guitar with a pickup/.test(c.text),
      `one source on both channels: both moved (${seen.both} frames, never 6 dB apart) and the option still says “${c?.text}”`);
  } catch (e) {
    T.ok(false, `one source on both channels: ${e.message.split('\n')[0]}`);
  } finally {
    await S.close();
  }
}

// Two inputs (§6.2 c, §13): a stereo fake, a voice on channel 1 from the start and a guitar on channel 2 from 4 s, both
// to the end. The option says it needs a pickup until both move, then it's picked: a take is two takes, lined up, one
// step by you; Again asks Both, or just the voice?, and just the voice records input 1 alone onto Voice, the guitar from
// the take before kept under it, and the input goes back to both channels after.
function twoTape() {
  const bpm = 96, spb = 60 / bpm, bars = [];
  while (bars.length < 48) bars.push(...V, ...C);
  const lead = 4, guitar = strum(bars.map((c, i) => ({ beat: i * 4, notes: VOICINGS[c], beats: 4 })), { bpm, seed: 51, peak: -14, tail: 1 });
  const notes = [];
  for (let k = 0; k < 52; k++) { const c = bars[k] || 'Bb'; notes.push([k * 4 + 0.5, TONES[c][k % TONES[c].length], 1.4], [k * 4 + 2.5, SCALE[(k * 3) % SCALE.length], 1.2]); }
  const sung = voice(notes, { bpm, seed: 53, peak: -16, tail: 1 });
  const len = Math.round((lead + bars.length * 4 * spb + 2) * SR);
  return { wav: { sr: SR, channels: [mix([{ buf: sung.buf, at: 1 }], { length: len }), mix([{ buf: guitar.buf, at: lead }], { length: len })] }, T: { guitar: lead } };
}

async function twoFlow(T) {
  const tape = twoTape();
  let S;
  try { S = await openRoom('/app/?room', { name: 'kitchen-two', fake: tape }); } catch (e) { T.ok(false, `two inputs: the room opened (${e.message})`); return; }
  const { page, E } = S;
  const lines = () => E(() => window.__k.lines.slice());
  const room = () => E(() => {
    const o = window.overdub, p = o.store.get(), R = p.room || {}, st = o.input.audio.state;
    const clips = (id) => (p.tracks.find((t) => t.id === id)?.clips || []).filter((c) => c.kind === 'audio').map((c) => ({ id: c.id, start: c.start, length: c.length, offset: c.offset || 0, mute: !!c.mute, name: c.name, by: c.by }));
    return { mic: R.mic, voice: clips(R.tracks?.voice), guitar: clips(R.tracks?.kguitar), master: R.master, split: st.split, channel: st.channel, channels: st.channels, steps: o.store.history.length, k: window.__kstate() };
  });
  try {
    await E(INSTALL);
    await page.waitForSelector('.lrd-card', { timeout: 15000 });
    await page.keyboard.press('Digit4');
    await page.waitForSelector('.kt', { timeout: 10000 });
    await page.waitForFunction(() => window.__k.pos() >= 0 && window.__kstate()?.step === 'phones', null, { timeout: 15000 });
    await E(() => { window.__k.deck.latency = 0; });
    const chip = () => E(() => { const b = document.querySelector('[data-act="mic.two"]'); return b ? { text: b.textContent, disabled: b.disabled, aria: b.getAttribute('aria-label') || '' } : null; });
    const r0 = await room(), c0 = await chip(), pos0 = await E(() => window.__k.pos());
    if (r0.channels < 2) {
      T.note(`two inputs: Chromium's fake capture gave ${r0.channels} channel${r0.channels === 1 ? '' : 's'}, so the page part is skipped; the split is held in Node (the setup above, and checks-input's deck)`);
      return;
    }
    T.ok(r0.mic === 'one' && r0.k.mic !== 'two' && pos0 < tape.T.guitar && c0?.disabled && /needs a guitar with a pickup/.test(c0.text) && c0.aria === KLINES['k.pickup.needed'].text(),
      `two inputs: with only the voice moving, one mic is the default (${r0.k.mic}) and the option says “${c0?.text}” (${pos0.toFixed(1)} s in, ${r0.channels} channels)`);
    await page.waitForFunction(() => { const b = document.querySelector('[data-act="mic.two"]'); return b && !b.disabled; }, null, { timeout: 15000 });
    const c1 = await chip();
    await page.click('[data-act="mic.two"]');
    await page.waitForFunction(() => window.overdub.input.audio.state.split && window.overdub.store.get().room?.mic === 'two', null, { timeout: 10000 });
    await E(() => { window.__k.deck.latency = 0; });
    const r1 = await room();
    T.ok(c1.text === 'A mic and a pickup' && r1.mic === 'two' && Object.keys(r1.split || {}).join() === '1,2', `two inputs: once both channels move it's “${c1.text}”; picked, the input splits 1 and 2 to Voice and Guitar (${JSON.stringify(r1.split)})`);
    await page.keyboard.press('Space');   // Headphones on? Yes
    await page.waitForFunction(() => window.__kstate()?.step === 'balance', null, { timeout: 10000 });
    await page.click('[data-act="balance.skip"]');
    await page.waitForFunction(() => window.__kstate()?.step === 'paper', null, { timeout: 10000 });
    await E(async (text) => {
      const app = window.overdub;
      const { parseSheet, pasteOps } = await import('/app/src/core/liveroom/sheet-text.js');
      app.store.dispatch(pasteOps(app.store.get(), parseSheet(text)).ops, { by: 'you', label: 'The paper' });
    }, PAPER);
    // the take: both channels, 12 s or so
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__kstate()?.rolling === true, null, { timeout: 10000 });
    await page.waitForTimeout(12000);
    const h0 = (await room()).steps;
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__k.lines.some((x) => /^Take 1 is in/.test(x)), null, { timeout: 20000 });
    const r2 = await room(), H2 = (await history(page)).slice(h0);
    const [v1] = r2.voice, [g1] = r2.guitar;
    const lined = v1 && g1 && v1.start === g1.start && v1.offset === g1.offset && v1.length === g1.length;
    T.ok(r2.voice.length === 1 && r2.guitar.length === 1 && lined && H2.length === 1 && H2[0].by === 'you' && /· voice$/.test(v1.name),
      `two inputs: a take is two takes, Voice and Guitar lined up (from beat ${g1?.start}, offset ${g1?.offset} s, ${g1?.length} beats each), in ${H2.length} step by ${H2[0]?.by} (“${H2[0]?.label}”)`);
    // the read is of the Guitar track; then on to Again (the players declined)
    await page.waitForFunction(() => window.__kstate()?.ask === 'time', null, { timeout: 60000 });
    await page.keyboard.press('Space');
    // (each player offered, Space, then No thanks, Esc)
    for (let i = 0; i < 12; i++) {
      const o = await E(() => window.__kstate()?.offered?.id);
      if (o === 'again') break;
      if (o === 'keep') await page.keyboard.press('Escape');
      else if (/^offer\./.test(o || '')) await page.keyboard.press('Space');
      await page.waitForTimeout(300);
    }
    const r3 = await room();
    T.ok(r3.master === g1?.id, `two inputs: the band reads the Guitar take, the master (${r3.master === g1?.id ? 'Guitar' : r3.master})`);
    await page.keyboard.press('Space');   // Again
    await page.waitForFunction(() => window.__kstate()?.ask === 'both', null, { timeout: 10000 });
    const asked = (await lines()).at(-1), offeredNow = await E(() => window.__kstate()?.offered?.id), chips = await E(() => [...document.querySelectorAll('.kt-choices .kt-chip')].map((b) => b.textContent));
    T.ok(asked === KLINES['k.both.or.voice'].text() && offeredNow === 'again.both' && chips.includes('Both') && chips.includes('Just the voice'), `two inputs: Again asks “${asked}” (${chips.join(' · ')}; Space is ${offeredNow})`);
    // just the voice: input 1 alone onto Voice, the guitar from take 1 playing under it
    await page.click('[data-act="again.voice"]');
    await page.waitForFunction(() => window.__kstate()?.rolling === true, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const during = await room();
    await page.waitForTimeout(5000);
    const h1 = (await room()).steps;
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__k.lines.some((x) => /^Voice take \d+ is in/.test(x)), null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.overdub.input.audio.state.split, null, { timeout: 10000 }).catch(() => {});
    const r4 = await room(), H4 = (await history(page)).slice(h1), said = (await lines()).find((x) => /^Voice take 2 is in/.test(x));
    // (the new pass from the top; take 1's voice muted under it, and its tail past where the pass stopped playing on)
    const v2 = r4.voice.find((c) => c.id !== v1.id && c.name === 'Take 2' || /take 2 .*· voice$/.test(c.name || ''));
    T.ok(!during.split && during.channel === '1' && r4.guitar.length === 1 && r4.guitar[0].id === g1.id && !r4.guitar[0].mute && v2 && !v2.mute && v2.start === 0 && r4.voice.find((c) => c.id === v1.id)?.mute
      && H4.length === 1 && H4[0].by === 'you' && /^Voice take 2 is in: \d+:\d\d, over the guitar from take 1\.$/.test(said || '') && Object.keys(r4.split || {}).join() === '1,2',
      `two inputs: just the voice records input ${during.channel} alone (split ${during.split ? 'on' : 'off'}) onto Voice, the guitar from take 1 kept (${r4.guitar.length} Guitar take, playing), voice take 1 muted under it; ${H4.length} step by ${H4[0]?.by} (“${H4[0]?.label}”); “${said}”; both channels split again after (${JSON.stringify(r4.split)})`);
    await S.shot?.('kitchen-two');
    const errs = (S.errors || []).map((x) => String(x.message || x).split('\n')[0]);
    T.ok(!errs.length, `two inputs: no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  } catch (e) {
    let why = '';
    try { const k = await E(() => { const s = window.__kstate(); return s && { step: s.step, ask: s.ask, offer: s.offer, rolling: s.rolling, reading: s.reading, offered: s.offered?.id, mic: s.mic, pos: +window.__k.pos().toFixed(2), log: window.__k.log, lines: window.__k.lines.slice(-3), split: window.overdub.input.audio.state.split }; }); why = ` ${JSON.stringify(k)}`; } catch { /* the page is gone */ }
    T.ok(false, `two inputs: ${e.message.split('\n')[0]}${why}`);
  } finally {
    await S.close();
  }
}

// Count me in (§6.3), the other way in on headphones: the tempo set first with → and ⇧→, one bar of sticks, the
// shaker under the take (a preview), and on the stop no question about the time: the band reads the chords on the
// song's grid at once. The take is played at that tempo from beat 0, the count put a bar before it in the fake.
async function countedFlow(T) {
  const tape = kitchenTape({ counted: true });
  let S;
  try { S = await openRoom('/app/?room', { name: 'kitchen-counted', fake: tape }); } catch (e) { T.ok(false, `Count me in: the room opened (${e.message})`); return; }
  const { page, E } = S;
  try {
    await E(INSTALL);
    await E((x) => { window.__k.countAt = x; }, tape.T.tape - (4 * 60) / 96);
    await page.waitForSelector('.lrd-card', { timeout: 15000 });
    await page.keyboard.press('Digit4');
    await page.waitForSelector('.kt', { timeout: 10000 });
    await page.waitForFunction(() => window.__k.pos() >= 0 && window.__kstate()?.step === 'phones', null, { timeout: 15000 });
    await E(() => { window.__k.deck.latency = 0; });
    await page.keyboard.press('Space');   // Headphones on? Yes
    await page.waitForFunction(() => window.__kstate()?.step === 'balance', null, { timeout: 10000 });
    await page.click('[data-act="balance.skip"]');   // no singing
    await page.waitForFunction(() => window.__kstate()?.step === 'paper', null, { timeout: 10000 });
    await E(async (text) => {
      const app = window.overdub;
      const { parseSheet, pasteOps } = await import('/app/src/core/liveroom/sheet-text.js');
      app.store.dispatch(pasteOps(app.store.get(), parseSheet(text)).ops, { by: 'you', label: 'The paper' });
    }, PAPER);
    const chip0 = await E(() => document.querySelector('[data-act="count"]')?.textContent || '');
    // 84 to 96: ⇧→ is ten, → is one
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const chip1 = await E(() => document.querySelector('[data-act="count"]')?.textContent || '');
    const offered = await E(() => window.__kstate()?.offered?.id);
    T.ok(chip0 === 'Count me in at 84' && chip1 === 'Count me in at 96' && offered === 'tape', `Count me in: beside the bare tape on headphones (${chip0} → ${chip1}; Space is still ${offered})`);
    const pos = await E(() => window.__k.pos());
    if (pos > tape.T.tape - 3) throw new Error(`the input was ${pos.toFixed(1)} s into the fake at Count me in: too late for its count a bar before ${tape.T.tape} s`);
    await page.click('[data-act="count"]');
    await page.waitForFunction(() => window.__kstate()?.rolling === true, null, { timeout: 15000 });
    const during = await E(() => { const p = window.overdub.store.get(); const sh = p.tracks.find((t) => t.id === p.room?.tracks?.shaker); return { hold: window.__kstate().hold, shaker: sh ? sh.clips.reduce((a, c) => a + c.notes.length, 0) : 0, tempo: p.tempo, log: window.__k.log.join(' ') }; });
    T.ok(during.hold && during.shaker > 100 && during.tempo === 96 && /^countIn:sticks:1 take/.test(during.log), `Count me in: one bar of sticks, the shaker on 96 under the take (${during.log}; ${during.shaker} shaker notes, a preview)`);
    await page.waitForFunction((x) => window.__k.pos() >= x, tape.T.end + 0.3, { timeout: 90000, polling: 20 });
    await page.keyboard.press('Space');   // That's a take
    await page.waitForFunction(() => window.__kstate()?.offer === 'shaker', null, { timeout: 60000 });
    const after = await E(() => {
      const app = window.overdub, p = app.store.get();
      const take = p.tracks.find((t) => t.id === p.room.tracks.take).clips.find((c) => c.kind === 'audio');
      return { map: !!p.tempoMap, tempo: p.tempo, master: p.room.master === take?.id, name: take?.name, offset: take?.offset || 0, sections: p.sections.map((s) => s.name), steps: app.store.history.map((x) => `${x.label}:${x.by}`) };
    });
    const asked = after.steps.some((x) => /^On the beat/.test(x));
    T.ok(!after.map && after.tempo === 96 && after.master && !asked && after.sections.length >= 2 && after.steps.some((x) => /^96 BPM:you$/.test(x)) && after.steps.some((x) => /^The band read take 1:overdub$/.test(x)), `Count me in: no question about the time, the band read the chords on 96 (${after.sections.join(', ')}; ${after.steps.slice(-3).join(' · ')})`);
    T.ok(/· take 1 · capo 3 · 96$/.test(after.name || '') && after.offset === 0, `Count me in: the take named with its tempo, nothing trimmed from a counted take (${after.name}, offset ${after.offset})`);
  } catch (e) {
    let why = '';
    try { const k = await E(() => { const s = window.__kstate(); return s && { step: s.step, ask: s.ask, offer: s.offer, rolling: s.rolling, reading: s.reading, offered: s.offered?.id, pos: +window.__k.pos().toFixed(2), log: window.__k.log, lines: window.__k.lines.slice(-3) }; }); why = ` ${JSON.stringify(k)}`; } catch { /* the page is gone */ }
    T.ok(false, `Count me in: ${e.message.split('\n')[0]}${why}`);
  } finally {
    await S.close();
  }
}
