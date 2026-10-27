#!/usr/bin/env python3
"""Peter 27.10.2026: „Fraktale fliegen noch immer in die Menge“ – realer 2D-Zufallsflug (keine erzwungene Schärfe),
je Sonde: Phase, Abstand Bildmitte (dF) und Zoompunkt (dA) zur Menge, Anteil Inneres im Bild (inFrac).
Aufruf: python3 tests/measure_menge_flug.py [secs=60] [orte=…] [q=&…]   (Server: python3 -m http.server 8472)
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) for a in sys.argv[1:] if '=' in a)
SECS = float(ARGS.get('secs', 60))
Q = ARGS.get('q', '')
ORTE = [('Seepferdchental', '-0.743643887037158704752191506114774', '0.131825904205311970493132056385139', '1e3'),
        ('Elefantental', '0.2925755', '-0.0149977', '1e3'),
        ('Kardioide', '-0.7487', '0.0647', '30'),
        ('Ganz', '-0.5', '0', '1')]
if 'orte' in ARGS:
    ORTE = [o for o in ORTE if o[0] in ARGS['orte'].split(',')]

REC = """(ms) => new Promise(res => { const A = window.__fraktal, F = A.FLY, t0 = performance.now();
  A.frameStats(true); A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false }); F.rec = []; F.recM = [];
  const E = []; let tE = 0;
  const f = () => { const t = performance.now() - t0;
    // unabhängig von der Sonde (CPU): liegt ein Mengenrand ±0,04 Bildhälften um die Bildmitte?
    if (t - tE > 500 && t > 3000) { tE = t; E.push(!!A.ZUFALL.centerOnEdge(A.HP.toNumber(A.S.cam.cx), A.HP.toNumber(A.S.cam.cy), A.S.cam.zoom, A.S.formula)); }
    if (t < ms) { requestAnimationFrame(f); return; }
    const fs = A.frameStats(false); const M = F.recM.slice(); A.stopFly();
    res({ M, randMitte: E.length ? E.filter(Boolean).length / E.length : null, nE: E.length, probeOk: A.T3.probeReady(), broken: Object.keys(A.R.broken || {}),
          coarse: fs.frames.length ? fs.frames.filter(x => x.coarse > 0.1).length / fs.frames.length : null }); };
  requestAnimationFrame(f); })"""


def summ(M):
    M = [m for m in M if m.get('hasDE') and not m.get('d3')]
    n = len(M)
    if not n:
        return {'n': 0}
    fr = lambda g: round(sum(1 for m in M if g(m)) / n, 3)
    ph = {}
    for m in M:
        p = m['ph'] or '-'
        d = ph.setdefault(p, [0, 0, 0, 0.0])
        d[0] += 1
        d[1] += m['dF'] == 0
        d[2] += m['dA'] == 0
        d[3] += m['inFrac'] or 0
    return {'n': n, 'mitteInnen': fr(lambda m: m['dF'] == 0), 'zoompunktInnen': fr(lambda m: m['dA'] == 0),
            'bildHalbSchwarz': fr(lambda m: (m['inFrac'] or 0) > 0.5), 'bildSchwarzOe': round(sum(m['inFrac'] or 0 for m in M) / n, 3),
            'zoom': [M[0]['z'], max(m['z'] for m in M), M[-1]['z']],
            'phasen': {p: {'n': d[0], 'mitteInnen': round(d[1] / d[0], 2), 'zpInnen': round(d[2] / d[0], 2), 'schwarzOe': round(d[3] / d[0], 2)} for p, d in ph.items()}}


def main():
    res = []
    with sync_playwright() as p:
        for name, x, y, z in ORTE:
            a = App(p, query='nosw&noanim' + Q).open(f'm=0&x={x}&y={y}&z={z}')
            a.wait_done(120)
            r = a.page.evaluate(REC, SECS * 1000)
            s = summ(r['M']); s['ort'] = name; s['coarse'] = r['coarse']; s['errors'] = a.errors[:3]
            for k in ('randMitte', 'nE', 'probeOk', 'broken'):
                s[k] = r[k]
            a.close()
            print(json.dumps(s, ensure_ascii=False), flush=True)
            res.append({**s, 'M': r['M']})
    json.dump(res, open(os.path.join(os.path.dirname(__file__), 'results_menge_flug' + ARGS.get('tag', '') + '.json'), 'w'))


if __name__ == '__main__':
    main()
