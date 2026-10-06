"""Regressionsgitter für den Umbau: fertige Bilder müssen BITGLEICH bleiben.

Ansichten (Pixel 7 hoch, ?nosw&noanim):
  ganz      Mandelbrot-Gesamtbild (GPU direkt)
  sea1e9    Seepferdchen 10⁹ (GPU-Perturbation + BLA + exakte Nachrechnung)
  sea1e9cpu dieselbe Ansicht auf dem CPU-Pfad (?renderer=cpu)
  sea3d     dieselbe Ansicht in 3D: Rechenpuffer (quadratisch) + 3D-Bild (Canvas-Pixel, 8 Bilder gemittelt wie nach
            settle3d()). Das normale 3D-Bild hängt vom wachsenden Ebenenstapel und der nachgeführten Höhen-Normierung ab
            (zwei Läufe desselben Stands: bis 73/255 Blockabweichung) – darum wird hier nur der bitgleiche Rechenpuffer
            mit fester Höhen-Normierung, Zeit und Deko gezeichnet (args3d()-Ansicht/Look): bitgenau reproduzierbar.
Je Ansicht: SHA-256 der Rohbytes von readFront() (Iterationswerte, Float32) und readFrontDE() (Distanzcodes, Uint8),
in 2D zusätzlich das vom Display-Shader gezeichnete Bild (nur die exakte Ebene, feste Zeit; Canvas-Pixel), dazu Größe
und eine Stichprobe (jeder 4999. Wert) zur Diagnose. Ablage tests/snapshots/<name>.json – die Rohdaten
(je ~1,4 Mio. Werte) wären als JSON zu groß fürs Repo; der Hash ist bitgenau.
Erster Lauf (oder --update) schreibt, jeder weitere vergleicht.
Aufruf: python3 tests/test_snapshot.py [--update] [--only=ganz,sea1e9,sea1e9cpu,sea3d]
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(HERE, 'snapshots')
UPDATE = '--update' in sys.argv
ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')

# im Browser: Hashes der Rohbytes (crypto.subtle; localhost ist ein sicherer Kontext)
JS_FRONT = """async () => {
  const A = window.__fraktal, R = A.R, f = A.RC.front;
  const hex = async (u8) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u8))).map(b => b.toString(16).padStart(2, '0')).join('');
  const it = R.readIterSync(f.buf), de = R.readDESync(f.buf);
  const sample = []; for (let i = 0; i < it.length; i += 4999) sample.push(it[i]);
  // 2D-Anzeige (Display-Shader): nur die exakte Ebene, feste Zeit, Optionen wie presentArgs – im selben Task gelesen
  let canvasSha = null;
  if (!A.V3.on) {
    const gl = R.gl, lk = Object.assign(A.look(), { time: 100 }), dpr = gl.drawingBufferWidth / innerWidth;
    R.present([Object.assign(f, { alpha: 1 })], A.S.cam, lk, null, { feather: 12 * dpr, recon: true, de: A.deActive() ? [0.25, 1.25] : null });
    const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
    canvasSha = await hex(px);
  }
  return { w: f.buf.w, h: f.buf.h, stage: f.stage, exact: !!f.exact, kind: f.kind, mode: f.mode, maxIter: f.maxIter,
           iterSha: await hex(new Uint8Array(it.buffer)), deSha: de ? await hex(de) : null, canvasSha, sample };
}"""
# 3D: Zeit/Höhen-Normierung festhalten (sonst hängt das Bild von der Bildfolge ab), mitteln, Canvas im selben Task lesen
JS_3D = """async () => {
  const A = window.__fraktal, R = A.R, gl = R.gl, T3 = A.T3, f = A.RC.front;
  // deterministisch: nur der (bitgleiche) Rechenpuffer, feste Höhen-Normierung/Zeit/Deko, 8 Bilder Mittelung wie im Stillstand
  T3.free(f);
  const g = A.args3d(), v = Object.assign({}, g.v, { L: [5, 9], cdf: null, time: 100, ctime: 0, deko: 1 });
  const L3 = [Object.assign(f, { alpha: 1 })];
  for (let i = 0; i < 8; i++) T3.render(L3, v, g.lk, undefined, { smooth: true, de: g.o.de, still: { n: i, N: 8, mix2: 0, scale: 1 } });
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
  const d = await crypto.subtle.digest('SHA-256', px);
  // Blockmittel (16×16 Pixel, Graustufe ×10) zur Diagnose
  const B = 16, bw = Math.floor(w / B), bh = Math.floor(h / B), blocks = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0; for (let y = by * B; y < by * B + B; y++) for (let x = bx * B; x < bx * B + B; x++) { const i = 4 * (y * w + x); s += px[i] + px[i + 1] + px[i + 2]; }
    blocks.push(Math.round(s / (B * B * 3) * 10));
  }
  A.V3.accKey = null;
  return { w, h, canvasSha: Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''), mean: +(sum / (w * h * 3)).toFixed(3), blocks };
}"""


def capture(p, name):
    q = 'nosw&noanim' + ('&renderer=cpu' if name == 'sea1e9cpu' else '')
    a = App(p, query=q).open()
    pg = a.page
    if name != 'ganz':
        a.set_view(SEA[0], SEA[1], 1e9)
    a.wait_done(180)
    if name == 'sea3d':
        pg.evaluate("() => window.__fraktal.set3d(true)")
        if not a.wait_3d(60):
            raise RuntimeError('3D kam nicht')
        a.wait_done(120)
        time.sleep(4.0)          # Vorausrechnen + Sonde (Höhen-Normierung) zur Ruhe kommen lassen
        a.wait_done(120)
    else:
        time.sleep(1.0)
        a.wait_done(60)
    r = pg.evaluate(JS_FRONT)
    if name == 'sea3d':
        r['view3d'] = pg.evaluate(JS_3D)
    r['errors'] = a.errors
    a.close()
    return r


fails = []
with sync_playwright() as p:
    for name in ['ganz', 'sea1e9', 'sea1e9cpu', 'sea3d']:
        if ONLY and name not in ONLY:
            continue
        try:
            r = capture(p, name)
        except Exception as e:
            fails.append(name)
            print('FAIL', name, repr(e)[:300])
            continue
        fn = os.path.join(SNAP, name + '.json')
        errs = r.pop('errors')
        if errs:
            fails.append(name)
            print('FAIL', name, 'Fehler', errs[:3])
        if UPDATE or not os.path.exists(fn):
            os.makedirs(SNAP, exist_ok=True)
            json.dump(r, open(fn, 'w'), indent=1)
            print('geschrieben', name, r['w'], 'x', r['h'], r['iterSha'][:12], (r.get('view3d') or {}).get('canvasSha', '')[:12])
            continue
        ref = json.load(open(fn))
        if ref.get('canvasSha') is None and r.get('canvasSha'):      # Feld neu (ab 6.5.3): einmal nachtragen
            ref['canvasSha'] = r['canvasSha']
            json.dump(ref, open(fn, 'w'), indent=1)
            print('     %s: Canvas-Hash nachgetragen' % name)
        keys = ['w', 'h', 'iterSha', 'deSha', 'canvasSha']
        diff = [k for k in keys if ref.get(k) != r.get(k)]
        if name == 'sea3d' and ref['view3d']['canvasSha'] != r['view3d']['canvasSha']:
            bd = max(abs(x - y) for x, y in zip(ref['view3d']['blocks'], r['view3d']['blocks'])) / 10
            diff.append('3D-Bild (max. Blockabweichung %.1f/255, Mittel %s -> %s)' % (bd, ref['view3d']['mean'], r['view3d']['mean']))
        if diff:
            fails.append(name)
            nd = sum(1 for x, y in zip(ref['sample'], r['sample']) if x != y)
            print('FAIL', name, 'abweichend:', diff, '| Stichprobe %d von %d anders' % (nd, len(ref['sample'])))
        else:
            print('ok  ', name, 'bitgleich', r['iterSha'][:12])
print('ALL PASS' if not fails else 'FAILED: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
