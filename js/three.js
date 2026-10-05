// three.js — 3D-Landschaft (6.0): die aktuelle Ansicht als Gebirge in Perspektive.
//
// Liest NUR die fertigen Iterationspuffer-Ebenen (js/app.js, Ebenen-Stapel) – die exakte Deep-Zoom-
// Rechnung bleibt unberührt. Aufbau:
//  * Höhe = log2(1 + geglättete Iteration), pro Ansicht auf [L0, L1] normiert (Quantile aus einer
//    kleinen Sonde, weich nachgeführt). Die Menge selbst ist ein See, der Rand bildet die Kämme.
//  * Pro Ebene eine Höhentextur (halbe Auflösung, RGBA16F: Höhe, Innen-Anteil, 6.1: Mengen-Anteil inkl.
//    Distanz-Saum) MIT Mipmaps: Geometrie
//    und Licht lesen sie passend zur Bildschirm-Größe des Gitters/Pixels -> keine Treppen, kein Flimmern.
//  * Geometrie: Gitter im Bildraum ("projected grid"): jeder Gitterpunkt = Strahl der Kamera, trifft
//    den Boden, wird um die Höhe angehoben (Vertex-Texture-Fetch, WebGL2). Gleichmäßige Dichte auf dem
//    Schirm, der Horizont kostet nichts extra; ferne Bereiche lesen die weiten Reserve-Ebenen.
//  * Licht: Sonne + weiche Schatten (8 Schritte durchs Höhenfeld), Himmelslicht, Dunst zum Horizont,
//    Himmel mit Sonnenhof; See spiegelt den Himmel. Farben = aktuelle Palette (gleicher GLSL-Code wie 2D).
//  * Bei Neigung 0 und Höhe 0 ist das Bild identisch zur 2D-Ansicht (Ebene senkrecht zur Blickachse =
//    exakt affine Abbildung) -> Ein-/Ausschalten als weicher Übergang.
// Lokale Koordinaten: Einheit = halbe Bildhöhe der 2D-Ansicht (1,5/zoom), Ursprung = Bildmitte (Fokus).
(function (root) {
'use strict';
const SH = root.FKShaders, HP = root.FKHP;
const SH_LUM = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const N3 = 6;                 // Ebenen im 3D-Pass (2 Sampler je Ebene: Iteration + Höhe)
const FOV = 50 * Math.PI / 180;

const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

const UNI = `
uniform vec3 u_palA, u_palB, u_palC, u_palD;
uniform int u_palCustom;
uniform vec3 u_custom[6];
uniform float u_cycle, u_density;
uniform int u_formula, u_maxIter, u_banded;
`;
// Ebenen: lt = (Texel pro lokaler Einheit, Texel-Versatz x/y, Einblendung), ls = (Puffergröße, Höhen-Basis,
// lokale Einheit pro Texel), lh = 2 × Größe der Höhentextur (Normierung der Texturkoordinate)
// 6.3: Ebenen als echte Schleifen (Obergrenze u_n3 ist ein Uniform -> der Compiler entrollt nicht). Bis 6.2 stand jede
// Ebene als eigene Kopie im Shader (6×, in colorAt sogar 6 × 6, dazu jede Kopie in jedem Aufruf eingebettet) – unter
// Windows übersetzt Chrome über Direct3D 11/FXC, das brauchte dafür zig Sekunden. Sampler-Arrays dürfen in GLSL ES 3.0
// nur konstant indiziert werden: Auswahl der Ebene per switch.
const SWITCH = (body) => `    switch (i) {\n${rep(N3, k => `        ${k < N3 - 1 ? `case ${k}` : 'default'}: ${body(k)} break;`)}\n    }`;
const LAYERS = (iter) => `
const float LAKE = 0.08;
${rep(N3, i => `uniform sampler2D u_h${i};`)}
${iter ? rep(N3, i => `uniform usampler2D u_i${i};`) : ''}
uniform int u_smooth;     // 6.1: Ufer/Menge aus der Distanzschätzung (0 = Verhalten 6.0)
uniform vec4 u_lt[${N3}];
uniform vec4 u_ls[${N3}];
uniform vec2 u_lh[${N3}];
uniform int u_n3;
uniform vec3 u_hn;        // L0, 1/(L1-L0), Höhenmaßstab (lokal)
uniform float u_cdf[9];   // Höhen-Entzerrung: log2(1+mu) an den Quantilen 0, 1/8 … 1 (h8: normiert)
uniform int u_h8;         // 1 = 8-bit-Ersatzformat (Höhe schon normiert)
uniform int u_alpine;     // 6.2 Alpin-Look: 0 aus, 1 Wald, 2 See, 3 Wiese im Tal
const float ALP_W = 0.1;  // Wasserspiegel des Talsees (relative Höhe)
vec3 hTex(int i, vec2 uv, float lod) {
    vec3 v;
${SWITCH(k => `v = textureLod(u_h${k}, uv, lod).rgb;`)}
    return v;
}
vec4 hLayer(int i, vec2 P, float foot) {
    vec4 lt = u_lt[i], ls = u_ls[i];
    vec2 tc = P * lt.x + lt.yz;
    if (tc.x < 0.0 || tc.y < 0.0 || tc.x > ls.x || tc.y > ls.y) return vec4(0.0);
    float e = min(min(tc.x, tc.y), min(ls.x - tc.x, ls.y - tc.y));
    float cov = clamp(e / 10.0, 0.0, 1.0) * lt.w;
    float lod = log2(max(foot / (2.0 * ls.w), 1.0));
    vec3 v = hTex(i, tc / u_lh[i], lod);
    return vec4(v.r + ls.z, v.g, v.b, cov);
}
float hSet = 0.0;   // 6.1: Mengen-Anteil inkl. Saum (B) aus der letzten heightAt2-Abfrage – ohne eigene Texturabfrage
// Höhe (lokal) und Innen-Anteil am Bodenpunkt P; foot = Größe des Bodenstücks (lokal) für die Mip-Stufe.
// shore = Innen-Anteil auf gröberer Stufe (< 0: wie inside): das Ufer fällt sanft zum See ab statt als Wand.
vec2 heightAt2(vec2 P, float foot, float shore) {
    float T = 1.0, h = 0.0, g = 0.0, b = 0.0;
    for (int i = 0; i < u_n3; i++) {
        if (T <= 0.01) break;
        vec4 r = hLayer(i, P, foot); h += T * r.w * r.x; g += T * r.w * r.y; b += T * r.w * r.z; T *= 1.0 - r.w;
    }
    hSet = T < 0.999 ? b / (1.0 - T) : 0.0;
    // Histogramm-Entzerrung: jede Achtel-Stufe der Höhe bekommt gleich viel Fläche -> Relief auch dort,
    // wo fast alles nahe am Rand liegt (dichte Tiefen); fehlende Daten = tiefste Stufe
    float r = h + T * u_cdf[0];
    float hn = 0.0;
    for (int k = 0; k < 8; k++) { float a = u_cdf[k], b = u_cdf[k + 1]; if (r >= a) hn = (float(k) + clamp((r - a) / max(b - a, 1e-4), 0.0, 1.0)) / 8.0; }
    float inside = T < 0.999 ? g / (1.0 - T) : 0.0;
    float z = pow(clamp(hn, 0.0, 1.0), 1.35);
    // die Menge ist ein See; der Rand (höchste Iteration) bildet die Kämme
    // Geometrie: großer See nur aus der groben Ufer-Maske (sanfte Hänge); kleine Inseln der Menge
    // (Minibrots) bleiben Plateaus auf Kammhöhe
    float sh = shore < 0.0 ? inside : shore;
    z = mix(z, LAKE, smoothstep(0.2, 0.8, sh));
    return vec2(z * u_hn.z, inside);
}
vec2 heightAt(vec2 P, float foot) { return heightAt2(P, foot, -1.0); }
float insideAt(vec2 P, float foot) {
    float T = 1.0, g = 0.0;
    for (int i = 0; i < u_n3; i++) {
        if (T <= 0.01) break;
        vec4 r = hLayer(i, P, foot); g += T * r.w * r.y; T *= 1.0 - r.w;
    }
    return T < 0.999 ? g / (1.0 - T) : 0.0;
}
`;

const CAM = `
uniform vec3 u_cam, u_fwd, u_rt, u_up;
uniform vec2 u_tan;       // tan(FOV/2)·Seitenverhältnis, tan(FOV/2)
uniform vec2 u_target;
`;

const POST = `
vec3 post(vec3 col) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.2);
    vec2 vv = gl_FragCoord.xy / u_target - 0.5;
    col *= 1.0 - dot(vv, vv) * 0.25;
    return pow(max(col, vec3(0.0)), vec3(0.92));
}`;

const TERRAIN_VS = `#version 300 es
${SH.COMMON}
layout(location = 0) in vec2 a_uv;
${CAM}
uniform vec2 u_yr;        // NDC-y unten/oben (oben = knapp unter dem Horizont)
uniform vec2 u_depth;
uniform float u_far, u_rows;
uniform vec3 u_sun;
uniform vec2 u_jit;
uniform int u_shN;        // 6.3: Schattenschritte (6) als Uniform – der Compiler entrollt die Schleife nicht
${LAYERS(false)}
// 6.5 Wolkenschatten: am Fraktal verankert (Versatz u_coff aus der BigInt-Kamera wie beim Alpin-Rauschen, zwei grobe
// Oktaven, beim Zoomen weich überblendet – schwimmen nicht), ziehen langsam mit dem Wind; pro Gitterpunkt gerechnet
// (weich wie die Geländeschatten, ~50× billiger als pro Pixel)
uniform int u_deko;
uniform float u_dk, u_ctime, u_nfr;
uniform vec2 u_coff[2];
float chash(vec2 i) { i = mod(i, 256.0); vec2 p = fract(i * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float cnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(chash(i), chash(i + vec2(1.0, 0.0)), f.x), mix(chash(i + vec2(0.0, 1.0)), chash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cloudShade(vec2 P) {
    float c = 0.0, w2 = 0.0;
    for (int j = 0; j < 2; j++) {
        float w = j == 0 ? sin(1.5708 * u_nfr) : cos(1.5708 * u_nfr); w *= w;
        vec2 q = u_coff[j] + P * exp2(u_nfr + float(j) - 1.0) + vec2(u_ctime * 0.03, u_ctime * 0.012);
        float n = cnoise(q) * 0.62 + cnoise(q * 2.0 + 17.0) * 0.38;
        c += w * (n - 0.5); w2 += w * w;
    }
    return smoothstep(0.56, 0.82, c / sqrt(max(w2, 1e-3)) * 2.4 + 0.5);
}
out vec2 v_P;
out float v_z, v_in, v_sh, v_shore;
out vec3 v_V, v_N;
void main() {
    float x = mix(-1.08, 1.08, a_uv.x), y = mix(u_yr.x, u_yr.y, a_uv.y);
    vec3 d = normalize(u_fwd + x * u_tan.x * u_rt + y * u_tan.y * u_up);
    vec2 P = u_cam.xy;
    float t = u_far;
    bool hit = d.z < -1e-4;
    if (hit) { t = -u_cam.z / d.z; P = u_cam.xy + d.xy * t; }
    if (!hit || length(P - u_cam.xy) > u_far) {
        float lh = length(d.xy);
        P = u_cam.xy + (lh > 1e-6 ? d.xy / lh : vec2(0.0, 1.0)) * u_far;
        t = length(vec3(P, 0.0) - u_cam);
    }
    float foot = t * 2.0 * u_tan.y * (u_yr.y - u_yr.x) / u_rows / max(0.3, sqrt(max(-d.z, 0.01)));
    // Geometrie aus gröberer Mip-Stufe (sanfte Berge; die feinen Details liefert das Licht pro Pixel)
    // Mindest-Glättung 3 % der Bildhöhe: der Fraktalrand ist in log(mu) dichtes Rauschen -> sonst Nadeln/Steilwände
    // Großform (geglättet, sanftes Ufer) + halbe Amplitude der Feinstruktur: Kämme statt Nadeln
    float gf = max(foot * 2.0, 0.04);
    // 6.3: Abfragen gebündelt – je eine Stelle im Code statt 7 (der Compiler bettet jede Aufrufstelle komplett ein).
    // Ufer-Maske an P (und mit 6.1-Normale an den Nachbarpunkten Px, Py im Abstand einer Gitterzelle)
    float e = max(foot, 0.002);
    vec2 QP[3];
    QP[0] = P; QP[1] = P + vec2(e, 0.0); QP[2] = P + vec2(0.0, e);
    int nq = u_smooth == 1 ? 3 : 1;
    float sq[3];
    for (int k = 0; k < nq; k++) sq[k] = insideAt(QP[k], 0.25);   // Absenken zum See gehört zur Hangneigung
    float shore = sq[0];
    // Höhen: 0 = Großform an P, 1 = Feinstruktur an P, 2/3 = Großform an Px/Py (nur 6.1-Normale)
    vec2 hq4[4];
    for (int k = 0; k < nq + 1; k++) {
        int j = max(k - 1, 0);
        hq4[k] = heightAt2(QP[j], k == 1 ? max(foot * 1.5, 0.008) : gf, sq[j]);
    }
    vec2 hc = hq4[0], hf = hq4[1];
    vec2 hz = vec2(0.55 * hc.x + 0.45 * hf.x, hf.y);
    // 6.2 Alpin + See: Talboden unter dem Wasserspiegel wird flache Wasserfläche (nicht in der Menge selbst)
    if (u_alpine == 2) hz.x = mix(hz.x, max(hz.x, ALP_W * u_hn.z), 1.0 - smoothstep(0.15, 0.45, shore));
    v_shore = shore;
    // 6.1: Flächennormale der gezeichneten Geometrie pro Gitterpunkt (gleiche Höhenfunktion, Nachbarpunkte im
    // Abstand einer Gitterzelle) -> über die Dreiecke interpoliert: Felsfarbe an Steilhängen ohne Facetten
    // (nur die Großform wie hc: halb so viele Höhenabfragen, die Feinneigung liefert das Licht pro Pixel)
    v_N = vec3(0.0, 0.0, 1.0);
    if (u_smooth == 1) v_N = vec3(hc.x - hq4[2].x, hc.x - hq4[3].x, e);
    // weiche Schatten pro Gitterpunkt: Strahl zur Sonne durchs (grob werdende) Höhenfeld
    float sh = 1.0;
    for (int i = 1; i <= u_shN; i++) {
        float ts = 0.024 * pow(1.95, float(i));
        float hq = heightAt(P + u_sun.xy * ts, max(max(foot * 2.0, 0.03), ts * 0.4)).x;
        sh = min(sh, 5.0 * (hz.x + u_sun.z * ts - hq) / ts);
    }
    v_sh = clamp(sh, 0.0, 1.0);
    if (u_deko > 0) v_sh *= 1.0 - 0.35 * u_dk * cloudShade(P);    // 6.5 Wolkenschatten (dezent)
    vec3 Q = vec3(P, hz.x);
    vec3 v = Q - u_cam;
    float zc = dot(v, u_fwd);
    gl_Position = vec4(dot(v, u_rt) / u_tan.x + u_jit.x * zc, dot(v, u_up) / u_tan.y + u_jit.y * zc, u_depth.x * zc + u_depth.y, zc);
    v_P = P; v_z = hz.x; v_in = hz.y; v_V = v;
}`;

const SKYCOL = `
uniform vec3 u_sun, u_haze, u_zenith;
vec3 skyColor(vec3 d) {
    vec3 c = mix(u_haze, u_zenith, smoothstep(-0.02, 0.55, d.z));
    float s = max(dot(d, u_sun), 0.0);
    c += vec3(1.0, 0.86, 0.65) * (pow(s, 24.0) * 0.25 + pow(s, 600.0) * 1.2);
    return c;
}`;

// 6.5 Deko: Wolken (Wertrauschen, 4 Oktaven, nur ALU – keine Textur, kein eigener Pass) auf einer Ebene über der
// Kamera, dazu Horizontleuchten in Sonnenrichtung und ein weicher Sonnenhof. u_deko = 0: Himmel exakt wie bis 6.4.1
// (?deko=0, Qualität „Akku“, aktive Auflösungs-Drosselung); u_dk = Stärke 0..1 (weiches Ein-/Ausblenden),
// u_ctime = Wolkenzug (läuft nur, solange ohnehin animiert gezeichnet wird).
const CLOUDS = `
uniform int u_deko;
uniform float u_dk, u_ctime;
float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Bedeckung 0..1 in Blickrichtung d (z = oben); oct = Zahl der Oktaven (Spiegelung im Wasser: 3)
float cloudCov(vec3 d, int oct, out float core) {
    vec2 p = d.xy / (d.z + 0.25) * 1.2 + vec2(u_ctime * 0.02, u_ctime * 0.007);
    float a = 0.5, n = 0.0;
    for (int k = 0; k < 4; k++) { if (k >= oct) break; n += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    n /= 1.0 - 2.0 * a;     // Summe der Amplituden
    core = smoothstep(0.6, 0.88, n);
    return smoothstep(0.46, 0.7, n) * smoothstep(0.0, 0.04, d.z);
}
vec3 skyDeko(vec3 d, int oct) {
    vec3 c = skyColor(d);
    if (u_deko == 0) return c;
    float s = max(dot(d, u_sun), 0.0);
    float az = max(dot(normalize(d.xy + 1e-5), normalize(u_sun.xy)), 0.0);
    // Horizontleuchten (warm, in Sonnenrichtung) + weiter Sonnenhof
    c += u_dk * (vec3(1.0, 0.74, 0.48) * pow(az, 4.0) * exp(-max(d.z, 0.0) * 9.0) * 0.16 + vec3(1.0, 0.9, 0.76) * pow(s, 6.0) * 0.1);
    if (d.z <= 0.0 || u_dk <= 0.01) return c;
    float core;
    float cov = cloudCov(d, oct, core);
    // Wolkenfarbe aus dem Dunst (passt zu jeder Palette), Kerne etwas dunkler, Ränder zur Sonne hin hell (Silberrand)
    vec3 cc = mix(u_haze, vec3(1.0, 0.98, 0.95), 0.6) * (1.0 - 0.28 * core) + vec3(1.0, 0.86, 0.66) * pow(s, 5.0) * (1.0 - core) * 0.35;
    return mix(c, cc, cov * 0.88 * u_dk);
}`;

// ALP = 0 Standard, 1 + Schnee (helle Menge), 2 + Alpin-Look: die Standardvariante enthält den neuen Code nicht
// (ungenutzte Zweige kosteten sonst ~40 % Bildzeit – der Compiler plant Register für den schlimmsten Fall)
const TERRAIN_FS_SRC = (alp, inc) => `#version 300 es
#define ALP ${alp}
#define INC ${inc ? 1 : 0}
${SH.COMMON}
${CAM}
${UNI}
uniform float u_fog, u_mix, u_time;
uniform int u_particles;
uniform int u_dbg;        // Messung: 1 = Wassermaske, 2 = Mengen-Anteil (tests/measure_smooth.py)
uniform vec2 u_jit;       // Subpixel-Versatz (NDC) der Mittelung im Stillstand
uniform vec3 u_setCol;    // 6.2 Farbe der Menge
uniform vec2 u_noff[4];   // 6.2 Welt-verankertes Rauschen: Versatz je Oktave (Fokus / Wellenlänge, mod 256)
uniform float u_nfr;      // Bruchteil von log2(lokale Einheit) – Oktaven-Überblendung beim Zoomen
uniform int u_nq;         // 6.3: Zahl der Höhenabfragen pro Pixel (3) als Uniform – der Compiler entrollt nicht
${SKYCOL}
${CLOUDS}
${LAYERS(true)}
// Rauschen, das an der Welt (dem Fraktal) haftet und beim Zoomen nicht schwimmt: 4 Oktaven, Wellenlänge der Oktave
// j = 2^-(u_nfr+j+3) Bildhälften; beim Tieferzoomen gleitet jede Oktave eine Stufe weiter (Gewicht sin², Summe
// konstant), zu feine Oktaven blenden aus. Das Rauschen selbst liegt in einer kachelbaren Textur (u_noise, 256
// Zellen pro Kachel, R/G = zwei unabhängige Gradientenrauschen, B = doppelt so fein) mit Mipmaps: ein Zugriff pro
// Oktave statt Rechnen im Shader (das kostete im Alpin-Look ~90 % Bildzeit), Mipmaps glätten in der Ferne.
uniform sampler2D u_noise;
// (full = false: nur x – für Schnee ohne Alpin-Look; y nur aus den groben Oktaven)
vec2 nDx, nDy;    // Bildschirm-Ableitungen von v_P (in main() außerhalb von Verzweigungen bestimmt) -> Mip-Stufe
vec3 wnoise(vec2 P, float foot, bool full) {
    vec3 acc = vec3(0.0); vec3 ws = vec3(0.0);
    for (int j = 0; j < 4; j++) {
        float sc = exp2(u_nfr + float(j) + 3.0);
        float t = float(j) + u_nfr;
        float w = sin(0.785398 * t); w *= w;
        w *= 1.0 - smoothstep(0.35, 0.9, foot * sc);
        if (w <= 0.02) continue;
        float k = sc * (1.0 / 256.0);
        vec3 q = textureGrad(u_noise, (u_noff[j] + P * sc) * (1.0 / 256.0), nDx * k, nDy * k).rgb;
        acc.x += w * q.r; ws.x += w;
        if (!full) continue;
        if (j < 3) { acc.y += w * q.g; ws.y += w; }
        float wf = w * smoothstep(1.0, 2.5, t); acc.z += wf * q.r; ws.z += wf;
        if (j == 3) { acc.z += 1.5 * w * q.b; ws.z += 1.5 * w; }
    }
    return vec3(ws.x > 0.0 ? acc.x / ws.x : 0.5, ws.y > 0.0 ? acc.y / ws.y : 0.5, ws.z > 0.0 ? acc.z / ws.z : 0.5);
}
in vec2 v_P;
in float v_z, v_in, v_sh, v_shore;
in vec3 v_V, v_N;
out vec4 fragColor;
${SH.PAL_GLSL}
// 4 Nachbartexel der Iterationsebene i (6.3: Auswahl per switch, siehe LAYERS); Dekodierung wie fetchV (2D)
vec4 iTex4(int i, ivec2 a, ivec2 b) {
    uvec4 r;
${SWITCH(k => `r = uvec4(texelFetch(u_i${k}, a, 0).r, texelFetch(u_i${k}, ivec2(b.x, a.y), 0).r, texelFetch(u_i${k}, ivec2(a.x, b.y), 0).r, texelFetch(u_i${k}, b, 0).r);`)}
    vec4 v = uintBitsToFloat(r);
    return mix(mix(v, vec4(-1.0), lessThan(v, vec4(-1.5))), -v - 4.0, lessThanEqual(v, vec4(-3.0)));
}
// Messhilfe (u_dbg 2, Verhalten 6.0): Anteil der Seefarbe im Ergebnis von colorAt – pro Ebene cLW, summiert cLakeW
float cLW = 0.0, cLakeW = 0.0;
// 6.4 Bunte Menge (Variante INC): Innenfarbe der Innen-Texel je Ebene (cInC, Gewicht cInW), in colorAt aufsummiert
vec3 cInC = vec3(0.0), inAcc = vec3(0.0);
float cInW = 0.0, inW = 0.0;
void inTexels(vec4 v, vec4 wb, vec3 lakeCol) {
    vec4 wi = wb * vec4(lessThan(v, vec4(0.0)));
    cInW = wi.x + wi.y + wi.z + wi.w;
    cInC = cInW > 0.0 ? wi.x * inCol(v.x, lakeCol) + wi.y * inCol(v.y, lakeCol) + wi.z * inCol(v.z, lakeCol) + wi.w * inCol(v.w, lakeCol) : vec3(0.0);
}
// Farbe einer Ebene: bilinear eingefärbt (wie 2D), Deckkraft = gefederter Rand × Einblendung
vec4 cLayer(int i, vec2 P, vec3 lakeCol) {
    vec4 lt = u_lt[i], ls = u_ls[i];
    vec2 tc = P * lt.x + lt.yz;
    if (tc.x < 0.0 || tc.y < 0.0 || tc.x > ls.x || tc.y > ls.y) return vec4(0.0);
    float e = min(min(tc.x, tc.y), min(ls.x - tc.x, ls.y - tc.y));
    float cov = clamp(e / 10.0, 0.0, 1.0) * lt.w;
    vec2 q = tc - 0.5;
    vec2 fl = floor(q), f = q - fl;
    ivec2 mx = ivec2(ls.xy) - 1;
    ivec2 i0 = clamp(ivec2(fl), ivec2(0), mx), i1 = clamp(ivec2(fl) + 1, ivec2(0), mx);
    vec4 v = iTex4(i, i0, i1);
    vec3 c00 = v.x < 0.0 ? lakeCol : exteriorColor(v.x), c10 = v.y < 0.0 ? lakeCol : exteriorColor(v.y);
    vec3 c01 = v.z < 0.0 ? lakeCol : exteriorColor(v.z), c11 = v.w < 0.0 ? lakeCol : exteriorColor(v.w);
    vec4 lw = vec4(lessThan(v, vec4(0.0)));
    cLW = mix(mix(lw.x, lw.y, f.x), mix(lw.z, lw.w, f.x), f.y);
#if INC
    inTexels(v, vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y), lakeCol);
#endif
    return vec4(mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y), cov);
}
// 6.1: Außenfarben nur untereinander interpoliert (kein Farbmischen mit der Seefarbe pro Texel -> keine Pixeltreppe);
// die Menge legt main() pro Bildschirmpixel aus dem B-Kanal der Höhentextur darüber. Alle 4 Texel innen: Seefarbe.
vec4 cLayerS(int i, vec2 P, vec3 lakeCol) {
    vec4 lt = u_lt[i], ls = u_ls[i];
    vec2 tc = P * lt.x + lt.yz;
    if (tc.x < 0.0 || tc.y < 0.0 || tc.x > ls.x || tc.y > ls.y) return vec4(0.0);
    float e0 = min(min(tc.x, tc.y), min(ls.x - tc.x, ls.y - tc.y));
    float cov = clamp(e0 / 10.0, 0.0, 1.0) * lt.w;
    vec2 q = tc - 0.5;
    vec2 fl = floor(q), f = q - fl;
    ivec2 mx = ivec2(ls.xy) - 1;
    ivec2 i0 = clamp(ivec2(fl), ivec2(0), mx), i1 = clamp(ivec2(fl) + 1, ivec2(0), mx);
    vec4 v = iTex4(i, i0, i1);
    vec4 wb = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    float wo = dot(wb, step(0.0, v));
    vec3 c = vec3(0.0);
    if (v.x >= 0.0) c += wb.x * exteriorColor(v.x);
    if (v.y >= 0.0) c += wb.y * exteriorColor(v.y);
    if (v.z >= 0.0) c += wb.z * exteriorColor(v.z);
    if (v.w >= 0.0) c += wb.w * exteriorColor(v.w);
    cLW = wo > 0.0 ? 0.0 : 1.0;
#if INC
    inTexels(v, wb, lakeCol);
#endif
    return vec4(wo > 0.0 ? c / wo : lakeCol, cov);
}
bool covers(int i, vec2 P) { vec4 lt = u_lt[i], ls = u_ls[i]; vec2 tc = P * lt.x + lt.yz; return tc.x >= 0.0 && tc.y >= 0.0 && tc.x <= ls.x && tc.y <= ls.y; }
// Farbe am Bodenpunkt: schärfste Ebene oben; zu feine Ebenen (Texel << Pixel, flimmern) treten zurück,
// wenn darunter eine gröbere die Stelle deckt (6.3: "darunter" = vor der letzten deckenden Ebene, statt 6×6-Kette)
vec3 colorAt(vec2 P, float foot, vec3 lakeCol, vec3 noData) {
    int last = -1;
    for (int i = 0; i < u_n3; i++) if (covers(i, P)) last = i;
    vec3 acc = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < u_n3; i++) {
        if (T <= 0.01) break;
        if (!covers(i, P)) continue;
        vec4 c = u_smooth == 1 ? cLayerS(i, P, lakeCol) : cLayer(i, P, lakeCol);
        if (i < last) c.a *= smoothstep(0.1, 0.3, u_ls[i].w / max(foot, 1e-9));
        acc += T * c.a * c.rgb; cLakeW += T * c.a * cLW;
#if INC
        inAcc += T * c.a * cInC; inW += T * c.a * cInW;
#endif
        T *= 1.0 - c.a;
    }
    return acc + T * noData;
}
${POST}
void main() {
    nDx = dFdx(v_P); nDy = dFdy(v_P);
    float foot = max(max(length(nDx), length(nDy)), 1e-6);
    float dl = max(foot * 1.5, 0.004);
    // Höhe an P und den Nachbarn (Lichtnormale) – 6.3: eine Aufrufstelle in einer Schleife (u_nq = 3)
    vec2 hq[3];
    float setB = 0.0;       // Mengen-Anteil: dieselbe Abfrage wie die Lichtnormale
    for (int k = 0; k < u_nq; k++) {
        hq[k] = heightAt(v_P + (k == 1 ? vec2(dl, 0.0) : (k == 2 ? vec2(0.0, dl) : vec2(0.0))), dl);
        if (k == 0) setB = hSet;
    }
    vec2 h0v = hq[0];
    float h0 = h0v.x, hx1 = hq[1].x, hy1 = hq[2].x;
    vec3 n = normalize(vec3(h0 - hx1, h0 - hy1, dl));
    // 6.1: Mengen-Anteil pro Pixel (x: inkl. Saum -> Farbe, y: nur Menge -> Wasser), leicht nachgeschärft
    vec2 setPx = vec2(0.0);
    if (u_smooth == 1) setPx = vec2(smoothstep(0.15, 0.85, setB), smoothstep(0.3, 0.7, h0v.y));
    // steile Flächen des Netzes (Ufer, Kammflanken): Felsfarbe statt senkrecht gestreckter Bodentextur
    vec3 gn = u_smooth == 1 ? normalize(v_N) : normalize(cross(dFdx(v_V), dFdy(v_V)));
    float steep = smoothstep(0.55, 0.2, abs(gn.z));
    vec3 lakeCol = mix(vec3(0.015, 0.025, 0.06), u_zenith, 0.5);
    // 6.2 Farbe der Menge: Schwarz = See wie bisher; dunkle Farben = getöntes Wasser; helle (Weiß) = matte Schnee-/
    // Gletscherfläche (keine Wellen, keine Himmelsspiegelung, bläuliche Schatten, sanfter Glanz)
    float setL = dot(u_setCol, vec3(0.299, 0.587, 0.114));
    float snowSet = smoothstep(0.35, 0.6, setL);
    if (setL > 0.02) lakeCol = mix(mix(u_setCol, u_zenith, 0.3), u_setCol * 0.86, snowSet);
    vec3 alb = colorAt(v_P, foot, lakeCol, u_haze);
#if INC
    // 6.4 Bunte Menge: See bzw. Gletscher in der Innenfarbe (Mittel der Innen-Texel an dieser Stelle)
    if (inW > 1e-3) lakeCol = mix(lakeCol, inAcc / inW, 0.85);
#endif
    // Alpin-Look: Höhenzonen statt Palette (relative Höhe im Bild -> funktioniert bei jedem Zoom)
    float snowAlp = 0.0, lakeAlp = 0.0, canopy = 1.0;
    vec3 nz = vec3(0.5);
#if ALP >= 2
    if (u_alpine > 0) nz = wnoise(v_P, foot, true);
    if (u_alpine > 0) {
        float zr = u_hn.z > 1e-4 ? h0 / u_hn.z : 0.5;
        float jn = nz.x - 0.5;
        float slope = 1.0 - n.z;
        float zV = 0.17 + 0.07 * jn, zM = 0.46 + 0.12 * jn, zS = 0.64 + 0.12 * jn;
        vec3 meadow = mix(vec3(0.24, 0.38, 0.11), vec3(0.44, 0.47, 0.19), smoothstep(0.3, 0.7, nz.y));
        vec3 rockA = mix(vec3(0.31, 0.29, 0.27), vec3(0.47, 0.45, 0.42), smoothstep(0.25, 0.75, nz.y)) * (0.9 + 0.1 * sin(zr * 40.0 + jn * 6.0));
        vec3 valley = meadow * 1.08;
        if (u_alpine == 1) {
            // Wald: dunkle Baumkronen mit Lichtpunkten (feines Rauschen), zur Baumgrenze hin aufgelockert
            float crown = smoothstep(0.45, 0.75, nz.z);
            vec3 forest = mix(vec3(0.03, 0.08, 0.035), vec3(0.10, 0.21, 0.07), crown);
            float dens = 1.0 - smoothstep(zV - 0.06, zV + 0.04, zr + 0.06 * (nz.y - 0.5));
            dens *= smoothstep(0.2, 0.5, nz.y + 0.3 * dens);
            valley = mix(meadow, forest, clamp(dens * 1.3, 0.0, 1.0));
            canopy = mix(1.0, 0.75 + 0.5 * crown, dens);
        }
        float steepR = max(steep, smoothstep(0.35, 0.65, slope));
        float tV = smoothstep(zV - 0.03, zV + 0.03, zr);
        float tR = smoothstep(zM - 0.05, zM + 0.05, zr);
        snowAlp = smoothstep(zS - 0.04, zS + 0.04, zr) * (1.0 - smoothstep(0.3, 0.55, slope)) * (1.0 - steep);
        vec3 zc = mix(valley, meadow, u_alpine == 1 ? 0.0 : tV);
        if (u_alpine == 1) zc = mix(valley, meadow, tV * smoothstep(zV, zV + 0.08, zr));
        zc = mix(zc, rockA, max(tR, steepR * tV));
        zc = mix(zc, vec3(0.92, 0.94, 0.99), snowAlp);
        if (u_alpine == 2) lakeAlp = (1.0 - smoothstep(ALP_W - 0.008, ALP_W + 0.002, zr)) * (1.0 - setPx.x) * (1.0 - smoothstep(0.3, 0.6, v_shore));
        alb = zc;
    }
#endif
    if (u_smooth == 1) alb = mix(alb, lakeCol, setPx.x);
    else if (u_alpine > 0) alb = mix(alb, lakeCol, smoothstep(0.45, 0.6, v_in));
    // Wasser: 6.0 pro Gitterpunkt (v_in interpoliert), 6.1 pro Bildschirmpixel aus der Distanzschätzung
    float water = (u_smooth == 1 ? setPx.y : smoothstep(0.45, 0.6, v_in)) * smoothstep(0.35, 0.6, v_shore);
    // an fast senkrechten Wänden (> ~80°) Fels statt gestreckter Ufermaske; die Seeschüssel selbst bleibt spiegelnd
    if (u_smooth == 1) water *= smoothstep(0.08, 0.22, abs(gn.z));
    float snowM = (u_smooth == 1 ? setPx.x : smoothstep(0.45, 0.6, v_in)) * snowSet;   // Schneefläche der Menge
    water *= 1.0 - snowSet;
    if (u_dbg == 1) { fragColor = vec4(vec3(water), 1.0); return; }
    if (u_dbg == 3) { fragColor = vec4(steep, setPx.x, smoothstep(0.35, 0.6, v_shore), 1.0); return; }   // Messhilfe: Fels/Menge/See
    if (u_dbg == 2) { float sm = u_smooth == 1 ? setPx.x : cLakeW; fragColor = vec4(vec3(sm), 1.0); return; }
    // Fels: einfarbig (Palette gedämpft) mit leichter Schichtung nach Höhe – keine gestreckte Bodentextur
    // (6.1: Schichtung gröber und schwächer – an den nun glatt schattierten Steilwänden flimmerte das feine Muster)
    vec3 rock = mix(vec3(0.32, 0.3, 0.3), palette(0.55 + u_cycle), 0.25) * (u_smooth == 1 ? 0.55 + 0.07 * sin(v_z / max(u_hn.z, 1e-4) * 16.0) : 0.55 + 0.12 * sin(v_z / max(u_hn.z, 1e-4) * 40.0));
    if (u_alpine == 0) alb = mix(alb, rock, steep * u_mix * (1.0 - snowM));
    float sh = v_sh;
    float dif = max(dot(n, u_sun), 0.0);
    vec3 V = normalize(v_V);
    vec3 lit = alb * (0.30 + 0.95 * dif * mix(0.35, 1.0, sh)) + alb * 0.14 * (0.5 + 0.5 * n.z);
    lit *= canopy;
    // Schnee (Menge und Gipfel): matt, Schatten bläulich (Himmelslicht), sanfter Glanz statt Spiegelung,
    // leichte Struktur aus dem Welt-Rauschen
#if ALP
    float snowAll = max(snowM, snowAlp * (1.0 - setPx.x));
    if (snowAll > 0.0) {
        if (u_alpine == 0) nz.x = wnoise(v_P, foot, false).x;
        // Gletscher (Menge) liegt flach auf Seehöhe: Normale beruhigen (sonst zeigen ferne Flächen Gitterfacetten)
        vec3 ns = normalize(mix(n, vec3(0.0, 0.0, 1.0), 0.6 * snowM));
        float difS = max(dot(ns, u_sun), 0.0), shS = mix(0.55, 1.0, sh);
        vec3 salb = alb * (0.95 + 0.08 * (nz.x - 0.5));
        vec3 sl = salb * (vec3(0.60, 0.645, 0.72) * (0.7 + 0.3 * ns.z) + vec3(1.0, 0.97, 0.92) * 0.55 * difS * mix(0.35, 1.0, shS));
        sl += vec3(1.0, 0.97, 0.92) * pow(max(dot(reflect(V, ns), u_sun), 0.0), 18.0) * 0.1 * shS;
        lit = mix(lit, sl, snowAll);
    }
#endif
    // See: Himmel spiegeln (Fresnel) + Sonnenglanz, leichte Wellen
    vec3 wn = normalize(vec3(0.012 * sin(v_P.x * 90.0 + u_time * 1.3) , 0.012 * cos(v_P.y * 80.0 + u_time), 1.0));
    vec3 R = reflect(V, wn);
    float fr = 0.12 + 0.88 * pow(1.0 - max(dot(-V, wn), 0.0), 4.0);
    vec3 skyR = skyColor(R);
    // 6.5: Wolken spiegeln sich (nur auf Wasser gerechnet). Wolken aus der glatten Spiegelrichtung – mit den Wellen-
    // Normalen ergäbe das Rauschen ein regelmäßiges Punktmuster (Moiré); die Wellen bleiben im Himmelsverlauf
    vec3 R0 = reflect(V, vec3(0.0, 0.0, 1.0)), cloudR = vec3(0.0);
    if (u_deko > 0 && water > 0.01) cloudR = skyDeko(R0, 3) - skyColor(R0);
    vec3 wcol = mix(lakeCol, skyR, fr) + cloudR * (0.45 + 0.55 * fr) + vec3(1.0, 0.9, 0.7) * pow(max(dot(R, u_sun), 0.0), 120.0) * sh * 0.8;
    lit = mix(lit, wcol, water);
#if ALP >= 2
    if (lakeAlp > 0.0) {      // Talsee (Alpin): Wasser-Shader, etwas grünlich-tief
        // Wellen nur im Nahbereich (in der Ferne würden sie zum Moiré), Spiegelung des klaren Himmels
        float wa = 0.012 * (1.0 - smoothstep(0.0015, 0.006, foot));
        vec3 wn2 = normalize(vec3(wa * sin(v_P.x * 90.0 + u_time * 1.3), wa * cos(v_P.y * 80.0 + u_time), 1.0));
        vec3 R2 = reflect(V, wn2);
        float fr2 = 0.12 + 0.88 * pow(1.0 - max(dot(-V, wn2), 0.0), 4.0);
        vec3 lc = mix(vec3(0.02, 0.07, 0.08), u_zenith, 0.35);
        if (u_deko > 0 && cloudR == vec3(0.0)) cloudR = skyDeko(R0, 3) - skyColor(R0);
        lit = mix(lit, mix(lc, skyColor(R2), fr2) + cloudR * (0.45 + 0.55 * fr2) + vec3(1.0, 0.95, 0.85) * pow(max(dot(R2, u_sun), 0.0), 120.0) * sh * 0.7, lakeAlp);
    }
#endif
    vec3 col = mix(alb, lit, u_mix);
    if (u_deko > 0) {
        // 6.5 Luftperspektive: mit der Entfernung blasser und kühler (vor dem Dunst), leichter Talnebel in Senken
        float dist = length(v_V), k = u_dk * u_mix;
        col = mix(col, mix(u_haze, u_zenith, 0.3) * 0.95 + col * 0.2, (1.0 - exp(-dist / 9.0)) * 0.32 * k);
        float zr0 = u_hn.z > 1e-4 ? clamp(h0 / u_hn.z, 0.0, 1.0) : 0.5;
        col = mix(col, u_haze, (1.0 - smoothstep(0.02, 0.3, zr0)) * smoothstep(0.8, 4.0, dist) * (1.0 - water) * 0.3 * k);
    }
    float fog = 1.0 - exp(-pow(length(v_V) / u_fog, 2.0));
    vec3 fogC = skyColor(V);
    if (u_deko > 0) {   // 6.5: Dunst zur Sonne hin warm, auf der Gegenseite kühler – keine flache Wand mehr
        float az = dot(normalize(V.xy + 1e-5), normalize(u_sun.xy));
        fogC *= 1.0 + u_dk * (vec3(0.16, 0.06, -0.06) * max(az, 0.0) + vec3(-0.05, -0.01, 0.05) * max(-az, 0.0));
    }
    col = mix(col, fogC, fog * u_mix);
    fragColor = vec4(post(col), 1.0);
}`;

const TERRAIN_FS = TERRAIN_FS_SRC(0), TERRAIN_FS_S = TERRAIN_FS_SRC(1), TERRAIN_FS_X = TERRAIN_FS_SRC(2);
const TERRAIN_FS_B = TERRAIN_FS_SRC(0, 1), TERRAIN_FS_SB = TERRAIN_FS_SRC(1, 1), TERRAIN_FS_XB = TERRAIN_FS_SRC(2, 1);

// Rauschtextur (einmalig, 512×512 = 2 Texel pro Zelle, Periode 256 Zellen): Gradientenrauschen mit Hash mod 256
const NOISE_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
vec2 grad2(vec2 c, uint seed) {
    uvec2 q = uvec2(mod(c, 256.0));
    uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (seed * 2654435761u);
    h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
    return vec2(float(h & 0xffffu), float(h >> 16)) * (2.0 / 65535.0) - 1.0;
}
float gnoise(vec2 p, uint seed) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(grad2(i, seed), f), b = dot(grad2(i + vec2(1.0, 0.0), seed), f - vec2(1.0, 0.0));
    float c = dot(grad2(i + vec2(0.0, 1.0), seed), f - vec2(0.0, 1.0)), d = dot(grad2(i + vec2(1.0, 1.0), seed), f - vec2(1.0, 1.0));
    return clamp(0.5 + 0.75 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}
void main() {
    vec2 Q = gl_FragCoord.xy * 0.5;
    o = vec4(gnoise(Q, 1u), gnoise(Q, 2u), gnoise(Q * 2.0, 3u), 1.0);
}`;

const SKY_FS = `#version 300 es
${SH.COMMON}
${CAM}
${SKYCOL}
${CLOUDS}
${POST}
out vec4 fragColor;
uniform vec2 u_jit;
void main() {
    vec2 ndc = gl_FragCoord.xy / u_target * 2.0 - 1.0 - u_jit;
    vec3 d = normalize(u_fwd + ndc.x * u_tan.x * u_rt + ndc.y * u_tan.y * u_up);
    fragColor = vec4(post(skyDeko(d, 4)), 1.0);
}`;

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src, u_src2;
uniform vec2 u_target;
uniform float u_alpha, u_mix2;    // u_mix2 > 0: Überblendung vom Bewegungsbild (u_src2) zum gemittelten Bild
out vec4 fragColor;
void main() {
    vec2 uv = gl_FragCoord.xy / u_target;
    vec3 c = texture(u_src, uv).rgb;
    if (u_mix2 > 0.0) c = mix(c, texture(u_src2, uv).rgb, u_mix2);
    fragColor = vec4(c, u_alpha);
}`;

// Höhentextur einer Ebene (halbe Auflösung, 2×2 gemittelt): R = log2(1+mu) - Basis (innen: log2(maxIter)),
// G = Innen-Anteil. Newton: Höhe aus der Schrittzahl innerhalb des Beckens.
// (6.1 geprüft und verworfen: Höhe am Rand per Distanzschätzung auf die Innenhöhe rampen – macht jedes Filament
// zur senkrechten Wand; G aus der DE inkl. Saum – macht dichte Zonen in der Ferne zu Seen. Die Distanzschätzung
// wirkt in 3D deshalb pro Bildschirmpixel auf Farbe und Wassermaske, die Geometrie bleibt wie 6.0.)
const HBUILD_FS = `#version 300 es
${SH.COMMON}
${UNI}
uniform usampler2D u_src;
uniform sampler2D u_srcD;     // 6.1: Distanzschätzung -> B = Mengen-Anteil inkl. Saum (Saum 0,25–1,25 Pixel wie 2D)
uniform vec2 u_srcSize;
uniform float u_base, u_inH;
uniform int u_h8;
uniform vec2 u_L;
out vec4 o;
${SH.PAL_GLSL}
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy) * 2;
    ivec2 mx = ivec2(u_srcSize) - 1;
    float h = 0.0, g = 0.0, b = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        ivec2 c = min(p + ivec2(i, j), mx);
        float v = fetchV(u_src, c);
        if (v < 0.0) { h += u_inH; g += 1.0; b += 1.0; }
        else { h += log2(1.0 + (u_formula == 5 ? mod(v, 1000.0) : v)); b += 1.0 - smoothstep(0.25, 1.25, fetchDE(u_srcD, c, v)); }
    }
    h *= 0.25; g *= 0.25; b *= 0.25;
    o = u_h8 == 1 ? vec4(clamp((h - u_L.x) * u_L.y, 0.0, 1.0), g, b, 1.0) : vec4(h - u_base, g, b, 1.0);
}`;

// Sonde: PW×PH Stichproben (Iterationswert der schärfsten Ebene) in einem Fenster ±u_win um den Fokus.
// 6.2: die unteren 8 Bit tragen die Distanz zur Menge (Flug zum Mengenrand): 0 = keine Angabe, 1 = innen,
// 2..254 = log2(Abstand in lokalen Einheiten = Bildhälften) in 1/16-Stufen ab 2^-12, 255 = weiter als der
// Kodierbereich der Ebene (> 245 Pufferpixel). Die Höhe verliert damit
// 8 Mantissenbits (relativ 3e-5) – für Höhenstatistik und Flugwertung ohne Bedeutung.
const PROBE_FS = `#version 300 es
${SH.COMMON}
${rep(N3, i => `uniform usampler2D u_i${i};`)}
${rep(N3, i => `uniform sampler2D u_d${i};`)}
uniform vec4 u_lt[${N3}];
uniform vec4 u_ls[${N3}];
uniform int u_n3;
uniform vec2 u_psize;
uniform float u_win;
out uint o;
uint probe(int i, vec2 P, out bool ok) {
    vec4 lt = u_lt[i], ls = u_ls[i];
    vec2 tc = P * lt.x + lt.yz;
    ok = tc.x >= 0.0 && tc.y >= 0.0 && tc.x < ls.x && tc.y < ls.y;
    if (!ok) return 0u;
    ivec2 c = ivec2(tc);
    uint r; float d;
${SWITCH(k => `r = texelFetch(u_i${k}, c, 0).r; d = texelFetch(u_d${k}, c, 0).r;`)}
    float v = uintBitsToFloat(r);
    uint code = 0u;
    if (v < 0.0 && v > -3.0) code = 1u;
    else {
        float e = d * 255.0;
        if (e >= 254.5) code = 255u;          // Distanz über dem Kodierbereich (> 245 Pufferpixel): weit weg
        else if (e >= 0.5) code = uint(clamp((log2(exp2(e * 0.0625 - 8.0) * ls.w) + 12.0) * 16.0 + 2.0, 2.0, 254.0));
    }
    return (r & 0xFFFFFF00u) | code;
}
void main() {
    vec2 P = (gl_FragCoord.xy / u_psize * 2.0 - 1.0) * u_win;
    bool ok = false;
    uint r = floatBitsToUint(-1e30);
    for (int i = 0; i < u_n3; i++) { uint v = probe(i, P, ok); if (ok) { r = v; break; } }
    o = r;
}`;

function create(R) {
    const gl = R.gl;
    const T = { N3, FOV };
    const floatRT = !!gl.getExtension('EXT_color_buffer_float');
    T.h8 = !floatRT;                       // ohne Float-Renderziel: 8-bit-Höhen (normiert beim Bauen)
    T.scale = 1;                           // Renderauflösung relativ zum Canvas (dynamisch)
    T.mobile = Math.min(screen.width, screen.height) < 700;   // Handy: gröberes Gitter (Details liefert das Licht pro Pixel)
    let fbo = null, grid = null;

    // ---------------- Höhentexturen pro Ebene
    function buildHeight(l, look, L) {
        const w = Math.max(1, Math.ceil(l.buf.w / 2)), h = Math.max(1, Math.ceil(l.buf.h / 2));
        const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
        if (!l.h3d || l.h3d.w !== w || l.h3d.h !== h) {
            if (l.h3d) free(l);
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texStorage2D(gl.TEXTURE_2D, levels, T.h8 ? gl.RGBA8 : gl.RGBA16F, w, h);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            l.h3d = { tex, fb, w, h };
        }
        const pr = R.program('t3hb', HBUILD_FS), U = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, l.h3d.fb);
        gl.viewport(0, 0, w, h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, l.buf.tex); gl.uniform1i(U.u_src, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, l.buf.de || R.dummyD()); gl.uniform1i(U.u_srcD, 1);
        gl.uniform2f(U.u_srcSize, l.buf.w, l.buf.h);
        const base = L ? L[0] : 0;
        gl.uniform1f(U.u_base, base);
        gl.uniform1f(U.u_inH, Math.log2(1 + (l.formula === 5 ? 80 : l.maxIter)));
        gl.uniform1i(U.u_h8, T.h8 ? 1 : 0);
        gl.uniform2f(U.u_L, L ? L[0] : 0, L ? 1 / Math.max(1e-3, L[1] - L[0]) : 1);
        gl.uniform1i(U.u_formula, look.formula);
        gl.uniform1i(U.u_maxIter, look.maxIter);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, l.h3d.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        l.h3d.base = base;
        l.h3d.L = L ? L.slice() : null;
    }
    function free(l) { if (l.h3d) { gl.deleteTexture(l.h3d.tex); gl.deleteFramebuffer(l.h3d.fb); l.h3d = null; } }
    R.onReleaseFrame = free;
    T.free = free;

    // ---------------- Kamera (lokale Einheiten)
    // v: { tilt, heading, height, w, h } -> Kameraparameter. Blickneigung = 1,2 × Positionswinkel: bei
    // starker Neigung wird der Horizont sichtbar, der Fokus rutscht leicht unter die Bildmitte.
    T.camera = function (v, W, H) {
        const tanH = Math.tan(FOV / 2), aspect = W / H, D = 1 / tanH;
        const th = v.tilt, ph = Math.min(1.3, v.tilt * 1.2), ps = v.heading;
        const f = [Math.sin(ps), Math.cos(ps)], r = [Math.cos(ps), -Math.sin(ps)];
        const cam = [-f[0] * D * Math.sin(th), -f[1] * D * Math.sin(th), D * Math.cos(th)];
        const fwd = [f[0] * Math.sin(ph), f[1] * Math.sin(ph), -Math.cos(ph)];
        let rt = [r[0], r[1], 0];
        let up = [rt[1] * fwd[2] - rt[2] * fwd[1], rt[2] * fwd[0] - rt[0] * fwd[2], rt[0] * fwd[1] - rt[1] * fwd[0]];
        if (v.roll) {     // 6.2: Schräglage im Flug (um die Blickachse)
            const cr = Math.cos(v.roll), sr = Math.sin(v.roll);
            const rt2 = rt.map((x, k) => x * cr + up[k] * sr), up2 = up.map((x, k) => x * cr - rt[k] * sr);
            rt = rt2; up = up2;
        }
        const hor = Math.sin(ph) > 1e-4 ? Math.cos(ph) / (tanH * Math.sin(ph)) : 10;
        // Gitter bis knapp unter den Horizont; mit Schräglage liegt er auf einer Seite höher
        const yTop = v.roll ? (hor + 1.08 * aspect * Math.abs(Math.sin(v.roll))) / Math.cos(v.roll) : hor;
        return { cam, fwd, rt, up, tan: [tanH * aspect, tanH], yTop: Math.min(1.03, yTop - 0.002), f, r, D, aspect };
    };
    // Bildschirmpunkt (NDC) -> Bodenpunkt (lokal), null über dem Horizont
    T.groundAt = function (c, x, y) {
        const d = [c.fwd[0] + x * c.tan[0] * c.rt[0] + y * c.tan[1] * c.up[0], c.fwd[1] + x * c.tan[0] * c.rt[1] + y * c.tan[1] * c.up[1], c.fwd[2] + x * c.tan[0] * c.rt[2] + y * c.tan[1] * c.up[2]];
        if (d[2] > -1e-4) return null;
        const t = -c.cam[2] / d[2];
        return [c.cam[0] + d[0] * t, c.cam[1] + d[1] * t, t * Math.hypot(d[0], d[1], d[2])];
    };

    // ---------------- Ebenen-Uniforms (lokal)
    const ltB = new Float32Array(4 * N3), lsB = new Float32Array(4 * N3), lhB = new Float32Array(2 * N3);
    function layerUniforms(list, focus, u) {
        for (let i = 0; i < N3; i++) {
            const l = list[i];
            if (!l) continue;
            const a = u / l.scale;
            ltB[4 * i] = a;
            ltB[4 * i + 1] = HP.toNumber(focus.cx - l.view.cx) / l.scale + l.buf.w / 2;
            ltB[4 * i + 2] = HP.toNumber(focus.cy - l.view.cy) / l.scale + l.buf.h / 2;
            ltB[4 * i + 3] = l.alpha === undefined ? 1 : l.alpha;
            lsB[4 * i] = l.buf.w; lsB[4 * i + 1] = l.buf.h;
            lsB[4 * i + 2] = l.h3d ? l.h3d.base : 0;
            lsB[4 * i + 3] = l.scale / u;
            lhB[2 * i] = l.h3d ? 2 * l.h3d.w : l.buf.w; lhB[2 * i + 1] = l.h3d ? 2 * l.h3d.h : l.buf.h;
        }
    }
    function bindLayers(U, list, withIter, unit0) {
        let unit = unit0;
        for (let i = 0; i < N3; i++) {
            const l = list[i];
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, l && l.h3d ? l.h3d.tex : dummyF());
            gl.uniform1i(U['u_h' + i], unit++);
            if (withIter) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, l ? l.buf.tex : R.dummyU());
                gl.uniform1i(U['u_i' + i], unit++);
            }
        }

        gl.uniform4fv(U.u_lt, ltB); gl.uniform4fv(U.u_ls, lsB);
        if (U.u_lh) gl.uniform2fv(U.u_lh, lhB);
        gl.uniform1i(U.u_n3, Math.min(N3, list.length));
    }
    let _df = null;
    function dummyF() {
        if (_df) return _df;
        _df = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, _df);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        return _df;
    }
    function camUniforms(U, c, tw, th) {
        gl.uniform3fv(U.u_cam, c.cam); gl.uniform3fv(U.u_fwd, c.fwd); gl.uniform3fv(U.u_rt, c.rt); gl.uniform3fv(U.u_up, c.up);
        gl.uniform2fv(U.u_tan, c.tan);
        gl.uniform2f(U.u_target, tw, th);
    }

    // ---------------- Gitter (Bildraum)
    function makeGrid(cols, rows) {
        if (grid && grid.cols === cols && grid.rows === rows) return grid;
        if (grid) { gl.deleteBuffer(grid.vb); gl.deleteBuffer(grid.ib); gl.deleteVertexArray(grid.vao); }
        const uv = new Float32Array((cols + 1) * (rows + 1) * 2);
        let k = 0;
        for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { uv[k++] = i / cols; uv[k++] = j / rows; }
        const idx = new Uint16Array(cols * rows * 6);
        k = 0;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
            idx[k++] = a; idx[k++] = b; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = c;
        }
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        grid = { cols, rows, vao, vb, ib, n: idx.length };
        return grid;
    }
    // 6.3: Gelände-Variante zum Look; nur sie wird übersetzt. Ist eine neu gewählte Variante noch nicht fertig
    // (Look-Wechsel in 3D), zeichnet die bisherige weiter, bis der Treiber fertig ist – ohne zu blockieren.
    // 6.4: Bunte Menge = eigene Variante (Suffix B) – nur dann wird der Zusatzcode übersetzt
    const TERR = { t3terr: TERRAIN_FS, t3terrS: TERRAIN_FS_S, t3terrX: TERRAIN_FS_X, t3terrB: TERRAIN_FS_B, t3terrSB: TERRAIN_FS_SB, t3terrXB: TERRAIN_FS_XB };
    const terrainKey = (look) => (look && look.alpine ? 't3terrX' : (look && look.setCol && SH_LUM(look.setCol) > 0.34 ? 't3terrS' : 't3terr')) + (look && look.inner ? 'B' : '');
    function needs(look) {
        const k = terrainKey(look);
        const a = [['t3hb', HBUILD_FS], ['t3sky', SKY_FS], [k, TERR[k], TERRAIN_VS], ['t3blit', BLIT_FS], ['t3probe', PROBE_FS]];
        if (k !== 't3terr' && k !== 't3terrB') a.splice(2, 0, ['t3noise', NOISE_FS]);    // Schnee/Alpin: Rauschtextur
        return a;
    }
    let lastTerr = null;
    T.waiting = false;                     // true: Bild mit der vorigen Variante, die neue wird noch übersetzt
    function terrainProgram(look) {
        const k = terrainKey(look);
        T.waiting = false;
        const plain = k === 't3terr' || k === 't3terrB';
        if (k === lastTerr || !lastTerr || (R.programReady(k, TERR[k], TERRAIN_VS) && (plain || noiseTex) && (warmDone[k] || R.noWarm))) {
            lastTerr = T.variant = k;
            return R.program(k, TERR[k], TERRAIN_VS);
        }
        // fertig übersetzt, aber noch nicht angewärmt: in diesem Bild anwärmen (vor dem Binden des Ziels), im nächsten nehmen
        if (R.hasProgram(k) && (plain || noiseTex)) warmOne(k, TERR[k], TERRAIN_VS);
        T.waiting = true;
        return R.program(lastTerr, TERR[lastTerr], TERRAIN_VS);
    }
    // nicht blockierend: true, wenn alle Programme für ein 3D-Bild in diesem Look fertig sind (T.prep = Fortschritt).
    // Ohne KHR_parallel_shader_compile blockiert jede Statusabfrage -> dann nur ein Programm pro Aufruf (= pro Bild).
    T.ready = function (look) {
        const a = needs(look);
        let done = 0;
        for (const n of a) {
            if (R.programReady(n[0], n[1], n[2])) done++;
            else if (!R.parallelCompile) break;
        }
        T.prep = { done, total: a.length };
        return done === a.length;
    };
    // Anwärmen: Ein fertig gelinktes Programm ist beim ersten Zeichnen noch nicht ganz fertig – der Treiber baut dann
    // die GPU-Pipeline (Mac/Metal: ~30–50 ms je Programm, alle im ersten 3D-Bild zusammen ~200 ms Standbild). Darum
    // vorher je Bild EIN Programm einmal unsichtbar in ein winziges Ziel mit denselben Formaten/Zuständen zeichnen.
    // (Die Übergabe auf den Canvas übersetzt Metal im ersten 3D-Bild als eigene Variante – einmalig bei leerem Shadercache.)
    let warmT = null, warmDone = {};
    function warmTarget() {
        if (warmT) return warmT;
        const col = makeTarget(4, 4, true), nd = makeTarget(4, 4, false), h = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, h);
        gl.texStorage2D(gl.TEXTURE_2D, 1, T.h8 ? gl.RGBA8 : gl.RGBA16F, 1, 1);
        const hfb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, hfb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, h, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        warmT = { col, nd, h, hfb };
        return warmT;
    }
    function warmFree() {
        if (!warmT) return;
        const c = warmT.col;
        gl.deleteFramebuffer(c.fb); gl.deleteTexture(c.tex); gl.deleteRenderbuffer(c.rb);
        gl.deleteFramebuffer(warmT.nd.fb); gl.deleteTexture(warmT.nd.tex);
        gl.deleteFramebuffer(warmT.hfb); gl.deleteTexture(warmT.h);
        warmT = null;
    }
    function warmOne(key, src, vs) {
        const w = warmTarget(), pr = R.program(key, src, vs), U = pr.loc;
        gl.useProgram(pr.p);
        if (key === 't3hb') {
            gl.bindFramebuffer(gl.FRAMEBUFFER, w.hfb); gl.viewport(0, 0, 1, 1);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.dummyU()); gl.uniform1i(U.u_src, 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.dummyD()); gl.uniform1i(U.u_srcD, 1);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        } else if (key === 't3probe') {
            if (!probeBuf) probeBuf = R.acquireBuffer(PW, PH, true);
            gl.bindFramebuffer(gl.FRAMEBUFFER, probeBuf.fbo); gl.viewport(0, 0, 1, 1);
            for (let i = 0; i < N3; i++) {
                gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, R.dummyU()); gl.uniform1i(U['u_i' + i], i);
                gl.activeTexture(gl.TEXTURE0 + N3 + i); gl.bindTexture(gl.TEXTURE_2D, R.dummyD()); gl.uniform1i(U['u_d' + i], N3 + i);
            }
            gl.uniform1i(U.u_n3, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        } else if (key === 't3noise') {
            getNoise();
        } else if (key === 't3blit') {      // Mittelung im Stillstand (Ziel ohne Tiefe, konstantes Gewicht)
            gl.bindFramebuffer(gl.FRAMEBUFFER, w.nd.fb); gl.viewport(0, 0, 1, 1);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dummyF()); gl.uniform1i(U.u_src, 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dummyF()); gl.uniform1i(U.u_src2, 1);
            gl.enable(gl.BLEND); gl.blendColor(0, 0, 0, 0.5); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.disable(gl.BLEND);
        } else {                            // Himmel (ohne Tiefentest) und Gelände (Gitter, Tiefentest)
            gl.bindFramebuffer(gl.FRAMEBUFFER, w.col.fb); gl.viewport(0, 0, 1, 1);
            if (key === 't3sky') { gl.disable(gl.DEPTH_TEST); gl.drawArrays(gl.TRIANGLES, 0, 3); }
            else {
                bindLayers(U, [], true, 0);
                if (U.u_noise) { gl.activeTexture(gl.TEXTURE0 + 2 * N3); gl.bindTexture(gl.TEXTURE_2D, noiseTex || dummyF()); gl.uniform1i(U.u_noise, 2 * N3); }
                gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
                const g = makeGrid(48, 64);
                gl.bindVertexArray(g.vao);
                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
                gl.bindVertexArray(R.vao);
                gl.disable(gl.DEPTH_TEST);
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        warmDone[key] = true;
    }
    // nicht blockierend, höchstens ein Programm pro Aufruf (= pro Bild); true, wenn alles für den Look angewärmt ist
    T.warm = function (look) {
        if (R.noWarm) return true;
        for (const n of needs(look)) if (!warmDone[n[0]]) { warmOne(n[0], n[1], n[2]); return false; }
        warmFree();
        return true;
    };
    // beim Antippen des 3D-Knopfs: nur die Programme dieses Looks starten (übersetzt parallel, wartet nie)
    T.prewarm = function (look) { if (R.parallelCompile) for (const n of needs(look)) R.prewarm(n[0], n[1], n[2]); };

    // ---------------- Offscreen-Ziele (Farbe + Tiefe): fbo = Bewegung (skaliert), fboS = Stillstand (volle
    // Auflösung, Subpixel-Versatz), acc = gemitteltes Bild (6.1)
    let fboS = null, acc = null;
    function target(w, h) {
        if (fbo && fbo.w === w && fbo.h === h) return fbo;
        if (fbo) { gl.deleteFramebuffer(fbo.fb); gl.deleteTexture(fbo.tex); gl.deleteRenderbuffer(fbo.rb); }
        fbo = makeTarget(w, h, true);
        return fbo;
    }
    function targetS(w, h) {
        if (fboS && fboS.w === w && fboS.h === h) return fboS;
        if (fboS) { gl.deleteFramebuffer(fboS.fb); gl.deleteTexture(fboS.tex); gl.deleteRenderbuffer(fboS.rb); }
        fboS = makeTarget(w, h, true);
        return fboS;
    }
    function accTarget(w, h) {
        if (acc && acc.w === w && acc.h === h) return acc;
        if (acc) { gl.deleteFramebuffer(acc.fb); gl.deleteTexture(acc.tex); }
        acc = makeTarget(w, h, false);
        return acc;
    }
    // Speicher der Stillstands-Ziele freigeben (beim Verlassen von 3D)
    T.freeStill = function () {
        if (fboS) { gl.deleteFramebuffer(fboS.fb); gl.deleteTexture(fboS.tex); gl.deleteRenderbuffer(fboS.rb); fboS = null; }
        if (acc) { gl.deleteFramebuffer(acc.fb); gl.deleteTexture(acc.tex); acc = null; }
    };
    function makeTarget(w, h, depth) {
        let fbo;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        let rb = null;
        if (depth) {
            rb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        }
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        fbo = { fb, tex, rb, w, h };
        return fbo;
    }

    // Sonnen-/Himmelsfarben aus der Palette (gedämpft)
    function palCol(look, t) {
        const p = look.pal;
        if (p.custom) { const c = look.custom; const i = Math.floor(((t % 1) + 1) % 1 * 6); return [c[3 * i], c[3 * i + 1], c[3 * i + 2]]; }
        return [0, 1, 2].map(k => p.a[k] + p.b[k] * Math.cos(6.28318 * (p.c[k] * t + p.d[k])));
    }

    // ---------------- 6.2 Rauschtextur (einmalig auf der GPU erzeugt, nur für Schnee/Alpin)
    let noiseTex = null;
    function getNoise() {
        if (noiseTex) return noiseTex;
        const N = 512;
        noiseTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, noiseTex);
        gl.texStorage2D(gl.TEXTURE_2D, Math.log2(N) + 1, gl.RGBA8, N, N);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, noiseTex, 0);
        gl.viewport(0, 0, N, N);
        const pr = R.program('t3noise', NOISE_FS);
        gl.useProgram(pr.p);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
        gl.bindTexture(gl.TEXTURE_2D, noiseTex);
        gl.generateMipmap(gl.TEXTURE_2D);
        return noiseTex;
    }

    // ---------------- 6.2 Welt-verankertes Rauschen (Alpin, Schnee): Versatz je Oktave exakt aus der BigInt-Kamera
    // (Fokus / Wellenlänge mod 256 – im Deep Zoom wäre das in f32 unmöglich), Wellenlänge = Zweierpotenz der Welt
    const noffB = new Float32Array(8);
    // 6.5 Wolkenschatten: Versatz der zwei groben Oktaven (Zellgröße 2^(n0-j+1) in Weltkoordinaten), mod 256 Zellen
    const coffB = new Float32Array(4);
    function cloudUniforms(U, focus, u) {
        if (!U.u_coff) return;
        const L = Math.log2(u), n0 = Math.floor(L);
        for (let j = 0; j < 2; j++) {
            const sh = 1088 + (n0 - j + 1);
            for (let a = 0; a < 2; a++) {
                const v = a ? focus.cy : focus.cx;
                if (sh < 24) { coffB[2 * j + a] = 0; continue; }
                const M = 256n << BigInt(sh);
                const r = ((v % M) + M) % M;
                coffB[2 * j + a] = Number(r >> BigInt(sh - 24)) / 16777216;
            }
        }
        gl.uniform2fv(U.u_coff, coffB);
        gl.uniform1f(U.u_nfr, L - n0);
    }
    function noiseUniforms(U, focus, u) {
        if (!U.u_noff) return;
        const L = Math.log2(u), n0 = Math.floor(L);
        for (let j = 0; j < 4; j++) {
            const sh = 1088 + (n0 - j - 3);     // Welt / 2^(n0-j-3) = Festkomma >> sh
            for (let a = 0; a < 2; a++) {
                const v = a ? focus.cy : focus.cx;
                if (sh < 24) { noffB[2 * j + a] = 0; continue; }
                const M = 256n << BigInt(sh);
                const r = ((v % M) + M) % M;
                noffB[2 * j + a] = Number(r >> BigInt(sh - 24)) / 16777216;
            }
        }
        gl.uniform2fv(U.u_noff, noffB);
        gl.uniform1f(U.u_nfr, L - n0);
    }

    // ---------------- Zeichnen
    // list: Ebenen (schärfste zuerst, max. N3) · v: { tilt, heading, height, mix, focus{cx,cy}, u, L[2], time }
    // o (6.1): { smooth, de:[lo,hi], still:{ n, N, mix2 } | null }. still = Mittelung im Stillstand: Bild n wird
    // in voller Auflösung mit Subpixel-Versatz (Halton 2,3) gezeichnet und gleitend gemittelt (Gewicht 1/(n+1),
    // ab N 1/N – nur nötig, solange sich die Farben animieren); mix2 = Restanteil des letzten Bewegungsbilds
    // (weiche Überblendung statt hartem Wechsel auf die volle Auflösung).
    const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
    T.render = function (list, v, look, alpha, o) {
        o = o || {};
        const W = R.canvas.width, H = R.canvas.height;
        const still = o.still || null;
        const ss = still ? (still.scale || 1) : T.scale;
        const sw = Math.max(16, Math.round(W * ss)), shh = Math.max(16, Math.round(H * ss));
        const sm = !!o.smooth;
        list = list.slice(0, N3);
        for (const l of list) if (!l.h3d || (T.h8 && (!l.h3d.L || Math.abs(l.h3d.L[0] - v.L[0]) + Math.abs(l.h3d.L[1] - v.L[1]) > 0.05 * (v.L[1] - v.L[0])))) buildHeight(l, look, v.L);
        layerUniforms(list, v.focus, v.u);
        const c = T.camera(v, W, H);
        T.lastCam = c;
        if ((look.alpine || (look.setCol && SH_LUM(look.setCol) > 0.34)) && R.programReady('t3noise', NOISE_FS)) getNoise();   // vor dem Binden des Ziels (eigener Pass)
        const prT = terrainProgram(look);      // 6.3: vor dem Binden des Ziels (wärmt ggf. eine neue Variante an)
        const tg = still ? targetS(sw, shh) : target(sw, shh);
        let jit = [0, 0];
        if (still && still.N > 1) { const k = still.n % 64 + 1; jit = [(halton(k, 2) - 0.5) * 2 / sw, (halton(k, 3) - 0.5) * 2 / shh]; }
        gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb);
        gl.viewport(0, 0, sw, shh);
        const sunAz = 2.35, sunEl = 0.5;   // Sonne fest im Fraktal (von links oben wie das 2D-Relief)
        const sun = [Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl)];
        const hz = palCol(look, 0.18 + look.cycle), zn = palCol(look, 0.62 + look.cycle);
        let haze = hz.map((x, k) => (x * 0.35 + [0.62, 0.68, 0.8][k] * 0.65) * 0.7);
        let zenith = zn.map((x, k) => x * 0.18 + [0.03, 0.05, 0.12][k]);
        if (look.alpine) { haze = [0.66, 0.74, 0.85]; zenith = [0.17, 0.33, 0.62]; }   // Alpin: klarer Himmel, bläulicher Dunst
        // Himmel
        let pr = R.program('t3sky', SKY_FS), U = pr.loc;
        gl.useProgram(pr.p);
        camUniforms(U, c, sw, shh);
        gl.uniform3fv(U.u_sun, sun); gl.uniform3fv(U.u_haze, haze); gl.uniform3fv(U.u_zenith, zenith);
        gl.uniform2fv(U.u_jit, jit);
        const dk = v.deko || 0;     // 6.5: Stärke der Deko (0 = Aussehen bis 6.4.1)
        gl.uniform1i(U.u_deko, dk > 0 ? 1 : 0); gl.uniform1f(U.u_dk, dk); gl.uniform1f(U.u_ctime, v.ctime || 0);
        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // Gelände
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        pr = prT; U = pr.loc;
        gl.useProgram(pr.p);
        camUniforms(U, c, sw, shh);
        gl.uniform2fv(U.u_jit, jit);
        const cols = Math.max(48, Math.min(200, Math.round(W / ((T.mobile ? 8 : 6) * Math.max(1, W / 900))))), rows = Math.max(64, Math.min(300, Math.round(cols * H / W * 1.3)));
        const g = makeGrid(cols, rows);
        gl.uniform2f(U.u_yr, -2.1, c.yTop);   // weit unter den Bildrand: hohe Berge vorn heben die unterste Reihe an
        const n = 0.02, far = 80;
        gl.uniform2f(U.u_depth, (far + n) / (far - n), -2 * far * n / (far - n));
        gl.uniform1f(U.u_far, 28);
        gl.uniform1f(U.u_rows, rows);
        gl.uniform1i(U.u_shN, 6); gl.uniform1i(U.u_nq, 3);
        gl.uniform3f(U.u_hn, v.L[0], 1 / Math.max(1e-3, v.L[1] - v.L[0]), v.height * v.mix);
        gl.uniform1i(U.u_h8, T.h8 ? 1 : 0);
        const cdf = v.cdf || [v.L[0], 0, 0, 0, 0, 0, 0, 0, v.L[1]].map((x, i, a) => i && i < 8 ? a[0] + (a[8] - a[0]) * i / 8 : x);
        gl.uniform1fv(U.u_cdf, T.h8 ? cdf.map(x => (x - v.L[0]) / Math.max(1e-3, v.L[1] - v.L[0])) : cdf);
        gl.uniform3fv(U.u_sun, sun); gl.uniform3fv(U.u_haze, haze); gl.uniform3fv(U.u_zenith, zenith);
        gl.uniform1f(U.u_fog, 9);
        gl.uniform1i(U.u_deko, dk > 0 ? 1 : 0); gl.uniform1f(U.u_dk, dk); gl.uniform1f(U.u_ctime, v.ctime || 0);
        gl.uniform1f(U.u_mix, v.mix);
        gl.uniform1f(U.u_time, v.time || 0);
        gl.uniform1i(U.u_smooth, sm ? 1 : 0);
        gl.uniform1i(U.u_alpine, look.alpine || 0);
        noiseUniforms(U, v.focus, v.u);
        if (dk > 0) cloudUniforms(U, v.focus, v.u);
        R.setPalette(U, look);
        gl.uniform1f(U.u_density, look.density);
        gl.uniform1i(U.u_formula, look.formula);
        gl.uniform1i(U.u_maxIter, look.maxIter);
        gl.uniform1i(U.u_banded, look.banded ? 1 : 0);
        bindLayers(U, list, true, 0);
        if (U.u_noise && noiseTex) { const nt = noiseTex; gl.activeTexture(gl.TEXTURE0 + 2 * N3); gl.bindTexture(gl.TEXTURE_2D, nt); gl.uniform1i(U.u_noise, 2 * N3); }
        gl.bindVertexArray(g.vao);
        gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(R.vao);
        gl.disable(gl.DEPTH_TEST);
        let src = tg, src2 = null, mix2 = 0;
        if (still) {
            // gleitender Mittelwert im Akkumulationsziel (Blending mit konstantem Gewicht)
            const ac = accTarget(sw, shh);
            gl.bindFramebuffer(gl.FRAMEBUFFER, ac.fb);
            gl.viewport(0, 0, sw, shh);
            const w = still.n === 0 ? 1 : 1 / Math.min(still.n + 1, Math.max(1, still.N));
            gl.enable(gl.BLEND); gl.blendColor(0, 0, 0, w); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
            pr = R.program('t3blit', BLIT_FS); U = pr.loc;
            gl.useProgram(pr.p);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tg.tex); gl.uniform1i(U.u_src, 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tg.tex); gl.uniform1i(U.u_src2, 1);
            gl.uniform2f(U.u_target, sw, shh); gl.uniform1f(U.u_alpha, 1); gl.uniform1f(U.u_mix2, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.disable(gl.BLEND);
            src = ac;
            if (still.mix2 > 0 && fbo) { src2 = fbo; mix2 = still.mix2; }
        }
        // auf den Canvas (lineare Hochskalierung), alpha < 1 = Überblendung mit dem 2D-Bild
        T.present(src, src2, mix2, alpha);
    };
    // gemitteltes bzw. letztes Bild auf den Canvas (ohne neu zu zeichnen)
    // (6.3 kurz per blitFramebuffer – unter ANGLE/Metal räumt der Treiber den frisch getauschten Canvas-Puffer danach
    // teils nachträglich leer; der kleine Kopier-Shader wie bis 6.2 ist der bewährte Weg)
    T.present = function (src, src2, mix2, alpha) {
        src = src || acc || fbo;
        if (!src) return;
        const W = R.canvas.width, H = R.canvas.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        const pr = R.program('t3blit', BLIT_FS), U = pr.loc;
        gl.useProgram(pr.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(U.u_src, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, (src2 || src).tex); gl.uniform1i(U.u_src2, 1);
        gl.uniform2f(U.u_target, W, H);
        gl.uniform1f(U.u_alpha, alpha === undefined ? 1 : alpha);
        gl.uniform1f(U.u_mix2, src2 ? mix2 : 0);
        if (alpha !== undefined && alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
    };
    T.hasAcc = () => !!acc;

    // ---------------- Sonde (asynchron): Iterationswerte im Fenster ±win um den Fokus
    const PW = 48, PH = 48;
    let probeBuf = null, probeBusy = false;
    T.probe = function (list, focus, u, win) {
        if (probeBusy) return null;
        list = list.slice(0, N3);
        if (!probeBuf) probeBuf = R.acquireBuffer(PW, PH, true);
        layerUniforms(list, focus, u);
        const pr = R.program('t3probe', PROBE_FS), U = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, probeBuf.fbo);
        gl.viewport(0, 0, PW, PH);
        for (let i = 0; i < N3; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, list[i] ? list[i].buf.tex : R.dummyU());
            gl.uniform1i(U['u_i' + i], i);
            gl.activeTexture(gl.TEXTURE0 + N3 + i);
            gl.bindTexture(gl.TEXTURE_2D, list[i] && list[i].buf.de ? list[i].buf.de : R.dummyD());
            gl.uniform1i(U['u_d' + i], N3 + i);
        }
        gl.uniform4fv(U.u_lt, ltB); gl.uniform4fv(U.u_ls, lsB);
        gl.uniform1i(U.u_n3, list.length);
        gl.uniform2f(U.u_psize, PW, PH);
        gl.uniform1f(U.u_win, win);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        probeBusy = true;
        return R.readIterAsync(probeBuf).then((f) => {
            probeBusy = false;
            if (!f) return null;
            const out = new Float32Array(f.length), de = new Float32Array(f.length), fu = new Uint32Array(f.buffer);
            let nde = 0;
            for (let i = 0; i < f.length; i++) {
                const v = f[i], code = fu[i] & 255;
                out[i] = v < -1e29 ? NaN : (v <= -3 ? -v - 4 : (v < -1.5 ? -1 : v));
                de[i] = v < -1e29 || code === 0 ? NaN : code === 1 ? 0 : code === 255 ? 4 : Math.pow(2, (code - 2) / 16 - 12);
                if (code > 1) nde++;
            }
            return { w: PW, h: PH, win, data: out, de, hasDE: nde > 0 };
        });
    };

    // GPU-Zeit-Messung (Test-Hook)
    T.info = () => ({ h8: T.h8, scale: T.scale, grid: grid ? [grid.cols, grid.rows] : null, target: fbo ? [fbo.w, fbo.h] : null, still: fboS ? [fboS.w, fboS.h] : null });
    return T;
}

root.FK3D = { create, N3 };
})(typeof self !== 'undefined' ? self : globalThis);
