#!/usr/bin/env python3
"""6.3: Gelände-Shader neu (Schleifen) gegen 6.2.0 (entrollt) – Pixelvergleich und Bildzeit auf exakt denselben Daten.

In derselben Seite wird eine zweite 3D-Instanz aus dem js/three.js von 6.2.0 erzeugt (Programme unter eigenem Namen),
beide zeichnen dieselben Ebenen, dieselbe Ansicht, denselben Look in voller Auflösung; verglichen wird der Canvas.
Gate: Abweichung ≤ 1/255 je Kanal in ≥ 99,5 % der Pixel. Zusätzlich Bildzeit (Wanduhr zwischen zwei readPixels über
20 Bilder, 6× im Wechsel, Minimum) – der neue Shader darf auf der GPU nicht spürbar langsamer sein.
Aufruf: python3 tests/compare_3d_shader.py [--old=/pfad/zu/6.2.0/js/three.js] [--quick] [--only=hoch|quer] [--scale=0.65]
(lokaler Server auf :8472; 6.2.0 z. B. per `git archive 933214a | tar -x -C /tmp/fraktale_v620`)
Ergebnis: tests/results_compare_3d_shader.json"""
import sys, os, json, time, base64, statistics
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

OLD = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--old=')), '/tmp/fraktale_v620/js/three.js')
QUICK = '--quick' in sys.argv
SCALE = float(next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--scale=')), 1))   # Bewegungsbild z. B. 0.65
ONLY = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--only=')), None)   # hoch|quer
VIEWS = [('ganz', '-0.6', '0', 1, 0), ('seepferd_300', '-0.7453', '0.1127', 300, 0),
         ('rand_1e9', '-0.743637214380908705', '0.131822306549061970', 1e9, 0), ('julia', '0', '0', 1.2, 1)]
LOOKS = [('standard', {}), ('ohne_glatt', {'smooth': False}), ('weiss', {'setCol': 'white'}), ('dunkel', {'setCol': 'dark'}),
         ('alpin_wald', {'setCol': 'white', 'alpine': True, 'valley': 'forest'}), ('alpin_see', {'setCol': 'white', 'alpine': True, 'valley': 'lake'})]

SETUP = r"""(src) => {
  const A = window.__fraktal;
  if (!window.FK3D_OLD) {
    const mod = src.replace('root.FK3D = { create, N3 };', 'root.FK3D_OLD = { create, N3 };')
                   .replace(/R\.program\('t3/g, "R.program('o3").replace(/R\.prewarm\('t3/g, "R.prewarm('o3")
                   .replace('R.onReleaseFrame = free;', '');
    (0, eval)(mod);
    window.__T3old = window.FK3D_OLD.create(A.R);
  }
  return true;
}"""
DRAW = r"""([smooth, scale]) => {
  // neu, alt, neu mit EINEM Satz Argumente (Ebenen, Ansicht, Höhen-Normierung) – nichts ändert sich dazwischen
  const A = window.__fraktal, gl = A.R.gl;
  const a = A.args3d(); if (smooth === false) a.o.smooth = false;
  const out = [];
  for (const T of [A.T3, window.__T3old, A.T3]) {
    T.scale = scale;
    T.render(a.L3, a.v, a.lk, undefined, a.o);
    const W = gl.canvas.width, H = gl.canvas.height, px = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
    out.push([W, H, btoa(s)]);
  }
  return out;
}"""
BENCH = r"""([which, smooth, n]) => {
  const A = window.__fraktal, gl = A.R.gl, T = which === 'old' ? window.__T3old : A.T3;
  const a = A.args3d(); if (smooth === false) a.o.smooth = false;
  T.scale = 0.65;
  const sync = () => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
  sync(); const t0 = performance.now();
  for (let i = 0; i < n; i++) T.render(a.L3, a.v, a.lk, undefined, a.o);
  sync(); return (performance.now() - t0) / n;
}"""


def setlook(pg, o):
    pg.evaluate("""(o) => { const A = window.__fraktal, S = A.S; S.setCol = o.setCol || 'black'; S.alpine = !!o.alpine; S.valley = o.valley || 'forest';
        S.palette = o.alpine ? A.PAL.indexOf('alpine') : 0; A.emit('settings'); A.RC.dirty = true; }""", o)


def img(r):
    W, H, b = r
    return np.frombuffer(base64.b64decode(b), dtype=np.uint8).reshape(H, W, 4)[:, :, :3].astype(np.int16)


def main():
    src = open(OLD, encoding='utf-8').read()
    out, ok = {'cases': []}, True
    with sync_playwright() as p:
        for land in ((False,) if QUICK else (False, True)):
            if ONLY and ONLY != ('quer' if land else 'hoch'): continue
            for h8 in ((False,) if QUICK else (False, True)):
                a = App(p, landscape=land)
                if h8:
                    a.page.add_init_script("""(() => { const g = WebGL2RenderingContext.prototype.getExtension;
                        WebGL2RenderingContext.prototype.getExtension = function (n) { return n === 'EXT_color_buffer_float' ? null : g.call(this, n); }; })()""")
                a.open(); pg = a.page
                pg.evaluate(SETUP, src)
                views = VIEWS[:2] if (QUICK or h8) else VIEWS
                for vn, cx, cy, z, f in views:
                    pg.evaluate(f"() => window.__fraktal.setMode({f}, true)")
                    pg.evaluate("() => window.__fraktal.set3d(true)"); time.sleep(1.5)
                    a.set_view(cx, cy, z); a.wait_done(120); time.sleep(4); a.wait_done(120)
                    pg.evaluate("() => { const A = window.__fraktal; A.V3.tilt = 45 * Math.PI / 180; A.V3.heading = 0.4; A.RC.dirty = true; }")
                    time.sleep(1.5)
                    looks = LOOKS[:2] if h8 else LOOKS
                    for ln, lo in looks:
                        setlook(pg, lo); time.sleep(0.8)
                        for tilt in (45, 60):
                            pg.evaluate(f"() => {{ window.__fraktal.V3.tilt = {tilt} * Math.PI / 180; }}")
                            sm = lo.get('smooth', None)
                            # Gegenprobe neu/alt/neu (stable = neu gegen neu identisch, sollte 100 % sein)
                            A, B, A2 = (img(x) for x in pg.evaluate(DRAW, [sm, SCALE]))
                            stab = float((np.abs(A - A2).max(axis=2) == 0).mean()) * 100
                            d = np.abs(A - B).max(axis=2)
                            c = dict(orient='quer' if land else 'hoch', h8=h8, view=vn, look=ln, tilt=tilt,
                                     within1=round(float((d <= 1).mean()) * 100, 3), max=int(d.max()), mean=round(float(d.mean()), 4), stable=round(stab, 3))
                            if tilt == 45 and not h8:
                                tn, to = [], []
                                for k in range(6):
                                    tn.append(pg.evaluate(BENCH, ['new', sm, 20])); to.append(pg.evaluate(BENCH, ['old', sm, 20]))
                                c.update(msNew=round(min(tn), 2), msOld=round(min(to), 2))
                            good = c['within1'] >= 99.5
                            ok &= good
                            out['cases'].append(c)
                            print(('ok  ' if good else 'FAIL'), json.dumps(c), flush=True)
                out.setdefault('errors', []).extend(a.errors)
                a.close()
    out['ok'] = ok and not out.get('errors')
    json.dump(out, open(os.path.join(os.path.dirname(__file__), 'results_compare_3d_shader' + ('_' + ONLY if ONLY else '') + ('_s%g' % SCALE if SCALE != 1 else '') + '.json'), 'w'), indent=1)
    print('GESAMT', 'ok' if out['ok'] else 'FAIL', 'Fehler:', out.get('errors'))
    sys.exit(0 if out['ok'] else 1)


if __name__ == '__main__':
    main()
