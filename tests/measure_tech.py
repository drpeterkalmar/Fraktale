#!/usr/bin/env python3
"""E0/E5 (6.7 Technik): Messung „Mittelklasse-Android“ je Stufe (Akku/Ausgewogen/Maximal) – vorher/nachher-Tabelle.

Profil: Pixel 7, DPR 2,6 (--dpr), CPU ×4 gedrosselt + 4 Kerne (--throttle), hoch oder quer (--land), echte GPU (ANGLE/Metal).
Szenen je Stufe (Seepferdchen-Tal 300×, wie measure_fly.py):
  * zoom2d   2D-Zoom (Flug per goTo ×1000) über --zsecs s: Bildzeiten (rAF) + GPU-Zeit des Display-Passes (benchGPU)
  * still3d  3D-Stillstand nach der Mittelung: Bildzeiten (rAF, sollte ruhen) + GPU-Zeit eines Stillstands- und eines
             Bewegungsbilds (bench3d: Timer-Query um T3.render)
  * fly3d    3D-Flug --secs s (Standard 10): Bildzeiten (rAF), GPU-Zeit eines Flugbilds am Ende (bench3d), Zoomtiefe
Je Szene: p50/p95/max (ms), fps, Bilder > 50 ms; GPU min/max (ms); Renderskala/Gitter/Ziel aus T3.info().
Läuft mit denselben Hooks auf 6.6.0 (Vorher-Messung auf main) und auf 6.7 (dort zusätzlich Regler/Stufe/Gitterteiler).
Ladegröße: Summe der ausgelieferten Code-Dateien (index.html, style.css, translations.js, manifest, sw.js, js/*.js) in KB.
Bildraten nur im sichtbaren Fenster aussagekräftig (FK_HEADED=1; headless drosselt macOS auf ~10–15 Bilder/s).
--shots: Standbilder je Stufe/Szene nach tests/shots/technik/<tag>_<hoch|quer>_<stufe>_<szene>.jpg; mit --moods (nur 6.7,
T3.sunEl/sunAz) zusätzlich je Stimmung Morgen/Mittag/Abend im 3D-Stillstand. --query=… hängt URL-Regler an (z. B. taa=1).
Aufruf (Server auf :8472, ein Browser):
  FK_HEADED=1 python3 tests/measure_tech.py --tag=vorher [--land] [--throttle=4] [--dpr=2.6] [--secs=10] [--stages=eco,balanced,max]
  python3 tests/measure_tech.py --compare=tests/results_tech_vorher_hoch_thr4.json,tests/results_tech_nachher_hoch_thr4.json
Ergebnis: tests/results_tech_<tag>_<hoch|quer>[_thrN].json
"""
import sys, os, json, time, math, glob
sys.path.insert(0, os.path.dirname(__file__))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START = ('seepferd_300', '-0.7453', '0.1127', 300)
STAGE_NAMES = {'eco': 'Akku', 'balanced': 'Ausgewogen', 'max': 'Maximal'}
MOODS = [('morgen', 0.8, 0.18), ('mittag', 2.35, 0.5), ('abend', 3.9, 0.15)]   # (Name, Azimut, Höhe) – 6.7-Hooks

FPS_JS = """() => { window.__fd = []; let last = 0; window.__fdOn = true;
  const f = (t) => { if (last) window.__fd.push(t - last); last = t; if (window.__fdOn) requestAnimationFrame(f); }; requestAnimationFrame(f); }"""
FPS_END = "() => { window.__fdOn = false; return window.__fd || []; }"


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith('--' + name + '='): return a.split('=', 1)[1]
        if a == '--' + name: return True
    return default


def quant(s, q):
    return s[min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))]


def frame_stats(d):
    d = [x for x in d if x > 0]
    if len(d) < 5: return {'frames': len(d)}
    s = sorted(d)
    return dict(frames=len(d), fps=round(1000 * len(d) / sum(d), 1), p50=round(quant(s, 0.5), 2), p95=round(quant(s, 0.95), 2),
                max=round(s[-1], 1), long50=sum(1 for x in d if x > 50))


def payload_kb():
    files = ['index.html', 'style.css', 'translations.js', 'manifest.webmanifest', 'sw.js'] + sorted(glob.glob(os.path.join(ROOT, 'js', '*.js')))
    tot = 0
    for f in files:
        p = f if os.path.isabs(f) else os.path.join(ROOT, f)
        if os.path.exists(p): tot += os.path.getsize(p)
    assets = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(os.path.join(ROOT, 'assets')) for fn in fns)
    return round(tot / 1024, 1), round(assets / 1024, 1)


GPU_VIEWS = [('tal', '-0.7453', '0.1127', 300, 42, 0.0), ('horizont', '-0.7453', '0.1127', 300, 60, 1.2),
             ('rand', '-0.743637214380908705', '0.131822306549061970', 1e6, 50, 2.4)]


def med(xs):
    s = sorted(x for x in xs if x is not None)
    return round(s[len(s) // 2], 2) if s else None


def gpu_views(a, pg, nm=15, ns=8):
    """3D an ist vorausgesetzt. Je Ansicht: Median der GPU-Zeit eines Bewegungsbilds (nm Messungen) und eines
    Stillstandsbilds (ns Messungen, volle Auflösung) – jede Messung ein eigenes bench3d(1)."""
    out = {}
    for name, vx, vy, vz, tilt, head in GPU_VIEWS:
        a.set_view(vx, vy, vz); a.wait_done(120)
        pg.evaluate(f"() => {{ const A = window.__fraktal; A.V3.tilt = {tilt} * Math.PI / 180; A.V3.heading = {head}; A.invalidate(); }}")
        time.sleep(0.8); a.wait_done(120); time.sleep(0.4)
        pg.evaluate("() => window.__fraktal.settle3d()")
        mv = [(pg.evaluate("() => window.__fraktal.bench3d(1, false)") or {}).get('min') for _ in range(nm)]
        sv = [(pg.evaluate("() => window.__fraktal.bench3d(1, true)") or {}).get('min') for _ in range(ns)]
        out[name] = {'move': med(mv), 'still': med(sv)}
    out['moveSum'] = round(sum(out[n]['move'] or 0 for n, *_ in GPU_VIEWS), 2)
    out['stillSum'] = round(sum(out[n]['still'] or 0 for n, *_ in GPU_VIEWS), 2)
    out['info'] = pg.evaluate("() => window.__fraktal.view3dInfo().gpu")
    pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 42 * Math.PI / 180; A.V3.heading = 0; A.invalidate(); }")
    return out


def compare(paths):
    rs = [json.load(open(p)) for p in paths]
    keys = [('zoom2d', 'p95'), ('zoom2d', 'gpuPresent'), ('still3d', 'gpuStill'), ('still3d', 'gpuMove'), ('fly3d', 'p50'), ('fly3d', 'p95'),
            ('fly3d', 'long50'), ('fly3d', 'gpuFly'), ('fly3d', 'scale'), ('gpu3d', 'moveSum'), ('gpu3d', 'stillSum')]
    head = '| Stufe | Wert | ' + ' | '.join(r.get('tag', '?') for r in rs) + ' |'
    print(head); print('|' + '---|' * (2 + len(rs)))
    for st in ['eco', 'balanced', 'max']:
        for sc, k in keys:
            vals = []
            for r in rs:
                v = r.get('stages', {}).get(st, {}).get(sc, {}).get(k)
                vals.append('–' if v is None else str(v))
            print('| %s | %s %s | %s |' % (STAGE_NAMES[st], sc, k, ' | '.join(vals)))
    print('| – | Ladegröße Code KB | ' + ' | '.join(str(r.get('payloadKB')) for r in rs) + ' |')


def main():
    if arg('compare'):
        compare(arg('compare').split(',')); return
    from e2e_lib import App
    from playwright.sync_api import sync_playwright
    land = bool(arg('land', False)); thr = float(arg('throttle', 4)); dpr = float(arg('dpr', 2.6)); secs = float(arg('secs', 10))
    zsecs = float(arg('zsecs', 6)); tag = arg('tag', 'cur'); shots = bool(arg('shots', False)); moods = bool(arg('moods', False))
    stages = (arg('stages') or 'eco,balanced,max').split(','); extra = arg('query') or ''
    gpuv = not arg('nogpu', False); only_gpu = bool(arg('onlygpu', False))
    ori = 'quer' if land else 'hoch'
    sdir = os.path.join(os.path.dirname(__file__), 'shots', 'technik')
    if shots: os.makedirs(sdir, exist_ok=True)
    kb, akb = payload_kb()
    out = {'tag': tag, 'ori': ori, 'throttle': thr, 'dpr': dpr, 'secs': secs, 'query': extra, 'headed': os.environ.get('FK_HEADED') == '1',
           'payloadKB': kb, 'assetsKB': akb, 'stages': {}}
    name, cx, cy, z = START
    with sync_playwright() as p:
        a = App(p, landscape=land, query='nosw&noanim' + ('&' + extra if extra else ''), extra_ctx={'device_scale_factor': dpr}).open()
        pg = a.page
        if thr > 1:
            cdp = a.ctx.new_cdp_session(pg)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
            cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
        out['version'] = pg.evaluate("() => window.__fraktal.APP_VERSION")
        out['gpu'] = pg.evaluate("() => { const gl = window.__fraktal.R.gl; return gl.getParameter(gl.RENDERER); }")
        out['tech'] = pg.evaluate("() => window.__fraktal.TECH || null")
        snap = lambda st, what: pg.screenshot(path=os.path.join(sdir, f'{tag}_{ori}_{st}_{what}.jpg'), type='jpeg', quality=88) if shots else None
        for st in stages:
            res = {}
            pg.evaluate("(q) => { const A = window.__fraktal; A.stopFly(); A.set3d(false); A.S.quality = q; A.resize(); A.invalidate(); }", st)
            time.sleep(0.8)
            if only_gpu:
                a.set_view(cx, cy, z); a.wait_done(120)
                pg.evaluate("() => window.__fraktal.set3d(true)"); a.wait_3d(30); time.sleep(0.5); a.wait_done(120)
                res['gpu3d'] = gpu_views(a, pg)
                print('  gpu3d', st, json.dumps({k: v for k, v in res['gpu3d'].items() if k != 'info'}), flush=True)
                pg.evaluate("() => window.__fraktal.set3d(false)")
                out['stages'][st] = res
                continue
            # ---- 2D-Zoom
            a.set_view(cx, cy, z); a.wait_done(120)
            pg.evaluate(FPS_JS)
            pg.evaluate(f"() => window.__fraktal.goTo({{ cx: '{cx}', cy: '{cy}', zoom: {z * 1000} }})")
            time.sleep(zsecs)
            r = frame_stats(pg.evaluate(FPS_END))
            g = pg.evaluate("() => window.__fraktal.benchGPU([])")
            r['gpuPresent'] = g.get('present') if g else None
            r['canvas'] = pg.evaluate("() => window.__fraktal.status().canvas")
            res['zoom2d'] = r
            snap(st, 'zoom2d')
            # ---- 3D-Stillstand
            a.set_view(cx, cy, z); a.wait_done(120)
            pg.evaluate("() => window.__fraktal.set3d(true)"); ok3d = a.wait_3d(30); time.sleep(0.5); a.wait_done(120); time.sleep(0.8)
            pg.evaluate("() => window.__fraktal.settle3d()")
            pg.evaluate(FPS_JS); time.sleep(3)
            r = frame_stats(pg.evaluate(FPS_END))
            bs = pg.evaluate("() => window.__fraktal.bench3d(5, true)"); bm = pg.evaluate("() => window.__fraktal.bench3d(5, false)")
            pg.evaluate("() => window.__fraktal.settle3d()")
            r.update(ok3d=ok3d, gpuStill=bs['min'] if bs else None, gpuStillMax=bs['max'] if bs else None,
                     gpuMove=bm['min'] if bm else None, gpuMoveMax=bm['max'] if bm else None,
                     info=pg.evaluate("() => window.__fraktal.view3dInfo().gpu"))
            res['still3d'] = r
            snap(st, 'still3d')
            if shots and moods and pg.evaluate("() => 'sunEl' in window.__fraktal.T3"):
                for mn, az, el in MOODS:
                    pg.evaluate(f"() => {{ const A = window.__fraktal; A.T3.sunAz = {az}; A.T3.sunEl = {el}; A.V3.accKey = null; A.invalidate(); }}")
                    time.sleep(0.6); pg.evaluate("() => window.__fraktal.settle3d()"); time.sleep(0.3)
                    snap(st, 'still3d_' + mn)
                pg.evaluate("() => { const A = window.__fraktal; A.T3.sunAz = 2.35; A.T3.sunEl = 0.5; A.V3.accKey = null; A.invalidate(); }")
            # ---- GPU-Zeit an festen 3D-Ansichten (Median aus Einzelmessungen, 2D-Rechnung fertig – wiederholbar,
            # anders als die Flugwerte, die vom Zufallsflug und von gleichzeitiger 2D-Rechnung abhängen)
            if gpuv:
                res['gpu3d'] = gpu_views(a, pg)
                print('  gpu3d', st, json.dumps({k: v for k, v in res['gpu3d'].items() if k != 'info'}), flush=True)
                a.set_view(cx, cy, z); a.wait_done(120)
            # ---- 3D-Flug
            z0 = pg.evaluate("() => window.__fraktal.S.cam.zoom")
            pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.frameStats(true); A.startFly(undefined, { d3: true }); }")
            pg.evaluate(FPS_JS)
            t0 = time.time(); mid = False
            while time.time() - t0 < secs:
                if not pg.evaluate("() => window.__fraktal.FLY.on"): break
                if shots and not mid and time.time() - t0 > secs / 2: mid = True; snap(st, 'fly3d')
                time.sleep(0.25)
            fd = pg.evaluate(FPS_END)
            r = frame_stats(fd)
            bf = pg.evaluate("() => window.__fraktal.bench3d(3, false)")      # GPU-Zeit eines Flugbilds (Skala wie im Flug)
            fs = pg.evaluate("() => { const f = window.__fraktal.frameStats(); return { hard: f.hard }; }")
            r.update(gpuFly=bf['min'] if bf else None, gpuFlyMax=bf['max'] if bf else None, scale=bf['scale'] if bf else None,
                     decades=round(math.log10(max(1e-9, pg.evaluate("() => window.__fraktal.S.cam.zoom") / z0)), 2), hard=fs['hard'],
                     info=pg.evaluate("() => window.__fraktal.view3dInfo().gpu"))
            pg.evaluate("() => { const A = window.__fraktal; A.stopFly(); A.set3d(false); }")
            res['fly3d'] = r
            out['stages'][st] = res
            print(st, json.dumps({k: {kk: vv for kk, vv in v.items() if kk != 'info'} for k, v in res.items()}), flush=True)
        out['errors'] = a.errors
        a.close()
    fn = os.path.join(os.path.dirname(__file__), f'results_tech_{tag}_{ori}{"_thr%d" % thr if thr > 1 else ""}{"_gpu" if only_gpu else ""}.json')
    json.dump(out, open(fn, 'w'), indent=1)
    print('->', fn, '| Fehler', len(out['errors']), out['errors'][:3])
    compare([fn])


if __name__ == '__main__':
    main()
