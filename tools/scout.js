#!/usr/bin/env node
// 7.1 Kundschafter: sucht strukturreiche Stellen einer Welt (CPU-Formeln aus js/fractal-core.js) für Sehenswürdigkeiten.
// Je Stufe: Raster 72×72 über die Ansicht (Seitenverhältnis 1:2, hochkant), Wertung je 9×9-Block = Streuung der glatten
// Zahl + Mischung innen/außen (Rand); zufällig gewichtete Wahl unter den besten Blöcken, Zoom ×f dorthin.
// Aufruf: node tools/scout.js <F> <cx> <cy> <zoom> <stufen> <faktor> [seed] [X-JSON]   -> Zeilen "cx cy zoom score"
'use strict';
require('../js/hp.js'); require('../js/fractal-core.js');
const C = globalThis.FKCore;
const [F, cx0, cy0, z0, steps, fac, seed, xj] = process.argv.slice(2);
const f = +F;
if (xj) { const X = JSON.parse(xj); if (X.np !== undefined) X.poly = C.newtonPoly(X.np); C.xpSetup(X); }
let s = +(seed || 1);
const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
let cx = +cx0, cy = +cy0, zoom = +z0;
const N = 72, B = 9;
for (let k = 0; k < +steps; k++) {
    const h = 3 / zoom, w = h / 2, maxIter = Math.min(3000, Math.max(300, Math.floor(Math.pow(Math.log10(zoom + 1), 2) * 50)));
    const v = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = cx + ((i + 0.5) / N - 0.5) * w, y = cy + ((j + 0.5) / N - 0.5) * h;
        v[j * N + i] = C.directPixel(x, y, f, maxIter, 0, 0, 0, false);
    }
    const cand = [];
    for (let bj = 0; bj < N / B; bj++) for (let bi = 0; bi < N / B; bi++) {
        let n = 0, m = 0, q = 0, ins = 0;
        for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
            const t = v[(bj * B + j) * N + bi * B + i];
            if (t < 0) { ins++; continue; }
            const u = f === 5 ? t % 1000 : Math.log2(1 + t);
            n++; m += u; q += u * u;
        }
        if (n < 4) continue;
        m /= n; const sd = Math.sqrt(Math.max(0, q / n - m * m));
        const mix = ins / (B * B), edge = mix > 0.03 && mix < 0.7 ? 1.5 : 1;
        const roots = f === 5 ? new Set(Array.from({ length: B * B }, (_, k2) => Math.floor(v[(bj * B + (k2 / B | 0)) * N + bi * B + k2 % B] / 1000))).size : 1;
        cand.push({ bi, bj, score: (sd + 0.02) * edge * (f === 5 ? roots : 1) });
    }
    cand.sort((a, b) => b.score - a.score);
    const top = cand.slice(0, 6);
    const pick = top[Math.floor(rnd() * top.length)];
    cx = cx + ((pick.bi + 0.5) * B / N - 0.5) * w;
    cy = cy + ((pick.bj + 0.5) * B / N - 0.5) * h;
    zoom *= +fac;
    console.log(cx.toPrecision(12), cy.toPrecision(12), zoom.toPrecision(4), pick.score.toFixed(3));
}
