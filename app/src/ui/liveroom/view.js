// What the stage paints from [ui; stream C] (docs/research/LIVE-ROOM-MODE.md §3, §7.3, §7.5, §9.6): the room's view
// (core/liveroom/session.js readRoom) with the session's state (ui.state.liveRoom: the selected card, the side, the
// run) and the deck's, in one place for the stage, the setlist and the scene; and the small pure pieces the room's
// screens share. Nothing in it lives in the DOM.
//
//   liveView(ctx, extra) -> readRoom's view and { run, side, card, menu, beat, bar, counting, playing, levels,
//       reduced, live, count, rolling, loading, plugged, learning, heard, title, step, ... }: the scene's view
//       (ui/liveroom/pixels sceneOf().draw and windowFor read it, its header says each field). levels: each role's meter
//       now ({ guitarL, guitarR, drums, bass, master, input }: dBFS peaks, -120 for silence); live: the same and the
//       drummer's hits in 0..1, as the scene takes them
//   runPlan(store, plan, { by, label?, reason? }) -> the dispatch's result   a plan's ops in one step, and what it
//       needs after them (plan.after, core/liveroom/plans.js) joined to it: one undo step
//   pairAt(history) -> { take, learn, section } | null    the newest two steps are a take of a part and the band's
//       learning of it (reasons room:take:<s>, room:learn:<s>), the learning straight after: ⌘Z in the room undoes
//       both (§7.3). redoPair(redoable): the same for ⇧⌘Z, the take next to redo and its learning after it
//   learnAlone(history) -> { learn, section } | null      the newest step is a learning whose take isn't straight under
//       it (something landed between): ⌘Z undoes it alone and says so
//   snapshot(p) -> what the room remembers of a song as it goes through the glass (the read-back compares it)
//   readBack(before, p, steps, { names }) -> { changes: [{ text, by, id, kind }], tempo, meter } what changed in the
//       control room since the snapshot (§7.5), each change its words and its author
//   clock(secs) -> "1:51"; tuningWords(id) -> "drop C"; low(s), cap(s)
//   envelope(buffer, n, { from, secs }) -> Float32Array(n)   a take's loudness in n steps (0..1), for its card

import { readRoom } from '../../core/liveroom/session.js';
import { roomOf } from '../../core/liveroom/model.js';

export const low = (s) => String(s ?? '').toLowerCase();
export const cap = (s) => { const t = String(s ?? ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };
export function clock(secs) { const s = Math.max(0, Math.round(Number(secs) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
// (a tuning id in a sentence: drop-c is "drop C", b-standard "B standard")
export function tuningWords(id) {
  if (!id || typeof id !== 'string') return '';
  if (id === 'standard') return 'E standard';
  if (/^drop-[a-g]$/.test(id)) return `drop ${id.slice(5).toUpperCase()}`;
  if (/^[a-g]-standard$/.test(id)) return `${id[0].toUpperCase()} standard`;
  return id.replace(/-/g, ' ');
}

const reducedMotion = () => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; } };

// a meter's dBFS as the scene takes it (0..1: -48 dB is 0, -6 dB is 1, the prototype's mapping)
const unit = (db) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 48) / 42)) : 0);
// The drummer's hits at a beat, as the scene's envelopes (1 on the note, falling over about 120 ms): the notes of the
// clips playing on a track there (the song as it sounds, a preview's band among them), by the kit's pieces
const PIECE = { 35: 'kick', 36: 'kick', 37: 'snare', 38: 'snare', 39: 'snare', 40: 'snare', 42: 'hat', 44: 'hat', 46: 'hat', 49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash', 51: 'crash', 59: 'crash', 41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom' };
const DECAY = 0.12;
function hitsOn(track, beat, spb, piece, out) {
  for (const c of track?.clips || []) {
    if (c.mute || c.kind !== 'notes' || beat < c.start - 1e-6 || beat > c.start + c.length + 0.5) continue;
    for (const n of c.notes || []) {
      const at = c.start + n.t, ago = (beat - at) * spb;
      if (ago < 0 || ago > 0.5 || at > c.start + c.length + 1e-6) continue;
      const k = piece(n.p);
      if (!k) continue;
      const e = (n.v ?? 0.8) * Math.exp(-ago / DECAY);
      if (e > (out[k] || 0)) out[k] = Math.round(e * 1000) / 1000;
    }
  }
}

export function liveView(ctx, extra = {}) {
  const v = ctx.view();
  const L = ctx.ui?.state?.liveRoom || {};
  const eng = ctx.app?.engine || null;
  const meters = eng?.meters || null;
  const peak = (id) => (id && meters?.tracks?.[id] ? meters.tracks[id].peak ?? -120 : -120);
  const levels = { master: meters?.master?.peak ?? -120 };
  for (const [role, id] of Object.entries(v.roles || {})) levels[role] = peak(id);
  let input = null;
  try { input = ctx.deck?.level?.() ?? null; } catch { input = null; }
  levels.input = typeof input === 'number' ? input : input?.peak ?? -120;
  const beat = eng?.playing ? eng.beat : null;
  const bpb = v.bpb || 4;
  const run = L.run || 'idle';
  const deck = ctx.deck?.state || null;
  // what's live, for the scene (ui/liveroom/pixels: levels and hits in 0..1): your input, each side's own meter, the
  // bass, the master's needles, the drummer's hits on the beat heard
  const live = {
    input: unit(levels.input), L: unit(levels.guitarL ?? levels.guitar), R: unit(levels.guitarR ?? levels.lead), bass: unit(levels.bass),
    master: [unit(levels.master), unit(levels.master)],
  };
  const p = ctx.store?.get?.() || null;
  if (p && beat != null) {
    const spb = 60 / (p.tempo || 120), track = (role) => (v.roles?.[role] ? p.tracks.find((t) => t.id === v.roles[role]) : null);
    hitsOn(track('drums'), beat, spb, (m) => PIECE[m], live);
    hitsOn(track('shaker'), beat, spb, () => 'shaker', live);
    hitsOn(track('cajon'), beat, spb, () => 'cajon', live);
  }
  // the count's number on the kick head while the drummer counts you in
  const k = eng?.counting || null;
  let count = null;
  if (k && beat != null) { const i = Math.floor(beat - k.from + 1e-6); if (i >= 0 && i < k.beats) count = (i % bpb) + 1; }
  const takes = run === 'count' || run === 'take';
  // (the phone's window: your amp in the soundcheck, both in a double, the kit while a feel is chosen)
  const step = L.side === 'R' && takes ? 'double' : L.menu ? 'feel' : !v.taken && !takes ? 'soundcheck' : null;
  return {
    ...v,
    run, side: L.side || 'L', card: L.card || null, menu: L.menu || null,
    beat, bar: beat == null ? null : Math.floor(beat / bpb) + 1, counting: k, playing: !!eng?.playing,
    levels, reduced: reducedMotion(), deck,
    live, count, rolling: takes || run === 'play' || !!eng?.playing,
    loading: deck?.kit === 'loading' ? Math.max(0, Math.min(0.99, (deck.kitPct ?? 0) / 100)) : null,
    plugged: !!deck?.input?.open, learning: run === 'learn',
    // the blues bar's neon: on from your first note (a take in the song, or the input moving under a take)
    heard: !!v.taken || (takes && live.input > 0.1),
    title: p?.title || '', ...(step ? { step } : {}),
    ...extra,
  };
}

export function runPlan(store, plan, { by = 'you', label = null, reason = null } = {}) {
  if (!plan || !Array.isArray(plan.ops) || !plan.ops.length) return { ok: false, error: 'nothing to do' };
  const r = store.dispatch(plan.ops, { by, label: label || plan.label || '', reason: reason || plan.reason || '' });
  if (!r.ok) return r;
  if (typeof plan.after === 'function') {
    let more = [];
    try { more = plan.after(store.get()) || []; } catch (e) { console.error('liveroom: a plan\'s after', e); }
    if (more.length) {
      const j = store.dispatch(more, { by, join: r.txn.id });
      if (!j.ok) console.error('liveroom: a plan\'s after didn\'t go in', j.error);
    }
  }
  return r;
}

const sectionOfReason = (r, kind) => { const m = new RegExp(`^room:${kind}:(.+)$`).exec(String(r || '')); return m ? m[1] : null; };
export function pairAt(history) {
  const h = history || [];
  const learn = h[h.length - 1], take = h[h.length - 2];
  const s = sectionOfReason(learn?.reason, 'learn');
  if (!s || !take || sectionOfReason(take.reason, 'take') !== s || take.by !== 'you') return null;
  return { take, learn, section: s };
}
export function redoPair(redoable) {
  const u = redoable || [];
  const take = u[u.length - 1], learn = u[u.length - 2];
  const s = sectionOfReason(take?.reason, 'take');
  if (!s || !learn || sectionOfReason(learn.reason, 'learn') !== s || take.revert || learn.revert) return null;
  return { take, learn, section: s };
}
export function learnAlone(history) {
  const h = history || [];
  const learn = h[h.length - 1];
  const s = sectionOfReason(learn?.reason, 'learn');
  if (!s || pairAt(h)) return null;
  return { learn, section: s };
}

/* ------------------------------------------------------------------------------------------------ the read-back */
export function snapshot(p) {
  const v = readRoom(p);
  return {
    at: Date.now(),
    tempo: p.tempo, meter: [...(p.meter || [4, 4])],
    tracks: (p.tracks || []).map((t) => ({ id: t.id, name: t.name, kind: t.kind, gain: t.gain, pan: t.pan, inserts: JSON.stringify((t.inserts || []).map((x) => [x.device, x.params, x.on])) })),
    master: JSON.stringify((p.master?.inserts || []).map((x) => [x.device, x.params, x.on])) + `|${p.master?.gain}`,
    sections: (p.sections || []).map((s) => ({ id: s.id, name: s.name })),
    band: Object.fromEntries(v.cards.flatMap((c) => c.band.map((b) => [b.clip, b.house]))),
    roles: { ...v.roles },
    took: v.parts.some((c) => !c.empty),
    room: !!roomOf(p),
  };
}
const dB = (x) => `${Math.abs(Math.round(x * 10) / 10)} dB`;
const roleWords = { drums: 'the drums', bass: 'the bass', guitarL: 'the left guitar', guitarR: 'the right guitar', guitar: 'the guitar', lead: 'the lead', heard: 'the riff as heard' };

export function readBack(before, p, steps = []) {
  if (!before) return { changes: [] };
  const v = readRoom(p);
  const changes = [];
  const role = (id) => Object.entries(v.roles).find(([, t]) => t === id)?.[0] || null;
  const byOf = (pred) => { for (let i = steps.length - 1; i >= 0; i--) if (pred(steps[i])) return steps[i].by; return 'you'; };
  const touches = (s, type, key) => (s.ops || []).some((o) => o.type === type && (key == null || o.track === key || o.section === key));
  const was = new Map(before.tracks.map((t) => [t.id, t]));
  // the house's faders and pans, moved
  for (const t of p.tracks || []) {
    const w = was.get(t.id), r = role(t.id);
    if (!w || !r) continue;
    if (Math.abs((t.gain || 0) - (w.gain || 0)) > 0.05) {
      const d = (t.gain || 0) - (w.gain || 0);
      changes.push({ id: `glass.levels:${t.id}`, kind: 'level', track: t.name, by: byOf((s) => touches(s, 'track.set', t.id)), text: `${roleWords[r] || low(t.name)} came ${d > 0 ? 'up' : 'down'} ${dB(d)}` });
    }
    if (Math.abs((t.pan || 0) - (w.pan || 0)) > 0.01) changes.push({ id: `glass.pan:${t.id}`, kind: 'pan', track: t.name, by: byOf((s) => touches(s, 'track.set', t.id)), text: `${roleWords[r] || low(t.name)} moved in the stereo` });
    const ins = JSON.stringify((t.inserts || []).map((x) => [x.device, x.params, x.on]));
    if (ins !== w.inserts && (r === 'guitarL' || r === 'guitarR' || r === 'guitar' || r === 'lead')) changes.push({ id: `glass.amp:${t.id}`, kind: 'amp', track: t.name, by: byOf((s) => (s.ops || []).some((o) => o.type?.startsWith('insert.') && o.track === t.id)), text: `the amp on ${roleWords[r]} was set by hand` });
  }
  // a role's track that went
  for (const [r, id] of Object.entries(before.roles || {})) if (!v.roles[r] && was.has(id)) changes.push({ id: `glass.gone:${r}`, kind: 'gone', by: byOf((s) => touches(s, 'track.remove', id)), text: `${roleWords[r] || 'a track of the room\'s'} went` });
  // tracks that came in (after what moved on the room's own)
  for (const t of p.tracks || []) {
    if (was.has(t.id) || role(t.id)) continue;
    const by = byOf((s) => (s.ops || []).some((o) => o.type === 'track.add'));
    changes.push({ id: `glass.track:${t.id}`, kind: 'track', track: t.name, audio: t.kind === 'audio', by, text: `${t.kind === 'audio' ? 'an audio track' : `a ${low(t.name)} track`} came in` });
  }
  // the master
  const m = JSON.stringify((p.master?.inserts || []).map((x) => [x.device, x.params, x.on])) + `|${p.master?.gain}`;
  if (m !== before.master) changes.push({ id: 'glass.master', kind: 'master', by: byOf((s) => (s.ops || []).some((o) => o.track === 'master' || o.type === 'master.set')), text: 'the master was changed' });
  // the band's notes, edited
  for (const c of v.cards) for (const b of c.band) if (before.band[b.clip] === true && !b.house) changes.push({ id: `glass.band:${b.clip}`, kind: 'band', part: c.name, by: byOf((s) => (s.ops || []).some((o) => o.clip === b.clip)), text: `the ${low(c.name)} ${b.track === v.roles.bass ? 'bass' : 'drums'} were edited` });
  // sections that came in, went or were renamed
  const secs = new Map(before.sections.map((s) => [s.id, s]));
  for (const s of p.sections || []) {
    const w = secs.get(s.id);
    const card = v.cards.find((c) => c.id === s.id);
    if (!w && card && !card.end) changes.push({ id: `glass.section:${s.id}`, kind: 'section', part: s.name, by: byOf((s2) => (s2.ops || []).some((o) => o.type === 'section.add' || o.type === 'section.duplicate')), text: `${low(s.name)} came in as a part` });
    else if (w && w.name !== s.name) changes.push({ id: `glass.rename:${s.id}`, kind: 'rename', part: s.name, by: byOf((s2) => touches(s2, 'section.set', s.id)), text: `${low(w.name)} is called ${low(s.name)} now` });
  }
  for (const w of before.sections) if (!(p.sections || []).some((s) => s.id === w.id)) changes.push({ id: `glass.cut:${w.id}`, kind: 'cut', part: w.name, by: byOf((s) => (s.ops || []).some((o) => o.type === 'section.remove' || o.type === 'time.remove')), text: `${low(w.name)} went` });
  const tempo = before.took && Math.abs((p.tempo || 0) - (before.tempo || 0)) > 0.01 ? { bpm: Math.round(p.tempo * 10) / 10, was: Math.round(before.tempo * 10) / 10 } : null;
  const meter = (p.meter?.[0] !== before.meter[0] || p.meter?.[1] !== before.meter[1]) && !(p.meter?.[0] === 4 && p.meter?.[1] === 4) ? { meter: `${p.meter[0]}/${p.meter[1]}` } : null;
  return { changes, tempo, meter };
}

// The words of a list: "a, b and c"
export function listWords(xs) {
  const a = xs.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

/* ------------------------------------------------------------------------------------------------ a take's envelope */
export function envelope(buffer, n = 74, { from = 0, secs = null } = {}) {
  const out = new Float32Array(n);
  if (!buffer || typeof buffer.getChannelData !== 'function') return out;
  const sr = buffer.sampleRate || 48000, data = buffer.getChannelData(0);
  const a = Math.max(0, Math.floor(from * sr)), b = Math.min(data.length, secs == null ? data.length : Math.floor((from + secs) * sr));
  const step = Math.max(1, Math.floor((b - a) / n));
  let top = 1e-9;
  for (let i = 0; i < n; i++) {
    let pk = 0;
    for (let j = a + i * step, e = Math.min(b, j + step); j < e; j += 4) { const x = Math.abs(data[j]); if (x > pk) pk = x; }
    out[i] = pk; if (pk > top) top = pk;
  }
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i] / top);
  return out;
}
