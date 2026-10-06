#!/usr/bin/env python3
"""6.4: Flug bleibt am Mengenrand – auch bei niedriger Bildrate (langsames Gerät, großer Bildschirm).

Nachgestellt mit ?fpscap=15 (App zeichnet höchstens 15 Bilder/s). Bis 6.4.0 schrumpfte der Häppchen-Regler dann die
Rechnung auf 1024 Pixel pro Bild, keine Vorschau wurde mehr fertig, die Sonde sah nur Leere und der Flug kreiste
„verloren“ (gemessen: 92 % der Zeit, Zoom blieb bei ~10⁴).
Prüft:  * Zufallsflug 40 s bei 15 fps ab dem Gesamtbild: Zoom ≥ 10⁶, Zeitanteil „verloren“ < 5 %, Rand im Bild ≥ 90 %
        * dasselbe im Querformat
        * (der Vergleich ?flyhold=0 = Verhalten bis 6.4.0 ist seit 6.5.4 entfernt; Werte in V64-Bericht/results_fly_*.json)
        * 0 Fehler
Hinweis: macOS drosselt headless zeitweise den Bildtakt auf ~10 Bilder/s – dann mit FK_HEADED=1 laufen lassen.
Aufruf: python3 tests/test_fly64.py
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_fly import lost_stats, edge_stats


def fly(p, query, land, secs):
    a = App(p, landscape=land, query='nosw&noanim&' + query).open(); pg = a.page
    a.set_view('-0.5', '0', 1); a.wait_done(120)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.set3d(true); }"); a.wait_3d(); time.sleep(1.0)
    pg.evaluate("() => { const A = window.__fraktal; A.startFly(); A.FLY.rec = []; A.FLY.recM = []; }")
    time.sleep(secs)
    r = pg.evaluate("() => { const A = window.__fraktal, F = A.FLY; const o = { rec: F.rec, recM: F.recM, zoom: A.S.cam.zoom, fps: A.status().fps }; F.rec = null; F.recM = null; A.stopFly(); return o; }")
    errs = a.errors
    a.close()
    out = dict(zoom=r['zoom'], fps=r['fps'], **lost_stats(r['rec']), **edge_stats(r['recM']))
    return out, errs


def main():
    res, ok = {}, True
    chk = []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
    with sync_playwright() as p:
        for land in (False, True):
            tag = 'quer' if land else 'hoch'
            r, errs = fly(p, 'fpscap=15', land, 40)
            res[tag] = r
            need(r['zoom'] >= 1e5 and r.get('lostTimeShare', 1) < 0.05 and r.get('edgeMidShare', 0) >= 0.9,
                 f'{tag}, 15 fps, 40 s: Zoom {r["zoom"]:.1e} ≥ 1e5, verloren {r.get("lostTimeShare")} < 0,05, Rand {r.get("edgeMidShare")} (fps {r["fps"]})')
            need(not errs, f'{tag}: 0 Fehler {errs[:3]}')
    print(json.dumps(res, indent=1))
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
