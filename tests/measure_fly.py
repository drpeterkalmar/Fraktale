#!/usr/bin/env python3
"""Messung Zufallsflug (6.2): Lenkung und Randnähe, headless mit echter GPU und echtem Tempo (Pixel 7).

Je Start 30 s Flug (Tempo 0,5 Zehnerpotenzen/s, Standard): Zoom 1 (Gesamtbild), Seepferdchen-Tal 300×,
Randpunkt 1e6. Aufgezeichnet wird in der App pro Bild Kurs/Zoom (FLY.rec) und pro Sonde (300 ms) die Randlage
(FLY.recM, flyMetrics in js/app.js).
Kennzahlen:
  * Drehrate |ω| (°/s): Mittel, 95-%-Quantil, Maximum; Richtungswechsel der Drehung pro Minute (Vorzeichen-
    wechsel von ω, nur gezählt bei |ω| > 2 °/s); Ruck = |dω/dt| (°/s²): Mittel, Maximum
  * Rand: Anteil Sonden mit Mengenrand (Distanz < 0,3 Bildhälften) im mittleren Bilddrittel; Ø Anteil Boden
    innen bzw. leer (Distanz > 1 Bildhälfte); längste Strecke ohne Rand in der Bildmitte (s)
Aufruf: python3 tests/measure_fly.py [--tag=v620] [--query=flyedge=0] [--secs=30] [--land] [--burst] [--speed=0.5] [--only=ganz_1]
6.4: zusätzlich „Verloren“-Phasen pro Minute (FLY.lost > 0,3), Zeitanteil lost > 0, längste Verloren-Phase.
Ergebnis: tests/results_fly_<tag>.json, Serienbilder tests/shots/fly/<tag>/
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

STARTS = [('ganz_1', '-0.5', '0', 1), ('seepferd_300', '-0.7453', '0.1127', 300),
          ('rand_1e6', '-0.743637214380908705', '0.131822306549061970', 1e6)]


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith('--' + name + '='): return a.split('=', 1)[1]
        if a == '--' + name: return True
    return default


def turn_stats(rec):
    # rec: [t_ms, heading, zoom, om, lost]
    w = []
    for a, b in zip(rec, rec[1:]):
        dt = (b[0] - a[0]) / 1000
        if dt <= 0: continue
        d = b[1] - a[1]
        d = (d + math.pi) % (2 * math.pi) - math.pi
        w.append((b[0], math.degrees(d / dt), dt))
    if len(w) < 3: return {}
    aw = sorted(abs(x[1]) for x in w)
    T = sum(x[2] for x in w)
    sign, flips = 0, 0
    for _, om, _ in w:
        if abs(om) > 2:
            s = 1 if om > 0 else -1
            if sign and s != sign: flips += 1
            sign = s
    jerk = []
    for a, b in zip(w, w[1:]):
        dt = (b[0] - a[0]) / 1000
        if dt > 0: jerk.append(abs(b[1] - a[1]) / dt)
    return dict(meanTurn=round(sum(aw) / len(aw), 2), p95Turn=round(aw[int(0.95 * (len(aw) - 1))], 2), maxTurn=round(aw[-1], 2),
                flipsPerMin=round(flips / T * 60, 1), meanJerk=round(sum(jerk) / len(jerk), 1), maxJerk=round(max(jerk), 1), frames=len(w), secs=round(T, 1))


def lost_stats(rec):
    # rec: [t_ms, heading, zoom, om, lost] pro Bild. „Verloren“-Phase = FLY.lost steigt über 0,3 (Flug hat den Rand
    # verloren und sucht ihn neu); Zeitanteil mit lost > 0; längste Verloren-Phase
    if len(rec) < 3: return {}
    T = (rec[-1][0] - rec[0][0]) / 1000
    phases, inph, t0, longest, tl = 0, False, 0, 0, 0
    for a, b in zip(rec, rec[1:]):
        dt = (b[0] - a[0]) / 1000
        if b[4] > 0: tl += dt
        if not inph and b[4] > 0.3: inph, t0 = True, b[0]; phases += 1
        elif inph and b[4] <= 0.05: inph = False; longest = max(longest, (b[0] - t0) / 1000)
    if inph: longest = max(longest, (rec[-1][0] - t0) / 1000)
    return dict(lostPhasesPerMin=round(phases / max(T, 1e-3) * 60, 2), lostTimeShare=round(tl / max(T, 1e-3), 4), longestLost=round(longest, 1))


def edge_stats(m):
    m = [x for x in m if x.get('edgeMid') is not None]
    if not m: return {}
    has = [x['edgeMid'] > 0 for x in m]
    longest, cur, t0 = 0, 0, None
    for x, h in zip(m, has):
        if not h:
            if t0 is None: t0 = x['t']
            longest = max(longest, (x['t'] - t0) / 1000)
        else: t0 = None
    avg = lambda k: round(sum(x[k] for x in m if x[k] is not None) / len(m), 3)
    return dict(edgeMidShare=round(sum(has) / len(has), 3), edgeMidMean=avg('edgeMid'), inFrac=avg('inFrac'), emptyFrac=avg('emptyFrac'),
                edgeFrac=avg('edgeFrac'), longestNoEdge=round(longest, 1), probes=len(m), lostShare=round(sum(1 for x in m if x['lost'] > 0.5) / len(m), 3))


def main():
    tag = arg('tag', 'cur'); q = arg('query', ''); secs = float(arg('secs', 30)); land = bool(arg('land', False)); burst = bool(arg('burst', False))
    speed = float(arg('speed', 0.5))
    only = arg('only')
    out = {'tag': tag, 'query': q, 'secs': secs, 'land': land, 'runs': {}}
    shots = os.path.join(os.path.dirname(__file__), 'shots', 'fly', tag + ('_quer' if land else ''))
    if burst: os.makedirs(shots, exist_ok=True)
    with sync_playwright() as p:
        a = App(p, landscape=land, query='nosw&noanim' + ('&' + q if q else '')).open(); pg = a.page
        for name, cx, cy, z in STARTS:
            if only and only != name: continue
            pg.evaluate("() => { const A = window.__fraktal; A.stopFly(); A.set3d(false); }"); time.sleep(0.9)
            a.set_view(cx, cy, z); a.wait_done(120)
            pg.evaluate(f"() => {{ const A = window.__fraktal; A.S.flySpeed = {speed}; A.set3d(true); }}"); a.wait_3d(); time.sleep(0.5); a.wait_done(120); time.sleep(1.0)
            pg.evaluate("() => { const A = window.__fraktal; A.frameStats(true); A.startFly(); A.FLY.rec = []; A.FLY.recM = []; }")
            t0 = time.time(); bi = 0
            while time.time() - t0 < secs:
                if not pg.evaluate("() => window.__fraktal.FLY.on"): break      # Zoomgrenze erreicht: Flug zu Ende
                if burst and time.time() - t0 > secs / 2 and bi < 6:
                    pg.screenshot(path=os.path.join(shots, f'{name}_{bi}.jpg'), quality=82); bi += 1; time.sleep(0.25); continue
                time.sleep(0.5)
            r = pg.evaluate("() => { const A = window.__fraktal, F = A.FLY; const o = { rec: F.rec, recM: F.recM, zoom: A.S.cam.zoom, on: F.on, hard: A.frameStats().hard }; F.rec = null; F.recM = null; A.stopFly(); return o; }")
            res = dict(zoomEnd='%.2e' % r['zoom'], decades=round(math.log10(r['zoom'] / z), 2), stillFlying=r['on'], hard=r['hard'])
            res.update(turn_stats(r['rec'])); res.update(edge_stats(r['recM'])); res.update(lost_stats(r['rec']))
            out['runs'][name] = res
            print(name, json.dumps(res), flush=True)
        out['errors'] = a.errors
        a.close()
    keys = ['meanTurn', 'p95Turn', 'maxTurn', 'flipsPerMin', 'meanJerk', 'maxJerk', 'edgeMidShare', 'inFrac', 'emptyFrac', 'longestNoEdge',
            'lostPhasesPerMin', 'lostTimeShare', 'longestLost', 'decades']
    runs = list(out['runs'].values())
    out['mean'] = {k: round(sum(r.get(k, 0) for r in runs) / max(1, len(runs)), 3) for k in keys}
    out['max'] = {k: max((r.get(k, 0) for r in runs), default=0) for k in ['maxTurn', 'maxJerk', 'longestNoEdge', 'longestLost']}
    out['speed'] = speed
    fn = os.path.join(os.path.dirname(__file__), f'results_fly_{tag}{"_quer" if land else ""}{"_" + only if only else ""}.json')
    json.dump(out, open(fn, 'w'), indent=1)
    print('MEAN', json.dumps(out['mean']), 'MAX', json.dumps(out['max']), 'errors', len(out['errors']))


if __name__ == '__main__':
    main()
