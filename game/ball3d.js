/* ball3d.js - bola 3D desenhada pixel a pixel em canvas 2D (sem bibliotecas).
   Uso:  Ball3D.draw(ctx, cx, cy, raio, spec, {yaw, pitch})   (spec = padrao + cores)
         Ball3D.drawStatic(canvas, spec, {yaw, pitch})        (miniaturas)
   spec: { pattern, base, accent, line, gloss(0-100), img, zoom, x, y }
   Padroes: solid, classic, wedges, seams, gradient, dots, stripes, hoops, halves, sash, checker, image (via img) */
(function (global) {
    'use strict';
    var TAU = Math.PI * 2;

    function parseColor(c, fallback) {
        c = String(c || fallback || '#ffffff');
        if (c.charAt(0) === '#') c = c.slice(1);
        if (c.length === 3) c = c.split('').map(function (h) { return h + h; }).join('');
        var n = parseInt(c, 16);
        if (isNaN(n)) n = 0xffffff;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    /* 12 vertices do icosaedro (centros dos pentagonos) e 20 centros de face (centros dos hexagonos) */
    var phi = (1 + Math.sqrt(5)) / 2;
    var VERTS = [], FACES = [];
    (function () {
        var raw = [];
        [-1, 1].forEach(function (a) {
            [-1, 1].forEach(function (b) {
                raw.push([0, a, b * phi]);
                raw.push([a, b * phi, 0]);
                raw.push([b * phi, 0, a]);
            });
        });
        raw.forEach(function (v) {
            var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
            VERTS.push([v[0] / l, v[1] / l, v[2] / l]);
        });
        function d2(a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; }
        var edge = Infinity, i, j, k;
        for (i = 1; i < VERTS.length; i++) edge = Math.min(edge, d2(VERTS[0], VERTS[i]));
        for (i = 0; i < VERTS.length; i++)
            for (j = i + 1; j < VERTS.length; j++)
                for (k = j + 1; k < VERTS.length; k++)
                    if (Math.abs(d2(VERTS[i], VERTS[j]) - edge) < 1e-6 && Math.abs(d2(VERTS[j], VERTS[k]) - edge) < 1e-6 && Math.abs(d2(VERTS[i], VERTS[k]) - edge) < 1e-6) {
                        var s = [VERTS[i][0] + VERTS[j][0] + VERTS[k][0], VERTS[i][1] + VERTS[j][1] + VERTS[k][1], VERTS[i][2] + VERTS[j][2] + VERTS[k][2]];
                        var l = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
                        FACES.push([s[0] / l, s[1] / l, s[2] / l]);
                    }
    })();
    var ALLPTS = VERTS.concat(FACES);
    var PENT_ANGLE = 0.325; // raio angular (rad) do pentagono na bola classica

    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    function sstep(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

    /* amostra de imagem (reduzida) para mapear na esfera */
    var imgCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
    function imageData(img) {
        if (!img || !img.complete || !img.naturalWidth) return null;
        var hit = imgCache && imgCache.get(img);
        if (hit && hit.src === img.src) return hit.d;
        try {
            var cv = document.createElement('canvas');
            cv.width = cv.height = 256;
            var cx = cv.getContext('2d');
            cx.drawImage(img, 0, 0, 256, 256);
            var d = cx.getImageData(0, 0, 256, 256);
            if (imgCache) imgCache.set(img, { src: img.src, d: d });
            return d;
        } catch (e) { return null; }
    }

    /* devolve funcao (x,y,z)->[r,g,b] no espaco do objeto (y para cima) */
    function makePattern(spec) {
        var base = parseColor(spec.base, '#ffffff');
        var accent = parseColor(spec.accent, '#111111');
        var line = parseColor(spec.line, '#1d2025');
        var pat = spec.pattern || 'solid';
        var idata = spec.img ? imageData(spec.img) : null;
        if (spec.img && idata) {
            var zoom = (spec.zoom || 100) / 100;
            var ox = ((spec.x == null ? 50 : spec.x) - 50) / 100;
            var oy = ((spec.y == null ? 50 : spec.y) - 50) / 100;
            var W = idata.width, H = idata.height, px = idata.data;
            return function (x, y, z) {
                var u = 0.5 + Math.atan2(x, z) / TAU;
                var v = 0.5 - Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI;
                u = ((u - 0.5) / zoom + 0.5 + ox) % 1; if (u < 0) u += 1;
                v = Math.min(0.999, Math.max(0, (v - 0.5) / zoom + 0.5 + oy));
                var i = ((v * H) | 0) * W + ((u * W) | 0);
                return [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
            };
        }
        switch (pat) {
        case 'classic':
            return function (x, y, z) {
                var best = -2, i;
                for (i = 0; i < VERTS.length; i++) {
                    var d = VERTS[i][0] * x + VERTS[i][1] * y + VERTS[i][2] * z;
                    if (d > best) best = d;
                }
                var ang = Math.acos(Math.min(1, best));
                if (ang < PENT_ANGLE) return ang > PENT_ANGLE - 0.022 ? mix(accent, line, 0.7) : accent;
                // costuras entre hexagonos: perto da fronteira entre dois centros de face
                var b1 = -2, b2 = -2;
                for (i = 0; i < FACES.length; i++) {
                    var f = FACES[i][0] * x + FACES[i][1] * y + FACES[i][2] * z;
                    if (f > b1) { b2 = b1; b1 = f; } else if (f > b2) b2 = f;
                }
                var seam = b1 - b2;
                if (seam < 0.05) return mix(line, base, sstep(0.012, 0.05, seam));
                return base;
            };
        case 'wedges':
            return function (x, y, z) {
                var a = (Math.atan2(x, z) + Math.PI) / TAU * 6;
                var idx = Math.floor(a) % 3;
                var f = a - Math.floor(a);
                var col = idx === 0 ? base : idx === 1 ? accent : line;
                var cap = Math.abs(y);
                if (cap > 0.93) return [255, 255, 255];
                if (f < 0.012 || f > 0.988) return mix(col, [255, 255, 255], 0.5);
                return col;
            };
        case 'seams':
            return function (x, y, z) {
                var w = 0.04;
                var l = Math.min(Math.abs(y), Math.abs(x), Math.abs(Math.abs(z) - 0.56) * 0.9);
                return l < w ? mix(base, line, sstep(w, w * 0.4, l)) : base;
            };
        case 'gradient':
            return function (x, y) { return mix(base, accent, Math.min(1, Math.max(0, y * 0.5 + 0.5))); };
        case 'dots':
            return function (x, y, z) {
                for (var i = 0; i < ALLPTS.length; i++) {
                    var d = ALLPTS[i][0] * x + ALLPTS[i][1] * y + ALLPTS[i][2] * z;
                    if (d > 0.965) return accent;
                }
                return base;
            };
        case 'stripes':
            return function (x) { return (Math.min(4, Math.floor((x * 0.5 + 0.5) * 5)) % 2 === 0) ? accent : base; };
        case 'hoops':
            return function (x, y) { return (Math.min(4, Math.floor((y * 0.5 + 0.5) * 5)) % 2 === 0) ? accent : base; };
        case 'halves':
            return function (x) { return Math.abs(x) < 0.02 ? [20, 20, 20] : (x > 0 ? accent : base); };
        case 'sash':
            return function (x, y) { return Math.abs((x + y) * 0.7071) < 0.3 ? accent : base; };
        case 'checker':
            return function (x, y, z) {
                var u = Math.floor((Math.atan2(x, z) + Math.PI) / TAU * 8);
                var v = Math.floor((Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI + 0.5) * 6);
                return ((u + v) & 1) ? accent : base;
            };
        default:
            return function () { return base; };
        }
    }

    var buffers = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
    var scratch = null;

    /* renderiza a esfera em 'size' x 'size' pixels e devolve o canvas interno */
    function renderSphere(size, spec, rot) {
        if (!scratch) scratch = document.createElement('canvas');
        if (scratch.width !== size) { scratch.width = scratch.height = size; }
        var sctx = scratch.getContext('2d');
        var img = sctx.createImageData(size, size);
        var out = img.data;
        var pattern = makePattern(spec);
        var gloss = Math.max(0, Math.min(100, spec.gloss == null ? 60 : spec.gloss)) / 100;
        var yaw = rot.yaw || 0, pitch = rot.pitch || 0, tilt = 0.32;
        var cy_ = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), ct = Math.cos(tilt), st = Math.sin(tilt);
        var R = size / 2 - 1.5, c = size / 2;
        var L = [-0.46, 0.62, 0.64], ll = Math.sqrt(L[0] * L[0] + L[1] * L[1] + L[2] * L[2]);
        L = [L[0] / ll, L[1] / ll, L[2] / ll];
        var H = [L[0], L[1], L[2] + 1], hl = Math.sqrt(H[0] * H[0] + H[1] * H[1] + H[2] * H[2]);
        H = [H[0] / hl, H[1] / hl, H[2] / hl];
        var shin = 18 + gloss * 70;
        for (var py = 0; py < size; py++) {
            var ny = -(py + 0.5 - c) / R;
            for (var px = 0; px < size; px++) {
                var nx = (px + 0.5 - c) / R;
                var d2 = nx * nx + ny * ny;
                if (d2 > 1.06) continue;
                var dist = Math.sqrt(d2);
                var alpha = Math.min(1, Math.max(0, (1 - dist) * R / 1.1 + 0.5));
                if (alpha <= 0) continue;
                var nz = d2 >= 1 ? 0 : Math.sqrt(1 - d2);
                var sx = d2 >= 1 ? nx / dist : nx, sy2 = d2 >= 1 ? ny / dist : ny;
                // desfaz inclinacao fixa do eixo (roll), depois pitch e yaw
                var x0 = sx * ct + sy2 * st, y0 = -sx * st + sy2 * ct, z0 = nz;
                var y1 = y0 * cp + z0 * sp, z1 = -y0 * sp + z0 * cp;
                var x2 = x0 * cy_ - z1 * sy, z2 = x0 * sy + z1 * cy_;
                var col = pattern(x2, y1, z2);
                var diff = sx * L[0] + sy2 * L[1] + nz * L[2];
                if (diff < 0) diff = 0;
                var shade = 0.30 + 0.82 * diff;
                var hd = sx * H[0] + sy2 * H[1] + nz * H[2];
                var spec_ = hd > 0 ? Math.pow(hd, shin) * (0.15 + gloss * 0.95) : 0;
                var rim = Math.pow(1 - nz, 3) * 0.22;
                var bounce = sy2 < 0 ? -sy2 * 0.14 : 0;
                var r = col[0] * shade + spec_ * 255 + rim * 90 + bounce * 40;
                var g = col[1] * shade + spec_ * 255 + rim * 130 + bounce * 90;
                var b = col[2] * shade + spec_ * 255 + rim * 200 + bounce * 60;
                var o = (py * size + px) * 4;
                out[o] = r > 255 ? 255 : r;
                out[o + 1] = g > 255 ? 255 : g;
                out[o + 2] = b > 255 ? 255 : b;
                out[o + 3] = alpha * 255;
            }
        }
        sctx.putImageData(img, 0, 0);
        return scratch;
    }

    /* desenha a bola (centro cx,cy; raio em pixels do ctx) */
    function draw(ctx, cx, cy, radius, spec, rot) {
        var size = Math.max(24, Math.min(Math.round(radius * 2), 420));
        var cv = renderSphere(size, spec || {}, rot || {});
        ctx.drawImage(cv, cx - radius, cy - radius, radius * 2, radius * 2);
    }

    function drawStatic(canvas, spec, rot) {
        var ctx = canvas.getContext('2d');
        var s = canvas.width;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, s, s);
        draw(ctx, s / 2, s / 2, s * 0.46, spec, rot || { yaw: 0.5, pitch: 0.3 });
    }

    global.Ball3D = { draw: draw, drawStatic: drawStatic, patterns: ['solid', 'classic', 'wedges', 'seams', 'gradient', 'dots', 'stripes', 'hoops', 'halves', 'sash', 'checker'] };
})(window);
