// bulb.js — 7.0 Mandelbulb „richtig“: freie 3D-Kamera (Position/Blick in f64), Raymarching mit Licht, weichen Schatten,
// Ambient Occlusion, Material-Stilen, Farbe nach Struktur (Orbit-Traps), echtem Hineinzoomen (Kegel-Epsilon, Iterationen
// wachsen mit dem Zoom, Taylor-Anker gegen die float32-Grenze), Ruhebild-Mittelung, Flug und Parametern (Exponent,
// Julia-Bulb, Tiefenunschärfe, Nebel). Bis 6.9 zeichnete renderer.js/presentBulb ein einfaches Bild ohne Licht – das bleibt
// als Rückfall (Shader defekt, kein Float-Renderziel).
//
// Aufbau eines Bilds:
//  1. MARSCH-Pass (BULB_FS, drei Ausgaben, RGBA16F): je Pixel Strahl durch die Kamera, Schnitt mit der umhüllenden Kugel,
//     Raymarching mit Distanzschätzung; am Treffer Normale (Tetraeder), weicher Schatten, AO, Licht. Die Palette wird NICHT
//     hier angewandt: geschrieben werden nur palettenunabhängige Lichtterme und der Paletten-Index (mal Deckung) – so kann die
//     Farbanimation im Stillstand laufen, ohne neu zu marschieren, und Mittelung über Bilder bleibt linear.
//       o0 = (diffuses Licht RGB, Index·Deckung)  o1 = (Zusatzlicht RGB: Glanz, Rand, Himmel/Nebel; Metallglanz-Stärke)
//       o2 = (Leuchten im Inneren, Halo am Rand außen, Deckung, –)
//  2. Bewegung: ein Bild in angepasster Auflösung (Skala nach Bildrate), POST-Pass bilinear hochskaliert.
//     Stillstand: in voller Auflösung gemittelt (Subpixel-Versatz, wechselnde AO/Schatten-Proben, Linse bei Tiefenunschärfe),
//     in Streifen über mehrere App-Bilder verteilt (kein GPU-Stau), Gewicht 1/(k+1) per Konstant-Blending.
//  3. POST-Pass: Palette je Pixel aus dem gemittelten Index, Stil-Albedo, Tonkurve, Vignette, Gamma.
// Präzision (Etappe 3): Positionen sind float32 (≈ 6·10⁻⁸). Ab Zoom ~100 wird die erste Iteration um einen Anker P0 nahe der
// Bildmitte entwickelt (F(P0) + J·δ + ½ δᵀHδ, P0/J/H in f64 in JS gerechnet, δ = p − P0 klein und genau in f32): die
// Rundung der Position fällt weg, es bleibt die Rundung von w₁ (≈ 6·10⁻⁸ / |F'| ≈ 4·10⁻⁹). Zoomgrenze dort, wo ein Pixel
// kleiner als ~8 dieser Einheiten wird.
(function (root) {
'use strict';
const SH = root.FKShaders;

const PALF = `
uniform vec3 u_palA, u_palB, u_palC, u_palD;
uniform int u_palCustom;
uniform vec3 u_custom[6];
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
}`;

// ---------------------------------------------------------------- MARSCH-Pass
const BULB_FS = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 u_vp;          // Lage des Ziels im ganzen Bild (x, y, Breite, Höhe in Pixeln des ganzen Bilds)
uniform vec2 u_jit;         // Subpixel-Versatz (Pixel)
uniform vec3 u_ro, u_fw, u_rt, u_up;
uniform float u_tanF;       // tan(halber senkrechter Bildwinkel)
uniform float u_power;      // Exponent (2–16, stufenlos)
uniform int u_iter, u_steps, u_shN, u_aoN;
uniform int u_julia;        // 1 = Julia-Bulb (fester c = u_jc)
uniform vec3 u_jc;
uniform float u_bound;      // Radius der umhüllenden Kugel
uniform float u_epsK;       // Treffer, wenn Abstand < u_epsK · Pixelkegel
uniform float u_stepK;      // Schrittfaktor (Distanzschätzung ist nur ungefähr)
uniform float u_scale;      // Bezugsgröße: Abstand Kamera–Oberfläche (AO, Schatten, Nebel, Halo zoom-unabhängig)
uniform int u_style;        // 0 Klassisch, 1 Stein, 2 Metall, 3 Glas/Neon
uniform int u_outM;         // 6.9 Außen: 0 Verlauf + Sterne, 1 schwarz mit Leuchten am Rand, 2 schwarz
uniform float u_outW;       // Leuchtbreite (Pixel)
uniform float u_fog;        // Nebel/Atmosphäre 0..1
uniform vec4 u_lens;        // Tiefenunschärfe: Linsenversatz xy (Bruchteil der Blende), Blende z, Fokusabstand w (z = 0: aus)
uniform float u_seed;       // Bildnummer der Mittelung (AO-/Schatten-Proben variieren)
// Taylor-Anker (Präzision im Tiefzoom)
uniform int u_tay;
uniform vec3 u_d0;          // Kamera − Anker (klein, genau)
uniform vec3 u_P0;          // Anker (float32, nur für c)
uniform vec3 u_K;           // F(P0) = c(P0) + T(P0)
uniform mat3 u_J;           // Jacobi-Matrix von F in P0
uniform mat3 u_H[3];        // Hesse-Matrizen der drei Komponenten
uniform float u_tayR;       // Gültigkeitsradius
uniform float u_dr1;        // Ableitung nach dem ersten Schritt in P0 (skalar wie die Distanzschätzung)
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;

vec4 g_trap;    // Orbit-Trap der letzten Auswertung: min |x|, |y|, |z|, |w|²
float g_tayD;   // Abstand zum Anker der letzten Auswertung

// ein Schritt der Bulb-Abbildung (Triplex-Potenz in Kugelkoordinaten)
vec3 bulbPow(vec3 w, float r, out float rp) {
    rp = pow(r, u_power - 1.0);
    float th = u_power * acos(clamp(w.y / max(r, 1e-30), -1.0, 1.0));
    float ph = u_power * atan(w.x, w.z);
    float st = sin(th);
    return rp * r * vec3(st * sin(ph), cos(th), st * cos(ph));
}
// Distanzschätzung. q = Position relativ zur Kamera (q = rd·t): p = u_ro + q; im Taylor-Bereich δ = u_d0 + q
float deQ(vec3 q) {
    vec3 p = u_ro + q;
    vec3 c = u_julia == 1 ? u_jc : p;
    vec3 w = p;
    float m = dot(w, w), dr = 1.0, rp;
    vec4 tr = vec4(abs(w), m);
    int i0 = 0;
    if (u_tay == 1) {
        vec3 d = u_d0 + q;
        float dd = dot(d, d);
        g_tayD = sqrt(dd);
        if (dd < u_tayR * u_tayR) {
            // erste Iteration aus der Entwicklung um den Anker: keine Rundung der Position (|δ| ≪ 1, genau in f32)
            w = u_K + u_J * d + 0.5 * vec3(dot(d, u_H[0] * d), dot(d, u_H[1] * d), dot(d, u_H[2] * d));
            if (u_julia == 0) c = u_P0 + d;
            dr = u_dr1;
            m = dot(w, w);
            tr = min(tr, vec4(abs(w), m));
            i0 = 1;
        }
    }
    bool p8 = u_power == 8.0;
    for (int i = 0; i < 64; i++) {
        if (i < i0) continue;
        if (i >= u_iter || m > 256.0) break;
        float r = sqrt(m);
        vec3 t;
        if (p8) {
            // Exponent 8 ohne Winkelfunktionen (Polynom-Form derselben Abbildung, nach I. Quilez) – ~2× schneller
            float x = w.x, x2 = x * x, x4 = x2 * x2, y = w.y, y2 = y * y, y4 = y2 * y2, z = w.z, z2 = z * z, z4 = z2 * z2;
            float k3 = x2 + z2;
            float k2 = inversesqrt(max(k3 * k3 * k3 * k3 * k3 * k3 * k3, 1e-38));
            float k1 = x4 + y4 + z4 - 6.0 * y2 * z2 - 6.0 * x2 * y2 + 2.0 * z2 * x2;
            float k4 = x2 - y2 + z2;
            t = vec3(64.0 * x * y * z * (x2 - z2) * k4 * (x4 - 6.0 * x2 * z2 + z4) * k1 * k2,
                     -16.0 * y2 * k3 * k4 * k4 + k1 * k1,
                     -8.0 * y * k4 * (x4 * x4 - 28.0 * x4 * x2 * z2 + 70.0 * x4 * z4 - 28.0 * x2 * z2 * z4 + z4 * z4) * k1 * k2);
            rp = m * m * m * r;          // r⁷
        } else t = bulbPow(w, r, rp);
        dr = u_power * rp * dr + (u_julia == 1 ? 0.0 : 1.0);
        w = c + t;
        m = dot(w, w);
        tr = min(tr, vec4(abs(w), m));
        if (dr > 1e30) break;
    }
    g_trap = tr;
    return 0.25 * log(m) * sqrt(m) / dr;
}
vec3 normalQ(vec3 q, float h) {
    const vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * deQ(q + k.xyy * h) + k.yyx * deQ(q + k.yyx * h) + k.yxy * deQ(q + k.yxy * h) + k.xxx * deQ(q + k.xxx * h));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// weicher Schatten (Penumbra aus dem kleinsten Verhältnis Abstand/Weg), Reichweite relativ zur Szene
float softShadow(vec3 q, vec3 L, float s, float jit) {
    float res = 1.0, t = s * (0.004 + 0.004 * jit);
    for (int i = 0; i < 128; i++) {
        if (i >= u_shN) break;
        float h = deQ(q + L * t);
        res = min(res, 9.0 * h / t);
        t += clamp(h, s * (u_shN < 16 ? 0.02 : 0.003), s * 0.2);
        if (res < 0.002 || t > s * 2.5) break;
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}
// Ambient Occlusion: Proben entlang der Normale (Abstände relativ zur Szene, je Bild leicht versetzt)
float ambientOcc(vec3 q, vec3 n, float s, float jit) {
    float o = 0.0, w = 1.0, ws = 0.0;
    for (int i = 1; i <= 8; i++) {
        if (i > u_aoN) break;
        float h = s * 0.035 * (float(i) + jit - 0.5) / float(u_aoN);
        o += w * clamp((h - deQ(q + n * h)) / h, 0.0, 1.0);
        ws += w;
        w *= 0.75;
    }
    return clamp(1.0 - 1.15 * o / max(ws, 1e-4), 0.0, 1.0);
}
// Hintergrund (palettenfrei): Verlauf + Sterne; Außen schwarz: schwarz. skyGrad = Verlauf allein (Nebelfarbe)
vec3 skyGrad(vec3 rd) {
    if (u_outM != 0) return vec3(0.0);
    float h = dot(rd, vec3(0.0, 1.0, 0.0));
    vec3 c = mix(vec3(0.030, 0.026, 0.060), vec3(0.008, 0.010, 0.030), smoothstep(-0.2, 0.9, h));
    return c + vec3(0.060, 0.035, 0.080) * pow(1.0 - abs(h), 6.0);
}
vec3 background(vec3 rd) {
    if (u_outM != 0) return vec3(0.0);
    vec3 c = skyGrad(rd);
    // Sterne: fest an der Richtung (schwimmen beim Zoomen nicht), klein und spärlich
    vec3 a = abs(rd);
    vec2 uv = a.x > a.y && a.x > a.z ? rd.yz / a.x : (a.y > a.z ? rd.xz / a.y : rd.xy / a.z);
    float face = a.x > a.y && a.x > a.z ? 1.0 : (a.y > a.z ? 2.0 : 3.0);
    vec2 g = uv * 140.0 + face * 37.0;
    vec2 cell = floor(g), f = fract(g) - 0.5;
    float hs = hash12(cell);
    if (hs > 0.985) {
        vec2 off = vec2(hash12(cell + 7.1), hash12(cell + 3.7)) - 0.5;
        float d = length(f - off * 0.6);
        c += vec3(0.9, 0.92, 1.0) * (hs - 0.985) * 60.0 * exp(-d * d * 90.0);
    }
    return c;
}
void main() {
    vec2 px = gl_FragCoord.xy + u_vp.xy + u_jit;
    float mn = min(u_vp.z, u_vp.w);                           // Bildwinkel gilt für die kürzere Seite (hoch und quer gleich)
    vec2 uv = (px - 0.5 * u_vp.zw) / (0.5 * mn);
    vec3 rd = normalize(u_fw + (uv.x * u_rt + uv.y * u_up) * u_tanF);
    float pix = 2.0 * u_tanF / mn;                            // Pixelwinkel (Kegel je Pixel)
    vec3 qo = vec3(0.0);                                      // Strahlstart relativ zur Kamera
    if (u_lens.z > 0.0) {
        // Tiefenunschärfe: Linsenpunkt verschoben, Strahl durch den Fokuspunkt (Fokusebene senkrecht zur Blickrichtung)
        vec3 fq = rd * (u_lens.w / dot(rd, u_fw));
        qo = (u_rt * u_lens.x + u_up * u_lens.y) * u_lens.z;
        rd = normalize(fq - qo);
    }
    vec3 ro = u_ro + qo;
    // umhüllende Kugel
    float b = dot(ro, rd), cc = dot(ro, ro) - u_bound * u_bound, disc = b * b - cc;
    float t0 = 0.0, t1 = -1.0;
    if (disc > 0.0) { float sq = sqrt(disc); t0 = max(0.0, -b - sq); t1 = -b + sq; }
    bool hit = false;
    float t = t0, qmin = 1e9, d = 1e9;
    int i = 0;
    if (t1 > 0.0) {
        for (i = 0; i < 2048; i++) {
            if (i >= u_steps) break;
            d = deQ(qo + rd * t);
            float cone = pix * max(t, 1e-9);
            qmin = min(qmin, d / cone);
            if (d < u_epsK * cone) { hit = true; break; }
            t += d * u_stepK;
            if (t > t1) break;
        }
    }
    float sc = u_scale;
    vec3 bg = background(rd);
    float halo = 0.0;
    if (u_outM != 2 && !hit) {
        halo = u_outM == 1 ? exp2(-3.0 * max(qmin, 0.0) / max(u_outW, 1.0)) : 0.12 * exp2(-max(qmin, 0.0) / 6.0);
        // zur umhüllenden Kugel hin weich aus (dahinter gibt es keine Schätzung – sonst stünde dort eine harte Kreiskante)
        float lineD = length(ro - rd * b);
        halo *= 1.0 - smoothstep(0.82 * u_bound, 0.98 * u_bound, lineD);
    }
    if (!hit && i >= u_steps && t1 > 0.0 && t < t1) {
        // Schritte aufgebraucht (streifender Blick an Strukturen entlang): als ferne, dunstige Fläche statt Loch
        hit = true;
    }
    if (!hit) {
        o0 = vec4(0.0); o1 = vec4(bg, 0.0); o2 = vec4(0.0, halo, 0.0, 0.0);
        return;
    }
    vec3 q = qo + rd * t;
    vec4 trap = g_trap;
    float cone = pix * t;
    vec3 n = normalQ(q, max(cone * 0.6, 1e-9));
    if (dot(n, rd) > 0.0) n = -n;
    float jit = hash12(floor(gl_FragCoord.xy + u_vp.xy) + u_seed * 17.31);    // Bildkoordinaten: Kachel = ganzes Bild
    // Licht: Hauptlicht schräg von oben links hinter der Kamera (wandert mit dem Blick – was man ansieht, ist beleuchtet),
    // Himmelslicht von oben, Rückstreulicht gegenüber
    vec3 L = normalize(-0.55 * u_rt + 0.75 * u_up - 0.35 * u_fw);
    vec3 B = normalize(0.6 * u_rt - 0.2 * u_up + 0.75 * u_fw);
    vec3 V = -rd;
    float nl = max(dot(n, L), 0.0);
    float sh = nl > 0.0 && u_shN > 0 ? softShadow(q + n * cone * 2.0, L, sc, jit) : 1.0;
    float ao = u_aoN > 0 ? ambientOcc(q, n, sc, jit) : 1.0;
    // Leuchten in Rissen: viele Schritte bis zum Treffer = Strahl kroch an Strukturen entlang
    float crev = smoothstep(0.25, 0.85, float(i) / float(u_steps));
    float trapO = clamp(sqrt(trap.w), 0.0, 1.5);
    float occT = mix(0.55, 1.0, smoothstep(0.0, 0.6, trapO));    // Orbit-Trap als Vertiefungs-Maß (dunkelt tiefe Kerben)
    float skyF = 0.5 + 0.5 * dot(n, u_up);
    float back = max(dot(n, B), 0.0);
    vec3 keyC = vec3(1.00, 0.90, 0.78) * 2.4, skyC = vec3(0.32, 0.42, 0.62), backC = vec3(0.34, 0.24, 0.20);
    vec3 H = normalize(L + V);
    float nh = max(dot(n, H), 0.0), nv = max(dot(n, V), 0.0);
    float fre = pow(1.0 - nv, 5.0);
    vec3 Ld = keyC * nl * sh + skyC * skyF * ao + backC * back * ao * 0.8;
    Ld *= occT;
    vec3 add = vec3(0.0);
    float mSpec = 0.0, emis = 0.0;
    if (u_style == 0) {             // Klassisch: satiniert
        add += keyC * pow(nh, 40.0) * 0.30 * sh + skyC * fre * 0.5 * ao;
        emis = crev * 0.25;
    } else if (u_style == 1) {      // Stein: matt, kräftige Verdeckung
        Ld *= mix(0.65, 1.0, ao);
        add += skyC * fre * 0.15 * ao;
        emis = 0.0;
    } else if (u_style == 2) {      // Metall: spiegelt eine helle Studio-Umgebung in der Palettenfarbe, scharfes Glanzlicht
        vec3 R = reflect(rd, n);
        float env = 0.12 + 0.9 * smoothstep(-0.35, 0.95, dot(R, u_up)) + 0.5 * pow(max(dot(R, L), 0.0), 6.0);
        float occR = mix(sh, 1.0, 0.35) * ao;
        mSpec = (env * 0.9 * occR + pow(nh, 120.0) * 4.0 * sh) * (0.75 + 0.25 * fre);
        add += vec3(1.0) * fre * 0.2 * ao;
        Ld *= 0.6;
        emis = crev * 0.1;
    } else {                        // Glas/Neon: dunkler Körper, Kanten und Risse leuchten
        Ld *= 0.35;
        add += skyC * fre * 0.3;
        emis = pow(fre, 1.5) * 1.6 + crev * 1.2;
    }
    // Nebel/Atmosphäre: relativ zur Szene (gleich bei jedem Zoom), zum Hintergrund hin
    float fogK = u_fog > 0.0 ? 1.0 - exp(-u_fog * 0.45 * max(t / sc - 1.5, 0.0)) : 0.0;
    float keep = 1.0 - fogK;
    float idx = 1.1 * trapO + 0.35 * clamp(trap.y, 0.0, 2.0) + 0.08 * log2(1.0 + t / sc);
    o0 = vec4(Ld * keep, idx);
    o1 = vec4(add * keep + skyGrad(rd) * fogK, mSpec * keep);
    o2 = vec4(emis * keep, 0.0, 1.0, 0.0);
}`;

// ---------------------------------------------------------------- POST-Pass
const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D u_s0, u_s1, u_s2;      // Quelle A (Bewegungsbild oder Mittelung)
uniform sampler2D u_t0, u_t1, u_t2;      // Quelle B (Überblendung)
uniform vec4 u_sr, u_tr;                 // Quelle: genutzter Bereich (Breite, Höhe) und Texturgröße (Breite, Höhe)
uniform float u_mix;                     // 0 = nur A, 1 = nur B
uniform vec2 u_res;                      // Zielgröße
uniform vec4 u_vp;                       // Lage des Ziels im ganzen Bild (Vignette)
uniform int u_style;
uniform float u_cycle, u_density, u_expo;
${PALF}
out vec4 fragColor;
vec3 lin(vec3 c) { return c * c; }
vec3 keyTint() { return vec3(1.0, 0.9, 0.78); }
vec3 shade(sampler2D a, sampler2D b, sampler2D c, vec2 uv) {
    vec4 A = texture(a, uv), B = texture(b, uv), C = texture(c, uv);
    float cov = C.b;
    float idx = cov > 1e-4 ? A.a / cov : 0.0;
    vec3 pal = lin(palette(idx * u_density + u_cycle));
    vec3 alb = u_style == 1 ? mix(vec3(0.42, 0.39, 0.35), pal, 0.35) : (u_style == 2 ? pal * 0.10 : (u_style == 3 ? pal * 0.25 : pal * 0.85));
    vec3 col = alb * A.rgb + B.rgb + pal * keyTint() * B.a + lin(palette(idx * u_density + 0.5 + u_cycle)) * C.r * 1.4
             + lin(palette(0.15 + u_cycle)) * C.g * 0.9;
    return col;
}

vec3 tone(vec3 x) {           // ACES-Näherung (Narkowicz), Belichtung davor
    x *= u_expo;
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
    vec2 f = gl_FragCoord.xy / u_res;
    vec3 col = shade(u_s0, u_s1, u_s2, f * u_sr.xy / u_sr.zw);
    if (u_mix > 0.0) col = mix(col, shade(u_t0, u_t1, u_t2, f * u_tr.xy / u_tr.zw), u_mix);
    col = tone(col);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.08);
    vec2 vv = (gl_FragCoord.xy + u_vp.xy) / u_vp.zw - 0.5;
    col *= 1.0 - dot(vv, vv) * 0.3;
    fragColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}`;

// ---------------------------------------------------------------- Mathe in f64 (Kamera, Antippen, Flug, Taylor-Anker)
const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    lerp: (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u],
};
// T(p) = r^n · (sin θ sin φ, cos θ, sin θ cos φ), θ = n·acos(y/r), φ = n·atan2(x, z) (wie im Shader)
function tPow(x, y, z, n) {
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r < 1e-300) return [0, 0, 0];
    const th = n * Math.acos(Math.max(-1, Math.min(1, y / r))), ph = n * Math.atan2(x, z), rn = Math.pow(r, n), st = Math.sin(th);
    return [rn * st * Math.sin(ph), rn * Math.cos(th), rn * st * Math.cos(ph)];
}
// Distanzschätzung in f64 (gleiche Formel wie der Shader); P: { power, julia, jc, iter }
function deJS(p, P) {
    const n = P.power, c = P.julia ? P.jc : p;
    let w = p, m = V.dot(w, w), dr = 1;
    for (let i = 0; i < P.iter; i++) {
        if (m > 256) break;
        const r = Math.sqrt(m);
        dr = n * Math.pow(r, n - 1) * dr + (P.julia ? 0 : 1);
        const t = tPow(w[0], w[1], w[2], n);
        w = [c[0] + t[0], c[1] + t[1], c[2] + t[2]];
        m = V.dot(w, w);
        if (dr > 1e300) break;
    }
    return 0.25 * Math.log(m) * Math.sqrt(m) / dr;
}
function boundOf(P) { return P.julia ? 2.2 : (P.power < 3.5 ? 2.2 : (P.power < 6 ? 1.7 : 1.45)); }
// Strahl gegen die Oberfläche (f64). Rückgabe: { t, p, steps, hit }
function marchJS(ro, rd, P, pix, maxT) {
    const R = boundOf(P);
    const b = V.dot(ro, rd), cc = V.dot(ro, ro) - R * R, disc = b * b - cc;
    if (disc <= 0) return { hit: false, t: Infinity, steps: 0 };
    const sq = Math.sqrt(disc);
    let t = Math.max(0, -b - sq);
    const t1 = Math.min(-b + sq, maxT || Infinity);
    for (let i = 0; i < 600; i++) {
        const p = V.add(ro, V.mul(rd, t));
        const d = deJS(p, P);
        if (d < Math.max(pix * t, 1e-12) * 0.5) return { hit: true, t, p, steps: i };
        t += d * 0.9;
        if (t > t1) break;
    }
    return { hit: false, t: Infinity, steps: 600 };
}
// Anker für die Entwicklung der ersten Iteration: F(P0), Jacobi J (3×3) und Hesse H_k (je 3×3), Spaltenweise (GLSL mat3)
function anchorJS(P0, P) {
    const n = P.power;
    const F = (p) => { const t = tPow(p[0], p[1], p[2], n); const c = P.julia ? P.jc : p; return [c[0] + t[0], c[1] + t[1], c[2] + t[2]]; };
    const K = F(P0);
    const h1 = 1e-5 * Math.max(1e-3, V.len(P0));
    const J = new Float64Array(9);
    for (let j = 0; j < 3; j++) {
        const e = [0, 0, 0]; e[j] = h1;
        const a = F(V.add(P0, e)), b = F(V.sub(P0, e));
        for (let k = 0; k < 3; k++) J[j * 3 + k] = (a[k] - b[k]) / (2 * h1);      // Spalte j, Zeile k
    }
    const h2 = 4e-4 * Math.max(1e-3, V.len(P0));
    const H = [new Float64Array(9), new Float64Array(9), new Float64Array(9)];
    for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) {
        const ea = [0, 0, 0], eb = [0, 0, 0]; ea[a] = h2; eb[b] = h2;
        const pp = F(V.add(V.add(P0, ea), eb)), pm = F(V.sub(V.add(P0, ea), eb)), mp = F(V.add(V.sub(P0, ea), eb)), mm = F(V.sub(V.sub(P0, ea), eb));
        for (let k = 0; k < 3; k++) { const v = (pp[k] - pm[k] - mp[k] + mm[k]) / (4 * h2 * h2); H[k][b * 3 + a] = v; H[k][a * 3 + b] = v; }
    }
    const r = V.len(P0);
    const dr1 = n * Math.pow(r, n - 1) + (P.julia ? 0 : 1);
    return { P0, K, J, H, dr1 };
}

root.FKBulb = { BULB_FS, POST_FS, deJS, marchJS, anchorJS, tPow, boundOf, V, create(ctx) {
    let R, S, HP, look, toast, t, emit, canvas;          // aus app.js, gesetzt in link()
    const gl = () => R.gl;
    const Q = ctx.Q;
    const RM = () => ctx.RM && ctx.RM.matches;       // „Bewegung reduzieren“: kein Atmen
    const B = {
        // Kamera (f64): Position, Gieren (um die Welt-Hochachse), Nicken; Drehpunkt für Orbit-Gesten
        pos: [1.38, 1.05, -2.15], yaw: -0.5706, pitch: -0.39, pivot: [0, 0, 0],
        fov: 50 * Math.PI / 180,
        // Parameter
        // (Stil, Nebel, Tiefenunschärfe, Atmen sind Einstellungen: S.bulbStyle, S.bulbFog, S.bulbDof, S.bulbBreathe)
        power: 8, power0: 8, julia: false, jc: [0.35, 0.45, -0.25], focus: 0,
        // Laufzeit
        anim: null, inertia: null, gest: null, zoom: 1, dSurf: 1.45, limit: false, limitWarned: false,
        ok: null, why: '', key: '', still: null, mot: null, scaleM: 0.6, rows: 0, info: {},
    };
    const HOME = { pos: [1.38, 1.05, -2.15], yaw: -0.5706, pitch: -0.39 };     // schräg von oben (3/4-Ansicht), Abstand 2,75
    let Z0 = 1.45;                     // Abstandsschätzung der Startansicht (Zoom 1)

    // ---------------- Kamera
    // Blickrichtung aus Gieren/Nicken; rt zeigt im Bild nach rechts, up nach oben
    function camBasis() {
        const cp = Math.cos(B.pitch);
        const fw = [cp * Math.sin(B.yaw), Math.sin(B.pitch), cp * Math.cos(B.yaw)];
        const rt = [Math.cos(B.yaw), 0, -Math.sin(B.yaw)];
        const up = V.cross(fw, rt);
        return { fw, rt, up: V.dot(up, [0, 1, 0]) < 0 ? V.mul(up, -1) : up };
    }
    // Iterationen in JS (Antippen, Zoom, Kollision) wie im Ruhebild – dieselbe Oberfläche wie im Bild
    const params = (extra) => ({ power: B.power, julia: B.julia, jc: B.jc, iter: iterFor(B.zoom) + 2 + (extra || 0) });
    function iterFor(z) { return Math.max(8, Math.min(28, Math.round(8 + 2.6 * Math.log10(Math.max(1, z))))); }
    // Strahl durch einen Bildschirmpunkt (CSS-Pixel)
    function rayAt(x, y) {
        const cb = camBasis(), H = ctx.cssH, W = ctx.cssW, tf = Math.tan(B.fov / 2), mn = Math.min(W, H);
        const u = (x - W / 2) / (mn / 2), v = -(y - H / 2) / (mn / 2);
        return { ro: B.pos, rd: V.norm(V.add(cb.fw, V.add(V.mul(cb.rt, u * tf), V.mul(cb.up, v * tf)))), pix: 2 * tf / mn };
    }
    function pick(x, y, extra) { const r = rayAt(x, y); const h = marchJS(r.ro, r.rd, params(extra), r.pix); return h.hit ? h : null; }
    // Abstand zur Oberfläche an der Kamera -> Zoom (1 = Startansicht) und Iterationen
    function updateZoom() {
        const d = Math.max(1e-12, deJS(B.pos, params()));
        B.dSurf = d;
        B.zoom = Math.max(0.05, Z0 / d);
        S.cam = { cx: S.cam.cx, cy: S.cam.cy, zoom: B.zoom };
    }
    // kleinster erlaubter Abstand: ein Pixel an der Oberfläche ≥ PIXMIN (Taylor-Anker, s. o.)
    const PIXMIN = +(Q.get('bulbpix') || 3.5e-8);
    function minDist() { return PIXMIN / (2 * Math.tan(B.fov / 2) / Math.max(1, Math.min(canvas.width, canvas.height))); }
    function setPos(p) {
        // Kollision: nie in die Oberfläche (Abstand ≥ halber Mindestabstand) und nicht beliebig weit weg
        const d = deJS(p, params()), lim = minDist();
        if (d < lim) {
            if (!B.limitWarned) { B.limitWarned = true; toast(t('bulb_limit'), 3600); }
            B.limit = true;
            return false;
        }
        if (d > lim * 3) B.limitWarned = false;
        B.limit = false;
        if (V.len(p) > 12) p = V.mul(V.norm(p), 12);
        B.pos = p;
        ctx.camDirty = true;
        return true;
    }
    // Kamera um einen Punkt drehen (Gieren um die Welt-Hochachse, Nicken um die Kamera-Rechte); der Punkt bleibt im Bild stehen
    function orbit(base, dyaw, dpitch) {
        const piv = base.pivot;
        let pitch = Math.max(-1.45, Math.min(1.45, base.pitch + dpitch));
        dpitch = pitch - base.pitch;
        let rel = V.sub(base.pos, piv);
        // Nicken um die Rechte der Ausgangskamera
        const rt = [Math.cos(base.yaw), 0, -Math.sin(base.yaw)];
        rel = rotAxis(rel, rt, -dpitch);
        // Gieren um die Welt-Hochachse
        rel = rotAxis(rel, [0, 1, 0], dyaw);
        B.yaw = base.yaw + dyaw; B.pitch = pitch;
        setPos(V.add(piv, rel));
        ctx.camDirty = true;
    }
    function rotAxis(v, k, a) {      // Rodrigues
        const c = Math.cos(a), s = Math.sin(a), kv = V.cross(k, v), kd = V.dot(k, v);
        return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
    }
    // Zoomen auf einen Punkt zu (der Punkt bleibt an seiner Bildstelle): Abstand ÷ f
    function zoomToward(base, P, f) {
        const np = V.add(P, V.mul(V.sub(base.pos, P), 1 / f));
        if (setPos(np) || f <= 1) return;
        // Grenze: so nah wie erlaubt (Halbierung zwischen Ausgangspunkt und Ziel)
        let lo = 0, hi = 1;
        for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (setPos(V.lerp(base.pos, np, m))) lo = m; else hi = m; }
        if (lo > 0) setPos(V.lerp(base.pos, np, lo));
    }
    // Drehpunkt: Oberfläche in der Bildmitte, in der Übersicht der Ursprung
    function pivotNow() {
        if (B.zoom < 1.6 && V.len(B.pos) > 1.8) return [0, 0, 0];
        const h = pick(ctx.cssW / 2, ctx.cssH / 2);
        if (h) return h.p;
        return V.add(B.pos, V.mul(camBasis().fw, Math.max(B.dSurf, 0.05)));
    }
    // Punkt unter dem Finger: Treffer, sonst Punkt auf dem Strahl in der Tiefe des Drehpunkts
    function pointUnder(x, y, fallbackDist) {
        const h = pick(x, y);
        if (h) return h.p;
        const r = rayAt(x, y);
        return V.add(r.ro, V.mul(r.rd, fallbackDist));
    }

    // ---------------- Gesten (aus app.js weitergereicht, wenn der Mandelbulb aktiv ist)
    const G = {
        start(ax, ay) {
            B.anim = null; B.inertia = null;
            const piv = pivotNow();
            B.gest = { pos: B.pos, yaw: B.yaw, pitch: B.pitch, pivot: piv, ax, ay, zp: null, n: 1 };
        },
        transform(ax0, ay0, ax, ay, scale, rot, n) {
            const g = B.gest;
            if (!g) return;
            if (ctx.FLY.on && ctx.FLY.mode === 'bulb') {
                if (n >= 2 || Math.abs(scale - 1) > 0.02) { ctx.stopFly(); }      // zwei Finger: Flug aus, normal zoomen
                else { flySteer(ax - (g.lx === undefined ? ax0 : g.lx), ay - (g.ly === undefined ? ay0 : g.ly)); g.lx = ax; g.ly = ay; return; }
            }
            if (n >= 2 || Math.abs(scale - 1) > 0.01) {
                if (!g.zp) g.zp = pointUnder(ax0, ay0, V.len(V.sub(g.pivot, g.pos)));
                const base = { pos: g.pos, yaw: g.yaw, pitch: g.pitch, pivot: g.zp };
                zoomToward(base, g.zp, scale);
                // zwei Finger gemeinsam verschieben = drehen um den Zoompunkt
                const k = Math.PI / Math.max(320, ctx.cssW) * 0.9;
                if (Math.hypot(ax - ax0, ay - ay0) > 2) {
                    const b2 = { pos: B.pos, yaw: g.yaw, pitch: g.pitch, pivot: g.zp };
                    orbit(b2, (ax - ax0) * k, -(ay - ay0) * k);
                }
                return;
            }
            const k = Math.PI / Math.max(320, ctx.cssW) * 1.1;
            orbit(g, (ax - ax0) * k, -(ay - ay0) * k);
        },
        end(vx, vy, vs) {
            const g = B.gest; B.gest = null;
            if (!g || ctx.FLY.on) return;
            const k = Math.PI / Math.max(320, ctx.cssW) * 1.1;
            if (Math.hypot(vx, vy) > 60) B.inertia = { vy: vx * k, vp: -vy * k, pivot: g.pivot };
        },
        doubleTap(x, y) {
            const h = pick(x, y);
            if (h) flyToPoint(h.p, 3, 0.55, true);
            else flyToPoint(pivotNow(), 3, 0.45, false);
        },
        twoFingerTap() { flyToPoint(pivotNow(), 1 / 3, 0.45, false); },
        wheel(x, y, f) {
            B.anim = null; B.inertia = null;
            const P = pointUnder(x, y, Math.max(B.dSurf, 0.05) * 1.5);
            zoomToward({ pos: B.pos }, P, f);
        },
        orbitMouse(dx, dy, phase) {
            if (phase === 'start') { G.start(0, 0); return; }
            if (phase === 'end') { B.gest = null; return; }
            const g = B.gest; if (!g) return;
            const k = Math.PI / Math.max(320, ctx.cssW) * 1.1;
            orbit(g, dx * k, -dy * k);
        },
        // Tiefenunschärfe an: Tipp setzt den Fokus auf die Oberfläche unter dem Finger (true = Tipp erledigt)
        tap(x, y) {
            if (!(S.bulbDof > 0)) return false;
            const h = pick(x, y);
            if (!h) return false;
            B.focus = h.t * V.dot(rayAt(x, y).rd, camBasis().fw);
            invalidate();
            toast(t('bulb_focus'), 1400);
            return true;
        },
        longPress(x, y) {
            const h = pick(x, y);
            if (!h) return false;
            // Julia-Bulb: c = dieser Oberflächenpunkt
            B.julia = true; B.jc = h.p.slice();
            if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
            invalidate(); emit('bulb');
            toast(t('bulb_julia_here') + ' (' + h.p.map(v => v.toFixed(3)).join(', ') + ')', 3200);
            return true;
        },
    };
    // Kamerafahrt zu einem Punkt: Abstand ÷ f, Blick dreht weich zum Punkt (center = true)
    function flyToPoint(P, f, dur, center) {
        B.inertia = null;
        const a = { pos: B.pos, yaw: B.yaw, pitch: B.pitch };
        let endPos = V.add(P, V.mul(V.sub(B.pos, P), 1 / f));
        const lim = minDist(), Pp = params();
        let k = 0;
        while (deJS(endPos, Pp) < lim && k++ < 40) endPos = V.add(P, V.mul(V.sub(endPos, P), 1.25));
        if (k > 0 && !B.limitWarned) { B.limitWarned = true; toast(t('bulb_limit'), 3600); }
        const dir = V.norm(V.sub(P, endPos));
        const by = center ? Math.atan2(dir[0], dir[2]) : B.yaw, bp = center ? Math.asin(Math.max(-1, Math.min(1, dir[1]))) : B.pitch;
        let dy = by - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        B.anim = { t0: performance.now(), dur: dur * 1000, a, P, f, la: Math.log(V.len(V.sub(a.pos, P))), lb: Math.log(V.len(V.sub(endPos, P))), dir0: V.norm(V.sub(a.pos, P)), dir1: V.norm(V.sub(endPos, P)), yaw1: a.yaw + dy, pitch1: bp };
        B.pivot = P;
    }
    const ease = (u) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    function update(now, dt) {
        // Atmen: der Exponent schwingt langsam um den eingestellten Wert (±1,5, eine Schwingung in ~18 s)
        if (S.bulbBreathe && S.anim && !RM()) B.power = Math.max(2, Math.min(16, B.power0 + 1.5 * Math.sin(S.time * 0.35)));
        else if (B.power !== B.power0) B.power = B.power0;
        if (B.anim) {
            const A = B.anim, u = Math.min(1, (now - A.t0) / A.dur), e = ease(u);
            const r = Math.exp(A.la + (A.lb - A.la) * e);
            const dir = V.norm(V.lerp(A.dir0, A.dir1, e));
            B.pos = V.add(A.P, V.mul(dir, r));
            B.yaw = A.a.yaw + (A.yaw1 - A.a.yaw) * e; B.pitch = A.a.pitch + (A.pitch1 - A.a.pitch) * e;
            ctx.camDirty = true;
            if (u >= 1) { if (A.endPos) { B.pos = A.endPos.slice(); B.yaw = A.yaw1; B.pitch = A.pitch1; } B.anim = null; }
        } else if (B.inertia) {
            const I = B.inertia, k = Math.exp(-dt / 0.32);
            orbit({ pos: B.pos, yaw: B.yaw, pitch: B.pitch, pivot: I.pivot }, I.vy * dt, I.vp * dt);
            I.vy *= k; I.vp *= k;
            if (Math.hypot(I.vy, I.vp) < 0.02) B.inertia = null;
        }
        updateZoom();
    }
    function moving() { return !!(B.anim || B.inertia || B.gest); }
    // (ein per Tipp gesetzter Fokus gilt, bis sich die Kamera bewegt; danach wieder Auto-Fokus auf die Bildmitte)
    function home() {
        B.pos = HOME.pos.slice(); B.yaw = HOME.yaw; B.pitch = HOME.pitch; B.anim = null; B.inertia = null; B.limit = false;
        ctx.camDirty = true; updateZoom();
    }
    function invalidate() { B.key = ''; }

    // ---------------- GPU
    let FLOAT = null;
    const T = { mot: null, acc: null, tmp: null };     // Ziele: { w, h, tex: [3], fbo }
    function target(w, h) {
        const g = gl();
        const tex = [], fbo = g.createFramebuffer();
        g.bindFramebuffer(g.FRAMEBUFFER, fbo);
        for (let i = 0; i < 3; i++) {
            const tx = g.createTexture();
            g.bindTexture(g.TEXTURE_2D, tx);
            g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA16F, w, h);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
            g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0 + i, g.TEXTURE_2D, tx, 0);
            tex.push(tx);
        }
        g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1, g.COLOR_ATTACHMENT2]);
        const ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        if (!ok) { tex.forEach(x => g.deleteTexture(x)); g.deleteFramebuffer(fbo); return null; }
        return { w, h, tex, fbo };
    }
    function freeTarget(x) { if (!x || R.lost) return; const g = gl(); x.tex.forEach(t => g.deleteTexture(t)); g.deleteFramebuffer(x.fbo); }
    function ensure(name, w, h) {
        const x = T[name];
        if (x && x.w === w && x.h === h) return x;
        freeTarget(x);
        T[name] = target(w, h);
        return T[name];
    }
    function reset() { T.mot = T.acc = T.tmp = null; B.still = null; B.key = ''; FLOAT = null; B.fence = null; }
    // Kann die neue Darstellung laufen? (Float-Renderziel + Shader übersetzt); sonst Rückfall auf presentBulb (6.x)
    function ready() {
        if (B.ok === false) return false;
        const g = gl();
        if (FLOAT === null) FLOAT = !!g.getExtension('EXT_color_buffer_float');
        if (!FLOAT || Q.get('bulb') === '0') { B.ok = false; B.why = FLOAT ? 'param' : 'float'; return false; }
        try {
            if (!R.programReady('bulb7', BULB_FS) || !R.programReady('bulb7post', POST_FS)) return null;
        } catch (e) {
            B.ok = false; B.why = 'shader';
            toast(t('shader_fallback'), 4500);
            return false;
        }
        if (B.ok !== true) { B.ok = true; emit('fly'); }      // Bedienung neu abgleichen (✈-Knopf erscheint, sobald der Flug geht)
        return true;
    }
    // Stufen je Gerät/Qualität: Bewegung (Skala adaptiv bis sMax) und Ruhebild (Mittelung)
    function tier() {
        const q = S.quality;
        // Bewegung: ohne weiche Schatten (Akku/Ausgewogen), wenige AO-Proben, gröberes Treffer-Epsilon, weniger Schritte
        if (q === 'eco') return { sMax: 0.5, sMin: 0.25, shM: 5, aoM: 2, shS: 24, aoS: 4, K: 6, stepsM: 72, stepsS: 200, epsM: 1.6 };
        if (q === 'max') return { sMax: 0.85, sMin: 0.3, shM: 12, aoM: 3, shS: 64, aoS: 6, K: 24, stepsM: 120, stepsS: 340, epsM: 1.0 };
        return { sMax: 0.7, sMin: 0.28, shM: 7, aoM: 2, shS: 40, aoS: 5, K: 12, stepsM: 90, stepsS: 260, epsM: 1.3 };
    }
    // Uniforms des Marsch-Pass (o: { W, H, x, y, jit, still, k })
    function setMarch(L, o, lk) {
        const g = gl(), cb = camBasis(), tr = tier();
        const zoom = B.zoom;
        g.uniform4f(L.u_vp, o.x || 0, o.y || 0, o.W, o.H);
        g.uniform2f(L.u_jit, o.jit ? o.jit[0] : 0, o.jit ? o.jit[1] : 0);
        g.uniform3f(L.u_ro, B.pos[0], B.pos[1], B.pos[2]);
        g.uniform3fv(L.u_fw, cb.fw); g.uniform3fv(L.u_rt, cb.rt); g.uniform3fv(L.u_up, cb.up);
        g.uniform1f(L.u_tanF, Math.tan(B.fov / 2));
        g.uniform1f(L.u_power, B.power);
        g.uniform1i(L.u_iter, iterFor(zoom) + (o.still ? 2 : 0));
        const lz = Math.log10(Math.max(1, zoom));
        g.uniform1i(L.u_steps, Math.round((o.still ? tr.stepsS : tr.stepsM) * (1 + (o.still ? 0.25 : 0.12) * lz)));
        g.uniform1i(L.u_shN, o.still ? tr.shS : tr.shM);
        g.uniform1i(L.u_aoN, o.still ? tr.aoS : tr.aoM);
        g.uniform1i(L.u_julia, B.julia ? 1 : 0);
        g.uniform3fv(L.u_jc, B.jc);
        g.uniform1f(L.u_bound, boundOf(B));
        g.uniform1f(L.u_epsK, o.still ? 0.5 : tr.epsM);
        g.uniform1f(L.u_stepK, B.power < 4 || B.julia ? 0.75 : 0.9);
        g.uniform1f(L.u_scale, Math.max(1e-9, B.dSurf * 1.1));
        g.uniform1i(L.u_style, S.bulbStyle);
        g.uniform1i(L.u_outM, lk.outM || 0);
        g.uniform1f(L.u_outW, (lk.outW || 24) * (o.W / canvas.width));
        g.uniform1f(L.u_fog, S.bulbFog);
        g.uniform1f(L.u_seed, o.k || 0);
        if (o.still && S.bulbDof > 0) {
            const lr = lensSample(o.k || 0);
            const fd = B.focus > 0 ? B.focus : centerDist();
            g.uniform4f(L.u_lens, lr[0], lr[1], fd * 0.02 * S.bulbDof, fd);
        } else g.uniform4f(L.u_lens, 0, 0, 0, 0);
        // Taylor-Anker
        const A = anchorNow();
        g.uniform1i(L.u_tay, A ? 1 : 0);
        if (A) {
            g.uniform3f(L.u_d0, B.pos[0] - A.P0[0], B.pos[1] - A.P0[1], B.pos[2] - A.P0[2]);
            g.uniform3fv(L.u_P0, A.P0); g.uniform3fv(L.u_K, A.K);
            g.uniformMatrix3fv(L.u_J, false, new Float32Array(A.J));
            const h = new Float32Array(27); h.set(A.H[0], 0); h.set(A.H[1], 9); h.set(A.H[2], 18);
            g.uniformMatrix3fv(L.u_H, false, h);
            g.uniform1f(L.u_tayR, A.R);
            g.uniform1f(L.u_dr1, A.dr1);
        }
    }
    // Abstand zur Oberfläche in der Bildmitte (Auto-Fokus der Tiefenunschärfe), je Kamerastand einmal
    let CD = { key: '', d: 1 };
    function centerDist() {
        const k = B.pos.join(',') + B.yaw + ',' + B.pitch + ',' + B.power;
        if (CD.key !== k) { const r = rayAt(ctx.cssW / 2, ctx.cssH / 2), h = marchJS(r.ro, r.rd, params(), r.pix); CD = { key: k, d: h.hit ? h.t * V.dot(r.rd, camBasis().fw) : B.dSurf }; }
        return CD.d;
    }
    let ANC = null;
    function anchorNow() {
        if (B.zoom < 60 || Q.get('bulbtay') === '0') { ANC = null; return null; }
        // Anker = Oberfläche in der Bildmitte (sonst Punkt im Abstand der Oberfläche); neu, wenn er aus dem halben Gültigkeitsradius läuft
        const R0 = 6e-4;
        const center = (() => { const r = rayAt(ctx.cssW / 2, ctx.cssH / 2); const h = marchJS(r.ro, r.rd, params(), r.pix); return h.hit ? h.p : V.add(B.pos, V.mul(r.rd, B.dSurf)); })();
        const key = [B.power, B.julia, B.jc.join(',')].join('|');
        if (!ANC || ANC.key !== key || V.len(V.sub(ANC.P0, center)) > R0 * 0.25) {
            // P0 in float32 darstellbar wählen (dann ist c = P0 + δ im Shader exakt der Anker)
            const P0 = Array.from(new Float32Array(center));
            ANC = Object.assign(anchorJS(P0, { power: B.power, julia: B.julia, jc: B.jc }), { key, R: R0 });
        }
        return ANC;
    }
    const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
    function lensSample(k) { const a = 2 * Math.PI * halton(k + 1, 3), r = Math.sqrt(halton(k + 1, 2)); return [r * Math.cos(a), r * Math.sin(a)]; }
    function drawMarch(fb, w, h, o, lk, scissor) {
        const g = gl(), pr = R.program('bulb7', BULB_FS);
        g.useProgram(pr.p);
        g.bindFramebuffer(g.FRAMEBUFFER, fb.fbo);
        g.viewport(0, 0, w, h);
        if (scissor) { g.enable(g.SCISSOR_TEST); g.scissor(scissor[0], scissor[1], scissor[2], scissor[3]); }
        setMarch(pr.loc, o, lk);
        g.drawArrays(g.TRIANGLES, 0, 3);
        if (scissor) g.disable(g.SCISSOR_TEST);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        R.submitted = (R.submitted || 0) + 1;
    }
    // POST: Quelle a (und b mit Überblendung mix) ins Ziel (null = Canvas)
    function drawPost(a, aw, ah, b, bw, bh, mix, lk, out, vp) {
        const g = gl(), pr = R.program('bulb7post', POST_FS), L = pr.loc;
        g.useProgram(pr.p);
        g.bindFramebuffer(g.FRAMEBUFFER, out ? out.fbo : null);
        const ow = out ? out.w : canvas.width, oh = out ? out.h : canvas.height;
        g.viewport(0, 0, ow, oh);
        const bind = (u, tx, unit) => { g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, tx); g.uniform1i(L[u], unit); };
        bind('u_s0', a.tex[0], 0); bind('u_s1', a.tex[1], 1); bind('u_s2', a.tex[2], 2);
        const bb = b || a;
        bind('u_t0', bb.tex[0], 3); bind('u_t1', bb.tex[1], 4); bind('u_t2', bb.tex[2], 5);
        g.uniform4f(L.u_sr, aw, ah, a.w, a.h);
        g.uniform4f(L.u_tr, b ? bw : aw, b ? bh : ah, bb.w, bb.h);
        g.uniform1f(L.u_mix, b ? mix : 0);
        g.uniform2f(L.u_res, ow, oh);
        g.uniform4f(L.u_vp, vp ? vp[0] : 0, vp ? vp[1] : 0, vp ? vp[2] : ow, vp ? vp[3] : oh);
        g.uniform1i(L.u_style, S.bulbStyle);
        g.uniform1f(L.u_density, lk.density);
        g.uniform1f(L.u_expo, 1.3);
        R.setPalette(L, lk);
        g.drawArrays(g.TRIANGLES, 0, 3);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        g.activeTexture(g.TEXTURE0);
    }
    // Schlüssel: Änderung = neu marschieren (Kamera, Parameter, Größe, Qualität, Stil, Außen); Palette/Farbzyklus nur POST
    function marchKey(lk) {
        return [B.pos.join(','), B.yaw, B.pitch, B.power, B.julia, B.jc.join(','), S.bulbStyle, S.bulbFog, S.bulbDof, B.focus, canvas.width, canvas.height, S.quality, lk.outM, Math.round(lk.outW)].join('|');
    }
    // ---------------- Bild je App-Takt
    let lastPost = '';
    const ROWS = +(Q.get('bulbrows') || 0);      // Test: feste Streifenhöhe der Mittelung
    const KFIX = +(Q.get('bulbk') || 0);         // Test: feste Zahl gemittelter Bilder
    const SLOW = Math.max(1, +(Q.get('bulbslow') || 1));   // Test: langsamere GPU simulieren (Marsch-Pass n-mal)
    function present(now, camChanged) {
        const rd = ready();
        if (rd !== true) {
            // Rückfall (6.x) bzw. solange die Shader übersetzt werden
            const lc = legacyCam();
            R.presentBulb({ cx: HP.fromNumber(lc.rot[0]), cy: HP.fromNumber(lc.rot[1]), zoom: lc.zoom }, look());
            return;
        }
        const lk = look(), cw = canvas.width, ch = canvas.height;
        const key = marchKey(lk);
        const mov = moving() || (ctx.FLY.on && !ctx.FLY.paused) || (S.bulbBreathe && S.anim && !RM()) || camChanged;
        const tr = tier();
        if (key !== B.key || mov) {
            // Bewegungsbild in angepasster Auflösung; Skala folgt der Bildrate (≥ 30 Bilder/s auf dem Mittelklasse-Gerät)
            const dtm = ctx.RC.dtEMA || 16;
            if (B.key && key !== B.key) {
                if (dtm > 24) B.scaleM = Math.max(tr.sMin, B.scaleM * 0.9);
                else if (dtm < 18.5) B.scaleM = Math.min(tr.sMax, B.scaleM * 1.04);
            }
            B.scaleM = Math.max(tr.sMin, Math.min(tr.sMax, B.scaleM));
            const w = Math.max(16, Math.round(cw * B.scaleM)), h = Math.max(16, Math.round(ch * B.scaleM));
            const mt = ensure('mot', Math.round(cw * tr.sMax) + 2, Math.round(ch * tr.sMax) + 2);
            if (!mt) { B.ok = false; B.why = 'fbo'; return; }
            for (let r = 0; r < SLOW; r++) drawMarch(mt, w, h, { W: w, H: h, still: false }, lk);
            B.mot = { w, h };
            if (B.key && B.focusKey !== key.split('|').slice(0, 3).join('|')) B.focus = 0;
            B.focusKey = key.split('|').slice(0, 3).join('|');
            B.key = key;
            B.still = { k: 0, row: 0, t0: now + 90, K: KFIX || tr.K, done: false, shown: false };
            B.stillWait = now;
            drawPost(mt, w, h, null, 0, 0, 0, lk);
            lastPost = '';
            B.info = { scale: B.scaleM, w, h, still: 0, K: tr.K };
            return;
        }
        // Stillstand: Mittelung in voller Auflösung, in Streifen (Häppchen) über mehrere Bilder
        const st = B.still;
        if (st && !st.done && now - B.stillWait > 90) {
            const acc = ensure('acc', cw, ch);
            if (!acc) { B.ok = false; B.why = 'fbo'; return; }
            // Häppchen-Größe nach der GPU: ist der Streifen des letzten Bilds schon fertig (Fence), darf es mehr sein; sonst
            // weniger, und dieses Bild bleibt frei (kein GPU-Stau, Gesten bleiben flüssig – unabhängig von der Bildrate)
            const g = gl();
            if (!B.rows) B.rows = Math.max(16, Math.round(ch / 8));
            if (B.fence) {
                const done = g.getSyncParameter(B.fence, g.SYNC_STATUS) === g.SIGNALED;
                if (!done) { B.rows = Math.max(8, Math.round(B.rows * 0.7)); B.fenceWait = (B.fenceWait || 0) + 1; if (B.fenceWait < 6) return postOnly(now, lk, st); }
                g.deleteSync(B.fence); B.fence = null; B.fenceWait = 0;
                if (done) B.rows = Math.min(ch, Math.round(B.rows * 1.15) + 1);
            }
            if (ROWS) B.rows = ROWS;
            const k = st.k, rows = Math.min(B.rows, ch - st.row);
            const jit = k === 0 ? [0, 0] : [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5];
            if (k > 0) { g.enable(g.BLEND); g.blendFunc(g.CONSTANT_ALPHA, g.ONE_MINUS_CONSTANT_ALPHA); g.blendColor(0, 0, 0, 1 / (k + 1)); }
            for (let r = 0; r < SLOW; r++) {
                if (r > 0) { g.enable(g.BLEND); g.blendFunc(g.ZERO, g.ONE); }      // Simulation: Mehrarbeit ohne Wirkung
                drawMarch(acc, cw, ch, { W: cw, H: ch, still: true, jit, k }, lk, [0, st.row, cw, rows]);
                if (r > 0) g.disable(g.BLEND);
            }
            if (k > 0) g.disable(g.BLEND);
            B.fence = g.fenceSync(g.SYNC_GPU_COMMANDS_COMPLETE, 0);
            st.row += rows;
            if (st.row >= ch) {
                st.row = 0; st.k++;
                // Zahl der Durchgänge nach der Dauer des ersten: fertig nach ≈ 2 s auf jedem Gerät (höchstens K der Stufe, mind. 3)
                if (st.k === 1 && !KFIX) { st.t1 = now - st.t0; st.K = Math.max(6, Math.min(st.K, Math.round(2500 / Math.max(1, st.t1)))); }
                if (st.k >= st.K) { st.done = true; st.tDone = now; }
            }
            B.info = { scale: 1, w: cw, h: ch, still: st.k, K: st.K, rows: B.rows };
        }
        postOnly(now, lk, st);
    }
    function postOnly(now, lk, st) {
        const cw = canvas.width, ch = canvas.height;
        const showAcc = st && (st.k >= 1);
        if (showAcc && !st.shown) { st.shown = true; st.tShow = now; }
        const fade = showAcc ? Math.min(1, (now - st.tShow) / 180) : 0;
        const pk = [lk.cycle, lk.density, lk.pal.id, st ? st.k + ':' + st.row : '', fade, cw, ch].join('|');
        if (pk === lastPost && !(st && !st.done)) return;
        lastPost = pk;
        if (showAcc && fade >= 1) drawPost(T.acc, cw, ch, null, 0, 0, 0, lk);
        else if (showAcc) drawPost(T.mot, B.mot.w, B.mot.h, T.acc, cw, ch, fade, lk);
        else drawPost(T.mot, B.mot.w, B.mot.h, null, 0, 0, 0, lk);
    }
    function legacyCam() {
        // Rückfall-Shader: Drehung aus Gieren/Nicken, Abstand aus der Kameraposition
        return { rot: [-B.yaw / 3, B.pitch / 3], zoom: 2.5 / Math.max(0.3, V.len(B.pos)) };
    }

    // ---------------- Flug (Etappe 4): ✈ taucht an der Oberfläche entlang in die Tiefe
    // Die Kamera fliegt auf einen Zielpunkt T auf der Oberfläche zu (Abstand schrumpft um FLY.sp Zehnerpotenzen/s – endloser
    // Zoom wie in 2D), T gleitet weich zu „interessanten“ Stellen (Sonde: 3×3 Strahlen um die Bildmitte, Wertung nach
    // Strukturdichte = Marsch-Schritte bis zum Treffer, Nähe zur Bildmitte, Schrägsicht). Der Blick folgt T gedämpft; die
    // Kamera hält eine Schrägsicht (~40° zur Normale) statt senkrecht hinabzustürzen. Kollision: Mindestabstand zur Oberfläche
    // (Distanzschätzung an der Kamera) – zu nah, dann weicht sie entlang der Normale aus. An der Genauigkeitsgrenze gleitet sie
    // in gleichem Abstand weiter. Rückwärts: auf dem aufgezeichneten Weg (je 1/100 Zehnerpotenz Position und Blick), ohne Weg
    // vom Ziel weg bis zur Übersicht („Ganz draußen“). Ziehen = um T herum lenken, Tippen = Pause (app.js).
    const F = { T: null, Tg: null, tProbe: 0, trail: [], score: 0, glide: false };
    function canFly() { return ready() === true; }
    function nrmAt(p) {
        const P = params(), h = Math.max(1e-9, deJS(p, P) * 0.2 + minDist() * 0.1);
        const d = (e) => deJS(V.add(p, e), P) - deJS(V.sub(p, e), P);
        return V.norm([d([h, 0, 0]), d([0, h, 0]), d([0, 0, h])]);
    }
    // Sonde: 5×5 Strahlen um die Bildmitte. Wertung: Rauheit (Tiefensprünge zu den Nachbarn – Kerben, Knospen, Ränder statt
    // glatter „Sahne“), Strukturdichte (Schritte), Nähe zur Mitte, nicht viel tiefer als das jetzige Ziel. Neues Ziel nur, wenn
    // deutlich besser (Hysterese) oder das alte erreicht ist.
    function probe(now) {
        F.tProbe = now;
        const W = ctx.cssW, H = ctx.cssH, mn = Math.min(W, H), N = 5, st = mn * 0.11;
        const D = V.len(V.sub(B.pos, F.T));
        const g = [];
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) g.push(pick(W / 2 + (i - 2) * st, H / 2 + (j - 2) * st));
        let best = null;
        for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
            const h = g[j * N + i];
            if (!h || h.t > D * 2.2) continue;
            let rough = 0, nn = 0;
            for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = g[(j + b) * N + i + a]; rough += q ? Math.min(1, Math.abs(q.t - h.t) / h.t * 4) : 1; nn++; }
            rough /= nn;
            const c = Math.hypot(i - 2, j - 2);
            const sc = rough + 0.3 * Math.min(1, h.steps / 80) - 0.22 * c - (h.t < D * 0.35 ? 0.6 : 0);
            if (!best || sc > best.sc) best = { p: h.p, sc };
        }
        if (best && (!F.Tg || best.sc > F.score + 0.15 || V.len(V.sub(F.Tg, F.T)) < D * 0.03)) { F.Tg = best.p; F.score = best.sc; }
        else if (F.Tg) F.score *= 0.97;     // altes Ziel verliert langsam an Wert
    }
    function startFly(place) {
        const FLY = ctx.FLY;
        if (!canFly()) return false;
        B.anim = null; B.inertia = null;
        if (place && place.b) { tourTo(place.b, 6); FLY.mode = 'bulbtour'; }
        else {
            const h = pick(ctx.cssW / 2, ctx.cssH / 2) || pick(ctx.cssW / 2, ctx.cssH * 0.4) || pick(ctx.cssW / 2, ctx.cssH * 0.6);
            F.T = h ? h.p : V.mul(V.norm(B.pos), 1.0);
            F.Tg = F.T; F.score = 0; F.tProbe = 0; F.glide = false;
            FLY.mode = 'bulb';
            const te = F.trailEnd;
            if (!te || V.len(V.sub(te, B.pos)) > 1e-12) F.trail = [];
        }
        return true;
    }
    function trailRec() {
        const lz = Math.log10(B.zoom), tr = F.trail;
        while (tr.length && tr[tr.length - 1].lz > lz + 1e-9) tr.pop();
        if (!tr.length || lz - tr[tr.length - 1].lz >= 0.01) tr.push({ lz, pos: B.pos.slice(), yaw: B.yaw, pitch: B.pitch, T: F.T.slice() });
    }
    function flyUpdate(now, dt) {
        const FLY = ctx.FLY;
        if (FLY.mode === 'bulbtour') { if (!B.anim) { ctx.stopFly(); } return; }
        if (!F.T) return;
        const sp = FLY.sp || 0;
        const D = V.len(V.sub(B.pos, F.T));
        if (sp < 0) {
            // rückwärts: auf dem Weg des Hinflugs (Position/Blick je log10 Zoom interpoliert), sonst vom Ziel weg
            const lz = Math.log10(Math.max(1e-9, B.zoom)), lz2 = lz + sp * dt, tr = F.trail;
            if (tr.length >= 2 && lz2 >= tr[0].lz && lz2 <= tr[tr.length - 1].lz + 0.02) {
                let k = tr.length - 1; while (k > 0 && tr[k - 1].lz > lz2) k--;
                const a = tr[Math.max(0, k - 1)], b = tr[k], u = b.lz > a.lz ? Math.max(0, Math.min(1, (lz2 - a.lz) / (b.lz - a.lz))) : 0;
                B.pos = V.lerp(a.pos, b.pos, u); B.yaw = a.yaw + angD(b.yaw, a.yaw) * u; B.pitch = a.pitch + (b.pitch - a.pitch) * u; F.T = V.lerp(a.T, b.T, u); F.Tg = F.T;
                while (tr.length > 1 && tr[tr.length - 1].lz > lz2 + 0.02) tr.pop();
            } else {
                const dir = V.norm(V.sub(B.pos, F.T));
                setPos(V.add(F.T, V.mul(dir, D * Math.pow(10, -sp * dt))));
                lookAt(F.T, dt, 2.5);
            }
            ctx.camDirty = true;
            updateZoom();
            if (B.zoom <= 1.02) { FLY.out = true; ctx.setFlySpeed(0); toast(t('fly_out'), 2000); }
            return;
        }
        if (now - F.tProbe > 250) probe(now);
        // Ziel gleitet weich zur gewählten Stelle (höchstens 0,5 Abstände je Sekunde)
        const d = V.sub(F.Tg, F.T), dl = V.len(d), mx = 0.3 * D * dt * Math.max(0.3, Math.abs(sp) / 0.5);
        if (dl > 0) F.T = V.add(F.T, V.mul(d, Math.min(1, mx / dl)));
        // Abstand: um sp Zehnerpotenzen/s kleiner; an der Grenze gleiten (gleicher Abstand)
        let Dn = D * Math.pow(10, -sp * dt);
        const lim = minDist() * 1.6;
        F.glide = Dn < lim;
        if (F.glide) Dn = Math.max(D, lim);
        // Schrägsicht: Richtung Ziel->Kamera dreht langsam auf ~40° zur Normale
        const n = nrmAt(F.T);
        let dir = V.norm(V.sub(B.pos, F.T));
        const cn = V.dot(dir, n);
        const tang = V.norm(V.sub(dir, V.mul(n, cn)));
        const ideal = V.norm(V.add(V.mul(n, 0.87), V.mul(V.len(tang) > 1e-6 ? tang : [1, 0, 0], 0.5)));
        dir = V.norm(V.lerp(dir, ideal, Math.min(1, dt * 0.35)));
        let np = V.add(F.T, V.mul(dir, Dn));
        // Kollision: Abstand zur Oberfläche an der Kamera mindestens 12 % des Zielabstands (sonst entlang der Normale weg)
        const P = params();
        for (let k = 0; k < 6 && deJS(np, P) < 0.12 * Dn; k++) np = V.add(np, V.mul(nrmAt(np), 0.06 * Dn));
        B.pos = np;
        lookAt(F.T, dt, 3);
        ctx.camDirty = true;
        updateZoom();
        trailRec();
    }
    const angD = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    // Blick gedämpft auf einen Punkt (Gieren/Nicken)
    function lookAt(P, dt, k) {
        const dir = V.norm(V.sub(P, B.pos));
        const yaw = Math.atan2(dir[0], dir[2]), pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
        const a = Math.min(1, dt * k);
        B.yaw += angD(yaw, B.yaw) * a; B.pitch += (Math.max(-1.45, Math.min(1.45, pitch)) - B.pitch) * a;
    }
    // Lenken im Flug: Ziehen dreht die Kamera um das Ziel (wie die Orbit-Geste), das Ziel wird danach neu gesucht
    function flySteer(dx, dy) {
        if (!F.T) return;
        const k = Math.PI / Math.max(320, ctx.cssW) * 0.9;
        orbit({ pos: B.pos, yaw: B.yaw, pitch: B.pitch, pivot: F.T }, dx * k, -dy * k);
        F.tProbe = 0; F.score = -9;
    }
    function flyStopped() { F.trailEnd = B.pos.slice(); }
    // Rundflug zu einem gespeicherten Zustand (Orte ▶/✈): von der Startansicht aus, Ziel wird exakt erreicht
    function tourTo(st, dur) {
        const cam = parseState(st);
        if (!cam) return;
        Object.assign(B, { power0: cam.power, power: cam.power, julia: cam.julia, jc: cam.jc });
        B.pos = HOME.pos.slice(); B.yaw = HOME.yaw; B.pitch = HOME.pitch;
        updateZoom();
        const cb = basisOf(cam.yaw, cam.pitch);
        const P = params();
        const r = marchJS(cam.pos, cb.fw, P, 1e-4);
        const Q = r.hit ? r.p : V.add(cam.pos, V.mul(cb.fw, 0.1));
        animTo(Q, cam.pos, cam.yaw, cam.pitch, dur);
    }
    function basisOf(yaw, pitch) { const cp = Math.cos(pitch); return { fw: [cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)] }; }
    // Fahrt um einen Bezugspunkt Q: Abstand logarithmisch, Richtung von Q aus gedreht, Blick interpoliert -> exakt am Ziel
    function animTo(Q, endPos, yaw1, pitch1, dur) {
        const a = { pos: B.pos, yaw: B.yaw, pitch: B.pitch };
        let dy = yaw1 - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        B.anim = { t0: performance.now(), dur: dur * 1000, a, P: Q, la: Math.log(V.len(V.sub(a.pos, Q))), lb: Math.log(V.len(V.sub(endPos, Q))),
                   dir0: V.norm(V.sub(a.pos, Q)), dir1: V.norm(V.sub(endPos, Q)), yaw1: a.yaw + dy, pitch1, endPos };
    }
    // ---------------- Zustand für Link und Orte: Position (x,y,z), Gieren, Nicken; Exponent; Julia-c
    const f10 = (v) => (+v).toPrecision(12).replace(/\.?0+(e|$)/, '$1');
    function stateString() {
        return [B.pos[0], B.pos[1], B.pos[2], B.yaw, B.pitch].map(f10).join(',') + ';' + f10(B.power0) + (B.julia ? ';' + B.jc.map(f10).join(',') : '');
    }
    function parseState(str) {
        if (!str) return null;
        const [a, pw, jc] = String(str).split(';');
        const v = a.split(',').map(Number);
        if (v.length < 5 || v.some(x => !isFinite(x))) return null;
        const j = jc ? jc.split(',').map(Number) : null;
        return { pos: v.slice(0, 3), yaw: v[3], pitch: Math.max(-1.45, Math.min(1.45, v[4])), power: Math.max(2, Math.min(16, +pw || 8)),
                 julia: !!(j && j.length === 3 && j.every(isFinite)), jc: j && j.length === 3 ? j : B.jc };
    }
    function applyState(str) {
        const c = parseState(str);
        if (!c) return false;
        B.pos = c.pos; B.yaw = c.yaw; B.pitch = c.pitch; B.power0 = B.power = c.power; B.julia = c.julia; B.jc = c.jc;
        B.anim = null; B.inertia = null; ctx.camDirty = true; invalidate(); updateZoom();
        return true;
    }
    // Links bis 6.9 (m=6, x/y = Drehung, z = Abstand): Blick auf den Ursprung aus dieser Richtung
    function applyLegacy(x, y, z) {
        const yaw = x * 3, pitch = Math.max(-1.4, Math.min(1.4, -y * 3)), d = 2.75 / Math.max(0.3, z || 1);
        const fw = basisOf(yaw, pitch).fw;
        B.pos = V.mul(fw, -d); B.yaw = yaw; B.pitch = pitch; B.anim = null; ctx.camDirty = true; updateZoom();
    }

    // ---------------- Screenshot in Kacheln (6.8.1-Kachel-Rendern): gleiche Kamera, Ausschnitt des ganzen Bilds je Kachel
    // (u_vp), Mittelung wie im Ruhebild (Subpixel-Versatz im ganzen Bild, Linse), in Streifen über App-Bilder verteilt.
    // Jeder Bildpunkt wird genau wie im Bild aus einem Stück gerechnet -> bitgleich.
    function capTile(C, T, tile, ct) {
        const P = C.P, g = gl(), lk = C.look || look();
        if (T.st === 'start') {
            T.tg = ensure('cap', tile.w, tile.h);
            if (!T.tg) throw new Error('fbo');
            T.k = 0; T.row = 0; T.K = P.bulbK || 12; T.st = 'acc';
        }
        if (T.st === 'acc') {
            const rows = Math.min(T.rows || 256, tile.h - T.row);
            const jit = T.k === 0 ? [0, 0] : [halton(T.k + 1, 2) - 0.5, halton(T.k + 1, 3) - 0.5];
            if (T.k > 0) { g.enable(g.BLEND); g.blendFunc(g.CONSTANT_ALPHA, g.ONE_MINUS_CONSTANT_ALPHA); g.blendColor(0, 0, 0, 1 / (T.k + 1)); }
            drawMarch(T.tg, tile.w, tile.h, { W: P.W, H: P.H, x: tile.gx, y: tile.gy, still: true, jit, k: T.k }, lk, [0, T.row, tile.w, rows]);
            if (T.k > 0) g.disable(g.BLEND);
            T.row += rows;
            if (T.row >= tile.h) { T.row = 0; T.k++; }
            C.sub = (T.k + T.row / tile.h) / (T.K + 1);
            if (T.k >= T.K) T.st = 'post';
            return false;
        }
        drawPost(T.tg, tile.w, tile.h, null, 0, 0, 0, lk, ct, [tile.gx, tile.gy, P.W, P.H]);
        T.st = 'read';
        return true;
    }
    // Messung (Tests): GPU-Zeit eines Bewegungsbilds (Skala s) bzw. eines Ruhebild-Durchgangs in voller Auflösung, Median aus n
    function bench(s, still, n) {
        const g = gl(), ext = g.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext || ready() !== true) return Promise.resolve(null);
        const lk = look(), cw = canvas.width, ch = canvas.height;
        const w = Math.round(cw * s), h = Math.round(ch * s);
        const tg = still ? ensure('acc', cw, ch) : ensure('mot', Math.round(cw * tier().sMax) + 2, Math.round(ch * tier().sMax) + 2);
        const qs = [];
        for (let i = 0; i < (n || 5); i++) {
            const q = g.createQuery(); g.beginQuery(ext.TIME_ELAPSED_EXT, q);
            drawMarch(tg, still ? cw : w, still ? ch : h, { W: still ? cw : w, H: still ? ch : h, still: !!still, k: i }, lk);
            g.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q);
        }
        B.key = '';
        return new Promise((res) => { const poll = () => { if (!qs.every(q => g.getQueryParameter(q, g.QUERY_RESULT_AVAILABLE))) { setTimeout(poll, 20); return; }
            const ms = qs.map(q => g.getQueryParameter(q, g.QUERY_RESULT) / 1e6).sort((a, b) => a - b); qs.forEach(q => g.deleteQuery(q));
            res({ ms: +ms[ms.length >> 1].toFixed(2), w: still ? cw : w, h: still ? ch : h }); }; poll(); });
    }
    // ein Bild ohne Neuberechnung (Überblendung, Screenshot des Bildschirms): POST aus dem letzten Stand
    function redraw() { lastPost = ''; present(performance.now(), false); }
    return {
        B, G, V, update, present, redraw, bench, startFly, flyUpdate, flySteer, flyStopped, canFly, stateString, applyState, applyLegacy, tourTo, capTile,
        capK: () => Math.max(8, tier().K),
        flyInfo: () => ({ T: F.T, Tg: F.Tg, glide: F.glide, trail: F.trail.length }), moving, home, invalidate, reset, ready, pick, camBasis, rayAt, pivotNow, flyToPoint, setPos, orbit,
        params, iterFor, minDist, zoomToward,
        info: () => Object.assign({ ok: B.ok, why: B.why, zoom: B.zoom, dSurf: B.dSurf, iter: iterFor(B.zoom), limit: B.limit, anchor: !!ANC && B.zoom >= 60 }, B.info),
        link() { ({ R, S, HP, look, toast, t, emit, canvas } = ctx); Z0 = deJS(HOME.pos, { power: 8, julia: false, jc: [0, 0, 0], iter: 10 }); },
    };
} };
})(typeof self !== 'undefined' ? self : globalThis);
