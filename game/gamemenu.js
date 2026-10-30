/* FutHub - menu lateral da partida + modo de edição do HUD.
   Depende de game.js (ids: gameSettings, joyX/joyY/kickX/kickY/passX/passY, hudOpacity...). */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var game = $('game'), drawer = $('gameSettings');
    if (!game || !drawer) return;

    var ICON = {
        save: 'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z',
        redo: 'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
        ok: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
        x: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
    };
    function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

    /* =====================================================
       MENU LATERAL
       ===================================================== */
    var views = drawer.querySelectorAll('.gmView');
    var title = $('gmTitle'), back = $('gmBack');

    function showView(id) {
        Array.prototype.forEach.call(views, function (v) { v.hidden = v.id !== id; });
        var v = $(id);
        title.textContent = v.dataset.title || 'Menu';
        back.hidden = id === 'gmMain';
        drawer.querySelector('.gmBody').scrollTop = 0;
    }
    function closeMenu() { drawer.classList.add('hidden'); }
    function refreshMain() {
        var p = $('pauseGame'), pi = $('gmPause');
        if (p && pi) pi.querySelector('.gmLbl').textContent = /continuar/i.test(p.title || '') ? 'Continuar partida' : 'Pausar partida';
        var chat = $('gameChat');
        $('gmChat').hidden = !chat || chat.classList.contains('chatDisabled');
        var rk = !!(window.FH_RANKED && FH_RANKED.active());
        $('gmTeams').hidden = rk;
        var cl = $('gmCopyLink'); if (cl) cl.hidden = rk || !(window.FH_ONLINE && FH_ONLINE.roomLink && FH_ONLINE.roomLink());
        $('gmRestart').querySelector('.gmLbl').textContent = rk ? 'Abandonar partida' : 'Reiniciar partida';
    }
    Array.prototype.forEach.call(drawer.querySelectorAll('[data-go]'), function (b) {
        b.addEventListener('click', function () { showView(b.dataset.go); });
    });
    back.addEventListener('click', function () { showView('gmMain'); });
    $('gameSettingsBtn').addEventListener('click', function () {
        // o handler do game.js já alternou "hidden"; aqui só preparamos a tela inicial
        if (!drawer.classList.contains('hidden')) { showView('gmMain'); refreshMain(); }
    });
    $('gmPause').addEventListener('click', function () { $('pauseGame').click(); closeMenu(); });
    $('gmTeams').addEventListener('click', function () { closeMenu(); $('pause').click(); });
    $('gmRestart').addEventListener('click', function () {
        closeMenu();
        if (window.FH_RANKED && FH_RANKED.active()) $('back').click(); else $('exit').click();
    });
    $('gmCopyLink').addEventListener('click', function () {
        var link = window.FH_ONLINE && FH_ONLINE.roomLink && FH_ONLINE.roomLink();
        closeMenu();
        if (!link) return;
        var done = function () { if (typeof toast === 'function') toast('Link da sala copiado!'); };
        var fallback = function () {
            var t = document.createElement('textarea'); t.value = link; t.style.cssText = 'position:fixed;opacity:0;left:-999px';
            document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { if (typeof toast === 'function') toast(link); }
            document.body.removeChild(t);
        };
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(link).then(done, fallback); return; } } catch (e) {}
        fallback();
    });
    $('gmChat').addEventListener('click', function () { closeMenu(); var t = $('gameChatToggle'); if (t) t.click(); });
    $('gmEdit').addEventListener('click', function () { closeMenu(); startEdit(); });

    /* =====================================================
       MODO DE EDIÇÃO
       ===================================================== */
    var KEY = 'fh_hud_layouts_v2', OLD = 'fh_hud_edit_v1';
    var ITEMS = [
        { id: 'zone', label: 'Zona do analógico', el: 'joyZone', min: 1.2, max: 5, def: 2.6, noOpa: true },
        { id: 'joy', label: 'Analógico', el: 'joy', min: .5, max: 1.6 },
        { id: 'kick', label: 'Chute', el: 'kick', min: .4, max: 1.8 },
        { id: 'pass', label: 'Passe', el: 'pass', min: .4, max: 1.8 },
        { id: 'chat', label: 'Chat', el: 'gameChat', min: .5, max: 1.6 }
    ];
    var POS = { zone: ['joyX', 'joyY'], joy: ['joyX', 'joyY'], kick: ['kickX', 'kickY'], pass: ['passX', 'passY'] };
    var DEFPOS = { joyX: 10, joyY: 70, kickX: 80, kickY: 78, passX: 75, passY: 40 };
    var cfg = loadCfg(), layouts = loadLayouts();
    var editing = false, selected = null, drag = null, startSnap = null, raf = 0, toastTimer = 0;
    var boxes = {}, chatWasOff = false;

    function defCfg(id) { return { s: (item(id) || {}).def || 1, o: 1 }; }
    function item(id) { return ITEMS.filter(function (i) { return i.id === id; })[0]; }
    function orient() { return window.matchMedia('(orientation: portrait)').matches ? 'port' : 'land'; }
    function other() { return orient() === 'port' ? 'land' : 'port'; }
    function loadCfg() {
        var c = {};
        try { c = JSON.parse(localStorage.getItem(OLD) || '{}') || {}; } catch (e) { c = {}; }
        ITEMS.forEach(function (it) { c[it.id] = Object.assign(defCfg(it.id), c[it.id] || {}); });
        return c;
    }
    function loadLayouts() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function persist() { try { localStorage.setItem(KEY, JSON.stringify(layouts)); localStorage.setItem(OLD, JSON.stringify(cfg)); } catch (e) {} }

    function snapshot() {
        var pos = {};
        Object.keys(DEFPOS).forEach(function (k) { var el = $(k); pos[k] = el ? +el.value : DEFPOS[k]; });
        return { pos: pos, cfg: JSON.parse(JSON.stringify(cfg)) };
    }
    function pushToGame() {
        var s = $('hudOpacity');
        if (s) s.dispatchEvent(new Event('input'));   // game.js reaplica e salva o HUD
    }
    function restore(snap) {
        Object.keys(snap.pos).forEach(function (k) { var el = $(k); if (el) el.value = snap.pos[k]; });
        ITEMS.forEach(function (it) { cfg[it.id] = Object.assign(defCfg(it.id), snap.cfg[it.id] || {}); });
        applyCfg();
        pushToGame();
        clampChat();
    }
    function applyCfg() {
        ITEMS.forEach(function (it) {
            var el = $(it.el), c = cfg[it.id];
            if (!el) return;
            el.style.setProperty('--fh-s', c.s);
            el.style.setProperty('--fh-o', c.o);
            if (it.id === 'chat') {
                var has = c.x != null;
                el.classList.toggle('fhPos', has);
                if (has) { el.style.setProperty('--fh-cx', c.x + 'px'); el.style.setProperty('--fh-cy', c.y + 'px'); }
                else { el.style.removeProperty('--fh-cx'); el.style.removeProperty('--fh-cy'); }
            }
        });
    }
    function clampChat() {
        var chat = $('gameChat'), c = cfg.chat;
        if (!chat || c.x == null) return;
        var r = chat.getBoundingClientRect(), W = game.clientWidth, H = game.clientHeight;
        if (!r.width) return;
        c.x = Math.max(0, Math.min(W - Math.min(r.width, W), c.x));
        c.y = Math.max(0, Math.min(H - Math.min(r.height, H), c.y));
        applyCfg();
    }

    /* =====================================================
       ZONA DO ANALÓGICO (analógico flutuante)
       ===================================================== */
    var JKEY = 'fh_joy_zone_v1';
    var jset = { zone: true, showZone: true, showStick: true, touchShow: true, fixed: false };
    try { Object.assign(jset, JSON.parse(localStorage.getItem(JKEY) || '{}') || {}); } catch (e) {}
    var joy = $('joy'), zoneEl = document.createElement('div'), floating = null;
    zoneEl.id = 'joyZone'; zoneEl.className = 'joyZone'; zoneEl.hidden = true;
    game.insertBefore(zoneEl, joy);

    function zoneOn() { return jset.zone || !jset.showStick; }
    function joyAvailable() { return getComputedStyle(joy).display !== 'none'; }
    function saveJset() { try { localStorage.setItem(JKEY, JSON.stringify(jset)); } catch (e) {} }
    function applyMode() {
        var ghost = !jset.showStick && !(floating && jset.touchShow) && !editing;
        joy.classList.toggle('joyGhost', ghost);
        zoneEl.classList.toggle('vis', !!jset.showZone);
        var m = { zoneEnabled: zoneOn(), zoneShow: jset.showZone, joyFixed: jset.fixed, joyShow: jset.showStick, joyTouchShow: jset.touchShow };
        Object.keys(m).forEach(function (k) { var el = $(k); if (el) el.checked = !!m[k]; });
        if ($('zoneEnabled')) $('zoneEnabled').disabled = !jset.showStick;
        if ($('joyTouchShow')) $('joyTouchShow').disabled = jset.showStick;
    }
    function updateZone() {
        var on = (zoneOn() && joyAvailable()) || (editing && joyAvailable());
        zoneEl.hidden = !on;
        if (!on || floating) return;
        var g = game.getBoundingClientRect(), r = joy.getBoundingClientRect();
        if (!r.width) return;
        var w = r.width * cfg.zone.s, h = r.height * cfg.zone.s;
        var cx = r.left - g.left + r.width / 2, cy = r.top - g.top + r.height / 2;
        var l = Math.max(0, cx - w / 2), t = Math.max(0, cy - h / 2);
        var rr = Math.min(g.width, cx + w / 2), bb = Math.min(g.height, cy + h / 2);
        zoneEl.style.left = l + 'px'; zoneEl.style.top = t + 'px';
        zoneEl.style.width = Math.max(0, rr - l) + 'px'; zoneEl.style.height = Math.max(0, bb - t) + 'px';
    }
    function joyHome() {
        joy.style.left = $('joyX').value + '%';
        joy.style.top = $('joyY').value + '%';
    }
    function joyTo(x, y) {
        var g = game.getBoundingClientRect(), r = joy.getBoundingClientRect();
        var px = Math.max(r.width / 2, Math.min(g.width - r.width / 2, x - g.left));
        var py = Math.max(r.height / 2, Math.min(g.height - r.height / 2, y - g.top));
        joy.style.left = (px / g.width * 100) + '%';
        joy.style.top = (py / g.height * 100) + '%';
    }
    function endFloat(e) {
        if (!floating || (e && e.pointerId != null && e.pointerId !== floating.id)) return;
        floating = null; joyHome(); applyMode();
    }
    zoneEl.addEventListener('pointerdown', function (e) {
        if (editing || !zoneOn() || floating || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        floating = { id: e.pointerId };
        if (!jset.fixed) joyTo(e.clientX, e.clientY);   // fixo: o analógico não sai do lugar, só lê a direção do toque
        applyMode();
        joy.dispatchEvent(new PointerEvent('pointerdown', { pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
            clientX: e.clientX, clientY: e.clientY, button: 0, buttons: 1, bubbles: true, cancelable: true }));
    });
    zoneEl.addEventListener('pointermove', function (e) {
        if (!floating || e.pointerId !== floating.id) return;
        joy.dispatchEvent(new PointerEvent('pointermove', { pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
            clientX: e.clientX, clientY: e.clientY, buttons: 1, bubbles: true, cancelable: true }));
    });
    addEventListener('pointerup', endFloat, true);
    addEventListener('pointercancel', endFloat, true);
    addEventListener('blur', function () { endFloat(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) endFloat(); });

    [['zoneEnabled', 'zone'], ['zoneShow', 'showZone'], ['joyFixed', 'fixed'], ['joyShow', 'showStick'], ['joyTouchShow', 'touchShow']].forEach(function (p) {
        var el = $(p[0]); if (!el) return;
        el.addEventListener('change', function () { jset[p[1]] = el.checked; saveJset(); applyMode(); updateZone(); });
    });
    applyMode();
    setInterval(function () { if (!editing) updateZone(); }, 300);

    // layout salvo para a orientação atual (deitado / em pé são independentes)
    applyCfg();
    if (layouts[orient()]) restore(layouts[orient()]);
    var lastOrient = orient();
    function onOrient() {
        var o = orient();
        if (o === lastOrient) { clampChat(); updateZone(); return; }
        lastOrient = o;
        if (editing) stopEdit(false);
        if (layouts[o]) restore(layouts[o]);
    }
    addEventListener('resize', onOrient);
    addEventListener('orientationchange', function () { setTimeout(onOrient, 120); });

    /* ---- interface ---- */
    var root = document.createElement('div');
    root.id = 'fhEdit';
    root.innerHTML =
        '<div class="fhDim"></div>' +
        '<button type="button" class="fhBtn fhSave" aria-label="Salvar layout" title="Salvar layout">' + svg(ICON.save) + '</button>' +
        '<button type="button" class="fhBtn fhReset" aria-label="Restaurar padrão" title="Restaurar padrão">' + svg(ICON.redo) + '</button>' +
        '<button type="button" class="fhBtn ok fhOk" aria-label="Salvar e sair" title="Salvar e sair">' + svg(ICON.ok) + '</button>' +
        '<button type="button" class="fhBtn fhCancel" aria-label="Sair sem salvar" title="Sair sem salvar">' + svg(ICON.x) + '</button>' +
        '<div class="fhToast" role="status"></div>' +
        '<div class="fhPanel" hidden>' +
        '<div class="fhPanelHead"><b></b><button type="button" class="fhItemReset">Padrão</button></div>' +
        '<label class="fhRow">Tamanho<input class="fhSize" type="range" step="0.01"><output class="fhSizeVal"></output></label>' +
        '<label class="fhRow">Opacidade<input class="fhOpa" type="range" min="0.15" max="1" step="0.01"><output class="fhOpaVal"></output></label>' +
        '</div>';
    game.appendChild(root);
    var toast = root.querySelector('.fhToast'), panel = root.querySelector('.fhPanel');
    var size = root.querySelector('.fhSize'), opa = root.querySelector('.fhOpa');

    ITEMS.forEach(function (it) {
        var b = document.createElement('div');
        b.className = 'fhBox'; b.dataset.item = it.id;
        b.innerHTML = '<span class="fhTag">' + it.label + '</span>';
        b.addEventListener('pointerdown', function (e) { startDrag(e, it.id); });
        b.addEventListener('pointermove', moveDrag);
        b.addEventListener('pointerup', endDrag);
        b.addEventListener('pointercancel', endDrag);
        root.insertBefore(b, root.querySelector('.fhBtn'));
        boxes[it.id] = b;
    });
    // nada do que acontece na edição deve vazar para o jogo
    ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'click'].forEach(function (t) {
        root.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    root.querySelector('.fhDim').addEventListener('pointerdown', function (e) { e.preventDefault(); select(null); });

    function say(msg, ms) {
        clearTimeout(toastTimer);
        toast.textContent = msg;
        if (ms) toastTimer = setTimeout(defaultHint, ms);
    }
    function defaultHint() {
        say(orient() === 'land'
            ? 'HUD deitado (o em pé é outro) · toque num controle para editar'
            : 'HUD em pé (o deitado é outro) · toque num controle para editar');
    }

    function select(id) {
        selected = id;
        Object.keys(boxes).forEach(function (k) { boxes[k].classList.toggle('sel', k === id); });
        toast.hidden = !!id;
        panel.hidden = !id;
        if (!id) { defaultHint(); return; }
        var it = item(id), c = cfg[id];
        panel.querySelector('b').textContent = it.label;
        size.min = it.min; size.max = it.max; size.value = c.s;
        opa.value = c.o;
        opa.parentNode.hidden = !!it.noOpa;
        refreshVals();
    }
    function refreshVals() {
        var c = cfg[selected]; if (!c) return;
        root.querySelector('.fhSizeVal').textContent = Math.round(c.s * 100) + '%';
        root.querySelector('.fhOpaVal').textContent = Math.round(c.o * 100) + '%';
    }
    size.addEventListener('input', function () { cfg[selected].s = +size.value; applyCfg(); refreshVals(); clampChat(); });
    opa.addEventListener('input', function () { cfg[selected].o = +opa.value; applyCfg(); refreshVals(); });
    root.querySelector('.fhItemReset').addEventListener('click', function () {
        var id = selected; if (!id) return;
        cfg[id] = defCfg(id);
        if (id === 'chat') { delete cfg.chat.x; delete cfg.chat.y; }
        else { POS[id].forEach(function (k, i) { $(k).value = DEFPOS[k]; }); pushToGame(); }
        applyCfg(); select(id);
    });
    root.querySelector('.fhReset').addEventListener('click', function () {
        ITEMS.forEach(function (it) { cfg[it.id] = defCfg(it.id); });
        Object.keys(DEFPOS).forEach(function (k) { $(k).value = DEFPOS[k]; });
        applyCfg(); pushToGame(); select(null);
        say('Controles restaurados ao padrão', 1600);
    });
    function commit() { layouts[orient()] = snapshot(); persist(); }
    root.querySelector('.fhSave').addEventListener('click', function () { commit(); say('Layout salvo', 1400); });
    root.querySelector('.fhOk').addEventListener('click', function () { stopEdit(true); });
    root.querySelector('.fhCancel').addEventListener('click', function () { stopEdit(false); });

    /* ---- arrastar ---- */
    function startDrag(e, id) {
        e.preventDefault();
        select(id);
        var el = $(item(id).el), r = el.getBoundingClientRect();
        drag = { id: id, pid: e.pointerId, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2),
                 ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height };
        try { boxes[id].setPointerCapture(e.pointerId); } catch (err) {}
    }
    function moveDrag(e) {
        if (!drag || e.pointerId !== drag.pid) return;
        e.preventDefault();
        var g = game.getBoundingClientRect();
        if (drag.id === 'chat') {
            var c = cfg.chat;
            c.x = Math.round(Math.max(0, Math.min(g.width - drag.w, e.clientX - g.left - drag.ox)));
            c.y = Math.round(Math.max(0, Math.min(g.height - drag.h, e.clientY - g.top - drag.oy)));
            applyCfg();
            return;
        }
        var zn = drag.id === 'zone';
        var hx = (zn ? 40 : Math.max(24, drag.w / 2)) / g.width * 100, hy = (zn ? 40 : Math.max(24, drag.h / 2)) / g.height * 100;
        var x = Math.max(hx, Math.min(100 - hx, (e.clientX - drag.dx - g.left) / g.width * 100));
        var y = Math.max(hy, Math.min(100 - hy, (e.clientY - drag.dy - g.top) / g.height * 100));
        var k = POS[drag.id];
        $(k[0]).value = x.toFixed(1); $(k[1]).value = y.toFixed(1);
        pushToGame();
    }
    function endDrag(e) { if (drag && e.pointerId === drag.pid) drag = null; }

    /* ---- posiciona as caixas tracejadas sobre os controles ---- */
    function layoutBoxes() {
        if (!editing) return;
        updateZone();
        var g = game.getBoundingClientRect(), pad = 6, selRect = null;
        ITEMS.forEach(function (it) {
            var el = $(it.el), b = boxes[it.id];
            var visible = false, r = null;
            if (el) {
                var cs = getComputedStyle(el);
                r = el.getBoundingClientRect();
                visible = cs.display !== 'none' && r.width > 4 && r.height > 4;
            }
            b.hidden = !visible;
            if (!visible) return;
            b.style.left = (r.left - g.left - pad) + 'px';
            b.style.top = (r.top - g.top - pad) + 'px';
            b.style.width = (r.width + pad * 2) + 'px';
            b.style.height = (r.height + pad * 2) + 'px';
            b.classList.toggle('tagIn', r.top - g.top < 30);
            if (it.id === selected) selRect = r;
        });
        if (selRect) panel.classList.toggle('low', (selRect.top + selRect.height / 2 - g.top) < g.height * .42);
        raf = requestAnimationFrame(layoutBoxes);
    }

    /* ---- entrar / sair ---- */
    function startEdit() {
        if (editing) return;
        editing = true;
        endFloat(); applyMode();
        startSnap = snapshot();
        // primeira edição nesta orientação: guarda o estado atual como base da outra
        if (!layouts[other()]) layouts[other()] = JSON.parse(JSON.stringify(startSnap));
        var chat = $('gameChat');
        chatWasOff = !!chat && chat.classList.contains('chatDisabled');
        if (chat) chat.classList.remove('chatDisabled');
        game.classList.add('fhEditing');
        root.classList.add('on');
        select(null);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(layoutBoxes);
    }
    function stopEdit(save) {
        if (!editing) return;
        editing = false;
        cancelAnimationFrame(raf);
        drag = null;
        if (save) commit(); else if (startSnap) restore(startSnap);
        // o chat volta ao estado definido nas configurações
        var chat = $('gameChat');
        if (chat && chatWasOff) chat.classList.add('chatDisabled');
        game.classList.remove('fhEditing');
        root.classList.remove('on');
        startSnap = null;
        applyMode(); updateZone();
    }

    addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (editing) { e.stopPropagation(); stopEdit(false); }
        else if (!drawer.classList.contains('hidden')) {
            if (!back.hidden) showView('gmMain'); else closeMenu();
        }
    }, true);
})();
