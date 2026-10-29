// @ts-check
// The room's lines: soundcheck [copy; stream A, the deck] (docs/research/LIVE-ROOM-MODE.md §10). What the house says through
// the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js reads
// every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.
//
// The soundcheck's lamps say these (ui/liveroom/soundcheck.js), and the stage says the deck's (take.esc, take.short,
// kit.*) from the line ids the deck hands it (ui/liveroom/deck.js). Numbers: a real minus, a space before the unit.
//   vars: device (the input's name as the system gives it), input (its channel number), amp (monitoring through the
//   amp is on), db (a peak, dBFS), name (a tuning's name in a sentence: "drop C"), note (a low string's note), a and b
//   (the two tunings a low string can be), cents, flat, ms, late, pct

const minus = (x) => (x < 0 ? `−${Math.abs(x)}` : String(x));
const dB = (x) => `${minus(Math.round(Number(x) || 0))} dB`;
const ms = (x) => `${Math.round(Number(x) || 0)} ms`;
const on = (v) => (v.input ? `input ${v.input} of ${v.device || 'the interface'}` : v.device || 'the input');

export const LINES = {
  // 1. Plug in
  'plug.ask': { text: () => 'Plug into the interface and hit a chord. The browser asks for the input first.' },
  'plug.ok': { text: (v) => `Guitar on ${on(v)}.${v.amp ? ' The amp’s on.' : ''}` },
  'plug.nothing': { text: (v) => `Nothing’s coming in on ${v.device || 'the input'}. Guitar on input ${v.input || 1}, INST on, gain up?` },
  'plug.refused': { text: () => 'The browser said no to the input, so the amp’s off. Allow it in the site settings, then come back.' },
  'plug.mic': { text: () => 'That’s the laptop’s mic. An electric needs an interface; the kitchen table works with this mic.' },
  'plug.direct': { text: () => 'If you hear a clean guitar under the amp, turn off the interface’s direct monitor.', once: true },
  // 2. Level: the hardest strums peak in the green, −18 to −6 dBFS
  'level.ok': { text: (v) => `Loud and clear: peaks at ${dB(v.db)}.` },
  'level.hot': { text: (v) => `Hot: peaks at ${dB(v.db)}. Turn input ${v.input || 1} down a little.` },
  'level.clip': { text: (v) => `That clipped. Turn input ${v.input || 1} down a touch.` },
  'level.quiet': { text: (v) => `Quiet: peaks at ${dB(v.db)}. Turn input ${v.input || 1} up.` },
  // 3. Tune: the open low string names the tuning; where it can be two, it asks
  'tune.ask': { text: () => 'Play the open low string.' },
  'tune.ok': { text: (v) => `In tune: ${v.name}.` },
  'tune.which': { text: (v) => `Low string ${v.note}: ${v.a} or ${v.b}?` },
  'tune.off': { text: (v) => `The guitar’s about ${Math.round(Number(v.cents) || 0)} cents ${v.flat ? 'flat' : 'sharp'} against the band. Tune ${v.flat ? 'up' : 'down'} a touch: U shows the note.` },
  // 4. Line it up: eight strums to the clicks, once per device
  'line.ask': { text: () => 'Strum on each of eight clicks: two to settle, then six.' },
  'line.ok': { text: (v) => `Lined up: ${ms(v.ms)} there and back.` },
  'line.long': { text: (v) => `You’ll hear yourself ${ms(v.ms)} late on this setup. Wired headphones on the interface help.` },
  'line.output': { text: (v) => `These headphones add ${ms(v.ms)} on their own: wireless, most likely. Wired ones, or the interface’s output, for playing.` },
  'line.lean': { text: (v) => `Your last two takes landed about ${ms(v.ms)} ${v.late === false ? 'ahead of' : 'behind'} the drums. Line it up with eight strums?`, once: true },
  // coming back on the same input: the lamps are lit already
  'ready.back': { text: (v) => `${v.device || 'The input'}${v.input ? `, input ${v.input}` : ''}: ready.` },
  // the deck: the count waiting on the kit, a pass not kept
  'kit.loading': { text: (v) => `The drummer’s still setting up: ${Math.round(Number(v.pct) || 0)}%.` },
  'kit.offline': { text: () => 'No sampled kit on this connection: the drummer’s on the practice kit.', once: true },
  'take.short': { text: () => 'Nothing to keep: under a bar.' },
  'take.esc': { text: () => 'Not that one: it’s in Capture.' },
};
