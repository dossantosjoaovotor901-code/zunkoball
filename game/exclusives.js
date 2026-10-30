/* Itens exclusivos (dados pelo painel de admin): uniformes e efeitos de gol.
   O servidor decide o que cada conta tem; aqui ficam só as aparências e a seleção do que está equipado.
   Para criar um item novo: server/exclusives.js (catálogo) + aqui (aparência) + game/goalfx.js (se for efeito). */
(function () {
    'use strict';
    var K = function (id, name, pattern, base, accent, text, stroke) {
        return { id: id, name: name, exclusive: true, pattern: pattern, base: base, accent: accent, text: text, textStroke: stroke || 'rgba(0,0,0,.9)' };
    };
    var KITS = {
        'x-zk-gold':    K('x-zk-gold', 'ZK Gold', 'speed', '#0f0f10', '#FFB400', '#FFB400'),
        'x-zk-neon':    K('x-zk-neon', 'ZK Neon', 'hoops', '#0b0b14', '#22d3ee', '#22d3ee'),
        'x-zk-fire':    K('x-zk-fire', 'ZK Fogo', 'gradient', '#7f1d1d', '#fde047', '#ffffff'),
        'x-zk-galaxy':  K('x-zk-galaxy', 'ZK Galáxia', 'dots', '#1e1b4b', '#a78bfa', '#e9d5ff'),
        'x-zk-ice':     K('x-zk-ice', 'ZK Gelo', 'gradient', '#0ea5e9', '#e0f2fe', '#082f49', 'rgba(255,255,255,.9)'),
        'x-zk-royal':   K('x-zk-royal', 'ZK Real', 'halves', '#4c1d95', '#FFB400', '#ffffff'),
        'x-zk-toxic':   K('x-zk-toxic', 'ZK Tóxico', 'speed', '#0a0a0a', '#84cc16', '#84cc16'),
        'x-zk-sakura':  K('x-zk-sakura', 'ZK Sakura', 'dots', '#fbcfe8', '#ec4899', '#831843', 'rgba(255,255,255,.9)'),
        'x-zk-diamond': K('x-zk-diamond', 'ZK Diamante', 'checker', '#0f172a', '#38bdf8', '#e0f2fe'),
        'x-zk-carbon':  K('x-zk-carbon', 'ZK Carbono', 'sash', '#18181b', '#a1a1aa', '#ffffff')
    };
    // a, b = cores do cartão (degradê); icon = emoji
    var FX = {
        'x-explosao': { id: 'x-explosao', name: 'Explosão', icon: '💥', a: '#ff9a1f', b: '#b3270b' },
        'x-confete':  { id: 'x-confete', name: 'Confete', icon: '🎉', a: '#ff4d6d', b: '#4cc9f0' },
        'x-fogos':    { id: 'x-fogos', name: 'Fogos de artifício', icon: '🎆', a: '#7c3aed', b: '#0f172a' },
        'x-raio':     { id: 'x-raio', name: 'Raio', icon: '⚡', a: '#60a5fa', b: '#1e1b4b' },
        'x-moedas':   { id: 'x-moedas', name: 'Chuva de moedas', icon: '🪙', a: '#ffc931', b: '#a86a00' },
        'x-coracoes': { id: 'x-coracoes', name: 'Corações', icon: '💖', a: '#ff4d79', b: '#7a1236' },
        'x-gelo':     { id: 'x-gelo', name: 'Cristais de gelo', icon: '❄️', a: '#bfeaff', b: '#2563eb' },
        'x-vortice':  { id: 'x-vortice', name: 'Vórtice', icon: '🌀', a: '#22d3ee', b: '#a855f7' }
    };
    var st = { items: [], equipped: { kit: null, fx: null } };

    function setState(info) {
        st = { items: (info && info.items) || [], equipped: (info && info.equipped) || { kit: null, fx: null } };
    }
    function meta(id) { for (var i = 0; i < st.items.length; i++) if (st.items[i].id === id) return st.items[i]; return null; }
    function withItem(spec) {
        var it = meta(spec.id);
        return Object.assign({}, spec, it ? { name: it.name, rarity: it.rarity, desc: it.desc } : {});
    }
    var X = {
        onChange: null,
        set: function (info) {
            setState(info);
            if (X.onChange) X.onChange();
        },
        owns: function (id) { return !!meta(id); },
        kitSpec: function (id) { return KITS[id] || null; },
        fxSpec: function (id) { return FX[id] || null; },
        ownedKits: function () {
            return st.items.filter(function (i) { return i.kind === 'kit' && KITS[i.id]; }).map(function (i) { return withItem(KITS[i.id]); });
        },
        ownedFx: function () {
            return st.items.filter(function (i) { return i.kind === 'fx' && FX[i.id]; }).map(function (i) { return withItem(FX[i.id]); });
        },
        allKits: function () { return Object.keys(KITS).map(function (k) { return KITS[k]; }); },
        allFx: function () { return Object.keys(FX).map(function (k) { return FX[k]; }); },
        // busca de novo o que a conta tem (para o cadeado abrir assim que o admin liberar)
        refresh: function () {
            return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
                if (j && j.user) setState(j.user.excl);
            }).catch(function () {});
        },
        equipped: function (slot) { return st.equipped[slot] || null; },
        equip: function (slot, id) {
            st.equipped[slot] = id || null;         // otimista: a tela já responde
            return fetch('/api/exclusives/equip', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: slot, id: id || null })
            }).then(function (r) { return r.json(); }).then(function (j) {
                if (j && j.excl) setState(j.excl);
            }).catch(function () {});
        }
    };
    window.FH_EXCL = X;
})();
