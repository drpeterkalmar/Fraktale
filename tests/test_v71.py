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
  H  Lichtbilder: erstes ansehnliches Bild < 1 s, Link mit eigener Flamme, Mutieren, Screenshot in Kacheln, Nebulabrot/Anti,
     CPU-Rückfall (?dens=cpu)
  I  3D-Welten (Quaternionen-Julia, Kaleidoskop-IFS, Apollonian): Ruhebild, Link mit Parametern, Tour, Flug
  J  Julia-Lupe (Langdruck + Ziehen im Mandelbrot: Vorschau folgt, Bild verschiebt sich nicht, Loslassen öffnet Julia an c) und
     Julia-Morph (c wandert am Kardioidenrand, rückwärts mit negativem Tempo, Link wp=m1)
  K  Burning Ship: Staub-Korrektur im Stillstand (Körnung in der Staubzone klein), beim Ziehen aus; Orte der Klassiker
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


def case_H(p):
    print('H  Lichtbilder: Flammen, Attraktoren, Nebulabrot – erstes Bild, Link, Zufall/Mutieren, Screenshot, Rückfall')
    a = App(p).open(); pg = a.page
    res['H'] = {}
    # erstes ansehnliches Bild: Zeit bis ≥ 5 Punkte je Pixel (volle Auflösung) und die Belichtung gemessen ist
    for name, js in [('Flamme Sichel', "A.setMode(14); A.setWP(14, { g: 0, d: '' }); A.goHome();"),
                     ('Flamme Galaxie', "A.setMode(14); A.setWP(14, { g: 10, d: '' }); A.goHome();"),
                     ('Clifford', "A.setMode(15); A.setWP(15, { t: 0, a: -1.4, b: 1.6, c: 1.0, d: 0.7 }); A.goHome();"),
                     ('Lorenz', "A.setMode(15); A.setWP(15, { t: 3, a: 10, b: 28, c: 2.6667, d: 0.004 }); A.goHome();")]:
        pg.goto('about:blank'); a.open('')
        # wie in der App: das Öffnen des Welten-Menüs übersetzt die Lichtbilder-Shader im Hintergrund (prewarm), dann die Wahl
        pg.evaluate("() => window.__fraktal.DENS.prewarm()"); time.sleep(0.8)
        pg.evaluate("() => { const A = window.__fraktal; A.stopAnims(); " + js + " A.stopAnims(); const h = A.homeOf(A.S.formula); A.setView(String(h[0]), String(h[1]), h[2]); window.__t0 = performance.now(); }")
        t_first = None
        for _ in range(100):
            i = pg.evaluate("() => { const d = window.__fraktal.DENS.info(); return { spp: d.spp, E: !!d.E, gpu: d.gpu, w: d.w, cw: window.__fraktal.R.canvas.width, t: performance.now() - window.__t0 }; }")
            if (i['spp'] or 0) >= 5 and i['E'] and i['w'] == i['cw']:
                t_first = i['t']; break
            time.sleep(0.05)
        time.sleep(1.5)
        sd = pg.evaluate(STD)
        info = pg.evaluate("() => window.__fraktal.DENS.info()")
        res['H'][name] = dict(first_ms=round(t_first or -1), std=round(sd, 1), info=info)
        check(t_first is not None and t_first < 1000 and info['gpu'] and sd > 10 and not a.errors,
              f"{name}: erstes ansehnliches Bild (≥ 5 Punkte/Pixel, belichtet) nach {t_first or -1:.0f} ms, Streuung {sd:.0f}, {info.get('spp')} Punkte/Pixel {a.errors[:2]}")
        a.errors.clear()
    # Link: eigene (zufällige) Flamme und Attraktor-Parameter überleben den Link
    r = pg.evaluate("() => { const A = window.__fraktal; A.setMode(14); A.flameRandom(4242); return A.stateURL(); }")
    check('wp=d' in r or '&wp=' in r, 'Zufallsflamme steht im Link (%s…)' % r[r.find('wp='):r.find('wp=') + 30])
    pg.goto('about:blank'); pg.goto(r.replace('#', '?nosw&noanim#') if '?' not in r else r); pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
    time.sleep(1.0)
    r2 = pg.evaluate("() => { const A = window.__fraktal; const d = A.DENS.curDef(); return [A.S.formula, d.kind, d.F.x.length, !!A.S.wp[14].d]; }")
    check(r2[0] == 14 and r2[1] == 'flame' and r2[3], f'Link öffnet die eigene Flamme wieder ({r2})')
    m = pg.evaluate("() => { const A = window.__fraktal; const d0 = A.S.wp[14].d; A.flameMutate(); return [d0 !== A.S.wp[14].d, A.DENS.curDef().F.x.length]; }")
    check(m[0], f'Mutieren ändert die Flamme ({m})')
    # Screenshot 2× in Kacheln (Flamme): fertig, richtige Größe, nicht leer
    pg.evaluate("() => { const A = window.__fraktal; A.setWP(14, { g: 3, d: '' }); A.goHome(); }"); time.sleep(3)
    shot = pg.evaluate("() => window.__fraktal.captureShot({ W: 1280, H: 720, tile: 512, label: false }).then(r => ({ W: r.W, H: r.H, bytes: r.bytes, tiles: r.tiles, kind: r.kind, ms: r.ms }))")
    res['H']['shot'] = shot
    check(shot and shot['W'] == 1280 and shot['tiles'] >= 4 and shot['kind'] == 'dens' and shot['bytes'] > 20000, f'Screenshot Flamme 1280 × 720 in {shot and shot["tiles"]} Kacheln, {shot and shot["bytes"]} Byte, {shot and shot["ms"]} ms')
    # Nebulabrot und Anti-Buddhabrot rechnen
    for v, nm in [(1, 'Nebulabrot'), (2, 'Anti-Buddhabrot')]:
        pg.goto('about:blank'); a.open(f'm=7&x=-0.5&y=0&z=1&wp=v{v}'); time.sleep(5)
        sd = pg.evaluate(STD)
        check(sd > 8 and not a.errors, f'{nm}: Bild nach 5 s, Streuung {sd:.0f} {a.errors[:2]}')
    a.close()
    # CPU-Rückfall (?dens=cpu)
    a = App(p, query='nosw&noanim&dens=cpu').open(); pg = a.page
    pg.evaluate("() => { const A = window.__fraktal; A.setMode(14); A.setWP(14, { g: 0, d: '' }); A.goHome(); }"); time.sleep(4)
    info = pg.evaluate("() => window.__fraktal.DENS.info()"); sd = pg.evaluate(STD)
    check(info['gpu'] is False and info['total'] > 1e5 and sd > 8 and not a.errors, f"CPU-Rückfall: {info['total']} Punkte in 4 s, Streuung {sd:.0f} {a.errors[:2]}")
    a.close()


def case_I(p):
    print('I  3D-Welten: Quaternionen-Julia, Kaleidoskop-IFS, Apollonian – Bild, Link, Tour, Flug')
    a = App(p).open(); pg = a.page
    res['I'] = {}
    for f, nm in [(16, 'Quaternionen-Julia'), (17, 'Kaleidoskop-IFS'), (18, 'Apollonian')]:
        pg.evaluate(f"() => window.__fraktal.setMode({f})")
        t0 = time.time()
        while time.time() - t0 < 60:
            inf = pg.evaluate("() => window.__fraktal.BULB.info()")
            if inf.get('still', 0) >= inf.get('K', 99): break
            time.sleep(0.2)
        sd = pg.evaluate(STD)
        ok = pg.evaluate("() => window.__fraktal.BULB.ready()")
        res['I'][nm] = dict(still_s=round(time.time() - t0, 1), std=round(sd, 1))
        check(ok is True and sd > 8 and not a.errors, f'{nm}: Ruhebild nach {time.time() - t0:.1f} s, Streuung {sd:.0f} {a.errors[:2]}')
    # Link mit Parametern (KIFS: Skalierung/Winkel) – neu laden, Zustand gleich
    st = pg.evaluate("() => { const A = window.__fraktal, BU = A.BULB; A.setMode(17); BU.B.kp = [2.3, 0.5, -0.4, 0]; BU.invalidate(); return [A.stateURL(), BU.stateString()]; }")
    pg.goto('about:blank'); a.query = 'nosw&noanim'; pg.goto(st[0].replace('#', '?nosw&noanim#')); pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000); time.sleep(1)
    st2 = pg.evaluate("() => [window.__fraktal.S.formula, window.__fraktal.BULB.stateString(), window.__fraktal.BULB.B.kp]")
    check(st2[0] == 17 and st2[1] == st[1], f'Link: Kaleidoskop-IFS mit Skalierung/Winkeln wieder da ({st2[2]})')
    # Tour zu einer Sehenswürdigkeit (Quaternionen-Julia Spirale): Parameter übernommen
    pg.evaluate("() => { const A = window.__fraktal; A.startTour(A.SIGHTS[16][1]); }"); time.sleep(9)
    q = pg.evaluate("() => window.__fraktal.BULB.B.qc")
    check(abs(q[0] + 0.291) < 1e-9 and abs(q[3] - 0.437) < 1e-9, f'Tour: c der Spirale übernommen {q}')
    # Flug durch den Kugelschaum (Apollonian): Zoom steigt
    pg.evaluate("() => { const A = window.__fraktal; A.setMode(18); A.S.flySpeed = 0.6; A.startFly(); }"); time.sleep(8)
    z = pg.evaluate("() => { const A = window.__fraktal; const z = A.S.cam.zoom; A.stopFly(); return [z, A.BULB.info().zoom || z]; }")
    check(max(z) > 3, f'Flug im Apollonian: Zoom {max(z):.1f}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_J(p):
    print('J  Julia-Lupe und Julia-Morph')
    a = App(p).open(); pg = a.page
    pg.goto('about:blank'); a.open('m=0&x=-0.5&y=0&z=1')
    time.sleep(1.5)
    W, H = pg.evaluate("() => [innerWidth, innerHeight]")
    cam0 = pg.evaluate("() => { const S = window.__fraktal.S; return [String(S.cam.cx), String(S.cam.cy), S.cam.zoom]; }")
    x0, y0 = W * 0.5, H * 0.62
    pg.mouse.move(x0, y0); pg.mouse.down(); time.sleep(0.8)
    on = pg.evaluate("() => window.__fraktal.LUPE.on")
    check(on, 'Langdruck im Mandelbrot öffnet die Lupe')
    for k in range(12):
        pg.mouse.move(x0 + k * 4, y0 - k * 6); time.sleep(0.03)
    time.sleep(0.3)
    L = pg.evaluate("() => { const A = window.__fraktal, L = A.LUPE; return [L.on, A.HP.toNumber(L.cx), A.HP.toNumber(L.cy), L.x, L.y]; }")
    cam1 = pg.evaluate("() => { const S = window.__fraktal.S; return [String(S.cam.cx), String(S.cam.cy), S.cam.zoom]; }")
    check(L[0] and abs(L[3] - (x0 + 44)) < 1 and abs(L[4] - (y0 - 66)) < 1, f'Lupe folgt dem Finger ({L[3]:.0f}, {L[4]:.0f})')
    check(cam1 == cam0, 'Bild verschiebt sich beim Ziehen mit Lupe nicht')
    os.makedirs(os.path.join(os.path.dirname(__file__), 'shots', 'v71'), exist_ok=True)
    png = os.path.join(os.path.dirname(__file__), 'shots', 'v71', 'lupe_hoch.png')
    pg.screenshot(path=png)
    # Pixel im Kreis über dem Finger: farbig und anders als ohne Lupe (Julia statt Mandelbrot)
    from PIL import Image, ImageStat
    im = Image.open(png).convert('L'); d = im.width / W; r = min(110, min(W, H) * 0.2)
    ly = L[4] - r - 56; box = [int((L[3] - r * 0.7) * d), int((ly - r * 0.7) * d), int((L[3] + r * 0.7) * d), int((ly + r * 0.7) * d)]
    sd = ImageStat.Stat(im.crop(box)).stddev[0]
    check(sd > 5, f'Lupe zeigt Struktur (Streuung {sd:.0f})')
    pg.mouse.up(); time.sleep(1.0)
    st = pg.evaluate("() => { const A = window.__fraktal; return [A.S.formula, A.HP.toNumber(A.S.julia.x), A.HP.toNumber(A.S.julia.y), A.LUPE.on]; }")
    check(st[0] == 1 and abs(st[1] - L[1]) < 1e-9 and abs(st[2] - L[2]) < 1e-9 and not st[3], f'Loslassen öffnet Julia bei c = {st[1]:.4f}{st[2]:+.4f}i')
    # Morph
    pg.goto('about:blank'); a.open('m=1&x=0&y=0&z=1&jx=-0.75&jy=0.1&wp=m1')
    time.sleep(0.5)
    pg.evaluate("() => { window.__fraktal.S.flySpeed = 1; }")
    c0 = pg.evaluate("() => { const A = window.__fraktal; return [A.HP.toNumber(A.S.julia.x), A.HP.toNumber(A.S.julia.y), A.JM.th]; }")
    time.sleep(4)
    c1 = pg.evaluate("() => { const A = window.__fraktal; return [A.HP.toNumber(A.S.julia.x), A.HP.toNumber(A.S.julia.y), A.JM.th]; }")
    import math
    def card(th): return ((math.cos(th) / 2 - math.cos(2 * th) / 4) * 1.012 + 0.003, (math.sin(th) / 2 - math.sin(2 * th) / 4) * 1.012)
    cc = card(c1[2])
    check(c1[2] > c0[2] + 0.2 and abs(cc[0] - c1[0]) < 1e-6 and abs(cc[1] - c1[1]) < 1e-6, f'Morph: c wandert am Rand (θ {c0[2]:.2f} -> {c1[2]:.2f}, c = {c1[0]:.3f}{c1[1]:+.3f}i)')
    fs = pg.evaluate("() => window.__fraktal.layerInfo().layers.length")
    pg.evaluate("() => { window.__fraktal.S.flySpeed = -1; }"); time.sleep(3)
    c2 = pg.evaluate("() => window.__fraktal.JM.th")
    check(c2 < c1[2] - 0.1, f'negatives Tempo: rückwärts (θ {c1[2]:.2f} -> {c2:.2f})')
    u = pg.evaluate("() => window.__fraktal.stateURL()")
    check('wp=m1' in u, 'Link trägt den Morph (wp=m1)')
    pg.evaluate("() => window.__fraktal.setWP(1, { m: 0 })"); time.sleep(0.3)
    t1 = pg.evaluate("() => window.__fraktal.JM.th"); time.sleep(1)
    check(pg.evaluate("() => window.__fraktal.JM.th") == t1, 'Morph aus: c bleibt stehen')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_K(p):
    print('K  Burning Ship/Tricorn: Staub-Korrektur; Sehenswürdigkeiten der Klassiker')
    from PIL import Image
    import numpy as np, io
    a = App(p).open(); pg = a.page
    pg.goto('about:blank'); a.open('m=2&x=-1.41445312500&y=-0.167968750000&z=192')
    a.wait_done(60); time.sleep(0.8)
    def grain():
        g = np.asarray(Image.open(io.BytesIO(pg.screenshot())).convert('L')).astype(float)
        h, w = g.shape
        return g[int(h * 0.25):int(h * 0.45), 0:int(w * 0.4)].std()
    g1 = grain()
    used = pg.evaluate("() => { const A = window.__fraktal; return [A.look().dust, A.deActive()]; }")
    res['K'] = {'koernung_still': round(g1, 1)}
    check(used == [True, True] and g1 < 20, f'Staubzone im Stillstand ruhig (Streuung {g1:.1f}, ohne Korrektur ~37)')
    # Sehenswürdigkeiten: jede klassische Welt hat 3–6 Orte mit Vorschaubild, Tour landet
    n = pg.evaluate("() => { const S = window.__fraktal.SIGHTS; return [0, 1, 2, 3, 4, 5].map(f => (S[f] || []).length); }")
    check(all(3 <= k <= 6 for k in n), f'Orte je Klassiker {n}')
    miss = [k for k in pg.evaluate("() => [0, 1, 2, 3, 4, 5].flatMap(f => window.__fraktal.SIGHTS[f].map(s => s.k))") if not os.path.exists(os.path.join(os.path.dirname(__file__), '..', 'assets', 'sights', k + '.jpg'))]
    check(not miss, f'Vorschaubilder vorhanden {miss}')
    pg.evaluate("() => { const A = window.__fraktal; A.startTour(A.SIGHTS[1][0]); }"); time.sleep(10)
    st = pg.evaluate("() => { const A = window.__fraktal, s = A.SIGHTS[1][0]; return [A.S.formula, A.HP.toNumber(A.S.julia.x) - +s.jx, A.HP.toNumber(A.S.julia.y) - +s.jy, A.S.cam.zoom / s.zoom]; }")
    check(st[0] == 1 and abs(st[1]) < 1e-9 and abs(st[2]) < 1e-9 and abs(st[3] - 1) < 0.02, f'Tour zur Julia-Sehenswürdigkeit: c und Zoom übernommen {st}')
    # Ort einer 3D-Welt aus tiefem 2D-Zoom: keine Meldung „Maximale Tiefe“ (bis 7.1.4 fälschlich)
    pg.goto('about:blank'); a.open('m=0&x=-0.7453&y=0.1127&z=1e9'); time.sleep(1)
    pg.evaluate("() => { const A = window.__fraktal; A.goTo(A.SIGHTS[9][0]); }"); time.sleep(0.5)
    tx = pg.evaluate("() => document.getElementById('toast').className.includes('show') ? document.getElementById('toast').textContent : ''")
    n7 = pg.evaluate("() => [6, 7, 8, 9].map(f => window.__fraktal.SIGHTS[f].length)")
    check(tx == '' and all(3 <= k <= 6 for k in n7), f'Ort im Menger-Schwamm aus Zoom 10⁹: keine Meldung {tx!r}; Orte 3D/Buddhabrot {n7}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


with sync_playwright() as p:
    for k, fn in [('A', case_A), ('B', case_B), ('C', case_C), ('D', case_D), ('E', case_E), ('F', case_F), ('G', case_G), ('H', case_H), ('I', case_I), ('J', case_J), ('K', case_K)]:
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
