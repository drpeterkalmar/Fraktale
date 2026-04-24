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
    return [
        Math.min(255, Math.max(0, Math.round(col[0] * 255))),
        Math.min(255, Math.max(0, Math.round(col[1] * 255))),
        Math.min(255, Math.max(0, Math.round(col[2] * 255)))
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

                const next_dzx = 2.0 * (zx_ref * dzx - zy_ref * dzy) + (dzx * dzx - dzy * dzy) + final_dcx;
                const next_dzy = 2.0 * (zx_ref * dzy + zy_ref * dzx) + (2.0 * dzx * dzy) + final_dcy;
                dzx = next_dzx; dzy = next_dzy;
                iter++;
            }

            if (iter === maxIter) {
                const idx = (py * tileW + px) * 4;
                pixels[idx] = 0; pixels[idx+1] = 0; pixels[idx+2] = 0; pixels[idx+3] = 255;
            }
        }
    }

    self.postMessage({ tile, pixels: pixels.buffer }, [pixels.buffer]);
};
