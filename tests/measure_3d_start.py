#!/usr/bin/env python3
"""Messung 3D-Start (6.3): Was passiert zwischen dem Antippen von ⛰ und dem ersten 3D-Bild?

Läuft auf Mac UND Windows (Python 3.12 + Playwright; Windows: `py tests\\measure_3d_start.py`). Startet selbst einen
kleinen Webserver auf dem Projektordner (oder --url=… z. B. die Live-Seite) und einen Browser mit frischem Profil
(kein Shader-Cache). Die Messung hängt sich versionsunabhängig in WebGL ein (funktioniert auch mit 6.2.0):
  * Zeit vom Antippen (pointerdown auf ⛰) bis zum ersten 3D-Bild (erster drawElements-Aufruf = Gelände)
  * längster Haupt-Thread-Block: größte Lücke zwischen zwei requestAnimationFrame-Aufrufen und Long Tasks
    im Fenster [Antippen, erstes 3D-Bild + 1,5 s]; Bilder pro Sekunde während der Vorbereitung (2D bedienbar?)
  * pro WebGL-Programm, das nach dem Antippen gebaut wird: Übersetzungszeit (linkProgram bis fertig) und wie lange
    der Haupt-Thread in Statusabfragen (LINK_STATUS/COMPILE_STATUS) darauf gewartet hat
  * --slow=MS simuliert einen langsamen Treiber (z. B. FXC/Direct3D 11 unter Windows): jedes nach dem Antippen
    gebaute Programm gilt erst MS Millisekunden nach dem Link als fertig (COMPLETION_STATUS meldet so lange
    "nicht fertig", eine blockierende LINK_STATUS-Abfrage wartet so lange).
Ziel 6.3: kein Frame-Block > 100 ms, egal wie lange die Übersetzung dauert.

Aufrufe:
  Mac:      python3 tests/measure_3d_start.py [--tag=v630] [--slow=8000] [--angle=swiftshader] [--url=…]
  Windows:  py tests\\measure_3d_start.py --tag=rog            (Chrome mit Standard-Backend = Direct3D 11)
            py tests\\measure_3d_start.py --tag=rog_live --url=https://drpeterkalmar.github.io/Fraktale/
  Optionen: --cache (Shader-Caches nicht umgehen; Standard: jeder 3D-Shader wird per Nonce frisch übersetzt), --device=desktop|pixel7 (Standard desktop 1280×800), --headed (sichtbares Fenster), --look=alpin|weiss,
            --runs=N (mehrere frische Browser hintereinander), --query=nowarm (A/B-Regler der App), --browser=chrome|chromium
Ergebnis: tests/results_3dstart_<tag>.json + eine Textzeile pro Lauf.
"""
import sys, os, json, time, threading, functools, socket, statistics
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith('--' + name + '='): return a.split('=', 1)[1]
        if a == '--' + name: return True
    return default


HOOK = r"""
(() => {
  const SLOW = __SLOW__;
  const P = WebGL2RenderingContext.prototype, CS = 0x91B1;   // COMPLETION_STATUS_KHR
  const M = window.__m3d = { tap: null, firstDraw: null, frames: [], longtasks: [], progs: [], blocks: [], ext: null, renderer: null };
  const srcOf = new WeakMap(), info = new WeakMap();
  const name = (fs) => {
    const alp = (fs.match(/#define ALP (\d)/) || [])[1];
    if (/cLayer/.test(fs)) return 'gelaende' + (alp === undefined ? '' : ['', '_weiss', '_alpin'][+alp] || '_' + alp);
    if (/gnoise/.test(fs)) return 'rauschen';
    if (/u_srcD/.test(fs)) return 'hoehe';
    if (/u_psize/.test(fs)) return 'sonde';
    if (/u_src2/.test(fs)) return 'blit';
    if (/skyColor/.test(fs)) return 'himmel';
    return 'anderes';
  };
  // Nonce: macht jeden nach dem Antippen übersetzten Shader einmalig (nie getroffene Zeile am Anfang von main) – sonst
  // misst man ab dem zweiten Lauf nur die Shader-Caches von Treiber/Betriebssystem (Mac: Metal-Systemcache)
  const NONCE = __NONCE__;
  const oSS = P.shaderSource; P.shaderSource = function (s, src) {
    srcOf.set(s, src);
    if (NONCE && M.tap !== null) {
      const r = (Math.random() * 1e6 + 1e6).toFixed(3);
      src = /gl_Position/.test(src) ? src.replace('void main() {', `void main() {\n    if (gl_VertexID < -${r.split('.')[0]}) { gl_Position = vec4(${r}); return; }`)
                                    : src.replace('void main() {', `void main() {\n    if (gl_FragCoord.x < -${r}) discard;`);
    }
    return oSS.call(this, s, src);
  };
  const oAtt = P.attachShader; P.attachShader = function (p, s) { const i = info.get(p) || { sh: [] }; i.sh.push(s); info.set(p, i); return oAtt.call(this, p, s); };
  const oLink = P.linkProgram;
  P.linkProgram = function (p) {
    const i = info.get(p) || { sh: [] };
    const srcs = i.sh.map(s => srcOf.get(s) || '');
    const fs = srcs.find(s => /out\s+(vec4|uint)/.test(s) && !/gl_Position/.test(s)) || srcs[srcs.length - 1] || '';
    (window.__m3dSh = window.__m3dSh || []).push({ p, sh: i.sh.slice() });
    Object.assign(i, { tLink: performance.now(), chars: srcs.reduce((a, s) => a + s.length, 0), name: name(fs), afterTap: M.tap !== null, block: 0 });
    info.set(p, i); M.progs.push(i);
    return oLink.call(this, p);
  };
  const oGPP = P.getProgramParameter;
  P.getProgramParameter = function (p, pn) {
    const i = info.get(p), t = performance.now();
    if (SLOW > 0 && i && i.afterTap && i.tDone === undefined) {
      if (pn === CS && t < i.tLink + SLOW) return false;
      if (pn === this.LINK_STATUS) while (performance.now() < i.tLink + SLOW) {}
    }
    const r = oGPP.call(this, p, pn), d = performance.now() - t;
    if (i && (pn === this.LINK_STATUS || pn === CS)) {
      i.block += d;
      if (d > 2) M.blocks.push({ prog: i.name, ms: +d.toFixed(1), t: +(t - (M.tap || 0)).toFixed(1) });
      if (i.tDone === undefined && (pn === this.LINK_STATUS || r)) i.tDone = performance.now();
    }
    return r;
  };
  const oGSP = P.getShaderParameter;
  P.getShaderParameter = function (s, pn) {
    const t = performance.now(), r = oGSP.call(this, s, pn), d = performance.now() - t;
    if (d > 2) M.blocks.push({ prog: 'shader', ms: +d.toFixed(1), t: +(t - (M.tap || 0)).toFixed(1) });
    return r;
  };
  // erstes Zeichnen je Programm (Zeit relativ zum Antippen) – zeigt, wann welche Pipeline gebaut wird
  let cur = null; M.firstUse = {};
  const oUP = P.useProgram; P.useProgram = function (p) { cur = p; return oUP.call(this, p); };
  const note = () => { if (M.tap === null) return; const i = info.get(cur); const k = i ? i.name : '?'; if (!(k in M.firstUse)) M.firstUse[k] = +(performance.now() - M.tap).toFixed(1); };
  const oDA = P.drawArrays; P.drawArrays = function (...a) { note(); return oDA.apply(this, a); };
  // erstes 3D-Bild = erstes Gelände-Zeichnen mit vollem Gitter (Anwärmen ab 6.3 zeichnet nur 6 Indizes)
  const oDE = P.drawElements;
  P.drawElements = function (...a) { note(); if (M.tap !== null && M.firstDraw === null && a[1] > 6) M.firstDraw = performance.now(); return oDE.apply(this, a); };
  // alle übrigen WebGL-Aufrufe: lange synchrone Aufrufe nach dem Antippen festhalten (wer blockiert den Haupt-Thread?)
  for (const k of Object.getOwnPropertyNames(P)) {
    if (['getProgramParameter', 'getShaderParameter', 'shaderSource', 'attachShader', 'linkProgram', 'drawElements'].includes(k)) continue;
    const d = Object.getOwnPropertyDescriptor(P, k);
    if (!d || typeof d.value !== 'function') continue;
    const f = d.value;
    P[k] = function (...a) { const t = performance.now(), r = f.apply(this, a), ms = performance.now() - t;
      if (ms > 15 && M.tap !== null) M.blocks.push({ prog: 'gl.' + k, ms: +ms.toFixed(1), t: +(t - M.tap).toFixed(1) }); return r; };
  }
  const oGC = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...a) {
    const gl = oGC.apply(this, a);
    if (gl && a[0] === 'webgl2' && !M.renderer) {
      M.ext = !!gl.getExtension('KHR_parallel_shader_compile');
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      M.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
    return gl;
  };
  const loop = (t) => { M.frames.push(performance.now()); if (M.frames.length > 20000) M.frames.shift(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) M.longtasks.push({ t: e.startTime, ms: e.duration }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  addEventListener('pointerdown', (e) => { if (M.tap === null && e.target.closest && e.target.closest('#btn-3d')) M.tap = performance.now(); }, true);
})();
"""

DEVICES = {'desktop': dict(viewport={'width': 1280, 'height': 800}, device_scale_factor=1),
           'pixel7': None}


def serve(root):
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    class Q(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    httpd = ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Q, directory=root))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{port}/index.html'


def launch(p):
    win = sys.platform.startswith('win')
    angle = arg('angle')
    args = []
    if angle == 'swiftshader': args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    elif angle: args = ['--use-angle=' + angle, '--ignore-gpu-blocklist']
    elif not win and sys.platform == 'darwin': args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    else: args = ['--ignore-gpu-blocklist']          # Windows: Standard-Backend (ANGLE/Direct3D 11)
    kw = dict(args=args, headless=not arg('headed'))
    br = arg('browser', 'chrome' if win else 'chromium')
    if br == 'chrome':
        try: return p.chromium.launch(channel='chrome', **kw), 'chrome'
        except Exception as e: print('Chrome nicht gefunden, nehme Playwright-Chromium:', str(e).splitlines()[0])
    return p.chromium.launch(**kw), 'chromium'


def one_run(p, url, slow, look):
    browser, which = launch(p)
    dev = arg('device', 'desktop')
    ctx_kw = dict(p.devices['Pixel 7']) if dev == 'pixel7' else DEVICES['desktop']
    ctx = browser.new_context(**ctx_kw)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.add_init_script(HOOK.replace('__SLOW__', str(int(slow))).replace('__NONCE__', 'false' if arg('cache') else 'true'))
    q = 'nosw&noanim' + ('&' + arg('query') if arg('query') else '')
    full = url + ('&' if '?' in url else '?') + q + '#m=0&x=-0.7453&y=0.1127&z=300' + ({'alpin': '&p=alpine&al=f&sc=w', 'weiss': '&sc=w'}.get(look, ''))
    try:
        pg.goto(full, wait_until='load', timeout=60000)
        pg.wait_for_function("() => window.__fraktal && window.__fraktal.status && window.__fraktal.status().done", timeout=120000)
        time.sleep(1.5)
        ver = pg.evaluate("() => window.__fraktal.APP_VERSION")
        pg.click('#btn-3d', timeout=10000)
        t0 = time.time()
        tmax = float(arg('timeout', 180))
        while time.time() - t0 < tmax:
            if pg.evaluate("() => window.__m3d.firstDraw !== null"): break
            time.sleep(0.1)
        time.sleep(1.6)
        # Größe des vom Treiber übersetzten Codes je Programm (WEBGL_debug_shaders; Mac: Metal-Code, Windows: HLSL)
        tr = pg.evaluate("""() => { const gl = document.getElementById('gl').getContext('webgl2'), x = gl.getExtension('WEBGL_debug_shaders');
            if (!x) return null; return (window.__m3dSh || []).map(e => e.sh.reduce((a, s) => a + (x.getTranslatedShaderSource(s) || '').length, 0)); }""")
        M = pg.evaluate("() => window.__m3d")
        if tr:
            for i, n in zip(M['progs'], tr): i['translated'] = n
        on = pg.evaluate("() => window.__fraktal.view3dInfo().on")
        fin = pg.evaluate("() => { const v = window.__fraktal.view3dInfo(); return { on: v.on, prep: v.prep, prepInfo: v.prepInfo, btn: document.getElementById('btn-3d').className }; }")
    finally:
        browser.close()
    tap, fd = M['tap'], M['firstDraw']
    end = (fd if fd is not None else M['frames'][-1]) + 1500
    fr = [t for t in M['frames'] if tap - 50 <= t <= end]
    gaps = [b - a for a, b in zip(fr, fr[1:])]
    big = [dict(at=round(a - tap, 1), ms=round(b - a, 1)) for a, b in zip(fr, fr[1:]) if b - a > 50]
    prep = [t for t in M['frames'] if tap <= t <= (fd or end)]
    lts = [x for x in M['longtasks'] if x['t'] + x['ms'] >= tap and x['t'] <= end]
    progs = [dict(name=i['name'], chars=i['chars'], translatedChars=i.get('translated'), compileMs=round(i['tDone'] - i['tLink'], 1) if i.get('tDone') is not None else None,
                  blockMs=round(i['block'], 1), startMs=round(i['tLink'] - tap, 1))
             for i in M['progs'] if i.get('afterTap')]
    r = dict(version=ver, browser=which, renderer=M['renderer'], parallelExt=M['ext'], slowSimMs=slow, look=look or 'standard',
             device=arg('device', 'desktop'), angle=arg('angle') or 'standard',
             tapToFirst3dMs=round(fd - tap, 1) if fd is not None else None, on3d=on,
             maxFrameGapMs=round(max(gaps), 1) if gaps else None,
             framesOver100ms=sum(1 for g in gaps if g > 100), framesOver50ms=sum(1 for g in gaps if g > 50),
             longTasks=len(lts), longestTaskMs=round(max([x['ms'] for x in lts], default=0), 1),
             fpsDuringPrep=round((len(prep) - 1) / max(1e-3, (prep[-1] - prep[0]) / 1000), 1) if len(prep) > 2 else None,
             blockingStatusMs=round(sum(x['blockMs'] for x in progs), 1), programs=progs,
             final=fin, bigGaps=big[:20], firstUse=M.get('firstUse'), firstDrawAt=round(fd - tap, 1) if fd is not None else None, blocks=M['blocks'][:40], errors=errors[:10])
    return r


def line(r):
    return (f"{r['version']} [{r['angle']}{', slow ' + str(r['slowSimMs']) + ' ms' if r['slowSimMs'] else ''}, {r['look']}]: "
            f"Tippen->3D {r['tapToFirst3dMs']} ms, längster Block {r['maxFrameGapMs']} ms, Blöcke>100ms {r['framesOver100ms']}, "
            f"Long Tasks {r['longTasks']} (max {r['longestTaskMs']} ms), fps beim Vorbereiten {r['fpsDuringPrep']}, "
            f"Warten auf Shader {r['blockingStatusMs']} ms; Programme: " +
            ', '.join(f"{x['name']} {x['compileMs']}ms" for x in r['programs']) + f" | {r['renderer']} ext={r['parallelExt']}")


def main():
    url = arg('url')
    httpd = None
    if not url:
        httpd, url = serve(arg('root', ROOT))
    slow = float(arg('slow', 0))
    look = arg('look')
    tag = arg('tag', 'run')
    out = []
    with sync_playwright() as p:
        for k in range(int(arg('runs', 1))):
            r = one_run(p, url, slow, look)
            out.append(r)
            print(line(r), flush=True)
    if httpd: httpd.shutdown()
    res = dict(tag=tag, platform=sys.platform, runs=out)
    if len(out) > 1:
        res['median'] = {k: statistics.median([r[k] for r in out if r[k] is not None]) for k in ('tapToFirst3dMs', 'maxFrameGapMs', 'blockingStatusMs')}
    fn = os.path.join(HERE, f'results_3dstart_{tag}.json')
    json.dump(res, open(fn, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print('->', fn)


if __name__ == '__main__':
    main()
