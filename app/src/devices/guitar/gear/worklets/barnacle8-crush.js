// The 'barnacle8-crush' worklet (pedals/20-fuzz.js, the barnacle8 pedal's in ../code.js): the processor source the code builds, byte for byte below this line; change both together (tools/guitar-test.js)
class Barnacle8Crush extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'drive', defaultValue: 10, minValue: 1, maxValue: 400, automationRate: 'k-rate' },
    { name: 'bits', defaultValue: 4, minValue: 1, maxValue: 12, automationRate: 'k-rate' },
    { name: 'down', defaultValue: 4, minValue: 1, maxValue: 64, automationRate: 'k-rate' }]; }
  constructor() { super(); this.ph = 0; this.held = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const dr = p.drive[0], q = Math.pow(2, p.bits[0] - 1), down = p.down[0];
    let ph = this.ph, held = this.held;
    for (let n = 0; n < o.length; n++) {
      if (++ph >= down) { ph -= down; held = Math.round(Math.tanh(dr * (i ? i[n] : 0)) * q) / q; }
      o[n] = held;
    }
    this.ph = ph; this.held = held;
    return true;
  }
}
registerProcessor('barnacle8-crush', Barnacle8Crush);