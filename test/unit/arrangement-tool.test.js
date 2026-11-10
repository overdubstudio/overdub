// The `arrange_song` tool (agent/arrangement-tool.js) and the arrangement ops through apply_ops, on the demo song in
// Node: what each op does and says, what it signs and flashes, its limits, its errors. Moved from
// tools/arrangement-test.js, which keeps the arranger's menus, keys and the inspector's buttons in a real studio.
import { test } from 'node:test';
import { demoProject } from '../../app/src/core/demo.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { checks } from './helpers/check.js';
import { fakeApp } from './helpers/fake-app.js';
import { inPage, leavePage } from './helpers/in-page.js';

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

test('arrange_song and the arrangement ops through apply_ops', async () => {
  const t = checks();
  const app = fakeApp({ getDevice, project: demoProject(), extras: ['arrangement'] });
  const { E } = inPage(app);
  const snapshot = async () => canon(await E(() => window.overdub.store.get()));
  try {
    const bass = await E(() => {
      const t = window.overdub.store.get().tracks.find((x) => x.name === 'Bass');
      return { id: t.id, clip: t.clips[0].id, start: t.clips[0].start, length: t.clips[0].length, n: t.clips.length };
    });
    let pre = await snapshot();
    const run = (input, by = 'claude') =>
      E(([i, b]) => window.overdub.tools.run('arrange_song', i, { by: b }), [input, by]);
    const schema = await E(() => window.overdub.tools.schemas().find((t) => t.name === 'arrange_song'));
    t.ok(schema && schema.input_schema.properties.op.enum.length === 5, 'arrange_song is registered with its five ops');
    pre = await snapshot();
    const h0 = await E(() => window.overdub.store.history.length);
    const a1 = await run({ op: 'duplicate_section', section: 'Chorus', reason: 'the song needs a second chorus' });
    const last = await E(() => {
      const h = window.overdub.store.history.at(-1);
      return { n: window.overdub.store.history.length, by: h.by, label: h.label, reason: h.reason };
    });
    t.ok(
      a1.ok &&
        last.n === h0 + 1 &&
        last.by === 'claude' &&
        last.label === 'duplicate Chorus' &&
        last.reason === 'the song needs a second chorus',
      `duplicate_section: one step signed by the agent ("${a1.summary}")`,
    );
    t.ok(
      a1.moved?.section === 'Chorus 2' &&
        a1.moved.clips_copied > 0 &&
        a1.created?.section &&
        a1.created.clips.length === a1.moved.clips_copied,
      `it says what moved: ${JSON.stringify(a1.moved)}`,
    );
    const signed = await E((ids) => ids.map((id) => window.overdub.store.findClip(id)?.clip.by), a1.created.clips);
    t.ok(signed.length && signed.every((b) => b === 'claude'), "the copied clips are the agent's");
    await E(() => window.overdub.tools.run('undo', {}, { by: 'claude' }));
    t.ok((await snapshot()) === pre, "the agent's undo puts it back exactly");
    const a2 = await run({ op: 'insert_bars', bar: 5, bars: 2 });
    t.ok(
      a2.ok && a2.moved.beats === 8 && a2.moved.at_beat === 16 && /^Inserted 2 bars at bar 5/.test(a2.summary),
      `insert_bars: "${a2.summary}"`,
    );
    await E(() => window.overdub.store.undo());
    const a3 = await run({ op: 'remove_bars', section: 'Chorus' });
    t.ok(
      a3.ok && a3.moved.sections_removed === 1 && /^Deleted 4 bars from bar 5/.test(a3.summary),
      `remove_bars by section: "${a3.summary}"`,
    );
    await E(() => window.overdub.store.undo());
    const a4 = await run({ op: 'repeat_clip', track: 'Bass', clip: bass.clip, times: 3 });
    t.ok(a4.ok && a4.created?.clips?.length === 2 && a4.moved.new_clips.length === 2, `repeat_clip: "${a4.summary}"`);
    await E(() => window.overdub.store.undo());
    const a5 = await run({ op: 'split_clip', clip: bass.clip, beat: bass.start + 2 });
    t.ok(a5.ok && a5.created?.clip && typeof a5.moved.notes_before === 'number', `split_clip: "${a5.summary}"`);
    await E(() => window.overdub.store.undo());
    t.ok((await snapshot()) === pre, 'after undoing each, the song is as it was');
    const e1 = await run({ op: 'duplicate_section', section: 'Bridge' });
    const e2 = await run({ op: 'split_clip', clip: bass.clip, bar: 99 });
    const e3 = await run({ op: 'fold' });
    t.ok(
      e1.error &&
        /sections/.test(e1.error) &&
        e1.hint &&
        e2.error &&
        /isn't inside/.test(e2.error) &&
        e3.error &&
        (await snapshot()) === pre,
      `mistakes come back as { error, hint } and change nothing ("${e1.error}" / "${e2.error}")`,
    );
    // apply_ops takes the ops too (signed by the agent)
    const a6 = await E(() =>
      window.overdub.tools.run(
        'apply_ops',
        { ops: [{ type: 'time.insert', at: 0, length: 4 }], label: 'a bar of count-in', reason: 'room to breathe' },
        { by: 'claude' },
      ),
    );
    t.ok(
      a6.ok && (await E(() => window.overdub.store.history.at(-1).by)) === 'claude',
      'apply_ops accepts time.insert, signed by the agent',
    );
    await E(() => window.overdub.store.undo());
    // an outside agent can't freeze the tab: loop ×64 three times (5,242,880 notes on the demo's bass before the limits)
    const n0 = await E(() => window.overdub.store.history.length);
    const amp = await E(
      (c) =>
        window.overdub.tools.run(
          'apply_ops',
          {
            ops: Array(3).fill({ type: 'clip.repeat', track: 'Bass', clip: c, times: 64, mode: 'loop' }),
            label: 'longer',
          },
          { by: 'mcp:evil' },
        ),
      bass.clip,
    );
    t.ok(
      amp.error &&
        amp.nothing_changed &&
        /up to/.test(amp.error) &&
        (await snapshot()) === pre &&
        (await E(() => window.overdub.store.history.length)) === n0,
      `apply_ops with loop ×64 three times comes back an error, nothing changed: "${(amp.error || '').slice(0, 120)}"`,
    );
    const amp2 = await run({ op: 'repeat_clip', track: 'Bass', clip: bass.clip, times: 64, mode: 'loop' }, 'mcp:evil');
    const amp3 = amp2.ok
      ? await run({ op: 'repeat_clip', track: 'Bass', clip: bass.clip, times: 64, mode: 'loop' }, 'mcp:evil')
      : amp2;
    t.ok(
      amp3.error && /up to/.test(amp3.error) && /smaller step/.test(amp3.hint || ''),
      `arrange_song can't stack loops past the limits either: "${(amp3.error || '').slice(0, 120)}"`,
    );
    if (amp2.ok) await E(() => window.overdub.store.undo());
    const huge = await E(() =>
      window.overdub.tools.run('arrange_song', { op: 'insert_bars', bar: 1, bars: 1e9 }, { by: 'mcp:evil' }),
    );
    t.ok(
      huge.error && /runs up to beat/.test(huge.error) && (await snapshot()) === pre,
      `insert_bars of a billion bars is refused: "${(huge.error || '').slice(0, 100)}"`,
    );

    // …and an outside agent's arrangement op through apply_ops flashes what it moved and says what it did, not its type
    const viaOps = (ops) =>
      E(async (o) => {
        const app = window.overdub,
          { touched } = await import('../../app/src/ui/arrange-kit.js'),
          { opsSummary } = await import('../../app/src/agent/diff.js');
        let tch = null;
        const off = app.store.on('change', (e) => {
          if (e.kind === 'do' && app.store.isAgent(e.by)) tch = touched(e);
        });
        const r = await app.tools.run('apply_ops', { ops: o, label: 'room' }, { by: 'mcp:x' });
        off();
        const h = app.store.history.at(-1) || {};
        return {
          r,
          clips: tch ? [...tch.clips] : [],
          sections: tch ? [...tch.sections] : [],
          reason: h.reason,
          row: opsSummary(h.ops, app.store.get()),
        };
      }, ops);
    const moved = await E(() =>
      window.overdub.store.get().tracks.flatMap((t) => t.clips.filter((c) => c.start >= 8).map((c) => c.id)),
    );
    const o1 = await viaOps([{ type: 'time.insert', at: 8, length: 4 }]);
    t.ok(
      o1.r.ok &&
        moved.length &&
        moved.every((id) => o1.clips.includes(id)) &&
        moved.every((id) => o1.r.targets.clips.includes(id)),
      `apply_ops time.insert flashes and targets the ${moved.length} clips it moved`,
    );
    t.ok(
      o1.r.summary === 'inserted 1 bar at bar 3' &&
        /^Inserted 1 bar at bar 3/.test(o1.reason) &&
        o1.row === o1.r.summary,
      `…and its summary, reason and history row say what moved ("${o1.r.summary}" / "${o1.reason}")`,
    );
    await E(() => window.overdub.store.undo());
    const o2 = await viaOps([{ type: 'clip.repeat', track: bass.id, clip: bass.clip, times: 3 }]);
    t.ok(
      o2.r.ok &&
        o2.r.created.clips?.length === 2 &&
        o2.r.created.clip === o2.r.created.clips[0] &&
        o2.r.created.clips.every((id) => o2.clips.includes(id)),
      `apply_ops clip.repeat lists both copies in created.clips and flashes them (${o2.r.summary})`,
    );
    await E(() => window.overdub.store.undo());
    const o3 = await viaOps([{ type: 'clip.split', track: bass.id, clip: bass.clip, at: bass.start + 2 }]);
    t.ok(
      o3.r.ok &&
        o3.clips.includes(bass.clip) &&
        o3.clips.includes(o3.r.created.clip) &&
        /^split Walk at /.test(o3.r.summary),
      `apply_ops clip.split flashes both halves ("${o3.r.summary}")`,
    );
    await E(() => window.overdub.store.undo());
    const o4 = await viaOps([{ type: 'section.duplicate', section: 'Chorus', push: true }]);
    t.ok(
      o4.r.ok && o4.sections.includes(o4.r.created.section) && o4.r.summary === 'copied Chorus',
      `apply_ops section.duplicate flashes the new section ("${o4.r.summary}")`,
    );
    await E(() => window.overdub.store.undo());
    t.ok((await snapshot()) === pre, 'after undoing those, the song is as it was');
    // the agent feed's chip for arrange_song is the plan's line, pointing at what it moved; a misspelt op names the new ones
    const chip = await E(async (b) => {
      const app = window.overdub,
        { chipFor } = await import('../../app/src/agent/tools.js');
      const r = await app.tools.run(
        'arrange_song',
        { op: 'repeat_clip', clip: b.clip, track: b.id, times: 2 },
        { by: 'claude' },
      );
      const c = chipFor(app, 'arrange_song', {}, r);
      app.store.undo();
      return { c, created: r.created };
    }, bass);
    t.ok(
      chip.c.icon === '✎' &&
        /^repeated Walk ×2/.test(chip.c.text) &&
        chip.c.target?.clips.includes(chip.created.clips[0]),
      `the arrange_song chip reads "${chip.c.text}", not the tool's name`,
    );
    const typo = await E(() =>
      window.overdub.tools.run(
        'apply_ops',
        { ops: [{ type: 'time.insrt', at: 0, length: 4 }], label: 'typo' },
        { by: 'claude' },
      ),
    );
    t.ok(
      typo.error &&
        ['section.duplicate', 'time.insert', 'time.remove', 'clip.repeat', 'clip.split'].every((x) =>
          typo.hint.includes(x),
        ) &&
        /arrange_song/.test(typo.hint),
      'a misspelt op type is told the arrangement ops exist',
    );
  } finally {
    leavePage();
  }
  t.done();
});
