#!/usr/bin/env python3
"""Messung Flug in 2D (6.6) gegen den 3D-Flug: Ruhe, Randlage, Tiefe, Bildrate (Pixel 7, echte GPU).

Je Startort (Gesamtbild, Seepferdchen-Tal 300×, Randpunkt 10⁶) ein Zufallsflug über --secs Sekunden (Standard 120,
Tempo 0,5 Zehnerpotenzen/s) im gewählten Modus (--mode=2d oder 3d), hoch oder quer (--land).
Kennzahlen je Lauf:
  * Bildrate: Mittel, 95-%-Quantil der Bildzeit, Bilder > 50 ms (rAF-Abstände im Flug)
  * „verloren“: Zeitanteil lost > 0, Phasen/min, längste Phase (wie measure_fly.py, 6.4)
  * Rand in der Bildmitte: Anteil Sonden mit Mengenrand im mittleren Bilddrittel, längste Strecke ohne (s)
  * erreichte Tiefe: Zoom nach 30 s und am Ende, Zehnerpotenzen pro Minute
  * Bild unfertig (getrennt bis 10³⁰ = GPU und darüber = CPU, Präfix cpu_): Anteil Bilder, in denen > 50 % des Schirms gröber als 0,5 Pufferpixel/Bildpixel sind, längste
    solche Strecke (s); Anteil Bilder mit unbedeckter Fläche > 2 %; harte Wechsel (Ebenen ohne Blende)
Mittelklasse-Profil: --throttle=4 (CPU 4× gedrosselt, 4 Kerne; die GPU lässt sich nicht drosseln).
Bildraten nur im sichtbaren Fenster aussagekräftig (FK_HEADED=1; headless drosselt macOS auf ~10–15 Bilder/s).
Serienbilder (--shots): tests/shots/flug2d/<mode>_<hoch|quer>_<start>_{start,30s,2min}.jpg
Aufruf: FK_HEADED=1 python3 tests/measure_fly2d.py --mode=2d [--land] [--secs=120] [--throttle=4] [--only=ganz_1] [--shots] [--tag=v660]
Ergebnis: tests/results_fly2d_<tag>_<mode>_<hoch|quer>[_thr4].json
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_fly import lost_stats, edge_stats, STARTS, arg

FPS_JS = """() => { window.__fd = []; let last = 0; window.__fdOn = true;
  const f = (t) => { if (last) window.__fd.push(t - last); last = t; if (window.__fdOn) requestAnimationFrame(f); }; requestAnimationFrame(f); }"""


def fps_stats(d):
    d = [x for x in d if x > 0]
    if len(d) < 10: return {}
    s = sorted(d)
    return dict(fps=round(1000 * len(d) / sum(d), 1), p95ms=round(s[int(0.95 * (len(s) - 1))], 1), long50=sum(1 for x in d if x > 50))


def frame_stats_split(fr):
    # getrennt: GPU-Tiefe (bis 10³⁰) und CPU-Tiefe (darüber, nur 2D) + Zeit bis 10³⁰
    out = {}
    g = [x for x in fr if x['z'] <= 1e30]; c = [x for x in fr if x['z'] > 1e30]
    for k, v in frame_stats(g).items(): out[k] = v
    for k, v in frame_stats(c).items(): out['cpu_' + k] = v
    if c and fr: out['t1e30'] = round((c[0]['t'] - fr[0]['t']) / 1000, 1)
    if len(c) > 1: out['cpu_decPerMin'] = round(math.log10(c[-1]['z'] / c[0]['z']) / max(1e-3, (c[-1]['t'] - c[0]['t']) / 60000), 2)
    return out


def frame_stats(fr):
    # fr: frameStats().frames – je Bild t (ms), coarse (Anteil < 0,5 Pufferpixel/Bildpixel), unc (unbedeckt), k (Mittel)
    if len(fr) < 10: return {}
    bad = [x['coarse'] > 0.5 for x in fr]
    longest, t0 = 0, None
    for x, b in zip(fr, bad):
        if b:
            if t0 is None: t0 = x['t']
            longest = max(longest, (x['t'] - t0) / 1000)
        else: t0 = None
    return dict(coarseShare=round(sum(bad) / len(bad), 3), longestCoarse=round(longest, 2),
                uncShare=round(sum(1 for x in fr if x['unc'] > 0.02) / len(fr), 3), kMean=round(sum(x['k'] for x in fr) / len(fr), 3))


def main():
    mode = arg('mode', '2d'); land = bool(arg('land', False)); secs = float(arg('secs', 120)); thr = float(arg('throttle', 1))
    tag = arg('tag', 'cur'); only = arg('only'); shots = bool(arg('shots', False)); speed = float(arg('speed', 0.5))
    d3 = mode == '3d'
    ori = 'quer' if land else 'hoch'
    sdir = os.path.join(os.path.dirname(__file__), 'shots', 'flug2d')
    if shots: os.makedirs(sdir, exist_ok=True)
    out = {'tag': tag, 'mode': mode, 'ori': ori, 'secs': secs, 'throttle': thr, 'speed': speed, 'headed': os.environ.get('FK_HEADED') == '1', 'runs': {}}
    with sync_playwright() as p:
        a = App(p, landscape=land, query='nosw&noanim').open(); pg = a.page
        if thr > 1:
            cdp = a.ctx.new_cdp_session(pg)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
            cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
        for name, cx, cy, z in STARTS:
            if only and only != name: continue
            pg.evaluate("() => { const A = window.__fraktal; A.stopFly(); A.set3d(false); }"); time.sleep(0.9)
            a.set_view(cx, cy, z); a.wait_done(120)
            if d3:
                pg.evaluate("() => window.__fraktal.set3d(true)"); a.wait_3d(); time.sleep(0.5); a.wait_done(120); time.sleep(1.0)
            snap = lambda what: pg.screenshot(path=os.path.join(sdir, f'{mode}_{ori}_{name}_{what}.jpg'), type='jpeg', quality=85) if shots else None
            snap('start')
            pg.evaluate(f"() => {{ const A = window.__fraktal; A.S.flySpeed = {speed}; A.frameStats(true); A.startFly(undefined, {{ d3: {str(d3).lower()} }}); A.FLY.rec = []; A.FLY.recM = []; }}")
            pg.evaluate(FPS_JS)
            t0 = time.time(); z30 = None; shot30 = False
            while time.time() - t0 < secs:
                if not pg.evaluate("() => window.__fraktal.FLY.on"): break       # Zoomgrenze erreicht
                el = time.time() - t0
                if el >= 30 and not shot30:
                    shot30 = True; z30 = pg.evaluate("() => window.__fraktal.S.cam.zoom"); snap('30s')
                time.sleep(0.5)
            el = time.time() - t0
            if el >= secs - 1: snap('2min' if secs >= 120 else f'{int(secs)}s')
            r = pg.evaluate("""() => { const A = window.__fraktal, F = A.FLY; window.__fdOn = false;
                const fs = A.frameStats(); const o = { rec: F.rec, recM: F.recM, zoom: A.S.cam.zoom, on: F.on, d3: F.d3, v3: A.V3.on, fd: window.__fd,
                frames: fs.frames.map(x => ({ t: x.t, z: x.z, coarse: x.coarse, unc: x.unc, k: x.k })), hard: fs.hard };
                F.rec = null; F.recM = null; A.stopFly(); return o; }""")
            res = dict(zoom30='%.2e' % z30 if z30 else None, zoomEnd='%.2e' % r['zoom'], decades=round(math.log10(r['zoom'] / z), 2),
                       decPerMin=round(math.log10(r['zoom'] / z) / max(el, 1) * 60, 2), secs=round(el, 1), stillFlying=r['on'], d3=r['d3'], v3=r['v3'], hard=r['hard'])
            res.update(fps_stats(r['fd'])); res.update(lost_stats(r['rec'])); res.update(edge_stats(r['recM'])); res.update(frame_stats_split(r['frames']))
            out['runs'][name] = res
            print(name, json.dumps(res), flush=True)
        out['errors'] = a.errors
        a.close()
    keys = ['fps', 'p95ms', 'long50', 'lostTimeShare', 'lostPhasesPerMin', 'edgeMidShare', 'longestNoEdge', 'inFrac', 'emptyFrac', 'decades', 'decPerMin',
            'coarseShare', 'longestCoarse', 'uncShare', 'kMean', 'hard', 't1e30', 'cpu_coarseShare', 'cpu_kMean', 'cpu_decPerMin']
    runs = list(out['runs'].values())
    out['mean'] = {k: round(sum(r.get(k, 0) or 0 for r in runs) / max(1, len(runs)), 3) for k in keys}
    fn = os.path.join(os.path.dirname(__file__), f'results_fly2d_{tag}_{mode}_{ori}{"_thr%d" % thr if thr > 1 else ""}{"_" + only if only else ""}.json')
    json.dump(out, open(fn, 'w'), indent=1)
    print('MEAN', json.dumps(out['mean']), 'errors', len(out['errors']), out['errors'][:3])


if __name__ == '__main__':
    main()
