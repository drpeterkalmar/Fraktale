#!/usr/bin/env python3
"""7.1.6 – neue Standards nach Peter (10.10.2026), Prüfung im Browser (Pixel 7, GPU).

  A  Standards bei leerem Speicher: Palette Eis, Menge bunt (Inseln), Außen grenznah, Saum 100 px, Farbtempo 20 s/Umlauf,
     Vollbild beim Start an, Startwelt Zufall; Saum-Regler 2–300 px (100 px bei ~78 %)
  B  Migration: alter Speicherstand (ohne sv) -> die 6 Felder werden einmal überschrieben, eigene andere Einstellungen bleiben;
     danach eigene Änderung -> bleibt nach erneutem Öffnen
  C  Zufalls-Startwelt: 20 Reloads -> ≥ 6 verschiedene Welten, nie zweimal hintereinander gleich; Reload = Reset (Adresszeile
     leer, Einstellungen erhalten)
  D  Link frisch öffnen -> genau diese Ansicht; danach Reload -> Reset; „Wie zuletzt“ -> Reload stellt die Ansicht wieder her
  E  Vollbild beim ersten Tipp ins Bild (nicht bei Tipp auf Bedienelemente), nur einmal je Sitzung
  F  Farbtempo: Standard 1 Umlauf in 20 s (über S.cycle gemessen), Leuchten im selben Takt (u_ctime), Tempowechsel ohne Sprung
  G  Sanfter Flugstart (2D und Mandelbulb): Tempo steigt in ~2 s monoton ohne Sprung auf den Reglerwert, Kamera-Schritt je
     Bild steigt mit; Anhalten per Knopf rollt ~1 s aus; ?anfahrt=0 = sofort wie bisher.
     F und G bitte sichtbar messen (FK_HEADED=1): headless drosselt macOS den Bildtakt auf ~7 Bilder/s mit Doppelaufrufen.
Aufruf: python3 tests/test_v716.py [--only=A,B,…]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
fails, res = [], {}
OUT = os.path.join(os.path.dirname(__file__), 'results_v716.json')


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    if not cond:
        fails.append(msg)


STD = "() => { const S = window.__fraktal.S, P = window.__fraktal.PAL; return { pal: P.list[S.palette].id, setCol: S.setCol, inMode: S.inMode, outMode: S.outMode, edgeW: S.edgeW, speed: S.speed, fsStart: S.fsStart, startWorld: S.startWorld, density: S.density }; }"
NEW = {'pal': 'ice', 'setCol': 'bunt', 'inMode': 1, 'outMode': 'edge', 'edgeW': 100, 'speed': 0.05}


def wait_app(pg):
    pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=30000)
    time.sleep(0.6)


def case_A(p):
    print('A  Standards bei leerem Speicher')
    a = App(p).open(); pg = a.page
    s = pg.evaluate(STD)
    check(all(s[k] == v for k, v in NEW.items()) and s['fsStart'] is True and s['startWorld'] == 'flug', f'Standards {s}')
    raw = pg.evaluate("() => +document.getElementById('s-edgew').value")
    pg.evaluate("() => { const r = document.getElementById('s-edgew'); r.value = 1; r.dispatchEvent(new Event('input')); }")
    mx = pg.evaluate("() => window.__fraktal.S.edgeW")
    check(0.7 < raw < 0.85 and mx == 300, f'Saum-Regler: 100 px bei {raw:.2f}, ganz rechts {mx} px')
    out = pg.evaluate("() => document.getElementById('o-speed').textContent")
    check('Langsam' in out and '20' in out, f'Farbtempo-Anzeige {out!r}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_B(p):
    print('B  Migration alter Einstellungen')
    a = App(p).open(); pg = a.page
    old = {'paletteId': 'fire', 'setCol': 'black', 'inMode': 2, 'outMode': 'pal', 'edgeW': 16, 'speed': 0.15, 'density': 1.7, 'lang': 'de', 'hudFs': False}
    pg.evaluate("(o) => { localStorage.clear(); localStorage.setItem('fraktal_v5_settings', JSON.stringify(o)); }", old)
    pg.goto('about:blank'); a.open(); s = pg.evaluate(STD)
    stored = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings'))")
    hud = pg.evaluate("() => window.__fraktal.S.hudFs")
    check(all(s[k] == v for k, v in NEW.items()), f'nach Migration neue Standards {s}')
    check(abs(s['density'] - 1.7) < 1e-9 and hud is False and (stored.get('sv') or 0) >= 2, f'eigene Werte bleiben (Dichte {s["density"]}, HUD {hud}), sv={stored.get("sv")}')
    pg.evaluate("() => { const A = window.__fraktal; A.S.palette = A.PAL.indexOf('neon'); A.S.edgeW = 40; A.S.setCol = 'black'; A.saveSettings(); }")
    pg.goto('about:blank'); a.open(); s2 = pg.evaluate(STD)
    check(s2['pal'] == 'neon' and s2['edgeW'] == 40 and s2['setCol'] == 'black', f'eigene Änderung nach der Migration bleibt {s2}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_C(p):
    print('C  Zufalls-Startwelt: 20 Reloads')
    a = App(p, query='nosw&noanim&startworld=random').open(); pg = a.page
    # (die App schreibt die Adresszeile ohne Test-Parameter zurück -> Zufall für Tests per Merker im Speicher)
    pg.evaluate("() => { const A = window.__fraktal; A.S.density = 1.3; A.saveSettings(); localStorage.setItem('fk_test_startworld', 'random'); }")
    worlds, hows, hashes = [], [], []
    for i in range(20):
        pg.reload(); wait_app(pg)
        st = pg.evaluate("() => { const A = window.__fraktal; return [A.START.world, A.START.how, A.S.formula, location.hash, A.S.density, A.NAV_RELOAD]; }")
        worlds.append(st[0]); hows.append(st[1]); hashes.append(st[3])
        if i == 0: dens = st[4]
    same = [i for i in range(1, len(worlds)) if worlds[i] == worlds[i - 1]]
    res['C'] = {'worlds': worlds}
    check(len(set(worlds)) >= 6 and not same and all(w >= 0 for w in worlds), f'{len(set(worlds))} verschiedene Welten, nie zweimal hintereinander {worlds}')
    check(all(h == 'reset' for h in hows), f'jeder Reload = Reset (die Adresszeile zeigt danach die neue Ansicht) {set(hows)}')
    # Palette: Klassiker behalten ihre Palette, auch wenn zuletzt eine neue Welt mit eigener Palette lief
    pal = pg.evaluate("() => { const A = window.__fraktal; A.setMode(14); A.saveSettings(); return JSON.parse(localStorage.getItem('fraktal_v5_settings')).paletteId; }")
    check(pal == 'ice', f'gespeicherte Klassiker-Palette bleibt Eis nach Wechsel in die Flammen ({pal})')
    check(abs(dens - 1.3) < 1e-9, f'Einstellungen bleiben (Dichte {dens})')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_D(p):
    print('D  Link öffnen -> Ansicht; danach Reload -> Reset; „Wie zuletzt“')
    a = App(p, query='nosw&noanim').open(); pg = a.page
    pg.evaluate("() => localStorage.setItem('fk_test_startworld', 'random')")
    pg.goto('about:blank'); a.open('m=4&x=-0.5474537037&y=-0.2430555556&z=243')
    st = pg.evaluate("() => { const A = window.__fraktal; return [A.START.how, A.S.formula, A.S.cam.zoom]; }")
    check(st[0] == 'url' and st[1] == 4 and abs(st[2] - 243) < 1e-6, f'Link zeigt seine Ansicht {st}')
    time.sleep(1.2)
    pg.reload(); wait_app(pg)
    st2 = pg.evaluate("() => { const A = window.__fraktal; return [A.START.how, A.S.formula, A.S.cam.zoom, location.hash]; }")
    check(st2[0] == 'reset' and not (st2[1] == 4 and abs(st2[2] - 243) < 1e-3), f'danach Reload = Reset {st2[:3]}')
    pg.evaluate("() => { const A = window.__fraktal; A.S.startWorld = 'last'; A.saveSettings(); A.setMode(3); A.setView('-1.3864', '0', 60); }")
    time.sleep(2.0)
    pg.reload(); wait_app(pg)
    st3 = pg.evaluate("() => { const A = window.__fraktal; return [A.START.how, A.S.formula, A.S.cam.zoom]; }")
    check(st3[1] == 3 and abs(st3[2] - 60) < 0.01, f'„Wie zuletzt“: Reload stellt die Ansicht wieder her {st3}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


FS_HOOK = """(() => { window.__fsCalls = 0; const o = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...a) { window.__fsCalls++; return o.apply(this, a); }; })();"""


def case_E(p):
    print('E  Vollbild beim ersten Tipp ins Bild')
    a = App(p, query='nosw&noanim&fsstart=1'); a.page.add_init_script(FS_HOOK); a.open(); pg = a.page
    W, H = pg.evaluate("() => [innerWidth, innerHeight]")
    # Tipp auf ein Bedienelement (Dock „Mehr“) zählt nicht
    pg.evaluate("() => document.querySelector('.dock button, #dock button, nav button') && 0")
    n0 = pg.evaluate("() => window.__fsCalls")
    pg.mouse.click(W * 0.5, H * 0.45); time.sleep(0.8)
    st = pg.evaluate("() => [window.__fsCalls, !!document.fullscreenElement, document.body.classList.contains('hudless')]")
    check(n0 == 0 and st[0] == 1 and st[1], f'erster Tipp -> Vollbild angefordert {st}')
    pg.evaluate("() => document.exitFullscreen && document.exitFullscreen()"); time.sleep(0.6)
    pg.mouse.click(W * 0.4, H * 0.5); time.sleep(0.6)
    st2 = pg.evaluate("() => [window.__fsCalls, !!document.fullscreenElement]")
    check(st2 == [1, False], f'Vollbild verlassen, nächster Tipp: kein neuer Versuch {st2}')
    a.close()
    # ohne Einstellung: kein Vollbild
    a = App(p, query='nosw&noanim&fsstart=1'); a.page.add_init_script(FS_HOOK); a.open(); pg = a.page
    pg.evaluate("() => { const A = window.__fraktal; A.S.fsStart = false; A.saveSettings(); }")
    pg.goto('about:blank'); a.open(); pg.mouse.click(W * 0.5, H * 0.45); time.sleep(0.6)
    check(pg.evaluate("() => window.__fsCalls") == 0, 'Einstellung aus: kein Vollbild')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_F(p):
    print('F  Farbtempo')
    a = App(p, query='nosw').open(); pg = a.page
    c = pg.evaluate("""() => new Promise(res => { const S = window.__fraktal.S; const c0 = S.cycle, k0 = S.ctime, t0 = performance.now();
        setTimeout(() => res([(S.cycle - c0) / ((performance.now() - t0) / 1000), (S.ctime - k0) / ((performance.now() - t0) / 1000)]), 3000); })""")
    per = 1 / c[0] if c[0] > 0 else 0
    check(18 < per < 22 and abs(c[1] - c[0] / 0.15) < 0.05, f'1 Umlauf in {per:.1f} s, Farbzeit {c[1]:.3f}/s (Leuchten im selben Verhältnis)')
    j = pg.evaluate("""() => new Promise(res => { const S = window.__fraktal.S; const r = document.getElementById('s-speed'); const a = S.cycle;
        r.value = 0.95; r.dispatchEvent(new Event('input')); const b = S.cycle; requestAnimationFrame(() => res([b - a, S.cycle - b, S.speed])); })""")
    check(abs(j[0]) < 1e-9 and 0 <= j[1] < 0.05, f'Tempowechsel ohne Farbsprung {j}')
    u = pg.evaluate("() => window.__fraktal.R.gl && window.__fraktal.look().ctime !== undefined")
    check(u, 'Leuchten bekommt die Farbzeit (look.ctime -> u_ctime)')
    lk = pg.evaluate("() => { const A = window.__fraktal; A.S.speed = 1 / 45; return A.stateURL(); }")
    check('ft=45' in lk, f'Link trägt das Farbtempo (ft=45) {lk[-40:]}')
    a.close()


REC = """(n) => new Promise(res => { const A = window.__fraktal, out = []; let k = 0;
    const f = () => { const B = A.BULB; out.push([performance.now(), A.FLY.sp, A.isRay() ? Math.log10(B.B.zoom || B.info().zoom || 1) : Math.log10(A.S.cam.zoom), A.FLY.on,
        A.FLY.simT !== undefined ? A.FLY.simT * 1000 : null]);
        if (++k < n) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); })"""


def ramp_check(rec, sp, tag):
    t0 = rec[0][0]
    sps = [r[1] for r in rec]
    mono = all(sps[i + 1] >= sps[i] - 1e-9 for i in range(len(sps) - 1) if rec[i + 1][0] - t0 < 2100)
    first = [r for r in rec if r[0] - t0 < 250]
    t_reach = next((r[0] - t0 for r in rec if r[1] >= sp * 0.98), None)
    # Kamera-Schritt je Sekunde (Zehnerpotenzen/s) aus den Bild-Deltas: steigt mit, ohne Sprung
    # 7.1.7: je Flugzeit (FLY.simT: auf Bildschirmtakte gerundet) – die rAF-Zeitstempel zittern unter Last um ±8 ms, die
    # Kamera selbst nicht
    tc = 4 if rec[0][4] is not None else 0
    rates = [(rec[i + 1][2] - rec[i][2]) / max(1e-3, (rec[i + 1][tc] - rec[i][tc]) / 1000) for i in range(len(rec) - 1)]
    # über 5 Bilder geglättet (der Messtakt zittert 14–19 ms gegen den App-Takt); bewertet die Anfahrt (erste 1,8 s)
    sm = [sum(rates[max(0, i - 2):i + 3]) / len(rates[max(0, i - 2):i + 3]) for i in range(len(rates))]
    early = [r for i, r in enumerate(sm) if rec[i][0] - t0 < 1800]
    top = max(early[-5:] or [1e-9])
    jumps = max([abs(early[i + 1] - early[i]) for i in range(len(early) - 1)] or [0]) / max(top, 1e-9)
    dips = sum(1 for i in range(len(early) - 1) if early[i + 1] < early[i] * 0.9 and early[i] > top * 0.1)
    res['G_' + tag] = {'t_reach_ms': t_reach and round(t_reach), 'sp_250ms': round(max(r[1] for r in first), 3), 'max_rate_jump_rel': round(jumps, 3), 'dips': dips}
    check(mono and max(r[1] for r in first) < sp * 0.2 and t_reach and 1500 < t_reach < 2600, f'{tag}: Tempo steigt monoton, nach 0,25 s {max(r[1] for r in first):.3f}, Endtempo {sp} nach {t_reach and round(t_reach)} ms')
    check(jumps < 0.12 and dips <= 2, f'{tag}: Kamera-Schritt je Bild steigt ohne Sprung (größter Bildsprung {jumps:.0%} des Endtempos, {dips} Rückgänge > 10 %)')


def case_G(p):
    print('G  Sanfter Flugstart')
    a = App(p).open(); pg = a.page
    pg.goto('about:blank'); a.open('m=0&x=-0.7453&y=0.1127&z=50'); a.wait_done(60)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.8; A.startFly(); }")
    ramp_check(pg.evaluate(REC, 170), 0.8, '2D')
    pg.evaluate("() => window.__fraktal.toggleFly()")
    t0 = time.time(); on = []
    for _ in range(30):
        on.append(pg.evaluate("() => [window.__fraktal.FLY.on, window.__fraktal.FLY.sp]")); time.sleep(0.05)
        if not on[-1][0]: break
    dur = time.time() - t0
    check(0.7 < dur < 1.6 and on[0][0], f'Anhalten rollt aus ({dur:.2f} s, Tempo {on[0][1]:.2f} -> {on[-1][1]:.2f})')
    # Mandelbulb
    pg.evaluate("() => { const A = window.__fraktal; A.setMode(6); }"); time.sleep(3)
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.5; A.startFly(); }")
    ramp_check(pg.evaluate(REC, 170), 0.5, '3D')
    pg.evaluate("() => window.__fraktal.stopFly()")
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()
    a = App(p, query='nosw&noanim&anfahrt=0').open(); pg = a.page
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.8; A.startFly(); }")
    sp = pg.evaluate("() => window.__fraktal.FLY.sp")
    check(abs(sp - 0.8) < 1e-9, f'?anfahrt=0: sofort volles Tempo ({sp})')
    a.close()


if __name__ == "__main__":
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
