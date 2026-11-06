// An agent finds the sampled instruments: list_devices names each among its category, get_device gives its params and
// presets. Moved from the browser sections of tools/sampler-test.js, where each ran only with its kit fetched; the tools
// read the registry, not the kit, so all ten run here. The kits themselves and the page's render stay there.
import { test } from 'node:test';
import '../../app/src/devices/builtin/index.js';
import * as devices from '../../app/src/devices/registry.js';
import { checks } from './helpers/check.js';
import { fakeApp } from './helpers/fake-app.js';

const SAMPLED = [
  ['core.upright', 'Felt'],
  ['core.grand', 'Half stick'],
  ['core.ensemble', 'Soft bows'],
  ['core.vibes', 'Soft mallets'],
  ['core.ebass', 'Thumb'],
  ['core.eguitar', 'Jazz neck'],
  ['core.barisax', 'Subtone'],
  ['core.cello', 'Sul tasto'],
  ['core.flute', 'Breathy'],
  ['core.trumpet', 'Flugel'],
];

test('an agent finds every sampled instrument, its params and its presets', async () => {
  const t = checks();
  const app = fakeApp({ getDevice: devices.getDevice, devices });
  for (const [id, preset] of SAMPLED) {
    const d = devices.getDevice(id);
    const list = JSON.stringify(
      await app.tools.run('list_devices', { kind: 'instrument', cat: d.cat }, { by: 'claude' }),
    );
    const get = JSON.stringify(await app.tools.run('get_device', { id }, { by: 'claude' }));
    t.ok(
      list.includes(id) && list.includes(d.name) && /dynamics/.test(get) && get.includes(preset),
      `${d.name}: an agent finds it (list_devices names it among the ${d.cat}, get_device gives its params and presets)`,
    );
  }
  t.ok(devices.getDevice('core.upright').cat === 'keys', 'Parlour Upright is among the keys');
  t.done();
});
