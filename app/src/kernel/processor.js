// @ts-check
// The kernel worklet's module. kernel/host.js (ensureKernelWorklet) loads this file into each audio context's
// AudioWorkletGlobalScope, where it registers the one processor that hosts every kernel ('overdub-kernel'). Like every
// worklet module the studio loads, it is a file on the page's own origin: the pages' policy refuses data: and blob:
// scripts (app/index.html says why). It runs the very code the Node renderer imports, the dsp stdlib (dsp.js) and
// kernelCompiler and KernelCore (worklet.js), so a kernel renders the same on either side.
// First, the module every graph worklet goes in behind (devices/worklets/end.js): it wraps registerProcessor once per
// scope, and the realm is frozen below (worklet.js freezeRealm), after which it couldn't. The same URL devices/kit.js
// loads, so the scope runs it once whichever comes first; its own guard makes a second run nothing.
import '../devices/worklets/end.js';
import { overdubDsp } from './dsp.js';
import { overdubKernelWorklet, kernelCompiler, kernelCore } from './worklet.js';

overdubKernelWorklet(overdubDsp, kernelCompiler, kernelCore);
