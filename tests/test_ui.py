#!/usr/bin/env python3
"""UI-Test (Pixel 7, Hoch- und Querformat): alle Tabs, HUD, Hilfe, Teilen, Julia-Pad, alle 8 Modi.

Prüft: 0 Page-/Console-Fehler, sichtbare Bedienelemente >= 48 px (Touch-Ziel), jeder Modus rendert
ein nicht-leeres Bild, Sprache DE/EN umschaltbar. Legt Screenshots in tests/shots/ ab.
Aufruf: python3 tests/test_ui.py
"""
import sys, os, io, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image, ImageStat
SHOTS = os.path.join(os.path.dirname(__file__), 'shots')
os.makedirs(SHOTS, exist_ok=True)

TARGETS = """() => {
  const bad = [];
  document.querySelectorAll('button, input, select, canvas#cpad, #minimap canvas').forEach(e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('[hidden]')) return;
    if (e.type === 'checkbox' || e.type === 'range') return;   // Schalter/Slider: ganze Zeile ist Ziel (>= 52 px)
    if (Math.min(r.width, r.height) < 47.5) bad.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  document.querySelectorAll('label.toggle, label.slider').forEach(l => { const r = l.getBoundingClientRect(); if (r.height && r.height < 47.5) bad.push('label ' + Math.round(r.height)); });
  return bad;
}"""


def shot(pg, name):
    pg.screenshot(path=os.path.join(SHOTS, name + '.png'))


def canvas_std(pg):
    im = Image.open(io.BytesIO(pg.locator('#gl').screenshot())).convert('L')
    return ImageStat.Stat(im).stddev[0]


def run():
    ok, report = True, {}
    with sync_playwright() as p:
        for land in (False, True):
            tag = 'landscape' if land else 'portrait'
            a = App(p, landscape=land, query='nosw').open()
            pg = a.page
            a.wait_done(60)
            pg.wait_for_timeout(400)
            shot(pg, f'{tag}_01_start')
            bad = []
            for i, tab in enumerate(['worlds', 'colors', 'places', 'more']):
                sel = f'.dock-btn[data-tab={tab}]' if i == 0 else f'#sheet-tabs [data-tab={tab}]'
                pg.click(sel); pg.wait_for_timeout(650)
                bad += pg.evaluate(TARGETS)
                shot(pg, f'{tag}_0{i + 2}_{tab}')
            pg.click('#sheet-close'); pg.wait_for_timeout(450)
            pg.click('#hud-pill'); pg.wait_for_timeout(350); bad += pg.evaluate(TARGETS); shot(pg, f'{tag}_06_hud'); pg.click('#hud-pill')
            pg.click('#btn-share'); pg.wait_for_timeout(300); bad += pg.evaluate(TARGETS); shot(pg, f'{tag}_07_share'); pg.click('#btn-share')
            if not land:
                # Deep Zoom mit Relief + andere Palette, Julia mit c-Pad, Hilfe, Englisch
                pg.evaluate("() => { const A = window.__fraktal; A.S.relief = true; A.S.palette = 7; A.invalidate(); }")
                a.set_view('-0.743637215354753236002154', '0.131822307028445564243233', 1e15); a.wait_done(120)
                shot(pg, f'{tag}_08_deep1e15_relief_gold')
                pg.evaluate("() => { const A = window.__fraktal; A.S.relief = false; A.S.palette = 0; A.invalidate(); A.setMode(1); }")
                a.wait_done(60); pg.click('#julia-chip'); pg.wait_for_timeout(700); shot(pg, f'{tag}_09_julia_pad')
                pg.click('#sheet-close'); pg.wait_for_timeout(400)
                pg.click('.dock-btn[data-tab=more]'); pg.wait_for_timeout(500); pg.click('#btn-help'); pg.wait_for_timeout(600); shot(pg, f'{tag}_10_help')
                pg.click('#modal-close'); pg.wait_for_timeout(400)
                pg.select_option('#sel-lang', 'en'); pg.wait_for_timeout(300)
                en = pg.locator('#sheet-tabs [data-tab=worlds]').inner_text()
                shot(pg, f'{tag}_11_english'); pg.select_option('#sel-lang', 'de'); pg.click('#sheet-close')
                report['lang_en_tab'] = en
                ok &= en == 'Worlds'
                # alle 8 Modi
                stds = {}
                for m in range(8):
                    pg.evaluate(f"() => window.__fraktal.setMode({m})")
                    if m in (6, 7): pg.wait_for_timeout(2500)
                    else: a.wait_done(90)
                    stds[m] = round(canvas_std(pg), 1)
                    if m in (2, 5, 6, 7): shot(pg, f'{tag}_12_mode{m}')
                report['mode_stddev'] = stds
                ok &= all(v > 8 for v in stds.values())
                # Newton tief (CPU-f64-Pfad)
                pg.evaluate("() => window.__fraktal.setMode(5)")
                a.set_view('0.2', '0.35', 1e6); a.wait_done(120)
                report['newton_deep_plan'] = a.status()['plan']
            report[tag] = dict(small_targets=sorted(set(bad)), errors=a.errors)
            ok &= not bad and not a.errors
            a.close()
    return report, ok


if __name__ == '__main__':
    r, ok = run()
    print(json.dumps(r, indent=1))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)
