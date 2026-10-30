#!/usr/bin/env python3
"""Peter 29.10.2026: „Fraktalflug ist zu zaghaft im Heranzoomen … es geht nur darum, dass er überhaupt nicht hineinfliegen will.“
Etappe 0 (Reproduzieren): echter Zufallsstart mit festem Zufall (?seed=N, Standard-Einstellungen), der Autopilot fliegt von
selbst los; je Bild (rAF) log10 Zoom, Lavalampen-Phase und die Faktoren, aus denen lavaStep das Zoomtempo bildet
(Reisetempo, „verloren“, zf, Schärfe-Prognose, rmax) -> Bremsursache je Bild. Dazu grobe Bilder (frameStats) und
der Rechenweg (plan().kind).

Aufruf:
  python3 tests/measure_v75.py pick=1                 Seeds suchen (Welt je Seed, 2D-Flugwelten)
  python3 tests/measure_v75.py seeds=3,7,9 [secs=120] [q=&mutig=0] [tag=_neu] [append=1]
  python3 tests/measure_v75.py table=_731,_743,_mutig0,_neu    Tabellen (Markdown) aus tests/results_v75<tag>.json
Server: python3 tools/serve.py 8472 (FK_BASE für den Vergleichsstand, z. B. http://localhost:8479/index.html)
Flugmessungen sichtbar: FK_HEADED=1.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ARGS = dict(a.lstrip('-').split('=', 1) for a in sys.argv[1:] if '=' in a)
SECS = float(ARGS.get('secs', 120))
Q = ARGS.get('q', '')
HERE = os.path.dirname(os.path.abspath(__file__))
GPU_W = {0, 1, 2, 3, 4}            # Klassiker: GPU (f32 / Perturbation) bis 10³⁰
EXO_W = {5, 10, 11, 12, 13}        # Newton, Lyapunov, Phoenix, Nova, Magnet: ab 2000× df64 bzw. CPU
NAMES = ['mandelbrot', 'julia', 'burning_ship', 'tricorn', 'mandel_z3', 'newton', 'mandelbulb', 'buddhabrot', 'mandelbox', 'menger',
         'lyapunov', 'phoenix', 'nova', 'magnet', 'flame', 'attractor', 'quatjulia', 'kifs', 'apollonian']
PH = ['cruise', 'brake', 'hover', 'rev', 'wait', 'off']

PICK = """(n) => { const A = window.__fraktal, out = [];
  for (let s = 1; s <= n; s++) { const P = A.ZUFALL.rollPlan(s, { seeded: true }); out.push([s, P.world, P.place ? P.place.kind : null]); }
  return out; }"""

# je Bild: t, lz, Phase, r (Zoomtempo), tgt, sp, lostS, zf, xs, dx, rmax, lq, lqT, ease, cpu, mutig-Zusatz
REC = """(ms) => new Promise(res => { const A = window.__fraktal, F = A.FLY, PH = %s;
  A.frameStats(true);
  const R = [], t0 = performance.now(); let tk = -1e9, cpu = 0;
  const f = () => { const now = performance.now(), t = now - t0, L = F.lava || {};
    if (now - tk > 250) { tk = now; const p = A.plan(); cpu = p.kind === 'cpu' ? 1 : 0; }
    const ph = !F.on ? 5 : L.on ? PH.indexOf(L.phase) : 0;
    const n = (v, d) => v === undefined || v === null || !isFinite(v) ? null : +(+v).toFixed(d);
    R.push([+(t / 1000).toFixed(3), n(Math.log10(A.S.cam.zoom), 4), ph, n(L.r, 4), n(L.tgt, 4), n(F.sp, 3), n(F.lostS, 3), n(F.zf, 3),
            n(L.xs, 3), n(L.dx, 3), n(L.rmax, 3), n(A.GOV.lq, 3), n(A.GOV.lqT, 3), n(F.ease, 3), cpu, n(L.mz, 3)]);
    if (t < ms) { requestAnimationFrame(f); return; }
    const fs = A.frameStats(false);
    res({ R, coarse: fs.frames.map(x => [+((x.t - t0) / 1000).toFixed(2), x.coarse]), log: (L.log || []).slice(), floor: Math.max(0.2, A.homeOf(A.S.formula)[2]),
          flySpeed: A.S.flySpeed, world: A.S.formula, ver: A.APP_VERSION, broken: Object.keys(A.R.broken || {}), probeOk: A.T3.probeReady ? A.T3.probeReady() : null,
          start: { place: A.START.place, how: A.START.how, motion: A.START.motion, fallback: A.START.fallback } });
  };
  requestAnimationFrame(f); })""" % json.dumps(PH)

WAIT_FLY = """() => !!(window.__fraktal && window.__fraktal.START && window.__fraktal.START.flying && window.__fraktal.FLY.on)"""


def smooth(x):
    return 0 if x <= 0 else 1 if x >= 1 else x * x * (3 - 2 * x)


LO, OK = math.log10(0.5), math.log10(0.62)


def cause(row, fs):
    """Bremsursache eines Bildes: Phase außerhalb der Reise, sonst der kleinste Faktor des Reise-Zieltempos (< 0,7)."""
    t, lz, ph, r, tgt, sp, lostS, zf, xs, dx, rmax, lq, lqT, ease, cpu = row[:15]
    if ph == 5:
        return 'aus'
    if ph != 0:
        return PH[ph]
    if ease is not None and ease < 1:
        return 'anfahrt'
    cr = max(0.0, sp or 0)
    kl, kz = 1 - 0.95 * min(1, lostS or 0), zf if zf is not None else 1
    mz = row[15] if len(row) > 15 and row[15] is not None else 0
    ks = max(kl * kz, 0.6 * smooth(mz))          # 7.5: Mut lockert die Lenk-Dämpfung
    fac = {('verloren' if kl < kz else 'zf'): ks}
    if xs is not None:
        xF = xs + min(0, dx or 0) * 2
        fac['schaerfe'] = smooth((xF - LO) / (OK - LO))
    base = cr * ks
    if rmax is not None and base > 1e-6:
        fac['rmax'] = min(1.0, rmax / max(1e-6, base * fac.get('schaerfe', 1)))
    if cr < 0.9 * fs:
        fac['tempo'] = cr / max(1e-6, fs)
    k, v = min(fac.items(), key=lambda kv: kv[1])
    return k if v < 0.7 else 'frei'


def summ(res, secs):
    R = res['R']
    if not R:
        return {'n': 0}
    fs = abs(res['flySpeed'] or 0.2)
    lz0 = R[0][1]
    def lz_at(T):
        c = [x for x in R if x[0] <= T]
        return c[-1][1] if c else None
    lz60 = lz_at(60)
    dt = [R[i + 1][0] - R[i][0] if i + 1 < len(R) else 0 for i in range(len(R))]
    tot = sum(dt) or 1
    ph = {}
    ca = {}
    for x, d in zip(R, dt):
        ph[PH[x[2]]] = ph.get(PH[x[2]], 0) + d
        c = cause(x, fs)
        ca[c] = ca.get(c, 0) + d
    co = res['coarse']
    co3 = [c for t, c in co if t >= 3]
    cpu = sum(x[14] for x in R) / len(R)
    flips = [e for e in res['log']]
    return {'world': NAMES[res['world']] if 0 <= res['world'] < len(NAMES) else res['world'], 'w': res['world'], 'ver': res['ver'], 'flySpeed': res['flySpeed'],
            'lz0': lz0, 'lz60': lz60, 'd60': None if lz60 is None else round(lz60 - lz0, 2), 'lzMax': max(x[1] for x in R), 'lzEnd': R[-1][1],
            'dMax': round(max(x[1] for x in R) - lz0, 2), 'floorLz': round(math.log10(res['floor']), 2),
            'phasen': {k: round(v / tot, 3) for k, v in sorted(ph.items(), key=lambda kv: -kv[1])},
            'ursache': {k: round(v / tot, 3) for k, v in sorted(ca.items(), key=lambda kv: -kv[1])},
            'grob': round(sum(1 for c in co3 if c > 0.1) / max(1, len(co3)), 3), 'cpuAnteil': round(cpu, 2),
            'wechsel': len(flips), 'start': res['start'], 'broken': res['broken'], 'probeOk': res['probeOk']}


def run(p, seed, secs):
    a = App(p, query='nosw&noanim&seed=%d' % seed + Q).open()
    try:
        a.page.wait_for_function(WAIT_FLY, timeout=40000)
    except Exception:
        st = a.page.evaluate("() => { const A = window.__fraktal; return A && { w: A.S.formula, fly: A.FLY.on, st: A.START && A.START.motion }; }")
        a.close()
        return {'seed': seed, 'fehler': 'kein Flug', 'st': st}
    r = a.page.evaluate(REC, secs * 1000)
    err = a.errors[:3]
    a.close()
    s = summ(r, secs)
    s['seed'] = seed
    s['errors'] = err
    return s, r


def table(tags):
    def pend(log):
        # kürzester Abstand zweier Rückwege (Pendel-Regel: ≥ 8 s) und Phasenwechsel je Minute
        rv = [e[0] for e in log if e[1] == 'rev']
        return (min(b - a for a, b in zip(rv, rv[1:])) / 1000 if len(rv) > 1 else None)
    rows = {}
    for tg in tags:
        f = os.path.join(HERE, 'results_v75%s.json' % tg)
        for r in json.load(open(f)):
            if 'fehler' in r:
                continue
            rows.setdefault(r['seed'], {})[tg] = r
    for grp, ws in (('GPU-Welten', GPU_W), ('Exoten (df64/CPU)', EXO_W)):
        seeds = sorted(sd for sd, d in rows.items() if any(x['w'] in ws for x in d.values()))
        if not seeds:
            continue
        print('\n### %s – Tiefe nach 60 s (Zehnerpotenzen über dem Start) / größte Tiefe / grob\n' % grp)
        print('| Seed | Welt | Start | ' + ' | '.join(tags) + ' |')
        print('|---|---|---|' + '---|' * len(tags))
        agg = {tg: [] for tg in tags}
        for sd in seeds:
            d = rows[sd]
            any_r = next(iter(d.values()))
            cells = []
            for tg in tags:
                r = d.get(tg)
                if not r:
                    cells.append('–')
                    continue
                agg[tg].append(r)
                mark = '**' if r['d60'] < 2 else ''
                cells.append('%s%+.1f%s / 10^%.0f / %.0f %%' % (mark, r['d60'], mark, r['lzMax'], r['grob'] * 100))
            print('| %d | %s | %s | %s |' % (sd, any_r['world'], (any_r.get('start') or {}).get('place'), ' | '.join(cells)))
        print('\n| Kennzahl | ' + ' | '.join(tags) + ' |')
        print('|---|' + '---|' * len(tags))
        def line(name, fn):
            print('| %s | %s |' % (name, ' | '.join(fn(agg[tg]) if agg[tg] else '–' for tg in tags)))
        line('Läufe', lambda L: str(len(L)))
        line('nach 60 s < 2 Zehnerpotenzen', lambda L: '%d von %d' % (sum(1 for r in L if r['d60'] < 2), len(L)))
        line('Tiefe nach 60 s, Median', lambda L: '%+.1f' % sorted(r['d60'] for r in L)[len(L) // 2])
        line('größte Tiefe, Median', lambda L: '10^%.0f' % sorted(r['lzMax'] for r in L)[len(L) // 2])
        line('grob (Mittel)', lambda L: '%.1f %%' % (100 * sum(r['grob'] for r in L) / len(L)))
        for ph in PH[:5]:
            line('Zeit in %s' % ph, lambda L, ph=ph: '%.0f %%' % (100 * sum(r['phasen'].get(ph, 0) for r in L) / len(L)))
        line('Phasenwechsel je Minute', lambda L: '%.1f' % (sum(r['wechsel'] for r in L) / len(L) / 2))
        line('kürzestes Rückweg-Pendel', lambda L: (lambda v: '%.1f s' % min(v) if v else '–')([x for x in (pend(r.get('log', [])) for r in L) if x is not None]))
        cs = {}
        for tg in tags:
            for r in agg[tg]:
                for k in r['ursache']:
                    cs.setdefault(k, None)
        for k in cs:
            line('Ursache: %s' % k, lambda L, k=k: '%.0f %%' % (100 * sum(r['ursache'].get(k, 0) for r in L) / len(L)))


def main():
    if 'table' in ARGS:
        table(ARGS['table'].split(','))
        return
    with sync_playwright() as p:
        if 'pick' in ARGS:
            a = App(p, query='nosw&noanim').open()
            a.wait_done(60)
            L = a.page.evaluate(PICK, int(ARGS.get('n', 120)))
            a.close()
            g = [s for s, w, k in L if w in GPU_W]
            e = [s for s, w, k in L if w in EXO_W]
            print('GPU-Welten:', [(s, NAMES[w], k) for s, w, k in L if w in GPU_W][:20])
            print('Exoten:', [(s, NAMES[w], k) for s, w, k in L if w in EXO_W][:20])
            return
        seeds = [int(x) for x in ARGS['seeds'].split(',')]
        out_f = os.path.join(HERE, 'results_v75%s.json' % ARGS.get('tag', ''))
        allr = json.load(open(out_f)) if os.path.exists(out_f) and ARGS.get('append') == '1' else []
        for sd in seeds:
            x = run(p, sd, SECS)
            if isinstance(x, dict):
                print(json.dumps(x, ensure_ascii=False), flush=True)
                allr.append(x)
                continue
            s, r = x
            print(json.dumps(s, ensure_ascii=False), flush=True)
            allr.append({**s, 'R': r['R'][::30], 'log': r['log']})   # (Zeitreihe ~2 Werte/s)
            json.dump(allr, open(out_f, 'w'))


if __name__ == '__main__':
    main()
