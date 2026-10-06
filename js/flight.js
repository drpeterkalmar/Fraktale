// flight.js — 3D-Flug: Zufallsflug am Mengenrand und Ziel-Flug, Lenkung aus der Sonde, Ausrichten
// (Phase 4 des Umbaus 6.5.4: aus js/app.js herausgelöst – Funktionen und Namen unverändert, nur der Ort ist neu.
// app.js ruft create(ctx); Namen aus app.js werden nach dem Anlegen aller Module per link() gebunden, veränderliche
// Variablen der App liest/schreibt das Modul über ctx.<name>.)
(function (root) {
'use strict';

root.FKFlight = { create(ctx) {
    let GOV, HP, MODE_HOME, Q, S, T3, V3, can3d, clampZoom, emit, look, ready3d, set3d, setCam, setJulia, setMode, smooth01, stopAnims, t, toast;   // aus app.js, gesetzt in link()

    const FLY = { on: false, paused: false, mode: 'random', target: null, hdgT: 0, z0: 1, off0: 0, dir: [0, 1] };
    // Flug: Zoom + Vorwärtsflug. Gezoomt wird um einen Punkt vor dem Fokus -> die Kamera gleitet vorwärts und
    // taucht tiefer; Berge wirken in jeder Tiefe gleich hoch (lokale Einheiten).
    // Ziel-Flug: Start im Gesamtbild (wie ▶ Tour), gerade auf den Ort zu, Ankunft exakt am Ort.
    // Zufallsflug 6.2 („sanft, am Mengenrand"): Der Zoompunkt FLY.A (lokal, Welt-Achsen) ist der Fixpunkt des Zooms –
    // bliebe er stehen, flöge die Kamera genau auf diesen Weltpunkt zu. Er gleitet weich (begrenzte Geschwindigkeit)
    // zu einem Ziel FLY.T im Korridor knapp außerhalb der Menge (Distanz zur Menge ≈ 0,05–0,3 Bildhälften, aus der
    // Distanzschätzung der Sonde). Weil die Distanz eines festen Punkts in lokalen Einheiten mit dem Zoom wächst, wird
    // das Ziel alle 300 ms nachgeführt (lokale Suche ±0,2) und nur mit Hysterese (+25 %, ≥ 1,5 s gehalten) gegen ein
    // besseres getauscht. Der Kurs folgt der Richtung des Zoompunkts als gedämpftes System (Drehrate ≤ FLY_TURN,
    // begrenzte Drehbeschleunigung, leichte Schräglage in Kurven).
    // A/B: ?flyturn=R = maximale Drehrate (rad/s). (?flyedge=0 = 6.1.0 und ?flyhold=0 = 6.4.0 sind seit 6.5.4 entfernt;
    // die Kurswahl von 6.1.0, flySteer, bleibt der Rückfall, solange die Sonde keine Distanzdaten liefert.)
    const FLY_AHEAD = 0.55;
    const FLY_TURN = ctx.Q.has('flyturn') ? Math.max(0.02, +ctx.Q.get('flyturn') || 0.3) : 0.3;   // beim Anlegen (vor link()): Q direkt aus ctx
    const FLY_ACC = 0.5;          // max. Drehbeschleunigung (rad/s²)
    const FLY_DE = 0.04;          // Zoompunkt höchstens so weit von der Menge (Bildhälften)
    const FLY_RMIN = 0.25, FLY_RMAX = 0.7, FLY_RPREF = 0.45;   // Zoompunkt vor dem Fokus (Bildhälften)
    function startFly(place) {
        if (!can3d(place && place.formula !== undefined ? place.formula : S.formula)) return;
        // 6.3: Shader noch nicht fertig -> erst vorbereiten (2D bleibt bedienbar), dann diesen Flug starten
        if (!V3.on && T3 && !ready3d()) { V3.prepFly = place || true; if (!V3.prep) { V3.prep = performance.now(); emit('3d'); } return; }
        stopAnims();
        if (place) {
            setMode(place.formula || 0, true);
            if (place.jx) setJulia(HP.fromString(place.jx), HP.fromString(place.jy));
            const home = MODE_HOME[S.formula];
            setCam(HP.fromString(home[0]), HP.fromString(home[1]), home[2]);
            S.iterManual = false;
            const T = { cx: HP.fromString(place.cx), cy: HP.fromString(place.cy), zoom: +place.zoom };
            const u = 1.5 / S.cam.zoom;
            const ox = HP.toNumber(T.cx - S.cam.cx) / u, oy = HP.toNumber(T.cy - S.cam.cy) / u;
            const d = Math.hypot(ox, oy);
            FLY.mode = 'place'; FLY.target = T; FLY.z0 = S.cam.zoom; FLY.off0 = d;
            FLY.dir = d > 1e-9 ? [ox / d, oy / d] : [0, 1];
            V3.heading = Math.atan2(FLY.dir[0], FLY.dir[1]);
        } else { FLY.mode = 'random'; FLY.target = null; }
        set3d(true);
        FLY.on = true; FLY.paused = false; FLY.hdgT = V3.heading; FLY.user = 0; FLY.userBase = 0; FLY.lost = 0;
        // 6.2: Zoompunkt startet geradeaus, Kurs ruhend
        const f = [Math.sin(V3.heading), Math.cos(V3.heading)];
        FLY.A = [f[0] * FLY_AHEAD, f[1] * FLY_AHEAD]; FLY.VA = [0, 0]; FLY.T = null; FLY.Tt = 0; FLY.om = 0; FLY.roll = 0;
        FLY.userPrev = 0; FLY.userT = -1e9; FLY.zf = 1; FLY.glide = null; FLY.dA = null; FLY.gap = false;
        emit('fly');
    }
    // Ausrichten: Drehung weich auf Norden, Neigung auf den Standard
    function north3d() { V3.northT = performance.now(); V3.northFrom = [V3.heading, V3.tilt]; stopFly(); }
    function stopFly() { if (!FLY.on) return; FLY.on = false; FLY.paused = false; ctx.camDirty = true; emit('fly'); }
    function pauseFly(p) { if (!FLY.on) return; FLY.paused = p === undefined ? !FLY.paused : p; emit('fly'); }
    // ein Flugschritt (rein rechnerisch, auch für die Vorhersage): liefert { cam, heading }
    function flyStep(cam, heading, dt) {
        const g = GOV.g, dec = S.flySpeed * dt * g;
        if (FLY.mode === 'place' && FLY.target) {
            const T = FLY.target;
            const z1 = Math.min(T.zoom, cam.zoom * Math.pow(10, dec));
            const p = Math.min(1, Math.log(z1 / FLY.z0) / Math.max(1e-9, Math.log(T.zoom / FLY.z0)));
            const off = FLY.off0 * Math.pow(1 - p, 1.5), u = 1.5 / z1;
            return { cam: { cx: T.cx - HP.fromNumber(FLY.dir[0] * off * u), cy: T.cy - HP.fromNumber(FLY.dir[1] * off * u), zoom: z1 }, heading, done: z1 >= T.zoom };
        }
        // über einer leeren Ebene "verloren": kaum noch tiefer, dafür seitlich zum nächsten Rand gleiten
        const lost = Math.min(1, FLY.lost || 0);
        const u = 1.5 / cam.zoom, f = [Math.sin(heading), Math.cos(heading)];
        const z1 = clampZoom(cam.zoom * Math.pow(10, dec * (1 - 0.95 * lost) * (FLY.zf || 1)));
        // 6.4: verloren -> erst zum Randstück drehen, dann vorwärts dorthin gleiten (statt seitlich zu rutschen)
        const al = FLY.glide ? Math.max(0, f[0] * FLY.glide[0] + f[1] * FLY.glide[1]) : 1;
        const k = 1 - cam.zoom / z1, gl = lost * 0.8 * (FLY.glide ? FLY.gv : 1) * al * dt * g, lat = gl * u;
        return { cam: { cx: cam.cx + HP.fromNumber(FLY.A[0] * u * k + f[0] * lat), cy: cam.cy + HP.fromNumber(FLY.A[1] * u * k + f[1] * lat), zoom: z1 }, heading, done: z1 >= 1e28, lat: [f[0] * gl, f[1] * gl] };
    }
    function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
    const rot2 = (v, a) => [v[0] * Math.cos(a) + v[1] * Math.sin(a), -v[0] * Math.sin(a) + v[1] * Math.cos(a)];   // Kurs +a (im Uhrzeigersinn)
    function flyUpdate(now, dt) {
        if (FLY.mode === 'random') {
            if (V3.probe && V3.probe.seq !== FLY.probeSeq) { FLY.probeSeq = V3.probe.seq; flyEdgeSteer(now); }
            // Wischen: Zoompunkt und Ziel um den Fokus drehen (der Kurs folgt gedämpft), danach führt die Automatik
            // von der neuen Richtung aus weiter
            const du = (FLY.user || 0) - (FLY.userPrev || 0);
            if (du) { FLY.A = rot2(FLY.A, du); if (FLY.T) FLY.T = rot2(FLY.T, du); FLY.userPrev = FLY.user; FLY.userT = now; FLY.Tt = now; }
            const g = GOV.g, sp = S.flySpeed * g;
            // Zoompunkt gleitet zum Ziel: Geschwindigkeit begrenzt, Änderung der Geschwindigkeit weich
            if (FLY.T) {
                const dx = FLY.T[0] - FLY.A[0], dy = FLY.T[1] - FLY.A[1], d = Math.hypot(dx, dy);
                const vmax = 0.12 + 0.5 * sp, v = Math.min(vmax, d * 1.6);
                const vx = d > 1e-9 ? dx / d * v : 0, vy = d > 1e-9 ? dy / d * v : 0;
                const kv = Math.min(1, dt * 3);
                FLY.VA = [FLY.VA[0] + (vx - FLY.VA[0]) * kv, FLY.VA[1] + (vy - FLY.VA[1]) * kv];
                FLY.A = [FLY.A[0] + FLY.VA[0] * dt, FLY.A[1] + FLY.VA[1] * dt];
                // Zoomtempo weich drosseln, solange der Zoompunkt noch weit vom Ziel ist (erst hingleiten, dann tauchen)
                let zfT = 1 - 0.55 * smooth01((d - 0.12) / 0.45);
                // 6.4 Vorausschau: Die Distanz des Zoompunkts zum Rand wächst beim Tauchen mit dem Zoom – schon bremsen, wenn
                // sie in ~0,4 s aus dem Band (≈ 0,08 Bildhälften) liefe; die Lenkung holt den Zoompunkt derweil zurück an
                // den Rand. Datenlücke: langsam weiter, bis das Bild voraus gerechnet ist.
                if (FLY.gap) zfT *= 0.3;
                if (FLY.dA !== null && FLY.dA !== undefined) zfT *= 1 - 0.85 * smooth01((FLY.dA * Math.pow(10, sp * 0.4) - 0.08) / 0.3);
                // bremsen schnell, beschleunigen weich
                FLY.zf += (zfT - FLY.zf) * Math.min(1, dt * (zfT < FLY.zf ? 5 : 1.5));
            }
            // Zoompunkt im Vorwärtsbereich halten (0,25–0,7 Bildhälften)
            const ra = Math.hypot(FLY.A[0], FLY.A[1]);
            if (ra < FLY_RMIN || ra > FLY_RMAX) { const c = Math.max(FLY_RMIN, Math.min(FLY_RMAX, ra)) / Math.max(1e-9, ra); FLY.A = [FLY.A[0] * c, FLY.A[1] * c]; }
            // Kurs: gedämpfte Drehung zur Richtung des Zoompunkts (kritisch gedämpft, Rate und Beschleunigung begrenzt)
            const err = angDiff(Math.atan2(FLY.A[0], FLY.A[1]), V3.heading);
            const lost = Math.min(1, FLY.lost || 0);
            const wmax = FLY_TURN * (1 + 0.5 * lost);
            const K = 1.4, acc = Math.max(-FLY_ACC * (1 + lost), Math.min(FLY_ACC * (1 + lost), K * err - 2 * Math.sqrt(K) * FLY.om));
            FLY.om = Math.max(-wmax, Math.min(wmax, FLY.om + acc * dt));
            V3.heading += FLY.om * dt;
            // leichte Schräglage in Kurven (max. ~6°), weich
            FLY.roll += (-0.35 * FLY.om - FLY.roll) * Math.min(1, dt * 2);
        }
        const z0 = S.cam.zoom;
        const st = flyStep(S.cam, V3.heading, dt);
        setCam(st.cam.cx, st.cam.cy, st.cam.zoom);
        if (FLY.mode === 'random' && FLY.T) {
            // Ziel ist ein Weltpunkt: der Zoom (Fixpunkt A) schiebt es in lokalen Einheiten nach außen, Gleiten verschiebt es
            const q = S.cam.zoom / z0;
            FLY.T = [FLY.A[0] + (FLY.T[0] - FLY.A[0]) * q, FLY.A[1] + (FLY.T[1] - FLY.A[1]) * q];
            if (st.lat) FLY.T = [FLY.T[0] - st.lat[0], FLY.T[1] - st.lat[1]];
        }
        if (FLY.rec) FLY.rec.push([+now.toFixed(1), +V3.heading.toFixed(5), S.cam.zoom, +(FLY.om || 0).toFixed(5), +(FLY.lost || 0).toFixed(2)]);
        if (st.done) { stopFly(); if (FLY.mode === 'random') toast(t('fly_max')); }
    }
    // Kurswahl aus der Sonde (alle 300 ms): Kandidaten bis ±150° um den aktuellen Kurs, Wertung entlang des
    // Strahls (0,3–1,3 Bildhälften, nahe stärker): Randnähe + Detail positiv, leere Ebene negativ, Inneres
    // (Schwarz) stark negativ, Abweichung vom Kurs leicht negativ. Ist alles voraus flach: "verloren". (6.1.0; seit 6.2 nur
    // noch Rückfall, solange die Sonde keine Distanzdaten hat)
    function flySteer() {
        const pb = V3.probe;
        if (!pb) return;
        const at = (x, y) => {
            const i = Math.floor((x / pb.win * 0.5 + 0.5) * pb.w), j = Math.floor((y / pb.win * 0.5 + 0.5) * pb.h);
            if (i < 1 || j < 1 || i >= pb.w - 1 || j >= pb.h - 1) return null;
            return [pb.data[j * pb.w + i], pb.data[j * pb.w + i + 1], pb.data[(j + 1) * pb.w + i], pb.data[j * pb.w + i - 1], pb.data[(j - 1) * pb.w + i]];
        };
        const L0 = V3.L[0], inv = 1 / Math.max(0.3, V3.L[1] - V3.L[0]);
        const hn = (v) => v < 0 ? -1 : (Math.log2(1 + (S.formula === 5 ? v % 1000 : v)) - L0) * inv;
        let best = null;
        const h0 = V3.heading;
        for (const da of [0, -0.3, 0.3, -0.65, 0.65, -1.0, 1.0, -1.5, 1.5, -2.1, 2.1, -2.6, 2.6]) {
            const h = h0 + da;
            let sc = -Math.abs(da) * 0.35, n = 0, flat = 0;
            for (const [r, w] of [[0.3, 1.4], [0.55, 1.6], [0.85, 1.0], [1.25, 0.6]]) {
                const s5 = at(Math.sin(h) * r, Math.cos(h) * r);
                if (!s5 || s5.some(Number.isNaN)) continue;
                n++;
                const a0 = hn(s5[0]);
                if (a0 < 0) { sc -= 3 * w; continue; }
                let det = 0;
                for (let q = 1; q < 5; q++) det += Math.abs(a0 - Math.max(-0.2, hn(s5[q])));
                det = Math.min(1, det * 1.5);
                if (det < 0.08 && a0 < 0.35) flat++;
                sc += w * (det + 0.6 * a0 - 0.45);
            }
            if (!n) continue;
            if (!best || sc > best.sc) best = { sc, h, flat: flat >= n - 1 };
        }
        if (!best) return;
        FLY.hdgT = best.h;
        const here = best.flat && Math.abs(angDiff(best.h, h0)) < 0.7;
        FLY.lost = Math.max(0, Math.min(1.5, (FLY.lost || 0) + (here ? 0.25 : -0.4)));
    }
    // 6.2: Zielwahl am Mengenrand aus der Distanzschätzung der Sonde (bei jeder neuen Sonde, ~150 ms).
    // Die Sonde wurde für eine etwas ältere Kamera aufgenommen (Auslesen asynchron) – im Flug ist der Zoom seitdem um
    // bis zu ×1,5 gewachsen. Alle Positionen werden darum zwischen Sonden- und aktueller Kamera umgerechnet (probeMap).
    // Wertung einer Stelle: voll bis FLY_DE, darüber abfallend (halbe Höhe bei ×3), leere Ebene (Abstand > 0,25)
    // zunehmend negativ, innen stark negativ, viel Menge in der Umgebung (Minibrot-Inneres, große Mengenfläche)
    // negativ, Detail und Randdichte in der Umgebung positiv.
    function probeMap(pb) {
        const c = pb.cam || S.cam, u = 1.5 / S.cam.zoom, up = 1.5 / c.zoom, k = u / up;
        const ox = HP.toNumber(S.cam.cx - c.cx) / up, oy = HP.toNumber(S.cam.cy - c.cy) / up;
        return { k, toP: (x, y) => [ox + x * k, oy + y * k], fromP: (x, y) => [(x - ox) / k, (y - oy) / k] };
    }
    function flyEdgeSteer(now) {
        const pb = V3.probe;
        if (!pb) return;
        if (FLY.rec && T3.lastCam) FLY.recM.push(flyMetrics(pb, now));
        if (!pb.hasDE) { flySteer(); const f = [Math.sin(FLY.hdgT), Math.cos(FLY.hdgT)]; FLY.T = [f[0] * FLY_AHEAD, f[1] * FLY_AHEAD]; FLY.glide = null; return; }
        const W = pb.w, H = pb.h, M = probeMap(pb);
        const cellIdx = (px, py) => { const i = Math.floor((px / pb.win * 0.5 + 0.5) * W), j = Math.floor((py / pb.win * 0.5 + 0.5) * H); return i < 3 || j < 3 || i >= W - 3 || j >= H - 3 ? -1 : j * W + i; };
        const idx = (x, y) => { const q = M.toP(x, y); return cellIdx(q[0], q[1]); };
        const deC = (k) => pb.de[k] / M.k;          // Distanz in aktuellen lokalen Einheiten
        const L0 = V3.L[0], inv = 1 / Math.max(0.3, V3.L[1] - V3.L[0]);
        const hn = (v) => v < 0 ? 0 : (Math.log2(1 + (S.formula === 5 ? v % 1000 : v)) - L0) * inv;
        const LN = Math.log2(3);
        const score = (k) => {
            const d0 = pb.de[k];
            if (Number.isNaN(d0)) return null;
            if (d0 === 0) return -3;
            const d = d0 / M.k;
            // bis FLY_DE voll (dicht am Rand bleibt ein Punkt über viele Zoomstufen randnah), darüber abfallend
            // (halbe Höhe bei ×3), ab 0,25 (leer) zunehmend negativ; je dichter am Rand, desto etwas besser
            const x = Math.max(0, Math.log2(d / FLY_DE) / LN);
            let s = Math.exp(-0.69 * x * x) - 0.45 * Math.max(0, Math.log2(d / 0.25)) + 0.15 * Math.min(1, Math.max(0, -Math.log2(d / FLY_DE) / 4));
            // Umgebung (7×7 Zellen): viel Menge (Minibrot-Inneres, große Fläche) negativ, Detail und Randdichte positiv
            const i0 = k % W, j0 = (k - i0) / W;
            let nin = 0, nv = 0, det = 0, nedge = 0;
            const h0 = hn(pb.data[k]);
            for (let j = j0 - 3; j <= j0 + 3; j += 1) for (let i = i0 - 3; i <= i0 + 3; i += 1) {
                const q = j * W + i, e = pb.de[q];
                if (Number.isNaN(e)) continue;
                nv++; if (e === 0) nin++; else { det += Math.abs(hn(pb.data[q]) - h0); if (e / M.k < 0.3) nedge++; }
            }
            if (nv) { s -= 2.5 * Math.max(0, nin / nv - 0.45); s += 0.3 * Math.min(1, det / nv * 4) + 0.4 * nedge / nv; }
            return s;
        };
        const h0 = V3.heading;
        const userHold = now - FLY.userT < 3000;
        const A = FLY.A;
        const lim = userHold ? 0.6 : Math.PI / 2;     // Vorwärtsbereich ±90° (Wischen: ±35° für 3 s); Anflug sucht ringsum (bestAll)
        let bestF = null, bestAll = null, hiIt = null, nFwd = 0, nFwdOk = 0;
        for (let j = 3; j < H - 3; j += 2) for (let i = 3; i < W - 3; i += 2) {
            const k = j * W + i, d0 = pb.de[k];
            const [x, y] = M.fromP(((i + 0.5) / W * 2 - 1) * pb.win, ((j + 0.5) / H * 2 - 1) * pb.win), r = Math.hypot(x, y);
            if (r >= FLY_RMIN && r <= 1 && Math.abs(angDiff(Math.atan2(x, y), h0)) < Math.PI / 2) { nFwd++; if (!Number.isNaN(d0)) nFwdOk++; }
            if (Number.isNaN(d0)) continue;
            if (r < FLY_RMIN) continue;
            if (d0 > 0 && r > 0.5 && (!hiIt || pb.data[k] > hiIt.v)) hiIt = { v: pb.data[k], x, y };   // höchste Iteration = Richtung zur Menge
            const sc = score(k);
            if (sc === null) continue;
            const db = Math.abs(angDiff(Math.atan2(x, y), h0));
            if (!bestAll || sc > bestAll.sc) bestAll = { sc, x, y };
            if (r > FLY_RMAX || db > lim) continue;
            const tot = sc - 0.3 * Math.hypot(x - A[0], y - A[1]) - 0.18 * db - 0.4 * Math.max(0, r - FLY_RPREF);
            if (!bestF || tot > bestF.tot) bestF = { tot, sc, x, y };
        }
        // Ziel lokal nachführen: Hügelsteigen um den Zoompunkt A (Umkreis bis 0,2) – der Rand „wandert" beim Tauchen
        // nach außen (die Distanz eines festen Punkts wächst mit dem Zoom), das Ziel bleibt so dicht am Zoompunkt
        const pen = (x, y, rr) => 0.6 * rr + 0.4 * Math.max(0, Math.hypot(x, y) - FLY_RPREF);
        let cur = null;
        const kA = idx(A[0], A[1]), sA = kA >= 0 ? score(kA) : null;
        // 6.4: Distanz des Zoompunkts zum Rand (aktuelle lokale Einheiten; innen zählt wie „zu weit“) – für die Vorausschau
        FLY.dA = kA >= 0 && !Number.isNaN(pb.de[kA]) ? (pb.de[kA] === 0 ? 0.3 : deC(kA)) : null;
        const approach = FLY.lost > 0.3 && FLY.T && Math.hypot(FLY.T[0] - A[0], FLY.T[1] - A[1]) > 0.3;   // Anflug läuft: Ziel halten
        if (sA !== null) {
            cur = { sc: sA, x: A[0], y: A[1] };
            for (let a = 0; a < 12; a++) for (const rr of [0.05, 0.1, 0.16, 0.24]) {
                const x = A[0] + Math.sin(a * Math.PI / 6) * rr, y = A[1] + Math.cos(a * Math.PI / 6) * rr;
                const r = Math.hypot(x, y);
                if (r < FLY_RMIN || r > FLY_RMAX || Math.abs(angDiff(Math.atan2(x, y), h0)) > lim) continue;
                const kk = idx(x, y); if (kk < 0) continue;
                const s2 = score(kk);
                if (s2 !== null && s2 - pen(x, y, rr) > cur.sc) cur = { sc: s2 - pen(x, y, rr), x, y };
            }
            // bisheriges Ziel behalten, solange es kaum schlechter ist (kein Hin und Her)
            if (FLY.T) { const kt = idx(FLY.T[0], FLY.T[1]), st = kt >= 0 ? score(kt) : null; if (st !== null && st - pen(FLY.T[0], FLY.T[1], 0) > cur.sc - 0.08 && Math.hypot(FLY.T[0] - A[0], FLY.T[1] - A[1]) < 0.3) cur = { sc: st - pen(FLY.T[0], FLY.T[1], 0), x: FLY.T[0], y: FLY.T[1] }; }
            if (!approach) FLY.T = [cur.x, cur.y];
        }
        const curTot = cur ? cur.sc - 0.18 * Math.abs(angDiff(Math.atan2(cur.x, cur.y), h0)) : -1e9;
        const held = now - FLY.Tt;
        // weiter entferntes Ziel nur mit Hysterese: deutlich besser (+25 %) und das bisherige ≥ 1,5 s gehalten
        if (bestF && (!cur || (held > 1500 && bestF.tot > curTot + Math.max(0.25 * Math.abs(curTot), 0.15)) || (cur.sc < 0 && held > 600 && bestF.tot > curTot + 0.1))) {
            FLY.T = [bestF.x, bestF.y]; FLY.Tt = now;
        }
        // Anflug („verloren"): voraus keine gute Stelle -> die beste Stelle im ganzen Sondenfenster anfliegen: kaum
        // tiefer, seitlich hingleiten (langsamer, je näher), der Kurs dreht dorthin. Gar nichts im Fenster: geradeaus.
        const okAhead = (cur && cur.sc > 0.25) || (bestF && bestF.sc > 0.35);
        // 6.4: Datenlücke (das Bild voraus ist noch nicht gerechnet) ist kein „verloren“: Kurs halten, langsam weiter tauchen,
        // bis wieder Daten da sind – statt zu kreisen und seitlich zu gleiten
        // (Ziel nahe dem Zoompunkt wurde oben schon mit den vorhandenen Daten nachgeführt)
        FLY.gap = nFwd > 0 && nFwdOk < 0.3 * nFwd;
        if (FLY.gap) { FLY.lost = Math.max(0, (FLY.lost || 0) - 0.15); FLY.glide = null; FLY.gv = 1; return; }
        // (nichts Brauchbares im Fenster: Richtung der höchsten Iteration – sie steigt zur Menge hin)
        const far = bestAll && bestAll.sc > 0.35 ? bestAll : hiIt;
        if (!okAhead && far && (!FLY.T || held > 600)) { FLY.T = [far.x, far.y]; FLY.Tt = now; }
        FLY.lost = Math.max(0, Math.min(1.5, (FLY.lost || 0) + (okAhead ? -0.3 : 0.25)));
        if (FLY.lost > 0.3 && FLY.T && far) {
            const r = Math.max(1e-9, Math.hypot(FLY.T[0], FLY.T[1]));
            FLY.glide = [FLY.T[0] / r, FLY.T[1] / r]; FLY.gv = Math.min(1, Math.max(0.15, (r - 0.3) / 0.6));
        } else { FLY.glide = null; FLY.gv = 1; }
    }
    // Messung (tests/measure_fly.py): pro Sonde Anteil Bild mit Mengenrand im mittleren Drittel (Distanz < 0,3
    // Bildhälften), Anteil innen bzw. leer (Distanz > 1) am sichtbaren Boden im Sondenfenster
    function flyMetrics(pb, now) {
        const c = T3.lastCam, M = probeMap(pb);
        const at = (P) => { const q = M.toP(P[0], P[1]); const i = Math.floor((q[0] / pb.win * 0.5 + 0.5) * pb.w), j = Math.floor((q[1] / pb.win * 0.5 + 0.5) * pb.h); return i < 0 || j < 0 || i >= pb.w || j >= pb.h ? NaN : pb.de[j * pb.w + i] / M.k; };
        const look = (x, y) => {
            const g = T3.groundAt(c, x, y);
            if (!g) return -2;
            const d = at(g);
            return Number.isNaN(d) ? -2 : d;
        };
        let edgeMid = 0, nMid = 0, nAll = 0, nIn = 0, nEmpty = 0, nEdge = 0;
        for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) {
            const d = look((a / 8 - 0.5) * 2 / 3, (b / 8 - 0.5) * 2 / 3);
            if (d < -1) continue;
            nMid++; if (d > 0 && d < 0.3) edgeMid++;
        }
        for (let a = 0; a < 15; a++) for (let b = 0; b < 15; b++) {
            const d = look(a / 7 - 1, b / 7 - 1);
            if (d < -1) continue;
            nAll++; if (d === 0) nIn++; else if (d > 1) nEmpty++; else if (d < 0.3) nEdge++;
        }
        const deAt = (P) => { if (!P) return null; const d = at(P); return Number.isNaN(d) ? null : +d.toPrecision(3); };
        return { dA: deAt(FLY.A), dT: deAt(FLY.T), dF: deAt([0, 0]), A: FLY.A ? FLY.A.map(x => +x.toFixed(3)) : null, T: FLY.T ? FLY.T.map(x => +x.toFixed(3)) : null, t: +now.toFixed(0), z: S.cam.zoom, edgeMid: nMid ? edgeMid / nMid : null, inFrac: nAll ? nIn / nAll : null, emptyFrac: nAll ? nEmpty / nAll : null, edgeFrac: nAll ? nEdge / nAll : null, n: nAll, lost: +(FLY.lost || 0).toFixed(2), hasDE: !!pb.hasDE };
    }

    return { link() { ({ GOV, HP, MODE_HOME, Q, S, T3, V3, can3d, clampZoom, emit, look, ready3d, set3d, setCam, setJulia, setMode, smooth01, stopAnims, t, toast } = ctx); },
             FLY, flyStep, flyUpdate, north3d, pauseFly, startFly, stopFly };
} };
})(typeof self !== 'undefined' ? self : globalThis);
