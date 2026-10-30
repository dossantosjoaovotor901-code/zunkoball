/* FutHub - janelas de aviso dentro do jogo (substituem confirm/alert/prompt do navegador).
   fhConfirm(msg, {ok, cancel, danger}) -> Promise<boolean>
   fhAlert(msg, {ok})                    -> Promise<void>
   fhPrompt(msg, {ok, cancel, password}) -> Promise<string|null> */
(function () {
    'use strict';
    var queue = [], current = null;
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function next() {
        if (current || !queue.length) return;
        var d = queue.shift();
        var root = el('div', 'fhDlg'), card = el('div', 'fhDlgCard');
        card.setAttribute('role', d.kind === 'alert' ? 'alertdialog' : 'dialog'); card.setAttribute('aria-modal', 'true');
        card.appendChild(el('p', 'fhDlgMsg', d.msg));
        var input = null;
        if (d.kind === 'prompt') {
            input = el('input', 'fhDlgInput'); input.type = d.password ? 'password' : 'text'; input.autocomplete = 'off';
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } });
            card.appendChild(input);
        }
        var row = el('div', 'fhDlgBtns');
        var okB = el('button', 'fhDlgBtn ok' + (d.danger ? ' danger' : ''), d.ok); okB.type = 'button';
        var noB = null;
        if (d.kind !== 'alert') { noB = el('button', 'fhDlgBtn no', d.cancel); noB.type = 'button'; row.appendChild(noB); }
        row.appendChild(okB); card.appendChild(row); root.appendChild(card);
        function finish(v) {
            if (!current) return;
            document.removeEventListener('keydown', onKey, true);
            root.remove(); current = null;
            d.resolve(v);
            next();
        }
        function cancelVal() { return d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined; }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(cancelVal()); }
            else if (e.key === 'Enter' && d.kind !== 'prompt') { e.preventDefault(); e.stopPropagation(); finish(d.kind === 'confirm' ? true : undefined); }
        }
        okB.onclick = function () { finish(d.kind === 'confirm' ? true : d.kind === 'prompt' ? input.value : undefined); };
        if (noB) noB.onclick = function () { finish(cancelVal()); };
        root.addEventListener('pointerdown', function (e) { if (e.target === root && d.kind !== 'alert') finish(cancelVal()); });
        document.addEventListener('keydown', onKey, true);
        current = root; document.body.appendChild(root);
        (input || okB).focus();
    }
    function open(kind, msg, o) {
        o = o || {};
        return new Promise(function (resolve) {
            queue.push({ kind: kind, msg: String(msg), ok: o.ok || 'OK', cancel: o.cancel || 'Cancelar', danger: !!o.danger, password: !!o.password, resolve: resolve });
            next();
        });
    }
    window.fhConfirm = function (msg, o) { return open('confirm', msg, o); };
    window.fhAlert = function (msg, o) { return open('alert', msg, o); };
    window.fhPrompt = function (msg, o) { return open('prompt', msg, o); };
})();
