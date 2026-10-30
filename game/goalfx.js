/* Efeitos de comemoração de gol (desenhados no campo, no lugar onde a bola entrou).
   Cada efeito é uma função do tempo da animação (g.t, em segundos), então fica igual em qualquer aparelho.
   g.fx é o id do efeito (ex.: 'x-explosao'); efeito desconhecido não desenha nada.
   Para criar um efeito novo: adicione uma entrada em E (init + draw + screen opcional) e o mesmo id
   em server/exclusives.js (catálogo) e game/exclusives.js (nome, ícone, cores). */
(function () {
    'use strict';
    var TAU = 6.2832;
    function rng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function P(R, u, o) {   // partícula radial: ângulo aleatório, velocidade em [a, b] unidades/s
        var a = R() * TAU, sp = (o.min + R() * (o.max - o.min)) * u;
        return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: o.l0 + R() * (o.l1 - o.l0), age: o.age || 0, s: (o.s0 + R() * (o.s1 - o.s0)) * u, a: a, k: o.k || 0, r: R() };
    }
    function move(p, dt, drag) {
        var d = Math.pow(drag, dt);
        p.vx *= d; p.vy *= d; p.x += p.vx * dt; p.y += p.vy * dt;
    }
    function flash(c, W, H, rgb, alpha) { if (alpha <= 0) return; c.save(); c.fillStyle = 'rgba(' + rgb + ',' + alpha + ')'; c.fillRect(0, 0, W, H); c.restore(); }
    function ring(c, r, w, style, alpha) { c.globalAlpha = alpha; c.strokeStyle = style; c.lineWidth = w; c.beginPath(); c.arc(0, 0, Math.max(.01, r), 0, TAU); c.stroke(); c.globalAlpha = 1; }
    function glow(c, rad, k, c0, c1, c2) {
        var gr = c.createRadialGradient(0, 0, 0, 0, 0, rad);
        gr.addColorStop(0, 'rgba(' + c0 + ',' + (.95 * k) + ')'); gr.addColorStop(.4, 'rgba(' + c1 + ',' + (.6 * k) + ')'); gr.addColorStop(1, 'rgba(' + c2 + ',0)');
        c.fillStyle = gr; c.beginPath(); c.arc(0, 0, rad, 0, TAU); c.fill();
    }
    function heart(c, s) {
        c.beginPath(); c.moveTo(0, s * .38);
        c.bezierCurveTo(-s * 1.05, -s * .15, -s * .55, -s * .9, 0, -s * .42);
        c.bezierCurveTo(s * .55, -s * .9, s * 1.05, -s * .15, 0, s * .38);
        c.closePath();
    }
    function star4(c, s) {   // brilho de 4 pontas
        c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(0, 0, s, 0); c.quadraticCurveTo(0, 0, 0, s); c.quadraticCurveTo(0, 0, -s, 0); c.quadraticCurveTo(0, 0, 0, -s); c.closePath();
    }

    var E = {};

    /* ---------- Explosão ---------- */
    E['x-explosao'] = {
        init: function (s, R, u) {
            var i;
            for (i = 0; i < 48; i++) s.p.push(P(R, u, { min: 2, max: 11, l0: .5, l1: 1.25, s0: .3, s1: .9, k: 0 }));
            for (i = 0; i < 60; i++) s.p.push(P(R, u, { min: 9, max: 31, l0: .45, l1: 1.25, s0: .07, s1: .17, k: 1 }));
            for (i = 0; i < 18; i++) s.p.push(P(R, u, { min: 1, max: 4.5, l0: 1.1, l1: 1.8, s0: .6, s1: 1.3, k: 2, age: -(.1 + R() * .15) }));
        },
        draw: function (c, s, t, dt, u) {
            var i, p, f, e;
            if (t < .8) {
                e = 1 - Math.pow(1 - t / .8, 3);
                ring(c, u * (1 + 13 * e), u * (.5 - .4 * e), '#ffd36a', 1 - t / .8);
                ring(c, u * (.6 + 11 * e), u * .12, 'rgba(255,255,255,.85)', 1 - t / .8);
            }
            for (i = 0; i < s.p.length; i++) {
                p = s.p[i]; p.age += dt;
                if (p.age < 0 || p.age >= p.life) continue;
                f = p.age / p.life;
                move(p, dt, p.k === 1 ? .35 : p.k === 2 ? .3 : .12);
                if (p.k === 2) {
                    c.globalCompositeOperation = 'source-over';
                    c.fillStyle = 'rgba(70,62,58,' + (.26 * Math.sin(Math.PI * Math.min(1, f * 1.15))) + ')';
                    c.beginPath(); c.arc(p.x, p.y, p.s * (1 + f * 1.6), 0, TAU); c.fill();
                } else if (p.k === 1) {
                    c.globalCompositeOperation = 'lighter';
                    c.strokeStyle = 'rgba(255,' + Math.round(215 - 90 * f) + ',90,' + (1 - f) + ')';
                    c.lineWidth = p.s; c.lineCap = 'round';
                    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * .035, p.y - p.vy * .035); c.stroke();
                } else {
                    c.globalCompositeOperation = 'source-over';
                    c.fillStyle = 'rgba(255,' + Math.round(175 - 140 * f) + ',' + Math.round(30 - 30 * f) + ',' + (.9 * Math.pow(1 - f, 1.1)) + ')';
                    c.beginPath(); c.arc(p.x, p.y, p.s * (1 + f * 1.3), 0, TAU); c.fill();
                }
            }
            c.globalCompositeOperation = 'source-over';
            if (t < .35) glow(c, u * (2.2 + t * 18), 1 - t / .35, '255,255,235', '255,190,60', '255,90,0');
        },
        screen: function (c, t, W, H) { if (t < .3) flash(c, W, H, '255,205,110', .6 * (1 - t / .3)); }
    };

    /* ---------- Confete ---------- */
    var CONF = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ffffff', '#ff9f1c'];
    E['x-confete'] = {
        init: function (s, R, u) {
            for (var i = 0; i < 130; i++) {
                var p = P(R, u, { min: 3, max: 24, l0: 1.3, l1: 2.1, s0: .3, s1: .55 });
                p.col = CONF[Math.floor(R() * CONF.length)]; p.rot = R() * TAU; p.vr = (R() - .5) * 14; p.fl = R() * TAU; p.ratio = .45 + R() * .5;
                s.p.push(p);
            }
        },
        draw: function (c, s, t, dt, u) {
            var i, p, f;
            if (t < .5) ring(c, u * (1 + 9 * (t / .5)), u * .25, '#ffffff', .8 * (1 - t / .5));
            for (i = 0; i < s.p.length; i++) {
                p = s.p[i]; p.age += dt;
                if (p.age >= p.life) continue;
                f = p.age / p.life;
                move(p, dt, .18); p.rot += p.vr * dt;
                var w = p.s * (.25 + .75 * Math.abs(Math.cos(p.fl + p.age * 9)));
                c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
                c.globalAlpha = f < .7 ? 1 : 1 - (f - .7) / .3;
                c.fillStyle = p.col; c.fillRect(-w / 2, -p.s * p.ratio, w, p.s * p.ratio * 2);
                c.restore();
            }
            c.globalAlpha = 1;
        },
        screen: function (c, t, W, H) { if (t < .2) flash(c, W, H, '255,255,255', .35 * (1 - t / .2)); }
    };

    /* ---------- Fogos de artifício ---------- */
    var FIRE = ['255,90,90', '255,210,80', '90,230,255', '170,120,255', '120,255,160', '255,130,220'];
    E['x-fogos'] = {
        init: function (s, R, u) {
            s.bursts = [];
            for (var b = 0; b < 6; b++) {
                var a = R() * TAU, d = (3 + R() * 7) * u, bx = Math.cos(a) * d, by = Math.sin(a) * d - u * 2, t0 = b * .2, col = FIRE[b % FIRE.length];
                s.bursts.push({ x: bx, y: by, t0: t0, col: col });
                for (var i = 0; i < 38; i++) {
                    var p = P(R, u, { min: 5, max: 15, l0: .8, l1: 1.25, s0: .08, s1: .16, age: -t0 });
                    p.x = bx; p.y = by; p.col = col; p.tw = R() * TAU;
                    s.p.push(p);
                }
            }
        },
        draw: function (c, s, t, dt, u) {
            var i, p, f, b;
            c.globalCompositeOperation = 'lighter';
            for (i = 0; i < s.bursts.length; i++) {
                b = s.bursts[i];
                if (t > b.t0 && t < b.t0 + .35) {
                    var k = (t - b.t0) / .35;
                    c.save(); c.translate(b.x, b.y);
                    glow(c, u * (1 + 3 * k), 1 - k, '255,255,255', b.col, b.col);
                    c.restore();
                }
            }
            for (i = 0; i < s.p.length; i++) {
                p = s.p[i]; p.age += dt;
                if (p.age < 0 || p.age >= p.life) continue;
                f = p.age / p.life;
                move(p, dt, .06);
                p.y += u * 1.6 * dt;          // as faíscas "caem" um pouco
                var tw = f > .55 ? .5 + .5 * Math.sin(p.tw + p.age * 40) : 1;
                c.strokeStyle = 'rgba(' + p.col + ',' + ((1 - f) * tw) + ')';
                c.lineWidth = p.s; c.lineCap = 'round';
                c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * .07, p.y - p.vy * .07); c.stroke();
            }
            c.globalCompositeOperation = 'source-over';
        }
    };

    /* ---------- Raio ---------- */
    function bolt(R, len, u, segs) {
        var pts = [{ x: 0, y: 0 }], a = R() * TAU, ca = Math.cos(a), sa = Math.sin(a), i;
        for (i = 1; i <= segs; i++) {
            var d = len * i / segs, j = (R() - .5) * u * 2.2 * (i === segs ? .3 : 1);
            pts.push({ x: ca * d - sa * j, y: sa * d + ca * j });
        }
        return pts;
    }
    E['x-raio'] = {
        init: function (s, R, u) {
            s.bolts = [];
            for (var i = 0; i < 7; i++) {
                var main = bolt(R, (9 + R() * 8) * u, u, 9), br = [];
                for (var k = 0; k < 2; k++) {
                    var at = main[3 + Math.floor(R() * 4)], sub = bolt(R, (3 + R() * 4) * u, u, 4);
                    br.push(sub.map(function (q) { return { x: q.x + at.x, y: q.y + at.y }; }));
                }
                s.bolts.push({ main: main, br: br, t0: i * .05, seed: R() * 100 });
            }
            for (i = 0; i < 26; i++) s.p.push(P(R, u, { min: 6, max: 22, l0: .35, l1: .9, s0: .06, s1: .12, k: 1 }));
        },
        draw: function (c, s, t, dt, u) {
            var i, k, b, f, line;
            c.globalCompositeOperation = 'lighter';
            if (t < .6) glow(c, u * (3 + t * 8), 1 - t / .6, '210,235,255', '90,150,255', '40,60,255');
            line = function (pts, w, style) {
                c.strokeStyle = style; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round';
                c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
                for (var q = 1; q < pts.length; q++) c.lineTo(pts[q].x, pts[q].y);
                c.stroke();
            };
            for (i = 0; i < s.bolts.length; i++) {
                b = s.bolts[i]; f = t - b.t0;
                if (f < 0 || f > .75) continue;
                var fl = f < .45 ? (Math.sin((f + b.seed) * 70) > -.35 ? 1 : .25) : Math.max(0, 1 - (f - .45) / .3);
                if (fl <= 0) continue;
                line(b.main, u * .55, 'rgba(70,130,255,' + (.22 * fl) + ')');
                line(b.main, u * .22, 'rgba(255,255,255,' + fl + ')');
                for (k = 0; k < b.br.length; k++) { line(b.br[k], u * .3, 'rgba(70,130,255,' + (.2 * fl) + ')'); line(b.br[k], u * .1, 'rgba(220,240,255,' + (.9 * fl) + ')'); }
            }
            for (i = 0; i < s.p.length; i++) {
                var p = s.p[i]; p.age += dt;
                if (p.age >= p.life) continue;
                f = p.age / p.life; move(p, dt, .2);
                c.strokeStyle = 'rgba(160,210,255,' + (1 - f) + ')'; c.lineWidth = p.s; c.lineCap = 'round';
                c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * .04, p.y - p.vy * .04); c.stroke();
            }
            c.globalCompositeOperation = 'source-over';
            if (t < .5) ring(c, u * (1 + 11 * (1 - Math.pow(1 - t / .5, 3))), u * .3, 'rgba(160,200,255,1)', 1 - t / .5);
        },
        screen: function (c, t, W, H) {
            if (t < .12) flash(c, W, H, '225,238,255', .75 * (1 - t / .12));
            else if (t > .24 && t < .36) flash(c, W, H, '190,215,255', .5 * (1 - (t - .24) / .12));
        }
    };

    /* ---------- Chuva de moedas ---------- */
    E['x-moedas'] = {
        init: function (s, R, u) {
            var i;
            for (i = 0; i < 42; i++) {
                var p = P(R, u, { min: 4, max: 20, l0: 1.2, l1: 1.95, s0: .5, s1: .75 });
                p.ph = R() * TAU; p.spin = 8 + R() * 8;
                s.p.push(p);
            }
            for (i = 0; i < 30; i++) {
                var q = P(R, u, { min: 1, max: 12, l0: .4, l1: .9, s0: .5, s1: 1.1, k: 1, age: -R() * .8 });
                q.ph = R() * TAU; s.p.push(q);
            }
        },
        draw: function (c, s, t, dt, u) {
            var i, p, f, w;
            if (t < .5) glow(c, u * (2 + t * 10), 1 - t / .5, '255,240,180', '255,200,60', '255,160,0');
            for (i = 0; i < s.p.length; i++) {
                p = s.p[i]; p.age += dt;
                if (p.age < 0 || p.age >= p.life) continue;
                f = p.age / p.life; move(p, dt, p.k ? .2 : .2);
                if (p.k) {   // brilho
                    c.globalCompositeOperation = 'lighter';
                    c.save(); c.translate(p.x, p.y); c.rotate(p.ph + p.age * 2);
                    c.fillStyle = 'rgba(255,248,210,' + Math.sin(Math.PI * f) + ')'; star4(c, p.s * (.5 + .5 * Math.sin(Math.PI * f))); c.fill();
                    c.restore(); c.globalCompositeOperation = 'source-over';
                    continue;
                }
                w = Math.abs(Math.cos(p.ph + p.age * p.spin));
                c.save(); c.translate(p.x, p.y); c.globalAlpha = f < .72 ? 1 : 1 - (f - .72) / .28;
                c.scale(Math.max(.12, w), 1);
                c.fillStyle = '#ffc931'; c.beginPath(); c.arc(0, 0, p.s, 0, TAU); c.fill();
                c.strokeStyle = '#a86a00'; c.lineWidth = p.s * .16; c.stroke();
                c.strokeStyle = 'rgba(255,245,180,.9)'; c.lineWidth = p.s * .12; c.beginPath(); c.arc(0, 0, p.s * .6, 0, TAU); c.stroke();
                c.restore();
            }
            c.globalAlpha = 1;
        },
        screen: function (c, t, W, H) { if (t < .22) flash(c, W, H, '255,215,90', .38 * (1 - t / .22)); }
    };

    /* ---------- Corações ---------- */
    var HEARTS = ['#ff4d79', '#ff2e63', '#ff8fab', '#ffffff', '#ff6b9d'];
    E['x-coracoes'] = {
        init: function (s, R, u) {
            for (var i = 0; i < 36; i++) {
                var p = P(R, u, { min: 0, max: 0, l0: 1.2, l1: 1.75, s0: .45, s1: 1.05, age: -R() * .35 });
                p.vx = (R() - .5) * 10 * u; p.vy = -(2.5 + R() * 8) * u; p.ph = R() * TAU; p.col = HEARTS[Math.floor(R() * HEARTS.length)];
                s.p.push(p);
            }
        },
        draw: function (c, s, t, dt, u) {
            var i, p, f, sc;
            if (t < .7) ring(c, u * (1 + 10 * (1 - Math.pow(1 - t / .7, 3))), u * .3, '#ff8fab', .9 * (1 - t / .7));
            if (t < .4) glow(c, u * (2 + t * 10), 1 - t / .4, '255,200,215', '255,80,130', '255,40,90');
            for (i = 0; i < s.p.length; i++) {
                p = s.p[i]; p.age += dt;
                if (p.age < 0 || p.age >= p.life) continue;
                f = p.age / p.life; move(p, dt, .5);
                sc = p.s * Math.min(1, p.age / .25) * (1 + .06 * Math.sin(p.age * 14));
                c.save(); c.translate(p.x + Math.sin(p.age * 4 + p.ph) * u * .6, p.y); c.rotate(Math.sin(p.age * 3 + p.ph) * .35);
                c.globalAlpha = f < .65 ? 1 : 1 - (f - .65) / .35;
                c.fillStyle = p.col; heart(c, sc);
                c.fill(); c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = sc * .08; c.stroke();
                c.restore();
            }
            c.globalAlpha = 1;
        },
        screen: function (c, t, W, H) { if (t < .25) flash(c, W, H, '255,110,150', .3 * (1 - t / .25)); }
    };

    /* ---------- Cristais de gelo ---------- */
    E['x-gelo'] = {
        init: function (s, R, u) {
            var i;
            for (i = 0; i < 38; i++) s.p.push(P(R, u, { min: 5, max: 20, l0: 1, l1: 1.8, s0: .35, s1: .8 }));
            for (i = 0; i < 26; i++) { var q = P(R, u, { min: .5, max: 6, l0: 1.2, l1: 2, s0: .3, s1: .6, k: 1, age: -R() * .3 }); q.ph = R() * TAU; s.p.push(q); }
        },
        draw: function (c, s, t, dt, u) {
            var i, p, f, e, a;
            if (t < 1) {
                e = 1 - Math.pow(1 - t, 3);
                c.fillStyle = 'rgba(190,235,255,' + (.28 * (1 - t)) + ')'; c.beginPath(); c.arc(0, 0, u * (1 + 14 * e), 0, TAU); c.fill();
                ring(c, u * (1 + 14 * e), u * .45, '#bfeaff', 1 - t);
                ring(c, u * (.5 + 10 * e), u * .15, '#ffffff', .8 * (1 - t));
            }
            c.globalCompositeOperation = 'lighter';
            if (t < .4) glow(c, u * (2 + t * 14), 1 - t / .4, '230,248,255', '120,200,255', '40,120,255');
            c.globalCompositeOperation = 'source-over';
            for (i = 0; i < s.p.length; i++) {
                p = s.p[i]; p.age += dt;
                if (p.age < 0 || p.age >= p.life) continue;
                f = p.age / p.life; move(p, dt, p.k ? .35 : .1);
                c.save(); c.translate(p.x, p.y);
                if (p.k) {   // floco brilhando
                    a = Math.sin(Math.PI * f) * (.6 + .4 * Math.sin(p.ph + p.age * 12));
                    c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(225,245,255,' + a + ')'; c.rotate(p.ph); star4(c, p.s * 1.1); c.fill();
                } else {     // estilhaço: losango alongado na direção do voo
                    c.rotate(p.a); c.globalAlpha = f < .6 ? 1 : 1 - (f - .6) / .4;
                    c.beginPath(); c.moveTo(p.s * 1.6, 0); c.lineTo(0, p.s * .5); c.lineTo(-p.s * 1.1, 0); c.lineTo(0, -p.s * .5); c.closePath();
                    c.fillStyle = 'rgba(200,238,255,.95)'; c.fill(); c.strokeStyle = '#ffffff'; c.lineWidth = p.s * .12; c.stroke();
                }
                c.restore();
            }
            c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        },
        screen: function (c, t, W, H) { if (t < .28) flash(c, W, H, '160,220,255', .5 * (1 - t / .28)); }
    };

    /* ---------- Vórtice ---------- */
    E['x-vortice'] = {
        init: function (s, R, u) {
            for (var i = 0; i < 110; i++) {
                var p = P(R, u, { min: 6, max: 16, l0: 1.3, l1: 1.9, s0: .12, s1: .28 });
                p.a0 = R() * TAU; p.w = (3.2 + R() * 3) * (R() < .85 ? 1 : -1); p.hue = 175 + R() * 135; p.age = -R() * .35;
                s.p.push(p);
            }
        },
        draw: function (c, s, t, dt, u) {
            var i, p, f, r, ang, x, y, px, py, a2;
            c.globalCompositeOperation = 'lighter';
            if (t < 1.3) glow(c, u * (2.4 + Math.sin(t * 9) * .4 + t * 3), Math.max(0, 1 - t / 1.3), '255,255,255', '170,90,255', '60,200,255');
            if (t < .9) { ring(c, u * (1 + 13 * (1 - Math.pow(1 - t / .9, 2))), u * .3, 'rgba(120,230,255,1)', 1 - t / .9); ring(c, u * (.5 + 8 * t / .9), u * .18, 'rgba(210,120,255,1)', .8 * (1 - t / .9)); }
            for (i = 0; i < s.p.length; i++) {
                p = s.p[i]; p.age += dt;
                if (p.age < 0 || p.age >= p.life) continue;
                f = p.age / p.life;
                r = Math.pow(f, .7) * u * 15 * (.45 + p.r * .75);
                ang = p.a0 + p.w * p.age;
                x = Math.cos(ang) * r; y = Math.sin(ang) * r;
                a2 = p.a0 + p.w * (p.age - .045); var r2 = Math.pow(Math.max(0, f - .03), .7) * u * 15 * (.45 + p.r * .75);
                px = Math.cos(a2) * r2; py = Math.sin(a2) * r2;
                c.strokeStyle = 'hsla(' + Math.round(p.hue) + ',100%,65%,' + (1 - f) + ')'; c.lineWidth = p.s * (1 - f * .5); c.lineCap = 'round';
                c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke();
            }
            c.globalCompositeOperation = 'source-over';
        },
        screen: function (c, t, W, H) { if (t < .3) flash(c, W, H, '150,90,255', .4 * (1 - t / .3)); }
    };

    /* ---------- núcleo ---------- */
    function init(g, ball, u) {
        var eff = E[g.fx];
        var R = rng((Math.floor(ball.x * 997) ^ Math.floor(ball.y * 463) ^ 0x9e3779b1) + (g.seed | 0)), s = { x: ball.x, y: ball.y, u: u, last: 0, p: [], id: g.fx };
        eff.init(s, R, u);
        g._fx = s;
        if (FX.onStart && !g.silent) FX.onStart(g, g.fx);
    }
    function drawWorld(c, g, ball, unit) {
        if (!g || !g.fx || !E[g.fx]) return;
        var u = unit > 0 ? unit : 1;
        if (!g._fx) init(g, ball, u);
        var s = g._fx, t = g.t, dt = Math.max(0, Math.min(.1, t - s.last));
        s.last = t;
        c.save();
        c.translate(s.x, s.y);
        E[g.fx].draw(c, s, t, dt, s.u);
        c.restore();
    }
    // clarão rápido na tela inteira (só nos primeiros instantes)
    function drawScreen(c, g, W, H) {
        if (!g || !g.fx || !E[g.fx] || !E[g.fx].screen) return;
        c.save(); E[g.fx].screen(c, g.t, W, H); c.restore();
    }

    /* ---------- pré-visualização (tela Uniforme e painel de admin) ---------- */
    var PV_LEN = 3000, pv = { id: null, t0: 0, g: null, sound: false };
    function preview(c, w, h, id, ts) {
        if (!E[id]) return;
        if (pv.id !== id || ts < pv.t0 || ts - pv.t0 > PV_LEN) {
            var loop = pv.id === id && !pv.force;      // recomeço automático do ciclo: sem som
            pv.id = id; pv.t0 = ts; pv.force = false;
            pv.g = { fx: id, t: 0, seed: Math.floor(Math.random() * 1e9), silent: loop || !pv.sound };
            pv.sound = false;
        }
        var g = pv.g; g.t = (ts - pv.t0) / 1000;
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        var m = Math.min(w, h), u = m / 30, gr = c.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#12361f'); gr.addColorStop(1, '#0b2414');
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(255,255,255,.13)'; c.lineWidth = Math.max(1, u * .25);
        c.beginPath(); c.arc(w / 2, h / 2, m * .28, 0, TAU); c.stroke();
        c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
        drawWorld(c, g, { x: w / 2, y: h / 2 }, u);
        drawScreen(c, g, w, h);
        c.restore();
    }
    // reinicia a animação agora (com som, se withSound — use só a partir de um toque do usuário)
    function replay(withSound) { pv.id = null; pv.force = true; pv.sound = !!withSound; }

    var FX = { drawWorld: drawWorld, drawScreen: drawScreen, onStart: null, preview: preview, replay: replay, has: function (id) { return !!E[id]; }, ids: function () { return Object.keys(E); } };
    window.FH_GOALFX = FX;
})();
