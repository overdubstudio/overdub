# The guitar room: the live room, rebuilt for the guitarist

Status: design, agreed with AJ in conversation on 26 October 2026, to be pressed through as a clickable mock
(`design/mock/guitar-room/`) before anything is built. It supersedes the stage, setlist, soundcheck and band parts of
[`LIVE-ROOM-MODE.md`](LIVE-ROOM-MODE.md). The door, the deck, the pixel scenes, the talkback, the shelf and Send carry
over.

## 0. Why

AJ played the metal club on real gear (a Scarlett Solo, guitar on input 2) the morning after it was built. The shape
was roughly right for laying down a song you know, but:
- **Takes were weak.** You had to nail it first try. There was no keep or toss. Again was hidden and played the old
  take under the new one. You couldn't stop and restart mid-take, hear what you'd just played, start from a part,
  put a part before another, drag parts or delete the last one.
- **Tone was a switcher that broke.** It stuck on one rig. Plug in, Level and Tune lamps "are weak": Claw'd-o-Matic's
  Getting started and Guitar Studio do this far better.
- **The room did too much.** The auto bass was "just kind of there". Breakdown drums arrived unasked ("Absolutely
  not"). Lay it out added an intro, a verse and an end out of nowhere. The drum settings were hidden behind ⋯.
- **Keys were unreliable.** A focused element ate Space, so stops came late. That's studio-wide, and being fixed on
  its own branch (`fix/space-key`).
- **Claude wasn't there.** "This is OVERDUB studio": the engineer behind the glass should be Claude whenever it's
  connected.

AJ's direction: **build for the guitarist persona first** (AJ is one), **rebuild** with Claw'd-o-Matic's charm as the
guide (steal its code where useful), and **hold the basement, the blues bar and the kitchen** until the guitarist's
room is right.

## 1. Principles

1. **One room, one tape.** Jamming and laying down a song are the same place. A song is just riffs in a row on the
   part line. You flow between "looking for something" and "I know this song" without picking a mode.
2. **The musician decides; the band follows.** Nothing is added, changed or played that you didn't choose. The
   drummer's beat is yours to swap, in view. There's no bass until you add one.
3. **Hands on the guitar.** While you play, the screen only asks for what a foot or one key can do, in big words.
   A late stop costs nothing: the tape kept it all, and you trim afterwards.
4. **The tape is always rolling, quietly.** It's invisible until you reach for it. It's never a red light and never
   a pressure.
5. **Strong defaults, deep if you want.** Each place comes with a stack that sounds great. A purist can build one
   from nothing in the tone room, down to the mics on the cab.
6. **Claw'd-o-Matic's charm:** the gear moves with the sound, real names, whimsy in the names and on the walls, never
   on the buttons. The engineer's copy stays calm and dry.
7. **Keys always land.** Space is the transport whatever has focus, except a text field you're typing in.

## 2. The flow

### 2.1 Walk in
The door ("Where are we playing?") leads to the metal club, the only place for now. The stage loads with the place's
stack (Half Stack, a metal setting, a boost and a gate on the floor) or the stack you last used. The first time,
**Getting started** walks you in, Claw'd-o-Matic style, on cards over the stage. Each step is skippable:
1. **Plug in.** Pick the interface and channel, with a real meter showing the −12 to −6 dBFS window, and what to do
   with the interface's gain knob.
2. **Tune.** A real tuner, big, on the stage (the strobe or needle reading the low string first), offering drop tunings.
3. **Timing.** Calibrate: strum on eight clicks, once per interface, remembered.
4. **Your sound.** Three or four strong stacks to try while you play. Pick one, or walk into the tone room.
5. A short tour: the floor, the drummer, the tape, the part line, the glass.

### 2.2 Jam
Space starts the drummer: a simple, metronome-like guide beat at the place's tempo, with the tempo in reach (← → or
tap). You play. The tape is rolling, shown only as a faint line along the bottom.

On the stage, always in view:
- **The floor:** your current stack's pedals. Number keys stomp them, the amp's gain and a few knobs are in reach, and
  "+ pedal" adds one. Changes go to **this song's copy** of the stack. **Save to rack** keeps them as a stack; nothing
  saves by default.
- **The drummer:** the current beat's name and a strip of beats to swap to (feel, busier or simpler, heavier). It's a
  guide by default. Changing it is one press and is heard at once.
- **The tape**, the **riff tray** and the **part line** along the bottom (§2.3 to §2.5).

### 2.3 "That was the one"
One key (or a tap on the tape line) opens the last minute of tape as a waveform on the bar grid, the drummer's bars
numbered. **A default selection is already made:** the last few bars you played, snapped to bar lines, so if it's
right you just press Enter. Start and end handles drag freely, and snapping can be turned off for a clean in and out.
Enter keeps it as a **riff** in the tray, playable at once, looping.

The tape keeps the last **1 minute** by default, up to **5** (a setting). Older audio falls off unless it's grabbed.

### 2.4 Riffs: the library
Every riff goes to **one library across all your songs**, tagged with the song it came from once the song has a name,
plus its tempo, tuning, key (read, not trusted), length, the stack it was played through, and when. Design for
hundreds: the tray shows this session's riffs first, with search and filter (by song, tuning, tempo range, date,
"starred") a press away. A riff can be renamed, starred, previewed, or dropped on the part line.

### 2.5 The part line
Always there, slim and empty at first ("Drop a riff here, or record a part"), beside the tray. A part is a card: name,
bars, its takes (left, right), and the drummer's beat for it.
- **Drag a riff onto it** and the riff becomes a part, its length taken from the riff.
- **Insert anywhere:** before the first part (an intro), between parts, at the end. Drag cards to reorder. Delete
  works on any card, including the last. ⌘Z undoes each as one step.
- **Play from any part:** select a card and press Enter, or Home for the top.
- Nothing is added by the house. There's no Lay it out that invents parts; at most an offer, in words, that does
  nothing until you say yes.

### 2.6 Recording a part
Pick a card (or an empty slot) and press R. A **count-in** (the metronome, on by default, can be turned off) leads in
from a bar or two before the part, with the parts around it playing.

**The recording view:** the studio dims behind a tasteful overlay. It's not jarring, and it's readable from where you
stand:
- the part and the bar count, large;
- **Space: stop** · **R: start again** (counted back in) · **Esc: toss it**;
- nothing else on screen can take a key.

The take **doesn't stop itself and isn't cut at the part's end.** Play past it if you like. When you stop, the take
lands with handles already set: the in-point at the part's first bar, and the out-point at the part's end plus
whatever rang past it. You can drag the end handle back to cut a tail that's already on the grid. Then **Keep** (Enter)
or **Toss** (Backspace), one press each, with **Again** (R) a press away. Kept takes stack in the card; ↑ ↓ picks
which one plays. A tossed take is gone from the song, though the tape had it.

**Overlap is allowed:** take 1's tail can ring under the next part's take. This needs a model change (§4.3).

**A MIDI sustain pedal** (CC 64), like AJ's piano pedal, is a footswitch: press for Space. A second action (keep) on
a double press is to be tried on real gear.

### 2.7 The other side
After a kept take on the left, the card offers **the other side**: the same recording view, your left take in the
left ear, and the tight-pair line after it (measured by `measurePair`). Then both sides play together, wide. AJ liked
this; it stays as it was, inside the new take loop.

### 2.8 Hear it
- **Hear what I just played:** after a stop, the take plays back once from the part's start (any press stops it).
- **Enter on a card** plays from that part. **Home** plays from the top.
- **Finishes** (Tight, Loud, Room) are on a **click, never a hover**. A focused chip previews level-matched, and
  pressing it puts it on. It's never triggered by the pointer passing over it.

### 2.9 The tone room
A doorway off the stage ("The shop") into **a magical guitar center**: a pixel room with walls of amps, a counter of
pedals and a rack of saved stacks. You browse by looking. Hover or focus shows the thing, and a press puts it in your
chain while you play through it. There's never a blind left-right cycle.
- **Stacks, strong defaults first:** a few great metal stacks to start from, each named for what it sounds like.
- **Build your own:** amp (with its own knobs, drawn as the amp), cab, a floor of pedals in order (drag to reorder),
  and, behind one more door, **mics on the cab** (which mic, where on the cone, distance) for people who live in here.
- **The rack:** saved stacks, named, used by any song. Loading one puts it live on the stage at once.
- Leave the shop and you're back on the stage with that stack on the floor.
- Overdub's control room uses the same browser, so the studio's blind category-cycling picker goes away.

**Built so far (gr/rig):** the stage's `[` `]` puts the rig's whole chain on both guitars in one undo step
(`core/stacks.js` planStack, `core/liveroom/plans.js` planRig), the input plays through the room's guitar
(`audio.monitorVia`), a swap crossfades, and a device that failed to build is built again. The browser itself isn't
built. The control room's amp picker is still the Jam room's tone row, which cycles a bank left and right.

**What the browser needs to show each thing, and where it is today.** Everything below exists in code already; nothing
here is a new id.
- *A stack* (a rig): `devices/guitar/rigs.js` RIGS[] carries `id`, `name`, `bank` (RIG_BANKS: `id`, `name`, `color`,
  `blurb`, `count`; 11 banks), `blurb`, `nod`, `tags`, `hot`, `amp` and `chain`. The live room's rigs are
  `core/liveroom/places.js` RIGS by place (`guitarChain(rig, side, tuning)`, `rigLabel`). A saved stack would be the
  same `{ name, chain }` (core/stacks.js), plus the rack's own name, blurb and time.
- *A pedal*: the registry's def (`getDevice`) carries `name`, `cat` / `pedalCat`, `kindLabel`, `blurb`, `nod`,
  `params` (each with `label`, `role`, `desc`, `opts`), `presets` and `look`, the face `devices/guitar/looks.gen.js`
  draws (procedural, pure CSS: no images to fetch). 101 pedals.
- *An amp*: the same def fields; `look` is the amp drawn by `ampui.js` (in looks.gen.js); `AMP_PARAMS`,
  `ampSettings` and `ampParams` are its knobs. `core.stack` (the live room's amp) has its cab, low and high cut, gate,
  boost and quality as params.
- *A cab and its mics*: `CAB_IDS` (17) and `MIC_IDS` (5) in `devices/guitar/index.js`; for core.stack, `amp-lib.js`
  `CAB_LABELS`, `CAB_NAMES` and `CAB_SAYS` (each cab-and-mic in words).
- *Hover to hear it*: core/stacks.js planStack already makes a swap the fewest ops, and a swap crossfades, so a
  preview can be a swap that the browser undoes when the focus leaves (or one step that coalesces until a press).
  It needs no new op.

### 2.10 Claude in the room
When Claude is connected (the in-app agent, claude.ai or MCP), **the talkback is Claude**. It says what it did, and
you can ask through the glass:
- "Give me a beat that's more thrash."
- "Make my tone like the record."
- "Grab that last riff."
- "Name these parts."

Claude acts through the same ops, signed in cool ink, undoable. When nobody's connected, the house engineer's lines
stay.

## 3. AJ's answers (26 October)

| Question | Answer |
|---|---|
| Rebuild or patch | Rebuild, with Claw'd-o-Matic's charm as the guide; steal code where useful |
| Grabbing a riff | See the tape, with a default selection that's usually right; easy start and end trims |
| Part length | A reasonable default, adapting to a dragged-in riff; never auto-stop or hard-cut a take; overlap allowed |
| Recording view | Dim the studio, an overlay with big clear controls, tasteful not jarring |
| Tweaks on the stage | Go to the song's copy; Save to rack keeps them |
| Riff library | Across songs, tagged with the song's name when it has one; design for many |
| Footswitch | Not really; a MIDI piano sustain pedal might work |
| Other places | Hold the basement, blues bar and kitchen |
| Drums | A simple guide beat by default, easy to swap |
| Bass | Off by default; follow-my-playing isn't good enough yet |
| Tone room | Another room is fine; strong defaults; saved stacks load live; mics on the cab for advanced people |

## 4. Carried over, replaced, and new under the hood

### 4.1 Kept from the live room build
The door (`door.js`, `door-decide.js`), the deck (`deck.js`: count-in, alignment to the audio clock, the take
shape), `measurePair` and the double's lines, the pixel scenes and gear (`pixels/`), the talkback and the lines'
copy rules, the shelf and Send (`shelf.js`, `send.js`, `shelf-db.js`), the transport's click hold, and the ops
(`room.*`).

### 4.2 Replaced
The stage (`stage.js`), the setlist (`setlist.js`), the soundcheck lamps (`soundcheck.js`, `lamps.js`), the band's
auto bass and learned-band default, Lay it out's invented form, and the rig switcher.

### 4.3 New
- **Overlapping takes on one track.** Today a new audio take is a take folder that mutes what played under it, so a
  tail ringing into the next part goes silent there (`ARCHITECTURE.md`, "Take folders"). Needed: a take's tail past
  its part plays under the next part's take, for example a clip's `tail` beats outside its folder that are never
  muted. Rendered the same in Node, and an id-safe addition to the project format.
- **The rolling tape:** a ring buffer of the input (mono 16-bit at the device rate: about 5.8 MB a minute at 48 kHz,
  29 MB at 5 minutes), always on while the room is open, with the drummer's bar grid alongside it. Grabbing copies a
  range into an asset. It never touches the song until a riff is kept.
- **The riff library:** IndexedDB across songs (`overdub:riffs`-style keys, ids forever), with the audio, the stack,
  tempo, tuning, key, length, song tag and time. Paged and searchable.
- **The stack rack:** saved stacks (the amp, cab, mic and pedals with their params) across songs; the song keeps its
  own copy.
- **The tone room's browser:** shared with the control room's device picker.

## 5. The mock

`design/mock/guitar-room/index.html`, served by `node server/serve.js` (and AJ's dev server) at
`/design/mock/guitar-room/`. It's clickable and keyboard-driven, makes no sound, and uses fake state. It reuses the
room's pixel scenes (`app/src/ui/liveroom/pixels/`) and the studio's tokens so it looks like Overdub. Screens to press
through:
1. Walk in: Getting started over the stage (plug in, tune, timing, your sound).
2. The stage, jamming: the floor, the drummer's beat strip, the faint tape, the empty part line and the tray.
3. "That was the one": the tape opened, a default selection, trims, Enter. A riff appears in the tray.
4. Drag the riff to the part line. Insert an intro before it, reorder, delete.
5. Record a part: the count-in, the dimmed recording view, stop late, the handles, Keep or Toss, Again.
6. The other side, then both sides together.
7. The riff library opened: many riffs, search and filters, tagged by song.
8. The tone room: the shop's walls, a stack's chain, swapping an amp by looking, the mics door, Save to rack, back to
   the stage.
9. Claude in the talkback: a request and its answer.

## 6. Open

- The overlap model change: how a tail is stored and shown, and what a crossfade would add later.
- The pedal's second action (keep on a double press?), to be tried on AJ's MIDI pedal.
- What the drummer's beat strip holds for metal (from the existing grooves), and how a beat is chosen per part.
- How much of Claw'd-o-Matic's Guitar Studio code (pedalboard, amps, cabs, mics, onboarding, tuner) ports directly
  onto Overdub's devices, which already vendor its pedals, amps and presets (`app/vendor/clawd/`).
