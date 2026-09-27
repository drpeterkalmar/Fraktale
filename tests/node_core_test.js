#!/usr/bin/env node
// Isolierter Mathe-Test (Node): Referenzwahl + f64-Perturbation/BLA (CPU-Pfad) gegen Python-Decimal-Wahrheit.
// Aufruf: node tests/node_core_test.js [--quick]
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');
require(path.join(__dirname, '..', 'js', 'hp.js'));
require(path.join(__dirname, '..', 'js', 'fractal-core.js'));
const HP = globalThis.FKHP, C = globalThis.FKCore;

const SEA = ['-0.743643887037158704752191506114774', '0.131825904205311970493132056385139'];
const VIEWS = [
    // Seahorse (Wikipedia-Zoompunkt) und per tests/find_deep.js erzeugte Randpunkte ("walk")
    { name: 'seahorse_1e7',  cx: SEA[0], cy: SEA[1], zoom: 1e7,  formula: 0 },
    { name: 'seahorse_1e14', cx: SEA[0], cy: SEA[1], zoom: 1e14, formula: 0 },
    { name: 'walk_1e7',  cx: '-0.7436370901621587', cy: '0.1318223885803120', zoom: 1e7, formula: 0 },
    { name: 'walk_1e9',  cx: '-0.743637214380908705', cy: '0.131822306549061970', zoom: 1e9, formula: 0 },
    { name: 'walk_1e13', cx: '-0.7436372153547368297522', cy: '0.1318223070283588454932', zoom: 1e13, formula: 0 },
    { name: 'walk_1e15', cx: '-0.743637215354753236002154', cy: '0.131822307028445564243233', zoom: 1e15, formula: 0 },
    { name: 'walk_1e29_extrem', extreme: true, cx: '-0.74363721535475353201560573970021652303', cy: '0.13182230702844485014116030906246974788', zoom: 1e29, formula: 0 },
    { name: 'walk_1e41', cx: '-0.74363721535475353201560573969820799606042412635682', cy: '0.13182230702844485014116030906137622412768064249224', zoom: 1e41, formula: 0 },
    { name: 'peter_17M',     cx: '-0.8625944137', cy: '0.2495680306', zoom: 17050000, formula: 0 },
];

function autoIter(zoom) { const l = Math.log10(zoom + 1); return Math.min(30000, Math.max(300, Math.floor(l * l * 50))); }

function runView(v, W, H, nSamples) {
    const maxIter = v.maxIter || autoIter(v.zoom);
    const s = 3 / (v.zoom * H);
    const halfW = s * W / 2, halfH = s * H / 2;
    const req = { formula: v.formula, cx: HP.fromString(v.cx).toString(), cy: HP.fromString(v.cy).toString(),
                  jx: HP.fromString(v.jx || '0').toString(), jy: HP.fromString(v.jy || '0').toString(),
                  zoom: v.zoom, maxIter, halfW, halfH, pixel: s };
    const t0 = Date.now();
    const R = C.computeReference(req);
    const tRef = Date.now() - t0;
    const ref = R.ref;
    const refX = BigInt(R.refX), refY = BigInt(R.refY);
    const offX = HP.toNumber(HP.fromString(v.cx) - refX), offY = HP.toNumber(HP.fromString(v.cy) - refY);
    const cmax = Math.hypot(offX, offY) + Math.hypot(halfW, halfH);
    const t1 = Date.now();
    ref.bla = C.blaFor(ref, 2 ** -40, cmax * 2, false);
    const tBla = Date.now() - t1;
    // Stichproben: Gitter + Zufall (deterministisch)
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pix = [];
    const g = Math.round(Math.sqrt(nSamples / 2));
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) pix.push([Math.floor((i + 0.5) * W / g), Math.floor((j + 0.5) * H / g)]);
    while (pix.length < nSamples) pix.push([Math.floor(rnd() * W), Math.floor(rnd() * H)]);
    const t2 = Date.now();
    const got = pix.map(([i, j]) => {
        const dx = offX + (i + 0.5 - W / 2) * s, dy = offY - (j + 0.5 - H / 2) * s;
        return C.perturbPixel(dx, dy, ref, maxIter, true);
    });
    const gotNoBla = pix.map(([i, j]) => {
        const dx = offX + (i + 0.5 - W / 2) * s, dy = offY - (j + 0.5 - H / 2) * s;
        return C.perturbPixel(dx, dy, ref, maxIter, false);
    });
    const tPix = Date.now() - t2;
    const spec = { cx: v.cx, cy: v.cy, zoom: String(v.zoom), W, H, formula: v.formula, maxIter, jx: v.jx || '0', jy: v.jy || '0', pixels: pix, cond: true };
    const tmp = path.join(require('os').tmpdir(), 'fk_truth_' + v.name + '.json');
    fs.writeFileSync(tmp, JSON.stringify(spec));
    const t3 = Date.now();
    const truth3 = JSON.parse(execFileSync('python3', [path.join(__dirname, 'truth.py'), tmp], { maxBuffer: 1 << 26 }).toString());
    const truth = truth3.map(t => t[0]);
    const dist = (a, b) => (a < 0 && b < 0) ? 0 : (a < 0 || b < 0) ? Infinity : Math.abs(a - b);
    const illCond = truth3.map(t => dist(t[0], t[1]) > 1 || dist(t[0], t[2]) > 1);
    const tTruth = Date.now() - t3;
    const cmp = (arr) => {
        let ok = 0, maxd = 0, okCond = 0, nCond = 0;
        for (let k = 0; k < arr.length; k++) {
            if (!illCond[k]) { nCond++; if (dist(arr[k], truth[k]) <= 1) okCond++; }
            const a = arr[k], b = truth[k];
            let d;
            if (a < 0 && b < 0) d = 0; else if (a < 0 || b < 0) d = Infinity; else d = Math.abs(a - b);
            if (d <= 1) ok++; else if (process.env.FK_VERBOSE) console.log('  fail px', pix[k], 'got', a, 'truth', b);
            if (d > maxd) maxd = d;
        }
        return { okPct: +(100 * ok / arr.length).toFixed(2), maxd: +maxd.toFixed(3), okCondPct: +(100 * okCond / Math.max(1, nCond)).toFixed(2) };
    };
    const interior = truth.filter(x => x < 0).length;
    const ext = truth.filter(x => x >= 0); const tmin = Math.min(...ext), tmax = Math.max(...ext);
    const uniq = new Set(truth.map(x => Math.round(x * 100))).size;
    return { view: v.name, maxIter, method: R.method, period: R.period, refLen: ref.lenA, tRef, tBla, tPix,
             bla: cmp(got), noBla: cmp(gotNoBla), interior, illCond: illCond.filter(Boolean).length, n: pix.length, tTruth, truthRange: [+tmin.toFixed(1), +tmax.toFixed(1)], uniq };
}

const quick = process.argv.includes('--quick');
const only = process.argv.find(a => a.startsWith('--only='));
let pass = true;
for (const v of VIEWS) {
    if (only && !v.name.includes(only.slice(7))) continue;
    const r = runView(v, 412, 915, quick ? 120 : 400);
    const good = v.extreme ? r.bla.okCondPct >= 99 : (r.bla.okPct >= 99 && r.noBla.okPct >= 99);
    if (!good) pass = false;
    console.log(JSON.stringify(r), good ? 'OK' : 'FAIL');
}
console.log(pass ? 'ALL PASS' : 'SOME FAILED');
process.exit(pass ? 0 : 1);
