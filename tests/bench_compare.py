#!/usr/bin/env python3
"""Vorher/Nachher-Benchmark: v4.8 (Stand main vor v5) gegen v5 — gleiche Views, gleicher Browser.

Methode: Headless-Chromium mit echter GPU (ANGLE/Metal) und Pixel-7-Emulation (412×915, DPR 2.625).
v4: Zustand über window.__fraktal (live+target) setzen, Zeit bis cpuTilesDone == cpuTilesTotal.
v5: setView, Zeiten bis erstes Vorschaubild / GPU-Vollbild / exaktes Endbild (inkl. CPU-Korrektur).
Zusätzlich: Long Tasks (> 50 ms) auf dem Main-Thread während des Renderns.
v4 muss auf :8473 laufen:  git archive main | tar -x -C /tmp/fk/v4 && (cd /tmp/fk/v4 && python3 -m http.server 8473)
Aufruf: python3 tests/bench_compare.py [--workers=N]
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import GPU_ARGS
from playwright.sync_api import sync_playwright

SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
VIEWS = [('seahorse_1e7', SEA[0], SEA[1], 1e7), ('seahorse_1e9', SEA[0], SEA[1], 1e9), ('seahorse_1e14', SEA[0], SEA[1], 1e14),
         ('peter_17M', '-0.8625944137', '0.2495680306', 1.705e7)]
LT = """() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({entryTypes:['longtask']}); }"""


def bench_v4(p, hc):
    b = p.chromium.launch(args=GPU_ARGS)
    ctx = b.new_context(**p.devices['Pixel 7'])
    pg = ctx.new_page()
    if hc: pg.add_init_script(f"Object.defineProperty(navigator, 'hardwareConcurrency', {{get: () => {hc}}})")
    pg.goto('http://localhost:8473/index.html?b=' + str(time.time()), wait_until='networkidle')
    pg.wait_for_timeout(1500); pg.evaluate(LT)
    res = {}
    for name, cx, cy, z in VIEWS:
        pg.evaluate("""([cx,cy,z]) => { const S = window.__fraktal.state; S.cx = new Decimal(cx); S.cy = new Decimal(cy); S.targetCx = new Decimal(cx); S.targetCy = new Decimal(cy);
            S.zoom = z; S.targetZoom = z; S.iterManual = false; S.maxIter = 300; S.refOrbitDirty = true; S.lastRenderKey = ''; S.cpuTilesTotal = 0; S.cpuTilesDone = 0; S.isFading = false; window.__lt.length = 0; window.__t0 = performance.now(); }""", [cx, cy, z])
        t0 = time.time(); started = False; ms = None
        while time.time() - t0 < 400:
            st = pg.evaluate("() => { const S = window.__fraktal.state; return [S.cpuTilesDone, S.cpuTilesTotal]; }")
            if st[1] > 0: started = True
            if started and st[0] == st[1]:
                ms = pg.evaluate("() => performance.now() - window.__t0"); break
            pg.wait_for_timeout(50)
        lt = pg.evaluate("() => window.__lt.slice()")
        res[name] = dict(finalMs=round(ms) if ms else None, longTasks=len(lt), maxLongTask=max(lt) if lt else 0)
        pg.wait_for_timeout(1200)
    b.close()
    return res


def bench_v5(p, hc):
    b = p.chromium.launch(args=GPU_ARGS)
    ctx = b.new_context(**p.devices['Pixel 7'])
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    if hc: pg.add_init_script(f"Object.defineProperty(navigator, 'hardwareConcurrency', {{get: () => {hc}}})")
    pg.goto('http://localhost:8472/index.html?nosw&noanim', wait_until='load')
    pg.wait_for_function("() => window.__fraktal && window.__fraktal.status().done", timeout=30000)
    pg.evaluate(LT)
    res = {}
    for name, cx, cy, z in VIEWS:
        pg.evaluate("""([cx,cy,z]) => { window.__lt.length = 0; const A = window.__fraktal; window.__t0 = performance.now(); window.__first = null; window.__gpu = null;
            A.setView(cx, cy, z);
            const k = () => { const s = A.status(); const f = A.RC.front;
                if (f && f.key === s.key && window.__first === null) window.__first = performance.now() - window.__t0;
                if (f && f.key === s.key && f.stage === 1 && window.__gpu === null) window.__gpu = performance.now() - window.__t0;
                if (!s.done) requestAnimationFrame(k); else window.__done = performance.now() - window.__t0; };
            window.__done = null; requestAnimationFrame(k); }""", [cx, cy, z])
        pg.wait_for_function("() => window.__done !== null", timeout=400000, polling=100)
        r = pg.evaluate("() => ({ first: window.__first, gpu: window.__gpu, done: window.__done, lt: window.__lt.slice(), st: window.__fraktal.status() })")
        res[name] = dict(firstPreviewMs=round(r['first'] or 0), gpuFullMs=round(r['gpu'] or 0), finalMs=round(r['done']), fixPct=(r['st'].get('fix') or {}).get('pct'),
                         longTasks=len(r['lt']), maxLongTask=max(r['lt']) if r['lt'] else 0, ref=r['st']['ref']['method'] if r['st']['ref'] else None)
        pg.wait_for_timeout(800)
    b.close()
    res['errors'] = errs
    return res


if __name__ == '__main__':
    hc = int(next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--workers=')), '0'))
    with sync_playwright() as p:
        v4 = bench_v4(p, hc)
        v5 = bench_v5(p, hc)
    out = {'hardwareConcurrency': hc or os.cpu_count(), 'v4': v4, 'v5': v5}
    print(json.dumps(out, indent=1))
    json.dump(out, open(os.path.join(os.path.dirname(__file__), f'results_bench{"_hc" + str(hc) if hc else ""}.json'), 'w'), indent=1)
