// The guitar room's riff library and stack rack (docs/research/GUITAR-ROOM.md §2.4, §2.9, §4.3): what a riff and a
// stack are (core/liveroom/riffs.js, stacks.js), and the two stores as Node runs them, with no IndexedDB, so on their
// memory side (ui/liveroom/riffs-db.js, rack-db.js). The IndexedDB side runs in muted Chromium:
// tools/liveroom/checks-library.js (ONLY=library node tools/liveroom-test.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanRiff,
  peaksOf,
  patchRow,
  cleanFilter,
  matches,
  pageOf,
  placement,
  songTag,
  assetIdOf,
  PEAK_COLS,
} from '../../app/src/core/liveroom/riffs.js';
import {
  isGear,
  gearSpan,
  stackOf,
  cleanStack,
  chainKey,
  sameChain,
  matchStack,
  loadOps,
  houseStacks,
} from '../../app/src/core/liveroom/stacks.js';
import * as riffs from '../../app/src/ui/liveroom/riffs-db.js';
import * as rack from '../../app/src/ui/liveroom/rack-db.js';
import { createStore } from '../../app/src/core/store.js';

const SR = 48000;
// a riff's audio: a decaying 82 Hz tone, `secs` long (deterministic)
const tone = (secs, amp = 0.5) => {
  const n = Math.round(secs * SR),
    x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * 82.41 * i) / SR) * Math.exp(-i / n);
  return x;
};
const audio = (secs, amp) => ({ sr: SR, channels: [tone(secs, amp)] });
const CHAIN = [
  { device: 'pedal.gate', params: { thresh: -50 }, on: true },
  { device: 'core.stack', params: { gain: 6.5, cab: 0, boost: 'ON' }, on: true },
];

describe('a riff, as data', () => {
  test('cleanRiff splits it into a small row, its detail and its audio, the length on the grid', () => {
    const c = cleanRiff(
      {
        audio: audio(4),
        tempo: 120,
        bars: 2,
        tuning: 'drop-c',
        key: { root: 'C', scale: 'minor' },
        stack: { name: 'Modern wall', chain: CHAIN, id: 'st_abc123' },
        song: { id: 'p_x', title: 'Void Weather' },
        notes: 'the chug',
      },
      { now: 1000, count: 4 },
    );
    assert.ok(!('error' in c), c.error);
    const { row, detail, audio: au } = c;
    assert.match(row.id, /^rf_[a-z0-9]{6}$/);
    assert.equal(row.name, 'Riff 5');
    assert.equal(row.at, 1000);
    assert.equal(row.rat, -1000);
    assert.equal(row.starred, 0);
    assert.deepEqual([row.song, row.songTitle], ['p_x', 'Void Weather']);
    assert.deepEqual([row.tempo, row.beats, row.bars, row.meter.join('/')], [120, 8, 2, '4/4']);
    assert.equal(row.tail, 0); // 4 s at 120 BPM is exactly 8 beats
    assert.deepEqual(row.key, { root: 'C', scale: 'minor', sure: false });
    assert.deepEqual(row.stack, { name: 'Modern wall', amp: 'core.stack' });
    assert.equal(row.bytes, 4 * SR * 4);
    assert.ok(row.peaks instanceof Int8Array && row.peaks.length === 2 * PEAK_COLS);
    assert.ok(row.peak > 0.45 && row.peak <= 0.5, `peak ${row.peak}`);
    assert.equal(row.chain, undefined, 'the chain is the detail’s, not the row’s');
    assert.equal(detail.stackId, 'st_abc123');
    assert.equal(detail.chain.length, 2);
    assert.equal(au.sr, SR);
    assert.ok(au.channels[0] instanceof Float32Array && au.channels[0].length === 4 * SR);
    // small: a row is under a kilobyte and a half, its peaks (512 bytes, kept as bytes) and all
    const size = JSON.stringify({ ...row, peaks: undefined }).length + row.peaks.byteLength;
    assert.ok(size < 1500, `row is ${size} bytes`);
  });
  test('its length from the audio when no beats or bars are given; what rang past is the tail', () => {
    const { row } = cleanRiff({ audio: audio(2.2), tempo: 120, offset: 0.1 });
    assert.equal(row.beats, 4); // (2.2 - 0.1) s at 120 = 4.2 beats, to the beat
    assert.equal(row.offset, 0.1);
    assert.ok(Math.abs(row.tail - 0.1) < 1e-6, `tail ${row.tail}`);
  });
  test('16-bit audio comes in as Float32, as a recording is kept', () => {
    const i16 = Int16Array.from([0, 16384, -32768, 32767]);
    const { audio: au } = cleanRiff({ audio: { sr: 44100, channels: [i16] }, tempo: 90, beats: 1 });
    assert.deepEqual(Array.from(au.channels[0]), [0, 0.5, -1, 32767 / 32768]);
  });
  test('refused: no audio, empty audio, no tempo, mismatched channels', () => {
    assert.ok('error' in cleanRiff({ tempo: 120 }));
    assert.ok('error' in cleanRiff({ audio: { sr: SR, channels: [new Float32Array(0)] }, tempo: 120 }));
    assert.ok('error' in cleanRiff({ audio: audio(1) }));
    assert.ok(
      'error' in cleanRiff({ audio: { sr: SR, channels: [new Float32Array(4), new Float32Array(5)] }, tempo: 120 }),
    );
  });
  test('songTag: the title only once the song is named', () => {
    assert.deepEqual(songTag({ id: 'p_1', title: 'Untitled' }), { song: 'p_1', songTitle: null });
    assert.deepEqual(songTag({ id: 'p_1', title: '  ' }), { song: 'p_1', songTitle: null });
    assert.deepEqual(songTag({ id: 'p_1', title: 'Grave Pull' }), { song: 'p_1', songTitle: 'Grave Pull' });
    assert.deepEqual(songTag(null), { song: '', songTitle: null });
  });
  test('peaksOf: each column’s min and max, in -127..127', () => {
    const x = new Float32Array(512);
    x[10] = 1;
    x[300] = -0.5;
    const { peaks, peak } = peaksOf([x], 4);
    assert.deepEqual(Array.from(peaks), [0, 127, 0, 0, -63, 0, 0, 0]);
    assert.equal(peak, 1);
  });
  test('patchRow: a rename, a star, notes, a confirmed key, a tuning; nothing else', () => {
    const { row } = cleanRiff({ audio: audio(1), tempo: 120, key: { root: 'E', scale: 'minor' } });
    const a = patchRow(row, { name: 'Gallop', starred: true, notes: 'verse?', key: { root: 'E', scale: 'phrygian' } });
    assert.deepEqual([a.name, a.starred, a.notes, a.key.sure, a.key.scale], ['Gallop', 1, 'verse?', true, 'phrygian']);
    assert.equal(row.name, 'Riff 1', 'the old row is untouched');
    assert.ok('error' in patchRow(row, { tempo: 99 }));
    assert.ok('error' in patchRow(row, { name: '   ' }));
    assert.ok('error' in patchRow(row, { key: { root: 'H' } }));
  });
  test('placement: the asset and the clip a part needs; fits only at the riff’s tempo', () => {
    const { row } = cleanRiff({ audio: audio(4.5), tempo: 120, beats: 8, offset: 0.25, name: 'Gallop' });
    const p = placement(row, { tempo: 120, start: 16 });
    assert.deepEqual(p.asset, {
      id: assetIdOf(row.id),
      kind: 'audio',
      name: 'Gallop',
      sr: SR,
      channels: 1,
      duration: 4.5,
    });
    assert.deepEqual(p.clip, {
      kind: 'audio',
      asset: p.asset.id,
      start: 16,
      length: 8,
      offset: 0.25,
      gain: 0,
      name: 'Gallop',
    });
    assert.equal(p.fits, true);
    assert.ok(Math.abs(p.tail - 0.25) < 1e-6);
    const q = placement(row, { tempo: 150 });
    assert.equal(q.fits, false);
    assert.equal(q.clip.length, 10, 'the audio’s time kept: 8 beats at 120 is 10 at 150');
  });
});

describe('filters and pages', () => {
  // 30 rows: three songs, two tunings, tempos 100..129, every third starred, a minute apart
  const rows = Array.from({ length: 30 }, (_, i) => {
    const { row } = cleanRiff(
      {
        audio: { sr: SR, channels: [new Float32Array(100)] },
        tempo: 100 + i,
        beats: 4,
        name: i === 7 ? 'Señor Chug' : `Riff ${i + 1}`,
        tuning: i % 2 ? 'drop-c' : 'standard',
        song: { id: 'p_' + (i % 3), title: i % 3 === 2 ? 'Untitled' : ['Grave Pull', 'Void Weather'][i % 3] },
        starred: i % 3 === 0,
        at: 1e12 + i * 60000,
      },
      { now: 0 },
    );
    return row;
  });
  const ids = (page) => page.rows.map((r) => r.name);
  test('newest first, a page at a time, the token carrying on exactly', () => {
    const a = pageOf(rows, { limit: 12 });
    assert.equal(a.rows.length, 12);
    assert.equal(a.rows[0].name, 'Riff 30');
    const b = pageOf(rows, { limit: 12, after: a.next });
    const c = pageOf(rows, { limit: 12, after: b.next });
    assert.equal(c.rows.length, 6);
    assert.equal(c.next, null);
    const all = [...a.rows, ...b.rows, ...c.rows].map((r) => r.id);
    assert.equal(new Set(all).size, 30);
  });
  test('oldest first', () => {
    assert.deepEqual(ids(pageOf(rows, { order: 'old', limit: 2 })), ['Riff 1', 'Riff 2']);
  });
  test('search: each word in the name or the song’s title, accents and case aside', () => {
    assert.deepEqual(ids(pageOf(rows, { q: 'senor' })), ['Señor Chug']);
    assert.equal(pageOf(rows, { q: 'grave', limit: 500 }).rows.length, 10);
    assert.deepEqual(ids(pageOf(rows, { q: 'void riff 29' })), ['Riff 29']);
    assert.equal(pageOf(rows, { q: 'untitled' }).rows.length, 0, 'an untitled song isn’t tagged with a title');
  });
  test('filters: song, tuning, tempo range, dates, starred; together', () => {
    const f = { song: 'p_1', tuning: 'drop-c', tempo: [100, 120], starred: true, limit: 500 };
    const want = rows.filter((r) => r.song === 'p_1' && r.tuning === 'drop-c' && r.tempo <= 120 && r.starred);
    assert.deepEqual(
      pageOf(rows, f).rows.map((r) => r.id),
      want.sort((a, b) => b.at - a.at).map((r) => r.id),
    );
    const g = cleanFilter({ from: 1e12 + 10 * 60000, to: 1e12 + 12 * 60000 });
    assert.deepEqual(
      rows.filter((r) => matches(r, g)).map((r) => r.name),
      ['Riff 11', 'Riff 12', 'Riff 13'],
    );
    assert.deepEqual(cleanFilter({ tempo: [140, 90] }).tempo, [90, 140]);
    assert.equal(cleanFilter({ limit: 9999 }).limit, 500);
    assert.equal(cleanFilter({ after: 'not json' }).after, null);
  });
});

describe('stacks, as data', () => {
  const track = (inserts) => ({
    id: 't_g',
    inserts: inserts.map((x, i) => ({ id: 'fx_' + i, on: true, params: {}, ...x })),
  });
  test('the stack on a track is the run from the first piece of gear to the last', () => {
    const t = track([
      { device: 'core.comp' },
      { device: 'pedal.tubescreamer', params: { drive: 3 } },
      { device: 'core.drive' },
      { device: 'amp.plexi', params: { gain: 7, mic: 2, micpos: 0.4 } },
      { device: 'core.eq8' },
    ]);
    assert.deepEqual(gearSpan(t), { from: 1, to: 3 });
    const s = stackOf(t, { name: 'Brown' });
    assert.deepEqual(
      s.chain.map((l) => l.device),
      ['pedal.tubescreamer', 'core.drive', 'amp.plexi'],
    );
    assert.equal(s.amp, 'amp.plexi');
    assert.equal(s.name, 'Brown');
    assert.equal(stackOf(track([{ device: 'core.eq8' }])), null);
    assert.equal(
      isGear('core.bassrig', () => ({ kind: 'effect', cat: 'amp' })),
      true,
    );
    assert.equal(isGear('core.eq8'), false);
  });
  test('cleanStack and chainKey: the same chain, the same key; any param or order changed, another', () => {
    const s = cleanStack({ chain: CHAIN });
    assert.equal(s.name, 'Half Stack');
    assert.equal(sameChain(CHAIN, JSON.parse(JSON.stringify(CHAIN))), true);
    assert.notEqual(chainKey(CHAIN), chainKey([CHAIN[1], CHAIN[0]]));
    assert.notEqual(chainKey(CHAIN), chainKey([CHAIN[0], { ...CHAIN[1], params: { ...CHAIN[1].params, gain: 6.6 } }]));
    assert.notEqual(chainKey(CHAIN), chainKey([{ ...CHAIN[0], on: false }, CHAIN[1]]));
    assert.equal(
      matchStack(CHAIN, [
        { id: 'a', chain: [CHAIN[1]] },
        { id: 'b', chain: CHAIN },
      ]).id,
      'b',
    );
    assert.equal(cleanStack({ chain: [{ device: 'Bad Id!' }] }), null);
    assert.equal(cleanStack({ chain: Array.from({ length: 33 }, () => CHAIN[0]) }), null);
  });
  test('loadOps: one transaction on the song that swaps the chain in place, undone exactly', () => {
    const store = createStore();
    const r = store.dispatch(
      [
        { type: 'track.add', ref: 'g', track: { name: 'Guitar L', kind: 'audio' } },
        { type: 'insert.add', track: '$g', insert: { device: 'core.stack', params: { gain: 5 } } },
        { type: 'insert.add', track: '$g', insert: { device: 'core.eq8', params: {} } },
      ],
      { by: 'overdub' },
    );
    assert.ok(r.ok, r.error);
    const before = JSON.stringify(store.get().tracks);
    const t = store.track(r.created.g);
    const stack = cleanStack({ name: 'Floor', chain: CHAIN });
    const plan = loadOps(t, stack);
    assert.equal(plan.by, 'you');
    assert.equal(plan.replaced.length, 1);
    const d = store.dispatch(plan.ops, { by: plan.by, label: plan.label });
    assert.ok(d.ok, d.error);
    assert.deepEqual(
      store.track(r.created.g).inserts.map((fx) => fx.device),
      ['pedal.gate', 'core.stack', 'core.eq8'],
    );
    assert.equal(store.track(r.created.g).inserts[1].params.gain, 6.5);
    assert.equal(store.track(r.created.g).inserts[0].by, 'you');
    // the song's copy is a copy: an edit on the stage never reaches the stack it came from
    store.dispatch(
      {
        type: 'insert.set',
        track: r.created.g,
        insert: store.track(r.created.g).inserts[1].id,
        patch: { params: { gain: 9 } },
      },
      { by: 'you' },
    );
    assert.equal(stack.chain[1].params.gain, 6.5);
    store.undo();
    store.undo();
    assert.equal(JSON.stringify(store.get().tracks), before, 'undo puts the old chain back exactly');
    // a track with no gear: the stack goes at the top of its chain
    const e = store.dispatch(
      [
        { type: 'track.add', ref: 'h', track: { name: 'Guitar R', kind: 'audio' } },
        { type: 'insert.add', track: '$h', insert: { device: 'core.eq8' } },
      ],
      { by: 'you' },
    );
    store.dispatch(loadOps(store.track(e.created.h), stack).ops, { by: 'you' });
    assert.deepEqual(
      store.track(e.created.h).inserts.map((fx) => fx.device),
      ['pedal.gate', 'core.stack', 'core.eq8'],
    );
  });
  test('houseStacks: the metal club’s three settings of Half Stack, never stored', () => {
    const h = houseStacks('metal');
    assert.deepEqual(
      h.map((s) => s.id),
      ['house.metal.modern', 'house.metal.djent', 'house.metal.thrash'],
    );
    assert.ok(h.every((s) => s.house && s.amp === 'core.stack' && s.chain.length === 1));
    assert.equal(h[0].name, 'Half Stack, Modern');
  });
});

describe('the riff library with no IndexedDB (memory, for the visit)', () => {
  test('it says where riffs are kept, in words', async () => {
    assert.equal(await riffs.where(), 'memory');
    assert.match(riffs.note(), /won’t keep riffs between visits/);
  });
  let first;
  test('add, get, audio; the row never carries the audio', async () => {
    const r = await riffs.add({
      audio: audio(2),
      tempo: 132,
      beats: 4,
      tuning: 'drop-c',
      stack: { name: 'Floor', chain: CHAIN },
      song: { id: 'p_lib', title: 'Untitled' },
    });
    assert.ok(r.ok, r.error);
    assert.equal(r.where, 'memory');
    assert.match(r.note, /until the tab closes/);
    assert.equal(r.row.name, 'Riff 1');
    first = r.id;
    const g = await riffs.get(first);
    assert.equal(g.chain.length, 2);
    assert.equal(g.songTitle, null);
    const a = await riffs.audio(first);
    assert.equal(a.channels[0].length, 2 * SR);
    assert.equal((await riffs.list()).rows[0].channels, 1);
    assert.equal((await riffs.add({ tempo: 120 })).ok, false);
  });
  test('the song gets a name: its riffs take it', async () => {
    assert.equal(await riffs.tagSong('p_lib', 'Grave Pull'), 1);
    assert.equal((await riffs.get(first)).songTitle, 'Grave Pull');
    assert.equal((await riffs.list({ q: 'grave' })).rows.length, 1);
  });
  test('rename, star, notes, a confirmed key', async () => {
    assert.equal((await riffs.rename(first, 'Gallop')).row.name, 'Gallop');
    assert.equal((await riffs.star(first)).row.starred, 1);
    const u = await riffs.update(first, { notes: 'for the bridge', key: { root: 'C', scale: 'minor' } });
    assert.ok(u.ok);
    assert.equal(u.row.key.sure, true);
    assert.equal((await riffs.update(first, { at: 5 })).ok, false);
    assert.equal((await riffs.update('rf_nothere', { name: 'x' })).ok, false);
  });
  test('into a song: the audio in the asset store once, then the ops the part needs', async () => {
    const put = [];
    const assets = { put: async (id, data) => put.push([id, data.channels[0].length]) };
    const project = { tempo: 132, tracks: [{ id: 't_g' }], assets: {} };
    const r = await riffs.intoSong(first, { project, track: 't_g', start: 8, assets });
    assert.ok(r.ok, r.error);
    assert.deepEqual(put, [[assetIdOf(first), 2 * SR]]);
    assert.deepEqual(
      r.ops.map((o) => o.type),
      ['asset.add', 'clip.add'],
    );
    assert.deepEqual([r.clip.start, r.clip.length, r.fits], [8, 4, true]);
    assert.equal(r.chain.length, 2);
    // the song already describes it: no second asset.add
    const again = await riffs.intoSong(first, {
      project: { ...project, assets: { [assetIdOf(first)]: r.asset } },
      assets,
    });
    assert.deepEqual(again.ops, []);
    // and it goes in through the store, undone exactly
    const store = createStore();
    const t = store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar L', kind: 'audio' } });
    const into = await riffs.intoSong(first, { project: store.get(), track: t.created.g, assets });
    const before = JSON.stringify({ ...store.get(), meta: null }); // (meta.modified ticks)
    const d = store.dispatch(into.ops, { by: 'you', label: 'Riff into the verse' });
    assert.ok(d.ok, d.error);
    assert.equal(store.get().tracks[0].clips[0].asset, assetIdOf(first));
    store.undo();
    assert.equal(JSON.stringify({ ...store.get(), meta: null }), before);
  });
  test('remove gives the whole riff back, and restore puts it back as it was', async () => {
    const whole = await riffs.remove(first);
    assert.equal(whole.row.id, first);
    assert.equal(await riffs.get(first), null);
    assert.equal(await riffs.remove(first), null);
    assert.ok((await riffs.restore(whole)).ok);
    assert.equal((await riffs.get(first)).name, 'Gallop');
    assert.equal((await riffs.restore(whole)).ok, false);
  });
  test('2,000 riffs: a page, a search through all of them and the facets stay fast', async () => {
    const tiny = { sr: SR, channels: [new Float32Array(480)] };
    for (let i = 0; i < 2000; i++) {
      const r = await riffs.add({
        audio: tiny,
        tempo: 90 + (i % 80),
        beats: 4,
        name: i === 1234 ? 'Needle' : '',
        tuning: ['standard', 'drop-c', 'drop-b'][i % 3],
        song: { id: 'p_' + (i % 40), title: i % 40 ? 'Song ' + (i % 40) : 'Untitled' },
        starred: i % 25 === 0,
        at: 2e12 + i * 1000,
      });
      assert.ok(r.ok, r.error);
    }
    let t0 = performance.now();
    const page = await riffs.list({ limit: 50 });
    const tPage = performance.now() - t0;
    assert.equal(page.rows.length, 50);
    assert.ok(page.next);
    t0 = performance.now();
    const hit = await riffs.list({ q: 'needle' });
    const tSearch = performance.now() - t0;
    assert.deepEqual(
      hit.rows.map((r) => r.name),
      ['Needle'],
    );
    t0 = performance.now();
    const f = await riffs.facets();
    const tFacets = performance.now() - t0;
    assert.equal(f.total, 2001);
    assert.equal(f.songs.length, 41);
    assert.equal(f.tunings.length, 3);
    // every page, end to end, once each
    let n = 0,
      next = null;
    do {
      const p = await riffs.list({ limit: 500, after: next });
      n += p.rows.length;
      next = p.next;
    } while (next);
    assert.equal(n, 2001);
    const filtered = await riffs.list({ song: 'p_7', tuning: 'drop-b', tempo: [100, 140], limit: 500 });
    assert.ok(
      filtered.rows.every((r) => r.song === 'p_7' && r.tuning === 'drop-b' && r.tempo >= 100 && r.tempo <= 140),
    );
    const u = await riffs.usage();
    assert.equal(u.count, 2001);
    // (generous: memory pages in a few ms; the ceiling is for a loaded machine)
    assert.ok(
      tPage < 150 && tSearch < 150 && tFacets < 150,
      `page ${tPage.toFixed(1)} ms, search ${tSearch.toFixed(1)} ms, facets ${tFacets.toFixed(1)} ms`,
    );
  });
});

describe('the stack rack with no IndexedDB (memory, for the visit)', () => {
  test('save, list, get, rename, remove, restore', async () => {
    assert.equal(await rack.where(), 'memory');
    assert.match(rack.note(), /saved stacks are here until the tab closes/);
    const s = await rack.save({ name: 'Modern wall', chain: CHAIN }, { song: { id: 'p_1', title: 'Grave Pull' } });
    assert.ok(s.ok, s.error);
    assert.match(s.id, /^st_/);
    assert.equal(s.stack.songTitle, 'Grave Pull');
    const t = await rack.save(CHAIN);
    assert.equal(t.stack.name, 'Half Stack');
    const all = await rack.list();
    assert.deepEqual(
      all.map((x) => x.id),
      [t.id, s.id],
    );
    assert.equal((await rack.rename(s.id, 'Wall')).stack.name, 'Wall');
    assert.equal((await rack.list())[0].id, s.id, 'the last changed first');
    const gone = await rack.remove(t.id);
    assert.equal(gone.id, t.id);
    assert.equal(await rack.get(t.id), null);
    assert.ok((await rack.restore(gone)).ok);
    assert.equal((await rack.get(t.id)).name, 'Half Stack');
    assert.equal((await rack.save({ chain: 'nope' })).ok, false);
  });
  test('loading puts copies on the song and never writes the rack; Save to rack with an id is the only overwrite', async () => {
    const s = await rack.save({ name: 'Floor', chain: CHAIN });
    const store = createStore();
    const r = store.dispatch(
      [
        { type: 'track.add', ref: 'g', track: { name: 'Guitar L', kind: 'audio' } },
        { type: 'insert.add', track: '$g', insert: { device: 'amp.plexi', params: { gain: 3 } } },
      ],
      { by: 'you' },
    );
    const L = await rack.load(s.id, store.track(r.created.g));
    assert.ok(L.ok, L.error);
    assert.equal(L.by, 'you');
    assert.equal(L.label, 'Stack: Floor');
    assert.ok(store.dispatch(L.ops, { by: L.by, label: L.label }).ok);
    const fx = store.track(r.created.g).inserts[1];
    store.dispatch(
      { type: 'insert.set', track: r.created.g, insert: fx.id, patch: { params: { gain: 9.5 } } },
      { by: 'you' },
    );
    assert.equal((await rack.get(s.id)).chain[1].params.gain, 6.5, 'the rack’s stack is as it was saved');
    // Save to rack, onto the same stack, by its id
    const mine = stackOf(store.track(r.created.g));
    const up = await rack.save(mine, { id: s.id });
    assert.ok(up.ok);
    assert.equal((await rack.get(s.id)).chain[1].params.gain, 9.5);
    assert.equal((await rack.get(s.id)).name, 'Floor', 'an update keeps the stack’s name');
    assert.equal((await rack.save(mine, { id: s.id, name: 'Floor, hotter' })).stack.name, 'Floor, hotter');
    assert.equal((await rack.save(mine, { name: 'Copy' })).stack.name, 'Copy');
    assert.equal((await rack.save(mine, { id: 'st_none00' })).ok, false);
    assert.equal((await rack.load('st_none00', store.track(r.created.g))).ok, false);
  });
  test('the house’s stacks load like any other and can’t be renamed or deleted', async () => {
    const h = rack.house('metal');
    assert.equal(h.length, 3);
    assert.equal((await rack.get(h[1].id)).name, 'Half Stack, Djent');
    assert.equal((await rack.rename(h[1].id, 'Mine')).ok, false);
    assert.equal(await rack.remove(h[1].id), null);
    assert.equal((await rack.save(h[1], { id: h[1].id })).ok, false);
    const t = { id: 't_x', inserts: [] };
    const L = await rack.load(h[0].id, t);
    assert.ok(L.ok);
    assert.deepEqual(
      L.ops.map((o) => o.type),
      ['insert.add'],
    );
  });
});
