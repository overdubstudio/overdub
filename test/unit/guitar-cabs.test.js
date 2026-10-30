// The guitar amps' cabs (devices/guitar/gear/code.js PLUG_AMP_IR, devices/guitar/amps.js): which cab each amp plays
// when nobody picked one, what a saved rig writes and reads back, and the room's view of it (ui/liveroom/guitar/
// shop-data.js, room-rig.js). The sound itself (each amp on its measured cab as loud as on its own, the fallback while
// the bank loads, no click when it lands or a cab is switched) is measured in muted Chromium: tools/guitar-test.js 4c.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAB_IDS as STACK_CABS, CAB_NAMES } from '../../app/src/devices/builtin/amp-lib.js';
import { CAB_IDS, AMPS, ampSettings, ampParams, gear } from '../../app/src/devices/guitar/index.js';
import { cabDefault, cabDefaultIndex, isMeasured, AMP_CAB_SAYS } from '../../app/src/devices/guitar/amps.js';
import { paramValues } from '../../app/src/devices/registry.js';
import { cabOf, carriedAmp, MEASURED_CABS, describeStack } from '../../app/src/ui/liveroom/guitar/shop-data.js';
import { cabOf as roomCab, micsOf } from '../../app/src/ui/liveroom/guitar/room-rig.js';
import { CLUB_STACK } from '../../app/src/core/liveroom/guitar/setup.js';

// the amps that keep their own designed cab, and why (code.js PLUG_AMP_IR)
const OWN = ['whale', 'walrus', 'narwhal', 'sandbar', 'urchin', 'abyss', 'tiny', 'radio', 'bit', 'tape', 'di'];
const own = CAB_IDS.indexOf('own');
const def = (id) => AMPS.find((d) => d.id === 'amp.' + id);

describe('the measured cabs', () => {
  test('are the Half Stack’s six, after every designed cab (the old CAB indexes unchanged)', () => {
    assert.deepEqual(MEASURED_CABS, STACK_CABS);
    assert.deepEqual(
      MEASURED_CABS.map((id) => gear.PLUG_CABS[id].name),
      CAB_NAMES.slice(0, 6),
    ); // (then its filter 4x12 and off)
    assert.equal(CAB_IDS.indexOf('own'), 0);
    assert.equal(CAB_IDS.indexOf('v412'), 7);
    assert.equal(CAB_IDS.indexOf('m212'), 16);
    assert.equal(CAB_IDS.indexOf(MEASURED_CABS[0]), 17);
    assert.equal(CAB_IDS.length, 23);
  });
  test('every guitar amp defaults to one; the bass amps, the character amps and the DI keep their own', () => {
    for (const d of AMPS) {
      const id = d.amp,
        cab = cabDefault(id),
        p = d.params.find((x) => x.key === 'cab');
      assert.equal(CAB_IDS[p.def], cab, id);
      assert.equal(cabDefaultIndex('amp.' + id), p.def, id);
      // (a kernel amp names the bank whatever its default: any CAB can be a measured one)
      if (typeof d.kernel === 'string')
        assert.deepEqual(Object.values(d.data), [Object.values(def('recto').data)[0]], `${id} names the bank`);
      if (OWN.includes(id)) {
        assert.equal(cab, 'own', id);
        if (typeof d.kernel !== 'string') assert.equal(d.data, undefined, `${id} names no bank`);
      } else {
        assert.ok(isMeasured(cab), `${id} on ${cab}`);
        assert.equal(gear.PLUG_AMP_IR[id], cab, id);
        assert.deepEqual(Object.values(d.data), [Object.values(def('recto').data)[0]], `${id} names the bank`);
        assert.equal(d.dataSays, AMP_CAB_SAYS);
      }
    }
    assert.equal(
      AMPS.filter((d) => d.tone === 'bass').every((d) => cabDefault(d.amp) === 'own'),
      true,
    );
  });
  test('the high-gain heads stand on the close modern 4x12, as the Half Stack does', () => {
    for (const id of ['recto', 'slo', 'metal']) assert.equal(cabDefault(id), 'modern-close');
    assert.equal(cabDefault('core.stack'), 'own'); // (not one of ours: it has its own CAB)
  });
  test('the rack’s words while the bank loads or isn’t there are calm and short', () => {
    for (const [short, long] of Object.values(AMP_CAB_SAYS)) {
      assert.ok(short.length <= 40, short);
      assert.ok(/designed cab/.test(long), long);
      assert.doesNotMatch(short + long, /!|error|fail/i);
    }
  });
});

describe('saved rigs', () => {
  const vals = (id, stored) => paramValues(def(id), stored);
  test('a rig with no cab plays the amp’s default, and writes none back', () => {
    const v = vals('recto', { gain: 6 });
    assert.equal(CAB_IDS[v.cab], 'modern-close');
    assert.equal('cab' in ampSettings('recto', v), false);
    assert.equal('cab' in ampParams({ amp: 'recto', gain: 6 }), false);
  });
  test('an explicit cab stays put: the designed 4x12 Modern (CAB 7) of a song saved before', () => {
    const v = vals('recto', { cab: 7, mic: 0, micpos: 0.3, micdist: 1, micang: 0 });
    assert.equal(ampSettings('recto', v).cab, 'v412');
  });
  test('“its own” is a choice on an amp whose default is measured, and comes back as one', () => {
    assert.equal(ampParams({ amp: 'recto', cab: 'own' }).cab, own);
    assert.equal(ampSettings('recto', vals('recto', { cab: own })).cab, 'own');
    assert.deepEqual(gear.plugCabClean({ amp: 'recto', cab: 'own' }), { cab: 'own' });
    // (on an amp whose default is its own, it's no choice: nothing written)
    assert.equal('cab' in ampSettings('whale', vals('whale', { cab: own })), false);
    assert.deepEqual(gear.plugCabClean({ amp: 'whale', cab: 'own' }), {});
  });
  test('a measured cab saved on a bass amp plays there; a cab id from a later version is dropped', () => {
    const i = CAB_IDS.indexOf('british-side');
    assert.equal(ampSettings('whale', vals('whale', { cab: i })).cab, 'british-side');
    assert.deepEqual(gear.plugCabClean({ amp: 'recto', cab: 'some-later-cab' }), {});
    assert.equal('cab' in ampParams({ amp: 'recto', cab: 'some-later-cab' }), false);
  });
});

describe('the room', () => {
  const kraken = CLUB_STACK.chain.find((l) => l.device === 'amp.recto');
  test('the club’s Kraken stands on its default, the close modern 4x12, and writes no cab', () => {
    assert.equal(kraken.params.cab, undefined);
    assert.equal(cabOf(kraken).cab, 'modern-close');
    assert.equal(cabOf(kraken).measured, true);
    assert.equal(
      describeStack(CLUB_STACK.chain),
      'Kraken on a Modern 4x12, close dynamic, a noise gate and a treble booster in front',
    );
  });
  test('a measured cab has no mic to place; a designed one keeps its mics', () => {
    assert.equal(cabOf(kraken).mic1, null);
    assert.deepEqual(micsOf({}, 'amp.recto'), []);
    assert.equal(micsOf({ cab: 7 }, 'amp.recto').length, 1);
    assert.equal(micsOf({}, 'amp.whale').length, 1);
    assert.deepEqual(micsOf({ cab: 2 }, 'core.stack'), []);
    assert.equal(cabOf({ device: 'amp.recto', params: { cab: 7 } }).mic1.type, 'dyn');
  });
  test('a carried amp comes onto its own default unless you chose a cab', () => {
    const meg = carriedAmp('amp.metal', kraken);
    assert.equal(meg.params.cab, undefined);
    assert.equal(cabOf(meg).cab, 'modern-close');
    const mine = carriedAmp('amp.clean', { device: 'amp.recto', params: { cab: 2, mic: 1, micpos: 0.6 } });
    assert.equal(mine.params.cab, 2);
    assert.equal(mine.params.micpos, 0.6);
    assert.equal(carriedAmp('amp.whale', kraken).params.cab, undefined);
    assert.equal(cabOf(carriedAmp('amp.whale', kraken)).cab, 'own');
  });
  test('the stage draws the cab an amp plays: its default, the Half Stack’s own switch', () => {
    assert.equal(roomCab({ device: 'amp.clean', params: {} }).id, 'british-dynamic');
    assert.equal(roomCab({ device: 'amp.clean', params: { cab: 0 } }).id, 'own');
    assert.equal(roomCab({ device: 'core.stack', params: { cab: 5 } }).id, STACK_CABS[5]);
    assert.equal(roomCab({ device: 'core.stack', params: {} }).id, STACK_CABS[0]);
  });
});
