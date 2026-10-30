// @ts-check
// The lifecycle of a device in a live chain [frozen seam: amp/base, docs/research/AMP-PATH.md §5]: the contract between
// the engine, which builds, wires, swaps and checks chains (engine/strip.js, input/livepath.js), and the devices, which
// keep their own state (devices/graph.js and kit.js, the guitar gear, kernels). Neither side edits this file: a change
// is made where the seam was frozen and merged into both.
//
//   build      (device)  instantiate() makes the nodes and sets each one by .value. Nothing is scheduled on a node that
//                        hasn't rendered yet: no value curve, no glide, no ramp (Chrome 155 and 156 drop a value curve
//                        that ends before its node first renders, and leave the param where it was).
//   ready      (device)  inst.ready resolves once the instance is at its state: params set, bypass as asked, worklets
//                        in. It REJECTS when the device can't be what it says: failure(code, message) below. A device
//                        never stands in for itself (a quiet unity gain is the bug this file exists for).
//   wire       (engine)  a chain is connected only when every device in it is ready (built beside the playing one and
//                        crossfaded in, or behind the strip's dip).
//   bypass     (device)  setOn(on, at?): click-free, from ONE read of the audio clock, with setTargetAtTime or linear
//                        ramps (both land on a node that hasn't rendered). No setValueCurveAtTime on a live context.
//                        Offline (renders, scheduled ahead from time 0) as it always was: renders stay bit-identical.
//   assure     (engine)  assure(inst) after the strip has wired a device and its fades are over, and when the health
//                        check finds it wrong: the device snaps anything not at its target there at once.
//   health     (device)  healthOf(inst): what the device says about itself (below).
//   swap       (engine)  the new chain built and ready before it's wired, the old one faded and torn down after.
//   tear down  (device)  dispose(): idempotent; stops every source, timer and worklet it started; disconnects.
//   retry      (engine)  a rejected ready plays the engine's stand-in (engine/fallback.js: an effect passes its input
//                        through, inst.fallback set), is reported as an 'error', and is built again later (strip.js BUILD).
//
// Optional Instance members this adds (docs/ARCHITECTURE.md "Instance"; a kernel instance may leave both out):
//   inst.health() -> { ok, failed, on, settled, dry, wet, want: { dry, wet } }
//       ok: the device is what it was asked to be (built, and settled at its bypass state); failed: why it isn't built
//       ('' when it is); on: its bypass as asked; settled: no fade still running (a check waits for that); dry, wet:
//       the bypass gains as they are now (AudioParam.value), null for a device without them; want: as they should be.
//   inst.assure() -> boolean   snap to the targets at once (cancel what's scheduled, set .value); true if it had to.

/** Why a device's ready rejected (Error.code). */
export const FAILURE_CODES = Object.freeze(['threw', 'no-output', 'worklet']);

/**
 * The Error a device's `ready` rejects with.
 * @param {'threw'|'no-output'|'worklet'} code
 * @param {string} message what happened, in words (the engine's report and the talkback say it)
 * @param {unknown} [cause]
 * @returns {Error & { code: string, device?: string }}
 */
export function failure(code, message, cause) {
  const e = /** @type {Error & { code: string }} */ (new Error(message, cause === undefined ? undefined : { cause }));
  e.code = FAILURE_CODES.includes(code) ? code : 'threw';
  return e;
}

/** @param {unknown} e  @returns {string} the failure's code, or '' for any other error */
export const failureCode = (e) => (e && typeof e === 'object' && typeof (/** @type {any} */ (e).code) === 'string' && FAILURE_CODES.includes(/** @type {any} */ (e).code) ? /** @type {any} */ (e).code : '');

/**
 * What an instance says about itself, normalised: a device without health() (a kernel instrument) is ok unless it's a
 * stand-in. (A kernel effect has one, kernel/host.js, about its bypass gains as a graph device's is.)
 * Never throws.
 * @param {any} inst
 * @returns {{ ok: boolean, failed: string, on: boolean | null, settled: boolean, dry: number | null, wet: number | null, want: { dry: number | null, wet: number | null } | null, known: boolean }}
 */
export function healthOf(inst) {
  const none = { ok: false, failed: 'no instance', on: null, settled: true, dry: null, wet: null, want: null, known: false };
  if (!inst) return none;
  if (inst.fallback) return { ...none, failed: 'stand-in', on: inst.on ?? null, known: true };
  if (typeof inst.health !== 'function') return { ok: true, failed: '', on: inst.on ?? null, settled: true, dry: null, wet: null, want: null, known: false };
  try {
    const h = inst.health() || {};
    return {
      ok: !!h.ok,
      failed: h.failed ? String(h.failed) : '',
      on: h.on ?? inst.on ?? null,
      settled: h.settled !== false,
      dry: Number.isFinite(h.dry) ? h.dry : null,
      wet: Number.isFinite(h.wet) ? h.wet : null,
      want: h.want || null,
      known: true,
    };
  } catch (e) {
    return { ...none, failed: 'health: ' + ((e && /** @type {any} */ (e).message) || e), known: true };
  }
}

/**
 * Ask an instance to snap to its targets. Never throws.
 * @param {any} inst
 * @returns {boolean} true if it had to
 */
export function assure(inst) {
  if (!inst || typeof inst.assure !== 'function') return false;
  try { return !!inst.assure(); } catch (e) { console.warn('device ' + (inst.def?.id || inst.uid || '') + ' assure:', e); return false; }
}
