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
});
