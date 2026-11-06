// Core checks moved from tools/core-test.js (they need no browser and no other unit test covered them): clip.take (the
// take group a recording stacks), a song file's 1e400 (Infinity) staying out of the song, colours set by an op being a
// palette token or hex (TRACK_COLORS), and the Jam room's music (core/jam.js, fresh eyes 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/src/core/store.js';
import { summarize, cleanProject, createProject, songSize, songEnd, TRACK_COLORS } from '../../app/src/core/project.js';
import * as JAM from '../../app/src/core/jam.js';
import { noteName as nn } from '../../app/src/core/music.js';

const t = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };
// canonical JSON (sorted keys): the same song, whatever order its keys were written in
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((kk) => [kk, v[kk]]),
        )
      : v,
  );
const same = (a, b) => canon(a) === canon(b);

test('clip.take: the take group a recording stacks', () => {
  // clip.take: the take group a recording stacks (input/recorder.js). Optional, kept by normalising, set and cleared by
  // clip.set with an exact undo, checked; a song without it is unchanged
  {
    const s = createStore(createProject());
    const r0 = s.dispatch({
      type: 'track.add',
      ref: 'k',
      track: { name: 'Keys', instrument: { device: 'core.keys' } },
    });
    const k = r0.created.k;
    const before = canon(s.get().tracks);
    const r1 = s.dispatch(
      [
        {
          type: 'clip.add',
          track: k,
          ref: 'a',
          clip: { start: 0, length: 4, name: 'Take 1', notes: 'C4@0:1', take: 'tk_ab12cd' },
        },
        {
          type: 'clip.add',
          track: k,
          ref: 'b',
          clip: { start: 0, length: 4, name: 'Take 2', notes: 'E4@0:1', take: 'tk_ab12cd', mute: true },
        },
      ],
      { by: 'you', label: 'record take 2 on Keys' },
    );
    const [ca, cb] = [r1.created.a, r1.created.b].map((id) => s.clip(k, id));
    t.ok(
      r1.ok && ca.take === 'tk_ab12cd' && cb.take === 'tk_ab12cd' && cb.mute === true,
      'clip.add keeps a take group (and a muted take)',
    );
    t.ok(
      cleanProject(JSON.parse(JSON.stringify(s.get()))).tracks[0].clips.every((c) => c.take === 'tk_ab12cd'),
      'normalising a song keeps the take group',
    );
    t.ok(
      !(
        'take' in
        cleanProject({
          ...createProject(),
          tracks: [{ name: 'K', clips: [{ start: 0, length: 4, take: 'not a take' }] }],
        }).tracks[0].clips[0]
      ),
      "a take that isn't a take id is dropped on load",
    );
    const withTake = canon(s.get().tracks);
    const r2 = s.dispatch(
      [
        { type: 'clip.set', track: k, clip: ca.id, patch: { mute: true } },
        { type: 'clip.set', track: k, clip: cb.id, patch: { mute: false } },
      ],
      { by: 'you', label: 'take 2' },
    );
    t.ok(r2.ok && ca.mute === true && !('mute' in cb), 'switching takes is a clip.set { mute } pair');
    s.undo();
    t.ok(canon(s.get().tracks) === withTake, 'and one undo switches back exactly');
    const r3 = s.dispatch({ type: 'clip.set', track: k, clip: ca.id, patch: { take: null } }, { by: 'you' });
    t.ok(r3.ok && !('take' in s.clip(k, ca.id)), 'clip.set { take: null } takes a clip out of its group (no key left)');
    s.undo();
    t.ok(s.clip(k, ca.id).take === 'tk_ab12cd', 'its undo puts it back in');
    const r4 = s.dispatch({ type: 'clip.set', track: k, clip: ca.id, patch: { take: 'tk_zz9' } }, { by: 'you' });
    const r5 = s.dispatch({ type: 'clip.add', track: k, clip: { start: 8, length: 4, take: 42 } }, { by: 'you' });
    t.ok(
      !r4.ok && /take group id/.test(r4.error) && !r5.ok && /take group id/.test(r5.error),
      `a malformed take is refused (${r4.error})`,
    );
    t.ok(
      /\(take 1 of 2, playing\)/.test(summarize(s.get())) && /\(take 2 of 2\) \(muted\)/.test(summarize(s.get())),
      "the agent's view says which take plays: " + (summarize(s.get()).match(/\(take[^)]*\)[^b]*/g) || []).join(' | '),
    );
    s.undo();
    t.ok(canon(s.get().tracks) === before, 'undoing the recording takes both takes out, exactly');
  }
});
test('a song files 1e400 stays out of the song', () => {
  // a song file is read with JSON.parse, where 1e400 is Infinity, and cleanProject passed it on: a clip starting at
  // Infinity, notes at -Infinity, a song that never ended. A clip gets a finite start and length (and an audio clip a
  // finite offset and gain), a note the studio can't place is left out, and a note that leaves out its length or
  // velocity (an older or hand-written song) stays
  {
    const text = `{"title":"Inf","tracks":[{"name":"I","instrument":{"device":"core.keys","params":{}},"clips":[
    {"id":"c_inf0001","kind":"notes","start":1e400,"length":1e400,"notes":[{"id":"n1","p":1e400,"t":0,"d":1,"v":0.8},{"id":"n2","p":60,"t":-1e400,"d":1,"v":0.8},
      {"id":"n3","p":62,"t":1,"d":1e400,"v":0.8},{"id":"n4","p":64,"t":2,"d":1,"v":-1e400},{"id":"n5","p":65,"t":3,"d":1,"v":0.8},{"id":"n6","p":67,"t":3.5}]},
    {"id":"c_inf0002","kind":"audio","asset":"a_inf0001","start":4,"length":4,"offset":1e400,"gain":-1e400}]}],
    "sections":[{"name":"S","start":1e400,"length":1e400}],"master":{"gain":1e400,"inserts":[]}}`;
    const p = cleanProject(JSON.parse(text));
    const [nc, ac] = ['c_inf0001', 'c_inf0002'].map((id) => p.tracks[0].clips.find((c) => c.id === id));
    const sz = songSize(p),
      sec = p.sections[0];
    const st = createStore(JSON.parse(text));
    t.ok(
      nc.start === 0 &&
        nc.length === 4 &&
        nc.notes.map((n) => n.id).join(' ') === 'n5 n6' &&
        ac.offset === 0 &&
        ac.gain === 0 &&
        sec.start === 0 &&
        sec.length === 16 &&
        p.master.gain === 0 &&
        sz.end === 16 &&
        songEnd(p) === 16 &&
        st.dispatch({ type: 'project.set', patch: { tempo: 99 } }).ok,
      `a song file's 1e400 (Infinity) stays out of the song: the clip at beat ${nc.start} for ${nc.length}, notes ${nc.notes.map((n) => n.id).join(' and ')} kept (the rest can't be placed), the song ends at beat ${sz.end}`,
    );
  }
});
test('colours set by an op are a palette token or hex', () => {
  // colours set by an op: track.set, clip.set and the section ops took any value (an agent's url(...) drew as CSS and was
  // fetched). A recolour must be a palette token or hex; a new thing's odd colour gets the default; null still clears an
  // optional colour (the inverse of setting one)
  {
    const s = createStore(createProject());
    const beacon = 'url("https://example.com/beacon.gif")';
    const r0 = s.dispatch(
      [
        { type: 'track.add', ref: 'k', track: { name: 'Keys', color: beacon, instrument: { device: 'core.keys' } } },
        { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, length: 4, color: beacon, notes: 'C4@0:1' } },
        { type: 'section.add', ref: 's', section: { name: 'Verse', start: 0, length: 4, color: beacon } },
      ],
      { by: 'mcp:probe' },
    );
    const { k, c, s: sec } = r0.created;
    const made = [s.track(k).color, s.clip(k, c).color, s.get().sections[0].color];
    const before = canon({ ...s.get(), meta: null });
    const bad = [
      { type: 'track.set', track: k, patch: { color: beacon } },
      { type: 'track.set', track: k, patch: { color: 'red' } },
      { type: 'clip.set', track: k, clip: c, patch: { color: 'rgb(1, 2, 3)' } },
      { type: 'section.set', section: sec, patch: { color: 'var(--c-1, url(x))' } },
    ].map((op) => s.dispatch(op, { by: 'mcp:probe' }));
    const good = s.dispatch(
      [
        { type: 'track.set', track: k, patch: { color: '#4fa3e0' } },
        { type: 'clip.set', track: k, clip: c, patch: { color: 'var(--c-2)' } },
        { type: 'section.set', section: sec, patch: { color: '#abc' } },
      ],
      { by: 'you' },
    );
    const after = [s.track(k).color, s.clip(k, c).color, s.get().sections[0].color];
    const cleared = s.dispatch(
      [
        { type: 'clip.set', track: k, clip: c, patch: { color: null } },
        { type: 'section.set', section: sec, patch: { color: null } },
      ],
      { by: 'you' },
    );
    t.ok(
      TRACK_COLORS.includes(made[0]) &&
        made[1] === undefined &&
        made[2] === undefined &&
        bad.every((r) => !r.ok && /color must be a palette colour/.test(r.error)) &&
        good.ok &&
        same(after, ['#4fa3e0', 'var(--c-2)', '#abc']) &&
        cleared.ok &&
        !('color' in s.clip(k, c)) &&
        !('color' in s.get().sections[0]),
      `a colour an op sets is a palette token or hex: url(...), named and rgb() are refused ("${bad[0].error}"), a new thing's gets the default; null still clears one`,
    );
    t.ok(s.undo().ok && s.undo().ok && canon({ ...s.get(), meta: null }) === before, '…and recolours undo exactly');
  }
});
test('The Jam rooms music (core/jam.js), fresh eyes 6', async () => {
  // The Jam room's music (core/jam.js), fresh eyes 6: two chords in a bar, tips that go round the loop, the chords a
  // guitarist writes, "inside the box" and who a jam track's summary credits
  {
    // two chords in a bar: the first bass note under a new chord is its root, wherever in the bar it arrives (a boogie's
    // tail played C B A F# over a D7 on beat 3), so the timeline reads each half bar's chord back, in every riff style
    const halves = [
      ['blues', 'I7 IV7 | I7 V7'],
      ['blues', 'I7 IV7 | V7 IV7'],
      ['funk', 'i7 IV7 | bVImaj7 V7'],
      ['reggae', 'i iv | bVI bVII'],
      ['bossa', 'i6 ii7b5 | iv7 V7'],
      ['metal', 'i5 bVI5 | bVII5 i5'],
    ];
    const misread = [];
    for (const [style, progression] of halves) {
      const r = JAM.jamTrack({ style, progression, bars: 2 }),
        tl = JAM.chordTimeline(r.project);
      const got = [0, 2, 4, 6].map((b) => JAM.chordAt(tl, b + 0.01).chord?.name || '-').join(' '),
        want = r.chart.map((c) => c.name).join(' ');
      if (got !== want) misread.push(`${style} "${progression}": ${want} read as ${got}`);
    }
    t.ok(
      !misread.length,
      `two chords in a bar read back by the half bar in every riff style (${halves.length} progressions${misread.length ? ': ' + misread.join('; ') : ''})`,
    );
    // the agent's own progression: three chords in bar 2 (A7, A7 again, E7 a third of the way into beat 3)
    const ag = JAM.jamTrack({ style: 'blues', progression: 'I7 IV7 | I7 % V7', bars: 2 });
    const bass = ag.project.tracks.find((x) => x.name === 'Bass').clips[0].notes;
    const under = (a) => bass.filter((n) => n.t >= a - 1e-3).sort((x, y) => x.t - y.t)[0];
    const d7 = under(2),
      e7 = under(ag.chart.find((c) => c.name === 'E7').a),
      atl = JAM.chordTimeline(ag.project);
    const bar1 = [0, 2].map((b) => JAM.chordAt(atl, b + 0.01).chord?.name).join(' ');
    t.ok(
      d7.p % 12 === 2 && e7.p % 12 === 4 && Math.abs(e7.t - 6.6667) < 1e-3 && bar1 === 'A7 D7',
      `"I7 IV7 | I7 % V7": the bass plays ${nn(d7.p)} as the D7 arrives on beat 3 and ${nn(e7.p)} at ${e7.t} as the E7 does (the shuffled 8th that lands there), and bar 1 reads ${bar1}`,
    );

    // the tips go round the loop: on the blues' last bar (E7, the turnaround) the next change is bar 13's A7 when Chorus 2
    // loops, bar 1's when the loop is the form, and from the top with no loop; the lick's second bar goes round with it
    const bl = JAM.jamTrack({ style: 'blues' }),
      btl = JAM.chordTimeline(bl.project),
      at24 = 23 * 4 + 1;
    const tipsAt = (loop) =>
      Object.fromEntries(JAM.jamTips({ ...bl.project, loop }, btl, { at: at24 }).map((x) => [x.kind, x]));
    const ch2 = tipsAt({ on: true, start: 48, end: 96 }),
      form = tipsAt({ on: true, start: 0, end: 96 }),
      off = tipsAt({ on: false, start: 0, end: 96 });
    t.ok(
      /^At bar 13, round the loop, the chord moves to A7\. Land on C#, its 3rd/.test(ch2.target?.text || '') &&
        /^At bar 1, round the loop, the chord moves to A7/.test(form.target?.text || '') &&
        /^At bar 1, from the top, the chord moves to A7/.test(off.target?.text || ''),
      `on bar 24 the land-on tip goes round: "${ch2.target?.text}" / "${off.target?.text?.slice(0, 50)}…"`,
    );
    const lk = ch2.lick?.lick;
    t.ok(
      lk &&
        /^A two-bar lick over E7 to A7 \(bars 24 and 13, round the loop\)/.test(lk.text) &&
        lk.bars.join() === '24,13' &&
        lk.starts.join() === '92,48' &&
        lk.notes.find((n) => n.t === 4)?.p % 12 === 1 &&
        /bars 24 and 1, from the top/.test(off.lick?.text || ''),
      `and the lick into it: "${lk?.text}" (main: "over E7 (bars 24–25)", a bar that isn't there)`,
    );

    // Make your own: the chords a funk or jazz player writes (13ths, 11ths, sus and altered dominants, 6/9), each read
    // from its name; a chord it can't read is named once
    const funk = JAM.parseProgression('Em9 A13 Em9 A13 Gmaj7 F#7#9 Em9 A13', { root: 'E', scale: 'minor' });
    const a13 = JAM.parseChord('A13');
    const more = ['E7sus4', 'D7sus', 'G9sus4', 'B7b9', 'C7#11', 'F6/9', 'Bb69', 'Dm11', 'Fmaj13', 'G11', 'Am13'].map(
      (s) => JAM.parseChord(s)?.name || `(${s}?)`,
    );
    const bad = JAM.parseProgression('Em9 X13 Em9 X13 Gmaj7 X13', { root: 'E', scale: 'minor' });
    t.ok(
      !funk.error &&
        funk.bars.length === 8 &&
        a13 &&
        JAM.chordTones(a13)
          .map((x) => x.note)
          .join(' ') === 'A C# E G F#' &&
        !more.some((x) => x.startsWith('(')) &&
        /^can't read "X13" as a chord$/.test(bad.error || ''),
      `Make your own reads "Em9 A13 … F#7#9 …" (${funk.error || 'ok'}); A13 is ${
        a13
          ? JAM.chordTones(a13)
              .map((x) => `${x.note}:${x.name}`)
              .join(' ')
          : 'unread'
      }; ${more.join(' ')}; a bad chord is named once: ${bad.error}`,
    );
    const tonesOf = (s) => {
      const c = JAM.parseChord(s);
      return c
        ? JAM.chordTones(c)
            .map((x) => x.note)
            .join(' ')
        : `(${s} unread)`;
    };
    const c711 = tonesOf('A7#11'),
      b7b9 = tonesOf('E7b9');
    // (a style that adds 9ths, funk, in a key that has G7's 9th: G7#9's voicing keeps its A# and gets no A)
    const fj = JAM.jamTrack({ style: 'funk', key: 'C major', progression: 'Cmaj7 | G7#9' });
    const ep = (fj.project?.tracks.find((x) => x.name === 'E-piano')?.clips[0].notes || []).filter(
      (n) => n.t >= 4 && n.t < 8,
    );
    const pcs = [...new Set(ep.map((n) => n.p % 12))].sort((x, y) => x - y);
    t.ok(
      c711 === 'A C# E G D#' && b7b9 === 'E G# B D F' && !fj.error && pcs.includes(10) && !pcs.includes(9),
      `extensions are spelled from the chord (A7#11: ${c711}; E7b9: ${b7b9}), and a funk band never stacks a 9th on a chord with its own sharp 9 (G7#9 voiced as pitch classes ${pcs.join(' ')})`,
    );

    // "inside the box" only for a note under a finger of the box (frets at..at+3), never a stretch a fret outside it:
    // over the blues' D7, F# is the B string's 7th fret (main chose the D string's 4th and called it inside)
    const into = Object.fromEntries(JAM.jamTips(bl.project, btl, { at: 3 * 4 + 1 }).map((x) => [x.kind, x]));
    const stretched = [];
    for (const id of JAM.JAM_STYLE_IDS) {
      const x = JAM.jamTrack({ style: id }),
        xtl = JAM.chordTimeline(x.project),
        box = JAM.boxFor(xtl.key).at;
      for (const c of xtl.chords) {
        const tg = JAM.jamTips(x.project, xtl, { at: c.start + 0.01 }).find((y) => y.kind === 'target');
        const f = tg?.show.positions[0]?.f;
        if (tg && /inside the box/.test(tg.text) && !(f >= box && f <= box + 3))
          stretched.push(`${id} bar ${c.bar}: fret ${f}, box at ${box}`);
      }
    }
    t.ok(
      /Land on F#, its 3rd.* 7th fret, B string, inside the box\.$/.test(into.target?.text || '') && !stretched.length,
      `"inside the box" is a fret of the box, never its stretch: "${(into.target?.text || '').replace(/^.*Land on/, 'Land on')}" (every style's changes checked${stretched.length ? '; stretched: ' + stretched.slice(0, 3).join(', ') : ''})`,
    );

    // who the summary credits: the house band when the house made it; an agent's jam track is signed by the agent
    const house = JAM.jamTrack({ style: 'blues' }).summary,
      agent = JAM.jamTrack({ style: 'blues', by: 'mcp:claude-code' });
    t.ok(
      /Drums, Bass, Organ by the house band, and a Guitar track for you/.test(house) &&
        !/house band/.test(agent.summary) &&
        /Drums, Bass, Organ, and a Guitar track for you/.test(agent.summary) &&
        agent.project.tracks.every((x) => x.by === 'mcp:claude-code'),
      `an agent's jam track doesn't credit the house band ("…${agent.summary.slice(agent.summary.lastIndexOf('.', agent.summary.length - 2) + 2)}"); the house's still does`,
    );
  }
});
