// ============================================================
//  GLSL Shaders for Mandelbrot Explorer
//  - Vertex shader: fullscreen triangle via gl_VertexID
//  - Fragment shader: df64 emulated double + perturbation theory
//  - Multiple color palettes with smooth coloring
// ============================================================

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
    // Fullscreen triangle trick (3 vertices, no buffer needed)
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    vUv = vec2(x, y) * 0.5 + 0.5;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

// --- Uniforms ---
uniform vec2 u_resolution;
uniform int u_maxIter;
uniform int u_palette;
uniform float u_colorCycle;  // palette animation offset

// Standard mode: df64 center + float scale
uniform vec4 u_center;  // (cx_hi, cx_lo, cy_hi, cy_lo)
uniform float u_scale;   // complex units per pixel

// Perturbation mode
uniform int u_mode;           // 0=standard, 1=perturbation
uniform sampler2D u_refOrbit; // reference orbit as 1D float texture
uniform int u_refLen;         // reference orbit length
uniform float u_pixelScale;   // complex units per pixel (perturbation)
uniform vec2 u_refOffset;     // offset from ref orbit center to current center
uniform vec2 u_refCenter;     // float32 approx of reference center (for glitch fallback)
uniform float u_time;         // animation time in seconds

uniform int u_fractalMode;    // 0=Mandelbrot, 1=Julia
uniform vec4 u_juliaC;        // Julia constant (hi_x, lo_x, hi_y, lo_y)

// ============================================================
//  Double-Single (ds) arithmetic — emulates ~48-bit precision
//  using pairs of 32-bit floats: value = hi + lo
// ============================================================

vec2 ds(float a) { return vec2(a, 0.0); }

vec2 ds_add(vec2 a, vec2 b) {
    float s = a.x + b.x;
    float v = s - a.x;
    float e = (a.x - (s - v)) + (b.x - v);
    e += a.y + b.y;
    float r = s + e;
    return vec2(r, e - (r - s));
}

vec2 ds_neg(vec2 a) { return -a; }
vec2 ds_abs(vec2 a) { return (a.x < 0.0) ? -a : a; }

vec2 ds_sub(vec2 a, vec2 b) {
    return ds_add(a, vec2(-b.x, -b.y));
}

vec2 ds_mul(vec2 a, vec2 b) {
    // Dekker splitting for error-free product
    float sp = 4097.0;
    float ca = a.x * sp;
    float ahi = ca - (ca - a.x);
    float alo = a.x - ahi;
    float cb = b.x * sp;
    float bhi = cb - (cb - b.x);
    float blo = b.x - bhi;

    float p = a.x * b.x;
    float e = ((ahi * bhi - p) + ahi * blo + alo * bhi) + alo * blo;
    e += a.x * b.y + a.y * b.x;
    float r = p + e;
    return vec2(r, e - (r - p));
}

vec2 ds_div(vec2 a, vec2 b) {
    float r = a.x / b.x;
    vec2 res = ds_mul(ds(r), b);
    vec2 diff = ds_sub(a, res);
    return ds_add(ds(r), ds(diff.x / b.x));
}

// ============================================================
//  Color Palettes — smooth, beautiful, neon-inspired
// ============================================================

vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
}

vec3 palette_neon(float t) {
    return pal(t,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 1.0, 1.0),
        vec3(0.00, 0.10, 0.20));
}

vec3 palette_ocean(float t) {
    return pal(t,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 1.0, 0.5),
        vec3(0.80, 0.90, 0.30));
}

vec3 palette_inferno(float t) {
    return pal(t,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 0.7, 0.4),
        vec3(0.00, 0.15, 0.20));
}

vec3 palette_electric(float t) {
    return pal(t,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(2.0, 1.0, 0.0),
        vec3(0.50, 0.20, 0.25));
}

vec3 palette_cosmic(float t) {
    return pal(t,
        vec3(0.50, 0.50, 0.50),
        vec3(0.50, 0.50, 0.50),
        vec3(1.0, 1.0, 1.0),
        vec3(0.30, 0.20, 0.20));
}

vec3 palette_aurora(float t) {
    return pal(t,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 1.0, 0.5),
        vec3(0.00, 0.33, 0.67));
}

vec3 getColor(float t, int pid) {
    t = fract(t + u_colorCycle);
    if (pid == 0) return palette_neon(t);
    if (pid == 1) return palette_ocean(t);
    if (pid == 2) return palette_inferno(t);
    if (pid == 3) return palette_electric(t);
    if (pid == 4) return palette_cosmic(t);
    return palette_aurora(t);
}

// ============================================================
//  Standard Mandelbrot with df64
// ============================================================

vec2 ds_mul_complex_re(vec2 ax, vec2 ay, vec2 bx, vec2 by) {
    return ds_sub(ds_mul(ax, bx), ds_mul(ay, by));
}
vec2 ds_mul_complex_im(vec2 ax, vec2 ay, vec2 bx, vec2 by) {
    return ds_add(ds_mul(ax, by), ds_mul(ay, bx));
}

float mandelbrot_standard(vec2 pixel) {
    float px = (pixel.x - 0.5) * u_resolution.x;
    float py = (pixel.y - 0.5) * u_resolution.y;
    float rx = px;
    float ry = py;

    // iterate z = z^2 + c
    vec2 zx, zy;
    vec2 cx, cy;

    if (u_fractalMode == 1) {
        // Julia: z0 = pixel, c = juliaC
        zx = ds_add(vec2(u_center.x, u_center.y), ds(rx * u_scale));
        zy = ds_add(vec2(u_center.z, u_center.w), ds(ry * u_scale));
        cx = vec2(u_juliaC.x, u_juliaC.y);
        cy = vec2(u_juliaC.z, u_juliaC.w);
    } else {
        // Mandelbrot: z0 = 0, c = pixel
        zx = ds(0.0);
        zy = ds(0.0);
        cx = ds_add(vec2(u_center.x, u_center.y), ds(rx * u_scale));
        cy = ds_add(vec2(u_center.z, u_center.w), ds(ry * u_scale));
    }

    float iter = 0.0;
    for (int i = 0; i < 16384; i++) {
        if (i >= u_maxIter) break;

        vec2 zx2 = ds_mul(zx, zx);
        vec2 zy2 = ds_mul(zy, zy);

        // bailout: |z|^2 > 256 (use 256 for better smooth coloring)
        float mag2 = zx2.x + zy2.x;
        if (mag2 > 256.0) {
            // smooth iteration count
            float log_zn = log(mag2) * 0.5;
            float nu = log(log_zn / log(2.0)) / log(2.0);
            iter = float(i) + 1.0 - nu;
            return iter;
        }

        vec2 new_zx, new_zy;
        if (u_fractalMode == 2) {
            // Burning Ship
            new_zy = ds_add(ds_abs(ds_mul(ds(2.0), ds_mul(zx, zy))), cy);
            new_zx = ds_add(ds_sub(zx2, zy2), cx);
        } else if (u_fractalMode == 3) {
            // Tricorn (Mandelbar): z = conj(z)^2 + c
            new_zy = ds_add(ds_neg(ds_mul(ds(2.0), ds_mul(zx, zy))), cy);
            new_zx = ds_add(ds_sub(zx2, zy2), cx);
        } else if (u_fractalMode == 4) {
            // Mandelbrot z^3
            vec2 x3 = ds_mul(zx, zx2);
            vec2 y3 = ds_mul(zy, zy2);
            new_zx = ds_add(ds_sub(x3, ds_mul(ds(3.0), ds_mul(zx, zy2))), cx);
            new_zy = ds_add(ds_sub(ds_mul(ds(3.0), ds_mul(zx2, zy)), y3), cy);
        } else if (u_fractalMode == 5) {
            // Newton Fractal: z = z - (z^3 - 1) / (3z^2)
            // This is (2z^3 + 1) / (3z^2)
            vec2 x3 = ds_mul(zx, zx2);
            vec2 y3 = ds_mul(zy, zy2);
            // Num = 2z^3 + 1
            vec2 num_re = ds_add(ds_mul(ds(2.0), ds_sub(x3, ds_mul(ds(3.0), ds_mul(zx, zy2)))), ds(1.0));
            vec2 num_im = ds_mul(ds(2.0), ds_sub(ds_mul(ds(3.0), ds_mul(zx2, zy)), y3));
            // Den = 3z^2
            vec2 den_re = ds_mul(ds(3.0), ds_sub(zx2, zy2));
            vec2 den_im = ds_mul(ds(6.0), ds_mul(zx, zy));
            
            // Complex division: (a+bi)/(c+di) = (ac+bd)/(c2+d2) + i(bc-ad)/(c2+d2)
            vec2 d2 = ds_add(ds_mul(den_re, den_re), ds_mul(den_im, den_im));
            if (d2.x < 1e-20) break; // Avoid div zero
            
            new_zx = ds_div(ds_add(ds_mul(num_re, den_re), ds_mul(num_im, den_im)), d2);
            new_zy = ds_div(ds_sub(ds_mul(num_im, den_re), ds_mul(num_re, den_im)), d2);
            
            // Check for convergence to roots
            // Root 1: (1, 0)
            if (ds_add(ds_mul(ds_sub(new_zx, ds(1.0)), ds_sub(new_zx, ds(1.0))), ds_mul(new_zy, new_zy)).x < 0.0001) {
                return float(i) + 1.0; 
            }
            // Root 2: (-0.5, sqrt(3)/2)
            if (ds_add(ds_mul(ds_add(new_zx, ds(0.5)), ds_add(new_zx, ds(0.5))), ds_mul(ds_sub(new_zy, ds(0.866025)), ds_sub(new_zy, ds(0.866025)))).x < 0.0001) {
                return float(i) + 1000.0; // Offset for coloring
            }
            // Root 3: (-0.5, -sqrt(3)/2)
            if (ds_add(ds_mul(ds_add(new_zx, ds(0.5)), ds_add(new_zx, ds(0.5))), ds_mul(ds_add(new_zy, ds(0.866025)), ds_add(new_zy, ds(0.866025)))).x < 0.0001) {
                return float(i) + 2000.0; // Offset for coloring
            }
        } else {
            // Mandelbrot / Julia
            new_zy = ds_add(ds_mul(ds(2.0), ds_mul(zx, zy)), cy);
            new_zx = ds_add(ds_sub(zx2, zy2), cx);
        }
        zx = new_zx;
        zy = new_zy;

        iter = float(i);
    }

    return -1.0; // inside the set
}

// ============================================================
//  Perturbation Mandelbrot
// ============================================================

float mandelbrot_perturbation(vec2 pixel) {
    float px = (pixel.x - 0.5) * u_resolution.x;
    float py = (pixel.y - 0.5) * u_resolution.y;
    float rx = px;
    float ry = py;

    // delta_c: offset from reference point + pan offset
    float dcx = rx * u_pixelScale + u_refOffset.x;
    float dcy = ry * u_pixelScale + u_refOffset.y;

    float dzx, dzy;
    float final_dcx, final_dcy;

    if (u_fractalMode == 1) {
        // Julia Perturbation: 
        // Reference orbit Z_{n+1} = Z_n^2 + K (K = juliaC)
        // Pixel z_0 = P_ref + dP, c = K
        // Delta dz_{n+1} = 2*Z_n*dz_n + dz_n^2 (since dc=0)
        // Initial dz_0 = pixel offset from reference center
        dzx = dcx; 
        dzy = dcy;
        final_dcx = 0.0;
        final_dcy = 0.0;
    } else {
        // Mandelbrot Perturbation:
        // Reference orbit Z_{n+1} = Z_n^2 + C_ref
        // Pixel z_0 = 0, c = C_ref + dc
        // Initial dz_0 = 0
        dzx = 0.0;
        dzy = 0.0;
        final_dcx = dcx;
        final_dcy = dcy;
    }

    float iter = 0.0;
    int refIdx = 0;

    for (int i = 0; i < 16384; i++) {
        if (i >= u_refLen || i >= u_maxIter) break;

        // Fetch reference orbit Z_n (df64 stored as hi+lo)
        float tx = (float(refIdx) + 0.5) / float(u_refLen);
        vec4 ref = texture(u_refOrbit, vec2(tx, 0.5));
        float Zx = ref.x + ref.y;
        float Zy = ref.z + ref.w;

        // Full z = Z + dz
        float zx = Zx + dzx;
        float zy = Zy + dzy;
        float mag2 = zx * zx + zy * zy;

        if (mag2 > 256.0) {
            float log_zn = log(mag2) * 0.5;
            float nu = log(log_zn / log(2.0)) / log(2.0);
            return float(i) + 1.0 - nu;
        }

        // dz_{n+1} = 2*Z_n*dz_n + dz_n^2 + dc
        float next_dzx = 2.0 * (Zx * dzx - Zy * dzy) + dzx * dzx - dzy * dzy + final_dcx;
        float next_dzy = 2.0 * (Zx * dzy + Zy * dzx) + 2.0 * dzx * dzy + final_dcy;
        dzx = next_dzx;
        dzy = next_dzy;

        refIdx++;
        iter = float(i);
    }

    return -1.0;
}

// ============================================================
//  Main
// ============================================================

void main() {
    if (u_fractalMode == 6) {
        // --- Mandelbulb 3D Rendering (Raymarching) ---
        vec2 uv = (vUv - 0.5) * u_resolution / min(u_resolution.x, u_resolution.y);
        vec3 ro = vec3(0.0, 0.0, -2.5); // Camera position
        vec3 rd = normalize(vec3(uv, 1.2)); // Ray direction
        
        // Rotation for a better view
        float ang = u_time * 0.2;
        mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        ro.xz *= rot; rd.xz *= rot;
        ro.yz *= rot; rd.yz *= rot;

        float t = 0.0;
        float d = 0.0;
        int i;
        for (i = 0; i < 128; i++) {
            vec3 p = ro + rd * t;
            // Mandelbulb SDF (simplified)
            vec3 w = p;
            float m = dot(w,w);
            float dz = 1.0;
            for(int j=0; j<8; j++) {
                dz = 8.0*pow(m,3.5)*dz + 1.0;
                float r = length(w);
                float b = 8.0*acos(w.y/r);
                float a = 8.0*atan(w.x, w.z);
                w = p + pow(r,8.0) * vec3(sin(b)*sin(a), cos(b), sin(b)*cos(a));
                m = dot(w,w);
                if (m > 256.0) break;
            }
            d = 0.25*log(m)*sqrt(m)/dz;
            if (d < 0.001 || t > 4.0) break;
            t += d;
        }

        if (t < 4.0) {
            // Hit! Shading based on normal and iterations
            float occ = clamp(float(i)/64.0, 0.0, 1.0);
            vec3 col = getColor(occ * 4.0, u_palette);
            // Basic lighting
            vec3 normal = vec3(0,1,0); // Placeholder normal
            col *= (0.5 + 0.5 * occ); 
            fragColor = vec4(col, 1.0);
        } else {
            // Background for 3D
            fragColor = vec4(0.01, 0.01, 0.02, 1.0);
        }
        return;
    }

    float smoothIter;
    if (u_mode == 1 && u_fractalMode < 2) {
        smoothIter = mandelbrot_perturbation(vUv);
    } else {
        smoothIter = mandelbrot_standard(vUv);
    }

    if (smoothIter < 0.0) {
        // Inside the set — animated particles in the void
        vec2 uv = vUv * u_resolution / min(u_resolution.x, u_resolution.y);
        vec3 bgCol = vec3(0.0, 0.0, 0.015);
        
        // Particle layer: multiple drifting luminous dots
        float sparkle = 0.0;
        for (int layer = 0; layer < 3; layer++) {
            float speed = 0.15 + float(layer) * 0.08;
            float scale = 25.0 + float(layer) * 15.0;
            vec2 p = uv * scale + vec2(u_time * speed * 0.7, u_time * speed);
            vec2 cell = floor(p);
            vec2 frac = fract(p) - 0.5;
            // Hash for pseudo-random position per cell
            float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
            float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
            vec2 offset = vec2(sin(h * 6.28 + u_time * 0.5) * 0.3,
                               cos(h2 * 6.28 + u_time * 0.4) * 0.3);
            float d = length(frac - offset);
            float brightness = h * 0.8 + 0.2;
            float glow = brightness * exp(-d * d * 80.0) * (0.5 + 0.5 * sin(u_time * 2.0 + h * 20.0));
            sparkle += glow * (0.6 - float(layer) * 0.15);
        }
        
        // Tint particles with current palette color
        vec3 particleCol = getColor(u_time * 0.1, u_palette) * 0.5 + vec3(0.3, 0.4, 0.8) * 0.5;
        bgCol += sparkle * particleCol * 0.35;
        
        fragColor = vec4(bgCol, 1.0);
    } else {
        vec3 col;
        if (u_fractalMode == 5) {
            // Newton coloring
            int rootIdx = int(smoothIter / 1000.0);
            float iter = mod(smoothIter, 1000.0);
            float t = sqrt(iter / float(u_maxIter)) * 4.0;
            vec3 rootCol;
            if (rootIdx == 0) rootCol = vec3(1.0, 0.4, 0.4); // Reddish
            else if (rootIdx == 1) rootCol = vec3(0.4, 1.0, 0.4); // Greenish
            else rootCol = vec3(0.4, 0.6, 1.0); // Bluish
            col = getColor(t, u_palette) * rootCol * 1.5;
        } else {
            // Balanced color mapping: sqrt-log hybrid for rich detail
            float t = sqrt(smoothIter / float(u_maxIter)) * 8.0;
            col = getColor(t, u_palette);
        }
        
        // Boost saturation slightly
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(lum), col, 1.2);
        // Subtle vignette for cinematic feel
        vec2 vc = vUv - 0.5;
        float vignette = 1.0 - dot(vc, vc) * 0.25;
        col *= vignette;
        // Gamma correction for more vibrant colors
        col = pow(max(col, vec3(0.0)), vec3(0.92));
        fragColor = vec4(col, 1.0);
    }
}
`;
