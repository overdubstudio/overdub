// @ts-check
// The paper [core] (docs/research/LIVE-ROOM-MODE.md §6.1): the kitchen table's words and chords as people write them,
// in and out. The song keeps the sheet (core/liveroom/model.js, the sheet.* ops); this reads and writes its text. Pure:
// no DOM, no Math.random.
//
// A line is plain text, 200 characters at most, in ChordPro's inline form: each chord in [brackets] just before the
// syllable it falls on ("Somewhere a [G]paper [Em]moon"), so a chord stays on its syllable when the words round it
// change. A line of chords alone is written in bars: "| G | Em | C D |". A chord that doesn't parse is kept as it was
// written (the paper marks it; nobody plays it). Chords are letter names (parseChord: slash chords, extensions) or
// Nashville numbers ("1 4 6- 5", "1/5"), read in the key of the shapes through parseRoman.
//
// The capo keeps the shapes and moves the sounding key (ChordPro's rule): capo 3 on G shapes sounds in Bb. The song's
// key (project.key) is the sounding one, so the band, the tuner and every tool read one key.
//
// Frozen (§14.2):
//   parseSheet(text) -> { v, capo?, time?, notes?, sections, title?, artist?, key?, tempo? }   ChordPro or chords over
//       words (the Ultimate Guitar layout), as pasted: sections [{ name, lines: [{ text }] }], each written once (a
//       repeat of a section already on the paper, or a recall like {chorus}, isn't written again); key: the shapes'
//       key as the file gives it ({ root, scale }); title, artist and tempo from the file's header
//   formatSheet(sheet, { as: 'chordpro' | 'text', title, artist, key, tempo }) -> text   the paper as a file
//   lineParts(text) -> [{ text, chord }]   a line in pieces: each [bracketed] chord with the words after it (the first
//       piece's chord is null when the line starts with words); a bar line is one piece per chord, with bar: its index
//   soundingKey(sheet, p) -> { root, scale } | null   the key it sounds in: the shapes plus the capo (the song's key)
//   transposeChord(sym, semis, key?) -> sym   a chord symbol moved (one that doesn't parse, or a number, is kept)
// And, for the paper and the kitchen:
//   isBars(text), barsOf(text) -> [[sym]] | null       a chords-only line and its bars
//   lineWords(text) -> the words alone; chordsOf(text) -> [{ sym, at, bar? }] (at: the index in the words)
//   setWords(text, words) -> text    the words changed, each chord kept on its syllable (a diff of the two)
//   insertChord(text, at, sym) -> text   a chord put in at an index of the words
//   readChord(sym, key) -> chord | null   a symbol read (core/jam.js parseChord, or a Nashville number in `key`)
//   shapesKey(sheet, p) -> { root, scale }   the key of the shapes on the paper (the song's key less the capo when the
//       paper has no letter chords to say)
//   sheetChords(sheet, p) -> [{ section, chords: [{ sym, chord (sounding) | null, line, bar? }] }]   every section's
//       chords in order, with the sounding chord (the capo applied) beside each symbol as written
//   chordRow(sheet, p) -> [sym]   the chord row over a line being edited: the key's six common chords in the capo's
//       shapes, then the chords the paper already uses
//   capoChoices(key) -> [{ capo, shapes }]   the capos that put a sounding key on open shapes (G shapes, capo 3 · ...)
//   pasteOps(p, parsed, { replace }) -> { ops, cut }   a parsed sheet into the song: sheet.* ops (and the title and key)
//   newVerse(sheet) -> { name, lines: [{ text }] }   a new verse with the last verse's chords and its words left empty
//   describeSheet(sheet) -> { sections, lines, chords: [sym] }
//   keyName(key) -> 'B♭ major' (for a person)

import { parseChord, parseRoman, QUALITIES } from '../jam.js';
import { parsePc, SCALES } from '../music.js';
import { ROOM_LIMITS } from './model.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const pcOf = (n) => ((Math.round(n) % 12) + 12) % 12;

/* ------------------------------------------------------------------------------------------------ chord symbols */
// How a sounding root is spelled: flats on the flat side (Bb, Eb, Ab, Db), sharps on F# and C#, as guitarists write.
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PLAIN_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// a major chord's own key, as guitarists name it (F#, not Gb; Db, not C#)
const OWN_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// keys by their signature: major roots that take flats, minor roots that take flats
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);   // F Bb Eb Ab Db (F# rather than Gb)
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);   // D G C F Bb Eb
const flatKey = (key) => {
  if (!key) return null;
  const r = parsePc(key.root);
  if (!Number.isFinite(r)) return null;
  if (/b/.test(String(key.root).slice(1))) return true;
  if (/#/.test(String(key.root))) return false;
  return /minor|dorian|phrygian|blues/i.test(key.scale) ? FLAT_MINOR.has(r) : FLAT_MAJOR.has(r);
};
const nameIn = (pc, key) => { const f = flatKey(key); return (f == null ? PLAIN_NAMES : f ? FLAT_NAMES : SHARP_NAMES)[pcOf(pc)]; };

// a letter symbol's parts: root, accidental, the quality as written, the bass
const SYM = /^\s*([A-Ga-g])([#b♯♭]?)(6\/9|[^/\s]*)(?:\/([A-Ga-g][#b♯♭]?))?\s*$/;
const acc = (s) => String(s || '').replace('♯', '#').replace('♭', 'b');
// A Nashville number: a degree 1-7 (with b or # before it), a quality ('-' or m minor, 7, maj7, sus4, °, ø, +), a bass
// number after a slash. "1", "6-", "4maj7", "5/7", "b7".
const NASH = /^\s*([b#♭♯]?)([1-7])([^/\s]*)(?:\/([b#♭♯]?)([1-7]))?\s*$/;
const ROMAN_OF = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export const isNashville = (sym) => NASH.test(String(sym ?? '')) && nashQuality(NASH.exec(String(sym))?.[3] ?? '') != null;
function nashQuality(q) {
  if (q === '' || q === '-' || q === 'm') return q;
  if (/^(-|m)(7|9|6|11|13|7b5)$/.test(q)) return q;
  if (/^(7|maj7|M7|9|6|sus4|sus2|sus|add9|°|o|ø|ø7|°7|\+|aug|dim|5|11|13)$/.test(q)) return q;
  return null;
}
// a Nashville number as a Roman numeral parseRoman reads ('6-' -> 'vi', '4maj7' -> 'IVmaj7', '5/7' -> 'V/VII')
function nashToRoman(sym) {
  const m = NASH.exec(String(sym));
  if (!m) return null;
  let q = m[3];
  const minor = q.startsWith('-') || (q.startsWith('m') && !q.startsWith('maj'));
  if (minor) q = q.slice(1);
  const deg = ROMAN_OF[+m[2]];
  return `${m[1]}${minor ? deg.toLowerCase() : deg}${q}${m[5] ? `/${m[4]}${ROMAN_OF[+m[5]]}` : ''}`;
}

// readChord(sym, key): a chord as core/jam.js makes one ({ root, quality, pcs, bass, name }), or null
export function readChord(sym, key = null) {
  const s = String(sym ?? '').trim();
  if (!s || s.length > 24) return null;
  if (SYM.test(s) && /^[A-G]/.test(s)) return parseChord(s, key);
  if (isNashville(s)) {
    const r = nashToRoman(s);
    return r ? parseRoman(r, key || { root: 'C', scale: 'major' }) : null;
  }
  return null;
}
// A chord symbol, for the parser of a plain-text chord line: a capital letter name, or a number
const isLetterChord = (tok) => /^[A-G]/.test(tok) && !!readChord(tok);

export function transposeChord(sym, semis, key = null) {
  const s = String(sym ?? '');
  const m = SYM.exec(s);
  if (!m || !/^[A-G]/.test(s.trim()) || !parseChord(s.trim())) return s;
  const n = Math.round(Number(semis) || 0);
  if (!n) return s.trim();
  const root = parsePc(m[1].toUpperCase() + acc(m[2]));
  // (with no key given, the chord's own: E/G#, Bb/D)
  const own = key || { root: '', scale: isMinorQ(parseChord(s.trim())?.quality) ? 'minor' : 'major' };
  if (!key) own.root = (/minor/.test(own.scale) ? SHARP_NAMES : OWN_MAJOR)[pcOf(root + n)];
  key = own;
  const out = nameIn(root + n, key) + m[3] + (m[4] ? '/' + nameIn(parsePc(m[4][0].toUpperCase() + acc(m[4].slice(1))) + n, key) : '');
  return out;
}

/* ------------------------------------------------------------------------------------------------ a line */
const CHORD_TOKEN = /\[([^\]\n]{0,24})\]/g;
// A chords-only line: it starts with a bar line, and every token after is a bar line, a chord or a repeat sign.
export const isBars = (text) => /^\s*\|/.test(String(text ?? ''));
export function barsOf(text) {
  if (!isBars(text)) return null;
  const bars = [];
  for (const cell of String(text).split('|').slice(1)) {
    const toks = cell.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    bars.push(toks);
  }
  // (a trailing bar line closes the last bar: "| G | Em |" is two bars)
  return bars;
}

export function lineParts(text) {
  const s = String(text ?? '');
  if (isBars(s)) {
    const out = [];
    (barsOf(s) || []).forEach((bar, i) => { for (const sym of bar) out.push({ text: '', chord: sym, bar: i }); });
    return out.length ? out : [{ text: '', chord: null }];
  }
  const out = [];
  let last = 0, chord = null;
  CHORD_TOKEN.lastIndex = 0;
  for (let m; (m = CHORD_TOKEN.exec(s)); ) {
    const words = s.slice(last, m.index);
    if (words || chord != null || out.length) out.push({ text: words, chord });
    chord = m[1].trim();
    last = m.index + m[0].length;
  }
  const tail = s.slice(last);
  if (tail || chord != null || !out.length) out.push({ text: tail, chord });
  // (the first piece is words with no chord over them only when the line starts with words)
  return out.filter((x, i) => i === 0 || x.chord != null || x.text);
}

export const lineWords = (text) => (isBars(text) ? '' : String(text ?? '').replace(CHORD_TOKEN, ''));

/** @returns {{ sym: string, at: number, bar?: number }[]} */
export function chordsOf(text) {
  if (isBars(text)) return (barsOf(text) || []).flatMap((bar, i) => bar.filter((t) => t !== '%' && t !== '/' && t !== '-' && t !== '.').map((sym) => ({ sym, at: 0, bar: i })));
  const out = [];
  let words = 0, last = 0;
  const s = String(text ?? '');
  CHORD_TOKEN.lastIndex = 0;
  for (let m; (m = CHORD_TOKEN.exec(s)); ) {
    words += m.index - last;
    last = m.index + m[0].length;
    const sym = m[1].trim();
    if (sym) out.push({ sym, at: words });
  }
  return out;
}

// The line with its chords put back at word indexes: [{ sym, at }] over `words`.
function withChords(words, chords) {
  const sorted = chords.slice().sort((a, b) => a.at - b.at);
  let out = '', i = 0;
  for (const c of sorted) {
    const at = Math.max(0, Math.min(words.length, c.at));
    out += words.slice(i, at) + `[${c.sym}]`;
    i = at;
  }
  return out + words.slice(i);
}

// setWords(text, words): new words under the same chords, each chord kept on its syllable. The two lines' words are
// lined up (their longest common run, word by word): a chord on a word that's still there stays on it (at the same
// letter, when the word is long enough); a chord on a word that was changed goes to the word in its place (the same
// share of the words written between the two kept words around it), or, with none there, onto the next kept word.
const wordsOf = (s) => { const out = []; const re = /\S+/g; for (let m; (m = re.exec(s)); ) out.push({ w: m[0], at: m.index }); return out; };
export function setWords(text, words) {
  if (isBars(text)) return String(words ?? '');
  const old = lineWords(text), nw = String(words ?? '');
  const chords = chordsOf(text);
  if (!chords.length) return nw;
  const A = wordsOf(old), B = wordsOf(nw);
  // the longest common subsequence of the words (lines are short: 200 characters at most)
  const L = Array.from({ length: A.length + 1 }, () => new Int16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i].w === B[j].w ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const match = new Array(A.length).fill(-1);
  for (let i = 0, j = 0; i < A.length && j < B.length; ) {
    if (A[i].w === B[j].w) { match[i] = j; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const moved = chords.map((c) => {
    // the word the chord is on (the first one starting at or after it, when it sits between words)
    let wi = A.findIndex((x) => c.at >= x.at && c.at < x.at + x.w.length);
    const into = wi >= 0 ? c.at - A[wi].at : 0;
    if (wi < 0) wi = A.findIndex((x) => x.at >= c.at);
    if (wi < 0) return { ...c, at: nw.length };
    if (match[wi] >= 0) { const b = B[match[wi]]; return { ...c, at: b.at + (into < b.w.length ? into : 0) }; }
    // a changed word: between the kept words around it
    let lo = wi - 1; while (lo >= 0 && match[lo] < 0) lo--;
    let hi = wi + 1; while (hi < A.length && match[hi] < 0) hi++;
    const a0 = lo + 1, a1 = hi, b0 = lo >= 0 ? match[lo] + 1 : 0, b1 = hi < A.length ? match[hi] : B.length;
    if (b1 > b0) { const k = b0 + Math.min(b1 - b0 - 1, Math.floor(((wi - a0) / Math.max(1, a1 - a0)) * (b1 - b0))); return { ...c, at: B[k].at }; }
    return { ...c, at: b1 < B.length ? B[b1].at : nw.length };
  });
  return withChords(nw, moved);
}
export function insertChord(text, at, sym) {
  const s = String(sym ?? '').trim();
  if (isBars(text)) return `${String(text).replace(/\s*\|?\s*$/, '')} | ${s} |`;
  return withChords(lineWords(text), [...chordsOf(text), { sym: s, at }]);
}

/* ------------------------------------------------------------------------------------------------ keys */
const MAJOR = SCALES.major, MINOR = SCALES.minor;
const isMinorQ = (q) => !!QUALITIES[q]?.minor;
// The key the shapes are in, from the chords as written: each of the 24 keys scored on how many chords are its own
// (the root in the scale and the quality the scale gives it), the first and last chord on its tonic a little more.
export function keyOfChords(chords, prefer = null) {
  const list = chords.filter(Boolean);
  if (!list.length) return null;
  let best = null;
  for (let r = 0; r < 12; r++) for (const scale of ['major', 'minor']) {
    const sc = (scale === 'major' ? MAJOR : MINOR).map((i) => (r + i) % 12);
    let s = 0;
    for (const c of list) {
      const deg = sc.indexOf(c.root);
      if (deg < 0) { s -= 1; continue; }
      const third = (sc[(deg + 2) % 7] - c.root + 12) % 12;
      s += (third === 3) === isMinorQ(c.quality) || c.quality === '5' ? 2 : 0.5;
    }
    const tonic = (c) => c && c.root === r && isMinorQ(c.quality) === (scale === 'minor');
    if (tonic(list[0])) s += 1.5;
    if (tonic(list[list.length - 1])) s += 1;
    if (scale === 'major') s += 0.1;
    if (prefer && parsePc(prefer.root) === r && (prefer.scale === 'minor') === (scale === 'minor')) s += 0.75;
    if (!best || s > best.s + 1e-9) best = { s, root: r, scale };
  }
  const key = { root: '', scale: best.scale };
  key.root = nameIn(best.root, key);
  return key;
}
const capoOf = (sheet) => (isObj(sheet) && Number.isInteger(sheet.capo) ? sheet.capo : 0);
const moveKey = (key, semis) => {
  if (!key) return null;
  const k = { root: '', scale: key.scale };
  k.root = nameIn(parsePc(key.root) + semis, k);
  return k;
};
const letterChords = (sheet) => {
  const out = [];
  for (const s of isObj(sheet) && Array.isArray(sheet.sections) ? sheet.sections : []) for (const l of s.lines || []) for (const c of chordsOf(l.text)) if (/^[A-G]/.test(c.sym)) { const ch = readChord(c.sym); if (ch) out.push(ch); }
  return out;
};
export function shapesKey(sheet, p = null) {
  const capo = capoOf(sheet);
  const song = p && p.key && p.key.root ? { root: p.key.root, scale: /minor|dorian|phrygian|blues/i.test(p.key.scale) ? 'minor' : 'major' } : null;
  const fromSong = song ? moveKey(song, -capo) : null;
  // (a pasted paper may name the key of its shapes: ChordPro's {key})
  const named = isObj(sheet) && isObj(sheet.key) && Number.isFinite(parsePc(sheet.key.root)) ? { root: sheet.key.root, scale: sheet.key.scale === 'minor' ? 'minor' : 'major' } : null;
  const letters = letterChords(sheet);
  if (letters.length) return keyOfChords(letters, named || fromSong);
  return named || fromSong || { root: 'C', scale: 'major' };
}
export function soundingKey(sheet, p) {
  const letters = letterChords(sheet);
  if (!letters.length) return (p && p.key) || null;
  return moveKey(shapesKey(sheet, p), capoOf(sheet));
}
export const keyName = (key) => (key ? `${String(key.root).replace('b', '♭').replace('#', '♯')} ${key.scale === 'minor' ? 'minor' : key.scale === 'major' ? 'major' : key.scale}` : '');

// every section's chords in order: as written, and as they sound (the shapes plus the capo)
export function sheetChords(sheet, p = null) {
  const key = shapesKey(sheet, p), capo = capoOf(sheet), sound = moveKey(key, capo), out = [];
  for (const s of isObj(sheet) && Array.isArray(sheet.sections) ? sheet.sections : []) {
    const chords = [];
    for (const l of s.lines || []) {
      for (const c of chordsOf(l.text)) {
        const ch = readChord(c.sym, key);
        const as = ch ? transposeChord(/^[A-G]/.test(c.sym) ? c.sym : ch.name, capo, sound) : null;
        const heard = as ? readChord(as, null) : null;
        const sounding = heard ? { ...heard, name: as } : null;
        chords.push({ sym: c.sym, chord: sounding, line: l.id ?? null, ...(c.bar != null ? { bar: c.bar } : {}) });
      }
    }
    out.push({ section: s.id ?? s.name, name: s.name, chords });
  }
  return out;
}

// the six common chords of the shapes' key (I ii iii IV V vi; in minor i III iv v VI VII), then the paper's own
export function chordRow(sheet, p = null) {
  const key = shapesKey(sheet, p), r = parsePc(key.root);
  const degs = key.scale === 'minor' ? [[0, 'm'], [3, ''], [5, 'm'], [7, 'm'], [8, ''], [10, '']] : [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm']];
  const row = degs.map(([d, q]) => nameIn(r + d, key) + q);
  for (const s of isObj(sheet) && Array.isArray(sheet.sections) ? sheet.sections : []) for (const l of s.lines || []) for (const c of chordsOf(l.text)) if (!row.includes(c.sym)) row.push(c.sym);
  return row.slice(0, 16);
}

// The open shapes a guitarist plays a key in (G, C, D, A, E; Em, Am, Dm), and the capo that gets there from the
// sounding key: "G shapes, capo 3" for Bb. No capo first when the key is open already.
const OPEN = { major: ['G', 'C', 'D', 'A', 'E'], minor: ['E', 'A', 'D'] };
export function capoChoices(key) {
  if (!key) return [];
  const r = parsePc(key.root), minor = /minor/i.test(key.scale), out = [];
  for (const shape of OPEN[minor ? 'minor' : 'major']) {
    const capo = (r - parsePc(shape) + 12) % 12;
    if (capo <= 7) out.push({ capo, shapes: shape + (minor ? 'm' : '') });
  }
  return out.sort((a, b) => a.capo - b.capo).slice(0, 3);
}

/* ------------------------------------------------------------------------------------------------ parsing */
const SECTION_WORD = /^(verse|chorus|pre[- ]?chorus|prechorus|bridge|intro|outro|interlude|instrumental|solo|tag|coda|refrain|hook|break|breakdown|ending|middle ?8|post[- ]?chorus|vamp|riff|turnaround)\b/i;
const looksLikeSection = (name) => SECTION_WORD.test(name.trim()) && name.trim().length <= 40;
const tidyName = (name) => {
  const n = name.trim().replace(/\s+/g, ' ').replace(/:$/, '');
  // VERSE 1 -> Verse 1, pre-chorus -> Pre-chorus
  return n === n.toUpperCase() || n === n.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : n;
};
const CHORDISH = /^[A-H][#b♯♭]?(m|maj|min|sus|add|dim|aug|M|[0-9]|[#b+°ø()-])*(\/[A-H][#b♯♭]?)?$/;
// tokens a plain-text chord line may hold besides chords
const FILLER = /^(\||\|\||%|-|\/|\.|\*|x\d+|\(x?\d+x?\)|\d+x|n\.?c\.?|\(|\))$/i;
function chordLineTokens(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  let chords = 0, nums = 0, odd = 0;
  for (const t of toks) {
    if (FILLER.test(t)) continue;
    if (isLetterChord(t)) { chords++; continue; }
    if (isNashville(t)) { nums++; continue; }
    // a chord written the way nobody here reads (H7, Bbm7b13): kept on the paper as written, and marked there
    if (CHORDISH.test(t)) { odd++; continue; }
    return null;
  }
  if (odd && chords < odd) return null;
  // a line of numbers alone is a Nashville chart only with two or more of them
  if (!chords && nums < 2) return null;
  return toks;
}
const expandTabs = (s) => { let out = ''; for (const ch of s) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch; return out; };
// the chords of a chord line at their columns
function chordColumns(line) {
  const out = [];
  const re = /\S+/g;
  for (let m; (m = re.exec(line)); ) if (!FILLER.test(m[0])) out.push({ sym: m[0], col: m.index });
  return out;
}
// a chord line laid over the words under it, each chord before the character under its first letter
function overWords(chordLine, words) {
  const cols = chordColumns(chordLine);
  let w = words.replace(/\s+$/, '');
  const need = cols.length ? cols[cols.length - 1].col : 0;
  if (w.length < need) w = w.padEnd(need, ' ');
  let out = '', i = 0;
  for (const c of cols) {
    // (a chord typed a column or two early, over the space before a word, goes on that word)
    let at = c.col;
    for (let k = 0; k < 2 && at < w.length && /\s/.test(w[at]) && w[at + 1] != null; k++) at++;
    if (/\s/.test(w[at] || '')) at = c.col;
    at = Math.max(at, i);
    out += w.slice(i, at) + `[${c.sym}]`;
    i = at;
  }
  return (out + w.slice(i)).replace(/\s+$/, '');
}
// a chord line with no words under it, as bars: its own bar lines, else one chord a bar
function asBars(toks) {
  if (toks.includes('|') || toks.includes('||')) {
    const s = toks.join(' ').replace(/\|\|/g, '|').replace(/\s+/g, ' ').trim();
    return (s.startsWith('|') ? s : '| ' + s).replace(/\s*\|?\s*$/, ' |');
  }
  const syms = toks.filter((t) => !FILLER.test(t) || t === '%');
  const reps = toks.find((t) => /^(x\d+|\(x?\d+x?\)|\d+x)$/i.test(t));
  return `| ${syms.join(' | ')} |${reps ? ` ${reps}` : ''}`;
}
// a line longer than a line can be, split at a space (a chord stays with the words after it)
function fitLine(text) {
  const max = ROOM_LIMITS.lineChars, out = [];
  let s = text;
  while (s.length > max) {
    let at = s.lastIndexOf(' ', max);
    if (at < max / 2) at = max;
    // (never inside a [chord])
    const open = s.lastIndexOf('[', at), close = s.lastIndexOf(']', at);
    if (open > close) at = open;
    out.push(s.slice(0, at).replace(/\s+$/, ''));
    s = s.slice(at).replace(/^\s+/, '');
  }
  out.push(s);
  return out.filter((x) => x.length);
}
const DIRECTIVE = /^\s*\{\s*([a-z_]+)\s*(?:[:\s]\s*(.*?))?\s*\}\s*$/i;
const ENV = { start_of_verse: 'Verse', sov: 'Verse', start_of_chorus: 'Chorus', soc: 'Chorus', start_of_bridge: 'Bridge', sob: 'Bridge', start_of_grid: 'Grid', sog: 'Grid', start_of_tab: 'Tab', sot: 'Tab' };
const END = /^(end_of_\w+|eo[vcbgt])$/i;
const label = (v) => { const m = /label\s*=\s*"([^"]*)"/i.exec(v || ''); return (m ? m[1] : v || '').trim(); };
function keyOfText(v) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(m|min|minor|maj|major)?\s*$/.exec(String(v || ''));
  if (!m) return null;
  const minor = !!m[3] && /^m(in(or)?)?$/i.test(m[3]);
  return { root: m[1].toUpperCase() + acc(m[2]), scale: minor ? 'minor' : 'major' };
}
const meterOf = (v) => { const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(String(v || '')); return m && [1, 2, 4, 8, 16].includes(+m[2]) ? [+m[1], +m[2]] : null; };
const capoNum = (v) => { if (/^\s*(no|none|0)\b/i.test(String(v))) return 0; const m = /(\d{1,2})/.exec(String(v || '')); return m && +m[1] <= 11 ? +m[1] : null; };

export function parseSheet(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = src.split('\n').map(expandTabs);
  const chordpro = lines.some((l) => DIRECTIVE.test(l)) || lines.some((l) => /\S\[[^\]\s]{1,12}\]|\[[^\]\s]{1,12}\]\S/.test(l) && chordsOf(l).some((c) => readChord(c.sym)));
  const out = { v: 1, sections: [] };
  const notes = [];
  let sec = null, envName = null, inTab = false;
  const open = (name) => { sec = { name: tidyName(name) || 'Verse', lines: [] }; out.sections.push(sec); };
  const add = (t) => { if (!sec) open(out.sections.length ? 'Verse' : 'Verse'); for (const x of fitLine(t)) sec.lines.push({ text: x }); };
  // (a plain-text title is the first line when what follows it is the song's header or a section)
  let i = 0;
  if (!chordpro) {
    const first = lines.findIndex((l) => l.trim());
    if (first >= 0) {
      const t = lines[first].trim(), next = lines.slice(first + 1).find((l) => l.trim()) || '';
      const isHead = (l) => /^\s*\[[^\]]+\]\s*$/.test(l) || looksLikeSection(l.replace(/[:[\]()]/g, '')) || /^\s*(capo|key|tempo|bpm|time)\b/i.test(l) || !!chordLineTokens(l);
      const rest = lines.slice(first + 1).filter((l) => l.trim());
      const plainLine = (l) => l.trim().length <= 80 && !chordLineTokens(l) && !isHead(l) && !/\[/.test(l);
      if (plainLine(t) && isHead(next)) { out.title = t.replace(/\s+(chords|tabs?|lyrics)(\s+by\s+.*)?$/i, '').trim(); i = first + 1; }
      // (a title, then the artist, then the header or a section)
      else if (plainLine(t) && plainLine(next) && rest[1] && isHead(rest[1])) {
        out.title = t.trim();
        out.artist = next.trim().replace(/^by\s+/i, '');
        i = lines.indexOf(rest[0], first + 1) + 1;
      }
    }
  }
  for (; i < lines.length; i++) {
    const raw = lines[i], line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    // ChordPro: directives and environments
    const d = DIRECTIVE.exec(line);
    if (d) {
      const k = d[1].toLowerCase(), v = (d[2] || '').trim();
      if (k === 'title' || k === 't') out.title = v;
      else if (k === 'artist' || k === 'subtitle' || k === 'st') { if (!out.artist) out.artist = v; }
      else if (k === 'key') { const kk = keyOfText(v); if (kk) out.key = kk; }
      else if (k === 'capo') { const c = capoNum(v); if (c != null) out.capo = c; }
      else if (k === 'time') { const m = meterOf(v); if (m) out.time = m; }
      else if (k === 'tempo') { const n = Number(v); if (n >= 20 && n <= 400) out.tempo = n; }
      else if (ENV[k]) { inTab = ENV[k] === 'Tab'; if (!inTab) { envName = label(v) || ENV[k]; open(envName === 'Grid' ? 'Verse' : envName); } }
      else if (END.test(k)) { inTab = false; envName = null; sec = null; }
      else if (k === 'comment' || k === 'c' || k === 'ci' || k === 'cb' || k === 'comment_italic' || k === 'comment_box') { if (looksLikeSection(v)) open(v); else if (v) notes.push(v); }
      // ({chorus} recalls the chorus: it's on the paper once already; anything else is for another reader)
      continue;
    }
    if (inTab) continue;
    if (chordpro && /^\s*#/.test(line)) { notes.push(line.replace(/^\s*#\s?/, '')); continue; }
    // a heading: [Verse 1], Chorus:, (Bridge), VERSE
    const br = /^\s*[[(]([^\])]{1,40})[\])]\s*:?\s*$/.exec(line);
    if (br && !readChord(br[1].trim())) { open(br[1]); continue; }
    const colon = /^\s*([A-Za-z][A-Za-z0-9 '-]{0,30}?)\s*:\s*(.*)$/.exec(line);
    if (colon && looksLikeSection(colon[1])) {
      open(colon[1]);
      const rest = colon[2].trim();
      if (rest) { const toks = chordLineTokens(rest); if (toks) add(asBars(toks)); else add(rest); }
      continue;
    }
    if (looksLikeSection(line) && !chordLineTokens(line) && line.trim().split(/\s+/).length <= 3 && /^[A-Za-z][A-Za-z0-9 -]*$/.test(line.trim())) { open(line); continue; }
    // the header, in words
    const cap = /^\s*capo\s*(?::|on|at)?\s*(.*)$/i.exec(line);
    if (cap && capoNum(cap[1]) != null && line.trim().length <= 30) { out.capo = capoNum(cap[1]); continue; }
    const key = /^\s*key\s*:?\s*(.+)$/i.exec(line);
    if (key && keyOfText(key[1]) && line.trim().length <= 20) { out.key = keyOfText(key[1]); continue; }
    const tempo = /^\s*(?:tempo|bpm)\s*:?\s*(\d{2,3})\s*(?:bpm)?\s*$/i.exec(line);
    if (tempo) { out.tempo = +tempo[1]; continue; }
    const time = /^\s*(?:time|meter|time signature)\s*:?\s*(\d{1,2}\s*\/\s*\d{1,2})\s*$/i.exec(line);
    if (time && meterOf(time[1])) { out.time = meterOf(time[1]); continue; }
    // ChordPro's inline chords, or a bar line, as written
    if (/\[[^\]]*\]/.test(line) || isBars(line)) { add(line.trim()); continue; }
    // chords over words
    const toks = chordLineTokens(line);
    if (toks) {
      const next = lines[i + 1] != null ? lines[i + 1].replace(/\s+$/, '') : '';
      const nextIsWords = next.trim() && !DIRECTIVE.test(next) && !chordLineTokens(next) && !/\[[^\]]*\]/.test(next) && !isBars(next) && !/^\s*[[(][^\])]+[\])]\s*:?\s*$/.test(next) && !(/^\s*([A-Za-z][A-Za-z0-9 '-]{0,30}?)\s*:/.test(next) && looksLikeSection(next.split(':')[0]));
      if (nextIsWords) { add(overWords(line, next)); i++; } else add(asBars(toks));
      continue;
    }
    add(line.trim());
  }
  // each section once: a repeat of one on the paper already (the same words and chords, or an empty heading of a
  // name it has) isn't written again; two different sections of one name are numbered
  const kept = [];
  for (const s of out.sections) {
    const same = kept.find((k) => k.name.replace(/\s+\d+$/, '').toLowerCase() === s.name.replace(/\s+\d+$/, '').toLowerCase());
    const body = s.lines.map((l) => l.text).join('\n');
    if (same && (!s.lines.length || kept.some((k) => k.lines.map((l) => l.text).join('\n') === body && k.name.replace(/\s+\d+$/, '').toLowerCase() === s.name.replace(/\s+\d+$/, '').toLowerCase()))) continue;
    if (!s.lines.length && kept.some((k) => k.name.toLowerCase() === s.name.toLowerCase())) continue;
    if (same && !/\d+$/.test(s.name)) {
      const base = s.name;
      const n = kept.filter((k) => k.name.replace(/\s+\d+$/, '').toLowerCase() === base.toLowerCase()).length;
      if (n === 1 && !/\d+$/.test(same.name)) same.name = `${same.name} 1`;
      s.name = `${base} ${n + 1}`;
    }
    kept.push(s);
  }
  out.sections = kept.filter((s) => s.lines.length || kept.length === 1);
  if (notes.length) out.notes = notes.join('\n').slice(0, ROOM_LIMITS.notesChars);
  return out;
}

/* ------------------------------------------------------------------------------------------------ writing */
const envOf = (name) => (/^chorus/i.test(name) ? 'chorus' : /^bridge/i.test(name) ? 'bridge' : 'verse');
function chordsOver(text) {
  if (isBars(text)) return [String(text)];
  const parts = lineParts(text);
  if (parts.every((x) => x.chord == null)) return [lineWords(text)];
  let top = '', words = '';
  for (const x of parts) {
    if (x.chord != null) {
      // the chord over the start of its words; a chord after a chord with no words between gets a space of its own
      if (top.length > words.length) words = words.padEnd(top.length, ' ');
      top = top.padEnd(words.length, ' ') + x.chord;
    }
    words += x.text;
  }
  const w = words.replace(/\s+$/, '');
  return w.trim() ? [top.replace(/\s+$/, ''), w] : [top.replace(/\s+$/, '')];
}
export function formatSheet(sheet, { as = 'text', title = null, artist = null, key = null, tempo = null } = {}) {
  const s = isObj(sheet) ? sheet : { sections: [] };
  const out = [];
  const meter = Array.isArray(s.time) ? `${s.time[0]}/${s.time[1]}` : null;
  if (as === 'chordpro') {
    if (title) out.push(`{title: ${title}}`);
    if (artist) out.push(`{artist: ${artist}}`);
    if (key) out.push(`{key: ${key.root}${key.scale === 'minor' ? 'm' : ''}}`);
    if (s.capo) out.push(`{capo: ${s.capo}}`);
    if (meter) out.push(`{time: ${meter}}`);
    if (tempo) out.push(`{tempo: ${Math.round(tempo)}}`);
    if (typeof s.notes === 'string' && s.notes) for (const n of s.notes.split('\n')) out.push(`# ${n}`);
    for (const sec of s.sections || []) {
      if (out.length) out.push('');
      const env = envOf(sec.name);
      out.push(`{start_of_${env}: ${sec.name}}`);
      for (const l of sec.lines || []) out.push(l.text);
      out.push(`{end_of_${env}}`);
    }
    return out.join('\n') + '\n';
  }
  if (title) out.push(title);
  if (artist) out.push(artist);
  if (title || artist) out.push('');
  if (key) out.push(`Key: ${key.root}${key.scale === 'minor' ? 'm' : ''}`);
  if (s.capo) out.push(`Capo ${s.capo}`);
  if (meter) out.push(`Time: ${meter}`);
  if (tempo) out.push(`Tempo: ${Math.round(tempo)}`);
  for (const sec of s.sections || []) {
    if (out.length) out.push('');
    out.push(`[${sec.name}]`);
    for (const l of sec.lines || []) out.push(...chordsOver(l.text));
  }
  return out.join('\n') + '\n';
}

/* ------------------------------------------------------------------------------------------------ into the song */
// pasteOps(p, parsed, { replace }): the sheet.* ops that put a parsed paper in the song (replace: the paper's sections
// out first), the title when the song has none, and the song's key (the sounding one) when the paper names its chords.
// cut: what didn't fit the sheet's caps.
export function pasteOps(p, parsed, { replace = true } = {}) {
  const ops = [], cut = { sections: 0, lines: 0 };
  const have = isObj(p?.sheet) && Array.isArray(p.sheet.sections) ? p.sheet.sections : [];
  if (replace) for (const s of have) ops.push({ type: 'sheet.section.remove', section: s.id });
  const patch = {};
  if (Number.isInteger(parsed.capo)) patch.capo = parsed.capo;
  if (Array.isArray(parsed.time)) patch.time = parsed.time;
  if (typeof parsed.notes === 'string' && parsed.notes) patch.notes = parsed.notes;
  if (Object.keys(patch).length || !isObj(p?.sheet)) ops.push({ type: 'sheet.set', patch: Object.keys(patch).length ? patch : { capo: 0 } });
  let sections = replace ? 0 : have.length, lines = replace ? 0 : have.reduce((a, s) => a + (s.lines?.length || 0), 0);
  let chars = replace ? 0 : have.reduce((a, s) => a + String(s.name).length + (s.lines || []).reduce((b, l) => b + String(l.text).length, 0), 0) + (typeof p?.sheet?.notes === 'string' ? p.sheet.notes.length : 0);
  if (patch.notes) chars += patch.notes.length;
  for (const s of parsed.sections || []) {
    if (sections >= ROOM_LIMITS.sheetSections) { cut.sections++; cut.lines += s.lines.length; continue; }
    const name = String(s.name).slice(0, ROOM_LIMITS.nameChars);
    const ls = [];
    for (const l of s.lines) {
      if (lines >= ROOM_LIMITS.sheetLines || chars + name.length + l.text.length > ROOM_LIMITS.sheetChars) { cut.lines++; continue; }
      ls.push({ text: l.text });
      lines++;
      chars += l.text.length;
    }
    chars += name.length;
    sections++;
    ops.push({ type: 'sheet.section.add', section: { name, lines: ls } });
  }
  const song = {};
  if (parsed.title && !(p?.title && p.title !== 'Untitled')) song.title = String(parsed.title).slice(0, 200);
  const k = parsed.key ? moveKey(parsed.key, parsed.capo || 0) : soundingKey({ ...parsed, sections: parsed.sections }, p);
  if (k && (!p?.key || p.key.root !== k.root || p.key.scale !== k.scale)) song.key = k;
  if (Object.keys(song).length) ops.push({ type: 'project.set', patch: song });
  return { ops, cut };
}

// a new verse: the last verse's chords, the words left empty for typing under them
export function newVerse(sheet) {
  const secs = isObj(sheet) && Array.isArray(sheet.sections) ? sheet.sections : [];
  const verses = secs.filter((s) => /^verse/i.test(s.name));
  const last = verses[verses.length - 1];
  const n = verses.length + 1;
  const name = verses.length ? `Verse ${n}` : 'Verse';
  if (!last) return { name, lines: [{ text: '' }] };
  const lines = (last.lines || []).map((l) => (isBars(l.text) ? { text: l.text } : { text: chordsOf(l.text).map((c) => `[${c.sym}]`).join('   ') }));
  return { name, lines: lines.length ? lines : [{ text: '' }] };
}

export function describeSheet(sheet) {
  const secs = isObj(sheet) && Array.isArray(sheet.sections) ? sheet.sections : [];
  const chords = [];
  let lines = 0;
  for (const s of secs) for (const l of s.lines || []) { lines++; for (const c of chordsOf(l.text)) if (!chords.includes(c.sym)) chords.push(c.sym); }
  return { sections: secs.length, lines, chords };
}
