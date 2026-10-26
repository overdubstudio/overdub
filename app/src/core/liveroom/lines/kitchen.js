// @ts-check
// The room's lines: kitchen [copy; stream D, the kitchen table] (docs/research/LIVE-ROOM-MODE.md §10). What the house
// says through the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js
// reads every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.
//
// vars, by line: k.how { mic: "The laptop's mic" }; k.balance.ok { db }; k.paper.read { sections, lines, count, chords,
// capo }; k.paper.fromtake { chords, section }; k.take.in { n, time }; k.time.read { tempo, lo, hi, player };
// k.time.moves { tempo }; k.time.speakers { part }; k.chords { chords, section }; k.form { section, times, where };
// k.capo.after { takes, capo }; k.player.in { player, where }; k.master { n, tempo }

const n = (x) => String(x).replace(/-/g, '−');
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export const LINES = {
  'k.how': { text: ({ mic = 'The laptop’s mic' } = {}) => `How is it miked? ${mic}, by the look of it.` },
  'k.phones': { text: () => 'Headphones on?' },
  'k.mic.refused': { text: () => 'The browser said no to the mic, so nothing can go on tape. Allow it in the site settings, then come back.' },
  'k.speakers.wait': { text: () => 'On speakers, the band waits till you’re done.' },
  'k.balance.strum': { text: () => 'Strum the way you’ll play.' },
  'k.balance.sing': { text: () => 'Sing a line, or speak one.' },
  'k.balance.ok': { text: ({ db = 5 } = {}) => `Good: your voice sits ${n(db)} dB over the guitar.` },
  'k.balance.guitar': { text: () => 'The guitar’s louder than you: tilt the laptop up toward your mouth, or sit back a little.' },
  'k.balance.voice': { text: () => 'You’re well over the guitar: bring the mic a little closer to the soundhole.' },
  'k.balance.skip': { text: () => 'No singing? Skip.' },
  'k.browser': { once: true, text: () => 'This browser cleans up the mic like a phone call, so the guitar may come out thin. A laptop or an interface sounds better.' },
  'k.solo.direct': { once: true, text: () => 'Turn the Solo’s direct monitor on to hear yourself without the delay.' },
  'k.paper.blank': { text: () => 'Type the words, or [G] for a chord. Or just play: the band will write the chords down for you.' },
  'k.paper.read': {
    text: ({ sections = 0, lines = 0, count = 0, chords = [], capo = 0 } = {}) =>
      `Read ${sections} section${sections === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'}, ${count} chord${count === 1 ? '' : 's'}${chords.length ? `: ${chords.join(', ')}` : ''}.${capo ? ` Capo ${capo}.` : ''}`,
  },
  'k.paper.fromtake': { text: ({ chords = '', section = 'verse' } = {}) => `Sounds like ${chords} in the ${section}. Write it down?` },
  'k.tape.start': { text: () => 'Space starts the tape. Play it through; Space again when you’re done.' },
  'k.take.in': { text: ({ n: k = 1, time = '0:00' } = {}) => `Take ${k} is in: ${time}. The band’s reading it.` },
  'k.time.read': {
    text: ({ tempo = 84, lo = null, hi = null, player = 'the shaker' } = {}) =>
      `The band’s read it: around ${tempo}${lo != null && hi != null && hi - lo >= 2 ? `, drifting ${lo} to ${hi}` : ''}. Hear ${player} on it?`,
  },
  'k.time.moves': { text: ({ tempo = 84 } = {}) => `The time moves a lot in this take: again to a shaker? It counts you in at ${tempo} and the band follows that.` },
  'k.time.speakers': { text: ({ part = '' } = {}) => (part ? `The band will sit out where the time moves, in the ${part}.` : 'The band will sit out where the time moves.') },
  'k.chords': { text: ({ chords = '', section = 'verse' } = {}) => `The band has your chords: ${chords} in the ${section}.` },
  'k.form': { text: ({ section = 'chorus', times = 2, where = 'at the end' } = {}) => `You played the ${section} ${times === 2 ? 'twice' : `${times} times`} ${where}. Write it as ${cap(section)} ×${times}?` },
  'k.unknown': { text: () => 'The band doesn’t know this one: they’ll rest under it.' },
  'k.capo.after': { text: ({ takes = [1], capo = 0 } = {}) => `Take${takes.length > 1 ? 's' : ''} ${list(takes.map(String))} ${takes.length > 1 ? 'were' : 'was'} ${capo ? `capo ${capo}` : 'no capo'}, so the band won’t match ${takes.length > 1 ? 'them' : 'it'} now.` },
  'k.offer.shaker': { text: () => 'Want a shaker in the chorus?' },
  'k.offer.cajon': { text: () => 'The cajón under the verses?' },
  'k.offer.bass': { text: () => 'The bass from the first chorus?' },
  'k.offer.strings': { text: () => 'Strings in the bridge?' },
  // "Shaker's in the chorus", "Bass is in from the first chorus", "Strings are in the bridge"
  'k.player.in': {
    text: ({ player = 'Shaker', where = 'the chorus' } = {}) => {
      const p = cap(player), many = /s$/i.test(p) && !/ss$/i.test(p);
      return `${p}${many ? ' are' : /s$/i.test(p) ? ' is' : '’s'} in ${where}: ${many ? 'they follow' : 'it follows'} your time.`;
    },
  },
  'k.master': { text: ({ n: k = 1, tempo = null } = {}) => `Take ${k} is the master now: the band follows it${tempo ? `, around ${tempo}` : ''}.` },
  'k.both.or.voice': { text: () => 'Both, or just the voice?' },
  'k.pickup.needed': { text: () => 'Two inputs need a guitar with a pickup.' },
};
