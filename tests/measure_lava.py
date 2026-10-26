#!/usr/bin/env python3
"""7.2.1 Lavalampen-Flug – Messung je Rechenweg (Brief fraktale-lavalampe-zufallsstart, Etappe 2).

Je Lauf N s Autopilot (2D-Flug bzw. Flug der 3D-Körper, Tempo 0,3) bzw. eine Tour (Autozoom zu einem tiefen Ort); je rAF
aufgezeichnet: Flugzeit (FLY.simT, ohne Takt-Zittern), log10(Zoom), Kamera-Mitte (2D) bzw. Position (3D), Schärfe des
gezeigten Bildes (2D: Anteil des Schirms mit < 0,5 Pufferpx je Bildpx aus der Pop-Metrik frameStats; 3D-Körper: Bewegungs-
Skala < 0,8 oder an der Genauigkeitsgrenze), Phase des Lavalampen-Reglers.
Größen:
  coarse      Anteil grob gepixelter Bilder (> 10 % des Schirms grob)
  still       Anteil Bilder ohne Kamerabewegung (Regel 7.1.13: Soll 0 %)
  jz95/jzmax  Ruck des Zooms: |3. Ableitung von log10(Zoom)| (Zehnerpotenzen/s³), p95 und max
  jp95/jpmax  Ruck der Bildmitte in Bildhälften/s³ (2D) bzw. relativ zum Abstand (3D)
  hard        harte Richtungswechsel: Zoomtempo kippt binnen 0,5 s von > +30 % auf < −30 % des Reisetempos (oder umgekehrt)
  flips_min   Rein/Raus-Wechsel je Minute (Zoomrichtung mit Hysterese ±0,02 Zehnerpotenzen/s), minGap = kürzeste volle Pendelperiode (Abstand gleichartiger Wechsel, s)
  sharp_s     Zeit bis „wieder scharf“: Dauer der Episoden grober Bilder (max, Mittel)
Aufruf: FK_HEADED=1 python3 tests/measure_lava.py [--base=http://localhost:8479/index.html] [--tag=v7114] [--secs=60]
        [--runs=seepferd,ship,phoenix,phoenix,bulb,menger,tour] [--query=lava=0]
        7.3.0 (df64-Exoten): --runs=phoenix,nova,magnet,magnet2,ship --secs=20; Vergleich ohne df64: --query=df64=0
  fps         Bilder je Sekunde (rAF), brake = Anteil der Bilder außerhalb des Reiseflugs (Lavalampe bremst/schwebt/zoomt heraus)
Ergebnis: tests/results_lava_<tag>.json + Tabelle
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
import e2e_lib
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
if 'base' in ARGS:
    e2e_lib.BASE = ARGS['base']
TAG = ARGS.get('tag', 'cur'); SECS = float(ARGS.get('secs', 60)); EXTRA = ARGS.get('query', '')
RUNS = ARGS.get('runs', 'seepferd,ship,phoenix,phoenix,bulb,menger,tour').split(',')
SPEED = float(ARGS.get('speed', 0.3))
SKIP = float(ARGS.get('skip', 3))      # Ruck erst ab 3 s Flugzeit (Anfahrt 2 s)
SPEC = {
    'seepferd': {'hash': 'm=0&x=-0.7453&y=0.1127&z=180', 'kind': '2d'},
    'ship': {'hash': 'm=2&x=-1.7609&y=-0.0275&z=60', 'kind': '2d'},
    'phoenix': {'hash': 'm=11&x=0.690104&y=0.546875&z=30000', 'kind': '2d'},
    # 7.3.0 df64-Exoten (Brief fraktale-v7-2-exoten-df64, Etappe 2): Orte der Sehenswürdigkeiten, Start bei 3·10⁴
    'nova': {'hash': 'm=12&x=-0.3690755&y=0.0488281&z=30000', 'kind': '2d'},
    'magnet': {'hash': 'm=13&x=0.0947088068&y=-1.0600142045&z=30000', 'kind': '2d'},
    'magnet2': {'hash': 'm=13&x=1.3384943182&y=-0.5326704545&z=30000&wp=v1', 'kind': '2d'},
    # Tour (Autozoom zu einem festen Ziel 10⁸, gerade Fahrt ohne Suchen des Autopiloten): Randstellen aus tests/test_v730.py B
    'tour_phoenix': {'hash': 'm=11&x=0&y=0&z=0.45', 'kind': 'tour', 'place': {'formula': 11, 'cx': '0.755715446865423024', 'cy': '-0.466920850049038216', 'zoom': 1e8}},
    'tour_magnet2': {'hash': 'm=13&x=1.2&y=0&z=0.55&wp=v1', 'kind': 'tour', 'place': {'formula': 13, 'cx': '-0.131243619308578779', 'cy': '-0.190348596093646183', 'zoom': 1e8, 'wp': {'v': 1}}},
    'tour_multi': {'hash': 'm=4&x=0&y=0&z=1&wp=e5', 'kind': 'tour', 'place': {'formula': 4, 'cx': '0.795511286006855167', 'cy': '-0.757434906948750264', 'zoom': 1e8, 'wp': {'e': 5, 'm': 0}}},
    'bulb': {'world': 6, 'kind': 'bulb'},
    'menger': {'world': 9, 'kind': 'bulb'},
    'tour': {'hash': 'm=0&x=-0.5&y=0&z=1', 'kind': 'tour', 'sight': 'mb_deep'},
}
REC = """(ms) => new Promise(res => { const A = window.__fraktal, HP = A.HP, out = []; const t0 = performance.now();
  A.frameStats(true); let prev = null;
  const f = (t) => { const c = A.S.cam, ray = A.isRay(), bi = ray ? A.BULB.info() : null, L = A.FLY.lava || null;
    // 2D: Verschiebung der Mitte seit dem Bild davor in Bildhälften (BigInt-Differenz, auch im Deep Zoom genau)
    let d = [0, 0], same = false;
    if (!ray && prev) { const u = 1.5 / prev.zoom; d = [HP.toNumber(c.cx - prev.cx) / u, HP.toNumber(c.cy - prev.cy) / u]; same = c.cx === prev.cx && c.cy === prev.cy && c.zoom === prev.zoom; }
    if (ray) { same = !!out.length && out[out.length - 1][3].join() === A.BULB.B.pos.join(); }
    prev = { cx: c.cx, cy: c.cy, zoom: c.zoom };
    out.push([t, ray ? A.BULB.flyInfo().simT : (A.FLY.simT || 0), Math.log10(c.zoom), ray ? A.BULB.B.pos.slice() : d,
              ray ? ((bi.scale || 1) < 0.8 || bi.limit ? 1 : 0) : null, ray ? bi.flyD : 0, L ? L.phase : '', A.FLY.on ? A.FLY.sp : 0, same, +A.GOV.g.toFixed(3), A.GOV.q === null || A.GOV.q === undefined ? null : +(+A.GOV.q).toFixed(3), !!A.isMoving()]);
    if (t - t0 < ms) requestAnimationFrame(f); else res({ rec: out, fs: A.frameStats().frames.map(x => [x.t, x.coarse]) }); }; requestAnimationFrame(f); })"""


def analyse(d, kind):
    rec, fs = d['rec'], d['fs']
    if kind == 'tour':      # Tour: nur die Fahrt (nach der Ankunft steht die Kamera gewollt)
        last = max([i for i, r in enumerate(rec) if len(r) > 11 and r[11]] or [len(rec) - 1])
        rec = rec[:last + 1]
    # Schärfe je Bild: 2D aus frameStats (gleicher Zeitstempel wie rAF), sonst aus der Aufzeichnung
    fsd = {int(round(t * 10)): c for t, c in fs}
    coarse = []
    for r in rec:
        if r[4] is not None: coarse.append(r[4] > 0.5)
        else:
            k = int(round(r[0] * 10)); c = fsd.get(k, fsd.get(k - 1, fsd.get(k + 1)))
            coarse.append(c is not None and c > 0.10)
    n = len(rec)
    # Stillstand: Kamera gleich wie im Bild davor
    still = sum(1 for i in range(1, n) if rec[i][8])
    # Zeitachse: Flugzeit; doppelte Zeitpunkte (Bild ohne Flugschritt) zählen nicht für die Ableitungen
    pts = []
    acc = [0.0, 0.0]
    for r in rec:
        if kind != 'bulb':
            acc = [acc[0] + r[3][0], acc[1] + r[3][1]]     # 2D: Weg der Mitte in Bildhälften (je Bild in dessen Maßstab)
        if pts and (r[1] if kind != 'tour' else r[0] / 1000) <= pts[-1][0] + 1e-9: continue
        if kind == 'bulb': pos = r[3]; sc = r[5] or 1
        else: pos = list(acc); sc = 1
        pts.append((r[1] if kind != 'tour' else r[0] / 1000, r[2], pos, sc))
    # Ruck: je Bild ein kubisches Polynom (kleinste Quadrate) über ±0,12 s Flugzeit, Ruck = 6·c3 – robust gegen ungleiche
    # Takt-Abstände (ein ausgefallener Takt erzeugte mit einfachen Differenzen Schein-Ruck bei jeder Tempoänderung)
    import numpy as np
    ts = np.array([p[0] for p in pts]); lz = np.array([p[1] for p in pts])
    P = np.array([p[2] for p in pts], dtype=float)
    W = 0.12
    jzs, pj, v, tv = [], [], [], []
    lo = 0
    for i in range(len(ts)):
        while ts[i] - ts[lo] > W: lo += 1
        hi = i
        while hi + 1 < len(ts) and ts[hi + 1] - ts[i] <= W: hi += 1
        if hi - lo < 8 or ts[i] - ts[lo] < W * 0.8 or ts[hi] - ts[i] < W * 0.8: continue
        if kind != 'tour' and ts[i] - ts[0] < SKIP: continue      # Anfahrt (S-Kurve 7.1.6, in beiden Ständen gleich) nicht mitzählen
        tt = ts[lo:hi + 1] - ts[i]
        V = np.vander(tt, 4)
        cz = np.linalg.lstsq(V, lz[lo:hi + 1], rcond=None)[0]
        jzs.append(abs(6 * cz[0])); v.append(cz[2]); tv.append(ts[i])
        sc = pts[i][3]
        cp = np.linalg.lstsq(V, P[lo:hi + 1] / sc, rcond=None)[0]
        pj.append(float(np.hypot(*[6 * cp[0][k] for k in range(P.shape[1])])) if P.shape[1] == 2 else float(np.linalg.norm(6 * cp[0])))
    jz = jzs
    q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(len(xs) * p))] if xs else 0
    cruise = max(0.05, float(q([abs(x) for x in v], 0.9)))
    # harte Richtungswechsel (Zoomtempo kippt binnen 0,5 s)
    hard = 0; last = -9
    for i in range(len(v)):
        if v[i] > 0.3 * cruise or v[i] < -0.3 * cruise:
            k = i
            while k < len(v) and tv[k] - tv[i] < 0.5:
                if (v[i] > 0 and v[k] < -0.3 * cruise) or (v[i] < 0 and v[k] > 0.3 * cruise):
                    if tv[i] - last > 1: hard += 1; last = tv[i]
                    break
                k += 1
    # Rein/Raus-Wechsel mit Hysterese (Zoomtempo über 0,4 s gemittelt)
    sm = []
    for i in range(len(v)):
        w = [v[k] for k in range(len(v)) if abs(tv[k] - tv[i]) <= 0.2]
        sm.append(sum(w) / len(w))
    state, flips, tfl = 0, [], []
    for i, x in enumerate(sm):
        s = 1 if x > 0.02 else -1 if x < -0.02 else state
        if state and s != state: flips.append(tv[i])
        state = s
    gaps = [flips[i] - flips[i - 2] for i in range(2, len(flips))]      # volle Pendel (rein -> raus -> rein): Abstand gleicher Wechsel
    dur = max(1e-6, (rec[-1][0] - rec[0][0]) / 1000)
    # Episoden grober Bilder (Wanduhr)
    eps, t0 = [], None
    for r, c in zip(rec, coarse):
        if c and t0 is None: t0 = r[0]
        if not c and t0 is not None: eps.append((r[0] - t0) / 1000); t0 = None
    if t0 is not None: eps.append((rec[-1][0] - t0) / 1000)
    phases = {}
    for r in rec: phases[r[6]] = phases.get(r[6], 0) + 1
    return {'n': n, 'secs': round(dur, 1), 'coarse': round(sum(coarse) / max(1, n), 4), 'still': round(still / max(1, n - 1), 4),
            'jz95': round(float(q(jz, 0.95)), 3), 'jzmax': round(float(max(jz or [0])), 3), 'jp95': round(float(q(pj, 0.95)), 3), 'jpmax': round(float(max(pj or [0])), 3),
            'hard': hard, 'flips': len(flips), 'flips_min': round(len(flips) / dur * 60, 2), 'minGap': round(float(min(gaps)), 1) if gaps else None,
            'sharp_max': round(max(eps or [0]), 2), 'sharp_mean': round(sum(eps) / len(eps), 2) if eps else 0, 'episodes': len(eps),
            'lz0': round(float(lz[0]), 2) if len(lz) else None, 'lz1': round(float(lz[-1]), 2) if len(lz) else None, 'cruise': round(float(cruise), 3), 'phases': phases,
            # 7.3.0: Bildrate und Anteil der Flugbilder, in denen der Lavalampen-Wächter nicht im Reiseflug ist (bremsen/schweben/heraus)
            'fps': round(n / dur, 1), 'brake': round(sum(v for k, v in phases.items() if k and k != 'cruise') / max(1, n), 3)}


def main():
    out = {'tag': TAG, 'base': e2e_lib.BASE, 'secs': SECS, 'query': EXTRA, 'speed': SPEED, 'runs': []}
    with sync_playwright() as p:
        for name in RUNS:
            sp = SPEC[name]
            a = App(p, query='nosw&noanim' + ('&' + EXTRA if EXTRA else '')).open(sp.get('hash', ''))
            pg = a.page
            if sp['kind'] == 'bulb':
                pg.evaluate(f"() => {{ const A = window.__fraktal; A.setMode({sp['world']}); }}"); time.sleep(3)
                pg.evaluate("(s) => { const A = window.__fraktal; A.S.flySpeed = s; A.startFly(); }", SPEED)
            elif sp['kind'] == 'tour':
                try: a.wait_done(60)
                except Exception: pass
                if sp.get('place'): pg.evaluate("(p) => window.__fraktal.startTour(p)", sp['place'])
                else: pg.evaluate("(k) => { const A = window.__fraktal; const p = A.SIGHTS[0].find(s => s.k === k); A.startTour(p); }", sp['sight'])
            else:
                try: a.wait_done(60)
                except Exception: pass
                pg.evaluate("(s) => { const A = window.__fraktal; A.S.flySpeed = s; A.startFly(undefined, { d3: false }); }", SPEED)
            d = pg.evaluate(REC, int(SECS * 1000))
            r = analyse(d, sp['kind'])
            r['name'] = name; r['plan'] = pg.evaluate("() => window.__fraktal.status().plan")
            r['errors'] = a.errors[:3]
            out['runs'].append(r)
            print(f"{name:9s} " + json.dumps({k: r[k] for k in ('coarse', 'fps', 'brake', 'still', 'jz95', 'jzmax', 'jp95', 'jpmax', 'hard', 'flips_min', 'minGap', 'sharp_max', 'sharp_mean', 'lz0', 'lz1', 'plan', 'phases', 'errors')}, ensure_ascii=False), flush=True)
            if ARGS.get('dump'): json.dump(d, open(f'/tmp/fk_lava_{TAG}_{name}_{len(out["runs"])}.json', 'w'))
            a.close()
    fn = os.path.join(os.path.dirname(__file__), f'results_lava_{TAG}.json')
    json.dump(out, open(fn, 'w'), indent=1, ensure_ascii=False)
    print('->', fn)


if __name__ == '__main__':
    main()
