"""Gemeinsame Helfer für die Playwright-E2E-Tests (Pixel-7-Emulation, Touch)."""
import json, time, os, sys, tempfile
from playwright.sync_api import sync_playwright

BASE = os.environ.get("FK_BASE", "http://localhost:8472/index.html")
GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
# Windows (rog): ANGLE/Direct3D 11 wie Chrome dort. FXC übersetzt die 2D-Shader ohne Cache ~80 s lang (gemessen,
# frisches Profil) – darum ein dauerhaftes Profil je Platz (Shader-Cache bleibt), höchstens 4 Browser gleichzeitig.
# FK_ANGLE=vulkan: schneller Ersatz ohne FXC.
WIN = sys.platform == 'win32'
if WIN:
    GPU_ARGS = ['--use-angle=' + os.environ.get('FK_ANGLE', 'd3d11'), '--enable-gpu', '--ignore-gpu-blocklist']


def launch_ctx(p, args, headless, **ctx):
    """Windows: dauerhaftes Profil (Platz 0–3, belegte Plätze überspringen); sonst frischer Browser."""
    if not WIN:
        b = p.chromium.launch(args=args, headless=headless)
        return b, b.new_context(**ctx)
    err = None
    for slot in range(4):
        d = os.path.join(tempfile.gettempdir(), 'fk_pw_%s_%d' % (os.environ.get('FK_ANGLE', 'd3d11'), slot))
        try:
            c = p.chromium.launch_persistent_context(d, args=args, headless=headless, **ctx)
        except Exception as e:  # Profil belegt
            err = e
            continue
        # Einstellungen/Orte/Service Worker vom letzten Lauf löschen (der GPU-Shader-Cache bleibt)
        pg = c.pages[0] if c.pages else c.new_page()
        cdp = c.new_cdp_session(pg)
        from urllib.parse import urlsplit
        u = urlsplit(BASE)
        for host in {u.hostname, 'localhost', '127.0.0.1'}:
            cdp.send('Storage.clearDataForOrigin', {'origin': '%s://%s%s' % (u.scheme, host, ':%d' % u.port if u.port else ''), 'storageTypes': 'all'})
        cdp.send('Network.clearBrowserCache')   # sonst liefert der HTTP-Cache alte Dateien mit gleicher ?v=-Nummer
        cdp.detach()
        return c, c
    raise err


class App:
    def __init__(self, p, gpu=True, device='Pixel 7', landscape=False, query='nosw&noanim', extra_ctx=None):
        self.errors = []
        # FK_HEADED=1: sichtbares Fenster (headless drosselt macOS den Bildtakt zeitweise auf ~10 Bilder/s – für Flug-
        # und Bildratenmessungen dann sichtbar messen)
        dev = dict(p.devices[device])
        if landscape:
            vw, vh = dev['viewport']['width'], dev['viewport']['height']
            dev['viewport'] = {'width': vh, 'height': vw}
            if 'screen' in dev:
                dev['screen'] = {'width': vh, 'height': vw}
        if extra_ctx:
            dev.update(extra_ctx)
        dev.pop('default_browser_type', None)
        self.browser, self.ctx = launch_ctx(p, GPU_ARGS if gpu else [], os.environ.get('FK_HEADED') != '1', **dev)
        self.page = self.ctx.new_page()
        if WIN:   # kalter Shader-Cache: das erste Laden blockiert unter FXC bis ~80 s
            self.page.set_default_navigation_timeout(240000)
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: " + str(e)))
        self.page.on("console", lambda m: self.errors.append("console: " + m.text) if m.type == "error" else None)
        self.query = query

    def open(self, hash_=''):
        url = BASE + ('?' + self.query if self.query else '') + (('#' + hash_) if hash_ else '')
        self.page.goto(url, wait_until='load')
        self.page.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
        return self

    def status(self):
        return self.page.evaluate("() => window.__fraktal.status()")

    def set_view(self, cx, cy, zoom, formula=None):
        if formula is not None:
            self.page.evaluate(f"() => window.__fraktal.setMode({formula}, true)")
        self.page.evaluate("([cx,cy,z]) => window.__fraktal.setView(cx, cy, z)", [cx, cy, zoom])

    def wait_done(self, timeout=120):
        t0 = time.time()
        # erst warten bis Key "gesehen", dann bis fertig
        time.sleep(0.25)
        while time.time() - t0 < timeout:
            st = self.status()
            if st['done']:
                return time.time() - t0, st
            time.sleep(0.1)
        raise TimeoutError(json.dumps(self.status()))

    def wait_3d(self, timeout=20):
        # 6.3: 3D blendet erst ein, wenn die Shader übersetzt sind (nicht blockierend) – darauf warten
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.page.evaluate("() => { const v = window.__fraktal.view3dInfo(); return v.on && v.mix >= 1; }"):
                return True
            time.sleep(0.1)
        return False

    def read_front(self):
        return self.page.evaluate("() => window.__fraktal.readFront()")

    def close(self):
        self.browser.close()
