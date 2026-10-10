// cpu-pool.js — CPU-Worker-Pool (Kacheln in f64, Buddhabrot) und exakte Nachrechnung unsicherer GPU-Pixel
// (Phase 4 des Umbaus 6.5.4: aus js/app.js herausgelöst – Funktionen und Namen unverändert, nur der Ort ist neu.
// app.js ruft create(ctx); Namen aus app.js werden nach dem Anlegen aller Module per link() gebunden, veränderliche
// Variablen der App liest/schreibt das Modul über ctx.<name>.)
(function (root) {
'use strict';

root.FKCpuPool = { create(ctx) {
    let HP, R, RC, REF, V, addLayer, buddhaMerge, cancelJob, fullDone, stats, t, toast;   // aus app.js, gesetzt in link()

    const nCpu = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    const cpuWorkers = [];
    function cpuPool() {
        if (cpuWorkers.length) return cpuWorkers;
        for (let i = 0; i < nCpu; i++) {
            const w = new Worker('js/tile-worker.js' + V);
            w.busy = 0;
            w.onmessage = onCpuMessage;
            // P2-1: Worker-Skript fehlt/defekt (z. B. offline nach einem Update) -> laufende Arbeit abbrechen statt ewig zu warten
            w.onerror = (e) => { console.warn('CPU-Worker:', e.message || e); e.preventDefault && e.preventDefault(); w.busy = 0; cancelJob(); cancelFix(); toast(t('worker_failed'), 4500); };
            cpuWorkers.push(w);
            if (REF.cur && REF.cur.orbit64) sendRefTo(w, REF.cur);
        }
        return cpuWorkers;
    }
    function sendRefTo(w, m) { w.postMessage({ type: 'ref', id: m.id, formula: m.formula, orbit: m.orbit64, baseA: m.baseA, lenA: m.lenA, baseB: m.baseB, lenB: m.lenB, bla: m.bla64 || null }); }
    function cpuSendRef(m) { if (cpuWorkers.length) cpuWorkers.forEach(w => sendRefTo(w, m)); }
    function cpuBroadcast(msg) { cpuWorkers.forEach(w => w.postMessage(msg)); }
    function onCpuMessage(e) {
        const m = e.data, w = e.target;
        w.busy = Math.max(0, w.busy - 1);
        if (RC.cap && RC.cap.onCpu && RC.cap.onCpu(m, w)) return;      // 6.8.1 Screenshot-Kacheln (js/capture.js)
        if (m.type === 'buddha') { buddhaMerge(m); return; }
        if (m.type === 'pixels') { onFixPixels(m, w); return; }
        const job = RC.job && RC.job.id === m.jobId ? RC.job : (RC.pjob && RC.pjob.id === m.jobId ? RC.pjob : null);
        if (!job || job.kind !== 'cpu' || job.done) { cpuFeed(); return; }
        if (m.missingRef) { if (REF.cur && REF.cur.orbit64) sendRefTo(w, REF.cur); job.tiles.push({ x: m.x, y: m.y, w: m.w, h: m.h }); cpuFeed(); return; }
        R.uploadTile(job, m.x, m.y, m.w, m.h, m.data, m.de);
        job.tilesDone++;
        if (job.tilesDone >= job.tilesTotal) { job.done = true; job.gpuMs = performance.now() - job.gpuStart; }
        cpuFeed();
    }
    function cpuFeed() {
        if (RC.cap && RC.cap.feed) { RC.cap.feed(cpuWorkers); return; }   // 6.8.1: während eines Screenshots nur dessen Arbeit
        fixFeed();
        let job = RC.job;
        // Vorausrechnen nur, wenn der sichtbare Job und die Nachrechnung keine Worker brauchen
        if ((!job || job.kind !== 'cpu' || job.done || !job.tiles.length) && !RC.fix && RC.pjob && RC.pjob.kind === 'cpu' && !RC.pjob.done) job = RC.pjob;
        if (!job || job.kind !== 'cpu' || job.done) return;
        // (P2-8: „in Bewegung nur eine Kachel je Worker“ wurde gemessen und verworfen – die erste Kachel einer neuen Ansicht kam
        // damit später, Median 635 statt 225 ms; begrenzt wird stattdessen die Arbeit je Kachel, siehe startJob)
        for (const w of cpuWorkers) {
            while (w.busy < 2 && job.tiles.length) {
                const tl = job.tiles.shift();
                w.busy++;
                w.postMessage(Object.assign({ type: 'tile', jobId: job.id, refId: job.refId, bufW: job.w, bufH: job.h, scale: job.scale,
                    mode: job.mode, formula: job.formula, maxIter: job.maxIter, useBLA: job.useBLA, de: job.de, inn: job.inn,
                    offX: job.cpuOff[0], offY: job.cpuOff[1], jx: job.julia[0], jy: job.julia[1] }, tl));
            }
        }
    }
    // Der finale GPU-Pass markiert Pixel, deren f32-Fehlerschätzung > 0.7 Iterationen ist. Diese
    // (typisch 0–40 %) rechnet der CPU-Pool in f64 nach; Ergebnis wird in eine Pufferkopie gestreut
    // und weich eingeblendet. Danach ist das Bild fertig und ändert sich nicht mehr.
    function startFix(fr, now) {
        const fix = { fr, key: fr.key, t0: now, chunks: [], sent: 0, done: 0, total: 0, id: ++RC.jobSeq, buf: null };
        RC.fix = fix;
        let unsure;
        try { unsure = R.findUnsure(fr.buf); }
        catch (e) { if (!e.shaderKey) throw e; RC.fix = null; fr.fixed = fr.exact = true; fullDone(fr, now); return; }   // P1-2: ohne Nachrechnung bleibt das f32-Bild
        unsure.then((list) => {
            if (RC.fix !== fix) return;
            if (!list) { RC.fix = null; return; }
            fix.count = list.length / 2;
            stats.lastFix = { count: fix.count, pct: +(100 * fix.count / (fr.buf.w * fr.buf.h)).toFixed(1) };
            if (!fix.count) { fr.fixed = true; fr.exact = true; RC.fix = null; RC.dirty = true; fullDone(fr, performance.now()); return; }
            if (fr.mode === 'perturb') {
                const r = REF.cur;
                if (!r || r.id !== fr.refId || !r.orbit64) { RC.fix = null; recompute(fr); return; }   // Referenz gewechselt -> neu rechnen
                fix.off = [HP.toNumber(fr.view.cx - r.refXb), HP.toNumber(fr.view.cy - r.refYb)];
                fix.useBLA = !!r.bla64;
            } else fix.off = [HP.toNumber(fr.view.cx), HP.toNumber(fr.view.cy)];
            fix.buf = R.copyBuffer(fr.buf);
            const CH = 1536;
            for (let i = 0; i < list.length; i += 2 * CH) fix.chunks.push(list.slice(i, Math.min(list.length, i + 2 * CH)));
            fix.total = fix.chunks.length;
            cpuPool();
            fixFeed();
        });
    }
    // finales Bild, dessen Nachrechnung nicht mehr möglich ist (Referenz gewechselt): als Vorschau behandeln -> schedule
    // rechnet die finale Stufe neu (nur stage = 2 genügte nicht: schedule startete wieder die Nachrechnung, endlos)
    function recompute(fr) { fr.stage = 2; fr.preview = true; RC.dirty = true; }
    function fixMsg(fix, chunk, list) {
        const fr = fix.fr;
        return { type: 'pixels', jobId: fix.id, chunk, list, refId: fr.refId, bufW: fr.buf.w, bufH: fr.buf.h, scale: fr.scale,
                 mode: fr.mode, formula: fr.formula, maxIter: fr.maxIter, useBLA: fix.useBLA, offX: fix.off[0], offY: fix.off[1], jx: fr.julia[0], jy: fr.julia[1], inn: fr.inn };
    }
    function fixFeed() {
        const fix = RC.fix;
        if (!fix || !fix.total) return;
        for (const w of cpuWorkers) {
            while (w.busy < 2 && fix.sent < fix.total) {
                w.busy++;
                w.postMessage(fixMsg(fix, fix.sent, fix.chunks[fix.sent]));
                fix.sent++;
            }
        }
    }
    function onFixPixels(m, w) {
        const fix = RC.fix;
        if (!fix || m.jobId !== fix.id) { cpuFeed(); return; }
        if (m.missingRef) {
            // Referenz der Nachrechnung gibt es nicht mehr: abbrechen und neu rechnen statt dasselbe Paket endlos zu schicken
            if (!REF.cur || REF.cur.id !== fix.fr.refId) { const fr = fix.fr; cancelFix(); recompute(fr); cpuFeed(); return; }
            if (REF.cur.orbit64) sendRefTo(w, REF.cur);
            w.busy++; w.postMessage(fixMsg(fix, m.chunk, m.list)); return;
        }
        try { R.scatter(fix.buf, m.list, m.values); }
        catch (e) { console.warn('Nachrechnung:', e.message); const fr = fix.fr; cancelFix(); fr.fixed = fr.exact = true; RC.dirty = true; fullDone(fr, performance.now()); cpuFeed(); return; }
        fix.done++;
        if (fix.done >= fix.total) {
            const now = performance.now();
            const fr = Object.assign({}, fix.fr, { buf: fix.buf, fixed: true, exact: true, h3d: null, shown: false, outT: 0 });   // eigener Puffer -> eigene 3D-Höhentextur
            stats.lastFix.ms = now - fix.t0;
            RC.fix = null;
            addLayer(fr, now, false);
            RC.front = fr;
            RC.dirty = true;
            fullDone(fr, now);
        }
        cpuFeed();
    }
    function cancelFix() {
        const fix = RC.fix;
        if (!fix) return;
        RC.fix = null;
        if (fix.buf) R.releaseFrame({ buf: fix.buf });
    }

    return { link() { ({ HP, R, RC, REF, V, addLayer, buddhaMerge, cancelJob, fullDone, stats, t, toast } = ctx); },
             cancelFix, cpuBroadcast, cpuFeed, cpuPool, cpuSendRef, cpuWorkers, recompute, startFix };
} };
})(typeof self !== 'undefined' ? self : globalThis);
