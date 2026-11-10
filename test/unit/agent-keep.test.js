// A song opened from someone else's link: what an agent takes away waits for Keep. Through the tool boundary in Node
// (a fake app, no page). Moved from tools/agent-test.js, which keeps the same flow on a real page.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { fakeApp } from './helpers/fake-app.js';

// AJ's call (docs/SECURITY.md): on a song opened from someone else's link, until the person presses Make it yours, an
// agent's deletions, note rewrites and new devices change nothing; they go to the person as a card with one take, Keep
// and Keep as it was (agent/keep.js, the store's guard; agent/tools.js runTool). Keep lands it signed by the agent; Keep
// as it was changes nothing; small additive moves go straight through, as everywhere.
test('3e. a song from a link: what an agent takes away waits for Keep', async () => {
  const t = checks();
  const SAM = 'guest:sam-test';
  // a friend's song: Bass and Keys are Sam's, Sparks is Claude's (on Sam's word), as a link brings them
  const link = async ({ listening = true, share = true } = {}) => {
    const app = fakeApp({ extras: ['transforms', 'arrangement'] });
    const { store } = app;
    store.dispatch(
      [
        { type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
        {
          type: 'clip.add',
          track: '$b',
          ref: 'w',
          clip: { start: 0, length: 8, name: 'Walk', notes: 'A1@0:1 E2@1:1 A1@2:1 C2@3:1' },
        },
        { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
        {
          type: 'clip.add',
          track: '$k',
          ref: 'h',
          clip: { start: 0, length: 8, name: 'Hook', notes: 'C4@0:1 E4@1:1 G4@2:1' },
        },
        { type: 'section.add', section: { name: 'Verse', start: 0, length: 16 } },
        { type: 'auto.write', track: '$k', param: 'gain', points: '0:-12 8:-3' },
      ],
      { by: SAM },
    );
    store.dispatch(
      [
        { type: 'track.add', ref: 's', track: { name: 'Sparks', instrument: { device: 'core.pluck' } } },
        {
          type: 'clip.add',
          track: '$s',
          clip: { start: 0, length: 4, name: 'Twinkle', notes: 'E5@0:0.5 G5@0.5:0.5 B5@1:0.5' },
        },
      ],
      { by: 'claude' },
    );
    store.addAuthor(SAM, { kind: 'human', name: 'Sam' });
    store.history.length = 0; // (the song as the link brings it: no history)
    if (share) app.share = { incoming: { ok: true }, listening };
    return app;
  };
  const tr = (app, name) => app.store.get().tracks.find((x) => x.name === name);
  const song = (app) => JSON.stringify(app.store.get().tracks) + JSON.stringify(app.store.get().sections);
  const req = (app, id) => app.tools.requests.get(id);

  // 1. a deletion by the in-app agent: offered, nothing changed, a card; Keep lands it signed by the agent
  {
    const app = await link();
    const before = song(app),
      h0 = app.store.history.length;
    const r = await app.tools.run(
      'apply_ops',
      { label: 'clear the bass', reason: 'the low end is crowded', ops: [{ type: 'track.remove', track: 'Bass' }] },
      { by: 'claude' },
    );
    const q = r.offered && req(app, r.id);
    t.ok(
      r.offered === true &&
        !r.ok &&
        !r.error &&
        /^k/.test(r.id || '') &&
        r.status === 'pending' &&
        r.what === "delete Bass (Sam's part)" &&
        /came from a link and isn't the person's yet \(until Make it yours\)/.test(r.note || '') &&
        /get_variation_result with this id/.test(r.note || '') &&
        /Nothing changed yet/.test(r.note || ''),
      `node: on a song from a link, the agent's track.remove comes back offered, saying so (${JSON.stringify({ offered: r.offered, what: r.what, error: r.error })})`,
    );
    t.ok(
      song(app) === before &&
        app.store.history.length === h0 &&
        !app.store.canRedo() &&
        q &&
        q.keep &&
        q.cards.length === 2 &&
        q.cards[0].ops[0].type === 'track.remove' &&
        q.cards[1].original,
      'node: the song is unchanged, nothing in History or the redo stack, and a card holds one take and the original',
    );
    const pend = await app.tools.run('get_variation_result', { id: r.id }, { by: 'claude' });
    const a = app.tools.answer(r.id, 0);
    const last = app.store.history[app.store.history.length - 1];
    const res = await app.tools.run('get_variation_result', { id: r.id }, { by: 'claude' });
    t.ok(
      pend.status === 'pending' &&
        a.ok &&
        !tr(app, 'Bass') &&
        last.by === 'claude' &&
        last.label === 'clear the bass' &&
        last.reason === 'the low end is crowded' &&
        last.keptBy === 'you' &&
        res.kept === true &&
        res.txn === last.id,
      `node: Keep deletes it, signed by the agent with its label and reason, kept by you (${last?.by}: "${last?.label}"; get_variation_result ${JSON.stringify({ kept: res.kept, txn: res.txn })})`,
    );
  }
  // 2. Keep as it was changes nothing; notes.replace, notes.set and notes.remove on what's there are offered too
  {
    const app = await link();
    const before = song(app);
    const hook = tr(app, 'Keys').clips[0];
    const del = await app.tools.run(
      'apply_ops',
      { label: 'drop the hook', ops: [{ type: 'clip.remove', track: 'Keys', clip: hook.id }] },
      { by: 'claude' },
    );
    app.tools.answer(del.id, -1);
    const kept = await app.tools.run('get_variation_result', { id: del.id }, { by: 'claude' });
    t.ok(
      del.offered &&
        /delete the clip Hook on Keys \(Sam's\)/.test(del.what) &&
        song(app) === before &&
        kept.kept === false &&
        kept.picked === 'original',
      `node: Keep as it was leaves the clip ("${del.what}"; ${JSON.stringify(kept)})`,
    );
    const rep = await app.tools.run(
      'apply_ops',
      { label: 'a new hook', ops: [{ type: 'notes.replace', track: 'Keys', clip: hook.id, notes: 'D4@0:2 F4@2:2' }] },
      { by: 'claude' },
    );
    const set = await app.tools.run(
      'apply_ops',
      {
        label: 'softer',
        ops: [{ type: 'notes.set', track: 'Keys', clip: hook.id, notes: [{ id: hook.notes[0].id, v: 0.4 }] }],
      },
      { by: 'claude' },
    );
    const rm = await app.tools.run(
      'apply_ops',
      { label: 'thinner', ops: [{ type: 'notes.remove', track: 'Keys', clip: hook.id, ids: [hook.notes[1].id] }] },
      { by: 'claude' },
    );
    const lane = await app.tools.run(
      'apply_ops',
      { label: 'flat', ops: [{ type: 'auto.clear', track: 'Keys', param: 'gain' }] },
      { by: 'claude' },
    );
    const sec = await app.tools.run(
      'apply_ops',
      { label: 'no verse', ops: [{ type: 'section.remove', section: app.store.get().sections[0].id }] },
      { by: 'claude' },
    );
    t.ok(
      rep.offered &&
        /replace the notes in Hook on Keys \(Sam's\)/.test(rep.what) &&
        set.offered &&
        /rewrite 1 note in Hook on Keys/.test(set.what) &&
        rm.offered &&
        /delete 1 note in Hook/.test(rm.what) &&
        lane.offered &&
        /delete the level lane on Keys/.test(lane.what) &&
        sec.offered &&
        /delete the section Verse/.test(sec.what) &&
        song(app) === before,
      `node: replacing, rewriting or deleting notes, a lane or a section that's there is offered, not applied (${[rep, set, rm, lane, sec].map((x) => x.what || x.error).join(' | ')})`,
    );
  }
  // 3. a transform that rewrites notes, a time-feel adjust and deleting bars: offered, not applied
  {
    const app = await link();
    const before = song(app);
    const spark = tr(app, 'Sparks').clips[0];
    const tx = await app.tools.run(
      'transform',
      { name: 'transpose', target: { track: 'Sparks', clip: spark.id }, params: { steps: 2 } },
      { by: 'claude' },
    );
    const txSam = await app.tools.run(
      'transform',
      { name: 'humanize', target: { track: 'Keys', clip: tr(app, 'Keys').clips[0].id }, mode: 'apply' },
      { by: 'claude' },
    );
    const lazy = await app.tools.run('adjust', { axis: 'lazy', target: { track: 'Keys' } }, { by: 'claude' });
    const bars = await app.tools.run('arrange_song', { op: 'remove_bars', bar: 1, bars: 1 }, { by: 'claude' });
    t.ok(
      tx.offered &&
        /rewrite 3 notes in Twinkle on Sparks \(Claude's\)/.test(tx.what) &&
        txSam.offered &&
        lazy.offered &&
        /rewrite/.test(lazy.what) &&
        bars.offered &&
        /delete 1 bar from bar 1 and what plays in them \(Sam's and Claude's\)/.test(bars.what) &&
        song(app) === before,
      `node: a transform that rewrites notes (an agent's part and, asked to apply, a person's), a time-feel move and deleting bars are offered (${[tx, txSam, lazy, bars].map((x) => x.what || x.error || x.proposal).join(' | ')})`,
    );
  }
  // 4. a new device: offered, nothing defined, registered or trusted, no check run before Keep
  {
    const app = await link();
    let ran = 0;
    app.trust = {
      allow: () => {
        ran++;
        return 0;
      },
      hash: () => null,
    };
    app.devices.defineDevice = () => {
      ran++;
    };
    const r = await app.tools.run(
      'define_device',
      {
        device: {
          id: 'warm-fuzz',
          name: 'Warm Fuzz',
          kind: 'effect',
          cat: 'fuzz',
          params: [],
          kernel: '({ create() { return { process() {} }; } })',
        },
        use_on: { track: 'Keys' },
      },
      { by: 'claude' },
    );
    const q = req(app, r.id);
    t.ok(
      r.offered &&
        /add a new device, Warm Fuzz, on Keys/.test(r.what) &&
        /device check runs when they press Keep/.test(r.note) &&
        !app.store.get().devices['claude.warm-fuzz'] &&
        !ran &&
        q.keep.code?.[0]?.id === 'claude.warm-fuzz' &&
        app.tools.audition(r.id, 0, true).ok === false,
      `node: define_device on a song from a link is offered: nothing defined, registered or trusted, and no Hold to hear (it would run the code) ("${r.what}")`,
    );
  }
  // 5. small additive moves go straight through; the person's own calls always do
  {
    const app = await link();
    const add = await app.tools.run(
      'apply_ops',
      {
        label: 'a pad',
        ops: [
          { type: 'track.add', ref: 'p', track: { name: 'Pad', instrument: { device: 'core.pad' } } },
          { type: 'clip.add', track: '$p', clip: { start: 0, length: 8, notes: 'A3@0:8' } },
        ],
      },
      { by: 'claude' },
    );
    const more = await app.tools.run(
      'apply_ops',
      {
        label: 'a pickup',
        ops: [
          { type: 'notes.add', track: 'Keys', clip: tr(app, 'Keys').clips[0].id, notes: 'B3@3.5:0.5' },
          { type: 'track.set', track: 'Keys', patch: { gain: -2 } },
          { type: 'project.set', patch: { tempo: 104 } },
        ],
      },
      { by: 'mcp:test' },
    );
    const mine = await app.tools.run(
      'apply_ops',
      { label: 'mine', ops: [{ type: 'clip.remove', track: 'Keys', clip: tr(app, 'Keys').clips[0].id }] },
      { by: 'you' },
    );
    t.ok(
      add.ok &&
        !add.offered &&
        tr(app, 'Pad') &&
        more.ok &&
        !more.offered &&
        tr(app, 'Keys').gain === -2 &&
        app.store.get().tempo === 104 &&
        mine.ok &&
        !mine.offered &&
        !tr(app, 'Keys').clips.length,
      `node: adding a track, a clip or notes, a mix move and a tempo nudge go straight through; so does anything the person runs (${[add, more, mine].map((x) => (x.ok ? 'ok' : x.what || x.error)).join(', ')})`,
    );
  }
  // 6. an outside agent gets the same; a call that adds and deletes is one take (atomic), and Keep lands all of it
  {
    const app = await link();
    const before = song(app);
    const r = await app.tools.run(
      'apply_ops',
      {
        label: 'swap the bass',
        ops: [
          { type: 'track.add', ref: 'n', track: { name: 'Sub', instrument: { device: 'core.bass' } } },
          { type: 'track.remove', track: 'Bass' },
        ],
      },
      { by: 'mcp:test' },
    );
    const q = req(app, r.id);
    t.ok(
      r.offered &&
        q.by === 'mcp:test' &&
        /delete Bass \(Sam's part\)/.test(r.what) &&
        song(app) === before &&
        !tr(app, 'Sub'),
      `node: an outside agent's call that adds a track and deletes one is offered whole: neither happened (${r.what})`,
    );
    app.tools.answer(r.id, 0);
    const last = app.store.history[app.store.history.length - 1];
    t.ok(
      tr(app, 'Sub') && !tr(app, 'Bass') && last.by === 'mcp:test' && tr(app, 'Sub').by === 'mcp:test',
      'node: Keep lands the whole call, signed by the outside agent',
    );
  }
  // 7. any tool: one that adds then deletes in two dispatches goes to the card whole (its add taken back out, nothing to
  // redo), and so does one that goes around the app it was given
  {
    const app = await link();
    const before = song(app);
    app.tools.register({
      name: 'two_steps',
      description: 'test',
      input_schema: { type: 'object', properties: {} },
      run(input, ctx) {
        const a = ctx.app.store.dispatch(
          { type: 'track.add', track: { name: 'Extra', instrument: { device: 'core.pad' } } },
          { by: ctx.by, label: 'extra' },
        );
        const b = ctx.app.store.dispatch({ type: 'track.remove', track: 'Keys' }, { by: ctx.by, label: 'no keys' });
        return { ok: a.ok && b.ok, a: a.ok, b: b.held || b.ok };
      },
    });
    app.tools.register({
      name: 'around',
      description: 'test',
      input_schema: { type: 'object', properties: {} },
      run(input, ctx) {
        const b = app.store.dispatch(
          { type: 'clip.remove', track: 'Bass', clip: tr(app, 'Bass').clips[0].id },
          { by: ctx.by, label: 'no walk' },
        );
        return b.ok ? { ok: true } : { error: b.error };
      },
    });
    const two = await app.tools.run('two_steps', {}, { by: 'claude' });
    const q = req(app, two.id);
    t.ok(
      two.offered &&
        song(app) === before &&
        !app.store.canRedo() &&
        q.cards[0].ops.length === 2 &&
        q.cards[0].ops[0].type === 'track.add',
      `node: a tool that adds then deletes in two steps is offered as one take, its add taken back out (${two.what})`,
    );
    app.tools.answer(two.id, 0);
    t.ok(tr(app, 'Extra') && !tr(app, 'Keys'), 'node: …and Keep lands both');
    const ar = await app.tools.run('around', {}, { by: 'claude' });
    t.ok(
      ar.offered && /delete the clip Walk on Bass/.test(ar.what) && tr(app, 'Bass').clips.length === 1,
      `node: a tool that dispatches around the app it was given is held all the same (${ar.what || ar.error})`,
    );
    const direct = app.store.dispatch({ type: 'track.remove', track: 'Bass' }, { by: 'claude' });
    const kept = app.store.dispatch(
      { type: 'clip.remove', track: 'Sparks', clip: tr(app, 'Sparks').clips[0].id },
      { by: 'claude', kept: true },
    );
    t.ok(
      direct.held && !direct.ok && tr(app, 'Bass') && kept.ok && !tr(app, 'Sparks').clips.length,
      "node: the store holds an agent's deletion while listening; only a kept change (the person's Keep) passes",
    );
  }
  // 8. after Make it yours (or on a song that never came from a link) a deletion applies as it always did; a card for a
  // song that closed goes, nothing changed
  {
    const app = await link();
    const card = await app.tools.run(
      'apply_ops',
      { label: 'later', ops: [{ type: 'track.remove', track: 'Sparks' }] },
      { by: 'claude' },
    );
    app.share.listening = false; // Make it yours
    const r = await app.tools.run(
      'apply_ops',
      { label: 'clear the bass', ops: [{ type: 'track.remove', track: 'Bass' }] },
      { by: 'claude' },
    );
    const mine = await link({ share: false });
    const r2 = await app.tools.run(
      'apply_ops',
      { label: 'drop the hook', ops: [{ type: 'clip.remove', track: 'Keys', clip: tr(app, 'Keys').clips[0].id }] },
      { by: 'claude' },
    );
    const r3 = await mine.tools.run(
      'apply_ops',
      { label: 'clear the bass', ops: [{ type: 'track.remove', track: 'Bass' }] },
      { by: 'claude' },
    );
    t.ok(
      r.ok &&
        !r.offered &&
        !tr(app, 'Bass') &&
        r2.ok &&
        r3.ok &&
        !r3.offered &&
        !tr(mine, 'Bass') &&
        req(app, card.id)?.status === 'pending',
      `node: after Make it yours, and on a song that was never a link, a deletion applies directly (${[r, r2, r3].map((x) => (x.ok ? 'ok' : x.what || x.error)).join(', ')})`,
    );
    app.tools.answer(card.id, 0);
    t.ok(!tr(app, 'Sparks'), 'node: a card offered before Make it yours can still be kept after it (the same song)');
    const app2 = await link();
    const c2 = await app2.tools.run(
      'apply_ops',
      { label: 'later', ops: [{ type: 'track.remove', track: 'Sparks' }] },
      { by: 'claude' },
    );
    app2.store.load({ title: 'Mine' });
    const g = await app2.tools.run('get_variation_result', { id: c2.id }, { by: 'claude' });
    t.ok(
      g.kept === false && /closed before they chose/.test(g.note || ''),
      `node: a card whose song closed goes, and says nothing changed (${g.note})`,
    );
  }
  t.done();
});
