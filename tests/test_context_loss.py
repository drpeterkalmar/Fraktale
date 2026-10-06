"""WebGL-Kontextverlust + Wiederherstellung (Gutachten P1-3, ab 6.5.2).

(a) 2D: Seepferdchen 10⁹ fertig -> loseContext, 500 ms, restoreContext -> wieder fertig ≤ 30 s, readFront bitgleich, 0 Fehler
(b) 3D: Verlust/Wiederherstellung -> nach settle3d() ein nicht schwarzes Bild, view3dInfo().on, 0 Fehler
(c) Buddhabrot: nach der Wiederherstellung buddhaInfo().max > 0 innerhalb 5 s
Aufruf: python3 tests/test_context_loss.py [--only=a,b,c]
"""
import sys, os, time, io, hashlib
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def lose_restore(pg, ms=500):
    pg.evaluate("() => { window._lc = window.__fraktal.R.gl.getExtension('WEBGL_lose_context'); window._lc.loseContext(); }")
    time.sleep(ms / 1000)
    pg.evaluate("() => window._lc.restoreContext()")


def mean_center(pg):
    from PIL import Image, ImageStat
    im = Image.open(io.BytesIO(pg.screenshot())).convert('L')
    w, h = im.size
    return ImageStat.Stat(im.crop((w // 6, h // 4, 5 * w // 6, 3 * h // 4))).mean[0]


def case_a(p):
    print('(a) 2D Seepferdchen 1e9')
    a = App(p).open()
    a.set_view(SEA[0], SEA[1], 1e9)
    a.wait_done(90)
    f0 = a.read_front()
    h0 = hashlib.sha1(str(f0['data']).encode()).hexdigest()
    lose_restore(a.page)
    t, st = a.wait_done(30)
    f1 = a.read_front()
    h1 = hashlib.sha1(str(f1['data']).encode()).hexdigest()
    check(t <= 30, 'nach der Wiederherstellung fertig in %.1f s' % t)
    check(h0 == h1 and f0['w'] == f1['w'], 'readFront bitgleich (%s / %s)' % (h0[:10], h1[:10]))
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_b(p):
    print('(b) 3D')
    a = App(p).open()
    pg = a.page
    a.set_view(SEA[0], SEA[1], 1e4)
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.set3d(true)")
    check(a.wait_3d(60), '3D an')
    time.sleep(1.5)
    pg.evaluate("() => window.__fraktal.settle3d()")
    m0 = mean_center(pg)
    lose_restore(pg)
    a.wait_done(60)
    time.sleep(1.0)
    pg.evaluate("() => window.__fraktal.settle3d()")
    m1 = mean_center(pg)
    info = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(info['on'], 'view3dInfo().on')
    check(m1 > 10, '3D-Bild nicht schwarz (Mittel vorher %.1f, nachher %.1f)' % (m0, m1))
    check(abs(m1 - m0) < 0.25 * m0, '3D-Bild wie vorher (Helligkeit ±25 %%: %.1f / %.1f; flach = Höhen fehlen)' % (m0, m1))
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_c(p):
    print('(c) Buddhabrot')
    a = App(p).open()
    pg = a.page
    pg.evaluate("() => window.__fraktal.setMode(7)")
    t0 = time.time()
    while time.time() - t0 < 10 and pg.evaluate("() => window.__fraktal.buddhaInfo().max") <= 0:
        time.sleep(0.2)
    check(pg.evaluate("() => window.__fraktal.buddhaInfo().max") > 0, 'Buddhabrot vorher sichtbar')
    lose_restore(pg)
    t0 = time.time()
    ok = False
    while time.time() - t0 < 5:
        if pg.evaluate("() => window.__fraktal.buddhaInfo().max") > 0:
            ok = True
            break
        time.sleep(0.1)
    check(ok, 'buddhaInfo().max > 0 nach %.1f s' % (time.time() - t0))
    time.sleep(1.0)
    check(mean_center(pg) > 3, 'Buddhabrot-Bild nicht leer')
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


with sync_playwright() as p:
    for k, fn in [('a', case_a), ('b', case_b), ('c', case_c)]:
        if ONLY and k not in ONLY:
            continue
        try:
            fn(p)
        except Exception as e:
            fails.append('%s: %r' % (k, e))
            print('  FAIL Ausnahme', repr(e)[:300])

print('ALL PASS' if not fails else 'FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
