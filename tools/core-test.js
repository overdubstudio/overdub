// The core in Node: the song document, ops and their inverses, the store's transactions and undo, the text formats.
import { createStore } from '../app/src/core/store.js';
import { parseNotes, formatNotes, parseGrid, formatGrid, chordName, snapToScale, parsePitch, noteName, quantize, validMeter, keySpelling, spellPc, spellNote } from '../app/src/core/music.js';
import { summarize, validateProject, cleanProject, createProject, LIMITS, songSize, sizeError, NAME_MAX, } from '../app/src/core/project.js';
import { demoProject } from '../app/src/core/demo.js';
import { OP_TYPES, OPS } from '../app/src/core/ops.js';
import { tally } from './pw.js';

const t = tally('core');
const snap = (s) => JSON.stringify(s.get().tracks);
// canonical JSON (sorted keys): the same song, whatever order its keys were written in
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v));
const same = (a, b) => canon(a) === canon(b);

// text formats
t.ok(parsePitch('C4') === 60 && parsePitch('F#3') === 54 && parsePitch('Bb2') === 46 && parsePitch('60') === 60, 'pitch names');
t.ok(noteName(61) === 'C#4', 'note names');
const ns = parseNotes('C4@0:0.5 E4@0.5:0.5*0.9, G4@1:1');
t.ok(ns.length === 3 && ns[1].v === 0.9 && ns[2].d === 1, 'parseNotes');
t.ok(formatNotes(ns) === 'C4@0:0.5 E4@0.5:0.5*0.9 G4@1:1', 'formatNotes round trip: ' + formatNotes(ns));
let threw = ''; try { parseNotes('C4@0:0.5 nope'); } catch (e) { threw = e.message; }
t.ok(/expected pitch@start:dur/.test(threw), 'a bad note says what it expected');
const grid = { steps: 16, rows: { kick: 'x...x...x...x...', snare: '....X.......X..o', hat: 'x.x.x.x.x.x.x.x.' } };
const g = parseGrid(grid);
t.ok(g.length === 4 + 3 + 8, 'parseGrid hits: ' + g.length);
t.ok(formatGrid(g).rows.kick === grid.rows.kick && formatGrid(g).rows.snare === grid.rows.snare, 'formatGrid round trip');
t.ok(chordName([57, 60, 64, 67]) === 'Am7' && chordName([52, 55, 60]) === 'C/E', 'chord names: ' + chordName([52, 55, 60]));
{
  // spelled for the key: one letter per degree, the key's side for the rest
  const cm = { root: 'C', scale: 'minor' }, eM = { root: 'E', scale: 'major' }, fs = { root: 'F#', scale: 'major' }, ds = { root: 'D#', scale: 'major' };
  const sp = (k) => keySpelling(k).join(' ');
  t.ok(chordName([56, 60, 63], cm) === 'Ab' && chordName([56, 60, 63]) === 'G#' && chordName([55, 58, 63], cm) === 'Eb/G' && chordName([53, 56, 60, 63], cm) === 'Fm7' && spellPc(10, cm) === 'Bb' && spellNote(68, cm) === 'Ab4', `in C minor, Ab not G# (${chordName([56, 60, 63], cm)}, ${chordName([55, 58, 63], cm)}, ${chordName([53, 56, 60, 63], cm)})`);
  t.ok(sp(eM).includes('G#') && sp(eM).includes('C#') && !/b/.test(sp(eM)) && spellPc(5, fs) === 'E#' && spellPc(3, ds) === 'Eb' && spellPc(8, { root: 'A', scale: 'minor' }) === 'Ab', `sharps in E major (${sp(eM)}), E# in F# major, D# major read as Eb, A minor's borrowed Ab`);
}
t.ok(snapToScale(61, { root: 'C', scale: 'major' }) === 60 || snapToScale(61, { root: 'C', scale: 'major' }) === 62, 'snap to scale');
t.ok(Math.abs(quantize(1.1, 0.25) - 1) < 1e-9 && Math.abs(quantize(1.1, 0.25, 0.5) - 1.05) < 1e-9, 'quantize with strength');

// store: refs, attribution, atomicity
const s = createStore();
let r = s.dispatch([
  { type: 'track.add', ref: 'bass', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
  { type: 'clip.add', track: '$bass', ref: 'v1', clip: { start: 0, notes: 'A1@0:0.5 E2@1:0.5' } },
  { type: 'notes.add', track: '$bass', clip: '$v1', notes: 'G1@2:1' },
  { type: 'insert.add', track: '$bass', ref: 'fx', insert: { device: 'core.drive', params: { drive: 4 } } },
], { by: 'claude', label: 'a bassline' });
t.ok(r.ok && r.created.bass && r.created.v1 && r.created.fx, 'refs resolve inside one transaction');
const bass = s.get().tracks[0];
t.ok(bass.by === 'claude' && bass.clips[0].notes.every((n) => n.by === 'claude' && n.id), 'everything the agent made is signed by it');
t.ok(bass.clips[0].length === 4, 'a clip sizes itself to its notes');
const before = snap(s);
r = s.dispatch([{ type: 'track.set', track: bass.id, patch: { gain: -3 } }, { type: 'clip.set', track: bass.id, clip: 'nope', patch: { start: 1 } }]);
t.ok(!r.ok && /op 2 of 2/.test(r.error) && /rolled back/.test(r.error), 'a failing op rolls back the whole transaction');
t.ok(snap(s) === before, '…and nothing changed');
r = s.dispatch({ type: 'insert.add', track: bass.id, insert: { device: 'x' } });
t.ok(r.ok, 'without a device registry any device id is accepted');

// every op has an exact inverse: apply, undo, compare
const s2 = createStore(demoProject());
const pristine = JSON.stringify(s2.get());
const tr = s2.get().tracks[1], cl = tr.clips[0], fx = s2.get().tracks[2].inserts[0];
const trials = [
  { type: 'project.set', patch: { tempo: 101, title: 'X', key: { root: 'D', scale: 'dorian' }, loop: { on: false } } },
  { type: 'track.add', track: { name: 'New', kind: 'audio' }, index: 1 },
  // (the tempo map: core/music.js; tools/tempomap-test.js holds the rest)
  { type: 'tempo.map', map: { anchors: [{ beat: 0, sec: 0 }, { beat: 4, sec: 2.5 }, { beat: 8, sec: 5.1 }], clip: 'c_x' } },
  { type: 'track.remove', track: tr.id },
  { type: 'track.move', track: tr.id, index: 3 },
  { type: 'track.set', track: tr.id, patch: { name: 'B', gain: -9, pan: 0.5, mute: true } },
  { type: 'instrument.set', track: tr.id, device: 'core.poly', params: { cutoff: 900 } },
  { type: 'instrument.set', track: tr.id, params: { drive: 3 } },
  { type: 'insert.add', track: tr.id, insert: { device: 'core.comp' }, index: 0 },
  { type: 'insert.add', track: 'master', insert: { device: 'core.limiter' } },
  { type: 'insert.remove', track: s2.get().tracks[2].id, insert: fx.id },
  { type: 'insert.move', track: s2.get().tracks.find((x) => x.name === 'Guitar').id, insert: s2.get().tracks.find((x) => x.name === 'Guitar').inserts[0].id, index: 2 },
  { type: 'insert.set', track: s2.get().tracks[2].id, insert: fx.id, patch: { on: false, params: { mix: 3, size: 8 } } },
  { type: 'clip.add', track: tr.id, clip: { start: 40, notes: 'C3@0:1' } },
  { type: 'clip.remove', track: tr.id, clip: cl.id },
  { type: 'clip.set', track: tr.id, clip: cl.id, patch: { start: 2, length: 8, name: 'renamed' } },
  { type: 'clip.move', track: tr.id, clip: cl.id, toTrack: s2.get().tracks[2].id, start: 12 },
  { type: 'notes.add', track: tr.id, clip: cl.id, notes: 'C3@0:1 D3@1:1' },
  { type: 'notes.remove', track: tr.id, clip: cl.id, ids: cl.notes.slice(0, 3).map((n) => n.id) },
  { type: 'notes.set', track: tr.id, clip: cl.id, notes: [{ id: cl.notes[0].id, p: 40, t: 0.25, v: 0.3 }] },
  { type: 'notes.replace', track: tr.id, clip: cl.id, grid: grid },
  { type: 'section.add', section: { name: 'Bridge', start: 32, length: 8 } },
  { type: 'section.set', section: s2.get().sections[0].id, patch: { name: 'Intro', length: 8 } },
  { type: 'section.remove', section: s2.get().sections[1].id },
  { type: 'device.define', device: { id: 'you.tiny', name: 'Tiny', kind: 'effect', params: [], kernel: '({ create() { return { process() {} }; } })' } },
  { type: 'master.set', patch: { gain: -3 } },
  { type: 'asset.add', asset: { id: 'a_test01', kind: 'audio', name: 'take 1', sr: 48000, channels: 1, duration: 2 } },
  { type: 'reference.set', reference: { asset: 'a_ref001', name: 'ref.wav', sr: 48000, channels: 2, duration: 3, profile: { lufs: -9, bands: { mid: -4 } } } },
  // arrangement ops (core/arrangement.js; tools/arrangement-test.js has the musical checks)
  { type: 'section.duplicate', section: s2.get().sections[0].id, push: true },
  { type: 'time.insert', at: 6, length: 4 },
  { type: 'time.remove', at: 6, length: 12 },
  { type: 'clip.repeat', track: tr.id, clip: cl.id, times: 3 },
  { type: 'clip.repeat', track: tr.id, clip: cl.id, times: 2, mode: 'loop' },
  { type: 'clip.split', track: tr.id, clip: cl.id, at: cl.start + 2.5 },
  { type: 'clip.trim', track: tr.id, clip: cl.id, end: cl.start + cl.length - 0.6, snap: 'beat' },
  // automation (core/automation.js; tools/automation-test.js has the fuzz)
  { type: 'auto.write', track: tr.id, param: 'gain', points: '0:-60 16:-6~0.5 32:-6' },
  // the live room (core/liveroom/; tools/liveroom/checks-model.js has the rest): each makes its field when the song has none
  { type: 'room.set', patch: { place: 'metal', tuning: 'drop-c', finish: 'tight', tracks: { drums: s2.get().tracks[0].id, guitarL: tr.id } } },
  { type: 'room.part.set', section: s2.get().sections[0].id, patch: { feel: 'build', reps: 2, oneSide: true } },
  { type: 'sheet.set', patch: { capo: 2, time: [3, 4], notes: 'Slow.' } },
  { type: 'sheet.section.add', section: { name: 'Verse 1', lines: [{ text: 'Somewhere a [G]paper [Em]moon' }] } },
  { type: 'section.move', section: s2.get().sections[1].id, before: s2.get().sections[0].id },
];
{
  // the room's and the sheet's other ops need them there first: each undoes back to the song with them, exactly
  const made = s2.dispatch([
    { type: 'room.set', patch: { place: 'basement', rig: 'crunch', tracks: { drums: s2.get().tracks[0].id }, managed: { master: { gain: -1 } } } },
    { type: 'room.part.set', section: s2.get().sections[0].id, patch: { feel: 'straight', busy: 1 } },
    { type: 'sheet.section.add', ref: 'ss', section: { name: 'Verse 1', lines: [{ text: 'one [G]line' }, { text: 'two [C]lines' }] } },
  ], { by: 'you' });
  t.ok(made.ok, 'a room and a sheet to work on ' + (made.error || ''));
  const withRoom = JSON.stringify(s2.get());
  const ss = made.created.ss, line = s2.get().sheet.sections[0].lines[1].id;
  const ops = [
    { type: 'room.set', patch: { finish: 'raw', tracks: null } },
    { type: 'room.set', clear: true },
    { type: 'room.part.set', section: s2.get().sections[0].id, patch: { busy: null, feel: null } },
    { type: 'room.part.set', section: s2.get().sections[0].id, remove: true },
    { type: 'sheet.set', clear: true },
    { type: 'sheet.section.set', section: ss, patch: { name: 'First verse' } },
    { type: 'sheet.section.remove', section: ss },
    { type: 'sheet.line.add', section: ss, line: { text: 'three [D]lines' }, index: 1 },
    { type: 'sheet.line.set', section: ss, line, patch: { text: 'two [Am]lines' } },
    { type: 'sheet.line.remove', section: ss, line },
    { type: 'section.duplicate', section: s2.get().sections[0].id },
  ];
  for (const op of ops) {
    const res = s2.dispatch(op, { by: 'claude' });
    const done = JSON.stringify(s2.get());
    s2.undo();
    const back = canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(withRoom), meta: null });
    const rr = s2.redo();
    const again = rr.ok && canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(done), meta: null });
    s2.undo();
    t.ok(res.ok && back && again, `${op.type}${op.clear ? ' clear' : op.remove ? ' remove' : ''} undoes and redoes exactly${res.ok ? '' : ': ' + res.error}`);
    if (res.ok && op.type !== 'section.duplicate') trials.push({ type: op.type, _skip: true });
  }
  s2.undo();
  t.ok(canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine), meta: null }), '…and the room and the sheet undo to none at all');
}
{
  // auto.clear and auto.set need a lane to work on: each undoes back to the song with the lane, exactly
  s2.dispatch({ type: 'auto.write', track: tr.id, param: 'pan', points: '0:-1 8:1' }, { by: 'you' });
  const withLane = JSON.stringify(s2.get());
  for (const op of [{ type: 'auto.clear', track: tr.id, param: 'pan', from: 4, to: 8 }, { type: 'auto.clear', track: tr.id, param: 'pan' }, { type: 'auto.set', track: tr.id, param: 'pan', patch: { off: true } }]) {
    const res = s2.dispatch(op, { by: 'claude' }); s2.undo();
    t.ok(res.ok && canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(withLane), meta: null }), `${op.type} undoes exactly${res.ok ? '' : ': ' + res.error}`);
    if (res.ok) trials.push({ type: op.type, _skip: true });
  }
  s2.undo();
}
s2.dispatch({ type: 'device.define', device: { id: 'you.keep', name: 'Keep', kind: 'effect', params: [], kernel: '({})' } });
const pristine2 = JSON.stringify(s2.get());
const rm = s2.dispatch({ type: 'device.remove', id: 'you.keep' }); s2.undo();
t.ok(rm.ok && canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine2), meta: null }), 'device.remove undoes exactly');
s2.undo();
if (rm.ok) trials.push({ type: 'device.remove', _skip: true });
s2.dispatch({ type: 'asset.add', asset: { id: 'a_keep01', name: 'kept', sr: 48000, channels: 1, duration: 1 } });
const pristine3 = JSON.stringify(s2.get());
const ar = s2.dispatch({ type: 'asset.remove', id: 'a_keep01' }); s2.undo();
t.ok(ar.ok && canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine3), meta: null }), 'asset.remove undoes exactly');
s2.undo();
if (ar.ok) trials.push({ type: 'asset.remove', _skip: true });
// the reference (ui/reference.js): replacing and clearing one undo exactly, and it is never a track
s2.dispatch({ type: 'reference.set', reference: { asset: 'a_ref0a', name: 'first.wav', duration: 2, profile: { lufs: -10 } } }, { by: 'you' });
const pristine4 = JSON.stringify(s2.get());
const rf1 = s2.dispatch({ type: 'reference.set', reference: { asset: 'a_ref0b', name: 'second.wav', duration: 4, profile: { lufs: -8 } } }); s2.undo();
const back1 = canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine4), meta: null });
const rf2 = s2.dispatch({ type: 'reference.set', reference: null }); const cleared = !('reference' in s2.get()); s2.undo();
const back2 = canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine4), meta: null });
t.ok(rf1.ok && rf2.ok && back1 && back2 && cleared && s2.get().reference.by === 'you' && s2.get().tracks.length === JSON.parse(pristine).tracks.length, 'reference.set replaces and clears, and undoes exactly');
s2.undo();
t.ok(!('reference' in s2.get()), '…and the first one undoes to no reference at all');
// a reference with no measured profile can't be drawn (the Reference tab reads profile.lufs): the op refuses it, and a
// loaded song (a share link, a project file) drops it
{
  const pre = JSON.stringify(s2.get());
  const bad = [{ name: 'x' }, { name: 'x.mp3', asset: 'a_zzzzzz' }, { name: 'x', profile: {} }, { name: 'x', profile: { lufs: 'loud' } }, { name: 'x', profile: null }];
  const res = bad.map((reference) => s2.dispatch({ type: 'reference.set', reference }, { by: 'claude' }));
  t.ok(res.every((r) => !r.ok && /profile/.test(r.error)) && JSON.stringify(s2.get()) === pre, 'reference.set refuses a reference without a measured profile: ' + res[0].error);
  const loaded = bad.map((reference) => 'reference' in cleanProject({ ...createProject(), reference }));
  const good = cleanProject({ ...createProject(), reference: { name: 'ok.wav', asset: 'a_ok0001', profile: { lufs: -9 } } });
  t.ok(loaded.every((x) => !x) && good.reference?.name === 'ok.wav', 'a loaded song drops a reference without a profile and keeps a measured one');
}
// define a device and place it in one transaction (the agent's one-undo-step "build me a pedal")
const s4 = createStore(undefined, { getDevice: () => null });
const both = s4.dispatch([{ type: 'track.add', ref: 'g', track: { name: 'G', kind: 'audio' } },
  { type: 'device.define', device: { id: 'claude.x', name: 'X', kind: 'effect', params: [], kernel: '({})' } },
  { type: 'insert.add', track: '$g', insert: { device: 'claude.x' } }], { by: 'claude', reason: 'asked for X' });
t.ok(both.ok && both.txn.reason === 'asked for X', 'a device can be written and placed in one undo step, with a reason ' + (both.error || ''));
const pv = s4.preview({ type: 'track.set', track: s4.get().tracks[0].id, patch: { gain: -12 } });
const heard = s4.get().tracks[0].gain; pv.release();
t.ok(heard === -12 && s4.get().tracks[0].gain === 0 && s4.history.length === 1, 'preview applies and releases without touching history');
const tested = new Set();
for (const op of trials) {
  if (op._skip) { tested.add(op.type); continue; }
  const res = s2.dispatch(op, { by: 'claude' });
  if (!t.ok(res.ok, `${op.type} applies${res.ok ? '' : ': ' + res.error}`)) continue;
  tested.add(op.type);
  const u = s2.undo();
  const back = canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine), meta: null });
  t.ok(u.ok && back, `${op.type} undoes exactly`);
  const rr = s2.redo(); s2.undo();
  t.ok(rr.ok, `${op.type} redoes`);
}
t.ok(OP_TYPES.every((x) => tested.has(x)), 'every op type is covered: missing ' + OP_TYPES.filter((x) => !tested.has(x)).join(', '));

// three grains of undo
const s3 = createStore(demoProject());
const drums = s3.get().tracks[0];
const g0 = drums.gain;
s3.dispatch({ type: 'track.set', track: drums.id, patch: { gain: -1 } }, { by: 'claude' });
s3.dispatch({ type: 'track.set', track: drums.id, patch: { pan: 0.3 } }, { by: 'you' });
s3.dispatch({ type: 'track.set', track: drums.id, patch: { mute: true } }, { by: 'claude' });
const u = s3.undo({ by: 'claude' });
t.ok(u.ok && drums.mute === false && drums.pan === 0.3 && drums.gain === -1, "undo({ by }) takes back only that author's latest");
s3.dispatch({ type: 'track.set', track: drums.id, patch: { solo: true } }, { by: 'claude' });
const rv = s3.revertAuthor('claude');
t.ok(rv.ok && rv.reverted === 2 && drums.gain === g0 && drums.solo === false && drums.pan === 0.3, "revertAuthor keeps the human's edits");

// coalescing: a knob drag is one undo step
for (const v of [1, 2, 3, 4]) s3.dispatch({ type: 'track.set', track: drums.id, patch: { gain: -v } }, { coalesce: 'gain' });
const n = s3.history.length; s3.undo();
t.ok(drums.gain === g0 && s3.history.length === n - 1, 'a coalesced gesture undoes in one step');

// note ids are never reused: an author's undo can't land on someone else's note
{
  const s = createStore();
  const r0 = s.dispatch([{ type: 'track.add', ref: 'k', track: { name: 'Keys' } }, { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, notes: 'C4@0:1 E4@1:1' } }], { by: 'you' });
  const tk = r0.created.k, ck = r0.created.c;
  const add = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'G4@2:1 B4@3:1' }, { by: 'claude' });
  s.dispatch({ type: 'notes.remove', track: tk, clip: ck, ids: [add.created.notes[1]] }, { by: 'you' });
  const mine = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'D5@3.5:0.5' }, { by: 'you' });
  t.ok(!add.created.notes.includes(mine.created.notes[0]), `a freed note id isn't handed out again (claude's ${add.created.notes.join(', ')}, then yours ${mine.created.notes[0]})`);
  const u = s.undo({ by: 'claude' });
  const left = s.clip(tk, ck).notes.map((n) => `${n.p}:${n.by}`).join(' ');
  t.ok(u.ok && left === '60:you 64:you 74:you', `undo({ by: 'claude' }) takes back only claude's notes; your D5 stays (${left})`);
  // …and the clip's counter survives the clip being deleted and put back
  s.dispatch({ type: 'notes.remove', track: tk, clip: ck, ids: [mine.created.notes[0]] }, { by: 'you' });
  s.dispatch({ type: 'clip.remove', track: tk, clip: ck }, { by: 'you' }); s.undo();
  const again = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'F5@3:1' }, { by: 'you' });
  t.ok(again.created.notes[0] !== mine.created.notes[0] && !add.created.notes.includes(again.created.notes[0]), `…and through a deleted and restored clip (${again.created.notes[0]})`);
  // defense in depth: a note claude added that you then edited is yours now, and claude's undo leaves it
  const c2 = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'A5@0:1' }, { by: 'claude' }).created.notes[0];
  s.dispatch({ type: 'notes.set', track: tk, clip: ck, notes: [{ id: c2, v: 0.5 }] }, { by: 'you' });
  const u2 = s.undo({ by: 'claude' });
  t.ok(!u2.ok && /stays/.test(u2.error) && s.clip(tk, ck).notes.some((n) => n.id === c2 && n.by === 'you'), `an undo by claude won't delete a note you've since edited: "${u2.error}"`);
}

// a transaction is all or nothing, even when the op that fails changed something before it threw
{
  const s = createStore(demoProject());
  const tr = s.get().tracks[1], cl = tr.clips[0], fxTrack = s.get().tracks.find((x) => x.inserts.length);
  const n1 = cl.notes[0];
  const doc0 = s.get();
  const fails = [
    ['project.set title + a bad tempo', { type: 'project.set', patch: { title: 'New', tempo: 9999 } }],
    ['project.set a backwards loop', { type: 'project.set', patch: { loop: { start: 12, end: 4 } } }],
    ['project.set a meter of 4/2^40 (a bar 1e-11 beats long)', { type: 'project.set', patch: { meter: [4, 2 ** 40] } }],
    ['project.set a meter of 4/12', { type: 'project.set', patch: { meter: [4, 12] } }],
    ['project.set a meter of 33/4', { type: 'project.set', patch: { meter: [33, 4] } }],
    ['project.set a meter of 0/4', { type: 'project.set', patch: { meter: [0, 4] } }],
    ['track.set name + a bad gain', { type: 'track.set', track: tr.id, patch: { name: 'Renamed', gain: 999 } }],
    ['notes.set a good note + a missing one', { type: 'notes.set', track: tr.id, clip: cl.id, notes: [{ id: n1.id, p: 50 }, { id: 'nzz' }] }],
    ['instrument.set a new device + a bad param', { type: 'instrument.set', track: tr.id, device: 'core.poly', params: { cutoff: { no: 1 } } }],
    ['insert.set on + a bad param', { type: 'insert.set', track: fxTrack.id, insert: fxTrack.inserts[0].id, patch: { on: false, params: { mix: 1, size: [1] } } }],
    ['clip.set name + a bad start', { type: 'clip.set', track: tr.id, clip: cl.id, patch: { name: 'x', start: -1 } }],
    ['section.set name + a bad start', { type: 'section.set', section: s.get().sections[0].id, patch: { name: 'x', start: 'soon' } }],
  ];
  for (const [what, op] of fails) {
    const was = canon(s.get()), h = s.history.length;
    const r = s.dispatch(op, { by: 'claude' });
    t.ok(!r.ok && canon(s.get()) === was && s.history.length === h && /nothing was changed/.test(r.error), `${what}: refused, and the song is exactly as it was (${r.error})`);
  }
  // the safety net: an op that changes the song and then throws is put back from a snapshot, the doc object kept
  OPS['test.half'] = (p) => { p.title = 'half'; p.tracks[0].gain = -40; throw new Error('halfway'); };
  const was = canon(s.get());
  const r = s.dispatch([{ type: 'track.set', track: tr.id, patch: { gain: -6 } }, { type: 'test.half' }], { by: 'claude' });
  delete OPS['test.half'];
  t.ok(!r.ok && canon(s.get()) === was && s.get() === doc0 && /nothing was changed/.test(r.error), 'an op that throws halfway leaves nothing behind (the store keeps the same song object)');
}

// insert.add by track name: the undo names the track by id, so a rename doesn't strand it
{
  const s = createStore();
  const b = s.dispatch({ type: 'track.add', track: { name: 'Bass' } }).created.track;
  const fxr = s.dispatch({ type: 'insert.add', track: 'Bass', insert: { device: 'core.eq' } }, { by: 'claude' });
  t.ok(fxr.txn.inverse[0].track === b, 'insert.add records its inverse by track id');
  s.dispatch({ type: 'track.set', track: b, patch: { name: 'Low end' } }, { by: 'you' });
  const u = s.undo({ by: 'claude' });
  t.ok(u.ok && s.track(b).inserts.length === 0 && s.track(b).name === 'Low end', `undo({ by }) removes the effect after a rename${u.ok ? '' : ': ' + u.error}`);
  s.dispatch({ type: 'insert.add', track: 'low END', insert: { device: 'core.eq' } }, { by: 'claude' });
  s.dispatch({ type: 'track.set', track: b, patch: { name: 'Sub' } }, { by: 'you' });
  const rv = s.revertAuthor('claude');
  t.ok(rv.ok && rv.reverted === 1 && s.track(b).inserts.length === 0, `revertAuthor removes it too${rv.ok ? '' : ': ' + JSON.stringify(rv.skipped.map((x) => x.error))}`);
}

// a device this browser hasn't loaded: deleting the track or effect can be undone and redone
{
  const getDevice = (id) => (id.startsWith('core.') ? { id, kind: /eq|drive|comp|verb|limiter|delay/.test(id) ? 'effect' : 'instrument' } : null);
  const song = { title: 'Missing', tracks: [{ id: 't_miss01', name: 'Wobble', instrument: { device: 'sam.wobble', params: { depth: 3 } }, inserts: [{ id: 'fx_miss01', device: 'pedal.future', params: { warp: 2 } }], clips: [{ id: 'c_miss01', start: 0, length: 4, notes: [{ p: 48, t: 0, d: 1, v: 0.8, by: 'you' }] }] }] };
  const s = createStore(song, { getDevice });
  const was = canon(s.get().tracks);
  let r = s.dispatch({ type: 'insert.remove', track: 't_miss01', insert: 'fx_miss01' });
  let u = s.undo();
  t.ok(r.ok && u.ok && canon(s.get().tracks) === was, `undo puts back an effect whose device isn't loaded${u.ok ? '' : ': ' + u.error}`);
  t.ok(s.redo().ok && s.get().tracks[0].inserts.length === 0 && s.undo().ok, '…and redoes');
  r = s.dispatch({ type: 'track.remove', track: 't_miss01' });
  u = s.undo();
  t.ok(r.ok && u.ok && canon(s.get().tracks) === was, `undo puts back a track on a device that isn't loaded, clips and all${u.ok ? '' : ': ' + u.error}`);
  t.ok(s.redo().ok && s.get().tracks.length === 0 && s.undo().ok && s.get().tracks.length === 1, '…and redoes');
  s.dispatch({ type: 'track.remove', track: 't_miss01' }, { by: 'claude' });
  const rv = s.revertAuthor('claude');
  t.ok(rv.ok && rv.reverted === 1 && canon(s.get().tracks) === was, 'revertAuthor puts it back too');
  const fresh = s.dispatch({ type: 'insert.add', track: 't_miss01', insert: { device: 'pedal.future' } });
  t.ok(!fresh.ok && /no device/.test(fresh.error), 'a new effect on an unknown device is still refused');
}

// revertAuthor with a since that isn't in the history reverts nothing
{
  const s = createStore();
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(s.dispatch({ type: 'track.add', track: { name: 'T' + i } }, { by: 'claude' }).txn.id);
  s.undo({ by: 'claude' });
  const rv = s.revertAuthor('claude', { since: ids[4] });
  t.ok(!rv.ok && rv.reverted === 0 && /nothing was reverted/.test(rv.error) && s.get().tracks.length === 4 && s.canRedo(), `a stale since reverts nothing and keeps the redo (${rv.error})`);
  const ok = s.revertAuthor('claude', { since: ids[2] });
  t.ok(ok.ok && ok.reverted === 2 && s.get().tracks.length === 2, 'a since in the history reverts from there on');
}

// notes.set naming one note twice undoes to where it started; clip.set offset on a clip that had none undoes
{
  const s = createStore();
  const r0 = s.dispatch([{ type: 'track.add', ref: 'k', track: { name: 'K' } }, { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, notes: [{ p: 36, t: 0, d: 1 }] } }], { by: 'you' });
  const tk = r0.created.k, ck = r0.created.c, nid = s.clip(tk, ck).notes[0].id;
  s.dispatch({ type: 'notes.set', track: tk, clip: ck, notes: [{ id: nid, p: 40 }, { id: nid, p: 45 }] }, { by: 'claude' });
  s.undo();
  const n = s.clip(tk, ck).notes[0];
  t.ok(n.p === 36 && n.by === 'you', `notes.set with one note twice undoes to its first value (${n.p}, by ${n.by})`);
  t.ok(s.redo().ok && s.clip(tk, ck).notes[0].p === 45 && s.undo().ok, '…and redoes to its last');
  const was = canon(s.clip(tk, ck));
  const r = s.dispatch({ type: 'clip.set', track: tk, clip: ck, patch: { offset: 1 } });
  const u = s.undo();
  t.ok(r.ok && u.ok && canon(s.clip(tk, ck)) === was, `clip.set offset on a clip without one undoes${u.ok ? '' : ': ' + u.error}`);
}

// meters: 1 to 32 beats of 1, 2, 4, 8, 16 or 32; anything else is refused or put back to 4/4 on load
t.ok(validMeter([4, 4]) && validMeter([7, 8]) && validMeter([1, 1]) && validMeter([32, 32]) && ![[4, 64], [4, 2 ** 31], [0, 4], [33, 4], [4.5, 4], [4, 3], [4], '4/4', null].some(validMeter), 'validMeter: 1–32 beats of 1, 2, 4, 8, 16 or 32');
{
  const s = createStore(createProject());
  t.ok(s.dispatch({ type: 'project.set', patch: { meter: [7, 8] } }).ok && s.get().meter.join('/') === '7/8', 'project.set takes 7/8');
  const crafted = { ...createProject(), meter: [4, 2 ** 40] };
  t.ok(cleanProject(crafted).meter.join('/') === '4/4' && cleanProject({ ...createProject(), meter: [6, 8] }).meter.join('/') === '6/8', `cleanProject puts an out-of-range meter (a share link's, a file's) back to 4/4: ${cleanProject(crafted).meter}`);
  t.ok(createStore(crafted).get().meter.join('/') === '4/4', 'a store made from that song has 4/4');
  const tp = (tempo) => cleanProject({ ...createProject(), tempo }).tempo;
  t.ok(tp(97.5) === 97.5 && tp(0.0001) === 20 && tp(1e12) === 400 && tp('fast') === 120 && tp(null) === 120 && tp(undefined) === 120, `cleanProject holds a loaded tempo to 20–400 bpm (0.0001 -> ${tp(0.0001)}, 1e12 -> ${tp(1e12)}, "fast" -> ${tp('fast')})`);
}

// growth limits (core/project.js LIMITS): the store refuses any op that takes the song past one, primitives included
{
  const s = createStore(createProject());
  const clips = Array.from({ length: LIMITS.clips + 1 }, (_, i) => ({ start: i, length: 1, notes: [] }));
  const before = JSON.stringify(s.get());
  const r = s.dispatch({ type: 'track.add', track: { name: 'Many', instrument: { device: 'core.keys' }, clips } }, { by: 'mcp:x' });
  t.ok(!r.ok && /a song holds up to 4,096/.test(r.error) && JSON.stringify(s.get()) === before, `a track.add carrying ${LIMITS.clips + 1} clips is refused, nothing changed: "${(r.error || '').slice(0, 90)}"`);
  const big = s.dispatch({ type: 'track.add', track: { name: 'Big', instrument: { device: 'core.keys' }, clips: [{ start: 0, length: 4, notes: Array.from({ length: LIMITS.clipNotes + 1 }, (_, i) => ({ p: 60, t: i / 10000, d: 0.02 })) }] } }, { by: 'mcp:x' });
  t.ok(!big.ok && /a clip holds up to 20,000/.test(big.error), 'a track.add with a 20,001-note clip is refused');
  const ok = s.dispatch({ type: 'track.add', track: { name: 'Fine', instrument: { device: 'core.keys' }, clips: clips.slice(0, 64) } }, { by: 'you' });
  t.ok(ok.ok && songSize(s.get()).clips === 64 && sizeError(songSize(s.get())) === null, 'an ordinary track.add goes in');
}

// the demo and the agent view
t.ok(validateProject(demoProject()).length === 0, 'the demo song is valid');
const text = summarize(demoProject());
t.ok(/Night Shift/.test(text) && /track t_\w+ "Bass"/.test(text) && /A1@0:0.75/.test(text), 'summarize shows tracks and notes in the text format');
// project.set refuses a title that isn't text (a share link or an agent could send an object; the UI's sink is closed
// too, but the song should never hold one)
{
  const s = createStore(createProject());
  const before = JSON.stringify(s.get());
  const bad = [{ html: '<img src=x onerror=alert(1)>' }, ['x'], 42, 'x'.repeat(201)];
  const results = bad.map((title) => s.dispatch({ type: 'project.set', patch: { title } }, { by: 'mcp:probe' }));
  t.ok(results.every((r) => !r.ok && /title must be text/.test(r.error)) && JSON.stringify(s.get()) === before, 'project.set refuses a title that is not text (an object, an array, a number, 201 characters), and nothing changes');
  const ok = s.dispatch({ type: 'project.set', patch: { title: 'Night Shift (mine)' } }, { by: 'you' });
  t.ok(ok.ok && s.get().title === 'Night Shift (mine)', 'and a text title still sets');
}

// names set by an op: a rename was any length (and clip.set took any value), and every name and the title kept control
// and bidi characters, which can turn a name round to read as another. A rename past NAME_MAX is refused like a long
// title; control and bidi characters are dropped; a new thing's name is cut, never refused (a duplicate's "Chorus 2",
// an importer's name, a device from a file)
{
  const s = createStore(createProject());
  const r0 = s.dispatch([{ type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } }, { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, length: 4, notes: 'C4@0:1' } }, { type: 'section.add', ref: 's', section: { name: 'Verse', start: 0, length: 4 } }], { by: 'you' });
  const { k, c, s: sec } = r0.created;
  const before = canon({ ...s.get(), meta: null });
  const long = 'n'.repeat(NAME_MAX + 1);
  const refused = [
    { type: 'track.set', track: k, patch: { name: long } },
    { type: 'clip.set', track: k, clip: c, patch: { name: long } },
    { type: 'clip.set', track: k, clip: c, patch: { name: { html: '<b>x</b>' } } },
    { type: 'section.set', section: sec, patch: { name: long } },
  ].map((op) => s.dispatch(op, { by: 'mcp:probe' }));
  t.ok(refused.every((r) => !r.ok && /name must be text, 100 characters at most/.test(r.error)) && canon({ ...s.get(), meta: null }) === before, `a rename past ${NAME_MAX} characters, or not text, is refused and nothing changes: "${refused[0].error}"`);
  const set = s.dispatch([{ type: 'track.set', track: k, patch: { name: 'Keys\u0000\u001b\u202e ☕ Ünï' } }, { type: 'clip.set', track: k, clip: c, patch: { name: 'Hook\u0085' } }, { type: 'section.set', section: sec, patch: { name: '\u2067Chorus\u2069' } },
    { type: 'project.set', patch: { title: '\u202eNight\u0007 Shift' } }, { type: 'device.define', device: { id: 'you.named', name: '\u202eNamed', kind: 'effect', params: [], kernel: '({})', presets: [{ name: 'Soft\u0000', params: {} }] } }], { by: 'you' });
  const p = s.get(), dev = p.devices['you.named'];
  t.ok(set.ok && p.tracks[0].name === 'Keys ☕ Ünï' && s.clip(k, c).name === 'Hook' && p.sections[0].name === 'Chorus' && p.title === 'Night Shift' && dev.name === 'Named' && dev.presets[0].name === 'Soft',
    `control and bidi characters are dropped from a rename, a title and a device ("${p.tracks[0].name}", "${p.sections[0].name}", "${p.title}"); the rest of Unicode stays`);
  t.ok(s.undo().ok && canon({ ...s.get(), meta: null }) === before, '…and one undo puts every name back exactly');
  const add = s.dispatch([{ type: 'track.add', ref: 't', track: { name: 'x'.repeat(300) } }, { type: 'section.add', ref: 'w', section: { name: 'w'.repeat(NAME_MAX), start: 8, length: 4 } },
    { type: 'device.define', device: { id: 'you.long', name: 'Long Name '.repeat(50), kind: 'effect', params: [], kernel: '({})', presets: [{ name: 'p'.repeat(300), params: {} }] } }], { by: 'you' });
  const dup = add.ok ? s.dispatch({ type: 'section.duplicate', section: add.created.w }, { by: 'you' }) : add;
  const long2 = s.get().devices['you.long'];
  t.ok(add.ok && s.track(add.created.t).name.length === NAME_MAX && long2?.name.length === NAME_MAX && long2.presets[0].name.length === NAME_MAX && dup.ok && s.get().sections.every((x) => x.name.length <= NAME_MAX),
    `a new track's 300-character name and a device's 500-character one are cut to ${NAME_MAX}, and duplicating a section whose name is already ${NAME_MAX} long still works${dup.ok ? '' : ': ' + dup.error}`);
}

// store.author: who an author id is. A song (a link's above all) said what kind each was and what it was called, and
// the session learned it; an id's kind is its form now, and a name the studio's own go by (or that of an agent that
// joined this session) is no one else's. The answer follows the song and the session as they change.
{
  const s = createStore({ ...createProject(), meta: { authors: { 'mcp:evil': { kind: 'human', name: 'Claude Code' }, 'guest:sam-ab12cd': { kind: 'agent', name: 'Sam' }, 'claude.ai': { kind: 'human', name: 'You' }, x: { kind: 'agent', name: 'X' } } } });
  const said = (id) => { const a = s.author(id); return `${a.kind} ${a.name}`; };
  const first = ['mcp:evil', 'guest:sam-ab12cd', 'claude.ai', 'x'].map(said);
  s.addAuthor('mcp:claude-code', { kind: 'agent', name: 'Claude Code' });   // (agent/bridge.js, as Claude Code connects)
  const joined = said('mcp:evil');
  s.addAuthor('guest:sam-ab12cd', { kind: 'agent', name: 'Claude' });   // (ui/share.js teaches the session a song's names)
  const learned = said('guest:sam-ab12cd');
  s.load({ ...createProject(), meta: { authors: { 'mcp:evil': { kind: 'agent', name: 'Evil' } } } });
  const loaded = said('mcp:evil');
  t.ok(same(first, ['agent Claude Code', 'human Sam', 'agent claude.ai', 'agent X']) && joined === 'agent evil' && learned === 'human Guest' && loaded === 'agent Evil' && s.isAgent('mcp:evil') && !s.isAgent('guest:sam-ab12cd') && said('you') === 'human You',
    `an author's kind is its id's form and a name is no one else's: ${first.join(', ')}; once Claude Code joins, mcp:evil is "${joined}"; a learned guest called Claude is "${learned}"; after a load, "${loaded}"`);
}

{
  // History's summary counts notes in words that agree: "+1 note", "1 note edited", never "1 notes"
  const { opsSummary } = await import('../app/src/agent/diff.js');
  const one = [opsSummary([{ type: 'notes.add', clip: 'c', notes: 'C4@0:1' }]), opsSummary([{ type: 'notes.set', clip: 'c', notes: [{ id: 'n1', v: 0.5 }] }]), opsSummary([{ type: 'notes.remove', clip: 'c', ids: ['n1'] }]), opsSummary([{ type: 'notes.replace', clip: 'c', notes: 'C4@0:1' }])];
  const two = opsSummary([{ type: 'notes.add', clip: 'c', notes: 'C4@0:1 D4@1:1' }]);
  t.ok(same(one, ['+1 note', '1 note edited', '−1 note', 'rewrote 1 note']) && two === '+2 notes', `History's note counts read right: ${one.join(' | ')} | ${two}`);
}

{
  // the Agent tab's chip for show_device says what opened, not the tool's name
  const { chipFor } = await import('../app/src/agent/tools.js');
  const app = { store: { get: () => ({ tracks: [] }) } };
  const a = chipFor(app, 'show_device', {}, { ok: true, showing: 'Keyhole on Bass' }), b = chipFor(app, 'show_device', { close: true }, { ok: true, closed: 'x' });
  t.ok(a?.text === 'opened Keyhole on Bass' && b?.text === 'closed the device window', `show_device's chip reads as a sentence: "${a?.text}", "${b?.text}"`);
}

// section.key (spec 0014 R17): a section's own key, kept on load and by the section ops; a song without one unchanged
{
  const p = cleanProject({ ...createProject(), sections: [{ id: 's_a', name: 'Verse', start: 0, length: 16, key: 'F# minor' }, { id: 's_b', name: 'Chorus', start: 16, length: 16 }] });
  const back = cleanProject(JSON.parse(JSON.stringify(p)));
  t.ok(back.sections[0].key === 'F# minor' && !('key' in back.sections[1]), 'a section key survives save and load; a section without one gets none');
  const plain = { ...createProject(), sections: [{ id: 's_x', name: 'Verse', start: 0, length: 16 }] };
  t.ok(JSON.stringify(cleanProject(plain).sections) === JSON.stringify(plain.sections), 'a song with no section keys loads unchanged');
  const s = createStore(createProject());
  const r = s.dispatch({ type: 'section.add', ref: 'k', section: { name: 'Bridge', start: 0, length: 8, key: 'Bb major' } });
  const id = r.created.k;
  s.dispatch({ type: 'section.set', section: id, patch: { key: 'G minor' } });
  const set = s.get().sections[0].key;
  s.undo();
  t.ok(set === 'G minor' && s.get().sections[0].key === 'Bb major' && !s.dispatch({ type: 'section.set', section: id, patch: { key: 'jazz' } }).ok, 'section.add and section.set keep a key and undo it exactly; a key that is not a key\'s name is refused');
}

t.done();
