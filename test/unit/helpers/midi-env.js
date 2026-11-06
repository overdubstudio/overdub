// input/midi.js reads localStorage and document at load; Node has neither. Call this before importing it.
// Returns the Map behind the fake localStorage so a test can read what was kept.
export function installMidiEnv() {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  if (typeof globalThis.document === 'undefined') globalThis.document = { hidden: false, addEventListener() {} };
  return mem;
}
