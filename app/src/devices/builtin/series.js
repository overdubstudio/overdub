// @ts-check
// sin, cos and exp from + - * /, Math.round and Math.floor alone: the same doubles on every engine, where Math.sin and
// Math.exp differ between engines in the last bit. Shared as kernel text: a kernel that needs them pastes SERIES into
// its source (Echo Chamber, core.rooms, through rooms-lib.js), and a tool that must build the same numbers imports the
// functions themselves (tools/kits/air-rooms.js). One source, no eval: SERIES is these functions' own text.
//
//   dsin(x), dcos(x)   the series sampler.js's sinc table, kernel/convolve.js and amp-lib.js's cabSin already carry
//                      (each its own copy, inside a kernel whose hash is pinned, so they stay as they are);
//                      tools/rooms-test.js holds dsin to convolve.js's, double for double
//   dexp(x)            e^x: x = k ln 2 + r with |r| <= ln 2 / 2, a Taylor series in r, then 2^k by exact doubling
//                      (within 1e-15 of Math.exp, relative, from -745 to 709)
//
// The text of these functions is kernel source: never reformat this file (biome.jsonc lists it).

export function dsin(x) {
  const k = Math.round(x / (2 * Math.PI)); x -= k * 2 * Math.PI;
  if (x > Math.PI / 2) x = Math.PI - x; else if (x < -Math.PI / 2) x = -Math.PI - x;
  const x2 = x * x; let term = x, s = x;
  for (let n = 1; n < 12; n++) { term *= -x2 / ((2 * n) * (2 * n + 1)); s += term; }
  return s;
}
export function dcos(x) { return dsin(Math.PI / 2 - x); }
export function dexp(x) {
  if (Number.isNaN(x)) return x;
  if (x > 709.79) return Infinity;
  if (x < -745.2) return 0;
  // (ln 2 in two parts, Cody and Waite's: k * the first is exact, so r keeps its low bits)
  const k = Math.round(x / Math.LN2), r = (x - k * 0.6931471803691238) - k * 1.9082149292705877e-10;
  let term = 1, s = 1;
  for (let n = 1; n < 18; n++) { term *= r / n; s += term; }
  // 2^k in two halves (each finite), a bit at a time: every factor is a power of two, so each product is exact (only
  // a result under 2^-1022 rounds, once, as exp's own does)
  // (two loops, not one over [h, k - h]: that array would be garbage on every call)
  const h = Math.floor(k / 2);
  let m = h < 0 ? -h : h, b = h < 0 ? 0.5 : 2, p = 1;
  while (m > 0) { if (m & 1) p *= b; b *= b; m = Math.floor(m / 2); }
  s *= p;
  const j = k - h;
  m = j < 0 ? -j : j; b = j < 0 ? 0.5 : 2; p = 1;
  while (m > 0) { if (m & 1) p *= b; b *= b; m = Math.floor(m / 2); }
  s *= p;
  return s;
}

export const SERIES = [dsin, dcos, dexp].map(String).join('\n');
