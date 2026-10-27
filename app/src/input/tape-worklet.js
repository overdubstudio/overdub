// The rolling tape's processor, 'ew-tape' (input/tape.js loads it into the input's audio context; docs/research/
// GUITAR-ROOM.md §4.3): the picked input, always, into a ring of 16-bit samples as long as the tape (a minute by
// default, up to five). Sample i of the ring is the audio-clock frame f with f % N === i, so the ring is its own
// clock: nothing is copied, posted or allocated as it rolls. A quantum the processor wasn't run for (the input
// unplugged, a stall) is written as silence, so the tape never holds stale audio at a frame it didn't hear.
// Every BIN frames the loudest sample in them is a peak bin; every POST bins the new ones go to the page for the
// waveform ({ t: 'pk', b (the first bin's index: frame b * BIN), pk: Float32Array (0..1), head (the next frame), start
// (the first frame it wrote) }),
// the one allocation, a few times a second. The page asks for:
//   { t: 'get', id, from, to } -> { t: 'got', id, from, to, d: Int16Array }   frames back, clamped to what the tape
//       holds (the page asks a few seconds at a time, so no copy holds up the audio thread)
//   { t: 'len', frames, ring? }   another length: the newest frames are kept (ring: an Int16Array of it, made and
//       touched on the page and transferred, so this thread neither allocates nor faults in megabytes)
//   'off'                  let go of the ring and stop
// 16-bit as Chromium reads a 16-bit file (and writes one back): v = x < 0 ? round(x * 32768) : round(x * 32767), so
// x = v < 0 ? v / 32768 : v / 32767. A 16-bit source goes through it unchanged, to the sample.
// Pure enough for Node: test/unit/tape.test.js runs this file with stand-ins for the worklet scope's globals.
const BIN = 256, POST = 16;

class EwTape extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = (o && o.processorOptions) || {};
    this.on = true;
    this.alloc(+p.frames || sampleRate * 60);
    this.w = -1;          // the next frame expected (-1: nothing yet)
    this.start = -1;      // the first frame written
    this.bi = -1;         // the bin being filled, and its peak (in 16-bit units)
    this.pk = 0;
    this.pend = new Float32Array(POST);
    this.np = 0;          // bins waiting to be posted, from bin pb on
    this.pb = 0;
    this.port.onmessage = (e) => this.msg(e.data);
  }
  alloc(frames, ring) {
    this.N = Math.max(BIN, Math.ceil(frames / BIN) * BIN);
    this.ring = ring instanceof Int16Array && ring.length === this.N ? ring : new Int16Array(this.N);
  }
  msg(m) {
    if (m === 'off') { this.on = false; this.ring = null; return; }
    if (!m || !this.ring) return;
    if (m.t === 'get') {
      const lo = Math.max(this.start, this.w - this.N), from = Math.max(lo, Math.floor(+m.from) || 0), to = Math.min(this.w, Math.floor(+m.to) || 0);
      const n = Math.max(0, to - from), d = new Int16Array(n);
      if (n) {
        const a = from % this.N, k = Math.min(n, this.N - a);
        d.set(this.ring.subarray(a, a + k), 0);
        if (k < n) d.set(this.ring.subarray(0, n - k), k);
      }
      this.port.postMessage({ t: 'got', id: m.id, from, to: from + n, d }, [d.buffer]);
    } else if (m.t === 'len') {
      const old = this.ring, oN = this.N, held = this.w < 0 ? 0 : Math.min(oN, this.w - this.start);
      this.alloc(+m.frames || this.N, m.ring);
      const keep = Math.min(held, this.N);
      // (in runs between the two rings' wraps, a few copies rather than a loop over every frame: this is the audio
      // thread, and five minutes of frames one at a time would hold up the band for ten quanta)
      for (let f = this.w - keep; f < this.w; ) {
        const a = f % oN, b = f % this.N, k = Math.min(this.w - f, oN - a, this.N - b);
        this.ring.set(old.subarray(a, a + k), b);
        f += k;
      }
      if (this.w >= 0) this.start = Math.max(this.start, this.w - keep);
    }
  }
  bin(b, pk) {
    if (this.np && b !== this.pb + this.np) this.post();
    if (!this.np) this.pb = b;
    this.pend[this.np++] = pk / 32768;
    if (this.np === POST) this.post();
  }
  post() {
    if (!this.np) return;
    this.port.postMessage({ t: 'pk', b: this.pb, pk: this.pend.slice(0, this.np), head: this.w, start: this.start });
    this.np = 0;
  }
  process(ins) {
    if (!this.on) return false;
    const r = this.ring, N = this.N, ch = ins[0] && ins[0][0], f = currentFrame, n = ch ? ch.length : 128;
    if (this.start < 0) { this.start = f; this.w = f; this.bi = Math.floor(f / BIN); }
    // (frames it wasn't run for: silence, at most the ring)
    if (f > this.w) for (let g = Math.max(this.w, f - N); g < f; g++) r[g % N] = 0;
    const b = Math.floor(f / BIN);
    if (b !== this.bi) { this.bin(this.bi, this.pk); this.pk = 0; this.bi = b; }
    let pos = f % N, pk = this.pk;
    if (ch) {
      for (let i = 0; i < n; i++) {
        const x = ch[i];
        const v = x < 0 ? (x <= -1 ? -32768 : Math.round(x * 32768)) : x >= 1 ? 32767 : Math.round(x * 32767);
        r[pos] = v;
        if (++pos === N) pos = 0;
        const a = v < 0 ? -v : v;
        if (a > pk) pk = a;
      }
    } else {
      for (let i = 0; i < n; i++) { r[pos] = 0; if (++pos === N) pos = 0; }
    }
    this.pk = pk;
    this.w = f + n;
    // (the bin just filled goes out as soon as it's whole, not when the next quantum starts)
    if (this.w % BIN === 0) { this.bin(this.bi, this.pk); this.pk = 0; this.bi = this.w / BIN; }
    return true;
  }
}
registerProcessor('ew-tape', EwTape);
