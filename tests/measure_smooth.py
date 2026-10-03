#!/usr/bin/env python3
"""Glättungs-Messung (6.1, „Menge glatt wie in YouTube-Zoomvideos“) – gleiche Methode für jede Version.

Phase capture (Browser, Pixel-7-Ansicht, echte GPU): pro Ansicht das fertige 2D-Bild (Canvas-Pixel, kein
Screenshot-Resampling), dazu 3D bei 45° Neigung (Bild + Wassermaske über den Debug-Schalter u_dbg), Subpixel-
Schwenk (Flimmern), GPU-Zeiten (benchGPU / bench3d).
Phase analyze: 16×-Referenz (tests/ref_render.js, f64, gleiche Palette/Phase) und Kennzahlen:
  * dev16   mittlere |ΔRGB| (Mittel der 3 Kanäle, 0..255) App-Bild gegen 16×-Referenz, Anteil Pixel > 30
  * noise   Nachbarpixel-Farbsprünge (waagrecht, beide nicht mengenfarben, max. Kanal-Differenz > 96)
  * dark    Anteil mengenfarbener Pixel (Helligkeit < 18) – App gegen Referenz (Fläche nicht aufgebläht)
  * jag     3D-Ufer: Länge der 0,5-Isolinie der Wassermaske (leicht geglättet σ=0,75) / Länge nach starker
            Glättung (σ=3); 1,0 = glatt, Treppen und Zähne erhöhen den Wert
  * flick   Subpixel-Schwenk (8 × ¼ Pixel): mittlere |ΔRGB| Bild zu Bild; 3D: Drehung in kleinen Schritten
  * devRef  3D: Abweichung von einer Referenz derselben Sitzung (48 versetzte Bilder, doppelte Auflösung), Nahbereich
            (untere zwei Drittel): gemitteltes Stillstandsbild (still) und Bewegungsbild (motion, 65 % – so zeigte 6.0
            auch den Stillstand)
Aufruf: python3 tests/measure_smooth.py capture --base=http://localhost:8473/index.html --label=v600
        python3 tests/measure_smooth.py analyze --label=v600 [--de=lo,hi] [--ref=v610]
Ergebnis: tests/shots/smooth/<label>/ (Bilder, results.json)
"""
import sys, os, json, time, base64, subprocess
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))

OUT = os.path.join(os.path.dirname(__file__), 'shots', 'smooth')
VIEWS = [('ganz', '-0.6', '0', 1, None), ('seepferd_300', '-0.7453', '0.1127', 300, None),
         ('seepferd_300_it3000', '-0.7453', '0.1127', 300, 3000),
         ('minibrot_3e6', '-1.7499744226', '0.0000000000123', 3e6, None),
         ('rand_1e9', '-0.743637214380908705', '0.131822306549061970', 1e9, None)]
CROP = 512

SNAP = r"""([rect, raw]) => {
  const A = window.__fraktal, gl = A.R.gl;
  if (raw) A.bench3d(1); else if (A.snapshot) A.snapshot(); else if (A.V3.on) A.bench3d(1); else A.presentNow();
  const [x, y, w, h] = rect, H = gl.canvas.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(x, H - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
  return btoa(s);
}"""


DBG = r"""(on) => { const A = window.__fraktal, gl = A.R.gl; const pr = A.R.program('t3terr'); gl.useProgram(pr.p);
  gl.uniform1i(pr.loc.u_dbg, on); A.RC.dirty = true; if (A.settle3d) { A.V3.accKey = null; A.settle3d(); } }"""


def decode(b64, w, h):
    a = np.frombuffer(base64.b64decode(b64), dtype=np.uint8).reshape(h, w, 4)[::-1, :, :3]
    return a.copy()


def snap(pg, rect, raw=False):
    # raw: 3D-Einzelbild ohne Stillstands-Mittelung (Debug-Masken, Bewegungsbild)
    return decode(pg.evaluate(SNAP, [rect, raw]), rect[2], rect[3])


def capture(base, label, query):
    from e2e_lib import App
    from playwright.sync_api import sync_playwright
    d = os.path.join(OUT, label); os.makedirs(d, exist_ok=True)
    res = {'label': label, 'base': base, 'query': query, 'views': {}}
    os.environ['FK_BASE'] = base
    import e2e_lib; e2e_lib.BASE = base
    with sync_playwright() as p:
        a = App(p, query='nosw&noanim' + ('&' + query if query else '')).open(); pg = a.page
        W, H = pg.evaluate("() => [window.__fraktal.R.gl.canvas.width, window.__fraktal.R.gl.canvas.height]")
        res['canvas'] = [W, H]
        rect = [W // 2 - CROP // 2, H // 2 - CROP // 2, CROP, CROP]
        res['crop'] = rect
        pal = pg.evaluate("() => { const A = window.__fraktal, p = A.PAL.list[A.S.palette]; return { a: p.a, b: p.b, c: p.c, d: p.d, density: A.S.density, cycle: A.S.cycle }; }")
        res['pal'] = pal
        for name, cx, cy, z, it in VIEWS:
            pg.evaluate("(it) => { const A = window.__fraktal; A.S.iterManual = !!it; if (it) A.S.iterValue = it; A.invalidate(); }", it)
            a.set_view(cx, cy, z); t, st = a.wait_done(180); time.sleep(0.4)
            img = snap(pg, rect)
            Image.fromarray(img).save(os.path.join(d, f'2d_{name}.png'))
            full = snap(pg, [0, 0, W, H])
            Image.fromarray(full).save(os.path.join(d, f'2d_{name}_full.png'))
            v = {'cx': cx, 'cy': cy, 'zoom': z, 'maxIter': st['maxIter'], 'doneS': round(t, 2), 'fix': st.get('fix')}
            b = pg.evaluate("() => window.__fraktal.benchGPU([1, 2, 4])")
            v['benchGPU'] = b
            res['views'][name] = v
            print(name, json.dumps(v), flush=True)
        # Flimmern 2D: Subpixel-Schwenk über Filamente (Seepferdchen-Tal 300×)
        pg.evaluate("() => { const A = window.__fraktal; A.S.iterManual = false; A.invalidate(); }")
        fl = []
        prev = None
        for k in range(9):
            dx = k * 0.25 * 3 / (300 * H)
            a.set_view(repr(-0.7453 + dx), '0.1127', 300); a.wait_done(120); time.sleep(0.2)
            img = snap(pg, rect).astype(np.int16)
            if prev is not None:
                dd = np.abs(img - prev).mean(axis=2)
                fl.append([float(dd.mean()), float((dd > 30).mean())])
            prev = img
        res['flick2d'] = {'meanAbs': round(float(np.mean([f[0] for f in fl])), 3), 'gt30': round(float(np.mean([f[1] for f in fl])), 4)}
        print('flick2d', res['flick2d'], flush=True)
        # 3D: 45° Neigung, Drehung 0,4
        res['views3d'] = {}
        for name, cx, cy, z, it in VIEWS:
            if it: continue
            pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(0.6)
            a.set_view(cx, cy, z); a.wait_done(180)
            pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.2); a.wait_done(180)
            pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }")
            time.sleep(2.0)
            # Höhen-Normierung (Quantile, weich nachgeführt) einschwingen lassen, sonst verschiebt sich das Gelände
            # zwischen den Aufnahmen
            for _ in range(60):
                if pg.evaluate("""() => { const V = window.__fraktal.V3; if (!V.Lt || !V.cdfT) return true;
                    let d = Math.abs(V.L[0] - V.Lt[0]) + Math.abs(V.L[1] - V.Lt[1]); for (let i = 0; i < 9; i++) d += Math.abs(V.cdf[i] - V.cdfT[i]); return d < 2e-3; }"""): break
                time.sleep(0.25)
            time.sleep(0.5)
            has_settle = pg.evaluate("() => !!window.__fraktal.settle3d")
            if has_settle:
                pg.evaluate("() => window.__fraktal.settle3d()")
            img = snap(pg, [0, 0, W, H])
            Image.fromarray(img).save(os.path.join(d, f'3d_{name}.png'))
            # Bewegungsbild (eigene Auflösung T.scale, keine Mittelung) = das, was 6.0 auch im Stillstand zeigte
            Image.fromarray(snap(pg, [0, 0, W, H], True)).save(os.path.join(d, f'3d_{name}_motion.png'))
            # Debug-Masken (1 = Wasser, 2 = Mengen-Anteil) über denselben Weg wie das sichtbare Bild: 6.1 mit
            # Stillstands-Mittelung (settle3d), 6.0 Einzelbild
            for dbg, fn in ((1, 'water'), (2, 'set')):
                pg.evaluate(DBG, dbg)
                m = snap(pg, [0, 0, W, H], not has_settle)
                Image.fromarray(m).save(os.path.join(d, f'3d_{name}_{fn}.png'))
            pg.evaluate(DBG, 0)
            if has_settle:
                # Referenz in derselben Sitzung (gleiche Ebenen/Höhen-Normierung): 48 versetzte Bilder, doppelte Auflösung
                pg.evaluate("() => window.__fraktal.settle3d({ N: 48, scale: 2 })")
                Image.fromarray(snap(pg, [0, 0, W, H])).save(os.path.join(d, f'3d_{name}_ref.png'))
                pg.evaluate("() => window.__fraktal.settle3d(null)")
            time.sleep(1.5)   # GPU-Warteschlange leeren (Timer-Queries messen sonst Wartezeit mit)
            b3 = min((pg.evaluate("() => window.__fraktal.bench3d(10)") for _ in range(3)), key=lambda r: r['min'])
            # Flimmern 3D: Drehung in kleinen Schritten (je 0,002 rad), sofort nach der Änderung gelesen
            fl3, prev = [], None
            for k in range(6):
                pg.evaluate("(k) => { const A = window.__fraktal; A.V3.heading = 0.4 + k * 0.002; A.RC.dirty = true; }", k)
                time.sleep(0.15)
                img3 = snap(pg, rect).astype(np.int16)
                if prev is not None: fl3.append(float(np.abs(img3 - prev).mean()))
                prev = img3
            # dasselbe nach Abschluss der Stillstands-Mittelung (6.1; 6.0: identisch zum Einzelbild)
            fl4, prev = [], None
            for k in range(6):
                pg.evaluate("(k) => { const A = window.__fraktal; A.V3.heading = 0.5 + k * 0.002; A.RC.dirty = true; if (A.settle3d) A.settle3d(); }", k)
                img3 = snap(pg, rect).astype(np.int16)
                if prev is not None: fl4.append(float(np.abs(img3 - prev).mean()))
                prev = img3
            time.sleep(1.0)
            b3s = min((pg.evaluate("() => window.__fraktal.bench3d(10, true)") for _ in range(3)), key=lambda r: r['min']) if has_settle else None
            res['views3d'][name] = {'bench3d': b3, 'bench3dStill': b3s, 'flick': round(float(np.mean(fl3)), 3), 'flickSettled': round(float(np.mean(fl4)), 3)}
            print('3d', name, res['views3d'][name], flush=True)
        res['errors'] = a.errors
        a.close()
    json.dump(res, open(os.path.join(d, 'capture.json'), 'w'), indent=1)


def gblur(m, sig):
    r = int(3 * sig + 1)
    x = np.arange(-r, r + 1); k = np.exp(-x * x / (2 * sig * sig)); k /= k.sum()
    p = np.pad(m, r, mode='edge')
    out = np.zeros_like(p[r:-r, :], dtype=np.float64)
    for i in range(2 * r + 1): out += k[i] * p[i:i + m.shape[0], :]
    out2 = np.zeros_like(m, dtype=np.float64)
    for i in range(2 * r + 1): out2 += k[i] * out[:, i:i + m.shape[1]]
    return out2


def stair(m):
    """Treppen-Index: mittlere |sin| der Abweichung zwischen der Konturrichtung fein (σ=0,75) und geglättet (σ=3)
    an den Konturpixeln. Glatte Kurven ~0,1; Pixel-/Texeltreppen kippen die feine Richtung zwischen waagrecht und
    senkrecht hin und her -> höher."""
    m1, m3 = gblur(m, 0.75), gblur(m, 3.0)
    g1y, g1x = np.gradient(m1); g3y, g3x = np.gradient(m3)
    a1, a3 = np.hypot(g1x, g1y), np.hypot(g3x, g3y)
    sel = (np.abs(m1 - 0.5) < 0.3) & (a1 > 0.04) & (a3 > 0.01)
    if sel.sum() < 50: return None
    d = np.arctan2(g1y, g1x) - np.arctan2(g3y, g3x)
    return round(float(np.abs(np.sin(d))[sel].mean()), 3)


def iso_len(m, lev=0.5):
    """Länge der Isolinie (marching squares, lineare Interpolation auf den Zellkanten)."""
    a, b, c, d = m[:-1, :-1], m[:-1, 1:], m[1:, 1:], m[1:, :-1]   # oben links, oben rechts, unten rechts, unten links
    pts = []
    for (p, q, ax) in ((a, b, 'top'), (b, c, 'right'), (d, c, 'bottom'), (a, d, 'left')):
        cr = (p - lev) * (q - lev) < 0
        t = np.where(cr, (lev - p) / np.where(cr, q - p, 1), 0)
        if ax == 'top': x, y = t, np.zeros_like(t)
        elif ax == 'bottom': x, y = t, np.ones_like(t)
        elif ax == 'left': x, y = np.zeros_like(t), t
        else: x, y = np.ones_like(t), t
        pts.append((cr, x, y))
    n = sum(p[0].astype(np.int32) for p in pts)
    L = 0.0
    # Zellen mit genau 2 Schnittpunkten: Abstand der beiden
    xs = np.stack([p[1] for p in pts]); ys = np.stack([p[2] for p in pts]); cs = np.stack([p[0] for p in pts])
    two = n == 2
    idx = np.argsort(~cs, axis=0, kind='stable')[:2]
    x0 = np.take_along_axis(xs, idx[0:1], 0)[0]; y0 = np.take_along_axis(ys, idx[0:1], 0)[0]
    x1 = np.take_along_axis(xs, idx[1:2], 0)[0]; y1 = np.take_along_axis(ys, idx[1:2], 0)[0]
    L += float(np.hypot(x1 - x0, y1 - y0)[two].sum())
    four = n == 4
    if four.any():   # Sattel: zwei Segmente (oben-links, rechts-unten), Näherung
        L += float(four.sum()) * 1.0
    return L


def analyze(label, de):
    d = os.path.join(OUT, label)
    cap = json.load(open(os.path.join(d, 'capture.json')))
    W, H = cap['canvas']; crop = cap['crop']; pal = cap['pal']
    res = {'label': label, 'de': de, 'views': {}, 'views3d': {}}
    root = os.path.join(os.path.dirname(__file__), '..')
    for name, v in cap['views'].items():
        app = np.asarray(Image.open(os.path.join(d, f'2d_{name}.png')).convert('RGB')).astype(np.int16)
        refs = {}
        for ss in (1, 4):
            rp = os.path.join(d, f'ref{ss}_{name}.rgb')
            job = {'cx': v['cx'], 'cy': v['cy'], 'zoom': v['zoom'], 'W': W, 'H': H, 'crop': crop, 'maxIter': v['maxIter'],
                   'pal': {k: pal[k] for k in 'abcd'}, 'density': pal['density'], 'cycle': pal['cycle'], 'ss': ss,
                   'de': {'on': bool(de), 'lo': de[0], 'hi': de[1]} if de else {'on': False}}
            jp = os.path.join(d, f'job_{ss}_{name}.json'); json.dump(job, open(jp, 'w'))
            if not os.path.exists(rp) or os.path.getmtime(rp) < os.path.getmtime(jp) - 1 or True:
                r = subprocess.run(['node', os.path.join(root, 'tests', 'ref_render.js'), jp, rp], capture_output=True, text=True, timeout=1800)
                info = json.loads(r.stdout.strip().splitlines()[-1])
            refs[ss] = np.frombuffer(open(rp, 'rb').read(), dtype=np.uint8).reshape(crop[3], crop[2], 3).astype(np.int16)
            if ss == 4:
                Image.fromarray(refs[4].astype(np.uint8)).save(os.path.join(d, f'ref16_{name}.png'))
                v['refInfo'] = info
        dd16 = np.abs(app - refs[4]).mean(axis=2)
        dd1 = np.abs(app - refs[1]).mean(axis=2)
        lum = lambda im: 0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]
        def noise(im):
            dk = lum(im) < 18
            jump = np.abs(im[:, 1:] - im[:, :-1]).max(axis=2) > 96
            ok = ~dk[:, 1:] & ~dk[:, :-1]
            return float((jump & ok).sum() / max(1, ok.sum()))
        r = {'maxIter': v['maxIter'], 'dev16': round(float(dd16.mean()), 2), 'dev16_gt30': round(float((dd16 > 30).mean()), 4),
             'dev1': round(float(dd1.mean()), 2), 'noise_app': round(noise(app), 4), 'noise_ref16': round(noise(refs[4]), 4),
             'dark_app': round(float((lum(app) < 18).mean()), 4), 'dark_ref16': round(float((lum(refs[4]) < 18).mean()), 4),
             'ref_inside': round(v['refInfo']['inside'], 4), 'ref_near05': round(v['refInfo']['near'], 4),
             'doneS': v['doneS'], 'benchGPU': v.get('benchGPU')}
        res['views'][name] = r
        print(name, json.dumps(r), flush=True)
    for name, v in cap.get('views3d', {}).items():
        m = np.asarray(Image.open(os.path.join(d, f'3d_{name}_water.png')).convert('L')).astype(np.float64) / 255
        m1, m3 = gblur(m, 0.75), gblur(m, 3.0)
        l1, l3 = iso_len(m1), iso_len(m3)
        r = dict(v); r['shoreLen'] = round(l1, 1); r['jag'] = round(l1 / max(1, l3), 3); r['water'] = round(float((m > 0.5).mean()), 4)
        r['stairWater'] = stair(m)
        rp = os.path.join(OUT, args_ref or label, f'3d_{name}_ref.png')
        if rp and os.path.exists(rp):
            ref = np.asarray(Image.open(rp).convert('RGB')).astype(np.int16)
            y0 = ref.shape[0] // 3      # Nahbereich (untere zwei Drittel; der Horizont hängt von den Reserve-Ebenen ab)
            for kind, fn in (('still', f'3d_{name}.png'), ('motion', f'3d_{name}_motion.png')):
                fp = os.path.join(d, fn)
                if not os.path.exists(fp): continue
                im = np.asarray(Image.open(fp).convert('RGB')).astype(np.int16)
                dd = np.abs(im[y0:] - ref[y0:]).mean(axis=2)
                r['devRef_' + kind] = round(float(dd.mean()), 2); r['devRef_' + kind + '_gt30'] = round(float((dd > 30).mean()), 4)
        sp = os.path.join(d, f'3d_{name}_set.png')
        if os.path.exists(sp):
            ms = np.asarray(Image.open(sp).convert('L')).astype(np.float64) / 255
            s1, s3 = iso_len(gblur(ms, 0.75)), iso_len(gblur(ms, 3.0))
            r['setLen'] = round(s1, 1); r['jagSet'] = round(s1 / max(1, s3), 3); r['setFrac'] = round(float((ms > 0.5).mean()), 4)
            r['stairSet'] = stair(ms)
        res['views3d'][name] = r
        print('3d', name, json.dumps(r), flush=True)
    res['flick2d'] = cap.get('flick2d'); res['errors'] = cap.get('errors')
    json.dump(res, open(os.path.join(d, 'results.json'), 'w'), indent=1)


if __name__ == '__main__':
    args = dict(a[2:].split('=', 1) for a in sys.argv[2:] if a.startswith('--') and '=' in a)
    args_ref = args.get('ref')
    if sys.argv[1] == 'capture':
        capture(args.get('base', 'http://localhost:8472/index.html'), args['label'], args.get('query', ''))
    else:
        de = [float(x) for x in args['de'].split(',')] if args.get('de') else None
        analyze(args['label'], de)
