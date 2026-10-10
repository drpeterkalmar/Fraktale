#!/usr/bin/env python3
"""Messung 7.1 im Mittelklasse-Profil wie 6.7 (Pixel 7, DPR 2,6, CPU ×4 + 4 Kerne, echte GPU, sichtbares Fenster):
Bildrate beim Ziehen (6 s Wischen) in den neuen Welten, bei den Lichtbildern zusätzlich die Zeit bis zum ersten ansehnlichen
Bild nach dem Loslassen (≥ 5 Punkte je Pixel in voller Auflösung, Belichtung gemessen) und mit Bildschirmschoner-Animation.
Die GPU des Macs lässt sich nicht drosseln (M1) – die Zahlen gelten für die CPU-Seite des Profils.
Aufruf: FK_HEADED=1 python3 tests/measure_v71.py [--land] [--tag=v712]   -> tests/results_v71_<tag>_<hoch|quer>.json
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_bulb import FPS_ON, FPS_OFF, stats, arg

WORLDS = [
    ('Mandelbrot Seide', "A.setMode(0); A.S.style = 1; A.invalidate(); A.setView('-0.7453', '0.1127', 180);"),
    ('Lyapunov Zirkon', "A.setMode(10); A.setWP(10, { s: 'BBBBBBAAAAAA' }); A.setView('3.7', '2.95', 3.2);"),
    ('Phoenix', "A.setMode(11); A.goHome();"),
    ('Nova', "A.setMode(12); A.goHome();"),
    ('Magnet II', "A.setMode(13); A.setWP(13, { v: 1 }); A.setView('1.2745738636', '-0.2769886364', 35.2);"),
    ('Celtic 10^5', "A.setMode(2); A.setWP(2, { v: 1 }); A.setView('-0.7667760849', '0.84677696228', 1.5e5);"),
    ('Flamme Juwel', "A.setMode(14); A.setWP(14, { g: 4, d: '' }); A.goHome();"),
    ('Attraktor De Jong', "A.setMode(15); A.setWP(15, { t: 1, a: 1.4, b: -2.3, c: 2.4, d: -2.1 }); A.goHome();"),
    ('Lorenz', "A.setMode(15); A.setWP(15, { t: 3, a: 10, b: 28, c: 2.6667, d: 0.004 }); A.goHome();"),
]


def drag(pg, secs, land):
    w, h = (915, 412) if land else (412, 915)
    cx, cy = w // 2, h // 2
    pg.mouse.move(cx, cy); pg.mouse.down()
    t0 = time.time(); k = 0
    while time.time() - t0 < secs:
        k += 1
        pg.mouse.move(cx + 100 * math.sin(k * 0.05), cy + 50 * math.sin(k * 0.031), steps=1)
        time.sleep(0.016)
    pg.mouse.up()


def main():
    land = bool(arg('land', False)); tag = arg('tag', 'cur'); thr = float(arg('throttle', 4)); dpr = float(arg('dpr', 2.6))
    ori = 'quer' if land else 'hoch'
    out = {'tag': tag, 'ori': ori, 'throttle': thr, 'dpr': dpr, 'headed': os.environ.get('FK_HEADED') == '1', 'runs': {}}
    with sync_playwright() as p:
        a = App(p, landscape=land, query='nosw&noanim', extra_ctx={'device_scale_factor': dpr}).open(); pg = a.page
        if thr > 1:
            cdp = a.ctx.new_cdp_session(pg)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
            cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
        pg.evaluate("() => { window.__fraktal.S.chrome = false; window.__fraktal.DENS.prewarm(); }")
        time.sleep(2)
        for name, js in WORLDS:
            pg.evaluate("() => { const A = window.__fraktal; A.stopAnims(); " + js + " }")
            time.sleep(4)
            pg.evaluate(FPS_ON); drag(pg, 6, land); d = pg.evaluate(FPS_OFF)
            r = dict(stats(d))
            if 'Flamme' in name or 'Attraktor' in name or 'Lorenz' in name:
                pg.evaluate("() => { window.__t0 = performance.now(); }")
                first = None
                for _ in range(200):
                    i = pg.evaluate("() => { const d = window.__fraktal.DENS.info(); return { spp: d.spp || 0, E: !!d.E, w: d.w, cw: window.__fraktal.R.canvas.width, t: performance.now() - window.__t0 }; }")
                    if i['spp'] >= 5 and i['E'] and i['w'] == i['cw']: first = round(i['t']); break
                    time.sleep(0.03)
                r['erstes_bild_ms'] = first
                if 'Flamme' in name:
                    pg.evaluate("() => window.__fraktal.setWP(14, { a: 1 })")
                    pg.evaluate(FPS_ON); time.sleep(6); d2 = pg.evaluate(FPS_OFF)
                    pg.evaluate("() => window.__fraktal.setWP(14, { a: 0 })")
                    r['animation'] = stats(d2)
            r['info'] = pg.evaluate("() => { const A = window.__fraktal; return A.isDens() ? A.DENS.info() : { plan: A.status().plan }; }")
            out['runs'][name] = r
            print(name, json.dumps(r), flush=True)
        out['errors'] = a.errors[:5]
        a.close()
    fn = os.path.join(os.path.dirname(__file__), f'results_v71_{tag}_{ori}.json')
    with open(fn, 'w') as f: json.dump(out, f, indent=1, ensure_ascii=False)
    print('->', fn)


if __name__ == '__main__':
    main()
