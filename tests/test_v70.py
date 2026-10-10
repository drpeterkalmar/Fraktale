#!/usr/bin/env python3
"""7.0 Mandelbulb (js/bulb.js), echte GPU, Pixel 7.

Prüft:
  * Start: neue Darstellung aktiv, Ruhebild wird fertig gemittelt (auch mit laufender Farbanimation), Bild nicht leer
  * Hineinzoomen wie per Doppeltipp bis ≥ 10⁴: Taylor-Anker aktiv, Bild detailreich; Rauschmaß mit Anker kleiner als ohne
    (gleiche Ansicht, B.noTay); Grenze: weiter hinein geht nicht, Hinweis, Abstand ≥ Mindestabstand
  * ✈ Flug: läuft, Zoom steigt; Tippen = Pause; ⇄ rückwärts bis „Ganz draußen“; Vollbild-Größenwechsel unterbricht nicht
  * Link: b= in der Adresse, Öffnen stellt Kamera/Exponent/Julia exakt her; alter Link (m=6, x/y/z) öffnet
  * Orte: Rundflug landet exakt auf der gespeicherten Kamera
  * Langdruck = Julia-Bulb mit c = Oberflächenpunkt; Tiefenunschärfe: Tipp setzt den Fokus; Taste R = zurück zur Startansicht
Aufruf: python3 tests/test_v70.py   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

# Rauschmaß: mittlerer Betrag des Laplace-Operators der Helligkeit in der Bildmitte (512×512 Canvas-Pixel)
NOISE = """() => { const A = window.__fraktal; A.snapshot(); const g = A.R.gl, c = A.R.canvas, w = 512, h = 512;
  const x0 = (c.width - w) >> 1, y0 = (c.height - h) >> 1, px = new Uint8Array(w * h * 4); g.readPixels(x0, y0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
  const L = (x, y) => { const i = 4 * (y * w + x); return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
  let s = 0, n = 0, m = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const l = L(x, y); s += Math.abs(4 * l - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1)); n++; m += l; m2 += l * l; }
  m /= n; return { lap: s / n, std: Math.sqrt(Math.max(0, m2 / n - m * m)), mean: m }; }"""


def main():
    ok, res = True, {}
    def need(c, what):
        nonlocal ok
        print(('ok ' if c else 'FAIL ') + what, flush=True); ok &= bool(c)
    def settle(pg, sec=120):
        time.sleep(0.5); t0 = time.time()
        while time.time() - t0 < sec:
            inf = pg.evaluate("() => window.__fraktal.BULB.info()")
            if inf.get('still', 0) >= inf.get('K', 99): return inf, time.time() - t0
            time.sleep(0.15)
        return inf, time.time() - t0
    def zoom_to(pg, z):
        pg.evaluate("() => window.__fraktal.BULB.home()")
        pg.evaluate("() => { const BU = window.__fraktal.BULB; const h = BU.pick(innerWidth * 0.5, innerHeight * 0.36); if (h) BU.flyToPoint(h.p, 2, 0.02, true); }")
        time.sleep(0.2)
        for k in range(40):
            if pg.evaluate("() => window.__fraktal.BULB.info().zoom") >= z * 0.85: break
            pg.evaluate(f"() => {{ const BU = window.__fraktal.BULB; const h = BU.pick(innerWidth / 2, innerHeight / 2); if (h) BU.flyToPoint(h.p, Math.min(3, Math.max(1.05, {z} / BU.B.zoom)), 0.02, true); }}")
            time.sleep(0.15)
    with sync_playwright() as p:
        a = App(p, query='nosw&bulbk=8&bulbrows=4000').open(); pg = a.page
        pg.evaluate("() => { const A = window.__fraktal; A.S.anim = true; A.setMode(6); }")
        inf, dt = settle(pg)
        need(inf['ok'] is True and inf['still'] >= inf['K'], f"Start: neue Darstellung, Ruhebild fertig trotz Farbanimation ({inf['still']}/{inf['K']} in {dt:.1f} s)")
        nz = pg.evaluate(NOISE); res['start'] = nz
        need(nz['std'] > 15, f"Bild nicht leer (Spanne {nz['std']:.1f})")
        pg.evaluate("() => { window.__fraktal.S.anim = false; }")
        # --- Zoom ≥ 10⁴, Anker, Rauschen mit/ohne Anker
        zoom_to(pg, 20000)
        inf, _ = settle(pg)
        res['z'] = inf
        need(inf['zoom'] >= 1e4 and inf['anchor'], f"Zoom {inf['zoom']:.3g} ≥ 10⁴ mit Taylor-Anker, Iterationen {inf['iter']}")
        n1 = pg.evaluate(NOISE)
        pg.evaluate("() => { const BU = window.__fraktal.BULB; BU.B.noTay = true; BU.invalidate(); window.__fraktal.RC.dirty = true; }")
        settle(pg); n0 = pg.evaluate(NOISE)
        pg.evaluate("() => { const BU = window.__fraktal.BULB; BU.B.noTay = false; BU.invalidate(); window.__fraktal.RC.dirty = true; }")
        settle(pg)
        res['noise_anker'] = n1; res['noise_ohne'] = n0
        need(n1['std'] > 10, f"Bild bei {inf['zoom']:.3g} detailreich (Spanne {n1['std']:.1f})")
        need(n1['lap'] < n0['lap'], f"Rauschmaß mit Anker {n1['lap']:.2f} < ohne Anker {n0['lap']:.2f}")
        # Grenze
        r = pg.evaluate("""() => { const A = window.__fraktal, BU = A.BULB, B = BU.B; const z0 = B.zoom;
            for (let k = 0; k < 30; k++) { const h = BU.pick(innerWidth / 2, innerHeight / 2); if (!h) break; BU.zoomToward({ pos: B.pos }, h.p, 3); BU.update(performance.now(), 0); }
            return { z0, z: B.zoom, limit: B.limit, toast: document.getElementById('toast').textContent, d: B.dSurf, dmin: BU.minDist() }; }""")
        res['limit'] = r
        need(r['limit'] and 'genauigkeit' in r['toast'].lower() and r['d'] >= r['dmin'] * 0.99 and r['z'] < 1.5e5, f"Grenze: Zoom {r['z']:.3g}, Hinweis „{r['toast'][:40]}…“, Abstand {r['d']:.2e} ≥ {r['dmin']:.2e}")
        # --- Taste R: zurück
        pg.keyboard.press('r'); time.sleep(1.4)
        z = pg.evaluate("() => window.__fraktal.BULB.info().zoom")
        need(abs(z - 1) < 0.05, f"Taste R: Startansicht (Zoom {z:.3f})")
        # --- Flug
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(6)
        f = pg.evaluate("() => ({ on: window.__fraktal.FLY.on, mode: window.__fraktal.FLY.mode, z: window.__fraktal.BULB.info().zoom })")
        need(f['on'] and f['mode'] == 'bulb' and f['z'] > 8, f"Flug läuft, Zoom {f['z']:.3g} nach 6 s")
        pg.evaluate("() => window.__fraktal.pauseFly(true)"); z1 = pg.evaluate("() => window.__fraktal.BULB.info().zoom"); time.sleep(1.0)
        z2 = pg.evaluate("() => window.__fraktal.BULB.info().zoom")
        need(abs(z2 - z1) / z1 < 1e-6, 'Pause hält an')
        pg.evaluate("() => window.__fraktal.pauseFly(false)")
        # Vollbild-/Größenwechsel im Flug
        pg.set_viewport_size({'width': 915, 'height': 412}); time.sleep(1.5)
        f2 = pg.evaluate("() => ({ on: window.__fraktal.FLY.on, z: window.__fraktal.BULB.info().zoom })")
        need(f2['on'] and f2['z'] > f['z'], f"Drehen/Vollbild: Flug läuft weiter (Zoom {f2['z']:.3g})")
        pg.set_viewport_size({'width': 412, 'height': 915}); time.sleep(1.0)
        pg.evaluate("() => window.__fraktal.reverseFly()")
        t0 = time.time()
        while time.time() - t0 < 40:
            st = pg.evaluate("() => ({ sp: window.__fraktal.FLY.sp, out: !!window.__fraktal.FLY.out, z: window.__fraktal.BULB.info().zoom })")
            if st['out']: break
            time.sleep(0.3)
        need(st['out'] and st['z'] < 1.1, f"Rückflug bis „Ganz draußen“ (Zoom {st['z']:.3f}, {time.time() - t0:.1f} s)")
        pg.evaluate("() => window.__fraktal.stopFly()")
        # --- Link
        zoom_to(pg, 300)
        pg.evaluate("() => { const BU = window.__fraktal.BULB; BU.B.power0 = BU.B.power = 7.5; BU.B.julia = true; BU.B.jc = [0.3, 0.5, -0.2]; BU.invalidate(); }")
        url = pg.evaluate("() => window.__fraktal.stateURL()")
        st0 = pg.evaluate("() => { const B = window.__fraktal.BULB.B; return [B.pos, B.yaw, B.pitch, B.power0, B.julia, B.jc]; }")
        need('b=' in url, 'Link enthält b=')
        pg.goto('about:blank'); a.open(url.split('#', 1)[1]); time.sleep(1.0)
        st1 = pg.evaluate("() => { const B = window.__fraktal.BULB.B; return [B.pos, B.yaw, B.pitch, B.power0, B.julia, B.jc]; }")
        err = max(abs(x - y) for x, y in zip(st0[0], st1[0]))
        need(err < 1e-10 and abs(st0[1] - st1[1]) < 1e-10 and st1[3] == 7.5 and st1[4] and st1[5] == [0.3, 0.5, -0.2], f"Link stellt die Ansicht her (Abweichung {err:.1e})")
        pg.goto('about:blank'); a.open('m=6&x=0.1&y=0.05&z=2'); time.sleep(1.5)
        inf = pg.evaluate("() => window.__fraktal.BULB.info()")
        need(inf['ok'] is True and 1.2 < inf['zoom'] < 20, f"alter Link (6.9) öffnet, näher dran als die Startansicht (Zoom {inf['zoom']:.2f})")
        # --- Ort: Rundflug landet exakt
        pg.goto('about:blank'); a.open('m=6&x=0&y=0&z=1'); time.sleep(1.0)
        zoom_to(pg, 500)
        v = pg.evaluate("() => window.__fraktal.viewState()")
        tgt = pg.evaluate("() => window.__fraktal.BULB.B.pos")
        pg.evaluate("() => window.__fraktal.BULB.home()")
        pg.evaluate("(v) => window.__fraktal.startTour(v)", v); time.sleep(8.5)
        got = pg.evaluate("() => window.__fraktal.BULB.B.pos")
        e = max(abs(x - y) for x, y in zip(tgt, got))
        need(e < 1e-12, f"Ort: Rundflug landet exakt (Abweichung {e:.1e})")
        # --- Langdruck = Julia-Bulb, Fokus per Tipp
        pg.evaluate("() => { const BU = window.__fraktal.BULB; BU.home(); BU.B.julia = false; }"); time.sleep(0.5)
        r = pg.evaluate("() => { const BU = window.__fraktal.BULB; const ok = BU.G.longPress(innerWidth / 2, innerHeight * 0.45); return [ok, BU.B.julia, BU.B.jc, document.getElementById('toast').textContent]; }")
        need(r[0] and r[1] and 'Julia' in r[3], f"Langdruck: Julia-Bulb c = {[round(x, 3) for x in r[2]]}")
        r = pg.evaluate("() => { const A = window.__fraktal, BU = A.BULB; BU.B.julia = false; A.S.bulbDof = 0.5; const ok = BU.G.tap(innerWidth / 2, innerHeight * 0.45); return [ok, BU.B.focus]; }")
        need(r[0] and r[1] > 0, f"Tiefenunschärfe: Tipp setzt Fokus ({r[1]:.3f})")
        pg.evaluate("() => { window.__fraktal.S.bulbDof = 0; }")
        need(not a.errors, f"keine Fehler {a.errors[:3]}")
        a.close()
    with open(os.path.join(os.path.dirname(__file__), 'results_v70.json'), 'w') as fo: json.dump(res, fo, indent=1, default=str)
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
