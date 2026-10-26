#!/usr/bin/env python3
"""7.2.1 Lavalampen-Flug (Peter 21.10.2026: „wenn der flugmodus droht, unscharf oder pixelig zu werden: flug langsam anhalten
und langsam rückwärts fliegen … sollte entspannt aussehen wie sich eine lavalampe anfühlt“; Rückwärts = herauszoomen).
Messgrößen wie tests/measure_lava.py (dieselbe Auswertung):
A  GPU-2D Seepferdchen 30 s: ≤ 2 % grobe Bilder, 0 Bilder ohne Kamerabewegung, Zoom-Ruck max < 1 Zehnerpotenz/s³,
   kein harter Richtungswechsel, Zoom ≥ 10⁶
B  CPU-Exot Phoenix 3·10⁴ 40 s: Rückweg kommt (Phasen bremsen/schweben/heraus), Pendel ≥ 8 s, nie weiter hinaus als die
   Startansicht, Kamera steht nie, weniger grob als 7.1.14 (dort 87–94 %: hier ≤ 50 %)
C  Mandelbulb 50 s: weicht von der Genauigkeitsgrenze zurück (Phase heraus), 0 grobe/stehende Bilder, Zoom-Ruck p95 < 15
D  Tour zum tiefen Mandelbrot-Ort: ≤ 10 % grobe Bilder (7.1.14: 41 %), kommt an
E  ?lava=0 = Verhalten 7.2.0 (Regler aus, Tempo-Bremse wie bisher); Regler ?lavarueck/?lavaseit/?lavatau; Schalter im Menü
   (gespeichert), Schalter aus = Regler aus
F  Zufallsflug beim Start fliegt mit Lavalampe
Aufruf: FK_HEADED=1 python3 tests/test_v721.py [--only=A,B]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
import measure_lava as M

ARGS = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
ONLY = set(ARGS.get('only', 'A,B,C,D,E,F').split(','))
LOG = "() => { const F = window.__fraktal.FLY; return { log: (F.lava && F.lava.log || []).slice(), on: !!(F.lava && F.lava.on) }; }"


def fly(p, hash_, secs, kind='2d', world=None, query='nosw&noanim', tour=None):
    a = App(p, query=query).open(hash_ or '')
    pg = a.page
    if world is not None:
        pg.evaluate(f"() => window.__fraktal.setMode({world})"); time.sleep(3)
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.3; A.startFly(); }")
    elif tour:
        a.wait_done(60)
        pg.evaluate("(k) => { const A = window.__fraktal; A.startTour(A.SIGHTS[0].find(s => s.k === k)); }", tour)
    else:
        a.wait_done(90)
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false }); }")
    d = pg.evaluate(M.REC, int(secs * 1000))
    r = M.analyse(d, kind)
    r['log'] = pg.evaluate(LOG)
    r['zoom'] = pg.evaluate("() => window.__fraktal.S.cam.zoom")
    r['errors'] = a.errors[:3]
    a.close()
    return r


def main():
    ok, chk, res = True, [], {}

    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)

    def phases(r): return [x[1] for x in r['log']['log']]

    with sync_playwright() as p:
        if 'A' in ONLY:
            r = res['A'] = fly(p, 'm=0&x=-0.7453&y=0.1127&z=180', 30)
            need(r['coarse'] <= 0.02 and r['still'] == 0, f"A Seepferdchen: grob {r['coarse']:.1%}, ohne Bewegung {r['still']:.1%}")
            need(r['jzmax'] < 1 and r['hard'] == 0, f"A Ruck: Zoom p95 {r['jz95']} max {r['jzmax']} Zehnerpotenzen/s³, Seite p95 {r['jp95']} max {r['jpmax']}, harte Wechsel {r['hard']}")
            # (wie tief er kommt, hängt von der Rechenlast ab – gemessen 6·10⁷ … 10¹⁰; geprüft wird, dass er zügig taucht)
            need(r['zoom'] >= 1e6 and not r['errors'], f"A Zoom nach 30 s {r['zoom']:.2e} (≥ 10⁶), Fehler {r['errors']}")
        if 'B' in ONLY:
            # (7.3.0: Phoenix rechnet dort in df64 auf der GPU – der Fall prüft die Lavalampe auf einer Prozessor-Welt, darum ?df64=0)
            r = res['B'] = fly(p, 'm=11&x=0.690104&y=0.546875&z=30000', 40, query='nosw&noanim&df64=0')
            ph = phases(r)
            need('rev' in ph and 'hover' in ph, f"B Phoenix 3·10⁴: bremsen → schweben → heraus ({ph[:8]})")
            need(r['still'] == 0 and (r['minGap'] is None or r['minGap'] >= 8), f"B Kamera steht nie ({r['still']:.1%}), kürzestes Pendel {r['minGap']} s (≥ 8)")
            need(min([x[2] for x in r['log']['log']] + [r['zoom']]) >= 0.3, f"B nie weiter hinaus als die Startansicht (Zoom am Ende {r['zoom']:.3g})")
            need(r['coarse'] <= 0.5 and not r['errors'], f"B grob {r['coarse']:.1%} (7.1.14: 87–94 %), Fehler {r['errors']}")
        if 'C' in ONLY:
            r = res['C'] = fly(p, '', 50, kind='bulb', world=6)
            ph = phases(r)
            need('rev' in ph, f"C Mandelbulb weicht von der Genauigkeitsgrenze zurück ({ph[:8]})")
            need(r['coarse'] == 0 and r['still'] <= 0.001 and r['jz95'] < 15 and not r['errors'], f"C grob {r['coarse']:.1%}, steht {r['still']:.2%}, Zoom-Ruck p95 {r['jz95']} (7.1.14: 31), Fehler {r['errors']}")
        if 'D' in ONLY:
            r = res['D'] = fly(p, 'm=0&x=-0.5&y=0&z=1', 40, kind='tour', tour='mb_deep')
            need(r['coarse'] <= 0.10 and r['zoom'] > 2e9 and not r['errors'], f"D Tour mb_deep: grob {r['coarse']:.1%} (7.1.14: 41 %), Zoom {r['zoom']:.2e}")
        if 'E' in ONLY:
            r = res['E'] = fly(p, 'm=0&x=-0.7453&y=0.1127&z=180', 8, query='nosw&noanim&lava=0')
            need(not r['log']['on'] and not r['log']['log'], f"E ?lava=0: Regler aus ({r['log']['on']})")
            a = App(p, query='nosw&noanim&lavarueck=0.5&lavaseit=0.02&lavatau=3').open(); pg = a.page
            cfg = pg.evaluate("() => window.__fraktal.FLY.lavaCfg")
            need(cfg == {'rueck': 0.5, 'seit': 0.02, 'tau': 3}, f"E Regler aus der Adresse: {cfg}")
            a.close()
            a = App(p, query='nosw&noanim').open(); pg = a.page
            a.wait_done(60)
            pg.evaluate("() => { const t = document.getElementById('t-lava'); t.checked = false; t.dispatchEvent(new Event('change')); }")
            sv = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings')).lava")
            pg.evaluate("() => { const A = window.__fraktal; A.startFly(undefined, { d3: false }); }"); time.sleep(3)
            on = pg.evaluate("() => window.__fraktal.FLY.lava.on")
            need(sv is False and not on, f"E Menüschalter „Lavalampen-Flug“ aus: gespeichert {sv}, Regler {on}")
            a.close()
        if 'F' in ONLY:
            a = App(p, query='nosw&seed=7').open(); pg = a.page
            for _ in range(60):
                if pg.evaluate("() => !!window.__fraktal.START.motion"): break
                time.sleep(0.2)
            time.sleep(5)
            st = pg.evaluate("() => ({ m: window.__fraktal.START.motion, lava: window.__fraktal.FLY.lava && window.__fraktal.FLY.lava.on })")
            need(st['m'] == '2d-flug' and st['lava'], f"F Zufallsflug mit Lavalampe ({st})")
            a.close()
    json.dump({k: {kk: vv for kk, vv in v.items() if kk != 'log'} | {'phasen': [x[1] for x in v['log']['log']][:30]} for k, v in res.items()},
              open(os.path.join(os.path.dirname(__file__), 'results_v721.json'), 'w'), indent=1, ensure_ascii=False)
    print('GESAMT', 'OK' if ok else 'FEHLER')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
