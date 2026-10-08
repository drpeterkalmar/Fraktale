#!/usr/bin/env python3
"""Live-Prüfung nach dem Push (GitHub Pages): Version live = lokal, App kommt hoch, 3D blendet ein, 0 Seitenfehler.
Wartet, bis Pages die neue Version ausliefert (bis --wait Sekunden). Aufruf: python3 tests/live_check.py [--wait=300] [--query=…]
"""
import sys, os, re, time, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('FK_BASE', 'https://drpeterkalmar.github.io/Fraktale/index.html')
from e2e_lib import App
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = 'https://drpeterkalmar.github.io/Fraktale/'


def arg(n, d=None):
    return next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--' + n + '=')), d)


def main():
    local = re.search(r"const APP_VERSION = '([\d.]+)'", open(os.path.join(ROOT, 'js', 'app.js')).read()).group(1)
    t0, live = time.time(), None
    while time.time() - t0 < float(arg('wait', 300)):
        try:
            s = urllib.request.urlopen(LIVE + 'js/app.js?x=%d' % time.time(), timeout=20).read().decode()
            live = re.search(r"const APP_VERSION = '([\d.]+)'", s).group(1)
        except Exception as e:
            live = 'Fehler: %s' % e
        if live == local: break
        time.sleep(15)
    print('Version lokal', local, '| live', live)
    if live != local: sys.exit(1)
    out = {}
    with sync_playwright() as p:
        a = App(p, query='nosw&x=%d' % time.time() + ('&' + arg('query') if arg('query') else '')).open(); pg = a.page
        out['version'] = pg.evaluate("() => window.__fraktal.APP_VERSION")
        a.wait_done(90)
        pg.evaluate("() => window.__fraktal.set3d(true)")
        out['3d'] = a.wait_3d(40); a.wait_done(90); time.sleep(1.5)
        out['gpu'] = pg.evaluate("() => { const i = window.__fraktal.view3dInfo().gpu; return i && { stage: i.stage, flags: i.flags, grid: i.grid, gridDiv: i.gridDiv, fallback: i.fallback }; }")
        out['errors'] = a.errors
        a.close()
    print(json.dumps(out, ensure_ascii=False))
    ok = out['version'] == local and out['3d'] and not out['errors']
    print('LIVE OK' if ok else 'LIVE FEHLER')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
