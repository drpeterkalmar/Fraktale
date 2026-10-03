#!/usr/bin/env node
// ref_render.js — Referenzbild für die Glättungs-Messung (6.1): f64-Direktiteration (Mandelbrot, Zoom ≤ 1e12),
// Färbung exakt wie der 2D-Display-Pass (Palette, Sättigung, Vignette, Gamma; Partikel aus, Farbzyklus fest),
// optional mit Distanzschätzungs-Maske (6.1) und n×n-Supersampling (Box-Filter, Mittel der fertigen Farben).
// Aufruf: node tests/ref_render.js job.json out.rgb   (job: siehe unten; Ausgabe: RGB8 Zeile 0 = oben)
//   job = { cx, cy, zoom, W, H (Canvas), crop:[x0,y0,w,h] (oben links), maxIter, pal:{a,b,c,d}, density, cycle,
//           ss (Unterabtastung je Achse: 1 = Pixelmitte, 4 = 16 Stichproben), de:{on, lo, hi} (Maske in Pixeln) }
// Parallel über worker_threads (Zeilenblöcke).
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const os = require('os');

function renderRows(job, y0, y1) {
    const { W, H, crop, maxIter, pal, density, cycle } = job;
    const ss = job.ss || 1, de = job.de || { on: false };
    const cx = +job.cx, cy = +job.cy, s = 3 / (job.zoom * H);
    const [X0, Y0, CW] = crop;
    const out = new Uint8Array((y1 - y0) * CW * 3);
    const stats = { inside: 0, near: 0, n: 0 };
    const voidC = [0, 0, 0.015];
    const col = [0, 0, 0];
    function palette(t, o) {
        t -= Math.floor(t);
        for (let k = 0; k < 3; k++) o[k] = pal.a[k] + pal.b[k] * Math.cos(6.28318 * (pal.c[k] * t + pal.d[k]));
    }
    const acc = [0, 0, 0], c3 = [0, 0, 0];
    for (let j = y0; j < y1; j++) {
        const jt = Y0 + j;                 // Zeile von oben
        const jg = H - 1 - jt;             // GL-Zeile (unten = 0)
        for (let i = 0; i < CW; i++) {
            const ig = X0 + i;
            acc[0] = acc[1] = acc[2] = 0;
            for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
                const ox = ss === 1 ? 0 : (sx + 0.5) / ss - 0.5, oy = ss === 1 ? 0 : (sy + 0.5) / ss - 0.5;
                const pr = cx + (ig + 0.5 + ox - W / 2) * s, pi = cy + (jg + 0.5 + oy - H / 2) * s;
                // Hauptkardioide / Periode-2-Kreis: mathematisch innen
                let inside = false, mu = -1, dePx = 0;
                const xq = pr - 0.25, q = xq * xq + pi * pi;
                if (q * (q + xq) <= 0.25 * pi * pi || (pr + 1) * (pr + 1) + pi * pi <= 0.0625) inside = true;
                else {
                    let zr = 0, zi = 0, dr = 0, di = 0, n = 1;
                    inside = true;
                    for (; n <= maxIter; n++) {
                        const ndr = 2 * (zr * dr - zi * di) + 1, ndi = 2 * (zr * di + zi * dr);
                        dr = ndr; di = ndi;
                        const t = zr * zr - zi * zi + pr; zi = 2 * zr * zi + pi; zr = t;
                        const r2 = zr * zr + zi * zi;
                        if (r2 > 256) {
                            inside = false;
                            mu = n + 1 - Math.log2(0.5 * Math.log2(r2));
                            const r = Math.sqrt(r2);
                            dePx = r * Math.log(r) / Math.hypot(dr, di) / s;
                            break;
                        }
                    }
                }
                let c;
                if (inside) { c = voidC; stats.inside++; }
                else {
                    palette(mu * 0.08 * density + cycle, c3);
                    if (de.on) {
                        const x = Math.min(1, Math.max(0, (dePx - de.lo) / (de.hi - de.lo)));
                        const m = 1 - x * x * (3 - 2 * x);
                        if (dePx < 0.5) stats.near++;
                        for (let k = 0; k < 3; k++) c3[k] = c3[k] + (voidC[k] - c3[k]) * m;
                    } else if (dePx < 0.5) stats.near++;
                    c = c3;
                }
                stats.n++;
                // Nachbearbeitung wie DISPLAY_FS
                const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
                const vx = (ig + 0.5) / W - 0.5, vy = (jg + 0.5) / H - 0.5;
                const vig = 1 - (vx * vx + vy * vy) * 0.25;
                for (let k = 0; k < 3; k++) {
                    let v = (lum + (c[k] - lum) * 1.2) * vig;
                    col[k] = Math.pow(Math.max(v, 0), 0.92);
                    acc[k] += col[k];
                }
            }
            const o = ((j - y0) * CW + i) * 3, nss = ss * ss;
            for (let k = 0; k < 3; k++) out[o + k] = Math.max(0, Math.min(255, Math.round(acc[k] / nss * 255)));
        }
    }
    return { out, stats };
}

if (isMainThread) {
    const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const outPath = process.argv[3];
    const CH = job.crop[3];
    const nT = Math.max(1, Math.min(job.threads || 6, os.cpus().length - 1));
    const blocks = [];
    const B = 16;
    for (let y = 0; y < CH; y += B) blocks.push([y, Math.min(CH, y + B)]);
    const result = new Uint8Array(CH * job.crop[2] * 3);
    const tot = { inside: 0, near: 0, n: 0 };
    let next = 0, done = 0;
    const t0 = Date.now();
    for (let t = 0; t < nT; t++) {
        const w = new Worker(__filename, { workerData: job });
        const feed = () => { if (next < blocks.length) w.postMessage(blocks[next++]); else w.terminate(); };
        w.on('message', (m) => {
            result.set(m.out, m.y0 * job.crop[2] * 3);
            for (const k in tot) tot[k] += m.stats[k];
            if (++done === blocks.length) {
                fs.writeFileSync(outPath, result);
                console.log(JSON.stringify({ ms: Date.now() - t0, inside: tot.inside / tot.n, near: tot.near / tot.n }));
            }
            feed();
        });
        feed();
    }
} else {
    parentPort.on('message', ([y0, y1]) => {
        const r = renderRows(workerData, y0, y1);
        parentPort.postMessage({ y0, out: r.out, stats: r.stats }, [r.out.buffer]);
    });
}
