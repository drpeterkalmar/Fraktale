// js/fractal-core.js: generische Perturbation (f64) gegen direkte Iteration (f64) für die Formeln 0–4 bei Zoom 10³
// (Ansichten auf dem Mengenrand, ~50 % innen; Julia c = −0,8+0,156i hat kein Inneres). Verglichen werden die gut
// konditionierten Pixel: direkt bei c und c±δ (δ = 1e-13) gleich bis 1e-7 – an chaotischen Randpixeln springt schon die
// direkte f64-Rechnung bei winziger Verschiebung von c (wie die Konditionsprüfung in tests/truth.py).
'use strict';
require('../../js/hp.js');
require('../../js/fractal-core.js');
const HP = self.FKHP, C = self.FKCore;

const VIEWS = [
    { f: 0, name: 'Mandelbrot', cx: '0.201751', cy: '0.543183' },
    { f: 1, name: 'Julia', cx: '0.2721', cy: '0.0055', jx: '-0.8', jy: '0.156' },
    { f: 2, name: 'Burning Ship', cx: '-0.907840', cy: '0.077120' },
    { f: 3, name: 'Tricorn', cx: '-0.394894', cy: '0.087025' },
    { f: 4, name: 'Mandelbrot z³', cx: '-0.138148', cy: '0.761197' },
];
const ZOOM = 1e3, MAXIT = 1200, N = 200;

for (const v of VIEWS) test(`${v.name} (Formel ${v.f}): Perturbation = direkt (|Δμ| ≤ 1e-6, gleiche Klasse)`, () => {
    const s = 3 / ZOOM;                                   // Bildhöhe in Weltkoordinaten (quadratische Ansicht)
    const req = { formula: v.f, cx: HP.fromString(v.cx).toString(), cy: HP.fromString(v.cy).toString(),
                  jx: HP.fromString(v.jx || '0').toString(), jy: HP.fromString(v.jy || '0').toString(),
                  zoom: ZOOM, maxIter: MAXIT, halfW: s / 2, halfH: s / 2, pixel: s / 800 };
    const R = C.computeReference(req);
    const offX = HP.toNumber(HP.fromString(v.cx) - BigInt(R.refX)), offY = HP.toNumber(HP.fromString(v.cy) - BigInt(R.refY));
    const cx = +v.cx, cy = +v.cy, jx = +(v.jx || 0), jy = +(v.jy || 0);
    let seed = 4242 + v.f;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const dir = (x, y) => C.directPixel(cx + x, cy + y, v.f, MAXIT, jx, jy), DL = 1e-13;
    let nOut = 0, nIn = 0, nCond = 0, maxd = 0;
    for (let k = 0; k < N; k++) {
        const ux = (rnd() - 0.5) * s, uy = (rnd() - 0.5) * s;
        const d = dir(ux, uy), d1 = dir(ux + DL, uy), d2 = dir(ux, uy - DL);
        const p = C.perturbPixel(offX + ux, offY + uy, R.ref, MAXIT, false);
        const cond = (d < 0) === (d1 < 0) && (d < 0) === (d2 < 0) && (d < 0 || (Math.abs(d1 - d) <= 1e-7 && Math.abs(d2 - d) <= 1e-7));
        if (d < 0) nIn++; else nOut++;
        if (!cond) continue;
        nCond++;
        assert.equal(d < 0, p < 0, `Klasse an (${ux}, ${uy}): direkt ${d}, Perturbation ${p}`);
        if (d >= 0) maxd = Math.max(maxd, Math.abs(d - p));
    }
    assert.ok(maxd <= 1e-6, `max |Δμ| = ${maxd}`);
    assert.ok(nCond >= 0.5 * N, `genug gut konditionierte Pixel (${nCond} von ${N}; ${nOut} außen, ${nIn} innen)`);
    if (v.f !== 1) assert.ok(nIn > 20 && nOut > 20, `Ansicht auf dem Rand (${nOut} außen, ${nIn} innen)`);
});
