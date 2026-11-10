// The live room [liveroom]: every checks module the other two suites don't name. tools/liveroom/suite.js is the runner
// and says how to run them (ONLY=, PAGES=0, LEVELS=0).
import { runSuite } from './liveroom/suite.js';

await runSuite('liveroom');
