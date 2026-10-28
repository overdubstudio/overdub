// @ts-check
// The Guitar Studio in Overdub: one import registers every pedal ('pedal.<id>') and every amp ('amp.<id>') in the
// guitar gear, and exports the rigs (its presets as device chains).
//
//   import { RIGS, rigOps, PEDALS, AMPS } from './devices/guitar/index.js';
//
// The gear is ours (gear/: its code, looks, worklets and docs; gear/index.js evaluates it once); the sound runs on
// devices/kit.js + devices/graph.js. It began as AJ's Guitar Studio in Claw'd-o-Matic (pedals, amps, cabs, presets):
// MIT, credited in gear/LICENSE.
import { registerPedals } from './pedals.js';
import { registerAmps, AMP_PARAMS, ampSettings, ampParams, CAB_IDS, MIC_IDS } from './amps.js';
import { RIGS, RIG_BANKS, rigOps, rigById } from './rigs.js';
import { gear, setSongKey, majorKeyOf } from './gear/index.js';

export const PEDALS = registerPedals();
export const AMPS = registerAmps();
export { RIGS, RIG_BANKS, rigOps, rigById, AMP_PARAMS, ampSettings, ampParams, CAB_IDS, MIC_IDS, gear, setSongKey, majorKeyOf };
