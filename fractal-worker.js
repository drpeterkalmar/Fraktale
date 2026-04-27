// fractal-worker.js — CPU Mandelbrot renderer with Float64 Perturbation Theory
// Computes pixel deltas relative to a high-precision reference orbit.

// ============================================================
//  Palette functions
// ============================================================
function pal(t, a, b, c, d) {
    const TAU = 6.28318530718;
    return [
        a[0] + b[0] * Math.cos(TAU * (c[0] * t + d[0])),
        a[1] + b[1] * Math.cos(TAU * (c[1] * t + d[1])),
        a[2] + b[2] * Math.cos(TAU * (c[2] * t + d[2]))
    ];
}

const PALETTES = [
    { name: "Neon Spectral", colors: ["#000000", "#1e1b4b", "#4338ca", "#a855f7", "#ec4899", "#f43f5e", "#fb923c", "#facc15", "#ffffff"] },
    { name: "Ocean Deep", colors: ["#082f49", "#0c4a6e", "#0369a1", "#0284c7", "#38bdf8", "#7dd3fc", "#bae6fd", "#e0f2fe", "#ffffff"] },
    { name: "Inferno", colors: ["#000000", "#450a0a", "#7f1d1d", "#991b1b", "#b91c1c", "#dc2626", "#ef4444", "#f87171", "#ffffff"] },
    { name: "Electric", colors: ["#000000", "#1e1b4b", "#312e81", "#3730a3", "#4338ca", "#4f46e5", "#6366f1", "#818cf8", "#ffffff"] },
    { name: "Cosmic", colors: ["#020617", "#0f172a", "#1e293b", "#334155", "#475569", "#64748b", "#94a3b8", "#cbd5e1", "#ffffff"] },
    { name: "Aurora", colors: ["#064e3b", "#065f46", "#047857", "#059669", "#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#ffffff"] }
];

function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function getColor(smoothIter, maxIter, paletteIdx, colorCycle) {
    const p = PALETTES[paletteIdx] || PALETTES[0];
    const colors = p.colors;
    const f = smoothIter / 32.0 + colorCycle;
    const count = colors.length;
    
    let t = (f % count + count) % count;
    const i1 = Math.floor(t);
    const i2 = (i1 + 1) % count;
    const frac = t - i1;
    
    const c1 = hexToRgb(colors[i1]);
    const c2 = hexToRgb(colors[i2]);
    
    return [
        c1[0] + (c2[0] - c1[0]) * frac,
        c1[1] + (c2[1] - c1[1]) * frac,
        c1[2] + (c2[2] - c1[2]) * frac
    ];
}

// ============================================================
//  Perturbation Theory Iteration (Float64)
// ============================================================
self.onmessage = function(e) {
    const {
        tile, canvasW, canvasH, 
        baseDcx, baseDcy,
        refOrbit, refLen, zoom, maxIter,
        palette, colorCycle, fractalMode
    } = e.data;

    const { x: tileX, y: tileY, w: tileW, h: tileH } = tile;
    const pixels = new Uint8ClampedArray(tileW * tileH * 4);

    // View dimensions
    const viewH = 3.0 / zoom;
    const viewW = viewH * (canvasW / canvasH);

    for (let py = 0; py < tileH; py++) {
        for (let px = 0; px < tileW; px++) {
            // Screen coordinates -0.5 to 0.5
            const mx = ((tileX + px) / canvasW - 0.5);
            const my = ((tileY + py) / canvasH - 0.5);

            // dc is the precise distance from the reference orbit's starting C
            let dcx = baseDcx + (mx * viewW);
            let dcy = baseDcy - (my * viewH);

            let dzx, dzy;
            let final_dcx, final_dcy;

            if (fractalMode === 1) {
                dzx = dcx; dzy = dcy;
                final_dcx = 0; final_dcy = 0;
            } else {
                dzx = 0; dzy = 0;
                final_dcx = dcx; final_dcy = dcy;
            }

            let iter = 0;
            let zx_full = 0;
            let zy_full = 0;

            while (iter < maxIter) {
                let zx_ref = 0, zy_ref = 0;
                if (iter < refLen) {
                    zx_ref = refOrbit[iter * 2];
                    zy_ref = refOrbit[iter * 2 + 1];
                }

                zx_full = zx_ref + dzx;
                zy_full = zy_ref + dzy;

                const mag2 = zx_full * zx_full + zy_full * zy_full;
                if (mag2 > 256.0) {
                    const log_zn = Math.log(mag2) * 0.5;
                    const nu = Math.log(log_zn / Math.log(2)) / Math.log(2);
                    const smoothIter = iter + 1.0 - nu;
                    const col = getColor(smoothIter, maxIter, palette, colorCycle);
                    const idx = (py * tileW + px) * 4;
                    pixels[idx] = col[0]; pixels[idx+1] = col[1]; pixels[idx+2] = col[2]; pixels[idx+3] = 255;
                    break;
                }

                if (fractalMode === 2) {
                    const next_dzx = dzx * dzx - dzy * dzy + final_dcx;
                    const next_dzy = Math.abs(2.0 * dzx * dzy) + final_dcy;
                    dzx = next_dzx; dzy = next_dzy;
                } else {
                    const next_dzx = 2.0 * (zx_ref * dzx - zy_ref * dzy) + (dzx * dzx - dzy * dzy) + final_dcx;
                    const next_dzy = 2.0 * (zx_ref * dzy + zy_ref * dzx) + (2.0 * dzx * dzy) + final_dcy;
                    dzx = next_dzx; dzy = next_dzy;
                }
                iter++;
            }

            if (iter === maxIter) {
                const idx = (py * tileW + px) * 4;
                pixels[idx] = 0; pixels[idx+1] = 0; pixels[idx+2] = 0; pixels[idx+3] = 255;
            }
        }
    }

    self.postMessage({ tile, pixels: pixels.buffer, version: e.data.version }, [pixels.buffer]);
};
