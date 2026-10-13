// Flip a song (spec 0014 section D): what the import and the stems become in the song, as ops. Pure: the page
// (ui/flip.js) decodes the files, stores the samples and dispatches these; tools/flip-test.js and the unit tests call
// them in Node.
//
//   labelStem(fileName) -> 'vocals' | 'drums' | 'bass' | 'other' | null     what a brought file is, by its name: vocal,
//       vox, acapella, voice -> vocals; drum, perc -> drums; bass -> bass; other, inst, instrumental -> other; anything
//       else is the original (null). One file alone is always the original (labelFiles).
//   labelFiles(names) -> roles   each file's role ('original' or a stem); a lone file is the original
//   songNameOf(files) -> 'One Last Breath'   the song's name: the original's file name, else a stem's with its stem
//       word taken off
//   planFlip(p, { name, files: [{ role, asset: { id, name, sr, channels, duration } }], stemsLater }) -> { ops, label,
//       refs: [{ role, track, clip }] }   (track and clip: the refs, read from the dispatch's created)
//       One undo step, "Flip: <name>" (R25): the original on a track named Original, the stems on Vocals, Drums, Bass
//       and Other (in that order, whatever order they came in), every clip at beat 0 with offset 0 (the analysis
//       places them, toOps.js), each clip named as its track. What plays: the vocal, when there is one; the original
//       and the other stems are on hand, muted (track mute). With no vocal stem the original plays (or, with no
//       original either, every stem). stemsLater: the split will bring stems, so the original plays until they land.
//       A second file with a role already taken lands on its own track, named from its file, muted. The song's title
//       becomes the name when it is still Untitled.
//   planStems(p, { name, original: { track, clip }, assets: { vocals, drums, bass, other } }) -> { ops, label, refs }
//       The split's stems landing later, as their own step ("Stems from <name>", by the house): a track each, every
//       clip where the original's is (start, length, offset), the vocal playing and the original muted with the rest.
// Muting is the track's (track.set mute), so a solo or the mixer brings any of them back in one click.

export const STEM_ROLES = ['vocals', 'drums', 'bass', 'other'];
export const TRACK_NAMES = { original: 'Original', vocals: 'Vocals', drums: 'Drums', bass: 'Bass', other: 'Other' };
const ORDER = ['original', ...STEM_ROLES];

const WORDS = [
  ['vocals', /\b(?:lead[\s_-]*)?(?:vocals?|vox|a[\s_-]?cappella|acapella|voices?)\b/i],
  ['drums', /\b(?:drums?|percussion|perc)\b/i],
  ['bass', /\bbass\b/i],
  ['other', /\b(?:others?|inst|instrumentals?|accompaniment)\b/i],
];
const base = (name) => String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
// file names join words with _ - . and spaces; \b needs them as spaces
const spaced = (name) => base(name).replace(/[_.]+/g, ' ');

export function labelStem(fileName) {
  const s = spaced(fileName);
  for (const [role, re] of WORDS) if (re.test(s)) return role;
  return null;
}
export function labelFiles(names) {
  if (names.length === 1) return ['original'];
  return names.map((n) => labelStem(n) || 'original');
}

const tidy = (s) => s.replace(/[\s_.\-–—()[\]]+$/g, '').replace(/^[\s_.\-–—()[\]]+/g, '').replace(/\s{2,}/g, ' ').trim();
export function songNameOf(files) {
  const names = (files || []).map((f) => (typeof f === 'string' ? f : f && f.name) || '');
  const roles = labelFiles(names);
  const orig = names.find((_, i) => roles[i] === 'original');
  if (orig) return tidy(spaced(orig)).slice(0, 60) || 'the song';
  for (const n of names) {
    let s = spaced(n);
    for (const [, re] of WORDS) s = s.replace(new RegExp(re.source, 'gi'), ' ');
    s = tidy(s.replace(/\b(?:stems?|track|split)\b/gi, ' ').replace(/\(\s*\)|\[\s*\]/g, ' '));
    if (s) return s.slice(0, 60);
  }
  return 'the song';
}

// the beats a recording lasts at the song's one tempo (a flip starts on a blank song: no map yet)
const beatsOf = (p, secs) => Math.max(1 / 16, Math.round(secs * ((+p.tempo || 120) / 60) * 10000) / 10000);

export function planFlip(p, { name, files = [], stemsLater = false }) {
  const label = `Flip: ${name}`;
  const ops = [], refs = [];
  if ((p.title || 'Untitled') === 'Untitled' && name && name !== 'the song') ops.push({ type: 'project.set', patch: { title: name } });
  const taken = new Set();
  const list = files.slice().sort((a, b) => ORDER.indexOf(a.role || 'original') - ORDER.indexOf(b.role || 'original'));
  const roles = new Set(list.map((f) => f.role || 'original'));
  const hasVocal = roles.has('vocals'), hasOriginal = roles.has('original');
  const plays = (role) => (stemsLater ? role === 'original' : hasVocal ? role === 'vocals' : hasOriginal ? role === 'original' : true);
  list.forEach((f, i) => {
    const role = f.role || 'original';
    const extra = taken.has(role);
    taken.add(role);
    const tname = extra ? (base(f.asset.name).slice(0, 40) || TRACK_NAMES[role]) : TRACK_NAMES[role];
    ops.push({ type: 'asset.add', asset: { id: f.asset.id, kind: 'audio', name: f.asset.name, sr: f.asset.sr, channels: f.asset.channels, duration: f.asset.duration } });
    ops.push({ type: 'track.add', ref: 'fl' + i, track: { name: tname, kind: 'audio', instrument: null, mute: extra || !plays(role) } });
    ops.push({ type: 'clip.add', track: '$fl' + i, ref: 'fc' + i, clip: { kind: 'audio', start: 0, length: beatsOf(p, f.asset.duration), asset: f.asset.id, offset: 0, gain: 0, name: tname } });
    refs.push({ role: extra ? 'extra' : role, track: 'fl' + i, clip: 'fc' + i });
  });
  return { ops, label, refs };
}

export function planStems(p, { name, original, assets }) {
  const label = `Stems from ${name}`;
  let at = { start: 0, length: null, offset: 0 }, index = p.tracks.length;
  if (original) {
    for (const [i, t] of p.tracks.entries()) {
      const c = t.id === original.track ? t.clips.find((x) => x.id === original.clip) : null;
      if (c) { at = { start: c.start, length: c.length, offset: +c.offset || 0 }; index = i + 1; }
    }
  }
  const ops = [], refs = [];
  STEM_ROLES.forEach((role, i) => {
    const a = assets[role];
    if (!a) return;
    ops.push({ type: 'asset.add', asset: { id: a.id, kind: 'audio', name: a.name, sr: a.sr, channels: a.channels, duration: a.duration } });
    ops.push({ type: 'track.add', ref: 'st' + i, index: index++, track: { name: TRACK_NAMES[role], kind: 'audio', instrument: null, mute: role !== 'vocals' } });
    const length = at.length != null ? at.length : beatsOf(p, a.duration);
    ops.push({ type: 'clip.add', track: '$st' + i, ref: 'sc' + i, clip: { kind: 'audio', start: at.start, length, asset: a.id, offset: at.offset, gain: 0, name: TRACK_NAMES[role] } });
    refs.push({ role, track: 'st' + i, clip: 'sc' + i });
  });
  if (original && assets.vocals && p.tracks.some((t) => t.id === original.track && !t.mute)) ops.push({ type: 'track.set', track: original.track, patch: { mute: true } });
  return { ops, label, refs };
}
