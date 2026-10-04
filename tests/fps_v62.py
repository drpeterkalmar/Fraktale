#!/usr/bin/env python3
"""Bildrate im sichtbaren Fenster (6.2): 3D drehen/neigen (Seepferdchen), Zufallsflug 8 s – je Standard und Alpin,
2D-Zoomfahrt; optional Mittelklasse-Profil (--throttle=4: CPU 4× gedrosselt, 4 Kerne). Pixel-7-Ansicht.
FK_BASE auf 6.1.0 + --old = Vergleich (ohne Alpin). Aufruf: python3 tests/fps_v62.py [--throttle=4] [--old] [--tag=..]"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import BASE, GPU_ARGS
from playwright.sync_api import sync_playwright
arg = lambda n, d=None: next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--' + n + '=')), d)
thr = float(arg('throttle', 1)); old = '--old' in sys.argv; tag = arg('tag', 'v620')
REC = """(secs) => new Promise(res => { const ts = []; const t0 = performance.now();
  const f = (t) => { ts.push(t); if (t - t0 < secs * 1000) requestAnimationFrame(f); else {
    const d = ts.slice(1).map((x, i) => x - ts[i]); d.sort((a, b) => a - b);
    res({ fps: +(1000 * d.length / (ts[ts.length - 1] - ts[0])).toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1), long: d.filter(x => x > 50).length }); } };
  requestAnimationFrame(f); })"""
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=GPU_ARGS, headless=False)
    ctx = b.new_context(**p.devices['Pixel 7']); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    if thr > 1:
        cdp = ctx.new_cdp_session(pg); cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
        cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
    pg.goto(BASE + '?nosw&noanim'); pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=30000)
    def done():
        t0 = time.time()
        while time.time() - t0 < 120:
            if pg.evaluate("() => window.__fraktal.status().done"): return
            time.sleep(0.2)
    looks = [('std', "S.alpine=false;S.setCol='black'")] + ([] if old else [('alpin', "S.alpine=true;S.valley='forest';S.setCol='white'")])
    # 2D: Zoomfahrt (Tour-artig, flyTo) 10^3 -> 10^7
    pg.evaluate("() => window.__fraktal.setView('-0.743637214380908705', '0.131822306549061970', 1000)"); done()
    pg.evaluate("() => { const A = window.__fraktal; A.flyTo(A.S.cam.cx, A.S.cam.cy, 1e7, { duration: 6 }); }")
    out['2d_zoom'] = pg.evaluate(REC, 6)
    for name, js in looks:
        pg.evaluate("() => { const A = window.__fraktal, S = A.S; " + js + "; A.set3d(false); }"); time.sleep(0.8)
        pg.evaluate("() => window.__fraktal.setView('-0.7453', '0.1127', 300)"); done()
        pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.5); done(); time.sleep(1)
        # drehen + neigen wie eine Geste (Darstellung, keine Neuberechnung)
        pg.evaluate("() => { const A = window.__fraktal, V = A.V3; const t0 = performance.now(); const f = (t) => { const u = (t - t0) / 1000; V.heading = 0.6 * Math.sin(u * 1.3); V.tilt = 0.6 + 0.2 * Math.sin(u * 0.9); A.RC.dirty = true; if (u < 4.2) requestAnimationFrame(f); }; requestAnimationFrame(f); }")
        out['3d_gesture_' + name] = pg.evaluate(REC, 4)
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }")
        out['fly_' + name] = pg.evaluate(REC, 8)
        out['fly_' + name]['zoom'] = '%.1e' % pg.evaluate("() => window.__fraktal.S.cam.zoom")
        pg.evaluate("() => window.__fraktal.stopFly()")
    out['errors'] = errs
    b.close()
print(json.dumps(out, indent=1))
json.dump(out, open(os.path.join(os.path.dirname(__file__), f'results_fps_{tag}{"_thr" if thr > 1 else ""}.json'), 'w'), indent=1)
