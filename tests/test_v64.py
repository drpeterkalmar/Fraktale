#!/usr/bin/env python3
"""6.4 Bunte Menge: Innen-Information (Periode, Multiplikator) ohne Einfluss auf die Rechnung draußen.

Prüft:  * Bunt an/aus: alle Außenwerte bitgleich, dieselben Punkte innen (GPU direkt, GPU Perturbation + BLA, CPU f64)
        * Stichproben innen: Hauptkardioide Periode 1, Periode-2-Kreis Periode 2 mit |λ| = 4|c+1|, Periode-3-Knospe,
          Mini-Mandelbrot bei 3·10⁹ Periode 266 – GPU und CPU gleich
        * Darstellung: Schwarz bleibt pixelgleich zu vorher (Bunt aus = 6.3), Bunt färbt das Innere (nicht schwarz),
          Inseln und Ringe unterscheiden sich
        * Bedienung: Knopf „Bunt“, Modus Inseln/Ringe, gespeichert (Neuladen), Link sc=b1 / sc=b2
        * 3D mit Bunt: Variante mit Innenfarbe, farbiger See, 0 Fehler
Aufruf: python3 tests/test_v64.py
"""
import sys, os, json, time, struct, io
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App, BASE
from playwright.sync_api import sync_playwright
from PIL import Image

PTS = [[int((i + 0.5) * 824 / 24), int((j + 0.5) * 1678 / 48)] for j in range(48) for i in range(24)]
VIEWS = [('direkt', '-0.6', '0', 1.0, 'gpu'), ('seepferd_300', '-0.7453', '0.1127', 300, 'gpu'),
         ('perturb_1e7', '-0.743637214380908705', '0.131822306549061970', 1e7, 'gpu'), ('mini_3e9', '-1.749974573019448626767866732590', '0', 3e9, 'gpu'),
         ('cpu_seepferd', '-0.7453', '0.1127', 300, 'cpu'), ('cpu_1e7', '-0.743637214380908705', '0.131822306549061970', 1e7, 'cpu')]


def dec(v):
    b = struct.unpack('<I', struct.pack('<f', v))[0]
    return (b >> 12) & 1023, (b & 4095) / 4095


def main():
    res, ok = {}, True
    chk = []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
    setc = lambda pg, sc, m=1: pg.evaluate(f"() => {{ const A = window.__fraktal; A.S.setCol = '{sc}'; A.S.inMode = {m}; A.invalidate(); A.emit('settings'); }}")
    with sync_playwright() as p:
        a = App(p).open(); pg = a.page
        # --- Außenwerte bitgleich, gleiche Innenpunkte
        for vn, cx, cy, z, eng in VIEWS:
            pg.evaluate(f"() => {{ window.__fraktal.S.renderer = '{'cpu' if eng == 'cpu' else 'auto'}'; }}")
            vals = {}
            # Vorlauf: der erste Lauf einer Ansicht rechnet ggf. noch mit einer vorläufigen Referenz
            setc(pg, 'black'); a.set_view(cx, cy, z); a.wait_done(300); time.sleep(0.3)
            setc(pg, 'black'); a.set_view(cx, cy, z * 1.000001); a.wait_done(300)
            for sc in ('black', 'bunt'):
                setc(pg, sc); a.set_view(cx, cy, z); a.wait_done(300); time.sleep(0.3)
                r = pg.evaluate("(p) => window.__fraktal.readFrontAt(p)", PTS)
                vals[sc] = r['values']; res.setdefault('engine', {})[vn] = r['kind'] + '/' + r['mode']
            ext_same = all((x == y) for x, y in zip(vals['black'], vals['bunt']) if x >= 0 or y >= 0)
            in_same = all((x < 0) == (y < 0) for x, y in zip(vals['black'], vals['bunt']))
            nin = sum(1 for x in vals['bunt'] if x < 0)
            known = sum(1 for x in vals['bunt'] if x < 0 and dec(x)[0] > 0)
            res[vn] = dict(exteriorBitEqual=ext_same, sameInterior=in_same, interior=nin, withInfo=known)
            need(ext_same and in_same, f'{vn} ({res["engine"][vn]}): Außenwerte bitgleich, gleiche Innenpunkte ({nin} innen, {known} mit Periode)')
            if vn in ('direkt', 'mini_3e9'): need(known >= 0.8 * nin, f'{vn}: Periode für ≥ 80 % der Innenpunkte ({known}/{nin})')
        pg.evaluate("() => { window.__fraktal.S.renderer = 'auto'; }")
        # --- Stichproben innen (Bildmitte): GPU und CPU
        probes = [('kardioide', '-0.1', '0.1', 1e3, 1, abs(1 - (1 - 4 * complex(-0.1, 0.1)) ** 0.5)),
                  ('periode2', '-1', '0.05', 1e3, 2, 4 * abs(complex(-1, 0.05) + 1)),
                  ('periode3', '-0.12', '0.75', 1e3, 3, None), ('mini266', '-1.749974573019448626767866732590', '0', 3e9, 266, 0.0)]
        for name, cx, cy, z, per, lam in probes:
            got = {}
            for eng in ('auto', 'cpu'):
                pg.evaluate(f"() => {{ window.__fraktal.S.renderer = '{eng}'; }}")
                setc(pg, 'bunt'); a.set_view(cx, cy, z); a.wait_done(300); time.sleep(0.2)
                got[eng] = dec(pg.evaluate("() => window.__fraktal.readFrontAt([[412, 839]])")['values'][0])
            res['probe_' + name] = got
            good = all(g[0] == per for g in got.values()) and (lam is None or all(abs(g[1] - lam) < 0.02 for g in got.values()))
            need(good, f'{name}: Periode {per}' + (f', |λ| {lam:.3f}' if lam is not None else '') + f' – GPU {got["auto"]}, CPU {got["cpu"]}')
        pg.evaluate("() => { window.__fraktal.S.renderer = 'auto'; }")
        # --- Darstellung: Gesamtbild schwarz/bunt
        pg.evaluate("() => { const A = window.__fraktal; A.S.anim = false; }")
        shots = {}
        for sc, m in (('black', 1), ('bunt', 1), ('bunt', 2)):
            setc(pg, sc, m); a.set_view('-0.6', '0', 1); a.wait_done(120); time.sleep(0.5)
            pg.evaluate("() => window.__fraktal.snapshot()")
            shots[f'{sc}{m}'] = Image.open(io.BytesIO(pg.locator('#gl').screenshot())).convert('RGB')
        W, H = shots['black1'].size
        px = lambda im, x, y: im.getpixel((int(x * W), int(y * H)))
        card = (0.75, 0.5)     # rechts in der Hauptkardioide
        cb, cu1, cu2 = px(shots['black1'], *card), px(shots['bunt1'], *card), px(shots['bunt2'], *card)
        res['pixel_kardioide'] = dict(schwarz=cb, inseln=cu1, ringe=cu2)
        need(max(cb) < 30 and max(cu1) > 60, f'Kardioide: Schwarz {cb} -> Inseln farbig {cu1}')
        diff = sum(1 for x in range(0, W, 8) for y in range(0, H, 8) if sum(abs(u - v) for u, v in zip(shots['bunt1'].getpixel((x, y)), shots['bunt2'].getpixel((x, y)))) > 30)
        need(diff > 50, f'Inseln und Ringe unterscheiden sich ({diff} Stichproben)')
        # --- Bedienung: Knopf, Modus, Speichern, Link
        setc(pg, 'black')
        pg.click('#dock [data-tab="colors"], #dock button[data-sheet="colors"]') if pg.locator('#dock [data-tab="colors"], #dock button[data-sheet="colors"]').count() else None
        pg.evaluate("() => { document.querySelector('#seg-setcol button[data-v=\"bunt\"]').click(); }")
        time.sleep(0.3)
        ui = pg.evaluate("() => ({ sc: window.__fraktal.S.setCol, seg: !document.getElementById('seg-inmode').hidden, hint: !document.getElementById('in-hint').hidden, url: window.__fraktal.stateURL() })")
        need(ui['sc'] == 'bunt' and ui['seg'] and ui['hint'] and 'sc=b1' in ui['url'], f'Knopf Bunt: Modus-Wahl sichtbar, Link sc=b1 ({ui["url"][-40:]})')
        pg.evaluate("() => { document.querySelector('#seg-inmode button[data-v=\"2\"]').click(); }")
        time.sleep(1.5)     # Link in der Adresszeile wird höchstens alle 0,7 s nachgeführt
        u2 = pg.evaluate("() => ({ m: window.__fraktal.S.inMode, url: window.__fraktal.stateURL() })")
        need(u2['m'] == 2 and 'sc=b2' in u2['url'], f'Modus Ringe: Link sc=b2')
        pg.reload(wait_until='load'); pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
        kept = pg.evaluate("() => [window.__fraktal.S.setCol, window.__fraktal.S.inMode]")
        need(kept == ['bunt', 2], f'nach Neuladen gespeichert: {kept}')
        base = BASE + '?nosw&noanim'
        pg.goto(base + '#m=0&x=-0.6&y=0&z=1&sc=b1', wait_until='load'); pg.reload(wait_until='load')
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
        lk = pg.evaluate("() => [window.__fraktal.S.setCol, window.__fraktal.S.inMode, window.__fraktal.look().inner]")
        need(lk == ['bunt', 1, 1], f'Link sc=b1 -> Bunt, Inseln {lk}')
        pg.goto(base + '#m=0&x=-0.6&y=0&z=1', wait_until='load'); pg.reload(wait_until='load')
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
        lk = pg.evaluate("() => [window.__fraktal.S.setCol, window.__fraktal.look().inner]")
        need(lk == ['black', 0], f'Link ohne sc -> Schwarz {lk}')
        # --- 3D mit Bunt
        a.wait_done(120)
        setc(pg, 'bunt', 1); a.set_view('-0.6', '0', 1); a.wait_done(120)
        pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(2.0); a.wait_done(120); time.sleep(1.5)
        v3 = pg.evaluate("() => ({ on: window.__fraktal.view3dInfo().on, variant: window.__fraktal.T3.variant })")
        need(v3['on'] and v3['variant'] == 't3terrB', f'3D mit Bunt: Variante {v3["variant"]}')
        res['errors'] = a.errors
        need(not a.errors, f'0 Page-/Console-Fehler {a.errors[:3]}')
        a.close()
    print(json.dumps(res, indent=1, default=str))
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
