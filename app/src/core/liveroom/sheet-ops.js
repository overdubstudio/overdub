// @ts-check
// The sheet's ops [core] (docs/research/LIVE-ROOM-MODE.md §9.2): the kitchen table's paper, its words and chords,
// registered in core/ops.js OPS from SHEET_OPS. Each is (p, op, ctx) -> { inverse: [ops], created? }, as every op is,
// and keeps the sheet canonical (core/liveroom/model.js ORDER), so an inverse puts back exactly what was there.
//
//   sheet.set             { patch: { capo? (0-11), time? ([n, d]), notes? (2,000 characters) } }  null deletes a key
//                         (capo 0 and '' too); makes the sheet ({ v: 1, sections: [] }) when the song has none.
//                         { clear: true } takes the whole sheet out.   -> inverse: the old values, or { clear: true }
//   sheet.section.add     { section: { id?, name, lines?: [{ id?, text }] }, index?, ref? }  an id made when it has
//                         none; its lines signed by the op's author. created: { [ref || 'sheetSection']: id }
//                                                                     -> inverse: sheet.section.remove
//   sheet.section.set     { section, patch: { name } }                 -> inverse: the old name
//   sheet.section.remove  { section }                                  -> inverse: sheet.section.add, the whole section
//                                                                        cloned (its ids and authors kept) at its index
//   sheet.line.add        { section, line: { id?, text }, index?, ref? }  signed by the op's author. created:
//                         { [ref || 'sheetLine']: id }                 -> inverse: sheet.line.remove
//   sheet.line.set        { section, line, patch: { text } }  the text, signed by the op's author
//                                                                     -> inverse: the old text and its old author
//   sheet.line.remove     { section, line }                            -> inverse: sheet.line.add, the line as it was
//                                                                        (its author kept) at its index
// A section is found by id, $ref or name; a line by id or $ref. A line is plain text (control and bidi characters
// dropped), 200 characters at most: chords are its [bracketed] tokens (core/liveroom/sheet.js reads them). Names are
// cleaned as names, 100 characters. Undo, redo and reverts (ctx.restore) put back what was there as it was, authors
// included; agents can't send an author (agent/tools.js strips `by` and `_` fields). The caps on the whole sheet
// (sections, lines, characters: model.js ROOM_LIMITS) are held by the store's size check (core/project.js sizeError).
// Internal forms, for inverses only: sheet.set { _restore, _at }; sheet.line.set { ..., _by }.

import { newId, cleanName, plainText } from '../project.js';
import { validMeter } from '../music.js';
import { ROOM_LIMITS, ORDER, putKey, placeKey } from './model.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const isSheetId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) && !UNSAFE.has(v);
// (the notes keep their line breaks; everything else unseen goes, as plainText drops it)
const plainLines = (s) => String(s).replace(/\r\n?/g, '\n').split('\n').map(plainText).join('\n');
const SET_KEYS = ['capo', 'time', 'notes'];

function resolve(ctx, id) {
  if (typeof id === 'string' && id.startsWith('$')) {
    const r = ctx.refs && ctx.refs[id.slice(1)];
    if (!r) throw new Error(`unknown reference ${id} (refs are made by ref: "name" on an earlier op in the same call)`);
    return r;
  }
  return id;
}
const sheetOf = (p) => (isObj(p.sheet) && Array.isArray(p.sheet.sections) ? p.sheet : null);
function findSection(p, ctx, ref) {
  const id = resolve(ctx, isObj(ref) ? ref.id : ref);
  const secs = sheetOf(p)?.sections || [];
  const s = secs.find((x) => x.id === id) || secs.find((x) => String(x.name).toLowerCase() === String(id).toLowerCase());
  if (!s) throw new Error(`no section "${id}" on the sheet (the sheet's: ${secs.map((x) => `${x.id} "${x.name}"`).join(', ') || 'none'})`);
  return s;
}
function findLine(p, ctx, sref, lref) {
  const sec = findSection(p, ctx, sref);
  const id = resolve(ctx, isObj(lref) ? lref.id : lref);
  const i = sec.lines.findIndex((l) => l.id === id);
  if (i < 0) throw new Error(`no line "${id}" in ${sec.name} (its lines: ${sec.lines.map((l) => l.id).join(', ') || 'none'})`);
  return { sec, line: sec.lines[i], i };
}
// every id the sheet uses (its sections' and its lines')
function usedIds(p) {
  const out = new Set();
  for (const s of sheetOf(p)?.sections || []) { out.add(s.id); for (const l of s.lines || []) out.add(l.id); }
  return out;
}
function takeId(want, used, prefix) {
  if (want != null) {
    if (!isSheetId(want)) throw new Error(`a sheet id is letters, digits, _ and - (64 at most): not ${JSON.stringify(String(want)).slice(0, 70)}`);
    if (used.has(want)) throw new Error(`id ${want} is used on the sheet already`);
    used.add(want);
    return want;
  }
  for (;;) { const id = newId(prefix); if (!used.has(id)) { used.add(id); return id; } }
}
// A line's text: plain, 200 characters at most (a restore puts back what was there).
function lineText(v, ctx) {
  if (ctx.restore) return typeof v === 'string' ? v : '';
  if (typeof v !== 'string') throw new Error('a line\'s text is text: words with [chords] in brackets, like "Somewhere a [G]paper [Em]moon"');
  const t = plainText(v);
  if (t.length > ROOM_LIMITS.lineChars) throw new Error(`a line is ${ROOM_LIMITS.lineChars} characters at most (this one is ${t.length}): split it in two`);
  return t;
}
function makeLine(l, used, ctx) {
  if (!isObj(l)) throw new Error('a line is { text } (and an id, if it has one)');
  const line = { id: takeId(l.id, used, 'sl'), text: lineText(l.text, ctx), by: ctx.restore && typeof l.by === 'string' && l.by ? l.by : ctx.by || 'you' };
  if (ctx.restore) for (const [k, v] of Object.entries(l)) if (!ORDER.line.includes(k) && !UNSAFE.has(k)) line[k] = clone(v);
  return line;
}
function indexArg(v, n) {
  if (v == null) return n;
  if (!(Number.isInteger(v) && v >= 0 && v <= n)) throw new Error(`index is a whole number from 0 to ${n}`);
  return v;
}
// sheet.set { clear } and its inverse, { _restore, _at }: the whole sheet out, and back where it was among the song's keys
function wholeSheet(p, op) {
  if (op._restore !== undefined) {
    if (isObj(p.sheet)) throw new Error('the song has a sheet already');
    placeKey(p, 'sheet', clone(op._restore), op._at);
    return { inverse: [{ type: 'sheet.set', clear: true }] };
  }
  if (!isObj(p.sheet)) throw new Error('the song has no sheet to clear');
  const at = Object.keys(p).indexOf('sheet'), old = p.sheet;
  delete p.sheet;
  return { inverse: [{ type: 'sheet.set', _restore: old, _at: at }] };
}

export const SHEET_OPS = {
  'sheet.set'(p, op, ctx) {
    if (op._restore !== undefined || op.clear === true) return wholeSheet(p, op);
    const patch = op.patch;
    if (!isObj(patch) || !Object.keys(patch).length) throw new Error('sheet.set takes patch: { capo, time, notes } (any of them; null deletes one), or clear: true');
    const next = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!SET_KEYS.includes(k)) throw new Error(`sheet.set can't change "${k}" (capo, time, notes; or clear: true)`);
      if (v === null || ctx.restore) { next.push([k, v === null ? null : clone(v)]); continue; }
      if (k === 'capo') { if (!(Number.isInteger(v) && v >= 0 && v <= 11)) throw new Error('capo is the fret the capo sits at, 0 (none) to 11'); next.push([k, v || null]); }
      if (k === 'time') { if (!validMeter(v)) throw new Error('time is a meter, [beats, unit]: [4, 4], [3, 4], [6, 8]'); next.push([k, [v[0], v[1]]]); }
      if (k === 'notes') {
        if (typeof v !== 'string') throw new Error('notes is text');
        const t = plainLines(v);
        if (t.length > ROOM_LIMITS.notesChars) throw new Error(`the sheet's notes are ${ROOM_LIMITS.notesChars.toLocaleString('en-US')} characters at most (these are ${t.length.toLocaleString('en-US')})`);
        next.push([k, t || null]);
      }
    }
    const made = !isObj(p.sheet);
    if (made) p.sheet = { v: 1, sections: [] };
    const sheet = p.sheet, inv = {};
    for (const [k, v] of next) {
      inv[k] = Object.hasOwn(sheet, k) ? sheet[k] : null;
      if (v === null) delete sheet[k]; else putKey(sheet, k, v, ORDER.sheet);
    }
    return { inverse: [made ? { type: 'sheet.set', clear: true } : { type: 'sheet.set', patch: inv }] };
  },

  'sheet.section.add'(p, op, ctx) {
    const s = op.section;
    if (!isObj(s)) throw new Error('sheet.section.add takes section: { name, lines?: [{ text }] } (and index?)');
    const used = usedIds(p);
    const sec = { id: takeId(s.id, used, 'ss'), name: ctx.restore && typeof s.name === 'string' ? s.name : cleanName(s.name, 'Section', ROOM_LIMITS.nameChars), lines: [] };
    if (s.lines != null && !Array.isArray(s.lines)) throw new Error('lines is a list: [{ text: "..." }, ...]');
    for (const l of s.lines || []) sec.lines.push(makeLine(l, used, ctx));
    if (ctx.restore) for (const [k, v] of Object.entries(s)) if (!ORDER.section.includes(k) && !UNSAFE.has(k)) sec[k] = clone(v);
    const made = !sheetOf(p);
    if (made && isObj(p.sheet)) throw new Error('the song\'s sheet has no sections list');
    const i = indexArg(op.index, made ? 0 : p.sheet.sections.length);
    if (made) p.sheet = { v: 1, sections: [] };
    p.sheet.sections.splice(i, 0, sec);
    if (op.ref) ctx.refs[op.ref] = sec.id;
    return { inverse: [made ? { type: 'sheet.set', clear: true } : { type: 'sheet.section.remove', section: sec.id }], created: { [op.ref || 'sheetSection']: sec.id } };
  },

  'sheet.section.set'(p, op, ctx) {
    const sec = findSection(p, ctx, op.section);
    const patch = op.patch;
    if (!isObj(patch) || !Object.keys(patch).length) throw new Error('sheet.section.set takes patch: { name }');
    for (const k of Object.keys(patch)) if (k !== 'name') throw new Error(`sheet.section.set can't change "${k}" (name)`);
    const v = patch.name;
    if (!ctx.restore && !(typeof v === 'string' && plainText(v).length <= ROOM_LIMITS.nameChars)) throw new Error(`name must be text, ${ROOM_LIMITS.nameChars} characters at most`);
    const old = sec.name;
    sec.name = ctx.restore ? String(v) : plainText(v) || 'Section';
    return { inverse: [{ type: 'sheet.section.set', section: sec.id, patch: { name: old } }] };
  },

  'sheet.section.remove'(p, op, ctx) {
    const sec = findSection(p, ctx, op.section);
    const i = p.sheet.sections.indexOf(sec);
    p.sheet.sections.splice(i, 1);
    return { inverse: [{ type: 'sheet.section.add', section: sec, index: i }] };
  },

  'sheet.line.add'(p, op, ctx) {
    const sec = findSection(p, ctx, op.section);
    const line = makeLine(op.line, usedIds(p), ctx);
    const i = indexArg(op.index, sec.lines.length);
    sec.lines.splice(i, 0, line);
    if (op.ref) ctx.refs[op.ref] = line.id;
    return { inverse: [{ type: 'sheet.line.remove', section: sec.id, line: line.id }], created: { [op.ref || 'sheetLine']: line.id } };
  },

  'sheet.line.set'(p, op, ctx) {
    const { sec, line } = findLine(p, ctx, op.section, op.line);
    const patch = op.patch;
    if (!isObj(patch) || !Object.keys(patch).length) throw new Error('sheet.line.set takes patch: { text }');
    for (const k of Object.keys(patch)) if (k !== 'text') throw new Error(`sheet.line.set can't change "${k}" (text)`);
    const text = lineText(patch.text, ctx);
    const inv = { type: 'sheet.line.set', section: sec.id, line: line.id, patch: { text: line.text }, _by: line.by };
    line.text = text;
    // (the editor signs it; a restore puts back whoever it was)
    line.by = ctx.restore && typeof op._by === 'string' && op._by ? op._by : ctx.by || 'you';
    return { inverse: [inv] };
  },

  'sheet.line.remove'(p, op, ctx) {
    const { sec, line, i } = findLine(p, ctx, op.section, op.line);
    sec.lines.splice(i, 1);
    return { inverse: [{ type: 'sheet.line.add', section: sec.id, line, index: i }] };
  },
};
