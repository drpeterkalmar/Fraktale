// zufall.js — 7.2.0 Zufallsstart mit Sofortflug (Peter 21.10.2026: „gleich völlig randomisiert (echt alles randomisieren außer
// den 3d-mode …) in einer welt (geht jede) langsam losfliegen ohne jegliches overlay“)
//
// Start ohne Link (und Neuladen = Neustart): eine Welt (Pool wie 7.1.6: alle 19, nicht die vom letzten Start, schwere Welten
// nur auf Geräten, die sie flüssig schaffen) und dazu ALLES, was ihr Bild ausmacht: Ort (Startansicht, Tour-Ort oder ein
// zufälliger strukturreicher Punkt am Mengenrand mit passendem Zoom), Palette, Farbdichte, Färbe-Stil + Stärke +
// Streifendichte, Relief, Farbe der Menge (Bunt/Inseln/Ringe …), Außen (Palette/Grenznah + Saum/Schwarz), Farbanimation an/aus
// + Tempo, Welt-Parameter in ihren gültigen Bereichen (Julia-c am Mengenrand, Exponent, Varianten, Lyapunov-Folge, Phoenix/
// Nova-Parameter, Flammen …), bei den 3D-Körpern Stil, Nebel, Atmen, Tiefenunschärfe, Flug-Art, Exponent/Skalierung und die
// Blickrichtung. Nie die 3D-Landschaft (Peter: „sieht noch recht altbacken aus“, V3.on bleibt aus).
// Prüfung „schön genug“ in zwei Stufen: (1) vor dem ersten Bild rechnet eine kleine CPU-Sonde (fractal-core.js, 48 Spalten)
// die gewählte Ansicht der 2D-Welten – zu viel Menge, leer/einförmig oder Staub -> anderer Ort (bis 6×, dann Startansicht);
// (2) das erste fertige Bild wird verkleinert gelesen (Helligkeit, Kontrast, Nachbar-Unterschied) – zu dunkel, einförmig
// oder zu unruhig -> alles neu würfeln (bis 2×), dann Startansicht der Welt in den eigenen Farben. Solange ist das Bild
// ausgeblendet (dunkler Hintergrund wie beim Laden), danach blendet es in 1,4 s ein und der Flug fährt in 4 s weich an
// (S-Kurve) auf ein ruhiges Tempo (0,16–0,22 Zehnerpotenzen/s, Standard sonst 0,3). Ohne Bedienung (Start-Kino, ui.js).
// Die gewürfelten Werte gelten nur für die Sitzung: patchSave() schreibt beim Speichern für jede gewürfelte und seitdem
// unveränderte Einstellung den gespeicherten Wert zurück (Peters eigene Einstellungen bleiben); was man selbst ändert, wird
// wie immer gespeichert. Die Szene steht in START (Test, Bericht) und gleich nach dem Würfeln in der Adresszeile (Teilen).
// Regler: Einstellung „Start“ (Zufallsflug / Zufallswelt still = 7.1.6 / Wie zuletzt), ?start=flug|still|last,
// ?zufall=0 = nur Welt + Ort würfeln wie 7.1.6 (Flug und Kino bleiben), ?seed=N = fester Zufall (Test, Bericht).
// Tests (navigator.webdriver) starten wie bisher im Mandelbrot – außer mit ?start= oder ?seed= (bzw. ?startworld=random = 7.1.6).
// 7.4.2 Start immer am Rand (Peter 26.10.2026: „Fraktal auch beim Start und Neuladen immer an der Mengengrenze starten“): nach der
// Wahl des Orts (Startansicht, Tour-Ort, Kundschafter) rückt die Bildmitte auf die nächste Stelle des Mengenrands – Wechsel
// innen/außen zwischen zwei Nachbarzellen der CPU-Sonde (Newton: zwischen zwei Einzugsgebieten; ohne Inneres: der stärkste
// Sprung im Iterationswert), danach in einem 8× feineren Ausschnitt nachgeschärft (edgeCenter). Der Flug beginnt dort (sein
// Zoompunkt ist die Bildmitte). Links/Lesezeichen (x/y/z) und „Wie zuletzt“ bleiben exakt. ?randstart=0 = wie 7.4.1.
(function (root) {
'use strict';

root.FKZufall = { create(ctx) {
    let HP, PAL, Q, S, START;   // aus app.js, gesetzt in link()

    // ---------------- Zufall (mulberry32: aus ?seed= reproduzierbar)
    function rng(seed) {
        let a = seed >>> 0;
        const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        r.pick = (arr) => arr[Math.floor(r() * arr.length)];
        r.uni = (a0, b0) => a0 + (b0 - a0) * r();
        r.logu = (a0, b0) => Math.exp(Math.log(a0) + (Math.log(b0) - Math.log(a0)) * r());
        r.chance = (p) => r() < p;
        r.int = (a0, b0) => a0 + Math.floor(r() * (b0 - a0 + 1));
        return r;
    }
    const RAYK = { 6: 0, 8: 1, 9: 2, 16: 3, 17: 4, 18: 5 };
    // gewürfelte Einstellungen (nur für die Sitzung, siehe patchSave)
    const KEYS = ['palette', 'density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'setCol', 'setHex', 'inMode', 'outMode', 'edgeW', 'style', 'stMix', 'stS',
                  'bulbStyle', 'bulbFog', 'bulbDof', 'bulbBreathe', 'flySpeed'];
    const Z = { active: false, phase: '', t0: 0, tries: 0, r: null, plan: null, saved: null, rolled: null, revealT: 0, flyT: 0 };
    const deep = (o) => JSON.parse(JSON.stringify(o));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // Startart: 'flug' (7.2.0, Standard) | 'still' (Zufallswelt wie 7.1.6) | 'last' | 'test' (Testautomation: Mandelbrot)
    function startMode() {
        const q = Q.get('start');
        if (q === 'flug' || q === 'still' || q === 'last') return q;
        if (navigator.webdriver) {
            if (Q.has('seed')) return 'flug';
            let tr = false; try { tr = localStorage.getItem('fk_test_startworld') === 'random'; } catch (e) {}
            return Q.get('startworld') === 'random' || tr ? 'still' : 'test';
        }
        const w = S.startWorld;
        return w === 'still' || w === 'last' ? w : 'flug';
    }

    // ---------------- Welt
    function worldPool(r, seeded) {
        let last = -1;
        try { last = parseInt(localStorage.getItem('fraktal_lastStart'), 10); } catch (e) {}
        const heavy = new Set([...ctx.RAY, ...ctx.DENS_W, 7]), ok = ctx.heavyOK();
        const pool = ctx.MODE_KEYS.map((_, i) => i).filter(i => (seeded || i !== last) && (ok || !heavy.has(i)));
        return pool;
    }
    // ---------------- Plan: alles, was gewürfelt wird, als Daten (rein, ohne Nebenwirkung – Test: rollPlan(seed))
    function rollColors(r, w) {
        const C = {};
        const ids = PAL.list.filter(p => !p.custom).map(p => p.id);
        C.palette = r.pick(ids);
        C.density = +r.logu(0.6, 1.7).toFixed(3);
        C.anim = w === 7 || w === 15 ? true : r.chance(0.75);           // Buddhabrot/Attraktor: das Bild steht, die Farben ziehen
        C.speed = +(1 / r.logu(8, 60)).toFixed(4);                       // Farbtempo: ein Umlauf in 8 … 60 s
        C.relief = r.chance(0.2); C.reliefStrength = +r.uni(0.35, 0.9).toFixed(2);
        C.banded = r.chance(0.08);
        if (ctx.hasSetW(w)) {
            const u = r();
            if (u < 0.55) { C.setCol = 'bunt'; C.inMode = r.chance(0.6) ? 1 : 2; }
            else if (u < 0.72) C.setCol = 'black';
            else if (u < 0.82) C.setCol = 'dark';
            else if (u < 0.94) C.setCol = 'light';
            else C.setCol = 'white';
            const v = r();
            const light = C.setCol === 'bunt' || C.setCol === 'light' || C.setCol === 'white';
            C.outMode = v < 0.45 ? 'edge' : v < 0.85 || !light ? 'pal' : 'black';
            C.edgeW = Math.round(r.logu(20, 300));
        }
        if (ctx.styleOK(w)) {
            C.style = r.chance(0.5) ? 0 : r.int(1, 6);
            C.stMix = +r.uni(0.5, 1).toFixed(2); C.stS = r.int(3, 10);
        } else C.style = 0;
        if (ctx.isRay(w)) {
            C.bulbStyle = r.int(0, 3);
            C.bulbFog = +r.uni(0, 0.35).toFixed(2);
            C.bulbBreathe = w === 6 && r.chance(0.3);
            C.bulbDof = r.chance(0.15) ? +r.uni(0.1, 0.3).toFixed(2) : 0;
        }
        return C;
    }
    // Welt-Parameter in ihren gültigen Bereichen (Standard je Welt in WP_DEF)
    function rollWP(r, w) {
        const d = ctx.WP_DEF[w];
        if (!d) return null;
        const o = Object.assign({}, d);
        switch (w) {
            case 1: o.m = 0; break;                                                       // Julia: c kommt aus rollJulia
            case 2: o.v = r.int(0, 3); break;                                             // Schiff, Celtic, senkrecht, Büffel
            case 4: o.e = r.pick([3, 3, 4, 5, 6, 7, 8]); o.m = 0; break;
            case 5: o.p = r.int(0, self.FKCore.NEWTON_POLYS.length - 1); break;
            case 7: o.v = r.int(0, 2); break;
            case 10: { let s = ''; const n = r.int(2, 8); for (let i = 0; i < n; i++) s += r.chance(0.5) ? 'A' : 'B'; if (!/A/.test(s)) s = 'A' + s.slice(1); if (!/B/.test(s)) s = s.slice(0, -1) + 'B'; o.s = s; break; }
            case 11: o.v = r.chance(0.7) ? 0 : 1; o.cr = +(0.5667 + r.uni(-0.04, 0.04)).toFixed(4); o.ci = +r.uni(-0.03, 0.03).toFixed(4); o.pr = +(-0.5 + r.uni(-0.05, 0.05)).toFixed(4); o.pi = +r.uni(-0.03, 0.03).toFixed(4); break;
            case 12: o.v = r.chance(0.6) ? 0 : 1; o.r = +r.uni(0.75, 1.25).toFixed(3); o.cr = +r.uni(-0.45, 0.05).toFixed(3); o.ci = +r.uni(0.2, 0.6).toFixed(3); break;
            case 13: o.v = r.int(0, 1); break;
            case 14: o.a = 1; break;                                                      // Flamme: Animation (das Bild bewegt sich)
        }
        return o;
    }
    // Julia-c am Rand der Mandelbrot-Menge (Hauptkardioide bzw. Periode-2-Kreis, knapp innen bis knapp außen)
    function rollJulia(r) {
        if (r.chance(0.7)) {
            const th = r.uni(0, 2 * Math.PI), k = r.uni(0.985, 1.03);
            return [(Math.cos(th) / 2 - Math.cos(2 * th) / 4) * k + (1 - k) * 0.25, (Math.sin(th) / 2 - Math.sin(2 * th) / 4) * k];
        }
        const th = r.uni(0, 2 * Math.PI), k = r.uni(0.97, 1.06);
        return [-1 + 0.25 * k * Math.cos(th), 0.25 * k * Math.sin(th)];
    }
    function rollPlan(seed, opts) {
        opts = opts || {};
        const r = typeof seed === 'function' ? seed : rng(seed);
        const P = { seed: typeof seed === 'function' ? null : seed };
        const pool = opts.pool || worldPool(r, opts.seeded);
        P.world = opts.world !== undefined ? opts.world : r.pick(pool);
        const w = P.world;
        if (opts.only) {      // ?zufall=0: nur Welt + Ort wie 7.1.6 (Startansicht oder halbe Chance ein Tour-Ort)
            const L = ctx.SIGHTS[w] || [];
            P.place = L.length && r.chance(0.5) ? { kind: 'sight', k: r.int(0, L.length - 1) } : { kind: 'home' };
            P.only = true;
            return P;
        }
        P.colors = rollColors(r, w);
        P.wp = rollWP(r, w);
        if (w === 1) P.julia = rollJulia(r).map(x => +x.toFixed(9));
        if (w === 14 && r.chance(0.5)) P.flame = { seed: (r() * 4294967295) >>> 0 };
        else if (w === 14) P.wp.g = r.int(0, (self.FKDensity ? self.FKDensity.GALLERY.length : 1) - 1);
        // Ort
        const L = ctx.SIGHTS[w] || [];
        const u = r();
        if (ctx.isRay(w)) {
            const k = RAYK[w];
            P.ray = { kind: k, fly: r.chance(0.5) ? 'durch' : 'tauch' };
            if (k === 0) P.ray.power = r.chance(0.5) ? 8 : r.pick([3, 4, 5, 6, 7, 9, 10, 12]);
            if (k === 1) P.ray.boxS = r.pick([2, 2, -1.5, -2, 2.5, -2.5, 3, -3]);
            if (k === 5) P.ray.ap = +r.uni(1.05, 1.35).toFixed(3);
            if (L.length && u < 0.45) P.place = { kind: 'sight', k: r.int(0, L.length - 1) };
            else P.place = { kind: 'orbit', yaw: +r.uni(-Math.PI, Math.PI).toFixed(4), pitch: +r.uni(-0.55, 0.65).toFixed(4), d: +r.uni(0.85, 1.12).toFixed(3) };
            if ((k === 3 || k === 4) && L.length) P.ray.prm = r.int(0, L.length - 1);     // Q-Julia c / KIFS-Form aus den Orten
        } else if (w === 14 || w === 15 || w === 7) {
            P.place = { kind: 'home' };
            if (w === 15) P.place = { kind: 'sight', k: r.int(0, L.length - 1) };        // Attraktor: eine Vorlage (Parameter)
            if (w === 7) P.place = { kind: 'home' };
        } else if (w === 10) {
            P.place = L.length && u < 0.4 ? { kind: 'sight', k: r.int(0, L.length - 1) } : { kind: 'home' };
        } else {
            P.place = u < 0.22 ? { kind: 'home' } : u < 0.55 && L.length ? { kind: 'sight', k: r.int(0, L.length - 1) } : { kind: 'scout', steps: r.int(1, 3), fac: +r.uni(3, 6).toFixed(2), s: (r() * 2147483646 + 1) | 0 };
            // Tour-Orte der Klassiker tragen eigene Welt-Parameter (z. B. Multibrot-Exponent) – die gelten dann
        }
        P.speed = +r.uni(0.16, 0.22).toFixed(3);
        return P;
    }

    // ---------------- Sonde: 2D-Welten auf der CPU (fractal-core.js), Raster nx × ny über die Ansicht
    function probeGrid(cx, cy, zoom, nx, ny, f) {
        const C = self.FKCore, cf = ctx.cformula();
        C.xpSetup(ctx.xparams(cf)); C.stSetup(0);
        const h = 3 / zoom, w = h * ctx.cssW / Math.max(1, ctx.cssH);
        const maxIter = Math.min(2000, ctx.autoIter(zoom));
        const jx = HP.toNumber(S.julia.x), jy = HP.toNumber(S.julia.y);
        const v = new Float64Array(nx * ny);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const x = cx + ((i + 0.5) / nx - 0.5) * w, y = cy + ((j + 0.5) / ny - 0.5) * h;
            v[j * nx + i] = C.directPixel(x, y, cf, maxIter, jx, jy, 0, false);
        }
        return { v, nx, ny, f, w, h, cx, cy };
    }
    // ---------------- 7.4.2 Rand in die Bildmitte
    // Klasse einer Zelle: innen (-1) / außen (0) bzw. Newton: Wurzel; Rand = zwei Nachbarzellen verschiedener Klasse
    const clsOf = (t, f) => t < 0 ? -1 : f === 5 ? Math.floor(t / 1000) : 0;
    const uOf = (t, f) => t < 0 ? 0 : f === 5 ? t % 1000 : Math.log2(1 + t);
    // nächste Randstelle zur Mitte des Rasters g (Welt-Koordinaten; Mitte zwischen den beiden Zellen) oder null
    function nearestEdge(g, f) {
        const { v, nx, ny, w, h } = g;
        let best = null, bestJ = null;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const a = v[j * nx + i];
            for (const [di, dj] of [[1, 0], [0, 1]]) {
                if (i + di >= nx || j + dj >= ny) continue;
                const b = v[(j + dj) * nx + i + di];
                const x = ((i + 0.5 + di / 2) / nx - 0.5) * w, y = ((j + 0.5 + dj / 2) / ny - 0.5) * h, r = Math.hypot(x, y);
                if (clsOf(a, f) !== clsOf(b, f)) { if (!best || r < best.r) best = { r, x, y }; }
                else if (!best) {
                    // ohne Inneres/Wechsel: stärkster Sprung des Iterationswerts (Filament), nahe der Mitte bevorzugt
                    const du0 = Math.abs(uOf(a, f) - uOf(b, f)), du = du0 - 2 * r / h;
                    if (du0 > 0.6 && (!bestJ || du > bestJ.du)) bestJ = { du, r, x, y };
                }
            }
        }
        const e = best || bestJ;
        return e ? { x: g.cx + e.x, y: g.cy + e.y, r: e.r / (g.h / 2), edge: !!best } : null;
    }
    // Ansicht (cx, cy, zoom) auf den Rand zentrieren; g = schon gerechnete Sonde dieser Ansicht (sonst neu). Kein Rand im Bild (leere
    // Außenfläche, ganz innen): in 4×, 16×, 64× weiterer Ansicht suchen und von dort Stufe für Stufe (×4) bis zum Ausgangszoom
    // nachführen – der Zoom bleibt. Am Ende ein 8× feinerer Ausschnitt. Liefert die neue Mitte (dx/dy = Versatz)
    function edgeCenter(cx, cy, zoom, f, g) {
        const asp = ctx.cssH / Math.max(1, ctx.cssW), ny = Math.max(16, Math.round(48 * asp)), ny2 = Math.max(12, Math.round(24 * asp));
        g = g || probeGrid(cx, cy, zoom, 48, ny, f);
        let e = nearestEdge(g, f), lv = 0;
        const zmin = Math.min(zoom, 0.2);
        while (!e && lv < 3 && zoom / Math.pow(4, lv + 1) >= zmin) { lv++; e = nearestEdge(probeGrid(cx, cy, zoom / Math.pow(4, lv), 48, ny, f), f); }
        if (!e) return { cx, cy, dx: 0, dy: 0, moved: 0, found: false, g };
        const kind = e.edge;
        // zurück zum Ausgangszoom (je Stufe ×4) und 8× feiner: jeweils die nächste Randstelle gleicher Art um die bisherige
        for (let k = lv - 1; k >= -1; k--) {
            const z = k >= 0 ? zoom / Math.pow(4, k) : zoom * 8;
            const e2 = nearestEdge(probeGrid(e.x, e.y, z, k >= 0 ? 48 : 24, k >= 0 ? ny : ny2, f), f);
            if (e2 && e2.edge === kind) e = e2;
        }
        return { cx: e.x, cy: e.y, dx: e.x - cx, dy: e.y - cy, moved: Math.hypot(e.x - cx, e.y - cy) / (1.5 / zoom), found: true, edge: kind, lv, g };
    }
    // liegt der Rand in der Bildmitte? (Ausschnitt ±0,04 Bildhälften, 12×12)
    function centerOnEdge(cx, cy, zoom, f) {
        const g = probeGrid(cx, cy, zoom * 25, 12, 12, f);
        let c0 = null, mx = 0, mn = 1e9, mixed = false;
        for (const t of g.v) { const c = clsOf(t, f); if (c0 === null) c0 = c; else if (c !== c0) mixed = true; const u = uOf(t, f); mx = Math.max(mx, u); mn = Math.min(mn, u); }
        return mixed || mx - mn > 0.6;
    }
    // Wertung einer Ansicht: Anteil Menge (innen), Struktur (Anteil Nachbarpaare mit deutlichem Unterschied), Streuung
    function judgeGrid(g) {
        const { v, nx, ny, f } = g;
        const u = (t) => t < 0 ? null : f === 5 ? Math.floor(t / 1000) * 3 + Math.log2(1 + t % 1000) * 0.1 : Math.log2(1 + t);
        let ins = 0, n = 0, m = 0, q = 0, pairs = 0, det = 0, mixed = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const a = u(v[j * nx + i]);
            if (a === null) ins++; else { n++; m += a; q += a * a; }
            for (const [di, dj] of [[1, 0], [0, 1]]) {
                if (i + di >= nx || j + dj >= ny) continue;
                const b = u(v[(j + dj) * nx + i + di]);
                pairs++;
                if ((a === null) !== (b === null)) { mixed++; det++; }
                else if (a !== null && Math.abs(a - b) > 0.12) det++;
            }
        }
        const N = nx * ny, mean = n ? m / n : 0, sd = n ? Math.sqrt(Math.max(0, q / n - mean * mean)) : 0;
        const r = { inside: +(ins / N).toFixed(3), detail: +(det / Math.max(1, pairs)).toFixed(3), edge: +(mixed / Math.max(1, pairs)).toFixed(3), sd: +sd.toFixed(3) };
        r.why = r.inside > 0.82 ? 'innen' : r.detail < 0.035 && r.edge < 0.01 ? 'leer' : r.detail > 0.88 ? 'staub' : '';
        r.ok = !r.why;
        return r;
    }
    // Kundschafter (wie tools/scout.js): je Stufe die strukturreichsten 9×9-Blöcke eines 54×54-Rasters, zufällig unter den
    // besten sechs, Zoom ×fac dorthin
    function scout(r, cx, cy, zoom, steps, fac) {
        const N = 54, B = 9, f = S.formula;
        for (let k = 0; k < steps; k++) {
            const g = probeGrid(cx, cy, zoom, N, N, f), v = g.v;
            const cand = [];
            for (let bj = 0; bj < N / B; bj++) for (let bi = 0; bi < N / B; bi++) {
                let n = 0, m = 0, q = 0, ins = 0;
                const roots = new Set();
                for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
                    const t = v[(bj * B + j) * N + bi * B + i];
                    if (t < 0) { ins++; continue; }
                    const uu = f === 5 ? t % 1000 : Math.log2(1 + t);
                    if (f === 5) roots.add(Math.floor(t / 1000));
                    n++; m += uu; q += uu * uu;
                }
                if (n < 4) continue;
                m /= n; const sd = Math.sqrt(Math.max(0, q / n - m * m));
                const mix = ins / (B * B), edge = mix > 0.03 && mix < 0.7 ? 1.5 : 1;
                cand.push({ bi, bj, score: (sd + 0.02) * edge * (f === 5 ? roots.size : 1) });
            }
            if (!cand.length) break;
            cand.sort((a, b) => b.score - a.score);
            const pick = r.pick(cand.slice(0, 6));
            cx += ((pick.bi + 0.5) * B / N - 0.5) * g.w;
            cy += ((pick.bj + 0.5) * B / N - 0.5) * g.h;
            zoom *= fac;
        }
        return [cx, cy, zoom];
    }

    // ---------------- Anwenden
    // 7.4.2 würfeln + anwenden; liegt danach kein Rand im Bild (Welt mit Menge: kein Wechsel innen/außen; sonst gar keiner) –
    // gewürfelte Parameter ohne Menge an dieser Stelle, leere Fläche –, bis zu 2× neu würfeln (gleiche Welt, Zufall läuft weiter)
    function rollApply(r, opts) {
        let P, info;
        for (let k = 0; k < 3; k++) {
            if (k && Z.saved) restore(Z.saved);
            P = rollPlan(r, k ? Object.assign({}, opts, { world: P.world }) : opts);
            info = applyPlan(P, r);
            const e = info.edge;
            if (!e || P.only || (e.found && (e.kind === 'rand' || !ctx.hasSetW(P.world)))) break;
            (START.edgeRerolls = START.edgeRerolls || []).push({ world: P.world, place: P.place.kind, edge: e });
        }
        return { P, info };
    }
    function snapshot() { const o = {}; for (const k of KEYS) o[k] = deep(S[k]); o.wp = deep(S.wp); o.bulbFly = deep(S.bulbFly || {}); o.wpal = deep(S.wpal || {}); o.paletteId = PAL.list[S.palette].id; return o; }
    function applyPlan(P, r) {
        Z.applying = true;
        try { return applyPlan0(P, r); } finally { Z.applying = false; }
    }
    function applyPlan0(P, r) {
        const w = P.world;
        ctx.setMode(w);
        try { localStorage.setItem('fraktal_lastStart', String(w)); } catch (e) {}
        const L = ctx.SIGHTS[w] || [];
        const info = { world: w, key: ctx.MODE_KEYS[w], place: P.place.kind, sight: null, probe: null, tries: 0 };
        if (!P.only) {
            const C = P.colors;
            S.palette = Math.max(0, PAL.indexOf(C.palette));
            for (const k of ['density', 'anim', 'speed', 'relief', 'reliefStrength', 'banded', 'setCol', 'inMode', 'outMode', 'edgeW', 'style', 'stMix', 'stS', 'bulbStyle', 'bulbFog', 'bulbBreathe', 'bulbDof'])
                if (C[k] !== undefined) S[k] = C[k];
            if (P.wp) S.wp[w] = Object.assign({}, ctx.WP_DEF[w], P.wp);
            if (P.julia) ctx.setJulia(HP.fromNumber(P.julia[0]), HP.fromNumber(P.julia[1]));
            if (P.flame && ctx.flameRandom) ctx.flameRandom(P.flame.seed);
            if (P.ray) S.bulbFly = Object.assign({}, S.bulbFly, { [P.ray.kind]: P.ray.fly });
            S.flySpeed = P.speed;
        }
        // Ort
        if (P.place.kind === 'sight' && L[P.place.k]) {
            const p = L[P.place.k];
            info.sight = p.k;
            ctx.applyPlaceWP(p);
            if (p.jx && !P.julia) ctx.setJulia(HP.fromString(p.jx), HP.fromString(p.jy));
            if (ctx.isRay(w)) { if (p.b) ctx.BULB.applyState(p.b); }
            else { const h = ctx.isDens(w) ? ctx.homeOf(w) : null; ctx.setCam(HP.fromString(h ? h[0] : p.cx), HP.fromString(h ? h[1] : p.cy), h ? h[2] : +p.zoom); }
        }
        if (P.ray) applyRay(P, L, info);
        if (P.place.kind === 'scout') {
            const h = ctx.homeOf(w), rr = rng(P.place.s);
            let best = null;
            // bis zu 6 Orte; der erste, den die Sonde für schön genug hält, gilt (sonst der beste, zuletzt die Startansicht)
            for (let k = 0; k < 6; k++) {
                const c = scout(rr, +h[0], +h[1], h[2], Math.max(1, P.place.steps - (k >> 1)), P.place.fac);
                const g = probeGrid(c[0], c[1], c[2], 48, Math.max(16, Math.round(48 * ctx.cssH / Math.max(1, ctx.cssW))), S.formula), j = judgeGrid(g);
                info.tries = k + 1;
                if (j.ok) { best = { c, j, g }; break; }
            }
            if (best) { ctx.setCam(HP.fromNumber(best.c[0]), HP.fromNumber(best.c[1]), best.c[2]); info.probe = best.j; info.grid = best.g; }
            else { ctx.setCam(HP.fromString(h[0]), HP.fromString(h[1]), h[2]); info.place = 'home'; info.fallback = 'sonde'; }
        }
        if (!info.probe && ctx.is2dW(w)) { info.grid = probeGrid(HP.toNumber(S.cam.cx), HP.toNumber(S.cam.cy), S.cam.zoom, 48, Math.max(16, Math.round(48 * ctx.cssH / Math.max(1, ctx.cssW))), S.formula); info.probe = judgeGrid(info.grid); }
        // 7.4.2: Rand in die Bildmitte (dieselbe Sonde, ein feiner Ausschnitt dazu)
        if (ctx.is2dW(w) && Q.get('randstart') !== '0' && info.grid) {
            const e = edgeCenter(HP.toNumber(S.cam.cx), HP.toNumber(S.cam.cy), S.cam.zoom, S.formula, info.grid);
            if (e.found) ctx.setCam(S.cam.cx + HP.fromNumber(e.dx), S.cam.cy + HP.fromNumber(e.dy), S.cam.zoom);
            info.edge = { found: e.found, moved: +(e.moved || 0).toFixed(3), kind: e.found ? (e.edge ? 'rand' : 'filament') : null, weiter: e.lv || 0 };
        }
        delete info.grid;
        S.iterManual = false;
        ctx.invalidate();
        ctx.emit('mode'); ctx.emit('settings'); ctx.emit('wp');
        return info;
    }
    // 3D-Körper: Parameter (Exponent, Skalierung, Q-Julia-c/KIFS-Form aus einem Ort) und Blick auf den Körper aus einer zufälligen
    // Richtung (Abstand wie die Startansicht × 0,85 … 1,12)
    function applyRay(P, L, info) {
        const BU = ctx.BULB, B = BU.B, R0 = P.ray;
        const sp = P.place.kind === 'sight' && L[P.place.k] && L[P.place.k].b ? L[P.place.k].b : null;
        const prmOf = (s) => s ? String(s).split(';')[1] : null;
        let prm;
        if (R0.kind === 0) prm = String(R0.power);
        else if (R0.kind === 1) prm = String(R0.boxS);
        else if (R0.kind === 5) prm = String(R0.ap);
        else if (R0.prm !== undefined && L[R0.prm]) prm = prmOf(L[R0.prm].b);
        if (sp) {     // Tour-Ort: dessen Kamera, aber die gewürfelten Parameter (Mandelbox-Ort: Skalierung des Orts – die Kamera passt dazu)
            if (R0.kind !== 1) BU.applyState(sp.split(';')[0] + ';' + (prm || prmOf(sp)));
            return;
        }
        BU.applyState([0, 0, -3, 0, 0].join(',') + ';' + (prm || prmOf(BU.stateString())));
        BU.home();
        const d = Math.hypot(B.pos[0], B.pos[1], B.pos[2]) * P.place.d, yaw = P.place.yaw, pitch = P.place.pitch;
        const cp = Math.cos(pitch), fw = [cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)];
        BU.applyState([-fw[0] * d, -fw[1] * d, -fw[2] * d, yaw, pitch].map(x => +x.toPrecision(10)).join(',') + ';' + (prm || prmOf(BU.stateString())));
        info.orbit = [yaw, pitch, +d.toFixed(3)];
    }

    // ---------------- Bildprüfung nach dem ersten Bild: verkleinert lesen (64 Spalten)
    function judgeImage() {
        try {
            ctx.freshFrame();
            const cv = ctx.canvas, W = 64, H = Math.max(16, Math.round(64 * cv.height / Math.max(1, cv.width)));
            const o = document.createElement('canvas'); o.width = W; o.height = H;
            const c2 = o.getContext('2d', { willReadFrequently: true });
            c2.drawImage(cv, 0, 0, W, H);
            const d = c2.getImageData(0, 0, W, H).data, Y = new Float32Array(W * H);
            let sum = 0, cs = 0;
            for (let i = 0; i < W * H; i++) {
                const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2];
                Y[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; sum += Y[i];
                cs += Math.hypot(r - g, 0.5 * (r + g) - b);
            }
            const mean = sum / (W * H);
            let q = 0, gr = 0, ng = 0;
            for (let i = 0; i < W * H; i++) q += (Y[i] - mean) * (Y[i] - mean);
            for (let j = 0; j < H; j++) for (let i = 0; i < W - 1; i++) { gr += Math.abs(Y[j * W + i + 1] - Y[j * W + i]); ng++; }
            const sorted = Array.from(Y).sort((a, b) => a - b);
            const r = { mean: +mean.toFixed(1), sd: +Math.sqrt(q / (W * H)).toFixed(1), grad: +(gr / Math.max(1, ng)).toFixed(1), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), color: +(cs / (W * H)).toFixed(1) };
            r.why = r.mean < 14 && r.p95 < 55 ? 'dunkel' : r.sd < 5 && r.grad < 1.5 ? 'einförmig' : r.grad > 60 ? 'unruhig' : '';
            r.ok = !r.why;
            return r;
        } catch (e) { return { ok: true, err: String(e && e.message || e) }; }
    }

    // ---------------- Ablauf
    // begin(): würfeln + anwenden (in init, vor dem ersten Bild); tick(): erstes Bild abwarten, prüfen, einblenden, losfliegen
    function begin(mode) {
        const seeded = Q.has('seed');
        const seed = seeded ? (parseInt(Q.get('seed'), 10) >>> 0) : ((crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.random() * 4294967295) >>> 0);
        Z.r = rng(seed);
        Z.saved = snapshot();
        Z.mode = mode;
        const only = Q.get('zufall') === '0';
        const ra = rollApply(Z.r, { seeded, only });
        Z.plan = ra.P;
        const info = ra.info;
        Z.rolled = snapshot();
        Object.assign(START, { how: START.how, mode, seed, world: info.world, sight: info.sight, place: info.place, info, plan: Z.plan, image: null, rerolls: 0, fallback: info.fallback || null, flying: false, kino: true });
        writeURL();
        Z.active = true; Z.phase = 'wait'; Z.t0 = performance.now(); Z.tries = 0;
        document.documentElement.classList.add('fk-intro', 'fk-intro-fade');
        if (document.body) document.body.classList.add('hudless');      // vor dem ersten Bild: keine Bedienung (ui.js übernimmt)
    }
    // (Adresszeile: die Szene als Link; Regler der Seite wie ?seed= bleiben stehen – ui.js liest sie danach noch)
    function writeURL() { try { const u = ctx.stateURL(); history.replaceState(null, '', u.replace('#', location.search + '#')); } catch (e) {} }
    // erstes Bild „steht“: 2D fertig (bzw. Vorschau ≤ ½ Auflösung nach 0,8 s), 3D-Körper/Lichtbilder nach kurzer Zeit, sonst 4,5 s
    function firstPicture(now) {
        const el = now - Z.t0, w = S.formula;
        if (el > 4500) return true;
        if (ctx.isRay(w)) return el > 900 && ctx.BULB.ready() === true;
        if (ctx.isDens(w)) { const di = ctx.DENS.info(); return (di.spp || 0) >= 6 || el > 2500; }
        if (w === 7) return el > 1800;
        const f = ctx.RC.front;
        if (ctx.isDone()) return true;
        return !!f && f.key === ctx.viewKey() && f.stage <= 2 && el > 800;
    }
    function tick(now) {
        if (!Z.active) return;
        if (Z.phase === 'wait') {
            if (!firstPicture(now)) return;
            const j = judgeImage();
            START.image = j;
            if (!j.ok && Z.tries < 2 && !Z.plan.only) {
                // alles neu würfeln (gleiche Welt; Zufall läuft weiter), danach die Startansicht der Welt in den eigenen Farben
                Z.tries++; START.rerolls = Z.tries;
                (START.rejected = START.rejected || []).push({ why: j.why, plan: Z.plan });
                restore(Z.saved);
                const ra = rollApply(Z.r, { world: Z.plan.world });
                Z.plan = ra.P;
                const info = ra.info;
                Z.rolled = snapshot();
                Object.assign(START, { info, sight: info.sight, place: info.place, plan: Z.plan });
                writeURL();
                Z.t0 = now;
                return;
            }
            if (!j.ok && !Z.plan.only) {
                (START.rejected = START.rejected || []).push({ why: j.why, plan: Z.plan });
                restore(Z.saved);
                const w = Z.plan.world;
                Z.plan = { world: w, only: true, place: { kind: 'home' }, speed: 0.2 };
                const info = applyPlan(Z.plan, Z.r);
                S.flySpeed = 0.2;
                Z.rolled = snapshot();
                Object.assign(START, { info, sight: null, place: 'home', plan: Z.plan, fallback: 'bild' });
                writeURL();
            }
            Z.phase = 'reveal'; Z.revealT = now;
            document.documentElement.classList.remove('fk-intro');
            setTimeout(() => document.documentElement.classList.remove('fk-intro-fade'), 1600);
            ctx.emit('start');
            startMotion();
            return;
        }
        if (Z.phase === 'reveal') { Z.active = false; Z.phase = 'done'; }
    }
    // Bewegung je Welt: 2D-Welten 2D-Flug, 3D-Körper ihr eigener Flug, Flamme: Animation, Buddhabrot/Attraktor: Farbanimation
    function startMotion() {
        const w = S.formula;
        if (ctx.isRay(w) || ctx.canFly2d(w)) {
            if (!S.flySpeed || S.flySpeed < 0.05) S.flySpeed = 0.2;
            ctx.startFly(undefined, { d3: false, rampMs: 4000 });
            START.flying = !!ctx.FLY.on;
            START.motion = ctx.FLY.on ? (ctx.isRay(w) ? 'bulb-flug:' + ctx.BULB.flyMode() : '2d-flug') : 'keine';
        } else START.motion = w === 14 ? 'flamme-animation' : 'farbanimation';
    }
    function restore(o) {
        for (const k of KEYS) S[k] = deep(o[k]);
        S.palette = Math.max(0, PAL.indexOf(o.paletteId));
        S.wp = deep(o.wp); S.bulbFly = deep(o.bulbFly); S.wpal = deep(o.wpal);
    }
    // beim Speichern: gewürfelte, seither unveränderte Werte durch die gespeicherten ersetzen
    function patchSave(o) {
        if (Z.applying) return null;                 // (während des Würfelns nichts speichern – setWP/setFlame speichern sonst mit)
        if (!Z.saved || !Z.rolled) return o;
        const sv = Z.saved, rl = Z.rolled;
        for (const k of KEYS) if (k !== 'palette' && same(o[k], rl[k])) o[k] = deep(sv[k]);
        if (o.wp) { o.wp = deep(o.wp); for (const f in rl.wp) if (same(o.wp[f], rl.wp[f])) o.wp[f] = deep(sv.wp[f]); }
        if (o.bulbFly) { o.bulbFly = deep(o.bulbFly); for (const k of Object.keys(Object.assign({}, rl.bulbFly, o.bulbFly))) if (same(o.bulbFly[k], rl.bulbFly[k])) { if (sv.bulbFly[k] === undefined) delete o.bulbFly[k]; else o.bulbFly[k] = sv.bulbFly[k]; } }
        // Palette: je Welt-Schlüssel (Klassiker 'c', neue Welten ihre Nummer) – steht dort noch die gewürfelte, die gespeicherte
        const rp = rl.paletteId;
        if (o.wpal) {
            o.wpal = deep(o.wpal);
            const k = ctx.palKey(START.world);
            if (o.wpal[k] === rp) { if (sv.wpal[k] === undefined) delete o.wpal[k]; else o.wpal[k] = sv.wpal[k]; }
            o.paletteId = o.wpal.c || sv.wpal.c || sv.paletteId;
        }
        return o;
    }
    function info() { return { active: Z.active, phase: Z.phase, mode: Z.mode, saved: Z.saved, rolled: Z.rolled }; }

    return { link() { ({ HP, PAL, Q, S, START } = ctx); },
             startMode, begin, tick, patchSave, rollPlan, judgeGrid, probeGrid, judgeImage, info, rng, scout, edgeCenter, centerOnEdge, nearestEdge, applyPlanTest: applyPlan, rollApply };
} };
})(typeof self !== 'undefined' ? self : globalThis);
