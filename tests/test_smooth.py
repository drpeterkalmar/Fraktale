#!/usr/bin/env python3
"""6.1 „Menge glatt wie in YouTube-Zoomvideos“ – Pixel-7-Emulation, echte GPU.

Prüft:  * Seepferdchen-Tal 300× bei 3000 Iterationen: Farbsprünge benachbarter Pixel < 5 % (6.0: 17 %), mit dem
          Schalter „Menge glatt“ aus wieder > 10 % (A/B funktioniert)
        * Distanzschätzung (zweiter Kanal) stimmt mit f64 überein: GPU (direkt + Perturbation 1e9) und CPU-Pfad,
          Median |log2(DE_App / DE_f64)| < 0,15 (Kodierung 1/16 Oktave)
        * Iterationspuffer unverändert: readFront-Werte mit und ohne Distanzschätzung identisch
        * 3D: Stillstands-Mittelung läuft bis N Bilder, danach 0 Zeichenaufrufe (GPU ruht, Farbanimation aus);
          Akku-Stufe = 4 Bilder
        * ?aa=0 = Verhalten 6.0 (keine Distanzschätzung, keine Mittelung)
        * iPhone-Ersatzpfad ohne Float-Renderziel (8-bit-Höhen) + quer: 3D mit Glättung ohne Fehler
Aufruf: python3 tests/test_smooth.py
"""
import sys, os, json, time, math
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from measure_smooth import snap
from playwright.sync_api import sync_playwright

SEA = ('-0.7453', '0.1127', 300)
WALK = ('-0.743637214380908705', '0.131822306549061970', 1e9)

COUNT_DRAWS = r"""() => {
  const gl = window.__fraktal.R.gl;
  if (!gl.__cnt) {
    gl.__cnt = 0;
    for (const f of ['drawArrays', 'drawElements']) { const o = gl[f].bind(gl); gl[f] = (...a) => { gl.__cnt++; return o(...a); }; }
  }
  const c = gl.__cnt; return c;
}"""


def noise(img):
    im = img.astype(np.int16)
    lum = 0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]
    dk = lum < 18
    jump = np.abs(im[:, 1:] - im[:, :-1]).max(axis=2) > 96
    ok = ~dk[:, 1:] & ~dk[:, :-1]
    return float((jump & ok).sum() / max(1, ok.sum()))


def f64_de(cr, ci, maxit, px):
    zr = zi = dr = di = 0.0
    for n in range(1, maxit + 1):
        dr, di = 2 * (zr * dr - zi * di) + 1, 2 * (zr * di + zi * dr)
        zr, zi = zr * zr - zi * zi + cr, 2 * zr * zi + ci
        r2 = zr * zr + zi * zi
        if r2 > 256:
            r = math.sqrt(r2)
            return r * math.log(r) / math.hypot(dr, di) / px
    return None


def de_accuracy(pg, n=300):
    """Distanzschätzung des fertigen Bildes an n Stichproben gegen f64 (Pufferpixel; Zoom ≤ 1e9: f64 reicht)."""
    fr = pg.evaluate("() => { const A = window.__fraktal, f = A.RC.front; return { w: f.buf.w, h: f.buf.h, scale: f.scale, cx: A.HP.toNumber(f.view.cx), cy: A.HP.toNumber(f.view.cy), maxIter: f.maxIter }; }")
    de = pg.evaluate("() => window.__fraktal.readFrontDE()")
    w, h = de['w'], de['h']
    codes = np.array(de['data'], dtype=np.uint8).reshape(h, w)      # Zeile 0 = unten
    rng = np.random.default_rng(7)
    errs, zero = [], 0
    for _ in range(n * 3):
        i, j = int(rng.integers(0, w)), int(rng.integers(0, h))
        cr = fr['cx'] + (i + 0.5 - w / 2) * fr['scale']; ci = fr['cy'] + (j + 0.5 - h / 2) * fr['scale']
        d = f64_de(cr, ci, fr['maxIter'], fr['scale'])
        if d is None or not (0.02 < d < 150): continue
        c = int(codes[j, i])
        if c == 0: zero += 1; continue
        errs.append(abs(math.log2(2 ** (c / 16 - 8) / d)))
        if len(errs) >= n: break
    return {'n': len(errs), 'median': round(float(np.median(errs)), 3), 'p90': round(float(np.percentile(errs, 90)), 3), 'noCode': zero}


def main():
    res, ok, chk = {}, True, []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
    with sync_playwright() as p:
        a = App(p).open(); pg = a.page
        W, H = pg.evaluate("() => [window.__fraktal.R.gl.canvas.width, window.__fraktal.R.gl.canvas.height]")
        rect = [W // 2 - 256, H // 2 - 256, 512, 512]
        # --- 2D: Rauschen mit/ohne Glättung, Iterationspuffer unverändert
        pg.evaluate("() => { const A = window.__fraktal; A.S.iterManual = true; A.S.iterValue = 3000; A.invalidate(); }")
        a.set_view(*SEA); a.wait_done(120); time.sleep(0.3)
        n_on = noise(snap(pg, rect))
        it_on = pg.evaluate("() => window.__fraktal.readFrontAt([[100, 100], [400, 800], [700, 1500], [412, 839], [10, 1600]]).values")
        acc = de_accuracy(pg)
        res['sea3000'] = {'noiseOn': round(n_on, 4), 'deGPUdirect': acc}
        need(n_on < 0.05, f'Seepferdchen 3000 Iter.: Farbsprünge {n_on:.1%} < 5 %')
        need(acc['median'] < 0.15 and acc['noCode'] == 0, f'DE GPU direkt: Median {acc["median"]} Oktaven (n={acc["n"]}, ohne Code {acc["noCode"]})')
        pg.evaluate("() => { const A = window.__fraktal; A.S.deOn = false; A.invalidate(); }")
        a.wait_done(120); time.sleep(0.3)
        n_off = noise(snap(pg, rect))
        it_off = pg.evaluate("() => window.__fraktal.readFrontAt([[100, 100], [400, 800], [700, 1500], [412, 839], [10, 1600]]).values")
        res['sea3000']['noiseOff'] = round(n_off, 4)
        need(n_off > 0.10, f'Schalter aus: Farbsprünge {n_off:.1%} > 10 % (wie 6.0)')
        need(it_on == it_off, f'Iterationspuffer mit/ohne Distanzschätzung identisch {it_on}')
        pg.evaluate("() => { const A = window.__fraktal; A.S.deOn = true; A.S.iterManual = false; A.invalidate(); }")
        # --- Perturbation 1e9 (GPU) und CPU-Pfad
        a.set_view(*WALK); a.wait_done(120); time.sleep(0.3)
        n9 = noise(snap(pg, rect)); acc = de_accuracy(pg)
        res['walk1e9'] = {'noise': round(n9, 4), 'deGPUperturb': acc}
        need(acc['median'] < 0.15 and acc['noCode'] == 0, f'DE GPU Perturbation 1e9: Median {acc["median"]} Oktaven')
        need(n9 < 0.05, f'Randpunkt 1e9: Farbsprünge {n9:.1%} < 5 %')
        pg.evaluate("() => { const A = window.__fraktal; A.S.renderer = 'cpu'; A.invalidate(); }")
        a.wait_done(240); time.sleep(0.3)
        acc = de_accuracy(pg, 200); nc = noise(snap(pg, rect))
        res['walk1e9cpu'] = {'noise': round(nc, 4), 'deCPU': acc, 'kind': a.status()['kind']}
        need(res['walk1e9cpu']['kind'] == 'cpu' and acc['median'] < 0.15 and acc['noCode'] == 0, f'DE CPU-Pfad: Median {acc["median"]} Oktaven')
        need(nc < 0.05, f'CPU-Pfad: Farbsprünge {nc:.1%} < 5 %')
        pg.evaluate("() => { const A = window.__fraktal; A.S.renderer = 'auto'; A.invalidate(); }")
        # --- 3D: Mittelung, danach Ruhe
        a.set_view(*SEA); a.wait_done(120)
        pg.evaluate("() => { const A = window.__fraktal; A.set3d(true); }"); time.sleep(1.2); a.wait_done(120)
        pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }")
        t0 = time.time(); info = None
        while time.time() - t0 < 30:
            info = pg.evaluate("() => window.__fraktal.still3dInfo()")
            if info['key'] and info['n'] >= info['N'] and not info['pending']: break
            time.sleep(0.25)
        res['still3d'] = info
        need(info and info['n'] >= info['N'] == 8, f'3D-Stillstand: {info and info["n"]} von 8 Bildern gemittelt')
        # Ruhe: im Leerlauf rechnet die App noch Reserve-Ebenen voraus (jede neue Ebene = kurz weitermitteln);
        # sobald nichts mehr kommt, darf nur noch die Sonde laufen (alle 300 ms ein Zeichenaufruf 48×48)
        idle = []
        for _ in range(12):
            c0 = pg.evaluate(COUNT_DRAWS); time.sleep(1.5); c1 = pg.evaluate(COUNT_DRAWS)
            idle.append(c1 - c0)
            if c1 - c0 <= 6: break
        res['idleDraws'] = idle
        need(idle[-1] <= 6, f'GPU ruht nach dem Mitteln: {idle[-1]} Zeichenaufrufe in 1,5 s (nur die 48×48-Sonde; Verlauf {idle})')
        pg.evaluate("() => { const A = window.__fraktal; A.S.quality = 'eco'; }")
        need(pg.evaluate("() => window.__fraktal.aaFrames()") == 4, 'Akku-Stufe: 4 Bilder')
        pg.evaluate("() => { const A = window.__fraktal; A.S.quality = 'balanced'; A.set3d(false); }"); time.sleep(1.0)
        res['errors'] = a.errors
        need(not a.errors, f'0 Fehler (hoch) {a.errors[:3]}')
        a.close()
        # --- ?aa=0 = 6.0
        a = App(p, query='nosw&noanim&aa=0').open(); pg = a.page
        a.set_view(*SEA); a.wait_done(120)
        pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.5); a.wait_done(120); time.sleep(1.0)
        v = pg.evaluate("() => { const A = window.__fraktal; return { de: A.deActive(), aa: A.aaFrames(), still: A.still3dInfo().key, gpu: A.view3dInfo().gpu }; }")
        res['aa0'] = v
        need(not v['de'] and v['aa'] == 0 and not v['still'] and v['gpu']['still'] is None, f'?aa=0: keine Distanzschätzung/Mittelung {v}')
        need(not a.errors, f'0 Fehler (?aa=0) {a.errors[:3]}')
        a.close()
        # --- iPhone-Ersatzpfad (kein Float-Renderziel) + quer
        a = App(p, landscape=True)
        a.page.add_init_script("""(() => { const g = WebGL2RenderingContext.prototype.getExtension;
            WebGL2RenderingContext.prototype.getExtension = function (n) { return n === 'EXT_color_buffer_float' ? null : g.call(this, n); }; })()""")
        a.open(); pg = a.page
        a.set_view(*SEA); a.wait_done(120)
        pg.evaluate("() => window.__fraktal.set3d(true)"); a.wait_3d(); time.sleep(0.5); a.wait_done(120)
        pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.RC.dirty = true; }"); time.sleep(1.5)
        pg.evaluate("() => window.__fraktal.settle3d()")
        W2, H2 = pg.evaluate("() => [window.__fraktal.R.gl.canvas.width, window.__fraktal.R.gl.canvas.height]")
        img = snap(pg, [0, 0, W2, H2])
        h8 = pg.evaluate("() => window.__fraktal.view3dInfo().gpu.h8")
        print('DBG', pg.evaluate("() => ({ v: window.__fraktal.view3dInfo(), s: window.__fraktal.still3dInfo(), st: window.__fraktal.status().done })"), img.std(), img.shape, img[::200, ::200, 0].tolist()[:3])
        res['h8quer'] = {'h8': h8, 'std': round(float(img.std()), 1), 'size': [W2, H2]}
        need(h8 and img.std() > 20 and W2 > H2, f'8-bit-Ersatzpfad quer: 3D-Bild mit Inhalt (Streuung {img.std():.0f})')
        need(not a.errors, f'0 Fehler (8 bit, quer) {a.errors[:3]}')
        a.close()
    print(json.dumps(res, indent=1))
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
