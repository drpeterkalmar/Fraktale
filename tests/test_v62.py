#!/usr/bin/env python3
"""6.2: Farbe der Menge, Alpin-Look, sanfter Flug zum Mengenrand (Pixel 7, echte GPU).

Prüft:  * Farbe der Menge: Knopf im Farben-Sheet setzt sie, wird gespeichert (nach Neuladen noch da) und geteilt
          (Link sc=…, eigener Farbton per Link); Standard Schwarz = Mengenpixel wie 6.1
        * wirksam in 2D (Mengenpixel hell bei Weiß, ~Farbwahl bei eigener Farbe) und in 3D (Gletscher hell)
        * Alpin-Look per Link (al=l), 3D ohne Fehler, GPU-Zeit 3D-Bild < 16 ms (M1); 8-bit-Ersatzpfad (iPhone) mit Alpin
        * Zufallsflug 30 s ab Seepferdchen-Tal ohne Fehler, 0 harte Wechsel; Lenk-/Rand-Regression:
          max. Drehrate < 25 °/s, Richtungswechsel < 15/min, Rand in der Bildmitte ≥ 90 % der Sonden, innen < 15 %
        * Wischen lenkt im Flug (Kurs folgt in Wischrichtung); auf dem 8-bit-Ersatzpfad (Alpin, quer) fliegt er fehlerfrei
Aufruf: python3 tests/test_v62.py
"""
import sys, os, json, time, io, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image
from measure_fly import turn_stats, edge_stats

SEA = ('-0.7453', '0.1127', 300)


def center_rgb(pg, r=6):
    im = Image.open(io.BytesIO(pg.locator('#gl').screenshot())).convert('RGB')
    w, h = im.size
    px = [im.getpixel((w // 2 + dx, h // 2 + dy)) for dx in range(-r, r + 1, 3) for dy in range(-r, r + 1, 3)]
    return [round(sum(p[k] for p in px) / len(px)) for k in range(3)]


def main():
    res, ok, chk = {}, True, []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
    with sync_playwright() as p:
        a = App(p, query='nosw&noanim').open(); pg = a.page
        # --- 2D: Mengenpixel in der Hauptkardioide (Bildmitte bei -0.25)
        a.set_view('-0.25', '0', 1); a.wait_done(90)
        pg.evaluate("() => window.__fraktal.snapshot()")
        black = center_rgb(pg)
        pg.click('.dock-btn[data-tab="colors"]'); time.sleep(0.5)
        pg.click('#seg-setcol button[data-v="white"]'); time.sleep(0.4)
        pg.click('#sheet-close'); time.sleep(0.5)
        pg.evaluate("() => window.__fraktal.snapshot()")
        white = center_rgb(pg)
        pg.click('.dock-btn[data-tab="colors"]'); time.sleep(0.5)
        st = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings')).setCol")
        url = pg.evaluate("() => window.__fraktal.stateURL()")
        res['2d'] = dict(black=black, white=white, saved=st, url=url[-40:])
        need(max(black) < 12, f'Schwarz (Standard) wie 6.1: Mengenpixel {black}')
        need(min(white) > 200, f'Weiß wirkt in 2D: Mengenpixel {white}')
        need(st == 'white', 'Farbe der Menge gespeichert')
        need('sc=w' in url, 'Teilen-Link enthält sc=w')
        pg.click('#seg-setcol button[data-v="custom"]'); time.sleep(0.3)
        vis = pg.evaluate("() => !document.getElementById('set-color-custom').hidden")
        need(vis, 'Eigene: Farbwähler sichtbar')
        pg.click('#sheet-close'); time.sleep(0.4)
        # --- Neuladen: Einstellung bleibt
        a.page.reload(wait_until='load'); pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
        sc2 = pg.evaluate("() => window.__fraktal.S.setCol")
        need(sc2 == 'custom', f'nach Neuladen: Farbe der Menge = {sc2}')
        # --- Link mit eigenem Farbton + Alpin
        base = a.page.url.split('#')[0]
        pg.goto(base + '#m=0&x=-0.25&y=0&z=1&p=neon&sc=d9b26a', wait_until='load'); pg.reload(wait_until='load')
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
        v = pg.evaluate("() => ({ sc: window.__fraktal.S.setCol, hex: window.__fraktal.S.setHex })")
        a.wait_done(90); pg.evaluate("() => window.__fraktal.snapshot()")
        cust = center_rgb(pg)
        res['custom'] = dict(v=v, rgb=cust)
        need(v == {'sc': 'custom', 'hex': '#d9b26a'}, f'Link sc=d9b26a übernommen {v}')
        need(abs(cust[0] - 0xd9) < 40 and abs(cust[1] - 0xb2) < 40 and abs(cust[2] - 0x6a) < 45, f'eigene Farbe ≈ gewählt: {cust} vs (217,178,106)')
        # --- 3D: Gletscher hell vs. See dunkel (Fokus in der Kardioide)
        pg.evaluate("() => { const A = window.__fraktal; A.S.setCol = 'black'; A.set3d(true); }"); time.sleep(1.5); a.wait_done(90); time.sleep(1.0)
        pg.evaluate("() => window.__fraktal.settle3d()"); d3b = center_rgb(pg, 12)
        pg.evaluate("() => { const A = window.__fraktal; A.S.setCol = 'white'; A.invalidate(); }"); time.sleep(0.5)
        pg.evaluate("() => window.__fraktal.settle3d()"); d3w = center_rgb(pg, 12)
        res['3d'] = dict(black=d3b, white=d3w)
        need(sum(d3w) > sum(d3b) + 250, f'Weiß wirkt in 3D (Gletscher): {d3b} -> {d3w}')
        # --- Alpin per Link
        pg.goto(base + '#m=0&x=-0.7453&y=0.1127&z=300&p=alpine&sc=w&al=l', wait_until='load'); pg.reload(wait_until='load')
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
        al = pg.evaluate("() => ({ a: window.__fraktal.S.alpine, v: window.__fraktal.S.valley, look: window.__fraktal.look().alpine })")
        need(al == {'a': True, 'v': 'lake', 'look': 2}, f'Link al=l: Alpin-Look mit See {al}')
        a.wait_done(90)
        pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.5); a.wait_done(90); time.sleep(1.5)
        gpu = pg.evaluate("() => window.__fraktal.bench3d(6)")
        res['alpineGpu'] = gpu
        if gpu: need(gpu['min'] < 16, f'GPU-Zeit 3D-Bild Alpin {gpu["min"]} ms < 16 ms')
        pg.evaluate("() => { const A = window.__fraktal; A.S.alpine = false; A.S.setCol = 'black'; A.S.palette = 0; A.invalidate(); A.saveSettings(); }")
        # --- Flug 30 s ab Seepferdchen-Tal (6.2-Lenkung) + Regression der Kennzahlen
        pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.0)
        a.set_view(*SEA); a.wait_done(90)
        pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.set3d(true); }"); time.sleep(1.5); a.wait_done(90)
        pg.evaluate("() => { const A = window.__fraktal; A.frameStats(true); A.startFly(); A.FLY.rec = []; A.FLY.recM = []; }")
        time.sleep(30)
        r = pg.evaluate("() => { const A = window.__fraktal, F = A.FLY; const o = { rec: F.rec, recM: F.recM, zoom: A.S.cam.zoom, on: F.on, hard: A.frameStats().hard }; F.rec = null; F.recM = null; return o; }")
        ts, es = turn_stats(r['rec']), edge_stats(r['recM'])
        res['fly'] = dict(zoom='%.2e' % r['zoom'], hard=r['hard'], **ts, **es)
        need(r['on'] and r['zoom'] > 1e6, f'Flug 30 s läuft, Zoom {r["zoom"]:.1e}')
        need(r['hard'] == 0, 'Flug: 0 harte Wechsel')
        need(ts.get('maxTurn', 99) < 25, f'Lenkung: max. Drehrate {ts.get("maxTurn")} °/s < 25')
        need(ts.get('flipsPerMin', 99) < 15, f'Lenkung: Richtungswechsel {ts.get("flipsPerMin")}/min < 15')
        need(es.get('edgeMidShare', 0) >= 0.9, f'Rand in der Bildmitte {es.get("edgeMidShare")} ≥ 0,9')
        need(es.get('inFrac', 1) < 0.15, f'kaum innen: {es.get("inFrac")} < 0,15')
        # --- Wischen lenkt (Kurs folgt in Wischrichtung)
        cdp = a.ctx.new_cdp_session(pg)
        W, H = pg.evaluate("() => [innerWidth, innerHeight]")
        h0 = pg.evaluate("() => window.__fraktal.V3.heading")
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': W * 0.3, 'y': H * 0.5, 'id': 0}]})
        for k in range(1, 13):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': W * 0.3 + W * 0.04 * k, 'y': H * 0.5, 'id': 0}]}); time.sleep(1 / 30)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        time.sleep(2.5)
        h1 = pg.evaluate("() => window.__fraktal.V3.heading")
        res['swipe'] = round(h1 - h0, 3)
        need(h1 - h0 > 0.25, f'Wischen nach rechts dreht den Kurs: {h1 - h0:+.2f} rad')
        pg.evaluate("() => window.__fraktal.stopFly()")
        res['errors'] = a.errors
        need(not a.errors, f'0 Page-/Console-Fehler {a.errors[:3]}')
        a.close()
        # --- 8-bit-Ersatzpfad (kein Float-Renderziel) mit Alpin, quer: Flug läuft (bis 6.5.3 zusammen mit ?flyedge=0)
        a = App(p, landscape=True, query='nosw&noanim')
        a.page.add_init_script("""(() => { const g = WebGL2RenderingContext.prototype.getExtension;
            WebGL2RenderingContext.prototype.getExtension = function (n) { return n === 'EXT_color_buffer_float' ? null : g.call(this, n); }; })()""")
        a.open(); pg = a.page
        a.set_view(*SEA); a.wait_done(90)
        pg.evaluate("() => { const A = window.__fraktal; A.S.alpine = true; A.S.valley = 'forest'; A.S.setCol = 'white'; A.set3d(true); }"); time.sleep(1.5); a.wait_done(90)
        pg.evaluate("() => window.__fraktal.startFly()"); time.sleep(8)
        v = pg.evaluate("() => ({ on: window.__fraktal.FLY.on, h8: window.__fraktal.view3dInfo().gpu.h8, z: window.__fraktal.S.cam.zoom })")
        res['h8'] = v
        need(v['on'] and v['h8'] and v['z'] > 1000, f'8 bit + Alpin quer: Flug läuft {v}')
        need(not a.errors, f'0 Fehler (8 bit) {a.errors[:3]}')
        a.close()
    print(json.dumps(res, indent=1))
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
