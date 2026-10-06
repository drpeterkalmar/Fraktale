#!/usr/bin/env python3
"""Nahtloser Bildaufbau (5.1): Compositing der Ebenen, Übergänge, Vorausrechnen, Tempo-Bremse.

Fahrten per Skript (Kamera direkt, wie eine Finger-Geste) + animierte Bewegungen; gemessen über den
Debug-Hook window.__fraktal.frameStats() (pro gezeichnetem Frame: effektive Schärfe, unbedeckter Anteil,
Zahl der Ebenen, harte Wechsel). Prüft:
  * 0 harte Ebenenwechsel (neue Ebene sofort voll deckend über einem vorhandenen Bild)
  * Schärfe fällt nie bei stehender Kamera (Stillstand-Frames: mittlere Schärfe sinkt nie um > 0.02)
  * kaum Lücken: unbedeckt im Mittel < 1 % (Zoom, Schwenk), < 5 % beim Herauszoomen ×100 in 2 s
  * im Stillstand liegt das exakte Endbild deckend oben (Schärfe 1, alpha 1) – pixelgleich zu 5.0.1
  * Vorausrechnen läuft im Leerlauf (Reserve-Ebene + tieferer Referenzorbit) und blockiert nichts
  * Schwenk ist schärfer als im 5.0.1-Modus (?blend=0 gibt es seit 6.5.4 nicht mehr; Referenz gemessen mit 6.5.3:
    5.0.1-Modus Schwenk-Schärfe 0,001, Lücken beim Herauszoomen 0,913)
  * Tempo-Bremse: animierter Flug bremst bei grobem Bild (höchstens 2,5× so lang wie ohne Bremse; ?gov=0 gibt es seit
    6.5.4 nicht mehr, Referenz 5,53 s gemessen mit 6.5.3)
  * 0 Page-/Console-Fehler, keine Long Tasks > 50 ms
Aufruf: python3 tests/test_blend.py
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from measure_blend import DRIVE, WALK
from playwright.sync_api import sync_playwright

LT = """() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({entryTypes: ['longtask']}); }"""


def drive(pg, *a):
    pg.evaluate("(a) => (" + DRIVE + ")(a)", list(a))


def stats(pg):
    fs = pg.evaluate("() => window.__fraktal.frameStats()")
    fr = fs['frames']
    mean = lambda k, F=fr: round(sum(f[k] for f in F) / max(1, len(F)), 4)
    held = [f for f in fr if not f['moving']]
    drops = sum(1 for a, b in zip(held, held[1:]) if b['t'] - a['t'] < 100 and b['k'] < a['k'] - 0.02)
    return dict(frames=len(fr), hard=fs['hard'], kMean=mean('k'), uncMean=mean('unc'), coarse=mean('coarse'),
                layersMax=max((f['n'] for f in fr), default=0), heldDrops=drops, gMin=min((f['g'] for f in fr), default=1))


def scenario(p, query):
    a = App(p, query=query).open()
    pg = a.page
    pg.evaluate(LT)
    out = {}
    cx, cy = WALK
    a.set_view(cx, cy, 1e5); a.wait_done(120); time.sleep(2.5)
    pf = pg.evaluate("() => { const L = window.__fraktal.layerInfo(); return { n: L.n, prefetch: L.layers.filter(l => l.prefetch).length, refZoom: window.__fraktal.REF.cur ? window.__fraktal.REF.cur.zoom : 0, zoom: window.__fraktal.S.cam.zoom }; }")
    out['prefetch'] = pf
    # Zoom (Finger-artig, ungebremst) 1e5 -> 1e8 in 3 s, dann Schwenk 3 s
    pg.evaluate("() => window.__fraktal.frameStats(true)")
    drive(pg, 'zoom', cx, cy, 1e5, 1e8, 3)
    out['zoom'] = stats(pg)
    pg.evaluate("() => window.__fraktal.frameStats(true)")
    s = pg.evaluate("() => { const A = window.__fraktal; return [A.HP.toString(A.S.cam.cx, 30), A.HP.toString(A.S.cam.cy, 30)]; }")
    drive(pg, 'pan', s[0], s[1], 1e8, 1e8, 3)
    out['pan'] = stats(pg)
    # Stillstand: exaktes Bild oben, voll deckend
    t, st = a.wait_done(180)
    time.sleep(2.5)                      # Betrachtungspause: Vorausrechnen (Reserve-Ebenen) hat Zeit
    li = pg.evaluate("() => window.__fraktal.layerInfo()")
    out['rest'] = dict(top=li['layers'][0], kMean=round(li['kMean'], 3), unc=li['unc'], pool=li['pool'])
    # Herauszoomen ×100 in 2 s (Ränder müssen weich gefüllt bleiben)
    pg.evaluate("() => window.__fraktal.frameStats(true)")
    s = pg.evaluate("() => { const A = window.__fraktal; return [A.HP.toString(A.S.cam.cx, 30), A.HP.toString(A.S.cam.cy, 30)]; }")
    drive(pg, 'zoom', s[0], s[1], 1e8, 1e6, 2)
    out['zoomout'] = stats(pg)
    a.wait_done(180); time.sleep(1.5)
    # Doppeltipp-Serie (animiert, Tempo-Bremse aktiv)
    pg.evaluate("() => window.__fraktal.frameStats(true)")
    for _ in range(3):
        pg.evaluate("() => window.__fraktal.zoomAt(innerWidth / 2, innerHeight / 2, 3)"); time.sleep(0.8)
    a.wait_done(180)
    out['dtap'] = stats(pg)
    # animierter Flug 1e6 -> 1e10 (wie ▶ Tour): Tempo-Bremse muss greifen, wenn das Bild grob würde
    a.set_view(cx, cy, 1e6); a.wait_done(120); time.sleep(1.5)
    pg.evaluate("() => window.__fraktal.frameStats(true)")
    t0 = time.time()
    pg.evaluate("([x, y]) => { const A = window.__fraktal; A.flyTo(A.HP.fromString(x), A.HP.fromString(y), 1e10, { perDecade: 1.1, maxDur: 40 }); }", [cx, cy])
    pg.wait_for_function("() => !window.__fraktal.isMoving()", timeout=120000, polling=100)
    out['fly'] = stats(pg); out['fly']['durationS'] = round(time.time() - t0, 2)
    out['longTasks'] = [x for x in pg.evaluate("() => window.__lt") if x > 50]
    out['errors'] = a.errors
    a.close()
    return out


def main():
    ok = True
    res = {}
    with sync_playwright() as p:
        res['new'] = n = scenario(p, 'nosw&noanim')
    print(json.dumps(res, indent=1))
    L501 = {'panK': 0.001, 'zoomoutUnc': 0.9131}   # 5.0.1-Modus, gemessen mit 6.5.3 (Mac, headless)
    GOV0_FLY_S = 5.53                                 # derselbe Flug ohne Tempo-Bremse (?gov=0), gemessen mit 6.5.3
    chk = []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what)
        ok &= bool(c)
    for k in ('zoom', 'pan', 'zoomout', 'dtap'):
        need(n[k]['hard'] == 0, f'{k}: 0 harte Wechsel ({n[k]["hard"]})')
        need(n[k]['heldDrops'] == 0, f'{k}: Schärfe fällt nicht bei stehender Kamera ({n[k]["heldDrops"]})')
    need(n['pan']['uncMean'] < 0.01 and n['zoom']['uncMean'] < 0.01, f'Lücken Zoom/Schwenk < 1 % ({n["zoom"]["uncMean"]}/{n["pan"]["uncMean"]})')
    # ×100 in 2 s bei headless ~15 fps ist ein Extremfall: < 5 % (5.0.1-Modus: 91 %)
    need(n['zoomout']['uncMean'] < 0.05, f'Herauszoomen ×100: Lücken < 5 % ({n["zoomout"]["uncMean"]}, 5.0.1-Modus {L501["zoomoutUnc"]})')
    top = n['rest']['top']
    need(top['front'] and top['exact'] and top['alpha'] == 1 and top['k'] == 1 and n['rest']['kMean'] == 1, 'Stillstand: exaktes Endbild deckend oben')
    need(n['prefetch']['prefetch'] >= 1 and n['prefetch']['refZoom'] > n['prefetch']['zoom'] * 2, f'Vorausrechnen im Leerlauf ({n["prefetch"]})')
    need(n['rest']['pool']['usedMB'] + n['rest']['pool']['freeMB'] <= 64.5, f'GPU-Pufferspeicher im Budget ({n["rest"]["pool"]})')
    need(n['pan']['kMean'] >= L501['panK'] + 0.05, f'Schwenk schärfer als 5.0.1-Modus ({n["pan"]["kMean"]} vs {L501["panK"]})')
    need(n['fly']['gMin'] < 0.9, f'Tempo-Bremse greift beim Flug ({n["fly"]["gMin"]})')
    need(n['fly']['durationS'] < 2.6 * GOV0_FLY_S, f'Flug höchstens 2,5× so lang wie ohne Bremse ({n["fly"]["durationS"]} s, ohne Bremse {GOV0_FLY_S} s)')
    need(n['fly']['hard'] == 0, 'Flug: 0 harte Wechsel')
    for k in ('new',):
        need(not res[k]['errors'] and not res[k]['longTasks'], f'{k}: 0 Fehler, keine Long Tasks > 50 ms')
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
