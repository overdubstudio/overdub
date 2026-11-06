// The live room's checks: the band, the read, the double and the levels [stream B] (docs/research/LIVE-ROOM-MODE.md
// §11.2, §11.3). Every number is printed, so a change says what it moved.
//   1-3, 6, 7. (the feels and fills, the house rules, the band, the double and the prototype's band, which take under a
//      second: test/unit/liveroom-band.test.js)
//   4. the read (read.js readTake) on fixture riffs: chugs, chords and tremolo at 90, 132, 160 and 200 BPM in E
//      standard, drop C and B standard, ±10 ms of seeded jitter and an 8 ms latency error: the kick on 95% of chugs or
//      more and never on a note that isn't one, the root on 90% of beats or more, the key's root on every one; and
//      readInWorker in muted Chromium (PAGES=0 skips it): the module Worker loads and reads what readTake reads
//   5. the pair (tight.js measurePair): known per-bar offsets give the right line, naming the bar and the ms within 5
//   8. the amp: every rig as loud as Modern, each place's first breaking up; the right side's LEVEL; the faders' slope
//   9. the levels (LEVELS=0 skips them), by the canonical renderer on each place's reference (band-scene.js): the
//      guitars 3 dB over the band and the drums 3 dB over the bass (before the master), the sides within 0.5 LU, the
//      pair within 1 LU of one centred take, the metal rhythm guitars' rules, each finish (Tight in the metal targets,
//      Loud about 2 LU over it, Room at the window's floor, the basement's and the blues bar's in their windows, all at
//      -1 dBTP or under), Simpler · Busier and Softer · Louder each moving the drums about 2 LU, and the same song
//      rendering the same samples twice
import { PLACES, RIGS, rigChain, rigLabel, guitarGain, FADERS, WINDOWS, } from '../../app/src/core/liveroom/places.js';
import { measurePair, LIMIT_MS } from '../../app/src/core/liveroom/tight.js';
import { LINES } from '../../app/src/core/liveroom/lines/double.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { sha256 } from '../../app/src/engine/node/io.js';
import { measure, lufs } from '../../app/src/audio/measure.js';
import { checkTargets, TARGETS } from '../../app/src/audio/targets.js';
import { run as runAmp, metalDI, guitarBands } from '../amp-scenes.js';
import { createHash } from 'node:crypto';
import { riffDI, SR } from './fake.js';
import { roomSong, clean, stem, fixtureRiff, readFixtures, } from './band-scene.js';
import { open } from '../pw.js';

export const name = 'band';
export const pages = true;

const f1 = (x) => (x == null || !Number.isFinite(x) ? String(x) : (x >= 0 ? '+' : '') + x.toFixed(1));
const n1 = (x) => (x == null || !Number.isFinite(x) ? String(x) : x.toFixed(1));
const REF_PEAK = -12;
export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------------- 4. the read */
  for (const x of readFixtures()) {
    T.ok(x.kick >= 0.95 && x.wrong === 0 && x.roots / x.beats >= 0.9 && x.key === x.want,
      `the read, ${x.kind} at ${x.bpm} in ${x.tuning}: the kick within 15 ms on ${x.ok} of ${x.n} chugs (${(x.kick * 100).toFixed(0)}%), on ${x.wrong} that aren't; the root on ${x.roots} of ${x.beats} beats; the key's root ${x.key} (want ${x.want}); read in ${x.ms} ms`);
  }

  // off the main thread (§4.2): the page's readInWorker against its own readTake on the same samples (a seeded pluck
  // on each eighth), and the Worker's module fetched (not the idle-callback fallback)
  if (ctx.pages) {
    const { page, close, errors } = await open('/');
    try {
      const r = await page.evaluate(async () => {
        const R = await import('/app/src/core/liveroom/read.js');
        const sr = 48000, bpm = 132, spb = 60 / bpm, x = new Float32Array(Math.round(sr * (spb * 8 + 0.5)));
        let h = 1;
        const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return (h / 4294967296) * 2 - 1; };
        for (let k = 0; k < 16; k++) {
          const a = Math.round((k * spb * sr) / 2);
          for (let i = 0; i < sr * 0.2 && a + i < x.length; i++) x[a + i] += 0.4 * Math.exp(-i / (sr * 0.08)) * (2 * ((i * 82.41 / sr) % 1) - 1) + (i < 96 ? 0.1 * rnd() : 0);
        }
        const opts = { tempo: bpm, start: 0, bars: 2, grid: 4, place: 'metal' };
        const kept = x.length, w = await R.readInWorker(x, sr, opts), m = R.readTake(x, sr, opts);
        const fetched = performance.getEntriesByType('resource').some((e) => /\/read-worker\.js$/.test(e.name));
        return { same: JSON.stringify(w) === JSON.stringify(m), notes: w.notes.length, key: w.key?.root ?? null, fetched, kept: x.length === kept };
      });
      T.ok(r.same && r.fetched && r.kept && r.notes === 16 && r.key === 4 && !errors.length,
        `the read off the main thread: readInWorker in a module Worker (${r.fetched ? 'read-worker.js loaded' : 'no Worker'}) reads what readTake reads (${r.same ? 'the same' : 'different'}: ${r.notes} notes, the key's root ${r.key}), the caller's samples left whole${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`);
    } finally { await close(); }
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

  /* ---------------------------------------------------------------------------------------------- 8. the amp */
  {
    const def = getDevice('core.stack'), norm = (x, db) => { let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); return x.map((v) => (v * 10 ** (db / 20)) / pk); };
    const dis = ['chords', 'chug'].map((k) => norm(metalDI(k), REF_PEAK));
    // (the same samples through the same params are the same render: the checks below ask for many of them twice)
    const heard = new Map(), loud = (params, x) => {
      const key = `${JSON.stringify(params)} ${createHash('sha256').update(x).digest('hex')}`;
      if (!heard.has(key)) heard.set(key, lufs({ sr: SR, channels: [runAmp(def, params, x)[0]] }));
      return heard.get(key);
    };
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
      const a = sha256(renderSong(S.p, { from: 0, to: 16, tail: 0.5, assets: S.assets })), b = sha256(renderSong(roomSong('metal', { fresh: true }).p, { from: 0, to: 16, tail: 0.5, assets: S.assets }));
      T.ok(a === b, `the same song (built again from the same takes) renders the same samples (${a.slice(0, 12)})`);
    }
  }
}
