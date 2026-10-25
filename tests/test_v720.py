#!/usr/bin/env python3
"""7.2.0: Zufallsstart mit Sofortflug ohne Overlay (Peter 21.10.2026: „gleich völlig randomisiert … in einer welt langsam
losfliegen ohne jegliches overlay“; „3d-mode“ = 3D-Landschaft nie).

A  30 Starts mit festem Zufall (?seed=1…30): Welt-/Ort-Verteilung, Sonde, Bildprüfung, Neu-Würfeln, Bewegung je Welt; je Start:
   keine Seitenfehler, nie 3D-Landschaft, Bedienung ausgeblendet (jedes Element außer dem Bild deckend 0), Flug läuft
   (Welten mit Flug), Bild eingeblendet. Ergebnis tests/results_v720_seeds.json
B  gespeicherte Einstellungen bleiben (gewürfelte Werte nur für die Sitzung); eigene Änderung wird gespeichert
C  Link der Szene (Adresszeile gleich nach dem Start) öffnet dieselbe Welt/Palette/Parameter (ohne Flug, mit Bedienung)
D  Startarten: ?start=still (7.1.6: Welt würfeln, Bedienung sichtbar, kein Flug), ?zufall=0 (nur Welt + Ort, Flug),
   Testautomation ohne Regler = Mandelbrot wie bisher, Einstellung 'random' (bis 7.1.14) -> 'flug'
E  Anfahrt: weich in ≥ 3 s (Zoomtempo nach 0,5 s < 10 % des Reisetempos, kein Sprung im Tempo)
F  Rückweg: Tipp (Touch) zeigt die Bedienung 3 s, Desktop Taste H, Esc beendet das Start-Kino; Hinweis „Tippen für Menü“
   (?starthint=1) höchstens 2 s
G  Bildschirmfotos (Pixel 7 hoch/quer, Desktop) nach tests/shots/v720/ – kein Overlay
Aufruf: python3 tests/test_v720.py [--only=A,B] [--n=30]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
ONLY = set(ARGS.get('only', 'A,B,C,D,E,F,G').split(','))
N = int(ARGS.get('n', 30))
SHOTS = os.path.join(os.path.dirname(__file__), 'shots', 'v720')
INFO = """() => { const A = window.__fraktal, S = A.START;
  const vis = [...document.body.children].filter(e => e.id !== 'gl' && !e.hidden && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0.01 && e.getBoundingClientRect().width > 0).map(e => e.id || e.className || e.tagName);
  return { how: S.how, mode: S.mode, seed: S.seed, world: S.world, key: S.info && S.info.key, place: S.place, sight: S.sight, probe: S.info && S.info.probe, tries: S.info && S.info.tries,
    image: S.image, rerolls: S.rerolls || 0, rejected: (S.rejected || []).map(r => r.why), fallback: S.fallback, motion: S.motion || null, fly: A.FLY.on, flyMode: A.FLY.mode, sp: A.FLY.sp, zoom: A.S.cam.zoom,
    v3: A.V3.on, hudless: document.body.classList.contains('hudless'), intro: document.documentElement.classList.contains('fk-intro'),
    glOpacity: +getComputedStyle(document.getElementById('gl')).opacity, visible: vis, url: location.hash,
    pal: A.PAL.list[A.S.palette].id, style: A.S.style, setCol: A.S.setCol, out: A.S.outMode, anim: A.S.anim, speed: A.S.speed, wp: A.S.wp[A.S.formula] || null, flySpeed: A.S.flySpeed,
    bulb: A.isRay() ? { style: A.S.bulbStyle, fog: A.S.bulbFog, dof: A.S.bulbDof, breathe: A.S.bulbBreathe, fly: A.BULB.flyMode(), state: A.BULB.stateString() } : null }; }"""


def wait_motion(pg, t=12):
    t0 = time.time()
    while time.time() - t0 < t:
        if pg.evaluate("() => !!window.__fraktal.START.motion"):
            return time.time() - t0
        time.sleep(0.2)
    return None


def main():
    ok, chk = True, []
    res = {}

    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)

    with sync_playwright() as p:
        if 'A' in ONLY:
            runs = []
            a = App(p, query='nosw')
            pg = a.page
            for sd in range(1, N + 1):
                a.query = 'nosw&seed=%d' % sd
                a.errors.clear()
                a.open()
                tm = wait_motion(pg)
                time.sleep(1.8)            # Einblenden (1,4 s) + Anfahrt läuft
                st = pg.evaluate(INFO)
                st['t_motion'] = round(tm, 2) if tm else None
                st['errors'] = a.errors[:3]
                runs.append(st)
                flyW = st['world'] not in (7, 14, 15)
                good = (not st['errors'] and not st['v3'] and st['hudless'] and not st['visible'] and tm is not None and not st['intro']
                        and st['glOpacity'] > 0.99 and (st['fly'] or not flyW))
                print(f"  seed {sd:2d}: {st['key']:13s} {st['place']:6s} {str(st['sight'] or ''):14s} motion={st['motion']} t={st['t_motion']} rerolls={st['rerolls']} "
                      f"fb={st['fallback']} img={st['image'] and {k: st['image'].get(k) for k in ('mean', 'sd', 'grad')}} vis={st['visible']} err={st['errors'][:1]}", flush=True)
                if not good:
                    need(False, f"Start seed {sd}: {json.dumps({k: st[k] for k in ('key', 'v3', 'hudless', 'visible', 'fly', 'intro', 'glOpacity', 'errors', 't_motion')}, ensure_ascii=False)}")
            a.close()
            worlds = {}
            for r in runs: worlds[r['key']] = worlds.get(r['key'], 0) + 1
            places = {}
            for r in runs: places[r['place']] = places.get(r['place'], 0) + 1
            fb = sum(1 for r in runs if r['fallback'])
            rer = sum(r['rerolls'] for r in runs)
            res['A'] = {'n': len(runs), 'worlds': worlds, 'places': places, 'fallback': fb, 'rerolls': rer, 'runs': runs}
            json.dump(res['A'], open(os.path.join(os.path.dirname(__file__), 'results_v720_seeds.json'), 'w'), indent=1, ensure_ascii=False)
            need(len(runs) == N and all(not r['errors'] for r in runs), f"A {N} Starts ohne Seitenfehler")
            need(not any(r['v3'] for r in runs), "A nie 3D-Landschaft")
            need(all(r['hudless'] and not r['visible'] for r in runs), "A keine Bedienung/Einblendung sichtbar")
            need(all(r['fly'] for r in runs if r['world'] not in (7, 14, 15)), "A Welten mit Flug fliegen los")
            need(len(worlds) >= 10, f"A Welten-Verteilung: {len(worlds)} verschiedene {worlds}")
            need(fb <= N * 0.2, f"A Rückfall auf Startansicht {fb}/{N}, neu gewürfelt {rer}×, Orte {places}")
            need(all(r['t_motion'] is not None and r['t_motion'] < 9 for r in runs), f"A Bewegung beginnt ≤ 9 s nach dem Laden (max {max((r['t_motion'] or 99) for r in runs):.1f} s)")

        if 'B' in ONLY:
            a = App(p, query='nosw&seed=4').open('')
            pg = a.page
            # gespeicherte Einstellungen vorgeben, dann neu starten
            pg.evaluate("""() => localStorage.setItem('fraktal_v5_settings', JSON.stringify({ sv: 3, paletteId: 'gold', wpal: { c: 'gold' }, density: 1, anim: true, speed: 0.05, style: 0, setCol: 'bunt', inMode: 1, outMode: 'edge', edgeW: 100, flySpeed: 0.3, bulbStyle: 0, bulbFog: 0.15, startWorld: 'flug' }))""")
            for sd in (4, 9, 21):
                a.query = 'nosw&seed=%d' % sd; a.open(); wait_motion(pg)
                st = pg.evaluate(INFO)
                pg.evaluate("() => window.__fraktal.saveSettings()")
                s = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings'))")
                need(s['paletteId'] == 'gold' and s['speed'] == 0.05 and s['flySpeed'] == 0.3 and s['style'] == 0 and s['outMode'] == 'edge' and s['startWorld'] == 'flug',
                     f"B seed {sd} ({st['key']}, gewürfelt {st['pal']}/{st['style']}/{st['out']}/{st['flySpeed']}): gespeichert bleibt gold/0/edge/0,3 ({ {k: s.get(k) for k in ('paletteId', 'style', 'outMode', 'flySpeed', 'speed')} })")
            # eigene Änderung wird gespeichert
            pg.evaluate("() => { const A = window.__fraktal; A.S.palette = A.PAL.indexOf('inferno'); A.S.style = 3; A.saveSettings(); }")
            s = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings'))")
            need(s['style'] == 3 and (s['paletteId'] == 'inferno' or (s['wpal'] or {}).get(str(pg.evaluate('() => window.__fraktal.S.formula'))) == 'inferno'),
                 f"B eigene Änderung gespeichert (Stil 3, Palette inferno: {s.get('style')}, {s.get('paletteId')}, {s.get('wpal')})")
            need(not a.errors, f"B ohne Fehler {a.errors[:2]}")
            a.close()

        if 'C' in ONLY:
            a = App(p, query='nosw&seed=3').open(); pg = a.page
            wait_motion(pg)
            st = pg.evaluate(INFO)
            h = st['url'].lstrip('#')
            b = App(p, query='nosw').open(h); pg2 = b.page
            time.sleep(2)
            s2 = pg2.evaluate(INFO)
            need(s2['how'] == 'url' and pg2.evaluate("() => window.__fraktal.S.formula") == st['world'] and s2['pal'] == st['pal'] and s2['wp'] == st['wp'] and s2['style'] == st['style'],
                 f"C Link öffnet dieselbe Szene ({st['key']}, {st['pal']}, wp {st['wp']}, Stil {st['style']} -> {s2['pal']}, {s2['wp']}, {s2['style']})")
            need(not s2['fly'] and not s2['hudless'], "C Link: kein Flug, Bedienung sichtbar")
            need(not a.errors and not b.errors, f"C ohne Fehler {a.errors[:1]} {b.errors[:1]}")
            a.close(); b.close()

        if 'D' in ONLY:
            a = App(p, query='nosw&start=still').open(); pg = a.page
            time.sleep(3)
            st = pg.evaluate(INFO)
            need(st['mode'] == 'still' and not st['fly'] and not st['hudless'] and st['world'] >= 0, f"D ?start=still: Welt {st['key']}, kein Flug, Bedienung sichtbar")
            a.close()
            a = App(p, query='nosw&seed=12&zufall=0').open(); pg = a.page
            wait_motion(pg); st = pg.evaluate(INFO)
            only = pg.evaluate("() => !!window.__fraktal.START.plan.only")
            need(st['mode'] == 'flug' and st['hudless'] and only and st['style'] == 0 and st['out'] == 'edge', f"D ?zufall=0: Welt {st['key']} mit den eigenen Farben ({st['pal']}, Stil {st['style']}, Außen {st['out']}), Kino, Bewegung {st['motion']}")
            a.close()
            a = App(p).open(); pg = a.page
            time.sleep(2); st = pg.evaluate(INFO)
            need(st['mode'] == 'test' and pg.evaluate("() => window.__fraktal.S.formula") == 0 and not st['fly'] and not st['hudless'], "D Testautomation ohne Regler: Mandelbrot, kein Flug, Bedienung")
            pg.evaluate("() => localStorage.setItem('fraktal_v5_settings', JSON.stringify({ sv: 3, startWorld: 'random' }))")
            a.open(); time.sleep(1)
            need(pg.evaluate("() => window.__fraktal.S.startWorld") == 'flug', "D Einstellung 'random' (bis 7.1.14) -> 'flug'")
            a.close()

        if 'E' in ONLY:
            a = App(p, query='nosw&seed=2&noanim').open(); pg = a.page
            pg.evaluate("""() => { window.__z = []; const A = window.__fraktal; const f = (t) => { window.__z.push([t, Math.log10(A.S.cam.zoom), A.FLY.on ? A.FLY.sp : -1, A.START.motion || '']); if (window.__z.length < 2400) requestAnimationFrame(f); }; requestAnimationFrame(f); }""")
            time.sleep(9)
            z = pg.evaluate("() => window.__z")
            i0 = next((i for i, r in enumerate(z) if r[3]), None)
            if i0 is None:
                need(False, "E Flug startet")
            else:
                t0 = z[i0][0]
                sp = [(r[0] - t0, r[2]) for r in z[i0:] if r[2] >= 0]
                tgt = pg.evaluate("() => window.__fraktal.S.flySpeed")
                at = lambda T: min(sp, key=lambda q: abs(q[0] - T * 1000))[1]
                jumps = max(abs(sp[i][1] - sp[i - 1][1]) for i in range(1, len(sp)))
                need(at(0.5) < 0.1 * tgt and at(2.0) < 0.75 * tgt and at(4.6) > 0.9 * tgt and jumps < 0.02,
                     f"E Anfahrt S-Kurve 4 s: Tempo 0,5 s {at(0.5):.3f} / 2 s {at(2.0):.3f} / 4,6 s {at(4.6):.3f} von {tgt}, größter Sprung je Bild {jumps:.4f}")
            a.close()

        if 'F' in ONLY:
            a = App(p, query='nosw&seed=5&starthint=1').open(); pg = a.page
            wait_motion(pg)
            t0 = time.time(); seen = []
            while time.time() - t0 < 4.5:
                seen.append((time.time() - t0, pg.evaluate("() => +getComputedStyle(document.getElementById('start-hint')).opacity")))
                time.sleep(0.1)
            vis = [t for t, o in seen if o > 0.5]
            need(vis and vis[-1] - vis[0] <= 2.2, f"F Hinweis „Tippen für Menü“ sichtbar {vis[-1] - vis[0] if vis else 0:.1f} s (≤ 2 s + Blende), Text {pg.evaluate('() => document.getElementById(\"start-hint\").textContent')!r}")
            # Touch-Tipp zeigt die Bedienung
            pg.touchscreen.tap(200, 400)
            time.sleep(0.5)
            peek = pg.evaluate("() => document.body.classList.contains('hud-peek') && +getComputedStyle(document.getElementById('dock')).opacity > 0.5")
            time.sleep(3.3)
            gone = pg.evaluate("() => !document.body.classList.contains('hud-peek')")
            need(peek and gone and pg.evaluate("() => window.__fraktal.FLY.on"), "F Touch: Tipp zeigt die Bedienung 3 s, der Flug läuft weiter")
            a.close()
            a = App(p, query='nosw&seed=5', device='Desktop Chrome', extra_ctx={'viewport': {'width': 1440, 'height': 900}, 'has_touch': False, 'is_mobile': False}).open(); pg = a.page
            wait_motion(pg)
            pg.mouse.move(700, 400); pg.mouse.move(720, 420)
            time.sleep(0.4)
            need(pg.evaluate("() => document.body.classList.contains('hudless') && !document.body.classList.contains('hud-peek')"), "F Desktop: Mausbewegung holt die Bedienung nicht")
            pg.keyboard.press('h'); time.sleep(0.5)
            need(pg.evaluate("() => document.body.classList.contains('hud-peek')"), "F Desktop: Taste H zeigt die Bedienung")
            pg.keyboard.press('h'); pg.keyboard.press('Escape'); time.sleep(0.5)
            need(pg.evaluate("() => !document.body.classList.contains('hudless') && window.__fraktal.FLY.on"), "F Desktop: Esc beendet das Start-Kino, Flug läuft weiter")
            need(not a.errors, f"F ohne Fehler {a.errors[:2]}")
            a.close()

        if 'G' in ONLY:
            os.makedirs(SHOTS, exist_ok=True)
            for name, kw, sd in [('pixel7_hoch', {}, 3), ('pixel7_hoch2', {}, 16), ('pixel7_quer', {'landscape': True}, 3), ('pixel7_quer2', {'landscape': True}, 23),
                                 ('desktop', {'device': 'Desktop Chrome', 'extra_ctx': {'viewport': {'width': 1440, 'height': 900}}}, 7), ('desktop2', {'device': 'Desktop Chrome', 'extra_ctx': {'viewport': {'width': 1440, 'height': 900}}}, 11)]:
                a = App(p, query='nosw&seed=%d' % sd, **kw).open(); pg = a.page
                wait_motion(pg); time.sleep(3)
                st = pg.evaluate(INFO)
                pg.screenshot(path=os.path.join(SHOTS, f'{name}_seed{sd}_{st["key"]}.jpg'), quality=82)
                need(not st['visible'] and st['hudless'] and not a.errors, f"G {name} seed {sd} ({st['key']}): kein Overlay ({st['visible']})")
                a.close()

    print('GESAMT', 'OK' if ok else 'FEHLER')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
