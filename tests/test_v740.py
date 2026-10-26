#!/usr/bin/env python3
"""7.4 Roll im Flug (Peter 26.10.2026: „Kannst du beim Fraktal-Autopiloten ganz langsame Rotationen (Roll) hinzufügen?“).

  A  2D-Zufallsflug 30 s (Seepferdchental 10³): die Ansicht dreht (≥ 10° in 30 s), nie schneller als 1,6°/s, kein Sprung
     (je Bild ≤ 0,1°), grobe Bilder höchstens 3 Prozentpunkte mehr als derselbe Flug mit ?roll=0, 0 Fehler
  B  ?roll=0: Winkel bleibt 0; ?roll=3: höchstens 3,1°/s
  C  Link mit r=30: Ansicht um 30° gedreht, die Adresszeile trägt r=30 weiter; ohne r: 0
  D  Gesten in gedrehter Ansicht: ein Finger schiebt um (120, 0) CSS-px – der Weltpunkt unter dem Finger bleibt unter dem Finger
  E  Ausrichten (Kompass-Knopf) nach dem Flug: Winkel in 0,6 s weich auf 0
  F  ⛰ aus gedrehter 2D-Ansicht: 3D übernimmt den Winkel als Kurs (Kurs = −Drehung), 2D-Drehung 0
  G  Schweben am Rand (7.4.x): 2D-Flug 45 s mit erzwungen grober Schärfe (GOV.lq = 0,3 -> Bremsen/Schweben/Herauszoomen/Warten),
     Elefantental 10³ und Kardioide 30×: Bildmitte in den Schwebe-Phasen ≥ 90 % im Rand-Korridor (0 < d ≤ 0,12 Bildhälften), seltener
     innen als mit ?randschweb=0; grobe Bilder nicht mehr als ohne (+3 Prozentpunkte)
  H  Start am Rand (7.4.x): 20 Zufallsstarts (?seed=1…20, Pixel 7): bei jeder 2D-Welt liegt der Rand in der Bildmitte (CPU-Sonde
     ±0,04 Bildhälften um die Kamera beim Losfliegen), Zeit bis zur Bewegung nicht länger als mit ?randstart=0 (+10 %)
Aufruf: FK_HEADED=1 python3 tests/test_v740.py [--only=A,B,…]   (Server: python3 tools/serve.py 8472)
Stand 26.10.2026: geschrieben in der Leicht-Spur (kein Browser erlaubt) – noch nicht ausgeführt.
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
ONLY = set(ARGS.get('only', 'A,B,C,D,E,F,G,H').split(','))
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
OUT = os.path.join(os.path.dirname(__file__), 'results_v740.json')
fails, res = [], {}


def check(c, msg):
    print(('  ok   ' if c else '  FAIL ') + msg, flush=True)
    if not c:
        fails.append(msg)


# Flug ms lang: je Bild Winkel (Grad) und Flugzeit; frameStats für den Anteil grober Bilder
REC = """(ms) => new Promise(res => { const A = window.__fraktal, out = [], t0 = performance.now();
  A.frameStats(true); A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false });
  const f = () => { out.push([performance.now() - t0, A.viewRot() * 180 / Math.PI]);
    if (performance.now() - t0 < ms) requestAnimationFrame(f);
    else { const fs = A.frameStats(false), fr = fs.frames.filter(x => x.t - fs.frames[0].t > 3000); A.stopFly();
      res({ out, coarse: fr.length ? fr.filter(x => x.coarse > 0.1).length / fr.length : null, hard: fs.hard }); } };
  requestAnimationFrame(f); })"""


def fly_rot(p, q, secs):
    a = App(p, query='nosw&noanim' + q).open(f'm=0&x={SEA[0]}&y={SEA[1]}&z=1e3')
    a.wait_done(120)
    r = a.page.evaluate(REC, secs * 1000)
    r['errors'] = a.errors[:3]
    a.close()
    o = r['out']
    unwrap, tot = [], 0
    for i in range(1, len(o)):
        d = (o[i][1] - o[i - 1][1] + 180) % 360 - 180
        unwrap.append((o[i][0] - o[i - 1][0], d)); tot += d
    r['turned'] = sum(abs(d) for _, d in unwrap)
    r['maxStep'] = max((abs(d) for _, d in unwrap), default=0)
    # Tempo über 0,5-s-Fenster
    rates, acc, tw = [], 0, 0
    for dtm, d in unwrap:
        acc += d; tw += dtm
        if tw >= 500: rates.append(abs(acc) / tw * 1000); acc = tw = 0
    r['maxRate'] = max(rates, default=0)
    r.pop('out')
    return r


def case_A(p):
    print('A  2D-Flug dreht langsam, ohne Sprung, nicht gröber')
    a = fly_rot(p, '', 30)
    b = fly_rot(p, '&roll=0', 30)
    res['A'] = {'roll': a, 'ohne': b}
    check(a['turned'] >= 10 and a['maxRate'] <= 1.6 and a['maxStep'] <= 0.1 and not a['errors'],
          f"gedreht {a['turned']:.1f}° in 30 s, größtes Tempo {a['maxRate']:.2f}°/s, größter Schritt {a['maxStep']:.3f}° {a['errors']}")
    if a['coarse'] is not None and b['coarse'] is not None:
        check(a['coarse'] <= b['coarse'] + 0.03, f"grob {a['coarse'] * 100:.1f} % (ohne Roll {b['coarse'] * 100:.1f} %)")


def case_B(p):
    print('B  ?roll=0 / ?roll=3')
    b0 = fly_rot(p, '&roll=0', 10)
    b3 = fly_rot(p, '&roll=3', 20)
    res['B'] = {'roll0': b0, 'roll3': b3}
    check(b0['turned'] == 0, f"?roll=0: gedreht {b0['turned']}°")
    check(b3['maxRate'] <= 3.1 and b3['turned'] > 10, f"?roll=3: größtes Tempo {b3['maxRate']:.2f}°/s, gedreht {b3['turned']:.1f}°")


def case_C(p):
    print('C  Link mit r=')
    a = App(p).open('m=0&x=-0.5&y=0&z=1&r=30')
    a.wait_done(60)
    r = a.page.evaluate("() => window.__fraktal.viewRot() * 180 / Math.PI")
    u = a.page.evaluate("() => window.__fraktal.stateURL()")
    a.close()
    b = App(p).open('m=0&x=-0.5&y=0&z=1')
    r0 = b.page.evaluate("() => window.__fraktal.viewRot()")
    b.close()
    res['C'] = {'rot': r, 'url': u, 'rot0': r0}
    check(abs(r - 30) < 0.01 and 'r=30' in u and r0 == 0, f'gedreht {r:.3f}°, Link {u[-40:]}, ohne r: {r0}')


def touch(cdp, typ, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def case_D(p):
    print('D  Schieben in gedrehter Ansicht folgt dem Finger')
    a = App(p).open('m=0&x=-0.5&y=0&z=4&r=40')
    a.wait_done(60)
    pg = a.page
    cdp = a.ctx.new_cdp_session(pg)
    W, H = pg.evaluate("() => [innerWidth, innerHeight]")
    c0 = pg.evaluate("() => { const S = window.__fraktal.S; return [window.__fraktal.HP.toNumber(S.cam.cx), window.__fraktal.HP.toNumber(S.cam.cy), S.cam.zoom]; }")
    x0, y0 = W * 0.3, H * 0.5
    touch(cdp, 'touchStart', [(x0, y0)])
    for k in range(1, 13):
        touch(cdp, 'touchMove', [(x0 + 10 * k, y0)]); time.sleep(0.03)
    touch(cdp, 'touchEnd', [])
    time.sleep(0.1)
    c1 = pg.evaluate("() => { const S = window.__fraktal.S; return [window.__fraktal.HP.toNumber(S.cam.cx), window.__fraktal.HP.toNumber(S.cam.cy), S.cam.zoom]; }")
    a.close()
    # Weltpunkt unter dem Finger: c + R(rot)·(dx, −dy)·s – bleibt gleich -> Kamera wandert um −R(rot)·(120, 0)·s
    s = 3 / (c0[2] * H); rot = math.radians(40)
    ex, ey = -math.cos(rot) * 120 * s, -math.sin(rot) * 120 * s
    dx, dy = c1[0] - c0[0], c1[1] - c0[1]
    err = math.hypot(dx - ex, dy - ey) / s
    res['D'] = {'expect': [ex, ey], 'got': [dx, dy], 'errPx': err}
    check(err < 6, f'Kamera wanderte ({dx:.5f}, {dy:.5f}), erwartet ({ex:.5f}, {ey:.5f}) – Abweichung {err:.1f} px (Schwung erlaubt etwas)')


def case_E(p):
    print('E  Ausrichten')
    a = App(p).open('m=0&x=-0.5&y=0&z=1&r=25')
    a.wait_done(60)
    a.page.evaluate("() => window.__fraktal.north3d()")
    time.sleep(0.7)
    r = a.page.evaluate("() => window.__fraktal.viewRot()")
    a.close()
    res['E'] = r
    check(abs(r) < 1e-6, f'nach Ausrichten {r}')


def case_F(p):
    print('F  ⛰ aus gedrehter Ansicht')
    a = App(p).open('m=0&x=-0.5&y=0&z=1&r=20')
    a.wait_done(60)
    a.page.evaluate("() => window.__fraktal.set3d(true)")
    ok3 = a.wait_3d(30)
    h = a.page.evaluate("() => [window.__fraktal.V3.heading, window.__fraktal.VR.rot]")
    a.close()
    res['F'] = h
    check(ok3 and abs(h[0] + math.radians(20)) < 1e-6 and h[1] == 0, f'3D an: {ok3}, Kurs {math.degrees(h[0]):.2f}° (soll −20°), 2D-Drehung {h[1]}')


HOVER = """(ms) => new Promise(res => { const A = window.__fraktal, G = A.GOV, F = A.FLY, t0 = performance.now();
  Object.defineProperty(G, 'lq', { configurable: true, get() { return 0.3; }, set(v) {} });
  A.frameStats(true); A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false }); F.rec = []; F.recM = [];
  const f = () => { if (performance.now() - t0 < ms) { requestAnimationFrame(f); return; }
    delete G.lq; const fs = A.frameStats(false), fr = fs.frames.filter(x => x.t - fs.frames[0].t > 3000);
    const M = F.recM.filter(m => m.ph && m.ph !== 'cruise' && m.dw > 0.5); A.stopFly();
    const fr2 = (g) => M.length ? M.filter(g).length / M.length : null;
    res({ n: M.length, inC: fr2(m => m.dF !== null && m.dF > 0 && m.dF <= 0.12), inside: fr2(m => m.dF === 0), img: M.length ? M.reduce((a, m) => a + (m.inFrac || 0), 0) / M.length : null,
          coarse: fr.length ? fr.filter(x => x.coarse > 0.1).length / fr.length : null }); };
  requestAnimationFrame(f); })"""


def case_G(p):
    print('G  Schweben am Rand')
    res['G'] = []
    for name, x, y, z in [('Elefantental', '0.2925755', '-0.0149977', '1e3'), ('Kardioide', '-0.7487', '0.0647', '30')]:
        r = {}
        for v, q in [('neu', ''), ('alt', '&randschweb=0')]:
            a = App(p, query='nosw&noanim&roll=0' + q).open(f'm=0&x={x}&y={y}&z={z}')
            a.wait_done(120)
            r[v] = a.page.evaluate(HOVER, 45000); r[v]['errors'] = a.errors[:3]
            a.close()
        res['G'].append({'ort': name, **r})
        n, o = r['neu'], r['alt']
        check(n['n'] > 50 and n['inC'] >= 0.9 and n['inside'] <= o['inside'] and not n['errors'],
              f"{name}: Mitte im Korridor {n['inC']:.2f} (ohne {o['inC']}), innen {n['inside']:.2f} (ohne {o['inside']}), Bild schwarz {n['img']:.2f} (ohne {o['img']}) {n['errors']}")
        if n['coarse'] is not None and o['coarse'] is not None:
            check(n['coarse'] <= o['coarse'] + 0.03, f"{name}: grob {n['coarse'] * 100:.1f} % (ohne {o['coarse'] * 100:.1f} %)")


START = """() => new Promise(res => { const A = window.__fraktal, t0 = performance.now();
  const f = () => { const S = A.START; if (!S.motion && performance.now() - t0 < 20000) { setTimeout(f, 50); return; }
    const w = A.S.formula, two = A.is2dW ? A.is2dW(w) : ![6, 7, 8, 9, 14, 15, 16, 17, 18].includes(w);
    res({ world: w, two, edge: S.info && S.info.edge, t: performance.now(), on: two ? A.ZUFALL.centerOnEdge(A.HP.toNumber(A.S.cam.cx), A.HP.toNumber(A.S.cam.cy), A.S.cam.zoom, w) : null }); };
  f(); })"""


def case_H(p):
    print('H  Start am Rand')
    res['H'] = {'neu': [], 'alt': []}
    for v, q in [('neu', ''), ('alt', '&randstart=0')]:
        for sd in range(1, 21):
            a = App(p, query=f'nosw&noanim&start=flug&seed={sd}' + q).open()
            t0 = time.time()
            r = a.page.evaluate(START); r['ms'] = round((time.time() - t0) * 1000); r['errors'] = a.errors[:2]
            a.close()
            res['H'][v].append(r)
    n2 = [r for r in res['H']['neu'] if r['two']]
    ok = sum(1 for r in n2 if r['on'])
    tn = sum(r['ms'] for r in res['H']['neu']) / 20; ta = sum(r['ms'] for r in res['H']['alt']) / 20
    check(n2 and ok == len(n2) and not any(r['errors'] for r in res['H']['neu']), f'Rand in der Mitte: {ok}/{len(n2)} 2D-Starts')
    check(tn <= ta * 1.1, f'Zeit bis zur Bewegung Ø {tn:.0f} ms (ohne {ta:.0f} ms)')


def main():
    with sync_playwright() as p:
        for k, f in [('A', case_A), ('B', case_B), ('C', case_C), ('D', case_D), ('E', case_E), ('F', case_F), ('G', case_G), ('H', case_H)]:
            if k in ONLY:
                f(p)
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print(f'\n{len(fails)} Fehler')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
