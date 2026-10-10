#!/usr/bin/env python3
"""Messung 7.0 Mandelbulb im Mittelklasse-Profil wie 6.7 (Pixel 7, DPR 2,6, CPU ×4 + 4 Kerne, echte GPU, sichtbares Fenster).

Je Lauf (hoch/quer, Stufe, GPU-Last-Simulation ?bulbslow=N = Marsch-Pass N-mal, ~N× langsamere GPU):
  * Drehen: 6 s Ziehen mit der Maus (Orbit) – Bildrate (rAF), p95 Bildzeit, Bilder > 50 ms, gewählte Auflösungsskala
  * Nahansicht ~300×: dasselbe Drehen dicht an der Oberfläche
  * Flug: 12 s ✈ – Bildrate, p95, erreichter Zoom
  * Ruhebild: Zeit vom Loslassen bis zum ersten gemittelten Bild und bis zum fertigen Bild, Zahl der Durchgänge
  * GPU-Zeit (Timer-Query, M1): Bewegungsbild bei der gewählten Skala, ein Ruhebild-Durchgang
Bildraten nur im sichtbaren Fenster aussagekräftig (FK_HEADED=1). Die GPU des Macs lässt sich nicht drosseln – dafür ?bulbslow.
Aufruf: FK_HEADED=1 python3 tests/measure_bulb.py [--land] [--slow=1,4] [--stages=balanced] [--tag=v700]
Ergebnis: tests/results_bulb_<tag>_<hoch|quer>.json
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith('--' + name + '='): return a.split('=', 1)[1]
        if a == '--' + name: return True
    return default


FPS_ON = """() => { window.__fd = []; let last = 0; window.__fdOn = true;
  const f = (t) => { if (last) window.__fd.push(t - last); last = t; if (window.__fdOn) requestAnimationFrame(f); }; requestAnimationFrame(f); }"""
FPS_OFF = "() => { window.__fdOn = false; return window.__fd; }"


def stats(d):
    d = sorted(x for x in d if x > 0)
    if not d: return {}
    return {'fps': round(1000 * len(d) / sum(d), 1), 'p95': round(d[int(len(d) * 0.95) - 1], 1), 'gt50': sum(1 for x in d if x > 50), 'n': len(d)}


def drag(pg, secs, land):
    w, h = (915, 412) if land else (412, 915)
    cx, cy = w // 2, h // 2
    pg.mouse.move(cx, cy); pg.mouse.down()
    t0 = time.time(); k = 0
    while time.time() - t0 < secs:
        k += 1
        import math
        pg.mouse.move(cx + 120 * math.sin(k * 0.05), cy + 60 * math.sin(k * 0.031), steps=1)
        time.sleep(0.016)
    pg.mouse.up()


def still_time(pg):
    t0 = time.time(); first = None
    while time.time() - t0 < 30:
        inf = pg.evaluate("() => window.__fraktal.BULB.info()")
        if first is None and inf.get('still', 0) >= 1: first = time.time() - t0
        if inf.get('still', 0) >= inf.get('K', 99): return {'first_s': round(first or 0, 2), 'done_s': round(time.time() - t0, 2), 'K': inf['K']}
        time.sleep(0.05)
    return {'first_s': first, 'done_s': None, 'K': inf.get('K')}


def main():
    land = bool(arg('land', False)); tag = arg('tag', 'cur'); thr = float(arg('throttle', 4)); dpr = float(arg('dpr', 2.6))
    slows = [int(x) for x in str(arg('slow', '1,4')).split(',')]
    stages = str(arg('stages', 'balanced')).split(',')
    ori = 'quer' if land else 'hoch'
    out = {'tag': tag, 'ori': ori, 'throttle': thr, 'dpr': dpr, 'headed': os.environ.get('FK_HEADED') == '1', 'runs': {}}
    with sync_playwright() as p:
        for st in stages:
            for sl in slows:
                a = App(p, landscape=land, query='nosw&noanim' + ('&bulbslow=%d' % sl if sl > 1 else ''), extra_ctx={'device_scale_factor': dpr}).open(); pg = a.page
                if thr > 1:
                    cdp = a.ctx.new_cdp_session(pg)
                    cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
                    cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
                pg.evaluate(f"() => {{ const A = window.__fraktal; A.S.quality = '{st}'; A.resize(); A.setMode(6); A.S.chrome = false; }}")
                time.sleep(3)
                r = {}
                for name, js in (('gesamt', ''), ('nah300', "const h = BU.pick(innerWidth*0.5, innerHeight*0.36); if (h) BU.flyToPoint(h.p, 300, 0.05, true);")):
                    if js: pg.evaluate("() => { const BU = window.__fraktal.BULB; " + js + " }"); time.sleep(1.5)
                    pg.evaluate(FPS_ON); drag(pg, 6, land); d = pg.evaluate(FPS_OFF)
                    sc = pg.evaluate("() => window.__fraktal.BULB.info().scale")
                    s1 = still_time(pg)
                    g = pg.evaluate(f"() => window.__fraktal.BULB.bench({sc}, false, 5)")
                    g2 = pg.evaluate("() => window.__fraktal.BULB.bench(1, true, 3)")
                    r['drehen_' + name] = dict(stats(d), scale=sc, still=s1, gpu_mot_ms=g and g['ms'], gpu_still_ms=g2 and g2['ms'], px=g and [g['w'], g['h']])
                    print(st, sl, name, json.dumps(r['drehen_' + name]), flush=True)
                pg.evaluate("() => { const A = window.__fraktal; A.BULB.home(); }"); time.sleep(1)
                pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }")
                pg.evaluate(FPS_ON); time.sleep(12); d = pg.evaluate(FPS_OFF)
                inf = pg.evaluate("() => window.__fraktal.BULB.info()")
                pg.evaluate("() => window.__fraktal.stopFly()")
                r['flug'] = dict(stats(d), zoom=round(inf['zoom'], 1), scale=inf['scale'])
                print(st, sl, 'flug', json.dumps(r['flug']), flush=True)
                r['errors'] = a.errors[:3]
                out['runs']['%s_slow%d' % (st, sl)] = r
                a.close()
    fn = os.path.join(os.path.dirname(__file__), f'results_bulb_{tag}_{ori}.json')
    with open(fn, 'w') as f: json.dump(out, f, indent=1)
    print('->', fn)


if __name__ == '__main__':
    main()
