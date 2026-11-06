// The kitchen table, what reads no audio (docs/research/LIVE-ROOM-MODE.md §11.7), moved from
// tools/liveroom/checks-kitchen.js, which keeps the reads of synthesized takes (seconds of Node), the levels and the
// flow: ChordPro and chords-over-words fixtures read into sections, lines and anchored chords; format(parse(x)) is
// stable; capo 3 on G shapes sounds in Bb; Nashville numbers read; an edited line keeps each chord on its syllable; a
// fresh song starts at the kitchen's 84; the offered move in order; the two inputs' setup.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import {
  parseSheet,
  formatSheet,
  soundingKey,
  sheetChords,
  setWords,
  pasteOps,
} from '../../app/src/core/liveroom/sheet-text.js';
import { kitchenOps, chordsTimeline, offeredKitchen, PLAYER_ORDER } from '../../app/src/core/liveroom/kitchen-plans.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';

const UG = `Paper Moon chords
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
const CHO = `{title: Paper Moon}
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

const ok = (r) => {
  if (!r.ok) throw new Error(r.error || 'dispatch refused');
  return r;
};

test('the paper', async () => {
  const T = checks();
  // 1. the paper
  {
    const ug = parseSheet(UG),
      cho = parseSheet(CHO);
    T.ok(
      ug.sections.map((s) => s.name).join(',') === 'Verse 1,Chorus,Verse 2,Bridge' &&
        ug.capo === 3 &&
        ug.title === 'Paper Moon',
      `the paper: chords over words read into ${ug.sections.length} sections, capo ${ug.capo}, each written once`,
    );
    T.ok(
      ug.sections[0].lines[0].text === '[G]Somewhere [Em]a paper moon is hanging' &&
        ug.sections[0].lines[1].text === '[C]over the roofs of the [D]town',
      'the paper: each chord anchored by column to the syllable under it',
    );
    T.ok(
      cho.sections.map((s) => s.name).join(',') === 'Verse 1,Chorus,Bridge' &&
        cho.capo === 2 &&
        cho.time?.join('/') === '3/4' &&
        cho.key?.root === 'G',
      'the paper: ChordPro read (directives, environments, {chorus} recalled once, {c: Bridge})',
    );
    let stable = true;
    for (const src of [UG, CHO])
      for (const as of ['text', 'chordpro']) {
        const a = parseSheet(src),
          t1 = formatSheet(a, { as, title: a.title, key: a.key }),
          b = parseSheet(t1);
        stable =
          stable &&
          JSON.stringify(b.sections) === JSON.stringify(a.sections) &&
          b.capo === a.capo &&
          formatSheet(b, { as, title: b.title, key: b.key }) === t1;
      }
    T.ok(stable, 'the paper: format(parse(x)) is stable, as text and as ChordPro, both fixtures');
    const sk = soundingKey(ug, {});
    T.ok(
      sk?.root === 'Bb' && sk.scale === 'major',
      `the paper: capo 3 on G shapes sounds in ${sk?.root} ${sk?.scale} (Bb, not E)`,
    );
    const nash = sheetChords(parseSheet('{key: G}\n[Verse]\n1 4 6- 5/7\n'), {})[0].chords.map((c) => c.chord?.name);
    T.ok(
      nash.join(' ') === 'G C Em D/F#',
      `the paper: Nashville numbers read in the key (1 4 6- 5/7 -> ${nash.join(' ')})`,
    );
    const br = sheetChords(cho, {}).find((s) => s.name === 'Bridge');
    T.ok(
      br.chords[1].sym === 'Hm7' && br.chords[1].chord === null && cho.sections[2].lines[0].text.includes('[Hm7]'),
      'the paper: a chord nobody reads (Hm7) is kept as written and plays nothing',
    );
    const ed = setWords('Somewhere a [G]paper [Em]moon is hanging', 'Somewhere out there a silver moon is hanging');
    T.ok(
      ed === 'Somewhere out there a [G]silver [Em]moon is hanging',
      `the paper: an edit keeps each chord on its syllable ("${ed}")`,
    );
  }

  T.done();
});

test("Nashville numbers on the Chords track play in the paper's key", async () => {
  const T = checks();
  {
    // a paper in Nashville numbers: the Chords track plays them in the key of the shapes (G), not in C
    const st = createStore(createProject({ tempo: 84 }), { getDevice });
    ok(st.dispatch(pasteOps(st.get(), parseSheet('{key: G}\n[Verse]\n| 1 | 4 | 6- | 5 |\n')).ops, { by: 'you' }));
    ok(
      st.dispatch(
        [
          {
            type: 'track.add',
            ref: 'c',
            track: { name: 'Chords', kind: 'instrument', instrument: { device: 'core.keys' }, mute: true },
          },
          ...['1', '4', '6-', '5'].map((n, i) => ({
            type: 'clip.add',
            track: '$c',
            clip: { kind: 'notes', start: i * 4, length: 4, name: n, notes: [] },
          })),
        ],
        { by: 'overdub' },
      ),
    );
    const names = chordsTimeline(st.get())
      .map((x) => x.chord.name)
      .join(' ');
    T.ok(
      names === 'G C Em D',
      `the chords: Nashville numbers on the Chords track play in the paper's key (1 4 6- 5 in G: ${names})`,
    );
  }

  T.done();
});

test("a fresh song at the kitchen table starts at the kitchen's tempo", async () => {
  const T = checks();
  {
    // a fresh song at the kitchen starts at the kitchen's 84, the tempo Count me in offers
    const fresh = createStore(createProject({ tempo: 120 }), { getDevice });
    ok(fresh.dispatch(kitchenOps(fresh.get(), { mic: 'one' }).ops, { by: 'overdub' }));
    T.ok(fresh.get().tempo === 84, `Count me in: a fresh song at the kitchen table starts at ${fresh.get().tempo} BPM`);
  }

  T.done();
});

test('the offered move, and two inputs', async () => {
  const T = checks();
  // the offered move, in order (§7.4)
  {
    const v = { cards: [{ name: 'Verse' }, { name: 'Chorus' }, { name: 'Bridge' }] };
    const seq = [
      offeredKitchen(v, {}),
      offeredKitchen(v, { rolling: true }),
      offeredKitchen(v, { takes: 1, ask: 'time' }),
      offeredKitchen(v, { takes: 1 }),
      offeredKitchen(v, { takes: 1, offer: 'shaker' }),
      offeredKitchen(v, { takes: 1, done: PLAYER_ORDER }),
      offeredKitchen(v, { takes: 1, done: PLAYER_ORDER, again: true }),
    ].map((o) => o?.id);
    T.ok(seq.join(' ') === 'tape stop time offer.shaker keep again hear', `the offered move: ${seq.join(' → ')}`);
    T.ok(
      offeredKitchen({ cards: [{ name: 'Verse' }] }, { takes: 1, done: ['shaker', 'cajon', 'bass'] })?.id === 'again',
      'the offered move: strings only with a bridge',
    );
    const form = offeredKitchen(v, { takes: 1, ask: 'form', offer: null })?.id,
      bare = offeredKitchen({ cards: [] }, { takes: 1 })?.id,
      noChorus = offeredKitchen({ cards: [{ name: 'Verse 1' }] }, { takes: 1 })?.id;
    T.ok(
      form === 'form' && bare === 'again' && noChorus === 'offer.cajon',
      `the offered move: the form asked before the players (${form}); no parts, no players (${bare}); no chorus, no shaker (${noChorus})`,
    );
    const both = offeredKitchen(v, { takes: 1, done: PLAYER_ORDER, again: true, ask: 'both' })?.id;
    T.ok(
      both === 'again.both',
      `the offered move: with two inputs, Again's question offers both again first (${both})`,
    );
  }
  {
    // two inputs (§6.2 c): Voice on input 1 and Guitar on input 2, each with its chain; one mic is the default setup
    const st = createStore(createProject({ tempo: 84 }), { getDevice });
    ok(st.dispatch(kitchenOps(st.get(), { mic: 'one' }).ops, { by: 'overdub' }));
    const one = structuredClone(st.get().room);
    ok(st.dispatch(kitchenOps(st.get(), { mic: 'two' }).ops, { by: 'overdub' }));
    const p = st.get(),
      R = p.room,
      tr = (id) => p.tracks.find((t) => t.id === id);
    T.ok(
      one.mic === 'one' &&
        one.tracks.take &&
        R.mic === 'two' &&
        tr(R.tracks.voice)?.input?.channel === 1 &&
        tr(R.tracks.kguitar)?.input?.channel === 2 &&
        tr(R.tracks.voice).name === 'Voice' &&
        tr(R.tracks.kguitar).name === 'Guitar',
      `two inputs: one mic is the default (${one.mic}); picked, Voice on input ${tr(R.tracks.voice)?.input?.channel} and Guitar on input ${tr(R.tracks.kguitar)?.input?.channel}`,
    );
  }

  T.done();
});
