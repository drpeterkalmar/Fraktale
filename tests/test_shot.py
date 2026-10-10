#!/usr/bin/env python3
"""6.8.1: Screenshot in hoher Auflösung (Kachel-Rendern, js/capture.js), echte GPU.

Prüft:
  * Kachelnähte: dasselbe Bild (640 × 360) in einem Stück und in Kacheln (128 px, 3D 160 px) – Pixelvergleich.
    2D (Mandelbrot tief/GPU-Perturbation, Mandelbrot jenseits der GPU-Tiefe/CPU-Perturbation, Julia, Newton) und
    Mandelbulb: bitgleich (0 abweichende Werte). 3D aus demselben eingefrorenen Zustand: < 0,2 % der Werte um höchstens 8/255 (Rundung, unsichtbar), keine Naht
    (mittlere Abweichung an den Kachelkanten nicht größer als im übrigen Bild).
  * Bedienung (Pixel 7): Option „Screenshot-Auflösung“ (Bildschirm/2×/4×/8K/Eigene, Seitenverhältnis wie Bildschirm/frei,
    Beschriftung an/aus) wird gespeichert; Schätzung (Größe, Dauer, Dateigröße) im Menü und vor dem Start; Fortschritt
    „Rendere Kachel i/n“; Abbrechen; Dateiname mit Auflösung; ein laufender Flug ist danach wieder unterwegs; Buddhabrot:
    nur „Bildschirm“ wählbar, Bild in Bildschirmauflösung; Kontextverlust während des Renderns -> sauberer Abbruch mit
    Hinweis, danach geht es wieder.
  * --matrix (Messung, Desktop 1280 × 720): 1× / 4× / 8K / 16384 × 9216 je Modus (Mandelbrot tief, Julia, 3D-Landschaft) –
    Größe, Zeit, Dateigröße, Spitzen-Speicher der Browser-Prozesse; Ausschnitte (Mitte, Kachelkante, Beschriftung) nach
    tests/shots/v681/, Nahtmaß (Sprung über die Kachelkante gegen benachbarte Spalten).
Aufruf: python3 tests/test_shot.py [--matrix]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time, threading, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'results_shot_v681.json')
OUT_M = os.path.join(HERE, 'results_shot_v681_matrix.json')
SHOTS = os.path.join(HERE, 'shots', 'v681')
TMP = '/tmp/fk_shot'
DEEP = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')

# zwei Aufnahmen vergleichen (im Seitenkontext dekodiert): abweichende Werte, größte Abweichung, mittlere Abweichung an
# den Kachelkanten (Spalten/Zeilen bei Vielfachen von tile ±1) und im übrigen Bild
CMP = """async ([o1, o2, tile]) => {
  const A = window.__fraktal;
  const r1 = await A.captureShot(o1); const r2 = await A.captureShot(o2);
  const dec = async (b) => { const bm = await createImageBitmap(b); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height); };
  const a = await dec(r1.blob), b = await dec(r2.blob), W = a.width, H = a.height;
  let n = 0, mx = 0, se = 0, sn = 0, oe = 0, on = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const seam = (x % tile <= 1 || x % tile >= tile - 2) && x > 2 || (y % tile <= 1 || y % tile >= tile - 2) && y > 2;
    let m = 0; for (let k = 0; k < 3; k++) { const i = 4 * (y * W + x) + k, d = Math.abs(a.data[i] - b.data[i]); if (d) { n++; if (d > mx) mx = d; } m += d; }
    if (seam) { se += m; sn++; } else { oe += m; on++; }
  }
  const strip = (x) => { const o = Object.assign({}, x); delete o.blob; return o; };
  return { one: strip(r1), tiled: strip(r2), ndiff: n, maxdiff: mx, seam: se / Math.max(1, sn) / 3, rest: oe / Math.max(1, on) / 3, W, H };
}"""

SAVE = """async (o) => { const A = window.__fraktal; const r = await A.captureShot(o);
  const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = A.fileName(r.W, r.H);
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 120000);
  const x = Object.assign({}, r); delete x.blob; x.name = a.download; return x; }"""


class RSS:
    """Spitzen-Speicher (Summe RSS) aller Playwright-Browser-Prozesse, alle 0,4 s gemessen"""
    def __init__(self):
        self.peak = 0; self.on = True
        self.t = threading.Thread(target=self.run, daemon=True); self.t.start()
    def sample(self):
        out = subprocess.run(['ps', '-Ao', 'rss,command'], capture_output=True, text=True).stdout
        return sum(int(l.split(None, 1)[0]) for l in out.splitlines()[1:] if 'ms-playwright' in l) / 1024
    def run(self):
        while self.on:
            try: self.peak = max(self.peak, self.sample())
            except Exception: pass
            time.sleep(0.4)
    def stop(self):
        self.on = False; self.t.join(1); return round(self.peak)


def main():
    matrix = '--matrix' in sys.argv
    os.makedirs(SHOTS, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    res, ok, chk, errors = {}, True, [], []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)
    with sync_playwright() as p:
        # ------------------------------------------------------------ Nähte
        a = App(p).open(); pg = a.page
        cases = [
            ('Mandelbrot tief (GPU-Perturbation)', lambda: a.set_view(DEEP[0], DEEP[1], 3e9), {}, 640, 360, 128, ('gpu', 'perturb')),
            ('Mandelbrot 10³⁴ (CPU-Perturbation)', lambda: a.set_view(DEEP[0], DEEP[1], 1e34), {}, 320, 180, 96, ('cpu', 'perturb')),
            ('Julia (GPU direkt)', lambda: a.set_view('0', '0', 1.5, formula=1), {}, 640, 360, 128, ('gpu', 'direct')),
            ('Newton', lambda: a.set_view('0', '0', 1.2, formula=5), {}, 640, 360, 128, ('gpu', 'direct')),
        ]
        res['naehte'] = {}
        for name, setup, extra, W, H, tl, devmode in cases:
            setup(); a.wait_done(180)
            r = pg.evaluate(CMP, [dict(W=W, H=H, label=False, time=50), dict(W=W, H=H, tile=tl, label=False, time=50), tl])
            res['naehte'][name] = r
            dm = (r['tiled']['dev'], r['tiled']['mode'])
            need(r['tiled']['tiles'] > 4 and dm == devmode and r['ndiff'] == 0,
                 f"Naht {name}: {r['tiled']['tiles']} Kacheln gegen ein Stück, {r['ndiff']} abweichende Werte (Rechenweg {dm[0]}/{dm[1]})")
        pg.evaluate("() => __fraktal.setMode(6)"); time.sleep(2)
        r = pg.evaluate(CMP, [dict(W=640, H=360, label=False, time=50), dict(W=640, H=360, tile=128, label=False, time=50), 128])
        res['naehte']['Mandelbulb'] = r
        need(r['tiled']['tiles'] > 4 and r['ndiff'] == 0, f"Naht Mandelbulb: {r['tiled']['tiles']} Kacheln, {r['ndiff']} abweichende Werte")
        pg.evaluate("() => __fraktal.setMode(0)"); a.set_view('-0.7453', '0.1127', 200); a.wait_done(60)
        pg.evaluate("() => __fraktal.set3d(true)"); a.wait_3d(30); time.sleep(6)
        pg.evaluate("() => __fraktal.freeze(true)")
        r = pg.evaluate(CMP, [dict(W=640, H=360, label=False, time=50), dict(W=640, H=360, tile=160, label=False, time=50, reuse=True), 160])
        pg.evaluate("() => __fraktal.freeze(false)")
        res['naehte']['3D'] = r
        # (3D: Rundung im Raster/Bloom je Kachel – wenige Werte um wenige Stufen, unsichtbar; eine Naht hieße Abweichung an den Kanten)
        need(r['tiled']['tiles'] > 4 and r['maxdiff'] <= 8 and r['ndiff'] < 0.002 * r['W'] * r['H'] * 3 and r['seam'] <= r['rest'] * 3 + 0.01,
             f"Naht 3D: {r['tiled']['tiles']} Kacheln, {r['ndiff']} von {r['W'] * r['H'] * 3} Werten weichen ab, höchstens {r['maxdiff']}/255; "
             f"mittlere Abweichung an den Kanten {r['seam']:.4f}, sonst {r['rest']:.4f}")
        pg.evaluate("() => __fraktal.set3d(false)"); time.sleep(1.2)
        errors += a.errors
        a.close()

        # ------------------------------------------------------------ Bedienung (Pixel 7)
        a = App(p).open(); pg = a.page
        a.set_view('-0.7453', '0.1127', 200); a.wait_done(60)
        pg.click('.dock-btn[data-tab="more"]'); time.sleep(0.6)
        infos = {}
        for v in ('screen', '2x', '4x', '8k'):
            pg.click(f'#seg-shot button[data-v="{v}"]'); time.sleep(0.2)
            infos[v] = pg.inner_text('#shot-info')
        dw, dh = pg.evaluate("() => __fraktal.shot.devSize()")
        res['menue'] = infos
        need(infos['screen'].startswith(f'{dw} × {dh}') and infos['2x'].startswith(f'{2 * dw} × {2 * dh}') and infos['4x'].startswith(f'{4 * dw} × {4 * dh}') and infos['8k'].startswith('7680 × 4320')
             and all(' MP · ' in x and 'ca.' in x and (' MB' in x or ' kB' in x) for x in infos.values()), f'Menü: Größe, MP, Dauer, Dateigröße je Stufe {infos}')
        pg.click('#seg-shot button[data-v="custom"]'); time.sleep(0.2)
        cust0 = [pg.input_value('#shot-w'), pg.input_value('#shot-h'), pg.is_disabled('#shot-h')]
        pg.click('#seg-shot-aspect button[data-v="free"]'); time.sleep(0.2)
        pg.fill('#shot-w', '3000'); pg.press('#shot-w', 'Enter'); pg.fill('#shot-h', '2000'); pg.press('#shot-h', 'Enter'); time.sleep(0.2)
        pg.evaluate("() => { const c = document.getElementById('t-shotlabel'); c.checked = false; c.dispatchEvent(new Event('change')); }")
        info_c = pg.inner_text('#shot-info')
        a.page.reload(wait_until='load'); pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000); time.sleep(1)
        st = pg.evaluate("() => { const S = __fraktal.S; return [S.shotRes, S.shotW, S.shotH, S.shotAspect, S.shotLabel, __fraktal.shot.size()]; }")
        need(cust0[0] == '3840' and cust0[2] and info_c.startswith('3000 × 2000') and st[:5] == ['custom', 3000, 2000, 'free', False] and st[5] == [3000, 2000],
             f'Eigene Größe (Vorgabe {cust0[0]}, Höhe wie Bildschirm gesperrt {cust0[2]}), frei 3000 × 2000, Beschriftung aus – nach Neuladen gespeichert {st}')
        # Seitenverhältnis wie Bildschirm: Höhe folgt der Breite
        pg.evaluate("() => { __fraktal.S.shotAspect = 'screen'; }")
        sz = pg.evaluate("() => __fraktal.shot.size()")
        need(abs(sz[1] - round(3000 * dh / dw)) <= 1, f'Eigene Größe wie Bildschirm: 3000 × {sz[1]} (Bildschirm {dw} × {dh})')
        # Ablauf: 2× mit Flug, Abfrage, Fortschritt, Ergebnis, Dateiname, Flug läuft danach weiter
        pg.evaluate("() => { const S = __fraktal.S; S.shotRes = '2x'; S.shotLabel = true; __fraktal.saveSettings(); }")
        a.set_view('-0.7453', '0.1127', 200); a.wait_done(60)
        pg.click('#btn-fly2d'); time.sleep(1.5)
        pg.click('#btn-share'); time.sleep(0.3); pg.click('#share-image'); time.sleep(0.5)
        ask = [pg.inner_text('#shot-title'), pg.inner_text('#shot-sub'), pg.is_visible('#shot-go')]
        pg.click('#shot-go'); time.sleep(1.2)
        run = [pg.inner_text('#shot-title'), pg.inner_text('#shot-sub'), pg.evaluate("() => [__fraktal.FLY.on, __fraktal.FLY.paused, __fraktal.shot.busy()]")]
        z_run = pg.evaluate("() => __fraktal.S.cam.zoom"); time.sleep(1.0); z_run2 = pg.evaluate("() => __fraktal.S.cam.zoom")
        dl = None
        with pg.expect_download(timeout=180000) as d:
            t0 = time.time()
            while time.time() - t0 < 170:
                if pg.is_visible('#shot-save'):
                    pg.click('#shot-save'); break
                if not pg.evaluate("() => __fraktal.shot.busy()") and pg.is_hidden('#shot-panel'):
                    break
                time.sleep(0.3)
        dl = d.value
        fn = dl.suggested_filename
        time.sleep(1.5)
        fly_after = pg.evaluate("() => [__fraktal.FLY.on, __fraktal.FLY.paused]")
        res['ablauf'] = {'ask': ask, 'run': run, 'datei': fn, 'flug_danach': fly_after}
        need(ask[2] and '2×' in ask[0] and ask[1].startswith(f'{2 * dw} × {2 * dh}') and 'ca.' in ask[1], f'Abfrage vor dem Start: {ask[0]!r} {ask[1]!r}')
        need('Kachel' in run[0] or 'vorbereitet' in run[0] or 'gespeichert' in run[0], f'Fortschritt: {run[0]!r} {run[1]!r}')
        need(run[2][0] and run[2][1] and z_run == z_run2, f'Während des Renderns steht die Ansicht (Flug angehalten {run[2]}, Zoom unverändert)')
        need(f'_{2 * dw}x{2 * dh}_' in fn and fn.endswith('.png'), f'Dateiname mit Auflösung: {fn}')
        need(fly_after[0] and not fly_after[1], f'Flug danach wieder unterwegs {fly_after}')
        pg.evaluate("() => __fraktal.stopFly()")
        # Abbrechen
        pg.evaluate("() => { __fraktal.S.shotRes = '4x'; }")
        pg.click('#btn-share'); time.sleep(0.3); pg.click('#share-image'); time.sleep(0.4); pg.click('#shot-go'); time.sleep(1.5)
        b1 = pg.evaluate("() => __fraktal.shot.busy()")
        pg.click('#shot-x'); time.sleep(0.8)
        b2 = pg.evaluate("() => [__fraktal.shot.busy(), document.getElementById('shot-panel').hidden, document.getElementById('toast').textContent]")
        time.sleep(1.0)
        st2 = a.status()
        need(b1 and not b2[0] and b2[1] and 'abgebrochen' in b2[2], f'Abbrechen: lief {b1}, danach frei {b2}')
        # Kontextverlust während des Renderns
        pg.evaluate("() => { __fraktal.S.shotRes = '4x'; window.__shotErr = null; __fraktal.captureShot().then(() => { window.__shotErr = 'ok'; }, (e) => { window.__shotErr = e.message; }); }")
        time.sleep(1.5)
        pg.evaluate("() => { window.__lc = __fraktal.R.gl.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); }")
        time.sleep(1.0)
        e1 = pg.evaluate("() => [window.__shotErr, __fraktal.shot.busy()]")
        pg.evaluate("() => window.__lc.restoreContext()"); time.sleep(3)
        a.set_view('-0.7453', '0.1127', 300); a.wait_done(90)
        r_ok = pg.evaluate("async () => { const r = await __fraktal.captureShot({ W: 800, H: 450 }); return [r.W, r.H, r.blob.size]; }")
        need(e1[0] == 'lost' and not e1[1] and r_ok[0] == 800 and r_ok[2] > 1000, f'Kontextverlust: Abbruch mit „lost“ {e1}, danach wieder ein Screenshot {r_ok}')
        # Buddhabrot: nur Bildschirm
        pg.evaluate("() => __fraktal.setMode(7)"); time.sleep(2.5)
        pg.click('.dock-btn[data-tab="more"]'); time.sleep(0.6)
        dis = pg.evaluate("() => [...document.querySelectorAll('#seg-shot button')].map(b => [b.dataset.v, b.disabled])")
        hint = pg.is_visible('#shot-buddha')
        rb = pg.evaluate("async () => { const r = await __fraktal.captureShot(); return [r.W, r.H, r.blob.size, __fraktal.R.canvas.width, __fraktal.R.canvas.height]; }")
        need(all(d == (v != 'screen') for v, d in dis) and hint and rb[0] == rb[3] and rb[1] == rb[4] and rb[2] > 1000,
             f'Buddhabrot: nur „Bildschirm“ wählbar ({dis}), Hinweis sichtbar {hint}, Bild {rb[0]} × {rb[1]}')
        errors += [e for e in a.errors if 'CONTEXT_LOST' not in e and 'context' not in e.lower()]
        a.close()

        # ------------------------------------------------------------ Größenmatrix (Messung)
        if matrix:
            from PIL import Image
            Image.MAX_IMAGE_PIXELS = None
            mres = []
            modes = [('mandelbrot_tief', lambda a: a.set_view(DEEP[0], DEEP[1], 3e9)),
                     ('julia', lambda a: a.set_view('-0.12', '0.75', 3, formula=1)),
                     ('3d', None)]
            sizes = [('1x', None), ('4x', None), ('8k', None), ('16k', (16384, 9216))]
            for mname, setup in modes:
                a = App(p, device='Desktop Chrome').open(); pg = a.page
                if mname == '3d':
                    a.set_view('-0.7453', '0.1127', 200); a.wait_done(60)
                    pg.evaluate("() => __fraktal.set3d(true)"); a.wait_3d(30); time.sleep(5)
                else:
                    setup(a); a.wait_done(240)
                for sname, wh in sizes:
                    o = {'label': True}
                    if wh: o.update(W=wh[0], H=wh[1])
                    else: pg.evaluate("(v) => { __fraktal.S.shotRes = v; }", {'1x': 'screen'}.get(sname, sname))
                    if sname == '16k': pg.evaluate("() => { __fraktal.S.shotRes = 'screen'; }")
                    plan = pg.evaluate("(o) => { const P = __fraktal.shot.plan(o); return { W: P.W, H: P.H, n: P.n, tw: P.tw, th: P.th, stream: P.stream, est: P.est, m: P.m }; }", o)
                    rss = RSS()
                    t0 = time.time()
                    with pg.expect_download(timeout=1800000) as d:
                        info = pg.evaluate(SAVE, o)
                    path = os.path.join(TMP, d.value.suggested_filename); d.value.save_as(path)
                    wall = time.time() - t0
                    peak = rss.stop()
                    im = Image.open(path)
                    W, H = im.size
                    tag = f'{mname}_{sname}'
                    e = {'mode': mname, 'size': sname, 'W': W, 'H': H, 'datei': os.path.basename(path), 'bytes': os.path.getsize(path), 'ms': info['ms'], 'wall_s': round(wall, 1),
                         'tiles': info['tiles'], 'tile': info['tile'], 'stream': info['stream'], 'dev': info.get('dev'), 'mode_rechnung': info.get('mode'), 'est': plan['est'],
                         'rss_peak_mb': peak, 'margin': info.get('margin')}
                    # Ausschnitte: Mitte, Kachelkante (erste senkrechte Kante, Mitte der Höhe), Beschriftung unten links
                    cw, ch = min(W, 960), min(H, 600)
                    im.crop(((W - cw) // 2, (H - ch) // 2, (W + cw) // 2, (H + ch) // 2)).convert('RGB').save(os.path.join(SHOTS, tag + '_mitte.jpg'), quality=88)
                    tw = info['tile'][0]
                    if tw < W:
                        x0 = max(0, tw - cw // 2)
                        seam = im.crop((x0, (H - ch) // 2, x0 + cw, (H + ch) // 2)).convert('RGB')
                        seam.save(os.path.join(SHOTS, tag + '_kante.jpg'), quality=88)
                        # Nahtmaß: mittlerer Sprung über die Kante (Spalte tw−1 -> tw) gegen benachbarte Spaltenpaare
                        import numpy as np
                        band = np.asarray(im.crop((tw - 6, 0, tw + 6, H)).convert('RGB'), dtype=np.int16)
                        jumps = np.abs(np.diff(band, axis=1)).mean(axis=(0, 2))   # 11 Spaltenpaare, Index 5 = über die Kante
                        e['naht'] = {'ueber_kante': round(float(jumps[5]), 3), 'nachbarn': round(float(np.delete(jumps, 5).mean()), 3)}
                    im.crop((0, H - min(H, 400), min(W, 1400), H)).convert('RGB').save(os.path.join(SHOTS, tag + '_beschriftung.jpg'), quality=88)
                    im.close()
                    os.remove(path)
                    mres.append(e)
                    print('   ', json.dumps(e, ensure_ascii=False), flush=True)
                    need(W == plan['W'] and H == plan['H'], f"{tag}: {W} × {H} in {info['ms'] / 1000:.1f} s, {e['bytes'] / 1e6:.1f} MB, {info['tiles']} Kacheln, Speicher (Browser) max. {peak} MB"
                         + (f", Naht {e['naht']['ueber_kante']} gegen {e['naht']['nachbarn']}" if 'naht' in e else ''))
                    if 'naht' in e:
                        need(e['naht']['ueber_kante'] <= 1.6 * e['naht']['nachbarn'] + 0.5, f'{tag}: keine sichtbare Kante (Sprung über die Kachelkante wie zwischen Nachbarspalten)')
                errors += a.errors
                a.close()
            with open(OUT_M, 'w') as f:
                json.dump(mres, f, indent=1, ensure_ascii=False)
    need(not errors, f'Fehler: {errors[:3]}')
    res['checks'] = chk
    if not matrix or os.path.exists(OUT) is False:
        with open(OUT, 'w') as f:
            json.dump(res, f, indent=1, ensure_ascii=False)
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
