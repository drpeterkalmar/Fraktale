#!/usr/bin/env python3
"""7.1.9 – Durchflug, Tauchen, Gleiten: Dauerflug je Welt mit Prüfwerten (Peter 10.10./14.10.2026).
Je Welt ✈-Autopilot (Standard-Flugart der Welt oder --mode=durch/tauch), Tempo 0,5, mit ?flugstat (Prüfwerte im Flug):
  * Durchdringungen: die Strecke von Takt zu Takt schneidet die Oberfläche (Strahl entlang des Schritts) – Soll 0
  * NaN in der Kamera – Soll 0
  * Steckenbleiben: Durchflug = 2 s am Stück unter 15 % des Solltempos; Tauchen = 2 s lang kaum Bewegung – Soll 0 Fenster
  * Gleiten: Zahl der Gleitphasen, Zeit im Gleiten, Höhe/Gleithöhe je Phase ohne die erste und letzte halbe Sekunde: Median,
    p10–p90 (Soll: innerhalb ±30 % des Medians – „kein Höhen-Pumpen > ±30 %“), Min/Max
  * Takt nebenbei: angezeigte Bilder/s und Bilder > 50 ms
Aufruf: FK_HEADED=1 python3 tests/measure_durchflug.py [--worlds=9] [--secs=180] [--mode=durch] [--tag=v719] [--query=…]
Ergebnis: tests/results_durchflug_<tag>.json (je Welt ergänzt)
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_bulb import arg

NAMES = {6: 'Mandelbulb', 8: 'Mandelbox', 9: 'Menger', 16: 'Quaternionen-Julia', 17: 'Kaleidoskop-IFS', 18: 'Apollonian'}
REC = """(ms) => new Promise(res => { const A = window.__fraktal, out = []; const t0 = performance.now();
  const f = (t) => { const i = A.BULB.info(); out.push([t, (i.nMot || 0) + (i.nInt || 0)]); if (t - t0 < ms) requestAnimationFrame(f); else res(out); };
  requestAnimationFrame(f); })"""


def pct(xs, p):
    if not xs: return None
    s = sorted(xs); return s[min(len(s) - 1, int(len(s) * p))]


def main():
    tag = arg('tag', 'cur'); secs = float(arg('secs', 180)); mode = arg('mode', None); extra = str(arg('query', ''))
    worlds = [int(x) for x in str(arg('worlds', '6,8,9,16,17,18')).split(',')]
    fn = os.path.join(os.path.dirname(__file__), f'results_durchflug_{tag}.json')
    out = json.load(open(fn)) if os.path.exists(fn) else {'tag': tag, 'runs': {}}
    with sync_playwright() as p:
        a = App(p, query='nosw&noanim&flugstat' + (('&' + extra) if extra else ''), extra_ctx={'device_scale_factor': 2.6}).open(); pg = a.page
        for f in worlds:
            pg.evaluate(f"() => {{ const A = window.__fraktal; A.stopFly(); A.setMode({f}); A.S.chrome = false; }}"); time.sleep(3)
            if mode: pg.evaluate(f"() => window.__fraktal.BULB.setFlyMode('{mode}')")
            pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }")
            t0 = time.time(); frames = []; zs = []
            while time.time() - t0 < secs:
                rec = pg.evaluate(REC, 10000)
                shown = [r for i, r in enumerate(rec) if i > 0 and r[1] != rec[i - 1][1]]
                frames += [shown[i][0] - shown[i - 1][0] for i in range(1, len(shown))]
                zs.append(pg.evaluate("() => window.__fraktal.BULB.info().zoom"))
            st = pg.evaluate("() => { const s = window.__fraktal.BULB.flyStat(); return Object.assign({}, s, { gr: undefined, grs: s.gr || [] }); }")
            on = pg.evaluate("() => window.__fraktal.FLY.on")
            pg.evaluate("() => window.__fraktal.stopFly()")
            gr = st.pop('grs')
            r = {'mode': st.get('mode'), 'secs': round(time.time() - t0), 'flug_an': on, 'pen': st.get('pen'), 'nan': st.get('nan'),
                 'stuck': st.get('stuck', 0) if st.get('mode') == 'tauch' else int(st.get('stuckMax', 0) >= 2), 'stuckMax_s': round(st.get('stuckMax', 0), 2),
                 'glides': st.get('glides'), 'glide_s': round(st.get('gt', 0), 1),
                 'glide_p10': pct(gr, 0.1), 'glide_p90': pct(gr, 0.9), 'glide_min': round(st.get('gmin', 0), 2) if st.get('glides') else None,
                 'glide_max': round(st.get('gmax', 0), 2) if st.get('glides') else None, 'dead': st.get('dead'), 'void': st.get('voids'),
                 'noZoom': st.get('noZoom'), 'penLog': st.get('penLog'), 'zoom_max': max(zs), 'zoom_end': zs[-1],
                 'fps': round(1000 * len(frames) / max(1, sum(frames)), 1), 'gt50': sum(1 for x in frames if x > 50)}
            # Pumpen = Streuung der Gleithöhe um ihren eigenen Median (p10 ≥ 0,7 × Median, p90 ≤ 1,3 × Median); der Median selbst zeigt,
            # wie nah die Regelung an der Soll-Gleithöhe fliegt
            r['glide_med'] = pct(gr, 0.5)
            r['pump_ok'] = r['glide_p10'] is None or (r['glide_p10'] >= 0.7 * r['glide_med'] and r['glide_p90'] <= 1.3 * r['glide_med'])
            r['ok'] = r['pen'] == 0 and r['nan'] == 0 and r['stuck'] == 0 and r['pump_ok'] and on
            name = NAMES.get(f, str(f)) + (f' ({mode})' if mode else '')
            out['runs'][name] = r
            print(f'{name:30s} ' + json.dumps(r), flush=True)
        out.setdefault('errors', []).extend(a.errors[:3])
        a.close()
    with open(fn, 'w') as fo: json.dump(out, fo, indent=1, ensure_ascii=False)
    print('->', fn)


if __name__ == '__main__':
    main()
