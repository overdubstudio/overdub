// Every op in core/ops.js: it applies, it changes the song, and its inverse puts the song back exactly. One table,
// one row per op (and a few rows for the shapes an op takes), run twice: through applyOp directly and through the
// store (dispatch, undo, redo).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, OP_TYPES } from '../../app/src/core/ops.js';
import { createStore } from '../../app/src/core/store.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
// the song without the store's bookkeeping (meta.modified moves on every dispatch, meta.authors gains whoever edits)
const song = (p) => {
  const s = clone(p);
  delete s.meta;
  return JSON.stringify(s);
};

// The live room's two fields (core/liveroom/), for the rows that need a room or a sheet already in the song. The
// sheet's ids are given, so a row can name them.
const ROOM = [
  {
    type: 'room.set',
    patch: {
      place: 'metal',
      rig: 'modern',
      tuning: 'drop-c',
      finish: 'tight',
      tracks: { guitarL: '$keys', drums: '$drums' },
    },
  },
  { type: 'room.part.set', section: '$verse', patch: { feel: 'chugs' } },
  { type: 'sheet.set', patch: { capo: 2 } },
  {
    type: 'sheet.section.add',
    section: {
      id: 'ss_verse1',
      name: 'Verse 1',
      lines: [
        { id: 'sl_line01', text: 'Somewhere a [G]paper [Em]moon' },
        { id: 'sl_line02', text: 'over a [C]cardboard [D]sea' },
      ],
    },
  },
  {
    type: 'sheet.section.add',
    section: { id: 'ss_chorus', name: 'Chorus', lines: [{ id: 'sl_line03', text: '[G]Oh' }] },
  },
];

// A small song with something of every kind in it, built through the store as the studio would. room: with the live
// room's room and sheet (ROOM) too.
function fixture({ room = false } = {}) {
  const store = createStore();
  const r = store.dispatch(
    [
      {
        type: 'track.add',
        ref: 'keys',
        track: { name: 'Keys', kind: 'instrument', instrument: { device: 'core.poly', params: { cutoff: 2000 } } },
      },
      {
        type: 'track.add',
        ref: 'drums',
        track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } },
      },
      { type: 'track.add', ref: 'vox', track: { name: 'Vox', kind: 'audio' } },
      { type: 'clip.add', ref: 'c1', track: '$keys', clip: { start: 0, length: 8, notes: 'C4@0:1 E4@1:1 G4@2:2*0.9' } },
      { type: 'clip.add', ref: 'c2', track: '$keys', clip: { start: 8, length: 4, notes: 'A3@0:4' } },
      {
        type: 'clip.add',
        ref: 'beat',
        track: '$drums',
        clip: {
          start: 0,
          length: 4,
          grid: { steps: 16, step: 0.25, rows: { kick: 'x...x...x...x...', snare: '....x.......x...' } },
        },
      },
      {
        type: 'asset.add',
        asset: { id: 'a_take01', kind: 'audio', name: 'take 1', sr: 48000, channels: 1, duration: 4 },
      },
      {
        type: 'clip.add',
        ref: 'ac',
        track: '$vox',
        clip: { kind: 'audio', start: 4, length: 8, asset: 'a_take01', offset: 0, gain: 0 },
      },
      { type: 'insert.add', ref: 'fx', track: '$keys', insert: { device: 'core.delay', params: { mix: 0.3 } } },
      { type: 'insert.add', ref: 'fx2', track: '$keys', insert: { device: 'core.verb', params: {} } },
      { type: 'insert.add', ref: 'mfx', track: 'master', insert: { device: 'core.comp', params: {} } },
      { type: 'section.add', ref: 'verse', section: { name: 'Verse', start: 0, length: 8 } },
      { type: 'section.add', ref: 'chorus', section: { name: 'Chorus', start: 8, length: 8 } },
      { type: 'auto.write', track: '$keys', param: 'gain', points: '0:0 8:-6' },
      {
        type: 'device.define',
        device: {
          id: 'you.fuzz',
          name: 'Fuzz',
          kind: 'effect',
          params: [{ key: 'drive', min: 0, max: 1, def: 0.5 }],
          kernel: 'process(l, r) { return [l, r]; }',
        },
      },
      ...(room ? ROOM : []),
    ],
    { by: 'you' },
  );
  assert.ok(r.ok, r.error);
  const c = r.created;
  const notes = store.clip(c.keys, c.c1).notes;
  return { p: store.get(), ids: { ...c, n1: notes[0].id, n2: notes[1].id } };
}

const REFERENCE = {
  asset: 'a_take01',
  name: 'Reference',
  sr: 48000,
  channels: 2,
  duration: 180,
  profile: { lufs: -9, bands: [] },
};

// [label, (ids) => op, fixture options?]. Every OP_TYPES entry must appear at least once (checked below).
const CASES = [
  ['project.set title/tempo', () => ({ type: 'project.set', patch: { title: 'New name', tempo: 96 } })],
  [
    'project.set meter/key/loop',
    () => ({
      type: 'project.set',
      patch: { meter: [6, 8], key: { root: 'D', scale: 'dorian' }, loop: { on: true, start: 4, end: 12 } },
    }),
  ],
  ['project.set key null', () => ({ type: 'project.set', patch: { key: null } })],
  [
    'track.add',
    () => ({
      type: 'track.add',
      track: {
        name: 'Bass',
        kind: 'instrument',
        instrument: { device: 'core.bass', params: {} },
        clips: [{ start: 0, length: 4, notes: 'C2@0:1' }],
      },
    }),
  ],
  ['track.add at index', () => ({ type: 'track.add', index: 0, track: { name: 'First', kind: 'audio' } })],
  ['track.remove', (i) => ({ type: 'track.remove', track: i.keys })],
  ['track.remove by name', () => ({ type: 'track.remove', track: 'drums' })],
  ['track.move', (i) => ({ type: 'track.move', track: i.vox, index: 0 })],
  [
    'track.set',
    (i) => ({
      type: 'track.set',
      track: i.keys,
      patch: { name: 'Piano', gain: -3, pan: 0.5, mute: true, solo: true, color: '#ff8800' },
    }),
  ],
  ['instrument.set params', (i) => ({ type: 'instrument.set', track: i.keys, params: { cutoff: 500, res: 0.4 } })],
  ['instrument.set param reset', (i) => ({ type: 'instrument.set', track: i.keys, params: { cutoff: null } })],
  [
    'instrument.set device',
    (i) => ({ type: 'instrument.set', track: i.keys, device: 'core.pluck', params: { decay: 0.2 } }),
  ],
  [
    'insert.add',
    (i) => ({ type: 'insert.add', track: i.keys, insert: { device: 'core.eq', params: { low: 2 } }, index: 0 }),
  ],
  ['insert.add master', () => ({ type: 'insert.add', track: 'master', insert: { device: 'core.limiter' } })],
  ['insert.remove', (i) => ({ type: 'insert.remove', track: i.keys, insert: i.fx })],
  ['insert.remove master', (i) => ({ type: 'insert.remove', track: 'master', insert: i.mfx })],
  ['insert.move', (i) => ({ type: 'insert.move', track: i.keys, insert: i.fx2, index: 0 })],
  [
    'insert.set',
    (i) => ({
      type: 'insert.set',
      track: i.keys,
      insert: i.fx,
      patch: { on: false, params: { mix: 0.8, time: 0.25 } },
    }),
  ],
  ['clip.add notes', (i) => ({ type: 'clip.add', track: i.keys, clip: { start: 16, notes: 'D4@0:1 F4@1:1' } })],
  [
    'clip.add grid',
    (i) => ({
      type: 'clip.add',
      track: i.drums,
      clip: { start: 4, length: 4, grid: { steps: 8, step: 0.5, rows: { hat: 'x.x.x.x.' } } },
    }),
  ],
  [
    'clip.add audio',
    (i) => ({ type: 'clip.add', track: i.vox, clip: { kind: 'audio', start: 20, length: 4, asset: 'a_take01' } }),
  ],
  ['clip.remove', (i) => ({ type: 'clip.remove', track: i.keys, clip: i.c1 })],
  ['clip.remove audio', (i) => ({ type: 'clip.remove', track: i.vox, clip: i.ac })],
  [
    'clip.set',
    (i) => ({
      type: 'clip.set',
      track: i.keys,
      clip: i.c1,
      patch: { start: 12, length: 6, name: 'Intro', mute: true, tuning: 'drop-d', capo: 2 },
    }),
  ],
  ['clip.set audio', (i) => ({ type: 'clip.set', track: i.vox, clip: i.ac, patch: { offset: 1.5, gain: -2 } })],
  ['clip.move', (i) => ({ type: 'clip.move', track: i.keys, clip: i.c2, start: 24 })],
  ['clip.move across tracks', (i) => ({ type: 'clip.move', track: i.keys, clip: i.c2, toTrack: i.drums, start: 8 })],
  ['notes.add', (i) => ({ type: 'notes.add', track: i.keys, clip: i.c1, notes: 'B4@3:1 D5@3:1' })],
  [
    'notes.add objects',
    (i) => ({ type: 'notes.add', track: i.keys, clip: i.c1, notes: [{ p: 72, t: 4, d: 0.5, v: 0.6 }] }),
  ],
  ['notes.remove', (i) => ({ type: 'notes.remove', track: i.keys, clip: i.c1, ids: [i.n1, i.n2] })],
  [
    'notes.set',
    (i) => ({ type: 'notes.set', track: i.keys, clip: i.c1, notes: [{ id: i.n1, p: 61, t: 0.5, d: 0.25, v: 0.3 }] }),
  ],
  ['notes.set place', (i) => ({ type: 'notes.set', track: i.keys, clip: i.c1, notes: [{ id: i.n1, s: 4, f: 5 }] })],
  [
    'notes.set twice one note',
    (i) => ({
      type: 'notes.set',
      track: i.keys,
      clip: i.c1,
      notes: [
        { id: i.n1, p: 62 },
        { id: i.n1, p: 64 },
      ],
    }),
  ],
  ['notes.replace', (i) => ({ type: 'notes.replace', track: i.keys, clip: i.c1, notes: 'C3@0:4 G3@0:4' })],
  [
    'notes.replace grid',
    (i) => ({
      type: 'notes.replace',
      track: i.drums,
      clip: i.beat,
      grid: { steps: 4, step: 1, rows: { kick: 'X.x.' } },
    }),
  ],
  [
    'section.add',
    () => ({ type: 'section.add', section: { name: 'Bridge', start: 16, length: 4, color: 'var(--c-3)' } }),
  ],
  [
    'section.set',
    (i) => ({
      type: 'section.set',
      section: i.verse,
      patch: { name: 'Verse 1', start: 2, length: 6, color: '#123456' },
    }),
  ],
  ['section.set by name', () => ({ type: 'section.set', section: 'chorus', patch: { length: 4 } })],
  ['section.remove', (i) => ({ type: 'section.remove', section: i.chorus })],
  ['section.duplicate', (i) => ({ type: 'section.duplicate', section: i.verse })],
  ['section.duplicate push', (i) => ({ type: 'section.duplicate', section: i.verse, to: 8, push: true })],
  ['section.duplicate with its part', (i) => ({ type: 'section.duplicate', section: i.verse }), { room: true }],
  ['section.move', (i) => ({ type: 'section.move', section: i.chorus, before: i.verse })],
  ['section.move to the end', (i) => ({ type: 'section.move', section: i.verse, before: null }), { room: true }],
  ['section.move by name', () => ({ type: 'section.move', section: 'Chorus', before: 'Verse' }), { room: true }],
  [
    'room.set makes the room',
    (i) => ({
      type: 'room.set',
      patch: { place: 'metal', tuning: 'drop-c', tracks: { guitarL: i.keys, drums: 'Drums' } },
    }),
  ],
  [
    'room.set patch',
    (i) => ({
      type: 'room.set',
      patch: {
        place: 'kitchen',
        rig: null,
        finish: 'warm',
        mic: 'two',
        master: i.ac,
        tracks: { take: i.vox, chords: i.keys },
        takes: { [i.ac]: { capo: 2, bpm: 96, onMaster: true } },
        managed: { [i.keys]: { gain: -3, pan: 0.25, chain: 'h_1f2e' }, master: { gain: -1 } },
      },
    }),
    { room: true },
  ],
  ['room.set a key null', () => ({ type: 'room.set', patch: { tracks: null, tuning: null } }), { room: true }],
  ['room.set clear', () => ({ type: 'room.set', clear: true }), { room: true }],
  [
    'room.part.set a new part',
    (i) => ({
      type: 'room.part.set',
      section: i.chorus,
      patch: {
        feel: 'open',
        busy: 1,
        loud: -1,
        reps: 2,
        oneSide: true,
        drop: true,
        sheet: 'ss_chorus',
        learned: { from: i.c2, thin: true },
      },
    }),
    { room: true },
  ],
  [
    'room.part.set merges',
    () => ({ type: 'room.part.set', section: 'Verse', patch: { reps: 3, feel: 'gallop' } }),
    { room: true },
  ],
  ['room.part.set makes the room', (i) => ({ type: 'room.part.set', section: i.verse, patch: { feel: 'chugs' } })],
  [
    'room.part.set emptied',
    (i) => ({ type: 'room.part.set', section: i.verse, patch: { feel: null } }),
    { room: true },
  ],
  ['room.part.set remove', (i) => ({ type: 'room.part.set', section: i.verse, remove: true }), { room: true }],
  [
    'sheet.set makes the sheet',
    () => ({ type: 'sheet.set', patch: { capo: 3, time: [3, 4], notes: 'Slow.\nThen fast.' } }),
  ],
  [
    'sheet.set patch',
    () => ({ type: 'sheet.set', patch: { capo: 0, time: [6, 8], notes: 'Let it ring' } }),
    { room: true },
  ],
  ['sheet.set clear', () => ({ type: 'sheet.set', clear: true }), { room: true }],
  [
    'sheet.section.add',
    () => ({
      type: 'sheet.section.add',
      index: 1,
      section: { name: 'Bridge', lines: [{ text: 'and [Am]then' }, { text: '' }] },
    }),
    { room: true },
  ],
  ['sheet.section.add makes the sheet', () => ({ type: 'sheet.section.add', section: { name: 'Verse 1' } })],
  [
    'sheet.section.set',
    () => ({ type: 'sheet.section.set', section: 'ss_verse1', patch: { name: 'First verse' } }),
    { room: true },
  ],
  ['sheet.section.remove', () => ({ type: 'sheet.section.remove', section: 'Verse 1' }), { room: true }],
  [
    'sheet.line.add',
    () => ({ type: 'sheet.line.add', section: 'ss_verse1', index: 0, line: { text: 'a new [Am]line' } }),
    { room: true },
  ],
  [
    'sheet.line.set',
    () => ({
      type: 'sheet.line.set',
      section: 'ss_verse1',
      line: 'sl_line01',
      patch: { text: 'Somewhere a [G]paper [C]moon' },
    }),
    { room: true },
  ],
  ['sheet.line.remove', () => ({ type: 'sheet.line.remove', section: 'ss_verse1', line: 'sl_line02' }), { room: true }],
  ['time.insert', () => ({ type: 'time.insert', at: 4, length: 4 })],
  ['time.remove', () => ({ type: 'time.remove', at: 2, length: 4 })],
  ['clip.repeat copies', (i) => ({ type: 'clip.repeat', track: i.keys, clip: i.c2, times: 3 })],
  ['clip.repeat loop', (i) => ({ type: 'clip.repeat', track: i.drums, clip: i.beat, times: 4, mode: 'loop' })],
  ['clip.split', (i) => ({ type: 'clip.split', track: i.keys, clip: i.c1, at: 1.5 })],
  ['clip.split audio', (i) => ({ type: 'clip.split', track: i.vox, clip: i.ac, at: 6 })],
  ['master.set', () => ({ type: 'master.set', patch: { gain: -4, clip: 'clean' } })],
  ['auto.write new lane', (i) => ({ type: 'auto.write', track: i.keys, param: 'pan', points: '0:-1 4:1~0.5 8:0' })],
  [
    'auto.write over a lane',
    (i) => ({ type: 'auto.write', track: i.keys, param: 'gain', points: '2:-12 4:-12', from: 2, to: 4 }),
  ],
  [
    'auto.write insert param',
    (i) => ({
      type: 'auto.write',
      track: i.keys,
      insert: i.fx,
      param: 'mix',
      points: [
        { t: 0, v: 0 },
        { t: 4, v: 1, c: 'step' },
      ],
    }),
  ],
  [
    'auto.write instrument',
    (i) => ({ type: 'auto.write', track: i.keys, insert: 'instrument', param: 'cutoff', points: '0:200 8:8000' }),
  ],
  ['auto.write master', () => ({ type: 'auto.write', track: 'master', param: 'gain', points: '0:0 4:-3' })],
  ['auto.clear range', (i) => ({ type: 'auto.clear', track: i.keys, param: 'gain', from: 6, to: 8 })],
  ['auto.clear lane', (i) => ({ type: 'auto.clear', track: i.keys, param: 'gain' })],
  ['auto.set off', (i) => ({ type: 'auto.set', track: i.keys, param: 'gain', patch: { off: true } })],
  [
    'asset.add',
    () => ({
      type: 'asset.add',
      asset: { id: 'a_take02', kind: 'audio', name: 'take 2', sr: 44100, channels: 2, duration: 2 },
    }),
  ],
  [
    'asset.add replaces',
    () => ({ type: 'asset.add', asset: { id: 'a_take01', name: 'renamed', sr: 44100, channels: 2, duration: 3 } }),
  ],
  ['asset.remove', () => ({ type: 'asset.remove', id: 'a_take01' })],
  ['reference.set', () => ({ type: 'reference.set', reference: REFERENCE })],
  [
    'device.define new',
    () => ({
      type: 'device.define',
      device: { id: 'claude.velvet', name: 'Velvet', kind: 'instrument', params: [], kernel: 'x' },
    }),
  ],
  [
    'device.define new version',
    () => ({
      type: 'device.define',
      device: { id: 'you.fuzz', name: 'Fuzz 2', kind: 'effect', params: [], kernel: 'y' },
    }),
  ],
  ['device.remove', () => ({ type: 'device.remove', id: 'you.fuzz' })],
  [
    'tempo.map set',
    () => ({
      type: 'tempo.map',
      map: {
        anchors: [
          { beat: 0, sec: 0 },
          { beat: 4, sec: 2.6 },
          { beat: 8, sec: 5.15 },
        ],
      },
    }),
  ],
];

test('the table covers every op in OP_TYPES', () => {
  const covered = new Set(CASES.map(([, mk]) => mk(new Proxy({}, { get: (_, k) => String(k) })).type));
  const missing = OP_TYPES.filter((t) => !covered.has(t));
  assert.deepEqual(missing, []);
});

describe('applyOp: each op applies and its inverse restores the song exactly', () => {
  for (const [label, mk, opts] of CASES) {
    test(label, () => {
      const { p, ids } = fixture(opts);
      const before = JSON.stringify(p);
      const ctx = { by: 'claude', refs: {}, getDevice: null, doc: p, restore: false, noteSeq: new Map() };
      const r = applyOp(p, mk(ids), ctx);
      assert.ok(Array.isArray(r.inverse) && r.inverse.length, 'returns an inverse');
      assert.notEqual(JSON.stringify(p), before, 'the op changed the song');
      const undo = { by: 'claude', refs: {}, getDevice: null, doc: p, restore: true, noteSeq: new Map() };
      for (const inv of r.inverse) applyOp(p, inv, undo);
      assert.equal(JSON.stringify(p), before, 'the inverse put it back');
    });
  }
});

describe('store: dispatch, undo and redo of each op', () => {
  for (const [label, mk, opts] of CASES) {
    test(label, () => {
      const { p, ids } = fixture(opts);
      const store = createStore(clone(p));
      const before = song(store.get());
      const r = store.dispatch(mk(ids), { by: 'claude' });
      assert.ok(r.ok, r.error);
      const done = song(store.get());
      assert.notEqual(done, before);
      assert.ok(store.undo().ok);
      assert.equal(song(store.get()), before, 'undo restores exactly');
      assert.ok(store.redo().ok);
      assert.equal(song(store.get()), done, 'redo puts the change back exactly');
      assert.ok(store.undo().ok);
      assert.equal(song(store.get()), before, 'and undoes again');
    });
  }
});

describe('ops refuse bad input and say why', () => {
  const bad = [
    ['unknown op', () => ({ type: 'track.explode' }), /unknown op type/],
    ['tempo out of range', () => ({ type: 'project.set', patch: { tempo: 1000 } }), /tempo/],
    ['bad meter', () => ({ type: 'project.set', patch: { meter: [4, 3] } }), /meter/],
    ['loop end before start', () => ({ type: 'project.set', patch: { loop: { start: 8, end: 4 } } }), /loop end/],
    ['title not text', () => ({ type: 'project.set', patch: { title: { evil: 1 } } }), /title/],
    ['no such track', () => ({ type: 'track.set', track: 't_nope00', patch: { gain: 0 } }), /no track/],
    ['gain out of range', (i) => ({ type: 'track.set', track: i.keys, patch: { gain: 30 } }), /gain/],
    ['pan out of range', (i) => ({ type: 'track.set', track: i.keys, patch: { pan: 2 } }), /pan/],
    ['unknown track field', (i) => ({ type: 'track.set', track: i.keys, patch: { kind: 'audio' } }), /can't change/],
    ['color that is css', (i) => ({ type: 'track.set', track: i.keys, patch: { color: 'url(http://x)' } }), /colou?r/i],
    ['instrument on audio track', (i) => ({ type: 'instrument.set', track: i.vox, params: { a: 1 } }), /audio track/],
    [
      'notes on an audio track',
      (i) => ({ type: 'clip.add', track: i.vox, clip: { kind: 'notes', notes: 'C4@0:1' } }),
      /audio track/,
    ],
    [
      'audio clip without asset',
      (i) => ({ type: 'clip.add', track: i.vox, clip: { kind: 'audio', start: 0, length: 4 } }),
      /asset/,
    ],
    ['clip too short', (i) => ({ type: 'clip.set', track: i.keys, clip: i.c1, patch: { length: 0.1 } }), /length/],
    ['negative start', (i) => ({ type: 'clip.set', track: i.keys, clip: i.c1, patch: { start: -1 } }), /start/],
    ['capo out of range', (i) => ({ type: 'clip.set', track: i.keys, clip: i.c1, patch: { capo: 13 } }), /capo/],
    [
      'move notes clip onto audio track',
      (i) => ({ type: 'clip.move', track: i.keys, clip: i.c1, toTrack: i.vox }),
      /can't move/,
    ],
    [
      'edit a missing note',
      (i) => ({ type: 'notes.set', track: i.keys, clip: i.c1, notes: [{ id: 'n999', p: 60 }] }),
      /no note/,
    ],
    ['unknown reference', () => ({ type: 'clip.add', track: '$nobody', clip: {} }), /unknown reference/],
    ['duplicate id', (i) => ({ type: 'clip.add', track: i.keys, clip: { id: i.c1 } }), /already used/],
    ['master clip mode', () => ({ type: 'master.set', patch: { clip: 'loud' } }), /soft/],
    [
      'mixer lane that is not one',
      (i) => ({ type: 'auto.write', track: i.keys, param: 'volume', points: '0:0' }),
      /mixer lanes/,
    ],
    [
      'point past the end of time',
      (i) => ({ type: 'auto.write', track: i.keys, param: 'pan', points: [{ t: 99999, v: 0 }] }),
      /beat/,
    ],
    [
      'bad curve',
      (i) => ({ type: 'auto.write', track: i.keys, param: 'pan', points: [{ t: 0, v: 0, c: 4 }] }),
      /curve/,
    ],
    ['shipped device id', () => ({ type: 'device.define', device: { id: 'core.poly', kernel: 'x' } }), /ships/],
    ['bad device id', () => ({ type: 'device.define', device: { id: 'A B', kernel: 'x' } }), /bad device id/],
    ['reference without a profile', () => ({ type: 'reference.set', reference: { name: 'x' } }), /reference/],
    ['remove a missing asset', () => ({ type: 'asset.remove', id: 'a_none' }), /no asset/],
    ['a place the room has no id for', () => ({ type: 'room.set', patch: { place: 'moon' } }), /place is one of/],
    ['a role naming no track', () => ({ type: 'room.set', patch: { tracks: { drums: 't_none' } } }), /names no track/],
    ['a role that is not one', (i) => ({ type: 'room.set', patch: { tracks: { cowbell: i.keys } } }), /isn't a role/],
    ['a master that is not a clip', () => ({ type: 'room.set', patch: { master: 'c_none' } }), /names no clip/],
    ['a room key that is not one', () => ({ type: 'room.set', patch: { colour: 'red' } }), /can't change "colour"/],
    ['clearing no room', () => ({ type: 'room.set', clear: true }), /no room/],
    [
      'a chain a reload would change',
      (i) => ({ type: 'room.set', patch: { managed: { [i.keys]: { chain: 'h_1f\u202e2e' } } } }),
      /managed chain is a short hash/,
    ],
    [
      'a part for no section',
      () => ({ type: 'room.part.set', section: 's_none', patch: { feel: 'open' } }),
      /no section/,
    ],
    [
      'a feel that is not one',
      (i) => ({ type: 'room.part.set', section: i.verse, patch: { feel: 'polka' } }),
      /feel is one of/,
    ],
    ['reps past 4', (i) => ({ type: 'room.part.set', section: i.verse, patch: { reps: 5 } }), /reps/],
    ['busy past 1', (i) => ({ type: 'room.part.set', section: i.verse, patch: { busy: 2 } }), /busy is -1, 0 or 1/],
    [
      'a part naming no sheet section',
      (i) => ({ type: 'room.part.set', section: i.verse, patch: { sheet: 'ss_none' } }),
      /sheet names no section/,
    ],
    [
      'removing no part',
      (i) => ({ type: 'room.part.set', section: i.chorus, remove: true }),
      /no part/,
      { room: true },
    ],
    ['a capo past 11', () => ({ type: 'sheet.set', patch: { capo: 12 } }), /capo/],
    ['a time that is not a meter', () => ({ type: 'sheet.set', patch: { time: [4, 3] } }), /meter/],
    [
      'notes past 2,000 characters',
      () => ({ type: 'sheet.set', patch: { notes: 'x'.repeat(2001) } }),
      /2,000 characters/,
    ],
    [
      'a line past 200 characters',
      () => ({ type: 'sheet.line.add', section: 'ss_verse1', line: { text: 'x'.repeat(201) } }),
      /200 characters/,
      { room: true },
    ],
    [
      'a line in no section',
      () => ({ type: 'sheet.line.add', section: 'ss_none', line: { text: 'x' } }),
      /no section/,
      { room: true },
    ],
    [
      'a sheet id used twice',
      () => ({ type: 'sheet.section.add', section: { id: 'ss_verse1', name: 'Again' } }),
      /used on the sheet/,
      { room: true },
    ],
    [
      'a line that is not there',
      () => ({ type: 'sheet.line.remove', section: 'ss_verse1', line: 'sl_none' }),
      /no line/,
      { room: true },
    ],
    ['a sheet section on no sheet', () => ({ type: 'sheet.section.remove', section: 'Verse 1' }), /no section/],
    ['a move to where it is', (i) => ({ type: 'section.move', section: i.verse, before: i.chorus }), /there already/],
    ['a move before itself', (i) => ({ type: 'section.move', section: i.chorus, before: i.chorus }), /there already/],
    ['a move of no section', () => ({ type: 'section.move', section: 's_none', before: null }), /section/],
  ];
  for (const [label, mk, re, opts] of bad) {
    test(label, () => {
      const { p, ids } = fixture(opts);
      const store = createStore(clone(p));
      const before = song(store.get());
      const r = store.dispatch(mk(ids), { by: 'claude' });
      assert.equal(r.ok, false);
      assert.match(r.error, re);
      assert.equal(song(store.get()), before, 'nothing changed');
      assert.equal(store.canUndo(), false);
    });
  }
});

describe('ops: details of what they write', () => {
  test('new things are signed by whoever made them, and notes too', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    const r = store.dispatch(
      [
        { type: 'track.add', ref: 't', track: { name: 'Lead' } },
        { type: 'clip.add', ref: 'c', track: '$t', clip: { notes: 'C4@0:1 D4@1:1' } },
        { type: 'insert.add', ref: 'fx', track: '$t', insert: { device: 'core.delay' } },
      ],
      { by: 'mcp:cursor' },
    );
    assert.ok(r.ok, r.error);
    const t = store.track(r.created.t);
    assert.equal(t.by, 'mcp:cursor');
    assert.equal(t.clips[0].by, 'mcp:cursor');
    assert.ok(t.clips[0].notes.every((n) => n.by === 'mcp:cursor'));
    assert.equal(t.inserts[0].by, 'mcp:cursor');
    void ids;
  });

  test('clip.add sizes a clip to its notes in whole bars when no length is given', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    const r = store.dispatch({ type: 'clip.add', track: ids.keys, clip: { start: 20, notes: 'C4@0:1 C4@5:1' } });
    assert.equal(store.clip(ids.keys, r.created.clip).length, 8);
  });

  test('clips stay sorted by start', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    store.dispatch({ type: 'clip.set', track: ids.keys, clip: ids.c1, patch: { start: 40 } });
    const starts = store.track(ids.keys).clips.map((c) => c.start);
    assert.deepEqual(
      starts,
      [...starts].sort((a, b) => a - b),
    );
  });

  test('notes.set signs the note with the editor, and undo gives it back its author', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    store.dispatch(
      { type: 'notes.set', track: ids.keys, clip: ids.c1, notes: [{ id: ids.n1, p: 70 }] },
      { by: 'claude' },
    );
    const note = () => store.clip(ids.keys, ids.c1).notes.find((n) => n.id === ids.n1);
    assert.equal(note().by, 'claude');
    assert.equal(note().p, 70);
    store.undo();
    assert.equal(note().by, 'you');
    assert.equal(note().p, 60);
  });

  test('notes.set clears a place on the neck with s: null', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    store.dispatch({ type: 'notes.set', track: ids.keys, clip: ids.c1, notes: [{ id: ids.n1, s: 1, f: 3 }] });
    const note = () => store.clip(ids.keys, ids.c1).notes.find((n) => n.id === ids.n1);
    assert.equal(note().s, 1);
    assert.equal(note().f, 3);
    store.dispatch({ type: 'notes.set', track: ids.keys, clip: ids.c1, notes: [{ id: ids.n1, s: null }] });
    assert.equal('s' in note(), false);
    assert.equal('f' in note(), false);
  });

  test('clip.set mute false and capo 0 store no flag at all', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    store.dispatch({ type: 'clip.set', track: ids.keys, clip: ids.c1, patch: { mute: true, capo: 3 } });
    store.dispatch({ type: 'clip.set', track: ids.keys, clip: ids.c1, patch: { mute: false, capo: 0 } });
    const c = store.clip(ids.keys, ids.c1);
    assert.equal('mute' in c, false);
    assert.equal('capo' in c, false);
  });

  test('names are plain text: control and bidi characters are dropped', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    const r = store.dispatch({ type: 'track.set', track: ids.keys, patch: { name: 'Ke‮ys\u0007' } });
    assert.ok(r.ok, r.error);
    assert.equal(store.track(ids.keys).name, 'Keys');
  });

  test('device.define bumps the version of a device the song already has', () => {
    const { p } = fixture();
    const store = createStore(clone(p));
    assert.equal(store.get().devices['you.fuzz'].version, 1);
    store.dispatch({ type: 'device.define', device: { id: 'you.fuzz', kind: 'effect', params: [], kernel: 'z' } });
    assert.equal(store.get().devices['you.fuzz'].version, 2);
  });

  test('device.define refuses a kernel over 256 KB', () => {
    const store = createStore();
    const r = store.dispatch({
      type: 'device.define',
      device: { id: 'you.big', kind: 'effect', params: [], kernel: 'x'.repeat(256 * 1024 + 1) },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /256 KB/);
  });

  test('auto.write refuses a mixer value out of its range', () => {
    const { p, ids } = fixture();
    const store = createStore(clone(p));
    const r = store.dispatch({ type: 'auto.write', track: ids.keys, param: 'pan', points: '0:5' });
    assert.equal(r.ok, false);
  });

  test('getDevice: ops check that a device exists and is the right kind', () => {
    const devices = { 'core.poly': { kind: 'instrument' }, 'core.delay': { kind: 'effect' } };
    const store = createStore(null, { getDevice: (id) => devices[id] || null });
    const r1 = store.dispatch({ type: 'track.add', track: { name: 'x', instrument: { device: 'core.nope' } } });
    assert.equal(r1.ok, false);
    assert.match(r1.error, /no device/);
    const r2 = store.dispatch({
      type: 'track.add',
      ref: 't',
      track: { name: 'x', instrument: { device: 'core.poly' } },
    });
    assert.ok(r2.ok, r2.error);
    const r3 = store.dispatch({ type: 'insert.add', track: r2.created.t, insert: { device: 'core.poly' } });
    assert.equal(r3.ok, false);
    assert.match(r3.error, /not an effect/);
  });
});

describe('the live room: what its ops write', () => {
  test('a sheet line is signed by whoever wrote it, and undo gives it back its author', () => {
    const { p } = fixture({ room: true });
    const store = createStore(clone(p));
    const line = () => store.get().sheet.sections[0].lines[0];
    assert.equal(line().by, 'you');
    store.dispatch(
      { type: 'sheet.line.set', section: 'Verse 1', line: 'sl_line01', patch: { text: 'Somewhere a [G]moon' } },
      { by: 'claude' },
    );
    assert.equal(line().by, 'claude');
    assert.equal(line().text, 'Somewhere a [G]moon');
    store.undo();
    assert.equal(line().by, 'you');
    assert.equal(line().text, 'Somewhere a [G]paper [Em]moon');
    const r = store.dispatch(
      { type: 'sheet.line.add', section: 'ss_chorus', ref: 'l', line: { text: '[C]Oh, [G]oh' } },
      { by: 'mcp:cursor' },
    );
    assert.ok(r.ok, r.error);
    assert.equal(store.get().sheet.sections[1].lines.find((l) => l.id === r.created.l).by, 'mcp:cursor');
  });

  test('a line is plain text: control and bidi characters are dropped', () => {
    const { p } = fixture({ room: true });
    const store = createStore(clone(p));
    const r = store.dispatch({
      type: 'sheet.line.add',
      section: 'ss_verse1',
      ref: 'l',
      line: { text: 'a\u0007 [G]li\u202ene' },
    });
    assert.ok(r.ok, r.error);
    assert.equal(store.get().sheet.sections[0].lines.at(-1).text, 'a [G]line');
  });

  test('the room keeps its keys in one order, whatever order a patch names them in', () => {
    const store = createStore();
    store.dispatch({ type: 'room.set', patch: { finish: 'raw', place: 'basement' } });
    store.dispatch({ type: 'room.set', patch: { mic: 'one', tuning: 'standard', rig: 'crunch' } });
    assert.deepEqual(Object.keys(store.get().room), ['v', 'place', 'rig', 'tuning', 'finish', 'mic']);
    store.undo();
    assert.deepEqual(Object.keys(store.get().room), ['v', 'place', 'finish']);
  });

  test('false flags and capo 0 are no key at all', () => {
    const { p, ids } = fixture({ room: true });
    const store = createStore(clone(p));
    store.dispatch({ type: 'room.part.set', section: ids.verse, patch: { oneSide: true, drop: true } });
    store.dispatch({ type: 'room.part.set', section: ids.verse, patch: { oneSide: false, drop: false } });
    assert.deepEqual(store.get().room.parts[ids.verse], { feel: 'chugs' });
    store.dispatch({ type: 'sheet.set', patch: { capo: 0 } });
    assert.equal('capo' in store.get().sheet, false);
    store.dispatch({ type: 'room.set', patch: { takes: { [ids.ac]: { capo: 0, onMaster: false, bpm: 90 } } } });
    assert.deepEqual(store.get().room.takes, { [ids.ac]: { bpm: 90 } });
  });

  test('picking a place makes its tracks and names their roles in one step ($refs)', () => {
    const store = createStore();
    const r = store.dispatch(
      [
        { type: 'track.add', ref: 'gl', track: { name: 'Guitar L', kind: 'audio' } },
        { type: 'track.add', ref: 'dr', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
        { type: 'room.set', patch: { place: 'metal', tracks: { guitarL: '$gl', drums: '$dr' } } },
      ],
      { by: 'you' },
    );
    assert.ok(r.ok, r.error);
    assert.deepEqual(store.get().room.tracks, { guitarL: r.created.gl, drums: r.created.dr });
    assert.equal(store.history.length, 1);
  });

  test("section.duplicate copies the section's part; section.move keeps its id, its part and its clips' ids", () => {
    const { p, ids } = fixture({ room: true });
    const store = createStore(clone(p));
    const r = store.dispatch({ type: 'section.duplicate', section: ids.verse, ref: 'copy' });
    assert.ok(r.ok, r.error);
    assert.deepEqual(store.get().room.parts[r.created.copy], { feel: 'chugs' });
    store.undo();
    assert.deepEqual(Object.keys(store.get().room.parts), [ids.verse]);
    const clips = store
      .get()
      .tracks.flatMap((t) => t.clips.map((c) => c.id))
      .sort();
    const m = store.dispatch({ type: 'section.move', section: ids.chorus, before: ids.verse }, { by: 'claude' });
    assert.ok(m.ok, m.error);
    const sec = store.get().sections;
    assert.deepEqual(
      sec.map((x) => [x.id, x.start]),
      [
        [ids.chorus, 0],
        [ids.verse, 8],
      ],
    );
    assert.deepEqual(store.get().room.parts[ids.verse], { feel: 'chugs' });
    const after = store
      .get()
      .tracks.flatMap((t) => t.clips.map((c) => c.id))
      .sort();
    assert.deepEqual(
      after.filter((id) => clips.includes(id)),
      clips,
      'every clip keeps its id (any split adds a clip)',
    );
    assert.equal(store.history.at(-1).label, 'move section');
  });

  test('a redo keeps why a step was made, and that it was an audition', () => {
    const store = createStore();
    store.dispatch(
      { type: 'room.set', patch: { place: 'metal' } },
      { by: 'overdub', reason: 'room:place', label: 'The metal club' },
    );
    store.undo();
    store.redo();
    assert.equal(store.history.at(-1).reason, 'room:place');
    store.dispatch({ type: 'room.set', patch: { finish: 'loud' } }, { by: 'you', audition: true });
    assert.equal(store.history.at(-1).audition, true);
    store.undo();
    store.redo();
    assert.equal(store.history.at(-1).audition, true);
  });
});
