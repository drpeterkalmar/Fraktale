#!/usr/bin/env python3
"""6.7 E3: TAA im Flug beurteilen – Frame-Serie eines echten Flugs, alle Varianten auf EXAKT denselben Daten.

1. Ein Zufallsflug (Tempo 0,5) wird 600 Bilder lang (10 s bei 60 Hz) Bild für Bild aufgezeichnet (Kamera, Kurs, Neigung,
   Schräglage).
2. Wiedergabe Bild für Bild (je rAF ein Schritt). In jedem Schritt zeichnen zusätzliche 3D-Instanzen (FK3D.create, wie
   compare_3d_shader.py) dieselben Ebenen, dieselbe Ansicht – jede mit eigener TAA-History:
     ohne TAA (Skala 0,65 wie Handy) · TAA 0,65 · TAA 0,55 [· TAA 0,7 nur --s07]
   Bei den Aufnahme-Bildern wird nach jeder Instanz der Canvas gelesen (JPEG), dazu eine Referenz: Stillstandsbild der
   Haupt-Instanz (16 Bilder gemittelt) derselben Ansicht in der Renderskala 0,65 (--refscale): so misst die Abweichung nur,
   was TAA zeitlich falsch macht (Nachziehen, Geister, Zittern) – gegen volle Auflösung gewönne ein treppiges Bild, weil ein
   sauber geglättetes 0,65-Bild zwangsläufig weicher ist als die Referenz.
Messwerte je Aufnahme: mittlere Abweichung (0..255) zur Referenz – gesamt, an Kanten (Gradient der Referenz > 12) und im
oberen Bilddrittel (Horizont); Flimmern = mittlere Änderung zwischen Bild 300 und 301 an Kanten minus derselben Änderung der
Referenz (Bewegung herausgerechnet, Rest = zeitliches Flimmern); Nachzieh-Prüfung: Abweichung zur Referenz an Kanten in den
Bildern direkt nach der schnellsten Drehung.
Collagen: tests/shots/technik/taa_<ori>_<start>[_horizont|_mitte].jpg, Zahlen: tests/results_taa_<ori>_<start>.json.
Aufruf (Server :8472, sichtbares Fenster): FK_HEADED=1 python3 tests/taa_series.py [--land] [--start=tal|rand|alpin]
"""
import sys, os, time, json, base64, io
sys.path.insert(0, os.path.dirname(__file__))
from shots_tech import App, sync_playwright, HIDE, OUT, grid, crop, look, SEA, RAND, GANZ, arg
from PIL import Image
import numpy as np

CAPS = [60, 150, 240, 300, 301, 360, 450, 540, 598, 599]
REC_JS = """(n) => new Promise((res) => {
  const A = window.__fraktal; window.__rec = [];
  A.S.flySpeed = 0.5; A.startFly(undefined, { d3: true });
  const tick = () => { const c = A.S.cam; window.__rec.push({ cx: c.cx, cy: c.cy, zoom: c.zoom, h: A.V3.heading, t: A.V3.tilt, r: A.FLY.roll || 0 });
    if (window.__rec.length >= n || !A.FLY.on) { A.stopFly(); res(window.__rec.length); return; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})"""
# Varianten-Instanzen anlegen; Wiedergabe mit Aufnahmen
SETUP_JS = """(vars) => {
  const A = window.__fraktal;
  window.__T = vars.map(([name, taa, sc, par]) => { const T = self.FK3D.create(A.R, Object.assign({}, A.T3.flags, { taa })); T.scale = sc; T.setStage(A.S.quality); T.gridDiv = A.T3.gridDiv; T.__par = par || null; return [name, T]; });
  window.__taa0 = Object.assign({}, self.FK3DTech.TAA);
  window.__caps = {};
  return window.__T.length;
}"""
PLAY_JS = """(caps) => new Promise((res) => {
  const A = window.__fraktal, R = window.__rec, gl = A.R.gl;
  let i = 0;
  const set = (k) => { const s = R[Math.min(k, R.length - 1)]; A.setCam(s.cx, s.cy, s.zoom); A.V3.heading = s.h; A.V3.tilt = s.t; A.FLY.roll = s.r; A.invalidate(); };
  set(0);
  const grab = () => gl.canvas.toDataURL('image/jpeg', 0.93);
  const tick = () => {
    if (i >= R.length) { res(i); return; }
    set(i);
    const a = A.args3d();
    const cap = caps.includes(i);
    for (const [name, T] of window.__T) {
      Object.assign(self.FK3DTech.TAA, window.__taa0, T.__par || {});      // Abstimm-Varianten (--tune)
      T.render(a.L3, a.v, a.lk, undefined, a.o);
      if (cap) (window.__caps[name] = window.__caps[name] || {})[i] = grab();
    }
    if (cap) {    // Referenz: Stillstandsbild der Haupt-Instanz, 16 Bilder gemittelt, volle Auflösung
      for (let n = 0; n < 16; n++) A.T3.render(a.L3, a.v, a.lk, undefined, Object.assign({}, a.o, { still: { n, N: 16, mix2: 0, scale: window.__refScale } }));
      (window.__caps['Referenz'] = window.__caps['Referenz'] || {})[i] = grab();
      A.V3.accKey = null;
    }
    i++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})"""


def gray(im):
    return np.asarray(im.convert('L'), dtype=np.float32)


def main():
    land = bool(arg('land', False)); ori = 'quer' if land else 'hoch'; sname = arg('start', 'tal')
    start = {'tal': (SEA, dict(setcol='black', palette='neon')), 'rand': (RAND, dict(setcol='black', palette='neon')),
             'alpin': (GANZ, dict(setcol='white', alpine=True, valley='forest', palette='alpine'))}[sname]
    variants = [('ohne TAA 0,65', False, 0.65), ('TAA 0,65', True, 0.65), ('TAA 0,55', True, 0.55)]
    if arg('s07', False): variants.append(('TAA 0,7', True, 0.7))
    if arg('tune', False):     # Abstimmung: Gewicht des neuen Bilds / Klemmung
        variants = [('ohne TAA 0,65', False, 0.65), ('TAA c', True, 0.65, {'alpha': 0.15, 'alphaMax': 0.35, 'gamma': 0.75}),
                    ('TAA d', True, 0.65, {'alpha': 0.3, 'alphaMax': 0.5, 'gamma': 0.75}), ('TAA e', True, 0.65, {'alpha': 0.4, 'alphaMax': 0.6, 'gamma': 1.0})]
    names = [v[0] for v in variants] + ['Referenz']
    d = os.path.join(OUT, 'roh', 'taa'); os.makedirs(d, exist_ok=True)
    with sync_playwright() as p:
        a = App(p, landscape=land, query='nosw&noanim').open(); pg = a.page
        pg.evaluate(HIDE)
        v, lk = start
        a.set_view(*v); a.wait_done(120)
        pg.evaluate("() => window.__fraktal.set3d(true)"); a.wait_3d(40); a.wait_done(120)
        look(pg, **lk); time.sleep(2); a.wait_done(120); time.sleep(1)
        nrec = pg.evaluate(REC_JS, 600)
        print('aufgezeichnet', nrec, 'Bilder', flush=True)
        caps = [c for c in CAPS if c < nrec]
        pg.evaluate("() => { const A = window.__fraktal; A.V3.testStill = { N: 0 }; }")   # Haupt-Instanz: keine Mittelung dazwischen
        pg.evaluate(SETUP_JS, [list(x) + [None] * (4 - len(x)) for x in variants])
        pg.evaluate(f"() => {{ window.__refScale = {float(arg('refscale', 0.65))}; }}")
        t0 = time.time()
        pg.evaluate(PLAY_JS, caps)
        print('Wiedergabe %.1f s' % (time.time() - t0), flush=True)
        raw = pg.evaluate("() => window.__caps")
        info = pg.evaluate("() => window.__T.map(([n, T]) => [n, T.info()])")
        pg.evaluate("() => { const A = window.__fraktal; A.V3.testStill = null; }")
        errs = a.errors
        a.close()
    ims, files = {}, {}
    for n in names:
        for c in caps:
            b = base64.b64decode(raw[n][str(c)].split(',', 1)[1])
            im = Image.open(io.BytesIO(b)).convert('RGB').transpose(Image.FLIP_TOP_BOTTOM) if False else Image.open(io.BytesIO(b)).convert('RGB')
            fn = os.path.join(d, f'{ori}_{sname}_{n.replace(" ", "").replace(",", "")}_{c:03d}.jpg'); im.save(fn, quality=92)
            ims[(n, c)] = im; files[(n, c)] = fn
    res = {'ori': ori, 'start': sname, 'caps': caps, 'frames': nrec, 'variants': {}, 'info': info, 'errors': errs}
    ref = {c: gray(ims[('Referenz', c)]) for c in caps}
    edges = {}
    for c in caps:
        gy, gx = np.gradient(ref[c]); edges[c] = np.hypot(gx, gy) > 12
    H = ref[caps[0]].shape[0]
    for n, *_ in variants:
        m = []
        for c in caps:
            dd = np.abs(gray(ims[(n, c)]) - ref[c])
            m.append(dict(frame=c, all=round(float(dd.mean()), 2), edge=round(float(dd[edges[c]].mean()), 2) if edges[c].any() else None, top=round(float(dd[: H // 3].mean()), 2)))
        r = {'perFrame': m, 'mean': {k: round(float(np.mean([x[k] for x in m if x[k] is not None])), 2) for k in ('all', 'edge', 'top')}}
        if 300 in caps and 301 in caps:
            e = edges[300] | edges[301]
            dv = np.abs(gray(ims[(n, 300)]) - gray(ims[(n, 301)]))[e].mean()
            dr = np.abs(ref[300] - ref[301])[e].mean()
            r['flicker'] = round(float(dv - dr), 2)
        if 598 in caps and 599 in caps:
            e = edges[598] | edges[599]
            r['flicker598'] = round(float(np.abs(gray(ims[(n, 598)]) - gray(ims[(n, 599)]))[e].mean() - np.abs(ref[598] - ref[599])[e].mean()), 2)
        res['variants'][n] = r
        print(n, json.dumps(r['mean']), 'Flimmern', r.get('flicker'), r.get('flicker598'), flush=True)
    json.dump(res, open(os.path.join(os.path.dirname(__file__), f'results_taa_{ori}_{sname}.json'), 'w'), indent=1)
    show = [c for c in (150, 300, 450, 599) if c in caps]
    grid([[files[(n, c)] for n in names] for c in show], os.path.join(OUT, f'taa_{ori}_{sname}.jpg'), s=0.22 if not land else 0.18,
         labels=names, rlabels=['Bild %d' % c for c in show])
    for nm, box in (('horizont', (0.0, 0.05, 0.5, 0.3)), ('mitte', (0.25, 0.4, 0.75, 0.6))):
        grid([[crop(files[(n, c)], box) for n in names] for c in show], os.path.join(OUT, f'taa_{ori}_{sname}_{nm}.jpg'), s=0.7,
             labels=names, rlabels=['Bild %d' % c for c in show])
    print('Fehler:', errs or 'keine')


if __name__ == '__main__':
    main()
