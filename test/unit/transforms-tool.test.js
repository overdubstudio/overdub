// The `transform` agent tool (agent/transforms-tool.js) through the tool boundary on the demo song, in Node: what it
// signs, what it proposes on the person's notes, its errors. Moved from tools/transforms-test.js, which keeps the piano
// roll's Transform menu and the inspector's buttons in a real studio.
import { test } from 'node:test';
import { demoProject } from '../../app/src/core/demo.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { checks } from './helpers/check.js';
import { fakeApp } from './helpers/fake-app.js';
import { inPage, leavePage } from './helpers/in-page.js';

test('the transform tool: signed by the agent, a proposal on the human notes, errors with hints', async () => {
  const t = checks();
  const app = fakeApp({ getDevice, project: demoProject(), extras: ['transforms'] });
  const { E, page } = inPage(app);
  try {
    const run = (input, by = 'claude') =>
      page.evaluate(([i, b]) => window.overdub.tools.run('transform', i, { by: b }), [input, by]);
    const schema = await E(() => window.overdub.tools.schemas().find((t) => t.name === 'transform'));
    t.ok(
      schema && /chords_from_melody/.test(schema.description) && schema.input_schema.properties.name.enum.length === 16,
      'the transform tool is registered, with every transform in its description',
    );

    // the agent on house notes: applies, one step, signed by the agent
    const ids = await E(() => {
      const p = window.overdub.store.get();
      const k = p.tracks.find((t) => t.name === 'Keys');
      const hk = p.tracks.find((t) => t.name === 'Hook');
      return { keys: k.id, kc: k.clips[0].id, hook: hk.id, hc: hk.clips[0].id };
    });
    let h0 = await E(() => window.overdub.store.history.length);
    const a1 = await run({
      name: 'strum',
      target: { track: 'Keys', clip: ids.kc, bars: [1, 2] },
      params: { direction: 'down', ms: 25 },
      reason: 'a softer entrance',
    });
    t.ok(a1.ok && /strummed/.test(a1.summary), `agent strums the Keys, bars 1–2: "${a1.summary}"`);
    let last = await E(() => {
      const h = window.overdub.store.history;
      return { n: h.length, by: h[h.length - 1].by, label: h[h.length - 1].label, reason: h[h.length - 1].reason };
    });
    t.ok(
      last.n === h0 + 1 && last.by === 'claude' && /strum/.test(last.label) && last.reason === 'a softer entrance',
      `one undo step by claude ("${last.label}")`,
    );
    await E(() => window.overdub.tools.run('undo', {}, { by: 'claude' }));
    t.ok((await E(() => window.overdub.store.history.length)) === h0, "undo takes the agent's transforms back");

    // into another track: chords from the Hook land on Keys as a new clip
    h0 = await E(() => window.overdub.store.history.length);
    const a2 = await run({
      name: 'chords_from_melody',
      target: { track: 'Hook', clip: ids.hc },
      params: { every: 'bar' },
      into_track: 'Keys',
    });
    const kc = await E((id) => window.overdub.store.get().tracks.find((t) => t.id === id).clips.length, ids.keys);
    t.ok(
      a2.ok && a2.into?.track === 'Keys' && kc === 2 && (await E(() => window.overdub.store.history.length)) === h0 + 1,
      `chords from the Hook go to a new clip on Keys in one step (${a2.summary})`,
    );
    await E(() => window.overdub.store.undo());

    // the human's notes: a proposal, nothing changes; propose_variations takes it as is
    const mine = await E(() => {
      const s = window.overdub.store,
        p = s.get(),
        hk = p.tracks.find((t) => t.name === 'Hook');
      const r = s.dispatch(
        {
          type: 'clip.add',
          track: hk.id,
          ref: 'm',
          clip: { start: 0, length: 8, name: 'Mine', notes: 'A4@0:1 C5@1:1 E5@2:1 D5@3:1 C5@4:2 A4@6:2' },
        },
        { by: 'you', label: 'my line' },
      );
      return r.created.m;
    });
    h0 = await E(() => window.overdub.store.history.length);
    const pr = await run({ name: 'invert', target: { track: 'Hook', clip: mine } });
    t.ok(
      pr.proposal &&
        !pr.ok &&
        pr.rewrites_human_notes === 4 &&
        pr.variations.length === 2 &&
        (await E(() => window.overdub.store.history.length)) === h0,
      `on the human's notes it proposes instead (${pr.variations.map((v) => v.label).join(' / ')})`,
    );
    const vp = page.evaluate(
      (x) =>
        window.overdub.tools.run(
          'propose_variations',
          { title: x.title, target: x.target, variations: x.variations, wait_seconds: 0 },
          { by: 'claude' },
        ),
      pr,
    );
    const vr = await vp;
    t.ok(vr.status === 'pending' && !vr.error, 'the proposal goes straight into propose_variations');
    await E((id) => {
      const r = [...window.overdub.tools.requests.values()].find((q) => q.id === id);
      const card = r.cards.find((c) => !c.original);
      window.overdub.tools.answer(id, card.index);
    }, vr.id);
    last = await E(() => {
      const h = window.overdub.store.history;
      return { n: h.length, by: h[h.length - 1].by, picked: h[h.length - 1].pickedBy };
    });
    t.ok(last.n === h0 + 1 && last.by === 'claude' && last.picked === 'you', 'picking a take applies it as one step');
    await E(() => window.overdub.store.undo());
    const ap = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octave: 1 } });
    t.ok(
      ap.ok && ap.added === 6 && ap.changed === 0,
      "adding to the human's notes (double) just happens: nothing of theirs is rewritten",
    );
    await E(() => window.overdub.store.undo());
    const force = await run({ name: 'invert', target: { track: 'Hook', clip: mine }, mode: 'apply' });
    t.ok(
      force.ok && (await E(() => window.overdub.store.history.at(-1).by)) === 'claude',
      'mode "apply" rewrites them when asked',
    );
    await E(() => window.overdub.store.undo());
    const bad = await run({ name: 'transpose', target: { track: 'Drums' } });
    t.ok(bad.error && bad.hint, `errors come back with a hint ("${bad.error}")`);
    const bad2 = await run({ name: 'nope' });
    t.ok(bad2.error && /transforms:/.test(bad2.hint || ''), 'an unknown transform lists the real ones');
    // a param it can't read is refused with the options, not quietly swapped for the default ("down" would double UP)
    h0 = await E(() => window.overdub.store.history.length);
    const bp = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octave: 'down' } });
    const bo = await run({ name: 'retrograde', target: { track: 'Hook', clip: mine }, params: { mode: 'pitch' } });
    const bk = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octaves: -1 } });
    const okNum = await run({ name: 'double', target: { track: 'Hook', clip: mine }, params: { octave: '-1' } });
    t.ok(
      bp.error &&
        /octave: a number -2 to 2/.test(bp.hint || '') &&
        bo.error &&
        /mode: time \| pitches/.test(bo.hint || '') &&
        bk.error &&
        /no param "octaves"/.test(bk.error) &&
        okNum.ok &&
        (await E(() => window.overdub.store.history.length)) === h0 + 1,
      `a bad param is refused with what it takes ("${bp.error}"; ${bp.hint}), a number as text still works`,
    );
    await E(() => window.overdub.store.undo());
    const bb = await run({
      name: 'transpose',
      target: { track: 'Hook', clip: mine, bars: [40, 41] },
      params: { steps: 1 },
    });
    t.ok(
      bb.error && /song's, 1-based: the clip covers bars 1–2/.test(bb.hint || ''),
      `bars outside the clip say they are song bars ("${bb.hint}")`,
    );
  } finally {
    leavePage();
  }
  t.done();
});
