// What capture makes of sloppy playing (tools/sloppy.js: jittered, drifting, rushed taps; a hum with sloppy onsets):
// the forgiving grid, a steady lean, free time from taps and from a hum, and the click measured. Moved intact from
// tools/input-test.js. A file of its own so it runs beside input.test.js (about 4 s: 40 takes of each player).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hear, transcribe } from '../../app/src/input/hum.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import { snapGentle, fitHits, fitSegs, tightness, blend, placeTake, leanOf } from '../../app/src/input/timing.js';
import { newPartFor } from '../../app/src/core/sounds.js';
import { clickSamples } from '../../app/src/engine/click.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { perform, sloppyHum, rng } from '../../tools/sloppy.js';

test('playing in time is hard: what capture makes of it', async () => {
  /* (capture-timing, AJ 2026-10-05: "it's not that the timings are off, it's that it's just HARD to do in time"). Every
   check plays a sloppy human (tools/sloppy.js: jittered, drifting, rushed taps; a hum with sloppy onsets, let go
   early) and asks whether what they meant comes out. */
  {
    const exact = (notes, want) => {
      const a = new Set(notes.map((n) => `${n.p}@${n.t}`)),
        b = new Set(want.map((w) => `${w.p}@${w.want}`));
      return a.size === b.size && [...b].every((k) => a.has(k));
    };
    // 1. against the click: the forgiving grid (an eighth when near one, else a sixteenth) against the old hard sixteenths.
    // A beat meant on eighths, played with a 40 ms rush and 30 ms of jitter at 120 BPM: where did each hit go?
    {
      const spb = 0.5;
      let hard = 0,
        soft = 0,
        n = 0;
      for (let sd = 1; sd <= 40; sd++) {
        const takes = perform(
          [
            [0, 36],
            [0.5, 42],
            [1, 38],
            [1.5, 42],
            [2, 36],
            [2.5, 42],
            [3, 38],
            [3.5, 42],
          ],
          { bpm: 120, jitter: 0.02, rush: { 36: 0.04, 38: 0.04, 42: 0.04 }, seed: sd, start: 0 },
        );
        for (const h of takes) {
          const b = h.t / spb;
          n++;
          if (Math.abs(Math.round(b / 0.25) * 0.25 - h.want) < 1e-9) hard++;
          if (Math.abs(snapGentle(b) - h.want) < 1e-9) soft++;
        }
      }
      assert.ok(
        soft / n >= 0.97 && soft > hard,
        `against the click, every hit rushed 40 ms with 20 ms of slop on top at 120 BPM: ${Math.round((100 * soft) / n)}% of hits land where they were meant (hard sixteenths: ${Math.round((100 * hard) / n)}%)`,
      );
      const pick = [0.25, 0.75, 1.25, 3.75].map((b) => snapGentle(b + 0.02));
      assert.ok(
        pick.join() === '0.25,0.75,1.25,3.75',
        `and a sixteenth played on purpose stays a sixteenth (${pick.join(', ')})`,
      );
    }
    // 1b. a steady lean (the capture review, 2026-10-05: a player who waits to hear the click, 85 to 180 ms late, put
    // every hit on an "and" or a sixteenth, 0 of 8 right, and a rusher 3 of 8). 40 takes of each player, 2 bars at 120
    // BPM, kick 1 and 3, snare 2 and 4, and the same with eighth hats over it: the take's one lean out, then the gentle grid
    {
      const BEAT = Array.from({ length: 8 }, (_, b) => [b, b % 2 ? 38 : 36]),
        HATS = Array.from({ length: 16 }, (_, e) => [e / 2, 42]);
      const players = {
        'waits for the click (120 ms late, 30 ms of slop)': (r) => () => 120 + 30 * r.gauss(),
        'rushes (95 ms early)': (r) => () => -95 + 30 * r.gauss(),
        'drags (0 to 130 ms late over the take)': (r) => (b) => (b / 8) * 130 + 20 * r.gauss(),
        '180 ms late': (r) => () => 180 + 25 * r.gauss(),
        'steady (18 ms of slop)': (r) => () => 18 * r.gauss(),
      };
      const lines = [];
      let worst = 1,
        oldBest = 0;
      for (const [pat, pn] of [
        [BEAT, 'K/S'],
        [[...BEAT, ...HATS], 'K/S and hats'],
      ]) {
        for (const [name, mk] of Object.entries(players)) {
          let ok = 0,
            old = 0,
            n = 0;
          for (let sd = 1; sd <= 40; sd++) {
            const f = mk(rng(sd)),
              hits = pat.map(([b, p]) => ({ p, b: b + f(b) / 500, want: b }));
            const pl = placeTake(hits, { coarse: 0.5, fine: 0.25 }, { from: 0 });
            hits.forEach((h, i) => {
              n++;
              if (Math.abs(pl.t[i] - h.want) < 1e-9) ok++;
              if (Math.abs(snapGentle(h.b) - h.want) < 1e-9) old++;
            });
          }
          lines.push(`${pn}, ${name}: ${Math.round((100 * ok) / n)}% (was ${Math.round((100 * old) / n)}%)`);
          worst = Math.min(worst, ok / n);
          if (!/steady/.test(name)) oldBest = Math.max(oldBest, old / n);
        }
      }
      assert.ok(
        worst >= 0.9 && oldBest < 0.8,
        `against the click, a player off by a steady amount: the take's lean comes out and the hits land where they were meant (${lines.join('; ')})`,
      );
      // what it must leave alone: hats on the "and"s on time, a kick on 1 and 3 with the snare on 2-and and 4-and, a lean
      // under 40 ms; and a nervous start (the first kick and snare 230 ms late) goes on its beats
      const ands = placeTake(
        HATS.filter(([b]) => b % 1).map(([b, p]) => ({ p, b: b + 0.02 })),
        { coarse: 0.5, fine: 0.25 },
      );
      const sync = [
        [0, 36],
        [1.5, 38],
        [2, 36],
        [3.5, 38],
        [4, 36],
        [5.5, 38],
        [6, 36],
        [7.5, 38],
      ].map(([b, p]) => ({ p, b: b + 0.24, want: b }));
      const syncP = placeTake(sync, { coarse: 0.5, fine: 0.25 }, { from: 0 });
      const small = leanOf(BEAT.map(([b, p]) => ({ p, b: b + 0.06 })));
      const nerv = BEAT.map(([b, p], i) => ({ p, b: b + (i < 2 ? 0.46 : 0.01), want: b }));
      const nervP = placeTake(nerv, { coarse: 0.5, fine: 0.25 }, { from: 0 });
      assert.ok(
        ands.lean === 0 &&
          ands.t.every((x) => x % 1 === 0.5) &&
          syncP.t.every((x, i) => x === sync[i].want) &&
          Math.abs(syncP.lean - 0.24) < 0.03 &&
          small.lean === 0 &&
          nervP.t.every((x, i) => x === nerv[i].want) &&
          nervP.opening === 2,
        `and it leaves alone what was meant: hats on the "and"s stay there (lean ${ands.lean}), a syncopated snare 120 ms late keeps its "and"s (${syncP.t.join(' ')}), 30 ms is left to the grid (lean ${small.lean}); a nervous start, the first two hits 230 ms late, lands on its beats (${nervP.t.join(' ')})`,
      );
    }
    // 2. free time, taps: the grid follows the human. 40 takes of each, every one sloppy in its own way
    const runs = [
      [
        'a rock beat, kick snare and eighth hats, 96 BPM, 25 ms of slop',
        [
          [0, 36],
          [0, 42],
          [0.5, 42],
          [1, 38],
          [1, 42],
          [1.5, 42],
          [2, 36],
          [2, 42],
          [2.5, 42],
          [3, 38],
          [3, 42],
          [3.5, 42],
        ],
        { bpm: 96 },
        96,
      ],
      [
        'the same, slowing 8% as it goes, 30 ms of slop',
        [
          [0, 36],
          [0, 42],
          [0.5, 42],
          [1, 38],
          [1, 42],
          [1.5, 42],
          [2, 36],
          [2, 42],
          [2.5, 42],
          [3, 38],
          [3, 42],
          [3.5, 42],
        ],
        { bpm: 96, jitter: 0.03, drift: -0.08 },
        92.2,
      ],
      [
        'kick and snare at 80, the snare rushed 50 ms',
        [
          [0, 36],
          [1, 38],
          [2, 36],
          [3, 38],
        ],
        { bpm: 80, bars: 4, rush: { 38: 0.05 } },
        80,
      ],
      [
        'rushing 10% at 120, eighth hats, 25 ms of slop',
        [
          [0, 36],
          [0.5, 42],
          [1, 38],
          [1.5, 42],
          [2, 36],
          [2.5, 42],
          [3, 38],
          [3.5, 42],
        ],
        { bpm: 120, bars: 4, jitter: 0.025, drift: 0.1 },
        126,
      ],
      [
        'syncopated, sparse: kick 1, snare 2-and, kick 3-and, snare 4',
        [
          [0, 36],
          [1.5, 38],
          [2.5, 36],
          [3, 38],
        ],
        { bpm: 100 },
        100,
      ],
      [
        'half time at 70: a kick and a snare a bar',
        [
          [0, 36],
          [2, 38],
        ],
        { bpm: 70, bars: 4 },
        70,
      ],
      [
        'four taps, one bar',
        [
          [0, 36],
          [1, 38],
          [2, 36],
          [3, 38],
        ],
        { bpm: 100, bars: 1 },
        100,
      ],
    ];
    const lines = [];
    let allOk = true;
    for (const [name, pat, o, want] of runs) {
      let ok = 0,
        tempoOk = 0;
      for (let sd = 1; sd <= 40; sd++) {
        const hits = perform(pat, { ...o, seed: sd * 7 + 3 });
        const f = fitHits(hits.map((h) => ({ t: h.t, p: h.p, v: 0.8 })));
        if (f && exact(f.notes, hits)) ok++;
        if (f && Math.abs(f.bpm / want - 1) < 0.04) tempoOk++;
      }
      lines.push(`${name}: ${ok}/40 exact, tempo within 4% in ${tempoOk}/40`);
      if (ok < 36 || tempoOk < 36) allOk = false;
    }
    assert.ok(
      allOk,
      `free time: the tempo and the downbeat come from the taps, and the beat they meant comes out (${lines.join('; ')})`,
    );
    {
      let ok = 0;
      const pat = [
        [0, 36],
        [1, 36],
        [2, 36],
        [3, 36],
        [3.75, 38],
        [4, 36],
        [5, 36],
        [6, 36],
        [7, 36],
        [7.75, 38],
        [8, 36],
      ];
      for (let sd = 1; sd <= 40; sd++) {
        const hits = perform(pat, { bpm: 100, bars: 1, bpb: 9, jitter: 0.02, seed: sd * 7 + 3 });
        const f = fitHits(hits.map((h) => ({ t: h.t, p: h.p, v: 0.8 })));
        if (f && exact(f.notes, hits)) ok++;
      }
      // (the hardest case: a hit 150 ms before the next, on a count of 600 ms steps; a kick 60 ms early runs into it)
      assert.ok(
        ok >= 30,
        `free time: a sixteenth pickup into the bar, on a count in quarters, with 20 ms of slop: the whole take comes out as meant in ${ok}/40`,
      );
    }
    // 3. free time, a hum: sung (the hum-bench voice), onsets up to 60 ms off, notes let go early; heard, then counted.
    // And the capture review's phrase (a rest after an eighth pair): at 120 BPM with 60 ms of slop it came back at 75 BPM
    // in sixteenths
    {
      const MEL2 = [
        [64, 1],
        [67, 1],
        [69, 0.5],
        [67, 0.5, 1],
        [64, 1],
        [62, 1],
        [60, 2],
      ];
      let ok2 = 0,
        n2 = 0;
      for (const tempo of [80, 100, 120])
        for (let sd = 1; sd <= 9; sd++) {
          const h = sloppyHum(MEL2, { tempo, sloppy: 0.06, seed: sd }),
            fit = fitSegs(hear(h.x, h.sr).segs);
          n2++;
          if (fit && fit.starts.join() === h.want.map((w) => w.beat).join() && Math.abs(fit.bpm / tempo - 1) < 0.04)
            ok2++;
        }
      assert.ok(
        ok2 >= 25,
        `free time, the review's hummed phrase (an eighth pair, then a rest) with 60 ms of slop at 80, 100 and 120 BPM: the rhythm and the tempo sung come out in ${ok2}/${n2} (it was 20)`,
      );
    }
    {
      const MEL = [
        [60, 1],
        [64, 1],
        [67, 0.5],
        [69, 0.5, 1],
        [67, 1],
        [64, 0.5],
        [62, 0.5],
        [60, 2],
      ];
      let ok = 0,
        n = 0,
        tempoOk = 0;
      const misses = [];
      for (const tempo of [80, 100, 120])
        for (let sd = 1; sd <= 8; sd++) {
          const h = sloppyHum(MEL, { tempo, sloppy: 0.06, seed: sd });
          const { segs } = hear(h.x, h.sr);
          const fit = fitSegs(segs);
          n++;
          if (!fit) {
            misses.push(`${tempo}/${sd}: no pulse`);
            continue;
          }
          const res = transcribe(segs, {
            tempo: fit.bpm,
            gentle: true,
            place: (g, i) => ({ t: fit.starts[i], e: fit.ends[i], tr: fit.raws[i] }),
          });
          const got = res.notes.map((x) => `${x.p}@${x.t}`).join(' '),
            want = h.want.map((w) => `${w.m}@${w.beat}`).join(' ');
          if (got === want) ok++;
          else misses.push(`${tempo}/${sd}`);
          if (Math.abs(fit.bpm / tempo - 1) < 0.04) tempoOk++;
        }
      assert.ok(
        ok >= 20 && tempoOk >= 20,
        `free time, a sloppy hum (onsets up to 60 ms off, notes let go early) at 80, 100 and 120 BPM: the rhythm sung comes out in ${ok}/${n}, the tempo within 4% in ${tempoOk}/${n}${misses.length ? ` (not: ${misses.join(', ')})` : ''}`,
      );
    }
    // 4. a hum against the click: each note placed by the beat it was sung against, gently; one sung in the count-in
    // keeps its place before the take (the recorder leaves it out) instead of stacking on beat 1
    {
      const r = rng(9),
        spb = 0.6,
        beats = [0, 1, 2, 2.5, 3, 4, 5.5, 6];
      const segs = beats.map((b, i) => {
        const t0 = 2 + b * spb + (r() * 2 - 1) * 0.06;
        return { t0, t1: t0 + 0.4, midi: 60 + i, db: -20, conf: 0.9, cents: 0 };
      });
      const res = transcribe(segs, {
        tempo: 100,
        origin: 2,
        originBeat: 0,
        gentle: true,
        clampStart: false,
        key: null,
      });
      assert.ok(
        res.notes.map((x) => x.t).join() === beats.join(),
        `against the click, sung up to 60 ms off at 100 BPM, every note lands on the beat it was meant for (${res.notes.map((x) => x.t).join(', ')})`,
      );
      const early = [
        { t0: 1.0, t1: 1.3, midi: 60, db: -20, conf: 0.9 },
        { t0: 1.3, t1: 1.6, midi: 64, db: -20, conf: 0.9 },
        { t0: 2.0, t1: 2.5, midi: 67, db: -20, conf: 0.9 },
      ];
      const inTake = transcribe(early, { tempo: 100, origin: 2, originBeat: 0, gentle: true, clampStart: false }),
        old = transcribe(early, { tempo: 100, origin: 2, originBeat: 0 });
      assert.ok(
        inTake.notes.filter((x) => x.t < 0).length === 2 && old.notes.every((x) => x.t <= 0.25),
        `notes sung in the count-in keep their place before the take (${inTake.notes.map((x) => x.t).join(', ')}), where they used to stack on beat 1 (${old.notes.map((x) => x.t).join(', ')})`,
      );
    }
    // 5. Tight, Loose, As played
    assert.ok(
      tightness('tight') === 1 &&
        tightness('loose') === 0.5 &&
        tightness('played') === 0 &&
        blend(1.08, 1, 0.5) === 1.04 &&
        blend(1.08, 1, 0) === 1.08,
      "the take's timing: Tight is where the grid put it, Loose half way back, As played where it was played",
    );
    // 6. where a take goes when there is no track for it: the ux-instruments rule (docs/INSTRUMENTS-UX.md 1.2)
    const np = [
      newPartFor('hum', { tracks: [] }),
      newPartFor('hum', { tracks: [{ name: 'Melody' }] }),
      newPartFor('pads', { tracks: [] }),
      newPartFor('keys', { tracks: [] }),
    ];
    assert.ok(
      np.map((x) => `${x.name}:${x.device}`).join() ===
        'Melody:core.keys,Melody 2:core.keys,Drums:core.drums,Keys:core.keys',
      `a new idea is a new track: ${np.map((x) => `${x.name} (${x.device})`).join(', ')}`,
    );
    // 7. the track made for a take and the take are one undo step (store.dispatch join)
    {
      const st = createStore();
      const a = st.dispatch(
        {
          type: 'track.add',
          ref: 't',
          track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } },
        },
        { by: 'you', label: 'add Drums' },
      );
      const b = st.dispatch(
        {
          type: 'clip.add',
          track: a.created.t,
          clip: { kind: 'notes', start: 0, length: 4, notes: [{ p: 36, t: 0, d: 0.25, v: 0.8 }] },
        },
        { by: 'you', label: 'record Drums', join: a.txn.id },
      );
      const n1 = st.history.length;
      st.undo();
      assert.ok(
        b.ok && n1 === 1 && st.history.length === 0 && st.get().tracks.length === 0 && st.history.length === 0,
        `the track made for a take and the take are one undo step (${n1} in History; one undo leaves ${st.get().tracks.length} tracks)`,
      );
    }
    // 8. the click, measured: a wood-block knock against Gobo Kit as the Node renderer plays it. Over each hit's first
    // 50 ms, above 1.5 kHz (where a click is heard over a kit), and in full
    {
      const sr = 48000,
        w = Math.round(0.05 * sr);
      const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
      const hp = (x) => {
        const a = Math.exp((-2 * Math.PI * 1500) / sr);
        let y = new Float32Array(x.length),
          px = 0,
          py = 0;
        for (let i = 0; i < x.length; i++) {
          py = a * (py + x[i] - px);
          px = x[i];
          y[i] = py;
        }
        const z = new Float32Array(x.length);
        px = 0;
        py = 0;
        for (let i = 0; i < y.length; i++) {
          py = a * (py + y[i] - px);
          px = y[i];
          z[i] = py;
        }
        return z;
      };
      const rms = (x, a, b) => {
        let s2 = 0;
        for (let i = a; i < b; i++) s2 += x[i] * x[i];
        return Math.sqrt(s2 / Math.max(1, b - a));
      };
      const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      const beat = clickSamples(sr, false),
        bar = clickSamples(sr, true);
      const p = createProject();
      p.tempo = 120;
      p.tracks = [
        {
          id: 't1',
          name: 'Drums',
          kind: 'instrument',
          instrument: { device: 'core.drums', params: {} },
          clips: [
            {
              id: 'c1',
              kind: 'notes',
              start: 0,
              length: 4,
              notes: [
                { p: 36, t: 0, d: 0.25, v: 0.8 },
                { p: 38, t: 1, d: 0.25, v: 0.8 },
              ],
            },
          ],
        },
      ];
      const kit = await renderSong(p, { from: 0, to: 4, sr, tail: 0.3 });
      const L = kit.channels[0],
        R = kit.channels[1] || L,
        mono = new Float32Array(L.length);
      for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
      const H = hp(mono),
        kick = { all: db(rms(mono, 0, w)), hi: db(rms(H, 0, w)) },
        snare = { all: db(rms(mono, sr * 0.5, sr * 0.5 + w)), hi: db(rms(H, sr * 0.5, sr * 0.5 + w)) };
      const cb = { pk: db(peak(beat)), all: db(rms(beat, 0, w)), hi: db(rms(hp(beat), 0, w)) },
        cB = { pk: db(peak(bar)), hi: db(rms(hp(bar), 0, w)) };
      const f1 = (x) => x.toFixed(1);
      assert.ok(
        Math.abs(cb.pk + 6) < 0.2 &&
          Math.abs(cB.pk + 3) < 0.2 &&
          cb.hi > snare.hi - 2.5 &&
          cB.hi > snare.hi + 2 &&
          cb.hi > kick.hi + 10,
        `the click is heard over a beat: it peaks at ${f1(cb.pk)} dBFS (the bar ${f1(cB.pk)}); above 1.5 kHz over 50 ms it reads ${f1(cb.hi)} dB (the bar ${f1(cB.hi)}) against Gobo Kit's snare ${f1(snare.hi)} and kick ${f1(kick.hi)} (in full: ${f1(cb.all)} against ${f1(snare.all)} and ${f1(kick.all)}; the old sine blip was -26.2 in full, -35.2 above 1.5 kHz)`,
      );
    }
  }
});
