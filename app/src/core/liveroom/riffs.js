// @ts-check
// Riffs [core; guitar room] (docs/research/GUITAR-ROOM.md §2.3, §2.4, §2.5, §4.3): what a riff is, as data, and the
// pure half of the library (ui/liveroom/riffs-db.js keeps them, in IndexedDB, across songs). No DOM, no storage.
//
// A riff is a few bars of your playing, kept: its audio (the dry input, as the song's recordings keep theirs: mono
// Float32 at the device's rate, { sr, channels: [Float32Array] }, engine/assets.js), what it was played at and through,
// and where it came from. The library splits it three ways, so a listing never loads audio:
//   Row (the listing's, small: about 1 KB with its peaks)
//     id          'rf_xxxxxx', forever
//     name        "Riff 12" until you name it (100 characters)
//     at          ms, when it was kept (newest first everywhere)
//     starred     0 | 1 (a number: IndexedDB can't index a boolean)
//     song        the song it came from: its id ('' when none); songTitle: its title, only once the song is named
//                 (null until then; tagSong puts it on every riff from that song when it gets one)
//     tempo       BPM it was played at; beats, bars, meter [n, d]: its length on the drummer's grid
//     offset      s into the audio where its first beat is (a pickup before bar 1 sits before it)
//     tail        s of audio after its last beat (what rang past; never cut off, §2.6)
//     tuning      a core/fretboard.js TUNINGS id ('standard' unless told)
//     key         { root, scale, sure } as read, or null: sure is false until you confirm it (a read isn't trusted)
//     stack       { name, amp } of the stack it went through (the chain itself is the Detail's)
//     duration, sr, channels, bytes   the audio's length (s), rate, channel count and size as kept
//     peaks       Int8Array(2 * PEAK_COLS): each column's min then max, -127..127 of full scale, for drawing
//     peak        the loudest sample, 0..1 (draw the peaks normalised by it if you like)
//     notes       your words about it (2,000 characters)
//     v           1 (the row's version; fields a newer studio adds are kept)
//   Detail: { id, chain: [Link] | null, stackId: string | null }   the stack's chain (core/liveroom/stacks.js Link) and
//           the rack stack it was, when it was one
//   Audio:  { id, sr, channels: [Float32Array] }   exactly an asset store record, so it goes into a song as it is
//
//   cleanRiff(input, { now, id, count }) -> { row, detail, audio } | { error }
//       input: { audio: AudioBuffer | { sr, channels: [Float32Array | Int16Array | number[]] }, tempo, beats?, bars?,
//       meter?, offset?, name?, tuning?, key?, stack? ({ name, chain, id? } or a chain), song? ({ id, title } or a
//       project), starred?, notes?, at?, id? }. Its length on the grid: beats, or bars × the meter's beats, or the
//       audio's length at the tempo, rounded to the beat.
//   songTag(project | { id, title }) -> { song, songTitle }     the tag a riff gets: the title only when it's named
//   peaksOf(channels, cols = PEAK_COLS) -> { peaks: Int8Array, peak }
//   patchRow(row, patch) -> row | { error }    a rename, a star, notes, a confirmed key or a tuning: { name?, starred?,
//       notes?, key?, tuning? } (anything else is refused); a new row, the old one untouched
//   Filters, the same for IndexedDB and memory (so the library answers the same either way):
//     filter = { q?, song?, tuning?, tempo?: [lo, hi], from?, to?, starred?, order?: 'new' | 'old', limit?, after? }
//       q: words, each found in the name or the song's title (case and accents aside); song: a song id; tuning: an
//       id; tempo: BPM, inclusive; from/to: ms, inclusive; starred: true for starred only; limit 1..500 (50);
//       after: the `next` of the page before
//   cleanFilter(f) -> filter (checked, defaults filled in)
//   matches(row, filter) -> bool       every condition but the page
//   rowKey(row) -> [rat, id]           the order: rat = -at, so ascending is newest first; ties by id
//   pageOf(rows, filter) -> { rows, next }    a page of an array (memory, and the tests' reference)
//   placement(row, { tempo, start }) -> { asset, clip, beats, bars, fits, ratio, tail }
//       how the riff goes into a song at a beat: the asset's description (project.assets) and an audio clip (offset at
//       its first beat, length its beats at the song's tempo). fits: the song's tempo is the riff's (within 0.05 BPM);
//       when it isn't, the clip keeps the audio's time (ratio = song tempo / riff tempo) and nothing is stretched.
//   assetIdOf(riffId) -> 'a_' + riffId    one asset per riff, shared by every song it goes into

import { cleanName, newId } from '../project.js';
import { cleanChain, ampOf } from './stacks.js';

export const PEAK_COLS = 256;
export const RIFF_V = 1;
export const NOTES_MAX = 2000;
export const PAGE_MAX = 500;
export const PAGE_DEF = 50;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const UNTITLED = /^\s*(untitled)?\s*$/i;
const TUNING_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const ROOT_RE = /^[A-G](#|b)?$/;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

export const assetIdOf = (id) => 'a_' + id;
// a name as kept: plain text, trimmed, cut to `max` ('' when there's nothing left)
export const nameOf = (v, max = 100) => cleanName(typeof v === 'string' ? v.trim() : '', '', max).trim();

/* ------------------------------------------------------------------------------------------------ the parts */
export function songTag(x) {
  if (!isObj(x)) return { song: '', songTitle: null };
  const id = typeof x.id === 'string' ? x.id.slice(0, 64) : '';
  const t = typeof x.title === 'string' && !UNTITLED.test(x.title) ? nameOf(x.title, 200) : '';
  return { song: id, songTitle: t || null };
}

export function peaksOf(channels, cols = PEAK_COLS) {
  const chs = (Array.isArray(channels) ? channels : []).filter((c) => c && typeof c.length === 'number');
  const n = chs.length ? chs[0].length : 0;
  const peaks = new Int8Array(2 * cols);
  let peak = 0;
  if (!n) return { peaks, peak };
  for (let c = 0; c < cols; c++) {
    const i0 = Math.floor((c * n) / cols), i1 = Math.max(i0 + 1, Math.floor(((c + 1) * n) / cols));
    let lo = 0, hi = 0;
    for (const ch of chs) for (let i = i0; i < i1 && i < n; i++) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    peaks[2 * c] = Math.max(-127, Math.round(Math.max(-1, lo) * 127));
    peaks[2 * c + 1] = Math.min(127, Math.round(Math.min(1, hi) * 127));
    peak = Math.max(peak, -lo, hi);
  }
  return { peaks, peak: Math.min(1, r6(peak)) };
}

// the audio as an asset record's channels: Float32Array each, the same length
function audioOf(a) {
  if (!a) return null;
  let sr, chans;
  if (typeof AudioBuffer !== 'undefined' && a instanceof AudioBuffer) {
    sr = a.sampleRate; chans = [];
    for (let i = 0; i < a.numberOfChannels; i++) chans.push(Float32Array.from(a.getChannelData(i)));
  } else if (isObj(a) && Array.isArray(a.channels) && a.channels.length) {
    sr = Number(a.sr || a.sampleRate);
    chans = a.channels.map((c) => (c instanceof Float32Array ? Float32Array.from(c) : c instanceof Int16Array ? Float32Array.from(c, (v) => v / 32768) : Array.isArray(c) || ArrayBuffer.isView(c) ? Float32Array.from(/** @type {ArrayLike<number>} */ (c)) : null));
  } else return null;
  if (!(sr >= 3000 && sr <= 768000) || !chans.length || chans.some((c) => !c || c.length !== chans[0].length) || chans.length > 8) return null;
  if (!chans[0].length) return null;
  return { sr, channels: chans };
}

function cleanKey(k, sure = false) {
  if (!isObj(k) || typeof k.root !== 'string' || !ROOT_RE.test(k.root)) return null;
  const scale = typeof k.scale === 'string' && /^[a-z][a-z0-9 -]{0,23}$/i.test(k.scale) ? k.scale : 'minor';
  return { root: k.root, scale, sure: k.sure === true || sure === true };
}
const cleanTuning = (t) => (typeof t === 'string' && TUNING_RE.test(t) ? t : null);
const cleanNotes = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, NOTES_MAX) : '');
function cleanMeter(m) {
  return Array.isArray(m) && m.length === 2 && Number.isInteger(m[0]) && Number.isInteger(m[1]) && m[0] >= 1 && m[0] <= 32 && [1, 2, 4, 8, 16].includes(m[1]) ? [m[0], m[1]] : [4, 4];
}

/* ------------------------------------------------------------------------------------------------ a riff */
export function cleanRiff(input, { now = Date.now(), id = null, count = 0 } = {}) {
  if (!isObj(input)) return { error: 'a riff is { audio, tempo, ... }' };
  const audio = audioOf(input.audio);
  if (!audio) return { error: 'a riff needs its audio: an AudioBuffer or { sr, channels: [Float32Array] }, not empty' };
  const tempo = Number(input.tempo);
  if (!(tempo >= 20 && tempo <= 400)) return { error: `a riff needs the tempo it was played at (20 to 400 BPM), not ${input.tempo}` };
  const meter = cleanMeter(input.meter);
  const n = audio.channels[0].length, duration = r6(n / audio.sr);
  const offset = fin(input.offset) ? Math.max(0, Math.min(duration, input.offset)) : 0;
  const bpb = meter[0] * (4 / meter[1]);
  let beats = fin(input.beats) && input.beats > 0 ? input.beats : fin(input.bars) && input.bars > 0 ? input.bars * bpb : Math.max(1, Math.round(((duration - offset) * tempo) / 60));
  beats = Math.min(4096, r6(beats));
  const bars = r6(beats / bpb);
  const tail = r6(Math.max(0, duration - offset - (beats * 60) / tempo));
  const { peaks, peak } = peaksOf(audio.channels);
  const tag = isObj(input.song) ? songTag(input.song) : { song: '', songTitle: null };
  const rid = typeof (id || input.id) === 'string' && /^rf_[a-z0-9]{3,24}$/.test(id || input.id) ? id || input.id : newId('rf');
  const at = fin(input.at) && input.at > 0 ? Math.round(input.at) : now;
  const st = Array.isArray(input.stack) ? { chain: input.stack } : isObj(input.stack) ? input.stack : null;
  const chain = st ? cleanChain(st.chain) : null;
  const stackName = st && typeof st.name === 'string' ? nameOf(st.name) : '';
  const row = {
    v: RIFF_V, id: rid,
    name: nameOf(input.name) || `Riff ${count + 1}`,
    at, rat: -at, starred: input.starred ? 1 : 0,
    song: tag.song, songTitle: tag.songTitle,
    tempo: r6(tempo), beats, bars, meter, offset: r6(offset), tail,
    tuning: cleanTuning(input.tuning) || 'standard',
    key: cleanKey(input.key),
    stack: chain ? { name: stackName || null, amp: ampOf(chain) } : null,
    duration, sr: audio.sr, channels: audio.channels.length, bytes: n * 4 * audio.channels.length,
    peaks, peak, notes: cleanNotes(input.notes),
  };
  const stackId = st && typeof st.id === 'string' && st.id.length <= 64 ? st.id : null;
  return { row, detail: { id: rid, chain, stackId }, audio: { id: rid, sr: audio.sr, channels: audio.channels } };
}

const PATCHABLE = new Set(['name', 'starred', 'notes', 'key', 'tuning']);
export function patchRow(row, patch) {
  if (!isObj(row)) return { error: 'no such riff' };
  if (!isObj(patch)) return { error: 'a change is { name?, starred?, notes?, key?, tuning? }' };
  const bad = Object.keys(patch).filter((k) => !PATCHABLE.has(k));
  if (bad.length) return { error: `a riff's ${bad.join(', ')} can't be changed: only its name, star, notes, key and tuning` };
  const out = { ...row };
  if ('name' in patch) {
    const nm = nameOf(patch.name);
    if (!nm) return { error: 'a riff needs a name' };
    out.name = nm;
  }
  if ('starred' in patch) out.starred = patch.starred ? 1 : 0;
  if ('notes' in patch) out.notes = cleanNotes(patch.notes);
  if ('key' in patch) {
    if (patch.key === null) out.key = null;
    else { const k = cleanKey(patch.key, true); if (!k) return { error: 'a key is { root: "C" .. "B" (with # or b), scale }' }; out.key = k; }
  }
  if ('tuning' in patch) { const t = cleanTuning(patch.tuning); if (!t) return { error: 'a tuning is a tuning id, e.g. "drop-c"' }; out.tuning = t; }
  return out;
}

/* ------------------------------------------------------------------------------------------------ filters */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function cleanFilter(f) {
  const x = isObj(f) ? f : {};
  const words = fold(typeof x.q === 'string' ? x.q.slice(0, 200) : '').split(/\s+/).filter(Boolean).slice(0, 8);
  let tempo = null;
  if (Array.isArray(x.tempo) && x.tempo.length === 2) {
    const lo = fin(x.tempo[0]) ? x.tempo[0] : 0, hi = fin(x.tempo[1]) ? x.tempo[1] : 1000;
    tempo = [Math.min(lo, hi), Math.max(lo, hi)];
  }
  const limit = fin(x.limit) ? Math.max(1, Math.min(PAGE_MAX, Math.round(x.limit))) : PAGE_DEF;
  let after = null;
  if (typeof x.after === 'string') { try { const a = JSON.parse(x.after); if (Array.isArray(a) && a.length === 2 && fin(a[0]) && typeof a[1] === 'string') after = a; } catch { /* a bad page: from the top */ } }
  return {
    words,
    song: typeof x.song === 'string' ? x.song : null,
    tuning: typeof x.tuning === 'string' ? x.tuning : null,
    tempo,
    from: fin(x.from) ? x.from : null,
    to: fin(x.to) ? x.to : null,
    starred: x.starred === true,
    order: x.order === 'old' ? 'old' : 'new',
    limit, after,
  };
}

export function matches(row, f) {
  if (!row) return false;
  if (f.song !== null && row.song !== f.song) return false;
  if (f.tuning !== null && row.tuning !== f.tuning) return false;
  if (f.starred && !row.starred) return false;
  if (f.tempo && !(row.tempo >= f.tempo[0] && row.tempo <= f.tempo[1])) return false;
  if (f.from !== null && row.at < f.from) return false;
  if (f.to !== null && row.at > f.to) return false;
  if (f.words.length) {
    const hay = fold(row.name) + '\n' + fold(row.songTitle);
    for (const w of f.words) if (!hay.includes(w)) return false;
  }
  return true;
}

export const rowKey = (row) => [row.rat, row.id];
export const cmpKey = (a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
export const tokenOf = (row) => JSON.stringify(rowKey(row));

// a page of an array of rows (any order): sorted, filtered, after the token, `limit` long
export function pageOf(rows, filter) {
  const f = isObj(filter) && Array.isArray(filter.words) ? filter : cleanFilter(filter);
  const dir = f.order === 'old' ? -1 : 1;
  const all = rows.filter((r) => matches(r, f)).sort((a, b) => dir * cmpKey(rowKey(a), rowKey(b)));
  let i = 0;
  if (f.after) { const k = f.after; while (i < all.length && dir * cmpKey(rowKey(all[i]), k) <= 0) i++; }
  const page = all.slice(i, i + f.limit);
  return { rows: page, next: i + f.limit < all.length && page.length ? tokenOf(page[page.length - 1]) : null };
}

/* ------------------------------------------------------------------------------------------------ into a song */
export function placement(row, { tempo = 0, start = 0 } = {}) {
  if (!isObj(row) || typeof row.id !== 'string') throw new Error('placement: give a riff');
  const songTempo = Number(tempo) > 0 ? Number(tempo) : row.tempo;
  const fits = Math.abs(songTempo - row.tempo) <= 0.05;
  const ratio = r6(songTempo / row.tempo);
  const beats = fits ? row.beats : r6(row.beats * ratio);
  const asset = { id: assetIdOf(row.id), kind: 'audio', name: row.name, sr: row.sr, channels: row.channels, duration: row.duration };
  const clip = { kind: 'audio', asset: asset.id, start: Math.max(0, Number(start) || 0), length: beats, offset: row.offset, gain: 0, name: row.name };
  return { asset, clip, beats, bars: row.bars, fits, ratio, tail: row.tail };
}
