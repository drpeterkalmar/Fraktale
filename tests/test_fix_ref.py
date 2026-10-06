"""Neue Referenz mitten in der exakten Nachrechnung (Gutachten P1-1, ab 6.5.3).

Bis 6.5.2: Die CPU-Worker antworteten auf die offenen Nachrechen-Pakete (alte Referenz) mit missingRef, die App
schickte dasselbe Paket mit der alten refId erneut – Endlosschleife, das Bild wurde nie fertig (Spinner bei 50 %).
Ablauf: Seepferdchen 10¹⁴, warten bis status().fixing, testNewRef() -> erwartet status().done ≤ 20 s, 0 Fehler.
Aufruf: python3 tests/test_fix_ref.py
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
ok = True
with sync_playwright() as p:
    for run in range(2):
        a = App(p).open()
        pg = a.page
        a.set_view(SEA[0], SEA[1], 1e14)
        t0 = time.time()
        while time.time() - t0 < 120 and not a.status()['fixing']:
            time.sleep(0.02)
        st = a.status()
        if not st['fixing']:
            print('FAIL Nachrechnung nicht beobachtet', st['done'])
            ok = False
            a.close()
            continue
        ref0 = st['ref']['id']
        pg.evaluate("() => window.__fraktal.testNewRef()")
        t1 = time.time()
        done = False
        while time.time() - t1 < 20:
            st = a.status()
            if st['done']:
                done = True
                break
            time.sleep(0.1)
        dt = time.time() - t1
        print('Lauf %d: Referenz %s -> %s, fertig=%s nach %.1f s, fixing=%s, Fehler %s' % (run + 1, ref0, st['ref'] and st['ref']['id'], done, dt, st['fixing'], a.errors[:2]))
        ok &= done and not a.errors and st['ref']['id'] != ref0
        a.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
