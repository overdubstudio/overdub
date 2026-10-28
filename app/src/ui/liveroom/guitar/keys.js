// @ts-check
// The guitar room's keys [ui; the guitar room's foundation, frozen] (docs/research/GUITAR-ROOM.md §1.7 "Keys always
// land", §2; docs/ARCHITECTURE.md "The guitar room"). ONE table: every key the room owns, where it's live, and the
// action id it presses (the screen's press(id), ./index.js, routes an action to the stream that owns it). Nothing else
// in the guitar room declares a key: a stream implements actions, never keys, so two streams can't fight over one.
//
// How a key lands, whatever has focus (AJ's rule: hands on the guitar, eyes elsewhere):
//   - every key is declared through ui.keys (the shell's one handler), first, in the group 'Live room', while the
//     guitar room is mounted, with a when() that is true only in the room (so they're tried before the room's holds);
//   - the letters, digits, / and Backspace are `global`, so a focused select, range input, checkbox or button the mouse
//     last clicked can't swallow them; their when() gives them back only to a field that types text (typesText: a
//     text-type input, a textarea, contenteditable, [data-typing]: the talkback's field, a riff's name being typed)
//     and to an open modal dialog (the ? sheet);
//   - Space is the shell's rule (fix/space-key, docs/ARCHITECTURE.md "Space is always the transport's"): taken on
//     keydown and keyup from any control but a text field, so it never presses the button you last clicked; a focused
//     list (the shop's wall and case, the rack, the riff library, the part line), which the shell lets keep Space for
//     a studio dropdown's sake, gives it to the room too: the row is global and the room stops its keyup;
//   - Enter is left to a focused button (the browser presses it: a part card's Enter is "play from" either way), and
//     taken by the room only when no button has focus;
//   - the arrows, Page Up/Down, Home and End are a focused knob's (role=slider) and a focused list's (the part line is a
//     role=listbox; the shell leaves a list its arrows), and the room's everywhere else; but Home on the part line is
//     the room's, play from the top, as the line's own hint says;
//   - the room draws no <select> and no <input type=range>: a knob is the faces' ARIA slider, a choice is buttons
//     (tools/liveroom/checks-guitar.js fails on either).
//
// Where a key is live: the contexts, read from ui.state.liveRoom.gr and the room's run (contextOf below):
//   rec      a count or a take is running (ui.state.liveRoom.run 'count' | 'take')
//   review   a take just landed, its handles up (gr.overlay 'review')
//   talk     the talkback's field is open (gr.overlay 'talk'; typing: only Esc and Enter reach the room)
//   gs       Getting started is up (gr.overlay 'gs')
//   tape     the tape machine's last minute is open (gr.overlay 'tape')
//   library  the riff library is open (gr.overlay 'library')
//   shop     you're in the shop (gr.world 'shop')
//   stage    you're on the stage (gr.world 'stage'), with nothing above it (no overlay)
//   any      anywhere in the guitar room
// A row's `in` lists the contexts it's live in, tried in the table's order: the first row whose contexts match wins.
// A context missing from a row means the key does nothing there (rec holds every key but Space, R, Esc and ⌘G).
//
//   KEYS                     the table: [{ code, mod, in: [contexts], press: action | (ctx) => action, label }]
//   contextOf(gr, run) -> { rec, review, talk, gs, tape, library, shop, stage, any }
//   typesText(el) -> bool    a field that types text (the shell's rule)
//   keyTable() -> [{ keys: '⌘G', where, does }]   the table in words, for the keys sheet and the docs
//   installKeys({ ui, gr: () => state, run: () => liveRoom run, live: () => bool, press(action, e) }) -> off()
//       declares every row (ui.keys.add, first, group 'Live room') and returns the function that takes them away

const TEXT_INPUT = /^(text|search|number|email|url|password|tel)$/;
export const typesText = (t) => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && TEXT_INPUT.test(t.type)) || !!t.closest?.('[data-typing]'));
const modalUp = () => typeof document !== 'undefined' && !!document.querySelector('body > [aria-modal=true]:not(.ew-region)');
const sliderFocused = () => typeof document !== 'undefined' && !!document.activeElement?.closest?.('[role=slider], [role=spinbutton]');
const listFocused = () => typeof document !== 'undefined' && !!document.activeElement?.closest?.('[role=listbox], [role=menu], [role=tablist], [role=radiogroup]');
const buttonFocused = () => {
  if (typeof document === 'undefined') return false;
  const a = document.activeElement;
  return !!a && a !== document.body && !!a.closest?.('button, a[href], summary, [role=button], [role=option], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch]');
};

export function contextOf(gr, run) {
  const o = gr?.overlay || null;
  const rec = run === 'count' || run === 'take';
  return {
    rec,
    review: !rec && o === 'review',
    talk: o === 'talk',
    gs: !rec && o === 'gs',
    tape: !rec && o === 'tape',
    library: !rec && o === 'library',
    shop: !rec && !o && gr?.world === 'shop',
    stage: !rec && !o && gr?.world !== 'shop',
    any: true,
  };
}

// (a press that depends on where you are: the screen's router resolves 'space', 'back' and 'enter' itself, ./index.js)
/** @returns {{ code: string, mod: string | null, in: string[], press: any, label: string, global?: boolean }} */
const L = (code, mod, inn, press, label, extra = {}) => ({ code, mod: mod || null, in: inn, press, label, ...extra });
const G = { global: true };   // a letter: reaches the room from a focused select, slider or button too

export const KEYS = Object.freeze([
  // the take: the three big words while it records
  // (global: a focused list keeps Space under the shell's rule (OWNS_SPACE, a studio dropdown's), and the shop's wall and
  // case, the rack and the riff library are lists of buttons: the room takes Space from them too, keyup and all, below)
  L('Space', null, ['rec', 'review', 'gs', 'tape', 'library', 'shop', 'stage'], 'space', 'The drummer; stop the take or the song; in a take’s review, hear it', G),
  L('KeyR', null, ['rec'], 'again', 'Start the take again (counted back in)', G),
  L('Escape', null, ['rec'], 'toss', 'Toss the take'),
  L('KeyR', null, ['review'], 'again', 'Again: toss this take and record the part again', G),
  L('Enter', null, ['review'], 'keep', 'Keep the take'),
  L('NumpadEnter', null, ['review'], 'keep', 'Keep the take'),
  L('Backspace', null, ['review'], 'toss', 'Toss the take', G),
  L('Delete', null, ['review'], 'toss', 'Toss the take', G),
  L('ArrowUp', null, ['review', 'stage'], 'take:up', 'The kept take before (plays in its place)'),
  L('ArrowDown', null, ['review', 'stage'], 'take:down', 'The kept take after'),
  // the way back out, one step at a time (never a trap)
  L('Escape', null, ['review', 'talk', 'gs', 'tape', 'library', 'shop', 'stage'], 'back', 'Step back: close what’s open, then the camera back out'),
  // the stage
  L('KeyR', null, ['stage'], 'record', 'Record the selected part (counted in), or a new one at the end', G),
  L('KeyD', null, ['stage', 'review'], 'side', 'The other side of the selected part, on the same rig', G),
  L('Enter', null, ['stage'], 'play', 'Play from the selected part'),
  L('NumpadEnter', null, ['stage'], 'play', 'Play from the selected part'),
  // (global: the shell leaves a focused list its Home, and the part line is one; when() below gives every other list
  // its Home back)
  L('Home', null, ['stage'], 'home', 'Play from the top', G),
  L('Backspace', null, ['stage'], 'part:remove', 'Delete the selected part (⌘Z puts it back)', G),
  L('Delete', null, ['stage'], 'part:remove', 'Delete the selected part', G),
  L('KeyN', null, ['stage'], 'part:new', 'A new part after the selected one', G),
  L('KeyN', 'shift', ['stage'], 'part:before', 'A new part before the selected one (an intro)', G),
  L('ArrowLeft', 'alt', ['stage'], 'part:left', 'Move the selected part earlier'),
  L('ArrowRight', 'alt', ['stage'], 'part:right', 'Move the selected part later'),
  L('ArrowLeft', null, ['stage'], 'tempo:-1', 'Slower by 1 BPM'),
  L('ArrowRight', null, ['stage'], 'tempo:+1', 'Faster by 1 BPM'),
  L('ArrowLeft', 'shift', ['stage'], 'tempo:-10', 'Slower by 10 BPM'),
  L('ArrowRight', 'shift', ['stage'], 'tempo:+10', 'Faster by 10 BPM'),
  L('KeyT', null, ['stage'], 'tap', 'Tap the tempo', G),
  L('BracketLeft', null, ['stage'], 'beat:prev', 'The riser’s beat card before', G),
  L('BracketRight', null, ['stage'], 'beat:next', 'The riser’s beat card after', G),
  L('KeyK', 'shift', ['stage', 'shop'], 'countin', 'The count-in into each take: on or off', G),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => L(`Digit${n}`, null, ['stage', 'shop', 'gs'], `stomp:${n}`, `Stomp pedal ${n}`, G)),
  // the camera (on the stage)
  L('KeyH', null, ['stage'], 'cam:head', 'Closer: the amp head, every knob', G),
  L('KeyC', null, ['stage'], 'cam:cab', 'Closer: the cab and its mics', G),
  L('KeyK', null, ['stage'], 'cam:kit', 'Closer: the kit and the drummer’s book', G),
  L('KeyB', null, ['stage'], 'cam:board', 'Closer: the pedalboard', G),
  L('KeyU', null, ['stage', 'shop', 'gs'], 'tuner', 'The tuner pedal: on (it mutes you) or off', G),
  L('KeyM', null, ['stage', 'shop', 'gs'], 'monitor', 'Monitoring: hear yourself through the rig, or not', G),
  L('KeyG', null, ['stage', 'review'], 'tape', 'That was the one: the last minute of tape', G),
  L('KeyS', null, ['stage'], 'shop', 'Through the door to the shop', G),
  // the tape and the riffs
  L('Enter', null, ['tape'], 'riff:keep', 'Keep the selection as a riff'),
  L('NumpadEnter', null, ['tape'], 'riff:keep', 'Keep the selection as a riff'),
  L('KeyB', null, ['tape'], 'snap', 'Snap the handles to bar lines: on or off', G),
  L('KeyL', null, ['stage', 'tape'], 'riffs', 'The riffs and the part line', G),
  L('KeyL', 'shift', ['stage', 'tape', 'library'], 'library', 'The riff library, every song’s', G),
  // the shop
  L('KeyA', null, ['shop'], 'shop:wall', 'The amp wall', G),
  L('KeyP', null, ['shop'], 'shop:case', 'The pedal case', G),
  L('KeyH', null, ['shop'], 'shop:head', 'Your head, close up, in the try-out corner', G),
  L('KeyC', null, ['shop'], 'shop:cab', 'Your cab and its mics, in the try-out corner', G),
  L('KeyS', null, ['shop'], 'shop', 'Back through the door to the stage', G),
  L('BracketLeft', null, ['shop'], 'cat:prev', 'The pedal case’s drawer above', G),
  L('BracketRight', null, ['shop'], 'cat:next', 'The pedal case’s drawer below', G),
  // Getting started
  L('Enter', null, ['gs'], 'gs:next', 'Getting started: the next step'),
  L('NumpadEnter', null, ['gs'], 'gs:next', 'Getting started: the next step'),
  // anywhere
  L('Slash', null, ['review', 'gs', 'tape', 'library', 'shop', 'stage'], 'talk', 'Talk through the glass (to Claude, when Claude’s here)', G),
  L('KeyG', 'mod', ['any'], 'glass', 'Through the glass, to the control room'),
]);

const NAMES = { Space: 'Space', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: '⌫', Delete: 'Del', Home: 'Home', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', BracketLeft: '[', BracketRight: ']', Slash: '/' };
const keyName = (code) => NAMES[code] || code.replace(/^Key|^Digit/, '');
const modName = (mod) => (mod || '').split('+').filter(Boolean).map((m) => ({ mod: '⌘', shift: '⇧', alt: '⌥' }[m] || m)).join('');
export function keyTable() {
  return KEYS.map((k) => ({ keys: modName(k.mod) + keyName(k.code), where: k.in.join(', '), does: k.label, press: typeof k.press === 'string' ? k.press : '(depends)' }));
}

export function installKeys({ ui, gr, run, live, press }) {
  const offs = [];
  // (the table's order is the order they're tried: the shell tries keys with a when() in the order they were added, and
  // `first` puts each ahead of the room's holds; added last-to-first so the first row ends up first)
  for (const k of [...KEYS].reverse()) {
    const when = () => {
      if (!live()) return false;
      if (modalUp()) return false;
      const a = typeof document !== 'undefined' ? document.activeElement : null;
      const c = contextOf(gr(), run());
      // the talkback's field (and any text field) keeps everything but Esc and Enter, which it handles itself
      if (typesText(a)) return false;
      if (c.talk && k.code !== 'Escape') return false;
      // (Home on the part line is the room's, from the top, as its hint says; the other lists keep it for their first row)
      const homeOnLine = k.code === 'Home' && !!a?.closest?.('.grt-lane');
      if (/^(Arrow|Page|Home|End)/.test(k.code) && !k.mod && (sliderFocused() || (listFocused() && !homeOnLine))) return false;
      if ((k.code === 'Enter' || k.code === 'NumpadEnter') && buttonFocused()) return false;
      // a rec row is the only kind live during a take; elsewhere the first matching context wins
      if (c.rec) return k.in.includes('rec') || k.in.includes('any');
      return k.in.some((x) => x !== 'rec' && c[x]);
    };
    const action = k.press;
    const space = k.code === 'Space';
    offs.push(ui.keys.add({ key: k.code, mod: k.mod, first: true, group: 'Live room', global: !!k.global, label: k.label, when, run: (e) => {
      // (Space is one press, wherever focus is: nothing under the window hears it, and the focused button doesn't click
      // on its keyup; a held Space's repeats do nothing more)
      if (space) { e.stopPropagation(); spaceTook = true; if (e.repeat) return; }
      press(typeof action === 'function' ? action(contextOf(gr(), run())) : action, e);
    } }));
  }
  let spaceTook = false;
  const onUp = (/** @type {KeyboardEvent} */ e) => { if (e.code === 'Space' && spaceTook) { spaceTook = false; e.preventDefault(); e.stopPropagation(); } };
  if (typeof window !== 'undefined') { window.addEventListener('keyup', onUp, true); offs.push(() => window.removeEventListener('keyup', onUp, true)); }
  return () => { for (const off of offs.splice(0)) off(); };
}
