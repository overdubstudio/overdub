// Half Stack (core.stack), the device's contract: its params in their forever order, roles and descs, the cab bank it
// names, the defaults, the presets, no trademark in its words, its latency, the tone stack's functions in the kernel.
// Moved from tools/stack-test.js ('the device'); the DSP checks stay there.
import { test } from 'node:test';
import '../../app/src/devices/builtin/index.js';
import def from '../../app/src/devices/builtin/stack.js';
import {
  tmbAnalog,
  tmbCoefs,
  CABS_HASH,
  CAB_LABELS,
  CAB_FILTER,
  CAB_OFF,
} from '../../app/src/devices/builtin/amp-lib.js';
import { presetParams } from '../../app/src/devices/registry.js';
import { SR } from '../../tools/amp-scenes.js';
import { T } from './_t.js';

const ok = T.ok;
const TM =
  /marshall|mesa|boogie|rectifier|5150|peavey|evh|engl|bogner|diezel|celestion|vintage 30|v30|greenback|eminence|shure|sm57|sennheiser|e606|tube ?screamer|ibanez|ts-?808|ts-?9|maxon|jester|cookie|bubba|kitten|nacho|pesto|fender|bassman/i;

test('the device: params, roles, cab bank, defaults, presets, wording, latency, kernel', () => {
  ok(
    def &&
      def.id === 'core.stack' &&
      def.name === 'Half Stack' &&
      def.kind === 'effect' &&
      def.cat === 'amp' &&
      def.source !== 'project',
    `core.stack is Half Stack, an amp (${def.name}, ${def.cat})`,
  );
  const KEYS = [
    'gate',
    'tight',
    'boost',
    'boost_drive',
    'boost_level',
    'gain',
    'bass',
    'mid',
    'treble',
    'master',
    'sag',
    'presence',
    'depth',
    'cab',
    'low_cut',
    'high_cut',
    'level',
    'quality',
  ];
  ok(
    JSON.stringify(def.params.map((p) => p.key)) === JSON.stringify(KEYS),
    `its params, in the order they keep: ${KEYS.join(', ')}`,
  );
  ok(
    def.params.every((p) => p.role && typeof p.desc === 'string' && p.desc.length >= 20),
    'every param has a role and a desc an agent can act on',
  );
  const cab = def.params.find((p) => p.key === 'cab');
  ok(
    JSON.stringify(cab.opts) === JSON.stringify(CAB_LABELS) &&
      cab.def === 0 &&
      CAB_LABELS[CAB_FILTER] === 'FILTER 4X12' &&
      CAB_LABELS[CAB_OFF] === 'OFF',
    `CAB: ${cab.opts.join(', ')}`,
  );
  const d = Object.fromEntries(def.params.map((p) => [p.key, p.def]));
  ok(
    d.gate === -70 &&
      d.tight === 110 &&
      d.boost === 1 &&
      d.boost_drive === 0.1 &&
      d.boost_level === 9 &&
      d.low_cut === 80 &&
      d.high_cut === 10000 &&
      d.quality === 0,
    'the defaults: GATE -70, TIGHT 110, boost on (drive 0.1, level 9), LOW CUT 80, HIGH CUT 10k, 4X',
  );
  ok(
    JSON.stringify(def.presets.map((p) => p.name)) === JSON.stringify(['Modern', 'Djent', 'Thrash', 'Doom', 'Lead']),
    `its presets: ${def.presets.map((p) => p.name).join(', ')}`,
  );
  const m = presetParams(def, 'Modern');
  ok(
    m.gain === 6.5 &&
      m.boost === 1 &&
      m.tight === 110 &&
      m.bass === 5 &&
      m.mid === 5.5 &&
      m.treble === 6 &&
      m.presence === 5.5 &&
      m.cab === 0,
    'Modern is the rhythm setting the tone targets are measured on (GAIN 6.5, boost on, TIGHT 110, BASS 5, MID 5.5, TREBLE 6, PRESENCE 5.5, the close dynamic cab)',
  );
  const text = [
    def.name,
    def.blurb,
    def.nod,
    ...def.params.map((p) => p.desc + ' ' + (p.opts || []).join(' ')),
    ...def.presets.map((p) => p.name + ' ' + p.blurb),
  ].join(' ');
  ok(!TM.test(text), `no trademark or pack patch name in its name, nod, descs or presets ("${def.nod}")`);
  ok(def.data && def.data.cabs === CABS_HASH, `it names the cab bank as kernel data (${CABS_HASH.slice(0, 19)}...)`);
  ok(Math.round(def.latency * SR) === 28, `it declares 28 samples of latency (${(def.latency * 1000).toFixed(2)} ms)`);
  ok(
    def.kernel.includes(tmbAnalog.toString()) && def.kernel.includes(tmbCoefs.toString()),
    "the kernel carries the tone stack's own functions (their source is in it)",
  );
});
