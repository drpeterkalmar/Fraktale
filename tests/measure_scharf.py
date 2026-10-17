#!/usr/bin/env python3
"""7.1.8 – „Im Flug immer scharf“: Flugbild gegen Referenz-Standbild DERSELBEN Kamera (Peter 14.10.2026).
Je Welt: ✈-Flug im Mittelklasse-Profil (wie measure_bulbfly), nach je ~5 s pausieren -> sofort das gezeigte Flugbild
(Bewegungs- bzw. Zwischenbild), dann warten, bis das Ruhebild fertig gemittelt ist -> Referenz; weiterfliegen, nächster
Punkt. Maße auf dem mittleren Bildausschnitt (70 %, ohne Bedienung/Vignette-Rand), Helligkeit Y:
  * SSIM (7×7-Fenster) roh und nach Normierung (Mittelwert/Streuung je Bild gleich – trennt Schärfe von Beleuchtung:
    der Flug rechnet weniger Schatten-/AO-Proben als das Ruhebild)
  * Kantenschärfe = mittlerer Sobel-Betrag Flug / Referenz (normiert; 1 = gleich scharf, < 1 = weicher)
  * Hochfrequenz-Anteil = Energie im Laplace-Bild Flug / Referenz (normiert)
Abnahme: SSIM ≥ 0,95 oder Kantenschärfe ≥ 90 %; Auflösungsskala im Flug ≥ 0,95.
Aufruf: FK_HEADED=1 python3 tests/measure_scharf.py [--tag=v718] [--worlds=6,8,9,16,17] [--n=3] [--query=scharf=0]
Ergebnis: tests/results_scharf_<tag>.json, Bildpaare tests/shots/v718/scharf_<tag>_<welt>_<i>.jpg
"""
import sys, os, io, json, time, math
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_bulb import arg
from PIL import Image

NAMES = {6: 'mandelbulb', 8: 'mandelbox', 9: 'menger', 16: 'quatjulia', 17: 'kifs', 18: 'apollonian'}
SHOTS = os.path.join(os.path.dirname(__file__), 'shots', 'v718')


def luma(im):
    a = np.asarray(im.convert('RGB'), dtype=np.float64) / 255.0
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def box(x, r):
    """Mittel im (2r+1)²-Fenster über Summenbilder (Ränder: nur das Innere zählt)"""
    c = np.cumsum(np.cumsum(np.pad(x, ((1, 0), (1, 0))), 0), 1)
    k = 2 * r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def ssim(a, b, r=3):
    C1, C2 = 0.01 ** 2, 0.03 ** 2
    ma, mb = box(a, r), box(b, r)
    va, vb, cv = box(a * a, r) - ma * ma, box(b * b, r) - mb * mb, box(a * b, r) - ma * mb
    return float(np.mean(((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))))


def norm(x):
    return (x - x.mean()) / max(1e-9, x.std())


def sobel(x):
    gx = (x[1:-1, 2:] - x[1:-1, :-2]) * 2 + (x[:-2, 2:] - x[:-2, :-2]) + (x[2:, 2:] - x[2:, :-2])
    gy = (x[2:, 1:-1] - x[:-2, 1:-1]) * 2 + (x[2:, :-2] - x[:-2, :-2]) + (x[2:, 2:] - x[:-2, 2:])
    return np.hypot(gx, gy)


def lap(x):
    return x[1:-1, 1:-1] * 4 - x[:-2, 1:-1] - x[2:, 1:-1] - x[1:-1, :-2] - x[1:-1, 2:]


def compare(fly, ref):
    w, h = fly.size
    bx = (int(w * 0.15), int(h * 0.15), int(w * 0.85), int(h * 0.85))
    a, b = luma(fly.crop(bx)), luma(ref.crop(bx))
    an, bn = norm(a), norm(b)
    # Versatz: beste ganzzahlige Verschiebung (±4 px) des Flugbilds gegen die Referenz – ein gezeigtes Zwischenbild, das gegen
    # die wahre Kamera versetzt ist, wäre im Flug als Wackeln zu sehen
    best = (-1e9, 0, 0)
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            x = an[4 + dy:an.shape[0] - 4 + dy, 4 + dx:an.shape[1] - 4 + dx]; y = bn[4:-4, 4:-4]
            c = float((x * y).mean())
            if c > best[0]: best = (c, dx, dy)
    dx, dy = best[1], best[2]
    sb = ssim(a[4 + dy:a.shape[0] - 4 + dy, 4 + dx:a.shape[1] - 4 + dx], b[4:-4, 4:-4])
    return {'shift': [dx, dy], 'ssim_shift': round(sb, 4),'ssim': round(ssim(a, b), 4), 'ssim_norm': round(ssim(an * 0.15 + 0.5, bn * 0.15 + 0.5), 4),
            'kante': round(float(sobel(an).mean() / max(1e-9, sobel(bn).mean())), 3),
            'hf': round(float((lap(an) ** 2).mean() / max(1e-9, (lap(bn) ** 2).mean())), 3),
            'hell': round(float(a.mean() / max(1e-9, b.mean())), 3)}


def shot(pg):
    return Image.open(io.BytesIO(pg.screenshot(type='png'))).convert('RGB')


def main():
    tag = arg('tag', 'cur'); thr = float(arg('throttle', 4)); dpr = float(arg('dpr', 2.6))
    worlds = [int(x) for x in str(arg('worlds', '6,8,9,16,17')).split(',')]
    n = int(arg('n', 3)); extra = str(arg('query', '')); secs = float(arg('secs', 5))
    os.makedirs(SHOTS, exist_ok=True)
    out = {'tag': tag, 'query': extra, 'throttle': thr, 'dpr': dpr, 'runs': {}}
    with sync_playwright() as p:
        a = App(p, query='nosw&noanim' + (('&' + extra) if extra else ''), extra_ctx={'device_scale_factor': dpr}).open(); pg = a.page
        if thr > 1:
            cdp = a.ctx.new_cdp_session(pg)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
            cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
        for f in worlds:
            pg.evaluate(f"() => {{ const A = window.__fraktal; A.stopFly(); A.setMode({f}); A.S.chrome = false; }}"); time.sleep(3)
            pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }")
            res = []
            for i in range(n):
                time.sleep(secs)
                # (hold: die Mittelung wartet, bis das Flugbild aufgenommen ist – sonst rutscht schon das Ruhebild hinein)
                info = pg.evaluate("() => { const A = window.__fraktal; A.BULB.hold(true); A.pauseFly(true); return A.BULB.info(); }")
                fly = shot(pg)
                st = pg.evaluate("() => { const B = window.__fraktal.BULB, s = B.info().still; B.hold(false); return s; }")
                t0 = time.time()
                while time.time() - t0 < 25:
                    i2 = pg.evaluate("() => { const i = window.__fraktal.BULB.info(); return [i.still, i.K]; }")
                    if i2[0] >= i2[1]: break
                    time.sleep(0.3)
                time.sleep(0.4)
                ref = shot(pg)
                m = compare(fly, ref)
                m.update({'scale': info.get('scale'), 'N': info.get('N'), 's': info.get('s'), 'spK': info.get('spK'), 'zoom': round(info.get('zoom', 0), 1), 'still_at_shot': st})
                res.append(m)
                w, h = fly.size
                pair = Image.new('RGB', (w, h // 2)); pair.paste(fly.resize((w // 2, h // 2)), (0, 0)); pair.paste(ref.resize((w // 2, h // 2)), (w // 2, 0))
                pair.save(os.path.join(SHOTS, f'scharf_{tag}_{NAMES.get(f, f)}_{i}.jpg'), quality=85)
                print(f'{NAMES.get(f, f):12s} {i} ' + json.dumps(m), flush=True)
                pg.evaluate("() => window.__fraktal.pauseFly(false)")
            pg.evaluate("() => window.__fraktal.stopFly()")
            out['runs'][NAMES.get(f, str(f))] = res
        out['errors'] = a.errors[:3]
        a.close()
    fn = os.path.join(os.path.dirname(__file__), f'results_scharf_{tag}.json')
    with open(fn, 'w') as fo: json.dump(out, fo, indent=1, ensure_ascii=False)
    print('->', fn)


if __name__ == '__main__':
    main()
