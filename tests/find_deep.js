#!/usr/bin/env node
// Zoom-Walk: erzeugt strukturreiche Deep-Zoom-Koordinaten. Pro Schritt wird das Pixel mit der
// höchsten (noch fliehenden) Iteration im 48x48-Raster zur neuen Mitte, dann Zoom × factor.
// Aufruf: node tests/find_deep.js <formula> <cx> <cy> <startZoom> <endZoom> [jx jy]
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'js', 'hp.js'));
require(path.join(__dirname, '..', 'js', 'fractal-core.js'));
const HP = globalThis.FKHP, C = globalThis.FKCore;
const [formula, cx0, cy0, z0, z1, jx = '0', jy = '0'] = process.argv.slice(2);
const f = +formula;
let cx = HP.fromString(cx0), cy = HP.fromString(cy0), zoom = +z0;
const autoIter = (z) => { const l = Math.log10(z + 1); return Math.min(30000, Math.max(300, Math.floor(l * l * 50))); };
while (zoom <= +z1 * 1.0001) {
    const maxIter = autoIter(zoom);
    const H = 64, W = 64, s = 3 / (zoom * H);
    const R = C.computeReference({ formula: f, cx: cx.toString(), cy: cy.toString(), jx: HP.fromString(jx).toString(), jy: HP.fromString(jy).toString(),
        zoom, maxIter, halfW: s * W / 2, halfH: s * H / 2, pixel: s });
    const ref = R.ref;
    const offX = HP.toNumber(cx - BigInt(R.refX)), offY = HP.toNumber(cy - BigInt(R.refY));
    ref.bla = C.blaFor(ref, 2 ** -40, 2 * (Math.hypot(offX, offY) + s * W), false);
    let best = null, nInt = 0, vals = [];
    for (let j = 4; j < H - 4; j++) for (let i = 4; i < W - 4; i++) {
        const v = C.perturbPixel(offX + (i + 0.5 - W / 2) * s, offY - (j + 0.5 - H / 2) * s, ref, maxIter, true);
        if (v < 0) { nInt++; continue; }
        vals.push(v);
        if (!best || v > best.v) best = { v, i, j };
    }
    const mn = Math.min(...vals), mx = Math.max(...vals);
    console.log(`zoom ${zoom.toExponential(1)} maxIter ${maxIter} ref ${R.method}/${R.period} len ${ref.lenA} range ${mn.toFixed(0)}..${mx.toFixed(0)} interior ${nInt}`);
    const digits = HP.digitsForZoom(zoom) + 4;
    console.log(`   cx ${HP.toString(cx, digits)}  cy ${HP.toString(cy, digits)}`);
    if (!best) break;
    cx = cx + HP.fromNumber((best.i + 0.5 - W / 2) * s);
    cy = cy - HP.fromNumber((best.j + 0.5 - H / 2) * s);
    zoom *= 100;
}
