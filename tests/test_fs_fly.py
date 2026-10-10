#!/usr/bin/env python3
"""6.8.1: Flug im Vollbild (Pixel 7, echte GPU) und im iPhone-Kino-Modus (WebKit).

Prüft je 2D- und 3D-Flug:
  * Flug starten → Vollbild an (+ Größenänderung wie beim Wegfallen der Adressleiste) → fliegen → Drehen quer → zurück hoch
    → Vollbild aus: der Flug läuft durchgehend (an, nie pausiert), Kamera-Delta je Bild ohne Sprung (größter Zoom- und
    Seitenschritt je Bild, größte Änderung des Schritts um die Größenänderungen gegenüber dem Flug ohne Vollbild), Bildrate
    im Vollbild wie ohne
  * im Vollbild bei ausgeblendetem HUD: Leertaste = Flug aus/an, R = Richtung, ↑ = Tempo; Doppeltipp = Flug aus/an, ein
    einfacher Tipp holt nur das HUD (Flug läuft weiter)
iPhone 13 (WebKit, Vollbild-Schnittstelle entfernt): 2D-Flug durch Kino-Modus an, Drehen, Kino-Modus aus – läuft durch.
Aufruf: FK_HEADED=1 python3 tests/test_fs_fly.py (Bildraten: headless drosselt macOS auf ~10 Bilder/s)   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App, BASE
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), 'results_fs_fly_v681.json')

# je Bild: Zeit, log10(Zoom), Seitenschritt der Mitte (Bildhälften der neuen Ansicht), Flug an/pausiert, Canvas-Größe
REC_JS = """() => { const A = window.__fraktal; const R = window.__rec = { on: true, f: [] };
  let prev = null;
  const tick = (t) => { if (!R.on) return; requestAnimationFrame(tick);
    const c = A.S.cam, u = 1.5 / c.zoom;
    if (prev && t - prev.t < 1) return;
    R.f.push([t, Math.log10(c.zoom), prev ? A.HP.toNumber(c.cx - prev.cx) / u : 0, prev ? A.HP.toNumber(c.cy - prev.cy) / u : 0,
              A.FLY.on ? 1 : 0, A.FLY.paused ? 1 : 0, A.R.canvas.width, A.R.canvas.height, +A.GOV.g.toFixed(3), +A.FLY.sp.toFixed(3), A.GOV.q == null ? null : +A.GOV.q.toFixed(3), +(A.RC.resizeT || 0).toFixed(1)]);
    prev = { cx: c.cx, cy: c.cy, t };
  };
  requestAnimationFrame(tick); return true; }"""


def frames(pg):
    return pg.evaluate("() => window.__rec.f")


def fps_of(fr):
    if len(fr) < 10:
        return None
    return round((len(fr) - 1) / ((fr[-1][0] - fr[0][0]) / 1000), 1)


def jerk(fr):
    """größte Änderung des Zoom- und Seitentempos zwischen zwei Bildern (je 1/60 s), wie test_rueck"""
    mz = ml = 0.0
    for a, b, c in zip(fr, fr[1:], fr[2:]):
        dta, dtb = (b[0] - a[0]) / 1000, (c[0] - b[0]) / 1000
        if dta <= 0 or dtb <= 0:
            continue
        mz = max(mz, abs((c[1] - b[1]) / dtb - (b[1] - a[1]) / dta) / 60)
        ml = max(ml, math.hypot(c[2] / dtb - b[2] / dta, c[3] / dtb - b[3] / dta) / 60)
    return mz, ml


def steps(fr):
    """größter Zoomschritt (log10) und Seitenschritt (Bildhälften) je Bild, längste Bildzeit (ms)"""
    sz = max((abs(b[1] - a[1]) for a, b in zip(fr, fr[1:])), default=0)
    sl = max((math.hypot(b[2], b[3]) for b in fr[1:]), default=0)
    gap = max((b[0] - a[0] for a, b in zip(fr, fr[1:])), default=0)
    return sz, sl, gap


def win(fr, t0, t1):
    return [f for f in fr if t0 <= f[0] <= t1]


def touch(cdp, typ, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def tap(cdp, x, y):
    touch(cdp, 'touchStart', [(x, y)]); touch(cdp, 'touchEnd', [])


def dtap(cdp, x, y):
    tap(cdp, x, y); time.sleep(0.04); tap(cdp, x, y)


def vp(cdp, w, h, dpr):
    """Ansichtsgröße per DevTools (im Vollbild lässt sich das Fenster nicht in der Größe ändern) – löst resize aus"""
    cdp.send('Emulation.setDeviceMetricsOverride', {'width': int(w), 'height': int(h), 'deviceScaleFactor': dpr, 'mobile': True,
             'screenOrientation': {'type': 'landscapePrimary' if w > h else 'portraitPrimary', 'angle': 90 if w > h else 0}})


def state(pg):
    return pg.evaluate("() => ({ hudless: document.body.classList.contains('hudless'), peek: document.body.classList.contains('hud-peek'), fs: !!document.fullscreenElement, on: __fraktal.FLY.on, paused: __fraktal.FLY.paused })")


def main():
    res, ok, chk, errors = {}, True, [], []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)
    with sync_playwright() as p:
        for d3 in (False, True):
            tag = '3D' if d3 else '2D'
            a = App(p).open(); pg = a.page
            cdp = a.ctx.new_cdp_session(pg)
            W0, H0, DPR = pg.evaluate("() => [innerWidth, innerHeight, devicePixelRatio]")
            a.set_view('-0.7453', '0.1127', 200); a.wait_done(60)
            if d3:
                pg.evaluate("() => __fraktal.set3d(true)")
                need(a.wait_3d(30), '3D eingeblendet')
                time.sleep(1.0)
                pg.click('#btn-fly')
            else:
                pg.click('#btn-fly2d')
            time.sleep(1.5)
            pg.evaluate(REC_JS)
            T = lambda: pg.evaluate("() => performance.now()")
            time.sleep(3.5)
            ev = {'fs_an': T()}
            pg.click('#btn-fullscreen')
            time.sleep(0.15)
            vp(cdp, W0, H0 + 56, DPR)        # Adressleiste fällt weg (echtes Handy)
            ev['groesse'] = T()
            time.sleep(4.0)
            ev['quer'] = T()
            vp(cdp, H0 + 56, W0, DPR)        # Drehen quer
            time.sleep(3.0)
            ev['hoch'] = T()
            vp(cdp, W0, H0 + 56, DPR)        # zurück hoch
            time.sleep(3.0)
            ev['fs_aus'] = T()
            st_in = state(pg)
            pg.keyboard.press('f')                                         # HUD ist ausgeblendet: Taste F verlässt das Vollbild
            time.sleep(0.15)
            vp(cdp, W0, H0, DPR)
            time.sleep(2.5)
            ev['ende'] = T()
            fr = frames(pg)
            pg.evaluate("() => { window.__rec.on = false; }")
            st_out = state(pg)
            need(st_in['fs'] and st_in['hudless'], f'{tag}: im Vollbild, HUD aus ({st_in})')
            need(not st_out['fs'], f'{tag}: Vollbild verlassen ({st_out})')
            run = win(fr, ev['fs_an'] - 3000, ev['ende'])
            sizes = sorted({(f[6], f[7]) for f in run})
            need(len(sizes) >= 3, f'{tag}: Canvas-Größe hat gewechselt {sizes}')
            off = [f for f in run if not f[4] or f[5]]
            need(len(run) > 200 and not off, f'{tag}: Flug läuft durchgehend ({len(run)} Bilder, {len(off)} ohne Flug/pausiert)')
            lz = [f[1] for f in run]
            need(lz[-1] > lz[0] + 0.5, f'{tag}: Zoom steigt weiter (log10 {lz[0]:.2f} → {lz[-1]:.2f})')
            base = win(fr, ev['fs_an'] - 3200, ev['fs_an'] - 100)
            fsw = win(fr, ev['groesse'] + 700, ev['fs_aus'])
            # um jede Größenänderung ±0,8 s
            evw = []
            for k in ('groesse', 'quer', 'hoch', 'fs_aus'):
                evw.append(win(fr, ev[k] - 800, ev[k] + 800))
            jb = jerk(base)
            je = [jerk(w) for w in evw]
            sb, se = steps(base), [steps(w) for w in evw]
            fb, ff = fps_of(base), fps_of(fsw)
            # Schonfrist nach jeder Größenänderung (RC.resizeT, auch schon beim Vollbild-Knopf): Flugschritt höchstens 1/30 s,
            # Tempo-Bremse hält ihren Wert
            rts = sorted({f[11] for f in run if f[11] > 0 and f[11] >= run[0][0]})
            hold = [f for f in run if any(0 <= f[0] - r < 600 for r in rts)]
            ghold = [[f[8] for f in run if 0 <= f[0] - r < 1500] for r in rts]
            jump = [(round(b[0] - a[0]), round(abs(b[1] - a[1]), 4), b[9]) for a, b in zip(run, run[1:]) if b in hold and abs(b[1] - a[1]) > abs(b[9]) / 30 * 1.1 + 1e-4]
            rate = lambda w: (w[-1][1] - w[0][1]) / ((w[-1][0] - w[0][0]) / 1000) if len(w) > 2 else None
            res[tag] = {'events': ev, 'sizes': sizes, 'fps': {'ohne_vollbild': fb, 'vollbild': ff}, 'jerk_base': jb, 'jerk_events': je,
                        'steps_base': sb, 'steps_events': se, 'n': len(run), 'gov_min': min(f[8] for f in run), 'lz': [lz[0], lz[-1]],
                        'resizes': len(rts), 'hold_frames': len(hold), 'jumps': jump, 'gov_hold': [[min(g), max(g)] for g in ghold if g],
                        'zoomtempo': {'ohne_vollbild': rate(base), 'vollbild': rate(fsw)}}
            if os.environ.get('FK_RAW'): res[tag]['raw'] = [f for f in run]
            jz_max = max(j[0] for j in je); jl_max = max(j[1] for j in je)
            need(len(rts) >= 4 and len(hold) > 20 and not jump, f'{tag}: {len(rts)} Größenänderungen, in den 0,6 s danach kein Bild mit Sprung ({len(hold)} Bilder, Zoomschritt ≤ Tempo/30 s; Sprünge: {jump[:3]})')
            gh = res[tag]['gov_hold']
            need(all(abs(a_ - b_) < 1e-6 for a_, b_ in gh), f'{tag}: Tempo-Bremse hält in den 1,5 s nach jeder Größenänderung ihren Wert ({gh})')
            print(f'   {tag}: größter Zoomschritt je Bild um die Größenänderungen {max(x[0] for x in se):.4f} (ohne Vollbild {sb[0]:.4f}, Ruckler des Testrechners eingeschlossen)')
            print(f'   {tag}: Tempo-Änderung je Bild um die Größenänderungen Zoom {jz_max:.5f} / Seite {jl_max:.5f} (ohne Vollbild {jb[0]:.5f} / {jb[1]:.5f})')
            zt = res[tag]['zoomtempo']
            need(zt['vollbild'] and zt['ohne_vollbild'] and zt['vollbild'] >= 0.5 * zt['ohne_vollbild'], f"{tag}: Zoomtempo im Vollbild {zt['vollbild']:.3f} / ohne {zt['ohne_vollbild']:.3f} log10/s")
            need(fb and ff and ff >= 0.9 * fb, f'{tag}: Bildrate im Vollbild {ff} wie ohne {fb} (≥ 90 %)')

            # ---------------- Steuerung im Vollbild bei ausgeblendetem HUD
            pg.click('#btn-fullscreen'); time.sleep(3.2)                  # (Hinweis beim ersten Eintritt ist schon gezeigt)
            s0 = state(pg)
            pg.keyboard.press(' '); time.sleep(0.3); s1 = state(pg)
            pg.keyboard.press(' '); time.sleep(1.5); s2 = state(pg)
            need(s0['hudless'] and not s0['peek'] and s0['on'] and not s1['on'] and s2['on'] and not s2['paused'] and s2['hudless'],
                 f'{tag}: Leertaste im Vollbild ohne HUD: Flug aus, wieder an ({s0["on"]} → {s1["on"]} → {s2["on"]}, HUD aus {s2["hudless"] and not s2["peek"]})')
            pg.keyboard.press('r'); time.sleep(1.2)
            r1 = pg.evaluate("() => [__fraktal.S.flySpeed, __fraktal.FLY.sp]")
            pg.keyboard.press('r'); time.sleep(1.2)
            r2 = pg.evaluate("() => [__fraktal.S.flySpeed, __fraktal.FLY.sp]")
            pg.keyboard.press('ArrowUp'); r3 = pg.evaluate("() => __fraktal.S.flySpeed")
            need(r1[0] < 0 and r1[1] < 0 and r2[0] > 0 and r2[1] > 0 and abs(r3 - r2[0] - 0.1) < 1e-9, f'{tag}: R kehrt um ({r1[0]} / ist {r1[1]:.2f}), R wieder vorwärts ({r2[0]}), ↑ Tempo {r2[0]} → {r3}')
            sp = state(pg)
            need(not sp['peek'], f'{tag}: Tasten holen das HUD nicht zurück ({sp})')
            # Doppeltipp = Flug aus/an, einfacher Tipp = HUD zeigen (Flug läuft weiter)
            Wn, Hn = pg.evaluate("() => [innerWidth, innerHeight]")
            dtap(cdp, Wn * 0.5, Hn * 0.45); time.sleep(0.6)
            d1 = state(pg)
            dtap(cdp, Wn * 0.5, Hn * 0.45); time.sleep(1.0)
            d2 = state(pg)
            z0 = pg.evaluate("() => __fraktal.S.cam.zoom")
            tap(cdp, Wn * 0.5, Hn * 0.45); time.sleep(0.9)
            d3s = state(pg); z1 = pg.evaluate("() => __fraktal.S.cam.zoom")
            need(not d1['on'] and not d1['peek'] and d2['on'] and not d2['peek'], f'{tag}: Doppeltipp ohne HUD: Flug aus ({d1["on"]}), wieder an ({d2["on"]}), HUD bleibt aus')
            need(d3s['peek'] and d3s['on'] and not d3s['paused'] and z1 > z0, f'{tag}: einfacher Tipp zeigt das HUD, Flug läuft weiter ({d3s}, Zoom {z0:.3g} → {z1:.3g})')
            pg.keyboard.press('f'); time.sleep(0.4)
            errors += a.errors
            a.close()

        # ------------------------------------------------------------ iPhone (WebKit): Kino-Modus
        dev = dict(p.devices['iPhone 13']); dev.pop('default_browser_type', None)
        b = p.webkit.launch()
        ctx = b.new_context(**dev)
        ctx.add_init_script("""Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
            Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false });
            delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;""")
        pg = ctx.new_page()
        werr = []
        pg.on('pageerror', lambda e: werr.append(str(e)))
        pg.goto(BASE + '?nosw&noanim', wait_until='load')
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=30000)
        time.sleep(3)
        W0, H0 = pg.evaluate("() => [innerWidth, innerHeight]")
        can = pg.evaluate("() => __fraktal.canFly2d()")
        res['iphone'] = {'canFly2d': can}
        if can:
            pg.evaluate("() => __fraktal.startFly(undefined, { d3: false })"); time.sleep(1.5)
            pg.evaluate(REC_JS)
            T = lambda: pg.evaluate("() => performance.now()")
            time.sleep(2.0)
            t0 = T()
            pg.tap('#btn-fullscreen'); time.sleep(3.0)
            sk = state(pg)
            pg.set_viewport_size({'width': H0, 'height': W0}); time.sleep(2.5)
            pg.set_viewport_size({'width': W0, 'height': H0}); time.sleep(2.0)
            pg.touchscreen.tap(W0 / 2, H0 * 0.45); time.sleep(0.9)
            pg.tap('#btn-fullscreen'); time.sleep(1.5)
            sk2 = state(pg)
            fr = frames(pg)
            pg.evaluate("() => { window.__rec.on = false; }")
            run = [f for f in fr if f[0] >= t0]
            off = [f for f in run if not f[4] or f[5]]
            s_ = steps(run)
            res['iphone'].update({'n': len(run), 'off': len(off), 'steps': s_, 'lz': [run[0][1], run[-1][1]] if run else None, 'fps': fps_of(run)})
            need(sk['hudless'] and not sk2['hudless'], f'iPhone: Kino-Modus an ({sk["hudless"]}) und wieder aus ({sk2["hudless"]})')
            need(len(run) > 50 and not off and run[-1][1] > run[0][1] + 0.3, f'iPhone Kino-Modus: Flug läuft durch Kino an, Drehen, Kino aus ({len(run)} Bilder, {len(off)} ohne Flug, log10 Zoom {run[0][1]:.2f} → {run[-1][1]:.2f})')
            need(s_[0] < 0.08, f'iPhone: größter Zoomschritt je Bild {s_[0]:.4f} (längste Bildzeit {s_[2]:.0f} ms)')
        else:
            need(False, 'iPhone (WebKit): 2D-Flug nicht möglich')
        errors += werr
        b.close()
    need(not errors, f'Fehler: {errors[:3]}')
    res['checks'] = chk
    with open(OUT, 'w') as f:
        json.dump(res, f, indent=1, ensure_ascii=False)
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
