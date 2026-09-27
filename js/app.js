// app.js — Fraktal-Explorer v5: Zustand, Kamera, Gesten, Render-Orchestrierung, Worker.
//
// Architektur (Details README / V5_BERICHT.md):
//  * Kamera: Mitte als BigInt-Fixpunkt (js/hp.js), Zoom als double. Gesten verändern die Kamera
//    DIREKT (kein Nachzieh-Lerp); Trägheit/Flüge animieren sie zeitbasiert.
//  * Jede Ansicht wird in einen Iterationspuffer gerechnet (GPU oder CPU-Worker) und vom
//    Display-Pass auf die aktuelle Kamera reprojiziert -> Gesten laufen immer mit 60 fps.
//  * Stufen: bei Bewegung laufend Vorschau (1/div Auflösung), im Stillstand Verfeinerung
//    bis volle Auflösung, Tausch per Crossfade. Fertiges Bild ändert sich danach nicht mehr.
//  * Referenzorbit + BLA im Orbit-Worker (BigInt), nie auf dem Main-Thread.
(function () {
'use strict';

const APP_VERSION = '5.0.0';
const HP = self.FKHP, PAL = self.FKPalettes;
const Q = new URLSearchParams(location.search);
const V = '?v=' + APP_VERSION;                 // Cache-Busting für Worker (automatisch mit APP_VERSION)

const DIRECT_MAX = 1000;        // bis hier direkte f32-Iteration auf der GPU (Pixel >> f32-Eps)
const GPU_MAX = 1e30;           // f32-Perturbation (Deltas bis ~1e-35 darstellbar)
const DEEP_MAX = 1e290;         // CPU-f64-Perturbation
const NEWTON_GPU_MAX = 3000;
const MAX_ZOOM = [DEEP_MAX, DEEP_MAX, DEEP_MAX, DEEP_MAX, DEEP_MAX, 1e13, 40, 1e6];
const MODE_KEYS = ['mandelbrot', 'julia', 'burning_ship', 'tricorn', 'mandel_z3', 'newton', 'mandelbulb', 'buddhabrot'];
const MODE_HOME = [['-0.5', '0', 1], ['0', '0', 1], ['-0.5', '-0.5', 1], ['-0.3', '0', 1], ['0', '0', 1], ['0', '0', 1], ['0', '0', 1], ['-0.5', '0', 1]];

function autoIter(zoom) { const l = Math.log10(zoom + 1); return Math.min(30000, Math.max(300, Math.floor(l * l * 50))); }

// ------------------------------------------------------------------ Zustand
const S = {
    cam: { cx: HP.fromString('-0.5'), cy: 0n, zoom: 1 },
    formula: 0,
    julia: { x: HP.fromString('-0.8'), y: HP.fromString('0.156') },
    iterManual: false, iterValue: 300,
    palette: 0, density: 1, anim: true, speed: 0.15, relief: false, reliefStrength: 0.7, banded: false, particles: true,
    cycle: 0, time: 0,
    quality: 'balanced', renderer: 'auto', precise: true, minimap: false, rectMode: false, lang: 'de', zoomFormat: 'sci',
    chrome: true,
};
const listeners = [];
function emit(what) { for (const f of listeners) f(what); }

function loadSettings() {
    PAL.loadCustom();
    try {
        const s = JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}');
        for (const k of ['palette', 'density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'particles', 'quality', 'renderer', 'precise', 'minimap', 'lang', 'zoomFormat'])
            if (s[k] !== undefined) S[k] = s[k];
        if (typeof s.paletteId === 'string') S.palette = PAL.indexOf(s.paletteId);
    } catch (e) { /* ignorieren */ }
    if (!TRANSLATIONS[S.lang]) S.lang = 'de';
    try { if (!localStorage.getItem('fraktal_v5_settings')) S.minimap = window.innerWidth >= 900; } catch (e) {}
}
function saveSettings() {
    const o = {};
    for (const k of ['density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'particles', 'quality', 'renderer', 'precise', 'minimap', 'lang', 'zoomFormat']) o[k] = S[k];
    o.paletteId = PAL.list[S.palette].id;
    try { localStorage.setItem('fraktal_v5_settings', JSON.stringify(o)); } catch (e) {}
}

// ------------------------------------------------------------------ Canvas / Renderer
const canvas = document.getElementById('gl');
const R = self.FKRenderer.create(canvas);
if (!R) {
    document.body.innerHTML = '<div class="fatal"><h1>WebGL 2 nicht verfügbar</h1><p>Der Fraktal-Explorer braucht einen Browser mit WebGL 2 (z. B. aktuelles Chrome auf Android).</p></div>';
    return;
}
let gpuPerturbOK = R.selfTest();
let cssW = 1, cssH = 1, dpr = 1;
function qualityDpr() {
    const d = window.devicePixelRatio || 1;
    if (S.quality === 'eco') return Math.min(d, 1.25);
    if (S.quality === 'max') return Math.min(d, 3);
    return Math.min(d, 2);
}
function resize() {
    cssW = Math.max(1, window.innerWidth); cssH = Math.max(1, window.innerHeight);
    dpr = qualityDpr();
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        invalidate('resize');
    }
}
window.addEventListener('resize', () => { resize(); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => resize());

// ------------------------------------------------------------------ Kamera-Hilfen
const worldPerCss = (zoom) => 3 / (zoom * cssH);
function clampZoom(z) { return Math.min(MAX_ZOOM[S.formula], Math.max(0.2, z)); }
// Bildschirmpunkt (CSS px) -> Weltoffset zur Kameramitte (double)
function screenOffset(x, y, zoom) { const s = worldPerCss(zoom); return [(x - cssW / 2) * s, -(y - cssH / 2) * s]; }
function setCam(cx, cy, zoom) {
    const z = clampZoom(zoom);
    if (z !== zoom && zoom > MAX_ZOOM[S.formula] && !setCam._warned) { setCam._warned = true; toast(t('max_depth')); }
    if (zoom < MAX_ZOOM[S.formula]) setCam._warned = false;
    S.cam = { cx, cy, zoom: z };
    camDirty = true;
}
let camDirty = true;

// Anker-Transformation: Weltpunkt unter (ax0, ay0) bei Kamera c0 soll unter (ax, ay) liegen, Zoom c0.zoom*scale
function anchoredCam(c0, ax0, ay0, ax, ay, scale) {
    const zoom = clampZoom(c0.zoom * scale);
    const [wx, wy] = screenOffset(ax0, ay0, c0.zoom);
    const [sx, sy] = screenOffset(ax, ay, zoom);
    return { cx: c0.cx + HP.fromNumber(wx - sx), cy: c0.cy + HP.fromNumber(wy - sy), zoom };
}

// ------------------------------------------------------------------ Animationen: Trägheit, Flüge, Rad
let inertia = null, flight = null, wheelAnim = null;
let gestureBase = null;

function stopAnims() { inertia = null; flight = null; wheelAnim = null; tour = null; }

function flyTo(cx, cy, zoom, opts = {}) {
    stopAnims();
    const a = S.cam;
    zoom = clampZoom(zoom);
    if (opts.anchor) { cx = a.cx; cy = a.cy; }
    const rA = opts.anchor ? 0 : Math.hypot(HP.toNumber(cx - a.cx), HP.toNumber(cy - a.cy));
    const viewA = 3 / a.zoom;
    const la = Math.log(a.zoom), lb = Math.log(zoom);
    // weit entfernt -> erst hinaus, dann hinein (van-Wijk-artig, zwei Phasen)
    let mid = null;
    if (!opts.anchor && rA > 1.5 * viewA && rA > 1.5 * (3 / zoom)) {
        const zm = Math.max(0.3, Math.min(a.zoom, zoom, 3 / (rA * 1.6)));
        mid = { cx: a.cx + HP.mulNumber(cx - a.cx, 0.5), cy: a.cy + HP.mulNumber(cy - a.cy, 0.5), zoom: zm };
    }
    const decades = (x, y) => Math.abs(Math.log10(y / x));
    const perDecade = opts.perDecade || 0.22;
    const d1 = mid ? decades(a.zoom, mid.zoom) + decades(mid.zoom, zoom) : decades(a.zoom, zoom);
    const dur = opts.duration || Math.min(opts.maxDur || 9, 0.45 + perDecade * d1 + (mid ? 0.4 : 0));
    flight = { a, b: { cx, cy, zoom }, mid, t0: performance.now(), dur: dur * 1000, la, lb, anchor: opts.anchor || null, onDone: opts.onDone };
    camDirty = true;
}
const ease = (u) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
// Zoom-Pfad zwischen zwei Kameras: Ziel bleibt stabil im Bild (Mitte konvergiert wie bei echter Kamerafahrt)
function pathCam(A, B, u) {
    const lz = Math.log(A.zoom) + (Math.log(B.zoom) - Math.log(A.zoom)) * u;
    const z = Math.exp(lz);
    const r = A.zoom / B.zoom;
    let g;
    if (Math.abs(1 - r) < 1e-9) g = 1 - u; else g = (A.zoom / z - r) / (1 - r);
    return { cx: B.cx + HP.mulNumber(A.cx - B.cx, g), cy: B.cy + HP.mulNumber(A.cy - B.cy, g), zoom: z };
}

function updateAnims(now, dt) {
    if (flight) {
        const u = Math.min(1, (now - flight.t0) / flight.dur);
        const e = ease(u);
        let c;
        if (flight.anchor) {
            const f = flight.anchor;
            c = anchoredCam(flight.a, f.x, f.y, f.x, f.y, Math.exp((flight.lb - flight.la) * e));
        } else if (flight.mid) {
            const m = flight.mid;
            const l1 = Math.abs(Math.log(flight.a.zoom / m.zoom)) + 0.3, l2 = Math.abs(Math.log(m.zoom / flight.b.zoom)) + 0.3;
            const split = l1 / (l1 + l2);
            c = e < split ? pathCam(flight.a, m, e / split) : pathCam(m, flight.b, (e - split) / (1 - split));
        } else c = pathCam(flight.a, flight.b, e);
        if (u >= 1) c = flight.anchor ? c : { cx: flight.b.cx, cy: flight.b.cy, zoom: flight.b.zoom };
        setCam(c.cx, c.cy, c.zoom);
        if (u >= 1) { const cb = flight.onDone; flight = null; if (cb) cb(); }
        return;
    }
    if (inertia) {
        const k = Math.exp(-dt / 0.32);
        const c0 = S.cam;
        const dx = inertia.vx * dt, dy = inertia.vy * dt, ds = Math.exp(inertia.vs * dt);
        const ax = inertia.ax, ay = inertia.ay;
        const c = anchoredCam(c0, ax, ay, ax + dx, ay + dy, ds);
        setCam(c.cx, c.cy, c.zoom);
        inertia.ax += dx; inertia.ay += dy;
        inertia.vx *= k; inertia.vy *= k; inertia.vs *= k;
        if (Math.hypot(inertia.vx, inertia.vy) < 8 && Math.abs(inertia.vs) < 0.03) inertia = null;
        return;
    }
    if (wheelAnim) {
        const k = 1 - Math.exp(-dt / 0.07);
        const step = Math.exp(wheelAnim.ls * k);
        wheelAnim.ls -= Math.log(step);
        const c = anchoredCam(S.cam, wheelAnim.x, wheelAnim.y, wheelAnim.x, wheelAnim.y, step);
        setCam(c.cx, c.cy, c.zoom);
        if (Math.abs(wheelAnim.ls) < 1e-3) wheelAnim = null;
    }
}

// ------------------------------------------------------------------ Gesten
const gestures = self.FKGestures.attach(canvas, {
    rectMode: () => S.rectMode,
    onStart(ax, ay) { stopAnims(); gestureBase = { cam: S.cam, ax, ay }; },
    onTransform(ax0, ay0, ax, ay, scale) {
        if (!gestureBase) return;
        const b = gestureBase;
        const c = anchoredCam(b.cam, ax0, ay0, ax, ay, scale);
        setCam(c.cx, c.cy, c.zoom);
    },
    onEnd(vx, vy, vs, last) {
        gestureBase = null;
        const cap = (v, m) => Math.max(-m, Math.min(m, v));
        vx = cap(vx, 5000); vy = cap(vy, 5000); vs = cap(vs, 7);
        if (Math.hypot(vx, vy) > 60 || Math.abs(vs) > 0.3)
            inertia = { vx, vy, vs, ax: last ? last.ax : cssW / 2, ay: last ? last.ay : cssH / 2 };
    },
    onTap() { emit('tap'); },
    onDoubleTap(x, y) { zoomAt(x, y, 3); },
    onTwoFingerTap(x, y) { zoomAt(x, y, 1 / 3); },
    onLongPress(x, y) {
        if (S.formula !== 0) return;
        const [ox, oy] = screenOffset(x, y, S.cam.zoom);
        const jx = S.cam.cx + HP.fromNumber(ox), jy = S.cam.cy + HP.fromNumber(oy);
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
        setJulia(jx, jy);
        setMode(1);
        toast(t('julia_here') + ': ' + fmtC(jx, jy));
    },
    onWheel(x, y, f) {
        inertia = null; flight = null;
        if (!wheelAnim || Math.abs(wheelAnim.x - x) + Math.abs(wheelAnim.y - y) > 4) wheelAnim = { x, y, ls: 0 };
        wheelAnim.ls += Math.log(f);
    },
    onRect(r, done) {
        const box = document.getElementById('selection-box');
        const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
        if (!done) { box.hidden = false; Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); return; }
        box.hidden = true;
        if (w < 8 || h < 8) return;
        const [ox, oy] = screenOffset(x + w / 2, y + h / 2, S.cam.zoom);
        const f = Math.min(cssW / w, cssH / h);
        flyTo(S.cam.cx + HP.fromNumber(ox), S.cam.cy + HP.fromNumber(oy), S.cam.zoom * f, { duration: 0.6 });
        if (S.rectMode) { S.rectMode = false; emit('settings'); }
    }
});
function zoomAt(x, y, f) {
    stopAnims();
    flyTo(null, null, S.cam.zoom * f, { anchor: { x, y }, duration: 0.42 });
}

// ------------------------------------------------------------------ Tour (Auto-Zoom zu einem Ort)
let tour = null;
function startTour(p) {
    stopAnims();
    setMode(p.formula || 0, true);
    const home = MODE_HOME[S.formula];
    setCam(HP.fromString(home[0]), HP.fromString(home[1]), home[2]);
    S.iterManual = false;
    const b = { cx: HP.fromString(p.cx), cy: HP.fromString(p.cy), zoom: +p.zoom };
    // Referenzorbit gleich fürs Ziel anfordern: das Ziel liegt in jeder Ansicht der Fahrt
    tour = { target: b };
    setTimeout(() => {
        flyTo(b.cx, b.cy, b.zoom, { perDecade: 1.1, maxDur: 40, onDone: () => { tour = null; } });
    }, 250);
}

// ------------------------------------------------------------------ Modus / Parameter
function setMode(m, keepView) {
    if (m === S.formula && keepView) return;
    const prev = S.formula;
    S.formula = m;
    if (!keepView) {
        const h = MODE_HOME[m];
        stopAnims();
        setCam(HP.fromString(h[0]), HP.fromString(h[1]), h[2]);
        S.iterManual = false;
    } else setCam(S.cam.cx, S.cam.cy, S.cam.zoom);
    if (m !== prev) { markFramesForeign(); buddhaReset(); }
    invalidate('mode');
    emit('mode');
}
function setJulia(x, y) { S.julia = { x, y }; invalidate('julia'); emit('julia'); lastParamT = performance.now(); }
let lastParamT = 0;
function currentMaxIter() { return S.iterManual ? S.iterValue : autoIter(S.cam.zoom); }
function changeIter(f) {
    S.iterValue = Math.max(50, Math.min(500000, Math.round(currentMaxIter() * f)));
    S.iterManual = true;
    invalidate('iter'); emit('iter');
}
function setIterAuto(on) { S.iterManual = !on; if (!on) S.iterValue = currentMaxIter(); invalidate('iter'); emit('iter'); }

// ------------------------------------------------------------------ Render-Plan
function plan() {
    const f = S.formula, z = S.cam.zoom;
    if (f === 6) return { kind: 'bulb' };
    if (f === 7) return { kind: 'buddha' };
    if (f === 5) return z <= NEWTON_GPU_MAX && S.renderer !== 'cpu' ? { kind: 'gpu', mode: 'direct' } : { kind: 'cpu', mode: 'direct' };
    const cpu = S.renderer === 'cpu' || !gpuPerturbOK;
    if (z < DIRECT_MAX && S.renderer !== 'cpu') return { kind: 'gpu', mode: 'direct' };
    if (cpu || z > GPU_MAX) {
        // CPU: Tricorn/Burning Ship bis 1e12 direkt in f64 (exakt, v4-Lehre), sonst Perturbation+BLA
        if ((f === 2 || f === 3) && z <= 1e12) return { kind: 'cpu', mode: 'direct' };
        if (z < DIRECT_MAX) return { kind: 'cpu', mode: 'direct' };
        return { kind: 'cpu', mode: 'perturb' };
    }
    return { kind: 'gpu', mode: 'perturb' };
}
function viewKey() {
    const c = S.cam;
    return `${S.formula}|${c.cx}|${c.cy}|${c.zoom}|${currentMaxIter()}|${S.formula === 1 ? S.julia.x + ',' + S.julia.y : ''}|${canvas.width}x${canvas.height}|${S.renderer}`;
}

// ------------------------------------------------------------------ Referenzorbit (Orbit-Worker)
const orbitWorker = new Worker('js/orbit-worker.js' + V);
const REF = { cur: null, pending: null, queued: null, seq: 0, blaPending: false, lastReqT: 0 };
orbitWorker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'error') { console.warn('Orbit-Worker:', m.message); REF.pending = null; return; }
    if (m.type === 'ref') {
        const req = REF.pending;
        REF.pending = null;
        if (req && req.id !== m.id) return;
        m.sig = req ? req.sig : '';
        m.refXb = BigInt(m.refX); m.refYb = BigInt(m.refY);
        m.viewCx = BigInt(m.cx); m.viewCy = BigInt(m.cy);
        // laufenden Perturbations-Job abbrechen: Texturen werden gleich ersetzt
        if (RC.job && RC.job.mode === 'perturb') cancelJob();
        R.setReference(m);
        REF.cur = m;
        if (m.orbit64) cpuSendRef(m);
        if (REF.queued) { const q = REF.queued; REF.queued = null; sendRef(q); }
        stats.lastRef = { ms: m.ms, method: m.method, period: m.period, len: m.lenA };
    } else if (m.type === 'bla') {
        REF.blaPending = false;
        if (!REF.cur || REF.cur.id !== m.refId) return;
        if (RC.job && RC.job.mode === 'perturb' && RC.job.kind === 'gpu') cancelJob();
        R.setBLA(m.bla32);
        REF.cur.blaCmax = m.blaCmax;
        if (m.bla64) { REF.cur.bla64 = m.bla64; cpuBroadcast({ type: 'bla', refId: m.refId, bla: m.bla64 }); }
    }
};
function viewHalf() { const s = worldPerCss(S.cam.zoom); return [s * cssW / 2, s * cssH / 2]; }
// Bei Flügen/Touren den Referenzorbit gleich fürs ZIEL rechnen: das Ziel liegt während der
// ganzen Fahrt im Bild, eine Referenz reicht dann für alle Zwischenbilder.
function refTarget() {
    if (flight && !flight.anchor) return flight.b;
    return S.cam;
}
function requestRef(want64) {
    const tg = refTarget();
    const s = 3 / (tg.zoom * cssH);
    const q = {
        type: 'ref', id: 0, formula: S.formula,
        cx: tg.cx.toString(), cy: tg.cy.toString(),
        jx: S.julia.x.toString(), jy: S.julia.y.toString(),
        zoom: tg.zoom, maxIter: S.iterManual ? S.iterValue : autoIter(tg.zoom * 16),
        halfW: s * cssW / 2 * 1.3, halfH: s * cssH / 2 * 1.3, pixel: s / dpr,
        cmax: 0, want64
    };
    const sig = [q.formula, q.cx, q.cy, q.zoom, q.jx, q.jy, q.maxIter, want64].join('|');
    if (REF.pending) {
        if (REF.pending.sig !== sig) { q.sig = sig; REF.queued = q; }
        return;
    }
    if (REF.cur && REF.cur.sig === sig) return;
    q.sig = sig;
    sendRef(q);
}
function sendRef(q) {
    q.id = ++REF.seq;
    REF.pending = q;
    REF.lastReqT = performance.now();
    orbitWorker.postMessage(q);
}
function refDist(r) { return Math.hypot(HP.toNumber(S.cam.cx - r.refXb), HP.toNumber(S.cam.cy - r.refYb)); }
// taugt die aktuelle Referenz für diese Ansicht? strict: frisch genug für das finale Bild
function refUsable(strict, want64) {
    const r = REF.cur;
    if (!r || r.formula !== S.formula) return false;
    if (S.formula === 1 && (r.jx !== S.julia.x.toString() || r.jy !== S.julia.y.toString())) return false;
    if (want64 && !r.orbit64) return false;
    const [hw, hh] = viewHalf();
    const rc = Math.hypot(hw, hh);
    if (refDist(r) > 80 * rc) return false;
    if (strict) {
        const mi = currentMaxIter();
        const complete = r.lenA - 1 >= mi || r.period > 0;
        if (!complete && r.maxIter < mi) return false;
        const vd = Math.hypot(HP.toNumber(S.cam.cx - r.viewCx), HP.toNumber(S.cam.cy - r.viewCy));
        if (S.cam.zoom > r.zoom * 8 || S.cam.zoom < r.zoom / 64 || vd > 3 * rc) return false;
    }
    return true;
}
function ensureRef(p, moving) {
    const want64 = true;   // f64-Orbit immer mitliefern: CPU-Pfad + exakte Nachrechnung
    const now = performance.now();
    const r = REF.cur;
    if (refUsable(!moving, want64)) {
        const [hw, hh] = viewHalf();
        const rc = Math.hypot(hw, hh);
        const need = refDist(r) + rc * 1.3;
        // BLA-Tabelle deckt die Ansicht nicht ab (herausgezoomt/weit geschwenkt) oder ist viel zu
        // grosszügig (langsam) -> im Worker neu bauen (O(N), wenige ms)
        if (r.bla32 && S.formula !== 1 && !REF.blaPending && (r.blaCmax < need || (!moving && r.blaCmax > 8 * need))) {
            REF.blaPending = true;
            orbitWorker.postMessage({ type: 'bla', refId: r.id, cmax: need * 2, want64: !!r.orbit64 });
        }
        if (!moving && r.bla32 && S.formula !== 1 && r.blaCmax > 8 * need) return false;   // kurz warten: schnellere Tabelle
        // vorausschauend erneuern, bevor die Referenz unbrauchbar wird
        if (moving && !REF.pending && now - REF.lastReqT > 250 && (refDist(r) > 16 * rc || S.cam.zoom > r.zoom * 16)) requestRef(want64);
        return true;
    }
    if (!moving || !REF.pending) requestRef(want64);
    return refUsable(false, want64);
}

// ------------------------------------------------------------------ CPU-Worker-Pool
const nCpu = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
const cpuWorkers = [];
function cpuPool() {
    if (cpuWorkers.length) return cpuWorkers;
    for (let i = 0; i < nCpu; i++) {
        const w = new Worker('js/tile-worker.js' + V);
        w.busy = 0;
        w.onmessage = onCpuMessage;
        cpuWorkers.push(w);
        if (REF.cur && REF.cur.orbit64) sendRefTo(w, REF.cur);
    }
    return cpuWorkers;
}
function sendRefTo(w, m) { w.postMessage({ type: 'ref', id: m.id, formula: m.formula, orbit: m.orbit64, baseA: m.baseA, lenA: m.lenA, baseB: m.baseB, lenB: m.lenB, bla: m.bla64 || null }); }
function cpuSendRef(m) { if (cpuWorkers.length) cpuWorkers.forEach(w => sendRefTo(w, m)); }
function cpuBroadcast(msg) { cpuWorkers.forEach(w => w.postMessage(msg)); }
function onCpuMessage(e) {
    const m = e.data, w = e.target;
    w.busy = Math.max(0, w.busy - 1);
    if (m.type === 'buddha') { buddhaMerge(m); return; }
    if (m.type === 'pixels') { onFixPixels(m, w); return; }
    const job = RC.job;
    if (!job || job.kind !== 'cpu' || job.id !== m.jobId || job.done) { cpuFeed(); return; }
    if (m.missingRef) { if (REF.cur && REF.cur.orbit64) sendRefTo(w, REF.cur); job.tiles.push({ x: m.x, y: m.y, w: m.w, h: m.h }); cpuFeed(); return; }
    R.uploadTile(job, m.x, m.y, m.w, m.h, m.data);
    job.tilesDone++;
    if (job.tilesDone >= job.tilesTotal) { job.done = true; job.gpuMs = performance.now() - job.gpuStart; }
    cpuFeed();
}
function cpuFeed() {
    fixFeed();
    const job = RC.job;
    if (!job || job.kind !== 'cpu' || job.done) return;
    for (const w of cpuWorkers) {
        while (w.busy < 2 && job.tiles.length) {
            const tl = job.tiles.shift();
            w.busy++;
            w.postMessage(Object.assign({ type: 'tile', jobId: job.id, refId: job.refId, bufW: job.w, bufH: job.h, scale: job.scale,
                mode: job.mode, formula: job.formula, maxIter: job.maxIter, useBLA: job.useBLA,
                offX: job.cpuOff[0], offY: job.cpuOff[1], jx: job.julia[0], jy: job.julia[1] }, tl));
        }
    }
}

// ------------------------------------------------------------------ Render-Orchestrierung
const RC = { front: null, prev: null, job: null, fadeT0: 0, fading: false, previewDiv: 4, lastMoveT: 0, jobSeq: 0,
             foreign: false, dirty: true, lastKeyFull: null, timeToFull: null, keyT0: 0, lastKey: '' };
const stats = { fps: 0, frames: 0, fpsT: 0, lastRef: null, lastFullMs: null };
const FADE_MS = 280;

function invalidate() { RC.dirty = true; camDirty = true; }
function markFramesForeign() { RC.foreign = true; }
function cancelJob() { if (RC.job) { R.cancelJob(RC.job); RC.job = null; } }

function startJob(key, div, p) {
    const w0 = canvas.width, h0 = canvas.height;
    const over = div > 1 ? 1.2 : 1;                           // Vorschau mit Überhang (kleine Pans ohne Rand)
    const w = Math.max(8, Math.ceil(w0 * over / div)), h = Math.max(8, Math.ceil(h0 * over / div));
    const scale = 3 / (S.cam.zoom * h0) * div;                // Welt pro Pufferpixel
    const job = { id: ++RC.jobSeq, key, stage: div, kind: p.kind, mode: p.mode, formula: S.formula, maxIter: currentMaxIter(),
                  view: { cx: S.cam.cx, cy: S.cam.cy, zoom: S.cam.zoom }, w, h, scale,
                  julia: [HP.toNumber(S.julia.x), HP.toNumber(S.julia.y)], t0: performance.now() };
    if (p.kind === 'gpu') {
        job.err = div === 1 && S.precise && S.formula !== 5;     // finale Stufe mit Fehlerschätzung
        R.beginJob(job);
    } else {
        cpuPool();
        R.beginJob(Object.assign(job, { mode: 'cpu-tmp' }));   // Puffer holen (Compute läuft in Workern)
        job.mode = p.mode;
        job.gpuStart = performance.now();
        if (p.mode === 'perturb') {
            const r = REF.cur;
            job.refId = r.id;
            job.cpuOff = [HP.toNumber(job.view.cx - r.refXb), HP.toNumber(job.view.cy - r.refYb)];
            job.useBLA = !!(r.bla64 && r.blaCmax >= Math.hypot(job.cpuOff[0], job.cpuOff[1]) + scale * Math.hypot(w, h) / 2);
        } else job.cpuOff = [HP.toNumber(job.view.cx), HP.toNumber(job.view.cy)];
        // Kacheln von der Mitte nach außen
        const T = div > 2 ? 48 : 64, tiles = [];
        for (let y = 0; y < h; y += T) for (let x = 0; x < w; x += T) tiles.push({ x, y, w: Math.min(T, w - x), h: Math.min(T, h - y) });
        tiles.sort((a, b) => Math.hypot(a.x + a.w / 2 - w / 2, a.y + a.h / 2 - h / 2) - Math.hypot(b.x + b.w / 2 - w / 2, b.y + b.h / 2 - h / 2));
        job.tiles = tiles; job.tilesTotal = tiles.length; job.tilesDone = 0;
        RC.job = job;
        cpuFeed();
    }
    RC.job = job;
}

function jobFinished(job, now) {
    job.buf && (job.kept = true);
    const fr = { buf: job.buf, view: job.view, scale: job.scale, key: job.key, stage: job.stage, formula: job.formula, maxIter: job.maxIter, ms: now - job.t0,
                 kind: job.kind, mode: job.mode, useBLA: job.useBLA, refId: job.refId, julia: job.julia, fixed: !job.err, gpuMs: job.gpuMs };
    const moving = isMoving(now);
    // Crossfade beim Verfeinern / Moduswechsel; während Bewegung direkt tauschen
    if (RC.prev) R.releaseFrame(RC.prev);
    RC.prev = RC.front;
    RC.front = fr;
    RC.fading = !moving && !!RC.prev;
    RC.fadeT0 = now;
    RC.foreign = false;
    RC.dirty = true;
    if (job.stage > 1) {
        // Vorschau-Dauer steuert die Vorschau-Auflösung (Ziel ~50 ms pro Vorschau)
        const t = fr.ms;
        if (t > 90 && RC.previewDiv < 8) RC.previewDiv++;
        else if (t < 25 && RC.previewDiv > 2) RC.previewDiv--;
        RC.estFull = t * job.stage * job.stage;
    } else {
        stats.lastJobMs = fr.ms;
        stats.gpuFullMs = fr.ms;
        if (fr.fixed) fullDone(fr, now); else startFix(fr, now);
        checkInside(fr);
    }
}
function fullDone(fr, now) {
    stats.lastFullMs = RC.keyT0 ? now - RC.keyT0 : fr.ms;
    emit('rendered');
}

// ------------------------------------------------------------------ Exakte Nachrechnung (GPU-f32 -> CPU-f64)
// Der finale GPU-Pass markiert Pixel, deren f32-Fehlerschätzung > 0.7 Iterationen ist. Diese
// (typisch 0–40 %) rechnet der CPU-Pool in f64 nach; Ergebnis wird in eine Pufferkopie gestreut
// und per Crossfade übernommen. Danach ist das Bild fertig und ändert sich nicht mehr.
function startFix(fr, now) {
    const fix = { fr, key: fr.key, t0: now, chunks: [], sent: 0, done: 0, total: 0, id: ++RC.jobSeq, buf: null };
    RC.fix = fix;
    R.findUnsure(fr.buf).then((list) => {
        if (RC.fix !== fix) return;
        if (!list) { RC.fix = null; return; }
        fix.count = list.length / 2;
        stats.lastFix = { count: fix.count, pct: +(100 * fix.count / (fr.buf.w * fr.buf.h)).toFixed(1) };
        if (!fix.count) { fr.fixed = true; RC.fix = null; fullDone(fr, performance.now()); return; }
        if (fr.mode === 'perturb') {
            const r = REF.cur;
            if (!r || r.id !== fr.refId || !r.orbit64) { RC.fix = null; fr.stage = 2; return; }   // Referenz gewechselt -> neu rechnen
            fix.off = [HP.toNumber(fr.view.cx - r.refXb), HP.toNumber(fr.view.cy - r.refYb)];
            fix.useBLA = !!r.bla64;
        } else fix.off = [HP.toNumber(fr.view.cx), HP.toNumber(fr.view.cy)];
        fix.buf = R.copyBuffer(fr.buf);
        const CH = 1536;
        for (let i = 0; i < list.length; i += 2 * CH) fix.chunks.push(list.slice(i, Math.min(list.length, i + 2 * CH)));
        fix.total = fix.chunks.length;
        cpuPool();
        fixFeed();
    });
}
function fixFeed() {
    const fix = RC.fix;
    if (!fix || !fix.total) return;
    const fr = fix.fr;
    for (const w of cpuWorkers) {
        while (w.busy < 2 && fix.sent < fix.total) {
            const list = fix.chunks[fix.sent];
            w.busy++;
            w.postMessage({ type: 'pixels', jobId: fix.id, chunk: fix.sent, list, refId: fr.refId, bufW: fr.buf.w, bufH: fr.buf.h, scale: fr.scale,
                mode: fr.mode, formula: fr.formula, maxIter: fr.maxIter, useBLA: fix.useBLA, offX: fix.off[0], offY: fix.off[1], jx: fr.julia[0], jy: fr.julia[1] });
            fix.sent++;
        }
    }
}
function onFixPixels(m, w) {
    const fix = RC.fix;
    if (!fix || m.jobId !== fix.id) { cpuFeed(); return; }
    if (m.missingRef) { if (REF.cur && REF.cur.orbit64) sendRefTo(w, REF.cur); w.busy++; w.postMessage(Object.assign({}, { type: 'pixels', jobId: fix.id, chunk: m.chunk, list: m.list, refId: fix.fr.refId, bufW: fix.fr.buf.w, bufH: fix.fr.buf.h, scale: fix.fr.scale, mode: fix.fr.mode, formula: fix.fr.formula, maxIter: fix.fr.maxIter, useBLA: fix.useBLA, offX: fix.off[0], offY: fix.off[1], jx: fix.fr.julia[0], jy: fix.fr.julia[1] })); return; }
    R.scatter(fix.buf, m.list, m.values);
    fix.done++;
    if (fix.done >= fix.total) {
        const now = performance.now();
        const fr = Object.assign({}, fix.fr, { buf: fix.buf, fixed: true });
        stats.lastFix.ms = now - fix.t0;
        RC.fix = null;
        if (RC.prev) R.releaseFrame(RC.prev);
        RC.prev = RC.front;
        RC.front = fr;
        RC.fading = true; RC.fadeT0 = now; RC.dirty = true;
        fullDone(fr, now);
    }
    cpuFeed();
}
function cancelFix() {
    const fix = RC.fix;
    if (!fix) return;
    RC.fix = null;
    if (fix.buf) R.releaseFrame({ buf: fix.buf });
}

function isMoving(now) {
    return gestures.active() || !!inertia || !!flight || !!wheelAnim || now - RC.lastMoveT < 150 || now - lastParamT < 150;
}

function schedule(now) {
    const p = plan();
    if (p.kind === 'bulb' || p.kind === 'buddha') return;
    const moving = isMoving(now);
    // Bewegung: nur 1 GPU-Häppchen in der Warteschlange (60 fps), Stillstand: 2 (doppelter Durchsatz)
    R.maxInflight = Q.get('inflight') ? +Q.get('inflight') : (moving ? 1 : 2);
    const key = viewKey();
    if (key !== RC.lastKey) { RC.lastKey = key; RC.keyT0 = now; }
    const needRef = p.mode === 'perturb';
    const refOK = needRef ? ensureRef(p, moving) : true;

    if (RC.fix) {
        if (RC.fix.key !== key) cancelFix();
        else return;
    }
    let job = RC.job;
    if (job) {
        // Veraltete Jobs: Verfeinerung sofort abbrechen, Vorschau darf fertig werden (billig)
        if (job.key !== key && (job.stage === 1 || job.stage === 2 || job.kind !== p.kind || job.formula !== S.formula || now - job.t0 > 400)) { cancelJob(); job = null; }
    }
    if (job) {
        const done = job.kind === 'gpu' ? R.pump(job, now) : job.done;
        if (done) { RC.job = null; jobFinished(job, now); }
        return;
    }
    if (needRef && !refOK) return;
    if (needRef && !moving && !refUsable(true, true)) return;     // finales Bild nur mit frischer Referenz
    const front = RC.front;
    if (!front || front.key !== key || RC.foreign) {
        startJob(key, RC.previewDiv, p);
    } else if (!moving && front.stage > 1) {
        const next = (front.stage > 2 && (RC.estFull || 0) > 450) ? 2 : 1;
        startJob(key, next, p);
    }
    if (RC.job && RC.job.kind === 'gpu') { const done = R.pump(RC.job, now); if (done) { const j = RC.job; RC.job = null; jobFinished(j, now); } }
}

function look() {
    const p = PAL.list[S.palette];
    return { formula: S.formula, maxIter: RC.front ? RC.front.maxIter : currentMaxIter(), pal: p, custom: PAL.customFlat(),
             cycle: S.cycle, density: S.density, time: S.time, relief: S.relief ? S.reliefStrength : 0,
             particles: S.particles && S.anim, banded: S.banded };
}

let lastPresentKey = '';
function present(now, camChanged) {
    const p = plan();
    if (p.kind === 'bulb') {
        if (camChanged || S.anim || RC.dirty) { R.presentBulb(S.cam, look()); RC.dirty = false; }
        return;
    }
    if (p.kind === 'buddha') { buddhaTick(now); return; }
    let mixB = 1;
    if (RC.fading) {
        mixB = Math.min(1, (now - RC.fadeT0) / FADE_MS);
        if (mixB >= 1) RC.fading = false;
    }
    const animating = S.anim || RC.fading;
    if (!camChanged && !animating && !RC.dirty) return;
    RC.dirty = false;
    R.present(RC.prev, RC.front, mixB, S.cam, look());
}

// ------------------------------------------------------------------ Buddhabrot
const BUD = { hist: null, w: 0, h: 0, max: 0, version: 0, camKey: '' };
function buddhaReset() { BUD.hist = null; BUD.version++; }
function buddhaTick(now) {
    const w = Math.max(64, Math.round(canvas.width / 2)), h = Math.max(64, Math.round(canvas.height / 2));
    const ck = `${S.cam.cx}|${S.cam.cy}|${S.cam.zoom}|${w}x${h}`;
    if (!BUD.hist || BUD.camKey !== ck) { BUD.hist = new Uint32Array(w * h); BUD.w = w; BUD.h = h; BUD.max = 0; BUD.version++; BUD.camKey = ck; }
    for (const wk of cpuPool()) {
        if (wk.busy === 0) {
            wk.busy = 1;
            wk.postMessage({ type: 'buddha', w, h, cx: HP.toNumber(S.cam.cx), cy: HP.toNumber(S.cam.cy), zoom: S.cam.zoom, maxIter: 200, minIter: 20, samples: 4000, version: BUD.version });
        }
    }
    R.presentBuddha(BUD.hist, BUD.w, BUD.h, BUD.max, look());
}
function buddhaMerge(m) {
    if (S.formula !== 7 || m.version !== BUD.version || !BUD.hist) return;
    const h = BUD.hist, c = m.hist;
    let mx = BUD.max;
    for (let i = 0; i < c.length; i++) { if (c[i]) { const v = h[i] + c[i]; h[i] = v; if (v > mx) mx = v; } }
    BUD.max = mx;
}

// ------------------------------------------------------------------ Inneres erkannt?
let insideWarnKey = '';
function checkInside(fr) {
    if (S.cam.zoom < 20 || !RC.prev || RC.prev.stage === 1) return;
    const src = RC.prev;   // Vorschau-Puffer (klein) asynchron lesen
    if (!src || !src.buf || src.buf.w * src.buf.h > 400000) return;
    const k = fr.key;
    R.readIterAsync(src.buf).then((vals) => {
        if (!vals || !RC.front || RC.front.key !== k) return;
        let inside = 0;
        for (let i = 0; i < vals.length; i++) if (vals[i] < 0) inside++;
        if (inside / vals.length > 0.97 && insideWarnKey !== k) { insideWarnKey = k; toast(t('inside_toast')); }
    });
}

// ------------------------------------------------------------------ URL-Zustand (Deeplinks)
function stateURL() {
    const d = HP.digitsForZoom(S.cam.zoom);
    const p = new URLSearchParams();
    p.set('m', S.formula);
    p.set('x', HP.toString(S.cam.cx, d)); p.set('y', HP.toString(S.cam.cy, d));
    p.set('z', S.cam.zoom.toPrecision(6));
    p.set('p', PAL.list[S.palette].id);
    if (S.formula === 1) { p.set('jx', HP.toString(S.julia.x, 12)); p.set('jy', HP.toString(S.julia.y, 12)); }
    if (S.iterManual) p.set('it', S.iterValue);
    return location.origin + location.pathname + '#' + p.toString();
}
function readURL() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return false;
    const p = new URLSearchParams(h);
    if (!p.has('x')) return false;
    const m = Math.max(0, Math.min(7, parseInt(p.get('m') || '0', 10) || 0));
    S.formula = m;
    if (p.has('jx')) S.julia = { x: HP.fromString(p.get('jx')), y: HP.fromString(p.get('jy') || '0') };
    if (p.has('p')) S.palette = PAL.indexOf(p.get('p'));
    if (p.has('it')) { S.iterManual = true; S.iterValue = Math.max(50, parseInt(p.get('it'), 10) || 300); }
    setCam(HP.fromString(p.get('x')), HP.fromString(p.get('y') || '0'), parseFloat(p.get('z')) || 1);
    return true;
}
let urlT = 0, urlKey = '';
function syncURL(now) {
    if (now - urlT < 700 || isMoving(now)) return;
    urlT = now;
    const u = stateURL();
    if (u !== urlKey) { urlKey = u; try { history.replaceState(null, '', u); } catch (e) {} }
}

// ------------------------------------------------------------------ Hauptschleife
let lastT = performance.now();
function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    if (document.hidden || R.lost) return;
    S.time += dt;
    if (S.anim) S.cycle += dt * S.speed;
    updateAnims(now, dt);
    const camChanged = camDirty;
    camDirty = false;
    if (camChanged) RC.lastMoveT = now;
    schedule(now);
    present(now, camChanged);
    stats.frames++;
    if (now - stats.fpsT > 1000) { stats.fps = Math.round(stats.frames * 1000 / (now - stats.fpsT)); stats.frames = 0; stats.fpsT = now; }
    syncURL(now);
    emit('frame');
}

R.onRestored = () => { gpuPerturbOK = R.selfTest(); RC.front = RC.prev = null; RC.job = null; REF.cur = null; invalidate(); };
R.onLost = () => { RC.job = null; };

// ------------------------------------------------------------------ Hilfen für UI
function t(key) { const T = TRANSLATIONS[S.lang] || TRANSLATIONS.de; return T[key] !== undefined ? T[key] : (TRANSLATIONS.en[key] || key); }
const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
function fmtZoom(z, format) {
    const de = S.lang === 'de';
    const dec = (v, n) => { const s = v.toFixed(n); return de ? s.replace('.', ',') : s; };
    if (z < 1000) return (z < 10 ? dec(z, 1) : Math.round(z)) + '×';
    if ((format || S.zoomFormat) === 'words') {
        const e = Math.floor(Math.log10(z));
        if (z < 1e6) return dec(z / 1e3, 1) + ' ' + t('words_thousand');
        if (de) {
            const n = Math.floor(e / 6), ili = e % 6 >= 3;
            const pre = ['', 'Mi', 'Bi', 'Tri', 'Quadri', 'Quinti', 'Sexti', 'Septi', 'Okti', 'Noni', 'Dezi'];
            if (n < pre.length) return dec(z / Math.pow(10, n * 6 + (ili ? 3 : 0)), 2) + ' ' + pre[n] + (ili ? 'lliarden' : 'llionen');
        } else {
            const n = Math.floor(e / 3);
            const names = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion', 'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion'];
            if (n < names.length) return dec(z / Math.pow(10, n * 3), 2) + ' ' + names[n];
        }
    }
    const e = Math.floor(Math.log10(z));
    const m = z / Math.pow(10, e);
    return dec(m, 2) + ' × 10' + String(e).split('').map(c => SUP[c] || c).join('');
}
function fmtC(x, y) {
    const a = HP.toString(x, 5), b = HP.toNumber(y);
    return `${a.replace('-', '−')} ${b < 0 ? '−' : '+'} ${HP.toString(b < 0 ? -y : y, 5)}i`;
}
function toast(msg, ms) { emit({ toast: msg, ms }); }

// ------------------------------------------------------------------ Screenshot / Teilen
function captureBlob() {
    return new Promise((resolve) => {
        R.present(RC.prev, RC.front, 1, S.cam, look());   // frisch zeichnen, dann sofort abgreifen
        const out = document.createElement('canvas');
        out.width = canvas.width; out.height = canvas.height;
        const c2 = out.getContext('2d');
        c2.drawImage(canvas, 0, 0);
        const fs = Math.max(12, Math.round(out.height / 70));
        c2.font = `600 ${fs}px system-ui, sans-serif`;
        c2.fillStyle = 'rgba(255,255,255,0.75)';
        c2.shadowColor = 'rgba(0,0,0,0.6)'; c2.shadowBlur = fs / 2;
        c2.fillText(`Fraktal-Explorer · ${t(MODE_KEYS[S.formula])} · ${fmtZoom(S.cam.zoom, 'sci')}`, fs, out.height - fs);
        out.toBlob((b) => resolve(b), 'image/png');
    });
}
function fileName() { return `Fraktal_${MODE_KEYS[S.formula]}_${S.cam.zoom.toExponential(1).replace('+', '')}_${Date.now()}.png`; }

// ------------------------------------------------------------------ Start
function init() {
    loadSettings();
    const fromURL = readURL();
    if (!fromURL) setCam(HP.fromString('-0.5'), 0n, 1);
    if (Q.get('renderer')) S.renderer = Q.get('renderer');
    if (Q.has('noanim')) S.anim = false;
    if (Q.has('nobla')) R.noBLA = true;
    if (Q.get('inflight')) R.maxInflight = +Q.get('inflight');
    resize();
    requestAnimationFrame(frame);
}

// Öffentliche API für ui.js + E2E-Tests (window.__fraktal)
const API = {
    APP_VERSION, S, R, RC, REF, stats, HP, PAL, MODE_KEYS, MAX_ZOOM, MODE_HOME, DIRECT_MAX, GPU_MAX,
    t, fmtZoom, fmtC, toast, on: (f) => listeners.push(f), emit,
    setMode, setJulia, changeIter, setIterAuto, currentMaxIter, autoIter, flyTo, startTour, setCam, stopAnims,
    invalidate, resize, saveSettings, plan, stateURL, captureBlob, fileName, zoomAt,
    goHome() { const h = MODE_HOME[S.formula]; S.iterManual = false; flyTo(HP.fromString(h[0]), HP.fromString(h[1]), h[2]); emit('iter'); },
    goTo(p) {
        if ((p.formula || 0) !== S.formula) setMode(p.formula || 0, true);
        if (p.jx) setJulia(HP.fromString(p.jx), HP.fromString(p.jy));
        S.iterManual = !!p.iter; if (p.iter) S.iterValue = p.iter;
        flyTo(HP.fromString(p.cx), HP.fromString(p.cy), +p.zoom);
        emit('iter');
    },
    viewState() {
        const d = HP.digitsForZoom(S.cam.zoom);
        return { cx: HP.toString(S.cam.cx, d), cy: HP.toString(S.cam.cy, d), zoom: S.cam.zoom, formula: S.formula,
                 jx: S.formula === 1 ? HP.toString(S.julia.x, 12) : undefined, jy: S.formula === 1 ? HP.toString(S.julia.y, 12) : undefined,
                 iter: S.iterManual ? S.iterValue : undefined, palette: PAL.list[S.palette].id };
    },
    isMoving: () => isMoving(performance.now()),
    buddhaInfo: () => ({ max: BUD.max, version: BUD.version, w: BUD.w, h: BUD.h, busy: cpuWorkers.map(w => w.busy) }),
    // --- Test-Hooks
    status() {
        const f = RC.front;
        return { key: viewKey(), frontKey: f ? f.key : null, stage: f ? f.stage : null, busy: !!RC.job, moving: isMoving(performance.now()),
                 fading: RC.fading, done: !!f && f.key === viewKey() && f.stage === 1 && !!f.fixed && !RC.job && !RC.fix && !RC.fading, fix: stats.lastFix || null, fixing: !!RC.fix, gpuFullMs: stats.gpuFullMs,
                 plan: plan(), ref: REF.cur ? { id: REF.cur.id, method: REF.cur.method, period: REF.cur.period, len: REF.cur.lenA, ms: REF.cur.ms } : null,
                 lastFullMs: stats.lastFullMs, lastJobMs: stats.lastJobMs, fps: stats.fps, useBLA: f ? f.useBLA : null, kind: f ? f.kind : null, previewDiv: RC.previewDiv,
                 canvas: [canvas.width, canvas.height], maxIter: currentMaxIter(), gpuPerturbOK };
    },
    setView(cx, cy, zoom) { stopAnims(); setCam(HP.fromString(cx), HP.fromString(cy), zoom); },
    // Test: Iterationswerte des fertigen Bildes an Pixeln [i, jVonOben] + exakte Ansicht
    readFrontAt(px) {
        const f = RC.front; if (!f) return null;
        const all = R.readIterSync(f.buf), w = f.buf.w, h = f.buf.h;
        const d = HP.digitsForZoom(f.view.zoom) + 30;
        return { w, h, stage: f.stage, kind: f.kind, mode: f.mode, maxIter: f.maxIter, zoom: f.view.zoom, cx: HP.toString(f.view.cx, d), cy: HP.toString(f.view.cy, d),
                 values: px.map(([i, j]) => all[(h - 1 - j) * w + i]) };
    },
    readFront() { const f = RC.front; if (!f) return null; return { w: f.buf.w, h: f.buf.h, data: Array.from(R.readIterSync(f.buf)), scale: f.scale, cx: HP.toString(f.view.cx, 60), cy: HP.toString(f.view.cy, 60), zoom: f.view.zoom }; },
};
self.__fraktal = API;
init();
})();
