// The talkback [ui; stream C] (docs/research/LIVE-ROOM-MODE.md §3.16, §10.1): the strip under the stage the room
// speaks through. A small square lamp that lights when a line is new (a talkback button's light; square, as BRAND's
// corners are), the line itself (two sentences at most), and a polite live region that reads it. The house speaks
// unsigned; an agent's line carries its byline in its ink (ui/dom.js byline), as everywhere. Lines change between
// passes and hold still during one: a line said while a count or a take runs waits, and the newest comes in when it
// ends. / opens the strip for typing to the agent, when there is one (app.agent.send): the answer comes back as the
// agent's own lines (app.liveRoom.say with its byline), never as the room's.
//
//   createTalkback({ app }) -> { el, say(text, { by, wait }), frame(now), clear(), hold(on), ask(), asking(), pressed(), text,
//       by }
//       say: the line now ('overdub', the house, by default), or when the hold lifts; frame dims the lamp a few seconds
//       after; clear empties it; hold(true) while a count or a take runs; ask() opens the field (false: no agent here);
//       text and by: what it says now
// A line stays up long enough to read: when the room says one of its lines (wait: true, the room's own sayLine) straight
// after another (no key or tap between),
// the next waits until the last has been up DWELL_MS, three at most in line; anything you press shows the next at once,
// and an agent's line is never kept waiting.

import { h, byline } from '../dom.js';

const LIT_MS = 4000;
const DWELL_MS = 2600;
const PRESS = /^(keydown|pointerdown|pointerup|mousedown|mouseup|click)$/;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createTalkback({ app = null } = {}) {
  const lamp = h('i.lr-tb-lamp', { 'aria-hidden': 'true' });
  const by = h('span.lr-tb-by');
  const line = h('span.lr-tb-line');
  const text = h('p.lr-tb-text', { role: 'status', 'aria-live': 'polite' }, by, line);
  const field = h('input.lr-tb-field', { type: 'text', 'aria-label': 'Talk to Claude', placeholder: 'Talk to Claude', maxlength: 2000, enterkeyhint: 'send', hidden: true, autocomplete: 'off' });
  const form = h('form.lr-tb-ask', { hidden: true, onsubmit: (e) => { e.preventDefault(); send(); } }, field);
  const el = h('div.lr-talkback', lamp, text, form);
  let litAt = -Infinity, held = false, waiting = null, now = { text: '', by: 'overdub' }, queue = [];
  // (the order of presses and lines, by count: two in the same instant still have an order)
  let seq = 0, pressedAt = -1, saidAt = 0, shownAt = 0;
  // (a key or a tap since the last line: the next one answers it, and shows at once)
  // (each event counted once: by the first line said while it's handled, else by the listener below)
  let counted = null;
  const pressed = (e) => { if (e && e === counted) return; if (e) counted = e; pressedAt = ++seq; };
  if (typeof document !== 'undefined') { document.addEventListener('keydown', pressed, true); document.addEventListener('pointerdown', pressed, true); }
  // (the shell's keys listen on window, so a key's own move runs before the listener above hears the key: a line said
  // while a key or a tap is still being handled is that press's answer all the same)
  const handling = () => { const e = typeof window !== 'undefined' ? window.event : undefined; if (e && PRESS.test(e.type)) pressed(e); };
  const soon = () => clock() - litAt < DWELL_MS && pressedAt < shownAt;
  const show = (t, who) => {
    const sign = who && who !== 'overdub' ? byline(who, { app }) : null;
    by.replaceChildren(...(sign ? [sign, ' '] : []));
    line.textContent = String(t ?? '');
    lamp.classList.add('lr-on');
    el.classList.toggle('lr-said', !!String(t ?? ''));
    litAt = clock();
    shownAt = ++seq;
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
    say(t, { by: who = 'overdub', wait = false } = {}) {
      if (held) { waiting = { t, who }; return; }
      handling();
      // (a press since the last line was said: this one answers it, and what was waiting is old news)
      const answer = pressedAt > saidAt;
      saidAt = ++seq;
      if (answer) queue = [];
      // (an agent's line is an answer: it shows at once, and the house's waiting lines follow it)
      if (wait && who === 'overdub' && !answer && (queue.length || soon())) { queue.push({ t, who }); if (queue.length > 3) queue.shift(); return; }
      show(t, who);
    },
    hold(on) {
      held = !!on;
      if (held) { if (queue.length) waiting = queue.at(-1); queue = []; }
      if (!held && waiting) { const w = waiting; waiting = null; show(w.t, w.who); }
    },
    ask() {
      if (!agent()) return false;
      form.hidden = false; field.hidden = false; text.hidden = true;
      setTimeout(() => field.focus({ preventScroll: true }), 0);
      return true;
    },
    asking: () => !form.hidden,
    // a press that came another way than a key or a tap (app.liveRoom.press, an agent's or a check's)
    pressed,
    frame() {
      const t = clock();
      if (queue.length && !held && (t - litAt >= DWELL_MS || pressedAt > shownAt)) { const q = queue.shift(); show(q.t, q.who); }
      if (t - litAt > LIT_MS && lamp.classList.contains('lr-on')) lamp.classList.remove('lr-on');
    },
    clear() { by.replaceChildren(); line.textContent = ''; lamp.classList.remove('lr-on'); el.classList.remove('lr-said'); waiting = null; queue = []; now = { text: '', by: 'overdub' }; },
  };
}
