// gestures.js — Pointer-Events-Gestenerkennung (Touch, Maus, Stift).
// Pan (1 Finger), Pinch-Zoom um den Fingermittelpunkt (2 Finger), Trägheit, Doppeltipp,
// Zwei-Finger-Tipp, Langdruck, Mausrad, Shift+Ziehen (Rechteck). Liefert Transformationen
// RELATIV zum Gestenbeginn — die App rechnet daraus die Kamera direkt (kein Nachzieh-Lerp).
(function (root) {
'use strict';

function attach(el, h) {
    const pts = new Map();
    let base = null;             // { ax, ay, d } Anker/Abstand beim (Re-)Start
    let samples = [];            // [{t, ax, ay, ls}] für Trägheit
    let downT = 0, downPos = null, moved = 0, maxPts = 0, multiT = 0;
    let lastTap = null, tapTimer = 0, longTimer = 0, rect = null;

    const now = () => performance.now();
    const anchor = () => {
        const a = [...pts.values()];
        if (a.length === 1) return { ax: a[0].x, ay: a[0].y, d: 1, ang: 0 };
        const ax = (a[0].x + a[1].x) / 2, ay = (a[0].y + a[1].y) / 2;
        return { ax, ay, d: Math.max(10, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)), ang: Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x) };
    };
    const rebase = () => {
        if (!pts.size) { base = null; return; }
        base = anchor();
        h.onStart && h.onStart(base.ax, base.ay);
        samples = [{ t: now(), ax: base.ax, ay: base.ay, ls: 0 }];
    };
    const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = 0; } };

    let orbit = null;                 // rechte Maustaste: Drehen/Neigen (3D)
    el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button === 2 && h.onOrbit) {
            orbit = { x: e.clientX, y: e.clientY, id: e.pointerId };
            el.setPointerCapture && el.setPointerCapture(e.pointerId);
            h.onOrbit(0, 0, 'start');
            return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) {
            downT = now(); downPos = { x: e.clientX, y: e.clientY }; moved = 0; maxPts = 1;
            if (e.shiftKey || (h.rectMode && h.rectMode())) {
                rect = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
                h.onRect && h.onRect(rect, false);
                return;
            }
            clearLong();
            longTimer = setTimeout(() => {
                longTimer = 0;
                if (pts.size === 1 && moved < 10) { h.onLongPress && h.onLongPress(downPos.x, downPos.y); downPos = null; }
            }, 550);
        } else {
            maxPts = Math.max(maxPts, pts.size);
            if (pts.size === 2) multiT = now();
            clearLong();
        }
        if (!rect) rebase();
    });

    el.addEventListener('pointermove', (e) => {
        if (orbit && e.pointerId === orbit.id) { h.onOrbit(e.clientX - orbit.x, e.clientY - orbit.y, 'move'); return; }
        const p = pts.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX; p.y = e.clientY;
        if (rect) { rect.x1 = e.clientX; rect.y1 = e.clientY; h.onRect && h.onRect(rect, false); return; }
        if (downPos) moved = Math.max(moved, Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y));
        if (moved > 10) clearLong();
        if (!base) return;
        const a = anchor();
        const scale = pts.size >= 2 ? a.d / base.d : 1;
        let rot = pts.size >= 2 ? a.ang - base.ang : 0;
        if (rot > Math.PI) rot -= 2 * Math.PI; else if (rot < -Math.PI) rot += 2 * Math.PI;
        h.onTransform && h.onTransform(base.ax, base.ay, a.ax, a.ay, scale, rot, pts.size);
        const t = now();
        samples.push({ t, ax: a.ax, ay: a.ay, ls: Math.log(scale) });
        while (samples.length > 2 && t - samples[0].t > 120) samples.shift();
    });

    const up = (e) => {
        if (orbit && e.pointerId === orbit.id) { orbit = null; h.onOrbit(0, 0, 'end'); return; }
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        clearLong();
        if (rect) { if (!pts.size) { h.onRect && h.onRect(rect, true); rect = null; } return; }
        const t = now();
        if (pts.size > 0) { rebase(); return; }            // Pinch -> Pan mit restlichem Finger
        base = null;
        const dur = t - downT;
        if (e.type === 'pointercancel') return;
        // Zwei-Finger-Tipp
        if (maxPts >= 2 && dur < 350 && moved < 18 && t - multiT < 350) {
            h.onTwoFingerTap && h.onTwoFingerTap(e.clientX, e.clientY);
            lastTap = null; return;
        }
        if (maxPts === 1 && dur < 280 && moved < 10 && downPos) {
            if (lastTap && t - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
                clearTimeout(tapTimer); lastTap = null;
                h.onDoubleTap && h.onDoubleTap(e.clientX, e.clientY);
            } else {
                lastTap = { t, x: e.clientX, y: e.clientY };
                const x = e.clientX, y = e.clientY;
                clearTimeout(tapTimer);
                tapTimer = setTimeout(() => { if (lastTap && lastTap.t === t) { lastTap = null; h.onTap && h.onTap(x, y); } }, 320);
            }
            return;
        }
        // Trägheit aus den letzten ~100 ms
        let vx = 0, vy = 0, vs = 0;
        if (samples.length >= 2) {
            const a = samples[0], b = samples[samples.length - 1];
            const dt = Math.max(16, b.t - a.t) / 1000;
            if (t - b.t < 80) { vx = (b.ax - a.ax) / dt; vy = (b.ay - a.ay) / dt; vs = (b.ls - a.ls) / dt; }
        }
        h.onEnd && h.onEnd(vx, vy, vs, samples.length ? samples[samples.length - 1] : null);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
        const k = e.ctrlKey ? 0.01 : 0.0022;               // ctrl = Trackpad-Pinch
        const f = Math.exp(-Math.max(-600, Math.min(600, dy)) * k);
        h.onWheel && h.onWheel(e.clientX, e.clientY, f);
    }, { passive: false });

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return { active: () => pts.size > 0 };
}

root.FKGestures = { attach };
})(typeof self !== 'undefined' ? self : globalThis);
