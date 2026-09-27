#!/usr/bin/env python3
"""Gesten + Main-Thread-Performance (Pixel-7-Emulation, echte Touch-Events über CDP).

Prüft:  * Pinch-Zoom und Pan (mit Trägheit) verändern die Kamera wie erwartet
        * Doppeltipp = Zoom ×3, Zwei-Finger-Tipp = Zoom ÷3
        * keine Long Tasks > 50 ms während der Gesten, Bildrate (rAF) während der Gesten
        * nach Gestenende wird das Bild fertig und bleibt danach pixelgleich (kein Flackern)
Aufruf: python3 tests/test_gestures.py [--swiftshader]
"""
import sys, os, json, time, hashlib
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

VIEW = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139', 1e9)


def touch(cdp, typ, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def canvas_hash(page):
    b = page.locator('#gl').screenshot()
    return hashlib.sha1(b).hexdigest()


def run(gpu=True):
    out = {}
    ok = True
    with sync_playwright() as p:
        app = App(p, gpu=gpu).open()
        pg = app.page
        cdp = app.ctx.new_cdp_session(pg)
        pg.wait_for_timeout(600)
        app.set_view(*VIEW)
        app.wait_done(120)
        pg.evaluate("""() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({entryTypes: ['longtask']});
            window.__fr = 0; const f = () => { window.__fr++; requestAnimationFrame(f); }; requestAnimationFrame(f); }""")
        W, H = pg.evaluate("() => [innerWidth, innerHeight]")
        cx, cy = W / 2, H / 2
        z0 = pg.evaluate("() => window.__fraktal.S.cam.zoom")

        # --- Pinch-Zoom (×4 über 1.2 s), dann Pan, dann loslassen (Trägheit)
        pg.evaluate("() => { window.__lt.length = 0; window.__fr = 0; window.__t0 = performance.now(); }")
        steps = 72
        touch(cdp, 'touchStart', [(cx - 40, cy), (cx + 40, cy)])
        for k in range(1, steps + 1):
            d = 40 * (4 ** (k / steps))
            touch(cdp, 'touchMove', [(cx - d, cy), (cx + d, cy)])
            time.sleep(1 / 60)
        touch(cdp, 'touchEnd', [])
        touch(cdp, 'touchStart', [(cx, cy + 150)])
        for k in range(1, 40):
            touch(cdp, 'touchMove', [(cx - 4 * k, cy + 150 - 3 * k)])
            time.sleep(1 / 60)
        touch(cdp, 'touchEnd', [])
        pg.wait_for_timeout(900)
        g = pg.evaluate("() => ({ lt: window.__lt.slice(), frames: window.__fr, ms: performance.now() - window.__t0, zoom: window.__fraktal.S.cam.zoom })")
        out['pinch_pan'] = dict(zoomFactor=round(g['zoom'] / z0, 2), fps=round(g['frames'] * 1000 / g['ms'], 1), longTasks=g['lt'], durationS=round(g['ms'] / 1000, 2))
        ok &= 3.0 < g['zoom'] / z0 < 5.5 and not [x for x in g['lt'] if x > 50]

        # --- Doppeltipp: ×3
        app.wait_done(120)
        z1 = pg.evaluate("() => window.__fraktal.S.cam.zoom")
        pg.evaluate("() => { window.__lt.length = 0; }")
        for _ in range(2):   # ohne Pausen: CDP-Aufrufe brauchen selbst schon ~20-130 ms
            touch(cdp, 'touchStart', [(cx, cy)]); touch(cdp, 'touchEnd', [])
        pg.wait_for_timeout(900)
        z2 = pg.evaluate("() => window.__fraktal.S.cam.zoom")
        out['double_tap'] = dict(factor=round(z2 / z1, 3))
        ok &= abs(z2 / z1 - 3) < 0.05
        # --- Zwei-Finger-Tipp: ÷3
        touch(cdp, 'touchStart', [(cx - 50, cy)]); touch(cdp, 'touchStart', [(cx - 50, cy), (cx + 50, cy)])
        time.sleep(0.08); touch(cdp, 'touchEnd', [])
        pg.wait_for_timeout(900)
        z3 = pg.evaluate("() => window.__fraktal.S.cam.zoom")
        out['two_finger_tap'] = dict(factor=round(z3 / z2, 3))
        ok &= abs(z3 / z2 - 1 / 3) < 0.02
        out['longtasks_taps'] = pg.evaluate("() => window.__lt.slice()")

        # --- fertig werden, dann Stabilität (kein Flackern): 3 Hashes über 3 s
        t, st = app.wait_done(180)
        hs = []
        for _ in range(3):
            hs.append(canvas_hash(pg)); pg.wait_for_timeout(1000)
        out['after_settle'] = dict(renderS=round(t, 2), stable=len(set(hs)) == 1, fix=st.get('fix'))
        ok &= len(set(hs)) == 1
        out['errors'] = app.errors
        ok &= not app.errors
        app.close()
    return out, ok


if __name__ == '__main__':
    res, ok = run(gpu='--swiftshader' not in sys.argv)
    print(json.dumps(res, indent=1))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)
