// A studio without a page, for the agent tools: the same four pieces installTools(app) takes in the browser
// ({ store, devices.getDevice, ui.emit, ui.toast }) and nothing else. Not a test (the unit glob is *.test.js).
import installArrangement from '../../../app/src/agent/arrangement-tool.js';
import { installTools } from '../../../app/src/agent/tools.js';
import installTransforms from '../../../app/src/agent/transforms-tool.js';
import { createStore } from '../../../app/src/core/store.js';

// Every id is a device with no params; effects are told apart by name, as the checks always did.
export const plainDevice = (id) => ({
  id,
  name: id,
  kind: /eq|comp|verb|drive|fuzz/.test(id) ? 'effect' : 'instrument',
  params: [],
});

// -> app, with .toasts and .events (what ui.toast and ui.emit were given) beside the usual pieces.
//   getDevice: the registry's lookup;  setup: ops dispatched as 'you' into the new store;  project: a song to start from;
//   extras: 'transforms' / 'arrangement', the tool installers beyond installTools;  props: anything else the app
//   carries (share, trust, ...)
export function fakeApp({ getDevice = plainDevice, setup = null, project = null, extras = [], props = {} } = {}) {
  const store = createStore(project, { getDevice });
  if (setup) store.dispatch(setup, { by: 'you' });
  const toasts = [];
  const events = [];
  const app = {
    store,
    devices: { getDevice },
    ui: { emit: (n, x) => events.push([n, x]), toast: (x) => toasts.push(x) },
    toasts,
    events,
    ...props,
  };
  installTools(app);
  if (extras.includes('transforms')) installTransforms(app);
  if (extras.includes('arrangement')) installArrangement(app);
  return app;
}
