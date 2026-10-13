// The hosted agent's account side: "Claude on Overdub credits", a service run by Overdub that lets someone without
// their own Claude set-up use the real agent, paid for with credits. It is OFF unless the deploy names its origin
// (app/src/site-config.js); forks and self-hosted copies never see it. The open studio holds no prices: the rate card,
// plans and packs come from the service's GET /v1/config at runtime.
//
//   const cloud = createCloud({ api, fetch })
//   cloud.enabled / cloud.api / cloud.state ('signed-out' | 'waiting' | 'signed-in' | 'error')
//   cloud.me (GET /v1/me, or null) / cloud.config (GET /v1/config, or null) / cloud.error
//   cloud.load()                         -> config, then me (both quietly: a service that's down leaves cloud.config null)
//   cloud.refresh() -> me | null         401: signed out
//   cloud.signIn()                       Google: a popup to <api>/v1/auth/google?return=studio -> 'waiting'. Call it in
//                                        the click handler itself, before any await, or the browser blocks the popup
//   cloud.cancelSignIn() / cloud.signOut()      signing out (and deleting) also drops this browser's ask-to-takes map
//   cloud.open({ kind, moreTime, promptVersion }, key) -> ActionOpened      key: one Idempotency-Key per Send press
//   cloud.call(actionId, body, signal) -> Response                         the raw event stream (or a JSON error)
//   cloud.wait(actionId) / cloud.finish(actionId, { outcome, cardPending, deviceWritten }) -> Settlement
//   cloud.creditBack(actionId, reason, key) -> { creditedBack, creditBackLeft, balance }
//   cloud.claimTrial() -> me / cloud.checkout(sku) -> { url, checkoutRef }
//   cloud.sync(checkoutRef) -> { me, paid }   paid: the service says that checkout is paid (so its credits are in)
//   cloud.activity({ before }) -> { items, next } / cloud.deleteAccount({ cancelPlan, forfeitCredits })
//   cloud.rateCard() -> [{ kind, label, credits }] / cloud.setBalance(balance)
//   cloud.on(type, fn) -> off            'state', 'me', 'config'
//
// Every request carries the session cookie (credentials: 'include'); the cookie is httpOnly on the service's origin, so
// this page never holds a token. Nothing from /v1/me is stored in the browser. Errors are CloudError
// { status, code, message, details }, the message written for a musician by the service.
//
// Signing in: the popup goes through Google and ends on the service's own page, /v1/auth/done, which sets the session
// cookie, posts { type: 'overdub:signed-in' } to this window and closes itself. The message only says "ask again": it
// is taken only from the service's exact origin and the popup this tab opened, and all it does is GET /v1/me. The
// tab also asks /v1/me every 5 s while it's visible, and when it comes back into focus, for up to 10 minutes, so a
// blocked or lost message still signs it in.

export const HOSTED_NAME = 'Claude on Overdub credits';
const POLL_MS = 5000;
const POLL_FOR_MS = 10 * 60 * 1000;
const SIGNIN_PATH = '/v1/auth/google?return=studio';

export class CloudError extends Error {
  constructor(status, body = {}) {
    const e = body && body.error || {};
    super(e.message || (status ? `The service answered ${status}.` : 'Couldn’t reach Claude on Overdub credits. Check your connection and try again.'));
    this.name = 'CloudError';
    this.status = status;
    this.code = e.code || (status ? 'http_' + status : 'unreachable');
    const { code, message, ...details } = e;
    this.details = details;
  }
}

// A URL the service hands back to open in a new tab (a checkout): https, or http on this machine, else nothing
export function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)) ? x.href : null; } catch { return null; }
}

export function createCloud({ api = null, fetch: f = (...a) => globalThis.fetch(...a), win = globalThis } = {}) {
  const fns = new Map();
  const emit = (type, d) => { for (const fn of fns.get(type) || []) { try { fn(d); } catch (e) { console.error('cloud listener', type, e); } } };
  let state = 'signed-out', me = null, config = null, error = null, checked = false;
  let pollT = 0, pollUntil = 0, popup = null;

  function setState(s, err = null) { state = s; error = err; emit('state', s); }
  function setMe(m) { me = m || null; checked = true; if (me && state !== 'signed-in') { stopWaiting(); setState('signed-in'); } else if (!me && state === 'signed-in') setState('signed-out'); emit('me', me); }

  async function req(method, path, body, { key = null, signal = null, raw = false } = {}) {
    if (!api) throw new CloudError(0, { error: { code: 'off', message: 'Claude on Overdub credits isn’t on in this studio.' } });
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    let res;
    try { res = await f(api + path, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store' }); } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new CloudError(0);
    }
    if (raw && res.ok) return res;
    if (res.status === 204) return null;
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    if (!res.ok) {
      const err = new CloudError(res.status, j);
      if (!err.details.retryAfter && res.headers.get('retry-after')) err.details.retryAfter = Number(res.headers.get('retry-after')) || 0;
      if (res.status === 401 && me) setMe(null);
      throw err;
    }
    return j;
  }

  /* ------------------------------------------------------------------ account */
  async function load() {
    try { config = await req('GET', '/v1/config'); emit('config', config); } catch { config = null; }
    await refresh().catch(() => null);
    return config;
  }
  async function refresh() {
    try { setMe(await req('GET', '/v1/me')); } catch (e) {
      if (e.status === 401) { checked = true; setMe(null); return null; }
      throw e;
    }
    return me;
  }
  // Google, in a popup: opened here, synchronously, so it counts as the click's own (an await before it and the browser
  // blocks it). A blocked popup is an 'error' the sheet shows.
  function signIn() {
    if (!api) { setState('error', new CloudError(0, { error: { code: 'off', message: 'Claude on Overdub credits isn’t on in this studio.' } })); return; }
    stopWaiting();
    let w = null;
    try { w = win.open?.(api + SIGNIN_PATH, 'overdub-signin', 'popup,width=480,height=640') || null; } catch { w = null; }
    if (!w) { setState('error', new CloudError(0, { error: { code: 'popup_blocked', message: 'The sign-in window didn’t open. Allow pop-ups for this page, then try again.' } })); return; }
    popup = w;
    setState('waiting');
    startWaiting();
  }
  function cancelSignIn() { stopWaiting(); closePopup(); setState('signed-out'); }
  async function signOut() {
    try { await req('POST', '/v1/auth/logout', {}); } catch (e) { if (e.status !== 401) throw e; }
    forgetLocal();
    setMe(null); setState('signed-out');
  }
  // The ask-to-takes map (for credits back on undo) holds the service's action ids, which point at its usage records:
  // it goes when the account does, or is signed out of, on this browser
  function forgetLocal() { try { win.localStorage?.removeItem('overdub:cloud:takes'); } catch { /* storage blocked */ } }

  // While the popup is out: the done page's message, focus coming back, and /v1/me every 5 s while the tab is visible,
  // for up to 10 minutes. Then it stops and goes back to signed out.
  function onMessage(ev) { if (state === 'waiting' && ev.origin === api && popup && ev.source === popup && ev.data && ev.data.type === 'overdub:signed-in') refresh().catch(() => {}); }
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

  /* ------------------------------------------------------------------ actions */
  const open = ({ kind, moreTime = false, promptVersion }, key) => req('POST', '/v1/agent/actions', { kind, moreTime: !!moreTime, promptVersion }, { key });
  const call = (actionId, body, signal) => req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/calls`, body, { signal, raw: true });
  const wait = (actionId) => req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/wait`, {});
  async function finish(actionId, { outcome = 'done', cardPending = false, deviceWritten = false } = {}) {
    const s = await req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/finish`, { outcome, cardPending: !!cardPending, deviceWritten: !!deviceWritten });
    if (s?.balance) setBalance(s.balance);
    return s;
  }
  async function creditBack(actionId, reason, key) {
    const r = await req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/credit-back`, { reason }, { key });
    if (r?.balance) setBalance(r.balance);
    return r;
  }
  function setBalance(balance) { if (me && balance) { me = { ...me, balance }; emit('me', me); } }

  /* ------------------------------------------------------------------ credits */
  async function claimTrial() { setMe(await req('POST', '/v1/trial/claim', { takeSaved: true })); return me; }
  async function checkout(sku) {
    const r = await req('POST', '/v1/billing/checkout', { sku }, { key: newKey() });
    const url = safeUrl(r?.url);
    if (url) win.open?.(url, '_blank', 'noopener');
    return { ...r, url };
  }
  async function sync(checkoutRef) {
    const { checkoutPaid, ...m } = (await req('POST', '/v1/billing/sync', { checkoutRef })) || {};
    setMe(m);
    return { me, paid: checkoutPaid !== false };
  }
  const activity = ({ before = null, limit = 20 } = {}) => req('GET', `/v1/me/activity?limit=${limit}${before ? '&before=' + encodeURIComponent(before) : ''}`);
  async function deleteAccount({ cancelPlan = false, forfeitCredits = false } = {}) {
    await req('DELETE', '/v1/me', { confirm: 'delete', cancelPlan: !!cancelPlan, forfeitCredits: !!forfeitCredits });
    forgetLocal();
    setMe(null); setState('signed-out');
  }
  const rateCard = () => (Array.isArray(config?.rateCard) ? config.rateCard.filter((r) => r && typeof r.kind === 'string' && Number.isFinite(r.credits)) : []);

  return {
    get enabled() { return !!api; },
    api,
    get state() { return state; },
    get me() { return me; },
    get config() { return config; },
    get checked() { return checked; },
    get error() { return error; },
    load, refresh, signIn, cancelSignIn, signOut,
    open, call, wait, finish, creditBack,
    claimTrial, checkout, sync, activity, deleteAccount,
    rateCard, setBalance,
    on(type, fn) { if (!fns.has(type)) fns.set(type, new Set()); fns.get(type).add(fn); return () => fns.get(type).delete(fn); },
  };
}

export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

/* ------------------------------------------------------------------ the prompt bundle's version */
// The service owns the system prompt and the tools (by version, overdub-cloud SPEC §5.3): the studio sends only which
// version it was built with. The canonical form is the same on both sides: each tool exactly { name, description,
// input_schema }, sorted by name in code-unit order; canonicalJson sorts keys at every level, no whitespace, arrays in
// order, undefined dropped. version = 'sha256:' + the first 16 hex of sha256(canonicalJson({ system, tools })).
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
export function canonicalBundle(system, tools) {
  const list = (tools || []).map(({ name, description, input_schema }) => ({ name, description, input_schema }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { system: String(system), tools: list };
}
export async function bundleVersion(bundle) {
  const bytes = new TextEncoder().encode(canonicalJson(bundle));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return 'sha256:' + Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
