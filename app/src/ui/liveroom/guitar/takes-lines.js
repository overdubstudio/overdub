// @ts-check
// The takes' lines [copy; the guitar room's TAKES stream] (docs/BRAND.md "The live room"; docs/research/GUITAR-ROOM.md
// §2.5-§2.8; design/mock/guitar-room/ for the words). What the house says through the talkback about takes and the part
// line, one line each, in the engineer's voice: what went in, then what changed, then the number. Two sentences at most,
// no exclamation mark, a real minus. tools/liveroom/checks-takes.js holds every line here to the room's copy rules
// (tools/liveroom/checks-copy.js breaks()), rendered both ways.
//
//   LINES: { [id]: { text(vars) -> string } }   the same shape as core/liveroom/lines/*.js; the room says them with
//          R.say(LINES[id].text(vars)) (they're the stream's, so they live beside it, not in the live room's table)
//
// Vars: part (the part's name as the song has it), take (its number on its side), bars, ring (bars that rang past),
// next (the part after, or null), stopped (the bar the stop came in, 1 is the part's first), n (how many), side ('L' |
// 'R'), where ('before Chorus' | 'after Verse' | ''), tape (the rolling tape kept it: true | false).

const num = (x) => { const v = Math.round((Number(x) || 0) * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const bars = (x) => `${num(x)} bar${Math.abs((Number(x) || 0) - 1) < 0.05 ? '' : 's'}`;
const takes = (n) => `${n} take${n === 1 ? '' : 's'}`;

export const LINES = {
  // the count, the take
  'gtake.count': { text: ({ part, side }) => (side === 'R' ? `Counting in: the other side of ${part}. Your left take plays under it.` : `Counting in: ${part}.`) },
  'gtake.new': { text: () => 'Counting in: a new part at the end. Stop when you’re done; the part ends on the bar line before.' },
  'gtake.input': { text: () => 'The input isn’t open. Plug in first: Getting started has it.' },
  'gtake.none': { text: () => 'Nothing went in: less than a bar was played.' },
  'gtake.stopped': { text: () => 'Stopped in the count. Nothing went in.' },
  'gtake.esc': { text: ({ tape }) => (tape ? 'Tossed it. The tape still has it.' : 'Tossed it.') },
  'gtake.again': { text: () => 'From the top: counting you back in.' },
  // landed, then Keep / Toss / Again
  'gtake.in': { text: ({ take, bars: b, ring, next }) => `Take ${take} is in: ${bars(b)}${ring > 0.05 ? `, and ${bars(ring)} rang ${next ? `into ${next}` : 'past the end'}` : ''}. Keep it?` },
  'gtake.short': { text: ({ take, stopped, bars: b }) => `Take ${take} is in: you stopped in bar ${stopped} of ${b}. Keep it?` },
  'gtake.newin': { text: ({ part, bars: b, ring }) => `${part} is in: ${bars(b)}${ring > 0.05 ? `, and ${bars(ring)} rang past it` : ''}. Keep it?` },
  'gtake.kept': { text: ({ part, n }) => `Kept: ${part} has ${takes(n)}${n > 1 ? ', and ↑ ↓ picks the one that plays' : ''}. D for the other side.` },
  'gtake.keptR': { text: ({ part }) => `Kept. Both sides of ${part}, wide.` },
  // the other side landed: how tightly it sits on your left (core/liveroom/tight.js measurePair's verdict and figures:
  // ms the median or the worst bar's, bar the one that drifts or wanders from, dir 'early' | 'late'); verdict null when
  // there was too little to measure. Review is up, so the question is the review's (Keep it?), never a punch-in the
  // guitar room doesn't have
  'gtake.pair': {
    text: ({ verdict, ms, bar, dir }) => {
      const m = Math.max(1, Math.round(Math.abs(Number(ms) || 0)));
      if (verdict === 'tight') return `The other side is in: within ${m} ms of your left all the way. Keep it?`;
      if (verdict === 'fine') return `The other side is in: within ${m} ms of your left. Keep it?`;
      if (verdict === 'bar') return `The other side is in: bar ${bar} runs ${dir === 'early' ? 'early' : 'late'} against your left, about ${Math.max(5, Math.round(m / 5) * 5)} ms. Keep it, or R for again?`;
      if (verdict === 'loose') return `The other side is in: it wanders off your left from bar ${bar || 1}. Keep it, or R for again?`;
      return 'The other side is in. Keep it?';
    },
  },
  'gtake.tossed': { text: ({ take, tape }) => `Tossed take ${take}. It’s gone from the song${tape ? '; the tape still has it' : ''}.` },
  'gtake.pick': { text: ({ part, take }) => `${part}: take ${take} plays.` },
  'gtake.one': { text: ({ part }) => `${part} has one take on that side.` },
  'gtake.edge': { text: ({ part, take }) => `${part}: take ${take} is already the ${take === 1 ? 'first' : 'last'}.` },
  'gtake.trim': { text: ({ ring }) => (ring > 0.05 ? `The ring runs ${bars(ring)} past the part now.` : 'The take ends with the part now.') },
  'gtake.partlen': { text: ({ part, bars: b }) => `${part} is ${bars(b)} now.` },
  'gtake.side': { text: () => 'Play a part on the left first; the other side plays against it.' },
  'gtake.busy': { text: () => 'A take is running. Space stops it.' },
  // the part line
  'gpart.empty': { text: () => 'The part line’s empty. R records a part, or drop a riff on it.' },
  'gpart.added': { text: ({ part, bars: b, where }) => `A new part, ${part}: ${bars(b)}${where ? `, ${where}` : ''}. R records it.` },
  'gpart.removed': { text: ({ part, n }) => (n ? `${part} is off the part line. ⌘Z brings it back.` : `The part line’s empty. ⌘Z brings ${part} back.`) },
  'gpart.moved': { text: ({ part, where }) => (where ? `Moved ${part} ${where}.` : `Moved ${part}.`) },
  'gpart.riff': { text: ({ part, bars: b, where }) => `${part} is a part now: ${bars(b)}${where ? `, ${where}` : ''}. Its take is the riff; R records over it.` },
  'gpart.named': { text: ({ part }) => `It’s ${part} now.` },
  'gpart.from': { text: ({ part }) => `Playing from ${part}.` },
  'gpart.top': { text: () => 'Playing from the top.' },
  'gpart.first': { text: () => 'It’s the first part.' },
  'gpart.last': { text: () => 'It’s the last part.' },
};

export const lineOf = (id, vars = {}) => { const l = LINES[id]; return l ? l.text(vars) : ''; };
export const say = (R, id, vars = {}) => {
  const l = LINES[id];
  if (!l) return false;
  try { R.say(l.text(vars)); return true; } catch (e) { console.error('takes: a line', id, e); return false; }
};
