// The Guitar Studio's registry, in Node: every pedal and amp of the gear is registered (ids kept: pedal.<id>,
// amp.<id>), none refused, every rig's devices exist, every param's default is in range; every worklet the gear's code
// builds is a file of its own (gear/worklets/) with that source byte for byte, and the pedals and amps name those
// files; rigOps dispatch through the real store. Moved from tools/guitar-test.js section 1.
import { test } from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { T as t } from './_t.js';
import * as G from '../../app/src/devices/guitar/index.js';
import * as R from '../../app/src/devices/registry.js';
import { WORKLETS } from '../../app/src/devices/guitar/gear/index.js';
import { createStore } from '../../app/src/core/store.js';

test('every pedal, amp and rig is registered; every param default is in range', () => {
  const pedals = R.listDevices().filter((d) => d.id.startsWith('pedal.')),
    amps = R.listDevices({ cat: 'amp' }).filter((d) => d.id.startsWith('amp.'));
  const missing = [];
  for (const r of G.RIGS) for (const s of r.chain) if (!R.getDevice(s.device)) missing.push(`${r.id}:${s.device}`);
  const ids = G.gear.PEDAL_LIST.map((d) => d.id).filter((id) => !R.getDevice(`pedal.${id}`));
  const badParams = [];
  for (const d of pedals.concat(amps))
    for (const p of d.params) {
      if (!(p.def >= Math.min(p.min, p.max) && p.def <= Math.max(p.min, p.max))) badParams.push(`${d.id}.${p.key}`);
      if (p.fmt) {
        try {
          if (typeof p.fmt(p.def) !== 'string') badParams.push(`${d.id}.${p.key} fmt`);
        } catch {
          badParams.push(`${d.id}.${p.key} fmt threw`);
        }
      }
    }
  const refused = G.gear.PFX.refused;
  const clawdAmps = Object.keys(G.gear.PLUG_AMPS).length;
  t.ok(
    pedals.length === G.gear.PEDAL_LIST.length && pedals.length >= 100 && !ids.length,
    `${pedals.length} pedals registered (the gear has ${G.gear.PEDAL_LIST.length}) as pedal.<id>${ids.length ? `; missing ${ids.join(' ')}` : ''}`,
  );
  t.ok(!refused.length, `no pedal refused by its pedalDef${refused.length ? `: ${JSON.stringify(refused)}` : ''}`);
  t.ok(
    amps.length === clawdAmps && amps.length >= 27,
    `${amps.length} amps registered as amp.<id> (the gear has ${clawdAmps})`,
  );
  t.ok(
    G.RIGS.length === G.gear.PLUG_PRESETS.length && G.RIGS.length > 100,
    `${G.RIGS.length} rigs from ${G.RIG_BANKS.length} banks (every preset)`,
  );
  t.ok(
    !missing.length,
    `every rig's devices are registered${missing.length ? `: ${missing.slice(0, 5).join(' ')}` : ''}`,
  );
  t.ok(
    !badParams.length,
    `every param's default is in range and its fmt returns a string${badParams.length ? `: ${badParams.slice(0, 5).join(' ')}` : ''}`,
  );
});

test('each worklet the gear builds is a file of its own with its source byte for byte, and the devices name those files', () => {
  const dir = fileURLToPath(new URL('../../app/src/devices/guitar/gear/worklets/', import.meta.url));
  const src = { 'clawd-amps': G.gear.PLUG_WORKLETS };
  for (const [n, w] of Object.entries(G.gear.PFX.worklets)) src[n] = w.src;
  const diff = [],
    files = Object.values(WORKLETS);
  for (const [n, s] of Object.entries(src)) {
    if (!WORKLETS[n]) {
      diff.push(`${n}: no file`);
      continue;
    }
    const f = fileURLToPath(WORKLETS[n]);
    if (!f.startsWith(dir)) diff.push(`${n}: ${WORKLETS[n]}`);
    else {
      const text = fs.readFileSync(f, 'utf8');
      if (text.slice(text.indexOf('\n') + 1) !== s) diff.push(`${n}: not its source`);
    }
  }
  const devs = R.listDevices().filter((d) => /^(pedal|amp)\./.test(d.id) && d.worklets);
  const named = devs.flatMap((d) =>
    Object.entries(d.worklets)
      .filter(([n, u]) => u !== WORKLETS[n] || !files.includes(u))
      .map(([n]) => `${d.id}:${n}`),
  );
  t.ok(
    Object.keys(src).length >= 40 && files.length === Object.keys(src).length && !diff.length,
    `${Object.keys(src).length} worklets the gear's code builds, each a file of its own with its source byte for byte (gear/worklets/)${diff.length ? `: ${diff.slice(0, 5).join(', ')}` : ''}`,
  );
  t.ok(
    devs.length >= 30 && !named.length,
    `the ${devs.length} pedals and amps with worklets load them from those files${named.length ? `; not: ${named.slice(0, 5).join(' ')}` : ''}`,
  );
});

test("rigOps through the store: a rig's inserts, then another replacing it", () => {
  const store = createStore();
  let r = store.dispatch({ type: 'track.add', track: { name: 'Guitar', kind: 'audio' }, ref: 'g' }, { by: 'you' });
  t.ok(r.ok, r.error);
  const tid = r.created.g || Object.values(r.created)[0];
  const rig = G.rigById('webcam') || G.RIGS[0];
  r = store.dispatch(G.rigOps(tid, rig), { by: 'claude', label: `rig ${rig.name}` });
  t.ok(r.ok, r.error);
  const first = store.track(tid).inserts.map((x) => x.id);
  const rig2 = G.RIGS.find((x) => x.chain.length > 3 && x.id !== rig.id);
  r = store.dispatch(G.rigOps(tid, rig2, { replace: first }), { by: 'claude' });
  t.ok(r.ok, r.error);
  const t2 = store.track(tid);
  t.ok(
    first.length === rig.chain.length &&
      t2.inserts.length === rig2.chain.length &&
      t2.inserts.every((x, k) => x.device === rig2.chain[k].device && x.on === rig2.chain[k].on),
    `rigOps through the store: a rig's ${rig.chain.length} inserts, then another replacing it (${t2.inserts.map((x) => x.device).join(' ')})`,
  );
});
