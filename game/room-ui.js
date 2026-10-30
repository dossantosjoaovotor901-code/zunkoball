/* room-ui.js - comportamento só visual da tela da sala: chat recolhível (com bolinha de nova mensagem),
   contador de jogadores e ping ao vivo. Não mexe em regras de jogo nem em rede. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    function pingHtml(ms) {
        if (typeof ms !== 'number' || !isFinite(ms)) return '';
        var v = Math.round(ms), q = v < 80 ? 'good' : v < 150 ? 'mid' : 'bad';
        return 'Ping<b data-q="' + q + '">' + v + '</b>';
    }
    function setPings(map) {
        if (!map) return;
        Object.keys(map).forEach(function (id) {
            var el = document.querySelector('#roomScreen [data-ping-id="' + String(id).replace(/[^0-9A-Za-z_-]/g, '') + '"]');
            if (el) el.innerHTML = pingHtml(map[id]);
        });
    }
    window.FH_ROOMUI = { pingHtml: pingHtml, pings: setPings };

    function init() {
        var panel = $('roomChatPanel'), toggle = $('roomChatToggle'), msgs = $('roomChatMessages'), pill = $('roomCountPill');
        if (toggle && panel) {
            var dot = toggle.querySelector('.rmDot');
            toggle.addEventListener('click', function () {
                panel.hidden = !panel.hidden;
                if (!panel.hidden) { if (dot) dot.hidden = true; var i = $('roomChatInput'); if (i) setTimeout(function () { i.focus(); }, 30); if (msgs) msgs.scrollTop = msgs.scrollHeight; }
            });
            if (msgs) {
                var last = msgs.children.length;
                new MutationObserver(function () {
                    var n = msgs.children.length;
                    if (n > last && panel.hidden && dot) dot.hidden = false;
                    last = n;
                }).observe(msgs, { childList: true });
            }
        }
        if (pill) {
            var count = function () {
                var n = document.querySelectorAll('#roomScreen .rmCard').length;
                pill.textContent = '\uD83D\uDC65 ' + n;
            };
            ['redList', 'blueList', 'spectatorList'].forEach(function (id) {
                var el = $(id); if (el) new MutationObserver(count).observe(el, { childList: true });
            });
            count();
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
