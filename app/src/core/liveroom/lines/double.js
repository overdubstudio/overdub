// @ts-check
// The room's lines: double [copy; stream B, the double] (docs/research/LIVE-ROOM-MODE.md §10). What the house says through
// the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js reads
// every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.
//
// The vars each takes (a part is its section's name as the song has it, "Verse"; the line lowercases it in a sentence):
//   learn.got { place }                side.now { place }                       side.tight { part, ms }
//   learn.thin {}                      side.fine { part, ms }                   side.drift { part, bar, dir, ms }
//   side.punched { bar, ms }           side.wander { part, bar }                side.use2 { part, count, take }
//   side.intro {}                      side.both {}                             guide.held { take, ms }
//   guide.drifts { from, bar, take }   feel.named { feel }                      busy.simpler {} · busy.busier {}
//   loud.softer {} · loud.louder {}    finish.offer { finish, others: [two] }   finish.chosen { finish, than, db, pushed? }
//   finish.hearing { finish, than, matched }    finish.on { finish }            bass.yours { part }
// (finish.chosen: db is the chosen one's measured loudness against the one it replaced, rounded to the dB here; pushed:
// it's the same mix pushed, the Loud finish. finish.hearing: a chip focused, its finish previewed, matched to the level
// of the one on when its loudness has been measured. finish.on: what's on, said when a focus goes or before the number)
// ms figures arrive as measured; a drift's is rounded here to 5 ms (§4.7), the others to the ms.

const lower = (s) => String(s ?? '').toLowerCase();
const cap = (s) => { const x = String(s ?? ''); return x.charAt(0).toUpperCase() + x.slice(1); };
const ms = (x) => Math.max(1, Math.round(Number(x) || 0));
const ms5 = (x) => Math.max(5, Math.round((Number(x) || 0) / 5) * 5);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${WORDS[n] || n} times`);

export const LINES = {
  // the band learned the part (§3.4): about a second after the take's line
  'learn.got': { text: (v) => (v?.place === 'bluesbar' ? 'They’ve got it: the drummer’s on your shuffle and the bass walks your roots.' : 'They’ve got it: the kick’s on your chugs and the bass has your roots.') },
  'learn.thin': { text: () => 'The kick keeps its own pattern here: it didn’t hear clear low notes. The bass waits for them.' },
  // the other side (§3.7)
  // (the basement offers it once, after the second part, §2.4; elsewhere it's the next press)
  'side.now': { text: (v) => (v?.place === 'basement' ? 'Now the other side? Punk doubles too.' : 'Now the other side.') },
  'side.tight': { text: ({ part, ms: m }) => `Right side is in on the ${lower(part)}: the guitars are wide now. Within ${ms(m)} ms of the left all the way.` },
  'side.fine': { text: ({ part, ms: m }) => `Right side is in on the ${lower(part)}: the guitars are wide now. Within ${ms(m)} ms of the left.` },
  'side.drift': { text: ({ part, bar, dir, ms: m }) => `Right side is in on the ${lower(part)}: bar ${bar} drifts ${dir === 'early' ? 'early' : 'late'} against the left, about ${ms5(m)} ms. Bar ${bar} again?` },
  'side.punched': { text: ({ bar, ms: m }) => `Bar ${bar} is in: ${ms(m)} ms from the left now.` },
  'side.wander': { text: ({ part, bar }) => `Right side is in on the ${lower(part)}. It wanders from bar ${bar}: again on the right?` },
  'side.use2': { once: true, text: ({ part, count, take }) => `You played the ${lower(part)} ${times(count)}. Use take ${take} as the right side?` },
  'side.intro': { once: true, text: () => 'The intro stays on the left alone, so the verse comes in wide. D doubles it anyway.' },
  'side.both': { text: () => 'Both sides are in. The guitars are wide and the bass is under them.' },
  // the guide changed (§4.3)
  'guide.held': { text: ({ take, ms: m }) => `The drummer follows take ${take} now. The right side still sits within ${ms(m)} ms.` },
  'guide.drifts': { text: ({ from, bar, take }) => `The right side was played to take ${from}: from bar ${bar} it drifts against take ${take}. Again on the right?` },
  // directing the drummer (§3.9, §4.4)
  'feel.named': { text: ({ feel }) => `${cap(feel)}. F for another.` },
  'busy.simpler': { text: () => 'Simpler: no fills, the kick on the accents.' },
  'busy.busier': { text: () => 'Busier: a fill every four bars, ghost notes on the snare.' },
  'loud.softer': { text: () => 'Brought down: hats instead of the crash.' },
  'loud.louder': { text: () => 'Pushed: a crash on every bar.' },
  // the finish (§3.12)
  'finish.offer': { once: true, text: ({ finish, others = [] }) => `Hear it with a finish? ${cap(finish)} is on; ${others.map(cap).join(' and ')} ${others.length === 1 ? 'is' : 'are'} a press away.` },
  'finish.chosen': {
    text: ({ finish, than, db, pushed }) => {
      const d = Math.round(Number(db) || 0);
      if (d >= 1) return pushed ? `${cap(finish)}: the same mix, pushed. About ${d} dB louder than ${cap(than)}.` : `${cap(finish)} is on: about ${d} dB louder than ${cap(than)}.`;
      if (d <= -1) return `${cap(finish)} is on: about ${-d} dB quieter than ${cap(than)}.`;
      return `${cap(finish)} is on: about as loud as ${cap(than)}.`;
    },
  },
  'finish.hearing': { text: ({ finish, than, matched }) => (matched ? `Hearing ${cap(finish)} at ${cap(than)}’s level. Press it to put it on.` : `Hearing ${cap(finish)}. Press it to put it on.`) },
  'finish.on': { text: ({ finish }) => `${cap(finish)} is on.` },
  // your bass (§4.5)
  'bass.yours': { text: ({ part }) => `Bass is in on the ${lower(part)}: yours. The house’s is off there.` },
};
