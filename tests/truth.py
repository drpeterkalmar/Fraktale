#!/usr/bin/env python3
"""Unabhängige Wahrheit: direkte Iteration in Python-Decimal (keine Perturbation, kein JS-Code).

Eingabe (JSON auf stdin oder Datei): {
  "cx": "-0.74...", "cy": "0.13...",          # Ansichtsmitte (Dezimalstring)
  "zoom": "1e9",                                # Zoom (Dezimalstring oder float-repr)
  "W": 412, "H": 915,                           # Puffergröße in Pixeln
  "formula": 0, "maxIter": 4050,                # 0 Mandelbrot, 1 Julia, 2 Burning Ship, 3 Tricorn, 4 z^3
  "jx": "-0.8", "jy": "0.156",                  # Julia-Konstante
  "pixels": [[i, j], ...]                       # i von links, j von OBEN
}
Pixel->c (App-Konvention): s = 3/(zoom*H); c = (cx + (i+0.5-W/2)*s, cy - (j+0.5-H/2)*s)
Ausgabe: Liste glatter Iterationswerte mu = n + 1 - log2(log2|z_n|) (z^3: log_3), Inneres = -1.
"""
import json, sys, math
from decimal import Decimal, getcontext
from multiprocessing import Pool

BAIL = Decimal(256)


def iterate(args):
    cx, cy, formula, maxIter, jx, jy, prec = args
    getcontext().prec = prec
    if formula == 1:
        zx, zy, ax, ay = cx, cy, jx, jy
        if zx * zx + zy * zy > BAIL:
            return smooth(0, zx, zy, formula)
    else:
        zx, zy, ax, ay = Decimal(0), Decimal(0), cx, cy
    for n in range(1, maxIter + 1):
        x2, y2 = zx * zx, zy * zy
        if formula == 2:
            nx = x2 - y2 + ax; ny = abs(2 * zx * zy) + ay
        elif formula == 3:
            nx = x2 - y2 + ax; ny = -2 * zx * zy + ay
        elif formula == 4:
            nx = zx * (x2 - 3 * y2) + ax; ny = zy * (3 * x2 - y2) + ay
        else:
            nx = x2 - y2 + ax; ny = 2 * zx * zy + ay
        zx, zy = nx, ny
        if zx * zx + zy * zy > BAIL:
            return smooth(n, zx, zy, formula)
    return -1.0


def smooth(n, zx, zy, formula):
    r2 = float(zx * zx + zy * zy)
    l2 = 0.5 * math.log2(r2)
    if formula == 4:
        return n + 1 - math.log(l2) / math.log(3)
    return n + 1 - math.log2(l2)


def truth(spec):
    zoom = Decimal(str(spec["zoom"]))
    digits = max(30, int(math.log10(float(zoom))) + 30)
    getcontext().prec = digits
    W, H = int(spec["W"]), int(spec["H"])
    cx, cy = Decimal(spec["cx"]), Decimal(spec["cy"])
    s = Decimal(3) / (zoom * H)
    jx = Decimal(spec.get("jx", "0")); jy = Decimal(spec.get("jy", "0"))
    # Konditionierung: zusätzlich an c + 1e-6 Pixel (x) und (y) — weicht die Wahrheit dort ab,
    # ist der Pixel schlecht konditioniert (Rand liegt << 1 Pixel entfernt).
    cond = bool(spec.get("cond", False))
    delta = s * Decimal("1e-6")
    jobs = []
    for (i, j) in spec["pixels"]:
        px = cx + (Decimal(i) + Decimal("0.5") - Decimal(W) / 2) * s
        py = cy - (Decimal(j) + Decimal("0.5") - Decimal(H) / 2) * s
        jobs.append((px, py, int(spec["formula"]), int(spec["maxIter"]), jx, jy, digits))
        if cond:
            jobs.append((px + delta, py, int(spec["formula"]), int(spec["maxIter"]), jx, jy, digits))
            jobs.append((px, py + delta, int(spec["formula"]), int(spec["maxIter"]), jx, jy, digits))
    with Pool() as pool:
        res = pool.map(iterate, jobs, chunksize=4)
    if not cond:
        return res
    return [res[k:k + 3] for k in range(0, len(res), 3)]


if __name__ == "__main__":
    spec = json.load(open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin)
    print(json.dumps(truth(spec)))
