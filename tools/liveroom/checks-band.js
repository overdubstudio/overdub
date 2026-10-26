// The live room's checks: the band, the read, the double and the levels [stream B] (docs/research/LIVE-ROOM-MODE.md
// §11.2, §11.3). Every number is printed, so a change says what it moved.
//   1. the feels and the fills: every feel id resolves to a groove that exists in its place's bank at the tempos it
//      plays; every place's feels and fills exist
//   2. the velocity house rules (grooves.js realize rules: 'band'): no run of more than four hits at full, ghost notes
//      between 0.15 and 0.4, the hats varied, a blast's snare under the backbeat, and realize without them unchanged
//   3. the band (band.js): the kick on the played chugs within 15 ms and on nothing else, Simpler and Busier, the bass
//      in B0-B2 on the read's roots, the End, a thin read (the groove's own kick, the bass waiting), the house's own
//      clips only, the same read and seed the same band, one dispatch
//   4. the read (read.js readTake) on fixture riffs: chugs, chords and tremolo at 90, 132, 160 and 200 BPM in E
//      standard, drop C and B standard, ±10 ms of seeded jitter and an 8 ms latency error: the kick on 95% of chugs or
//      more and never on a note that isn't one, the root on 90% of beats or more, the key's root on every one
//   5. the pair (tight.js measurePair): known per-bar offsets give the right line, naming the bar and the ms within 5
//   6. the double (double.js): the right side's chain and cab per rig, the pans, the pan lane, the intro on one side
//   7. the prototype's band (band.js bandFor): the metal club's kick and bass, the blues bar's twelve-bar
//   8. the amp: every rig as loud as Modern, each place's first breaking up; the right side's LEVEL; the faders' slope
//   9. the levels (LEVELS=0 skips them), by the canonical renderer on each place's reference (band-scene.js): the
//      guitars 3 dB over the band and the drums 3 dB over the bass (before the master), the sides within 0.5 LU, the
//      pair within 1 LU of one centred take, the metal rhythm guitars' rules, each finish (Tight in the metal targets,
//      Loud about 2 LU over it, Room at the window's floor, the basement's and the blues bar's in their windows, all at
//      -1 dBTP or under), Simpler · Busier and Softer · Louder each moving the drums about 2 LU, and the same song
//      rendering the same samples twice
import { PLACES, RIGS, rigChain, rigLabel, FEEL_GROOVES, FEELS, FILLS, feelsOf, grooveOf, fillsOf, guitarChain, guitarGain, FADERS, WINDOWS, setupOf } from '../../app/src/core/liveroom/places.js';
import { bandFor, bandNotes, planLearn, planFeel, HOUSE_RULES, MUTE_V } from '../../app/src/core/liveroom/band.js';
import { planDouble, planUseAsRight, planPans } from '../../app/src/core/liveroom/double.js';
import { readTake } from '../../app/src/core/liveroom/read.js';
import { measurePair, LIMIT_MS } from '../../app/src/core/liveroom/tight.js';
import { LINES } from '../../app/src/core/liveroom/lines/double.js';
import { realize, getGroove, library, familyOf } from '../../app/src/core/grooves.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { sha256 } from '../../app/src/engine/node/io.js';
import { measure, lufs } from '../../app/src/audio/measure.js';
import { checkTargets, TARGETS } from '../../app/src/audio/targets.js';
import { run as runAmp, metalDI, guitarBands } from '../amp-scenes.js';
import { riffDI, riffOf, SR } from './fake.js';
import { roomSong, clean, stem, fixtureRiff, readFixtures, bareSong } from './band-scene.js';

export const name = 'band';
export const pages = false;

const f1 = (x) => (x == null || !Number.isFinite(x) ? String(x) : (x >= 0 ? '+' : '') + x.toFixed(1));
const n1 = (x) => (x == null || !Number.isFinite(x) ? String(x) : x.toFixed(1));
const EPS = 1e-6;
const REF_PEAK = -12;
// [beat, midi, held beats (0: a palm-muted chug)]
export const RIFFS = {
  metal: { place: 'metal', bpm: 132, beats: 8, root: 4, chord: true, notes: [[0, 40], [0.25, 40], [0.75, 40], [1, 43, 0.5], [1.5, 40], [2, 40], [2.25, 40], [2.75, 40], [3, 45, 0.5], [3.5, 40], [4, 40], [4.25, 40], [4.75, 40], [5, 43, 0.5], [5.5, 40], [6, 46, 0.5], [6.5, 45, 0.5], [7, 43, 1]] },
  boogie: { place: 'bluesbar', bpm: 96, beats: 4, root: 4, chord: false, notes: [[0, 40, 0.6], [2 / 3, 44, 0.3], [1, 47, 0.6], [5 / 3, 49, 0.3], [2, 50, 0.6], [8 / 3, 49, 0.3], [3, 47, 0.6], [11 / 3, 44, 0.3]] },
};

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------------- 1. feels and fills */
  {
    const missing = [], used = [];
    for (const [place, feels] of Object.entries(FEEL_GROOVES)) {
      const P = PLACES[place];
      for (const [feel, ids] of Object.entries(feels)) {
        for (const id of ids) if (!getGroove(id)) missing.push(`${place} ${feel}: ${id}`);
        // the tempos it's offered at: every part list that names it, across the place's range in 10s
        for (let t = P.tempo[0]; t <= P.tempo[1]; t += 10) {
          const parts = Object.entries(FEELS[place]).filter(([, fs]) => fs.includes(feel)).map(([k]) => k);
          const offered = parts.some((k) => feelsOf(place, k, t).includes(feel)) || (feel === 'blast' || feel === 'dbeat' ? t >= 180 : false) || (feel === 'slow' ? t < 80 : false);
          if (!offered) continue;
          const g = grooveOf(place, feel, t), G = g && getGroove(g);
          if (!G || t < G.tempo[0] - EPS || t > G.tempo[1] + EPS) missing.push(`${place} ${feel} at ${t}: ${g || 'none'}`);
          else used.push(g);
        }
      }
      for (const k of Object.keys(FEELS[place])) if (k !== 'outro' && !feelsOf(place, k, P.prefer).length) missing.push(`${place} ${k}: no feel at ${P.prefer}`);
    }
    T.ok(!missing.length, `every feel resolves to a groove in its bank at the tempos it's offered (${new Set(used).size} grooves across the three places)${missing.length ? ': ' + missing.slice(0, 6).join('; ') : ''}`);
    const fills = Object.entries(FILLS).flatMap(([k, f]) => Object.entries(f).map(([w, id]) => [k, w, id]));
    const bad = fills.filter(([, , id]) => !getGroove(id));
    T.ok(!bad.length, `every place's fills and ending exist (${fills.length}: ${Object.keys(FILLS).join(', ')})${bad.length ? ': missing ' + bad.map((x) => x.join(' ')).join('; ') : ''}`);
    T.ok(fillsOf('metal', 180).one === FILLS.metalFast.one && fillsOf('metal', 132).one === FILLS.metal.one, `the metal club's fills from the metal bank over 160 (${fillsOf('metal', 180).one}) and the modern one under (${fillsOf('metal', 132).one})`);
  }

  /* ---------------------------------------------------------------------------------------------- 2. the house rules */
  {
    const ids = library().grooves.map((g) => g.id);
    let worstRun = 0, worstId = '', ghostsBad = [], ghostN = 0, same = 0, hatsVaried = 0, hatsN = 0, n = 0;
    for (const id of ids) {
      const g = getGroove(id), tempo = Math.round((g.tempo[0] + g.tempo[1]) / 2), len = Math.max(g.length, 8);
      const plain = realize(id, { tempo, seed: 5, length: len }), band = realize(id, { tempo, seed: 5, length: len, rules: 'band' });
      const again = realize(id, { tempo, seed: 5, length: len });
      if (JSON.stringify(plain) === JSON.stringify(again)) same++;
      n++;
      // runs at full: consecutive hits (in time) at 1
      let run = 0;
      for (const x of band) { run = x.v >= 0.999 ? run + 1 : 0; if (run > worstRun) { worstRun = run; worstId = id; } }
      // the ghosts as written (o and g), found by piece and place in the loop
      const ghosts = g.hits.filter((h) => h.v <= 0.45 + EPS);
      for (const x of band) {
        const L = g.length, isG = ghosts.some((h) => h.p === x.p && Math.min(Math.abs((((x.t - h.t) % L) + L) % L), L - Math.abs((((x.t - h.t) % L) + L) % L)) < 0.06);
        if (!isG) continue;
        ghostN++;
        if (x.v < 0.15 - EPS || x.v > 0.4 + EPS) ghostsBad.push(`${id} ${x.p}@${x.t} ${x.v}`);
      }
      const hats = band.filter((x) => familyOf(x.p) === 'hat'), base = plain.filter((x) => familyOf(x.p) === 'hat');
      hatsN += hats.length;
      hats.forEach((x, i) => { if (base[i] && Math.abs(x.v - Math.min(0.95, base[i].v)) > 0.01) hatsVaried++; });
    }
    T.ok(worstRun <= 4, `no run of more than four hits at full velocity in any groove under the band's rules (longest ${worstRun}${worstId ? ', ' + worstId : ''}, ${n} grooves)`);
    T.ok(!ghostsBad.length && ghostN > 0, `ghost notes (written o or g) play between 0.15 and 0.4 (${ghostN} of them${ghostsBad.length ? '; out: ' + ghostsBad.slice(0, 4).join(', ') : ''})`);
    T.ok(hatsN > 0 && hatsVaried / hatsN > 0.8, `the hats vary, seeded (${hatsVaried} of ${hatsN} moved from the plain groove)`);
    const blast = realize('extreme/traditional-blast', { tempo: 200, seed: 3, length: 8, rules: 'band' }).filter((x) => familyOf(x.p) === 'snare');
    T.ok(blast.length > 8 && blast.every((x) => x.v >= 0.85 - EPS && x.v <= 0.9 + EPS), `a blast's snare sits at 0.85 to 0.9 (${Math.min(...blast.map((x) => x.v))} to ${Math.max(...blast.map((x) => x.v))}, ${blast.length} hits)`);
    const fill = realize('modernmetal/kick-and-snare-flurry', { tempo: 132, seed: 3, rules: 'band' });
    T.ok(fill[0].v === 1 && fill.slice(1).every((x) => x.v <= 0.95), `a fill's first hit is full and the rest under it (${fill[0].v}, then at most ${Math.max(...fill.slice(1).map((x) => x.v))})`);
    T.ok(same === n, `realize without rules is as it was: the same notes for the same seed (${same} of ${n}; the golden hashes hold it to the sample, tools/golden-test.js)`);
  }

  /* ---------------------------------------------------------------------------------------------- 3. the band */
  {
    // a read as read.js gives one, on the metal club's chug at 132 in drop C, its chugs a few ms off the grid
    const R = fixtureRiff('chug', 36), bpm = 132, spb = 60 / bpm;
    const { buf } = riffDI(R, { passes: 1, bpm, seed: 21, jitter: 0.01, tail: 0.5 });
    const read = readTake(buf, SR, { tempo: bpm, start: 0, bars: 8, grid: 4, place: 'metal' });
    const p = bareSong('metal', bpm);
    const b = bandNotes(p, 's_a', { feel: 'chugs', riff: read, seed: 's_a:chugs:x' });
    const kicks = b.drums.filter((x) => x.p === 36), chugsAt = new Set(read.chugs.map((c) => c.t));
    const far = kicks.filter((k) => { const c = read.chugs.find((q) => Math.abs(q.t - k.t) < 0.06); return !c || Math.abs((k.t - c.t) * spb * 1000 - Math.max(-15, Math.min(15, c.ms))) > 0.6; });
    T.ok(kicks.length === chugsAt.size && !far.length, `Your chugs: a kick on each of the read's ${chugsAt.size} chugs, where it was picked (within ${HOUSE_RULES.kickMs} ms of its grid point; ${kicks.length} kicks${far.length ? `, ${far.length} placed wrong` : ''})`);
    const bass = b.bass;
    const rootsOk = bass.filter((x) => { const r = read.roots[Math.floor(Math.round(x.t * 4) / 4 + EPS)]; return r != null && x.p % 12 === r; }).length;
    T.ok(bass.length > 0 && bass.every((x) => x.p >= HOUSE_RULES.bassLo && x.p <= HOUSE_RULES.bassHi) && rootsOk === bass.length, `the bass on the kick's places, on the read's roots (${rootsOk} of ${bass.length}), in B0-B2 (MIDI ${Math.min(...bass.map((x) => x.p))}-${Math.max(...bass.map((x) => x.p))}: drop C's C1 fits)`);
    const simpler = bandNotes(p, 's_a', { feel: 'chugs', busy: -1, riff: read, seed: 's_a:chugs:x' }), busier = bandNotes(p, 's_a', { feel: 'chugs', busy: 1, riff: read, seed: 's_a:chugs:x' });
    const sk = simpler.drums.filter((x) => x.p === 36).length, bg = busier.drums.filter((x) => x.p === 38 && x.v < 0.45).length;
    T.ok(sk < kicks.length / 2 && simpler.fills.length === 0 && busier.fills.length >= 1 && bg > 0, `Simpler: the kick on the accents and each beat's first chug (${sk} of ${kicks.length}), no fills; Busier: ${busier.fills.length} fill${busier.fills.length === 1 ? '' : 's'} in 8 bars and ${bg} ghost notes on the snare`);
    T.ok(JSON.stringify(bandNotes(p, 's_a', { feel: 'chugs', riff: read, seed: 's_a:chugs:x' })) === JSON.stringify(b), 'the same read and seed give the same band (no Math.random)');
    // a fast part: the bass simpler (eighths over 150, quarters over 190)
    for (const tempo of [160, 200]) {
      const q = bareSong('metal', tempo), bb = bandNotes(q, 's_a', { feel: 'chugs', riff: read, seed: 'fast' }).bass;
      const grain = tempo > 190 ? 1 : 0.5, off = bb.filter((x) => Math.abs(Math.round(x.t * 4) / 4 / grain - Math.round(Math.round(x.t * 4) / 4 / grain)) > EPS);
      const runs = off.filter((x) => bb.some((o) => o.t < x.t - EPS && x.t - o.t < grain + EPS));
      T.ok(!runs.length && bb.length > 0, `at ${tempo} the bass plays ${tempo > 190 ? 'quarters' : 'eighths'} through the runs (${bb.length} notes, ${runs.length} inside a run off the ${tempo > 190 ? 'quarter' : 'eighth'})`);
    }
    // the End, and into a breakdown with its drop on
    const end = bandNotes({ ...bareSong('metal', 132, { name: 'End', length: 4 }), key: { root: 'C', scale: 'minor' } }, 's_a', { riff: read });
    T.ok(end.groove === FILLS.metal.ending && end.drums.some((x) => x.p === 49 && x.t === 0) && end.bass.length === 1 && end.bass[0].p % 12 === 0, `the End plays ${end.groove} and the bass the root once (${end.bass.map((x) => x.p).join(', ')})`);
    const into = bareSong('metal', 132, { next: 'Breakdown' });
    into.room.parts = { s_b: { drop: true } };
    const bd = bandNotes(into, 's_a', { feel: 'chugs', riff: read, seed: 'drop' });
    T.ok(bd.fills.some((f) => f.groove === FILLS.metal.drop) && !bd.drums.some((x) => x.t >= 31 - EPS), `into a breakdown with its drop on: ${FILLS.metal.drop}, then a beat of silence (last hit at beat ${Math.max(...bd.drums.map((x) => x.t))})`);
    const ch = bandNotes(bareSong('metal', 132, { next: 'Chorus' }), 's_a', { feel: 'chugs', riff: read, seed: 'up' });
    T.ok(ch.fills.length === 1 && ch.fills[0].to === 32 && ch.fills[0].to - ch.fills[0].from === getGroove(FILLS.metal.bar).length, `into a chorus, a bar going up (${ch.fills.map((f) => `${f.groove} ${f.from}-${f.to}`).join(', ')})`);
    // a thin read: a clean arpeggio of six notes
    const arp = { bpm: 132, beats: 8, chord: false, notes: [[0, 48, 1.4], [1.5, 52, 1.4], [3, 55, 0.9], [4, 60, 1.4], [5.5, 55, 1.4], [7, 52, 0.9]] };
    const thin = readTake(riffDI(arp, { passes: 1, seed: 3, jitter: 0.004, tail: 0.5 }).buf, SR, { tempo: 132, start: 0, bars: 2, grid: 4, place: 'metal' });
    const tb = bandNotes(bareSong('metal', 132, { length: 8 }), 's_a', { feel: 'chugs', riff: thin, seed: 'thin' });
    const own = realize(getGroove(grooveOf('metal', 'chugs', 132)).id, { tempo: 132, seed: 'thin', length: 8, rules: 'band' }).filter((x) => x.p === 36 || x.p === 35).length;
    T.ok(thin.thin && tb.kicks === 0 && tb.drums.filter((x) => x.p === 36 || x.p === 35).length >= own && tb.bass.length === 0, `a thin read (${thin.notes.length} notes on the grid, a clean arpeggio) says so: the kick keeps the groove's own pattern (${tb.drums.filter((x) => x.p === 36 || x.p === 35).length} kicks) and the bass waits`);
    // planLearn and planFeel in a store: one dispatch each, the house's own clips only
    const S = setupOf('metal', { tuning: 'drop-c' }), st = createStore(createProject({ tempo: 132 }), { getDevice });
    const ops = [], map = {};
    for (const t of S.tracks) { if (t.later) continue; const { role, later, ...track } = t; ops.push({ type: 'track.add', track: { ...track, id: `t_${role}` } }); map[role] = `t_${role}`; }
    ops.push({ type: 'section.add', section: { id: 's_v', name: 'Verse', start: 0, length: 32 } }, { type: 'asset.add', asset: { id: 'a_l', kind: 'audio', name: 'DI', sr: SR, channels: 1, duration: buf.length / SR } });
    ops.push({ type: 'clip.add', track: 't_guitarL', clip: { id: 'c_l', kind: 'audio', asset: 'a_l', start: 0, length: 32, offset: 0, by: 'you' } }, { type: 'room.set', patch: { place: 'metal', tuning: 'drop-c', tracks: map } });
    let r = st.dispatch(ops, { by: 'overdub' });
    const learn = planLearn(st.get(), { section: 's_v', read });
    r = r.ok ? st.dispatch(learn.ops, { by: 'overdub', label: learn.label }) : r;
    const q1 = st.get(), on = (role) => q1.tracks.find((t) => t.id === map[role])?.clips || [];
    T.ok(r.ok && learn.label === 'The band learned the verse' && learn.reason === 'room:learn:s_v' && on('drums').length === 1 && on('bass').length === 1 && on('heard').length === 1 && q1.room.parts.s_v.learned.from === 'c_l',
      `planLearn lands in one dispatch: the drums, the bass and the riff as heard (${on('heard')[0]?.notes.length} notes) on the part, learned from c_l (${r.ok ? learn.label : r.error})`);
    const heardRhythm = on('heard')[0]?.notes.filter((x) => x.v < MUTE_V).length || 0, unpitched = read.notes.filter((x) => x.p == null).length;
    T.ok(heardRhythm === unpitched && unpitched > 0, `the palm mutes go on Riff (as heard) as DI Box plays a palm mute, under ${MUTE_V} (${heardRhythm} of the read's ${unpitched}), so the part reads back the same`);
    const before = JSON.stringify(on('drums')[0].notes.map(({ id, ...x }) => x));
    const f = planFeel(st.get(), { section: 's_v', feel: 'chugs' });
    r = st.dispatch(f.ops, { by: 'you' });
    T.ok(r.ok && JSON.stringify(st.get().tracks.find((t) => t.id === 't_drums').clips[0].notes.map(({ id, ...x }) => x)) === before, 'choosing the learned feel again plays the same band: the part reads back from its Riff (as heard) clip as it was learned');
    // an edited drum clip is yours: the house leaves it
    const dc = st.get().tracks.find((t) => t.id === 't_drums').clips[0];
    st.dispatch([{ type: 'notes.set', track: 't_drums', clip: dc.id, notes: [{ id: dc.notes[0].id, v: 0.5 }] }], { by: 'you' });
    const f2 = planFeel(st.get(), { section: 's_v', feel: 'gallop' }), l2 = planLearn(st.get(), { section: 's_v', read });
    const drumsTouched = l2.ops.some((o) => o.track === 't_drums');
    T.ok(f2.edited === true && f2.ops.length === 0 && !drumsTouched && l2.kept?.drums === true, `a drum clip you changed is yours: another feel asks first (edited), and re-learning leaves it (${l2.ops.map((o) => o.type).join(', ')})`);
  }

  /* ---------------------------------------------------------------------------------------------- 4. the read */
  for (const x of readFixtures()) {
    T.ok(x.kick >= 0.95 && x.wrong === 0 && x.roots / x.beats >= 0.9 && x.key === x.want,
      `the read, ${x.kind} at ${x.bpm} in ${x.tuning}: the kick within 15 ms on ${x.ok} of ${x.n} chugs (${(x.kick * 100).toFixed(0)}%), on ${x.wrong} that aren't; the root on ${x.roots} of ${x.beats} beats; the key's root ${x.key} (want ${x.want}); read in ${x.ms} ms`);
  }

  /* ---------------------------------------------------------------------------------------------- 5. the pair */
  {
    const bpm = 132, spb = 60 / bpm, base = fixtureRiff('chug', 36).notes;
    const take = (offs, seed) => riffDI({ bpm, beats: 32, chord: false, notes: base.map(([t, p, d]) => [Math.max(0, t + offs[Math.floor(t / 4)] / 1000 / spb), p, d]) }, { passes: 1, bpm, seed, jitter: 0.002, tail: 0.5, solid: true }).buf;
    const left = take([0, 0, 0, 0, 0, 0, 0, 0], 3);
    const CASES = [
      { what: 'every bar within 8 ms', offs: [3, -5, 6, -2, 7, -4, 5, -6], verdict: 'tight', id: 'side.tight', ms: 7 },
      { what: 'one bar at 14', offs: [4, -3, 14, 5, -4, 3, -5, 4], verdict: 'fine', id: 'side.fine', ms: 14 },
      { what: 'bar 5 at 30 late', offs: [3, -4, 5, -2, 30, 4, -3, 2], verdict: 'bar', id: 'side.drift', bar: 5, dir: 'late', ms: 30 },
      { what: 'bar 6 at 30 early', offs: [2, 3, -2, 4, -3, -30, 3, 2], verdict: 'bar', id: 'side.drift', bar: 6, dir: 'early', ms: 30 },
      { what: 'drifting from bar 3', offs: [2, -3, 22, 28, 34, 40, 44, 48], verdict: 'loose', id: 'side.wander', bar: 3 },
    ];
    for (const c of CASES) {
      const m = measurePair(left, take(c.offs, 11), { sr: SR, tempo: bpm, start: 0, bars: 8, grid: 4 });
      const v = m.line?.vars || {};
      const ok = m.verdict === c.verdict && m.line?.id === c.id && (c.bar == null || v.bar === c.bar) && (c.dir == null || v.dir === c.dir) && (c.ms == null || Math.abs(v.ms - c.ms) <= 5);
      const said = m.line ? LINES[m.line.id].text({ part: 'Verse', ...v }) : '(nothing)';
      T.ok(ok, `the pair, ${c.what}: ${m.verdict} (bars ${m.perBar.map((b) => (b.ms == null ? '-' : f1(b.ms))).join(' ')} ms, limit ${m.limit}): "${said}"`);
    }
    const fast = measurePair(left, left, { sr: SR, tempo: 200, start: 0, bars: 4, grid: 4 }), base2 = measurePair(left, left, { sr: SR, tempo: 132, start: 0, bars: 4, grid: 4, place: 'basement' });
    T.ok(fast.limit === 18.8 && base2.limit === 25 && LIMIT_MS === 20, `the limit: ${LIMIT_MS} ms, a quarter of a sixteenth when that's less (${fast.limit} at 200), 25 at the basement (${base2.limit})`);
  }

  /* ---------------------------------------------------------------------------------------------- 6. the double */
  {
    const WANT = { modern: [0, 2], djent: [1, 3], thrash: [2, 0], hardrock: [0, 2], crunch: [0, 2], edge: [0, 2] };
    const cabs = Object.keys(RIGS).map((id) => { const l = rigChain(id, 'L')[0].params.cab, r = rigChain(id, 'R')[0].params.cab; return { id, l, r, ok: l === WANT[id][0] && r === WANT[id][1] }; });
    T.ok(cabs.every((c) => c.ok), `the right side's cab, one mic over on the same cab: ${cabs.map((c) => `${RIGS[c.id].name} ${c.l} -> ${c.r}`).join(', ')}`);
    const S = setupOf('metal', { tuning: 'b-standard' }), st = createStore(createProject({ tempo: 132 }), { getDevice });
    const ops = [], map = {};
    for (const t of S.tracks) { if (t.later) continue; const { role, later, ...track } = t; ops.push({ type: 'track.add', track: { ...track, id: `t_${role}` } }); map[role] = `t_${role}`; }
    ops.push({ type: 'section.add', section: { id: 's_i', name: 'Intro', start: 0, length: 16 } }, { type: 'section.add', section: { id: 's_v', name: 'Verse', start: 16, length: 32 } }, { type: 'section.add', section: { id: 's_c', name: 'Chorus', start: 48, length: 32 } });
    ops.push({ type: 'asset.add', asset: { id: 'a_x', kind: 'audio', name: 'DI', sr: SR, channels: 1, duration: 60 } });
    for (const [s, len, id] of [[0, 16, 'c_i'], [16, 32, 'c_v1'], [16, 32, 'c_v2'], [48, 32, 'c_c']]) ops.push({ type: 'clip.add', track: 't_guitarL', clip: { id, kind: 'audio', asset: 'a_x', start: s, length: len, offset: 0, by: 'you', ...(id === 'c_v1' ? { mute: true } : {}) } });
    ops.push({ type: 'room.set', patch: { place: 'metal', rig: 'modern', tuning: 'b-standard', tracks: map } }, { type: 'room.part.set', section: 's_i', patch: { oneSide: true } });
    let r = st.dispatch(ops, { by: 'overdub' });
    const d = planDouble(st.get(), { section: 's_v' });
    r = r.ok ? st.dispatch(d.ops, { by: 'overdub' }) : r;
    let q = st.get();
    const R = q.tracks.find((t) => t.name === 'Guitar R'), L = q.tracks.find((t) => t.id === 't_guitarL');
    const want = guitarChain('modern', 'R', 'b-standard');
    T.ok(r.ok && R && R.arm && !L.arm && R.pan === 1 && JSON.stringify(R.inserts.map((x) => [x.device, x.params])) === JSON.stringify(want.map((x) => [x.device, x.params])) && R.inserts[1].params.b1_freq === 80 && q.room.tracks.guitarR === R.id,
      `planDouble: Guitar R made, armed, hard right, the left's chain with the cab one mic over (${R?.inserts.map((x) => x.device + (x.params.cab != null ? ' cab ' + x.params.cab : x.params.b1_freq ? ' low cut ' + x.params.b1_freq : '')).join(', ')}) (${r.ok ? d.label : r.error})`);
    const lane0 = L.auto?.pan?.points || [], at0 = (t) => { let v = lane0[0]?.v ?? L.pan; for (const x of lane0) if (x.t <= t + EPS) v = x.v; return v; };
    T.ok(at0(0) === -1 && at0(20) === 0 && at0(60) === 0, `before the right side's take, the left plays centred where it's alone (verse ${at0(20)}, chorus ${at0(60)}) and the intro on one side stays left (${at0(0)})`);
    // a right take on the verse: the verse wide, the chorus centred, the intro on one side
    st.dispatch([{ type: 'clip.add', track: R.id, clip: { id: 'c_r', kind: 'audio', asset: 'a_x', start: 16, length: 32, offset: 0, by: 'you' } }], { by: 'you' });
    const pans = planPans(st.get());
    r = st.dispatch(pans.ops, { by: 'overdub' });
    q = st.get();
    const lane = q.tracks.find((t) => t.id === 't_guitarL').auto?.pan?.points || [];
    const at = (t) => { let v = lane[0]?.v; for (const x of lane) if (x.t <= t + EPS) v = x.v; return v; };
    const ramp = lane.find((x, i) => i > 0 && x.t === 48) && lane.find((x) => Math.abs(x.t - (48 - (0.02 * 132) / 60)) < 1e-3);
    T.ok(r.ok && at(0) === -1 && at(20) === -1 && at(60) === 0 && !!ramp, `the pan lane: the intro on the left alone (${at(0)}), the doubled verse wide (${at(20)}), the single chorus centred (${at(60)}), a 20 ms ramp at the boundary (${JSON.stringify(lane)})`);
    // take 1 of the verse used as the right side
    const st2 = createStore(createProject({ tempo: 132 }), { getDevice });
    st2.dispatch(ops, { by: 'overdub' });
    const u = planUseAsRight(st2.get(), { section: 's_v', clip: 'c_v1' });
    r = st2.dispatch(u.ops, { by: 'you' });
    const q2 = st2.get(), R2 = q2.tracks.find((t) => t.name === 'Guitar R');
    T.ok(r.ok && R2?.clips.some((c) => c.id === 'c_v1' && !c.mute) && q2.tracks.find((t) => t.id === 't_guitarL').clips.some((c) => c.id === 'c_v2' && !c.mute), `use take 1 as the right side: it moves to Guitar R and plays there, take 2 stays on the left ("${u.label}")`);
  }

  /* ---------------------------------------------------------------------------------------------- 7. the prototype's band */
  {
    const hm = riffOf(RIFFS.metal), b = bandFor('metal', hm, { from: 16, length: 32, seed: 7 });
    const kicks = b.drums.filter((x) => x.p === 36 && x.t < 8).map((x) => x.t), chugs = hm.notes.filter((x) => x.p == null || x.p <= 45).map((x) => x.t);
    T.ok(chugs.every((t) => kicks.some((k) => Math.abs(k - t) < 0.02)) && kicks.length === chugs.length, `bandFor: the metal club's kick on the riff's chugs (${kicks.length} kicks for ${chugs.length} chugs in two bars)`);
    const hb = riffOf(RIFFS.boogie), bb = bandFor('bluesbar', hb, { from: 8, length: 48, seed: 7 });
    const rootOf = (bar) => bb.bass.find((x) => x.t >= bar * 4 - 1e-6)?.p % 12;
    T.ok(rootOf(0) === 4 && rootOf(4) === 9 && rootOf(8) === 11 && rootOf(9) === 9 && rootOf(11) === 11, `bandFor: the blues bar's bass walks the twelve-bar in E: bars 1, 5, 9, 10, 12 on ${[0, 4, 8, 9, 11].map(rootOf).join(', ')} (E A B A B)`);
    T.ok(JSON.stringify(bandFor('metal', hm, { from: 16, length: 32, seed: 7 })) === JSON.stringify(b), 'bandFor: the same riff and seed make the same band');
  }

  /* ---------------------------------------------------------------------------------------------- 8. the amp */
  {
    const def = getDevice('core.stack'), norm = (x, db) => { let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); return x.map((v) => (v * 10 ** (db / 20)) / pk); };
    const dis = ['chords', 'chug'].map((k) => norm(metalDI(k), REF_PEAK)), loud = (params, x) => lufs({ sr: SR, channels: [runAmp(def, params, x)[0]] });
    const ref = dis.map((x) => loud(rigChain('modern')[0].params, x));
    const off = Object.keys(RIGS).map((id) => ({ id, d: dis.map((x, k) => loud(rigChain(id)[0].params, x) - ref[k]) }));
    T.ok(off.every((o) => Math.abs(o.d[0] + o.d[1]) / 2 <= 0.25 && o.d.every((d) => Math.abs(d) <= 0.75)), `every rig comes out as loud as Modern (and so as the place's first), within a quarter dB on the two DIs together (${off.map((o) => `${RIGS[o.id].name} ${o.d.map(f1).join('/')}`).join(', ')} dB)`);
    // the right side's LEVEL: the same take through the right's cab as loud as the left's
    const sides = Object.keys(RIGS).map((id) => ({ id, d: dis.map((x) => loud(rigChain(id, 'R')[0].params, x) - loud(rigChain(id, 'L')[0].params, x)) }));
    T.ok(sides.every((s) => Math.abs((s.d[0] + s.d[1]) / 2) <= 0.5), `the right side's LEVEL sets the pair within 0.5 LU on each rig (${sides.map((s) => `${RIGS[s.id].name} ${f1((s.d[0] + s.d[1]) / 2)} at ${f1(RIGS[s.id].rightLevel)}; measured, it'd be ${f1(RIGS[s.id].rightLevel - (s.d[0] + s.d[1]) / 2)}`).join(', ')})`);
    // the faders' slope: the DI at -18, -12 and -6 through each rig, and the fader the room gives each
    const slope = Object.keys(RIGS).map((id) => {
      const at = (db) => dis.reduce((s, x) => s + loud(rigChain(id)[0].params, norm(x, db)), 0) / dis.length;
      const o = { '-18': at(-18), '-12': at(-12), '-6': at(-6) }, s = (o['-6'] - o['-18']) / 12;
      // the level after the fader the room sets for each: the same within 0.5 dB
      const fad = (db) => o[String(db)] + guitarGain('metal', id, db) - guitarGain('metal', id, -12);
      return { id, s, spread: Math.max(Math.abs(fad(-18) - fad(-12)), Math.abs(fad(-6) - fad(-12))) };
    });
    T.ok(slope.every((x) => x.spread <= 0.5 && Math.abs(x.s - FADERS[x.id]) <= 0.04), `the faders' slope per rig (out per dB in, measured; the table): ${slope.map((x) => `${RIGS[x.id].name} ${x.s.toFixed(3)}/${FADERS[x.id]}, the fader holding it within ${x.spread.toFixed(2)} dB`).join('; ')}`);
    const F = [82.41, 131.7, 197.3, 613.9], A = [1, 0.8, 0.6, 0.35], N = 32768;
    const tones = norm(Float32Array.from({ length: SR * 2 }, (_, i) => F.reduce((s, f, k) => s + A[k] * Math.sin((2 * Math.PI * f * i) / SR + k), 0)), -24);
    const breakup = (y) => {
      const v = y.subarray(y.length - N), h = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      let wsum = 0, w2 = 0, all = 0, at = 0;
      for (let i = 0; i < N; i++) { wsum += h[i]; w2 += h[i] * h[i]; all += (v[i] * h[i]) ** 2; }
      for (const f of F) {
        let re = 0, im = 0;
        for (let i = 0; i < N; i++) { const q = v[i] * h[i], w = (2 * Math.PI * f * i) / SR; re += q * Math.cos(w); im += q * Math.sin(w); }
        at += (((2 * Math.hypot(re, im)) / wsum) ** 2 / 2) * w2;
      }
      return 1 - at / all;
    };
    const FLOOR = { metal: 0.15, basement: 0.1, bluesbar: 0.05 };
    const br = Object.keys(PLACES).map((pid) => ({ pid, id: PLACES[pid].rigs[0], b: breakup(runAmp(def, rigChain(PLACES[pid].rigs[0])[0].params, tones)[0]) }));
    T.ok(br.every((x) => x.b >= FLOOR[x.pid]), `each place's amp breaks up with your guitar coming in at -24 dBFS: ${br.map((x) => `${PLACES[x.pid].name.toLowerCase()} (${rigLabel(x.id)}) ${(x.b * 100).toFixed(0)}%, at least ${FLOOR[x.pid] * 100}%`).join('; ')}`);
  }

  /* ---------------------------------------------------------------------------------------------- 9. the levels */
  if (!ctx.levels) { T.note('LEVELS=0: the level renders skipped'); return; }
  const FIN = { metal: ['tight', 'loud', 'room'], basement: ['raw', 'loud', 'room'], bluesbar: ['bar', 'close', 'loud'] };
  for (const place of ['metal', 'basement', 'bluesbar']) {
    const P = PLACES[place], t0 = Date.now();
    const S = roomSong(place);
    const q = clean(S.p), A = S.assets, id = S.ids, gs = [id.guitarL || id.guitar, id.guitarR].filter(Boolean);
    const G = stem(q, A, gs), D = stem(q, A, [id.drums]), B = stem(q, A, [id.bass]), band = stem(q, A, [id.drums, id.bass]);
    const over = G.lufs - band.lufs, split = D.lufs - B.lufs;
    // (the faders that would make it so: the band up by what it's short of 3 dB under the guitars, the split shared)
    const fix = { drums: Math.round((P.gain.drums + (over - 3) - (split - 3) / 2) * 10) / 10, bass: Math.round((P.gain.bass + (over - 3) + (split - 3) / 2) * 10) / 10 };
    T.ok(Math.abs(over - 3) <= 0.5 && Math.abs(split - 3) <= 0.5, `${P.name}: the ${gs.length === 2 ? 'guitar pair' : 'guitar'} (${n1(G.lufs)} LUFS) sits ${n1(over)} dB over the band (${n1(band.lufs)}), the drums (${n1(D.lufs)}) ${n1(split)} dB over the bass (${n1(B.lufs)}), before the master (want 3 and 3, ±0.5; faders drums ${P.gain.drums}, bass ${P.gain.bass}; measured, they'd be ${fix.drums} and ${fix.bass})`);
    if (gs.length === 2) {
      const Lm = stem(q, A, [gs[0]]), Rm = stem(q, A, [gs[1]]);
      const one = JSON.parse(JSON.stringify(q));
      one.tracks.find((t) => t.id === gs[0]).pan = 0;
      const C = stem(one, A, [gs[0]]);
      T.ok(Math.abs(Rm.lufs - Lm.lufs) <= 0.5 && Math.abs(G.lufs - C.lufs) <= 1, `${P.name}: the sides within 0.5 LU (left ${n1(Lm.lufs)}, right ${n1(Rm.lufs)}: ${f1(Rm.lufs - Lm.lufs)}), the pair within 1 LU of one take centred (${n1(G.lufs)} against ${n1(C.lufs)}: ${f1(G.lufs - C.lufs)})`);
    }
    if (place === 'metal') {
      const g = renderSong(q, { from: 0, to: S.beats, tracks: gs, tail: 0, assets: A });
      const mono = new Float32Array(g.length);
      for (let i = 0; i < g.length; i++) mono[i] = 0.5 * (g.channels[0][i] + g.channels[1][i]);
      const b = guitarBands(mono), W = TARGETS.metal.parts.guitars;
      const rows = [['in 100 Hz-5 kHz', b.in, W.inBand, ''], ['under 80 Hz', b.under80, W.under80, ' dB'], ['over 8 kHz', b.over8k, W.over8k, ' dB'], ['2-4 kHz against 500 Hz-2 kHz', b.hm - b.mid, W.highmidVsMid, ' dB']];
      T.ok(rows.every(([, v, [lo, hi]]) => v >= lo && v <= hi), `${P.name}: the rhythm guitars in the metal targets' guitar rules: ${rows.map(([k, v, [lo, hi], u]) => `${k} ${v.toFixed(2)}${u} (${lo === -Infinity ? `${hi} or under` : hi === Infinity ? `${lo} or over` : `${lo} to ${hi}`})`).join(', ')}`);
    }
    // the finishes
    const ms = {};
    for (const fin of FIN[place]) {
      const s2 = fin === S.finish ? S : roomSong(place, { finish: fin });
      ms[fin] = measure(renderSong(s2.p, { from: 0, to: S.beats, tail: 0.5, assets: s2.assets }));
    }
    const say = (fin) => `${fin} ${n1(ms[fin].lufs)} LUFS, ${n1(ms[fin].truePeak)} dBTP, PLR ${n1(ms[fin].truePeak - ms[fin].lufs)}`;
    if (place === 'metal') {
      const rows = checkTargets(ms.tight, 'metal', { window: 'song' }), HELD = ['lufs', 'truePeak', 'plr', 'lowSideDb', 'lowCorrelation'];
      const held = rows.filter((x) => HELD.includes(x.metric)), rest = rows.filter((x) => !HELD.includes(x.metric));
      T.ok(held.every((x) => x.ok), `${P.name}, Tight in the metal targets (song window): ${held.map((x) => `${x.metric} ${x.value} (${x.lo}..${x.hi})${x.ok ? '' : ' MISS'}`).join(', ')}`);
      T.note(`${P.name}, Tight's other metal rows (a 16-bar scene has no chorus to lift its short-term loudness over the song, nor the range a song has): ${rest.map((x) => `${x.metric} ${x.value} (${x.lo}..${x.hi})${x.ok ? '' : ' off'}`).join(', ')}`);
      const up = ms.loud.lufs - ms.tight.lufs;
      T.ok(up >= 1.5 && up <= 2.5 && ms.loud.truePeak - ms.loud.lufs >= 6, `${P.name}, Loud about 2 LU over Tight (${f1(up)}) with a PLR of 6 or more (${say('loud')})`);
      T.ok(ms.room.lufs >= -9 && ms.room.lufs <= -7, `${P.name}, Room within the metal window, at its floor (${say('room')})`);
    } else {
      const W = WINDOWS[place];
      const out = FIN[place].filter((f) => ms[f].lufs < W[f][0] || ms[f].lufs > W[f][1]);
      T.ok(!out.length, `${P.name}, each finish in its window: ${FIN[place].map((f) => `${say(f)} (${W[f][0]} to ${W[f][1]})`).join('; ')}`);
    }
    T.ok(FIN[place].every((f) => ms[f].truePeak <= -1 + 0.05), `${P.name}, every finish at -1 dBTP or under (${FIN[place].map((f) => `${f} ${n1(ms[f].truePeak)}`).join(', ')}); ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (place === 'metal') {
      // Simpler · Busier and Softer · Louder: the drums alone, each step about 2 LU
      const drums = (o) => { const s = roomSong('metal', { feel: 'chugs', ...o }); return stem(clean(s.p), s.assets, [s.ids.drums]).lufs; };
      const dz = drums({}), steps = { simpler: drums({ busy: -1 }) - dz, busier: drums({ busy: 1 }) - dz, softer: drums({ loud: -1 }) - dz, louder: drums({ loud: 1 }) - dz };
      T.ok(Math.abs(steps.simpler + 2) <= 0.75 && Math.abs(steps.busier - 2) <= 0.75 && Math.abs(steps.softer + 2) <= 0.75 && Math.abs(steps.louder - 2) <= 0.75,
        `${P.name}, each step moves the drums about 2 LU (from ${n1(dz)} LUFS): Simpler ${f1(steps.simpler)}, Busier ${f1(steps.busier)}, Softer ${f1(steps.softer)}, Louder ${f1(steps.louder)}`);
      // determinism: the same song renders the same samples twice
      const a = sha256(renderSong(S.p, { from: 0, to: 16, tail: 0.5, assets: S.assets })), b = sha256(renderSong(roomSong('metal').p, { from: 0, to: 16, tail: 0.5, assets: S.assets }));
      T.ok(a === b, `the same song (built again from the same takes) renders the same samples (${a.slice(0, 12)})`);
    }
  }
}
