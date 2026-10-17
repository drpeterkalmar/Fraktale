#!/usr/bin/env python3
"""7.1.10 – ⓘ-Faktenkarte je Welt (Peter 10.10.2026), Prüfung im Browser.

  A  Welt-Wähler: jede der 19 Welten-Kacheln hat ein ⓘ oben rechts, Tippfläche ≥ 48 px (Auftrag ≥ 32 px, Touch-Regel der App 48)
  B  Tipp auf ⓘ öffnet die Karte genau dieser Welt und wählt die Welt NICHT; schließen per ✕, Tipp daneben und Esc
  C  jede Karte (alle 19) öffnet, hat Formel, Zahlen und Quellen; Englisch auf Englisch
  D  Bildschirmfotos hoch und quer: Welt-Wähler, Karte Mandelbrot, Karte Menger-Schwamm (tests/shots/v7110/)
Aufruf: python3 tests/test_v7110.py [--only=A,B,…]   (Server: python3 tools/serve.py 8472)
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
fails, res = [], {}
OUT = os.path.join(os.path.dirname(__file__), 'results_v7110.json')
SHOTS = os.path.join(os.path.dirname(__file__), 'shots', 'v7110')


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg, flush=True)
    if not cond:
        fails.append(msg)


def open_picker(p, land=False, query='nosw&noanim'):
    a = App(p, landscape=land, query=query).open(); pg = a.page
    pg.evaluate("() => window.__fraktal.setMode(0)"); time.sleep(1.5)
    pg.click('#dock [data-tab="worlds"]'); time.sleep(1)
    return a, pg


def case_A(p):
    print('A  ⓘ auf jeder Welten-Kachel')
    a, pg = open_picker(p)
    r = pg.evaluate("""() => [...document.querySelectorAll('.mode-wrap')].map(w => { const c = w.querySelector('.mode-card').getBoundingClientRect(), i = w.querySelector('.mode-info');
        const b = i && i.getBoundingClientRect(); return i ? [+i.dataset.world, b.width, b.height, Math.round(c.right - b.right), Math.round(b.top - c.top)] : null; })""")
    res['A'] = r
    ws = sorted(x[0] for x in r if x)
    check(len(r) == 19 and ws == list(range(19)), f'19 Kacheln mit ⓘ (Welten {ws})')
    check(all(x[1] >= 47.5 and x[2] >= 47.5 for x in r), f'Tippfläche ≥ 48 px (Auftrag ≥ 32, Regel der App 48) (kleinste {min(min(x[1], x[2]) for x in r):.0f} px)')
    check(all(0 <= x[3] <= 12 and 0 <= x[4] <= 12 for x in r), 'ⓘ sitzt oben rechts in der Kachel')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_B(p):
    print('B  ⓘ wählt die Welt nicht; schließen per ✕, daneben, Esc')
    a, pg = open_picker(p)
    f0 = pg.evaluate("() => window.__fraktal.S.formula")
    pg.click('.mode-info[data-world="9"]'); time.sleep(0.4)
    st = pg.evaluate("() => [window.__fraktal.S.formula, document.getElementById('facts').hidden, document.getElementById('facts').dataset.world, document.getElementById('facts-title').textContent]")
    check(st[0] == f0 and not st[1] and st[2] == '9', f'ⓘ Menger: Karte offen ({st[3]}), Welt bleibt {st[0]}')
    pg.click('#facts-close'); time.sleep(0.2)
    h1 = pg.evaluate("() => document.getElementById('facts').hidden")
    pg.click('.mode-info[data-world="14"]'); time.sleep(0.3)
    pg.mouse.click(8, 8); time.sleep(0.2)
    h2 = pg.evaluate("() => [document.getElementById('facts').hidden, window.__fraktal.S.formula]")
    pg.click('.mode-info[data-world="6"]'); time.sleep(0.3)
    pg.keyboard.press('Escape'); time.sleep(0.2)
    h3 = pg.evaluate("() => [document.getElementById('facts').hidden, !document.getElementById('sheet').hidden || document.body.classList.contains('sheet-open')]")
    check(h1 and h2 == [True, f0] and h3[0], f'schließen: ✕ {h1}, Tipp daneben {h2}, Esc {h3[0]}')
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_C(p):
    print('C  alle 19 Karten, Englisch')
    a, pg = open_picker(p)
    out = []
    for w in range(19):
        pg.click(f'.mode-info[data-world="{w}"]'); time.sleep(0.15)
        out.append(pg.evaluate("() => { const b = document.getElementById('facts-body'); return [b.querySelector('.fx-f').textContent.length, b.querySelectorAll('li').length, b.querySelector('.fx-src').textContent]; }"))
        pg.click('#facts-close'); time.sleep(0.1)
    res['C'] = out
    check(all(o[0] > 5 and 2 <= o[1] <= 4 and len(o[2]) > 12 for o in out), f'19 Karten mit Formel, 2–4 Zahlen und Quellen')
    a.close()
    a = App(p, query='nosw&noanim').open(); pg = a.page
    pg.evaluate("() => { const A = window.__fraktal; A.S.lang = 'en'; A.saveSettings(); }"); pg.goto('about:blank'); a.open()
    pg.evaluate("() => window.__fraktal.setMode(0)"); time.sleep(1)
    pg.click('#dock [data-tab="worlds"]'); time.sleep(1)
    pg.click('.mode-info[data-world="0"]'); time.sleep(0.3)
    tx = pg.evaluate("() => document.getElementById('facts-body').textContent")
    check('Discovered' in tx and 'Did you know?' in tx and 'Sources' in tx and 'area' in tx, f'Englische Karte: {tx[:80]}…')
    pg.evaluate("() => { const A = window.__fraktal; A.S.lang = 'de'; A.saveSettings(); }")
    check(not a.errors, f'keine Fehler {a.errors[:2]}')
    a.close()


def case_D(p):
    print('D  Bildschirmfotos hoch/quer')
    os.makedirs(SHOTS, exist_ok=True)
    for land in (False, True):
        tag = 'quer' if land else 'hoch'
        a, pg = open_picker(p, land)
        pg.screenshot(path=os.path.join(SHOTS, f'waehler_{tag}.png'))
        for w, n in ((0, 'mandelbrot'), (9, 'menger')):
            pg.click(f'.mode-info[data-world="{w}"]'); time.sleep(0.5)
            box = pg.evaluate("() => { const r = document.getElementById('facts').getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; }")
            pg.screenshot(path=os.path.join(SHOTS, f'karte_{n}_{tag}.png'))
            check(box[0] >= 0 and box[1] <= box[2], f'{tag}: Karte {n} ganz sichtbar ({box[0]:.0f}–{box[1]:.0f} von {box[2]})')
            pg.click('#facts-close'); time.sleep(0.2)
        a.close()


if __name__ == "__main__":
  with sync_playwright() as p:
      for k, fn in [('A', case_A), ('B', case_B), ('C', case_C), ('D', case_D)]:
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
