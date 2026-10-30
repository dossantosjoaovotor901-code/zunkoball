/* theme-custom.js - tema do jogo inteiro: cor de destaque, fundo (ondulado/liso/degradê), intensidade e opacidade dos painéis.
   Salva em localStorage ('fh_theme') e aplica na hora via variáveis CSS (ver theme-dark.css). */
(function () {
    'use strict';
    var KEY = 'fh_theme';
    var DEF = { accent: '#F6B800', bg: '#09090c', wc: '#2a2a33', mode: 'wave', wave: 100, panel: 90, v: 2 };
    var ACCENTS = [['Dourado', '#F6B800'], ['Azul', '#2f8cf0'], ['Verde', '#2fd45a'], ['Vermelho', '#ee4747'], ['Roxo', '#a56bff'], ['Rosa', '#ff5fa2'], ['Laranja', '#ff8a1f'], ['Ciano', '#22d3ee']];
    var BGS = [['Preto', '#09090c', '#2a2a33'], ['Grafite', '#14161a', '#2f333a'], ['Azul-noite', '#0a1020', '#1b2d54'], ['Verde-escuro', '#08150d', '#17402a'], ['Vinho', '#1a0a10', '#4a1a2a'], ['Roxo-escuro', '#120a1f', '#32205a']];
    var WCS = [['Cinza', '#2a2a33'], ['Azul', '#1b2d54'], ['Verde', '#17402a'], ['Vinho', '#4a1a2a'], ['Roxo', '#32205a'], ['Dourado', '#4a3a10'], ['Claro', '#8a8a94']];
    var S = load();

    function load() {
        var t = {}, k;
        try { t = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { t = {}; }
        if (t.v !== 2) { t.wave = DEF.wave; t.wc = DEF.wc; t.v = 2; }          // versão antiga: ondas eram só branco quase transparente
        for (k in DEF) if (t[k] == null) t[k] = DEF[k];
        return t;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
    function hex2rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); var n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function rgb2hsl(r, g, b) {
        r /= 255; g /= 255; b /= 255; var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
        if (d) { s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
        return [h, s, l];
    }
    function hsl(h, s, l) { return 'hsl(' + Math.round(h) + ',' + Math.round(s * 100) + '%,' + Math.round(Math.max(0, Math.min(1, l)) * 100) + '%)'; }
    function mix(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] * (1 - t) + b[i] * t); }); }
    function css(c) { return 'rgb(' + c.join(',') + ')'; }

    function apply() {
        var root = document.documentElement, st = root.style, c = hex2rgb(S.accent), h = rgb2hsl(c[0], c[1], c[2]);
        var sat = Math.max(h[1], .55);
        st.setProperty('--ac2', S.accent);
        st.setProperty('--ac2-rgb', c.join(', '));
        st.setProperty('--ac1', hsl(h[0], Math.min(1, sat), Math.min(.82, h[2] + .22)));
        st.setProperty('--ac3', hsl(h[0], sat, h[2] * .68));
        st.setProperty('--ac-edge', hsl(h[0], sat * .9, Math.min(h[2], .5) * .45));
        st.setProperty('--ac-muted', hsl(h[0], Math.min(sat, .6), .7));
        st.setProperty('--ac-ink', hsl(h[0], 1, .08));
        var b = hex2rgb(S.bg);
        st.setProperty('--bgc', S.bg);
        st.setProperty('--wave-c', S.wc);
        st.setProperty('--bgc2', S.wc);
        st.setProperty('--wave-a', (S.wave / 100).toFixed(2));
        st.setProperty('--panel-a', (S.panel / 100).toFixed(2));
        if (document.body) document.body.setAttribute('data-bgmode', S.mode);
        var m = document.querySelector('meta[name=theme-color]');
        if (m) m.setAttribute('content', S.bg);
    }
    apply();

    function init() {
        document.body.setAttribute('data-bgmode', S.mode);
        var box = document.getElementById('themeBox'); if (!box) return;
        var $ = function (id) { return document.getElementById(id); };
        function swatches(el, list, key) {
            el.innerHTML = '';
            list.forEach(function (p) {
                var b = document.createElement('button'); b.type = 'button'; b.title = p[0]; b.setAttribute('aria-label', p[0]);
                b.style.background = p[1]; b.dataset.v = p[1];
                b.addEventListener('click', function () { S[key] = p[1]; if (key === 'bg' && p[2]) S.wc = p[2]; save(); apply(); sync(); });
                el.appendChild(b);
            });
        }
        function sync() {
            [['themeAccents', 'accent'], ['themeBgs', 'bg'], ['themeWcs', 'wc']].forEach(function (x) {
                $(x[0]).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v.toLowerCase() === String(S[x[1]]).toLowerCase()); });
            });
            $('themeAccent').value = S.accent; $('themeBg').value = S.bg; $('themeWc').value = S.wc; $('themeMode').value = S.mode;
            $('themeWave').value = S.wave; $('themePanel').value = S.panel;
            $('themeWcRow').style.display = $('themeWaveRow').style.display = S.mode === 'wave' ? '' : 'none';
        }
        swatches($('themeAccents'), ACCENTS, 'accent'); swatches($('themeBgs'), BGS, 'bg'); swatches($('themeWcs'), WCS, 'wc');
        $('themeAccent').addEventListener('input', function () { S.accent = this.value; save(); apply(); sync(); });
        $('themeBg').addEventListener('input', function () { S.bg = this.value; save(); apply(); sync(); });
        $('themeWc').addEventListener('input', function () { S.wc = this.value; save(); apply(); sync(); });
        $('themeMode').addEventListener('change', function () { S.mode = this.value; save(); apply(); sync(); });
        $('themeWave').addEventListener('input', function () { S.wave = +this.value; save(); apply(); });
        $('themePanel').addEventListener('input', function () { S.panel = +this.value; save(); apply(); });
        $('themeReset').addEventListener('click', function () { for (var k in DEF) S[k] = DEF[k]; save(); apply(); sync(); });
        sync();
    }
    window.FH_THEME = { get: function () { return S; }, apply: apply };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
