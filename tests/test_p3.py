"""Aufräumen aus dem Gutachten (P3, ab 6.5.4), was einen Browser braucht.
  * Zähler: S.cycle bleibt < 1000, S.time < 86400 (Wert knapp unter der Grenze setzen, ein Bild abwarten)
Aufruf: python3 tests/test_p3.py
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ok = True
chk = []
def need(c, what):
    global ok
    chk.append(('ok   ' if c else 'FAIL ') + what); ok &= bool(c)

with sync_playwright() as p:
    a = App(p, query='nosw').open()      # Farbanimation an (ohne noanim)
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => { const S = window.__fraktal.S; S.time = 86400 - 0.0005; S.cycle = 1000 - 0.00001; }")
    time.sleep(0.5)
    t, c = pg.evaluate("() => [window.__fraktal.S.time, window.__fraktal.S.cycle]")
    need(0 <= t < 5 and 0 <= c < 5, f'Zähler laufen um: time {t:.3f}, cycle {c:.4f}')
    need(not a.errors, f'0 Fehler {a.errors[:3]}')
    a.close()
print('\n'.join(chk))
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
