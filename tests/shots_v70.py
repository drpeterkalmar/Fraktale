#!/usr/bin/env python3
"""Screenshots 7.0 Mandelbulb für die Sichtprüfung (Pixel 7, echte GPU, Ruhebild fertig gemittelt):
Gesamtansicht, Nahzoom ~10² und ~10⁴ (wie ein Nutzer per Doppeltipp: Stelle antippen, dann Bildmitte ×3), vier Stile,
Außen Grenznah/Schwarz, Julia-Bulb, Exponent 4/12, hoch und quer; Vorher/Nachher (6.9: ?bulb=0) als Collage.
Ablage tests/shots/v70/<hoch|quer>/, Blätter tests/shots/v70/blatt_<hoch|quer>.jpg, vergleich_<hoch|quer>.jpg
Aufruf: python3 tests/shots_v70.py [--only=hoch|quer] [--set=basis,stile,param]"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(__file__), 'shots', 'v70')


def arg(n):
    return next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--' + n + '=')), None)


def settle(pg, sec=90):
    time.sleep(0.6)
    t0 = time.time()
    while time.time() - t0 < sec:
        inf = pg.evaluate("() => window.__fraktal.BULB.info()")
        if inf.get('still', 0) >= inf.get('K', 99) or inf.get('ok') is False: return inf
        time.sleep(0.2)
    return inf


def zoom_to(pg, z, fx=0.5, fy=0.36):
    """Doppeltipp-Weg: erst die Stelle (fx, fy) antippen, dann immer die Bildmitte, bis Zoom ≥ z"""
    pg.evaluate("() => { const BU = window.__fraktal.BULB; BU.home(); }")
    pg.evaluate(f"() => {{ const BU = window.__fraktal.BULB; const h = BU.pick(innerWidth * {fx}, innerHeight * {fy}); if (h) BU.flyToPoint(h.p, 2, 0.02, true); }}")
    time.sleep(0.2)
    for k in range(40):
        zz = pg.evaluate("() => window.__fraktal.BULB.info().zoom")
        if zz >= z * 0.85: break
        pg.evaluate(f"() => {{ const BU = window.__fraktal.BULB; const h = BU.pick(innerWidth / 2, innerHeight / 2); if (h) BU.flyToPoint(h.p, Math.min(3, Math.max(1.05, {z} / BU.B.zoom)), 0.02, true); }}")
        time.sleep(0.15)


def label(fn, text):
    im = Image.open(fn).convert('RGB'); d = ImageDraw.Draw(im)
    d.rectangle([0, im.height - 44, im.width, im.height], fill=(0, 0, 0)); d.text((12, im.height - 34), text, fill=(255, 255, 255))
    return im


def sheet(fns, cols, s, path):
    ims = [label(f, t) for f, t in fns]
    w, h = int(ims[0].width * s), int(ims[0].height * s)
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new('RGB', (w * cols, h * rows))
    for i, im in enumerate(ims): sh.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
    sh.save(path, quality=86)


def main():
    only = arg('only'); sets = (arg('set') or 'basis,stile,param').split(',')
    res = {}
    with sync_playwright() as p:
        for land in (False, True):
            tag = 'quer' if land else 'hoch'
            if only and only != tag: continue
            d = os.path.join(OUT, tag); os.makedirs(d, exist_ok=True)
            fns = []
            a = App(p, landscape=land, query='nosw&noanim&bulbk=12').open(); pg = a.page
            pg.evaluate("() => { const A = window.__fraktal; A.S.chrome = true; A.setMode(6); }"); time.sleep(1.5)
            shot = lambda name: (pg.screenshot(path=os.path.join(d, name + '.jpg'), quality=90), os.path.join(d, name + '.jpg'))[1]
            if 'basis' in sets:
                pg.evaluate("() => window.__fraktal.BULB.home()"); inf = settle(pg); fns.append((shot('gesamt'), 'Gesamt 1x')); res[tag + '_gesamt'] = inf
                zoom_to(pg, 100); inf = settle(pg); fns.append((shot('zoom_1e2'), 'Zoom %.0f' % inf['zoom'])); res[tag + '_1e2'] = inf
                zoom_to(pg, 10000); inf = settle(pg); fns.append((shot('zoom_1e4'), 'Zoom %.3g' % inf['zoom'])); res[tag + '_1e4'] = inf
                zoom_to(pg, 300, 0.42, 0.55); inf = settle(pg); fns.append((shot('zoom_300b'), 'Zoom %.0f (2)' % inf['zoom'])); res[tag + '_300b'] = inf
            if 'stile' in sets:
                pg.evaluate("() => window.__fraktal.BULB.home()")
                for st, nm in ((1, 'stein'), (2, 'metall'), (3, 'neon')):
                    pg.evaluate(f"() => {{ const A = window.__fraktal; A.S.bulbStyle = {st}; A.RC.dirty = true; }}"); settle(pg); fns.append((shot('stil_' + nm), nm))
                pg.evaluate("() => { const A = window.__fraktal; A.S.bulbStyle = 0; A.S.outMode = 'edge'; A.RC.dirty = true; }"); settle(pg); fns.append((shot('aussen_grenznah'), 'Außen grenznah'))
                pg.evaluate("() => { const A = window.__fraktal; A.S.bulbStyle = 3; A.S.outMode = 'black'; A.RC.dirty = true; }"); settle(pg); fns.append((shot('aussen_schwarz_neon'), 'Außen schwarz + Neon'))
                pg.evaluate("() => { const A = window.__fraktal; A.S.bulbStyle = 0; A.S.outMode = 'pal'; A.RC.dirty = true; }")
            if 'param' in sets:
                pg.evaluate("() => window.__fraktal.BULB.home()")
                for pw in (4, 12):
                    pg.evaluate(f"() => {{ const BU = window.__fraktal.BULB; BU.B.power0 = BU.B.power = {pw}; BU.invalidate(); window.__fraktal.RC.dirty = true; }}"); settle(pg); fns.append((shot('exponent_%d' % pw), 'Exponent %d' % pw))
                pg.evaluate("() => { const BU = window.__fraktal.BULB; BU.B.power0 = BU.B.power = 8; BU.B.julia = true; BU.B.jc = [0.32, 0.55, -0.31]; BU.invalidate(); window.__fraktal.RC.dirty = true; }")
                settle(pg); fns.append((shot('julia_bulb'), 'Julia-Bulb'))
                pg.evaluate("() => { const BU = window.__fraktal.BULB; BU.B.julia = false; BU.invalidate(); const A = window.__fraktal; A.S.bulbDof = 0.6; A.S.bulbFog = 0.4; A.RC.dirty = true; }")
                zoom_to(pg, 30); settle(pg); fns.append((shot('dof_nebel'), 'Tiefenunschärfe + Nebel'))
                pg.evaluate("() => { const A = window.__fraktal; A.S.bulbDof = 0; A.S.bulbFog = 0.15; A.RC.dirty = true; }")
            res[tag + '_errors'] = a.errors
            a.close()
            if fns: sheet(fns, 4, 0.32 if not land else 0.25, os.path.join(OUT, f'blatt_{tag}.jpg'))
            # Vorher (6.9, ?bulb=0 = einfacher Mandelbulb) / Nachher, gleiche Ansicht
            if 'basis' in sets:
                b = App(p, landscape=land, query='nosw&noanim&bulb=0').open()
                b.page.evaluate("() => window.__fraktal.setMode(6)"); time.sleep(2.5)
                b.page.screenshot(path=os.path.join(d, 'vorher_gesamt.jpg'), quality=90)
                b.close()
                sheet([(os.path.join(d, 'vorher_gesamt.jpg'), 'vorher (6.9)'), (os.path.join(d, 'gesamt.jpg'), 'nachher (7.0)'),
                       (os.path.join(d, 'zoom_1e2.jpg'), 'nachher Zoom 1e2'), (os.path.join(d, 'zoom_1e4.jpg'), 'nachher Zoom 1e4')], 4, 0.32 if not land else 0.25, os.path.join(OUT, f'vergleich_{tag}.jpg'))
    print(json.dumps(res, default=str)[:3000])
    sys.exit(1 if any(v for k, v in res.items() if k.endswith('_errors')) else 0)


if __name__ == '__main__':
    main()
