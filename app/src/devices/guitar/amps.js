// @ts-check
// Every amp in the guitar gear as an Overdub effect device, 'amp.<id>' (cat 'amp'). The sound is the gear's own
// plugAmp (gear/code.js, its amps.js section): the same knobs give the same samples. Each amp has its cab: a measured
// one (Half Stack's six impulse responses, each with the mic it was recorded with: every guitar amp's default, gear/
// code.js PLUG_AMP_IR) or a designed one, with the mic network (plugCabNet): any of the designed cabs, a mic of any
// type moved across the cone, back from the grille and off axis, and a second mic blended in (phase flip and all). On
// a measured cab the mics are kept but not heard. With the cab on 'Its own' and one mic where it was voiced, it's the
// amp exactly as it was voiced (the network isn't in the path at all).
// CAB is an index into CAB_IDS, which only ever grows at the end (the measured six came after the designed seventeen),
// and its default is the amp's own: a song or rig that never set it plays the amp's default cab. An index an older
// reader doesn't know is 'own' there.
import { defineDevice } from '../registry.js';
import { failure } from '../lifecycle.js';
import { gear, workletFiles } from './gear/index.js';
import { CABS_HASH } from '../builtin/amp-lib.js';
import { kernel } from '../builtin/lib.js';
import { AMP_VOICED, AMP_CAB } from '../builtin/amp-voiced.js';
import { AMP_VOICINGS, AMP_IR_ENERGY } from './voicings.js';

const { PLUG_AMPS, PLUG_CABS, PLUG_MICS, PLUG_MIC_DEFAULT, PLUG_MIC2_DEFAULT, PLUG_DEFAULT, PLUG_WORKLETS, PLUG_AMP_BOX, PLUG_AMP_SPEC, PLUG_IR_LV, plugCabDefault } = gear;
export const CAB_IDS = Object.keys(PLUG_CABS);              // 'own' first, the measured six last
// an amp's default cab (a PLUG_CABS id) and its index (the CAB param's default)
export const cabDefault = (id) => plugCabDefault(String(id || '').replace(/^amp\./, ''));
export const cabDefaultIndex = (id) => Math.max(0, CAB_IDS.indexOf(cabDefault(id)));
// is a CAB_IDS id a measured cab?
export const isMeasured = (cab) => !!(PLUG_CABS[cab] && PLUG_CABS[cab].ir != null);
// What the rack, the pickers and the room say while the measured cabs load, or aren't on this server (an amp whose
// default is a measured one names the bank as its data: ui/rack.js dataLine, ui/kitload.js). It's never quiet
// meanwhile: it plays its own designed cab.
export const AMP_CAB_SAYS = {
  loading: ['Loading cabs…', 'Loading the measured cabs: it plays its own designed cab until they’re in'],
  missing: ['Cab file missing: playing its own cab', 'The measured cabs aren’t on this server, so it plays its own designed cab'],
};
export const MIC_IDS = Object.keys(PLUG_MICS);
const TONE_LABEL = { clean: 'CLEAN AMP', crunch: 'CRUNCH AMP', high: 'HIGH-GAIN AMP', weird: 'WEIRD AMP', bass: 'BASS AMP' };

// where a mic is on a cone, in words (as the gear's cab view says it)
const where = (r) => (r < 0.12 ? 'centre' : r < 0.4 ? 'cap edge' : r < 0.82 ? 'cone' : r <= 1.04 ? 'cone edge' : 'off cone');
const inches = (d) => (d < 1 ? d.toFixed(1) : d < 10 ? String(Math.round(d * 2) / 2) : String(Math.round(d))) + '"';
const knob = (key, label, def, role) => ({ key, label, min: 0, max: 10, def, step: 0, role, fmt: (v) => (+v).toFixed(1) });

export const AMP_PARAMS = [
  knob('gain', 'GAIN', PLUG_DEFAULT.gain, 'drive'), knob('bass', 'BASS', PLUG_DEFAULT.bass, 'tone'), knob('mid', 'MIDDLE', PLUG_DEFAULT.mid, 'tone'),
  knob('treble', 'TREBLE', PLUG_DEFAULT.treble, 'tone'), knob('presence', 'PRESENCE', PLUG_DEFAULT.presence, 'tone'), knob('level', 'MASTER', PLUG_DEFAULT.level, 'level'),
  // the cab and the mics
  { key: 'cab', label: 'CAB', opts: CAB_IDS.map((k) => PLUG_CABS[k].name), def: 0, group: 'cab', desc: 'the speaker cabinet: a measured 4x12 (its mic is part of the measurement) or a designed cab (with the mics below)',
    measured: CAB_IDS.flatMap((k, i) => (isMeasured(k) ? [i] : [])) }, // (the opts that are measured: the Cab & mics line says so, not the mics)
  { key: 'mic', label: 'MIC', opts: MIC_IDS.map((k) => PLUG_MICS[k].name), def: Math.max(0, MIC_IDS.indexOf(PLUG_MIC_DEFAULT.type)), group: 'cab' },
  { key: 'micpos', label: 'POSITION', min: 0, max: 1.35, def: PLUG_MIC_DEFAULT.x, step: 0.01, group: 'cab', role: 'tone', desc: 'cone radii from the dustcap: brighter at the centre, darker toward the edge',
    fmt: (v) => `${(+v).toFixed(2)} ${where(v)}` },
  { key: 'micdist', label: 'DISTANCE', min: 0.5, max: 24, def: PLUG_MIC_DEFAULT.dist, step: 0, curve: 'log', group: 'cab', desc: 'inches from the grille: closer is bassier (proximity), farther hears the room', fmt: inches },
  { key: 'micang', label: 'ANGLE', min: 0, max: 60, def: PLUG_MIC_DEFAULT.ang, step: 1, group: 'cab', desc: 'degrees off axis: darker', fmt: (v) => Math.round(v) + '°' },
  { key: 'mic2', label: 'MIC 2', opts: ['Off'].concat(MIC_IDS.map((k) => PLUG_MICS[k].name)), def: 0, group: 'cab', desc: 'a second mic, blended in' },
  { key: 'mic2pos', label: 'POS 2', min: 0, max: 1.35, def: PLUG_MIC2_DEFAULT.x, step: 0.01, group: 'cab', fmt: (v) => `${(+v).toFixed(2)} ${where(v)}` },
  { key: 'mic2dist', label: 'DIST 2', min: 0.5, max: 24, def: PLUG_MIC2_DEFAULT.dist, step: 0, curve: 'log', group: 'cab', fmt: inches },
  { key: 'mic2ang', label: 'ANGLE 2', min: 0, max: 60, def: PLUG_MIC2_DEFAULT.ang, step: 1, group: 'cab', fmt: (v) => Math.round(v) + '°' },
  { key: 'blend', label: 'BLEND', min: 0, max: 10, def: PLUG_MIC2_DEFAULT.blend, step: 0, group: 'cab', role: 'mix', desc: '0 all mic 1, 10 all mic 2', fmt: (v) => (+v).toFixed(1) },
  { key: 'flip', label: 'PHASE', opts: ['NORM', 'FLIP'], def: 0, group: 'cab', desc: "flip mic 2's polarity" },
];

// Overdub params -> the gear's amp settings P ({ amp, gain, ..., cab?, mic?, mic2? }); the defaults left out (the cab
// when it's the amp's default; 'own' is written for an amp whose default is a measured cab), so the amp at its own cab
// and one mic where it was voiced takes the straight wire, bit for bit.
export function ampSettings(id, v) {
  const P = { amp: id };
  for (const k of ['gain', 'bass', 'mid', 'treble', 'presence', 'level']) P[k] = v[k];
  const cab = CAB_IDS[Math.round(v.cab)] || 'own';
  if (cab !== plugCabDefault(id)) P.cab = cab;
  const m1 = { type: MIC_IDS[Math.round(v.mic)] || PLUG_MIC_DEFAULT.type, x: +v.micpos, y: 0, dist: +v.micdist, ang: +v.micang, s: 0 };
  if (Object.keys(PLUG_MIC_DEFAULT).some((k) => m1[k] !== PLUG_MIC_DEFAULT[k])) P.mic = m1;
  const t2 = Math.round(v.mic2);
  if (t2 > 0) P.mic2 = { type: MIC_IDS[t2 - 1] || 'ribbon', x: +v.mic2pos, y: 0, dist: +v.mic2dist, ang: +v.mic2ang, s: 0, blend: +v.blend, flip: Math.round(v.flip) === 1 };
  return P;
}
// the gear's amp settings (a preset's) -> Overdub params
export function ampParams(S) {
  const v = {};
  for (const k of ['gain', 'bass', 'mid', 'treble', 'presence', 'level']) if (S[k] != null) v[k] = +S[k];
  if (S.cab && PLUG_CABS[S.cab]) v.cab = CAB_IDS.indexOf(S.cab); // ('own' too: 0, the amp's own designed cab)
  const pos = (m) => Math.round(Math.min(1.35, Math.hypot(+m.x || 0, +m.y || 0)) * 1000) / 1000;
  if (S.mic) { v.mic = Math.max(0, MIC_IDS.indexOf(S.mic.type)); v.micpos = pos(S.mic); v.micdist = +S.mic.dist; v.micang = +S.mic.ang; }
  if (S.mic2) { v.mic2 = 1 + Math.max(0, MIC_IDS.indexOf(S.mic2.type)); v.mic2pos = pos(S.mic2); v.mic2dist = +S.mic2.dist; v.mic2ang = +S.mic2.ang; v.blend = +S.mic2.blend; v.flip = S.mic2.flip ? 1 : 0; }
  return v;
}

// The cabs and mics as an amp's kernel reads them (amp-voiced.js ampCabNet): every CAB option in CAB_IDS' order (null
// for 'own'), every mic in MIC_IDS' order, and the two default mics, by index. The same for every amp.
export const cabTables = () => {
  const mic = (m) => ({ type: MIC_IDS.indexOf(m.type), x: m.x, dist: m.dist, ang: m.ang, blend: m.blend });
  return {
    cabs: CAB_IDS.map((k) => {
      if (k === 'own') return null;
      const C = PLUG_CABS[k];
      return C.ir != null ? { ir: C.ir } : { n: C.n, size: C.size, back: C.back, slap: C.slap || null, lv: C.lv || 0, cab: C.cab };
    }),
    mics: MIC_IDS.map((k) => { const M = PLUG_MICS[k]; return { lo: M.lo, body: M.body, pres: M.pres, air: M.air, hp: M.hp || null, lp: M.lp || null, prox: M.prox, room: M.room }; }),
    md: mic(PLUG_MIC_DEFAULT), md2: mic(PLUG_MIC2_DEFAULT),
  };
};
// An amp on the kernel engine: its voicing (voicings.js), its own designed cab, the box it was voiced in, what it puts
// into a cab (the trims' weights) and its measured cabs' energies, then the engine (amp-voiced.js). The params are the
// graph amps' (AMP_PARAMS), so a saved rig plays on. Its LEVEL: the graph amps' (dB, trim + (level - 5) * 3 - 3).
// ampVoice(id, voicing?): the V its kernel reads (any amp's, with a voicing given: tools/amp-fit.js tries them)
export function ampVoice(id, voicing = AMP_VOICINGS[id]) {
  const A = PLUG_AMPS[id];
  return { ...voicing, cab: A.cab, box: PLUG_AMP_BOX[id] || [1, 12, 'closed'], spec: PLUG_AMP_SPEC[id] || PLUG_AMP_SPEC.punk, irE: AMP_IR_ENERGY[id], irLv: voicing.irLv != null ? voicing.irLv : PLUG_IR_LV[id] || 0 };
}
export function ampKernel(id, voicing) {
  const V = ampVoice(id, voicing);
  return kernel(String.raw`
${AMP_VOICED}
${AMP_CAB}
const V = ${JSON.stringify(V)};
const T = ${JSON.stringify(cabTables())};
return {
  create({ sr, dsp, data }) {
    const amp = makeVoiced(sr, dsp, V), cab = makeAmpCab(sr, dsp, data && data.cabs, V, T), lv = glide(20, sr, 1);
    let buf = new Float64Array(128);
    return {
      latency: amp.latency,
      process(L, R, n, P) {
        amp.set(P);
        cab.set(P);
        const g = dbg(V.trim + (clamp(P.level, 0, 10) - 5) * 3 - 3);
        if (buf.length < n) buf = new Float64Array(n);
        for (let i = 0; i < n; i++) buf[i] = amp.tick(0.5 * (L[i] + R[i]));
        cab.process(buf, n);
        for (let i = 0; i < n; i++) { const y = buf[i] * lv.next(g); L[i] = y; R[i] = y; }
      },
    };
  },
};
`);
}

// ampDevice(id, voicing?): an amp's def (on the kernel engine when it has a voicing, or one is given)
export function ampDevice(id, voicing = AMP_VOICINGS[id]) {
  const A = PLUG_AMPS[id];
  if (voicing) {
    const V = voicing;
    return {
      id: 'amp.' + id, name: A.name, kind: 'effect', cat: 'amp', amp: id, kindLabel: TONE_LABEL[A.tone] || 'AMP', tone: A.tone, style: A.style,
      blurb: A.blurb, nod: A.nod, by: 'clawd', source: 'clawd-o-matic', exportable: false, // (the gear's: not a device file)
      params: AMP_PARAMS.map((p) => Object.assign({}, p, p.key === 'cab' ? { def: cabDefaultIndex(id) } : null)),
      // (the measured cabs' bank, whichever cab is its default: any CAB can be a measured one)
      data: { cabs: CABS_HASH }, dataSays: AMP_CAB_SAYS,
      look: { amp: id, style: A.style },
      latency: (V.os === 2 ? 23 : 28) / 48000, // (the oversampler's: dsp.oversample2x 23 samples, oversample4x 27.5)
      tail: 0.25, // (the stadium horn's slap)
      kernel: ampKernel(id, voicing),
    };
  }
  // (Abyss's octave divider: only the amps with one; plugin.js loads PLUG_WORKLETS as 'clawd-amps', from its file here)
  const worklets = A.sub ? workletFiles({ 'clawd-amps': PLUG_WORKLETS }, 'amp.' + id) : null;
  return {
    id: 'amp.' + id, name: A.name, kind: 'effect', cat: 'amp', amp: id, kindLabel: TONE_LABEL[A.tone] || 'AMP', tone: A.tone, style: A.style,
    blurb: A.blurb, nod: A.nod, by: 'clawd', source: 'clawd-o-matic', // (both ids: kept as they were)
    params: AMP_PARAMS.map((p) => Object.assign({}, p, p.key === 'cab' ? { def: cabDefaultIndex(id) } : null)),
    // (an amp on a measured cab by default names the bank: an export waits for it, and the rack says while it loads)
    ...(isMeasured(plugCabDefault(id)) ? { data: { cabs: CABS_HASH }, dataSays: AMP_CAB_SAYS } : {}),
    look: { amp: id, style: A.style },
    latency: 256 / 48000, // (the two 2x-oversampled stages: 128 samples each; the instance reports it at its own rate)
    worklets,
    build(c, kit) {
      // An amp with an octave (Abyss) is that amp only with it: no worklet, or an octave that can't be made, is a
      // 'worklet' failure (the engine stands in, says so and builds it again), never a quiet Abyss without its octave.
      if (A.sub) {
        c.__clawdAmpWorklets = kit.loaded('clawd-amps'); // (plugAmp builds the octave only when they're in)
        if (!c.__clawdAmpWorklets) throw failure('worklet', `${A.name}'s octave (the clawd-amps worklet) didn't load`);
      }
      const amp = gear.plugAmp(c);
      if (A.sub && !amp.octave()) { amp.dispose(); throw failure('worklet', `${A.name}'s octave couldn't be made`); }
      // (the measured cabs' bank: an amp whose default is one asks for it now; the others when one is picked)
      if (isMeasured(plugCabDefault(id))) amp.ready();
      return {
        input: amp.input, output: amp.output, latency: amp.latency, amp,
        set(v, x) { amp.set(ampSettings(id, v), x && !x.first ? x.t : undefined); },
        dispose() { amp.dispose(); },
      };
    },
  };
}

export function registerAmps() {
  const out = [];
  for (const id of Object.keys(PLUG_AMPS)) {
    try { out.push(defineDevice(ampDevice(id))); } catch (e) { console.error('guitar: amp ' + id + ' not registered:', e.message); }
  }
  return out;
}
