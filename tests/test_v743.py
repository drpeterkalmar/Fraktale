#!/usr/bin/env python3
"""7.4.3 Sonde wieder übersetzbar (Peter 27.10.2026: „Fraktale fliegen noch immer in die Menge“).

7.4.0 machte das Sonden-Programm `t3probe` unübersetzbar (`r` doppelt deklariert) -> im 2D- und 3D-Landschaftsflug keine
Sonde, keine Randsuche, kein Randläufer: der Flug tauchte blind geradeaus, oft ins Innere.
  A  2D-Zufallsflug 8 s (Kardioide 30×): kein defekter Shader, Sonde fertig, Flug-Messwerte mit Distanzdaten > 10
  B  Rand in der Bildmitte während 40 s Flug (CPU-Prüfung ZUFALL.centerOnEdge alle 0,5 s): ≥ 70 % (7.4.2: 7 %)
Aufruf: FK_HEADED=1 python3 tests/test_v743.py   (Server: python3 tools/serve.py 8472)
Ausführliche Messung über 4 Orte: tests/measure_menge_flug.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

fails = []


def check(c, msg):
    print(('  ok   ' if c else '  FAIL ') + msg, flush=True)
    if not c:
        fails.append(msg)


REC = """(ms) => new Promise(res => { const A = window.__fraktal, F = A.FLY, t0 = performance.now();
  A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false }); F.rec = []; F.recM = [];
  const E = []; let tE = 0;
  const f = () => { const t = performance.now() - t0;
    if (t - tE > 500 && t > 3000) { tE = t; E.push(!!A.ZUFALL.centerOnEdge(A.HP.toNumber(A.S.cam.cx), A.HP.toNumber(A.S.cam.cy), A.S.cam.zoom, A.S.formula)); }
    if (t < ms) { requestAnimationFrame(f); return; }
    const M = F.recM.filter(m => m.hasDE); A.stopFly();
    res({ nM: M.length, rand: E.length ? E.filter(Boolean).length / E.length : null, probeOk: A.T3.probeReady(), broken: Object.keys(A.R.broken || {}) }); };
  requestAnimationFrame(f); })"""


def main():
    with sync_playwright() as p:
        for case, ms in (('A', 8000), ('B', 40000)):
            a = App(p, query='nosw&noanim').open('m=0&x=-0.7487&y=0.0647&z=30')
            a.wait_done(120)
            r = a.page.evaluate(REC, ms)
            err = a.errors[:3]
            a.close()
            if case == 'A':
                check(not r['broken'] and r['probeOk'] and r['nM'] > 10 and not err,
                      f"A  Sonde: defekt {r['broken']}, fertig {r['probeOk']}, Messwerte {r['nM']} {err}")
            else:
                check(r['rand'] is not None and r['rand'] >= 0.7, f"B  Rand in der Bildmitte {r['rand']:.2f} (7.4.2: 0,07)")
    print(f'\n{len(fails)} Fehler')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
