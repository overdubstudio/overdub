// The Node half of tools/arrangement-test.js that test/unit/arrangement.test.js does not cover: section.move,
// clip.repeat, ops in one transaction, undo and revert never taking someone else's edit, the limits, comping take
// folders, take folders through the other edits, and a clip dropped on another. (clip.split, time.insert, time.remove
// and section.duplicate are covered by arrangement.test.js and stay with the browser check's copy.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/src/core/store.js';
import { createProject, LIMITS, songSize } from '../../app/src/core/project.js';
import {
  planSectionDuplicate,
  planSectionMove,
  planTimeInsert,
  planTimeRemove,
  planClipRepeat,
  planClipSplit,
  planTakeFolder,
  takeFolders,
  planTakeComp,
  planTakeLaneDelete,
  planTakesFlatten,
  planClipTrim,
  retake,
  barBeat,
  barBeatSpan,
  planDropTrim,
} from '../../app/src/core/arrangement.js';
import { formatNotes } from '../../app/src/core/music.js';
import { valueAt } from '../../app/src/core/automation.js';

const T = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };
// canonical JSON (sorted keys), without meta (its modified time moves)
const canon = (x) =>
  JSON.stringify({ ...x, meta: null }, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((kk) => [kk, v[kk]]),
        )
      : v,
  );
const near = (a, b) => Math.abs(a - b) < 1e-3;
// 4/4 at 120 bpm (half a second a beat). Verse 0–16, Chorus 16–32, Outro 32–40; the loop over the Chorus.
function song() {
  const s = createStore(createProject({ title: 'T', tempo: 120, loop: { on: true, start: 16, end: 32 } }));
  const r = s.dispatch(
    [
      { type: 'section.add', ref: 'v', section: { name: 'Verse', start: 0, length: 16 } },
      { type: 'section.add', ref: 'c', section: { name: 'Chorus', start: 16, length: 16, color: 'var(--c-7)' } },
      { type: 'section.add', ref: 'o', section: { name: 'Outro', start: 32, length: 8 } },
      { type: 'track.add', ref: 'keys', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
      {
        type: 'clip.add',
        track: '$keys',
        ref: 'ka',
        clip: { start: 0, length: 16, name: 'Chords', notes: 'C4@0:2 E4@2:2 G4@4:1 C4@6:4 A3@10:2 F4@12:4 D4@15.5:1' },
      },
      {
        type: 'clip.add',
        track: '$keys',
        ref: 'kb',
        clip: { start: 20, length: 8, name: 'Stab', notes: 'C5@0:0.5 C5@3.5:1 E5@5:3' },
      },
      { type: 'track.add', ref: 'drums', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
      {
        type: 'clip.add',
        track: '$drums',
        ref: 'da',
        clip: {
          start: 0,
          length: 32,
          name: 'Beat',
          notes: '36@0:0.25 38@4:0.25 36@7.9:0.25 38@12:0.25 36@16:0.25 38@20:0.25 36@24:0.25',
        },
      },
      { type: 'track.add', ref: 'vox', track: { name: 'Vox', kind: 'audio' } },
      {
        type: 'asset.add',
        asset: { id: 'a_take01', kind: 'audio', name: 'take', sr: 48000, channels: 1, duration: 30 },
      },
      {
        type: 'clip.add',
        track: '$vox',
        ref: 'va',
        clip: { kind: 'audio', asset: 'a_take01', start: 4, length: 8, offset: 0.5, name: 'Take' },
      },
    ],
    { by: 'you', label: 'the song' },
  );
  // a bassline in the Chorus by the agent, and one the human wrote
  const b = s.dispatch(
    [
      { type: 'track.add', ref: 'bass', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
      {
        type: 'clip.add',
        track: '$bass',
        ref: 'ba',
        clip: { start: 16, length: 16, name: 'Walk', notes: 'A1@0:1 C2@4:1 E2@8:1 G2@12:3.5' },
      },
    ],
    { by: 'claude', label: 'bass' },
  );
  const ids = { ...r.created, ...b.created };
  return { s, ids, T: (name) => s.get().tracks.find((t) => t.name === name), C: (id) => s.findClip(id)?.clip };
}

// Apply ops as one step; check undo is exact and redo gives the same song again. -> the store's result
function roundTrip(s, ops, by, what) {
  const before = canon(s.get());
  const r = s.dispatch(ops, { by, label: what });
  if (!T.ok(r.ok, `${what}: applies${r.ok ? '' : ': ' + r.error}`)) return r;
  const after = canon(s.get());
  T.ok(after !== before, `${what}: changes the song`);
  const steps = s.history.length;
  const u = s.undo();
  T.ok(u.ok && canon(s.get()) === before, `${what}: one undo step puts it back exactly (canonical JSON)`);
  const rd = s.redo();
  T.ok(rd.ok && canon(s.get()) === after && s.history.length === steps, `${what}: redo gives the same song again`);
  return r;
}
// What a clip's notes sound: per pitch, the beats [start, end) in song time, cut at the clip's end; merged.
function sounding(clips, { onsetsOnly = false } = {}) {
  const per = new Map();
  for (const c of clips) {
    for (const n of c.notes) {
      const a = c.start + n.t,
        b = Math.min(c.start + n.t + n.d, c.start + c.length);
      if (a >= c.start + c.length - 1e-9) continue;
      if (!per.has(n.p)) per.set(n.p, []);
      per.get(n.p).push(onsetsOnly ? [a, a] : [a, b]);
    }
  }
  const out = {};
  for (const [p, xs] of [...per].sort((x, y) => x[0] - y[0])) {
    xs.sort((x, y) => x[0] - y[0]);
    const m = [];
    for (const [a, b] of xs) {
      const l = m[m.length - 1];
      if (!onsetsOnly && l && a <= l[1] + 1e-6) l[1] = Math.max(l[1], b);
      else m.push([+a.toFixed(4), +b.toFixed(4)]);
    }
    out[p] = m.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]);
  }
  return JSON.stringify(out);
}
// What sounds in [a, b) of a song, moved to start at 0: per track, the notes' onsets and ends, and each audio clip's
// place and offset, so two stretches of two songs can be compared.
function stretch(p, a, b) {
  const out = {};
  for (const t of p.tracks) {
    const notes = [],
      audio = [];
    for (const c of t.clips) {
      if (c.start >= b - 1e-6 || c.start + c.length <= a + 1e-6) continue;
      if (c.kind === 'audio') {
        audio.push([+(c.start - a).toFixed(4), c.length, c.offset, c.asset]);
        continue;
      }
      for (const n of c.notes) {
        const x = c.start + n.t;
        if (x >= a - 1e-6 && x < b - 1e-6 && x < c.start + c.length - 1e-6)
          notes.push(`${n.p}@${+(x - a).toFixed(4)}:${+Math.min(n.d, c.start + c.length - x).toFixed(4)}`);
      }
    }
    out[t.name] = { notes: notes.sort().join(' '), audio: JSON.stringify(audio.sort()) };
  }
  return JSON.stringify(out);
}
test('section.move', () => {
  // the Chorus (16-32) before the Verse (0-16): the two swap; the Outro stays; the song keeps its length
  const { s, ids, T: tr, C } = song();
  const p0 = JSON.parse(JSON.stringify(s.get()));
  const sid = Object.fromEntries(p0.sections.map((x) => [x.name, x.id]));
  const r = roundTrip(
    s,
    { type: 'section.move', section: 'Chorus', before: 'Verse' },
    'claude',
    'move the Chorus before the Verse',
  );
  const p = s.get();
  const sec = Object.fromEntries(p.sections.map((x) => [x.name, [x.start, x.length, x.id]]));
  T.ok(
    JSON.stringify(sec) ===
      JSON.stringify({ Chorus: [0, 16, sid.Chorus], Verse: [16, 16, sid.Verse], Outro: [32, 8, sid.Outro] }),
    `the Chorus is first and the Verse after it, each keeping its id; the Outro stays (${JSON.stringify(sec)})`,
  );
  T.ok(
    stretch(p, 0, 16) === stretch(p0, 16, 32) &&
      stretch(p, 16, 32) === stretch(p0, 0, 16) &&
      stretch(p, 32, 40) === stretch(p0, 32, 40),
    "every track sounds in the Chorus's new bars as it did in its old ones, and the Verse's too",
  );
  T.ok(
    C(ids.ba).start === 0 &&
      C(ids.kb).start === 4 &&
      C(ids.ka).start === 16 &&
      C(ids.va).start === 20 &&
      near(C(ids.va).offset, 0.5),
    'the clips inside each keep their ids and move with it (the audio take its offset)',
  );
  const beat = tr('Drums').clips;
  T.ok(
    beat.length === 2 && beat.some((c) => c.id === ids.da) && beat.every((c) => c.length === 16),
    `the Beat across the Verse's end is split there first, each half going with its part (${beat.map((c) => `${c.start}+${c.length}`).join(', ')})`,
  );
  T.ok(
    p.loop.start === 0 && p.loop.end === 16 && p.loop.on,
    `the loop over the Chorus goes with it (${p.loop.start}-${p.loop.end})`,
  );
  T.ok(
    r.ok && s.history.at(-1).by === 'claude' && C(ids.ba).by === 'claude' && C(ids.ka).by === 'you',
    'one step, by whoever moved it; every clip keeps its author',
  );
  // the Verse to the end: the Chorus and the Outro close up behind it
  const { s: s2, ids: i2, C: C2 } = song();
  const q0 = JSON.parse(JSON.stringify(s2.get()));
  roundTrip(s2, { type: 'section.move', section: 'Verse', before: null }, 'you', 'move the Verse to the end');
  const q = s2.get();
  const sec2 = Object.fromEntries(q.sections.map((x) => [x.name, [x.start, x.length]]));
  T.ok(
    JSON.stringify(sec2) === JSON.stringify({ Chorus: [0, 16], Outro: [16, 8], Verse: [24, 16] }),
    `the Verse goes last (${JSON.stringify(sec2)})`,
  );
  T.ok(
    stretch(q, 0, 24) === stretch(q0, 16, 40) && stretch(q, 24, 40) === stretch(q0, 0, 16) && C2(i2.ka).start === 24,
    'what came after it sounds as it did, 16 beats earlier, and the Verse sounds as it did at the end',
  );
  T.ok(q.loop.start === 0 && q.loop.end === 16, 'the loop over the Chorus moves with the bars it is in');
  // an automation lane goes with its bars, and holds its values at every edge
  const { s: s3 } = song();
  s3.dispatch({ type: 'auto.write', track: 'Keys', param: 'gain', points: '0:-12 16:0 32:-6 40:-6' }, { by: 'you' });
  const lane0 = JSON.parse(JSON.stringify(s3.get().tracks.find((t) => t.name === 'Keys').auto.gain));
  roundTrip(
    s3,
    { type: 'section.move', section: 'Chorus', before: 'Verse' },
    'you',
    'move the Chorus with a gain lane under it',
  );
  const lane = s3.get().tracks.find((t) => t.name === 'Keys').auto.gain;
  const at = (l, b) => +valueAt(l.points, b).toFixed(3);
  T.ok(
    [0, 4, 8, 12].every((b) => at(lane, b) === at(lane0, b + 16)) &&
      [16, 20, 24, 28].every((b) => at(lane, b) === at(lane0, b - 16)) &&
      at(lane, 36) === at(lane0, 36),
    `the lane over the Chorus goes with it, and the Verse's after it (${lane.points.map((x) => `${x.t}:${x.v}`).join(' ')})`,
  );
  // a part's room entry is keyed by the section's id, so it stays the part's
  const { s: s4 } = song();
  const chorus = s4.get().sections.find((x) => x.name === 'Chorus').id;
  s4.dispatch({ type: 'room.part.set', section: chorus, patch: { feel: 'open', busy: 1 } }, { by: 'you' });
  roundTrip(
    s4,
    { type: 'section.move', section: chorus, before: null },
    'you',
    'move the Chorus, with its part, to the end',
  );
  T.ok(
    JSON.stringify(s4.get().room.parts) === JSON.stringify({ [chorus]: { feel: 'open', busy: 1 } }) &&
      s4.get().sections.at(-1).id === chorus,
    'its room.parts entry stays with it',
  );
  // a take folder across an edge: the takes go with their bars, as two folders
  const { s: s5 } = song();
  const keys = s5.get().tracks.find((t) => t.name === 'Keys').id;
  const tf = planTakeFolder(s5.get(), {
    track: keys,
    kind: 'notes',
    start: 8,
    end: 24,
    take: 'tk_move0001',
    passes: [
      {
        start: 8,
        end: 24,
        notes: [
          { p: 60, t: 8, d: 1, v: 0.8 },
          { p: 62, t: 20, d: 1, v: 0.8 },
        ],
      },
      { start: 8, end: 24, notes: [{ p: 64, t: 9, d: 1, v: 0.8 }] },
    ],
  });
  s5.dispatch(tf.ops, { by: 'you', label: 'rec' });
  const f0 = takeFolders(s5.get().tracks.find((t) => t.name === 'Keys'));
  roundTrip(
    s5,
    { type: 'section.move', section: 'Chorus', before: 'Verse' },
    'you',
    'move the Chorus with a take folder across its start',
  );
  const f1 = takeFolders(s5.get().tracks.find((t) => t.name === 'Keys'));
  T.ok(
    f0.length === 1 &&
      f1.length === 2 &&
      f1.every((f) => f.clips.length === f0[0].clips.length) &&
      f1.some((f) => f.start === 0 && f.end === 8) &&
      f1.some((f) => f.start === 24 && f.end === 32),
    `the folder over 8-24 becomes two, each with every take: the Chorus's 0-8, the Verse's 24-32 (${f1.map((f) => `${f.start}-${f.end}: ${f.clips.length}`).join(', ')})`,
  );
  // refused: a move that changes nothing, and bars a tempo map follows
  const no = (fn) => {
    try {
      fn();
      return '';
    } catch (e) {
      return e.message;
    }
  };
  const p6 = song().s.get();
  const same1 = no(() => planSectionMove(p6, { section: 'Verse', before: 'Chorus' })),
    same2 = no(() => planSectionMove(p6, { section: 'Outro', before: null }));
  T.ok(/there already/.test(same1) && /there already/.test(same2), `a move to where it is says so ("${same1}")`);
  const { s: s7 } = song();
  s7.dispatch(
    {
      type: 'tempo.map',
      map: {
        anchors: [
          { beat: 0, sec: 0 },
          { beat: 16, sec: 8.2 },
          { beat: 32, sec: 16.1 },
        ],
      },
    },
    { by: 'you' },
  );
  const tm = s7.dispatch({ type: 'section.move', section: 'Chorus', before: 'Verse' }, { by: 'you' });
  T.ok(
    !tm.ok && /follows a recording/.test(tm.error),
    `inside a tempo map it is refused, as a duplicate is ("${tm.error}")`,
  );
  // a pickup goes with the bars it leads into; landing on the song's first beat, what would come before it is trimmed
  // off first (a take's clip starts 30 ms before its part: the room moves parts to the top), whichever way the bars
  // get there, so the rest stays on the beat
  const pickup = () => {
    const x = song();
    const pk = x.s.dispatch(
      [
        {
          type: 'clip.add',
          track: 'Keys',
          ref: 'pk',
          clip: { start: 15.8, length: 1.2, name: 'Pickup', notes: 'G4@0:0.2 C5@0.2:1' },
        },
        {
          type: 'clip.add',
          track: 'Vox',
          ref: 'vk',
          clip: { kind: 'audio', asset: 'a_take01', start: 15.94, length: 8.06, offset: 2, name: 'Take 2' },
        },
      ],
      { by: 'you' },
    ).created;
    return { ...x, pk };
  };
  for (const [op, what] of [
    [{ type: 'section.move', section: 'Chorus', before: 'Verse' }, 'the Chorus to the top'],
    [{ type: 'section.move', section: 'Verse', before: null }, 'the Verse away from under the Chorus'],
  ]) {
    const { s: s8, C: C8, pk } = pickup();
    const r8 = roundTrip(s8, op, 'you', `move ${what}, with a pickup into the Chorus`);
    const k = C8(pk.pk),
      v = C8(pk.vk);
    T.ok(
      k.start === 0 &&
        k.length === 1 &&
        JSON.stringify(k.notes.map((n) => [n.t, n.d])) === '[[0,1]]' &&
        v.start === 0 &&
        near(v.length, 8) &&
        near(v.offset, 2 + 0.06 * 0.5) &&
        s8.get().sections.find((x) => x.name === 'Chorus').start === 0,
      `moving ${what}: the pickups are trimmed to start on the song's first beat, the note before it gone and the take's offset moved on 30 ms, the rest where it sounded (${k.start}+${k.length}, ${v.start}+${v.length} at ${v.offset}): "${r8.ok ? planSectionMove(pickup().s.get(), op).summary : ''}"`,
    );
  }
  {
    const { s: s8, C: C8, pk } = pickup();
    roundTrip(
      s8,
      { type: 'section.move', section: 'Chorus', before: null },
      'you',
      'move the Chorus, its pickups with it, to the end',
    );
    T.ok(
      C8(pk.pk).start === 23.8 && C8(pk.vk).start === 23.94 && C8(pk.pk).notes.length === 2,
      `elsewhere the pickups go with the Chorus whole, a hair before it (${C8(pk.pk).start}, ${C8(pk.vk).start})`,
    );
    const { s: s9 } = song();
    s9.dispatch(
      { type: 'clip.add', track: 'Keys', clip: { start: 15.8, length: 0.3, name: 'Sliver', notes: 'G4@0:0.2' } },
      { by: 'you' },
    );
    const p9 = canon(s9.get()),
      sl = s9.dispatch({ type: 'section.move', section: 'Chorus', before: 'Verse' }, { by: 'you' });
    T.ok(
      !sl.ok && /nearly all a pickup into Chorus/.test(sl.error) && canon(s9.get()) === p9,
      `a clip that is nearly all a pickup can't go to the top of the song, and nothing changes ("${sl.error}")`,
    );
  }
  T.ok(
    /^Moved Chorus \(4 bars\) before Verse/.test(
      planSectionMove(song().s.get(), { section: 'Chorus', before: 'Verse' }).summary,
    ),
    'its summary says what moved where: ' +
      planSectionMove(song().s.get(), { section: 'Chorus', before: 'Verse' }).summary,
  );
});

/* ------------------------------------------------------------------ clip.repeat */
test('clip.repeat', () => {
  const { s, ids, T: tr, C } = song();
  const r = roundTrip(
    s,
    { type: 'clip.repeat', track: 'Bass', clip: ids.ba, times: 4, ref: 'first' },
    'claude',
    'repeat the Walk ×4',
  );
  const bass = tr('Bass').clips;
  T.ok(
    bass.length === 4 &&
      bass.map((c) => c.start).join() === '16,32,48,64' &&
      bass.every((c) => formatNotes(c.notes) === formatNotes(C(ids.ba).notes) && c.length === 16),
    'three copies end to end, note for note',
  );
  T.ok(
    r.created.first === bass[1].id && bass.slice(1).every((c) => c.by === 'claude'),
    'new clips signed by whoever repeated it; ref names the first',
  );
  // loop: one clip, notes looped (a note past the end is cut at each pass)
  const { s: s2, ids: i2, C: C2 } = song();
  const before = C2(i2.kb);
  const n0 = before.notes.length;
  roundTrip(s2, { type: 'clip.repeat', track: 'Keys', clip: i2.kb, times: 2, mode: 'loop' }, 'you', 'loop the Stab ×2');
  const kb = C2(i2.kb);
  T.ok(kb.length === 16 && kb.notes.length === n0 * 2, `the Stab is 16 beats with its ${n0} notes twice`);
  T.ok(
    formatNotes(kb.notes) === 'C5@0:0.5 C5@3.5:1 E5@5:3 C5@8:0.5 C5@11.5:1 E5@13:3',
    `looped exactly: ${formatNotes(kb.notes)}`,
  );
  let threw = '';
  try {
    planClipRepeat(s2.get(), { clip: i2.va, mode: 'loop' });
  } catch (e) {
    threw = e.message;
  }
  T.ok(/audio clip/.test(threw), "an audio clip can't loop inside itself: " + threw);
  threw = '';
  try {
    planClipRepeat(s2.get(), { clip: i2.ka, times: 1 });
  } catch (e) {
    threw = e.message;
  }
  T.ok(/2 to 64/.test(threw), 'times must be 2 or more');
});

/* ------------------------------------------------------------------ ops in one transaction, atomically */
test('ops in one transaction, atomically', () => {
  const { s, ids, T: tr } = song();
  const r = s.dispatch(
    [
      { type: 'clip.add', track: 'Keys', ref: 'x', clip: { start: 40, length: 8, notes: 'C4@0:8' } },
      { type: 'clip.split', track: 'Keys', clip: '$x', at: 44, ref: 'y' },
      { type: 'notes.add', track: 'Keys', clip: '$y', notes: 'E4@1:1' },
    ],
    { by: 'claude', label: 'refs' },
  );
  T.ok(
    r.ok && r.created.y && tr('Keys').clips.find((c) => c.id === r.created.y).notes.length === 2,
    'clip.split takes a $ref clip and names its new half for later ops',
  );
  const before = canon(s.get());
  const bad = s.dispatch(
    [
      { type: 'time.insert', at: 0, length: 4 },
      { type: 'time.remove', at: 4, length: -1 },
    ],
    { by: 'you' },
  );
  T.ok(
    !bad.ok && /op 2 of 2/.test(bad.error) && canon(s.get()) === before,
    'a bad arrangement op rolls the whole transaction back: ' + (bad.error || '').slice(0, 80),
  );
  void ids;
});

/* ------------------------------------------------------------------ undo and revert never take someone else's later notes */
// Arrangement ops rewrite a clip's notes (notes.replace) and make new clips (clip.add); their inverses put the old
// notes back and remove the new clip. If anyone has edited those clips since, the inverse refuses (ops.js `_expect`):
// undo({ by }) fails and revertAuthor skips it, changing nothing, and both say why.
test('undo and revert never take someone elses edit', () => {
  const mk = () => {
    const s = createStore(createProject({ tempo: 120 }));
    const r = s.dispatch(
      [
        { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
        { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, length: 4, notes: 'C4@0:1 E4@1:1 G4@2:1' } },
      ],
      { by: 'you' },
    );
    return {
      s,
      t: r.created.k,
      c: r.created.c,
      mine: () =>
        s
          .get()
          .tracks.flatMap((x) =>
            x.clips.flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => c.start + n.t)),
          )
          .sort((a, b) => a - b),
    };
  };
  // (a) an agent loops your clip; you play into the longer clip; reverting the agent keeps your notes
  {
    const { s, t, c, mine } = mk();
    const before = canon(s.get());
    s.dispatch({ type: 'clip.repeat', track: t, clip: c, times: 2, mode: 'loop' }, { by: 'mcp:x' });
    s.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'A4@5:1 B4@6:1 D5@7:1' }, { by: 'you' });
    const n0 = mine().length,
      rv = s.revertAuthor('mcp:x');
    T.ok(
      !rv.ok &&
        rv.reverted === 0 &&
        rv.skipped.length === 1 &&
        /changed by you since/.test(rv.skipped[0].error) &&
        mine().length === n0 &&
        s.findClip(c).clip.length === 8,
      `(a) revert after a loop keeps your ${n0 - 3} later notes and says why: "${rv.skipped[0]?.error.slice(0, 110)}"`,
    );
    s.undo({ by: 'you' });
    const rv2 = s.revertAuthor('mcp:x');
    T.ok(
      rv2.ok && rv2.reverted === 1 && canon(s.get()) === before,
      '…and once your notes are undone, the revert goes through, exactly',
    );
  }
  // (b) Claude splits your clip; you add to both halves; Claude's undo refuses (the right half's removal included)
  {
    const { s, t, c, mine } = mk();
    const sp = s.dispatch({ type: 'clip.split', track: t, clip: c, at: 2, ref: 'r' }, { by: 'claude' });
    s.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'A4@0.5:0.5 B4@1.5:0.5' }, { by: 'you' });
    s.dispatch({ type: 'notes.add', track: t, clip: sp.created.r, notes: 'D5@1:0.5' }, { by: 'you' });
    const u = s.undo({ by: 'claude' });
    T.ok(
      !u.ok &&
        /changed by you since/.test(u.error) &&
        mine().length === 6 &&
        s.findClip(sp.created.r) &&
        s.canUndo('claude'),
      `(b) undo of a split refuses while you have notes in its halves, and stays undoable later: "${(u.error || '').slice(0, 120)}"`,
    );
  }
  // (c) an agent deletes a beat; you add a note; reverting the agent keeps it
  {
    const { s, t, c, mine } = mk();
    s.dispatch({ type: 'time.remove', at: 1, length: 1 }, { by: 'mcp:x' });
    s.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'A4@0.5:0.5' }, { by: 'you' });
    const rv = s.revertAuthor('mcp:x');
    T.ok(
      !rv.ok && rv.skipped.length === 1 && mine().includes(0.5),
      `(c) revert after time.remove keeps your note (${mine().join(', ')})`,
    );
  }
  // Claude inserts bars across your clip; you add to both halves; "Revert all Claude's changes (keep mine)" keeps both
  {
    const { s, t, c, mine } = mk();
    s.dispatch({ type: 'clip.set', track: t, clip: c, patch: { length: 16 } }, { by: 'you' });
    s.dispatch({ type: 'time.insert', at: 2, length: 4 }, { by: 'claude' });
    const right = s.get().tracks[0].clips.find((x) => x.id !== c);
    s.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'B4@1.5:0.5' }, { by: 'you' });
    s.dispatch({ type: 'notes.add', track: t, clip: right.id, notes: 'D5@3:0.5' }, { by: 'you' });
    const rv = s.revertAuthor('claude');
    T.ok(
      !rv.ok && rv.reverted === 0 && mine().includes(1.5) && mine().includes(9) && s.get().tracks[0].clips.length === 2,
      `revert after time.insert keeps your notes in both halves (${mine().join(', ')})`,
    );
  }
  // a plain clip.add (older than the arrangement ops): you play into an agent's clip; reverting the agent keeps it
  {
    const { s, t } = mk();
    const a = s.dispatch(
      { type: 'clip.add', track: t, clip: { start: 8, length: 4, notes: 'C4@0:1' } },
      { by: 'mcp:x' },
    );
    s.dispatch({ type: 'notes.add', track: t, clip: a.created.clip, notes: 'E4@1:1' }, { by: 'you' });
    const rv = s.revertAuthor('mcp:x');
    T.ok(
      !rv.ok && rv.skipped.length === 1 && s.findClip(a.created.clip)?.clip.notes.length === 2,
      `an agent's clip you've played into stays on revert: "${rv.skipped[0]?.error.slice(0, 100)}"`,
    );
    // and a track: an agent's track you've put a clip on stays too
    const tr2 = s.dispatch(
      { type: 'track.add', track: { name: 'Pad', instrument: { device: 'core.keys' } } },
      { by: 'mcp:y' },
    );
    s.dispatch(
      { type: 'clip.add', track: tr2.created.track, clip: { start: 0, length: 4, notes: 'C3@0:4' } },
      { by: 'you' },
    );
    const rv2 = s.revertAuthor('mcp:y');
    T.ok(
      !rv2.ok && s.track(tr2.created.track) && /put on track/.test(rv2.skipped[0]?.error || ''),
      `an agent's track you've added a clip to stays on revert: "${rv2.skipped[0]?.error.slice(0, 100)}"`,
    );
  }
  // the other way round: you split (the arranger's Undo toast is undo({ by: 'you' })), Claude writes into the right half
  {
    const { s, t, c } = mk();
    const sp = s.dispatch({ type: 'clip.split', track: t, clip: c, at: 2, ref: 'r' }, { by: 'you' });
    s.dispatch({ type: 'notes.add', track: t, clip: sp.created.r, notes: 'F4@1:0.5' }, { by: 'claude' });
    const u = s.undo({ by: 'you' });
    T.ok(
      !u.ok &&
        /changed by claude since/.test(u.error) &&
        s.findClip(sp.created.r).clip.notes.some((n) => n.by === 'claude'),
      `your undo of a split won't wipe Claude's notes in it: "${(u.error || '').slice(0, 100)}"`,
    );
  }
  // nobody touched it: reverting still works, and keeps your edits elsewhere
  {
    const { s, t, c } = mk();
    const o = s.dispatch({ type: 'clip.add', track: t, clip: { start: 8, length: 4, notes: 'C4@0:1' } }, { by: 'you' });
    s.dispatch({ type: 'clip.split', track: t, clip: c, at: 2 }, { by: 'claude' });
    s.dispatch({ type: 'notes.add', track: t, clip: o.created.clip, notes: 'E4@1:1' }, { by: 'you' });
    const rv = s.revertAuthor('claude');
    T.ok(
      rv.ok &&
        rv.reverted === 1 &&
        s.get().tracks[0].clips.length === 2 &&
        s.findClip(o.created.clip).clip.notes.length === 2,
      'a split nobody has touched since reverts cleanly, your edit to another clip kept',
    );
  }
  // a note an insert or split moved into a new clip: your undo of it says so and stays on the stack (it used to report
  // success and leave the note)
  for (const op of [
    { type: 'time.insert', at: 8, length: 4 },
    { type: 'clip.split', at: 8 },
  ]) {
    const { s, t, c } = mk();
    s.dispatch({ type: 'clip.set', track: t, clip: c, patch: { length: 16 } }, { by: 'you' });
    s.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'B4@10:1' }, { by: 'you', label: 'my note' });
    s.dispatch(op.type === 'clip.split' ? { ...op, track: t, clip: c } : op, { by: 'claude' });
    const h = s.history.length;
    const u = s.undo({ by: 'you' });
    const b4 = s.get().tracks[0].clips.some((x) => x.notes.some((n) => n.p === 71));
    T.ok(
      !u.ok &&
        /moved it to clip/.test(u.error) &&
        s.history.length === h &&
        b4 &&
        s.history.some((x) => x.label === 'my note'),
      `${op.type}: undoing a note it moved refuses and keeps the step: "${(u.error || '').slice(0, 110)}"`,
    );
  }
  {
    const { s, t, c } = mk();
    s.dispatch({ type: 'clip.set', track: t, clip: c, patch: { length: 16 } }, { by: 'you' });
    const add = s.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'B4@10:1' }, { by: 'claude' });
    s.dispatch(
      { type: 'notes.set', track: t, clip: c, notes: [{ id: add.created.notes[0], v: 0.4 }] },
      { by: 'you', label: 'softer' },
    );
    s.dispatch({ type: 'clip.split', track: t, clip: c, at: 8 }, { by: 'claude' });
    const u = s.undo({ by: 'you' });
    T.ok(
      !u.ok && /moved it to clip/.test(u.error),
      `an edit to a note a split moved refuses too: "${(u.error || '').slice(0, 90)}"`,
    );
  }
  // ties: clips and sections that share a start come back in the same order after an undo
  {
    const s = createStore(createProject());
    s.dispatch(
      [
        { type: 'section.add', section: { id: 's_b', name: 'B', start: 16, length: 4 } },
        { type: 'section.add', section: { id: 's_a', name: 'A', start: 16, length: 4 } },
        { type: 'track.add', ref: 'k', track: { name: 'K' } },
        { type: 'clip.add', track: '$k', clip: { id: 'c_b', start: 16, length: 4 } },
        { type: 'clip.add', track: '$k', clip: { id: 'c_a', start: 16, length: 4 } },
      ],
      { by: 'you' },
    );
    const before = canon(s.get());
    s.dispatch({ type: 'time.insert', at: 4, length: 4 }, { by: 'you' });
    s.undo();
    T.ok(
      canon(s.get()) === before &&
        s
          .get()
          .sections.map((x) => x.id)
          .join() === 's_a,s_b',
      'clips and sections that share a start keep their order through time.insert and its undo',
    );
  }
});

/* ------------------------------------------------------------------ limits: arrangement ops can't amplify a few bytes into millions of notes */
test('limits: arrangement ops cannot amplify', () => {
  // a 4-note, 1-bar clip; loop ×64 three times over would be 1,048,576 notes in one clip, a fourth runs out of memory
  const s = createStore(createProject({ title: 'L' }));
  const r0 = s.dispatch(
    [
      { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
      { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, length: 4, notes: 'C4@0:1 E4@1:1 G4@2:1 C5@3:1' } },
      { type: 'section.add', ref: 's', section: { name: 'A', start: 0, length: 4 } },
    ],
    { by: 'you' },
  );
  const clip = r0.created.c;
  const before = canon(s.get());
  const loops = (n, mode = 'loop') => Array(n).fill({ type: 'clip.repeat', clip, times: 64, mode });
  // (that both refusals come back quickly is wall clock, and is timed in tools/arrangement-test.js)
  const l3 = s.dispatch(loops(3), { by: 'mcp:x' });
  T.ok(
    !l3.ok && /a song runs up to beat 8,192/.test(l3.error) && /×32 fits/.test(l3.error) && canon(s.get()) === before,
    `loop ×64 three times in one call is refused, nothing changed: "${(l3.error || '').slice(0, 140)}"`,
  );
  const l4 = s.dispatch(loops(4), { by: 'mcp:x' });
  T.ok(!l4.ok && canon(s.get()) === before, 'four is refused the same way');
  // across calls: loop ×32 (128 beats), then ×64 on that (8,192 beats, the most a song runs), then even ×2 is refused
  T.ok(
    s.dispatch(
      loops(1).map((o) => ({ ...o, times: 32 })),
      { by: 'mcp:x' },
    ).ok && songSize(s.get()).notes === 128,
    'loop ×32 fits (128 notes, to beat 128)',
  );
  T.ok(
    s.dispatch(loops(1), { by: 'mcp:x' }).ok && songSize(s.get()).end === LIMITS.beats,
    'then ×64 on that runs exactly to beat 8,192',
  );
  const again = s.dispatch(
    loops(1).map((o) => ({ ...o, times: 2 })),
    { by: 'mcp:x' },
  );
  T.ok(
    !again.ok && /runs up to beat/.test(again.error),
    'and the next loop on top of it is refused (across calls, not just within one)',
  );
  s.undo();
  s.undo();
  T.ok(canon(s.get()) === before, '…two undos put it back');
  // notes per clip: a dense clip can't loop past 20,000 notes, and the error says how many times fits
  const dense = createStore(createProject({ title: 'D' }));
  const d0 = dense.dispatch(
    [
      { type: 'track.add', ref: 'k', track: { name: 'Hats', instrument: { device: 'core.keys' } } },
      {
        type: 'clip.add',
        track: '$k',
        ref: 'c',
        clip: {
          start: 0,
          length: 4,
          notes: Array.from({ length: 1000 }, (_, i) => ({ p: 60 + (i % 12), t: i * 0.004, d: 0.016 })),
        },
      },
    ],
    { by: 'you' },
  );
  let threw = '';
  try {
    planClipRepeat(dense.get(), { clip: d0.created.c, times: 21, mode: 'loop' });
  } catch (e) {
    threw = e.message;
  }
  T.ok(
    /a clip of 21,000 notes; a clip holds up to 20,000; ×20 fits/.test(threw),
    `the planner says what fits: "${threw}"`,
  );
  T.ok(
    planClipRepeat(dense.get(), { clip: d0.created.c, times: 20, mode: 'loop' }).ops.length === 2,
    'and ×20 (20,000 notes) plans',
  );
  // copies don't compound (each copies the clip as it is), but 63 copies of a 1,000-note clip pass the song's 50,000
  const dense0 = canon(dense.get());
  const cp = dense.dispatch({ type: 'clip.repeat', clip: d0.created.c, times: 64 }, { by: 'mcp:x' });
  T.ok(
    !cp.ok && /a song holds up to 50,000; ×50 fits/.test(cp.error) && canon(dense.get()) === dense0,
    `copies are held to the song's notes: "${(cp.error || '').slice(0, 140)}"`,
  );
  // section.duplicate onto itself doubles its clips each time: it stops at the clip limit, quickly, and rolls back
  const dup = s.dispatch(Array(16).fill({ type: 'section.duplicate', section: 'A', to: 0 }), { by: 'mcp:x' });
  T.ok(
    !dup.ok && /song holds up to 4,096/.test(dup.error) && canon(s.get()) === before,
    `16 self-duplicates (65,536 clips) stop at ${LIMITS.clips.toLocaleString('en-US')} clips and roll back: "${(dup.error || '').slice(0, 120)}"`,
  );
  // time.insert: no billion-beat songs
  const ins = s.dispatch({ type: 'time.insert', at: 0, length: 1e9 }, { by: 'mcp:x' });
  T.ok(
    !ins.ok && /runs up to beat 8,192/.test(ins.error) && canon(s.get()) === before,
    `time.insert of 1e9 beats is refused: "${(ins.error || '').slice(0, 100)}"`,
  );
  T.ok(s.dispatch({ type: 'time.insert', at: 0, length: 16 }, { by: 'you' }).ok, '…an ordinary insert still goes in');
  s.undo();
  // the backstop: any op that takes the song past a limit, primitives included, is refused by the store
  const set = s.dispatch({ type: 'clip.set', track: 'Keys', clip, patch: { start: 1e9 } }, { by: 'mcp:x' });
  T.ok(
    !set.ok && /song would run to beat/.test(set.error) && canon(s.get()) === before,
    `the store's backstop refuses a clip moved to beat 1e9: "${(set.error || '').slice(0, 100)}"`,
  );
  const many = s.dispatch(
    {
      type: 'notes.add',
      track: 'Keys',
      clip,
      notes: Array.from({ length: LIMITS.clipNotes }, (_, i) => ({ p: 60, t: i / 1000, d: 0.02 })),
    },
    { by: 'mcp:x' },
  );
  T.ok(
    !many.ok && /a clip holds up to 20,000/.test(many.error) && canon(s.get()) === before,
    `notes.add past 20,000 in a clip is refused: "${(many.error || '').slice(0, 100)}"`,
  );
  // a song already past a limit (an old file) still opens and can be edited down; undo isn't held to the limits
  const old = createProject({ title: 'O' });
  old.tracks.push({
    id: 't_old',
    name: 'Old',
    kind: 'instrument',
    instrument: { device: 'core.keys', params: {} },
    clips: [{ id: 'c_old', kind: 'notes', start: 0, length: 20000, notes: [{ p: 60, t: 0, d: 1 }] }],
    inserts: [],
  });
  const so = createStore(old);
  T.ok(
    so.get().tracks[0].clips[0].length === 20000 &&
      so.dispatch({ type: 'clip.set', track: 't_old', clip: 'c_old', patch: { length: 16000 } }, { by: 'you' }).ok &&
      so.undo().ok &&
      so.get().tracks[0].clips[0].length === 20000,
    'a song already past the length limit opens, shrinks, and undo puts it back',
  );
  T.ok(
    !so.dispatch({ type: 'clip.set', track: 't_old', clip: 'c_old', patch: { length: 20004 } }, { by: 'you' }).ok,
    "…but it can't grow",
  );
});

/* ------------------------------------------------------------------ comping a take folder (Ableton 11 / Logic take lanes) */
// Two passes over the Chorus (beats 16–32) on Keys, as the recorder folds them (planTakeFolder): what played (Stab),
// Take 2 and Take 3 (playing). Then bar 7 (beats 24–28) is comped from Take 2, put back, split, deleted, flattened.
test('comping a take folder', () => {
  const { s, T: tr } = song();
  const keys = tr('Keys');
  const P1 = [
    { p: 60, t: 16, d: 1, v: 0.8 },
    { p: 67, t: 23, d: 2, v: 0.7 },
    { p: 60, t: 26, d: 1, v: 0.8 },
    { p: 62, t: 30, d: 1, v: 0.8 },
  ];
  const P2 = [
    { p: 64, t: 16, d: 1, v: 0.9 },
    { p: 65, t: 25, d: 1, v: 0.9 },
    { p: 64, t: 29, d: 1, v: 0.9 },
  ];
  const tf = planTakeFolder(s.get(), {
    track: keys.id,
    kind: 'notes',
    start: 16,
    end: 32,
    take: 'tk_comp0001',
    passes: [
      { start: 16, end: 32, notes: P1 },
      { start: 16, end: 32, notes: P2 },
    ],
  });
  T.ok(s.dispatch(tf.ops, { by: 'you', label: 'two passes' }).ok, 'two passes over the Chorus make a take folder');
  const F = () => takeFolders(tr('Keys')).find((f) => f.id === 'tk_comp0001');
  const f0 = F();
  T.ok(
    f0.lanes.length === 3 &&
      f0.lanes.map((l) => l.name).join() === 'Stab,Take 2,Take 3' &&
      f0.cuts.join() === '16,32' &&
      f0.comp.map((x) => x.lane).join() === '2',
    `its lanes: one per take (${f0.lanes.map((l) => l.name).join(', ')}), one stretch, Take 3 plays`,
  );
  const lane0 = f0.lanes.map((l) => JSON.parse(JSON.stringify(l.clips[0]))); // (as they were: the store edits its song in place)
  const heardLane = lane0.map((c) => sounding([c]));
  // what a stretch of a clip sounds: its notes from a to b (a pitched note ringing in keeps its tail)
  const part = (c, a, b) => ({
    start: a,
    length: b - a,
    notes: c.notes
      .map((n) => ({ ...n, t: c.start + n.t - a }))
      .filter((n) => n.t < b - a && n.t + n.d > 0)
      .map((n) => (n.t < 0 ? { ...n, t: 0, d: n.d + n.t } : n)),
  });
  const playing = () => tr('Keys').clips.filter((c) => c.take === 'tk_comp0001' && !c.mute);

  // comp: Take 2 for bar 7
  const plan = planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 1, start: 24, end: 28 });
  T.ok(
    /^Take 2 plays 7\.1–8\.1 on Keys\.$/.test(plan.summary) &&
      plan.ops.every((o) => /^(clip\.(set|add|remove)|notes\.replace)$/.test(o.type)),
    `a comp is splits and mutes, planned in the core ("${plan.summary}")`,
  );
  roundTrip(s, plan.ops, 'you', 'comp Take 2 into bar 7');
  const f1 = F();
  T.ok(
    f1.cuts.join() === '16,24,28,32' &&
      f1.comp.map((x) => x.lane).join() === '2,1,2' &&
      f1.lanes.every((l) => l.clips.length === 3),
    `after it the folder is cut at bar 7 and its end: Take 3, Take 2, Take 3 (${f1.comp.map((x) => f1.lanes[x.lane].name).join(', ')})`,
  );
  T.ok(
    f1.comp.every(
      (x) =>
        tr('Keys').clips.filter(
          (c) => c.take === 'tk_comp0001' && !c.mute && c.start < x.end - 1e-6 && c.start + c.length > x.start + 1e-6,
        ).length === 1,
    ),
    'in each stretch exactly one take plays',
  );
  const want = sounding([part(lane0[2], 16, 24), part(lane0[1], 24, 28), part(lane0[2], 28, 32)]);
  T.ok(
    sounding(playing()) === want,
    'what plays is Take 3, then Take 2 for bar 7 (its G4 from bar 6 sounding on from the cut), then Take 3, note for note',
  );
  T.ok(
    f1.lanes.every((l, i) => sounding(l.clips) === heardLane[i]),
    'every lane still holds its whole take: a note across a cut keeps its sounding part on each side',
  );
  T.ok(
    f1.lanes.every((l) => l.clips.every((c) => c.name === l.name && c.by === lane0[f1.lanes.indexOf(l)].by)),
    "the pieces keep their take's name and who played it",
  );
  const again = planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 1, start: 24.1, end: 27.9 });
  T.ok(
    !again.ops.length && /already/.test(again.summary),
    `comping what already plays changes nothing (and ends a hair off a cut go to it): "${again.summary}"`,
  );
  // ⌘↑ in one stretch is a comp of that stretch too; taking it back to Take 3 joins the cuts up again
  roundTrip(
    s,
    planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 2, start: 24, end: 28 }).ops,
    'you',
    'comp Take 3 back into bar 7',
  );
  const f2 = F();
  T.ok(
    f2.cuts.join() === '16,32' &&
      f2.lanes.every((l) => l.clips.length === 1) &&
      f2.lanes.every((l, i) => sounding(l.clips) === heardLane[i]) &&
      f2.comp[0].lane === 2,
    'putting Take 3 back over bar 7 joins every lane up again: one clip each, every note as it was',
  );
  T.ok(
    f2.lanes.every((l, i) => l.clips[0].id === lane0[i].id),
    'and the lanes are the same clips (ids kept)',
  );

  // a comp by its clip, the whole folder (a take's menu): one clip.set mute pair
  const whole = planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: lane0[0].id });
  T.ok(
    whole.ops.length === 2 &&
      whole.ops.every((o) => o.type === 'clip.set') &&
      /^Stab plays all of the folder/.test(whole.summary),
    `a whole take: just a mute pair ("${whole.summary}")`,
  );
  T.ok(
    (() => {
      try {
        planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 1, start: 20, end: 20.1 });
        return false;
      } catch (e) {
        return /at least 0.25 beats/.test(e.message);
      }
    })(),
    'a comp thinner than a quarter beat is refused, saying why',
  );

  // comp again, then split at the playhead across all takes: both halves stay folders
  s.dispatch(planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 1, start: 24, end: 28 }).ops, {
    by: 'you',
    label: 'comp',
  });
  const sp = roundTrip(
    s,
    { type: 'clip.split', track: keys.id, clip: playing()[0].id, at: 20, ref: 'r' },
    'you',
    'split the folder at bar 6',
  );
  const fs = takeFolders(tr('Keys'));
  const L = fs.find((f) => f.id === 'tk_comp0001'),
    R = fs.find((f) => f.id !== 'tk_comp0001' && f.start === 20);
  T.ok(
    sp.ok &&
      L &&
      R &&
      L.start === 16 &&
      L.end === 20 &&
      R.start === 20 &&
      R.end === 32 &&
      L.lanes.length === 3 &&
      R.lanes.length === 3,
    `Split at the playhead splits every take: two folders, beats 16–20 and 20–32, 3 takes each (${fs.map((f) => `${f.start}–${f.end}: ${f.lanes.length}`).join('; ')})`,
  );
  T.ok(
    L.comp.map((x) => x.lane).join() === '2' &&
      R.comp.map((x) => x.lane).join() === '2,1,2' &&
      s.findClip(sp.created.r)?.clip.take === R.id,
    'each half keeps its comp, and the new half (named by ref) is in the right-hand folder',
  );
  T.ok(
    sounding(playing().concat(tr('Keys').clips.filter((c) => c.take === R.id && !c.mute))) === want,
    'and the song sounds as it did',
  );
  // split again exactly at a comp cut: nothing to cut, the right-hand pieces just change folder
  const sp2 = planClipSplit(s.get(), { track: keys.id, clip: R.comp[1].clip.id, at: 24.05 });
  T.ok(
    sp2.ops.every((o) => o.type === 'clip.set' && o.patch.take) && /both halves keep their takes/.test(sp2.summary),
    `a split near a comp's cut goes to the cut: ${sp2.ops.length} clips change folder, none is cut ("${sp2.summary}")`,
  );
  s.undo();
  s.undo();

  // delete the take that plays round bar 7's sides: where it played, the newest take left plays
  s.dispatch(planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 2 }).ops, {
    by: 'you',
    label: 'all Take 3',
  });
  s.dispatch(planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 1, start: 24, end: 28 }).ops, {
    by: 'you',
    label: 'comp',
  });
  const del = planTakeLaneDelete(s.get(), { track: keys.id, clip: F().lanes[2].clips[0].id });
  roundTrip(s, del.ops, 'you', 'delete Take 3 from the comp');
  const fd = F();
  T.ok(
    fd.lanes.length === 2 &&
      fd.comp.length === 1 &&
      fd.lanes[fd.comp[0].lane].name === 'Take 2' &&
      fd.lanes.every((l) => l.clips.length === 1) &&
      /^Deleted Take 3; Take 2 plays/.test(del.summary),
    `deleting Take 3: its lane goes, Take 2 plays where it did and the cuts join up ("${del.summary}")`,
  );
  s.undo();
  const fl = planTakesFlatten(s.get(), { track: keys.id, clip: F().lanes[1].clips[0].id });
  roundTrip(s, fl.ops, 'you', 'flatten the comp');
  const left = tr('Keys').clips.filter((c) => c.start >= 16 && c.start < 32);
  T.ok(
    !left.some((c) => c.take || c.mute) &&
      left.length === 1 &&
      left[0].start === 16 &&
      left[0].length === 16 &&
      sounding(left) === want &&
      /^Flattened the comp into one clip: Take 3 and Take 2 as they played/.test(fl.summary),
    `Flatten merges the comp into one ordinary clip, as Ableton's Flatten does: it sounds as the comp did; what didn't play goes ("${fl.summary}"; ${left.length} clip)`,
  );
  T.ok(
    !left[0].name &&
      new Set(left[0].notes.filter((n) => n.id != null).map((n) => n.id)).size ===
        left[0].notes.filter((n) => n.id != null).length,
    "the merged clip goes by its track's name (it is no one take), and no note id is in it twice",
  );
  s.undo();
  // comp edges where you let go: a note ringing over one is cut there, and the summary says so (FRESH-EYES-4, producer 5)
  {
    const cp = planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 0, start: 16, end: 23.5 });
    T.ok(
      cp.start === 16 && cp.end === 23.5 && cp.cut === 0 && /^Stab plays 5\.1–6\.4\.3 on Keys\.$/.test(cp.summary),
      `a comp's edges stay where they were asked for, said in bar.beat ("${cp.summary}")`,
    );
    const cq = planTakeComp(s.get(), { track: keys.id, take: 'tk_comp0001', lane: 1, start: 16, end: 23.5 });
    const bb = [[0], [16], [17], [22.5], [23.25], [20.125], [31.99]].map(([b]) => barBeat(s.get(), b));
    T.ok(
      bb.join() === '1.1,5.1,5.2,6.3.3,6.4.2,6.1.1.5,8.4.4.96' &&
        barBeatSpan(s.get(), 16, 20) === '5.1–6.1' &&
        barBeat({ meter: [3, 4] }, 3) === '2.1',
      `positions are bar.beat, as a DAW counts them: ${bb.join(' ')}`,
    );
    T.ok(
      cq.end === 23.5 &&
        cq.cut === 1 &&
        /^Take 2 plays 5\.1–6\.4\.3 on Keys, 1 note cut at 6\.4\.3\.$/.test(cq.summary),
      `Take 2's G4 from 6.4 rings over the edge at 6.4.3: cut there, and said ("${cq.summary}")`,
    );
  }

  // trimming a piece of a comp leaves the folder's other pieces alone
  const mid = F().comp[1].clip;
  const tp = planClipTrim(s.get(), { track: keys.id, clip: mid.id, start: 24, end: 26 });
  T.ok(!tp.ops.some((o) => o.type === 'clip.remove'), 'trimming one piece of a comp removes none of the other pieces');
  // recording over the comped range again: the new pass joins the folder as Take 4 and plays
  const tf2 = planTakeFolder(s.get(), {
    track: keys.id,
    kind: 'notes',
    start: 16,
    end: 32,
    take: 'tk_comp0002',
    passes: [{ start: 16, end: 32, notes: [{ p: 72, t: 18, d: 1, v: 0.8 }] }],
  });
  roundTrip(s, tf2.ops, 'you', 'a third pass over the comped Chorus');
  const f4 = F();
  T.ok(
    tf2.group === 'tk_comp0001' &&
      f4.lanes.length === 4 &&
      f4.lanes[3].name === 'Take 4' &&
      f4.comp.every((x) => x.lane === 3) &&
      tf2.active.name === 'Take 4',
    `a pass over a comped folder joins it as Take 4 and plays (${f4.lanes.map((l) => l.name).join(', ')})`,
  );
  // a muted clip split stays muted on both sides
  const m = s.dispatch(
    [{ type: 'clip.set', track: tr('Keys').id, clip: tr('Keys').clips[0].id, patch: { mute: true } }],
    { by: 'you' },
  );
  const ms = planClipSplit(s.get(), { track: keys.id, clip: tr('Keys').clips[0].id, at: 8 });
  T.ok(
    m.ok && ms.ops.find((o) => o.type === 'clip.add')?.clip.mute === true,
    'a muted clip split keeps both halves muted',
  );
});

/* ------------------------------------------------------------------ take folders through the other edits (fixes) */
test('take folders through the other edits', () => {
  const A = (id) => ({
    type: 'asset.add',
    asset: { id, kind: 'audio', name: id, sr: 48000, channels: 1, duration: 60 },
  });
  const mk = (ops) => {
    const s = createStore(createProject({ title: 'F', tempo: 120 }));
    const r = s.dispatch(ops, { by: 'you', label: 'setup' });
    return { s, ids: r.created };
  };
  const trk = (s, i = 0) => s.get().tracks[i];
  const plays = (t, a, b) => t.clips.filter((c) => !c.mute && c.start < b - 1e-6 && c.start + c.length > a + 1e-6);

  // 1. what played over a range was two recordings side by side: a comp never makes them one clip
  {
    const { s } = mk([
      { type: 'track.add', track: { name: 'Vox', kind: 'audio' } },
      A('a_aaaa0001'),
      A('a_bbbb0002'),
      A('a_cccc0003'),
    ]);
    const tid = trk(s).id;
    const rec = (start, end, take, asset) =>
      s.dispatch(
        planTakeFolder(s.get(), {
          track: tid,
          kind: 'audio',
          start,
          end,
          take,
          passes: [{ start, end, audio: { asset, offset: 2 } }],
        }).ops,
        { by: 'you', label: 'rec' },
      );
    rec(0, 8, 'tk_aaaa0001', 'a_aaaa0001');
    rec(8, 16, 'tk_bbbb0002', 'a_bbbb0002');
    rec(0, 16, 'tk_cccc0003', 'a_cccc0003');
    const f = takeFolders(trk(s)).find((x) => x.start === 0 && x.end === 16);
    roundTrip(
      s,
      planTakeComp(s.get(), { track: tid, take: f.id, lane: 0 }).ops,
      'you',
      'What played over the whole folder',
    );
    const wp = trk(s)
      .clips.filter((c) => c.name === 'What played')
      .map((c) => `${c.start}-${c.start + c.length}:${c.asset}@${c.offset}${c.mute ? 'M' : ''}`)
      .join(' ');
    T.ok(
      wp === '0-8:a_aaaa0001@2 8-16:a_bbbb0002@2',
      `a comp keeps two recordings side by side as two clips, each playing its own file (${wp})`,
    );
    // a take cut by a comp is one recording: putting it back joins it up again
    roundTrip(
      s,
      planTakeComp(s.get(), { track: tid, take: f.id, lane: 1, start: 4, end: 12 }).ops,
      'you',
      'Take 3 over bars 2–3',
    );
    roundTrip(s, planTakeComp(s.get(), { track: tid, take: f.id, lane: 1 }).ops, 'you', 'Take 3 over the whole folder');
    const t3 = trk(s).clips.filter((c) => c.name === 'Take 3');
    const wp2 = trk(s)
      .clips.filter((c) => c.name === 'What played')
      .map((c) => `${c.start}-${c.start + c.length}:${c.asset}@${c.offset}`)
      .join(' ');
    T.ok(
      t3.length === 1 &&
        t3[0].start === 0 &&
        t3[0].length === 16 &&
        t3[0].offset === 2 &&
        wp2 === '0-8:a_aaaa0001@2 8-16:a_bbbb0002@2',
      `…while a recording a comp cut joins up again (Take 3: ${t3.map((c) => `${c.start}+${c.length}@${c.offset}`).join(', ')}; What played: ${wp2})`,
    );
  }

  // 4. a comp and back never fuses a repeated note at the cut, and a note the cut split is one note again
  {
    const { s } = mk([{ type: 'track.add', track: { name: 'Bass', instrument: { device: 'core.bass' } } }]);
    const tid = trk(s).id;
    const quarters = Array.from({ length: 16 }, (_, i) => ({ p: 40, t: 16 + i, d: 1, v: 0.8 }));
    s.dispatch(
      planTakeFolder(s.get(), {
        track: tid,
        kind: 'notes',
        start: 16,
        end: 32,
        take: 'tk_bass0001',
        passes: [
          { start: 16, end: 32, notes: [{ p: 43, t: 16, d: 6, v: 0.8 }] },
          { start: 16, end: 32, notes: quarters },
        ],
      }).ops,
      { by: 'you', label: 'rec' },
    );
    const lane = (name) =>
      trk(s)
        .clips.filter((c) => c.name === name)
        .sort((a, b) => a.start - b.start);
    const before = lane('Take 2')[0]
      .notes.map((n) => `${n.id}:${n.t}/${n.d}`)
      .join(' ');
    roundTrip(
      s,
      planTakeComp(s.get(), { track: tid, take: 'tk_bass0001', lane: 0, start: 20, end: 24 }).ops,
      'you',
      'Take 1 in bar 6',
    );
    roundTrip(
      s,
      planTakeComp(s.get(), { track: tid, take: 'tk_bass0001', lane: 1 }).ops,
      'you',
      'Take 2 back over the folder',
    );
    const t2 = lane('Take 2'),
      t1 = lane('Take 1');
    T.ok(
      t2.length === 1 && t2[0].notes.length === 16 && t2[0].notes.every((n, i) => n.t === i && n.d === 1),
      `16 repeated quarters come back as 16, none fused at the cuts (${t2[0].notes.map((n) => `${n.t}/${n.d}`).join(' ')})`,
    );
    T.ok(t2[0].notes.map((n) => `${n.id}:${n.t}/${n.d}`).join(' ') === before, 'and with the ids they had');
    T.ok(
      t1.length === 1 && t1[0].notes.length === 1 && t1[0].notes[0].d === 6,
      `a held note the cut at beat 20 split is one 6-beat note again (${JSON.stringify(t1.map((c) => c.notes.map((n) => [n.t, n.d])))})`,
    );
    // a repeated note in the muted lane, across two cuts in a row, and a delete of the lane that plays
    roundTrip(
      s,
      planTakeComp(s.get(), { track: tid, take: 'tk_bass0001', lane: 0, start: 20, end: 24 }).ops,
      'you',
      'Take 1 in bar 6 again',
    );
    roundTrip(
      s,
      planTakeComp(s.get(), { track: tid, take: 'tk_bass0001', lane: 0, start: 24, end: 28 }).ops,
      'you',
      'and bar 7',
    );
    roundTrip(s, planTakeLaneDelete(s.get(), { track: tid, clip: lane('Take 1')[0].id }).ops, 'you', 'Delete Take 1');
    T.ok(
      lane('Take 2').length === 1 && lane('Take 2')[0].notes.length === 16,
      `extending a comp and deleting a take leave Take 2's 16 quarters as 16 (${lane('Take 2')
        .map((c) => c.notes.length)
        .join('+')})`,
    );
  }

  // 2. copies of takes leave the source's folder: a duplicated verse is a folder of its own, a repeat an ordinary clip
  {
    const { s } = mk([
      { type: 'section.add', section: { name: 'Verse', start: 0, length: 16 } },
      { type: 'track.add', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
      { type: 'track.add', track: { name: 'Vox', kind: 'audio' } },
      A('a_aaaa0001'),
    ]);
    const keys = trk(s).id,
      vox = trk(s, 1).id;
    s.dispatch(
      planTakeFolder(s.get(), {
        track: keys,
        kind: 'notes',
        start: 0,
        end: 16,
        take: 'tk_dupe0001',
        passes: [
          { start: 0, end: 16, notes: [{ p: 60, t: 0, d: 1 }] },
          { start: 0, end: 16, notes: [{ p: 64, t: 2, d: 1 }] },
        ],
      }).ops,
      { by: 'you', label: 'rec' },
    );
    s.dispatch(
      planTakeFolder(s.get(), {
        track: vox,
        kind: 'audio',
        start: 0,
        end: 16,
        take: 'tk_dupe0002',
        passes: [
          { start: 0, end: 16, audio: { asset: 'a_aaaa0001', offset: 0 } },
          { start: 0, end: 16, audio: { asset: 'a_aaaa0001', offset: 8 } },
        ],
      }).ops,
      { by: 'you', label: 'rec' },
    );
    roundTrip(s, planSectionDuplicate(s.get(), { section: 'Verse' }).ops, 'you', 'duplicate the recorded Verse');
    const fk = takeFolders(trk(s)),
      fv = takeFolders(trk(s, 1));
    T.ok(
      fk.length === 2 &&
        fv.length === 2 &&
        fk.every((f) => f.lanes.length === 2) &&
        fk.map((f) => `${f.start}-${f.end}`).join() === '0-16,16-32' &&
        fk[0].id === 'tk_dupe0001' &&
        fk[1].id !== 'tk_dupe0001',
      `a duplicated verse's takes are a folder of their own (${fk.map((f) => `${f.id} ${f.start}-${f.end}`).join('; ')})`,
    );
    roundTrip(
      s,
      planTakeLaneDelete(s.get(), { track: keys, clip: fk[0].lanes[1].clips[0].id }).ops,
      'you',
      'Delete Take 2 in the first verse',
    );
    const copy = takeFolders(trk(s)).find((f) => f.start === 16);
    T.ok(
      copy &&
        copy.lanes.length === 2 &&
        plays(trk(s), 16, 32).length === 1 &&
        plays(trk(s), 16, 32)[0].name === 'Take 2',
      "deleting a take in the first verse leaves the copy's takes as they were",
    );
    s.undo();
    roundTrip(
      s,
      planTakeComp(s.get(), { track: vox, take: 'tk_dupe0002', lane: 0, start: 0, end: 8 }).ops,
      'you',
      'comp Take 1 into bars 1–2 of the first verse',
    );
    const cv = trk(s, 1)
      .clips.filter((c) => c.start >= 16)
      .map((c) => `${c.name} ${c.start}-${c.start + c.length}@${c.offset}${c.mute ? 'M' : ''}`)
      .sort()
      .join(', ');
    T.ok(
      cv === 'Take 1 16-32@0M, Take 2 16-32@8',
      `an audio comp in the first verse leaves the copied verse's recording where it was (${cv})`,
    );
    const rp = planClipRepeat(s.get(), { track: keys, clip: fk[0].playing.id, times: 3 });
    T.ok(
      rp.ops.filter((o) => o.type === 'clip.add').every((o) => !o.clip.take),
      'repeating a take makes ordinary clips, not more pieces of its folder',
    );
    const lone = retake([{ take: 'tk_dupe0001', mute: true }]),
      two = retake([{ take: 'tk_dupe0001' }, { take: 'tk_dupe0001' }, { take: 'tk_other01' }]);
    T.ok(
      !('take' in lone[0]) &&
        lone[0].mute &&
        two[0].take === two[1].take &&
        two[0].take !== 'tk_dupe0001' &&
        !('take' in two[2]),
      "retake: a lone copy of a take is an ordinary clip; copies of one folder's takes share a new folder",
    );
  }

  // 3 and 7. deleting or inserting bars across a take folder keeps the takes in folders, one playing
  {
    const { s } = mk([
      { type: 'track.add', track: { name: 'Vox', kind: 'audio' } },
      A('a_aaaa0001'),
      { type: 'track.add', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
    ]);
    const vox = trk(s).id,
      keys = trk(s, 1).id;
    s.dispatch(
      planTakeFolder(s.get(), {
        track: vox,
        kind: 'audio',
        start: 0,
        end: 16,
        take: 'tk_cuts0001',
        passes: [0, 8, 16].map((o) => ({ start: 0, end: 16, audio: { asset: 'a_aaaa0001', offset: o } })),
      }).ops,
      { by: 'you', label: 'rec' },
    );
    s.dispatch(
      planTakeFolder(s.get(), {
        track: keys,
        kind: 'notes',
        start: 0,
        end: 16,
        take: 'tk_cuts0002',
        passes: [60, 62, 64].map((p) => ({
          start: 0,
          end: 16,
          notes: [
            { p, t: 1, d: 1 },
            { p, t: 10, d: 1 },
          ],
        })),
      }).ops,
      { by: 'you', label: 'rec' },
    );
    const rm = planTimeRemove(s.get(), { at: 4, length: 4 });
    roundTrip(s, rm.ops, 'you', 'delete bar 2 across the take folders');
    const v = trk(s);
    T.ok(
      plays(v, 4, 12).length === 1 &&
        plays(v, 4, 12)[0].name === 'Take 3' &&
        v.clips.every((c) => c.take === 'tk_cuts0001'),
      `after deleting bar 2, one take plays on (${plays(v, 4, 12)
        .map((c) => c.name)
        .join(', ')}), every piece still in the folder`,
    );
    const fr = takeFolders(v)[0];
    T.ok(
      fr.start === 0 && fr.end === 12 && fr.lanes.length === 3 && fr.lanes.every((l) => l.clips.length === 2),
      `the folder closes up around the cut: 0–12, 3 takes of 2 pieces (${fr.lanes.map((l) => l.clips.length).join(',')})`,
    );
    roundTrip(
      s,
      planTakeComp(s.get(), { track: vox, take: 'tk_cuts0001', lane: 0 }).ops,
      'you',
      'Take 1 over the closed-up folder',
    );
    const t1 = trk(s)
      .clips.filter((c) => c.name === 'Take 1')
      .map((c) => `${c.start}-${c.start + c.length}@${c.offset}`)
      .join(' ');
    T.ok(t1 === '0-4@0 4-12@4', `…and a comp over it keeps the deleted bar deleted (Take 1: ${t1})`);
    s.undo();
    s.undo();
    const ins = planTimeInsert(s.get(), { at: 8, length: 4 });
    roundTrip(s, ins.ops, 'you', 'insert a bar inside the take folders');
    for (const [i, tk] of [
      [0, 'tk_cuts0001'],
      [1, 'tk_cuts0002'],
    ]) {
      const fs = takeFolders(trk(s, i));
      T.ok(
        fs.length === 2 &&
          fs.map((f) => `${f.start}-${f.end}:${f.lanes.length}`).join() === '0-8:3,12-20:3' &&
          fs[0].id === tk &&
          fs.every((f) => f.comp.every((x) => f.lanes[x.lane]?.name === 'Take 3')),
        `inserting a bar splits the ${trk(s, i).name} folder as Split does: ${fs.map((f) => `${f.start}-${f.end}, ${f.lanes.length} takes`).join('; ')}`,
      );
    }
    T.ok(
      trk(s, 1).clips.every((c) => c.take),
      'no take is left a stray clip after the new bar',
    );
  }

  // 5 and 6. a take shortened then grown back takes what it freed back; an audio start stops where its file does
  {
    const { s } = mk([
      { type: 'track.add', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
      { type: 'track.add', track: { name: 'Vox', kind: 'audio' } },
      A('a_aaaa0001'),
    ]);
    const keys = trk(s).id,
      vox = trk(s, 1).id;
    s.dispatch(
      {
        type: 'clip.add',
        track: keys,
        clip: { start: 16, length: 16, name: 'Chords', notes: 'C4@0:4 F4@4:4 G4@8:4 C4@12:4' },
      },
      { by: 'you', label: 'chords' },
    );
    s.dispatch(
      planTakeFolder(s.get(), {
        track: keys,
        kind: 'notes',
        start: 16,
        end: 32,
        take: 'tk_trim0001',
        passes: [{ start: 16, end: 32, notes: [16, 20, 24, 28].map((t) => ({ p: 72, t, d: 4 })) }],
      }).ops,
      { by: 'you', label: 'rec' },
    );
    const take = () => trk(s).clips.find((c) => c.name === 'Take 2');
    roundTrip(
      s,
      planClipTrim(s.get(), { track: keys, clip: take().id, end: 24 }).ops,
      'you',
      'shorten the take to bar 7',
    );
    T.ok(
      plays(trk(s), 24, 32)
        .map((c) => c.name)
        .join() === 'Chords',
      'shortened, the chords play again after it',
    );
    const back = planClipTrim(s.get(), { track: keys, clip: take().id, end: 32 });
    roundTrip(s, back.ops, 'you', 'drag it back to bar 9');
    const f = takeFolders(trk(s))[0];
    T.ok(
      plays(trk(s), 24, 32)
        .map((c) => c.name)
        .join() === 'Take 2' &&
        f.start === 16 &&
        f.end === 32 &&
        f.comp.every((x) => f.lanes[x.lane].name === 'Take 2') &&
        f.lanes.map((l) => l.name).join() === 'Chords,Take 2',
      `grown back, only the take plays there; the chords are back in its folder, muted ("${back.summary}")`,
    );
    T.ok(
      sounding(plays(trk(s), 16, 32)) ===
        sounding([{ start: 16, length: 16, notes: [0, 4, 8, 12].map((t) => ({ p: 72, t, d: 4 })) }]),
      'and it sounds as the take did before the two drags',
    );
    // an audio clip at offset 0 (a recorder's first take): its start can't be dragged before the recording starts
    s.dispatch(
      {
        type: 'clip.add',
        track: vox,
        clip: { kind: 'audio', asset: 'a_aaaa0001', start: 8, length: 8, offset: 0, name: 'Line' },
      },
      { by: 'you', label: 'line' },
    );
    const line = () => trk(s, 1).clips.find((c) => c.name === 'Line');
    const t0 = planClipTrim(s.get(), { track: vox, clip: line().id, start: 4, end: 16 });
    T.ok(
      !t0.ops.length,
      'dragging the start of a recording at offset 0 earlier changes nothing: the file starts there',
    );
    s.dispatch({ type: 'clip.set', track: vox, clip: line().id, patch: { offset: 1 } }, { by: 'you', label: 'off' });
    const t1 = planClipTrim(s.get(), { track: vox, clip: line().id, start: 4, end: 16 });
    roundTrip(s, t1.ops, 'you', 'drag the start out past where the file starts');
    T.ok(
      line().start === 6 && line().offset === 0 && line().length === 10,
      `at offset 1 s it opens 2 beats earlier and stops there, still on the beat (start ${line().start}, offset ${line().offset})`,
    );
  }
});

/* ------------------------------------------------------------------ a clip dropped on another (FRESH-EYES round 5) */
// A clip dropped onto another on the same track left both playing (21 notes where 10 belong). A dropped clip takes the
// beats it covers: what lies under it on that track is cut away there, in the same undo step, as Live does; a take
// folder under it is cut across all its takes, as Split cuts one (the part after is a folder of its own).
test('a clip dropped on another', () => {
  const { s, ids, T: tr, C } = song();
  const keys = tr('Keys').id,
    drums = tr('Drums').id;
  // what plays on a track between two beats: [{ p, at }] note onsets in [a, b) from its unmuted clips
  const onsets = (t, a, b) =>
    tr(t)
      .clips.filter((c) => !c.mute)
      .flatMap((c) =>
        c.notes.filter((n) => n.t < c.length - 1e-9).map((n) => ({ p: n.p, at: +(c.start + n.t).toFixed(4) })),
      )
      .filter((x) => x.at >= a - 1e-9 && x.at < b - 1e-9)
      .sort((x, y) => x.at - y.at || x.p - y.p);
  const stab = JSON.parse(JSON.stringify(C(ids.kb))),
    chords = JSON.parse(JSON.stringify(C(ids.ka)));
  // 1. Stab (8 beats, 3 notes) dropped at the start of Chords (16 beats, 7 notes): Chords keeps 8–16, Stab plays 0–8
  const drop = (ops0, drops, keep) => ops0.concat(planDropTrim(s.get(), drops, { keep }).ops);
  const p1 = planDropTrim(s.get(), [{ track: keys, start: 0, end: 8 }], { keep: [ids.kb] });
  T.ok(
    p1.cut === 1 &&
      p1.removed === 0 &&
      /^Under it on Keys: Chords cut where it landed\.$/.test(p1.summary) &&
      !p1.ops.some((o) => o.clip === ids.kb),
    `planDropTrim cuts what's under the drop and never the dropped clip ("${p1.summary}")`,
  );
  roundTrip(
    s,
    drop([{ type: 'clip.move', track: keys, clip: ids.kb, start: 0 }], [{ track: keys, start: 0, end: 8 }], [ids.kb]),
    'you',
    'Stab dropped on the start of Chords',
  );
  const under = onsets('Keys', 0, 8),
    after = onsets('Keys', 8, 16);
  const want1 = stab.notes.map((n) => ({ p: n.p, at: n.t })).sort((x, y) => x.at - y.at || x.p - y.p);
  T.ok(
    JSON.stringify(under) === JSON.stringify(want1) && C(ids.ka).start === 8 && C(ids.ka).length === 8,
    `under the dropped clip only it plays: ${under.length} notes in bars 1–2 (Stab's ${stab.notes.length}, where both used to: ${stab.notes.length + chords.notes.filter((n) => n.t < 8).length}); Chords plays on from bar 3`,
  );
  T.ok(
    JSON.stringify(after.map((x) => x.p)) === JSON.stringify(chords.notes.filter((n) => n.t >= 8).map((n) => n.p)) &&
      !C(ids.ka).notes.some((n) => n.t < 0),
    "what Chords played after it is as it was; a chord ringing into the drop isn't struck again after it",
  );
  s.undo();
  // 2. dropped into the middle of a clip: it is cut in two around it; covered whole, it goes; too short a leftover goes
  const p2 = planDropTrim(s.get(), [{ track: drums, start: 8, end: 12 }]);
  roundTrip(s, p2.ops, 'you', 'a drop in the middle of Beat');
  const beat = tr('Drums').clips;
  T.ok(
    beat.length === 2 &&
      beat[0].start === 0 &&
      beat[0].length === 8 &&
      beat[1].start === 12 &&
      beat[1].length === 20 &&
      !onsets('Drums', 8, 12).length &&
      beat[1].name === 'Beat' &&
      beat[1].by === 'you',
    `in the middle: two pieces around it, 0–8 and 12–32, nothing between (${beat.map((c) => `${c.start}+${c.length}`).join(', ')})`,
  );
  s.undo();
  const p3 = planDropTrim(s.get(), [
    { track: keys, start: 18, end: 30 },
    { track: keys, start: 0, end: 15.9 },
  ]);
  T.ok(
    p3.removed === 2 &&
      p3.ops.filter((o) => o.type === 'clip.remove').length === 2 &&
      /Chords and Stab gone, covered whole/.test(p3.summary),
    `covered whole it goes, and a sliver under a quarter beat left over goes with it ("${p3.summary}")`,
  );
  // 3. a muted clip is cut too, and audio keeps its place in the file
  s.dispatch({ type: 'clip.set', track: keys, clip: ids.kb, patch: { mute: true } }, { by: 'you', label: 'mute' });
  const p4 = planDropTrim(s.get(), [
    { track: keys, start: 22, end: 24 },
    { track: tr('Vox').id, start: 6, end: 8 },
  ]);
  roundTrip(s, p4.ops, 'you', 'a drop over a muted clip and an audio one');
  const vox = tr('Vox').clips;
  T.ok(
    tr('Keys')
      .clips.filter((c) => c.name === 'Stab')
      .every((c) => c.mute) &&
      tr('Keys').clips.filter((c) => c.name === 'Stab').length === 2 &&
      vox.length === 2 &&
      vox[1].start === 8 &&
      near(vox[1].offset, 0.5 + 4 * 0.5),
    `a muted clip is cut too (both pieces muted); audio cut at beat 8 plays on from its file at ${vox[1]?.offset} s`,
  );
  s.undo();
  s.undo();
  // 4. a take folder under it: every take is cut, the part after is a folder of its own, one take still plays in each
  // stretch, and the song sounds as it did outside the drop
  const P1 = [
    { p: 60, t: 16, d: 1, v: 0.8 },
    { p: 67, t: 23, d: 2, v: 0.7 },
    { p: 60, t: 26, d: 1, v: 0.8 },
  ];
  const P2 = [
    { p: 64, t: 16, d: 1, v: 0.9 },
    { p: 65, t: 25, d: 1, v: 0.9 },
    { p: 64, t: 29, d: 1, v: 0.9 },
  ];
  s.dispatch(
    planTakeFolder(s.get(), {
      track: keys,
      kind: 'notes',
      start: 16,
      end: 32,
      take: 'tk_drop0001',
      passes: [
        { start: 16, end: 32, notes: P1 },
        { start: 16, end: 32, notes: P2 },
      ],
    }).ops,
    { by: 'you', label: 'two passes' },
  );
  s.dispatch(planTakeComp(s.get(), { track: keys, take: 'tk_drop0001', lane: 1, start: 24, end: 28 }).ops, {
    by: 'you',
    label: 'comp',
  });
  const heard0 = (a, b) => onsets('Keys', a, b);
  const outside = JSON.stringify([...heard0(16, 20), ...heard0(24, 32)]);
  const pf = planDropTrim(s.get(), [{ track: keys, start: 20, end: 24 }]);
  roundTrip(s, pf.ops, 'you', 'a drop over a comped take folder');
  const fs = takeFolders(tr('Keys')),
    L = fs.find((f) => f.id === 'tk_drop0001'),
    R = fs.find((f) => f.id !== 'tk_drop0001');
  T.ok(
    pf.folders === 1 &&
      L &&
      R &&
      L.start === 16 &&
      L.end === 20 &&
      R.start === 24 &&
      R.end === 32 &&
      L.lanes.length === 3 &&
      R.lanes.length === 3 &&
      pf.sides.tk_drop0001?.[0] === R.id,
    `the folder is cut across all its takes: 16–20 keeps it, 24–32 is a folder of its own, 3 takes each (${fs.map((f) => `${f.start}–${f.end}: ${f.lanes.length}`).join('; ')})`,
  );
  T.ok(
    [L, R].every((f) =>
      f.comp.every(
        (x) =>
          tr('Keys').clips.filter(
            (c) => c.take === f.id && !c.mute && c.start < x.end - 1e-6 && c.start + c.length > x.start + 1e-6,
          ).length === 1,
      ),
    ) &&
      !heard0(20, 24).length &&
      JSON.stringify([...heard0(16, 20), ...heard0(24, 32)]) === outside,
    'one take plays in each stretch of both, nothing plays under the drop, and the rest sounds as it did',
  );
  // covered whole, a folder goes, every take of it
  const pw = planDropTrim(s.get(), [{ track: keys, start: 16, end: 32 }]);
  T.ok(
    pw.ops.filter((o) => o.type === 'clip.remove').length === tr('Keys').clips.filter((c) => c.start >= 16).length &&
      pw.folders === 2,
    'a drop over all of a folder takes every take in it',
  );
});
