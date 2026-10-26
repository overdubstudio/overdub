// The live room's checks: the door and sending [stream F] (docs/research/LIVE-ROOM-MODE.md §11.8).
// Run by tools/liveroom-test.js (ONLY=door), whose header says what a checks module exports. Empty until stream F
// writes them.
export const name = 'door';
export const pages = true;
export async function run(T, ctx) {}
