// Picking a sound (docs/INSTRUMENTS-UX.md, section 6.1), the Node sections 1-3: kindOfTake, soundsFor, newPartFor
// (core/sounds.js). Moved intact from tools/pick-sound-test.js; the tool (13) and the browser sections stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUM_NOTES } from '../../tools/fake-wav.js';

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
