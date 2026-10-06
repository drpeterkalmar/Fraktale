"""Aufräumen aus dem Gutachten (P3, ab 6.5.4), was einen Browser braucht.
  * Zähler: S.cycle bleibt < 1000, S.time < 86400 (Wert knapp unter der Grenze setzen, ein Bild abwarten)
  * Vollbild-Knopf: sichtbar, wenn der Browser Vollbild kann; ausgeblendet ohne (iPhone, per Init-Skript nachgestellt)
  * Orte-Vorschaubild in 3D zeigt die 3D-Ansicht (Himmel oben), nicht das 2D-Bild
Aufruf: python3 tests/test_p3.py
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ok = True
chk = []
def need(c, what):
    global ok
    chk.append(('ok   ' if c else 'FAIL ') + what); ok &= bool(c)

with sync_playwright() as p:
    a = App(p, query='nosw').open()      # Farbanimation an (ohne noanim)
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => { const S = window.__fraktal.S; S.time = 86400 - 0.0005; S.cycle = 1000 - 0.00001; }")
    time.sleep(0.5)
    t, c = pg.evaluate("() => [window.__fraktal.S.time, window.__fraktal.S.cycle]")
    need(0 <= t < 5 and 0 <= c < 5, f'Zähler laufen um: time {t:.3f}, cycle {c:.4f}')
    need(pg.is_visible('#btn-fullscreen'), 'Vollbild-Knopf sichtbar (Browser kann Vollbild)')
    # Orte-Vorschau in 3D: gespeichertes Vorschaubild gegen ein frisch gezeichnetes 3D-Bild (gleicher Ausschnitt)
    import base64, io
    from PIL import Image, ImageStat
    def top(url):
        im = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGB')
        return ImageStat.Stat(im.crop((0, 0, im.width, im.height // 4))).mean
    SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
    a.set_view(SEA[0], SEA[1], 1e4); a.wait_done(60)
    pg.evaluate("() => window.__fraktal.set3d(true)"); a.wait_3d(60); a.wait_done(60); time.sleep(1.0)
    urls = pg.evaluate("""() => { const A = window.__fraktal; document.getElementById('btn-save-place').click();
        const saved = JSON.parse(localStorage.getItem('fraktal_v5_places'))[0].thumb;
        A.settle3d(); A.snapshot();
        const src = A.R.canvas, c = document.createElement('canvas'); c.width = 176; c.height = 110;
        const sw = src.width, sh = src.height, k = c.width / c.height; let w = sw, h = sw / k; if (h > sh) { h = sh; w = sh * k; }
        c.getContext('2d').drawImage(src, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, c.width, c.height);
        return [saved, c.toDataURL('image/jpeg', 0.8)]; }""")
    m_s, m_3 = top(urls[0]), top(urls[1])
    diff = sum(abs(x - y) for x, y in zip(m_s, m_3))
    need(diff < 20, f'Orte-Vorschau in 3D = 3D-Bild (oberes Viertel gespeichert {[round(x) for x in m_s]} vs 3D {[round(x) for x in m_3]})')
    need(not a.errors, f'0 Fehler {a.errors[:3]}')
    a.close()
    a = App(p)
    a.page.add_init_script("Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });")
    a.open()
    need(not a.page.is_visible('#btn-fullscreen') and a.page.evaluate("() => document.getElementById('btn-fullscreen2').hidden"), 'ohne Vollbild-Schnittstelle: beide Vollbild-Knöpfe ausgeblendet')
    need(not a.errors, f'0 Fehler (ohne Vollbild) {a.errors[:3]}')
    a.close()
print('\n'.join(chk))
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
