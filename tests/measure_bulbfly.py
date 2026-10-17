#!/usr/bin/env python3
"""7.1.7 – Takt des ✈-Flugs in den 3D-Welten (Mandelbulb & Co.) im Mittelklasse-Profil wie 6.7/7.0 (Pixel 7, DPR 2,6,
CPU ×4 + 4 Kerne, echte GPU, sichtbares Fenster). Abnahme-Kriterien (Peter/Hermes 10.10.2026):
  * Bildzeit-Standardabweichung im Flug ≤ 3 ms, p95 ≤ 1,15 × Median, 0 Bilder > 50 ms
  * Wechsel der Auflösungsskala ≤ 1 pro Sekunde
  * Kamera-Schritt je gezeigtem Bild gleichmäßig: Variationskoeffizient ≤ 10 % (Schritt = Weg der Kamera je Bild relativ
    zum Abstand zum Flugziel; bei konstantem Tempo und gleichmäßigem Takt konstant)
Gemessen wird je rAF: Zeit, Zahl der Bewegungsbilder (BULB.info().nMot), Skala, Abstand zum Ziel. „Gezeigte Bilder“ =
rAF-Takte mit neuem Bewegungsbild (rastet der Flug auf 30 Bilder/s ein, ist das jedes zweite).
Die Anfahrt (2 s, 7.1.6) wird ausgelassen: Messung ab 2,5 s; bei --secs ≥ 15 zusätzlich „ab6s“ (eingeschwungen: Takt-Stufe
gefunden). Ruhe der Kamerafahrt: look_* (Drehrate °/s), ljerk_* (Änderung der Drehrate je Takt), pjerk_* (Positions-Ruck).
Aufruf: FK_HEADED=1 python3 tests/measure_bulbfly.py [--land] [--tag=v716] [--worlds=6,8,9,16,17] [--slow=1,4]
       [--speed=0.5] [--secs=12] [--query=bulbpace=0]
Ergebnis: tests/results_bulbfly_<tag>_<hoch|quer>.json (+ Tabelle auf der Konsole)
"""
import sys, os, json, time, math, statistics as stt
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_bulb import arg

NAMES = {6: 'Mandelbulb', 8: 'Mandelbox', 9: 'Menger', 16: 'Quaternionen-Julia', 17: 'Kaleidoskop-IFS', 18: 'Apollonian'}
REC = """(ms) => new Promise(res => { const A = window.__fraktal, out = []; const t0 = performance.now();
  const f = (t) => { const i = A.BULB.info(); out.push([t, i.nMot, +(i.scale || 0).toFixed(4), i.flyD, A.FLY.sp, A.BULB.B.pos.slice(), i.N || 1, i.lvl || 0, A.BULB.B.yaw, A.BULB.B.pitch, A.BULB.flyInfo().simT]);
    if (t - t0 < ms) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); })"""


def analyse(rec, skip=2500):
    t0 = rec[0][0]
    rec = [r for r in rec if r[0] - t0 >= skip]
    shown = [r for i, r in enumerate(rec) if i > 0 and r[1] != rec[i - 1][1]]
    dts = [shown[i][0] - shown[i - 1][0] for i in range(1, len(shown))]
    if len(dts) < 10: return {'n': len(dts)}
    med = stt.median(dts); sd = stt.pstdev(dts)
    s = sorted(dts); p95 = s[int(len(s) * 0.95) - 1]
    dur = (rec[-1][0] - rec[0][0]) / 1000
    sc = [r[2] for r in shown]
    changes = sum(1 for i in range(1, len(sc)) if abs(sc[i] - sc[i - 1]) > 1e-4)
    # Kamera-Schritt je gezeigtem Bild: Weg der Kamera relativ zum Abstand zum Flugziel (beim Gleiten an der Genauigkeits-
    # grenze bleibt der Abstand gleich, die Kamera zieht seitlich – darum der Weg, nicht nur die Abstandsänderung)
    steps = [math.dist(shown[i][5], shown[i - 1][5]) / shown[i - 1][3] for i in range(1, len(shown)) if shown[i - 1][3]]
    steps = [x for x in steps if x > 0] or [0]
    # lokal: jeder Schritt gegen das gleitende Mittel über 11 Bilder (gewollte langsame Tempoänderungen – Gleiten an der
    # Genauigkeitsgrenze, Kurswechsel – sind kein Ruckeln); Variationskoeffizient = Streuung dieses Verhältnisses
    rel = []
    for i in range(len(steps)):
        w = steps[max(0, i - 5):i + 6]
        rel.append(steps[i] / max(1e-12, sum(w) / len(w)))
    cv = stt.pstdev(rel) if len(rel) > 2 else 0
    # Muster der Abweichungen: Autokorrelation (Abstand 1) < 0 = Zickzack von Bild zu Bild (Ruckeln), > 0 = weiche Tempo-
    # änderung über mehrere Bilder (gewollt: Gleiten, Kurswechsel)
    # Zickzack-Anteil: jeder Schritt gegen das Mittel seiner beiden Nachbarn (weiche Tempoänderungen fallen heraus)
    zz = [(steps[i] - (steps[i - 1] + steps[i + 1]) / 2) / max(1e-12, (steps[i - 1] + steps[i] + steps[i + 1]) / 3) for i in range(1, len(steps) - 1)]
    czz = stt.pstdev(zz) if len(zz) > 2 else 0
    dv = [x - 1 for x in rel]
    ac1 = (sum(dv[i] * dv[i - 1] for i in range(1, len(dv))) / max(1e-12, sum(x * x for x in dv))) if len(dv) > 3 else 0
    # 7.1.7 Ruhe der Kamerafahrt (je rAF-Takt, Bahn statt Takt): Drehrate des Blicks (°/s), deren Änderung je Takt („Blick-
    # Ruck“, °/s je Bild) und der Positions-Ruck (3. Differenz des Wegs je Takt, relativ zum Abstand zum Ziel)
    def fw(r): cp = math.cos(r[9]); return (cp * math.sin(r[8]), math.sin(r[9]), cp * math.cos(r[8]))
    om = []
    for i in range(1, len(rec)):
        a, b = fw(rec[i - 1]), fw(rec[i]); dt = rec[i][10] - rec[i - 1][10]      # Flugzeit der Kamera (ohne Takt-Zittern)
        if dt <= 0: continue
        c = max(-1, min(1, sum(x * y for x, y in zip(a, b))))
        om.append(math.degrees(math.acos(c)) / max(1e-3, dt))
    lj = [abs(om[i] - om[i - 1]) for i in range(1, len(om))]
    # (Geschwindigkeit je Flugzeit statt je Takt: ein ausgefallener Takt mit doppeltem, zeitrichtigem Schritt ist kein Ruck;
    # Maß = 2. Differenz der Geschwindigkeit × Takt², d. h. für gleichmäßige Takte die 3. Differenz des Wegs)
    vel = []
    for i in range(1, len(rec)):
        h = rec[i][10] - rec[i - 1][10]
        if h > 0: vel.append(([(rec[i][5][k] - rec[i - 1][5][k]) / h for k in range(3)], rec[i][3]))
    pj = []
    for i in range(2, len(vel)):
        if not vel[i][1]: continue
        d2 = [vel[i][0][k] - 2 * vel[i - 1][0][k] + vel[i - 2][0][k] for k in range(3)]
        pj.append(math.hypot(*d2) * (1 / 60) ** 2 / vel[i][1])
    q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(len(xs) * p))] if xs else 0
    return {'fps': round(1000 * len(dts) / sum(dts), 1), 'median_ms': round(med, 1), 'sd_ms': round(sd, 2), 'p95_ms': round(p95, 1),
            'p95_rel': round(p95 / med, 2), 'gt50': sum(1 for x in dts if x > 50), 'n': len(dts), 'scale_changes_s': round(changes / dur, 2),
            'scale_min': min(sc), 'scale_max': max(sc), 'cam_cv': round(cv, 3), 'cam_ac1': round(ac1, 2), 'cam_zz': round(czz, 3), 'look_max': round(max(om), 1), 'look_p95': round(q(om, 0.95), 1),
            'ljerk_p99': round(q(lj, 0.99), 2), 'ljerk_max': round(max(lj), 2), 'pjerk_p99': round(q(pj, 0.99) * 1e3, 3), 'pjerk_max': round(max(pj) * 1e3, 3), 'N': sorted(set(r[6] for r in shown)), 'lvl': sorted(set(r[7] for r in shown)),
            'ok': sd <= 3 and p95 <= 1.15 * med and not any(x > 50 for x in dts) and changes / dur <= 1 and cv <= 0.10}


def main():
    land = bool(arg('land', False)); tag = arg('tag', 'cur'); thr = float(arg('throttle', 4)); dpr = float(arg('dpr', 2.6))
    worlds = [int(x) for x in str(arg('worlds', '6,8,9,16,17')).split(',')]
    slows = [int(x) for x in str(arg('slow', '1')).split(',')]
    extra = str(arg('query', '')); spd = float(arg('speed', 0.5)); dur = int(float(arg('secs', 12)) * 1000)
    ori = 'quer' if land else 'hoch'
    out = {'tag': tag, 'speed': spd, 'query': extra, 'ori': ori, 'throttle': thr, 'dpr': dpr, 'headed': os.environ.get('FK_HEADED') == '1', 'runs': {}}
    with sync_playwright() as p:
        for sl in slows:
            a = App(p, landscape=land, query='nosw&noanim&prof' + ('&bulbslow=%d' % sl if sl > 1 else '') + (('&' + extra) if extra else ''), extra_ctx={'device_scale_factor': dpr}).open(); pg = a.page
            if thr > 1:
                cdp = a.ctx.new_cdp_session(pg)
                cdp.send('Emulation.setCPUThrottlingRate', {'rate': thr})
                cdp.send('Emulation.setHardwareConcurrencyOverride', {'hardwareConcurrency': 4})
            for f in worlds:
                if sl > 1 and f != 6: continue
                pg.evaluate(f"() => {{ const A = window.__fraktal; A.stopFly(); A.setMode({f}); A.S.chrome = false; }}"); time.sleep(3)
                pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = %s; A.startFly(); }" % spd)
                pg.evaluate("() => { const P = window.__fraktal.prof(); if (P) P.length = 0; }")
                rec = pg.evaluate(REC, dur)
                prof = pg.evaluate("() => (window.__fraktal.prof() || []).slice()")
                r_log = pg.evaluate("() => window.__fraktal.BULB.paceLog ? window.__fraktal.BULB.paceLog().slice() : []")
                pg.evaluate("() => window.__fraktal.stopFly()")
                r = analyse(rec)
                if arg('dump', False): json.dump(rec, open(f'/tmp/fk_rec_{f}.json', 'w'))
                if dur >= 15000: r['ab6s'] = {k: v for k, v in analyse(rec, 6000).items() if k in ('fps', 'median_ms', 'sd_ms', 'p95_rel', 'gt50', 'scale_changes_s', 'cam_cv', 'cam_zz', 'N', 'lvl', 'ok')}
                name = NAMES.get(f, str(f)) + ('' if sl == 1 else ' (GPU ×%d)' % sl)
                r['pacelog'] = r_log[-12:]
                r['js_gt25'] = len(prof); r['js_max'] = max([x['pre'] + x['sched'] + x['present'] for x in prof] or [0])
                out['runs'][name] = r
                print(f'{name:28s} ' + json.dumps(r), flush=True)
            out.setdefault('errors', []).extend(a.errors[:3])
            a.close()
    fn = os.path.join(os.path.dirname(__file__), f'results_bulbfly_{tag}_{ori}.json')
    with open(fn, 'w') as fo: json.dump(out, fo, indent=1, ensure_ascii=False)
    print('->', fn)


if __name__ == '__main__':
    main()
