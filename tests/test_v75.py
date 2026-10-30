#!/usr/bin/env python3
"""7.5 Mutiger Flug (Peter 29.10.2026: „Fraktalflug ist zu zaghaft im Heranzoomen … es geht nur darum, dass er überhaupt nicht
hineinfliegen will“). Regression der Befunde aus tests/measure_v75.py, im 2D-Zufallsflug (Mandelbrot, Startansicht, Tempo 0,3):

  A  Dauertempo nicht aus einem Bremsen beim Anfahren lernen: Schärfe 6 s lang an der Schwelle (GOV.lq = 0,45 per
     Object.defineProperty), danach scharf (1,0). Bis 7.4.3 setzte das Bremsen mit Tempo ≈ 0 das Dauertempo auf 0,03
     Zehnerpotenzen/s (+6 %/s) -> von 12 bis 32 s nur ~1,5 Zehnerpotenzen. Soll: ≥ 3,5 Zehnerpotenzen, rmax ≥ 0,2
  B  „Verloren“ × Lenk-Drossel bei scharfem Bild (FLY.lost = 1,5, FLY.zf = 0,08 festgehalten, Schärfe 1,0): bis 7.4.3
     0,4 % des Reisetempos (≈ 0 Zehnerpotenzen) und alle ~4 s Bremsen/Schweben. Soll: von 12 bis 32 s ≥ 2 Zehnerpotenzen,
     höchstens 2 Phasenwechsel (Pendel-Regel: keine Wechsel im Sekundentakt)
  C  ?mutig=0 = Verhalten 7.4.3 (Fall B: < 0,5 Zehnerpotenzen)
  D  Schärfe-Bremse bleibt: Schärfe nach 8 s grob (0,3) -> Bremsen, Tempo < 10 % des Reisetempos binnen 6 s
Aufruf: FK_HEADED=1 python3 tests/test_v75.py [--only=A,B,C,D]   (Server: python3 tools/serve.py 8472; FK_BASE für den Vorgänger)
Messung echter Zufallsstarts: tests/measure_v75.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) for a in sys.argv[1:] if '=' in a)
ONLY = ARGS.get('only', 'A,B,C,D').split(',')
fails = []


def check(c, msg):
    print(('  ok   ' if c else '  FAIL ') + msg, flush=True)
    if not c:
        fails.append(msg)


# lqF(t ms) = erzwungene Schärfe; pin = FLY-Felder festhalten (Name -> Wert); Messfenster [a, b] ms
RUN = """([lqF, pin, ms, a, b]) => new Promise(res => { const A = window.__fraktal, G = A.GOV, F = A.FLY, t0 = performance.now();
  const lq = new Function('t', 'return ' + lqF);
  Object.defineProperty(G, 'lq', { configurable: true, get() { return lq(performance.now() - t0); }, set(v) {} });
  Object.defineProperty(G, 'lqT', { configurable: true, get() { return lq(performance.now() - t0); }, set(v) {} });
  for (const k in pin) Object.defineProperty(F, k, { configurable: true, get() { return pin[k]; }, set(v) {} });
  A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false });
  let za = null, zb = null, rmaxB = null, minR = 9;
  const f = () => { const t = performance.now() - t0, L = F.lava || {}, lz = Math.log10(A.S.cam.zoom);
    if (za === null && t >= a) za = lz;
    if (zb === null && t >= b) { zb = lz; rmaxB = L.rmax; }
    if (t > 8000 && t < 14000) minR = Math.min(minR, L.r || 0);
    if (t < ms) { requestAnimationFrame(f); return; }
    delete G.lq; delete G.lqT; for (const k in pin) delete F[k];
    const log = (L.log || []).filter(x => x[0] - t0 >= a && x[0] - t0 <= b).map(x => x[1]);
    res({ dz: +(zb - za).toFixed(2), rmax: rmaxB === undefined || rmaxB === null ? null : +rmaxB.toFixed(3), wechsel: log.length, log, minR: +minR.toFixed(4),
          mutig: F.mutig === undefined ? null : F.mutig, phases: (L.log || []).map(x => x[1]).slice(0, 12) }); };
  requestAnimationFrame(f); })"""


def run(p, q, lqF, pin, ms, a, b):
    app = App(p, query='nosw&noanim' + q).open('m=0&x=-0.5&y=0&z=1')
    app.wait_done(90)
    r = app.page.evaluate(RUN, [lqF, pin, ms, a, b])
    err = app.errors[:3]
    app.close()
    r['err'] = err
    return r


def main():
    with sync_playwright() as p:
        if 'A' in ONLY:
            r = run(p, '', 't < 6000 ? 0.45 : 1', {}, 33000, 12000, 32000)
            print('   ', r)
            check(r['dz'] >= 3.5 and (r['rmax'] or 0) >= 0.2 and not r['err'],
                  f"A  nach Bremsen beim Anfahren: 12–32 s {r['dz']} Zehnerpotenzen (Soll ≥ 3,5; 7.4.3 ~1,5), rmax {r['rmax']} {r['err']}")
        for case, q in (('B', ''), ('C', '&mutig=0')):
            if case not in ONLY:
                continue
            r = run(p, q, '1', {'lost': 1.5, 'zf': 0.08}, 33000, 12000, 32000)
            print('   ', r)
            if case == 'B':
                check(r['dz'] >= 2 and r['wechsel'] <= 2 and not r['err'],
                      f"B  verloren × zf bei scharfem Bild: 12–32 s {r['dz']} Zehnerpotenzen (Soll ≥ 2), {r['wechsel']} Phasenwechsel (Soll ≤ 2) {r['err']}")
            else:
                check(r['dz'] < 0.5, f"C  ?mutig=0 wie 7.4.3: {r['dz']} Zehnerpotenzen (Soll < 0,5)")
        if 'D' in ONLY:
            r = run(p, '', 't < 8000 ? 1 : 0.3', {}, 15000, 8000, 14000)
            print('   ', r)
            check(r['minR'] < 0.03 and 'brake' in r['phases'], f"D  Schärfe-Bremse: kleinstes Tempo 8–14 s {r['minR']} (Soll < 0,03), Phasen {r['phases']}")
    print(f'\n{len(fails)} Fehler')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
