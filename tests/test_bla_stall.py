"""BLA-Neuaufbau nach verworfener Vorausrechen-Referenz (Gutachten P2-2, ab 6.5.3).

Bis 6.5.2: Im Leerlauf fordert das Vorausrechnen eine Referenz für 4× tieferen Zoom an. Springt die Ansicht, bevor sie
ankommt, verwirft die App sie – der Orbit-Worker merkt sich aber genau diese. Die BLA-Anfrage für die aktuelle Referenz
ignorierte er still, REF.blaPending blieb true, und 6–8× über der Referenz wartete ensureRef ewig auf eine schnellere
Tabelle: kein finales Bild (dauerhaft weiche Vorschau).
Ablauf: Seepferdchen 1e9; im Browser je Bild prüfen, bis (nach dem fertigen Bild) die Vorausrechen-Referenz angefragt ist, dann sofort
per setView 7× tiefer -> erwartet status().done ≤ 30 s, 0 Fehler.
Aufruf: python3 tests/test_bla_stall.py
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
        a.set_view(SEA[0], SEA[1], 1e9)
        ref0 = None
        hit = pg.evaluate("""() => new Promise((res) => {
            const A = window.__fraktal, t0 = performance.now();
            const tick = () => {
                const q = A.REF.pending;
                if (q && q.pfKey) { A.setView(%r, %r, 7e9); res(true); return; }
                if (performance.now() - t0 > 60000) { res(false); return; }
                requestAnimationFrame(tick);
            };
            tick();
        })""" % SEA)
        t1 = time.time()
        done = False
        while time.time() - t1 < 30:
            st = a.status()
            if st['done']:
                done = True
                break
            time.sleep(0.1)
        dt = time.time() - t1
        print('Lauf %d: Vorausrechen-Referenz abgefangen=%s, fertig=%s nach %.1f s, Referenz %s -> %s, blaPending=%s, Fehler %s'
              % (run + 1, hit, done, dt, ref0, st['ref'] and st['ref']['id'], pg.evaluate("() => window.__fraktal.REF.blaPending"), a.errors[:2]))
        ok &= hit and done and not a.errors
        a.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
