// The refusals of the agents' tab tools (agent/tabs-tool.js: tab_for, write_tab, suggest_riff) on the demo song in Node,
// moved from section 6 of tools/tabs-test.js: each says what would work and changes nothing. What the tools do in a studio
// (a clip in free bars, a card over notes, the takes on the lane, recording) stays in the browser there. The Jam room is
// the three-method fake the tools take (`room`), since an error comes back before they reach for it.
import { test } from 'node:test';
import { demoProject } from '../../app/src/core/demo.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { installTabTools } from '../../app/src/agent/tabs-tool.js';
import { checks } from './helpers/check.js';
import { fakeApp } from './helpers/fake-app.js';

const RIFF_TAB = `  |1e+a2e+a3e+a4e+a|1e+a2e+a3e+a4e+a|
e |----------------|----------------|
B |----------------|----------------|
G |--------2===----|----------------|
D |----2=3=----2=0=|2=======--------|
A |0===--------3=--|----------------|
E |----------------|----------------|`;

test("the tab tools' errors say what would work", async () => {
  const T = checks();
  const app = fakeApp({ getDevice, project: demoProject() });
  const room = { tuning: () => 'standard', guitars: () => ({ keys: null, audio: null }), guitarOp: () => null };
  app.tools = installTabTools(app, room);
  const run = (name, input, by = 'mcp:test') => app.tools.run(name, input, { by });
  const before = JSON.stringify(app.store.get());

  // tab_for
  const te = await Promise.all([
    run('tab_for', {}),
    run('tab_for', { track: 'Nope' }),
    run('tab_for', { track: 'Guitar' }),
    run('tab_for', { track: 'Drums' }),
  ]);
  T.ok(
    /missing "track"/.test(te[0].error) &&
      /no track/.test(te[1].error) &&
      /tracks:/.test(te[1].hint) &&
      /audio track/.test(te[2].error) &&
      /drum track/.test(te[3].error),
    `tab_for's errors say what would work ("${te[2].error}"; "${te[3].error}")`,
  );

  // write_tab
  const we = await Promise.all([
    run('write_tab', { tab: 'nothing like tab', at_bar: 1 }),
    run('write_tab', { tab: RIFF_TAB }),
    run('write_tab', { tab: RIFF_TAB, at_bar: 1, track: 'Guitar' }),
    run('write_tab', { tab: RIFF_TAB, at_bar: 1, tuning: 'banjo' }),
    run('write_tab', { tab: RIFF_TAB.split('\n').slice(0, 4).join('\n'), at_bar: 1 }),
  ]);
  T.ok(
    /can't read the tab: no lines of tab/.test(we[0].error) &&
      /six lines/.test(we[0].hint) &&
      /at_bar/.test(we[1].error) &&
      /audio track/.test(we[2].error) &&
      /no tuning "banjo"/.test(we[3].error) &&
      /expected 6 lines/.test(we[4].error),
    `write_tab's errors say what would work ("${we[0].error}"; "${we[4].error}")`,
  );

  // suggest_riff
  const se = await Promise.all([
    run('suggest_riff', { section: 'Coda' }),
    run('suggest_riff', { style: 'polka' }),
    run('suggest_riff', { takes: 7 }),
    run('suggest_riff', { difficulty: 'brutal' }),
  ]);
  T.ok(
    /no section "Coda"/.test(se[0].error) &&
      /Verse, Chorus/.test(se[0].hint) &&
      /no riff style/.test(se[1].error) &&
      /blues/.test(se[1].hint) &&
      /takes: 2 to 4/.test(se[2].error) &&
      /no difficulty/.test(se[3].error),
    `suggest_riff's errors say what would work ("${se[0].error}"; "${se[1].error}")`,
  );
  T.ok(JSON.stringify(app.store.get()) === before, 'a refusal changes nothing in the song');
  T.done();
});
