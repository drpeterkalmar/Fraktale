// fractal-core.js — Mathe-Kern (f64 + BigInt), geteilt von Orbit-Worker, Tile-Worker und Node-Tests.
//
// Konventionen (identisch im GPU-Shader, siehe shaders.js):
//  * Formeln: 0 Mandelbrot, 1 Julia, 2 Burning Ship, 3 Tricorn, 4 Mandelbrot z³, 5 Newton
//  * Fluchtradius |z|² > 256, glatte Iteration mu = n + 1 − log2(log2|z_n|) (z³: log₃)
//    n = Index des ersten z_n mit |z_n|² > 256 (z_0 = 0 bzw. Pixel bei Julia); Inneres = −1
//  * Perturbation: jeder Pixel führt seinen EIGENEN Orbit-Index m (dz = z − Z_m).
//    Schritt dz' = f(Z_m + dz) − f(Z_m) + dc, Fluchttest am vollen z' = Z_{m+1} + dz'.
//  * Zhuoran-Rebase: |z'| < |dz'| oder Orbit-Ende  ->  dz := z', m := 0 auf Orbit B.
//    Orbit B startet bei 0 (kritischer Orbit). Für Mandelbrot-artige Formeln ist B == A;
//    für Julia ist A der Orbit des Ansichts-Referenzpunkts und B der kritische Orbit.
//  * BLA (bilineare Approximation, nur holomorphe Formeln 0/1/4): Stufe l überspringt 2^l
//    Iterationen ab m = 1 + i·2^l mit dz' = A·dz + B·dc, gültig solange |dz| < R.
(function (root) {
'use strict';

const HP = root.FKHP;
const BAIL = 256;
const MAXL = 24;                 // max. BLA-Stufen (2^24 Iterationen)
const LN3 = Math.log(3);

function ctz(k) { // Anzahl Nullbits am Ende (k > 0)
    return 31 - Math.clz32(k & -k);
}

function smoothIter(n, zx, zy, formula) {
    const l2 = 0.5 * Math.log2(zx * zx + zy * zy);   // log2|z|
    return formula === 4 ? n + 1 - Math.log(l2) / LN3 : n + 1 - Math.log2(l2);
}

// |a| < |b| ohne Unterlauf bei winzigen Werten (Deep Zoom bis 1e290)
function lessMag(ax, ay, bx, by) {
    const b2 = bx * bx + by * by;
    if (b2 > 1e-280) return ax * ax + ay * ay < b2;
    const s = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by));
    if (s === 0) return false;
    const k = 1 / s;
    ax *= k; ay *= k; bx *= k; by *= k;
    return ax * ax + ay * ay < bx * bx + by * by;
}

// ------------------------------------------------------------------
//  Direkte f64-Iteration (flache Zooms, Newton, Tricorn/Burning Ship bis 1e12)
// ------------------------------------------------------------------
function directPixel(px, py, formula, maxIter, jx, jy) {
    if (formula === 5) return newtonPixel(px, py);
    let zx, zy, cx, cy;
    if (formula === 1) { zx = px; zy = py; cx = jx; cy = jy;
        if (zx * zx + zy * zy > BAIL) return smoothIter(0, zx, zy, 1);
    } else { zx = 0; zy = 0; cx = px; cy = py; }
    for (let n = 1; n <= maxIter; n++) {
        let nx, ny;
        if (formula === 2) { nx = zx * zx - zy * zy + cx; ny = Math.abs(2 * zx * zy) + cy; }
        else if (formula === 3) { nx = zx * zx - zy * zy + cx; ny = -2 * zx * zy + cy; }
        else if (formula === 4) { const x2 = zx * zx, y2 = zy * zy; nx = zx * (x2 - 3 * y2) + cx; ny = zy * (3 * x2 - y2) + cy; }
        else { nx = zx * zx - zy * zy + cx; ny = 2 * zx * zy + cy; }
        zx = nx; zy = ny;
        if (zx * zx + zy * zy > BAIL) return smoothIter(n, zx, zy, formula);
    }
    return -1;
}

// Newton z³ − 1 (wie GPU-Shader): Rückgabe j + 1 + 1000·Wurzelindex, −1 ohne Konvergenz
function newtonPixel(x, y) {
    for (let j = 0; j < 80; j++) {
        const x2 = x * x - y * y, y2 = 2 * x * y;
        const x3 = x * x2 - y * y2, y3 = x * y2 + y * x2;
        const nr = 2 * x3 + 1, ni = 2 * y3;
        const dr = 3 * x2, di = 3 * y2;
        const d2 = dr * dr + di * di;
        if (d2 < 1e-30) break;
        x = (nr * dr + ni * di) / d2;
        y = (ni * dr - nr * di) / d2;
        if ((x - 1) * (x - 1) + y * y < 1e-6) return j + 1;
        if ((x + 0.5) * (x + 0.5) + (y - 0.8660254037844386) * (y - 0.8660254037844386) < 1e-6) return j + 1001;
        if ((x + 0.5) * (x + 0.5) + (y + 0.8660254037844386) * (y + 0.8660254037844386) < 1e-6) return j + 2001;
    }
    return -1;
}

// ------------------------------------------------------------------
//  Perturbation (+BLA) in f64 — CPU-Pfad und Referenzsuche
//  ref = { formula, orbit(Float64Array x,y), baseA, lenA, baseB, lenB, bla|null }
// ------------------------------------------------------------------
function perturbPixel(dcx, dcy, ref, maxIter, useBLA) {
    if (ref.formula <= 1) return perturbZ2(dcx, dcy, ref, maxIter, useBLA ? ref.bla : null);
    const O = ref.orbit, f = ref.formula;
    const bla = useBLA ? ref.bla : null;
    let o = 0, base = ref.baseA, len = ref.lenA;
    let dzx, dzy, cx, cy;
    if (f === 1) {
        dzx = dcx; dzy = dcy; cx = 0; cy = 0;
        const zx = O[2 * base] + dzx, zy = O[2 * base + 1] + dzy;
        if (zx * zx + zy * zy > BAIL) return smoothIter(0, zx, zy, f);
    } else { dzx = 0; dzy = 0; cx = dcx; cy = dcy; }
    let m = 0, n = 0, wait = 0, back = 1;
    while (n < maxIter) {
        if (bla !== null && m > 0 && --wait <= 0) {
            // R fällt monoton mit der Stufe -> aufsteigend suchen, bei erster ungültiger Stufe stoppen
            // (scheitert schon Stufe 1, kostet der Versuch nur eine Prüfung)
            const k = m - 1;
            const L = bla.L[o];
            const lmax = k === 0 ? L : Math.min(L, ctz(k));
            const dmax = Math.max(Math.abs(dzx), Math.abs(dzy)) * 1.4142135623730951;
            let bestE = -1, bestL = 0;
            for (let l = 1; l <= lmax; l++) {
                if (m + (1 << l) > len - 1 || n + (1 << l) > maxIter) break;
                const e = bla.off[o * MAXL + l] + (k >> l);
                if (dmax < bla.R[e]) { bestE = e; bestL = l; } else break;
            }
            let applied = false;
            if (bestE < 0) { back = back < 64 ? back * 2 : 64; wait = back; }
            else {
                back = 1;
                const e4 = 4 * bestE, step = 1 << bestL;
                const ax = bla.A[e4], ay = bla.A[e4 + 1], bx = bla.A[e4 + 2], by = bla.A[e4 + 3];
                const nx = ax * dzx - ay * dzy + bx * cx - by * cy;
                const ny = ax * dzy + ay * dzx + bx * cy + by * cx;
                dzx = nx; dzy = ny; m += step; n += step;
                applied = true;
            }
            if (applied) {
                const zx = O[2 * (base + m)] + dzx, zy = O[2 * (base + m) + 1] + dzy;
                if (zx * zx + zy * zy > BAIL) return smoothIter(n, zx, zy, f);
                if (m >= len - 1 || lessMag(zx, zy, dzx, dzy)) {
                    o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0; wait = 0; back = 1;
                }
                continue;
            }
        }
        const i2 = 2 * (base + m);
        const X = O[i2], Y = O[i2 + 1];
        let nx, ny;
        if (f === 2) {        // Burning Ship: y' = 2|xy| + cy
            nx = (2 * X + dzx) * dzx - (2 * Y + dzy) * dzy + cx;
            ny = 2 * diffabs(X * Y, X * dzy + Y * dzx + dzx * dzy) + cy;
        } else if (f === 3) { // Tricorn: dz' = conj(2Z dz + dz²) + dc
            nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + cx;
            ny = -(2 * (X * dzy + Y * dzx) + 2 * dzx * dzy) + cy;
        } else if (f === 4) { // z³: dz' = dz·(3Z² + 3Z dz + dz²) + dc
            const tx = 3 * (X * X - Y * Y) + 3 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy;
            const ty = 6 * X * Y + 3 * (X * dzy + Y * dzx) + 2 * dzx * dzy;
            nx = dzx * tx - dzy * ty + cx;
            ny = dzx * ty + dzy * tx + cy;
        } else {              // Mandelbrot / Julia: dz' = 2Z dz + dz² + dc
            nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + cx;
            ny = 2 * (X * dzy + Y * dzx) + 2 * dzx * dzy + cy;
        }
        dzx = nx; dzy = ny;
        m++; n++;
        const j2 = 2 * (base + m);
        const zx = O[j2] + dzx, zy = O[j2 + 1] + dzy;
        if (zx * zx + zy * zy > BAIL) return smoothIter(n, zx, zy, f);
        if (m >= len - 1 || lessMag(zx, zy, dzx, dzy)) {
            o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0;
        }
    }
    return -1;
}

// Spezialisierte heiße Schleife für z² + c (Mandelbrot/Julia) — identische Mathematik wie
// perturbPixel, nur ohne Formel-Verzweigung und mit inline-Betragsvergleich (≈ 1.5–2× schneller).
function perturbZ2(dcx, dcy, ref, maxIter, bla) {
    const O = ref.orbit, julia = ref.formula === 1;
    let base = ref.baseA, len = ref.lenA, o = 0;
    let dzx, dzy, cx, cy;
    if (julia) {
        dzx = dcx; dzy = dcy; cx = 0; cy = 0;
        const zx = O[2 * base] + dzx, zy = O[2 * base + 1] + dzy;
        if (zx * zx + zy * zy > BAIL) return smoothIter(0, zx, zy, 1);
    } else { dzx = 0; dzy = 0; cx = dcx; cy = dcy; }
    let m = 0, n = 0;
    let X = O[2 * base], Y = O[2 * base + 1];
    let wait = 0, back = 1;          // BLA-Backoff: nach Fehlversuch 1,2,4..64 Schritte nicht probieren
    while (n < maxIter) {
        if (bla !== null && m > 0 && --wait <= 0) {
            const k = m - 1;
            const L = bla.L[o];
            const lmax = k === 0 ? L : Math.min(L, 31 - Math.clz32(k & -k));
            const ax_ = dzx < 0 ? -dzx : dzx, ay_ = dzy < 0 ? -dzy : dzy;
            const dmax = (ax_ > ay_ ? ax_ : ay_) * 1.4142135623730951;
            let bestE = -1, bestL = 0;
            for (let l = 1; l <= lmax; l++) {
                if (m + (1 << l) > len - 1 || n + (1 << l) > maxIter) break;
                const e = bla.off[o * MAXL + l] + (k >> l);
                if (dmax < bla.R[e]) { bestE = e; bestL = l; } else break;
            }
            if (bestE < 0) { back = back < 64 ? back * 2 : 64; wait = back; }
            else {
                back = 1;
                const e4 = 4 * bestE;
                const ax = bla.A[e4], ay = bla.A[e4 + 1], bx = bla.A[e4 + 2], by = bla.A[e4 + 3];
                const nx = ax * dzx - ay * dzy + bx * cx - by * cy;
                dzy = ax * dzy + ay * dzx + bx * cy + by * cx; dzx = nx;
                m += 1 << bestL; n += 1 << bestL;
                X = O[2 * (base + m)]; Y = O[2 * (base + m) + 1];
                const zx = X + dzx, zy = Y + dzy;
                const z2 = zx * zx + zy * zy;
                if (z2 > BAIL) return smoothIter(n, zx, zy, 0);
                const d2 = dzx * dzx + dzy * dzy;
                if (m >= len - 1 || (d2 > 1e-280 ? z2 < d2 : lessMag(zx, zy, dzx, dzy))) {
                    o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0; X = 0; Y = 0; wait = 0; back = 1;
                }
                continue;
            }
        }
        const nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + cx;
        dzy = 2 * (X * dzy + Y * dzx) + 2 * dzx * dzy + cy; dzx = nx;
        m++; n++;
        X = O[2 * (base + m)]; Y = O[2 * (base + m) + 1];
        const zx = X + dzx, zy = Y + dzy;
        const z2 = zx * zx + zy * zy;
        if (z2 > BAIL) return smoothIter(n, zx, zy, 0);
        const d2 = dzx * dzx + dzy * dzy;
        if (m >= len - 1 || (d2 > 1e-280 ? z2 < d2 : lessMag(zx, zy, dzx, dzy))) {
            o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0; X = 0; Y = 0; wait = 0; back = 1;
        }
    }
    return -1;
}

// |c + d| − |c|, numerisch stabil (Burning-Ship-Perturbation)
function diffabs(c, d) {
    if (c >= 0) return (c + d >= 0) ? d : -(2 * c + d);
    return (c + d > 0) ? (2 * c + d) : -d;
}

// ------------------------------------------------------------------
//  BLA-Tabelle (f64). Rückgabe { L, levels:[{A:Float64Array(4n), R:Float64Array(n), count}] }
//  levels[0] = Einzelschritte m = 1..len-2, levels[l] = Sprünge der Länge 2^l.
// ------------------------------------------------------------------
function buildBLA(orbit, base, len, formula, eps, cmax) {
    const n0 = len - 2;
    if (formula !== 0 && formula !== 1 && formula !== 4) return { L: 0, levels: [] };
    if (n0 < 2) return { L: 0, levels: [] };
    const julia = formula === 1;
    let A = new Float64Array(4 * n0), R = new Float64Array(n0);
    for (let i = 0; i < n0; i++) {
        const j = 2 * (base + 1 + i);
        const X = orbit[j], Y = orbit[j + 1];
        const mz = Math.hypot(X, Y);
        if (formula === 4) { A[4 * i] = 3 * (X * X - Y * Y); A[4 * i + 1] = 6 * X * Y; }
        else { A[4 * i] = 2 * X; A[4 * i + 1] = 2 * Y; }
        A[4 * i + 2] = julia ? 0 : 1; A[4 * i + 3] = 0;
        R[i] = eps * mz;
    }
    const levels = [{ A, R, count: n0 }];
    let cnt = n0;
    while (cnt >= 2 && levels.length < MAXL) {
        const nc = cnt >> 1;
        const pA = A, pR = R;
        A = new Float64Array(4 * nc); R = new Float64Array(nc);
        for (let i = 0; i < nc; i++) {
            const x = 2 * i, y = 2 * i + 1;
            const ax = pA[4 * x], ay = pA[4 * x + 1], bx = pA[4 * x + 2], by = pA[4 * x + 3];
            const cx_ = pA[4 * y], cy_ = pA[4 * y + 1], dx = pA[4 * y + 2], dy = pA[4 * y + 3];
            // A_z = A_y·A_x ; B_z = A_y·B_x + B_y
            A[4 * i] = cx_ * ax - cy_ * ay;
            A[4 * i + 1] = cx_ * ay + cy_ * ax;
            A[4 * i + 2] = cx_ * bx - cy_ * by + dx;
            A[4 * i + 3] = cx_ * by + cy_ * bx + dy;
            const mAx = Math.hypot(ax, ay), mBx = Math.hypot(bx, by);
            let r = 0;
            if (mAx > 0) r = Math.min(pR[x], (pR[y] - mBx * cmax) / mAx);
            R[i] = r > 0 && isFinite(r) ? r : 0;
        }
        levels.push({ A, R, count: nc });
        cnt = nc;
    }
    return { L: levels.length - 1, levels };
}

// Zwei BLA-Tabellen (Orbit A, Orbit B) zu flachen Arrays zusammenführen (f64 oder f32)
function packBLA(tabA, tabB, sameB, asF32) {
    const off = new Int32Array(2 * MAXL), cnt = new Int32Array(2 * MAXL);
    const tabs = sameB ? [tabA] : [tabA, tabB];
    let total = 0;
    tabs.forEach((t, o) => { for (let l = 1; l <= t.L; l++) { off[o * MAXL + l] = total; cnt[o * MAXL + l] = t.levels[l].count; total += t.levels[l].count; } });
    if (sameB) for (let l = 0; l < MAXL; l++) { off[MAXL + l] = off[l]; cnt[MAXL + l] = cnt[l]; }
    const Arr = asF32 ? Float32Array : Float64Array;
    const A = new Arr(4 * Math.max(1, total)), R = new Arr(Math.max(1, total));
    tabs.forEach((t, o) => {
        for (let l = 1; l <= t.L; l++) {
            const lv = t.levels[l], o0 = off[o * MAXL + l];
            for (let i = 0; i < lv.count; i++) {
                let r = lv.R[i];
                const a0 = lv.A[4 * i], a1 = lv.A[4 * i + 1], b0 = lv.A[4 * i + 2], b1 = lv.A[4 * i + 3];
                if (asF32 && (Math.abs(a0) > 1e30 || Math.abs(a1) > 1e30 || Math.abs(b0) > 1e30 || Math.abs(b1) > 1e30 || r < 1e-37)) r = 0;
                const e = o0 + i;
                A[4 * e] = r > 0 ? a0 : 0; A[4 * e + 1] = r > 0 ? a1 : 0;
                A[4 * e + 2] = r > 0 ? b0 : 0; A[4 * e + 3] = r > 0 ? b1 : 0;
                R[e] = r;
            }
        }
    });
    const L = [tabA.L, sameB ? tabA.L : tabB.L];
    return { A, R, off, cnt, L, total };
}

// ------------------------------------------------------------------
//  BigInt-Orbit (Fixpunkt mit pw Nachkommabits)
// ------------------------------------------------------------------
function makeToF(pw) {
    const SH = BigInt(pw - 60), LIM = 1n << 40n, NLIM = -LIM;
    return function toF(v) {
        const t = v >> SH;
        if (t > LIM || t < NLIM) return Number(t) * 8.673617379884035e-19; // 2^-60
        return HP.toNumberP(v, pw);
    };
}

// Orbit ab z0 mit Parameter c, speichert Z_0..Z_{len-1} (inkl. erstem geflohenen Wert)
function hpOrbit(formula, zx, zy, cx, cy, pw, maxN) {
    const S = BigInt(pw), S1 = BigInt(pw - 1);
    const BL = 256n << S;
    const toF = makeToF(pw);
    const out = new Float64Array(2 * (maxN + 1));
    let len = 0, escaped = false;
    for (let n = 0; n <= maxN; n++) {
        out[2 * n] = toF(zx); out[2 * n + 1] = toF(zy);
        len = n + 1;
        const x2 = (zx * zx) >> S, y2 = (zy * zy) >> S;
        if (x2 + y2 > BL) { escaped = true; break; }
        if (n === maxN) break;
        let nx, ny;
        if (formula === 2) { const xy = (zx * zy) >> S1; nx = x2 - y2 + cx; ny = (xy < 0n ? -xy : xy) + cy; }
        else if (formula === 3) { nx = x2 - y2 + cx; ny = -((zx * zy) >> S1) + cy; }
        else if (formula === 4) { nx = ((zx * (x2 - 3n * y2)) >> S) + cx; ny = ((zy * (3n * x2 - y2)) >> S) + cy; }
        else { nx = x2 - y2 + cx; ny = ((zx * zy) >> S1) + cy; }
        zx = nx; zy = ny;
    }
    if (len < 2) { // mindestens Z_0, Z_1 (Schleifen im Pixelcode lesen Z_{m+1})
        const o2 = new Float64Array(4); o2[0] = out[0]; o2[1] = out[1]; o2[2] = out[0]; o2[3] = out[1];
        return { data: o2, len: 2, escaped };
    }
    return { data: out.subarray(0, 2 * len), len, escaped };
}

// Kugel-Periodenerkennung entlang des Mittelpunkt-Orbits (Mandelbrot/z³)
function ballPeriod(orbit, len, formula, rc) {
    let r = 0;
    for (let n = 0; n < len - 1; n++) {
        const mz = Math.hypot(orbit[2 * n], orbit[2 * n + 1]);
        if (formula === 4) r = 3 * mz * mz * r + 3 * mz * r * r + r * r * r + rc;
        else r = 2 * mz * r + r * r + rc;
        const m1 = Math.hypot(orbit[2 * n + 2], orbit[2 * n + 3]);
        if (m1 < r) return n + 1;
        if (!(r < 1e3)) return 0;
    }
    return 0;
}

// Newton für den Kern (Nukleus) der Periode p, gerechnet per f64-Perturbation am Orbit ref
// (relativ zum Referenzpunkt). Rückgabe dc des Kerns oder null.
function newtonNucleusPerturb(ref, period, formula, tol, maxSteps) {
    let ex = 0, ey = 0;
    for (let it = 0; it < maxSteps; it++) {
        // z_p(c) und dz_p/dc über Perturbation (mit Rebase)
        const O = ref.orbit;
        let m = 0, dzx = 0, dzy = 0, dx = 0, dy = 0, zx = 0, zy = 0;
        for (let n = 0; n < period; n++) {
            const X = O[2 * m], Y = O[2 * m + 1];
            const fx = X + dzx, fy = Y + dzy;   // volles z_n
            if (formula === 4) {
                const ax = 3 * (fx * fx - fy * fy), ay = 6 * fx * fy;
                const ndx = ax * dx - ay * dy + 1, ndy = ax * dy + ay * dx; dx = ndx; dy = ndy;
                const tx = 3 * (X * X - Y * Y) + 3 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy;
                const ty = 6 * X * Y + 3 * (X * dzy + Y * dzx) + 2 * dzx * dzy;
                const nx = dzx * tx - dzy * ty + ex, ny = dzx * ty + dzy * tx + ey; dzx = nx; dzy = ny;
            } else {
                const ndx = 2 * (fx * dx - fy * dy) + 1, ndy = 2 * (fx * dy + fy * dx); dx = ndx; dy = ndy;
                const nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + ex;
                const ny = 2 * (X * dzy + Y * dzx) + 2 * dzx * dzy + ey; dzx = nx; dzy = ny;
            }
            m++;
            zx = O[2 * m] + dzx; zy = O[2 * m + 1] + dzy;
            if (!(zx * zx + zy * zy < 1e10) || !(Math.abs(dx) < 1e290)) return null;
            if (m >= ref.lenA - 1 || lessMag(zx, zy, dzx, dzy)) { dzx = zx; dzy = zy; m = 0; }
        }
        // Newton-Schritt: e -= z_p / (dz_p/dc), skaliert gegen Überlauf
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        if (s === 0) return null;
        const ux = dx / s, uy = dy / s, d2 = ux * ux + uy * uy;
        const qx = ((zx * ux + zy * uy) / d2) / s, qy = ((zy * ux - zx * uy) / d2) / s;
        ex -= qx; ey -= qy;
        if (!isFinite(ex) || !isFinite(ey)) return null;
        if (Math.hypot(qx, qy) < tol) return { ex, ey, steps: it + 1, dmag: Math.hypot(dx, dy) };
    }
    return null;
}

// Gitter-Probe: Punkt mit längstem Orbit in der Ansicht suchen (f64-Perturbation, ohne BLA)
function gridProbe(ref, maxIter, halfW, halfH, G) {
    let best = { it: -1, ex: 0, ey: 0, d: Infinity };
    for (let j = 0; j < G; j++) {
        for (let i = 0; i < G; i++) {
            const ex = ((i + 0.5) / G * 2 - 1) * halfW, ey = ((j + 0.5) / G * 2 - 1) * halfH;
            let v = perturbPixel(ex, ey, ref, maxIter, false);
            const it = v < 0 ? maxIter + 1 : v;
            const d = ex * ex + ey * ey;
            if (it > best.it + 1e-9 || (Math.abs(it - best.it) < 1e-9 && d < best.d)) best = { it, ex, ey, d };
        }
    }
    return best;
}

// ------------------------------------------------------------------
//  Referenzwahl + Orbits + BLA. Eingabe: HP-Strings (BigInt-Dezimal mit P Bits).
//  Liefert f64-Referenz (für CPU) + Metadaten; GPU-Packen macht packRefF32().
// ------------------------------------------------------------------
function precisionFor(zoom) {
    const b = Math.ceil(Math.log2(Math.max(1, zoom))) + 96;
    return Math.min(HP.P, Math.max(128, Math.ceil(b / 32) * 32));
}

function computeReference(req) {
    const t0 = Date.now();
    const formula = req.formula;
    const pw = precisionFor(req.zoom);
    const cX = HP.toPrecision(BigInt(req.cx), pw), cY = HP.toPrecision(BigInt(req.cy), pw);
    const jX = HP.toPrecision(BigInt(req.jx || '0'), pw), jY = HP.toPrecision(BigInt(req.jy || '0'), pw);
    const maxIter = req.maxIter;
    const halfW = req.halfW, halfH = req.halfH;
    const rc = Math.hypot(halfW, halfH);
    const julia = formula === 1;
    const fromF = (x) => HP.roundShift(HP.fromNumber(x), HP.P - pw);

    let method = 'center', period = 0;
    let rX = cX, rY = cY;
    let A = julia ? hpOrbit(1, cX, cY, jX, jY, pw, maxIter) : hpOrbit(formula, 0n, 0n, cX, cY, pw, maxIter);
    let B = julia ? hpOrbit(1, 0n, 0n, jX, jY, pw, maxIter) : null;
    const mk = (Aorb, Borb) => ({
        formula, orbit: Borb ? concat(Aorb.data, Borb.data) : Aorb.data,
        baseA: 0, lenA: Aorb.len, baseB: Borb ? Aorb.len : 0, lenB: Borb ? Borb.len : Aorb.len, bla: null
    });
    let ref = mk(A, B);

    if (A.len < maxIter + 1) {
        let done = false;
        // 1) Minibrot-Kern per Kugel-Periode + Newton (holomorphe Mandelbrot-Formeln)
        if (formula === 0 || formula === 4) {
            const p = ballPeriod(A.data, A.len, formula, rc);
            if (p > 1 && p <= maxIter) {
                const tol = Math.max(1e-300, (req.pixel || rc * 1e-3) * 1e-7);
                const nu = newtonNucleusPerturb(ref, p, formula, tol, 64);
                if (nu && Math.hypot(nu.ex, nu.ey) < 64 * rc) {   // Kern darf ausserhalb liegen (f32-Fehler < 0.002 px)
                    const nX = cX + fromF(nu.ex), nY = cY + fromF(nu.ey);
                    const orb = hpOrbit(formula, 0n, 0n, nX, nY, pw, p);
                    // Kern: Z_p ~ 0 -> exakt 0 setzen, Pixel wickeln bei m = p auf m = 0 um
                    if (orb.len === p + 1 && !orb.escaped) {
                        const zp = Math.hypot(orb.data[2 * p], orb.data[2 * p + 1]);
                        const pix = req.pixel || rc * 1e-3;
                        if (zp < 1e-4 * nu.dmag * pix) {
                            orb.data[2 * p] = 0; orb.data[2 * p + 1] = 0;
                            A = orb; rX = nX; rY = nY; method = 'nucleus'; period = p; done = true;
                            ref = mk(A, null);
                        }
                    }
                }
            }
        }
        // 2) Gitter-Probe: längster Orbit in der Ansicht
        if (!done) {
            const best = gridProbe(ref, maxIter, halfW, halfH, req.grid || 16);
            if (best.it > A.len) {
                const nX = cX + fromF(best.ex), nY = cY + fromF(best.ey);
                const orb = julia ? hpOrbit(1, nX, nY, jX, jY, pw, maxIter) : hpOrbit(formula, 0n, 0n, nX, nY, pw, maxIter);
                if (orb.len > A.len) { A = orb; rX = nX; rY = nY; method = 'grid'; ref = mk(A, B); }
            }
        }
    }

    // Referenzpunkt zurück auf globale Präzision (für Offsets auf dem Main-Thread)
    const refX = (rX << BigInt(HP.P - pw)).toString(), refY = (rY << BigInt(HP.P - pw)).toString();
    const ms = Date.now() - t0;
    return { ref, refX, refY, pw, method, period, ms, maxIter };
}

function concat(a, b) { const r = new Float64Array(a.length + b.length); r.set(a, 0); r.set(b, a.length); return r; }

// BLA-Tabellen für eine Referenz bauen (cmax = max |dc| über die Ansicht)
function blaFor(ref, eps, cmax, asF32) {
    if (ref.formula !== 0 && ref.formula !== 1 && ref.formula !== 4) return null;
    const julia = ref.formula === 1;
    const tA = buildBLA(ref.orbit, ref.baseA, ref.lenA, ref.formula, eps, julia ? 0 : cmax);
    const tB = julia ? buildBLA(ref.orbit, ref.baseB, ref.lenB, 1, eps, 0) : null;
    return packBLA(tA, tB, !julia, asF32);
}

root.FKCore = { BAIL, MAXL, ctz, smoothIter, lessMag, directPixel, newtonPixel, perturbPixel, diffabs,
                buildBLA, packBLA, blaFor, hpOrbit, ballPeriod, newtonNucleusPerturb, gridProbe,
                computeReference, precisionFor, makeToF };
})(typeof self !== 'undefined' ? self : globalThis);
