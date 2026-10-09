// ui.js — Oberfläche: HUD, Dock, Bottom-Sheet, Karten, Paletten, c-Pad, Minimap, Teilen, Tastatur.
// Liest/schreibt nur über window.__fraktal (app.js). Alle Texte via translations.js (t()).
(function () {
'use strict';
const A = self.__fraktal;
if (!A) return;
const { S, HP, PAL, t } = A;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const V = '?v=' + A.APP_VERSION;

// ------------------------------------------------------------------ i18n
function applyI18n() {
    document.documentElement.lang = S.lang;
    document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); n.setAttribute('aria-label', t(n.dataset.i18nTitle)); });
    $('sheet-close').setAttribute('aria-label', t('close') !== 'close' ? t('close') : '×');
    buildModes(); buildUserPlaces();
    hudUpdate(true);
}

// ------------------------------------------------------------------ Toast
let toastTimer = 0;
function toast(msg, ms) {
    const n = $('toast');
    n.textContent = msg;
    n.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => n.classList.remove('show'), ms || 2600);
}

// ------------------------------------------------------------------ 6.5 Deko: weiche Übergänge
// Beim Wechsel von Welt/Farbe/Look: Schnappschuss des aktuellen Bilds (frisch gezeichnet, im selben Task lesbar) liegt
// als Ebene über dem Canvas und blendet aus, während darunter schon das neue Bild steht. Einmalig pro Wechsel (kein
// Dauer-Loop); die Ebene wird danach freigegeben. ?deko=0 = harter Wechsel wie bis 6.4.1.
let fadeCv = null, fadeT = 0;
function crossfade(ms) {
    if (!A.DEKO || document.hidden) return;
    const src = A.R.canvas;
    if (!src.width || !src.height) return;
    try { A.freshFrame(); } catch (e) { return; }
    if (!fadeCv) { fadeCv = document.createElement('canvas'); fadeCv.id = 'xfade'; src.after(fadeCv); }
    fadeCv.width = src.width; fadeCv.height = src.height;
    fadeCv.getContext('2d').drawImage(src, 0, 0);
    fadeCv.hidden = false;
    fadeCv.style.transition = 'none'; fadeCv.style.opacity = '1';
    clearTimeout(fadeT);
    const dur = A.RM.matches ? 150 : ms;
    // zwei Bilder warten: das neue Bild steht dann schon unter der Ebene
    requestAnimationFrame(() => requestAnimationFrame(() => { fadeCv.style.transition = `opacity ${dur}ms cubic-bezier(.4, 0, .2, 1)`; fadeCv.style.opacity = '0'; }));
    fadeT = setTimeout(() => { fadeCv.hidden = true; fadeCv.width = fadeCv.height = 1; }, dur + 120);
}
function flash() {
    if (!A.DEKO || A.RM.matches) return;
    let f = $('flash');
    if (!f) { f = el('div'); f.id = 'flash'; document.body.appendChild(f); }
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

// ------------------------------------------------------------------ HUD
let hudT = 0, busyT0 = 0, sweepT = 0;
const MODE_NAMES = () => A.MODE_KEYS.map(k => t(k));
function hudUpdate(force) {
    const now = performance.now();
    if (!force && now - hudT < 200) return;
    hudT = now;
    const names = MODE_NAMES();
    $('hud-mode').textContent = cap(names[S.formula]);
    $('hud-zoom').textContent = A.fmtZoom(S.cam.zoom);
    const st = A.status();
    const prog = $('hud-progress');
    const job = A.RC.job;
    let p = null;
    if (job && now - job.t0 > 250) p = job.kind === 'gpu' ? job.row / job.h : job.tilesDone / Math.max(1, job.tilesTotal);
    const fx = A.RC.fix;
    if (p === null && fx) p = fx.total ? 0.5 + 0.5 * fx.done / fx.total : 0.5;   // Präzisionskorrektur = zweite Hälfte
    prog.style.transform = p === null ? 'scaleX(0)' : `scaleX(${Math.max(0.04, p).toFixed(3)})`;
    prog.classList.toggle('on', p !== null);
    const pill = $('hud-pill');
    if (A.DEKO) {   // 6.5: fertig nach > 0,6 s Rechnen → einmal Lichtschweif (höchstens alle 4 s, nicht im Flug)
        if (p !== null && !busyT0) busyT0 = now;
        else if (p === null && busyT0) {
            if (now - busyT0 > 600 && now - sweepT > 4000 && !A.FLY.on) { sweepT = now; pill.classList.remove('done'); void pill.offsetWidth; pill.classList.add('done'); }
            busyT0 = 0;
        }
    }
    pill.classList.toggle('busy', p !== null);
    if (!$('hud-details').hidden) {
        const d = HP.digitsForZoom(S.cam.zoom);
        $('d-re').textContent = HP.toString(S.cam.cx, d).replace('-', '−');
        $('d-im').textContent = HP.toString(S.cam.cy, d).replace('-', '−');
        $('d-zoom').textContent = A.fmtZoom(S.cam.zoom) + '  ⇄';
        $('d-iter').textContent = A.currentMaxIter();
        $('d-iter-auto').classList.toggle('on', !S.iterManual);
        $('d-engine').textContent = engineText(st);
        $('d-time').textContent = st.lastFullMs ? (st.lastFullMs / 1000).toFixed(2) + ' s' : '–';
        $('d-fps').textContent = st.fps || '–';
    }
    $('m-iter').textContent = A.currentMaxIter();
    $('t-iter-auto').checked = !S.iterManual;
    if (!$('sheet').hidden && currentTab === 'more') $('engine-info').textContent = engineText(st) + ' · ' + A.R.info().renderer;
    drawMinimap();
    updateJuliaChip();
}
function engineText(st) {
    const p = st.plan;
    if (p.kind === 'bulb') return 'GPU Raymarching';
    if (p.kind === 'buddha') return 'CPU Buddhabrot';
    let s = p.kind === 'gpu' ? (p.mode === 'direct' ? t('engine_gpu_direct') : t('engine_gpu_perturb')) : t('engine_cpu') + (p.mode === 'perturb' ? ' Perturbation' : ' f64');
    if (p.mode === 'perturb' && st.useBLA) s += ' ' + t('engine_bla');
    if (p.mode === 'perturb' && st.ref) s += ` · Ref ${st.ref.method}${st.ref.period ? ' p=' + st.ref.period : ''}`;
    return s;
}
const cap = (s) => s ? s.toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/Z³/g, 'z³') : s;

$('hud-pill').addEventListener('click', () => {
    const d = $('hud-details');
    d.hidden = !d.hidden;
    $('hud-pill').setAttribute('aria-expanded', String(!d.hidden));
    hudUpdate(true);
});
$('d-zoom').addEventListener('click', () => { S.zoomFormat = S.zoomFormat === 'words' ? 'sci' : 'words'; A.saveSettings(); hudUpdate(true); });
$('d-iter-up').addEventListener('click', () => A.changeIter(1.25));
$('d-iter-down').addEventListener('click', () => A.changeIter(0.8));
$('d-iter-auto').addEventListener('click', () => A.setIterAuto(true));
$('m-iter-up').addEventListener('click', () => A.changeIter(1.25));
$('m-iter-down').addEventListener('click', () => A.changeIter(0.8));
$('t-iter-auto').addEventListener('change', (e) => A.setIterAuto(e.target.checked));

// ------------------------------------------------------------------ Chrome ein/aus
function setChrome(on) {
    S.chrome = on;
    document.body.classList.toggle('immersive', !on);
}

// ------------------------------------------------------------------ Bottom-Sheet
const sheet = $('sheet');
let currentTab = null;
sheet.hidden = true;
function openSheet(tab) {
    if (!S.chrome) setChrome(true);
    currentTab = tab;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => sheet.classList.add('open'));
    document.querySelectorAll('#sheet-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.dock-btn[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
    requestAnimationFrame(moveInk);
    $('share-pop').hidden = true;
    document.body.classList.add('sheet-open');
    if (tab === 'worlds') { buildModes(); drawCpad(); }
    if (tab === 'more') hudUpdate(true);
}
// 6.5: gleitender Leuchtbalken unter dem aktiven Reiter
const ink = el('span'); ink.id = 'tab-ink'; $('sheet-tabs').prepend(ink);
function moveInk() {
    const b = document.querySelector('#sheet-tabs [role=tab].on');
    if (!b || !b.offsetWidth) return;
    ink.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    ink.style.width = b.offsetWidth + 'px';
}
addEventListener('resize', () => requestAnimationFrame(moveInk));
function closeSheet() {
    sheet.classList.remove('open', 'full');
    sheet.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('on'));
    document.body.classList.remove('sheet-open');
    currentTab = null;
    setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 320);
}
document.querySelectorAll('.dock-btn[data-tab]').forEach(b => b.addEventListener('click', () => {
    if (currentTab === b.dataset.tab) closeSheet(); else openSheet(b.dataset.tab);
}));
document.querySelectorAll('#sheet-tabs [data-tab]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.tab)));
$('sheet-close').addEventListener('click', closeSheet);

// Ziehen am Griff: runter = schließen, hoch = groß
(function sheetDrag() {
    const grab = $('sheet-grab');
    let y0 = null, t0 = 0, dy = 0;
    const start = (e) => { y0 = e.clientY; t0 = performance.now(); dy = 0; sheet.style.transition = 'none'; grab.setPointerCapture(e.pointerId); };
    const move = (e) => {
        if (y0 === null) return;
        dy = e.clientY - y0;
        const land = matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
        if (!land) sheet.style.transform = `translateY(${Math.max(-80, dy)}px)`;
    };
    const end = () => {
        if (y0 === null) return;
        const v = dy / Math.max(1, performance.now() - t0);
        sheet.style.transition = ''; sheet.style.transform = '';
        if (dy > 90 || v > 0.6) closeSheet();
        else if (dy < -40 || v < -0.5) sheet.classList.add('full');
        else if (dy > 30) sheet.classList.remove('full');
        y0 = null;
    };
    grab.addEventListener('pointerdown', start);
    grab.addEventListener('pointermove', move);
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
    grab.addEventListener('click', () => sheet.classList.toggle('full'));
})();

A.on((w) => {
    if (w === 'tap') {
        if (!sheet.hidden && sheet.classList.contains('open')) closeSheet();
        else if (!$('share-pop').hidden) $('share-pop').hidden = true;
        else if (!$('hud-details').hidden) { $('hud-details').hidden = true; $('hud-pill').setAttribute('aria-expanded', 'false'); }
        else if (hudless()) hudHide(true);         // 6.8: Vollbild/Kino-Modus – Tipp auf das Bild blendet die Bedienung wieder aus
        else setChrome(!S.chrome);
    } else if (w === 'frame') hudUpdate(false);
    else if (w === 'mode') { buildModes(); updateJuliaPanel(); hudUpdate(true); minimapBase = null; sync3d(); }
    else if (w === 'julia') { updateJuliaPanel(); }
    else if (w === 'iter') hudUpdate(true);
    else if (w === 'settings') syncControls();
    else if (w === '3d' || w === 'fly') sync3d();
    else if (w === '3dprep') prep3dProgress();
    else if (w && w.toast) toast(w.toast, w.ms);
});

// ------------------------------------------------------------------ Welten
function buildModes() {
    const g = $('mode-grid');
    g.innerHTML = '';
    const names = MODE_NAMES();
    A.MODE_KEYS.forEach((k, i) => {
        const b = el('button', 'mode-card' + (i === S.formula ? ' on' : ''));
        b.innerHTML = `<span class="thumb" style="background-image:url('assets/modes/${i}.jpg${V}')"></span><span class="name">${cap(names[i])}</span><span class="formula">${t('f_' + k)}</span>`;
        b.addEventListener('click', () => { if (i !== S.formula) crossfade(650); A.setMode(i); buildModes(); });
        g.appendChild(b);
    });
}
function updateJuliaPanel() {
    $('julia-panel').hidden = S.formula !== 1;
    $('jx').textContent = HP.toString(S.julia.x, 5).replace('-', '−');
    $('jy').textContent = HP.toString(S.julia.y, 5).replace('-', '−');
    drawCpad();
    updateJuliaChip();
}
function updateJuliaChip() {
    const c = $('julia-chip');
    c.hidden = S.formula !== 1;
    document.body.classList.toggle('julia-on', !c.hidden);
    if (!c.hidden) $('julia-chip-text').textContent = 'c = ' + A.fmtC(S.julia.x, S.julia.y);
}
$('julia-chip').addEventListener('click', () => { openSheet('worlds'); setTimeout(() => $('julia-panel').scrollIntoView({ block: 'start', behavior: 'smooth' }), 380); });
let jstep = 0.01;
document.querySelectorAll('#jstep button').forEach(b => b.addEventListener('click', () => {
    jstep = parseFloat(b.dataset.v);
    document.querySelectorAll('#jstep button').forEach(x => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.step, d = HP.fromNumber(k.endsWith('+') ? jstep : -jstep);
    if (k[0] === 'x') A.setJulia(S.julia.x + d, S.julia.y); else A.setJulia(S.julia.x, S.julia.y + d);
}));

// c-Pad: Mandelbrot-Übersicht, Punkt ziehen = Julia-c live
const cpad = $('cpad');
const CP = { x0: -2.1, x1: 0.9, y0: -1.125, y1: 1.125 };
let cpadImg = null;
function drawCpad() {
    if (S.formula !== 1 || !cpad.isConnected) return;
    const ctx = cpad.getContext('2d');
    const w = cpad.width, h = cpad.height;
    if (!cpadImg) cpadImg = mandelImage(ctx, w, h, CP, [120, 90, 200]);
    ctx.putImageData(cpadImg, 0, 0);
    const jx = HP.toNumber(S.julia.x), jy = HP.toNumber(S.julia.y);
    const px = (jx - CP.x0) / (CP.x1 - CP.x0) * w, py = (CP.y1 - jy) / (CP.y1 - CP.y0) * h;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.stroke();
    ctx.fillStyle = '#f0abfc'; ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
}
function mandelImage(ctx, w, h, box, tint) {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const cx = box.x0 + (x + 0.5) / w * (box.x1 - box.x0), cy = box.y1 - (y + 0.5) / h * (box.y1 - box.y0);
        let zx = 0, zy = 0, i = 0;
        for (; i < 60; i++) { const x2 = zx * zx, y2 = zy * zy; if (x2 + y2 > 4) break; zy = 2 * zx * zy + cy; zx = x2 - y2 + cx; }
        const o = (y * w + x) * 4;
        const v = i === 60 ? 0 : Math.sqrt(i / 60);
        img.data[o] = 12 + tint[0] * v; img.data[o + 1] = 14 + tint[1] * v; img.data[o + 2] = 30 + tint[2] * v; img.data[o + 3] = 255;
    }
    return img;
}
(function cpadDrag() {
    let on = false;
    const set = (e) => {
        const r = cpad.getBoundingClientRect();
        const x = CP.x0 + (e.clientX - r.left) / r.width * (CP.x1 - CP.x0);
        const y = CP.y1 - (e.clientY - r.top) / r.height * (CP.y1 - CP.y0);
        A.setJulia(HP.fromNumber(+x.toFixed(6)), HP.fromNumber(+y.toFixed(6)));
    };
    cpad.addEventListener('pointerdown', (e) => { on = true; cpad.setPointerCapture(e.pointerId); set(e); });
    cpad.addEventListener('pointermove', (e) => { if (on) set(e); });
    cpad.addEventListener('pointerup', () => { on = false; });
    cpad.addEventListener('pointercancel', () => { on = false; });
})();

// ------------------------------------------------------------------ Minimap
const mm = $('minimap-canvas');
let minimapBase = null;
function drawMinimap() {
    $('minimap').hidden = !S.minimap || S.formula >= 6;
    if ($('minimap').hidden) return;
    const ctx = mm.getContext('2d');
    const w = mm.width, h = mm.height;
    const home = A.MODE_HOME[S.formula];
    const hx = parseFloat(home[0]), hy = parseFloat(home[1]);
    const box = { x0: hx - 2, x1: hx + 2, y0: hy - 1.5, y1: hy + 1.5 };
    if (!minimapBase) {
        if (S.formula === 0 || S.formula === 1) minimapBase = mandelImage(ctx, w, h, box, [110, 100, 210]);
        else { minimapBase = ctx.createImageData(w, h); for (let i = 0; i < minimapBase.data.length; i += 4) { minimapBase.data[i] = 20; minimapBase.data[i + 1] = 22; minimapBase.data[i + 2] = 40; minimapBase.data[i + 3] = 255; } }
    }
    ctx.putImageData(minimapBase, 0, 0);
    const cx = HP.toNumber(S.cam.cx), cy = HP.toNumber(S.cam.cy);
    const vw = 3 / S.cam.zoom * (innerWidth / innerHeight), vh = 3 / S.cam.zoom;
    const px = (cx - box.x0) / (box.x1 - box.x0) * w, py = (box.y1 - cy) / (box.y1 - box.y0) * h;
    const rw = vw / (box.x1 - box.x0) * w, rh = vh / (box.y1 - box.y0) * h;
    ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 1.5;
    if (rw > 4) { ctx.fillStyle = 'rgba(167,139,250,0.18)'; ctx.fillRect(px - rw / 2, py - rh / 2, rw, rh); ctx.strokeRect(px - rw / 2, py - rh / 2, rw, rh); }
    else { ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px - 3, py); ctx.moveTo(px + 3, py); ctx.lineTo(px + 8, py); ctx.moveTo(px, py - 8); ctx.lineTo(px, py - 3); ctx.moveTo(px, py + 3); ctx.lineTo(px, py + 8); ctx.stroke(); }
}
mm.addEventListener('click', (e) => {
    const r = mm.getBoundingClientRect();
    const home = A.MODE_HOME[S.formula];
    const x = parseFloat(home[0]) - 2 + (e.clientX - r.left) / r.width * 4, y = parseFloat(home[1]) + 1.5 - (e.clientY - r.top) / r.height * 3;
    A.flyTo(HP.fromNumber(x), HP.fromNumber(y), Math.max(1, Math.min(S.cam.zoom, 1e4)));
});

// ------------------------------------------------------------------ Farben
function buildPalettes() {
    const g = $('palette-grid');
    g.innerHTML = '';
    PAL.list.forEach((p, i) => {
        const b = el('button', 'swatch' + (i === S.palette ? ' on' : ''));
        b.innerHTML = `<span class="bar" style="background:${PAL.gradientCSS(p)}"></span><span class="name">${p.custom ? t('custom_palette') : p.name}</span>`;
        if (i === S.palette) b.style.setProperty('--glow', PAL.cssOf(PAL.setRGB('light', S.setHex, p)) || '');
        b.addEventListener('click', () => { if (i !== S.palette) crossfade(420); S.palette = i; A.saveSettings(); A.invalidate(); buildPalettes(); syncSet(); });
        g.appendChild(b);
    });
    $('custom-bar').style.background = PAL.gradientCSS(PAL.list[PAL.list.length - 1], 24);
    syncSet();
}
for (let i = 0; i < 6; i++) {
    const inp = $('custom-color-' + i);
    inp.value = PAL.custom[i];
    const apply = () => { if (!/^#[0-9a-fA-F]{6}$/.test(inp.value)) return; PAL.setCustom(i, inp.value); S.palette = PAL.list.length - 1; A.invalidate(); buildPalettes(); };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', () => { apply(); PAL.saveCustom(); A.saveSettings(); });
}
// 6.2 Farbe der Menge + Alpin-Look
function syncSet() {
    const p = PAL.list[S.palette];
    document.querySelectorAll('#seg-setcol button').forEach(b => {
        b.classList.toggle('on', b.dataset.v === S.setCol);
        b.querySelector('.sdot').style.background = b.dataset.v === 'bunt' ? PAL.gradientCSS(p, 6) : PAL.cssOf(PAL.setRGB(b.dataset.v, S.setHex, p));
    });
    // 6.4 Bunte Menge: Modus Inseln/Ringe
    $('seg-inmode').hidden = $('in-hint').hidden = S.setCol !== 'bunt';
    document.querySelectorAll('#seg-inmode button').forEach(b => b.classList.toggle('on', +b.dataset.v === (S.inMode === 2 ? 2 : 1)));
    $('set-color-custom').hidden = S.setCol !== 'custom';
    $('set-color-custom').value = S.setHex;
    $('t-alpine').checked = S.alpine;
    $('seg-valley').hidden = !S.alpine;
    document.querySelectorAll('#seg-valley button').forEach(b => b.classList.toggle('on', b.dataset.v === S.valley));
}
document.querySelectorAll('#seg-setcol button').forEach(b => b.addEventListener('click', () => {
    if (S.setCol !== b.dataset.v) crossfade(420);
    S.setCol = b.dataset.v; A.saveSettings(); A.invalidate(); syncSet();
}));
document.querySelectorAll('#seg-inmode button').forEach(b => b.addEventListener('click', () => {
    if (S.inMode !== +b.dataset.v) crossfade(420);
    S.inMode = +b.dataset.v; A.saveSettings(); A.RC.dirty = true; syncSet();    // nur Darstellung, keine Neuberechnung
}));
$('set-color-custom').addEventListener('input', (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { S.setHex = e.target.value.toLowerCase(); S.setCol = 'custom'; A.invalidate(); syncSet(); } });
$('set-color-custom').addEventListener('change', () => A.saveSettings());
$('t-alpine').addEventListener('change', (e) => {
    crossfade(500);
    S.alpine = e.target.checked;
    if (S.alpine) { S.setCol = 'white'; S.palette = PAL.indexOf('alpine'); buildPalettes(); }   // Voreinstellung: Gletscher + Alpin-Palette (2D)
    A.saveSettings(); A.invalidate(); syncSet();
});
document.querySelectorAll('#seg-valley button').forEach(b => b.addEventListener('click', () => { if (S.valley !== b.dataset.v) crossfade(420); S.valley = b.dataset.v; A.saveSettings(); A.invalidate(); syncSet(); }));
function bindRange(id, out, get, set, fmt) {
    const r = $(id);
    const upd = () => { $(out).textContent = fmt(get()); };
    r.addEventListener('input', () => { set(parseFloat(r.value)); upd(); A.invalidate(); });
    r.addEventListener('change', () => A.saveSettings());
    return () => { r.value = get.raw ? get.raw() : get(); upd(); };
}
const densGet = () => S.density; densGet.raw = () => Math.log2(S.density);
const syncDensity = bindRange('s-density', 'o-density', densGet, (v) => { S.density = Math.pow(2, v); }, (v) => v.toFixed(2) + '×');
const syncSpeed = bindRange('s-speed', 'o-speed', () => S.speed, (v) => { S.speed = v; }, (v) => v.toFixed(2));
const syncRelief = bindRange('s-relief', 'o-relief', () => S.reliefStrength, (v) => { S.reliefStrength = v; }, (v) => v.toFixed(2));
function bindToggle(id, get, set) {
    const c = $(id);
    c.addEventListener('change', () => { set(c.checked); A.saveSettings(); A.invalidate(); syncControls(); });
    return () => { c.checked = get(); };
}
const toggles = [
    bindToggle('t-anim', () => S.anim, (v) => { S.anim = v; }),
    bindToggle('t-relief', () => S.relief, (v) => { S.relief = v; }),
    bindToggle('t-smooth', () => !S.banded, (v) => { S.banded = !v; }),
    bindToggle('t-particles', () => S.particles, (v) => { S.particles = v; }),
    bindToggle('t-minimap', () => S.minimap, (v) => { S.minimap = v; }),
    bindToggle('t-rect', () => S.rectMode, (v) => { S.rectMode = v; }),
    bindToggle('t-precise', () => S.precise, (v) => { S.precise = v; }),
    bindToggle('t-governor', () => S.governor, (v) => { S.governor = v; }),
    bindToggle('t-deon', () => S.deOn, (v) => { S.deOn = v; }),
    bindToggle('t-aa', () => S.aa, (v) => { S.aa = v; }),
    bindToggle('t-hudfs', () => S.hudFs, (v) => { S.hudFs = v; hudApply(); }),
];
function bindSeg(id, get, set) {
    const g = $(id);
    g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); A.saveSettings(); syncControls(); }));
    return () => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === get()));
}
const segs = [
    bindSeg('seg-quality', () => S.quality, (v) => { S.quality = v; A.resize(); }),
    bindSeg('seg-renderer', () => S.renderer, (v) => { S.renderer = v; A.invalidate(); }),
];
function syncControls() {
    syncDensity(); syncSpeed(); syncRelief(); syncSet();
    toggles.forEach(f => f()); segs.forEach(f => f());
    $('s-speed').closest('label').classList.toggle('dim', !S.anim);
    $('s-relief').closest('label').classList.toggle('dim', !S.relief);
    hudUpdate(true);
}

// Sprache
(function langSelect() {
    const s = $('sel-lang');
    for (const k of Object.keys(TRANSLATIONS)) { const o = el('option'); o.value = k; o.textContent = TRANSLATIONS[k].lang_name || k; s.appendChild(o); }
    s.value = S.lang;
    s.addEventListener('change', () => { S.lang = s.value; A.saveSettings(); applyI18n(); });
})();

// ------------------------------------------------------------------ Orte
function placeCard(p, opts) {
    const c = el('div', 'place');
    const name = opts.name || t(p.key);
    const thumb = opts.thumb ? `url('${opts.thumb}')` : 'none';
    c.innerHTML = `<button class="place-main"><span class="thumb" style="background-image:${thumb}"></span>
        <span class="meta"><span class="name"></span><span class="zoom mono">${A.fmtZoom(+p.zoom, 'sci')}</span></span></button>
        <div class="place-actions"><button class="chip tour">▶ ${t('tour')}</button>${A.canFly(p.formula || 0) ? `<button class="chip fly">✈ ${t('fly_place')}</button>` : ''}${opts.onDelete ? `<button class="chip del" aria-label="${t('delete')}">✕</button>` : ''}</div>`;
    c.querySelector('.name').textContent = name;
    c.querySelector('.place-main').addEventListener('click', () => { A.goTo(p); if (innerWidth < 700) closeSheet(); });
    c.querySelector('.tour').addEventListener('click', () => { A.startTour(p); closeSheet(); });
    const fb = c.querySelector('.fly');
    if (fb) fb.addEventListener('click', () => { A.startFly(p); closeSheet(); });     // 6.6: im aktuellen Modus (2D oder 3D)
    if (opts.onDelete) c.querySelector('.del').addEventListener('click', opts.onDelete);
    return c;
}
function loadPlaces() { try { return JSON.parse(localStorage.getItem('fraktal_v5_places') || '[]'); } catch (e) { return []; } }
function savePlaces(a) { try { localStorage.setItem('fraktal_v5_places', JSON.stringify(a)); } catch (e) { toast('Speicher voll'); } }
function buildUserPlaces() {
    const box = $('user-places');
    box.innerHTML = '';
    const list = loadPlaces();
    if (!list.length) { box.appendChild(el('p', 'hint', t('places_empty'))); return; }
    box.appendChild(el('h3', '', t('my_places')));
    list.forEach((p, i) => box.appendChild(placeCard(p, { name: p.name, thumb: p.thumb, onDelete: () => { const a = loadPlaces(); a.splice(i, 1); savePlaces(a); buildUserPlaces(); } })));
}
$('btn-save-place').addEventListener('click', () => {
    const v = A.viewState();
    A.snapshot();      // P3-8: frisch zeichnen – in 3D das 3D-Bild (presentNow zeichnete das 2D-Bild darüber)
    const c = document.createElement('canvas');
    c.width = 176; c.height = 110;
    const src = A.R.canvas;
    const sw = src.width, sh = src.height, a = c.width / c.height;
    let w = sw, h = sw / a; if (h > sh) { h = sh; w = sh * a; }
    c.getContext('2d').drawImage(src, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, c.width, c.height);
    const list = loadPlaces();
    list.unshift(Object.assign(v, { id: 'u' + Date.now(), name: `${cap(MODE_NAMES()[S.formula])} · ${A.fmtZoom(S.cam.zoom, 'sci')}`, thumb: c.toDataURL('image/jpeg', 0.8) }));
    savePlaces(list.slice(0, 40));
    buildUserPlaces();
    flash();
    if (A.DEKO) { const f = document.querySelector('#user-places .place'); if (f) f.classList.add('fresh'); }
    toast(t('saved'));
});

// ------------------------------------------------------------------ Teilen
$('btn-share').addEventListener('click', () => { const p = $('share-pop'); p.hidden = !p.hidden; if (!p.hidden) closeSheet(); });
$('share-image').addEventListener('click', async () => {
    $('share-pop').hidden = true;
    const blob = await A.captureBlob();
    if (!blob) { toast(t('share_failed')); return; }
    const file = new File([blob], A.fileName(), { type: 'image/png' });
    try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Fraktal-Explorer', text: A.stateURL() });
            return;
        }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(t('image_saved'));
});
async function shareLink() {
    $('share-pop').hidden = true;
    const url = A.stateURL();
    try { if (navigator.share) { await navigator.share({ title: 'Fraktal-Explorer', url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast(t('link_copied')); } catch (e) { prompt('Link', url); }
}
$('share-link').addEventListener('click', shareLink);
$('btn-link').addEventListener('click', shareLink);

// ------------------------------------------------------------------ Mehr
// 6.8: ohne Vollbild-Schnittstelle (iPhone, auch als installierte App) ist derselbe Knopf der Kino-Modus: HUD aus wie im
// Vollbild, nur ohne echtes Vollbild (bis 6.7 war der Knopf dort ausgeblendet, P3-7)
const FS_API = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
function toggleFullscreen() {
    const d = document;
    if (!FS_API) { setCinema(!HUD.cine); return; }
    if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
    else d.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
$('btn-fullscreen2').addEventListener('click', () => { closeSheet(); toggleFullscreen(); });
if (!FS_API) {
    $('btn-fullscreen').dataset.i18nTitle = 'cinema';
    $('btn-fullscreen2').querySelector('[data-i18n]').dataset.i18n = 'cinema';
}

// ------------------------------------------------------------------ 6.8 HUD im Vollbild / Kino-Modus
// Im Vollbild (Einstellung „HUD im Vollbild ausblenden“, Standard an) und im Kino-Modus verschwinden alle Bedienelemente
// weich (0,3 s, CSS body.hudless: alles außer dem Bild) – Leisten, Dock, Knöpfe, Flug-Leiste, Zoom-Anzeige, Hinweise, Toasts.
// Ein kurzer Tipp (ohne Wischen; app.js fragt A.tapHook) bzw. eine Mausbewegung zeigt sie für 3 s (body.hud-peek). Gesten
// (Zoomen, Schieben, Flug-Lenkung) holen sie nicht zurück, ein laufender Flug läuft weiter (der Tipp pausiert ihn dann nicht).
// Solange ein Menü offen ist oder die Maus über der Bedienung steht, bleibt sie sichtbar. Esc/F verlassen Vollbild bzw. Kino.
const HUD = { fs: false, cine: false, peekT: 0, mx: -1, my: -1, over: false, overT: 0, hinted: false };
const hudless = () => (HUD.fs && S.hudFs) || HUD.cine;
const peeking = () => document.body.classList.contains('hud-peek');
function hudApply() {
    const on = hudless(), b = document.body, was = b.classList.contains('hudless');
    if (on && !was) {
        closeSheet(); closeModal(); $('share-pop').hidden = true;
        $('hud-details').hidden = true; $('hud-pill').setAttribute('aria-expanded', 'false');
        if (!S.chrome) setChrome(true);
    }
    b.classList.toggle('hudless', on);
    if (!on) { b.classList.remove('hud-peek'); clearTimeout(HUD.peekT); }
    else if (!was && !HUD.hinted) { HUD.hinted = true; hudPeek(2200); toast(t('hud_hint'), 2200); }     // einmal pro Sitzung: kurz zeigen, wie es zurückkommt
    const fb = $('btn-fullscreen'), act = HUD.fs || HUD.cine;
    fb.classList.toggle('on', act); fb.setAttribute('aria-pressed', String(act));
}
function hudPeek(ms) {
    if (!hudless()) return;
    document.body.classList.add('hud-peek');
    clearTimeout(HUD.peekT);
    HUD.peekT = setTimeout(hudHide, ms || 3000);
}
function hudHide(force) {
    clearTimeout(HUD.peekT);
    // (Maus über der Bedienung zählt nur, solange sie sich bewegt – eine ruhende Maus auf dem Vollbild-Knopf hielte sonst alles fest)
    const busy = !sheet.hidden || !$('share-pop').hidden || !$('modal').hidden || !$('hud-details').hidden || (HUD.over && performance.now() - HUD.overT < 3000);
    if (!force && busy) { HUD.peekT = setTimeout(hudHide, 1000); return; }
    document.body.classList.remove('hud-peek');
}
function setCinema(on) { HUD.cine = !!on; hudApply(); }
// Tipp auf das Bild: ausgeblendet -> nur zeigen (true = erledigt); sichtbar im Flug -> pausieren wie immer, Zeit neu
A.tapHook = () => {
    if (!hudless()) return false;
    if (!peeking()) { hudPeek(); return true; }
    if (A.FLY.on) hudPeek();
    return false;
};
const onFsChange = () => { HUD.fs = !!(document.fullscreenElement || document.webkitFullscreenElement); hudApply(); };
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    HUD.over = e.target !== A.R.canvas && !!(e.target.closest && e.target.closest('body > :not(#gl):not(#xfade)'));
    if (HUD.over) HUD.overT = performance.now();
    if (e.buttons || !hudless()) { HUD.mx = e.clientX; HUD.my = e.clientY; return; }    // Ziehen mit der Maus ist eine Geste
    if (HUD.mx >= 0 && Math.hypot(e.clientX - HUD.mx, e.clientY - HUD.my) > 4) hudPeek();
    HUD.mx = e.clientX; HUD.my = e.clientY;
}, { passive: true });
// Bedienung angefasst (Knopf, Regler, Menü): sichtbar lassen, Zeit neu
addEventListener('pointerdown', (e) => { if (hudless() && peeking() && e.target !== A.R.canvas) hudPeek(); }, { passive: true, capture: true });
$('btn-reset').addEventListener('click', () => { A.goHome(); });
$('btn-help').addEventListener('click', () => openModal('help'));
$('btn-gestures').addEventListener('click', () => openModal('gestures'));
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btn-install').hidden = false; });
$('btn-install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; $('btn-install').hidden = true; });

// ------------------------------------------------------------------ Hilfe-Modal
function openModal(kind) {
    const b = $('modal-body');
    const g = `<div class="info-section"><h3>${t('gestures_title')}</h3><ul class="gest">
        <li>${t('g_pan')}</li><li>${t('g_pinch')}</li><li>${t('g_dtap')}</li><li>${t('g_2tap')}</li><li>${t('g_long')}</li><li>${t('g_tap')}</li><li>${t('g_3d')}</li><li>${t('g_fly2d')}</li><li>${t('g_rev')}</li><li>${t('g_desk')}</li></ul>
        <p class="hint">${t('deep_note')}</p></div>`;
    if (kind === 'gestures') b.innerHTML = g;
    else {
        const cards = A.MODE_KEYS.map(k => `<div class="fractal-card"><div class="fractal-card-header">${t(k)}</div><p>${t('help_' + k)}</p></div>`).join('');
        b.innerHTML = `<h2>${t('what_is_fractal')}</h2><p>${t('fractal_desc')}</p>
            <div class="info-section"><h3>${t('magic_formula')}</h3><p>${t('magic_desc')}</p></div>
            <div class="info-section"><h3>${t('why_black')}</h3><p>${t('black_desc')}</p>
              <ul><li><strong>${t('trapped')}:</strong> ${t('trapped_desc')}</li><li><strong>${t('escape')}:</strong> ${t('escape_desc')}</li></ul></div>
            <div class="info-section"><h3>${t('color_origin')}</h3><p>${t('color_desc')}</p></div>
            ${g}
            <div class="info-section"><h3>${t('help_fractals_title')}</h3>${cards}</div>`;
    }
    $('modal').hidden = false;
    requestAnimationFrame(() => $('modal').classList.add('open'));
}
function closeModal() { $('modal').classList.remove('open'); setTimeout(() => { $('modal').hidden = true; }, 250); }
$('modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

// ------------------------------------------------------------------ Tastatur (Desktop)
window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (A.V3.on && e.shiftKey && k.startsWith('Arrow')) {      // 3D: Shift+Pfeile drehen/neigen
        if (k === 'ArrowLeft' || k === 'ArrowRight') A.V3.heading += (k === 'ArrowLeft' ? 1 : -1) * 0.12;
        else A.V3.tilt = Math.max(0, Math.min(A.MAX_TILT, A.V3.tilt + (k === 'ArrowUp' ? 0.07 : -0.07)));
        A.RC.dirty = true; return;
    }
    // 6.8 im Flug: R = Richtung wechseln, Pfeil ↑/↓ = Tempo, U = Umdrehen (3D); sonst wie bisher (R = Zurücksetzen, Pfeile schieben)
    if (A.FLY.on && A.RUECK) {
        const kl = k.toLowerCase();
        if (kl === 'r') { A.reverseFly(); A.saveSettings(); return; }
        if (kl === 'u') { A.turnFly(); return; }
        if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); A.setFlySpeed(S.flySpeed + (k === 'ArrowUp' ? 0.1 : -0.1)); A.saveSettings(); return; }
    }
    const pan = (dx, dy) => { A.stopFly(); const s = 3 / (S.cam.zoom * innerHeight) * innerHeight * 0.15; A.flyTo(S.cam.cx + HP.fromNumber(dx * s), S.cam.cy + HP.fromNumber(dy * s), S.cam.zoom, { duration: 0.25 }); };
    switch (k) {
        case 'ArrowLeft': pan(-1, 0); break; case 'ArrowRight': pan(1, 0); break;
        case 'ArrowUp': pan(0, 1); break; case 'ArrowDown': pan(0, -1); break;
        case 'PageUp': A.stopFly(); A.zoomAt(innerWidth / 2, innerHeight / 2, 2); break;
        case 'PageDown': A.stopFly(); A.zoomAt(innerWidth / 2, innerHeight / 2, 0.5); break;
        case '+': case '=': A.changeIter(1.25); break;
        case '-': case '_': A.changeIter(0.8); break;
        default:
            switch (k.toLowerCase()) {
                case 'm': case 'j': case 'b': case 't': case '3': case 'n': {
                    const m = 'mjbt3n'.indexOf(k.toLowerCase()); if (m !== S.formula) crossfade(650); A.setMode(m); break; }
                case 'p': crossfade(420); S.palette = (S.palette + 1) % PAL.list.length; A.saveSettings(); A.invalidate(); buildPalettes(); break;
                case 'r': A.goHome(); break;
                case 's': $('share-image').click(); break;
                case 'z': S.rectMode = !S.rectMode; syncControls(); break;
                case 'f': if (HUD.cine) setCinema(false); else toggleFullscreen(); break;
                case 'i': setChrome(!S.chrome); break;
                case 'h': case '?': openModal('help'); break;
                case 'l': { const ks = Object.keys(TRANSLATIONS); S.lang = ks[(ks.indexOf(S.lang) + 1) % ks.length]; $('sel-lang').value = S.lang; A.saveSettings(); applyI18n(); break; }
                case 'escape': closeSheet(); closeModal(); if (HUD.cine) setCinema(false); break;
                case 'd': toggle3d(); break;
                case 'v': if (A.FLY.on) A.stopFly(); else A.startFly(); break;      // 6.6: fliegt im aktuellen Modus
            }
    }
});

// ------------------------------------------------------------------ Service Worker (PWA)
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
            reg.addEventListener('updatefound', () => {
                const nw = reg.installing;
                if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast(t('update_ready'), 4000); });
            });
        }).catch(() => {});
    });
}

// ------------------------------------------------------------------ 3D-Landschaft + Flug
let hint3d = false, want3dHint = false, prepToastT = 0;
function toggle3d() {
    if (!A.can3d()) { toast(t('d3_na')); return; }
    // 6.3: Antippen während der Vorbereitung bricht sie ab
    const on = !(A.V3.on && A.V3.dir >= 0) && !A.V3.prep;
    if (on && !hint3d) want3dHint = true;
    A.set3d(on);
}
function prep3dProgress() {
    const pi = A.view3dInfo().prepInfo;
    // Fortschritt: fertige Programme (das große Gelände-Programm zählt halb – es kommt meist zuletzt)
    if (pi && pi.total) $('btn-3d').style.setProperty('--p', String(Math.max(0.08, Math.min(0.92, pi.done / (pi.total + 1)))));
}
$('btn-3d').addEventListener('click', toggle3d);
$('btn-3d').addEventListener('pointerdown', () => A.prewarm3d());
$('btn-fly').addEventListener('click', () => { if (A.FLY.on) A.stopFly(); else A.startFly(); });
$('btn-fly2d').addEventListener('click', () => A.startFly(undefined, { d3: false }));
$('btn-north').addEventListener('click', () => A.north3d());
$('r-height').addEventListener('input', (e) => { S.h3d = +e.target.value; A.RC.dirty = true; });
$('r-height').addEventListener('change', () => A.saveSettings());
// 6.8: Tempo −1,5 … +1,5 mit Einrasten bei 0 (A.setFlySpeed), ⇄ = Richtung wechseln (weich), ↶ = Umdrehen (3D)
$('r-speed').addEventListener('input', (e) => { const v = A.setFlySpeed(+e.target.value); if (+e.target.value !== v) e.target.value = v; });
$('r-speed').addEventListener('change', () => A.saveSettings());
if (!A.RUECK) $('r-speed').min = '0.1';
$('btn-rev').addEventListener('click', () => { A.reverseFly(); A.saveSettings(); });
$('btn-turn').addEventListener('click', () => A.turnFly());
let hintFly2d = false;
function sync3d() {
    const can = A.can3d(), on = A.V3.on && A.V3.dir >= 0, fly = A.FLY.on, prep = !!A.V3.prep && !A.V3.on;
    // 6.6: ✈ auch in 2D (eigener Knopf); während eines 2D-Flugs zeigt die Flug-Leiste Stopp und Tempo
    const fly2d = fly && !A.V3.on;
    $('btn-fly2d').hidden = !A.canFly2d() || A.V3.on || fly;
    if (fly2d && !hintFly2d) { hintFly2d = true; toast(t('fly2d_hint'), 3800); }
    $('btn-3d').hidden = !can;
    // 6.3: „3D wird vorbereitet …“ (Shader werden übersetzt, 2D bleibt bedienbar)
    const b3 = $('btn-3d');
    b3.classList.toggle('prep', prep);
    b3.title = t(prep ? 'd3_prep' : 'd3_title');
    b3.setAttribute('aria-label', b3.title);
    b3.setAttribute('aria-busy', String(prep));
    if (prep) { prep3dProgress(); if (!prepToastT) prepToastT = setTimeout(() => { if (A.V3.prep && !A.V3.on) toast(t('d3_prep'), 2600); }, 400); }
    else if (prepToastT) { clearTimeout(prepToastT); prepToastT = 0; }
    if (on && want3dHint) { want3dHint = false; hint3d = true; toast(t('d3_hint'), 3800); }
    $('btn-3d').classList.toggle('on', on);
    $('btn-3d').setAttribute('aria-pressed', String(on));
    $('bar3d').hidden = !on && !fly;
    $('btn-north').hidden = !on;
    $('btn-fly').classList.toggle('on', fly);
    $('fly-icon').textContent = fly ? '■' : '✈';
    $('fly-label').textContent = t(fly ? 'fly_stop' : 'fly');
    $('lbl-height').hidden = fly;
    $('lbl-speed').hidden = !fly;
    $('r-height').value = S.h3d;
    $('r-speed').value = S.flySpeed;
    // 6.8: ⏪ rückwärts, ⏩ vorwärts, ⏸ Schweben; ⇄ im Flug, ↶ im 3D-Flug
    $('speed-icon').textContent = S.flySpeed > 0 ? '⏩' : S.flySpeed < 0 ? '⏪' : '⏸';
    $('btn-rev').hidden = !fly || !A.RUECK;
    $('btn-turn').hidden = !fly || !on || !A.RUECK;
    $('btn-turn').classList.toggle('on', !!A.V3.turnT);
    $('bar3d').classList.toggle('full', fly && on && A.RUECK);      // 3D-Flug: fünf Elemente – Stopp nur als Symbol (CSS)
    $('btn-fly').title = t(fly ? 'fly_stop' : 'fly');
    $('btn-turn').setAttribute('aria-pressed', String(!!A.V3.turnT));
}

// ------------------------------------------------------------------ Start
buildPalettes();
syncControls();
applyI18n();
updateJuliaPanel();
sync3d();
$('info-version').textContent = A.APP_VERSION;
$('version-line').textContent = A.APP_VERSION;
document.body.classList.add('ready');
})();
