// renderer.js — WebGL2-Engine: Iterationspuffer (R32UI), Compute-Jobs in zeitbudgetierten
// Häppchen (Fence-gesteuert, kein GPU-Stau, kein Watchdog-Risiko), Referenzorbit-Texturen,
// Display-Pass mit Reprojektion + Crossfade. Kein Main-Thread-Blocking (kein gl.finish/readPixels
// im Normalbetrieb).
(function (root) {
'use strict';

const HP = root.FKHP;
const SH = root.FKShaders;
const TEXW = 2048;

function create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false,
        preserveDrawingBuffer: false, powerPreference: 'high-performance', desynchronized: false });
    if (!gl) return null;
    const R = { gl, canvas, lost: gl.isContextLost() };    // 6.5.2: kann schon beim Anlegen verloren sein (WebGL gesperrt)
    let programs = {};
    let vao = null;

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
            const log = gl.getShaderInfoLog(s);
            gl.deleteShader(s);
            throw new Error('Shader: ' + log);
        }
        return s;
    }
    // Vorab übersetzen ohne Statusabfrage: der Treiber übersetzt parallel (KHR_parallel_shader_compile),
    // erst program() fragt den Status ab -> kein Ruckler beim ersten Einschalten (3D-Shader sind groß)
    const pending = {};
    const PSC = gl.getExtension('KHR_parallel_shader_compile');
    R.parallelCompile = !!PSC;
    function startProgram(fsSrc, vsSrc) {
        const p = gl.createProgram();
        const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); gl.attachShader(p, sh); return sh; };
        const vs = mk(gl.VERTEX_SHADER, vsSrc || SH.VS), fs = mk(gl.FRAGMENT_SHADER, fsSrc);
        gl.linkProgram(p);
        return { p, vs, fs };
    }
    R.prewarm = function (key, fsSrc, vsSrc) { if (!programs[key] && !pending[key]) pending[key] = startProgram(fsSrc, vsSrc); };
    // 6.3: nicht blockierend fragen, ob ein Programm fertig ist (startet die Übersetzung bei Bedarf). Mit
    // KHR_parallel_shader_compile wird COMPLETION_STATUS_KHR gepollt – das wartet nie. Ohne die Erweiterung blockiert
    // jede Statusabfrage, bis der Treiber fertig ist; dann wird in Häppchen über mehrere Bilder verteilt
    // (Vertex-Shader, Fragment-Shader, Link je in einem eigenen Bild), damit kein einzelnes Bild alles trägt.
    // (Unter Windows übersetzt Chrome über Direct3D 11/FXC – große Shader brauchen dort Sekunden.)
    R.programReady = function (key, fsSrc, vsSrc) {
        if (programs[key]) return true;
        if (R.broken[key]) throw shaderFail(key);
        if (gl.isContextLost()) return false;
        if (PSC) {
            if (!pending[key]) { pending[key] = startProgram(fsSrc, vsSrc); return false; }
            if (!gl.getProgramParameter(pending[key].p, PSC.COMPLETION_STATUS_KHR)) return false;
            program(key, fsSrc, vsSrc);
            return true;
        }
        let st = pending[key];
        if (!st) {          // Häppchen 1: Vertex-Shader
            const p = gl.createProgram();
            const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, vsSrc || SH.VS); gl.compileShader(vs);
            pending[key] = { p, vs, fs: null, step: 1 };
            return false;
        }
        if (st.step === 1) {   // Häppchen 2: auf den Vertex-Shader warten, Fragment-Shader starten
            gl.getShaderParameter(st.vs, gl.COMPILE_STATUS);
            const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
            st.fs = fs; st.step = 2;
            return false;
        }
        if (st.step === 2) {   // Häppchen 3: auf den Fragment-Shader warten, Link starten
            gl.getShaderParameter(st.fs, gl.COMPILE_STATUS);
            gl.attachShader(st.p, st.vs); gl.attachShader(st.p, st.fs); gl.linkProgram(st.p); st.step = 3;
            return false;
        }
        program(key, fsSrc, vsSrc);    // Häppchen 4: Link-Status (+ Uniform-Orte)
        return true;
    };
    R.hasProgram = (key) => !!programs[key];
    // P1-2: Übersetzungs-/Link-Fehler (fremder Treiber) werden je Programm gemerkt und einmal gemeldet; geworfen wird eine
    // markierte Ausnahme (err.shaderKey) – die Aufrufer fallen auf einen anderen Weg zurück, statt in jedem Bild zu scheitern
    R.broken = {};
    function shaderFail(key, err) {
        if (!R.broken[key]) { R.broken[key] = String(err && err.message || err); console.warn('Shader „' + key + '“ defekt:', R.broken[key]); }
        const e = new Error('Shader defekt: ' + key);
        e.shaderKey = key;
        return e;
    }
    function program(key, fsSrc, vsSrc) {
        if (programs[key]) return programs[key];
        if (R.broken[key]) throw shaderFail(key);
        try { return buildProgram(key, fsSrc, vsSrc); } catch (e) { throw e.shaderKey ? e : shaderFail(key, e); }
    }
    function buildProgram(key, fsSrc, vsSrc) {
        let p;
        if (pending[key]) {
            const pd = pending[key]; delete pending[key];
            p = pd.p;
            if (pd.step && pd.step < 3) {     // Häppchen-Übersetzung noch nicht beim Link: jetzt (blockierend) abschließen
                if (!pd.fs) { pd.fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(pd.fs, fsSrc); gl.compileShader(pd.fs); }
                gl.attachShader(p, pd.vs); gl.attachShader(p, pd.fs); gl.linkProgram(p);
            }
            if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
                throw new Error('Link: ' + gl.getShaderInfoLog(pd.vs) + gl.getShaderInfoLog(pd.fs) + gl.getProgramInfoLog(p));
        } else {
            p = gl.createProgram();
            gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc || SH.VS));
            gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Link: ' + gl.getProgramInfoLog(p));
        }
        const loc = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
            const u = gl.getActiveUniform(p, i);
            const name = u.name.replace(/\[0\]$/, '');
            loc[name] = gl.getUniformLocation(p, u.name);
        }
        programs[key] = { p, loc };
        return programs[key];
    }

    function initGL() {
        programs = {};
        for (const k in pending) delete pending[k];
        vao = gl.createVertexArray();
        R.vao = vao;
        gl.bindVertexArray(vao);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        R.refTex = null;
        R.ref = null;
        pool.length = 0;
        // nach einem Kontextverlust gehören alle Handles dem alten Kontext (P1-3)
        _dummy = _dummyD = null;
        scatterProg = scatterVAO = scatterVBO = null;
        histTex = null; histW = histH = 0;
        if (PSC) gl.getExtension('KHR_parallel_shader_compile');   // Erweiterungen gelten je Kontext: neu aktivieren
    }

    // ------------------------------------------------ Iterationspuffer
    // 6.1: Rechenpuffer haben einen zweiten Kanal (R8, COLOR_ATTACHMENT1) mit der Distanzschätzung –
    // der Iterationspuffer (R32UI) selbst bleibt bitgenau wie bisher. 5 Byte pro Pixel.
    const pool = [];
    function texture(fmt, w, h) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }
    // 7.1: acc = Puffer für einen Färbe-Stil – das DE-Ziel ist dann RGBA8 (R = Distanz, G/B = Stil-Wert 16 bit), 8 Byte pro Pixel
    function makeBuffer(w, h, plain, acc) {
        const tex = texture(gl.R32UI, w, h);
        const de = plain ? null : texture(acc ? gl.RGBA8 : gl.R8, w, h);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (de) {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, de, 0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, de, fbo, w, h, plain: !!plain, acc: !plain && !!acc, inUse: false, id: Math.random() };
    }
    const bpp = (b) => b.plain ? 4 : b.acc ? 8 : 5;
    // Puffer holen (wiederverwenden, wenn gleiche Größe frei); plain = ohne DE-Kanal (Hilfspuffer); acc = mit Stil-Kanal (7.1)
    function acquire(w, h, plain, acc) {
        plain = !!plain; acc = !plain && !!acc;
        for (const b of pool) if (!b.inUse && b.w === w && b.h === h && b.plain === plain && b.acc === acc) { b.inUse = true; return b; }
        // unbenutzte Puffer verwerfen, wenn der Pool sein Speicherbudget überschreitet (älteste zuerst)
        let bytes = w * h * (plain ? 4 : acc ? 8 : 5);
        for (const b of pool) bytes += b.w * b.h * bpp(b);
        for (let i = 0; i < pool.length && bytes > R.poolBudget; ) {
            if (!pool[i].inUse) { bytes -= pool[i].w * pool[i].h * bpp(pool[i]); freeBuffer(pool[i]); pool.splice(i, 1); } else i++;
        }
        const b = makeBuffer(w, h, plain, acc);
        b.inUse = true;
        pool.push(b);
        return b;
    }
    function release(b) { if (b) b.inUse = false; }
    R.poolBudget = 48 * 1024 * 1024;  // Iterationspuffer gesamt (Bytes); app.js setzt es je nach Gerät
    R.poolInfo = () => { let used = 0, free = 0; for (const b of pool) { if (b.inUse) used += b.w * b.h * bpp(b); else free += b.w * b.h * bpp(b); } return { n: pool.length, usedMB: +(used / 1048576).toFixed(1), freeMB: +(free / 1048576).toFixed(1) }; };
    function freeBuffer(b) { gl.deleteTexture(b.tex); if (b.de) gl.deleteTexture(b.de); gl.deleteFramebuffer(b.fbo); }

    // ------------------------------------------------ Referenzorbit / BLA
    function tex2D(internal, format, type, data, comps) {
        const n = data.length / comps;
        const rows = Math.max(1, Math.ceil(n / TEXW));
        let buf = data;
        if (rows * TEXW * comps !== data.length) {
            buf = new Float32Array(rows * TEXW * comps);
            buf.set(data);
        }
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, TEXW, rows, 0, format, type, buf);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return t;
    }
    // msg: Antwort des Orbit-Workers (Float32-Daten)
    R.setReference = function (msg) {
        if (R.refTex) { gl.deleteTexture(R.refTex.orbit); if (R.refTex.ab) { gl.deleteTexture(R.refTex.ab); gl.deleteTexture(R.refTex.r); } }
        R.refTex = { orbit: tex2D(gl.RG32F, gl.RG, gl.FLOAT, msg.orbit32, 2), ab: null, r: null };
        R.ref = msg;
        if (msg.bla32) R.setBLA(msg.bla32);
    };
    R.setBLA = function (bla) {
        if (!R.refTex) return;
        if (R.refTex.ab) { gl.deleteTexture(R.refTex.ab); gl.deleteTexture(R.refTex.r); }
        R.refTex.ab = tex2D(gl.RGBA32F, gl.RGBA, gl.FLOAT, bla.A, 4);
        R.refTex.r = tex2D(gl.R32F, gl.RED, gl.FLOAT, bla.R, 1);
        R.ref.bla32 = bla;
    };

    // ------------------------------------------------ Compute-Jobs
    // job: { w, h, view:{cx,cy(BigInt),zoom}, scale, formula, maxIter, mode:'direct'|'perturb', julia:[x,y] }
    R.beginJob = function (job) {
        job.buf = acquire(job.w, job.h, false, job.st > 0);
        job.row = 0;
        job.q = [];
        job.done = false;
        job.gpuStart = performance.now();
        if (job.mode === 'perturb') {
            const ref = R.ref;
            job.refId = ref.id;
            job.offset = [HP.toNumber(job.view.cx - ref.refXb), HP.toNumber(job.view.cy - ref.refYb)];
            job.useBLA = !!(ref.bla32 && ref.blaCmax >= Math.hypot(job.offset[0], job.offset[1]) + job.scale * Math.hypot(job.w, job.h) / 2);
        }
        return job;
    };

    let pxPerChunk = 60000;           // adaptive Häppchengröße (Pixel)
    R.submitted = 0;                  // Häppchen seit dem letzten Frame (app.js: Leerlauf-Frame-Zeit)
    R.maxInflight = 2;                // 2 Häppchen in der GPU-Warteschlange: kein Leerlauf zwischen Frames
    // Häppchen nachschieben, fertige einsammeln. Liefert true wenn Job fertig.
    let pxMove = 16384;               // Häppchengröße während Bewegung (Frame-Zeit-geregelt)
    // ctl: { moving, dt (EMA ms), vsync (ms) } — während Gesten regelt die gemessene Frame-Zeit
    // die Häppchengröße (Ziel: Frame <= 1.3 x Vsync), im Stillstand der Durchsatz (Fence-Polls).
    R.pump = function (job, now, ctl) {
        if (job.done) return true;
        const moving = !!(ctl && ctl.moving);
        if (moving) {
            if (ctl.dt > 1.3 * ctl.vsync) pxMove = Math.max(1024, pxMove * 0.8);
            else if (ctl.dt < 1.12 * ctl.vsync) pxMove = Math.min(pxPerChunk, 2e6, pxMove * 1.1);
        }
        if (!job.q) job.q = [];
        // fertige Häppchen einsammeln (in Reihenfolge)
        while (job.q.length) {
            const c = job.q[0];
            const st = gl.clientWaitSync(c.sync, 0, 0);
            if (st === gl.TIMEOUT_EXPIRED) { c.polls++; break; }
            gl.deleteSync(c.sync);
            job.q.shift();
            // Adaptive Größe: ein Häppchen soll etwa einen Frame dauern
            const polls = c.polls - (c.waited || 0);
            if (!moving && !(ctl && ctl.prefetch)) {
                if (polls <= 0) pxPerChunk = Math.min(8e6, pxPerChunk * 1.5);
                else if (polls >= 2) pxPerChunk = Math.max(4096, pxPerChunk * (polls >= 4 ? 0.4 : 0.7));
            }
        }
        if (job.row >= job.h && !job.q.length) { job.done = true; job.gpuMs = performance.now() - job.gpuStart; return true; }
        // Vorausrechnen: kleinere Häppchen (halbes Stillstands-Häppchen), damit eine neue Geste nicht wartet
        let px = ctl && ctl.prefetch ? Math.min(pxPerChunk, 250000) * 0.5 : (moving ? pxMove : pxPerChunk);
        // 6.4 Flug: Mindestanteil, damit der Job in ctl.minS Sekunden fertig wird (Bildzeit dt ms pro Häppchen-Runde)
        if (moving && ctl && ctl.minS) px = Math.max(px, Math.min(2e5, job.w * job.h * (ctl.dt / 1000) / ctl.minS));
        // P1-2: Rechen-Variante defekt -> Job als gescheitert beenden (app.js wählt einen anderen Rechenweg)
        const key = computeKey(job);
        if (R.broken[key]) { job.failed = true; job.done = true; return true; }
        try {
            // neue Rechen-Variante erst übersetzen lassen – nicht blockierend, bis dahin ruht der Job (6.4 nur Bunt; P2-7 alle:
            // erster Wechsel auf eine Formel, erste finale Stufe, „Menge glatt“ – vorher stand das Bild so lange)
            if (job.row < job.h && !programs[key] && !R.programReady(key, SH.computeFS(job.formula, job.mode, job.err, job.de, job.inn, job.st))) return false;
            while (job.row < job.h && job.q.length < R.maxInflight) {
                const rows = Math.max(1, Math.min(job.h - job.row, Math.floor(px / job.w)));
                drawCompute(job, job.row, rows);
                job.row += rows;
                // ein zweites Häppchen wartet erst auf das erste -> seine Poll-Zählung entsprechend versetzen
                job.q.push({ sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), polls: 0, waited: job.q.length ? 1 : 0 });
                R.submitted++;
                gl.flush();
            }
        } catch (e) {
            if (!e.shaderKey) throw e;
            job.failed = true; job.done = true;
            return true;
        }
        return false;
    };

    // 6.4: Variante mit Innen-Information (Bunte Menge) = Suffix 'i'
    // 7.1: Färbe-Stil = Suffix 's<n>'
    const computeKey = (job) => 'c' + job.formula + job.mode + (job.err ? 'e' : '') + (job.de ? 'd' : '') + (job.inn ? 'i' : '') + (job.st ? 's' + job.st : '');
    R.computeKey = computeKey;
    // P2-7: Rechen-Variante vorab übersetzen lassen (z. B. die finale Stufe, während die Vorschau läuft); wartet nie
    R.prewarmCompute = (v) => { if (!R.broken[computeKey(v)]) R.prewarm(computeKey(v), SH.computeFS(v.formula, v.mode, v.err, v.de, v.inn, v.st)); };
    function drawCompute(job, y0, rows) {
        const pr = program(computeKey(job), SH.computeFS(job.formula, job.mode, job.err, job.de, job.inn, job.st));
        const L = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, job.buf.fbo);
        gl.viewport(0, 0, job.w, job.h);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, y0, job.w, rows);
        gl.uniform2f(L.u_res, job.w, job.h);
        // 6.8.1 Kachel-Screenshot: Puffermitte relativ zur Bildmitte (sonst 0) – Uniforms gelten je Programm, darum immer setzen
        gl.uniform2f(L.u_pxoff, job.pxoff ? job.pxoff[0] : 0, job.pxoff ? job.pxoff[1] : 0);
        gl.uniform1f(L.u_scale, job.scale);
        gl.uniform1i(L.u_maxIter, job.maxIter);
        if (L.u_stp) { const p = job.stp || [5, 1, 24, 0.32]; gl.uniform4f(L.u_stp, p[0], p[1], p[2], p[3]); }     // 7.1 Stil: Streifendichte, Kreisradius, Fenster, Vergessen
        if (L.u_cabs) gl.uniform1f(L.u_cabs, job.formula === 1 ? Math.hypot(job.julia[0], job.julia[1]) : Math.hypot(HP.toNumber(job.view.cx), HP.toNumber(job.view.cy)));
        if (job.mode === 'direct') {
            gl.uniform2f(L.u_center, HP.toNumber(job.view.cx), HP.toNumber(job.view.cy));
            if (L.u_julia) gl.uniform2f(L.u_julia, job.julia[0], job.julia[1]);
        } else {
            const ref = R.ref;
            gl.uniform2f(L.u_offset, job.offset[0], job.offset[1]);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.refTex.orbit); gl.uniform1i(L.u_orbit, 0);
            gl.uniform1i(L.u_baseA, ref.baseA); gl.uniform1i(L.u_lenA, ref.lenA);
            gl.uniform1i(L.u_baseB, ref.baseB); gl.uniform1i(L.u_lenB, ref.lenB);
            if (L.u_blaOn !== undefined) {
                const on = job.useBLA && R.refTex.ab && !R.noBLA;
                gl.uniform1i(L.u_blaOn, on ? 1 : 0);
                if (on) {
                    const b = ref.bla32;
                    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.refTex.ab); gl.uniform1i(L.u_blaAB, 1);
                    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.refTex.r); gl.uniform1i(L.u_blaR, 2);
                    gl.uniform1iv(L.u_blaL, new Int32Array(b.L));
                    gl.uniform1iv(L.u_blaOff, b.off);
                } else {
                    // Sampler trotzdem gültig binden
                    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.refTex.orbit); gl.uniform1i(L.u_blaAB, 1);
                    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.refTex.orbit); gl.uniform1i(L.u_blaR, 2);
                }
            }
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // CPU-Kachel in einen Job-Puffer hochladen (Float32 -> uint-Bits); de8: DE-Codes (Uint8) oder null
    // (7.1 Stil-Puffer: de8 = RGBA8 je Pixel – Distanz, Stil-Wert hoch/niedrig, 0)
    R.uploadTile = function (job, x, y, w, h, f32, de8) {
        const u32 = new Uint32Array(f32.buffer, f32.byteOffset, w * h);
        gl.bindTexture(gl.TEXTURE_2D, job.buf.tex);
        // Kachel-y zählt von oben; Worker liefert die Zeilen bereits in GL-Reihenfolge (unten zuerst)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, job.h - y - h, w, h, gl.RED_INTEGER, gl.UNSIGNED_INT, u32);
        if (job.buf.de) {
            gl.bindTexture(gl.TEXTURE_2D, job.buf.de);
            if (job.buf.acc) gl.texSubImage2D(gl.TEXTURE_2D, 0, x, job.h - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, de8 && de8.length === 4 * w * h ? de8 : new Uint8Array(4 * w * h));
            else gl.texSubImage2D(gl.TEXTURE_2D, 0, x, job.h - y - h, w, h, gl.RED, gl.UNSIGNED_BYTE, de8 && de8.length === w * h ? de8 : new Uint8Array(w * h));
        }
    };

    // ------------------------------------------------ Präzisions-Korrektur
    // Markierte (unsichere) Pixel eines Puffers finden: 32 px -> 1 uint, dann async lesen.
    // Rückgabe: Int32Array [x, yVonOben, ...]
    R.findUnsure = function (buf) {
        const pw = Math.ceil(buf.w / 32), ph = buf.h;
        const tmp = acquire(pw, ph, true);
        const pr = program('flagpack', SH.FLAGPACK_FS), L = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fbo);
        gl.viewport(0, 0, pw, ph);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, buf.tex); gl.uniform1i(L.u_src, 0);
        gl.uniform1i(L.u_w, buf.w);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return R.readAsync(tmp.fbo, pw, ph, gl.RGBA_INTEGER, gl.UNSIGNED_INT, Uint32Array, 4).then((u) => {
            release(tmp);
            if (!u) return null;
            let n = 0;
            for (let i = 0; i < pw * ph; i++) { let b = u[4 * i]; while (b) { b &= b - 1; n++; } }
            const out = new Int32Array(2 * n);
            let k = 0;
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
                let b = u[4 * (y * pw + x)];
                while (b) {
                    const bit = 31 - Math.clz32(b & -b);
                    b &= b - 1;
                    out[k++] = x * 32 + bit; out[k++] = buf.h - 1 - y;   // Zeile von oben
                }
            }
            return out;
        });
    };
    // Kopie eines Iterationspuffers (Ziel der Korrektur, damit das angezeigte Bild unverändert bleibt)
    R.copyBuffer = function (buf) {
        const b = acquire(buf.w, buf.h, false, buf.acc);
        const pr = program('copy', SH.COPY_FS);
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.viewport(0, 0, buf.w, buf.h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, buf.tex); gl.uniform1i(pr.loc.u_src, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buf.de || dummyD()); gl.uniform1i(pr.loc.u_srcD, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return b;
    };
    let scatterVBO = null, scatterVAO = null, scatterProg = null;
    // Punkte (x, yVonOben) mit Werten (Float32) in den Puffer schreiben
    R.scatter = function (buf, xy, vals) {
        if (!scatterProg) {
            const p = gl.createProgram();
            gl.attachShader(p, compile(gl.VERTEX_SHADER, SH.SCATTER_VS));
            gl.attachShader(p, compile(gl.FRAGMENT_SHADER, SH.SCATTER_FS));
            gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_val');
            gl.linkProgram(p);
            scatterProg = { p, size: gl.getUniformLocation(p, 'u_size') };
            scatterVAO = gl.createVertexArray();
            scatterVBO = [gl.createBuffer(), gl.createBuffer()];
        }
        const n = vals.length;
        const pos = new Float32Array(2 * n);
        for (let i = 0; i < n; i++) { pos[2 * i] = xy[2 * i]; pos[2 * i + 1] = buf.h - 1 - xy[2 * i + 1]; }
        gl.bindVertexArray(scatterVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, scatterVBO[0]); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, scatterVBO[1]); gl.bufferData(gl.ARRAY_BUFFER, new Uint32Array(vals.buffer, vals.byteOffset, n), gl.STREAM_DRAW);
        gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
        gl.useProgram(scatterProg.p);
        gl.uniform2f(scatterProg.size, buf.w, buf.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, buf.fbo);
        if (buf.de) gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);   // DE-Kanal behält die GPU-Schätzung
        gl.viewport(0, 0, buf.w, buf.h);
        gl.drawArrays(gl.POINTS, 0, n);
        if (buf.de) gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };
    R.acquireBuffer = acquire;
    // 6.8.1: Puffer sofort löschen (große Screenshot-Kacheln sollen nicht im Pool liegen bleiben)
    R.dropBuffer = function (b) { if (!b) return; const i = pool.indexOf(b); if (i >= 0) pool.splice(i, 1); if (!gl.isContextLost()) freeBuffer(b); };
    R.chunkInfo = () => ({ pxPerChunk: Math.round(pxPerChunk), pxMove: Math.round(pxMove) });

    R.cancelJob = function (job) {
        if (!job) return;
        if (job.q) { job.q.forEach(c => gl.deleteSync(c.sync)); job.q = []; }
        if (!job.kept) release(job.buf);
        job.done = true;
        job.cancelled = true;
    };
    R.releaseFrame = function (fr) {
        if (fr && fr.buf) release(fr.buf);
        if (fr && fr.h3d && R.onReleaseFrame) R.onReleaseFrame(fr);   // 3D-Höhentextur (js/three.js)
    };

    // ------------------------------------------------ Display
    // layer: { buf, view:{cx,cy}, scale }  cam: { cx, cy, zoom }  target: {w,h,fbo?}
    function xfFor(layer, cam, tw, th) {
        const sCam = 3 / (cam.zoom * th);           // Welt pro Zielpixel
        const k = sCam / layer.scale;
        const dx = HP.toNumber(cam.cx - layer.view.cx) / layer.scale;
        const dy = HP.toNumber(cam.cy - layer.view.cy) / layer.scale;
        return [k, k, dx - tw / 2 * k + layer.buf.w / 2, dy - th / 2 * k + layer.buf.h / 2];
    }
    // layers: [{ buf, view, scale, alpha }] von oben (schärfste) nach unten, höchstens SH.NL.
    // opts: { feather, recon, de, vp } – vp (6.8.1): [x, y, W, H] Lage des Ziels im ganzen Bild (Kachel-Screenshot)
    const xfBuf = new Float32Array(4 * SH.NL), sizeBuf = new Float32Array(2 * SH.NL), alphaBuf = new Float32Array(SH.NL), accBuf = new Float32Array(SH.NL);
    R.present = function (layers, cam, look, target, opts) {
        opts = opts || {};
        const tw = target ? target.w : canvas.width, th = target ? target.h : canvas.height;
        const pr = program('display', SH.DISPLAY_FS);
        const L = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
        gl.viewport(0, 0, tw, th);
        gl.uniform2f(L.u_target, tw, th);
        const vp = opts.vp;
        gl.uniform4f(L.u_vp, vp ? vp[0] : 0, vp ? vp[1] : 0, vp ? vp[2] : tw, vp ? vp[3] : th);
        const list = (layers || []).filter(l => l && l.buf).slice(0, SH.NL);
        for (let i = 0; i < SH.NL; i++) {
            const l = list[i];
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, l ? l.buf.tex : dummyU());
            gl.uniform1i(L['u_t' + i], i);
            gl.activeTexture(gl.TEXTURE0 + SH.NL + i);
            gl.bindTexture(gl.TEXTURE_2D, l && l.buf.de ? l.buf.de : dummyD());
            gl.uniform1i(L['u_d' + i], SH.NL + i);
            if (l) {
                xfBuf.set(xfFor(l, cam, tw, th), 4 * i);
                sizeBuf[2 * i] = l.buf.w; sizeBuf[2 * i + 1] = l.buf.h;
                alphaBuf[i] = l.alpha === undefined ? 1 : l.alpha;
            }
            accBuf[i] = l && l.buf.acc ? 1 : 0;
        }
        gl.uniform4fv(L.u_xf, xfBuf); gl.uniform2fv(L.u_size, sizeBuf); gl.uniform1fv(L.u_alpha, alphaBuf);
        gl.uniform1i(L.u_n, list.length);
        gl.uniform1f(L.u_feather, opts.feather || 0);
        gl.uniform1i(L.u_recon, opts.recon ? 1 : 0);
        gl.uniform1i(L.u_deOn, opts.de ? 1 : 0);
        if (opts.de) gl.uniform2f(L.u_deLH, opts.de[0], opts.de[1]);
        gl.uniform1i(L.u_formula, look.formula);
        gl.uniform1i(L.u_maxIter, look.maxIter);
        setPalette(L, look);
        gl.uniform1f(L.u_density, look.density);
        gl.uniform1f(L.u_time, look.time);
        gl.uniform1f(L.u_relief, look.relief);
        gl.uniform1i(L.u_particles, look.particles ? 1 : 0);
        gl.uniform1i(L.u_banded, look.banded ? 1 : 0);
        // 7.1 Färbe-Stil: je Ebene nur, wenn sie den Stil-Kanal hat (u_acc; sonst Standard – z. B. Ebenen von vor dem Umschalten)
        gl.uniform1i(L.u_style, look.style || 0);
        gl.uniform1fv(L.u_acc, accBuf);
        gl.uniform1f(L.u_stMix, look.stMix === undefined ? 1 : look.stMix);
        gl.uniform1f(L.u_stG, look.stG || 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    R.xfFor = xfFor;
    R.program = program;
    R.setPalette = (L, look) => setPalette(L, look);
    R.dummyU = () => dummyU();
    R.dummyD = () => dummyD();
    function setPalette(L, look) {
        const p = look.pal;
        gl.uniform3fv(L.u_palA, p.a); gl.uniform3fv(L.u_palB, p.b); gl.uniform3fv(L.u_palC, p.c); gl.uniform3fv(L.u_palD, p.d);
        gl.uniform1i(L.u_palCustom, p.custom ? 1 : 0);
        gl.uniform3fv(L.u_custom, look.custom);
        gl.uniform1f(L.u_cycle, look.cycle);
        if (L.u_setCol) gl.uniform3fv(L.u_setCol, look.setCol || [0, 0, 0.015]);   // 6.2 Farbe der Menge
        if (L.u_inMode) gl.uniform1i(L.u_inMode, look.inner || 0);                  // 6.4 Bunte Menge
        if (L.u_outM) gl.uniform1i(L.u_outM, look.outM || 0);                        // 6.9 Außen (Palette/Grenznah/Schwarz)
        if (L.u_outW) gl.uniform1f(L.u_outW, look.outW || 24);
    }
    // Integer-Texturen MÜSSEN NEAREST filtern, sonst 'incomplete' -> texelFetch liefert 0
    function nearest() {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    let _dummyD = null;
    function dummyD() {       // DE-Platzhalter: Code 0 = keine Angabe
        if (_dummyD) return _dummyD;
        _dummyD = texture(gl.R8, 1, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
        return _dummyD;
    }
    let _dummy = null;
    function dummyU() {
        if (_dummy) return _dummy;
        _dummy = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, _dummy);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, 1, 1);
        nearest();
        return _dummy;
    }

    // target/vp (6.8.1 Kachel-Screenshot): { w, h, fbo } und Lage im ganzen Bild [x, y, W, H]
    R.presentBulb = function (cam, look, target, vp) {
        const pr = program('bulb', SH.BULB_FS), L = pr.loc;
        const tw = target ? target.w : canvas.width, th = target ? target.h : canvas.height;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
        gl.viewport(0, 0, tw, th);
        gl.uniform2f(L.u_target, tw, th);
        gl.uniform4f(L.u_vp, vp ? vp[0] : 0, vp ? vp[1] : 0, vp ? vp[2] : tw, vp ? vp[3] : th);
        gl.uniform2f(L.u_rot, HP.toNumber(cam.cx), HP.toNumber(cam.cy));
        gl.uniform1f(L.u_zoom, cam.zoom);
        setPalette(L, look);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    let histTex = null, histW = 0, histH = 0;
    R.presentBuddha = function (hist, w, h, max, look) {
        if (!histTex || histW !== w || histH !== h) {
            if (histTex) gl.deleteTexture(histTex);
            histTex = gl.createTexture(); histW = w; histH = h;
            gl.bindTexture(gl.TEXTURE_2D, histTex);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, w, h);
            nearest();
        }
        gl.bindTexture(gl.TEXTURE_2D, histTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED_INTEGER, gl.UNSIGNED_INT, hist);
        const pr = program('buddha', SH.BUDDHA_FS), L = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, histTex); gl.uniform1i(L.u_hist, 0);
        gl.uniform2f(L.u_size, w, h); gl.uniform2f(L.u_target, canvas.width, canvas.height);
        gl.uniform1f(L.u_max, Math.max(1, max));
        setPalette(L, look);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // ------------------------------------------------ Offscreen-Farbbild (Thumbnails/Screenshot)
    R.renderToRGBA = function (layer, cam, look, w, h) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        R.present([layer], cam, look, { w, h, fbo });
        return R.readAsync(fbo, w, h, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array, 4).then((px) => {
            gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return px;
        });
    };

    // Asynchrones Auslesen per PBO + Fence (blockiert den Main-Thread nicht)
    // (6.8.1: x, y = Ausschnitt ab dieser Ecke, z. B. Kachel ohne Rand)
    R.readAsync = function (fbo, w, h, format, type, Arr, comps, x, y) {
        const bytes = w * h * comps * Arr.BYTES_PER_ELEMENT;
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.readPixels(x || 0, y || 0, w, h, format, type, 0);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        return new Promise((resolve) => {
            const poll = () => {
                if (gl.isContextLost()) { resolve(null); return; }
                const st = gl.clientWaitSync(sync, 0, 0);
                if (st === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 8); return; }
                gl.deleteSync(sync);
                const out = new Arr(w * h * comps);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
                gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                gl.deleteBuffer(pbo);
                resolve(out);
            };
            setTimeout(poll, 4);
        });
    };
    // Iterationswerte eines Puffers asynchron (Float32, Zeile 0 = unten)
    R.readIterAsync = function (buf) {
        return R.readAsync(buf.fbo, buf.w, buf.h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, Uint32Array, 4).then((u) => {
            if (!u) return null;
            const f = new Float32Array(buf.w * buf.h);
            const fu = new Uint32Array(f.buffer);
            for (let i = 0; i < fu.length; i++) fu[i] = u[4 * i];
            return f;
        });
    };
    // Nur für Tests: DE-Codes eines Puffers (Uint8, Zeile 0 = unten)
    // (eigener Hilfs-Framebuffer: readBuffer(ATTACHMENT1) am Rechenpuffer selbst ließ unter ANGLE/Metal spätere
    // Schreibzugriffe auf dessen Iterationskanal ins Leere laufen)
    R.readDESync = function (buf, full) {
        if (!buf.de) return null;
        const u = new Uint8Array(buf.w * buf.h * 4);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, buf.de, 0);
        gl.readPixels(0, 0, buf.w, buf.h, gl.RGBA, gl.UNSIGNED_BYTE, u);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
        const out = new Uint8Array(buf.w * buf.h);
        for (let i = 0; i < out.length; i++) out[i] = u[4 * i];
        if (full) return u;
        return out;
    };
    // Nur für Tests: synchrones Auslesen
    R.readIterSync = function (buf) {
        const u = new Uint32Array(buf.w * buf.h * 4);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, buf.fbo);
        gl.readPixels(0, 0, buf.w, buf.h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, u);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        const f = new Float32Array(buf.w * buf.h);
        const fu = new Uint32Array(f.buffer);
        for (let i = 0; i < fu.length; i++) fu[i] = u[4 * i];
        return f;
    };

    let info = null;      // P3-10: einmal abfragen (die HUD fragt alle 200 ms)
    R.info = function () {
        if (info && info.renderer) return info;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        info = { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                 maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
        return info;
    };

    // Kurzer Selbsttest: kompilieren die Perturbations-Shader auf diesem Gerät?
    R.selfTest = function () {
        try { program('c0perturbd', SH.computeFS(0, 'perturb', false, true)); program('c0directd', SH.computeFS(0, 'direct', false, true)); program('display', SH.DISPLAY_FS); return true; }
        catch (e) { console.warn('GPU-Selbsttest:', e.message); return false; }
    };
    // 6.5.2: ohne Anzeige-Shader kann gar nichts gezeigt werden (harter Fehler -> Meldung statt leerer Fläche)
    R.displayOK = function () {
        try { program('display', SH.DISPLAY_FS); return true; }
        catch (e) { console.warn('Anzeige-Shader:', e.message); return gl.isContextLost(); }
    };

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R.lost = true; if (R.onLost) R.onLost(); });
    canvas.addEventListener('webglcontextrestored', () => { R.lost = false; initGL(); if (R.onRestored) R.onRestored(); });

    initGL();
    return R;
}

root.FKRenderer = { create, TEXW };
})(typeof self !== 'undefined' ? self : globalThis);
