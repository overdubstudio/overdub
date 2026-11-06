// The demo shelf as documents (app/src/core/demos/), no render and no browser: every song is a valid project, built the
// same way every time, signed by the house with at least one part played over by Claude; every device it names
// resolves; its automation names real params and stays in range; where a demo uses them, the studio's own devices do
// their jobs (Studio A played the way a drummer plays it, a Scribble Strip that draws a shape that moves, a Slide Rule
// band that does something). The sound (levels, balance, leads, key) is tools/demos-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, cleanProject } from '../../app/src/core/project.js';
import { DEMOS, demoById } from '../../app/src/core/demo.js';
import { MORE_DEMOS } from '../../app/src/core/demos/index.js';
import { lanesOf, specFor } from '../../app/src/core/automation.js';
import { DRUM_MAP } from '../../app/src/core/music.js';
import '../../app/src/devices/builtin/index.js';
import '../../app/src/devices/library/index.js';
import '../../app/src/devices/guitar/index.js';
import { getDevice, paramValues } from '../../app/src/devices/registry.js';
import { LANES, RATES, pointsOf } from '../../app/src/devices/builtin/shaper.js';
import { EQ_BANDS, EQ_TYPES } from '../../app/src/devices/builtin/eq8-curve.js';
import { LEADS } from '../../tools/demo-leads.js';

const strip = (p) =>
  p.tracks
    .map((tr) => tr.clips.map((c) => (c.notes || []).map((n) => `${n.p}@${n.t}:${n.d}*${n.v}`).join(' ')).join('|'))
    .join('/');

test('the shelf', () => {
  assert.ok(MORE_DEMOS.length >= 3, `${MORE_DEMOS.length} new demos on the shelf`);
  assert.ok(
    DEMOS[0].id === 'night-shift' && demoById('nope').title === 'Night Shift',
    'Night Shift comes first, and an unknown id opens it',
  );
  assert.ok(
    new Set(MORE_DEMOS.map((d) => d.genre)).size === MORE_DEMOS.length,
    'each demo is a different genre: ' + MORE_DEMOS.map((d) => d.genre).join(', '),
  );
});

for (const d of MORE_DEMOS) {
  const p = d.make();
  const notes = p.tracks.flatMap((tr) => tr.clips.flatMap((c) => c.notes.map((n) => ({ n, c, tr }))));
  const inserts = [...p.tracks.map((tr) => [tr.name, tr.inserts]), ['the master', p.master.inserts]].flatMap(
    ([name, list]) => list.map((x) => ({ name, x })),
  );

  test(`${d.title}: a valid song, the same every time`, () => {
    const problems = validateProject(p);
    assert.ok(problems.length === 0, `valid ${problems.join('; ')}`);
    const bars = p.loop.end / 4;
    const secs = (p.loop.end * 60) / p.tempo;
    // a loop-length demo runs to 32 bars and 90 s; a song in its whole form (a bridge, an outro) to 96 bars and 3 minutes
    // (a genre demo, META.targets, is a whole song in its genre's form too: intro to outro, or the riff to the last hit)
    const whole = !!d.targets || ['Bridge', 'Outro'].every((n) => p.sections.some((s) => s.name === n));
    assert.ok(
      bars >= 8 && bars <= (whole ? 96 : 32) && secs <= (whole ? 180 : 90) && p.sections.length >= 2,
      `${bars} bars (${secs.toFixed(0)} s) in ${p.sections.length} sections (${p.sections.map((s) => s.name).join(', ')})`,
    );
    assert.ok(`${p.key.root} ${p.key.scale}` === d.key && p.tempo === d.tempo, `${d.key} at ${d.tempo} bpm`);
    assert.ok(strip(p) === strip(d.make()), 'the same notes every time (seeded)');
  });

  test(`${d.title}: signed by the house and by Claude`, () => {
    const by = (who) => notes.filter((x) => x.n.by === who).length;
    assert.ok(
      by('overdub') > 0 && by('claude') > 0 && by('overdub') + by('claude') === notes.length,
      `${by('overdub')} notes by the house, ${by('claude')} by Claude`,
    );
    const agentClips = p.tracks.flatMap((tr) => tr.clips.filter((c) => c.by === 'claude').map((c) => ({ c, tr })));
    assert.ok(
      agentClips.length > 0 &&
        agentClips.every(({ c, tr }) => tr.by === 'claude' && c.notes.every((n) => n.by === 'claude')),
      `Claude's take is signed on its track, clip and notes (${agentClips.map(({ tr }) => tr.name).join(', ')})`,
    );
    assert.ok(
      notes.every(({ n, c }) => n.t >= 0 && n.t < c.length && n.v > 0 && n.v <= 1),
      'every note sits inside its clip',
    );
  });

  test(`${d.title}: devices resolve, automation is signed and in range`, () => {
    const missing = [];
    for (const tr of p.tracks) {
      if (tr.instrument && !getDevice(tr.instrument.device)) missing.push(tr.instrument.device);
      for (const fx of tr.inserts) if (!getDevice(fx.device)) missing.push(fx.device);
    }
    for (const fx of p.master.inserts) if (!getDevice(fx.device)) missing.push(fx.device);
    assert.ok(missing.length === 0, `every device resolves ${missing.join(', ')}`);
    // a demo's lanes are signed by the house or by Claude, and Claude wrote at least one of them; each lane's param
    // and range are held against its device (as the song stands once the store has loaded it)
    const lanes = lanesOf(p);
    if (lanes.length) {
      const who = (w) => lanes.filter((x) => x.lane.by === w).length;
      assert.ok(
        lanes.every((x) => ['overdub', 'claude'].includes(x.lane.by) && x.lane.points.length >= 2 && !x.lane.off) &&
          who('claude') > 0,
        `${lanes.length} automation lanes, ${who('overdub')} by the house and ${who('claude')} by Claude (${lanes.map((x) => x.param).join(', ')})`,
      );
      const loaded = cleanProject(demoById(d.id));
      const bad = lanesOf(loaded)
        .filter((x) => {
          const spec = specFor(loaded, x, getDevice);
          return (
            !spec ||
            x.lane.points.some(
              (pt) =>
                pt.v < Math.min(spec.min, spec.max) || pt.v > Math.max(spec.min, spec.max) || pt.t > loaded.loop.end,
            )
          );
        })
        .map((x) => x.key);
      assert.ok(
        bad.length === 0,
        `its ${lanesOf(loaded).length} lanes name real params and stay in their ranges ${bad.join(', ')}`,
      );
    }
  });

  test(`${d.title}: its leads name real sections and tracks`, () => {
    const lead = LEADS[d.id];
    assert.ok(
      lead &&
        Object.entries(lead).every(
          ([s, name]) => p.sections.some((x) => x.name === s) && p.tracks.some((x) => x.name === name),
        ),
    );
  });

  // Studio A, played the way a drummer plays it: ghost strokes on the snare, at least four of the articulations a
  // groove alone doesn't use, a cymbal on the downbeat of every section the kit plays from its start, and the mic mix
  // set for the song
  for (const tr of p.tracks.filter((x) => x.instrument?.device === 'core.drumroom')) {
    test(`${d.title}: ${tr.name} on Studio A is played like a drummer`, () => {
      const ns = tr.clips.flatMap((c) => c.notes.map((n) => ({ ...n, at: c.start + n.t })));
      const ghosts = ns.filter((n) => n.p === DRUM_MAP.snare && n.v < 0.35).length;
      const arts = [
        'half',
        'quarter',
        'hatedge',
        'openedge',
        'footsplash',
        'rimshot',
        'snareedge',
        'flam',
        'drag',
        'roll',
        'bell',
        'rideedge',
        'crashchoke',
        'crash2choke',
        'chinachoke',
        'splashchoke',
        'ridechoke',
      ].filter((a) => ns.some((n) => n.p === DRUM_MAP[a]));
      const CYMBALS = [
        'crash',
        'crash2',
        'china',
        'splash',
        'crashchoke',
        'crash2choke',
        'chinachoke',
        'splashchoke',
      ].map((a) => DRUM_MAP[a]);
      const opens = p.sections.filter((s) => ns.some((n) => n.at > s.start - 0.2 && n.at < s.start + 1));
      const bare = opens.filter((s) => !ns.some((n) => CYMBALS.includes(n.p) && Math.abs(n.at - s.start) < 0.05));
      const def = getDevice('core.drumroom'),
        mics = ['mix_close', 'mix_oh', 'mix_room', 'mix_crush', 'bleed', 'room_size'].filter(
          (k) =>
            tr.instrument.params[k] != null && +tr.instrument.params[k] !== def.params.find((q) => q.key === k).def,
        );
      assert.ok(
        ghosts >= 8 && arts.length >= 4 && opens.length && !bare.length && mics.length,
        `${ghosts} ghost strokes; ${arts.join(', ')}; a cymbal on the downbeat of ${opens.length - bare.length} of the ${opens.length} sections it plays from the top${bare.length ? ` (none on ${bare.map((s) => s.name).join(', ')})` : ''}; its mics set (${mics.join(', ')})`,
      );
    });
  }

  // Scribble Strip: a lane on, with depth, whose shape moves; Slide Rule: a band on that cuts or boosts
  for (const { name, x } of inserts.filter(({ x }) => x.device === 'core.shaper')) {
    test(`${d.title}: the Scribble Strip on ${name} draws something`, () => {
      const v = paramValues(getDevice('core.shaper'), x.params);
      const moving = LANES.filter(
        (L) =>
          +v[`${L.id}_on`] >= 0.5 && +v[`${L.id}_depth`] > 0 && new Set(pointsOf(v, L.id).map((pt) => pt.y)).size > 1,
      );
      assert.ok(
        x.on !== false && +v.mix > 0 && moving.length > 0,
        moving
          .map(
            (L) =>
              `${L.word} every ${RATES[v[`${L.id}_rate`]]}, ${pointsOf(v, L.id).length} points, depth ${v[`${L.id}_depth`]}%`,
          )
          .join('; ') || 'nothing moves',
      );
    });
  }
  for (const { name, x } of inserts.filter(({ x }) => x.device === 'core.eq8')) {
    test(`${d.title}: the Slide Rule on ${name} works`, () => {
      const v = paramValues(getDevice('core.eq8'), x.params);
      const bands = Array.from({ length: EQ_BANDS }, (_, i) => i + 1).filter(
        (n) => +v[`b${n}_on`] >= 0.5 && (+v[`b${n}_type`] >= 3 || Math.abs(+v[`b${n}_gain`]) >= 0.5),
      );
      assert.ok(
        x.on !== false && bands.length > 0,
        bands
          .map(
            (n) =>
              `${EQ_TYPES[v[`b${n}_type`]]} at ${v[`b${n}_freq`]} Hz${+v[`b${n}_type`] < 3 ? ` ${v[`b${n}_gain`]} dB` : ''}`,
          )
          .join(', ') || 'no band on',
      );
    });
  }
}
