// export_take: a recorded take as it went in (dry: the input as recorded, no clip gain, no inserts, no amp), as a WAV on
// the machine of the agent that asked. A local tool: server/mcp.js lists it and writes the file; it is in neither the
// studio's catalog (app.tools, the in-app agent) nor the relay's (claude.ai can't write a file here). The tab runs it
// from agent/bridge.js: it finds the take, encodes it, and puts the bytes on the bridge (POST /bridge/file?id=<call>,
// server/bridge.js) before it answers, so a long take never rides in the JSON answer (the bridge's 8 MB).
//
//   TOOL                                   the schema server/mcp.js lists (name, description, input_schema, annotations)
//   audioTakes(p) -> [{ id, name, track, track_id, bars, seconds, asset, muted, take }]   every audio clip in the song
//   pickTake(p, q) -> { take } | { error, candidates? }   by clip id, then name (exact, then contains), then track name
//   stretchOf(p, clip, sr, len, whole?) -> [s0, s1]        the samples written: from the clip's offset, the floor of its
//                                                          exact span (its beats through the song's tempo), never past len
//   exportTake(app, input, callId) -> result              (input: { take?, whole?, bits? })
//
// The clip's own stretch of its recording (offset to offset + the clip's exact span, its ring included: sample-exact,
// so a loop cut from it is the part's length to the sample, rounded down), or with whole:
// true the recording from its first sample (the lead-in and everything past the part). 24-bit by default; 32 keeps
// every sample exactly as the asset store has it.

import { beatToSec } from '../core/music.js';
import { clipTail } from '../core/project.js';

export const TOOL = {
  name: 'export_take',
  description: `Write a recorded take to a WAV on this machine, dry (as recorded: no effects, no amp, no clip gain). take: a clip id, a clip's name or a track's name; omit it to list the takes. The clip's stretch, its ring included; whole: true for the whole recording. to: a folder or a .wav path (default ~/Downloads/Overdub takes/). bits: 16, 24 (default) or 32 (float). Returns the path, length, sample rate and peak.`,
  input_schema: {
    type: 'object',
    properties: {
      take: { type: 'string' },
      to: { type: 'string' },
      whole: { type: 'boolean' },
      bits: { type: 'number', enum: [16, 24, 32] },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Export a take', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

export function audioTakes(p) {
  const out = [];
  for (const t of p?.tracks || []) {
    for (const c of t.clips || []) {
      if (c.kind !== 'audio' || !c.asset) continue;
      const seconds = beatToSec(p, c.start + c.length) - beatToSec(p, c.start);
      const bpb = (p.meter && p.meter[0]) || 4;
      out.push({ id: c.id, name: c.name || '', track: t.name || '', track_id: t.id, bars: `${round(c.start / bpb + 1, 2)}–${round((c.start + c.length) / bpb + 1, 2)}`, seconds: round(seconds), asset: c.asset, muted: !!c.mute, ...(c.take ? { take: c.take } : {}), ...(clipTail(c) ? { ring_beats: clipTail(c) } : {}) });
    }
  }
  return out;
}

export function pickTake(p, q) {
  const all = audioTakes(p);
  const list = all.map(({ asset, ...t }) => t);
  if (!all.length) return { error: 'This song has no recorded takes.', hint: 'record one first (R), or open the song that has it' };
  const s = String(q || '').trim(), low = s.toLowerCase();
  if (!s) return { error: 'Which take?', candidates: list };
  const one = (hits, how) => (hits.length === 1 ? { take: hits[0] } : hits.length > 1 ? { error: `${hits.length} takes match "${s}" by ${how}: name one by its id.`, candidates: hits.map(({ asset, ...t }) => t) } : null);
  return one(all.filter((t) => t.id === s), 'id')
    || one(all.filter((t) => t.name.toLowerCase() === low), 'name')
    || one(all.filter((t) => t.name.toLowerCase().includes(low)), 'name')
    // a track's takes: the one that plays when there are several (the others are muted in its take folder)
    || one(all.filter((t) => t.track.toLowerCase() === low && !t.muted), 'track') || one(all.filter((t) => t.track.toLowerCase() === low), 'track')
    || { error: `No take matches "${s}".`, candidates: list };
}

export function stretchOf(p, clip, sr, len, whole = false) {
  if (whole) return [0, len];
  const s0 = Math.max(0, Math.min(len, Math.round((+clip.offset || 0) * sr)));
  const span = beatToSec(p, clip.start + clip.length) - beatToSec(p, clip.start);
  return [s0, Math.max(s0, Math.min(len, s0 + Math.floor(span * sr + 1e-6)))];
}

export async function exportTake(app, input = {}, callId = '') {
  const p = app.store.get();
  if (!input.take) {
    const list = audioTakes(p).map(({ asset, ...t }) => t);
    return list.length ? { takes: list, hint: 'export_take with take: one of these ids or names' } : { takes: [], hint: 'this song has no recorded takes' };
  }
  const got = pickTake(p, input.take);
  if (!got.take) return got;
  const t = got.take, clip = p.tracks.find((x) => x.id === t.track_id).clips.find((c) => c.id === t.id);
  const buf = await app.engine.assets.get(t.asset);
  if (!buf) return { error: `The recording behind "${t.name || t.id}" isn't in this browser.`, hint: 'it was recorded in another browser or on another address (each keeps its own); open the song where it was recorded' };
  const sr = buf.sampleRate, len = buf.length;
  const [s0, s1] = stretchOf(p, clip, sr, len, input.whole);
  if (s1 <= s0) return { error: `"${t.name || t.id}" has no audio in its stretch of the recording.`, hint: 'try whole: true' };
  const channels = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) channels.push(buf.getChannelData(ch).slice(s0, s1));
  let peak = 0;
  for (const d of channels) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const bits = [16, 24, 32].includes(+input.bits) ? +input.bits : 24;
  const wav = app.exporter.encodeWav({ sampleRate: sr, channels }, { bits });
  const r = await fetch('/bridge/file?id=' + encodeURIComponent(callId), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: wav });
  if (!r.ok) return { error: `The studio couldn't hand the file over (HTTP ${r.status}).`, hint: 'export_take works through a local Overdub server and its MCP (server/mcp.js) only' };
  const safe = (x) => String(x || '').replace(/[^\w .-]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  const base = [safe(p.title) || 'Overdub', safe(t.name) || safe(t.track) || t.id].join(' - ');
  return {
    take: { id: t.id, name: t.name, track: t.track, bars: t.bars },
    file: { id: callId, name: `${base}${input.whole ? ' (whole)' : ''}.wav`, bytes: wav.length },
    seconds: round((s1 - s0) / sr, 4), samples: s1 - s0, sample_rate: sr, channels: channels.length, bits,
    peak_dbfs: peak > 0 ? round(20 * Math.log10(peak), 1) : null,
    dry: true, ...(+clip.gain ? { clip_gain_db_not_applied: +clip.gain } : {}),
  };
}
