#!/usr/bin/env python3
"""7.1 – neue Welten und Parameter (Etappe 2), Prüfung im Browser (Pixel 7, GPU).

  A  Jede neue Welt/Variante rechnet auf der GPU fehlerfrei, das Bild ist nicht flach, und die GPU (f32) stimmt mit dem
     CPU-Gegenstück (fractal-core.js, f64) an 300 Stichprobenpixeln überein (glatte Zahl ±1 bzw. gleiche Newton-Wurzel)
  B  Burning-Ship-Familie im Deep Zoom (10⁵–10⁶, GPU-Perturbation) an gut bestimmten Pixeln (CPU direkt = CPU-Perturbation): ±1 bei ≥ 94 %
  C  Link: wp= stellt Variante/Folge/Exponent her, stateURL schreibt sie zurück; Palette der Welt
  D  „Ansicht merken“ trägt die Welt-Parameter, goTo stellt sie wieder her
  E  Sehenswürdigkeiten: Orte-Tab listet sie, ▶ Tour landet am Ziel mit Parametern; Rundgang fliegt zum nächsten Ort
  F  Multibrot-Morph: der Exponent wandert, Bilder kommen nach
  G  Exoten über der GPU-Grenze: CPU f64 (Magnet 10⁴), Bild fertig
Aufruf: python3 tests/test_v71.py [--only=A,B,…]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
fails, res = [], {}
OUT = os.path.join(os.path.dirname(__file__), 'results_v71.json')


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    if not cond:
        fails.append(msg)


# Stichproben: GPU-Wert des fertigen Bilds gegen fractal-core.js (f64) im Main-Thread – gleiche Pixelkoordinaten wie der Worker
CMP = """(n) => {
    const A = window.__fraktal, f = A.RC.front, C = window.FKCore, HP = A.HP;
    const all = A.R.readIterSync(f.buf), w = f.buf.w, h = f.buf.h;
    C.xpSetup(f.X || null); C.stSetup(0);
    const cx = HP.toNumber(f.view.cx), cy = HP.toNumber(f.view.cy);
    let ok = 0, tot = 0, both = 0, insideAgree = 0, maxd = 0;
    let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < n; k++) {
        const i = Math.floor(rnd() * w), j = Math.floor(rnd() * h);
        let g = all[j * w + i];
        if (g <= -3) g = -g - 4; else if (g < -1.5) g = -1;
        const px = cx + (i + 0.5 - w / 2) * f.scale, py = cy + (j + 0.5 - h / 2) * f.scale;
        const c = C.directPixel(px, py, f.formula, f.maxIter, f.julia[0], f.julia[1], 0, false);
        tot++;
        if ((g < 0) === (c < 0)) insideAgree++;
        if (g < 0 || c < 0) { if ((g < 0) === (c < 0)) ok++; continue; }
        both++;
        let d;
        if (f.formula === 5) d = Math.floor(g / 1000) !== Math.floor(c / 1000) ? 99 : Math.abs(g % 1000 - c % 1000);
        else d = Math.abs(g - c);
        maxd = Math.max(maxd, d === 99 ? 0 : d);
        if (d <= (f.formula === 28 ? 0.25 : 1)) ok++;
    }
    return { ok: ok / tot, inside: insideAgree / tot, n: tot, both, maxd: +maxd.toFixed(3), formula: f.formula, kind: f.kind, mode: f.mode };
}"""
# B: gut bestimmte Pixel = direkte f64-Rechnung und CPU-Perturbation (f64, ohne BLA) stimmen auf ±1 überein. Die Varianten
# des Burning Ship sind nahe der Menge nicht-konform chaotisch – dort ist die Iterationszahl schon in f64 nicht bestimmt
# (die direkte Rechnung weicht nach ~50 Schritten um 10⁻⁶ ab und wächst um ×2 je Schritt), egal mit welchem Verfahren
CMPB = """(n) => {
    const A = window.__fraktal, f = A.RC.front, C = window.FKCore, HP = A.HP, r = A.REF.cur;
    const all = A.R.readIterSync(f.buf), w = f.buf.w, h = f.buf.h;
    C.xpSetup(null); C.stSetup(0);
    const ref = { formula: r.formula, orbit: r.orbit64, baseA: r.baseA, lenA: r.lenA, baseB: r.baseB, lenB: r.lenB, bla: null };
    const ox = HP.toNumber(f.view.cx - r.refXb), oy = HP.toNumber(f.view.cy - r.refYb), cx = HP.toNumber(f.view.cx), cy = HP.toNumber(f.view.cy);
    let good = 0, ok = 0, tot = 0;
    let s = 777; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < n; k++) {
        const i = Math.floor(rnd() * w), j = Math.floor(rnd() * h);
        let g = all[j * w + i]; if (g <= -3) g = -g - 4; else if (g < -1.5) g = -1;
        const dx = (i + 0.5 - w / 2) * f.scale, dy = (j + 0.5 - h / 2) * f.scale;
        const d = C.directPixel(cx + dx, cy + dy, f.formula, f.maxIter, 0, 0, 0, false);
        const q = C.perturbPixel(ox + dx, oy + dy, ref, f.maxIter, false, 0, false);
        tot++;
        const same = (a, b) => (a < 0 && b < 0) || (a >= 0 && b >= 0 && Math.abs(a - b) <= 1);
        if (!same(d, q)) continue;
        good++;
        if (same(g, q)) ok++;
    }
    return { good: good / tot, ok: good ? ok / good : 0, n: tot, kind: f.kind, mode: f.mode };
}"""
STD = """() => { const A = window.__fraktal; A.snapshot(); const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'); g.drawImage(A.R.canvas, 0, 0, 64, 128); const d = g.getImageData(0, 0, 64, 128).data;
    let m = 0, q = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; m += l; q += l * l; n++; }
    m /= n; return Math.sqrt(Math.max(0, q / n - m * m)); }"""


def case_A(p):
    print('A  neue Welten: GPU fehlerfrei, Bild nicht flach, GPU = CPU-Gegenstück')
    a = App(p).open(); pg = a.page
    worlds = [('Lyapunov AB', 'm=10&x=3&y=3&z=1.5', 28), ('Lyapunov Zirkon', 'm=10&x=3.7&y=2.95&z=3.2&wp=sBBBBBBAAAAAA', 28),
              ('Phoenix Julia', 'm=11&x=0&y=0&z=0.45', 24), ('Phoenix Mandel', 'm=11&x=0&y=0&z=0.6&wp=v1', 24),
              ('Nova Mandel', 'm=12&x=-0.3&y=0&z=0.8', 25), ('Nova Julia', 'm=12&x=0&y=0&z=1&wp=v1', 25),
              ('Magnet I', 'm=13&x=1.2&y=0&z=0.55', 26), ('Magnet II', 'm=13&x=1.2&y=0&z=0.55&wp=v1', 27),
              ('Multibrot 3,5', 'm=4&x=0&y=0&z=1&wp=e3.5', 23), ('Multibrot 5', 'm=4&x=0&y=0&z=1&wp=e5', 23),
              ('Newton z³−1', 'm=5&x=0&y=0&z=1', 5), ('Newton z³−2z+2', 'm=5&x=0&y=0&z=1&wp=p3', 5), ('Newton z⁸+15z⁴−16', 'm=5&x=0&y=0&z=1&wp=p5', 5),
              ('Celtic', 'm=2&x=-0.5&y=0&z=0.6&wp=v1', 20), ('Senkrecht', 'm=2&x=-0.5&y=0&z=0.6&wp=v2', 21), ('Büffel', 'm=2&x=-0.5&y=-0.2&z=0.6&wp=v3', 22)]
    res['A'] = {}
    for name, h, cf in worlds:
        pg.goto('about:blank'); a.open(h)
        t, st = a.wait_done(150)
        r = pg.evaluate(CMP, 300)
        sd = pg.evaluate(STD)
        res['A'][name] = dict(r, std=round(sd, 1), sec=round(t, 1))
        check(r['formula'] == cf and r['kind'] == 'gpu' and r['ok'] >= 0.96 and r['inside'] >= 0.97 and sd > 6 and not a.errors,
              f"{name}: Formel {r['formula']}, GPU = CPU {r['ok'] * 100:.1f} % (innen/außen {r['inside'] * 100:.1f} %, max Δ {r['maxd']}), Streuung {sd:.0f}, {t:.1f} s {a.errors[:2]}")
        a.errors.clear()
    a.close()


def case_B(p):
    print('B  Burning-Ship-Familie im Deep Zoom (GPU-Perturbation) gegen f64 direkt')
    a = App(p).open(); pg = a.page
    pts = [('Celtic', '-0.766776084900', '0.846776962280', 1.573e5, 1), ('Senkrecht', '0.327108025551', '-1.01892590523', 1.258e6, 2),
           ('Büffel', '-0.236132621765', '-1.20705146790', 1.573e5, 3)]
    res['B'] = {}
    for name, x, y, z, v in pts:
        pg.goto('about:blank'); a.open(f'm=2&x={x}&y={y}&z={z}&wp=v{v}')
        t, st = a.wait_done(240)
        r = pg.evaluate(CMPB, 400)
        res['B'][name] = dict(r, sec=round(t, 1))
        # (Schwelle 94 %: in den chaotischen Staub-Zonen weicht f32 nach einem Rebase ab, ohne dass die Fehlerschätzung es sieht –
        #  gemessen Celtic 94,7 %, Büffel 95,8 %, senkrecht 100 %; siehe V71_BERICHT.md)
        check(r['mode'] == 'perturb' and r['kind'] == 'gpu' and r['good'] >= 0.2 and r['ok'] >= 0.94 and not a.errors,
              f"{name} {z:.2g}: {r['kind']}/{r['mode']}, gut bestimmt {r['good'] * 100:.0f} % der Pixel, davon GPU ±1 {r['ok'] * 100:.1f} %, {t:.1f} s {a.errors[:2]}")
        a.errors.clear()
    a.close()


def case_C(p):
    print('C  Link (wp=) und Palette der Welt')
    a = App(p).open(); pg = a.page
    pg.goto('about:blank'); a.open('m=2&x=-0.5&y=0&z=0.6&wp=v1')
    a.wait_done(60)
    r = pg.evaluate("() => { const A = window.__fraktal; return [A.cformula(), A.stateURL()]; }")
    check(r[0] == 20 and 'wp=v1' in r[1], f'Celtic aus dem Link (Formel {r[0]}), Link schreibt wp=v1 ({r[1][-40:]})')
    pg.goto('about:blank'); a.open('m=10&x=3.3&y=3.3&z=2.5&wp=sAABAB')
    a.wait_done(90)
    r = pg.evaluate("() => { const A = window.__fraktal; return [A.cformula(), A.S.wp[10].s, A.PAL.list[A.S.palette].id, A.stateURL()]; }")
    check(r[0] == 28 and r[1] == 'AABAB' and r[2] == 'gold' and 'wp=sAABAB' in r[3], f'Lyapunov-Folge aus dem Link {r[:3]}, Link {r[3][-30:]}')
    pg.goto('about:blank'); a.open('')
    r = pg.evaluate("() => { const A = window.__fraktal; A.S.wpal = {}; A.S.palette = A.PAL.indexOf('ocean'); const p0 = A.PAL.list[A.S.palette].id; A.setMode(10); const p1 = A.PAL.list[A.S.palette].id; A.setMode(0); return [p0, p1, A.PAL.list[A.S.palette].id]; }")
    check(r[1] == 'gold' and r[0] == r[2], f'Palette je Welt: klassisch {r[0]} -> Lyapunov {r[1]} -> zurück {r[2]}')
    pg.goto('about:blank'); a.open('m=4&x=0&y=0&z=1&wp=e2.75')
    a.wait_done(90)
    r = pg.evaluate("() => { const A = window.__fraktal; return [A.cformula(), A.mexpNow(), A.maxZoom()]; }")
    check(r[0] == 23 and abs(r[1] - 2.75) < 1e-9 and r[2] == 1e13, f'Multibrot n = 2,75 direkt (Formel {r[0]}, n {r[1]}, Grenze {r[2]:.0e})')
    pg.goto('about:blank'); a.open('m=4&x=0&y=0&z=1')
    r = pg.evaluate("() => { const A = window.__fraktal; return [A.cformula(), A.maxZoom()]; }")
    check(r[0] == 4 and r[1] > 1e200, f'Multibrot n = 3 = z³ mit Deep Zoom (Formel {r[0]}, Grenze {r[1]:.0e})')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_D(p):
    print('D  „Ansicht merken“ trägt die Welt-Parameter')
    a = App(p).open(); pg = a.page
    pg.goto('about:blank'); a.open('m=13&x=1.3&y=-0.5&z=20&wp=v1')
    a.wait_done(90)
    r = pg.evaluate("""() => { const A = window.__fraktal; const v = A.viewState(); A.setWP(13, { v: 0 }); const before = A.cformula();
        A.goTo(v); return [v.wp, before, A.cformula()]; }""")
    check(r[0] and r[0].get('v') == 1 and r[1] == 26 and r[2] == 27, f'viewState.wp {r[0]}, umgestellt auf Typ I ({r[1]}), goTo -> Typ II ({r[2]})')
    a.close()


def case_E(p):
    print('E  Sehenswürdigkeiten: Liste, Tour, Rundgang')
    a = App(p).open(); pg = a.page
    pg.evaluate("() => window.__fraktal.setMode(10)"); a.wait_done(90)
    pg.click('.dock-btn[data-tab="places"]'); time.sleep(0.6)
    n = pg.evaluate("() => document.querySelectorAll('#sights .place').length")
    imgs = pg.evaluate("() => [...document.querySelectorAll('#sights .thumb')].map(t => t.style.backgroundImage).filter(s => s.includes('assets/sights/')).length")
    check(n >= 4 and imgs == n, f'Orte-Tab: {n} Sehenswürdigkeiten mit Vorschaubild ({imgs})')
    pg.click('#sheet-close'); time.sleep(0.4)
    s = pg.evaluate("() => window.__fraktal.SIGHTS[10][0]")
    pg.evaluate("(s) => window.__fraktal.startTour(s)", s)
    t0 = time.time()
    while time.time() - t0 < 60 and (pg.evaluate("() => window.__fraktal.status().moving") or time.time() - t0 < 1): time.sleep(0.2)
    r = pg.evaluate("() => { const A = window.__fraktal; return [A.S.cam.zoom, A.S.wp[10].s, A.HP.toNumber(A.S.cam.cx), A.HP.toNumber(A.S.cam.cy)]; }")
    check(abs(r[0] / s['zoom'] - 1) < 1e-6 and r[1] == s['wp']['s'] and abs(r[2] - float(s['cx'])) < 1e-9, f'Tour gelandet: Zoom {r[0]:.3g}, Folge {r[1]}, Mitte {r[2]:.6f}/{r[3]:.6f}')
    pg.evaluate("() => { const A = window.__fraktal; A.startRound(A.SIGHTS[11]); }")
    t0 = time.time(); seen = set()
    while time.time() - t0 < 50:
        i = pg.evaluate("() => window.__fraktal.ROUND.list ? window.__fraktal.ROUND.i : -1")
        seen.add(i)
        if 1 in seen: break
        time.sleep(0.25)
    check(0 in seen and 1 in seen, f'Rundgang: erster Ort, dann der nächste ({sorted(seen)})')
    pg.mouse.move(200, 400); pg.mouse.down(); pg.mouse.move(240, 420, steps=4); pg.mouse.up(); time.sleep(0.3)
    check(pg.evaluate("() => window.__fraktal.ROUND.list") is None, 'Geste beendet den Rundgang')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_F(p):
    print('F  Multibrot-Morph')
    a = App(p).open(); pg = a.page
    pg.goto('about:blank'); a.open('m=4&x=0&y=0&z=1&wp=m1')
    time.sleep(1.0)
    e0 = pg.evaluate("() => window.__fraktal.mexpNow()")
    pg.evaluate("() => window.__fraktal.frameStats(true)")
    time.sleep(4.0)
    e1 = pg.evaluate("() => window.__fraktal.mexpNow()")
    fs = pg.evaluate("() => window.__fraktal.frameStats()")
    layers = pg.evaluate("() => window.__fraktal.layerInfo().layers.filter(l => l.sig.includes(':{\"xp\":[' + window.__fraktal.mexpNow())).length")
    check(e1 != e0 and 2 <= e1 <= 6, f'Exponent wandert ({e0:.3f} -> {e1:.3f})')
    check(len(fs['frames']) > 40, f'Bilder laufen ({len(fs["frames"])} in 4 s)')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_G(p):
    print('G  Exoten über der GPU-Grenze: CPU f64')
    a = App(p).open(); pg = a.page
    pg.goto('about:blank'); a.open('m=13&x=0.0947088068&y=-1.0600142045&z=1e4')
    t, st = a.wait_done(240)
    sd = pg.evaluate(STD)
    check(st['plan'] == {'kind': 'cpu', 'mode': 'direct'} and st['done'] and sd > 4, f"Magnet 10⁴: {st['plan']}, fertig in {t:.1f} s, Streuung {sd:.0f}")
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


with sync_playwright() as p:
    for k, fn in [('A', case_A), ('B', case_B), ('C', case_C), ('D', case_D), ('E', case_E), ('F', case_F), ('G', case_G)]:
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
