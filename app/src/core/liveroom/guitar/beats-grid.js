// @ts-check
// The drummer's grids and small plans [core; the guitar room's DRUMMER stream] (docs/research/GUITAR-ROOM.md §2.2,
// §2.7; design/mock/guitar-room-2/ shot 03d, the drummer's book). Pure: what the riser's cards and the book draw (a
// groove's bar as rows of sixteen steps), what a click on a step makes of a card's bar, the riser's cards as the song
// holds them, the book's shelves, the tempo and a tap. beats.js holds the song's beats and their plans (its exports are
// frozen); this file is the drummer stream's own, beside it.
//
//   RISER_MAX = 5                    the cards the riser holds (the song may keep up to model.js ROOM_LIMITS.pins)
//   STEPS = 16                       a bar's steps (sixteenths in 4/4)
//   rowsOf(groove, { bpb }) -> [{ row, label, cells: number[16] }]   a groove's first bar, a row per piece it plays,
//                                    cymbals at the top, the kick at the foot; a cell 0 (rest), 1 (a hit), 2 (an accent)
//   miniOf(groove, { bpb }) -> { top, snare, kick }   three rows of 16 for a card's little picture (the top: whichever
//                                    cymbal keeps time)
//   stepped(groove, row, step, { bpb }) -> hits [{ t, row, v }]   the groove's first bar as a card keeps it (pins[].hits)
//                                    with one step turned: a rest takes a hit, a hit an accent, an accent goes
//   riserOf(p) -> [{ id, groove, name, label, edited, g }]   the riser's cards (beats.js DEFAULT_PINS when the song has
//                                    none), each with its groove (g, null when the book has no such groove)
//   shortName(name) -> string        a card's name from a groove's ("Double-kick gallop" -> "Double-kick gallop" cut to
//                                    the first two words and 12 letters, as the second mock had them)
//   nextPinId(pins) -> 'p<n>'        a new card's id, past every id given (the caller adds the ids the song's beats
//                                    still name, so a part's 'pin:<id>' never comes to mean another card)
//   shelves() -> [{ id, name, blurb, tempo, parts: [{ part, label, grooves }] }]   the book's styles, the metal club's
//                                    shelf first (modern metal, metal, extreme, punk, rock), then the library's order
//   TEMPO = { lo: 40, hi: 260 }      the drummer's range (the guide's own)
//   planTempo(p, bpm) -> { ops, label, bpm, error? }   project.set { tempo } (refused once a take is in: the takes were
//                                    played at the tempo they were played at)
//   tapTempo(times) -> bpm | null    four taps or more (ms), steady within 8 %, to a whole BPM in TEMPO
//   hasTakes(p) -> bool              any audio clip on the song's tracks

import { library, PART_LABEL } from '../../grooves.js';
import { beatsPerBar } from '../../music.js';
import { roomOf } from '../model.js';
import { DEFAULT_PINS, grooveOfBeat } from './beats.js';

export const RISER_MAX = 5;
export const STEPS = 16;
export const TEMPO = Object.freeze({ lo: 40, hi: 260 });
const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;

// cymbals first (the hand that keeps time), then the snare's family, the toms high to low, the kick last
const ORDER = ['china', 'splash', 'crash', 'crash2', 'ride', 'ride2', 'bell', 'open', 'hat', 'pedal', 'snare', 'rim', 'stick', 'xstick', 'clap', 'tom1', 'tom2', 'tom3', 'tom4', 'floor', 'floor2', 'lofloor', 'kick2', 'kick'];
const TOPS = ['hat', 'open', 'ride', 'ride2', 'bell', 'crash', 'crash2', 'china', 'splash'];
const LABEL = { hat: 'Hat', open: 'Open hat', pedal: 'Pedal', ride: 'Ride', ride2: 'Ride 2', bell: 'Bell', crash: 'Crash', crash2: 'Crash 2', china: 'China', splash: 'Splash', snare: 'Snare', rim: 'Rim', stick: 'Stick', xstick: 'Stick', clap: 'Clap', tom1: 'Tom 1', tom2: 'Tom 2', tom3: 'Tom 3', tom4: 'Tom 4', floor: 'Floor', floor2: 'Floor 2', lofloor: 'Floor', kick: 'Kick', kick2: 'Kick 2' };
const rank = (row) => { const i = ORDER.indexOf(row); return i < 0 ? ORDER.indexOf('pedal') + 0.5 : i; };
const cellOf = (v) => (v >= 0.95 ? 2 : 1);
const bpbOf = (g, bpb) => bpb || beatsPerBar(g?.meter || [4, 4]);
// a hit's step in the bar, or -1 off the bar
const stepOf = (t, bpb) => { const k = Math.round((t / bpb) * STEPS); return t < bpb - EPS && k < STEPS ? k : -1; };

export function rowsOf(g, { bpb = 0 } = {}) {
  const B = bpbOf(g, bpb), rows = new Map();
  for (const x of g?.hits || []) {
    const k = stepOf(x.t, B);
    if (k < 0 || typeof x.row !== 'string') continue;
    if (!rows.has(x.row)) rows.set(x.row, Array(STEPS).fill(0));
    const r = rows.get(x.row);
    r[k] = Math.max(r[k], cellOf(x.v));
  }
  // (every bar shows a cymbal, the snare and the kick, so a step can always be added on them)
  if (![...rows.keys()].some((r) => TOPS.includes(r))) rows.set('hat', Array(STEPS).fill(0));
  for (const row of ['snare', 'kick']) if (!rows.has(row)) rows.set(row, Array(STEPS).fill(0));
  return [...rows.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([row, cells]) => ({ row, label: LABEL[row] || row[0].toUpperCase() + row.slice(1), cells }));
}

export function miniOf(g, { bpb = 0 } = {}) {
  const B = bpbOf(g, bpb), out = { top: Array(STEPS).fill(0), snare: Array(STEPS).fill(0), kick: Array(STEPS).fill(0) };
  const count = new Map();
  for (const x of g?.hits || []) if (TOPS.includes(x.row) && stepOf(x.t, B) >= 0) count.set(x.row, (count.get(x.row) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'hat';
  for (const x of g?.hits || []) {
    const k = stepOf(x.t, B);
    if (k < 0) continue;
    const r = x.row === top ? 'top' : ['snare', 'rim', 'clap', 'stick'].includes(x.row) ? 'snare' : ['kick', 'kick2'].includes(x.row) ? 'kick' : null;
    if (r) out[r][k] = Math.max(out[r][k], cellOf(x.v));
  }
  return out;
}

export function stepped(g, row, step, { bpb = 0 } = {}) {
  const B = bpbOf(g, bpb);
  const bar = (g?.hits || []).filter((x) => x.t < B - EPS && typeof x.row === 'string').map((x) => ({ t: r4(x.t), row: x.row, v: r4(Math.max(0.05, Math.min(1, x.v))) }));
  const at = (x) => x.row === row && stepOf(x.t, B) === step;
  const here = bar.filter(at);
  let out;
  if (!here.length) out = [...bar, { t: r4((step * B) / STEPS), row, v: 0.8 }];
  else if (here.every((x) => x.v < 0.95)) out = bar.map((x) => (at(x) ? { ...x, v: 1 } : x));
  else out = bar.filter((x) => !at(x));
  return out.sort((a, b) => a.t - b.t || a.row.localeCompare(b.row)).slice(0, 256);
}

export const shortName = (name) => String(name || 'Beat').split(/[,:(]/)[0].trim().split(/\s+/).slice(0, 2).join(' ').slice(0, 12).trim() || 'Beat';

export function riserOf(p) {
  const pins = Array.isArray(roomOf(p)?.pins) && roomOf(p).pins.length ? roomOf(p).pins : DEFAULT_PINS;
  return pins.map((x) => {
    const g = grooveOfBeat(p, `pin:${x.id}`) || grooveOfBeat(p, x.groove);
    const base = grooveOfBeat(p, x.groove);
    return { id: x.id, groove: x.groove, name: x.name || shortName(base?.name), label: base?.name || x.groove, edited: Array.isArray(x.hits), g };
  });
}

export function nextPinId(pins) {
  let n = 0;
  for (const x of pins || []) { const m = /^p(\d+)$/.exec(x?.id || ''); if (m) n = Math.max(n, Number(m[1])); }
  return `p${n + 1}`;
}

const FIRST = ['modernmetal', 'metal', 'extreme', 'punk', 'rock'];
let SHELVES = null;
export function shelves() {
  if (SHELVES) return SHELVES;
  const L = library();
  const order = [...FIRST.map((id) => L.styles.find((s) => s.id === id)).filter(Boolean), ...L.styles.filter((s) => !FIRST.includes(s.id))];
  SHELVES = order.map((s) => ({
    id: s.id, name: s.name, blurb: s.blurb || '', tempo: s.tempo || null,
    parts: ['intro', 'verse', 'chorus', 'bridge', 'half', 'fill', 'ending'].map((part) => ({ part, label: part === 'fill' ? 'Fills' : part === 'ending' ? 'Endings' : PART_LABEL[part], grooves: s.grooves.filter((g) => g.part === part) })).filter((x) => x.grooves.length),
  }));
  return SHELVES;
}

export const hasTakes = (p) => (p?.tracks || []).some((t) => (t.clips || []).some((c) => c.kind === 'audio'));

export function planTempo(p, bpm) {
  const now = +p?.tempo || 120, to = Math.max(TEMPO.lo, Math.min(TEMPO.hi, Math.round(+bpm)));
  if (!Number.isFinite(to)) return { ops: [], label: '', bpm: now, error: 'That isn’t a tempo.' };
  if (to === now) return { ops: [], label: '', bpm: now };
  if (hasTakes(p)) return { ops: [], label: '', bpm: now, error: 'The tempo’s set once there’s a take.' };
  return { ops: [{ type: 'project.set', patch: { tempo: to } }], label: `Tempo ${to}`, bpm: to };
}

export function tapTempo(times) {
  const t = (times || []).filter(Number.isFinite).slice(-6);
  if (t.length < 4) return null;
  const iv = t.slice(1).map((x, i) => x - t[i]);
  const m = iv.reduce((a, b) => a + b, 0) / iv.length;
  if (!(m > 0) || iv.some((x) => Math.abs(x - m) / m > 0.08)) return null;
  return Math.max(TEMPO.lo, Math.min(TEMPO.hi, Math.round(60000 / m)));
}
