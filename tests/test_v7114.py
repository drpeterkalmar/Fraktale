#!/usr/bin/env python3
"""7.1.14: Screenshot in Kacheln bei laufendem Farbverlauf (Peter: Striche im 46449 × 21528-Bild).

Bis 7.1.13 färbte capture.js jede 2D-Kachel mit look() zum Zeitpunkt der Kachel – der Farbverlauf (S.cycle) lief weiter,
jede Kachelzeile bekam eine andere Farbphase → waagrechte Streifen. Soll: Farbverlauf zu Beginn eingefroren.

Prüft mit Farbanimation AN (Tempo 0,8 Umläufe/s) und kleinen Kacheln (64 px), dass die Kachelkanten nicht stärker
springen als das übrige Bild: mittlerer Zeilen-/Spaltensprung an den Kanten ≤ 1,5 × übriges Bild. Ganze Menge (Zoom 1)
und tief (GPU-Perturbation). Gemessen: 7.1.13 Kanten 44,3 gegen 1,6 (ganz) bzw. 26,9 gegen 12,4 (tief); 7.1.14 1,7/1,5 bzw. 11,6/12,4.
Aufruf: python3 tests/test_v7114.py   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

T = 64
SEAM = """async ([o, tile]) => {
  const A = window.__fraktal;
  A.S.anim = true; A.S.speed = 0.8;
  const r = await A.captureShot(o);
  const bm = await createImageBitmap(r.blob); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0);
  const d = g.getImageData(0, 0, bm.width, bm.height).data, W = bm.width, H = bm.height;
  const px = (x, y, k) => d[4 * (y * W + x) + k];
  let se = 0, sn = 0, oe = 0, on = 0;
  for (let y = 1; y < H; y++) { let m = 0; for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) m += Math.abs(px(x, y, k) - px(x, y - 1, k)); m /= 3 * W;
    if (y % tile === 0) { se += m; sn++; } else { oe += m; on++; } }
  for (let x = 1; x < W; x++) { let m = 0; for (let y = 0; y < H; y++) for (let k = 0; k < 3; k++) m += Math.abs(px(x, y, k) - px(x - 1, y, k)); m /= 3 * H;
    if (x % tile === 0) { se += m; sn++; } else { oe += m; on++; } }
  return { seam: se / sn, rest: oe / on, tiles: r.tiles, ms: r.ms, W, H };
}"""


def main():
    ok, chk = True, []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c); print(chk[-1], flush=True)
    res = {}
    with sync_playwright() as p:
        app = App(p, device='Desktop Chrome', query='nosw').open('m=0&x=-0.5&y=0&z=1')
        pg = app.page
        for name, view in [('ganz', ('-0.6', '0', 1)),
                           ('tief', ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139', 1e9))]:
            app.set_view(*view); app.wait_done(180)
            r = pg.evaluate(SEAM, [dict(W=640, H=384, tile=T, label=False), T])
            res[name] = r
            print(name, json.dumps(r), flush=True)
            need(r['tiles'] > 20, f'{name}: in Kacheln gerendert ({r["tiles"]})')
            need(r['seam'] <= 1.5 * r['rest'] + 0.5, f'{name}: Kachelkanten {r["seam"]:.2f} ≤ 1,5 × übriges Bild {r["rest"]:.2f}')
        need(not app.errors, 'keine Seiten-/Konsolenfehler ' + str(app.errors[:3]))
        app.close()
    json.dump({'ok': ok, 'checks': chk, 'res': res}, open(os.path.join(os.path.dirname(__file__), 'results_v7114.json'), 'w'), indent=1, ensure_ascii=False)
    print('OK' if ok else 'FEHLER')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
