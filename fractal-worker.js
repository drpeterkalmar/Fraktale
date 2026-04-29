// fractal-worker.js — CPU Mandelbrot renderer with Float64 Perturbation Theory
// Computes pixel deltas relative to a high-precision reference orbit.

// ============================================================
//  Palette functions
// ============================================================
function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

const PALETTES = [
    { name: "Neon Spectral", colors: ["#000000", "#1e1b4b", "#4338ca", "#a855f7", "#ec4899", "#f43f5e", "#fb923c", "#facc15", "#ffffff"] },
    { name: "Ocean Deep", colors: ["#082f49", "#0c4a6e", "#0369a1", "#0284c7", "#38bdf8", "#7dd3fc", "#bae6fd", "#e0f2fe", "#ffffff"] },
    { name: "Inferno", colors: ["#000000", "#450a0a", "#7f1d1d", "#991b1b", "#b91c1c", "#dc2626", "#ef4444", "#f87171", "#ffffff"] },
    { name: "Electric", colors: ["#000000", "#1e1b4b", "#312e81", "#3730a3", "#4338ca", "#4f46e5", "#6366f1", "#818cf8", "#ffffff"] },
    { name: "Cosmic", colors: ["#020617", "#0f172a", "#1e293b", "#334155", "#475569", "#64748b", "#94a3b8", "#cbd5e1", "#ffffff"] },
    { name: "Aurora", colors: ["#064e3b", "#065f46", "#047857", "#059669", "#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#ffffff"] }
];

function getColor(smoothIter, maxIter, paletteIdx, colorCycle, fractalMode) {
    const p = PALETTES[paletteIdx] || PALETTES[0];
    const colors = p.colors;
    
    let f, rootCol = [1, 1, 1];
    if (fractalMode === 5) { // Newton coloring
        const rootIdx = Math.floor(smoothIter / 1000);
        const iter = smoothIter % 1000;
        f = Math.sqrt(iter / maxIter) * 32.0 + colorCycle;
        if (rootIdx === 0) rootCol = [0.4, 0.1, 0.1]; // Muted Red
        else if (rootIdx === 1) rootCol = [0.1, 0.4, 0.1]; // Muted Green
        else if (rootIdx === 2) rootCol = [0.1, 0.1, 0.4]; // Muted Blue
    } else {
        f = Math.sqrt(smoothIter / maxIter) * 64.0 + colorCycle;
    }

    const count = colors.length;
    let t = (f % count + count) % count;
    const i1 = Math.floor(t);
    const i2 = (i1 + 1) % count;
    const frac = t - i1;
    
    const c1 = hexToRgb(colors[i1]);
    const c2 = hexToRgb(colors[i2]);
    
    let col = [
        (c1[0] + (c2[0] - c1[0]) * frac) / 255.0,
        (c1[1] + (c2[1] - c1[1]) * frac) / 255.0,
        (c1[2] + (c2[2] - c1[2]) * frac) / 255.0
    ];

    if (fractalMode === 5) {
        // Deep atmosphere blending
        col[0] = (rootCol[0] * 0.7 + col[0] * 0.3);
        col[1] = (rootCol[1] * 0.7 + col[1] * 0.3);
        col[2] = (rootCol[2] * 0.7 + col[2] * 0.3);
        return [
            Math.max(0, Math.min(255, col[0] * 255)),
            Math.max(0, Math.min(255, col[1] * 255)),
            Math.max(0, Math.min(255, col[2] * 255))
        ];
    }

    return [
        col[0] * 255,
        col[1] * 255,
        col[2] * 255
    ];
}

self.onmessage = function (e) {
    if (e.data.type === 'buddhabrot') {
        const { w, h, maxIter, minIter, samples, cx: centerX, cy: centerY, zoom, version } = e.data;
        const histogram = new Uint32Array(w * h);
        const pixelScale = 3.0 / (zoom * h);
        
        for (let s = 0; s < samples; s++) {
            // Sample points primarily from the main cardioid area to find interesting escaping orbits
            const cx = Math.random() * 4.0 - 2.5;
            const cy = Math.random() * 3.0 - 1.5;
            let zx = 0, zy = 0;
            const orbitX = new Float64Array(maxIter);
            const orbitY = new Float64Array(maxIter);
            let escaped = false, iterCount = 0;
            for (let i = 0; i < maxIter; i++) {
                const x2 = zx * zx, y2 = zy * zy;
                if (x2 + y2 > 4.0) { escaped = true; iterCount = i; break; }
                orbitX[i] = zx; orbitY[i] = zy;
                const nzx = x2 - y2 + cx;
                const nzy = 2.0 * zx * zy + cy;
                zx = nzx; zy = nzy;
            }
            if (escaped && iterCount >= minIter) {
                for (let i = 0; i < iterCount; i++) {
                    const px = Math.floor((orbitX[i] - centerX) / pixelScale + w / 2.0);
                    const py = Math.floor((centerY - orbitY[i]) / pixelScale + h / 2.0);
                    if (px >= 0 && px < w && py >= 0 && py < h) histogram[py * w + px]++;
                }
            }
        }
        self.postMessage({ type: 'buddhabrotChunk', histogram, version }, [histogram.buffer]);
        return;
    }

    const { tile, canvasW, canvasH, viewW, viewH, baseDcx, baseDcy, refOrbit, refLen, maxIter, paletteIdx, colorCycle, fractalMode, cx, cy, refCx, refCy, juliaCx, juliaCy } = e.data;
    const tileW = tile.w, tileH = tile.h, tileX = tile.x, tileY = tile.y;
    const iters = new Float32Array(tileW * tileH);

    for (let py = 0; py < tileH; py++) {
        for (let px = 0; px < tileW; px++) {
            const mx = ((tileX + px) / canvasW - 0.5);
            const my = ((tileY + py) / canvasH - 0.5);
            let dcx = baseDcx + (mx * viewW);
            let dcy = baseDcy - (my * viewH);

            let dzx, dzy, final_dcx, final_dcy;
            if (fractalMode === 1) { // Julia
                dzx = dcx; dzy = dcy; final_dcx = 0; final_dcy = 0;
            } else if (fractalMode === 0) { // Mandelbrot Perturbation
                dzx = 0; dzy = 0; final_dcx = dcx; final_dcy = dcy;
            } else { // Others (Absolute Mode)
                final_dcx = cx + (mx * viewW);
                final_dcy = cy - (my * viewH);
                dzx = final_dcx; dzy = final_dcy;
            }

            let iter = 0, finalIter = -1;
            let zx_abs = 0, zy_abs = 0;
            while (iter < maxIter) {
                if (fractalMode === 2) { // Burning Ship
                    const nx = dzx * dzx - dzy * dzy + final_dcx;
                    const ny = Math.abs(2.0 * dzx * dzy) + final_dcy;
                    dzx = nx; dzy = ny;
                    if (dzx*dzx + dzy*dzy > 4.0) { finalIter = iter; break; }
                } else if (fractalMode === 3) { // Tricorn
                    const nx = dzx * dzx - dzy * dzy + final_dcx;
                    const ny = -2.0 * dzx * dzy + final_dcy;
                    dzx = nx; dzy = ny;
                    if (dzx*dzx + dzy*dzy > 4.0) { finalIter = iter; break; }
                } else if (fractalMode === 4) { // Mandelbrot z^3
                    const x2 = dzx * dzx, y2 = dzy * dzy;
                    const nx = dzx * (x2 - 3.0 * y2) + final_dcx;
                    const ny = dzy * (3.0 * x2 - y2) + final_dcy;
                    dzx = nx; dzy = ny;
                    if (dzx*dzx + dzy*dzy > 4.0) { finalIter = iter; break; }
                } else if (fractalMode === 5) { // Newton
                    const x2 = dzx * dzx, y2 = dzy * dzy;
                    const x3 = dzx * (x2 - 3.0 * y2), y3 = dzy * (3.0 * x2 - y2);
                    const num_re = 2.0 * x3 + 1.0, num_im = 2.0 * y3;
                    const den_re = 3.0 * (x2 - y2), den_im = 6.0 * dzx * dzy;
                    const d2 = den_re * den_re + den_im * den_im;
                    if (d2 < 1e-20) break;
                    dzx = (num_re * den_re + num_im * den_im) / d2;
                    dzy = (num_im * den_re - num_re * den_im) / d2;
                    if ((dzx-1)**2 + dzy**2 < 0.0001) { finalIter = iter + 1; break; }
                    if ((dzx+0.5)**2 + (dzy-0.866)**2 < 0.0001) { finalIter = iter + 1001; break; }
                    if ((dzx+0.5)**2 + (dzy+0.866)**2 < 0.0001) { finalIter = iter + 2001; break; }
                } else { // Mandelbrot / Julia Perturbation
                    if (iter === 0) {
                        // Initialize abs tracking just in case refLen is 0
                        zx_abs = (fractalMode === 1) ? (cx + mx * viewW) : 0;
                        zy_abs = (fractalMode === 1) ? (cy - my * viewH) : 0;
                    }
                    if (iter < refLen) { 
                        let zx_ref = refOrbit[iter * 2], zy_ref = refOrbit[iter * 2 + 1];
                        const next_dzx = 2.0 * (zx_ref * dzx - zy_ref * dzy) + (dzx * dzx - dzy * dzy) + final_dcx;
                        const next_dzy = 2.0 * (zx_ref * dzy + zy_ref * dzx) + (2.0 * dzx * dzy) + final_dcy;
                        dzx = next_dzx; dzy = next_dzy;
                        zx_abs = zx_ref + dzx;
                        zy_abs = zy_ref + dzy;
                        if (zx_abs*zx_abs + zy_abs*zy_abs > 4.0) { finalIter = iter; break; }
                    } else {
                        let cx_abs = fractalMode === 1 ? juliaCx : (cx + mx * viewW);
                        let cy_abs = fractalMode === 1 ? juliaCy : (cy - my * viewH);
                        const nx = zx_abs * zx_abs - zy_abs * zy_abs + cx_abs;
                        const ny = 2.0 * zx_abs * zy_abs + cy_abs;
                        zx_abs = nx; zy_abs = ny;
                        if (zx_abs*zx_abs + zy_abs*zy_abs > 4.0) { finalIter = iter; break; }
                    }
                }
                iter++;
            }

            const idx = (py * tileW + px);
            if (finalIter >= 0) {
                let smoothIter = finalIter;
                if (fractalMode !== 5 && fractalMode !== 6 && fractalMode !== 7) {
                    const mag = Math.sqrt(zx_abs * zx_abs + zy_abs * zy_abs);
                    if (mag > 2.0) {
                        smoothIter = finalIter + 1 - Math.log2(Math.log(mag) / Math.log(2));
                    }
                }
                iters[idx] = smoothIter;
            } else {
                iters[idx] = -1.0;
            }
        }
    }
    self.postMessage({ tile, iters: iters.buffer, version: e.data.version }, [iters.buffer]);
};
