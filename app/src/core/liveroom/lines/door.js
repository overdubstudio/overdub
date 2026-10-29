// @ts-check
// The room's lines: door [copy; stream F, the door] (docs/research/LIVE-ROOM-MODE.md §10). What the house says through
// the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js reads
// every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.
//
// The door's (ui/liveroom/door.js, §3.1): its question, its quiet links, and each place's card (the slate in mono
// capitals, the line under it). The cards' numbers are the places' starting tempos (core/liveroom/places.js setupOf).

export const LINES = {
  'door.ask': { text: () => 'Where are we playing?' },
  'door.nogtr': { text: () => 'No guitar? Hum, tap or play keys in the control room.' },
  'door.house': { text: ({ title = 'Boiler Room' } = {}) => `Hear one the house made: ${title}.` },
  'door.local': { text: () => 'Your takes stay in this browser.' },
  'door.phone.iface': { text: () => 'Needs an interface on a phone.' },
  'door.slate.metal': { text: ({ bpm = 132 } = {}) => `ELECTRIC · ${bpm} · ONE STACK AND A BIG KIT` },
  'door.slate.basement': { text: ({ bpm = 172 } = {}) => `ELECTRIC · ${bpm} · ONE AMP, TOO LOUD` },
  'door.slate.bluesbar': { text: ({ bpm = 96 } = {}) => `ELECTRIC · ${bpm} · A SHUFFLE` },
  'door.slate.kitchen': { text: () => 'ACOUSTIC AND VOICE · YOUR TEMPO' },
  'door.card.metal': { text: () => 'Tight and heavy. Your stack, a drummer, and the tape rolling.' },
  'door.card.basement': { text: () => 'Fast and loud, under somebody’s house.' },
  'door.card.bluesbar': { text: () => 'A small amp on a chair, twelve bars at a time.' },
  'door.card.kitchen': { text: () => 'A sheet of paper and the laptop’s mic. For a song with words.' },
};
