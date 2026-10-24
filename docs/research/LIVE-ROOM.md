# The live room: research and design

*2026-10-24. By the agent that built the prototype (`/app/?room` on the `live-room` branch: `app/src/core/liveroom.js`,
`app/src/ui/liveroom.js`, `app/src/ui/liveroom-pixels.js`, `tools/liveroom-test.js`). Four background research runs
the same day fed it: a fun first run without pressure, a playbook for each place, a band that follows a guitarist,
and how guitarists start songs. This note keeps what the design rests on; the runs' full reports aren't committed.
Screenshots: `tools/.out/liveroom-*.png` (not committed; the suite remakes them).*

AJ, on the studio as it is: it "feels antiquated and copying old styles". On why humming and tapping a first idea never
took: "it just feels weird humming stuff in an empty room", and humming over a random starting instrument "doesn't
make much sense". On the prototype: "its cute … this is good direction! keep it going".

It builds on `docs/UX-RESEARCH.md` (capture first; no brake pedal), `docs/research/JAM.md` (what guitarists say about
jam tools; steady time) and `docs/research/RECORDING-UX.md`, and doesn't repeat them.

**How to read the evidence.** **[strong]** a controlled study, a large sample, or a product's shipped behaviour from
its own docs; **[moderate]** a small study or a reputable review; **[weak]** a vendor's claim, a forum, an anecdote, or
a search snippet; **[inference]** our reasoning; **[code]** what Overdub's own code does. Nobody tested the other
products hands-on. Each run's web-search budget ran out near its end, so some sources were read only through a
search summary; those say so. Product names appear here and nowhere in the studio's copy.

---

## 0. The short version

1. **Two rooms, one glass.** The musician plays in the **live room**: a place with a band, an amp and a tape that's
   always rolling. The studio as it is becomes the **control room** behind the glass, one step away, where the takes
   land and the agent works the console. Nothing is taken away from the studio (Simple view's mistake).
2. **The room is never empty.** You choose what you brought and where you're playing; the room sets up around it: the
   amp (Half Stack, set for the place), the band, the tempo it leans to, the scale. Play a riff twice and the band comes in on
   the next pass, on a bar line, where your hands will be.
3. **No red light, no crowd, no score.** Expecting to be judged measurably lowers creative work; an audience, even a
   crude virtual one, makes anxious players more anxious; points and grades don't raise motivation. So there's no
   record button in the room, no crowd, and nothing marks a mistake. Space keeps what you just played, from the riff's
   first note.
4. **The band is the gear.** The charm is in the room, not in characters: pixel rooms whose amps, kit and lights move
   with the real sound, small real sounds (the amp's pop, the sticks), and words (place names, the kick's painted head).
   One animation per real signal, sized to it.
5. **The band takes your riff and never fixes it.** It locks to your time, doubles your riff (the metal club's kick on
   your chugs), and holds steady once it's in; when you stop, it finishes the bar.
6. **Automatic entry needs a fallback.** No shipped product does "play it twice" on its own: each takes the hard part
   (the loop's end, the 1) from a tap, a press or a setting. So the prototype has one beside it: T on the riff's 1,
   twice.
7. **What comes after the first take is the bigger gap.** Riff writers bank hundreds of riffs and nothing turns them
   into songs: the engineer as a librarian of kept riffs, proposing songs from them, is the follow-on.

## 1. What AJ decided

- **The live room behind the glass**, from a brainstorm of directions; the "no DAW at all" ones (a looper, trading
  fours, a voice-memo notebook) were turned down, and so were Simple view ("just removed the ability to do anything
  useful") and Round view ("just a gimmick") before it.
- **Strong presets per instrument and per place.** An electric guitar for metal starts from a riff; an acoustic from
  strummed chords; a singer is a different thing again. Here they're places: what you bring × where you're playing.
- **Guitar first.** AJ plays guitar and doesn't sing, and can judge guitar best.
- **Fun, with Claw'd-o-Matic's charm and its pixel style, but no crowd and no bandmate characters.** "The band is the
  gear" came out of that. It bends three BRAND.md rules (no mascot, no face on the agent, whimsy only in names and on
  the tape box) for the live room only; BRAND.md isn't rewritten yet: proposed, "the live room may; the control room
  may not".

## 2. Why a live room: pressure, play and the first minute

**Evaluation lowers creative work, and the red light is evaluation.**
- In a meta-analysis of 76 experiments, "highly evaluative contexts decreased creative performance", low-evaluation
  contexts raised it above control, and "more uncontrollability decreased creative performance"
  ([Byron, Khazanchi & Nazarian 2010](https://doi.org/10.1037/a0017868)) **[strong]**. In two experiments, creativity
  "was lower in those groups expecting evaluation" ([Amabile et al. 1984](https://eric.ed.gov/?id=ED256095))
  **[moderate]**.
- Across 128 studies, rewards for taking part, finishing or performing undermined intrinsic motivation, and
  informative positive feedback raised it ([Deci, Koestner & Ryan 1999](https://leeds-faculty.colorado.edu/dahe7472/deci%201999.pdf))
  **[strong]**. Points, levels and leaderboards raised output without changing motivation
  ([Mekler et al. 2017](https://glassmanlab.seas.harvard.edu/annotated_works/mekler17.pdf)) **[strong]**.
- From 19 interviews with London producers and engineers: "once that red light goes on people do tend to tense up a
  bit", and a good sound "ends up being five per cent of your job. Ninety five per cent is people"
  ([Watson & Ward 2013](https://eprints.staffs.ac.uk/855)) **[moderate]**. Engineers record "take zero" while saying
  they aren't, and one calls the red tally light "an unhelpful colour"
  ([Production Expert](https://www.production-expert.com/production-expert-1/its-time-for-an-always-on-record-mode-in-our-daws))
  **[weak]**. Software mustn't lie about it: the room says once that the tape is rolling, and never shows red
  **[inference]**.

**No crowd.** Facing a neutral virtual audience of five, phobic speakers showed more anxiety than in an empty room,
"in spite of the relatively low representational and behavioral fidelity" of the audience; confident speakers didn't
([Slater et al. 2006](https://pubmed.ncbi.nlm.nih.gov/17034333/)) **[strong]**. Half of Fender's UK respondents
prefer playing privately ([Fender and Egg Strategy 2018](https://www.prnewswire.com/news-releases/guitar-isnt-dead-research-shows-learning-to-play-helps-us-live-better-lives-300731477.html))
**[moderate: vendor-commissioned]**. Claw'd-o-Matic's crowd stays in Claw'd-o-Matic.

**Why humming was a hard ask.** 59% of 1,105 students said they couldn't imitate a melody by singing; tested, only
10-15% of untrained singers were a semitone or more off ([Pfordresher & Brown 2007](https://www.acsu.buffalo.edu/~pqp/pdfs/Pfordresher&Brown_2007_MP.pdf))
**[strong]**. Self-doubt runs well ahead of skill, which fits AJ's empty room **[inference]**.

**Two questions, each one heard.** Fender Play's first run asks only the instrument and the style; Simply Guitar's long
survey changed nothing its reviewer could see and ended at a paywall ([GuitarChalk](https://www.guitarchalk.com/simply-guitar-review/))
**[moderate]**. Choice helps intrinsic motivation most at two to four successive choices
([Patall et al. 2008](https://pubmed.ncbi.nlm.nih.gov/18298272/)) **[strong]**. So: what are you bringing, and where
are we playing. Nothing about name, age or skill **[inference]**.

**The soundcheck is the first performance.** Good calibration is already playing: Rocksmith has you strum loud and then
mute, Rock Band has you strum to the drums, Yousician's first tuned string is played in your first song
([New Atlas](https://newatlas.com/rocksmith-2014-review/30699/), [Harmonix](https://www.harmonixmusic.com/blog/how-to-calibrate))
**[moderate to strong]**. What breaks people is the chores: drivers, firmware, pairing, an OS input slider the app
can't see; Rocksmith's install took "about an hour", Spark's connection "the main issue with the app"
([App Store](https://apps.apple.com/app/id1457653921)) **[moderate; weak]**. Claw'd-o-Matic's own first run is the
pattern: plug in to a meter window of −12 to −6 dBFS, tune, strum to eight clicks for the timing, every step
skippable **[code: ../clawd-o-matic/web/plug/onboard.js]**.

**"Can't fail" fails when the machine plays for you.** Wii Music chose notes that fit for the player; "Finishing a song
doesn't feel like victory" ([GamesRadar](https://www.gamesradar.com/wii-music-review/)), and it scored 63 on
Metacritic ([Wikipedia](https://en.wikipedia.org/wiki/Wii_Music)) **[strong]**. In a pre-registered study (n = 1,699),
feedback that depended on the player succeeding raised competence and curiosity, and exaggerated feedback lowered them
([Kao et al., CHI 2024](https://dl.acm.org/doi/full/10.1145/3613904.3642656)) **[strong]**. The band responds to what
you played; it never corrects it **[inference]**.

**End on a thing you own.** The IKEA effect (valuing what you built) disappears when the build is left unfinished
([Norton, Mochon & Ariely 2012](https://dash.harvard.edu/handle/1/12136084)) **[strong]**. The first minute ends with a
named take on a tape box, and the control room has it **[inference]**.

**The closest precedent was dropped.** Magic GarageBand let you pick a genre, "the curtains will open revealing the
default instruments", and a slow blues was playing within 45 seconds ([Macworld 2008](https://www.macworld.com/article/190328/magicgarageband.html))
**[moderate]**. A critic wanted the band to "follow my melody line" ([Jensenius 2007](https://www.arj.no/2007/09/28/towards-active-music/))
**[weak]**. GarageBand 10 dropped it and added Drummer as "partial compensation"
([Sound On Sound 2014](https://www.soundonsound.com/reviews/apple-garageband-10)) **[strong]**. The live room is
Magic GarageBand's room with a band that follows the player **[inference]**.

## 3. How guitarists start songs

**A fragment found while nothing is at stake becomes a song when someone reacts.** "The song is rarely created
literally 'from nothing'", and "Band-written songs may begin with a riff"; in the jamming model the band forms the song
in the room from what members bring ([Bennett 2010](https://researchspace.bathspa.ac.uk/864/1/Bennett%20-%20Collaborative%20Songwriting.pdf))
**[moderate]**. The famous cases share the shape: Slash played a "circus" melody, Izzy Stradlin asked to hear it again
and added chords, the others joined, and "within an hour my guitar exercise had become something else"
([Wikipedia](https://en.wikipedia.org/wiki/Sweet_Child_o%27_Mine)); Jack White found the "Seven Nation Army" riff at a
soundcheck ([Beat](https://beat.com.au/?p=429866)) **[weak: anecdotes show it happens, not how often]**. "Play it
twice and the band jumps in" is that moment, with the band supplied **[inference]**.

**Ideas are cheap; sorting them is the bottleneck.** James Hetfield: "I only have 846 riffs"
([Blabbermouth](https://blabbermouth.net/news/james-hetfield-i-only-have-846-riffs-for-next-metallica-album)); Lars
Ulrich describes going "through riff tapes and picking out the best riffs, and then molding songs around that"
([Blabbermouth](https://blabbermouth.net/news/metallica-s-lars-ulrich-on-new-songs-we-re-trying-to-be-as-self-critical-as-possible))
**[weak]**. An amateur has the same pile and nobody to sort it: a writer's voice memos are "hundreds upon hundreds of
clips, with no way to search or filter them" ([iMore](https://imore.com/music-memos-songwriters-best-friend))
**[moderate: one writer]**. That's a job for the engineer **[inference]**.

**What players say stops them.** Time and slow progress, in the measured surveys: "nearly half" of beginners who quit
an instrument cite time and 33% slow progress (Fender and Egg Strategy, n = 500); 53% of US beginners practise two hours
a week or less ([Fender and YouGov 2021](https://www.prnewswire.com/news-releases/16-million-americans-learned-to-play-guitar-in-the-last-two-years-why-and-who-are-they-301394808.html),
n = 10,644) **[moderate; strong, vendor-commissioned]**. Fender's often-quoted "90% quit in a year" has no published
method and also appears as "within 3 months": don't cite it **[weak]**. Nothing found counts how many players record or
finish a song.

**Defaults write songs.** A songwriting teacher sees students write at "120BPM and beyond" over drum loops and slower on
guitar, and calls the studio arguably the "invisible writer" (Bennett) **[weak: one teacher]**. A place's tempo, feel
and key will shape what gets made; vary them across places and show them on the place's card **[inference]**.

**Three players** (composites, not real people) **[inference]**:

| | First move | Blocked by | First minute in the room |
|---|---|---|---|
| **The bedroom riff writer** (electric; metal, rock, punk) | Tunes down, a tight high-gain tone, loops one palm-muted riff | No drummer; programming drums; riffs that never become songs; a phone of unnamed riffs; often doesn't sing | A tight tone in their tuning; on the second pass a drummer at the riff's tempo, the bass doubling the riff; one key waves the band off |
| **The campfire songwriter** (acoustic) | Capo on, strums a progression, mumbles a melody into Voice Memos | Lyrics; structure; a click that kills the feel; singing in front of anyone | A natural acoustic sound, no band until invited or until the strumming settles; voice and guitar together; the chords as a reading ("sounds like G–Em–C–D, capo 3") |
| **The blues jammer** (electric) | "Shuffle in A", or just starts one | The same licks; jam tracks that never respond; doesn't call it writing | A band in the called key and feel, in steady time, that comes down when they play quietly and asks "another chorus?" after the turnaround |

## 4. Places

**What every place shares, and what changes.** Every place records the guitar simply, close-miked, and cuts the band
together ([Sound On Sound: Extreme Metal](https://www.soundonsound.com/techniques/extreme-metal),
[Pride and Joy](https://www.mixonline.com/recording/classic-tracks/classic-track-stevie-ray-vaughan-pride-and-joy-367582),
[acoustic guitar](https://www.soundonsound.com/techniques/how-record-great-acoustic-guitar-sound)) **[moderate]**. What
changes is gain, tuning, layers, how real the drums are, what the bass does, reverb and loudness **[inference]**.
"Heavier" rarely means more gain: too much gain costs definition, worst when layering; weight comes from tuning, tempo,
mids, layers and tightness ([Mynett](https://www.soundonsound.com/techniques/extreme-metal);
[Huddersfield 2020](https://www.hud.ac.uk/news/2020/september/exploring-the-heaviness-of-heavy-metal/)) **[moderate]**.

| Place | Gain | Guitars | Drums | Bass | Room | How the band follows |
|---|---|---|---|---|---|---|
| The basement (punk) | crunch | 2-3 | the room, few samples | root eighths with the guitar | dry | stops and count-ins |
| The metal club | high, mids up | 2 a side, more | tight, reinforced, a click | doubles the riff | short | the kick on the chugs, a beat of silence before the breakdown |
| The blues bar | edge of breakup | 1 | a live shuffle, brushes for slow blues | boogie or walking | a plate | cues: from the V, take it from the turnaround, the leader calls the end |
| The campfire (acoustic) | clean | 1-2 | none: shaker, cajón, claps, a stomp | none | none | the slowest singer; capo up until the singer says yes |

(After the playbook run's synthesis table and sources: Green Day and Blink-182 in
[SOS](https://www.soundonsound.com/techniques/classic-tracks-green-day-basket-case), metal in
[SOS](https://www.soundonsound.com/techniques/mix-rescue-mixing-metal), the twelve-bar in
[Wikipedia](https://en.wikipedia.org/wiki/Twelve-bar_blues), single-mic groups in
[ProSoundWeb](https://www.prosoundweb.com/the-single-mic-technique-an-old-fashioned-approach-that-can-be-surprisingly-effective/),
capos in [Acoustic Guitar](https://acousticguitar.com/make-the-most-of-your-capo-4-essential-concepts/). Most cells are
**[moderate]** or **[inference]**.)

**Words mean different things in different places.** In SocialEQ (481 people), "warm" was the most-taught word and only
the tenth for agreement ([Cartwright & Pardo 2013](https://archives.ismir.net/ismir2013/paper/000173.pdf))
**[moderate]**. "Bigger" is layers in the metal club, the room in an arena, voices at the campfire, the organ at the
blues bar; "tighter" is a boost and a locked kick in metal, stops in blues **[inference]**. The agent's lexicon reads
"big" as more space (reverb) everywhere today **[code: agent/lexicon.js]**; a place should set a word's default meaning, and the
A/B pick still overrides it **[inference]**.

**Which places first.** The metal club (most of it ships: the genre guide, Riff Lords, Rusty Sticks, the djent and
silence grooves; its follow rule is the most mechanical and the easiest to demo), the basement (Claw'd-o-Matic's home
turf, the punk grooves at 150-210), the blues bar (the easiest form to follow, with known cues), then the campfire (the
acoustic side with the smallest band) **[code + inference]**. Later: an arena (it inherits from metal and punk, and its
two schools conflict), an indie venue (five sounds in one), the coffee shop and the open mic (campfire variants), and a
front porch (it needs an upright bass, fiddle, steel, mandolin and banjo, none of which ship).

**Gaps the places show.** No doom grooves under 90 BPM; no D-beat in the punk set (only "Swedish d-beat", in extreme);
no hardcore breakdown or gang vocals; no slow 12/8 blues grooves; no stomp; no mic-plus-pickup input; no band that
moves key when the capo moves. The indie bank is already named "Basement Shows": rename one (display names may change;
ids never do) **[code]**.

## 5. A band that follows a guitarist

**What products do.** Every live one takes the hard part from a person or a setting **[strong to moderate]**:

| Product | How it locks on |
|---|---|
| DigiTech TRIO | You arm it, play a progression, and tap again on the downbeat where it comes round; Alt Time offers half or double time ([SOS](https://www.soundonsound.com/reviews/digitech-trio-band-creator)). A reviewer was "a little nervous about using the Trio for live purposes" ([Guitar Interactive](https://guitarinteractivemagazine.com/review/digitech-trio-band-creator-fs3x-footswitch/)) |
| BOSS RC-300 | A free loop "is assumed to be '1, 2, 4, 8, 16... measures,'" with its tempo found "in the range of '80–160'" ([manual](https://www.adorama.com/col/productManuals/BSRC300.pdf)) |
| BeatBuddy 2 | Tap tempo; tap for a fill, hold for the next part, double-tap to end, each at the next bar ([SOS](https://www.soundonsound.com/reviews/singular-sound-beatbuddy-2)) |
| Ableton Tempo Follower | Follows tempo only, from "audio signals that have a clear rhythm" ([manual](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/)) |
| Apple Music Memos (retired 2021) | A backing band behind a phone recording; it needed the downbeat set by hand, and caught simple chords "between 50 and 75% of the time" ([TIME](https://time.com/4202854/apple-music-memos-app)) |
| Spark Smart Jam | Pick a drummer, tap a tempo, count in, one chord every two beats ([Positive Grid](https://help.positivegrid.com/hc/en-us/articles/8141249132941-Smart-Jam), via summary) |
| GarageBand Drummer | Follows a track; best on audio "without distortion, overdrive, compressor, or modulation effects" ([Apple](https://support.apple.com/guide/garageband/gbnd861ac1f3/mac)) |
| Rocksmith Session Mode | Set key, scale, tempo and groove; the band follows your intensity, and a reviewer found it "odd that it follows you, rather than maintaining a constant rhythm" (JAM.md) |

The nearest to "play it twice", RiffBox (2005), was expected to send users back to "the typical two-tap method"
([Looper's Delight](https://loopersdelight.com/LDarchive/200506/msg00462.html)) **[weak]**.

**The technique, in the order that works.**
- **Find the loop first, the beat second.** Two passes of a riff give its length in seconds with no tempo at all; the
  tempo is then that length as 1, 2 or 4 bars under the place's prior, the way BOSS times a free loop **[strong]**.
  Online beat trackers score about 75% on beats and 46% on downbeats on full mixes
  ([BeatNet, ISMIR 2021](https://arxiv.org/pdf/2108.03576)) **[strong]**, and much less on solo strumming
  ([Itohara et al. 2012](https://asmp-eurasipjournals.springeropen.com/articles/10.1186/1687-4722-2012-6)) **[weak]**.
- **The place sets the prior.** Listeners split between metrical levels "separated by a ratio of 2 or 3"
  ([Ellis 2007](https://www.ee.columbia.edu/~dpwe/pubs/Ellis07-beattrack.pdf)) **[strong]**; a fixed window
  misfolds fast riffs (under BOSS's 80-160, a punk riff at 180 comes out at 90) **[inference: arithmetic]**. Half time,
  double time and the other 1 are readings to offer, not errors to hide.
- **The 1 is the riff's first note** unless its accents say otherwise (TRIO, `findPulse`) **[strong; code]**.
- **Listen to the DI, before the amp.** BOSS's Auto Rec misfires on distortion noise and Apple wants Follow's source
  undistorted **[strong: manuals]**. A power chord's root and fifth share a period an octave below the root, so a pitch
  tracker can report a note under the guitar's range **[inference: arithmetic]**; match pitch classes, not pitches.
- **Commit strictly.** A band that barges into noodling costs more than one that waits a pass; count false entries per
  hour on a real player's noodling and set the threshold from that **[inference]**.
- **Anticipate, never react.** The band's 1 is placed where the guitarist's next 1 is predicted, early by the measured
  round trip; a band that reacts is late by construction, and delay between players drags the tempo down
  ([Chafe et al. 2004](https://ccrma.stanford.edu/groups/soundwire/publications/papers/chafe_ISMA2004.pdf))
  **[moderate]**.
- **Once in, hold time.** Players ask for steady time (JAM.md). People correct their own timing errors only partly
  (α about 0.84-0.87, [Hove et al. 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4244310)) **[moderate]**, and
  partners that correct more than half the phase difference were "among the most annoying" in early testing
  ([Csikyová et al.](https://journals.phl.univie.ac.at/meicogsci/article/view/827)) **[weak]**.
- **Borrow ideas, not code.** Essentia.js is AGPL, aubio and BTrack GPL, madmom's models CC BY-NC-SA; Overdub is MIT
  with no dependencies **[strong: their READMEs]**.

## 6. Charm without characters

- **The object carries the information.** The OP-1's tape reel squeaks as you move through tracks
  ([MusicRadar](https://www.musicradar.com/news/8-things-op-1-field)); Rez quantized the player's shots "to ensure that
  the sounds players made fell in step with the music" ([Time Extension](https://timeextension.com/features/the-making-of-rez-tetsuya-mizuguchis-timeless-masterpiece));
  Korg Gadget names its instruments after cities ([Korg](https://www.korg.com/us/products/software/korg_gadget/gadget_collection.php))
  **[moderate to strong]**. Decoration gets ignored: a reviewer called a Pocket Operator's boot animation "a nice touch
  if you are going to take any notice of the screen" ([MusicTech](https://musictech.com/2015/04/teenage-engineering-pocket-operator-series-review/))
  **[moderate]**.
- **A cozy design space.** PICO-8's maker describes a space where "you don't feel afraid to do anything wrong", and says
  of the chores: "don't worry about it, I'll take care of that" ([Game Developer](https://gamedeveloper.com/design/exploring-pico-8-and-what-makes-a-design-space-cozy-))
  **[moderate]**. That's the control room's promise to the live room **[inference]**.
- **Metaphors work for people who know the hardware** ([Hein 2014](https://ethanhein.substack.com/p/the-great-music-interface-metaphor-shift))
  **[moderate]**: guitarists know an amp and a drum kit; few beginners know a compressor **[inference]**.

So **[inference]**: the amp's cone and lamp move with your level; the kit's heads and cymbals move only on the hits the
band plays; the bass cone moves with its meter; the lights hit on the snare and crash; the tape's reels turn and its
counter runs because the tape is rolling, in green, never red. Small real sounds play outside the take and on the grid:
the amp's pop when the input opens, the sticks in tempo. Nothing chimes over playing.

**Anti-patterns:** a setup gauntlet before any sound (firmware, drivers, an account, pairing); an interview whose
answers change nothing you can hear; grading the first minute (scores, missed notes, streaks, rooms to earn); fake
success (notes chosen for the player, celebration bigger than the playing); an audience in the room, or "Share it?"
after the first take.

## 7. What was built (the prototype)

`/app/?room` opens a blank song with the live room over it (the studio inert under it); for the rest of the tab the top
bar has a Live room key before Song. Nothing of it runs without `?room`.

1. **What are you bringing?** Four pixel instruments; only the electric guitar is live ("Not in this room yet" on the
   others).
2. **Where are we playing?** The basement (punk, 140-210 BPM), the metal club (90-200), the blues bar (66-140), each an
   animated room: its amp (Half Stack at three settings to flip through: the place's own, heavier, cleaner), its band (grooves, a fill each phrase, a crash to
   start the next; the bass's way: eighths on the roots, doubling the riff, or the boogie through the twelve-bar), the
   tempo it leans to, its grid (sixteenths; triplets at the blues bar) and the song's scale.
3. **Soundcheck:** plug in (a Guitar track signed you, on the place's first setting of the amp, armed, monitored as the input decides);
   check, one, two (the peak, and which knob to turn); the tuner; the timing (measured with eight strummed clicks, or
   the browser's guess).
4. **The room.** The guitar's notes come from the input's own blocks (the note finder with a 30 Hz floor and a 4,096
   window, so a power chord's missing fundamental reads; onsets with no pitch count too). `findRiff` looks for the
   newest stretch of playing that repeats, note for note, at the place's kind of tempo and on its grid, and takes the
   shortest period that matches as well as any. When it hears one, the band is prepared as a preview (nothing in
   History) and the engine is told to start at an audio time: the riff's next pass that starts on a bar line, less the
   round trip and the engine's delay compensation (`engine.play(from, { at })`, the recorder's own placement). Two
   notes that don't fit before then call it off ("part of something longer"). Tap the 1 (T, on the riff's 1, twice)
   brings the band in on a riff the room didn't catch: each tap is put on the input's clock and moved to the note it
   was meant for (within 120 ms), and the riff's length is the two 1s' gap, or, when the riff was played before the
   first tap too, the mean gap of every note of the tapped pass and its partner a pass before. After 25 s and 40 notes
   with nothing caught, the room says how, once. Give me a beat (B) starts the drums with a bar of sticks instead. Stop
   for a bar and the band finishes it with you.
5. **The take.** Space (or leaving for the control room with the band playing) lands two undo steps: yours (the tempo,
   the key, the take on the Guitar track from bar 1, placed so the band's way in is where your hands were) and the
   house's (Drums and Bass from where they came in to the end of the bar where they stopped). The tape box says
   what was recorded: "Take 1 is in." / "6 bars at 132 in E. Your guitar from bar 1, the band from bar 5."

**The amp.** The room first plugged you into Guitar Studio rigs (Kraken Core at the metal club, Dammit Crab in the
basement, Low Tide Blues at the blues bar). Through a real guitar and interface, the metal club sounded like the DI,
while the Jam room's metal track, whose Live guitar plays through Half Stack, sounded right. The rigs were voiced for
a hot input, and at a moderate one their amps hardly break up. Measured in Chromium on a four-tone chord (the share of
the output that's harmonics and intermodulation), Kraken Core was 52% at −12 dBFS peaks but 8% at −24. Half Stack's
Modern was 49% and 41%; the basement's and the blues bar's rigs were 1% or less at −24. So every place now plugs into
Half Stack, at three of its settings: a kernel, so a take sounds the same live, in the studio's renders and in the
canonical one. `tools/liveroom-test.js` checks that each place's first setting breaks up at −24 dBFS and that every
setting is as loud as Modern. A second cause turned up the same day, on the same machine: there, the Guitar Studio's
pedals and amps passed the dry signal until each one was switched off and on, a bug in the graph devices (on main, not
fixed here) that Half Stack, a kernel, doesn't have. A muted Chromium with autoplay allowed didn't reproduce it.

**Measured levels** (`tools/liveroom-test.js`, by the canonical renderer): a reference DI of each place's own riff,
peaks at −12 dBFS, through the place's first setting at +6 dB, against the band:

| Place | Amp | Guitar | Band | Guitar over band | Drums over bass | Mix | Faders (drums, bass) |
|---|---|---|---|---|---|---|---|
| The metal club | Half Stack, Modern | −15.0 LUFS | −18.0 | 3.0 dB | 2.7 dB | −5.1 dBTP | −6, −6 |
| The basement | Half Stack, Hard rock | −14.4 | −17.5 | 3.1 | 3.0 | −5.0 | −6.5, −6 |
| The blues bar | Half Stack, Crunch | −13.5 | −17.0 | 3.5 | 2.8 | −2.0 | −3, −7 |

**Checked** (`tools/liveroom-test.js`, 51 checks): riffs heard in synthetic playing (a two-bar metal riff at 132 with
drift, jitter and noodling first; a punk bar at 180; a boogie and a two-beat shuffle at 96; a bar whose last beat
varies; quarter strums), nothing heard in 160 notes of noodling, a four-bar riff first heard as one bar, called off and
then heard whole; tapped riffs (a pass and a bit, tapped 30-40 ms off its 1s, is two bars at 132 in E; over 40
simulated players whose every note wanders up to 60 ms, the tapped tempo is 0.43% off on average, against 1.19% from
the two 1s alone); the band's parts (the kick on all 17 chugs of the metal riff, the bass an octave or two under the
riff, the twelve-bar's I, IV and V in the blues bass, the same band for the same seed; a tapped riff with no notes heard
gets the groove's own kick and the bass on the root); the amp (every setting as loud as Modern, within a quarter dB;
each place's first one breaking up at −24 dBFS) and the levels above; and three runs in the page with a fake guitar (Karplus-Strong
plucks) on the input: power chords, where the band came in on beat 16, 7 s after the room opened, at 132 in E, and the
take landed as described; a guitar that stops, where the band finished the bar and leaving kept the take; and a riff
whose fills change every pass, which the room didn't call a riff, where it said how to tap it in and two presses of T
on its 1s brought the band in 3 ms from the next pass's 1.

An experiment the same day (not in the suite): over 40 simulated players and six passes, `findRiff` heard a riff whose
every note wanders up to 40 ms every time, 36 times at 45 ms and 21 at 60 ms. Sloppy timing alone is rarely what
keeps the band out; changing the riff every pass is.

**Not done, and not yet true:**
- It has only heard synthesized guitars. Real palm mutes, a real interface's noise floor and real sloppiness are the
  open question; the thresholds are untuned.
- Tap the 1 is a key: a footswitch that types T works, a MIDI one doesn't yet. No half or double time after the take,
  no hearing a place before choosing it.
- The tape keeps 40 seconds before a take, in memory; nothing outside a take is kept.
- The places' copy and pixels are first drafts; the acoustic guitar, keys and voice aren't in.

## 8. What comes next

In order **[inference]**:
1. **A bench of real playing.** Three or four DI clips of AJ noodling into a riff (and an hour of noodling with no
   riff, if possible), read locally by `tools/liveroom-bench.js --dir` (built: the room's ear and timing, offline; a
   `.json` beside each clip says when the riff starts, its tempo and a 1): which riffs the band came in on and on which
   pass, its tempo against the player's (half and double time named), its way in against the nearest bar line, and
   false entries per hour of noodling. Tune `findRiff` from that.
2. **The tap's grammar.** T on the riff's 1, twice, brings the band in (built); then BeatBuddy's grammar on the same
   key: tap for a fill, hold for the next part, double-tap to end, each at a bar line.
3. **Hear each place before choosing it:** a bar of its band and its amp on hover or focus.
4. **The readings after a take:** half time, double time, the other 1 (`readingsOf`), each heard at once.
5. **The librarian.** Every riff kept and named ("drop C, 140, palm-muted, 19:42"), the near-duplicates grouped, the
   DI kept so the amp can change; then songs proposed from your own riffs, an arrangement move at a time. Where the
   tape lives (this computer only?) and for how long is decided first, and said once.
6. **The campfire,** then a singer.
7. **BRAND.md:** the live room may; the control room may not.

**Questions for AJ:**
1. Should the band come in by itself by default, or only when the room is told to listen? How many false entries an
   hour are forgivable?
2. Who signs the band: the house (`overdub`, as now, and as jam tracks do) or the agent (`claude`)?
3. Headphones only, at first?
4. Which footswitch do you own: MIDI or one that types keys? (Safari has no Web MIDI.)
5. Which places next, and are three enough to start?
6. Where should the tape live, and for how long?

## Sources

**First run, charm and pressure**
- Rocksmith 2014: [New Atlas](https://newatlas.com/rocksmith-2014-review/30699/), [GameRevolution](https://www.gamerevolution.com/?p=62014), [Steam thread](https://steamcommunity.com/app/221680/discussions/0/135507855755484417); Rocksmith+: [GamingTrend](https://gamingtrend.com/impressions/rocksmith-review-in-progress-needs-more-practice/)
- Yousician: [Game settings](https://support.yousician.com/hc/en-us/articles/203751452-Game-Settings-tab); Fender Play: [Amplitude case study](https://amplitude.com/blog/lessons-from-Fender.md) (vendor); Simply Guitar: [GuitarChalk](https://www.guitarchalk.com/simply-guitar-review/)
- Spark: [Sweetwater](https://www.sweetwater.com/sweetcare/articles/positive-grid-spark-live-quickstart-guide/), [App Store](https://apps.apple.com/app/id1457653921), [Guitar World](https://www.guitarworld.com/reviews/positive-grid-spark-review)
- Rock Band 4: [Harmonix](https://www.harmonixmusic.com/blog/how-to-calibrate), [Epic](https://www.epicgames.com/help/c-42381244/c-31937213/rock-band-4-calibration-is-off-what-can-i-do-a15678543)
- Magic GarageBand: [Macworld](https://www.macworld.com/article/190328/magicgarageband.html), [Jensenius](https://www.arj.no/2007/09/28/towards-active-music/), [SOS on GarageBand 10](https://www.soundonsound.com/reviews/apple-garageband-10)
- Wii Music: [GamesRadar](https://www.gamesradar.com/wii-music-review/), [Wikipedia](https://en.wikipedia.org/wiki/Wii_Music), [Iwata Asks](https://www.nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-Wii-Music/Volume-2-Wii-Music-A-First-Time-For-Everyone/3-No-Score-No-Mistakes/3-No-Score-No-Mistakes-238445.html); Rez: [Time Extension](https://timeextension.com/features/the-making-of-rez-tetsuya-mizuguchis-timeless-masterpiece)
- Teenage Engineering: [OP-1 Field](https://www.musicradar.com/news/8-things-op-1-field), [Pocket Operators](https://musictech.com/2015/04/teenage-engineering-pocket-operator-series-review/); PICO-8: [Lexaloffle](https://www.lexaloffle.com/pico-8.php), [cozy design space](https://gamedeveloper.com/design/exploring-pico-8-and-what-makes-a-design-space-cozy-); Korg Gadget: [Korg](https://www.korg.com/us/products/software/korg_gadget/gadget_collection.php), [MusicTech](https://musictech.com/2014/04/korg-gadget-review/); [Hein on interface metaphors](https://ethanhein.substack.com/p/the-great-music-interface-metaphor-shift)
- Studies: [Amabile et al. 1984](https://eric.ed.gov/?id=ED256095), [Hennessey & Amabile 2010](https://creativetech.mat.ucsb.edu/readings/HennesseyCrRev.pdf), [Deci, Koestner & Ryan 1999](https://leeds-faculty.colorado.edu/dahe7472/deci%201999.pdf), [Ryan, Rigby & Przybylski 2006](https://doi.org/10.1007/s11031-006-9051-8), [Patall et al. 2008](https://pubmed.ncbi.nlm.nih.gov/18298272/), [Mekler et al. 2017](https://glassmanlab.seas.harvard.edu/annotated_works/mekler17.pdf), [Kao et al. 2024](https://dl.acm.org/doi/full/10.1145/3613904.3642656), [Iacovides et al. 2015](https://oro.open.ac.uk/46759), [Slater et al. 2006](https://pubmed.ncbi.nlm.nih.gov/17034333/), [Pfordresher & Brown 2007](https://www.acsu.buffalo.edu/~pqp/pdfs/Pfordresher&Brown_2007_MP.pdf), [Norton, Mochon & Ariely 2012](https://dash.harvard.edu/handle/1/12136084), [Blier-Carruthers 2013](https://presto.ram.ac.uk/id/eprint/17/1/The%20studio%20experience%20-%20control%20and%20collaboration.pdf), [Pachet et al. 2013](https://eprints-gro.gold.ac.uk/9888/1/Reflexive%20Loopers%20for%20Solo%20Music%20Improvisation.pdf)
- Engineers: [Hughes, Production Expert 2013](https://www.production-expert.com/home-page/2013/3/10/5-things-i-do-to-get-a-better-performance.html), [always-on record mode](https://www.production-expert.com/production-expert-1/its-time-for-an-always-on-record-mode-in-our-daws), [red-light fever](https://www.production-expert.com/home-page/2017/6/16/how-to-support-artists-who-suffer-with-red-light-fever-when-recording), [Watson & Ward 2013](https://eprints.staffs.ac.uk/855); browser latency: [W3C workshop talk](https://w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html)

**Places**
- Metal: [Mynett, Extreme Metal](https://www.soundonsound.com/techniques/extreme-metal), [Mixing Metal: Audio Examples](https://www.soundonsound.com/techniques/mixing-metal-audio-examples), [Mix Rescue: Mixing Metal](https://www.soundonsound.com/techniques/mix-rescue-mixing-metal), [Master of Puppets](https://www.mixonline.com/recording/classic-track-master-of-puppets-metallica), [Marrington on djent](https://ray.yorksj.ac.uk/id/eprint/8666/), [Huddersfield on heaviness](https://www.hud.ac.uk/news/2020/september/exploring-the-heaviness-of-heavy-metal/), [Breakdown (Wikipedia)](https://en.wikipedia.org/wiki/Breakdown_(music))
- Punk: [Basket Case](https://www.soundonsound.com/techniques/classic-tracks-green-day-basket-case), [Blink-182 California](https://www.soundonsound.com/techniques/inside-track-blink-182-california), [the punk beat (Paste)](https://www.pastemagazine.com/music/punk/the-history-of-the-punk-beat-in-10-songs), [Chris Lord-Alge](https://www.soundonsound.com/techniques/secrets-mix-engineers-chris-lord-alge)
- Blues: [Pride and Joy](https://www.mixonline.com/recording/classic-tracks/classic-track-stevie-ray-vaughan-pride-and-joy-367582), [Kevin Shirley](https://www.mixonline.com/?p=5842), [Twelve-bar blues](https://en.wikipedia.org/wiki/Twelve-bar_blues), [jam cues (forum)](https://www.modernbluesharmonica.com/board/board_topic/5560960/5437699.htm)
- Acoustic: [recording acoustic guitar](https://www.soundonsound.com/techniques/how-record-great-acoustic-guitar-sound), [a singing guitarist](https://www.soundonsound.com/techniques/recording-singing-guitarist), [mics and DIs on stage](https://www.soundonsound.com/techniques/using-mics-di-boxes-stage), [Mumford & Sons](https://www.soundonsound.com/techniques/mumford-sons-little-lion-man), [capos](https://acousticguitar.com/make-the-most-of-your-capo-4-essential-concepts/), [the single mic](https://www.prosoundweb.com/the-single-mic-technique-an-old-fashioned-approach-that-can-be-surprisingly-effective/), [Nashville recording](https://www.soundonsound.com/techniques/nashville-recording), [Dave Cobb](https://www.soundonsound.com/people/dave-cobb)
- Others: [AC/DC Black Ice](https://www.soundonsound.com/techniques/inside-track-acdc-black-ice), [Foo Fighters](https://www.soundonsound.com/people/foo-fighters-recording-wasting-light), [The Strokes](https://www.soundonsound.com/people/gordon-raphael-producing-strokes), [Arctic Monkeys](https://www.soundonsound.com/techniques/classic-tracks-arctic-monkeys-bet-you-look-good-dancefloor), [SocialEQ](https://archives.ismir.net/ismir2013/paper/000173.pdf), [Spotify loudness](https://support.spotify.com/us/artists/article/loudness-normalization/)

**A band that follows**
- Products: [TRIO (SOS)](https://www.soundonsound.com/reviews/digitech-trio-band-creator), [TRIO (Guitar Interactive)](https://guitarinteractivemagazine.com/review/digitech-trio-band-creator-fs3x-footswitch/), [BOSS RC-300 manual](https://www.adorama.com/col/productManuals/BSRC300.pdf), [BeatBuddy 2](https://www.soundonsound.com/reviews/singular-sound-beatbuddy-2), [Ableton Tempo Follower](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/), [B-Keeper](https://www.nime.org/proceedings/2007/nime2007_234.pdf), [Logic free tempo](https://support.apple.com/en-gw/102165), [Logic Follow Rhythm](https://help.apple.com/logicpro/mac/10.4/en.lproj/lgcp45310225.html), [Rocksmith 2014 review](https://worthplaying.com/article/2013/10/22/reviews/90453-pc-review-rocksmith-2014-edition/), [EZdrummer 3](https://www.soundonsound.com/reviews/toontrack-ezdrummer-3), [RiffBox](https://loopersdelight.com/LDarchive/200506/msg00462.html), [ReaLJam](https://arxiv.org/html/2502.21267v1)
- Research: [Böck, Krebs & Schedl 2012](https://archives.ismir.net/ismir2012/paper/000049.pdf), [BeatNet](https://arxiv.org/pdf/2108.03576), [real-time PLP](https://transactions.ismir.net/articles/10.5334/tismir.189), [Itohara et al.](https://asmp-eurasipjournals.springeropen.com/articles/10.1186/1687-4722-2012-6), [Ellis 2007](https://www.ee.columbia.edu/~dpwe/pubs/Ellis07-beattrack.pdf), [REPET](https://github.com/zafarrafii/REPET-Python), [IDMT-SMT-Guitar](https://www.idmt.fraunhofer.de/en/publications/datasets/guitar.html), [Chafe et al.](https://ccrma.stanford.edu/groups/soundwire/publications/papers/chafe_ISMA2004.pdf), [Hove et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4244310), [Repp & Keller](https://researchers.westernsydney.edu.au/en/publications/sensorimotor-synchronization-with-adaptively-timed-sequences/), [Fairhurst et al.](https://pubmed.ncbi.nlm.nih.gov/22892422/), [Csikyová et al.](https://journals.phl.univie.ac.at/meicogsci/article/view/827), [Antescofo tempo](https://antescofo-doc.ircam.fr/Reference/tempo_inference/)
- Platform and libraries: [Web Audio](https://webaudio.github.io/web-audio-api/), [Media Capture Extensions](https://w3c.github.io/mediacapture-extensions/), [MDN compat data](https://github.com/mdn/browser-compat-data), [scheduling (web.dev)](https://web.dev/articles/audio-scheduling), [Essentia.js](https://github.com/MTG/essentia.js), [aubio](https://github.com/aubio/aubio), [madmom](https://github.com/CPJKU/madmom), [Beat This!](https://github.com/CPJKU/beat_this)

**How guitarists start songs**
- [Bennett 2010](https://researchspace.bathspa.ac.uk/864/1/Bennett%20-%20Collaborative%20Songwriting.pdf), [Byron, Khazanchi & Nazarian 2010](https://doi.org/10.1037/a0017868), [Hart & Di Blasi 2015](https://research.ucc.ie/en/publications/combined-flow-in-musical-jam-sessions-a-pilot-qualitative-study/) (via summary), [Acar, Tarakci & van Knippenberg 2019](https://openaccess.city.ac.uk/id/eprint/20459/) (via summary)
- Surveys: [Fender and Egg Strategy 2018](https://www.prnewswire.com/news-releases/guitar-isnt-dead-research-shows-learning-to-play-helps-us-live-better-lives-300731477.html), [Fender and YouGov 2021](https://www.prnewswire.com/news-releases/16-million-americans-learned-to-play-guitar-in-the-last-two-years-why-and-who-are-they-301394808.html), [NAMM and Gallup 2009](https://www.namm.org/news/press-releases/new-gallup-survey-namm-reflects-majority-americans-agree-many-benefits-playing), [Fortune 2022](https://fortune.com/2022/10/21/guitar-industry-fender-ceo-credits-diversity-players-pandemic-revival), [PlaybackPilot](https://playbackpilot.com/blog/survey-producers-finish-less-than-half-their-music) (vendor)
- Products: [Music Memos launch](https://www.apple.com/au/newsroom/2016/01/20New-Music-Apps-from-Apple-Transform-iOS-Devices-into-Handheld-Studios-for-Songwriters-Beatmakers/), [retired](https://9to5mac.com/2021/03/02/apple-music-memos-voice-memos-integration/) (via summary), [iMore](https://imore.com/music-memos-songwriters-best-friend), [TIME](https://time.com/4202854/apple-music-memos-app), [Voice Memos layers](https://techcrunch.com/2024/12/11/apple-brings-layered-recordings-to-voice-memos-app-in-ios-18-2-update) (via summary), [GarageBand Drummer](https://support.apple.com/guide/garageband/gbnd861ac1f3/mac), [Smart Jam](https://help.positivegrid.com/hc/en-us/articles/8141249132941-Smart-Jam) (via summary), [Spark 40 (SOS)](https://www.soundonsound.com/reviews/positive-grid-spark-40), [Fender Studio](https://musictech.com/news/gear/fender-studio/)
- Songwriters: [Satisfaction](https://www.history.com/this-day-in-history/may-12/satisfaction-comes-to-keith-richards), [Sweet Child o' Mine](https://en.wikipedia.org/wiki/Sweet_Child_o%27_Mine), [Slash in Loudwire](https://loudwire.com/slash-true-origin-story-sweet-child-o-mine-riff/), [Seven Nation Army](https://beat.com.au/?p=429866), [Hetfield's 846 riffs](https://blabbermouth.net/news/james-hetfield-i-only-have-846-riffs-for-next-metallica-album), [Ulrich on riff tapes](https://blabbermouth.net/news/metallica-s-lars-ulrich-on-new-songs-we-re-trying-to-be-as-self-critical-as-possible), [Tweedy](https://nodepression.org/the-reading-room-jeff-tweedy-offers-insight-and-encouragement-in-how-to-write-one-song/), [Electric Nebraska](https://en.wikipedia.org/wiki/Electric_Nebraska)

**In this repo:** `docs/UX-RESEARCH.md`, `docs/research/JAM.md`, `docs/research/RECORDING-UX.md`,
`app/src/input/onsets.js`, `timing.js`, `rounds.js`, `latency.js`, `recorder.js`, `app/src/engine/engine.js`,
`app/src/core/jam.js`, `app/src/core/grooves/*.js`, `app/src/agent/{genres,lexicon}.js`, `app/src/audio/targets.js`,
`app/vendor/clawd/presets/*.js`, `tools/beat-bench.js`; Claw'd-o-Matic's `web/plug/onboard.js` and
`web/plug/00-latency.js`.
