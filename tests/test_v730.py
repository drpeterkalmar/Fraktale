#!/usr/bin/env python3
"""7.3.0 – Exoten über 2000× auf der Grafikkarte in emulierter doppelter Genauigkeit (df64), Wahrheitstest am Mac (echte GPU).

  A  Selbsttest der df64-Bausteine besteht (größter Fehler ≤ 16 · 2^-48), Rechenweg je Zoom: f32 bis 2000× (Lyapunov 600×),
     darüber gpu/df64, solange ein Pixel ≥ 10⁻¹³ breit ist (480×360: bis 8,3·10¹⁰), darüber CPU; Multibrot mit gebrochenem Exponenten (und Morph) bleibt auf der CPU; ?df64=0 = CPU
  B  Wahrheit: je Exot (Phoenix Julia/Mandel, Nova Mandel/Julia, Magnet I/II, Lyapunov, Multibrot 5) 3 Randstellen (per
     Bisektion mit fractal-core.js f64 gefunden, Nova: Zoom-Wanderung zur langsamsten Konvergenz) bei 10⁴, 10⁶, 10⁹ und an der
     df64-Grenze 8·10¹⁰ (Pixel 1,04·10⁻¹³; am Handy entspricht das ~1,2·10¹⁰): GPU-df64-
     Iterationswerte gegen CPU-f64 an 500 Stichproben, gleich (±1, Lyapunov ±0,25; innen/außen gleich) bei ≥ 99 % der gut bestimmten
     Pixel (f64-Wert ändert sich nicht, wenn die Bahn je Schritt auf 42 bit gerundet wird – siehe CMP); in Zufallszonen, in denen
     schon eine weitere 42-bit-Rechnung keine 99 % schafft, höchstens 1 Punkt darunter; roh mitgeschrieben
  C  Farbe: je Exot und Zoom die erste Stelle als Screenshot (480×360) mit GPU-df64 und mit dem Prozessor (f64): mittlere
     Abweichung ≤ 2/255 je Kanal (Zufallszonen – in B weniger als die Hälfte der Pixel bestimmt – nur gemessen)
  D  Gleiches Aussehen wie f32 bei kleinem Zoom (?df64min=0.01: df64 schon ab 0,01×): Startansicht jedes Exoten df64 gegen f32,
     mittlere Abweichung ≤ 2/255 (Glättung, Konvergenz-μ, Lyapunov-λ, Distanzschätzung, Färbe-Stil Streifen); weicht f32 mehr ab,
     muss df64 dem Prozessor (f64) gleichen und näher an ihm liegen als f32 (Magnet II: f32 schon bei 0,55× 2/255 daneben)
  E  Handy-Profil (Pixel 7): Phoenix 10⁵ und Magnet 10⁷ rechnen df64 fertig, keine Fehler; Rechenzeit GPU-df64 vs. CPU
Aufruf: python3 tests/test_v730.py [--only=A,B,…] [--zooms=1e4,1e6,1e9] [--exo=Phoenix,Nova …]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
EXOF = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--exo=')), None)   # Teilauswahl nach Namensanfang
ZOOMS = next(([float(x) for x in a.split('=', 1)[1].split(',')] for a in sys.argv if a.startswith('--zooms=')), [1e4, 1e6, 1e9, 8e10])
OUT = os.path.join(os.path.dirname(__file__), 'results_v730.json')
fails, res = [], {}
SMALL = {'viewport': {'width': 480, 'height': 360}, 'screen': {'width': 480, 'height': 360}, 'device_scale_factor': 1, 'is_mobile': False, 'has_touch': False}

# Exoten: Name, Link (Welt + Parameter), Rechen-Formel
EXOS = [('Phoenix Julia', 'm=11&x=0&y=0&z=0.45', 24), ('Phoenix Mandel', 'm=11&x=0&y=0&z=0.6&wp=v1', 24),
        ('Nova Mandel', 'm=12&x=-0.3&y=0&z=0.8', 25), ('Nova Julia', 'm=12&x=0&y=0&z=1&wp=v1', 25),
        ('Magnet I', 'm=13&x=1.2&y=0&z=0.55', 26), ('Magnet II', 'm=13&x=1.2&y=0&z=0.55&wp=v1', 27),
        ('Lyapunov AB', 'm=10&x=3&y=3&z=1.5', 28), ('Multibrot 5', 'm=4&x=0&y=0&z=1&wp=e5', 23)]
if EXOF:
    EXOS = [e for e in EXOS if any(e[0].startswith(x) for x in EXOF)]


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    if not cond:
        fails.append(msg)


# Randstellen: zufällige Punktpaare der Startansicht mit verschiedener Klasse (innen/außen bzw. konvergiert/nicht, Lyapunov λ ≥ 0/< 0),
# 64 Bisektionsschritte in f64 -> Punkt auf dem Rand (mit der Iterationszahl des tiefsten Zooms)
SCOUT = """([seed, maxIter, npts]) => {
    const A = window.__fraktal, C = window.FKCore, cf = A.cformula();
    C.xpSetup(A.xparams(cf)); C.stSetup(0);
    const hm = A.homeOf(A.S.formula), x0 = +hm[0], y0 = +hm[1], z0 = hm[2];
    const H = 1.5 / z0, W = H * innerWidth / innerHeight;
    const cls = (x, y) => C.directPixel(x, y, cf, maxIter, 0, 0, 0, false) < 0 ? 0 : 1;
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const pts = [];
    for (let k = 0; k < 600 && pts.length < npts; k++) {
        const ax = x0 + (2 * rnd() - 1) * W * 0.8, ay = y0 + (2 * rnd() - 1) * H * 0.8;
        const bx = ax + (rnd() - 0.5) * W * 0.3, by = ay + (rnd() - 0.5) * H * 0.3;
        const ca = cls(ax, ay);
        if (ca === cls(bx, by)) continue;
        let px = ax, py = ay, qx = bx, qy = by;
        for (let i = 0; i < 64; i++) { const mx = (px + qx) / 2, my = (py + qy) / 2; if (cls(mx, my) === ca) { px = mx; py = my; } else { qx = mx; qy = my; } }
        if (pts.some(p => Math.hypot(p[0] - px, p[1] - py) < 0.08 * H)) continue;
        pts.push([px, py]);
    }
    return pts.map(p => [p[0].toFixed(18), p[1].toFixed(18)]);
}"""

# GPU-Werte des fertigen Bildes gegen fractal-core.js (f64) an n Stichproben. Gut bestimmt = der f64-Wert bleibt gleich, wenn die
# Bahn (und die Koordinate) nach jedem Schritt auf QBITS = 42 bit Mantisse gerundet wird – drei verschiedene Rundungsgitter (XP.q,
# nur Test). df64 trägt 48 bit, verliert je Schritt aber einige Einheiten (5–15 Rechenschritte, ~2^-44); 42 bit lässt Spielraum.
# Wo schon diese Rundung den Wert ändert, ist jede Rechnung dieser Genauigkeit Zufall (Lehre 2 im Skill) – gemessen am Rand von
# Magnet I: Pixel, deren Bahn ~1000 Schritte umherirrt, liefern mit f64, df64 (GPU), df64 (bitgenau nachgerechnet), 45/40/30 bit
# lauter verschiedene Werte; selbst f64 gegen double-double liegt am Phoenix-Rand bei 10⁹ nur bei 98 %
QBITS = 42
CMP = """([n, seed, QBITS]) => {
    const A = window.__fraktal, f = A.RC.front, C = window.FKCore, HP = A.HP;
    const all = A.R.readIterSync(f.buf), w = f.buf.w, h = f.buf.h;
    C.xpSetup(f.X || null); C.stSetup(0);
    const cx = HP.toNumber(f.view.cx), cy = HP.toNumber(f.view.cy), tol = f.formula === 28 ? 0.25 : 1;
    const qb = (o) => (v) => { if (v === 0 || !(Math.abs(v) < 1e300)) return v; const s = Math.pow(2, QBITS - 1 - Math.floor(Math.log2(Math.abs(v)))); return (Math.round(v * s + o) - o) / s; };
    const QA = qb(0), QB = qb(0.37), QC = qb(0.71), QD = qb(0.13);
    const same = (a, b) => (a < 0 && b < 0) || (a >= 0 && b >= 0 && Math.abs(a - b) <= tol);
    const P = (x, y, q) => { C.XP.q = q || null; const r = C.directPixel(q ? q(x) : x, q ? q(y) : y, f.formula, f.maxIter, 0, 0, 0, false); C.XP.q = null; return r; };
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    let tot = 0, ok = 0, cond = 0, okc = 0, ok4 = 0, inside = 0, maxd = 0, vals = new Set(), bad = new Array(12).fill(0), badv = [];
    for (let k = 0; k < n; k++) {
        const i = Math.floor(rnd() * w), j = Math.floor(rnd() * h);
        const g = all[j * w + i];
        const px = cx + (i + 0.5 - w / 2) * f.scale, py = cy + (j + 0.5 - h / 2) * f.scale;
        const c = P(px, py);
        tot++; if (c < 0) inside++;
        vals.add(Math.round(c * 4));
        const eq = same(g, c);
        if (eq) ok++; else { bad[Math.floor(j / h * 12)]++; if (badv.length < 8) badv.push([j, +g.toFixed(3), +c.toFixed(3)]); }
        if (same(c, P(px, py, QA)) && same(c, P(px, py, QB)) && same(c, P(px, py, QC))) {
            cond++; if (same(c, P(px, py, QD))) ok4++;
            if (eq) okc++; else if (g >= 0 && c >= 0) maxd = Math.max(maxd, Math.abs(g - c));
        }
    }
    return { raw: +(ok / tot).toFixed(4), cond: +(cond / tot).toFixed(3), ok: cond ? +(okc / cond).toFixed(4) : 1, ref: cond ? +(ok4 / cond).toFixed(4) : 1, n: tot, inside: +(inside / tot).toFixed(3), distinct: vals.size,
             maxd: +maxd.toFixed(2), bad, badv, chunks: f.chunks || null, gpuMs: Math.round(f.gpuMs || 0), kind: f.kind, mode: f.mode, formula: f.formula, maxIter: f.maxIter, ms: Math.round(f.ms) };
}"""

# Nova (kaum „nicht konvergiert“): Zoom-Wanderung zur langsamsten Konvergenz – Fenster je Stufe ÷ 4, 160 Stichproben, größtes μ
WALK = """([seed, maxIter, npts, zEnd]) => {
    const A = window.__fraktal, C = window.FKCore, cf = A.cformula();
    C.xpSetup(A.xparams(cf)); C.stSetup(0);
    const hm = A.homeOf(A.S.formula);
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const pts = [];
    for (let k = 0; k < npts; k++) {
        let x = +hm[0], y = +hm[1], H = 1.5 / hm[2] * 0.9;
        while (H > 1.5 / zEnd) {
            let best = -1, bx = x, by = y;
            for (let i = 0; i < 160; i++) {
                const px = x + (2 * rnd() - 1) * H * innerWidth / innerHeight, py = y + (2 * rnd() - 1) * H;
                const v = C.directPixel(px, py, cf, maxIter, 0, 0, 0, false);
                if (v > best) { best = v; bx = px; by = py; }
            }
            x = bx; y = by; H /= 4;
        }
        pts.push([x.toFixed(18), y.toFixed(18)]);
    }
    return pts;
}"""

# Screenshot (ohne Beschriftung) mit dem aktuellen Rechenweg und mit dem Prozessor; mittlere Abweichung je Kanal
SHOTCMP = """async ([o, other]) => {
    const A = window.__fraktal;
    const dec = async (b) => { const bm = await createImageBitmap(b); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height); };
    const t0 = performance.now(); const r1 = await A.captureShot(o); const t1 = performance.now();
    const keep = A.S.renderer; other(); A.invalidate();
    const r2 = await A.captureShot(o); const t2 = performance.now();
    A.S.renderer = keep; A.invalidate();
    const a = await dec(r1.blob), b = await dec(r2.blob);
    let sum = 0, mx = 0, n2 = 0, lit = 0;
    for (let i = 0; i < a.data.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(a.data[i + k] - b.data[i + k]); sum += d; mx = Math.max(mx, d); if (d > 2) n2++; if (a.data[i + k] > 40) lit++; }
    const nv = a.width * a.height * 3;
    return { mean: +(sum / nv).toFixed(3), max: mx, over2: +(n2 / nv).toFixed(4), lit: +(lit / nv).toFixed(3), dev1: r1.dev, mode1: r1.mode, dev2: r2.dev, mode2: r2.mode, ms1: Math.round(t1 - t0), ms2: Math.round(t2 - t1) };
}"""
TO_CPU = "() => { window.__fraktal.S.renderer = 'cpu'; }"


def shotcmp(pg, other_js):
    js = SHOTCMP.replace('other();', '(' + other_js + ')();')
    return pg.evaluate(js, [{'W': 480, 'H': 360, 'label': False}, None])


def zs(z):
    return ('%.6g' % z).replace('+', '')


def open_view(a, link, cx, cy, z, timeout=300):
    a.page.goto('about:blank')
    a.open(link.split('&x=')[0] + f'&x={cx}&y={cy}&z={zs(z)}' + ('&wp=' + link.split('&wp=')[1] if '&wp=' in link else ''))
    a.page.evaluate("() => { window.__fraktal.S.particles = false; window.__fraktal.invalidate(); }")
    return a.wait_done(timeout)


def case_A(p):
    print('A  Selbsttest + Rechenweg je Zoom')
    a = App(p, extra_ctx=SMALL).open('m=11&x=0&y=0&z=0.45'); pg = a.page
    a.wait_done(60)
    for _ in range(50):
        st = a.status()
        if st['df64']['state'] in (2, -1):
            break
        time.sleep(0.1)
    res['A'] = {'df64': st['df64']}
    check(st['df64']['state'] == 2 and st['df64']['info']['worst'] <= 16, f"Selbsttest df64: Zustand {st['df64']['state']}, größter Fehler {st['df64']['info']} · 2^-48")
    plans = {}
    for name, link, z, want in [('Phoenix 1e3', 'm=11', 1e3, ('gpu', 'direct')), ('Phoenix 3e4', 'm=11', 3e4, ('gpu', 'df64')),
                                ('Phoenix 8e10', 'm=11', 8e10, ('gpu', 'df64')), ('Phoenix 9e10', 'm=11', 9e10, ('cpu', 'direct')),
                                ('Lyapunov 500', 'm=10', 500, ('gpu', 'direct')), ('Lyapunov 1e3', 'm=10', 1e3, ('gpu', 'df64')),
                                ('Lyapunov 8e10', 'm=10', 8e10, ('gpu', 'df64')), ('Lyapunov 2e11', 'm=10', 2e11, ('cpu', 'direct')), ('Nova 1e6', 'm=12', 1e6, ('gpu', 'df64')),
                                ('Magnet II 1e8', 'm=13&wp=v1', 1e8, ('gpu', 'df64')), ('Multibrot 5 1e5', 'm=4&wp=e5', 1e5, ('gpu', 'df64')),
                                ('Multibrot 3,5 1e5', 'm=4&wp=e3.5', 1e5, ('cpu', 'direct')), ('Burning Ship 1e5', 'm=2', 1e5, ('gpu', 'perturb'))]:
        pg.goto('about:blank')
        a.open(link.split('&wp=')[0] + f'&x=0.1&y=0.2&z={zs(z)}' + ('&wp=' + link.split('&wp=')[1] if '&wp=' in link else ''))
        pl = a.status()['plan']
        plans[name] = pl
        check((pl['kind'], pl['mode']) == want, f"{name}: {pl['kind']}/{pl['mode']} (Soll {want[0]}/{want[1]})")
    res['A']['plans'] = plans
    a.close()
    a = App(p, extra_ctx=SMALL, query='nosw&noanim&df64=0').open('m=11&x=0.1&y=0.2&z=3e4')
    pl = a.status()['plan']
    check((pl['kind'], pl['mode']) == ('cpu', 'direct'), f"?df64=0: Phoenix 3e4 {pl['kind']}/{pl['mode']} (Soll cpu/direct)")
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_B(p):
    print('B  Wahrheit df64-GPU gegen CPU-f64 (3 Randstellen × ' + ', '.join('%.0e' % z for z in ZOOMS) + ')')
    res['B'] = {}
    a = App(p, extra_ctx=SMALL, query='nosw&noanim&logchunks').open(); pg = a.page
    for name, link, cf in EXOS:
        pg.goto('about:blank'); a.open(link)
        seed = sum(map(ord, name)) * 97 + 7
        pts = pg.evaluate(WALK, [seed, 4050, 3, 1e9]) if cf == 25 else pg.evaluate(SCOUT, [seed, 4050, 3])
        res['B'][name] = {'pts': pts, 'views': []}
        check(len(pts) == 3, f'{name}: {len(pts)} Randstellen gefunden')
        for k, (x, y) in enumerate(pts):
            for z in ZOOMS:
                t, st = open_view(a, link, x, y, z)
                r = pg.evaluate(CMP, [500, 1000 + k, QBITS])
                r.update(loc=k, zoom=z, sec=round(t, 1))
                res['B'][name]['views'].append(r)
                want = 'df64' if z > (600 if cf == 28 else 2000) else 'direct'
                if 3 / (z * st['canvas'][1]) < 1e-13:
                    want = 'cpu-direct'
                # Soll: ≥ 99 % – in Zufallszonen (dort stimmt schon eine vierte 42-bit-Rechnung mit f64 nicht zu 99 % überein, ref)
                # höchstens 1 Punkt unter dieser Vergleichsrechnung: df64 rechnet dort so gut wie f64 mit 42 bit
                check((r['kind'] + '-' + r['mode'] == want if want.startswith('cpu') else r['mode'] == want and r['kind'] == 'gpu') and r['formula'] == cf and r['ok'] >= min(0.99, r['ref'] - 0.01) and not a.errors,
                      f"{name} Stelle {k + 1} {z:.0e}: {r['kind']}/{r['mode']}, gleich {r['ok'] * 100:.1f} % der gut bestimmten ({r['cond'] * 100:.0f} %; 42-bit-f64 {r['ref'] * 100:.1f} %), roh {r['raw'] * 100:.1f} %, "
                      f"innen {r['inside'] * 100:.0f} %, {r['distinct']} Stufen, max Δ {r['maxd']}, {r['sec']} s {a.errors[:2]}")
                a.errors.clear()
        json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    a.close()


def case_C(p):
    print('C  Farbe: Screenshot GPU-df64 gegen Prozessor (f64), erste Randstelle')
    res['C'] = {}
    a = App(p, extra_ctx=SMALL).open(); pg = a.page
    for name, link, cf in EXOS:
        pg.goto('about:blank'); a.open(link)
        seed = sum(map(ord, name)) * 97 + 7
        pts = (res.get('B', {}).get(name) or {}).get('pts') or (pg.evaluate(WALK, [seed, 4050, 1, 1e9]) if cf == 25 else pg.evaluate(SCOUT, [seed, 4050, 1]))
        x, y = pts[0]
        res['C'][name] = []
        for z in ZOOMS:
            open_view(a, link, x, y, z)
            r = shotcmp(pg, TO_CPU)
            # Zufallszone: weniger als die Hälfte der Pixel ist bei 42 bit bestimmt (Fall B, gleiche Stelle und Zoom) – dort sieht
            # auch f64 gegen f64 mit anderem Rundungsrauschen anders aus; nur mitgeschrieben
            bv = [v for v in (res.get('B', {}).get(name) or {}).get('views', []) if v['loc'] == 0 and v['zoom'] == z]
            zuf = bool(bv) and bv[0]['cond'] < 0.5
            r.update(zoom=z, zufall=zuf, cond=bv[0]['cond'] if bv else None)
            res['C'][name].append(r)
            check(r['dev1'] == 'gpu' and r['dev2'] == 'cpu' and (r['mean'] <= 2 or zuf) and not a.errors,
                  f"{name} {z:.0e}: {r['dev1']}/{r['mode1']} gegen {r['dev2']}/{r['mode2']}: mittlere Abweichung {r['mean']}/255, > 2: {r['over2'] * 100:.2f} %, max {r['max']}, "
                  f"Zeit GPU {r['ms1']} ms / CPU {r['ms2']} ms" + (f" – Zufallszone (bestimmt {bv[0]['cond'] * 100:.0f} %), nur Messung" if zuf else '') + f" {a.errors[:2]}")
            a.errors.clear()
        json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    a.close()


def case_D(p):
    print('D  df64 sieht bei kleinem Zoom aus wie f32 (?df64min=0.01)')
    res['D'] = {}
    a = App(p, extra_ctx=SMALL, query='nosw&noanim&df64min=0.01').open(); pg = a.page
    for name, link, cf in EXOS + [('Phoenix Julia Streifen', 'm=11&x=0&y=0&z=0.45', 24), ('Magnet I Kreis-Falle', 'm=13&x=1.2&y=0&z=0.55', 26)]:
        pg.goto('about:blank'); a.open(link)
        if 'Streifen' in name:
            pg.evaluate("() => { const A = window.__fraktal; A.S.style = 1; A.S.stMix = 0.85; A.invalidate(); }")
        if 'Kreis' in name:
            pg.evaluate("() => { const A = window.__fraktal; A.S.style = 4; A.S.stMix = 0.85; A.invalidate(); }")
        pg.evaluate("() => { window.__fraktal.S.particles = false; window.__fraktal.invalidate(); }")
        a.wait_done(120)
        # Gegenstück: f32 (df64 erst wieder über 2000×); weicht f32 ab, entscheidet der Prozessor (f64), wer recht hat
        r = shotcmp(pg, "() => window.__fraktal.df64min(0)")
        pg.evaluate("() => window.__fraktal.df64min(0.01)")
        rc = shotcmp(pg, TO_CPU)
        r['vsCPU'] = rc['mean']
        if r['mean'] > 2:
            pg.evaluate("() => window.__fraktal.df64min(0)")
            r['f32vsCPU'] = shotcmp(pg, TO_CPU)['mean']
            pg.evaluate("() => window.__fraktal.df64min(0.01)")
        res['D'][name] = r
        good = r['mean'] <= 2 or (rc['mean'] <= 2 and rc['mean'] < r.get('f32vsCPU', 0))
        check(r['mode1'] == 'df64' and r['mode2'] == 'direct' and rc['mode1'] == 'df64' and good and r['lit'] > 0.05 and not a.errors,
              f"{name}: {r['mode1']} gegen {r['mode2']}: mittlere Abweichung {r['mean']}/255, > 2: {r['over2'] * 100:.2f} %, max {r['max']}, hell {r['lit'] * 100:.0f} %; "
              f"df64 gegen CPU {rc['mean']}/255" + (f", f32 gegen CPU {r['f32vsCPU']}/255 (f32 ungenau, df64 = CPU)" if 'f32vsCPU' in r else '') + f" {a.errors[:2]}")
        a.errors.clear()
    a.close()


def case_E(p):
    print('E  Handy-Profil (Pixel 7): df64 fertig, keine Fehler')
    res['E'] = {}
    a = App(p).open(); pg = a.page
    for name, h in [('Phoenix 1e5', 'm=11&x=0.0507812500&y=0.4062500000&z=1e5'), ('Magnet I 1e7', 'm=13&x=0.0947088068&y=-1.0600142045&z=1e7')]:
        pg.goto('about:blank'); a.open(h)
        t, st = a.wait_done(240)
        res['E'][name] = {'sec': round(t, 1), 'plan': st['plan'], 'canvas': st['canvas'], 'lastFullMs': st['lastFullMs']}
        check(st['plan'] == {'kind': 'gpu', 'mode': 'df64'} and st['done'] and not a.errors,
              f"{name}: {st['plan']}, fertig in {t:.1f} s ({st['canvas'][0]}×{st['canvas'][1]}) {a.errors[:2]}")
        a.errors.clear()
    a.close()


def main():
    t0 = time.time()
    with sync_playwright() as p:
        for k, fn in [('A', case_A), ('B', case_B), ('C', case_C), ('D', case_D), ('E', case_E)]:
            if ONLY and k not in ONLY:
                continue
            fn(p)
            json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print(f'\n{len(fails)} Fehler · {time.time() - t0:.0f} s')
    for f in fails:
        print('  - ' + f)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
