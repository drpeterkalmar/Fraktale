"""Deeplinks robust (Gutachten P3-5, ab 6.5.4): it oben gedeckelt, Dezimalkomma in x/y/jx/jy.
Aufruf: python3 tests/test_deeplink.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ok = True
with sync_playwright() as p:
    a = App(p).open('m=0&x=-0,7453&y=0,1127&z=300&it=99999999')
    st = a.page.evaluate("() => { const A = window.__fraktal; return { it: A.S.iterValue, man: A.S.iterManual, v: A.viewState() }; }")
    print(st)
    ok &= st['it'] == 500000 and st['man'] and st['v']['cx'].startswith('-0.7453') and st['v']['cy'].startswith('0.1127') and st['v']['zoom'] == 300
    ok &= not a.errors
    a.close()
    a = App(p).open('m=1&x=0&y=0&z=1&jx=-0,8&jy=0,156')
    v = a.page.evaluate("() => window.__fraktal.viewState()")
    print(v)
    ok &= v['formula'] == 1 and v['jx'].startswith('-0.800000') and v['jy'].startswith('0.156000') and not a.errors
    a.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
