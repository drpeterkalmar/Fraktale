#!/usr/bin/env node
// 7.4 Schweben am Rand – Messung ohne Browser: der echte 2D-Flug aus js/flight.js (flyUpdate, lavaStep, edgeWalk, flyStep,
// flyMetrics) fliegt mit nachgebildeter Umgebung. Die Sonde (sonst three.js T3.probe aus den Ebenen) rechnet hier der
// Prozessor: 48×48 Stichproben im Fenster ±1,05 Bildhälften, Distanzschätzung |z| ln|z| / |dz/dc| des Mandelbrots, kodiert wie
// im Shader (1/16-log2-Stufen, innen 0, weiter als ~0,8 Bildhälften = 4). Die Schärfe ist fest grob (GOV.lq = 0,3) – die
// Lavalampe läuft so fast nur Bremsen → Schweben → Herauszoomen → Warten → … (genau die Phasen, um die es geht).
// Gemessen je Sonde in diesen Phasen (Drift eingeblendet, dw > 0,5): Abstand der Bildmitte (dF) und des Zoompunkts (dA) zur Menge
// in Bildhälften, Anteil im Rand-Korridor (0 < d ≤ 0,12 = 3 × FLY_DE; dazu ≤ 0,3 wie measure_fly „Rand im mittleren Drittel“),
// Bildanteil innen (schwarz) und leer (Abstand > 1 Bildhälfte), Richtungswechsel der Drift (> 90° in 2 s).
// Aufruf: node tests/sim_schweben.js [alt|neu] [Sekunden je Ort, Standard 60]   -> tests/results_schweben_<alt|neu>.json
'use strict';
const path = require('path'), fs = require('fs');
globalThis.self = globalThis;
require(path.join(__dirname, '../js/hp.js'));
require(path.join(__dirname, '../js/flight.js'));
const HP = globalThis.FKHP;

const MAIN = require.main === module;
let VAR = MAIN && process.argv[2] || 'neu', SECS = +(MAIN && process.argv[3] || 60);
const PLACES = [
    { name: 'Seepferdchental 10³', x: -0.743643887037151, y: 0.13182590420533, z: 1e3 },
    { name: 'Seepferdchental 10⁵', x: -0.743643887037151, y: 0.13182590420533, z: 1e5 },
    { name: 'Elefantental 10³', x: 0.2925755, y: -0.0149977, z: 1e3 },
    { name: 'Spirale 10⁴', x: -0.7746806106269039, y: -0.1374168856037867, z: 1e4 },
    { name: 'Kardioide 30×', x: -0.7487, y: 0.0647, z: 30 },
    { name: 'Antenne 10³', x: -1.7687788, y: 0.0017389, z: 1e3 },
];

// fester Zufall (Startrichtung, Roll-Phasen)
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

function deWorld(cx, cy, maxIter) {
    let x = 0, y = 0, dx = 0, dy = 0;
    for (let n = 0; n < maxIter; n++) {
        const ndx = 2 * (x * dx - y * dy) + 1, ndy = 2 * (x * dy + y * dx);
        const nx = x * x - y * y + cx, ny = 2 * x * y + cy;
        x = nx; y = ny; dx = ndx; dy = ndy;
        const r2 = x * x + y * y;
        if (r2 > 1e10) { const r = Math.sqrt(r2); return { d: r * Math.log(r) / Math.hypot(dx, dy), mu: n + 1 - Math.log2(Math.log(r)) }; }
    }
    return { d: 0, mu: -1 };
}
const PW = 48, PH = 48, WIN = 1.05;
function probe(cam) {
    const z = cam.zoom, u = 1.5 / z, cx = HP.toNumber(cam.cx), cy = HP.toNumber(cam.cy);
    const maxIter = Math.min(4000, Math.round(300 + 450 * Math.log10(Math.max(1, z))));
    const data = new Float32Array(PW * PH), de = new Float32Array(PW * PH);
    let nde = 0;
    for (let j = 0; j < PH; j++) for (let i = 0; i < PW; i++) {
        const px = ((i + 0.5) / PW * 2 - 1) * WIN, py = ((j + 0.5) / PH * 2 - 1) * WIN;
        const r = deWorld(cx + px * u, cy + py * u, maxIter), k = j * PW + i;
        if (r.mu < 0) { data[k] = -1; de[k] = 0; continue; }
        data[k] = r.mu;
        const dl = r.d / u;
        if (dl > 0.8) de[k] = 4;
        else { const code = Math.max(2, Math.min(254, Math.floor((Math.log2(dl) + 12) * 16 + 2))); de[k] = Math.pow(2, (code - 2) / 16 - 12); }
        nde++;
    }
    return { w: PW, h: PH, win: WIN, data, de, hasDE: nde > 0, cam };
}

function run(place, variant, secs) {
    if (variant) VAR = variant;
    if (secs) SECS = secs;
    seed = +(process.env.SIM_SEED || 12345);
    const mr = Math.random; Math.random = rnd;
    try { return run1(place); } finally { Math.random = mr; }
}
function run1(place) {
    const S = { cam: { cx: HP.fromNumber(place.x), cy: HP.fromNumber(place.y), zoom: place.z }, formula: 0, flySpeed: 0.3, lava: true, flyRoll: false };
    const V3 = { on: false, heading: 0, L: [4, 9], probe: null };
    const GOV = { g: 1, lq: 0.3, lqT: 0.3 };
    const ctx = {
        Q: new URLSearchParams('takt=0' + (VAR === 'alt' ? '&randschweb=0' : '') + (process.env.SIM_Q ? '&' + process.env.SIM_Q : '')), S, V3, GOV, HP, T3: {}, MODE_HOME: { 0: ['-0.5', '0', 1] },
        RC: { resizeT: -1e9, vsync: 16.7 }, plan: () => ({ kind: 'gpu', mode: 'perturb' }), cformula: () => 0, isExo: () => false, homeOf: () => ['-0.5', '0', 1], cssW: 412, cssH: 915, viewRot: () => 0,
        VR: { rot: 0 }, setViewRot() {}, clampZoom: (q) => Math.min(1e30, Math.max(0.2, q)), setCam(cx, cy, zoom) { S.cam = { cx, cy, zoom: ctx.clampZoom(zoom) }; },
        smooth01: (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x), emit() {}, toast() {}, t: (k) => k, isRay: () => false, isDens: () => false,
        can3d: () => false, look: () => ({}), ready3d: () => false, set3d() {}, setJulia() {}, setMode() {}, stopAnims() {},
    };
    const F = globalThis.FKFlight.create(ctx);
    F.link();
    const FLY = F.FLY;
    Object.assign(FLY, { on: true, paused: false, mode: 'random', d3: false, A: [0, 0], VA: [0, 0], T: null, Tt: 0, om: 0, roll: 0, user: 0, userBase: 0, userPrev: 0,
                         userT: -1e9, zf: 1, glide: null, dA: null, gap: false, lost: 0, trail: [], rec: [], recM: [], sp: 0.3, ramp: null, t0: 0, rampMs: 2000, ease: 0, kPrev: null });
    const dt = 1 / 30, steps = Math.round(SECS / dt);
    let pending = null, lastProbe = -1e9, th = [];
    for (let k = 0; k < steps; k++) {
        const now = k * dt * 1000;
        if (pending && now >= pending.at) { pending.pb.seq = (V3.probe ? V3.probe.seq : 0) + 1; V3.probe = pending.pb; pending = null; }
        if (!pending && now - lastProbe >= 150) { lastProbe = now; pending = { pb: probe(S.cam), at: now + 34 }; }     // Auslesen asynchron: ein Bild später
        F.flyUpdate(now, dt, false);
        if (FLY.lava && FLY.lava.dw > 0.5 && k % 3 === 0) th.push([now, FLY.lava.th]);
    }
    if (process.env.SIM_TRACE) for (let i = 0; i < FLY.recM.length; i += 10) { const q = FLY.recM[i]; console.log((q.t / 1000).toFixed(1), q.ph, q.dw, 'dF', q.dF, 'dA', q.dA, 'A', q.A, 'in', q.inFrac && q.inFrac.toFixed(2), 'z', q.z.toPrecision(3)); }
    const M = FLY.recM.filter(m => m.ph && m.ph !== 'cruise' && m.dw > 0.5);
    const inC = (d, hi) => d !== null && d > 0 && d <= hi;
    const frac = (f) => M.length ? +(M.filter(f).length / M.length).toFixed(3) : null;
    const mean = (f) => M.length ? +(M.reduce((s, m) => s + f(m), 0) / M.length).toFixed(3) : null;
    // Richtungswechsel der Drift: mehr als 90° innerhalb von 2 s
    let flips = 0;
    for (let i = 0, j = 0; i < th.length; i++) {
        while (th[i][0] - th[j][0] > 2000) j++;
        if (i > j && Math.abs(Math.atan2(Math.sin(th[i][1] - th[j][1]), Math.cos(th[i][1] - th[j][1]))) > Math.PI / 2) { flips++; j = i; }
    }
    const phases = {};
    for (const m of FLY.recM) phases[m.ph] = (phases[m.ph] || 0) + 1;
    return { place: place.name, variant: VAR, n: M.length, phases, centerIn012: frac(m => inC(m.dF, 0.12)), centerIn03: frac(m => inC(m.dF, 0.3)),
             zoomptIn012: frac(m => inC(m.dA, 0.12)), centerInside: frac(m => m.dF === 0), centerEmpty: frac(m => m.dF !== null && m.dF > 1),
             imgInside: mean(m => m.inFrac || 0), imgEmpty: mean(m => m.emptyFrac || 0), flips, z0: place.z, z1: +S.cam.zoom.toPrecision(3) };
}

module.exports = { run, PLACES };
if (MAIN) {
const t0 = Date.now(), out = [];
for (const p of PLACES.filter((q, i) => !process.env.SIM_ONLY || process.env.SIM_ONLY.split(',').includes(String(i)))) { const r = run(p); out.push(r); console.log(JSON.stringify(r)); }
const avg = (k) => +(out.reduce((s, r) => s + (r[k] || 0), 0) / out.length).toFixed(3);
const sum = { variant: VAR, secs: SECS, centerIn012: avg('centerIn012'), centerIn03: avg('centerIn03'), zoomptIn012: avg('zoomptIn012'), centerInside: avg('centerInside'),
              centerEmpty: avg('centerEmpty'), imgInside: avg('imgInside'), imgEmpty: avg('imgEmpty'), flips: avg('flips'), ms: Date.now() - t0 };
console.log('Mittel', JSON.stringify(sum));
fs.writeFileSync(path.join(__dirname, `results_schweben_${VAR}.json`), JSON.stringify({ sum, runs: out }, null, 1));
}
