// refs.js — Referenzorbit und BLA-Tabellen: Orbit-Worker, Anfragen, Tauglichkeit der Referenz für die Ansicht
// (Phase 4 des Umbaus 6.5.4: aus js/app.js herausgelöst – Funktionen und Namen unverändert, nur der Ort ist neu.
// app.js ruft create(ctx); Namen aus app.js werden nach dem Anlegen aller Module per link() gebunden, veränderliche
// Variablen der App liest/schreibt das Modul über ctx.<name>.)
(function (root) {
'use strict';

root.FKRefs = { create(ctx) {
    let FLY, HP, R, RC, S, V, autoIter, cancelFix, cancelJob, cancelPrefetch, cpuBroadcast, cpuSendRef, currentMaxIter, flightCamAt, innActive, recompute, worldPerCss;   // aus app.js, gesetzt in link()

    const orbitWorker = new Worker('js/orbit-worker.js' + ctx.V);   // beim Anlegen (vor link()): Version direkt aus ctx
    const REF = { cur: null, pending: null, queued: null, seq: 0, blaPending: false, lastReqT: 0 };
    orbitWorker.onmessage = (e) => {
        const m = e.data;
        // P3-9: dieselbe Anfrage nicht sofort im nächsten Bild wiederholen (Konsole liefe voll, Worker rechnete dauernd) – 5 s Sperre
        if (m.type === 'error') { console.warn('Orbit-Worker:', m.message); if (REF.pending) REF.fail = { sig: REF.pending.sig, t: performance.now() }; REF.pending = null; return; }
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
    function viewHalf() { const s = worldPerCss(S.cam.zoom); return [s * ctx.cssW / 2, s * ctx.cssH / 2]; }
    // Bei Flügen/Touren den Referenzorbit gleich fürs ZIEL rechnen: das Ziel liegt während der
    // ganzen Fahrt im Bild, eine Referenz reicht dann für alle Zwischenbilder.
    function refTarget() {
        if (FLY.on && FLY.mode === 'place' && FLY.target) return FLY.target;
        if (ctx.flight) return ctx.flight.anchor ? flightCamAt(ctx.flight, 1) : ctx.flight.b;
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
        const s = 3 / (tg.zoom * ctx.cssH);
        const q = {
            type: 'ref', id: 0, formula: S.formula,
            cx: tg.cx.toString(), cy: tg.cy.toString(),
            jx: S.julia.x.toString(), jy: S.julia.y.toString(),
            zoom: tg.zoom, maxIter: S.iterManual ? S.iterValue : autoIter(tg.zoom * 16),
            halfW: s * ctx.cssW / 2 * 1.3, halfH: s * ctx.cssH / 2 * 1.3, pixel: s / ctx.dpr,
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
        if (REF.fail && REF.fail.sig === sig && performance.now() - REF.fail.t < 5000) return;
        q.sig = sig;
        sendRef(q);
    }
    function sendRef(q) {
        q.id = ++REF.seq;
        REF.pending = q;
        REF.lastReqT = performance.now();
        orbitWorker.postMessage(q);
    }
    // 6.8.1 Screenshot: BLA-Tabelle für einen größeren Umkreis cmax (Welt) neu bauen lassen (O(N) im Worker)
    function requestBLA(cmax) {
        const r = REF.cur;
        if (!r || REF.blaPending) return;
        REF.blaPending = true;
        orbitWorker.postMessage({ type: 'bla', refId: r.id, cmax, want64: !!r.orbit64 });
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

    return { link() { ({ FLY, HP, R, RC, S, V, autoIter, cancelFix, cancelJob, cancelPrefetch, cpuBroadcast, cpuSendRef, currentMaxIter, flightCamAt, innActive, recompute, worldPerCss } = ctx); },
             REF, ensureRef, refUsable, requestRefFor, requestBLA };
} };
})(typeof self !== 'undefined' ? self : globalThis);
