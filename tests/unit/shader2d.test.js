// 7.1: alle 2D-Rechen-Shader (klassische Formeln, Burning-Ship-Familie, Exoten) und der Anzeige-Pass durch den kleinen
// GLSL-Prüfer (tests/unit/glsl-lint.js) – Varianten: direkt/Perturbation × Fehlerschätzung × Distanz × Bunt × Färbe-Stil.
// Ersetzt keinen echten Compiler (die Abnahme im Browser bleibt Pflicht), fängt aber Tippfehler ohne Browser.
'use strict';
require('../../js/shaders.js');
const L = require('./glsl-lint.js');
const SH = self.FKShaders;

test('Rechen-Shader klassisch + Burning-Ship-Familie: alle Varianten fehlerfrei', () => {
    const errs = [];
    for (const F of [0, 1, 2, 3, 4, 5, 20, 21, 22])
        for (const mode of ['direct', 'perturb'])
            for (const [err, de, inn] of [[false, false, false], [true, true, false], [false, true, true], [true, true, true]])
                for (const st of [0, 1, 2, 3, 6]) {
                    if (F === 5 && mode === 'perturb') continue;
                    errs.push(...L.lintProgram(SH.VS, SH.computeFS(F, mode, err, de, inn, st), `c${F}${mode}${err ? 'e' : ''}${de ? 'd' : ''}${inn ? 'i' : ''}s${st}`));
                }
    assert.deepEqual(errs, []);
});
test('Rechen-Shader Exoten (Multibrot, Phoenix, Nova, Magnet I/II, Lyapunov): fehlerfrei', () => {
    const errs = [];
    for (const F of [23, 24, 25, 26, 27, 28]) for (const de of [false, true]) for (const st of [0, 1, 2, 4, 6])
        errs.push(...L.lintProgram(SH.VS, SH.computeFS(F, 'direct', false, de, false, st), `x${F}${de ? 'd' : ''}s${st}`));
    assert.deepEqual(errs, []);
});
test('Anzeige-Pass fehlerfrei (ohne und mit Stil)', () => {
    assert.deepEqual(L.lintProgram(SH.VS, SH.DISPLAY_FS, 'display'), []);
    assert.deepEqual(L.lintProgram(SH.VS, SH.DISPLAY_FS_ST, 'displayS'), []);
    assert.deepEqual(L.lintProgram(SH.VS, SH.DISPLAY_FS_D, 'displayD'), []);
    assert.deepEqual(L.lintProgram(SH.VS, SH.DISPLAY_FS_STD, 'displaySD'), []);
    assert.ok(SH.DISPLAY_FS.includes('#define DUST 0') && SH.DISPLAY_FS_D.includes('#define DUST 1'), 'Standard-Anzeige ohne Staub-Korrektur');
});
test('7.1.11 Anzeige-Pass als Schleife (Direct3D): alle 4 Varianten fehlerfrei, Standard-Varianten unverändert', () => {
    for (const [sty, dust] of [[false, false], [true, false], [false, true], [true, true]]) {
        const src = SH.displayFS(sty, dust, true), key = `display${sty ? 'S' : ''}${dust ? 'D' : ''}L`;
        assert.deepEqual(L.lintProgram(SH.VS, src, key), []);
        assert.ok(src.includes('#define LOOP 1') && src.includes('for (int i = 0; i < u_n; i++)'), key + ': Ebenen-Schleife');
        assert.ok(!/sampleLayerN\(u_t\d/.test(src), key + ': keine eingesetzten Einzelaufrufe je Sampler');
        assert.equal(SH.displayFS(sty, dust), [SH.DISPLAY_FS, SH.DISPLAY_FS_ST, SH.DISPLAY_FS_D, SH.DISPLAY_FS_STD][(sty ? 1 : 0) + (dust ? 2 : 0)]);
    }
    assert.ok(!SH.DISPLAY_FS.includes('LOOP'), 'Standard-Anzeige ohne Schleifen-Schalter (bitgleich zu 7.1.10)');
});
test('7.1 Julia-Lupe-Shader fehlerfrei', () => {
    assert.deepEqual(L.lintProgram(SH.VS, SH.LUPE_FS, 'lupe'), []);
});
