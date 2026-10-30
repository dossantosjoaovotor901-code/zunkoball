/* orient.js - aviso para não jogar na vertical. Tocar na tela entra em tela cheia e tenta travar na horizontal. */
(function () {
    'use strict';
    function goFull() {
        var el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
        var lock = function () { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {} };
        try {
            if (req && !(document.fullscreenElement || document.webkitFullscreenElement)) {
                var p = req.call(el, { navigationUI: 'hide' });
                if (p && p.then) p.then(lock).catch(function () {}); else lock();
            } else lock();
        } catch (e) { lock(); }
    }
    function init() {
        var w = document.getElementById('orientWarn');
        if (!w) return;
        w.addEventListener('click', goFull);
        w.addEventListener('touchend', function (e) { e.preventDefault(); goFull(); }, { passive: false });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
