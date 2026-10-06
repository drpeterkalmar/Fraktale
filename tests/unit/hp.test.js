// js/hp.js: BigInt-Fixpunkt (Dezimal-Roundtrip, double-Umwandlung, Rundung)
'use strict';
require('../../js/hp.js');
const HP = self.FKHP;

test('fromString/toString Roundtrip', () => {
    const cases = [['-0.743643887037158704752191506114774', 33, '-0.743643887037158704752191506114774'],
                   ['0.131825904205311970493132056385139', 33, '0.131825904205311970493132056385139'],
                   ['1.5e-3', 6, '0.001500'], ['-2', 3, '-2.000'], ['0', 4, '0.0000'], ['+12.25', 2, '12.25']];
    for (const [s, d, want] of cases) {
        assert.equal(HP.toString(HP.fromString(s), d), want, s);
        // über viele Stellen stabil: String -> Fixpunkt -> 60 Stellen -> Fixpunkt (Abweichung < 2^-180)
        const v = HP.fromString(s), v2 = HP.fromString(HP.toString(v, 60));
        assert.ok((v > v2 ? v - v2 : v2 - v) < (1n << BigInt(HP.P - 180)), 'Roundtrip 60 Stellen ' + s);
    }
});

test('fromNumber/toNumber exakt (inkl. Subnormale)', () => {
    for (const x of [0.1, -0.5, 1e-300, 5e-324, 123456.789, -1e200]) assert.equal(HP.toNumber(HP.fromNumber(x)), x, String(x));
    assert.equal(HP.fromNumber(NaN), 0n);
    assert.equal(HP.fromNumber(Infinity), 0n);
});

test('roundShift rundet zur nächsten ganzen Zahl (auch negativ)', () => {
    assert.equal(HP.roundShift(-3n, 1), -1n);
    assert.equal(HP.roundShift(3n, 1), 2n);
    assert.equal(HP.roundShift(5n, 0), 5n);
    assert.equal(HP.roundShift(5n, -2), 20n);
});

test('mulNumber', () => {
    const v = HP.fromString('0.75');
    assert.equal(HP.toNumber(HP.mulNumber(v, 0.5)), 0.375);
    assert.equal(HP.toNumber(HP.mulNumber(v, -2)), -1.5);
    assert.equal(HP.toNumber(HP.mulNumber(-v, 0.25)), -0.1875);
    assert.equal(HP.mulNumber(v, 0), 0n);
});

test('toString: kleine negative Zahl ohne Minus, digitsForZoom', () => {
    assert.equal(HP.toString(HP.fromNumber(-1e-7), 3), '0.000');
    assert.equal(HP.toString(HP.fromNumber(-0.0006), 3), '-0.001');
    assert.equal(HP.digitsForZoom(1e9), 14);
    assert.equal(HP.digitsForZoom(1), 6);
});

test('fromString: Unsinn -> 0', () => {
    assert.equal(HP.fromString('abc'), 0n);
    assert.equal(HP.fromString('1,5,3'), 0n);
});

test('fromString: Dezimalkomma (bis 6.5.3 still 0)', () => {
    assert.equal(HP.fromString('1,5'), HP.fromString('1.5'));
    assert.equal(HP.fromString('-0,7436'), HP.fromString('-0.7436'));
    assert.equal(HP.toString(HP.fromString('−0,25e-2'), 5), '-0.00250');
});
