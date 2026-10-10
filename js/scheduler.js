// scheduler.js — Render-Planung: welcher Job als Nächstes (Vorschau, Zielbild, finale Stufe, Vorausrechnen), Häppchen-Regelung, Tempo-Bremse
// (Phase 4 des Umbaus 6.5.4: aus js/app.js herausgelöst – Funktionen und Namen unverändert, nur der Ort ist neu.
// app.js ruft create(ctx); Namen aus app.js werden nach dem Anlegen aller Module per link() gebunden, veränderliche
// Variablen der App liest/schreibt das Modul über ctx.<name>.)
(function (root) {
'use strict';

root.FKScheduler = { create(ctx) {
    let FADE_MOVE_MS, FLY, GOV, HP, INERTIA_TAU, Q, R, RC, REF, S, V3, addLayer, anchoredCam, animating, cancelFix, cancelJob, cancelPrefetch, canvas, checkInside, clampZoom, contentSig, coverage, cpuFeed, cpuPool, deActive, ensureRef, flightCamAt, fullDone, innActive, isMoving, jobFailed, jobProgress, layerK, layerRect, makeFrame, maxIterFor, orderLayers, plan, predictCam, refUsable, requestRefFor, startFix, stats, t, viewKey, worldPerCss;   // aus app.js, gesetzt in link()

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
    const REV_W = 1.6, REV_W3 = 1.3;           // 6.8 Rückflug: Vorschau-Ebene für Zoom ÷ 1,6 (2D) bzw. ÷ 1,3 hinter der Kamera (3D)
    const SIDE3D = 1600;                       // P2-3: größte Kantenlänge des quadratischen 3D-Rechenpuffers (px)
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
    function pumpCtl(moving, prefetch) {
        const vs = RC.vsync || 16.7;
        // 6.2: in 3D sind „Leerlauf"-Frames nie leer (3D-Bild, eingereihte GPU-Arbeit) – ihre Dauer darf das Budget nicht
        // aufblähen (sonst rechnete der Flug bis zu 8 Bildtakte pro Frame und ruckelte); dort keine Reserve über den Bildtakt
        // 6.6: ebenso im 2D-Flug – dort wird ohne Pause gerechnet, „Leerlauf“-Frames warten nur auf die GPU (gemessen: mit 8
        // Bildtakten Reserve ab 10⁹ alle ~100 ms ein Bild von 40–75 ms, 52 fps; mit einem Bildtakt wie in 3D ruhig)
        const cap = V3.on || (FLY.on && !FLY.paused) ? vs : 8 * vs;
        // 6.4 Flug: Rechenanteil garantieren – eine Vorschau soll in ~0,6 s fertig werden, auch wenn schon das 3D-Bild allein
        // länger als ein Bildtakt braucht (langsames Gerät, großer Bildschirm, hohe Bildwiederholrate). Sonst schrumpfte der
        // Häppchen-Regler die Rechnung auf 1024 Pixel pro Bild, keine Vorschau wurde mehr fertig, der Flug sah nur noch
        // Leere und suchte den Rand
        const minS = V3.on && FLY.on && !FLY.paused ? 0.6 : 0;
        return { moving, prefetch, dt: RC.dtEMA || 16, vsync: Math.max(vs, Math.min(RC.idleDt || vs, cap)), minS };
    }
    // Bekanntes Ziel der laufenden Animation (Flug/Tour/Doppeltipp, Schwung) und Restzeit in s
    function animTarget() {
        if (FLY.on && !FLY.paused && FLY.mode === 'place' && FLY.target && FLY.sp > 0.05) return { cam: FLY.target, rest: Math.log10(FLY.target.zoom / S.cam.zoom) / Math.max(0.05, FLY.sp * GOV.g) };
        if (ctx.flight) return { cam: flightCamAt(ctx.flight, 1), rest: (1 - (ctx.flight.u || 0)) * ctx.flight.dur / 1000 / Math.max(0.3, GOV.g) };
        if (ctx.inertia) {
            const v = Math.hypot(ctx.inertia.vx, ctx.inertia.vy);
            const f = INERTIA_TAU;
            const c = anchoredCam(S.cam, ctx.inertia.ax, ctx.inertia.ay, ctx.inertia.ax + ctx.inertia.vx * f, ctx.inertia.ay + ctx.inertia.vy * f, Math.exp(ctx.inertia.vs * f));
            return { cam: c, rest: INERTIA_TAU * Math.log(Math.max(1, Math.max(v / 8, Math.abs(ctx.inertia.vs) / 0.03))) };
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
        const off = Math.max(Math.abs(HP.toNumber(v.cx - c.cx)) / (ctx.cssW * s), Math.abs(HP.toNumber(v.cy - c.cy)) / (ctx.cssH * s));
        return { far: r > 2.5 || off > 0.45, r, off };
    }
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
            // 6.8 Rückflug-Ebene (weiter als die Ansicht, daher nur ein kleiner Teil sichtbar): rechnen lassen, solange sie
            // noch weiter ist als die Ansicht und nicht zu grob wird
            if (job.rev && !stale && zr < 1.05 && zr > 1 / 6 && now - job.t0 < 1500 && FLY.on && FLY.sp < 0) cancel = false;
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
                // 6.8 Rückflug: Das Bild wächst nach außen – neu ins Bild kommt der Rand (2D) bzw. das Gelände hinter der Kamera
                // (3D: der untere Bildrand liegt bis ~1,7 Bildhälften hinter dem Fokus, die normale Vorschau deckt nur ±1,2), die
                // Mitte ist aus den tieferen Ebenen schon scharf. Darum ist jede zweite Vorschau (3D: die nicht-fernen) eine Ebene
                // für die Kamera, die als Nächstes kommt: 2D Zoom ÷ 1,6 um die Mitte, 3D Zoom ÷ 1,3 eine Bildhälfte hinter dem
                // Fokus (die CPU rechnet ihre Kacheln von der Mitte aus – das Gelände hinter der Kamera zuerst), in
                // Vorschau-Auflösung. Nur wenn dort Lücken oder ein grobes Viertel drohen – die Ebenen des Hinflugs decken den
                // Anfang des Rückflugs meist schon, die Zusatz-Ebene nähme sonst der normalen Vorschau den Platz (gemessen).
                // A/B (Messung): ?revpf=0 = ohne diese Ebenen.
                if (FLY.on && !FLY.paused && FLY.sp < -0.02 && Q.get('revpf') !== '0' && !(V3.on && RC.farTick % 3 === 0) && RC.farTick % 2 === 0) {
                    const rd = RC.previewDiv[p.kind], zw = Math.max(FLY.mode === 'place' ? FLY.z0 : 1, view.zoom / (V3.on ? REV_W3 : REV_W)) * (1 + 1e-12);
                    let vw = { cx: view.cx, cy: view.cy, zoom: zw };
                    if (V3.on) { const u = 1.5 / view.zoom, h = V3.heading; vw = { cx: view.cx - HP.fromNumber(Math.sin(h) * u), cy: view.cy - HP.fromNumber(Math.cos(h) * u), zoom: zw }; }
                    let need = V3.on || zw < view.zoom * 0.95;
                    if (need) { const c = coverage(orderLayers(now, vw), vw, { sig, opaque: true, gx: 8, gy: 16, quantile: 0.25 }); need = c.unc > 0.01 || c.q < 0.6 / rd; }
                    if (need) {
                        const rj = startJob(viewKey(vw) + '|rev', rd, p, vw, { preview: true }); rj.part = true; rj.rev = true;
                        RC.revJobs = (RC.revJobs || 0) + 1;
                        if (RC.job && RC.job.kind === 'gpu') { const done = R.pump(RC.job, now, pumpCtl(moving)); if (done) { const j = RC.job; RC.job = null; jobFinished(j, now); } }
                        return;
                    }
                }
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
    // Nur animierte Bewegungen (Flug/Tour/Doppeltipp/Rechteck, Rad, Schwung). Gemessen wird die Schärfe,
    // die das Bild in ~150 ms hätte (Vorhersage + vorhandene Ebenen): fiele das 10-%-Quantil unter
    // 0,4 Pufferpixel pro Bildschirmpixel, sinkt das Tempo weich (bis 0,4×), sonst
    // steigt es wieder auf 1 (Totzone ±10 %, kein Pendeln). Warum 0,4 statt 0,5: Halb-Auflösungs-Vorschauen erreichen mit Vorhersage
    // 0,43–0,5 – eine 0,5-Schwelle bremste auch dann, wenn die Rechnung gut mithält.
    // Pinch/Schieben unter dem Finger bleibt 1:1. Schalter: Mehr → „Tempo an Rechenleistung anpassen".
    function governorUpdate(now, dt) {
        const on = S.governor;
        if (!on || !animating()) { GOV.g = Math.min(1, GOV.g + dt * 3); GOV.coarse = 0; return; }
        // 6.8.1: kurz nach einer Größenänderung (Vollbild, Drehen) Wert halten – die neuen Ränder sind gleich gerechnet,
        // ein Abbremsen wäre im Flug als Ruck zu sehen
        if (now - (RC.resizeT || -1e9) < ctx.RESIZE_GOV_HOLD) return;
        const c = predictCam(0.1, false);
        const cov = coverage(orderLayers(now, c), c, { sig: contentSig(), gx: 10, gy: 20, quantile: 0.1 });
        // 10-%-Quantil der Schärfe (90 % des Bildes sind mindestens so scharf), Totzone ±10 % um die Schwelle
        GOV.q = cov.q;
        const e = (GOV.kmin - cov.q) / GOV.kmin;
        // 6.4: im Flug darf die Bremse bis 30 % gehen (sonst 40 %) – lieber etwas langsamer tauchen als ins Leere
        // (6.6 gemessen: im 2D-Flug jenseits der GPU-Tiefe bringt eine tiefere Grenze, 8 %, kein schärferes Bild – die CPU-Rechnung
        // wird dort mit der Iterationszahl ohnehin nicht fertig: ⅓ Auflösung bei 30 %, ⅕ bei 8 %)
        const gmin = FLY.on && !FLY.paused ? 0.3 : GOV.min;
        if (e > 0.1) GOV.g = Math.max(gmin, GOV.g - dt * 3 * Math.min(1, e));
        else if (e < -0.1) GOV.g = Math.min(1, GOV.g + dt * 0.8);
    }

    return { link() { ({ FADE_MOVE_MS, FLY, GOV, HP, INERTIA_TAU, Q, R, RC, REF, S, V3, addLayer, anchoredCam, animating, cancelFix, cancelJob, cancelPrefetch, canvas, checkInside, clampZoom, contentSig, coverage, cpuFeed, cpuPool, deActive, ensureRef, flightCamAt, fullDone, innActive, isMoving, jobFailed, jobProgress, layerK, layerRect, makeFrame, maxIterFor, orderLayers, plan, predictCam, refUsable, requestRefFor, startFix, stats, t, viewKey, worldPerCss } = ctx); },
             governorUpdate, schedule };
} };
})(typeof self !== 'undefined' ? self : globalThis);
