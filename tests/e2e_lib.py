"""Gemeinsame Helfer für die Playwright-E2E-Tests (Pixel-7-Emulation, Touch)."""
import json, time, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("FK_BASE", "http://localhost:8472/index.html")
GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']


class App:
    def __init__(self, p, gpu=True, device='Pixel 7', landscape=False, query='nosw&noanim', extra_ctx=None):
        self.errors = []
        # FK_HEADED=1: sichtbares Fenster (headless drosselt macOS den Bildtakt zeitweise auf ~10 Bilder/s – für Flug-
        # und Bildratenmessungen dann sichtbar messen)
        self.browser = p.chromium.launch(args=GPU_ARGS if gpu else [], headless=os.environ.get('FK_HEADED') != '1')
        dev = dict(p.devices[device])
        if landscape:
            vw, vh = dev['viewport']['width'], dev['viewport']['height']
            dev['viewport'] = {'width': vh, 'height': vw}
            if 'screen' in dev:
                dev['screen'] = {'width': vh, 'height': vw}
        if extra_ctx:
            dev.update(extra_ctx)
        self.ctx = self.browser.new_context(**dev)
        self.page = self.ctx.new_page()
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
