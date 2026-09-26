// orbit-worker.js — Referenzorbit (BigInt-Fixpunkt) + Referenzwahl (Kern/Gitter) + BLA-Tabellen.
// Läuft komplett abseits des Main-Threads. Version kommt über die eigene URL (?v=…) und wird an
// importScripts weitergereicht (Cache-Busting-Regel: jede Datei mit derselben Version laden).
'use strict';
const V = self.location.search || '';
importScripts('hp.js' + V, 'fractal-core.js' + V);
const C = self.FKCore;

const EPS32 = 2 ** -24, EPS64 = 2 ** -40;
let last = null;   // { id, ref (f64) } für BLA-Neuaufbau

function f32Orbit(ref) { return Float32Array.from(ref.orbit); }

function blaPack(ref, cmax, want64) {
    const out = { cmax };
    out.b32 = C.blaFor(ref, EPS32, cmax, true);
    if (want64) out.b64 = C.blaFor(ref, EPS64, cmax, false);
    return out;
}

self.onmessage = (e) => {
    const q = e.data;
    try {
        if (q.type === 'ref') {
            const t0 = Date.now();
            const r = C.computeReference(q);
            const ref = r.ref;
            // cmax = max |dc| über die Ansicht (mit Reserve): Abstand Mitte->Referenz + Radius
            const dist = Math.hypot(self.FKHP.toNumber(BigInt(q.cx) - BigInt(r.refX)), self.FKHP.toNumber(BigInt(q.cy) - BigInt(r.refY)));
            const cmax = q.cmax > 0 ? q.cmax : 2 * (dist + Math.hypot(q.halfW, q.halfH));
            const b = blaPack(ref, cmax, q.want64);
            last = { id: q.id, ref, want64: q.want64 };
            const msg = {
                type: 'ref', id: q.id, formula: q.formula, refX: r.refX, refY: r.refY,
                baseA: ref.baseA, lenA: ref.lenA, baseB: ref.baseB, lenB: ref.lenB,
                orbit32: f32Orbit(ref), bla32: b.b32, blaCmax: cmax,
                method: r.method, period: r.period, ms: Date.now() - t0,
                maxIter: q.maxIter, zoom: q.zoom, cx: q.cx, cy: q.cy, jx: q.jx, jy: q.jy
            };
            const tr = [msg.orbit32.buffer];
            if (msg.bla32) tr.push(msg.bla32.A.buffer, msg.bla32.R.buffer);
            if (q.want64) {
                msg.orbit64 = ref.orbit.slice();
                msg.bla64 = b.b64;
                tr.push(msg.orbit64.buffer);
                if (b.b64) tr.push(b.b64.A.buffer, b.b64.R.buffer);
            }
            self.postMessage(msg, tr);
        } else if (q.type === 'bla') {
            if (!last || last.id !== q.refId) return;
            const b = blaPack(last.ref, q.cmax, q.want64);
            const msg = { type: 'bla', refId: q.refId, bla32: b.b32, blaCmax: q.cmax, bla64: b.b64 || null };
            const tr = [];
            if (b.b32) tr.push(b.b32.A.buffer, b.b32.R.buffer);
            if (b.b64) tr.push(b.b64.A.buffer, b.b64.R.buffer);
            self.postMessage(msg, tr);
        }
    } catch (err) {
        self.postMessage({ type: 'error', id: q.id, message: String(err && err.stack || err) });
    }
};
