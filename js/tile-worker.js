// tile-worker.js — CPU-Renderer (Fallback, Newton-Tiefzoom, Zoom > GPU-Grenze, Buddhabrot).
// Gleiche Mathematik wie der GPU-Shader, aber in f64 (fractal-core.js). Liefert glatte
// Iterationswerte (Float32) pro Kachel; der Main-Thread lädt sie nur noch als Textur hoch.
'use strict';
const V = self.location.search || '';
importScripts('hp.js' + V, 'fractal-core.js' + V);
const C = self.FKCore;

let ref = null;   // { id, formula, orbit, baseA, lenA, baseB, lenB, bla }

self.onmessage = (e) => {
    const q = e.data;
    if (q.type === 'ref') {
        ref = { id: q.id, formula: q.formula, orbit: q.orbit, baseA: q.baseA, lenA: q.lenA, baseB: q.baseB, lenB: q.lenB, bla: q.bla || null };
        return;
    }
    if (q.type === 'bla') { if (ref && ref.id === q.refId) ref.bla = q.bla || null; return; }
    if (q.type === 'tile') { tile(q); return; }
    if (q.type === 'pixels') { pixels(q); return; }
    if (q.type === 'buddha') { buddha(q); return; }
};

function tile(q) {
    const { x, y, w, h, bufW, bufH, scale, maxIter, formula } = q;
    const out = new Float32Array(w * h);
    const perturb = q.mode === 'perturb';
    if (perturb && (!ref || ref.id !== q.refId)) {
        self.postMessage({ type: 'tile', jobId: q.jobId, x, y, w, h, missingRef: true });
        return;
    }
    const useBLA = perturb && q.useBLA && ref.bla;
    for (let j = 0; j < h; j++) {
        const py = -((y + j) + 0.5 - bufH / 2) * scale;
        for (let i = 0; i < w; i++) {
            const px = ((x + i) + 0.5 - bufW / 2) * scale;
            out[(h - 1 - j) * w + i] = perturb   // GL-Zeilenfolge (unten zuerst)
                ? C.perturbPixel(q.offX + px, q.offY + py, ref, maxIter, useBLA)
                : C.directPixel(q.offX + px, q.offY + py, formula, maxIter, q.jx, q.jy);
        }
    }
    self.postMessage({ type: 'tile', jobId: q.jobId, x, y, w, h, data: out }, [out.buffer]);
}

// Einzelne (von der GPU als unsicher markierte) Pixel exakt in f64 nachrechnen
function pixels(q) {
    const { list, bufW, bufH, scale, maxIter, formula } = q;
    const n = list.length >> 1;
    const out = new Float32Array(n);
    const perturb = q.mode === 'perturb';
    if (perturb && (!ref || ref.id !== q.refId)) { self.postMessage({ type: 'pixels', jobId: q.jobId, chunk: q.chunk, missingRef: true, list }); return; }
    const useBLA = perturb && q.useBLA && ref.bla;
    for (let k = 0; k < n; k++) {
        const px = (list[2 * k] + 0.5 - bufW / 2) * scale, py = -(list[2 * k + 1] + 0.5 - bufH / 2) * scale;
        out[k] = perturb ? C.perturbPixel(q.offX + px, q.offY + py, ref, maxIter, useBLA)
                         : C.directPixel(q.offX + px, q.offY + py, formula, maxIter, q.jx, q.jy);
    }
    self.postMessage({ type: 'pixels', jobId: q.jobId, chunk: q.chunk, list, values: out }, [out.buffer, list.buffer]);
}

// Buddhabrot-Histogramm (wie v4: Zufallspunkte, Trajektorien fliehender Orbits)
function buddha(q) {
    const { w, h, maxIter, minIter, samples, cx: centerX, cy: centerY, zoom, version } = q;
    const hist = new Uint32Array(w * h);
    const ps = 3.0 / (zoom * h);
    const ox = new Float64Array(maxIter), oy = new Float64Array(maxIter);
    for (let s = 0; s < samples; s++) {
        const cx = Math.random() * 4.0 - 2.5, cy = Math.random() * 3.0 - 1.5;
        let zx = 0, zy = 0, n = 0, esc = false;
        for (let i = 0; i < maxIter; i++) {
            const x2 = zx * zx, y2 = zy * zy;
            if (x2 + y2 > 4.0) { esc = true; n = i; break; }
            ox[i] = zx; oy[i] = zy;
            const nzx = x2 - y2 + cx;
            zy = 2.0 * zx * zy + cy; zx = nzx;
        }
        if (esc && n >= minIter) {
            for (let i = 1; i < n; i++) {        // z_0 = 0 auslassen (sonst ein Hotspot, der alles dunkel normiert)
                const px = Math.floor((ox[i] - centerX) / ps + w / 2.0);
                const py = Math.floor((centerY - oy[i]) / ps + h / 2.0);
                if (px >= 0 && px < w && py >= 0 && py < h) hist[py * w + px]++;
            }
        }
    }
    self.postMessage({ type: 'buddha', hist, version }, [hist.buffer]);
}
