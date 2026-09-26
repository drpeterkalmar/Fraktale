// ui.js — Oberfläche: HUD, Dock, Bottom-Sheet, Karten, Paletten, c-Pad, Minimap, Teilen, Tastatur.
// Liest/schreibt nur über window.__fraktal (app.js). Alle Texte via translations.js (t()).
(function () {
'use strict';
const A = self.__fraktal;
if (!A) return;
const { S, HP, PAL, t } = A;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const PRESETS = [
    { id: 'full', key: 'p_full', cx: '-0.5', cy: '0', zoom: 1 },
    { id: 'seahorse', key: 'p_seahorse', cx: '-0.7463', cy: '0.1102', zoom: 200 },
    { id: 'elephant', key: 'p_elephant', cx: '0.2819', cy: '0.0100', zoom: 50 },
    { id: 'spiral', key: 'p_spiral', cx: '-0.74529', cy: '0.11307', zoom: 20000 },
    { id: 'star', key: 'p_star', cx: '-1.25066', cy: '0.02012', zoom: 1000 },
    { id: 'antenna', key: 'p_antenna', cx: '-1.401155', cy: '0', zoom: 500 },
    { id: 'lightning', key: 'p_lightning', cx: '-0.16', cy: '1.0405', zoom: 200 },
    { id: 'peter', key: 'p_peter', cx: '-0.8625944137', cy: '0.2495680306', zoom: 17050000 },
    { id: 'deep9', key: 'p_deep9', cx: '-0.743637214380908705', cy: '0.131822306549061970', zoom: 1e9 },
    { id: 'deep15', key: 'p_deep15', cx: '-0.743637215354753236002154', cy: '0.131822307028445564243233', zoom: 1e15 },
    { id: 'deep29', key: 'p_deep29', cx: '-0.74363721535475353201560573970021652303', cy: '0.13182230702844485014116030906246974788', zoom: 1e29 },
    { id: 'deep41', key: 'p_deep41', cx: '-0.74363721535475353201560573969820799606042412635682', cy: '0.13182230702844485014116030906137622412768064249224', zoom: 1e41 },
];
const V = '?v=' + A.APP_VERSION;

// ------------------------------------------------------------------ i18n
function applyI18n() {
    document.documentElement.lang = S.lang;
    document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); n.setAttribute('aria-label', t(n.dataset.i18nTitle)); });
    $('sheet-close').setAttribute('aria-label', t('close') !== 'close' ? t('close') : '×');
    buildModes(); buildPresets(); buildUserPlaces();
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

// ------------------------------------------------------------------ HUD
let hudT = 0;
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
    prog.style.transform = p === null ? 'scaleX(0)' : `scaleX(${Math.max(0.04, p).toFixed(3)})`;
    prog.classList.toggle('on', p !== null);
    $('hud-pill').classList.toggle('busy', p !== null);
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
    $('share-pop').hidden = true;
    document.body.classList.add('sheet-open');
    if (tab === 'worlds') { buildModes(); drawCpad(); }
    if (tab === 'more') hudUpdate(true);
}
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
        else setChrome(!S.chrome);
    } else if (w === 'frame') hudUpdate(false);
    else if (w === 'mode') { buildModes(); updateJuliaPanel(); hudUpdate(true); minimapBase = null; }
    else if (w === 'julia') { updateJuliaPanel(); }
    else if (w === 'iter') hudUpdate(true);
    else if (w === 'settings') syncControls();
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
        b.addEventListener('click', () => { A.setMode(i); buildModes(); });
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
    if (!c.hidden) $('julia-chip-text').textContent = 'c = ' + A.fmtC(S.julia.x, S.julia.y);
}
$('julia-chip').addEventListener('click', () => openSheet('worlds'));
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
        b.addEventListener('click', () => { S.palette = i; A.saveSettings(); A.invalidate(); buildPalettes(); });
        g.appendChild(b);
    });
    $('custom-bar').style.background = PAL.gradientCSS(PAL.list[PAL.list.length - 1], 24);
}
for (let i = 0; i < 6; i++) {
    const inp = $('custom-color-' + i);
    inp.value = PAL.custom[i];
    const apply = () => { if (!/^#[0-9a-fA-F]{6}$/.test(inp.value)) return; PAL.setCustom(i, inp.value); S.palette = PAL.list.length - 1; A.invalidate(); buildPalettes(); };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', () => { apply(); PAL.saveCustom(); A.saveSettings(); });
}
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
    syncDensity(); syncSpeed(); syncRelief();
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
function presetCard(p, opts) {
    const c = el('div', 'place');
    const name = opts.name || t(p.key);
    const thumb = opts.thumb || `assets/thumbs/${p.id}.jpg${V}`;
    c.innerHTML = `<button class="place-main"><span class="thumb" style="background-image:url('${thumb}')"></span>
        <span class="meta"><span class="name"></span><span class="zoom mono">${A.fmtZoom(+p.zoom, 'sci')}</span></span></button>
        <div class="place-actions"><button class="chip tour">▶ ${t('tour')}</button>${opts.onDelete ? `<button class="chip del" aria-label="${t('delete')}">✕</button>` : ''}</div>`;
    c.querySelector('.name').textContent = name;
    c.querySelector('.place-main').addEventListener('click', () => { A.goTo(p); if (innerWidth < 700) closeSheet(); });
    c.querySelector('.tour').addEventListener('click', () => { A.startTour(p); closeSheet(); });
    if (opts.onDelete) c.querySelector('.del').addEventListener('click', opts.onDelete);
    return c;
}
function buildPresets() {
    const box = $('preset-places');
    box.innerHTML = '';
    PRESETS.forEach(p => box.appendChild(presetCard(p, {})));
}
function loadPlaces() { try { return JSON.parse(localStorage.getItem('fraktal_v5_places') || '[]'); } catch (e) { return []; } }
function savePlaces(a) { try { localStorage.setItem('fraktal_v5_places', JSON.stringify(a)); } catch (e) { toast('Speicher voll'); } }
function buildUserPlaces() {
    const box = $('user-places');
    box.innerHTML = '';
    const list = loadPlaces();
    if (list.length) box.appendChild(el('h3', '', t('my_places')));
    list.forEach((p, i) => box.appendChild(presetCard(p, { name: p.name, thumb: p.thumb, onDelete: () => { const a = loadPlaces(); a.splice(i, 1); savePlaces(a); buildUserPlaces(); } })));
}
$('btn-save-place').addEventListener('click', () => {
    const v = A.viewState();
    A.R.present(A.RC.prev, A.RC.front, 1, S.cam, lookNow());
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
    toast(t('saved'));
});
function lookNow() {
    const p = PAL.list[S.palette];
    return { formula: S.formula, maxIter: A.currentMaxIter(), pal: p, custom: PAL.customFlat(), cycle: S.cycle, density: S.density, time: S.time,
             relief: S.relief ? S.reliefStrength : 0, particles: S.particles && S.anim, banded: S.banded };
}

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
function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
$('btn-fullscreen2').addEventListener('click', toggleFullscreen);
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
        <li>${t('g_pan')}</li><li>${t('g_pinch')}</li><li>${t('g_dtap')}</li><li>${t('g_2tap')}</li><li>${t('g_long')}</li><li>${t('g_tap')}</li><li>${t('g_desk')}</li></ul>
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
    const pan = (dx, dy) => { const s = 3 / (S.cam.zoom * innerHeight) * innerHeight * 0.15; A.flyTo(S.cam.cx + HP.fromNumber(dx * s), S.cam.cy + HP.fromNumber(dy * s), S.cam.zoom, { duration: 0.25 }); };
    switch (k) {
        case 'ArrowLeft': pan(-1, 0); break; case 'ArrowRight': pan(1, 0); break;
        case 'ArrowUp': pan(0, 1); break; case 'ArrowDown': pan(0, -1); break;
        case 'PageUp': A.zoomAt(innerWidth / 2, innerHeight / 2, 2); break;
        case 'PageDown': A.zoomAt(innerWidth / 2, innerHeight / 2, 0.5); break;
        case '+': case '=': A.changeIter(1.25); break;
        case '-': case '_': A.changeIter(0.8); break;
        default:
            switch (k.toLowerCase()) {
                case 'm': A.setMode(0); break; case 'j': A.setMode(1); break; case 'b': A.setMode(2); break;
                case 't': A.setMode(3); break; case '3': A.setMode(4); break; case 'n': A.setMode(5); break;
                case 'p': S.palette = (S.palette + 1) % PAL.list.length; A.saveSettings(); A.invalidate(); buildPalettes(); break;
                case 'r': A.goHome(); break;
                case 's': $('share-image').click(); break;
                case 'z': S.rectMode = !S.rectMode; syncControls(); break;
                case 'f': toggleFullscreen(); break;
                case 'i': setChrome(!S.chrome); break;
                case 'h': case '?': openModal('help'); break;
                case 'l': { const ks = Object.keys(TRANSLATIONS); S.lang = ks[(ks.indexOf(S.lang) + 1) % ks.length]; $('sel-lang').value = S.lang; A.saveSettings(); applyI18n(); break; }
                case 'escape': closeSheet(); closeModal(); break;
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

// ------------------------------------------------------------------ Start
buildPalettes();
syncControls();
applyI18n();
updateJuliaPanel();
$('info-version').textContent = A.APP_VERSION;
$('version-line').textContent = A.APP_VERSION;
document.body.classList.add('ready');
})();
