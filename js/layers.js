// layers.js — Ebenen-Stapel: jedes fertige Bild bleibt als Ebene, Reihenfolge nach Schärfe, Abdeckung, Aufräumen
// (Phase 4 des Umbaus 6.5.4: aus js/app.js herausgelöst – Funktionen und Namen unverändert, nur der Ort ist neu.
// app.js ruft create(ctx); Namen aus app.js werden nach dem Anlegen aller Module per link() gebunden, veränderliche
// Variablen der App liest/schreibt das Modul über ctx.<name>.)
(function (root) {
'use strict';

root.FKLayers = { create(ctx) {
    let FADE_MOVE_MS, FADE_MS, HP, MAXL, MAXL3, R, RC, S, V3, canvas, deActive, innActive, smooth01, viewKey, stActive;   // aus app.js, gesetzt in link()

    // Inhalt eines Bildes: was es zeigt (unabhängig von Ansicht/Auflösung). Ebenen mit anderem Inhalt
    // (andere Welt, anderes Julia-c, manuelle Iterationen) liegen ganz unten und werden ausgeblendet.
    // 7.1: Färbe-Stil (+ Streifendichte) gehört zum Inhalt – anderer Stil = neue Rechnung
    function contentSig() { const st = stActive(); return S.formula + '|' + (S.formula === 1 ? S.julia.x + ',' + S.julia.y : '') + '|' + (S.iterManual ? S.iterValue : 'a') + (deActive() ? '|de' : '') + (innActive() ? '|in' : '') + (st ? '|st' + st + (st === 1 ? ':' + S.stS : '') : ''); }
    function makeFrame(job, now) {
        job.buf && (job.kept = true);
        return { buf: job.buf, view: job.view, scale: job.scale, key: job.key, stage: job.stage, formula: job.formula, maxIter: job.maxIter, ms: now - job.t0,
                 kind: job.kind, mode: job.mode, useBLA: job.useBLA, refId: job.refId, julia: job.julia, fixed: !job.err, gpuMs: job.gpuMs,
                 sig: job.sig, prefetch: job.prefetch, preview: job.preview || job.stage > 1, exact: false, de: !!job.de, inn: !!job.inn, st: job.st | 0 };
    }
    function addLayer(fr, now, moving) {
        fr.seq = ++RC.layerSeq;
        fr.t0 = now;
        fr.fadeMs = moving ? FADE_MOVE_MS : FADE_MS;
        RC.layers.push(fr);
        pruneLayers(now);
    }
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

    return { link() { ({ FADE_MOVE_MS, FADE_MS, HP, MAXL, MAXL3, R, RC, S, V3, canvas, deActive, innActive, smooth01, viewKey, stActive } = ctx); },
             addLayer, contentSig, coverage, layerFade, layerK, layerRect, makeFrame, orderLayers, pruneLayers };
} };
})(typeof self !== 'undefined' ? self : globalThis);
