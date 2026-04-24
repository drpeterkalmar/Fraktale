// Mandelbrot Explorer – Main Engine
(function () {
'use strict';

const PALETTES = [
    { name: 'Neon Spectral', colors: ['#6366f1','#a78bfa','#f472b6','#fb923c','#facc15','#34d399'] },
    { name: 'Ocean Deep',    colors: ['#0c4a6e','#0284c7','#22d3ee','#a3e635','#fbbf24','#0c4a6e'] },
    { name: 'Inferno',       colors: ['#1a0533','#6b21a8','#dc2626','#f97316','#fde047','#fefce8'] },
    { name: 'Electric',      colors: ['#020617','#7c3aed','#06b6d4','#10b981','#eab308','#020617'] },
    { name: 'Cosmic',        colors: ['#0f0326','#581c87','#be185d','#f43f5e','#fca5a5','#fdf2f8'] },
    { name: 'Aurora',        colors: ['#022c22','#059669','#2dd4bf','#a78bfa','#f0abfc','#022c22'] }
];

const BOOKMARKS = [
    { name: 'Full Set',    cx: '-0.5',  cy: '0.0',   zoom: 1 },
    { name: 'Seahorse',    cx: '-0.7463',  cy: '0.1102',  zoom: 200 },
    { name: 'Elephant',    cx: '0.2819',    cy: '0.0100',   zoom: 50 },
    { name: 'Double Spiral', cx: '-0.74529',  cy: '0.11307', zoom: 20000 },
    { name: 'Lightning',   cx: '-1.25066',  cy: '0.02012',  zoom: 1000 },
    { name: 'Antenna',     cx: '-1.401155', cy: '0.0', zoom: 500 },
    { name: 'Star',        cx: '-0.16',     cy: '1.0405',   zoom: 200 },
];

// === WebGL Setup ===
const canvas = document.getElementById('fractal-canvas');
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
if (!gl) { document.body.innerHTML = '<h1 style="color:#fff;text-align:center;margin-top:40vh">WebGL 2 not supported</h1>'; return; }

// Enable float textures
gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

let program, uLocs = {};
let refOrbitTex = null;

function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    return s;
}

function initProgram() {
    const vs = compileShader(VERTEX_SHADER, gl.VERTEX_SHADER);
    const fs = compileShader(FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
    program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(program)); return; }
    gl.useProgram(program);
    ['u_resolution','u_maxIter','u_palette','u_colorCycle','u_center','u_scale',
     'u_mode','u_refOrbit','u_refLen','u_pixelScale','u_refOffset','u_refCenter','u_time',
     'u_fractalMode', 'u_juliaC'].forEach(n => { uLocs[n] = gl.getUniformLocation(program, n); });
    gl.bindVertexArray(gl.createVertexArray());
}

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
}

// === State ===
const state = {
    cx: new Decimal('-0.5'), cy: new Decimal('0.0'),
    zoom: 1.0, maxIter: 500, palette: 0, colorCycle: 0,
    showUI: true, mode: 0, // 0=GPU, 1=CPU workers
    fractalMode: 0, // 0=Mandelbrot, 1=Julia
    juliaC: { x: new Decimal('-0.8'), y: new Decimal('0.156') },
    refOrbitData: null, refOrbitLen: 0,
    refOrbitDirty: true,
    refCx: new Decimal('-0.5'), refCy: new Decimal('0.0'),
    // Smooth zoom targets
    targetCx: new Decimal('-0.5'), targetCy: new Decimal('0.0'),
    targetZoom: 1.0,
    animTime: 0,
    cpuRenderVersion: 0,
    cpuTilesTotal: 0,
    cpuTilesDone: 0,
    showUI: true,
    lastRenderKey: '',
};

// df64 works well up to ~1e11 zoom. Beyond that, CPU workers take over.
const ZOOM_THRESHOLD = 1e11;

// === CPU Worker Pool ===
const cpuOverlay = document.getElementById('cpu-overlay');
const ctxCpu = cpuOverlay.getContext('2d');
const numWorkers = navigator.hardwareConcurrency || 4;
const workers = [];
let pendingTiles = [];

function initWorkers() {
    const workerScript = `
        self.importScripts('https://cdn.jsdelivr.net/npm/decimal.js@10/decimal.min.js');
        
        self.onmessage = function(e) {
            const { tile, cx, cy, zoom, maxIter, width, height, fractalMode, juliaC } = e.data;
            const { x, y, w, h } = tile;
            
            Decimal.set({ precision: 40 });
            const DCX = new Decimal(cx);
            const DCY = new Decimal(cy);
            const DJCX = new Decimal(juliaC.x);
            const DJCY = new Decimal(juliaC.y);
            
            const pixels = new Float32Array(w * h);
            const scale = new Decimal(3.0).div(new Decimal(zoom).mul(height));
            
            for (let py = 0; py < h; py++) {
                for (let px = 0; px < w; px++) {
                    const screenX = x + px;
                    const screenY = y + py;
                    
                    let dx = new Decimal(screenX - width/2).mul(scale);
                    let dy = new Decimal(screenY - height/2).mul(scale);
                    
                    let zx, zy, cx_val, cy_val;
                    if (fractalMode === 1) {
                        zx = DCX.plus(dx);
                        zy = DCY.plus(dy);
                        cx_val = DJCX;
                        cy_val = DJCY;
                    } else {
                        zx = new Decimal(0);
                        zy = new Decimal(0);
                        cx_val = DCX.plus(dx);
                        cy_val = DCY.plus(dy);
                    }
                    
                    let iter = -1;
                    for (let i = 0; i < maxIter; i++) {
                        const zx2 = zx.mul(zx);
                        const zy2 = zy.mul(zy);
                        if (zx2.plus(zy2).gt(256)) {
                            const mag2 = zx2.plus(zy2).toNumber();
                            const log_zn = Math.log(mag2) * 0.5;
                            const nu = Math.log(log_zn / Math.log(2.0)) / Math.log(2.0);
                            iter = i + 1 - nu;
                            break;
                        }
                        const next_zy = zx.mul(zy).mul(2).plus(cy_val);
                        zx = zx2.minus(zy2).plus(cx_val);
                        zy = next_zy;
                    }
                    pixels[py * w + px] = iter;
                }
            }
            self.postMessage({ tile, pixels }, [pixels.buffer]);
        };
    `;
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    for (let i = 0; i < numWorkers; i++) {
        const w = new Worker(url);
        w.onmessage = onWorkerMessage;
        workers.push(w);
    }
}

function onWorkerMessage(e) {
    const { tile, pixels } = e.data;
    drawTile(tile, pixels);
    state.cpuTilesDone++;
    updateProgress();
    if (pendingTiles.length > 0) {
        const next = pendingTiles.pop();
        e.target.postMessage({
            tile: next,
            cx: state.cx.toString(),
            cy: state.cy.toString(),
            zoom: state.zoom,
            maxIter: state.maxIter,
            width: canvas.width,
            height: canvas.height,
            fractalMode: state.fractalMode,
            juliaC: { x: state.juliaC.x.toString(), y: state.juliaC.y.toString() }
        });
    } else {
        if (state.cpuTilesDone === state.cpuTilesTotal) {
            document.getElementById('progress-container').classList.add('hidden');
        }
    }
}

function updateProgress() {
    const container = document.getElementById('progress-container');
    const bar = document.getElementById('progress-bar');
    const label = document.getElementById('progress-label');
    if (state.cpuTilesTotal > 0) {
        const p = (state.cpuTilesDone / state.cpuTilesTotal) * 100;
        bar.style.width = p + '%';
        label.textContent = `Rendering… ${Math.round(p)}%`;
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

function drawTile(tile, pixels) {
    const { x, y, w, h } = tile;
    const imgData = ctxCpu.createImageData(w, h);
    for (let i = 0; i < pixels.length; i++) {
        const iter = pixels[i];
        if (iter < 0) {
            imgData.data[i*4+0] = 0; imgData.data[i*4+1] = 0; imgData.data[i*4+2] = 0; imgData.data[i*4+3] = 255;
        } else {
            const col = getPaletteColor(iter);
            imgData.data[i*4+0] = col[0]; imgData.data[i*4+1] = col[1]; imgData.data[i*4+2] = col[2]; imgData.data[i*4+3] = 255;
        }
    }
    ctxCpu.putImageData(imgData, x, y);
}

function getPaletteColor(iter) {
    const p = PALETTES[state.palette];
    const t = fract(Math.sqrt(iter / state.maxIter) * 8.0 + state.colorCycle);
    const idx = t * (p.colors.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;
    const c1 = hexToRgb(p.colors[i]);
    const c2 = hexToRgb(p.colors[i+1] || p.colors[0]);
    return [
        Math.round(c1.r + (c2.r - c1.r) * f),
        Math.round(c1.g + (c2.g - c1.g) * f),
        Math.round(c1.b + (c2.b - c1.b) * f)
    ];
}

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return { r, g, b };
}

function fract(x) { return x - Math.floor(x); }

function startCpuRender() {
    state.cpuRenderVersion++;
    cpuOverlay.width = canvas.width;
    cpuOverlay.height = canvas.height;
    cpuOverlay.style.display = 'block';
    ctxCpu.clearRect(0, 0, cpuOverlay.width, cpuOverlay.height);
    
    const tileSize = 128;
    pendingTiles = [];
    for (let y = 0; y < cpuOverlay.height; y += tileSize) {
        for (let x = 0; x < cpuOverlay.width; x += tileSize) {
            pendingTiles.push({ x, y, w: Math.min(tileSize, cpuOverlay.width - x), h: Math.min(tileSize, cpuOverlay.height - y) });
        }
    }
    
    state.cpuTilesTotal = pendingTiles.length;
    state.cpuTilesDone = 0;
    updateProgress();
    
    workers.forEach(w => {
        if (pendingTiles.length > 0) {
            const next = pendingTiles.pop();
            w.postMessage({
                tile: next,
                cx: state.cx.toString(),
                cy: state.cy.toString(),
                zoom: state.zoom,
                maxIter: state.maxIter,
                width: canvas.width,
                height: canvas.height,
                fractalMode: state.fractalMode,
                juliaC: { x: state.juliaC.x.toString(), y: state.juliaC.y.toString() }
            });
        }
    });
}

// === Reference Orbit Calculation (for Perturbation) ===
function computeReferenceOrbit() {
    const prec = Math.max(40, Math.ceil(Math.log10(state.zoom + 1) * 2) + 30);
    Decimal.set({ precision: prec });
    
    const data = new Float32Array(state.maxIter * 4);
    let zx = new Decimal(0), zy = new Decimal(0);
    let cx = state.cx, cy = state.cy;
    
    // In Julia mode, z0 is pixel, c is constant.
    // In Mandelbrot mode, z0 is 0, c is pixel.
    if (state.fractalMode === 1) {
        zx = state.cx; zy = state.cy;
        cx = state.juliaC.x; cy = state.juliaC.y;
    }

    state.refCx = state.cx; state.refCy = state.cy;

    for (let i = 0; i < state.maxIter; i++) {
        const fx = zx.toNumber(), fy = zy.toNumber();
        data[i*4+0] = Math.fround(fx); data[i*4+1] = fx - data[i*4+0];
        data[i*4+2] = Math.fround(fy); data[i*4+3] = fy - data[i*4+2];
        
        const zx2 = zx.mul(zx), zy2 = zy.mul(zy);
        if (zx2.plus(zy2).gt(1000000)) { // large bailout for ref orbit
            state.refOrbitLen = i + 1;
            break;
        }
        const nzy = zx.mul(zy).mul(2).plus(cy);
        zx = zx2.minus(zy2).plus(cx);
        zy = nzy;
        state.refOrbitLen = i + 1;
    }

    if (refOrbitTex) gl.deleteTexture(refOrbitTex);
    refOrbitTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, refOrbitTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, state.maxIter, 1, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    state.refOrbitData = data;
}

function markOrbitDirty() { state.refOrbitDirty = true; }

// === Render Loop ===
let cpuDebounceTimer = null;
function render() {
    const useCPU = state.zoom > ZOOM_THRESHOLD;

    if (useCPU) {
        // Compute reference orbit if missing or dirty
        if (!state.refOrbitData || state.refOrbitDirty) {
            computeReferenceOrbit();
            state.refOrbitDirty = false;
        }

        // Only start a new CPU render if camera has actually moved
        const renderKey = `${state.cx.toString()}|${state.cy.toString()}|${state.zoom}|${state.maxIter}`;
        if (state.lastRenderKey !== renderKey) {
            state.lastRenderKey = renderKey;
            clearTimeout(cpuDebounceTimer);
            cpuDebounceTimer = setTimeout(() => {
                startCpuRender();
            }, 100);
        }

        // GPU still renders particles/effects as background
        gl.useProgram(program);
        gl.uniform2f(uLocs.u_resolution, canvas.width, canvas.height);
        gl.uniform1i(uLocs.u_maxIter, state.maxIter);
        gl.uniform1i(uLocs.u_palette, state.palette);
        gl.uniform1f(uLocs.u_colorCycle, state.colorCycle);
        gl.uniform1i(uLocs.u_mode, 0); 
        gl.uniform1f(uLocs.u_time, state.animTime);
        gl.uniform1i(uLocs.u_fractalMode, state.fractalMode);
        
        const jcx = state.juliaC.x.toNumber(), jcy = state.juliaC.y.toNumber();
        gl.uniform4f(uLocs.u_juliaC, Math.fround(jcx), jcx - Math.fround(jcx), Math.fround(jcy), jcy - Math.fround(jcy));
        // Set center/scale but it will show low-detail or inside-set effects
        const cxf = state.cx.toNumber(), cyf = state.cy.toNumber();
        const scale = 3.0 / (state.zoom * canvas.height);
        const cx_hi = Math.fround(cxf), cx_lo = cxf - cx_hi;
        const cy_hi = Math.fround(cyf), cy_lo = cyf - cy_hi;
        gl.uniform4f(uLocs.u_center, cx_hi, cx_lo, cy_hi, cy_lo);
        gl.uniform1f(uLocs.u_scale, scale);
        gl.uniform1i(uLocs.u_refLen, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
        // GPU mode: hide overlay
        if (cpuOverlay) cpuOverlay.style.display = 'none';
        // Cancel any pending CPU render
        state.cpuRenderVersion++;
        pendingTiles = [];
        state.cpuTilesTotal = 0;
        state.cpuTilesDone = 0;
        updateProgress();

        gl.useProgram(program);
        gl.uniform2f(uLocs.u_resolution, canvas.width, canvas.height);
        gl.uniform1i(uLocs.u_maxIter, state.maxIter);
        gl.uniform1i(uLocs.u_palette, state.palette);
        gl.uniform1f(uLocs.u_colorCycle, state.colorCycle);
        gl.uniform1i(uLocs.u_mode, 0);
        gl.uniform1f(uLocs.u_time, state.animTime);
        gl.uniform1i(uLocs.u_fractalMode, state.fractalMode);

        const jcx = state.juliaC.x.toNumber(), jcy = state.juliaC.y.toNumber();
        gl.uniform4f(uLocs.u_juliaC, Math.fround(jcx), jcx - Math.fround(jcx), Math.fround(jcy), jcy - Math.fround(jcy));

        const cxf = state.cx.toNumber(), cyf = state.cy.toNumber();
        const scale = 3.0 / (state.zoom * canvas.height);
        const cx_hi = Math.fround(cxf), cx_lo = cxf - cx_hi;
        const cy_hi = Math.fround(cyf), cy_lo = cyf - cy_hi;
        gl.uniform4f(uLocs.u_center, cx_hi, cx_lo, cy_hi, cy_lo);
        gl.uniform1f(uLocs.u_scale, scale);
        gl.uniform1i(uLocs.u_refLen, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Detect if view is entirely inside the set (all black) — GPU only
    detectInsideSet();
    updateUI();
}

function detectInsideSet() {
    const toast = document.getElementById('inside-toast');
    // For simplicity, we just check zoom level and if the center is likely inside
    // Real check would require gl.readPixels but that's slow.
    const isDeep = state.zoom > 1000;
    // Basic heuristic: if we are deep and not seeing a lot of iterations
    // We'll leave this simple for now.
}

function updateUI() {
    document.getElementById('info-re').textContent = state.cx.toFixed(10);
    document.getElementById('info-im').textContent = state.cy.toFixed(10);
    document.getElementById('info-zoom').textContent = state.zoom.toExponential(2) + 'x';
    document.getElementById('info-iter').textContent = state.maxIter;
    document.getElementById('info-mode').textContent = (state.zoom > ZOOM_THRESHOLD ? 'CPU ∞' : 'GPU f64');
    
    const reLabel = document.querySelector('.label:nth-child(1)');
    const imLabel = document.querySelector('.label:nth-child(3)');
    // if (reLabel) reLabel.textContent = state.fractalMode === 1 ? 'Re(z)' : 'Re(c)';
    // if (imLabel) imLabel.textContent = state.fractalMode === 1 ? 'Im(z)' : 'Im(c)';

    // Formula Bar
    const juliaInputs = document.getElementById('julia-c-inputs');
    const mandelText = document.getElementById('mandel-c-text');
    if (juliaInputs && mandelText) {
        juliaInputs.classList.toggle('hidden', state.fractalMode !== 1);
        mandelText.classList.toggle('hidden', state.fractalMode === 1);
        if (state.fractalMode === 1) updateSteppers();
    }

    updateMinimap();
}

// === Interaction ===
let isDragging = false, dragStartX, dragStartY, dragCx, dragCy;
let lastTouchDist = 0;

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        if (e.shiftKey) {
            // Set Julia constant C to the clicked point
            const viewWidth = 3.0 / state.zoom;
            const viewHeight = (viewWidth * canvas.height) / canvas.width;
            const dx = (e.clientX / window.innerWidth - 0.5) * viewWidth;
            const dy = (e.clientY / window.innerHeight - 0.5) * viewHeight;
            state.juliaC.x = state.cx.plus(new Decimal(dx));
            state.juliaC.y = state.cy.plus(new Decimal(dy));
            markOrbitDirty();
            scheduleRender();
        } else {
            isDragging = true;
            dragStartX = e.clientX; dragStartY = e.clientY;
            dragCx = state.targetCx; dragCy = state.targetCy;
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (isDragging) {
        const viewWidth = 3.0 / state.zoom;
        const viewHeight = (viewWidth * canvas.height) / canvas.width;
        const dx = (e.clientX - dragStartX) / window.innerWidth * viewWidth;
        const dy = (e.clientY - dragStartY) / window.innerHeight * viewHeight;
        state.targetCx = dragCx.minus(new Decimal(dx));
        state.targetCy = dragCy.minus(new Decimal(dy));
    }
});

window.addEventListener('mouseup', () => { isDragging = false; markOrbitDirty(); });

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFact = Math.exp(-e.deltaY * 0.001);
    state.targetZoom *= zoomFact;
}, { passive: false });

canvas.addEventListener('dblclick', (e) => {
    const viewWidth = 3.0 / state.zoom;
    const viewHeight = (viewWidth * canvas.height) / canvas.width;
    const dx = (e.clientX / window.innerWidth - 0.5) * viewWidth;
    const dy = (e.clientY / window.innerHeight - 0.5) * viewHeight;
    state.targetCx = state.targetCx.plus(new Decimal(dx));
    state.targetCy = state.targetCy.plus(new Decimal(dy));
    state.targetZoom *= 2.0;
});

// Touch
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
        dragCx = state.targetCx; dragCy = state.targetCy;
    } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (isDragging && e.touches.length === 1) {
        const viewWidth = 3.0 / state.zoom;
        const viewHeight = (viewWidth * canvas.height) / canvas.width;
        const dx = (e.touches[0].clientX - dragStartX) / window.innerWidth * viewWidth;
        const dy = (e.touches[0].clientY - dragStartY) / window.innerHeight * viewHeight;
        state.targetCx = dragCx.minus(new Decimal(dx));
        state.targetCy = dragCy.minus(new Decimal(dy));
    } else if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const factor = dist / lastTouchDist;
        state.targetZoom *= factor;
        state.zoom = state.targetZoom;
        lastTouchDist = dist;
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    isDragging = false;
    markOrbitDirty();
});

// Keyboard
window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
        case 'p': state.palette = (state.palette + 1) % PALETTES.length; updatePalettePicker(); scheduleRender(); break;
        case 'r': goToBookmark(BOOKMARKS[0]); break;
        case 's': screenshot(); break;
        case 'f': toggleFullscreen(); break;
        case 'i': state.showUI = !state.showUI; toggleUIVisibility(); break;
        case 'h': toggleInfoBox(); break;
        case 'j': toggleFractalMode(); break;
    }
});

// Render scheduling
let renderPending = false;
function scheduleRender() {
    if (!renderPending) { renderPending = true; requestAnimationFrame(() => { renderPending = false; render(); updateFPS(); }); }
}

// === Palette Picker ===
function initPalettePicker() {
    const container = document.getElementById('palette-options');
    PALETTES.forEach((p, i) => {
        const el = document.createElement('div');
        el.className = 'palette-swatch' + (i === 0 ? ' active' : '');
        el.dataset.idx = i;
        const grad = p.colors.map((c, j) => `${c} ${(j / (p.colors.length - 1) * 100).toFixed(0)}%`).join(',');
        el.innerHTML = `<div class="swatch-bar" style="background:linear-gradient(90deg,${grad})"></div><span class="swatch-label">${p.name}</span>`;
        el.addEventListener('click', () => { state.palette = i; updatePalettePicker(); scheduleRender(); });
        container.appendChild(el);
    });
}

function updatePalettePicker() {
    document.querySelectorAll('.palette-swatch').forEach((el, i) => {
        el.classList.toggle('active', i === state.palette);
    });
}

// === Bookmarks ===
function initBookmarks() {
    const container = document.getElementById('bookmark-list');
    BOOKMARKS.forEach((b, i) => {
        const btn = document.createElement('button');
        btn.className = 'bookmark-btn glass-panel';
        btn.title = b.name;
        btn.innerHTML = `<span>${i+1}</span>`;
        btn.addEventListener('click', () => goToBookmark(b));
        container.appendChild(btn);
    });
}

function goToBookmark(b) {
    state.targetCx = new Decimal(b.cx);
    state.targetCy = new Decimal(b.cy);
    state.targetZoom = b.zoom;
    markOrbitDirty();
}

// === Minimap ===
const minimapCanvas = document.getElementById('minimap-canvas');
const ctxMinimap = minimapCanvas.getContext('2d');
let minimapBaseImg = null;

function renderMinimapBase() {
    const w = minimapCanvas.width, h = minimapCanvas.height;
    const imgData = ctxMinimap.createImageData(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let zx = 0, zy = 0;
            let cx = (x / w - 0.5) * 3.0 - 0.5;
            let cy = (y / h - 0.5) * 3.0;
            let iter = 0;
            for (let i = 0; i < 64; i++) {
                let nzx = zx*zx - zy*zy + cx;
                zy = 2*zx*zy + cy;
                zx = nzx;
                if (zx*zx + zy*zy > 4) break;
                iter++;
            }
            const i = (y * w + x) * 4;
            const v = iter === 64 ? 0 : 40 + iter * 2;
            imgData.data[i+0] = v; imgData.data[i+1] = v * 0.8; imgData.data[i+2] = v * 1.2; imgData.data[i+3] = 255;
        }
    }
    ctxMinimap.putImageData(imgData, 0, 0);
    minimapBaseImg = ctxMinimap.getImageData(0, 0, w, h);
}

function updateMinimap() {
    ctxMinimap.putImageData(minimapBaseImg, 0, 0);
    const w = minimapCanvas.width, h = minimapCanvas.height;
    const viewWidth = 3.0 / state.zoom;
    const viewHeight = (viewWidth * canvas.height) / canvas.width;
    const mx = ((state.cx.toNumber() + 0.5) / 3.0 + 0.5) * w;
    const my = (state.cy.toNumber() / 3.0 + 0.5) * h;
    const mw = (viewWidth / 3.0) * w;
    const mh = (viewHeight / 3.0) * h;
    
    ctxMinimap.strokeStyle = '#a78bfa';
    ctxMinimap.lineWidth = 2;
    ctxMinimap.strokeRect(mx - mw/2, my - mh/2, mw, mh);
    ctxMinimap.fillStyle = 'rgba(167, 139, 250, 0.2)';
    ctxMinimap.fillRect(mx - mw/2, my - mh/2, mw, mh);
}

// === FPS ===
let frameCount = 0, fpsTime = 0;
function updateFPS() {
    frameCount++;
    const now = performance.now();
    if (now - fpsTime > 1000) {
        document.getElementById('info-fps').textContent = Math.round(frameCount * 1000 / (now - fpsTime));
        frameCount = 0; fpsTime = now;
    }
}

// === Screenshot ===
function screenshot() {
    render(); // ensure fresh frame
    const link = document.createElement('a');
    link.download = `mandelbrot_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// === Fullscreen ===
function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
}

// === UI Visibility ===
function toggleUIVisibility() {
    ['info-panel','palette-picker','bookmarks','minimap','formula-bar','help-toast'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !state.showUI);
    });
    
    // If hiding UI, also hide active info box
    if (!state.showUI) {
        document.getElementById('info-box').classList.remove('active');
        document.getElementById('info-box-backdrop').classList.remove('active');
    }
}

function toggleInfoBox() {
    const box = document.getElementById('info-box');
    const backdrop = document.getElementById('info-box-backdrop');
    box.classList.toggle('active');
    backdrop.classList.toggle('active');
}

// === Stepper UI ===
function initSteppers() {
    ['cx', 'cy'].forEach(part => {
        const container = document.getElementById(`stepper-${part}`);
        container.innerHTML = '';
        // Create 8 digits (sign, 1, dot, 5 decimals)
        for (let i = 0; i < 7; i++) {
            const digit = document.createElement('div');
            digit.className = 'stepper-digit';
            if (i === 2) { // Dot
                digit.innerHTML = '<span class="digit-val">.</span>';
            } else {
                const btnDown = document.createElement('button');
                btnDown.className = 'step-btn'; btnDown.textContent = '−';
                btnDown.onclick = () => stepDigit(part, i, -1);

                const val = document.createElement('span');
                val.className = 'digit-val'; val.id = `digit-${part}-${i}`;
                val.textContent = '0';

                const btnUp = document.createElement('button');
                btnUp.className = 'step-btn'; btnUp.textContent = '+';
                btnUp.onclick = () => stepDigit(part, i, 1);
                
                digit.appendChild(btnDown);
                digit.appendChild(val);
                digit.appendChild(btnUp);
            }
            container.appendChild(digit);
        }
    });
}

function updateSteppers() {
    ['cx', 'cy'].forEach(part => {
        const num = state.juliaC[part === 'cx' ? 'x' : 'y'];
        const s = num.toFixed(5).padStart(8, ' '); // e.g. "-0.80000"
        const chars = s.split('');
        // Map to our 7 slots (sign, unit, dot, 4 decimals)
        const slots = [chars[0], chars[1], '.', chars[3], chars[4], chars[5], chars[6]];
        slots.forEach((c, i) => {
            const el = document.getElementById(`digit-${part}-${i}`);
            if (el) el.textContent = c;
        });
    });
}

function stepDigit(part, idx, delta) {
    let num = state.juliaC[part === 'cx' ? 'x' : 'y'];
    let change = new Decimal(0);
    if (idx === 0) change = new Decimal(delta * 2); // Flip sign roughly or step units
    else if (idx === 1) change = new Decimal(delta);
    else if (idx > 2) change = new Decimal(delta).times(new Decimal(10).pow(-(idx - 2)));
    
    state.juliaC[part === 'cx' ? 'x' : 'y'] = num.plus(change);
    markOrbitDirty();
    scheduleRender();
    updateSteppers();
}

function toggleFractalMode() {
    state.fractalMode = state.fractalMode === 0 ? 1 : 0;
    state.refOrbitData = null;
    markOrbitDirty();
    if (state.fractalMode === 1) {
        // Switch to a nice Julia set by default if just starting Julia
        state.targetZoom = 1.0;
        state.targetCx = new Decimal(0);
        state.targetCy = new Decimal(0);
    } else {
        goToBookmark(BOOKMARKS[0]);
    }
}

// === Color Cycle + Smooth Zoom Animation Loop ===
let lastFrameTime = performance.now();

function animationLoop(now) {
    requestAnimationFrame(animationLoop);
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (dt > 0.2) return; // ignore huge frame jumps (e.g. tab switch)
    state.animTime += dt;

    // Animate color cycling
    state.colorCycle += dt * 0.08; 

    // Smooth zoom interpolation (exponential lerp)
    // Slower value (0.4 instead of 0.05) for an even "nicer flight"
    const zoomLerp = 1 - Math.pow(0.4, dt); 
    const logCurrent = Math.log(state.zoom);
    const logTarget = Math.log(state.targetZoom);
    const logNew = logCurrent + (logTarget - logCurrent) * zoomLerp;
    state.zoom = Math.exp(logNew);

    // Smooth center interpolation
    const cxDiff = state.targetCx.minus(state.cx).toNumber();
    const cyDiff = state.targetCy.minus(state.cy).toNumber();
    if (Math.abs(cxDiff) > 1e-30 || Math.abs(cyDiff) > 1e-30) {
        state.cx = state.cx.plus(new Decimal(cxDiff * zoomLerp));
        state.cy = state.cy.plus(new Decimal(cyDiff * zoomLerp));
    }

    try {
        render();
    } catch (e) {
        console.error('Render crash:', e);
    }
    updateFPS();
}

// === Window Resize ===
window.addEventListener('resize', () => { resize(); });

// === Init ===
function init() {
    Decimal.set({ precision: 40 });
    document.getElementById('progress-container').classList.add('hidden');
    resize();
    initProgram();
    initPalettePicker();
    initBookmarks();
    initSteppers();
    renderMinimapBase();
    render();

    // Wiring moved back to top level for reliability
    initWorkers();
    requestAnimationFrame(animationLoop);
}

init();

})();
