#!/usr/bin/env python3
"""7.1.8 – „Im Flug immer scharf“ (Peter 14.10.2026), Prüfung im Browser (Pixel 7, GPU).

  A  Flug in voller Auflösung: Auflösungsskala im Flug 1,0, scharfer Weg aktiv, angezeigte Bilder = echte + Zwischenbilder
  B  Anhalten ohne Sprung: das gezeigte Flugbild beim Pausieren liegt deckungsgleich auf dem späteren Ruhebild (Versatz 0)
     und ist fast so scharf (Kantenschärfe je Bild ≥ 0,75; Abnahme im Mittel: tests/measure_scharf.py)
  C  Start aus dem Ruhebild: das erste Flugbild nach dem Start ist so scharf wie das Ruhebild (Kantenschärfe ≥ 0,9, SSIM ≥ 0,85
     bei bester Verschiebung – das Ruhebild ist zusätzlich kantengeglättet)
  D  Schärfe vor Tempo: feste Sprosse mit 4 Takten je echtem Bild (?bulblad) -> Tempo-Faktor weich auf 0,5
  E  ?scharf=0 = Flug wie 7.1.7 (Skala < 1); ?taau=0 = jedes echte Bild voll gerechnet (Raster 1)
  F  Speicher der 3D-Ziele ≤ 150 MB im Pixel-7-Profil
Aufruf: FK_HEADED=1 python3 tests/test_v718.py [--only=A,B,…]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, io, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
from measure_scharf import compare

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
fails, res = [], {}
OUT = os.path.join(os.path.dirname(__file__), 'results_v718.json')
P7 = {'device_scale_factor': 2.6}


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    if not cond:
        fails.append(msg)


def shot(pg):
    return Image.open(io.BytesIO(pg.screenshot(type='png'))).convert('RGB')


def bulb(p, query='nosw&noanim', world=6):
    a = App(p, query=query, extra_ctx=P7).open(); pg = a.page
    pg.evaluate(f"() => {{ const A = window.__fraktal; A.setMode({world}); A.S.chrome = false; }}"); time.sleep(4)
    return a, pg


def wait_still(pg, sec=25):
    t0 = time.time()
    while time.time() - t0 < sec:
        s = pg.evaluate("() => { const i = window.__fraktal.BULB.info(); return [i.still, i.K]; }")
        if s[0] >= s[1]: return True
        time.sleep(0.3)
    return False


def case_A(p):
    print('A  Flug in voller Auflösung')
    a, pg = bulb(p)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(2.5)
    i0 = pg.evaluate("() => window.__fraktal.BULB.info()")
    sc = []
    for _ in range(12):
        time.sleep(0.4); sc.append(pg.evaluate("() => window.__fraktal.BULB.info().scale"))
    i1 = pg.evaluate("() => window.__fraktal.BULB.info()"); tz = pg.evaluate("() => window.__fraktal.BULB.taau()")
    pg.evaluate("() => window.__fraktal.stopFly()")
    res['A'] = {'scale': sorted(set(sc)), 'real': i1['nMot'] - i0['nMot'], 'zwischen': i1['nInt'] - i0['nInt'], 'taau': tz}
    print('    ', res['A'])
    check(tz['on'] and tz['ok'] and min(sc) >= 0.95, f'scharfer Weg aktiv, Skala im Flug {sorted(set(sc))}')
    check(i1['nMot'] - i0['nMot'] > 20, f'echte Bilder {i1["nMot"] - i0["nMot"]}, Zwischenbilder {i1["nInt"] - i0["nInt"]} in 4,8 s')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_B(p):
    print('B  Anhalten ohne Sprung')
    a, pg = bulb(p)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }")
    out = []
    for i in range(2):
        time.sleep(5)
        pg.evaluate("() => { const A = window.__fraktal; A.BULB.hold(true); A.pauseFly(true); }")
        fly = shot(pg); pg.evaluate("() => window.__fraktal.BULB.hold(false)")
        wait_still(pg); time.sleep(0.4)
        m = compare(fly, shot(pg)); out.append(m)
        pg.evaluate("() => window.__fraktal.pauseFly(false)")
    pg.evaluate("() => window.__fraktal.stopFly()")
    res['B'] = out
    for m in out:
        check(m['shift'] == [0, 0] and m['kante'] >= 0.75, f'Flugbild beim Anhalten deckungsgleich (Versatz {m["shift"]}), Kantenschärfe {m["kante"]}, SSIM {m["ssim"]}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_C(p):
    print('C  Start aus dem Ruhebild')
    a, pg = bulb(p)
    wait_still(pg); time.sleep(0.4)
    ref = shot(pg)
    # (zwei Takte nach dem Start anhalten: die Kamera hat sich in der sanften Anfahrt noch kaum bewegt)
    pg.evaluate("() => new Promise(r => { const A = window.__fraktal; A.S.flySpeed = 0.3; A.startFly(); requestAnimationFrame(() => requestAnimationFrame(() => { A.BULB.hold(true); A.pauseFly(true); r(); })); })")
    fly = shot(pg); pg.evaluate("() => { const A = window.__fraktal; A.BULB.hold(false); A.stopFly(); }")
    m = compare(fly, ref); res['C'] = m
    check(m['kante'] >= 0.9 and m['ssim_shift'] >= 0.85, f'erstes Flugbild wie das Ruhebild: Kantenschärfe {m["kante"]}, SSIM {m["ssim_shift"]} (bei Versatz {m["shift"]} – die Kamera dreht schon im ersten Takt)')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_D(p):
    print('D  Schärfe vor Tempo')
    a, pg = bulb(p, 'nosw&noanim&bulblad=6')
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(5)
    st = pg.evaluate("() => { const B = window.__fraktal.BULB; return [B.flyInfo().spK, B.info().N, B.info().s]; }")
    pg.evaluate("() => window.__fraktal.stopFly()")
    res['D'] = st
    check(abs(st[0] - 2 / st[1]) < 0.03 and st[1] >= 3, f'Takt {st[1]} je echtem Bild -> Tempo-Faktor {st[0]:.3f} (soll {2 / st[1]:.3f})')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_E(p):
    print('E  ?scharf=0 und ?taau=0')
    for q, want in (('scharf=0', 'alt'), ('taau=0', 'raster1')):
        a, pg = bulb(p, 'nosw&noanim&' + q)
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(5)
        st = pg.evaluate("() => { const B = window.__fraktal.BULB; return [B.taau().on, B.info().scale, B.info().s]; }")
        pg.evaluate("() => window.__fraktal.stopFly()")
        res['E_' + q] = st
        if want == 'alt': check(not st[0] and st[1] < 1 and st[2] is None, f'?scharf=0: Weg wie 7.1.7 (Skala {st[1]:.2f})')
        else: check(st[0] and st[1] == 1 and st[2] == 1, f'?taau=0: volle Auflösung, Raster {st[2]}')
        check(not a.errors, f'keine Fehler {a.errors[:2]}')
        a.close()


def case_F(p):
    print('F  Speicher')
    a, pg = bulb(p)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(4)
    pg.evaluate("() => window.__fraktal.stopFly()"); time.sleep(3)
    mb = pg.evaluate("() => window.__fraktal.BULB.mem()") / 1e6
    cv = pg.evaluate("() => [window.__fraktal.R.canvas.width, window.__fraktal.R.canvas.height]")
    res['F'] = {'MB': round(mb, 1), 'canvas': cv}
    check(mb <= 150, f'3D-Ziele {mb:.0f} MB bei {cv[0]}×{cv[1]} (≤ 150)')
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
