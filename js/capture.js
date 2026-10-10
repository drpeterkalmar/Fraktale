// capture.js — 6.8.1 Screenshot in beliebig hoher Auflösung (Kachel-Rendern)
//
// Das Bild wird in Kacheln ≤ GPU-Maximum (MAX_TEXTURE_SIZE/MAX_RENDERBUFFER_SIZE/MAX_VIEWPORT_DIMS, Handy 1024, sonst 2048)
// gerechnet und Streifen für Streifen zusammengesetzt:
//  * 2D: je Kachel ein Rechenpuffer (GPU oder CPU-Worker, wie das Ruhebild: gleiche Iterationen, Distanzschätzung, exakte
//    Nachrechnung unsicherer Pixel in f64) mit 4 px Rand, dann der Anzeige-Pass in ein Farbziel. Die Pixel einer Kachel
//    bekommen exakt dieselben Rechenwerte wie im ganzen Bild: gleiche Ansichtsmitte, Kachel-Lage als ganz-/halbzahliger
//    Pixelversatz (u_pxoff, in f32 exakt), BLA-Entscheidung einmal fürs ganze Bild, CPU-Worker rechnen mit den Koordinaten
//    des ganzen Bilds; Vignette/Funkeln über u_vp. -> Kachelnähte sind bitgleich zum Bild aus einem Stück.
//  * 3D: dieselbe Kamera fürs ganze Bild, je Kachel nur die Projektion verschoben (T3.capFrame), Mittelung wie im Stillstand,
//    Rand für Bloom/Schärfen. Mandelbulb: Anzeige-Shader mit u_vp. Buddhabrot: nur Bildschirmauflösung (das Bild entsteht
//    aus Zufallsproben über die Zeit; 4× Auflösung bräuchte 16× so viele Proben – Minuten bis Stunden).
// Bis ~100 Megapixel (Handy ~16) wird in ein OffscreenCanvas gemalt (toBlob), darüber kodiert js/png-worker.js streifenweise
// (das Bild liegt nie ganz im Speicher). Gerechnet wird in Häppchen im Takt der App (step() aus frame()), die Ansicht
// steht solange still (Planer pausiert, Flug angehalten), die App friert nicht ein; Abbrechen jederzeit, Kontextverlust ->
// sauberer Abbruch mit Hinweis.
(function (root) {
'use strict';

root.FKCapture = { create(ctx) {
    let HP, R, RC, REF, S, V3, T3, FLY, canvas, cpuPool, cpuWorkers, cpuSendRef, deActive, deMaskOn, innActive, look, maxIterFor, requestRefFor, requestBLA, refUsable, t, fmtZoom, MODE_KEYS, view3d, layers3d, orderLayers, aaFrames, pauseFly, stats;   // aus app.js, gesetzt in link()

    const MOBILE = Math.min(screen.width, screen.height) < 700;
    const MAX_SIDE = 65535, MAX_PX = 1e9;                 // PNG-Grenze je Seite; 1 Gigapixel insgesamt
    const STRIP_BUDGET = (MOBILE ? 24 : 64) * 1048576;    // RGBA-Streifen im Speicher (Bytes)
    const CANVAS_MAX = MOBILE ? 16.7e6 : 100e6;           // darüber streamend kodieren (iOS: Canvas höchstens 16,7 MP)
    const M2D = 4;                                         // Rand der 2D-Rechenpuffer (Catmull-Rom 4×4, Relief, DE)
    const LS_RATE = 'fraktal_shot_rate';

    // ---------------- Größe
    function devSize() { const d = window.devicePixelRatio || 1; return [Math.max(1, Math.round(ctx.cssW * d)), Math.max(1, Math.round(ctx.cssH * d))]; }
    const clampSide = (v) => Math.max(16, Math.min(MAX_SIDE, Math.round(+v || 0)));
    // Bildgröße aus den Einstellungen (o: abweichende Einstellungen, z. B. aus dem Menü vor dem Speichern)
    function shotSize(o) {
        o = Object.assign({ shotRes: S.shotRes, shotW: S.shotW, shotH: S.shotH, shotAspect: S.shotAspect }, o || {});
        const [w0, h0] = devSize();
        let W = w0, H = h0;
        if (o.shotRes === '2x') { W = w0 * 2; H = h0 * 2; }
        else if (o.shotRes === '4x') { W = w0 * 4; H = h0 * 4; }
        else if (o.shotRes === '8k') { W = 7680; H = 4320; }
        else if (o.shotRes === 'custom') { W = clampSide(o.shotW); H = o.shotAspect === 'free' ? clampSide(o.shotH) : clampSide(W * h0 / w0); }
        if (W * H > MAX_PX) { const k = Math.sqrt(MAX_PX / (W * H)); W = Math.floor(W * k); H = Math.floor(H * k); }
        return [Math.min(MAX_SIDE, W), Math.min(MAX_SIDE, H)];
    }
    function kindNow() { return S.formula === 7 ? 'buddha' : ctx.isRay() ? 'bulb' : V3.on ? '3d' : '2d'; }
    // Buddhabrot: nur Bildschirmauflösung (siehe oben)
    function supports(res) { return kindNow() !== 'buddha' || res === 'screen'; }

    // ---------------- Plan: Kacheln, Rechenweg, Streifen
    function glLimit() {
        const gl = R.gl, vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vp[0], vp[1]);
    }
    const alignUp = (x, a) => Math.ceil(x / a) * a;
    const alignDn = (x, a) => Math.max(a, Math.floor(x / a) * a);
    // opts: { W, H, tile (Test: Kachelgröße erzwingen), stream (Test: erzwingen), label }
    function plan(opts) {
        opts = opts || {};
        const [W0, H0] = shotSize();
        const W = opts.W || W0, H = opts.H || H0;
        const kind = kindNow();
        const lim = Math.min(glLimit(), MOBILE ? 1024 : 2048);
        const P = { W, H, kind, cam: { cx: S.cam.cx, cy: S.cam.cy, zoom: S.cam.zoom }, formula: S.formula, label: opts.label === undefined ? S.shotLabel : !!opts.label, time: opts.time, reuse: !!opts.reuse, test: !!(opts.tile || opts.reuse || opts.time !== undefined) };
        let m = 0, al = 1;
        if (kind === '2d') {
            m = M2D;
            // Welt pro Bildpixel: das ganze Bildschirmbild passt hinein (bei anderem Seitenverhältnis kommt am Rand mehr dazu)
            const vh = 3 / S.cam.zoom, vw = vh * ctx.cssW / ctx.cssH;
            P.s = Math.max(vw / W, vh / H);
            P.zEff = 3 / (P.s * canvas.height);           // Zoom, bei dem der Bildschirm Pixel dieser Größe hätte
            const rcpu = S.renderer === 'cpu' || ctx.forceCPU, f = S.formula, z = P.zEff;
            if (f === 5) { P.dev = z <= ctx.NEWTON_GPU_MAX && !rcpu ? 'gpu' : 'cpu'; P.mode = 'direct'; }
            else if (z < ctx.DIRECT_MAX && !rcpu) { P.dev = 'gpu'; P.mode = 'direct'; }
            else if (rcpu || !ctx.gpuPerturbOK || z > ctx.GPU_MAX) { P.dev = 'cpu'; P.mode = z < ctx.DIRECT_MAX ? 'direct' : 'perturb'; }
            else { P.dev = 'gpu'; P.mode = 'perturb'; }
            P.maxIter = maxIterFor(S.cam.zoom);
            P.de = deActive(); P.deMask = deMaskOn(); P.inn = innActive(); P.err = P.dev === 'gpu' && S.precise && f !== 5;
            P.julia = [HP.toNumber(S.julia.x), HP.toNumber(S.julia.y)];
        } else if (kind === '3d') {
            const f = H / canvas.height;
            P.bloomDiv = 2 * Math.max(1, Math.round(f));
            al = P.bloomDiv;
            m = alignUp(Math.ceil(14 * f) + 4, al);        // Rand: Bloom-Radius (~12 Bildschirmpixel) + Schärfen
            P.N = Math.max(1, aaFrames());
            P.grid = T3.capGrid(W, H);
        }
        P.m = m;
        let tw = Math.min(W, lim - 2 * m), th = Math.min(H, lim - 2 * m, Math.max(16, Math.floor(STRIP_BUDGET / (W * 4))));
        if (opts.tile) { tw = Math.min(W, opts.tile); th = Math.min(H, opts.tile); }
        if (al > 1) { tw = tw >= W ? W : alignDn(tw, al); th = th >= H ? H : alignDn(th, al); }
        P.tw = tw; P.th = th;
        P.cols = Math.ceil(W / tw); P.rows = Math.ceil(H / th);
        P.n = P.cols * P.rows;
        P.stream = opts.stream !== undefined ? !!opts.stream : (Math.max(W, H) > 16384 || W * H > CANVAS_MAX || typeof OffscreenCanvas === 'undefined' && W * H > 16.7e6);
        P.est = estimate(P);
        P.warn = MOBILE && W * H > 100e6;
        return P;
    }

    // ---------------- Schätzung (Dauer, Dateigröße); gemessene Werte des letzten Screenshots verfeinern das Modell
    function rates() { try { return JSON.parse(localStorage.getItem(LS_RATE) || '{}'); } catch (e) { return {}; } }
    function estimate(P) {
        const mp = P.W * P.H / 1e6, scr = canvas.width * canvas.height / 1e6, r = rates()[P.kind + (P.dev || '')] || {};
        let ms;
        const frame = Math.max(8, RC.dtEMA || 16.7);       // ein Schritt je App-Bild
        if (P.kind === '2d') {
            // Rechenzeit des letzten fertigen Bildschirmbilds (finale Stufe + exakte Nachrechnung), auf die Pixelzahl hochgerechnet
            const fx = stats.lastFix && stats.lastFix.ms || 0;
            const base = Math.max(30, (stats.gpuFullMs || 300) + fx);
            ms = (r.k || 1.3) * base * mp / scr + P.n * 5 * frame;
        } else if (P.kind === '3d') {
            const tmp = (P.tw + 2 * P.m) * (P.th + 2 * P.m) / 1e6;
            ms = P.n * (P.N + 2) * Math.max(frame, (r.k || 1) * (20 + 40 * tmp));      // je Mittelungsbild ~40 ms/MP (M1, gemessen)
        } else if (P.kind === 'bulb') {
            // 7.0: je Kachel ~12 gemittelte Durchgänge in voller Qualität (M1: ~60 ms je Megapixel und Durchgang), Streifen je App-Bild
            ms = mp * (r.k || 1) * 12 * 60 + P.n * 12 * frame;
        } else ms = mp * (r.k || 1) * 40 + P.n * 3 * frame;
        ms += mp * (P.stream ? 45 : 25);                    // Kodieren (gemessen M1: Canvas ~25, PNG-Worker ~45 ms/MP)
        const f = Math.max(1, P.H / canvas.height);
        const bpp = (r.bpp || { '2d': 1.6, '3d': 2.2, bulb: 1.8, buddha: 1.2 }[P.kind]) * Math.pow(f, -0.3);
        return { ms: Math.round(ms), bytes: Math.round(mp * 1e6 * bpp), mp: +mp.toFixed(1) };
    }
    function learn(P, ms, bytes) {
        if (P.W * P.H < 4e6) return;                       // kleine Bilder: Zeit von festen Kosten beherrscht
        try {
            const all = rates(), key = P.kind + (P.dev || ''), e = estimate(P), r = all[key] || {};
            const k0 = r.k || (P.kind === '2d' ? 1.3 : 1);
            const enc = P.W * P.H / 1e6 * (P.stream ? 45 : 25);
            const k = k0 * Math.max(0.05, ms - enc) / Math.max(1, e.ms - enc);
            all[key] = { k: +(Math.min(4, Math.max(0.25, k0 * 0.5 + k * 0.5))).toFixed(3), bpp: +(bytes / (P.W * P.H) / Math.pow(Math.max(1, P.H / canvas.height), -0.3)).toFixed(3) };
            localStorage.setItem(LS_RATE, JSON.stringify(all));
        } catch (e) { /* egal */ }
    }

    // ---------------- Beschriftung (optional): wie bisher unten links, Größe mit der Bildhöhe
    function makeLabel(P) {
        const fs = Math.min(400, Math.max(12, Math.round(P.H / 70)));
        const text = `Fraktal-Explorer · ${t(MODE_KEYS[P.formula])} · ${fmtZoom(P.cam.zoom, 'sci')}`;
        const c = document.createElement('canvas'), g = c.getContext('2d');
        const font = `600 ${fs}px system-ui, sans-serif`;
        g.font = font;
        c.width = Math.max(1, Math.min(P.W, Math.ceil(g.measureText(text).width + 2 * fs)));
        c.height = Math.max(1, Math.min(P.H, Math.ceil(2.6 * fs)));
        g.font = font;
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = fs / 2;
        g.fillText(text, fs, c.height - fs);              // Grundlinie wie bisher bei H − fs
        return { c, x: 0, y: P.H - c.height, w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
    }
    // Beschriftung in einen RGBA-Streifen (Zeilen y0 … y0+rows−1 des Bilds, von oben) mischen
    function blendLabel(L, strip, W, y0, rows) {
        const a0 = Math.max(y0, L.y), a1 = Math.min(y0 + rows, L.y + L.h);
        for (let y = a0; y < a1; y++) {
            const so = (y - L.y) * L.w * 4, d0 = ((y - y0) * W + L.x) * 4;
            for (let x = 0; x < L.w; x++) {
                const a = L.data[so + 4 * x + 3] / 255;
                if (!a) continue;
                const d = d0 + 4 * x, s = so + 4 * x;
                strip[d] = L.data[s] * a + strip[d] * (1 - a) + 0.5;
                strip[d + 1] = L.data[s + 1] * a + strip[d + 1] * (1 - a) + 0.5;
                strip[d + 2] = L.data[s + 2] * a + strip[d + 2] * (1 - a) + 0.5;
            }
        }
    }

    // ---------------- Ablauf
    // RC.cap = laufender Screenshot. step(now) kommt aus frame() (jedes App-Bild), advance() macht je Aufruf einen Schritt;
    // false = auf das nächste Bild bzw. ein Ergebnis (Promise) warten.
    let seq = 0;
    function start(opts) {
        if (RC.cap) return Promise.reject(new Error('busy'));
        const P = opts && opts.plan ? opts.plan : plan(opts);
        if (P.kind === 'buddha') return Promise.reject(new Error('buddha'));      // (app.js: Bildschirm-Kopie wie bisher)
        return new Promise((resolve, reject) => {
            const C = { P, id: ++RC.jobSeq, seq: ++seq, phase: 'prep', i: 0, t0: performance.now(), wait: false, resolve, reject,
                        onProgress: opts && opts.onProgress, strips: 0, peak: 0, tiles: [], cancelled: false, times: {} };
            // Ansicht anhalten: laufende Rechnungen des Planers abbrechen (er pausiert, solange RC.cap steht; in 3D rechnet er
            // erst das Bildschirmbild fertig – die Kacheln lesen dessen Ebenen), Flug anhalten
            if (P.kind !== '3d') { ctx.cancelJob(); ctx.cancelPrefetch(); ctx.cancelFix(); }
            if (FLY.on && !FLY.paused) { C.resumeFly = true; pauseFly(true); }
            ctx.stopAnims();
            RC.cap = C;
            C.onCpu = (m, w) => onCpu(C, m, w);
            C.feed = (ws) => feed(C, ws);
            progress(C);
        });
    }
    function cancel() { const C = RC.cap; if (C) { C.cancelled = true; finish(C, new Error('cancelled')); } }
    // GPU-Kontext verloren (app.js R.onLost – die Hauptschleife ruht dann): sauber abbrechen, Ziele gehören dem alten Kontext
    function lost() { const C = RC.cap; if (C) finish(C, new Error('lost')); }
    function progress(C) {
        if (!C.onProgress) return;
        const P = C.P, el = performance.now() - C.t0;
        const frac = C.phase === 'encode' ? 0.97 : C.phase === 'prep' || C.phase === 'settle' || C.phase === 'ref' ? 0 : Math.min(0.96, (C.i + (C.sub || 0)) / P.n * 0.96);
        const rest = frac > 0.03 ? el / frac * (1 - frac) : P.est.ms;
        C.onProgress({ phase: C.phase, i: Math.min(P.n, C.i + 1), n: P.n, frac, restMs: rest, W: P.W, H: P.H });
    }
    function step(now) {
        const C = RC.cap;
        if (!C) return;
        if (R.lost) { finish(C, new Error('lost')); return; }
        const t0 = performance.now();
        try {
            let k = 0;
            while (!C.wait && RC.cap === C && performance.now() - t0 < 8 && k++ < 64) if (!advance(C, now)) break;
        } catch (e) { finish(C, e); return; }
        if (RC.cap === C && (stats.frames % 6 === 0)) progress(C);
    }
    // auf ein Promise warten (Auslesen, unsichere Pixel, Kodieren); null = Kontext verloren
    function waitFor(C, p, then) {
        C.wait = true;
        p.then((v) => { if (RC.cap !== C) return; C.wait = false; try { then(v); } catch (e) { finish(C, e); } }, (e) => { if (RC.cap === C) finish(C, e); });
    }
    function advance(C, now) {
        const P = C.P;
        switch (C.phase) {
            case 'prep': return prep(C);
            case 'settle': {                 // 3D: erst das Bildschirmbild fertig rechnen lassen (die Kacheln lesen seine Ebenen)
                if (ctx.isDone() || now - C.t0 > 10000) { RC.capHold = false; C.phase = 'tiles'; snap3d(C); }
                return false;
            }
            case 'ref': {                    // 2D-Perturbation: Referenzorbit (und BLA-Tabelle) für das ganze Bild
                if (REF.pending || REF.blaPending) return false;
                if (!refUsable(true, true)) { if (!C.refAsked) { C.refAsked = true; requestRefFor(P.cam, null, true); } else if (!REF.pending && now - C.t0 > 30000) throw new Error('ref'); return false; }
                const r = REF.cur, off = [HP.toNumber(P.cam.cx - r.refXb), HP.toNumber(P.cam.cy - r.refYb)];
                const need = Math.hypot(off[0], off[1]) + P.s * Math.hypot(P.W, P.H) / 2;
                if (P.formula !== 1 && r.bla32 && r.blaCmax < need && !C.blaAsked && !r.blaFixed) { C.blaAsked = true; requestBLA(need * 1.05); return false; }
                P.refId = r.id; P.off = off;
                P.useBLA = P.dev === 'gpu' ? !!(R.ref && R.ref.bla32 && R.ref.blaCmax >= need) : !!(r.bla64 && r.blaCmax >= need);
                C.phase = 'tiles';
                return true;
            }
            case 'tiles': return tileStep(C, now);
            case 'encode': return false;
        }
        return false;
    }
    function prep(C) {
        const P = C.P;
        C.label = P.label ? makeLabel(P) : null;
        // Ausgabe: Canvas (bis ~100 MP) oder PNG-Worker (streamend)
        if (P.stream) {
            C.worker = new Worker('js/png-worker.js' + ctx.V);
            C.acks = 0; C.sent = 0;
            C.worker.onmessage = (e) => onWorker(C, e.data);
            C.worker.onerror = (e) => { e.preventDefault && e.preventDefault(); finish(C, new Error('png-worker: ' + (e.message || 'Fehler'))); };
            C.worker.postMessage({ type: 'begin', W: P.W, H: P.H });
        } else {
            C.oc = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(P.W, P.H) : Object.assign(document.createElement('canvas'), { width: P.W, height: P.H });
            C.c2 = C.oc.getContext('2d');
            if (!C.c2) throw new Error('canvas');
        }
        // Kacheln: Streifen von oben nach unten, je Streifen von links nach rechts
        for (let r = 0; r < P.rows; r++) for (let c = 0; c < P.cols; c++) {
            const x0 = c * P.tw, y0 = r * P.th, w = Math.min(P.tw, P.W - x0), h = Math.min(P.th, P.H - y0);
            C.tiles.push({ r, c, x0, y0, w, h, gx: x0, gy: P.H - y0 - h });       // gx, gy: linke untere Ecke in GL-Pixeln des Bilds
        }
        if (P.kind === '3d') { C.phase = 'settle'; RC.capHold = true; return false; }     // RC.capHold: Planer darf noch fertig rechnen
        if (P.kind === 'bulb') { C.look = look(); if (P.time !== undefined) C.look.time = P.time; P.bulbK = ctx.BULB.capK(); }
        if (P.kind === '2d' && P.mode === 'perturb') { C.phase = 'ref'; return true; }
        C.phase = 'tiles';
        return true;
    }
    // 3D: Ebenen und Ansicht einfrieren (Kopien – die Höhentexturen teilen sie mit dem Bildschirm, neu gebaute werden danach frei)
    let lastSnap = null;                 // Test: Zustand der letzten 3D-Aufnahme (opts.reuse – Vergleichsbild aus demselben Zustand)
    function snap3d(C) {
        if (C.P.reuse && lastSnap) { C.L3 = lastSnap.L3; C.v = lastSnap.v; C.look = lastSnap.look; return; }
        const now = performance.now();
        C.L3 = layers3d(orderLayers(now, S.cam)).map(l => Object.assign({}, l, { alpha: 1, _h3d: l.h3d }));
        const v = view3d();
        C.v = Object.assign({}, v, { L: v.L.slice(), cdf: v.cdf ? v.cdf.slice() : v.cdf });
        C.look = look();
        if (C.P.time !== undefined) { C.v.time = C.P.time; C.look.time = C.P.time; }    // Test: feste Animationszeit (Vergleichsbilder)
        lastSnap = { L3: C.L3, v: C.v, look: C.look };
    }
    function stripBuf(C, tile) {
        const P = C.P;
        if (!C.strip || C.strip.r !== tile.r) C.strip = { r: tile.r, y0: tile.y0, rows: tile.h, data: new Uint8Array(P.W * tile.h * 4), done: 0 };
        return C.strip;
    }
    // Kachelpixel (GL: unterste Zeile zuerst) in den Streifen (Zeilen von oben) kopieren
    function putTile(C, tile, px) {
        const P = C.P, S_ = stripBuf(C, tile), w = tile.w;
        for (let r = 0; r < tile.h; r++) S_.data.set(px.subarray(r * w * 4, (r + 1) * w * 4), ((tile.h - 1 - r) * P.W + tile.x0) * 4);
        S_.done++;
        if (S_.done === P.cols) flushStrip(C, S_);
    }
    function flushStrip(C, S_) {
        const P = C.P;
        if (C.label) blendLabel(C.label, S_.data, P.W, S_.y0, S_.rows);
        if (P.stream) {
            C.sent++;
            C.worker.postMessage({ type: 'strip', rows: S_.rows, data: S_.data.buffer }, [S_.data.buffer]);
        } else {
            C.c2.putImageData(new ImageData(new Uint8ClampedArray(S_.data.buffer), P.W, S_.rows), 0, S_.y0);
        }
        C.strip = null;
        C.strips++;
        if (performance.memory) C.peak = Math.max(C.peak, performance.memory.usedJSHeapSize);
    }
    function onWorker(C, m) {
        if (RC.cap !== C) return;
        if (m.type === 'ack') { C.acks++; if (C.wait && C.waitAck) { C.waitAck = false; C.wait = false; } }
        else if (m.type === 'done') done(C, m.blob, m.bytes);
        else if (m.type === 'error') finish(C, new Error('png: ' + m.message));
    }
    // Farbziel (RGBA8) für 2D-Kacheln/Mandelbulb
    function colorTarget(C, w, h) {
        const gl = R.gl;
        if (C.ct && C.ct.w === w && C.ct.h === h) return C.ct;
        freeColor(C);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        C.ct = { tex, fbo, w, h };
        return C.ct;
    }
    function freeColor(C) { if (C.ct) { const gl = R.gl; if (!R.lost) { gl.deleteTexture(C.ct.tex); gl.deleteFramebuffer(C.ct.fbo); } C.ct = null; } }
    function readTile(C, fbo, w, h, x, y, tile) {
        const gl = R.gl;
        waitFor(C, R.readAsync(fbo, w, h, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array, 4, x, y), (px) => {
            if (!px) throw new Error('lost');
            putTile(C, tile, px);
            C.i++; C.sub = 0; C.ts = null;
            // streamend: höchstens zwei Streifen unterwegs (Speicher)
            if (C.P.stream && C.sent - C.acks >= 2) { C.wait = true; C.waitAck = true; }
            if (C.i >= C.P.n) endTiles(C);
        });
    }

    // ---- eine Kachel
    function tileStep(C, now) {
        const P = C.P;
        if (C.i >= P.n) return false;
        const tile = C.tiles[C.i];
        if (!C.ts) C.ts = { st: 'start' };
        const T = C.ts;
        if (P.kind === '2d') return tile2d(C, tile, T, now);
        if (P.kind === '3d') return tile3d(C, tile, T);
        if (P.kind === 'bulb') return tileBulb(C, tile, T);
        return false;
    }
    // 7.0 Mandelbulb: Mittelung je Kachel wie im Ruhebild (js/bulb.js capTile), dann POST ins Farbziel und auslesen.
    // Rückfall-Darstellung (ohne Float-Ziel/defekter Shader): einfaches Bild wie bis 6.9
    function tileBulb(C, tile, T) {
        const P = C.P, ct = colorTarget(C, tile.w, tile.h), BU = ctx.BULB;
        if (BU.ready() !== true) {
            R.presentBulb(P.cam, C.look, { w: tile.w, h: tile.h, fbo: ct.fbo }, [tile.gx, tile.gy, P.W, P.H]);
            readTile(C, ct.fbo, tile.w, tile.h, 0, 0, tile);
            return false;
        }
        if (!BU.capTile(C, T, tile, ct)) return false;
        readTile(C, ct.fbo, tile.w, tile.h, 0, 0, tile);
        return false;
    }
    function tile3d(C, tile, T) {
        const P = C.P, m = P.m;
        if (T.st === 'start') {
            T3.capBegin({ W: P.W, H: P.H, x: tile.gx - m, y: tile.gy - m, w: tile.w + 2 * m, h: tile.h + 2 * m, N: P.N, grid: P.grid, bloomDiv: P.bloomDiv });
            T.n = 0; T.st = 'acc';
            return true;
        }
        if (T.st === 'acc') {
            T3.capFrame(C.L3, C.v, C.look, T.n++);
            C.sub = T.n / (P.N + 1);
            if (T.n >= P.N) T.st = 'out';
            return false;                    // ein Mittelungsbild je App-Bild (GPU-Last verteilt)
        }
        if (T.st === 'out') {
            const o = T3.capFinish();
            T.st = 'read';
            readTile(C, o.fbo, tile.w, tile.h, m, m, tile);
            return false;
        }
        return false;
    }
    function tile2d(C, tile, T, now) {
        const P = C.P, m = P.m, gl = R.gl;
        if (T.st === 'start') {
            const bw = tile.w + 2 * m, bh = tile.h + 2 * m;
            // Puffermitte relativ zur Bildmitte in GL-Pixeln (ganz- oder halbzahlig)
            const pxoff = [tile.gx - m + bw / 2 - P.W / 2, tile.gy - m + bh / 2 - P.H / 2];
            const job = { key: 'shot', stage: 1, kind: P.dev, mode: P.mode, formula: P.formula, maxIter: P.maxIter, view: P.cam, w: bw, h: bh, scale: P.s,
                          julia: P.julia, de: P.de, inn: P.inn, err: P.err, pxoff, id: C.id };
            T.job = job; T.bw = bw; T.bh = bh;
            if (P.dev === 'gpu') {
                R.beginJob(job);
                if (P.mode === 'perturb') job.useBLA = P.useBLA;   // fürs ganze Bild entschieden (sonst Nähte zwischen Kacheln mit/ohne BLA)
            } else {
                job.buf = R.acquireBuffer(bw, bh);
                job.cpuOff = P.mode === 'perturb' ? P.off : [HP.toNumber(P.cam.cx), HP.toNumber(P.cam.cy)];
                job.useBLA = !!P.useBLA; job.refId = P.refId;
                const TS = 64, tl = [];
                for (let y = 0; y < bh; y += TS) for (let x = 0; x < bw; x += TS) tl.push({ x, y, w: Math.min(TS, bw - x), h: Math.min(TS, bh - y) });
                job.tiles = tl; job.tilesTotal = tl.length; job.tilesDone = 0;
                // Koordinaten im ganzen Bild: linke obere Ecke des Puffers
                job.ox = tile.x0 - m; job.oy = tile.y0 - m;
                cpuPool(); C.cpuJob = job; ctx.cpuFeed();
            }
            T.st = 'compute';
            return true;
        }
        if (T.st === 'compute') {
            const job = T.job;
            if (P.dev === 'gpu') {
                R.maxInflight = 2;
                const done = R.pump(job, now, { moving: false, dt: RC.dtEMA || 16, vsync: RC.vsync || 16.7 });
                C.sub = 0.8 * job.row / job.h;
                if (job.failed) throw new Error('shader');
                if (!done) return false;
            } else {
                C.sub = 0.8 * job.tilesDone / job.tilesTotal;
                if (job.tilesDone < job.tilesTotal) return false;
                C.cpuJob = null;
            }
            T.st = job.err ? 'flags' : 'present';
            return true;
        }
        if (T.st === 'flags') {
            const job = T.job;
            T.st = 'fixing';
            waitFor(C, R.findUnsure(job.buf), (list) => {
                if (!list) throw new Error('lost');
                const n = list.length / 2;
                if (!n) { T.st = 'present'; return; }
                // Pakete mit Koordinaten des ganzen Bilds (CPU rechnet Pixel exakt wie im ganzen Bild)
                const ox = tile.x0 - m, oy = tile.y0 - m, CH = 1536;
                T.fix = { chunks: [], sent: 0, done: 0, local: [], retry: [] };
                for (let i = 0; i < list.length; i += 2 * CH) {
                    const loc = list.slice(i, Math.min(list.length, i + 2 * CH)), glb = new Int32Array(loc.length);
                    for (let k = 0; k < loc.length; k += 2) { glb[k] = loc[k] + ox; glb[k + 1] = loc[k + 1] + oy; }
                    T.fix.chunks.push(glb); T.fix.local.push(loc);
                }
                C.fixT = T; cpuPool(); C.wait = true; ctx.cpuFeed();
            });
            return false;
        }
        if (T.st === 'present') {
            const job = T.job, ct = colorTarget(C, tile.w, tile.h);
            // Kachelmitte = Puffermitte (symmetrischer Rand): Abbildung 1:1, Texel = Pixel + Rand
            const cx = P.cam.cx + HP.fromNumber(job.pxoff[0] * P.s), cy = P.cam.cy + HP.fromNumber(job.pxoff[1] * P.s);
            const layer = { buf: job.buf, view: { cx, cy }, scale: P.s, alpha: 1 };
            const lk = look();
            lk.maxIter = P.maxIter;
            lk.outW *= P.W / canvas.width;      // 6.9 Grenznah: Saumbreite wie am Bildschirm, relativ zur Bildgröße
            if (P.time !== undefined) lk.time = P.time;
            R.present([layer], { cx, cy, zoom: 3 / (P.s * tile.h) }, lk, { w: tile.w, h: tile.h, fbo: ct.fbo }, { feather: 0, recon: true, de: P.deMask ? [0.25, 1.25] : null, vp: [tile.gx, tile.gy, P.W, P.H] });
            T.st = 'read';
            const buf = job.buf;
            readTile(C, ct.fbo, tile.w, tile.h, 0, 0, tile);
            // Rechenpuffer gleich freigeben (das Farbziel ist schon gezeichnet)
            R.dropBuffer(buf);
            job.buf = null;
            return false;
        }
        return false;
    }
    // ---- CPU-Worker (cpu-pool.js leitet Nachrichten mit unserer Job-Nummer hierher und fragt feed() nach Arbeit)
    function feed(C, ws) {
        const P = C.P, job = C.cpuJob, fx = C.fixT && C.fixT.fix;
        for (const w of ws) {
            while (w.busy < 2) {
                if (fx && (fx.retry.length || fx.sent < fx.chunks.length)) {
                    const k = fx.retry.length ? fx.retry.shift() : fx.sent++;
                    w.busy++;
                    w.postMessage({ type: 'pixels', jobId: C.id, chunk: k, list: fx.chunks[k], refId: P.refId, bufW: P.W, bufH: P.H, scale: P.s, mode: P.mode, formula: P.formula,
                                    maxIter: P.maxIter, useBLA: !!(REF.cur && REF.cur.bla64) && P.useBLA, offX: P.mode === 'perturb' ? P.off[0] : HP.toNumber(P.cam.cx), offY: P.mode === 'perturb' ? P.off[1] : HP.toNumber(P.cam.cy),
                                    jx: P.julia[0], jy: P.julia[1], inn: P.inn });
                } else if (job && job.tiles.length) {
                    const tl = job.tiles.shift();
                    w.busy++;
                    w.postMessage({ type: 'tile', jobId: C.id, refId: job.refId, bufW: P.W, bufH: P.H, scale: P.s, mode: P.mode, formula: P.formula, maxIter: P.maxIter, useBLA: job.useBLA,
                                    de: P.de, inn: P.inn, offX: job.cpuOff[0], offY: job.cpuOff[1], jx: P.julia[0], jy: P.julia[1], x: tl.x + job.ox, y: tl.y + job.oy, w: tl.w, h: tl.h });
                } else break;
            }
        }
    }
    function onCpu(C, m, w) {
        if (m.jobId !== C.id) return false;
        if (RC.cap !== C) return true;
        if (m.missingRef) {
            if (REF.cur && REF.cur.id === C.P.refId && REF.cur.orbit64) cpuSendRef(REF.cur); else { finish(C, new Error('ref')); return true; }
            if (m.type === 'tile' && C.cpuJob) C.cpuJob.tiles.push({ x: m.x - C.cpuJob.ox, y: m.y - C.cpuJob.oy, w: m.w, h: m.h });
            else if (m.type === 'pixels' && C.fixT) C.fixT.fix.retry.push(m.chunk);
            ctx.cpuFeed();
            return true;
        }
        if (m.type === 'tile' && C.cpuJob) {
            const job = C.cpuJob;
            R.uploadTile(job, m.x - job.ox, m.y - job.oy, m.w, m.h, m.data, m.de);
            job.tilesDone++;
        } else if (m.type === 'pixels' && C.fixT) {
            const T = C.fixT, fx = T.fix;
            R.scatter(T.job.buf, fx.local[m.chunk], m.values);
            fx.done++;
            C.sub = 0.8 + 0.2 * fx.done / fx.chunks.length;
            if (fx.done >= fx.chunks.length) { C.fixT = null; T.st = 'present'; C.wait = false; }
        }
        ctx.cpuFeed();
        return true;
    }
    function endTiles(C) {
        const P = C.P;
        C.times.tiles = performance.now() - C.t0;
        C.phase = 'encode';
        progress(C);
        if (P.kind === '3d') freeSnap(C);
        freeColor(C);
        if (P.stream) {
            C.wait = true;
            C.worker.postMessage({ type: 'end' });
        } else {
            const oc = C.oc;
            const p = oc.convertToBlob ? oc.convertToBlob({ type: 'image/png' }) : new Promise((res) => oc.toBlob(res, 'image/png'));
            waitFor(C, p, (blob) => { if (!blob) throw new Error('png'); done(C, blob, blob.size); });
        }
    }
    function freeSnap(C) {
        if (T3) T3.capEnd();
        if (C.L3) for (const l of C.L3) if (l.h3d && l.h3d !== l._h3d) T3.free(l);   // neu gebaute Höhentexturen der Kopien
        C.L3 = null;
        if (!RC.freeze) lastSnap = null;   // (nur im angehaltenen Test bleiben die Ebenen gültig)
    }
    function done(C, blob, bytes) {
        const P = C.P, ms = performance.now() - C.t0;
        const info = { blob, W: P.W, H: P.H, ms: Math.round(ms), tilesMs: Math.round(C.times.tiles || ms), bytes, tiles: P.n, tile: [P.tw, P.th], stream: P.stream, kind: P.kind, dev: P.dev || null, mode: P.mode || null,
                       est: P.est, peakMB: C.peak ? +(C.peak / 1048576).toFixed(1) : null, margin: P.m };
        if (!P.test) learn(P, ms, bytes);
        finish(C, null, info);
    }
    // Ende (Erfolg, Abbruch, Fehler): aufräumen, Ansicht wieder freigeben
    function finish(C, err, info) {
        if (RC.cap !== C) return;
        RC.cap = null; RC.capHold = false;
        if (C.worker) { try { C.worker.terminate(); } catch (e) {} C.worker = null; }
        if (C.ts && C.ts.job && C.ts.job.buf) { try { if (C.ts.job.kind === 'gpu') R.cancelJob(C.ts.job); R.dropBuffer(C.ts.job.buf); } catch (e) {} }
        if (C.P.kind === '3d') { try { freeSnap(C); } catch (e) {} }
        try { freeColor(C); } catch (e) {}
        C.oc = C.c2 = C.strip = null;
        if (C.resumeFly && FLY.on) pauseFly(false);
        ctx.invalidate();
        if (err) C.reject(err); else C.resolve(info);
    }
    function busy() { return !!RC.cap; }

    return { link() { ({ HP, R, RC, REF, S, V3, T3, FLY, canvas, cpuPool, cpuWorkers, cpuSendRef, deActive, deMaskOn, innActive, look, maxIterFor, requestRefFor, requestBLA, refUsable, t, fmtZoom, MODE_KEYS, view3d, layers3d, orderLayers, aaFrames, pauseFly, stats } = ctx); },
             shotSize, plan, estimate, start, cancel, lost, step, busy, supports, kindNow, devSize };
} };
})(typeof self !== 'undefined' ? self : globalThis);
