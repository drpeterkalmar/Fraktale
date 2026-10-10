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

// 6.1 Distanzschätzung: Code wie im GPU-Shader (encDE): (log2(DE in Pixeln) + 8)·16, 1..255, 0 = keine.
// Die Pixel-Funktionen legen ihn in OUT.de ab, wenn sie mit deS > 0 (Welt pro Pixel) aufgerufen werden.
// Ableitung Dp = dz/dPixel; dex = log2-Versatz gegen Überlauf.
const OUT = { de: 0, acc: 0 };
function encDE(zx, zy, dx, dy, dex) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (!(m < Infinity)) return 1;
    if (m === 0) return 255;
    const r = Math.sqrt(zx * zx + zy * zy);
    const e = (Math.log2(r * Math.log(r)) - Math.log2(m) - 0.5 * Math.log2((dx / m) * (dx / m) + (dy / m) * (dy / m)) - dex + 8) * 16;
    return Math.max(1, Math.min(255, Math.floor(e + 0.5)));
}
const TWO_M512 = Math.pow(2, -512), TWO_512 = Math.pow(2, 512);

// ------------------------------------------------------------------
//  7.1 Färbe-Stile (wie STYLE_CORE in shaders.js): Wert der Bahn neben der glatten Iteration, Ausgabe 16 bit in OUT.acc.
//  stSetup() einmal je Kachel (st = 0: aus – Nachrechnung, Referenzsuche), die Pixel-Funktionen starten je Pixel neu.
//  Stile: 1 Streifen, 2 Dreieck-Mittel, 3 Punkt-, 4 Kreis-, 5 Kreuz-Falle, 6 Pickover-Stängel. Gleitendes Mittel über
//  die letzten K Schritte bzw. vergessendes Minimum (tiefenfest); BLA-Sprünge als Näherung (siehe shaders.js).
// ------------------------------------------------------------------
const STA = { st: 0, s: 5, r: 1, K: 24, F: 0.32, FF: Math.pow(2, 0.32), cabsRef: 0, cabs: 0, P: 2, a: 0, ap: 0, n: 0 };
// stp = [Streifendichte, Kreisradius, Fenster K, Vergessen F] (wie u_stp im Shader)
function stSetup(st, stp, cabsRef) { STA.st = st | 0; STA.s = stp ? +stp[0] : 5; STA.r = stp ? +stp[1] : 1; STA.K = stp && stp[2] ? +stp[2] : 24; STA.F = stp && stp[3] ? +stp[3] : 0.32; STA.FF = Math.pow(2, STA.F); STA.cabsRef = +cabsRef || 0; }
// (Fallen hier linear: a = min(a·2^(F·L), d) – dasselbe wie im Shader in log2, ohne log2 je Schritt; erst stEnc logarithmiert)
function stStart(formula, cabs) { STA.P = formula === 4 ? 3 : 2; STA.cabs = cabs; STA.a = STA.ap = STA.st >= 3 ? 1024 : 0; STA.n = 0; }
// z = neuer Wert, p = Wert davor, L = Schritte (BLA-Sprung)
function stAdd(zx, zy, px, py, L) {
    const A = STA;
    A.ap = A.a;
    if (A.st >= 3) {
        const d = A.st === 3 ? Math.sqrt(zx * zx + zy * zy) : A.st === 4 ? Math.abs(Math.sqrt(zx * zx + zy * zy) - A.r) : Math.min(Math.abs(zx), Math.abs(zy));
        A.a = Math.min(L === 1 ? A.a * A.FF : A.a * Math.pow(2, A.F * L), Math.max(d, 1e-30));
        A.n += L;
        return;
    }
    let x;
    if (A.st === 1) {
        // sin(s·arg z) = Im((z/|z|)^s) für ganzzahliges s – Potenz durch Quadrieren statt atan2 + sin (CPU ~5× schneller)
        const r = Math.sqrt(zx * zx + zy * zy);
        let ux = r > 0 ? zx / r : 1, uy = r > 0 ? zy / r : 0, wx = 1, wy = 0, k = A.s;
        while (k > 0) {
            if (k & 1) { const t = wx * ux - wy * uy; wy = wx * uy + wy * ux; wx = t; }
            k >>= 1;
            if (k) { const t = ux * ux - uy * uy; uy = 2 * ux * uy; ux = t; }
        }
        x = 0.5 + 0.5 * wy;
    }
    else {
        if (L > 1.5) { A.n += L; return; }
        const r = Math.pow(Math.max(Math.sqrt(px * px + py * py), 1e-30), A.P);
        const lo = Math.abs(r - A.cabs), hi = r + A.cabs;
        x = hi - lo > 1e-30 ? Math.min(1, Math.max(0, (Math.sqrt(zx * zx + zy * zy) - lo) / (hi - lo))) : 0.5;
    }
    A.n += L;
    const w = 1 / Math.min(A.n, A.K);
    A.a += (x - A.a) * (L > 1.5 ? 1 - Math.pow(1 - w, L) : w);
}
function stEnc(zx, zy) {
    const l2 = 0.5 * Math.log2(zx * zx + zy * zy);
    const t = Math.min(1, Math.max(0, 1 - Math.log(Math.max(l2, 4) * 0.25) / Math.log(STA.P)));
    let v;
    if (STA.st >= 3) { const la = Math.log2(STA.a), lp = Math.log2(STA.ap); v = (lp + (la - lp) * t + 24) / 32; }
    else v = STA.ap + (STA.a - STA.ap) * t;
    return Math.round(Math.min(1, Math.max(0, v)) * 65535);
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
//  6.4 Bunte Menge: Innen-Information (wie GPU, INNER_CORE in shaders.js). Innenpunkte laufen nach maxIter weiter,
//  bis der anziehende Zyklus gefunden ist (Brent + Bestätigung über eine Periode); Ergebnis als Float im Bereich
//  (−1,5; −1,0] mit Klasse (Bits 12..21) und Wert (Bits 0..11). −1 = unbekannt (wie ohne Bunt).
// ------------------------------------------------------------------
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
function innerVal(cls, val) {
    if (!(cls > 0)) return -1;
    const q = Math.round(Math.min(1, Math.max(0, val)) * 4095);
    _u32[0] = (0xBF800000 | ((((cls - 1) % 1023) + 1) << 12) | q) >>> 0;
    return _f32[0];
}
// Zyklussuche; step(): ein Schritt, liefert false bei Flucht, sonst steht das neue z in S.zx/S.zy
// (S.zx/S.zy = Startwert z_n0). deriv(zx, zy) = log2|f'(z)|.
function cycleInfo(S, n0, julia, f, step, trap) {
    // wie GPU (inStep in shaders.js): Besuche beim Bahnpunkt mit kleinstem |z|, drei gleiche Abstände = Periode
    const E = Math.min(16384, Math.max(4096, n0));
    const L3 = Math.log2(3);
    let wx = S.zx, wy = S.zy, hitN = 0, per = 0, cnt = 0, ls = 0, cand = 0, candL = 0, candN = 0, n = n0;
    const result = (P, l, nh) => julia ? innerVal(nh % P + 1, -Math.log2(Math.max(trap, 1e-38)) / 64) : innerVal(P, Math.pow(2, Math.min(l, 0)));
    for (let k = 0; k < E; k++) {
        const px = S.zx, py = S.zy;
        const st = step();
        if (st === 0) return -1;                    // entkommen: doch nicht innen
        if (st === 2) break;                        // Ende des Referenzorbits: mit dem bisherigen Kandidaten auswerten
        n++;
        const a = px * px + py * py;
        ls += f === 4 ? L3 + Math.log2(Math.max(a, 1e-300)) : 1 + 0.5 * Math.log2(Math.max(a, 1e-300));
        const z2 = S.zx * S.zx + S.zy * S.zy, w2 = wx * wx + wy * wy;
        const dx = S.zx - wx, dy = S.zy - wy;
        const rec = z2 < w2;
        if (!rec && dx * dx + dy * dy >= 0.25 * w2) continue;
        if (rec) { wx = S.zx; wy = S.zy; }
        if (hitN > 0) {
            const dn = n - hitN;
            if (dn === per) cnt++; else { per = dn; cnt = 1; }
            if (cnt >= 2) {
                if (ls < -0.32193) return result(per, ls, n);
                cand = per; candL = ls; candN = n;
            }
        }
        hitN = n; ls = 0;
    }
    return cand > 0 && n - candN <= 2 * cand + 2 ? result(cand, candL, candN) : -1;
}
function innerDirect(zx, zy, cx, cy, formula, maxIter, trap) {
    const S = { zx, zy };
    return cycleInfo(S, maxIter, formula === 1, formula, () => {
        const x = S.zx, y = S.zy;
        let nx, ny;
        if (formula === 2) { nx = x * x - y * y + cx; ny = Math.abs(2 * x * y) + cy; }
        else if (formula === 3) { nx = x * x - y * y + cx; ny = -2 * x * y + cy; }
        else if (formula === 4) { const x2 = x * x, y2 = y * y; nx = x * (x2 - 3 * y2) + cx; ny = y * (3 * x2 - y2) + cy; }
        else if (formula === 20) { nx = Math.abs(x * x - y * y) + cx; ny = 2 * x * y + cy; }
        else if (formula === 21) { nx = x * x - y * y + cx; ny = -2 * Math.abs(x) * y + cy; }
        else if (formula === 22) { nx = Math.abs(x * x - y * y) + cx; ny = Math.abs(2 * x * y) + cy; }
        else { nx = x * x - y * y + cx; ny = 2 * x * y + cy; }
        S.zx = nx; S.zy = ny;
        return nx * nx + ny * ny <= BAIL ? 1 : 0;
    }, trap);
}
// Perturbation ohne BLA ab dem Zustand nach maxIter (Orbit-Index m auf base/len, Rebase wie in perturbPixel)
function innerPerturb(ref, f, dzx, dzy, cx, cy, m, o, n, trap) {
    const O = ref.orbit;
    let base = o ? ref.baseB : ref.baseA, len = o ? ref.lenB : ref.lenA;
    const S = { zx: O[2 * (base + m)] + dzx, zy: O[2 * (base + m) + 1] + dzy };
    return cycleInfo(S, n, f === 1, f, () => {
        const i2 = 2 * (base + m), X = O[i2], Y = O[i2 + 1];
        let nx, ny;
        if (f === 2) {
            nx = (2 * X + dzx) * dzx - (2 * Y + dzy) * dzy + cx;
            ny = 2 * diffabs(X * Y, X * dzy + Y * dzx + dzx * dzy) + cy;
        } else if (f === 3) {
            nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + cx;
            ny = -(2 * (X * dzy + Y * dzx) + 2 * dzx * dzy) + cy;
        } else if (f === 4) {
            const tx = 3 * (X * X - Y * Y) + 3 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy;
            const ty = 6 * X * Y + 3 * (X * dzy + Y * dzx) + 2 * dzx * dzy;
            nx = dzx * tx - dzy * ty + cx;
            ny = dzx * ty + dzy * tx + cy;
        } else if (f >= 20) {
            const d = pstepBS(f, X, Y, dzx, dzy); nx = d[0] + cx; ny = d[1] + cy;
        } else {
            nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + cx;
            ny = 2 * (X * dzy + Y * dzx) + 2 * dzx * dzy + cy;
        }
        dzx = nx; dzy = ny; m++;
        const j2 = 2 * (base + m);
        const zx = O[j2] + dzx, zy = O[j2 + 1] + dzy;
        S.zx = zx; S.zy = zy;
        if (zx * zx + zy * zy > BAIL) return 0;
        if (m >= len - 1) return 2;
        if (lessMag(zx, zy, dzx, dzy)) { base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0; }
        return 1;
    }, trap);
}

// ------------------------------------------------------------------
//  Direkte f64-Iteration (flache Zooms, Newton, Tricorn/Burning Ship bis 1e12)
// ------------------------------------------------------------------
function directPixel(px, py, formula, maxIter, jx, jy, deS, inn) {
    OUT.de = 0; OUT.acc = 0;
    if (formula === 5) return newtonPixel(px, py);
    if (formula >= 23) return exoticPixel(formula, px, py, maxIter, deS);
    let zx, zy, cx, cy;
    let dx = formula === 1 ? (deS || 0) : 0, dy = 0, dex = 0;
    if (formula === 1) { zx = px; zy = py; cx = jx; cy = jy;
        if (zx * zx + zy * zy > BAIL) { if (deS) OUT.de = encDE(zx, zy, dx, dy, 0); return smoothIter(0, zx, zy, 1); }
    } else { zx = 0; zy = 0; cx = px; cy = py; }
    let trap = zx * zx + zy * zy;
    const jt = inn && formula === 1;
    const st = STA.st;
    if (st) stStart(formula, Math.sqrt(cx * cx + cy * cy));
    for (let n = 1; n <= maxIter; n++) {
        const qx = zx, qy = zy;
        if (deS) {   // Dp' = f'(z)·Dp (+ Pixelschritt); Burning Ship/Tricorn: Betrag wie holomorph (wie GPU)
            let ax, ay;
            if (formula === 4) { ax = 3 * (zx * zx - zy * zy); ay = 6 * zx * zy; } else { ax = 2 * zx; ay = 2 * zy; }
            const ndx = ax * dx - ay * dy + (formula === 1 ? 0 : deS), ndy = ax * dy + ay * dx;
            dx = ndx; dy = ndy;
            if (Math.abs(dx) > TWO_512 || Math.abs(dy) > TWO_512) { dx *= TWO_M512; dy *= TWO_M512; dex += 512; }
        }
        let nx, ny;
        if (formula === 2) { nx = zx * zx - zy * zy + cx; ny = Math.abs(2 * zx * zy) + cy; }
        else if (formula === 3) { nx = zx * zx - zy * zy + cx; ny = -2 * zx * zy + cy; }
        else if (formula === 4) { const x2 = zx * zx, y2 = zy * zy; nx = zx * (x2 - 3 * y2) + cx; ny = zy * (3 * x2 - y2) + cy; }
        else if (formula === 20) { nx = Math.abs(zx * zx - zy * zy) + cx; ny = 2 * zx * zy + cy; }
        else if (formula === 21) { nx = zx * zx - zy * zy + cx; ny = -2 * Math.abs(zx) * zy + cy; }
        else if (formula === 22) { nx = Math.abs(zx * zx - zy * zy) + cx; ny = Math.abs(2 * zx * zy) + cy; }
        else { nx = zx * zx - zy * zy + cx; ny = 2 * zx * zy + cy; }
        zx = nx; zy = ny;
        if (st) stAdd(zx, zy, qx, qy, 1);
        if (zx * zx + zy * zy > BAIL) { if (deS) OUT.de = encDE(zx, zy, dx, dy, dex); if (st) OUT.acc = stEnc(zx, zy); return smoothIter(n, zx, zy, formula); }
        if (jt) trap = Math.min(trap, zx * zx + zy * zy);
    }
    return inn ? innerDirect(zx, zy, cx, cy, formula, maxIter, trap) : -1;
}

// ------------------------------------------------------------------
//  7.1 Welt-Parameter der Exoten (wie die Uniforms u_xp, u_xq, u_xi, Newton-Polynom u_pc/u_root im Shader).
//  xpSetup() einmal je Kachel (tile-worker.js); X = { xp: [4], xq: [4], xi: [4], poly: { c: [c0…c8], deg, roots: [[x, y]…] } }
// ------------------------------------------------------------------
const XP = { xp: [2, 0, 0, 0], xq: [0, 0, 0, 0], xi: [0, 1, 0, 0], poly: null };
function xpSetup(X) { if (!X) return; XP.xp = X.xp || XP.xp; XP.xq = X.xq || XP.xq; XP.xi = X.xi || XP.xi; XP.poly = X.poly || null; }
// Newton-Polynome (reelle Koeffizienten c0 … c_deg) – dieselbe Liste wie die Auswahl in der App
const NEWTON_POLYS = [
    { id: 'z3', c: [-1, 0, 0, 1] },                          // z³ − 1
    { id: 'z4', c: [-1, 0, 0, 0, 1] },                       // z⁴ − 1
    { id: 'z5', c: [-1, 0, 0, 0, 0, 1] },                    // z⁵ − 1
    { id: 'z3m2z', c: [2, -2, 0, 1] },                       // z³ − 2z + 2 (anziehender 2-Zyklus: schwarze Inseln)
    { id: 'z6z3', c: [-1, 0, 0, 1, 0, 0, 1] },               // z⁶ + z³ − 1
    { id: 'z8', c: [-16, 0, 0, 0, 15, 0, 0, 0, 1] },         // z⁸ + 15z⁴ − 16
];
// Nullstellen eines Polynoms (Durand–Kerner, f64) – für Wurzelfarben und den Konvergenztest
function polyRoots(c) {
    const n = c.length - 1, a = c.map(v => v / c[n]);
    let r = [];
    for (let k = 0; k < n; k++) { const t = 2 * Math.PI * k / n + 0.4; r.push([0.9 * Math.cos(t), 0.9 * Math.sin(t)]); }
    const ev = (x, y) => { let px = 1, py = 0; for (let k = n - 1; k >= 0; k--) { const t = px * x - py * y + a[k]; py = px * y + py * x; px = t; } return [px, py]; };
    for (let it = 0; it < 500; it++) {
        let moved = 0;
        r = r.map(([x, y], i) => {
            let [px, py] = ev(x, y), dx = 1, dy = 0;
            for (let j = 0; j < n; j++) if (j !== i) { const ux = x - r[j][0], uy = y - r[j][1]; const t = dx * ux - dy * uy; dy = dx * uy + dy * ux; dx = t; }
            const d2 = dx * dx + dy * dy || 1e-300;
            const qx = (px * dx + py * dy) / d2, qy = (py * dx - px * dy) / d2;
            moved = Math.max(moved, Math.hypot(qx, qy));
            return [x - qx, y - qy];
        });
        if (moved < 1e-15) break;
    }
    return r.map(([x, y]) => [Math.abs(x) < 1e-13 ? 0 : x, Math.abs(y) < 1e-13 ? 0 : y]).sort((u, v) => Math.atan2(u[1], u[0]) - Math.atan2(v[1], v[0]));
}
function newtonPoly(i) { const P = NEWTON_POLYS[i] || NEWTON_POLYS[0]; return { c: P.c.slice(), deg: P.c.length - 1, roots: polyRoots(P.c) }; }
const POLY0 = newtonPoly(0);

// Newton (wie GPU-Shader newton()): Wurzelindex·1000 + glatte Konvergenzzahl, −1 ohne Konvergenz
function newtonPixel(x, y) {
    const P = XP.poly || POLY0, c = P.c, deg = P.deg, R = P.roots;
    let ep = 1e30;
    for (let j = 0; j < 120; j++) {
        let px = c[deg], py = 0, dx = 0, dy = 0;
        for (let k = deg - 1; k >= 0; k--) {
            const tx = dx * x - dy * y + px; dy = dx * y + dy * x + py; dx = tx;
            const ux = px * x - py * y + c[k]; py = px * y + py * x; px = ux;
        }
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-30) break;
        x -= (px * dx + py * dy) / d2;
        y -= (py * dx - px * dy) / d2;
        let best = 1e30, bi = 0;
        for (let r = 0; r < R.length; r++) { const ax = x - R[r][0], ay = y - R[r][1], e = ax * ax + ay * ay; if (e < best) { best = e; bi = r; } }
        const e = Math.sqrt(best);
        if (e < 1e-3) {
            const f = ep < 1e29 && ep > e ? Math.min(1, Math.max(0, Math.log(1e-3 / Math.max(e, 1e-300)) / Math.log(ep / Math.max(e, 1e-300)))) : 0;
            return bi * 1000 + Math.min(j + 1 - f, 998);
        }
        ep = e;
    }
    return -1;
}

// ------------------------------------------------------------------
//  7.1 Exoten (f64, wie exoticFS in shaders.js): 23 Multibrot z^P, 24 Phoenix, 25 Nova, 26/27 Magnet I/II, 28 Lyapunov
// ------------------------------------------------------------------
const LN1E4 = Math.log(1e4);
// Distanz aus dem Gradienten der glatten Konvergenzzahl (wie encMu im Shader): gn/gp = d ln(Abstand)/dPixel (komplex)
function deMu(A, B, gnx, gny, gpx, gpy, dex) {
    if (!(B > 1e-6)) return 255;
    const Gx = gnx * B + A * (gpx - gnx), Gy = gny * B + A * (gpy - gny), m = Math.hypot(Gx, Gy);
    if (!(m < Infinity)) return 1;
    if (m === 0) return 255;
    const l = Math.log2(B * B / Math.LN2) - Math.log2(m) - dex;
    return Math.max(1, Math.min(255, Math.floor((l + 8) * 16 + 0.5)));
}
const cdivx = (ax, ay, bx, by) => { const d = bx * bx + by * by; return d > 0 ? [(ax * bx + ay * by) / d, (ay * bx - ax * by) / d] : [0, 0]; };
function dePx(d) { if (!(d < Infinity)) return 255; if (!(d > 0)) return 1; return Math.max(1, Math.min(255, Math.floor((Math.log2(d) + 8) * 16 + 0.5))); }
function exoticPixel(F, px, py, maxIter, deS) {
    const X = XP.xp, st = STA.st;
    let dex = 0;
    if (F === 23) {
        const P = X[0], lnP = Math.log(P);
        let zx = 0, zy = 0, Dx = 0, Dy = 0;
        if (st) stStart(0, Math.sqrt(px * px + py * py));
        if (st) STA.P = P;
        for (let n = 1; n <= maxIter; n++) {
            const qx = zx, qy = zy, r2 = zx * zx + zy * zy;
            let ax = 0, ay = 0;
            if (r2 > 0) { const a = (P - 1) * Math.atan2(zy, zx), rp = Math.pow(r2, 0.5 * (P - 1)); ax = rp * Math.cos(a); ay = rp * Math.sin(a); }
            if (deS) { const tx = P * (ax * Dx - ay * Dy) + deS; Dy = P * (ax * Dy + ay * Dx); Dx = tx; if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; dex += 512; } }
            const nx = ax * zx - ay * zy + px; zy = ax * zy + ay * zx + py; zx = nx;
            if (st) stAdd(zx, zy, qx, qy, 1);
            if (zx * zx + zy * zy > BAIL) {
                if (deS) OUT.de = encDE(zx, zy, Dx, Dy, dex);
                if (st) OUT.acc = stEnc(zx, zy);
                return n + 1 - Math.log(0.5 * Math.log2(zx * zx + zy * zy)) / lnP;
            }
        }
        return -1;
    }
    if (F === 24) {
        const mand = XP.xq[0] > 0.5;
        const cx = mand ? px : X[0], cy = mand ? py : X[1], pkx = X[2], pky = X[3];
        let zx = mand ? 0 : -py, zy = mand ? 0 : px, ox = 0, oy = 0;      // Julia-Art um 90° gedreht (wie GPU)
        let Dx = 0, Dy = mand ? 0 : deS, Ox = 0, Oy = 0;
        if (st) stStart(0, Math.sqrt(cx * cx + cy * cy));
        if (zx * zx + zy * zy > BAIL) { if (deS) OUT.de = encDE(zx, zy, Dx, Dy, 0); return Math.max(3 - Math.log2(0.5 * Math.log2(zx * zx + zy * zy)), 0); }
        for (let n = 1; n <= maxIter; n++) {
            const qx = zx, qy = zy;
            if (deS) {
                let nx = 2 * (zx * Dx - zy * Dy) + pkx * Ox - pky * Oy, ny = 2 * (zx * Dy + zy * Dx) + pkx * Oy + pky * Ox;
                if (mand) nx += deS;
                Ox = Dx; Oy = Dy; Dx = nx; Dy = ny;
                if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; Ox *= TWO_M512; Oy *= TWO_M512; dex += 512; }
            }
            const nx = zx * zx - zy * zy + cx + pkx * ox - pky * oy, ny = 2 * zx * zy + cy + pkx * oy + pky * ox;
            ox = zx; oy = zy; zx = nx; zy = ny;
            if (st) stAdd(zx, zy, qx, qy, 1);
            if (zx * zx + zy * zy > BAIL) {
                if (deS) OUT.de = encDE(zx, zy, Dx, Dy, dex);
                if (st) OUT.acc = stEnc(zx, zy);
                return n + 3 - Math.log2(0.5 * Math.log2(zx * zx + zy * zy));
            }
        }
        return -1;
    }
    if (F === 25) {
        const R = X[0], jul = X[3] > 0.5;
        const cx = jul ? X[1] : px, cy = jul ? X[2] : py;
        let zx = jul ? px : 1, zy = jul ? py : 0, Dx = jul ? deS : 0, Dy = 0, ep = 1e30;
        let Px = Dx, Py = Dy, wpx = 0, wpy = 0, dwx = 0, dwy = 0;      // D davor, letzter Schritt und seine Ableitung
        const EPS = 1e-4;
        for (let n = 1; n <= maxIter; n++) {
            const z2x = zx * zx - zy * zy, z2y = 2 * zx * zy;
            const z3x = z2x * zx - z2y * zy, z3y = z2x * zy + z2y * zx;
            const wx = z3x - 1, wy = z3y;
            const m2 = z2x * z2x + z2y * z2y;
            if (m2 < 1e-30) break;
            if (deS) {   // N'(z) = 1 − R + R·2(z³ − 1)/(3z³)
                const m3 = z3x * z3x + z3y * z3y;
                const gx = 1 - R + R * 2 * (wx * z3x + wy * z3y) / (3 * m3), gy = R * 2 * (wy * z3x - wx * z3y) / (3 * m3);
                let nx = gx * Dx - gy * Dy, ny = gx * Dy + gy * Dx;
                if (!jul) nx += deS;
                Px = Dx; Py = Dy; Dx = nx; Dy = ny;
                if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; Px *= TWO_M512; Py *= TWO_M512; dwx *= TWO_M512; dwy *= TWO_M512; dex += 512; }
            }
            // z − R·w/(3z²) + c
            const qx = (wx * z2x + wy * z2y) / (3 * m2), qy = (wy * z2x - wx * z2y) / (3 * m2);
            const nx = zx - R * qx + cx, ny = zy - R * qy + cy;
            const wsx = nx - zx, wsy = ny - zy, e = Math.hypot(wsx, wsy);
            zx = nx; zy = ny;
            if (!(zx * zx + zy * zy < 1e20)) break;
            if (e < EPS) {
                const A = Math.log(EPS / Math.max(e, 1e-300)), B = ep < 1e29 ? Math.log(ep / Math.max(e, 1e-300)) : 0;
                const f = B > 0 ? Math.min(1, Math.max(0, A / B)) : 0;
                if (deS) { const gn = cdivx(Dx - Px, Dy - Py, wsx, wsy), gp = cdivx(dwx, dwy, wpx, wpy); OUT.de = deMu(A, B, gn[0], gn[1], gp[0], gp[1], dex); }
                return 12 * Math.log2(1 + Math.max(n - f, 0) / 12);
            }
            ep = e;
            if (deS) { wpx = wsx; wpy = wsy; dwx = Dx - Px; dwy = Dy - Py; }
        }
        return -1;
    }
    if (F === 26 || F === 27) {
        const cx = px, cy = py, c1x = cx - 1, c1y = cy, c2x = cx - 2, c2y = cy;
        let zx = 0, zy = 0, Dx = 0, Dy = 0, ep = 1e30, Px = 0, Py = 0, z1x = -1, z1y = 0;
        const EPS = 1e-4;
        if (st) stStart(0, Math.sqrt(cx * cx + cy * cy));
        const mul = (ax, ay, bx, by) => [ax * bx - ay * by, ax * by + ay * bx];
        const div = (ax, ay, bx, by) => { const d = bx * bx + by * by; return [(ax * bx + ay * by) / d, (ay * bx - ax * by) / d]; };
        for (let n = 1; n <= maxIter; n++) {
            const qx0 = zx, qy0 = zy;
            let A, B, Az, Bz, Ac;
            if (F === 26) {
                A = [zx * zx - zy * zy + c1x, 2 * zx * zy + c1y]; B = [2 * zx + c2x, 2 * zy + c2y];
                Az = [2 * zx, 2 * zy]; Bz = [2, 0]; Ac = [1, 0];
            } else {
                const cc = mul(c1x, c1y, c2x, c2y), z2 = mul(zx, zy, zx, zy), z3 = mul(z2[0], z2[1], zx, zy);
                const c1z = mul(c1x, c1y, zx, zy), c2z = mul(c2x, c2y, zx, zy);
                A = [z3[0] + 3 * c1z[0] + cc[0], z3[1] + 3 * c1z[1] + cc[1]];
                B = [3 * z2[0] + 3 * c2z[0] + cc[0] + 1, 3 * z2[1] + 3 * c2z[1] + cc[1]];
                Az = [3 * z2[0] + 3 * c1x, 3 * z2[1] + 3 * c1y]; Bz = [6 * zx + 3 * c2x, 6 * zy + 3 * c2y]; Ac = [3 * zx + 2 * cx - 3, 3 * zy + 2 * cy];
            }
            if (B[0] * B[0] + B[1] * B[1] < 1e-30) break;
            const q = div(A[0], A[1], B[0], B[1]);
            if (deS) {
                const B2 = mul(B[0], B[1], B[0], B[1]);
                const t1 = mul(Az[0], Az[1], B[0], B[1]), t2 = mul(A[0], A[1], Bz[0], Bz[1]);
                const qz = div(t1[0] - t2[0], t1[1] - t2[1], B2[0], B2[1]);
                const t3 = mul(Ac[0], Ac[1], B[0] - A[0], B[1] - A[1]);
                const qc = div(t3[0], t3[1], B2[0], B2[1]);
                const u = mul(qz[0], qz[1], Dx, Dy);
                const v = mul(q[0], q[1], u[0] + qc[0] * deS, u[1] + qc[1] * deS);
                Px = Dx; Py = Dy;
                Dx = 2 * v[0]; Dy = 2 * v[1];
                if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; Px *= TWO_M512; Py *= TWO_M512; dex += 512; }
            }
            const z = mul(q[0], q[1], q[0], q[1]);
            zx = z[0]; zy = z[1];
            if (st) stAdd(zx, zy, qx0, qy0, 1);
            const r2 = zx * zx + zy * zy;
            if (r2 > 1e4) {
                if (deS) OUT.de = encDE(zx, zy, Dx, Dy, dex);
                if (st) OUT.acc = stEnc(zx, zy);
                return n + 1 - Math.log2(Math.log(r2) / LN1E4);
            }
            const e = Math.hypot(zx - 1, zy);
            if (e < EPS) {
                const A = Math.log(EPS / Math.max(e, 1e-300)), B = ep < 1e29 ? Math.log(ep / Math.max(e, 1e-300)) : 0;
                const f = B > 0 ? Math.min(1, Math.max(0, A / B)) : 0;
                if (deS) { const gn = cdivx(Dx, Dy, zx - 1, zy), gp = cdivx(Px, Py, z1x, z1y); OUT.de = deMu(A, B, gn[0], gn[1], gp[0], gp[1], dex); }
                return Math.max(n - f, 0);
            }
            ep = e;
            z1x = zx - 1; z1y = zy;
        }
        return -1;
    }
    if (F === 28) {
        const bits = XP.xi[0] | 0, L = Math.max(1, XP.xi[1] | 0), warm = XP.xi[2] | 0, N = Math.min(4000, Math.max(100, maxIter));
        let x = 0.5, dxa = 0, dxb = 0, lam = 0, la = 0, lb = 0, k = 0, bad = false;
        for (let i = 0; i < warm + N; i++) {
            const isB = ((bits >> k) & 1) === 1;
            k = k + 1 === L ? 0 : k + 1;
            const r = isB ? py : px, q = 1 - 2 * x, g = r * q;
            if (i >= warm) {
                lam += Math.log(Math.max(Math.abs(g), 1e-30));
                const iq = Math.abs(q) > 1e-12 ? 1 / q : 0;
                la += (isB ? 0 : 1 / r) - 2 * dxa * iq;
                lb += (isB ? 1 / r : 0) - 2 * dxb * iq;
            }
            const h = x * (1 - x);
            dxa = g * dxa + (isB ? 0 : h);
            dxb = g * dxb + (isB ? h : 0);
            if (Math.max(Math.abs(dxa), Math.abs(dxb)) > 1e18) { dxa *= 1e-18; dxb *= 1e-18; bad = true; }
            x = r * h;
            if (!(Math.abs(x) < 1e10)) { bad = true; lam = 1e10; break; }
        }
        lam /= N;
        if (lam < 0) {
            if (deS) OUT.de = bad ? 1 : dePx(-lam / Math.max(Math.hypot(la, lb) / N * deS, 1e-300));
            return X[0] * (1 - Math.exp(lam));
        }
        return -1;
    }
    return -1;
}

// ------------------------------------------------------------------
//  Perturbation (+BLA) in f64 — CPU-Pfad und Referenzsuche
//  ref = { formula, orbit(Float64Array x,y), baseA, lenA, baseB, lenB, bla|null }
// ------------------------------------------------------------------
function perturbPixel(dcx, dcy, ref, maxIter, useBLA, deS, inn) {
    OUT.de = 0; OUT.acc = 0;
    if (ref.formula <= 1) return perturbZ2(dcx, dcy, ref, maxIter, useBLA ? ref.bla : null, deS || 0, inn);
    const st = STA.st;
    if (st) stStart(ref.formula, STA.cabsRef);
    const O = ref.orbit, f = ref.formula;
    let Dx = f === 1 ? (deS || 0) : 0, Dy = 0, dex = 0;
    const bla = useBLA ? ref.bla : null;
    let o = 0, base = ref.baseA, len = ref.lenA;
    let dzx, dzy, cx, cy;
    if (f === 1) {
        dzx = dcx; dzy = dcy; cx = 0; cy = 0;
        const zx = O[2 * base] + dzx, zy = O[2 * base + 1] + dzy;
        if (zx * zx + zy * zy > BAIL) return smoothIter(0, zx, zy, f);
    } else { dzx = 0; dzy = 0; cx = dcx; cy = dcy; }
    let m = 0, n = 0, wait = 0, back = 1;
    let trap = Infinity;
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
                const qx = O[2 * (base + m)] + dzx, qy = O[2 * (base + m) + 1] + dzy;
                const nx = ax * dzx - ay * dzy + bx * cx - by * cy;
                const ny = ax * dzy + ay * dzx + bx * cy + by * cx;
                dzx = nx; dzy = ny; m += step; n += step;
                if (st) stAdd(O[2 * (base + m)] + dzx, O[2 * (base + m) + 1] + dzy, qx, qy, step);
                if (deS) {
                    const ndx = ax * Dx - ay * Dy + bx * deS, ndy = ax * Dy + ay * Dx + by * deS;
                    Dx = ndx; Dy = ndy;
                    if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; dex += 512; }
                }
                applied = true;
            }
            if (applied) {
                const zx = O[2 * (base + m)] + dzx, zy = O[2 * (base + m) + 1] + dzy;
                if (zx * zx + zy * zy > BAIL) { if (deS) OUT.de = encDE(zx, zy, Dx, Dy, dex); if (st) OUT.acc = stEnc(zx, zy); return smoothIter(n, zx, zy, f); }
                if (m >= len - 1 || lessMag(zx, zy, dzx, dzy)) {
                    o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0; wait = 0; back = 1;
                }
                continue;
            }
        }
        const i2 = 2 * (base + m);
        const X = O[i2], Y = O[i2 + 1];
        if (deS) {
            const fx = X + dzx, fy = Y + dzy;
            let ax, ay;
            if (f === 4) { ax = 3 * (fx * fx - fy * fy); ay = 6 * fx * fy; } else { ax = 2 * fx; ay = 2 * fy; }
            const ndx = ax * Dx - ay * Dy + (f === 1 ? 0 : deS), ndy = ax * Dy + ay * Dx;
            Dx = ndx; Dy = ndy;
            if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; dex += 512; }
        }
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
        } else if (f >= 20) { // 7.1 Celtic / senkrecht / Büffel (wie GPU)
            const d = pstepBS(f, X, Y, dzx, dzy); nx = d[0] + cx; ny = d[1] + cy;
        } else {              // Mandelbrot / Julia: dz' = 2Z dz + dz² + dc
            nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + cx;
            ny = 2 * (X * dzy + Y * dzx) + 2 * dzx * dzy + cy;
        }
        const qx = X + dzx, qy = Y + dzy;
        dzx = nx; dzy = ny;
        m++; n++;
        const j2 = 2 * (base + m);
        const zx = O[j2] + dzx, zy = O[j2 + 1] + dzy;
        if (st) stAdd(zx, zy, qx, qy, 1);
        if (zx * zx + zy * zy > BAIL) { if (deS) OUT.de = encDE(zx, zy, Dx, Dy, dex); if (st) OUT.acc = stEnc(zx, zy); return smoothIter(n, zx, zy, f); }
        if (m >= len - 1 || lessMag(zx, zy, dzx, dzy)) {
            o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0;
        }
    }
    return inn ? innerPerturb(ref, f, dzx, dzy, cx, cy, m, o, n, trap) : -1;
}

// Spezialisierte heiße Schleife für z² + c (Mandelbrot/Julia) — identische Mathematik wie
// perturbPixel, nur ohne Formel-Verzweigung und mit inline-Betragsvergleich (≈ 1.5–2× schneller).
function perturbZ2(dcx, dcy, ref, maxIter, bla, deS, inn) {
    const O = ref.orbit, julia = ref.formula === 1;
    let base = ref.baseA, len = ref.lenA, o = 0;
    let dzx, dzy, cx, cy;
    let Dx = julia ? deS : 0, Dy = 0, dex = 0;
    const dStep = julia ? 0 : deS;
    if (julia) {
        dzx = dcx; dzy = dcy; cx = 0; cy = 0;
        const zx = O[2 * base] + dzx, zy = O[2 * base + 1] + dzy;
        if (zx * zx + zy * zy > BAIL) { if (deS) OUT.de = encDE(zx, zy, Dx, Dy, 0); return smoothIter(0, zx, zy, 1); }
    } else { dzx = 0; dzy = 0; cx = dcx; cy = dcy; }
    let m = 0, n = 0;
    let X = O[2 * base], Y = O[2 * base + 1];
    let wait = 0, back = 1;          // BLA-Backoff: nach Fehlversuch 1,2,4..64 Schritte nicht probieren
    const jt = inn && julia;
    const st = STA.st;
    if (st) stStart(0, STA.cabsRef);
    let trap = jt ? (X + dzx) * (X + dzx) + (Y + dzy) * (Y + dzy) : Infinity;
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
                const qx = X + dzx, qy = Y + dzy;
                const nx = ax * dzx - ay * dzy + bx * cx - by * cy;
                dzy = ax * dzy + ay * dzx + bx * cy + by * cx; dzx = nx;
                if (deS) {
                    const ndx = ax * Dx - ay * Dy + bx * deS;
                    Dy = ax * Dy + ay * Dx + by * deS; Dx = ndx;
                    if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; dex += 512; }
                }
                m += 1 << bestL; n += 1 << bestL;
                X = O[2 * (base + m)]; Y = O[2 * (base + m) + 1];
                const zx = X + dzx, zy = Y + dzy;
                const z2 = zx * zx + zy * zy;
                if (st) stAdd(zx, zy, qx, qy, 1 << bestL);
                if (z2 > BAIL) { if (deS) OUT.de = encDE(zx, zy, Dx, Dy, dex); if (st) OUT.acc = stEnc(zx, zy); return smoothIter(n, zx, zy, 0); }
                const d2 = dzx * dzx + dzy * dzy;
                if (m >= len - 1 || (d2 > 1e-280 ? z2 < d2 : lessMag(zx, zy, dzx, dzy))) {
                    o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0; X = 0; Y = 0; wait = 0; back = 1;
                }
                continue;
            }
        }
        if (deS) {
            const fx = X + dzx, fy = Y + dzy;
            const ndx = 2 * (fx * Dx - fy * Dy) + dStep;
            Dy = 2 * (fx * Dy + fy * Dx); Dx = ndx;
            if (Math.abs(Dx) > TWO_512 || Math.abs(Dy) > TWO_512) { Dx *= TWO_M512; Dy *= TWO_M512; dex += 512; }
        }
        const qx = X + dzx, qy = Y + dzy;
        const nx = 2 * (X * dzx - Y * dzy) + dzx * dzx - dzy * dzy + cx;
        dzy = 2 * (X * dzy + Y * dzx) + 2 * dzx * dzy + cy; dzx = nx;
        m++; n++;
        X = O[2 * (base + m)]; Y = O[2 * (base + m) + 1];
        const zx = X + dzx, zy = Y + dzy;
        const z2 = zx * zx + zy * zy;
        if (st) stAdd(zx, zy, qx, qy, 1);
        if (z2 > BAIL) { if (deS) OUT.de = encDE(zx, zy, Dx, Dy, dex); if (st) OUT.acc = stEnc(zx, zy); return smoothIter(n, zx, zy, 0); }
        if (jt && z2 < trap) trap = z2;
        const d2 = dzx * dzx + dzy * dzy;
        if (m >= len - 1 || (d2 > 1e-280 ? z2 < d2 : lessMag(zx, zy, dzx, dzy))) {
            o = 1; base = ref.baseB; len = ref.lenB; dzx = zx; dzy = zy; m = 0; X = 0; Y = 0; wait = 0; back = 1;
        }
    }
    return inn ? innerPerturb(ref, julia ? 1 : 0, dzx, dzy, cx, cy, m, o, n, trap) : -1;
}

// |c + d| − |c|, numerisch stabil (Burning-Ship-Perturbation)
function diffabs(c, d) {
    if (c >= 0) return (c + d >= 0) ? d : -(2 * c + d);
    return (c + d > 0) ? (2 * c + d) : -d;
}
// 7.1 Burning-Ship-Familie: Perturbationsschritt ohne dc (wie GPU)
//  20 Celtic  x' = |x² − y²| + cx, y' = 2xy + cy
//  21 senkrecht  x' = x² − y² + cx, y' = −2|x|·y + cy
//  22 Büffel  x' = |x² − y²| + cx, y' = |2xy| + cy
const _bs = [0, 0];
function pstepBS(f, X, Y, dx, dy) {
    const re2 = (2 * X + dx) * dx - (2 * Y + dy) * dy;
    if (f === 20) { _bs[0] = diffabs(X * X - Y * Y, re2); _bs[1] = 2 * (X * dy + Y * dx + dx * dy); }
    else if (f === 21) { _bs[0] = re2; _bs[1] = -2 * (diffabs(X, dx) * (Y + dy) + Math.abs(X) * dy); }
    else { _bs[0] = diffabs(X * X - Y * Y, re2); _bs[1] = 2 * diffabs(X * Y, X * dy + Y * dx + dx * dy); }
    return _bs;
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
        else if (formula === 20) { const d = x2 - y2; nx = (d < 0n ? -d : d) + cx; ny = ((zx * zy) >> S1) + cy; }
        else if (formula === 21) { nx = x2 - y2 + cx; ny = -(((zx < 0n ? -zx : zx) * zy) >> S1) + cy; }
        else if (formula === 22) { const d = x2 - y2, xy = (zx * zy) >> S1; nx = (d < 0n ? -d : d) + cx; ny = (xy < 0n ? -xy : xy) + cy; }
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

    // 6.4 Bunte Menge: Innenpunkte laufen nach maxIter weiter (Zyklussuche) -> Orbit des GEWÄHLTEN Referenzpunkts um
    // req.extra verlängern. Wahl und BLA-Tabellen bleiben wie ohne Verlängerung (blaLen) – die Außenwerte bitgleich.
    const extra = req.extra | 0;
    if (extra > 0 && method !== 'nucleus' && A.len === maxIter + 1) {
        const A2 = julia ? hpOrbit(1, rX, rY, jX, jY, pw, maxIter + extra) : hpOrbit(formula, 0n, 0n, rX, rY, pw, maxIter + extra);
        const B2 = julia ? hpOrbit(1, 0n, 0n, jX, jY, pw, maxIter + extra) : null;
        const blaLenA = A.len, blaLenB = B ? B.len : A.len;
        ref = mk(A2, B2);
        ref.blaLenA = blaLenA; ref.blaLenB = blaLenB;
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
    const tA = buildBLA(ref.orbit, ref.baseA, ref.blaLenA || ref.lenA, ref.formula, eps, julia ? 0 : cmax);
    const tB = julia ? buildBLA(ref.orbit, ref.baseB, ref.blaLenB || ref.lenB, 1, eps, 0) : null;
    return packBLA(tA, tB, !julia, asF32);
}

root.FKCore = { BAIL, MAXL, OUT, encDE, stSetup, STA, xpSetup, XP, exoticPixel, polyRoots, newtonPoly, NEWTON_POLYS, pstepBS, ctz, smoothIter, lessMag, directPixel, newtonPixel, perturbPixel, diffabs, innerVal, cycleInfo,
                buildBLA, packBLA, blaFor, hpOrbit, ballPeriod, newtonNucleusPerturb, gridProbe,
                computeReference, precisionFor, makeToF };
})(typeof self !== 'undefined' ? self : globalThis);
