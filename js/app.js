// app.js — Fraktal-Explorer v5: Zustand, Kamera, Gesten, Render-Orchestrierung, Worker.
//
// Architektur (Details README / V5_BERICHT.md):
//  * Kamera: Mitte als BigInt-Fixpunkt (js/hp.js), Zoom als double. Gesten verändern die Kamera
//    DIREKT (kein Nachzieh-Lerp); Trägheit/Flüge animieren sie zeitbasiert.
//  * Jede Ansicht wird in einen Iterationspuffer gerechnet (GPU oder CPU-Worker) und vom
//    Display-Pass auf die aktuelle Kamera reprojiziert -> Gesten laufen immer mit 60 fps.
//  * 5.1 nahtloser Bildaufbau: jedes fertige Bild bleibt als Ebene erhalten (bis 8); der Display-Pass
//    trägt sie nach Schärfe sortiert gefedert auf, neue blenden weich ein. In Bewegung wird für die
//    vorausgesagte Kamera nur gerechnet, was fehlt; im Leerlauf wird vorausgerechnet; animierte
//    Bewegungen bremsen weich, bevor das Bild grob würde. Fertiges Bild ändert sich danach nicht mehr.
//  * Referenzorbit + BLA im Orbit-Worker (BigInt), nie auf dem Main-Thread.
(function () {
'use strict';

const APP_VERSION = '6.5.3';
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
    quality: 'balanced', renderer: 'auto', precise: true, minimap: false, rectMode: false, lang: 'de', zoomFormat: 'sci', governor: true, h3d: 0.6, flySpeed: 0.5,
    deOn: true, aa: true,     // 6.1: Menge glatt (Distanzschätzung), Glatte Kanten (3D-Mittelung im Stillstand)
    setCol: 'black', setHex: '#e8f0ff', alpine: false, valley: 'forest',   // 6.2: Farbe der Menge, Alpin-Look (3D) mit Tal (forest/lake/meadow)
    inMode: 1,                                                              // 6.4: Bunte Menge (setCol 'bunt'): 1 Inseln, 2 Ringe
    chrome: true,
};
// 6.5 Deko (Glas, weiche Übergänge, 3D-Himmel/Dunst/Wasser): ?deko=0 = Aussehen bis 6.4.1 (A/B-Vergleich)
const DEKO = Q.get('deko') !== '0';
document.documentElement.classList.toggle('deko', DEKO);
const RM = matchMedia('(prefers-reduced-motion: reduce)');
// 6.1 „glatt wie Video": Menge glatt (Distanzschätzung), Glatte Kanten = gemittelte 3D-Bilder im Stillstand (8, Akku 4)
// (die A/B-Regler ?aa=0/N, ?de=0, ?dew sind seit 6.5.4 entfernt)
function deActive() { return S.deOn && S.formula !== 5; }
function aaFrames() { return S.aa ? (S.quality === 'eco' ? 4 : 8) : 0; }
const listeners = [];
function emit(what) { for (const f of listeners) f(what); }

function loadSettings() {
    PAL.loadCustom();
    try {
        const s = JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}');
        for (const k of ['palette', 'density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'particles', 'quality', 'renderer', 'precise', 'minimap', 'lang', 'zoomFormat', 'governor', 'h3d', 'flySpeed', 'deOn', 'aa', 'setCol', 'setHex', 'alpine', 'valley', 'inMode'])
            if (s[k] !== undefined) S[k] = s[k];
        if (typeof s.paletteId === 'string') S.palette = PAL.indexOf(s.paletteId);
    } catch (e) { /* ignorieren */ }
    if (!TRANSLATIONS[S.lang]) S.lang = 'de';
    try { if (!localStorage.getItem('fraktal_v5_settings')) S.minimap = window.innerWidth >= 900; } catch (e) {}
}
function saveSettings() {
    const o = {};
    for (const k of ['density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'particles', 'quality', 'renderer', 'precise', 'minimap', 'lang', 'zoomFormat', 'governor', 'h3d', 'flySpeed', 'deOn', 'aa', 'setCol', 'setHex', 'alpine', 'valley', 'inMode']) o[k] = S[k];
    o.paletteId = PAL.list[S.palette].id;
    if (SIMPLE) { if (o.renderer === 'cpu') o.renderer = SIMPLE.renderer; if (o.quality === 'eco') o.quality = SIMPLE.quality; }   // nur für die Sitzung
    try { localStorage.setItem('fraktal_v5_settings', JSON.stringify(o)); } catch (e) {}
}

// ------------------------------------------------------------------ Canvas / Renderer
const canvas = document.getElementById('gl');
const R = self.FKRenderer.create(canvas);
// 6.5.2: Meldung vor dem Start (Einstellungen noch nicht geladen): gespeicherte Sprache, sonst Deutsch/Englisch nach Browser
function bootT(k) {
    let l = '';
    try { l = JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}').lang || ''; } catch (e) {}
    if (!TRANSLATIONS[l]) l = /^de/i.test(navigator.language || '') ? 'de' : 'en';
    return TRANSLATIONS[l][k] || TRANSLATIONS.en[k];
}
function fatal() {
    document.body.innerHTML = `<div class="fatal"><h1>${bootT('webgl_fatal_title')}</h1><p>${bootT('webgl_fatal_text')}</p><p class="hint">${bootT('webgl_fatal_hint')}</p></div>`;
}
if (!R) { fatal(); return; }
// 6.5.2 „Einfache Grafik“ (Knopf des Start-Wächters): diese Sitzung CPU-Rechenweg + Auflösung „Akku“, ohne GPU-Selbsttest
let SIMPLE = false;
try { SIMPLE = sessionStorage.getItem('fk_simple') === '1'; } catch (e) {}
let gpuPerturbOK = SIMPLE ? false : R.selfTest();
if (!R.displayOK()) { fatal(); return; }
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

function stopAnims() { inertia = null; flight = null; wheelAnim = null; }

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
    flight = { a, b: { cx, cy, zoom }, mid, t0: performance.now(), u: 0, dur: dur * 1000, la, lb, anchor: opts.anchor || null, onDone: opts.onDone };
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

// Kamera eines Flugs bei Fortschritt u (0..1)
function flightCamAt(f, u) {
    const e = ease(u);
    let c;
    if (f.anchor) {
        const an = f.anchor;
        c = anchoredCam(f.a, an.x, an.y, an.x, an.y, Math.exp((f.lb - f.la) * e));
    } else if (f.mid) {
        const m = f.mid;
        const l1 = Math.abs(Math.log(f.a.zoom / m.zoom)) + 0.3, l2 = Math.abs(Math.log(m.zoom / f.b.zoom)) + 0.3;
        const split = l1 / (l1 + l2);
        c = e < split ? pathCam(f.a, m, e / split) : pathCam(m, f.b, (e - split) / (1 - split));
    } else c = pathCam(f.a, f.b, e);
    if (u >= 1 && !f.anchor) c = { cx: f.b.cx, cy: f.b.cy, zoom: f.b.zoom };
    return c;
}

// Tempo-Bremse (nur animierte Bewegungen): GOV.g = Zeitfaktor 0.3..1, siehe governorUpdate()
const GOV = { g: 1, on: true, kmin: 0.4, min: 0.4 };
const INERTIA_TAU = 0.32;
function updateAnims(now, dt) {
    if (flight) {
        // Fortschritt statt Wanduhr: die Tempo-Bremse dehnt die Zeit weich
        flight.u = Math.min(1, (flight.u || 0) + dt * 1000 * GOV.g / flight.dur);
        const u = flight.u;
        const c = flightCamAt(flight, u);
        setCam(c.cx, c.cy, c.zoom);
        if (u >= 1) { const cb = flight.onDone; flight = null; if (cb) cb(); }
        return;
    }
    if (inertia && V3.on) {
        const dtg = dt * Math.max(0.5, GOV.g), k = Math.exp(-dtg / INERTIA_TAU);
        const c = ground3d(S.cam, inertia.vx * dtg, inertia.vy * dtg);
        setCam(c.cx, c.cy, c.zoom * Math.exp(inertia.vs * dtg));
        inertia.vx *= k; inertia.vy *= k; inertia.vs *= k;
        if (Math.hypot(inertia.vx, inertia.vy) < 8 && Math.abs(inertia.vs) < 0.03) inertia = null;
        return;
    }
    if (inertia) {
        const dtg = dt * Math.max(0.5, GOV.g);
        const k = Math.exp(-dtg / INERTIA_TAU);
        const c0 = S.cam;
        const dx = inertia.vx * dtg, dy = inertia.vy * dtg, ds = Math.exp(inertia.vs * dtg);
        const ax = inertia.ax, ay = inertia.ay;
        const c = anchoredCam(c0, ax, ay, ax + dx, ay + dy, ds);
        setCam(c.cx, c.cy, c.zoom);
        inertia.ax += dx; inertia.ay += dy;
        inertia.vx *= k; inertia.vy *= k; inertia.vs *= k;
        if (Math.hypot(inertia.vx, inertia.vy) < 8 && Math.abs(inertia.vs) < 0.03) inertia = null;
        return;
    }
    if (wheelAnim) {
        const k = 1 - Math.exp(-dt * GOV.g / 0.07);
        const step = Math.exp(wheelAnim.ls * k);
        wheelAnim.ls -= Math.log(step);
        const c = anchoredCam(S.cam, wheelAnim.x, wheelAnim.y, wheelAnim.x, wheelAnim.y, step);
        setCam(c.cx, c.cy, c.zoom);
        if (Math.abs(wheelAnim.ls) < 1e-3) wheelAnim = null;
    }
}

// ---- Vorhersage: wo ist die Kamera in dt Sekunden? (bekannte Pfade exakt, Gesten extrapoliert)
const CV = { last: null, t: 0, vx: 0, vy: 0, vz: 0 };    // Kamera-Geschwindigkeit: CSS px/s (Welt), ln(Zoom)/s
function trackVelocity(now, moving) {
    const c = S.cam;
    if (CV.last && moving) {
        const dt = (now - CV.t) / 1000;
        if (dt > 0 && dt < 0.25) {
            const s = worldPerCss(c.zoom);
            const vx = HP.toNumber(c.cx - CV.last.cx) / s / dt, vy = HP.toNumber(c.cy - CV.last.cy) / s / dt;
            const vz = Math.log(c.zoom / CV.last.zoom) / dt;
            const a = 1 - Math.exp(-dt / 0.12);                  // ~ letzte 200 ms
            CV.vx += (vx - CV.vx) * a; CV.vy += (vy - CV.vy) * a; CV.vz += (vz - CV.vz) * a;
        }
    } else if (!moving) { CV.vx = CV.vy = CV.vz = 0; }
    CV.last = c; CV.t = now;
}
function predictCam(dt, clamp = true) {
    let c = null;
    if (FLY.on && !FLY.paused) c = flyStep(S.cam, V3.heading, dt).cam;
    else if (flight) c = flightCamAt(flight, Math.min(1, (flight.u || 0) + dt * 1000 * GOV.g / flight.dur));
    else if (inertia) {
        const dtg = dt * Math.max(0.5, GOV.g);
        const f = INERTIA_TAU * (1 - Math.exp(-dtg / INERTIA_TAU));
        c = anchoredCam(S.cam, inertia.ax, inertia.ay, inertia.ax + inertia.vx * f, inertia.ay + inertia.vy * f, Math.exp(inertia.vs * f));
    } else if (wheelAnim) {
        const k = 1 - Math.exp(-dt * GOV.g / 0.07);
        c = anchoredCam(S.cam, wheelAnim.x, wheelAnim.y, wheelAnim.x, wheelAnim.y, Math.exp(wheelAnim.ls * k));
    } else if (gestures.active() || Math.abs(CV.vz) + Math.abs(CV.vx) + Math.abs(CV.vy) > 0) {
        const s = worldPerCss(S.cam.zoom), k = 0.8;            // Gesten: vorsichtig extrapolieren
        c = { cx: S.cam.cx + HP.fromNumber(CV.vx * dt * k * s), cy: S.cam.cy + HP.fromNumber(CV.vy * dt * k * s), zoom: clampZoom(S.cam.zoom * Math.exp(CV.vz * dt * k)) };
    }
    if (!c) return S.cam;
    if (!clamp) return c;
    // innerhalb des Vorschau-Überhangs bleiben: das Ergebnis muss die aktuelle Ansicht noch decken
    // (hineinzoomen ≤ 1,3×; herauszoomen bis 1/3 – eine weitere Ansicht deckt die aktuelle ohnehin)
    const r = Math.max(1 / 3, Math.min(1.3, c.zoom / S.cam.zoom));
    const s = worldPerCss(S.cam.zoom);
    const mx = 0.18 * cssW * s, my = 0.18 * cssH * s;
    const dx = Math.max(-mx, Math.min(mx, HP.toNumber(c.cx - S.cam.cx))), dy = Math.max(-my, Math.min(my, HP.toNumber(c.cy - S.cam.cy)));
    if (r === c.zoom / S.cam.zoom && Math.abs(dx) < mx && Math.abs(dy) < my) return c;
    return { cx: S.cam.cx + HP.fromNumber(dx), cy: S.cam.cy + HP.fromNumber(dy), zoom: S.cam.zoom * r };
}

// ------------------------------------------------------------------ Gesten
const gestures = self.FKGestures.attach(canvas, {
    rectMode: () => S.rectMode,
    onStart(ax, ay) { if (!FLY.on) stopAnims(); gestureBase = { cam: S.cam, ax, ay, tilt: V3.tilt, heading: V3.heading }; FLY.userBase = FLY.user || 0; },
    onTransform(ax0, ay0, ax, ay, scale, rot, n) {
        if (!gestureBase) return;
        const b = gestureBase;
        if (V3.on) { gesture3d(b, ax0, ay0, ax, ay, scale, rot || 0, n || 1); return; }
        const c = anchoredCam(b.cam, ax0, ay0, ax, ay, scale);
        setCam(c.cx, c.cy, c.zoom);
    },
    onEnd(vx, vy, vs, last) {
        gestureBase = null;
        const cap = (v, m) => Math.max(-m, Math.min(m, v));
        vx = cap(vx, 5000); vy = cap(vy, 5000); vs = cap(vs, 7);
        if (FLY.on) return;
        if (Math.hypot(vx, vy) > 60 || Math.abs(vs) > 0.3)
            inertia = { vx, vy, vs, ax: last ? last.ax : cssW / 2, ay: last ? last.ay : cssH / 2 };
    },
    onTap() { if (FLY.on) { pauseFly(); toast(t(FLY.paused ? 'fly_paused' : 'fly_on'), 1400); } else emit('tap'); },
    onDoubleTap(x, y) { if (V3.on) { stopFly(); zoomAt(cssW / 2, cssH / 2, 3); } else zoomAt(x, y, 3); },
    onTwoFingerTap(x, y) { if (V3.on) { stopFly(); zoomAt(cssW / 2, cssH / 2, 1 / 3); } else zoomAt(x, y, 1 / 3); },
    onOrbit(dx, dy, phase) {
        if (!V3.on) return;
        if (phase === 'start') { gestureBase = { cam: S.cam, tilt: V3.tilt, heading: V3.heading }; return; }
        if (phase === 'end' || !gestureBase) { gestureBase = null; return; }
        V3.heading = gestureBase.heading - dx * 0.008;
        V3.tilt = Math.max(0, Math.min(MAX_TILT, gestureBase.tilt - dy * 0.006));
        RC.dirty = true;
    },
    onLongPress(x, y) {
        if (S.formula !== 0 || V3.on) return;
        const [ox, oy] = screenOffset(x, y, S.cam.zoom);
        const jx = S.cam.cx + HP.fromNumber(ox), jy = S.cam.cy + HP.fromNumber(oy);
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
        setJulia(jx, jy);
        setMode(1);
        toast(t('julia_here') + ': ' + fmtC(jx, jy));
    },
    onWheel(x, y, f) {
        inertia = null; flight = null;
        if (V3.on) { stopFly(); x = cssW / 2; y = cssH / 2; }
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
function startTour(p) {
    stopAnims();
    setMode(p.formula || 0, true);
    if (p.jx) setJulia(HP.fromString(p.jx), HP.fromString(p.jy));
    const home = MODE_HOME[S.formula];
    setCam(HP.fromString(home[0]), HP.fromString(home[1]), home[2]);
    S.iterManual = false;
    const b = { cx: HP.fromString(p.cx), cy: HP.fromString(p.cy), zoom: +p.zoom };
    // (der Referenzorbit wird per refTarget() gleich fürs Ziel angefordert: das Ziel liegt in jeder Ansicht der Fahrt)
    setTimeout(() => {
        flyTo(b.cx, b.cy, b.zoom, { perDecade: 1.1, maxDur: 40 });
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
    const rcpu = S.renderer === 'cpu' || forceCPU;
    if (f === 5) return z <= NEWTON_GPU_MAX && !rcpu ? { kind: 'gpu', mode: 'direct' } : { kind: 'cpu', mode: 'direct' };
    const cpu = rcpu || !gpuPerturbOK;
    if (z < DIRECT_MAX && !rcpu) return { kind: 'gpu', mode: 'direct' };
    if (cpu || z > GPU_MAX) {
        // CPU: unter DIRECT_MAX direkt in f64, darüber Perturbation (+BLA) — auch für Tricorn/Burning
        // Ship: die direkte f64-Iteration ist in parabolischen Randzonen messbar ungenauer (Test: 96 %
        // statt 99,5 % bei Tricorn 1e6), die Perturbation ist inzwischen gegen die Wahrheit geprüft.
        if (z < DIRECT_MAX) return { kind: 'cpu', mode: 'direct' };
        return { kind: 'cpu', mode: 'perturb' };
    }
    return { kind: 'gpu', mode: 'perturb' };
}
function viewKey(cam) {
    const c = cam || S.cam;
    return `${S.formula}|${c.cx}|${c.cy}|${c.zoom}|${S.iterManual ? S.iterValue : autoIter(c.zoom)}|${S.formula === 1 ? S.julia.x + ',' + S.julia.y : ''}|${canvas.width}x${canvas.height}|${S.renderer}${V3.on ? '|3d' : ''}`;
}

// Referenzorbit (Orbit-Worker): js/refs.js

// CPU-Worker-Pool: js/cpu-pool.js

// ------------------------------------------------------------------ Render-Orchestrierung
// 5.1 „nahtloser Bildaufbau": Jedes fertige Bild (Vorschau, Verfeinerung, exakt, vorausberechnet)
// bleibt als EBENE erhalten, solange es irgendwo das schärfste gültige Bild liefert. Der Display-Pass
// trägt die Ebenen nach Schärfe sortiert auf (schärfste oben, gefederte Ränder, zeitbasiertes
// Einblenden): eine gröbere neue Vorschau füllt nur Lücken und überdeckt nie ein schärferes,
// reprojiziert noch gültiges Bild. Schärfe = Pufferpixel pro Bildschirmpixel nach Reprojektion.
// Feste Werte (die A/B-Regler ?blend, ?maxdiv, ?over, ?overmove, ?strips, ?fadems, ?feather, ?recon, ?predict, ?prefetch,
// ?gov, ?govk, ?govmin, ?inflight sind seit 6.5.4 entfernt – Vergleichsmessungen siehe V51_BERICHT.md):
//   gröbste Vorschau 1/6 (GPU) bzw. 1/8 (CPU), Vorschau-Überhang 1,5 (in Bewegung 1,2), Einblendzeit 220 ms (in Bewegung
//   150 ms), Randfederung 12 CSS px; Vorschau auf dem Iterationswert rekonstruiert, für die vorausgesagte Kamera, nur für
//   den noch unscharfen Bereich (Teilstreifen); Vorausrechnen im Leerlauf
const MAXDIV = { gpu: 6, cpu: 8 };
const OVER = 1.5;                          // Stillstand/Lückenfüller; in Bewegung OVER_MOVE
const OVER_MOVE = 1.2;                     // mit Vorhersage reicht wenig Überhang (A/B: 1.5 kostet eine Auflösungsstufe)
const FADE_MS = 220, FADE_MOVE_MS = 150;
const FEATHER = 12;
const MAXL = self.FKShaders.NL;            // Ebenen im Display-Pass (8)
const SIDE3D = 1600;                       // P2-3: größte Kantenlänge des quadratischen 3D-Rechenpuffers (px)
const RC = { front: null, job: null, pjob: null, fading: false, previewDiv: { gpu: 3, cpu: 4 }, lastMoveT: 0, jobSeq: 0,
             layers: [], layerSeq: 0, estPreviewMs: 60, lastPreview: null, pxRate: 0,
             foreign: false, dirty: true, keyT0: 0, lastKey: '' };
const stats = { fps: 0, frames: 0, fpsT: 0, lastFullMs: null };
// GPU-Speicher: Iterationspuffer (5 B/Pixel: Iteration + Distanzschätzung). Pixel 7 (824×1830): Vollbild 7,5 MB; Stapel max. 8 Ebenen (3D: 6)
// (exakt + Vorschauen + 3 vorausberechnete) typ. 15–25 MB, Pool-Grenze 40 MB (Desktop 64 MB).
R.poolBudget = (Math.min(screen.width, screen.height) < 700 ? 40 : 64) * 1048576;

function invalidate() { RC.dirty = true; camDirty = true; }
function markFramesForeign() { RC.foreign = true; }
function cancelJob() {
    const j = RC.job;
    if (!j) return;
    // abgebrochene Vorschau: geleistete Arbeit trotzdem in die Durchsatz-Schätzung
    if (j.preview && j.kind === 'gpu' && j.row > 0) {
        const t = performance.now() - j.t0, rate = j.w * j.row / Math.max(4, t);
        if (t > 50) RC.pxRate = RC.pxRate ? RC.pxRate * 0.7 + rate * 0.3 : rate;
    }
    R.cancelJob(j); RC.job = null;
}
function cancelPrefetch() { if (RC.pjob) { R.cancelJob(RC.pjob); RC.pjob = null; } }
// 6.4 Bunte Menge: Innen-Information mitrechnen (eigene Rechen-Variante; Außenwerte bitgleich). Nicht bei Newton.
function innActive() { return S.setCol === 'bunt' && S.formula !== 5 && !innBlocked; }
// P1-2 Rückfall bei defekten Rechen-Shadern (nur für die Sitzung, nichts wird gespeichert): Bunt-Variante defekt ->
// Menge schwarz; Perturbation defekt -> CPU-Perturbation (gpuPerturbOK); direkte Variante defekt -> CPU-Rechenweg
let innBlocked = false, forceCPU = false;
function jobFailed(job) {
    R.cancelJob(job);
    if (job.inn) innBlocked = true;
    else if (job.mode === 'perturb') gpuPerturbOK = false;
    else forceCPU = true;
    toast(t('shader_fallback'), 4500);
    invalidate();
}
function maxIterFor(zoom) { return S.iterManual ? S.iterValue : autoIter(zoom); }

// view: Kamera, für die gerechnet wird (Standard: aktuelle). opts: { prefetch, w, h, scale }
function startJob(key, div, p, view, opts) {
    opts = opts || {};
    view = view || S.cam;
    const w0 = canvas.width, h0 = canvas.height;
    // Vorschau mit Überhang (Schwenks laufen nicht an die Kante); auch volle Auflösung in Bewegung
    const over = opts.preview ? OVER_MOVE : (div > 1 ? OVER : 1);
    // 3D: quadratische Rechenansicht (Drehen ohne Lücken), gleiche Pixelgröße wie 2D – P2-3: Kantenlänge höchstens
    // SIDE3D (gleiche Weltabdeckung, gröber; die 3D-Anzeige zeichnet am Handy ohnehin mit 0,65 der Auflösung)
    const s3 = Math.max(w0, h0), side = Math.min(s3, SIDE3D), f3 = V3.on ? s3 / side : 1;
    const bw0 = V3.on ? side : w0, bh0 = V3.on ? side : h0;
    const w = opts.w || Math.max(8, Math.ceil(bw0 * over / div)), h = opts.h || Math.max(8, Math.ceil(bh0 * over / div));
    const scale = opts.scale || 3 / (view.zoom * h0) * div * f3;   // Welt pro Pufferpixel
    const job = { id: ++RC.jobSeq, key, stage: div, kind: p.kind, mode: p.mode, formula: S.formula, maxIter: maxIterFor(view.zoom),
                  view: { cx: view.cx, cy: view.cy, zoom: view.zoom }, w, h, scale, sig: contentSig(), prefetch: !!opts.prefetch, baseKey: opts.baseKey, preview: !!opts.preview,
                  julia: [HP.toNumber(S.julia.x), HP.toNumber(S.julia.y)], t0: performance.now(), de: deActive(), inn: innActive() };
    if (opts.prefetch) RC.pjob = job; else RC.job = job;
    if (p.kind === 'gpu') {
        job.err = div === 1 && !opts.prefetch && !opts.preview && S.precise && S.formula !== 5;     // finale Stufe mit Fehlerschätzung
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
        // Kacheln von der Mitte nach außen; P2-8: Arbeit je Kachel begrenzt (T²·maxIter ≤ 3·10⁷, mindestens 16 px) – eine
        // Kachel lässt sich im Worker nicht abbrechen, so wartet eine neue Ansicht auf weniger Rest-Arbeit
        const T = div > 2 ? 48 : 64, tiles = [];
        for (let y = 0; y < h; y += T) for (let x = 0; x < w; x += T) tiles.push({ x, y, w: Math.min(T, w - x), h: Math.min(T, h - y) });
        tiles.sort((a, b) => Math.hypot(a.x + a.w / 2 - w / 2, a.y + a.h / 2 - h / 2) - Math.hypot(b.x + b.w / 2 - w / 2, b.y + b.h / 2 - h / 2));
        job.tiles = tiles; job.tilesTotal = tiles.length; job.tilesDone = 0;
        cpuFeed();
    }
    return job;
}
function jobProgress(job) { return job.kind === 'gpu' ? job.row / Math.max(1, job.h) : job.tilesDone / Math.max(1, job.tilesTotal); }


function jobFinished(job, now) {
    if (job.failed) return jobFailed(job);
    const fr = makeFrame(job, now);
    const moving = isMoving(now);
    addLayer(fr, now, moving);
    RC.dirty = true;
    if (job.prefetch) { PF.busyMs += fr.ms; return; }
    RC.front = fr;
    RC.foreign = false;
    if (fr.preview) {
        if (!job.part) RC.lastPreview = fr;
        // Vorschau-Auflösung regelt sich über die gemessene Frame-Zeit während der Bewegung
        // (Ziel: Vsync halten; Frame > 1.4 Vsync oder Vorschau > 90 ms -> gröber, sonst feiner;
        // volle Auflösung, wenn die halbe Vorschau < 15 ms braucht – z. B. flache Zooms, direkte f32)
        const t = fr.ms, k = job.kind;
        if (moving && !job.isTarget) {
            RC.estPreviewMs = RC.estPreviewMs * 0.7 + t * 0.3;
            const rate = job.w * job.h / Math.max(4, t);
            RC.pxRate = RC.pxRate ? RC.pxRate * 0.7 + rate * 0.3 : rate;
            const d = RC.previewDiv[k];
            if ((RC.dtEMA > 1.4 * (RC.vsync || 16.7) || t > 90) && d < MAXDIV[k]) RC.previewDiv[k]++;
            else if (RC.dtEMA < 1.1 * (RC.vsync || 16.7) && t < (d === 2 ? 15 : 40) && d > 1) RC.previewDiv[k]--;
        }
        RC.estFull = t * job.stage * job.stage / (job.w * job.h) * (canvas.width * canvas.height);
        // P2-7: die finale Variante (mit Fehlerschätzung) schon übersetzen lassen, solange die Vorschau steht
        if (k === 'gpu') R.prewarmCompute({ formula: job.formula, mode: job.mode, err: S.precise && job.formula !== 5, de: job.de, inn: job.inn });
    } else {
        stats.lastJobMs = fr.ms;
        stats.gpuFullMs = fr.ms;
        // Nachrechnung erst im Stillstand (Zielbild eines Flugs kann fertig sein, bevor er endet)
        if (fr.fixed) { fr.exact = true; fullDone(fr, now); } else if (!moving) startFix(fr, now);
        checkInside(fr);
    }
}
function fullDone(fr, now) {
    stats.lastFullMs = RC.keyT0 ? now - RC.keyT0 : fr.ms;
    emit('rendered');
}

// Ebenen-Stapel: js/layers.js
const smooth01 = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

// Exakte Nachrechnung (GPU-f32 -> CPU-f64): js/cpu-pool.js

function pumpCtl(moving, prefetch) {
    const vs = RC.vsync || 16.7;
    // 6.2: in 3D sind „Leerlauf"-Frames nie leer (3D-Bild, eingereihte GPU-Arbeit) – ihre Dauer darf das Budget nicht
    // aufblähen (sonst rechnete der Flug bis zu 8 Bildtakte pro Frame und ruckelte); dort keine Reserve über den Bildtakt
    const cap = V3.on ? vs : 8 * vs;
    // 6.4 Flug: Rechenanteil garantieren – eine Vorschau soll in ~0,6 s fertig werden, auch wenn schon das 3D-Bild allein
    // länger als ein Bildtakt braucht (langsames Gerät, großer Bildschirm, hohe Bildwiederholrate). Sonst schrumpfte der
    // Häppchen-Regler die Rechnung auf 1024 Pixel pro Bild, keine Vorschau wurde mehr fertig, der Flug sah nur noch
    // Leere und suchte den Rand
    const minS = V3.on && FLY.on && !FLY.paused ? 0.6 : 0;
    return { moving, prefetch, dt: RC.dtEMA || 16, vsync: Math.max(vs, Math.min(RC.idleDt || vs, cap)), minS };
}
function isMoving(now) {
    return gestures.active() || !!inertia || !!flight || !!wheelAnim || (FLY.on && !FLY.paused) || now - RC.lastMoveT < 150 || now - lastParamT < 150;
}
function animating() { return !!inertia || !!flight || !!wheelAnim || (FLY.on && !FLY.paused); }
// Bekanntes Ziel der laufenden Animation (Flug/Tour/Doppeltipp, Schwung) und Restzeit in s
function animTarget() {
    if (FLY.on && !FLY.paused && FLY.mode === 'place' && FLY.target) return { cam: FLY.target, rest: Math.log10(FLY.target.zoom / S.cam.zoom) / Math.max(0.05, S.flySpeed * GOV.g) };
    if (flight) return { cam: flightCamAt(flight, 1), rest: (1 - (flight.u || 0)) * flight.dur / 1000 / Math.max(0.3, GOV.g) };
    if (inertia) {
        const v = Math.hypot(inertia.vx, inertia.vy);
        const f = INERTIA_TAU;
        const c = anchoredCam(S.cam, inertia.ax, inertia.ay, inertia.ax + inertia.vx * f, inertia.ay + inertia.vy * f, Math.exp(inertia.vs * f));
        return { cam: c, rest: INERTIA_TAU * Math.log(Math.max(1, Math.max(v / 8, Math.abs(inertia.vs) / 0.03))) };
    }
    return null;
}
// Anteil der Pufferfläche eines Jobs, der in der (1,2-fach vergrößerten) Ansicht der Kamera c liegt
function visibleFrac(job, c) {
    const r = layerRect({ view: job.view, scale: job.scale, buf: { w: job.w, h: job.h } }, c);
    const W = canvas.width, H = canvas.height, m = 0.1;
    const ix = Math.max(0, Math.min(r.x1, W * (1 + m)) - Math.max(r.x0, -W * m)), iy = Math.max(0, Math.min(r.y1, H * (1 + m)) - Math.max(r.y0, -H * m));
    return ix * iy / Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
}
// liegt die Ansicht v (zu weit) neben der Kamera c? (Zoomverhältnis > 2.5 oder Versatz > 45 % des Bildes)
function farFrom(v, c) {
    const r = Math.max(v.zoom / c.zoom, c.zoom / v.zoom);
    const s = worldPerCss(c.zoom);
    const off = Math.max(Math.abs(HP.toNumber(v.cx - c.cx)) / (cssW * s), Math.abs(HP.toNumber(v.cy - c.cy)) / (cssH * s));
    return { far: r > 2.5 || off > 0.45, r, off };
}

// ---------------- Vorausrechnen (Prefetch): nur im Leerlauf, niedrigste Priorität
// Nach dem exakten Endbild, in dieser Reihenfolge (je ein Job, bei jeder Bewegung sofort abgebrochen):
//   ref    Referenzorbit für 4× tieferen Zoom (Perturbation) – tiefes Hineinzoomen wartet nicht
//   widest 1/256 Zoom, 1/8 Auflösung (1/64 der Pixel): Reserve bis ×256 (kostet praktisch nichts)
//   wider  1/32 Zoom, 1/4 Auflösung (1/16 der Pixel): Reserve für schnelles Herauszoomen bis ×32
//   wide   1/4 Zoom, halbe Auflösung: Herauszoomen/große Schwenks ohne schwarzen Rand
//   ring   gleicher Zoom, 1,6-fache Fläche, halbe Auflösung: Schwenks laufen in scharfes Bild
//   deep   Bildmitte eine Zoomstufe tiefer (×2) in voller Auflösung – wahrscheinlicher nächster Schritt
// Akku: nicht bei Auflösung „Akku", nicht im Hintergrund (Hauptschleife ruht), höchstens jedes
// zweite Frame ein Häppchen (≤ ~50 % GPU) und nur so lange, wie die Jobs zusammen < 3 Vollbilder kosten.
const PF = { key: null, items: [], busyMs: 0, tick: 0 };
function planPrefetch(p, key) {
    // 3D: quadratisch (Drehen) und der Ring größer (Boden vor der Kamera liegt bis ~1,7 Bildhälften hinter dem Fokus)
    const W = V3.on ? Math.max(canvas.width, canvas.height) : canvas.width, H = V3.on ? W : canvas.height, est = RC.estFull || 300;
    const z = S.cam.zoom, sCam = 3 / (z * canvas.height);
    const items = [];
    if (p.mode === 'perturb' && REF.cur && REF.cur.zoom < z * 3.9) items.push({ type: 'ref' });
    if (z > 64) items.push({ type: 'job', name: 'widest', view: { cx: S.cam.cx, cy: S.cam.cy, zoom: Math.max(0.2, z / 256) }, w: Math.ceil(W / 8), h: Math.ceil(H / 8), scale: sCam * 2048, div: 2048 });
    if (z > 8) items.push({ type: 'job', name: 'wider', view: { cx: S.cam.cx, cy: S.cam.cy, zoom: Math.max(0.2, z / 32) }, w: Math.ceil(W / 4), h: Math.ceil(H / 4), scale: sCam * 128, div: 128 });
    items.push({ type: 'job', name: 'wide', view: { cx: S.cam.cx, cy: S.cam.cy, zoom: Math.max(0.2, z / 4) }, w: Math.ceil(W / 2), h: Math.ceil(H / 2), scale: sCam * 8, div: 8 });
    if (p.kind === 'gpu' || est < 2500)
        items.push(V3.on ? { type: 'job', name: 'ring', view: S.cam, w: Math.ceil(W * 2.4 / 3), h: Math.ceil(H * 2.4 / 3), scale: sCam * 3, div: 3 }
                         : { type: 'job', name: 'ring', view: S.cam, w: Math.ceil(W * 1.6 / 2), h: Math.ceil(H * 1.6 / 2), scale: sCam * 2, div: 2 });
    if (p.kind === 'gpu' && est < 1500 && clampZoom(z * 2) === z * 2)
        items.push({ type: 'job', name: 'deep', view: { cx: S.cam.cx, cy: S.cam.cy, zoom: z * 2 }, w: W, h: H, scale: sCam / 2, div: 1 });
    return items;
}
function prefetchStep(now, p, key) {
    if (S.quality === 'eco' || document.hidden) return;
    if (PF.key !== key) { PF.key = key; PF.items = planPrefetch(p, key); PF.busyMs = 0; }
    if (RC.pjob) {
        if (++PF.tick % 2) return;                       // Häppchen nur jedes zweite Frame
        const j = RC.pjob;
        const done = j.kind === 'gpu' ? (R.maxInflight = 1, R.pump(j, now, pumpCtl(false, true))) : j.done;
        if (done) { RC.pjob = null; jobFinished(j, now); }
        return;
    }
    if (PF.busyMs > 3 * Math.max(200, RC.estFull || 0)) { PF.items = []; return; }
    if (R.poolInfo().usedMB > R.poolBudget / 1048576) return;   // P2-3: Speicherbudget voll -> nichts vorausrechnen
    const it = PF.items.shift();
    if (!it) return;
    if (it.type === 'ref') { requestRefFor({ cx: S.cam.cx, cy: S.cam.cy, zoom: S.cam.zoom * 4 }, key); return; }
    if (p.mode === 'perturb' && !refUsable(false, true)) return;
    startJob(key + '|pf:' + it.name, it.div, p, it.view, { prefetch: true, w: it.w, h: it.h, scale: it.scale, baseKey: key });
}

function schedule(now) {
    const p = plan();
    if (p.kind === 'bulb' || p.kind === 'buddha') return;
    const moving = isMoving(now);
    // Bewegung: nur 1 GPU-Häppchen in der Warteschlange (60 fps), Stillstand: 2 (doppelter Durchsatz)
    R.maxInflight = moving ? 1 : 2;
    const key = viewKey();
    if (key !== RC.lastKey) { RC.lastKey = key; RC.keyT0 = now; }
    const needRef = p.mode === 'perturb';
    const refOK = needRef ? ensureRef(p, moving) : true;
    if (moving && Q.has('nopreview')) return;

    if (RC.fix) {
        if (RC.fix.key !== key) cancelFix();
        else return;
    }
    const sig = contentSig();
    if (RC.pjob && (moving || RC.pjob.baseKey !== key || RC.pjob.sig !== sig || RC.pjob.kind !== p.kind)) cancelPrefetch();
    let job = RC.job;
    if (job && job.key !== key) {
        // Veraltete Jobs: Vorschauen dürfen fertig werden, solange sie die Ansicht noch großteils
        // treffen (sie füllen Lücken); Verfeinerungen nur, wenn fast fertig und noch nah dran.
        const stale = job.kind !== p.kind || job.formula !== S.formula || job.sig !== sig || job.mode !== p.mode;
        const d = farFrom(job.view, S.cam);
        const vis = visibleFrac(job, S.cam);
        const prog = jobProgress(job);
        // zu tief (deckt zu wenig) oder viel zu weit (zu grob) bzw. kaum noch im Bild -> verwerfen
        const zr = job.view.zoom / S.cam.zoom;
        let cancel = stale || zr > 2.5 || zr < 1 / 6 || vis < 0.25;
        if (!job.preview && !job.isTarget && job.stage <= 2 && !(prog > 0.6 && d.r < 1.3 && vis > 0.85)) cancel = true;
        if (now - job.t0 > 1500 && prog < 0.5) cancel = true;
        // Zielbild einer Animation: weiterrechnen, solange es zum (neuen) Ziel bzw. auf den Weg passt
        if (job.isTarget && !stale) {
            const tg = animTarget();
            if (tg && (viewKey(tg.cam) === job.key || farFrom(job.view, tg.cam).r < 4.5)) cancel = false;
        }
        if (cancel) { cancelJob(); job = null; }
    }
    if (job) {
        const done = job.kind === 'gpu' ? R.pump(job, now, pumpCtl(moving)) : job.done;
        if (done) { RC.job = null; jobFinished(job, now); }
        return;
    }
    if (needRef && !refOK) return;
    if (needRef && !moving && !refUsable(true, true)) return;     // finales Bild nur mit frischer Referenz
    const front = RC.front;
    if (moving) {
        const est = RC.estFull || 400;
        const tg = animTarget();
        const tKey = tg ? viewKey(tg.cam) : null;
        const tn = tg ? farFrom(tg.cam, S.cam) : null;
        if (tg && tg.rest < 1.5 && tn.r <= 4.5 && tn.off <= 0.6 && !(front && front.key === tKey && (!front.preview || front.stage <= (est > 600 ? 2 : 1)))) {
            // Ziel bekannt und nah (Doppeltipp, Ende einer Tour, auslaufender Schwung): gleich das Zielbild
            // rechnen – erst eine schnelle Vorschau, falls am Ziel noch Lücken wären
            const cov = coverage(orderLayers(now, tg.cam), tg.cam, { sig, opaque: true, gx: 8, gy: 16 });
            const hasPrev = front && front.key === tKey;
            const div = cov.unc > 0 && !hasPrev ? Math.max(2, RC.previewDiv[p.kind]) : (est > 600 ? 2 : 1);
            startJob(tKey, div, p, tg.cam).isTarget = true;
        } else {
            // Vorschau für die Kamera, an der sie fertig sein wird (bekannte Pfade exakt, Gesten extrapoliert)
            // Horizont: Rechenzeit + halbe Einblendzeit (dann trägt die neue Ebene zur Hälfte)
            const view = predictCam(Math.min(0.3, (RC.estPreviewMs + FADE_MOVE_MS / 2) / 1000));
            // 3D: jede dritte Vorschau eine ferne Detailstufe (Horizont), jede neunte eine noch weitere
            RC.farTick = (RC.farTick || 0) + 1;
            if (V3.on && RC.farTick % 3 === 0) {
                const far = RC.farTick % 9 === 0 ? 64 : 8, sC = 3 / (view.zoom * canvas.height), sz = Math.max(canvas.width, canvas.height) / (far === 8 ? 2 : 4);
                startJob(viewKey(view) + '|far' + far, far, p, view, { preview: true, w: Math.ceil(sz), h: Math.ceil(sz), scale: sC * far }).part = true;
                if (RC.job && RC.job.kind === 'gpu') { const done = R.pump(RC.job, now, pumpCtl(moving)); if (done) { const j = RC.job; RC.job = null; jobFinished(j, now); } }
                return;
            }
            const pl = planPreview(now, view, p, sig);
            if (pl.skip) return;
            startJob(viewKey(view) + (pl.rect ? '|r' : ''), pl.div, p, pl.view || view, { preview: true, w: pl.w, h: pl.h, scale: pl.scale }).part = !!pl.rect;
        }
    } else if (!front || front.key !== key || front.sig !== sig || RC.foreign) {
        // Stillstand auf neuer Ansicht: ist das vorhandene Bild schon brauchbar scharf, direkt die
        // finale Stufe; sonst erst eine Zwischenstufe, bei Lücken eine schnelle Vorschau.
        const cov = coverage(orderLayers(now, S.cam), S.cam, { sig, opaque: true });
        const est = RC.estFull || 0;
        let div = 1;
        if (cov.unc > 0 && est > 600) div = Math.max(2, Math.min(RC.previewDiv[p.kind], 4));
        else if (cov.minK < 0.5 && est > 450) div = 2;
        startJob(key, div, p);
    } else if (!front.preview && !front.exact) {
        if (!RC.fix) { if (front.fixed) { front.exact = true; RC.dirty = true; fullDone(front, now); } else startFix(front, now); }
        return;
    } else if (front.preview) {
        const cov = coverage(orderLayers(now, S.cam), S.cam, { sig, opaque: true });
        const next = (front.stage > 2 && (RC.estFull || 0) > 450 && cov.minK < 0.5) ? 2 : 1;
        startJob(key, next, p);
    } else if (front.exact && !RC.fading) {
        prefetchStep(now, p, key);
        return;
    }
    if (RC.job && RC.job.kind === 'gpu') { const done = R.pump(RC.job, now, pumpCtl(moving)); if (done) { const j = RC.job; RC.job = null; jobFinished(j, now); } }
}

// Vorschau in Bewegung: rechnet nur, was fehlt. Kachelraster 8×16 über die vorausgesagte Ansicht
// (+Überhang), Schärfe je Kachel = schlechteste Stichprobe (Pufferpixel pro Bildschirmpixel).
//  1. Dringend (k < 0,3 oder leer, beim Schwenk der vordere Rand): zusammenhängender Bereich um die
//     schlechteste Kachel, in der feinsten Auflösung 1/d, die in ~120 ms Rechenzeit passt.
//  2. Sonst Verbesserung: feinste Stufe, bei der ein Rechteck (gierig um die schlechteste Kachel
//     gewachsen) im Budget ≥ 70 % der Kacheln mit k < 1/d abdeckt.
// Fast ganze Fläche -> normale Vorschau der ganzen Ansicht. (Gewinn-pro-Pixel als Kriterium wählte
// immer grob, ein Rechteck um alle Lücken war bei L-förmigem Bedarf zu groß.)
const TGX = 8, TGY = 16;
function planPreview(now, view, p, sig) {
    const W = canvas.width, H = canvas.height, k = p.kind, ex = OVER_MOVE;
    // Durchsatz in Bewegung (px/ms): gemessen; Startwert = ein Häppchen pro Frame
    const rate = RC.pxRate || R.chunkInfo().pxMove / Math.max(RC.vsync || 16.7, RC.dtEMA || 16.7);
    const budget = rate * 120;
    const list = orderLayers(now, view);
    const sCam = 3 / (view.zoom * H);
    const L = list.filter(l => l.sig === sig).map(l => ({ r: layerRect(l, view), k: Math.min(1, layerK(l, view)) }));
    const tw = W * ex / TGX, th = H * ex / TGY, X0 = W / 2 - W * ex / 2, Y0 = H / 2 - H * ex / 2;
    const tk = new Float32Array(TGX * TGY);
    for (let ty = 0; ty < TGY; ty++) for (let tx = 0; tx < TGX; tx++) {
        let m = 1;
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
            const x = X0 + (tx + 0.25 + 0.5 * sx) * tw, y = Y0 + (ty + 0.25 + 0.5 * sy) * th;
            let kk = 0;
            for (const e of L) if (x >= e.r.x0 && x <= e.r.x1 && y >= e.r.y0 && y <= e.r.y1) { kk = e.k; break; }
            m = Math.min(m, kk);
        }
        tk[ty * TGX + tx] = m;
    }
    let seed = 0;
    for (let i = 1; i < tk.length; i++) if (tk[i] < tk[seed]) seed = i;
    const cost = (r, d) => (r.x1 - r.x0 + 1) * tw * (r.y1 - r.y0 + 1) * th / (d * d);
    let pick = null;
    if (tk[seed] < 0.3) {
        // 1. dringender Bereich: Zusammenhangskomponente (4er-Nachbarschaft) der Kacheln mit k < 0,3
        const seen = new Uint8Array(tk.length), st = [seed];
        const r = { x0: seed % TGX, x1: seed % TGX, y0: (seed / TGX) | 0, y1: (seed / TGX) | 0 };
        seen[seed] = 1;
        while (st.length) {
            const i = st.pop(), x = i % TGX, y = (i / TGX) | 0;
            r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y);
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (nx < 0 || ny < 0 || nx >= TGX || ny >= TGY) continue;
                const j = ny * TGX + nx;
                if (!seen[j] && tk[j] < 0.3) { seen[j] = 1; st.push(j); }
            }
        }
        for (let d = 1; d <= MAXDIV[k]; d++) if (cost(r, d) <= budget || d === MAXDIV[k]) { pick = { d, r }; break; }
    } else {
        // 2. Verbesserung (passt keine Stufe zu ≥ 70 %, dann das beste Teilstück in der feinsten Stufe)
        let fallback = null;
        for (let d = 1; d <= MAXDIV[k] && !pick; d++) {
            const kd = 0.95 / d;
            let need = 0;
            for (let i = 0; i < tk.length; i++) if (tk[i] < kd) need++;
            if (!need) { if (d === 1) continue; else continue; }
            let s0 = -1;
            for (let i = 0; i < tk.length; i++) if (tk[i] < kd && (s0 < 0 || tk[i] < tk[s0])) s0 = i;
            const r = { x0: s0 % TGX, x1: s0 % TGX, y0: (s0 / TGX) | 0, y1: (s0 / TGX) | 0 };
            if (cost(r, d) > budget) continue;
            const frac = (x0, x1, y0, y1) => { let n = 0, t = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { t++; if (tk[y * TGX + x] < kd) n++; } return n / t; };
            for (;;) {
                const c = [];
                if (r.x0 > 0) c.push(['x0', -1, frac(r.x0 - 1, r.x0 - 1, r.y0, r.y1)]);
                if (r.x1 < TGX - 1) c.push(['x1', 1, frac(r.x1 + 1, r.x1 + 1, r.y0, r.y1)]);
                if (r.y0 > 0) c.push(['y0', -1, frac(r.x0, r.x1, r.y0 - 1, r.y0 - 1)]);
                if (r.y1 < TGY - 1) c.push(['y1', 1, frac(r.x0, r.x1, r.y1 + 1, r.y1 + 1)]);
                c.sort((a, b) => b[2] - a[2]);
                let grown = false;
                for (const [side, dir, f] of c) {
                    if (f < 0.5) break;
                    const r2 = Object.assign({}, r); r2[side] += dir;
                    if (cost(r2, d) <= budget) { Object.assign(r, r2); grown = true; break; }
                }
                if (!grown) break;
            }
            let cov = 0;
            for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (tk[y * TGX + x] < kd) cov++;
            if (cov >= 0.7 * need) pick = { d, r };
            else if (!fallback) fallback = { d, r };
        }
        if (!pick) pick = fallback;
    }
    if (!pick) return { skip: true };
    const d = pick.d, r = pick.r;
    RC.previewDiv[k] = d;
    const area = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (area >= 0.75 * TGX * TGY) return { div: d };
    const x0 = X0 + r.x0 * tw, x1 = X0 + (r.x1 + 1) * tw, y0 = Y0 + r.y0 * th, y1 = Y0 + (r.y1 + 1) * th;
    const w = Math.max(8, Math.ceil((x1 - x0) / d)), h = Math.max(8, Math.ceil((y1 - y0) / d));
    const cx = (x0 + x1) / 2 - W / 2, cy = (y0 + y1) / 2 - H / 2;
    return { div: d, rect: true, w, h, scale: sCam * d,
             view: { cx: view.cx + HP.fromNumber(cx * sCam), cy: view.cy + HP.fromNumber(cy * sCam), zoom: view.zoom } };
}

// ---------------- Tempo-Bremse („Schärfe-Front")
// Nur animierte Bewegungen (Flug/Tour/Doppeltipp/Rechteck, Rad, Schwung). Gemessen wird die Schärfe,
// die das Bild in ~150 ms hätte (Vorhersage + vorhandene Ebenen): fiele das 10-%-Quantil unter
// 0,4 Pufferpixel pro Bildschirmpixel, sinkt das Tempo weich (bis 0,4×), sonst
// steigt es wieder auf 1 (Totzone ±10 %, kein Pendeln). Warum 0,4 statt 0,5: Halb-Auflösungs-Vorschauen erreichen mit Vorhersage
// 0,43–0,5 – eine 0,5-Schwelle bremste auch dann, wenn die Rechnung gut mithält.
// Pinch/Schieben unter dem Finger bleibt 1:1. Schalter: Mehr → „Tempo an Rechenleistung anpassen".
function governorUpdate(now, dt) {
    const on = S.governor;
    if (!on || !animating()) { GOV.g = Math.min(1, GOV.g + dt * 3); GOV.coarse = 0; return; }
    const c = predictCam(0.1, false);
    const cov = coverage(orderLayers(now, c), c, { sig: contentSig(), gx: 10, gy: 20, quantile: 0.1 });
    // 10-%-Quantil der Schärfe (90 % des Bildes sind mindestens so scharf), Totzone ±10 % um die Schwelle
    GOV.q = cov.q;
    const e = (GOV.kmin - cov.q) / GOV.kmin;
    // 6.4: im Flug darf die Bremse bis 30 % gehen (sonst 40 %) – lieber etwas langsamer tauchen als ins Leere
    const gmin = FLY.on && !FLY.paused ? 0.3 : GOV.min;
    if (e > 0.1) GOV.g = Math.max(gmin, GOV.g - dt * 3 * Math.min(1, e));
    else if (e < -0.1) GOV.g = Math.min(1, GOV.g + dt * 0.8);
}

function look() {
    const p = PAL.list[S.palette];
    return { formula: S.formula, maxIter: RC.front ? RC.front.maxIter : currentMaxIter(), pal: p, custom: PAL.customFlat(),
             cycle: S.cycle, density: S.density, time: S.time, relief: S.relief ? S.reliefStrength : 0,
             particles: S.particles && S.anim, banded: S.banded,
             setCol: PAL.setRGB(S.setCol, S.setHex, p), alpine: S.alpine ? (['forest', 'lake', 'meadow'].indexOf(S.valley) + 1 || 1) : 0,
             inner: innActive() ? (S.inMode === 2 ? 2 : 1) : 0 };
}

// Ebenenliste + Optionen für den Display-Pass (auch für Screenshot/Thumbnail)
function presentArgs(now) {
    // Einblenden zählt ab dem ersten gezeigten Frame (ein ausgefallener Frame darf die Blende nicht verschlucken)
    for (const l of RC.layers) if (!l.shown) { l.shown = true; l.t0 = now; }
    const list = orderLayers(now, S.cam);
    RC.fading = list.some(l => l.alpha < 1 && !l.prefetch);   // Vorausberechnetes liegt unter dem fertigen Bild
    return { list, opts: { feather: FEATHER * dpr, recon: true, de: deActive() ? [0.25, 1.25] : null } };
}
// blendet gerade eine sichtbare Ebene ein (auch eine, die noch nie gezeigt wurde)?
function isFading(now) {
    return RC.layers.some(l => !l.prefetch && (!l.shown || layerFade(l, now) < 1));
}
function presentNow() { const a = presentArgs(performance.now()); R.present(a.list, S.cam, look(), null, a.opts); }

let lastPresentKey = '';
function present(now, camChanged) {
    const p = plan();
    if (p.kind === 'bulb') {
        if (camChanged || S.anim || RC.dirty) { R.presentBulb(S.cam, look()); RC.dirty = false; }
        return;
    }
    if (p.kind === 'buddha') { buddhaTick(now); return; }
    if (V3.on) {
        // 3D zeichnet bei Bewegung, Übergang, Farbanimation, Einblenden, Flug; sonst ruht es (Akku)
        const busy = camChanged || S.anim || RC.fading || RC.dirty || V3.dir || (FLY.on && !FLY.paused) || now - V3.probeT > 300 || V3.accPending || T3.waiting;
        RC.dirty = false;
        if (busy) { try { present3d(now, camChanged); } catch (e) { if (!e.shaderKey) throw e; fail3d(); } }
        return;
    }
    const wasFading = RC.fading;
    const a = presentArgs(now);
    const anim = S.anim || RC.fading || wasFading;
    if (!camChanged && !anim && !RC.dirty) return;
    RC.dirty = false;
    R.present(a.list, S.cam, look(), null, a.opts);
    if (FS.on) frameStatsRecord(now, a.list);
}

// ---------------- Debug-Hook: Pop-Metrik pro Frame (__fraktal.frameStats)
const FS = { on: false, frames: [], seen: new WeakSet(), hard: 0 };
function frameStatsRecord(now, list) {
    const c = coverage(list, S.cam, { gx: 24, gy: 48 });
    let hard = 0;
    for (const l of list) if (!FS.seen.has(l)) { FS.seen.add(l); if (list.length > 1 && l === list[0] && l.alpha >= 0.99 && FS.frames.length) { hard++; (FS.hardInfo = FS.hardInfo || []).push({ stage: l.stage, fadeMs: l.fadeMs, age: now - l.t0, prefetch: l.prefetch, exact: l.exact, n: list.length }); } }
    FS.hard += hard;
    FS.frames.push({ t: +now.toFixed(1), z: S.cam.zoom, k: +c.kMean.toFixed(3), coarse: +c.coarse.toFixed(3), unc: +c.unc.toFixed(3), n: list.length, hard, g: +GOV.g.toFixed(2), q: GOV.q === undefined || GOV.q === null ? null : +GOV.q.toFixed(2), moving: isMoving(now),
                     div: RC.previewDiv.gpu, job: RC.job ? RC.job.stage + (RC.job.isTarget ? 't' : '') + ':' + Math.round(jobProgress(RC.job) * 100) : '', est: Math.round(RC.estPreviewMs), dt: +(RC.dtEMA || 0).toFixed(1), vs: +(RC.vsync || 0).toFixed(1), px: R.chunkInfo().pxMove });
    if (FS.frames.length > 20000) FS.frames.shift();
}

// ------------------------------------------------------------------ 3D-Landschaft + Flug (6.0)
// Die 3D-Ansicht liest nur die fertigen Iterationspuffer (Ebenen-Stapel) – die Rechnung bleibt die
// gleiche wie in 2D (gleiche Kamera S.cam = Bodenpunkt in der Bildmitte), exakt wie dort. In 3D wird die
// Rechenansicht quadratisch (Drehen ohne Lücken) und es kommen ferne Detailstufen für den Horizont dazu.
const T3 = self.FK3D ? self.FK3D.create(R) : null;
const MAXL3 = T3 ? T3.N3 : MAXL;         // P2-3: Ebenen-Höchstzahl in 3D
const MAX_TILT = 60 * Math.PI / 180;
const V3 = { on: false, mix: 0, dir: 0, tilt: 42 * Math.PI / 180, heading: 0, L: [4, 9], Lt: null, probeT: 0, probe: null,
             accKey: null, accN: 0, accPending: false, keyT: 0, animTick: 0, moved: false, accMs: null };
function can3d(f) { return !!T3 && ![6, 7].includes(f === undefined ? S.formula : f); }
// 6.3: 3D wird erst eingeblendet, wenn alle Shader dafür fertig übersetzt sind (T3.ready fragt nicht blockierend,
// pro Bild). Bis dahin bleibt das 2D-Bild bedienbar, der ⛰-Knopf zeigt „3D wird vorbereitet …“ (V3.prep = Startzeit).
// Unter Windows (Direct3D 11) kann das Übersetzen Sekunden dauern – vorher hing der Tab so lange.
function set3d(on) {
    if (on && !can3d()) return;
    if (!on && V3.prep) { V3.prep = 0; V3.prepFly = null; emit('3d'); if (!V3.on) return; }
    if (on && !V3.on && T3 && !ready3d()) { if (!V3.prep) { V3.prep = performance.now(); emit('3d'); } return; }
    if (on === V3.on && V3.dir === (on ? 1 : -1)) return;
    if (on) { V3.on = true; V3.dir = 1; V3.heading = 0; if (T3) T3.scale = baseScale3d(); }
    else { V3.dir = -1; stopFly(); }
    invalidate(); emit('3d');
}
// P1-2: ein 3D-Programm ist auf diesem Treiber defekt -> Vorbereitung abbrechen bzw. 3D sofort aus (2D läuft weiter)
function fail3d() {
    V3.prep = 0; V3.prepFly = null;
    if (V3.on) {
        stopFly();
        for (const l of RC.layers) T3.free(l);
        T3.freeStill();
        V3.on = false; V3.mix = 0; V3.dir = 0; V3.heading = 0; V3.accKey = null; V3.accPending = false;
        invalidate();
    }
    toast(t('shader_3d_failed'), 4500);
    emit('3d');
}
// fertig übersetzt (nicht blockierend gefragt) und angewärmt (je Bild ein Programm) – erst dann 3D einblenden
function ready3d() { const lk = look(); return T3.ready(lk) && T3.warm(lk); }
function baseScale3d() { return Q.get('s3d') ? +Q.get('s3d') : (Math.min(screen.width, screen.height) < 700 ? 0.65 : 1); }
const e3 = (x) => x * x * (3 - 2 * x);
// Übergang 2D <-> 3D (0,7 s): Neigung/Höhe/Drehung wachsen mit mix; bei mix = 0 ist 3D = 2D-Bild
function update3d(now, dt) {
    if (V3.prep && !V3.on) {
        if (!can3d()) { V3.prep = 0; V3.prepFly = null; emit('3d'); return; }
        if (!ready3d()) { if (T3.failed) { fail3d(); return; } if (stats.frames % 6 === 0) emit('3dprep'); return; }
        const fl = V3.prepFly;
        V3.prep = 0; V3.prepFly = null;
        if (fl) startFly(fl === true ? undefined : fl); else set3d(true);
        return;
    }
    if (!V3.on) return;
    if (V3.dir) {
        V3.mix = Math.max(0, Math.min(1, V3.mix + V3.dir * dt / 0.7));
        RC.dirty = true;                          // Neigen/Drehen/Höhe sind Darstellung, keine Kamerabewegung
        if (V3.mix >= 1 && V3.dir > 0) V3.dir = 0;
        if (V3.mix <= 0 && V3.dir < 0) {
            V3.dir = 0; V3.on = false; V3.heading = 0;
            for (const l of RC.layers) T3.free(l);
            T3.freeStill(); V3.accKey = null; V3.accPending = false;
            invalidate(); emit('3d');
            return;
        }
    }
    // Höhen-Normierung weich nachführen
    if (V3.Lt) {
        const k = Math.min(1, dt * 2.5);
        const a = V3.L[0] + (V3.Lt[0] - V3.L[0]) * k, b = V3.L[1] + (V3.Lt[1] - V3.L[1]) * k;
        if (Math.abs(a - V3.L[0]) + Math.abs(b - V3.L[1]) > 1e-3) { V3.L = [a, b]; RC.dirty = true; }
        if (V3.cdfT && V3.cdf) for (let i = 0; i < 9; i++) { const d = (V3.cdfT[i] - V3.cdf[i]) * k; if (Math.abs(d) > 1e-4) { V3.cdf[i] += d; RC.dirty = true; } }
    }
    if (FLY.on && !FLY.paused) flyUpdate(now, dt);
    else if (Math.abs(FLY.roll || 0) > 1e-4 || FLY.om) { FLY.roll = (FLY.roll || 0) * Math.exp(-dt * 3); FLY.om = 0; if (Math.abs(FLY.roll) <= 1e-4) FLY.roll = 0; RC.dirty = true; }   // Schräglage klingt aus
    if (V3.northT) {
        const u = Math.min(1, (now - V3.northT) / 450), e = ease(u);
        const h0 = V3.northFrom[0] - Math.round(V3.northFrom[0] / (2 * Math.PI)) * 2 * Math.PI;
        V3.heading = h0 * (1 - e); V3.tilt = V3.northFrom[1] + (42 * Math.PI / 180 - V3.northFrom[1]) * e;
        RC.dirty = true;
        if (u >= 1) V3.northT = 0;
    }
    // Renderauflösung an die Bildrate anpassen (Ziel: Vsync halten, mind. 50 %)
    // (nicht unter Testautomation: headless liefert ohnehin nur ~15 fps, das wäre kein Lastsignal)
    if (navigator.webdriver || Q.get('s3d') || V3.accKey) return;   // Stillstands-Bilder sind kein Lastsignal für die Bewegungs-Auflösung
    const vs = RC.vsync || 16.7;
    V3.slow = (V3.slow || 0) + ((RC.dtEMA || 16) > 1.3 * vs ? 1 : -0.25);
    if (V3.slow > 40) { T3.scale = Math.max(0.45, T3.scale * 0.9); V3.slow = 0; }
    else if (V3.slow < -200) { T3.scale = Math.min(baseScale3d(), T3.scale * 1.05); V3.slow = 0; }
}
// 6.5 Deko in 3D (Wolken, Horizontleuchten, Luftperspektive, Wolken im Wasser): Stärke 0..1, weich ein-/ausgeblendet.
// Aus (= exakt das Bild und die Kosten bis 6.4.1) bei ?deko=0, Qualität „Akku“ und solange die Auflösungs-Drosselung
// greift. Wolkenzug nur, solange ohnehin animiert gezeichnet wird, nicht bei „Bewegung reduzieren“.
const DK = { m: DEKO ? 1 : 0, t: 0, ct: 0 };
function deko3d() {
    const now = performance.now(), dt = DK.t ? Math.min(0.1, (now - DK.t) / 1000) : 0;
    DK.t = now;
    const tgt = DEKO && S.quality !== 'eco' && !(T3 && T3.scale < baseScale3d() - 1e-3) ? 1 : 0;
    if (DK.m !== tgt) { DK.m = tgt > DK.m ? Math.min(tgt, DK.m + dt * 1.2) : Math.max(tgt, DK.m - dt * 1.2); RC.dirty = true; }
    return DK.m;
}
function view3d() {
    const em = e3(V3.mix);
    return { tilt: V3.tilt * em, heading: V3.heading * (V3.dir < 0 ? em : 1), roll: (FLY.roll || 0) * em, height: S.h3d * 1.1, mix: em, focus: S.cam, u: 1.5 / S.cam.zoom, L: V3.L, cdf: V3.cdf, time: S.time,
             deko: deko3d(), ctime: DK.ct };
}
// Ebenen für 3D: gültiger Inhalt, schärfste zuerst, höchstens N3 – die größte (Horizont) immer dabei
function layers3d(list) {
    const sig = contentSig();
    let L = list.filter(l => l.sig === sig && l.alpha > 0).sort((a, b) => a.scale - b.scale || b.seq - a.seq);
    if (L.length > T3.N3) {
        let big = L[0];
        for (const l of L) if (l.buf.w * l.buf.h * l.scale * l.scale > big.buf.w * big.buf.h * big.scale * big.scale) big = l;
        L = L.slice(0, T3.N3 - 1).concat(L.slice(T3.N3 - 1).includes(big) ? [big] : [L[T3.N3 - 1]]);
    }
    return L;
}
// 6.1 Glatte Kanten in 3D: im Stillstand wird das Bild in voller Auflösung mit Subpixel-Versatz gezeichnet und
// gemittelt (aaFrames() Bilder, Standard 8, Akku 4); danach ruht die GPU (bei Farbanimation: weiter mitteln,
// jedes zweite Frame). Stillstand = nichts außer Farbzyklus/Zeit hat sich seit 120 ms geändert.
// harter Schlüssel: Kamera/Blick/Größe/Farbwahl – Änderung = neu mitteln. Weicher Schlüssel: Ebenen, Höhen-
// Normierung – Änderung = weitermitteln mit dem bisherigen Bild als erstem Beitrag (kein kurzes Aufflackern
// ungeglätteter Kanten, wenn im Stillstand eine vorausgerechnete Ebene einblendet)
function still3dKey(L3, v, lk) {
    const c = S.cam;
    return [c.cx, c.cy, c.zoom, v.tilt.toFixed(5), v.heading.toFixed(5), v.height, v.mix, canvas.width, canvas.height, S.palette, lk.density, lk.banded, deActive(), FLY.on, lk.setCol.join(','), lk.alpine, T3.variant].join('|');
}
function still3dSoft(L3, v, lk) {
    return [v.L[0].toFixed(3), v.L[1].toFixed(3), (v.cdf || []).map(x => x.toFixed(3)).join(','), L3.map(l => l.seq + ':' + l.alpha.toFixed(2)).join(','), lk.maxIter].join('|');
}
function present3d(now, camChanged, force) {
    const a = presentArgs(now);
    const v = view3d();
    const L3 = layers3d(a.list);
    const alpha = Math.min(1, v.mix / 0.25);
    const lk = look();
    const N = V3.testStill ? V3.testStill.N : aaFrames();
    const o = { de: [0.25, 1.25] };
    let drawn = true;
    const key = N > 0 && alpha >= 1 && !V3.dir && !(FLY.on && !FLY.paused) && !gestures.active() ? still3dKey(L3, v, lk) : null;
    if (key !== V3.accKey) { V3.accKey = key; V3.accN = 0; V3.keyT = now; }
    const soft = key ? still3dSoft(L3, v, lk) : null;
    if (soft !== V3.accSoft) { V3.accSoft = soft; V3.accN = Math.min(V3.accN, 1); }
    const still = key && !isMoving(now) && now - V3.keyT > 120;
    if (still) {
        // (wartet eine neue Gelände-Variante auf den Treiber, weiterzeichnen – nur beim Zeichnen wird sie übernommen)
        if (V3.accN >= N && !T3.waiting && (!S.anim || (++V3.animTick & 1))) { drawn = false; if (force) T3.present(); }
        else {
            const mix2 = V3.moved && V3.accN < 3 ? 1 - (V3.accN + 1) / 4 : 0;
            const scale = V3.testStill ? V3.testStill.scale : (Q.get('s3d') ? +Q.get('s3d') : 1);
            T3.render(L3, v, lk, undefined, Object.assign(o, { still: { n: V3.accN, N, mix2, scale } }));
            if (V3.accN === 0) V3.accT0 = now;
            V3.accN++;
            if (V3.accN === N) { V3.accMs = now - V3.accT0; V3.moved = false; }
        }
    } else {
        if (alpha < 1) R.present(a.list, S.cam, lk, null, a.opts);
        T3.render(L3, v, lk, alpha < 1 ? alpha : undefined, o);
        V3.moved = true;
        if (V3.accKey) V3.accN = 0;
    }
    V3.accPending = !!key && V3.accN < N;
    if (FS.on) frameStatsRecord(now, a.list);
    // Sonde: Höhenstatistik + Interesse für den Zufallsflug (alle 300 ms, asynchron)
    // (im Zufallsflug alle 150 ms: die Zielwahl am Mengenrand braucht frische Daten)
    if (now - V3.probeT > (FLY.on && !FLY.paused ? 150 : 300)) {
        V3.probeT = now;
        const cam = S.cam;
        const pr = T3.probe(L3, cam, 1.5 / cam.zoom, 2);
        if (pr) pr.then((pb) => { if (pb) { pb.cam = cam; pb.seq = (V3.probe ? V3.probe.seq || 0 : 0) + 1; V3.probe = pb; heightStats(pb); } });
    }
}
function heightStats(pb) {
    const hs = [];
    for (const v of pb.data) if (v >= 0) hs.push(Math.log2(1 + (S.formula === 5 ? v % 1000 : v)));
    if (hs.length < 40) return;
    hs.sort((x, y) => x - y);
    let a = hs[Math.floor(hs.length * 0.02)], b = hs[Math.floor(hs.length * 0.99)];
    if (b - a < 0.4) { const m = (a + b) / 2; a = m - 0.2; b = m + 0.2; }
    V3.Lt = [a, b];
    // Stützstellen der Höhen-Entzerrung (Quantile 2 %, 1/8 … 99 %), streng steigend
    const cdf = [];
    for (let i = 0; i <= 8; i++) cdf.push(i === 0 ? a : i === 8 ? b : hs[Math.floor(hs.length * (0.02 + 0.97 * i / 8))]);
    for (let i = 1; i <= 8; i++) cdf[i] = Math.max(cdf[i], cdf[i - 1] + (b - a) / 64);
    V3.cdfT = cdf;
    if (!V3.Lset) { V3.L = [a, b]; V3.cdf = cdf.slice(); V3.Lset = true; }
}

// ---- Gesten in 3D: 1 Finger schieben (auf dem Boden), 2 Finger zoomen + drehen, gemeinsam hoch/runter = neigen
function gesture3d(b, ax0, ay0, ax, ay, scale, rot, n) {
    if (FLY.on) {
        if (n >= 2) stopFly();
        else { FLY.user = FLY.userBase + (ax - ax0) / cssW * 1.6; return; }   // Wischen lenkt
    }
    if (n >= 2) {
        setCam(b.cam.cx, b.cam.cy, b.cam.zoom * scale);
        V3.heading = b.heading - rot;
        V3.tilt = Math.max(0, Math.min(MAX_TILT, b.tilt - (ay - ay0) * 0.006));
    } else {
        const c = ground3d(b.cam, ax - ax0, ay - ay0);
        setCam(c.cx, c.cy, c.zoom);
    }
    RC.dirty = true;
}
// Bildschirm-Verschiebung (CSS px) -> neue Kamera: der Boden folgt dem Finger (Neigung gestaucht)
function ground3d(cam, dx, dy) {
    const k = 2 / cssH, t = V3.tilt * e3(V3.mix);
    const gx = dx * k, gy = dy * k / Math.max(0.35, Math.cos(t));
    const h = V3.heading, f = [Math.sin(h), Math.cos(h)], r = [Math.cos(h), -Math.sin(h)];
    const u = 1.5 / cam.zoom;
    return { cx: cam.cx + HP.fromNumber((-gx * r[0] + gy * f[0]) * u), cy: cam.cy + HP.fromNumber((-gx * r[1] + gy * f[1]) * u), zoom: cam.zoom };
}

// 3D-Flug: js/flight.js

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
    const src = RC.lastPreview;   // Vorschau-Puffer (klein) asynchron lesen
    if (S.cam.zoom < 20 || !src || src.stage === 1 || src.sig !== fr.sig) return;
    if (!src || !src.buf || src.buf.w * src.buf.h > 400000) return;
    const k = fr.key;
    R.readIterAsync(src.buf).then((vals) => {
        if (!vals || !RC.front || RC.front.key !== k) return;
        let inside = 0;
        for (let i = 0; i < vals.length; i++) if (vals[i] < 0) inside++;
        if (inside / vals.length > 0.97 && insideWarnKey !== k) { insideWarnKey = k; toast(t('inside_toast')); }
    });
}

// URL-Zustand (Deeplinks): js/url-state.js

// ------------------------------------------------------------------ Hauptschleife
let lastT = performance.now();
const PROF = Q.has('prof') ? [] : null;   // Test: Frames > 25 ms JS mit Teilzeiten
const VS = { buf: new Array(90).fill(0), i: 0 };
// Test (6.4, tests/measure_fly.py): ?fpscap=N begrenzt die Bildrate (langsames Gerät nachstellen)
const FPSCAP = +Q.get('fpscap') || 0;
let capT = 0;
const seenErr = new Set();
function reportOnce(e) { const m = String(e && e.message || e); if (!seenErr.has(m)) { seenErr.add(m); console.error('Fraktal-Explorer:', e); } }
function frame(now) {
    requestAnimationFrame(frame);
    if (FPSCAP) { if (now - capT < 1000 / FPSCAP - 2) return; capT = now; }
    const js0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    if (document.hidden || R.lost || NOFIRST) return;
    S.time += dt;
    if (S.anim) S.cycle += dt * S.speed;
    // P3-6: Zähler begrenzen (f32 im Shader: nach ~1 Tag Dauerbetrieb nur noch 10⁻³ Auflösung -> Farbbänder). Farbzyklus
    // mit Periode 1000: alle Paletten sind darin exakt periodisch (Frequenzen 0,4/0,5/0,7/1/2; der 3D-Himmel nutzt sie ohne
    // fract) – 1024 hätte dort bei jedem Umlauf einen Farbsprung gegeben. Zeit: einmal pro 24 h ein kleiner Phasensprung
    // der Funkel-/Wasseranimation (sin/cos mit nicht ganzzahligen Faktoren sind mit keiner Periode exakt periodisch).
    S.cycle %= 1000;
    S.time %= 86400;
    if (S.anim && V3.on && !RM.matches) DK.ct += dt;     // 6.5 Wolkenzug
    updateAnims(now, dt);
    update3d(now, dt);
    if (V3.on && !can3d()) { V3.on = false; V3.mix = 0; V3.dir = 0; stopFly(); emit('3d'); }
    const camChanged = camDirty;
    camDirty = false;
    RC.dtEMA = RC.dtEMA === undefined ? 16 : RC.dtEMA * 0.8 + dt * 1000 * 0.2;
    // Vsync-Periode schätzen: 25-%-Quantil der letzten 90 Frame-Zeiten, eingerastet auf übliche
    // Bildraten (120/90/60/30 Hz). 5.0.1 nahm das Minimum (driftend) – einzelne kurze Frames drückten
    // die Schätzung auf ~8 ms, der Häppchen-Regler schrumpfte dann die Vorschau-Arbeit auf 1024 px/Frame.
    const dms = dt * 1000;
    if (dms > 2) { VS.buf[VS.i++ % VS.buf.length] = dms; }
    if (stats.frames % 10 === 0 || RC.vsync === undefined) {
        const a = VS.buf.slice(0, Math.min(VS.i, VS.buf.length)).sort((x, y) => x - y);
        if (a.length >= 8) {
            const q = a[Math.floor(a.length * 0.25)];
            let best = 16.67;
            for (const per of [8.33, 11.11, 16.67, 33.33]) if (per <= q * 1.12) best = per;
            RC.vsync = best;
        } else if (RC.vsync === undefined) RC.vsync = 16.67;
    }
    if (camChanged) RC.lastMoveT = now;
    // Frame-Zeit ohne Rechenlast (vorheriger Frame ohne GPU-Häppchen): ist schon sie lang (Browser
    // drosselt, schwaches Display-Budget), darf der Häppchen-Regler deswegen nicht verhungern
    if (!R.submitted && dms > 2) RC.idleDt = RC.idleDt === undefined ? dms : RC.idleDt * 0.9 + dms * 0.1;
    R.submitted = 0;
    const moving = isMoving(now);
    trackVelocity(now, moving);
    governorUpdate(now, dt);
    if (stats.frames % 8 === 0) pruneLayers(now);
    const tS = performance.now();
    try { schedule(now); } catch (e) { reportOnce(e); }       // P1-2: ein Fehler friert die Schleife nicht ein
    const tP = performance.now();
    try { present(now, camChanged); } catch (e) { reportOnce(e); }
    if (!GW.firstPic && (RC.layers.length || S.formula >= 6)) gwFirstPicture();
    if (PROF) { const tE = performance.now(); if (tE - js0 > 25) PROF.push({ t: Math.round(now), pre: +(tS - js0).toFixed(1), sched: +(tP - tS).toFixed(1), present: +(tE - tP).toFixed(1), job: RC.job ? RC.job.key.slice(-12) : '', n: RC.layers.length }); }
    stats.frames++;
    if (now - stats.fpsT > 1000) { stats.fps = Math.round(stats.frames * 1000 / (now - stats.fpsT)); stats.frames = 0; stats.fpsT = now; }
    syncURL(now);
    emit('frame');
    const js = performance.now() - js0;
    stats.jsMs = stats.jsMs === undefined ? js : stats.jsMs * 0.9 + js * 0.1;
    if (js > (stats.jsMax || 0)) stats.jsMax = js;
}

R.onRestored = () => {
    gwRestored();
    gpuPerturbOK = SIMPLE ? false : R.selfTest();
    // alle GPU-Objekte sind weg: 3D-Ziele/Programme, Höhentexturen der Ebenen, Mittelung, Buddhabrot-Bild (P1-3)
    if (T3) T3.reset();
    for (const l of RC.layers) l.h3d = null;
    V3.accKey = null; V3.accPending = false; V3.Lset = false;
    BUD.hist = null;
    RC.front = RC.lastPreview = null; RC.layers = []; RC.job = RC.pjob = null; RC.fix = null; REF.cur = null; invalidate();
};
R.onLost = () => { RC.job = RC.pjob = null; gwLost(); };

// ------------------------------------------------------------------ 6.5.2 Grafik-Wächter: nie eine endlose leere Fläche
// (1) Kontextverlust: nach 1,5 s „Grafik wird neu verbunden …“; kommt nach 6 s keine Wiederherstellung (Chrome nach einem
//     Absturz des GPU-Prozesses, WebGL für die Seite gesperrt), Meldung mit „Neu laden“ (Ansicht steht vorher im Link).
// (2) Start-Wächter: nach 12 s (Handy 20 s, sichtbare Zeit) noch kein erstes Bild -> Meldung mit „Neu laden“ und
//     „Einfache Grafik“. Kommt das Bild doch noch, verschwindet sie. Solange eine Meldung steht, ist der Canvas
//     ausgeblendet (dunkler App-Hintergrund statt eines verlorenen, evtl. weißen Canvas).
// Test-Hook ?test_nofirstframe=1: es wird nie gezeichnet (Start-Wächter).
const NOFIRST = Q.has('test_nofirstframe');
const GW = { el: null, kind: '', timers: [], firstPic: false, vis: 0, last: performance.now(), limit: Math.min(screen.width, screen.height) < 700 ? 20000 : 12000 };
function gpuNote(kind) {
    GW.kind = kind;
    document.documentElement.classList.toggle('gl-off', !!kind);
    if (!kind) { if (GW.el) GW.el.hidden = true; return; }
    if (!GW.el) {
        GW.el = document.createElement('div');
        GW.el.id = 'gpu-note'; GW.el.className = 'glass'; GW.el.setAttribute('role', 'alert');
        document.body.appendChild(GW.el);
    }
    const btn = (id, key) => `<button id="${id}" class="chip">${t(key)}</button>`;
    GW.el.innerHTML = kind === 'wait' ? `<p class="msg">${t('gpu_wait')}</p>`
        : `<p class="msg">${t(kind === 'lost' ? 'gpu_lost' : 'gpu_stuck')}</p><div class="btns">${btn('gpu-reload', 'gpu_reload')}${kind === 'stuck' ? btn('gpu-simple', 'gpu_simple') : ''}</div><p class="hint">${t('gpu_lost_hint')}</p>`;
    GW.el.dataset.kind = kind;
    GW.el.hidden = false;
    const r = GW.el.querySelector('#gpu-reload'), s = GW.el.querySelector('#gpu-simple');
    if (r) r.onclick = () => reloadHere(false);
    if (s) s.onclick = () => reloadHere(true);
}
// neu laden und am selben Ort landen (Ansicht in den Link; „Einfache Grafik“ gilt nur für diese Sitzung)
function reloadHere(simple) {
    try { history.replaceState(null, '', stateURL()); } catch (e) {}
    try { if (simple) sessionStorage.setItem('fk_simple', '1'); } catch (e) {}
    location.reload();
}
function gwLost() {
    GW.timers.forEach(clearTimeout);
    GW.timers = [setTimeout(() => { if (R.lost) gpuNote('wait'); }, 1500), setTimeout(() => { if (R.lost) gpuNote('lost'); }, 6000)];
}
function gwRestored() { GW.timers.forEach(clearTimeout); GW.timers = []; if (GW.kind === 'wait' || GW.kind === 'lost') gpuNote(''); }
function gwFirstPicture() { GW.firstPic = true; if (GW.kind === 'stuck') gpuNote(''); }
const gwStart = setInterval(() => {
    const now = performance.now();
    if (!document.hidden) GW.vis += now - GW.last;
    GW.last = now;
    if (GW.firstPic) { clearInterval(gwStart); return; }
    if (GW.vis > GW.limit && !GW.kind) gpuNote('stuck');
}, 500);
if (R.lost) gwLost();

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
        if (V3.on) present3d(performance.now(), false, true); else presentNow();   // frisch zeichnen, dann sofort abgreifen
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
// 6.5: frisches Bild zeichnen (2D oder 3D) – danach ist der Canvas im selben Task lesbar (Überblendung, Schnappschuss)
function freshFrame() { if (V3.on) present3d(performance.now(), false, true); else presentNow(); }
function fileName() { return `Fraktal_${MODE_KEYS[S.formula]}_${S.cam.zoom.toExponential(1).replace('+', '')}_${Date.now()}.png`; }

// ------------------------------------------------------------------ Start
function init() {
    loadSettings();
    if (SIMPLE) { SIMPLE = { renderer: S.renderer, quality: S.quality }; S.renderer = 'cpu'; S.quality = 'eco'; }
    const fromURL = readURL();
    if (!fromURL) setCam(HP.fromString('-0.5'), 0n, 1);
    if (Q.get('renderer')) S.renderer = Q.get('renderer');
    if (Q.has('noanim')) S.anim = false;
    if (Q.has('nobla')) R.noBLA = true;
    if (Q.has('nowarm')) R.noWarm = true;      // 6.3 A/B: 3D-Programme vor dem Einblenden nicht anwärmen
    resize();
    cpuPool();      // P2-1: Worker gleich beim Start laden (im Leerlauf kostenlos) – ein späteres Update kann sie nicht mehr entziehen
    requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ Module (Phase 4)
// CTX: Zugriff der Module auf app.js (Getter, bei Veränderlichen auch Setter)
const CTX = {
    get HP() { return HP; },
    get PAL() { return PAL; },
    get S() { return S; },
    get isMoving() { return isMoving; },
    get setCam() { return setCam; },
    get R() { return R; },
    get RC() { return RC; },
    get REF() { return REF; },
    get V() { return V; },
    get addLayer() { return addLayer; },
    get buddhaMerge() { return buddhaMerge; },
    get cancelJob() { return cancelJob; },
    get fullDone() { return fullDone; },
    get stats() { return stats; },
    get t() { return t; },
    get toast() { return toast; },
    get FLY() { return FLY; },
    get autoIter() { return autoIter; },
    get cancelFix() { return cancelFix; },
    get cancelPrefetch() { return cancelPrefetch; },
    get cpuBroadcast() { return cpuBroadcast; },
    get cpuSendRef() { return cpuSendRef; },
    get cssH() { return cssH; }, set cssH(v) { cssH = v; },
    get cssW() { return cssW; }, set cssW(v) { cssW = v; },
    get currentMaxIter() { return currentMaxIter; },
    get dpr() { return dpr; }, set dpr(v) { dpr = v; },
    get flight() { return flight; }, set flight(v) { flight = v; },
    get flightCamAt() { return flightCamAt; },
    get innActive() { return innActive; },
    get recompute() { return recompute; },
    get worldPerCss() { return worldPerCss; },
    get FADE_MOVE_MS() { return FADE_MOVE_MS; },
    get FADE_MS() { return FADE_MS; },
    get MAXL() { return MAXL; },
    get MAXL3() { return MAXL3; },
    get V3() { return V3; },
    get canvas() { return canvas; },
    get deActive() { return deActive; },
    get smooth01() { return smooth01; },
    get viewKey() { return viewKey; },
    get GOV() { return GOV; },
    get MODE_HOME() { return MODE_HOME; },
    get Q() { return Q; },
    get T3() { return T3; },
    get camDirty() { return camDirty; }, set camDirty(v) { camDirty = v; },
    get can3d() { return can3d; },
    get clampZoom() { return clampZoom; },
    get emit() { return emit; },
    get look() { return look; },
    get ready3d() { return ready3d; },
    get set3d() { return set3d; },
    get setJulia() { return setJulia; },
    get setMode() { return setMode; },
    get stopAnims() { return stopAnims; },
};
const M_UrlState = self.FKUrlState.create(CTX);
const { readURL, setColParam, stateURL, syncURL } = M_UrlState;
const M_CpuPool = self.FKCpuPool.create(CTX);
const { cancelFix, cpuBroadcast, cpuFeed, cpuPool, cpuSendRef, cpuWorkers, recompute, startFix } = M_CpuPool;
const M_Refs = self.FKRefs.create(CTX);
const { REF, ensureRef, refUsable, requestRefFor } = M_Refs;
const M_Layers = self.FKLayers.create(CTX);
const { addLayer, contentSig, coverage, layerFade, layerK, layerRect, makeFrame, orderLayers, pruneLayers } = M_Layers;
const M_Flight = self.FKFlight.create(CTX);
const { FLY, flyStep, flyUpdate, north3d, pauseFly, startFly, stopFly } = M_Flight;
// MODULE_LINK
// Module verknüpfen
M_Flight.link();
M_Layers.link();
M_Refs.link();
M_CpuPool.link();
M_UrlState.link();

// Öffentliche API für ui.js + E2E-Tests (window.__fraktal)
const API = {
    APP_VERSION, S, R, RC, REF, stats, HP, PAL, MODE_KEYS, MAX_ZOOM, MODE_HOME, DIRECT_MAX, GPU_MAX, deActive, aaFrames,
    t, fmtZoom, fmtC, toast, on: (f) => listeners.push(f), emit, DEKO, RM, freshFrame,
    setMode, setJulia, changeIter, setIterAuto, currentMaxIter, autoIter, flyTo, startTour, setCam, stopAnims,
    invalidate, resize, saveSettings, plan, stateURL, captureBlob, fileName, zoomAt, presentNow,
    V3, FLY, GOV, set3d, can3d, startFly, stopFly, pauseFly, north3d, MAX_TILT, look, T3,
    // 3D-Shader beim Antippen des 3D-Knopfs vorab übersetzen (Treiber parallel, bis zum Loslassen ~100 ms Vorsprung).
    // Nicht automatisch im Leerlauf: dann warteten 2D-Shader/-Rechnungen hinter den großen 3D-Shadern (gemessen).
    // 6.3: nur die Programme des aktuellen Looks, nicht blockierend (T3.ready pollt danach pro Bild)
    prewarm3d() { if (T3 && !V3.on) T3.prewarm(look()); },
    layers3dInfo() { const now = performance.now(); return layers3d(orderLayers(now, S.cam)).map(l => ({ stage: l.stage, scale: l.scale / (3 / (S.cam.zoom * canvas.height)), alpha: +l.alpha.toFixed(2), w: l.buf.w, h: l.buf.h, h3d: !!l.h3d, out: !!l.outT, front: l === RC.front })); },
    // Test (6.3, tests/compare_3d_shader.py): Ebenen, Ansicht und Look des aktuellen 3D-Bilds – zum Zeichnen mit einer
    // zweiten 3D-Instanz (alter Shader) auf exakt denselben Daten
    args3d() { return { L3: layers3d(orderLayers(performance.now(), S.cam)), v: view3d(), lk: look(), o: { de: [0.25, 1.25] } }; },
    view3dInfo() { return { on: V3.on, prep: !!V3.prep, prepInfo: T3 ? T3.prep || null : null, mix: V3.mix, tilt: V3.tilt, heading: V3.heading, L: V3.L, fly: { on: FLY.on, paused: FLY.paused, mode: FLY.mode }, gpu: T3 ? T3.info() : null }; },
    // still = true: Bilder der Stillstands-Mittelung (volle Auflösung) statt Bewegungsbilder
    bench3d(n = 5, still = false) {
        const gl = R.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext || !V3.on) return Promise.resolve(null);
        const qs = [];
        const L3 = layers3d(orderLayers(performance.now(), S.cam)), v = view3d(), lk = look();
        for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            T3.render(L3, v, lk, undefined, { de: [0.25, 1.25], still: still ? { n: i, N: 8, mix2: 0 } : null });
            gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
        V3.accKey = null;
        return new Promise((res) => { const poll = () => { if (!qs.every(q => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) { setTimeout(poll, 20); return; }
            const ms = qs.map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); qs.forEach(q => gl.deleteQuery(q)); res({ min: +Math.min(...ms).toFixed(2), max: +Math.max(...ms).toFixed(2), scale: T3.scale }); }; poll(); });
    },
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
                 iter: S.iterManual ? S.iterValue : undefined, palette: PAL.list[S.palette].id, setCol: setColParam() || undefined, alpine: S.alpine ? S.valley : undefined };
    },
    isMoving: () => isMoving(performance.now()),
    // Test (6.5.2): Grafik-Wächter – '' | 'wait' | 'lost' | 'stuck', erstes Bild gezeichnet?
    gpuGuard: () => ({ kind: GW.kind, firstPic: GW.firstPic, simple: !!SIMPLE, lost: !!R.lost }),
    // Test/Messung: aktuelles Bild frisch auf den Canvas (2D: Display-Pass; 3D: gemitteltes Bild bzw. neu zeichnen)
    snapshot() { if (V3.on) present3d(performance.now(), false, true); else presentNow(); },
    // Test: 3D-Mittelung sofort abschließen (alle Bilder in einem Rutsch)
    // o = { N, scale }: Messreferenz (z. B. 48 Bilder in doppelter Auflösung) statt der Standard-Mittelung
    settle3d(o) {
        if (!V3.on) return 0;
        if (o || V3.testStill) { V3.testStill = o || null; V3.accKey = null; }
        let k = 0;
        while (k < 200) { V3.keyT = -1e9; present3d(performance.now(), false, true); k++; if (!V3.accKey || !V3.accPending) break; }
        return { frames: k, accN: V3.accN, N: V3.testStill ? V3.testStill.N : aaFrames() };
    },
    still3dInfo: () => ({ key: !!V3.accKey, n: V3.accN, N: aaFrames(), pending: V3.accPending, ms: V3.accMs }),
    prof: () => PROF,
    // Pop-Metrik: frameStats(true) startet die Aufzeichnung, frameStats() liefert { frames, hard }
    frameStats(start) {
        if (start) { FS.on = true; FS.frames = []; FS.hard = 0; FS.seen = new WeakSet(); return true; }
        return { frames: FS.frames.slice(), hard: FS.hard, hardInfo: FS.hardInfo || [] };
    },
    layerInfo() {
        const now = performance.now(), list = orderLayers(now, S.cam);
        const cov = coverage(list, S.cam, { gx: 24, gy: 48 });
        return { n: list.length, kMean: cov.kMean, coarse: cov.coarse, unc: cov.unc, gov: GOV.g, pool: R.poolInfo(),
                 layers: list.map(l => ({ stage: l.stage, k: +layerK(l, S.cam).toFixed(3), alpha: +l.alpha.toFixed(2), score: +(l.score || 0).toFixed(3), exact: !!l.exact, prefetch: !!l.prefetch, w: l.buf.w, h: l.buf.h, front: l === RC.front, de: l.de, sig: l.sig, maxIter: l.maxIter, key: l.key.slice(-40) })) };
    },
    buddhaInfo: () => ({ max: BUD.max, version: BUD.version, w: BUD.w, h: BUD.h, busy: cpuWorkers.map(w => w.busy) }),
    // --- Test-Hooks
    // GPU-Zeiten per Timer-Query (headless-rAF-FPS sind unbrauchbar): Display-Pass und Vorschau-Jobs
    benchGPU(divs) {
        const gl = R.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext) return Promise.resolve(null);
        const p = plan();
        const timeIt = (fn) => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); return q; };
        const qs = [];
        for (let i = 0; i < 5; i++) qs.push(['present', timeIt(() => presentNow())]);
        for (const d of divs) {
            const w = Math.ceil(canvas.width * 1.2 / d), h = Math.ceil(canvas.height * 1.2 / d);
            const job = { key: 'bench', stage: d, kind: 'gpu', mode: p.mode, formula: S.formula, maxIter: currentMaxIter(), view: { cx: S.cam.cx, cy: S.cam.cy, zoom: S.cam.zoom },
                          w, h, scale: 3 / (S.cam.zoom * canvas.height) * d, julia: [HP.toNumber(S.julia.x), HP.toNumber(S.julia.y)], err: d === 1 && S.precise, de: deActive() };
            if (d === 1) { job.w = canvas.width; job.h = canvas.height; }
            R.beginJob(job);
            qs.push(['div' + d + '_' + job.w + 'x' + job.h, timeIt(() => { R.maxInflight = 1e9; while (job.row < job.h) R.pump(job, 0); })]);
            R.cancelJob(job);
        }
        return new Promise((res) => {
            const poll = () => {
                if (!qs.every(([, q]) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) { setTimeout(poll, 20); return; }
                const out = {};
                for (const [k, q] of qs) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; out[k] = out[k] ? Math.min(out[k], ms) : ms; gl.deleteQuery(q); }
                for (const k in out) out[k] = +out[k].toFixed(2);
                res(out);
            };
            poll();
        });
    },
    // Test: Rechenzeit eines Puffers synchron (GPU-Warteschlange vorher leeren, danach auf das Ergebnis warten) – robuster als
    // Timer-Queries, die unter ANGLE/Metal vorher eingereihte Hintergrundarbeit mitzählen. de: Distanzschätzung an/aus
    benchCompute(divs, reps = 3, de) {
        const gl = R.gl, p = plan(), out = {};
        if (p.kind !== 'gpu') return null;
        for (const d of divs) for (let r = 0; r < reps; r++) {
            const w = d === 1 ? canvas.width : Math.ceil(canvas.width * 1.2 / d), h = d === 1 ? canvas.height : Math.ceil(canvas.height * 1.2 / d);
            const job = { key: 'bench', stage: d, kind: 'gpu', mode: p.mode, formula: S.formula, maxIter: currentMaxIter(), view: { cx: S.cam.cx, cy: S.cam.cy, zoom: S.cam.zoom },
                          w, h, scale: 3 / (S.cam.zoom * canvas.height) * d, julia: [HP.toNumber(S.julia.x), HP.toNumber(S.julia.y)], err: d === 1 && S.precise, de: de === undefined ? deActive() : !!de };
            const sync = (b) => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, b ? b.fbo : null); gl.readPixels(0, 0, 1, 1, b ? gl.RGBA_INTEGER : gl.RGBA, b ? gl.UNSIGNED_INT : gl.UNSIGNED_BYTE, b ? new Uint32Array(4) : new Uint8Array(4)); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); };
            sync(null);                                   // gl.finish blockiert in Chrome nicht – readPixels schon
            const t0 = performance.now();
            R.beginJob(job); const mi = R.maxInflight; R.maxInflight = 1e9;
            while (job.row < job.h) R.pump(job, 0);
            sync(job.buf);
            const t = performance.now() - t0;
            R.maxInflight = mi; R.cancelJob(job);
            const k = 'div' + d + '_' + w + 'x' + h;
            out[k] = Math.min(out[k] || 1e9, +t.toFixed(2));
        }
        return out;
    },
    status() {
        const f = RC.front;
        return { key: viewKey(), frontKey: f ? f.key : null, stage: f ? f.stage : null, busy: !!RC.job, moving: isMoving(performance.now()),
                 fading: RC.fading, done: !!f && f.key === viewKey() && f.stage === 1 && !!f.fixed && !RC.job && !RC.fix && !isFading(performance.now()), fix: stats.lastFix || null, fixing: !!RC.fix, gpuFullMs: stats.gpuFullMs,
                 plan: plan(), ref: REF.cur ? { id: REF.cur.id, method: REF.cur.method, period: REF.cur.period, len: REF.cur.lenA, ms: REF.cur.ms } : null,
                 jsMs: stats.jsMs, jsMax: stats.jsMax, vsync: RC.vsync, dtEMA: RC.dtEMA, chunk: R.chunkInfo(), lastFullMs: stats.lastFullMs, lastJobMs: stats.lastJobMs, fps: stats.fps, useBLA: f ? f.useBLA : null, kind: f ? f.kind : null, previewDiv: RC.previewDiv,
                 canvas: [canvas.width, canvas.height], maxIter: currentMaxIter(), gpuPerturbOK };
    },
    setView(cx, cy, zoom) { stopAnims(); setCam(HP.fromString(cx), HP.fromString(cy), zoom); },
    // Test (P1-1): neue Referenz für die aktuelle Ansicht erzwingen (z. B. mitten in der exakten Nachrechnung)
    testNewRef() { requestRefFor(S.cam, null, true, ++REF.seq); },
    // Test: Iterationswerte des fertigen Bildes an Pixeln [i, jVonOben] + exakte Ansicht
    readFrontAt(px) {
        const f = RC.front; if (!f) return null;
        const all = R.readIterSync(f.buf), w = f.buf.w, h = f.buf.h;
        const d = HP.digitsForZoom(f.view.zoom) + 30;
        return { w, h, stage: f.stage, kind: f.kind, mode: f.mode, maxIter: f.maxIter, zoom: f.view.zoom, cx: HP.toString(f.view.cx, d), cy: HP.toString(f.view.cy, d),
                 values: px.map(([i, j]) => all[(h - 1 - j) * w + i]) };
    },
    readFront() { const f = RC.front; if (!f) return null; return { w: f.buf.w, h: f.buf.h, data: Array.from(R.readIterSync(f.buf)), scale: f.scale, cx: HP.toString(f.view.cx, 60), cy: HP.toString(f.view.cy, 60), zoom: f.view.zoom }; },
    // Test: DE-Codes des fertigen Bildes (Uint8, Zeile 0 = unten) als Array
    readFrontDE() { const f = RC.front; if (!f) return null; const d = R.readDESync(f.buf); return d ? { w: f.buf.w, h: f.buf.h, data: Array.from(d) } : null; },
};
self.__fraktal = API;
init();
})();
