#!/usr/bin/env python3
"""6.8: Bildrate im Rückflug gegen den Vorwärtsflug, 2D und 3D, Profil „Mittelklasse-Android“ wie 6.7.

Profil: Pixel 7, DPR 2,6, CPU ×4 gedrosselt + 4 Kerne, echte GPU (ANGLE/Metal), hoch und quer (--land).
Ablauf je Modus: Seepferdchen-Tal 300×, Zufallsflug Tempo 0,5 vorwärts --secs s, dann ⇄ (0,6 s Wechsel, 1 s übersprungen)
und --secs s rückwärts. Je Abschnitt: Bilder/s, Bildzeit p50/p95/max, Bilder > 50 ms; 2D zusätzlich Lücken (Anteil Bilder mit
> 2 % unbedecktem Bild) und Ø Schärfe (Pufferpixel je Bildpixel), 3D Lücken/Schärfe am unteren Bildrand (Gelände hinter der
Kamera). --revpf=0: ohne die Rückflug-Ebenen des Planers (Vergleich).
--place: fester Weg (Ziel-Flug aus der Übersicht zum Seepferdchen-Tal 10¹²) statt Zufallsflug – für faire A/B-Vergleiche.
Aufruf: python3 tests/measure_rueck.py [--land] [--place] [--secs=12] [--throttle=4] [--dpr=2.6] [--revpf=0] [--tag=v680]
Ergebnis: tests/results_rueck_<tag>_<hoch|quer>[_ort][_revpf0].json
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

FT_JS = """() => { window.__fd = []; let last = 0; window.__fdOn = true;
  const f = (t) => { if (last) window.__fd.push(t - last); last = t; if (window.__fdOn) requestAnimationFrame(f); }; requestAnimationFrame(f); }"""
FT_END = "() => { window.__fdOn = false; return window.__fd || []; }"
COV3 = """() => { const A = __fraktal, c = A.T3.lastCam; if (!c) return null; const pts = [];
  for (let i = 0; i <= 8; i++) { const g = A.T3.groundAt(c, i / 4 - 1, -0.98); if (g) pts.push([g[0], g[1]]); }
  return A.coverAt(pts); }"""


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith('--' + name + '='): return a.split('=', 1)[1]
        if a == '--' + name: return True
    return default


def stats(ft):
    if len(ft) < 5:
        return None
    s = sorted(ft)
    return {'fps': round(1000 * len(ft) / sum(ft), 1), 'p50': round(s[len(s) // 2], 1), 'p95': round(s[int(len(s) * 0.95)], 1),
            'max': round(s[-1], 1), 'over50': sum(1 for x in ft if x > 50), 'n': len(ft)}


def main():
    land = bool(arg('land', False)); secs = float(arg('secs', 12)); thr = float(arg('throttle', 4)); dpr = float(arg('dpr', 2.6))
    revpf = arg('revpf', '1'); tag = arg('tag', 'v680'); ori = 'quer' if land else 'hoch'; place = bool(arg('place', False))
    out = {'ori': ori, 'secs': secs, 'throttle': thr, 'dpr': dpr, 'revpf': revpf, 'place': place}
    with sync_playwright() as p:
        for mode in ('2d', '3d'):
            q = 'nosw&noanim' + ('&revpf=0' if revpf == '0' else '')
            a = App(p, landscape=land, query=q, extra_ctx={'device_scale_factor': dpr}).open(); pg = a.page
            cdp = a.ctx.new_cdp_session(pg)
            if thr > 1:
                cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
                cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
            if place:   # fester Weg (Ziel-Flug aus der Übersicht): vorwärts und rückwärts bei jedem Lauf dieselben Bilder
                a.set_view('-0.5', '0', 1); a.wait_done(120)
                pg.evaluate("d3 => { __fraktal.setFlySpeed(0.5); __fraktal.startFly({ cx: '-0.743643887037151', cy: '0.131825904205330', zoom: 1e12, formula: 0 }, { d3 }); }", mode == '3d')
            else:
                a.set_view('-0.7453', '0.1127', 300); a.wait_done(120)
                pg.evaluate("d3 => { __fraktal.setFlySpeed(0.5); __fraktal.startFly(undefined, { d3 }); }", mode == '3d')
            if mode == '3d' and not a.wait_3d(60):
                print('3D kam nicht', flush=True); a.close(); continue
            time.sleep(1.0)
            res = {}
            for part in ('vor', 'rueck'):
                if part == 'rueck':
                    pg.evaluate("() => __fraktal.reverseFly()"); time.sleep(1.0)
                z0 = pg.evaluate("() => __fraktal.S.cam.zoom")
                pg.evaluate(FT_JS)
                if mode == '2d': pg.evaluate("() => __fraktal.frameStats(true)")
                cov = []
                t0 = time.time()
                while time.time() - t0 < secs:
                    time.sleep(0.25)
                    if mode == '3d':
                        c = pg.evaluate(COV3)
                        if c: cov += c
                    if part == 'rueck' and pg.evaluate("() => __fraktal.FLY.out"): break
                ft = pg.evaluate(FT_END)
                z1 = pg.evaluate("() => __fraktal.S.cam.zoom")
                r = {'frames': stats(ft), 'zoom': [z0, z1], 'secs': round(time.time() - t0, 1)}
                if mode == '2d':
                    fs = pg.evaluate("() => __fraktal.frameStats()")['frames']
                    if fs:
                        r['luecken'] = round(sum(1 for f in fs if f['unc'] > 0.02) / len(fs), 4)
                        r['schaerfe'] = round(sum(f['k'] for f in fs) / len(fs), 3)
                else:
                    r['unten_luecken'] = round(sum(1 for v in cov if v == 0) / max(1, len(cov)), 4)
                    r['unten_schaerfe'] = round(sum(cov) / max(1, len(cov)), 3)
                r['revJobs'] = pg.evaluate("() => __fraktal.RC.revJobs || 0")
                res[part] = r
                print(mode, ori, part, json.dumps(r), flush=True)
            out[mode] = res
            a.close()
    fn = os.path.join(os.path.dirname(__file__), 'results_rueck_%s_%s%s%s.json' % (tag, ori, '_ort' if place else '', '_revpf0' if revpf == '0' else ''))
    with open(fn, 'w') as f:
        json.dump(out, f, indent=1)
    print('->', fn)


if __name__ == '__main__':
    main()
