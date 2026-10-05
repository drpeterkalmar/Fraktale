#!/usr/bin/env python3
"""6.4 Bunte Menge: Rechenzeit mit und ohne „Bunt“ (Innen-Information) – gleiche Seite, gleiche Ansichten, im Wechsel.
Gemessen: Zeit bis zum fertigen Bild (lastFullMs, inkl. Vorschau-Stufen und exakter Nachrechnung) und GPU-Zeit des
letzten Rechenjobs (lastJobMs), je Minimum aus 3 Läufen; dazu der Innen-Anteil der Ansicht.
Aufruf: python3 tests/bench_bunt.py   (Ergebnis tests/results_bench_bunt.json)"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

VIEWS = [('ganz', '-0.6', '0', 1, 0), ('seepferd_300', '-0.7453', '0.1127', 300, 0), ('spirale_1.7e7', '-0.8625944137', '0.2495680306', 1.705e7, 0),
         ('mini_3e9', '-1.749974573019448626767866732590', '0', 3e9, 0), ('julia', '0', '0', 1.3, 1)]
INFRAC = """() => { const A = window.__fraktal; const pts = []; for (let j = 0; j < 30; j++) for (let i = 0; i < 15; i++) pts.push([Math.floor((i + 0.5) * 824 / 15), Math.floor((j + 0.5) * 1678 / 30)]);
  const v = A.readFrontAt(pts).values; return v.filter(x => x < 0).length / v.length; }"""


def main():
    out = {}
    with sync_playwright() as p:
        a = App(p).open(); pg = a.page
        for vn, cx, cy, z, f in VIEWS:
            r = {}
            for mode in ('black', 'bunt'):
                ms, job = [], []
                for k in range(3):
                    pg.evaluate(f"() => {{ const A = window.__fraktal; A.setMode({f}, true); if ({f} === 1) A.setJulia(A.HP.fromString('-1'), A.HP.fromString('0.1')); A.S.setCol = '{mode}'; A.S.inMode = 1; A.invalidate(); }}")
                    a.set_view(cx, cy, z * (1 + 1e-4 * (k + 1))); a.wait_done(240)
                    st = pg.evaluate("() => window.__fraktal.status()")
                    ms.append(st['lastFullMs']); job.append(st.get('lastJobMs') or 0)
                r[mode] = dict(fullMs=round(min(ms)), jobMs=round(min(job), 1))
            r['innen'] = round(pg.evaluate(INFRAC), 3)
            r['mehr_pct'] = round(100 * (r['bunt']['fullMs'] / max(1, r['black']['fullMs']) - 1), 1)
            out[vn] = r
            print(vn, json.dumps(r), flush=True)
        out['errors'] = a.errors
        a.close()
    json.dump(out, open(os.path.join(os.path.dirname(__file__), 'results_bench_bunt.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
