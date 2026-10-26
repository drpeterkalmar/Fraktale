#!/usr/bin/env node
// 7.4.2 Start am Rand – Messung ohne Browser: der echte Zufallsstart (js/zufall.js rollPlan + applyPlan mit Kundschafter, Tour-Orten,
// Startansicht und der neuen Randzentrierung edgeCenter) für die 2D-Welten, je Welt N Starts mit festem Zufall (?seed wie im Test),
// einmal mit ?randstart=0 (= 7.4.1) und einmal neu. Welt-Daten (SIGHTS, WP_DEF, MODE_HOME, Rechen-Formel, Welt-Parameter) kommen
// aus js/app.js (Quelltext ausgeschnitten), gerechnet wird mit js/fractal-core.js (wie die CPU-Sonde der App).
// Je Start: Rand in der Bildmitte (Ausschnitt ±0,04 Bildhälften enthält Innen und Außen bzw. zwei Einzugsgebiete bzw. einen Sprung
// > 0,6 im log-Iterationswert), Bildanteil innen (schwarz), „leer“ (judgeGrid: kaum Struktur), Rechenzeit des Würfelns (ms).
// Aufruf: node tests/sim_randstart.js [N=50] [Welten, z. B. 0,1,2]   -> tests/results_randstart.json (bzw. _<Welten>.json)
'use strict';
const path = require('path'), fs = require('fs');
globalThis.self = globalThis;
require(path.join(__dirname, '../js/hp.js'));
require(path.join(__dirname, '../js/fractal-core.js'));
require(path.join(__dirname, '../js/zufall.js'));
const HP = globalThis.FKHP;

const SRC = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const cut = (start, end) => { const i = SRC.indexOf(start); const j = SRC.indexOf(end, i); if (i < 0 || j < 0) throw new Error('app.js: ' + start); return SRC.slice(i, j + end.length); };
// Welt-Daten aus app.js (Literal-Blöcke)
const DATA = new Function('self', [
    cut('const MODE_KEYS =', ';\n'), cut('const MODE_HOME =', ']];\n'), cut('const WP_DEF = {', '\n};\n'), cut('const SIGHTS = {', '\n};\n'),
    'return { MODE_KEYS, MODE_HOME, WP_DEF, SIGHTS };'].join('\n'))(globalThis);
for (const f in DATA.SIGHTS) for (const s of DATA.SIGHTS[f]) { s.formula = +f; s.key = 'sight_' + s.k; }
const MAIN = require.main === module;
let N = +(MAIN && process.argv[2] || 50);
const WORLDS = (MAIN && process.argv[3] || '0,1,2,3,4,5,10,11,12,13').split(',').map(Number);
const RAY = [6, 8, 9, 16, 17, 18], DENS_W = [14, 15];

function makeCtx(q) {
    const S = { formula: 0, cam: { cx: 0n, cy: 0n, zoom: 1 }, julia: { x: 0n, y: 0n }, wp: {}, flySpeed: 0.3, palette: 0, iterManual: false, startWorld: 'flug', bulbFly: {}, wpal: {} };
    for (const f in DATA.WP_DEF) S.wp[f] = Object.assign({}, DATA.WP_DEF[f]);
    const cssW = 412, cssH = 915;
    const homeOf = (f) => { const h = DATA.MODE_HOME[f]; return [h[0], h[1], h[3] ? 3 / Math.max(h[3][1], h[3][0] * cssH / cssW) : h[2]]; };
    const lyaSeq = (s) => { s = String(s || 'AB').toUpperCase().replace(/[^AB]/g, '').slice(0, 24) || 'AB'; let bits = 0; for (let i = 0; i < s.length; i++) if (s[i] === 'B') bits |= 1 << i; return { s, bits, len: s.length }; };
    const cformula = (f) => { f = f === undefined ? S.formula : f; const w = S.wp[f] || {};
        switch (f) { case 2: return [2, 20, 21, 22][w.v | 0] || 2; case 4: { const e = +w.e || 3; return w.m ? 23 : e === 3 ? 4 : e === 2 ? 0 : 23; } case 10: return 28; case 11: return 24; case 12: return 25; case 13: return w.v ? 27 : 26; }
        return f; };
    const xparams = (cf) => { const w = S.wp[S.formula] || {};
        if (cf === 5) return { poly: self.FKCore.newtonPoly((S.wp[5] || {}).p | 0) };
        if (cf === 23) return { xp: [Math.max(2, Math.min(8, +(S.wp[4] || {}).e || 3)), 0, 0, 0] };
        if (cf === 24) return { xp: [+w.cr, +w.ci, +w.pr, +w.pi], xq: [w.v ? 1 : 0, 0, 0, 0] };
        if (cf === 25) return { xp: [+w.r || 1, +w.cr, +w.ci, w.v ? 1 : 0] };
        if (cf === 28) { const qq = lyaSeq(w.s); return { xp: [8, 0, 0, 0], xi: [qq.bits, qq.len, 100, 0] }; }
        return null; };
    const ctx = {
        HP, Q: new URLSearchParams(q), S, START: {}, PAL: { list: [{ id: 'p0' }, { id: 'p1' }], indexOf: () => 0 },
        MODE_KEYS: DATA.MODE_KEYS, SIGHTS: DATA.SIGHTS, WP_DEF: DATA.WP_DEF, RAY, DENS_W, cssW, cssH,
        heavyOK: () => true, hasSetW: (f) => f < 5 || (f >= 10 && f <= 13), styleOK: () => false, isRay: (f) => RAY.includes(f), isDens: (f) => DENS_W.includes(f),
        is2dW: (f) => !RAY.includes(f) && f !== 7 && f !== 14 && f !== 15, homeOf, cformula, xparams,
        autoIter: (z) => { const l = Math.log10(z + 1); return Math.min(30000, Math.max(300, Math.floor(l * l * 50))); },
        setMode(m) { S.formula = m; const h = homeOf(m); ctx.setCam(HP.fromString(h[0]), HP.fromString(h[1]), h[2]); },
        setCam(cx, cy, zoom) { S.cam = { cx, cy, zoom }; },
        setJulia(x, y) { S.julia = { x, y }; },
        applyPlaceWP(p) { if (p && p.wp && DATA.WP_DEF[p.formula || 0]) S.wp[p.formula || 0] = Object.assign({}, DATA.WP_DEF[p.formula || 0], p.wp); },
        invalidate() {}, emit() {}, palKey: () => 'c',
    };
    const Z = globalThis.FKZufall.create(ctx);
    Z.link();
    return { ctx, Z, S };
}

function runWorld(w, q) {
    const out = [];
    for (let i = 0; i < N; i++) {
        const { Z, S, ctx } = makeCtx(q);
        const r = Z.rng(1000 + 7919 * i + w);
        const t0 = process.hrtime.bigint();
        // (begin() braucht das DOM – hier derselbe Weg ohne: würfeln + anwenden; ?randstart=0: einmal wie bis 7.4.1)
        const { P, info } = q === 'randstart=0' ? (() => { const P = Z.rollPlan(r, { world: w, seeded: true }); return { P, info: Z.applyPlanTest(P) }; })() : Z.rollApply(r, { world: w, seeded: true });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const cx = HP.toNumber(S.cam.cx), cy = HP.toNumber(S.cam.cy), z = S.cam.zoom;
        const onEdge = Z.centerOnEdge(cx, cy, z, S.formula);
        const j = Z.judgeGrid(Z.probeGrid(cx, cy, z, 48, Math.round(48 * ctx.cssH / ctx.cssW), S.formula));
        out.push({ place: P.place.kind, sight: info.sight, z: +z.toPrecision(3), onEdge, inside: j.inside, why: j.why, detail: j.detail, ms: +ms.toFixed(1), edge: info.edge || null });
    }
    const n = out.length, f = (g) => +(out.filter(g).length / n).toFixed(3), m = (k) => +(out.reduce((s, r) => s + r[k], 0) / n).toFixed(3);
    return { world: w, key: DATA.MODE_KEYS[w], n, onEdge: f(r => r.onEdge), insideMean: m('inside'), insideOver50: f(r => r.inside > 0.5), leer: f(r => r.why === 'leer'),
             msMean: m('ms'), msMax: Math.max(...out.map(r => r.ms)), places: out.reduce((o, r) => (o[r.place] = (o[r.place] || 0) + 1, o), {}), runs: out };
}

module.exports = { runWorld: (w, q, n) => { if (n) N = n; return runWorld(w, q); } };
if (MAIN) {
const res = { N, alt: [], neu: [] };
for (const w of WORLDS) {
    const a = runWorld(w, 'randstart=0'), b = runWorld(w, '');
    res.alt.push(a); res.neu.push(b);
    console.log(`${String(w).padStart(2)} ${a.key.padEnd(13)} Rand in der Mitte ${(a.onEdge * 100).toFixed(0).padStart(3)} % -> ${(b.onEdge * 100).toFixed(0).padStart(3)} % | innen Ø ${(a.insideMean * 100).toFixed(1)} -> ${(b.insideMean * 100).toFixed(1)} % | leer ${(a.leer * 100).toFixed(0)} -> ${(b.leer * 100).toFixed(0)} % | Zeit Ø ${a.msMean} -> ${b.msMean} ms (max ${a.msMax} -> ${b.msMax})`);
}
const tag = process.argv[3] ? '_' + WORLDS.join('-') : '';
fs.writeFileSync(path.join(__dirname, `results_randstart${tag}.json`), JSON.stringify(res, (k, v) => k === 'runs' ? v.map(r => [r.place, r.sight, r.z, r.onEdge, r.inside, r.why, r.ms, r.edge && r.edge.moved]) : v, 0));
}
