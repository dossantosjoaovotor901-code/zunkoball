/* online.js - PARTIDAS ONLINE do FutHub (cliente).
 * Liga a UI existente (lista de salas, criar sala, sala de espera, jogo) ao servidor autoritativo via WebSocket.
 * A física NÃO roda aqui de forma independente: o servidor manda, este arquivo prediz o jogador local
 * (game/netclient.js + game/sim.js) e desenha o que o núcleo de rede devolve.
 * Acessa as variáveis globais de game.js (engine, mode, roomPlayers, ...). O modo local/IA não é tocado. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var S = null;                 // sessão online ativa
    var selectedRoom = null, listTimer = 0;
    var TEAM = { 1: 'red', 2: 'blue', 0: 'spectator' }, TEAMN = { red: 1, blue: 2, spectator: 0 };

    function toast(m) { try { if (typeof homeToast === 'function') homeToast(m); } catch (e) {} }
    function api(path, body) {
        return fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Erro de rede.'); return j; });
        });
    }

    /* ---------------- lista de salas ---------------- */
    function renderRooms(rooms) {
        var body = $('roomListBody'); if (!body) return;
        body.textContent = '';
        var players = 0;
        rooms.forEach(function (r) { players += r.players; });
        $('roomCount').textContent = players + ' jogadores em ' + rooms.length + ' salas.';
        if (!rooms.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nenhuma sala disponível'; body.appendChild(e); selectedRoom = null; $('join').disabled = true; return; }
        rooms.forEach(function (r) {
            var row = document.createElement('div'); row.className = 'roomRow' + (selectedRoom && selectedRoom.id === r.id ? ' selected' : '');
            [r.name + (r.started ? ' ▶' : ''), r.players + '/' + r.max, r.pass ? '🔒' : '—', '—', r.country || 'BR'].forEach(function (t) {
                var s = document.createElement('span'); s.textContent = t; row.appendChild(s);
            });
            row.onclick = function () { selectedRoom = r; $('join').disabled = false; body.querySelectorAll('.roomRow').forEach(function (x) { x.classList.toggle('selected', x === row); }); };
            row.ondblclick = function () { selectedRoom = r; $('join').click(); };
            body.appendChild(row);
        });
        if (selectedRoom && !rooms.some(function (r) { return r.id === selectedRoom.id; })) { selectedRoom = null; $('join').disabled = true; }
    }
    function refreshRooms() {
        return api('/api/rooms').then(function (j) { renderRooms(j.rooms); }).catch(function () {});
    }
    $('refresh').addEventListener('click', function () { refreshRooms(); });     // addEventListener: game.js também mexe em onclick e não pode sobrescrever
    $('join').onclick = function () {
        if (!selectedRoom) return;
        var room = selectedRoom;
        if (room.pass) {
            fhPrompt('Senha da sala:', { ok: 'Entrar', password: true }).then(function (pw) { if (pw) connect(room.id, pw); });
            return;
        }
        connect(room.id, '');
    };
    listTimer = setInterval(function () { var l = $('lobbyScreen'); if (l && l.classList.contains('on') && !S) refreshRooms(); }, 4000);
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#homeRooms')) setTimeout(refreshRooms, 50); });

    /* ---------------- criar sala online ---------------- */
    $('doCreate').addEventListener('click', function (e) {
        var forceLocal = window.__fhForceLocal; window.__fhForceLocal = false;
        if (forceLocal || ($('roomType') && $('roomType').value === 'local')) return;      // fluxo antigo (treino vs IA)
        e.stopImmediatePropagation(); e.preventDefault();
        var style = $('roomStyle') ? $('roomStyle').value : 'futsal';
        api('/api/rooms', { name: $('roomName').value || (state.nick + ' — Sala'), pass: $('roomPass').value || '', max: parseInt($('maxPlayers').value, 10) || 8,
            map: $('fieldVariant').value || 'v3', style: style, score: roomConfig.scoreLimit, time: roomConfig.timeLimit,
            arbitration: $('roomArbitration') ? $('roomArbitration').value === 'on' : false,
            overtime: $('roomOvertime') ? parseInt($('roomOvertime').value, 10) || 0 : 0,
            goldenGoal: !$('roomGoldenGoal') || $('roomGoldenGoal').value !== 'off' })
            .then(function (j) { connect(j.room.id, $('roomPass').value || ''); })
            .catch(function (err) { toast(err.message); });
    }, true);

    /* ---------------- conexão ---------------- */
    function connect(roomId, password, ranked) {
        if (S) leave();
        S = { roomId: roomId, password: password || '', ranked: ranked || null, ws: null, net: null, tries: 0, closing: false, started: false,
            last: performance.now(), engineMade: false, lastRx: performance.now(), roster: [], lastNetHud: 0, waiting: null };
        open();
    }
    function open() {
        var s = S, proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var ws = new WebSocket(proto + '//' + location.host + '/ws'); ws.binaryType = 'arraybuffer';
        s.ws = ws;
        s.net = new FHNet.Client({
            now: function () { return performance.now(); },
            send: function (d) { if (ws.readyState === 1) ws.send(d); },
            getMap: function (k) { return MAPS[k]; },
            input: onlineInput, onEvent: onEvent, onMsg: onMsg
        });
        ws.onopen = function () { s.tries = 0; ws.send(JSON.stringify({ t: 'hello', room: s.roomId, nick: state.nick, avatar: state.avatar, password: s.password })); };
        ws.onmessage = function (ev) { s.lastRx = performance.now(); var d = ev.data; if (typeof d === 'string') s.net.onMessage(d, false); else s.net.onMessage(new Uint8Array(d), true); };
        ws.onclose = function () {
            if (S !== s || s.closing) return;
            if (s.tries >= 8) { toast('Conexão perdida.'); leaveToLobby(); return; }
            showOverlay('Reconectando… (' + (s.tries + 1) + '/8)');
            var wait = Math.min(4000, 400 * Math.pow(2, s.tries++));
            setTimeout(function () { if (S === s && !s.closing) open(); }, wait);
        };
        ws.onerror = function () {};
    }
    function ownerButtons() {         // pausa/reiniciar online: só o dono, só sala casual (ranqueada nunca)
        var rk = !!(S && (S.ranked || (S.room && S.room.ranked)));
        var own = !!S && roomOwnerId === 'self' && !rk;
        if ($('pauseGame')) $('pauseGame').hidden = !own;
        if ($('exit')) $('exit').hidden = !own;
    }
    function setPaused(on) {
        if (!S) return;
        S.net.paused = !!on; S.paused = !!on;
        var ov = $('pauseOv'); if (ov) ov.classList.toggle('on', !!on);
        var b = $('pauseGame');
        if (b) { b.textContent = on ? '▶' : '⏸'; b.setAttribute('aria-label', on ? 'Continuar partida' : 'Pausar partida'); b.title = on ? 'Continuar partida' : 'Pausar partida'; }
    }
    function leave() {
        if (!S) return;
        var s = S; S = null; s.closing = true;
        hideEndOverlay();
        try { s.ws.close(1000); } catch (e) {}
        hideOverlay(); hideCountdown();
        var po = $('pauseOv'); if (po) po.classList.remove('on');
        mode = 'local'; state.roomMode = 'local';
        var bd = $('benchDrawer'); if (bd) bd.hidden = true;
        var p = $('pingDisplay'); if (p) { p.textContent = 'Ping: N/D'; p.removeAttribute('data-bad'); }
    }
    function leaveToLobby() {
        leave();
        if (engine) { stopCrowd(); stop(); }
        $('game').classList.remove('rankedMatch');
        show('lobbyScreen'); refreshRooms();
    }
    function showOverlay(t) {
        var o = $('onlineOverlay');
        if (!o) { o = document.createElement('div'); o.id = 'onlineOverlay'; o.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:300;background:rgba(0,0,0,.78);color:#fff;font:700 15px Poppins,Arial,sans-serif;padding:10px 18px;border-radius:12px;pointer-events:none;'; document.body.appendChild(o); }
        o.textContent = t; o.style.display = 'block';
    }
    function hideOverlay() { var o = $('onlineOverlay'); if (o) o.style.display = 'none'; }
    function showCountdown(t) {
        var o = $('kickoffOverlay');
        if (!o) { o = document.createElement('div'); o.id = 'kickoffOverlay'; o.style.cssText = 'position:absolute;inset:0;z-index:110;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.48);color:#fff;font:900 clamp(54px,13vw,112px) Poppins,Arial,sans-serif;text-shadow:0 5px 22px #000;text-align:center;pointer-events:none;'; $('game').appendChild(o); }
        if (o.textContent !== t) o.textContent = t;
    }
    function hideCountdown() { var o = $('kickoffOverlay'); if (o) o.remove(); }

    /* ---------------- mensagens de controle ---------------- */
    /* volta para a tela da sala (mensagem 'lobby' do servidor, ou volta de segurança do cliente) */
    function clearBackTimer() { if (S && S.backTimer) { clearTimeout(S.backTimer); S.backTimer = null; } }
    function toRoom(m) {
        var s = S; if (!s) return;
        clearBackTimer();
        hideEndOverlay();
        s.started = false;
        if (engine && engine.online) { stopCrowd(); stop(); }
        // se a sala estava aberta por cima da partida (janela de times), volta ao estado normal de sala
        teamWindowFromGame = false;
        var rs = $('roomScreen'); if (rs) rs.classList.remove('teamWindow');
        var gm = $('game'); if (gm) gm.classList.remove('teamWindowOpen', 'spectatorMode');
        var sr = $('startRoom'); if (sr) { sr.textContent = 'Iniciar partida'; sr.disabled = roomOwnerId !== 'self'; }
        setPaused(false); hideCountdown(); show('roomScreen');
        if (m && m.room) { s.room = m.room; fieldVariant = m.room.map; mapKey = m.room.map; roomConfig.scoreLimit = m.room.scoreLimit; roomConfig.timeLimit = m.room.timeLimit; syncRoomConfigInputs(); }
        if (window.setRoomConfigLocked) window.setRoomConfigLocked(false);
        updateRoomOwnerControls();
        renderBench();
    }
    function backSoon(ms) {      // se o servidor demorar, o cliente volta sozinho para a sala
        var s = S; if (!s) return;
        clearBackTimer();
        s.backTimer = setTimeout(function () { if (S === s && s.started !== false && engine && engine.online) toRoom(null); }, ms);
    }
    function copyRoomLink() {
        var link = S && !S.ranked && S.roomId ? location.origin + '/?sala=' + encodeURIComponent(S.roomId) : '';
        if (!link) return;
        var done = function () { toast('Link da sala copiado!'); };
        var fallback = function () {
            var t = document.createElement('textarea'); t.value = link; t.style.cssText = 'position:fixed;opacity:0;left:-999px';
            document.body.appendChild(t); t.select();
            try { document.execCommand('copy'); done(); } catch (e) { toast(link); }
            document.body.removeChild(t);
        };
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(link).then(done, fallback); return; } } catch (e) {}
        fallback();
    }
    (function () { var b = document.getElementById('roomCopyLink'); if (b) b.addEventListener('click', copyRoomLink); })();
    function amAdm() { return !!(S && S.net && (S.net.adminId === S.net.me || (S.net.mods || []).indexOf(S.net.me) >= 0)); }
    /* Gaveta lateral do banco (durante a partida) */
    function renderBench() {
        var d = $('benchDrawer'); if (!d) return;
        var list = roomPlayers.filter(function (p) { return p.bench; });
        var show = !!S && !(S.ranked || (S.room && S.room.ranked)) && (list.length > 0 || amAdm());
        d.hidden = !show; if (!show) return;
        $('benchCount').textContent = list.length;
        [['benchRedList', 1], ['benchBlueList', 2]].forEach(function (x) {
            var box = $(x[0]); box.innerHTML = '';
            var its = list.filter(function (p) { return p.bench === x[1]; });
            if (!its.length) { var e = document.createElement('div'); e.className = 'benchEmpty'; e.textContent = '—'; box.appendChild(e); return; }
            its.forEach(function (pl) {
                var b = document.createElement('button'); b.type = 'button'; b.className = 'benchItem'; b.textContent = pl.nick;
                b.addEventListener('click', function (ev) { if (amAdm() && !pl.self && typeof openPlayerMenu === 'function') { var r = b.getBoundingClientRect(); openPlayerMenu(pl, r.right + 6, r.top); } });
                box.appendChild(b);
            });
        });
    }
    (function () { var h = $('benchHandle'); if (h) h.addEventListener('click', function () { var p = $('benchPanel'); p.hidden = !p.hidden; }); })();
    function onMsg(m) {
        var s = S; if (!s) return;
        switch (m.t) {
            case 'welcome':
                hideOverlay();
                mode = 'online'; state.roomMode = 'online';
                fieldVariant = m.room.map; mapKey = m.room.map;
                roomConfig.scoreLimit = m.room.scoreLimit; roomConfig.timeLimit = m.room.timeLimit;     // não salva no localStorage
                s.room = m.room; s.started = m.started; if (m.paused) setPaused(true);
                if (s.chatReset !== true) { roomChatMessages = []; renderRoomChat(); s.chatReset = true; }
                if (window.setRoomConfigLocked) window.setRoomConfigLocked(!!m.started || roomOwnerId !== 'self');
                if ($('roomTitle')) $('roomTitle').textContent = m.room.name + ' • ' + mapLabel(m.room.map);
                syncRoomConfigInputs();
                if (m.room.ranked || m.started) startEngine(); else if (!engine) { playRoomDing(); show('roomScreen'); }
                break;
            case 'roster': applyRoster(m); break;
            case 'start': s.started = true; setPaused(false); startEngine(); ownerButtons(); updateRoomOwnerControls(); break;
            case 'config':
                s.room = m.room; fieldVariant = m.room.map; mapKey = m.room.map;
                roomConfig.scoreLimit = m.room.scoreLimit; roomConfig.timeLimit = m.room.timeLimit;
                syncRoomConfigInputs();
                if ($('roomTitle')) $('roomTitle').textContent = m.room.name + ' • ' + mapLabel(m.room.map);
                if (window.setRoomConfigLocked) window.setRoomConfigLocked(false);
                break;
            case 'pause': setPaused(m.on); break;
            case 'pings': roomPlayers.forEach(function (pl) { if (m.p && m.p[pl.cid] != null) pl.ping = m.p[pl.cid]; }); if (window.FH_ROOMUI) FH_ROOMUI.pings(m.p); break;
            case 'lobby': toRoom(m); break;
            case 'chat':
                roomChatMessages.push({ author: m.from || 'Sala', team: 'red', text: m.m }); if (roomChatMessages.length > 60) roomChatMessages.shift(); renderRoomChat(); break;
            case 'end': onEnd(m); break;
            case 'ranked': if (window.FH_RANKED && FH_RANKED.onlineResult) FH_RANKED.onlineResult(m.r); break;
            case 'bye': toast(m.msg || 'Você saiu da sala.'); s.closing = true; leaveToLobby(); break;
            case 'error': clearBackTimer(); toast(m.msg || 'Não foi possível alterar a sala.'); break;
        }
    }
    function applyRoster(m) {
        var s = S, net = s.net;
        s.roster = m.players;
        roomPlayers = m.players.map(function (p) {
            return { id: 'c' + p.id, nick: p.nick, avatar: p.av, kit: p.kit || null, team: TEAM[p.team], self: p.id === net.me, owner: p.id === m.admin, mod: (m.mods || []).indexOf(p.id) >= 0, bench: p.bench || 0, cid: p.id, ping: p.rtt };
        });
        var mine = m.players.find(function (p) { return p.id === net.me; });
        if (mine) { roomRole = TEAM[mine.team]; try { localStorage.setItem('mb_room_role', roomRole); } catch (e) {} }
        var iAdm = m.admin === net.me || (m.mods || []).indexOf(net.me) >= 0;
        s.trueOwner = m.admin === net.me;
        roomOwnerId = iAdm ? 'self' : 'other';
        updateRoomOwnerControls();
        if (engine && engine.online) { spectatorMode = !mine || mine.slot < 0; $('game').classList.toggle('spectatorMode', spectatorMode); ownerButtons(); }
        renderRoomPlayers();
        renderBench();
        var sr = $('startRoom'); if (sr && !teamWindowFromGame) sr.disabled = !iAdm;
    }
    function showEndOverlay(red, blue) {
        var o = $('onlineEndOverlay');
        if (!o) {
            o = document.createElement('div'); o.id = 'onlineEndOverlay';
            o.style.cssText = 'position:absolute;inset:0;z-index:250;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(5,12,18,.76);color:#fff;font:700 18px Poppins,Arial,sans-serif;text-align:center;pointer-events:none;';
            var title = document.createElement('div'); title.className = 'onlineEndTitle'; title.style.cssText = 'font-size:clamp(24px,5vw,42px);font-weight:900;';
            var score = document.createElement('div'); score.className = 'onlineEndScore'; score.style.cssText = 'font-size:clamp(36px,8vw,68px);font-weight:900;letter-spacing:3px;';
            var note = document.createElement('div'); note.textContent = 'Voltando à sala…'; note.style.cssText = 'font-size:14px;opacity:.85;';
            o.append(title, score, note); $('game').appendChild(o);
        }
        o.querySelector('.onlineEndTitle').textContent = 'FIM DE JOGO';
        o.querySelector('.onlineEndScore').textContent = red + '  ×  ' + blue;
        o.style.display = 'flex';
    }
    function hideEndOverlay() { var o = $('onlineEndOverlay'); if (o) o.remove(); }
    function onEnd(m) {
        toast('Fim de jogo: ' + m.red + ' × ' + m.blue);
        if (!(S && S.ranked)) backSoon(4000);
        if (engine && engine.online) { engine.running = false; showEndOverlay(m.red, m.blue); }
        if (S && S.ranked && window.FH_RANKED && FH_RANKED.onlineEnded) {
            FH_RANKED.onlineEnded();
            setTimeout(function () { if (engine && engine.online) finishMatchAndReturnToRoom(); }, 2500);
        }
    }

    /* ---------------- partida ---------------- */
    function onlineInput() {
        if (!engine) return { x: 0, y: 0 };
        var i = inputFor(null);
        return i.l > 0.05 ? { x: Math.round(i.x * 127), y: Math.round(i.y * 127) } : { x: 0, y: 0 };
    }
    function startEngine() {
        var s = S; if (!s) return;
        if (engine && engine.online) { return; }
        if (engine) stop();
        requestGameDisplay();
        mode = 'online';
        var c = $('canvas'), m = MAPS[mapKey] || MAPS.classic;
        var ctx = c.getContext('2d', { alpha: false });
        spectatorMode = roomRole === 'spectator';
        engine = {
            c: c, ctx: ctx, m: m, running: true, paused: false, last: performance.now(), time: roomTimeSeconds(), red: 0, blue: 0, kick: false, pass: false,
            kickBuffer: 0, passBuffer: 0, kickFlash: 0, passFlash: 0, goalAnim: null, finishReturnScheduled: false, postSoundCd: 0, keys: new Set(),
            touch: { x: 0, y: 0, active: false }, players: [], ball: { x: 0, y: 0, vx: 0, vy: 0, r: m.BallProperty.radius * 1.28, mass: m.BallProperty.density, angle: 0 },
            online: { pressKick: function () { if (S) S.net.pressKick(); }, pressPass: function () { if (S) S.net.pressPass(); } }
        };
        s.slots = {};
        bindKeys(); show('game'); resize();
        $('game').classList.toggle('spectatorMode', spectatorMode);
        ownerButtons();
        if (window.FH_RANKED && FH_RANKED.setEngine) FH_RANKED.setEngine(engine);
        pauseCrowdAudio(); pauseGameMusic();
        s.last = performance.now();
        requestAnimationFrame(loop);
    }
    function slotObj(slot, team) {
        var o = S.slots[slot];
        if (!o) o = S.slots[slot] = { x: 0, y: 0, vx: 0, vy: 0, r: FHSim.PLAYER_R, mass: 1, team: 'red', nick: '', avatar: '' };
        o.team = team === 2 ? 'blue' : 'red';
        return o;
    }
    // chamado por loop() em cada quadro de uma partida online
    function frame(now) {
        var s = S, e = engine; if (!s || !e) return;
        var dtMs = Math.min(250, now - s.last); s.last = now;
        var net = s.net, SIM = FHSim;
        net.frame(dtMs);
        var r = net.getRender(), st = net.auth;
        // conexão: sem nada do servidor por muito tempo
        var silent = now - s.lastRx;
        if (silent > 6000 && s.ws.readyState === 1) { try { s.ws.close(); } catch (er) {} }
        else if (silent > 1500) showOverlay('Conexão instável…'); else if (s.ws.readyState === 1) hideOverlay();
        if (r && st) {
            var ps = r.s, pos = r.pos, list = [];
            var rosterBySlot = {};
            s.roster.forEach(function (p) { if (p.slot >= 0) rosterBySlot[p.slot] = p; });
            var me = null;
            for (var i = 0; i < ps.players.length; i++) {
                var p = ps.players[i]; if (!p.present) continue;
                var o = slotObj(i, p.team);
                o.x = pos[2 + 2 * i]; o.y = pos[3 + 2 * i]; o.vx = p.vx; o.vy = p.vy; o.mass = p.mass;
                var info = rosterBySlot[i]; o.nick = info ? info.nick : ''; o.avatar = info ? info.av : ''; o.kit = info ? info.kit || null : null;
                if (i === net.slot) me = o; else list.push(o);
            }
            e.players = me ? [me].concat(list) : list;
            e.ball.x = pos[0]; e.ball.y = pos[1]; e.ball.vx = ps.ball.vx; e.ball.vy = ps.ball.vy;
            e.red = st.red; e.blue = st.blue;
            e.time = Math.max(0, ps.timeTicks / SIM.TICK_RATE);
            e.running = st.phase !== SIM.PH.ENDED;
            var rs = ps.restart;
            e.restart = rs && st.phase === SIM.PH.PLAY ? { type: rs.type === 1 ? 'throw' : rs.type === 2 ? 'goalkick' : 'corner', team: rs.team === 1 ? 'red' : 'blue', x: rs.x, y: rs.y, t: rs.t } : null;
            if (st.phase === SIM.PH.GOAL) {
                if (!e.goalAnim) {
                    var sc = st.lastScorer >= 0 ? rosterBySlot[st.lastScorer] : null;
                    e.goalAnim = { team: st.goalTeam === 1 ? 'red' : 'blue', scorerName: sc ? sc.nick : '', fx: sc ? sc.fx || null : null, t: 0 };
                }
                e.goalAnim.t = st.goalT / SIM.TICK_RATE;
            } else e.goalAnim = null;
            if (net.started && st.phase === SIM.PH.COUNTDOWN && ps.cd > 0) showCountdown(String(Math.ceil(ps.cd / SIM.TICK_RATE)));
            else hideCountdown();
        } else if (!net.started) {
            showCountdown(s.ranked ? 'Aguardando adversário…' : 'Aguardando…');
        }
        e.kickFlash = Math.max(0, e.kickFlash - dtMs / 1000); e.passFlash = Math.max(0, e.passFlash - dtMs / 1000);
        if (r && st && (e.players.length || spectatorMode)) {      // só desenha quando já existe estado do servidor
            updateGoalNets(dtMs / 1000);
            draw();
        } else { e.ctx.fillStyle = '#285f32'; e.ctx.fillRect(0, 0, e.c.width, e.c.height); }
        hudNet(now, net);
    }
    function hudNet(now, net) {
        var s = S; if (now - s.lastNetHud < 500) return; s.lastNetHud = now;
        var st = net.st, p = $('pingDisplay'); if (!p) return;
        p.textContent = 'Ping: ' + Math.round(st.rtt) + ' ms';
        p.title = 'Jitter ' + st.jitter.toFixed(1) + ' ms · fila ' + st.qlen + ' · snapshots ' + st.snapHz.toFixed(0) + '/s · ' + (st.bps / 1024).toFixed(1) + ' KB/s · erro de predição ' + st.errAvg.toFixed(3) + ' m · lacunas ' + st.gaps;
        p.setAttribute('data-bad', st.rtt > 150 ? '1' : '');
    }
    function onEvent(ev) {
        var e = engine, s = S; if (!e || !s) return;
        var SIM = FHSim;
        switch (ev.type) {
            case SIM.EV.KICK:
                play('sound/kick_ball.mp3');
                if (ev.a === s.net.slot) { if (ev.b === 2) e.passFlash = .22; else e.kickFlash = .22; }
                break;
            case SIM.EV.POST: {
                var nets = ensureNets(e), n = nets[ev.a]; if (!n) break;
                postHitFx(e, n, n.post[ev.b], e.ball, ev.c); playPostCue(ev.c); break;
            }
            case SIM.EV.NET: {
                var nn = ensureNets(e)[ev.a]; if (nn) netImpact(nn, ev.b === 0 ? 'back' : ev.b === 1 ? 'a' : 'b', ev.d, ev.c); break;
            }
            case SIM.EV.GOAL: playGoalCue(); break;
        }
    }

    /* ---------------- salas: times pelo servidor ---------------- */
    function syncMoves() {          // diferença entre a UI (arrastar/soltar, auto, sortear) e o que o servidor sabe
        if (!S || !S.net) return;
        roomPlayers.forEach(function (p) {
            var r = S.roster.find(function (x) { return x.id === p.cid; }); if (!r || TEAM[r.team] === p.team) return;
            if (p.self) S.ws.send(JSON.stringify({ t: 'team', team: TEAMN[p.team] }));
            else if (amAdm()) S.ws.send(JSON.stringify({ t: 'move', id: p.cid, team: TEAMN[p.team] }));
        });
    }
    var _setRole = window.setRoomRole, _render = window.renderRoomPlayers, _commit = window.commitTeamChanges;
    window.setRoomRole = function (role) { if (S) { syncMoves(); return; } return _setRole(role); };
    window.commitTeamChanges = function () { if (S) { syncMoves(); return; } return _commit(); };
    window.renderRoomPlayers = function () { if (S) { var t = S.net && S.net.roster; syncMoves(); } return _render(); };
    $('startRoom').addEventListener('click', function (e) {
        if (!S || teamWindowFromGame) return;           // "Voltar à partida" segue o fluxo normal
        e.stopImmediatePropagation(); e.preventDefault();
        if (amAdm()) S.ws.send(JSON.stringify({ t: 'start' }));
        else toast('Só o dono ou um admin inicia a partida.');
    }, true);

    window.FH_ONLINE = {
        active: function () { return !!S; },
        frame: function (now) { try { frame(now); } catch (err) { if (!S || !S.warned) { console.error('online frame:', err); if (S) S.warned = true; } } },
        leave: function () { leave(); setTimeout(refreshRooms, 400); },
        requestPause: function () { if (S && S.ws.readyState === 1) S.ws.send(JSON.stringify({ t: 'pause' })); },
        requestRestart: function () { if (S && S.ws.readyState === 1) S.ws.send(JSON.stringify({ t: 'restart' })); },
        requestStop: function () { if (S && S.ws.readyState === 1) { S.ws.send(JSON.stringify({ t: 'stop' })); backSoon(1500); } },
        requestConfig: function (cfg) { if (S && S.ws.readyState === 1 && !S.started) S.ws.send(JSON.stringify({ t: 'config', time: cfg.time, score: cfg.score, map: cfg.map })); },
        refreshRooms: refreshRooms,
        copyLink: copyRoomLink,
        isOwner: function () { return !!(S && S.trueOwner); },
        playerAction: function (act, cid) {
            if (!S || S.ws.readyState !== 1) return;
            if (act === 'kick' || act === 'admin' || act === 'ban') S.ws.send(JSON.stringify({ t: act, id: cid }));
            else if (act === 'bench1' || act === 'bench2') S.ws.send(JSON.stringify({ t: 'move', id: cid, bench: act === 'bench1' ? 1 : 2 }));
            else if (act === 'field0' || act === 'field1' || act === 'field2') S.ws.send(JSON.stringify({ t: 'move', id: cid, team: +act.slice(5) }));
        },
        roomLink: function () { return S && !S.ranked && S.roomId ? location.origin + '/?sala=' + encodeURIComponent(S.roomId) : ''; },
        chat: function (t) { if (S && S.ws.readyState === 1) S.ws.send(JSON.stringify({ t: 'chat', m: t })); },
        join: function (id, pw) { connect(id, pw || ''); },
        joinRanked: function (info) { connect(info.room, '', info); },
        onStop: function (e) { hideCountdown(); },
        stats: function () { return S && S.net ? S.net.st : null; }
    };

    /* Entrar pelo link da sala (?sala=ID): espera o login terminar e conecta */
    (function () {
        var id = null;
        try { id = new URLSearchParams(location.search).get('sala'); } catch (e) {}
        if (!id) return;
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        var tries = 0, iv = setInterval(function () {
            if (++tries > 240) return clearInterval(iv);
            var home = document.getElementById('homeScreen');
            if (state && state.nick && home && home.classList.contains('on') && !S) { clearInterval(iv); connect(id, ''); }
        }, 500);
    })();
})();
