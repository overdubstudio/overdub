// What an agent is told about presets: list_devices and get_device name the presets the rack's menu lists, in the same
// order; an instrument.set with a preset's params lands on that name in get_project, and an edit takes the claim away.
// The rack's own menu (the line under the caption, the list, the keys) is checked in a real studio by tools/presets-test.js.
import { test } from 'node:test';
import { demoProject } from '../../app/src/core/demo.js';
import '../../app/src/devices/builtin/index.js';
import * as devices from '../../app/src/devices/registry.js';
import { checks } from './helpers/check.js';
import { fakeApp } from './helpers/fake-app.js';

test('an agent reads and applies presets by the names the rack shows', async () => {
  const t = checks();
  const app = fakeApp({ getDevice: devices.getDevice, devices, project: demoProject() });
  const run = (name, input, by = 'claude') => app.tools.run(name, input, { by });
  const keys = app.store.get().tracks.find((x) => x.name === 'Keys');
  app.store.dispatch({ type: 'instrument.set', track: keys.id, device: 'core.piano' }, { by: 'you', label: 'piano' });
  const presetNames = devices.getDevice('core.piano').presets.map((p) => p.name);

  const ld = await run('list_devices', { kind: 'instrument', query: 'Baby Grand', detail: 'brief' });
  const ldText = JSON.stringify(ld);
  t.ok(
    presetNames.every((n) => ldText.includes(n)),
    'list_devices lists the names the rack does',
  );
  const gd = await run('get_device', { id: 'core.piano' });
  t.ok(
    JSON.stringify(gd.presets.map((p) => p.name)) === JSON.stringify(presetNames),
    'get_device has the same presets, in the same order',
  );
  const bright = gd.presets.find((p) => p.name === 'Bright pop') || gd.presets[0];
  const ap = await run('apply_ops', {
    ops: [{ type: 'instrument.set', track: 'Keys', params: bright.params }],
    label: `${bright.name} on the keys`,
  });
  t.ok(
    ap.ok !== false && !ap.error,
    "an agent applies get_device's params with instrument.set" + (ap.error ? ': ' + ap.error : ''),
  );
  const gp = await run('get_project', { track: 'Keys' });
  t.ok(
    Array.isArray(gp.presets) && gp.presets.includes(`Keys: Baby Grand, ${bright.name}`),
    `get_project tells the agent the name the rack shows (${JSON.stringify(gp.presets)})`,
  );
  // the human edits it: the agent no longer reads it as that preset
  app.store.dispatch({ type: 'instrument.set', track: keys.id, params: { room: 0.9 } }, { by: 'you' });
  const gp2 = await run('get_project', { track: 'Keys' });
  t.ok(!(gp2.presets || []).some((x) => x.startsWith('Keys:')), "once edited, get_project doesn't claim a preset");
  t.done();
});
