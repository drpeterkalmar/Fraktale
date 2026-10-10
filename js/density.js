// density.js — 7.1 Lichtbilder: Dichte-Renderer für Fraktal-Flammen (IFS mit nichtlinearen Variationen, Apophysis/Electric-Sheep-
// Stil) und seltsame Attraktoren (Clifford, De Jong, Svensson, Lorenz). Das Bild ist ein Histogramm: wie oft eine Bahn durch
// jedes Pixel läuft – aufgebaut über die Zeit (progressiv), eingefärbt mit Log-Dichte, Gamma und Vibrancy.
//
// GPU (Standard): N „Wanderer“ (Punkte) liegen in einem Puffer; jeder Zeichenaufruf rechnet für alle einen Schritt im
// Vertex-Shader (Zustand per Transform-Feedback in einen zweiten Puffer, Ping-Pong) und zeichnet den neuen Punkt additiv in
// ein Float-Ziel (RGBA: Σ cos 2πc, Σ sin 2πc, –, Anzahl). Die Farbe c (0..1) läuft mit (Flamme: Mittel mit der Farbe der
// gewählten Transformation, Attraktor: Richtung der Bewegung); gespeichert wird sie als Zeiger auf dem Farbkreis – so wählt
// erst die Anzeige die Palette (Palettenwechsel und Farbanimation ohne neues Histogramm, Mittelung bleibt linear).
// Je App-Bild K Schritte (K nach der Bildzeit geregelt, ~10 ms GPU). Bewegung (Gesten) = neues Histogramm, im Bewegungsbild in
// halber Auflösung (füllt sich 4× schneller).
// Rückfall (kein Float-Renderziel, Shader defekt): dieselbe Rechnung auf dem Prozessor (Haupt-Thread, ~5 ms je Bild, halbe
// Auflösung, Histogramm als Float-Textur hochgeladen) mit derselben Anzeige.
(function (root) {
'use strict';

// ---------------------------------------------------------------- Variationen (Reihenfolge = Index in Flammen-Definitionen)
const VARS = ['linear', 'sinusoidal', 'spherical', 'swirl', 'horseshoe', 'polar', 'handkerchief', 'heart', 'disc', 'spiral',
              'hyperbolic', 'diamond', 'julia', 'bubble', 'fisheye', 'cylinder'];
const NV = VARS.length;           // 16 – vier vec4 je Transformation
const MAXX = 6;                   // höchstens 6 Transformationen + Final
const XV = 8;                     // vec4 je Transformation im Uniform-Feld

// JS-Gegenstück (CPU-Rückfall, Bounding-Box, Zufallsflammen) – gleiche Formeln wie im Shader
function variation(j, x, y, u) {
    const r2 = x * x + y * y + 1e-12, r = Math.sqrt(r2), th = Math.atan2(y, x);
    switch (j) {
        case 0: return [x, y];
        case 1: return [Math.sin(x), Math.sin(y)];
        case 2: return [x / r2, y / r2];
        case 3: { const s = Math.sin(r2), c = Math.cos(r2); return [x * s - y * c, x * c + y * s]; }
        case 4: return [(x - y) * (x + y) / r, 2 * x * y / r];
        case 5: return [th / Math.PI, r - 1];
        case 6: return [r * Math.sin(th + r), r * Math.cos(th - r)];
        case 7: return [r * Math.sin(th * r), -r * Math.cos(th * r)];
        case 8: return [th / Math.PI * Math.sin(Math.PI * r), th / Math.PI * Math.cos(Math.PI * r)];
        case 9: return [(Math.cos(th) + Math.sin(r)) / r, (Math.sin(th) - Math.cos(r)) / r];
        case 10: return [Math.sin(th) / r, r * Math.cos(th)];
        case 11: return [Math.sin(th) * Math.cos(r), Math.cos(th) * Math.sin(r)];
        case 12: { const s = Math.sqrt(r), a = th / 2 + (u < 0.5 ? 0 : Math.PI); return [s * Math.cos(a), s * Math.sin(a)]; }
        case 13: { const k = 4 / (r2 + 4); return [k * x, k * y]; }
        case 14: { const k = 2 / (r + 1); return [k * y, k * x]; }
        case 15: return [Math.sin(x), y];
    }
    return [x, y];
}
// ein Schritt einer Flamme (JS): Zustand s = [x, y, c]; rnd() gleichverteilt. Rückgabe Punkt zum Zeichnen (mit Final)
function flameStep(F, s, rnd) {
    const X = F.x, u = rnd() * F._wsum;
    let k = 0, acc = X[0].w;
    while (k < X.length - 1 && u > acc) { k++; acc += X[k].w; }
    const t = X[k];
    const out = applyX(t, s[0], s[1], rnd);
    s[0] = out[0]; s[1] = out[1]; s[2] = (s[2] + t.c) * 0.5;
    if (F.f) { const o = applyX(F.f, s[0], s[1], rnd); return [o[0], o[1], F.f.c >= 0 ? (s[2] + F.f.c) * 0.5 : s[2]]; }
    return [s[0], s[1], s[2]];
}
function applyX(t, x0, y0, rnd) {
    const a = t.a, x = a[0] * x0 + a[1] * y0 + a[2], y = a[3] * x0 + a[4] * y0 + a[5];
    let ox = 0, oy = 0;
    const uj = rnd();
    for (const j in t.v) { const w = t.v[j]; if (!w) continue; const p = variation(+j, x, y, uj); ox += w * p[0]; oy += w * p[1]; }
    if (t.p) { const p = t.p; return [p[0] * ox + p[1] * oy + p[2], p[3] * ox + p[4] * oy + p[5]]; }
    return [ox, oy];
}
function prepFlame(F) { F._wsum = F.x.reduce((s, t) => s + t.w, 0); return F; }
// eigene Flamme (Zufall/Mutieren) im Link und in den Einstellungen: kompaktes JSON, Base64 mit '-' '.' (kein '_' – Trennzeichen in wp=)
function encFlame(F) {
    const o = { x: F.x.map(t => { const q = { w: t.w, c: t.c, a: t.a, v: t.v }; if (t.p) q.p = t.p; return q; }), f: F.f || null, g: F.g, b: F.b, vib: F.vib, view: F.view };
    const s = JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v);
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '.').replace(/=+$/, '');
}
function decFlame(str) {
    try {
        const b = str.replace(/-/g, '+').replace(/\./g, '/');
        const F = JSON.parse(decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4)))));
        if (!F || !Array.isArray(F.x) || !F.x.length || F.x.length > MAXX) return null;
        for (const t of F.x) if (!Array.isArray(t.a) || t.a.length !== 6 || typeof t.v !== 'object') return null;
        return prepFlame(F);
    } catch (e) { return null; }
}

// ---------------------------------------------------------------- Attraktoren
// t: 0 Clifford x' = sin(a y) + c cos(a x), y' = sin(b x) + d cos(b y)
//    1 De Jong  x' = sin(a y) − cos(b x),  y' = sin(c x) − cos(d y)
//    2 Svensson x' = d sin(a x) − sin(b y), y' = c cos(a x) + cos(b y)
//    3 Lorenz   dx = σ(y − x), dy = x(ρ − z) − y, dz = xy − βz (a = σ, b = ρ, c = β, d = Schritt), gezeigt (x, z − 25)
const ATT = [
    { id: 'clifford', p: [-1.4, 1.6, 1.0, 0.7], view: [0, 0, 0.7] },
    { id: 'dejong', p: [1.4, -2.3, 2.4, -2.1], view: [0, 0, 0.75] },
    { id: 'svensson', p: [1.5, -1.8, 1.6, 0.9], view: [0, 0, 0.75] },
    { id: 'lorenz', p: [10, 28, 8 / 3, 0.004], view: [0, 0, 0.048] },
];
function attStep(t, p, s) {
    const [a, b, c, d] = p, x = s[0], y = s[1];
    let nx, ny;
    if (t === 0) { nx = Math.sin(a * y) + c * Math.cos(a * x); ny = Math.sin(b * x) + d * Math.cos(b * y); }
    else if (t === 1) { nx = Math.sin(a * y) - Math.cos(b * x); ny = Math.sin(c * x) - Math.cos(d * y); }
    else if (t === 2) { nx = d * Math.sin(a * x) - Math.sin(b * y); ny = c * Math.cos(a * x) + Math.cos(b * y); }
    else {
        const z = s[3], h = d;
        const dx = a * (y - x), dy = x * (b - z) - y, dz = x * y - c * z;
        const mx = x + 0.5 * h * dx, my = y + 0.5 * h * dy, mz = z + 0.5 * h * dz;      // Mittelpunktregel
        nx = x + h * a * (my - mx); ny = y + h * (mx * (b - mz) - my); s[3] = z + h * (mx * my - c * mz);
    }
    const ang = Math.atan2(ny - y, nx - x) / (2 * Math.PI) + 0.5;
    s[2] = s[2] * 0.6 + ang * 0.4;
    s[0] = nx; s[1] = ny;
    return t === 3 ? [nx, s[3] - 25, s[2]] : [nx, ny, s[2]];
}

// ---------------------------------------------------------------- Galerie (kuratiert: tools/flame_search.js + Sichtprüfung)
const GALLERY = [];      // wird unten gefüllt (FLAMES)

// ---------------------------------------------------------------- Zufallsflammen, Mutieren
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const NICE = [[0, 1, 3, 12], [2, 12, 13], [4, 5, 6, 7], [8, 9, 10, 11], [1, 14, 15, 3]];
function randomFlame(seed) {
    const r = rng(seed), n = 2 + Math.floor(r() * 3), x = [];
    const fam = NICE[Math.floor(r() * NICE.length)];
    for (let i = 0; i < n; i++) {
        const ang = r() * 2 * Math.PI, sc = 0.35 + r() * 0.55, sk = (r() - 0.5) * 0.6;
        const ca = Math.cos(ang) * sc, sa = Math.sin(ang) * sc;
        const v = {};
        const nv = 1 + Math.floor(r() * 2.4);
        for (let k = 0; k < nv; k++) { const j = r() < 0.7 ? fam[Math.floor(r() * fam.length)] : Math.floor(r() * NV); v[j] = (v[j] || 0) + 0.3 + r() * 0.7; }
        const tot = Object.values(v).reduce((s, w) => s + w, 0);
        for (const j in v) v[j] = +(v[j] / tot).toFixed(3);
        x.push({ w: +(0.3 + r()).toFixed(3), c: +(i / Math.max(1, n - 1)).toFixed(3), a: [ca, -sa + sk, (r() - 0.5) * 1.6, sa, ca + sk, (r() - 0.5) * 1.6].map(q => +q.toFixed(4)), v });
    }
    const F = { x, f: null, g: 2.4, b: 0.55, vib: 0.85 };
    if (r() < 0.35) F.f = { w: 1, c: -1, a: [1, 0, 0, 0, 1, 0], v: { [[3, 12, 13, 2][Math.floor(r() * 4)]]: 1 } };
    return prepFlame(F);
}
function mutateFlame(F, seed, amt) {
    const r = rng(seed), G = JSON.parse(JSON.stringify(F, (k, v) => k === '_wsum' ? undefined : v));
    amt = amt || 0.12;
    for (const t of G.x) {
        t.a = t.a.map(q => +(q + (r() - 0.5) * amt).toFixed(4));
        for (const j in t.v) t.v[j] = Math.max(0.02, +(t.v[j] * (1 + (r() - 0.5) * amt * 3)).toFixed(3));
        if (r() < 0.25) { const j = Math.floor(r() * NV); t.v[j] = +((t.v[j] || 0) + r() * 0.3).toFixed(3); }
        t.c = +((t.c + (r() - 0.5) * 0.2 + 1) % 1).toFixed(3);
    }
    return prepFlame(G);
}
// Ausdehnung per Stichprobe (JS): Mitte + Zoom, sodass 98 % der Punkte im Bild liegen; null = entartet (Punkt/Explosion)
function fitView(kind, def, aspect) {
    const r = rng(12345), s = [r() * 2 - 1, r() * 2 - 1, 0.5, 20];
    const xs = [], ys = [], warm = kind === 'flame' ? 40 : def.t === 3 ? 3000 : 100, n = kind === 'flame' ? 24000 : def.t === 3 ? 60000 : 30000;
    for (let i = 0; i < n; i++) {
        const p = kind === 'flame' ? flameStep(def, s, r) : attStep(def.t, def.p, s);
        if (!isFinite(p[0]) || !isFinite(p[1]) || Math.abs(p[0]) > 1e6 || Math.abs(p[1]) > 1e6) { s[0] = r() * 2 - 1; s[1] = r() * 2 - 1; continue; }
        if (i > warm) { xs.push(p[0]); ys.push(p[1]); }
    }
    if (xs.length < 1000) return null;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (A, f) => A[Math.floor(A.length * f)];
    const x0 = q(xs, 0.01), x1 = q(xs, 0.99), y0 = q(ys, 0.01), y1 = q(ys, 0.99);
    const w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
    if (w < 1e-3 && h < 1e-3) return null;
    const zoom = 3 / Math.max(h * 1.12, w * 1.12 / (aspect || 1));
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom, w, h };
}

// ---------------------------------------------------------------- Shader
const WALK_VS = `#version 300 es
precision highp float;
precision highp int;
in vec4 a_s;                 // Zustand: x, y, Farbe, Zähler (Lorenz: z im Zähler-Anteil, siehe unten)
in vec4 a_t;                 // Lorenz: 3. Koordinate (sonst unbenutzt)
out vec4 v_s;                // -> Transform-Feedback
out vec4 v_t;
out float v_c;               // Farbe -> Fragment
uniform int u_kind;          // 0 Flamme, 1 Attraktor
uniform vec4 u_xf[${(MAXX + 1) * XV}];
uniform int u_nx, u_fin;
uniform float u_wsum;
uniform int u_att;           // Attraktor-Art
uniform vec4 u_ap;           // Attraktor-Parameter
uniform uint u_seed;
uniform vec4 u_cam;          // Mitte (relativ, f32), 1/halbe Breite, 1/halbe Höhe der Ansicht (Welt)
uniform vec4 u_tile;         // Kachel: Versatz und Maßstab in NDC (x' = x·zw + xy)
uniform int u_warm;
const float PI = 3.14159265;
uint g_r;
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd() { g_r = pcg(g_r); return float(g_r >> 8) * (1.0 / 16777216.0); }
vec2 vari(int j, vec2 p, float u) {
    float r2 = dot(p, p) + 1e-12, r = sqrt(r2), th = atan(p.y, p.x);
    if (j == 0) return p;
    if (j == 1) return sin(p);
    if (j == 2) return p / r2;
    if (j == 3) { float s = sin(r2), c = cos(r2); return vec2(p.x * s - p.y * c, p.x * c + p.y * s); }
    if (j == 4) return vec2((p.x - p.y) * (p.x + p.y), 2.0 * p.x * p.y) / r;
    if (j == 5) return vec2(th / PI, r - 1.0);
    if (j == 6) return r * vec2(sin(th + r), cos(th - r));
    if (j == 7) return r * vec2(sin(th * r), -cos(th * r));
    if (j == 8) return th / PI * vec2(sin(PI * r), cos(PI * r));
    if (j == 9) return vec2(cos(th) + sin(r), sin(th) - cos(r)) / r;
    if (j == 10) return vec2(sin(th) / r, r * cos(th));
    if (j == 11) return vec2(sin(th) * cos(r), cos(th) * sin(r));
    if (j == 12) { float s = sqrt(r), a = th * 0.5 + (u < 0.5 ? 0.0 : PI); return s * vec2(cos(a), sin(a)); }
    if (j == 13) return p * (4.0 / (r2 + 4.0));
    if (j == 14) return p.yx * (2.0 / (r + 1.0));
    return vec2(sin(p.x), p.y);
}
vec2 applyX(int k, vec2 p) {
    int o = k * ${XV};
    vec4 A0 = u_xf[o], A1 = u_xf[o + 1];
    vec2 q = vec2(A0.x * p.x + A0.y * p.y + A0.z, A0.w * p.x + A1.x * p.y + A1.y);
    float uj = rnd();
    vec2 s = vec2(0.0);
    for (int g = 0; g < 4; g++) {
        vec4 W = u_xf[o + 2 + g];
        for (int i = 0; i < 4; i++) { float w = W[i]; if (w != 0.0) s += w * vari(g * 4 + i, q, uj); }
    }
    vec4 P0 = u_xf[o + 6], P1 = u_xf[o + 7];
    if (P1.z > 0.5) s = vec2(P0.x * s.x + P0.y * s.y + P0.z, P0.w * s.x + P1.x * s.y + P1.y);
    return s;
}
void main() {
    g_r = pcg(uint(gl_VertexID) ^ (u_seed * 2654435761u));
    vec4 s = a_s, t = a_t;
    vec2 pl; float col;
    if (u_kind == 0) {
        float u = rnd() * u_wsum, acc = 0.0;
        int k = 0;
        for (int i = 0; i < ${MAXX}; i++) { if (i >= u_nx) break; acc += u_xf[i * ${XV} + 1].z; k = i; if (u <= acc) break; }
        s.xy = applyX(k, s.xy);
        s.z = (s.z + u_xf[k * ${XV} + 1].w) * 0.5;
        pl = s.xy; col = s.z;
        if (u_fin > 0) { pl = applyX(${MAXX}, s.xy); float fc = u_xf[${MAXX * XV} + 1].w; if (fc >= 0.0) col = (col + fc) * 0.5; }
    } else {
        float a = u_ap.x, b = u_ap.y, c = u_ap.z, d = u_ap.w, x = s.x, y = s.y;
        vec2 n;
        if (u_att == 0) n = vec2(sin(a * y) + c * cos(a * x), sin(b * x) + d * cos(b * y));
        else if (u_att == 1) n = vec2(sin(a * y) - cos(b * x), sin(c * x) - cos(d * y));
        else if (u_att == 2) n = vec2(d * sin(a * x) - sin(b * y), c * cos(a * x) + cos(b * y));
        else {
            float z = t.x, h = d;
            vec3 dv = vec3(a * (y - x), x * (b - z) - y, x * y - c * z);
            vec3 m = vec3(x, y, z) + 0.5 * h * dv;
            n = vec2(x + h * a * (m.y - m.x), y + h * (m.x * (b - m.z) - m.y));
            t.x = z + h * (m.x * m.y - c * m.z);
        }
        float ang = atan(n.y - y, n.x - x) / (2.0 * PI) + 0.5;
        s.z = s.z * 0.6 + ang * 0.4;
        s.xy = n;
        pl = u_att == 3 ? vec2(n.x, t.x - 25.0) : n; col = s.z;
    }
    s.w += 1.0;
    // entartet (Explosion, NaN): neu starten
    if (!(abs(s.x) < 1e6 && abs(s.y) < 1e6 && abs(t.x) < 1e6)) { s = vec4(rnd() * 2.0 - 1.0, rnd() * 2.0 - 1.0, rnd(), 0.0); t = vec4(20.0 + rnd(), 0.0, 0.0, 0.0); }
    v_s = s; v_t = t; v_c = col;
    vec2 ndc = ((pl - u_cam.xy) * u_cam.zw) * u_tile.zw + u_tile.xy;
    gl_Position = s.w > float(u_warm) && abs(pl.x) < 1e6 ? vec4(ndc, 0.0, 1.0) : vec4(4.0, 4.0, 0.0, 1.0);
    gl_PointSize = 1.0;
}`;
const WALK_FS = `#version 300 es
precision highp float;
in float v_c;
out vec4 o;
void main() { float a = 6.2831853 * v_c; o = vec4(cos(a), sin(a), 0.0, 1.0); }`;

// Anzeige: Log-Dichte (relativ zur mittleren Dichte in Weltkoordinaten), Gamma, Vibrancy; Farbe = Palette am mittleren Winkel
const TONE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_acc;
uniform vec2 u_size, u_target;
uniform vec4 u_vp;
uniform float u_k, u_bright, u_gamma, u_vib, u_cycle, u_fade;
uniform int u_up;            // 1 = Histogramm kleiner als das Ziel: bilinear (von Hand, Float-Texturen sind nicht filterbar)
uniform vec3 u_bg;
uniform vec3 u_palA, u_palB, u_palC, u_palD;
uniform int u_palCustom;
uniform vec3 u_custom[6];
out vec4 o;
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
vec4 fetchH(vec2 p) {
    if (u_up == 0) return texelFetch(u_acc, ivec2(p), 0);
    vec2 q = p - 0.5, f = fract(q); ivec2 b = ivec2(floor(q)), m = ivec2(u_size) - 1;
    vec4 a00 = texelFetch(u_acc, clamp(b, ivec2(0), m), 0), a10 = texelFetch(u_acc, clamp(b + ivec2(1, 0), ivec2(0), m), 0);
    vec4 a01 = texelFetch(u_acc, clamp(b + ivec2(0, 1), ivec2(0), m), 0), a11 = texelFetch(u_acc, clamp(b + ivec2(1, 1), ivec2(0), m), 0);
    return mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
}
void main() {
    vec2 p = gl_FragCoord.xy * u_size / u_target;
    vec4 h = fetchH(p);
    float n = h.a;
    vec3 col = u_bg;
    if (n > 0.0) {
        float d = n * u_k;                                   // Dichte relativ zum Mittel
        float al = clamp(log(1.0 + d) * u_bright, 0.0, 1.0); // Log-Dichte, normiert auf die hellen Stellen (u_bright = 1/log(1 + Spitze))
        float ag = pow(al, 1.0 / u_gamma);
        vec2 m = h.xy / n;                                   // mittlerer Zeiger auf dem Farbkreis
        float coh = length(m), hue = atan(m.y, m.x) / 6.2831853;
        vec3 pc = palette(hue + u_cycle);
        pc = mix(vec3(dot(pc, vec3(0.299, 0.587, 0.114))), pc, 0.35 + 0.65 * coh);
        vec3 lin = pc * al;                                  // ohne Vibrancy: Gamma je Kanal (bleicht aus)
        vec3 c = mix(pow(max(lin, 0.0), vec3(1.0 / u_gamma)), pc * ag, u_vib);
        col = mix(u_bg, c, clamp(ag * 1.4, 0.0, 1.0)) + pc * pow(ag, 8.0) * 0.25;
    }
    vec2 vv = (gl_FragCoord.xy + u_vp.xy) / u_vp.zw - 0.5;
    col *= 1.0 - dot(vv, vv) * 0.2;
    o = vec4(pow(max(col * u_fade, 0.0), vec3(0.95)), 1.0);
}`;

const FADE_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;
// Belichtung: Blöcke des Histogramms zusammenfassen (je Ausgabe-Texel ein Block): (größte Anzahl, Summe, belegte Texel, –).
// Die App liest das kleine Bild asynchron und stellt daraus Belichtung und Kontrast ein (siehe expose())
const REDUCE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_acc;
uniform ivec2 u_blk, u_size;
out vec4 o;
void main() {
    ivec2 b = ivec2(gl_FragCoord.xy) * u_blk;
    float mx = 0.0, sm = 0.0, oc = 0.0;
    for (int j = 0; j < 64; j++) { if (j >= u_blk.y) break; for (int i = 0; i < 64; i++) { if (i >= u_blk.x) break;
        ivec2 q = b + ivec2(i, j); if (q.x >= u_size.x || q.y >= u_size.y) continue;
        float n = texelFetch(u_acc, q, 0).a; mx = max(mx, n); sm += n; oc += n > 0.0 ? 1.0 : 0.0; } }
    o = vec4(mx, sm, oc, 0.0);
}`;

root.FKDensity = { VARS, ATT, GALLERY, variation, flameStep, attStep, randomFlame, mutateFlame, fitView, prepFlame, encFlame, decFlame, rng, WALK_VS, WALK_FS, TONE_FS, MAXX, XV,
create(ctx) {
    let R, S, HP, PAL, canvas, look, Q;
    const D = { ok: null, why: '', gpu: null, N: 0, K: 4, key: '', total: 0, frames: 0, t0: 0, tKey: 0, half: false, info: {}, anim: 0, cpu: null, seed: 1 };
    const gl = () => R.gl;

    // ---------------- Definition der aktuellen Welt (Flamme bzw. Attraktor) aus S.wp
    const decCache = { s: '', F: null };
    function curDef() {
        const f = S.formula;
        if (f === 14) {
            const w = S.wp[14] || {};
            let F = null;
            if (w.d) { if (decCache.s !== w.d) { decCache.s = w.d; decCache.F = decFlame(w.d); } F = decCache.F; }
            if (!F) F = GALLERY[Math.max(0, Math.min(GALLERY.length - 1, w.g | 0))] || GALLERY[0];
            if (!F._wsum) prepFlame(F);
            return { kind: 'flame', F };
        }
        const w = S.wp[15] || {}, t = Math.max(0, Math.min(3, w.t | 0)), p = ATT[t].p.map((v, i) => w['abcd'[i]] !== undefined ? +w['abcd'[i]] : v);
        return { kind: 'att', t, p };
    }
    // Schlüssel: alles, was das Histogramm ungültig macht (Kamera, Größe, Definition) – nicht Palette/Farbe
    function keyOf(def, cam, w, h) { return [S.formula, cam.cx, cam.cy, cam.zoom, w, h, JSON.stringify(def.kind === 'flame' ? def.F.x : def.p), def.kind === 'flame' ? JSON.stringify(def.F.f) : def.t].join('|'); }

    // ---------------- GPU-Aufbau
    function compile(type, src) { const g = gl(), s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS) && !g.isContextLost()) throw new Error(g.getShaderInfoLog(s)); return s; }
    // Wander-Programm: Übersetzen anstoßen (nicht blockierend mit KHR_parallel_shader_compile – prewarm() beim Öffnen des
    // Welten-Menüs), fertig machen beim ersten Bild
    function startWalk() {
        const g = gl();
        if (D.pend || D.gpu) return;
        const p = g.createProgram(), mk = (t, src) => { const s = g.createShader(t); g.shaderSource(s, src); g.compileShader(s); g.attachShader(p, s); return s; };
        const vs = mk(g.VERTEX_SHADER, WALK_VS), fs = mk(g.FRAGMENT_SHADER, WALK_FS);
        g.bindAttribLocation(p, 0, 'a_s'); g.bindAttribLocation(p, 1, 'a_t');
        g.transformFeedbackVaryings(p, ['v_s', 'v_t'], g.SEPARATE_ATTRIBS);
        g.linkProgram(p);
        D.pend = { p, vs, fs };
    }
    function prewarm() {
        try { if (!R.lost && D.ok !== false && gl().getExtension('EXT_color_buffer_float')) { startWalk(); R.prewarm('densTone', TONE_FS); R.prewarm('densReduce', REDUCE_FS); } } catch (e) { /* beim ersten Bild */ }
    }
    function walkReady() {
        const g = gl(), PSC = g.getExtension('KHR_parallel_shader_compile');
        if (!D.pend) startWalk();
        return !PSC || g.getProgramParameter(D.pend.p, PSC.COMPLETION_STATUS_KHR);
    }
    function makeWalk() {
        const g = gl();
        if (!D.pend) startWalk();
        const { p, vs, fs } = D.pend; D.pend = null;
        if (!g.getProgramParameter(p, g.LINK_STATUS) && !g.isContextLost()) throw new Error('Link: ' + g.getShaderInfoLog(vs) + g.getShaderInfoLog(fs) + g.getProgramInfoLog(p));
        const L = {};
        for (const n of ['u_kind', 'u_xf', 'u_nx', 'u_fin', 'u_wsum', 'u_att', 'u_ap', 'u_seed', 'u_cam', 'u_tile', 'u_warm']) L[n] = g.getUniformLocation(p, n);
        return { p, L };
    }
    function gpuInit() {
        const g = gl();
        if (D.ok === false) return false;
        if (D.gpu) return true;
        try {
            if (Q.get('dens') === 'cpu') throw new Error('?dens=cpu');
            if (!g.getExtension('EXT_color_buffer_float')) throw new Error('kein Float-Renderziel');
            D.fblend = !!g.getExtension('EXT_float_blend');
            if (R.broken.density) throw new Error(R.broken.density);
            if (!walkReady()) return 'wait';
            const walk = makeWalk();
            const tone = R.program('densTone', TONE_FS);
            D.gpu = { walk, tone, buf: [null, null], tb: [null, null], vao: [null, null], tf: g.createTransformFeedback(), acc: null, ping: 0 };
            D.ok = true;
            return true;
        } catch (e) {
            if (!R.broken.density) { R.broken.density = String(e.message || e); console.warn('Lichtbilder: Rückfall auf den Prozessor –', R.broken.density); }
            if (!/\?dens=cpu/.test(String(e.message))) ctx.toast(ctx.t('shader_fallback'), 4500);
            D.ok = false; D.why = String(e.message || e);
            return false;
        }
    }
    function walkers(n, def) {
        const G = D.gpu, g = gl();
        const wk = def && def.kind === 'att' && def.t === 3 ? 'L' + def.p.join(',') : 'x';
        if (G.buf[0] && D.N === n && D.wk === wk) return;
        D.wk = wk;
        for (let i = 0; i < 2; i++) { if (G.buf[i]) { g.deleteBuffer(G.buf[i]); g.deleteBuffer(G.tb[i]); g.deleteVertexArray(G.vao[i]); } }
        const r = rng(D.seed++), a = new Float32Array(n * 4), b = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { a[4 * i] = r() * 2 - 1; a[4 * i + 1] = r() * 2 - 1; a[4 * i + 2] = r(); a[4 * i + 3] = 0; b[4 * i] = 20 + r(); }
        if (wk !== 'x') {
            // Lorenz: Startpunkte entlang einer auf der CPU gerechneten Bahn (schon auf dem Attraktor, Zähler über dem Einschwingen)
            const s = [1, 1, 0.5, 20];
            for (let k = 0; k < 3000; k++) attStep(3, def.p, s);
            for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) attStep(3, def.p, s); a[4 * i] = s[0]; a[4 * i + 1] = s[1]; a[4 * i + 2] = s[2]; a[4 * i + 3] = 1000; b[4 * i] = s[3]; }
        }
        for (let i = 0; i < 2; i++) {
            G.buf[i] = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, G.buf[i]); g.bufferData(g.ARRAY_BUFFER, a, g.DYNAMIC_COPY);
            G.tb[i] = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, G.tb[i]); g.bufferData(g.ARRAY_BUFFER, b, g.DYNAMIC_COPY);
            G.vao[i] = g.createVertexArray(); g.bindVertexArray(G.vao[i]);
            g.bindBuffer(g.ARRAY_BUFFER, G.buf[i]); g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 4, g.FLOAT, false, 0, 0);
            g.bindBuffer(g.ARRAY_BUFFER, G.tb[i]); g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 4, g.FLOAT, false, 0, 0);
        }
        g.bindVertexArray(R.vao); g.bindBuffer(g.ARRAY_BUFFER, null);
        D.N = n;
    }
    function accTarget(w, h) {
        const G = D.gpu, g = gl();
        if (G.acc && G.acc.w === w && G.acc.h === h) return G.acc;
        if (G.acc) { g.deleteTexture(G.acc.tex); g.deleteFramebuffer(G.acc.fbo); }
        const tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tex);
        g.texStorage2D(g.TEXTURE_2D, 1, D.fblend ? g.RGBA32F : g.RGBA16F, w, h);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
        const fbo = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, fbo);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
        const okFb = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
        g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        if (!okFb) throw new Error('Float-Ziel unvollständig');
        G.acc = { tex, fbo, w, h };
        return G.acc;
    }
    // Uniforms der Definition
    const xfBuf = new Float32Array((MAXX + 1) * XV * 4);
    function setDef(L, def) {
        const g = gl();
        if (def.kind === 'flame') {
            const F = def.F;
            xfBuf.fill(0);
            const put = (k, t) => {
                const o = k * XV * 4, a = t.a;
                xfBuf.set([a[0], a[1], a[2], a[3], a[4], a[5], t.w, t.c], o);
                for (const j in t.v) xfBuf[o + 8 + (+j)] = t.v[j];
                if (t.p) xfBuf.set([t.p[0], t.p[1], t.p[2], t.p[3], t.p[4], t.p[5], 1, 0], o + 24);
            };
            F.x.slice(0, MAXX).forEach((t, k) => put(k, t));
            if (F.f) put(MAXX, F.f);
            g.uniform4fv(L.u_xf, xfBuf);
            g.uniform1i(L.u_kind, 0); g.uniform1i(L.u_nx, Math.min(MAXX, F.x.length)); g.uniform1i(L.u_fin, F.f ? 1 : 0); g.uniform1f(L.u_wsum, F._wsum);
        } else {
            g.uniform1i(L.u_kind, 1); g.uniform1i(L.u_att, def.t); g.uniform4f(L.u_ap, def.p[0], def.p[1], def.p[2], def.p[3]);
            g.uniform4fv(L.u_xf, xfBuf); g.uniform1i(L.u_nx, 0); g.uniform1i(L.u_fin, 0); g.uniform1f(L.u_wsum, 1);
        }
    }
    // K Schritte aller Wanderer, Punkte additiv ins Ziel acc; cam = { cx, cy, zoom } (Welt), Ansicht w×h (Pixel des ganzen Bilds),
    // tile = [x0, y0, tw, th] Ausschnitt in Pixeln des ganzen Bilds (null = alles)
    function walk(acc, def, cam, W, H, K, tile) {
        const g = gl(), G = D.gpu, P = G.walk;
        g.useProgram(P.p);
        setDef(P.L, def);
        const halfH = 1.5 / cam.zoom, halfW = halfH * W / H;
        const cx = HP.toNumber(cam.cx) - (def.ox || 0), cy = HP.toNumber(cam.cy) - (def.oy || 0);
        g.uniform4f(P.L.u_cam, cx, cy, 1 / halfW, 1 / halfH);
        if (tile) {
            const sx = W / tile[2], sy = H / tile[3];
            // NDC des ganzen Bilds -> NDC der Kachel: x' = (x + 1) · W/2 − x0 … auf [−1, 1] der Kachel
            g.uniform4f(P.L.u_tile, sx - 1 - 2 * tile[0] / tile[2], sy - 1 - 2 * tile[1] / tile[3], sx, sy);
        } else g.uniform4f(P.L.u_tile, 0, 0, 1, 1);
        // Einschwingen, bevor gezeichnet wird: Flamme 12 Schritte, Abbildungen 40, Lorenz (kleine Zeitschritte) 900
        g.uniform1i(P.L.u_warm, def.kind === 'flame' ? 12 : def.t === 3 ? 900 : 40);
        g.bindFramebuffer(g.FRAMEBUFFER, acc.fbo);
        g.viewport(0, 0, acc.w, acc.h);
        g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE);
        for (let k = 0; k < K; k++) {
            g.uniform1ui(P.L.u_seed, (D.seed = (D.seed * 1664525 + 1013904223) >>> 0));
            const src = G.ping, dst = 1 - src;
            g.bindVertexArray(G.vao[src]);
            g.bindTransformFeedback(g.TRANSFORM_FEEDBACK, G.tf);
            g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER, 0, G.buf[dst]);
            g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER, 1, G.tb[dst]);
            g.beginTransformFeedback(g.POINTS);
            g.drawArrays(g.POINTS, 0, D.N);
            g.endTransformFeedback();
            g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER, 0, null);
            g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER, 1, null);
            g.bindTransformFeedback(g.TRANSFORM_FEEDBACK, null);
            G.ping = dst;
        }
        g.disable(g.BLEND);
        g.bindVertexArray(R.vao);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        R.submitted++;
    }
    // Anzeige des Histogramms (tex, Größe aw×ah) ins Ziel (null = Canvas); pts = gezeichnete Punkte, Kamera-Zoom für die Dichte
    function tone(tex, aw, ah, pts, zoom, lk, target, vp, ref) {
        const g = gl(), pr = D.gpu ? D.gpu.tone : R.program('densTone', TONE_FS), L = pr.loc;
        const tw = target ? target.w : canvas.width, th = target ? target.h : canvas.height;
        g.useProgram(pr.p);
        g.bindFramebuffer(g.FRAMEBUFFER, target ? target.fbo : null);
        g.viewport(0, 0, tw, th);
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tex); g.uniform1i(L.u_acc, 0);
        g.uniform2f(L.u_size, aw, ah); g.uniform2f(L.u_target, tw, th);
        g.uniform1i(L.u_up, aw < tw - 0.5 ? 1 : 0);
        const W = vp ? vp[2] : tw, H = vp ? vp[3] : th;
        g.uniform4f(L.u_vp, vp ? vp[0] : 0, vp ? vp[1] : 0, W, H);
        // Dichte relativ zur mittleren Dichte (in Weltkoordinaten bezogen auf die Startansicht der Definition):
        // k = Pixel des Histogramms / Punkte · (Zoom / Zoom_Start)²
        // Belichtung: aus der Messung (expose) – Dichte relativ zur mittleren Dichte der BELEGTEN Pixel, Kontrast so, dass die
        // hellsten Stellen (98-%-Quantil der Blockspitzen) knapp sättigen; ohne Messung: relativ zum Mittel über alle Pixel
        const def = D.def || curDef();
        const F = def.kind === 'flame' ? def.F : null;
        const fb = (F && F.b ? F.b / 0.55 : 1);
        // (Screenshot-Kachel: Belichtung schon auf Punktzahl und Pixel des ganzen Bilds umgerechnet; sonst Messung auf die
        //  aktuelle Punktzahl und Histogramm-Größe umrechnen – Anzahl je Pixel ∝ Punkte / Pixelzahl)
        const E = target && D.capE ? D.capE : D.E;
        const meanOcc = target && D.capE ? D.capE.meanOcc : E ? E.meanOcc * pts / Math.max(1, E.pts) * (E.w * E.h) / Math.max(1, aw * ah) : pts / Math.max(1, aw * ah);
        g.uniform1f(L.u_k, meanOcc > 0 ? 1 / meanOcc : 0);
        g.uniform1f(L.u_bright, (E ? E.B : 0.55) * fb);
        g.uniform1f(L.u_gamma, (F && F.g) || 2.2);
        g.uniform1f(L.u_vib, F && F.vib !== undefined ? F.vib : 0.8);
        g.uniform1f(L.u_fade, D.fade === undefined ? 1 : D.fade);
        g.uniform3f(L.u_bg, 0.0, 0.0, 0.006);
        R.setPalette(L, lk);
        g.uniform1f(L.u_cycle, lk.cycle);
        g.drawArrays(g.TRIANGLES, 0, 3);
        if (target) g.bindFramebuffer(g.FRAMEBUFFER, null);
    }

    // ---------------- CPU-Rückfall (Haupt-Thread, halbe Auflösung)
    function cpuStep(def, cam, w, h, budgetMs) {
        let C = D.cpu;
        if (!C || C.w !== w || C.h !== h) { C = D.cpu = { w, h, hist: new Float32Array(w * h * 4), tex: null, texW: 0, texH: 0, st: [], pts: 0 }; }
        if (!C.st.length) { const r = rng(D.seed++); for (let i = 0; i < 64; i++) C.st.push([r() * 2 - 1, r() * 2 - 1, r(), 20 + r(), 0]); C.r = r; }
        const r = C.r, halfH = 1.5 / cam.zoom, halfW = halfH * w / h, cx = HP.toNumber(cam.cx) - (def.ox || 0), cy = HP.toNumber(cam.cy) - (def.oy || 0);
        const t0 = performance.now();
        let n = 0;
        while (performance.now() - t0 < budgetMs) {
            for (let k = 0; k < 2000; k++) {
                const s = C.st[k & 63];
                const p = def.kind === 'flame' ? flameStep(def.F, s, r) : attStep(def.t, def.p, s);
                s[4]++;
                if (!(Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6)) { s[0] = r() * 2 - 1; s[1] = r() * 2 - 1; s[3] = 20 + r(); s[4] = 0; continue; }
                if (s[4] < (def.kind === 'flame' ? 12 : def.t === 3 ? 900 : 40)) continue;
                const px = Math.floor(((p[0] - cx) / halfW * 0.5 + 0.5) * w), py = Math.floor(((p[1] - cy) / halfH * 0.5 + 0.5) * h);
                if (px < 0 || py < 0 || px >= w || py >= h) { n++; continue; }
                const o = 4 * (py * w + px), a = 6.2831853 * p[2];
                C.hist[o] += Math.cos(a); C.hist[o + 1] += Math.sin(a); C.hist[o + 3] += 1;
                n++;
            }
        }
        C.pts += n;
        const g = gl();
        if (!C.tex || C.texW !== w || C.texH !== h) {
            if (C.tex) g.deleteTexture(C.tex);
            C.tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, C.tex);
            g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA32F, w, h);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
            C.texW = w; C.texH = h;
        }
        g.bindTexture(g.TEXTURE_2D, C.tex);
        g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, w, h, g.RGBA, g.FLOAT, C.hist);
        return C;
    }

    // ---------------- Bild je App-Takt
    const MOBILE = Math.min(screen.width, screen.height) < 700;
    // Bildschirmschoner: Affin-Teil der ersten Transformation dreht langsam, Gewichte atmen (eine Runde ~90 s)
    function animDef(def, t) {
        const F = JSON.parse(JSON.stringify(def.F, (k, v) => k === '_wsum' ? undefined : v));
        const a = F.x[0].a, th = t * 2 * Math.PI / 90, c = Math.cos(th), s = Math.sin(th);
        F.x[0].a = [a[0] * c - a[3] * s, a[1] * c - a[4] * s, a[2], a[0] * s + a[3] * c, a[1] * s + a[4] * c, a[5]];
        F.x.forEach((x, i) => { x.w *= 1 + 0.35 * Math.sin(t * 2 * Math.PI / (37 + 11 * i) + i); });
        return { kind: 'flame', F: prepFlame(F), anim: true };
    }
    function present(now, camChanged) {
        const animOn0 = !!(S.formula === 14 && (S.wp[14] || {}).a && !(ctx.RM && ctx.RM.matches));
        if (animOn0) D.animT = (D.animT || 0) + Math.min(0.05, (now - (D.animNow || now)) / 1000);
        D.animNow = now;
        const def = animOn0 ? animDef(curDef(), D.animT) : curDef(), cam = S.cam, lk = look();
        D.def = def;
        const cw = canvas.width, ch = canvas.height;
        const moving = ctx.isMoving() || camChanged;
        const animOn = animOn0;
        const half = moving || animOn;
        const w = half ? Math.max(16, Math.round(cw / 2)) : cw, h = half ? Math.max(16, Math.round(ch / 2)) : ch;
        const ref = def.kind === 'flame' ? (def.F.view ? def.F.view[2] : 1) : ATT[def.t].view[2];
        const key = animOn ? 'anim|' + [S.formula, cam.cx, cam.cy, cam.zoom, w, h].join('|') : keyOf(def, cam, w, h);
        const gi = gpuInit();
        if (gi === 'wait') { R.present([], cam, lk, null, {}); D.info = { gpu: null, wait: true }; return; }   // dunkel, bis übersetzt
        if (gi) {
            const G = D.gpu, g = gl();
            walkers(MOBILE || S.quality === 'eco' ? 65536 : S.quality === 'max' ? 262144 : 131072, def);
            let acc;
            try { acc = accTarget(w, h); } catch (e) { D.ok = false; D.why = String(e.message); R.broken.density = D.why; return present(now, camChanged); }
            if (key !== D.key) {
                g.bindFramebuffer(g.FRAMEBUFFER, acc.fbo); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.bindFramebuffer(g.FRAMEBUFFER, null);
                D.total = 0; D.tKey = now;
                D.key = key; D.frames = 0;
            } else if (animOn) {
                // Animation: das Histogramm verblasst je Bild (Faktor 0,9 – etwa die letzten 10 Bilder tragen), statt zu löschen:
                // fließend, ohne Flackern; Multiplikation per Blending (Ziel × Konstante)
                g.bindFramebuffer(g.FRAMEBUFFER, acc.fbo); g.viewport(0, 0, acc.w, acc.h);
                g.enable(g.BLEND); g.blendFunc(g.ZERO, g.CONSTANT_ALPHA); g.blendColor(0, 0, 0, 0.9);
                const pr = R.program('densFade', FADE_FS); g.useProgram(pr.p); g.drawArrays(g.TRIANGLES, 0, 3);
                g.disable(g.BLEND); g.bindFramebuffer(g.FRAMEBUFFER, null);
                D.total *= 0.9;
            }
            // Arbeit je Bild: K Schritte, geregelt nach der Bildzeit (Ziel: Bildtakt halten); im Stillstand bis 4 s mehr, dann
            // langsamer weiter (das Bild wird nur noch ruhiger), nach 20 s Pause (Akku)
            const age = now - D.tKey, dtm = ctx.RC.dtEMA || 16, vs = ctx.RC.vsync || 16.7;
            if (dtm > vs * 1.25) D.K = Math.max(1, D.K - 1); else if (dtm < vs * 1.05) D.K = Math.min(MOBILE ? 24 : 48, D.K + 1);
            const K = age > 20000 && !animOn ? 0 : age > 6000 && !animOn ? Math.max(1, D.K >> 2) : D.K;
            if (animOn) ctx.RC.dirty = true;
            if (K) { walk(acc, def, cam, w, h, K); D.total += K * D.N; D.frames++; }
            if (key !== D.eKey) { D.E = null; D.eKey = key; }
            expose(now, acc.tex, w, h, D.total, !D.E && D.frames > 2);
            tone(acc.tex, w, h, D.total, cam.zoom, lk, null, null, ref);
            D.info = { gpu: true, E: D.E && { B: +D.E.B.toFixed(2), occ: +D.E.occFrac.toFixed(3), peak: D.E.peakRel }, w, h, N: D.N, K, total: D.total, spp: +(D.total / (w * h)).toFixed(2), ageMs: Math.round(age), fblend: D.fblend };
            return;
        }
        // CPU-Rückfall
        const hw = Math.max(16, Math.round(cw / 2)), hh = Math.max(16, Math.round(ch / 2));
        const ckey = keyOf(def, cam, hw, hh);
        if (ckey !== D.key) { D.key = ckey; if (D.cpu) { D.cpu.hist.fill(0); D.cpu.pts = 0; } D.tKey = now; }
        const C = cpuStep(def, cam, hw, hh, now - D.tKey > 20000 ? 0.5 : 6);
        if (now - (D.expT || 0) > 400) {
            D.expT = now;
            const RW = 48, RH = Math.max(8, Math.round(48 * hh / hw)), bw = Math.ceil(hw / RW), bh = Math.ceil(hh / RH), a = new Float32Array(RW * RH * 4);
            for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) { const n = C.hist[4 * (y * hw + x) + 3]; if (!n) continue; const o = 4 * (Math.floor(y / bh) * RW + Math.floor(x / bw)); a[o] = Math.max(a[o], n); a[o + 1] += n; a[o + 2]++; }
            D.E = exposureFrom(a, C.pts, hw, hh);
        }
        tone(C.tex, hw, hh, C.pts, cam.zoom, lk, null, null, ref);
        D.info = { gpu: false, w: hw, h: hh, total: C.pts, spp: +(C.pts / (hw * hh)).toFixed(2), ageMs: Math.round(now - D.tKey), why: D.why };
    }

    // ---------------- Kachel-Screenshot: je Kachel ein eigenes Histogramm in Kachelgröße, gleiche Punktzahl je Bildfläche
    function capTile(C, T, tile, ct) {
        const P = C.P, def = D.def || curDef(), g = gl();
        if (gpuInit() !== true) {
            // Rückfall: Bildschirm-Histogramm hochskaliert (die CPU schafft keine Gigapixel)
            const Cp = D.cpu;
            if (!Cp) return true;
            tone(Cp.tex, Cp.w, Cp.h, Cp.pts, P.cam.zoom, C.look, { w: tile.w, h: tile.h, fbo: ct.fbo }, [tile.gx, tile.gy, P.W, P.H], def.kind === 'flame' ? (def.F.view ? def.F.view[2] : 1) : ATT[def.t].view[2]);
            return true;
        }
        if (T.st === 'start') {
            walkers(D.N || 131072);
            T.acc = accTarget(tile.w, tile.h);
            g.bindFramebuffer(g.FRAMEBUFFER, T.acc.fbo); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.bindFramebuffer(g.FRAMEBUFFER, null);
            // Punktzahl für das ganze Bild: so viele Punkte je Pixel wie das Bildschirmbild nach ~4 s (mind. 40), höchstens 400 Mio.
            T.need = Math.min(4e8, Math.max(40, P.spp || 40) * P.W * P.H);
            // Belichtung des Bildschirmbilds, auf die Punktzahl und Fläche des ganzen Screenshots umgerechnet
            D.capE = D.E ? Object.assign({}, D.E) : null;
            if (D.capE) { D.capE.meanOcc = D.E.meanOcc / Math.max(1, D.E.pts) * T.need * (D.E.w * D.E.h) / (P.W * P.H); D.capE.pts = T.need; D.capE.w = P.W; D.capE.h = P.H; }
            T.done = 0; T.st = 'walk';
            // Wanderer einschwingen (ohne Zeichnen ins Kachelziel: Punkte außerhalb) – sie laufen ohnehin weiter
            return false;
        }
        if (T.st === 'read') return false;
        if (T.st === 'walk') {
            const K = Math.max(1, Math.min(64, D.K * 2));
            walk(T.acc, def, P.cam, P.W, P.H, K, [tile.gx, tile.gy, tile.w, tile.h]);
            T.done += K * D.N;
            C.sub = Math.min(0.95, T.done / T.need);
            if (T.done < T.need) return false;
            // Dichte-Normierung wie im Bildschirmbild: Punkte je Pixel des ganzen Bilds
            tone(T.acc.tex, tile.w, tile.h, T.need, P.cam.zoom, C.look, { w: tile.w, h: tile.h, fbo: ct.fbo }, [tile.gx, tile.gy, P.W, P.H], def.kind === 'flame' ? (def.F.view ? def.F.view[2] : 1) : ATT[def.t].view[2]);
            T.st = 'out';
            return true;
        }
        return T.st === 'out';
    }
    // ---------------- Belichtung messen (alle ~400 ms, asynchron, kleines Bild); Ergebnis gilt mit der Punktzahl zum Messzeitpunkt
    function expose(now, tex, w, h, pts, force) {
        if (D.expBusy || (!force && now - (D.expT || 0) < 400)) return;
        const g = gl(), RW = 48, RH = Math.max(8, Math.round(48 * h / w));
        if (!D.red || D.red.w !== RW || D.red.h !== RH) {
            if (D.red) { g.deleteTexture(D.red.tex); g.deleteFramebuffer(D.red.fbo); }
            const t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t); g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA32F, RW, RH);
            g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
            const fb = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, fb); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0);
            g.bindFramebuffer(g.FRAMEBUFFER, null);
            D.red = { tex: t, fbo: fb, w: RW, h: RH };
        }
        const pr = R.program('densReduce', REDUCE_FS), L = pr.loc;
        g.useProgram(pr.p);
        g.bindFramebuffer(g.FRAMEBUFFER, D.red.fbo); g.viewport(0, 0, RW, RH);
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tex); g.uniform1i(L.u_acc, 0);
        g.uniform2i(L.u_blk, Math.ceil(w / RW), Math.ceil(h / RH)); g.uniform2i(L.u_size, w, h);
        g.drawArrays(g.TRIANGLES, 0, 3);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        D.expBusy = true; D.expT = now;
        const key = D.key;
        R.readAsync(D.red.fbo, RW, RH, g.RGBA, g.FLOAT, Float32Array, 4).then((a) => {
            D.expBusy = false;
            if (!a || key !== D.key) return;
            D.E = exposureFrom(a, pts, w, h);
        });
    }
    function exposureFrom(a, pts, w, h) {
        let sum = 0, occ = 0; const mx = [];
        for (let i = 0; i < a.length; i += 4) { sum += a[i + 1]; occ += a[i + 2]; if (a[i] > 0) mx.push(a[i]); }
        if (!occ) return null;
        mx.sort((x, y) => x - y);
        const meanOcc = sum / occ, peak = mx[Math.floor(mx.length * 0.98)] || meanOcc;
        // Kontrast B = 1/log(1 + Spitze relativ zum Mittel): die hellen Stellen (98-%-Quantil der Blockspitzen) erreichen 1
        const P = Math.max(1, peak / meanOcc), B = Math.max(0.12, Math.min(1.5, 1 / Math.log(1 + P)));
        return { meanOcc, pts, w, h, B, occFrac: occ / (w * h), peakRel: +P.toFixed(1) };
    }
    // nach dem Screenshot: Histogramm des Bildschirms neu aufbauen (das Kachel-Ziel hat es ersetzt)
    function capEnd() { D.key = ''; D.capE = null; }

    // nur die Anzeige neu (Screenshot, Überblendung, Test): Histogramm unverändert
    function redraw() {
        const lk = look(), def = D.def || curDef(), ref = def.kind === 'flame' ? (def.F.view ? def.F.view[2] : 1) : ATT[def.t].view[2];
        if (D.gpu && D.gpu.acc) tone(D.gpu.acc.tex, D.gpu.acc.w, D.gpu.acc.h, D.total, S.cam.zoom, lk, null, null, ref);
        else if (D.cpu && D.cpu.tex) tone(D.cpu.tex, D.cpu.w, D.cpu.h, D.cpu.pts, S.cam.zoom, lk, null, null, ref);
    }
    function reset() { D.gpu = null; D.ok = null; D.N = 0; D.key = ''; D.cpu = null; D.pend = null; D.red = null; D.E = null; }
    function invalidate() { D.key = ''; }
    return {
        link() { ({ R, S, HP, PAL, canvas, look, Q } = ctx); },
        present, redraw, reset, invalidate, capTile, capEnd, curDef, prewarm,
        info: () => Object.assign({ ok: D.ok, why: D.why }, D.info),
        spp: () => (D.info && D.info.spp) || 0,
    };
} };

// ---------------------------------------------------------------- Galerie (Startflammen)
// Jede: Transformationen x (w Gewicht, c Farbe 0..1, a Affin [a b c d e f], v {Variation: Gewicht}, p Nach-Affin), f Final,
// g Gamma, b Helligkeit (Log-Dichte), vib Vibrancy, view [cx, cy, zoom]
const FLAMES = root.FKFlames || [];
for (const F of FLAMES) GALLERY.push(prepFlame(F));
})(typeof self !== 'undefined' ? self : globalThis);
