// The studio's Overdub account, for Connect: sign in with Google, get a short tab ticket for the relay, list and
// disconnect the apps the account has allowed. It is the sign-in part of the cloud-credits branch's cloud.js (config,
// me, signIn in a popup, signOut) plus ticket(), grants() and disconnect(id); when that branch lands, cloud.js imports
// this instead of keeping its own copy.
//
//   const acct = createAccount({ api })          api: the account service's origin (none: the account is off)
//   acct.state  'signed-out' | 'waiting' | 'signed-in' | 'error'      acct.me (GET /v1/me) / acct.email / acct.error
//   acct.load() / acct.refresh() / acct.signIn() / acct.cancelSignIn() / acct.signOut()
//                                                   signIn opens <api>/v1/auth/google?return=studio in a popup: call it
//                                                   in the click handler itself, before any await
//   acct.ticket() -> { ticket, expiresAt, relay }   POST /v1/relay/ticket: five minutes, kept in memory only
//   acct.grants() -> [Grant] / acct.disconnect(id)  GET /v1/oauth/grants, DELETE /v1/oauth/grants/:id
//   acct.disconnectAll()                            DELETE /v1/oauth/grants
//   acct.signOutEverywhere()                        POST /v1/auth/logout-all: every browser of the account, this one
//                                                   too, and the apps allowed from other browsers (docs/OAUTH.md 6.2)
//   acct.on('state' | 'me', fn) -> off
//
// Every request carries the session cookie (credentials: 'include'), which is HttpOnly on the service's origin: this
// page never holds it. The ticket never goes in a URL or in storage.
//
// Signing in: the popup goes through Google and ends on the service's own page, /v1/auth/done, which sets the session
// cookie, posts { type: 'overdub:signed-in' } to this window and closes itself. The message only says "ask again": it
// is taken only from the service's exact origin, and all it does is GET /v1/me. The tab also asks /v1/me every 5 s
// while it's visible, and when it comes back into focus, for up to 10 minutes, so a blocked or lost message still
// signs it in.

const POLL_MS = 5000;
const POLL_FOR_MS = 10 * 60 * 1000;
const SIGNIN_PATH = '/v1/auth/google?return=studio';

export class AccountError extends Error {
  constructor(status, body = {}) {
    const e = (body && body.error) || {};
    super(e.message || (status ? `The account service answered ${status}.` : 'Couldn’t reach Overdub. Check your connection and try again.'));
    this.name = 'AccountError';
    this.status = status;
    this.code = e.code || (status ? 'http_' + status : 'unreachable');
  }
}

export function createAccount({ api = null, fetch: f = (...a) => globalThis.fetch(...a), win = globalThis } = {}) {
  const fns = new Map();
  const emit = (type, d) => { for (const fn of fns.get(type) || []) { try { fn(d); } catch (e) { console.error('account listener', type, e); } } };
  let state = 'signed-out', me = null, config = null, error = null;
  let pollT = 0, pollUntil = 0, popup = null;

  function setState(s, err = null) { state = s; error = err; emit('state', s); }
  function setMe(m) {
    me = m || null;
    if (me && state !== 'signed-in') { stopWaiting(); setState('signed-in'); } else if (!me && state === 'signed-in') setState('signed-out');
    emit('me', me);
  }

  async function req(method, path, body) {
    if (!api) throw new AccountError(0, { error: { code: 'off', message: 'Overdub accounts aren’t on in this studio.' } });
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try { res = await f(api + path, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); } catch { throw new AccountError(0); }
    if (res.status === 204) return null;
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    if (!res.ok) {
      if (res.status === 401 && me) setMe(null);
      throw new AccountError(res.status, j);
    }
    return j;
  }

  async function load() {
    try { config = await req('GET', '/v1/config'); } catch { config = null; }
    await refresh().catch(() => null);
    return config;
  }
  async function refresh() {
    try { setMe(await req('GET', '/v1/me')); } catch (e) { if (e.status === 401) { setMe(null); return null; } throw e; }
    return me;
  }
  // Google, in a popup: opened here, synchronously, so it counts as the click's own (an await before it and the browser
  // blocks it). A blocked popup is an 'error' the sheet shows.
  function signIn() {
    if (!api) { setState('error', new AccountError(0, { error: { code: 'off', message: 'Overdub accounts aren’t on in this studio.' } })); return; }
    stopWaiting();
    let w = null;
    try { w = win.open?.(api + SIGNIN_PATH, 'overdub-signin', 'popup,width=480,height=640') || null; } catch { w = null; }
    if (!w) { setState('error', new AccountError(0, { error: { code: 'popup_blocked', message: 'The sign-in window didn’t open. Allow pop-ups for this page, then try again.' } })); return; }
    popup = w;
    setState('waiting');
    startWaiting();
  }
  function cancelSignIn() { stopWaiting(); closePopup(); setState('signed-out'); }
  async function signOut() {
    try { await req('POST', '/v1/auth/logout', {}); } catch (e) { if (e.status !== 401) throw e; }
    setMe(null); setState('signed-out');
  }
  async function signOutEverywhere() {
    try { await req('POST', '/v1/auth/logout-all', {}); } catch (e) { if (e.status !== 401) throw e; }
    setMe(null); setState('signed-out');
  }
  // While the popup is out: the done page's message, focus coming back, and /v1/me every 5 s while the tab is visible,
  // for up to 10 minutes. Then it stops and goes back to signed out.
  function onMessage(ev) { if (state === 'waiting' && ev.origin === api && ev.data && ev.data.type === 'overdub:signed-in') refresh().catch(() => {}); }
  function onFocus() { if (state === 'waiting') refresh().catch(() => {}); }
  function startWaiting() { pollUntil = Date.now() + POLL_FOR_MS; schedule(); win.addEventListener?.('message', onMessage); win.addEventListener?.('focus', onFocus); }
  function stopWaiting() { clearTimeout(pollT); pollT = 0; win.removeEventListener?.('message', onMessage); win.removeEventListener?.('focus', onFocus); if (state === 'waiting') closePopup(); }
  function closePopup() { try { if (popup && !popup.closed) popup.close(); } catch { /* gone already */ } popup = null; }
  function schedule() {
    clearTimeout(pollT);
    pollT = setTimeout(async () => {
      if (state !== 'waiting') return;
      if (Date.now() > pollUntil) { cancelSignIn(); return; }
      if (win.document?.visibilityState !== 'hidden') await refresh().catch(() => {});
      if (state === 'waiting') schedule();
    }, POLL_MS);
  }

  const ticket = () => req('POST', '/v1/relay/ticket', {});
  async function grants() { const r = await req('GET', '/v1/oauth/grants'); return Array.isArray(r?.grants) ? r.grants : []; }
  const disconnect = (id) => req('DELETE', `/v1/oauth/grants/${encodeURIComponent(id)}`);
  const disconnectAll = () => req('DELETE', '/v1/oauth/grants');

  return {
    get enabled() { return !!api; },
    api,
    get state() { return state; },
    get me() { return me; },
    get email() { return me?.user?.email || ''; },
    get error() { return error; },
    load, refresh, signIn, cancelSignIn, signOut, signOutEverywhere, ticket, grants, disconnect, disconnectAll,
    on(type, fn) { if (!fns.has(type)) fns.set(type, new Set()); fns.get(type).add(fn); return () => fns.get(type)?.delete(fn); },
  };
}
