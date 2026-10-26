# The live room: the whole mode

*2026-10-25. The spec to build the live room from, on the `live-room` branch. Three designs were written for it the
same day, each from one angle: the session player's chair, the fewest decisions, and the room's own side. This note
judges them as AJ would, takes one as the spine, grafts what the other two do better, and settles every conflict in a
line. It builds on `docs/research/LIVE-ROOM.md` (the prototype and why a live room) and doesn't repeat it. The designs
and the seven reports they stand on are in `tools/.out/mode/` and aren't committed: [session] `design-session.md`,
[fewest] `design-fewest.md`, [room] `design-room.md`, [metal] `research-metal.md`, [songs] `research-songwriters.md`,
[whole] `research-whole-mode.md`, [proto] `map-liveroom.md`, [rec] `map-recording.md`, [content] `map-content.md`,
[door] `map-frontdoor.md`. Code is cited as `file:line` on this branch. Nothing here is built yet.*

**How to read the evidence.** As in LIVE-ROOM.md: **[strong]** a controlled study, a large sample, or a product's
shipped behaviour from its own docs; **[moderate]** a small study or a reputable review; **[weak]** a vendor's claim, a
forum, an anecdote or a search snippet; **[inference]** our reasoning; **[code]** what Overdub's own code does. A number
marked *to measure* is a target for `engine.render` and `app/src/audio/measure.js`, not a result. Nobody building this
can listen, so every sound decision below names the measurement that holds it.

---

## 0. The short version

1. **Overdub opens to the live room.** The first screen asks one question, *Where are we playing?*, with four places:
   the metal club, the basement and the blues bar (electric guitar), and the kitchen table (acoustic guitar and voice,
   a sheet of paper, the laptop's mic). The studio is the control room behind the glass, one press away, with nothing
   taken out of it.
2. **You start it and you stop it; nothing is detected.** Space and the drummer counts you in with sticks. You play
   your riff round as long as you like. Space again and the take ends at the bar line. What you played is a **part**:
   a named section, every whole bar you played. The prototype's riff detector is gone ("isn't the move", AJ).
3. **Then the band learns it**, the way session players learn a song they've heard once. The house reads the take you
   just played (its DI, with the tempo and the 1 already known) and from the next pass the kick is on your chugs and
   the bass is on your roots. Reading a finished take at a known grid is a far easier problem than finding a riff in a
   live stream [inference].
4. **The double is the next press.** After a part's first take at the metal club, the second amp's dust cover comes
   off: *Now the other side.* Your first take plays in your left ear, you play into the right, the take ends itself at
   the part's end, and the room says one line about the pair ("bar 5 drifts late against the left, about 30 ms. Bar 5
   again?"). That's the coaching AJ asked for, and no product does it [metal: weak, an absence].
5. **The song is a setlist**, part cards gaffer-taped to the stage floor: Next part, Again, another feel for the
   drummer, ×2, earlier or later, shorter, remove. After two parts the room offers **Lay it out**: the place's form
   (61 bars at the metal club, 1:51) in one press, with the parts you haven't played yet as empty cards the band
   plays on its own.
6. **The metal club is Boiler Room's chain**: Rusty Sticks into Drum Riser, Half Stack into Slide Rule on each side
   (the right side the same amp with the cab one mic over), Roundwound into Y Cable, and the master Overdub already
   holds to metal's targets. Every level is measured through the canonical renderer.
7. **The kitchen table is the paper.** Chords over words, written once per section, anchored to syllables, with a
   capo that keeps the shapes and moves the sounding key. You play the song through once, bare. The band reads its
   time (you confirm it by ear) and follows the paper's chords, never its own guess, then joins one player per offer:
   a shaker in the chorus, a cajón under the verses, a bass, strings in the bridge.
8. **The engineering is hidden and never gone.** The room decides input, monitoring, latency, the amp chain, levels,
   pans, the band's kit and the master, and says what it did in one line. The musician decides the music, two to four
   choices at a time, each heard at once. The control room reads back the same song.
9. **Leaving with it means a file.** *Send a mix* is a 16-bit WAV through the share sheet or a download; *Send the song*
   is one zip with the recordings, which is also the shelf's backup. A share link would send the band without your
   guitar, so the room never offers one.
10. **Ten new ops, two new song fields, a storage key and a browser store**, all forever ids; no new agent tool, so
    the public count of 40 holds. The build is a foundation step and seven parallel streams (§14), every part held by
    a check that renders and measures, or by a flow in muted Chromium with a fake guitar and a fake voice (§11).

---

## 1. What AJ decided, and how this spec chose

### 1.1 AJ's words

On the prototype's way in: "the riff recognition doesn't really work though tbh" … "I think we're ndexing on the wrong
thing here". And: "I think us trying to do something fancy w/ starting with a riff with auto detection isn't the move.
I think we just need to make it easy to get the riff into a song or something?"

On the acoustic room: "For acoustic guitar I was thinking maybe even like a paper w/ chords on it and lyrics and stuff
could be cool. really think through how people do these things."

On metal: "for metal we deff sh0uld have a good drum preset and good left and right tracks and maybe guide the user
through double tracking and all that and laying down drums? All while keeping the charm of the "room" and hiding the
enigneering side."

On scope: "like fully fleshed out not just the "tutorial" but like the whole thing the whole mode".

Settled before this note, and taken as given: Overdub opens to the live room (new songs on the performer's side, the
control room one door away). The acoustic room records voice and guitar with one mic hearing both, or a mic on the
Scarlett Solo's input 1 and a guitar pickup on input 2; AJ has no pickup yet (a laptop or phone mic now, a mic into
the Scarlett soon). AJ's electric goes into input 2. No crowd and no bandmate characters: the band is the gear, and
pixel art is fine. The control room stays serious. Claw'd-o-Matic's charm. Guitar first (AJ doesn't sing). Hum and tap
"never worked that great". Simple view "just removed the ability to do anything useful" and Round view "was just a
gimmick", so nothing is taken from the studio.

### 1.2 The spine, and why

**The spine is [session]**: the room as a tracking date, where you're the artist, the band are session players who
learn your song from one pass, and the engineer behind the glass keeps the tape rolling and says one useful sentence
between takes. It answers AJ's note at the root (you play it once and the band learns it, so nothing has to find
the riff), it's the only one of the three that treats laying down drums as *directing* a drummer (feel, simpler or busier, softer or louder), and its
song model (a `room` field keyed by section id, a `sheet` with syllable-anchored chords, ten ops with exact inverses)
survives the control room and older readers [code: `app/src/core/project.js:354` keeps unknown top-level keys].

**From [fewest]**: one question at the door (the place implies what you brought), the kitchen table instead of the
campfire, one way in (Count me in), Space as the one key for the next move, the press count as a check that fails when
a release adds a press, the bar-line stop rule's grace, dropping part 1's empty leading bars, the 30 ms seam, the
`realize` option that keeps every golden hash still, a 16-bit WAV through the share sheet, the webdriver gate's
details, and the lean and tuning lines that appear only when their measurement says so.

**From [room]**: the guide drums with the kick on the 1s, the soundcheck played on the stage, the talkback strip and
its rules (between passes, never during), the console ledge as the glass, footswitches and MIDI CC 64, the screen kept
awake, `navigator.storage.persist()` at the first kept take, the name dice on the tape box, the "never says" list, the
two-input option shown and honest, and every place's walls.

### 1.3 Conflicts, each settled in a line

| # | Question | [session] | [fewest] | [room] | Settled | Why |
|---|---|---|---|---|---|---|
| 1 | The first screen | *What did you bring?*, then the place | *Where are we playing?*, four places | *What did you bring?*, then the place | **One screen, four places** | The place answers what you brought; the prototype's bring screen had three dead cards and its answer was never read [code: `R.bring`]. |
| 2 | The acoustic place | the campfire | the kitchen table | the campfire | **The kitchen table** (`kitchen`) | AJ asked for a paper with chords on it: paper wants a table and a lamp, the laptop that is the mic sits on one, and a campfire implies listeners. |
| 3 | Ways in | Count me in; I'll start, you follow | Count me in only | both | **Count me in only**, the tempo set first by ← → or T | AJ's note was against the whole family; *I'll start* is the detector's heir and a second path to teach and test. |
| 4 | The key for the next move | R records, Space hears | Space is the offered move | Space counts and keeps | **Space is the offered move**; R is Again; Enter hears | One key for what's next keeps both hands on the guitar and makes a page-turner pedal enough; R keeps the studio's meaning. |
| 5 | Where a take ends | the next bar line; silence stops the band | first 1.5 beats → that bar's line | a fixed 8-bar loop | **The bar-line rule**; the band never stops by itself | A late press costs no bar; a band plays until the leader calls it, so no silence detector decides anything. |
| 6 | A part's length | whole bars played | whole bars, empty lead bars dropped | a fixed loop of 4, 8 or 16 | **Whole bars played**, part 1's empty leading bars dropped | The room never guesses a riff's period; what you played is the part. |
| 7 | Undo and signing | take by you, learning by the house, room ⌘Z undoes both | one step by you, house clips signed inside | take by you, read by the house | **Two steps, grouped in the room** | History stays exact about who did what, and one press still undoes one musical action. |
| 8 | When to double | after the parts, or D | the next press after every part | D | **The next press after a part's first take** at the metal club; D any time | The band has just learned the part, so the double is played to the real drums, the same day, in the same tone [metal: moderate]. |
| 9 | The double's judgment | drift over 20 ms or ¼ sixteenth; a punch; *use pass 2*; *pass 2 sits tighter* | drift over 20 ms (25 basement) or 30% unmatched | tight ≤ 15 ms; drift over 25 | **One line about the pair**, *Bar 5 again* as a one-bar punch, *Use take 2 as the right side* once; no ranking of spare passes | A punch is what an engineer offers; telling you which of your takes is better is a grade. |
| 10 | Directing the drummer | feel, simpler or busier, softer or louder | another beat only | feel, busier, bring it down, tap the kick | **Feel (F), Simpler · Busier, Softer · Louder** | AJ wants to lay down drums without drumming; Drummer's two axes plus a feel cover it, each heard at once [whole: strong]. |
| 11 | The first pass's drums | the groove's own kick | the groove's own kick | the kick only on each bar's 1 | **The kick only on the 1s; the bass sits out** | A drummer who hasn't heard the riff plays time, not a kick pattern that fights it. |
| 12 | The form | Lay it out | an intro offer; the ending automatic | *Put it in order?* | **Lay it out**, offered once after two parts; the ending always there | Riffs not becoming songs is what home players find hardest [metal: moderate]; one press makes a form and ⌘Z unmakes it. |
| 13 | ×2 | one section, twice as long | `section.duplicate`, shown collapsed | a duplicate right after | **One section twice as long, its takes repeated** | One card stays one part; Again on it redoes the riff once. |
| 14 | The room's memory | `room` and `sheet` fields | `room.set`; the paper as Chords and Words clips | `room` and `sheet`, parts keyed by name | **`room` and `sheet`, parts keyed by section id; the aligned chords also a muted Chords track** | The paper exists before any take, so words can't live on beats; an id survives a rename; clips let every reader hear the chords. |
| 15 | The kitchen's time | the analyser, confirmed by ear | the analyser | tap each line on playback | **The analyser, confirmed by ear**; Count me in on headphones as the other way | Tapping a whole song's lines is a chore; the readings are heard before they're trusted. |
| 16 | Kitchen retakes | section retakes on headphones | whole takes | section retakes at line downbeats | **Whole takes**; comping a section is the control room's | One mic hears voice and guitar together, and a seam at a section line cuts a sung pickup. |
| 17 | Sending | a compressed mix and a zip | a 16-bit WAV, the share sheet | a 24-bit WAV and a zip | **A 16-bit 48 kHz WAV through the share sheet, else a download; the zip with the recordings** | A 16-bit WAV drops into any chat; a compressed file needs a muxer of our own. |
| 18 | The shelf | every song in this browser | a view of Recent | up to 12 boxes | **A new store**, `overdub-shelf`, for room songs; control-room songs from Recent as plain boxes | Recent keeps six songs and drops the seventh's JSON [code: `app/src/ui/export.js:264`, `:300`]. |
| 19 | Soundcheck | four steps on the stage | the first ten seconds | four steps, skippable | **Lamps on the stage, no gate** | A setup gauntlet before any sound is an anti-pattern (LIVE-ROOM §6); the lamps say what's left. |
| 20 | Input level | ask for the knob | a trim param on Half Stack | ask, −12 to −6 | **Ask for the knob** (green −18 to −6 dBFS); the faders follow the measured level | A Half Stack trim changes a built-in kernel, trusted by the SHA-256 of its source (`biome.jsonc:26`), and every golden scene the amp is in; the interface's own knob does the job. |
| 21 | The input's tape | five minutes, ⇧R keeps what you played | none | 40 s, for *I'll start* | **No tape**; ⇧R keeps only a pass you just stopped with Esc | With one way in and every pass kept, a tape has nothing left to catch. |
| 22 | The bass | the house's; *Play the bass yourself* | the house's | the house's, its ways, yours through an octave pedal | **The house's, and *Play the bass yourself* on a card** | AJ may not own a bass; a player who does shouldn't need the control room for it. |

The questions the designs left for AJ are answered here with defaults AJ can veto by ear, so none blocks the build:
the kitchen's name (a display name can change; the id `kitchen` can't), *use take 2 as the right side* (offered once
per part), the double's thresholds (calibrated on AJ's doubles before the merge, §13), the finishes' names (three per
place, measured), and sending (the WAV and the zip now; a compressed file and hosted recordings are later decisions).

---

## 2. The map

### 2.1 The doors

| How you arrive | Where you land |
|---|---|
| First visit, bare `/app/` (no saved song) | The live room's door, *Where are we playing?*, on a new blank song |
| Coming back, last on the room's side (`overdub:room` says `side: 'room'`) and the saved song has a `room` field | The room, on that song, with the engineer's note of where you left off |
| Coming back, last in the control room, or a saved song with no `room` field | The control room, as today |
| `?new` | A new song in the room |
| `?studio` (new) | A new song in the control room |
| `?room` | The room on a new song, even under `navigator.webdriver` (the room's own test door) |
| `?demo`, `?new&device=`, `?jam`, Flip a song | The control room, as today |
| A share link (`#s=`) | The control room's listener: it's someone else's song, so the room never opens over it |
| A song file (⌘O) or a *Send the song* zip with a `room` field | The room, on that song (a file without one: the control room) |
| Song ▸ New song, in the control room | The door, on a blank song that's already made, so *Control room →* is one press back |
| Any of the above under `navigator.webdriver`, except `?room` | The control room, exactly as today |

The webdriver rule is the onboarding tour's (`app/src/ui/onboard.js:93`). It keeps the twenty-odd suites that open a
bare `/app/` and the ones that open `?new` on today's first screen. The room's own checks open `?room`, or set
`navigator.webdriver` to false in an init script for the front-door checks: a test fixture, not a product switch.
Merged means shipped, so the door ships with the mode, and it's tried first on `next.overdubstudio.com`
(`deploy/deploy.sh --next`).

The decision is made in `app/src/main.js` before the shell is built (`decideDoor`, pure, §9.6). When the door wins,
`main.js` sets `data-room` on `<html>` before any module starts, and one rule in `app/style/app.css` keeps `#studio`
hidden until the room has mounted, so the control room never flashes up first [door: the room is module 22 of 39 today,
`app/src/main.js:41`]. Night Shift stops being the first screen. The door offers a finished song instead: *Hear one the
house made* opens Boiler Room (`app/src/core/demos/boiler-room.js`: drop C, 132, the chain the metal club now uses) in
the control room, playing, with its card. Night Shift stays one press away there (`?demo`).

### 2.2 The places

A place is a preset for everything you don't choose. Defaults shape what gets made (a meta-analysis of 58 studies:
about 0.63-0.68 standard deviations) [whole: strong, via summary], so the defaults are design, and every one of them
is measured.

| | The metal club `metal` | The basement `basement` | The blues bar `bluesbar` | The kitchen table `kitchen` |
|---|---|---|---|---|
| You bring | an electric | an electric | an electric | an acoustic and your voice |
| Tempo | 90-200, starts at 132 (the `modernmetal` bank to 160, `metal` above) | 150-210, starts at 172 (the `punk` bank) | 70-140, starts at 96 (`shuffle`) | your take's; 60-140 and 84 to start when counted in on headphones |
| The count | one bar of sticks; two bars at 160 and up | two bars: *1 … 2 … 1 2 3 4* | one bar of sticks | none (the work tape), or one bar of sticks, soft |
| Grid | sixteenths | sixteenths | eighth-note triplets | the take's beats |
| A part | whole bars played | whole bars played | whole twelve-bar choruses | a section of the paper |
| Key | read from the first part | read from the first part | chosen before the count: E, A, G, D, C, B♭ | the paper's chords and the capo |
| Amp (‹ ›) | Half Stack: Modern, Djent, Thrash | Half Stack: Hard rock, Modern, Thrash | Half Stack: Crunch, Hard rock, Edge of breakup | none: a mic |
| Guitars | Guitar L and Guitar R, the double coached | Guitar L and R, the double offered once | Guitar, and a Lead for solos | Guitar & voice (one mic), or Voice and Guitar (two inputs) |
| Drums | Rusty Sticks (`core.metalkit`) Modern, SUB −13, into Drum Riser (`core.drumbus`) Modern | Gobo Kit (`core.drums` kit 0, room 0.4, drive 0.3) into Drum Riser Smash | Gobo Kit (kit 5, room 0.45) | Hand Crate (`core.handkit`): a shaker, a cajón |
| Bass | Roundwound (`core.ebass`) Even into Y Cable (`core.bassrig`) Modern: roots with the kick | Flatwound (`core.bassguitar`) Punk pick into Y Cable Grind: root eighths | Flatwound, the prototype's settings: the boogie through I, IV, V | Flatwound Motown, invited: the paper's roots |
| More | | | | Music Stands (`core.strings`) in a bridge, invited |
| Finishes (default first) | Tight · Loud · Room | Raw · Loud · Room | Bar · Close · Loud | Bare · Warm · Close |
| On the kick | VOID | SUMP PUMP | LAST CALL | the cajón: COOLER |
| The tape machine | a reel-to-reel on the console ledge | a four-track cassette on a milk crate | a cassette deck on the bar | the laptop on the table, its counter on screen |

Every place's tempo, rigs, kick head and grooves come from the prototype's `PLACES` (`app/src/core/liveroom.js:74-101`,
moving to `app/src/core/liveroom/places.js`), changed where the table says. The basement's and the blues bar's ranges
now match their banks (`punk` 150-210, `shuffle` 70-140) [code]. All levels are re-measured (§4.6).

### 2.3 The metal club, the first time (AJ's path)

With rough clock times from the first screen, and the presses counted (§11.4 pins the count):

| Time | Moment | Press |
|---|---|---|
| 0:00 | The door. *The metal club.* Rusty Sticks starts loading now: its kit file (`METALKIT_HASH`, `app/src/devices/builtin/metalkit.js:27`) is 24 MB. | 1 |
| 0:05 | The browser asks for the input: Allow. The amp's lamp lights and the pop goes through the master. | 2 |
| 0:15 | Soundcheck lamps light as you play: plugged in, the level, the tuning (*Low string C: drop C?* [Drop C]), the line-up offered. | 3 |
| 0:45 | Space. Four sticks at 132. The drummer plays time with the kick on the 1s; the bass sits out and listens. Play the riff round as many times as you like. | 4 |
| 1:10 | Space. *Verse is in: 8 bars at 132, drop C. The band's learning it.* A second later: *They've got it.* The bass plucks the root once. | 5 |
| 1:20 | Space: the other side. The dust cover comes off the right amp. Your left take in your left ear, the learned band, you into the right. It stops itself at the part's end, then plays back wide. | 6 |
| 2:00 | Space: next part. Two bars of your verse with the band, a fill, and the drummer opens up on the crash. Play the chorus riff. | 7 |
| 2:30 | Space. *Chorus is in.* | 8 |
| 2:40 | Space: the other side. | 9 |
| 3:20 | *Two parts in. Lay them out as a song?* Space. 61 bars, 1:51; the breakdown is an empty card the drummer plays half time on. | 10 |
| 3:30 | Space: hear it all. The cards light in turn. | 11 |
| 5:20 | *Hear it with a finish?* Tight is on; Loud and Room are a press away. Then *Send a mix.* | 12 |

The breakdown waits for R on its card, the intro stays on the left alone, and the shelf keeps the tape box:
*Verse and chorus, both sides. The breakdown's empty.*

### 2.4 The basement and the blues bar

Both run on the metal club's machinery; only the place's data differs.

- **The basement** counts two bars (*1 … 2 … 1 2 3 4*, sticks on beats 1, 3, 5, 6, 7 and 8 of the eight). Its first
  part is *Verse*; the next part offers *Chorus*, *Bridge*, *Pre-chorus*. The bass plays root eighths from your read.
  The other side isn't the next press: it's offered once, after the second part (*Now the other side? Punk doubles
  too.*), and D does it any time, with a looser drift line (25 ms) [inference: punk is played looser]. Feels:
  *Straight* (straight-punk), *Open* (open-eighths), *Skank* (skank-beat), *Half time* (half-time), *Floor toms*
  (floor-tom-pound). A flyer by the door gets the song's title once it has one.
- **The blues bar** is about choruses. Before the first count the readout's key chip offers E (then A, G, D, C, B♭);
  the bass plays the root once when it changes. A part is whole twelve-bar choruses: Space in the first two bars of a
  chorus ends the take at that chorus's start, later at its end, and the band plays the turnaround and the blues
  ending to stop. The first part is *Head*; the next part is *Solo*, on the Lead track (Half Stack's Lead preset,
  `stack.js:47`, panned +0.4, the rhythm guitar −0.4), with no double. Feels: *Shuffle*, *Double* (double-shuffle),
  *Ride* (ride-and-stick), *Slow* (slow-twelve-eight, offered under 80). The LAST CALL sign lights on the ending.

### 2.5 The kitchen table, the first time

| Moment | Press |
|---|---|
| The door: *The kitchen table.* | 1 |
| The browser asks for the mic: Allow. *How is it miked?* The room picks the answer from what it sees and shows it: *The laptop's mic* · *A mic on the interface* · *A mic and a pickup* (two inputs). | 2 |
| *Headphones on?* [Yes] [No, speakers], once per output (and skipped when the output's name says). | 3 |
| The balance: *Strum the way you'll play.* then *Sing a line, or speak one.* *Good: your voice sits 5 dB over the guitar.* | |
| The paper: blank (a title line, *capo —*, one *[VERSE]*), or paste what you have. Typing isn't a press. | |
| Space starts the tape. No count, no click, no band. Play the song through. | 4 |
| Space. *Take 1 is in: 2:41. The band's reading it.* | 5 |
| *Around 84, drifting 80 to 88. Hear the shaker on it?* It plays; [On the beat]. | 6 |
| *The band has your chords: G, Em, C, D in the verse.* Then *A shaker in the chorus?* plays it in: [Keep it]. | 7 |
| A finish (Bare is on), and *Send a mix*. | 8 |

### 2.6 Coming back

The door is skipped. The room opens on the song you left with one line written from the song, never a nag: *Boiler
Room, where you left it: verse and chorus doubled; the breakdown's empty.* The offered move (Space) is that next thing.
The input reopens by itself when the browser still has permission and the device is the one from last time, with its
measured latency; otherwise the *Plug in* lamp is the only one dark. If the song's recordings aren't in this browser
(a song opened from the cloud, or from another computer): *This song's recordings are in another browser. The band's
here; your guitar isn't.*

---

## 3. Every screen and moment

House lines are unsigned (the house is). An agent's line carries its byline in cool ink. Every line follows the
studio's order: what was recorded, what changed, the number. The canonical copy is §10; this section shows each line
where it's said.

### 3.1 The door

- **Sees.** The room's top bar (48 px): the wordmark and *The live room* on the left; *Shelf* (once there's a song on
  it) and *Control room →* on the right. In the middle, *Where are we playing?* in the display face, and four cards,
  each a still crop of its place's pixel scene (§3.19) at a whole scale, with its kick head's name, a slate in mono
  capitals and one line:
  - **The metal club** · *ELECTRIC · 132 · TWO STACKS AND A BIG KIT* · Tight and heavy. The kick locks to your chugs.
  - **The basement** · *ELECTRIC · 172 · ONE AMP, TOO LOUD* · Fast and loud, under somebody's house.
  - **The blues bar** · *ELECTRIC · 96 · A SHUFFLE* · A small amp on a chair, twelve bars at a time.
  - **The kitchen table** · *ACOUSTIC AND VOICE · YOUR TEMPO* · A sheet of paper and the laptop's mic. For a song with
    words.
- Under them, two quiet links: *No guitar? Hum, tap or play keys in the control room.* (a blank song on the control
  room's own door, `app/src/ui/start.js` `doorOf`) and the tape box *Hear one the house made: Boiler Room.* And small:
  *Your takes stay in this browser.*
- **Does.** Picks with 1-4, Enter on the focused card, or a tap. On a phone the list puts the kitchen table first (a
  phone is a mic; an interface on a phone is rarer), and the electric cards say *Needs an interface on a phone* until
  one shows up.
- **Hears.** Nothing until a first gesture. After one, focusing or hovering a card plays one bar of its band at about
  −18 LUFS (a preview, released when you leave the card). The scenes move only with that bar's hits; under reduced
  motion they hold still. The prototype's breathing sine is cut (fake motion).

### 3.2 Picking a place

One dispatch by **you** (label *Into the metal club*): `project.set` for the tempo (the place's start) and the meter
(4/4); the role tracks, once and never per take (Guitar L armed, Guitar R unarmed under the dust cover, Drums, Bass,
and the muted *Riff (as heard)*; the blues bar's Guitar and Lead; the kitchen's take track), each with its chain and
measured fader, the band's tracks signed by the house inside the step (`track.add` keeps a given `by`,
`app/src/core/ops.js`); the master chain for the place's default finish; `room.set { place, rig, finish, tracks }`.
Rusty Sticks is prefetched (`prefetchKit`, `app/src/ui/kitload.js`). The step lands only when you pick; until then the
door's previews leave nothing in History.

### 3.3 Soundcheck: lamps on the stage

There's no soundcheck screen and no gate. The stage opens with four small lamps beside it, each a button that redoes
its step, and Count me in works the moment the input is open.

1. **Plug in.** *Plug into the interface and hit a chord. The browser asks for the input first.* The room opens the
   device with all its channels and takes the one that moves on your first strum (at least 12 dB over the others).
   *Guitar on input 2 of Scarlett Solo USB. The amp's on.* (the device's own name, as the system gives it). Nothing in
   5 s: *Nothing's coming in on Scarlett Solo USB. Guitar on input 2, INST on, gain up?* Refused: *The browser said no
   to the input, so the amp's off. Allow it in the site settings, then come back.* Only a microphone: *That's the
   laptop's mic. An electric needs an interface; the kitchen table works with this mic.* Device and channel selects
   are there for anyone who wants them (16 px, so iOS doesn't zoom). Monitoring comes on by itself for an interface,
   through the place's amp, as the input layer decides today (`app/src/input/audioin.js` header). Once, small: *If you
   hear a clean guitar under the amp, turn off the interface's direct monitor.*
2. **Level.** Lit when your hardest strums peak in the green, −18 to −6 dBFS (the faders were measured at −12, and the
   guitar faders follow your measured level within the green, §4.6). *Loud and clear: peaks at −11 dB.* · *Hot: peaks
   at −2 dB. Turn input 2 down a little.* · *That clipped. Turn input 2 down a touch.* · *Quiet: peaks at −31 dB. Turn
   input 2 up.*
3. **Tune.** *Play the open low string.* The tuner reads down to 38 Hz (`audio.tune({ lo: 38, hi: 1400 })`, low
   enough for B1 at 61.7 Hz). It names a tuning it knows: *In tune: drop D.* Where the low string alone can't tell,
   it asks once: *Low string C: drop C? [Drop C] [C standard]*; *Low string D: [Drop D] [D standard]*; *Low string B:
   [B standard] [Drop B]*. Skipped, the tuning is read from the first take's lowest notes. The answer sets the bass's
   range, Slide Rule's low cut (§4.1) and the song's key root. U opens the tuner at any time. Later, from the read: *The
   guitar's about 20 cents flat against the band. Tune up a touch: U shows the note.* (only when the median of six or
   more sustained notes is over 15 cents off).
4. **Line it up.** Once per device, remembered (`overdub:latency`): *Strum on each of eight clicks: two to settle,
   then six.* (`audio.latency.measure({ how: 'tap' })`, fine at a spread of 40 ms or less). *Lined up: 21 ms there and
   back.* Over 25 ms: *You'll hear yourself 31 ms late on this setup. Wired headphones on the interface help.* An
   output that adds more than 80 ms on its own (`AudioContext.outputLatency`): *These headphones add 160 ms on their
   own: wireless, most likely. Wired ones, or the interface's output, for playing.* Skipped, the browser's guess
   places takes, and the room watches the lean (§4.2): *Your last two takes landed about 18 ms behind the drums. Line
   it up? Eight strums.*

Under the lamps: *‹ Half Stack, Modern ›* (`[` `]`), drawn from the song, never held in the DOM (the prototype's label
went stale on `[` and `]`). Each setting is heard at once, as loud as Modern within a quarter dB [code:
`tools/liveroom-test.js`]. Coming back on the same device, the lamps are already lit and the line says *Scarlett Solo
USB, input 2: ready.*

### 3.4 Before the first take

*The drummer's at 132. ← → to move it, T four times to tap it. Space and you're counted in.* ← → move the tempo 2 BPM
(⇧ 10) within the place's range; T sets it from four taps whose intervals agree within 8%. After each change the
drummer plays one bar of hats at the new tempo (a preview), so you hear the number rather than read it. The readout
shows *132 · drop C · ‹ Modern ›*. At the blues bar the key chip sits beside the tempo.

### 3.5 Count me in, the pass, the stop

- **The count.** Space. Sticks, played by the engine's count-in in a new voice (§9.4): four at 132, eight at 160 and
  up, the basement's two-bar count. The kick head counts *1 2 3 4* in the pixel font. The deck's reels start. If the
  kit isn't in yet the count waits and the kick head shows it: *The drummer's still setting up: 70%.* If the fetch
  fails: *No sampled kit on this connection: the drummer's on the practice kit.* (Gobo Kit, measured too).
- **The first pass of a part.** The drummer plays the part's feel with the kick only on each bar's 1: time, not a
  pattern that fights a riff it hasn't heard. The bass sits out; its lamp is low because it's listening. The playing
  card fills with a leader-green playhead line (one of leader green's two jobs [brand]). The deck counts bars (*BAR
  5*). The engineer says nothing.
- **Stopping.** Space or R ends the take at a bar line: pressed in the first beat of a bar, at the line just gone, so
  a late press costs no bar; later in the bar, at the next line. The band plays to it, then hits a crash and the kick
  on the next 1 and lets it ring, and the recorder runs one bar more so your last chord's ring is in the take. The
  band never stops by itself: it plays until you call it, as a band does.
- **Not that one.** Esc during the count or the take stops at once. Nothing goes into the song; the pass is in Capture
  (the recorder keeps every pass there). *Not that one: it's in Capture.* ⇧R right after puts it in after all, at the
  bars it was played.

### 3.6 After a pass: the part lands, the band learns

- **The part** is every whole bar from the band's 1 to the stop. For the first part, whole bars at the front where
  your DI stays under −50 dBFS are dropped (a player who waits two bars doesn't get two bars of drums alone). A pass
  with less than a bar over −42 dBFS isn't kept: *Nothing to keep: under a bar.*
- **The take lands** as one step by you: the take on Guitar L at its part's bars (in its take folder), the part's
  section, the part's `room.part.set`, and, for the first part, the song's key from the read's root. Label *Verse
  take 1*.
- **The band learns it** as its own step by the house a moment later (label *The band learned the verse*, §4.3).
- **Words.** *Verse is in: 8 bars at 132, drop C. The band's learning it.* About a second later: *They've got it: the
  kick's on your chugs and the bass has your roots.* A thin read (fewer than 8 onsets on the grid, or no steady low
  note): *The kick keeps its own pattern here: it didn't hear clear low notes. The bass waits for them.*
- **Charm.** While they learn, the bass rig's lamp warms. When they have it, the bass plucks the part's root once,
  softly (about −24 LUFS), the way a session bassist finds the key: once per part, never again.
- **The card.** *Verse · 8 bars · Your chugs*, two side lamps (L lit, R dark), and the take's envelope as a strip, so
  you see where you played hard.

### 3.7 The other side

- **When.** At the metal club, the next press after a part's first take: the primary button reads *The other side*
  (Space). D does it on any card at any time. The basement offers it once after the second part. The blues bar has no
  double: its second amp is the Lead.
- **Setting up** (the first time: one house step, *The other side's set up*): Guitar R is armed and monitoring follows
  it (`app/src/input/audioin.js:447-453`). The dust cover comes off the right amp. For the bars you're doubling, Guitar
  L is heard hard left (a preview, released after) and you're heard on the right: your left take in your left ear,
  the old trick of panning the first take to one ear [metal: moderate]. The drums follow the left take, so playing
  tight to the drummer is playing tight to yourself.
- **The pass.** One bar of pre-roll (the count, for the first part). The take ends itself at the part's end (the
  recorder's punch range) and the band plays on a bar. While you play, both amps' lamps flash with their own signals
  (the left from Guitar L's meter, the right from your input), so you see them hit together or apart. No numbers, no
  words.
- **After it** (the pair measured, §4.7), one line, then the part plays back once, wide (any key stops it):
  - Tight: *Right side is in on the verse: the guitars are wide now. Within 8 ms of the left all the way.*
  - Fine: *Right side is in on the verse: the guitars are wide now. Within 14 ms of the left.*
  - One or two bars drift: *Right side is in on the chorus: bar 5 drifts late against the left, about 30 ms. Bar 5
    again?* The primary becomes *Bar 5 again* (Space): the band plays bar 4, you play bar 5, and only bar 5 is
    replaced. After it: *Bar 5 is in: 9 ms from the left now.*
  - Three or more: *Right side is in on the chorus. It wanders from bar 3: again on the right?* (R: the whole part).
- **Takes you already played.** If Guitar L's folder holds two or more takes of the part and two of them sit within
  the pair rule, once per part: *You played the verse three times. Use take 2 as the right side?* One press moves
  that take to Guitar R (a step by you). Two performances, one per side, are a real double; a copy, or a delayed copy,
  is never offered [metal: strong].
- **The intro on one side.** The laid-out intro uses the left side alone (§3.10): *The intro stays on the left alone,
  so the verse comes in wide. D doubles it anyway.* That's Herbst's observation as an arrangement, and it teaches
  double tracking without the word [metal: strong].
- **When both sides are in everywhere:** *Both sides are in. The guitars are wide and the bass is under them.*

### 3.8 Next part

Space when it's the offered move, or N any time. A dashed card goes after the last part, named by the place's next
default (after a verse at the metal club, *Chorus*). The pre-roll is two bars of the last part (your take and the
band) with the drummer's fill into the new part; then the new part's feel, the kick on the 1s, the bass out. You play
the new riff and press Space. *Chorus is in: the drummer opened up on the crash. 8 bars.* Name chips on the new card
(*Chorus · Pre-chorus · Breakdown · Bridge · Other…*) rename it; as you focus a chip, the drummer plays a bar of that
part's feel. Default names by order: the metal club and the basement *Verse, Chorus, Bridge*; the blues bar *Head,
Solo*. A fifth part and on takes the name of the part it most resembles by job, numbered.

### 3.9 A card and its menu

← → (once there's a take) or a tap selects a card. A click on the selected card, a long press, or its ⋯ button opens
the menu. Every item has a key, and every item is one undo step.

| Item | Key | What happens | The engineer |
|---|---|---|---|
| Again | R | One bar of pre-roll (the count, for the first part). You play the part; the take ends itself at its end; the band plays on a bar. The band re-learns from the new take | *Take 2 is in on the verse: the drummer follows it now. Take 1 is a key away: ↓.* |
| The other side | D | §3.7 | *Now the other side.* |
| Another feel | F | The part loops with your take on the next of its feels; F again for the next; Enter keeps it, Esc goes back | *Gallop. F for another.* |
| Simpler · Busier | | three steps, heard at once on the loop | *Simpler: no fills, the kick on the accents.* |
| Softer · Louder | | three steps, heard at once | *Brought down: hats instead of the crash.* |
| ×2 | X | The part plays twice: one section, twice the bars, its takes repeated, the band varied the second time round | *Verse ×2: 16 bars.* |
| Round and round | L | The part loops; Space hears it, R records it, and every time round is a take (the recorder's loop passes) | *Round and round on the chorus.* |
| Name | | Four words for its place, then *Other…* | |
| Earlier · Later | ⌥← ⌥→ | The part and everything in it moves (`section.move`) | *Moved the chorus before the second verse.* |
| Shorter | | Keep its first 4, 2 or 1 bars (the lengths that divide it) | *Verse: 4 bars now.* |
| Play the bass yourself | | §4.5 | *Bass on input 2, then Space.* |
| Remove | ⌫ | The part and its bars go | *Removed the bridge: 8 bars. ⌘Z brings it back.* |

↑ ↓ on a selected card switch which take plays there, heard in the song, not alone (the studio's ⌘↑ ⌘↓ step takes the
same way). The room never says which take is better.

### 3.10 Lay it out

After the second part has a take, once per song: *Two parts in. Lay them out as a song? Intro, verse, chorus, verse,
chorus, breakdown, chorus ×2, end: 61 bars, 1:51.* [Lay it out] [Not yet]. One step by the house, its form and your
yes; ⌘Z undoes it. A part you haven't played yet is a dashed card the band plays on its own (*Breakdown · 8 bars ·
Half time · empty*). A pre-chorus you made goes before each chorus.

| Place | The form | At the default tempo |
|---|---|---|
| Metal club | Intro (4: your verse's first 4 bars, the left side alone for 2, then the drums' *Build* with the bass) · Verse (8) · Chorus (8) · Verse (8) · Chorus (8) · Breakdown (8, empty, *Half time*, the drop into it) · Chorus ×2 (16) · End (1) | 61 bars at 132: 1:51 |
| Basement | Intro (2: *Sticks in*, then the verse riff) · Verse ×2 (16) · Chorus (8) · Verse (8) · Chorus (8) · Bridge (8, empty, *Half time*) · Chorus ×2 (16) · End (1) | 67 bars at 172: 1:33 |
| Blues bar | Intro (4: the head's last four bars, a turnaround) · Head (12) · Solo (12, empty) · Solo (12, empty) · Head (12) · Ending (2, *Blues ending*) | 54 bars at 96: 2:15 |
| Kitchen | none: the paper's flow is the form, and the take sets it | |

The metal form is the corpus's: a buildup intro, verse and chorus rotations, the breakdown in the bridge, a last
chorus (87% of a 195-track corpus are rotations with a bridge; "almost every metal song begins with a buildup intro")
[metal: strong]. The verse's lengths are yours: a 16-bar verse makes a longer form, and the line says so.

**The end is always there.** From the first take the song has an *End*: one bar after the last part (two at the blues
bar) where the drummer plays the place's ending hit (*Crash out*, *Crash hold*, *Blues ending*), the bass its root,
and the last part's take its ring (the extra bar the recorder kept). It moves whenever the last part changes, and it
shows as a small tab after the last card, the band's own: R on it says *The end follows your last part.*

### 3.11 Hear it all

Home then Enter (or Space when it's the offered move) plays from the top; Enter plays from the selected card ("take it
from the chorus"). The cards light in turn and the engineer is quiet. At the end: *That's the song: 7 parts, 1:51.*
With an empty part: *That's 1:51 top to bottom. The breakdown's still empty.* A song is **finished** the first time
it's heard top to bottom with no empty part (defined, never celebrated); the shelf says *Done?* with nothing pushy
after it.

### 3.12 The finish

From the first take the place's default finish is on the master. After the first time through, once: *Hear it with a
finish? Tight is on. Loud and Room are a press away.* Three chips. Focusing one plays it level-matched against the
current one (a preview with the master trimmed by the finish's measured loudness difference), so the loud one doesn't
win by being loud; choosing it puts it on (a step by you). *Loud: the same mix, pushed. About 2 dB louder than Tight.*
The loudness numbers stay behind the glass; the tape box's back has them.

### 3.13 The shelf

A row of tape boxes, newest first: every room song in this browser (`overdub-shelf`, §9.6), then the control room's
Recent songs as plain boxes (*made in the control room*). Each label: the title (the display face, or the house's
*Untitled · 132 · drop C*), the slate (*METAL CLUB · DROP C · 132 · C MINOR*, mono capitals), the parts as words
(*Verse, Chorus, Breakdown*), the day (*Sat 19:42*), the size of its takes, and the engineer's note of where you left
off (at most three sentences, written from the song each time, never stored: *Verse and chorus doubled. The
breakdown's still empty.*). A cover drawn from the song sits on the label's band: one spike per bar, its palette seeded
by the title, key and tempo (Claw'd-o-Matic's starburst). A die on an untitled box offers three titles from a seeded
word bank (*Void Weather · Copper Pipe · Night Haul*); a press on one names the song (a step by you).

- A press opens the song in the room.
- The first time the shelf opens, once: *Kept in this browser. Back it up? One file with your recordings.* [Back it
  up]; afterwards a quiet link in the corner. On Safari it adds *Safari can clear a site's storage after a week away.*
- At the first kept take, the room asks the browser to keep its storage (`navigator.storage.persist()`), silently.
- When storage passes 80% of `navigator.storage.estimate()`: *This browser has room for about 40 more minutes of
  takes.*
- *Take it off the shelf* asks first, plainly: *Take Void Weather off the shelf? Its 62 MB of takes go with it, and
  that can't be undone.* [Take it off] [Keep it]. Only recordings no other song here uses are deleted.

### 3.14 Send

From the shelf, or after a time top to bottom; never after a first take. Two choices, each saying what it sends:

- *Send a mix: 1:51, about 21 MB.* The release render through the finish, muted tracks out, from the first sound to
  the end of the tail (`app/src/ui/export.js:469`), as a 16-bit 48 kHz WAV (`encodeWav` takes `bits: 16`). Through
  the share sheet with the file where `navigator.canShare({ files })` allows it, else a download. *Saved “Void
  Weather.wav”: 1:51, 21 MB. It's the mix; the takes stay in this browser.*
- *Send the song: to open in Overdub, with your recordings (62 MB).* A zip of the song's JSON and its recordings as
  32-bit float WAVs, the format the asset store keeps, so nothing is lost (the Stems export's `zipStore`). ⌘O opens
  it and puts the recordings back in this browser. It's also the shelf's backup.

No share link: today it carries notes and devices and leaves recordings behind (GUIDE, "Share and fork"), so it would
send the band without you.

### 3.15 The glass

- **Always**: *Control room →* at the top right, the console ledge along the bottom of the scene (a click), and G.
  Going through never changes the song. The room releases its previews, stops painting (its frame pauses), hands the
  studio its keys back and leaves the transport as it was. In the studio, a room song's top bar has *Live room* (40
  px, up from the prototype's 30) and G brings you back.
- **The room points at it** only for what it deliberately doesn't do, once each, never mid-take: editing inside a take,
  comping, the mixer and automation, a device's knobs, an instrument the place doesn't have, writing notes. *That's a
  control-room job: the takes are laid out there. Control room →*
- **Coming back**, the room reads the song and History since you left and says what changed in one line, signed when
  an agent did it: *While you were in the control room: the bass came up 2 dB and a synth track came in. The room
  leaves them as they are.* The rules are §7.5.

### 3.16 The talkback and the agent

A strip under the stage: a small square lamp, 8 px, that lights when a line is new (a talkback button's light; square,
as BRAND's corners are), the line in Atkinson Hyperlegible Next at 18 px (17 on a phone; numbers in the mono face), at
most two sentences, and a polite live region that reads it. It changes between passes and holds still during a take. The house speaks there unsigned.
When the in-app agent `say`s something while the room is open, it appears in the same strip with a *Claude* byline in
`--agent` ink (today `say` lands in a pane that's inert under the room [door]). `/` opens the talkback for typing to
the agent, when it's available. Song-changing agent tools wait while a count, a take or a read runs, the way they wait
for Start a song's stage (`app/src/agent/tools.js:815-817`). An agent's part shows its byline on its card (*Bridge ·
Claude*, cool ink), as everywhere. The agent may offer one arrangement move between passes, in one line, never applied
unasked (UX-RESEARCH's rules: never the whole song, every change a signed step).

### 3.17 Keys

The room holds the studio's single keys while it's open, as Start a song's stage does
(`app/src/ui/start.js:1004-1011`), and keeps the studio's meaning wherever a key means the same thing on both sides of
the glass. Every key is declared
with `ui.keys.add`, the room's first (`first: true`, `when` the room is open).

| Key | In the room | The studio's meaning |
|---|---|---|
| Space | The offered move: Count me in · That's a take (at the bar line) · The other side · Next part · Bar 5 again · Lay it out · Hear it all. While playing back: stop | plays and stops |
| R | Again on the selected part. While recording: stop at the bar line | records; again punches out |
| Enter | Hear it from the selected card; Home then Enter is from the top. On the door: pick the focused place | marker to bar 1 |
| Esc | During a count or a take: *Not that one*. In a menu: close it. While playing: stop. Never leaves the room | stops the agent |
| ⇧R | Keep it after all (the pass just stopped with Esc) | puts what you just played in the song |
| ← → | Before the first take: the tempo, 2 BPM (⇧ 10). After: select a card (the kitchen: a section of the paper) | |
| Home · End | The first card · the last | marker to bar 1 |
| ↑ ↓ | The selected part's takes, in the song (the kitchen: whole takes) | ⌘↑ ⌘↓ step takes |
| ⌥← ⌥→ | Move the selected part earlier or later | |
| N | Next part | |
| D | The other side, on the selected part | detail pane |
| F | Another feel for the selected part | |
| X | ×2 | |
| L | Round and round on the selected part | loop |
| ⌫ | Remove the selected part (⌘Z brings it back) | |
| T | Four taps set the tempo, before the first take | tap |
| [ ] | The amp's setting | |
| U | The tuner | |
| G | Through the glass, both ways | |
| / | Talk to Claude, in the talkback | asks the agent |
| ⌘Z · ⇧⌘Z | Undo, redo; one press undoes a take and the band's learning together (§7.3) | the same |
| ⇧Esc | All off | the same |
| ? | The keys | the same |
| 1-4 | The door's places, a line's choices | |
| PageDown, a MIDI sustain pedal (CC 64, while no instrument track is armed) | Space | |
| PageUp | R | |

A page-turner pedal records hands-free: PageDown counts you in and ends the take, PageUp is Again. On a touch screen
there are no keycaps (`@media (hover: none)`): each action is a button.

### 3.18 Layouts

**Desktop, 1440 × 900.** The stage is the 256 × 144 scene at ×4 (1024 × 576); at 1280 × 800 it's ×3 (768 × 432),
always a whole multiple of device pixels (`image-rendering: pixelated`).

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ overdub  The live room · Boiler Room                       Shelf   Control room → │ 48 px
├────────────────────────────────────────────────────┬─────────────────────────────┤
│                                                    │ 132 BPM · drop C · C minor  │
│        the stage, 256 × 144 at ×4 = 1024 × 576     │ ‹ Half Stack, Modern ›      │
│   left amp · kit · right amp (under its cover) ·   │ ● plugged in ● level        │ the lamps
│   bass rig · the console ledge along the bottom    │ ● tuned      ○ lined up     │
│                                                    │ [ The other side     Space ]│ leader green
│                                                    │ [ Next part              N ]│
├────────────────────────────────────────────────────┴─────────────────────────────┤
│ ● They've got it: the kick's on your chugs and the bass has your roots.           │ talkback, 18 px
├──────────────────────────────────────────────────────────────────────────────────┤
│ ▭ Intro · 4   ▣ Verse ×2 · 8   ▭ Chorus · 8   ▭ Verse · 8   ┆Breakdown · 8┆  End │ the setlist, 112 px
└──────────────────────────────────────────────────────────────────────────────────┘
```

A card is 168 × 96: the name (the display face, 18 px), *×2 · 8 bars* (mono, 13 px), the feel word (13 px), the side
lamps L R, the take's envelope (148 × 16). The setlist row scrolls sideways inside itself if it overflows; the page
never does. The cards sit on a strip of gaffer tape.

**The kitchen, desktop.** The stage at ×2 (512 × 288) on the left with the talkback and the buttons under it; the
paper on the right, 480-640 px wide, full height, scrolling on its own.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ overdub  The live room · Paper Moon                        Shelf   Control room → │
├──────────────────────────────────────┬───────────────────────────────────────────┤
│ the stage, 512 × 288                 │  Paper Moon          CAPO 3 · SOUNDS IN B♭ │
│ (the table, the lamp, the cajón)     │  V1 · C · V2 · C · B · C ×2                │
│ ● Take 1 is in: 2:41. The band's…    │  [VERSE 1]                                 │
│ [ Start the tape            Space ]  │   G               Em                       │
│ [ Hear the shaker on it           ]  │  Somewhere a paper moon is hanging         │
│ Takes 1 · 2   ↑ ↓                    │   C                    D                   │
│ Band: shaker · cajón · bass · strings│  over the roofs of the town                │
└──────────────────────────────────────┴───────────────────────────────────────────┘
```

**Phone, 390 × 844.** 16 px gutters, text at 12 px or more (16 px in fields), targets of 44 px, no sideways scroll
[door: the phone floor]. The scene shows a 192 × 108 window of the room at a whole scale, panned in whole pixels (200
ms; a cut under reduced motion) to the gear the step is about: your amp in the soundcheck, both amps in a double, the
kit when you're choosing a feel. The setlist becomes a list.

```
┌──────────────────────────────┐
│ Shelf  The metal club  Control│ 44 px
│ ┌──────────────────────────┐ │
│ │ a 192 × 108 window at ×2 │ │ 384 × 216
│ └──────────────────────────┘ │
│ ● They've got it: the kick's │ 17 px, two lines at most
│ [      The other side      ] │ 56 px, leader green, full width
│ [ Again ][ Next part ][ More]│ 44 px; More: feel, ×2, move, remove, amp, finish
│ − 132 +   drop C   ‹ Modern ›│ 44 px steppers
├──────────────────────────────┤
│ Verse     ×2 · 8 bars   L R  │ 64 px rows; a tap selects, ⋯ opens the menu
│ Chorus       8 bars     L ·  │ Move up · Move down in the menu (no drag)
│ + Next part                  │
└──────────────────────────────┘
```

During a take everything but the scene, the counter and one button dims to half, and on a phone *That's a take* takes
the lower half of the screen: your hands are on the guitar and the phone is on a stand. The screen stays awake while
the room is open (`navigator.wakeLock`). At the kitchen on a phone the paper is full width under a 384 × 144 strip of
the scene and scrolls with the song; its chord row scrolls sideways inside itself, each chord a 44 px target.

### 3.19 The charm, and where it stops

The rule from LIVE-ROOM.md: the gear moves with the signal; the whimsy is in names, on the walls and on the tape box,
never on a button. Claw'd-o-Matic's charm, translated: its venues are the places, without the crowds; its *Write me a
song* dice are the tape box's name dice; its cover drawn from the song is the tape box's label; its gig setlist is the
setlist taped to the stage; its onboarding card (plug in, tune, line up your timing, pick a sound) is the soundcheck
lamps; its drum pedal's grammar (count-in, fill, next part, ending) is the band's own cues; its banter is the
engineer's dry line.

- The kick heads (VOID, SUMP PUMP, LAST CALL; the kitchen's cajón says COOLER on its side), and the count on the
  kick head.
- The bass plucks the root once when it has learned a part.
- The second amp sits under a dust cover until the first double, and both amps' lamps flash with their own signals
  during one.
- The setlist is taped to the floor with gaffer tape; an empty part is a card with nothing written on it.
- The deck's reels turn whenever the tape rolls and its counter counts bars, in green. There's no red light anywhere.
- The console ledge (a 14-pixel strip along the bottom of every scene) holds the tape counter, two VU needles on the
  master and the talkback lamp: you see the room over the console, through the glass, which is why the ledge is the
  door.
- The paper has a coffee ring, the capo written at the top, a pencil tick in the margin at the line playing, and a
  changed line shows the take's words struck through above it until the next take.
- The kitchen's lamp sways with the shaker; the cajón's front flexes on its hits.
- The blues bar's BLUES neon buzzes on with your first note; its LAST CALL sign lights on the ending.
- The basement's bulb swings on the kick; its flyer carries the song's title once it has one.

Where it stops: no characters, no crowd, no score, no red, no motion that isn't driven by a signal, nothing cute on a
button. Under `prefers-reduced-motion` the lamps still light, but nothing shakes, sways or pans, the reels stand still,
the counter counts, and the paper jumps to the line instead of scrolling. The scene is `aria-hidden`, and everything it
shows is also in the talkback or on a button.

---

## 4. The metal session

AJ: "for metal we deff sh0uld have a good drum preset and good left and right tracks and maybe guide the user through
double tracking and all that and laying down drums?" The usual order of work, pro or bedroom, is riff → tempo and
tuning → a guide guitar to a click → programmed drums → the real guitars, doubled, to those drums → bass → mix
[metal: moderate]. The room keeps that order and hides every step but the playing: the first pass is the guide, the
band learns it, the double is played to the learned drums, and the bass is the house's.

### 4.1 The preset

The metal club becomes Boiler Room's chain (`app/src/core/demos/boiler-room.js`; the genre guide,
`app/src/agent/genres.js`), the one the house already holds to metal's targets.

| Part | Devices | Settings |
|---|---|---|
| Drums | Rusty Sticks (`core.metalkit`) into Drum Riser (`core.drumbus`) | Modern, the trigger's SUB at −13, into Modern |
| Guitar L | Half Stack (`core.stack`) then Slide Rule (`core.eq8`) | the rig's preset (Modern: cab MODERN CLOSE). Slide Rule as Boiler Room's GTR_EQ, its low cut by tuning: 100 Hz for E standard and drop D, 90 Hz for D, drop C and C, 80 Hz for B and drop B |
| Guitar R | the same chain | the same rig with the cab one mic over (below), its LEVEL matched to the left within 0.5 LU |
| Bass | Roundwound (`core.ebass`) into Y Cable (`core.bassrig`) | Even (gain −3.5 dB) into Modern (`{ low: 0 }`, as Boiler Room) |
| Riff (as heard) | a muted notes track | the read's notes, one clip per part, by the house |
| Master, *Tight* | Slide Rule → Gatefold (`core.width`) → Clip Lamp (`core.clipper`) → Red Line (`core.limiter`) | a 35 Hz low cut, +1.5 dB at 140 Hz, −1.5 dB shelf at 10 kHz; mono under 120 Hz; *Master clip (+3)*; gain 4, ceiling −1 dBTP, release 80 |

**The right side's cab**, by the rig: Modern (cab 0, MODERN CLOSE) → cab 2 (MODERN SIDE); Djent (cab 1, MODERN BRIGHT)
→ cab 3 (MODERN 2 MICS); Thrash (cab 2) → cab 0; Hard rock, Crunch and Edge (Modern's cab 0) → cab 2
(`app/src/devices/builtin/amp-lib.js:32`). The same amp with another mic on the same cab is how Mynett's session made
the sides differ, and Herbst measured the amp among the most effective variables on a side's spectrum and the guitar
the least [metal: moderate; strong]. A different amp per side is the control room's.

**What changes from the prototype**: Gobo Kit kit 5 becomes Rusty Sticks (`app/src/core/liveroom.js:86`); Flatwound
with no Y Cable becomes Roundwound into Y Cable (`:87`, `:402`); the drums get Drum Riser, the guitars Slide Rule,
the master the chain. The rigs stay the musician's ‹ ›, level-matched to Modern.

**Velocity house rules**, as an option of the groove renderer that only the room passes
(`realize(groove, { …, rules: 'band' })`, `app/src/core/grooves.js:410`), so no existing render and no golden hash
moves: no run of hits at full (backbeats at 0.95, a blast's snare 0.85-0.9), ghost notes 0.15-0.4, hats varied ±5-8%
(seeded), a fill's first hit full and the rest a touch softer, fills a little looser in time than grooves [metal:
moderate, from the products and producers].

**The kit loads early.** Rusty Sticks is fetched when you pick the metal club (`prefetchKit`); the soundcheck usually
covers its 24 MB. The count waits for it with the kick head's *KIT 70%*; offline, the drums are Gobo Kit and the line
says so once (§3.5). Gobo Kit's levels are measured too.

### 4.2 Reading a take

When a pass lands, the house reads its DI: the take keeps the input before the amp, because the amp is an insert on
the track [code]. Bandmate's own docs warn that distorted audio may not read well, so the room never reads the amp
[metal: strong]. `readTake(samples, sr, { tempo, start, bars, grid, latency })` in `app/src/core/liveroom/read.js`,
pure and deterministic, run off the main thread (a Worker; an idle callback where there's none):

1. **Notes.** `createNoteFinder(earOf(sr))` over the take (`app/src/input/onsets.js`; `earOf` asks for a 30 Hz floor,
   a long window and unpitched attacks kept, `app/src/core/liveroom.js:106`). Eight bars at 132 is 14.5 s of audio.
2. **On the grid it knows.** Each onset goes to the place's grid (sixteenths; triplets at the blues bar) when it's
   within 40% of a step; the tempo and the 1 are given, because you played to the count (`onGrid`, kept from the
   prototype). Nothing about a period or a downbeat is guessed.
3. **Chugs.** A note within 5 semitones of the part's lowest note, or unpitched (a palm mute is rhythm): the
   prototype's follow rule (`app/src/core/liveroom.js:334-336`).
4. **Roots.** Per beat, the lowest pitched note held for at least 40% of the beat; a beat without one keeps the last
   root; unpitched chugs take the current root.
5. **The key** (the first part only): `rootOf` the riff's lowest notes with the place's scale (minor at the metal
   club and the basement, blues at the bar), in the take's step.
6. **Two readings for the room's own lines**: the median offset of chug attacks from their grid points (the lean, for
   the *Line it up?* line, §3.3), and the median cents of sustained pitched notes (the tuning line).
7. **Thin.** Fewer than 8 onsets on the grid, or no steady low note: the read says so, and the band keeps the groove's
   own kick, with the bass waiting.

The read places the band, and that's all it does: it never moves your take, changes the tempo or decides anything
about the song's shape.

### 4.3 The drummer and the bass learn it

`planLearn(p, { section, read })` in `app/src/core/liveroom/band.js`: one house step, labelled *The band learned the
verse*, reason `room:learn:<section>`.

- **The muted notes.** The read's notes as a clip on *Riff (as heard)*, so the bass, the kick, tab, jam tips and
  agents can read the riff later (`harmonyNotes` skips muted clips, not muted tracks, `app/src/core/jam.js:243-249`)
  [content: the prototype threw them away].
- **The kick** goes on every chug of a feel that follows (*Your chugs*, the breakdown's *Half time*), at most one per
  sixteenth, **where you picked it**: the grid point plus your offset, clamped to ±15 ms, so kick and pick land
  together even if the latency is a few ms out. Accents on each bar's 1 and on chugs 6 dB over the part's median
  level; velocities under the house rules. Between chugs the groove's hats and snare play. A riff that runs
  sixteenths for more than half its length gets double kick under it, by the same rule.
- **The bass**: the roots an octave down, folded into MIDI 23-47 (B0-B2; Roundwound is a five-string from B0, so drop
  C's C1 and B standard's B0 fit), on the kick's positions so it locks to your chugs too, held to the next hit. Simpler
  under fast parts [metal: moderate]: runs of sixteenths become eighths above 150 BPM and quarters above 190. It rests
  wherever you rest for a beat or more, so the stops stop. The basement plays the bar's root in eighths and the blues
  bar the boogie through the form (the prototype's modes, `app/src/core/liveroom.js:354-388`).
- **Fills** at the end of each 8-bar phrase (*Busier*: every 4; *Simpler*: none), *Kick and snare flurry* by default;
  into a chorus a bar going up, coming down two beats, between equals one (`planDrumTrack`'s rules,
  `app/src/core/grooves.js:832`), and a crash and kick on every part's 1. Into a breakdown, *Round the kit into the
  drop*; with the breakdown's drop on (the default), the drummer stops for the last beat before it, the genre guide's
  beat of silence.
- **Seeded.** The band's seed is `<section>:<feel>:<guide clip id>`, so the same song gives the same band after a
  reload, and every render is deterministic.
- **What it replaces.** Only the house's own clips in the part's bars, and only while every note in them is still the
  house's: a clip anyone else has edited is theirs, and the house never rewrites it (the room says so once, §7.5).

**When the guide changes.** The guide is the take playing on Guitar L in the part's bars. Again, ↑ ↓ or a comp in the
control room changes it, and the house re-learns from what now plays, as its own step. If the right side was played to
the old guide, the room measures the pair again: *The drummer follows take 2 now. The right side still sits within 12
ms.* or *The right side was played to take 1: from bar 3 it drifts against take 2. The other side again? D*.

### 4.4 The feels, and directing the drummer

Each part offers two or three feels in musicians' words; the groove ids stay behind the glass. F loops the part with
your take on the next one; Enter keeps it.

| Part | Feels at the metal club (`modernmetal` to 160, `metal` above) |
|---|---|
| Any part's first pass | the part's default feel with the kick only on each bar's 1 |
| Verse | *Your chugs* (djent-unison-quarters-on-the-hat with the kick on your chugs: the default once learned) · *Gallop* (double-kick-gallop; `metal/gallop` above 160) · *In threes* (djent-unison-in-threes, for odd groupings) |
| Pre-chorus | *Your chugs* · *China* (china-on-the-beat-kick-in-bursts) · *Gallop* (a pre-chorus is a verse part to the library: `partOfName`, `app/src/core/grooves.js:752`) |
| Chorus | *Open* (open-chorus-crash-riding, kick on your chugs; `metal/crash-riding` above 160) · *China* |
| Breakdown | *Half time* (half-time-china-breakdown, kick on your chugs; `metal/breakdown` above 160) · *Stops* (half-time-china-breakdown-stopping) |
| Bridge | *Toms* (tom-groove-under-the-riff) · *Gallop* |
| Intro | *Build* (crash-and-floor-toms; `metal/toms-and-double-kick` above 160) |
| At 180 BPM and up | *Blast* (`extreme/traditional-blast`) and *D-beat* (`extreme/swedish-d-beat`) join the verse and chorus lists |

**Simpler · Busier** (three steps: −1, 0, +1): Simpler puts the kick only on the first chug of each group and drops
the fills; Busier adds fills every 4 bars and a kick on every chug, ghost notes too. **Softer · Louder** (−1, 0, +1):
Softer swaps the ride or crash for the hats and scales velocities by 0.85; Louder puts a crash on every bar's 1 and
scales velocities by 1.08, capped at 0.95. Each step moves the drums about 2 LU: *to measure*, and held (§11.2). A
feel is your choice, so it's a step by you; the drum clip inside it stays signed by the house.

### 4.5 Playing the bass yourself

*Play the bass yourself* on a card's menu: the soundcheck's lamps for the bass (*Bass on input 2*; the tuner from 30
Hz), a *Bass (yours)* audio track into Y Cable Modern, played to the drums and both guitars with a bar of pre-roll.
The house's bass is muted, not removed, in the parts you play (a step by you). *Bass is in on the verse: yours. The
house's is off there.*

### 4.6 Levels, measured

Nobody building this can listen, so every level is a fader the canonical renderer measured, as the prototype's are
(`tools/liveroom-test.js` §2-3). The reference DIs are the synthesized metal fixtures (`tools/fixtures/metal-di/`:
chug, chords, tremolo, lead, bass), each played twice with different seeded timing and velocity so the two sides are
two performances, never a copy.

| Relationship | Target | How it's measured |
|---|---|---|
| The guitar pair over the band | 3 dB (±0.5) | integrated LUFS of the guitars against drums plus bass, Tight on |
| The drums over the bass | 3 dB (±0.5) | the same, between the two |
| One side against the other | within 0.5 LU | the right side's LEVEL is set by measurement on the reference DI |
| The pair against one centred take | within 1 LU | the same part single and doubled (pan is a balance in Overdub, so a hard-left mono take is one side at 0 dB, `app/src/engine/strip.js:7-9`) |
| Each rig against the place's first | within 0.25 dB | the prototype's check, kept |
| The guitar at −18, −12 and −6 dBFS in | the faders' slope per rig | printed; the room moves the guitar faders by it within the green |
| Busier, Louder, each step | about 2 LU | the drums alone (velocity hardly moves a kit through Drum Riser, so the house plays at 0.72 of the rules' touch and each step scales it: `band.js` TOUCH, measured) |
| *Tight* | −9 to −7 LUFS, −1 dBTP, PLR 6-9, mono under 120 Hz | `checkTargets(m, 'metal', { window: 'song' })` (`app/src/audio/targets.js`) |
| *Loud* | about 2 LU over Tight, −1 dBTP, PLR at least 6 | Red Line gain 14 (measured: +1.7 LU, as far as a PLR of 6 lets it go; Tight is gain 5.25 at −8.8 LUFS) |
| *Room* | within the metal window's floor, −1 dBTP | Drum Riser on its Room preset, Red Line gain 5.5 (measured) |
| The rhythm guitars | in band at least 0.89, at most −20 dB under 80 Hz and −30 dB over 8 kHz | the metal targets' guitar rules (`app/src/audio/targets.js:51`) |

The basement and the blues bar get the same relationships, and their finishes a loudness window and −1 dBTP (there
are no punk or blues targets in `audio/targets.js`; each window comes from measuring the place's own reference, not a
guess). A golden scene, `room:metal` (the chug fixture both sides with the house band and Tight), goes into
`tools/golden.json` with `UPDATE_GOLDEN=room:metal`, the one scene added on purpose.

### 4.7 Measuring the pair

`measurePair(left, right, { sr, tempo, start, bars, grid })` in `app/src/core/liveroom/tight.js`, pure, on the two DIs
(never through the amps):

- **Attacks.** Each take's onsets on the part's grid (§4.2's ear). Each left attack is matched to the nearest right
  attack within ±60 ms, and the offset refined by cross-correlating the two envelopes over that window, so a strum's
  smear isn't counted as a miss.
- **Per bar**, the median offset of the bar's matched attacks (right minus left, so plus is late) and the share of its
  attacks with no match on the other side.
- **The limit** is 20 ms or a quarter of a sixteenth, whichever is smaller (20 ms up to 187 BPM; 18.75 ms at 200); at
  the basement, 25 ms. A bar **drifts** when its median is over the limit or more than 30% of its attacks have no
  match.
- **The line**, by how many bars drift. None, and every bar within 10 ms: *tight* (*Within 8 ms of the left all the
  way*, the largest bar's figure). None: *fine* (*Within 14 ms of the left*). One or two: a *drift*, naming the worst
  bar, its direction and its figure rounded to 5 ms (*bar 5 drifts late against the left, about 30 ms*), with the
  one-bar punch offered. Three or more: a *wander*, from the first (*It wanders from bar 3*).
- **Why these numbers.** Ensemble players hear asynchrony from a few tens of milliseconds [metal: moderate, Rasch
  1979 via Wing et al. 2014], and a double works because its two takes are close and never identical [metal:
  moderate]. The room points only at what an engineer would point at; AJ's ear sets the final figures (§13).

---

## 5. The basement and the blues bar, in detail

| | The basement | The blues bar |
|---|---|---|
| Count | two bars, sticks on 1, 3, 5, 6, 7, 8 | one bar |
| First part | *Verse* | *Head* (one chorus or more) |
| Next parts offered | *Chorus · Bridge · Pre-chorus* | *Solo* (on the Lead track) · *Head* |
| Feels | *Straight* · *Open* · *Skank* · *Half time* · *Floor toms* | *Shuffle* · *Double* · *Ride* · *Slow* (under 80) |
| Fills | *Snare to floor* into a change; *Snare pickup* between equals | *Triplet pickup*; *Turnaround* at bars 11-12 |
| Ending | *Crash hold* | *Blues ending* (two bars) |
| The bass | root eighths (Flatwound Punk pick into Y Cable Grind) | the boogie through the form, from the chosen key |
| The double | offered once after the second part; drift over 25 ms | none; the Lead is panned +0.4 and the rhythm −0.4 |
| Finishes | *Raw* (Clip Lamp +3, Red Line gain 2, ceiling −1) · *Loud* · *Room* | *Bar* (Stairwell, `core.verb`, short on the master; Red Line gain 1) · *Close* (no Stairwell) · *Loud* |

**The blues bar's key** is chosen before the first count, a reading you confirm rather than a gate: the chip offers
the last chord the soundcheck heard first (the root of an open A7 is its lowest note), then E, A, G, D, C, B♭. The
twelve-bar is the prototype's form (`[0,0,0,0,5,5,0,0,7,5,0,7]` in steps from the root) and `chordAt` (kept) tells the
readout where the form is between passes: the chord now, the next one, and the bar of the twelve.

---

## 6. The kitchen table

AJ: "For acoustic guitar I was thinking maybe even like a paper w/ chords on it and lyrics and stuff could be cool.
really think through how people do these things."

How people do these things: songwriters don't have a machine recognise a song. They play it once for someone (Jason
Isbell "plays the song once for the band on acoustic guitar" and the players "write charts for themselves"), the first
recording is guitar and voice in one pass, often on a phone, with no click, and the band comes after, around that take
[songs: weak to moderate, interviews]. The sheet is the song while it's being written: written once per section,
recalled many times, chords anchored to syllables, the capo moving to fit the voice [songs: strong for the formats].
The kitchen table is that: a paper, a work tape, and a small band that reads both.

Why a kitchen table and not LIVE-ROOM.md's campfire: the paper needs a table and a lamp, the laptop that is the mic
sits on one, writers write at one, and a campfire has listeners round it (an audience in the room is an anti-pattern,
LIVE-ROOM §6). The id `kitchen` is forever; the display name can change.

### 6.1 The paper

**What it is.** Real text beside the stage (desktop) or under it (phone), on the brand's paper (`--paper` #f4ead6,
`--ink` #16130f, the fine grain). Not pixels: the pixel font has no lowercase and no punctuation, and 256 pixels hold
about 64 characters [proto]. Being text, it's selectable, read by a screen reader, legible on a phone and editable.

**What's on it.**
- The header: the song's title (the project's `title`, the display face), and slates in mono capitals: *CAPO 3 ·
  SOUNDS IN B♭ · 3/4*, then *~84 BPM* once there's a take. The capo has − and + beside it.
- The flow: the song's parts in order, as chips (*V1 · C · V2 · C · B · C ×2*); the one playing is inked.
- The sections: headings in brackets (*[VERSE 1]*, mono capitals, 13 px), each written once.
- The lines: chord symbols (Atkinson Hyperlegible Mono, bold, 15 px) over the syllable they fall on; the words in
  Atkinson Hyperlegible Next, 18 px over 1.7 (on a phone, 14 and 17 px).

**How it's started.**
1. **Blank.** *Untitled*, *capo —*, one empty *[VERSE]*, one line with a hint: *Type the words, or [G] for a chord. Or
   just play: the band will write the chords down for you.* Writers start from a title, a hook or a chorus, not line
   1, so any section can come first [songs: moderate].
2. **Pasted or opened.** ChordPro (`.cho`, `.chordpro`) or chords over words as plain text (the Ultimate Guitar
   layout): a line made only of chord symbols is a chord line, anchored by column to the syllable under each chord;
   `[Verse]`, `Chorus:` and ChordPro's environments are sections; `{capo: 2}` or *Capo 2* sets the capo; ChordPro's
   `title`, `key`, `time` and `tempo` fill the header. *Read 3 sections, 14 lines, 5 chords: G, C, D, Em, Am. Capo 2.*
3. **From a take.** After a work tape on a blank paper (§6.3): *Sounds like G–Em–C–D in the verse. Write it down?*
   with the capo choices that put the sounding chords on open shapes (*G shapes, capo 3 · A shapes, capo 1 · no
   capo*). Accepting writes chord-only lines (*| G | Em | C | D |*) under section headings from the take's repeats,
   signed by the house, to type the words under.

**How it's written.** A click or tap on a line edits it in its inline form, *Somewhere a [G]paper [Em]moon*, so a
chord stays on its syllable when the words around it change (why ChordPro's brackets exist [songs: strong]). Above the
line being edited, a chord row: the key's six common chords in the capo's shapes, then the chords this sheet already
uses; a press puts one at the cursor, and typing `[` starts one by hand. Enter starts a new line; ⌫ on an empty line
removes it. A chords-only line uses bars: `| G | Em | C D |`. Symbols are read with `parseChord`
(`app/src/core/jam.js:141`: slash chords, extensions), and Nashville numbers (`1 4 6- 5`, `1/5`) through `parseRoman`.

**How it changes.**
- **A new verse** copies the last verse's chords with the words left empty.
- **The capo**: − + changes it. The shapes on the paper stay; the key the band plays moves (ChordPro's rule). The
  check holds the direction: capo 3 on G shapes sounds in B♭, not E. After takes, as a fact: *Takes 1 and 2 were capo
  2, so the band won't match them now.*
- **Crossings-out**: a line changed since the take that used it shows the take's words struck through above it in
  `--ink-3`, until the next take. History has every version.
- **A chord the band doesn't know** (it doesn't parse) keeps a dotted underline: *The band doesn't know this one:
  they'll rest under it.*
- **Bylines**: a line written by anyone but you or the house ends with a byline (*· Claude*, or a guest's name) in
  `--ink-agent` or `--ink-human`, the paper inks that pass contrast as small text on cream (5.7:1 and 5.5:1; the riso
  pair is 2.8:1 and 2.4:1 there) [brand]. No line is tinted by who wrote it.
- **Help with words** stays out of this version: what songwriters find hardest is words, and whole-song tools
  "bypass all the initial and intermediate steps" [songs: moderate]. An agent asked for a line edits that line with
  `sheet.line.set`, signed.

**While it plays**, a pencil tick marks the line under the playhead and the page follows it; it turns to the next
section at the section's last bar.

### 6.2 Recording voice and guitar

**(a) One mic hears both**: the laptop's, a phone's, a USB mic, or one mic on the Scarlett's input 1.
- **The balance**, measured: *Strum the way you'll play.* (three seconds), then *Sing a line, no guitar.* or *Speak a
  line* (AJ doesn't sing, and a spoken line sets the level as well). The room compares their short-term loudness at
  the mic and wants the voice 3-8 dB over the guitar, "favour the voice" [songs: weak]: *Good: your voice sits 5 dB
  over the guitar.* · *The guitar's louder than you: tilt the laptop up toward your mouth, or sit back a little.* ·
  *You're well over the guitar: bring the mic a little closer to the soundhole.* · *No singing? Skip.*
- **The browser check.** The room reads `track.getSettings()` once the input opens. If echo cancellation, noise
  suppression or gain control stayed on (iOS Safari often keeps them), once: *This browser cleans up the mic like a
  phone call, so the guitar may come out thin. A laptop or an interface sounds better.* Overdub asks for all three off
  (`app/src/input/audioin.js:175`).
- **Headphones**: one question, *Headphones on?*, remembered per output (and not asked when the output's name says
  headphones, AirPods or speakers). On speakers the band never plays during a take: it would land in the mic, and
  nothing in a browser takes it out without hurting the guitar (Apple needed an A18 Pro and machine learning to do it
  for Voice Memos) [songs: strong]. *On speakers, the band waits till you're done.*
- **The track**: *Guitar & voice*, mono, by you, monitoring off (you hear yourself in the air). Its chain: Slide Rule
  (low cut 80 Hz, −2 dB at 250 Hz), Squeeze Box (`core.comp`, 2-3 dB on the peaks) and a small Echo Chamber
  (`core.rooms`, 12% wet). The place is the reverb; there's no reverb knob.

**(b) The Scarlett Solo with a mic on input 1 and no pickup** is (a) with a better mic and the Solo's headphone out:
*Turn the Solo's direct monitor on to hear yourself without the delay.* The Solo's second input is an instrument jack,
so two inputs need a guitar with a pickup [songs: strong, the maker's spec].

**(c) A mic and a pickup**: two tracks, *Voice* (input 1) and *Guitar* (input 2), recorded together, both by you. One
stream, both channels split to two tracks at once, each placed by the same latency and lined up by their measured
offset (a mic 34 cm away is 1 ms late), the bleed left in. Monitoring per channel: the mic's off unless you're on
headphones, and the feedback guard runs on it even on an interface (today it's skipped for interfaces,
`app/src/input/audioin.js:413`). The band reads the Guitar track, which has no voice in it. The guitar's chain: Slide
Rule (low cut 80 Hz, −3 dB at 250 Hz, +2 dB at 5 kHz) and Squeeze Box; the voice's: Slide Rule (low cut 100 Hz),
Squeeze Box and the small Echo Chamber. With two inputs, Again asks *Both, or just the voice?* (just the voice is a
whole pass on Voice over the master's guitar, on headphones). Two-channel capture is the biggest recording item in
the mode [rec: medium-hard]; until a device shows both channels moving, the option says *needs a guitar with a pickup*.

### 6.3 The work tape

*Space starts the tape. Play it through; Space again when you're done.* No count, no click, no band. The take keeps two
seconds before your first note and trims the leading silence before that; the end is yours (no silence detector stops
the tape). The laptop on the table shows the counter in minutes.

*Take 1 is in: 2:41. The band's reading it.* It lands as one audio take on the take track, named from the paper
(*Paper Moon · take 1 · capo 2*), by you.

**With headphones there's the other way in**: *Count me in at 84 instead?* One bar of soft sticks, and the shaker
plays the paper's time from the first take. ← → and T set the tempo first, as in the electric rooms. A counted take is
on a grid by construction, so nothing about its time is read.

### 6.4 How the band reads it

**The sheet wins the chords; the take wins the time** [songs: strong for the practice].

- **The time.** The Flip analyser on the take (`app/src/audio/analyze/index.js`: beats, a tempo map with free spans,
  downbeats and its alternative readings, deterministic, in a Worker). The room asks you to confirm it by ear, never
  by number: *The band's read it: around 84, drifting 80 to 88. Hear the shaker on it?* It plays the take with a
  shaker on the read beats, and the readings are chips, each heard at once: [On the beat] [Twice as fast] [Half as
  fast] [The 1's a beat later]. The one you keep becomes the song's `tempo.map`, a step by you.
- **When the time won't hold.** Free time over 20% of the take, or no reading you'd keep: on headphones, *The time
  moves a lot in this take. Again to a shaker? It counts you in at 84 and the band follows that.* On speakers: *The
  band will sit out where the time moves.* (the players rest in free spans, and the line names the part).
- **The chords follow the paper; nothing recognises them.** The paper's chords, in the flow's order with the capo
  applied, are aligned to the take's per-beat chroma by a forward-only model: each chord lasts a beat or more, changes
  prefer bar lines and half bars, whole sections may repeat or be skipped. The vocabulary and the order are yours, so
  only the change points are read: a much easier problem than naming chords from a strummed, sung mic take (chord
  estimation "is not yet a solved problem"; Music Memos' reviewer: "far from perfect") [songs: moderate]. The result
  is the song's sections (named from the paper) and a muted **Chords** track (one clip per chord, named by its shape,
  its notes the voicing at sounding pitch), one house step. *The band has your chords: G, Em, C, D in the verse.*
- **Where the take and the paper differ in form**, the room offers the change: *You played the chorus twice at the
  end. Write it as Chorus ×2?*
- **Where the paper has no chords for a section**, the analyser's are shown as a suggestion, dotted, and nobody plays
  them until you accept. Nothing plays a chord the sheet doesn't have (against Logic's fallback to the tonic) [songs:
  moderate]. The shaker can still play.

### 6.5 The players

| Player | Device | What it plays | Level under the take |
|---|---|---|---|
| Shaker | Hand Crate "Shakers up" | a pop or country groove's hat row (*Eighths*, *Push and pull*; *Boom-chick*, *Train beat* from 90) | −12 LU |
| Cajón | Hand Crate "Crate" | the same groove's kick and snare as the cajón's bass and slap (`app/src/devices/builtin/handkit.js:8-9`) | −12 LU |
| Bass | Flatwound "Motown" | the Chords track's roots on the strong beats, walking into changes (`bassLine`, `app/src/core/arrange.js:529`), resting where the paper has no chord | −9 LU |
| Strings | Music Stands (`core.strings`) | the chord held, in a bridge only (`chordPart`, `app/src/core/arrange.js:582`) | −14 LU |

- **One player per offer**, in this order, each on its own section: *Want a shaker in the chorus?* → *The cajón under
  the verses?* → *The bass from the first chorus?* → *Strings in the bridge?* (only with a bridge). Each offer plays
  the take from that section with the player in (a preview). *Keep it* is a step by you, its clip signed by the house;
  *No thanks* means it isn't offered there again. *Shaker's in the chorus: it follows your time.* That's Bennett's
  model: players offer parts on the spot and the writer approves, adapts or vetoes [songs: moderate].
- **Direct choice**: the band chips under the stage (*shaker · cajón · bass · strings*) put a player in or out of the
  selected section.
- **In three.** The groove library is 4/4 only (`app/src/core/grooves.js:685-691`), so in 3/4 and 6/8 the shaker and
  cajón play `genericRows` (`app/src/core/arrange.js:516`, exported for this).
- All four play the sounding chords (the shapes plus the capo), each where the paper and the time put it.

### 6.6 Takes

- **Whole passes, all kept**, in one take folder, named from the paper: *Paper Moon · take 3 · capo 2 · 84*.
  Songwriters run a song a few times and keep whole takes [songs: weak to moderate].
- **Take 1 is the master**: the take the band follows.
- **On headphones**, later takes are played with the band following the master's time, so they share its bars.
- **On speakers**, later takes are free. ↑ ↓ plays a take from the top, bare. *Use this one* makes it the master and
  the band re-reads its time (one house step, the band's clips re-timed): *Take 3 is the master now: the band follows
  it, around 86.*
- **A section from another take** is a comp, and the control room's: one mic hears voice and guitar together, so a seam
  at a section line cuts a sung pickup, and the comp tool shows the waveforms to do it right.

### 6.7 The finish

*Bare* (Squeeze Box glue, 2 dB; Red Line ceiling −1, no gain: about −16 to −14 LUFS) · *Warm* (plus Clip Lamp's soft
clip) · *Close* (Slide Rule +2 dB at 4 kHz, Red Line gain 3: about −13 LUFS). `app/src/audio/targets.js` gains an
`acoustic` entry: −16 to −12 LUFS integrated, −1 dBTP, PLR 9-14.

---

## 7. The song

### 7.1 Parts and takes

- **A part is a section** (`section.add`), named the way musicians name parts: intro, verse, pre-chorus, chorus,
  bridge, breakdown, solo, head, end [whole: strong]. The setlist and the paper are views of `project.sections` in
  start order; there's no second structure, and a section made behind the glass is a card in the room.
- **What the room knows about a part** (its feel, simpler or busier, softer or louder, ×2, single on purpose, the drop
  into it, which sheet section it plays, what the band last learned from) lives in the song's `room.parts`, keyed by
  the section's id, because a new field on a section is dropped by every reader (`cleanProject` keeps only id, name,
  start, length, color and key on a section) [code].
- **Its takes** are audio clips on the room's tracks within its bars, in take folders: Guitar L's and Guitar R's at the
  electric places, the take track's (or Voice's and Guitar's) at the kitchen. **Its band** is the house's clips on
  Drums and Bass (and the kitchen's players) within its bars.
- **The tempo** is set before the first take and fixed by it. Overdub doesn't stretch audio, so a tempo change after
  takes would leave them off the bars. The readout says *132 · set by your first take*. At the kitchen the tempo is the
  take's map.

### 7.2 Seams

- A part's take clip starts **30 ms before its part's 1** (the first part's at beat 0), so a pick that leans early
  isn't cut, and the clip before it ends there: a butt splice, with the engine's own 3 ms fades at clip edges
  (`app/src/engine/schedule.js`) [code]. Overlapping clips both play in Overdub, so the plans never leave an overlap.
- The last part's clip runs one bar on into the End, carrying the ring the recorder kept.
- A one-bar punch (*Bar 5 again*) keeps the same rule at both of its edges.
- ×2, moves, Shorter and Remove keep it: the plans re-extend and re-trim the clips at the new boundaries in the same
  dispatch (the arrangement planners cut clips at section lines, `app/src/core/arrangement.js:558`).

### 7.3 Signing and undo

| Action | By | One step holds |
|---|---|---|
| Pick a place | you | the tempo and meter, the role tracks (the band's signed by the house inside), the master chain, `room.set` |
| A take | you | the recorder's dispatch (`asset.add`, the take folder's `clip.add`s), with the part's `section.add`, `room.part.set` and the End's move joined to it (`store.dispatch(ops, { join })` keeps one step and sets its label and reason, `app/src/core/store.js:178`) |
| The band learns it | the house | the notes clip, the drums and bass clips, the pan lane, `room.part.set { learned }` |
| The other side's set-up | the house | arming Guitar R, the dust cover's `room.set` |
| Another feel, Simpler · Busier, Softer · Louder | you | `room.part.set` and the part's drum clip (signed by the house inside) |
| Next part, Again, a punch | you | a take, as above; the band's re-learning follows as its own house step |
| Lay it out | the house | its form: copies, empty sections, their `room.part.set`s and their band |
| ×2, Earlier · Later, Shorter, Remove, Name | you | the arrangement ops with the clips and the band at the new boundaries |
| A finish | you | the master's inserts and `room.set { finish }` |
| A player kept (kitchen) | you | the player's track (once) and clip, signed by the house inside |
| The read of a work tape | the house | the sections, the Chords track and clips |
| The time chosen (kitchen) | you | `tempo.map` |
| A line on the paper | you | `sheet.line.*` |

**One press of ⌘Z undoes a step and its consequence.** A take is your step and the band's learning is the house's
step after it, so History stays exact about who did what. In the room, ⌘Z undoes the learning and the take together
when the house's step (reason `room:learn:<section>`) came straight after your take of that part (reason
`room:take:<section>`), and says what went: *Undone: verse take 2. The drummer's back on take 1.* ⇧⌘Z redoes the
pair. In the studio each is its own step, as everywhere. If anything landed between the two (an agent's edit), the
learning is undone alone. (`store.redo` keeps a step's reason, which it drops today, `app/src/core/store.js:276`, so a
redone pair is still a pair.)

### 7.4 The offered move

The primary button (Space) is the first of these that applies, re-read after every step:

1. A count, a take or a playback is running: *That's a take* or *Stop*.
2. A drift line just named a bar: *Bar 5 again*.
3. At the metal club, the part you've just played has a left take and no right one: *The other side* (at the
   basement, once, after its second part).
4. Two parts have takes and *Lay it out* hasn't been offered in this song: *Lay it out*.
5. The song is laid out and hasn't been heard top to bottom since it last changed: *Hear it all*.
6. A card is empty: *Play the breakdown*, by its name (R on it, with its pre-roll).
7. Before the first take: *Count me in*.
8. Otherwise: *Next part* until the song is laid out, then *Hear it all*.

*Send a mix* is a button, never Space: it appears once the song has been heard top to bottom (§3.14).

The kitchen's: *Start the tape* → (after a take) the read's question → the next player's offer → *Again* → *Hear it
all*. This is `session.js`, a pure reducer of the room's state and the song, so each path's presses are a Node check
(§11.4).

### 7.5 What the room reads back from the control room

The room keeps nothing of its own about the song beyond the `room` and `sheet` fields: `readRoom(p)` (pure) reads it
each time, and the room listens for the store's loads and changes, so a song loaded underneath re-reads the room.

| Changed in the control room | What the room does |
|---|---|
| A section added | A card; its feel comes from its name (`partOfName`) and the place; the band doesn't play it until you choose a feel or play into it: *The drummer hasn't played the bridge yet. F to give it a feel.* |
| A section renamed, moved or removed | The card follows; the room's data stays on the section's id |
| Takes comped (`planTakeComp`) | The guide is whatever plays on Guitar L in the part's bars; the band re-learns from it |
| A take moved or trimmed | Left as you left it; the band re-learns if the guide changed |
| The drums' or bass's notes edited (by you or an agent) | Those clips are theirs; the house never rewrites a clip with a note it didn't write, and F says so first: *The chorus drums were changed in the control room. Another feel would replace them. Go ahead?* |
| A fader or pan moved | `room.managed` holds what the house last set; a setting that differs is yours and stays, said once: *You set the drums' level in the control room. The room leaves it there.* |
| The amp's knobs moved | The label reads *Half Stack, yours*; ‹ › says *‹ › replaces your amp settings. ⌘Z brings them back.* |
| The master changed | The finish chips show *Yours* selected; choosing another replaces it (⌘Z back) |
| The tempo changed after takes | Once: *The tempo's 140 now: your takes were played at 132, so they won't sit on the new bars.* No stretching |
| A meter not in four | The band keeps its notes and offers no new feels: *The song's in 7/8 now. The band plays in four; its parts stay as they are.* |
| Tracks added (a pad, a synth, an agent's lead) | They play; the stage shows a crate with the track's name in grease pencil; the room never manages them. Once: *A synth came in from the control room.* |
| A role's track deleted | That amp goes dark; the next time it's needed the room makes it again with the place's chain |
| A song with no `room` field, opened in the room | *Where are we playing?* for it; the room adds its tracks beside yours and never touches yours; sections become cards; no sections is one card, *The song* |

---

## 8. Behind the glass: what the room decides

| Decision | What the room does | The number |
|---|---|---|
| The input and channel | the last input used; else an interface over a mic for electric, a mic for the kitchen; on a multi-channel interface, the channel that moves on your first strum | ≥ 12 dB over the others |
| The input level | asks for the knob by peak; the guitar faders follow the measured level within the green | green −18 to −6 dBFS; the faders measured at −12 |
| Monitoring | on through the place's amp for an interface's instrument input; off for a mic; the kitchen always off; the feedback guard on any mic channel | |
| Latency | measured once per device and remembered (eight strums at 100 BPM, fine at a spread of 40 ms or less); takes placed by it, else by the browser's guess; said once when it's long | over 25 ms there and back; an output over 80 ms on its own |
| The lean | the median offset of your chugs from the grid, from the read; offers *Line it up* when the latency is a guess and two takes in a row lean the same way | over 12 ms, within 6 ms of each other |
| Tuning | read from the open low string, confirmed only when ambiguous; sets the bass's range, Slide Rule's low cut and the key root; later, a line when the read's median is off | lo 38 Hz; over 15 cents on six notes |
| The amp | the place's rig per side; the right side's cab one mic over | MODERN CLOSE left, MODERN SIDE right (Modern) |
| Guitar EQ | Slide Rule by tuning | low cut 100 / 90 / 80 Hz; Boiler Room's curve |
| Levels | measured faders per place, role and finish | §4.6; the kitchen's players −12 / −12 / −9 / −14 LU under the take |
| Pans | a part with one side plays it centred; once it has both, L −1 and R +1; the intro single on purpose stays hard left; the bass, kick and voice centred | Guitar L's pan lane, a step at each part boundary with a 20 ms ramp, written by the house and gone once every part has both sides |
| The kick's timing | your pick's time on chugs | within ±15 ms of the grid |
| The bass's line | roots an octave down, on the kick, simpler when fast | MIDI 23-47; eighths over 150 BPM, quarters over 190 |
| Take seams | butt splices | 30 ms before a part's 1; the engine's 3 ms edge fades |
| A part's extent | whole bars to the stop; part 1's empty bars dropped; under a bar not kept | −50 dBFS; −42 dBFS |
| The drum sound | the place's kit and bus, the velocity house rules | |
| The master | the place's finish | Tight: −9 to −7 LUFS, −1 dBTP |
| The monitor path's own delay | kept small: the master chain adds about 2.4 ms | Red Line 88 samples, Clip Lamp 27.5 (`app/src/devices/builtin/limiter.js:19`, `clipper.js:49`) |
| Storage | takes in this browser; `persist()` asked at the first kept take; space said when it runs short | about 11.5 MB a minute of mono take; warns at 80% of the estimate |

**The few musical choices it offers instead**, two to four at a time, each heard at once (MySong's two sliders,
Drummer's two axes [whole: strong to moderate]): the place; the tempo before the first take; the tuning, when the
low string can't tell; the amp's setting (three per place); a part's name, place, ×2 and length; the drummer's feel
(two or three per part), simpler or busier, softer or louder; the other side; the bass (the house's or yours); the
finish (three per place); at the kitchen, the capo, the meter, the time's reading, the players per section and which
take is the master.

---

## 9. What's stored

Everything that changes a song goes through `store.dispatch(ops, { by })`. Each new kind of change is an op with an
exact inverse; each new field is at the top level, where older readers keep it untouched (`cleanProject` spreads the
old song first, `app/src/core/project.js:354`) and render it identically.

### 9.1 Two new top-level fields

```
room: {
  v: 1,
  place: 'metal',              // 'metal' | 'basement' | 'bluesbar' | 'kitchen' (ids forever; an unknown one is kept,
                               //  and the song opens in the control room)
  rig: 'modern',               // a RIGS id (electric): 'modern' | 'djent' | 'thrash' | 'hardrock' | 'crunch' | 'edge'
  tuning: 'drop-c',            // a fretboard.js TUNINGS id (electric)
  finish: 'tight',             // the finish the house last set: 'tight' | 'loud' | 'room' | 'raw' | 'bar' | 'close' |
                               //  'bare' | 'warm'
  master: 'c_…',               // the kitchen: the take clip the band follows
  mic: 'one',                  // the kitchen: 'one' (one mic hears both) | 'two' (a mic and a pickup)
  tracks: { guitarL, guitarR, guitar, lead, drums, bass, heard, bassYours,
            take, voice, kguitar, shaker, cajon, kbass, strings, chords },   // role -> track id
  parts: { [sectionId]: { feel, busy, loud, reps, oneSide, drop, sheet, learned: { from, thin } } },
  takes: { [clipId]: { capo, bpm, onMaster } },                            // the kitchen's takes
  managed: { [trackId | 'master']: { gain, pan, chain } }                  // what the house last set (chain: a short
                                                                           //  hash of the inserts and their params)
}

sheet: {
  v: 1,
  capo: 3, time: [3, 4], notes: '',
  sections: [ { id: 'ss_…', name: 'Verse 1',
                lines: [ { id: 'sl_…', text: 'Somewhere a [G]paper [Em]moon', by: 'you' } ] } ]
}
```

- The title is the project's `title`; the sounding key is the project's `key` (the shapes plus the capo), so the band,
  the tuner and every tool read one key.
- `room.parts[s].sheet` names the sheet section a song section plays, so a chorus written once plays in several places.
  The aligned chords are the Chords track's clips, which the arrangement ops already move with their sections.
- `feel` is a feel id (`chugs`, `gallop`, `threes`, `open`, `china`, `halftime`, `stops`, `toms`, `build`, `blast`,
  `dbeat`, `straight`, `skank`, `floortoms`, `shuffle`, `double`, `ride`, `slow`, `eighths`, `pushpull`, `boomchick`,
  `train`), `busy` and `loud` are −1, 0 or 1, `reps` 1-4, `oneSide` and `drop` booleans: all forever.
- Lines are plain text (`plainText`), at most 200 characters; chords are the bracketed tokens, read with `parseChord`
  and kept as text when they don't parse; section names are cleaned as names (100 characters).

### 9.2 The ten new ops

| Op | Fields | Does | Inverse |
|---|---|---|---|
| `room.set` | `patch`: any of place, rig, tuning, finish, master, mic, tracks, takes, managed (whole values; `null` deletes a key) | creates `room` (`{ v: 1 }`) if absent, then sets each key; refuses a `tracks` entry that names no track | `room.set` with each key's old value (`null` where it was absent), or `{ clear: true }` when there was no `room` |
| `room.part.set` | `section`, `patch`: feel, busy, loud, reps, oneSide, drop, sheet, learned (`null` deletes) | merges into `room.parts[section]`; refuses a section the song doesn't have | the old values, or `{ section, remove: true }` when there was no entry |
| `sheet.set` | `patch`: capo (0-11), time (`[n, d]`), notes (2,000 characters) | creates `sheet` (`{ v: 1, sections: [] }`) if absent, then sets each key | the old values, or `{ clear: true }` when there was no `sheet` |
| `sheet.section.add` | `section` (`{ id?, name, lines? }`), `index?` | inserts it (an id made if absent; its lines signed by the op's `by` unless restoring) | `sheet.section.remove` |
| `sheet.section.set` | `section`, `patch` (`{ name }`) | renames it | the old name |
| `sheet.section.remove` | `section` | removes it | `sheet.section.add` with the whole section cloned, at its index |
| `sheet.line.add` | `section`, `line` (`{ id?, text }`), `index?` | inserts it, signed by the op's `by` | `sheet.line.remove` |
| `sheet.line.set` | `section`, `line`, `patch` (`{ text }`) | sets the text and signs it by the op's `by` | the old text and the old `by` (a restore keeps the `by` it's given) |
| `sheet.line.remove` | `section`, `line` | removes it | `sheet.line.add` with the line cloned, its `by` kept, at its index |
| `section.move` | `section`, `before` (a section id, or `null` for the end) | moves the section and everything in its bars, and the bars between close up behind it: planned in two steps, first the clips and take folders across the section's edges and the destination split there (as `section.duplicate` splits them), then every clip, section and lane stretch in the bars that move given its new start (`clip.set { start }`, `section.set { start }`: ids kept, so the section keeps its `room.parts` entry), and a loop inside them going with them; refuses inside a tempo map, as `section.duplicate` does (`app/src/core/arrangement.js:562`), and a move that changes nothing | the primitives' own inverses, newest first, in one step |

Ids in `tracks`, `section`, `master` and `takes` may be `$ref`s made earlier in the same dispatch (`resolve`,
`app/src/core/ops.js:20`), so picking a place makes its tracks and names their roles in one step. `room.*` and `sheet.*`
live in `app/src/core/liveroom/room-ops.js` and `sheet-ops.js` (`ROOM_OPS`, `SHEET_OPS`), assigned into `OPS` as the
automation ops are (`Object.assign`, `app/src/core/ops.js`); `section.move` is a planner in
`app/src/core/arrangement.js` beside `section.duplicate`. They go into `OP_TYPES` (`app/src/core/ops.js:871`), the
round-trip table in `test/unit/ops.test.js` and the trials in `tools/core-test.js` (both refuse an op type they don't
cover), `describe` for History's labels, and the op table in `docs/ARCHITECTURE.md`. `section.duplicate`'s plan also
copies the section's `room.parts` entry to its copy. Op names, field names, place ids, feel ids, rig ids, finish ids
and tuning ids are forever.

### 9.3 The plans (pure, made of existing ops)

| Plan | Makes | Signed | Owner |
|---|---|---|---|
| `planPlace(p, { place, tuning })` | the tempo and meter, the role tracks with their chains and faders (from `setupOf(place)`), the master finish, `room.set` | you (the band's tracks by the house inside) | stage |
| `takeOps(take, { part })` | the ops joined to a take's step: for a new part, `section.add` and `room.part.set`; the seams' re-trims; the End moved | you | stage |
| `planLearn(p, { section, read })` | the notes clip, the drums and bass clips (only the house's untouched ones replaced), the pan lane, `room.part.set { learned }` | the house | band |
| `planFeel(p, { section, feel, busy, loud })` | `room.part.set` and the part's drum clip | you, the clip by the house | band |
| `planDouble(p, { section })` | arming Guitar R (and its chain the first time), the pans and the pan lane | the house | band |
| `planLayout(p)` | the place's form: copies, empty sections, their `room.part.set`s and their band, the End | the house | stage |
| `planTwice`, `planMove`, `planShorter`, `planRemove` | ×2 (`time.insert`, `section.set { length }`, `clip.repeat`, the band varied), `section.move`, `time.remove` of the bars cut, `time.remove` over the part; each with the seams and the End | you | stage |
| `planFinish(p, { finish })` | the master's inserts and `room.set { finish, managed }` (the kitchen's: `planKitchenFinish`) | you | band |
| `planRead(p, { take, sheet })` | the kitchen's sections, the Chords track and its clips | the house | kitchen |
| `planTime(p, { take, reading })` | `tempo.map` from the chosen reading (as the analyser's `readingOps` does), the band re-timed | you | kitchen |
| `planPlayer(p, { player, section })` | the player's track (once) and clip | you, the clip by the house | kitchen |
| `planMaster(p, { clip })` | `room.set { master }`, the time from that take, the band re-timed | the house | kitchen |
| `readRoom(p)` | the room's view: place, roles (re-bound by name when a track went), cards in order with their takes per side, the playing take, the guide, the band's clips and whether they're still the house's, `managed` differences, the paper's mapping | (a read) | foundation, then stage |

### 9.4 The engine, the recorder and the input

- **The count-in's voice.** `engine.play(from, { countIn: { beats, preroll, voice, hits } })`: `voice` is `'click'`
  (today's wood block, the default), `'sticks'` (two sticks clicked together: a short bright knock, synthesized in
  `app/src/engine/click.js` beside `clickSamples`, pure, the same in Node) or `'none'` (the band is the click: a
  pre-roll of the song). `hits` lists the count's beats that sound (the basement's `[0, 2, 4, 5, 6, 7]`). Like the
  click, the count goes to the speakers and never into a render.
- **The recorder** (`app/src/input/recorder.js`) already makes a take one step by you, joins a step made before it
  (`record({ join })`), keeps every audio pass in Capture (`:1338`) and ends a take at a given beat (`stop({ at })`). It
  gains: a stop scheduled at a future beat on the audio clock (`stop({ at, tail })`, the tail recorded past it, one
  bar, so a last chord's ring is in the take); a punch range that ends a take by itself and keeps only that range
  (`record({ punch: { from, to } })`, for the other side and a one-bar punch); a stop that keeps the pass in Capture
  and puts nothing in the song (`stop({ keep: 'capture' })`, Esc), and ⇧R's Put it in the song
  (`recorder.capture`) for an audio pass; `asset.add` for every audio take, so the song describes its own recordings
  (it doesn't today: `app/src/input/recorder.js:932-933`); and the commit's step id in its result, so the room joins
  the part's ops to the take (`store.dispatch(ops, { by: 'you', join, label, reason: 'room:take:<section>' })`)
  without a second step.
- **The band during a pass** is a preview (`store.preview`, `app/src/core/store.js:204`): the part's feel with the kick
  on the 1s from the part's start, as long as the pass runs, released after the take's tail. A pass thrown away
  leaves nothing in History; the band's real clips land with the learning.
- **The input** (`app/src/input/audioin.js`) gains: per-channel levels while a device is open (the channel pick);
  `track.getSettings()` exposed in its state; two channels to two tracks at once (`audio.open({ split: { 1: trackA, 2:
  trackB } })`, the capture worklet already takes `channels: 2`, `app/src/input/cap-worklet.js`), with monitoring and
  the feedback guard per channel; the audio-clock frame of the first captured block in its state (a check uses it to
  line a fake guitar up with the count). As built (stream A): `pickChannel(levels, { over, floor })` (pure, exported),
  `audio.levels()`, `audio.useChannel(ch)`, `open`'s `capture: true` and `split`, and `state.firstFrame` and
  `state.split`; the engine's `lastCount` (the last count-in: its beats, voice, hits, start on the audio clock and the
  beats that sounded); the recorder's `record({ punch, lead, quiet })`, `stop({ at, tail, keep })` and its `scheduled`
  and `thrown` getters. The lamps' readings (`levelVerdict`, `tuningsFor`, `tuningName`, `leanLine`, `NOTE`) are pure,
  in `ui/liveroom/lamps.js`.
- **The deck** (`app/src/ui/liveroom/deck.js`) is the room's one door to all of it: `countIn`, `take`, `stop({ at:
  'bar' | 'now' })`, `keepAfterAll` (⇧R), the soundcheck's lamps and the state the stage paints from. Every musical
  decision is made on the audio clock when the key is pressed (start and stop beats passed to the engine and the
  recorder with `at`), never in a frame callback, which a background tab stalls [proto].

### 9.5 Everything else a new field touches

- `cleanProject` normalises `room` and `sheet` (`cleanRoom`, `cleanSheet` in `app/src/core/liveroom/model.js`):
  plain text, finite numbers, ids as strings, `room.tracks` naming tracks that exist, `room.parts` naming sections
  that exist, unknown keys kept (so a newer reader's fields survive an older one's round trip), within the caps.
- `LIMITS` and `songSize` (`app/src/core/project.js:282`): sheet sections ≤ 64, lines ≤ 400, characters ≤ 24,000;
  `room.parts` ≤ 512 entries; `room` ≤ 64 KB as JSON. A share link can't carry a novel.
- `signGuest` (`app/src/core/share.js:238`) signs the sheet's lines as the guest, so a link can't pass a guest's words
  off as anyone else's.
- `summarize` (`app/src/core/project.js:490`) gains a line each for agents: *room: the metal club, drop C, Tight.
  Parts: Intro 4 (Build, left only), Verse ×2 8 (Your chugs, both sides), Chorus 8 (Open, left only) …* and *sheet:
  capo 3 (sounds in B♭), 3/4; Verse 1, 4 lines …*.
- The DAWproject export already writes sections as markers (`app/src/core/dawproject.js:224`); the sheet can follow
  later.

### 9.6 Session state, storage and the door

- **`ui.state.liveRoom`** (not `room`, which the Jam room owns, `app/src/ui/jam.js:1054`): `{ open, screen: 'door' |
  'stage' | 'shelf', card, menu, run: 'idle' | 'count' | 'take' | 'learn' | 'play', side: 'L' | 'R' }`. Everything
  else transient (preview handles, the pixel feed) stays private to its module. Nothing lives in the DOM.
- **`overdub:room`** (localStorage, new, forever): `{ v: 1, side: 'room' | 'control', place, outputs: { [output
  label]: 'headphones' | 'speakers' }, said: { [songId]: [line ids] } }`, per browser. `said` keeps the once-only
  lines (Lay it out, the finish, the backup, *use take 2*) from coming back after a reload, for the last 50 songs,
  without writing a step into the song.
- **`overdub-shelf`** (IndexedDB, new, forever): one record per room song, `{ id, song, at, title, place, finished,
  bytes }`, written on the room's autosave beside `overdub:project`. Recent stays the control room's.
- The prototype's sessionStorage flag `overdub:liveroom` never shipped, so it goes.
- **`decideDoor({ search, hash, saved, room, webdriver })`** (pure, `app/src/ui/liveroom/door-decide.js`) returns
  `{ side: 'room' | 'control', song: 'new' | 'saved' | 'demo' | 'shared' }` by the table in §2.1, and `main.js`
  follows it before the shell is built.

---

## 10. Copy

The italic lines in §3 to §7 are the copy. Each lives once, as `{ id, text(vars), once? }`, in the file of the stream
that says it (`app/src/core/liveroom/lines/*.js`), so the room's whole voice can be read in one folder and checked as
one (§11.9). A line with `once` is said once per song (once per browser for the door's), remembered in `overdub:room`
`said`, never as a step in the song.

### 10.1 The rules

1. **The engineer behind the glass.** Calm, quick, a little dry. What was recorded, then what changed, then the
   number: *Chorus is in: the drummer opened up on the crash. 8 bars.*
2. **Two sentences at most** in the talkback (the tape box's note: three). Between passes, never during one.
3. **A question is an offer** with its buttons beside it, and the offered move is Space. Nothing asks twice.
4. **Numbers the musician uses**: bars, BPM, milliseconds, minutes, dB at the input, megabytes. In the mono face, with
   a real minus (−) and a space before the unit.
5. **The band are their roles and their gear** ("the drummer", "the bass", "Rusty Sticks"). They don't speak, have no
   names, faces or moods; the engineer says what they did.
6. **No grades.** The room says where two takes differ, in milliseconds and by bar, and never which take is better,
   that you did well, or by how much you'd improve.
7. **Unsigned house, signed agents.** The house's lines carry no name; an agent's line carries its byline in cool ink.
8. **Whimsy on the walls**: kick heads, place names, the tape box. Buttons say what they do.

### 10.2 The never-says list

The check fails on any of these in a line (as words, in any case):

| Kind | Words |
|---|---|
| The machinery | detect, detected, auto, automatic, AI, smart, magic, algorithm, recognise, recognize, onset, chroma, analyser |
| The control room's words, on the room's side | LUFS, compressor, EQ, bus, insert, automation, quantize, latency, plug-in, gain staging, true peak |
| Grades | perfect, great, awesome, amazing, nailed, good job, well done, score, accuracy, rating, stars, percent about your playing |
| Alarm | error, failed, failure, oops, sorry, warning, wrong; red anywhere in the room |
| School | tutorial, lesson, step 1, level up, unlock, achievement, streak |
| People who aren't there | crowd, fans, audience, bandmate, any name for a player |
| Code | sandboxed, secure (kernels are code from whoever wrote them, CLAUDE.md) |
| Punctuation | exclamation marks, emoji |

Allowed and used: *learning*, *read* (*The band's read it*), *heard*, *in*, *lined up*, *ready*, *the other side*.

### 10.3 Where each line lives

| File (owner) | Lines |
|---|---|
| `lines/soundcheck.js` (A) | plug.ask, plug.ok, plug.nothing, plug.refused, plug.mic, plug.direct (once), level.ok, level.hot, level.clip, level.quiet, tune.ask, tune.ok, tune.which, tune.off, line.ask, line.ok, line.long, line.output, line.lean (once per song), ready.back, kit.loading, kit.offline (once), take.short, take.esc |
| `lines/double.js` (B) | learn.got, learn.thin, side.now, side.tight, side.fine, side.drift, side.punched, side.wander, side.use2 (once per part), side.intro (once), side.both, guide.held, guide.drifts, feel.named, busy.simpler, busy.busier, loud.softer, loud.louder, finish.offer (once), finish.chosen, bass.yours |
| `lines/stage.js` (C) | before.tempo, part.in, next.in, again.in, twice.in, loop.on, moved, shorter, removed, layout.offer (once), end.follows, hear.done, hear.empty, back.where, back.assets |
| `lines/glass.js` (C) | glass.job (once per job), glass.back, glass.levels (once per track), glass.drums.edited, glass.amp.yours, glass.master.yours, glass.tempo (once), glass.meter (once), glass.track (once per track), glass.nofeel |
| `lines/kitchen.js` (D) | k.how, k.phones, k.speakers.wait, k.balance.strum, k.balance.sing, k.balance.ok, k.balance.guitar, k.balance.voice, k.balance.skip, k.browser (once), k.solo.direct (once), k.paper.blank, k.paper.read, k.paper.fromtake, k.tape.start, k.take.in, k.time.read, k.time.moves, k.time.speakers, k.chords, k.form, k.unknown, k.capo.after, k.offer.shaker, k.offer.cajon, k.offer.bass, k.offer.strings, k.player.in, k.master, k.both.or.voice, k.pickup.needed |
| `lines/door.js` (F) | door.ask, door.nogtr, door.house, door.local, door.phone.iface |
| `lines/shelf.js` (F) | shelf.backup (once per browser), shelf.safari, shelf.space, shelf.remove.ask, shelf.done, send.mix, send.song, send.saved, note.* (the tape box's note, written from the song) |

---

## 11. Checks

Nobody building this can listen, so every part is held by a check that measures or a flow that plays it. Every check
runs in Node or in muted headless Chromium: `tools/pw.js` launches with `--mute-audio` and feeds a WAV as the
microphone (`--use-file-for-fake-audio-capture`), so nothing reaches a speaker. A fake guitar is a synthesized DI
(the metal fixtures in `tools/fixtures/metal-di/` and the Karplus-Strong riffs the prototype's test already makes,
`tools/liveroom-test.js:167`); a fake voice is a seeded formant voice; a fake work tape mixes the two. None of this runs
`tools/run-all.js`, `tools/compat-test.js` or `tools/phone-test.js` on AJ's computer.

**Where they live.** One suite, `node tools/liveroom-test.js` (the `liveroom` suite, so the suite count stays 90),
becomes a runner over `tools/liveroom/checks-*.js`, each exporting `{ name, pages, run(T, ctx) }`, run in order:
`ONLY=band,stage` runs some, `PAGES=0` skips the browser, `LEVELS=0` skips the renders. Pure logic also gets unit
tests in `test/unit/liveroom-*.test.js`, which CI runs. The op round trips go where every op's already are.

**Lining a fake guitar up with the band.** Chromium's fake capture plays its file from when the input opens, on its
own clock. A check builds one WAV for the whole session from a script (each pass's riff, at the bars it should land
on, with seeded timing), reads the audio-clock frame of the first captured block (`audio.listen`, §9.4), and starts
each count with `engine.play`'s `at` so the script's bar 1 meets the band's. The latency is set to 0
(`audio.latency.set`), so a take's placement is exactly the script's.

### 11.1 The song model (the foundation)

- Every new op, in `test/unit/ops.test.js`'s table and `tools/core-test.js`'s trials: applied, inverted and applied
  again gives the song it started from, deep-equal; redo gives the applied song. Both refuse an op type they don't
  cover, so all ten are in both.
- `section.move` (`tools/arrangement-test.js`): a part moved before another, to the end and back keeps its section id,
  its `room.parts` entry and every clip id inside it; a clip across its edge is split first, as `section.duplicate`
  splits; a move inside a tempo map is refused; one undo puts everything back.
- `section.duplicate` copies the `room.parts` entry to its copy.
- `cleanProject`: a song with `room` and `sheet` survives save and load; unknown keys inside both survive; bad values
  are cleaned (non-finite numbers, ids that aren't strings, a `tracks` role naming no track, a part naming no
  section); the caps (§9.5) cut and warn.
- An older reader: the same song with and without `room` and `sheet` renders to the same hash.
- `signGuest` signs the sheet's lines as the guest.
- `store.redo` keeps a step's reason.
- Nothing else moved: `tools/golden-test.js` unchanged, every existing suite that touches ops passes.

### 11.2 Sound (Node, the canonical renderer)

- Every row of §4.6's table, rendered through `renderSong` and measured with `measure`: the guitar pair 3 dB over the
  band (±0.5), the drums 3 dB over the bass (±0.5), the sides within 0.5 LU, the pair within 1 LU of one centred take,
  every rig within 0.25 dB of the place's first, *Tight* in `checkTargets(m, 'metal', { window: 'song' })`, *Loud*
  about 2 LU over *Tight*, every finish at −1 dBTP or under. The numbers are printed, so a change says what it moved.
- The same for the basement, the blues bar and the kitchen: each finish in its window, the kitchen's players at −12,
  −12, −9 and −14 LU under the take (±1), the acoustic targets for *Bare*, *Warm* and *Close*.
- The faders' slope: the reference DI at −18, −12 and −6 dBFS through each rig, the slope printed and the room's
  fader table within 0.5 dB of it.
- *Busier*, *Louder* and their opposites: each step moves the drums 2 LU (±0.75).
- Every feel id resolves to a groove that exists in its bank at the part's tempo; every place's feels exist.
- The velocity house rules: no run of more than four hits at full velocity, ghost notes between 0.15 and 0.4, and
  `realize` without `rules` unchanged (every golden hash holds).
- The right side's cab per rig (§4.1), and the right side's LEVEL setting the pair within 0.5 LU.
- Determinism: the same song renders the same hash twice, and the same read and seed give the same band.
- `room:metal`, the one new golden scene, added with `UPDATE_GOLDEN=room:metal`.
- The count's sticks: rendered in Node and in the page to the same samples, heard live only (a song's render has no
  count, so its hash doesn't change with the count's voice).

### 11.3 The read and the double (Node)

- `readTake` on fixture riffs (chugs, chords, tremolo; at 90, 132, 160 and 200 BPM; E standard, drop C and B
  standard; ±10 ms of seeded jitter and an 8 ms latency error): the kick within 15 ms of the played chug on at least
  95% of chugs and never on a note that isn't one; the bass's root the played lowest note on at least 90% of beats;
  the key's root right on every fixture.
- A thin read (a clean arpeggio with fewer than 8 onsets on the grid) says so, and the drummer keeps the groove's own
  kick.
- The pair: two performances with known per-bar offsets (all within 8 ms; one at 14; bar 5 at 30 late; drifting from
  bar 3) give the right line each time, naming the bar and the milliseconds within 5 ms.
- `planDouble`: the pans, the pan lane, the intro on one side, and the right side's chain.
- The bench (`node tools/liveroom-bench.js`, not a suite) prints the read's accuracy on every fixture and, when they
  exist, on AJ's own DIs in `tools/.out/liveroom-di/` (§13).

### 11.4 The offered move and the press counts (Node)

`session.js` is a pure reducer, so each path is a list of presses run against it, and the counts are pinned: a
release that adds a press fails until the count is changed on purpose.

| Path | Presses | |
|---|---|---|
| The metal club: two parts, both sides, laid out, heard, sent | 12 | §2.3 |
| The basement: two parts, the chorus doubled once offered, laid out, heard, sent | 10 | door, Allow, count, stop, next part, stop, the other side, lay it out, hear it, send |
| The blues bar: a head and a solo, laid out, heard, sent | 9 | door, Allow, count, stop, next part, stop, lay it out, hear it, send |
| The kitchen table: a work tape, the chords, a shaker, sent | 8 | §2.5 |

And: the offered move is the first rule of §7.4 that applies, after every kind of step, for every place; a line with
`once` never comes back; the stop rule (pressed in a bar's first beat: the line just gone; later: the next) at every
place; the blues bar's chorus rule.

### 11.5 The input and the deck (muted Chromium)

- The channel: a fake interface WAV with the guitar on channel 2 and nothing on 1 picks input 2. If Chromium's fake
  capture won't deliver two channels, the pick is held in Node on synthesized per-channel levels and the page check
  covers one (§13).
- The lamps: fakes peaking at −31, −11, −2 and 0 dBFS give *Quiet*, *Loud and clear*, *Hot* and *That clipped*; open
  low strings at E2, D2, C2 and B1 give *In tune: E standard*, then the two-way questions; a C2 20 cents flat gives
  the tuning line after six notes.
- The count: four sticks at 132, eight at 160, the basement's two-bar count, each on the audio clock within one
  render quantum of its beat.
- The stop: Space at beat 0.5 of bar 9 makes an 8-bar part; at beat 2 of bar 9 a 9-bar part; the take keeps a bar of
  ring past it.
- Esc during a take: nothing in History, the pass in Capture; ⇧R puts it in at the bars it was played.
- Every audio take's `asset.add`: the song lists the take with its rate, channels and length.
- A stop pressed while the page's frames are stalled (an emulated hidden tab) still ends on the bar line.
- Two inputs: a stereo fake with a voice on 1 and a guitar on 2 makes two takes on two tracks, lined up within a
  sample, in one step by you.

### 11.6 The stage (muted Chromium, a fake guitar)

- **The metal club, the whole first session** (§2.3), scripted: lamps, count, verse, learning, the other side with a
  second performance, the chorus, Lay it out (61 bars, 1:51), hear it all, a finish, a send. After each step: the
  song's sections, the tracks and their signatures, History's steps and who made them (*Verse take 1* by you, *The
  band learned the verse* by the house), the kick within 15 ms of the fake riff's chugs, the talkback's line.
- **⌘Z in the room** undoes a take and its learning in one press and says what went; ⇧⌘Z redoes both; with an agent's
  edit between them (dispatched as `mcp:test`) the learning is undone alone.
- **The menu**: every item is one step, by the right author, and undoes exactly: Again, the other side, another feel,
  Simpler, Louder, ×2 (16 bars, the takes repeated), Round and round, Name, Earlier (ids kept), Shorter, Remove,
  Play the bass yourself.
- **Keys**: every key in §3.17 is declared through `ui.keys.add` with the room's `when`; under the room the studio's
  single keys do nothing; PageDown counts in and ends a take; a sustain-pedal press arriving as the input layer's
  `expr` event (`app/src/input/midi.js:13`) does the same.
- **The glass**: G and back; going through leaves History as it was; while the room is open the studio's panels don't
  paint (`ui.covered`) and while the control room is open the room's frame doesn't run; an edit made in the control
  room is said on the way back, signed when an agent made it.
- **Layout**: at 1440 × 900, 1280 × 800 and 390 × 844 the page doesn't scroll sideways, the scene sits at a whole
  scale, targets are 44 px or more on the phone, text 12 px or more and fields 16 px; screenshots in `tools/.out/`.
- **Reduced motion**: nothing pans, sways or shakes; the lamps still light.
- **Access**: the talkback is a polite live region, the scene is `aria-hidden`, every action is a named button, and
  focus never lands under the overlay.
- No page errors in any flow.

### 11.7 The kitchen table (Node and muted Chromium, a fake voice and guitar)

- **The paper** (Node): ChordPro and chords-over-words fixtures read into sections, lines and anchored chords;
  `format(parse(x))` is stable; capo 3 on G shapes sounds in B♭; Nashville numbers read; a chord that doesn't parse is
  kept as text and marked; a line edited with chords around it keeps each chord on its syllable.
- **The time** (Node): the analyser on synthesized strummed takes (72-120 BPM, drifting up to 4%) reads the tempo
  within 3%, or offers it as *Twice as fast* or *Half as fast*; a take in free time over 20% says so.
- **The chords** (Node): the paper's chords aligned to the same takes with a voice mixed in at +5 dB put each change
  within a beat of where it was played on at least 90% of changes; a chorus played twice offers *Chorus ×2*; a section
  skipped is skipped; nothing plays where the paper has no chord.
- **The flow** (Chromium): §2.5 end to end with a fake laptop mic: the mic picked, the headphones question, the balance
  line from a fake at +5 dB (*Good*), a pasted sheet, the tape, the read, the time confirmed, the chords line, the
  shaker kept, a finish, a send: 8 presses. On speakers, nothing plays during a take.
- **Signing**: a line you edit is yours, a line an agent edits (`sheet.line.set` from `mcp:test`) carries its byline
  in `--ink-agent`, the house's chord lines are unsigned; every step's author in History.

### 11.8 The door, the shelf and sending (Node and muted Chromium)

- **`decideDoor`** (unit test): every row of §2.1.
- **The door** (Chromium, `navigator.webdriver` set false in an init script): a first visit to bare `/app/` shows the
  door and `#studio` is never visible before the room mounts; coming back after the room opens the room, after the
  control room the control room; `?studio`, `?demo`, a share link and Flip open the control room; under webdriver,
  bare `/app/` and `?new` open today's first screens (the other suites hold the rest of that).
- **The shelf**: a room song's record is written on its autosave; two room songs and two Recent songs show as boxes in
  order; a box opens its song in the room; *Take it off the shelf* deletes only recordings no other song here uses;
  `persist()` is asked once at the first kept take; an 80% estimate gives the space line (both stubbed).
- **Send a mix**: a 16-bit 48 kHz WAV from the first sound to the end of the tail, muted tracks out, within 0.1 LU of
  the canonical render; through the share sheet when `navigator.canShare` says yes (stubbed), else a download.
- **Send the song**: the zip holds the song and its recordings as 32-bit float WAVs; opened with ⌘O in a fresh browser
  context it restores every recording bit for bit and opens the room.
- **The tape box**: its label from the song, its note from the song, and the same three titles from the dice for the
  same song.

### 11.9 Copy and agents (Node and muted Chromium)

- **Copy**: every line in `core/liveroom/lines/*.js` passes §10.1 and §10.2 (no never-says word, two sentences at
  most, no exclamation marks or emoji, a real minus, house lines unsigned); every line id the room's code says exists,
  and every line defined is said somewhere.
- **Agents**: `get_project`'s summary has the room's and the sheet's lines; `apply_ops` takes the new ops, signed by the
  agent; `section.move` waits while a take records (it moves time); the in-app agent's `say` appears in the talkback
  with a *Claude* byline; the tool count stays 40.
- **Docs**: `node tools/docs-build.js` leaves nothing stale, and `tools/pages-test.js` passes with the new copy (GUIDE,
  ARCHITECTURE's op table, the site's line about the song the studio opens with).

### 11.10 What no check here can hold

The read on AJ's real guitar through the Scarlett, the feel of the delay in AJ's headphones, whether the double's
thresholds match what AJ hears as tight, and whether the room is fun. Those are AJ's, on
`next.overdubstudio.com` before the merge (§13, §14).

---

## 12. The prototype: what stays, what changes, what goes

| | |
|---|---|
| **Stays** | The places' data (`PLACES`, `RIGS`, `rigChain`, `rigLabel`), moving to `core/liveroom/places.js`; the room's ear (`earOf`) and the chug rule; the bass's three modes and the twelve-bar form (`chordAt`); the pixel scenes, their palette and scale rules (`ui/liveroom-pixels.js`, moving to `ui/liveroom/pixels/`); the overlay over an inert studio; the tap line-up; the rigs' level check and the reference-DI measurement; the kick heads; `?room` as the room's own door for checks |
| **Changes** | Gobo Kit kit 5 becomes Rusty Sticks into Drum Riser at the metal club; Flatwound becomes Roundwound into Y Cable; the basement's and the blues bar's tempo ranges match their banks; the band's tracks are made once per song (role tracks), never per take; the band during a pass is a preview; the soundcheck and the take are one screen, not two; the amp's label is drawn from the song; the studio's *Live room* key grows from 30 to 40 px; decisions are made on the audio clock at key time, never in a frame; `tools/liveroom-test.js` becomes the runner of §11 |
| **Goes** | The riff finder and everything built on it (`findRiff`, `riffFromTaps`, `fitsRiff`, `nextEntry`, the live finder in the page and its copy); the *What did you bring?* screen; *Give me a beat*; the 40-second ring buffer; `land()` at beat 0; per-take band tracks (`bandOps` as written); the breathing sine on the door; the pop sent straight to `ctx.destination`; the sessionStorage flag `overdub:liveroom`; Esc throwing a take away; the bench's detection scoring and the test's riff-finding sections |

Also cut from the three designs, each for the reason given in §1.3 or here: *I'll start, you follow* (#3); an
always-rolling tape and ⇧R from it (#21); tapping the lines of a work tape (#15); silence ending a take (#5); a trim
param on Half Stack (#20); ranking the spare passes (*pass 2 sits tighter*, #9); quad tracking, a metal lead track, a
dropped-in WAV as a part, a librarian, the shelf's hover preview, a compressed mix, hosted recordings and help with
words (later decisions, each its own spec); punches inside a kitchen section (#16); 7- and 8-string tuning ids (an id
is forever, so they wait until the bass and tab handle more than six strings); a share link for a room song (§3.14);
the band ways (*band out*, *stops*, *tap the kick*, extra bass ways); a mirror of the setlist in pixels; a new *Lift*
groove for pre-choruses (the existing grooves cover it, §4.4).

---

## 13. Risks

| Risk | What holds it | Who |
|---|---|---|
| The read on AJ's real guitar. Every fixture is synthesized; a real DI through a Scarlett has noise, string squeal, uneven palm mutes. | A thin read still gives a band (the groove's own kick). Before the merge, AJ records a few riffs at the metal club; *Send the song* zips their DIs; the bench (`tools/liveroom-bench.js`) reads them from `tools/.out/liveroom-di/` and the thresholds move only if it says so. | B, AJ |
| The analyser on a laptop-mic work tape (rubato, voice over strums). | The time is confirmed by ear, never trusted; the other way in (Count me in on headphones) is one press; free time over 20% says so. | D |
| Chord alignment with a voice in the same mic. | Only the change points between the paper's own chords are read; nothing plays a chord the paper doesn't have; the check mixes a voice at +5 dB; a section that won't align plays the chords at the read's bar lines in the paper's order, dotted until heard. | D |
| The double's thresholds (20 ms, a quarter of a sixteenth, 30% unmatched) come from the literature, not AJ's ear. | Calibrated on AJ's doubles before the merge; the numbers are constants in `tight.js`, printed by the bench. | B, AJ |
| Chromium's fake capture: one file, its own clock, maybe one channel. | The check aligns the script to the first captured frame (§11); if two channels don't come through, the two-input split is held in Node and the page check runs on one, said in the check's output. | A |
| Two inputs on AJ's Scarlett Solo: input 1 is a mic, input 2 an instrument jack, and AJ has no pickup yet. | The option says *needs a guitar with a pickup* until both channels move; the one-mic path is the default; the two-input path is checked with fakes only until AJ has a pickup. | A, D |
| The front door changes the first screen for everyone at the next deploy (merged means shipped). | It ships on `next.overdubstudio.com` first (`deploy/deploy.sh --next`); AJ plays it there before the merge to `main`. The webdriver gate keeps every other suite on today's screens; the anti-flash rule keeps the studio from showing first. | F, AJ |
| Storage: takes are megabytes, browsers evict (Safari after a week away for script-written storage). | `persist()` at the first kept take, the space line at 80%, the backup offered once, *Send the song* as the backup; the shelf says what removal deletes. | F |
| The public counts. The private repo's drafts say 84 suites and 8,921 checks; the tree has 90 suites; pages-test holds them when the private repo is present. | No new top-level suite. G lists the lines in `overdub-private` that need the new counts and doesn't edit that repo; the counts come from a full run AJ starts somewhere sound is allowed. | G, AJ |
| Chrome 155 drops a `setValueCurveAtTime` curve on a node that hasn't rendered yet (the dry-amp bug). | The room's ramps (the pan lane's 20 ms steps, previews, the count) use `setTargetAtTime` or `linearRampToValueAtTime`; the stage flow runs once more on AJ's installed Chrome, headless and muted (`CHROMIUM=` the installed Chrome). | A, C |
| Rusty Sticks is 24 MB; a slow connection meets the count first. | Prefetched at the door; the count waits with the kick head's percentage; offline, Gobo Kit, measured too. | B, C |
| Delay in AJ's headphones. | Monitoring through the amp and the master adds about 2.4 ms on top of the interface; the line-up; the wired-headphones line over 25 ms; the browser's output latency said when it's long. | A |
| CPU: the read and the analyser on phones; the overlay over the studio. | Both run in Workers; the studio's panels don't paint under the room (`ui.covered`); the scene is 256 × 144 drawn at a whole scale. | B, C, D |
| Undo pairs broken by an edit in between. | The learning is undone alone and the line says what's left; History stays exact either way. | C |
| The golden scene needs the metal kit in Node and was made on Apple Silicon with Node 24. | Only `room:metal` is added, with `UPDATE_GOLDEN=room:metal`, on AJ's kind of machine; the commit says which and why. | B |
| Safari and Firefox (Workers, IndexedDB, the share sheet, capture constraints). | `tools/compat-test.js` and `tools/phone-test.js` make sound, so they run where sound is allowed (CI or AJ), not on AJ's machine by an agent. | G, AJ |

---

## 14. The build

One foundation agent works on `live-room` first. Then seven streams, each in its own git worktree off `live-room`,
build in parallel against the foundation's frozen seams, and merge back in the order A, B, E, C, D, F, G. Every file
has one owner. A stream that needs a change to a file it doesn't own writes it into its report for the orchestrator
instead of making it.

### 14.1 The foundation

It lands the parts every stream shares, and nothing else:

- **The song**: `store.redo` keeps a step's reason; `core/liveroom/model.js` (`cleanRoom`, `cleanSheet`, the forever
  ids: places, rigs, finishes, feels, roles; the caps); `room-ops.js` and `sheet-ops.js` (the nine room and sheet ops)
  registered in `ops.js`; `section.move` in `arrangement.js`, and `section.duplicate` copying `room.parts`; `describe`
  labels in `store.js`; `cleanProject`, `LIMITS`, `songSize` and `summarize` in `project.js`; `signGuest` in
  `share.js`.
- **The tests for it**: `test/unit/ops.test.js`, `tools/core-test.js`, `tools/arrangement-test.js`, a new
  `test/unit/liveroom-model.test.js`, and `tools/liveroom/checks-model.js` (§11.1).
- **The skeleton**: every module of §14.2 created with its frozen exports, inert where its stream will fill it in, so
  the page loads and every stream can import every other. A working minimum where streams meet: `ui/liveroom/index.js`
  registers the panel, the overlay over an inert studio, the screens registry, `ui.state.liveRoom`, `app.liveRoom`, a
  plain talkback and the room's held keys; `ui/liveroom/prefs.js` owns `overdub:room`.
- **The shell's seams**: `ui.covered` in the shell's loop (`app/src/ui/shell.js:369`), the onboarding tour waiting
  while the room is open (`app/src/ui/onboard.js:93`), the anti-flash rule in `app/style/app.css`, and `main.js`
  loading `./ui/liveroom/index.js` and asking `decideDoor` (stubbed to today's first screens plus `?room`).
- **The prototype's keepers moved, its finder cut** (§12); `tools/liveroom-bench.js` stripped of the finder.
- **The runner and the fakes**: `tools/liveroom-test.js` over `tools/liveroom/checks-*.js` (the prototype's band and
  level checks moved into `checks-band.js`); `tools/liveroom/fake.js` (a DI riff, strums, a voice, a mix, a stereo
  pair and a whole-session script, each seeded); `tools/liveroom/harness.js` (open the room, line a script up with the
  count, read History, press keys); an `init` option on `tools/pw.js` for an init script.

### 14.2 The frozen seams

| Module (owner after the foundation) | Exports |
|---|---|
| `core/liveroom/model.js` (frozen) | `PLACE_IDS`, `RIG_IDS`, `FINISHES`, `FEEL_IDS`, `ROLES`, `ROOM_LIMITS`, `cleanRoom(x, { tracks, sections, warn })`, `cleanSheet(x, { warn })`, `roomOf(p)`, `partOf(p, section)`, `sheetOf(p)`; and `NAMES` (each id's words: `{ place, feel, finish, rig }`), `ORDER` (the canonical key order of the room, a part, a take, a managed entry, the sheet, a sheet section, a line), `putKey(obj, key, value, order)`, `placeKey(obj, key, value, at)` (the ops' key order, so an inverse is exact) |
| `core/liveroom/room-ops.js`, `sheet-ops.js` (frozen) | `ROOM_OPS` and `SHEET_OPS`: the ops of §9.2, assigned into `OPS` by `ops.js` |
| `core/liveroom/places.js` (B) | `PLACES`, `placeOf`, `RIGS`, `rigChain(rig, side)`, `rigLabel`, `setupOf(place, { tuning, finish })` → `{ tempo, meter, grid, count, tracks, master, feels, form, names }` for the three electric places (the kitchen's is D's `kitchenSetup`), `feelsOf(place, part, tempo)`, `finishChain(place, finish)`; and the prototype's `earOf(sr)` (the note finder's options) and `chordAt(place, riff, beat, from)` (the twelve-bar at a beat). Added (B): `setupOf`'s `rig` option and its `range`, `masterClip`, `finish`, `finishes`, `parts`, `next`, `rigs`, `rig`, `tuning`, `scale`, `kick`, `ending`, `drift`; each track's `role` and `later` (Guitar R and the Lead: made when they're first played); `grooveOf(place, feel, tempo)`, `follows(feel)`, `partKey(name)`, `fillsOf(place, tempo)`, `finishBus(place, finish)`, `guitarChain(rig, side, tuning)`, `guitarGain(place, rig, peakDb)`, `bandTracks(place)`, `chainHash(inserts)`, `gtrEq`/`lowCut(tuning)`, and the tables `FEEL_GROOVES`, `FEELS`, `FILLS`, `FADERS`, `WINDOWS` |
| `core/liveroom/read.js` (B) | `readTake(samples, sr, { tempo, start, bars, grid, latency, place })` → `{ notes, chugs, roots, key, lean, cents, thin }`; `readInWorker(…)` → Promise of the same (`read-worker.js`, the module Worker, exports nothing). Added (B): the read's `low`, `level`, `onsets`, `steps`, `beats`; each note's `ms`, `v`, `db`, `hz`; `riffOf(notes, { beats })`, `attacksOf(samples, sr, { tempo, start, bars, grid, latency })` (for `tight.js`), `hear(samples, sr)`, `earOf(sr)` (`places.js` re-exports it), and the constants `SNAP` (0.4 of a step) and `THIN_ONSETS` (8) |
| `core/liveroom/band.js` (B) | `guideOps(p, { section, from, bars, feel })` (the pass's preview band), `planLearn(p, { section, read })`, `planFeel(p, { section, feel, busy, loud })`, `planFinish(p, { finish })`, `planBassYours(p, { section })`, each → `{ ops, label, reason }`; and the prototype's `bandFor(place, riff, { from, length, seed })` → `{ drums, bass, from, length }` (the band's notes under a riff: the chug rule, the bass modes). Added (B): `planLearn` also → `{ thin, kicks, bass, feel, kept }`; `planFeel` takes `force` and → `{ ops: [], edited: true }` when the part's drum clip is someone else's; `bandNotes(p, section, { feel, busy, loud, riff, seed })`, `riffIn(p, section)` (a part's Riff (as heard) clip read back: a palm mute is a note under `MUTE_V`, 0.35, as DI Box plays one), `guideOf`, `defaultFeel`, `isHouse`, `HOUSE_RULES`, `TOUCH` (the drummer's touch per step, measured) |
| `core/liveroom/tight.js` (B) | `measurePair(left, right, { sr, tempo, start, bars, grid })` → `{ perBar, median, drift, unmatched, verdict }`. Added (B): the verdict `'fine'` (no bar drifts, one over 10 ms); the options `place` and `limit`; the result's `limit`, `worst { bar, ms, dir }`, `from`, `drifting` and `line { id, vars }` for `lines/double.js`; the constants `LIMIT_MS`, `BASEMENT_MS`, `TIGHT_MS`, `UNMATCHED`, `MATCH_MS`, `REFINE_MS` |
| `core/liveroom/double.js` (B) | `planDouble(p, { section })`, `planUseAsRight(p, { section, clip })`. Added (B): `planPans(p)` (Guitar L's pan lane as the song stands: the stage joins it to a right take's step), `panLaneOps(p, { both })`, `sidesOf(p, section)`, `roleTrack(p, role)`, `PAN_RAMP` |
| `core/liveroom/session.js` (C) | `readRoom(p)` → the room's view; `offered(view, run)` → `{ id, label, key }`; `stopBeat(view, beat)`; `press(state, id)` (the reducer the press counts run on) |
| `core/liveroom/plans.js` (C) | `planPlace`, `takeOps`, `planLayout`, `planTwice`, `planMove`, `planShorter`, `planRemove`, `planEnd` |
| `core/liveroom/sheet.js` (D) | `parseSheet(text)`, `formatSheet(sheet, { as: 'chordpro' \| 'text' })`, `lineParts(text)`, `soundingKey(sheet, p)`, `transposeChord(sym, semis)` |
| `core/liveroom/align.js`, `kitchen.js` (D) | `alignChords(chroma, beats, chords, opts)`; `kitchenSetup({ mic })`, `planRead`, `planTime`, `planPlayer`, `planMaster`, `planKitchenFinish`, `offeredKitchen(view, run)` |
| `core/liveroom/label.js` (F) | `labelOf(p)` → `{ title, slate, parts, note, cover }`, `titleDice(p)` → three titles |
| `core/liveroom/lines/*.js` (each its stream's) | `LINES`: `{ [id]: { text(vars), once? } }` |
| `ui/liveroom/index.js` (C) | the default export installs it (`app.liveRoom` = `{ isOpen(), busy(), open({ screen }), close(), say(text, { by }), selection(), press(id), on(evt, fn) }`); `screens`, re-exported; `ctx` = `{ app, ui, store, deck, view(), say(lineId, vars), prefs, scene }` |
| `ui/liveroom/screens.js` (C) | `screens`: `add({ id, mount(el, ctx) → { frame(now), unmount(), press?(id) } })` → remove, `get(id)`, `has(id)`, `list()` (the registry `index.js` re-exports; a screen's optional `press(id)` is what `app.liveRoom.press` asks first) |
| `ui/liveroom/prefs.js` (frozen) | `prefs.get()`, `prefs.set(patch)`, `prefs.said(song, id)`, `prefs.mark(song, id)` over `overdub:room` (`prefs.key`) |
| `ui/liveroom/deck.js` (A) | `createDeck(app)` → `{ state, on(evt, fn), countIn({ from, bars, voice, hits, at }), take({ track, from, punch, tail, lead, join }), stop({ at: 'bar' \| 'now', to, beat, keep: 'song' \| 'capture' }), keepAfterAll(), level(), tuner(), latency, stopBeat }` (one deck per app: `createDeck(app)` again gives the same one); countIn's `from`: the downbeat the count (or, voice `'none'`, the song's own bars before it) leads into; take's `punch`: `{ from, to }`, `lead`: seconds kept before `from`, `join`: a step the take's commit joins; stop's `to` or `beat`: the beat the stop lands on instead of the key's; `stopBeat`: null or the stage's stop rule `(beat, { from, bpb }) → beat` (`session.js` `stopBeat`, stream C's), which C sets; a landed take (`stop` with `keep: 'song'`, `keepAfterAll`, and a punch's, by its promise or the deck's `'take'` event) is `{ ok, txn, take: { track, clip, asset }, takes, from, to, quietLead }` (`txn`: the recorder's step, which the stage joins its part's ops to); `{ ok, empty, line }` under a bar, `{ ok, cancelled }` stopped in the count |
| `ui/liveroom/soundcheck.js` (A) | `mountLamps(el, ctx)` → `{ frame(now), unmount() }`, `lampsState()` |
| `ui/liveroom/pixels/index.js` (E) | `W` 256, `H` 144, `LEDGE` 14, `sceneOf(place)` → `{ draw(ctx, view, now) }`, `drawCrop(ctx, place, size, view?)` (still without a view; a focused card passes one so its bar's hits move it), `drawCover(ctx, cover, size)` (cover: `{ title, key, tempo, bars }`, bars an array of each bar's fill in 0..1 or a count), `windowFor(view)`; drawn with `fillStyle`, `fillRect` and `globalAlpha` only, as the prototype's are, so a Node check draws them into a buffer. The view is `readRoom(p)` plus what's live (`live: { input, L, R, kick, snare, hat, crash, tom, bass, shaker, cajon, master }` in 0..1, `run`, `rolling`, `beat`, `bar`, `count`, `loading`, `side`, `doubled`, `plugged`, `learning`, `talk`, `ending`, `heard`, `title`, `invited`, `reduced`, `focus`/`step`, `now`), each optional, as `pixels/index.js`'s header says |
| `ui/liveroom/door-decide.js` (F) | `decideDoor({ search, hash, saved, room, webdriver })` → `{ side, song }` |
| `ui/liveroom/shelf-db.js` (F) | `put(record)`, `list()`, `get(id)`, `remove(id)` over IndexedDB `overdub-shelf` |
| `ui/liveroom/send.js` (F) | `sendMix(app)`, `sendSong(app)`; the screen `send` |

### 14.3 The streams

| Key | Stream | Owns | Merges |
|---|---|---|---|
| A | The deck: input, count-in, takes, soundcheck | `input/audioin.js`, `input/recorder.js`, `engine/engine.js`, `engine/click.js`, `ui/liveroom/deck.js`, `soundcheck.js`, `lines/soundcheck.js`, `checks-input.js` | 1st |
| B | The band learns, the double, the sound | `core/liveroom/places.js`, `read.js`, `read-worker.js`, `band.js`, `tight.js`, `double.js`, `lines/double.js`, `core/grooves.js`, `core/fretboard.js`, `tools/jam-test.js`, `test/unit/fretboard.test.js`, `tools/golden-scenes.js`, `tools/golden.json`, `tools/liveroom-bench.js`, `checks-band.js`, `test/unit/liveroom-read.test.js` | 2nd |
| E | The rooms in pixels | `ui/liveroom/pixels/*`, `checks-pixels.js` | 3rd |
| C | The stage: setlist, menu, talkback, the session, the glass | `ui/liveroom/index.js`, `screens.js`, `view.js`, `style.js`, `stage.js`, `setlist.js`, `menu.js`, `talkback.js`, `core/liveroom/session.js`, `plans.js`, `lines/stage.js`, `lines/glass.js`, `checks-stage.js`, `checks-glass.js`, `test/unit/liveroom-session.test.js` | 4th |
| D | The kitchen table | `core/liveroom/sheet.js`, `align.js`, `kitchen.js`, `lines/kitchen.js`, `ui/liveroom/paper.js`, `ui/liveroom/kitchen.js`, `audio/targets.js`, `core/arrange.js`, `checks-kitchen.js`, `test/unit/liveroom-sheet.test.js` | 5th |
| F | The door, the shelf, sending | `main.js`, `ui/liveroom/door.js`, `door-decide.js`, `shelf.js`, `send.js`, `shelf-db.js`, `core/liveroom/label.js`, `lines/door.js`, `lines/shelf.js`, `ui/export.js`, `checks-door.js`, `checks-shelf.js`, `test/unit/liveroom-door.test.js` | 6th |
| G | Agents, docs, the site, the copy check | `agent/*`, `server/mcp.js`, `server/relay-catalog.json`, `docs/GUIDE.md`, `ARCHITECTURE.md`, `BRAND.md`, `AGENTS.md`, `README.md`, `site/*` (and `site/docs/` from `tools/docs-build.js`), `checks-copy.js` | 7th |

### 14.4 Where streams meet

- **The stage holds the others' parts.** C's stage places A's lamps (`mountLamps`), draws E's scene
  (`sceneOf(place).draw`), dispatches B's `guideOps` as a preview at the count and B's `planLearn` after A's deck
  commits a take, and opens F's `send` screen (`app.liveRoom.open({ screen: 'send' })`).
- **The kitchen** registers its screen through C's registry (`screens.add`, frozen) and records through A's deck
  (`countIn({ voice: 'none' })`, `take`). C's `session.offered` hands the kitchen's offered move to D's
  `offeredKitchen`, and C's `planPlace` takes the kitchen's tracks from D's `kitchenSetup`; the kitchen's finishes are
  D's own (`planKitchenFinish`).
- **The door and the shelf** (F) draw E's crops and covers (`drawCrop`, `drawCover`) and open songs through
  `app.liveRoom.open`.
- **Agents** (G) speak through `app.liveRoom.say` and read the room through `summarize` (foundation).
- **Copy**: each stream writes only its own `lines/*.js`; G's `checks-copy.js` reads them all.
- **The runner** (frozen) finds `tools/liveroom/checks-*.js` by name, so no stream edits it.
- **Generated files** are regenerated on the merged branch, never merged by hand: `server/relay-catalog.json`
  (`node tools/relay-catalog.js`; B's new tunings change `write_tab`'s description, G's tool changes change more) and
  `site/docs/` (`node tools/docs-build.js`, after G). `docs/GUIDE.md`'s tuning list (G's) follows B's tunings.

### 14.5 The gates

- **Each stream, on its branch**: its own checks (`ONLY=<its checks> node tools/liveroom-test.js`), the unit tests,
  `npm run check`, and the existing suites its files touch (named in its plan), in muted Chromium or Node.
- **Each merge, on `live-room`**: the same, plus every stream's checks merged so far, `node tools/golden-test.js`
  (no hash moved but `room:metal`), `node tools/liveroom-test.js` whole, and the generated files regenerated and
  checked (`node tools/relay-catalog.js --check`).
- **On AJ's computer, by an agent**: never `tools/run-all.js`, `tools/compat-test.js` or `tools/phone-test.js`, never
  `SOUND=1`; every other suite one at a time is fine, muted. The full run and the two noisy suites run where sound is
  allowed, started by AJ.
- **Before `main`**: the branch on `next.overdubstudio.com` (`deploy/deploy.sh --next`), AJ's DIs through the bench,
  AJ playing the metal club and the kitchen table on their own gear, the full run, then the merge. Nothing here
  commits on AJ's behalf before AJ says so.

---

## Sources

**Metal**
- [Hudson 2021, "Compound AABA Form and Style Distinction in Heavy Metal", Music Theory Online 27.1](https://www.mtosmt.org/issues/mto.21.27.1/mto.21.27.1.hudson.php): 195 tracks; rotations with a bridge, the buildup intro, breakdowns in the bridge
- [Herbst 2017, the distorted electric guitar in metal, Metal Music Studies 3(1)](https://eprints.hud.ac.uk/33248/): the amp and the double over the guitar
- [Wing, Endo, Yates & Bradbury 2014, "Perception of string quartet synchronization", Frontiers in Psychology](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2014.01115/full), reporting Rasch 1979
- Mark Mynett in Sound On Sound: [Making Modern Metal 1](https://www.soundonsound.com/techniques/making-modern-metal-part-1), [2](https://www.soundonsound.com/techniques/making-modern-metal-part-2), [3](https://www.soundonsound.com/techniques/making-modern-metal-part-3), [Extreme Metal](https://www.soundonsound.com/techniques/extreme-metal)
- Mike Senior in Sound On Sound: [how many guitar layers](https://www.soundonsound.com/sound-advice/q-how-many-guitar-layers-should-use)
- [Jon Tidey, ProSoundWeb: double tracking guitars](https://www.prosoundweb.com/in-the-studio-techniques-for-double-tracking-guitars/); [Hometracked: a doubled track from a mono source](https://www.hometracked.com/2007/06/01/create-a-doubled-stereo-track-from-a-mono-source)
- Toontrack: [EZdrummer 3 and Bandmate](https://www.toontrack.com/product/ezdrummer-3/), [release notes](https://www.toontrack.com/release-notes/ezdrummer-3/); [SOS review](https://www.soundonsound.com/reviews/toontrack-ezdrummer-3)
- Apple: [Session Players (SOS)](https://www.soundonsound.com/techniques/logic-pro-session-players), [follow rhythm](https://support.apple.com/guide/logicpro/follow-rhythm-of-chords-and-other-tracks-lgcpca8dca3d/mac), [editing Drummer](https://support.apple.com/guide/logicpro/edit-a-drummers-performance-lgcp898c7532/10.7/mac)

**Songwriters and the paper**
- [Bennett 2010, Collaborative songwriting](https://researchspace.bathspa.ac.uk/864/1/Bennett%20-%20Collaborative%20Songwriting.pdf); [Yoshida et al. 2026, CoLyricist (IUI '26)](https://arxiv.org/abs/2602.22606)
- ChordPro: [introduction](https://chordpro.org/beta/chordpro-introduction/), [directives](https://chordpro.org/beta/chordpro-directives/), [capo](https://www.chordpro.org/chordpro/directives-capo/); [OnSong flow](https://www.onsongapp.com/docs/flow); [Nashville Number System](https://en.wikipedia.org/wiki/Nashville_Number_System)
- Sessions: [Premier Guitar, Jason Isbell](https://www.premierguitar.com/artists/jason-isbell-brand-new-day); [SOS, Nashville recording](https://www.soundonsound.com/techniques/nashville-recording); [SOS, Dave Cobb](https://www.soundonsound.com/people/dave-cobb); [SongTown, Clay Mills on work tapes](https://songtown.com/?p=2224)
- Recording: [SOS, recording a singing guitarist](https://www.soundonsound.com/techniques/recording-singing-guitarist); [Focusrite, Scarlett Solo hardware](https://userguides.focusrite.com/hc/en-gb/articles/17505454690706-Scarlett-Solo-Hardware-Features)
- Browser audio: [Media Capture Extensions](https://w3c.github.io/mediacapture-extensions/); [MDN, echoCancellation](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/echoCancellation)
- Products: [Apple, Voice Memos layered recording](https://www.apple.com/newsroom/2024/12/voice-memos-update-brings-layered-recording-to-iphone-16-pro-lineup/); [SOS, Music Memos](https://www.soundonsound.com/reviews/apple-music-memos); [Moises chord detection](https://moises.ai/blog/latest/advanced-chord-detection/); chord recognition research: [DECIBEL](https://arxiv.org/pdf/2002.09748) (via summary)

**The whole mode**
- [Simon, Morris & Basu 2008, MySong (CHI)](https://microsoft.com/en-us/research/uploads/prod/2016/02/mysongchi2008.pdf); [Jachimowicz et al. 2019, a meta-analysis of default effects](https://ideas.repec.org/a/cup/bpubpo/v3y2019i02p159-186_00.html) (via summary)
- [Jack, Mehrabi, Stockman & McPherson 2018, action-sound latency](https://qmro.qmul.ac.uk/xmlui/bitstream/handle/123456789/44614/Jack%20Action-sound%20Latency%202018%20Accepted.pdf?sequence=1)
- Apple GarageBand for iPhone: [song sections](https://support.apple.com/guide/garageband-iphone/chs3c3ef5dc/ios), [Drummer](https://support.apple.com/guide/garageband-iphone/chs9692b2133/ios); [iReal Pro, repeats and endings](https://www.irealpro.com/learn/repeats-endings-and-jumps)
- [untitled]: [Dialectic interview with the founders, 2026](https://newsletter.dialectic.fm/p/untitled); [Louder, Kirk Hammett's lost riffs](https://loudersound.com/news/metallica-kirk-hammett-lost-250-riffs-10th-album) (via summary)

**In this repo:** `docs/research/LIVE-ROOM.md`, `docs/UX-RESEARCH.md`, `docs/research/RECORDING-UX.md`,
`docs/BRAND.md`, `design/LINER-NOTES-KIT.md`; `app/src/core/liveroom.js`, `app/src/ui/liveroom.js`,
`app/src/ui/liveroom-pixels.js` (the prototype);
`app/src/core/{ops,arrangement,project,store,share,grooves,arrange,jam,fretboard}.js`;
`app/src/input/{audioin,recorder,timing,midi}.js`; `app/src/engine/{engine,click,strip,schedule}.js`;
`app/src/audio/{targets,measure}.js`, `app/src/audio/analyze/`; `app/src/core/demos/boiler-room.js`;
`app/src/ui/{shell,start,onboard,export,kitload}.js`; `tools/{liveroom-test,pw,pages-test,brand-test}.js`.
