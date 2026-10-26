// The live room's checks: the stage and its press counts [stream C] (docs/research/LIVE-ROOM-MODE.md §11.4, §11.6).
// Run by tools/liveroom-test.js (ONLY=stage), whose header says what a checks module exports. Empty until stream C
// writes them.
export const name = 'stage';
export const pages = true;
export async function run(T, ctx) {}
