// @ts-check
// The guitar amps on the kernel engine (devices/builtin/amp-voiced.js): each one's circuit as numbers. An amp here is
// a kernel device (devices/guitar/amps.js ampDevice); the rest are still the gear's graph amps (plugAmp) until theirs
// is written. Each voicing is a published circuit's structure and its tone stack's real parts; the free values (stage
// drives, the coupling and Miller corners, the pot's range, the power amp's drive and sag, the transformer's band, the
// speaker's resonance) were fitted within physical limits to what the amp sounded like on the graph engine
// (tools/amp-fit.js, against tools/fixtures/amp-voices.json), and nothing else: no EQ that isn't in the circuit. What
// each one is (and what's left of the old voicing) is in the comment above it. amp-voiced.js says what each field is.
// trim: dB, the level so the DI strum through the amp at its defaults reads -14 LUFS the way tools/guitar-test.js reads
// it (clawd-o-matic's loudness after the band's soft clip), as the graph amps did.

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

export const AMP_VOICINGS = {};
