#!/usr/bin/env python3
"""7.1.7 – ruhiger 3D-Flug (Peter 10.10. „Mandelbulb-Flug ist ziemlich ruckelnd“, 14.10. „Flug ist noch zu unruhig …
Anfangsgeschwindigkeit etwas langsamer“), Prüfung im Browser (Pixel 7, GPU).

  A  Flug-Tempo: Standard 0,3; Migration (Einstellungs-Version 3) setzt einen gespeicherten alten Standard 0,5 einmalig auf
     0,3, eigene andere Werte bleiben, ebenso eine spätere eigene Wahl von 0,5; alter Speicherstand ohne Version bekommt
     zusätzlich die Standards aus 7.1.6
  B  Ruhe der Kamerafahrt (Mandelbulb, 10 s Autopilot): Drehrate des Blicks ≤ 20°/s, keine Sprünge in der Drehrate
     (Änderung je Takt; 7.1.6: p99 ≈ 7°/s), Kamera-Tempo ohne Knicke (2. Differenz je Flugzeit < 10 % des Tempos; 7.1.6:
     ≈ 310 %), Takt-Stufe gemeldet, Auflösung ≤ 1 Wechsel/s. --query=bulbpace=0 misst B mit dem Regler bis 7.1.6
  C  ?bulbpace=0 (Regler bis 7.1.6) läuft weiter ohne Fehler
  D  Lenken im Flug: danach endliche Werte, der Autopilot fliegt weiter
     B bitte sichtbar messen (FK_HEADED=1): headless drosselt macOS den Bildtakt.
Aufruf: FK_HEADED=1 python3 tests/test_v717.py [--only=A,B,…]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
QB = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--query=')), '')     # z. B. --query=bulbpace=0 (Vergleich B)
fails, res = [], {}
OUT = os.path.join(os.path.dirname(__file__), 'results_v717.json')


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    if not cond:
        fails.append(msg)


def stored_open(a, pg, o):
    pg.evaluate("(o) => { localStorage.clear(); if (o) localStorage.setItem('fraktal_v5_settings', JSON.stringify(o)); }", o)
    pg.goto('about:blank'); a.open()
    return pg.evaluate("() => { const A = window.__fraktal; return { fs: A.S.flySpeed, pal: A.PAL.list[A.S.palette].id, edgeW: A.S.edgeW, sv: (JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}').sv) }; }")


def case_A(p):
    print('A  Flug-Tempo 0,3 und Migration')
    a = App(p).open(); pg = a.page
    s = stored_open(a, pg, None)
    check(s['fs'] == 0.3, f'leerer Speicher: Flug-Tempo {s["fs"]}')
    s = stored_open(a, pg, {'sv': 2, 'flySpeed': 0.5, 'paletteId': 'neon', 'edgeW': 40, 'lang': 'de'})
    check(s['fs'] == 0.3 and s['edgeW'] == 40 and s['sv'] == 3, f'Stand 7.1.6 mit 0,5 -> 0,3, sonst unverändert (die Migration 7.1.6 läuft nicht nochmal) {s}')
    s = stored_open(a, pg, {'sv': 2, 'flySpeed': 0.8, 'lang': 'de'})
    check(s['fs'] == 0.8, f'eigener Wert 0,8 bleibt ({s["fs"]})')
    s = stored_open(a, pg, {'sv': 2, 'flySpeed': -0.5, 'lang': 'de'})
    check(s['fs'] == -0.5, f'rückwärts −0,5 bleibt ({s["fs"]})')
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.saveSettings(); }")
    pg.goto('about:blank'); a.open()
    fs = pg.evaluate("() => window.__fraktal.S.flySpeed")
    check(fs == 0.5, f'nach der Migration selbst 0,5 gewählt -> bleibt ({fs})')
    s = stored_open(a, pg, {'flySpeed': 0.5, 'paletteId': 'fire', 'edgeW': 16, 'lang': 'de'})
    check(s['fs'] == 0.3 and s['pal'] == 'ice' and s['edgeW'] == 100, f'alter Stand ohne Version: Standards 7.1.6 + Tempo 0,3 {s}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


REC = """(ms) => new Promise(res => { const A = window.__fraktal, out = []; const t0 = performance.now();
  const f = (t) => { const B = A.BULB, i = B.info(); out.push([t, A.FLY.simT || 0, B.B.yaw, B.B.pitch, B.B.pos.slice(), i.nMot, +(i.scale || 0).toFixed(4), i.N || 0, i.flyD]);
    if (t - t0 < ms) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); })"""


def fw(r):
    cp = math.cos(r[3]); return (cp * math.sin(r[2]), math.sin(r[3]), cp * math.cos(r[2]))


def case_B(p):
    print('B  Ruhe der Kamerafahrt (Mandelbulb)' + (' ?' + QB if QB else ''))
    a = App(p, query='nosw&noanim' + ('&' + QB if QB else '')).open(); pg = a.page
    pg.evaluate("() => { const A = window.__fraktal; A.setMode(6); A.S.chrome = false; }"); time.sleep(3)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }")
    rec = pg.evaluate(REC, 10000)
    pg.evaluate("() => window.__fraktal.stopFly()")
    rec = [r for r in rec if r[0] - rec[0][0] > 2500]
    om, vel = [], []
    for i in range(1, len(rec)):
        h = rec[i][1] - rec[i - 1][1]
        if h <= 0: continue
        c = max(-1, min(1, sum(x * y for x, y in zip(fw(rec[i - 1]), fw(rec[i])))))
        om.append(math.degrees(math.acos(c)) / h)
        vel.append(math.dist(rec[i][4], rec[i - 1][4]) / h / max(1e-12, rec[i][8] or 1))
    lj = sorted(abs(om[i] - om[i - 1]) for i in range(1, len(om)))
    # (Knick je Takt: 2. Differenz des Tempos relativ zum Tempo der umliegenden ±5 Takte – gleichmäßiges Beschleunigen oder
    # Abbremsen bis fast 0 (Gleiten) ist kein Sprung, ein Einzelausreißer schon)
    loc = lambda i: sum(vel[max(0, i - 5):i + 6]) / len(vel[max(0, i - 5):i + 6])
    vj = sorted(abs(vel[i] - 2 * vel[i - 1] + vel[i - 2]) / max(1e-12, loc(i)) for i in range(2, len(vel)))
    dur = (rec[-1][0] - rec[0][0]) / 1000
    shown = [r for i, r in enumerate(rec) if i > 0 and r[5] != rec[i - 1][5]]
    sc = sum(1 for i in range(1, len(shown)) if abs(shown[i][6] - shown[i - 1][6]) > 1e-4) / dur
    res['B'] = {'look_max': round(max(om), 1), 'ljerk_p99': round(lj[int(len(lj) * 0.99)], 2), 'vjump_p99': round(vj[int(len(vj) * 0.99)], 3), 'scale_changes_s': round(sc, 2), 'N': sorted(set(r[7] for r in rec))}
    print('    ', res['B'])
    check(max(om) <= 20.5, f'Drehrate des Blicks höchstens {max(om):.1f}°/s (≤ 20)')
    check(res['B']['ljerk_p99'] < 1.5, f'Drehrate ohne Sprünge (99 % der Änderungen je Takt < {res["B"]["ljerk_p99"]}°/s)')
    check(res['B']['vjump_p99'] < 0.10, f'Kamera-Tempo ohne Sprünge (99 % der Knicke je Takt < {res["B"]["vjump_p99"]:.1%} des Tempos ringsum)')
    check(sc <= 1 and all(n in (1, 2, 3) for n in res['B']['N']), f'Auflösung {sc:.2f} Wechsel/s, Takt-Stufe {res["B"]["N"]}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_C(p):
    print('C  ?bulbpace=0')
    a = App(p, query='nosw&noanim&bulbpace=0').open(); pg = a.page
    pg.evaluate("() => { const A = window.__fraktal; A.setMode(6); }"); time.sleep(3)
    n0 = pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); return A.BULB.info().nMot; }")
    time.sleep(3)
    n1 = pg.evaluate("() => window.__fraktal.BULB.info().nMot")
    pg.evaluate("() => window.__fraktal.stopFly()")
    check(n1 - n0 > 20 and not a.errors, f'alter Regler fliegt ({n1 - n0} Bewegungsbilder), Fehler {a.errors[:2]}')
    a.close()


def case_D(p):
    print('D  Lenken im Flug')
    a = App(p, query='nosw&noanim').open(); pg = a.page
    pg.evaluate("() => { const A = window.__fraktal; A.setMode(8); }"); time.sleep(3)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }"); time.sleep(3)
    for k in range(20):
        pg.evaluate("(k) => window.__fraktal.BULB.flySteer(6 * Math.sin(k / 3), 3)", k); time.sleep(0.03)
    p0 = pg.evaluate("() => window.__fraktal.BULB.B.pos.slice()"); time.sleep(2)
    st = pg.evaluate("() => { const B = window.__fraktal.BULB.B; return { pos: B.pos.slice(), yaw: B.yaw, pitch: B.pitch, on: window.__fraktal.FLY.on }; }")
    fin = all(math.isfinite(x) for x in st['pos'] + [st['yaw'], st['pitch']])
    check(fin and st['on'] and math.dist(p0, st['pos']) > 0, f'nach dem Lenken endlich und weiter im Flug ({st["on"]}, Weg {math.dist(p0, st["pos"]):.2e})')
    pg.evaluate("() => window.__fraktal.stopFly()")
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


if __name__ == "__main__":
  with sync_playwright() as p:
      for k, fn in [('A', case_A), ('B', case_B), ('C', case_C), ('D', case_D)]:
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
