// Test helpers: a tiny unzip (stored entries, as zipStore writes) and a tiny XML reader (elements, attributes, text).
// Not a test file (the glob is *.test.js); tools/provenance-test.js reads the downloaded DAWproject with the same.
export function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no end of central directory');
  const count = dv.getUint16(e + 10, true),
    cdOff = dv.getUint32(e + 16, true);
  const out = new Map();
  let o = cdOff;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('bad central header at ' + o);
    const method = dv.getUint16(o + 10, true),
      size = dv.getUint32(o + 20, true);
    const nlen = dv.getUint16(o + 28, true),
      xlen = dv.getUint16(o + 30, true),
      clen = dv.getUint16(o + 32, true),
      lho = dv.getUint32(o + 42, true);
    const name = new TextDecoder().decode(u8.subarray(o + 46, o + 46 + nlen));
    if (method !== 0) throw new Error('compressed entry ' + name);
    if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    out.set(name, u8.subarray(start, start + size));
    o += 46 + nlen + xlen + clen;
  }
  return out;
}

/* ------------------------------------------------------------------ tiny XML reader (elements, attributes, text) */
const unesc = (s) =>
  s.replace(
    /&(lt|gt|quot|apos|amp|#\d+);/g,
    (m, x) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[x] ?? String.fromCharCode(+x.slice(1)),
  );
export function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re =
    /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m,
    pos = 0;
  while ((m = re.exec(src))) {
    if (m.index !== pos) throw new Error(`unparsed text at ${pos}: ${src.slice(pos, pos + 40)}`);
    pos = re.lastIndex;
    if (m[0].startsWith('<?') || m[0].startsWith('<!--')) continue;
    if (m[5] != null) {
      stack[stack.length - 1].text += unesc(m[5]);
      continue;
    }
    if (m[1]) {
      const top = stack.pop();
      if (top.name !== m[2]) throw new Error(`</${m[2]}> closes <${top.name}>`);
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = unesc(a[2]);
    const el = { name: m[2], attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(el);
    if (!m[4]) stack.push(el);
  }
  if (pos !== src.length) throw new Error('trailing junk');
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].name}>`);
  return root.children[0];
}
export const kids = (el, name) => (el?.children || []).filter((c) => c.name === name);
export const kid = (el, name) => kids(el, name)[0] || null;
export function all(el, name, out = []) {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
}
