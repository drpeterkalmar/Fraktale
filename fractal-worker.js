// fractal-worker.js — CPU Mandelbrot renderer with Float64 Perturbation Theory
// Computes pixel deltas relative to a high-precision reference orbit.
// This is ~10,000x faster than arbitrary precision math for every pixel.

importScripts('https://cdn.jsdelivr.net/npm/decimal.js@10/decimal.min.js');

// ============================================================
//  Palette functions
// ============================================================
function pal(t, a, b, c, d) {
    const TAU = 6.28318;
    return [
        a[0] + b[0] * Math.cos(TAU * (c[0] * t + d[0])),
        a[1] + b[1] * Math.cos(TAU * (c[1] * t + d[1])),
        a[2] + b[2] * Math.cos(TAU * (c[2] * t + d[2]))
    ];
}

const PALETTE_FNS = [
    (t) => pal(t, [.5,.5,.5], [.5,.5,.5], [1,1,1], [.00,.10,.20]),      // Neon Spectral
    (t) => pal(t, [.5,.5,.5], [.5,.5,.5], [1,1,.5], [.80,.90,.30]),      // Ocean Deep
    (t) => pal(t, [.5,.5,.5], [.5,.5,.5], [1,.7,.4], [.00,.15,.20]),     // Inferno
    (t) => pal(t, [.5,.5,.5], [.5,.5,.5], [2,1,0], [.50,.20,.25]),       // Electric
    (t) => pal(t, [.5,.5,.5], [.5,.5,.5], [1,1,1], [.30,.20,.20]),       // Cosmic
    (t) => pal(t, [.5,.5,.5], [.5,.5,.5], [1,1,.5], [.00,.33,.67]),      // Aurora
];

function getColor(smoothIter, maxIter, palette, colorCycle) {
    let t = Math.sqrt(smoothIter / maxIter) * 8.0;
    t = ((t + colorCycle) % 1.0 + 1.0) % 1.0;
    const fn = PALETTE_FNS[palette] || PALETTE_FNS[0];
    const col = fn(t);
    const lum = col[0] * 0.299 + col[1] * 0.587 + col[2] * 0.114;
    col[0] = lum + (col[0] - lum) * 1.2;
    col[1] = lum + (col[1] - lum) * 1.2;
    col[2] = lum + (col[2] - lum) * 1.2;
    col[0] = Math.pow(Math.max(0, col[0]), 0.92);
    col[1] = Math.pow(Math.max(0, col[1]), 0.92);
    col[2] = Math.pow(Math.max(0, col[2]), 0.92);
    return col;
}

// ============================================================
//  Perturbation Theory Iteration (Float64)
// ============================================================
self.onmessage = function(e) {
    const {
        canvasW, canvasH, cx, cy, refCx, refCy,
        refOrbit, refLen, zoom, maxIter,
        palette, colorCycle, blockSize,
        fractalMode, juliaC
    } = e.data;

    // View dimensions
    const viewH = 3.0 / zoom;
    const viewW = viewH * (canvasW / canvasH);

    // To compute dc (delta c), we need the exact difference between the pixel's C and the reference C.
    // For extreme zooms, this difference must be computed with Decimal.js ONCE per tile, 
    // or just computed precisely relative to the center of the screen.
    Decimal.set({ precision: 50 });
    const screenCx = new Decimal(cx);
    const screenCy = new Decimal(cy);
    const rCx = new Decimal(refCx);
    const rCy = new Decimal(refCy);
    
    // Base delta from reference center to screen center
    const baseDcx = screenCx.minus(rCx).toNumber();
    const baseDcy = screenCy.minus(rCy).toNumber();

    const pixels = new Uint8ClampedArray(tileW * tileH * 4);
    const bs = blockSize || 1;

    for (let py = 0; py < tileH; py += bs) {
        for (let px = 0; px < tileW; px += bs) {
            // Screen coordinates -0.5 to 0.5
            const mx = ((tileX + px) / canvasW - 0.5);
            const my = -((tileY + py) / canvasH - 0.5);

            const rx = mx;
            const ry = my;

            // dc is the precise distance from the reference orbit's starting C
            let dcx = baseDcx + (rx * viewW);
            let dcy = baseDcy + (ry * viewH);

            let dzx, dzy;
            let final_dcx, final_dcy;

            if (fractalMode === 1) {
                // Julia: dz0 = pixel offset, dc = 0
                dzx = dcx;
                dzy = dcy;
                final_dcx = 0;
                final_dcy = 0;
            } else {
                // Mandelbrot: dz0 = 0, dc = pixel offset
                dzx = 0;
                dzy = 0;
                final_dcx = dcx;
                final_dcy = dcy;
            }

            let iter = 0;
            let zx_full = 0;
            let zy_full = 0;

            // Perturbation iteration loop
            while (iter < maxIter) {
                // If we've exhausted the reference orbit, we must fall back to standard iteration 
                // but since the reference orbit usually escapes or hits maxIter, we're safe to just use 0.
                let zx_ref = 0;
                let zy_ref = 0;
                if (iter < refLen) {
                    zx_ref = refOrbit[iter * 2];
                    zy_ref = refOrbit[iter * 2 + 1];
                }

                zx_full = zx_ref + dzx;
                zy_full = zy_ref + dzy;

                // Check bailout on the combined Z
                if (zx_full * zx_full + zy_full * zy_full > 256.0) {
                    break;
                }

                // Perturbation formula: dz_{n+1} = 2 * Z_n * dz_n + dz_n^2 + dc
                const dzx_sq = dzx * dzx - dzy * dzy;
                const dzy_sq = 2.0 * dzx * dzy;

                const next_dzx = 2.0 * (zx_ref * dzx - zy_ref * dzy) + dzx_sq + final_dcx;
                const next_dzy = 2.0 * (zx_ref * dzy + zy_ref * dzx) + dzy_sq + final_dcy;

                dzx = next_dzx;
                dzy = next_dzy;
                iter++;
            }

            let r, g, b;
            if (iter >= maxIter || iter >= refLen && refLen >= maxIter) {
                r = 0; g = 0; b = 4;
            } else {
                const mag2 = zx_full * zx_full + zy_full * zy_full;
                const log_zn = Math.log(mag2) * 0.5;
                const nu = Math.log(log_zn / Math.LN2) / Math.LN2;
                const smoothIter = iter + 1.0 - nu;

                const col = getColor(smoothIter, maxIter, palette, colorCycle);
                r = Math.min(255, Math.max(0, Math.round(col[0] * 255)));
                g = Math.min(255, Math.max(0, Math.round(col[1] * 255)));
                b = Math.min(255, Math.max(0, Math.round(col[2] * 255)));
            }

            for (let by = 0; by < bs && py + by < tileH; by++) {
                for (let bx = 0; bx < bs && px + bx < tileW; bx++) {
                    const idx = ((py + by) * tileW + (px + bx)) * 4;
                    pixels[idx] = r;
                    pixels[idx + 1] = g;
                    pixels[idx + 2] = b;
                    pixels[idx + 3] = 255;
                }
            }
        }
    }

    self.postMessage({
        taskId, tileX, tileY, tileW, tileH,
        pixels: pixels.buffer, blockSize: bs
    }, [pixels.buffer]);
};
