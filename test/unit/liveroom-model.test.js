// The live room's part of the song (core/liveroom/model.js): the ids that are forever, and the cleaners a loaded
// song's room and sheet go through (docs/research/LIVE-ROOM-MODE.md §9.1, §9.5).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACE_IDS,
  RIG_IDS,
  FINISHES,
  FEEL_IDS,
  ROLES,
  ROOM_LIMITS,
  NAMES,
  ORDER,
  cleanRoom,
  cleanSheet,
  roomOf,
  partOf,
  sheetOf,
  putKey,
  placeKey,
} from '../../app/src/core/liveroom/model.js';
import { cleanProject, createProject, plainText, LIMITS, songSize, sizeError } from '../../app/src/core/project.js';

const quiet = () => {};
const tracks = [
  { id: 't_gl', clips: [{ id: 'c_take1' }, { id: 'c_take2' }] },
  { id: 't_dr', clips: [] },
];
const sections = [{ id: 's_verse' }, { id: 's_chorus' }];

describe('the ids are forever', () => {
  test("places, rigs, finishes, feels and roles are exactly the spec's", () => {
    assert.deepEqual(PLACE_IDS, ['metal', 'basement', 'bluesbar', 'kitchen']);
    assert.deepEqual(RIG_IDS, ['modern', 'djent', 'thrash', 'hardrock', 'crunch', 'edge']);
    assert.deepEqual([...new Set(Object.values(FINISHES).flat())].sort(), [
      'bar',
      'bare',
      'close',
      'loud',
      'raw',
      'room',
      'tight',
      'warm',
    ]);
    assert.deepEqual(Object.keys(FINISHES), PLACE_IDS);
    assert.equal(FEEL_IDS.length, 22);
    assert.deepEqual(ROLES, [
      'guitarL',
      'guitarR',
      'guitar',
      'lead',
      'drums',
      'bass',
      'heard',
      'bassYours',
      'take',
      'voice',
      'kguitar',
      'shaker',
      'cajon',
      'kbass',
      'strings',
      'chords',
    ]);
  });

  test('they are frozen, and every one has a name', () => {
    assert.ok(Object.isFrozen(PLACE_IDS) && Object.isFrozen(FEEL_IDS) && Object.isFrozen(FINISHES.metal));
    assert.throws(() => /** @type {any} */ (PLACE_IDS).push('moon'));
    for (const id of PLACE_IDS) assert.ok(NAMES.place[id], id);
    for (const id of FEEL_IDS) assert.ok(NAMES.feel[id], id);
    for (const id of RIG_IDS) assert.ok(NAMES.rig[id], id);
    for (const id of Object.values(FINISHES).flat()) assert.ok(NAMES.finish[id], id);
  });

  test("the caps are the spec's, and project.js LIMITS holds them", () => {
    assert.equal(ROOM_LIMITS.sheetSections, 64);
    assert.equal(ROOM_LIMITS.sheetLines, 400);
    assert.equal(ROOM_LIMITS.sheetChars, 24000);
    assert.equal(ROOM_LIMITS.lineChars, 200);
    assert.equal(ROOM_LIMITS.notesChars, 2000);
    assert.equal(ROOM_LIMITS.roomParts, 512);
    assert.equal(ROOM_LIMITS.roomBytes, 65536);
    for (const k of ['sheetSections', 'sheetLines', 'sheetChars', 'roomParts', 'roomBytes'])
      assert.equal(LIMITS[k], ROOM_LIMITS[k]);
  });
});

describe('cleanRoom', () => {
  test('a room comes back canonical: its keys in order, false flags and empty maps gone', () => {
    const r = cleanRoom(
      {
        managed: {},
        tracks: { drums: 't_dr', guitarL: 't_gl' },
        finish: 'tight',
        parts: { s_verse: { drop: false, oneSide: true, feel: 'chugs', reps: 2 } },
        place: 'metal',
        v: 1,
        takes: { c_take1: { onMaster: false, capo: 0, bpm: 132 } },
      },
      { tracks, sections, warn: quiet },
    );
    assert.deepEqual(r, {
      v: 1,
      place: 'metal',
      finish: 'tight',
      tracks: { drums: 't_dr', guitarL: 't_gl' },
      parts: { s_verse: { feel: 'chugs', reps: 2, oneSide: true } },
      takes: { c_take1: { bpm: 132 } },
    });
    assert.deepEqual(Object.keys(r), ['v', 'place', 'finish', 'tracks', 'parts', 'takes']);
  });

  test('roles name tracks the song has, parts its sections, takes and the master its clips', () => {
    const r = cleanRoom(
      {
        tracks: { guitarL: 't_gl', drums: 't_gone', bass: 7 },
        parts: { s_verse: { feel: 'chugs' }, s_gone: { feel: 'open' } },
        takes: { c_take2: { capo: 3 }, c_gone: { capo: 2 } },
        master: 'c_gone',
        managed: { t_dr: { gain: -3 }, t_gone: { gain: 0 }, master: { gain: -1, pan: 0 } },
      },
      { tracks, sections, warn: quiet },
    );
    assert.deepEqual(r.tracks, { guitarL: 't_gl' });
    assert.deepEqual(r.parts, { s_verse: { feel: 'chugs' } });
    assert.deepEqual(r.takes, { c_take2: { capo: 3 } });
    assert.equal('master' in r, false);
    assert.deepEqual(r.managed, { t_dr: { gain: -3 }, master: { gain: -1, pan: 0 } });
  });

  test("without the song's tracks and sections, ids are kept as they are", () => {
    const r = cleanRoom(
      { tracks: { guitarL: 't_x' }, parts: { s_x: { feel: 'open' } }, master: 'c_x' },
      { warn: quiet },
    );
    assert.deepEqual(r, { v: 1, master: 'c_x', tracks: { guitarL: 't_x' }, parts: { s_x: { feel: 'open' } } });
  });

  test('values out of range or of the wrong kind are dropped; an id a newer studio knows is kept', () => {
    const r = cleanRoom(
      {
        place: 'moonbase',
        rig: 'Not An Id',
        tuning: 'drop-a',
        mic: 'three',
        parts: {
          s_verse: { feel: 'polka', busy: 2, loud: -1, reps: 5, drop: 'yes', learned: { from: 'c_take1', thin: 'no' } },
          s_chorus: { busy: 0.5 },
        },
        managed: { t_dr: { gain: Infinity, pan: 2, chain: 'h_ab' } },
        takes: { c_take1: { capo: 12, bpm: 401 } },
      },
      { tracks, sections, warn: quiet },
    );
    assert.deepEqual(r, {
      v: 1,
      place: 'moonbase',
      tuning: 'drop-a',
      parts: { s_verse: { feel: 'polka', loud: -1, learned: { from: 'c_take1' } } },
      managed: { t_dr: { chain: 'h_ab' } },
    });
  });

  test("keys it doesn't know are kept for a newer reader, after the known ones, and never __proto__", () => {
    const x = JSON.parse(
      '{"zeta":{"a":[1,2]},"place":"basement","__proto__":{"polluted":true},"parts":{"s_verse":{"swing":0.6,"feel":"straight"}}}',
    );
    const r = cleanRoom(x, { tracks, sections, warn: quiet });
    assert.deepEqual(Object.keys(r), ['v', 'place', 'parts', 'zeta']);
    assert.deepEqual(r.zeta, { a: [1, 2] });
    assert.deepEqual(r.parts.s_verse, { feel: 'straight', swing: 0.6 });
    assert.equal(/** @type {any} */ ({}).polluted, undefined);
    assert.equal(Object.hasOwn(r, '__proto__'), false);
  });

  test('cleaning twice is cleaning once', () => {
    const x = { finish: 'raw', place: 'basement', parts: { s_chorus: { reps: 3, feel: 'skank' } }, extra: 1 };
    const once = cleanRoom(x, { tracks, sections, warn: quiet });
    assert.deepEqual(cleanRoom(once, { tracks, sections, warn: quiet }), once);
    assert.equal(JSON.stringify(cleanRoom(once, { tracks, sections, warn: quiet })), JSON.stringify(once));
  });

  test("a room that isn't an object is left out, and says so", () => {
    const said = [];
    assert.equal(cleanRoom('metal', { warn: (w) => said.push(w) }), null);
    assert.equal(cleanRoom(null, { warn: (w) => said.push(w) }), null);
    assert.equal(said.length, 1);
    assert.equal(said[0].kind, 'room');
  });

  test('the caps: 512 parts, 64 KB as JSON', () => {
    const many = {};
    for (let i = 0; i < 600; i++) many[`s_${i}`] = { feel: 'open' };
    const said = [];
    const r = cleanRoom({ parts: many }, { warn: (w) => said.push(w) });
    assert.equal(Object.keys(r.parts).length, 512);
    assert.deepEqual(Object.keys(r.parts).slice(0, 2), ['s_0', 's_1']);
    assert.match(said[0].message, /512/);
    const big = {};
    for (let i = 0; i < 400; i++) big[`t_${i}`] = { gain: -3, pan: 0.5, chain: 'x'.repeat(60) };
    const said2 = [];
    const r2 = cleanRoom({ place: 'metal', managed: big, notes: 'y'.repeat(70000) }, { warn: (w) => said2.push(w) });
    assert.ok(JSON.stringify(r2).length <= 65536);
    assert.equal(r2.place, 'metal');
    assert.equal('notes' in r2, false, 'an unknown key goes first');
    assert.match(said2.at(-1).message, /64 KB/);
  });

  test("roles count toward the 64 KB too: the ones it doesn't know go first, the known ones last", () => {
    const long = `t_${'g'.repeat(60)}`;
    const roles = { guitarL: long };
    for (let i = 0; i < 1200; i++) roles[`role${String(i).padStart(28, '0')}`] = long;
    roles.drums = long;
    const song = [{ id: long, clips: [] }];
    const said = [];
    const r = cleanRoom({ place: 'metal', tracks: roles }, { tracks: song, warn: (w) => said.push(w) });
    assert.ok(JSON.stringify(r).length <= ROOM_LIMITS.roomBytes, `${JSON.stringify(r).length} bytes`);
    assert.equal(r.tracks.guitarL, long);
    assert.equal(r.tracks.drums, long);
    assert.match(said.at(-1).message, /it keeps 64 KB/);
    assert.equal(JSON.stringify(cleanRoom(r, { tracks: song, warn: quiet })), JSON.stringify(r));
    const p = cleanProject(
      { ...createProject(), tracks: [{ id: long, name: 'Guitar', kind: 'audio', clips: [] }], room: { tracks: roles } },
      { warn: quiet },
    );
    assert.equal(sizeError(songSize(p), null, { loaded: true }), null, 'a link holding it comes in, cut');
  });
});

describe('cleanSheet', () => {
  test('a sheet comes back canonical, its lines signed and plain', () => {
    const s = cleanSheet(
      {
        sections: [
          {
            lines: [{ text: 'Some\u0007where a [G]pa‮per', by: 'claude', id: 'sl_a' }, { text: 'two' }],
            name: 'Verse 1',
            id: 'ss_v',
          },
        ],
        notes: 'Slow.\r\nThen\u0000 fast.',
        capo: 3,
        time: [3, 4],
        v: 1,
      },
      { warn: quiet },
    );
    assert.deepEqual(s, {
      v: 1,
      capo: 3,
      time: [3, 4],
      notes: 'Slow.\nThen fast.',
      sections: [
        {
          id: 'ss_v',
          name: 'Verse 1',
          lines: [
            { id: 'sl_a', text: 'Somewhere a [G]paper', by: 'claude' },
            { id: 'sl_1', text: 'two', by: 'you' },
          ],
        },
      ],
    });
  });

  test('its text is plain the way every name in the song is', () => {
    const raw = 'a\u0000b\u001fc\u007fd\u009fe‪f‮g⁦h⁩i [Am]j';
    const s = cleanSheet({ sections: [{ name: raw, lines: [{ text: raw }] }] }, { warn: quiet });
    assert.equal(s.sections[0].lines[0].text, plainText(raw));
    assert.equal(s.sections[0].name, plainText(raw));
  });

  test('every id is made unique, the same way every time', () => {
    const x = {
      sections: [
        { id: 'dup', lines: [{ id: 'dup' }, { id: 'dup' }] },
        { id: 'bad id!', lines: [{}] },
      ],
    };
    const a = cleanSheet(x, { warn: quiet }),
      b = cleanSheet(x, { warn: quiet });
    assert.deepEqual(a, b);
    const ids = a.sections.flatMap((s) => [s.id, ...s.lines.map((l) => l.id)]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(a.sections[0].id, 'dup');
    assert.equal(a.sections[1].name, 'Section');
  });

  test('capo 0, a bad time and empty notes are no key at all; cleaning twice is cleaning once', () => {
    const s = cleanSheet({ capo: 0, time: [4, 3], notes: '', sections: 'no' }, { warn: quiet });
    assert.deepEqual(s, { v: 1, sections: [] });
    const full = cleanSheet({ capo: 2, sections: [{ name: 'A', lines: [{ text: 'x' }] }], z: true }, { warn: quiet });
    assert.equal(JSON.stringify(cleanSheet(full, { warn: quiet })), JSON.stringify(full));
  });

  test('the caps: 64 sections, 400 lines, 24,000 characters, a line 200, the notes 2,000', () => {
    const said = [];
    const secs = Array.from({ length: 70 }, (_, i) => ({
      name: `S${i}`,
      lines: Array.from({ length: 10 }, () => ({ text: 'x'.repeat(250) })),
    }));
    const s = cleanSheet({ notes: 'n'.repeat(3000), sections: secs }, { warn: (w) => said.push(w) });
    assert.equal(s.notes.length, 2000);
    assert.equal(s.sections.length, 64);
    assert.ok(s.sections.every((x) => x.lines.every((l) => l.text.length === 200)));
    const lines = s.sections.reduce((n, x) => n + x.lines.length, 0);
    const chars =
      s.notes.length +
      s.sections.reduce((n, x) => n + x.name.length + x.lines.reduce((m, l) => m + l.text.length, 0), 0);
    assert.ok(lines <= 400 && chars <= 24000, `${lines} lines, ${chars} characters`);
    assert.match(said[0].message, /left out/);
    const size = songSize({ ...createProject(), sheet: s });
    assert.equal(sizeError(size), null, "a cleaned sheet is within the song's caps");
  });

  test("its sections' names count toward the 24,000 characters", () => {
    const said = [];
    const full = { name: 'A'.repeat(100), lines: Array.from({ length: 120 }, () => ({ text: 'x'.repeat(200) })) };
    const names = Array.from({ length: 63 }, (_, i) => ({ name: String(i).padEnd(100, 'n'), lines: [] }));
    const s = cleanSheet({ sections: [full, ...names] }, { warn: (w) => said.push(w) });
    const size = songSize({ ...createProject(), sheet: s });
    assert.equal(size.sheetChars, 24000);
    assert.equal(sizeError(size, null, { loaded: true }), null, 'a link holding it comes in, cut');
    assert.equal(s.sections.length, 2, "the first name that doesn't fit goes, and every section after it");
    assert.match(said[0].message, /62 sections and 1 line left out/);
    assert.equal(JSON.stringify(cleanSheet(s, { warn: quiet })), JSON.stringify(s));
  });

  test("a sheet that isn't an object is left out, and says so", () => {
    const said = [];
    assert.equal(cleanSheet([1, 2], { warn: (w) => said.push(w) }), null);
    assert.equal(said[0].kind, 'sheet');
  });
});

describe('the song keeps them', () => {
  test('cleanProject keeps a room and a sheet, re-checked against the song', () => {
    const p = createProject();
    p.tracks = [{ id: 't_gl', name: 'Guitar L', kind: 'audio', clips: [] }];
    p.sections = [{ id: 's_v', name: 'Verse', start: 0, length: 16 }];
    p.room = {
      v: 1,
      place: 'metal',
      tracks: { guitarL: 't_gl', drums: 't_none' },
      parts: { s_v: { feel: 'chugs' }, s_none: { feel: 'open' } },
    };
    p.sheet = { v: 1, sections: [{ id: 'ss_1', name: 'Verse 1', lines: [{ id: 'sl_1', text: 'la [G]la' }] }] };
    const c = cleanProject(JSON.parse(JSON.stringify(p)), { warn: quiet });
    assert.deepEqual(c.room, { v: 1, place: 'metal', tracks: { guitarL: 't_gl' }, parts: { s_v: { feel: 'chugs' } } });
    assert.deepEqual(c.sheet.sections[0].lines[0], { id: 'sl_1', text: 'la [G]la', by: 'you' });
    const again = cleanProject(JSON.parse(JSON.stringify(c)), { warn: quiet });
    assert.equal(JSON.stringify(again.room), JSON.stringify(c.room));
    assert.equal(JSON.stringify(again.sheet), JSON.stringify(c.sheet));
  });

  test('a song without them gets neither', () => {
    const c = cleanProject(createProject(), { warn: quiet });
    assert.equal('room' in c, false);
    assert.equal('sheet' in c, false);
    const d = cleanProject({ ...createProject(), room: 5, sheet: 'x' }, { warn: quiet });
    assert.equal('room' in d, false);
    assert.equal('sheet' in d, false);
  });

  test('roomOf, partOf and sheetOf read them, or null', () => {
    const p = { room: { v: 1, parts: { s_v: { feel: 'open' } } }, sheet: { v: 1, sections: [] } };
    assert.equal(roomOf(p), p.room);
    assert.equal(partOf(p, 's_v'), p.room.parts.s_v);
    assert.equal(partOf(p, { id: 's_v' }), p.room.parts.s_v);
    assert.equal(partOf(p, 's_x'), null);
    assert.equal(partOf(p, 'toString'), null);
    assert.equal(sheetOf(p), p.sheet);
    assert.equal(roomOf({}), null);
    assert.equal(partOf({}, 's_v'), null);
    assert.equal(sheetOf(null), null);
  });
});

describe('key order', () => {
  test('putKey puts a new key where ORDER keeps it; placeKey at an index', () => {
    const o = { v: 1, finish: 'tight', zeta: 1 };
    putKey(o, 'place', 'metal', ORDER.room);
    assert.deepEqual(Object.keys(o), ['v', 'place', 'finish', 'zeta']);
    putKey(o, 'parts', {}, ORDER.room);
    assert.deepEqual(Object.keys(o), ['v', 'place', 'finish', 'parts', 'zeta']);
    putKey(o, 'finish', 'loud', ORDER.room);
    assert.deepEqual(Object.keys(o), ['v', 'place', 'finish', 'parts', 'zeta']);
    assert.equal(o.finish, 'loud');
    const q = { a: 1, b: 2, c: 3 };
    placeKey(q, 'x', 0, 1);
    assert.deepEqual(Object.keys(q), ['a', 'x', 'b', 'c']);
    placeKey(q, 'y', 0, 99);
    assert.deepEqual(Object.keys(q), ['a', 'x', 'b', 'c', 'y']);
  });
});
