#!/usr/bin/env python3
"""Flug im tiefen Mandelbrot (Peter 20.10.2026: „ab ein paar Quintillionen fängt der Flug an zu pixeln“) – erst messen, dann fixen.

Je Stelle (Seepferdchental = Zoom-Wanderpunkt walk_1e41, Minibrot = Kern, den der Orbit-Worker dort als Referenz wählt) und Zoom
(10¹², 10¹⁵, 10¹⁷, 10¹⁸, 10¹⁹, 10²⁰): Ansicht öffnen, fertig rechnen lassen (Anteil der Pixel, die die f32-Fehlerschätzung zur
CPU-f64-Nachrechnung schickt = status().fix.pct, Zeit bis fertig), dann N s Autopilot (2D-Flug, Tempo 0,3, Lavalampe wie
eingestellt). Je Bild: grob (> 10 % des Schirms < 0,5 Pufferpx/Bildpx, Pop-Metrik frameStats), harte Wechsel; alle 0,25 s:
Rechenweg, Referenzorbit (Kennung, Rechenzeit, Länge, Methode, Bits), BLA-Umkreis, Iterationsgrenze, Häppchen, Bremse/Phase.
Größen je Lauf: coarse, hard, fps, refs (neue Referenzen), refMs (Mittel/Max), refWait (Anteil Proben mit laufender Anfrage),
bla (BLA-Neubauten), maxIter, lz0 -> lz1 (Zoom), brake (Anteil Bilder außerhalb des Reiseflugs), fixPct, doneS.
Aufruf: FK_HEADED=1 python3 tests/measure_deep_fly.py [--zooms=1e12,1e15,1e17,1e18,1e19,1e20] [--locs=see,mini] [--reps=2]
        [--secs=15] [--query=…] [--tag=…]   -> tests/results_deep_fly_<tag>.json + Tabelle
"""
import sys, os, json, time, math
sys.path.insert(0, os.path.dirname(__file__))
import e2e_lib
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
if 'base' in ARGS:
    e2e_lib.BASE = ARGS['base']
ZOOMS = [float(z) for z in ARGS.get('zooms', '1e12,1e15,1e17,1e18,1e19,1e20').split(',')]
LOCS = ARGS.get('locs', 'see,mini').split(',')
REPS = int(ARGS.get('reps', 2)); SECS = float(ARGS.get('secs', 15)); TAG = ARGS.get('tag', 'cur'); EXTRA = ARGS.get('query', '')
WALK = ('-0.74363721535475353201560573969820799606042412635682', '0.13182230702844485014116030906137622412768064249224')

REC = """(ms) => new Promise(res => { const A = window.__fraktal, t0 = performance.now(); A.frameStats(true);
  const smp = []; let nf = 0, lastS = -1e9;
  const f = (t) => { nf++;
    if (t - lastS >= 250) { lastS = t; const r = A.REF.cur, j = A.RC.job, L = A.FLY.lava;
      smp.push({ t: Math.round(t - t0), lz: +Math.log10(A.S.cam.zoom).toFixed(3), plan: A.plan().kind + '/' + A.plan().mode, ref: r ? r.id : null, refMs: r ? r.ms : null, len: r ? r.lenA : null,
                 method: r ? r.method : null, period: r ? r.period : null, refZ: r ? +Math.log10(r.zoom).toFixed(2) : null, pend: !!A.REF.pending, cmax: r && r.blaCmax ? +r.blaCmax.toExponential(2) : null,
                 bla: !!(r && r.bla32), mi: A.currentMaxIter(), job: j ? j.mode + ':' + j.stage : '', ph: L ? L.phase : '', g: +A.GOV.g.toFixed(2), px: A.R.chunkInfo().pxMove }); }
    if (t - t0 < ms) requestAnimationFrame(f); else res({ smp, nf, fs: A.frameStats() }); }; requestAnimationFrame(f); })"""


def run(p, cx, cy, z):
    a = App(p, query='nosw&noanim' + ('&' + EXTRA if EXTRA else '')).open(f'm=0&x={cx}&y={cy}&z={z:.6g}'.replace('+', ''))
    pg = a.page
    try:
        t, st = a.wait_done(300)
    except Exception:
        t, st = None, a.status()
    pre = {'doneS': round(t, 1) if t else None, 'fix': st.get('fix'), 'plan': st.get('plan'), 'ref': st.get('ref'), 'useBLA': st.get('useBLA'), 'maxIter': st.get('maxIter')}
    pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false }); }")
    d = pg.evaluate(REC, int(SECS * 1000))
    fr = d['fs']['frames']
    coarse = sum(1 for f in fr if f['coarse'] > 0.1) / max(1, len(fr))
    smp = d['smp']
    ids = [s['ref'] for s in smp if s['ref'] is not None]
    newRefs = len(set(ids)) - (1 if ids else 0)
    ms = [s['refMs'] for s in smp if s['refMs'] is not None]
    refMs = sorted(set((s['ref'], s['refMs']) for s in smp if s['refMs'] is not None))
    cm = [s['cmax'] for s in smp]
    bla = sum(1 for i in range(1, len(cm)) if cm[i] != cm[i - 1] and smp[i]['ref'] == smp[i - 1]['ref'])
    ph = {}
    for s in smp: ph[s['ph']] = ph.get(s['ph'], 0) + 1
    out = dict(pre, coarse=round(coarse, 4), hard=d['fs']['hard'], fps=round(d['nf'] / SECS, 1), refs=newRefs,
               refMs=round(sum(m for _, m in refMs) / max(1, len(refMs))) if refMs else None, refMsMax=max([m for _, m in refMs] or [0]),
               refWait=round(sum(1 for s in smp if s['pend']) / max(1, len(smp)), 3), bla=bla, mi=[smp[0]['mi'], smp[-1]['mi']] if smp else None,
               lz0=smp[0]['lz'] if smp else None, lz1=smp[-1]['lz'] if smp else None, plans=sorted(set(s['plan'] for s in smp)),
               methods=sorted(set(str(s['method']) for s in smp)), brake=round(sum(v for k, v in ph.items() if k and k != 'cruise') / max(1, len(smp)), 3),
               coarseZ=[(round(math.log10(f['z']), 1)) for f in fr if f['coarse'] > 0.1][:1], errors=a.errors[:3])
    # grobe Bilder je halbe Zehnerpotenz Zoom (wo im Flug wird es grob?)
    bins = {}
    for f in fr:
        b = math.floor(math.log10(f['z']) * 2) / 2
        n, c = bins.get(b, (0, 0)); bins[b] = (n + 1, c + (1 if f['coarse'] > 0.1 else 0))
    out['coarseByZoom'] = {str(k): round(c / n, 3) for k, (n, c) in sorted(bins.items())}
    out['samples'] = smp[::4]
    if 'mini' not in out:
        out['refPoint'] = pg.evaluate("() => { const A = window.__fraktal, r = A.REF.cur; return r ? [A.HP.toString(r.refXb, 60), A.HP.toString(r.refYb, 60), r.method, r.period] : null; }")
    a.close()
    return out


def main():
    res = {'tag': TAG, 'query': EXTRA, 'secs': SECS, 'runs': []}
    with sync_playwright() as p:
        locs = {'see': WALK}
        if 'mini' in LOCS:
            # Minibrot: Kern, den der Orbit-Worker bei 10¹⁵ am Wanderpunkt als Referenz wählt
            a = App(p).open(f'm=0&x={WALK[0]}&y={WALK[1]}&z=1e15')
            a.wait_done(200)
            rp = a.page.evaluate("() => { const A = window.__fraktal, r = A.REF.cur; return r ? [A.HP.toString(r.refXb, 60), A.HP.toString(r.refYb, 60), r.method, r.period] : null; }")
            a.close()
            print('Minibrot-Kern:', rp, flush=True)
            locs['mini'] = (rp[0], rp[1])
            res['mini'] = rp
        for loc in LOCS:
            for z in ZOOMS:
                for rep in range(REPS):
                    r = run(p, locs[loc][0], locs[loc][1], z)
                    r.update(loc=loc, zoom=z, rep=rep)
                    res['runs'].append(r)
                    print(f"{loc:4s} {z:.0e} #{rep + 1}: grob {r['coarse'] * 100:5.1f} %  hart {r['hard']}  {r['fps']} B/s  Zoom 10^{r['lz0']}→10^{r['lz1']}  "
                          f"Ref neu {r['refs']} ({r['refMs']}/{r['refMsMax']} ms, wartet {r['refWait'] * 100:.0f} %)  BLA {r['bla']}  maxIter {r['mi']}  "
                          f"Bremse {r['brake'] * 100:.0f} %  {r['plans']}  fertig {r['doneS']} s, Fix {r['fix']}  grob je Zoom {r['coarseByZoom']} {r['errors']}", flush=True)
                    json.dump(res, open(os.path.join(os.path.dirname(__file__), f'results_deep_fly_{TAG}.json'), 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
