// 7.4 Roll im Flug: Bilddrehung der 2D-Ansicht (Abbildung Zielpixel -> Texel einer gedrehten Ebene, Federung der Ebenenränder,
// Abdeckung) und das Drehtempo des Autopiloten (weich, begrenzt, Richtungswechsel gemächlich) – ohne Browser.
'use strict';
require('../../js/hp.js');
require('../../js/layers.js');
require('../../js/flight.js');
const HP = globalThis.FKHP, LX = globalThis.FKLayers;

// kleiner fester Zufall
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// Welt eines Zielpixels T (GL, y oben) der Kamera cam (Drehung rc) bzw. eines Texels B der Ebene (Weltachsen, double)
function worldOfTarget(cam, rc, tw, th, x, y) {
    const s = 3 / (cam.zoom * th), dx = (x - tw / 2) * s, dy = (y - th / 2) * s;
    return [HP.toNumber(cam.cx) + Math.cos(rc) * dx - Math.sin(rc) * dy, HP.toNumber(cam.cy) + Math.sin(rc) * dx + Math.cos(rc) * dy];
}
function worldOfTexel(v, scale, w, h, u, q) {
    const r = v.rot || 0, dx = (u - w / 2) * scale, dy = (q - h / 2) * scale;
    return [HP.toNumber(v.cx) + Math.cos(r) * dx - Math.sin(r) * dy, HP.toNumber(v.cy) + Math.sin(r) * dx + Math.cos(r) * dy];
}
const mapT = (xf, x, y) => [xf[0] * x - xf[1] * y + xf[2], xf[1] * x + xf[0] * y + xf[3]];

test('Ebenen-Abbildung ohne Drehung: genau die Zahlen bis 7.3 (xfFor: k, Versatz)', () => {
    for (let i = 0; i < 200; i++) {
        const cam = { cx: HP.fromNumber(rnd() - 0.5), cy: HP.fromNumber(rnd() - 0.5), zoom: 1 + rnd() * 50 };
        const v = { cx: HP.fromNumber(rnd() - 0.5), cy: HP.fromNumber(rnd() - 0.5), zoom: cam.zoom };
        const scale = 0.001 + rnd() * 0.01, w = 100 + (rnd() * 900 | 0), h = 100 + (rnd() * 900 | 0), tw = 400, th = 900;
        const xf = LX.rectXf(v, scale, w, h, cam, 0, tw, th);
        const k = 3 / (cam.zoom * th) / scale;
        const dx = HP.toNumber(cam.cx - v.cx) / scale, dy = HP.toNumber(cam.cy - v.cy) / scale;
        assert.deepEqual(xf, [k, 0, dx - tw / 2 * k + w / 2, dy - th / 2 * k + h / 2]);
    }
});

test('Ebenen-Abbildung mit Drehung: Zielpixel und Texel zeigen auf denselben Weltpunkt (Kamera und Ebene je gedreht)', () => {
    let worst = 0;
    for (let i = 0; i < 300; i++) {
        const cam = { cx: HP.fromNumber(rnd() - 0.5), cy: HP.fromNumber(rnd() - 0.5), zoom: 1 + rnd() * 50 };
        const rc = (rnd() - 0.5) * 7, v = { cx: HP.fromNumber(HP.toNumber(cam.cx) + (rnd() - 0.5) * 0.1), cy: HP.fromNumber(HP.toNumber(cam.cy) + (rnd() - 0.5) * 0.1), rot: (rnd() - 0.5) * 7 };
        const scale = 0.0005 + rnd() * 0.01, w = 64 + (rnd() * 900 | 0), h = 64 + (rnd() * 900 | 0), tw = 300 + (rnd() * 900 | 0), th = 300 + (rnd() * 900 | 0);
        const xf = LX.rectXf(v, scale, w, h, cam, rc, tw, th);
        for (let k = 0; k < 5; k++) {
            const x = rnd() * tw, y = rnd() * th, [u, q] = mapT(xf, x, y);
            const a = worldOfTarget(cam, rc, tw, th, x, y), b = worldOfTexel(v, scale, w, h, u, q);
            worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]) / (3 / (cam.zoom * th)));
        }
    }
    assert.ok(worst < 1e-6, 'größte Abweichung ' + worst + ' Zielpixel');
});

// Nachbau der Federung im Anzeige-Shader (shaders.js coverage) – neu (mit Drehung) und bis 7.3
function covNew(tc, size, xf, T, F) {
    if (tc[0] < 0 || tc[1] < 0 || tc[0] > size[0] || tc[1] > size[1]) return 0;
    const k = Math.hypot(xf[0], xf[1]);
    const ax = [xf[0] * T[0], xf[1] * T[0]], ay = [-xf[1] * T[1], xf[0] * T[1]];
    const cl = (v) => Math.max(0, Math.min(F, v));
    let c = 1;
    for (let i = 0; i < 2; i++) {
        const tmin = xf[2 + i] + Math.min(ax[i], 0) + Math.min(ay[i], 0), tmax = xf[2 + i] + Math.max(ax[i], 0) + Math.max(ay[i], 0);
        const f0 = cl(-tmin / k), f1 = cl((tmax - size[i]) / k);
        if (f0 > 0) c = Math.min(c, tc[i] / k / f0);
        if (f1 > 0) c = Math.min(c, (size[i] - tc[i]) / k / f1);
    }
    return Math.max(0, Math.min(1, c));
}
function covOld(tc, size, xf, T, F, p) {
    if (tc[0] < 0 || tc[1] < 0 || tc[0] > size[0] || tc[1] > size[1]) return 0;
    const cl = (v) => Math.max(0, Math.min(F, v));
    let c = 1;
    for (let i = 0; i < 2; i++) {
        const e0 = -xf[2 + i] / xf[0], e1 = (size[i] - xf[2 + i]) / xf[0], f0 = cl(e0), f1 = cl(T[i] - e1);
        if (f0 > 0) c = Math.min(c, (p[i] - e0) / f0);
        if (f1 > 0) c = Math.min(c, (e1 - p[i]) / f1);
    }
    return Math.max(0, Math.min(1, c));
}
test('Federung der Ebenenränder: ohne Drehung wie bis 7.3, mit Drehung stetig und am Bildrand ohne Saum', () => {
    let worst = 0;
    for (let i = 0; i < 300; i++) {
        const k = 0.2 + rnd() * 3, xf = [k, 0, (rnd() - 0.7) * 600, (rnd() - 0.7) * 900], T = [400, 900], size = [300 + rnd() * 600, 300 + rnd() * 900];
        for (let j = 0; j < 10; j++) {
            const p = [rnd() * T[0], rnd() * T[1]], tc = mapT(xf, p[0], p[1]);
            worst = Math.max(worst, Math.abs(covNew(tc, size, xf, T, 24) - covOld(tc, size, xf, T, 24, p)));
        }
    }
    assert.ok(worst < 1e-9, 'Abweichung ' + worst);
    // gedrehte Ebene, die das ganze Bild deckt: im Bild überall volle Deckung (keine Federung an den Bildrändern)
    const cam = { cx: 0n, cy: 0n, zoom: 1 }, T = [400, 900];
    const v = { cx: 0n, cy: 0n, rot: 0.3 }, sc = 3 / 900, w = 1200, h = 1200;
    const xf = LX.rectXf(v, sc, w, h, cam, 0.31, T[0], T[1]);
    for (let j = 0; j < 400; j++) { const p = [rnd() * T[0], rnd() * T[1]]; assert.equal(covNew(mapT(xf, p[0], p[1]), [w, h], xf, T, 24), 1); }
});

test('Abdeckung (layerRect/inRect): ohne Drehung das Rechteck bis 7.3, gedreht exakt das schräge Rechteck', () => {
    const ctx = { canvas: { width: 400, height: 900 }, HP };
    const M = LX.create(ctx);
    ctx.viewRot = () => 0; M.link();
    const l = { view: { cx: HP.fromNumber(0.01), cy: HP.fromNumber(-0.02) }, scale: 3 / 900 / 2, buf: { w: 300, h: 500 } };
    const cam = { cx: 0n, cy: 0n, zoom: 1 };
    const r = M.layerRect(l, cam), s = 3 / 900;
    assert.deepEqual(r, { x0: 0.01 / s + 200 - 75, x1: 0.01 / s + 200 + 75, y0: -0.02 / s + 450 - 125, y1: -0.02 / s + 450 + 125 });
    ctx.viewRot = () => 0.4;
    const l2 = Object.assign({}, l, { view: Object.assign({}, l.view, { rot: -0.2 }) });
    const r2 = M.layerRect(l2, cam);
    let n = 0, bad = 0;
    for (let i = 0; i < 4000; i++) {
        const x = rnd() * 400, y = rnd() * 900, wv = worldOfTarget(cam, 0.4, 400, 900, x, y);
        // im Puffer? (Welt -> Texel direkt)
        const dx = wv[0] - 0.01, dy = wv[1] + 0.02, c = Math.cos(-0.2), sn = Math.sin(-0.2);
        const u = (c * dx + sn * dy) / l.scale + 150, q = (-sn * dx + c * dy) / l.scale + 250;
        const inside = u >= 0 && u <= 300 && q >= 0 && q <= 500;
        if (inside) n++;
        if (inside !== M.inRect(r2, x, y)) bad++;
        if (inside) assert.ok(x >= r2.x0 - 1e-6 && x <= r2.x1 + 1e-6 && y >= r2.y0 - 1e-6 && y <= r2.y1 + 1e-6);
    }
    assert.ok(n > 200 && bad === 0, `drin ${n}, falsch ${bad}`);
});

// Roll: Drehtempo über 10 Minuten Flug (60 Hz)
function rollRun(q, opts) {
    opts = opts || {};
    const VR = { rot: 0 }, S = { flyRoll: opts.off ? false : true };
    const ctx = { Q: new URLSearchParams(q || ''), S, VR, V3: { on: false }, setViewRot: (r) => { VR.rot = r; } };
    const F = globalThis.FKFlight.create(ctx);
    F.link();
    const FLY = F.FLY;
    Object.assign(FLY, { on: true, d3: !!opts.d3, mode: 'random', ease: 0, sp: 0.3, rph: [0.4, 2.1] });
    const dt = 1 / 60, out = [];
    let rot = 0;
    for (let i = 0; i < 60 * (opts.secs || 600); i++) {
        const t = i * dt;
        FLY.ease = Math.min(1, t / 2) * Math.min(1, t / 2) * (3 - 2 * Math.min(1, t / 2));     // Anfahrt 2 s (S-Kurve)
        F.rollStep(dt);
        out.push({ t, w: FLY.rw, rot: VR.rot, r3: FLY.rollS });
        rot += FLY.rw * dt;
    }
    return { out, cfg: FLY.rollCfg, F, FLY, VR };
}
test('Roll im Flug (2D): Tempo ≤ 1,5°/s, weich (Beschleunigung, Ruck klein), Richtungswechsel gemächlich, Anfahrt aus 0', () => {
    const { out, cfg } = rollRun('');
    const deg = 180 / Math.PI, dt = 1 / 60;
    assert.equal(+(cfg.rate * deg).toFixed(6), 1.5);
    let maxW = 0, maxA = 0, maxJ = 0, flips = 0, sumW = 0;
    for (let i = 2; i < out.length; i++) {
        const w = out[i].w, a = (out[i].w - out[i - 1].w) / dt, a0 = (out[i - 1].w - out[i - 2].w) / dt;
        maxW = Math.max(maxW, Math.abs(w)); maxA = Math.max(maxA, Math.abs(a)); maxJ = Math.max(maxJ, Math.abs(a - a0) / dt);
        sumW += Math.abs(w);
        if (Math.sign(w) !== Math.sign(out[i - 1].w) && Math.abs(out[i - 1].w) > 0) flips++;
    }
    const mean = sumW / out.length;
    assert.ok(maxW * deg <= 1.5 * 1.02, 'größtes Tempo ' + (maxW * deg).toFixed(3) + '°/s');
    assert.ok(mean * deg > 0.8, 'mittleres Tempo ' + (mean * deg).toFixed(3) + '°/s');
    assert.ok(maxA * deg < 0.6, 'größte Drehbeschleunigung ' + (maxA * deg).toFixed(3) + '°/s²');
    assert.ok(maxJ * deg < 1.5, 'größter Ruck ' + (maxJ * deg).toFixed(3) + '°/s³');
    assert.ok(flips >= 6 && flips <= 40, 'Richtungswechsel in 10 min: ' + flips);
    if (process.env.ROLL_STATS) console.log(JSON.stringify({ maxW: +(maxW * deg).toFixed(3), mean: +(mean * deg).toFixed(3), maxA: +(maxA * deg).toFixed(4), maxJ: +(maxJ * deg).toFixed(4), flips }));
    assert.ok(Math.abs(out[0].w) < 1e-6 && Math.abs(out[60].w) * deg < 0.2, 'Anfahrt: nach 1 s ' + (out[60].w * deg).toFixed(3) + '°/s');
    // die Ansicht dreht genau mit (Winkel modulo 2π)
    const ang = out.reduce((s, o) => s + o.w * dt, 0), last = out[out.length - 1].rot;
    const d = ang - last - 2 * Math.PI * Math.round((ang - last) / (2 * Math.PI));
    assert.ok(Math.abs(d) < 1e-9);
});
test('Roll aus: ?roll=0 und Einstellung aus -> keine Drehung; ?roll=3 -> 3°/s', () => {
    for (const r of [rollRun('roll=0', { secs: 60 }), rollRun('', { secs: 60, off: true })]) assert.ok(r.out.every(o => o.w === 0 && o.rot === 0));
    const r3 = rollRun('roll=3', { secs: 120 });
    const mx = Math.max(...r3.out.map(o => Math.abs(o.w))) * 180 / Math.PI;
    assert.ok(mx > 2.5 && mx <= 3.06, 'größtes Tempo ' + mx);
});
test('Roll 3D-Landschaft: Schaukeln höchstens 12°, Ansicht (2D-Drehung) bleibt 0', () => {
    const { out } = rollRun('', { d3: true });
    const mx = Math.max(...out.map(o => Math.abs(o.r3))) * 180 / Math.PI;
    assert.ok(mx <= 12.0001 && mx > 5, 'größte Schräglage ' + mx.toFixed(2) + '°');
    assert.ok(out.every(o => o.rot === 0));
});

// CPU-Kachel (tile-worker.js) mit Drehung: jedes Pixel = Weltpunkt R(rot)·Pixelversatz um die Puffermitte (wie im Rechen-Shader)
function loadTileWorker() {
    const path = require('path'), out = [];
    const saved = { pm: self.postMessage, is: self.importScripts, loc: self.location, om: self.onmessage };
    self.postMessage = (m) => out.push(m);
    self.importScripts = (...files) => { for (const f of files) require(path.join(__dirname, '..', '..', 'js', f.split('?')[0])); };
    self.location = { search: '' };
    const file = require.resolve('../../js/tile-worker.js');
    delete require.cache[file];
    require(file);
    const onmessage = self.onmessage;
    Object.assign(self, { postMessage: saved.pm, importScripts: saved.is, location: saved.loc, onmessage: saved.om });
    return { out, send: (q) => { const pm = self.postMessage; self.postMessage = (m) => out.push(m); try { onmessage({ data: q }); } finally { self.postMessage = pm; } } };
}
test('CPU-Kachel und Nachrechnung gedreht: Pixel liegen auf den gedrehten Weltpunkten', () => {
    const W = loadTileWorker(), C = globalThis.FKCore;
    const rot = 0.7, rc = Math.cos(rot), rs = Math.sin(rot), sc = 0.004, offX = -0.745, offY = 0.12, bw = 16, bh = 12;
    const base = { jobId: 1, bufW: bw, bufH: bh, scale: sc, mode: 'direct', formula: 0, maxIter: 400, offX, offY, jx: 0, jy: 0, rc, rs };
    W.send(Object.assign({ type: 'tile', x: 0, y: 0, w: bw, h: bh }, base));
    const t = W.out.pop();
    let bad = 0;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
        const px0 = (i + 0.5 - bw / 2) * sc, py0 = -(j + 0.5 - bh / 2) * sc;
        const v = C.directPixel(offX + rc * px0 - rs * py0, offY + rs * px0 + rc * py0, 0, 400, 0, 0, 0, false);
        if (Math.abs(v - t.data[(bh - 1 - j) * bw + i]) > 1e-4) bad++;
    }
    assert.equal(bad, 0);
    W.send(Object.assign({ type: 'pixels', chunk: 0, list: new Int32Array([3, 4, 10, 2]) }, base));
    const p = W.out.pop();
    assert.ok(Math.abs(p.values[0] - t.data[(bh - 1 - 4) * bw + 3]) < 1e-4 && Math.abs(p.values[1] - t.data[(bh - 1 - 2) * bw + 10]) < 1e-4);
});

test('Roll klingt weich aus: Ausrollen per Knopf (1 s), danach Feder ohne Abriss, nach ≤ 9 s steht die Drehung (Bremsen ≤ 1,2°/s²)', () => {
    const { F, FLY, VR } = rollRun('', { secs: 40 });
    const dt = 1 / 60, deg = 180 / Math.PI, w0 = Math.abs(FLY.rw);
    assert.ok(w0 * deg > 0.3, 'vor dem Anhalten ' + (w0 * deg).toFixed(2) + '°/s');
    // Ausrollen: Tempo in 1 s über eine S-Kurve auf 0 (wie flight.js stopFlySoft), dann aus
    FLY.stopping = true; FLY.ramp = { from: 0.3, to: 0, stop: true };
    let prev = FLY.rw, maxD = 0;
    for (let i = 0; i < 60; i++) { const u = (i + 1) / 60; FLY.sp = 0.3 * (1 - u * u * (3 - 2 * u)); F.rollStep(dt); maxD = Math.max(maxD, Math.abs(FLY.rw - prev)); prev = FLY.rw; }
    FLY.on = false; FLY.stopping = false; FLY.ramp = null;
    let t = 0;
    for (let i = 0; i < 60 * 10; i++) { F.rollIdle(dt); maxD = Math.max(maxD, Math.abs(FLY.rw - prev)); prev = FLY.rw; if (FLY.rw === 0 && !t) t = (i + 1) * dt; }
    assert.ok(maxD * deg / dt < 1.2, 'größte Drehbeschleunigung beim Anhalten ' + (maxD * deg / dt).toFixed(3) + '°/s²');
    assert.ok(t > 0 && t < 9, 'steht nach ' + t.toFixed(1) + ' s');
    assert.ok(isFinite(VR.rot));
});
