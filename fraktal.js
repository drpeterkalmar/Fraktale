// Mandelbrot Explorer - Main Engine
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
    { name: 'Star',        cx: '-1.25066',  cy: '0.02012',  zoom: 1000 },
    { name: 'Antenna',     cx: '-1.401155', cy: '0.0', zoom: 500 },
    { name: 'Lightning',   cx: '-0.16',     cy: '1.0405',   zoom: 200 },
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
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (cpuOverlay) {
        cpuOverlay.width = canvas.width;
        cpuOverlay.height = canvas.height;
    }
    if (state.fractalMode === 7) {
        state.buddhabrotHistogram = new Uint32Array(canvas.width * canvas.height);
        state.buddhabrotMax = 0;
    }
}

// === State ===
const state = {
    cx: new Decimal('-0.5'), cy: new Decimal('0.0'),
    zoom: 1.0, maxIter: 500, palette: 0, colorCycle: 0,
    zoomFormat: 'words',
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
    lang: 'de',
    lastRenderKey: '',
    selectionMode: false,
    buddhabrotHistogram: null,
    buddhabrotMax: 0,
    buddhabrotActive: false
};

// df64 works well up to ~1e11 zoom. Beyond that, CPU workers take over.
const ZOOM_THRESHOLD = 1e5;

// === CPU Worker Pool ===
const cpuOverlay = document.getElementById('cpu-overlay');
const ctxCpu = cpuOverlay.getContext('2d');
const numWorkers = navigator.hardwareConcurrency || 4;
const workers = [];
let pendingTiles = [];

function initWorkers() {
    const numWorkers = navigator.hardwareConcurrency || 4;
    for (let i = 0; i < numWorkers; i++) {
        const w = new Worker('fractal-worker.js');
        w.onmessage = onWorkerMessage;
        workers.push(w);
    }
}

function onWorkerMessage(e) {
    if (e.data.type === 'buddhabrotChunk') {
        e.target.buddhabrotBusy = false;
        if (state.fractalMode !== 7) return;
        const chunk = e.data.histogram;
        const hist = state.buddhabrotHistogram;
        if (!hist) return;
        for (let j = 0; j < chunk.length; j++) {
            hist[j] += chunk[j];
            if (hist[j] > state.buddhabrotMax) state.buddhabrotMax = hist[j];
        }
        return;
    }

    const { tile, pixels, version } = e.data;
    if (version !== state.cpuRenderVersion) return;

    drawTile(tile, pixels);
    state.cpuTilesDone++;
    updateProgress();
    
    if (pendingTiles.length > 0) {
        const next = pendingTiles.pop();
        
        // High-precision delta calculation in main thread
        const baseDcx = state.cx.minus(state.refCx).toNumber();
        const baseDcy = state.cy.minus(state.refCy).toNumber();

        const workerRefOrbit = state.workerRefOrbit;

        e.target.postMessage({
            tile: next,
            canvasW: canvas.width,
            canvasH: canvas.height,
            viewW: 3.0 * (canvas.width / canvas.height) / state.zoom,
            viewH: 3.0 / state.zoom,
            baseDcx, baseDcy,
            refOrbit: workerRefOrbit,
            refLen: state.refOrbitLen,
            cx: state.cx.toNumber(),
            cy: state.cy.toNumber(),
            refCx: state.refCx.toNumber(),
            refCy: state.refCy.toNumber(),
            zoom: state.zoom,
            maxIter: state.maxIter,
            paletteIdx: state.palette,
            colorCycle: state.colorCycle,
            fractalMode: state.fractalMode,
            version: state.cpuRenderVersion
        }); // Removed transfer of buffer because it's shared across workers now
    } else {
        if (state.cpuTilesDone >= state.cpuTilesTotal) {
            document.getElementById('progress-container').classList.add('hidden');
            state.cpuTilesTotal = 0;
            state.cpuTilesDone = 0;
        }
    }
}

function updateProgress() {
    const container = document.getElementById('progress-container');
    const bar = document.getElementById('progress-bar');
    const label = document.getElementById('progress-label');
    if (state.cpuTilesTotal > 0) {
        const p = Math.min(100, (state.cpuTilesDone / state.cpuTilesTotal) * 100);
        bar.style.width = p + '%';
        label.textContent = `Rendering… ${Math.round(p)}%`;
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

function drawTile(tile, pixels) {
    const { x, y, w, h } = tile;
    const imgData = new ImageData(new Uint8ClampedArray(pixels), w, h);
    ctxCpu.putImageData(imgData, x, y);
}

function startCpuRender() {
    console.log("Starting CPU High-Precision Render (Perturbation)...");
    state.cpuRenderVersion++;
    cpuOverlay.width = canvas.width;
    cpuOverlay.height = canvas.height;
    cpuOverlay.style.display = 'block';
    ctxCpu.clearRect(0, 0, cpuOverlay.width, cpuOverlay.height);
    
    const tileSize = 128;
    pendingTiles = [];
    for (let y = 0; y < cpuOverlay.height; y += tileSize) {
        for (let x = 0; x < cpuOverlay.width; x += tileSize) {
            pendingTiles.push({ 
                x, y, 
                w: Math.min(tileSize, cpuOverlay.width - x), 
                h: Math.min(tileSize, cpuOverlay.height - y) 
            });
        }
    }
    
    state.cpuTilesTotal = pendingTiles.length;
    state.cpuTilesDone = 0;
    updateProgress();
    
    if (workers.length === 0) {
        console.error("No workers initialized!");
        return;
    }

    const workerRefOrbit = state.workerRefOrbit;

    workers.forEach(w => {
        if (pendingTiles.length > 0) {
            const next = pendingTiles.pop();
            
            const baseDcx = state.cx.minus(state.refCx).toNumber();
            const baseDcy = state.cy.minus(state.refCy).toNumber();

            w.postMessage({
                tile: next,
                canvasW: canvas.width,
                canvasH: canvas.height,
                viewW: 3.0 * (canvas.width / canvas.height) / state.zoom,
                viewH: 3.0 / state.zoom,
                baseDcx, baseDcy,
                refOrbit: workerRefOrbit,
                refLen: state.refOrbitLen,
                cx: state.cx.toNumber(),
                cy: state.cy.toNumber(),
                refCx: state.refCx.toNumber(),
                refCy: state.refCy.toNumber(),
                zoom: state.zoom,
                maxIter: state.maxIter,
                paletteIdx: state.palette,
                colorCycle: state.colorCycle,
                fractalMode: state.fractalMode,
                version: state.cpuRenderVersion
            });
        }
    });
}

// === Reference Orbit Calculation (for Perturbation) ===
function computeReferenceOrbit() {
    // More aggressive iteration scaling for deep zoom contrast
    const zoomLog = Math.log10(state.zoom + 1);
    const targetIter = Math.floor(800 + zoomLog * 250);
    // Allow manual override if user has changed it, but keep a sensible floor
    state.maxIter = Math.max(state.maxIter, Math.min(15000, targetIter));

    const prec = Math.max(40, Math.ceil(zoomLog * 2) + 40);
    Decimal.set({ precision: prec });
    
    const data = new Float32Array(state.maxIter * 4);
    let zx = new Decimal(0), zy = new Decimal(0);
    let cx = state.cx, cy = state.cy;
    
    state.refCx = cx;
    state.refCy = cy;
    
    let i = 0;
    for (i = 0; i < state.maxIter; i++) {
        const fx = zx.toNumber(), fy = zy.toNumber();
        data[i*4+0] = Math.fround(fx); data[i*4+1] = fx - data[i*4+0];
        data[i*4+2] = Math.fround(fy); data[i*4+3] = fy - data[i*4+2];
        
        const zx2 = zx.mul(zx), zy2 = zy.mul(zy);
        if (zx2.plus(zy2).gt(1000000)) break; 
        
        const nzy = zx.mul(zy).mul(2).plus(cy);
        zx = zx2.minus(zy2).plus(cx);
        zy = nzy;
    }
    state.refOrbitLen = i;
    state.refOrbitData = data;

    // Prepare full-precision orbit for workers
    const workerData = new Float64Array(i * 2);
    for (let j = 0; j < i; j++) {
        workerData[j*2] = data[j*4] + data[j*4+1];
        workerData[j*2+1] = data[j*4+2] + data[j*4+3];
    }
    state.workerRefOrbit = workerData;

    if (!refOrbitTex) {
        refOrbitTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, refOrbitTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, refOrbitTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, state.maxIter, 1, 0, gl.RGBA, gl.FLOAT, data);
}

function markOrbitDirty() { state.refOrbitDirty = true; }

// === Palette Functions for JS ===
function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function getColor(smoothIter, maxIter, paletteIdx, colorCycle) {
    const p = PALETTES[paletteIdx] || PALETTES[0];
    const colors = p.colors;
    let f = Math.sqrt(smoothIter / maxIter) * 64.0 + colorCycle;
    const count = colors.length;
    let t = (f % count + count) % count;
    const i1 = Math.floor(t);
    const i2 = (i1 + 1) % count;
    const frac = t - i1;
    const c1 = hexToRgb(colors[i1]);
    const c2 = hexToRgb(colors[i2]);
    return [
        (c1[0] + (c2[0] - c1[0]) * frac),
        (c1[1] + (c2[1] - c1[1]) * frac),
        (c1[2] + (c2[2] - c1[2]) * frac)
    ];
}

// === Render Loop ===
let cpuDebounceTimer = null;
function renderBuddhabrot() {
    if (!state.buddhabrotActive) return;
    
    // Request new chunks from workers
    workers.forEach(w => {
        if (!w.buddhabrotBusy) {
            w.buddhabrotBusy = true;
            w.postMessage({
                type: 'buddhabrot',
                w: canvas.width,
                h: canvas.height,
                cx: state.cx.toNumber(),
                cy: state.cy.toNumber(),
                zoom: state.zoom,
                maxIter: 200,
                minIter: 20,
                samples: 5000
            });
        }
    });

    // Draw current histogram
    const w = canvas.width, h = canvas.height;
    const imgData = ctxCpu.createImageData(w, h);
    const data = imgData.data;
    const hist = state.buddhabrotHistogram;
    const max = state.buddhabrotMax || 1;
    
    for (let i = 0; i < w * h; i++) {
        const val = hist[i];
        if (val > 0) {
            // Logarithmic scaling for better contrast
            const norm = Math.log(val + 1) / Math.log(max + 1);
            const col = getColor(norm * 32, 100, state.palette, state.colorCycle);
            const idx = i * 4;
            data[idx] = col[0];
            data[idx+1] = col[1];
            data[idx+2] = col[2];
            data[idx+3] = 255;
        } else {
            const idx = i * 4;
            data[idx] = 0; data[idx+1] = 0; data[idx+2] = 0; data[idx+3] = 255;
        }
    }
    ctxCpu.putImageData(imgData, 0, 0);
}

function render() {
    if (state.fractalMode === 7) {
        updateUI();
        return; 
    }
    
    const useCPU = state.zoom > ZOOM_THRESHOLD;
    const usePerturbation = false; // Disabled, using stable df64 instead

    // GPU Shader setup
    gl.useProgram(program);
    gl.uniform2f(uLocs.u_resolution, canvas.width, canvas.height);
    gl.uniform1i(uLocs.u_maxIter, state.maxIter);
    gl.uniform1i(uLocs.u_palette, state.palette);
    gl.uniform1f(uLocs.u_colorCycle, state.colorCycle);
    gl.uniform1f(uLocs.u_time, state.animTime);
    gl.uniform1i(uLocs.u_fractalMode, state.fractalMode);

    // Coordinate math
    const cxf = state.cx.toNumber(), cyf = state.cy.toNumber();
    const pixelScale = 3.0 / (state.zoom * canvas.height);

    const juliaCx = state.juliaC.x.toNumber(), juliaCy = state.juliaC.y.toNumber();
    gl.uniform4f(uLocs.u_juliaC, Math.fround(juliaCx), juliaCx - Math.fround(juliaCx), Math.fround(juliaCy), juliaCy - Math.fround(juliaCy));

    if (useCPU) {
        // CPU High-Precision Mode
        if (!state.refOrbitData || state.refOrbitDirty) {
            computeReferenceOrbit();
            state.refOrbitDirty = false;
        }
        const isMoving = Math.abs(state.targetZoom - state.zoom) / state.zoom > 0.02 ||
                         state.targetCx.minus(state.cx).abs().div(3.0 / state.zoom).toNumber() > 0.02;
        
        const prec = Math.max(2, Math.floor(Math.log10(state.zoom)) + 2);
        const renderKey = `${state.cx.toFixed(prec)}|${state.cy.toFixed(prec)}|${state.zoom.toExponential(2)}|${state.palette}|${state.fractalMode}|${state.juliaC.x}|${state.juliaC.y}`;
        
        if (!isMoving) {
            if (state.lastRenderKey !== renderKey) {
                state.lastRenderKey = renderKey;
                clearTimeout(cpuDebounceTimer);
                cpuDebounceTimer = setTimeout(() => { startCpuRender(); }, 50);
            }
        } else {
            clearTimeout(cpuDebounceTimer);
            if (state.cpuTilesDone === 0) cpuOverlay.style.display = 'none';
        }

        gl.uniform1i(uLocs.u_mode, 0); 
        const cx_hi = Math.fround(cxf), cx_lo = cxf - cx_hi;
        const cy_hi = Math.fround(cyf), cy_lo = cyf - cy_hi;
        gl.uniform4f(uLocs.u_center, cx_hi, cx_lo, cy_hi, cy_lo);
        gl.uniform1f(uLocs.u_scale, pixelScale);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (usePerturbation) {
        if (!state.refOrbitData || state.refOrbitDirty) {
            computeReferenceOrbit();
            state.refOrbitDirty = false;
        }
        if (cpuOverlay) cpuOverlay.style.display = 'none';
        gl.uniform1i(uLocs.u_mode, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, refOrbitTex);
        gl.uniform1i(uLocs.u_refOrbit, 0);
        gl.uniform1i(uLocs.u_refLen, state.refOrbitLen);
        gl.uniform2f(uLocs.u_refOffset, 0, 0);
        gl.uniform1f(uLocs.u_pixelScale, pixelScale);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
        if (cpuOverlay) cpuOverlay.style.display = 'none';
        gl.uniform1i(uLocs.u_mode, 0);
        const cx_hi = Math.fround(cxf), cx_lo = cxf - cx_hi;
        const cy_hi = Math.fround(cyf), cy_lo = cyf - cy_hi;
        gl.uniform4f(uLocs.u_center, cx_hi, cx_lo, cy_hi, cy_lo);
        gl.uniform1f(uLocs.u_scale, pixelScale);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    detectInsideSet();
    updateUI();
}

function detectInsideSet() {
    const isDeep = state.zoom > 1000;
}

function formatZoom(z) {
    const zoomVal = new Decimal(z);
    
    if (state.zoomFormat === 'scientific') {
        if (zoomVal.lt(1000)) return Math.round(zoomVal.toNumber()).toLocaleString() + 'x';
        return zoomVal.toExponential(2) + 'x';
    }
    
    if (zoomVal.lt(1000)) return Math.round(zoomVal.toNumber()).toLocaleString() + 'x';
    if (zoomVal.lt(1000000)) return zoomVal.dividedBy(1000).toFixed(1).replace('.', ',') + ' Tausend';

    const exp = zoomVal.e;
    const n = Math.floor(exp / 6);
    const isIliarde = exp % 6 >= 3;
    
    const ones = ["", "Un", "Duo", "Tre", "Quattuor", "Quinqua", "Sex", "Septen", "Okto", "Novem"];
    const tens = ["", "dezi", "viginti", "triginta", "quadraginta", "quinquaginta", "sexaginta", "septuaginta", "oktoginta", "nonaginta"];
    const hundreds = ["", "zenti"]; 
    
    let prefix = "";
    if (n < 10) {
        const simple = ["", "Mi", "Bi", "Tri", "Quadri", "Quinti", "Sexti", "Septi", "Okti", "Noni"];
        prefix = simple[n];
    } else if (n === 100) {
        prefix = "Zenti";
    } else {
        const u = n % 10;
        const t = Math.floor(n / 10) % 10;
        const h = Math.floor(n / 100) % 10;
        prefix = ones[u] + tens[t] + (hundreds[h] || "");
    }
    
    prefix = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
    const name = prefix + (isIliarde ? "lliarden" : "llionen");
    
    const divisor = new Decimal(10).pow(isIliarde ? n * 6 + 3 : n * 6);
    const val = zoomVal.dividedBy(divisor);
    
    return val.toFixed(2).replace('.', ',') + ' ' + name;
}


function updateUI() {
    const t = TRANSLATIONS[state.lang];
    const versionEl = document.getElementById('info-version');
    if (versionEl) versionEl.textContent = 'v2.0';

    const titleEl = document.getElementById('info-title');
    const modeIcon = document.getElementById('mode-icon');
    const modeTitles = [t.mandelbrot, t.julia, t.burning_ship, t.tricorn, t.mandel_z3, t.newton, t.mandelbulb, t.buddhabrot];
    if (titleEl) titleEl.textContent = modeTitles[state.fractalMode] || '???';
    
    if (modeIcon) {
        const icons = ['M', 'J', 'B', 'T', '3', 'N', '3D', 'ॐ'];
        modeIcon.textContent = icons[state.fractalMode] || 'F';
    }

    // Update Core Data
    document.getElementById('info-re').textContent = state.cx.toFixed(10);
    document.getElementById('info-im').textContent = state.cy.toFixed(10);
    document.getElementById('info-zoom').textContent = formatZoom(state.zoom);
    document.getElementById('info-iter').textContent = state.maxIter;
    document.getElementById('info-mode').textContent = (state.zoom > ZOOM_THRESHOLD ? 'CPU ∞' : 'GPU f64');

    // Localize Labels
    const labelMap = {
        'info-re-label': t.re, 'info-im-label': t.im, 'info-zoom-label': t.zoom,
        'info-iter-label': t.iterations, 'info-mode-label': t.mode,
        'info-fps-label': t.fps, 'info-version-label': t.version, 'formula-label-text': t.formula
    };
    for (const [id, val] of Object.entries(labelMap)) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    // Help Box Localization
    const helpMap = {
        'help-title': t.what_is_fractal, 'help-desc': t.fractal_desc,
        'magic-title': t.magic_formula, 'magic-desc': t.magic_desc,
        'black-title': t.why_black, 'trapped-label': t.trapped, 'trapped-desc': t.trapped_desc,
        'escape-label': t.escape, 'escape-desc': t.escape_desc,
        'color-title': t.color_origin, 'color-desc': t.color_desc,
        'ctrl-title': t.controls, 'ctrl-scroll': t.ctrl_scroll,
        'ctrl-drag': t.ctrl_drag, 'ctrl-shift': t.ctrl_shift, 'ctrl-keys': t.ctrl_keys
    };
    for (const [id, val] of Object.entries(helpMap)) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = val;
    }

    // Tooltips
    const tooltipMap = {
        'btn-reset': t.reset_view, 'btn-screenshot': t.screenshot, 'btn-fullscreen': t.fullscreen,
        'btn-zoom-mode': t.zoom_mode, 'btn-mode-toggle': t.change_mode,
        'btn-help-toggle': t.help, 'btn-info-toggle': t.toggle_info, 'btn-lang-toggle': t.change_lang
    };
    for (const [id, val] of Object.entries(tooltipMap)) {
        const el = document.getElementById(id);
        if (el) el.title = val;
    }

    const langIcon = document.getElementById('lang-icon');
    if (langIcon) langIcon.textContent = state.lang.toUpperCase();

    const formulaBase = document.getElementById('formula-base');
    const juliaInputs = document.getElementById('julia-c-inputs');
    const mandelText = document.getElementById('mandel-c-text');

    if (formulaBase) {
        if (state.fractalMode === 7) formulaBase.innerHTML = t.buddhabrot + ' (Accumulation)';
        else if (state.fractalMode === 6) formulaBase.innerHTML = t.mandelbulb + ' (Raymarching)';
        else if (state.fractalMode === 5) formulaBase.innerHTML = 'z<sub>n+1</sub> = z<sub>n</sub> - (z<sub>n</sub><sup>3</sup> - 1) / (3z<sub>n</sub><sup>2</sup>)';
        else if (state.fractalMode === 4) formulaBase.innerHTML = 'z<sub>n+1</sub> = z<sub>n</sub><sup>3</sup> + ';
        else if (state.fractalMode === 3) formulaBase.innerHTML = 'z<sub>n+1</sub> = conj(z<sub>n</sub>)<sup>2</sup> + ';
        else if (state.fractalMode === 2) formulaBase.innerHTML = 'z<sub>n+1</sub> = (|Re(z)| + i|Im(z)|)<sup>2</sup> + ';
        else formulaBase.innerHTML = 'z<sub>n+1</sub> = z<sub>n</sub><sup>2</sup> + ';
    }
    
    const isJulia = state.fractalMode === 1;
    if (isJulia) {
        if (juliaInputs && mandelText) {
            juliaInputs.classList.toggle('hidden', false);
            mandelText.classList.toggle('hidden', true);
            updateSteppers();
        }
    } else {
        if (juliaInputs && mandelText) {
            juliaInputs.classList.toggle('hidden', true);
            mandelText.classList.toggle('hidden', false);
        }
    }
    
    if (mandelText) mandelText.classList.toggle('hidden', state.fractalMode >= 5);
    if (minimap) minimap.classList.toggle('hidden', !state.showUI);
    if (bookmarks) bookmarks.classList.toggle('hidden', !state.showUI || state.fractalMode !== 0);
    
    updateMinimap();
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
    updateSteppers();
}

// === Minimap ===
const minimapCanvas = document.getElementById('minimap-canvas');
const ctxMinimap = minimapCanvas.getContext('2d');
let minimapBaseImg = null;
let minimapBaseMode = -1;

function renderMinimapBase() {
    const w = minimapCanvas.width, h = minimapCanvas.height;
    const imgData = ctxMinimap.createImageData(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let zx, zy, cx, cy;
            if (state.fractalMode === 1 || state.fractalMode === 5) { // Julia or Newton
                zx = (x / w - 0.5) * 3.0;
                zy = (0.5 - y / h) * 3.0;
                cx = 0; cy = 0; 
            } else { // Others (Mandelbrot, Ship, etc)
                zx = 0; zy = 0;
                cx = (x / w - 0.5) * 3.0 - 0.5;
                cy = (0.5 - y / h) * 3.0;
            }
            let iter = 0;
            for (let i = 0; i < 64; i++) {
                let nzx, nzy;
                if (state.fractalMode === 1) { // Julia
                    nzx = zx*zx - zy*zy + state.juliaC.x.toNumber();
                    nzy = 2*zx*zy + state.juliaC.y.toNumber();
                } else if (state.fractalMode === 2) { // Burning Ship
                    nzx = zx*zx - zy*zy + cx;
                    nzy = Math.abs(2*zx*zy) + cy;
                } else if (state.fractalMode === 3) { // Tricorn
                    nzx = zx*zx - zy*zy + cx;
                    nzy = -2*zx*zy + cy;
                } else if (state.fractalMode === 4) { // z3
                    const x2 = zx*zx, y2 = zy*zy;
                    nzx = zx * (x2 - 3*y2) + cx;
                    nzy = zy * (3*x2 - y2) + cy;
                } else if (state.fractalMode === 5) { // Newton
                    const x2 = zx*zx, y2 = zy*zy;
                    const x3 = zx * (x2 - 3*y2);
                    const y3 = zy * (3*x2 - y2);
                    const num_re = 2.0 * x3 + 1.0;
                    const num_im = 2.0 * y3;
                    const den_re = 3.0 * (x2 - y2);
                    const den_im = 6.0 * zx * zy;
                    const d2 = den_re * den_re + den_im * den_im;
                    if (d2 < 1e-10) break;
                    nzx = (num_re * den_re + num_im * den_im) / d2;
                    nzy = (num_im * den_re - num_re * den_im) / d2;
                    // Roots
                    if ((nzx-1)**2 + nzy**2 < 0.01) { iter = i + 1; break; }
                    if ((nzx+0.5)**2 + (nzy-0.866)**2 < 0.01) { iter = i + 1000; break; }
                    if ((nzx+0.5)**2 + (nzy+0.866)**2 < 0.01) { iter = i + 2000; break; }
                } else if (state.fractalMode === 6) { // Mandelbulb (Static preview)
                    iter = 32; break; 
                } else { // Mandelbrot
                    nzx = zx*zx - zy*zy + cx;
                    nzy = 2*zx*zy + cy;
                }
                zx = nzx; zy = nzy;
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
    if (!state.showUI || state.fractalMode === 7) return;
    if (!minimapBaseImg || typeof minimapBaseMode === 'undefined' || minimapBaseMode !== state.fractalMode) {
        renderMinimapBase();
        minimapBaseMode = state.fractalMode;
    }
    if (minimapBaseImg) ctxMinimap.putImageData(minimapBaseImg, 0, 0);
    const w = minimapCanvas.width, h = minimapCanvas.height;
    const viewWidth = 3.0 / state.zoom;
    const viewHeight = (viewWidth * canvas.height) / canvas.width;
    const mx = ((state.cx.toNumber() + 0.5) / 3.0 + 0.5) * w;
    const my = (0.5 - state.cy.toNumber() / 3.0) * h; // Inverted Y
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
        const fpsEl = document.getElementById('info-fps');
        if (fpsEl) fpsEl.textContent = Math.round(frameCount * 1000 / (now - fpsTime));
        frameCount = 0; fpsTime = now;
    }
}

// === Screenshot ===
function screenshot() {
    const useCPU = state.zoom > ZOOM_THRESHOLD;
    
    const modeNames = ['Mandelbrot', 'Julia', 'BurningShip', 'Tricorn', 'MandelZ3', 'Newton', 'Mandelbulb', 'Buddhabrot'];
    const modeName = modeNames[state.fractalMode] || 'Fractal';
    const zoomStr = state.zoom < 10000 ? Math.round(state.zoom) + 'x' : new Decimal(state.zoom).toExponential(2).replace('+','') + 'x';
    const baseFilename = `${modeName}_${zoomStr}_${Date.now()}`;
    
    if (useCPU) {
        // In CPU mode, we capture the current state to avoid re-rendering (which takes time)
        // and precision artifacts from the high-res trick.
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        tempCtx.drawImage(canvas, 0, 0);
        if (cpuOverlay.style.display !== 'none') {
            tempCtx.drawImage(cpuOverlay, 0, 0);
        }

        const link = document.createElement('a');
        link.download = `${baseFilename}_deep.png`;
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
        return;
    }

    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    const highResW = originalWidth * 2;
    const highResH = originalHeight * 2;

    canvas.width = highResW;
    canvas.height = highResH;
    gl.viewport(0, 0, highResW, highResH);
    render(); 

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = highResW;
    tempCanvas.height = highResH;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.drawImage(canvas, 0, 0);
    
    const link = document.createElement('a');
    link.download = `${baseFilename}_hires.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();

    canvas.width = originalWidth;
    canvas.height = originalHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    render();
}

// === Fullscreen ===
function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
}

// === UI Visibility ===
function toggleUIVisibility() {
    ['info-panel','palette-picker','bookmarks','minimap','formula-bar','help-toast','controls'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !state.showUI);
    });
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
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 7; i++) {
            const digit = document.createElement('div');
            digit.className = 'stepper-digit';
            if (i === 2) { digit.innerHTML = '<span class="digit-val">.</span>'; } 
            else {
                const btnDown = document.createElement('button');
                btnDown.className = 'step-btn'; btnDown.textContent = '−';
                btnDown.onclick = () => stepDigit(part, i, -1);
                const val = document.createElement('span');
                val.className = 'digit-val'; val.id = `digit-${part}-${i}`;
                val.textContent = '0';
                const btnUp = document.createElement('button');
                btnUp.className = 'step-btn'; btnUp.textContent = '+';
                btnUp.onclick = () => stepDigit(part, i, 1);
                digit.appendChild(btnDown); digit.appendChild(val); digit.appendChild(btnUp);
            }
            container.appendChild(digit);
        }
    });
}

function updateSteppers() {
    ['cx', 'cy'].forEach(part => {
        const num = state.juliaC[part === 'cx' ? 'x' : 'y'];
        const s = num.toFixed(5).padStart(8, ' '); 
        const chars = s.split('');
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
    if (idx === 0) change = new Decimal(delta * 2); 
    else if (idx === 1) change = new Decimal(delta);
    else if (idx > 2) change = new Decimal(delta).times(new Decimal(10).pow(-(idx - 2)));
    state.juliaC[part === 'cx' ? 'x' : 'y'] = num.plus(change);
    markOrbitDirty();
    renderMinimapBase();
    scheduleRender();
    updateSteppers();
}

function toggleFractalMode() {
    setFractalMode((state.fractalMode + 1) % 8);
}

function setFractalMode(mode) {
    state.fractalMode = mode;
    state.refOrbitData = null;
    markOrbitDirty();
    
    // Reset view for specific modes if needed
    if (state.fractalMode === 1) {
        // Julia: center at 0,0
        state.targetZoom = 1.0; state.targetCx = new Decimal(0); state.targetCy = new Decimal(0);
    } else if (state.fractalMode === 2) {
        // Burning Ship
        state.targetZoom = 1.0; state.targetCx = new Decimal('-0.5'); state.targetCy = new Decimal('-0.5');
    } else if (state.fractalMode === 5 || state.fractalMode === 6) {
        // Newton or Mandelbulb
        state.targetZoom = 1.0; state.targetCx = new Decimal(0); state.targetCy = new Decimal(0);
    } else if (state.fractalMode === 7) {
        // Buddhabrot init
        state.targetZoom = 1.0; state.targetCx = new Decimal('-0.5'); state.targetCy = new Decimal('0.0');
        state.buddhabrotHistogram = new Uint32Array(canvas.width * canvas.height);
        state.buddhabrotMax = 0;
        state.buddhabrotActive = true;
        if (cpuOverlay) cpuOverlay.style.display = 'block';
    } else {
        // Others: default view
        state.buddhabrotActive = false;
        if (cpuOverlay) cpuOverlay.style.display = 'none';
        goToBookmark(BOOKMARKS[0]);
    }
    
    renderMinimapBase();
    updateUI();
}

function toggleLanguage() {
    const langs = ['de', 'en', 'hu', 'es', 'fr', 'pt', 'zh', 'ja', 'ko'];
    state.lang = langs[(langs.indexOf(state.lang) + 1) % langs.length];
    updateUI();
}

function toggleZoomMode() {
    state.selectionMode = !state.selectionMode;
    const btn = document.getElementById('btn-zoom-mode');
    if (btn) btn.classList.toggle('active', state.selectionMode);
    canvas.style.cursor = state.selectionMode ? 'crosshair' : 'default';
}

// === Interaction ===
let isDragging = false;
let isSelecting = false;
let selectStartX, selectStartY;
const selectionBox = document.getElementById('selection-box');
let dragStartX, dragStartY, dragCx, dragCy;
let lastTouchDist = 0;
let lastTouchX = 0, lastTouchY = 0;

canvas.addEventListener('mousedown', (e) => {
    if (e.shiftKey || state.selectionMode) {
        isSelecting = true;
        selectStartX = e.clientX;
        selectStartY = e.clientY;
        selectionBox.style.display = 'block';
        selectionBox.style.left = e.clientX + 'px';
        selectionBox.style.top = e.clientY + 'px';
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
    } else {
        isDragging = true;
        dragStartX = e.clientX; dragStartY = e.clientY;
        dragCx = state.targetCx; dragCy = state.targetCy;
    }
});

window.addEventListener('mousemove', (e) => {
    if (isSelecting) {
        const x = Math.min(e.clientX, selectStartX);
        const y = Math.min(e.clientY, selectStartY);
        const w = Math.abs(e.clientX - selectStartX);
        const h = Math.abs(e.clientY - selectStartY);
        selectionBox.style.left = x + 'px';
        selectionBox.style.top = y + 'px';
        selectionBox.style.width = w + 'px';
        selectionBox.style.height = h + 'px';
    } else if (isDragging) {
        const viewWidth = 3.0 / state.zoom;
        const viewHeight = (viewWidth * canvas.height) / canvas.width;
        const dx = (e.clientX - dragStartX) / window.innerWidth * viewWidth;
        const dy = (e.clientY - dragStartY) / window.innerHeight * viewHeight;
        state.targetCx = dragCx.minus(new Decimal(dx));
        state.targetCy = dragCy.plus(new Decimal(dy));
    }
});

function finishSelection(clientX, clientY) {
    if (!isSelecting) return;
    isSelecting = false;
    selectionBox.style.display = 'none';
    
    const rect = canvas.getBoundingClientRect();
    const x1 = selectStartX - rect.left;
    const y1 = selectStartY - rect.top;
    const x2 = clientX - rect.left;
    const y2 = clientY - rect.top;
    
    const boxW = Math.abs(x2 - x1);
    const boxH = Math.abs(y2 - y1);
    
    if (boxW > 5 && boxH > 5) {
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        
        const viewHeight = 3.0 / state.zoom;
        const viewWidth = viewHeight * (canvas.width / canvas.height);
        
        const dx = (centerX / rect.width - 0.5) * viewWidth;
        const dy = (centerY / rect.height - 0.5) * viewHeight;
        
        state.cx = state.cx.plus(new Decimal(dx));
        state.cy = state.cy.minus(new Decimal(dy));
        state.targetCx = state.cx;
        state.targetCy = state.cy;
        
        const zoomFactor = Math.min(rect.width / boxW, rect.height / boxH);
        state.zoom *= zoomFactor;
        state.targetZoom = state.zoom;
        markOrbitDirty();

        // Auto-disable selection mode after zoom on mobile
        if (state.selectionMode) toggleZoomMode();
    }
}

window.addEventListener('mouseup', (e) => {
    if (isSelecting) {
        finishSelection(e.clientX, e.clientY);
    } else if (isDragging) {
        if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < 8) {
            const rect = canvas.getBoundingClientRect();
            const dx = (e.clientX - rect.left) / rect.width - 0.5;
            const dy = (e.clientY - rect.top) / rect.height - 0.5;
            const viewWidth = 3.0 / state.zoom;
            state.targetCx = state.cx.plus(new Decimal(dx * viewWidth));
            state.targetCy = state.cy.minus(new Decimal(dy * viewWidth * canvas.height / canvas.width));
            markOrbitDirty();
        }
        isDragging = false;
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.targetZoom *= Math.exp(-e.deltaY * 0.0005); // Reduced sensitivity
}, { passive: false });

canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        if (state.selectionMode) {
            isSelecting = true;
            selectStartX = lastTouchX;
            selectStartY = lastTouchY;
            selectionBox.style.display = 'block';
            selectionBox.style.left = selectStartX + 'px';
            selectionBox.style.top = selectStartY + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
        } else {
            isDragging = true;
            dragStartX = lastTouchX; dragStartY = lastTouchY;
            dragCx = state.targetCx; dragCy = state.targetCy;
        }
    } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        if (isSelecting) {
            const x = Math.min(lastTouchX, selectStartX);
            const y = Math.min(lastTouchY, selectStartY);
            const w = Math.abs(lastTouchX - selectStartX);
            const h = Math.abs(lastTouchY - selectStartY);
            selectionBox.style.left = x + 'px';
            selectionBox.style.top = y + 'px';
            selectionBox.style.width = w + 'px';
            selectionBox.style.height = h + 'px';
        } else if (isDragging) {
            const viewWidth = 3.0 / state.zoom;
            const dx = (lastTouchX - dragStartX) / window.innerWidth * viewWidth;
            const dy = (lastTouchY - dragStartY) / window.innerHeight * (viewWidth * canvas.height / canvas.width);
            state.targetCx = dragCx.minus(new Decimal(dx));
            state.targetCy = dragCy.plus(new Decimal(dy));
        }
    } else if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        state.targetZoom *= (dist / lastTouchDist);
        lastTouchDist = dist;
    }
}, { passive: false });

canvas.addEventListener('touchend', () => {
    if (isSelecting) {
        finishSelection(lastTouchX, lastTouchY);
    }
    isDragging = false; 
    markOrbitDirty(); 
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { state.maxIter = Math.floor(state.maxIter * 1.2); markOrbitDirty(); updateUI(); scheduleRender(); }
    if (e.key === 'ArrowDown') { state.maxIter = Math.max(100, Math.floor(state.maxIter / 1.2)); markOrbitDirty(); updateUI(); scheduleRender(); }

    switch (e.key.toLowerCase()) {
        case 'm': setFractalMode(0); break;
        case 'j': setFractalMode(1); break;
        case 'b': setFractalMode(2); break;
        case 't': setFractalMode(3); break;
        case '3': setFractalMode(4); break;
        case 'n': setFractalMode(5); break;
        case 'p': state.palette = (state.palette + 1) % PALETTES.length; updatePalettePicker(); break;
        case 'r': goToBookmark(BOOKMARKS[0]); break;
        case 's': screenshot(); break;
        case 'z': toggleZoomMode(); break;
        case 'f': toggleFullscreen(); break;
        case 'i': state.showUI = !state.showUI; toggleUIVisibility(); break;
        case 'h': toggleInfoBox(); break;
    }
});

let renderPending = false;
function scheduleRender() {
    if (!renderPending) { renderPending = true; requestAnimationFrame(() => { renderPending = false; render(); }); }
}

let lastFrameTime = performance.now();
function animationLoop(now) {
    requestAnimationFrame(animationLoop);
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (dt > 0.2) return;
    state.animTime += dt;
    state.colorCycle += dt * 0.08; 
    // Separate lerp for position (faster) and zoom (smooth)
    const zoomLerp = 1 - Math.pow(0.4, dt); 
    const panLerp = 1 - Math.pow(0.1, dt); // Much faster pan
    
    let moved = false;
    const zoomDiff = Math.abs(state.targetZoom - state.zoom) / state.zoom;
    if (zoomDiff > 0.0001) {
        state.zoom = Math.exp(Math.log(state.zoom) + (Math.log(state.targetZoom) - Math.log(state.zoom)) * zoomLerp);
        moved = true;
    } else {
        state.zoom = state.targetZoom;
    }
    
    const cxDiff = state.targetCx.minus(state.cx).toNumber();
    const cyDiff = state.targetCy.minus(state.cy).toNumber();
    if (Math.abs(cxDiff) > 1e-30 || Math.abs(cyDiff) > 1e-30) {
        state.cx = state.cx.plus(new Decimal(cxDiff * panLerp));
        state.cy = state.cy.plus(new Decimal(cyDiff * panLerp));
        moved = true;
    }
    
    if (moved && state.fractalMode === 7 && state.buddhabrotHistogram) {
        state.buddhabrotHistogram.fill(0);
        state.buddhabrotMax = 0;
    }
    if (state.fractalMode === 7) renderBuddhabrot();
    render();
    updateFPS();
}

function wireButtons() {
    const actions = {
        'btn-reset': () => goToBookmark(BOOKMARKS[0]),
        'btn-screenshot': () => screenshot(),
        'btn-fullscreen': () => toggleFullscreen(),
        'btn-zoom-mode': () => toggleZoomMode(),
        'btn-mode-toggle': () => toggleFractalMode(),
        'btn-help-toggle': () => toggleInfoBox(),
        'btn-info-toggle': () => { state.showUI = !state.showUI; toggleUIVisibility(); },
        'btn-lang-toggle': () => toggleLanguage(),
        'info-box-backdrop': () => toggleInfoBox(),
        'btn-iter-up': () => { state.maxIter = Math.floor(state.maxIter * 1.2); markOrbitDirty(); updateUI(); scheduleRender(); },
        'btn-iter-down': () => { state.maxIter = Math.max(100, Math.floor(state.maxIter / 1.2)); markOrbitDirty(); updateUI(); scheduleRender(); }
    };
    for (const [id, fn] of Object.entries(actions)) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    }

    const zoomInfo = document.getElementById('info-zoom');
    if (zoomInfo) {
        zoomInfo.parentElement.style.cursor = 'pointer';
        zoomInfo.parentElement.title = 'Klicken, um Format zu wechseln';
        zoomInfo.parentElement.addEventListener('click', () => {
            state.zoomFormat = state.zoomFormat === 'words' ? 'scientific' : 'words';
            updateUI();
        });
    }
}

function init() {
    Decimal.set({ precision: 40 });
    resize(); initProgram(); initPalettePicker(); initBookmarks(); initSteppers(); wireButtons();
    renderMinimapBase(); initWorkers(); requestAnimationFrame(animationLoop);
}
init();
})();
