#!/usr/bin/env python3
"""6.8: HUD im Vollbild komplett aus + Kino-Modus (iPhone).

Prüft:  * Vollbild (Fullscreen-API, Pixel 7 hoch und quer): nach dem Einblend-Hinweis sind ALLE Bedienelemente unsichtbar
          (wirksame Deckkraft 0) und nicht klickbar (an jeder Knopfstelle liegt das Bild obenauf); nur das Bild bleibt
        * kurzer Tipp zeigt die Bedienung (≈ 3 s), danach blendet sie wieder aus; Wischen und Zwei-Finger-Zoom holen sie NICHT
          zurück; ein laufender Flug läuft weiter (der Tipp pausiert ihn nicht)
        * Mausbewegung (Desktop) zeigt sie, Ziehen mit der Maus nicht; F verlässt das Vollbild, die Bedienung ist wieder da
        * Einstellung „HUD im Vollbild ausblenden“ aus: Vollbild mit Bedienung wie bis 6.7
        * iPhone (WebKit, ohne Vollbild-Schnittstelle): Knopf „Kino-Modus“ statt Vollbild, gleiches Ausblenden und Zurückholen,
          Kino-Modus per Knopf wieder verlassen
        * 0 Fehler
Bilder: tests/shots/v68/vollbild_{hoch,quer}_{ohne,mit}_hud.jpg, kino_iphone_{ohne,mit}_hud.jpg
Aufruf: python3 tests/test_hud_fs.py   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App, BASE, MUTE
from playwright.sync_api import sync_playwright

SHOTS = os.path.join(os.path.dirname(__file__), 'shots', 'v68')
OUT = os.path.join(os.path.dirname(__file__), 'results_hud_v680.json')

# alle sichtbaren Bedienelemente: wirksame Deckkraft (Produkt über die Vorfahren), klickbar (Bild an der Stelle nicht obenauf)
UI_JS = """() => {
  const out = [];
  const eff = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  for (const e of document.body.querySelectorAll('button, input, .chrome, #hud, #toast, #dock, #bar3d, #corner, #minimap, #julia-chip, #sheet, #share-pop')) {
    if (e.closest('#gpu-note')) continue;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (!r.width || !r.height || cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (e.closest('[hidden]')) continue;
    const x = Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2));
    const top = document.elementFromPoint(x, y);
    out.push({ id: e.id || e.className || e.tagName, op: +eff(e).toFixed(3), hit: !!top && top.id !== 'gl' && top.id !== 'xfade' && e.contains(top) });
  }
  return out;
}"""


def state(pg):
    return pg.evaluate("() => ({ hudless: document.body.classList.contains('hudless'), peek: document.body.classList.contains('hud-peek'), fs: !!document.fullscreenElement })")


def touch(cdp, typ, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def visible_ui(ui):
    return [u for u in ui if u['op'] > 0.02 or u['hit']]


def main():
    os.makedirs(SHOTS, exist_ok=True)
    res, ok, chk, errors = {}, True, [], []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)
    with sync_playwright() as p:
        for land in (False, True):
            tag = 'quer' if land else 'hoch'
            a = App(p, landscape=land).open(); pg = a.page
            cdp = a.ctx.new_cdp_session(pg)
            W, H = pg.evaluate("() => [innerWidth, innerHeight]")
            a.set_view('-0.7453', '0.1127', 200); a.wait_done(60)
            ui0 = pg.evaluate(UI_JS)
            need(len(ui0) >= 8 and all(u['op'] > 0.9 for u in ui0 if u['id'] in ('hud-pill', 'dock')), f'{tag}: Bedienung vor dem Vollbild sichtbar ({len(ui0)} Elemente)')
            pg.click('#btn-fly2d'); time.sleep(1.0)
            pg.click('#btn-fullscreen'); time.sleep(0.4)
            s = state(pg)
            need(s['fs'] and s['hudless'], f'{tag}: Vollbild an, HUD-Ausblenden aktiv {s}')
            time.sleep(4.2)                                   # erster Eintritt: 2,2 s Hinweis (+1 s, solange die Maus des Klicks auf dem Knopf steht), 0,3 s Ausblenden
            ui = pg.evaluate(UI_JS); vis = visible_ui(ui)
            res[tag + '_aus'] = {'n': len(ui), 'sichtbar': vis}
            need(len(ui) >= 8 and not vis, f'{tag}: im Vollbild alle {len(ui)} Bedienelemente Deckkraft 0 und nicht klickbar (sichtbar: {vis[:4]})')
            pg.screenshot(path=os.path.join(SHOTS, f'vollbild_{tag}_ohne_hud.jpg'), type='jpeg', quality=85)
            z0 = pg.evaluate("() => __fraktal.S.cam.zoom")
            # Wischen (ein Finger, 140 px): Bild verschiebt sich, HUD bleibt aus
            touch(cdp, 'touchStart', [(W * 0.5, H * 0.5)])
            for k in range(1, 8):
                touch(cdp, 'touchMove', [(W * 0.5 - 20 * k, H * 0.5)]); time.sleep(0.03)
            touch(cdp, 'touchEnd', []); time.sleep(0.8)
            s1 = state(pg)
            # Zwei-Finger-Zoom
            touch(cdp, 'touchStart', [(W * 0.4, H * 0.5), (W * 0.6, H * 0.5)])
            for k in range(1, 8):
                touch(cdp, 'touchMove', [(W * 0.4 - 6 * k, H * 0.5), (W * 0.6 + 6 * k, H * 0.5)]); time.sleep(0.03)
            touch(cdp, 'touchEnd', []); time.sleep(0.8)
            s2 = state(pg)
            need(not s1['peek'] and not s2['peek'] and s1['hudless'], f'{tag}: Wischen/Zwei-Finger-Zoom holen das HUD nicht zurück ({s1}, {s2})')
            # Flug neu starten (zwei Finger beenden ihn, wie bisher) – dann Tipp: HUD kommt, Flug läuft weiter
            pg.evaluate("() => __fraktal.startFly(undefined, { d3: false })"); time.sleep(1.5)
            z1 = pg.evaluate("() => __fraktal.S.cam.zoom")
            touch(cdp, 'touchStart', [(W * 0.5, H * 0.4)]); time.sleep(0.06); touch(cdp, 'touchEnd', [])
            time.sleep(0.9)                                   # Tipp wird nach 320 ms erkannt (Doppeltipp-Fenster), 0,3 s Einblenden
            sp = state(pg); uip = pg.evaluate(UI_JS)
            fl = pg.evaluate("() => [__fraktal.FLY.on, __fraktal.FLY.paused, __fraktal.S.cam.zoom]")
            shown = [u for u in uip if u['id'] in ('hud-pill', 'dock', 'btn-fly', 'btn-rev', 'btn-fullscreen')]
            need(sp['peek'] and all(u['op'] > 0.95 for u in shown) and len(shown) >= 4, f'{tag}: kurzer Tipp zeigt die Bedienung ({[(u["id"], u["op"]) for u in shown]})')
            need(fl[0] and not fl[1] and fl[2] > z1, f'{tag}: Flug läuft weiter, nicht pausiert (Zoom {z1:.3g} → {fl[2]:.3g})')
            pg.screenshot(path=os.path.join(SHOTS, f'vollbild_{tag}_mit_hud.jpg'), type='jpeg', quality=85)
            time.sleep(3.0)
            s3 = state(pg); vis3 = visible_ui(pg.evaluate(UI_JS))
            need(not s3['peek'] and not vis3, f'{tag}: nach ≈ 3 s wieder ausgeblendet ({len(vis3)} sichtbar)')
            # Zweiter Tipp bei sichtbarem HUD pausiert wie gewohnt
            touch(cdp, 'touchStart', [(W * 0.5, H * 0.4)]); time.sleep(0.06); touch(cdp, 'touchEnd', []); time.sleep(0.9)
            touch(cdp, 'touchStart', [(W * 0.5, H * 0.4)]); time.sleep(0.06); touch(cdp, 'touchEnd', []); time.sleep(0.9)
            need(pg.evaluate("() => __fraktal.FLY.paused"), f'{tag}: Tipp bei sichtbarem HUD pausiert den Flug wie bisher')
            pg.evaluate("() => __fraktal.stopFly()")
            # F verlässt das Vollbild
            pg.keyboard.press('f'); time.sleep(0.8)
            s4 = state(pg); vis4 = visible_ui(pg.evaluate(UI_JS))
            need(not s4['fs'] and not s4['hudless'] and len(vis4) >= 8, f'{tag}: F verlässt das Vollbild, Bedienung wieder da ({s4})')
            if not land:
                # Einstellung aus: Vollbild mit Bedienung
                pg.evaluate("() => { const c = document.getElementById('t-hudfs'); c.checked = false; c.dispatchEvent(new Event('change')); }")
                pg.click('#btn-fullscreen'); time.sleep(3.0)
                s5 = state(pg); vis5 = visible_ui(pg.evaluate(UI_JS))
                need(s5['fs'] and not s5['hudless'] and len(vis5) >= 8, f'Einstellung aus: Vollbild mit Bedienung ({s5}, {len(vis5)} sichtbar)')
                pg.keyboard.press('f'); time.sleep(0.5)
                pg.evaluate("() => { const c = document.getElementById('t-hudfs'); c.checked = true; c.dispatchEvent(new Event('change')); }")
                need(pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings')).hudFs") is True, 'Einstellung wird gespeichert')
            errors += a.errors
            a.close()

        # ------------------------------------------------------------ Desktop: Maus
        a = App(p, device='Desktop Chrome').open(); pg = a.page
        a.set_view('-0.5', '0', 1); a.wait_done(60)
        pg.mouse.move(300, 300)
        pg.click('#btn-fullscreen'); time.sleep(3.2)
        s0 = state(pg)
        pg.mouse.move(400, 300, steps=5); time.sleep(0.6)
        s1 = state(pg)
        time.sleep(3.6); s2 = state(pg)
        pg.mouse.down(); pg.mouse.move(520, 330, steps=6); pg.mouse.up(); time.sleep(0.6)     # Ziehen ab der Ruhelage
        s3 = state(pg)
        need(s0['hudless'] and not s0['peek'] and s1['peek'] and not s2['peek'], f'Maus: Bewegung zeigt das HUD, danach wieder aus ({s0} {s1} {s2})')
        need(not s3['peek'], f'Maus: Ziehen (Bild verschieben) holt das HUD nicht zurück ({s3})')
        pg.keyboard.press('f'); time.sleep(0.5)
        need(not state(pg)['hudless'], 'Desktop: F verlässt das Vollbild')
        errors += a.errors
        a.close()

        # ------------------------------------------------------------ iPhone (WebKit): Kino-Modus
        dev = dict(p.devices['iPhone 13']); dev.pop('default_browser_type', None)
        b = p.webkit.launch()
        ctx = b.new_context(**dev)
        # iPhone-Safari hat keine Vollbild-Schnittstelle für Seiten (nur Videos) – nachstellen
        ctx.add_init_script("""Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
            Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false });
            delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;""")
        pg = ctx.new_page()
        werr = []
        pg.on('pageerror', lambda e: werr.append(str(e)))
        pg.goto(BASE + '?nosw&noanim', wait_until='load')
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=30000)
        time.sleep(3)
        bt = pg.evaluate("() => { const b = document.getElementById('btn-fullscreen'); return { hidden: b.hidden, title: b.title, fs: document.fullscreenEnabled, label2: document.querySelector('#btn-fullscreen2 [data-i18n]').textContent }; }")
        res['iphone_knopf'] = bt
        need(not bt['hidden'] and bt['title'] == 'Kino-Modus' and bt['label2'] == 'Kino-Modus' and not bt['fs'], f'iPhone: Knopf „Kino-Modus“ statt Vollbild: {bt}')
        pg.tap('#btn-fullscreen'); time.sleep(3.0)
        s0 = state(pg); vis = visible_ui(pg.evaluate(UI_JS))
        pg.screenshot(path=os.path.join(SHOTS, 'kino_iphone_ohne_hud.jpg'), type='jpeg', quality=85)
        need(s0['hudless'] and not s0['fs'] and not vis, f'iPhone Kino-Modus: alles ausgeblendet ohne echtes Vollbild ({s0}, sichtbar {vis[:3]})')
        W, H = pg.evaluate("() => [innerWidth, innerHeight]")
        pg.touchscreen.tap(W / 2, H * 0.45); time.sleep(0.9)
        s1 = state(pg)
        pg.screenshot(path=os.path.join(SHOTS, 'kino_iphone_mit_hud.jpg'), type='jpeg', quality=85)
        need(s1['peek'], f'iPhone: Tipp zeigt die Bedienung ({s1})')
        pg.tap('#btn-fullscreen'); time.sleep(0.6)
        s2 = state(pg)
        need(not s2['hudless'], f'iPhone: Kino-Modus per Knopf verlassen ({s2})')
        gl = pg.evaluate("() => !!document.createElement('canvas').getContext('webgl2')")
        res['iphone_webgl2'] = gl
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
