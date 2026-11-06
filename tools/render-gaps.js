// What renderSong (app/src/engine/node/render.js) did not play. It reports a device it could not run in `warnings` and
// in `skipped` ({ tracks: [id], inserts: [id] }): an instrument's track is skipped, an effect is bypassed. The studio
// plays those, so a render that loses one measures a different song than the browser would.
//   graph: pedals and amps are Web Audio node graphs, which the Node renderer bypasses by design (ARCHITECTURE.md).
//          They are listed, not failed.
//   fatal: everything else: a device that is missing or failed to build or stopped, a kit that is not on disk, an asset
//          that is missing, a skipped track or bypassed insert nothing above explains.
export function renderGaps(buf) {
  const warnings = buf.warnings || [], skipped = buf.skipped || { tracks: [], inserts: [] };
  const graph = warnings.filter((w) => w.kind === 'graph');
  const explained = new Set(graph.flatMap((w) => [w.track, w.insert]).filter(Boolean));
  const fatal = [
    ...warnings.filter((w) => w.kind !== 'graph' && w.kind !== 'id').map((w) => w.message),
    ...skipped.tracks.filter((id) => !explained.has(id)).map((id) => `track ${id} skipped`),
    ...skipped.inserts.filter((id) => !explained.has(id)).map((id) => `insert ${id} bypassed`),
  ];
  return { fatal, graph: graph.map((w) => w.device) };
}
