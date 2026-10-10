#!/usr/bin/env python3
"""6.9 Außen (Palette / Grenznah / Schwarz) + Tempo der Farbanimation (Pixel 7, echte GPU).

Prüft:
  * Links: alter Link ohne ou = Palette; ou=e30 = Grenznah mit Saum 30 px; ou=k = Schwarz; stateURL schreibt es zurück
  * Schwarz bei schwarzer Menge -> Menge automatisch Bunt (Hinweis), zurück auf Palette -> wieder Schwarz
  * Grenznah: Bildmitte weit weg von der Menge dunkel, Randnähe hell; auch mit „Menge glatt“ aus (Distanzschätzung wird
    dann trotzdem gerechnet); Palette mit Grenznah-Saum 80 px heller als mit 4 px
  * Newton/Buddhabrot: Wahl gesperrt, Hinweis; Mandelbulb (7.0): wählbar (Hintergrund)
  * Tempo-Regler logarithmisch: unteres Ende 0,002 (1 Runde in 8,3 min), Standard 0,15 unverändert, gespeichert
Aufruf: python3 tests/test_v69.py   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

# mittlere Helligkeit eines Ausschnitts (x0, y0, x1, y1 als Anteil des Bilds) aus dem Canvas
LUM = """([x0, y0, x1, y1]) => { const A = window.__fraktal; A.snapshot(); const c = document.getElementById('gl'); const g = A.R.gl;
  const w = c.width, h = c.height, X = Math.round(x0 * w), Y = Math.round((1 - y1) * h), W = Math.round((x1 - x0) * w), H = Math.round((y1 - y0) * h);
  const px = new Uint8Array(W * H * 4); g.readPixels(X, Y, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
  let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return s / (W * H); }"""


def main():
    ok, chk = True, []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)
    with sync_playwright() as p:
        a = App(p).open(); pg = a.page
        S = lambda k: pg.evaluate(f"() => window.__fraktal.S.{k}")
        need(S('outMode') == 'pal' and abs(S('speed') - 0.15) < 1e-9, f"Standard: Außen Palette, Tempo 0,15 ({S('outMode')}, {S('speed')})")
        # Links
        for h, want in (('m=0&x=-0.5&y=0&z=1', ('pal', None)), ('m=0&x=-0.5&y=0&z=1&ou=e30', ('edge', 30)), ('m=0&x=-0.5&y=0&z=1&sc=b2&ou=k', ('black', None))):
            pg.goto('about:blank'); a.open(h); got = (S('outMode'), S('edgeW') if want[1] else None)
            url = pg.evaluate("() => window.__fraktal.stateURL()")
            need(got == want and (('ou=' not in url) if want[0] == 'pal' else ('ou=' + ('e30' if want[0] == 'edge' else 'k')) in url),
                 f"Link #{h} -> {got}, zurück: …{url[-22:]}")
        pg.goto('about:blank'); a.open('m=0&x=-0.5&y=0&z=1'); a.wait_done(60)
        # Schwarz -> Bunt automatisch
        pg.evaluate("() => { document.querySelector('[data-tab=colors]').click(); }"); time.sleep(0.6)
        pg.click('#seg-out button[data-v=black]'); time.sleep(0.3)
        t = pg.evaluate("() => [window.__fraktal.S.setCol, document.getElementById('toast').textContent, window.__fraktal.look().outM]")
        need(t[0] == 'bunt' and t[1] and t[2] == 2, f"Schwarz mit schwarzer Menge -> Bunt + Hinweis ({t})")
        pg.click('#seg-out button[data-v=pal]'); time.sleep(0.3)
        need(S('setCol') == 'black' and S('outMode') == 'pal', f"zurück auf Palette -> Menge wieder Schwarz ({S('setCol')})")
        # Grenznah: weit draußen dunkel, nah am Rand hell; auch ohne „Menge glatt“
        res = {}
        for de in (True, False):
            for ew in (4, 80):
                pg.evaluate(f"() => {{ const A = window.__fraktal; A.S.deOn = {str(de).lower()}; A.S.outMode = 'edge'; A.S.edgeW = {ew}; A.invalidate(); }}")
                time.sleep(0.8); a.wait_done(60); time.sleep(0.4)
                res[(de, ew)] = (pg.evaluate(LUM, [0.0, 0.0, 0.25, 0.12]), pg.evaluate(LUM, [0.3, 0.3, 0.7, 0.7]))
            pg.evaluate("() => { const A = window.__fraktal; A.S.outMode = 'pal'; A.invalidate(); }"); time.sleep(0.8); a.wait_done(60); time.sleep(0.4)
            res[(de, 'pal')] = (pg.evaluate(LUM, [0.0, 0.0, 0.25, 0.12]), pg.evaluate(LUM, [0.3, 0.3, 0.7, 0.7]))
        print(json.dumps({str(k): [round(x, 1) for x in v] for k, v in res.items()}))
        for de in (True, False):
            far_e, far_p = res[(de, 4)][0], res[(de, 'pal')][0]
            need(far_e < 0.15 * far_p and far_e < 8, f"Grenznah (Menge glatt {'an' if de else 'aus'}): Ecke weit draußen dunkel {far_e:.1f} gegen Palette {far_p:.1f}")
            need(res[(de, 80)][1] > res[(de, 4)][1] * 1.2, f"Grenznah (Menge glatt {'an' if de else 'aus'}): Saum 80 px heller als 4 px ({res[(de, 80)][1]:.1f} / {res[(de, 4)][1]:.1f})")
        pg.evaluate("() => { const A = window.__fraktal; A.S.deOn = true; A.invalidate(); }")
        # gesperrt in Newton/Mandelbulb
        for m in (5, 7):
            pg.evaluate(f"() => window.__fraktal.setMode({m})"); time.sleep(0.5)
            d = pg.evaluate("() => [document.querySelector('#seg-out button').disabled, window.__fraktal.look().outM]")
            need(d == [True, 0], f"Modus {m}: Außen gesperrt, ohne Wirkung ({d})")
        # 7.0: im Mandelbulb gilt Außen für den Hintergrund (Verlauf / Leuchten am Rand / schwarz)
        pg.evaluate("() => { const A = window.__fraktal; A.setMode(6); A.S.outMode = 'edge'; }"); time.sleep(0.5)
        d = pg.evaluate("() => [document.querySelector('#seg-out button').disabled, window.__fraktal.look().outM]")
        need(d == [False, 1], f"Mandelbulb: Außen wählbar, Grenznah wirkt ({d})")
        pg.evaluate("() => { window.__fraktal.S.outMode = 'pal'; }")
        pg.evaluate("() => window.__fraktal.setMode(0)")
        # Tempo logarithmisch
        pg.evaluate("() => { const r = document.getElementById('s-speed'); r.value = 0; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }")
        sp, txt = S('speed'), pg.evaluate("() => document.getElementById('o-speed').textContent")
        need(abs(sp - 0.002) < 1e-9 and '8,3' in txt and 'min' in txt, f"Tempo ganz links: {sp} ({txt})")
        pg.evaluate("() => { const r = document.getElementById('s-speed'); r.value = 1; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }")
        need(abs(S('speed') - 0.8) < 1e-9, f"Tempo ganz rechts: {S('speed')}")
        saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings')).speed")
        need(abs(saved - 0.8) < 1e-9, f"Tempo gespeichert ({saved})")
        need(not a.errors, f"keine Fehler ({a.errors[:2]})")
        a.close()
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
