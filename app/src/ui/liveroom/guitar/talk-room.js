// Claude on the talkback [ui; the guitar room's TAPE stream] (docs/research/GUITAR-ROOM.md §2.16; design/mock/
// guitar-room/ 09a-09c). The live room's talkback (ui/liveroom/talkback.js, in R.el.strip.talk) is how the room
// speaks; when Claude is connected it's also how you speak to Claude, through the glass. / opens a field in the strip
// (R.overlay('talk'), with a few things to ask in R.sheet('talk') above it); Enter sends it to the in-app agent
// (app.agent.send, with the room's state as its context); Esc closes it. What Claude says back comes into the talkback
// signed in cool ink (its say tool already lands there, agent/tools.js; otherwise the turn's reply, a sentence or two
// of it); what it does to the song it does through ops, as 'claude', each one a step ⌘Z takes back. An agent on the
// line from outside (an MCP client, claude.ai) can't be typed to from here: the room says where to type, and what it
// says comes through the talkback all the same.
//
//   createTalk(R, { tray }) -> talk
//     talk.open() -> { ok, error? }   the field (or, with nobody to talk to, the line saying so)
//     talk.close({ focus = true }) -> bool   (focus: back to the room; false when a click took it elsewhere)
//     talk.isOpen() -> bool
//     talk.send(text) -> Promise<{ ok, error? }>   ask Claude (as Enter in the field does)
//     talk.who() -> { here, inApp, provider, outside: [name] }   who's on the other side of the glass
//     talk.context() -> string        what Claude is told about the room with an ask
//     talk.frame(now), talk.dispose()
// State: R.gr.talk = { open }.

import { h } from '../../dom.js';
import { rigOf } from '../../../core/liveroom/guitar/rig.js';
import { roomOf } from '../../../core/liveroom/model.js';
import { TUNINGS } from '../../../core/fretboard.js';
import { TAPE_LINES as T_ } from './tape-lines.js';

const kbd = (k) => h('kbd', k);
export const IDEAS = ['Give me a beat that’s more thrash.', 'Tighten my tone up.', 'Name these parts.', 'Take the tempo to 140.'];
const HOLD_MS = 9000;

// a reply as the talkback shows it: plain words, a sentence or two (the whole of it waits in the talk sheet)
export function shorten(text, max = 280) {
  const t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const ss = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [t];
  let out = '';
  for (const s of ss) { if (out && (out + s).length > max) break; out += s; if (out.split(/[.!?](\s|$)/).length > 3) break; }
  out = out.trim() || t.slice(0, max);
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out;
}

export function createTalk(R, { tray = null } = {}) {
  const app = R.app;
  const slot = R.el.strip.talk;
  slot.classList.add('gr-tk');
  const lamp = h('i.gr-tk-lamp', { 'aria-hidden': 'true' });
  const field = h('input.gr-tk-field', { type: 'text', placeholder: 'Ask Claude through the glass', 'aria-label': 'Talk to Claude', maxlength: 2000, autocomplete: 'off', enterkeyhint: 'send', 'data-typing': '' });
  const form = h('form.gr-tk-form', { hidden: true, onsubmit: (e) => { e.preventDefault(); const q = field.value; field.value = ''; close(); send(q); } }, lamp, field, h('button.btn', { type: 'submit' }, 'Send', kbd('Enter')));
  const btn = h('button.btn.gr-tk-btn', { type: 'button', onclick: () => R.press('talk') }, h('i.gr-tk-who', { 'aria-hidden': 'true' }), h('span', 'Talk to Claude'), kbd('/'));
  const askedQ = h('span.gr-tk-q'), askedS = h('span.gr-tk-s');
  const asked = h('div.gr-tk-asked', { hidden: true, 'aria-live': 'polite' }, h('span.by.by-human', 'you'), ': ', askedQ, askedS);
  slot.append(form, btn, asked);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); field.value = ''; close(); }
  });
  const sheet = R.sheet('talk');
  // (a click on the room while the field is open: the field goes, its words kept for the next /, and the room has its
  // keys back; an open field nobody's typing in would hold every key but Esc: ./keys.js's talk context)
  form.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && (form.contains(to) || sheet.contains(to))) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (!R.gr.talk.open || form.contains(a) || sheet.contains(a)) return;
      close({ focus: false });
    }, 0);
  });
  sheet.classList.add('gr-tks');
  let was = null, turn = null, last = null, askedAt = 0;
  const offs = [];

  /* ---------------------------------------------------------------- who's there */
  function who() {
    const ag = app.agent;
    let provider = null;
    try { provider = ag ? ag.provider : null; } catch { provider = null; }
    const outside = [];
    try { for (const a of app.presence?.agents?.() || []) if (a.connected && a.source !== 'in-app' && a.by !== 'claude') outside.push(a.name || a.by); } catch { /* none */ }
    return { here: !!provider || outside.length > 0, inApp: !!provider && typeof ag?.send === 'function', provider, outside };
  }
  function context() {
    const p = R.store.get(), room = roomOf(p), rig = rigOf(p);
    let v = null;
    try { v = R.lr.view(); } catch { v = null; }
    const name = (d) => R.getDevice?.(d)?.name || d;
    const parts = (v?.parts || []).map((c) => `${c.name} (${c.bars} bars${c.takes?.L?.length ? `, ${c.takes.L.length} take${c.takes.L.length > 1 ? 's' : ''} left` : ''}${c.takes?.R?.length ? `, ${c.takes.R.length} right` : ''})`);
    const card = R.parts.takes?.part?.() || R.L.card || null;
    const sel = (v?.parts || []).find((c) => c.id === card);
    const kept = tray ? tray.rows().slice(0, 5).map((r) => `${r.name} (${Math.round(r.bars * 4) / 4} bars at ${Math.round(r.tempo)})`) : [];
    return [
      'The human is in the live room\'s guitar room (the metal club) with a guitar in their hands, reading your reply in the talkback strip: answer in a sentence or two.',
      `They're at: ${R.gr.world === 'shop' ? 'the shop' : `the stage${R.gr.cam && R.gr.cam !== 'stage' ? `, close on the ${R.gr.cam}` : ''}`}.`,
      `Tempo ${p.tempo}, ${TUNINGS[room?.tuning]?.name || 'standard tuning'}; the drummer's beat: ${room?.beat || 'the guide beat'}.`,
      rig ? `Their rig, the same on ${rig.tracks.join(' and ')}: ${rig.slots.map((s) => `${name(s.device)}${s.on ? '' : ' (off)'}`).join(' → ')}${room?.stack?.name ? ` (the stack "${room.stack.name}")` : ''}.` : 'No rig on the guitars yet.',
      parts.length ? `The part line: ${parts.join('; ')}.${sel ? ` Selected: ${sel.name}.` : ''}` : 'The part line is empty.',
      kept.length ? `Riffs they kept off the tape this session: ${kept.join(', ')}.` : '',
      'Change the song only through your tools (each change is signed as you and one ⌘Z for them). Never record, play or press anything for them, and never add parts they didn\'t ask for.',
    ].filter(Boolean).join('\n');
  }

  /* ---------------------------------------------------------------- the field */
  function renderSheet() {
    const w = who();
    const kids = [h('p.gr-tks-who', h('span.by.by-agent', 'Claude'), w.provider === 'mock' ? ' (the demo) ' : ' ', 'is on the talkback. What it changes is signed and one ⌘Z each.')];
    if (last) kids.push(h('div.gr-tks-last', h('p', h('span.by.by-human', 'you'), ': ', last.q), last.a ? h('p', h('span.by.by-agent', 'Claude'), ' ', last.a) : null));
    kids.push(h('div.gr-tks-ideas', h('span.gr-t3', 'For example:'), IDEAS.map((q) => h('button.btn.btn-txt', { type: 'button', onclick: () => { close(); send(q); } }, q))));
    kids.push(h('p.gr-tks-keys', kbd('Enter'), ' sends it ', kbd('Esc'), ' closes'));
    sheet.replaceChildren(...kids);
  }
  function open() {
    const w = who();
    if (!w.inApp) {
      const text = w.outside.length ? T_.outside({ names: w.outside }) : T_.nobody();
      R.say(text);
      return { ok: false, error: text };
    }
    if (w.provider === 'cloud') {
      const text = T_.cloud();
      R.say(text);
      return { ok: false, error: text };
    }
    if (R.gr.talk.open) { field.focus({ preventScroll: true }); return { ok: true }; }
    was = R.gr.overlay && R.gr.overlay !== 'talk' ? R.gr.overlay : null;
    R.gr.talk.open = true;
    R.overlay('talk');
    renderSheet();
    slot.classList.add('gr-tk-on');
    form.hidden = false;
    setTimeout(() => field.focus({ preventScroll: true }), 0);
    return { ok: true };
  }
  function close({ focus = true } = {}) {
    if (!R.gr.talk.open) return false;
    R.gr.talk.open = false;
    form.hidden = true;
    slot.classList.remove('gr-tk-on');
    if (document.activeElement === field) field.blur();
    if (R.gr.overlay === 'talk') {
      // (back to what the field opened over: the tape's sheet, the library)
      const back = was && ['tape', 'library'].includes(was) && R.parts.tape ? was : null;
      R.overlay(back);
    }
    was = null;
    if (focus) R.el.root.closest('.lr')?.focus({ preventScroll: true });
    return true;
  }

  /* ---------------------------------------------------------------- an ask, and its answer */
  async function send(text) {
    const q = String(text || '').trim();
    if (!q) return { ok: false, error: 'Nothing to send.' };
    const w = who(), ag = app.agent;
    if (!w.inApp) { const t = w.outside.length ? T_.outside({ names: w.outside }) : T_.nobody(); R.say(t); return { ok: false, error: t }; }
    if (ag.busy || turn) { R.say(T_.busy()); return { ok: false, error: T_.busy() }; }
    listen();
    turn = { q, text: '', said: false, err: null, at: Date.now() };
    last = { q, a: null };
    askedQ.textContent = q; askedS.textContent = ' · Claude is on it…'; asked.hidden = false; askedAt = Date.now();
    let ok = false;
    try { ok = await ag.send(q, { context: context(), scope: 'the live room' }); } catch (e) { turn && (turn.err = String(e?.message || e)); }
    if (turn && !ok && !turn.err) turn.err = 'it didn’t take the ask';
    if (turn && turn.text === '' && !turn.said && turn.err) finish();
    return { ok: !!ok };
  }
  function finish(e = {}) {
    const t = turn;
    turn = null;
    if (!t) return;
    const text = t.text.trim();
    last = { q: t.q, a: text ? shorten(text, 600) : null };
    if (e.stopped) askedS.textContent = ' · stopped';
    else if (text && !t.said) R.say(shorten(text), { by: 'claude' });
    else if (!text && !t.said && t.err) R.say(T_.noAnswer({ why: t.err }));
    askedS.textContent = '';
    askedAt = Date.now();
  }
  // (the agent's events, heard once it's there: the panel makes it as the studio starts)
  let heard = null;
  function listen() {
    const ag = app.agent;
    if (!ag?.on || heard === ag) return;
    heard = ag;
    offs.push(ag.on('text', ({ delta } = {}) => { if (turn) turn.text += delta || ''; }));
    offs.push(ag.on('status', (s) => { if (turn && s) askedS.textContent = ` · ${s}`; }));
    offs.push(ag.on('error', (e = {}) => { if (turn && !e.retrying) turn.err = e.message || 'no reason given'; }));
    offs.push(ag.on('end', (e = {}) => { if (turn) finish(e); }));
  }
  listen();
  if (app.liveRoom?.on) offs.push(app.liveRoom.on('say', ({ by } = {}) => { if (turn && by && by !== 'overdub' && by !== 'you') turn.said = true; }));

  let lastWho = '', tWho = 0;
  return {
    open, close, send, who, context,
    isOpen: () => !!R.gr.talk.open,
    frame(now) {
      if (!asked.hidden && !turn && Date.now() - askedAt > HOLD_MS) asked.hidden = true;
      if (now - tWho < 500) return;
      tWho = now;
      const w = who(), k = `${w.inApp}|${w.outside.join(',')}`;
      if (k !== lastWho) { lastWho = k; btn.classList.toggle('gr-tk-here', w.here); btn.title = w.inApp ? 'Talk to Claude, through the glass (/)' : w.outside.length ? `${w.outside.join(' and ')}: on the line from outside` : 'Nobody’s on the other side of the glass'; }
    },
    dispose() { for (const o of offs.splice(0)) { try { o(); } catch { /* gone */ } } close(); slot.classList.remove('gr-tk'); form.remove(); btn.remove(); asked.remove(); },
  };
}
