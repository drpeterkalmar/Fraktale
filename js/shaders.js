// shaders.js — GLSL-Quellen (WebGL2 / GLSL ES 3.00)
//
// Zwei Pass-Arten:
//  1. COMPUTE: rechnet pro Pufferpixel die glatte Iteration mu (float) und schreibt sie als
//     uint-Bits in einen R32UI-Puffer (Kernformat von WebGL2, keine Float-Render-Extension nötig).
//     Varianten: direkt (f32, flache Zooms) oder Perturbation mit Referenzorbit-Textur + BLA.
//  2. DISPLAY: färbt bis zu zwei Iterationspuffer ein, reprojiziert sie auf die aktuelle Kamera
//     (Gesten = 60 fps ohne Neuberechnung), Crossfade, Palette/Farbzyklus/Relief/Vignette.
// Mathe-Konventionen identisch zu js/fractal-core.js (dort ausführlich kommentiert).
(function (root) {
'use strict';

const VS = `#version 300 es
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}`;

const COMMON = `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
`;

// ---------------------------------------------------------------- 6.4 BUNTE MENGE (Innen-Information)
// Nur in der Rechen-Variante IN (Farbe der Menge = Bunt). Innenpunkte (nach maxIter nicht entkommen) laufen weiter, bis
// Periode und Multiplikator des anziehenden Zyklus feststehen (siehe inStep): log2|λ| = Σ log2|f'(z)| über einen Umlauf
// (0 = Knospenmitte, 1 = Rand); Julia: Klasse der Fatou-Komponente.
// Kodierung im Iterationspuffer – Innen bleibt im Bereich (−1,5; −1,0], also für alles andere weiter „innen“; die
// Klassifikation innen/außen und alle Außenwerte sind bitgleich zur Rechnung ohne Bunt:
//   Bits 12..21 = Klasse (Mandelbrot: Periode, Julia: Fatou-Klasse + 1; 1..1023, 0 = unbekannt), Bits 0..11 = Wert·4095
//   (Mandelbrot: |λ|; Julia: −log2 des kleinsten |z|² der Bahn / 64 – „Blasen“ um die Urbilder von 0).
const INNER_CORE = `
// höchstens so viele Zusatzschritte für die Zyklussuche (mindestens 4096, höchstens 16384)
uint innerBits(int cls, float val) {
    if (cls <= 0) return 0xBF800000u;
    uint pp = uint((cls - 1) % 1023 + 1);
    uint q = uint(clamp(val, 0.0, 1.0) * 4095.0 + 0.5);
    return 0xBF800000u | (pp << 12) | q;
}
float inLogD(vec2 z) {             // log2 |f'(z)|
#if F == 4
    return 1.5849625 + log2(max(dot(z, z), 1e-38));
#else
    return 1.0 + 0.5 * log2(max(dot(z, z), 1e-38));
#endif
}
// Zyklussuche über „Besuche“ beim Bahnpunkt w mit dem bisher kleinsten |z| (wie Atom-Domänen): neuer Tiefstwert oder
// |z − w| < |w|/2. Im anziehenden Zyklus kommt die Bahn genau einmal je Periode dort vorbei – auch wenn sie noch nicht
// eingeschwungen ist (Knospenrand, |λ| nahe 1). Drei Besuche mit gleichem Abstand P -> Kandidat, |λ| = Produkt |f'(z)|
// über den letzten Umlauf. |λ| < 0,8: sofort fertig. Sonst wird der Kandidat erst am Ende genommen, wenn er bis dahin
// der letzte war: Eine Bahn, die langsam an einem fast neutralen Zyklus kleinerer Periode vorbeikriecht (|λ| ≈ 1,
// z. B. Mini-Mandelbrots nahe einer Spitze), verlässt diese Stelle wieder und liefert danach die echte Periode.
struct InSt { vec2 w; int hitN; int per; int cnt; float ls; int cand; float candL; int candN; float trap; };
InSt inStart(vec2 z, float trap) { InSt s; s.w = z; s.hitN = 0; s.per = 0; s.cnt = 0; s.ls = 0.0; s.cand = 0; s.candL = 0.0; s.candN = 0; s.trap = trap; return s; }
uint inResult(int per, float ls, int nhit, float trap) {
#if F == 1
    // Julia: alle Innenpunkte haben denselben Zyklus -> Klasse = Phase des Punkts mit kleinstem |z| (welche
    // Fatou-Komponente), Wert = kleinstes |z|² der Bahn (Blasen)
    return innerBits(nhit % per + 1, -log2(max(trap, 1e-38)) / 64.0);
#else
    return innerBits(per, exp2(min(ls, 0.0)));
#endif
}
// ein Schritt (oder ein BLA-Sprung): dl = log2|f'| des Schritts (BLA: log2|A|), z = neuer Wert, n = Iterationszähler
// danach. 1 = fertig (o = Kodierung)
int inStep(inout InSt s, float dl, vec2 z, int n, out uint o) {
    o = 0xBF800000u;
    s.ls += dl;
    float z2 = dot(z, z), w2 = dot(s.w, s.w);
    vec2 d = z - s.w;
    bool rec = z2 < w2;
    if (!rec && dot(d, d) >= 0.25 * w2) return 0;
    if (rec) s.w = z;
    if (s.hitN > 0) {
        int dn = n - s.hitN;
        if (dn == s.per) s.cnt++; else { s.per = dn; s.cnt = 1; }
        if (s.cnt >= 2) {
            if (s.ls < -0.32193) { o = inResult(s.per, s.ls, n, s.trap); return 1; }    // |λ| < 0,8
            s.cand = s.per; s.candL = s.ls; s.candN = n;
        }
    }
    s.hitN = n; s.ls = 0.0;
    return 0;
}
// Ende der Zusatzschritte ohne frühes Ergebnis: letzter Kandidat (Knospenrand), wenn er bis zuletzt bestätigt wurde
// (sonst war es ein Vorbeikriechen, das längst vorbei ist), sonst unbekannt
uint inFinal(InSt s, int n) { return s.cand > 0 && n - s.candN <= 2 * s.cand + 2 ? inResult(s.cand, s.candL, s.candN, s.trap) : 0xBF800000u; }
`;

// ---------------------------------------------------------------- COMPUTE
function computeFS(formula, mode, err, de, inn) {
    const F = formula | 0;
    const IN = inn && F !== 5 ? 1 : 0;
    const common = `#version 300 es
#define F ${F}
#define ERR ${err && F !== 5 ? 1 : 0}
#define DE ${de && F !== 5 ? 1 : 0}
#define DT (ERR == 1 || DE == 1)
${IN ? '#define IN 1' : ''}
${COMMON}
uniform vec2 u_res;        // Puffergröße
uniform float u_scale;     // Weltbreite pro Pufferpixel
uniform int u_maxIter;
layout(location = 0) out uint o_it;
layout(location = 1) out vec4 o_de;   // R8: Distanzschätzung (6.1), Kodierung siehe encDE

// ---- Distanzschätzung (6.1): DE = |z| ln|z| / |dz/dPixel| = Abstand zur Menge in Pufferpixeln. Die Ableitung
// Dt = dz/dPixel läuft mit (Rebase lässt sie unverändert: z selbst springt nicht; BLA: Dt' = A·Dt + B·Pixel).
// Gespeichert als log2 in 8 bit: code = (log2 DE + 8)·16 (1..255, also 1/256 … 245 Pufferpixel, Stufe 4,4 %),
// 0 = keine Angabe (innen, Newton). Ohne Fehlerschätzung wird Dt gegen Überlauf umskaliert (dex = log2-Versatz).
float encDE(vec2 z, vec2 Dt, float dex) {
    float m = max(abs(Dt.x), abs(Dt.y));
    if (!(m < 3.0e38)) return 1.0 / 255.0;      // Überlauf/NaN: verschwindend kleiner Abstand
    if (m == 0.0) return 1.0;                   // Ableitung unterlaufen: sehr weit draußen
    vec2 u = Dt / m;
    float r = length(z);
    float e = (log2(r * log(r)) - log2(m) - 0.5 * log2(dot(u, u)) - dex + 8.0) * 16.0;
    return clamp(floor(e + 0.5), 1.0, 255.0) / 255.0;
}

// ---- Fehlerschätzung (nur finale Stufe, ERR=1): Ableitung Dt = dz/dPixel wird mitgeführt,
// q = Rundungsfehler / |Dt| ist der äquivalente Positionsfehler in PIXELN (RMS-Summe E2).
// Vorhergesagter Iterationsfehler dmu = K*sqrt(E2)*|Dt_n| / (|z| ln|z| ln2). Unsichere Pixel
// werden markiert (Kodierung s.u.) und anschließend auf der CPU in f64 exakt nachgerechnet.
const float EPS = 1.1920929e-7;   // 2^-23 (inkl. Faktor 2 Reserve)
const float ERRK = 4.0;
uint encode(float mu, bool unsure) {
    if (!unsure) return floatBitsToUint(mu);
    return floatBitsToUint(mu < 0.0 ? -2.0 : -(mu + 4.0));
}
float magn(vec2 v) { return max(abs(v.x), abs(v.y)) * 1.2; }  // |v| ohne Unterlauf (grob)
bool unsureEsc(float E2, vec2 Dt, vec2 z) {
    float r = length(z);
    return ERRK * sqrt(E2) * length(Dt) / (r * log(r) * 0.6931472) > 1.0;
}
bool unsureIn(float E2, vec2 Dt) { return ERRK * sqrt(E2) * length(Dt) > 0.05; }

float smoothI(int n, vec2 z) {
    float l2 = 0.5 * log2(dot(z, z));
#if F == 4
    return float(n) + 1.0 - log(l2) / log(3.0);
#else
    return float(n) + 1.0 - log2(l2);
#endif
}
${IN ? INNER_CORE : ''}
`;
    if (mode === 'direct') return common + `
uniform vec2 u_center;     // Ansichtsmitte (f32 reicht bis Zoom ~1e3)
uniform vec2 u_julia;
float newton(vec2 z) {
    for (int j = 0; j < 80; j++) {
        vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
        vec2 z3 = cmul(z, z2);
        vec2 num = 2.0 * z3 + vec2(1.0, 0.0);
        vec2 den = 3.0 * z2;
        float d2 = dot(den, den);
        if (d2 < 1e-30) break;
        z = vec2(dot(num, den), num.y * den.x - num.x * den.y) / d2;
        vec2 a = z - vec2(1.0, 0.0), b = z - vec2(-0.5, 0.8660254), c = z - vec2(-0.5, -0.8660254);
        if (dot(a, a) < 1e-6) return float(j) + 1.0;
        if (dot(b, b) < 1e-6) return float(j) + 1001.0;
        if (dot(c, c) < 1e-6) return float(j) + 2001.0;
    }
    return -1.0;
}
void main() {
    vec2 p = gl_FragCoord.xy - 0.5 * u_res;
    vec2 pos = u_center + p * u_scale;
    float result = -1.0;
    o_de = vec4(0.0);
#if F == 5
    result = newton(pos);
#else
    float dex = 0.0;
    bool skip = false;
#if F == 1
    vec2 z = pos, c = u_julia;
    vec2 Dt = vec2(u_scale, 0.0);
    if (dot(z, z) > 256.0) {
        result = smoothI(0, z);
#if DE
        o_de = vec4(encDE(z, Dt, 0.0));
#endif
    }
#else
    vec2 z = vec2(0.0), c = pos;
    vec2 Dt = vec2(0.0);
#endif
#if F == 0
    // Hauptkardioide und Periode-2-Kreis: mathematisch innen, keine Iteration nötig (6.1; Sicherheitsabstand
    // ~1e-5 zum Rand, dort wird wie bisher iteriert -> f32-Rundung der Position spielt keine Rolle)
    {
        float xq = pos.x - 0.25, q = xq * xq + pos.y * pos.y;
        vec2 b = pos + vec2(1.0, 0.0);
        if (q * (q + xq) < 0.25 * pos.y * pos.y - 1e-5 || dot(b, b) < 0.0625 - 1e-5) skip = true;
    }
#endif
    float E2 = 0.0;
    bool unsure = false;
#ifdef IN
    float trap = dot(z, z);
#endif
    if (result < 0.0 && !skip) for (int n = 1; n <= u_maxIter; n++) {
#if DT
#if F == 4
        Dt = 3.0 * cmul(cmul(z, z), Dt);
#else
        Dt = 2.0 * cmul(z, Dt);
#endif
#if F != 1
        Dt.x += u_scale;
#endif
#if ERR
        { float q = EPS * (dot(z, z) + length(c) * (n == 1 ? 2.0 : 1.0)) / max(length(Dt), 1e-30); E2 += q * q; }
#else
        if ((n & 7) == 0 && max(abs(Dt.x), abs(Dt.y)) > 1e6) { Dt *= 8.6736174e-19; dex += 60.0; }   // ≤ 32×/Schritt: alle 8 reicht
#endif
#endif
#if F == 2
        z = vec2(z.x * z.x - z.y * z.y, abs(2.0 * z.x * z.y)) + c;
#elif F == 3
        z = vec2(z.x * z.x - z.y * z.y, -2.0 * z.x * z.y) + c;
#elif F == 4
        z = cmul(z, cmul(z, z)) + c;
#else
        z = cmul(z, z) + c;
#endif
        if (dot(z, z) > 256.0) {
            result = smoothI(n, z);
#if ERR
            unsure = unsureEsc(E2, Dt, z);
#endif
#if DE
            o_de = vec4(encDE(z, Dt, dex));
#endif
            break;
        }
#if defined(IN) && F == 1
        trap = min(trap, dot(z, z));
#endif
    }
#if ERR
    if (result < 0.0) unsure = unsureIn(E2, Dt);
#endif
#ifdef IN
    // 6.4 Bunte Menge: Zyklus des Innenpunkts (Hauptkardioide/Periode-2-Kreis exakt: λ = 1 − √(1 − 4c) bzw. 4(c + 1))
    if (result < 0.0 && !unsure) {
        uint ob = 0xBF800000u;
#if F == 0
        if (skip) {
            vec2 q = vec2(1.0, 0.0) - 4.0 * pos;
            float r = length(q);
            vec2 sq = vec2(sqrt(max(0.5 * (r + q.x), 0.0)), (q.y < 0.0 ? -1.0 : 1.0) * sqrt(max(0.5 * (r - q.x), 0.0)));
            vec2 b2 = pos + vec2(1.0, 0.0);
            ob = dot(b2, b2) < 0.0625 ? innerBits(2, 4.0 * length(b2)) : innerBits(1, length(vec2(1.0, 0.0) - sq));
        } else
#endif
        {
            InSt st = inStart(z, trap);
            int nn = u_maxIter;
            int done = 0;
            for (int k = 0; k < clamp(u_maxIter, 4096, 16384); k++) {
                vec2 zp = z;
#if F == 2
                z = vec2(z.x * z.x - z.y * z.y, abs(2.0 * z.x * z.y)) + c;
#elif F == 3
                z = vec2(z.x * z.x - z.y * z.y, -2.0 * z.x * z.y) + c;
#elif F == 4
                z = cmul(z, cmul(z, z)) + c;
#else
                z = cmul(z, z) + c;
#endif
                nn++;
                if (dot(z, z) > 256.0) { done = 2; break; }
                if (inStep(st, inLogD(zp), z, nn, ob) == 1) { done = 1; break; }
            }
            if (done == 0) ob = inFinal(st, nn);
        }
        o_it = ob;
        return;
    }
#endif
    o_it = encode(result, unsure);
    return;
#endif
    o_it = floatBitsToUint(result);
}`;

    // ---- Perturbation (+BLA für holomorphe Formeln 0/1/4)
    const hasBLA = (F === 0 || F === 1 || F === 4);
    return common + `
uniform vec2 u_offset;                 // Ansichtsmitte − Referenzpunkt (Welt)
uniform highp sampler2D u_orbit;       // RG32F, 2048 breit: [Orbit A | Orbit B]
uniform int u_baseA, u_lenA, u_baseB, u_lenB;
${hasBLA ? `uniform highp sampler2D u_blaAB;  // RGBA32F: A.xy, B.xy
uniform highp sampler2D u_blaR;        // R32F: Gültigkeitsradius
uniform int u_blaOn;
uniform int u_blaL[2];
uniform int u_blaOff[48];              // [Orbit*24 + Stufe]` : ''}

vec2 orb(int i) { return texelFetch(u_orbit, ivec2(i & 2047, i >> 11), 0).xy; }

// |a| < |b| — gegen Unterlauf skaliert (tiefe Zooms: Werte ~1e-30)
bool lessMag(vec2 a, vec2 b) {
    float s = max(max(abs(a.x), abs(a.y)), max(abs(b.x), abs(b.y)));
    if (s < 1e-15) {
        if (s == 0.0) return false;
        float k = 1.0 / s; a *= k; b *= k;
    }
    return dot(a, a) < dot(b, b);
}
float diffabs(float c, float d) {
    if (c >= 0.0) return (c + d >= 0.0) ? d : -(2.0 * c + d);
    return (c + d > 0.0) ? (2.0 * c + d) : -d;
}
int ctz(int k) { return int(log2(float(k & -k)) + 0.5); }

void main() {
    vec2 p = gl_FragCoord.xy - 0.5 * u_res;
    vec2 dc = u_offset + p * u_scale;
    int base = u_baseA, len = u_lenA, o = 0;
    vec2 Zc = orb(base);
    float result = -1.0;
    o_de = vec4(0.0);
#if F == 1
    vec2 dz = dc, c = vec2(0.0);
    { vec2 z0 = Zc + dz; if (dot(z0, z0) > 256.0) { o_it = floatBitsToUint(smoothI(0, z0));
#if DE
      o_de = vec4(encDE(z0, vec2(u_scale, 0.0), 0.0));
#endif
      return; } }
#else
    vec2 dz = vec2(0.0), c = dc;
#endif
    int m = 0, n = 0;
    int bwait = 0, bback = 1;       // BLA-Backoff (spart Texturzugriffe, wenn dz zu groß ist)
#if DT
#if F == 1
    vec2 Dt = vec2(u_scale, 0.0);
#else
    vec2 Dt = vec2(0.0);
#endif
    float dex = 0.0;
#endif
#if ERR
    float E2 = 0.0;
    bool unsure = false;
    float mc = magn(c);
#endif
#ifdef IN
    int ph = 0, nEnd = u_maxIter;     // 6.4: ph 1 = Zyklussuche nach maxIter (ohne BLA, jeder Schritt einzeln)
    InSt st = inStart(vec2(0.0), 0.0);
    uint ob = 0xBF800000u;
    float trap = dot(Zc + dz, Zc + dz);
#endif
    for (int guard = 0; guard < 4000000; guard++) {
#ifdef IN
        if (n >= nEnd) {
            if (ph == 0) {
#if ERR
                unsure = unsureIn(E2, Dt);   // wie ohne Bunt: am Ende der regulären Iteration
                if (unsure) break;
#endif
                ph = 1; nEnd = n + clamp(u_maxIter, 4096, 16384); st = inStart(Zc + dz, trap);
                continue;
            }
            ob = inFinal(st, n);
            break;
        }
#else
        if (n >= u_maxIter) break;
#endif
${hasBLA ? `        if (u_blaOn != 0 && m > 0 && --bwait <= 0
#ifdef IN
            && ph == 0            // Zusatzphase: jeder Schritt einzeln (BLA-Tabellen reichen nur bis zum regulären Ende)
#endif
        ) {
            int k = m - 1;
            int L = u_blaL[o];
            int lmax = (k == 0) ? L : min(L, ctz(k));
            float dmax = max(abs(dz.x), abs(dz.y)) * 1.4142136;
            // R fällt monoton mit der Stufe: aufsteigend suchen, bei erster ungültiger Stufe stoppen
            int bestE = -1, bestL = 0;
            for (int l = 1; l <= lmax; l++) {
                int st = 1 << l;
                if (m + st > len - 1 || n + st > u_maxIter) break;
                int e = u_blaOff[o * 24 + l] + (k >> l);
                if (dmax < texelFetch(u_blaR, ivec2(e & 2047, e >> 11), 0).r) { bestE = e; bestL = l; } else break;
            }
            bool applied = false;
            if (bestE < 0) { bback = min(bback * 2, 64); bwait = bback; }
            else {
                bback = 1;
                vec4 ab = texelFetch(u_blaAB, ivec2(bestE & 2047, bestE >> 11), 0);
#if DT
                {
                    vec2 nD = cmul(ab.xy, Dt) + ab.zw * u_scale;
#if ERR
                    float den = max(magn(nD), 1e-37);
                    float q = 2.0 * EPS * (length(ab.xy) * (magn(dz) / den) + length(ab.zw) * (mc / den));
                    E2 += q * q;
#endif
                    Dt = nD;
#if !ERR
                    if (max(abs(Dt.x), abs(Dt.y)) > 1e6) { Dt *= 8.6736174e-19; dex += 60.0; }
#endif
                }
#endif
                dz = cmul(ab.xy, dz) + cmul(ab.zw, c);
                m += 1 << bestL; n += 1 << bestL;
                applied = true;
            }
            if (applied) {
                Zc = orb(base + m);
                vec2 z = Zc + dz;
#if defined(IN) && F == 1
                trap = min(trap, dot(z, z));
#endif
                if (dot(z, z) > 256.0) {
                    result = smoothI(n, z);
#if ERR
                    unsure = unsureEsc(E2, Dt, z);
#endif
#if DE
                    o_de = vec4(encDE(z, Dt, dex));
#endif
                    break;
                }
                if (m >= len - 1 || lessMag(z, dz)) {
#if ERR
                    { float q = EPS * length(Zc) / max(magn(Dt), 1e-37); E2 += q * q; }
#endif
                    o = 1; base = u_baseB; len = u_lenB; dz = z; m = 0; Zc = vec2(0.0); bwait = 0; bback = 1;
                }
                continue;
            }
        }` : ''}
        vec2 Z = Zc;
#ifdef IN
        vec2 zp = Z + dz;
#endif
#if DT
        {
            vec2 zf = Z + dz;
#if F == 4
            Dt = 3.0 * cmul(cmul(zf, zf), Dt);
#else
            Dt = 2.0 * cmul(zf, Dt);
#endif
#if F != 1
            Dt.x += u_scale;
#endif
#if ERR
            float den = max(magn(Dt), 1e-37);
            float rd = magn(dz) / den;
            float q = EPS * (2.0 * length(Z) * rd + magn(dz) * rd + mc / den);
            E2 += q * q;
#else
            if ((n & 7) == 0 && max(abs(Dt.x), abs(Dt.y)) > 1e6) { Dt *= 8.6736174e-19; dex += 60.0; }   // ≤ 32×/Schritt: alle 8 reicht
#endif
        }
#endif
#if F == 2
        vec2 nd;
        nd.x = (2.0 * Z.x + dz.x) * dz.x - (2.0 * Z.y + dz.y) * dz.y;
        nd.y = 2.0 * diffabs(Z.x * Z.y, Z.x * dz.y + Z.y * dz.x + dz.x * dz.y);
        dz = nd + c;
#elif F == 3
        vec2 t = 2.0 * cmul(Z, dz) + cmul(dz, dz);
        dz = vec2(t.x, -t.y) + c;
#elif F == 4
        vec2 t = 3.0 * cmul(Z, Z) + 3.0 * cmul(Z, dz) + cmul(dz, dz);
        dz = cmul(dz, t) + c;
#else
        dz = 2.0 * cmul(Z, dz) + cmul(dz, dz) + c;
#endif
        m++; n++;
        Zc = orb(base + m);
        vec2 z = Zc + dz;
#ifdef IN
#if F == 1
        trap = min(trap, dot(z, z));
#endif
        if (ph > 0) {
            if (dot(z, z) > 256.0 || inStep(st, inLogD(zp), z, n, ob) == 1) break;
            // Ende des Referenzorbits: hier auswerten (ein Rebase mitten im Zyklus kostet im Deep Zoom die Genauigkeit)
            if (m >= len - 1) { ob = inFinal(st, n); break; }
            if (lessMag(z, dz)) { o = 1; base = u_baseB; len = u_lenB; dz = z; m = 0; Zc = vec2(0.0); }
            continue;
        }
#endif
        if (dot(z, z) > 256.0) {
            result = smoothI(n, z);
#if ERR
            unsure = unsureEsc(E2, Dt, z);
#endif
#if DE
            o_de = vec4(encDE(z, Dt, dex));
#endif
            break;
        }
        if (m >= len - 1 || lessMag(z, dz)) {
#if ERR
            { float q = EPS * length(Zc) / max(magn(Dt), 1e-37); E2 += q * q; }
#endif
            o = 1; base = u_baseB; len = u_lenB; dz = z; m = 0; Zc = vec2(0.0); bwait = 0; bback = 1;
        }
    }
#ifdef IN
#if ERR
    if (result < 0.0) { o_it = unsure ? floatBitsToUint(-2.0) : ob; return; }
#else
    if (result < 0.0) { o_it = ob; return; }
#endif
#endif
#if ERR
    if (result < 0.0) unsure = unsureIn(E2, Dt);
    o_it = encode(result, unsure);
#else
    o_it = floatBitsToUint(result);
#endif
}`;
}

// ---------------------------------------------------------------- DISPLAY
// Bis zu NL Iterationspuffer ("Ebenen"), von app.js nach Schärfe sortiert (schärfste oben). Jede Ebene
// wird auf die aktuelle Kamera reprojiziert und mit Deckkraft = gefederte Abdeckung × Einblendung
// von oben nach unten aufgetragen: eine gröbere Ebene füllt nur Lücken, eine schärfere blendet weich
// darüber. Vergrößerte Ebenen (Vorschau) werden auf dem Iterationswert interpoliert (Catmull-Rom),
// nicht auf Farben. u_legacy = 1: Verhalten 5.0.1 (zwei Ebenen, harte Kante, Farbmischung).
const NL = 8;
// Palette, Außenfarbe, Dekodierung – gemeinsam für 2D (DISPLAY_FS) und 3D (js/three.js)
const PAL_GLSL = `vec3 palette(float t) {
    t = fract(t);
    if (u_palCustom == 1) {
        t *= 6.0;
        int s = int(t);
        float f = t - float(s);
        vec3 a = u_custom[0], b = u_custom[1];
        if (s == 1) { a = u_custom[1]; b = u_custom[2]; }
        else if (s == 2) { a = u_custom[2]; b = u_custom[3]; }
        else if (s == 3) { a = u_custom[3]; b = u_custom[4]; }
        else if (s == 4) { a = u_custom[4]; b = u_custom[5]; }
        else if (s >= 5) { a = u_custom[5]; b = u_custom[0]; }
        return mix(a, b, f);
    }
    return u_palA + u_palB * cos(6.28318 * (u_palC * t + u_palD));
}

vec3 exteriorColor(float v) {
    if (u_formula == 5) {
        int root = int(v / 1000.0);
        float it = mod(v, 1000.0);
        float t = sqrt(it / float(u_maxIter)) * 3.0;
        vec3 rc = root == 0 ? vec3(0.9, 0.2, 0.2) : (root == 1 ? vec3(0.2, 0.9, 0.2) : vec3(0.3, 0.4, 0.9));
        vec3 col = vec3(1.0) - mix(rc, palette(t + u_cycle), 0.6);
        return clamp(col * 0.9, 0.0, 1.0);
    }
    if (u_banded == 1) v = floor(v);
    return palette(v * 0.08 * u_density + u_cycle);
}

// 6.4 Bunte Menge: Farbe eines Innenpunkts aus der Innen-Information (Kodierung siehe INNER_CORE). u_inMode 0 = aus
// (Mengenfarbe vc), 1 = Inseln (Periode -> Palettenfarbe, zur Knospenmitte heller), 2 = Ringe (Multiplikator -> Verlauf).
// Unbekannt (Zyklus nicht gefunden, z. B. dicht am Rand) = Mengenfarbe.
uniform int u_inMode;
vec3 inCol(float v, vec3 vc) {
    if (u_inMode == 0) return vc;
    uint b = floatBitsToUint(v);
    uint cls = (b >> 12) & 1023u;
    if (cls == 0u || v < -1.5) return vc;
    float q = float(b & 4095u) * (1.0 / 4095.0);
    float k = float(cls);
    const vec3 LW = vec3(0.299, 0.587, 0.114);
    if (u_formula == 1) {
        // Julia: Klasse der Fatou-Komponente -> Farbe, Blasen aus dem kleinsten |z| der Bahn (q·64 = −log2|z|²)
        float bub = q * 64.0;
        if (u_inMode == 1) {
            vec3 c1 = palette(0.11 + 0.618034 * k + u_cycle), c2 = palette(0.61 + 0.618034 * k + u_cycle);
            vec3 base = dot(c1, LW) < 0.28 && dot(c2, LW) > dot(c1, LW) ? c2 : c1;
            return base * (0.72 + 0.28 * cos(6.2831853 * bub * 0.5));
        }
        return palette(bub * 0.125 + 0.1 * k + u_cycle) * 0.95;
    }
    // Mandelbrot & Co.: q = |λ| (0 Knospenmitte, 1 Rand)
    float s = 1.0 - q;
    if (u_inMode == 1) {
        // Inseln: Periode -> Palettenfarbe (Goldener Schnitt: benachbarte Perioden weit auseinander; ist die Stelle der
        // Palette sehr dunkel, die gegenüberliegende), zur Knospenmitte heller wie eine angeleuchtete Kuppel
        vec3 c1 = palette(0.11 + 0.618034 * k + u_cycle), c2 = palette(0.61 + 0.618034 * k + u_cycle);
        vec3 base = dot(c1, LW) < 0.28 && dot(c2, LW) > dot(c1, LW) ? c2 : c1;
        return base * (0.22 + 0.78 * smoothstep(0.0, 1.0, sqrt(s)));
    }
    // Ringe: |λ| als Verlauf durch die Palette (Ringe um den Knospenkern), zum Rand abgedunkelt
    return palette(1.6 * sqrt(q) + 0.05 * k + u_cycle) * (0.3 + 0.7 * smoothstep(0.0, 0.35, s));
}

// Iterationswert als Höhe fürs Relief (log staucht die Randzonen)
float heightOf(float v) { return log2(1.0 + max(v, 0.0)); }

// Dekodierung: <= -3 markiert-außen (mu = -v-4), -2 markiert-innen, -1 innen
float fetchV(usampler2D t, ivec2 c) {
    float v = uintBitsToFloat(texelFetch(t, c, 0).r);
    if (v <= -3.0) return -v - 4.0;
    return v < -1.5 ? -1.0 : v;
}

// 6.1 Distanzschätzung (R8, Kodierung siehe computeFS/encDE): Abstand zur Menge in Pufferpixeln.
// Innen = 0, keine Angabe (Newton, alte Ebene) = weit weg.
float fetchDE(sampler2D t, ivec2 c, float v) {
    if (v < 0.0) return 0.0;
    float e = texelFetch(t, c, 0).r * 255.0;
    return e < 0.5 ? 1e4 : exp2(e * 0.0625 - 8.0);
}
// Mengen-Anteil eines Bildpunkts aus der bilinear interpolierten Distanz (in Zielpixeln): weicher Saum
// über ~1 Pixel – die Menge wird eine geschlossene Fläche mit kantengeglätteter Kontur (wie Video-Renderer)
float deMask(float d00, float d10, float d01, float d11, vec2 f, float pxPerTexel, vec2 lohi) {
    float d = mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y) * pxPerTexel;
    return 1.0 - smoothstep(lohi.x, lohi.y, d);
}

`;
const DISPLAY_FS = `#version 300 es
${COMMON}
${Array.from({ length: NL }, (_, i) => `uniform usampler2D u_t${i};`).join('\n')}
${Array.from({ length: NL }, (_, i) => `uniform sampler2D u_d${i};`).join('\n')}
uniform int u_deOn;             // 6.1: Menge glatt (Distanzschätzung)
uniform vec2 u_deLH;            // Saum: voll Mengenfarbe unter lo, Außenfarbe ab hi (Zielpixel)
uniform vec4 u_xf[${NL}];       // Texel = Zielpixel * xy + zw
uniform vec2 u_size[${NL}];
uniform float u_alpha[${NL}];   // Einblendung 0..1
uniform int u_n;                // Zahl der Ebenen
uniform int u_legacy;           // 1 = 5.0.1: Ebene 0 = neu (B), Ebene 1 = alt (A), Crossfade u_mixB
uniform float u_mixB;
uniform float u_feather;        // Federbreite der Ebenenränder (Zielpixel)
uniform int u_recon;            // 1 = Vorschau auf dem Iterationswert rekonstruieren
uniform vec2 u_target;          // Zielgröße in Pixeln
uniform int u_formula, u_maxIter;
uniform vec3 u_palA, u_palB, u_palC, u_palD;
uniform int u_palCustom;
uniform vec3 u_custom[6];
uniform float u_cycle, u_density, u_time, u_relief;
uniform int u_particles, u_banded;
uniform vec3 u_setCol;          // 6.2: Farbe der Menge (Schwarz = vec3(0, 0, 0.015) wie bis 6.1)
out vec4 fragColor;
// 6.2: bei heller Menge ein weicher dunkler Saum außen an der Kontur (1,25–4 Zielpixel), damit der Rand klar bleibt
float rimShade(float d00, float d10, float d01, float d11, vec2 f, float pxPerTexel) {
    float sl = dot(u_setCol, vec3(0.299, 0.587, 0.114));
    if (sl < 0.35) return 1.0;
    float d = mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y) * pxPerTexel;
    return 1.0 - 0.5 * smoothstep(0.35, 0.8, sl) * (1.0 - smoothstep(1.25, 4.0, d));
}

${PAL_GLSL}vec3 relief(vec3 col, float v00, float v10, float v01, float v11, vec2 f, float kx) {
    float h00 = heightOf(v00), h10 = heightOf(v10), h01 = heightOf(v01), h11 = heightOf(v11);
    vec2 g = vec2(mix(h10 - h00, h11 - h01, f.y), mix(h01 - h00, h11 - h10, f.x));
    g /= max(kx, 1e-6);                   // Gradient pro Texel -> pro Zielpixel normieren
    // gesättigte Hangneigung: glatte Zonen bekommen sichtbare Wölbung, Rauschzonen laufen nicht aus
    float gm = length(g);
    float sl = 60.0 * u_relief * gm;
    sl = sl / (1.0 + sl);
    vec2 dir = gm > 0.0 ? g / gm : vec2(0.0);
    vec3 nrm = normalize(vec3(-dir * sl * 1.6, 1.0));
    vec3 L = normalize(vec3(-0.55, 0.65, 0.75));
    float diff = max(dot(nrm, L), 0.0);
    float spec = pow(max(dot(reflect(-L, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
    float shade = mix(1.0, 0.25 + 1.0 * diff, clamp(u_relief, 0.0, 1.0));
    return col * shade + vec3(spec) * 0.35 * u_relief;
}

// bilinear eingefärbte Probe aus 4 Texeln (Verhalten 5.0.1; bei Ausrichtung 1:1 exakt der Texel)
vec3 shade4(float v00, float v10, float v01, float v11, vec2 f, float kx, vec3 voidCol) {
    vec3 c00 = v00 < 0.0 ? inCol(v00, voidCol) : exteriorColor(v00);
    vec3 c10 = v10 < 0.0 ? inCol(v10, voidCol) : exteriorColor(v10);
    vec3 c01 = v01 < 0.0 ? inCol(v01, voidCol) : exteriorColor(v01);
    vec3 c11 = v11 < 0.0 ? inCol(v11, voidCol) : exteriorColor(v11);
    vec3 col = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    if (u_relief > 0.0 && u_formula != 5 && v00 >= 0.0 && v10 >= 0.0 && v01 >= 0.0 && v11 >= 0.0)
        col = relief(col, v00, v10, v01, v11, f, kx);
    return col;
}

// 5.0.1: harte Abdeckung, Farbmischung
vec3 sampleLayer(usampler2D tex, vec2 size, vec4 xf, vec3 voidCol, out float w) {
    vec2 tc = gl_FragCoord.xy * xf.xy + xf.zw;
    if (tc.x < 0.0 || tc.y < 0.0 || tc.x > size.x || tc.y > size.y) { w = 0.0; return vec3(0.0); }
    w = 1.0;
    vec2 q = tc - 0.5;
    vec2 fl = floor(q);
    vec2 f = q - fl;
    ivec2 mx = ivec2(size) - 1;
    ivec2 i0 = clamp(ivec2(fl), ivec2(0), mx);
    ivec2 i1 = clamp(ivec2(fl) + 1, ivec2(0), mx);
    return shade4(fetchV(tex, i0), fetchV(tex, ivec2(i1.x, i0.y)), fetchV(tex, ivec2(i0.x, i1.y)), fetchV(tex, i1), f, xf.x, voidCol);
}

// Abdeckung mit gefederten Rändern. Federbreite = Abstand der Kante vom Bildrand (max. u_feather):
// stetig, auch wenn eine Kante gerade erst ins Bild wandert; Kanten außerhalb des Bildes federn nicht.
float coverage(vec2 tc, vec2 size, vec4 xf) {
    if (tc.x < 0.0 || tc.y < 0.0 || tc.x > size.x || tc.y > size.y) return 0.0;
    if (u_feather <= 0.0) return 1.0;
    vec2 e0 = -xf.zw / xf.xy, e1 = (size - xf.zw) / xf.xy;
    vec2 f0 = clamp(e0, 0.0, u_feather), f1 = clamp(u_target - e1, 0.0, u_feather);
    vec2 p = gl_FragCoord.xy;
    float c = 1.0;
    if (f0.x > 0.0) c = min(c, (p.x - e0.x) / f0.x);
    if (f0.y > 0.0) c = min(c, (p.y - e0.y) / f0.y);
    if (f1.x > 0.0) c = min(c, (e1.x - p.x) / f1.x);
    if (f1.y > 0.0) c = min(c, (e1.y - p.y) / f1.y);
    return smoothstep(0.0, 1.0, clamp(c, 0.0, 1.0));
}

vec4 cubicW(float t) {
    float t2 = t * t, t3 = t2 * t;
    return 0.5 * vec4(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2);
}

// Probe einer Ebene (neu): gefedert; vergrößerte Ebenen (Vorschau) auf dem Iterationswert rekonstruiert;
// 6.1: Mengen-Saum aus der Distanzschätzung (dtex) pro Zielpixel
vec3 sampleLayerN(usampler2D tex, sampler2D dtex, vec2 size, vec4 xf, vec3 voidCol, out float w) {
    vec2 tc = gl_FragCoord.xy * xf.xy + xf.zw;
    w = coverage(tc, size, xf);
    if (w <= 0.0) return vec3(0.0);
    vec2 q = tc - 0.5;
    vec2 fl = floor(q);
    vec2 f = q - fl;
    ivec2 b = ivec2(fl);
    ivec2 mx = ivec2(size) - 1;
    ivec2 i0 = clamp(b, ivec2(0), mx), i1 = clamp(b + 1, ivec2(0), mx);
    float v00 = fetchV(tex, i0), v10 = fetchV(tex, ivec2(i1.x, i0.y)), v01 = fetchV(tex, ivec2(i0.x, i1.y)), v11 = fetchV(tex, i1);
    float dm = 0.0, rim = 1.0;
    // 6.4: Mengenfarbe dieses Pixels = Innenfarben der Innentexel (bilinear); keine Innentexel -> Mengenfarbe (Saum)
    if (u_inMode > 0) {
        vec4 wq = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y) * (1.0 - step(0.0, vec4(v00, v10, v01, v11)));
        float wi = wq.x + wq.y + wq.z + wq.w;
        if (wi > 0.0) voidCol = (wq.x * inCol(v00, voidCol) + wq.y * inCol(v10, voidCol) + wq.z * inCol(v01, voidCol) + wq.w * inCol(v11, voidCol)) / wi;
    }
    if (u_deOn == 1) {
        float e00 = fetchDE(dtex, i0, v00), e10 = fetchDE(dtex, ivec2(i1.x, i0.y), v10), e01 = fetchDE(dtex, ivec2(i0.x, i1.y), v01), e11 = fetchDE(dtex, i1, v11);
        dm = deMask(e00, e10, e01, e11, f, 1.0 / xf.x, u_deLH);
        rim = rimShade(e00, e10, e01, e11, f, 1.0 / xf.x);
    }
    if (u_recon == 0 || xf.x >= 0.9) return mix(shade4(v00, v10, v01, v11, f, xf.x, voidCol) * rim, voidCol, dm);
    // Innen/Außen getrennt: Außenwerte untereinander interpolieren, Innenanteil weich-scharf darüber
    vec4 v = vec4(v00, v10, v01, v11);
    vec4 wb = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    vec4 ext = step(0.0, v);
    float wo = dot(wb, ext);
    float inside = 1.0 - wo;
    if (wo <= 0.0) return voidCol;
    float lo = 1e30, hi = -1e30;
    for (int i = 0; i < 4; i++) if (v[i] >= 0.0) { lo = min(lo, v[i]); hi = max(hi, v[i]); }
    float thr = 2.0 / max(u_density, 0.05);
    vec3 col;
    if (hi - lo < thr && u_formula != 5 || (u_formula == 5 && hi - lo < 4.0)) {
        float mu = dot(wb * ext, v) / wo;
        if (wo > 0.999) {
            // glatte Zone: Catmull-Rom über 4x4 (C1-stetig, keine Rautenmuster), auf [lo, hi] begrenzt
            vec4 wx = cubicW(f.x), wy = cubicW(f.y);
            float s = 0.0, mn = lo, mxv = hi;
            bool ok = true;
            for (int j = 0; j < 4; j++) {
                float r = 0.0;
                for (int i = 0; i < 4; i++) {
                    float t = fetchV(tex, clamp(b + ivec2(i - 1, j - 1), ivec2(0), mx));
                    if (t < 0.0) ok = false;
                    mn = min(mn, t); mxv = max(mxv, t);
                    r += wx[i] * t;
                }
                s += wy[j] * r;
            }
            if (ok && mxv - mn < 3.0 * thr) mu = clamp(s, lo, hi);
        }
        col = exteriorColor(mu);
    } else {
        vec3 c = vec3(0.0);
        for (int i = 0; i < 4; i++) if (v[i] >= 0.0) c += wb[i] * exteriorColor(v[i]);
        col = c / wo;
    }
    if (u_relief > 0.0 && u_formula != 5 && wo > 0.999) col = relief(col, v00, v10, v01, v11, f, xf.x);
    col = mix(col * rim, voidCol, max(dm, smoothstep(0.15, 0.85, inside)));
    return col;
}

vec3 voidColor() {
    vec3 bg = u_setCol;
    // Funkeln nur auf dunkler Menge (auf hellen Farben wirkt es schmutzig): blendet zwischen Helligkeit 0,15 und 0,45 aus
    float sk = 1.0 - smoothstep(0.15, 0.45, dot(bg, vec3(0.299, 0.587, 0.114)));
    if (u_particles == 0 || sk <= 0.0) return bg;
    vec2 uv = gl_FragCoord.xy / min(u_target.x, u_target.y);
    float sparkle = 0.0;
    for (int layer = 0; layer < 3; layer++) {
        float speed = 0.15 + float(layer) * 0.08;
        float sc = 25.0 + float(layer) * 15.0;
        vec2 p = uv * sc + vec2(u_time * speed * 0.7, u_time * speed);
        vec2 cell = floor(p);
        vec2 fr = fract(p) - 0.5;
        float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
        float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
        vec2 off = vec2(sin(h * 6.28 + u_time * 0.5) * 0.3, cos(h2 * 6.28 + u_time * 0.4) * 0.3);
        float d = length(fr - off);
        float glow = (h * 0.8 + 0.2) * exp(-d * d * 80.0) * (0.5 + 0.5 * sin(u_time * 2.0 + h * 20.0));
        sparkle += glow * (0.6 - float(layer) * 0.15);
    }
    vec3 pc = palette(u_time * 0.1) * 0.5 + vec3(0.3, 0.4, 0.8) * 0.5;
    return bg + sparkle * pc * 0.35 * sk;
}

void main() {
    vec3 vc = voidColor();
    vec3 col = vec3(0.012, 0.016, 0.04);
    if (u_legacy == 1) {
        float wa = 0.0, wb = 0.0;
        vec3 ca = vec3(0.0), cb = vec3(0.0);
        if (u_n > 1) ca = sampleLayer(u_t1, u_size[1], u_xf[1], vc, wa);
        if (u_n > 0) cb = sampleLayer(u_t0, u_size[0], u_xf[0], vc, wb);
        if (wa > 0.0) col = ca;
        if (wb > 0.0) col = (wa > 0.0) ? mix(ca, cb, u_mixB) : cb;
    } else {
        // von oben (schärfste Ebene) nach unten auftragen, bis das Pixel deckt
        vec3 acc = vec3(0.0);
        float T = 1.0;
${Array.from({ length: NL }, (_, i) => `        if (u_n > ${i} && T > 0.003) { float w; vec3 c = sampleLayerN(u_t${i}, u_d${i}, u_size[${i}], u_xf[${i}], vc, w); float a = w * u_alpha[${i}]; acc += T * a * c; T *= 1.0 - a; }`).join('\n')}
        col = acc + T * col;
    }
    // Sättigung, Vignette, Gamma wie v4
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.2);
    vec2 vv = gl_FragCoord.xy / u_target - 0.5;
    col *= 1.0 - dot(vv, vv) * 0.25;
    col = pow(max(col, vec3(0.0)), vec3(0.92));
    fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- MANDELBULB (3D, direkt Farbe)
const BULB_FS = `#version 300 es
${COMMON}
uniform vec2 u_target;
uniform vec2 u_rot;        // aus Ansichtsmitte (wie v4)
uniform float u_zoom;
uniform vec3 u_palA, u_palB, u_palC, u_palD;
uniform int u_palCustom;
uniform vec3 u_custom[6];
uniform float u_cycle;
out vec4 fragColor;
vec3 palette(float t) {
    t = fract(t);
    if (u_palCustom == 1) {
        t *= 6.0; int s = int(t); float f = t - float(s);
        vec3 a = u_custom[0], b = u_custom[1];
        if (s == 1) { a = u_custom[1]; b = u_custom[2]; } else if (s == 2) { a = u_custom[2]; b = u_custom[3]; }
        else if (s == 3) { a = u_custom[3]; b = u_custom[4]; } else if (s == 4) { a = u_custom[4]; b = u_custom[5]; }
        else if (s >= 5) { a = u_custom[5]; b = u_custom[0]; }
        return mix(a, b, f);
    }
    return u_palA + u_palB * cos(6.28318 * (u_palC * t + u_palD));
}
void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_target) / min(u_target.x, u_target.y);
    float dist = 2.5 / u_zoom;
    vec3 ro = vec3(0.0, 0.0, -dist);
    vec3 rd = normalize(vec3(uv, 1.0));
    float ry = -u_rot.x * 3.0, rx = u_rot.y * 3.0;
    mat2 mY = mat2(cos(ry), -sin(ry), sin(ry), cos(ry));
    mat2 mX = mat2(cos(rx), -sin(rx), sin(rx), cos(rx));
    ro.yz *= mX; rd.yz *= mX; ro.xz *= mY; rd.xz *= mY;
    float t = 0.0; int i;
    for (i = 0; i < 80; i++) {
        vec3 p = ro + rd * t;
        vec3 w = p; float m = dot(w, w); float dz = 1.0;
        for (int j = 0; j < 6; j++) {
            dz = 8.0 * pow(m, 3.5) * dz + 1.0;
            float r = length(w);
            float b = 8.0 * acos(clamp(w.y / r, -1.0, 1.0));
            float a = 8.0 * atan(w.x, w.z);
            w = p + pow(r, 8.0) * vec3(sin(b) * sin(a), cos(b), sin(b) * cos(a));
            m = dot(w, w);
            if (m > 4.0) break;
        }
        float d = 0.25 * log(m) * sqrt(m) / dz;
        d = max(d, p.z);
        if (d < 0.002 || t > 12.0) break;
        t += d;
    }
    vec3 col = vec3(0.0, 0.0, 0.02);
    if (t < 12.0) {
        col = palette(float(i) * 0.1 + u_cycle);
        col *= 0.4 + 0.6 * clamp(1.0 - float(i) / 60.0, 0.0, 1.0);
    }
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.2);
    vec2 vv = gl_FragCoord.xy / u_target - 0.5;
    col *= 1.0 - dot(vv, vv) * 0.25;
    fragColor = vec4(pow(max(col, vec3(0.0)), vec3(0.92)), 1.0);
}`;

// ---------------------------------------------------------------- BUDDHABROT (Histogramm einfärben)
const BUDDHA_FS = `#version 300 es
${COMMON}
uniform usampler2D u_hist;
uniform vec2 u_size, u_target;
uniform float u_max;
uniform vec3 u_palA, u_palB, u_palC, u_palD;
uniform int u_palCustom;
uniform vec3 u_custom[6];
uniform float u_cycle;
out vec4 fragColor;
vec3 palette(float t) {
    t = fract(t);
    if (u_palCustom == 1) {
        t *= 6.0; int s = int(t); float f = t - float(s);
        vec3 a = u_custom[0], b = u_custom[1];
        if (s == 1) { a = u_custom[1]; b = u_custom[2]; } else if (s == 2) { a = u_custom[2]; b = u_custom[3]; }
        else if (s == 3) { a = u_custom[3]; b = u_custom[4]; } else if (s == 4) { a = u_custom[4]; b = u_custom[5]; }
        else if (s >= 5) { a = u_custom[5]; b = u_custom[0]; }
        return mix(a, b, f);
    }
    return u_palA + u_palB * cos(6.28318 * (u_palC * t + u_palD));
}
void main() {
    vec2 tc = gl_FragCoord.xy / u_target * u_size;
    ivec2 ic = clamp(ivec2(tc), ivec2(0), ivec2(u_size) - 1);
    float v = float(texelFetch(u_hist, ivec2(ic.x, int(u_size.y) - 1 - ic.y), 0).r);
    float nrm = v > 0.0 ? log(v + 1.0) / log(u_max + 1.0) : 0.0;
    vec3 col = palette(nrm * 1.6 + u_cycle) * pow(nrm, 0.8);
    fragColor = vec4(pow(max(col, vec3(0.0)), vec3(0.92)), 1.0);
}`;

// 32 horizontale Pixel -> ein uint mit Markierungsbits (für schnelles asynchrones Auslesen)
const FLAGPACK_FS = `#version 300 es
${COMMON}
uniform usampler2D u_src;
uniform int u_w;
out uint o_bits;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    uint bits = 0u;
    for (int k = 0; k < 32; k++) {
        int x = p.x * 32 + k;
        if (x >= u_w) break;
        float v = uintBitsToFloat(texelFetch(u_src, ivec2(x, p.y), 0).r);
        if (v < -1.5) bits |= (1u << uint(k));
    }
    o_bits = bits;
}`;

const COPY_FS = `#version 300 es
${COMMON}
uniform usampler2D u_src;
uniform sampler2D u_srcD;
layout(location = 0) out uint o_v;
layout(location = 1) out vec4 o_d;
void main() { o_v = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0).r; o_d = texelFetch(u_srcD, ivec2(gl_FragCoord.xy), 0); }`;

// Nachgerechnete Pixel als Punkte in den Puffer schreiben
const SCATTER_VS = `#version 300 es
in vec2 a_pos;
in uint a_val;
flat out uint v_val;
uniform vec2 u_size;
void main() {
    v_val = a_val;
    gl_Position = vec4((a_pos + 0.5) / u_size * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
}`;
const SCATTER_FS = `#version 300 es
precision highp float;
precision highp int;
flat in uint v_val;
out uint o_it;
void main() { o_it = v_val; }`;

root.FKShaders = { VS, computeFS, DISPLAY_FS, NL, PAL_GLSL, COMMON, BULB_FS, BUDDHA_FS, FLAGPACK_FS, SCATTER_VS, SCATTER_FS, COPY_FS };
})(typeof self !== 'undefined' ? self : globalThis);
