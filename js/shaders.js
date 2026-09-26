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

// ---------------------------------------------------------------- COMPUTE
function computeFS(formula, mode, err) {
    const F = formula | 0;
    const common = `#version 300 es
#define F ${F}
#define ERR ${err && F !== 5 ? 1 : 0}
${COMMON}
uniform vec2 u_res;        // Puffergröße
uniform float u_scale;     // Weltbreite pro Pufferpixel
uniform int u_maxIter;
layout(location = 0) out uint o_it;

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
    return ERRK * sqrt(E2) * length(Dt) / (r * log(r) * 0.6931472) > 0.7;
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
#if F == 5
    result = newton(pos);
#else
#if F == 1
    vec2 z = pos, c = u_julia;
    vec2 Dt = vec2(u_scale, 0.0);
    if (dot(z, z) > 256.0) result = smoothI(0, z);
#else
    vec2 z = vec2(0.0), c = pos;
    vec2 Dt = vec2(0.0);
#endif
    float E2 = 0.0;
    bool unsure = false;
    if (result < 0.0) for (int n = 1; n <= u_maxIter; n++) {
#if ERR
#if F == 4
        Dt = 3.0 * cmul(cmul(z, z), Dt);
#else
        Dt = 2.0 * cmul(z, Dt);
#endif
#if F != 1
        Dt.x += u_scale;
#endif
        { float q = EPS * (dot(z, z) + length(c) * (n == 1 ? 2.0 : 1.0)) / max(length(Dt), 1e-30); E2 += q * q; }
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
            break;
        }
    }
#if ERR
    if (result < 0.0) unsure = unsureIn(E2, Dt);
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
#if F == 1
    vec2 dz = dc, c = vec2(0.0);
    { vec2 z0 = Zc + dz; if (dot(z0, z0) > 256.0) { o_it = floatBitsToUint(smoothI(0, z0)); return; } }
#else
    vec2 dz = vec2(0.0), c = dc;
#endif
    int m = 0, n = 0;
#if ERR
#if F == 1
    vec2 Dt = vec2(u_scale, 0.0);
#else
    vec2 Dt = vec2(0.0);
#endif
    float E2 = 0.0;
    bool unsure = false;
    float mc = magn(c);
#endif
    for (int guard = 0; guard < 4000000; guard++) {
        if (n >= u_maxIter) break;
${hasBLA ? `        if (u_blaOn != 0 && m > 0) {
            int k = m - 1;
            int L = u_blaL[o];
            int l = (k == 0) ? L : min(L, ctz(k));
            float dmax = max(abs(dz.x), abs(dz.y)) * 1.4142136;
            bool applied = false;
            for (; l >= 1; l--) {
                int st = 1 << l;
                if (m + st > len - 1 || n + st > u_maxIter) continue;
                int e = u_blaOff[o * 24 + l] + (k >> l);
                ivec2 tc = ivec2(e & 2047, e >> 11);
                if (dmax < texelFetch(u_blaR, tc, 0).r) {
                    vec4 ab = texelFetch(u_blaAB, tc, 0);
#if ERR
                    {
                        vec2 nD = cmul(ab.xy, Dt) + ab.zw * u_scale;
                        float den = max(magn(nD), 1e-37);
                        float q = 2.0 * EPS * (length(ab.xy) * (magn(dz) / den) + length(ab.zw) * (mc / den));
                        E2 += q * q; Dt = nD;
                    }
#endif
                    dz = cmul(ab.xy, dz) + cmul(ab.zw, c);
                    m += st; n += st;
                    applied = true;
                    break;
                }
            }
            if (applied) {
                Zc = orb(base + m);
                vec2 z = Zc + dz;
                if (dot(z, z) > 256.0) {
                    result = smoothI(n, z);
#if ERR
                    unsure = unsureEsc(E2, Dt, z);
#endif
                    break;
                }
                if (m >= len - 1 || lessMag(z, dz)) {
#if ERR
                    { float q = EPS * length(Zc) / max(magn(Dt), 1e-37); E2 += q * q; }
#endif
                    o = 1; base = u_baseB; len = u_lenB; dz = z; m = 0; Zc = vec2(0.0);
                }
                continue;
            }
        }` : ''}
        vec2 Z = Zc;
#if ERR
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
            float den = max(magn(Dt), 1e-37);
            float rd = magn(dz) / den;
            float q = EPS * (2.0 * length(Z) * rd + magn(dz) * rd + mc / den);
            E2 += q * q;
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
        if (dot(z, z) > 256.0) {
            result = smoothI(n, z);
#if ERR
            unsure = unsureEsc(E2, Dt, z);
#endif
            break;
        }
        if (m >= len - 1 || lessMag(z, dz)) {
#if ERR
            { float q = EPS * length(Zc) / max(magn(Dt), 1e-37); E2 += q * q; }
#endif
            o = 1; base = u_baseB; len = u_lenB; dz = z; m = 0; Zc = vec2(0.0);
        }
    }
#if ERR
    if (result < 0.0) unsure = unsureIn(E2, Dt);
    o_it = encode(result, unsure);
#else
    o_it = floatBitsToUint(result);
#endif
}`;
}

// ---------------------------------------------------------------- DISPLAY
const DISPLAY_FS = `#version 300 es
${COMMON}
uniform usampler2D u_texA;      // älterer Puffer (Fallback / Crossfade-Quelle)
uniform usampler2D u_texB;      // neuester Puffer
uniform vec4 u_xfA, u_xfB;      // Texel = Zielpixel * xy + zw
uniform vec2 u_sizeA, u_sizeB;
uniform int u_hasA, u_hasB;
uniform float u_mixB;           // Crossfade A -> B
uniform vec2 u_target;          // Zielgröße in Pixeln
uniform int u_formula, u_maxIter;
uniform vec3 u_palA, u_palB, u_palC, u_palD;
uniform int u_palCustom;
uniform vec3 u_custom[6];
uniform float u_cycle, u_density, u_time, u_relief;
uniform int u_particles, u_banded;
out vec4 fragColor;

vec3 palette(float t) {
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

// Iterationswert als Höhe fürs Relief (log staucht die Randzonen)
float heightOf(float v) { return log2(1.0 + max(v, 0.0)); }

// Dekodierung: <= -3 markiert-außen (mu = -v-4), -2 markiert-innen, -1 innen
float fetchV(usampler2D t, ivec2 c) {
    float v = uintBitsToFloat(texelFetch(t, c, 0).r);
    if (v <= -3.0) return -v - 4.0;
    return v < -1.5 ? -1.0 : v;
}

// bilinear eingefärbte Probe eines Iterationspuffers; w = Abdeckung (0 = ausserhalb)
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
    float v00 = fetchV(tex, i0), v10 = fetchV(tex, ivec2(i1.x, i0.y));
    float v01 = fetchV(tex, ivec2(i0.x, i1.y)), v11 = fetchV(tex, i1);
    vec3 c00 = v00 < 0.0 ? voidCol : exteriorColor(v00);
    vec3 c10 = v10 < 0.0 ? voidCol : exteriorColor(v10);
    vec3 c01 = v01 < 0.0 ? voidCol : exteriorColor(v01);
    vec3 c11 = v11 < 0.0 ? voidCol : exteriorColor(v11);
    vec3 col = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    if (u_relief > 0.0 && u_formula != 5 && v00 >= 0.0 && v10 >= 0.0 && v01 >= 0.0 && v11 >= 0.0) {
        float h00 = heightOf(v00), h10 = heightOf(v10), h01 = heightOf(v01), h11 = heightOf(v11);
        vec2 g = vec2(mix(h10 - h00, h11 - h01, f.y), mix(h01 - h00, h11 - h10, f.x));
        g /= max(xf.x, 1e-6);                 // Gradient pro Texel -> pro Zielpixel normieren
        g *= 6.0 * u_relief;
        vec3 nrm = normalize(vec3(-g, 1.0));
        vec3 L = normalize(vec3(-0.6, 0.7, 0.9));
        float diff = max(dot(nrm, L), 0.0);
        float spec = pow(max(dot(reflect(-L, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
        float shade = mix(1.0, 0.35 + 0.85 * diff, clamp(u_relief, 0.0, 1.0));
        col = col * shade + vec3(spec) * 0.35 * u_relief;
    }
    return col;
}

vec3 voidColor() {
    vec3 bg = vec3(0.0, 0.0, 0.015);
    if (u_particles == 0) return bg;
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
    return bg + sparkle * pc * 0.35;
}

void main() {
    vec3 vc = voidColor();
    vec3 col = vec3(0.012, 0.016, 0.04);
    float wa = 0.0, wb = 0.0;
    vec3 ca = vec3(0.0), cb = vec3(0.0);
    if (u_hasA == 1) ca = sampleLayer(u_texA, u_sizeA, u_xfA, vc, wa);
    if (u_hasB == 1) cb = sampleLayer(u_texB, u_sizeB, u_xfB, vc, wb);
    if (wa > 0.0) col = ca;
    if (wb > 0.0) col = (wa > 0.0) ? mix(ca, cb, u_mixB) : cb;
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
out uint o_v;
void main() { o_v = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0).r; }`;

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

root.FKShaders = { VS, computeFS, DISPLAY_FS, BULB_FS, BUDDHA_FS, FLAGPACK_FS, SCATTER_VS, SCATTER_FS, COPY_FS };
})(typeof self !== 'undefined' ? self : globalThis);
