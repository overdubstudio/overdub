// agent/cloud.js and agent/account.js: the Google sign-in popup's "signed in" message. It is taken only from the
// service's exact origin and only from the popup this tab opened; anything else asks the service nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloud } from '../../app/src/agent/cloud.js';
import { createAccount } from '../../app/src/agent/account.js';

const API = 'https://api.example.com';

/** A window with a popup it can open and the listeners the client adds; fetch counts /v1/me. */
function harness() {
  const listeners = new Map();
  const popup = {
    closed: false,
    close() {
      this.closed = true;
    },
  };
  const win = {
    document: { visibilityState: 'hidden' }, // no polling: only the message can ask
    open: () => popup,
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
  };
  let mes = 0;
  const fetch = async (url) => {
    if (String(url).endsWith('/v1/me')) {
      mes++;
      return new Response(JSON.stringify({ user: { id: 'usr_1', email: 'jess@example.com' } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  const post = (data, origin, source) => listeners.get('message')?.({ data, origin, source });
  return { win, fetch, popup, post, mes: () => mes };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

for (const [name, create] of [
  ['cloud.js', createCloud],
  ['account.js', createAccount],
]) {
  test(`${name}: "signed in" counts only from the service's origin and from the popup it opened`, async () => {
    const h = harness();
    const c = create({ api: API, fetch: h.fetch, win: h.win });
    c.signIn();
    assert.equal(c.state, 'waiting');
    const msg = { type: 'overdub:signed-in' };

    h.post(msg, 'https://evil.example', h.popup);
    h.post(msg, API, { closed: false }); // another window on the service's origin (another tab's done page)
    h.post(msg, API, null);
    await settle();
    assert.equal(h.mes(), 0, 'nothing asked /v1/me');
    assert.equal(c.state, 'waiting');

    h.post(msg, API, h.popup);
    await settle();
    assert.equal(h.mes(), 1);
    assert.equal(c.state, 'signed-in');
    c.cancelSignIn?.();
  });
}
