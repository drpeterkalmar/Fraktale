// 6.7 Technik (js/three-tech.js): reine Funktionen der 3D-Landschaft – Regler, Stufen, Horizont-AO, Tonemapping, CAS,
// Gitterwahl aus der GPU-Zeit, TAA-Reprojektion. Die GLSL-Gegenstücke in js/three.js rechnen Zeile für Zeile dasselbe.
'use strict';
require('../../js/three-tech.js');
const X = self.FK3DTech;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const q = (s) => new URLSearchParams(s);

// ------------------------------------------------------------ Regler + Stufen
test('Regler: Standard alles an außer TAA; ?taa=1 ?scharf=0 ?tone=0|agx ?bloom=0 ?hao=0 ?detail=0 ?gpuwahl=0', () => {
    assert.deepEqual(X.flags(q('')), { taa: false, scharf: true, tone: 1, bloom: true, hao: true, detail: true, gpuwahl: true });
    assert.deepEqual(X.flags(q('taa=1&scharf=0&tone=agx&hao=0&detail=0&gpuwahl=0')), { taa: true, scharf: false, tone: 2, bloom: true, hao: false, detail: false, gpuwahl: false });
    const t0 = X.flags(q('tone=0'));
    assert.equal(t0.tone, 0); assert.equal(t0.bloom, false, 'ohne Tonemapping kein Bloom');
    assert.equal(X.flags(q('bloom=0')).bloom, false);
    assert.equal(X.flags(q('taa=0')).taa, false);
    assert.equal(X.flags(null).taa, false);
});

test('Stufen: Schatten 3/6/10 bei gleicher Reichweite, Ausgewogen = 6.6, Akku ohne Detail/Bloom', () => {
    const F = X.flags(q(''));
    const e = X.stage('eco', F), b = X.stage('balanced', F), m = X.stage('max', F);
    assert.deepEqual([e.shN, b.shN, m.shN], [3, 6, 10]);
    const range = 0.024 * Math.pow(1.95, 6);
    for (const s of [e, b, m]) assert.ok(near(X.shadowTs(s.shN, s.shR), range, 1e-12), 'Reichweite ' + s.shN);
    assert.equal(b.shR, 1); assert.equal(b.shK, 5);
    for (let i = 1; i <= 6; i++) assert.equal(X.shadowTs(i, 1), 0.024 * Math.pow(1.95, i));   // bit-gleich zur 6.6-Schleife
    assert.ok(m.shK < b.shK, 'Maximal: weicherer Halbschatten');
    assert.equal(e.det, 0); assert.equal(e.bloom, false); assert.ok(e.aoN <= 2);
    assert.equal(b.aoN, 4); assert.equal(b.aoS, 2);
    assert.ok(e.grid < b.grid && b.grid < m.grid, 'GPU-Budget steigt mit der Stufe');
    const off = X.stage('balanced', X.flags(q('hao=0&detail=0&bloom=0')));
    assert.equal(off.aoN, 0); assert.equal(off.det, 0); assert.equal(off.bloom, false);
    assert.deepEqual(X.stage('unbekannt', F).shN, 6);
});

// ------------------------------------------------------------ Horizont-AO
test('Horizont-AO: Ebene und gleichmäßiger Hang frei, Talgrund und Rinne verdeckt, Kamm frei', () => {
    const N = (gx, gy, e = 0.01) => [-gx * e, -gy * e, e];        // Gitter-Normale wie im Vertex-Shader (h(P) − h(P+e))
    const ao = (h, P, grad) => X.horizonAO(h, P, h(P[0], P[1]), N(grad[0], grad[1]), 4, 3, 0.005, X.AO_K);
    assert.equal(ao(() => 0.2, [0, 0], [0, 0]), 1, 'Ebene');
    assert.ok(near(ao((x, y) => 0.3 * x + 0.1 * y, [0, 0], [0.3, 0.1]), 1, 1e-9), 'Hang (Tangentialebene) bleibt frei');
    const valley = (x) => 0.8 * Math.abs(x);                          // V-Tal längs y
    const a1 = ao(valley, [0, 0], [0, 0]);
    assert.ok(a1 < 0.75, 'Talgrund dunkler: ' + a1);
    const a2 = ao((x, y) => 0.8 * Math.hypot(x, y), [0, 0], [0, 0]);   // Trichter: noch stärker verdeckt als das Tal
    assert.ok(a2 < a1, 'Trichter < Tal: ' + a2 + ' / ' + a1);
    assert.ok(a2 >= 0);
    assert.equal(ao((x) => -0.8 * Math.abs(x), [0, 0], [0, 0]), 1, 'Kamm frei');
    assert.equal(X.horizonAO(valley, [0, 0], 0, N(0, 0), 0, 3, 0.005, X.AO_K), 1, 'aoN = 0 -> aus');
    // 2 Richtungen (Akku) sehen das Tal ebenfalls (Diagonale)
    assert.ok(X.horizonAO(valley, [0, 0], 0, N(0, 0), 2, 2, 0.005, X.AO_K) < 0.85);
    // Abstand wächst, mindestens 1,5 Gitterzellen
    assert.ok(X.aoRadius(0, 0.001) < X.aoRadius(1, 0.001) && X.aoRadius(1, 0.001) < X.aoRadius(2, 0.001));
    assert.ok(near(X.aoRadius(0, 0.1), 0.15, 1e-12));
    const d = X.aoDir(0, 4); assert.ok(near(Math.hypot(d[0], d[1]), 1, 1e-6));
});

// ------------------------------------------------------------ Endpass
test('Belichtung/Farbstich nach Sonnenhöhe: 1 bei der Sonne von 6.6, tiefe Sonne heller und wärmer', () => {
    assert.equal(X.exposure(0.5), 1);
    assert.deepEqual(X.sunTint(0.5), [1, 1, 1]);
    assert.ok(X.exposure(0.15) > 1 && X.exposure(1.2) < 1);
    const t = X.sunTint(0.1); assert.ok(t[0] > 1 && t[2] < 1);
    for (let el = 0; el < 1.5; el += 0.1) assert.ok(X.exposure(el) >= X.exposure(el + 0.1), 'monoton fallend');
});

test('Neutral-Schulter: unter dem Knie unverändert, darüber weich auf ≤ 1, Schnee behält Zeichnung', () => {
    for (const c of [[0, 0, 0], [0.3, 0.5, 0.2], [0.69, 0.1, 0.4], [0.7, 0.7, 0.7]]) assert.deepEqual(X.toneNeutral(c), c);
    let last = -1;
    for (let x = 0; x <= 3; x += 0.01) {
        const y = X.toneNeutral([x, x, x])[0];
        assert.ok(y >= last - 1e-12, 'monoton bei ' + x); assert.ok(y <= 1 + 1e-12);
        last = y;
    }
    assert.ok(near(X.shoulder(X.TONE_WHITE, X.TONE_KNEE, X.TONE_WHITE), 1, 1e-12), 'Weißpunkt -> 1');
    // stetig differenzierbar am Knie (Steigung 1)
    const k = X.TONE_KNEE, h = 1e-6;
    assert.ok(near((X.shoulder(k + h, k, X.TONE_WHITE) - k) / h, 1, 1e-4));
    // Schnee (Anzeigewert vor dem Tonemapping 0,95..1,3 – bis 6.6 alles auf 1,0 abgeschnitten) bleibt unterscheidbar
    const snow = [0.95, 1.05, 1.15, 1.3].map(v => X.toneNeutral([v * 0.93, v * 0.95, v])[2]);
    for (let i = 1; i < snow.length; i++) assert.ok(snow[i] - snow[i - 1] > 0.015, 'Stufen ' + snow.map(x => x.toFixed(3)));
    // sehr helle, gesättigte Farbe läuft Richtung Weiß (entsättigt), behält aber die Reihenfolge der Kanäle
    const o = X.toneNeutral([2.0, 1.2, 0.6]);
    assert.ok(o[0] >= o[1] && o[1] >= o[2]);
    assert.ok((o[0] - o[2]) / o[0] < (2.0 - 0.6) / 2.0);
});

test('AgX (?tone=agx): Grauverlauf monoton, Ausgabe 0..1, Schwarz bleibt dunkel', () => {
    let last = -1;
    for (let x = 0; x <= 2; x += 0.02) {
        const y = X.toneAgx([x, x, x]);
        for (const c of y) assert.ok(c >= 0 && c <= 1);
        assert.ok(y[1] >= last - 1e-9, 'monoton bei ' + x);
        last = y[1];
    }
    assert.ok(X.toneAgx([0, 0, 0])[1] < 0.02);
    assert.ok(X.toneAgx([1, 1, 1])[1] > 0.6);
    assert.deepEqual(X.tonemap([0.5, 0.5, 0.5], 2), X.toneAgx([0.5, 0.5, 0.5]));
    assert.deepEqual(X.tonemap([0.5, 0.5, 0.5], 1, 1), X.toneNeutral([0.5, 0.5, 0.5]));
});

test('CAS: flache Stelle unverändert, Kontrast steigt, kein Überschwingen über 0..1', () => {
    assert.ok(near(X.casChannel(0.4, 0.4, 0.4, 0.4, 0.4, 0.5), 0.4, 1e-12));
    const up = X.casChannel(0.6, 0.4, 0.4, 0.4, 0.4, 0.5);
    assert.ok(up > 0.6, 'helle Mitte wird heller: ' + up);
    const more = X.casChannel(0.6, 0.4, 0.4, 0.4, 0.4, 1.0);
    assert.ok(more > up, 'mehr Schärfe -> stärker');
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 2000; i++) {
        const v = [rnd(), rnd(), rnd(), rnd(), rnd()], y = X.casChannel(v[0], v[1], v[2], v[3], v[4], rnd());
        assert.ok(y >= -0.75 && y <= 1.75, 'Ausreißer ' + v + ' -> ' + y);    // GLSL klemmt danach auf 0..1
    }
    assert.equal(X.sharpForScale(0.65, false), 0);
    assert.equal(X.sharpForScale(1, true), 0.2);
    assert.ok(X.sharpForScale(0.65, true) > X.sharpForScale(0.85, true));
    assert.ok(X.sharpForScale(0.3, true) <= 0.8);
});

// ------------------------------------------------------------ Gitter aus GPU-Zeit
test('Gitter: Formel wie 6.6 (Teiler 6 Desktop, 8 Handy), Grenzen 48..200 × 64..300', () => {
    const old = (W, H, mobile) => {
        const cols = Math.max(48, Math.min(200, Math.round(W / ((mobile ? 8 : 6) * Math.max(1, W / 900)))));
        return { cols, rows: Math.max(64, Math.min(300, Math.round(cols * H / W * 1.3))) };
    };
    for (const [W, H] of [[1920, 1080], [1080, 1920], [2808, 6240], [6240, 2808], [400, 800], [800, 600]]) {
        assert.deepEqual(X.gridSize(W, H, 6), old(W, H, false));
        assert.deepEqual(X.gridSize(W, H, 8), old(W, H, true));
    }
    assert.equal(X.legacyDiv(412), 8); assert.equal(X.legacyDiv(1080), 6);
});

test('Gitter aus GPU-Zeit: im Budget bleibt es, zu langsam gröber, schnell feiner; Grenzen und Hysterese', () => {
    assert.equal(X.gridDivFromGpu(7, 8, 7), 8);
    assert.ok(X.gridDivFromGpu(14, 8, 7) > 8, 'langsam -> gröber');
    assert.ok(X.gridDivFromGpu(3, 8, 7) < 8, 'schnell -> feiner');
    assert.equal(X.gridDivFromGpu(100, 8, 7), X.GRID_MAX);
    assert.equal(X.gridDivFromGpu(0.5, 8, 7), X.GRID_MIN);
    assert.equal(X.gridDivFromGpu(7.6, 8, 7), 8, 'kleine Abweichung: Hysterese');
    assert.equal(X.gridDivFromGpu(NaN, 8, 7), 8); assert.equal(X.gridDivFromGpu(0, 6, 7), 6);
    const d = X.gridDivFromGpu(12, 6, 7); assert.equal(d * 2, Math.round(d * 2), 'halbe Schritte');
    // Modell: mit dem neuen Teiler läge die Zeit (ohne Rundung) beim Budget
    const ms = 12, d0 = 6, fV = 0.6, budget = 7, dd = d0 / Math.sqrt((budget / ms - (1 - fV)) / fV);
    assert.ok(near(ms * ((1 - fV) + fV * (d0 / dd) ** 2), budget, 1e-9));
});

test('Gitter: Geräteschlüssel unabhängig von der Drehung; Speichern/Laden mit höchstens 8 Einträgen', () => {
    assert.equal(X.gridKey('Mali-G78', 1080, 2400), X.gridKey('Mali-G78', 2400, 1080));
    assert.notEqual(X.gridKey('Mali-G78', 1080, 2400), X.gridKey('Adreno 650', 1080, 2400));
    const mem = {}, st = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
    assert.equal(X.gridLoad(st, 'a'), null);
    X.gridSave(st, 'a', { ms: 11, d0: 8, t: 1 });          // Format wie three.js (gqPoll) speichert
    assert.deepEqual(X.gridLoad(st, 'a'), { ms: 11, d0: 8, t: 1 });
    for (let i = 0; i < 12; i++) X.gridSave(st, 'k' + i, { ms: 5, d0: 6 });
    assert.ok(Object.keys(JSON.parse(mem[X.GRID_LS])).length <= 8);
    X.gridSave(st, 'bad', { ms: 5, d0: 99 }); assert.equal(X.gridLoad(st, 'bad'), null, 'unplausibel -> ignorieren');
    X.gridSave(st, 'bad2', { div: 9 }); assert.equal(X.gridLoad(st, 'bad2'), null, 'ohne Messzeit -> ignorieren');
    const broken = { getItem: () => '{kaputt', setItem: () => { throw new Error('voll'); } };
    assert.equal(X.gridLoad(broken, 'a'), null); X.gridSave(broken, 'a', { div: 6 });
    assert.equal(X.median([5, 1, 3]), 3); assert.equal(X.median([4, 1, 3, 2]), 2.5);
});

// ------------------------------------------------------------ TAA
// Kamera wie T.camera in js/three.js (Neigung, Drehung, ohne Schräglage)
function cam(tilt, heading, aspect) {
    const FOV = 50 * Math.PI / 180, tanH = Math.tan(FOV / 2), D = 1 / tanH;
    const th = tilt, ph = Math.min(1.3, tilt * 1.2), ps = heading;
    const f = [Math.sin(ps), Math.cos(ps)], r = [Math.cos(ps), -Math.sin(ps)];
    const c = [-f[0] * D * Math.sin(th), -f[1] * D * Math.sin(th), D * Math.cos(th)];
    const fwd = [f[0] * Math.sin(ph), f[1] * Math.sin(ph), -Math.cos(ph)];
    const rt = [r[0], r[1], 0];
    const up = [rt[1] * fwd[2] - rt[2] * fwd[1], rt[2] * fwd[0] - rt[0] * fwd[2], rt[0] * fwd[1] - rt[1] * fwd[0]];
    return { cam: c, fwd, rt, up, tan: [tanH * aspect, tanH] };
}
const project = (c, Q, jit = [0, 0]) => {
    const v = [Q[0] - c.cam[0], Q[1] - c.cam[1], Q[2] - c.cam[2]];
    const zc = v[0] * c.fwd[0] + v[1] * c.fwd[1] + v[2] * c.fwd[2];
    return { ndc: [(v[0] * c.rt[0] + v[1] * c.rt[1] + v[2] * c.rt[2]) / (c.tan[0] * zc) + jit[0], (v[0] * c.up[0] + v[1] * c.up[1] + v[2] * c.up[2]) / (c.tan[1] * zc) + jit[1]], zc };
};

test('TAA: Jitter-Folge (8 Bilder, unter einem Pixel, Mittel ≈ 0)', () => {
    let sx = 0, sy = 0;
    for (let n = 0; n < 8; n++) {
        const j = X.taaJitter(n, 400, 800);
        assert.ok(Math.abs(j[0]) < 1 / 400 && Math.abs(j[1]) < 1 / 800);
        assert.deepEqual(X.taaJitter(n + 8, 400, 800), j);
        sx += j[0] * 400; sy += j[1] * 800;
    }
    assert.ok(Math.abs(sx / 8) < 0.15 && Math.abs(sy / 8) < 0.15);
});

test('TAA-Reprojektion: ruhende Kamera trifft dasselbe Pixel; Drehung, Zoom und Fokuswechsel wie die Projektion', () => {
    const c = cam(0.7, 0.3, 0.5), jit = [0.0012, -0.0007];
    const Q = [0.21, -0.37, 0.15];
    const p = project(c, Q, jit);
    const r0 = X.reproject(p.ndc, p.zc, jit, c, c, [1, 0, 0]);
    assert.ok(near(r0.ndc[0], p.ndc[0] - jit[0], 1e-9) && near(r0.ndc[1], p.ndc[1] - jit[1], 1e-9), 'gleiches Pixel ohne Jitter');
    assert.ok(near(r0.zc, p.zc, 1e-9));
    // Flug: Welt-Punkt fest, Fokus und lokale Einheit ändern sich (lokal = (Welt − Fokus) / u), Kamera dreht sich
    const W = [0.0123, -0.0456], hgt = 0.15;
    const fNow = [0.0101, -0.0444], uNow = 0.0042, fPrev = [0.0098, -0.0440], uPrev = 0.0045;
    const Qn = [(W[0] - fNow[0]) / uNow, (W[1] - fNow[1]) / uNow, hgt], Qp = [(W[0] - fPrev[0]) / uPrev, (W[1] - fPrev[1]) / uPrev, hgt];
    const cn = cam(0.75, 0.32, 0.5), cp = cam(0.73, 0.29, 0.5);
    const pn = project(cn, Qn, jit), pp = project(cp, Qp);
    const xf = X.taaXf(uNow, uPrev, fNow[0] - fPrev[0], fNow[1] - fPrev[1]);
    const r = X.reproject(pn.ndc, pn.zc, jit, cn, cp, xf);
    assert.ok(near(r.ndc[0], pp.ndc[0], 1e-9) && near(r.ndc[1], pp.ndc[1], 1e-9), JSON.stringify([r.ndc, pp.ndc]));
    assert.ok(near(r.zc, pp.zc, 1e-9), 'erwarteter Abstand im vorigen Bild');
    // Himmel: nur Drehung
    const d = X.reprojectDir([0.1, 0.4], [0, 0], c, c);
    assert.ok(near(d.ndc[0], 0.1, 1e-9) && near(d.ndc[1], 0.4, 1e-9));
    assert.equal(X.reprojectDir([0, 0], [0, 0], c, { ...c, fwd: c.fwd.map(x => -x) }), null, 'hinter der vorigen Kamera');
});

test('TAA: Tiefe <-> Abstand, Kodierung im History-Alpha, Gewicht nach Bewegung, Disocclusion', () => {
    const n = 0.02, far = 80, dp = [(far + n) / (far - n), -2 * far * n / (far - n)];
    for (const zc of [0.05, 0.5, 2, 9, 28, 79]) {
        assert.ok(near(X.depthToZc(X.zcToDepth(zc, dp), dp), zc, zc * 1e-9));
        assert.ok(Math.abs(X.decZ(Math.round(X.encZ(zc) * 255) / 255) / zc - 1) < 0.035, '8 bit genügen für 10 %-Schwelle');
    }
    assert.ok(X.zcToDepth(28, dp) < 0.99999, 'fernstes Gelände ist kein Himmel');
    assert.equal(X.encZ(1e9), 1);
    assert.equal(X.taaAlpha(0), X.TAA.alpha); assert.equal(X.taaAlpha(1000), X.TAA.alphaMax);
    for (let v = 0; v < 40; v++) assert.ok(X.taaAlpha(v + 1) >= X.taaAlpha(v));
    assert.equal(X.taaReject(2, 2.1), false); assert.equal(X.taaReject(2, 2.5), true);
});
