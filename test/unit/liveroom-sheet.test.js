// The paper (core/liveroom/sheet-text.js, behind the frozen sheet.js): ChordPro and chords over words in and out, chords kept on their syllables, the
// capo's direction, Nashville numbers (docs/research/LIVE-ROOM-MODE.md §6.1, §11.7 "The paper").
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheet,
  formatSheet,
  lineParts,
  soundingKey,
  transposeChord,
  setWords,
  insertChord,
  chordsOf,
  lineWords,
  readChord,
  sheetChords,
  chordRow,
  capoChoices,
  pasteOps,
  newVerse,
  describeSheet,
  isBars,
  barsOf,
} from '../../app/src/core/liveroom/sheet-text.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import { tapeChroma, alignChords, formOf } from '../../app/src/core/liveroom/tape.js';
import { strum, voice, mix, SR } from '../../tools/liveroom/fake.js';

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

Bridge:
Am  C  D
`;

const CHO = `{title: Paper Moon}
{artist: Nobody Yet}
{key: G}
{capo: 2}
{time: 3/4}
{tempo: 84}
# written at the table

{start_of_verse: Verse 1}
Somewhere a [G]paper [Em]moon is hanging
over the [C]roofs of the [D]town
{end_of_verse}

{start_of_chorus}
[C]Hold on, hold [G]on
{end_of_chorus}

{chorus}

{start_of_tab}
e|---0---|
{end_of_tab}

{c: Bridge}
[Am]Down the [Hm7]stairs
`;

describe('parse', () => {
  test('chords over words, by column', () => {
    const s = parseSheet(UG);
    assert.equal(s.title, 'Paper Moon');
    assert.equal(s.capo, 3);
    assert.deepEqual(
      s.sections.map((x) => x.name),
      ['Verse 1', 'Chorus', 'Verse 2', 'Bridge'],
    );
    assert.equal(s.sections[0].lines[0].text, '[G]Somewhere [Em]a paper moon is hanging');
    assert.equal(s.sections[0].lines[1].text, '[C]over the roofs of the [D]town');
    // a chord line with no words under it is bars
    assert.equal(s.sections[3].lines[0].text, '| Am | C | D |');
  });
  test('each section once: a repeat on the paper is not written again', () => {
    const s = parseSheet(UG);
    assert.equal(s.sections.filter((x) => x.name === 'Chorus').length, 1);
  });
  test('ChordPro: directives, environments, comments, tabs left out', () => {
    const s = parseSheet(CHO);
    assert.equal(s.title, 'Paper Moon');
    assert.equal(s.artist, 'Nobody Yet');
    assert.deepEqual(s.key, { root: 'G', scale: 'major' });
    assert.equal(s.capo, 2);
    assert.deepEqual(s.time, [3, 4]);
    assert.equal(s.tempo, 84);
    assert.equal(s.notes, 'written at the table');
    assert.deepEqual(
      s.sections.map((x) => x.name),
      ['Verse 1', 'Chorus', 'Bridge'],
    );
    assert.equal(s.sections[0].lines[1].text, 'over the [C]roofs of the [D]town');
    assert.ok(!JSON.stringify(s).includes('e|---'));
  });
  test('two different sections of one name are numbered', () => {
    const s = parseSheet('[Verse]\n[G]one\n[Verse]\n[C]two\n');
    assert.deepEqual(
      s.sections.map((x) => x.name),
      ['Verse 1', 'Verse 2'],
    );
  });
  test('a long line is split at a space, a chord kept whole', () => {
    const long = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? '[G]word' : 'word')).join(' ');
    const s = parseSheet(`[Verse]\n${long}`);
    assert.ok(s.sections[0].lines.length >= 2);
    for (const l of s.sections[0].lines) {
      assert.ok(l.text.length <= 200);
      assert.equal((l.text.match(/\[/g) || []).length, (l.text.match(/\]/g) || []).length);
    }
  });
  test('Capo lines in words and none', () => {
    assert.equal(parseSheet('Capo: 5th fret\n[Verse]\n[G]x').capo, 5);
    assert.equal(parseSheet('Capo: none\n[Verse]\n[G]x').capo, 0);
  });
});

describe('format', () => {
  for (const [name, src] of [
    ['chords over words', UG],
    ['ChordPro', CHO],
  ]) {
    for (const as of ['text', 'chordpro']) {
      test(`${name} -> ${as} -> parse is stable`, () => {
        const a = parseSheet(src);
        const text = formatSheet(a, { as, title: a.title, artist: a.artist, key: a.key, tempo: a.tempo });
        const b = parseSheet(text);
        assert.deepEqual(b.sections, a.sections);
        assert.equal(b.capo, a.capo);
        assert.deepEqual(b.time, a.time);
        assert.equal(b.title, a.title);
        // and again: a fixed point
        assert.equal(formatSheet(b, { as, title: b.title, artist: b.artist, key: b.key, tempo: b.tempo }), text);
      });
    }
  }
  test('chords over words put each chord over its syllable', () => {
    const text = formatSheet({ sections: [{ name: 'Verse', lines: [{ text: 'Somewhere a [G]paper [Em]moon' }] }] });
    const [top, words] = text.split('\n').slice(1, 3);
    assert.equal(top.indexOf('G'), words.indexOf('paper'));
    assert.equal(top.indexOf('Em'), words.indexOf('moon'));
  });
});

describe('a line', () => {
  test('lineParts', () => {
    assert.deepEqual(lineParts('Somewhere a [G]paper [Em]moon'), [
      { text: 'Somewhere a ', chord: null },
      { text: 'paper ', chord: 'G' },
      { text: 'moon', chord: 'Em' },
    ]);
    assert.deepEqual(lineParts('[G]Hold'), [{ text: 'Hold', chord: 'G' }]);
    assert.deepEqual(
      lineParts('| G | Em | C D |').map((x) => [x.chord, x.bar]),
      [
        ['G', 0],
        ['Em', 1],
        ['C', 2],
        ['D', 2],
      ],
    );
    assert.ok(isBars('| G |'));
    assert.deepEqual(barsOf('| G | Em |'), [['G'], ['Em']]);
  });
  test('an edit keeps each chord on its syllable', () => {
    const line = 'Somewhere a [G]paper [Em]moon is hanging';
    // a word put in before the chords
    assert.equal(
      setWords(line, 'Somewhere out there a paper moon is hanging'),
      'Somewhere out there a [G]paper [Em]moon is hanging',
    );
    // a word changed between them
    assert.equal(setWords(line, 'Somewhere a silver moon is hanging'), 'Somewhere a [G]silver [Em]moon is hanging');
    // words after them
    assert.equal(
      setWords(line, 'Somewhere a paper moon was hanging low'),
      'Somewhere a [G]paper [Em]moon was hanging low',
    );
    assert.equal(lineWords(line), 'Somewhere a paper moon is hanging');
    assert.deepEqual(chordsOf(line), [
      { sym: 'G', at: 12 },
      { sym: 'Em', at: 18 },
    ]);
    assert.equal(insertChord('Hold on', 5, 'C'), 'Hold [C]on');
  });
});

describe('chords and keys', () => {
  test('capo 3 on G shapes sounds in Bb, not E', () => {
    const s = parseSheet(UG);
    assert.deepEqual(soundingKey(s, {}), { root: 'Bb', scale: 'major' });
    assert.deepEqual(soundingKey({ ...s, capo: 0 }, {}), { root: 'G', scale: 'major' });
    const sounds = sheetChords(s, {})[0].chords.map((c) => c.chord.name);
    assert.deepEqual(sounds, ['Bb', 'Gm', 'Eb', 'F']);
  });
  test('transposeChord spells the way guitarists write and keeps what it cannot read', () => {
    assert.equal(transposeChord('G', 3), 'Bb');
    assert.equal(transposeChord('D/F#', 2), 'E/G#');
    assert.equal(transposeChord('Em7', 3, { root: 'Bb', scale: 'major' }), 'Gm7');
    assert.equal(transposeChord('Cadd9', 2), 'Dadd9');
    assert.equal(transposeChord('Hm7', 2), 'Hm7');
    assert.equal(transposeChord('4', 2), '4');
    // a minor chord on its own spells as guitarists do: Bbm and Ebm, but C#m, F#m and G#m
    assert.deepEqual(
      ['Gm', 'Cm', 'Am', 'Dm', 'Em'].map((c) => transposeChord(c, 3)),
      ['Bbm', 'Ebm', 'Cm', 'Fm', 'Gm'],
    );
    assert.deepEqual(
      ['Am', 'Em', 'Bm'].map((c) => transposeChord(c, 4)),
      ['C#m', 'G#m', 'Ebm'],
    );
    assert.equal(transposeChord('F#m', 0), 'F#m');
  });
  test('Nashville numbers read in the key', () => {
    const k = { root: 'G', scale: 'major' };
    assert.equal(readChord('1', k).name, 'G');
    assert.equal(readChord('6-', k).name, 'Em');
    assert.equal(readChord('4', k).name, 'C');
    assert.equal(readChord('1/5', k).name, 'G/D');
    const s = parseSheet('{key: G}\n[Verse]\n1 4 6- 5\n');
    assert.equal(s.sections[0].lines[0].text, '| 1 | 4 | 6- | 5 |');
    assert.deepEqual(
      sheetChords(s, {})[0].chords.map((c) => c.chord.name),
      ['G', 'C', 'Em', 'D'],
    );
  });
  test('a chord nobody can read is kept as text and plays nothing', () => {
    const s = parseSheet(CHO);
    const bridge = sheetChords(s, {}).find((x) => x.name === 'Bridge');
    assert.deepEqual(
      bridge.chords.map((c) => c.sym),
      ['Am', 'Hm7'],
    );
    assert.equal(bridge.chords[1].chord, null);
    assert.ok(s.sections[2].lines[0].text.includes('[Hm7]'));
  });
  test('the chord row and the capo choices', () => {
    assert.deepEqual(chordRow(parseSheet(UG), {}).slice(0, 6), ['G', 'Am', 'Bm', 'C', 'D', 'Em']);
    assert.deepEqual(
      capoChoices({ root: 'Bb', scale: 'major' }).map((c) => `${c.shapes} ${c.capo}`),
      ['A 1', 'G 3', 'E 6'],
    );
    assert.deepEqual(capoChoices({ root: 'G', scale: 'major' })[0], { capo: 0, shapes: 'G' });
  });
  test('a new verse has the last verse chords and no words', () => {
    const v = newVerse(parseSheet(UG));
    assert.equal(v.name, 'Verse 3');
    assert.deepEqual(
      v.lines.map((l) => chordsOf(l.text).map((c) => c.sym)),
      [
        ['G', 'Em'],
        ['C', 'D'],
      ],
    );
    assert.equal(lineWords(v.lines[0].text).trim(), '');
  });
  test('describeSheet', () => {
    assert.deepEqual(describeSheet(parseSheet(UG)), { sections: 4, lines: 7, chords: ['G', 'Em', 'C', 'D', 'Am'] });
  });
});

describe('into the song', () => {
  test('pasteOps dispatch: sections, lines, the capo, the sounding key', () => {
    const store = createStore(createProject({ tempo: 84 }));
    const parsed = parseSheet(UG);
    const { ops, cut } = pasteOps(store.get(), parsed);
    const r = store.dispatch(ops, { by: 'you', label: 'The paper' });
    assert.ok(r.ok, r.error);
    const p = store.get();
    assert.equal(p.sheet.capo, 3);
    assert.deepEqual(
      p.sheet.sections.map((x) => x.name),
      ['Verse 1', 'Chorus', 'Verse 2', 'Bridge'],
    );
    assert.ok(p.sheet.sections.every((s) => s.lines.every((l) => l.by === 'you')));
    assert.deepEqual(p.key, { root: 'Bb', scale: 'major' });
    assert.equal(p.title, 'Paper Moon');
    assert.deepEqual(cut, { sections: 0, lines: 0 });
    // the paper as the song has it formats the same as the parsed one
    assert.equal(formatSheet(p.sheet), formatSheet(parsed));
  });
});

describe('lined up with a take', () => {
  // A verse, then a chorus that ends on the chord the verse starts on (capo 3: Bb Gm Eb F, Eb Bb F Bb), then the verse
  // again, strummed a chord a bar
  // at 96, a voice over it singing a chord tone on the 1 and Bb3 (233 Hz) on the and of 3. Over the F that Bb once
  // read as the guitar's bass note: the Bb came in half a bar early and the verse took the chorus's last bar.
  test("a voice over the chorus's last bars doesn't start the verse a bar early", () => {
    const bars = ['Bb', 'Gm', 'Eb', 'F', 'Eb', 'Bb', 'F', 'Bb', 'Bb', 'Gm', 'Eb', 'F'];
    const SHAPE = {
      Bb: [46, 50, 53, 58, 62],
      Gm: [43, 50, 55, 58, 62],
      Eb: [51, 55, 58, 63, 67],
      F: [41, 48, 53, 57, 60, 65],
    };
    const TONE = { Bb: 62, Gm: 62, Eb: 63, F: 65 };
    const bpm = 96,
      spb = 60 / bpm,
      lead = 1;
    const g = strum(
      bars.map((c, i) => ({ beat: i * 4, notes: SHAPE[c], beats: 4 })),
      { bpm, seed: 31, tail: 0.5 },
    );
    const v = voice(
      bars.flatMap((c, i) => [
        [i * 4 + 0.5, TONE[c], 1.4],
        [i * 4 + 2.5, 58, 1.2],
      ]),
      { bpm, seed: 7, tail: 0.5 },
    );
    const buf = mix(
      [
        { buf: g.buf, at: lead },
        { buf: v.buf, at: lead, gain: 2 },
      ],
      { peak: -14 },
    );
    const beats = Array.from({ length: bars.length * 4 }, (_, k) => lead + k * spb);
    const paper = sheetChords(
      parseSheet(
        'Capo 3\n\n[Verse]\nG   Em\nSomewhere a paper moon\nC   D\nover the town\n\n[Chorus]\nC   G\nHold on\nD   G\nuntil the morning\n',
      ),
      {},
    );
    const changes = alignChords(tapeChroma(buf, SR), beats, paper, { bpb: 4, phase: 0 });
    const form = formOf(changes, beats).map((x) => `${x.name} ${x.from}-${x.to}`);
    assert.deepEqual(
      form,
      ['Verse 0-16', 'Chorus 16-32', 'Verse 32-48'],
      changes.map((c) => `${c.sounding}@${c.beat}`).join(' '),
    );
  });
});
