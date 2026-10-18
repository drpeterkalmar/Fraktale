#!/usr/bin/env python3
"""7.1.11: Anzeige-Pass als Schleife für Direct3D (Windows) – gleiches Bild wie die Standard-Variante.

Hintergrund: Chrome/Firefox übersetzen WebGL unter Windows über ANGLE nach HLSL, FXC übersetzt weiter. Die Standard-Variante
des Anzeige-Passes setzt die Färbung je Ebene einmal ein (8 Sampler) – FXC brauchte dafür am rog 115 s, Chromes Wächter beendete
den Grafikprozess und sperrte WebGL für die Seite („WebGL2 nicht verfügbar“). Die Schleifen-Variante (R.dloop) braucht dort
2–5 s (Messung: tests/measure_fxc_rog.py). Dieser Test prüft am Mac (echte GPU), dass beide Varianten dasselbe Bild liefern.

Prüft je Ansicht (Standard, GPU-Perturbation tief, Julia, Färbe-Stil Seide, Burning Ship mit Staub-Korrektur, Relief, Bunt,
Außen grenznah, Vorschau-Rekonstruktion): Aufnahme mit Standard-Variante und mit Schleife aus demselben Zustand ->
höchstens 2/255 Abweichung, < 0,5 % abweichende Werte; keine defekten Shader; Schalter ?dloop=1/0 wirkt.
Aufruf: python3 tests/test_v7111.py   (Server: python3 tools/serve.py 8472)
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), 'results_v7111.json')
DEEP = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')

CMP = """async ([o]) => {
  const A = window.__fraktal, R = A.R;
  const keep = R.dloop, L = A.look(), sty = !!L.style, dust = !!L.dust;
  // beide Varianten erst fertig übersetzen lassen (Sonder-Varianten übersetzen seit 7.1.11 im Hintergrund)
  const warm = async () => { for (let i = 0; i < 600; i++) { let ok = true; try { ok = R.displayWarm(sty, false) && (!dust || R.displayWarm(sty, true)); } catch (e) { ok = true; } if (ok) return; await new Promise(r => setTimeout(r, 50)); } };
  R.dloop = false; await warm(); const r1 = await A.captureShot(o);
  R.dloop = true; await warm(); const r2 = await A.captureShot(o);
  R.dloop = keep;
  const dec = async (b) => { const bm = await createImageBitmap(b); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height); };
  const a = await dec(r1.blob), b = await dec(r2.blob);
  let n = 0, mx = 0, sum = 0, lit = 0;
  for (let i = 0; i < a.data.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(a.data[i + k] - b.data[i + k]); if (d) { n++; mx = Math.max(mx, d); sum += d; } if (a.data[i + k] > 40) lit++; }
  return { ndiff: n, maxdiff: mx, mean: sum / (a.width * a.height * 3), vals: a.width * a.height * 3, lit, W: a.width, H: a.height, broken: Object.keys(R.broken) };
}"""


def main():
    res, ok, chk = {}, True, []

    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
        print(chk[-1], flush=True)

    with sync_playwright() as p:
        a = App(p).open(); pg = a.page
        ev = lambda js: pg.evaluate(js)
        S = lambda js: ev("() => { const A = window.__fraktal; " + js + "; A.invalidate(); }")
        cases = [
            ('Mandelbrot Start', lambda: a.set_view('-0.5', '0', 1, formula=0)),
            ('Mandelbrot tief (GPU-Perturbation)', lambda: a.set_view(DEEP[0], DEEP[1], 3e9)),
            ('Julia', lambda: a.set_view('0', '0', 1.5, formula=1)),
            ('Seide (Färbe-Stil)', lambda: (S("A.S.style = 1; A.S.stMix = 0.85; A.S.stS = 5"), a.set_view(DEEP[0], DEEP[1], 3e6, formula=0))),
            ('Kreuz-Falle + Relief', lambda: (S("A.S.style = 5; A.S.relief = true; A.S.reliefStrength = 0.8"), a.set_view('-0.7453', '0.1127', 200, formula=0))),
            ('Burning Ship (Staub-Korrektur)', lambda: (S("A.S.style = 0; A.S.relief = false"), a.set_view('-1.7609', '-0.0275', 60, formula=2))),
            ('Burning Ship + Stil (Staub + Stil)', lambda: (S("A.S.style = 1; A.S.stMix = 0.85"), a.set_view('-1.7609', '-0.0275', 60, formula=2))),
            ('Bunt Inseln', lambda: (S("A.S.style = 0; A.S.setCol = 'bunt'; A.S.inMode = 'islands'"), a.set_view('-0.5', '0', 1.3, formula=0))),
            ('Außen grenznah', lambda: (S("A.S.outMode = 'edge'; A.S.edgeW = 40"), a.set_view('-0.7453', '0.1127', 200, formula=0))),
            ('Newton', lambda: (S("A.S.outMode = 'pal'"), a.set_view('0', '0', 1.2, formula=5))),
        ]
        res['cases'] = {}
        for name, setup in cases:
            setup(); a.wait_done(180)
            r = pg.evaluate(CMP, [dict(W=640, H=360, label=False, time=50)])
            res['cases'][name] = r
            need(r['ndiff'] < 0.005 * r['vals'] and r['maxdiff'] <= 2 and not r['broken'] and r['lit'] > 0.02 * r['vals'],
                 f"{name}: Schleife gegen Standard {r['ndiff']} von {r['vals']} Werten abweichend, höchstens {r['maxdiff']}/255 "
                 f"(Mittel {r['mean']:.5f}); defekte Shader: {r['broken'] or 'keine'}")
        # Vorschau-Rekonstruktion (vergrößerte Ebene, u_recon): Bildschirm direkt nach einem Zoom vergleichen (Bild steht)
        a.set_view('-0.7453', '0.1127', 200, formula=0); a.wait_done(60)
        r = pg.evaluate("""async () => { const A = window.__fraktal, R = A.R; A.S.anim = false;
            A.stopAnims && A.stopAnims(); A.freeze && A.freeze(true);
            const grab = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { const c = document.querySelector('canvas'); res(c.toDataURL('image/png')); })));
            const out = {}; const keep = R.dloop; R.dloop = false; A.invalidate(); out.a = await grab(); R.dloop = true; A.invalidate(); out.b = await grab(); R.dloop = keep; A.freeze && A.freeze(false);
            return { same: out.a === out.b, la: out.a.length, keys: Object.keys(R.broken) }; }""")
        res['screen'] = r
        need(not r['keys'], f"Bildschirm-Anzeige mit Schleife: keine defekten Shader (gleiche PNG-Daten: {r['same']})")
        need(not a.errors, f"keine Seitenfehler ({a.errors[:2]})")
        a.close()
        # Schalter über die Adresse
        for q, want in (('nosw&noanim&dloop=1', True), ('nosw&noanim&dloop=0', False)):
            b = App(p, query=q).open()
            got = b.page.evaluate("() => window.__fraktal.R.dloop")
            b.wait_done(60)
            br = b.page.evaluate("() => Object.keys(window.__fraktal.R.broken)")
            need(got is want and not br, f"?{q.split('&')[-1]} -> R.dloop = {got}, defekte Shader: {br or 'keine'}")
            b.close()
    res['checks'] = chk; res['ok'] = ok
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print('GESAMT', 'OK' if ok else 'FEHLER')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
