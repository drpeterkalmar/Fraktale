#!/usr/bin/env node
// 7.1 Flammen-Suche: Zufallsflammen (js/density.js randomFlame) erzeugen, entartete aussortieren, je eine Vorschau rendern
// (Log-Dichte, Farbe aus einer festen Palette) und als Kontaktbogen-Einzelbilder (PGM/PPM) in ein Verzeichnis schreiben.
// Aufruf: node tools/flame_search.js <ausgabeverzeichnis> <anzahl> [startseed]   -> Dateien <seed>.ppm + index.json
'use strict';
globalThis.self = globalThis;
require('../js/flames.js'); require('../js/density.js');
const D = self.FKDensity, fs = require('fs'), path = require('path');
const [out, nStr, s0] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const N = +nStr || 24, W = 240, H = 240, list = [];
const pal = (t) => [0.5 + 0.5 * Math.cos(6.28318 * (t + 0.0)), 0.5 + 0.5 * Math.cos(6.28318 * (t + 0.1)), 0.5 + 0.5 * Math.cos(6.28318 * (t + 0.2))];
let seed = +(s0 || 1000), made = 0;
while (made < N) {
    seed++;
    const F = D.randomFlame(seed);
    const v = D.fitView('flame', F, 1);
    if (!v || v.w < 0.05 || v.h < 0.05 || v.w > 60) continue;
    const hist = new Float64Array(W * H * 3), cnt = new Float64Array(W * H), r = D.rng(seed * 7 + 1);
    const sc = 1 / Math.max(v.w, v.h) / 1.1;
    for (let w = 0; w < 24; w++) {
        const s = [r() * 2 - 1, r() * 2 - 1, r()];
        for (let i = 0; i < 30000; i++) {
            const p = D.flameStep(F, s, r);
            if (i < 20 || !isFinite(p[0])) continue;
            const x = Math.floor(((p[0] - v.cx) * sc + 0.5) * W), y = Math.floor(((p[1] - v.cy) * sc + 0.5) * H);
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const k = (H - 1 - y) * W + x, c = pal(p[2]);
            cnt[k]++; hist[3 * k] += c[0]; hist[3 * k + 1] += c[1]; hist[3 * k + 2] += c[2];
        }
    }
    let mx = 0, occ = 0; for (const c of cnt) { mx = Math.max(mx, c); if (c) occ++; }
    const occF = occ / (W * H);
    if (occF < 0.04) continue;                        // fast nur ein Punkt/eine Linie
    const buf = Buffer.alloc(W * H * 3), lm = Math.log(1 + mx);
    for (let k = 0; k < W * H; k++) {
        if (!cnt[k]) continue;
        const a = Math.pow(Math.log(1 + cnt[k]) / lm, 1 / 2.2);
        for (let j = 0; j < 3; j++) buf[3 * k + j] = Math.min(255, Math.round(255 * a * hist[3 * k + j] / cnt[k]));
    }
    fs.writeFileSync(path.join(out, seed + '.ppm'), Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), buf]));
    list.push({ seed, occ: +occF.toFixed(3), v });
    made++;
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(list, null, 1));
console.log(list.map(x => x.seed).join(' '));
