// Light Table (core.wavetable), the parts that need no listening: the device's contract (117 params, each with a role and
// a meaning, in prefixed groups; 40 presets across the families; no product names in its copy) and the tables (one
// source: the kernel carries wavetables.js's lightTables verbatim and what plays is what the page draws; every frame
// finite and peak-normalised; each band limit empty above its harmonics; the AKWF bank is the pinned one; the
// closed-form spectra against the waves themselves). Moved from tools/wavetable-test.js.
import { test } from 'node:test';
import crypto from 'node:crypto';
import { T as tally } from './_t.js';
import { INSTRUMENTS } from '../../app/src/devices/builtin/index.js';
import { presetOf } from '../../app/src/devices/registry.js';
import { lightTables, AKWF_FAMILIES, AKWF_WAVES } from '../../app/src/devices/builtin/wavetables.js';
import { AKWF } from '../../app/src/devices/builtin/akwf.js';
import { unpack } from '../../tools/akwf-bank.js';
import { SOURCES, DESTS, PRESETS } from '../../app/src/devices/builtin/wavetable.js';
import { TABLE_NAMES } from '../../app/src/devices/builtin/wavetables.js';
import { ID, SR, def, LT, fmt, T, CLEAN, play, held } from './_wavetable-kit.js';

const t = tally;

test('the device: params, groups, presets, copy', () => {
  t.ok(
    !!def &&
      INSTRUMENTS.includes(def) &&
      def.name === 'Light Table' &&
      def.kind === 'instrument' &&
      def.cat === 'synth',
    `${ID} is registered as a built-in instrument (${def && def.name})`,
  );
  const ROLES =
    'tone level drive mix time feedback rate depth size decay attack release pitch shape width gate sens'.split(' ');
  const GROUPS = [
    /^a_/,
    /^b_/,
    /^sub_/,
    /^noise_/,
    /^flt_/,
    /^env[123]_/,
    /^lfo[1-4]_/,
    /^m[1-8]_/,
    /^macro[1-4]$/,
    /^fx_/,
    /^voice_/,
  ];
  const bad = def.params.filter(
    (p) =>
      !ROLES.includes(p.role) ||
      !(typeof p.desc === 'string' && p.desc.length >= 12) ||
      !GROUPS.some((g) => g.test(p.key)),
  );
  t.ok(
    def.params.length === 117 && !bad.length,
    `${def.params.length} params, each with a role from the list, a meaning an agent can act on, and a group prefix${bad.length ? ': not ' + bad.map((p) => p.key).join(', ') : ''}`,
  );
  const sw = (k) => def.params.find((p) => p.key === k).opts;
  t.ok(
    JSON.stringify(sw('a_table')) === JSON.stringify(TABLE_NAMES) &&
      JSON.stringify(sw('b_table')) === JSON.stringify(TABLE_NAMES) &&
      TABLE_NAMES.length === 26 &&
      TABLE_NAMES.slice(0, 14).join() ===
        'BASIC,PULSE,HARMONICS,VOWEL,SYNC,BELL,ORGAN,FM,HOLLOW,GRIT,GLASS,GROWL,REED,CHIP',
    `both oscillators' TABLE switch is the generator's list, the 14 built in code first, in their order, then the AKWF families (${TABLE_NAMES.length}: ${TABLE_NAMES.join(' ')})`,
  );
  t.ok(
    JSON.stringify(sw('m1_src')) === JSON.stringify(SOURCES) &&
      JSON.stringify(sw('m8_dst')) === JSON.stringify(DESTS) &&
      DESTS.length === 40,
    `the matrix: ${SOURCES.length - 1} sources, ${DESTS.length - 1} destinations, 8 slots`,
  );
  const fams = { Poly: 0, Bass: 0, Lead: 0, Pad: 0, Pluck: 0, Keys: 0, Arp: 0, FX: 0 };
  for (const pr of def.presets) {
    const f = /^(\w+):/.exec(pr.blurb || '')?.[1];
    if (f in fams) fams[f]++;
  }
  const long = PRESETS.filter((pr) => (pr.blurb || '').length > 80).map((pr) => pr.name); // (the registry keeps 80 characters)
  t.ok(
    def.presets.length === 40 &&
      Object.entries(fams).every(([f, n]) => f === 'Poly' || n >= 2) &&
      fams.Poly === 2 &&
      !long.length,
    `40 presets (16 of them bass music's), every blurb naming its family in 80 characters or fewer: ${Object.entries(
      fams,
    )
      .map(([f, n]) => `${f} ${n}`)
      .join(', ')}${long.length ? '; too long: ' + long.join(', ') : ''}`,
  );
  t.ok(
    presetOf(def, {})?.name === 'First Light',
    `a fresh Light Table is on its first preset, First Light (${presetOf(def, {})?.name})`,
  );
  const PRODUCTS = /serum|vital\b|massive|pigments|ppg|waldorf|xfer|arturia|native instruments|blofeld|microwave/i;
  const copy = [
    def.name,
    def.blurb,
    def.nod,
    ...def.params.map((p) => p.desc + ' ' + p.label),
    ...def.presets.map((p) => p.name + ' ' + (p.blurb || '')),
    ...LT.TABLES.map((x) => x.name + ' ' + x.desc),
  ];
  const hits = copy.filter((c) => PRODUCTS.test(c));
  t.ok(
    !hits.length && def.nod && def.blurb.length <= 60,
    `no product names in its copy, the nod in plain words${hits.length ? ': ' + hits.join(' | ') : ''}`,
  );
});

test('the tables: one source, band limits, the AKWF bank, the closed-form spectra', () => {
  t.ok(
    def.kernel.includes(String(lightTables)),
    "the kernel carries wavetables.js's lightTables verbatim (the page draws what plays)",
  );
  let worstPk = 0,
    nan = 0,
    worstOut = -Infinity,
    ms = 0;
  const outOfBand = (T0, o, m) => {
    const n = LT.MN[m],
      re = new Float64Array(n),
      im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = T0[o + LT.MO[m] + i];
    LT.fft(re, im, n, false);
    let inb = 0,
      out = 0;
    for (let k = 1; k < n / 2; k++) {
      const p = re[k] ** 2 + im[k] ** 2;
      if (k <= LT.MK[m]) inb += p;
      else out += p;
    }
    return 10 * Math.log10(out / inb + 1e-30);
  };
  for (let ti = 0; ti < TABLE_NAMES.length; ti++) {
    const st = LT.store(),
      t0 = performance.now();
    st.start(ti, 0.5);
    while (st.step());
    ms = Math.max(ms, performance.now() - t0);
    for (let f = 0; f < LT.F; f++) {
      const o = f * LT.FS;
      let pk = 0;
      for (let i = 0; i < LT.MN[0]; i++) {
        const v = st.T[o + i];
        if (!Number.isFinite(v)) nan++;
        pk = Math.max(pk, Math.abs(v));
      }
      worstPk = Math.max(worstPk, Math.abs(pk - 1));
      if (f % 12 === 0) for (const m of [0, 3, 6, 9]) worstOut = Math.max(worstOut, outOfBand(st.T, o, m));
    }
  }
  t.ok(
    !nan && worstPk < 1e-6,
    `every frame of every table (${TABLE_NAMES.length} x ${LT.F}) is finite and peaks at 1 (worst ${worstPk.toExponential(1)} off)`,
  );
  t.ok(
    worstOut < -120,
    `each band limit holds nothing above its harmonics (worst ${fmt(worstOut)} dB out of band, mips 0 / 3 / 6 / 9)`,
  );
  t.ok(
    ms < 60,
    `a whole table builds in ${fmt(ms)} ms (49 frames x 11 band limits; the kernel spreads it, four frames a block)`,
  );
  t.ok(LT.F * LT.FS * 4 <= 2.9e6, `a table holds ${fmt((LT.F * LT.FS * 4) / 1e6, 2)} MB`);
  // the AKWF bank: the pinned bytes, each wave's spectrum its own cycle's (an independent DFT), on a frame of its own
  {
    const n = AKWF.n,
      W = AKWF.families.reduce((k, f) => k + f.waves.length, 0),
      pcm = unpack(AKWF.code, W * n, n);
    const sha = crypto.createHash('sha256').update(pcm).digest('hex');
    t.ok(
      sha === AKWF.sha256 &&
        W === 108 &&
        AKWF_WAVES.length === W &&
        AKWF_FAMILIES.length === 12 &&
        AKWF_FAMILIES.every((f) => f.waves.length === 9) &&
        /^[0-9a-f]{40}$/.test(AKWF.commit) &&
        AKWF.licence === 'CC0-1.0',
      `the AKWF bank is the pinned one: ${W} cycles of ${n} samples in ${AKWF_FAMILIES.length} families of nine, CC0, unpacked (the tool's own decoder) to bytes whose SHA-256 is ${sha.slice(0, 16)} as recorded`,
    );
    let worst = 0,
      phase = 0,
      onFrame = 0;
    for (let w = 0; w < W; w++) {
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) x[i] = pcm.readInt16LE(2 * (w * n + i)) / 32768;
      const mag = new Float64Array(n / 2);
      let e = 0;
      for (let k = 1; k < n / 2; k++) {
        let c = 0,
          q = 0;
        for (let i = 0; i < n; i++) {
          const th = (2 * Math.PI * k * i) / n;
          c += x[i] * Math.cos(th);
          q += x[i] * Math.sin(th);
        }
        mag[k] = (2 * Math.hypot(c, q)) / n;
        e += mag[k] ** 2 / 2;
      }
      const wv = AKWF_WAVES[w],
        fp = wv.pos * (LT.F - 1);
      if (Math.abs(fp - Math.round(fp)) > 1e-9) onFrame++;
      const { a, b } = LT.spectrum(wv.t, wv.pos);
      for (let k = 1; k < n / 2; k++) worst = Math.max(worst, Math.abs(Math.hypot(a[k], b[k]) - mag[k] / Math.sqrt(e)));
      for (let k = n / 2; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k]) + Math.abs(b[k]));
      phase = Math.max(phase, Math.abs(b[1]) + (a[1] > 0 ? 0 : 1));
    }
    t.ok(
      worst < 1e-9 && phase < 1e-9 && !onFrame,
      `each AKWF wave plays its own cycle's harmonics 1-${n / 2 - 1} and nothing above (worst ${worst.toExponential(1)} off an independent DFT), its fundamental turned to sine phase, each on a frame of its own`,
    );
    const lib = def.library,
      it = lib && lib.items.find((x) => x.name === 'hvoice_0004');
    t.ok(
      lib &&
        lib.items.length === W &&
        lib.groups.length === 12 &&
        it &&
        it.params.a_table === 'AKWF VOICE' &&
        it.params.a_pos === 0.25 &&
        /b_table and b_pos/.test(lib.about),
      `the library lists every wave by family with the params that play it (hvoice_0004: ${JSON.stringify(it && it.params)})`,
    );
  }
  // the closed-form spectra against the waves themselves (a DFT of the naive wave at 2^16 points)
  const brute = (fn, K = 40, N = 1 << 16) => {
    const a = new Float64Array(K + 1),
      b = new Float64Array(K + 1);
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N,
        v = fn(x);
      for (let k = 1; k <= K; k++) {
        a[k] += (2 * v * Math.sin(2 * Math.PI * k * x)) / N;
        b[k] += (2 * v * Math.cos(2 * Math.PI * k * x)) / N;
      }
    }
    return { a, b };
  };
  const err = (ti, x, fn) => {
    const sp = LT.spectrum(ti, x),
      br = brute(fn);
    let e = 0,
      r = 0;
    for (let k = 1; k <= 40; k++) {
      e = Math.max(e, Math.hypot(sp.a[k] - br.a[k], sp.b[k] - br.b[k]));
      r = Math.max(r, Math.hypot(br.a[k], br.b[k]));
    }
    return e / r;
  };
  const r = 1 + 5 * 0.37,
    gs = Math.round(64 * Math.pow(3 / 64, 0.4)),
    gL = Math.pow(2, 6 - 5 * 0.4 - 1);
  const errs = {
    PULSE: err(T('PULSE'), (0.5 - 0.27) / 0.46, (u) => (u < 0.27 ? 1 : -1)),
    SYNC: err(T('SYNC'), 0.37, (u) => 1 - 2 * ((r * u) % 1)),
    GRIT: err(T('GRIT'), 0.4, (u) => {
      const j = Math.floor(u * gs),
        uc = (j + 0.5) / gs,
        v = 0.62 * Math.sin(2 * Math.PI * uc) + 0.38 * (1 - 2 * uc);
      return Math.max(-1, Math.min(1, Math.round(v * gL) / gL));
    }),
    CHIP: err(T('CHIP'), 0, (u) => {
      const j = Math.floor(u * 32),
        d = Math.abs(j + 0.5 - 8);
      return Math.min(d, 32 - d) < 2 ? 1 : -1;
    }),
  };
  t.ok(
    Object.values(errs).every((e) => e < 1e-4),
    `the closed-form spectra are the waves' own, to ${Object.entries(errs)
      .map(([k, e]) => `${k} ${e.toExponential(1)}`)
      .join(', ')} of the largest harmonic`,
  );
  // what plays is what the page draws: A4 on VOWEL at its middle (frame 24), unison 1 from phase 0, against the page's
  // LT.spectrum and LT.gain for that frame, cut at the harmonic the kernel's band limit keeps at 440 Hz
  const ti = T('VOWEL'),
    f0 = 440,
    a = play(held(69, 1), { ...CLEAN, a_table: 'VOWEL', a_pos: 0.5, flt_a: 'OFF', env1_sustain: 1 }, 1, { tail: 0 });
  const sp = LT.spectrum(ti, 0.5),
    g = LT.gain(ti, 0.5),
    flim = Math.min(0.6, Math.max(0.45, (SR - 20000) / SR));
  const K = LT.MK[Math.max(0, Math.min(10, Math.ceil(Math.log2((1024 * (f0 / SR)) / flim))))],
    at = Math.round(0.5 * SR),
    W = 4096;
  let best = -1;
  for (let lag = 0; lag < 48; lag++) {
    let sxy = 0,
      sxx = 0,
      syy = 0;
    for (let i = 0; i < W; i++) {
      const ph = (2 * Math.PI * (at + i - lag + 1) * f0) / SR;
      let y = 0;
      for (let k = 1; k <= K; k++) y += sp.a[k] * Math.sin(k * ph) + sp.b[k] * Math.cos(k * ph);
      const x = a.m[at + i];
      sxy += x * y * g;
      sxx += x * x;
      syy += y * y * g * g;
    }
    best = Math.max(best, sxy / Math.sqrt(sxx * syy));
  }
  t.ok(
    best > 0.999,
    `what plays is the page's own table: a rendered A4 against LT.spectrum and LT.gain (${K} harmonics), correlation ${fmt(best, 5)}`,
  );
});
