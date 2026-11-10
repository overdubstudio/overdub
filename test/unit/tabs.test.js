// Tabs [jam], the parts that need no browser (sections 1-4 of tools/tabs-test.js, moved here): tab text round-trips and
// reads tab people type; notes keep their place (s, f) and clips their tuning and capo through ops, undo, a split, a
// share link and a save; the riff writer (deterministic, in key, playable, for every style and difficulty over every jam
// track); the play-along judge (core/playalong.js) and the guitar's note finder (input/onsets.js) on plucked strings.
// The lane in the page, the tools and the phone are in the browser: tools/tabs-test.js.
import { test } from 'node:test';
import * as FB from '../../app/src/core/fretboard.js';
import * as RIFF from '../../app/src/core/riff.js';
import * as JAM from '../../app/src/core/jam.js';
import * as PA from '../../app/src/core/playalong.js';
import { createNoteFinder } from '../../app/src/input/onsets.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject, cleanProject } from '../../app/src/core/project.js';
import { encodeShare, decodeShare, listenCopy } from '../../app/src/core/share.js';
import { demoProject } from '../../app/src/core/demo.js';
import { checks } from './helpers/check.js';

const r4 = (x) => Math.round(x * 10000) / 10000;

test('tab text round-trips and reads tab people type', async () => {
  const T = checks();
  const sig = (ns) =>
    ns
      .map(
        (n) =>
          `${n.p}/${n.s}:${n.f}@${r4(n.t)}~${r4(n.d)}${n.bend ? `b${Math.round(n.bend.reduce((m, x) => Math.max(m, x[1]), 0))}` : ''}`,
      )
      .sort()
      .join(' ');
  const trip = (notes, opts) => {
    const pl = FB.placeNotes(notes, opts);
    const text = FB.tabText(pl.notes, { ...opts, title: 'Riff' });
    const back = FB.parseTab(text);
    return { pl, text, back, same: sig(pl.notes) === sig(back.notes) };
  };
  // standard: eighths and quarters, a chord, a note held over a bar line, a bend, sixteenths with two-digit frets
  const std = [
    { p: 40, t: 0, d: 0.5 },
    { p: 47, t: 0, d: 0.5 },
    { p: 52, t: 0, d: 0.5 }, // E5 power chord
    { p: 45, t: 1, d: 0.5 },
    { p: 48, t: 1.5, d: 0.25 },
    { p: 50, t: 1.75, d: 0.25 },
    { p: 52, t: 2, d: 1 },
    { p: 55, t: 3, d: 2 }, // held over the bar line
    {
      p: 57,
      t: 5,
      d: 1,
      bend: [
        [0, 0],
        [0.25, 2],
      ],
    }, // a whole-step bend
    { p: 69, t: 6, d: 0.25 },
    { p: 71, t: 6.25, d: 0.25 },
    { p: 72, t: 6.5, d: 0.25 },
    { p: 74, t: 6.75, d: 0.25 },
    { p: 76, t: 7, d: 1 },
  ];
  const a = trip(std, { tuning: 'standard' });
  T.ok(
    a.same && a.back.tuning === 'standard' && !a.back.errors.length && !a.back.warnings.length,
    `standard tuning round-trips with its timing: ${a.back.notes.length} notes, chords, a tie over the bar line, a bend, 16ths on two-digit frets`,
  );
  T.ok(
    /^e \|/m.test(a.text) && /^ {2}\|1/m.test(a.text) && /One column per 16th/.test(a.text) && /7b9|b\d+/.test(a.text),
    'the text has the high e on top, a count line, the bend written 7b9, and says how to read it',
  );
  // drop D, read back from its labels alone (no tuning given)
  const dd = [
    { p: 38, t: 0, d: 0.25 },
    { p: 38, t: 0.25, d: 0.25 },
    { p: 41, t: 0.5, d: 0.5 },
    { p: 43, t: 1, d: 0.5 },
    { p: 38, t: 1.5, d: 0.25 },
    { p: 45, t: 2, d: 2 },
    { p: 50, t: 2, d: 2 },
  ];
  const b = trip(dd, { tuning: 'drop-d' });
  const labels = FB.formatTab(b.pl.notes, { tuning: 'drop-d' })
    .split('\n')
    .map((l) => l.slice(0, 2).trim())
    .join(' ');
  const noWords = FB.parseTab(FB.formatTab(b.pl.notes, { tuning: 'drop-d' }));
  T.ok(
    b.same && b.back.tuning === 'drop-d' && labels === 'e B G D A D' && noWords.tuning === 'drop-d',
    `drop D round-trips, and its labels alone (${labels}) say the tuning`,
  );
  // a shuffle on the triplet grid, and a capo (numbers from the capo, the note's own f from the nut)
  const sh = trip(
    [
      { p: 45, t: 0, d: 2 / 3 },
      { p: 49, t: 2 / 3, d: 1 / 3 },
      { p: 52, t: 1, d: 2 / 3 },
      { p: 54, t: 5 / 3, d: 1 / 3 },
    ].map((n) => ({ ...n, t: r4(n.t), d: r4(n.d) })),
    {},
  );
  T.ok(
    sh.same && Math.abs(sh.back.step - 1 / 3) < 1e-9 && /One column per 8th-note triplet/.test(sh.text),
    'a shuffle round-trips on the 8th-note triplet grid',
  );
  const cp = trip(
    [
      { p: 42, t: 0, d: 1 },
      { p: 47, t: 1, d: 1 },
      { p: 54, t: 2, d: 1 },
    ],
    { capo: 2 },
  );
  const firstFret = cp.pl.notes.find((n) => n.p === 42);
  T.ok(
    cp.same && cp.back.capo === 2 && /capo 2/.test(cp.text) && firstFret.f === 2 && /E \|0/.test(cp.text),
    'with a capo the numbers count from it (F#2 is 0 at capo 2), the text says capo 2, and it reads back',
  );
  // tab people type: no count line, no = marks: read, with the guess said
  const typed = FB.parseTab(
    'e|-------0---|\nB|-----1-----|\nG|---2-------|\nD|-2---------|\nA|0----------|\nE|-----------|',
  );
  T.ok(
    typed.notes.map((n) => n.p).join(' ') === '45 52 57 60 64' &&
      typed.guessed &&
      typed.warnings.some((w) => /guess/.test(w)),
    `tab typed by hand reads (${typed.notes.map((n) => n.p).join(' ')}), and says the lengths are a guess`,
  );
  const bad = FB.parseTab('e|--5--|\nB|--5--|'),
    none = FB.parseTab('just words');
  T.ok(
    /expected 6 lines/.test(bad.errors[0] || '') && /no lines of tab/.test(none.errors[0] || ''),
    `what can't be read says why ("${bad.errors[0]}")`,
  );
  T.done();
});

test('notes keep their places through ops, undo, split, share and save', async () => {
  const T = checks();
  const p = createProject({
    tracks: [
      {
        id: 't_g',
        name: 'Guitar',
        kind: 'instrument',
        instrument: { device: 'core.guitar', params: {} },
        inserts: [],
        clips: [],
        by: 'you',
      },
    ],
  });
  const s = createStore(p);
  let r = s.dispatch({
    type: 'clip.add',
    track: 't_g',
    ref: 'c',
    clip: {
      start: 0,
      length: 8,
      tuning: 'drop-d',
      capo: 2,
      notes: [
        { p: 40, t: 0, d: 1, s: 0, f: 2 },
        { p: 45, t: 1, d: 1, s: 1, f: 0 },
        { p: 50, t: 4, d: 1 },
        { p: 52, t: 5, d: 1, s: 'x', f: 1 },
      ],
    },
  });
  const cid = r.created.c,
    c = () => s.clip('t_g', cid);
  const placeOf = (n) => (n.s == null ? '-' : `${n.s}:${n.f}`);
  T.ok(
    r.ok && c().tuning === 'drop-d' && c().capo === 2 && c().notes.map(placeOf).join(' ') === '0:2 1:0 - -',
    `clip.add keeps s, f, tuning and capo (a malformed place is dropped): ${c().notes.map(placeOf).join(' ')}`,
  );
  r = s.dispatch({ type: 'notes.set', track: 't_g', clip: cid, notes: [{ id: 'n3', s: 2, f: 0 }] });
  const set = placeOf(c().notes[2]);
  s.undo();
  const undone = placeOf(c().notes[2]);
  s.redo();
  const redone = placeOf(c().notes[2]);
  const off = s.dispatch({ type: 'notes.set', track: 't_g', clip: cid, notes: [{ id: 'n1', s: null, f: null }] });
  const cleared = placeOf(c().notes[0]);
  s.undo();
  const back = placeOf(c().notes[0]);
  T.ok(
    r.ok && set === '2:0' && undone === '-' && redone === '2:0' && off.ok && cleared === '-' && back === '0:2',
    'notes.set sets and clears a place, and undo and redo put back exactly what was there',
  );
  const half = s.dispatch({ type: 'notes.set', track: 't_g', clip: cid, notes: [{ id: 'n2', s: 3 }] });
  T.ok(
    !half.ok && /s and f go together/.test(half.error),
    `a place is s and f together ("${(half.error || '').slice(0, 70)}…")`,
  );
  const cs = s.dispatch({ type: 'clip.set', track: 't_g', clip: cid, patch: { tuning: 'open-g', capo: 0 } });
  const after = [c().tuning, c().capo];
  s.undo();
  const badT = s.dispatch({ type: 'clip.set', track: 't_g', clip: cid, patch: { tuning: 'banjo' } });
  T.ok(
    cs.ok &&
      after[0] === 'open-g' &&
      after[1] === undefined &&
      c().tuning === 'drop-d' &&
      c().capo === 2 &&
      /tuning is one of standard, drop-d/.test(badT.error),
    'clip.set changes the tuning and the capo (0: none), undo puts them back, an unknown tuning is refused',
  );
  r = s.dispatch({ type: 'clip.split', track: 't_g', clip: cid, at: 2 });
  const halves = s
    .get()
    .tracks[0].clips.map((x) => `${x.tuning}/${x.capo}:${x.notes.map(placeOf).join(',')}`)
    .join(' ');
  T.ok(
    r.ok && halves === 'drop-d/2:0:2,1:0 drop-d/2:2:0,-',
    `a split keeps the tuning, the capo and every place on both sides: ${halves}`,
  );
  const saved = cleanProject(JSON.parse(JSON.stringify(s.get())));
  const enc = await encodeShare(s.get());
  const shared = cleanProject(listenCopy(await decodeShare(enc.hash), {}).song);
  const look = (q) => q.tracks[0].clips.map((x) => `${x.tuning}/${x.capo}:${x.notes.map(placeOf).join(',')}`).join(' ');
  T.ok(look(saved) === halves && look(shared) === halves, 'a save and load, and a share link, keep them too');
  // the pitch is the truth: a place that no longer plays its note is fingered again; a note with none is fingered
  const pl = FB.placeNotes(
    [
      { p: 45, t: 0, s: 1, f: 0 },
      { p: 47, t: 1, s: 1, f: 0 },
      { p: 50, t: 2 },
    ],
    { tuning: 'standard' },
  );
  T.ok(
    pl.notes[0].kept &&
      pl.notes[0].s === 1 &&
      pl.notes[0].f === 0 &&
      !pl.notes[1].kept &&
      FB.placeOk(pl.notes[1], 'standard') &&
      FB.placeOk(pl.notes[2], 'standard'),
    'a stored place that plays its pitch is kept; a stale one (the note moved) and a note with none are fingered',
  );
  const low = FB.placeNotes([{ p: 40, t: 0 }], { tuning: 'standard', capo: 3 });
  T.ok(
    /off the neck in Standard tuning with a capo at the 3rd fret \(G2 to/.test(low.error || '') && low.hint,
    `a note under the capo says so ("${low.error}")`,
  );
  T.done();
});

test('the riff writer', async () => {
  const T = checks();
  const songs = JAM.JAM_STYLE_IDS.map((id) => ({ name: id, p: JAM.jamTrack({ style: id }).project }));
  songs.push({ name: 'Night Shift', p: demoProject() });
  const problems = [],
    counts = {};
  let n = 0;
  for (const { name, p } of songs) {
    const tl = JAM.chordTimeline(p);
    for (const sec of p.sections.slice(0, 2))
      for (const style of RIFF.RIFF_STYLE_IDS)
        for (const difficulty of RIFF.DIFFICULTIES)
          for (const tuning of ['standard', 'drop-d']) {
            const r = RIFF.writeRiff(p, { timeline: tl, section: sec.id, style, difficulty, seed: 3, tuning });
            n++;
            if (r.error) {
              problems.push(`${name}/${sec.name}/${style}/${difficulty}/${tuning}: ${r.error}`);
              continue;
            }
            const c = r.checks;
            counts[style] = (counts[style] || 0) + 1;
            if (!c.inKey)
              problems.push(
                `${name} ${style} ${difficulty}: out of key ${c.outside.map((x) => `${x.p}@${x.t}`).join(',')}`,
              );
            if (!c.strong)
              problems.push(
                `${name} ${style} ${difficulty}: off a chord tone on a strong beat ${c.offStrong.map((x) => `${x.p}@${x.t}`).join(',')}`,
              );
            if (!c.playable)
              problems.push(
                `${name} ${style} ${difficulty}: unplayable ${c.unplayable.map((x) => `${x.p}@${x.t}`).join(',')}`,
              );
            if (!c.oneHand || c.shifts)
              problems.push(`${name} ${style} ${difficulty}: span ${c.span}, ${c.shifts} shifts`);
            if (!(r.bars >= 1 && r.bars <= 4)) problems.push(`${name} ${style}: ${r.bars} bars`);
            // checked independently of the writer's own checks: in the key's scale, a tone of the chord, or a blues' sweet side
            for (const x of r.notes) {
              const ch = JAM.chordAt(tl, r.start + x.t + 0.01).chord;
              const pc = ((x.p % 12) + 12) % 12;
              if (!RIFF.fitsOver(pc, tl.key, ch)) problems.push(`${name} ${style}: ${x.p} at ${x.t} fits nothing`);
              if (!FB.placeOk(x, tuning))
                problems.push(`${name} ${style}: ${x.p} at string ${x.s} fret ${x.f} doesn't play in ${tuning}`);
            }
          }
  }
  T.ok(
    !problems.length,
    `${n} riffs over ${songs.length} songs, every style, difficulty and both tunings: in key, chord tones on beats 1 and 3, playable, one hand within four frets${problems.length ? ':\n       ' + problems.slice(0, 6).join('\n       ') : ''}`,
  );
  const ns = demoProject(),
    tl = JAM.chordTimeline(ns);
  const x1 = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 4 }),
    x2 = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 4 }),
    x3 = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 5 });
  T.ok(
    JSON.stringify(x1.notes) === JSON.stringify(x2.notes) &&
      x1.tab === x2.tab &&
      JSON.stringify(x1.notes) !== JSON.stringify(x3.notes),
    'deterministic: the same seed writes the same riff, the next seed another',
  );
  // a motif, repeated and varied: bar 2's rhythm is bar 1's up to its answer, on another chord
  const rhythm = (r, k) => r.notes.filter((x) => x.t >= k * 4 && x.t < (k + 1) * 4).map((x) => r4(x.t - k * 4));
  const b1 = rhythm(x1, 0),
    b3 = rhythm(x1, 2);
  T.ok(
    x1.bars === 4 && JSON.stringify(b1) === JSON.stringify(b3) && x1.notes.some((x) => x.t >= 4 && x.t < 8),
    `a motif comes back: Night Shift's verse (${x1.chords.join(' ')}) gets a ${x1.bars}-bar riff whose 1st and 3rd bars share a rhythm`,
  );
  T.ok(
    /^Rock 8ths over the Verse, bars 1–4 \(Am7, Fmaj7, C, G7\)/.test(x1.text) &&
      /Every note on beats 1 and 3 is a chord tone/.test(x1.text) &&
      x1.label.length <= 48,
    `it says what it is and what it checked: "${x1.text.slice(0, 140)}…"`,
  );
  const tk = RIFF.riffTakes(ns, { timeline: tl, section: 'Verse', style: 'rock', seed: 1 }, 3);
  T.ok(
    tk.takes.length === 3 &&
      new Set(tk.takes.map((x) => x.motif)).size === 3 &&
      new Set(tk.takes.map((x) => x.label)).size === 3,
    `three takes, three motifs, three labels: ${tk.takes.map((x) => x.label).join('; ')}`,
  );
  const hard = RIFF.writeRiff(JAM.jamTrack({ style: 'blues' }).project, {
    timeline: JAM.chordTimeline(JAM.jamTrack({ style: 'blues' }).project),
    style: 'blues',
    difficulty: 'hard',
    motif: 'call',
    seed: 2,
  });
  T.ok(
    hard.notes.some((x) => x.bend) && /bend in bar \d+ goes up a whole step/.test(hard.text),
    `hard adds bends, and the text names them: "${(hard.text.match(/The bend[^.]*|and the bend[^.]*/) || [''])[0]}"`,
  );
  const easy = RIFF.writeRiff(ns, { timeline: tl, section: 'Verse', style: 'funk', difficulty: 'easy', seed: 1 });
  T.ok(
    easy.notes.every((x) => Math.abs(x.t * 2 - Math.round(x.t * 2)) < 1e-6) && !easy.notes.some((x) => x.bend),
    'easy keeps to eighths and leaves bends out',
  );
  const errs = [
    RIFF.writeRiff(ns, { timeline: tl, section: 'Coda' }),
    RIFF.writeRiff(ns, { timeline: tl, style: 'polka' }),
    RIFF.writeRiff(ns, { timeline: tl, difficulty: 'insane' }),
    RIFF.writeRiff({ ...ns, meter: [5, 4] }, { timeline: tl }),
    RIFF.writeRiff(createProject({ key: null }), { timeline: JAM.chordTimeline(createProject({ key: null })) }),
  ];
  T.ok(
    errs.every((e) => e.error && e.hint) &&
      /no section "Coda"/.test(errs[0].error) &&
      /Verse/.test(errs[0].hint) &&
      /4\/4/.test(errs[3].error) &&
      /no chords/.test(errs[4].error),
    `what it can't write says why ("${errs[0].error}"; "${errs[4].error}")`,
  );
  const tonic = RIFF.writeRiff(createProject({ key: { root: 'E', scale: 'minor' } }), {
    timeline: JAM.chordTimeline(createProject({ key: { root: 'E', scale: 'minor' } })),
    bars: [1, 2],
    style: 'metal',
  });
  T.ok(
    !tonic.error && tonic.chordsTonic && /the key's own chord: no chords are read there/.test(tonic.text),
    "a song with a key and no parts gets a riff over the key's own chord, and it says so",
  );
  T.done();
});

test("the play-along judge and the guitar's note finder", async () => {
  const T = checks();
  const notes = [
    { p: 45, t: 0, d: 0.5 },
    { p: 48, t: 0.5, d: 0.5 },
    { p: 50, t: 1, d: 0.5 },
    {
      p: 52,
      t: 2,
      d: 1,
      bend: [
        [0, 0],
        [0.25, 2],
      ],
    },
    { p: 40, t: 3, d: 1 },
    { p: 47, t: 3, d: 1 },
    { p: 52, t: 3, d: 1 },
  ];
  const gs = PA.groupsOf(notes, { start: 32, bpb: 4 });
  T.ok(
    gs.length === 5 && gs[4].n === 3 && gs[4].p === 40 && gs[3].bend === 2 && gs[0].bar === 9 && gs[3].beat === 3,
    "a part's onsets: a chord is one, by its lowest note; bars and beats are the song's",
  );
  const mpb = 500; // 120 BPM
  const f = PA.createFollow(gs, { msPerBeat: mpb });
  const h = (p, beat, src = 'keys', ps = null) => f.hear({ p, beat: 32 + beat, src, ps });
  const r1 = h(45, 0.02),
    r2 = h(48, 0.5 - 0.2),
    r3 = h(52, 2 + 0.24),
    r5 = h(40, 3.01, 'guitar'),
    r6 = h(47, 3.03, 'guitar');
  f.passed(32 + 5);
  const lone = PA.createFollow(gs, { msPerBeat: mpb }).hear({ p: 47, beat: 35.01, src: 'keys' });
  T.ok(
    r1.mark === 'hit' && r2.mark === 'early' && r3.mark === 'late' && r5.mark === 'hit' && r6 === null && lone.wrong,
    `on time is a hit, 100 ms ahead early, 120 ms behind late; a chord is struck by its lowest note (its other strings are part of it, alone they aren't it): ${[r1, r2, r3, r5].map((x) => x.mark).join(', ')}`,
  );
  T.ok(f.marks.get(2).mark === 'missed', 'a note that went by unheard is missed');
  const s1 = f.summary();
  T.ok(s1.line === '2 of 5, the bend in bar 9 is late.', `the line after a pass: "${s1.line}"`);
  const g2 = PA.createFollow(gs, { msPerBeat: mpb });
  const w = g2.hear({ p: 47, beat: 32.51, src: 'keys' });
  g2.hear({ p: 45, beat: 32, src: 'keys' });
  g2.hear({ p: 50, beat: 33, src: 'keys' });
  g2.hear({ p: 52, beat: 34, src: 'keys' });
  g2.hear({ p: 40, beat: 35, src: 'keys' });
  g2.passed(40);
  T.ok(
    w.wrong && g2.summary().line === '4 of 5, the C on the and of 1 of bar 9 came out as B.',
    `a wrong note where one was due is named: "${g2.summary().line}"`,
  );
  const flat = PA.groupsOf(
    notes.filter((x) => !x.bend),
    { start: 32, bpb: 4 },
  );
  const g3 = PA.createFollow(flat, { msPerBeat: mpb }),
    g3b = PA.createFollow(flat, { msPerBeat: mpb });
  for (const x of flat) {
    g3.hear({ p: x.p, beat: x.t + 0.2, src: 'keys' });
    g3b.hear({ p: x.p, beat: x.t + 0.08, src: 'keys' });
  }
  T.ok(
    g3.summary().line === '0 of 4, running about 100 ms late.' && g3b.summary().line === '4 of 4, all in time.',
    `a steady lean is said once ("${g3.summary().line}"), and 40 ms is in time`,
  );
  const g4 = PA.createFollow(gs, { msPerBeat: mpb });
  for (const x of gs) g4.hear({ p: x.p, beat: x.t, src: 'keys' });
  T.ok(
    g4.summary().line === '5 of 5, all in time.' &&
      PA.matchPitch(gs[0], 57, 'guitar') &&
      !PA.matchPitch(gs[0], 57, 'keys') &&
      PA.matchPitch(gs[0], 43, 'guitar', [43, 45]) &&
      PA.matchPitch(gs[3], 54, 'keys'),
    "all in time says so; the guitar's octave slips and second candidates count, the keys' don't; a bend counts where it lands",
  );
  // the guitar: plucked strings (Karplus-Strong) at known times and pitches, read by the note finder
  const sr = 48000;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  const pluck = (buf, midi, t, dur) => {
    const N = Math.round(sr / (440 * Math.pow(2, (midi - 69) / 12))),
      line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = rnd() * 0.4;
    let k = 0;
    const a = Math.round(t * sr),
      b = Math.min(buf.length, a + Math.round(dur * sr));
    for (let i = a; i < b; i++) {
      const y = line[k];
      line[k] = 0.5 * (y + line[(k + 1) % N]) * 0.996;
      k = (k + 1) % N;
      buf[i] += y * (i > b - 480 ? (b - i) / 480 : 1);
    }
  };
  const want = [
    [40, 0.3],
    [45, 0.8],
    [52, 1.25],
    [55, 1.6],
    [57, 2.0],
    [64, 2.4],
    [69, 2.7],
    [76, 3.0],
    [47, 3.4],
    [43, 3.9],
  ];
  const buf = new Float32Array(sr * 5);
  for (const [m, t] of want) pluck(buf, m, t, 0.45);
  for (let i = 0; i < buf.length; i++) buf[i] += rnd() * 0.0005;
  const nf = createNoteFinder({ sr }),
    got = [];
  for (let i = 0; i < buf.length; i += 2048) got.push(...nf.push(buf.subarray(i, i + 2048), 1000 + i));
  const onTime = want.every(([, t]) => got.some((e) => Math.abs((e.f - 1000) / sr - t) < 0.006));
  const heard = want.every(([m, t]) =>
    got.some((e) => Math.abs((e.f - 1000) / sr - t) < 0.006 && (e.p === m || e.ps.includes(m))),
  );
  T.ok(
    got.length === want.length && onTime && heard,
    `the guitar's notes: ${got.length} onsets for ${want.length} plucks, each within 6 ms, each pitch heard (first, or among its candidates while the string before still rings)`,
  );
  const b2 = new Float32Array(sr * 2);
  pluck(b2, 52, 0.2, 0.4);
  for (let i = Math.round(0.6 * sr); i < Math.round(1.2 * sr); i++) {
    const t = (i - 0.6 * sr) / sr;
    b2[i] += 0.12 * Math.exp(-t * 3) * (Math.sin(2 * Math.PI * 185 * t) + 0.5 * Math.sin(2 * Math.PI * 370 * t));
  }
  const nf2 = createNoteFinder({ sr }),
    g5 = [];
  for (let i = 0; i < b2.length; i += 2048) g5.push(...nf2.push(b2.subarray(i, i + 2048), i));
  T.ok(
    g5.length === 2 && g5[1].legato && g5[1].p === 54 && Math.abs(g5[1].f / sr - 0.6) < 0.06,
    `a new pitch with no attack (a hammer-on) is a note too: ${g5.map((e) => `${e.p}${e.legato ? ' legato' : ''}`).join(', ')}`,
  );
  T.done();
});
