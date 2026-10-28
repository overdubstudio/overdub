# The amp path: the guitar from the input jack to the speakers, every time

Status: the design, frozen on 28 October 2026 for two build streams (`amp/path` and `amp/devices`, both branched from
`amp/base`). It replaces the patches of the last month with one owner, one lifecycle and a check that runs while you
play. What it changes in the contracts goes into `docs/ARCHITECTURE.md` (the path stream) and `docs/DEVICES.md` (the
devices stream) as each piece lands; this file is the why and the plan.

## 0. Why

AJ demoed the guitar room to a friend and "the amps just didn't work at all. They've been so finicky." The Scarlett was
plugged in, on input 2, and the input meter in the app was moving, but the amp and the pedals weren't heard. "Sometimes
turning off and on again helps, other times it's hopeless." Every earlier fix was right and the symptom came back in
another form: Chrome 155 dropping a footswitch curve (`kit.js` `endAt`, PR #45), an older audio track taking the
monitor, a failed build staying a pass-through, the room's `[ ]` writing `room.rig` but not the chain. So this time
the path gets one owner, every device in it one lifecycle, and the running page checks that it works.

## 1. What is wrong (verified)

Two independent investigations (the repro and the audit) found the causes; the important ones were run again for this
design on 28 October in muted headless Chrome 156.0.8078.49 (AJ's) and the harness's Chromium 151.

| # | Cause | Seen | Fixed by |
|---|---|---|---|
| 1 | **The footswitch reads the audio clock twice** (`kit.js` `glide`: the start from one `currentTime`, the hold from a second). Chrome's clock moves in 5.8 ms steps, even inside one task. When it steps between the reads the curve starts in the past, `endAt` lands inside it, throws, and the throw is swallowed. On a node that hasn't rendered yet (every freshly built device), Chrome 156 then drops the curve: the amp stays dry plus wet, or a pedal stays silent, until it's stomped off and on. | `glide-race.mjs`, rerun: Chrome 156 6/6 stuck at every skew over 3 ms, 0/6 under; Chromium 151 0/6 (it throws too but lands the curve); one clock read or `setTargetAtTime`: 0/36 on both. The repro measured it on 3 of 317 cold loads in Chrome 156 and 0 of 136 in 151. | §5: no value curves live; one clock read; state set by `.value` before wiring; `assure()`; the health check |
| 2 | **The browser's default input never monitors, and it sticks.** `audioin.js` turns monitoring on only for an interface opened by its own id. A first visit (no labels before the grant), Getting started's "Default - Scarlett" chip, the Jam room's "Default input", Sketch's Open and a take before plug-in all open `'default'`; it is saved, and the next load prefers it. | `firstvisit.mjs`, rerun on Chrome 156: first visit `kind: interface, monitoring: false`; reopened, false; the next visit `saved.deviceId: 'default'`, false. `path.mjs` on 151: the default entry false, the same device by id true. | §3, §4 |
| 3 | **Monitoring turned off anywhere sticks to the device, and the room can't turn it back on.** The killswitch (`transport.js` `silenceAll`) and the Jam room's close record a by-hand off; reopening the same input keeps it; the room has no monitor control and shows nothing. | `path.mjs` on 151, rerun: after the killswitch false, after reopening false, after a channel change false, master -240 dBFS. | §4, §8 |
| 4 | **A device whose build throws becomes a silent pass-through.** `graph.js` catches the throw and substitutes a unity gain; the strip thinks it built: no report, no stand-in flag, no retry. | `path.mjs` on 151, rerun with the amp's build throwing once: `engineErrors: []`, `instanceFallback: false`, the amp's output 73% dry. | §5, §6 |
| 5 | **A worklet that fails to load once stays failed for the page's life** (`kit.js` caches `false`); every later build of that device passes through, silently. | `path.mjs FAIL_GATE=1` (audit): after six swaps the gate still has no node, no report. | §5 |

Also true, found by reading the code and not reproduced; the design closes them because they are cheap to close and
each is the same shape (a state that only a toggle or a reload fixes):

- `Strip.dipped()` skips its ramp back up and its `resolve()` if the rewire throws: the strip stays at 0 and its build
  job never ends (`strip.js` 403-423).
- `Strip.renew()` disposes instances a concurrently started build may still wire, and it wires a bare wire (the dry
  guitar) until the rebuild lands; the killswitch and the polite stop race that rebuild against 1.5 s and may open onto
  it (`strip.js` 364-373, `engine.js` 1141-1175 and 1223-1259).
- The polite stop renews a monitored guitar strip whose input reads under -80 dBFS for a moment (`hearsInput` at 1e-4).
- Each `open()` adds an `ended` listener that closes whatever input is current, not its own (`audioin.js` 270).
- The third `getUserMedia` attempt, `{ deviceId: id }`, quietly opens the browser default with voice processing on
  when a remembered id has gone (the repro's `staleid`: EC, NS and AGC on, the amp reading clean 4 s later).
- The guitar room never resumes a suspended context; it opens the input (which resumes it) only when the input is closed.
- `monitorVia` is set once at mount; a song loaded while the room is up can leave it naming a gone track.
- `plugAmp` starts a wow LFO it never stops; every amp thrown away by a swap or a renew stays alive.
- The gear's own code (`gear/code.js`) still has three `setValueCurveAtTime`s: its pfxGlide and convolver glide (unused
  by Overdub) and Tape Snail's stop, which is live.

Dropped: nothing that was claimed with high confidence failed to reproduce. The suspend case (the repro's low-confidence
one) is real if the context ever suspends, which wasn't seen to happen by itself on AJ's machine: §3 covers it anyway.
Production `overdubstudio.com` lacks PR #45's `endAt`, but the guitar room isn't deployed there (403), so AJ's demo ran on
the dev server; this design makes `endAt` unnecessary.

What is fine, measured: once monitoring is on and the devices are built, the graph is right on both browsers. The club
stack comes up wet (Chrome 156: the Recto's output 23.6% dry against the DI; Chromium 151: 35%), stays wet through
stomps (24-47%) and six whole-stack swaps, each settled in 34-56 ms.

## 2. The live path and its owner

The live path is one chain of things, and **`app/src/input/` owns it end to end**: the input (`audioin.js`, as now), the
monitoring decision and where it plays (`audioin.js`, by the rules in `livepath.js`), and the check that it works
(`livepath.js`, `app.input.path`). The engine builds and rewires the strip it plays through; the devices keep their own
state. Nothing else in the app decides monitoring.

```
input jack -> getUserMedia (no voice processing) -> MediaStreamSource -> pick (one channel)  [audioin.js]
  -> mon gain (monitoring: on by the decision, muted by holds)                               [audioin.js]
  -> engine.inputNode(track) = strip.input -> head -> preDip -> inserts... -> tail -> postDip  [engine/strip.js]
  -> calm -> fader -> mute -> pan -> out -> master head -> master inserts -> fader -> soft clip -> kill -> speakers
```

What the owner guarantees, for whichever room is up:

1. **One decision.** Monitoring is on or off by one rule (§4); a mute for a moment (the tuner) is a hold that ends,
   never a decision that sticks.
2. **One target.** The monitored track is a resolver evaluated at every sync (`monitorVia(fn)`), so a song loaded, a
   track removed or a take on the other side can't leave it pointing at nothing or at a chain-less track.
3. **Built before heard.** A chain is wired only when every device in it is built and at its state; a device that
   can't be built is a loud stand-in (reported, flagged, retried), never a quiet pass-through (§5, §6).
4. **Measured while you play.** A health check (§7) reads the signal at the input, the strip and the chain's end, and
   each device's own state, every 2 s while monitoring is on and something is coming in, and after every change. When
   the guitar isn't arriving wet it repairs the path (rewire, snap, rebuild) and says so in the talkback.
5. **Nothing only a toggle fixes.** Every state the path can be in is either right, or detected and repaired, or said
   in words with what to press.

## 3. The input's lifecycle

| Moment | What happens |
|---|---|
| Choosing | `audio.choose({ role })` → `chooseInput(list, { remembered, channel, role })` (`livepath.js`, pure). The remembered device when it's here and isn't `'default'`; in the guitar room (`role: 'instrument'`) an interface outranks a remembered microphone; then an interface by its label (its own entry, never the "Default - " one); else the browser default. With no labels (no standing grant) it opens the default and says `reask`. Every opener uses it: the room's tuner and Getting started, a take's `ensureOpen`, Sketch's Open, the soundcheck. |
| Permission | The first `getUserMedia` grants labels. If the choice was blind (`reask`), the owner enumerates again and, if an interface is now visible that isn't the one open, reopens it once. |
| Opening | `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }` on every attempt. A remembered id that's gone (`OverconstrainedError`, `NotFoundError`) is dropped and the choice made again by label; never a loose `{ deviceId }` that opens a voice-processed default. If the browser keeps processing on anyway, `state.settings` says so and the room says it once. |
| Identity | The device's real id: `realIdOf(list, settings)` resolves `'default'` to the entry with its group id. The decision (§4) and `overdub:input` are keyed by it; `'default'` is never saved as the picked device. The format of `overdub:input` is unchanged (`{ deviceId, channel, countIn }`). |
| Channel | `useChannel(ch)` in place (as now). In the guitar room every open of an instrument input listens for the channel that moves on the first strum (`pickChannel`, as Getting started does now), unless a channel was picked by hand: a take started before plugging in finds input 2 too. A channel change never changes the decision. |
| Going away | The `ended` listener belongs to its own stream: a stale one can't close a live input. A device gone (`ended`, or missing at `devicechange`) closes with "The Scarlett went away"; when an input that went away comes back at `devicechange`, the owner reopens it (same device, same channel) and says so. |
| Context | The input runs on the engine's context. `audio.wake()` resumes it (any key or click in a room calls it; `open()` does). A suspended context is a health state with a line. If the engine didn't start and the input runs on its private context, monitoring can't be heard: a health state with a line, never a silent "on". |
| Sample rate | Whatever the context runs at (44.1, 48, 96 kHz); analyser windows scale with it (`winFor`), and the health check's measures are rate-free. |

## 4. Monitoring: one decision, and holds

- **The decision** is `{ for: realId, on, by: 'auto' | 'hand', why }`, made when an input opens that isn't the one
  decided for. Auto: `autoMonitor({ kind, channels, role })` (`livepath.js`): on for an instrument interface or line
  input, **whether it was opened as the "Default - " entry or by its id** (the label decides what it is, not how it was
  picked); on for an unrecognised input with two or more channels in the guitar room; off for a microphone (`MIC_LINE`,
  as now: it would howl) and for a virtual or loopback device. By hand (`audio.monitor(on)`, Sketch's chip, the Jam
  room's button, the guitar room's M): that, for that device, for the page's life. Reopening the same device keeps it.
- **Holds** mute the monitor without changing the decision: `audio.hold(reason)` / `audio.release(reason)`. The tuner
  holds `'tuner'` while it's on. Monitoring is heard when the decision is on and there are no holds; `state.monitoring`
  is the decision, `state.monitorHolds` the holds.
- **The killswitch** (`audio.hush()`, called by `silenceAll`): an interface's decision is left alone (the engine's feed
  is already shut and the strips renewed; you hear the guitar again when the feed opens); a microphone, a virtual input
  or an unknown one is turned off by hand (the howl the killswitch was pressed for).
- **Closing** an input (the Jam room's button, a take done) is just closing: it never records a decision.
- **The feedback guard** is unchanged (any input but an interface).
- **Where it plays**: `monitorVia(idOrFn)`. A function is called at every sync, so the guitar room passes
  `() => takeSide() || guitarL()`. The usual rule (armed, else selected, else first audio track) when there's none.

## 5. The device lifecycle (every device in a live chain)

The contract between the engine and the devices is `app/src/devices/lifecycle.js` (frozen). The states, and who
owns each:

| State | Owner | Rule |
|---|---|---|
| build | device | `instantiate()` makes the nodes and sets every one by `.value` (and `setValueAtTime(v, 0)` only offline at time 0). Nothing is scheduled on a node that hasn't rendered: no curve, no glide, no ramp. |
| ready | device | `inst.ready` resolves once the instance is at its state (params set, bypass as asked, worklets in). **It rejects** when the build threw, returned no output (or no input for an effect), or a worklet it needs didn't load: an `Error` with `.code` `'threw' | 'no-output' | 'worklet'` (`lifecycle.js` `failure()`). Never a quiet stand-in inside the device. |
| wire | engine | The strip connects a chain only when all of it is ready (§6). |
| bypass | device | `setOn(on, at?)`: click-free, from **one** read of the clock, with `setTargetAtTime` or linear ramps (both land on a node that hasn't rendered, in Chrome 155, 156 and 151). **No `setValueCurveAtTime` anywhere live.** Offline (scheduled ahead, renders) it does exactly what it does now, so renders stay bit-identical. |
| assure | engine → device | `inst.assure?.()` snaps anything not where it was asked to be (the bypass gains, a worklet's state) to its target at once and returns true if it had to. The strip calls it on each newly wired device once its fades are over; the health check calls it when a device reports itself wrong. |
| health | device | `inst.health?.()` → `{ ok, failed, on, settled, dry, wet, want: { dry, wet } }`: the bypass gains as they are and as they should be (`settled`: no fade still running). Kernel instances may leave it out (`healthOf` reads that as ok). |
| swap | engine | §6. |
| tear down | device | `dispose()`: idempotent; stops every source, timer and worklet the device started (the amp's wow LFO and cab timers included), disconnects its nodes. |
| retry | engine | A rejected `ready` is a stand-in (an effect passes its input through; reported as an `'error'`, `inst.fallback` set) and is built again after `BUILD.retry`, up to `BUILD.tries`, as `strip.js` already does for a kernel. `kit.js` asks for a worklet module again on the next build instead of caching a failure. |

## 6. Swaps and renews are atomic

- **Build, then wire.** `Strip.build` already builds every new instance before it rewires; that stays, and the new
  wiring is either the crossfade (a chain that shares no device with the one playing: beside it, 30 ms linear) or the
  dip (8 ms), as now. After wiring, the strip calls `assure()` on what it wired, once the fades are over.
- **`dipped()` always comes back**: the rewire runs in `try`/`finally`, so the dips ramp back up and the job ends even
  if a rewire throws (and the throw is reported).
- **`renew()` is a build, under the job lock.** It goes through `sync()` with `fresh: true`: every device built anew
  (nothing reused), then swapped in like any other chain. The old chain's tail goes to 0 at once (the killswitch's feed
  is shut, or the polite stop has faded it); the new one comes up behind its own tail gain once it's ready. A slow build
  is silence for that strip, never the dry guitar and never a half-built chain, and it can't wire a disposed device.
- **The monitored strip is never renewed by the polite stop.** `engine.monitored(trackId)` marks it (the owner sets
  it with the monitor target); `calmTails` leaves it alone whatever its level.
- **`engine.rebuild(trackId)`** renews one strip (the health check's repair) and resolves to what built and what didn't.

## 7. The health check

`app.input.path` (`livepath.js` `createLivePath`, built by the path stream). Live only; it adds analysers off three
points of the monitored path and changes nothing in the sound:

- `in`: the input's pick (`audio.tap`), `strip`: the strip's input (`strip.inTap`), `chain`: the chain's end
  (`strip.keyTap()`, the postDip). Peak dBFS over the analysers' window.
- Each wired insert's `healthOf(inst)` and whether it's a stand-in.
- For an on amp only, whether the chain's end is a delayed, scaled copy of the strip's input (`dryLike`: best
  normalised cross-correlation over lags up to 20 ms; `HEALTH.dryCorr`).

`pathVerdict(snapshot)` (`livepath.js`, pure, frozen) turns that into one state, in this order: `closed`, `suspended`
(repair: resume on the next gesture), `no-engine`, `off`, `held`, `waiting`, `quiet` (nothing coming in: nothing to
judge), `unwired` (the input moves, the strip doesn't: repair `rewire`), `stand-in` (repair `rebuild`), `stuck` (a device
reports itself wrong once settled: repair `assure`), `silent` (the strip moves, the chain's end doesn't: repair
`rebuild`), `dry` (an amp on and the chain's end a copy of its input: repair `rebuild`), `muted` (the track is muted or
soloed out: no repair, a line), `ok`.

When it runs: `HEALTH.after` ms after any event that can change the path (an open, a decision or hold change, a new
target, the engine's `'graph'` for the monitored track, a context state change, the killswitch done) and every
`HEALTH.every` ms while monitoring is on and the input is over `HEALTH.quiet`. A repair escalates `assure` → `rebuild`
→ (up to `HEALTH.tries` rebuilds `HEALTH.backoff` apart) → it stops and says `LINES.gaveUp`. It says what it did once
per episode, in the room's talkback (`R.say(line, { by: 'overdub' })`; the house is unsigned) and elsewhere as a toast.
The state is `audio.state.path` and the `'path'` event on `app.input`. The lines are `LINES` in `livepath.js`.

## 8. One path for every room

- **The guitar room**: the tuner holds and releases (no more `monitorWas`); Getting started and the tuner open through `audio.choose` /
  `openBest({ role: 'instrument' })`; a take's `ensureOpen` too; `monitorVia(() => takeSide || Guitar L)` once at mount;
  M toggles monitoring (the person's decision) and the room shows it (a lamp by the input jack, and the slate's Plug in
  step says it); the health check's lines come through the talkback; a key or click wakes the context.
- **The shop's try-outs** (`store.preview`) and carries are song changes like any other: the same strip, the same
  atomic swap, the same `assure` and the same health check after its `'graph'` event.
- **The control room**: Sketch's Monitor chip and Open, the Inspector's input, the recorder's `openFor`, the Jam room's
  input button (closing no longer turns monitoring off). The health check runs there too; its lines are toasts.
- **The live room's stage** sets `monitorVia` as now.
- **The killswitch** anywhere: `audio.hush()` then `engine.silence()`.

## 9. Offline renders stay what they are

Nothing above runs offline: no monitor, no health check, no renew, no `assure`. The offline branches of `kit.js`
`glide`, the convolver and `graph.js`'s footswitch are kept exactly (they schedule ahead from time 0, which lands), and
`tools/golden.json` must not move. A graph device whose build throws offline becomes `strip.js`'s pass-through
instead of `graph.js`'s own; no render today has one. Proof for the devices stream: the 412-render fingerprint
(every pedal and amp on the DI strum and the bass DI, every rig chain) before and after, bit-identical except the ten
timer-driven pedals and their rigs, which already differ run to run.

## 10. The build: two streams

| Stream | Branch, worktree | Owns |
|---|---|---|
| path | `amp/path`, `.claude/worktrees/amp-path` | `app/src/input/` (audioin, livepath below its frozen part, index, recorder), `app/src/engine/` (strip, engine, util, fallback), the UI callers (`ui/transport.js`, `ui/jam.js`, `ui/sketch.js`, `ui/liveroom/stage.js`, `ui/liveroom/soundcheck.js`, `ui/liveroom/kitchen.js`, `ui/liveroom/guitar/` all of it), `tools/amp-soak.js`, `tools/input-test.js`, `tools/engine-test.js`, `tools/silence-test.js`, `tools/stopping-test.js`, `tools/liveroom/`, `docs/ARCHITECTURE.md` (and `site/docs/architecture.html`), `docs/GUIDE.md` (and its page) |
| devices | `amp/devices`, `.claude/worktrees/amp-devices` | `app/src/devices/kit.js`, `graph.js`, `registry.js`, `app/src/devices/worklets/`, `app/src/devices/guitar/` (amps, pedals, rigs, index, `gear/` all of it), `tools/guitar-test.js`, `tools/stack-test.js`, `tools/kernel-test.js`, `docs/DEVICES.md` (and its page), new unit tests of its own (`test/unit/kit.test.js`) |

The seams, frozen in `amp/base`: `app/src/devices/lifecycle.js` (the instance lifecycle: `failure`, `healthOf`,
`assure`, `FAILURE_CODES`) and `app/src/input/livepath.js` (the policies: `autoMonitor`, `chooseInput`, `realIdOf`,
`pathVerdict`, `LINES`, `HEALTH`; `test/unit/livepath.test.js` holds them). Neither stream edits either file; a change
to a seam is asked for, made in `amp/base` and merged into both.

## 11. Proof

- `tools/amp-soak.js` (not a suite): the real studio in muted headless Chrome or Chromium with AJ's rig faked (a
  Scarlett Solo by name, a sustained chord on input 2), into the metal club, a named scenario N times, measured at every
  point of the graph after each step. `node tools/amp-soak.js cold,kill --n 20`, `CHROMIUM=` for AJ's Chrome,
  `SR=48000`, `LABELS=0` (a first visit), `STRICT=1` (Chrome's own autoplay policy). Prints each failure and a tally;
  exits 1 on any. `race` replays the footswitch race on the page's own `kit.js`.
- Fast checks in the existing suites, each stream for its part (the list is in each stream's acceptance).
- The bar for done: `amp-soak` all scenarios N=4 on Chrome 156 and Chromium 151 with no unexpected failure; `cold` N=300
  on Chrome 156 with none; `race` 0 stuck on both; every suite each stream touches passing; `golden.json` unchanged.
