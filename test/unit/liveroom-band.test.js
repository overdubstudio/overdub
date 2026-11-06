// The band (docs/research/LIVE-ROOM-MODE.md §11.2, §11.3), what takes under a second, moved from
// tools/liveroom/checks-band.js, which keeps the read's fixtures, the pair, the amp and the levels (seconds of Node, or
// a page): every feel and fill exists; the velocity house rules; the band's notes on a read, and planLearn and planFeel
// in a store; the double's chain, pans and pan lane; the prototype's band.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import {
  PLACES,
  RIGS,
  rigChain,
  FEEL_GROOVES,
  FEELS,
  FILLS,
  feelsOf,
  grooveOf,
  fillsOf,
  guitarChain,
  setupOf,
} from '../../app/src/core/liveroom/places.js';
import { bandFor, bandNotes, planLearn, planFeel, HOUSE_RULES, MUTE_V } from '../../app/src/core/liveroom/band.js';
import { planDouble, planUseAsRight, planPans } from '../../app/src/core/liveroom/double.js';
import { readTake } from '../../app/src/core/liveroom/read.js';
import { realize, getGroove, library, familyOf } from '../../app/src/core/grooves.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { riffDI, riffOf, SR } from '../../tools/liveroom/fake.js';
import { fixtureRiff, bareSong } from '../../tools/liveroom/band-scene.js';

const EPS = 1e-6;
// [beat, midi, held beats (0: a palm-muted chug)]
const RIFFS = {
  metal: {
    place: 'metal',
    bpm: 132,
    beats: 8,
    root: 4,
    chord: true,
    notes: [
      [0, 40],
      [0.25, 40],
      [0.75, 40],
      [1, 43, 0.5],
      [1.5, 40],
      [2, 40],
      [2.25, 40],
      [2.75, 40],
      [3, 45, 0.5],
      [3.5, 40],
      [4, 40],
      [4.25, 40],
      [4.75, 40],
      [5, 43, 0.5],
      [5.5, 40],
      [6, 46, 0.5],
      [6.5, 45, 0.5],
      [7, 43, 1],
    ],
  },
  boogie: {
    place: 'bluesbar',
    bpm: 96,
    beats: 4,
    root: 4,
    chord: false,
    notes: [
      [0, 40, 0.6],
      [2 / 3, 44, 0.3],
      [1, 47, 0.6],
      [5 / 3, 49, 0.3],
      [2, 50, 0.6],
      [8 / 3, 49, 0.3],
      [3, 47, 0.6],
      [11 / 3, 44, 0.3],
    ],
  },
};

test('feels and fills', async () => {
  const T = checks();
  {
    const missing = [],
      used = [];
    for (const [place, feels] of Object.entries(FEEL_GROOVES)) {
      const P = PLACES[place];
      for (const [feel, ids] of Object.entries(feels)) {
        for (const id of ids) if (!getGroove(id)) missing.push(`${place} ${feel}: ${id}`);
        // the tempos it's offered at: every part list that names it, across the place's range in 10s
        for (let t = P.tempo[0]; t <= P.tempo[1]; t += 10) {
          const parts = Object.entries(FEELS[place])
            .filter(([, fs]) => fs.includes(feel))
            .map(([k]) => k);
          const offered =
            parts.some((k) => feelsOf(place, k, t).includes(feel)) ||
            (feel === 'blast' || feel === 'dbeat' ? t >= 180 : false) ||
            (feel === 'slow' ? t < 80 : false);
          if (!offered) continue;
          const g = grooveOf(place, feel, t),
            G = g && getGroove(g);
          if (!G || t < G.tempo[0] - EPS || t > G.tempo[1] + EPS)
            missing.push(`${place} ${feel} at ${t}: ${g || 'none'}`);
          else used.push(g);
        }
      }
      for (const k of Object.keys(FEELS[place]))
        if (k !== 'outro' && !feelsOf(place, k, P.prefer).length) missing.push(`${place} ${k}: no feel at ${P.prefer}`);
    }
    T.ok(
      !missing.length,
      `every feel resolves to a groove in its bank at the tempos it's offered (${new Set(used).size} grooves across the three places)${missing.length ? ': ' + missing.slice(0, 6).join('; ') : ''}`,
    );
    const fills = Object.entries(FILLS).flatMap(([k, f]) => Object.entries(f).map(([w, id]) => [k, w, id]));
    const bad = fills.filter(([, , id]) => !getGroove(id));
    T.ok(
      !bad.length,
      `every place's fills and ending exist (${fills.length}: ${Object.keys(FILLS).join(', ')})${bad.length ? ': missing ' + bad.map((x) => x.join(' ')).join('; ') : ''}`,
    );
    T.ok(
      fillsOf('metal', 180).one === FILLS.metalFast.one && fillsOf('metal', 132).one === FILLS.metal.one,
      `the metal club's fills from the metal bank over 160 (${fillsOf('metal', 180).one}) and the modern one under (${fillsOf('metal', 132).one})`,
    );
  }

  T.done();
});

test('the house rules', async () => {
  const T = checks();
  {
    const ids = library().grooves.map((g) => g.id);
    let worstRun = 0,
      worstId = '',
      ghostsBad = [],
      ghostN = 0,
      same = 0,
      hatsVaried = 0,
      hatsN = 0,
      n = 0;
    for (const id of ids) {
      const g = getGroove(id),
        tempo = Math.round((g.tempo[0] + g.tempo[1]) / 2),
        len = Math.max(g.length, 8);
      const plain = realize(id, { tempo, seed: 5, length: len }),
        band = realize(id, { tempo, seed: 5, length: len, rules: 'band' });
      const again = realize(id, { tempo, seed: 5, length: len });
      if (JSON.stringify(plain) === JSON.stringify(again)) same++;
      n++;
      // runs at full: consecutive hits (in time) at 1
      let run = 0;
      for (const x of band) {
        run = x.v >= 0.999 ? run + 1 : 0;
        if (run > worstRun) {
          worstRun = run;
          worstId = id;
        }
      }
      // the ghosts as written (o and g), found by piece and place in the loop
      const ghosts = g.hits.filter((h) => h.v <= 0.45 + EPS);
      for (const x of band) {
        const L = g.length,
          isG = ghosts.some(
            (h) =>
              h.p === x.p &&
              Math.min(Math.abs((((x.t - h.t) % L) + L) % L), L - Math.abs((((x.t - h.t) % L) + L) % L)) < 0.06,
          );
        if (!isG) continue;
        ghostN++;
        if (x.v < 0.15 - EPS || x.v > 0.4 + EPS) ghostsBad.push(`${id} ${x.p}@${x.t} ${x.v}`);
      }
      const hats = band.filter((x) => familyOf(x.p) === 'hat'),
        base = plain.filter((x) => familyOf(x.p) === 'hat');
      hatsN += hats.length;
      hats.forEach((x, i) => {
        if (base[i] && Math.abs(x.v - Math.min(0.95, base[i].v)) > 0.01) hatsVaried++;
      });
    }
    T.ok(
      worstRun <= 4,
      `no run of more than four hits at full velocity in any groove under the band's rules (longest ${worstRun}${worstId ? ', ' + worstId : ''}, ${n} grooves)`,
    );
    T.ok(
      !ghostsBad.length && ghostN > 0,
      `ghost notes (written o or g) play between 0.15 and 0.4 (${ghostN} of them${ghostsBad.length ? '; out: ' + ghostsBad.slice(0, 4).join(', ') : ''})`,
    );
    T.ok(
      hatsN > 0 && hatsVaried / hatsN > 0.8,
      `the hats vary, seeded (${hatsVaried} of ${hatsN} moved from the plain groove)`,
    );
    const blast = realize('extreme/traditional-blast', { tempo: 200, seed: 3, length: 8, rules: 'band' }).filter(
      (x) => familyOf(x.p) === 'snare',
    );
    T.ok(
      blast.length > 8 && blast.every((x) => x.v >= 0.85 - EPS && x.v <= 0.9 + EPS),
      `a blast's snare sits at 0.85 to 0.9 (${Math.min(...blast.map((x) => x.v))} to ${Math.max(...blast.map((x) => x.v))}, ${blast.length} hits)`,
    );
    const fill = realize('modernmetal/kick-and-snare-flurry', { tempo: 132, seed: 3, rules: 'band' });
    T.ok(
      fill[0].v === 1 && fill.slice(1).every((x) => x.v <= 0.95),
      `a fill's first hit is full and the rest under it (${fill[0].v}, then at most ${Math.max(...fill.slice(1).map((x) => x.v))})`,
    );
    T.ok(
      same === n,
      `realize without rules is as it was: the same notes for the same seed (${same} of ${n}; the golden hashes hold it to the sample, tools/golden-test.js)`,
    );
  }

  T.done();
});

test('the band', async () => {
  const T = checks();
  {
    // a read as read.js gives one, on the metal club's chug at 132 in drop C, its chugs a few ms off the grid
    const R = fixtureRiff('chug', 36),
      bpm = 132,
      spb = 60 / bpm;
    const { buf } = riffDI(R, { passes: 1, bpm, seed: 21, jitter: 0.01, tail: 0.5 });
    const read = readTake(buf, SR, { tempo: bpm, start: 0, bars: 8, grid: 4, place: 'metal' });
    const p = bareSong('metal', bpm);
    const b = bandNotes(p, 's_a', { feel: 'chugs', riff: read, seed: 's_a:chugs:x' });
    const kicks = b.drums.filter((x) => x.p === 36),
      chugsAt = new Set(read.chugs.map((c) => c.t));
    const far = kicks.filter((k) => {
      const c = read.chugs.find((q) => Math.abs(q.t - k.t) < 0.06);
      return !c || Math.abs((k.t - c.t) * spb * 1000 - Math.max(-15, Math.min(15, c.ms))) > 0.6;
    });
    T.ok(
      kicks.length === chugsAt.size && !far.length,
      `Your chugs: a kick on each of the read's ${chugsAt.size} chugs, where it was picked (within ${HOUSE_RULES.kickMs} ms of its grid point; ${kicks.length} kicks${far.length ? `, ${far.length} placed wrong` : ''})`,
    );
    const bass = b.bass;
    const rootsOk = bass.filter((x) => {
      const r = read.roots[Math.floor(Math.round(x.t * 4) / 4 + EPS)];
      return r != null && x.p % 12 === r;
    }).length;
    T.ok(
      bass.length > 0 &&
        bass.every((x) => x.p >= HOUSE_RULES.bassLo && x.p <= HOUSE_RULES.bassHi) &&
        rootsOk === bass.length,
      `the bass on the kick's places, on the read's roots (${rootsOk} of ${bass.length}), in B0-B2 (MIDI ${Math.min(...bass.map((x) => x.p))}-${Math.max(...bass.map((x) => x.p))}: drop C's C1 fits)`,
    );
    const simpler = bandNotes(p, 's_a', { feel: 'chugs', busy: -1, riff: read, seed: 's_a:chugs:x' }),
      busier = bandNotes(p, 's_a', { feel: 'chugs', busy: 1, riff: read, seed: 's_a:chugs:x' });
    const sk = simpler.drums.filter((x) => x.p === 36).length,
      bg = busier.drums.filter((x) => x.p === 38 && x.v < 0.45).length;
    T.ok(
      sk < kicks.length / 2 && simpler.fills.length === 0 && busier.fills.length >= 1 && bg > 0,
      `Simpler: the kick on the accents and each beat's first chug (${sk} of ${kicks.length}), no fills; Busier: ${busier.fills.length} fill${busier.fills.length === 1 ? '' : 's'} in 8 bars and ${bg} ghost notes on the snare`,
    );
    T.ok(
      JSON.stringify(bandNotes(p, 's_a', { feel: 'chugs', riff: read, seed: 's_a:chugs:x' })) === JSON.stringify(b),
      'the same read and seed give the same band (no Math.random)',
    );
    // a fast part: the bass simpler (eighths over 150, quarters over 190)
    for (const tempo of [160, 200]) {
      const q = bareSong('metal', tempo),
        bb = bandNotes(q, 's_a', { feel: 'chugs', riff: read, seed: 'fast' }).bass;
      const grain = tempo > 190 ? 1 : 0.5,
        off = bb.filter(
          (x) => Math.abs(Math.round(x.t * 4) / 4 / grain - Math.round(Math.round(x.t * 4) / 4 / grain)) > EPS,
        );
      const runs = off.filter((x) => bb.some((o) => o.t < x.t - EPS && x.t - o.t < grain + EPS));
      T.ok(
        !runs.length && bb.length > 0,
        `at ${tempo} the bass plays ${tempo > 190 ? 'quarters' : 'eighths'} through the runs (${bb.length} notes, ${runs.length} inside a run off the ${tempo > 190 ? 'quarter' : 'eighth'})`,
      );
    }
    // the End, and into a breakdown with its drop on
    const end = bandNotes(
      { ...bareSong('metal', 132, { name: 'End', length: 4 }), key: { root: 'C', scale: 'minor' } },
      's_a',
      { riff: read },
    );
    T.ok(
      end.groove === FILLS.metal.ending &&
        end.drums.some((x) => x.p === 49 && x.t === 0) &&
        end.bass.length === 1 &&
        end.bass[0].p % 12 === 0,
      `the End plays ${end.groove} and the bass the root once (${end.bass.map((x) => x.p).join(', ')})`,
    );
    const into = bareSong('metal', 132, { next: 'Breakdown' });
    into.room.parts = { s_b: { drop: true } };
    const bd = bandNotes(into, 's_a', { feel: 'chugs', riff: read, seed: 'drop' });
    T.ok(
      bd.fills.some((f) => f.groove === FILLS.metal.drop) && !bd.drums.some((x) => x.t >= 31 - EPS),
      `into a breakdown with its drop on: ${FILLS.metal.drop}, then a beat of silence (last hit at beat ${Math.max(...bd.drums.map((x) => x.t))})`,
    );
    const ch = bandNotes(bareSong('metal', 132, { next: 'Chorus' }), 's_a', { feel: 'chugs', riff: read, seed: 'up' });
    T.ok(
      ch.fills.length === 1 &&
        ch.fills[0].to === 32 &&
        ch.fills[0].to - ch.fills[0].from === getGroove(FILLS.metal.bar).length,
      `into a chorus, a bar going up (${ch.fills.map((f) => `${f.groove} ${f.from}-${f.to}`).join(', ')})`,
    );
    // a thin read: a clean arpeggio of six notes
    const arp = {
      bpm: 132,
      beats: 8,
      chord: false,
      notes: [
        [0, 48, 1.4],
        [1.5, 52, 1.4],
        [3, 55, 0.9],
        [4, 60, 1.4],
        [5.5, 55, 1.4],
        [7, 52, 0.9],
      ],
    };
    const thin = readTake(riffDI(arp, { passes: 1, seed: 3, jitter: 0.004, tail: 0.5 }).buf, SR, {
      tempo: 132,
      start: 0,
      bars: 2,
      grid: 4,
      place: 'metal',
    });
    const tb = bandNotes(bareSong('metal', 132, { length: 8 }), 's_a', { feel: 'chugs', riff: thin, seed: 'thin' });
    const own = realize(getGroove(grooveOf('metal', 'chugs', 132)).id, {
      tempo: 132,
      seed: 'thin',
      length: 8,
      rules: 'band',
    }).filter((x) => x.p === 36 || x.p === 35).length;
    T.ok(
      thin.thin &&
        tb.kicks === 0 &&
        tb.drums.filter((x) => x.p === 36 || x.p === 35).length >= own &&
        tb.bass.length === 0,
      `a thin read (${thin.notes.length} notes on the grid, a clean arpeggio) says so: the kick keeps the groove's own pattern (${tb.drums.filter((x) => x.p === 36 || x.p === 35).length} kicks) and the bass waits`,
    );
    // planLearn and planFeel in a store: one dispatch each, the house's own clips only
    const S = setupOf('metal', { tuning: 'drop-c' }),
      st = createStore(createProject({ tempo: 132 }), { getDevice });
    const ops = [],
      map = {};
    for (const t of S.tracks) {
      if (t.later) continue;
      const { role, later, ...track } = t;
      ops.push({ type: 'track.add', track: { ...track, id: `t_${role}` } });
      map[role] = `t_${role}`;
    }
    ops.push(
      { type: 'section.add', section: { id: 's_v', name: 'Verse', start: 0, length: 32 } },
      {
        type: 'asset.add',
        asset: { id: 'a_l', kind: 'audio', name: 'DI', sr: SR, channels: 1, duration: buf.length / SR },
      },
    );
    ops.push(
      {
        type: 'clip.add',
        track: 't_guitarL',
        clip: { id: 'c_l', kind: 'audio', asset: 'a_l', start: 0, length: 32, offset: 0, by: 'you' },
      },
      { type: 'room.set', patch: { place: 'metal', tuning: 'drop-c', tracks: map } },
    );
    let r = st.dispatch(ops, { by: 'overdub' });
    const learn = planLearn(st.get(), { section: 's_v', read });
    r = r.ok ? st.dispatch(learn.ops, { by: 'overdub', label: learn.label }) : r;
    const q1 = st.get(),
      on = (role) => q1.tracks.find((t) => t.id === map[role])?.clips || [];
    T.ok(
      r.ok &&
        learn.label === 'The band learned the verse' &&
        learn.reason === 'room:learn:s_v' &&
        on('drums').length === 1 &&
        on('bass').length === 1 &&
        on('heard').length === 1 &&
        q1.room.parts.s_v.learned.from === 'c_l',
      `planLearn lands in one dispatch: the drums, the bass and the riff as heard (${on('heard')[0]?.notes.length} notes) on the part, learned from c_l (${r.ok ? learn.label : r.error})`,
    );
    const heardRhythm = on('heard')[0]?.notes.filter((x) => x.v < MUTE_V).length || 0,
      unpitched = read.notes.filter((x) => x.p == null).length;
    T.ok(
      heardRhythm === unpitched && unpitched > 0,
      `the palm mutes go on Riff (as heard) as DI Box plays a palm mute, under ${MUTE_V} (${heardRhythm} of the read's ${unpitched}), so the part reads back the same`,
    );
    const before = JSON.stringify(on('drums')[0].notes.map(({ id, ...x }) => x));
    const f = planFeel(st.get(), { section: 's_v', feel: 'chugs' });
    r = st.dispatch(f.ops, { by: 'you' });
    T.ok(
      r.ok &&
        JSON.stringify(
          st
            .get()
            .tracks.find((t) => t.id === 't_drums')
            .clips[0].notes.map(({ id, ...x }) => x),
        ) === before,
      'choosing the learned feel again plays the same band: the part reads back from its Riff (as heard) clip as it was learned',
    );
    // an edited drum clip is yours: the house leaves it
    const dc = st.get().tracks.find((t) => t.id === 't_drums').clips[0];
    st.dispatch([{ type: 'notes.set', track: 't_drums', clip: dc.id, notes: [{ id: dc.notes[0].id, v: 0.5 }] }], {
      by: 'you',
    });
    const f2 = planFeel(st.get(), { section: 's_v', feel: 'gallop' }),
      l2 = planLearn(st.get(), { section: 's_v', read });
    const drumsTouched = l2.ops.some((o) => o.track === 't_drums');
    T.ok(
      f2.edited === true && f2.ops.length === 0 && !drumsTouched && l2.kept?.drums === true,
      `a drum clip you changed is yours: another feel asks first (edited), and re-learning leaves it (${l2.ops.map((o) => o.type).join(', ')})`,
    );
  }

  T.done();
});

test('the double', async () => {
  const T = checks();
  {
    const WANT = { modern: [0, 2], djent: [1, 3], thrash: [2, 0], hardrock: [0, 2], crunch: [0, 2], edge: [0, 2] };
    const cabs = Object.keys(RIGS).map((id) => {
      const l = rigChain(id, 'L')[0].params.cab,
        r = rigChain(id, 'R')[0].params.cab;
      return { id, l, r, ok: l === WANT[id][0] && r === WANT[id][1] };
    });
    T.ok(
      cabs.every((c) => c.ok),
      `the right side's cab, one mic over on the same cab: ${cabs.map((c) => `${RIGS[c.id].name} ${c.l} -> ${c.r}`).join(', ')}`,
    );
    const S = setupOf('metal', { tuning: 'b-standard' }),
      st = createStore(createProject({ tempo: 132 }), { getDevice });
    const ops = [],
      map = {};
    for (const t of S.tracks) {
      if (t.later) continue;
      const { role, later, ...track } = t;
      ops.push({ type: 'track.add', track: { ...track, id: `t_${role}` } });
      map[role] = `t_${role}`;
    }
    ops.push(
      { type: 'section.add', section: { id: 's_i', name: 'Intro', start: 0, length: 16 } },
      { type: 'section.add', section: { id: 's_v', name: 'Verse', start: 16, length: 32 } },
      { type: 'section.add', section: { id: 's_c', name: 'Chorus', start: 48, length: 32 } },
    );
    ops.push({ type: 'asset.add', asset: { id: 'a_x', kind: 'audio', name: 'DI', sr: SR, channels: 1, duration: 60 } });
    for (const [s, len, id] of [
      [0, 16, 'c_i'],
      [16, 32, 'c_v1'],
      [16, 32, 'c_v2'],
      [48, 32, 'c_c'],
    ])
      ops.push({
        type: 'clip.add',
        track: 't_guitarL',
        clip: {
          id,
          kind: 'audio',
          asset: 'a_x',
          start: s,
          length: len,
          offset: 0,
          by: 'you',
          ...(id === 'c_v1' ? { mute: true } : {}),
        },
      });
    ops.push(
      { type: 'room.set', patch: { place: 'metal', rig: 'modern', tuning: 'b-standard', tracks: map } },
      { type: 'room.part.set', section: 's_i', patch: { oneSide: true } },
    );
    let r = st.dispatch(ops, { by: 'overdub' });
    const d = planDouble(st.get(), { section: 's_v' });
    r = r.ok ? st.dispatch(d.ops, { by: 'overdub' }) : r;
    let q = st.get();
    const R = q.tracks.find((t) => t.name === 'Guitar R'),
      L = q.tracks.find((t) => t.id === 't_guitarL');
    const want = guitarChain('modern', 'R', 'b-standard');
    T.ok(
      r.ok &&
        R &&
        R.arm &&
        !L.arm &&
        R.pan === 1 &&
        JSON.stringify(R.inserts.map((x) => [x.device, x.params])) ===
          JSON.stringify(want.map((x) => [x.device, x.params])) &&
        R.inserts[1].params.b1_freq === 80 &&
        q.room.tracks.guitarR === R.id,
      `planDouble: Guitar R made, armed, hard right, the left's chain with the cab one mic over (${R?.inserts.map((x) => x.device + (x.params.cab != null ? ' cab ' + x.params.cab : x.params.b1_freq ? ' low cut ' + x.params.b1_freq : '')).join(', ')}) (${r.ok ? d.label : r.error})`,
    );
    const lane0 = L.auto?.pan?.points || [],
      at0 = (t) => {
        let v = lane0[0]?.v ?? L.pan;
        for (const x of lane0) if (x.t <= t + EPS) v = x.v;
        return v;
      };
    T.ok(
      at0(0) === -1 && at0(20) === 0 && at0(60) === 0,
      `before the right side's take, the left plays centred where it's alone (verse ${at0(20)}, chorus ${at0(60)}) and the intro on one side stays left (${at0(0)})`,
    );
    // a right take on the verse: the verse wide, the chorus centred, the intro on one side
    st.dispatch(
      [
        {
          type: 'clip.add',
          track: R.id,
          clip: { id: 'c_r', kind: 'audio', asset: 'a_x', start: 16, length: 32, offset: 0, by: 'you' },
        },
      ],
      { by: 'you' },
    );
    const pans = planPans(st.get());
    r = st.dispatch(pans.ops, { by: 'overdub' });
    q = st.get();
    const lane = q.tracks.find((t) => t.id === 't_guitarL').auto?.pan?.points || [];
    const at = (t) => {
      let v = lane[0]?.v;
      for (const x of lane) if (x.t <= t + EPS) v = x.v;
      return v;
    };
    const ramp =
      lane.find((x, i) => i > 0 && x.t === 48) && lane.find((x) => Math.abs(x.t - (48 - (0.02 * 132) / 60)) < 1e-3);
    T.ok(
      r.ok && at(0) === -1 && at(20) === -1 && at(60) === 0 && !!ramp,
      `the pan lane: the intro on the left alone (${at(0)}), the doubled verse wide (${at(20)}), the single chorus centred (${at(60)}), a 20 ms ramp at the boundary (${JSON.stringify(lane)})`,
    );
    // take 1 of the verse used as the right side
    const st2 = createStore(createProject({ tempo: 132 }), { getDevice });
    st2.dispatch(ops, { by: 'overdub' });
    const u = planUseAsRight(st2.get(), { section: 's_v', clip: 'c_v1' });
    r = st2.dispatch(u.ops, { by: 'you' });
    const q2 = st2.get(),
      R2 = q2.tracks.find((t) => t.name === 'Guitar R');
    T.ok(
      r.ok &&
        R2?.clips.some((c) => c.id === 'c_v1' && !c.mute) &&
        q2.tracks.find((t) => t.id === 't_guitarL').clips.some((c) => c.id === 'c_v2' && !c.mute),
      `use take 1 as the right side: it moves to Guitar R and plays there, take 2 stays on the left ("${u.label}")`,
    );
  }

  T.done();
});

test("the prototype's band", async () => {
  const T = checks();
  {
    const hm = riffOf(RIFFS.metal),
      b = bandFor('metal', hm, { from: 16, length: 32, seed: 7 });
    const kicks = b.drums.filter((x) => x.p === 36 && x.t < 8).map((x) => x.t),
      chugs = hm.notes.filter((x) => x.p == null || x.p <= 45).map((x) => x.t);
    T.ok(
      chugs.every((t) => kicks.some((k) => Math.abs(k - t) < 0.02)) && kicks.length === chugs.length,
      `bandFor: the metal club's kick on the riff's chugs (${kicks.length} kicks for ${chugs.length} chugs in two bars)`,
    );
    const hb = riffOf(RIFFS.boogie),
      bb = bandFor('bluesbar', hb, { from: 8, length: 48, seed: 7 });
    const rootOf = (bar) => bb.bass.find((x) => x.t >= bar * 4 - 1e-6)?.p % 12;
    T.ok(
      rootOf(0) === 4 && rootOf(4) === 9 && rootOf(8) === 11 && rootOf(9) === 9 && rootOf(11) === 11,
      `bandFor: the blues bar's bass walks the twelve-bar in E: bars 1, 5, 9, 10, 12 on ${[0, 4, 8, 9, 11].map(rootOf).join(', ')} (E A B A B)`,
    );
    T.ok(
      JSON.stringify(bandFor('metal', hm, { from: 16, length: 32, seed: 7 })) === JSON.stringify(b),
      'bandFor: the same riff and seed make the same band',
    );
  }

  T.done();
});
