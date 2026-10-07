// 6.7: nachgebildeter WebGL2-Kontext + Renderer-Hülle für Node-Tests von js/three.js (tests/unit/three-mock.test.js).
// Merkt sich Ziel, Textur-Einheiten und Sampler-Werte je Programm und meldet beim Zeichnen Rückkopplungen (Ziel-Textur auf
// einer Sampler-Einheit), gelöschte Texturen/Ziele. Shader werden NICHT übersetzt.
'use strict';
function fakeGL() {
    let id = 1;
    const st = { fb: null, unit: 0, units: {}, prog: null, attach: new Map(), problems: [], draws: [], queries: 0 };
    const C = { TEXTURE0: 33984, TEXTURE_2D: 3553, FRAMEBUFFER: 36160, RENDERER: 7937, QUERY_RESULT_AVAILABLE: 34919, QUERY_RESULT: 34918 };
    const ext = { TIME_ELAPSED_EXT: 35007, GPU_DISJOINT_EXT: 36795 };
    for (let i = 1; i < 32; i++) C['TEXTURE' + i] = C.TEXTURE0 + i;      // gl.TEXTURE1 … wie im echten Kontext
    const impl = {
        createTexture: () => ({ t: 'tex', id: id++ }), createFramebuffer: () => ({ t: 'fb', id: id++ }), createRenderbuffer: () => ({ t: 'rb', id: id++ }),
        createBuffer: () => ({ t: 'buf', id: id++ }), createVertexArray: () => ({ t: 'vao', id: id++ }), createQuery: () => ({ t: 'q', id: id++ }),
        bindFramebuffer: (t, fb) => { st.fb = fb; },
        framebufferTexture2D: (t, att, tt, tex) => { if (!st.attach.has(st.fb)) st.attach.set(st.fb, new Set()); st.attach.get(st.fb).add(tex); },
        activeTexture: (u) => { st.unit = u - C.TEXTURE0; },
        bindTexture: (t, tex) => { st.units[st.unit] = tex; },
        deleteTexture: (tex) => { if (tex) tex.deleted = true; }, deleteFramebuffer: (fb) => { if (fb) fb.deleted = true; },
        useProgram: (p) => { st.prog = p; },
        uniform1i: (loc, v) => { if (loc) loc.prog.vals[loc.name] = v; },
        getExtension: (n) => (n === 'EXT_disjoint_timer_query_webgl2' ? ext : {}),
        getParameter: (p) => (p === C.RENDERER ? 'FakeGPU 1' : (p === ext.GPU_DISJOINT_EXT ? false : 0)),
        getQueryParameter: (q, p) => (p === C.QUERY_RESULT_AVAILABLE ? true : 4.2e6),
        beginQuery: () => { st.queries++; },
        isContextLost: () => false,
        drawArrays: () => check('drawArrays'), drawElements: () => check('drawElements'),
    };
    function check(kind) {
        const p = st.prog;
        if (!p) { st.problems.push(kind + ' ohne Programm'); return; }
        const att = st.attach.get(st.fb) || new Set();
        for (const s of p.samplers) {
            const tex = st.units[p.vals[s] || 0];
            if (tex && tex.deleted) st.problems.push(`${p.key}: ${s} liest gelöschte Textur`);
            if (tex && att.has(tex)) st.problems.push(`${p.key}: Rückkopplung über ${s} (Einheit ${p.vals[s] || 0})`);
        }
        if (st.fb && st.fb.deleted) st.problems.push(`${p.key}: zeichnet in gelöschtes Ziel`);
        st.draws.push(p.key);
    }
    let n = 40000;
    const gl = new Proxy(impl, {
        get(t, k) {
            if (k in t) return t[k];
            if (k in C) return C[k];
            if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return (t[k] = n++);
            return () => undefined;
        },
    });
    return { gl, st };
}

function fakeR(gl, opts = {}) {
    const progs = {};
    const samplersOf = (src) => {
        const s = [], re = /uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?u?sampler2D\s+([^;]+);/g;
        let m;
        while ((m = re.exec(src))) for (const x of m[1].split(',')) s.push(x.trim().replace(/\[.*\]$/, ''));
        return s;
    };
    const fail = (k) => { const e = new Error('Shader defekt: ' + k); e.shaderKey = k; return e; };
    const R = {
        gl, canvas: { width: 1080, height: 2340 }, parallelCompile: true, broken: {}, noWarm: false, vao: gl.createVertexArray(),
        program(key, fs, vs) {
            if (opts.fail && opts.fail.includes(key)) throw fail(key);
            if (!progs[key]) {
                const p = { key, vals: {}, samplers: samplersOf(fs + (vs || '')) };
                const loc = new Proxy({}, { get: (t, name) => (typeof name === 'string' ? (t[name] || (t[name] = { prog: p, name })) : undefined) });
                progs[key] = { p, loc };
            }
            return progs[key];
        },
        programReady(key) { if (opts.fail && opts.fail.includes(key)) throw fail(key); return true; },
        hasProgram: () => true, prewarm() {}, dummyU: () => R._du || (R._du = gl.createTexture()), dummyD: () => R._dd || (R._dd = gl.createTexture()),
        acquireBuffer: () => ({ fbo: gl.createFramebuffer(), tex: gl.createTexture() }), readIterAsync: () => Promise.resolve(null), setPalette() {},
        progs,
    };
    return R;
}

module.exports = { fakeGL, fakeR };
