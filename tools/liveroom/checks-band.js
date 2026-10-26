// The live room's checks: the band, the amp and the levels [stream B after the foundation] (docs/research/
// LIVE-ROOM-MODE.md §11.2, §11.3). The prototype's band and level checks, moved here with the riff finder cut: a riff
// is given as a read would give it (fake.js riffOf), and the band is the house's (core/liveroom/band.js bandFor).
//   1. the band: the metal club's kick on the riff's chugs and its bass on the riff an octave down; the blues bar's
//      bass through the twelve-bar (I, IV, V); the same band for the same riff and seed; the band's tracks land in one
//      dispatch; a riff with no notes gets the groove's own kick and the bass on the root
//   2. the amp: every one of its settings as loud as Modern, and each place's first breaking up at a moderate input
//   3. the levels (LEVELS=0 skips them): each place's band against a reference DI (its own riff, peaks at -12 dBFS, as
//      an interface brings a guitar in) through the place's first rig at LIVE_DB, by the canonical renderer: the guitar
//      3 dB over the band, the drums 3 dB over the bass (PLACES gain; the numbers to set them to are printed)
import { PLACES, RIGS, rigChain, rigLabel } from '../../app/src/core/liveroom/places.js';
import { bandFor } from '../../app/src/core/liveroom/band.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { measure, lufs } from '../../app/src/audio/measure.js';
import { run as runAmp, metalDI } from '../amp-scenes.js';
import { riffDI, riffOf, SR } from './fake.js';

export const name = 'band';
export const pages = false;

const LIVE_DB = 6, REF_PEAK = -12;
// [beat, midi, held beats (0: a palm-muted chug)]
export const RIFFS = {
  metal: { place: 'metal', bpm: 132, beats: 8, root: 4, chord: true, notes: [[0, 40], [0.25, 40], [0.75, 40], [1, 43, 0.5], [1.5, 40], [2, 40], [2.25, 40], [2.75, 40], [3, 45, 0.5], [3.5, 40], [4, 40], [4.25, 40], [4.75, 40], [5, 43, 0.5], [5.5, 40], [6, 46, 0.5], [6.5, 45, 0.5], [7, 43, 1]] },
  punk: { place: 'basement', bpm: 180, beats: 4, root: 4, chord: true, notes: [[0, 40, 0.45], [0.5, 40, 0.45], [1, 40, 0.45], [1.5, 40, 0.45], [2, 45, 0.45], [2.5, 45, 0.45], [3, 43, 0.45], [3.5, 43, 0.45]] },
  boogie: { place: 'bluesbar', bpm: 96, beats: 4, root: 4, chord: false, notes: [[0, 40, 0.6], [2 / 3, 44, 0.3], [1, 47, 0.6], [5 / 3, 49, 0.3], [2, 50, 0.6], [8 / 3, 49, 0.3], [3, 47, 0.6], [11 / 3, 44, 0.3]] },
};

// The band's tracks as the prototype's bandOps made them, for one dispatch (stream B's planLearn makes them for real:
// the role tracks, made once per song)
function bandOps(place, riff, { from = 0, length = 128, seed = 1 } = {}) {
  const P = PLACES[place], band = bandFor(place, riff, { from, length, seed }), ops = [];
  ops.push({ type: 'track.add', ref: 'drums', track: { name: 'Drums', kind: 'instrument', color: '#a2a6c6', instrument: { device: P.drums.kit.device, params: { ...P.drums.kit.params } }, gain: P.gain.drums } });
  ops.push({ type: 'clip.add', track: '$drums', ref: 'dclip', clip: { kind: 'notes', start: from, length, name: P.name.replace(/^The /, ''), notes: band.drums } });
  if (band.bass.length) {
    ops.push({ type: 'track.add', ref: 'bass', track: { name: 'Bass', kind: 'instrument', color: '#95c6a8', instrument: { device: 'core.bassguitar', params: { ...P.bass.params } }, gain: P.gain.bass } });
    ops.push({ type: 'clip.add', track: '$bass', ref: 'bclip', clip: { kind: 'notes', start: from, length, name: 'Bass', notes: band.bass } });
  }
  return { ops, band };
}

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------------- the band */
  {
    const hm = riffOf(RIFFS.metal), b = bandFor('metal', hm, { from: 16, length: 32, seed: 7 });
    const kicks = b.drums.filter((x) => x.p === 36 && x.t < 8).map((x) => x.t), chugs = hm.notes.filter((x) => x.p == null || x.p <= 45).map((x) => x.t);
    T.ok(chugs.every((t) => kicks.some((k) => Math.abs(k - t) < 0.02)) && kicks.length === chugs.length, `the metal club's kick is on the riff's chugs (${kicks.length} kicks for ${chugs.length} chugs in two bars)`);
    const bass = b.bass.filter((x) => x.t < 8);
    T.ok(bass.length === hm.notes.length && bass.every((x, i) => x.p >= 28 && x.p <= 47 && (hm.notes[i].p == null || (x.p - hm.notes[i].p) % 12 === 0)), `its bass doubles the riff, an octave or two down (${bass.map((x) => x.p).slice(0, 8).join(' ')}…)`);
    const hb = riffOf(RIFFS.boogie), bb = bandFor('bluesbar', hb, { from: 8, length: 48, seed: 7 });
    const rootOf = (bar) => bb.bass.find((x) => x.t >= bar * 4 - 1e-6)?.p % 12;
    T.ok(rootOf(0) === 4 && rootOf(4) === 9 && rootOf(8) === 11 && rootOf(9) === 9 && rootOf(11) === 11, `the blues bar's bass walks the twelve-bar in E: bars 1, 5, 9, 10, 12 on ${[0, 4, 8, 9, 11].map(rootOf).join(', ')} (E A B A B)`);
    T.ok(JSON.stringify(bandFor('metal', hm, { from: 16, length: 32, seed: 7 })) === JSON.stringify(b), 'the same riff and seed make the same band (no Math.random)');
    const s = createStore(createProject());
    const { ops } = bandOps('metal', hm, { from: 16, length: 32, seed: 7 });
    const res = s.dispatch(ops, { by: 'overdub' }), p = s.get();
    T.ok(res.ok && p.tracks.length === 2 && p.tracks.every((t) => t.clips.length === 1 && t.clips[0].start === 16), `the band lands in one dispatch: Drums and Bass, each one clip from beat 16 (${res.ok ? p.tracks.map((t) => t.name).join(', ') : res.error})`);
    const bare = bandFor('metal', { n: 8, bpm: 132, root: 4, notes: [] }, { from: 16, length: 32, seed: 7 });
    const bk = bare.drums.filter((x) => x.p === 36).length;
    T.ok(bk >= 16 && bare.bass.length >= 32 && bare.bass.every((x) => x.p % 12 === 4), `a riff with no notes read: the metal club's groove keeps its own kick (${bk} in 8 bars) and the bass plays the root (${bare.bass.length} notes, all E)`);
  }

  /* ---------------------------------------------------------------------------------------------- the amp */
  // Every setting as loud as Modern on the metal DI fixtures (peaks at REF_PEAK: the two together, the lower gains a
  // little louder on one and quieter on the other, as less of their sound is the amp's), and each place's first one
  // breaking up at a moderate input: peaks at -24 dBFS, where the Guitar Studio rigs the room started with hardly did.
  // Breakup is the share of what comes out that wasn't in what went in (harmonics and intermodulation), on four tones
  // none of whose low harmonics or intermodulation products lands near another.
  {
    const def = getDevice(rigChain('modern')[0].device), norm = (x, db) => { let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); return x.map((v) => (v * 10 ** (db / 20)) / pk); };
    const dis = ['chords', 'chug'].map((k) => norm(metalDI(k), REF_PEAK)), loud = (id, x) => lufs({ sr: SR, channels: [runAmp(def, rigChain(id)[0].params, x)[0]] });
    const off = Object.keys(RIGS).map((id) => ({ id, d: dis.map((x) => loud(id, x) - loud('modern', x)) }));
    T.ok(off.every((o) => Math.abs(o.d[0] + o.d[1]) / 2 <= 0.25 && o.d.every((d) => Math.abs(d) <= 0.75)), `the amp's settings come out as loud as Modern, within a quarter dB on the two DIs together (${off.map((o) => `${RIGS[o.id].name} ${o.d.map((d) => (d >= 0 ? '+' : '') + d.toFixed(1)).join('/')}`).join(', ')} dB)`);
    const F = [82.41, 131.7, 197.3, 613.9], A = [1, 0.8, 0.6, 0.35], N = 32768;
    const tones = norm(Float32Array.from({ length: SR * 2 }, (_, i) => F.reduce((s, f, k) => s + A[k] * Math.sin((2 * Math.PI * f * i) / SR + k), 0)), -24);
    const breakup = (y) => {
      const v = y.subarray(y.length - N), h = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      let wsum = 0, w2 = 0, all = 0, at = 0;
      for (let i = 0; i < N; i++) { wsum += h[i]; w2 += h[i] * h[i]; all += (v[i] * h[i]) ** 2; }
      for (const f of F) {
        let re = 0, im = 0;
        for (let i = 0; i < N; i++) { const q = v[i] * h[i], w = (2 * Math.PI * f * i) / SR; re += q * Math.cos(w); im += q * Math.sin(w); }
        at += (((2 * Math.hypot(re, im)) / wsum) ** 2 / 2) * w2;
      }
      return 1 - at / all;
    };
    const FLOOR = { metal: 0.15, basement: 0.1, bluesbar: 0.05 };
    const br = Object.keys(PLACES).map((pid) => ({ pid, id: PLACES[pid].rigs[0], b: breakup(runAmp(def, rigChain(PLACES[pid].rigs[0])[0].params, tones)[0]) }));
    T.ok(br.every((x) => x.b >= FLOOR[x.pid]), `each place's amp breaks up with your guitar coming in at -24 dBFS: ${br.map((x) => `${PLACES[x.pid].name.toLowerCase()} (${rigLabel(x.id)}) ${(x.b * 100).toFixed(0)}%, at least ${FLOOR[x.pid] * 100}%`).join('; ')}`);
  }

  /* ---------------------------------------------------------------------------------------------- the levels */
  // each place's band against a reference DI of its own riff through its first rig at LIVE_DB, by the canonical renderer
  if (!ctx.levels) { T.note('LEVELS=0: the level renders skipped'); return; }
  for (const k of ['metal', 'punk', 'boogie']) {
    const R = RIFFS[k], { buf } = riffDI(R, { passes: 4, seed: 5, tail: 0 }), riff = riffOf(R);
    const P = PLACES[R.place], spb = 60 / riff.bpm, seconds = buf.length / SR, to = Math.floor(seconds / spb / 4) * 4, id = 'lr_ref_' + R.place;
    const st = createStore(createProject({ tempo: riff.bpm }));
    const r0 = st.dispatch([
      { type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio', inserts: rigChain(P.rigs[0]), gain: LIVE_DB } },
      { type: 'asset.add', asset: { id, kind: 'audio', name: 'DI', sr: SR, channels: 1, duration: seconds } },
      { type: 'clip.add', track: '$g', clip: { kind: 'audio', asset: id, start: 0, length: seconds / spb, offset: 0 } },
    ], { by: 'you' });
    const r1 = st.dispatch(bandOps(R.place, riff, { from: 0, length: to, seed: 7 }).ops, { by: 'overdub' });
    if (!r0.ok || !r1.ok) { T.ok(false, `the levels in ${P.name.toLowerCase()}: ${r0.error || r1.error}`); continue; }
    const p = st.get(), g = r0.created.g, d = r1.created.drums, b = r1.created.bass, assets = { [id]: { sr: SR, channels: [buf] } };
    const m = (tracks) => measure(renderSong(p, { from: 0, to, tracks, tail: 0.5, assets }));
    const x = { guitar: m([g]).lufs, drums: m([d]).lufs, bass: m([b]).lufs, band: m([d, b]).lufs, tp: m([g, d, b]).truePeak };
    const over = x.guitar - x.band, split = x.drums - x.bass;
    // what the faders would be for 3 dB over and a 3 dB split: drums at guitar - 4.8, bass at guitar - 7.8
    const want = { drums: Math.round((P.gain.drums + (x.guitar - 4.8 - x.drums)) * 2) / 2, bass: Math.round((P.gain.bass + (x.guitar - 7.8 - x.bass)) * 2) / 2 };
    T.ok(Math.abs(over - 3) <= 1 && Math.abs(split - 3) <= 1.5 && x.tp <= 0,
      `${P.name}: your guitar (through ${rigLabel(P.rigs[0])} at +${LIVE_DB} dB, ${x.guitar.toFixed(1)} LUFS) sits ${over.toFixed(1)} dB over the band (${x.band.toFixed(1)}), the drums ${split.toFixed(1)} dB over the bass, the mix ${x.tp.toFixed(1)} dBTP (faders drums ${P.gain.drums}, bass ${P.gain.bass}; measured, they'd be ${want.drums} and ${want.bass})`);
  }
}
