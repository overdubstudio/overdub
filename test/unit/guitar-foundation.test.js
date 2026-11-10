// The guitar room's foundation (docs/research/GUITAR-ROOM.md; docs/ARCHITECTURE.md "The guitar room"), moved from
// tools/liveroom/checks-guitar.js, which keeps the room in muted Chromium: every foundation module exports exactly its
// frozen names; the club's setup (planGuitarRoom: one step, both guitars on one stack, the drummer, no bass); the rig's
// plans, each the same on both sides with an exact inverse; the key table (no key means two things in one place).
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { createProject } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import '../../app/src/devices/builtin/index.js';

const W = '../../app/src/';
// the foundation's modules and their frozen names (a stream adds to its own module's API, never to these)
const FROZEN = {
  'core/liveroom/guitar/rig.js': [
    'PEDAL_RANK',
    'coalesceKey',
    'planAdd',
    'planChain',
    'planMove',
    'planRemove',
    'planStomp',
    'planSwap',
    'planSync',
    'planTurn',
    'rankAt',
    'rigOf',
    'rigTracks',
  ],
  'core/liveroom/guitar/beats.js': [
    'BEAT_RE',
    'DEFAULT_PINS',
    'GUIDE',
    'GUIDE_ID',
    'GUIDE_TEXT',
    'beatOf',
    'beatOps',
    'grooveOfBeat',
    'jamOps',
    'pinOps',
  ],
  'core/liveroom/guitar/setup.js': ['CLUB_STACK', 'GUITAR_DB', 'guitarSetup', 'isGuitarRoom', 'planGuitarRoom'],
  'ui/liveroom/guitar/keys.js': ['KEYS', 'contextOf', 'installKeys', 'keyTable', 'typesText'],
  'ui/liveroom/guitar/layout.js': [
    'CHROME',
    'MARGIN',
    'PX',
    'REGIONS',
    'SHOP',
    'SHOP_REGIONS',
    'STAGE',
    'fit',
    'frame',
    'toView',
    'viewSize',
  ],
  'ui/liveroom/guitar/camera.js': ['GLIDE', 'REDUCED_MS', 'WALK', 'createCamera'],
  'ui/liveroom/guitar/state.js': ['createState'],
  'ui/liveroom/guitar/prefs.js': ['gprefs'],
  'ui/liveroom/guitar/bind.js': ['createRigBinding'],
};

test('the foundation: frozen names, the setup, the plans, the key table', async () => {
  const T = checks();
  /* ---------------------------------------------------------------------------------------- Node */
  const bad = [];
  for (const [file, names] of Object.entries(FROZEN)) {
    try {
      const m = await import(W + file);
      const got = Object.keys(m).sort().join(' '),
        want = [...names].sort().join(' ');
      if (got !== want) bad.push(`${file}: ${got} (frozen: ${want})`);
    } catch (e) {
      bad.push(`${file}: ${String(e?.message || e).split('\n')[0]}`);
    }
  }
  T.ok(
    !bad.length,
    `every foundation module of the guitar room exports exactly its frozen names (${Object.keys(FROZEN).length} modules)${bad.length ? ': ' + bad.join('; ') : ''}`,
  );
  for (const s of ['room', 'shop', 'drummer', 'start', 'takes', 'tape']) {
    const file = { room: 'stage' }[s] || s;
    let ok = false;
    try {
      ok = typeof (await import(`${W}ui/liveroom/guitar/${file}.js`)).mount === 'function';
    } catch {
      ok = false;
    }
    T.ok(ok, `the ${s} stream's module (ui/liveroom/guitar/${file}.js) exports mount(R)`);
  }

  const setup = await import(W + 'core/liveroom/guitar/setup.js');
  const rig = await import(W + 'core/liveroom/guitar/rig.js');
  const beats = await import(W + 'core/liveroom/guitar/beats.js');
  const { contextOf, KEYS } = await import(W + 'ui/liveroom/guitar/keys.js');
  {
    const store = createStore(createProject());
    const plan = setup.planGuitarRoom(store.get(), {});
    const r = store.dispatch(plan.ops, { by: 'you', label: plan.label, reason: plan.reason });
    const p = store.get(),
      R = rig.rigOf(p);
    const names = p.tracks.map((t) => t.name);
    T.ok(
      r.ok && store.history.length === 1 && setup.isGuitarRoom(p),
      `the club's setup is one step by you (${plan.ops.length} ops; ${names.join(', ')})`,
    );
    T.ok(
      R && R.tracks.length === 2 && R.same && R.amp?.device === 'amp.recto' && !names.some((n) => /bass/i.test(n)),
      `both guitars carry one stack (${R?.slots.map((s) => s.device).join(' → ')}), the drummer plays, no bass`,
    );
    T.ok(
      p.room.beat === beats.GUIDE_ID &&
        p.room.pins?.length === beats.DEFAULT_PINS.length &&
        p.room.stack?.id === setup.CLUB_STACK.id,
      `the room's beat is the guide (${p.room.beat}), ${p.room.pins?.length} cards on the riser, the stack is the club's (${p.room.stack?.id})`,
    );
    T.ok(
      p.tracks.filter((t) => R.tracks.includes(t.id)).every((t) => t.gain === setup.GUITAR_DB),
      `the guitars sit at GUITAR_DB (${setup.GUITAR_DB} dB)`,
    );
    // each plan: the same on both sides, and undone exactly
    const steps = [
      ['a knob', () => rig.planTurn(store.get(), { slot: rig.rigOf(store.get()).amp.slot, params: { gain: 7.5 } })],
      ['a stomp', () => rig.planStomp(store.get(), { slot: rig.rigOf(store.get()).board[0].slot })],
      [
        'a move',
        () => {
          const b = rig.rigOf(store.get()).board;
          return rig.planMove(store.get(), { from: b[0].slot, to: b[1].slot });
        },
      ],
      ['a pedal added', () => rig.planAdd(store.get(), { link: { device: 'pedal.chorus' } })],
      ['a pedal taken off', () => rig.planRemove(store.get(), { slot: rig.rigOf(store.get()).board.at(-1).slot })],
      ['a swap', () => rig.planSwap(store.get(), { stack: { chain: [{ device: 'amp.punk', on: true }] } })],
    ];
    for (const [what, mk] of steps) {
      const before = JSON.stringify(store.get().tracks),
        pl = mk();
      const d = pl.error
        ? { ok: false, error: pl.error }
        : store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
      const after = rig.rigOf(store.get());
      const u = d.ok ? store.undo() : { ok: false };
      const back = JSON.stringify(store.get().tracks) === before;
      if (d.ok) store.redo();
      T.ok(
        d.ok && after?.same && u.ok && back,
        `${what}: one step on both guitars (${after?.slots.map((s) => s.device.split('.')[1] + (s.on ? '' : ' off')).join(', ')}), undone exactly${d.ok ? '' : ': ' + d.error}`,
      );
    }
  }
  {
    // the key table: one meaning per key per place
    const seen = new Map(),
      dup = [];
    const CTX = ['rec', 'review', 'talk', 'gs', 'tape', 'library', 'shop', 'stage', 'any'];
    for (const k of KEYS)
      for (const c of k.in) {
        if (!CTX.includes(c)) dup.push(`${k.code} names a place there isn't: ${c}`);
        const id = `${k.mod || ''}+${k.code}@${c}`;
        if (seen.has(id)) dup.push(`${id}: ${seen.get(id)} and ${k.label}`);
        else seen.set(id, k.label);
      }
    const gr = { world: 'stage', cam: 'stage', overlay: null, gs: { step: null }, talk: { open: false } };
    // (contextOf: which places are live now; the first that isn't 'any')
    const first = (c) => CTX.find((k) => k !== 'any' && c[k]) || 'any';
    const cs = [
      contextOf(gr, 'idle'),
      contextOf(gr, 'take'),
      contextOf({ ...gr, overlay: 'review' }, 'idle'),
      contextOf({ ...gr, world: 'shop' }, 'idle'),
    ].map(first);
    T.ok(
      !dup.length && cs.join() === 'stage,rec,review,shop',
      `the key table: ${KEYS.length} keys, one meaning each wherever you are (contexts ${cs.join(', ')})${dup.length ? ': ' + dup.join('; ') : ''}`,
    );
  }

  T.done();
});
