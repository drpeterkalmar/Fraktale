"""6.5.2 Grafik-Wächter: Kontextverlust und ausbleibendes erstes Bild zeigen eine Meldung statt einer leeren Fläche.

(a) 2D: Verlust -> nach 1 s Wiederherstellung: keine bleibende Meldung, Bild wieder da, 0 Fehler
(b) Verlust ohne Wiederherstellung: nach ~6 s Meldung + „Neu laden“; der Knopf lädt neu, Ort/Zoom/Welt bleiben
(c) Start-Wächter (?test_nofirstframe=1): nach 20 s (Handy) Meldung mit „Neu laden“ + „Einfache Grafik“;
    „Einfache Grafik“ lädt neu und rechnet auf dem CPU-Weg
(d) 3D: Verlust ohne Wiederherstellung -> Meldung; Verlust mit Wiederherstellung -> 3D wieder da
(e) Verlust mitten im 3D-Flug: Flug läuft danach weiter, Bild da
Screenshots der Meldungen (hoch/quer) unter tests/shots/gpu_guard_*.png.
Aufruf: python3 tests/test_gpu_guard.py [--only=a,b,c,d,e]
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
SHOTS = os.path.join(os.path.dirname(__file__), 'shots')
fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def lose(pg):
    pg.evaluate("() => { window._lc = window.__fraktal.R.gl.getExtension('WEBGL_lose_context'); window._lc.loseContext(); }")


def restore(pg):
    pg.evaluate("() => window._lc.restoreContext()")


def guard(pg):
    return pg.evaluate("() => window.__fraktal.gpuGuard()")


def note_visible(pg):
    return pg.evaluate("() => { const n = document.getElementById('gpu-note'); return !!n && !n.hidden && n.getBoundingClientRect().width > 0; }")


def center_stats(pg):
    """Mittelwert/Streuung der Bildmitte (Screenshot, ohne Bedienelemente)."""
    from PIL import Image, ImageStat
    import io
    im = Image.open(io.BytesIO(pg.screenshot())).convert('L')
    w, h = im.size
    st = ImageStat.Stat(im.crop((w // 4, h // 3, 3 * w // 4, 2 * h // 3)))
    return st.mean[0], st.stddev[0]


def case_a(p):
    print('(a) 2D: Verlust + Wiederherstellung nach 1 s')
    a = App(p).open()
    a.set_view('-0.743643887037151', '0.13182590420533', 1e5)
    a.wait_done(60)
    pg = a.page
    lose(pg)
    time.sleep(1.0)
    check(guard(pg)['lost'], 'Kontext als verloren erkannt')
    check(not note_visible(pg), 'vor 1,5 s noch keine Meldung')
    restore(pg)
    t, st = a.wait_done(60)
    time.sleep(0.5)
    g = guard(pg)
    check(g['kind'] == '' and not note_visible(pg), 'keine bleibende Meldung nach Wiederherstellung (%s)' % g)
    m, sd = center_stats(pg)
    check(sd > 8, 'Bild wieder da (Streuung Bildmitte %.1f)' % sd)
    check(pg.evaluate("() => getComputedStyle(document.getElementById('gl')).visibility") == 'visible', 'Canvas sichtbar')
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_b(p, landscape=False):
    tag = 'quer' if landscape else 'hoch'
    print('(b) Verlust ohne Wiederherstellung (%s)' % tag)
    a = App(p, landscape=landscape).open()
    pg = a.page
    pg.evaluate("() => window.__fraktal.setMode(2, true)")
    a.set_view('-1.7612', '-0.0280', 3000)
    a.wait_done(60)
    vs0 = pg.evaluate("() => window.__fraktal.viewState()")
    lose(pg)
    time.sleep(2.2)
    g = guard(pg)
    check(g['kind'] == 'wait' and note_visible(pg), 'nach 1,5 s: „wird neu verbunden“ (%s)' % g['kind'])
    pg.screenshot(path=os.path.join(SHOTS, 'gpu_guard_wait_%s.png' % tag))
    time.sleep(4.5)
    g = guard(pg)
    check(g['kind'] == 'lost' and note_visible(pg), 'nach 6 s: Verbindung verloren (%s)' % g['kind'])
    check(pg.is_visible('#gpu-reload'), 'Knopf „Neu laden“ sichtbar')
    check(pg.evaluate("() => getComputedStyle(document.getElementById('gl')).visibility") == 'hidden', 'Canvas ausgeblendet (kein weißer Canvas)')
    bg = pg.evaluate("() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]")
    check(all(b == 'rgb(5, 6, 15)' for b in bg), 'Hintergrund dunkel %s' % bg)
    pg.screenshot(path=os.path.join(SHOTS, 'gpu_guard_lost_%s.png' % tag))
    errs = list(a.errors)
    with pg.expect_navigation(timeout=30000):
        pg.click('#gpu-reload')
    pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
    vs1 = pg.evaluate("() => window.__fraktal.viewState()")
    check(vs1['formula'] == vs0['formula'], 'Welt erhalten (%s)' % vs1['formula'])
    check(abs(vs1['zoom'] / vs0['zoom'] - 1) < 1e-4, 'Zoom erhalten (%g -> %g)' % (vs0['zoom'], vs1['zoom']))
    check(vs1['cx'][:8] == vs0['cx'][:8] and vs1['cy'][:8] == vs0['cy'][:8], 'Ort erhalten (%s,%s)' % (vs1['cx'][:10], vs1['cy'][:10]))
    a.wait_done(90)
    check(guard(pg)['kind'] == '', 'nach dem Neuladen keine Meldung')
    check(not errs, 'keine Fehler %s' % errs[:3])
    a.close()


def case_c(p, landscape=False):
    tag = 'quer' if landscape else 'hoch'
    print('(c) Start-Wächter: kein erstes Bild (%s)' % tag)
    a = App(p, landscape=landscape, query='nosw&noanim&test_nofirstframe=1').open()
    pg = a.page
    time.sleep(12)
    check(guard(pg)['kind'] == '', 'nach 12 s (Handy-Grenze 20 s) noch keine Meldung')
    time.sleep(9.5)
    g = guard(pg)
    check(g['kind'] == 'stuck' and note_visible(pg), 'nach 20 s: Meldung (%s)' % g['kind'])
    check(pg.is_visible('#gpu-reload') and pg.is_visible('#gpu-simple'), '„Neu laden“ + „Einfache Grafik“ sichtbar')
    pg.screenshot(path=os.path.join(SHOTS, 'gpu_guard_stuck_%s.png' % tag))
    errs = list(a.errors)
    with pg.expect_navigation(timeout=30000):
        pg.click('#gpu-simple')
    pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
    t, st = a.wait_done(120)
    g = guard(pg)
    check(g['simple'] and g['firstPic'] and g['kind'] == '', 'Einfache Grafik aktiv, Bild da (%s)' % g)
    check(st['plan']['kind'] == 'cpu', 'CPU-Rechenweg (%s)' % st['plan'])
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}')")
    check(saved.get('renderer', 'auto') != 'cpu', 'nicht dauerhaft gespeichert')
    check(not errs, 'keine Fehler %s' % errs[:3])
    a.close()


def case_d(p):
    print('(d) 3D: Verlust ohne / mit Wiederherstellung')
    a = App(p).open()
    pg = a.page
    a.set_view('-0.743643887037151', '0.13182590420533', 1e4)
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.set3d(true)")
    check(a.wait_3d(60), '3D an')
    time.sleep(1.0)
    lose(pg)
    time.sleep(6.8)
    g = guard(pg)
    check(g['kind'] == 'lost' and note_visible(pg), '3D: nach 6 s Meldung (%s)' % g['kind'])
    restore(pg)
    time.sleep(0.5)
    check(guard(pg)['kind'] == '' and not note_visible(pg), '3D: Meldung nach Wiederherstellung weg')
    t0 = time.time()
    while time.time() - t0 < 60 and not pg.evaluate("() => window.__fraktal.RC.layers.length > 0"):
        time.sleep(0.2)
    time.sleep(2.0)
    pg.evaluate("() => window.__fraktal.settle3d()")
    m, sd = center_stats(pg)
    info = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(info['on'] and m > 10 and sd > 4, '3D-Bild wieder da (Mittel %.1f, Streuung %.1f, on=%s)' % (m, sd, info['on']))
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_e(p):
    print('(e) Verlust mitten im 3D-Flug')
    a = App(p).open()
    pg = a.page
    pg.evaluate("() => window.__fraktal.startFly()")
    check(a.wait_3d(60), '3D-Flug läuft')
    time.sleep(3)
    z0 = pg.evaluate("() => window.__fraktal.S.cam.zoom")
    lose(pg)
    time.sleep(1.0)
    restore(pg)
    time.sleep(5)
    z1 = pg.evaluate("() => window.__fraktal.S.cam.zoom")
    info = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(info['fly']['on'] and info['on'], 'Flug läuft nach der Wiederherstellung weiter')
    check(z1 > z0 * 1.5, 'Zoom wächst weiter (%.3g -> %.3g)' % (z0, z1))
    m, sd = center_stats(pg)
    check(m > 10 and sd > 4, 'Bild da (Mittel %.1f, Streuung %.1f)' % (m, sd))
    check(guard(pg)['kind'] == '', 'keine Meldung')
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


with sync_playwright() as p:
    for k, fn in [('a', lambda: case_a(p)), ('b', lambda: (case_b(p), case_b(p, True))), ('c', lambda: case_c(p)), ('d', lambda: case_d(p)), ('e', lambda: case_e(p))]:
        if ONLY and k not in ONLY:
            continue
        try:
            fn()
        except Exception as e:
            fails.append('%s: %r' % (k, e))
            print('  FAIL Ausnahme', repr(e)[:300])

print('ALL PASS' if not fails else 'FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
