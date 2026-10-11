// @ts-check
// Feature toggles: the one registry. Every feature a person would notice ships off and is turned on by the deploy's
// app/site-config.json, never by a code change. Toggles are temporary (at most MAX_TOGGLES): merged off, on for
// developers (?on=), on for everyone, then retired in a cleanup PR (docs/ARCHITECTURE.md, "Toggles").
//
//   app/site-config.json   { "toggles": { "<id>": "on" | "off" } }   only the exact string "on" turns one on; no file,
//                          {}, no key, an unreadable file or a non-object means all off. Unknown ids: one warning here,
//                          a refused deploy (deploy/deploy.sh) and a failed prod-check (tools/prod-check.js).
//   ?on=a,b  ?on=all       a local studio only (localhost, 127.0.0.1, [::1]): on for that page load. Anywhere else it
//                          does nothing, so a link can never switch anyone's studio.
//   ?relay=  ?cloud=       the developer doors, local only, count as their toggle for that load: ?relay=<origin> is
//                          relay, ?relay= with ?cloud= is accounts, ?cloud=<local origin> is cloud.agent.
//
//   on(id) -> boolean      synchronous; throws on an id the registry doesn't have; off until boot has read the config
//   list() -> [{ id, name, on, by: 'site' | 'url' | 'off' }]
//   offLine(id) -> "<name> isn't on in this studio."
//   readToggles(config, { search, host }) -> { by: { [id]: 'site' | 'url' | 'off' }, warnings }   pure
//   applyToggles(config, { search, host })  sets what on() answers (main.js, once per load), logs one warning
//   auditToggles(config, registry, { registryName }) -> { on, errors, deployOff }   pure: deploy.sh and prod-check
//   deployDefaults() -> { [id]: 'on' }      the deploy: 'on' entries
//
// No DOM at import: Node imports this (deploy.sh, the unit tests). A toggle never changes how a saved song sounds: it
// hides only the ways to add more (nothing under core/, audio/, kernel/ or devices/registry.js reads it).

import { cloudOverride } from './site-config.js';

export const MAX_TOGGLES = 15;

/** @typedef {{ id: string, name: string, about: string, intent: string | null, deploy?: 'on' }} Toggle */

/** @type {ReadonlyArray<Readonly<Toggle>>} */
export const TOGGLES = Object.freeze(/** @type {Toggle[]} */ ([
  // deploy: 'on': on live before the registry existed, so deploy.sh writes it on unless deploy/site-config.json says
  // otherwise (only relay; it goes when relay's toggle is retired)
  { id: 'relay', name: 'Connect to Claude', about: 'The Connect tab: an agent anywhere drives this studio through the relay.', intent: null, deploy: 'on' },
  { id: 'accounts', name: 'Sign in with Overdub', about: 'Overdub accounts in Connect: one fixed URL for every Claude client.', intent: '0010' },
  { id: 'cloud.agent', name: 'Claude on Overdub credits', about: 'The hosted agent, paid with Overdub credits (also needs cloud.api).', intent: '0010' },
  // Nothing reads these two yet: COMMUNITY_LIVE and TRY_ON stay until shelf-live's follow-up moves them here.
  { id: 'community', name: 'The community shelf', about: 'From the community, in the Browser, and the gallery on the site.', intent: '0004' },
  { id: 'community.try', name: 'Trying community devices', about: "Try on a community device: it plays for this page load before it's kept.", intent: '0004' },
  // Planned: their branches adopt these after the registry merges.
  { id: 'start.slice2', name: 'Start a song, the rest of it', about: "The second slice of Start a song's stage.", intent: '0003' },
  { id: 'device.rooms', name: 'Real Rooms', about: 'Reverb from recordings of real spaces (Echo Chamber).', intent: '0006' },
  { id: 'workflow.flip', name: 'Flip a song', about: 'The Flip a song door: start from a recording and make it yours.', intent: '0014' },
  { id: 'stems.local', name: 'Stem splitting', about: 'Pull a recording apart into stems, on this machine.', intent: '0013' },
]).map((t) => Object.freeze(t)));

const BY_ID = new Map(TOGGLES.map((t) => [t.id, t]));
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** @type {Record<string, 'site' | 'url' | 'off'> | null} */
let current = null;

function known(id) {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`no toggle "${id}"`);
  return t;
}

/** @param {string} id */
export function on(id) {
  known(id);
  return !!current && current[id] !== 'off';
}

export function list() {
  return TOGGLES.map((t) => ({ id: t.id, name: t.name, on: !!current && current[t.id] !== 'off', by: current?.[t.id] || 'off' }));
}

/** @param {string} id */
export function offLine(id) {
  return `${known(id).name} isn't on in this studio.`;
}

/** @returns {Record<string, 'on'>} */
export function deployDefaults() {
  /** @type {Record<string, 'on'>} */
  const out = {};
  for (const t of TOGGLES) if (t.deploy === 'on') out[t.id] = 'on';
  return out;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The relay door (agent/remote.js relayOverride): any http(s) origin, on a local studio.
function relayDoor(search, host) {
  if (!LOOPBACK.test(host)) return false;
  const q = new URLSearchParams(search).get('relay');
  if (!q) return false;
  try { return /^https?:$/.test(new URL(q).protocol); } catch { return false; }
}

/**
 * What's on, from the deploy's config and (on a local studio only) the address. Pure.
 * @param {unknown} config the parsed site-config.json, or anything
 * @param {{ search?: string, host?: string }} [where]
 */
export function readToggles(config, { search = '', host = '' } = {}) {
  /** @type {Record<string, 'site' | 'url' | 'off'>} */
  const by = {};
  for (const t of TOGGLES) by[t.id] = 'off';
  const unknown = [];
  const raw = isObject(config) ? /** @type {any} */ (config).toggles : undefined;
  if (isObject(raw)) {
    for (const [id, v] of Object.entries(raw)) {
      if (!BY_ID.has(id)) { unknown.push(id); continue; }
      if (v === 'on') by[id] = 'site';
    }
  }
  if (LOOPBACK.test(host)) {
    const asked = new URLSearchParams(search).get('on');
    if (asked) {
      for (const id of asked.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (id === 'all') { for (const t of TOGGLES) if (by[t.id] === 'off') by[t.id] = 'url'; }
        else if (!BY_ID.has(id)) unknown.push(id);
        else if (by[id] === 'off') by[id] = 'url';
      }
    }
    const relay = relayDoor(search, host), cloud = !!cloudOverride(search, host);
    if (relay && by.relay === 'off') by.relay = 'url';
    if (relay && cloud && by.accounts === 'off') by.accounts = 'url';
    if (cloud && by['cloud.agent'] === 'off') by['cloud.agent'] = 'url';
  }
  const warnings = unknown.length ? [`overdub: no toggle ${unknown.map((u) => `"${u}"`).join(', ')} in this studio; ignored`] : [];
  return { by, warnings };
}

/**
 * Set what on() answers for this page load (main.js, once, before the first module starts). A config that never
 * came (null) leaves every toggle off, except what the address turns on locally.
 * @param {unknown} config
 * @param {{ search?: string, host?: string }} [where]
 */
export function applyToggles(config, where) {
  const r = readToggles(config, where);
  current = r.by;
  for (const w of r.warnings) console.warn(w);
  return list();
}

/**
 * Check a site config against a registry (deploy.sh before it ships one, prod-check against the live one). Pure.
 *   on: the ids it turns on; errors: what a live deploy refuses (a non-object toggles, a value other than "on" or
 *   "off", an id the registry doesn't have); deployOff: the deploy: 'on' entries it doesn't turn on, and why.
 * @param {unknown} config
 * @param {ReadonlyArray<{ id: string, deploy?: string }>} [registry]
 * @param {{ registryName?: string }} [opts] who the registry is, in the error lines (deploy.sh names the ref)
 */
export function auditToggles(config, registry = TOGGLES, { registryName = 'the registry' } = {}) {
  const ids = new Set(registry.map((t) => t.id));
  const on = [], errors = [], deployOff = [];
  const raw = isObject(config) ? /** @type {any} */ (config).toggles : undefined;
  if (raw !== undefined && !isObject(raw)) errors.push(`"toggles" is ${Array.isArray(raw) ? 'an array' : raw === null ? 'null' : typeof raw}, not an object`);
  const t = isObject(raw) ? raw : {};
  for (const [id, v] of Object.entries(t)) {
    if (!ids.has(id)) errors.push(`names toggle "${id}", which ${registryName} doesn't register`);
    else if (v !== 'on' && v !== 'off') errors.push(`toggle "${id}" is ${JSON.stringify(v)}, not "on" or "off"`);
    else if (v === 'on') on.push(id);
  }
  for (const r of registry) if (r.deploy === 'on' && t[r.id] !== 'on') deployOff.push({ id: r.id, why: Object.hasOwn(t, r.id) ? `the file says ${JSON.stringify(t[r.id])}` : 'the file leaves it out' });
  return { on, errors, deployOff };
}
