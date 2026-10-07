// 6.7: js/three.js (3D-Landschaft) gegen einen nachgebildeten WebGL2-Kontext – ohne Browser. Prüft den JS-Ablauf von
// create/ready/warm/render/present/freeStill/reset mit allen Reglern (TAA, Bloom, CAS, AO, Detail, GPU-Gitterwahl) auf
// Laufzeitfehler und auf Rückkopplungen (eine Textur, die das aktuelle Ziel ist, liegt auf einer Sampler-Einheit des
// Programms – WebGL bricht das Zeichnen dann mit INVALID_OPERATION ab). Bild und Shader-Übersetzung prüft das NICHT.
'use strict';
require('../../js/hp.js');
require('../../js/shaders.js');
require('../../js/three-tech.js');
require('../../js/three.js');

const { fakeGL, fakeR } = require('./webgl-mock.js');

globalThis.screen = { width: 412, height: 915 };
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };

const look = { formula: 0, maxIter: 300, pal: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.33, 0.67] }, cycle: 0, density: 1, banded: false,
               setCol: [0, 0, 0], alpine: 0, inner: false, custom: [] };
const layer = (gl) => ({ buf: { w: 96, h: 96, tex: gl.createTexture(), de: null }, scale: 0.0005, view: { cx: 0n, cy: 0n }, alpha: 1, formula: 0, maxIter: 300, seq: 1 });
const view = (k) => ({ tilt: 0.7, heading: 0.01 * k, height: 0.66, mix: 1, focus: { cx: BigInt(k) << 1060n, cy: 0n }, u: 0.003 * Math.pow(0.99, k), L: [4, 9], time: k * 0.016, deko: 1, ctime: 0 });

function start(T, lk) { for (let i = 0; i < 40 && !(T.ready(lk) && T.warm(lk)); i++); }

test('3D-Ablauf mit TAA, Bloom, CAS, AO, Detail, Gitterwahl: keine Fehler, keine Rückkopplung', () => {
    const { gl, st } = fakeGL(), R = fakeR(gl);
    const T = FK3D.create(R, FK3DTech.flags(new URLSearchParams('taa=1')));
    for (const q of ['eco', 'balanced', 'max']) {
        T.setStage(q);
        start(T, look);
        const L = [layer(gl)];
        for (let k = 0; k < 12; k++) T.render(L, view(k), look);                 // Bewegungsbilder (Flug)
        const i1 = T.info();
        assert.equal(i1.taaReset, false, 'TAA nutzt die History des vorigen Bilds');
        assert.ok(i1.taa && i1.taa[0] > 0);
        assert.equal(i1.bloom, q !== 'eco', 'Bloom je Stufe');
        for (let n = 0; n < 8; n++) T.render(L, view(12), look, undefined, { still: { n, N: 8, mix2: n < 3 ? 0.5 : 0, scale: 1 } });
        T.present();
        T.render(L, view(13), look);                                              // wieder Bewegung: History verworfen
        assert.equal(T.info().taaReset, true, 'nach Stillstands-Bildern beginnt TAA neu');
        T.freeStill();
        T.render(L, view(14), look, 0.5);                                         // Übergang (alpha < 1)
    }
    assert.deepEqual(st.problems, []);
    for (const k of ['t3sky', 't3terr', 't3taa', 't3bloom', 't3blit']) assert.ok(st.draws.includes(k), 'gezeichnet: ' + k);
    // Gitterwahl: Gelände-Pass gemessen (4,2 ms je Bild), Ergebnis gespeichert, Teiler aus Budget
    const g = T.gridInfo();
    assert.equal(g.state, 'done');
    assert.ok(g.entry && g.entry.ms === 4.2 && g.entry.d0 === 8);
    assert.ok(JSON.parse(mem[FK3DTech.GRID_LS])[g.key]);
    T.setStage('balanced'); T.applyGrid();
    assert.equal(T.gridDiv, FK3DTech.gridDivFromGpu(4.2, 8, FK3DTech.STAGES.balanced.grid));
    // Kontextverlust: alles vergessen, danach wieder zeichnen
    T.reset(); start(T, look); T.render([layer(gl)], view(20), look);
    assert.deepEqual(st.problems, []);
});

test('Alle Regler aus (?tone=0 ?hao=0 ?detail=0 ?gpuwahl=0 ?scharf=0): Ablauf wie 6.6, Teiler nach Bildschirm', () => {
    const { gl, st } = fakeGL(), R = fakeR(gl);
    const T = FK3D.create(R, FK3DTech.flags(new URLSearchParams('tone=0&hao=0&detail=0&gpuwahl=0&scharf=0')));
    T.setStage('balanced'); start(T, look);
    const L = [layer(gl)];
    for (let k = 0; k < 8; k++) T.render(L, view(k), look);
    for (let n = 0; n < 4; n++) T.render(L, view(8), look, undefined, { still: { n, N: 4, mix2: 0, scale: 1 } });
    assert.deepEqual(st.problems, []);
    assert.ok(!st.draws.includes('t3taa') && !st.draws.includes('t3bloom'));
    assert.equal(T.gridDiv, 8); assert.equal(T.gridInfo().state, 'off');
    assert.equal(st.queries, 0, 'keine Timer-Queries');
    // Gelände-Variante ohne Rauschtextur (wie 6.6) – Detail aus
    assert.ok(!Object.keys(R.progs).includes('t3noise'));
});

test('Shader-Rückfälle: TAA/Bloom defekt -> nur aus; Gelände mit AO/Detail defekt -> Variante wie 6.6', () => {
    const { gl, st } = fakeGL();
    const R1 = fakeR(gl, { fail: ['t3taa', 't3bloom'] });
    const T1 = FK3D.create(R1, FK3DTech.flags(new URLSearchParams('taa=1')));
    T1.setStage('balanced'); start(T1, look);
    assert.ok(T1.ready(look), 'bereit ohne TAA/Bloom');
    assert.equal(T1.failed, null);
    assert.equal(T1.flags.taa, false); assert.equal(T1.flags.bloom, false);
    T1.render([layer(gl)], view(1), look); T1.render([layer(gl)], view(2), look);
    const R2 = fakeR(gl, { fail: ['t3terr'] });
    const T2 = FK3D.create(R2, FK3DTech.flags(new URLSearchParams('')));
    T2.setStage('max'); start(T2, look);
    assert.ok(T2.ready(look)); assert.equal(T2.failed, null);
    assert.equal(T2.info().fallback, '_66');
    assert.equal(T2.stage.aoN, 0); assert.equal(T2.stage.det, 0);
    T2.render([layer(gl)], view(1), look);
    assert.equal(T2.variant, 't3terr_66');
    // ohne Rückfall-Möglichkeit (schon ohne AO/Detail) bleibt es beim Abschalten von 3D wie bisher
    const R3 = fakeR(gl, { fail: ['t3terr'] });
    const T3 = FK3D.create(R3, FK3DTech.flags(new URLSearchParams('hao=0&detail=0')));
    T3.ready(look);
    assert.equal(T3.failed, 't3terr');
    assert.deepEqual(st.problems, []);
});
