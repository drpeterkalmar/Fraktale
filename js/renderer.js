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
    const R = { gl, canvas, lost: false };
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
    function program(key, fsSrc) {
        if (programs[key]) return programs[key];
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, SH.VS));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Link: ' + gl.getProgramInfoLog(p));
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
        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        R.refTex = null;
        R.ref = null;
        pool.length = 0;
    }

    // ------------------------------------------------ Iterationspuffer
    const pool = [];
    function makeBuffer(w, h) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo, w, h, inUse: false, id: Math.random() };
    }
    // Puffer holen (wiederverwenden, wenn gleiche Größe frei)
    function acquire(w, h) {
        for (const b of pool) if (!b.inUse && b.w === w && b.h === h) { b.inUse = true; return b; }
        // unbenutzte andere Größen verwerfen, wenn Pool groß wird
        if (pool.length > 6) {
            for (let i = pool.length - 1; i >= 0; i--) if (!pool[i].inUse) { freeBuffer(pool[i]); pool.splice(i, 1); if (pool.length <= 5) break; }
        }
        const b = makeBuffer(w, h);
        b.inUse = true;
        pool.push(b);
        return b;
    }
    function release(b) { if (b) b.inUse = false; }
    function freeBuffer(b) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo); }

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
        job.buf = acquire(job.w, job.h);
        job.row = 0;
        job.inflight = null;
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
    // Ein Häppchen abschicken, falls keins mehr in Arbeit. Liefert true wenn Job fertig.
    R.pump = function (job, now) {
        if (job.done) return true;
        if (job.inflight) {
            const st = gl.clientWaitSync(job.inflight.sync, 0, 0);
            if (st === gl.TIMEOUT_EXPIRED) { job.inflight.polls++; return false; }
            gl.deleteSync(job.inflight.sync);
            const polls = job.inflight.polls;
            // Adaptive Größe: fertig binnen eines Frames -> größer, sonst kleiner
            if (polls === 0) pxPerChunk = Math.min(8e6, pxPerChunk * 1.6);
            else if (polls >= 2) pxPerChunk = Math.max(4096, pxPerChunk * (polls >= 4 ? 0.4 : 0.7));
            job.inflight = null;
            if (job.row >= job.h) { job.done = true; job.gpuMs = performance.now() - job.gpuStart; return true; }
        }
        if (job.row >= job.h) { job.done = true; return true; }
        const rows = Math.max(1, Math.min(job.h - job.row, Math.floor(pxPerChunk / job.w)));
        drawCompute(job, job.row, rows);
        job.row += rows;
        job.inflight = { sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), polls: 0 };
        gl.flush();
        return false;
    };

    function drawCompute(job, y0, rows) {
        const pr = program('c' + job.formula + job.mode + (job.err ? 'e' : ''), SH.computeFS(job.formula, job.mode, job.err));
        const L = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, job.buf.fbo);
        gl.viewport(0, 0, job.w, job.h);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, y0, job.w, rows);
        gl.uniform2f(L.u_res, job.w, job.h);
        gl.uniform1f(L.u_scale, job.scale);
        gl.uniform1i(L.u_maxIter, job.maxIter);
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

    // CPU-Kachel in einen Job-Puffer hochladen (Float32 -> uint-Bits)
    R.uploadTile = function (job, x, y, w, h, f32) {
        const u32 = new Uint32Array(f32.buffer, f32.byteOffset, w * h);
        gl.bindTexture(gl.TEXTURE_2D, job.buf.tex);
        // Kachel-y zählt von oben; Worker liefert die Zeilen bereits in GL-Reihenfolge (unten zuerst)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, job.h - y - h, w, h, gl.RED_INTEGER, gl.UNSIGNED_INT, u32);
    };

    // ------------------------------------------------ Präzisions-Korrektur
    // Markierte (unsichere) Pixel eines Puffers finden: 32 px -> 1 uint, dann async lesen.
    // Rückgabe: Int32Array [x, yVonOben, ...]
    R.findUnsure = function (buf) {
        const pw = Math.ceil(buf.w / 32), ph = buf.h;
        const tmp = acquire(pw, ph);
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
        const b = acquire(buf.w, buf.h);
        const pr = program('copy', SH.COPY_FS);
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.viewport(0, 0, buf.w, buf.h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, buf.tex); gl.uniform1i(pr.loc.u_src, 0);
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
        gl.viewport(0, 0, buf.w, buf.h);
        gl.drawArrays(gl.POINTS, 0, n);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };
    R.acquireBuffer = acquire;

    R.cancelJob = function (job) {
        if (!job) return;
        if (job.inflight) { gl.deleteSync(job.inflight.sync); job.inflight = null; }
        if (!job.kept) release(job.buf);
        job.done = true;
        job.cancelled = true;
    };
    R.releaseFrame = function (fr) { if (fr && fr.buf) release(fr.buf); };

    // ------------------------------------------------ Display
    // layer: { buf, view:{cx,cy}, scale }  cam: { cx, cy, zoom }  target: {w,h,fbo?}
    function xfFor(layer, cam, tw, th) {
        const sCam = 3 / (cam.zoom * th);           // Welt pro Zielpixel
        const k = sCam / layer.scale;
        const dx = HP.toNumber(cam.cx - layer.view.cx) / layer.scale;
        const dy = HP.toNumber(cam.cy - layer.view.cy) / layer.scale;
        return [k, k, dx - tw / 2 * k + layer.buf.w / 2, dy - th / 2 * k + layer.buf.h / 2];
    }
    R.present = function (A, B, mixB, cam, look, target) {
        const tw = target ? target.w : canvas.width, th = target ? target.h : canvas.height;
        const pr = program('display', SH.DISPLAY_FS);
        const L = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
        gl.viewport(0, 0, tw, th);
        gl.uniform2f(L.u_target, tw, th);
        const bind = (layer, unit, texU, xfU, sizeU, hasU) => {
            gl.activeTexture(gl.TEXTURE0 + unit);
            if (layer) {
                gl.bindTexture(gl.TEXTURE_2D, layer.buf.tex);
                gl.uniform4fv(xfU, xfFor(layer, cam, tw, th));
                gl.uniform2f(sizeU, layer.buf.w, layer.buf.h);
            } else gl.bindTexture(gl.TEXTURE_2D, dummyU());
            gl.uniform1i(texU, unit);
            gl.uniform1i(hasU, layer ? 1 : 0);
        };
        bind(A, 0, L.u_texA, L.u_xfA, L.u_sizeA, L.u_hasA);
        bind(B, 1, L.u_texB, L.u_xfB, L.u_sizeB, L.u_hasB);
        gl.uniform1f(L.u_mixB, mixB);
        gl.uniform1i(L.u_formula, look.formula);
        gl.uniform1i(L.u_maxIter, look.maxIter);
        setPalette(L, look);
        gl.uniform1f(L.u_density, look.density);
        gl.uniform1f(L.u_time, look.time);
        gl.uniform1f(L.u_relief, look.relief);
        gl.uniform1i(L.u_particles, look.particles ? 1 : 0);
        gl.uniform1i(L.u_banded, look.banded ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    function setPalette(L, look) {
        const p = look.pal;
        gl.uniform3fv(L.u_palA, p.a); gl.uniform3fv(L.u_palB, p.b); gl.uniform3fv(L.u_palC, p.c); gl.uniform3fv(L.u_palD, p.d);
        gl.uniform1i(L.u_palCustom, p.custom ? 1 : 0);
        gl.uniform3fv(L.u_custom, look.custom);
        gl.uniform1f(L.u_cycle, look.cycle);
    }
    let _dummy = null;
    function dummyU() {
        if (_dummy) return _dummy;
        _dummy = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, _dummy);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, 1, 1);
        return _dummy;
    }

    R.presentBulb = function (cam, look) {
        const pr = program('bulb', SH.BULB_FS), L = pr.loc;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(L.u_target, canvas.width, canvas.height);
        gl.uniform2f(L.u_rot, HP.toNumber(cam.cx), HP.toNumber(cam.cy));
        gl.uniform1f(L.u_zoom, cam.zoom);
        setPalette(L, look);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let histTex = null, histW = 0, histH = 0;
    R.presentBuddha = function (hist, w, h, max, look) {
        if (!histTex || histW !== w || histH !== h) {
            if (histTex) gl.deleteTexture(histTex);
            histTex = gl.createTexture(); histW = w; histH = h;
            gl.bindTexture(gl.TEXTURE_2D, histTex);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, w, h);
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
        R.present(null, layer, 1, cam, look, { w, h, fbo });
        return R.readAsync(fbo, w, h, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array, 4).then((px) => {
            gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return px;
        });
    };

    // Asynchrones Auslesen per PBO + Fence (blockiert den Main-Thread nicht)
    R.readAsync = function (fbo, w, h, format, type, Arr, comps) {
        const bytes = w * h * comps * Arr.BYTES_PER_ELEMENT;
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.readPixels(0, 0, w, h, format, type, 0);
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

    R.info = function () {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                 maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    };

    // Kurzer Selbsttest: kompilieren die Perturbations-Shader auf diesem Gerät?
    R.selfTest = function () {
        try { program('c0perturb', SH.computeFS(0, 'perturb')); program('c0direct', SH.computeFS(0, 'direct')); program('display', SH.DISPLAY_FS); return true; }
        catch (e) { console.warn('GPU-Selbsttest:', e.message); return false; }
    };

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R.lost = true; if (R.onLost) R.onLost(); });
    canvas.addEventListener('webglcontextrestored', () => { R.lost = false; initGL(); if (R.onRestored) R.onRestored(); });

    initGL();
    return R;
}

root.FKRenderer = { create, TEXW };
})(typeof self !== 'undefined' ? self : globalThis);
