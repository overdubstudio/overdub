// @ts-check
// The shop's catalogue [ui; the guitar room's SHOP stream] (docs/research/GUITAR-ROOM.md §2.9; the second mock's
// design/mock/guitar-room-2/data.js, made real). Who everything in the shop is and where it hangs: every amp, pedal, cab
// and mic is the real one in the guitar gear (devices/guitar/gear/, registered by devices/guitar/), so
// its name, category, one-line sound and "in the spirit of" are read from the registry, never written here. Pure but
// for the registry: no DOM, no store.
//
//   AMP_SECTIONS, ampsBySection() -> [{ tone, label, word, amps: [def] }]   the amp wall, Claw'd-o-Matic's tones in its
//       wall's order (the Half Stack, the house's own head, hangs with the high-gain amps)
//   PEDAL_CATS, pedalsByCat() -> [{ cat, word, line, pedals: [def] }]       the pedal case's drawers, top to bottom
//   toneWord(tone), CAT_WORD, typeWord(def), inLoop(def), ordinal(n)
//   isAmp(id), ampKind(id) -> 'clawd' | 'stack' | null
//   CABS, MICS, CAB_IDS, MIC_IDS, MEASURED_CABS (the six measured 4x12s, by id), GUITAR_CABS (the designed cabs a
//   guitarist puts under a head), BASS_CABS, cabIndex(id), cabAt(index), isMeasured(id), cabDefault(ampId)
//   cabBox(cabId) -> { w, h }      how big a cab stands, in world units, from its speakers
//   whereOnCone(r), onCone(r), inches(d)                                     a mic's place in words
//   cabOf(link) -> CabView | null  the cab and mics of an amp link, read from its params, an unset CAB being the amp's
//       default (amp.*: a measured cab or the cab network; the Half Stack: its measured cabs): { kind, cab, measured,
//       def (the amp's default cab), cabName, cabBlurb, mic1: { type, pos, dist, ang } | null (none on a measured cab:
//       its mic is in the measurement), mic2: {..., blend, flip} | null, opts? }
//   STACK_CABS                     the Half Stack's measured cabs, as its CAB param lists them
//   AMP_TRIM { [deviceId]: dB }    MEASURED: how much louder (+) or quieter (-) each amp, carried onto the club's stack at
//       its own default knobs and the club's cab, needs to be to read as the club's stack does (the metal DI fixtures,
//       rendered offline, BS.1770; tools/liveroom/checks-shop.js measures every one again)
//   carryLevel(id) -> { key, value } | null     the level knob a carried amp comes in at (MASTER on a Claw'd-o-Matic amp:
//       3 dB a step; LEVEL on the Half Stack: dB), so it lands as loud as the club's stack
//   carriedAmp(id, prev) -> Link   the amp as it's carried onto your stack: its own default knobs at carryLevel, on your
//       cab with your mics where they were when you chose them (both Claw'd-o-Matic amps), else on its own default cab
//   describeStack(chain) -> string   a stack in a phrase ("Kraken on a 4x12 Modern, a gate and a treble booster in front")

import '../../../devices/guitar/index.js';
import { CAB_IDS, MIC_IDS, gear } from '../../../devices/guitar/index.js';
import { isMeasured, cabDefault } from '../../../devices/guitar/amps.js';
import { getDevice, listDevices, paramValues } from '../../../devices/registry.js';

/* ------------------------------------------------------------------------------------------------ the amp wall */
export const AMP_SECTIONS = Object.freeze([
  { tone: 'clean', label: 'CLEAN', word: 'Clean' },
  { tone: 'crunch', label: 'CRUNCH', word: 'Crunch' },
  { tone: 'weird', label: 'WEIRD', word: 'Weird' },
  { tone: 'high', label: 'HIGH GAIN', word: 'High gain' },
  { tone: 'bass', label: 'BASS', word: 'Bass' },
]);
export const toneWord = (t) => (AMP_SECTIONS.find((s) => s.tone === t) || { word: 'Amp' }).word;
// (the wall's amps: every Claw'd-o-Matic amp and the house's Half Stack; the Iso Cab is a cab and the Y Cable a bass
// split, so neither hangs here)
const WALL_EXTRA = ['core.stack'];
export const toneOf = (d) => (d?.tone || (d?.id === 'core.stack' ? 'high' : 'weird'));
export function ampsBySection() {
  const all = listDevices({ cat: 'amp' }).filter((d) => d.kind === 'effect' && (d.id.startsWith('amp.') || WALL_EXTRA.includes(d.id)));
  return AMP_SECTIONS.map((s) => ({ ...s, amps: all.filter((d) => toneOf(d) === s.tone) }));
}
export const isAmp = (id) => typeof id === 'string' && (id.startsWith('amp.') || id === 'core.stack');
export const ampKind = (id) => (typeof id === 'string' && id.startsWith('amp.') ? 'clawd' : id === 'core.stack' ? 'stack' : null);

/* ------------------------------------------------------------------------------------------------ the pedal case */
// Claw'd-o-Matic's categories, in its library's order: the case's drawer plates, top to bottom
export const PEDAL_CATS = Object.freeze([
  ['dynamics', 'Dynamics', 'Gates, compressors and volume: how hard a note hits, and how it stops.'],
  ['filter', 'Filter & wah', 'Wahs and envelope filters: which part of the guitar you hear.'],
  ['pitch', 'Pitch', 'Octaves, harmonies, drop tunings and whammy.'],
  ['drive', 'Drive', 'Boosts and overdrives: more push into the amp.'],
  ['fuzz', 'Fuzz', 'Square-wave fuzz, from velvet to broken.'],
  ['synth', 'Synth', 'Your guitar into a synth voice.'],
  ['mod', 'Modulation', 'Chorus, flanger, phaser, vibrato, tremolo: movement.'],
  ['time', 'Delay', 'Echoes, in time with the drummer or loose.'],
  ['ambient', 'Ambient', 'Reverbs and shimmer: the room the guitar is in.'],
  ['glitch', 'Glitch', 'Stutters, bit-crush and things that break on purpose.'],
  ['utility', 'Utility', 'The odd useful box.'],
]);
export const CAT_WORD = Object.freeze(Object.fromEntries(PEDAL_CATS.map(([c, w]) => [c, w])));
export function pedalsByCat() {
  const all = listDevices({ kind: 'effect' }).filter((d) => d.id.startsWith('pedal.'));
  return PEDAL_CATS.map(([cat, word, line]) => ({ cat, word, line, pedals: all.filter((d) => d.pedalCat === cat) }));
}
// a pedal's type in sentence case ("NOISE GATE" -> "Noise gate"), for its tag
export const typeWord = (d) => { const t = String(d?.kindLabel || '').toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
// pedals ranked mod and up go after the amp, in its loop (Claw'd-o-Matic's PEDAL_RANK; core/liveroom/guitar/rig.js)
const RANK = { dynamics: 0, utility: 0.5, filter: 1, pitch: 2, synth: 2.5, drive: 3, fuzz: 4, glitch: 4.5, mod: 5, time: 6, ambient: 7 };
export const inLoop = (d) => (RANK[d?.pedalCat] ?? 3) >= 5;
export const ordinal = (n) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n - 1] || `number ${n}`;

/* ------------------------------------------------------------------------------------------------ cabs and mics */
export const CABS = gear.PLUG_CABS;
export const MICS = gear.PLUG_MICS;
export { CAB_IDS, MIC_IDS, isMeasured, cabDefault };
// the measured 4x12s (each with the mic it was recorded with), in the Half Stack's order; then the designed cabs a
// guitarist would put under a head (the bass cabs stay with the bass amps, but any amp can have any cab)
export const MEASURED_CABS = Object.freeze(CAB_IDS.filter(isMeasured));
export const GUITAR_CABS = Object.freeze(['own', 'v412', 'g412', 'b212', 'a12', 't210', 'b410', 'j15', 'p8', 'fridge', 'box', 'phone', 'horn']);
export const BASS_CABS = Object.freeze(['b810', 'c410', 'b115', 'm212']);
export const cabIndex = (id) => Math.max(0, CAB_IDS.indexOf(id));
export const cabAt = (i) => CAB_IDS[Math.round(+i || 0)] || 'own';
// a cab of an amp's own ('Its own'): drawn as the amp was voiced with, a closed 4x12 for the high-gain heads, an
// open 2x12 for the rest, a 1x15 for bass
export function ownCab(ampId) {
  const d = getDevice(ampId);
  const t = toneOf(d);
  return t === 'bass' ? 'b115' : t === 'high' ? 'v412' : t === 'clean' ? 'b212' : t === 'crunch' ? 'g412' : 'a12';
}
// how big a cab stands, in world units: from its speakers
export function cabBox(id) {
  const c = CABS[id] || CABS.v412;
  if (c.odd === 'fridge') return { w: 300, h: 420 };
  if (c.odd === 'box') return { w: 280, h: 210 };
  if (c.odd === 'phone') return { w: 200, h: 150 };
  if (c.odd === 'horn') return { w: 380, h: 300 };
  const n = c.n || 1, s = c.size || 12;
  if (n >= 8) return { w: 496, h: 420 };
  if (n === 4) return { w: s >= 12 ? 496 : 420, h: s >= 12 ? 330 : 300 };
  if (n === 2) return { w: s >= 12 ? 496 : 400, h: s >= 12 ? 230 : 210 };
  return { w: s >= 15 ? 340 : s >= 12 ? 320 : 260, h: s >= 15 ? 340 : s >= 12 ? 270 : 220 };
}
// a mic's place on the cone, in words (as Claw'd-o-Matic's cab view says it)
export const whereOnCone = (r) => (r < 0.12 ? 'centre' : r < 0.4 ? 'cap edge' : r < 0.82 ? 'cone' : r <= 1.04 ? 'cone edge' : 'off the cone');
export const onCone = (r) => (r < 0.12 ? 'dead centre' : r < 0.4 ? 'on the cap edge' : r < 0.82 ? 'on the cone' : r <= 1.04 ? 'at the cone’s edge' : 'off the cone');
export const inches = (d) => (d < 1 ? (+d).toFixed(1) : d < 10 ? String(Math.round(d * 2) / 2) : String(Math.round(d))) + '″';

// The Half Stack's cabs: measured impulse responses, each a cab and its mics as the engineer left them
export function stackCabs() {
  const p = getDevice('core.stack')?.params?.find((q) => q.key === 'cab');
  return (p?.opts || []).map((o) => o.charAt(0) + o.slice(1).toLowerCase());
}

export function cabOf(link) {
  if (!link) return null;
  const kind = ampKind(link.device);
  const d = getDevice(link.device);
  if (!kind || !d) return null;
  const v = paramValues(d, link.params || {});
  if (kind === 'stack') {
    const opts = stackCabs(), i = Math.round(+v.cab || 0);
    return { kind, amp: d.name, cab: 'stack', index: i, cabName: opts[i] || 'Its cab', cabBlurb: 'A measured 4x12, its mics where the engineer put them.', opts, mic1: null, mic2: null };
  }
  const cab = cabAt(v.cab), measured = isMeasured(cab);
  const shown = cab === 'own' ? ownCab(link.device) : cab;
  const t2 = Math.round(+v.mic2 || 0);
  return {
    kind, amp: d.name, cab, shown, measured, def: cabDefault(link.device), index: Math.round(+v.cab || 0),
    cabName: cab === 'own' ? `${d.name}’s own cab` : CABS[cab].name,
    cabBlurb: CABS[cab]?.blurb || '',
    mic1: measured ? null : { type: MIC_IDS[Math.round(+v.mic || 0)] || 'dyn', pos: +v.micpos, dist: +v.micdist, ang: +v.micang },
    mic2: !measured && t2 > 0 ? { type: MIC_IDS[t2 - 1] || 'ribbon', pos: +v.mic2pos, dist: +v.mic2dist, ang: +v.mic2ang, blend: +v.blend, flip: Math.round(+v.flip) === 1 } : null,
  };
}

/* ------------------------------------------------------------------------------------------------ levels, measured */
// Each amp carried onto the club's stack (the gate and the treble booster in front; the amp at its own default knobs on
// its own default cab: a measured 4x12 for a guitar amp, its own designed cab for the others; the Half Stack at its own
// defaults), against the club's stack as it is (Kraken on its measured modern 4x12): the dB it's off by, on the mean of
// the two metal DI fixtures (chug and chords: tools/fixtures/metal-di/), rendered offline in muted Chromium and read
// with BS.1770 (app/src/audio/measure.js lufs). The club's stack reads -20.6 LUFS that way. tools/liveroom/checks-shop.js
// renders every one again and holds a carried amp to the club's stack within 1 LU (SHOP_PRINT=1 prints the table it
// measured).
export const AMP_TRIM = Object.freeze({
  'amp.clean': -3.8, 'amp.jangle': -3.6, 'amp.crunch': -1.6, 'amp.plexi': 0.2, 'amp.punk': -0.2, 'amp.lead': -0.2, 'amp.recto': 1.3,
  'amp.tiny': -2.1, 'amp.jc': -3.7, 'amp.hiwatt': -3.8, 'amp.bassman': -3.3, 'amp.dumble': -1.9, 'amp.brown': 1, 'amp.slo': 0.8,
  'amp.friedman': 0.2, 'amp.metal': 0.8, 'amp.orange': 0, 'amp.radio': 0.7, 'amp.bit': 1.2, 'amp.tape': -2.7, 'amp.abyss': -0.4,
  'amp.di': -3.8, 'amp.whale': -4.8, 'amp.walrus': -1.1, 'amp.narwhal': -6.6, 'amp.sandbar': -2.5, 'amp.urchin': -5, 'core.stack': 2.1,
});
const CAB_KEYS = ['cab', 'mic', 'micpos', 'micdist', 'micang', 'mic2', 'mic2pos', 'mic2dist', 'mic2ang', 'blend', 'flip'];
const round1 = (x) => Math.round(x * 10) / 10;
export function carryLevel(id) {
  const d = getDevice(id);
  const trim = AMP_TRIM[id];
  if (!d || trim == null) return null;
  const kind = ampKind(id);
  if (kind === 'clawd') { const p = d.params.find((q) => q.key === 'level'); return { key: 'level', value: round1(Math.max(0, Math.min(10, p.def + trim / 3))) }; }
  if (kind === 'stack') { const p = d.params.find((q) => q.key === 'level'); return { key: 'level', value: round1(Math.max(p.min, Math.min(p.max, p.def + trim))) }; }
  return null;
}
export function carriedAmp(id, prev = null) {
  const params = {};
  const lv = carryLevel(id);
  if (lv) params[lv.key] = lv.value;
  // (the cab and mics you chose come along; one you never chose is the new amp's own default, a measured cab for a
  // guitar amp, so nothing is written for it)
  if (ampKind(id) === 'clawd' && prev && ampKind(prev.device) === 'clawd') {
    const from = prev.params || {};
    for (const k of CAB_KEYS) if (from[k] != null) params[k] = from[k];
  }
  return { device: id, params, on: true };
}

/* ------------------------------------------------------------------------------------------------ a stack in words */
const lower = (s) => String(s || '').toLowerCase();
const article = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
export function describeStack(chain) {
  const c = Array.isArray(chain) ? chain : [];
  const ai = c.findIndex((l) => isAmp(l.device));
  const amp = ai >= 0 ? c[ai] : null;
  const word = (l) => { const d = getDevice(l.device); return d ? article(lower(typeWord(d) || d.name)) : 'a pedal'; };
  const before = c.filter((l, i) => (ai < 0 || i < ai) && !isAmp(l.device) && l.on !== false).map(word);
  const after = ai >= 0 ? c.filter((l, i) => i > ai && l.on !== false).map(word) : [];
  const cab = amp ? cabOf(amp) : null;
  const head = amp ? `${getDevice(amp.device)?.name || amp.device}${cab?.kind === 'clawd' ? ` on ${cab.cab === 'own' ? 'its own cab' : article(cab.cabName)}` : ''}` : 'Straight in, no amp';
  const parts = [head];
  if (before.length) parts.push(`${list(before)} in front`);
  if (after.length) parts.push(`${list(after)} in the loop`);
  return parts.join(', ');
}
