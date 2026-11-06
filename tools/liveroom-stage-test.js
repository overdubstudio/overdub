// The live room [liveroom]: the stage's and the guitar room's takes, played in real time. tools/liveroom/suite.js is the
// runner, and PARTS there names the modules.
import { runSuite } from './liveroom/suite.js';

await runSuite('liveroom-stage');
