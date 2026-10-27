// @ts-check
// What the tape, the riffs and the talkback say [ui; the guitar room's TAPE stream] (docs/BRAND.md "the engineer behind
// the glass"; the live room's rules, docs/research/LIVE-ROOM-MODE.md §10: calm, quick, a little dry; say what happened,
// then what changed, then the number; two sentences at most; no grades, no alarm words, no machinery). Pure: each
// returns the line's text; the tape stream says it in the talkback (R.say) or puts it on the screen.
// tools/liveroom/checks-tape.js holds every line here to checks-copy.js's never-says words.
//
//   bars(n) -> '4 bars'        secs(s) -> '7.3 s'        barsOf(sel) -> 'bars 30–33' | 'bar 9'
//   TAPE_LINES = { id: (vars) => text }   the lines, by id (the ids are this module's, not core/liveroom/lines/'s)

export const plural = (n, w) => `${fmtN(n)} ${w}${Math.abs(n - 1) < 1e-9 ? '' : 's'}`;
export const fmtN = (n) => (Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString());
export const bars = (n) => plural(n, 'bar');
export const secs = (s) => `${(Math.round(s * 10) / 10).toFixed(1)} s`;
export const barsOf = (a, b) => (b > a ? `bars ${a}–${b}` : `bar ${a}`);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export const TAPE_LINES = {
  // the last minute, opened
  open: ({ a, b }) => `The last minute, on the drummer’s bars. ${b > a ? `Bars ${a} to ${b} are` : `Bar ${a} is`} picked, the last you played: Enter keeps ${b > a ? 'them' : 'it'}.`,
  openFree: ({ s }) => `The last minute. The last ${secs(s)} you played ${s === 1 ? 'is' : 'are'} picked: Enter keeps it.`,
  openQuiet: () => 'The tape’s rolling, but nothing’s been played on it yet.',
  openNone: () => 'Nothing on tape yet: it rolls once you’re plugged in.',
  // kept
  kept: ({ name, n, tempo, tuning }) => `${name} is in the tray: ${bars(n)} at ${tempo}${tuning ? `, ${tuning}` : ''}. Drag it to the part line, or Enter puts it after the selected part.`,
  keptFree: ({ name, s, tuning }) => `${name} is in the tray: ${secs(s)}${tuning ? `, ${tuning}` : ''}. Drag it to the part line, or Enter puts it after the selected part.`,
  waiting: ({ bar }) => `Bar ${bar} isn’t over yet: it goes in the tray when it is.`,
  // hearing
  hear: ({ name }) => `${name}, round and round, through your rig. Click it again to stop.`,
  hearSel: ({ what }) => `${what}, round and round, through your rig.`,
  // the library
  gone: ({ name }) => `${name} is out of the library. Put it back is under the list.`,
  back: ({ name }) => `${name} is back in the library.`,
  renamed: ({ name }) => `Renamed: ${name}.`,
  // Claude on the talkback
  nobody: () => 'Nobody’s on the other side of the glass. Claude comes in from the control room: ⌘G.',
  outside: ({ names }) => `${list(names.length ? names : ['An agent'])} ${names.length > 1 ? 'are' : 'is'} on the line from outside: type to ${names.length > 1 ? 'them' : 'it'} there, and what comes back shows here.`,
  cloud: () => 'Claude on Overdub credits shows its price before each ask, and that’s in the control room: ⌘G.',
  busy: () => 'Claude’s still on the last one. Give it a moment.',
  noAnswer: ({ why }) => `Claude didn’t answer: ${String(why || 'nothing came back').replace(/[\s.]+$/, '')}.`,
};
