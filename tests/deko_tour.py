#!/usr/bin/env python3
"""Deko (6.5): Rundgang-Screenshots und Leistungsmessung für den Vorher/Nachher-Vergleich.

  python3 tests/deko_tour.py shots --tag=vorher [--query=deko=0]   → tests/shots/deko/<tag>_<hoch|quer>_<szene>.jpg
  python3 tests/deko_tour.py perf  --tag=vorher [--query=deko=0]   → tests/results_deko_<tag>.json + Tabelle
  python3 tests/deko_tour.py size                                   → Ladegröße (gzip) aller Dateien aus sw.js
  python3 tests/deko_tour.py collage --a=vorher --b=nachher          → tests/shots/deko/vergleich_<hoch|quer>.jpg

perf: Pixel-7-Ansicht hoch, CPU 4× gedrosselt (CDP Emulation.setCPUThrottlingRate), Farbanimation an (wie im
Alltag), je Szene ≥ 10 s Bildzeiten aus requestAnimationFrame; WebGL-Zeichenaufrufe/Dreiecke/Texturen pro Bild über
einen Zähler an WebGL2RenderingContext (die App nutzt kein three.js, darum kein renderer.info)."""
import sys, os, time, json, gzip, re
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(ROOT, 'tests', 'shots', 'deko')
os.makedirs(SH, exist_ok=True)
ARG = {a.split('=')[0].lstrip('-'): (a.split('=', 1)[1] if '=' in a else True) for a in sys.argv[2:]}
TAG = ARG.get('tag', 'test')
EXTRA = ARG.get('query', '')
SEA = ('-0.7453', '0.1127', 300)

# Zähler für Zeichenaufrufe (vor dem App-Code geladen)
HOOK = """
(() => {
  const P = WebGL2RenderingContext.prototype, C = window.__glc = { calls: 0, tris: 0, tex: 0 };
  const tri = (mode, n) => mode === 4 ? n / 3 : (mode === 5 || mode === 6) ? Math.max(0, n - 2) : 0;
  const dA = P.drawArrays, dE = P.drawElements, cT = P.createTexture, xT = P.deleteTexture;
  P.drawArrays = function (m, f, n) { C.calls++; C.tris += tri(m, n); return dA.apply(this, arguments); };
  P.drawElements = function (m, n) { C.calls++; C.tris += tri(m, n); return dE.apply(this, arguments); };
  P.createTexture = function () { C.tex++; return cT.apply(this, arguments); };
  P.deleteTexture = function (t) { if (t) C.tex--; return xT.apply(this, arguments); };
})();
"""


def query(base):
    return base + ('&' + EXTRA if EXTRA else '')


def ui_ready(pg):
    pg.wait_for_function("() => document.body.classList.contains('ready')", timeout=30000)


def tap_dock(pg, tab):
    pg.evaluate(f"() => document.querySelector('.dock-btn[data-tab=\"{tab}\"]').click()")
    time.sleep(0.7)


def close_sheet(pg):
    pg.evaluate("() => { const b = document.getElementById('sheet-close'); if (!document.getElementById('sheet').hidden) b.click(); }")
    time.sleep(0.5)


def to_3d(a, tilt=50, look=None):
    pg = a.page
    if look:
        pg.evaluate(f"() => {{ const A = window.__fraktal; Object.assign(A.S, {json.dumps(look)}); A.invalidate(); A.emit('settings'); }}")
    pg.evaluate("() => window.__fraktal.set3d(true)")
    if not a.wait_3d(240):
        raise RuntimeError('3D kam nicht')
    pg.evaluate(f"() => {{ const A = window.__fraktal; A.V3.tilt = {tilt} * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }}")
    time.sleep(1.0)
    try: a.wait_done(60)
    except TimeoutError: pass
    time.sleep(2.0)


def shots():
    with sync_playwright() as p:
        for land in (False, True):
            o = 'quer' if land else 'hoch'
            a = App(p, landscape=land, query=query('nosw')).open(); pg = a.page
            ui_ready(pg)
            pg.evaluate("() => { localStorage.removeItem('fraktal_v5_places'); }")
            shot = lambda n: pg.screenshot(path=os.path.join(SH, f'{TAG}_{o}_{n}.jpg'), type='jpeg', quality=84)
            a.wait_done(120); time.sleep(1.0)
            shot('1_start')
            # zwei Orte merken (Gesamtbild + Seepferdchen-Tal)
            tap_dock(pg, 'places'); pg.evaluate("() => document.getElementById('btn-save-place').click()"); close_sheet(pg)
            a.set_view(*SEA); a.wait_done(120); time.sleep(0.8)
            shot('2_tief')
            tap_dock(pg, 'places'); pg.evaluate("() => document.getElementById('btn-save-place').click()"); time.sleep(1.2)
            shot('3_orte')
            tap_dock(pg, 'worlds'); time.sleep(0.6); shot('4_welten')
            tap_dock(pg, 'colors'); time.sleep(0.6); shot('5_farben')
            close_sheet(pg)
            to_3d(a, 50); shot('6_3d')
            pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.2)
            to_3d(a, 45, {'alpine': True, 'valley': 'lake', 'setCol': 'white'}); shot('7_3d_alpin')
            pg.evaluate("() => window.__fraktal.startFly()"); time.sleep(5); shot('8_3d_flug')
            pg.evaluate("() => window.__fraktal.stopFly()")
            print(o, 'Fehler:', a.errors)
            a.close()


def measure(pg, secs):
    pg.evaluate("""() => { const F = window.__ft = { t: [], c0: Object.assign({}, window.__glc) }; let last = 0;
        const f = (t) => { if (last) F.t.push(t - last); last = t; if (!F.stop) requestAnimationFrame(f); }; requestAnimationFrame(f); }""")
    time.sleep(secs)
    r = pg.evaluate("""() => { const F = window.__ft; F.stop = true; const c = window.__glc, n = Math.max(1, F.t.length);
        const s = F.t.slice().sort((a, b) => a - b), q = (x) => s[Math.min(s.length - 1, Math.floor(x * s.length))];
        const A = window.__fraktal, st = A.status(), v = A.view3dInfo();
        return { frames: F.t.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(1),
                 mean: +(F.t.reduce((a, b) => a + b, 0) / n).toFixed(2),
                 callsPerFrame: +((c.calls - F.c0.calls) / n).toFixed(1), trisPerFrame: Math.round((c.tris - F.c0.tris) / n), textures: c.tex,
                 scale3d: v.gpu ? v.gpu.scale : null, fps: st.fps }; }""")
    return r


def perf():
    out = {'tag': TAG, 'query': EXTRA, 'host': 'rog17/RTX 3070 Ti', 'throttle': 4, 'scenes': {}}
    with sync_playwright() as p:
        a = App(p, landscape=False, query=query('nosw'))
        a.page.add_init_script(HOOK)
        a.open(); pg = a.page
        ui_ready(pg)
        cdp = a.ctx.new_cdp_session(pg)
        a.set_view(*SEA); a.wait_done(120)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        # 1) 2D, Farben-Tab offen (Glas über laufender Farbanimation)
        tap_dock(pg, 'colors'); time.sleep(1.5)
        out['scenes']['2d_menue'] = measure(pg, 10)
        close_sheet(pg)
        # 2) 3D Stillstand (Standard-Look)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        to_3d(a, 50)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4}); time.sleep(1.0)
        out['scenes']['3d_stand'] = measure(pg, 10)
        # 3) 3D Flug
        pg.evaluate("() => window.__fraktal.startFly()"); time.sleep(2.0)
        out['scenes']['3d_flug'] = measure(pg, 12)
        pg.evaluate("() => window.__fraktal.stopFly()")
        # 4) 3D Alpin-See Stillstand
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.2)
        a.set_view(*SEA); a.wait_done(120)
        to_3d(a, 45, {'alpine': True, 'valley': 'lake', 'setCol': 'white'})
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4}); time.sleep(1.0)
        out['scenes']['3d_alpin'] = measure(pg, 10)
        # 5) niedrigste Stufe (Akku) im Flug
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        pg.evaluate("() => { const A = window.__fraktal; A.S.quality = 'eco'; A.S.alpine = false; A.S.setCol = 'black'; A.saveSettings(); A.resize(); A.invalidate(); }")
        time.sleep(1.5)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        pg.evaluate("() => window.__fraktal.startFly()"); time.sleep(2.0)
        out['scenes']['3d_flug_akku'] = measure(pg, 12)
        pg.evaluate("() => window.__fraktal.stopFly()")
        out['errors'] = a.errors
        a.close()
    out['size'] = size(quiet=True)
    with open(os.path.join(ROOT, 'tests', f'results_deko_{TAG}.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"{'Szene':<14} {'p50':>6} {'p95':>6} {'max':>6} {'Bilder':>6} {'Aufr./B':>8} {'Dreiecke/B':>10} {'Tex':>4} {'3D-Skal.':>8}")
    for k, r in out['scenes'].items():
        print(f"{k:<14} {r['p50']:>6} {r['p95']:>6} {r['max']:>6} {r['frames']:>6} {r['callsPerFrame']:>8} {r['trisPerFrame']:>10} {r['textures']:>4} {str(r['scale3d']):>8}")
    print('Ladegröße gzip:', out['size'], 'Fehler:', out['errors'])


def gpu():
    """GPU-Zeit eines 3D-Bilds (EXT_disjoint_timer_query, API bench3d): Bewegungsbild (65 %) und Stillbild (voll),
    Standard- und Alpin-See-Look, Hochformat. Feiner als die Bildzeit (die am rog an der 60-Hz-Grenze klebt)."""
    out = {'tag': TAG, 'query': EXTRA, 'host': 'rog17/RTX 3070 Ti', 'gpu': {}}
    with sync_playwright() as p:
        a = App(p, landscape=False, query=query('nosw&noanim')).open(); pg = a.page
        ui_ready(pg)
        a.set_view(*SEA); a.wait_done(120)
        for name, look in (('standard', None), ('alpin_see', {'alpine': True, 'valley': 'lake', 'setCol': 'white'})):
            if look:
                pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.0)
            to_3d(a, 50, look)
            r = {}
            for still in (False, True):
                best = None
                for _ in range(3):
                    b = pg.evaluate(f"() => window.__fraktal.bench3d(12, {str(still).lower()})")
                    if b and (best is None or b['min'] < best['min']): best = b
                    time.sleep(0.3)
                r['still' if still else 'bewegt'] = best
            out['gpu'][name] = r
            print(name, r)
        out['errors'] = a.errors
        a.close()
    with open(os.path.join(ROOT, 'tests', f'results_deko_gpu_{TAG}.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)


def size(quiet=False):
    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    files = re.findall(r"'([\w./-]+\.(?:css|js|webmanifest|png|jpg))'", sw) + ['index.html', 'sw.js']
    tot = raw = 0
    for fn in files:
        b = open(os.path.join(ROOT, fn), 'rb').read()
        raw += len(b); tot += len(gzip.compress(b, 6))
    r = {'files': len(files), 'raw': raw, 'gzip': tot}
    if not quiet: print(r)
    return r


def collage():
    from PIL import Image, ImageDraw
    A, B = ARG.get('a', 'vorher'), ARG.get('b', 'nachher')
    for o in ('hoch', 'quer'):
        names = sorted({f.split(f'{A}_{o}_')[1] for f in os.listdir(SH) if f.startswith(f'{A}_{o}_')})
        names = [n for n in names if os.path.exists(os.path.join(SH, f'{B}_{o}_{n}'))]
        if not names: continue
        ims = [(Image.open(os.path.join(SH, f'{A}_{o}_{n}')).convert('RGB'), Image.open(os.path.join(SH, f'{B}_{o}_{n}')).convert('RGB')) for n in names]
        w, h = ims[0][0].size
        s = 0.42 if o == 'hoch' else 0.36
        tw, th = int(w * s), int(h * s)
        cols = len(ims)
        sheet = Image.new('RGB', (tw * cols + 6 * (cols - 1), th * 2 + 6 + 40), (16, 16, 24))
        d = ImageDraw.Draw(sheet)
        d.text((8, 4), f'oben: {A} (?deko=0)   unten: {B}', fill=(230, 230, 240))
        for i, (ia, ib) in enumerate(ims):
            x = i * (tw + 6)
            sheet.paste(ia.resize((tw, th)), (x, 40)); sheet.paste(ib.resize((tw, th)), (x, 40 + th + 6))
            d.text((x + 4, 22), names[i].rsplit('.', 1)[0], fill=(200, 200, 220))
        sheet.save(os.path.join(SH, f'vergleich_{o}.jpg'), quality=82)
        print('vergleich', o, len(names))


if __name__ == '__main__':
    {'shots': shots, 'perf': perf, 'gpu': gpu, 'size': size, 'collage': collage}[sys.argv[1]]()
