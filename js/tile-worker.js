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
    // 6.1: Distanzschätzung (Code wie GPU) als zweiter Kanal; 7.1 Färbe-Stil: RGBA je Pixel (Distanz, Stil-Wert 16 bit, 0)
    const st = q.st | 0, c4 = st ? 4 : 1;
    C.stSetup(st, q.stp, q.cabs);
    C.xpSetup(q.X);                       // 7.1 Welt-Parameter (Exoten, Newton-Polynom)
    const deS = q.de ? scale : 0, de = q.de || st ? new Uint8Array(w * h * c4) : null;
    for (let j = 0; j < h; j++) {
        const py = -((y + j) + 0.5 - bufH / 2) * scale;
        for (let i = 0; i < w; i++) {
            const px = ((x + i) + 0.5 - bufW / 2) * scale;
            const k = (h - 1 - j) * w + i;          // GL-Zeilenfolge (unten zuerst)
            out[k] = perturb
                ? C.perturbPixel(q.offX + px, q.offY + py, ref, maxIter, useBLA, deS, q.inn)
                : C.directPixel(q.offX + px, q.offY + py, formula, maxIter, q.jx, q.jy, deS, q.inn);
            if (st) { const a = C.OUT.acc; de[4 * k] = C.OUT.de; de[4 * k + 1] = a >> 8; de[4 * k + 2] = a & 255; }
            else if (de) de[k] = C.OUT.de;
        }
    }
    C.stSetup(0);
    self.postMessage({ type: 'tile', jobId: q.jobId, x, y, w, h, data: out, de }, de ? [out.buffer, de.buffer] : [out.buffer]);
}

// Einzelne (von der GPU als unsicher markierte) Pixel exakt in f64 nachrechnen
function pixels(q) {
    const { list, bufW, bufH, scale, maxIter, formula } = q;
    const n = list.length >> 1;
    const out = new Float32Array(n);
    const perturb = q.mode === 'perturb';
    if (perturb && (!ref || ref.id !== q.refId)) { self.postMessage({ type: 'pixels', jobId: q.jobId, chunk: q.chunk, missingRef: true, list }); return; }
    const useBLA = perturb && q.useBLA && ref.bla;
    C.stSetup(0);
    C.xpSetup(q.X);
    for (let k = 0; k < n; k++) {
        const px = (list[2 * k] + 0.5 - bufW / 2) * scale, py = -(list[2 * k + 1] + 0.5 - bufH / 2) * scale;
        out[k] = perturb ? C.perturbPixel(q.offX + px, q.offY + py, ref, maxIter, useBLA, 0, q.inn)
                         : C.directPixel(q.offX + px, q.offY + py, formula, maxIter, q.jx, q.jy, 0, q.inn);
    }
    self.postMessage({ type: 'pixels', jobId: q.jobId, chunk: q.chunk, list, values: out }, [out.buffer, list.buffer]);
}

// Buddhabrot-Histogramm (wie v4: Zufallspunkte, Trajektorien fliehender Orbits)
// 7.1 Varianten: v = 1 Nebulabrot – Grenzen 2000/200/40 als Rot/Grün/Blau (Bahnen ab 10 Schritten) (eine Bahn, die nach n Schritten flieht, zählt in
// jedem Kanal mit Grenze > n; Histogramm mit 4 Werten je Pixel), v = 2 Anti-Buddhabrot – Bahnen, die NICHT fliehen (ab Schritt
// 50, bis 500): die anziehenden Zyklen im Inneren
function buddha(q) {
    if (q.v === 1) return nebula(q);
    if (q.v === 2) return antiBuddha(q);
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
function nebula(q) {
    const { w, h, samples, cx: centerX, cy: centerY, zoom, version } = q;
    const LIM = [2000, 200, 40], MAX = 2000, MIN = 10;     // (Bahnen, die in < 10 Schritten fliehen, gäben nur Dunst weit draußen)
    const hist = new Uint32Array(w * h * 4);
    const ps = 3.0 / (zoom * h);
    const ox = new Float64Array(MAX), oy = new Float64Array(MAX);
    for (let s = 0; s < samples; s++) {
        const cx = Math.random() * 4.0 - 2.5, cy = Math.random() * 3.0 - 1.5;
        // Hauptkardioide und Periode-2-Kreis fliehen nie: überspringen (spart die vollen 2000 Schritte)
        const xq = cx - 0.25, qq = xq * xq + cy * cy;
        if (qq * (qq + xq) < 0.25 * cy * cy || (cx + 1) * (cx + 1) + cy * cy < 0.0625) continue;
        let zx = 0, zy = 0, n = 0, esc = false;
        for (let i = 0; i < MAX; i++) {
            const x2 = zx * zx, y2 = zy * zy;
            if (x2 + y2 > 4.0) { esc = true; n = i; break; }
            ox[i] = zx; oy[i] = zy;
            const nzx = x2 - y2 + cx;
            zy = 2.0 * zx * zy + cy; zx = nzx;
        }
        if (!esc || n < MIN) continue;
        const r = n < LIM[0], g = n < LIM[1], b = n < LIM[2];
        for (let i = 1; i < n; i++) {
            const px = Math.floor((ox[i] - centerX) / ps + w / 2.0), py = Math.floor((centerY - oy[i]) / ps + h / 2.0);
            if (px >= 0 && px < w && py >= 0 && py < h) { const k = 4 * (py * w + px); if (r) hist[k]++; if (g) hist[k + 1]++; if (b) hist[k + 2]++; }
        }
    }
    self.postMessage({ type: 'buddha', hist, version, rgb: true }, [hist.buffer]);
}
function antiBuddha(q) {
    const { w, h, samples, cx: centerX, cy: centerY, zoom, version } = q;
    const MAX = 500, SKIP = 50;
    const hist = new Uint32Array(w * h);
    const ps = 3.0 / (zoom * h);
    for (let s = 0; s < samples; s++) {
        const cx = Math.random() * 2.6 - 2.0, cy = Math.random() * 2.4 - 1.2;
        let zx = 0, zy = 0, esc = false;
        for (let i = 0; i < MAX; i++) {
            const x2 = zx * zx, y2 = zy * zy;
            if (x2 + y2 > 4.0) { esc = true; break; }
            const nzx = x2 - y2 + cx;
            zy = 2.0 * zx * zy + cy; zx = nzx;
        }
        if (esc) continue;
        zx = 0; zy = 0;
        for (let i = 0; i < MAX; i++) {
            const nzx = zx * zx - zy * zy + cx;
            zy = 2.0 * zx * zy + cy; zx = nzx;
            if (i < SKIP) continue;
            const px = Math.floor((zx - centerX) / ps + w / 2.0), py = Math.floor((centerY - zy) / ps + h / 2.0);
            if (px >= 0 && px < w && py >= 0 && py < h) hist[py * w + px]++;
        }
    }
    self.postMessage({ type: 'buddha', hist, version }, [hist.buffer]);
}
