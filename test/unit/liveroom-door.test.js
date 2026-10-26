// The live room's door and its tape box (docs/research/LIVE-ROOM-MODE.md §2.1, §3.13, §9.6, §11.8): decideDoor's every
// row (ui/liveroom/door-decide.js), and the label written from the song (core/liveroom/label.js labelOf, titleDice).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideDoor } from '../../app/src/ui/liveroom/door-decide.js';
import { labelOf, titleDice, noteParts, whereLeft, listWords } from '../../app/src/core/liveroom/label.js';
import { createProject } from '../../app/src/core/project.js';

const room = (side) => ({ v: 1, side, place: null, outputs: {}, said: {} });
const D = (o) => decideDoor({ search: '', hash: '', saved: false, room: room(null), webdriver: false, ...o });

describe('decideDoor: every row of §2.1', () => {
  test('a first visit, bare /app/ (nothing saved): the door, on a new song', () => {
    assert.deepEqual(D({}), { side: 'room', song: 'new' });
    assert.deepEqual(D({ room: null }), { side: 'room', song: 'new' });
  });
  test('coming back, last on the room’s side, a saved song with a room: the room on it', () => {
    assert.deepEqual(D({ saved: { room: true }, room: room('room') }), { side: 'room', song: 'saved' });
    // (never through the glass yet: the song was made in the room, so it opens there)
    assert.deepEqual(D({ saved: { room: true }, room: room(null) }), { side: 'room', song: 'saved' });
  });
  test('coming back, last in the control room: the control room', () => {
    assert.deepEqual(D({ saved: { room: true }, room: room('control') }), { side: 'control', song: 'saved' });
  });
  test('a saved song with no room field: the control room, wherever you were last', () => {
    assert.deepEqual(D({ saved: { room: false }, room: room('room') }), { side: 'control', song: 'saved' });
    assert.deepEqual(D({ saved: true, room: room('room') }), { side: 'control', song: 'saved' });
  });
  test('a blank saved song, last on the room’s side (a reload at the door): the room’s door on it', () => {
    assert.deepEqual(D({ saved: { room: false, blank: true }, room: room('room') }), { side: 'room', song: 'saved' });
    assert.deepEqual(D({ saved: { room: false, blank: true }, room: room('control') }), { side: 'control', song: 'saved' });
    assert.deepEqual(D({ saved: { room: false, blank: true }, room: room(null) }), { side: 'control', song: 'saved' });
    assert.deepEqual(D({ saved: { room: false, blank: true }, room: room('room'), webdriver: true }), { side: 'control', song: 'saved' });
  });
  test('?new: a new song in the room', () => {
    assert.deepEqual(D({ search: '?new' }), { side: 'room', song: 'new' });
    assert.deepEqual(D({ search: '?new', saved: { room: false } }), { side: 'room', song: 'new' });
  });
  test('?studio: a new song in the control room', () => {
    assert.deepEqual(D({ search: '?studio' }), { side: 'control', song: 'new' });
    assert.deepEqual(D({ search: '?studio', saved: { room: true }, room: room('room') }), { side: 'control', song: 'new' });
  });
  test('?room: the room on a new song, even under navigator.webdriver', () => {
    assert.deepEqual(D({ search: '?room' }), { side: 'room', song: 'new' });
    assert.deepEqual(D({ search: '?room', webdriver: true }), { side: 'room', song: 'new' });
    assert.deepEqual(D({ search: '?room', webdriver: true, saved: { room: false } }), { side: 'room', song: 'new' });
  });
  test('?demo, ?new&device=, the control room’s own ways in: the control room, as today', () => {
    assert.deepEqual(D({ search: '?demo' }), { side: 'control', song: 'demo' });
    assert.deepEqual(D({ search: '?demo=boiler-room', saved: { room: true }, room: room('room') }), { side: 'control', song: 'demo' });
    assert.deepEqual(D({ search: '?new&device=core.bass' }), { side: 'control', song: 'new' });
    for (const k of ['jam', 'flip', 'view=simple', 'coach', 'device=core.bass']) {
      assert.deepEqual(D({ search: '?' + k }), { side: 'control', song: 'demo' }, k);
      assert.deepEqual(D({ search: '?' + k, saved: { room: true }, room: room('room') }), { side: 'control', song: 'saved' }, k + ', saved');
    }
  });
  test('a share link: the control room’s listener, never the room', () => {
    assert.deepEqual(D({ hash: '#s=abc' }), { side: 'control', song: 'shared' });
    assert.deepEqual(D({ hash: '#x=1&s=abc', saved: { room: true }, room: room('room') }), { side: 'control', song: 'shared' });
    assert.deepEqual(D({ hash: '#s=abc', search: '?room' }), { side: 'control', song: 'shared' });
    assert.deepEqual(D({ hash: '#s=abc', search: '?new' }), { side: 'control', song: 'shared' });
  });
  test('under navigator.webdriver, everything but ?room: the control room, exactly as today', () => {
    const W = (o) => D({ webdriver: true, ...o });
    assert.deepEqual(W({}), { side: 'control', song: 'demo' });
    assert.deepEqual(W({ saved: { room: true }, room: room('room') }), { side: 'control', song: 'saved' });
    assert.deepEqual(W({ saved: true }), { side: 'control', song: 'saved' });
    assert.deepEqual(W({ search: '?new' }), { side: 'control', song: 'new' });
    assert.deepEqual(W({ search: '?studio' }), { side: 'control', song: 'new' });
    assert.deepEqual(W({ search: '?demo=lido' }), { side: 'control', song: 'demo' });
    assert.deepEqual(W({ hash: '#s=abc' }), { side: 'control', song: 'shared' });
  });
  test('it is pure and forgiving: no arguments, junk in, the same answer every time', () => {
    assert.deepEqual(decideDoor(), { side: 'room', song: 'new' });
    assert.deepEqual(decideDoor({ search: null, hash: null, saved: null, room: null }), { side: 'room', song: 'new' });
    assert.deepEqual(D({ saved: { room: true } }), D({ saved: { room: true } }));
  });
});

/* ------------------------------------------------------------------------------------------------ the tape box */
// a metal club song: Verse doubled, Chorus on the left, Breakdown empty
function metalSong({ title = 'Untitled' } = {}) {
  const p = createProject({ id: 'p_tape', title, tempo: 132, key: { root: 'C', scale: 'minor' } });
  const audio = (id, start, length) => ({ id, kind: 'audio', asset: 'a_' + id, start, length, offset: 0, gain: 0, by: 'you' });
  const notes = (id, start, length, n) => ({ id, kind: 'notes', start, length, by: 'overdub', notes: Array.from({ length: n }, (_, i) => ({ t: (i * length) / n, d: 0.25, p: 36, v: 0.8, by: 'overdub' })) });
  p.sections = [{ id: 's_v', name: 'Verse', start: 0, length: 32 }, { id: 's_c', name: 'Chorus', start: 32, length: 32 }, { id: 's_b', name: 'Breakdown', start: 64, length: 32 }];
  p.tracks = [
    { id: 't_l', name: 'Guitar L', kind: 'audio', clips: [audio('c1', 0, 32), audio('c2', 32, 32)], inserts: [], gain: 0, pan: -0.8 },
    { id: 't_r', name: 'Guitar R', kind: 'audio', clips: [audio('c3', 0, 32)], inserts: [], gain: 0, pan: 0.8 },
    { id: 't_d', name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} }, clips: [notes('c4', 0, 96, 96)], inserts: [], gain: 0, pan: 0 },
  ];
  p.room = { v: 1, place: 'metal', rig: 'modern', tuning: 'drop-c', finish: 'tight', tracks: { guitarL: 't_l', guitarR: 't_r', drums: 't_d' } };
  return p;
}

describe('the tape box: its label from the song', () => {
  test('an untitled metal club song: the house’s title, the slate, the parts, the note', () => {
    const L = labelOf(metalSong());
    assert.equal(L.title, 'Untitled · 132 · drop C');
    assert.equal(L.named, false);
    assert.equal(L.slate, 'METAL CLUB · DROP C · 132 · C MINOR');
    assert.deepEqual(L.parts, ['Verse', 'Chorus', 'Breakdown']);
    assert.equal(L.note, 'Verse doubled. Chorus wants its other side. The breakdown’s still empty.');
    assert.equal(L.finished, false);
  });
  test('a named song keeps its title; the cover is seeded by the title, the key and the tempo', () => {
    const a = labelOf(metalSong({ title: 'Void Weather' })), b = labelOf(metalSong({ title: 'Copper Pipe' }));
    assert.equal(a.title, 'Void Weather');
    assert.equal(a.named, true);
    assert.equal(a.cover.title, 'Void Weather');
    assert.equal(a.cover.place, 'metal');
    assert.equal(a.cover.tempo, 132);
    assert.equal(a.cover.key, 'C minor');
    assert.notEqual(a.cover.seed, b.cover.seed);
    assert.equal(labelOf(metalSong({ title: 'Void Weather' })).cover.seed, a.cover.seed);
    // one spike per bar: 96 beats of 4/4 is 24 bars, each 0..1, the busiest 1
    assert.equal(a.cover.bars.length, 24);
    assert.ok(a.cover.bars.every((x) => x >= 0 && x <= 1));
    assert.equal(Math.max(...a.cover.bars), 1);
  });
  test('the note: every part doubled is finished; nothing yet says so', () => {
    const p = metalSong();
    p.tracks[1].clips.push({ id: 'c5', kind: 'audio', asset: 'a5', start: 32, length: 32, offset: 0, gain: 0, by: 'you' }, { id: 'c6', kind: 'audio', asset: 'a6', start: 64, length: 32, offset: 0, gain: 0, by: 'you' });
    p.tracks[0].clips.push({ id: 'c7', kind: 'audio', asset: 'a7', start: 64, length: 32, offset: 0, gain: 0, by: 'you' });
    const L = labelOf(p);
    assert.equal(L.note, 'Verse, chorus and breakdown doubled.');
    assert.equal(L.finished, true);
    const q = metalSong();
    q.tracks[0].clips = []; q.tracks[1].clips = [];
    assert.equal(labelOf(q).note, 'Nothing on tape yet.');
  });
  test('coming back’s clause, and at most three sentences', () => {
    assert.equal(whereLeft(metalSong()), 'verse doubled; chorus wants its other side; the breakdown’s still empty');
    assert.ok(noteParts(metalSong()).length <= 3);
    assert.equal(listWords(['a', 'b', 'c']), 'a, b and c');
  });
  test('the dice: three different titles, the same three for the same song', () => {
    const p = metalSong();
    const a = titleDice(p), b = titleDice(metalSong());
    assert.equal(a.length, 3);
    assert.equal(new Set(a).size, 3);
    assert.deepEqual(a, b);
    for (const t of a) assert.match(t, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    const q = metalSong(); q.id = 'p_other';
    assert.notDeepEqual(titleDice(q), a);
  });
  test('a control-room song (no room): a plain label', () => {
    const p = createProject({ title: 'Night Shift', tempo: 92, key: { root: 'A', scale: 'minor' } });
    const L = labelOf(p);
    assert.equal(L.title, 'Night Shift');
    assert.equal(L.slate, '92 · A MINOR');
    assert.equal(L.cover.place, null);
  });
});
