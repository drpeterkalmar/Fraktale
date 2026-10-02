#!/usr/bin/env python3
"""3D-Landschaft + Flug (6.0), Pixel-7-Emulation, echte Touch-Events über CDP.

Prüft:  * 3D an/aus in allen Welten ohne Fehler; Mandelbulb/Buddhabrot: Schalter ausgeblendet, kein 3D
        * Gesten in 3D: zwei Finger drehen = Drehung, zwei Finger hoch = Neigung, spreizen = Zoom,
          ein Finger = Schieben, Doppeltipp = ×3
        * Zufallsflug 20 s ohne Fehler bis Zoom ≥ 10⁹, 0 harte Ebenenwechsel; Tippen pausiert
        * Flug zu einem gespeicherten Ort endet exakt dort
        * nach dem Ausschalten ist das 2D-Bild pixelgleich zu vorher (2D-Pfad unverändert)
        * Bedienelemente der 3D-Leiste ≥ 48 px; GPU-Zeit 3D-Bild (Timer-Query) < 16 ms (M1)
Aufruf: python3 tests/test_3d.py
"""
import sys, os, json, time, io, math
from PIL import Image, ImageChops
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from test_ui import TARGETS
from playwright.sync_api import sync_playwright

WALK = ('-0.743637214380908705', '0.131822306549061970')


def touch(cdp, typ, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def canvas_img(pg):
    return Image.open(io.BytesIO(pg.locator('#gl').screenshot())).convert('RGB')


def same_frac(a, b):
    h = ImageChops.difference(a, b).convert('L').histogram()
    return h[0] / sum(h)


def main():
    res, ok = {}, True
    chk = []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
    with sync_playwright() as p:
        # kleinere 3D-Renderauflösung: headless liefert sonst so wenige Frames, dass CDP-Touch-Ereignisse
        # für einen Doppeltipp zu spät ankommen (die Gestenerkennung selbst prüft test_gestures.py)
        a = App(p, query='nosw&noanim&s3d=0.4').open(); pg = a.page
        cdp = a.ctx.new_cdp_session(pg)
        W, H = pg.evaluate("() => [innerWidth, innerHeight]")
        # --- alle Welten an/aus
        worlds = {}
        for m in range(8):
            pg.evaluate(f"() => window.__fraktal.setMode({m})")
            if m < 6: a.wait_done(90)
            else: time.sleep(1.5)
            vis = pg.evaluate("() => !document.getElementById('btn-3d').hidden")
            pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.2)
            on = pg.evaluate("() => window.__fraktal.view3dInfo().on")
            if m < 6: a.wait_done(90)
            pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.0)
            off = not pg.evaluate("() => window.__fraktal.view3dInfo().on")
            worlds[m] = dict(button=vis, on=on, offAgain=off)
            need(vis == (m < 6) and on == (m < 6) and off, f'Welt {m}: Schalter {"sichtbar" if m < 6 else "aus"}, 3D an/aus')
        res['worlds'] = worlds
        # --- 2D vorher (Hash), 3D an, Gesten
        pg.evaluate("() => window.__fraktal.setMode(0)")
        # 2D zweimal ohne 3D rechnen: zwei Berechnungen derselben Ansicht können sich in Einzelpixeln
        # unterscheiden (z. B. neu gebaute BLA-Tabelle; Wahrheitstests bestehen beide) -> das ist die Messlatte
        rerender = lambda: (a.set_view(WALK[0], WALK[1], 1.0001e7), a.wait_done(90), a.set_view(WALK[0], WALK[1], 1e7), a.wait_done(90), time.sleep(0.6))
        a.set_view(WALK[0], WALK[1], 1e7); a.wait_done(90); time.sleep(3)
        rerender(); img1 = canvas_img(pg)
        rerender(); img2 = canvas_img(pg)
        base_same = same_frac(img1, img2)
        # 3D an, ansehen, aus (ohne Kamerabewegung) -> 2D muss wie vorher sein
        pg.click('#btn-3d'); time.sleep(1.2); a.wait_done(90); time.sleep(2)
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.0)
        rerender(); img3 = canvas_img(pg)
        after = max(same_frac(img2, img3), same_frac(img1, img3))
        res['twoD'] = dict(sameTwice=round(base_same, 4), sameAfter3d=round(after, 4))
        need(after >= base_same - 0.001, f'2D nach 3D an/aus wie zweimal 2D ({after:.4f} vs {base_same:.4f} identische Pixel)')
        pg.click('#btn-3d'); time.sleep(1.2); a.wait_done(90)
        bad = pg.evaluate(TARGETS)
        need(not bad, f'3D-Leiste: Touch-Ziele ≥ 48 px {bad}')
        g = {}
        st = lambda: pg.evaluate("() => { const A = window.__fraktal; return { h: A.V3.heading, t: A.V3.tilt, z: A.S.cam.zoom, x: A.HP.toNumber(A.S.cam.cx), y: A.HP.toNumber(A.S.cam.cy) }; }")
        s0 = st()
        cx, cy = W / 2, H / 2
        # zwei Finger drehen (90°)
        touch(cdp, 'touchStart', [(cx - 60, cy), (cx + 60, cy)])
        for k in range(1, 21):
            an = math.pi / 2 * k / 20
            touch(cdp, 'touchMove', [(cx - 60 * math.cos(an), cy - 60 * math.sin(an)), (cx + 60 * math.cos(an), cy + 60 * math.sin(an))]); time.sleep(1 / 60)
        touch(cdp, 'touchEnd', []); time.sleep(0.3)
        s1 = st(); g['rotate'] = round(s1['h'] - s0['h'], 3)
        need(abs(abs(s1['h'] - s0['h']) - math.pi / 2) < 0.25, f'Drehen: {g["rotate"]} rad')
        # zwei Finger gemeinsam hoch (Neigung +)
        touch(cdp, 'touchStart', [(cx - 60, cy + 80), (cx + 60, cy + 80)])
        for k in range(1, 16):
            touch(cdp, 'touchMove', [(cx - 60, cy + 80 - 6 * k), (cx + 60, cy + 80 - 6 * k)]); time.sleep(1 / 60)
        touch(cdp, 'touchEnd', []); time.sleep(0.3)
        s2 = st(); g['tilt'] = round(s2['t'] - s1['t'], 3)
        need(s2['t'] > s1['t'] + 0.2, f'Neigen: +{g["tilt"]} rad')
        # spreizen = Zoom ×2
        touch(cdp, 'touchStart', [(cx - 40, cy), (cx + 40, cy)])
        for k in range(1, 21):
            d = 40 * 2 ** (k / 20); touch(cdp, 'touchMove', [(cx - d, cy), (cx + d, cy)]); time.sleep(1 / 60)
        touch(cdp, 'touchEnd', []); time.sleep(0.8)
        s3 = st(); g['pinch'] = round(s3['z'] / s2['z'], 2)
        need(1.6 < s3['z'] / s2['z'] < 2.6, f'Spreizen: Zoom ×{g["pinch"]}')
        # ein Finger schieben
        touch(cdp, 'touchStart', [(cx, cy)])
        for k in range(1, 16): touch(cdp, 'touchMove', [(cx + 8 * k, cy)]); time.sleep(1 / 60)
        touch(cdp, 'touchEnd', []); time.sleep(0.8)
        s4 = st(); need(math.hypot(s4['x'] - s3['x'], s4['y'] - s3['y']) > 1e-9, 'Schieben bewegt die Ansicht')
        # Doppeltipp ×3
        a.wait_done(90)
        for attempt in range(3):          # CDP-Touch hat 20–130 ms Latenz pro Aufruf: Doppeltipp ggf. wiederholen
            z0 = st()['z']
            for _ in range(2): touch(cdp, 'touchStart', [(cx, cy)]); touch(cdp, 'touchEnd', [])
            time.sleep(1.4)
            g['dtap'] = round(st()['z'] / z0, 2)
            if abs(g['dtap'] - 3) < 0.15: break
            time.sleep(0.5)
        need(abs(g['dtap'] - 3) < 0.15, f'Doppeltipp: ×{g["dtap"]}')
        res['gestures'] = g
        # GPU-Zeit (M1)
        a.wait_done(120); time.sleep(1.5)
        gpu = pg.evaluate("() => window.__fraktal.bench3d(6)")
        res['gpu3d'] = gpu
        if gpu: need(gpu['min'] < 16, f'GPU-Zeit 3D-Bild {gpu["min"]} ms < 16 ms')
        # --- ausschalten: 2D pixelgleich
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.0)
        # --- Zufallsflug 20 s bis >= 1e9
        a.set_view('-0.7453', '0.1127', 50); a.wait_done(60)
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.8; A.set3d(true); A.V3.tilt = 50 * Math.PI / 180; }"); time.sleep(1.5)
        pg.evaluate("() => { window.__fraktal.frameStats(true); window.__fraktal.startFly(); }")
        t0 = time.time()
        while time.time() - t0 < 20: time.sleep(1)
        fs = pg.evaluate("() => window.__fraktal.frameStats()")
        zf = pg.evaluate("() => window.__fraktal.S.cam.zoom")
        fr = fs['frames']
        res['fly'] = dict(zoom='%.2e' % zf, frames=len(fr), fpsHeadless=round(len(fr) / 20, 1), hard=fs['hard'], unc=round(sum(f['unc'] for f in fr) / max(1, len(fr)), 4))
        need(zf >= 1e9, f'Flug 20 s: Zoom {zf:.2e} ≥ 1e9')
        need(fs['hard'] == 0, 'Flug: 0 harte Wechsel')
        # Tippen = Pause
        for attempt in range(3):          # Touch-Latenz unter Flug-Last: ggf. erneut tippen (nur solange nicht pausiert)
            if pg.evaluate("() => window.__fraktal.FLY.paused"): break
            touch(cdp, 'touchStart', [(cx, cy)]); touch(cdp, 'touchEnd', []); time.sleep(1.0)
        paused = pg.evaluate("() => window.__fraktal.FLY.paused")
        za = pg.evaluate("() => window.__fraktal.S.cam.zoom"); time.sleep(1.0); zb = pg.evaluate("() => window.__fraktal.S.cam.zoom")
        need(paused and za == zb, 'Tippen pausiert den Flug')
        pg.evaluate("() => window.__fraktal.stopFly()")
        # --- Flug zu einem Ort (wie ▶ Tour): Ankunft exakt
        place = dict(cx='-0.8625944137', cy='0.2495680306', zoom=1.705e7, formula=0)
        pg.evaluate("(pl) => { window.__fraktal.S.flySpeed = 1.2; window.__fraktal.startFly(pl); }", place)
        pg.wait_for_function("() => !window.__fraktal.FLY.on", timeout=60000, polling=200)
        v = pg.evaluate("() => window.__fraktal.viewState()")
        res['placeFlight'] = dict(cx=v['cx'][:14], zoom=v['zoom'])
        need(v['cx'].startswith('-0.862594413') and abs(v['zoom'] / 1.705e7 - 1) < 1e-6, 'Ortsflug endet exakt am Ort')
        a.wait_done(120)
        res['errors'] = a.errors
        need(not a.errors, '0 Page-/Console-Fehler')
        a.close()
    print(json.dumps(res, indent=1))
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
