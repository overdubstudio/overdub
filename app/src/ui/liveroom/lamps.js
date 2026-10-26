// @ts-check
// The soundcheck's readings [ui; stream A] (docs/research/LIVE-ROOM-MODE.md §3.3, §8): what the lamps
// (ui/liveroom/soundcheck.js) make of the input, pure, so Node checks them (tools/liveroom/checks-input.js).
//
//   levelVerdict(db) -> 'clip' | 'hot' | 'ok' | 'quiet' | null      a peak (dBFS) against the green, −18 to −6
//   tuningsFor(midi, tunings) -> [{ id, name }]   the tunings whose open low string is that note (the standard and drop
//       families of six strings, fretboard.js TUNINGS read when it's asked: stream B's ids join it), in the order the
//       room asks: drop first from C up, standard first under it (B standard, then drop B)
//   tuningName(t) -> its name in a sentence ('E standard', 'drop C')
//   leanLine({ leans, measured }) -> { id: 'line.lean', vars: { ms, late } } | null   the last two takes' lean (ms,
//       + late), when the line-up is a guess and both lean the same way: over 12 ms, within 6 ms of each other (§8)
//   NOTE(midi) -> the note's name ('C', 'E♭')
//

import { TUNINGS } from '../../core/fretboard.js';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const NOTE = (m) => NAMES[((Math.round(m) % 12) + 12) % 12];
const STD = '5,5,5,4,5', DROP = '7,5,5,4,5';

export function levelVerdict(db) {
  if (!Number.isFinite(db) || db < -50) return null;
  if (db >= -1) return 'clip';
  if (db > -6) return 'hot';
  if (db >= -18) return 'ok';
  return 'quiet';
}

export function tuningName(t) {
  if (!t) return '';
  const n = String(t.name || t.id || '');
  if (/^standard$/i.test(n)) return `${NOTE(t.strings[0])} standard`;
  if (/^drop /i.test(n)) return `drop ${n.slice(5)}`;
  return n.length > 1 && n[1] === n[1].toLowerCase() && n[1] !== ' ' ? n[0].toLowerCase() + n.slice(1) : n;
}

/** @param {number} midi @param {Record<string, any>} [tunings] */
export function tuningsFor(midi, tunings = TUNINGS) {
  const m = Math.round(midi), out = [];
  for (const [id, t] of Object.entries(tunings || {})) {
    const s = t && Array.isArray(t.strings) ? t.strings : null;
    if (!s || s.length !== 6 || s[0] !== m) continue;
    const iv = s.slice(1).map((x, i) => x - s[i]).join(',');
    if (iv !== STD && iv !== DROP) continue;
    out.push({ id, name: tuningName({ ...t, id }), drop: iv === DROP });
  }
  // (drop C before C standard; B standard before drop B)
  out.sort((a, b) => (m >= 36 ? Number(b.drop) - Number(a.drop) : Number(a.drop) - Number(b.drop)));
  return out.map(({ id, name }) => ({ id, name }));
}

export function leanLine({ leans = [], measured = false } = {}) {
  if (measured) return null;
  const xs = (leans || []).filter((x) => Number.isFinite(x)).slice(-2);
  if (xs.length < 2) return null;
  const [a, b] = xs;
  if (Math.sign(a) !== Math.sign(b) || Math.abs(a) <= 12 || Math.abs(b) <= 12 || Math.abs(a - b) > 6) return null;
  return { id: 'line.lean', vars: { ms: Math.round((Math.abs(a) + Math.abs(b)) / 2), late: a > 0 } };
}
