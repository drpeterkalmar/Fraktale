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

const APP_VERSION = '7.1.1';
const HP = self.FKHP, PAL = self.FKPalettes;
const Q = new URLSearchParams(location.search);
const V = '?v=' + APP_VERSION;                 // Cache-Busting für Worker (automatisch mit APP_VERSION)

const DIRECT_MAX = 1000;        // bis hier direkte f32-Iteration auf der GPU (Pixel >> f32-Eps)
const GPU_MAX = 1e30;           // f32-Perturbation (Deltas bis ~1e-35 darstellbar)
const DEEP_MAX = 1e290;         // CPU-f64-Perturbation
const NEWTON_GPU_MAX = 3000;
const EXO_GPU_MAX = 2000;       // 7.1 Exoten (direkt in f32)
const MAX_ZOOM = [DEEP_MAX, DEEP_MAX, DEEP_MAX, DEEP_MAX, DEEP_MAX, 1e13, 1e7, 1e6, 1e7, 1e7, 1e12, 1e13, 1e13, 1e13];   // Mandelbulb: Grenze setzt js/bulb.js (Pixel an der Oberfläche)
const MODE_KEYS = ['mandelbrot', 'julia', 'burning_ship', 'tricorn', 'mandel_z3', 'newton', 'mandelbulb', 'buddhabrot', 'mandelbox', 'menger', 'lyapunov', 'phoenix', 'nova', 'magnet'];
// 7.1: Welten-Gruppen im Modus-Wähler
const MODE_GROUPS = [['grp_classic', [0, 1, 2, 3, 4, 5]], ['grp_exotic', [10, 11, 12, 13]], ['grp_3d', [6, 8, 9]], ['grp_light', [7]]];
// 7.0: Strahlen-Welten (3D-Fraktale per Raymarching, js/bulb.js): Mandelbulb, Mandelbox, Menger-Schwamm
const RAY = [6, 8, 9];
const isRay = (f) => RAY.includes(f === undefined ? S.formula : f);
// 7.1: Rechen-Formel aus Welt + Parametern (Burning-Ship-Familie 20–22, Multibrot frei 23, Phoenix 24, Nova 25, Magnet 26/27,
// Lyapunov 28 – siehe js/shaders.js exoticFS, js/fractal-core.js exoticPixel). Multibrot mit Exponent 3 bzw. 2 = z³ bzw.
// Mandelbrot mit Deep Zoom (Perturbation + BLA); gebrochene Exponenten und Morph nur direkt (f32, dann CPU f64)
function cformula(f) {
    f = f === undefined ? S.formula : f;
    const w = S.wp[f] || {};
    switch (f) {
        case 2: return [2, 20, 21, 22][w.v | 0] || 2;
        case 4: { const e = +w.e || 3; return w.m ? 23 : e === 3 ? 4 : e === 2 ? 0 : 23; }
        case 10: return 28;
        case 11: return 24;
        case 12: return 25;
        case 13: return w.v ? 27 : 26;
    }
    return f;
}
const isExo = (cf) => cf >= 23;                                    // nur direkt gerechnet
const hasSetW = (f) => f < 5 || (f >= 10 && f <= 13);              // 2D-Welten mit „Menge“ (Außen, Menge glatt)
const is2dW = (f) => !RAY.includes(f) && f !== 7;                  // 2D-Welten mit Iterationspuffer
const MODE_HOME = [['-0.5', '0', 1], ['0', '0', 1], ['-0.5', '-0.5', 1], ['-0.3', '0', 1], ['0', '0', 1], ['0', '0', 1], ['0', '0', 1], ['-0.5', '0', 1], ['0', '0', 1], ['0', '0', 1],
                   ['3', '3', 1.5], ['0', '0', 0.45, [4.6, 2.4]], ['-0.3', '0', 0.8], ['1.2', '0', 0.55]];
// 7.1: Startzoom passend zum Seitenverhältnis, wenn die Welt eine Ausdehnung [Breite, Höhe] angibt (Phoenix: breit)
function homeZoom(f) { const h = MODE_HOME[f]; if (!h[3]) return h[2]; return 3 / Math.max(h[3][1], h[3][0] * cssH / Math.max(1, cssW)); }
// 7.1 Welt-Parameter (Exoten, Burning-Ship-Familie, Multibrot, Newton-Polynom): Standard je Welt; die aktuellen Werte stehen in S.wp,
// gehören zum Bildinhalt (contentSig), zum Link (wp=) und zu „Ansicht merken“
const WP_DEF = {
    2: { v: 0 },                                       // Burning Ship: 0 Schiff, 1 Celtic, 2 senkrecht, 3 Büffel
    4: { e: 3, m: 0 },                                 // Multibrot: Exponent 2–8 (3 = z³ mit Deep Zoom), Morph an/aus
    5: { p: 0 },                                       // Newton: Polynom (fractal-core.js NEWTON_POLYS)
    10: { s: 'AB' },                                   // Lyapunov: Folge aus A/B
    11: { v: 0, cr: 0.5667, ci: 0, pr: -0.5, pi: 0 },  // Phoenix: 0 Julia-Art, 1 Mandel-Art; c, p
    12: { v: 0, r: 1, cr: -0.2, ci: 0.4 },             // Nova: 0 Mandel-Art (c = Pixel), 1 Julia-Art; Relaxation R; c
    13: { v: 0 },                                      // Magnet: 0 Typ I, 1 Typ II
};
// 7.1 Sehenswürdigkeiten je Welt (kuratiert per tools/scout.js + Sichtprüfung, Bilder tests/shots/v71): Name = t('sight_' + k),
// Vorschaubild assets/sights/<k>.jpg; wp = Welt-Parameter, pal = Palette, mit der der Ort gedacht ist (nur beim Anfliegen aus der Liste)
const SIGHTS = {
    10: [{ k: 'lya_zircon', cx: '3.7', cy: '2.95', zoom: 3.2, wp: { s: 'BBBBBBAAAAAA' } },
         { k: 'lya_aabab', cx: '3.3', cy: '3.3', zoom: 2.5, wp: { s: 'AABAB' } },
         { k: 'lya_abbab', cx: '3.3', cy: '3.4', zoom: 2, wp: { s: 'ABBAB' } },
         { k: 'lya_bbabaa', cx: '3.3', cy: '3.3', zoom: 2, wp: { s: 'BBABAA' } },
         { k: 'lya_ab', cx: '3.1', cy: '3.6', zoom: 3, wp: { s: 'AB' } }],
    11: [{ k: 'phx_federn', cx: '0.78125', cy: '0.520833', zoom: 7.2 },
         { k: 'phx_fluegel', cx: '0.885417', cy: '0.3125', zoom: 7.2 },
         { k: 'phx_locken', cx: '0.690104', cy: '0.546875', zoom: 28.8 },
         { k: 'phx_spirale', cx: '0.950521', cy: '0.494792', zoom: 28.8 }],
    12: [{ k: 'nova_insel', cx: '-0.2372396', cy: '0.3255208', zoom: 57.6 },
         { k: 'nova_kette', cx: '-0.3023438', cy: '0.2473958', zoom: 57.6 },
         { k: 'nova_tief', cx: '-0.3690755', cy: '0.0488281', zoom: 230.4 },
         { k: 'nova_julia', cx: '0', cy: '0', zoom: 1, wp: { v: 1 } }],
    13: [{ k: 'mag_riff', cx: '0.0947088068', cy: '-1.0600142045', zoom: 140.8, wp: { v: 0 } },
         { k: 'mag_seepferd', cx: '-0.1742897727', cy: '-0.7883522727', zoom: 35.2, wp: { v: 0 } },
         { k: 'mag_spiralen', cx: '1.3384943182', cy: '-0.5326704545', zoom: 35.2, wp: { v: 1 } },
         { k: 'mag_perlen', cx: '1.2745738636', cy: '-0.2769886364', zoom: 35.2, wp: { v: 1 } }],
};
for (const f in SIGHTS) for (const s of SIGHTS[f]) { s.formula = +f; s.key = 'sight_' + s.k; }
// Standardpalette je neuer Welt (die klassischen Welten teilen sich die gewählte Palette wie bisher)
const WORLD_PAL = { 10: 'gold', 11: 'ice', 12: 'cosmic', 13: 'aurora' };

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
    outMode: 'pal', edgeW: 16,                                              // 6.9: Außen (pal/edge/black), Saumbreite Grenznah (CSS-Pixel)
    style: 0, stMix: 0.85, stS: 5,                                          // 7.1: Färbe-Stil (0 Standard … 6 Stängel), Stärke, Streifendichte
    wp: {}, wpal: {},                                                       // 7.1: Welt-Parameter, Palette je Welt
    bulbStyle: 0, bulbFog: 0.15, bulbDof: 0, bulbBreathe: false,             // 7.0 Mandelbulb: Stil (0 Klassisch, 1 Stein, 2 Metall, 3 Glas/Neon), Nebel, Tiefenunschärfe, Atmen
    hudFs: true,                                                            // 6.8: HUD im Vollbild ausblenden
    shotRes: 'screen', shotW: 3840, shotH: 2160, shotAspect: 'screen', shotLabel: true,   // 6.8.1: Screenshot-Auflösung, Beschriftung
    chrome: true,
};
// 6.5 Deko (Glas, weiche Übergänge, 3D-Himmel/Dunst/Wasser): ?deko=0 = Aussehen bis 6.4.1 (A/B-Vergleich)
const DEKO = Q.get('deko') !== '0';
document.documentElement.classList.toggle('deko', DEKO);
const RM = matchMedia('(prefers-reduced-motion: reduce)');
// 6.1 „glatt wie Video": Menge glatt (Distanzschätzung), Glatte Kanten = gemittelte 3D-Bilder im Stillstand (8, Akku 4)
// (die A/B-Regler ?aa=0/N, ?de=0, ?dew sind seit 6.5.4 entfernt)
// 6.9: die Distanzschätzung wird auch für „Außen: Grenznah“ gerechnet (deActive = mitrechnen); die Mengen-Glättung
// selbst (Saum in der Mengenfarbe) nur bei „Menge glatt“ (deMaskOn)
function deActive() { return (S.deOn || S.outMode === 'edge') && S.formula !== 5; }
function deMaskOn() { return S.deOn && S.formula !== 5; }
// 6.9 Außen: 0 Palette, 1 Grenznah, 2 Schwarz – in den 2D-Welten mit Menge und (7.0) im Mandelbulb (Hintergrund: Verlauf /
// Leuchten nahe der Oberfläche / schwarz); nicht Newton, Buddhabrot
function outActive() { return hasSetW(S.formula) || isRay() ? ({ edge: 1, black: 2 }[S.outMode] || 0) : 0; }
function aaFrames() { return S.aa ? (S.quality === 'eco' ? 4 : 8) : 0; }
// 7.1 Färbe-Stil: wirkt in den 2D-Welten mit Fluchtzeit (Mandelbrot, Julia, Burning Ship, Tricorn, z³) – nicht Newton,
// 3D-Fraktale, Buddhabrot. Rechen-Variante + Puffer mit Stil-Kanal (js/renderer.js), Parameter: Streifendichte, Kreisradius
// Abstimmung (Bildvergleich 7.1): Fenster des gleitenden Mittels je Stil, Vergessen der Fallen, Kontrast im Anzeige-Pass
// (Mess-Regler ?stk=, ?stf=, ?stg=)
// gewählt: Seide K = 10, Kontrast 3 (K = 24 wirkte im Deep Zoom flau, K = 4 unruhig); Dreieck K = 6, Kontrast 2,5
const ST_TUNE = { K: [0, +Q.get('stk') || 10, +Q.get('stk') || 6, 0, 0, 0, 0], F: +Q.get('stf') || 0.32, G: [1, +Q.get('stg') || 3, +Q.get('stg') || 2.5, 1, 1, 1, 1] };
function stActive() { return S.style > 0 && S.style <= 6 && styleOK() ? S.style | 0 : 0; }
// 7.1: Stile in den Welten mit Fluchtzeit – klassisch (außer Newton), Burning-Ship-Familie, Multibrot, Phoenix, Magnet
function styleOK(f) { f = f === undefined ? S.formula : f; return f < 5 || f === 11 || f === 13; }
// Welt-Parameter für Rechen-Shader (u_xp, u_xq, u_xi, Newton-Polynom) und CPU-Worker (fractal-core.js xpSetup)
const polyCache = {};
function xparams(cf) {
    const w = S.wp[S.formula] || {};
    if (cf === 5) { const i = (S.wp[5] || {}).p | 0; return { poly: polyCache[i] || (polyCache[i] = self.FKCore.newtonPoly(i)) }; }
    if (cf === 23) return { xp: [mexpNow(), 0, 0, 0] };
    if (cf === 24) return { xp: [+w.cr, +w.ci, +w.pr, +w.pi], xq: [w.v ? 1 : 0, 0, 0, 0] };
    if (cf === 25) return { xp: [+w.r || 1, +w.cr, +w.ci, w.v ? 1 : 0] };
    if (cf === 28) { const q = lyaSeq(w.s); return { xp: [8, 0, 0, 0], xi: [q.bits, q.len, 100, 0] }; }
    return null;
}
// Lyapunov-Folge: nur A/B, 1–24 Zeichen (Bits: B = 1)
function lyaSeq(s) {
    s = String(s || 'AB').toUpperCase().replace(/[^AB]/g, '').slice(0, 24) || 'AB';
    let bits = 0;
    for (let i = 0; i < s.length; i++) if (s[i] === 'B') bits |= 1 << i;
    return { s, bits, len: s.length };
}
// Multibrot-Exponent jetzt (Morph: schwingt weich zwischen 2 und 6, eine Runde in ~50 s)
// (das Bild folgt so schnell, wie gerechnet wird: der Exponent geht erst weiter, wenn eine Vorschau für den aktuellen steht)
const MORPH = { ph: 0, e: 3 };
function mexpNow() { const w = S.wp[4] || {}; return w.m ? MORPH.e : Math.max(2, Math.min(8, +w.e || 3)); }
function morphStep(now, dt) {
    const w = S.wp[4];
    if (S.formula !== 4 || !w || !w.m) return;
    const f = RC.front;
    if (f && f.sig !== contentSig() && f.preview !== false && now - (MORPH.t || 0) < 400) return;    // Bild zum Exponenten fehlt noch
    MORPH.t = now;
    MORPH.ph += Math.min(dt, 0.05) * 2 * Math.PI / 50;
    MORPH.e = +(4 - 2 * Math.cos(MORPH.ph)).toFixed(4);
    lastParamT = now; camDirty = true;
}
function xsig() { const cf = cformula(); const X = cf === 5 ? { p: (S.wp[5] || {}).p | 0 } : xparams(cf); return cf + (X ? ':' + JSON.stringify(X) : ''); }
function styleJob(job) {
    job.st = stActive();
    if (job.st) {
        job.stp = [Math.max(1, Math.min(12, Math.round(S.stS) || 5)), 1, ST_TUNE.K[job.st], ST_TUNE.F];
        job.cabs = job.formula === 1 ? Math.hypot(job.julia[0], job.julia[1]) : Math.hypot(HP.toNumber(job.view.cx), HP.toNumber(job.view.cy));
    }
    return job;
}
for (const f in WP_DEF) S.wp[f] = Object.assign({}, WP_DEF[f]);
const listeners = [];
function emit(what) { for (const f of listeners) f(what); }

function loadSettings() {
    PAL.loadCustom();
    try {
        const s = JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}');
        for (const k of ['palette', 'density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'particles', 'quality', 'renderer', 'precise', 'minimap', 'lang', 'zoomFormat', 'governor', 'h3d', 'flySpeed', 'deOn', 'aa', 'setCol', 'setHex', 'alpine', 'valley', 'inMode', 'outMode', 'edgeW', 'style', 'stMix', 'stS', 'wp', 'wpal', 'bulbStyle', 'bulbFog', 'bulbDof', 'bulbBreathe', 'hudFs', 'shotRes', 'shotW', 'shotH', 'shotAspect', 'shotLabel'])
            if (s[k] !== undefined) S[k] = s[k];
        for (const f in WP_DEF) S.wp[f] = Object.assign({}, WP_DEF[f], S.wp[f] || {});
        if (typeof s.paletteId === 'string') S.palette = PAL.indexOf(s.paletteId);
    } catch (e) { /* ignorieren */ }
    if (!TRANSLATIONS[S.lang]) S.lang = 'de';
    try { if (!localStorage.getItem('fraktal_v5_settings')) S.minimap = window.innerWidth >= 900; } catch (e) {}
}
function saveSettings() {
    const o = {};
    for (const k of ['density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'particles', 'quality', 'renderer', 'precise', 'minimap', 'lang', 'zoomFormat', 'governor', 'h3d', 'flySpeed', 'deOn', 'aa', 'setCol', 'setHex', 'alpine', 'valley', 'inMode', 'outMode', 'edgeW', 'style', 'stMix', 'stS', 'wp', 'wpal', 'bulbStyle', 'bulbFog', 'bulbDof', 'bulbBreathe', 'hudFs', 'shotRes', 'shotW', 'shotH', 'shotAspect', 'shotLabel']) o[k] = S[k];
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
        // 6.8.1: Vollbild an/aus, Drehen hoch/quer: ein laufender Flug fliegt weiter. Die Puffer werden für die neue Größe
        // gerechnet, die vorhandenen Ebenen tragen solange (Welt-Koordinaten). In den nächsten 0,6 s (RC.resizeT) hält die
        // Tempo-Bremse ihren Wert (sonst bremste sie wegen der neuen Ränder kurz ab) und ein Flugschritt ist höchstens 1/30 s
        // lang (der Browser lässt beim Umschalten Bilder aus – sonst spränge die Kamera)
        RC.resizeT = performance.now();
        invalidate('resize');
    }
}
window.addEventListener('resize', () => { resize(); });
// 6.8.1: Vollbild-Wechsel und Drehen kündigen sich an, bevor die Größe sich ändert (macOS/Android lassen beim Umschalten
// Bilder aus) – ab hier gilt schon die Schonfrist von resize()
function noteResize() { RC.resizeT = performance.now(); }
window.addEventListener('orientationchange', () => noteResize());
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => noteResize());
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => resize());

// ------------------------------------------------------------------ Kamera-Hilfen
const worldPerCss = (zoom) => 3 / (zoom * cssH);
// 7.1: Grenze je Welt; direkt gerechnete Exoten (f64 auf der CPU) bis 10¹³, Lyapunov 10¹²
function maxZoom() { const cf = cformula(); return cf === 28 ? 1e12 : isExo(cf) ? 1e13 : MAX_ZOOM[S.formula]; }
function clampZoom(z) { return Math.min(maxZoom(), Math.max(0.2, z)); }
// Bildschirmpunkt (CSS px) -> Weltoffset zur Kameramitte (double)
function screenOffset(x, y, zoom) { const s = worldPerCss(zoom); return [(x - cssW / 2) * s, -(y - cssH / 2) * s]; }
function setCam(cx, cy, zoom) {
    const z = clampZoom(zoom);
    if (z !== zoom && zoom > maxZoom() && !setCam._warned) { setCam._warned = true; toast(t('max_depth')); }
    if (zoom < maxZoom()) setCam._warned = false;
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

function stopAnims() { inertia = null; flight = null; wheelAnim = null; if (ROUND.list) stopRound(); }

function flyTo(cx, cy, zoom, opts = {}) {
    inertia = null; flight = null; wheelAnim = null;      // (wie stopAnims, ohne einen laufenden Rundgang zu beenden)
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
    if (isBulb()) return S.cam;
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
    onStart(ax, ay) { if (!FLY.on) stopAnims(); gestureBase = { cam: S.cam, ax, ay, tilt: V3.tilt, heading: V3.heading }; FLY.userBase = FLY.user || 0; if (isBulb()) BULB.G.start(ax, ay); },
    onTransform(ax0, ay0, ax, ay, scale, rot, n) {
        if (!gestureBase) return;
        if (isBulb()) { BULB.G.transform(ax0, ay0, ax, ay, scale, rot || 0, n || 1); return; }
        const b = gestureBase;
        if (V3.on) { gesture3d(b, ax0, ay0, ax, ay, scale, rot || 0, n || 1); return; }
        if (FLY.on && gesture2dFly(b, ax0, ay0, ax, ay, scale, n || 1)) return;
        const c = anchoredCam(b.cam, ax0, ay0, ax, ay, scale);
        setCam(c.cx, c.cy, c.zoom);
    },
    onEnd(vx, vy, vs, last) {
        gestureBase = null;
        const cap = (v, m) => Math.max(-m, Math.min(m, v));
        vx = cap(vx, 5000); vy = cap(vy, 5000); vs = cap(vs, 7);
        if (isBulb()) { BULB.G.end(vx, vy, vs); return; }
        if (FLY.on) return;
        if (Math.hypot(vx, vy) > 60 || Math.abs(vs) > 0.3)
            inertia = { vx, vy, vs, ax: last ? last.ax : cssW / 2, ay: last ? last.ay : cssH / 2 };
    },
    // 6.8: HUD im Vollbild/Kino-Modus ausgeblendet -> ein Tipp holt es nur zurück (ui.js, API.tapHook), der Flug läuft weiter
    onTap(x, y) { if (API.tapHook && API.tapHook(x, y)) return; if (isBulb() && !FLY.on && BULB.G.tap(x, y)) return; if (FLY.on) { pauseFly(); toast(t(FLY.paused ? 'fly_paused' : 'fly_on'), 1400); } else emit('tap'); },
    // 6.8.1: HUD im Vollbild/Kino-Modus ausgeblendet -> Doppeltipp = Flug an/aus (ui.js, API.dblTapHook)
    onDoubleTap(x, y) { if (API.dblTapHook && API.dblTapHook(x, y)) return; stopFly(); if (isBulb()) { BULB.G.doubleTap(x, y); return; } if (V3.on) zoomAt(cssW / 2, cssH / 2, 3); else zoomAt(x, y, 3); },
    onTwoFingerTap(x, y) { stopFly(); if (isBulb()) { BULB.G.twoFingerTap(x, y); return; } if (V3.on) zoomAt(cssW / 2, cssH / 2, 1 / 3); else zoomAt(x, y, 1 / 3); },
    onOrbit(dx, dy, phase) {
        if (isBulb()) { BULB.G.orbitMouse(dx, dy, phase); return; }
        if (!V3.on) return;
        if (phase === 'start') { gestureBase = { cam: S.cam, tilt: V3.tilt, heading: V3.heading }; return; }
        if (phase === 'end' || !gestureBase) { gestureBase = null; return; }
        V3.heading = gestureBase.heading - dx * 0.008;
        V3.tilt = Math.max(0, Math.min(MAX_TILT, gestureBase.tilt - dy * 0.006));
        RC.dirty = true;
    },
    onLongPress(x, y) {
        if (isBulb() && !FLY.on) { BULB.G.longPress(x, y); return; }
        if (S.formula !== 0 || V3.on || FLY.on) return;
        const [ox, oy] = screenOffset(x, y, S.cam.zoom);
        const jx = S.cam.cx + HP.fromNumber(ox), jy = S.cam.cy + HP.fromNumber(oy);
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
        setJulia(jx, jy);
        setMode(1);
        toast(t('julia_here') + ': ' + fmtC(jx, jy));
    },
    onWheel(x, y, f) {
        inertia = null; flight = null;
        stopFly();
        if (isBulb()) { BULB.G.wheel(x, y, f); return; }
        if (V3.on) { x = cssW / 2; y = cssH / 2; }
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
// 6.6 Gesten im 2D-Flug: ein Finger schiebt das Bild (der Flug taucht weiter, der Zoompunkt liegt danach auf einer neuen
// Stelle), zwei Finger beenden den Flug und zoomen ab hier normal weiter. true = Geste erledigt
function gesture2dFly(b, ax0, ay0, ax, ay, scale, n) {
    if (n >= 2 || Math.abs(scale - 1) > 0.02) {
        stopFly();
        b.cam = anchoredCam(S.cam, ax, ay, ax0, ay0, 1 / scale);    // Ausgangskamera passend zur aktuellen Fingerlage
        return false;
    }
    const px = b.px === undefined ? ax0 : b.px, py = b.py === undefined ? ay0 : b.py;
    const c = anchoredCam(S.cam, px, py, ax, ay, 1);
    setCam(c.cx, c.cy, c.zoom);
    b.px = ax; b.py = ay;
    flyPanned();
    return true;
}
function zoomAt(x, y, f) {
    stopAnims();
    if (isBulb()) { BULB.keyZoom(f); return; }
    flyTo(null, null, S.cam.zoom * f, { anchor: { x, y }, duration: 0.42 });
}

// ------------------------------------------------------------------ Tour (Auto-Zoom zu einem Ort)
// 7.1: ein Ort trägt die Welt-Parameter (Variante, Exponent, Folge …) – beim Anfliegen übernehmen
function applyPlaceWP(p) { if (p && p.wp && WP_DEF[p.formula || 0]) { S.wp[p.formula || 0] = Object.assign({}, WP_DEF[p.formula || 0], p.wp); invalidate(); emit('wp'); } }
function startTour(p, onDone) {
    inertia = null; flight = null; wheelAnim = null;          // (nicht stopAnims: ein Rundgang startet seine erste Tour hiermit)
    if (isRay(p.formula)) { setMode(p.formula, true); if (p.b) BULB.tourTo(p.b, 7); return; }
    setMode(p.formula || 0, true);
    applyPlaceWP(p);
    if (p.pal) S.palette = PAL.indexOf(p.pal);
    if (p.jx) setJulia(HP.fromString(p.jx), HP.fromString(p.jy));
    const home = MODE_HOME[S.formula];
    setCam(HP.fromString(home[0]), HP.fromString(home[1]), homeZoom(S.formula));
    S.iterManual = false;
    const b = { cx: HP.fromString(p.cx), cy: HP.fromString(p.cy), zoom: +p.zoom };
    // (der Referenzorbit wird per refTarget() gleich fürs Ziel angefordert: das Ziel liegt in jeder Ansicht der Fahrt)
    setTimeout(() => {
        flyTo(b.cx, b.cy, b.zoom, { perDecade: 1.1, maxDur: 40, onDone });
    }, 250);
}

// ------------------------------------------------------------------ Modus / Parameter
// 7.1 Rundgang: alle Sehenswürdigkeiten einer Welt nacheinander – Tour zum ersten Ort, dort ~4 s Pause, dann Flug zum
// nächsten (hinaus und wieder hinein). Jede Geste/Taste beendet ihn (stopAnims setzt flight = null -> Token stimmt nicht mehr).
const ROUND = { list: null, i: 0, tok: 0, t: 0 };
function startRound(list) {
    if (!list || !list.length) return;
    ROUND.list = list; ROUND.i = 0; ROUND.tok++;
    roundGo(ROUND.tok, true);
}
function roundGo(tok, first) {
    if (tok !== ROUND.tok || !ROUND.list) return;
    const p = ROUND.list[ROUND.i];
    const done = () => { if (tok !== ROUND.tok) return; emit({ toast: t(p.key), ms: 2600 }); ROUND.t = setTimeout(() => { if (tok !== ROUND.tok || flight || isMoving(performance.now())) { if (tok === ROUND.tok && !flight) ROUND.list = null; return; } ROUND.i = (ROUND.i + 1) % ROUND.list.length; roundGo(tok, false); }, 4200); };
    if (first) startTour(p, done);
    else {
        if (p.wp) applyPlaceWP(p);
        if (p.pal) S.palette = PAL.indexOf(p.pal);
        flyTo(HP.fromString(p.cx), HP.fromString(p.cy), +p.zoom, { perDecade: 0.9, maxDur: 30, onDone: done });
    }
}
function stopRound() { ROUND.tok++; ROUND.list = null; clearTimeout(ROUND.t); }
function setMode(m, keepView) {
    if (m === S.formula && keepView) return;
    const prev = S.formula;
    S.formula = m;
    if (m !== prev) worldPalette(prev, m);
    if (!keepView) {
        const h = MODE_HOME[m];
        stopAnims();
        setCam(HP.fromString(h[0]), HP.fromString(h[1]), homeZoom(m));
        S.iterManual = false;
    } else setCam(S.cam.cx, S.cam.cy, S.cam.zoom);
    if (m !== prev) { markFramesForeign(); buddhaReset(); if (FLY.on && (isRay(m) || isRay(prev))) stopFly(); }   // 7.0: Mandelbulb hat einen eigenen Flug
    if (isRay(m) && (!keepView || m !== prev)) BULB.home();
    invalidate('mode');
    emit('mode');
}
function setJulia(x, y) { S.julia = { x, y }; invalidate('julia'); emit('julia'); lastParamT = performance.now(); }
// 7.1 Palette je Welt: die neuen Welten (WORLD_PAL) merken sich ihre eigene Palette (Standard = kuratierte Palette), die
// klassischen Welten teilen sich eine (Schlüssel 'c') – Wechsel zurück stellt die vorige wieder her
function worldPalette(prev, m) {
    const key = (f) => WORLD_PAL[f] ? String(f) : 'c';
    S.wpal = S.wpal || {};
    S.wpal[key(prev)] = PAL.list[S.palette].id;
    const id = S.wpal[key(m)] || WORLD_PAL[m];
    if (id) S.palette = PAL.indexOf(id);
}
// 7.1 Welt-Parameter setzen (Teilobjekt, z. B. { v: 1 }); live = beim Ziehen eines Reglers (Vorschau wie beim c-Pad)
function setWP(f, o, live) {
    S.wp[f] = Object.assign({}, WP_DEF[f] || {}, S.wp[f] || {}, o);
    if (f === S.formula) { setCam(S.cam.cx, S.cam.cy, S.cam.zoom); invalidate('wp'); }
    lastParamT = performance.now();
    if (!live) saveSettings();
    emit('wp');
}
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
    if (isRay(f)) return { kind: 'bulb' };
    if (f === 7) return { kind: 'buddha' };
    const rcpu = S.renderer === 'cpu' || forceCPU;
    if (f === 5) return z <= NEWTON_GPU_MAX && !rcpu ? { kind: 'gpu', mode: 'direct' } : { kind: 'cpu', mode: 'direct' };
    // 7.1 Exoten: f32 direkt bis EXO_GPU_MAX (Lyapunov: Koordinaten um 3 -> früher grob), darüber CPU f64 direkt
    const cf = cformula();
    if (isExo(cf)) return z <= (cf === 28 ? 600 : EXO_GPU_MAX) && !rcpu ? { kind: 'gpu', mode: 'direct' } : { kind: 'cpu', mode: 'direct' };
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
const FADE_MS = 220, FADE_MOVE_MS = 150;
const RESIZE_HOLD = 600;           // 6.8.1: ms nach einer Größenänderung (Vollbild, Drehen) – siehe resize()
const RESIZE_GOV_HOLD = 1500;      // 6.8.1: so lange hält die Tempo-Bremse danach ihren Wert (neue Ränder werden gerechnet)
const FEATHER = 12;
const MAXL = self.FKShaders.NL;            // Ebenen im Display-Pass (8)
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
function innActive() { return S.setCol === 'bunt' && (S.formula < 5 || S.formula === 2) && !isExo(cformula()) && !innBlocked; }
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

function jobProgress(job) { return job.kind === 'gpu' ? job.row / Math.max(1, job.h) : job.tilesDone / Math.max(1, job.tilesTotal); }
function fullDone(fr, now) {
    stats.lastFullMs = RC.keyT0 ? now - RC.keyT0 : fr.ms;
    emit('rendered');
}

// Ebenen-Stapel: js/layers.js
const smooth01 = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

// Exakte Nachrechnung (GPU-f32 -> CPU-f64): js/cpu-pool.js

function isMoving(now) {
    return gestures.active() || !!inertia || !!flight || !!wheelAnim || (FLY.on && !FLY.paused) || now - RC.lastMoveT < 150 || now - lastParamT < 150 || (isBulb() && BULB.moving());
}
function animating() { return !!inertia || !!flight || !!wheelAnim || (FLY.on && !FLY.paused); }

// Render-Planung (schedule, Vorschau, Vorausrechnen, Tempo-Bremse): js/scheduler.js

function look() {
    const p = PAL.list[S.palette];
    return { formula: S.formula, maxIter: RC.front ? RC.front.maxIter : currentMaxIter(), pal: p, custom: PAL.customFlat(),
             cycle: S.cycle, density: S.density, time: S.time, relief: S.relief ? S.reliefStrength : 0,
             particles: S.particles && S.anim, banded: S.banded,
             setCol: PAL.setRGB(S.setCol, S.setHex, p), alpine: S.alpine ? (['forest', 'lake', 'meadow'].indexOf(S.valley) + 1 || 1) : 0,
             inner: innActive() ? (S.inMode === 2 ? 2 : 1) : 0,
             // 6.9 Außen; Saumbreite in Zielpixeln (Screenshot skaliert mit, js/capture.js; 3D: in Pufferpixeln, ≈ Zielpixel)
             outM: outActive(), outW: S.edgeW * canvas.width / cssW,
             style: stActive(), stMix: S.stMix, stG: ST_TUNE.G[stActive()] };    // 7.1 Färbe-Stil
}

// Ebenenliste + Optionen für den Display-Pass (auch für Screenshot/Thumbnail)
function presentArgs(now) {
    // Einblenden zählt ab dem ersten gezeigten Frame (ein ausgefallener Frame darf die Blende nicht verschlucken)
    for (const l of RC.layers) if (!l.shown) { l.shown = true; l.t0 = now; }
    const list = orderLayers(now, S.cam);
    RC.fading = list.some(l => l.alpha < 1 && !l.prefetch);   // Vorausberechnetes liegt unter dem fertigen Bild
    return { list, opts: { feather: FEATHER * dpr, recon: true, de: deMaskOn() ? [0.25, 1.25] : null } };
}
// blendet gerade eine sichtbare Ebene ein (auch eine, die noch nie gezeigt wurde)?
function isFading(now) {
    return RC.layers.some(l => !l.prefetch && (!l.shown || layerFade(l, now) < 1));
}
function presentNow() { const a = presentArgs(performance.now()); R.present(a.list, S.cam, look(), null, a.opts); }

let lastPresentKey = '';
function present(now, camChanged) {
    const p = plan();
    if (p.kind === 'bulb') { BULB.present(now, camChanged || RC.dirty); RC.dirty = false; return; }
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
    probe2d(now, a.list);
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
// 6.7 Technik-Regler (?taa=1 ?scharf=0 ?tone=0|agx ?bloom=0 ?hao=0 ?detail=0 ?gpuwahl=0), gelten für den Seitenaufruf
const TECH = self.FK3DTech ? self.FK3DTech.flags(Q) : null;
const T3 = self.FK3D ? self.FK3D.create(R, TECH) : null;
const MAXL3 = T3 ? T3.N3 : MAXL;         // P2-3: Ebenen-Höchstzahl in 3D
const MAX_TILT = 60 * Math.PI / 180;
const V3 = { on: false, mix: 0, dir: 0, tilt: 42 * Math.PI / 180, heading: 0, L: [4, 9], Lt: null, probeT: 0, probe: null,
             accKey: null, accN: 0, accPending: false, keyT: 0, animTick: 0, moved: false, accMs: null, turnA: 0, turnT: 0 };   // 6.8 turnA/turnT: Blick umgedreht (Flug)
function can3d(f) { const m = f === undefined ? S.formula : f; return !!T3 && m !== 7 && !isRay(m); }
// 6.3: 3D wird erst eingeblendet, wenn alle Shader dafür fertig übersetzt sind (T3.ready fragt nicht blockierend,
// pro Bild). Bis dahin bleibt das 2D-Bild bedienbar, der ⛰-Knopf zeigt „3D wird vorbereitet …“ (V3.prep = Startzeit).
// Unter Windows (Direct3D 11) kann das Übersetzen Sekunden dauern – vorher hing der Tab so lange.
function set3d(on) {
    if (on && !can3d()) return;
    if (!on && V3.prep) { V3.prep = 0; V3.prepFly = null; emit('3d'); if (!V3.on) return; }
    if (on && !V3.on && T3 && !ready3d()) { if (!V3.prep) { V3.prep = performance.now(); emit('3d'); } return; }
    if (on === V3.on && V3.dir === (on ? 1 : -1)) return;
    if (on) { V3.on = true; V3.dir = 1; V3.heading = 0; if (T3) { T3.scale = baseScale3d(); T3.setStage(S.quality); T3.applyGrid(); } }   // 6.7: Gitter nach GPU-Messung
    else { V3.dir = -1; if (!FLY2D) stopFly(); }       // 6.6: 3D aus im Flug -> der Flug läuft in 2D weiter
    invalidate(); emit('3d');
}
// P1-2: ein 3D-Programm ist auf diesem Treiber defekt -> Vorbereitung abbrechen bzw. 3D sofort aus (2D läuft weiter)
function fail3d() {
    V3.prep = 0; V3.prepFly = null;
    if (V3.on) {
        if (!FLY2D) stopFly();
        for (const l of RC.layers) T3.free(l);
        T3.freeStill();
        V3.on = false; V3.mix = 0; V3.dir = 0; V3.heading = 0; V3.accKey = null; V3.accPending = false;
        invalidate();
    }
    toast(t('shader_3d_failed'), 4500);
    emit('3d');
}
// fertig übersetzt (nicht blockierend gefragt) und angewärmt (je Bild ein Programm) – erst dann 3D einblenden
function ready3d() { const lk = look(); T3.setStage(S.quality); return T3.ready(lk) && T3.warm(lk); }   // 6.7: Stufe zuerst – die Gelände-Variante hängt von ihr ab
function baseScale3d() { return Q.get('s3d') ? +Q.get('s3d') : (Math.min(screen.width, screen.height) < 700 ? 0.65 : 1); }
// 6.7 TAA im Flug (?taa=1): Renderskala im Flug höchstens FK3DTech.TAA.flyScale (0,7; ?taas=x zum Abstimmen) – die
// zeitliche Mittelung ersetzt die fehlenden Pixel. Nicht mit festem ?s3d. null = keine Absenkung.
function taaFlyScale() {
    if (!TECH || !TECH.taa || !T3 || !T3.flags.taa || Q.get('s3d') || !(FLY.on && !FLY.paused && FLY.d3)) return null;
    return Q.get('taas') ? +Q.get('taas') : self.FK3DTech.TAA.flyScale;
}
// Obergrenze der Bewegungs-Auflösung jetzt (Grundwert, im TAA-Flug abgesenkt)
function targetScale3d() { const f = taaFlyScale(); return f ? Math.min(baseScale3d(), f) : baseScale3d(); }
const e3 = (x) => x * x * (3 - 2 * x);
// Übergang 2D <-> 3D (0,7 s): Neigung/Höhe/Drehung wachsen mit mix; bei mix = 0 ist 3D = 2D-Bild
function update3d(now, dt) {
    if (V3.prep && !V3.on) {
        if (!can3d()) { V3.prep = 0; V3.prepFly = null; emit('3d'); return; }
        if (!ready3d()) { if (T3.failed) { fail3d(); return; } if (stats.frames % 6 === 0) emit('3dprep'); return; }
        const fl = V3.prepFly;
        V3.prep = 0; V3.prepFly = null;
        if (fl) startFly(fl === true ? undefined : fl, { d3: true }); else set3d(true);
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
    // (Flugschritt: frame(), auch in 2D)
    if (!(FLY.on && !FLY.paused) && (Math.abs(FLY.roll || 0) > 1e-4 || FLY.om)) { FLY.roll = (FLY.roll || 0) * Math.exp(-dt * 3); FLY.om = 0; if (Math.abs(FLY.roll) <= 1e-4) FLY.roll = 0; RC.dirty = true; }   // Schräglage klingt aus
    // 6.8 Umdrehen im Flug: der Blick dreht in 0,8 s weich um 180° (Kurs und Flugweg bleiben)
    if (V3.turnA !== V3.turnT) {
        const u = Math.min(1, (now - (V3.turnT0 || 0)) / 800), f = V3.turnFrom || 0;
        V3.turnA = u >= 1 ? V3.turnT : f + (V3.turnT - f) * ease(u);
        RC.dirty = true;
    }
    if (V3.northT) {
        const u = Math.min(1, (now - V3.northT) / 450), e = ease(u);
        const h0 = V3.northFrom[0] - Math.round(V3.northFrom[0] / (2 * Math.PI)) * 2 * Math.PI;
        V3.heading = h0 * (1 - e); V3.tilt = V3.northFrom[1] + (42 * Math.PI / 180 - V3.northFrom[1]) * e;
        RC.dirty = true;
        if (u >= 1) V3.northT = 0;
    }
    // 6.7 TAA-Flug: Auflösung absenken, danach den Wert von vorher wiederherstellen (sonst bliebe die Deko lange aus)
    const tf = taaFlyScale();
    if (tf) { if (V3.preTaa == null) V3.preTaa = T3.scale; if (T3.scale > tf) T3.scale = tf; }
    else if (V3.preTaa != null) { T3.scale = Math.max(T3.scale, V3.preTaa); V3.preTaa = null; }
    // Renderauflösung an die Bildrate anpassen (Ziel: Vsync halten, mind. 50 %)
    // (nicht unter Testautomation: headless liefert ohnehin nur ~15 fps, das wäre kein Lastsignal)
    if (navigator.webdriver || Q.get('s3d') || V3.accKey) return;   // Stillstands-Bilder sind kein Lastsignal für die Bewegungs-Auflösung
    const vs = RC.vsync || 16.7;
    V3.slow = (V3.slow || 0) + ((RC.dtEMA || 16) > 1.3 * vs ? 1 : -0.25);
    if (V3.slow > 40) { T3.scale = Math.max(0.45, T3.scale * 0.9); V3.slow = 0; }
    else if (V3.slow < -200) { T3.scale = Math.min(targetScale3d(), T3.scale * 1.05); V3.slow = 0; }
}
// 6.5 Deko in 3D (Wolken, Horizontleuchten, Luftperspektive, Wolken im Wasser): Stärke 0..1, weich ein-/ausgeblendet.
// Aus (= exakt das Bild und die Kosten bis 6.4.1) bei ?deko=0, Qualität „Akku“ und solange die Auflösungs-Drosselung
// greift. Wolkenzug nur, solange ohnehin animiert gezeichnet wird, nicht bei „Bewegung reduzieren“.
const DK = { m: DEKO ? 1 : 0, t: 0, ct: 0 };
function deko3d() {
    const now = performance.now(), dt = DK.t ? Math.min(0.1, (now - DK.t) / 1000) : 0;
    DK.t = now;
    const tgt = DEKO && S.quality !== 'eco' && !(T3 && T3.scale < targetScale3d() - 1e-3) ? 1 : 0;   // 6.7: TAA-Flugskala zählt nicht als Drosselung
    if (DK.m !== tgt) { DK.m = tgt > DK.m ? Math.min(tgt, DK.m + dt * 1.2) : Math.max(tgt, DK.m - dt * 1.2); RC.dirty = true; }
    return DK.m;
}
function view3d() {
    const em = e3(V3.mix);
    return { tilt: V3.tilt * em, heading: (V3.heading + (V3.turnA || 0)) * (V3.dir < 0 ? em : 1), roll: (FLY.roll || 0) * em, height: S.h3d * 1.1, mix: em, focus: S.cam, u: 1.5 / S.cam.zoom, L: V3.L, cdf: V3.cdf, time: S.time,
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
    return [c.cx, c.cy, c.zoom, v.tilt.toFixed(5), v.heading.toFixed(5), v.height, v.mix, canvas.width, canvas.height, S.palette, lk.density, lk.banded, deActive(), FLY.on, lk.setCol.join(','), lk.alpine, T3.variant, lk.inner, lk.outM, lk.outW].join('|');
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
    T3.setStage(S.quality);       // 6.7: Schattenschritte, AO, Detail, Bloom, GPU-Budget je Stufe
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
// 6.6 Sonde im 2D-Flug: dieselbe wie in 3D (T3.probe liest nur die Iterationspuffer), Fenster = sichtbares Bild. Ihr
// Programm wird nicht blockierend übersetzt (bis dahin taucht der Flug geradeaus); 3D-Shader werden dafür nicht gebraucht.
// Die Höhen-Normierung folgt in 2D direkt (sie dient hier nur der Detail-Wertung; in 3D gleitet sie weich nach)
function probe2d(now, list) {
    if (!FLY.on || FLY.paused || V3.on || !T3 || now - V3.probeT < 150) return;
    if (!T3.probeReady()) return;
    V3.probeT = now;
    const cam = S.cam;
    const pr = T3.probe(layers3d(list), cam, 1.5 / cam.zoom, Math.max(1, cssW / cssH) * 1.05);
    if (pr) pr.then((pb) => {
        if (!pb) return;
        pb.cam = cam; pb.seq = (V3.probe ? V3.probe.seq || 0 : 0) + 1; V3.probe = pb; heightStats(pb);
        if (!V3.on && V3.Lt) { V3.L = V3.Lt.slice(); if (V3.cdfT) V3.cdf = V3.cdfT.slice(); }
    });
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
    morphStep(now, dt);
    if (isBulb()) BULB.update(now, dt);
    update3d(now, dt);
    if (V3.on && !can3d()) { V3.on = false; V3.mix = 0; V3.dir = 0; stopFly(); emit('3d'); }
    if (FLY.on && !canFly()) stopFly();
    if (FLY.on && !FLY.paused) flyUpdate(now, now - (RC.resizeT || -1e9) < RESIZE_HOLD ? Math.min(dt, 1 / 30) : dt);
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
    // 6.8.1 Screenshot in Kacheln: rechnet in Häppchen in diesem Takt; die Ansicht steht solange (Planer pausiert – in 3D erst
    // nach dem fertigen Bildschirmbild, RC.capHold –, keine Ebenen werden verworfen)
    if (RC.cap) { try { shotStep(now); } catch (e) { reportOnce(e); } }
    if (stats.frames % 8 === 0 && !RC.cap && !RC.freeze) pruneLayers(now);
    const tS = performance.now();
    if ((!RC.cap || RC.capHold) && !RC.freeze) { try { schedule(now); } catch (e) { reportOnce(e); } }      // P1-2: ein Fehler friert die Schleife nicht ein
    const tP = performance.now();
    try { present(now, camChanged); } catch (e) { reportOnce(e); }
    if (!GW.firstPic && (RC.layers.length || !is2dW(S.formula))) gwFirstPicture();
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
    BULB.reset();
    for (const l of RC.layers) l.h3d = null;
    V3.accKey = null; V3.accPending = false; V3.Lset = false;
    BUD.hist = null;
    RC.front = RC.lastPreview = null; RC.layers = []; RC.job = RC.pjob = null; RC.fix = null; REF.cur = null; invalidate();
};
R.onLost = () => { RC.job = RC.pjob = null; gwLost(); M_Capture.lost(); };   // 6.8.1: laufenden Screenshot abbrechen

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
// 6.8.1: Bildschirm-Kopie (Buddhabrot – entsteht aus Zufallsproben über die Zeit, nur in Bildschirmauflösung); label: Beschriftung
function screenBlob(label) {
    return new Promise((resolve) => {
        if (V3.on) present3d(performance.now(), false, true); else presentNow();   // frisch zeichnen, dann sofort abgreifen
        const out = document.createElement('canvas');
        out.width = canvas.width; out.height = canvas.height;
        const c2 = out.getContext('2d');
        c2.drawImage(canvas, 0, 0);
        if (label) {
            const fs = Math.max(12, Math.round(out.height / 70));
            c2.font = `600 ${fs}px system-ui, sans-serif`;
            c2.fillStyle = 'rgba(255,255,255,0.75)';
            c2.shadowColor = 'rgba(0,0,0,0.6)'; c2.shadowBlur = fs / 2;
            c2.fillText(`Fraktal-Explorer · ${t(MODE_KEYS[S.formula])} · ${fmtZoom(S.cam.zoom, 'sci')}`, fs, out.height - fs);
        }
        out.toBlob((b) => resolve({ blob: b, W: out.width, H: out.height, ms: 0, bytes: b ? b.size : 0, kind: 'buddha', tiles: 1 }), 'image/png');
    });
}
// Screenshot in der eingestellten Auflösung (Kachel-Rendern, js/capture.js). opts: { onProgress, W, H, tile, stream, label }
// -> Promise { blob, W, H, ms, bytes, … }; Abbruch: shotCancel() (reject 'cancelled'), Kontextverlust: reject 'lost'
function captureShot(opts) {
    opts = opts || {};
    if (M_Capture.kindNow() === 'buddha') return screenBlob(opts.label === undefined ? S.shotLabel : opts.label);
    return M_Capture.start(opts);
}
function captureBlob(opts) { return captureShot(opts).then(r => r.blob); }
// 6.5: frisches Bild zeichnen (2D oder 3D) – danach ist der Canvas im selben Task lesbar (Überblendung, Schnappschuss)
function freshFrame() { if (isBulb()) BULB.redraw(); else if (V3.on) present3d(performance.now(), false, true); else presentNow(); }
function fileName(W, H) { return `Fraktal_${MODE_KEYS[S.formula]}_${S.cam.zoom.toExponential(1).replace('+', '')}${W ? `_${W}x${H}` : ''}_${Date.now()}.png`; }

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
    get RESIZE_HOLD() { return RESIZE_HOLD; },
    get RESIZE_GOV_HOLD() { return RESIZE_GOV_HOLD; },
    get FADE_MS() { return FADE_MS; },
    get MAXL() { return MAXL; },
    get MAXL3() { return MAXL3; },
    get V3() { return V3; },
    get canvas() { return canvas; },
    get deActive() { return deActive; },
    get deMaskOn() { return deMaskOn; },
    get stActive() { return stActive; },
    get cformula() { return cformula; },
    get xparams() { return xparams; },
    get xsig() { return xsig; },
    get isExo() { return isExo; },
    get styleJob() { return styleJob; },
    get smooth01() { return smooth01; },
    get viewKey() { return viewKey; },
    get GOV() { return GOV; },
    get MODE_HOME() { return MODE_HOME; },
    get homeZoom() { return homeZoom; },
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
    get INERTIA_TAU() { return INERTIA_TAU; },
    get anchoredCam() { return anchoredCam; },
    get animating() { return animating; },
    get checkInside() { return checkInside; },
    get contentSig() { return contentSig; },
    get coverage() { return coverage; },
    get cpuFeed() { return cpuFeed; },
    get cpuPool() { return cpuPool; },
    get ensureRef() { return ensureRef; },
    get inertia() { return inertia; }, set inertia(v) { inertia = v; },
    get jobFailed() { return jobFailed; },
    get jobProgress() { return jobProgress; },
    get layerK() { return layerK; },
    get layerRect() { return layerRect; },
    get makeFrame() { return makeFrame; },
    get maxIterFor() { return maxIterFor; },
    get orderLayers() { return orderLayers; },
    get plan() { return plan; },
    get predictCam() { return predictCam; },
    get refUsable() { return refUsable; },
    get requestRefFor() { return requestRefFor; },
    get startFix() { return startFix; },
    // 6.8.1 Screenshot (js/capture.js)
    get forceCPU() { return forceCPU; },
    get gpuPerturbOK() { return gpuPerturbOK; },
    get DIRECT_MAX() { return DIRECT_MAX; },
    get GPU_MAX() { return GPU_MAX; },
    get NEWTON_GPU_MAX() { return NEWTON_GPU_MAX; },
    get cpuWorkers() { return cpuWorkers; },
    get requestBLA() { return requestBLA; },
    get view3d() { return view3d; },
    get layers3d() { return layers3d; },
    get aaFrames() { return aaFrames; },
    get pauseFly() { return pauseFly; },
    get fmtZoom() { return fmtZoom; },
    get MODE_KEYS() { return MODE_KEYS; },
    get WP_DEF() { return WP_DEF; },
    get WORLD_PAL() { return WORLD_PAL; },
    get applyPlaceWP() { return applyPlaceWP; },
    get invalidate() { return invalidate; },
    get isDone() { return isDone; },
    get BULB() { return BULB; },
    get isRay() { return isRay; },
    get stopFly() { return stopFly; },
    get setFlySpeed() { return setFlySpeed; },
    get RM() { return RM; },
};
const M_UrlState = self.FKUrlState.create(CTX);
const { readURL, setColParam, outParam, styleParam, wpParam, applyWpParam, stateURL, syncURL } = M_UrlState;
const M_CpuPool = self.FKCpuPool.create(CTX);
const { cancelFix, cpuBroadcast, cpuFeed, cpuPool, cpuSendRef, cpuWorkers, recompute, startFix } = M_CpuPool;
const M_Refs = self.FKRefs.create(CTX);
const { REF, ensureRef, refUsable, requestRefFor, requestBLA } = M_Refs;
const M_Layers = self.FKLayers.create(CTX);
const { addLayer, contentSig, coverage, layerFade, layerK, layerRect, makeFrame, orderLayers, pruneLayers } = M_Layers;
const M_Flight = self.FKFlight.create(CTX);
const { FLY, FLY2D, RUECK, canFly, canFly2d, flyPanned, flyStep, flyUpdate, north3d, pauseFly, reverseFly, setFlySpeed, startFly, stopFly, trailAt, turnFly, clearance } = M_Flight;
const M_Scheduler = self.FKScheduler.create(CTX);
const { governorUpdate, schedule } = M_Scheduler;
const M_Capture = self.FKCapture.create(CTX);
const shotStep = (now) => M_Capture.step(now);
const BULB = self.FKBulb.create(CTX);          // 7.0 Mandelbulb (js/bulb.js)
const isBulb = () => isRay();
// MODULE_LINK
// Module verknüpfen
M_Scheduler.link();
M_Flight.link();
M_Layers.link();
M_Refs.link();
M_CpuPool.link();
M_UrlState.link();
M_Capture.link();
BULB.link();

// fertiges Bild der aktuellen Ansicht (exakt, nichts rechnet, nichts blendet ein) – wie status().done
function isDone() { const f = RC.front, now = performance.now(); return !!f && f.key === viewKey() && f.stage === 1 && !!f.fixed && !RC.job && !RC.fix && !isFading(now); }
// Öffentliche API für ui.js + E2E-Tests (window.__fraktal)
const API = {
    APP_VERSION, S, R, RC, REF, stats, HP, PAL, MODE_KEYS, MAX_ZOOM, MODE_HOME, DIRECT_MAX, GPU_MAX, deActive, aaFrames, stActive,
    MODE_GROUPS, WP_DEF, cformula, xparams, setWP, styleOK, hasSetW, is2dW, maxZoom, lyaSeq, mexpNow, SIGHTS, startRound, stopRound, ROUND,
    t, fmtZoom, fmtC, toast, on: (f) => listeners.push(f), emit, DEKO, RM, freshFrame,
    setMode, setJulia, changeIter, setIterAuto, currentMaxIter, autoIter, flyTo, startTour, setCam, stopAnims,
    invalidate, resize, noteResize, saveSettings, plan, stateURL, captureBlob, captureShot, fileName, zoomAt, presentNow,
    shot: { plan: (o) => M_Capture.plan(o), size: (o) => M_Capture.shotSize(o), cancel: () => M_Capture.cancel(), busy: () => M_Capture.busy(), supports: (r) => M_Capture.supports(r), kind: () => M_Capture.kindNow(), devSize: () => M_Capture.devSize() },
    V3, FLY, GOV, set3d, can3d, startFly, stopFly, pauseFly, north3d, MAX_TILT, look, T3, FLY2D, canFly, canFly2d, TECH,
    RUECK, reverseFly, setFlySpeed, turnFly, trailAt, tapHook: null, dblTapHook: null, clearance,
    BULB, isRay,
    // Test (6.8): Schärfe an Bodenpunkten (lokal, Bildhälften um die Bildmitte/den Fokus): bestes Pufferpixel je Bildschirmpixel
    // einer gültigen Ebene, 0 = Lücke (kein Bild) – für „Nachladen hinter der Kamera“
    coverAt(pts) {
        const now = performance.now(), sig = contentSig(), u = 1.5 / S.cam.zoom, sPx = 3 / (S.cam.zoom * canvas.height);
        const L = orderLayers(now, S.cam).filter(l => l.sig === sig);
        return pts.map(([x, y]) => {
            let best = 0;
            for (const l of L) {
                const px = HP.toNumber(S.cam.cx - l.view.cx) / l.scale + x * u / l.scale, py = HP.toNumber(S.cam.cy - l.view.cy) / l.scale + y * u / l.scale;
                if (Math.abs(px) <= l.buf.w / 2 && Math.abs(py) <= l.buf.h / 2) best = Math.max(best, sPx / l.scale);
            }
            return +best.toFixed(3);
        });
    },
    // 3D-Shader beim Antippen des 3D-Knopfs vorab übersetzen (Treiber parallel, bis zum Loslassen ~100 ms Vorsprung).
    // Nicht automatisch im Leerlauf: dann warteten 2D-Shader/-Rechnungen hinter den großen 3D-Shadern (gemessen).
    // 6.3: nur die Programme des aktuellen Looks, nicht blockierend (T3.ready pollt danach pro Bild)
    prewarm3d() { if (T3 && !V3.on) { T3.setStage(S.quality); T3.prewarm(look()); } },
    layers3dInfo() { const now = performance.now(); return layers3d(orderLayers(now, S.cam)).map(l => ({ stage: l.stage, scale: l.scale / (3 / (S.cam.zoom * canvas.height)), alpha: +l.alpha.toFixed(2), w: l.buf.w, h: l.buf.h, h3d: !!l.h3d, out: !!l.outT, front: l === RC.front })); },
    // Test (6.3, tests/compare_3d_shader.py): Ebenen, Ansicht und Look des aktuellen 3D-Bilds – zum Zeichnen mit einer
    // zweiten 3D-Instanz (alter Shader) auf exakt denselben Daten
    args3d() { return { L3: layers3d(orderLayers(performance.now(), S.cam)), v: view3d(), lk: look(), o: { de: [0.25, 1.25] } }; },
    view3dInfo() { return { on: V3.on, prep: !!V3.prep, prepInfo: T3 ? T3.prep || null : null, mix: V3.mix, tilt: V3.tilt, heading: V3.heading, L: V3.L, fly: { on: FLY.on, paused: FLY.paused, mode: FLY.mode, d3: FLY.d3 }, gpu: T3 ? T3.info() : null }; },
    // still = true: Bilder der Stillstands-Mittelung (volle Auflösung) statt Bewegungsbilder
    bench3d(n = 5, still = false) {
        const gl = R.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext || !V3.on) return Promise.resolve(null);
        const qs = [];
        const L3 = layers3d(orderLayers(performance.now(), S.cam)), v = view3d(), lk = look();
        T3.benchBusy = true;      // 6.7: keine eigene Gitter-Messung (Timer-Queries lassen sich nicht schachteln)
        for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            T3.render(L3, v, lk, undefined, { de: [0.25, 1.25], still: still ? { n: i, N: 8, mix2: 0 } : null });
            gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
        T3.benchBusy = false;
        V3.accKey = null;
        return new Promise((res) => { const poll = () => { if (!qs.every(q => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) { setTimeout(poll, 20); return; }
            const ms = qs.map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); qs.forEach(q => gl.deleteQuery(q)); res({ min: +Math.min(...ms).toFixed(2), max: +Math.max(...ms).toFixed(2), scale: T3.scale }); }; poll(); });
    },
    goHome() { if (isBulb()) { stopFly(); BULB.goHome(); return; } const h = MODE_HOME[S.formula]; S.iterManual = false; flyTo(HP.fromString(h[0]), HP.fromString(h[1]), homeZoom(S.formula)); emit('iter'); },
    goTo(p) {
        if ((p.formula || 0) !== S.formula) setMode(p.formula || 0, true);
        applyPlaceWP(p);
        if (isRay(p.formula)) { if (p.b) BULB.tourTo(p.b, 1.2); return; }
        if (p.jx) setJulia(HP.fromString(p.jx), HP.fromString(p.jy));
        S.iterManual = !!p.iter; if (p.iter) S.iterValue = p.iter;
        flyTo(HP.fromString(p.cx), HP.fromString(p.cy), +p.zoom);
        emit('iter');
    },
    viewState() {
        const d = HP.digitsForZoom(S.cam.zoom);
        return { cx: HP.toString(S.cam.cx, d), cy: HP.toString(S.cam.cy, d), zoom: S.cam.zoom, formula: S.formula,
                 jx: S.formula === 1 ? HP.toString(S.julia.x, 12) : undefined, jy: S.formula === 1 ? HP.toString(S.julia.y, 12) : undefined,
                 iter: S.iterManual ? S.iterValue : undefined, palette: PAL.list[S.palette].id, setCol: setColParam() || undefined, alpine: S.alpine ? S.valley : undefined, out: outParam() || undefined, style: styleParam() || undefined,
                 b: isBulb() ? BULB.stateString() : undefined, wp: WP_DEF[S.formula] ? Object.assign({}, S.wp[S.formula]) : undefined };
    },
    isMoving: () => isMoving(performance.now()),
    // Test (6.5.2): Grafik-Wächter – '' | 'wait' | 'lost' | 'stuck', erstes Bild gezeichnet?
    gpuGuard: () => ({ kind: GW.kind, firstPic: GW.firstPic, simple: !!SIMPLE, lost: !!R.lost }),
    // Test/Messung: aktuelles Bild frisch auf den Canvas (2D: Display-Pass; 3D: gemitteltes Bild bzw. neu zeichnen)
    snapshot() { if (isBulb()) BULB.redraw(); else if (V3.on) present3d(performance.now(), false, true); else presentNow(); },
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
            const job = { key: 'bench', stage: d, kind: 'gpu', mode: p.mode, formula: cformula(), maxIter: currentMaxIter(), view: { cx: S.cam.cx, cy: S.cam.cy, zoom: S.cam.zoom },
                          w, h, scale: 3 / (S.cam.zoom * canvas.height) * d, julia: [HP.toNumber(S.julia.x), HP.toNumber(S.julia.y)], err: d === 1 && S.precise, de: deActive(), X: xparams(cformula()) };
            styleJob(job);
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
            const job = { key: 'bench', stage: d, kind: 'gpu', mode: p.mode, formula: cformula(), maxIter: currentMaxIter(), view: { cx: S.cam.cx, cy: S.cam.cy, zoom: S.cam.zoom },
                          w, h, scale: 3 / (S.cam.zoom * canvas.height) * d, julia: [HP.toNumber(S.julia.x), HP.toNumber(S.julia.y)], err: d === 1 && S.precise, de: de === undefined ? deActive() : !!de, X: xparams(cformula()) };
            styleJob(job);
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
                 jsMs: stats.jsMs, jsMax: stats.jsMax, capturing: !!RC.cap, vsync: RC.vsync, dtEMA: RC.dtEMA, chunk: R.chunkInfo(), lastFullMs: stats.lastFullMs, lastJobMs: stats.lastJobMs, fps: stats.fps, useBLA: f ? f.useBLA : null, kind: f ? f.kind : null, previewDiv: RC.previewDiv,
                 canvas: [canvas.width, canvas.height], maxIter: currentMaxIter(), gpuPerturbOK };
    },
    setView(cx, cy, zoom) { stopAnims(); setCam(HP.fromString(cx), HP.fromString(cy), zoom); },
    // Test (6.8.1): Planer anhalten (keine neuen Ebenen, nichts wird verworfen) – Vergleichsbilder auf demselben Ebenen-Stapel
    freeze(on) { RC.freeze = !!on; },
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
    // Test (7.1): Stil-Werte (16 bit, G/B des DE-Ziels) des fertigen Bildes, Zeile 0 = unten; null ohne Stil-Kanal
    readFrontAcc() { const f = RC.front; if (!f || !f.buf.acc) return null; const u = R.readDESync(f.buf, true); const out = new Array(f.buf.w * f.buf.h); for (let i = 0; i < out.length; i++) out[i] = u[4 * i + 1] * 256 + u[4 * i + 2]; return { w: f.buf.w, h: f.buf.h, data: out, kind: f.kind }; },
};
self.__fraktal = API;
init();
})();
