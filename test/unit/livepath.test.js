// The live path's rules (docs/research/AMP-PATH.md §3, §4, §7; app/src/input/livepath.js, pure): monitoring decided by
// itself for an input, which input every opener picks, the device behind the browser's "Default - " entry, and the
// health check's verdict on a measurement. And the device lifecycle's helpers (app/src/devices/lifecycle.js). The
// running path is tools/amp-soak.js's and the suites', in muted Chromium.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { autoMonitor, chooseInput, realIdOf, pathVerdict, LINES, say, HEALTH } from '../../app/src/input/livepath.js';
import { failure, failureCode, healthOf, assure, FAILURE_CODES } from '../../app/src/devices/lifecycle.js';
import { inputKind } from '../../app/src/input/audioin.js';

// AJ's Mac with the Scarlett in, as Chrome lists it once the microphone is allowed
const SCARLETT = 'Scarlett Solo USB (1235:8211)';
const MAC = 'MacBook Pro Microphone (Built-in)';
const withKinds = (list) => list.map((d) => ({ ...d, kind: inputKind(d.label, { isDefault: d.id === 'default' }) }));
const AJ = withKinds([
  { id: 'default', groupId: 'g-scar', label: 'Default - ' + SCARLETT },
  { id: 'scar', groupId: 'g-scar', label: SCARLETT },
  { id: 'mac', groupId: 'g-mac', label: MAC },
]);
const BLIND = [{ id: '', groupId: '', label: '' }];

describe('monitoring, decided by itself', () => {
  test('an interface monitors, opened by its own entry or as the browser default', () => {
    assert.deepEqual(autoMonitor({ kind: inputKind(SCARLETT), channels: 2 }), { on: true, why: '' });
    const asDefault = inputKind('Default - ' + SCARLETT, { isDefault: true, channels: 2 });
    assert.equal(asDefault, 'interface');
    assert.equal(autoMonitor({ kind: asDefault, channels: 2 }).on, true);
  });
  test('a microphone and a loopback stay off, saying why', () => {
    assert.deepEqual(autoMonitor({ kind: inputKind(MAC), channels: 1 }), { on: false, why: 'mic' });
    assert.deepEqual(autoMonitor({ kind: inputKind('BlackHole 2ch'), channels: 2 }), { on: false, why: 'virtual' });
  });
  test('an input it can’t name: on in the guitar room with two or more channels, off elsewhere', () => {
    assert.equal(autoMonitor({ kind: '', channels: 2, role: 'instrument' }).on, true);
    assert.equal(autoMonitor({ kind: '', channels: 1, role: 'instrument' }).on, false);
    assert.equal(autoMonitor({ kind: '', channels: 2 }).on, false);
  });
});

describe('the device behind "Default - "', () => {
  test('its own id when it has one', () => assert.equal(realIdOf(AJ, { deviceId: 'scar' }), 'scar'));
  test('by group id, else by name', () => {
    assert.equal(realIdOf(AJ, { deviceId: 'default', groupId: 'g-scar' }), 'scar');
    assert.equal(realIdOf(AJ, { deviceId: 'default', label: 'Default - ' + SCARLETT }), 'scar');
    assert.equal(realIdOf(AJ, { deviceId: 'default', label: SCARLETT }), 'scar');
  });
  test('can’t tell: empty', () => {
    assert.equal(realIdOf(AJ, { deviceId: 'default' }), '');
    assert.equal(realIdOf(BLIND, { deviceId: 'default', groupId: 'x', label: 'x' }), '');
  });
});

describe('which input to open', () => {
  test('no labels yet (a first visit): the browser default, and choose again once it’s open', () => {
    assert.deepEqual(chooseInput(BLIND, { remembered: '', channel: '1' }), {
      device: '',
      channel: '1',
      why: 'blind',
      reask: true,
    });
    assert.equal(chooseInput([], {}).why, 'blind');
  });
  test('the remembered device, on its channel', () => {
    assert.deepEqual(chooseInput(AJ, { remembered: 'scar', channel: '2' }), {
      device: 'scar',
      channel: '2',
      why: 'remembered',
      reask: false,
    });
  });
  test('a remembered "Default - " is the device it names, never the entry', () => {
    const c = chooseInput(AJ, { remembered: 'default', channel: '2' });
    assert.equal(c.device, 'scar');
    assert.equal(c.channel, '2');
  });
  test('nothing remembered: the interface by its own entry', () => {
    assert.deepEqual(chooseInput(AJ, {}), { device: 'scar', channel: '1', why: 'interface', reask: false });
  });
  test('the remembered id gone (another USB port, site data cleared): the interface, said as moved', () => {
    const c = chooseInput(AJ, { remembered: 'f'.repeat(64), channel: '2' });
    assert.equal(c.device, 'scar');
    assert.equal(c.why, 'moved');
    assert.equal(c.channel, '2');
  });
  test('a remembered microphone: kept, except in the guitar room with an interface in', () => {
    assert.equal(chooseInput(AJ, { remembered: 'mac' }).device, 'mac');
    const g = chooseInput(AJ, { remembered: 'mac', role: 'instrument' });
    assert.equal(g.device, 'scar');
    assert.equal(g.why, 'instrument');
  });
  test('no interface: the device the default names, on input 1 for a microphone', () => {
    const mac = withKinds([
      { id: 'default', groupId: 'g-mac', label: 'Default - ' + MAC },
      { id: 'mac', groupId: 'g-mac', label: MAC },
    ]);
    assert.deepEqual(chooseInput(mac, { channel: '2' }), { device: 'mac', channel: '1', why: 'default', reask: false });
    assert.equal(chooseInput(mac, { remembered: 'gone-id' }).why, 'gone');
  });
});

const ok = { ok: true, failed: '', settled: true, known: true };
const club = (over = {}) => ({
  open: true,
  ctx: 'running',
  engine: true,
  monitoring: true,
  holds: [],
  track: { id: 't1', name: 'Guitar L' },
  audible: true,
  levels: { in: -20.5, strip: -20.5, chain: -15 },
  inserts: [
    { id: 'gate', device: 'pedal.gate', name: 'Snapper', on: true, health: ok },
    { id: 'amp', device: 'amp.recto', name: 'Kraken', on: true, amp: true, health: ok },
  ],
  dryLike: false,
  ...over,
});

describe('the health check’s verdict', () => {
  test('the club stack, wet: ok', () => assert.equal(pathVerdict(club()).state, 'ok'));
  test('in order: closed, suspended, no engine, off, held, waiting, quiet', () => {
    assert.equal(pathVerdict(club({ open: false })).state, 'closed');
    assert.deepEqual(pathVerdict(club({ ctx: 'suspended' })), {
      state: 'suspended',
      repair: 'resume',
      insert: null,
      key: 'suspended',
      line: LINES.suspended,
    });
    assert.equal(pathVerdict(club({ engine: false })).key, 'noEngine');
    assert.equal(pathVerdict(club({ monitoring: false })).line, LINES.off);
    assert.equal(pathVerdict(club({ monitoring: false, monitorOff: 'mic' })).key, 'offMic');
    assert.equal(pathVerdict(club({ monitoring: false, monitorOff: 'feedback' })).line, '');
    assert.equal(pathVerdict(club({ holds: ['tuner'] })).state, 'held');
    assert.equal(pathVerdict(club({ track: null })).state, 'waiting');
    assert.equal(pathVerdict(club({ levels: { in: -75, strip: -200, chain: -200 } })).state, 'quiet');
  });
  test('the input moves and the strip doesn’t: rewire', () => {
    const v = pathVerdict(club({ levels: { in: -20.5, strip: -200, chain: -200 } }));
    assert.equal(v.state, 'unwired');
    assert.equal(v.repair, 'rewire');
    assert.equal(v.line, 'Your input wasn’t reaching Guitar L. Plugged it back in.');
  });
  test('a stand-in: rebuild, naming it', () => {
    const v = pathVerdict(
      club({
        inserts: [
          { id: 'amp', name: 'Kraken', on: true, amp: true, health: { ok: false, failed: 'stand-in', settled: true } },
        ],
      }),
    );
    assert.deepEqual([v.state, v.repair, v.insert], ['stand-in', 'rebuild', 'amp']);
    assert.match(v.line, /^Kraken didn’t build/);
  });
  test('a device stuck at the wrong bypass once settled: assure; still fading: not yet', () => {
    const stuck = { ok: false, failed: '', settled: true, known: true };
    assert.deepEqual(
      pathVerdict(club({ inserts: [{ id: 'amp', name: 'Kraken', on: true, amp: true, health: stuck }] })).repair,
      'assure',
    );
    assert.equal(
      pathVerdict(club({ inserts: [{ id: 'amp', on: true, amp: true, health: { ...stuck, settled: false } }] })).state,
      'ok',
    );
  });
  test('the strip plays and the chain’s end doesn’t: rebuild; under a gate’s threshold: not judged', () => {
    assert.equal(pathVerdict(club({ levels: { in: -20.5, strip: -20.5, chain: -200 } })).state, 'silent');
    assert.equal(pathVerdict(club({ levels: { in: -50, strip: -50, chain: -200 } })).state, 'ok');
  });
  test('an amp on and the chain’s end a copy of its input: dry; no amp on: fine', () => {
    assert.equal(pathVerdict(club({ dryLike: true })).state, 'dry');
    const off = club({ dryLike: true });
    off.inserts = off.inserts.map((x) => ({ ...x, on: x.amp ? false : x.on }));
    assert.equal(pathVerdict(off).state, 'ok');
  });
  test('muted in the control room: said, not repaired', () => {
    const v = pathVerdict(club({ audible: false }));
    assert.deepEqual([v.state, v.repair], ['muted', 'none']);
    assert.equal(v.line, 'Guitar L is muted in the control room, so you can’t hear the rig.');
  });
  test('the lines fill their blanks, and fall back to words', () => {
    assert.equal(
      say('moved', { label: 'Scarlett Solo USB' }),
      'Opened Scarlett Solo USB: the input you used last time isn’t plugged in.',
    );
    assert.equal(say('unwired'), 'Your input wasn’t reaching the track. Plugged it back in.');
    for (const s of Object.values(LINES)) assert.doesNotMatch(s, /!|sorry|oops/i);
  });
  test('the thresholds hang together', () => {
    assert.ok(HEALTH.silent < HEALTH.quiet && HEALTH.quiet < HEALTH.playing);
    assert.ok(HEALTH.after < HEALTH.every && HEALTH.tries >= 1);
  });
});

describe('the device lifecycle', () => {
  test('a failure carries its code', () => {
    const e = failure('worklet', 'the gate’s worklet didn’t load');
    assert.equal(e.code, 'worklet');
    assert.equal(failureCode(e), 'worklet');
    assert.equal(failureCode(new Error('x')), '');
    assert.equal(failure(/** @type {any} */ ('nope'), 'x').code, 'threw');
    assert.deepEqual([...FAILURE_CODES], ['threw', 'no-output', 'worklet']);
  });
  test('health: a stand-in is a failure; a device without health() is ok; one that throws is not', () => {
    assert.equal(healthOf({ fallback: true }).failed, 'stand-in');
    assert.equal(healthOf({ on: true }).ok, true);
    assert.equal(healthOf(null).ok, false);
    assert.equal(
      healthOf({
        health() {
          throw new Error('boom');
        },
      }).ok,
      false,
    );
    const h = healthOf({
      on: true,
      health: () => ({ ok: false, on: true, settled: true, dry: 1, wet: 0.5, want: { dry: 0, wet: 0.5 } }),
    });
    assert.deepEqual([h.ok, h.dry, h.wet, h.known], [false, 1, 0.5, true]);
  });
  test('assure asks the device, and never throws', () => {
    assert.equal(assure({ assure: () => true }), true);
    assert.equal(assure({}), false);
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(
        assure({
          assure() {
            throw new Error('x');
          },
        }),
        false,
      );
    } finally {
      console.warn = warn;
    }
  });
});
