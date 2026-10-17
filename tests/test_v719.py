#!/usr/bin/env python3
"""7.1.9 – Durchflug, Tauchen, Gleiten, sanfte Fluglage (Peter 10.10./14.10.2026), Prüfung im Browser (GPU).

  A  Flug-Art: Standard je Welt (Menger/Mandelbox/KIFS/Apollonian ✈ Durchflug, Mandelbulb/Q-Julia 🔍 Tauchen); Umschalter in der
     Flug-Leiste wechselt im Flug weich (Flug läuft weiter, Symbol wechselt); Wahl je Welt gespeichert (nach Neuladen erhalten)
  B  Durchflug Menger 25 s: 0 Durchdringungen, kein NaN, nicht stecken geblieben, die Kamera legt Weg zurück; Fluglage:
     Rollen ≤ 15°, Schwanken (Gieren) ≤ 4°
  C  ?schwanken=0: kein Schwanken (nur Kurvenneigung); ?schwanken=2: Gieren bis 8°
  D  Rückwärts im Durchflug: auf dem aufgezeichneten Weg zurück bis zum Anfang („Am Anfang des Wegs“), Abstand zum Startpunkt klein
  E  Lenken im Durchflug: Ziehen dreht den Kurs, der Flug läuft weiter (endliche Werte)
  F  ?gleiten=0: keine Gleitphasen im Tauchflug; nach dem Flug kehrt die Fluglage weich auf 0 zurück
Aufruf: FK_HEADED=1 python3 tests/test_v719.py [--only=A,B,…]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
fails, res = [], {}
OUT = os.path.join(os.path.dirname(__file__), 'results_v719.json')
DEG = 180 / math.pi


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    if not cond:
        fails.append(msg)


def world(p, w, query=''):
    a = App(p, query='nosw&noanim&flugstat' + ('&' + query if query else '')).open(); pg = a.page
    pg.evaluate(f"() => {{ const A = window.__fraktal; A.setMode({w}); }}"); time.sleep(3.5)
    return a, pg


def att(pg, secs, n=40):
    """Fluglage über secs Sekunden abtasten: max |Gieren-Schwanken|, max |Rollen| (Grad)"""
    sy = rl = 0
    for _ in range(n):
        v = pg.evaluate("() => { const B = window.__fraktal.BULB.B; return [B.swY || 0, B.roll || 0]; }")
        sy = max(sy, abs(v[0]) * DEG); rl = max(rl, abs(v[1]) * DEG); time.sleep(secs / n)
    return sy, rl


def case_A(p):
    print('A  Flug-Art je Welt, Umschalter, gespeichert')
    a = App(p, query='nosw&noanim').open(); pg = a.page
    modes = {}
    for w in (6, 8, 9, 16, 17, 18):
        pg.evaluate(f"() => window.__fraktal.setMode({w})"); time.sleep(0.4)
        modes[w] = pg.evaluate("() => window.__fraktal.BULB.flyMode()")
    check(modes == {6: 'tauch', 8: 'durch', 9: 'durch', 16: 'tauch', 17: 'durch', 18: 'durch'}, f'Standard je Welt {modes}')
    pg.evaluate("() => window.__fraktal.setMode(6)"); time.sleep(3)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(2)
    vis = pg.evaluate("() => [!document.getElementById('btn-flymode').hidden, document.getElementById('flymode-icon').textContent]")
    pg.click('#btn-flymode'); time.sleep(1.5)
    st = pg.evaluate("() => { const A = window.__fraktal; return [A.BULB.flyMode(), A.FLY.on, A.BULB.flyStat().mode, document.getElementById('flymode-icon').textContent]; }")
    check(vis == [True, '🔍'] and st == ['durch', True, 'durch', '✈'], f'Umschalter im Flug: vorher {vis}, nachher {st}')
    pg.evaluate("() => window.__fraktal.stopFly()")
    pg.goto('about:blank'); a.open()
    pg.evaluate("() => window.__fraktal.setMode(6)"); time.sleep(0.5)
    m = pg.evaluate("() => window.__fraktal.BULB.flyMode()")
    check(m == 'durch', f'Wahl nach Neuladen erhalten ({m})')
    pg.evaluate("() => { const A = window.__fraktal; A.BULB.setFlyMode('tauch'); A.saveSettings(); }")
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_B(p):
    print('B  Durchflug Menger')
    a, pg = world(p, 9)
    p0 = pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); return A.BULB.B.pos.slice(); }")
    time.sleep(3)
    sy, rl = att(pg, 22)
    st = pg.evaluate("() => { const B = window.__fraktal.BULB; return Object.assign({ pos: B.B.pos.slice(), z: B.info().zoom }, B.flyStat(), { gr: null }); }")
    pg.evaluate("() => window.__fraktal.stopFly()")
    res['B'] = {k: st[k] for k in ('mode', 'pen', 'nan', 'stuckMax', 'glides', 'gt', 'z', 'trail')}
    res['B'].update({'sway_deg': round(sy, 2), 'roll_deg': round(rl, 2)})
    print('    ', res['B'])
    moved = math.dist(p0, st['pos'])
    check(st['mode'] == 'durch' and st['pen'] == 0 and st['nan'] == 0 and st['stuckMax'] < 2 and moved > 0.05, f'0 Durchdringungen ({st["pen"]}), kein NaN, nicht stecken geblieben ({st["stuckMax"]:.2f} s), Weg {moved:.2f}')
    check(rl <= 15.01 and sy <= 4.01 and sy > 0.3, f'Fluglage: Rollen höchstens {rl:.1f}°, Schwanken (Gieren) höchstens {sy:.1f}°')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_C(p):
    print('C  ?schwanken=0 / 2')
    for q, want in (('schwanken=0', 0), ('schwanken=2', 2)):
        a, pg = world(p, 9, q)
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(3)
        sy, rl = att(pg, 14)
        pg.evaluate("() => window.__fraktal.stopFly()")
        res['C_' + q] = [round(sy, 2), round(rl, 2)]
        if want == 0: check(sy < 0.01, f'?schwanken=0: kein Gieren-Schwanken ({sy:.3f}°), Rollen nur aus Kurven ({rl:.1f}°)')
        else: check(4.0 < sy <= 8.01, f'?schwanken=2: Gieren-Schwanken bis {sy:.1f}° (doppelt, ≤ 8°)')
        a.close()


def case_D(p):
    print('D  Rückwärts im Durchflug')
    a, pg = world(p, 9)
    p0 = pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); return A.BULB.B.pos.slice(); }")
    time.sleep(8)
    p1 = pg.evaluate("() => window.__fraktal.BULB.B.pos.slice()")
    pg.evaluate("() => window.__fraktal.reverseFly()")
    t0 = time.time()
    while time.time() - t0 < 30 and not pg.evaluate("() => window.__fraktal.FLY.out"): time.sleep(0.3)
    st = pg.evaluate("() => { const A = window.__fraktal; return [A.FLY.out, A.BULB.B.pos.slice(), document.getElementById('toast').textContent]; }")
    pg.evaluate("() => window.__fraktal.stopFly()")
    d_out, d_back = math.dist(p0, p1), math.dist(p0, st[1])
    res['D'] = {'weg_hin': d_out, 'rest': d_back, 'secs': round(time.time() - t0, 1)}
    check(st[0] and d_back < 0.1 * d_out and 'Anfang' in st[2], f'zurück bis zum Anfang ({time.time() - t0:.1f} s): Abstand zum Start {d_back:.3g} (Hinweg {d_out:.3g}), Hinweis „{st[2]}“')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_E(p):
    print('E  Lenken im Durchflug')
    a, pg = world(p, 8)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(3)
    y0 = pg.evaluate("() => window.__fraktal.BULB.B.yaw")
    for k in range(15):
        pg.evaluate("() => window.__fraktal.BULB.flySteer(12, 0)"); time.sleep(0.03)
    y1 = pg.evaluate("() => window.__fraktal.BULB.B.yaw")
    time.sleep(2)
    st = pg.evaluate("() => { const A = window.__fraktal, B = A.BULB.B; return [A.FLY.on, B.pos.concat([B.yaw, B.pitch]).every(Number.isFinite)]; }")
    pg.evaluate("() => window.__fraktal.stopFly()")
    check(abs(y1 - y0) > 0.2 and st == [True, True], f'Ziehen dreht den Kurs um {abs(y1 - y0) * DEG:.0f}°, Flug läuft weiter, Werte endlich {st}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_F(p):
    print('F  ?gleiten=0, Fluglage nach dem Flug')
    a, pg = world(p, 6, 'gleiten=0')
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(15)
    g = pg.evaluate("() => window.__fraktal.BULB.flyStat().glides")
    check(g == 0, f'?gleiten=0: keine Gleitphasen ({g})')
    pg.evaluate("() => window.__fraktal.stopFly()")
    r0 = pg.evaluate("() => Math.abs(window.__fraktal.BULB.B.roll || 0) + Math.abs(window.__fraktal.BULB.B.swY || 0)")
    time.sleep(2.5)
    r1 = pg.evaluate("() => Math.abs(window.__fraktal.BULB.B.roll || 0) + Math.abs(window.__fraktal.BULB.B.swY || 0)")
    check(r1 * DEG < 0.15, f'Fluglage nach dem Flug zurück (Zeitkonstante 0,6 s) ({r0 * DEG:.2f}° -> {r1 * DEG:.4f}°)')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


if __name__ == "__main__":
  with sync_playwright() as p:
      for k, fn in [('A', case_A), ('B', case_B), ('C', case_C), ('D', case_D), ('E', case_E), ('F', case_F)]:
          if ONLY and k not in ONLY:
              continue
          try:
              fn(p)
          except Exception as e:
              fails.append('%s: %r' % (k, e))
              print('  FAIL Ausnahme', repr(e)[:400])
  json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
  print('ALL PASS' if not fails else 'FAILED: %d' % len(fails))
  sys.exit(1 if fails else 0)
