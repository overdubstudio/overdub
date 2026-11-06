// The Jam room's Node half: the chord timeline on known material, the neck, jam tracks and tips (core/jam.js and
// core/fretboard.js). Moved intact from sections 1-4 of tools/jam-test.js; the room in the page stays there.
// (fretboard.test.js covers tunings, places and tab in general; these are the room's own known-answer cases, so none
// was dropped as a duplicate.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as JAM from '../../app/src/core/jam.js';
import * as FB from '../../app/src/core/fretboard.js';
import { demoProject } from '../../app/src/core/demo.js';
import { createProject } from '../../app/src/core/project.js';
import { scalePcs } from '../../app/src/core/music.js';

test('the chord timeline on known material', () => {
  const ns = demoProject();
  const tl = JAM.chordTimeline(ns);
  const byBar = [1, 2, 3, 4, 5, 6, 7, 8].map((b) => JAM.chordAt(tl, (b - 1) * 4 + 0.01).chord?.name);
  assert.ok(
    byBar.join(' ') === 'Am7 Fmaj7 C G7 Am7 Fmaj7 C G7',
    `Night Shift's chords, bar by bar: ${byBar.join(' ')}`,
  );
  assert.ok(
    tl.key.root === 'A' && tl.key.scale === 'minor' && tl.keyFrom === 'song',
    `its key is the song's: ${tl.key.root} ${tl.key.scale}`,
  );
  assert.ok(
    tl.chords
      .slice(0, 4)
      .map((c) => c.roman)
      .join(' ') === 'i7 bVImaj7 bIII bVII7',
    `Roman numerals in A minor: ${tl.chords
      .slice(0, 4)
      .map((c) => c.roman)
      .join(' ')}`,
  );
  assert.ok(
    tl.chords[0].tones.map((t) => `${t.note}:${t.name}`).join(' ') === 'A:R C:b3 E:5 G:b7',
    `Am7's tones by interval: ${tl.chords[0].tones.map((t) => `${t.note}:${t.name}`).join(' ')}`,
  );
  // every jam style's own progression comes back from the notes the band plays (power chords come back as power chords)
  const bad = [];
  for (const id of JAM.JAM_STYLE_IDS) {
    const r = JAM.jamTrack({ style: id });
    const x = JAM.chordTimeline(r.project);
    for (const c of r.chart) {
      const got = JAM.chordAt(x, c.a + 0.01).chord;
      const want = JAM.parseChord(c.name, r.key);
      const ok =
        got && (JAM.JAM_STYLES[id].power ? got.root === want.root && got.quality === '5' : got.name === c.name);
      if (!ok) {
        bad.push(`${id} bar ${c.bar}: ${c.name} read as ${got ? got.name : 'nothing'}`);
        break;
      }
    }
  }
  assert.ok(
    !bad.length,
    `every jam style's progression is read back from its own notes (${JAM.JAM_STYLE_IDS.length} styles${bad.length ? ': ' + bad.join('; ') : ''})`,
  );
  // a slash chord: C over its third in the bass
  const p = createProject({
    title: 'Slash',
    tempo: 100,
    key: { root: 'C', scale: 'major' },
    tracks: [
      {
        name: 'Keys',
        kind: 'instrument',
        instrument: { device: 'core.keys' },
        clips: [
          {
            kind: 'notes',
            start: 0,
            length: 8,
            notes: [
              { p: 60, t: 0, d: 4 },
              { p: 64, t: 0, d: 4 },
              { p: 67, t: 0, d: 4 },
              { p: 55, t: 4, d: 4 },
              { p: 59, t: 4, d: 4 },
              { p: 62, t: 4, d: 4 },
            ],
          },
        ],
      },
      {
        name: 'Bass',
        kind: 'instrument',
        instrument: { device: 'core.bass' },
        clips: [
          {
            kind: 'notes',
            start: 0,
            length: 8,
            notes: [
              { p: 40, t: 0, d: 2 },
              { p: 40, t: 2, d: 2 },
              { p: 47, t: 4, d: 4 },
            ],
          },
        ],
      },
    ],
  });
  const sl = JAM.chordTimeline(p);
  assert.ok(
    sl.chords.map((c) => c.name).join(' ') === 'C/E G/B',
    `slash chords from the bass: ${sl.chords.map((c) => c.name).join(' ')}`,
  );
  // two chords in a bar, and a key that moves in a section
  const two = JAM.jamTrack({ style: 'indie', key: 'C', progression: 'C G | Am F', bars: 4 });
  const t2 = JAM.chordTimeline(two.project);
  assert.ok(
    ['C', 'G', 'Am', 'F'].every((n, i) => JAM.chordAt(t2, i * 2 + 0.01).chord?.name === n),
    `two chords to a bar ("C G | Am F"): ${[0, 2, 4, 6].map((b) => JAM.chordAt(t2, b + 0.01).chord?.name).join(' ')}`,
  );
  const mod = JAM.jamTrack({ style: 'indie', key: 'C', progression: 'C G Am F C G Am F D A Bm G D A Bm G' });
  mod.project.sections = [
    { id: 's_a', name: 'Verse', start: 0, length: 32 },
    { id: 's_b', name: 'Chorus', start: 32, length: 32 },
  ];
  const sk = JAM.sectionKeys(mod.project, JAM.chordTimeline(mod.project), mod.project.key);
  assert.ok(
    sk && /^Chorus moves to D major \(bars 9–16\): F# and C# come in/.test(sk.text),
    `a section in another key is named: "${sk?.text}"`,
  );
  const blues = JAM.jamTrack({ style: 'blues' });
  assert.ok(
    !JAM.sectionKeys(blues.project, JAM.chordTimeline(blues.project), blues.project.key),
    'a blues, every chord stepping out alike, is not a key change',
  );
});

test('the neck: tunings, places, fingering and tab', () => {
  // every tuning's open strings are its places at fret 0, and a few notes known by heart
  const open = FB.TUNING_IDS.every((id) =>
    FB.TUNINGS[id].strings.every((p, s) => FB.positionsOf(p, id).some((x) => x.s === s && x.f === 0)),
  );
  assert.ok(
    open && FB.TUNING_IDS.length === 10,
    `10 tunings, each open string found at fret 0 (${FB.TUNING_IDS.join(', ')})`,
  );
  const cases = [
    [
      'standard',
      'A4',
      [
        [5, 5],
        [4, 10],
        [3, 14],
        [2, 19],
      ],
    ],
    ['standard', 'E2', [[0, 0]]],
    ['drop-d', 'D2', [[0, 0]]],
    ['drop-d', 'E2', [[0, 2]]],
    [
      'half-down',
      'Eb4',
      [
        [5, 0],
        [4, 5],
        [3, 9],
        [2, 14],
        [1, 19],
      ],
    ],
    [
      'dadgad',
      'A3',
      [
        [4, 0],
        [3, 2],
        [2, 7],
        [1, 12],
        [0, 19],
      ],
    ],
    [
      'open-g',
      'G2',
      [
        [1, 0],
        [0, 5],
      ],
    ],
    [
      'open-g',
      'B3',
      [
        [4, 0],
        [3, 4],
        [2, 9],
        [1, 16],
        [0, 21],
      ],
    ],
  ];
  const wrong = [];
  for (const [tu, note, want] of cases) {
    const got = FB.positionsOf(note, tu)
      .map((x) => [x.s, x.f])
      .sort((a, b) => b[0] - a[0]);
    const w = want.slice().sort((a, b) => b[0] - a[0]);
    if (JSON.stringify(got) !== JSON.stringify(w)) wrong.push(`${note} in ${tu}: ${JSON.stringify(got)}`);
  }
  assert.ok(
    !wrong.length,
    `notes land where they are played, in each tuning (${cases.length} cases${wrong.length ? ': ' + wrong.join('; ') : ''})`,
  );
  assert.ok(
    !FB.positionsOf('D2', 'standard').length && FB.positionsOf('D2', 'drop-d').length === 1,
    'D2 is off the neck in standard and the open low string in drop D',
  );
  // the box run: one hand position, a fret a finger
  const run = 'A2 C3 D3 E3 G3 A3 C4 D4 E4 G4 A4 C5 A4 G4 E4'.split(' ').map((p, i) => ({ p, t: i * 0.5 }));
  const f = FB.fingering(run, 'standard', { near: 5, open: 0.6 });
  assert.ok(
    f.position === 5 &&
      f.shifts === 0 &&
      FB.handSpan(f.notes) <= 4 &&
      f.notes.every((n) => n.finger >= 1 && n.finger <= 4),
    `a pentatonic run stays in one hand: position ${f.position}, ${f.shifts} shifts, span ${FB.handSpan(f.notes)} frets`,
  );
  // a line that has to move keeps every stretch in a span and moves as little as it must
  const climb = 'E3 G3 A3 C4 D4 E4 G4 A4 C5 D5 E5 G5 A5'.split(' ').map((p, i) => ({ p, t: i * 0.5 }));
  const fc = FB.fingering(climb, 'standard', { near: 5 });
  let pos = null,
    spanOk = true;
  for (const n of fc.notes) {
    if (!n.f) continue;
    const lo = n.f - n.finger + 1;
    if (pos == null || n.f < pos || n.f > pos + 3) {
      pos = lo;
    }
    if (n.f - pos > 3 || n.f < pos) spanOk = false;
  }
  assert.ok(
    spanOk && fc.shifts <= 2,
    `a two-octave climb moves the hand ${fc.shifts} time(s), every note under a finger of where it is`,
  );
  const am = FB.fingering(
    ['A2', 'E3', 'A3', 'C4', 'E4'].map((p) => ({ p, t: 0 })),
    'standard',
    { near: 1, open: -0.05 },
  );
  assert.ok(
    am.notes.map((n) => `${FB.stringNumber(n.s)}:${n.f}`).join(' ') === '5:0 4:2 3:2 2:1 1:0',
    `an A minor chord is the open shape: ${am.notes.map((n) => `${FB.stringNumber(n.s)}:${n.f}`).join(' ')}`,
  );
  const seven = FB.fingering(
    'C3 C#3 D3 D#3 E3 F3 F#3'.split(' ').map((p) => ({ p, t: 0 })),
    'standard',
  );
  const low = FB.fingering([{ p: 'C2' }], 'standard');
  assert.ok(
    /a guitar has 6 strings/.test(seven.error || '') && /off the neck/.test(low.error || '') && low.hint,
    `what can't be played says why: "${seven.error}"; "${low.error}"`,
  );
  // tab out and back in
  const tab = FB.formatTab(f.notes, { step: 0.5 });
  const back = FB.parseTab(tab, { step: 0.5 });
  assert.ok(
    tab.split('\n').length === 6 && /^e \|/.test(tab) && /^E \|/.test(tab.split('\n')[5]),
    'tab has six lines, the high e on top',
  );
  assert.ok(
    !back.errors.length &&
      back.notes.map((n) => `${n.p}@${n.t}`).join(' ') === f.notes.map((n) => `${n.p}@${n.t}`).join(' '),
    `tab read back gives the same notes at the same times (${back.notes.length})`,
  );
  const typed = FB.parseTab('e|-----0-|\nB|---1---|\nG|-2-----|\nD|-------|\nA|-------|\nE|-------|', { step: 0.5 });
  assert.ok(
    typed.notes.map((n) => n.p).join(' ') === '57 60 64',
    `typed tab reads too: ${typed.notes.map((n) => n.p).join(' ')}`,
  );
});

test('jam tracks: real songs in the asked key, the same for a seed, refused with a hint', () => {
  const r = JAM.jamTrack({ style: 'blues', key: 'E', tempo: 70 });
  const p = r.project;
  const names = p.tracks.map((t) => t.name).join(', ');
  assert.ok(
    p.title === 'Blues shuffle in E' && p.key.root === 'E' && p.key.scale === 'blues' && p.tempo === 70,
    `a slow blues in E: "${p.title}", ${p.key.root} ${p.key.scale}, ${p.tempo} BPM`,
  );
  assert.ok(
    p.loop.on &&
      p.loop.start === 0 &&
      p.loop.end === 96 &&
      p.sections.map((s) => `${s.name}:${s.start}-${s.start + s.length}`).join(' ') === 'Chorus 1:0-48 Chorus 2:48-96',
    `24 bars, looped, two choruses: ${p.sections.map((s) => s.name).join(', ')}`,
  );
  const g = p.tracks.find((t) => t.name === 'Guitar');
  assert.ok(
    names === 'Drums, Bass, Organ, Guitar' &&
      p.tracks.slice(0, 3).every((t) => t.clips.length === 1 && t.clips[0].notes.length > 40) &&
      g?.instrument.device === 'core.guitar' &&
      !g.clips.length,
    `a real song: ${names}; the band has notes, the Guitar track is DI Box and empty`,
  );
  assert.ok(
    p.tracks.slice(0, 3).every((t) => t.by === 'overdub' && t.clips[0].notes.every((n) => n.by === 'overdub')) &&
      p.meta.jam?.style === 'blues',
    'the house band signs its parts, and the song keeps its recipe (meta.jam)',
  );
  // in the asked key: every pitched note of a diatonic style is in its key's scale (or a chord tone of its bar)
  const outOfKey = [];
  for (const id of ['indie', 'ballad', 'lofi', 'neosoul']) {
    for (const key of ['G', 'Bb', 'F# minor']) {
      const x = JAM.jamTrack({ style: id, key });
      const pcs = new Set(scalePcs(x.project.key));
      const extra = new Set(x.chart.flatMap((c) => JAM.parseChord(c.name, x.project.key).pcs));
      for (const t of x.project.tracks)
        if (!/drum/i.test(t.instrument?.device || ''))
          for (const c of t.clips)
            for (const n of c.notes)
              if (!pcs.has(n.p % 12) && !extra.has(n.p % 12)) outOfKey.push(`${id} in ${key}: ${t.name} ${n.p}`);
    }
  }
  assert.ok(
    !outOfKey.length,
    `jam tracks are in the key asked for (4 styles x 3 keys${outOfKey.length ? ': ' + outOfKey.slice(0, 3).join('; ') : ''})`,
  );
  const again = JAM.jamTrack({ style: 'blues', key: 'E', tempo: 70 });
  const other = JAM.jamTrack({ style: 'blues', key: 'E', tempo: 70, seed: 2 });
  assert.ok(
    JSON.stringify(again.project.tracks) === JSON.stringify(p.tracks) &&
      JSON.stringify(other.project.tracks[0].clips[0].notes) !== JSON.stringify(p.tracks[0].clips[0].notes),
    'the same recipe gives the same song, ids and all; another seed another take',
  );
  const errs = [
    [{ style: 'zydeco' }, /no jam style/],
    [{ style: 'blues', key: 'H minor' }, /can't read the key/],
    [{ style: 'blues', tempo: 400 }, /out of range/],
    [{ style: 'blues', progression: 'Q7 Z' }, /can't read/],
    [{ style: 'blues', bars: 500 }, /too long/],
  ];
  const errOk = errs.every(([o, re]) => {
    const x = JAM.jamTrack(o);
    return x.error && re.test(x.error) && x.hint;
  });
  assert.ok(errOk, "a style, key, tempo, progression or length it can't use is refused with what would work");
  const pr = JAM.parseProgression('i7 | iv7 V7 | bVII % ', { root: 'A', scale: 'minor' });
  assert.ok(
    pr.bars.map((b) => b.map((c) => c.name).join(' ')).join(' | ') === 'Am7 | Dm7 E7 | G G',
    `numerals in a key, | between bars, % again: ${pr.bars.map((b) => b.map((c) => c.name).join(' ')).join(' | ')}`,
  );
  const sy = ['C', 'Am7', 'F#m7b5', 'Bbmaj7', 'E5', 'G/B', 'Dsus4', 'Ebdim7']
    .map((s) => JAM.parseChord(s)?.name)
    .join(' ');
  assert.ok(
    sy === 'C Am7 F#m7b5 A#maj7 E5 G/B Dsus4 D#dim7' || sy === 'C Am7 F#m7b5 Bbmaj7 E5 G/B Dsus4 Ebdim7',
    `chord names read: ${sy}`,
  );
});

test('tips that name frets, strings, bars and notes', () => {
  const ns = demoProject();
  const tips = JAM.jamTips(ns, JAM.chordTimeline(ns), { at: 0 });
  const k = Object.fromEntries(tips.map((t) => [t.kind, t]));
  assert.ok(
    /^A minor pentatonic fits the whole song: A C D E G\. Start at the 5th fret/.test(k.scale?.text || ''),
    `the scale and where to start: "${k.scale?.text}"`,
  );
  assert.ok(
    /^At bar 2 the chord moves to Fmaj7\. Land on F, its root/.test(k.target?.text || '') &&
      /fret, [A-Za-z ]+string/.test(k.target.text),
    `the note to land on at the change, with its fret and string: "${k.target?.text}"`,
  );
  const lick = k.lick?.lick;
  const fr = (lick?.notes || []).map((n) => n.f);
  const landed = lick?.notes.find((n) => n.t === 4);
  assert.ok(
    lick &&
      Math.min(...fr) >= 4 &&
      Math.max(...fr) <= 9 &&
      FB.handSpan(lick.notes) <= 5 &&
      landed &&
      landed.p % 12 === 5,
    `a two-bar lick in the box (frets ${Math.min(...fr)}-${Math.max(...fr)}) that lands on F as Fmaj7 arrives`,
  );
  assert.ok(
    lick && lick.tab.split('\n').length === 6 && /lands on F as Fmaj7 arrives/.test(lick.text),
    'the lick comes with its tab and says where it lands',
  );
  const fluff = tips.filter((t) => !/\b(\d+(st|nd|rd|th) fret|bar \d+|[A-G][#b]?\d?\b)/.test(t.text));
  assert.ok(
    !fluff.length && tips.length >= 3,
    `every tip names a fret, a bar or a note (${tips.length} tips${fluff.length ? '; vague: ' + fluff.map((t) => t.kind).join(', ') : ''})`,
  );
  const b = JAM.jamTrack({ style: 'blues' });
  const bt = JAM.jamTips(b.project, JAM.chordTimeline(b.project), { at: 0 });
  const out = bt.find((t) => t.kind === 'outside');
  assert.ok(
    out && /C# over A7, F# over D7, G# and B over E7/.test(out.text),
    `over a blues, the notes each chord brings, spelled from the chord: "${out?.text}"`,
  );
});
