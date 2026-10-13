// @ts-check
// get_guide "workflows": what an agent's job is inside one of the studio's workflows, section by section. The first is
// "flip" (spec 0014 R30-R32): a song the person owns, brought in through the door's Flip a song, split, mapped and
// marked by the studio itself. The chores are done before the agent arrives; its job is sound design, measured; the
// drop is the person's. Kept short: the agent reads it before its first call in a flip.

// The tools an agent never offers in a flip: each writes the person's music for them (a band, a beat, a riff, a
// structure), and in a flip the music is theirs to make.
export const FLIP_FENCED = ['arrange_song', 'arrange_around', 'make_jam_track', 'drum_track', 'suggest_riff'];

export const WORKFLOW_SECTIONS = {
  flip: `FLIP A SONG (a song the person owns, flipped: they make the drop over it)

How to tell: get_project's summary has a line "Grid follows Original: 68.4 BPM nominal, 66.9–70.2, 2 free spans; key D minor". A flip is a song with a tempo map that follows a recording; there is no other flag.

The chores are done. Don't redo them:
- The grid follows the recording (a tempo map: tempoMap in the song). The bar lines sit on the recording's downbeats; the recording is never stretched. Notes you write land on that grid, live and in every render.
- The key is set (project key), and each section carries its own key where it differs (section.key, in get_project's sections line).
- The sections are marked (Intro, Verse, Chorus, Bridge, Outro, Part A...): the studio's proposals; the person renames them.
- The chords are on a muted track named Chords (block chords on the grid): read them with get_project detail "full", track "Chords". It is a chart, not a part: never unmute it unasked.
- The recording is on audio tracks: Original, and Vocals, Drums, Bass and Other when it was split or the stems were brought. The vocal plays; the rest are muted (track mute). Muted is on hand, not gone.

Your job is sound design, measured:
- adjust (a word: dirtier, wider, more air) on a track or a section, render_and_measure before and after, and say the change relative to before.
- highlight what you touch; propose_variations when there are two good ways (two growl settings, two reverb sizes).
- render_and_measure { targets: "bass-music" } reads a drop's window (short-term loudness, crest, the low end mono) once the person has written one.
- get_guide "genres" (bass-music) has the sounds and the mix numbers.

The drop is theirs. In a flip:
- Never offer arrange_song, arrange_around, make_jam_track, drum_track or suggest_riff. They write music for the person; in a flip the person writes it.
- Never write notes on a track that is playing (not muted) unless the person asked for that track by name. Sound design on their parts (devices, params, inserts, mix) is the job; their notes are theirs.
- Ask before muting or unmuting the recording's tracks; say what changes ("the original under the drop, muted from bar 33").

The grid:
- Change it only with apply_ops { type: "tempo.map", map: { anchors: [{ beat: 0, sec: 0 }, ...], clip } } (null clears it, and the song gets one tempo again), or offer readings as propose_variations (twice as fast, half as fast, the 1 a beat later), each a tempo.map. project.set tempo is refused while a map is set.
- A free span ("2 free spans") is where no pulse was heard (a free intro, a breakdown): the grid runs straight there. Don't quantize the person's notes to it without asking.
- If get_project says the recording "is off its grid by N ms", a move left the recording behind its grid: tell the person; a move by whole bars in the arranger carries the grid with it.

What you can't do here: bring files in or start a split. The person does that from the door's Flip a song (one file: the song; several: the stems, by their names: vocals, drums, bass, other). Tell them how; never fetch audio from a link.`,
};

/** @param {string | null} section */
export function workflowsGuide(section) {
  const names = Object.keys(WORKFLOW_SECTIONS);
  if (section) {
    const key = String(section).toLowerCase().trim();
    const hit = WORKFLOW_SECTIONS[/** @type {keyof typeof WORKFLOW_SECTIONS} */ (key)];
    if (hit) return hit;
    return `No workflow "${section}". Workflows: ${names.join(', ')}.`;
  }
  return `Workflows (get_guide { topic: "workflows", section }): ${names.join(', ')}.\n\n${names.map((n) => WORKFLOW_SECTIONS[/** @type {keyof typeof WORKFLOW_SECTIONS} */ (n)]).join('\n\n')}`;
}
