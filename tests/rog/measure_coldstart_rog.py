#!/usr/bin/env python3
"""Kalt-Start-Messung je Welt am rog (Chrome 155, ANGLE D3D11/FXC), über CDP-Tunnel.
Aufruf: python3 -u rog_cold.py <base_url> <out.jsonl> [welten,komma] [wait_s]"""
import sys, time, json, subprocess, urllib.request, random

BASE = sys.argv[1]
OUT = sys.argv[2]
WORLDS = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 and sys.argv[3] else list(range(19))
WAIT = float(sys.argv[4]) if len(sys.argv) > 4 else 150
EXTRA_SSH = sys.argv[5] if len(sys.argv) > 5 else ''

HOOK = r"""
(() => {
  const P = WebGL2RenderingContext.prototype, t0 = performance.now();
  const srcs = new WeakMap(), att = new WeakMap();
  window.__slow = []; window.__sync = 0; window.__links = 0; window.__lost = null;
  const as = P.attachShader; P.attachShader = function (p, sh) { (att.get(p) || att.set(p, []).get(p)).push(sh); return as.call(this, p, sh); };
  const ss = P.shaderSource; P.shaderSource = function (sh, src) { srcs.set(sh, src); return ss.call(this, sh, src); };
  const lp = P.linkProgram; P.linkProgram = function (p) { window.__links++; return lp.call(this, p); };
  const wrap = (name) => { const f = P[name]; P[name] = function (...a) { const s = performance.now(); const r = f.apply(this, a); const d = performance.now() - s; window.__sync += d;
      if (d > 250) window.__slow.push({ fn: name, pname: a[1], ms: Math.round(d), at: Math.round(s - t0),
        lens: (name === 'getProgramParameter' ? (att.get(a[0]) || []) : [a[0]]).map(sh => (srcs.get(sh) || '').length),
        head: (name === 'getProgramParameter' ? (att.get(a[0]) || []) : [a[0]]).map(sh => (srcs.get(sh) || '').slice(0, 160)).join(' ### '),
        stack: new Error().stack.split('\n').slice(2, 7).map(x => x.trim().replace(/https:\/\/[^/]+\/Fraktale\//, '')).join(' < ') });
      return r; }; };
  ['getProgramParameter', 'getShaderParameter', 'getUniformLocation', 'useProgram', 'drawArrays', 'readPixels', 'clientWaitSync', 'getError'].forEach(wrap);
  window.addEventListener('webglcontextlost', () => { window.__lost = Math.round(performance.now() - t0); }, true);
})();
"""

def wait_port(timeout=40):
    t = time.time()
    while time.time() - t < timeout:
        try:
            urllib.request.urlopen('http://127.0.0.1:9333/json/version', timeout=2).read(); return True
        except Exception:
            time.sleep(1)
    return False

from playwright.sync_api import sync_playwright
for m in WORLDS:
    subprocess.run(['ssh', 'rog', r'powershell -NoProfile -ExecutionPolicy Bypass -File $env:USERPROFILE\startit.ps1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if subprocess.run(['pgrep', '-f', 'L 9333:127.0.0.1:9333'], capture_output=True).returncode != 0:
        subprocess.run(['ssh', '-f', '-N', '-o', 'ExitOnForwardFailure=yes', '-L', '9333:127.0.0.1:9333', 'rog'], stderr=subprocess.DEVNULL)
    class _SP:
        def kill(self): pass
    sp = _SP()
    if not wait_port():
        print('m', m, 'PORT FAIL'); continue
    rec = {'m': m}
    try:
        with sync_playwright() as p:
            b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
            ctx = b.contexts[0]
            pg = ctx.new_page(); pg.set_viewport_size({'width': 1600, 'height': 900})
            errs = []
            pg.on('console', lambda msg: errs.append(msg.text[:200]) if msg.type == 'error' else None)
            pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)[:200]))
            T0 = time.time()
            pg.on('crash', lambda *_: errs.append(f'CRASH at {time.time()-T0:.1f}'))
            pg.on('close', lambda *_: errs.append(f'CLOSE at {time.time()-T0:.1f}'))
            b.on('disconnected', lambda *_: errs.append(f'BROWSER DISCONNECTED at {time.time()-T0:.1f}'))
            ok = None
            for i in range(30):
                try:
                    pg.goto(BASE + 'manifest.json')
                    ok = pg.evaluate("(() => { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); })()")
                except Exception: ok = None
                if ok: break
                time.sleep(1)
            rec['gl_wait'] = i
            if not ok:
                rec['err'] = 'NO WEBGL2 in test browser'; raise RuntimeError('nogl')
            pg.close(); pg = ctx.new_page(); pg.set_viewport_size({'width': 1600, 'height': 900})
            pg.on('console', lambda msg: errs.append(msg.text[:200]) if msg.type == 'error' else None)
            pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)[:200]))
            pg.add_init_script(HOOK)
            url = f"{BASE}?cold={random.randint(1, 10**9)}#m={m}&x=-0.5&y=0&z=1"
            t = time.time()
            try:
                pg.goto(url, wait_until='load', timeout=int(WAIT * 1000))
                rec['load_s'] = round(time.time() - t, 1)
            except Exception as e:
                rec['load_s'] = 'TIMEOUT'
            done_at = None
            while time.time() - t < WAIT:
                try:
                    d = pg.evaluate("(() => { try { const s = window.__fraktal && window.__fraktal.status(); return s ? !!s.done : null; } catch (e) { return 'ERR' } })()")
                except Exception as e:
                    d = None
                    if 'closed' in str(e): break
                if d is True:
                    done_at = round(time.time() - t, 1); break
                time.sleep(0.5)
            rec['done_s'] = done_at
            try:
                rec.update(pg.evaluate("({ slow: window.__slow, sync_ms: Math.round(window.__sync), links: window.__links, lost: window.__lost, title: document.title })"))
            except Exception as e:
                rec['evalerr'] = str(e)[:200]
            rec['errs'] = errs[:8]
            try: pg.close()
            except Exception: pass
    except Exception as e:
        rec['err'] = str(e)[:300]
    sp.kill()
    print(json.dumps({k: v for k, v in rec.items() if k != 'slow'}), '| slow:', [(s['fn'], s['ms'], s['lens']) for s in rec.get('slow', [])], flush=True)
    with open(OUT, 'a') as f: f.write(json.dumps(rec) + '\n')
subprocess.run(['ssh', 'rog', r'powershell -NoProfile -ExecutionPolicy Bypass -File $env:USERPROFILE\killfk.ps1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
