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
        const ou = outParam(); if (ou) p.set('ou', ou);
        const st = styleParam(); if (st) p.set('st', st);
        const wp = wpParam(); if (wp) p.set('wp', wp);
        // 7.0 Mandelbulb: Kamera (Position, Gieren, Nicken), Exponent, Julia-c; Stil/Nebel/Tiefenunschärfe, wenn nicht Standard
        if (ctx.isRay() && ctx.BULB) {
            p.set('b', ctx.BULB.stateString());
            if (S.bulbStyle) p.set('bs', S.bulbStyle);
            if (S.bulbFog !== 0.15) p.set('bf', S.bulbFog);
            if (S.bulbDof > 0) p.set('bd', S.bulbDof);
        }
        return location.origin + location.pathname + '#' + p.toString();
    }
    function readURL() {
        const h = location.hash.replace(/^#/, '');
        if (!h) return false;
        const p = new URLSearchParams(h);
        if (!p.has('x')) return false;
        const m = Math.max(0, Math.min(ctx.MODE_KEYS.length - 1, parseInt(p.get('m') || '0', 10) || 0));
        S.formula = m;
        applyWpParam(m, p.get('wp') || '');
        if (p.has('jx')) S.julia = { x: HP.fromString(p.get('jx')), y: HP.fromString(p.get('jy') || '0') };
        if (p.has('p')) S.palette = PAL.indexOf(p.get('p'));
        else if (ctx.WORLD_PAL[m]) S.palette = PAL.indexOf((S.wpal || {})[m] || ctx.WORLD_PAL[m]);   // 7.1: Palette der Welt
        // der Link beschreibt das Bild vollständig: ohne sc = Schwarz, ohne al = kein Alpin-Look
        applySetColParam(p.get('sc') || '');
        S.alpine = p.has('al');
        if (S.alpine) S.valley = { f: 'forest', l: 'lake', m: 'meadow' }[p.get('al')] || 'forest';
        applyOutParam(p.get('ou') || '');
        applyStyleParam(p.get('st') || '');
        // Iterationen wie beim Knopf (changeIter) auf 50 … 500 000 begrenzen: ein Link mit it=99999999 erzeugte GPU-Häppchen
        // von Minuten (Windows-Watchdog -> Kontextverlust)
        if (p.has('it')) { S.iterManual = true; S.iterValue = Math.max(50, Math.min(500000, parseInt(p.get('it'), 10) || 300)); }
        setCam(HP.fromString(p.get('x')), HP.fromString(p.get('y') || '0'), parseFloat(p.get('z')) || 1);
        if (ctx.isRay(m) && ctx.BULB) {
            // ohne b= : Mandelbulb-Link bis 6.9 (x/y = Drehung, z = Abstand), sonst Startansicht
            if (!(p.has('b') && ctx.BULB.applyState(p.get('b')))) {
                if (m === 6) ctx.BULB.applyLegacy(parseFloat(p.get('x')) || 0, parseFloat(p.get('y')) || 0, parseFloat(p.get('z')) || 1);
                else ctx.BULB.home();
            }
            S.bulbStyle = Math.max(0, Math.min(3, parseInt(p.get('bs') || '0', 10) || 0));
            S.bulbFog = p.has('bf') ? Math.max(0, Math.min(1, +p.get('bf') || 0)) : 0.15;
            S.bulbDof = p.has('bd') ? Math.max(0, Math.min(1, +p.get('bd') || 0)) : 0;
        }
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
    // 6.9 Außen im Link: ou=e<Saumbreite in CSS-Pixeln> (Grenznah), ou=k (Schwarz); fehlt = Palette (alte Links unverändert)
    function outParam() { return S.outMode === 'edge' ? 'e' + Math.round(S.edgeW) : S.outMode === 'black' ? 'k' : ''; }
    function applyOutParam(v) {
        const m = /^e(\d{1,3})$/.exec(v);
        if (m) { S.outMode = 'edge'; S.edgeW = Math.max(2, Math.min(80, +m[1])); }
        else if (v === 'k') S.outMode = 'black';
        else S.outMode = 'pal';
    }
    // 7.1 Welt-Parameter im Link: wp=<Schlüssel><Wert>_… nur die vom Standard abweichenden, z. B. wp=v1 (Celtic), wp=e3.5_m1
    // (Multibrot), wp=sAABAB (Lyapunov), wp=cr0.285_ci0.01 (Phoenix); fehlt = Standard der Welt (alte Links unverändert)
    function wpParam() {
        const f = S.formula, d = ctx.WP_DEF[f], w = S.wp[f];
        if (!d || !w) return '';
        return Object.keys(d).filter(k => String(w[k]) !== String(d[k])).map(k => k + (typeof d[k] === 'number' ? +(+w[k]).toPrecision(8) : w[k])).join('_');
    }
    function applyWpParam(f, v) {
        const d = ctx.WP_DEF[f];
        if (!d) return;
        const o = Object.assign({}, d);
        for (const part of String(v).split('_')) {
            const m = /^([a-z]+)(.+)$/.exec(part);
            if (!m || !(m[1] in d)) continue;
            if (typeof d[m[1]] === 'number') { const x = parseFloat(m[2].replace(',', '.')); if (isFinite(x)) o[m[1]] = x; }
            else o[m[1]] = m[2];
        }
        S.wp[f] = o;
    }
    // 7.1 Färbe-Stil im Link: st=<Stil>_<Stärke %>[_<Streifenzahl>] (Seide: Streifenzahl); fehlt = Standard (alte Links unverändert)
    function styleParam() { return S.style > 0 ? S.style + '_' + Math.round(S.stMix * 100) + (S.style === 1 ? '_' + S.stS : '') : ''; }
    function applyStyleParam(v) {
        const m = /^([1-6])(?:_(\d{1,3}))?(?:_(\d{1,2}))?$/.exec(v);
        if (!m) { S.style = 0; return; }
        S.style = +m[1];
        if (m[2] !== undefined) S.stMix = Math.max(0, Math.min(1, +m[2] / 100));
        if (m[3] !== undefined) S.stS = Math.max(1, Math.min(12, +m[3]));
    }
    let urlT = 0, urlKey = '';
    function syncURL(now) {
        if (now - urlT < 700 || isMoving(now)) return;
        urlT = now;
        const u = stateURL();
        if (u !== urlKey) { urlKey = u; try { history.replaceState(null, '', u); } catch (e) {} }
    }

    return { link() { ({ HP, PAL, S, isMoving, setCam } = ctx); },
             readURL, setColParam, outParam, styleParam, wpParam, applyWpParam, stateURL, syncURL };
} };
})(typeof self !== 'undefined' ? self : globalThis);
