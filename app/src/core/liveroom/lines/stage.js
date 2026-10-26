// @ts-check
// The room's lines: stage [copy; stream C, the stage] (docs/research/LIVE-ROOM-MODE.md §10). What the house says through
// the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js reads
// every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.
//
// The vars each line reads (every number is the musician's: bars, BPM, minutes; a part's name as the song has it):
//   before.tempo   { bpm }                                  the drummer's tempo before the first take
//   part.in        { part, bars, bpm, tuning? }             the first take of a part landed, the band about to learn it
//   next.in        { part, bars, what? }                    a later part's first take (what: what the drummer did)
//   again.in       { part, take, was }                      another take of a part: take n, take `was` a key away
//   twice.in       { part, bars }                           ×2
//   loop.on        { part }                                 Round and round
//   moved          { part, where }                          Earlier · Later (where: "before the second verse")
//   shorter        { part, bars }                           Shorter
//   removed        { part, bars }                           Remove
//   layout.offer   { form, bars, time }                     Lay it out (once per song)
//   layout.in      { bars, time, empty? }                   the form is in (empty: the empty part's name)
//   end.follows    {}                                       R on the End
//   hear.done      { parts, time }                          top to bottom, nothing empty
//   hear.empty     { time, part }                           top to bottom, a part still empty
//   back.where     { title, note }                          coming back to a song (the note: written from the song)
//   back.assets    {}                                       the song's recordings aren't in this browser
//   undo.pair      { part, take, back? }                    ⌘Z took a take and the band's learning out together
//   redo.pair      { part, take }                           ⇧⌘Z put them back
//   undo.alone     { part }                                 ⌘Z took the learning out alone (something landed between)
//   take.none      {}                                       a pass ended with nothing to keep
//   pass.capture   {}                                       Esc in a pass: nothing went in, it's in Capture
//   other.now      {}                                       the other side's pass is next
//   feel.on        { feel }                                 another feel (its name)
//   band.busy      { step }                                 Simpler · Busier (-1, 0, 1)
//   band.loud      { step }                                 Softer · Louder (-1, 0, 1)
//   bass.yours     {}                                       Play the bass yourself
//   take.pick      { part, take }                           ↑ ↓: which take plays in a part
//   take.one       { part }                                 ↑ ↓ on a part with one take
//   take.edge      { part, take, first }                    ↑ ↓ past the first or the last take

const cap = (s) => { const t = String(s ?? ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const low = (s) => String(s ?? '').toLowerCase();
const bars = (n) => `${n} bar${n === 1 ? '' : 's'}`;

export const LINES = {
  'before.tempo': { text: ({ bpm }) => `The drummer’s at ${bpm}: ← → moves it, T four times taps it. Space and you’re counted in.` },
  'part.in': { text: ({ part, bars: n, bpm, tuning }) => `${cap(part)} is in: ${bars(n)} at ${bpm}${tuning ? `, ${tuning}` : ''}. The band’s learning it.` },
  'next.in': { text: ({ part, bars: n, what }) => `${cap(part)} is in${what ? `: ${what}` : ''}. ${cap(bars(n))}.` },
  'again.in': { text: ({ part, take, was }) => `Take ${take} is in on the ${low(part)}: the drummer follows it now. Take ${was} is a key away: ↓.` },
  'twice.in': { text: ({ part, bars: n }) => `${cap(part)} ×2: ${bars(n)}.` },
  'loop.on': { text: ({ part }) => `Round and round on the ${low(part)}. Space hears it, R records it.` },
  moved: { text: ({ part, where }) => `Moved the ${low(part)} ${where}.` },
  shorter: { text: ({ part, bars: n }) => `${cap(part)}: ${bars(n)} now.` },
  removed: { text: ({ part, bars: n }) => `Removed the ${low(part)}: ${bars(n)}. ⌘Z brings it back.` },
  'layout.offer': { once: true, text: ({ form, bars: n, time }) => `Two parts in: lay them out as a song? ${cap(form)}: ${bars(n)}, ${time}.` },
  'layout.in': { text: ({ bars: n, time, empty }) => `Laid out: ${bars(n)}, ${time}.${empty ? ` The ${low(empty)} is empty: the band plays it on its own until you do.` : ''}` },
  'end.follows': { text: () => 'The end follows your last part.' },
  'hear.done': { text: ({ parts, time }) => `That’s the song: ${parts} part${parts === 1 ? '' : 's'}, ${time}.` },
  'hear.empty': { text: ({ time, part }) => `That’s ${time} top to bottom. The ${low(part)}’s still empty.` },
  'back.where': { text: ({ title, note }) => `${title}, where you left it${note ? `: ${note}` : '.'}` },
  'back.assets': { text: () => 'This song’s recordings are in another browser. The band’s here; your guitar isn’t.' },
  'undo.pair': { text: ({ part, take, back }) => `Undone: ${low(part)} take ${take}.${back ? ` The drummer’s back on take ${back}.` : ''}` },
  'redo.pair': { text: ({ part, take }) => `Back in: ${low(part)} take ${take}, and the band’s learning with it.` },
  'undo.alone': { text: ({ part }) => `Undone: what the band learned on the ${low(part)}. Something came in after the take, so the take stays.` },
  'take.none': { text: () => 'Nothing to keep from that one.' },
  'pass.capture': { text: () => 'Not that one: it’s in Capture. ⇧R puts it in after all.' },
  'other.now': { text: () => 'Now the other side.' },
  'feel.on': { text: ({ feel }) => `${cap(feel)}. F for another.` },
  'band.busy': { text: ({ step }) => (step < 0 ? 'Simpler: no fills, the kick on the accents.' : step > 0 ? 'Busier: fills into the turns.' : 'Back to how the drummer had it.') },
  'band.loud': { text: ({ step }) => (step < 0 ? 'Brought down: hats instead of the crash.' : step > 0 ? 'Up: the crash instead of the hats.' : 'Back to how the drummer had it.') },
  'bass.yours': { text: () => 'The bass is yours on this part: plug it in, then Space.' },
  'take.pick': { text: ({ part, take }) => `Take ${take} plays on the ${low(part)}.` },
  'take.one': { text: ({ part }) => `The ${low(part)} has one take so far.` },
  'take.edge': { text: ({ part, take, first }) => `Take ${take} is the ${first ? 'first' : 'last'} on the ${low(part)}.` },
};
