#!/usr/bin/env python3
"""6.6: Flug auch in 2D (Pixel 7, echte GPU).

Prüft:  * ✈-Knopf in 2D sichtbar (hoch unten rechts über dem Dock, quer unten links; ≥ 48 px), in 3D/Mandelbulb/Buddhabrot
          und während des Flugs ausgeblendet; im 2D-Flug zeigt die Flug-Leiste Stopp + Tempo (ohne Ausrichten)
        * 2D-Flug startet ohne 3D: V3.on bleibt false, keine Vorbereitung, keine 3D-Programme übersetzt (nur die Sonde)
        * Zufallsflug 20 s: Zoom steigt (≥ 10⁴), Rand in der Bildmitte ≥ 85 % der Sonden, „verloren“ < 10 % der Zeit
        * Tippen = Pause (Zoom steht) / weiter; ein Finger schiebt das Bild (der Inhalt folgt dem Finger), der Flug läuft
          weiter; zwei Finger beenden den Flug
        * ⛰ im 2D-Flug: 3D blendet ein, der Flug läuft in 3D weiter; ⛰ aus im 3D-Flug: der Flug läuft in 2D weiter
        * Taste V fliegt im aktuellen Modus (2D)
        * Orte: „✈ Flug“ im 2D-Modus fliegt in 2D und landet exakt (cx, cy, zoom)
        * Welt ohne Flug (Mandelbulb) beendet den Flug
        * ?fly2d=0: kein 2D-Knopf, ✈ startet wie 6.5 die 3D-Landschaft, 3D aus beendet den Flug
        * 0 Fehler
Bildschirmfotos: tests/shots/flug2d/knopf_{hoch,quer}.jpg, leiste_{hoch,quer}.jpg
Hinweis: wie die übrigen Flugtests im sichtbaren Fenster (headless drosselt macOS den Bildtakt, dann taucht der Flug langsamer).
Aufruf: FK_HEADED=1 python3 tests/test_fly2d.py
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from measure_fly import lost_stats, edge_stats

SHOTS = os.path.join(os.path.dirname(__file__), 'shots', 'flug2d')
TGT = ('-0.743637214380908705', '0.131822306549061970', 1e5)


def touch(cdp, typ, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def box(pg, sel):
    return pg.evaluate(f"() => {{ const e = document.querySelector('{sel}'); if (!e || e.hidden || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return {{ x: r.x, y: r.y, w: r.width, h: r.height, op: +getComputedStyle(e).opacity }}; }}")


def fly_state(pg):
    return pg.evaluate("() => { const A = window.__fraktal, F = A.FLY; return { on: F.on, paused: F.paused, d3: F.d3, mode: F.mode, v3: A.V3.on, prep: !!A.V3.prep, zoom: A.S.cam.zoom }; }")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    res, ok, chk = {}, True, []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)
    with sync_playwright() as p:
        # ------------------------------------------------------------ hoch
        a = App(p, query='nosw&noanim').open(); pg = a.page
        cdp = a.ctx.new_cdp_session(pg)
        W, H = pg.evaluate("() => [innerWidth, innerHeight]")
        a.set_view('-0.5', '0', 1); a.wait_done(120)
        b = box(pg, '#btn-fly2d'); dock = box(pg, '#dock')
        res['btn_hoch'] = b
        need(b and b['w'] >= 48 and b['h'] >= 48, f'hoch: ✈-Knopf sichtbar, ≥ 48 px: {b}')
        need(b and b['x'] + b['w'] > W * 0.75 and b['y'] + b['h'] <= dock['y'] and b['y'] > H * 0.6, 'hoch: Knopf unten rechts über dem Dock (Daumenzone)')
        pg.screenshot(path=os.path.join(SHOTS, 'knopf_hoch.jpg'), type='jpeg', quality=85)
        # --- Start per Knopf: 2D-Flug ohne 3D
        pg.evaluate("() => { window.__fraktal.S.flySpeed = 0.5; }")
        pg.click('#btn-fly2d')
        time.sleep(0.3)
        pg.evaluate("() => { const F = window.__fraktal.FLY; F.rec = []; F.recM = []; }")
        s = fly_state(pg)
        need(s['on'] and not s['d3'] and not s['v3'] and not s['prep'], f'2D-Flug läuft ohne 3D: {s}')
        need(box(pg, '#btn-fly2d') is None and box(pg, '#bar3d') is not None and box(pg, '#btn-north') is None and box(pg, '#lbl-speed') is not None,
             'im 2D-Flug: Flug-Leiste mit Stopp + Tempo, ohne Ausrichten; ✈-Knopf weg')
        time.sleep(20)
        pg.screenshot(path=os.path.join(SHOTS, 'leiste_hoch.jpg'), type='jpeg', quality=85)
        r = pg.evaluate("""() => { const A = window.__fraktal, F = A.FLY; const o = { rec: F.rec, recM: F.recM, zoom: A.S.cam.zoom, v3: A.V3.on,
            progs: Object.fromEntries(['t3probe', 't3hb', 't3sky', 't3blit'].map(k => [k, A.R.hasProgram(k)])), prepInfo: A.view3dInfo().prepInfo }; F.rec = null; F.recM = null; return o; }""")
        ls, es = lost_stats(r['rec']), edge_stats(r['recM'])
        res['fly20'] = dict(zoom='%.2e' % r['zoom'], progs=r['progs'], **ls, **es)
        need(r['zoom'] >= 1e4, f'20 s 2D-Flug: Zoom {r["zoom"]:.1e} ≥ 1e4 (sichtbares Fenster: FK_HEADED=1)')
        need(not r['v3'] and r['progs']['t3probe'] and not any(v for k, v in r['progs'].items() if k != 't3probe') and not r['prepInfo'],
             f'keine 3D-Programme übersetzt (nur die Sonde): {r["progs"]}')
        need(es.get('edgeMidShare', 0) >= 0.85, f'Rand in der Bildmitte {es.get("edgeMidShare")} ≥ 0,85 ({es.get("probes")} Sonden)')
        need(ls.get('lostTimeShare', 1) < 0.1, f'verloren {ls.get("lostTimeShare")} < 0,1 der Zeit')
        # --- Tippen = Pause / weiter
        touch(cdp, 'touchStart', [(W / 2, H / 2)]); touch(cdp, 'touchEnd', []); time.sleep(0.6)
        z0 = fly_state(pg); time.sleep(1.0); z1 = fly_state(pg)
        need(z0['paused'] and z1['zoom'] == z0['zoom'], f'Tippen pausiert: Zoom steht ({z0["zoom"]:.3e})')
        # --- Schieben (in der Pause, damit nur die Verschiebung zählt): der Inhalt folgt dem Finger, Flug bleibt an
        pg.evaluate("() => { window.__c0 = window.__fraktal.S.cam.cx; }")
        touch(cdp, 'touchStart', [(W * 0.3, H * 0.5)])
        for k in range(1, 13):
            touch(cdp, 'touchMove', [(W * 0.3 + W * 0.4 * k / 12, H * 0.5)]); time.sleep(1 / 30)
        touch(cdp, 'touchEnd', []); time.sleep(0.4)
        shift = pg.evaluate("() => { const A = window.__fraktal; return A.HP.toNumber(A.S.cam.cx - window.__c0) / (3 / (A.S.cam.zoom * innerHeight)); }")
        s = fly_state(pg)
        res['drag_px'] = round(shift, 1)
        need(s['on'] and abs(shift + W * 0.4) < W * 0.4 * 0.15, f'ein Finger schiebt im Flug: Kamera {shift:+.0f} px (erwartet {-W * 0.4:+.0f}), Flug läuft weiter')
        touch(cdp, 'touchStart', [(W / 2, H / 2)]); touch(cdp, 'touchEnd', []); time.sleep(1.2)
        z2 = fly_state(pg)
        need(not z2['paused'] and z2['zoom'] > z1['zoom'] * 1.2, f'Tippen: weiter, Zoom steigt ({z1["zoom"]:.2e} → {z2["zoom"]:.2e})')
        # --- zwei Finger beenden den Flug
        touch(cdp, 'touchStart', [(W / 2 - 60, H / 2), (W / 2 + 60, H / 2)])
        for k in range(1, 8):
            touch(cdp, 'touchMove', [(W / 2 - 60 - 6 * k, H / 2), (W / 2 + 60 + 6 * k, H / 2)]); time.sleep(1 / 30)
        touch(cdp, 'touchEnd', []); time.sleep(0.5)
        need(not fly_state(pg)['on'], 'zwei Finger beenden den Flug')
        # --- Wechsel 2D -> 3D -> 2D während des Flugs
        a.set_view('-0.5', '0', 1); a.wait_done(60)
        pg.click('#btn-fly2d'); time.sleep(3)
        pg.click('#btn-3d')
        got3d = a.wait_3d(30); time.sleep(0.5)
        s1 = fly_state(pg); time.sleep(2.0); s2 = fly_state(pg)
        res['to3d'] = [s1, s2]
        need(got3d and s1['on'] and s1['d3'] and s1['v3'] and s2['zoom'] > s1['zoom'] * 1.1, f'⛰ im 2D-Flug: Flug läuft in 3D weiter ({s1["zoom"]:.2e} → {s2["zoom"]:.2e})')
        need(box(pg, '#btn-north') is not None and box(pg, '#btn-fly2d') is None, '3D: Leiste mit Ausrichten, kein 2D-Knopf')
        pg.click('#btn-3d'); time.sleep(1.5)
        s3 = fly_state(pg); time.sleep(2.0); s4 = fly_state(pg)
        res['to2d'] = [s3, s4]
        need(s3['on'] and not s3['d3'] and not s3['v3'] and s4['zoom'] > s3['zoom'] * 1.1, f'⛰ aus im 3D-Flug: Flug läuft in 2D weiter ({s3["zoom"]:.2e} → {s4["zoom"]:.2e})')
        need(box(pg, '#bar3d') is not None and box(pg, '#btn-north') is None, 'nach dem Wechsel: Flug-Leiste wie in 2D')
        pg.click('#btn-fly'); time.sleep(0.4)
        need(not fly_state(pg)['on'] and box(pg, '#bar3d') is None and box(pg, '#btn-fly2d') is not None, 'Stopp: Leiste weg, ✈-Knopf wieder da')
        # --- Taste V
        a.set_view('-0.5', '0', 1); a.wait_done(60)
        pg.keyboard.press('v'); time.sleep(0.5)
        s = fly_state(pg)
        need(s['on'] and not s['d3'] and not s['v3'], f'Taste V fliegt in 2D: {s}')
        pg.keyboard.press('v'); time.sleep(0.3)
        need(not fly_state(pg)['on'], 'Taste V stoppt')
        # --- Orte: ✈ Flug im 2D-Modus fliegt in 2D und landet exakt
        a.set_view(*TGT); a.wait_done(90)
        pg.click('.dock-btn[data-tab="places"]'); time.sleep(0.6)
        pg.click('#btn-save-place'); time.sleep(0.6)
        pg.click('#sheet-close'); time.sleep(0.5)
        a.set_view('-0.5', '0', 1); a.wait_done(60)
        pg.click('.dock-btn[data-tab="places"]'); time.sleep(0.6)
        pg.click('#user-places .place .chip.fly'); time.sleep(0.5)
        s = fly_state(pg)
        need(s['on'] and s['mode'] == 'place' and not s['d3'] and not s['v3'] and not s['prep'], f'Orte-Flug im 2D-Modus startet in 2D: {s}')
        t0 = time.time()
        while time.time() - t0 < 120 and fly_state(pg)['on']: time.sleep(0.5)
        land = pg.evaluate("""() => { const A = window.__fraktal, p = JSON.parse(localStorage.getItem('fraktal_v5_places'))[0];
            return { cx: A.S.cam.cx === A.HP.fromString(p.cx), cy: A.S.cam.cy === A.HP.fromString(p.cy), zoom: A.S.cam.zoom === +p.zoom, z: A.S.cam.zoom, pz: +p.zoom, v3: A.V3.on, t: 0 }; }""")
        land['secs'] = round(time.time() - t0, 1)
        res['place'] = land
        need(land['cx'] and land['cy'] and land['zoom'] and not land['v3'], f'Orte-Flug in 2D landet exakt (cx, cy, zoom): {land}')
        # --- Welt ohne Flug
        a.set_view('-0.5', '0', 1); a.wait_done(60)
        pg.click('#btn-fly2d'); time.sleep(1)
        pg.evaluate("() => window.__fraktal.setMode(6)"); time.sleep(0.6)
        need(not fly_state(pg)['on'] and box(pg, '#btn-fly2d') is not None, 'Mandelbulb: Flug endet, ✈-Knopf für den eigenen Flug (7.0)')
        pg.evaluate("() => window.__fraktal.setMode(7)"); time.sleep(0.4)
        need(box(pg, '#btn-fly2d') is None, 'Buddhabrot: kein ✈-Knopf')
        pg.evaluate("() => window.__fraktal.setMode(0)"); time.sleep(0.6)
        need(box(pg, '#btn-fly2d') is not None, 'Mandelbrot: ✈-Knopf wieder da')
        res['errors_hoch'] = a.errors
        need(not a.errors, f'hoch: 0 Fehler {a.errors[:3]}')
        a.close()
        # ------------------------------------------------------------ quer
        a = App(p, landscape=True, query='nosw&noanim').open(); pg = a.page
        W, H = pg.evaluate("() => [innerWidth, innerHeight]")
        a.set_view('-0.5', '0', 1); a.wait_done(120)
        b = box(pg, '#btn-fly2d'); dock = box(pg, '#dock')
        res['btn_quer'] = b
        need(b and b['w'] >= 48 and b['x'] < W * 0.25 and b['y'] > H * 0.6 and b['x'] + b['w'] < dock['x'], f'quer: ✈-Knopf unten links, ≥ 48 px, frei vom Dock: {b}')
        pg.screenshot(path=os.path.join(SHOTS, 'knopf_quer.jpg'), type='jpeg', quality=85)
        pg.click('#btn-fly2d'); time.sleep(6)
        s = fly_state(pg)
        need(s['on'] and not s['v3'] and s['zoom'] > 3, f'quer: 2D-Flug läuft ({s["zoom"]:.1e})')
        pg.screenshot(path=os.path.join(SHOTS, 'leiste_quer.jpg'), type='jpeg', quality=85)
        pg.evaluate("() => window.__fraktal.stopFly()")
        need(not a.errors, f'quer: 0 Fehler {a.errors[:3]}')
        a.close()
        # ------------------------------------------------------------ ?fly2d=0 (Verhalten 6.5)
        a = App(p, query='nosw&noanim&fly2d=0').open(); pg = a.page
        a.set_view('-0.5', '0', 1); a.wait_done(120)
        need(box(pg, '#btn-fly2d') is None, '?fly2d=0: kein 2D-Knopf')
        pg.evaluate("() => window.__fraktal.startFly()")
        got3d = a.wait_3d(30); time.sleep(0.5)
        s = fly_state(pg)
        need(got3d and s['on'] and s['d3'] and s['v3'], f'?fly2d=0: ✈ startet die 3D-Landschaft wie 6.5: {s}')
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.2)
        need(not fly_state(pg)['on'], '?fly2d=0: 3D aus beendet den Flug')
        need(not a.errors, f'?fly2d=0: 0 Fehler {a.errors[:3]}')
        a.close()
    print(json.dumps(res, indent=1, default=str))
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
