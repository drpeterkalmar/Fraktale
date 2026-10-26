#!/usr/bin/env python3
"""Flug im tiefen Mandelbrot (Peter: „ab ein paar Quintillionen fängt der Flug an zu pixeln“) – Regression der Befunde.

  A  Kein Durchgehen nach der Anfahrt: Ein kurzer Schärfe-Einbruch während der Anfahrt (GOV.lq per Object.defineProperty
     1,0 → 0,05 → 1,0) setzte bis 7.3.0 die Beschleunigung des Lavalampen-Reglers auf (Sprung / Bildzeit) ≈ 9 Zehnerpotenzen/s²
     statt höchstens A ≈ 0,1 – die Bremse holte das nie ein, der Flug raste bis 10²⁹⁰ (gemessen ab 10¹⁸ in ~1 von 5 Flügen).
     Soll: |Beschleunigung| ≤ A, Zoomtempo nie > 1 Zehnerpotenz/s, nach 8 s weniger als 3 Zehnerpotenzen weiter
  B  Deep-Zoom-Flug 10¹⁸ und 10¹⁹ (Seepferdchental, 3 × 15 s, tests/measure_deep_fly.py): nie durchgegangen, grob im Mittel ≤ 25 %
     (7.3.0: 32–53 %; je Lauf streut es 0–40 %, je nachdem ob die Lavalampe herauszoomt), 0 harte Wechsel, keine Fehler
Aufruf: FK_HEADED=1 python3 tests/test_v731.py [--only=A,B]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
import e2e_lib
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
if 'base' in ARGS:
    e2e_lib.BASE = ARGS['base']
ONLY = set(ARGS.get('only', 'A,B').split(','))
import measure_deep_fly as D
WALK = D.WALK
fails, res = [], {}
OUT = os.path.join(os.path.dirname(__file__), 'results_v731.json')


def check(c, msg):
    print(('  ok   ' if c else '  FAIL ') + msg, flush=True)
    if not c:
        fails.append(msg)


# Schärfe-Einbruch in der Anfahrt erzwingen: GOV.lq als Eigenschaft (governorUpdate schreibt hinein, der Wert kommt vom Test)
DIP = """(ms) => new Promise(res => { const A = window.__fraktal, G = A.GOV, t0 = performance.now();
  Object.defineProperty(G, 'lq', { configurable: true, get() { const t = performance.now() - t0; return t > 900 && t < 1400 ? 0.05 : 1; }, set(v) {} });
  A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false });
  let maxA = 0, maxR = 0; const z0 = Math.log10(A.S.cam.zoom);
  const f = () => { const L = A.FLY.lava || {}; maxA = Math.max(maxA, Math.abs(L.a || 0)); maxR = Math.max(maxR, L.r || 0);
    if (performance.now() - t0 < ms) requestAnimationFrame(f);
    else { delete G.lq; res({ maxA: +maxA.toFixed(3), maxR: +maxR.toFixed(3), dz: +(Math.log10(A.S.cam.zoom) - z0).toFixed(2), phases: (A.FLY.lava && A.FLY.lava.log || []).map(x => x[1]) }); } };
  requestAnimationFrame(f); })"""


def case_A(p):
    print('A  kein Durchgehen nach einem Schärfe-Einbruch in der Anfahrt')
    res['A'] = []
    for z in ['1e6', '1e18']:
        a = App(p).open(f'm=0&x={WALK[0]}&y={WALK[1]}&z={z}')
        a.wait_done(120)
        r = a.page.evaluate(DIP, 8000)
        r['zoom'] = z
        res['A'].append(r)
        # A = Reisetempo / (0,6 · τ) mit τ = 1 s in den ersten 2 s, sonst 3–5 s: höchstens 0,3 / 0,6 = 0,5
        check(r['maxA'] <= 0.5 and r['maxR'] <= 1 and r['dz'] < 3 and not a.errors,
              f"Start {z}: größte Beschleunigung {r['maxA']} (≤ 0,5), größtes Zoomtempo {r['maxR']} /s, nach 8 s {r['dz']:+} Zehnerpotenzen, Phasen {r['phases'][:5]} {a.errors[:2]}")
        a.close()


def case_B(p):
    print('B  Deep-Zoom-Flug 10¹⁸/10¹⁹: nie durchgegangen, grob im Mittel ≤ 25 %')
    D.SECS = 15
    res['B'] = []
    for z in [1e18, 1e19]:
        rs = [D.run(p, WALK[0], WALK[1], z) for _ in range(3)]
        for r in rs:
            r.pop('samples', None)
        res['B'] += rs
        m = sum(r['coarse'] for r in rs) / len(rs)
        check(all(r['lz1'] - r['lz0'] < 3 for r in rs) and m <= 0.25 and all(r['hard'] == 0 and not r['errors'] for r in rs),
              f"{z:.0e}: grob {[round(r['coarse'] * 100, 1) for r in rs]} % (Mittel {m * 100:.1f} %), Zoom {[(r['lz0'], r['lz1']) for r in rs]}, "
              f"harte Wechsel {[r['hard'] for r in rs]} {[r['errors'] for r in rs if r['errors']][:1]}")


def main():
    with sync_playwright() as p:
        if 'A' in ONLY: case_A(p)
        if 'B' in ONLY: case_B(p)
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print(f'\n{len(fails)} Fehler')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
