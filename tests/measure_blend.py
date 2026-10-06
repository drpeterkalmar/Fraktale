#!/usr/bin/env python3
"""Pop-Metrik: nahtloser Bildaufbau messbar machen (vorher/nachher, gleiche Methode für jede Version).

Die Messung hängt sich von außen an R.present (funktioniert für 5.0.1 und 5.1+):
  * effektive Auflösung pro Bildschirm-Stichprobe (24x48 Raster): Pufferpixel pro Bildschirmpixel der
    sichtbaren Ebene(n), alpha-gewichtet, gekappt bei 1; unbedeckt = 0.
    coarseFrac = Anteil Stichproben mit k_eff < 0.5
  * |dRGB|: mittlere Farbänderung Frame zu Frame (0..255) auf einer per Mipmap (Box-Filter) verkleinerten
    Kopie des Canvas (1/16).
  * harte Ebenenwechsel: eine neue Ebene erscheint im ersten Frame schon mit voller Deckkraft über einem
    vorhandenen Bild (5.0.1: Tausch während Bewegung).
  * Schärfe fällt bei gehaltenem Bild: Kamera unverändert, mittlere k_eff sinkt um > 0.02.
Fahrten (Kamera per Skript, für jede Version identisch):
  pinch  – Zoom 1e3 -> 1e9 in 6 s (wie eine Finger-Geste: ungebremst)
  pan    – 6 s Schwenk bei 1e7 (450 CSS-px/s mit Schlenker)
  tour   – ▶ Tour vom Gesamtbild bis 1e12 (animiert, Tempo-Bremse greift, Dauer wird gemessen)
  dtap   – 6 Doppeltipps (×3) im Abstand von 0,7 s ab 1e5
Aufruf: python3 tests/measure_blend.py --base=http://localhost:8472/index.html --label=neu [--query=…]
(der 5.0.1-Modus ?blend=0 ist seit 6.5.4 entfernt; seine Messwerte stehen in tests/results_blend_v501*.json)
        [--only=pinch,pan] [--hc=4] [--throttle=4] [--shots] [--headed]
Hinweis: headless liefert rAF nur mit ~15 fps (auch leere Seite) -> Bewegungsmessungen mit --headed (~45 fps).
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import GPU_ARGS
from playwright.sync_api import sync_playwright

PAUSE = 2.5
SHOTS = os.path.join(os.path.dirname(__file__), 'shots', 'blend')
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
WALK = ('-0.743637215354753236002154', '0.131822307028445564243233')

INSTR = r"""() => {
  const A = window.__fraktal, R = A.R, gl = R.gl, HP = A.HP;
  if (window.__M) return;
  const W = gl.canvas.width, H = gl.canvas.height, LV = 4;
  const sw = Math.max(1, W >> LV), sh = Math.max(1, H >> LV);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, LV + 1, gl.RGBA8, W, H);
  const fb0 = gl.createFramebuffer(), fbL = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbL); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, LV);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const px = new Uint8Array(sw * sh * 4);
  let prevPx = null;
  const M = window.__M = { on: false, frames: [], hard: 0, drops: 0, seen: new WeakSet(), lastCam: null, lastK: null, hadLayers: false };
  const GX = 24, GY = 48;
  function cover(layers, cam) {
    // layers: [{fr, alpha, cond}] von oben nach unten; cond: 'A' = alpha gilt nur, wo die Ebene darunter deckt (5.0.1)
    const sCam = 3 / (cam.zoom * H);
    const L = layers.map(l => {
      const k = sCam / l.fr.scale;
      const dx = HP.toNumber(cam.cx - l.fr.view.cx) / l.fr.scale, dy = HP.toNumber(cam.cy - l.fr.view.cy) / l.fr.scale;
      return { k, ox: dx - W / 2 * k + l.fr.buf.w / 2, oy: dy - H / 2 * k + l.fr.buf.h / 2, w: l.fr.buf.w, h: l.fr.buf.h, a: l.alpha, cond: l.cond };
    });
    let sum = 0, coarse = 0, unc = 0;
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
      const fx = (i + 0.5) / GX * W, fy = (j + 0.5) / GY * H;
      const ins = L.map(l => { const tx = fx * l.k + l.ox, ty = fy * l.k + l.oy; return tx >= 0 && ty >= 0 && tx <= l.w && ty <= l.h; });
      let T = 1, ke = 0, any = false;
      for (let n = 0; n < L.length; n++) {
        if (!ins[n]) continue;
        any = true;
        let a = L[n].a;
        if (L[n].cond && !ins.slice(n + 1).some(Boolean)) a = 1;
        ke += T * a * Math.min(1, L[n].k); T *= 1 - a;
        if (T < 0.004) break;
      }
      if (!any) unc++;
      sum += ke; if (ke < 0.5) coarse++;
    }
    const N = GX * GY;
    return { kMean: sum / N, coarse: coarse / N, unc: unc / N };
  }
  M.q = [];
  // bewegungskompensierter Vergleich: vorheriges Kleinbild auf die aktuelle Kamera abbilden
  function dmc(cur, prev, camC, camP) {
    const sC = 3 / (camC.zoom * H), sP = 3 / (camP.zoom * H);
    const ox = HP.toNumber(camC.cx - camP.cx), oy = HP.toNumber(camC.cy - camP.cy);
    let s = 0, n = 0;
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      const fx = (i + 0.5) * W / sw, fy = (j + 0.5) * H / sh;
      const px_ = ((fx - W / 2) * sC + ox) / sP + W / 2, py_ = ((fy - H / 2) * sC + oy) / sP + H / 2;
      const u = px_ * sw / W - 0.5, v = py_ * sh / H - 0.5;
      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) continue;
      const i0 = Math.floor(u), j0 = Math.floor(v), i1 = Math.min(sw - 1, i0 + 1), j1 = Math.min(sh - 1, j0 + 1), fu = u - i0, fv = v - j0;
      const o = (j * sw + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const a = prev[(j0 * sw + i0) * 4 + ch] * (1 - fu) + prev[(j0 * sw + i1) * 4 + ch] * fu;
        const b = prev[(j1 * sw + i0) * 4 + ch] * (1 - fu) + prev[(j1 * sw + i1) * 4 + ch] * fu;
        s += Math.abs(cur[o + ch] - (a * (1 - fv) + b * fv));
      }
      n++;
    }
    return n > sw * sh * 0.25 ? s / (n * 3) : null;
  }
  function drain() {
    while (M.q.length) {
      const e = M.q[0];
      if (gl.clientWaitSync(e.sync, 0, 0) === gl.TIMEOUT_EXPIRED) break;
      M.q.shift(); gl.deleteSync(e.sync);
      const cur = new Uint8Array(sw * sh * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, e.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, cur); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(e.pbo);
      if (prevPx) {
        let s = 0; for (let i = 0; i < cur.length; i += 4) s += Math.abs(cur[i] - prevPx[i]) + Math.abs(cur[i + 1] - prevPx[i + 1]) + Math.abs(cur[i + 2] - prevPx[i + 2]);
        e.rec.d = +(s / (cur.length / 4 * 3)).toFixed(2);
        const m = dmc(cur, prevPx, e.cam, M.prevCamPx); e.rec.dmc = m === null ? null : +m.toFixed(2);
      }
      prevPx = cur; M.prevCamPx = e.cam;
    }
  }
  M.drain = drain;
  M.resetPx = () => { prevPx = null; };
  const orig = R.present;
  R.present = function (...args) {
    const r = orig.apply(this, args);
    const isNew = Array.isArray(args[0]);
    const target = isNew ? args[3] : args[5];
    if (!M.on || target) return r;
    const cam = isNew ? args[1] : args[3];
    let layers;
    if (isNew) layers = args[0].filter(l => l && l.buf).map(l => ({ fr: l, alpha: l.alpha, cond: false }));
    else { layers = []; if (args[1]) layers.push({ fr: args[1], alpha: args[0] ? args[2] : 1, cond: true }); if (args[0]) layers.push({ fr: args[0], alpha: 1 }); }
    const c = cover(layers, cam);
    // harter Wechsel: neue Ebene sofort voll deckend über einem vorhandenen Bild
    let hardNow = 0;
    for (const l of layers) {
      if (!M.seen.has(l.fr)) {
        M.seen.add(l.fr);
        const below = layers.length > 1;
        if (M.hadLayers && M.frames.length && below && l === layers[0] && l.alpha >= 0.99) hardNow++;
      }
    }
    M.hard += hardNow;
    M.hadLayers = layers.length > 0;
    const same = M.lastCam && M.lastCam.cx === cam.cx && M.lastCam.cy === cam.cy && M.lastCam.zoom === cam.zoom;
    let drop = 0;
    if (same && M.lastK !== null && c.kMean < M.lastK - 0.02) { drop = 1; M.drops++; }
    M.lastCam = cam; M.lastK = c.kMean;
    // |dRGB| auf 1/16-Kopie (Box-Filter über Mipmaps), asynchron per PBO (keine GPU-Blockade)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb0);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.generateMipmap(gl.TEXTURE_2D);
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, sw * sh * 4, gl.STREAM_READ);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbL);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const rec = { t: performance.now(), z: cam.zoom, k: +c.kMean.toFixed(3), coarse: +c.coarse.toFixed(3), unc: +c.unc.toFixed(3), n: layers.length, d: null, dmc: null, hard: hardNow, drop, moving: A.isMoving() };
    M.frames.push(rec);
    M.q.push({ pbo, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), cam, rec });
    gl.flush();
    drain();
    return r;
  };
  window.__lt = [];
  new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
}"""

START = "() => { const M = window.__M; M.drain(); M.resetPx(); M.frames = []; M.hard = 0; M.drops = 0; M.lastCam = null; M.lastK = null; M.hadLayers = false; M.on = true; window.__lt.length = 0; }"
STOP = "() => { const M = window.__M; M.on = false; M.drain(); return { frames: M.frames, hard: M.hard, drops: M.drops, lt: window.__lt.slice() }; }"

# Kamera-Fahrten per Seiten-rAF (gleich für jede Version)
DRIVE = r"""([kind, cx, cy, z0, z1, dur]) => new Promise((res) => {
  const A = window.__fraktal, HP = A.HP;
  const bx = HP.fromString(cx), by = HP.fromString(cy);
  const t0 = performance.now();
  const step = () => {
    const u = Math.min(1, (performance.now() - t0) / (dur * 1000));
    if (kind === 'zoom') {
      const z = z0 * Math.pow(z1 / z0, u);
      A.setCam(bx, by, z);
    } else {
      const s = 3 / (z0 * innerHeight);
      const tt = u * dur;
      const dx = 450 * tt * s, dy = 120 * Math.sin(tt * 2.1) * s;
      A.setCam(bx + HP.fromNumber(dx), by + HP.fromNumber(dy), z0);
    }
    if (u < 1) requestAnimationFrame(step); else res(true);
  };
  requestAnimationFrame(step);
})"""


def summarize(r, t_total=None):
    fr = r['frames']
    mov = [f for f in fr if f['moving']]
    def pct(a, q):
        if not a: return None
        a = sorted(a); return a[min(len(a) - 1, int(q * len(a)))]
    ds = [f['d'] for f in fr[1:] if f['d'] is not None]
    dm = [f['dmc'] for f in fr[1:] if f.get('dmc') is not None]
    out = dict(frames=len(fr), hardSwitches=r['hard'], sharpDropsHeld=r['drops'],
               coarseFrameShare=round(sum(1 for f in fr if f['coarse'] > 0.1) / max(1, len(fr)), 3),
               coarsePixelMean=round(sum(f['coarse'] for f in fr) / max(1, len(fr)), 3),
               coarsePixelMeanMoving=round(sum(f['coarse'] for f in mov) / max(1, len(mov)), 3) if mov else None,
               uncoveredMean=round(sum(f['unc'] for f in fr) / max(1, len(fr)), 4),
               kMean=round(sum(f['k'] for f in fr) / max(1, len(fr)), 3),
               dRGBmax=round(max(ds), 2) if ds else None, dRGBp99=pct(ds, 0.99), dRGBp95=pct(ds, 0.95), dRGBmedian=pct(ds, 0.5),
               dMCmax=round(max(dm), 2) if dm else None, dMCp99=pct(dm, 0.99), dMCp95=pct(dm, 0.95), dMCmedian=pct(dm, 0.5),
               layersMax=max((f['n'] for f in fr), default=0),
               longTasks=[x for x in r['lt'] if x > 50])
    if t_total is not None: out['durationS'] = round(t_total, 2)
    return out


def wait_done(pg, timeout=180, pause=0):
    t0 = time.time()
    time.sleep(0.3)
    while time.time() - t0 < timeout:
        if pg.evaluate("() => window.__fraktal.status().done"):
            t = time.time() - t0
            time.sleep(pause)
            return t
        time.sleep(0.1)
    return None


def burst(pg, name, n=8, dt=0.12):
    os.makedirs(SHOTS, exist_ok=True)
    for i in range(n):
        pg.locator('#gl').screenshot(path=os.path.join(SHOTS, f'{name}_{i}.png'))
        time.sleep(dt)


def main():
    args = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
    base = args.get('base', 'http://localhost:8472/index.html')
    label = args.get('label', 'run')
    q = 'nosw&noanim' + ('&' + args['query'] if args.get('query') else '')
    only = args.get('only', 'pinch,pan,tour,dtap').split(',')
    global PAUSE
    PAUSE = float(args.get('pause', '2.5'))   # Betrachtungspause vor jeder Fahrt (Vorausrechnen hat Zeit)
    res = {'label': label, 'base': base, 'query': q}
    with sync_playwright() as p:
        b = p.chromium.launch(args=GPU_ARGS, headless='headed' not in args)
        ctx = b.new_context(**p.devices['Pixel 7'])
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        if args.get('hc'):
            pg.add_init_script(f"Object.defineProperty(navigator, 'hardwareConcurrency', {{get: () => {args['hc']}}})")
        pg.goto(base + '?' + q, wait_until='load')
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status().done", timeout=60000)
        if args.get('throttle'):
            cdp = ctx.new_cdp_session(pg)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': float(args['throttle'])})
        pg.evaluate(INSTR)
        res['version'] = pg.evaluate("() => window.__fraktal.APP_VERSION")
        shots = 'shots' in args
        if 'pinch' in only:
            pg.evaluate("([x,y]) => window.__fraktal.setView(x, y, 1e3)", list(WALK)); wait_done(pg, pause=PAUSE)
            pg.evaluate(START)
            if shots:
                pg.evaluate("(a) => { window.__drive = (" + DRIVE + ")(a); }", ['zoom', WALK[0], WALK[1], 1e3, 1e9, 6])
                time.sleep(2.0); burst(pg, f'{label}_zoom')
                pg.wait_for_function("() => window.__drive.then ? true : true")
                time.sleep(3.2)
            else:
                pg.evaluate("(a) => (" + DRIVE + ")(a)", ['zoom', WALK[0], WALK[1], 1e3, 1e9, 6])
            t = wait_done(pg)
            res['pinch'] = summarize(pg.evaluate(STOP)); res['pinch']['settleS'] = round(t, 2) if t else None
            print('pinch', json.dumps(res['pinch']), flush=True)
        if 'pan' in only:
            pg.evaluate("([x,y]) => window.__fraktal.setView(x, y, 1e7)", list(WALK)); wait_done(pg, pause=PAUSE)
            pg.evaluate(START)
            if shots:
                pg.evaluate("(a) => { window.__drive = (" + DRIVE + ")(a); }", ['pan', WALK[0], WALK[1], 1e7, 1e7, 6])
                time.sleep(2.0); burst(pg, f'{label}_pan'); time.sleep(3.2)
            else:
                pg.evaluate("(a) => (" + DRIVE + ")(a)", ['pan', WALK[0], WALK[1], 1e7, 1e7, 6])
            t = wait_done(pg)
            res['pan'] = summarize(pg.evaluate(STOP)); res['pan']['settleS'] = round(t, 2) if t else None
            print('pan', json.dumps(res['pan']), flush=True)
        if 'tour' in only:
            pg.evaluate("() => window.__fraktal.setView('-0.5', '0', 1)"); wait_done(pg)
            pg.evaluate(START)
            t0 = time.time()
            pg.evaluate("([x,y]) => window.__fraktal.startTour({ cx: x, cy: y, zoom: 1e12 })", list(WALK))
            pg.wait_for_function("() => window.__fraktal.S.cam.zoom > 0.99e12 && !window.__fraktal.isMoving()", timeout=120000, polling=100)
            t_tour = time.time() - t0
            t = wait_done(pg)
            r = pg.evaluate(STOP)
            res['tour'] = summarize(r, t_tour); res['tour']['settleS'] = round(t, 2) if t else None
            deep = dict(r, frames=[f for f in r['frames'] if f['z'] >= 1e3])
            res['tour']['from1e3'] = {k: v for k, v in summarize(deep).items() if k in ('frames', 'coarseFrameShare', 'coarsePixelMean', 'kMean', 'dRGBmax', 'dRGBp99')}
            print('tour', json.dumps(res['tour']), flush=True)
        if 'dtap' in only:
            pg.evaluate("([x,y]) => window.__fraktal.setView(x, y, 1e5)", list(WALK)); wait_done(pg, pause=PAUSE)
            pg.evaluate(START)
            t0 = time.time()
            for i in range(6):
                pg.evaluate("() => window.__fraktal.zoomAt(innerWidth / 2, innerHeight / 2, 3)")
                time.sleep(0.7)
            pg.wait_for_function("() => !window.__fraktal.isMoving()", timeout=60000, polling=50)
            t_dt = time.time() - t0
            t = wait_done(pg)
            res['dtap'] = summarize(pg.evaluate(STOP), t_dt); res['dtap']['settleS'] = round(t, 2) if t else None
            print('dtap', json.dumps(res['dtap']), flush=True)
        res['errors'] = errs
        b.close()
    out = os.path.join(os.path.dirname(__file__), f'results_blend_{label}.json')
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k in ('version', 'errors')}))


if __name__ == '__main__':
    main()
