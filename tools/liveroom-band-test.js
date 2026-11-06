// The live room [liveroom]: the band, its rigs and their levels, most of it renders. tools/liveroom/suite.js is the
// runner, and PARTS there names the modules.
import { runSuite } from './liveroom/suite.js';

await runSuite('liveroom-band');
