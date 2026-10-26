// The talkback [ui; stream C] (docs/research/LIVE-ROOM-MODE.md §3.16, §10.1): the strip under the stage the room
// speaks through. A small square lamp that lights when a line is new (a talkback button's light; square, as BRAND's
// corners are), the line itself (two sentences at most), and a polite live region that reads it. The house speaks
// unsigned; an agent's line carries its byline in its ink (ui/dom.js byline), as everywhere. Lines change between
// passes and hold still during one: a line said while a count or a take runs waits, and the newest comes in when it
// ends. / opens the strip for typing to the agent, when there is one (app.agent.send): the answer comes back as the
// agent's own lines (app.liveRoom.say with its byline), never as the room's.
//
//   createTalkback({ app }) -> { el, say(text, { by }), frame(now), clear(), hold(on), ask(), asking(), text, by }
//       say: the line now ('overdub', the house, by default), or when the hold lifts; frame dims the lamp a few seconds
//       after; clear empties it; hold(true) while a count or a take runs; ask() opens the field (false: no agent here);
//       text and by: what it says now

import { h, byline } from '../dom.js';

const LIT_MS = 4000;

export function createTalkback({ app = null } = {}) {
  const lamp = h('i.lr-tb-lamp', { 'aria-hidden': 'true' });
  const by = h('span.lr-tb-by');
  const line = h('span.lr-tb-line');
  const text = h('p.lr-tb-text', { role: 'status', 'aria-live': 'polite' }, by, line);
  const field = h('input.lr-tb-field', { type: 'text', 'aria-label': 'Talk to Claude', placeholder: 'Talk to Claude', maxlength: 2000, enterkeyhint: 'send', hidden: true, autocomplete: 'off' });
  const form = h('form.lr-tb-ask', { hidden: true, onsubmit: (e) => { e.preventDefault(); send(); } }, field);
  const el = h('div.lr-talkback', lamp, text, form);
  let litAt = -Infinity, held = false, waiting = null, now = { text: '', by: 'overdub' };
  const show = (t, who) => {
    const sign = who && who !== 'overdub' ? byline(who, { app }) : null;
    by.replaceChildren(...(sign ? [sign, ' '] : []));
    line.textContent = String(t ?? '');
    lamp.classList.add('lr-on');
    litAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    now = { text: String(t ?? ''), by: who || 'overdub' };
  };
  const agent = () => app?.agent && typeof app.agent.send === 'function' ? app.agent : null;
  function close() { form.hidden = true; field.hidden = true; text.hidden = false; field.value = ''; }
  async function send() {
    const q = field.value.trim();
    close();
    const a = agent();
    if (!q || !a) return;
    try { await a.send(q, { context: { room: true } }); } catch (e) { console.error('liveroom: the agent', e); }
  }
  field.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); el.closest('.lr')?.focus({ preventScroll: true }); } });
  return {
    el,
    get text() { return now.text; },
    get by() { return now.by; },
    say(t, { by: who = 'overdub' } = {}) {
      if (held) { waiting = { t, who }; return; }
      show(t, who);
    },
    hold(on) {
      held = !!on;
      if (!held && waiting) { const w = waiting; waiting = null; show(w.t, w.who); }
    },
    ask() {
      if (!agent()) return false;
      form.hidden = false; field.hidden = false; text.hidden = true;
      setTimeout(() => field.focus({ preventScroll: true }), 0);
      return true;
    },
    asking: () => !form.hidden,
    frame(t) {
      if (t - litAt > LIT_MS && lamp.classList.contains('lr-on')) lamp.classList.remove('lr-on');
    },
    clear() { by.replaceChildren(); line.textContent = ''; lamp.classList.remove('lr-on'); waiting = null; now = { text: '', by: 'overdub' }; },
  };
}
