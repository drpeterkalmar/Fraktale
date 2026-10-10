"""Defekte Shader-Varianten (fremder Treiber) – Gutachten P1-2, ab 6.5.3.

Ein Init-Skript ersetzt vor dem Laden den Quelltext bestimmter Shader durch Unsinn (Übersetzungsfehler wie auf einem
fremden Treiber). Erwartet: Meldung (Toast), Rückfall nur für die Sitzung, Bild wird fertig, kein pageerror und kein
console.error (die einmalige console.warn je defektem Programm ist erlaubt), die Hauptschleife friert nicht ein.
  (a) Bunt-Variante (#define IN 1) defekt -> Bunt einschalten: Toast, Menge schwarz, fertig
  (b) Perturbation mit Fehlerschätzung defekt -> Seepferdchen 1e9: Toast, CPU-Perturbation, fertig
  (c) direkte Variante mit Fehlerschätzung defekt -> Gesamtbild: Toast, CPU-Rechenweg, fertig
  (d) Gelände-Shader (TERRAIN_VS) defekt -> 3D-Knopf: Toast, 3D bleibt aus, 2D läuft weiter
      (6.7: zuerst Rückfall auf das Gelände ohne AO/Detail – der Marker trifft auch diesen, also wie bisher Toast + aus)
  (e) 6.7 nur das Gelände MIT Horizont-AO defekt -> Rückfall auf das Gelände wie 6.6 (Programm t3terr_66), 3D läuft,
      kein Toast
  (f) 6.7 TAA- und Bloom-Programm defekt (?taa=1) -> beide aus, 3D läuft ohne Toast
  (g) 7.0 Mandelbulb-Marsch-Shader defekt -> Toast, einfacher Mandelbulb wie bis 6.9 (Bild nicht leer), Drehen geht, Screenshot geht
  (h) 7.1 Exoten-Shader (Lyapunov) defekt -> Toast, CPU-Rechenweg (f64), Bild fertig und nicht leer
  (i) 7.1 Lichtbilder-Wander-Shader defekt -> Toast, Flamme auf dem Prozessor, Bild nicht leer
  (k) 7.1 Anzeige mit Staub-Korrektur (Burning Ship) defekt -> stiller Rückfall auf die Anzeige wie bisher, Bild fertig
  (j) 7.1 Julia-Lupe defekt -> Toast, Loslassen öffnet trotzdem die Julia-Menge, nächster Langdruck öffnet sie sofort (wie bis 7.1.3)
Aufruf: python3 tests/test_shader_fail.py [--only=a,b,c,d,e,f,g,h,i]
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def breaker(markers):
    """Init-Skript: Quelltexte, die ALLE Marker eines Eintrags enthalten, werden unübersetzbar."""
    return """(() => {
  const M = %s, orig = WebGL2RenderingContext.prototype.shaderSource;
  window.__broken = [];
  WebGL2RenderingContext.prototype.shaderSource = function (sh, src) {
    if (M.some(ms => ms.every(m => src.includes(m)))) { window.__broken.push(src.slice(0, 40)); src = '#version 300 es\\nthis is not glsl;'; }
    return orig.call(this, sh, src);
  };
})();""" % json.dumps(markers)


def open_app(p, markers, query='nosw&noanim'):
    a = App(p, query=query)
    a.page.add_init_script(breaker(markers))
    a.warns = []
    a.page.on('console', lambda m: a.warns.append(m.text) if m.type == 'warning' else None)
    return a.open()


def toast_text(pg):
    return pg.evaluate("() => { const n = document.getElementById('toast'); return n.classList.contains('show') ? n.textContent : ''; }")


def wait_toast(pg, sec=15):
    t0 = time.time()
    while time.time() - t0 < sec:
        tx = toast_text(pg)
        if 'Grafikfehler' in tx or '3D-Landschaft' in tx:
            return tx
        time.sleep(0.05)
    return toast_text(pg)


def frames_advance(pg):
    f0 = pg.evaluate("() => window.__fraktal.status().fps")
    n0 = pg.evaluate("() => { let n = 0; window.__fc = 0; const f = () => { window.__fc++; requestAnimationFrame(f); }; requestAnimationFrame(f); return 0; }")
    time.sleep(1.0)
    return pg.evaluate("() => window.__fc")


def case_a(p):
    print('(a) Bunt-Variante defekt')
    a = open_app(p, [['#define IN 1']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => { const A = window.__fraktal; A.S.setCol = 'bunt'; A.invalidate(); }")
    tx = wait_toast(pg)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    t, st = a.wait_done(60)
    li = pg.evaluate("() => window.__fraktal.layerInfo()")
    check(st['done'] and all('|in' not in l['sig'] for l in li['layers'] if l['front']), 'Bild fertig, Menge ohne Bunt-Information')
    check(pg.evaluate("() => Object.keys(window.__fraktal.R.broken)") != [], 'R.broken gesetzt')
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}').setCol || null")
    check(saved in (None, 'black'), 'nichts dauerhaft verstellt (%s)' % saved)
    check(frames_advance(pg) > 3, 'Hauptschleife läuft')
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    check(sum('defekt' in w for w in a.warns) == 1, 'genau eine Warnung (%d)' % sum('defekt' in w for w in a.warns))
    a.close()


def case_b(p):
    print('(b) Perturbation mit Fehlerschätzung defekt')
    a = open_app(p, [['#define ERR 1', 'u_offset']])
    pg = a.page
    a.set_view(SEA[0], SEA[1], 1e9)
    tx = wait_toast(pg, 30)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    t, st = a.wait_done(120)
    check(st['done'] and st['plan']['kind'] == 'cpu' and not st['gpuPerturbOK'], 'fertig auf der CPU (%s, gpuPerturbOK=%s)' % (st['plan'], st['gpuPerturbOK']))
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_c(p):
    print('(c) direkte Variante mit Fehlerschätzung defekt')
    a = open_app(p, [['#define ERR 1', '#define F 0']])
    pg = a.page
    tx = wait_toast(pg, 30)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    t, st = a.wait_done(120)
    check(st['done'] and st['plan']['kind'] == 'cpu', 'fertig auf dem CPU-Rechenweg (%s)' % st['plan'])
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}').renderer || null")
    check(saved in (None, 'auto'), 'Rechenweg nicht gespeichert (%s)' % saved)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_d(p):
    print('(d) Gelände-Shader defekt')
    a = open_app(p, [['uniform vec2 u_yr;']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.set3d(true)")
    tx = wait_toast(pg, 30)
    check('3D-Landschaft' in tx, 'Toast: %r' % tx)
    time.sleep(1.0)
    v = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(not v['on'] and not v['prep'], '3D aus, keine Vorbereitung mehr (%s/%s)' % (v['on'], v['prep']))
    check(pg.evaluate("() => document.getElementById('btn-3d').getAttribute('aria-pressed')") != 'true', '3D-Knopf nicht gedrückt')
    a.set_view(SEA[0], SEA[1], 1e5)
    t, st = a.wait_done(60)
    check(st['done'], '2D rechnet weiter')
    # Flug-Start mit defektem Gelände ebenso
    pg.evaluate("() => window.__fraktal.startFly(undefined, { d3: true })")
    time.sleep(2.0)
    v = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(not v['on'] and not v['fly']['on'], 'Flug startet nicht in kaputtes 3D')
    # 6.6: der 2D-Flug braucht kein Gelände – er geht auch, wenn 3D auf diesem Treiber defekt ist
    pg.evaluate("() => window.__fraktal.startFly(undefined, { d3: false })")
    time.sleep(2.0)
    v = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(not v['on'] and v['fly']['on'] and not v['fly']['d3'], '2D-Flug geht trotz defektem 3D')
    pg.evaluate("() => window.__fraktal.stopFly()")
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_e(p):
    print('(e) 6.7 Gelände mit Horizont-AO defekt -> Rückfall wie 6.6')
    a = open_app(p, [['#define HAO 1', 'u_aoN']])          # trifft nur den Vertex-Shader mit AO
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.set3d(true)")
    ok = a.wait_3d(40)
    check(ok, '3D eingeblendet trotz defekter AO-Variante')
    info = pg.evaluate("() => window.__fraktal.view3dInfo().gpu")
    check(info and info.get('fallback') == '_66', 'Rückfall-Gelände aktiv (%s)' % (info and info.get('fallback')))
    check(info and not info['flags']['hao'] and not info['flags']['detail'], 'AO und Detail aus')
    tt = toast_text(pg); check('Grafikfehler' not in tt and 'nicht' not in tt, 'kein Fehler-Hinweis (%s)' % tt)   # „3D wird vorbereitet …“ ist erlaubt (Rückfall übersetzt neu)
    a.wait_done(60); time.sleep(0.5)
    check(pg.evaluate("() => window.__fraktal.status().done"), 'Bild fertig')
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_f(p):
    print('(f) 6.7 TAA + Bloom defekt (?taa=1) -> nur diese aus')
    a = open_app(p, [['u_hist', 'u_dtex'], ['u_thr', 'u_dir']], query='nosw&noanim&taa=1')
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.set3d(true)")
    check(a.wait_3d(40), '3D eingeblendet')
    info = pg.evaluate("() => window.__fraktal.view3dInfo().gpu")
    check(info and not info['flags']['taa'] and not info['flags']['bloom'], 'TAA/Bloom abgeschaltet (%s)' % (info and info['flags']))
    pg.evaluate("() => window.__fraktal.startFly(undefined, { d3: true })")
    time.sleep(2.0)
    check(pg.evaluate("() => window.__fraktal.view3dInfo().fly.on"), '3D-Flug läuft')
    pg.evaluate("() => window.__fraktal.stopFly()")
    tt = toast_text(pg); check('Grafikfehler' not in tt and 'nicht' not in tt, 'kein Fehler-Hinweis (%s)' % tt)   # „3D wird vorbereitet …“ ist erlaubt (Rückfall übersetzt neu)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_g(p):
    print('(g) 7.0 Mandelbulb-Shader defekt -> einfacher Mandelbulb')
    a = open_app(p, [['u_tayR', 'u_dr1']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.setMode(6)")
    tx = wait_toast(pg)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    time.sleep(0.8)
    info = pg.evaluate("() => window.__fraktal.BULB.info()")
    check(info['ok'] is False and info['why'] == 'shader', 'Rückfall aktiv (%s/%s)' % (info['ok'], info['why']))
    # Bild nicht leer: Helligkeitsspanne in der Bildmitte
    spread = pg.evaluate("""() => { const A = window.__fraktal; A.snapshot(); const g = A.R.gl, c = A.R.canvas, w = 64, h = 64;
        const px = new Uint8Array(w * h * 4); g.readPixels((c.width >> 1) - 32, (c.height >> 1) - 32, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
        let mn = 255, mx = 0; for (let i = 0; i < px.length; i += 4) { const l = px[i] + px[i + 1] + px[i + 2]; mn = Math.min(mn, l); mx = Math.max(mx, l); } return mx - mn; }""")
    check(spread > 30, 'Bild nicht leer (Spanne %d)' % spread)
    z0 = pg.evaluate("() => [window.__fraktal.BULB.B.yaw, window.__fraktal.S.cam.zoom]")
    pg.mouse.move(200, 400); pg.mouse.down(); pg.mouse.move(260, 420, steps=5); pg.mouse.up()
    z1 = pg.evaluate("() => [window.__fraktal.BULB.B.yaw, window.__fraktal.S.cam.zoom]")
    check(abs(z1[0] - z0[0]) > 1e-3, 'Drehen geht (%.3f -> %.3f)' % (z0[0], z1[0]))
    r = pg.evaluate("() => window.__fraktal.captureShot({ W: 320, H: 180, label: false }).then(r => [r.W, r.H, r.blob.size])")
    check(r and r[0] == 320 and r[2] > 1000, 'Screenshot (%s)' % r)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_h(p):
    print('(h) 7.1 Exoten-Shader (Lyapunov) defekt -> CPU-Rechenweg')
    a = open_app(p, [['#define F 28']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.setMode(10)")
    tx = wait_toast(pg, 30)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    t, st = a.wait_done(180)
    check(st['done'] and st['plan']['kind'] == 'cpu', 'fertig auf dem CPU-Rechenweg (%s)' % st['plan'])
    spread = pg.evaluate("""() => { const A = window.__fraktal; A.snapshot(); const g = A.R.gl, c = A.R.canvas, w = 64, h = 64;
        const px = new Uint8Array(w * h * 4); g.readPixels((c.width >> 1) - 32, (c.height >> 1) - 32, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
        let mn = 765, mx = 0; for (let i = 0; i < px.length; i += 4) { const l = px[i] + px[i + 1] + px[i + 2]; mn = Math.min(mn, l); mx = Math.max(mx, l); } return mx - mn; }""")
    check(spread > 30, 'Bild nicht leer (Spanne %d)' % spread)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_i(p):
    print('(i) 7.1 Lichtbilder: Wander-Shader defekt -> Rechnung auf dem Prozessor')
    a = open_app(p, [['in vec4 a_t;']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.setMode(14)")
    tx = wait_toast(pg, 30)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    time.sleep(4)
    info = pg.evaluate("() => window.__fraktal.DENS.info()")
    spread = pg.evaluate("""() => { const A = window.__fraktal; A.snapshot(); const c = document.createElement('canvas'); c.width = 64; c.height = 128;
        const g = c.getContext('2d'); g.drawImage(A.R.canvas, 0, 0, 64, 128); const d = g.getImageData(0, 0, 64, 128).data;
        let mn = 765, mx = 0; for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; mn = Math.min(mn, l); mx = Math.max(mx, l); } return mx - mn; }""")
    check(info.get('gpu') is False and (info.get('total') or 0) > 1e5, 'CPU-Rückfall rechnet (%s Punkte)' % info.get('total'))
    check(spread > 30, 'Bild nicht leer (Spanne %d)' % spread)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_j(p):
    print('(j) 7.1 Julia-Lupe: Shader defekt -> ohne Vorschau, Julia öffnet wie bisher')
    a = open_app(p, [['uniform vec3 u_lp;']])
    pg = a.page
    a.wait_done(60)
    W, H = pg.evaluate("() => [innerWidth, innerHeight]")
    pg.mouse.move(W * 0.5, H * 0.6); pg.mouse.down(); time.sleep(0.9)
    tx = wait_toast(pg, 10)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    pg.mouse.up(); time.sleep(0.8)
    check(pg.evaluate("() => window.__fraktal.S.formula") == 1, 'Loslassen öffnet die Julia-Menge')
    pg.evaluate("() => window.__fraktal.setMode(0)"); time.sleep(1)
    pg.mouse.move(W * 0.4, H * 0.5); pg.mouse.down(); time.sleep(0.9)
    st = pg.evaluate("() => [window.__fraktal.S.formula, window.__fraktal.LUPE.on]")
    pg.mouse.up(); time.sleep(0.3)
    check(st == [1, False], 'zweiter Langdruck: Julia sofort, keine Lupe %s' % st)
    a.wait_done(60)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_k(p):
    print('(k) 7.1 Staub-Korrektur defekt -> Anzeige wie bisher')
    a = open_app(p, [['#define DUST 1']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => { const A = window.__fraktal; A.setMode(2); A.setView('-1.4144531250', '-0.1679687500', 192); }")
    a.wait_done(60); time.sleep(1)
    spread = pg.evaluate("""() => { const A = window.__fraktal; A.snapshot(); const c = document.createElement('canvas'); c.width = 64; c.height = 128;
        const g = c.getContext('2d'); g.drawImage(A.R.canvas, 0, 0, 64, 128); const d = g.getImageData(0, 0, 64, 128).data;
        let mn = 765, mx = 0; for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; mn = Math.min(mn, l); mx = Math.max(mx, l); } return mx - mn; }""")
    check(spread > 30, 'Bild nicht leer (Spanne %d)' % spread)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


with sync_playwright() as p:
    for k, fn in [('a', case_a), ('b', case_b), ('c', case_c), ('d', case_d), ('e', case_e), ('f', case_f), ('g', case_g), ('h', case_h), ('i', case_i), ('j', case_j), ('k', case_k)]:
        if ONLY and k not in ONLY:
            continue
        try:
            fn(p)
        except Exception as e:
            fails.append('%s: %r' % (k, e))
            print('  FAIL Ausnahme', repr(e)[:300])
print('ALL PASS' if not fails else 'FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
