// The account: one key on the top bar beside Song, and the sheet it opens, the one place for who is signed in, the
// plan, and the songs kept in the account. Only when the deploy names the service (app/src/site-config.js, through
// agent/cloud.js): otherwise the key isn't there and nothing is asked of anyone. It is configuration, not a toggle.
//
// The key says "Sign in" while nobody is, and "Account" once someone is (on a phone, their initial, so the song's
// title keeps its room). The sheet (a popover under the key; a sheet along the bottom on a phone, as My songs is):
//   signed out   one Continue with Google (agent/cloud.js signIn: the popup opens in the click itself), then a waiting
//                line with Cancel, the same as the Agent tab's sign-in and My songs'
//   signed in    who, and Sign out; the plan ("Overdub Plus, monthly · renews 20 Nov", or "No plan" with Get Plus);
//                the song on screen and My songs, as the Song menu has them (ui/songs.js menuRows: the same rows, not a
//                copy of them); the credits, only while the hosted agent is on
// Get Plus opens the plans where they're sold, the Agent tab's Top up (agent/cloud-panel.js, ui event 'cloud:show'):
// it works while the hosted agent is paused, when Top up shows the plans alone. Find reaches it ("account", "sign in",
// "plus", "billing").
//
// State is this module's (what's open, when it was drawn); what it shows comes from cloud.me / cloud.config and
// app.songs, read again in frame(now) while the sheet is open, so a sign-in in the popup, a save going through or a
// plan bought in another tab redraws it.
//
//   app.account = { enabled, open({ anchor }), close(), get isOpen() }

import { h, css } from './dom.js';
import { popover } from './rack.js';
import { day, planRuns } from '../agent/cloud-panel.js';

export default function (app) {
  const { ui } = app;
  css('ew-account', ACCOUNT_CSS);
  let cloud = null;
  let el = null, btn = null;
  let pop = null, body = null, sig = '', drawnAt = 0, keySig = '';
  let offFind = null;
  let said = '';
  const on = () => !!cloud?.enabled;

  function attach() {
    const c = app.agent?.cloud || null;
    if (c !== cloud) cloud = c;
    if (on() && !offFind) offFind = ui.workspace?.addFind?.({ title: 'Account', purpose: 'Sign in, Overdub Plus and the songs in your account', aliases: ['account', 'sign in', 'sign out', 'log in', 'plus', 'overdub plus', 'plan', 'billing', 'subscription'], run: () => open() }) || null;
    if (!on() && offFind) { offFind(); offFind = null; }
    syncKey();
  }
  app.agent?.on?.('cloud', attach);

  /* ---------------------------------------------------------------- the key */
  function syncKey() {
    if (!el || !btn) return;
    const me = on() ? cloud.me : null;
    const email = me?.user?.email || '';
    const k = [on(), email].join('|');
    if (k === keySig) return;
    keySig = k;
    el.classList.toggle('ac-on', on());
    btn.hidden = !on();
    btn.classList.toggle('ac-in', !!me);
    const initial = (email.match(/[\p{L}\p{N}]/u)?.[0] || 'A').toUpperCase();
    btn.replaceChildren(...[h('span.ac-l', me ? 'Account' : 'Sign in'), me ? h('span.ac-i', { 'aria-hidden': 'true' }, initial) : null].filter(Boolean));
    btn.title = me ? `Your account: ${email}. Plus, sign out, and the songs in your account` : 'Sign in to save songs to your account';
    btn.setAttribute('aria-label', me ? `Your account, ${email}` : 'Sign in');
    // (the bar's room changed: the song's title fits itself again, ui/transport.js, and the bar's own fit runs)
    ui.emit('resize');
    ui.fitTop?.(true);
  }

  /* ---------------------------------------------------------------- the sheet */
  function open({ anchor = null } = {}) {
    if (!on()) return false;
    const vis = (x) => x?.isConnected && x.getClientRects().length > 0;
    const at = [anchor, btn, document.querySelector('.ws-find-btn')].find(vis) || document.querySelector('.ew-top') || document.body;
    close();
    said = '';
    body = h('div.ac', { dataset: { k: 'sheet' } });
    pop = popover(at, body, { align: 'end', className: 'ac-pop', label: 'Your account', onClose: () => { pop = null; body = null; sig = ''; } });
    paint(true);
    pop?.el.querySelector('.ac-head b')?.focus({ preventScroll: true });
    if (cloud.me) app.songs?.refresh?.();
    return true;
  }
  function close() { pop?.close(); pop = null; body = null; sig = ''; }

  // what the sheet shows, as words: drawn again only when one changes; the control that had focus keeps it
  function paint(force = false) {
    if (!body) return;
    const me = cloud.me;
    const rows = me ? songRows() : [];
    const s = JSON.stringify([cloud.state, me?.user?.email, me?.plan?.label, me?.plan?.status, me?.plan?.renewsAt, me?.plan?.endsAt, me?.balance?.total, cloud.config?.hosted?.enabled, cloud.error?.message, rows.map((r) => [r.label, r.sub]), said]);
    if (!force && s === sig) return;
    sig = s;
    const k = document.activeElement?.closest?.('.ac [data-k]')?.dataset.k || null;
    body.replaceChildren(...(me ? signedIn(me, rows) : signedOut()).filter(Boolean));
    if (k) (body.querySelector(`[data-k="${CSS.escape(k)}"]`) || body.querySelector('.ac-head b'))?.focus({ preventScroll: true });
    pop?.place();
  }
  const btnK = (k, cls, label, onclick, extra = {}) => h(`button.btn${cls}`, { type: 'button', dataset: { k }, onclick, ...extra }, label);
  const head = (sub) => h('div.sm-head.ac-head', h('b', { tabindex: '-1' }, 'Your account'), h('small', sub));

  function signedOut() {
    const st = cloud.state;
    if (st === 'waiting') {
      return [head('Signing in with Google'),
        h('p.ac-line', { role: 'status' }, 'Waiting for Google. Finish signing in in the window that opened; this tab notices on its own.'),
        h('div.ac-acts', btnK('cancel', '.btn-txt', 'Cancel', () => { cloud.cancelSignIn(); paint(true); }))];
    }
    return [head('songs and Plus, kept in your Overdub account'),
      h('p.ac-line', 'Sign in to save songs to your account and open them on any browser. Everything else in the studio works without an account.'),
      // (the popup opens in this click itself: an await first and the browser blocks it)
      h('div.ac-acts', btnK('google', '.btn-go.ac-google', 'Continue with Google', () => { cloud.signIn(); paint(true); })),
      st === 'error' && cloud.error ? h('p.ac-err', cloud.error.message) : null,
      h('p.ac-note', 'A window opens for Google. Overdub gets your email address from it, never your password.')];
  }

  function signedIn(me, rows) {
    const email = me.user?.email || '';
    const plan = planRuns(me.plan) ? me.plan : null;
    // the service's kill switch (GET /v1/config hosted.enabled false): no credits to show or spend
    const hosted = cloud.config?.hosted?.enabled !== false;
    const when = plan ? (plan.endsAt ? `ends ${day(plan.endsAt)}` : plan.renewsAt ? `renews ${day(plan.renewsAt)}` : '') : '';
    const n = Number(me.balance?.total) || 0;
    return [
      head(email),
      h('div.ac-who', h('p.ac-line', 'Signed in as ', h('b', email)), btnK('signout', '.btn-txt.ac-signout', 'Sign out', signOut)),
      h('dl.ac-dl',
        h('dt', 'Plan'), h('dd.ac-plan', plan ? `${plan.label || 'Overdub Plus'}${when ? ` · ${when}` : ''}` : 'No plan'),
        hosted ? [h('dt', 'Credits'), h('dd', h('span.mono', String(n)), ' for Claude on Overdub credits')] : null),
      plan ? null : h('div.ac-plus',
        h('p.ac-line', 'Plus keeps your songs in your account: they save as you work, and open on any browser.'),
        h('div.ac-acts', btnK('plus', '.btn-go.ac-getplus', 'Get Plus', () => { close(); ui.emit('cloud:show', { view: 'topup' }); }))),
      rows.length ? h('div.ac-songs', rows.map((r, i) => h('button.sm-i' + (r.cls || ''), { type: 'button', dataset: { k: `song:${i}` }, onclick: () => { close(); r.run(); } }, h('span', h('b', r.label), r.sub ? h('small', r.sub) : null)))) : null,
      hosted ? h('div.ac-acts.ac-credits', btnK('credits', '.btn-txt', 'Credits: top up, and where they went', () => { close(); ui.emit('cloud:show', { view: 'account' }); })) : null,
      said ? h('p.ac-err', { role: 'status' }, said) : null,
    ];
  }
  // the Song menu's rows for the account (ui/songs.js), My songs under this key
  function songRows() { return app.songs?.enabled ? app.songs.menuRows({ anchor: btn }) : []; }
  async function signOut() {
    try { await cloud.signOut(); said = ''; close(); ui.toast('Signed out. The songs in this browser stay as they are.'); } catch (e) { said = e.message; paint(true); }
  }

  ui.panel({
    id: 'account', region: 'top', title: 'Account',
    mount(node) {
      el = node;
      btn = h('button.btn.ac-btn', { type: 'button', hidden: true, 'aria-haspopup': 'dialog', onclick: () => (pop ? close() : open()) });
      node.append(btn);
      keySig = '';
      attach();
      return {
        unmount() { close(); btn = null; el = null; },
        // the key and, while it's open, the sheet: from the account as it stands, a few times a second
        frame(now) {
          if (now - drawnAt < 200) return;
          drawnAt = now;
          if (cloud !== (app.agent?.cloud || null)) attach();
          syncKey();
          if (body) paint();
        },
      };
    },
  });

  app.account = {
    get enabled() { return on(); },
    get isOpen() { return !!pop; },
    open, close,
  };
}

const ACCOUNT_CSS = `
/* the account's key: beside Song, a word on a rule edge (.btn), there only when the deploy names the service */
.ew-region-top > .ew-panel[data-panel="account"] { flex: none; order: 10; }
@media (min-width: 641px) { .ew-region-top > .ew-panel[data-panel="account"] { display: flex; align-items: center; height: 40px; } }
.ew-region-top > .ew-panel[data-panel="account"]:not(.ac-on) { display: none; }
.ac-btn { height: 30px; padding: 0 12px; }
.ac-btn[hidden] { display: none; }
.ac-i { display: none; }
@media (max-width: 900px) { .ac-btn { padding: 0 10px; } }
/* the sheet: the Song menu's ledger, words on hairlines */
.ac-pop { width: min(360px, calc(100vw - 16px)); max-height: min(80vh, 640px); }
.ac { display: grid; gap: 8px; padding: 0 0 6px; }
.ac-head b:focus { outline: none; }
.ac-head small { overflow-wrap: anywhere; }
.ac-line, .ac-err, .ac-note { margin: 0 10px; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.ac-line b { color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
.ac-err { color: var(--bad); }
.ac-note { font-size: 12px; color: var(--text-3); padding-top: 8px; border-top: var(--rule); }
.ac-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 10px; }
.ac-who { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
.ac-who .ac-signout { margin-right: 10px; }
.ac-dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; padding: 8px 10px; border-top: var(--rule); border-bottom: var(--rule); font-size: 12.5px; line-height: 1.45; }
.ac-dl dt { color: var(--text-3); }
.ac-dl dd { margin: 0; color: var(--text); }
.ac-dl .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.ac-plus { display: grid; gap: 8px; }
.ac-songs { display: grid; border-top: var(--rule); border-bottom: var(--rule); padding: 2px 0; }
/* a phone, or a finger: 44 px keys; the key on the bar is the person's initial, and the sheet runs along the bottom */
@media (pointer: coarse), (max-width: 640px) {
  .ac .btn, .ac .btn-txt, .ac .sm-i { min-height: 44px; }
  .ac .btn-txt { padding: 0 6px; }
}
@media (max-width: 640px) {
  .ew-shell .ac-btn { order: 3; height: 40px; min-width: 44px; padding: 0 10px; margin-right: 4px; }
  .ew-shell .ac-btn.ac-in .ac-l { display: none; }
  .ew-shell .ac-btn.ac-in .ac-i { display: inline; font-weight: 600; }
  .ew-pop.ac-pop { left: 8px !important; right: 8px; top: auto !important; bottom: 8px; width: auto; max-width: none; max-height: 82vh; }
  .ac-line, .ac-note, .ac-dl { font-size: 13px; }
}
`;
