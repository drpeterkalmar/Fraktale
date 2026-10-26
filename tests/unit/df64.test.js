// 7.3 df64 (emulierte doppelte Genauigkeit für die Exoten, js/shaders.js DF64_GLSL / exoticDF):
//  * alle df64-Rechen-Varianten (Exoten × Distanz × Färbe-Stil) und der Selbsttest-Shader durch den GLSL-Prüfer
//  * die Bausteine (twoSum, Aufspalten, twoProd, Summe, Produkt, Quotient, Quadrat) Zeile für Zeile in JS mit Math.fround
//    nachgebaut (striktes IEEE-f32; O() ist dort die Identität): Genauigkeit gegen f64 ≤ 8 · 2^-48
//  * die f32-Varianten bleiben ohne df64-Code (bitgleich zu 7.2, siehe auch shader2d.test.js)
'use strict';
require('../../js/shaders.js');
const L = require('./glsl-lint.js');
const SH = self.FKShaders;

test('df64-Rechen-Shader (Multibrot, Phoenix, Nova, Magnet I/II, Lyapunov) + Selbsttest: fehlerfrei', () => {
    const errs = [];
    for (const F of [23, 24, 25, 26, 27, 28]) for (const de of [false, true]) for (const st of [0, 1, 2, 4, 6])
        errs.push(...L.lintProgram(SH.VS, SH.computeFS(F, 'df64', false, de, false, st), `df${F}${de ? 'd' : ''}s${st}`));
    errs.push(...L.lintProgram(SH.VS, SH.DF64_TEST_FS, 'df64test'));
    assert.deepEqual(errs, []);
});

test('df64 nur im Rechenweg df64: f32-Varianten ohne df64-Code, df64-Varianten mit Schutz gegen Umordnen (O(), u_z)', () => {
    for (const F of [23, 24, 25, 26, 27, 28]) {
        assert.ok(!SH.computeFS(F, 'direct', false, true, false, 0).includes('u_z'), 'f32 ' + F);
        const d = SH.computeFS(F, 'df64', false, true, false, 0);
        assert.ok(d.includes('uniform uint u_z') && d.includes('u_centerD') && d.includes('float v = O(s - a);') && d.includes('O(t - O(t - a))'), 'df64 ' + F);
        assert.ok(!/for \(int \w+ = \d+; \w+ < \d+;/.test(d.replace(/for \(int k = 2; k < Pi;/, '')), 'keine Schleife mit fester Grenze (FXC entrollte sie, 7.1.11): ' + F);
    }
});

// --- Bausteine in striktem f32 (Math.fround nach jeder Operation, O() = Identität) – dieselbe Reihenfolge wie im GLSL-Text
const f = Math.fround;
const twoSum = (a, b) => { const s = f(a + b), v = f(s - a); return [s, f(f(a - f(s - v)) + f(b - v))]; };
const qSum = (a, b) => { const s = f(a + b); return [s, f(b - f(s - a))]; };
const dSplit = (a) => { const t = f(a * 4097), h = f(t - f(t - a)); return [h, f(a - h)]; };
const twoProd = (a, b) => { const p = f(a * b), A = dSplit(a), B = dSplit(b); return [p, f(f(f(f(f(A[0] * B[0]) - p) + f(A[0] * B[1])) + f(A[1] * B[0])) + f(A[1] * B[1]))]; };
const dAdd = (a, b) => { const s = twoSum(a[0], b[0]); return qSum(s[0], f(s[1] + f(a[1] + b[1]))); };
const dSub = (a, b) => dAdd(a, [-b[0], -b[1]]);
const dMul = (a, b) => { const p = twoProd(a[0], b[0]); return qSum(p[0], f(p[1] + f(f(a[0] * b[1]) + f(a[1] * b[0])))); };
const dMulF = (a, b) => { const p = twoProd(a[0], b); return qSum(p[0], f(p[1] + f(a[1] * b))); };
const dSqr = (a) => { const p = twoProd(a[0], a[0]); return qSum(p[0], f(p[1] + f(f(2 * a[0]) * a[1]))); };
const dDiv = (a, b) => { const q = f(a[0] / b[0]), r = dSub(a, dMulF(b, q)); return qSum(q, f(r[0] / b[0])); };
const split = (v) => { const h = f(v); return [h, f(v - h)]; };
const val = (d) => d[0] + d[1];

test('df64-Bausteine in striktem f32: Summe/Produkt/Quotient/Quadrat ≤ 8 · 2^-48 (f32 allein: ~2^24 mal schlechter)', () => {
    let s = 4242; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const U = Math.pow(2, -48);
    let worst = [0, 0, 0, 0];
    for (let i = 0; i < 20000; i++) {
        const a = (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 6) - 3), b = (rnd() - 0.5) * Math.pow(10, Math.floor(rnd() * 6) - 3);
        const A = split(a), B = split(b), x = val(A), y = val(B);
        const ex = [x + y, x * y, x / y, x * x], ref = [Math.max(Math.abs(x), Math.abs(y)), Math.abs(x * y), Math.abs(x / y), x * x];
        const got = [dAdd(A, B), dMul(A, B), dDiv(A, B), dSqr(A)];
        for (let k = 0; k < 4; k++) worst[k] = Math.max(worst[k], Math.abs(val(got[k]) - ex[k]) / (ref[k] * U));
    }
    worst = worst.map(w => +w.toFixed(2));
    assert.ok(worst.every(w => w <= 8), 'größter Fehler (Einheiten 2^-48) Summe/Produkt/Quotient/Quadrat: ' + worst.join(' / '));
});

test('df64-Iteration (Mandelbrot-Bahn, 300 Schritte) folgt f64 auf ~1e-12, f32 nicht', () => {
    // c im Hals zwischen Kardioide und Periode-2-Kreis (Seepferdchental, die Bahn kriecht ~300 Schritte): df64 bleibt nahe an f64
    const cx = -0.75 + 1.234567e-9, cy = 0.01 - 9.87654e-10;
    let zx = 0, zy = 0, dzx = [0, 0], dzy = [0, 0], fx = 0, fy = 0;
    const Cx = split(cx), Cy = split(cy);
    let maxD = 0, maxF = 0;
    for (let n = 0; n < 300; n++) {
        [zx, zy] = [zx * zx - zy * zy + cx, 2 * zx * zy + cy];
        if (zx * zx + zy * zy > 4) break;
        [dzx, dzy] = [dAdd(dSub(dSqr(dzx), dSqr(dzy)), Cx), dAdd(dMulF(dMul(dzx, dzy), 2), Cy)];
        [fx, fy] = [f(f(f(fx * fx) - f(fy * fy)) + f(cx)), f(f(f(2 * fx) * fy) + f(cy))];
        maxD = Math.max(maxD, Math.hypot(val(dzx) - zx, val(dzy) - zy));
        maxF = Math.max(maxF, Math.hypot(fx - zx, fy - zy));
    }
    assert.ok(maxD < 1e-11 && maxF > 1e-7, `df64 max Abweichung ${maxD.toExponential(2)}, f32 ${maxF.toExponential(2)}`);
});
