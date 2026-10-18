#!/usr/bin/env python3
"""7.1.11: FXC-Übersetzungszeiten am rog messen (Chrome/ANGLE D3D11, frisches Profil je Lauf, NVIDIA in Peters Sitzung).
Varianten: tests/fxc_probe.html (V = {...}) oder eigene Quelltexte als JSON {name: glsl}.
python3 -u fxc_rog.py "base,guardU,noBLA" [extra.json] [timeout_s]
Voraussetzung: lokaler Server ~/dev/Fraktale auf 8472 (Tunnel -R bringt ihn an den rog); am rog im Benutzerordner
startit.ps1 / killfk.ps1 / q3i.ps1 und der geplante Task „fk-gltest“ (startet Chrome headless mit --remote-debugging-port=9333
in der angemeldeten Sitzung – über SSH allein (Sitzung 0) gibt es nur zeitweise eine GPU). Ergebnis: {name: {ms, ok, len}}."""
import sys, json, time, subprocess, urllib.request
from playwright.sync_api import sync_playwright

names = sys.argv[1].split(',')
extra = json.load(open(sys.argv[2])) if len(sys.argv) > 2 and sys.argv[2] not in ('', '-') else {}
TO = float(sys.argv[3]) if len(sys.argv) > 3 else 300

def ssh(cmd):
    return subprocess.run(['ssh', 'rog', cmd], capture_output=True, text=True, errors='replace')

ssh(r'powershell -NoProfile -ExecutionPolicy Bypass -File $env:USERPROFILE\startit.ps1')
if subprocess.run(['pgrep', '-f', 'L 9333:127.0.0.1:9333'], capture_output=True).returncode != 0:
    subprocess.run(['ssh', '-f', '-N', '-o', 'ExitOnForwardFailure=yes', '-L', '9333:127.0.0.1:9333', '-R', '8472:127.0.0.1:8472', 'rog'])
for i in range(30):
    try: urllib.request.urlopen('http://127.0.0.1:9333/json/version', timeout=2).read(); break
    except Exception: time.sleep(1)
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    pg = b.contexts[0].new_page()
    pg.goto(f'http://127.0.0.1:8472/tests/fxc_probe.html?x={time.time()}')
    if extra: pg.evaluate('(e) => { Object.assign(self.extra, e); }', extra)
    t = time.time()
    r = pg.evaluate('([n, to]) => self.probe(n, to)', [names, TO * 1000])
    r['_wall_s'] = round(time.time() - t, 1)
    print(json.dumps(r, ensure_ascii=False))
    pg.close()
ssh(r'powershell -NoProfile -ExecutionPolicy Bypass -File $env:USERPROFILE\killfk.ps1')
