#!/usr/bin/env python3
"""6.8: Rückwärtsflug in 2D und 3D (Pixel 7, echte GPU).

Prüft:  * Tempo-Regler −1,5 … +1,5 rastet bei 0 ein, Symbol ⏪ ⏸ ⏩; ⇄ in der Flug-Leiste; Taste R = Richtung, ↑/↓ = Tempo
        * 2D: vorwärts 12 s, dann ⇄: der Zoom fällt nach dem Richtungswechsel monoton, hält exakt bei Zoom 1 („Ganz draußen“,
          der Flug bleibt an), keine NaN; Richtungswechsel ohne Ruck (Zoomschritt und Seitenschritt je Bild ändern sich stetig);
          der Rückflug folgt dem Weg des Hinflugs (Abstand der Bildmitte bei gleichem Zoom); Bildrate rückwärts ≥ vorwärts − 10 %
        * Ziel-Flug (Orte) rückwärts: zurück bis zum Start-Zoom 1 auf demselben Weg, vorwärts wieder exakt am Ziel
        * 3D: Bodenabstand nie unter dem Minimum (vorwärts wie rückwärts), Kurs folgt dem Hinflug, Rückflug-Ebenen werden
          gerechnet und das Gelände hinter der Kamera (unterer Bildrand) ist gedeckt; Umdrehen dreht den Blick um 180°
        * ?rueck=0: kein ⇄, Regler 0,1–1,5 wie bis 6.7
        * 0 Fehler
Aufruf: python3 tests/test_rueck.py   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), 'results_rueck_v680.json')
SHOTS = os.path.join(os.path.dirname(__file__), 'shots', 'v68')

# Aufzeichnung je Bild im Seitenkontext: Zeit, log10(Zoom), Seitenschritt der Mitte (Bildhälften), Kurs, Tempo
REC_JS = """() => { const A = window.__fraktal; const R = window.__rec = { on: true, f: [], fwd: [] };
  let prev = null;
  const tick = (t) => { if (!R.on) return; requestAnimationFrame(tick);
    const c = A.S.cam, u = 1.5 / c.zoom;
    const e = { t, lz: Math.log10(c.zoom), dx: prev ? A.HP.toNumber(c.cx - prev.cx) / u : 0, dy: prev ? A.HP.toNumber(c.cy - prev.cy) / u : 0,
                h: A.V3.heading, sp: A.FLY.sp, out: !!A.FLY.out, on: A.FLY.on, nan: !isFinite(c.zoom) || !isFinite(A.HP.toNumber(c.cx)) || !isFinite(A.HP.toNumber(c.cy)) };
    if (prev && e.lz === prev.lz && e.dx === 0 && e.dy === 0 && t - prev.t < 1) return;   // doppeltes rAF
    R.f.push(e);
    if (A.FLY.sp > 0) R.fwd.push({ lz: e.lz, cx: c.cx, cy: c.cy, h: A.V3.heading });
    else if (A.FLY.sp < 0 && R.fwd.length) {   // Abstand zum Hinflug bei gleichem Zoom (nächster Eintrag)
      let lo = 0, hi = R.fwd.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R.fwd[m].lz <= e.lz) lo = m; else hi = m; }
      const q = Math.abs(R.fwd[hi].lz - e.lz) < Math.abs(R.fwd[lo].lz - e.lz) ? R.fwd[hi] : R.fwd[lo];
      if (Math.abs(q.lz - e.lz) < 0.02) { e.dev = Math.hypot(A.HP.toNumber(c.cx - q.cx), A.HP.toNumber(c.cy - q.cy)) / u; let d = A.V3.heading - q.h; d = Math.atan2(Math.sin(d), Math.cos(d)); e.dh = Math.abs(d); }
    }
    prev = { cx: c.cx, cy: c.cy, lz: e.lz, t };
  };
  requestAnimationFrame(tick); return true; }"""


def frames(pg):
    return pg.evaluate("() => window.__rec.f.map(e => [e.t, e.lz, e.dx, e.dy, e.h, e.sp, e.out, e.on, e.nan, e.dev === undefined ? null : e.dev, e.dh === undefined ? null : e.dh])")


def fps_of(fr):
    if len(fr) < 10:
        return None
    return round((len(fr) - 1) / ((fr[-1][0] - fr[0][0]) / 1000), 1)


def jerk(fr, t0, t1):
    """größte Änderung des Zoomschritts (log10/Bild) und des Seitenschritts (Bildhälften/Bild) zwischen zwei Bildern,
    bezogen auf 1/60 s (Bildzeit-Schwankungen herausgerechnet)"""
    w = [f for f in fr if t0 <= f[0] <= t1]
    mz = ml = 0.0
    for a, b, c in zip(w, w[1:], w[2:]):
        dta, dtb = (b[0] - a[0]) / 1000, (c[0] - b[0]) / 1000
        if dta <= 0 or dtb <= 0:
            continue
        vz0, vz1 = (b[1] - a[1]) / dta, (c[1] - b[1]) / dtb
        vl0, vl1 = (b[2] / dta, b[3] / dta), (c[2] / dtb, c[3] / dtb)
        mz = max(mz, abs(vz1 - vz0) / 60)
        ml = max(ml, math.hypot(vl1[0] - vl0[0], vl1[1] - vl0[1]) / 60)
    return mz, ml


def main():
    os.makedirs(SHOTS, exist_ok=True)
    res, ok, chk = {}, True, []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)
    errors = []
    with sync_playwright() as p:
        # ------------------------------------------------------------ 2D
        a = App(p).open(); pg = a.page
        a.set_view('-0.5', '0', 1); a.wait_done(60)
        pg.click('#btn-fly2d')
        time.sleep(0.5)
        need(pg.is_visible('#btn-rev'), '2D-Flug: ⇄ in der Flug-Leiste sichtbar')
        mn, mx = pg.evaluate("() => [+$('r-speed').min, +$('r-speed').max]".replace('$(', 'document.getElementById('))
        need(mn == -1.5 and mx == 1.5, f'Tempo-Regler {mn} … {mx}')
        pg.evaluate(REC_JS)
        time.sleep(12)
        z_fwd = pg.evaluate("() => __fraktal.S.cam.zoom")
        t_rev = pg.evaluate("() => performance.now()")
        pg.click('#btn-rev')
        # zurück bis ganz draußen (bei Tempo 0,5 ≈ 2 Zehnerpotenzen pro 4 s + weiches Anhalten)
        t0 = time.time()
        while time.time() - t0 < 60 and not pg.evaluate("() => __fraktal.FLY.out"):
            time.sleep(0.5)
        time.sleep(1.5)
        toast = pg.evaluate("() => document.getElementById('toast').textContent")
        st = pg.evaluate("() => { const A = __fraktal; return { zoom: A.S.cam.zoom, out: A.FLY.out, on: A.FLY.on, sp: A.FLY.sp, revJobs: A.RC.revJobs || 0 }; }")
        fr = frames(pg)
        pg.evaluate("() => { window.__rec.on = false; }")
        fwd = [f for f in fr if f[5] > 0.45 and f[0] < t_rev]
        ramp_end = t_rev + 700
        rev = [f for f in fr if f[0] > ramp_end and not f[6]]
        res['2d'] = {'zoom_fwd': z_fwd, 'end': st, 'toast': toast, 'n_frames': len(fr)}
        need(z_fwd > 1e4, f'2D vorwärts 12 s: Zoom {z_fwd:.3g}')
        need(not any(f[8] for f in fr), '2D: keine NaN in Kamera')
        incs = [b[1] - a_[1] for a_, b in zip(rev, rev[1:]) if b[1] - a_[1] > 1e-12]
        need(len(rev) > 100 and not incs, f'2D rückwärts: Zoom fällt monoton ({len(rev)} Bilder, {len(incs)} Anstiege)')
        need(abs(st['zoom'] - 1) < 1e-9 and st['out'] and st['on'], f"2D: hält bei Zoom 1 (Zoom {st['zoom']:.12g}, ganz draußen {st['out']}, Flug an {st['on']})")
        need('draußen' in toast, f'Hinweis „Ganz draußen“: {toast!r}')
        # Richtungswechsel ohne Ruck: Fenster ±1 s um den Wechsel; harter Wechsel wäre ein Zoomsprung von 2·0,5/60 = 0,0167
        jz, jl = jerk(fr, t_rev - 1000, t_rev + 1500)
        jz_f, jl_f = jerk(fr, t_rev - 5000, t_rev - 1000)
        res['2d']['jerk'] = {'zoom_wechsel': jz, 'seite_wechsel': jl, 'zoom_vorwaerts': jz_f, 'seite_vorwaerts': jl_f}
        need(jz < 0.002, f'Richtungswechsel: größte Änderung des Zoomschritts {jz:.5f} (log10/Bild; harter Wechsel 0,0167, vorwärts {jz_f:.5f})')
        need(jl < max(0.004, 2 * jl_f), f'Richtungswechsel: größte Änderung des Seitenschritts {jl:.5f} Bildhälften/Bild (vorwärts {jl_f:.5f})')
        devs = sorted(f[9] for f in rev if f[9] is not None and f[1] > 0.3)
        if devs:
            med, p95 = devs[len(devs) // 2], devs[int(len(devs) * 0.95)]
            res['2d']['weg'] = {'median': med, 'p95': p95, 'n': len(devs)}
            need(med < 0.05 and p95 < 0.15, f'Rückflug auf dem Weg des Hinflugs: Abstand der Mitte Median {med:.4f}, 95 % {p95:.4f} Bildhälften')
        else:
            need(False, 'Rückflug: keine Vergleichswerte zum Hinflug')
        f_fwd, f_rev = fps_of(fwd), fps_of(rev)
        res['2d']['fps'] = {'vorwaerts': f_fwd, 'rueckwaerts': f_rev}
        need(f_rev and f_fwd and f_rev >= f_fwd * 0.9, f'Bildrate rückwärts {f_rev} ≥ vorwärts {f_fwd} − 10 %')
        need(st['revJobs'] > 0, f"Rückflug-Ebenen (gröber, weiter) vorausgerechnet: {st['revJobs']}")
        pg.screenshot(path=os.path.join(SHOTS, 'rueck_2d_draussen.jpg'), type='jpeg', quality=80)
        # Regler: einrasten bei 0, Symbol
        sym = []
        for v in (0.03, -0.8, 0.6):
            pg.evaluate("v => { const r = document.getElementById('r-speed'); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }", v)
            sym.append(pg.evaluate("() => [__fraktal.S.flySpeed, document.getElementById('speed-icon').textContent]"))
        res['regler'] = sym
        need(sym[0] == [0, '⏸'] and sym[1] == [-0.8, '⏪'] and sym[2] == [0.6, '⏩'], f'Regler: 0,03 → 0 ⏸, −0,8 ⏪, 0,6 ⏩: {sym}')
        time.sleep(1.5)
        z1 = pg.evaluate("() => __fraktal.S.cam.zoom")
        pg.keyboard.press('r'); time.sleep(1.2)
        k1 = pg.evaluate("() => [__fraktal.S.flySpeed, __fraktal.FLY.sp]")
        pg.keyboard.press('ArrowDown'); k2 = pg.evaluate("() => __fraktal.S.flySpeed")
        need(z1 > 1.5 and abs(k1[0] + 0.6) < 1e-9 and abs(k1[1] + 0.6) < 0.05 and abs(k2 + 0.7) < 1e-9, f'Taste R: Tempo 0,6 → {k1[0]} (ist {k1[1]:.2f}), Pfeil ↓ → {k2}')
        pg.evaluate("() => __fraktal.stopFly()")
        # ------------------------------------------------------------ Ziel-Flug (Orte) rückwärts und wieder vorwärts
        tgt = {'cx': '-0.743643887037151', 'cy': '0.131825904205330', 'zoom': 1e6, 'formula': 0}
        pg.evaluate("p => { __fraktal.setFlySpeed(1.0); __fraktal.startFly(p); }", tgt)
        time.sleep(3.5)
        zp = pg.evaluate("() => __fraktal.S.cam.zoom")
        pg.evaluate("() => __fraktal.reverseFly()")
        t0 = time.time()
        while time.time() - t0 < 30 and not pg.evaluate("() => __fraktal.FLY.out"):
            time.sleep(0.3)
        back = pg.evaluate("() => { const A = __fraktal; return { zoom: A.S.cam.zoom, cx: A.HP.toNumber(A.S.cam.cx), cy: A.HP.toNumber(A.S.cam.cy), out: A.FLY.out }; }")
        pg.evaluate("() => __fraktal.reverseFly()")
        t0 = time.time()
        while time.time() - t0 < 40 and pg.evaluate("() => __fraktal.FLY.on"):
            time.sleep(0.3)
        land = pg.evaluate("() => { const A = __fraktal; return [A.HP.toString(A.S.cam.cx, 15), A.HP.toString(A.S.cam.cy, 15), A.S.cam.zoom]; }")
        res['ort'] = {'zoom_vor_wechsel': zp, 'zurueck': back, 'landung': land}
        need(zp > 3 and back['out'] and abs(back['zoom'] - 1) < 1e-9 and abs(back['cx'] + 0.5) < 1e-6 and abs(back['cy']) < 1e-6,
             f"Ziel-Flug rückwärts zurück zum Start (Zoom 1, Mitte −0,5/0): {back}")
        need(abs(land[2] - 1e6) < 1e-3 and land[0] == tgt['cx'] and land[1] == tgt['cy'], f'… danach vorwärts exakt am Ziel gelandet: {land}')
        errors += a.errors
        a.close()

        # ------------------------------------------------------------ 3D (Seepferdchen-Tal)
        res['3d'] = {}
        for revpf in ('1', '0'):
            a = App(p, query='nosw&noanim' + ('&revpf=0' if revpf == '0' else '')).open(); pg = a.page
            a.set_view('-0.7436', '0.1318', 300); a.wait_done(60)
            pg.evaluate("() => { __fraktal.setFlySpeed(0.5); __fraktal.startFly(undefined, { d3: true }); }")
            need(a.wait_3d(40), f'3D-Flug startet (revpf={revpf})')
            pg.evaluate(REC_JS)
            clr_f, clr_r, cov_r = [], [], []
            for i in range(40):
                time.sleep(0.25)
                c = pg.evaluate("() => __fraktal.clearance()")
                if c and c['n'] > 10: clr_f.append(c['clear'])
            t_rev = pg.evaluate("() => performance.now()")
            z3 = pg.evaluate("() => __fraktal.S.cam.zoom")
            pg.evaluate("() => __fraktal.reverseFly()")
            # unterer Bildrand = Gelände, das rückwärts zuerst ins Bild kommt (Bodenpunkte aus der 3D-Kamera)
            COV = """() => { const A = __fraktal, c = A.T3.lastCam; if (!c) return null; const pts = [];
                     for (let i = 0; i <= 8; i++) { const g = A.T3.groundAt(c, i / 4 - 1, -0.98); if (g) pts.push([g[0], g[1]]); }
                     return A.coverAt(pts); }"""
            for i in range(48):
                time.sleep(0.25)
                c = pg.evaluate("() => __fraktal.clearance()")
                if c and c['n'] > 10: clr_r.append(c['clear'])
                if i >= 4:
                    cv = pg.evaluate(COV)
                    if cv: cov_r += cv
            st3 = pg.evaluate("() => { const A = __fraktal; return { zoom: A.S.cam.zoom, revJobs: A.RC.revJobs || 0, v3: A.V3.on, fps: A.status().fps }; }")
            fr = frames(pg)
            pg.evaluate("() => { window.__rec.on = false; }")
            rev = [f for f in fr if f[0] > t_rev + 700]
            fwd = [f for f in fr if f[0] < t_rev]
            dh = sorted(f[10] for f in rev if f[10] is not None)
            gap = sum(1 for v in cov_r if v == 0) / max(1, len(cov_r))
            kmean = sum(cov_r) / max(1, len(cov_r))
            r = {'zoom_vorwaerts': z3, 'end': st3, 'clear_min_vorwaerts': min(clr_f) if clr_f else None, 'clear_min_rueckwaerts': min(clr_r) if clr_r else None,
                 'kurs_abw_median': dh[len(dh) // 2] if dh else None, 'kurs_abw_p95': dh[int(len(dh) * 0.95)] if dh else None,
                 'unten_luecken': gap, 'unten_schaerfe': kmean, 'n_unten': len(cov_r), 'fps_vorwaerts': fps_of(fwd), 'fps_rueckwaerts': fps_of(rev)}
            res['3d']['revpf' + revpf] = r
            print(json.dumps(r), flush=True)
            if revpf == '1':
                incs = [b[1] - a_[1] for a_, b in zip(rev, rev[1:]) if b[1] - a_[1] > 1e-12]
                need(z3 > 1e3 and st3['zoom'] < z3 / 10 and not incs, f"3D rückwärts: Zoom {z3:.3g} → {st3['zoom']:.3g}, monoton ({len(incs)} Anstiege)")
                need(clr_r and min(clr_r) >= 0.2 and min(clr_r) >= 0.8 * min(clr_f), f"3D Bodenabstand rückwärts min {min(clr_r):.3f} (vorwärts {min(clr_f):.3f}, Minimum 0,2)")
                need(dh and dh[len(dh) // 2] < 0.05, f"3D Kurs folgt dem Hinflug: Abweichung Median {r['kurs_abw_median']:.4f} rad, 95 % {r['kurs_abw_p95']:.4f}")
                need(st3['revJobs'] > 0 and gap < 0.05, f"3D: Rückflug-Ebenen {st3['revJobs']}, unterer Bildrand (hinter der Kamera) Lücken {gap:.1%}, Schärfe Ø {kmean:.2f}")
                need(r['fps_rueckwaerts'] and r['fps_rueckwaerts'] >= 0.9 * r['fps_vorwaerts'], f"3D Bildrate rückwärts {r['fps_rueckwaerts']} ≥ vorwärts {r['fps_vorwaerts']} − 10 %")
                # Umdrehen
                pg.click('#btn-turn'); time.sleep(1.2)
                ta = pg.evaluate("() => [__fraktal.V3.turnA, document.getElementById('btn-turn').getAttribute('aria-pressed')]")
                pg.screenshot(path=os.path.join(SHOTS, 'rueck_3d_umgedreht.jpg'), type='jpeg', quality=80)
                h0 = pg.evaluate("() => __fraktal.V3.heading")
                pg.evaluate("() => __fraktal.stopFly()")
                h1 = pg.evaluate("() => [__fraktal.V3.heading, __fraktal.V3.turnA]")
                need(abs(ta[0] - math.pi) < 1e-6 and ta[1] == 'true' and abs(h1[0] - h0 - math.pi) < 0.05 and h1[1] == 0,
                     f'Umdrehen: Blick +180° ({ta[0]:.4f}), nach dem Flug zeigt die Ansicht weiter dorthin ({h1})')
            errors += a.errors
            a.close()
        r1, r0 = res['3d']['revpf1'], res['3d']['revpf0']
        print(f"A/B hinter der Kamera: mit Rückflug-Ebenen Lücken {r1['unten_luecken']:.1%} Schärfe {r1['unten_schaerfe']:.2f} · ohne {r0['unten_luecken']:.1%} Schärfe {r0['unten_schaerfe']:.2f}", flush=True)

        # ------------------------------------------------------------ ?rueck=0
        a = App(p, query='nosw&noanim&rueck=0').open(); pg = a.page
        a.set_view('-0.5', '0', 1); a.wait_done(60)
        pg.click('#btn-fly2d'); time.sleep(1)
        r0 = pg.evaluate("() => [document.getElementById('btn-rev').hidden, +document.getElementById('r-speed').min, __fraktal.RUECK]")
        pg.keyboard.press('r'); time.sleep(0.8)
        sp = pg.evaluate("() => __fraktal.FLY.sp")
        need(r0 == [True, 0.1, False], f'?rueck=0: kein ⇄, Regler ab 0,1: {r0}')
        need(sp > 0, f'?rueck=0: Taste R kehrt nicht um (Tempo {sp:.2f})')
        errors += a.errors
        a.close()
    need(not errors, f'Fehler: {errors[:3]}')
    res['checks'] = chk
    with open(OUT, 'w') as f:
        json.dump(res, f, indent=1, ensure_ascii=False)
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
