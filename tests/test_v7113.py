#!/usr/bin/env python3
"""7.1.13: Flug-Kamera bewegt sich in jedem Bild (Peter: „Mausrad super smooth, aber der Flug ruckelt massiv“).

Ursache (gemessen am rog, Chrome, 2D-Flug Burning Ship): Der Flug-Takt (flight.js taktDt) rastete die Kamera auf die
geschätzte Bildschirm-Periode ein. Die Schätzung kannte nur 120/90/60/30 Hz (bei 240 Hz: 16,7 ms -> Kamera in 60-Hz-Schritten,
bei 100 Hz: 11,1 ms -> jedes ~10. Bild ohne Bewegung), und wechselte sie, stand die Kamera, bis die Zeit den alten Zähler
einholte: 52 % aller Flugbilder ohne Bewegung, Stillstände bis 3,9 s. Das Mausrad nutzt die echte Bildzeit und lief glatt.
Prüft (Mac, echte GPU, headless): 2D-Flug 12 s -> Anteil Bilder ohne Kamerabewegung < 3 %, kein Stillstand > 2 Bilder;
dabei die Takt-Schätzung zweimal umgeschaltet (wie der Wechsel 11,1 <-> 16,7 ms am rog) -> trotzdem kein Stillstand.
Aufruf: python3 tests/test_v7113.py   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time, re
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

REC = """() => { window.__cam = []; window.__on = true; const A = window.__fraktal;
  const f = (t) => { const c = A.S.cam; window.__cam.push([t, Math.log10(c.zoom), String(c.cx), String(c.cy)]); if (window.__on) requestAnimationFrame(f); };
  requestAnimationFrame(f); }"""


def main():
    ok, chk = True, []

    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)

    with sync_playwright() as p:
        a = App(p).open('m=2&x=-1.7609&y=-0.0275&z=60'); pg = a.page
        a.wait_done(90)
        pg.evaluate("() => window.__fraktal.startFly(undefined, { d3: false })")
        time.sleep(3)                                   # Anfahrt (2 s weich) vorbei
        pg.evaluate(REC)
        time.sleep(4)
        # Schätzung springt (wie am rog 11,1 <-> 16,7 ms): beide Takt-Werte 4 s festhalten, dann umschalten
        FIX = """(v) => { const RC = window.__fraktal.RC; for (const k of ['vsync', 'vsyncT']) Object.defineProperty(RC, k, { configurable: true, get: () => v, set: () => {} }); }"""
        pg.evaluate(FIX, 11.11); time.sleep(4)
        pg.evaluate(FIX, 16.67); time.sleep(4)
        cam = pg.evaluate("() => { window.__on = false; return window.__cam; }")
        info = pg.evaluate("() => ({ vs: window.__fraktal.RC.vsync, vsT: window.__fraktal.RC.vsyncT, fly: window.__fraktal.FLY.on })")
        s = ''.join('.' if (cam[i][1] == cam[i - 1][1] and cam[i][2] == cam[i - 1][2] and cam[i][3] == cam[i - 1][3]) else '#' for i in range(1, len(cam)))
        runs = [len(m.group()) for m in re.finditer(r'\.+', s)]
        share = s.count('.') / max(1, len(s))
        need(info['fly'] and len(cam) > 30, f"Flug läuft, {len(cam)} Bilder aufgezeichnet (Takt-Schätzung {info})")
        need(share < 0.03 and max(runs or [0]) <= 2,
             f"Kamera bewegt sich in jedem Bild: {share * 100:.1f} % ohne Bewegung, längster Stillstand {max(runs or [0])} Bilder ({s[:120]})")
        need(not a.errors, f"keine Seitenfehler ({a.errors[:2]})")
        a.close()
    print('GESAMT', 'OK' if ok else 'FEHLER')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
