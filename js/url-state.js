// url-state.js — URL-Zustand (Deeplinks): Link aus der Ansicht bauen, beim Start lesen, laufend in die Adresszeile schreiben
// (Phase 4 des Umbaus 6.5.4: aus js/app.js herausgelöst – Funktionen und Namen unverändert, nur der Ort ist neu.
// app.js ruft create(ctx); Namen aus app.js werden nach dem Anlegen aller Module per link() gebunden, veränderliche
// Variablen der App liest/schreibt das Modul über ctx.<name>.)
(function (root) {
'use strict';

root.FKUrlState = { create(ctx) {
    let HP, PAL, S, isMoving, setCam;   // aus app.js, gesetzt in link()

    function stateURL() {
        const d = HP.digitsForZoom(S.cam.zoom);
        const p = new URLSearchParams();
        p.set('m', S.formula);
        p.set('x', HP.toString(S.cam.cx, d)); p.set('y', HP.toString(S.cam.cy, d));
        p.set('z', S.cam.zoom.toPrecision(6));
        p.set('p', PAL.list[S.palette].id);
        if (S.formula === 1) { p.set('jx', HP.toString(S.julia.x, 12)); p.set('jy', HP.toString(S.julia.y, 12)); }
        if (S.iterManual) p.set('it', S.iterValue);
        const sc = setColParam(); if (sc) p.set('sc', sc);
        if (S.alpine) p.set('al', S.valley[0]);
        return location.origin + location.pathname + '#' + p.toString();
    }
    function readURL() {
        const h = location.hash.replace(/^#/, '');
        if (!h) return false;
        const p = new URLSearchParams(h);
        if (!p.has('x')) return false;
        const m = Math.max(0, Math.min(7, parseInt(p.get('m') || '0', 10) || 0));
        S.formula = m;
        if (p.has('jx')) S.julia = { x: HP.fromString(p.get('jx')), y: HP.fromString(p.get('jy') || '0') };
        if (p.has('p')) S.palette = PAL.indexOf(p.get('p'));
        // der Link beschreibt das Bild vollständig: ohne sc = Schwarz, ohne al = kein Alpin-Look
        applySetColParam(p.get('sc') || '');
        S.alpine = p.has('al');
        if (S.alpine) S.valley = { f: 'forest', l: 'lake', m: 'meadow' }[p.get('al')] || 'forest';
        // Iterationen wie beim Knopf (changeIter) auf 50 … 500 000 begrenzen: ein Link mit it=99999999 erzeugte GPU-Häppchen
        // von Minuten (Windows-Watchdog -> Kontextverlust)
        if (p.has('it')) { S.iterManual = true; S.iterValue = Math.max(50, Math.min(500000, parseInt(p.get('it'), 10) || 300)); }
        setCam(HP.fromString(p.get('x')), HP.fromString(p.get('y') || '0'), parseFloat(p.get('z')) || 1);
        return true;
    }
    // 6.2 Farbe der Menge im Link: sc=w (Weiß), d/l (dunkelste/hellste Palettenfarbe), sonst Hex ohne # (eigene);
    // fehlt = Schwarz. al=f|l|m: Alpin-Look mit Wald/See/Wiese im Tal
    // 6.4: sc=b1 (Bunt, Inseln) / sc=b2 (Bunt, Ringe)
    function setColParam() { return S.setCol === 'white' ? 'w' : S.setCol === 'dark' ? 'd' : S.setCol === 'light' ? 'l' : S.setCol === 'custom' ? S.setHex.slice(1) : S.setCol === 'bunt' ? 'b' + (S.inMode === 2 ? 2 : 1) : ''; }
    function applySetColParam(v) {
        if (v === 'w') S.setCol = 'white'; else if (v === 'd') S.setCol = 'dark'; else if (v === 'l') S.setCol = 'light';
        else if (/^b[12]$/.test(v)) { S.setCol = 'bunt'; S.inMode = +v[1]; }
        else if (/^[0-9a-fA-F]{6}$/.test(v)) { S.setCol = 'custom'; S.setHex = '#' + v.toLowerCase(); }
        else S.setCol = 'black';
    }
    let urlT = 0, urlKey = '';
    function syncURL(now) {
        if (now - urlT < 700 || isMoving(now)) return;
        urlT = now;
        const u = stateURL();
        if (u !== urlKey) { urlKey = u; try { history.replaceState(null, '', u); } catch (e) {} }
    }

    return { link() { ({ HP, PAL, S, isMoving, setCam } = ctx); },
             readURL, setColParam, stateURL, syncURL };
} };
})(typeof self !== 'undefined' ? self : globalThis);
