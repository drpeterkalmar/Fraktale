// palettes.js — Farbpaletten (Cosinus-Paletten wie v4 + neue + Custom mit 6 Stopps).
// Die Vorschau-Swatches werden aus DERSELBEN Formel erzeugt wie im Shader (v4 zeigte Fantasie-Verläufe).
(function (root) {
'use strict';
const H = 0.5;
const PALETTES = [
    { id: 'neon',     name: 'Neon Spectral', a: [H, H, H], b: [H, H, H], c: [1, 1, 1],     d: [0.00, 0.10, 0.20] },
    { id: 'ocean',    name: 'Ocean Deep',    a: [H, H, H], b: [H, H, H], c: [1, 1, 0.5],   d: [0.80, 0.90, 0.30] },
    { id: 'inferno',  name: 'Inferno',       a: [H, H, H], b: [H, H, H], c: [1, 0.7, 0.4], d: [0.00, 0.15, 0.20] },
    { id: 'electric', name: 'Electric',      a: [H, H, H], b: [H, H, H], c: [2, 1, 0],     d: [0.50, 0.20, 0.25] },
    { id: 'cosmic',   name: 'Cosmic',        a: [H, H, H], b: [H, H, H], c: [1, 1, 1],     d: [0.30, 0.20, 0.20] },
    { id: 'aurora',   name: 'Aurora',        a: [H, H, H], b: [H, H, H], c: [1, 1, 0.5],   d: [0.00, 0.33, 0.67] },
    { id: 'coral',    name: 'Koralle',       a: [0.8, 0.5, 0.4], b: [0.2, 0.4, 0.2], c: [2, 1, 1], d: [0.00, 0.25, 0.25] },
    { id: 'gold',     name: 'Gold',          a: [0.55, 0.42, 0.22], b: [0.45, 0.38, 0.24], c: [1, 1, 1], d: [0.00, 0.06, 0.16] },
    { id: 'ice',      name: 'Eis',           a: [0.45, 0.62, 0.78], b: [0.40, 0.36, 0.26], c: [1, 1, 1], d: [0.55, 0.58, 0.62] },
    { id: 'graphite', name: 'Graphit',       a: [H, H, H], b: [H, H, H], c: [1, 1, 1],     d: [0, 0, 0] },
    { id: 'custom',   name: 'Custom',        custom: true, a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], d: [0, 0, 0] },
];
const DEFAULT_CUSTOM = ['#7c3aed', '#22d3ee', '#f472b6', '#facc15', '#34d399', '#ffffff'];
let custom = DEFAULT_CUSTOM.slice();

function hexToRgb01(hex) { const v = parseInt(hex.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }

function loadCustom() {
    try {
        const arr = JSON.parse(localStorage.getItem('fraktal_custom_palette') || 'null');
        if (Array.isArray(arr) && arr.length === 6 && arr.every(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) custom = arr.map(c => c.toLowerCase());
    } catch (e) { /* privat-Modus o.ä. */ }
}
function saveCustom() { try { localStorage.setItem('fraktal_custom_palette', JSON.stringify(custom)); } catch (e) {} }

// Farbe an Position t (0..1) exakt wie der Display-Shader (inkl. Sättigung + Gamma)
function colorAt(p, t) {
    t = t - Math.floor(t);
    let c;
    if (p.custom) {
        const x = t * 6, s = Math.floor(x) % 6, f = x - Math.floor(x);
        const a = hexToRgb01(custom[s]), b = hexToRgb01(custom[(s + 1) % 6]);
        c = [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * f);
    } else c = [0, 1, 2].map(k => p.a[k] + p.b[k] * Math.cos(6.28318 * (p.c[k] * t + p.d[k])));
    const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    return c.map(v => Math.round(255 * Math.min(1, Math.pow(Math.max(0, lum + (v - lum) * 1.2), 0.92))));
}
function gradientCSS(p, stops = 14) {
    const parts = [];
    for (let i = 0; i <= stops; i++) { const [r, g, b] = colorAt(p, i / stops); parts.push(`rgb(${r},${g},${b}) ${(100 * i / stops).toFixed(1)}%`); }
    return `linear-gradient(90deg, ${parts.join(',')})`;
}
function customFlat() { const out = []; custom.forEach(h => out.push(...hexToRgb01(h))); return new Float32Array(out); }

root.FKPalettes = {
    list: PALETTES, colorAt, gradientCSS, customFlat, loadCustom, saveCustom,
    get custom() { return custom; }, setCustom(i, hex) { custom[i] = hex.toLowerCase(); },
    indexOf(id) { const i = PALETTES.findIndex(p => p.id === id); return i < 0 ? 0 : i; }
};
})(typeof self !== 'undefined' ? self : globalThis);
