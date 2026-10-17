// 7.1.8: Shader der 3D-Welten (js/bulb.js) durch den kleinen GLSL-Prüfer – Marsch, POST, Schattier- und Auflöse-Pass
// des temporalen Hochrechnens. Ersetzt keinen Compiler (die Abnahme im Browser bleibt Pflicht).
'use strict';
require('../../js/hp.js');
require('../../js/shaders.js');
require('../../js/bulb.js');
const L = require('./glsl-lint.js');
const SH = self.FKShaders, BU = self.FKBulb;

test('3D-Welten: Shader fehlerfrei (Prüfer)', () => {
    const errs = [];
    for (const k of ['BULB_FS', 'POST_FS', 'SHADE_FS', 'RESOLVE_FS']) errs.push(...L.lintProgram(SH.VS, BU[k], k));
    assert.deepEqual(errs, []);
});
