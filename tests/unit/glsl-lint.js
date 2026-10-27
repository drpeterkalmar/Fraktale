// Kleiner GLSL-ES-3.0-Prüfer für die Node-Tests (kein glslangValidator auf dem Mac): ersetzt keinen Compiler, fängt
// aber die typischen Tippfehler, bevor ein Browser läuft:
//  * Präprozessor (#define NAME WERT, #if/#elif/#else/#endif mit einfachen Ausdrücken) -> nur der aktive Code wird geprüft
//  * Klammern (), {}, [] ausgeglichen
//  * jedes u_… ist als uniform deklariert, keine Doppel-Deklaration
//  * Aufrufe: nur eingebaute Funktionen, Typ-Konstruktoren oder im Quelltext definierte Funktionen
//  * Ganzzahl-Literale als Argument von Funktionen, die es nur für float gibt (pow(x, 2) ist in GLSL ES ein Fehler)
//  * Programm: jedes `in` des Fragment-Shaders hat ein gleichnamiges `out` gleichen Typs im Vertex-Shader; gemeinsame
//    Uniforms haben in beiden Shadern denselben Typ
'use strict';

const BUILTINS = new Set(('radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2 sqrt ' +
    'inversesqrt abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf ' +
    'floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat packSnorm2x16 unpackSnorm2x16 packUnorm2x16 unpackUnorm2x16 ' +
    'packHalf2x16 unpackHalf2x16 length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct ' +
    'transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not textureSize ' +
    'texture textureProj textureLod textureOffset texelFetch texelFetchOffset textureProjOffset textureLodOffset textureProjLod ' +
    'textureProjLodOffset textureGrad textureGradOffset textureProjGrad textureProjGradOffset dFdx dFdy fwidth').split(/\s+/));
const TYPES = new Set(('float int uint bool vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 ' +
    'mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 sampler2D usampler2D isampler2D sampler3D samplerCube ' +
    'sampler2DArray sampler2DShadow').split(/\s+/));
const KEYWORDS = new Set('if for while do switch return else case default break continue discard'.split(' '));
// nur für float (bzw. genType = float-Vektoren) definiert – ein reines Ganzzahl-Literal als Argument ist ein Fehler
const FLOAT_ONLY = new Set(('radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt floor ceil fract ' +
    'mod smoothstep step mix length distance dot cross normalize reflect refract').split(/\s+/));

function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ''); }

// Präprozessor: gibt den aktiven Quelltext zurück (Direktiven entfernt)
function preprocess(src) {
    const defs = {};
    const out = [], stack = [];   // stack: { active, taken, parentActive }
    const active = () => stack.every(f => f.active);
    const evalExpr = (e) => {
        let js = e.replace(/defined\s*\(?\s*(\w+)\s*\)?/g, (m, n) => (n in defs ? '1' : '0'));
        // (7.1: Makros, die auf Makros verweisen – z. B. #define DT (ERR == 1 || DE == 1) – mehrfach einsetzen)
        for (let k = 0; k < 6 && /[A-Za-z_]/.test(js); k++) js = js.replace(/\b[A-Za-z_]\w*\b/g, (n) => (n in defs ? '(' + defs[n] + ')' : '0'));
        if (!/^[\d\s()+\-*/<>=!&|.]*$/.test(js)) throw new Error('Präprozessor-Ausdruck nicht auswertbar: ' + e);
        return !!Function('return (' + js + ');')();
    };
    for (const line of src.split('\n')) {
        const m = line.match(/^\s*#\s*(\w+)\s*(.*)$/);
        if (!m) { if (active()) out.push(line); continue; }
        const [, d, rest] = m;
        if (d === 'version') { out.push(''); continue; }
        if (d === 'define') { if (active()) { const mm = rest.match(/^(\w+)\s*(.*)$/); defs[mm[1]] = mm[2].trim() || '1'; } continue; }
        if (d === 'if' || d === 'ifdef' || d === 'ifndef') {
            const pa = active();
            const v = d === 'if' ? evalExpr(rest) : (d === 'ifdef' ? rest.trim() in defs : !(rest.trim() in defs));
            stack.push({ active: pa && v, taken: v, pa });
            continue;
        }
        if (d === 'elif') { const f = stack[stack.length - 1]; const v = !f.taken && evalExpr(rest); f.active = f.pa && v; f.taken = f.taken || v; continue; }
        if (d === 'else') { const f = stack[stack.length - 1]; f.active = f.pa && !f.taken; f.taken = true; continue; }
        if (d === 'endif') { if (!stack.length) throw new Error('#endif ohne #if'); stack.pop(); continue; }
        throw new Error('unbekannte Direktive #' + d);
    }
    if (stack.length) throw new Error('#if ohne #endif');
    // Makros mit Wert im Code ersetzen (hier nur Zahlen-Makros)
    let code = out.join('\n');
    for (const k in defs) if (/^-?[\d.]+$/.test(defs[k])) code = code.replace(new RegExp('\\b' + k + '\\b', 'g'), defs[k]);
    return code;
}

function balanced(code) {
    const st = [], pairs = { ')': '(', ']': '[', '}': '{' };
    for (const ch of code) {
        if ('([{'.includes(ch)) st.push(ch);
        else if (ch in pairs) { if (st.pop() !== pairs[ch]) return false; }
    }
    return st.length === 0;
}

// Deklarationen: uniform/in/out (auch Listen und Arrays)
function decls(code, kw) {
    const res = {};
    const re = new RegExp('(?:^|[;\\n{}])\\s*(?:layout\\s*\\([^)]*\\)\\s*)?(?:flat\\s+|smooth\\s+)?' + kw + '\\s+(?:(?:highp|mediump|lowp)\\s+)?(\\w+)\\s+([^;]+);', 'g');
    let m, dup = [];
    while ((m = re.exec(code))) {
        const type = m[1];
        for (const part of m[2].split(',')) {
            const name = part.trim().replace(/\[.*\]$/, '').trim();
            if (!name) continue;
            if (res[name]) dup.push(name);
            res[name] = type;
        }
    }
    return { map: res, dup };
}

// Funktionsdefinitionen: "<typ> name(" am Zeilen-/Blockanfang
function definedFunctions(code) {
    const s = new Set(), re = /(?:^|[;}\n])\s*(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)\s*\([^;{]*\)\s*\{/g;
    let m;
    // (7.1: auch Strukturen als Rückgabetyp, z. B. InSt inStart(…) im Bunt-Kern)
    const structs = new Set([...code.matchAll(/\bstruct\s+(\w+)/g)].map(x => x[1]));
    while ((m = re.exec(code))) if (TYPES.has(m[1]) || m[1] === 'void' || structs.has(m[1])) s.add(m[2]);
    return s;
}

// Argumente eines Aufrufs ab Position der öffnenden Klammer (oberste Ebene)
function callArgs(code, open) {
    let depth = 0, cur = '', args = [];
    for (let i = open; i < code.length; i++) {
        const ch = code[i];
        if (ch === '(' || ch === '[') { if (depth++ > 0) cur += ch; continue; }
        if (ch === ')' || ch === ']') { if (--depth === 0) { args.push(cur); return args; } cur += ch; continue; }
        if (ch === ',' && depth === 1) { args.push(cur); cur = ''; continue; }
        cur += ch;
    }
    return args;
}

function lintShader(src, name) {
    const errs = [];
    let code;
    try { code = stripComments(preprocess(stripComments(src))); } catch (e) { return [name + ': ' + e.message]; }
    if (!balanced(code)) errs.push(name + ': Klammern nicht ausgeglichen');
    const U = decls(code, 'uniform');
    for (const d of U.dup) errs.push(name + ': uniform doppelt deklariert: ' + d);
    const used = new Set(code.match(/\bu_\w+/g) || []);
    for (const u of used) if (!(u in U.map)) errs.push(name + ': uniform nicht deklariert: ' + u);
    const fns = definedFunctions(code);
    const re = /\b([A-Za-z_]\w*)\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
        const f = m[1];
        if (KEYWORDS.has(f) || TYPES.has(f) || BUILTINS.has(f) || fns.has(f) || f === 'main' || f === 'layout') continue;
        // Deklaration "typ name(" einer Funktion steht schon in fns; alles andere ist unbekannt
        errs.push(name + ': unbekannte Funktion: ' + f);
    }
    const re2 = /\b(\w+)\s*\(/g;
    while ((m = re2.exec(code))) {
        if (!FLOAT_ONLY.has(m[1])) continue;
        const args = callArgs(code, m.index + m[0].length - 1);
        for (const a of args) if (/^\s*-?\d+\s*$/.test(a)) errs.push(name + ': Ganzzahl-Literal in ' + m[1] + '(' + args.join(',') + ')');
    }
    for (const d of localDups(code)) errs.push(name + ': lokale Variable im selben Block doppelt deklariert: ' + d);
    return [...new Set(errs)];
}

// 7.4.3: doppelte Deklaration im selben Block (auch Funktionsparameter vs. oberster Block der Funktion). Fehlerbild 7.4.0:
// `vec4 …, r = …;` und darunter `uint r;` – die Sonde war unübersetzbar, der Prüfer sah es nicht.
// Statements werden an ; { } getrennt; Deklaration = beginnt mit (const/highp/…) Typ, Namen per Komma auf Klammertiefe 0.
function localDups(code) {
    const dups = [];
    const QUAL = /^(?:(?:const|highp|mediump|lowp|in|out|inout|flat|smooth)\s+)*/;
    const declNames = (st) => {
        st = st.trim().replace(QUAL, '');
        const m = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:=|,|\[|$)/.exec(st);
        if (!m || !TYPES.has(m[1])) return [];
        const rest = st.slice(m[1].length);
        const out = [];
        let depth = 0, cur = '';
        for (const ch of rest + ',') {
            if ('([{'.includes(ch)) depth++;
            else if (')]}'.includes(ch)) depth--;
            if (ch === ',' && depth === 0) { const n = /^\s*([A-Za-z_]\w*)/.exec(cur); if (n) out.push(n[1]); cur = ''; } else cur += ch;
        }
        return out;
    };
    const stack = [];          // je offenem Block: Set der Namen (null = globaler Bereich wird nicht geprüft)
    let st = '', pendingParams = null, i = 0;
    const add = (names) => { const s = stack[stack.length - 1]; if (!s) return; for (const n of names) { if (s.has(n)) dups.push(n); s.add(n); } };
    while (i < code.length) {
        const ch = code[i];
        if (ch === '(' ) {
            // Funktionskopf „typ name(params) {“: Parameter merken, sie gehören in den obersten Block der Funktion
            const j = matchParen(code, i);
            const head = st.trim();
            if (stack.length === 0 && /^[A-Za-z_]\w*\s+[A-Za-z_]\w*$/.test(head.replace(QUAL, ''))) {
                pendingParams = code.slice(i + 1, j).split(',').map(p => p.trim().replace(QUAL, '')).map(p => (/^[A-Za-z_]\w*\s+([A-Za-z_]\w*)/.exec(p) || [])[1]).filter(Boolean);
            }
            st += code.slice(i, j + 1); i = j + 1; continue;
        }
        if (ch === '{') {
            const s = new Set();
            if (stack.length === 0 && pendingParams) { for (const n of pendingParams) s.add(n); }
            pendingParams = null;
            stack.push(stack.length === 0 && !/\)\s*$/.test(st.trim()) ? null : s);
            st = ''; i++; continue;
        }
        if (ch === '}') { stack.pop(); st = ''; i++; continue; }
        if (ch === ';') { if (stack.length) add(declNames(st)); st = ''; i++; continue; }
        st += ch; i++;
    }
    return dups;
}
function matchParen(code, i) {
    let d = 0;
    for (let k = i; k < code.length; k++) { if (code[k] === '(') d++; else if (code[k] === ')' && --d === 0) return k; }
    return code.length - 1;
}

function lintProgram(vs, fs, name) {
    const errs = lintShader(vs, name + '/VS').concat(lintShader(fs, name + '/FS'));
    const cv = stripComments(preprocess(stripComments(vs))), cf = stripComments(preprocess(stripComments(fs)));
    const outs = decls(cv, 'out').map, ins = decls(cf, 'in').map;
    for (const k in ins) if (outs[k] !== ins[k]) errs.push(name + ': Varying ' + k + ' im FS (' + ins[k] + ') ohne passendes out im VS (' + outs[k] + ')');
    // benutzte Varyings (Namenskonvention v_…) müssen deklariert sein
    for (const v of new Set(cv.match(/\bv_\w+/g) || [])) if (!(v in outs)) errs.push(name + '/VS: Varying nicht deklariert: ' + v);
    for (const v of new Set(cf.match(/\bv_\w+/g) || [])) if (!(v in ins)) errs.push(name + '/FS: Varying nicht deklariert: ' + v);
    const uv = decls(cv, 'uniform').map, uf = decls(cf, 'uniform').map;
    for (const k in uv) if (k in uf && uv[k] !== uf[k]) errs.push(name + ': uniform ' + k + ' mit verschiedenen Typen (VS ' + uv[k] + ', FS ' + uf[k] + ')');
    return errs;
}

// Aktive Uniforms wie beim Treiber (getActiveUniform): nur, was in von main() aus erreichbaren Funktionen vorkommt
// (ungenutzte Funktionen und deren Uniforms entfernt der Compiler). Näherung ohne Daten-/Kontrollflussanalyse.
function activeUniforms(src) {
    const code = stripComments(preprocess(stripComments(src)));
    const bodies = {}, re = /(?:^|[;}\n])\s*(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)\s*\([^;{]*\)\s*\{/g;
    let m;
    while ((m = re.exec(code))) {
        if (!(TYPES.has(m[1]) || m[1] === 'void')) continue;
        let i = m.index + m[0].length, depth = 1;
        while (i < code.length && depth) { if (code[i] === '{') depth++; else if (code[i] === '}') depth--; i++; }
        bodies[m[2]] = (bodies[m[2]] || '') + code.slice(m.index + m[0].length, i);
    }
    const seen = new Set(), todo = ['main'];
    while (todo.length) {
        const f = todo.pop();
        if (seen.has(f) || !bodies[f]) continue;
        seen.add(f);
        for (const c of bodies[f].match(/\b\w+(?=\s*\()/g) || []) if (bodies[c] && !seen.has(c)) todo.push(c);
    }
    const used = new Set();
    for (const f of seen) for (const u of bodies[f].match(/\bu_\w+/g) || []) used.add(u);
    return used;
}

module.exports = { preprocess, lintShader, lintProgram, stripComments, balanced, activeUniforms };
