// @ts-check
// The room's lines: glass [copy; stream C, the glass] (docs/research/LIVE-ROOM-MODE.md §10). What the house says through
// the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js reads
// every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.
//
// What the room reads back from the control room (§3.15, §7.5). glass.back carries the changes as one list, and is
// signed by the agent when an agent made them; the room says the once-per-track lines through its own marks
// ('glass.track:<id>', 'glass.levels:<id>'), so each comes once per track and song:
//   glass.job          { job }                   a control-room job (once per job: the room marks 'glass.job:<job>')
//   glass.back         { changes }               "While you were in the control room: …"
//   glass.levels       { track }                 a fader the house set, moved behind the glass (once per track)
//   glass.drums.edited { part, track? }          F over band notes someone else wrote
//   glass.amp.yours    {}                        ‹ › over amp knobs moved behind the glass
//   glass.master.yours {}                        a finish over a master changed behind the glass
//   glass.tempo        { bpm, was }              the tempo moved after takes (once)
//   glass.meter        { meter }                 a meter not in four (once)
//   glass.track        { track, kind? }          a track came in from the control room (once per track)
//   glass.nofeel       { part }                  a section made behind the glass: no feel yet

const low = (s) => String(s ?? '').toLowerCase();
// plural names take a bare apostrophe (the drums’ level); the bass keeps its ’s
const possessive = (s) => (/[^s]s$/.test(s) ? `${s}’` : `${s}’s`);
const JOBS = {
  edit: 'editing inside a take',
  comp: 'comping takes',
  mixer: 'the mixer',
  knobs: 'turning a device’s knobs',
  notes: 'writing notes',
  instrument: 'an instrument this room doesn’t have',
};

export const LINES = {
  'glass.job': { text: ({ job }) => `${JOBS[job] ? `${JOBS[job][0].toUpperCase()}${JOBS[job].slice(1)} is` : 'That’s'} a control-room job: the takes are laid out there. Control room →` },
  'glass.back': { text: ({ changes }) => `While you were in the control room: ${changes}. The room leaves ${/\band\b|,/.test(String(changes)) ? 'them' : 'it'} as ${/\band\b|,/.test(String(changes)) ? 'they are' : 'it is'}.` },
  'glass.levels': { text: ({ track }) => `You set the ${possessive(low(track))} level in the control room. The room leaves it there.` },
  'glass.drums.edited': { text: ({ part, track = 'drums' }) => (low(track) === 'drums' ? `The ${low(part)} drums were changed in the control room: another feel would replace them. Go ahead?` : `The ${low(part)} ${low(track)} was changed in the control room; the band plays it as it is now.`) },
  'glass.amp.yours': { text: () => '‹ › replaces your amp settings. ⌘Z brings them back.' },
  'glass.master.yours': { text: () => 'The finish is yours from the control room. Another one replaces it, and ⌘Z brings yours back.' },
  'glass.tempo': { once: true, text: ({ bpm, was }) => `The tempo’s ${bpm} now: your takes were played at ${was}, so they won’t sit on the new bars.` },
  'glass.meter': { once: true, text: ({ meter }) => `The song’s in ${meter} now. The band plays in four; its parts stay as they are.` },
  'glass.track': { text: ({ track, kind }) => `${kind === 'audio' ? 'An audio track' : 'A track'}, ${track}, came in from the control room.` },
  'glass.nofeel': { text: ({ part }) => `The drummer hasn’t played the ${low(part)} yet. F to give it a feel.` },
};
