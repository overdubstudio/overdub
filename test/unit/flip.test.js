// Flip a song (spec 0014 section D, R8, R31, R33): the files' labels and the song's name, the import and the stems as
// ops (core/flip.js), the map's stats and the conformed clip's drift (core/music.js mapStats), get_project's grid line
// (core/project.js mapLine), and the release's trim and toast line (ui/export.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { labelStem, labelFiles, songNameOf, planFlip, planStems } from '../../app/src/core/flip.js';
import { mapStats, shiftMap, mapInsert, mapRemove } from '../../app/src/core/music.js';
import { createStore } from '../../app/src/core/store.js';
import { cleanProject, createProject, mapLine } from '../../app/src/core/project.js';
import { releaseTrim, releaseLine } from '../../app/src/ui/export.js';

const asset = (id, duration = 60) => ({ id, name: `${id}.wav`, sr: 48000, channels: 2, duration });

describe('the files', () => {
  test('stems are labelled by name; anything else is the original', () => {
    assert.equal(labelStem('One Last Breath (Vocals).wav'), 'vocals');
    assert.equal(labelStem('olb_acapella.mp3'), 'vocals');
    assert.equal(labelStem('olb-drums.flac'), 'drums');
    assert.equal(labelStem('OLB - Bass.m4a'), 'bass');
    assert.equal(labelStem('olb inst.wav'), 'other');
    assert.equal(labelStem('One Last Breath.mp3'), null);
    assert.equal(labelStem('Bassline Junkie.wav'), null);
  });
  test('a lone file is the original, whatever its name', () => {
    assert.deepEqual(labelFiles(['Drum Machine Love.wav']), ['original']);
    assert.deepEqual(labelFiles(['song.wav', 'song vocals.wav', 'song drums.wav']), ['original', 'vocals', 'drums']);
  });
  test("the song's name: the original's, else a stem's without its stem word", () => {
    assert.equal(songNameOf(['olb_drums.wav', 'One Last Breath.mp3']), 'One Last Breath');
    assert.equal(songNameOf(['One Last Breath (Vocals).wav', 'One Last Breath (Drums).wav']), 'One Last Breath');
    assert.equal(songNameOf(['Drum Machine Love.wav']), 'Drum Machine Love');
  });
});

describe('the import, one undo step', () => {
  test('Original, then the stems in order; the vocal plays, the rest are muted', () => {
    const store = createStore();
    const files = [
      { role: 'drums', asset: asset('a_d') },
      { role: 'vocals', asset: asset('a_v') },
      { role: 'original', asset: asset('a_o') },
    ];
    const plan = planFlip(store.get(), { name: 'One Last Breath', files });
    const r = store.dispatch(plan.ops, { by: 'you', label: plan.label });
    assert.ok(r.ok, r.error);
    const p = store.get();
    assert.equal(p.title, 'One Last Breath');
    assert.deepEqual(
      p.tracks.map((t) => [t.name, !!t.mute]),
      [
        ['Original', true],
        ['Vocals', false],
        ['Drums', true],
      ],
    );
    assert.ok(
      p.tracks.every(
        (t) => t.clips.length === 1 && t.clips[0].start === 0 && t.clips[0].offset === 0 && t.clips[0].name === t.name,
      ),
    );
    assert.equal(p.tracks[0].clips[0].length, 120);
    assert.equal(store.history.length, 1);
    assert.equal(store.history[0].label, 'Flip: One Last Breath');
    store.undo();
    assert.equal(store.get().tracks.length, 0);
  });
  test('with the split to come, or no vocal stem, the original plays', () => {
    const p = createProject();
    const later = planFlip(p, { name: 'x', files: [{ role: 'original', asset: asset('a_o') }], stemsLater: true });
    assert.equal(later.ops.find((o) => o.type === 'track.add').track.mute, false);
    const noVox = planFlip(p, {
      name: 'x',
      files: [
        { role: 'original', asset: asset('a_o') },
        { role: 'bass', asset: asset('a_b') },
      ],
    });
    assert.deepEqual(
      noVox.ops.filter((o) => o.type === 'track.add').map((o) => [o.track.name, o.track.mute]),
      [
        ['Original', false],
        ['Bass', true],
      ],
    );
  });
  test('the stems landing later: after the original, at its place, the vocal playing and the original muted', () => {
    const store = createStore();
    const plan = planFlip(store.get(), {
      name: 'x',
      files: [{ role: 'original', asset: asset('a_o') }],
      stemsLater: true,
    });
    const r = store.dispatch(plan.ops, { by: 'you', label: plan.label });
    const o = { track: r.created[plan.refs[0].track], clip: r.created[plan.refs[0].clip] };
    store.dispatch({ type: 'clip.set', track: o.track, clip: o.clip, patch: { start: 2.5 } }, { by: 'overdub' });
    const st = planStems(store.get(), {
      name: 'x',
      original: o,
      assets: { vocals: asset('a_v'), drums: asset('a_d'), bass: asset('a_b'), other: asset('a_x') },
    });
    assert.ok(store.dispatch(st.ops, { by: 'overdub', label: st.label }).ok);
    const p = store.get();
    assert.deepEqual(
      p.tracks.map((t) => [t.name, !!t.mute, t.clips[0].start]),
      [
        ['Original', true, 2.5],
        ['Vocals', false, 2.5],
        ['Drums', true, 2.5],
        ['Bass', true, 2.5],
        ['Other', true, 2.5],
      ],
    );
    assert.equal(st.label, 'Stems from x');
  });
});

describe('the map, said', () => {
  // a grid at 120 with one anchor a bar, a 3-bar gap with none (free), the conformed clip at beat 2
  const anchors = [
    { beat: 0, sec: 0 },
    { beat: 4, sec: 2 },
    { beat: 8, sec: 4 },
    { beat: 20, sec: 10 },
    { beat: 24, sec: 12.1 },
  ];
  const song = () =>
    cleanProject({
      ...createProject(),
      key: { root: 'D', scale: 'minor' },
      tracks: [
        {
          id: 't_o',
          name: 'Original',
          kind: 'audio',
          clips: [{ id: 'c_o', kind: 'audio', name: 'Original', start: 2, length: 20, asset: 'a', offset: 0 }],
        },
      ],
      tempoMap: { anchors, clip: 'c_o', clipStart: 2 },
    });
  test('nominal, the range, the free spans; no drift on its grid', () => {
    const st = mapStats(song());
    assert.deepEqual(st.free, [[8, 20]]);
    assert.equal(st.drift, 0);
    assert.equal(st.clip, 'c_o');
    assert.ok(st.lo <= st.hi && st.lo >= 114 && st.hi <= 120.1);
  });
  test("get_project's line", () => {
    const line = mapLine(song());
    assert.match(line, /^Grid follows Original: \d+(\.\d+)? BPM nominal, .*1 free span \(beats 8–20\); key D minor/);
    assert.doesNotMatch(line, /off its grid/);
  });
  test('a move that left the grid behind is measured', () => {
    const p = song();
    p.tracks[0].clips[0].start = 2.5;
    assert.equal(mapStats(p).drift, 250);
    assert.match(mapLine(p), /Original is off its grid by 250 ms/);
  });
  test('clipStart moves with whole-bar shifts and with time.insert / time.remove', () => {
    const m = { anchors, clip: 'c_o', clipStart: 2 };
    assert.equal(shiftMap(m, 4).clipStart, 6);
    assert.equal(shiftMap(shiftMap(m, 4), -4).clipStart, 2);
    assert.equal(mapInsert(m, 1, 4).clipStart, 6);
    assert.equal(mapInsert(m, 3, 4).clipStart, 2);
    assert.equal(mapRemove({ ...m, clipStart: 10 }, 4, 4).clipStart, 6);
    assert.ok(!('clipStart' in mapRemove(m, 0, 4)));
  });
  test('the song keeps clipStart only with a clip', () => {
    const p = cleanProject({ ...createProject(), tempoMap: { anchors, clipStart: 2 } });
    assert.ok(p.tempoMap && !('clipStart' in p.tempoMap));
  });
});

describe('the release', () => {
  test('trimmed from the first sound to the end of the tail', () => {
    const sr = 1000,
      L = new Float32Array(3000),
      R = new Float32Array(3000);
    for (let i = 500; i < 2000; i++) L[i] = 0.5 * Math.sin(i / 10);
    R[2200] = 0.01;
    const cut = releaseTrim({ sampleRate: sr, channels: [L, R] }, { pad: 0.05 });
    assert.equal(cut.from, 500);
    assert.equal(cut.to, 2251);
    assert.equal(cut.channels[0].length, 1751);
  });
  test('the toast line', () => {
    assert.equal(releaseLine({ seconds: 221.2, lufs: -9.24, peak: -0.41 }), 'Release: 3:41, −9.2 LUFS, peak −0.4 dBTP');
  });
});
