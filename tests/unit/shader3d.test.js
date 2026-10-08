// 6.7: 3D-Shader (js/three.js) für alle Gelände-Varianten und Regler-Kombinationen durch den kleinen GLSL-Prüfer
// (tests/unit/glsl-lint.js) – Präprozessor, Klammern, Uniforms, Varyings, unbekannte Funktionen, int-Literale.
// Ersetzt keinen echten Compiler (die Abnahme im Browser bleibt Pflicht), fängt aber Tippfehler ohne Browser.
'use strict';
require('../../js/hp.js');
require('../../js/shaders.js');
require('../../js/three-tech.js');
require('../../js/three.js');
const L = require('./glsl-lint.js');
const SH = self.FKShaders;

const COMBOS = [
    { name: 'Standard', f: {} },
    { name: 'alles aus', f: { hao: false, detail: false, tone: 0, bloom: false } },
    { name: 'nur AO', f: { hao: true, detail: false } },
    { name: 'nur Detail', f: { hao: false, detail: true } },
    { name: 'TAA + AgX', f: { taa: true, tone: 2 } },
];

test('Prüfer selbst: findet typische Fehler', () => {
    const vs = '#version 300 es\nprecision highp float;\nout float v_a;\nvoid main() { v_a = 1.0; gl_Position = vec4(0.0); }';
    const fsOk = '#version 300 es\nprecision highp float;\nin float v_a;\nuniform float u_x;\nout vec4 o;\nvoid main() { o = vec4(pow(v_a, 2.0) * u_x); }';
    assert.deepEqual(L.lintProgram(vs, fsOk, 't'), []);
    const bad = fsOk.replace('pow(v_a, 2.0)', 'pow(v_a, 2)');
    assert.ok(L.lintProgram(vs, bad, 't').some(e => /Ganzzahl-Literal/.test(e)));
    assert.ok(L.lintShader(fsOk.replace('u_x)', 'u_y)'), 't').some(e => /nicht deklariert: u_y/.test(e)));
    assert.ok(L.lintShader(fsOk.replace('pow(', 'poww('), 't').some(e => /unbekannte Funktion: poww/.test(e)));
    assert.ok(L.lintProgram(vs, fsOk.replace('in float v_a', 'in vec2 v_a'), 't').some(e => /Varying v_a/.test(e)));
    assert.ok(L.lintShader(fsOk.replace('void main() {', 'void main() {{'), 't').some(e => /Klammern/.test(e)));
    assert.equal(L.preprocess('#define A 2\n#if A >= 2\nx\n#else\ny\n#endif').trim(), 'x');
});

for (const c of COMBOS) test(`Shader fehlerfrei (Prüfer): ${c.name}`, () => {
    const S = FK3D.sources(c.f);
    const errs = [];
    for (const k of Object.keys(S.TERR)) errs.push(...L.lintProgram(S.TERRAIN_VS, S.TERR[k], k));
    for (const k of ['SKY_FS', 'BLIT_FS', 'BLOOM_FS', 'TAA_FS', 'HBUILD_FS', 'PROBE_FS', 'NOISE_FS']) errs.push(...L.lintProgram(SH.VS, S[k], k));
    assert.deepEqual(errs, []);
});

test('Regler übersetzen nur, was gebraucht wird (#if HAO / DET)', () => {
    const on = FK3D.sources({}), off = FK3D.sources({ hao: false, detail: false });
    const pv = (s) => L.stripComments(L.preprocess(L.stripComments(s)));
    assert.match(pv(on.TERRAIN_VS), /v_ao = ao/);
    assert.match(pv(on.TERR.t3terr), /detailGrad\(v_P, foot\)/);
    assert.doesNotMatch(pv(off.TERRAIN_VS), /v_ao|u_aoN/);
    assert.doesNotMatch(pv(off.TERR.t3terr), /detailGrad|v_ao|u_doff/);
    // ohne AO bleibt ao = 1.0 im Fragment-Shader (Beleuchtung rechnerisch wie 6.6)
    assert.match(pv(off.TERR.t3terrX), /float ao = 1\.0;/);
});

test('Schatten: Ausgewogen ist bit-gleich zu 6.6 (Schrittweite 0,024·1,95^i, Härte 5)', () => {
    const vs = FK3D.sources({}).TERRAIN_VS;
    assert.match(vs, /float ts = 0\.024 \* pow\(1\.95, float\(i\) \* u_shR\);/);
    assert.match(vs, /sh = min\(sh, u_shK \* \(hz\.x \+ u_sun\.z \* ts - hq\) \/ ts\);/);
    const st = FK3DTech.stage('balanced', FK3DTech.flags(new URLSearchParams('')));
    assert.equal(st.shN, 6); assert.equal(st.shR, 1); assert.equal(st.shK, 5);
});

test('Endpass: post() mit u_tone = 0 rechnet exakt wie 6.6 (Gamma 0,92 vor dem Tonemapping)', () => {
    const fs = FK3D.sources({}).SKY_FS;
    const body = fs.slice(fs.indexOf('vec3 post(vec3 col)'));
    assert.match(body, /col = pow\(max\(col, vec3\(0\.0\)\), vec3\(0\.92\)\);\n\s*if \(u_tone == 0\) return col;/);
});
