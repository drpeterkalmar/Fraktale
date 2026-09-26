// hp.js — Hochpräzisions-Fixpunktzahlen auf BigInt-Basis (ersetzt decimal.js).
// Ein Wert ist ein BigInt v mit implizitem Nenner 2^P (P = FKHP.P Nachkommabits).
// 1088 Bits reichen bis Zoom ~1e300 plus 64 Bit Reserve. Main-Thread nutzt nur
// Addition/Konvertierung (Mikrosekunden); schwere Iteration läuft im Orbit-Worker.
(function (root) {
'use strict';

const P = 1088;
const PB = BigInt(P);
const ONE = 1n << PB;

const _dv = new DataView(new ArrayBuffer(8));

// Exakte Umwandlung double -> Fixpunkt (kein Rundungsfehler bis auf 2^-P).
function fromNumber(x) {
    if (x === 0 || !isFinite(x)) return 0n;
    _dv.setFloat64(0, x);
    const hi = _dv.getUint32(0), lo = _dv.getUint32(4);
    const neg = (hi >>> 31) === 1;
    const ex = (hi >>> 20) & 0x7ff;
    let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let e;
    if (ex === 0) e = -1074; else { mant |= 1n << 52n; e = ex - 1075; }
    const sh = e + P;
    const v = sh >= 0 ? (mant << BigInt(sh)) : roundShift(mant, -sh);
    return neg ? -v : v;
}

// v / 2^s mit Rundung zur nächsten ganzen Zahl
function roundShift(v, s) {
    if (s <= 0) return v << BigInt(-s);
    const S = BigInt(s);
    return (v + (1n << (S - 1n))) >> S;
}

function bitLength(a) { // a > 0n
    const h = a.toString(16);
    return (h.length - 1) * 4 + (32 - Math.clz32(parseInt(h[0], 16)));
}

// m * 2^e ohne Zwischen-Über/Unterlauf
function ldexp(m, e) {
    while (e > 1000) { m *= 2 ** 1000; e -= 1000; }
    while (e < -1000) { m *= 2 ** -1000; e += 1000; }
    return m * 2 ** e;
}

// Fixpunkt (mit beliebigen Nachkommabits p) -> double, volle relative Genauigkeit
function toNumberP(v, p) {
    if (v === 0n) return 0;
    const neg = v < 0n;
    const a = neg ? -v : v;
    const bl = bitLength(a);
    const sh = bl - 64;
    const r = sh > 0 ? ldexp(Number(a >> BigInt(sh)), sh - p) : ldexp(Number(a), -p);
    return neg ? -r : r;
}
function toNumber(v) { return toNumberP(v, P); }

// Dezimalstring ("-0.7436", "1.5e-3") -> Fixpunkt
function fromString(s) {
    s = String(s).trim();
    let neg = false;
    if (s[0] === '-' || s[0] === '−') { neg = true; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    let exp10 = 0;
    const ei = s.search(/[eE]/);
    if (ei >= 0) { exp10 = parseInt(s.slice(ei + 1), 10) || 0; s = s.slice(0, ei); }
    const parts = s.split('.');
    const ip = parts[0] || '0', fp = parts[1] || '';
    if (!/^\d*$/.test(ip) || !/^\d*$/.test(fp)) return 0n;
    const digits = BigInt((ip + fp) || '0');
    exp10 -= fp.length;
    let v;
    if (exp10 >= 0) v = (digits * 10n ** BigInt(exp10)) << PB;
    else {
        const den = 10n ** BigInt(-exp10);
        v = ((digits << PB) + den / 2n) / den;
    }
    return neg ? -v : v;
}

// Fixpunkt -> Dezimalstring mit fester Anzahl Nachkommastellen (gerundet)
function toString(v, digits) {
    digits = Math.max(0, Math.min(330, digits | 0));
    const neg = v < 0n;
    const a = neg ? -v : v;
    const scale = 10n ** BigInt(digits);
    const r = (a * scale + (ONE >> 1n)) >> PB;
    let s = r.toString();
    if (digits > 0) {
        s = s.padStart(digits + 1, '0');
        s = s.slice(0, s.length - digits) + '.' + s.slice(s.length - digits);
    }
    return (neg && r !== 0n ? '-' : '') + s;
}

// Sinnvolle Nachkommastellen für eine Ansicht mit gegebenem Zoom
function digitsForZoom(zoom) {
    return Math.max(6, Math.ceil(Math.log10(Math.max(1, zoom))) + 5);
}

// Fixpunkt (P Bits) auf p Bits kürzen (für Worker-Arithmetik)
function toPrecision(v, p) { return p >= P ? v << BigInt(p - P) : roundShift(v, P - p); }

// a * f (double) — für Flugpfade (Offset * Faktor)
function mulNumber(v, f) {
    if (f === 0 || v === 0n) return 0n;
    const fm = fromNumber(f); // f * 2^P
    return roundShift(v * fm, P);
}

root.FKHP = { P, ONE, fromNumber, toNumber, toNumberP, fromString, toString, digitsForZoom,
              toPrecision, roundShift, bitLength, ldexp, mulNumber };
})(typeof self !== 'undefined' ? self : globalThis);
