// @ts-check
// The guitar amps on the kernel engine (devices/builtin/amp-voiced.js): each one's circuit as numbers. An amp here is
// a kernel device (devices/guitar/amps.js ampDevice); the rest are still the gear's graph amps (plugAmp) until theirs
// is written. Each voicing is a published circuit's structure and its tone stack's real parts; the free values (stage
// drives, the coupling and Miller corners, the pot's range, the power amp's drive and sag, the transformer's band, the
// speaker's resonance) were fitted within physical limits to what the amp sounded like on the graph engine
// (tools/amp-fit.js, against tools/fixtures/amp-voices.json), and nothing else: no EQ that isn't in the circuit. What
// each one is (and what's left of the old voicing) is in the comment above it. amp-voiced.js says what each field is.
// trim: dB, the level so the DI strum through the amp at its defaults, on its default cab, is as loud as the graph amp
// was (clawd-o-matic's loudness, tools/amp-fit.js trimFor; tools/guitar-test.js 4 reads every amp at -14 LUFS).
// irLv: dB, the amp's measured nudge on the measured cabs (the gear's PLUG_IR_LV, for the graph amp's voice), when its
// new voice needs its own: the measured cabs' trims weigh each IR by the graph amp's spectrum (PLUG_AMP_SPEC), and an
// amp that sounds different reads a little louder or quieter there (tools/guitar-test.js 4c holds it to 0.5 LU).

// 10 log10 of each measured IR's energy (CAB_IDS' order), weighted as the gear's plugIrTrim weighs it for each amp:
// what an amp's trim on a measured cab is worked out from in the kernel (the bank is the same bytes: amp-lib.js
// CABS_HASH). test/unit/amp-voiced.test.js holds it to plugCabNet's trims.
export const AMP_IR_ENERGY = {
  clean: [20.890739, 19.378496, 22.264478, 21.368017, 22.47814, 25.173279],
  jangle: [20.057898, 18.37238, 21.377237, 20.490806, 21.691902, 24.528191],
  crunch: [22.502465, 21.553848, 23.971673, 23.076446, 23.680791, 26.105748],
  plexi: [23.090507, 22.228549, 24.719417, 23.762292, 24.098322, 26.51248],
  punk: [22.766802, 21.826303, 24.215477, 23.336382, 23.901915, 26.266239],
  lead: [22.954833, 22.546485, 24.455754, 23.597475, 23.588185, 25.507381],
  recto: [21.880713, 20.526706, 23.16066, 22.33195, 23.430678, 25.888828],
  tiny: [22.014451, 20.921818, 23.367942, 22.51903, 23.287682, 25.73868],
  jc: [20.159236, 18.511237, 21.474724, 20.592424, 21.767645, 24.578941],
  hiwatt: [21.940799, 20.872462, 23.428865, 22.513309, 23.173249, 25.714927],
  bassman: [21.134842, 19.692177, 22.564887, 21.648797, 22.681804, 25.35014],
  dumble: [23.764483, 22.978597, 25.405093, 24.450287, 24.749529, 27.052478],
  brown: [22.682217, 21.649169, 24.156477, 23.256852, 23.936, 26.337974],
  slo: [23.339831, 22.545637, 24.726458, 23.888736, 24.355973, 26.586068],
  friedman: [23.771135, 23.00171, 25.343347, 24.427089, 24.729761, 26.913613],
  metal: [22.62447, 21.487112, 23.836217, 23.063745, 24.06244, 26.29135],
  orange: [24.907945, 24.498223, 26.925924, 25.838584, 25.421162, 27.606933],
  radio: [22.271435, 22.196355, 23.325974, 22.718997, 22.864727, 24.264427],
  bit: [22.910526, 22.004348, 24.339039, 23.474713, 23.984923, 26.323004],
  tape: [23.920282, 23.323672, 25.627653, 24.642509, 24.826345, 27.179579],
  abyss: [23.175812, 22.845813, 24.781606, 23.884054, 23.852027, 25.549943],
  di: [22.85925, 21.977165, 24.343428, 23.44841, 23.969126, 26.352328],
  whale: [15.250446, 15.854815, 19.986055, 17.767977, 16.50593, 20.707333],
  walrus: [13.91949, 14.894125, 19.181146, 16.804913, 15.123483, 19.677591],
  narwhal: [19.460218, 19.748499, 23.466014, 21.51595, 20.562103, 24.287681],
  sandbar: [14.16391, 15.120154, 19.469975, 17.070458, 15.476477, 19.982091],
  urchin: [17.369094, 18.22683, 22.49619, 20.150478, 18.678852, 23.07803],
};

export const AMP_VOICINGS = {
  // Sea Glass: a blackface 2x12 (an AB763): V1A -> the stack (250 pF, 100 nF, 47 nF; treble 250k, bass 250k, mid 10k,
  // slope 100k) -> VOLUME (a 120 pF bright cap across it) -> V2A -> the long-tailed pair -> two 6L6s. A solid-state
  // rectifier: little sag. PRESENCE: the feedback loop's top (the Twin has none of its own). Fitted: within 2.8 dB rms
  // of the graph amp (4.3 at worst): it's 3-4 dB thinner at 1-2 kHz and 4 dB brighter at 2.8-5.6 kHz, a blackface's
  // scoop and top; the same THD (0.27 %). Its MID is a 10k pot, so it moves 1.4 LU end to end, not the old 12.
  clean: {
    os: 2, hp: 40, tight: null,
    chain: [['tri', 0.8, 0.08, 2.2, 15.385, 5358.368], ['stack'], ['gain', 23], ['pot'], ['tri', 1.4, 0.12, 2, 6.215, 4822.531], ['tri', 1.2, 0.02, 1.2, 6.733, 8101.853]],
    pot: [-30, 0], bright: [120, 1e6],
    stack: { R1: 250e3, R2: 250e3, R3: 10e3, R4: 100e3, C1: 250e-12, C2: 100e-9, C3: 47e-9 },
    pw: -10.5, sag: 0.1, xf: [23.148, 17250], depth: [132.25, 4], pres: [4000, 1.6], trim: -5.25, irLv: -0.6,
  },
  // Shell Shock: a 1959 Super Lead: V1A -> VOLUME (the bright channel's cap across it) -> V2A -> V2B, a cathode follower
  // -> the stack (500 pF, 22 nF, 22 nF; treble 220k, bass 1M, mid 25k, slope 33k) -> the long-tailed pair -> four EL34s.
  // Fitted: within 3.2 dB rms of the graph amp (5.8 at worst), the furthest of the three: the stack at noon scoops 700
  // Hz-1.4 kHz to -6 dB where the old voicing didn't, and the bright channel sits 5 dB hotter at 2.8-5.6 kHz, which the
  // phase inverter's Miller corner (4 kHz, the fit's floor) only partly takes back. The same THD (18.3 %).
  plexi: {
    os: 4, hp: 60, tight: null,
    chain: [['tri', 1.875, 0.1, 2.2, 8.08, 16800], ['pot'], ['tri', 6, 0.16, 1.7, 60, 6250], ['gain', -1], ['stack'], ['gain', 16], ['tri', 1.2, 0.05, 1.3, 30, 4018.776]],
    pot: [-36, 0], bright: [500, 1e6],
    stack: { R1: 220e3, R2: 1e6, R3: 25e3, R4: 33e3, C1: 500e-12, C2: 22e-9, C3: 22e-9 },
    pw: 6, sag: 0.3, xf: [45, 10000], depth: [90, 2], pres: [3600, 1.6], trim: -16,
  },
  // Kraken: a three-channel Californian high-gain head, its modern channel: four cascaded stages (the first's cathode
  // bypass cap small: TIGHT), then the stack (500 pF, 22 nF, 22 nF; treble 250k, bass 1M, mid 25k, slope 47k), a tube
  // rectifier's sag. Fitted: within 2.1 dB rms of the graph amp (3.2 at worst); the first two stages' coupling sits at
  // 340-370 Hz, as a lead channel's small caps do. The same THD (11.6 %) and GAIN travel.
  recto: {
    os: 4, hp: 55.556, tight: [300, -8],
    chain: [['tri', 11.445, 0.12, 2.2, 371.159, 16800], ['pot'], ['tri', 4.915, 0.18, 1.6, 342.732, 18662.4], ['tri', 3.072, 0.32, 1.25, 6.375, 16920.576], ['tri', 3, 0.2, 1.4, 10.504, 9600], ['stack'], ['gain', 10]],
    pot: [-22, 0], bright: null,
    stack: { R1: 250e3, R2: 1e6, R3: 25e3, R4: 47e3, C1: 500e-12, C2: 22e-9, C3: 22e-9 },
    pw: -4, sag: 0.3, xf: [20.094, 13000], depth: [73.913, 4], pres: [4000, 1.6], trim: -26.84,
  },
};
