// @ts-check
// The room's lines: shelf [copy; stream F, the shelf] (docs/research/LIVE-ROOM-MODE.md §10). What the house says through
// the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js reads
// every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.
//
// The shelf's (ui/liveroom/shelf.js, §3.13), sending's (ui/liveroom/send.js, §3.14), coming back's (§2.6), and note.*:
// the tape box's note, written from the song each time (core/liveroom/label.js labelOf), never stored. Numbers come in
// already written (a time as 1:51, megabytes as a whole number); a list of parts comes in as words ("Verse and chorus").
// shelf.backup is said once per browser, not per song: the shelf keeps that itself (prefs said/mark under 'browser').

const s = (n, one, many) => (n === 1 ? one : many);

export const LINES = {
  // the shelf
  'shelf.backup': { once: true, text: () => 'Kept in this browser. Back it up? One file with your recordings.' },
  'shelf.safari': { text: () => 'Safari can clear a site’s storage after a week away.' },
  'shelf.space': { text: ({ minutes = 0 } = {}) => `This browser has room for about ${minutes} more ${s(minutes, 'minute', 'minutes')} of takes.` },
  'shelf.remove.ask': { text: ({ title = 'This song', mb = 0 } = {}) => (mb > 0 ? `Take ${title} off the shelf? Its ${mb} MB of takes go with it, and that can’t be undone.` : `Take ${title} off the shelf? That can’t be undone.`) },
  'shelf.done': { text: ({ title = 'The song', kept = 0 } = {}) => `${title} is off the shelf.${kept ? ` ${kept} ${s(kept, 'recording stays', 'recordings stay')}: another song here uses ${s(kept, 'it', 'them')}.` : ''}` },
  'shelf.empty': { text: () => 'Nothing on the shelf yet. A song you play in the room is kept here.' },
  'shelf.control': { text: () => 'made in the control room' },
  'shelf.here': { text: () => 'On the stage now.' },
  // sending
  'send.mix': { text: ({ time = '0:00', mb = 0 } = {}) => `Send a mix: ${time}, about ${mb} MB.` },
  'send.song': { text: ({ mb = 0 } = {}) => `Send the song: to open in Overdub, with your recordings (${mb} MB).` },
  'send.saved': { text: ({ name = 'the mix', time = '0:00', mb = 0 } = {}) => `Saved “${name}”: ${time}, ${mb} MB. It’s the mix; the takes stay in this browser.` },
  'send.shared': { text: ({ name = 'the mix', time = '0:00', mb = 0 } = {}) => `Sent “${name}”: ${time}, ${mb} MB. It’s the mix; the takes stay in this browser.` },
  'send.song.saved': { text: ({ name = 'the song', mb = 0, n = 0 } = {}) => `Saved “${name}”: ${mb} MB, the song and ${n} ${s(n, 'recording', 'recordings')}. Open it in Overdub to put ${s(n, 'it', 'them')} back.` },
  'send.song.missing': { text: ({ n = 0 } = {}) => `${n} ${s(n, 'recording isn’t', 'recordings aren’t')} in this browser, so the file goes without ${s(n, 'it', 'them')}.` },
  'send.nothing': { text: () => 'Nothing to send yet: no part has a take.' },
  'send.silent': { text: () => 'The mix would be silent: every track is muted, or nothing plays.' },
  'send.didnt': { text: ({ why = '' } = {}) => `The mix didn’t render${why ? `: ${why}` : ''}.` },
  'send.opened': { text: ({ title = 'The song', n = 0 } = {}) => `${title} is in, with ${n} ${s(n, 'recording', 'recordings')} back in this browser.` },
  // the tape box's note (labelOf), at most three sentences
  'note.empty': { text: () => 'Nothing on tape yet.' },
  'note.doubled': { text: ({ parts = 'The part' } = {}) => `${parts} doubled.` },
  'note.in': { text: ({ parts = 'The part' } = {}) => `${parts} in.` },
  'note.left': { text: ({ parts = 'The part', n = 1 } = {}) => `${parts} ${s(n, 'wants its', 'want their')} other side.` },
  'note.still': { text: ({ parts = 'the part', n = 1 } = {}) => (n === 1 ? `The ${parts}’s still empty.` : `The ${parts} are still empty.`) },
  'note.paper': { text: ({ n = 0 } = {}) => `The paper has ${n} ${s(n, 'section', 'sections')}, no take yet.` },
  'note.take': { text: ({ time = '0:00' } = {}) => `Take 1 is in: ${time}.` },
  'note.takes': { text: ({ n = 2, master = 0 } = {}) => `${n} takes in${master ? `; the band follows take ${master}` : ''}.` },
  // coming back (§2.6)
  'note.back': { text: ({ title = 'The song', note = '' } = {}) => `${title}, where you left it${note ? `: ${note}` : '.'}` },
  'note.assets': { text: () => 'This song’s recordings are in another browser. The band’s here; your guitar isn’t.' },
};
