// Picking a sound (docs/INSTRUMENTS-UX.md, section 6.1), the Node sections 1-3: kindOfTake, soundsFor, newPartFor
// (core/sounds.js). Moved intact from tools/pick-sound-test.js; the tool (13) and the browser sections stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUM_NOTES } from '../../tools/fake-wav.js';
import { createStore } from '../../app/src/core/store.js';
import { createRecorder } from '../../app/src/input/recorder.js';
import { createCapture } from '../../app/src/input/capture.js';

const reg = await import('../../app/src/devices/registry.js');
await import('../../app/src/devices/builtin/index.js');
await import('../../app/src/devices/library/index.js').catch(() => null);
const sounds = await import('../../app/src/core/sounds.js').catch((e) => ({ _missing: e.message }));
const N = (spec) => spec.map(([p, t, d]) => ({ p, t, d, v: 0.8 }));
const line = (ps) => N(ps.map((p, i) => [p, i, 0.9]));

test('1 kindOfTake', async () => {
  const k = sounds.kindOfTake;
  assert.ok(
    typeof k === 'function',
    `1: core/sounds.js exports kindOfTake${sounds._missing ? ` (${sounds._missing})` : ''}`,
  );
  if (typeof k !== 'function') return;
  const chords = N(
    [0, 1, 2, 3].flatMap((b) => [
      [60, b, 1],
      [64, b, 1],
      [67, b, 1],
    ]),
  );
  const got = {
    hum: k({ kind: 'notes', src: 'hum', notes: line(HUM_NOTES) }),
    low: k({ kind: 'notes', src: 'hum', notes: line([45, 47, 48, 47, 45]) }),
    bass: k({ kind: 'notes', src: 'keys', notes: line([36, 38, 40, 43]) }),
    chords: k({ kind: 'notes', src: 'keys', notes: chords }),
    drums: k({ kind: 'drums', src: 'tap', notes: line([36, 38, 36, 38]) }),
  };
  assert.ok(
    got.hum === 'hum' && got.low === 'hum' && got.bass === 'bass' && got.chords === 'chords' && got.drums === 'drums',
    `1: a hummed C4-A4 line is hum, a hummed A2-C3 line is hum too, a played line under C3 bass, three notes a beat chords, a tapped beat drums (${JSON.stringify(got)})`,
  );
});

test('2 soundsFor', async () => {
  const sf = sounds.soundsFor;
  assert.ok(
    typeof sf === 'function' && sounds.SOUND_SETS && typeof sounds.familyOf === 'function',
    '2: core/sounds.js exports soundsFor, familyOf and SOUND_SETS',
  );
  if (typeof sf !== 'function') return;
  const hum = { kind: 'notes', src: 'hum', notes: line(HUM_NOTES) };
  const has = (id) => !!reg.getDevice(id);
  const ids = (rows) => rows.map((r) => r.device + (r.preset ? `:${r.preset}` : ''));
  const a = sf(hum, { has });
  const b = sf(hum, { has: (id) => id !== 'claude.choir-loft' && has(id) });
  const c = sf(hum, { has, current: 'core.wavetable' });
  const d = sf({ kind: 'drums', src: 'tap', notes: [] }, { has, current: 'core.drums', currentPreset: 'Studio kit' });
  assert.ok(
    ids(a).join() === 'core.keys,core.wavetable,core.strings,claude.choir-loft',
    `2: the hum set is Lamp Tines, Light Table, Music Stands, Choir Loft (${ids(a).join(', ')})`,
  );
  assert.ok(
    b.length === 4 && b[3].device === 'core.mallets',
    `2: without Choir Loft the fourth is Mallet Bag (${ids(b).join(', ')})`,
  );
  assert.ok(
    c.length === 4 &&
      c[0].device === 'core.wavetable' &&
      c.filter((r) => r.device === 'core.wavetable' && !r.preset).length === 1,
    `2: the current sound comes first, once, and there are still four (${ids(c).join(', ')})`,
  );
  assert.ok(
    d.filter((r) => r.device === 'core.drums' && /^studio kit$/i.test(r.preset || '')).length +
      d.filter((r) => r.device === 'core.drums' && !r.preset).length <=
      1,
    `2: Gobo Kit on Studio kit isn't listed twice (${ids(d).join(', ')})`,
  );
  assert.ok(
    [a, b, c, d].flat().every((r) => typeof r.family === 'string' && r.family.length > 1),
    '2: every row has a family word',
  );
  // the sampled instruments are offered where they fit: Parlour Upright for played lines and chords, Virtuosity Kit for a beat
  const pl = sf({ kind: 'notes', src: 'qwerty', notes: line([60, 62, 64, 65]) }, { has });
  const ch = sf('chords', { has }),
    dr = sf({ kind: 'drums', src: 'tap', notes: [] }, { has });
  const noKit = sf({ kind: 'drums', src: 'tap', notes: [] }, { has: (id) => id !== 'core.drumroom' && has(id) });
  assert.ok(
    ids(pl)[1] === 'core.upright' &&
      ids(ch)[1] === 'core.upright' &&
      ids(dr)[1] === 'core.drumkit' &&
      !ids(sf(hum, { has })).includes('core.upright') &&
      ids(noKit)[3] === 'core.brushkit' &&
      sounds.SOUND_SETS.drums.fallbacks.some((r) => r.device === 'core.handkit'),
    `2: the sampled instruments are offered: Parlour Upright second for what you played (${ids(pl).join(', ')}) and for chords (${ids(ch).join(', ')}), Virtuosity Kit second for a beat (${ids(dr).join(', ')}), Rusty Brushes the first fallback and Hand Crate among them (${ids(noKit).join(', ')}); a hum keeps the voices that sing`,
  );
  // every device and preset the sets name is real: walk SOUND_SETS whatever its shape
  const named = [];
  const walk = (x, depth = 0) => {
    if (depth > 6 || x == null) return;
    if (typeof x === 'string') {
      if (/^(core|claude|pedal|amp)\.[a-z0-9-]+$/.test(x)) named.push({ device: x });
      return;
    }
    if (Array.isArray(x)) {
      x.forEach((y) => walk(y, depth + 1));
      return;
    }
    if (typeof x === 'object') {
      if (typeof x.device === 'string') named.push({ device: x.device, preset: x.preset });
      else for (const v of Object.values(x)) walk(v, depth + 1);
    }
  };
  walk(sounds.SOUND_SETS);
  const bad = named.filter(({ device, preset }) => {
    const def = reg.getDevice(device);
    return (
      !def ||
      def.kind !== 'instrument' ||
      (preset && !(def.presets || []).some((p) => p.name.toLowerCase() === String(preset).toLowerCase()))
    );
  });
  assert.ok(
    named.length >= 20 && !bad.length,
    `2: all ${named.length} devices and presets in SOUND_SETS are instruments in the registry${bad.length ? ' (not: ' + bad.map((x) => x.device + (x.preset ? ` "${x.preset}"` : '')).join(', ') + ')' : ''}`,
  );
});

test('3 newPartFor', async () => {
  const np = sounds.newPartFor;
  assert.ok(typeof np === 'function', '3: core/sounds.js exports newPartFor');
  if (typeof np !== 'function') return;
  const { createStore } = await import('../../app/src/core/store.js');
  const s = createStore(null, { getDevice: reg.getDevice });
  const a = np('hum', s.get());
  s.dispatch({ type: 'track.add', track: { name: 'Melody', instrument: { device: 'core.keys' } } }, { by: 'you' });
  const b = np('hum', s.get());
  const k = np('keys', s.get()),
    p = np('pads', s.get());
  assert.ok(
    a?.name === 'Melody' &&
      a.device === 'core.keys' &&
      b?.name === 'Melody 2' &&
      k?.name === 'Keys' &&
      p?.name === 'Drums' &&
      p.device === 'core.drums',
    `3: a hum's new track is Melody (Lamp Tines), then Melody 2; keys make Keys, pads Drums (${JSON.stringify({ a, b, k, p })})`,
  );
});

// 4: the aim, with real commits. Moved from tools/pick-sound-test.js, which ran it in a page: the same recorder, capture
// and store, over a stub shell (the selection) and a stub engine that only starts, stops and counts beats.
const aimRig = (view) => {
  const store = createStore(null, { getDevice: reg.getDevice });
  const fns = new Map();
  const ui = {
    state: { selection: { track: null } },
    on: (k, fn) => {
      if (!fns.has(k)) fns.set(k, new Set());
      fns.get(k).add(fn);
      return () => fns.get(k).delete(fn);
    },
    emit: (k, d) => {
      for (const fn of fns.get(k) || []) fn(d);
    },
    toast() {},
    announce() {},
  };
  ui.select = (x) => {
    Object.assign(ui.state.selection, x);
    ui.emit('select', ui.state.selection);
  };
  // the transport: from where play() was told to start, the beat runs at the song's tempo
  let t0 = 0;
  const engine = {
    playing: false,
    recording: false,
    pos: 0,
    get beat() {
      return this.playing ? this.pos + ((performance.now() - t0) / 1000) * (store.get().tempo / 60) : this.pos;
    },
    get gridBeat() {
      return this.beat;
    },
    seek(b) {
      this.pos = b;
    },
    async play(b) {
      this.pos = b;
      t0 = performance.now();
      this.playing = true;
    },
    stop() {
      this.pos = this.beat;
      this.playing = false;
    },
    on() {},
  };
  const app = { store, engine, ui, devices: reg };
  const input = {
    emit() {},
    options: { grid: 0.25 },
    audio: { ctx: null, state: { open: false }, latency: { get: () => 0 }, outLatency: () => 0, _recording() {} },
    hum: { active: false, recording: false, start: async () => {} },
  };
  input.capture = createCapture(app, input);
  const rec = createRecorder(app, input, { view });
  return { store, ui, engine, rec, input };
};

test('4 the aim, simple view, with real commits', async () => {
  const { store: st, ui, engine, rec } = aimRig('simple');
  assert.ok(
    typeof rec.aim === 'function' && typeof rec.setAim === 'function',
    '4: input/recorder.js has aim() and setAim()',
  );
  const name = (id) => st.get().tracks.find((t) => t.id === id)?.name ?? null;
  const aimName = (k) => {
    const a = rec.aim(k);
    return a.track ? name(a.track) : 'new';
  };
  // a hum committed: notes on the grid from bar `bar`, then stop
  const hum = async (bar = 1, ps = [60, 64, 67]) => {
    engine.seek((bar - 1) * 4);
    // a hum take, as Hum it's R makes one, without the mic: the notes come in below
    await rec.record({ countIn: 0, quantize: false, hum: true });
    rec.addNotes(
      ps.map((p, i) => ({ p, g: (bar - 1) * 4 + i, d: 0.9, v: 0.8 })),
      { src: 'hum' },
    );
    await new Promise((res) => setTimeout(res, 150));
    return rec.stop();
  };
  const out = {};
  st.dispatch(
    [
      { type: 'track.add', ref: 'd', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
      { type: 'clip.add', track: '$d', clip: { start: 0, length: 8, notes: 'C2@0:1 D2@1:1' } },
      { type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
      { type: 'clip.add', track: '$b', clip: { start: 0, length: 8, notes: 'C2@0:2' } },
    ],
    { by: 'you' },
  );
  const ids = Object.fromEntries(st.get().tracks.map((t) => [t.name, t.id]));
  ui.select({ track: ids.Drums });
  out.first = aimName('hum');
  await hum(1);
  out.afterFirst = st.get().tracks.map((t) => t.name);
  out.selAfter = name(ui.state.selection.track);
  out.second = aimName('hum');
  // 'new' is one-shot: after its commit the next hum goes onto that track
  rec.setAim('hum', 'new');
  await hum(3);
  const made = st.get().tracks.at(-1);
  out.oneShot = { made: made.name, next: aimName('hum') };
  // a newer selection wins over the last take
  await new Promise((res) => setTimeout(res, 20));
  ui.select({ track: ids.Bass });
  out.selWins = aimName('hum');
  rec.setAim('hum', ids.Drums);
  out.ontoDrums = aimName('hum');
  rec.setAim('hum', null);
  out.pads = aimName('pads');
  // a hum over the same bars stacks; over other bars it's a clip beside
  ui.select({ track: made.id });
  const c1 = await hum(3, [62, 65]);
  out.stack = {
    offer: !!(c1 && (c1.stacked || c1.ownTrack || c1.offer || /own track/i.test(JSON.stringify(c1)))),
    muted: st
      .get()
      .tracks.find((t) => t.id === made.id)
      .clips.filter((c) => c.mute).length,
  };
  const c2 = await hum(7, [64]);
  out.beside = {
    muted: st
      .get()
      .tracks.find((t) => t.id === made.id)
      .clips.filter((c) => c.mute).length,
    ok: !!c2,
  };
  const r = out;
  assert.ok(
    r.first === 'new' && r.afterFirst.includes('Melody') && r.selAfter === 'Melody' && r.second === 'Melody',
    `4: with Drums selected a hum goes to a new track (Melody, selected), and the next onto Melody (${JSON.stringify(r)})`,
  );
  assert.ok(
    r.oneShot.next === r.oneShot.made && r.oneShot.made !== 'Melody 3',
    `4: 'new' is one-shot: the hum after it goes onto ${r.oneShot.made}, not another new track (${r.oneShot.next})`,
  );
  assert.ok(
    r.selWins === 'Bass' && r.ontoDrums === 'Drums' && r.pads === 'Drums',
    `4: a newer selection wins (Bass), Onto Drums puts a hum on Drums, pads aim at the only kit (${r.selWins}, ${r.ontoDrums}, ${r.pads})`,
  );
  assert.ok(
    r.stack.offer && r.stack.muted >= 1 && r.beside.muted === r.stack.muted && r.beside.ok,
    `4: a hum over the same bars stacks (an earlier take muted, the "own track" offer); over other bars nothing more is muted (${JSON.stringify(r.stack)} → ${JSON.stringify(r.beside)})`,
  );
});

test('4 the aim, full studio', () => {
  const { store: st, ui, rec } = aimRig('full');
  assert.ok(typeof rec.aim === 'function', '4: input/recorder.js has aim()');
  st.dispatch(
    [
      { type: 'track.add', ref: 'd', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
      { type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
      { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' }, arm: true } },
    ],
    { by: 'you' },
  );
  const ids = Object.fromEntries(st.get().tracks.map((t) => [t.name, t.id]));
  const name = (id) => st.get().tracks.find((t) => t.id === id)?.name ?? 'new';
  const f = { armed: name(rec.aim('hum').track) };
  rec.setAim('hum', 'new');
  f.newAim = name(rec.aim('hum').track);
  f.armedAfter = st
    .get()
    .tracks.filter((t) => t.arm)
    .map((t) => t.name);
  st.dispatch({ type: 'track.set', track: ids.Keys, patch: { arm: true } }, { by: 'you' });
  f.rearmed = name(rec.aim('hum').track);
  st.dispatch({ type: 'track.set', track: ids.Keys, patch: { arm: false } }, { by: 'you' });
  ui.select({ track: ids.Drums });
  f.drumsSel = name(rec.aim('hum').track);
  assert.ok(
    f.armed === 'Keys' && f.newAim === 'new' && !f.armedAfter.length && f.rearmed === 'Keys' && f.drumsSel === 'new',
    `4 (full studio): an armed Keys takes the hum; A new track disarms every track; arming by hand clears the choice; Drums selected with nothing armed aims at a new track, not Bass (${JSON.stringify(f)})`,
  );
});

test('13 the tool, catalog', async () => {
  const tools = await import('../../app/src/agent/tools.js');
  const extra = await import('../../app/src/agent/extra-schemas.js');
  const cat = await tools.catalogSchemas();
  const S = extra.SUGGEST_SOUNDS_SCHEMA;
  assert.ok(
    cat.length === 40 &&
      cat.some((x) => x.name === 'suggest_sounds') &&
      extra.EXTRA_SCHEMAS.includes(S) &&
      S.annotations?.readOnlyHint === false &&
      S.annotations?.destructiveHint === false,
    `13: suggest_sounds is the catalog's 40th tool, from extra-schemas.js, neither read-only nor destructive (${cat.length} tools)`,
  );
});
