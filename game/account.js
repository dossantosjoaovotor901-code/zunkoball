/* FutHub - conta, ranqueada e ranking (cliente). Fala com a API em /api/* (server.js). */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };

    var FALLBACK_MODES = [
        { id: 'v1', label: 'Futsal 1v1', group: 'futsal', requiredPlayers: 2, teamSize: 1, timeLimit: 5, scoreLimit: 5 },
        { id: 'v2', label: 'Futsal 2v2', group: 'futsal', requiredPlayers: 4, teamSize: 2, timeLimit: 5, scoreLimit: 5 },
        { id: 'v3', label: 'Futsal 3v3', group: 'futsal', requiredPlayers: 6, teamSize: 3, timeLimit: 5, scoreLimit: 5 },
        { id: 'v4', label: 'Futsal 4v4', group: 'futsal', requiredPlayers: 8, teamSize: 4, timeLimit: 5, scoreLimit: 5 },
        { id: 'r4', label: 'Real 4v4', group: 'real', requiredPlayers: 8, teamSize: 4, timeLimit: 6, scoreLimit: 10 },
        { id: 'r5', label: 'Real 5v5', group: 'real', requiredPlayers: 10, teamSize: 5, timeLimit: 6, scoreLimit: 10 },
        { id: 'r7', label: 'Real 7v7', group: 'real', requiredPlayers: 14, teamSize: 7, timeLimit: 6, scoreLimit: 10 },
        { id: 'r9', label: 'Real 9v9', group: 'real', requiredPlayers: 18, teamSize: 9, timeLimit: 6, scoreLimit: 10 },
        { id: 'r11', label: 'Real 11v11', group: 'real', requiredPlayers: 22, teamSize: 11, timeLimit: 6, scoreLimit: 10 }
    ];
    var TIER_NAMES = ['Recruta', 'Soldado', 'Cabo', 'Sargento', 'Subtenente', 'Aspirante', 'Tenente', 'Capitão', 'Major', 'Tenente-Coronel', 'Coronel',
        'Brigadeiro', 'General', 'Marechal', 'Comandante', 'Grão-Mestre', 'Lenda', 'Imortal'];
    var FALLBACK_TIERS = TIER_NAMES.map(function (n, i) { return { id: 'r' + ('0' + (i + 1)).slice(-2), name: n, min: i === 0 ? 0 : 900 + (i - 1) * 100 }; });
    var modes = FALLBACK_MODES, tiers = FALLBACK_TIERS;
    var me = null;                 // usuário logado
    var session = null;            // partida ranqueada em andamento
    var cfgBackup = null, lastExitRanked = false;
    var lastRankMode = localStorage.getItem('fh_rank_mode') || 'v3';

    function tierOf(r) { var t = tiers[0]; tiers.forEach(function (x) { if (r >= x.min) t = x; }); return t; }
    function modeInfo(id) { return modes.filter(function (m) { return m.id === id; })[0] || { id: id, label: id }; }

    /* ---------- util ---------- */
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    var toastT = 0;
    function toast(msg) {
        var t = $('fhToast'); t.textContent = msg; t.classList.add('on');
        clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 3200);
    }
    function api(path, opt) {
        opt = opt || {};
        return fetch(path, {
            method: opt.method || 'GET', credentials: 'same-origin', keepalive: !!opt.keepalive,
            headers: { 'Content-Type': 'application/json' },
            body: opt.body ? JSON.stringify(opt.body) : undefined
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) {
                    var msg = j.error || 'Erro ao falar com o servidor.';
                    if (r.status === 404 && /^Rota n/.test(msg)) msg = 'Servidor desatualizado: pare e inicie de novo o servidor (node server.js).';
                    var e = new Error(msg); e.status = r.status; throw e;
                }
                return j;
            });
        }, function () { throw new Error('Sem conexão com o servidor.'); });
    }
    function tierNum(id) { return parseInt(String(id).slice(1), 10) || 1; }
    function tierClass(id) { var n = tierNum(id); return 'fam' + (n <= 6 ? 0 : n <= 12 ? 1 : 2); }   // cor por família: aço / ouro-aço / ouro
    function tierIdxOf(r) { var k = 0; tiers.forEach(function (x, i) { if (r >= x.min) k = i; }); return k; }
    function rankImg(id, cls) {
        var i = el('img', cls || 'rankIco'); i.src = 'ranks/' + id + '.png'; i.alt = ''; i.draggable = false; return i;
    }
    function badge(tierId, tierName) {
        var b = el('span', 'tierBadge ' + tierClass(tierId));
        b.appendChild(rankImg(tierId, 'tbImg'));
        b.appendChild(document.createTextNode(tierName));
        return b;
    }

    /* =====================================================
       CONTA
       ===================================================== */
    function applyUser(u) {
        me = u;
        if (window.FH_EXCL) FH_EXCL.set(u ? u.excl : null);
        if (u) {
            state.nick = u.nick; state.avatar = u.avatar;
            try { localStorage.setItem('mb_classic_nick', u.nick); localStorage.setItem('mb_classic_avatar', u.avatar); } catch (e) {}
            $('nick').value = u.nick; $('avatar').value = u.avatar;
        }
        var n = $('homeNick'), a = $('homeAvatar');
        if (u && n) n.textContent = u.nick;
        if (u && a) a.textContent = u.avatar;
        renderAccountBox();
        renderHomeRanked();
    }
    function bestTier() {
        if (!me) return null;
        var best = null;
        modes.forEach(function (m) {
            var s = me.stats && me.stats[m.id];
            if (s && s.games > 0 && (!best || s.rating > best.rating)) best = { rating: s.rating, tierName: tierOf(s.rating).name, tierId: tierOf(s.rating).id, mode: m.label };
        });
        return best;
    }
    function homeFormatId() { var s = $('homeModeSelect'); return s ? s.value : 'v3'; }
    function homeIsRanked() { var s = $('homeModality'); return !!s && s.value === 'ranked'; }
    function renderHomeRanked() {
        var s = $('homeRankedTier');
        var cur = null;
        if (me) {
            var st = me.stats && me.stats[homeFormatId()] || { rating: 800, games: 0 };
            cur = { rating: st.rating, tierId: tierOf(st.rating).id, tierName: tierOf(st.rating).name };
        }
        if (s) s.textContent = !homeIsRanked() ? '' : (cur ? cur.tierName + ' · ' + cur.rating + ' pts' : 'Faça login para jogar');
        var img = $('homeRankImg');
        if (img) img.src = 'ranks/' + (cur ? cur.tierId : tiers[0].id) + '.png';
        $('homeRankBadge').hidden = !me;
    }
    document.addEventListener('fh-home-change', function () { renderHomeRanked(); });
    // chamado pelo botão grande da tela inicial quando a modalidade é Ranqueado
    window.FH_RANKED_HOME = { play: function (modeId) { if (!me) { openRankedMenu(); return; } startSearch(modeId); } };
    function renderAccountBox() {
        var box = clear($('accountBox'));
        if (me) {
            box.appendChild(el('p', 'accName', 'Conta: @' + me.username));
            var out = el('button', 'accBtn', 'Sair da conta'); out.type = 'button';
            out.onclick = function () {
                api('/api/logout', { method: 'POST' }).catch(function () {}).then(function () {
                    applyUser(null); renderHomeRanked(); showAuth();
                });
            };
            box.appendChild(out);
        } else {
            box.appendChild(el('p', 'accName', 'Você está como convidado. Convidados não entram no ranking.'));
            var go = el('button', 'accBtn', 'Entrar ou criar conta'); go.type = 'button';
            go.onclick = showAuth;
            box.appendChild(go);
        }
    }
    function showAuth() { $('authMsg').textContent = ''; show('authScreen'); }

    var authMode = 'login';
    function setAuthMode(m) {
        authMode = m;
        $('tabLogin').classList.toggle('on', m === 'login'); $('tabLogin').setAttribute('aria-selected', String(m === 'login'));
        $('tabRegister').classList.toggle('on', m === 'register'); $('tabRegister').setAttribute('aria-selected', String(m === 'register'));
        document.querySelector('.authRegOnly').hidden = m !== 'register';
        $('authSubmit').textContent = m === 'login' ? 'Entrar' : 'Criar conta';
        $('authPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
        $('authMsg').textContent = '';
    }
    $('tabLogin').onclick = function () { setAuthMode('login'); };
    $('tabRegister').onclick = function () { setAuthMode('register'); };
    $('authGuest').onclick = function () { show('nickScreen'); };
    $('authForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var username = $('authUser').value.trim().toLowerCase(), password = $('authPass').value;
        var msg = $('authMsg'), btn = $('authSubmit');
        if (!username || !password) { msg.textContent = 'Preencha usuário e senha.'; return; }
        var body = { username: username, password: password };
        if (authMode === 'register') { body.nick = $('authNick').value.trim() || username; body.avatar = Array.from(body.nick).slice(0, 2).join('').toUpperCase(); }
        btn.disabled = true; msg.textContent = '';
        api(authMode === 'login' ? '/api/login' : '/api/register', { method: 'POST', body: body }).then(function (r) {
            $('authPass').value = '';
            applyUser(r.user);
            $('loginForm').requestSubmit();       // segue o fluxo normal do jogo (vai para a tela inicial)
        }).catch(function (e) { msg.textContent = e.message; }).then(function () { btn.disabled = false; });
    });

    // salvar perfil -> também grava na conta
    $('loginForm').addEventListener('submit', function () {
        if (!me) return;
        var nick = state.nick, avatar = state.avatar;
        if (nick === me.nick && avatar === me.avatar) return;
        api('/api/profile', { method: 'PATCH', body: { nick: nick, avatar: avatar } }).then(function (r) { applyUser(r.user); }).catch(function () {});
    });

    function refreshMe() {
        return api('/api/me').then(function (r) { if (r.user) applyUser(r.user); return r.user; }).catch(function () { return me; });
    }

    /* =====================================================
       MENU RANQUEADA
       ===================================================== */
    function openRankedMenu() {
        var body = clear($('rmBody'));
        $('rankedMenu').hidden = false;
        if (!me) {
            body.appendChild(el('p', 'rmLogin', 'Para jogar ranqueada você precisa de uma conta. É rápido e grátis.'));
            var b = el('button', 'btn', 'Entrar ou criar conta'); b.type = 'button';
            b.onclick = function () { closeRankedMenu(); showAuth(); };
            body.appendChild(b);
            return;
        }
        body.appendChild(el('p', 'rmLogin', 'Carregando…'));
        refreshMe().then(function () { renderRankedTiles(); });
    }
    function renderRankedTiles() {
        var body = clear($('rmBody'));
        [['futsal', 'Futsal'], ['real', 'Real Soccer']].forEach(function (g) {
            body.appendChild(el('h3', 'rmGroup', g[1]));
            var grid = el('div', 'rmGrid');
            modes.filter(function (m) { return m.group === g[0]; }).forEach(function (m) {
                var s = me && me.stats && me.stats[m.id] || { rating: 800, games: 0 };
                var t = tierOf(s.rating);
                var tile = el('button', 'rmTile ' + tierClass(t.id)); tile.type = 'button'; tile.dataset.mode = m.id;
                tile.appendChild(el('b', null, m.label.replace(/^(Futsal|Real) /, '')));
                tile.appendChild(rankImg(t.id, 'rmRank'));
                tile.appendChild(el('span', 'rmName', t.name));
                tile.appendChild(el('span', 'rmPts', s.rating + ' pts'));
                tile.appendChild(el('small', null, m.requiredPlayers + ' jogadores · ' + m.timeLimit + ' min · ' + m.scoreLimit + ' gols'));
                tile.onclick = function () { startSearch(m.id); };
                grid.appendChild(tile);
            });
            body.appendChild(grid);
        });
    }
    function closeRankedMenu() { $('rankedMenu').hidden = true; }
    $('rmClose').onclick = closeRankedMenu;
    $('rankedMenu').addEventListener('pointerdown', function (e) { if (e.target === $('rankedMenu')) closeRankedMenu(); });
    $('rmRanking').onclick = function () { closeRankedMenu(); openRanking(); };

    /* =====================================================
       PARTIDA RANQUEADA
       ===================================================== */
    /* ---------- busca de jogador (pareamento por patente) ---------- */
    var search = null;     // { mode, timer, matched, cd }
    var fmtTime = function (n) { return Math.floor(n / 60) + ':' + ('0' + (n % 60)).slice(-2); };

    function startSearch(modeId) {
        if (!me || search || (session && !session.finished)) return;
        var tiles = document.querySelectorAll('.rmTile'); tiles.forEach(function (t) { t.disabled = true; });
        api('/api/queue/join', { method: 'POST', body: { mode: modeId } }).then(function () {
            closeRankedMenu();
            search = { mode: modeId, timer: 0, matched: false, cd: 0, st: null };
            renderSearch();
            $('searchScreen').hidden = false;
            pollSearch();
            search.timer = setInterval(pollSearch, 1000);
        }).catch(function (e) {
            toast(e.message);
            if (e.status === 401) { applyUser(null); closeRankedMenu(); showAuth(); }
            tiles.forEach(function (t) { t.disabled = false; });
        });
    }
    function pollSearch() {
        if (!search || search.matched) return;
        var s = search;
        api('/api/queue/status').then(function (st) {
            if (search !== s || s.matched) return;
            if (st.state === 'idle') { endSearch(); toast('A busca expirou. Tente novamente.'); return; }
            if (st.state === 'matched') { s.matched = true; s.st = st; clearInterval(s.timer); renderFound(st); return; }
            s.st = st; renderSearch();
        }).catch(function (e) {
            if (search !== s) return;
            if (e.status === 401) { endSearch(); applyUser(null); showAuth(); }
        });
    }
    function endSearch() {
        if (!search) return;
        clearInterval(search.timer); clearInterval(search.cd);
        search = null;
        $('searchScreen').hidden = true;
    }
    function cancelSearch() {
        if (!search) return;
        api('/api/queue/leave', { method: 'POST' }).catch(function () {});
        endSearch();
    }
    function searchHeader(box, titleText, subText) {
        var info = modeInfo(search.mode);
        box.appendChild(el('span', 'srMode', info.label));
        box.appendChild(el('h2', 'srTitle', titleText));
        if (subText != null) box.appendChild(el('p', 'srSub', subText));
    }
    function renderSearch() {
        var box = clear($('searchBody')), st = search.st;
        searchHeader(box, 'Procurando jogador…', st ? 'Tempo de espera: ' + fmtTime(st.elapsed) : 'Entrando na fila…');
        var radar = el('div', 'srRadar'); radar.setAttribute('aria-hidden', 'true');
        radar.appendChild(el('i')); radar.appendChild(el('i')); radar.appendChild(el('i'));
        radar.appendChild(el('span', 'srBall', '⚽'));
        box.appendChild(radar);
        if (st) {
            // régua de patentes: sua patente + faixa que está sendo buscada
            var ladder = el('div', 'srLadder');
            tiers.forEach(function (t, i) {
                var im = rankImg(t.id, 'srRk' + (i >= st.window.lo && i <= st.window.hi ? ' in' : '') + (i === st.me.tierIdx ? ' me' : ''));
                im.title = t.name;
                ladder.appendChild(im);
            });
            box.appendChild(ladder);
            var lo = tiers[st.window.lo].name, hi = tiers[st.window.hi].name;
            box.appendChild(el('p', 'srRange', lo === hi ? 'Buscando: patente ' + lo : 'Buscando: de ' + lo + ' até ' + hi));
            var stats = el('div', 'srStats');
            stats.appendChild(el('span', null, 'Confirmados: ' + st.queue + '/' + (modeInfo(search.mode).requiredPlayers || 2)));
            stats.appendChild(el('span', null, 'Jogadores no modo: ' + st.population));
            box.appendChild(stats);
            box.appendChild(el('p', 'srHint', 'A ranqueada é 100% humana. A partida só começa quando todos os jogadores necessários estiverem conectados.'));
        }
        var cancel = el('button', 'srCancel', 'Cancelar'); cancel.type = 'button';
        cancel.onclick = cancelSearch;
        box.appendChild(cancel);
    }
    function playerCard(nick, avatar, tierId, tierName, rating, tag) {
        var c = el('div', 'srCard ' + tierClass(tierId));
        c.appendChild(rankImg(tierId, 'srCardRank'));
        c.appendChild(el('span', 'srAv', avatar));
        c.appendChild(el('b', null, nick));
        c.appendChild(badge(tierId, tierName));
        c.appendChild(el('small', null, rating + ' pts'));
        c.appendChild(el('em', 'srTag', tag));
        return c;
    }
    function renderFound(st) {
        var box = clear($('searchBody')), o = st.opponent;
        searchHeader(box, 'Adversário encontrado!', null);
        var vs = el('div', 'srVs');
        var mine = (me.stats && me.stats[search.mode]) || { rating: 800 }, mt = tierOf(mine.rating);
        vs.appendChild(playerCard(me.nick, me.avatar, mt.id, mt.name, mine.rating, 'Você'));
        vs.appendChild(el('div', 'srVsMark', 'VS'));
        vs.appendChild(playerCard(o.nick, o.avatar, o.tier, o.tierName, o.rating, o.bot ? 'Reserva · IA' : 'Jogador'));
        box.appendChild(vs);
        var diff = o.rating - mine.rating;
        box.appendChild(el('p', 'srRange', o.tier !== mt.id && o.rating > mine.rating ? 'Patente acima da sua: vitória vale mais pontos.' : 'Patente parecida com a sua.'));
        var cd = el('p', 'srCount', 'A partida começa em 3…'); box.appendChild(cd);
        box.appendChild(el('p', 'srHint', (o.bot ? 'Adversário de reserva controlado pela IA (treino local).' : 'Partida ao vivo contra outro jogador: o servidor valida o jogo e calcula os pontos.')));
        var cancel = el('button', 'srCancel', 'Cancelar'); cancel.type = 'button';
        cancel.onclick = cancelSearch;
        box.appendChild(cancel);
        var n = 3;
        search.cd = setInterval(function () {
            n--;
            if (n > 0) { cd.textContent = 'A partida começa em ' + n + '…'; return; }
            clearInterval(search.cd);
            cd.textContent = 'Iniciando…';
            acceptMatch();
        }, 1000);
    }
    function acceptMatch() {
        var modeId = search.mode;
        api('/api/queue/accept', { method: 'POST' }).then(function (r) {
            endSearch();
            beginMatch(r, modeId);
        }).catch(function (e) { endSearch(); toast(e.message); });
    }
    function beginMatch(r, modeId) {
        session = { matchId: r.matchId, mode: modeId, rules: r.rules, finished: false, engine: null, opponent: r.opponent };
        cfgBackup = { t: roomConfig.timeLimit, s: roomConfig.scoreLimit, v: fieldVariant };
        if (r.online && window.FH_ONLINE) {      // humano x humano: sala autoritativa no servidor, que também calcula o resultado
            session.online = true;
            session.result = new Promise(function (res) { session.resolve = res; });
            roomRole = r.online.team === 2 ? 'blue' : 'red'; roomOwnerId = 'other';
            $('game').classList.add('rankedMatch');
            FH_ONLINE.joinRanked(r.online);
            return;
        }
        roomConfig.timeLimit = r.rules.timeLimit;       // regras fixas definidas pelo servidor (não salvas)
        roomConfig.scoreLimit = r.rules.scoreLimit;
        roomRole = 'red'; roomOwnerId = 'self';
        state.roomMode = 'local'; mode = 'local';
        fieldVariant = modeId; mapKey = modeId;
        if ($('roomFieldVariant')) $('roomFieldVariant').value = modeId;
        resetRoomPlayers();
        $('game').classList.add('rankedMatch');
        start();
        session.engine = engine;
    }
    addEventListener('pagehide', function () {
        if (search && !search.matched) { try { fetch('/api/queue/leave', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) {} }
    });
    function restoreConfig() {
        if (cfgBackup) { roomConfig.timeLimit = cfgBackup.t; roomConfig.scoreLimit = cfgBackup.s; fieldVariant = cfgBackup.v; mapKey = cfgBackup.v; cfgBackup = null; }
        if ($('roomFieldVariant')) $('roomFieldVariant').value = fieldVariant;
        $('game').classList.remove('rankedMatch');
    }

    window.FH_RANKED = {
        active: function () { return !!session && !session.finished; },
        setEngine: function (e) { if (session && session.online) session.engine = e; },
        onlineEnded: function () { if (session && session.online) { session.finished = true; session.ended = true; } },
        onlineResult: function (r) {
            var s = session; if (!s || !s.resolve) return;
            s.resolve(r && !r.void ? { ok: true, r: r } : { ok: false, error: (r && r.reason) || 'Resultado não contabilizado.' });
        },
        exitScreen: function () { var r = lastExitRanked; lastExitRanked = false; return r ? 'homeScreen' : 'lobbyScreen'; },
        // chamado quando a partida termina (tempo ou limite de gols)
        onMatchEnd: function (e) {
            if (!session || session.finished || e !== session.engine) return;
            session.finished = true; session.ended = true;
            session.result = api('/api/ranked/finish', { method: 'POST', body: { matchId: session.matchId, red: e.red, blue: e.blue } })
                .then(function (r) { return { ok: true, r: r }; }, function (err) { return { ok: false, error: err.message }; });
        },
        // chamado quando o jogo encerra o engine; se a partida não acabou, é abandono (derrota)
        onStop: function (e) {
            if (!session || session.finished || e !== session.engine) return;
            session.finished = true; lastExitRanked = true;
            var id = session.matchId, md = session.mode;
            session = null; restoreConfig();
            api('/api/ranked/finish', { method: 'POST', keepalive: true, body: { matchId: id, abandon: true } })
                .then(function (r) { refreshMe(); toast('Partida abandonada: derrota registrada (' + (r.delta > 0 ? '+' : '') + r.delta + ' pts).'); })
                .catch(function () {});
        },
        // chamado ao fim do tempo: mostra o resultado em vez de voltar para a sala
        handleFinish: function () {
            if (!session || !session.ended) return false;
            var s = session; session = null;
            $('game').classList.remove('teamWindowOpen', 'spectatorMode');
            stopCrowd(); stop(); restoreConfig();
            show('homeScreen');
            showResult(s);
            return true;
        }
    };
    // fechar a aba no meio da partida = abandono
    addEventListener('pagehide', function () {
        if (session && !session.finished) {
            session.finished = true;
            try { fetch('/api/ranked/finish', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matchId: session.matchId, abandon: true }) }); } catch (e) {}
        }
    });

    function showResult(s) {
        var box = clear($('rrBody'));
        $('rankedResult').hidden = false;
        box.appendChild(el('p', 'rrWait', 'Calculando pontos…'));
        s.result.then(function (res) {
            clear(box);
            if (!res.ok) {
                box.appendChild(el('h2', 'rrTitle', 'Resultado não contabilizado'));
                box.appendChild(el('p', 'rrSub', res.error));
                addResultButtons(box, s.mode);
                return;
            }
            var r = res.r, label = modeInfo(s.mode).label;
            var title = r.result === 'win' ? 'Vitória!' : r.result === 'loss' ? 'Derrota' : 'Empate';
            box.className = 'rr-' + r.result;
            box.appendChild(el('h2', 'rrTitle', title));
            box.appendChild(el('p', 'rrScore', r.red + ' × ' + r.blue));
            box.appendChild(el('p', 'rrSub', label + (r.opponent ? ' · vs ' + r.opponent.nick + ' (' + r.opponent.tierName + ')' : '')));
            var d = el('div', 'rrDelta ' + (r.delta >= 0 ? 'up' : 'down'), (r.delta > 0 ? '+' : '') + r.delta + ' pts');
            box.appendChild(d);
            var tb = tierOf(r.before), ta = tierOf(r.after);
            var row = el('div', 'rrTier');
            row.appendChild(rankImg(ta.id, 'rrRank'));
            row.appendChild(el('span', null, r.before + ' → ' + r.after));
            row.appendChild(badge(ta.id, ta.name));
            box.appendChild(row);
            if (ta.min > tb.min) box.appendChild(el('p', 'rrPromo', '🎉 Você subiu para ' + ta.name + '!'));
            else if (ta.min < tb.min) box.appendChild(el('p', 'rrSub', 'Você caiu para ' + ta.name + '.'));
            addResultButtons(box, s.mode);
            refreshMe();
        });
    }
    function addResultButtons(box, modeId) {
        var row = el('div', 'rrBtns');
        var again = el('button', 'btn', 'Jogar de novo'); again.type = 'button';
        again.onclick = function () { $('rankedResult').hidden = true; startSearch(modeId); };
        var rank = el('button', 'rrSec', 'Ver ranking'); rank.type = 'button';
        rank.onclick = function () { $('rankedResult').hidden = true; openRanking(modeId); };
        var home = el('button', 'rrSec', 'Início'); home.type = 'button';
        home.onclick = function () { $('rankedResult').hidden = true; };
        row.appendChild(again); row.appendChild(rank); row.appendChild(home);
        box.appendChild(row);
    }

    /* =====================================================
       RANKING
       ===================================================== */
    function openRanking(modeId) {
        if (modeId) lastRankMode = modeId;
        show('rankingScreen');
        var chips = clear($('rkModes'));
        modes.forEach(function (m) {
            var c = el('button', 'rkChip' + (m.id === lastRankMode ? ' on' : ''), m.label); c.type = 'button'; c.setAttribute('role', 'tab');
            c.setAttribute('aria-selected', String(m.id === lastRankMode));
            c.onclick = function () { lastRankMode = m.id; try { localStorage.setItem('fh_rank_mode', m.id); } catch (e) {} openRanking(); };
            chips.appendChild(c);
        });
        var on = chips.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
        var list = clear($('rkList')); clear($('rkMe'));
        list.appendChild(el('p', 'rkEmpty', 'Carregando…'));
        var asked = lastRankMode;
        api('/api/ranking?mode=' + encodeURIComponent(asked) + '&limit=50').then(function (r) {
            if (asked !== lastRankMode) return;
            renderRanking(r);
        }).catch(function (e) { clear(list).appendChild(el('p', 'rkEmpty', e.message)); });
    }
    function renderRanking(r) {
        var me$ = clear($('rkMe')), list = clear($('rkList'));
        if (me && r.me) {
            var t = tierOf(r.me.rating);
            me$.appendChild(el('div', 'rkMePos', r.me.pos ? '#' + r.me.pos : '—'));
            var mid = el('div', 'rkMeInfo');
            mid.appendChild(el('b', null, me.nick));
            mid.appendChild(el('small', null, r.me.games ? r.me.wins + 'V · ' + r.me.draws + 'E · ' + r.me.losses + 'D' : 'Jogue uma ranqueada para entrar no ranking'));
            me$.appendChild(mid);
            var right = el('div', 'rkMeRight'); right.appendChild(badge(t.id, t.name)); right.appendChild(el('strong', null, r.me.rating + ' pts'));
            me$.appendChild(right);
        } else if (!me) {
            me$.appendChild(el('p', 'rkEmpty', 'Entre em uma conta para aparecer no ranking.'));
        }
        if (!r.top.length) { list.appendChild(el('p', 'rkEmpty', 'Ninguém jogou ' + r.label + ' ainda. Seja o primeiro!')); return; }
        r.top.forEach(function (p) {
            var row = el('div', 'rkRow' + (p.me ? ' me' : '') + (p.pos <= 3 ? ' top' + p.pos : ''));
            row.appendChild(el('span', 'rkPos', p.pos === 1 ? '🥇' : p.pos === 2 ? '🥈' : p.pos === 3 ? '🥉' : String(p.pos)));
            row.appendChild(el('span', 'rkAv', p.avatar));
            var nm = el('span', 'rkName'); nm.appendChild(el('b', null, p.nick)); nm.appendChild(el('small', null, '@' + p.username));
            row.appendChild(nm);
            row.appendChild(badge(p.tier, p.tierName));
            row.appendChild(el('span', 'rkPts', String(p.rating)));
            row.appendChild(el('span', 'rkWl', p.wins + '/' + p.games));
            list.appendChild(row);
        });
    }
    $('homeRanking').onclick = function () { openRanking(); };

    /* =====================================================
       PÁGINA DE PATENTE
       ===================================================== */
    var ptMode = null;
    function defaultPtMode() {
        var best = null;
        if (me && me.stats) modes.forEach(function (m) { var s = me.stats[m.id]; if (s && s.games > 0 && (!best || s.games > best.g)) best = { id: m.id, g: s.games }; });
        return best ? best.id : (localStorage.getItem('fh_rank_mode') || 'v3');
    }
    function openPatent(modeId) {
        if (!me) { showAuth(); return; }
        ptMode = modeId || ptMode || defaultPtMode();
        show('patentScreen');
        renderPatent();
        refreshMe().then(function () { if ($('patentScreen').classList.contains('on')) renderPatent(); });
    }
    function renderPatent() {
        var chips = clear($('ptModes'));
        modes.forEach(function (m) {
            var c = el('button', 'rkChip' + (m.id === ptMode ? ' on' : ''), m.label); c.type = 'button'; c.setAttribute('role', 'tab');
            c.setAttribute('aria-selected', String(m.id === ptMode));
            c.onclick = function () { ptMode = m.id; renderPatent(); };
            chips.appendChild(c);
        });
        var on = chips.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
        var box = clear($('ptBody'));
        var s = (me && me.stats && me.stats[ptMode]) || { rating: 800, games: 0, wins: 0, draws: 0, losses: 0, streak: 0, peak: 800 };
        var i = tierIdxOf(s.rating), t = tiers[i], next = tiers[i + 1] || null;

        var hero = el('div', 'ptHero');
        hero.appendChild(rankImg(t.id, 'ptBig'));
        var info = el('div', 'ptInfo');
        info.appendChild(el('small', null, modeInfo(ptMode).label));
        info.appendChild(el('h3', 'ptName', t.name));
        info.appendChild(el('p', 'ptPts', s.rating + ' pts'));

        var prog = el('div', 'ptProg');
        if (next) {
            var base = i === 0 ? next.min - 200 : t.min, span = next.min - base;
            var pct = Math.max(0, Math.min(100, (s.rating - base) / span * 100));
            var row = el('div', 'ptBarRow');
            row.appendChild(rankImg(t.id, 'ptMini'));
            var bar = el('div', 'ptBar'); bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(pct)));
            bar.setAttribute('aria-label', 'Progresso para ' + next.name);
            var fill = el('i'); fill.style.width = pct + '%'; bar.appendChild(fill);
            bar.appendChild(el('span', null, Math.round(pct) + '%'));
            row.appendChild(bar);
            row.appendChild(rankImg(next.id, 'ptMini next'));
            prog.appendChild(row);
            prog.appendChild(el('p', 'ptNeed', 'Faltam ' + Math.max(0, next.min - s.rating) + ' pts para ' + next.name));
        } else {
            prog.appendChild(el('p', 'ptNeed max', 'Patente máxima alcançada!'));
        }
        info.appendChild(prog);
        hero.appendChild(info);
        box.appendChild(hero);

        var st = el('div', 'ptStats');
        [['Vitórias', s.wins], ['Empates', s.draws], ['Derrotas', s.losses], ['Sequência', s.streak > 0 ? '+' + s.streak : String(s.streak || 0)], ['Melhor', s.peak]].forEach(function (x) {
            var d = el('div', 'ptStat'); d.appendChild(el('b', null, String(x[1]))); d.appendChild(el('span', null, x[0])); st.appendChild(d);
        });
        box.appendChild(st);
        if (!s.games) box.appendChild(el('p', 'rkEmpty', 'Jogue uma ranqueada neste modo para subir de patente.'));
        var go = el('button', 'btn ptPlay', 'Jogar ranqueada'); go.type = 'button';
        go.onclick = function () { show('homeScreen'); openRankedMenu(); };
        box.appendChild(go);
    }
    function openAllPatents() {
        var s = (me && me.stats && me.stats[ptMode]) || { rating: 0 };
        var cur = tierIdxOf(s.rating), grid = clear($('ptAllGrid'));
        tiers.forEach(function (t, i) {
            var c = el('div', 'ptCell ' + (i === cur ? 'cur' : i < cur ? 'done' : 'lock'));
            c.appendChild(rankImg(t.id, 'ptCellImg'));
            c.appendChild(el('b', null, t.name));
            c.appendChild(el('small', null, i === 0 ? 'Início' : t.min + '+ pts'));
            if (i === cur) c.appendChild(el('em', null, 'Atual'));
            grid.appendChild(c);
        });
        $('ptAll').hidden = false;
        var curEl = grid.querySelector('.cur'); if (curEl && curEl.scrollIntoView) curEl.scrollIntoView({ block: 'center' });
    }
    $('homeRankBadge').onclick = function () { openPatent(); };
    $('ptBack').onclick = function () { show('homeScreen'); };
    $('ptAllBtn').onclick = openAllPatents;
    $('ptAllClose').onclick = function () { $('ptAll').hidden = true; };
    $('ptAll').addEventListener('pointerdown', function (e) { if (e.target === $('ptAll')) $('ptAll').hidden = true; });
    $('rkBack').onclick = function () { show('homeScreen'); };
    $('rkPlay').onclick = function () { show('homeScreen'); openRankedMenu(); };

    addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (search) { cancelSearch(); e.stopPropagation(); }
        else if (!$('ptAll').hidden) { $('ptAll').hidden = true; e.stopPropagation(); }
        else if (!$('rankedMenu').hidden) { closeRankedMenu(); e.stopPropagation(); }
        else if ($('patentScreen').classList.contains('on')) show('homeScreen');
        else if ($('rankingScreen').classList.contains('on')) show('homeScreen');
    }, true);

    // toque longo no celular não abre menu nem seleciona nada (o "azul" na tela)
    document.addEventListener('contextmenu', function (e) {
        if (window.matchMedia('(pointer:coarse)').matches && !e.target.closest('input,textarea,[contenteditable="true"]')) e.preventDefault();
    });

    /* =====================================================
       INICIALIZAÇÃO
       ===================================================== */
    setAuthMode('login');
    api('/api/modes').then(function (r) { modes = r.modes; tiers = r.tiers; }).catch(function () {});
    api('/api/me').then(function (r) {
        if (r.user) {
            applyUser(r.user);
            if ($('authScreen').classList.contains('on')) $('loginForm').requestSubmit();
        } else {
            applyUser(null);
        }
    }).catch(function () { renderAccountBox(); });
    renderHomeRanked();
})();
