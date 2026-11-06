// input/importers.js (Standard MIDI Files built by hand, byte by byte), the exporter's own MIDI parsing back, an import
// plan as one undo step, and ui/reference.js's comparison words. Moved intact from tools/imports-test.js (the Node
// halves); the page flows (drops, the Reference tab, compare_to_reference) stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import { demoProject } from '../../app/src/core/demo.js';
import {
  parseSmf,
  planMidiImport,
  midiSummary,
  deviceFor,
  keyFromSignature,
  MAX_IMPORT_NOTES,
} from '../../app/src/input/importers.js';
import { compareProfiles, matchGainDb, abMatch } from '../../app/src/ui/reference.js';
import { encodeMidi } from '../../app/src/ui/export.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const vlq = (n) => {
  const b = [n & 0x7f];
  while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80);
  return b;
};
const txt = (s) => [...Buffer.from(s, 'utf8')];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, bytes) => [...txt(type), ...u32(bytes.length), ...bytes];
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
const tempoBytes = (bpm) => {
  const us = Math.round(60e6 / bpm);
  return [(us >> 16) & 255, (us >> 8) & 255, us & 255];
};
const smfFile = (format, ppq, tracks) =>
  new Uint8Array([
    ...chunk('MThd', [0, format, 0, tracks.length, (ppq >> 8) & 255, ppq & 255]),
    ...tracks.flatMap((t) => chunk('MTrk', t)),
  ]);
// a track from [delta, ...bytes] events (bytes written as given, so running status is literal)
const trk = (events) => [...events.flatMap(([dt, ...bytes]) => [...vlq(dt), ...bytes]), 0, ...meta(0x2f, [])];

// type 0, ppq 96: 90 bpm, 3/4, C minor (3 flats, minor); a bass on channel 1 (program 33) using running status and a
// note-on at velocity 0 to end a note; drums on channel 10 with running status and velocity-0 note-offs
const type0 = smfFile(0, 96, [
  trk(
    [
      [0, ...meta(0x03, txt('Groove'))],
      [0, ...meta(0x51, tempoBytes(90))],
      [0, ...meta(0x58, [3, 2, 24, 8])],
      [0, ...meta(0x59, [0xfd, 1])],
      [0, 0xc0, 33],
      [0, 0x90, 36, 100], // C2 on
      [48, 36, 0], // running status: velocity 0 = off (half a beat)
      [0, 43, 80], // running status: G2 on
      [96, 0x80, 43, 64], // explicit off (one beat)
      [0, 0x99, 36, 127], // kick on ch 10 at beat 1.5
      [24, 36, 0], // running status off
      [24, 38, 90], // snare at beat 2
      [24, 0x89, 38, 0], // explicit off
      [0, 0x90, 48, 64], // C3 on ch 1 at beat 2.25, never released: ends with the track
      [96], // (a delta with nothing after it: the end-of-track meta follows)
    ]
      .slice(0, -1)
      .concat([[96, ...meta(0x01, txt('end'))]]),
  ),
]);

let s0;
try {
  s0 = parseSmf(type0);
} catch (e) {
  s0 = { error: e.message };
}

// type 1, ppq 480: a tempo map (100 then 140 bpm), 4/4, markers; Keys (program 0), Beat (channel 10, no program),
// Lead (no program, high notes), Sub Bass (no program: named)
const Q = 480;
const type1 = smfFile(1, Q, [
  trk([
    [0, ...meta(0x03, txt('Song Title'))],
    [0, ...meta(0x51, tempoBytes(100))],
    [0, ...meta(0x58, [4, 2, 24, 8])],
    [0, ...meta(0x06, txt('Verse'))],
    [4 * Q, ...meta(0x51, tempoBytes(140))],
    [4 * Q, ...meta(0x06, txt('Chorus'))],
  ]),
  trk([
    [0, ...meta(0x03, txt('Keys'))],
    [0, 0xc0, 0],
    [0, 0x90, 60, 90],
    [0, 64, 90],
    [0, 67, 90],
    [2 * Q, 0x80, 60, 0],
    [0, 64, 0],
    [0, 67, 0],
    [6 * Q, 0x90, 62, 70],
    [Q, 62, 0],
  ]),
  trk([
    [0, ...meta(0x03, txt('Beat'))],
    [0, 0x99, 36, 120],
    [Q / 4, 0x89, 36, 0],
    [(Q * 3) / 4, 0x99, 38, 100],
    [Q / 4, 38, 0],
  ]),
  trk([
    [0, ...meta(0x03, txt('Lead'))],
    [8 * Q, 0x92, 76, 100],
    [Q / 2, 0x82, 76, 0],
    [0, 0x92, 79, 100],
    [Q / 2, 79, 0],
  ]),
  trk([
    [0, ...meta(0x03, txt('Sub Bass'))],
    [0, 0x93, 33, 110],
    [4 * Q, 0x83, 33, 0],
  ]),
]);
let s1;
try {
  s1 = parseSmf(type1);
} catch (e) {
  s1 = { error: e.message };
}

test('type 0 parses: tempo, meter, key, channels, running status, drums', () => {
  assert.ok(
    !s0.error && s0.format === 0 && s0.ppq === 96,
    `type 0 parses (format ${s0.format}, ppq ${s0.ppq})${s0.error ? ': ' + s0.error : ''}`,
  );
  assert.ok(
    near(s0.tempo, 90, 0.01) && s0.meter?.join('/') === '3/4' && s0.key?.root === 'C' && s0.key?.scale === 'minor',
    `tempo ${s0.tempo}, meter ${s0.meter}, key ${s0.key?.root} ${s0.key?.scale}`,
  );
  const bass0 = s0.parts?.find((p) => p.channel === 1),
    drums0 = s0.parts?.find((p) => p.channel === 10);
  assert.ok(
    s0.parts?.length === 2 && bass0 && drums0 && drums0.drums && !bass0.drums,
    `type 0 splits by channel: ${s0.parts?.map((p) => 'ch' + p.channel).join(', ')}`,
  );
  assert.ok(
    bass0 &&
      bass0.notes.length === 3 &&
      near(bass0.notes[0].d, 0.5) &&
      bass0.notes[0].p === 36 &&
      near(bass0.notes[0].v, 100 / 127, 0.002),
    `running status + velocity-0 note-off: C2 lasts half a beat (${bass0?.notes[0]?.d})`,
  );
  assert.ok(
    bass0 && bass0.notes[1].p === 43 && near(bass0.notes[1].t, 0.5) && near(bass0.notes[1].d, 1),
    `the next note via running status: G2 at 0.5 for 1 beat (${bass0?.notes[1]?.t}, ${bass0?.notes[1]?.d})`,
  );
  assert.ok(
    bass0 &&
      bass0.notes[2].p === 48 &&
      near(bass0.notes[2].t, 2.25) &&
      bass0.notes[2].d > 0 &&
      s0.warnings.some((w) => /no note-off/.test(w)),
    `a held note ends with the track, and that is warned (${s0.warnings.join('; ')})`,
  );
  assert.ok(
    drums0 && drums0.notes.map((n) => `${n.p}@${n.t}:${n.d}`).join(' ') === '36@1.5:0.25 38@2:0.25',
    `drums on channel 10: ${drums0?.notes.map((n) => `${n.p}@${n.t}:${n.d}`).join(' ')}`,
  );
  assert.ok(
    deviceFor(bass0).device === 'core.bass' && deviceFor(drums0).device === 'core.drums',
    `program 33 → ${deviceFor(bass0).device}; channel 10 → ${deviceFor(drums0).device}`,
  );
  assert.ok(
    keyFromSignature(0, 0)?.root === 'C' &&
      keyFromSignature(1, 0)?.root === 'G' &&
      keyFromSignature(0xff, 0)?.root === 'F' &&
      keyFromSignature(2, 1)?.root === 'B' &&
      keyFromSignature(0xfe, 0)?.root === 'Bb' &&
      keyFromSignature(3, 1)?.root === 'F#',
    'key signatures: C, G, F, B minor, Bb, F# minor',
  );
});

test('type 1 parses: tempo map, markers, instruments, refusing non-MIDI', () => {
  assert.ok(
    !s1.error && s1.format === 1 && s1.tracks === 5 && s1.parts?.length === 4,
    `type 1 parses: ${s1.tracks} tracks, ${s1.parts?.length} parts${s1.error ? ': ' + s1.error : ''}`,
  );
  assert.ok(
    near(s1.tempo, 100, 0.01) &&
      s1.tempoChanges === 1 &&
      s1.tempos?.[1] &&
      near(s1.tempos[1].beat, 4) &&
      near(s1.tempos[1].bpm, 140, 0.01),
    `the first tempo is kept (${s1.tempo}); the change to 140 at beat 4 is counted`,
  );
  assert.ok(
    s1.markers?.map((m) => `${m.name}@${m.beat}`).join(' ') === 'Verse@0 Chorus@8',
    `markers: ${s1.markers?.map((m) => `${m.name}@${m.beat}`).join(' ')}`,
  );
  const byName = Object.fromEntries((s1.parts || []).map((p) => [p.name, p]));
  assert.ok(
    byName.Keys &&
      byName.Keys.notes.length === 4 &&
      byName.Keys.notes.slice(0, 3).every((n) => n.t === 0 && n.d === 2) &&
      near(byName.Keys.notes[3].t, 8) &&
      byName.Keys.notes[3].d === 1,
    'Keys: a two-beat chord (running status for the chord and its offs), then D4 at beat 8 (after a tempo change, still on its beat)',
  );
  assert.ok(
    deviceFor(byName.Keys).device === 'core.keys' &&
      deviceFor(byName.Beat).device === 'core.drums' &&
      deviceFor(byName.Lead).device === 'core.poly' &&
      deviceFor(byName['Sub Bass']).device === 'core.bass',
    `instruments: Keys ${deviceFor(byName.Keys).device}, Beat ${deviceFor(byName.Beat).device}, Lead ${deviceFor(byName.Lead).device}, Sub Bass ${deviceFor(byName['Sub Bass']).device}`,
  );
  let bad = '';
  try {
    parseSmf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
  } catch (e) {
    bad = e.message;
  }
  assert.ok(/not a Standard MIDI File/.test(bad), 'a file that isn’t MIDI is refused with a reason: ' + bad);
});

test('corrupt and hostile files', async () => {
  // corrupt and hostile files: a time signature of 4/2^40 (a bar 1e-11 beats long froze the ruler) is ignored with a
  // warning, and no plan or op takes it; a .rmi whose chunk length reads as -8 is refused, not looped on forever;
  // a file with more notes than a call can take arguments still parses and plans (no Math.max(...spread))
  const noteOn = (dt, p) => [
    [dt, 0x90, p, 100],
    [1, 0x80, p, 0],
  ];
  for (const exp of [6, 31, 40]) {
    const f = smfFile(0, 96, [trk([[0, ...meta(0x58, [4, exp, 24, 8])], ...noteOn(0, 60)])]);
    const sm = parseSmf(f);
    const pl = planMidiImport(sm, createProject(), { name: 'bad.mid' });
    assert.ok(
      sm.meter === null &&
        sm.warnings.some((w) => /time signature of 4\/2\^\d+ is out of range; ignored/.test(w)) &&
        !pl.ops.some((x) => x.type === 'project.set' && x.patch.meter),
      `a time signature of 4/2^${exp} is ignored: ${sm.warnings.join('; ')}`,
    );
  }
  {
    const f = smfFile(0, 96, [trk([[0, ...meta(0x58, [7, 3, 24, 8])], ...noteOn(0, 60)])]);
    const pl = planMidiImport(parseSmf(f), createProject(), { name: 'odd.mid' });
    assert.ok(pl.ops[0]?.patch?.meter?.join('/') === '7/8', 'a real 7/8 still comes in');
    assert.ok(
      !planMidiImport({ ...parseSmf(f), meter: [4, 2 ** 31] }, createProject()).ops.some((x) => x.patch?.meter),
      'planMidiImport refuses a meter of 4/2^31 handed to it directly',
    );
  }
  {
    // SMPTE timing (division 0xE2xx: 30 fps) counts ticks per frame; 0 of them gives every note a time of 0/0. Refused
    // with a reason, not stacked on beat 1. A real one (96 ticks per frame) still reads.
    const two = trk([...noteOn(0, 60), [95, 0x90, 64, 100], [96, 0x80, 64, 0]]);
    let err = '',
      sm = null;
    try {
      sm = parseSmf(smfFile(0, 0xe200, [two]));
    } catch (e) {
      err = e.message;
    }
    assert.ok(
      !sm && /ticks per frame/.test(err),
      `a SMPTE file with 0 ticks per frame is refused: ${err || 'parsed to ' + JSON.stringify(sm?.parts?.[0]?.notes)}`,
    );
    const good = parseSmf(smfFile(0, 0xe260, [two])).parts[0].notes;
    assert.ok(
      good.length === 2 &&
        good.every((n) => Number.isFinite(n.t) && Number.isFinite(n.d) && n.d > 0) &&
        good[1].t > good[0].t,
      `30 fps × 96 ticks per frame still reads (${good.map((n) => `${n.p}@${n.t}`).join(', ')})`,
    );
  }
  {
    const rmi = new Uint8Array([
      ...txt('RIFF'),
      0,
      0,
      0,
      0,
      ...txt('RMID'),
      ...txt('LIST'),
      0xf8,
      0xff,
      0xff,
      0xff,
      0,
      0,
      0,
      0,
    ]);
    const src = `import { parseSmf } from ${JSON.stringify(new URL('../../app/src/input/importers.js', import.meta.url).href)};
    import { parentPort, workerData } from 'node:worker_threads';
    try { parseSmf(workerData); parentPort.postMessage('parsed'); } catch (e) { parentPort.postMessage('threw: ' + e.message); }`;
    const w = new Worker(new URL('data:text/javascript,' + encodeURIComponent(src)), { workerData: rmi });
    const said = await new Promise((res) => {
      const tm = setTimeout(() => res('still parsing after 3 s'), 3000);
      w.on('message', (m) => {
        clearTimeout(tm);
        res(m);
      });
      w.on('error', (e) => {
        clearTimeout(tm);
        res('error: ' + e.message);
      });
    });
    await w.terminate();
    assert.ok(
      /^threw: not a Standard MIDI File/.test(said),
      `a .rmi with a chunk length of 0xFFFFFFF8 is refused, not looped on: ${said}`,
    );
  }
  {
    const N = 150000,
      ev = [];
    for (let i = 0; i < N; i++) ev.push([i ? 1 : 0, 0x90, 36 + (i % 48), 90], [1, 0x80, 36 + (i % 48), 0]);
    let sm = null,
      err = '';
    try {
      sm = parseSmf(smfFile(0, 96, [trk(ev)]));
    } catch (e) {
      err = e.message;
    }
    let pl = null;
    try {
      if (sm) pl = planMidiImport(sm, createProject(), { name: 'long.mid' });
    } catch (e) {
      err = e.message;
    }
    assert.ok(
      sm && pl && sm.parts[0].notes.length === N && pl.summary.notes === N && sm.end > 0,
      `a ${N.toLocaleString('en-US')}-note file parses and plans${err ? ': ' + err : ''}`,
    );
    assert.ok(
      MAX_IMPORT_NOTES === 50000,
      'one import takes up to the song limit, 50,000 notes (core/project.js LIMITS)',
    );
  }
});

test('the exporter parses back; an import plan is one undo step', () => {
  // the exporter's own MIDI (Song menu → MIDI) parses back: tempo, and every note it wrote
  const demo = demoProject();
  const sx = parseSmf(encodeMidi(demo));
  const written = demo.tracks
    .filter((t) => t.kind === 'instrument')
    .reduce(
      (a, t) =>
        a +
        t.clips
          .filter((c) => c.kind === 'notes')
          .reduce((b, c) => b + c.notes.filter((n) => n.t < c.length && n.d > 0).length, 0),
      0,
    );
  const read = sx.parts.reduce((a, p) => a + p.notes.length, 0);
  assert.ok(
    near(sx.tempo, demo.tempo, 0.01) && read === written && sx.parts.some((p) => p.drums),
    `the exporter's MIDI parses back: ${read}/${written} notes, ${sx.tempo} bpm, drums on channel 10`,
  );

  // a plan is one undo step; into an empty song it takes the file's tempo, meter, key and name
  const st = createStore(createProject());
  const plan = planMidiImport(s1, st.get(), { name: 'Night Drive.mid' });
  const r = st.dispatch(plan.ops, { by: 'you', label: 'import Night Drive.mid' });
  const p1 = st.get();
  assert.ok(
    r.ok &&
      p1.tracks.length === 4 &&
      st.history.length === 1 &&
      p1.tracks.every((t) => t.by === 'you' && t.clips.length === 1 && t.clips[0].by === 'you'),
    `one undo step by you: ${p1.tracks.length} tracks, one clip each${r.ok ? '' : ': ' + r.error}`,
  );
  assert.ok(
    p1.tempo === 100 &&
      p1.meter.join('/') === '4/4' &&
      p1.title === 'Night Drive' &&
      p1.sections.map((x) => x.name).join(',') === 'Verse,Chorus',
    `took the file's tempo (${p1.tempo}), meter, title (${p1.title}) and sections (${p1.sections.map((x) => x.name)})`,
  );
  const lead = p1.tracks.find((t) => t.name === 'Lead');
  assert.ok(
    lead && lead.clips[0].start === 8 && lead.clips[0].notes[0].t === 0 && lead.clips[0].length === 4,
    `a part that comes in late starts its clip at its bar (Lead at beat ${lead?.clips[0]?.start})`,
  );
  const drumsT = p1.tracks.find((t) => t.name === 'Beat');
  assert.ok(drumsT && drumsT.instrument.device === 'core.drums', 'channel 10 became Gobo Kit (core.drums)');
  const text1 = midiSummary(plan, 'Night Drive.mid');
  assert.ok(
    /^Imported Night Drive\.mid: 4 tracks, 9 notes \(Keys, Beat, Lead, Sub Bass\)\. 100 bpm\./.test(text1) &&
      /changes tempo 1 time/.test(text1),
    'the toast says what came in: ' + text1,
  );
  st.undo();
  assert.ok(
    st.get().tracks.length === 0 &&
      st.get().tempo === 120 &&
      st.get().title === 'Untitled' &&
      !st.get().sections.length,
    'undo takes the whole import back',
  );
  // into a song with parts: its tempo stays, and the toast says so
  const sd = createStore(demoProject());
  const plan2 = planMidiImport(s0, sd.get(), { name: 'groove.mid', at: 16 });
  const r2 = sd.dispatch(plan2.ops, { by: 'you' });
  assert.ok(
    r2.ok &&
      sd.get().tempo === demo.tempo &&
      sd.get().tracks.length === demo.tracks.length + 2 &&
      /Kept your/.test(midiSummary(plan2, 'groove.mid')),
    `into a song with parts: kept ${sd.get().tempo} bpm (${midiSummary(plan2, 'groove.mid')})`,
  );
  assert.ok(
    sd
      .get()
      .tracks.slice(-2)
      .every((t) => t.clips[0].start >= 16),
    'the parts land at the drop point (beat 16)',
  );
});

test('the comparison words point the right way', () => {
  const base = {
    lufs: -9,
    truePeak: -0.5,
    crest: 8,
    lra: 5,
    correlation: 0.7,
    onsetsPerSec: 3,
    centroid: 2400,
    bands: { sub: -14, low: -6, lowmid: -9, mid: -6, highmid: -12, presence: -15, air: -20 },
  };
  const darker = {
    ...base,
    lufs: -18,
    centroid: 1500,
    crest: 12,
    bands: { ...base.bands, presence: -20, air: -27, highmid: -14 },
  };
  const c1 = compareProfiles(base, darker, { name: 'Ref' });
  assert.ok(
    c1.deltas.lufs < 0 && c1.deltas.centroidPct < 0 && c1.deltas.bands.air < 0,
    'deltas are song minus reference',
  );
  assert.ok(
    /9 LU quieter/.test(c1.summary) && /darker/.test(c1.summary) && /more dynamic/.test(c1.summary),
    'summary: ' + c1.summary,
  );
  assert.ok(
    c1.differences.some((x) => /^air −?-?7(\.0)? dB vs the reference/.test(x.replace('−', '-'))) &&
      c1.notes.some((x) => /mastered/.test(x)),
    'differences reuse the render_and_measure glosses: ' + c1.differences.join(' | '),
  );
  assert.ok(
    matchGainDb(-18, -9) === -9 && matchGainDb(-12, -14) === 2 && matchGainDb(-120, -9) === 0,
    'A/B match gain: the reference turned to the song’s loudness',
  );
  // a quiet, dynamic reference against a loud mix: the match would put its peaks over 0 dBFS, straight to the speakers
  const lim = abMatch(-8, { lufs: -20, truePeak: -2 }),
    free = abMatch(-12, { lufs: -14, truePeak: -6 });
  assert.ok(
    lim.limited && lim.db === 1 && !free.limited && free.db === 2 && abMatch(-8, { lufs: -20 }).db === 12,
    `A/B match is held to −1 dBTP on the reference's peaks (wanted +12, plays ${lim.db > 0 ? '+' : ''}${lim.db} dB)`,
  );
});
