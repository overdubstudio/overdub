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
  // Coral Chime: an AC30 Top Boost: V1 -> VOLUME (a bright cap) -> the top boost's ECC83, its cathode follower into
  // the stack (50 pF, 22 nF, 22 nF; treble 1M, bass 1M, a fixed 10k to ground where a mid pot would be, 100k slope:
  // the Vox has no MIDDLE, so ours is a gentle bell after it) -> the long-tailed pair -> four EL84s, cathode biased
  // (class A: the bias's even harmonics) on a tube rectifier's sag. Fitted: within 2.0 dB rms of the graph amp (3.3 at
  // worst), the same THD (3.9 %). Its VOLUME has the real taper: at 0 it's 8 LU quieter than the graph amp's was.
  jangle: {
    os: 4, hp: 96, tight: null,
    chain: [['tri', 1.2, 0.1, 2.2, 26, 6430.042], ['pot'], ['tri', 6, 0.16, 1.7, 78, 6250], ['gain', -1], ['stack'], ['gain', 14], ['tri', 1.2, 0.05, 1.3, 50.7, 6250]],
    pot: [-36, 0], bright: [100, 1e6],
    stack: { R1: 1e6, R2: 1e6, R3: 10e3, R4: 100e3, C1: 50e-12, C2: 22e-9, C3: 22e-9, m: 0.999 }, midk: [900, 0.8, 0.8],
    pw: 4, pwb: 0.2, sag: 0.55, xf: [86.4, 15870], depth: null, pres: [4200, 1.6], trim: -9.21, irLv: -0.55,
  },
  // Lighthouse: a DR103: V1 -> VOLUME -> V2 -> the passive Baxandall with its mid rheostat (treble 250k, bass 1M, mid
  // 25k; 220 pF, 4.7 nF, 10 nF, 100 nF), a cathode follower's makeup -> the long-tailed pair -> four EL34s on a
  // solid-state rectifier and a big transformer: no sag, a deep low end. The DR103's published stack values vary;
  // these sit inside them (low confidence on C3 and C4). Fitted: within 2.3 dB rms (4.2 at worst): 4-6 dB less at
  // 60-110 Hz and 4 dB more at 1.8-2.8 kHz than the graph amp, with the input's coupling and the speaker's bump at
  // their limits. The same THD (1.1 %).
  hiwatt: {
    os: 4, hp: 20.094, tight: null,
    chain: [['tri', 1.5, 0.08, 2.2, 5.387, 7233.797], ['pot'], ['tri', 5, 0.12, 1.8, 6.375, 4018.776], ['gain', -1], ['stack'], ['gain', 10], ['tri', 1.2, 0.04, 1.3, 30, 4018.776]],
    pot: [-30, 0], bright: [112.245, 1e6],
    stack: { net: 'james', R1: 250e3, R2: 1e6, R3: 25e3, R4: 33e3, R5: 220e3, R6: 4.7e3, RL: 1e6, C1: 220e-12, C2: 4.7e-9, C3: 10e-9, C4: 100e-9 },
    pw: 6.5, sag: 0, xf: [23.148, 10586.011], depth: [136.879, 4], pres: [3500, 1.6], trim: -2.81,
  },
  // Clownfish: an OR120-style head: V1 -> GAIN -> two more stages, hot -> the stack (470 pF, 47 nF, 47 nF; treble
  // 250k, bass 1M, mid 25k, slope 56k: the big caps are its low mids) -> a pair of EL34s, a touch of bias. Low
  // confidence on the circuit (the graph amp's nod is a type, not a model). Fitted: within 2.0 dB rms (4.1 at worst,
  // 4 dB under it at 450 Hz); the same THD (38.8 %).
  orange: {
    os: 4, hp: 95.04, tight: null,
    chain: [['tri', 6.104, 0.15, 2.2, 5.387, 4186.225], ['pot'], ['tri', 8, 0.25, 1.6, 7.968, 4050.926], ['tri', 5, 0.25, 1.5, 8.287, 4166.667], ['gain', -1], ['stack'], ['gain', 15], ['tri', 1.5, 0.08, 1.3, 13.655, 8000]],
    pot: [-36, 0], bright: null,
    stack: { R1: 250e3, R2: 1e6, R3: 25e3, R4: 56e3, C1: 470e-12, C2: 47e-9, C3: 47e-9 },
    pw: 6, pwb: 0.06, sag: 0.4, xf: [64.8, 10000], depth: [90, 2], pres: [3000, 1.6], trim: -16.48, irLv: 0.95,
  },
  // Crab Shack: a tweed Deluxe turned up (a 5E3: V1 -> VOLUME -> V2 -> a cathodyne into two 6V6s, cathode biased, on
  // a tube rectifier). The 5E3 has one tone pot; ours has three, so it wears the 5F6-A's stack (250 pF, 20 nF, 20 nF;
  // treble 250k, bass 1M, mid 25k, slope 56k) as a stand-in, and the cathodyne's even harmonics as bias. Fitted:
  // within 2.9 dB rms (5.5 at worst: 5 dB hotter at 1.8-2.6 kHz, the stack's top where the old voicing had a peak at
  // 1 kHz); the same THD (6.5 %).
  crunch: {
    os: 4, hp: 58.333, tight: null,
    chain: [['tri', 0.738, 0.1, 2.2, 26, 4186.225], ['pot'], ['tri', 6, 0.16, 1.7, 40, 4340.278], ['gain', -1], ['stack'], ['gain', 14], ['tri', 1.5, 0.2, 1.3, 30, 9000]],
    pot: [-34, 0], bright: [500, 1e6],
    stack: { R1: 250e3, R2: 1e6, R3: 25e3, R4: 56e3, C1: 250e-12, C2: 20e-9, C3: 20e-9 },
    pw: 6, pwb: 0.25, sag: 0.15, xf: [60, 10000], depth: null, pres: [3800, 1.6], trim: -10.91,
  },
  // Driftwood: a 5F6-A Bassman: V1A -> VOLUME (its bright cap) -> V1B -> V2, a cathode follower into the stack (250
  // pF, 20 nF, 20 nF; treble 250k, bass 1M, mid 25k, slope 56k) -> the long-tailed pair -> two 5881s, the presence in
  // the feedback loop. Fitted: within 1.7 dB rms (3.0 at worst); the same THD (5.3 %).
  bassman: {
    os: 4, hp: 55, tight: null,
    chain: [['tri', 0.614, 0.1, 2.2, 11.835, 6028.164], ['pot'], ['tri', 6, 0.16, 1.7, 14.005, 6250], ['gain', -1], ['stack'], ['gain', 16], ['tri', 1.2, 0.06, 1.3, 8.08, 10000]],
    pot: [-34, 0], bright: [140, 1e6],
    stack: { R1: 250e3, R2: 1e6, R3: 25e3, R4: 56e3, C1: 250e-12, C2: 20e-9, C3: 20e-9 },
    pw: 8, sag: 0.15, xf: [45, 11000], depth: [90, 2], pres: [3200, 1.6], trim: -7.94,
  },
  // Pinch Punk: a JCM800 2203: V1A, its cathode half bypassed (TIGHT) -> VOLUME (470 pF bright) -> V1B, the cold
  // clipper (biased hard) -> V2A -> a cathode follower into the stack (470 pF, 22 nF, 22 nF; treble 220k, bass 1M, mid
  // 22k, slope 33k) -> the long-tailed pair -> four EL34s. Fitted: within 2.4 dB rms (4.0 at worst); the same THD
  // (9.5 %).
  punk: {
    os: 4, hp: 70, tight: [220, -6],
    chain: [['tri', 0.524, 0.1, 2.2, 15.385, 6028.164], ['pot'], ['tri', 8, 0.45, 1.4, 100, 4340.278], ['tri', 6, 0.16, 1.7, 60, 6666.667], ['gain', -1], ['stack'], ['gain', 16], ['tri', 1.2, 0.05, 1.3, 65.91, 5208.333]],
    pot: [-38, 0], bright: [171.283, 1e6],
    stack: { R1: 220e3, R2: 1e6, R3: 22e3, R4: 33e3, C1: 470e-12, C2: 22e-9, C3: 22e-9 },
    pw: 3.5, sag: 0.15, xf: [60, 13800], depth: [90, 2.5], pres: [3800, 1.6], trim: -17.12,
  },
  // Brown Tide: a 1959 Super Lead on a variac: the plexi's circuit (V1A -> VOLUME, the bright cap -> V2A -> a cathode
  // follower into 500 pF, 22 nF, 22 nF; treble 220k, bass 1M, mid 25k, slope 33k) with its supply turned down: the
  // most sag of any (0.6). Fitted: within 2.1 dB rms (3.8 at worst); the same THD (27.5 %).
  brown: {
    os: 4, hp: 58.333, tight: null,
    chain: [['tri', 2, 0.1, 2.2, 5.387, 4186.225], ['pot'], ['tri', 8, 0.16, 1.7, 9.562, 19906.56], ['gain', -1], ['stack'], ['gain', 16], ['tri', 1.5, 0.06, 1.3, 23.077, 4629.63]],
    pot: [-36, 0], bright: [500, 1e6],
    stack: { R1: 220e3, R2: 1e6, R3: 25e3, R4: 33e3, C1: 500e-12, C2: 22e-9, C3: 22e-9 },
    pw: 6, sag: 0.6, xf: [45, 19239.069], depth: [90, 2], pres: [4000, 1.6], trim: -16.58,
  },
  // Rogue Wave: a modded plexi (a BE-100's idea): TIGHT before V1A -> VOLUME (470 pF) -> a cold clipper -> two more
  // stages -> the stack (470 pF, 22 nF, 22 nF; treble 220k, bass 1M, mid 22k, slope 33k) -> four EL34s. Fitted: within
  // 2.6 dB rms (4.6 at worst: 5 dB more at 80 Hz and 4.6 less at 640 Hz); the same THD (31.4 %).
  friedman: {
    os: 4, hp: 80, tight: [240, -5],
    chain: [['tri', 1.229, 0.1, 2.2, 50.7, 4186.225], ['pot'], ['tri', 10, 0.45, 1.4, 120, 4340.278], ['tri', 6, 0.16, 1.7, 60, 4629.63], ['tri', 3, 0.2, 1.5, 52, 19906.56], ['gain', -1], ['stack'], ['gain', 16], ['tri', 1.2, 0.05, 1.3, 23.077, 7500]],
    pot: [-40, 0], bright: [470, 1e6],
    stack: { R1: 220e3, R2: 1e6, R3: 22e3, R4: 33e3, C1: 470e-12, C2: 22e-9, C3: 22e-9 },
    pw: 2, sag: 0.3, xf: [50, 10434.783], depth: [90, 2.5], pres: [3800, 1.6], trim: -20.69,
  },
};
