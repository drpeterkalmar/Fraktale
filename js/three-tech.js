// three-tech.js — 6.7 Technik für die 3D-Landschaft: reine Funktionen (ohne WebGL), geteilt von js/three.js, js/app.js
// und den Node-Tests (tests/unit/tech3d.test.js).
//  * URL-Regler (?taa ?scharf ?tone ?bloom ?hao ?detail ?gpuwahl) und Stufentabelle (Akku/Ausgewogen/Maximal)
//  * Endpass: Belichtung nach Sonnenhöhe, Tonemapping (JS-Spiegel der GLSL-Kurven), CAS-Nachschärfen
//  * Schattenschritte je Stufe, Horizont-AO-Parameter
//  * Gitterdichte aus der gemessenen GPU-Zeit (statt Bildschirmbreite < 700 px), Ergebnis je Gerät in localStorage
//  * TAA: Jitter-Folge, Reprojektion (Kamera + Höhe, lokale Einheiten wechseln mit Zoom/Fokus), Tiefen-Kodierung
// Die GLSL-Gegenstücke stehen in js/three.js; jede Kurve hier ist Zeile für Zeile dieselbe Rechnung, damit die
// Unit-Tests die Shader-Mathematik prüfen, ohne dass ein Browser läuft.
(function (root) {
'use strict';

// ---------------------------------------------------------------- Regler
// Standard: alles Neue an außer TAA (?taa=1 schaltet es ein, bis es im Flug abgenommen ist).
// ?tone=0 aus (Bild wie bis 6.6), ?tone=agx AgX statt der Neutral-Schulter. ?bloom=0 nur den Bloom aus.
function flags(q) {
    const g = (k) => (q && typeof q.get === 'function' ? q.get(k) : null);
    const off = (k) => g(k) === '0';
    const tv = g('tone');
    const tone = tv === '0' ? 0 : (tv === 'agx' ? 2 : 1);
    return {
        taa: g('taa') === '1',
        scharf: !off('scharf'),
        tone,
        bloom: tone > 0 && !off('bloom'),
        hao: !off('hao'),
        detail: !off('detail'),
        gpuwahl: !off('gpuwahl'),
    };
}

// ---------------------------------------------------------------- Stufen
// shN = Schattenschritte, shR = Schrittweiten-Exponent (Reichweite bleibt gleich: 0,024 · 1,95^(shN·shR) = 0,024 · 1,95^6),
// shK = Härte des Halbschattens (kleiner = weicher), aoN/aoS = AO-Richtungen/-Schritte, det = Stärke der Detail-Normalen,
// bloom = Bloom an, grid = GPU-Budget (ms) des Gelände-Passes für die Gitterwahl.
// Ausgewogen ist bei den Schatten bit-gleich zu 6.6 (shN 6, shR 1, shK 5).
const SH_RANGE = 6;    // Reichweite der Schatten in Schritten von 6.6
const STAGES = {
    eco:      { shN: 3,  shK: 5.0, aoN: 0, aoS: 2, det: 0,   bloom: false, grid: 5 },   // (6.7: AO aus – Akku spart, nicht mehr)
    balanced: { shN: 6,  shK: 5.0, aoN: 4, aoS: 2, det: 1,   bloom: true,  grid: 7 },   // (6.7: AO 2 Schritte – Budget)
    max:      { shN: 10, shK: 3.2, aoN: 4, aoS: 3, det: 1,   bloom: true,  grid: 8.5 },  // (6.7 E5: Budget 8,5 statt 10 ms – GPU-Zeit Maximal +47 %)
};
function stage(quality, f) {
    const s = Object.assign({}, STAGES[quality] || STAGES.balanced);
    s.shR = SH_RANGE / s.shN;
    f = f || {};
    if (f.hao === false) s.aoN = 0;
    if (f.detail === false) s.det = 0;
    if (!f.bloom) s.bloom = false;
    return s;
}
// Schrittweite i (1..shN) der Schattenstrahlen – Spiegel der Schleife in TERRAIN_VS
const shadowTs = (i, shR) => 0.024 * Math.pow(1.95, i * shR);

// ---------------------------------------------------------------- Horizont-AO (Spiegel von TERRAIN_VS, #if HAO)
// Richtung k von n: um 45° gedreht (2 Richtungen = Diagonale hin/zurück, 4 = alle Diagonalen)
function aoDir(k, n) { const a = 0.785398 + k * 6.283185 / n; return [Math.cos(a), Math.sin(a)]; }
// Abstand des Schritts i: wächst geometrisch, mindestens 1,5 Gitterzellen (in der Ferne keine Unter-Pixel-Rinnen)
function aoRadius(i, foot) { return Math.max(0.03 * Math.pow(2.6, i), foot * (1.5 + i)); }
const sinT = (t) => t / Math.sqrt(1 + t * t);
// Verdeckung am Punkt P (Höhe h0, Tangentenneigung je Richtung aus der Gitter-Normale N=[nx,ny,nz]):
// je Richtung höchster Horizont (tan), über der Tangentialebene gemessen -> nur Mulden/Rinnen werden dunkler, Hänge nicht.
// heightFn(x, y) -> Höhe. Rückgabe: Sichtbarkeit 0..1 (1 = frei).
function horizonAO(heightFn, P, h0, N, n, s, foot, k) {
    if (!n) return 1;
    let occ = 0;
    for (let d = 0; d < n; d++) {
        const dir = aoDir(d, n);
        const tanT = -(N[0] * dir[0] + N[1] * dir[1]) / N[2];
        let hm = tanT;
        for (let i = 0; i < s; i++) {
            const r = aoRadius(i, foot);
            const t = (heightFn(P[0] + dir[0] * r, P[1] + dir[1] * r) - h0) / r;
            hm = Math.max(hm, tanT + (t - tanT) * (1 - 0.2 * i));   // fernere Schritte zählen etwas weniger
        }
        occ += sinT(hm) - sinT(tanT);
    }
    return Math.min(1, Math.max(0, 1 - k * occ / n));
}
// Stärke (Startwert; TODO am Bild abstimmen: Täler sichtbar tiefer, Kämme unverändert). V-Tal mit Hangneigung 0,5 -> 0,73,
// 0,8 -> 0,56, 1,5 -> 0,35 (1,6 war rechnerisch zu dunkel: Neigung 0,8 -> 0,21)
const AO_K = 0.9;
// Abbildung der rohen Sichtbarkeit auf den Lichtanteil (6.7, am Bild abgestimmt): Das Fraktal-Gebirge ist überall
// zerklüftet – die rohe AO lag im Mittel bei 0,74 und dunkelte so das ganze Bild um ~15 % ab („grauer“). Leichte
// Verdeckung (> 0,92) bleibt jetzt ganz hell, erst echte Mulden/Rinnen werden dunkel (tiefste Stellen bis 0,45).
const AO_FREE = 0.92, AO_FULL = 0.3, AO_DEPTH = 0.55;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function aoShade(a) { return 1 - AO_DEPTH * (1 - smooth(AO_FULL, AO_FREE, a)); }

// Detail-Normalen (Spiegel der Konstanten in TERRAIN_FS_SRC): Stärke Fels/Boden, Schnee-Faktor, Oktaven-Versatz (Wellenlänge der
// gröbsten Detail-Oktave = 2^-(oct) lokale Einheiten). Der Vorbau-Startwert (0,35/0,18, Oktave 6) ergab eine Neigung von im
// Mittel ~0,025 (1,4°) – am Bild nicht zu sehen; jetzt ~3× kräftiger und eine Oktave gröber (am Bild abgestimmt).
const DET = { rock: 0.7, soil: 0.3, snow: 0.3, oct: 5 };

// ---------------------------------------------------------------- Endpass: Belichtung, Tonemapping, Grading
// Belichtung nach Sonnenhöhe (rad): 1,0 bei der festen Sonne von 6.6 (0,5 rad) – das Bild bleibt in den Mitteltönen
// gleich; tiefe Sonne (Abend/Morgen) etwas heller belichtet und wärmer, hohe Sonne etwas knapper.
function exposure(el) { return Math.min(1.3, Math.max(0.85, 1 + 0.5 * (0.5 - el))); }
function sunTint(el) {
    const w = Math.min(1, Math.max(0, (0.5 - el) / 0.4));       // 0 ab Sonnenhöhe 0,5, 1 bei 0,1 (Abendlicht)
    return [1 + 0.08 * w, 1 + 0.01 * w, 1 - 0.1 * w];
}
// Neutral-Schulter (wie Khronos PBR Neutral, aber ohne Fuß-Versatz: die Farben von 6.6 sind schon Anzeigewerte, der Fuß
// würde alle Mitteltöne um 0,04 abdunkeln). Unter dem Knie unverändert, darüber weich auf 1 zu (Weißpunkt W), sehr helle
// Werte entsättigen Richtung Weiß – Schnee und Gletscher behalten Zeichnung statt flach auszubrennen.
// (6.7 am Bild abgestimmt: Knie 0,8 statt 0,7, Weißpunkt 1,5 statt 1,6 – mit 0,7 wurden helle Schneeflächen von 6.6 (Anzeigewert
// ~0,78–0,95, nicht abgeschnitten) sichtbar grauer; jetzt wirkt die Schulter erst darüber, wo Belichtung und Glanz überlaufen)
const TONE_KNEE = 0.8, TONE_WHITE = 1.5, TONE_DESAT = 0.15;
function shoulder(x, knee, white) {
    if (x <= knee) return x;
    const s = 1 - knee, u = (x - knee) / s, w = (white - knee) / s;
    return knee + s * Math.min(1, u * (1 + u / (w * w)) / (1 + u));
}
function toneNeutral(c) {
    const p = Math.max(c[0], c[1], c[2]);
    if (p <= TONE_KNEE) return c.slice();
    const np = shoulder(p, TONE_KNEE, TONE_WHITE);
    const g = 1 - 1 / (TONE_DESAT * (p - np) + 1);
    return c.map(x => (x * np / p) * (1 - g) + np * g);
}
// AgX (Minimal-Version nach Wrensch, Polynom 6. Grades), Eingang linear -> Ausgang Anzeige. Hier für den A/B-Vergleich
// (?tone=agx): die Anzeigewerte von 6.6 werden vorher mit 2,2 linearisiert.
const AGX_IN = [[0.842479062253094, 0.0423282422610123, 0.0423756549057051], [0.0784335999999992, 0.878468636469772, 0.0784336], [0.0792237451477643, 0.0791661274605434, 0.879142973793104]];
const AGX_OUT = [[1.19687900512017, -0.0528968517574562, -0.0529716355144438], [-0.0980208811401368, 1.15190312990417, -0.0980434501171241], [-0.0990297440797205, -0.0989611768448433, 1.15107367264116]];
// GLSL mat3(a,b,c) nimmt Spalten; m * v = Summe der Spalten · Komponenten
const mulCols = (m, v) => [0, 1, 2].map(r => m[0][r] * v[0] + m[1][r] * v[1] + m[2][r] * v[2]);
function agxCurve(x) {
    const x2 = x * x, x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
function toneAgx(c) {
    const lin = c.map(x => Math.pow(Math.max(x, 0), 2.2));
    const v = mulCols(AGX_IN, lin).map(x => (Math.min(Math.max(Math.log2(Math.max(x, 1e-10)), -12.47393), 4.026069) + 12.47393) / 16.49999);
    const o = mulCols(AGX_OUT, v.map(agxCurve));
    return o.map(x => Math.min(1, Math.max(0, x)));    // AgX liefert schon Anzeigewerte (Kurve enthält das Gamma)
}
function tonemap(c, mode, expo) {
    const e = c.map(x => Math.max(x, 0) * (expo === undefined ? 1 : expo));
    return mode === 2 ? toneAgx(e) : toneNeutral(e);
}

// ---------------------------------------------------------------- CAS (AMD FidelityFX Contrast Adaptive Sharpening, vereinfacht)
// 5er-Kreuz um das (bilinear hochskalierte) Pixel; Schärfe 0..1. Gewicht w <= 0 je Kanal: kontrastarme Stellen werden
// stärker, kontrastreiche (Kanten nahe 0/1) kaum geschärft -> kein Überschwingen, keine Lichtsäume.
function casChannel(c, n, s, e, w, sharp) {
    const mn = Math.min(c, n, s, e, w), mx = Math.max(c, n, s, e, w);
    const amp = Math.sqrt(Math.min(1, Math.max(0, Math.min(mn, 2 - mx) / Math.max(mx, 1e-4))));
    const wt = -amp / (8 + (5 - 8) * sharp);
    return (c + wt * (n + s + e + w)) / (1 + 4 * wt);
}
// Schärfe nach Renderskala: volle Auflösung (gemitteltes Standbild) nur leicht, hochskaliert mehr (TODO am Bild abstimmen)
function sharpForScale(scale, on) {
    if (!on) return 0;
    if (scale >= 0.999) return 0.2;
    // (am Bild abgestimmt: Vorbau 0,3 + 0,5·(1/s − 1) = 0,57 bei Skala 0,65 schärfte auch die Treppen an Kanten im
    // Bewegungsbild sichtbar nach – die krabbeln im Flug; 0,39 bei 0,65 schärft die Flächen, kaum die Treppen)
    return Math.min(0.6, 0.2 + (1 / scale - 1) * 0.35);
}
const BLOOM = { thr: 0.78, k: 0.12, spread: 1.5 };   // Schwelle (Anzeigewert), Stärke, Abstand der Blur-Abgriffe (6.7 am Bild geprüft: dezent, keine Halos an Kämmen)

// ---------------------------------------------------------------- Gitterdichte aus der GPU-Zeit
// Spiegel der Gitterformel in T.render: div = Bildpunkte je Gitterzelle (6.6: 6 Desktop, 8 Handy)
function gridSize(W, H, div) {
    const cols = Math.max(48, Math.min(200, Math.round(W / (div * Math.max(1, W / 900)))));
    const rows = Math.max(64, Math.min(300, Math.round(cols * H / W * 1.3)));
    return { cols, rows };
}
// (6.7 E5: feinste Stufe 6 statt 5 – wie der Desktop in 6.6. Auf dem M1 wählte die Kurzmessung sonst je nach Lauf 5–7, mit 5
// hatte Ausgewogen +76 % Gitterpunkte und +46 % GPU-Zeit; „starke Geräte feiner“ heißt höchstens Desktop-Dichte)
const GRID_MIN = 6, GRID_MAX = 12;
// Gemessen: ms = GPU-Zeit des Gelände-Passes bei Teiler d0. Modell: ms(d) = ms0 · ((1 − fV) + fV · (d0/d)²), fV = Anteil der
// Gitterpunkt-Arbeit (Vertex-Shader: Höhen, Schatten, AO) – Startwert 0,6 (TODO aus der Messung am Handy ableiten).
// Gesucht: d mit ms(d) = budget; halbe Schritte, Grenzen 5..12; Änderung erst ab 1 Schritt (Hysterese gegen Pendeln).
function gridDivFromGpu(ms, d0, budget, fV) {
    fV = fV === undefined ? 0.6 : fV;
    if (!(ms > 0) || !(d0 > 0) || !(budget > 0)) return d0;
    const r = (budget / ms - (1 - fV)) / fV;          // (d0/d)²
    let d = r <= 0.04 ? GRID_MAX : d0 / Math.sqrt(r);
    d = Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round(d * 2) / 2));
    return Math.abs(d - d0) >= 1 ? d : d0;
}
const legacyDiv = (minScreen) => (minScreen < 700 ? 8 : 6);
// Schlüssel je Gerät: GPU-Name + Bildgröße auf 10 % gerundet (Drehen des Handys = gleiches Gerät)
function gridKey(renderer, W, H) {
    const a = Math.max(W, H), b = Math.min(W, H);
    const q = (x) => Math.round(Math.log(x) / Math.log(1.1));
    return String(renderer || '?').slice(0, 80) + '|' + q(a) + 'x' + q(b);
}
const GRID_LS = 'fk3d_grid_v1';
function gridLoad(store, key) {
    // (6.7 Abnahme: der Vorbau prüfte hier ein Feld div, das three.js gar nicht speichert ({ ms, d0, t }) – jeder 3D-Start
    // maß darum neu. Plausibel = gemessene Zeit > 0 und Teiler der Messung im erlaubten Bereich)
    try { const o = JSON.parse(store.getItem(GRID_LS) || '{}'); const e = o[key]; return e && e.ms > 0 && e.ms < 1000 && e.d0 >= GRID_MIN && e.d0 <= GRID_MAX ? e : null; } catch (e) { return null; }
}
function gridSave(store, key, entry) {
    try { const o = JSON.parse(store.getItem(GRID_LS) || '{}'); o[key] = entry; const ks = Object.keys(o); if (ks.length > 8) delete o[ks[0]]; store.setItem(GRID_LS, JSON.stringify(o)); } catch (e) { /* voll/gesperrt */ }
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------------------------------------------------------------- TAA
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
// Jitter des Bewegungsbilds n (8er-Folge Halton 2,3) in NDC für ein Ziel sw × sh
function taaJitter(n, sw, sh) { const k = n % 8 + 1; return [(halton(k, 2) - 0.5) * 2 / sw, (halton(k, 3) - 0.5) * 2 / sh]; }
// Umrechnung lokal(jetzt) -> lokal(vorher): P' = P · s + o (Fokusversatz in vorherigen Einheiten), Höhe bleibt
// (die Höhe hängt am Fraktalpunkt, nicht an der Bildgröße). dfx/dfy = Fokus jetzt − vorher (Welt), u/up = lokale Einheit.
function taaXf(u, up, dfx, dfy) { return [u / up, dfx / up, dfy / up]; }
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Tiefe (Tiefenpuffer 0..1) -> Kameraabstand längs der Blickachse; dp = [A, B] aus u_depth (ndc_z = A + B / zc)
function depthToZc(d, dp) { return dp[1] / (d * 2 - 1 - dp[0]); }
function zcToDepth(zc, dp) { return ((dp[0] + dp[1] / zc) + 1) / 2; }
// Pixel (NDC, mit Jitter gezeichnet) + Kameraabstand -> Punkt (lokal jetzt) -> NDC im vorigen Bild (+ dortiger Abstand)
function reproject(ndc, zc, jit, c, cp, xf) {
    const a = (ndc[0] - jit[0]) * c.tan[0] * zc, b = (ndc[1] - jit[1]) * c.tan[1] * zc;
    const Q = [0, 1, 2].map(k => c.cam[k] + c.rt[k] * a + c.up[k] * b + c.fwd[k] * zc);
    const Qp = [Q[0] * xf[0] + xf[1], Q[1] * xf[0] + xf[2], Q[2]];
    const v = [Qp[0] - cp.cam[0], Qp[1] - cp.cam[1], Qp[2] - cp.cam[2]];
    const zp = dot3(v, cp.fwd);
    return { ndc: [dot3(v, cp.rt) / (cp.tan[0] * zp), dot3(v, cp.up) / (cp.tan[1] * zp)], zc: zp, Q };
}
// Himmel: nur die Richtung (unendlich fern) – Drehung der Kamera, kein Versatz
function reprojectDir(ndc, jit, c, cp) {
    const d = [0, 1, 2].map(k => c.fwd[k] + c.rt[k] * (ndc[0] - jit[0]) * c.tan[0] + c.up[k] * (ndc[1] - jit[1]) * c.tan[1]);
    const zp = dot3(d, cp.fwd);
    if (zp <= 1e-4) return null;
    return { ndc: [dot3(d, cp.rt) / (cp.tan[0] * zp), dot3(d, cp.up) / (cp.tan[1] * zp)] };
}
// Kameraabstand in der History (Alpha-Kanal): log2(zc / 0,02) / 12 -> 0..1 (8 bit: 3,3 % je Stufe; Himmel = 1)
const ZC_NEAR = 0.02, ZC_STOPS = 12;
const encZ = (zc) => Math.min(1, Math.max(0, Math.log2(zc / ZC_NEAR) / ZC_STOPS));
const decZ = (a) => ZC_NEAR * Math.pow(2, a * ZC_STOPS);
// Gewicht des neuen Bilds: Grundwert 0,1; mit der Bewegung (Pixel je Bild) bis 0,4 (weniger Nachziehen bei schnellem Flug)
// (6.7 E3 im Flug abgenommen und DURCHGEFALLEN, Standard bleibt ?taa=0 – tests/taa_series.py, TECHNIK_BERICHT.md: Im
// Dauerzoom des Flugs wird die History jedes Bild vergrößert und neu abgetastet; mit 0,1/0,4/1,25 (Vorbau) verschmierten Kanten
// und Farbflecken sichtbar. Diese Werte (Gewicht 0,3–0,5, Klemmung 0,75 σ) waren der beste Kompromiss: halbes Flimmern, aber
// an Kanten noch ~1,6× weiter von der Referenz als ohne TAA)
const TAA = { alpha: 0.3, alphaMax: 0.5, velLo: 2, velHi: 24, reject: 0.1, gamma: 0.75, flyScale: 0.7 };
function taaAlpha(velPx) {
    const t = Math.min(1, Math.max(0, (velPx - TAA.velLo) / (TAA.velHi - TAA.velLo)));
    return TAA.alpha + (TAA.alphaMax - TAA.alpha) * t * t * (3 - 2 * t);
}
// Disocclusion: erwarteter Abstand (aus der Reprojektion) gegen den gespeicherten – relativ > reject = verwerfen
const taaReject = (zExpected, zStored) => Math.abs(zStored - zExpected) > TAA.reject * zExpected;

root.FK3DTech = {
    flags, stage, STAGES, SH_RANGE, shadowTs, aoDir, aoRadius, horizonAO, AO_K, AO_FREE, AO_FULL, AO_DEPTH, aoShade, DET, exposure, sunTint, shoulder, toneNeutral, toneAgx, tonemap,
    TONE_KNEE, TONE_WHITE, TONE_DESAT, AGX_IN, AGX_OUT, casChannel, sharpForScale, BLOOM, gridSize, gridDivFromGpu, legacyDiv, gridKey, gridLoad, gridSave,
    GRID_MIN, GRID_MAX, GRID_LS, median, halton, taaJitter, taaXf, depthToZc, zcToDepth, reproject, reprojectDir, encZ, decZ, ZC_NEAR, ZC_STOPS,
    TAA, taaAlpha, taaReject,
};
})(typeof self !== 'undefined' ? self : globalThis);
