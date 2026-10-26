// The live room's checks: the input and the deck [stream A] (docs/research/LIVE-ROOM-MODE.md §11.5).
// Run by tools/liveroom-test.js (ONLY=input), whose header says what a checks module exports. Empty until stream A
// writes them.
export const name = 'input';
export const pages = true;
export async function run(T, ctx) {}
