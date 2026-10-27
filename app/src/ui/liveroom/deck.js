// The deck [ui; stream A] (docs/research/LIVE-ROOM-MODE.md §3.3-§3.6, §9.4): the room's one door to the input, the
// count-in, the recorder and the soundcheck. Every musical decision is made on the audio clock when the key is pressed
// (the start and stop beats passed to the engine and the recorder with `at`), never in a frame callback, which a
// background tab stalls: a stop pressed and then starved of frames still ends on its bar line.
//
// Frozen (§14.2):
//   createDeck(app) -> { state, on(evt, fn) -> off, countIn({ from, bars, voice, hits, at }), take({ track, from, punch,
//       tail }), stop({ at: 'bar' | 'now', keep: 'song' | 'capture' }), keepAfterAll(), level(), tuner(), latency }
//       state: what the stage paints from ({ run: 'idle' | 'count' | 'take', ... }); the actions are Promises of
//       { ok, ... }; level() and tuner() read the input now (null when it's closed); latency: the measured round trip, s
//
// One deck per page: createDeck(app) again gives the same one (a check imports this module and asks for it).
//
//   countIn({ from = 0, bars, voice = 'sticks', hits, at, preroll = true }) -> { ok, from, beats, startT, downbeat }
//       the transport from `from`, counted in: `bars` bars (default: one, two at 160 BPM and up) of `voice` ('sticks',
//       'click' or 'none': the pre-roll is the count), only the count's beats in `hits` sounding (from 0; the
//       basement's [0, 2, 4, 5, 6, 7]); at: the audio-clock time of the count's first beat (default: as soon as the
//       engine can). With preroll the song plays under the count (the bars before `from`: the last part, its fill).
//       A sampled kit still coming in holds the count (state.kit says how far along) for up to 30 s; one that can't
//       come in lets it go (state.kit 'missing': the stage says the drummer's on another kit).
//   take({ track, from, punch, tail, lead, join, tailFrom }) -> { ok, take, from }   records onto `track` from `from` (the count's
//       downbeat: countIn first, or take counts in by itself with the defaults); punch { from, to }: the take ends
//       itself at `to` and keeps only that range, the band playing `tail` beats on after it (default a bar), then the
//       transport stops; tail without a punch: what stop({ at: 'bar' }) records past its line (default a bar, the
//       last chord's ring). lead: seconds kept before `from` at the take's head (default 0.03 past beat 0: the 30 ms
//       seam, §7.2). join: a step by you the take's commit is one undo step with (the seam re-trims planned before it).
//       tailFrom: the beat the take's part ends (the guitar room's overlap, docs/research/GUITAR-ROOM.md §2.6): what
//       it records past there lands as the clip's tail (core/project.js clipTail), ringing under the next part's take
//       and never muted by it; the landed take's `ringing` says how many beats (input/recorder.js record's tailFrom)
//   stop({ at: 'bar' | 'now', keep: 'song' | 'capture', beat }) -> the take, landed:
//       { ok, take: { track, clip, asset, start, length, ringing }, takes, from, to, bars, tail, txn, label, peaks: { bars },
//         quietLead, label } | { ok, empty: true, line } | { ok, kept: 'capture', capture, line } | { ok, cancelled }
//       'bar': on the bar line by the stop rule (§3.5: pressed in a bar's first beat, the line just gone; later, the
//       next; never under a bar), the beat being the one heard when the key went down (beat: a beat to use instead);
//       deck.stopBeat(beat, { from, bpb }) -> beat, when the stage sets it, decides instead (the blues bar's chorus
//       rule). The recorder runs on `tail` past the line and the take goes in then: one step by you, its txn in the
//       result so the stage joins the part's ops to it. A take with less than a bar over -42 dBFS goes back out (its
//       step undone): { empty, line: 'take.short' } (a punch: less than half its length, when that's under a bar). quietLead: the whole bars at its head under -50 dBFS (the first
//       part drops them, §3.6). 'now' stops at once (Esc); keep: 'capture' puts nothing in the song, the pass kept in
//       Capture ({ kept, line: 'take.esc' }). During the count either one stops it: { cancelled }.
//   keepAfterAll() -> the take, as stop's   ⇧R: the pass stopped with keep: 'capture' put in the song after all, at
//       the bars it was played (recorder.capture). { ok: false, error } when there's none
//   level() -> { peak, db, clip, lvl, channels: [{ ch, peak, db }] } | null      tuner() -> audio.tune(38-1400 Hz) | null
//   latency   get: the round trip used to place takes (s, measured or the browser's guess); set: a measured one (s;
//             0 for the checks, whose fake input has none)
//   stopBeat  null, or the stage's stop rule (above)
//   on(evt, fn): 'state' (state changed), 'count' ({ from, beats, startT, downbeat }), 'take' (stop's result for a take
//       that landed), 'thrown' ({ capture, line }), 'empty' ({ line, why }), 'kit' (state.kit)
//
// state = { run: 'idle' | 'count' | 'take', from, track, punch, stopping: { at, tail } | null, kit: null | 'loading' |
//   'ready' | 'missing', kitPct, last (the last take's result), thrown (a pass Esc kept out: { capture }), input: { open,
//   label, channel, channels, kind, monitoring } }

import { beatsPerBar } from '../../core/music.js';
import { roomOf } from '../../core/liveroom/model.js';
import { instReady, kitHashes } from '../kitload.js';
import { dataProgress, peekData } from '../../kernel/data.js';

const EPS = 1e-6;
const QUIET = -50, KEEP = -42;   // dBFS: a bar at the head under QUIET is dropped (the first part); under a bar over KEEP isn't kept
const decks = new WeakMap();

export function createDeck(app) {
  if (app && typeof app === 'object' && decks.has(app)) return decks.get(app);
  const listeners = new Map();
  const emit = (evt, d) => { for (const fn of listeners.get(evt) || []) { try { fn(d); } catch (e) { console.error('deck listener', evt, e); } } };
  const audio = () => app?.input?.audio || null;
  const rec = () => app?.input?.recorder || null;
  const engine = () => app?.engine || null;
  const store = () => app?.store || null;
  const P = () => store()?.get?.() || { tempo: 120, meter: [4, 4], tracks: [] };
  const bpbNow = () => beatsPerBar(P().meter || [4, 4]);
  const spbNow = () => 60 / (+P().tempo || 120);

  const state = { run: 'idle', from: null, track: null, punch: null, stopping: null, kit: null, kitPct: null, last: null, thrown: null, input: { open: false } };
  let pending = null;      // the count being started (take() waits on it)
  let countGen = 0;        // (a stop during the count's wait for the kit makes that count stale: it never plays)
  let armed = null;        // the take in progress: { track, from, punch, tail, id }
  let afterPunch = null;   // the transport stop a bar after a punch's end
  const changed = () => { readInput(); emit('state', state); };
  function readInput() {
    const st = audio()?.state;
    state.input = st ? { open: !!st.open, label: st.label || '', channel: st.channel || '1', channels: st.channels || 0, kind: st.inputKind || '', monitoring: !!st.monitoring, split: st.split || null } : { open: false };
  }
  function setRun(r) { if (state.run !== r) { state.run = r; changed(); } }

  // the beat heard when the key went down (a key event's timeStamp, the audio clock behind it), else now
  function keyBeat() {
    const e = engine();
    try {
      const ev = globalThis.event, ts = ev && ev.timeStamp, now = performance.now();
      if (Number.isFinite(ts) && ts > 0 && now - ts >= 0 && now - ts < 2000 && typeof e.beatAt === 'function') return e.beatAt(ts);
    } catch { /* no event */ }
    return e.beat;
  }
  // The stop rule (§3.5): pressed in the first beat of a bar, the line just gone (a late press costs no bar); later in
  // the bar, the next line. Never less than a bar from the part's start.
  function lineFor(beat, from, bpb) {
    if (typeof deck.stopBeat === 'function') {
      try { const b = deck.stopBeat(beat, { from, bpb }); if (Number.isFinite(b)) return Math.max(b, from + bpb); } catch (e) { console.error('deck stopBeat', e); }
    }
    const k = from + Math.floor((beat - from) / bpb + EPS) * bpb;
    const line = beat - k < 1 - EPS ? k : k + bpb;
    return Math.max(line, from + bpb);
  }

  // The room's drum kit, while its samples come in: the count waits for them (§3.5), up to 30 s
  function drumsTrack() {
    const room = roomOf(P());
    const id = room?.tracks?.drums;
    return id && P().tracks.some((t) => t.id === id) ? id : null;
  }
  function kitDef(id) {
    const t = P().tracks.find((x) => x.id === id), dev = t?.instrument?.device;
    try { return dev ? app.devices?.getDevice?.(dev) || null : null; } catch { return null; }
  }
  function kitPct(def) {
    let got = 0, total = 0;
    for (const x of kitHashes(def)) { if (peekData(x)) continue; const p = dataProgress(x); if (p) { got += p.got; total += p.total || 0; } }
    return total ? Math.round((100 * got) / total) : null;
  }
  async function waitKit() {
    const id = drumsTrack(), e = engine();
    if (!id || !e) return true;
    let inst = null;
    try { inst = e.instance?.(id, 'instrument') || null; } catch { inst = null; }
    if (!inst?.data || inst.data.state !== 'loading') { state.kit = inst?.data ? (inst.data.state === 'ready' ? 'ready' : 'missing') : null; return true; }
    const def = kitDef(id);
    state.kit = 'loading'; state.kitPct = def ? kitPct(def) : null; emit('kit', state.kit); changed();
    const iv = setInterval(() => { const pc = def ? kitPct(def) : null; if (pc !== state.kitPct) { state.kitPct = pc; changed(); } }, 250);
    const ok = await instReady(e, id, 30000);
    clearInterval(iv);
    state.kit = ok ? 'ready' : 'missing'; state.kitPct = null;
    emit('kit', state.kit); changed();
    return ok;
  }

  async function countIn({ from = 0, bars = null, voice = 'sticks', hits = null, at = null, preroll = true } = {}) {
    const e = engine();
    if (!e) return { ok: false, error: 'No engine here.' };
    if (state.run !== 'idle' || pending) return { ok: false, error: 'The deck is already rolling.' };
    const bpb = bpbNow(), bpm = +P().tempo || 120;
    const n = bars != null && Number.isFinite(+bars) && +bars >= 0 ? Math.min(4, Math.round(+bars)) : bpm >= 160 ? 2 : 1;
    const f = Math.max(0, Number.isFinite(+from) ? +from : 0);
    state.from = f;
    setRun('count');
    const my = ++countGen;
    const job = (async () => {
      await waitKit();
      if (my !== countGen || state.run !== 'count') return { ok: false, error: 'stopped' };
      const opts = n > 0 ? { countIn: { beats: n * bpb, preroll: preroll !== false, voice, hits: Array.isArray(hits) ? hits : null } } : {};
      if (Number.isFinite(+at) && at != null) opts.at = +at;
      try { await e.play(f, opts); } catch (err) { setRun('idle'); return { ok: false, error: String(err?.message || err) }; }
      const k = n > 0 ? e.lastCount : null;
      const startT = k ? k.startT : null;
      const out = { ok: true, from: f, beats: n * bpb, startT, downbeat: k ? k.startT + k.beats * k.spb : null };
      emit('count', out);
      return out;
    })();
    pending = job;
    try { return await job; } finally { if (pending === job) pending = null; }
  }

  async function take({ track = null, from = null, punch = null, tail = null, lead = null, join = null, tailFrom = null } = {}) {
    const r = rec(), e = engine();
    if (!r || !e) return { ok: false, error: 'No recorder here.' };
    if (armed || r.state !== 'idle') return { ok: false, error: 'A take is already going.' };
    const t = track ? store().track(track) : r.targetFor?.('audio');
    if (!t || t.kind !== 'audio') return { ok: false, error: 'No audio track to record onto.' };
    const bpb = bpbNow();
    // the count: the one being started, or the defaults now
    if (pending) { const c = await pending; if (!c.ok) return c; }
    else if (!e.playing) { const c = await countIn({ from: Number.isFinite(+punch?.from) ? +punch.from : from ?? 0 }); if (!c.ok) return c; }
    const f = Number.isFinite(+punch?.from) ? +punch.from : Number.isFinite(+from) && from != null ? +from : state.from ?? 0;
    const to = Number.isFinite(+punch?.to) ? +punch.to : null;
    armed = { track: t.id, from: f, punch: to != null ? { from: f, to } : null, tail: Number.isFinite(+tail) && tail != null ? Math.max(0, +tail) : bpb, id: null };
    state.track = t.id; state.from = f; state.punch = armed.punch; state.stopping = null;
    const ld = Number.isFinite(+lead) && lead != null ? Math.max(0, +lead) : f > EPS ? 0.03 : 0;
    let res = null;
    try { res = await r.record({ audio: t.id, countIn: 0, punch: { from: f, to }, lead: ld, quiet: true, join, tailFrom }); } catch (err) { res = null; armed = null; return { ok: false, error: String(err?.message || err) }; }
    if (!res) { armed = null; setRun('idle'); return { ok: false, error: 'The take didn’t start.' }; }
    armed.id = res.id;
    setRun(r.state === 'rec' ? 'take' : 'count');
    return { ok: true, take: res.id, from: f };
  }

  // what a landed take is, for the stage: its clip, its bars, its peaks (per bar), and whether it's kept
  async function landed(res) {
    const a = armed;
    armed = null;
    state.stopping = null;
    if (!res) { setRun('idle'); return { ok: true, cancelled: true }; }
    if (res.kept === 'capture') {
      state.thrown = res.capture?.length ? { capture: [...res.capture] } : null;
      setRun('idle');
      const out = { ok: true, kept: 'capture', capture: res.capture || [], line: res.capture?.length ? 'take.esc' : null };
      emit('thrown', out);
      return out;
    }
    if (!res.ok) { setRun('idle'); return res; }
    const tk = res.takes?.[0] || null;
    if (res.empty || !tk) {
      setRun('idle');
      const out = { ok: true, empty: true, why: res.nothing || 'nothing', line: 'take.short' };
      emit('empty', out);
      return out;
    }
    const bpb = bpbNow(), spb = spbNow();
    const from = a?.from ?? Math.max(0, Math.round(tk.start / bpb) * bpb), to = Number.isFinite(res.end) ? res.end : tk.start + tk.length;
    // the take's peaks, bar by bar over the part, and how long it was over KEEP
    let bars = [], over = 0;
    try {
      const buf = await engine().assets.get(tk.asset);
      const d = buf?.getChannelData ? buf.getChannelData(0) : buf?.channels?.[0], sr = buf?.sampleRate || buf?.sr || 48000;
      if (d) {
        const at = (beat) => Math.round(((tk.offset || 0) + (beat - tk.start) * spb) * sr);
        for (let b = from; b < to - EPS; b += bpb) {
          const i0 = Math.max(0, at(b)), i1 = Math.min(d.length, at(Math.min(b + bpb, to)));
          let pk = 0; for (let i = i0; i < i1; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
          bars.push(Math.round(20 * Math.log10(pk + 1e-9) * 10) / 10);
        }
        // (20 ms windows over KEEP, summed)
        const W = Math.max(1, Math.round(0.02 * sr)), lim = 10 ** (KEEP / 20);
        for (let i = Math.max(0, at(from)), end = Math.min(d.length, at(to)); i < end; i += W) {
          let pk = 0; for (let j = i; j < Math.min(end, i + W); j++) { const v = Math.abs(d[j]); if (v > pk) pk = v; }
          if (pk > lim) over += W / sr;
        }
      }
    } catch (err) { console.error('deck: reading the take', err); bars = []; over = Infinity; }
    // under a bar over -42 dBFS: not kept (its step undone, nothing left in History). A punch is held to half its
    // length when that's less: a one-bar punch (Bar 5 again) is a bar long, so a bar of it would need no rest at all
    const need = a?.punch ? Math.min(bpb * spb, ((a.punch.to - a.punch.from) * spb) / 2) : bpb * spb;
    if (over < need - 1e-3) {
      try { if (res.txn) store().undo({ id: res.txn, redo: false }); } catch (err) { console.error('deck: taking the take back out', err); }
      setRun('idle');
      const out = { ok: true, empty: true, why: 'under a bar', line: 'take.short' };
      emit('empty', out);
      return out;
    }
    let quietLead = 0;
    while (quietLead < bars.length - 1 && bars[quietLead] < QUIET) quietLead++;
    const out = {
      ok: true, take: { track: tk.track, clip: tk.clip, asset: tk.asset, start: tk.start, length: tk.length, ringing: tk.tail || 0 }, takes: res.takes,
      from, to, bars: Math.round((to - from) / bpb * 1000) / 1000, tail: res.tail || 0, txn: res.txn || null, label: res.label || '', peaks: { bars }, quietLead,
    };
    state.last = out;
    state.thrown = null;
    setRun('idle');
    emit('take', out);
    // (a punch: the band plays on its tail, then the transport stops)
    if (a?.punch && a.tail > 0) stopAfter(a.punch.to + a.tail);
    return out;
  }
  function stopAfter(beat) {
    const e = engine(), gen = e.gen;
    clearInterval(afterPunch);
    afterPunch = setInterval(() => {
      if (!e.playing || e.gen !== gen || state.run !== 'idle') { clearInterval(afterPunch); afterPunch = null; return; }
      if (e.beat >= beat - EPS) { clearInterval(afterPunch); afterPunch = null; e.stop({ live: false }); }
    }, 20);
  }

  async function stop({ at = 'bar', keep = 'song', beat = null } = {}) {
    const r = rec(), e = engine();
    if (!r || !e) return { ok: false, error: 'No recorder here.' };
    const capture = keep === 'capture';
    // during the count (the deck's, or the recorder's wait for the take's 1): it stops, nothing recorded
    if (pending || (state.run === 'count' && r.state !== 'rec') || r.state === 'count') {
      countGen++;
      pending = null;
      state.run = 'idle';
      if (r.state !== 'idle') r.cancel();
      armed = null;
      if (e.playing || e.starting) e.stop();
      changed();
      return { ok: true, cancelled: true };
    }
    if (r.state !== 'rec' || !armed) {
      // no take: the transport stops (a preview, a playback)
      if (e.playing) e.stop();
      setRun('idle');
      return { ok: true, stopped: true };
    }
    // A stop already on its way to its line (Space pressed again in the ring): the same landing, once. The line
    // stays where the first press put it (a press in the ring bar would otherwise be a bar more); Esc ends it now
    if (armed.landing) {
      if (at === 'now') r.stop({ keep: capture ? 'capture' : 'song' });
      return armed.landing;
    }
    armed.mine = true;   // (this stop lands it: the recorder's 'commit' doesn't too)
    let going;
    if (at === 'now') going = r.stop({ keep: capture ? 'capture' : 'song' });
    else {
      const bpb = bpbNow(), b = Number.isFinite(+beat) && beat != null ? +beat : keyBeat();
      const line = lineFor(b, armed.from, bpb);
      state.stopping = { at: line, tail: armed.tail };
      changed();
      going = r.stop({ at: line, tail: armed.tail, keep: capture ? 'capture' : 'song' });
    }
    armed.landing = Promise.resolve(going).then((res) => landed(res));
    return armed.landing;
  }

  async function keepAfterAll() {
    const r = rec();
    const th = r?.thrown;
    if (!th || !th.capture.length) return { ok: false, error: 'Nothing to put in: no pass was stopped with Esc.' };
    if (r.state !== 'idle') return { ok: false, error: 'A take is going.' };
    const res = r.capture(th.capture[0]);
    armed = null;
    return landed(res);
  }

  // the run follows the recorder (a punch ends itself; the count turns into the take at its 1) and the transport
  // (wired once the app has its recorder: the room may make the deck before the input layer is in)
  let wired = false;
  function wire() {
    if (wired || !rec()?.on || !engine()?.on) return;
    wired = true;
    rec().on('state', ({ state: s }) => {
      if (!armed) return;
      if (s === 'rec') setRun('take');
      else if (s === 'count') setRun('count');
      else if (s === 'idle') {
        // (the recorder let the take go by itself, with nothing to commit: the transport stopped under its count, a
        // hidden tab, another song. A take that commits lands first, in the same turn, so this one is armed still)
        const a = armed;
        setTimeout(() => { if (armed === a && rec().state === 'idle') { armed = null; state.stopping = null; state.run = 'idle'; changed(); } }, 0);
      }
    });
    rec().on('commit', (res) => {
      // (a take that ended itself: a punch's end, the tempo moving, a seek)
      if (armed && armed.id && !armed.mine && res && res.take === armed.id) landed(res);
    });
    engine().on('transport', (ev) => {
      if (!ev) return;
      if (ev.why === 'stop' && !ev.playing && !armed && state.run === 'count') { pending = null; setRun('idle'); }
      else if (ev.why === 'countin-end' && !armed && state.run === 'count' && !pending) setRun('idle');
    });
    app.input?.on?.('audio', () => changed());
  }
  wire();

  const deck = {
    state,
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => listeners.get(evt)?.delete(fn);
    },
    countIn: (o) => { wire(); return countIn(o || {}); },
    take: (o) => { wire(); return take(o || {}); },
    stop: (o) => { wire(); return stop(o || {}); },
    keepAfterAll: () => { wire(); return keepAfterAll(); },
    level() {
      const a = audio();
      if (!a?.state?.open) return null;
      return { ...a.level(), channels: a.levels ? a.levels() : [] };
    },
    tuner() {
      const a = audio();
      if (!a?.state?.open) return null;
      return a.tune({ lo: 38, hi: 1400 });
    },
    get latency() { try { return audio()?.latency?.get?.() || 0; } catch { return 0; } },
    set latency(s) { try { audio()?.latency?.set?.(Math.max(0, +s || 0) * 1000, { how: 'set' }); } catch { /* no input */ } },
    stopBeat: null,
  };
  readInput();
  if (app && typeof app === 'object') decks.set(app, deck);
  return deck;
}
