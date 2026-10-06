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
const GOV = { g: 1, on: true, kmin: +(Q.get('govk') || 0.4), min: +(Q.get('govmin') || 0.4) };
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
let tour = null;
function startTour(p) {
    stopAnims();
    setMode(p.formula || 0, true);
    if (p.jx) setJulia(HP.fromString(p.jx), HP.fromString(p.jy));
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
        REF.blaPending = false;            // P2-2: der Worker kennt jetzt nur noch diese Referenz
        // vorausberechneter Orbit: nur übernehmen, wenn die Ansicht noch dieselbe ist und nichts läuft
        if (req && req.pfKey && (RC.lastKey !== req.pfKey || RC.job || RC.fix)) { if (REF.queued) { const q = REF.queued; REF.queued = null; sendRef(q); } return; }
        m.sig = req ? req.sig : '';
        m.refXb = BigInt(m.refX); m.refYb = BigInt(m.refY);
        m.viewCx = BigInt(m.cx); m.viewCy = BigInt(m.cy);
        // laufenden Perturbations-Job abbrechen: Texturen werden gleich ersetzt
        if (RC.job && RC.job.mode === 'perturb') cancelJob();
        if (RC.pjob && RC.pjob.mode === 'perturb') cancelPrefetch();
        R.setReference(m);
        REF.cur = m;
        // P1-1: laufende exakte Nachrechnung mit der alten Referenz abbrechen (ihre Pakete kämen als missingRef zurück
        // und würden endlos neu geschickt); das Bild wird mit der neuen Referenz neu gerechnet
        if (RC.fix && RC.fix.fr.mode === 'perturb' && RC.fix.fr.refId !== m.id) { const fr = RC.fix.fr; cancelFix(); recompute(fr); }
        if (m.orbit64) cpuSendRef(m);
        if (REF.queued) { const q = REF.queued; REF.queued = null; sendRef(q); }
        stats.lastRef = { ms: m.ms, method: m.method, period: m.period, len: m.lenA };
    } else if (m.type === 'bla') {
        REF.blaPending = false;
        if (!REF.cur || REF.cur.id !== m.refId) return;
        // P2-2: der Worker kennt die Referenz nicht mehr (dazwischen kam eine verworfene Vorausrechen-Referenz) ->
        // die vorhandene Tabelle behalten und nicht mehr auf eine neue warten
        if (m.ignored) { REF.cur.blaFixed = true; return; }
        if (RC.job && RC.job.mode === 'perturb' && RC.job.kind === 'gpu') cancelJob();
        if (RC.pjob && RC.pjob.mode === 'perturb' && RC.pjob.kind === 'gpu') cancelPrefetch();
        R.setBLA(m.bla32);
        REF.cur.blaCmax = m.blaCmax;
        if (m.bla64) { REF.cur.bla64 = m.bla64; cpuBroadcast({ type: 'bla', refId: m.refId, bla: m.bla64 }); }
    }
};
function viewHalf() { const s = worldPerCss(S.cam.zoom); return [s * cssW / 2, s * cssH / 2]; }
// Bei Flügen/Touren den Referenzorbit gleich fürs ZIEL rechnen: das Ziel liegt während der
// ganzen Fahrt im Bild, eine Referenz reicht dann für alle Zwischenbilder.
function refTarget() {
    if (FLY.on && FLY.mode === 'place' && FLY.target) return FLY.target;
    if (flight) return flight.anchor ? flightCamAt(flight, 1) : flight.b;
    return S.cam;
}
function requestRef(want64) { return requestRefFor(refTarget(), null, want64); }
// 6.4 Bunte Menge: Innenpunkte laufen nach maxIter weiter (Zyklussuche, bis zu max(4096, min(maxIter, 16384)) Schritte) –
// dafür wird der Orbit des gewählten Referenzpunkts verlängert (ein Rebase am Orbit-Ende mitten im Zyklus kostet im Deep
// Zoom die Genauigkeit). Wahl des Referenzpunkts und BLA bleiben gleich -> Außenwerte bitgleich wie ohne Bunt.
function refExtra(it) { return innActive() ? Math.min(16384, Math.max(4096, it)) : 0; }
// tg: Kamera, für die der Orbit gerechnet wird; pfKey: Vorausrechnen für diese Ansicht (verfällt bei Wechsel)
// nonce (nur Test-Hook testNewRef): erzwingt eine neue Signatur, also eine neue Referenz für dieselbe Ansicht
function requestRefFor(tg, pfKey, want64 = true, nonce) {
    const s = 3 / (tg.zoom * cssH);
    const q = {
        type: 'ref', id: 0, formula: S.formula,
        cx: tg.cx.toString(), cy: tg.cy.toString(),
        jx: S.julia.x.toString(), jy: S.julia.y.toString(),
        zoom: tg.zoom, maxIter: S.iterManual ? S.iterValue : autoIter(tg.zoom * 16),
        halfW: s * cssW / 2 * 1.3, halfH: s * cssH / 2 * 1.3, pixel: s / dpr,
        cmax: 0, want64
    };
    q.extra = refExtra(q.maxIter);
    const sig = [q.formula, q.cx, q.cy, q.zoom, q.jx, q.jy, q.maxIter, want64, q.extra].join('|') + (nonce ? '|n' + nonce : '');
    q.pfKey = pfKey || null;
    if (REF.pending && pfKey) return;
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
        if (innActive() && !(r.extra > 0) && !(r.period > 0) && r.lenA - 1 >= mi) return false;   // 6.4: Bunt braucht den verlängerten Orbit
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
        if (r.bla32 && S.formula !== 1 && !REF.blaPending && !r.blaFixed && (r.blaCmax < need || (!moving && r.blaCmax > 8 * need))) {
            REF.blaPending = true;
            orbitWorker.postMessage({ type: 'bla', refId: r.id, cmax: need * 2, want64: !!r.orbit64 });
        }
        if (!moving && r.bla32 && S.formula !== 1 && r.blaCmax > 8 * need && !r.blaFixed) return false;   // kurz warten: schnellere Tabelle
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
        // P2-1: Worker-Skript fehlt/defekt (z. B. offline nach einem Update) -> laufende Arbeit abbrechen statt ewig zu warten
        w.onerror = (e) => { console.warn('CPU-Worker:', e.message || e); e.preventDefault && e.preventDefault(); w.busy = 0; cancelJob(); cancelFix(); toast(t('worker_failed'), 4500); };
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
    const job = RC.job && RC.job.id === m.jobId ? RC.job : (RC.pjob && RC.pjob.id === m.jobId ? RC.pjob : null);
    if (!job || job.kind !== 'cpu' || job.done) { cpuFeed(); return; }
    if (m.missingRef) { if (REF.cur && REF.cur.orbit64) sendRefTo(w, REF.cur); job.tiles.push({ x: m.x, y: m.y, w: m.w, h: m.h }); cpuFeed(); return; }
    R.uploadTile(job, m.x, m.y, m.w, m.h, m.data, m.de);
    job.tilesDone++;
    if (job.tilesDone >= job.tilesTotal) { job.done = true; job.gpuMs = performance.now() - job.gpuStart; }
    cpuFeed();
}
function cpuFeed() {
    fixFeed();
    let job = RC.job;
    // Vorausrechnen nur, wenn der sichtbare Job und die Nachrechnung keine Worker brauchen
    if ((!job || job.kind !== 'cpu' || job.done || !job.tiles.length) && !RC.fix && RC.pjob && RC.pjob.kind === 'cpu' && !RC.pjob.done) job = RC.pjob;
    if (!job || job.kind !== 'cpu' || job.done) return;
    // (P2-8: „in Bewegung nur eine Kachel je Worker“ wurde gemessen und verworfen – die erste Kachel einer neuen Ansicht kam
    // damit später, Median 635 statt 225 ms; begrenzt wird stattdessen die Arbeit je Kachel, siehe startJob)
    for (const w of cpuWorkers) {
        while (w.busy < 2 && job.tiles.length) {
            const tl = job.tiles.shift();
            w.busy++;
            w.postMessage(Object.assign({ type: 'tile', jobId: job.id, refId: job.refId, bufW: job.w, bufH: job.h, scale: job.scale,
                mode: job.mode, formula: job.formula, maxIter: job.maxIter, useBLA: job.useBLA, de: job.de, inn: job.inn,
                offX: job.cpuOff[0], offY: job.cpuOff[1], jx: job.julia[0], jy: job.julia[1] }, tl));
        }
    }
}

// ------------------------------------------------------------------ Render-Orchestrierung
// 5.1 „nahtloser Bildaufbau": Jedes fertige Bild (Vorschau, Verfeinerung, exakt, vorausberechnet)
// bleibt als EBENE erhalten, solange es irgendwo das schärfste gültige Bild liefert. Der Display-Pass
// trägt die Ebenen nach Schärfe sortiert auf (schärfste oben, gefederte Ränder, zeitbasiertes
// Einblenden): eine gröbere neue Vorschau füllt nur Lücken und überdeckt nie ein schärferes,
// reprojiziert noch gültiges Bild. Schärfe = Pufferpixel pro Bildschirmpixel nach Reprojektion.
// A/B-Regler per URL (Standardwerte in Klammern; der 5.0.1-Modus ?blend=0 ist seit 6.5.4 entfernt):
//   ?maxdiv=N     gröbste Vorschau 1/N (6 GPU, 8 CPU)   ?over=X     Vorschau-Überhang (1.5)
//   ?fadems=N     Einblendzeit ms (220, in Bewegung 150)   ?feather=N  Randfederung CSS px (12)
//   ?recon=0      Vorschau auf Farben statt Iterationswert interpolieren
//   ?predict=0    Vorschau für die aktuelle statt die vorausgesagte Kamera  ?prefetch=0  kein Vorausrechnen
//   ?gov=0        Tempo-Bremse aus
const MAXDIV = { gpu: +(Q.get('maxdiv') || 6), cpu: +(Q.get('maxdiv') || 8) };
const OVER = +(Q.get('over') || 1.5);                      // Stillstand/Lückenfüller; in Bewegung OVER_MOVE
const OVER_MOVE = +(Q.get('overmove') || 1.2);             // mit Vorhersage reicht wenig Überhang (A/B: 1.5 kostet eine Auflösungsstufe)
const STRIPS = Q.get('strips') !== '0';                    // Vorschau nur für den Bereich, der noch nicht scharf genug ist
const FADE_MS = Q.has('fadems') ? +Q.get('fadems') : 220;
const FADE_MOVE_MS = Q.has('fadems') ? +Q.get('fadems') : 150;
const FEATHER = Q.has('feather') ? +Q.get('feather') : 12;
const RECON = Q.get('recon') !== '0';
const PREDICT = Q.get('predict') !== '0';
const PREFETCH = Q.get('prefetch') !== '0';
const MAXL = self.FKShaders.NL;            // Ebenen im Display-Pass (6)
const SIDE3D = 1600;                       // P2-3: größte Kantenlänge des quadratischen 3D-Rechenpuffers (px)
const RC = { front: null, job: null, pjob: null, fading: false, previewDiv: { gpu: 3, cpu: 4 }, lastMoveT: 0, jobSeq: 0,
             layers: [], layerSeq: 0, list: [], estPreviewMs: 60, lastPreview: null, pxRate: 0,
             foreign: false, dirty: true, lastKeyFull: null, timeToFull: null, keyT0: 0, lastKey: '' };
const stats = { fps: 0, frames: 0, fpsT: 0, lastRef: null, lastFullMs: null };
// GPU-Speicher: Iterationspuffer (4 B/Pixel). Pixel 7 (824×1830): Vollbild 6 MB; Stapel max. 6 Ebenen
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
// Inhalt eines Bildes: was es zeigt (unabhängig von Ansicht/Auflösung). Ebenen mit anderem Inhalt
// (andere Welt, anderes Julia-c, manuelle Iterationen) liegen ganz unten und werden ausgeblendet.
function contentSig() { return S.formula + '|' + (S.formula === 1 ? S.julia.x + ',' + S.julia.y : '') + '|' + (S.iterManual ? S.iterValue : 'a') + (deActive() ? '|de' : '') + (innActive() ? '|in' : ''); }
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

function makeFrame(job, now) {
    job.buf && (job.kept = true);
    return { buf: job.buf, view: job.view, scale: job.scale, key: job.key, stage: job.stage, formula: job.formula, maxIter: job.maxIter, ms: now - job.t0,
             kind: job.kind, mode: job.mode, useBLA: job.useBLA, refId: job.refId, julia: job.julia, fixed: !job.err, gpuMs: job.gpuMs,
             sig: job.sig, prefetch: job.prefetch, preview: job.preview || job.stage > 1, exact: false, de: !!job.de, inn: !!job.inn };
}

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

// ---------------- Ebenen-Stapel
function addLayer(fr, now, moving) {
    fr.seq = ++RC.layerSeq;
    fr.t0 = now;
    fr.fadeMs = moving ? FADE_MOVE_MS : FADE_MS;
    RC.layers.push(fr);
    pruneLayers(now);
}
const smooth01 = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
function layerFade(l, now) { return l.fadeMs > 0 ? smooth01((now - l.t0) / l.fadeMs) : 1; }
function layerK(l, cam) { return 3 / (cam.zoom * canvas.height) / l.scale; }
// Reihenfolge: Schärfe (gekappt bei 1) + exakt-für-genau-diese-Ansicht + Aktualität (Gleichstand: neuer
// oben). Vorausberechnete Ebenen haben keinen Aktualitätsbonus. Fremder Inhalt: ganz unten.
function orderLayers(now, cam) {
    const sig = contentSig(), key = viewKey(cam);
    const L = RC.layers;
    const vis = L.filter(l => !l.prefetch && l.sig === sig).sort((a, b) => b.seq - a.seq);
    for (const l of L) {
        let s = Math.min(1, layerK(l, cam));
        if (l.exact && l.key === key) s += 0.05;
        const r = vis.indexOf(l);
        if (r >= 0) s += 0.002 * Math.max(0, 4 - r);         // nur Gleichstand entscheiden (neuer oben)
        if (l.sig !== sig) s -= 10 - 0.01 * Math.min(50, l.seq % 1e6) / 50;
        l.score = s;
        l.alpha = layerFade(l, now) * (l.outT ? 1 - smooth01((now - l.outT) / FADE_MOVE_MS) : 1);
    }
    return L.slice().sort((a, b) => b.score - a.score || b.seq - a.seq);
}
// Welt-Rechteck einer Ebene relativ zur Kamera (Zielpixel)
function layerRect(l, cam) {
    const sCam = 3 / (cam.zoom * canvas.height);
    const cx = HP.toNumber(l.view.cx - cam.cx) / sCam + canvas.width / 2, cy = HP.toNumber(l.view.cy - cam.cy) / sCam + canvas.height / 2;
    const hw = l.buf.w / 2 * l.scale / sCam, hh = l.buf.h / 2 * l.scale / sCam;
    return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
}
// Abdeckungsstatistik (Raster gx×gy über die um 'expand' vergrößerte Ansicht): mittlere effektive
// Schärfe, Anteil grob (< 0.5) / unbedeckt, minimale Schärfe. list = sortierte Ebenen mit alpha.
function coverage(list, cam, opts) {
    opts = opts || {};
    const gx = opts.gx || 12, gy = opts.gy || 24, ex = opts.expand || 1, sig = opts.sig;
    const W = canvas.width, H = canvas.height;
    const L = [];
    for (const l of list) {
        if (sig && l.sig !== sig) continue;
        if (opts.opaque ? false : l.alpha <= 0) continue;
        L.push({ r: layerRect(l, cam), k: Math.min(1, layerK(l, cam)), a: opts.opaque ? 1 : l.alpha, l, n: 0 });
    }
    let sum = 0, coarse = 0, unc = 0, minK = 1, low = 0;
    const kLow = opts.kLow || 0.5, ks = opts.quantile ? [] : null;
    const bb = opts.bboxK ? { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, n: 0 } : null;
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const x = W / 2 + ((i + 0.5) / gx - 0.5) * W * ex, y = H / 2 + ((j + 0.5) / gy - 0.5) * H * ex;
        let T = 1, ke = 0, any = false;
        for (const e of L) {
            if (x < e.r.x0 || x > e.r.x1 || y < e.r.y0 || y > e.r.y1) continue;
            if (T * e.a > 0.01) e.n += (x >= 0 && x <= W && y >= 0 && y <= H) ? 10 : 1;   // Beitrag (im Bild ×10)
            any = true;
            ke += T * e.a * e.k; T *= 1 - e.a;
            if (T < 0.004) break;
        }
        if (!any) unc++;
        sum += ke; if (ke < 0.5) coarse++; if (ke < kLow) low++; if (ks) ks.push(ke);
        if (bb && ke < opts.bboxK) { bb.n++; bb.x0 = Math.min(bb.x0, x); bb.x1 = Math.max(bb.x1, x); bb.y0 = Math.min(bb.y0, y); bb.y1 = Math.max(bb.y1, y); }
        if (ke < minK) minK = ke;
    }
    const N = gx * gy;
    let q = null;
    if (ks) { ks.sort((a, b) => a - b); q = ks[Math.floor(ks.length * opts.quantile)]; }
    return { kMean: sum / N, coarse: coarse / N, kLow: low / N, unc: unc / N, minK, q, use: L, bb, cell: [W * ex / gx, H * ex / gy] };
}
// Ebenen aufräumen: Eine Ebene bleibt, solange sie irgendwo in der 1,4-fach vergrößerten Ansicht
// (Reserve für Schwenk/Herauszoomen) sichtbar beiträgt; verdeckte (eine schärfere deckt sie ganz) und
// fremder Inhalt unter gültigem Bild fallen weg. Bei mehr als MAXL Ebenen geht die am wenigsten genutzte.
// Geschützt: aktuelles Bild (front), Quelle der laufenden Nachrechnung, Ebenen im Einblenden und
// alles, was unter einer gerade einblendenden Ebene liegt (sonst blendete sie aus dem Nichts ein).
function pruneLayers(now) {
    const cam = S.cam;
    const list = orderLayers(now, cam);
    const fadingIn = list.some(l => l.alpha < 1);
    const keep = (l) => l === RC.front || (RC.fix && RC.fix.fr === l) || l.alpha < 1 || fadingIn;
    // größte gültige Ebene = Reserve gegen schwarze Ränder (Herauszoomen/großer Schwenk): bleibt,
    // solange sie die Ansicht überhaupt berührt
    const sig = contentSig();
    let reserve = null;
    for (const l of list) if (l.sig === sig && (!reserve || l.buf.w * l.buf.h * l.scale * l.scale > reserve.buf.w * reserve.buf.h * reserve.scale * reserve.scale)) reserve = l;
    const ex = V3.on ? 5 : 1.4;                 // 3D: der Horizont braucht ferne Ebenen
    const cov = coverage(list, cam, { gx: 16, gy: 32, expand: ex });
    const drop = new Set();
    for (const e of cov.use) if (e.n === 0 && !keep(e.l) && e.l !== reserve) drop.add(e.l);
    for (const l of list) if (l.alpha <= 0 && !keep(l)) drop.add(l);
    if (reserve && layerK(reserve, cam) < 1 / 8192) drop.add(reserve);
    let rest = list.filter(l => !drop.has(l) && !l.outT);
    const cap = V3.on ? MAXL3 : MAXL;          // P2-3: 3D zeichnet höchstens T3.N3 Ebenen – mehr hielte nur Speicher
    while (rest.length > cap - 1) {
        const c = coverage(rest, cam, { gx: 16, gy: 32, expand: ex });
        let worst = null;
        for (const e of c.use) {
            if (e.l === RC.front || (RC.fix && RC.fix.fr === e.l) || e.l.seq === RC.layerSeq || e.l === reserve) continue;
            if (!worst || e.n < worst.n || (e.n === worst.n && e.l.seq < worst.l.seq)) worst = e;
        }
        const victim = worst ? worst.l : rest.filter(l => l !== RC.front).sort((a, b) => a.seq - b.seq)[0];
        drop.add(victim);
        rest = rest.filter(l => l !== victim);
    }
    // Ausblenden statt Wegnehmen (eine verdrängte Ebene kann noch sichtbar sein); fertig ausgeblendete
    // und solche, die nirgends beitragen, gehen sofort. Höchstens SH.NL Ebenen insgesamt.
    for (const l of list) if (l.outT && now - l.outT >= FADE_MOVE_MS) drop.add(l);
    const gone = new Set();
    for (const l of drop) {
        const e = cov.use.find(u => u.l === l);
        if (l.outT ? now - l.outT >= FADE_MOVE_MS : (!e || e.n === 0 || l.alpha <= 0)) gone.add(l);
        else if (!l.outT) l.outT = now;
    }
    let live = RC.layers.filter(l => !gone.has(l));
    while (live.length > cap) {            // Ausblendende verdrängen, wenn die Plätze nicht reichen
        const o = live.filter(l => l.outT).sort((a, b) => a.outT - b.outT)[0];
        if (!o) break;
        gone.add(o); live = live.filter(l => l !== o);
    }
    if (!gone.size) return;
    for (const l of gone) R.releaseFrame(l);
    RC.layers = live;
    if (RC.lastPreview && gone.has(RC.lastPreview)) RC.lastPreview = null;
}

// ------------------------------------------------------------------ Exakte Nachrechnung (GPU-f32 -> CPU-f64)
// Der finale GPU-Pass markiert Pixel, deren f32-Fehlerschätzung > 0.7 Iterationen ist. Diese
// (typisch 0–40 %) rechnet der CPU-Pool in f64 nach; Ergebnis wird in eine Pufferkopie gestreut
// und weich eingeblendet. Danach ist das Bild fertig und ändert sich nicht mehr.
function startFix(fr, now) {
    const fix = { fr, key: fr.key, t0: now, chunks: [], sent: 0, done: 0, total: 0, id: ++RC.jobSeq, buf: null };
    RC.fix = fix;
    let unsure;
    try { unsure = R.findUnsure(fr.buf); }
    catch (e) { if (!e.shaderKey) throw e; RC.fix = null; fr.fixed = fr.exact = true; fullDone(fr, now); return; }   // P1-2: ohne Nachrechnung bleibt das f32-Bild
    unsure.then((list) => {
        if (RC.fix !== fix) return;
        if (!list) { RC.fix = null; return; }
        fix.count = list.length / 2;
        stats.lastFix = { count: fix.count, pct: +(100 * fix.count / (fr.buf.w * fr.buf.h)).toFixed(1) };
        if (!fix.count) { fr.fixed = true; fr.exact = true; RC.fix = null; RC.dirty = true; fullDone(fr, performance.now()); return; }
        if (fr.mode === 'perturb') {
            const r = REF.cur;
            if (!r || r.id !== fr.refId || !r.orbit64) { RC.fix = null; recompute(fr); return; }   // Referenz gewechselt -> neu rechnen
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
// finales Bild, dessen Nachrechnung nicht mehr möglich ist (Referenz gewechselt): als Vorschau behandeln -> schedule
// rechnet die finale Stufe neu (nur stage = 2 genügte nicht: schedule startete wieder die Nachrechnung, endlos)
function recompute(fr) { fr.stage = 2; fr.preview = true; RC.dirty = true; }
function fixMsg(fix, chunk, list) {
    const fr = fix.fr;
    return { type: 'pixels', jobId: fix.id, chunk, list, refId: fr.refId, bufW: fr.buf.w, bufH: fr.buf.h, scale: fr.scale,
             mode: fr.mode, formula: fr.formula, maxIter: fr.maxIter, useBLA: fix.useBLA, offX: fix.off[0], offY: fix.off[1], jx: fr.julia[0], jy: fr.julia[1], inn: fr.inn };
}
function fixFeed() {
    const fix = RC.fix;
    if (!fix || !fix.total) return;
    for (const w of cpuWorkers) {
        while (w.busy < 2 && fix.sent < fix.total) {
            w.busy++;
            w.postMessage(fixMsg(fix, fix.sent, fix.chunks[fix.sent]));
            fix.sent++;
        }
    }
}
function onFixPixels(m, w) {
    const fix = RC.fix;
    if (!fix || m.jobId !== fix.id) { cpuFeed(); return; }
    if (m.missingRef) {
        // Referenz der Nachrechnung gibt es nicht mehr: abbrechen und neu rechnen statt dasselbe Paket endlos zu schicken
        if (!REF.cur || REF.cur.id !== fix.fr.refId) { const fr = fix.fr; cancelFix(); recompute(fr); cpuFeed(); return; }
        if (REF.cur.orbit64) sendRefTo(w, REF.cur);
        w.busy++; w.postMessage(fixMsg(fix, m.chunk, m.list)); return;
    }
    try { R.scatter(fix.buf, m.list, m.values); }
    catch (e) { console.warn('Nachrechnung:', e.message); const fr = fix.fr; cancelFix(); fr.fixed = fr.exact = true; RC.dirty = true; fullDone(fr, performance.now()); cpuFeed(); return; }
    fix.done++;
    if (fix.done >= fix.total) {
        const now = performance.now();
        const fr = Object.assign({}, fix.fr, { buf: fix.buf, fixed: true, exact: true, h3d: null, shown: false, outT: 0 });   // eigener Puffer -> eigene 3D-Höhentextur
        stats.lastFix.ms = now - fix.t0;
        RC.fix = null;
        addLayer(fr, now, false);
        RC.front = fr;
        RC.dirty = true;
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

function pumpCtl(moving, prefetch) {
    const vs = RC.vsync || 16.7;
    // 6.2: in 3D sind „Leerlauf"-Frames nie leer (3D-Bild, eingereihte GPU-Arbeit) – ihre Dauer darf das Budget nicht
    // aufblähen (sonst rechnete der Flug bis zu 8 Bildtakte pro Frame und ruckelte); dort keine Reserve über den Bildtakt (A/B: ?flycap=N Takte, ?flycap=0 = 6.1)
    const cap = V3.on && Q.get('flycap') !== '0' ? (Q.has('flycap') ? +Q.get('flycap') : 1.0) * vs : 8 * vs;
    // 6.4 Flug: Rechenanteil garantieren – eine Vorschau soll in ~0,6 s fertig werden, auch wenn schon das 3D-Bild allein
    // länger als ein Bildtakt braucht (langsames Gerät, großer Bildschirm, hohe Bildwiederholrate). Sonst schrumpfte der
    // Häppchen-Regler die Rechnung auf 1024 Pixel pro Bild, keine Vorschau wurde mehr fertig, der Flug sah nur noch
    // Leere und suchte den Rand (A/B: ?flyhold=0)
    const minS = FLY_HOLD && V3.on && FLY.on && !FLY.paused ? 0.6 : 0;
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
    if (!PREFETCH || S.quality === 'eco' || document.hidden) return;
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
    R.maxInflight = Q.get('inflight') ? +Q.get('inflight') : (moving ? 1 : 2);
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
        const tg = PREDICT ? animTarget() : null;
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
            const view = PREDICT ? predictCam(Math.min(0.3, (RC.estPreviewMs + FADE_MOVE_MS / 2) / 1000)) : S.cam;
            // 3D: jede dritte Vorschau eine ferne Detailstufe (Horizont), jede neunte eine noch weitere
            RC.farTick = (RC.farTick || 0) + 1;
            if (V3.on && RC.farTick % 3 === 0) {
                const far = RC.farTick % 9 === 0 ? 64 : 8, sC = 3 / (view.zoom * canvas.height), sz = Math.max(canvas.width, canvas.height) / (far === 8 ? 2 : 4);
                startJob(viewKey(view) + '|far' + far, far, p, view, { preview: true, w: Math.ceil(sz), h: Math.ceil(sz), scale: sC * far }).part = true;
                if (RC.job && RC.job.kind === 'gpu') { const done = R.pump(RC.job, now, pumpCtl(moving)); if (done) { const j = RC.job; RC.job = null; jobFinished(j, now); } }
                return;
            }
            const pl = STRIPS ? planPreview(now, view, p, sig) : { div: RC.previewDiv[p.kind] };
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
// 0,4 Pufferpixel pro Bildschirmpixel (?govk=), sinkt das Tempo weich (bis 0,4×, ?govmin=), sonst
// steigt es wieder auf 1 (Totzone ±10 %, kein Pendeln). Warum 0,4 statt 0,5: Halb-Auflösungs-Vorschauen erreichen mit Vorhersage
// 0,43–0,5 – eine 0,5-Schwelle bremste auch dann, wenn die Rechnung gut mithält.
// Pinch/Schieben unter dem Finger bleibt 1:1. Schalter: Mehr → „Tempo an Rechenleistung anpassen".
function governorUpdate(now, dt) {
    const on = S.governor && Q.get('gov') !== '0';
    if (!on || !animating()) { GOV.g = Math.min(1, GOV.g + dt * 3); GOV.coarse = 0; return; }
    const c = predictCam(0.1, false);
    const cov = coverage(orderLayers(now, c), c, { sig: contentSig(), gx: 10, gy: 20, quantile: 0.1 });
    // 10-%-Quantil der Schärfe (90 % des Bildes sind mindestens so scharf), Totzone ±10 % um die Schwelle
    GOV.q = cov.q;
    const e = (GOV.kmin - cov.q) / GOV.kmin;
    // 6.4: im Flug darf die Bremse bis 30 % gehen (sonst 40 %) – lieber etwas langsamer tauchen als ins Leere (A/B: ?flyhold=0)
    const gmin = FLY_HOLD && FLY.on && !FLY.paused && !Q.has('govmin') ? 0.3 : GOV.min;
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
    return { list, opts: { feather: FEATHER * dpr, recon: RECON, de: deActive() ? [0.25, 1.25] : null } };
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
    RC.list = a.list;
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
const V3 = { on: false, mix: 0, dir: 0, tilt: 42 * Math.PI / 180, heading: 0, L: [4, 9], Lt: null, probeT: 0, probe: null, settleT: 0,
             accKey: null, accN: 0, accPending: false, keyT: 0, animTick: 0, moved: false, accMs: null };
const FLY = { on: false, paused: false, mode: 'random', target: null, hdgT: 0, steerBase: 0, t0: 0, z0: 1, off0: 0, dir: [0, 1], scoreT: 0 };
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
    RC.list = a.list;
    if (FS.on) frameStatsRecord(now, a.list);
    // Sonde: Höhenstatistik + Interesse für den Zufallsflug (alle 300 ms, asynchron)
    // (im Zufallsflug alle 150 ms: die Zielwahl am Mengenrand braucht frische Daten)
    if (now - V3.probeT > (FLY.on && !FLY.paused && FLY.edge ? 150 : 300)) {
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

// ---- Flug: Zoom + Vorwärtsflug. Gezoomt wird um einen Punkt vor dem Fokus -> die Kamera gleitet vorwärts und
// taucht tiefer; Berge wirken in jeder Tiefe gleich hoch (lokale Einheiten).
// Ziel-Flug: Start im Gesamtbild (wie ▶ Tour), gerade auf den Ort zu, Ankunft exakt am Ort.
// Zufallsflug 6.2 („sanft, am Mengenrand"): Der Zoompunkt FLY.A (lokal, Welt-Achsen) ist der Fixpunkt des Zooms –
// bliebe er stehen, flöge die Kamera genau auf diesen Weltpunkt zu. Er gleitet weich (begrenzte Geschwindigkeit)
// zu einem Ziel FLY.T im Korridor knapp außerhalb der Menge (Distanz zur Menge ≈ 0,05–0,3 Bildhälften, aus der
// Distanzschätzung der Sonde). Weil die Distanz eines festen Punkts in lokalen Einheiten mit dem Zoom wächst, wird
// das Ziel alle 300 ms nachgeführt (lokale Suche ±0,2) und nur mit Hysterese (+25 %, ≥ 1,5 s gehalten) gegen ein
// besseres getauscht. Der Kurs folgt der Richtung des Zoompunkts als gedämpftes System (Drehrate ≤ FLY_TURN,
// begrenzte Drehbeschleunigung, leichte Schräglage in Kurven).
// A/B: ?flyedge=0 = Wertung und Lenkung 6.1.0, ?flyturn=R = maximale Drehrate (rad/s).
const FLY_AHEAD = 0.55;
const FLY_EDGE = Q.get('flyedge') !== '0';
const FLY_HOLD = FLY_EDGE && Q.get('flyhold') !== '0';    // 6.4: Flug bleibt am Rand (Rechenanteil, Bremse, Datenlücken, Vorausschau)
const FLY_TURN = Q.has('flyturn') ? Math.max(0.02, +Q.get('flyturn') || 0.3) : 0.3;
const FLY_ACC = 0.5;          // max. Drehbeschleunigung (rad/s²)
const FLY_DE = 0.04;          // Zoompunkt höchstens so weit von der Menge (Bildhälften)
const FLY_RMIN = 0.25, FLY_RMAX = 0.7, FLY_RPREF = 0.45;   // Zoompunkt vor dem Fokus (Bildhälften)
function startFly(place) {
    if (!can3d(place && place.formula !== undefined ? place.formula : S.formula)) return;
    // 6.3: Shader noch nicht fertig -> erst vorbereiten (2D bleibt bedienbar), dann diesen Flug starten
    if (!V3.on && T3 && !ready3d()) { V3.prepFly = place || true; if (!V3.prep) { V3.prep = performance.now(); emit('3d'); } return; }
    stopAnims();
    if (place) {
        setMode(place.formula || 0, true);
        if (place.jx) setJulia(HP.fromString(place.jx), HP.fromString(place.jy));
        const home = MODE_HOME[S.formula];
        setCam(HP.fromString(home[0]), HP.fromString(home[1]), home[2]);
        S.iterManual = false;
        const T = { cx: HP.fromString(place.cx), cy: HP.fromString(place.cy), zoom: +place.zoom };
        const u = 1.5 / S.cam.zoom;
        const ox = HP.toNumber(T.cx - S.cam.cx) / u, oy = HP.toNumber(T.cy - S.cam.cy) / u;
        const d = Math.hypot(ox, oy);
        FLY.mode = 'place'; FLY.target = T; FLY.z0 = S.cam.zoom; FLY.off0 = d;
        FLY.dir = d > 1e-9 ? [ox / d, oy / d] : [0, 1];
        V3.heading = Math.atan2(FLY.dir[0], FLY.dir[1]);
    } else { FLY.mode = 'random'; FLY.target = null; }
    set3d(true);
    FLY.on = true; FLY.paused = false; FLY.hdgT = V3.heading; FLY.user = 0; FLY.userBase = 0; FLY.lost = 0; FLY.t0 = performance.now();
    // 6.2: Zoompunkt startet geradeaus, Kurs ruhend
    const f = [Math.sin(V3.heading), Math.cos(V3.heading)];
    FLY.A = [f[0] * FLY_AHEAD, f[1] * FLY_AHEAD]; FLY.VA = [0, 0]; FLY.T = null; FLY.Tt = 0; FLY.om = 0; FLY.roll = 0;
    FLY.userPrev = 0; FLY.userT = -1e9; FLY.zf = 1; FLY.glide = null; FLY.edge = FLY_EDGE; FLY.dA = null; FLY.gap = false;
    emit('fly');
}
// Ausrichten: Drehung weich auf Norden, Neigung auf den Standard
function north3d() { V3.northT = performance.now(); V3.northFrom = [V3.heading, V3.tilt]; stopFly(); }
function stopFly() { if (!FLY.on) return; FLY.on = false; FLY.paused = false; camDirty = true; emit('fly'); }
function pauseFly(p) { if (!FLY.on) return; FLY.paused = p === undefined ? !FLY.paused : p; emit('fly'); }
// ein Flugschritt (rein rechnerisch, auch für die Vorhersage): liefert { cam, heading }
function flyStep(cam, heading, dt) {
    const g = GOV.g, dec = S.flySpeed * dt * g;
    if (FLY.mode === 'place' && FLY.target) {
        const T = FLY.target;
        const z1 = Math.min(T.zoom, cam.zoom * Math.pow(10, dec));
        const p = Math.min(1, Math.log(z1 / FLY.z0) / Math.max(1e-9, Math.log(T.zoom / FLY.z0)));
        const off = FLY.off0 * Math.pow(1 - p, 1.5), u = 1.5 / z1;
        return { cam: { cx: T.cx - HP.fromNumber(FLY.dir[0] * off * u), cy: T.cy - HP.fromNumber(FLY.dir[1] * off * u), zoom: z1 }, heading, done: z1 >= T.zoom };
    }
    // über einer leeren Ebene "verloren": kaum noch tiefer, dafür seitlich zum nächsten Rand gleiten
    const lost = Math.min(1, FLY.lost || 0);
    const u = 1.5 / cam.zoom, f = [Math.sin(heading), Math.cos(heading)];
    if (FLY.edge && FLY.A) {
        const z1 = clampZoom(cam.zoom * Math.pow(10, dec * (1 - 0.95 * lost) * (FLY.zf || 1)));
        // 6.4: verloren -> erst zum Randstück drehen, dann vorwärts dorthin gleiten (statt seitlich zu rutschen)
        const al = FLY_HOLD && FLY.glide ? Math.max(0, f[0] * FLY.glide[0] + f[1] * FLY.glide[1]) : 1;
        const k = 1 - cam.zoom / z1, gd = FLY_HOLD ? f : (FLY.glide || f), gl = lost * 0.8 * (FLY.glide ? FLY.gv : 1) * al * dt * g, lat = gl * u;
        return { cam: { cx: cam.cx + HP.fromNumber(FLY.A[0] * u * k + gd[0] * lat), cy: cam.cy + HP.fromNumber(FLY.A[1] * u * k + gd[1] * lat), zoom: z1 }, heading, done: z1 >= 1e28, lat: [gd[0] * gl, gd[1] * gl] };
    }
    const z1 = clampZoom(cam.zoom * Math.pow(10, dec * (1 - 0.85 * lost)));
    const ax = f[0] * FLY_AHEAD * u, ay = f[1] * FLY_AHEAD * u;          // Zoompunkt vor dem Fokus
    const k = 1 - cam.zoom / z1, lat = lost * 0.7 * dt * g * u;
    return { cam: { cx: cam.cx + HP.fromNumber(ax * k + f[0] * lat), cy: cam.cy + HP.fromNumber(ay * k + f[1] * lat), zoom: z1 }, heading, done: z1 >= 1e28 };
}
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
const rot2 = (v, a) => [v[0] * Math.cos(a) + v[1] * Math.sin(a), -v[0] * Math.sin(a) + v[1] * Math.cos(a)];   // Kurs +a (im Uhrzeigersinn)
function flyUpdate(now, dt) {
    if (FLY.mode === 'random' && !FLY.edge) {
        // 6.1.0: Kurs dreht mit bis zu 0,9 rad/s auf den Zielkurs, Wischen addiert einen abklingenden Versatz
        if (now - FLY.scoreT > 300 && V3.probe) { FLY.scoreT = now; if (FLY.rec && T3.lastCam) FLY.recM.push(flyMetrics(V3.probe, now)); flySteer(); }
        const d = angDiff(FLY.hdgT + (FLY.user || 0), V3.heading);
        const h0 = V3.heading;
        V3.heading += Math.max(-0.9 * dt, Math.min(0.9 * dt, d));
        FLY.om = dt > 0 ? angDiff(V3.heading, h0) / dt : 0;
        FLY.user = (FLY.user || 0) * Math.exp(-dt / 2.5); FLY.userBase = (FLY.userBase || 0) * Math.exp(-dt / 2.5);
    } else if (FLY.mode === 'random') {
        if (V3.probe && V3.probe.seq !== FLY.probeSeq) { FLY.probeSeq = V3.probe.seq; flyEdgeSteer(now); }
        // Wischen: Zoompunkt und Ziel um den Fokus drehen (der Kurs folgt gedämpft), danach führt die Automatik
        // von der neuen Richtung aus weiter
        const du = (FLY.user || 0) - (FLY.userPrev || 0);
        if (du) { FLY.A = rot2(FLY.A, du); if (FLY.T) FLY.T = rot2(FLY.T, du); FLY.userPrev = FLY.user; FLY.userT = now; FLY.Tt = now; }
        const g = GOV.g, sp = S.flySpeed * g;
        // Zoompunkt gleitet zum Ziel: Geschwindigkeit begrenzt, Änderung der Geschwindigkeit weich
        if (FLY.T) {
            const dx = FLY.T[0] - FLY.A[0], dy = FLY.T[1] - FLY.A[1], d = Math.hypot(dx, dy);
            const vmax = 0.12 + 0.5 * sp, v = Math.min(vmax, d * 1.6);
            const vx = d > 1e-9 ? dx / d * v : 0, vy = d > 1e-9 ? dy / d * v : 0;
            const kv = Math.min(1, dt * 3);
            FLY.VA = [FLY.VA[0] + (vx - FLY.VA[0]) * kv, FLY.VA[1] + (vy - FLY.VA[1]) * kv];
            FLY.A = [FLY.A[0] + FLY.VA[0] * dt, FLY.A[1] + FLY.VA[1] * dt];
            // Zoomtempo weich drosseln, solange der Zoompunkt noch weit vom Ziel ist (erst hingleiten, dann tauchen)
            let zfT = 1 - 0.55 * smooth01((d - 0.12) / 0.45);
            if (FLY_HOLD) {
                // 6.4 Vorausschau: Die Distanz des Zoompunkts zum Rand wächst beim Tauchen mit dem Zoom – schon bremsen, wenn
                // sie in ~0,4 s aus dem Band (≈ 0,08 Bildhälften) liefe; die Lenkung holt den Zoompunkt derweil zurück an
                // den Rand. Datenlücke: langsam weiter, bis das Bild voraus gerechnet ist.
                if (FLY.gap) zfT *= 0.3;
                if (FLY.dA !== null && FLY.dA !== undefined) zfT *= 1 - 0.85 * smooth01((FLY.dA * Math.pow(10, sp * 0.4) - 0.08) / 0.3);
            }
            // bremsen schnell, beschleunigen weich
            FLY.zf += (zfT - FLY.zf) * Math.min(1, dt * (FLY_HOLD && zfT < FLY.zf ? 5 : 1.5));
        }
        // Zoompunkt im Vorwärtsbereich halten (0,25–0,7 Bildhälften)
        const ra = Math.hypot(FLY.A[0], FLY.A[1]);
        if (ra < FLY_RMIN || ra > FLY_RMAX) { const c = Math.max(FLY_RMIN, Math.min(FLY_RMAX, ra)) / Math.max(1e-9, ra); FLY.A = [FLY.A[0] * c, FLY.A[1] * c]; }
        // Kurs: gedämpfte Drehung zur Richtung des Zoompunkts (kritisch gedämpft, Rate und Beschleunigung begrenzt)
        const err = angDiff(Math.atan2(FLY.A[0], FLY.A[1]), V3.heading);
        const lost = Math.min(1, FLY.lost || 0);
        const wmax = FLY_TURN * (1 + 0.5 * lost);
        const K = 1.4, acc = Math.max(-FLY_ACC * (1 + lost), Math.min(FLY_ACC * (1 + lost), K * err - 2 * Math.sqrt(K) * FLY.om));
        FLY.om = Math.max(-wmax, Math.min(wmax, FLY.om + acc * dt));
        V3.heading += FLY.om * dt;
        // leichte Schräglage in Kurven (max. ~6°), weich
        FLY.roll += (-0.35 * FLY.om - FLY.roll) * Math.min(1, dt * 2);
    }
    const z0 = S.cam.zoom;
    const st = flyStep(S.cam, V3.heading, dt);
    setCam(st.cam.cx, st.cam.cy, st.cam.zoom);
    if (FLY.mode === 'random' && FLY.edge && FLY.T) {
        // Ziel ist ein Weltpunkt: der Zoom (Fixpunkt A) schiebt es in lokalen Einheiten nach außen, Gleiten verschiebt es
        const q = S.cam.zoom / z0;
        FLY.T = [FLY.A[0] + (FLY.T[0] - FLY.A[0]) * q, FLY.A[1] + (FLY.T[1] - FLY.A[1]) * q];
        if (st.lat) FLY.T = [FLY.T[0] - st.lat[0], FLY.T[1] - st.lat[1]];
    }
    if (FLY.rec) FLY.rec.push([+now.toFixed(1), +V3.heading.toFixed(5), S.cam.zoom, +(FLY.om || 0).toFixed(5), +(FLY.lost || 0).toFixed(2)]);
    if (st.done) { stopFly(); if (FLY.mode === 'random') toast(t('fly_max')); }
}
// Kurswahl aus der Sonde (alle 300 ms): Kandidaten bis ±150° um den aktuellen Kurs, Wertung entlang des
// Strahls (0,3–1,3 Bildhälften, nahe stärker): Randnähe + Detail positiv, leere Ebene negativ, Inneres
// (Schwarz) stark negativ, Abweichung vom Kurs leicht negativ. Ist alles voraus flach: "verloren". (6.1.0, ?flyedge=0)
function flySteer() {
    const pb = V3.probe;
    if (!pb) return;
    const at = (x, y) => {
        const i = Math.floor((x / pb.win * 0.5 + 0.5) * pb.w), j = Math.floor((y / pb.win * 0.5 + 0.5) * pb.h);
        if (i < 1 || j < 1 || i >= pb.w - 1 || j >= pb.h - 1) return null;
        return [pb.data[j * pb.w + i], pb.data[j * pb.w + i + 1], pb.data[(j + 1) * pb.w + i], pb.data[j * pb.w + i - 1], pb.data[(j - 1) * pb.w + i]];
    };
    const L0 = V3.L[0], inv = 1 / Math.max(0.3, V3.L[1] - V3.L[0]);
    const hn = (v) => v < 0 ? -1 : (Math.log2(1 + (S.formula === 5 ? v % 1000 : v)) - L0) * inv;
    let best = null;
    const h0 = V3.heading;
    for (const da of [0, -0.3, 0.3, -0.65, 0.65, -1.0, 1.0, -1.5, 1.5, -2.1, 2.1, -2.6, 2.6]) {
        const h = h0 + da;
        let sc = -Math.abs(da) * 0.35, n = 0, flat = 0;
        for (const [r, w] of [[0.3, 1.4], [0.55, 1.6], [0.85, 1.0], [1.25, 0.6]]) {
            const s5 = at(Math.sin(h) * r, Math.cos(h) * r);
            if (!s5 || s5.some(Number.isNaN)) continue;
            n++;
            const a0 = hn(s5[0]);
            if (a0 < 0) { sc -= 3 * w; continue; }
            let det = 0;
            for (let q = 1; q < 5; q++) det += Math.abs(a0 - Math.max(-0.2, hn(s5[q])));
            det = Math.min(1, det * 1.5);
            if (det < 0.08 && a0 < 0.35) flat++;
            sc += w * (det + 0.6 * a0 - 0.45);
        }
        if (!n) continue;
        if (!best || sc > best.sc) best = { sc, h, flat: flat >= n - 1 };
    }
    if (!best) return;
    FLY.hdgT = best.h;
    const here = best.flat && Math.abs(angDiff(best.h, h0)) < 0.7;
    FLY.lost = Math.max(0, Math.min(1.5, (FLY.lost || 0) + (here ? 0.25 : -0.4)));
}
// 6.2: Zielwahl am Mengenrand aus der Distanzschätzung der Sonde (bei jeder neuen Sonde, ~150 ms).
// Die Sonde wurde für eine etwas ältere Kamera aufgenommen (Auslesen asynchron) – im Flug ist der Zoom seitdem um
// bis zu ×1,5 gewachsen. Alle Positionen werden darum zwischen Sonden- und aktueller Kamera umgerechnet (probeMap).
// Wertung einer Stelle: voll bis FLY_DE, darüber abfallend (halbe Höhe bei ×3), leere Ebene (Abstand > 0,25)
// zunehmend negativ, innen stark negativ, viel Menge in der Umgebung (Minibrot-Inneres, große Mengenfläche)
// negativ, Detail und Randdichte in der Umgebung positiv.
function probeMap(pb) {
    const c = pb.cam || S.cam, u = 1.5 / S.cam.zoom, up = 1.5 / c.zoom, k = u / up;
    const ox = HP.toNumber(S.cam.cx - c.cx) / up, oy = HP.toNumber(S.cam.cy - c.cy) / up;
    return { k, toP: (x, y) => [ox + x * k, oy + y * k], fromP: (x, y) => [(x - ox) / k, (y - oy) / k] };
}
function flyEdgeSteer(now) {
    const pb = V3.probe;
    if (!pb) return;
    if (FLY.rec && T3.lastCam) FLY.recM.push(flyMetrics(pb, now));
    if (!pb.hasDE) { flySteer(); const f = [Math.sin(FLY.hdgT), Math.cos(FLY.hdgT)]; FLY.T = [f[0] * FLY_AHEAD, f[1] * FLY_AHEAD]; FLY.glide = null; return; }
    const W = pb.w, H = pb.h, M = probeMap(pb);
    const cellIdx = (px, py) => { const i = Math.floor((px / pb.win * 0.5 + 0.5) * W), j = Math.floor((py / pb.win * 0.5 + 0.5) * H); return i < 3 || j < 3 || i >= W - 3 || j >= H - 3 ? -1 : j * W + i; };
    const idx = (x, y) => { const q = M.toP(x, y); return cellIdx(q[0], q[1]); };
    const deC = (k) => pb.de[k] / M.k;          // Distanz in aktuellen lokalen Einheiten
    const L0 = V3.L[0], inv = 1 / Math.max(0.3, V3.L[1] - V3.L[0]);
    const hn = (v) => v < 0 ? 0 : (Math.log2(1 + (S.formula === 5 ? v % 1000 : v)) - L0) * inv;
    const LN = Math.log2(3);
    const score = (k) => {
        const d0 = pb.de[k];
        if (Number.isNaN(d0)) return null;
        if (d0 === 0) return -3;
        const d = d0 / M.k;
        // bis FLY_DE voll (dicht am Rand bleibt ein Punkt über viele Zoomstufen randnah), darüber abfallend
        // (halbe Höhe bei ×3), ab 0,25 (leer) zunehmend negativ; je dichter am Rand, desto etwas besser
        const x = Math.max(0, Math.log2(d / FLY_DE) / LN);
        let s = Math.exp(-0.69 * x * x) - 0.45 * Math.max(0, Math.log2(d / 0.25)) + 0.15 * Math.min(1, Math.max(0, -Math.log2(d / FLY_DE) / 4));
        // Umgebung (7×7 Zellen): viel Menge (Minibrot-Inneres, große Fläche) negativ, Detail und Randdichte positiv
        const i0 = k % W, j0 = (k - i0) / W;
        let nin = 0, nv = 0, det = 0, nedge = 0;
        const h0 = hn(pb.data[k]);
        for (let j = j0 - 3; j <= j0 + 3; j += 1) for (let i = i0 - 3; i <= i0 + 3; i += 1) {
            const q = j * W + i, e = pb.de[q];
            if (Number.isNaN(e)) continue;
            nv++; if (e === 0) nin++; else { det += Math.abs(hn(pb.data[q]) - h0); if (e / M.k < 0.3) nedge++; }
        }
        if (nv) { s -= 2.5 * Math.max(0, nin / nv - 0.45); s += 0.3 * Math.min(1, det / nv * 4) + 0.4 * nedge / nv; }
        return s;
    };
    const h0 = V3.heading;
    const userHold = now - FLY.userT < 3000;
    const A = FLY.A;
    const lim = userHold ? 0.6 : Math.PI / 2;     // Vorwärtsbereich ±90° (Wischen: ±35° für 3 s); Anflug sucht ringsum (bestAll)
    let bestF = null, bestAll = null, hiIt = null, nFwd = 0, nFwdOk = 0;
    for (let j = 3; j < H - 3; j += 2) for (let i = 3; i < W - 3; i += 2) {
        const k = j * W + i, d0 = pb.de[k];
        const [x, y] = M.fromP(((i + 0.5) / W * 2 - 1) * pb.win, ((j + 0.5) / H * 2 - 1) * pb.win), r = Math.hypot(x, y);
        if (r >= FLY_RMIN && r <= 1 && Math.abs(angDiff(Math.atan2(x, y), h0)) < Math.PI / 2) { nFwd++; if (!Number.isNaN(d0)) nFwdOk++; }
        if (Number.isNaN(d0)) continue;
        if (r < FLY_RMIN) continue;
        if (d0 > 0 && r > 0.5 && (!hiIt || pb.data[k] > hiIt.v)) hiIt = { v: pb.data[k], x, y };   // höchste Iteration = Richtung zur Menge
        const sc = score(k);
        if (sc === null) continue;
        const db = Math.abs(angDiff(Math.atan2(x, y), h0));
        if (!bestAll || sc > bestAll.sc) bestAll = { sc, x, y };
        if (r > FLY_RMAX || db > lim) continue;
        const tot = sc - 0.3 * Math.hypot(x - A[0], y - A[1]) - 0.18 * db - 0.4 * Math.max(0, r - FLY_RPREF);
        if (!bestF || tot > bestF.tot) bestF = { tot, sc, x, y };
    }
    // Ziel lokal nachführen: Hügelsteigen um den Zoompunkt A (Umkreis bis 0,2) – der Rand „wandert" beim Tauchen
    // nach außen (die Distanz eines festen Punkts wächst mit dem Zoom), das Ziel bleibt so dicht am Zoompunkt
    const pen = (x, y, rr) => 0.6 * rr + 0.4 * Math.max(0, Math.hypot(x, y) - FLY_RPREF);
    let cur = null;
    const kA = idx(A[0], A[1]), sA = kA >= 0 ? score(kA) : null;
    // 6.4: Distanz des Zoompunkts zum Rand (aktuelle lokale Einheiten; innen zählt wie „zu weit“) – für die Vorausschau
    FLY.dA = kA >= 0 && !Number.isNaN(pb.de[kA]) ? (pb.de[kA] === 0 ? 0.3 : deC(kA)) : null;
    const approach = FLY.lost > 0.3 && FLY.T && Math.hypot(FLY.T[0] - A[0], FLY.T[1] - A[1]) > 0.3;   // Anflug läuft: Ziel halten
    if (sA !== null) {
        cur = { sc: sA, x: A[0], y: A[1] };
        for (let a = 0; a < 12; a++) for (const rr of [0.05, 0.1, 0.16, 0.24]) {
            const x = A[0] + Math.sin(a * Math.PI / 6) * rr, y = A[1] + Math.cos(a * Math.PI / 6) * rr;
            const r = Math.hypot(x, y);
            if (r < FLY_RMIN || r > FLY_RMAX || Math.abs(angDiff(Math.atan2(x, y), h0)) > lim) continue;
            const kk = idx(x, y); if (kk < 0) continue;
            const s2 = score(kk);
            if (s2 !== null && s2 - pen(x, y, rr) > cur.sc) cur = { sc: s2 - pen(x, y, rr), x, y };
        }
        // bisheriges Ziel behalten, solange es kaum schlechter ist (kein Hin und Her)
        if (FLY.T) { const kt = idx(FLY.T[0], FLY.T[1]), st = kt >= 0 ? score(kt) : null; if (st !== null && st - pen(FLY.T[0], FLY.T[1], 0) > cur.sc - 0.08 && Math.hypot(FLY.T[0] - A[0], FLY.T[1] - A[1]) < 0.3) cur = { sc: st - pen(FLY.T[0], FLY.T[1], 0), x: FLY.T[0], y: FLY.T[1] }; }
        if (!approach) FLY.T = [cur.x, cur.y];
    }
    const curTot = cur ? cur.sc - 0.18 * Math.abs(angDiff(Math.atan2(cur.x, cur.y), h0)) : -1e9;
    const held = now - FLY.Tt;
    // weiter entferntes Ziel nur mit Hysterese: deutlich besser (+25 %) und das bisherige ≥ 1,5 s gehalten
    if (bestF && (!cur || (held > 1500 && bestF.tot > curTot + Math.max(0.25 * Math.abs(curTot), 0.15)) || (cur.sc < 0 && held > 600 && bestF.tot > curTot + 0.1))) {
        FLY.T = [bestF.x, bestF.y]; FLY.Tt = now;
    }
    // Anflug („verloren"): voraus keine gute Stelle -> die beste Stelle im ganzen Sondenfenster anfliegen: kaum
    // tiefer, seitlich hingleiten (langsamer, je näher), der Kurs dreht dorthin. Gar nichts im Fenster: geradeaus.
    const okAhead = (cur && cur.sc > 0.25) || (bestF && bestF.sc > 0.35);
    // 6.4: Datenlücke (das Bild voraus ist noch nicht gerechnet) ist kein „verloren“: Kurs halten, langsam weiter tauchen,
    // bis wieder Daten da sind – statt zu kreisen und seitlich zu gleiten (A/B: ?flyhold=0)
    // (Ziel nahe dem Zoompunkt wurde oben schon mit den vorhandenen Daten nachgeführt)
    FLY.gap = FLY_HOLD && nFwd > 0 && nFwdOk < 0.3 * nFwd;
    if (FLY.gap) { FLY.lost = Math.max(0, (FLY.lost || 0) - 0.15); FLY.glide = null; FLY.gv = 1; return; }
    // (nichts Brauchbares im Fenster: Richtung der höchsten Iteration – sie steigt zur Menge hin)
    const far = bestAll && bestAll.sc > 0.35 ? bestAll : hiIt;
    if (!okAhead && far && (!FLY.T || held > 600)) { FLY.T = [far.x, far.y]; FLY.Tt = now; }
    FLY.lost = Math.max(0, Math.min(1.5, (FLY.lost || 0) + (okAhead ? -0.3 : 0.25)));
    if (FLY.lost > 0.3 && FLY.T && far) {
        const r = Math.max(1e-9, Math.hypot(FLY.T[0], FLY.T[1]));
        FLY.glide = [FLY.T[0] / r, FLY.T[1] / r]; FLY.gv = Math.min(1, Math.max(0.15, (r - 0.3) / 0.6));
    } else { FLY.glide = null; FLY.gv = 1; }
}
// Messung (tests/measure_fly.py): pro Sonde Anteil Bild mit Mengenrand im mittleren Drittel (Distanz < 0,3
// Bildhälften), Anteil innen bzw. leer (Distanz > 1) am sichtbaren Boden im Sondenfenster
function flyMetrics(pb, now) {
    const c = T3.lastCam, M = probeMap(pb);
    const at = (P) => { const q = M.toP(P[0], P[1]); const i = Math.floor((q[0] / pb.win * 0.5 + 0.5) * pb.w), j = Math.floor((q[1] / pb.win * 0.5 + 0.5) * pb.h); return i < 0 || j < 0 || i >= pb.w || j >= pb.h ? NaN : pb.de[j * pb.w + i] / M.k; };
    const look = (x, y) => {
        const g = T3.groundAt(c, x, y);
        if (!g) return -2;
        const d = at(g);
        return Number.isNaN(d) ? -2 : d;
    };
    let edgeMid = 0, nMid = 0, nAll = 0, nIn = 0, nEmpty = 0, nEdge = 0;
    for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) {
        const d = look((a / 8 - 0.5) * 2 / 3, (b / 8 - 0.5) * 2 / 3);
        if (d < -1) continue;
        nMid++; if (d > 0 && d < 0.3) edgeMid++;
    }
    for (let a = 0; a < 15; a++) for (let b = 0; b < 15; b++) {
        const d = look(a / 7 - 1, b / 7 - 1);
        if (d < -1) continue;
        nAll++; if (d === 0) nIn++; else if (d > 1) nEmpty++; else if (d < 0.3) nEdge++;
    }
    const deAt = (P) => { if (!P) return null; const d = at(P); return Number.isNaN(d) ? null : +d.toPrecision(3); };
    return { dA: deAt(FLY.A), dT: deAt(FLY.T), dF: deAt([0, 0]), A: FLY.A ? FLY.A.map(x => +x.toFixed(3)) : null, T: FLY.T ? FLY.T.map(x => +x.toFixed(3)) : null, t: +now.toFixed(0), z: S.cam.zoom, edgeMid: nMid ? edgeMid / nMid : null, inFrac: nAll ? nIn / nAll : null, emptyFrac: nAll ? nEmpty / nAll : null, edgeFrac: nAll ? nEdge / nAll : null, n: nAll, lost: +(FLY.lost || 0).toFixed(2), hasDE: !!pb.hasDE };
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
    const sc = setColParam(); if (sc) p.set('sc', sc);
    if (S.alpine) p.set('al', S.valley[0]);
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
    // der Link beschreibt das Bild vollständig: ohne sc = Schwarz, ohne al = kein Alpin-Look
    applySetColParam(p.get('sc') || '');
    S.alpine = p.has('al');
    if (S.alpine) S.valley = { f: 'forest', l: 'lake', m: 'meadow' }[p.get('al')] || 'forest';
    if (p.has('it')) { S.iterManual = true; S.iterValue = Math.max(50, parseInt(p.get('it'), 10) || 300); }
    setCam(HP.fromString(p.get('x')), HP.fromString(p.get('y') || '0'), parseFloat(p.get('z')) || 1);
    return true;
}
// 6.2 Farbe der Menge im Link: sc=w (Weiß), d/l (dunkelste/hellste Palettenfarbe), sonst Hex ohne # (eigene);
// fehlt = Schwarz. al=f|l|m: Alpin-Look mit Wald/See/Wiese im Tal
// 6.4: sc=b1 (Bunt, Inseln) / sc=b2 (Bunt, Ringe)
function setColParam() { return S.setCol === 'white' ? 'w' : S.setCol === 'dark' ? 'd' : S.setCol === 'light' ? 'l' : S.setCol === 'custom' ? S.setHex.slice(1) : S.setCol === 'bunt' ? 'b' + (S.inMode === 2 ? 2 : 1) : ''; }
function applySetColParam(v) {
    if (v === 'w') S.setCol = 'white'; else if (v === 'd') S.setCol = 'dark'; else if (v === 'l') S.setCol = 'light';
    else if (/^b[12]$/.test(v)) { S.setCol = 'bunt'; S.inMode = +v[1]; }
    else if (/^[0-9a-fA-F]{6}$/.test(v)) { S.setCol = 'custom'; S.setHex = '#' + v.toLowerCase(); }
    else S.setCol = 'black';
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
    if (Q.get('inflight')) R.maxInflight = +Q.get('inflight');
    resize();
    cpuPool();      // P2-1: Worker gleich beim Start laden (im Leerlauf kostenlos) – ein späteres Update kann sie nicht mehr entziehen
    requestAnimationFrame(frame);
}

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
